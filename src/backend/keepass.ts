import { rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { argon2d, argon2id } from 'hash-wasm';
import kdbxweb from 'kdbxweb';
import type {
  Backend,
  CredentialReference,
  KeepassDatabaseSetting,
  KeepassEntry,
  Settings,
} from '../shared/ipc.ts';
import { LoginNeeded, type CredentialProvider } from './credentials.ts';

const { Credentials, CryptoEngine, Kdbx, KdbxError, ProtectedValue } = kdbxweb;
type Db = InstanceType<typeof Kdbx>;
type Group = ReturnType<Db['getDefaultGroup']>;
type Entry = ReturnType<Db['createEntry']>;

// kdbxweb ships no Argon2. hash-wasm runs it as WebAssembly, in this process.
CryptoEngine.setArgon2Impl(
  async (password, salt, memory, iterations, length, parallelism, type) =>
    (type === CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d)({
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      memorySize: memory,
      iterations,
      hashLength: length,
      parallelism,
      outputType: 'binary',
    }).then((hash) => hash.buffer as ArrayBuffer),
);

/** An unlocked database, and the modified time of the file it was read from. */
type Open = {
  db: Db;
  credentials: InstanceType<typeof Credentials>;
  file: string;
  mtime: number;
};

const hex = (uuid: { id: string }) =>
  Buffer.from(uuid.id, 'base64').toString('hex');

const text = (
  field: string | InstanceType<typeof ProtectedValue> | undefined,
) => (typeof field === 'string' ? field : (field?.getText() ?? ''));

const arrayBuffer = (buffer: Buffer) =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

/** `<database>/<32 lowercase hex uuid>`. A database name may hold `/`, so the split is at the last one. */
const entryRef = /^(.+)\/([0-9a-f]{32})$/;

const notSetUp = (name: string) =>
  new Error(`KeePass database \`${name}\` isn't set up on this machine.`);
const keyFiles = new Error("Key files aren't supported yet.");

/** The groups below `root` with their `/`-joined paths, the Recycle Bin and what is in it left out. */
function* groupsOf(
  db: Db,
  root: Group,
  prefix = '',
): Generator<[string, Group]> {
  for (const group of root.groups) {
    if (
      group.uuid.equals(
        db.meta.recycleBinEnabled === false
          ? undefined
          : db.meta.recycleBinUuid,
      )
    )
      continue;
    const path = prefix ? `${prefix}/${group.name}` : group.name!;
    yield [path, group];
    yield* groupsOf(db, group, path);
  }
}

function* entriesOf(db: Db): Generator<[string, Entry]> {
  const root = db.getDefaultGroup();
  for (const entry of root.entries) yield ['', entry];
  for (const [path, group] of groupsOf(db, root))
    for (const entry of group.entries) yield [path, entry];
}

/** KeePass databases read and written in place, unlocked with the master password and kept in memory until `lock`. */
export function createKeepass(
  settings: () => Promise<Settings>,
  updateSettings: Backend['updateSettings'],
): { provider: CredentialProvider } & Pick<
  Backend,
  'findKeepass' | 'keepassDatabases' | 'unlockKeepass' | 'lockKeepass'
> {
  const open = new Map<string, Open>();
  const writing = new Map<string, Promise<unknown>>();

  async function configured(name: string): Promise<KeepassDatabaseSetting> {
    const found = (await settings()).keepassDatabases.find(
      (d) => d.name === name,
    );
    if (!found) throw notSetUp(name);
    if (found.keyFile) throw keyFiles;
    return found;
  }

  async function load(file: string, credentials: Open['credentials']) {
    const mtime = (await stat(file)).mtimeMs;
    const db = await Kdbx.load(arrayBuffer(await readFile(file)), credentials);
    return { db, credentials, file, mtime };
  }

  async function unlock(name: string, password: string) {
    const { path } = await configured(name);
    try {
      open.set(
        name,
        await load(path, new Credentials(ProtectedValue.fromString(password))),
      );
    } catch (e) {
      if (e instanceof KdbxError && e.code === 'InvalidKey')
        throw new Error('Wrong master password.');
      throw new Error(`KeePass can't open ${path}: ${(e as Error).message}`);
    }
  }

  /** What a locked database asks for. A refused answer comes back as the reason of the next ask. */
  const locked = (
    name: string,
    reason = `KeePass database \`${name}\` is locked.`,
  ) =>
    new LoginNeeded(
      reason,
      `Unlock ${name}`,
      [{ prompt: 'Master password', echo: false }],
      async ([password = '']) =>
        unlock(name, password).then(
          () => undefined,
          (e: Error) => e.message,
        ),
      `KeePass database \`${name}\` wasn't unlocked.`,
    );

  /**
   * The unlocked database as the file holds it now. A changed file is read again with the master password the user typed.
   * If that password no longer opens it, the database locks and asks again.
   */
  async function current(name: string): Promise<Open> {
    const { path } = await configured(name);
    const known = open.get(name);
    if (!known || known.file !== path) throw locked(name);
    if ((await stat(path)).mtimeMs === known.mtime) return known;
    try {
      const next = await load(path, known.credentials);
      open.set(name, next);
      return next;
    } catch (e) {
      open.delete(name);
      if (e instanceof KdbxError && e.code === 'InvalidKey')
        throw locked(name, `The master password of \`${name}\` changed.`);
      throw new Error(`KeePass can't open ${path}: ${(e as Error).message}`);
    }
  }

  const find = (db: Db, id: string) =>
    [...entriesOf(db)].find(([, e]) => hex(e.uuid) === id)?.[1];

  /** Splits a reference and finds its entry in the database as the file holds it now. */
  async function entryOf(ref: CredentialReference) {
    const [, name, id] = ref.entry.match(entryRef) ?? [];
    if (!name) throw new Error(`"${ref.entry}" is not a KeePass entry.`);
    const entry = find((await current(name)).db, id);
    if (!entry)
      throw new Error(`KeePass database \`${name}\` has no such entry.`);
    return { name, id, entry };
  }

  /**
   * Reloads, applies `change`, checks the file did not change meanwhile, writes a temp file next to it and renames it over the database.
   * A change by KeeWeb or OneDrive between the reload and the write starts the round again.
   */
  function write<T>(name: string, change: (db: Db) => T): Promise<T> {
    // Two Tabs saving to one database would share its Open state and temp file: each write waits for the one before.
    const run = (writing.get(name) ?? Promise.resolve()).then(() =>
      writeOnce(name, change),
    );
    writing.set(
      name,
      run.catch(() => {}),
    );
    return run;
  }

  async function writeOnce<T>(name: string, change: (db: Db) => T): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await current(name);
      const result = change(state.db);
      const saved = Buffer.from(await state.db.save());
      // A change since the reload starts over: the next `current` reads the file again.
      if ((await stat(state.file)).mtimeMs !== state.mtime) continue;
      const temp = `${state.file}.${process.pid}.tmp`;
      try {
        await writeFile(temp, saved);
        // A rename keeps the modified time, so this is the time of the file the rename puts in place.
        const mtime = (await stat(temp)).mtimeMs;
        await rename(temp, state.file);
        state.mtime = mtime;
      } catch (e) {
        await rm(temp, { force: true });
        throw new Error(
          `KeePass can't save ${state.file}: ${(e as Error).message}`,
        );
      }
      return result;
    }
    throw new Error(`${name} keeps changing. Try again.`);
  }

  const groupAt = (db: Db, path: string) => {
    let group = db.getDefaultGroup();
    for (const part of path ? path.split('/') : []) {
      const next = group.groups.find((g) => g.name === part);
      if (!next) throw new Error(`KeePass group \`${path}\` is gone.`);
      group = next;
    }
    return group;
  };

  const listed = (database: string, group: string, e: Entry): KeepassEntry => ({
    id: `${database}/${hex(e.uuid)}`,
    name: text(e.fields.get('Title')),
    username: text(e.fields.get('UserName')),
    group,
    database,
  });

  return {
    provider: {
      async read(ref) {
        const { entry } = await entryOf(ref);
        const username = text(entry.fields.get('UserName'));
        return {
          secret: text(entry.fields.get('Password')),
          ...(username && { username }),
        };
      },

      async write(ref, secret) {
        const { name, id } = await entryOf(ref);
        await write(name, (db) => {
          const entry = find(db, id);
          if (!entry)
            throw new Error(`KeePass database \`${name}\` has no such entry.`);
          entry.pushHistory();
          entry.fields.set('Password', ProtectedValue.fromString(secret));
          entry.times.update();
        });
      },

      // The Recycle Bin when the database has one, else gone.
      async delete(ref) {
        const { name, id } = await entryOf(ref);
        await write(name, (db) => {
          const entry = find(db, id);
          if (entry) db.remove(entry);
        });
      },

      async create({ database, group }, fields, kind, secret) {
        await configured(database);
        const id = await write(database, (db) => {
          const entry = db.createEntry(groupAt(db, group));
          entry.fields.set('Title', fields.title);
          entry.fields.set('UserName', fields.username);
          entry.fields.set('URL', fields.url);
          entry.fields.set('Password', ProtectedValue.fromString(secret));
          return hex(entry.uuid);
        });
        await updateSettings({ keepassLastGroup: { database, group } });
        return { provider: 'keepass', entry: `${database}/${id}`, kind };
      },
    },

    async findKeepass(query) {
      const entries: KeepassEntry[] = [];
      const lockedNames: string[] = [];
      const needle = query.trim().toLowerCase();
      const exact = query.trim().match(entryRef);
      for (const { name, keyFile } of (await settings()).keepassDatabases) {
        if (exact && exact[1] !== name) continue;
        let state: Open;
        try {
          if (keyFile) throw keyFiles;
          state = await current(name);
        } catch (e) {
          if (e instanceof LoginNeeded || e === keyFiles)
            lockedNames.push(name);
          else throw e;
          continue;
        }
        for (const [group, entry] of entriesOf(state.db)) {
          const one = listed(name, group, entry);
          const hit = exact
            ? one.id === exact[0]
            : [
                one.name,
                one.username,
                text(entry.fields.get('URL')),
                group,
              ].some((f) => f.toLowerCase().includes(needle));
          if (hit) entries.push(one);
        }
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return { entries, locked: lockedNames };
    },

    async keepassDatabases() {
      const all = [];
      for (const { name } of (await settings()).keepassDatabases) {
        const state = await current(name).catch(() => undefined);
        all.push({
          name,
          locked: !state,
          groups: state
            ? [...groupsOf(state.db, state.db.getDefaultGroup())].map(
                ([p]) => p,
              )
            : [],
        });
      }
      return all;
    },

    unlockKeepass: unlock,

    async lockKeepass() {
      open.clear();
    },
  };
}
