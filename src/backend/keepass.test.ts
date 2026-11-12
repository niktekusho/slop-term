import { readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { argon2d, argon2id } from 'hash-wasm';
import kdbxweb from 'kdbxweb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TabId } from '../shared/ipc.ts';
import { eventually, startBackend, writeBox } from './harness.ts';
import { startFakeSshServer } from './ssh-server.ts';

const { Credentials, CryptoEngine, Kdbx, ProtectedValue } = kdbxweb;

// The fixtures are written by this process, which needs its own Argon2.
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

const hex = (uuid: { id: string }) =>
  Buffer.from(uuid.id, 'base64').toString('hex');

type Fixture = { password?: string; recycleBin?: boolean; keyFile?: boolean };

/** A database `work` with entries in the root, in `Servers` and in `Servers/Prod`, and one in the Recycle Bin. */
async function database({
  password = 'master',
  recycleBin = true,
  keyFile = false,
}: Fixture = {}) {
  const credentials = new Credentials(
    ProtectedValue.fromString(password),
    keyFile ? await Credentials.createRandomKeyFile() : undefined,
  );
  const db = Kdbx.create(credentials, 'work');
  const root = db.getDefaultGroup();
  const servers = db.createGroup(root, 'Servers');
  const prod = db.createGroup(servers, 'Prod');
  const add = (
    group: typeof root,
    title: string,
    username: string,
    secret: string,
    url = '',
  ) => {
    const entry = db.createEntry(group);
    entry.fields.set('Title', title);
    entry.fields.set('UserName', username);
    entry.fields.set('Password', ProtectedValue.fromString(secret));
    entry.fields.set('URL', url);
    return hex(entry.uuid);
  };
  const ids = {
    prod: add(prod, 'web prod', 'bob', 'hunter2', 'ssh://web.example.org'),
    staging: add(servers, 'web staging', 'carol', 'swordfish', 'ssh://stg'),
    shared: add(root, 'shared root', '', 'toor'),
  };
  if (recycleBin) {
    const bin = db.getGroup(db.meta.recycleBinUuid!)!;
    add(bin, 'old web', 'bob', 'old', 'ssh://web.example.org');
  } else {
    db.meta.recycleBinEnabled = false;
    db.meta.recycleBinUuid = undefined;
    const bin = root.groups.find((g) => g.name === 'Recycle Bin')!;
    db.move(bin, null);
  }
  return { bytes: Buffer.from(await db.save()), ids };
}

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

/** Starts a back end whose `settings.json` lists the database file `work.kdbx` in its home folder. */
async function start(fixture: Fixture = {}) {
  const { bytes, ids } = await database(fixture);
  harness = await startBackend((home) => ({
    'work.kdbx': bytes,
    'settings.json': JSON.stringify({
      keepassDatabases: [{ path: path.join(home, 'work.kdbx') }],
    }),
  }));
  return { file: path.join(harness.home, 'work.kdbx'), ids };
}

describe('unlocking and searching', () => {
  it('lists a locked database, unlocks it with the master password and searches title, username, URL and group, skipping the Recycle Bin', async () => {
    const { ids } = await start();
    expect(await harness.backend.findKeepass('web')).toEqual({
      entries: [],
      locked: ['work'],
    });
    await expect(harness.backend.unlockKeepass('work', 'nope')).rejects.toThrow(
      'Wrong master password.',
    );
    await harness.backend.unlockKeepass('work', 'master');
    const found = async (query: string) =>
      (await harness.backend.findKeepass(query)).entries.map((e) => e.id);
    expect(await harness.backend.findKeepass('web')).toEqual({
      entries: [
        {
          id: `work/${ids.prod}`,
          name: 'web prod',
          username: 'bob',
          group: 'Servers/Prod',
          database: 'work',
        },
        {
          id: `work/${ids.staging}`,
          name: 'web staging',
          username: 'carol',
          group: 'Servers',
          database: 'work',
        },
      ],
      locked: [],
    });
    expect(await found('CAROL')).toEqual([`work/${ids.staging}`]);
    expect(await found('web.example')).toEqual([`work/${ids.prod}`]);
    expect(await found('prod')).toEqual([`work/${ids.prod}`]);
    expect(await found('old')).toEqual([]);
  });
});

/** Opens the database file as KeeWeb would, changes it and saves it back under a later modified time. */
async function editElsewhere(
  file: string,
  change: (db: InstanceType<typeof Kdbx>) => void | Promise<void>,
) {
  const db = await loadFile(file);
  await change(db);
  await writeFile(file, Buffer.from(await db.save()));
  // A later modified time each time, since two saves within one clock tick can share one.
  const later = new Date(Date.now() + 10_000 * ++edits);
  await utimes(file, later, later);
}
let edits = 0;

async function loadFile(file: string) {
  const bytes = await readFile(file);
  return Kdbx.load(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    new Credentials(ProtectedValue.fromString('master')),
  );
}

const entryNamed = (db: InstanceType<typeof Kdbx>, title: string) =>
  [...db.getDefaultGroup().allEntries()].find(
    (e) => e.fields.get('Title') === title,
  )!;

const passwordOf = (entry: ReturnType<typeof entryNamed>) =>
  (
    entry.fields.get('Password') as InstanceType<typeof ProtectedValue>
  ).getText();

describe('a database changed by KeeWeb or OneDrive', () => {
  it('reloads on the next read when the file changed', async () => {
    const { file, ids } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    await editElsewhere(file, (db) => {
      entryNamed(db, 'web prod').fields.set('Title', 'web production');
    });
    const found = await harness.backend.findKeepass('production');
    expect(found.entries.map((e) => e.id)).toEqual([`work/${ids.prod}`]);
  });

  it('locks the database when the file changed its master password', async () => {
    const { file } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    await editElsewhere(file, (db) =>
      db.credentials.setPassword(ProtectedValue.fromString('renewed')),
    );
    expect(await harness.backend.findKeepass('web')).toEqual({
      entries: [],
      locked: ['work'],
    });
    await expect(
      harness.backend.unlockKeepass('work', 'master'),
    ).rejects.toThrow('Wrong master password.');
    await harness.backend.unlockKeepass('work', 'renewed');
    expect((await harness.backend.findKeepass('web')).entries).toHaveLength(2);
  });
});

describe('connecting with a KeePass reference', () => {
  let ssh: Awaited<ReturnType<typeof startFakeSshServer>>;
  beforeAll(async () => {
    ssh = await startFakeSshServer({ password: 'hunter2' });
  });
  afterAll(() => ssh.stop());
  afterEach(() => {
    ssh.users.length = 0;
  });

  const file = (name: string) => path.join(harness.home, '.ssh', name);

  /** A Managed host `box` in `folder` that logs in as `user` with the password of the KeePass entry `entry`, if any. */
  const managed = (entry: string | undefined, user: string, folder = '') =>
    writeBox(harness.home, {
      port: ssh.port,
      user,
      sidecar: {
        folders: folder ? [folder] : [],
        hosts: {
          box: {
            ...(folder && { folder }),
            ...(entry && {
              credential: { provider: 'keepass', entry, kind: 'password' },
            }),
          },
        },
      },
    });
  const asked = (tab: TabId) => harness.asked(tab);
  const dropped = (tab: TabId) => harness.dropped(tab);
  const loggedIn = (tab: TabId) =>
    eventually(() => expect(harness.output(tab)).toContain('$ '));
  const unlockAsk = (reason: string) => ({
    alias: 'box',
    title: 'Unlock work',
    prompts: [{ prompt: 'Master password', echo: false }],
    reason,
  });
  const locked = 'KeePass database `work` is locked.';

  it('asks for the master password on the first connect only, and asks again after a wrong one', async () => {
    const { ids } = await start();
    await managed(`work/${ids.prod}`, 'bob');
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(asked(tab)).toEqual([unlockAsk(locked)]));
    await harness.backend.answerSecret(tab, ['guess'], false);
    await eventually(() =>
      expect(asked(tab).at(-1)).toEqual(unlockAsk('Wrong master password.')),
    );
    await harness.backend.answerSecret(tab, ['master'], false);
    await loggedIn(tab);
    expect(asked(tab)).toHaveLength(2);
    expect(ssh.users.at(-1)).toBe('bob');

    const again = await harness.backend.openSsh('box');
    await loggedIn(again);
    expect(asked(again)).toEqual([]);
  });

  it('treats a cancelled unlock as a failed read and asks for the password', async () => {
    const { ids } = await start();
    await managed(`work/${ids.prod}`, 'bob');
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(asked(tab)).toHaveLength(1));
    await harness.backend.answerSecret(tab, null, false);
    await eventually(() =>
      expect(asked(tab).at(-1)).toEqual({
        alias: 'box',
        title: 'Password for bob@127.0.0.1',
        prompts: [{ prompt: 'Password', echo: false }],
        reason: "KeePass database `work` wasn't unlocked.",
        save: 'same',
      }),
    );
  });

  it("asks for the password where the database isn't set up", async () => {
    await start();
    await managed('home/' + '0'.repeat(32), 'bob');
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(asked(tab)).toEqual([
        {
          alias: 'box',
          title: 'Password for bob@127.0.0.1',
          prompts: [{ prompt: 'Password', echo: false }],
          reason: "KeePass database `home` isn't set up on this machine.",
          save: 'same',
        },
      ]),
    );
  });

  it('answers a database that needs a key file as it answers a wrong master password, like other KeePass clients', async () => {
    const { ids } = await start({ keyFile: true });
    await managed(`work/${ids.prod}`, 'bob');
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(asked(tab)).toEqual([unlockAsk(locked)]));
    await harness.backend.answerSecret(tab, ['master'], false);
    await eventually(() =>
      expect(asked(tab).at(-1)).toEqual(unlockAsk('Wrong master password.')),
    );
    await expect(
      harness.backend.unlockKeepass('work', 'master'),
    ).rejects.toThrow('Wrong master password.');
  });

  it("blocks the connect when the entry's username differs from User, before any login", async () => {
    const { ids } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    await managed(`work/${ids.prod}`, 'alice');
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(dropped(tab)).toEqual([
        {
          type: 'dropped',
          tab,
          reason: 'KeePass entry says bob, this Saved session says alice.',
          user: 'bob',
        },
      ]),
    );
    expect(ssh.users).toEqual([]);
  });

  it('skips the username check for an entry with no username', async () => {
    const { ids } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    await managed(`work/${ids.shared}`, 'alice');
    const tab = await harness.backend.openSsh('box');
    // The entry's password is wrong for this server: the login runs and the server rejects it.
    await eventually(() => expect(ssh.users).toContain('alice'));
    await eventually(() =>
      expect(asked(tab).at(-1)).toMatchObject({
        reason: 'The saved password was rejected.',
        save: 'update',
      }),
    );
  });

  it('keeps the old password in history when a rejected one is replaced, and keeps edits made elsewhere', async () => {
    const { file: db, ids } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    await managed(`work/${ids.prod}`, 'bob');
    await editElsewhere(db, (d) => {
      entryNamed(d, 'web prod').fields.set(
        'Password',
        ProtectedValue.fromString('old-pass'),
      );
    });
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(asked(tab).at(-1)).toMatchObject({
        reason: 'The saved password was rejected.',
        save: 'update',
      }),
    );
    await editElsewhere(db, (d) => {
      entryNamed(d, 'shared root').fields.set('Title', 'renamed elsewhere');
    });
    await harness.backend.answerSecret(tab, ['hunter2'], true);
    await loggedIn(tab);
    await eventually(async () => {
      const saved = await loadFile(db);
      const entry = entryNamed(saved, 'web prod');
      expect(passwordOf(entry)).toBe('hunter2');
      expect(entry.history.map(passwordOf)).toEqual(['old-pass']);
      expect(entryNamed(saved, 'renamed elsewhere')).toBeDefined();
    });
    expect(await readdir(harness.home)).not.toContainEqual(
      expect.stringMatching(/\.tmp$/),
    );
  });

  it('saves a typed password to a new entry in the picked group, titled with the alias', async () => {
    const { file: db } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    await managed(undefined, 'bob', 'Servers');
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(asked(tab).at(-1)).toMatchObject({
        title: 'Password for bob@127.0.0.1',
        save: 'new',
        folder: 'Servers',
      }),
    );
    await harness.backend.answerSecret(tab, ['hunter2'], {
      database: 'work',
      group: 'Servers/Prod',
    });
    await loggedIn(tab);
    await eventually(async () => {
      const entry = entryNamed(await loadFile(db), 'box');
      expect(entry.parentGroup?.name).toBe('Prod');
      expect(entry.fields.get('UserName')).toBe('bob');
      expect(entry.fields.get('URL')).toBe('ssh://127.0.0.1');
      expect(passwordOf(entry)).toBe('hunter2');
      const saved = JSON.parse(await readFile(file('slop-term.json'), 'utf8'));
      expect(saved.hosts.box.credential).toEqual({
        provider: 'keepass',
        entry: `work/${Buffer.from(entry.uuid.id, 'base64').toString('hex')}`,
        kind: 'password',
      });
    });
    expect((await harness.backend.settings()).keepassLastGroup).toEqual({
      database: 'work',
      group: 'Servers/Prod',
    });
  });

  it('creates the entry for a secret set in the dialog, with the form values', async () => {
    const { file: db } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    const tree = await harness.backend.saveSession(
      {
        alias: 'newbox',
        folder: '',
        hostname: 'new.example.org',
        port: '',
        user: 'bob',
        identityFile: '',
        options: [],
      },
      undefined,
      {
        set: {
          kind: 'password',
          secret: 's3cret',
          keepass: { database: 'work', group: 'Servers' },
        },
      },
    );
    const entry = entryNamed(await loadFile(db), 'newbox');
    expect(entry.parentGroup?.name).toBe('Servers');
    expect(entry.fields.get('UserName')).toBe('bob');
    expect(entry.fields.get('URL')).toBe('ssh://new.example.org');
    expect(passwordOf(entry)).toBe('s3cret');
    expect(tree.sessions[0].credential).toEqual({
      provider: 'keepass',
      entry: `work/${Buffer.from(entry.uuid.id, 'base64').toString('hex')}`,
      kind: 'password',
    });
  });

  it('keeps both entries when two sessions save to one database at once', async () => {
    const { file: db } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    const form = (alias: string) => ({
      alias,
      folder: '',
      hostname: `${alias}.example.org`,
      port: '',
      user: 'bob',
      identityFile: '',
      options: [],
    });
    const set = {
      set: {
        kind: 'password' as const,
        secret: 's3cret',
        keepass: { database: 'work', group: '' },
      },
    };
    await Promise.all([
      harness.backend.saveSession(form('one'), undefined, set),
      harness.backend.saveSession(form('two'), undefined, set),
    ]);
    const saved = await loadFile(db);
    expect(entryNamed(saved, 'one')).toBeDefined();
    expect(entryNamed(saved, 'two')).toBeDefined();
  });

  describe('deleting the last session that uses an entry', () => {
    const deleteBox = async (ids: { prod: string }) => {
      await managed(`work/${ids.prod}`, 'bob');
      const { read } = await harness.backend.getSession('box');
      await harness.backend.deleteSession('box', read, true);
    };

    it('moves the entry to the Recycle Bin', async () => {
      const { file: db, ids } = await start();
      await harness.backend.unlockKeepass('work', 'master');
      await deleteBox(ids);
      const entry = entryNamed(await loadFile(db), 'web prod');
      expect(entry.parentGroup?.name).toBe('Recycle Bin');
    });

    it('removes the entry from a database without a Recycle Bin', async () => {
      const { file: db, ids } = await start({ recycleBin: false });
      await harness.backend.unlockKeepass('work', 'master');
      await deleteBox(ids);
      const titles = [...(await loadFile(db)).getDefaultGroup().allEntries()];
      expect(titles.map((e) => e.fields.get('Title'))).not.toContain(
        'web prod',
      );
    });

    it('keeps the entry when its database is locked', async () => {
      const { file: db, ids } = await start();
      await deleteBox(ids);
      const entry = entryNamed(await loadFile(db), 'web prod');
      expect(entry.parentGroup?.name).toBe('Prod');
    });
  });

  it('locks on a simulated sleep and asks again on the next read', async () => {
    const { ids } = await start();
    await harness.backend.unlockKeepass('work', 'master');
    await managed(`work/${ids.prod}`, 'bob');
    await harness.backend.lockKeepass();
    expect(await harness.backend.keepassDatabases()).toEqual([
      { name: 'work', locked: true, groups: [] },
    ]);
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(asked(tab)).toEqual([unlockAsk(locked)]));
  });
});
