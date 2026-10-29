import {
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import SSHConfig, { LineType, type Directive, type Line } from 'ssh-config';
import type {
  Backend,
  BackendEvent,
  CredentialReference,
  SessionForm,
  SessionTree,
} from '../shared/ipc.ts';
import {
  aliasProblem,
  optionProblem,
  sameEntry,
} from '../shared/session-rules.ts';
import { accountName, newKeychainEntry, provider } from './credentials.ts';
import { resolve, type Resolved } from './resolver.ts';

const includeLine = 'Include ~/.ssh/slop-term.conf';
const managedInclude =
  /^[ \t]*include(?:[ \t]*=[ \t]*|[ \t]+)"?(?:~\/\.ssh\/)?slop-term\.conf"?[ \t]*$/i;
const sectionStart = /^[ \t]*(?:host|match)(?:[ \t=]|$)/i;
const watched = new Set(['config', 'slop-term.conf', 'slop-term.json']);

function readText(file: string) {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

// OpenSSH scopes an Include that follows a Host or Match line to that block: only one above the first block counts.
function includesManaged(text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (sectionStart.test(line)) return false;
    if (managedInclude.test(line)) return true;
  }
  return false;
}

function addInclude(file: string) {
  const text = readText(file) ?? '';
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = text.slice(bom.length);
  if (includesManaged(body)) return;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(file, bom + includeLine + eol + body);
}

const words = (line: Line & { value?: unknown }) =>
  typeof line.value === 'string'
    ? [line.value]
    : ((line.value ?? []) as { val: string }[]).map((v) => v.val);

// `~/.ssh/config` on every system, as the user types it in OpenSSH config, so one synced config works on Windows and macOS.
const tildePath = (file: string) => {
  const inHome = path.relative(homedir(), file);
  return path.isAbsolute(file) &&
    !inHome.startsWith('..') &&
    !path.isAbsolute(inHome)
    ? `~/${inHome.replaceAll(path.sep, '/')}`
    : file;
};

const cantRead = (file: string, e: unknown) =>
  `Can't read ${tildePath(file)}: ${(e as Error).message}`;

type Scan = { hosts: Set<string>; warnings: Set<string>; managed: string };

// `ssh-config` doesn't follow Include. Relative paths start in ~/.ssh, as for any user config.
function scanFile(file: string, scan: Scan, depth: number) {
  let lines;
  try {
    const text = readText(file);
    if (text === undefined) return;
    lines = SSHConfig.parse(text);
  } catch (e) {
    scan.warnings.add(cantRead(file, e));
    return;
  }
  scanLines(lines, file, scan, depth);
}

function scanLines(lines: Line[], file: string, scan: Scan, depth: number) {
  for (const line of lines) {
    if (line.type !== LineType.DIRECTIVE) continue;
    const param = line.param.toLowerCase();
    if (param === 'match') {
      scan.warnings.add(`Match blocks in ${tildePath(file)} are ignored`);
      continue;
    }
    if (param === 'host')
      for (const alias of words(line))
        if (!/[*?!]/.test(alias)) scan.hosts.add(alias);
    // OpenSSH stops at 16 levels, which also ends an Include loop.
    if (param === 'include' && depth < 16)
      for (const pattern of words(line)) {
        const full = path.resolve(
          path.join(homedir(), '.ssh'),
          pattern.replace(/^~(?=$|[\\/])/, homedir()),
        );
        for (const match of globSync(full).sort())
          if (match !== scan.managed) scanFile(match, scan, depth + 1);
      }
    if ('config' in line) scanLines(line.config, file, scan, depth);
  }
}

type RawSidecar = {
  folders?: unknown;
  hosts?: Record<string, Record<string, unknown>>;
};

const ssh = (name: string) => path.join(homedir(), '.ssh', name);

/** Throws a message the user can read for a file that is unreadable or not JSON. */
function parseSidecar(file: string): RawSidecar {
  try {
    return JSON.parse(readText(file) ?? '{}') ?? {};
  } catch (e) {
    throw new Error(
      e instanceof SyntaxError
        ? `slop-term.json is not valid JSON: ${e.message}`
        : cantRead(file, e),
    );
  }
}

const sidecarEntry = (raw: RawSidecar, alias: string) =>
  Object.hasOwn(raw.hosts ?? {}, alias) ? raw.hosts?.[alias] : undefined;

type Sidecar = {
  folders: string[];
  folderOf: (alias: string) => string | undefined;
  credentialOf: (alias: string) => CredentialReference | undefined;
};

// The file is synced and edited by hand, so every field is checked before use.
function readSidecar(file: string, warnings: Set<string>): Sidecar {
  let raw: RawSidecar = {};
  try {
    raw = parseSidecar(file);
  } catch (e) {
    warnings.add((e as Error).message);
  }
  const folders = Array.isArray(raw.folders) ? raw.folders : [];
  return {
    folders: folders.filter((f) => typeof f === 'string'),
    folderOf(alias) {
      const folder = sidecarEntry(raw, alias)?.folder;
      return typeof folder === 'string' && folder ? folder : undefined;
    },
    credentialOf: (alias) => credentialOf(sidecarEntry(raw, alias)),
  };
}

function credentialOf(entry: Record<string, unknown> | undefined) {
  const c = entry?.credential as Record<string, unknown> | undefined;
  return typeof c?.provider === 'string' &&
    typeof c.entry === 'string' &&
    (c.kind === 'password' || c.kind === 'passphrase')
    ? (c as CredentialReference)
    : undefined;
}

/**
 * The Credential reference of an SSH Saved session, and its Sidecar entry as read now, which a later save checks for conflicts.
 * Undefined for a Hand-written host, which carries no Sidecar data.
 */
export function savedSession(alias: string) {
  if (!hostsIn(ssh('slop-term.conf')).has(alias)) return undefined;
  let raw: RawSidecar = {};
  try {
    raw = parseSidecar(ssh('slop-term.json'));
  } catch {
    // The tree shows the warning; a save re-reads the file and reports the reason.
  }
  const entry = sidecarEntry(raw, alias);
  return { credential: credentialOf(entry), read: JSON.stringify(entry) };
}

/** Whether `alias` is still a Saved session or a Hand-written host. */
export function hostExists(alias: string) {
  return hostsIn(ssh('slop-term.conf'), ssh('config')).has(alias);
}

function hostsIn(...files: string[]) {
  const managed = ssh('slop-term.conf');
  const scan: Scan = { hosts: new Set(), warnings: new Set(), managed };
  for (const file of files) scanFile(file, scan, 0);
  return scan.hosts;
}

/** Re-reads the Sidecar file and stops with a conflict if the session's entry changed since `read`. */
export function saveCredential(
  alias: string,
  credential: CredentialReference,
  read: string | undefined,
) {
  const file = ssh('slop-term.json');
  const raw = parseSidecar(file);
  if (JSON.stringify(sidecarEntry(raw, alias)) !== read)
    throw new Error(`slop-term.json changed for ${alias} since it was read.`);
  raw.hosts = { ...raw.hosts, [alias]: { ...raw.hosts?.[alias], credential } };
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
}

// The store edits the Managed config as text lines, so every line a change doesn't touch stays byte for byte.
const isDirective = (line: string) => !/^\s*(#|$)/.test(line);
const hostLine = /^[ \t]*host(?:[ \t=]|$)/i;
const parseLine = (line: string) => SSHConfig.parse(line)[0] as Directive;

/** One directive as `Key value`, quoted the way OpenSSH reads it back. */
const keyValue = (d: Directive) => {
  const one = new SSHConfig();
  one.push({ ...d, separator: ' ', before: '', after: '' });
  return SSHConfig.stringify(one);
};

const directiveLine = (param: string, value: string) =>
  keyValue({
    type: LineType.DIRECTIVE,
    param,
    separator: ' ',
    value,
    before: '',
    after: '',
  });

/** The lines of `alias`'s Host block up to its last directive: a comment under it belongs to the next block. */
function findBlock(lines: string[], alias: string) {
  const start = lines.findIndex(
    (line) => hostLine.test(line) && words(parseLine(line)).includes(alias),
  );
  if (start < 0) return undefined;
  if (words(parseLine(lines[start])).length > 1)
    throw new Error(
      `Edit ${alias} in slop-term.conf by hand: its Host line names more than one host.`,
    );
  let end = start + 1;
  for (let i = start + 1; i < lines.length && !sectionStart.test(lines[i]); i++)
    if (isDirective(lines[i])) end = i + 1;
  return { start, end };
}

const fieldParams = {
  hostname: 'HostName',
  port: 'Port',
  user: 'User',
  identityFile: 'IdentityFile',
} as const;
type Field = keyof typeof fieldParams;

// The first line of each command-line keyword fills its field. A second `IdentityFile` stays an option row.
function formOf(
  block: string[],
  alias: string,
  entry: Record<string, unknown> | undefined,
): SessionForm {
  const fields: Partial<Record<Field, string>> = {};
  const options: string[] = [];
  for (const line of block.slice(1).filter(isDirective)) {
    const d = parseLine(line);
    const field = (Object.keys(fieldParams) as Field[]).find(
      (f) => f.toLowerCase() === d.param.toLowerCase(),
    );
    if (field && fields[field] === undefined)
      fields[field] = words(d).join(' ');
    else options.push(keyValue(d));
  }
  const credential = credentialOf(entry);
  return {
    alias,
    folder: typeof entry?.folder === 'string' ? entry.folder : '',
    hostname: fields.hostname ?? '',
    port: fields.port ?? '',
    user: fields.user ?? '',
    identityFile: fields.identityFile ?? '',
    options,
    ...(credential && { credential }),
  };
}

export function blockLines(form: SessionForm) {
  const fields = (Object.keys(fieldParams) as Field[]).flatMap((f) => {
    const value = f === 'identityFile' ? tildePath(form[f]) : form[f];
    return value ? [directiveLine(fieldParams[f], value)] : [];
  });
  const options = form.options
    .filter((line) => line.trim())
    .map((line) => keyValue(parseLine(line.trim())));
  return [...fields, ...options];
}

const sameLine = (a: string, b: string) => {
  const key = (s: string) => s.replace(/^\S+/, (k) => k.toLowerCase());
  return key(a) === key(b);
};

/** A changed line is rewritten in place and a new one goes after the last directive, so comments keep their place. */
function mergeBlock(old: string[], alias: string, next: string[], eol: string) {
  const pending = next.map((text) => ({
    text,
    key: text.split(' ')[0].toLowerCase(),
    used: false,
  }));
  const out = [
    words(parseLine(old[0]))[0] === alias ? old[0] : `Host ${alias}${eol}`,
  ];
  let indent = '  ';
  for (const line of old.slice(1)) {
    if (!isDirective(line)) {
      out.push(line);
      continue;
    }
    indent = line.match(/^\s*/)![0];
    const d = parseLine(line);
    const match = pending.find(
      (p) => !p.used && p.key === d.param.toLowerCase(),
    );
    if (!match) continue;
    match.used = true;
    out.push(
      sameLine(keyValue(d), match.text) ? line : indent + match.text + eol,
    );
  }
  for (const p of pending) if (!p.used) out.push(indent + p.text + eol);
  return out;
}

// OpenSSH rejects the whole config over one bad line, which breaks `ssh` for every host.
export const sshError = (e: unknown) =>
  `ssh rejects these values: ${(e as { stderr?: string }).stderr?.trim() || (e as Error).message}`;

export function createConfigStore(
  emit: (event: BackendEvent) => void,
  onRename: (from: string, to: string) => void,
): Pick<
  Backend,
  'getTree' | 'getSession' | 'saveSession' | 'deleteSession' | 'sessionDefaults'
> {
  const dir = path.join(homedir(), '.ssh');
  const managed = ssh('slop-term.conf');
  const sidecarFile = ssh('slop-term.json');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  addInclude(path.join(dir, 'config'));

  const load = (): SessionTree => {
    const warnings = new Set<string>();
    const hostsIn = (file: string) => {
      const scan: Scan = { hosts: new Set(), warnings, managed };
      scanFile(file, scan, 0);
      return [...scan.hosts];
    };
    const sessions = hostsIn(managed);
    const handWritten = hostsIn(path.join(dir, 'config'));
    const sidecar = readSidecar(path.join(dir, 'slop-term.json'), warnings);
    return {
      folders: sidecar.folders,
      sessions: sessions.map((alias) => {
        const folder = sidecar.folderOf(alias);
        const credential = sidecar.credentialOf(alias);
        return {
          alias,
          ...(folder && { folder }),
          ...(credential && { credential }),
        };
      }),
      handWritten,
      warnings: [...warnings],
    };
  };

  // A watch on a file stops when a sync tool renames a new copy over it: the folder is watched instead.
  // ponytail: Include targets outside these three files don't reload the tree; watch every followed file if that bites.
  // The startup tree counts as sent, so the event for the include line write emits nothing.
  let last = JSON.stringify(load());
  watch(dir, (_event, name) => {
    if (name && !watched.has(name)) return;
    const tree = load();
    const json = JSON.stringify(tree);
    if (json === last) return;
    last = json;
    emit({ type: 'tree', tree });
  });

  // The UI takes the tree a save returns, so the watcher has nothing new to send for that write.
  const reload = () => {
    const tree = load();
    last = JSON.stringify(tree);
    return tree;
  };

  /** Throws on a Sidecar file that is not valid JSON, so a save never writes over it. */
  const current = (alias: string) => {
    const text = readText(managed) ?? '';
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const ended = text && !text.endsWith('\n') ? text + eol : text;
    const lines = ended.split(/(?<=\n)/).filter(Boolean);
    const block = findBlock(lines, alias);
    const raw = parseSidecar(sidecarFile);
    const entry = sidecarEntry(raw, alias);
    const read =
      block &&
      JSON.stringify([
        lines.slice(block.start, block.end).join(''),
        entry ?? null,
      ]);
    return { lines, eol, block, raw, entry, read };
  };

  const changed = (alias: string) =>
    new Error(
      `${alias} changed in slop-term.conf or slop-term.json since it was opened. Cancel and open it again.`,
    );

  const writeSidecar = (raw: RawSidecar) =>
    writeFileSync(sidecarFile, JSON.stringify(raw, null, 2) + '\n');

  // Only sessions in the tree count: an orphaned Sidecar entry's host is gone.
  async function dropSecret(ref: CredentialReference, raw: RawSidecar) {
    const users = [...hostsIn(managed)].filter((alias) =>
      sameEntry(credentialOf(sidecarEntry(raw, alias)), ref),
    );
    // ponytail: a failed delete leaves the secret in the keychain, where the user can still remove it.
    if (!users.length)
      await provider(ref)
        .delete(ref)
        .catch(() => {});
  }

  return {
    async getTree() {
      return load();
    },

    async getSession(alias) {
      const { lines, block, entry, read } = current(alias);
      if (!block || !read)
        throw new Error(`${alias} is not in slop-term.conf.`);
      return {
        ...formOf(lines.slice(block.start, block.end), alias, entry),
        read,
      };
    },

    async saveSession(form, edit, secret = {}) {
      const own = edit?.alias ?? form.alias;
      const taken = [...hostsIn(managed, path.join(dir, 'config'))].filter(
        (alias) => alias !== edit?.alias,
      );
      const problem =
        aliasProblem(form.alias, taken) ??
        form.options.map(optionProblem).find(Boolean);
      if (problem) throw new Error(problem);
      const next = blockLines(form);
      let r: Resolved;
      try {
        r = await resolve(form.alias, undefined, next);
      } catch (e) {
        throw new Error(sshError(e));
      }

      const plan = (credential?: CredentialReference) => {
        const now = current(own);
        if (edit ? now.read !== edit.read : now.block)
          throw edit ? changed(own) : new Error(`${own} is already taken.`);
        if (edit && form.alias !== own && findBlock(now.lines, form.alias))
          throw new Error(`${form.alias} is already taken.`);
        const block = now.block
          ? mergeBlock(
              now.lines.slice(now.block.start, now.block.end),
              form.alias,
              next,
              now.eol,
            )
          : [
              `Host ${form.alias}${now.eol}`,
              ...next.map((l) => `  ${l}${now.eol}`),
            ];
        const lines = [...now.lines];
        if (now.block)
          lines.splice(
            now.block.start,
            now.block.end - now.block.start,
            ...block,
          );
        else lines.push(...(lines.at(-1)?.trim() ? [now.eol] : []), ...block);

        // A create over an orphaned Sidecar entry keeps its other fields.
        const entry = JSON.parse(
          JSON.stringify({
            ...now.entry,
            folder: form.folder || undefined,
            credential,
          }),
        );
        const keep = Object.keys(entry).length > 0;
        let found = false;
        // A rename onto an orphaned entry's alias replaces that entry, which no longer has a host.
        const hosts = Object.entries(now.raw.hosts ?? {}).flatMap(([a, v]) => {
          if (a === form.alias && a !== own) return [];
          if (a !== own) return [[a, v]];
          found = true;
          return keep ? [[form.alias, entry]] : [];
        });
        if (!found && keep) hosts.push([form.alias, entry]);
        const raw =
          found || keep
            ? { ...now.raw, hosts: Object.fromEntries(hosts) }
            : undefined;
        return { text: lines.join(''), raw };
      };

      // The first plan fails before a secret is written. The second re-reads the files the secret write waited on.
      plan(form.credential);
      let credential = form.credential;
      if (secret.set) {
        const { kind, secret: value } = secret.set;
        const keyFile = form.identityFile || r.identityFiles[0] || 'key';
        const name =
          kind === 'password'
            ? accountName(r)
            : `passphrase-${path.basename(keyFile)}`;
        credential = {
          provider: 'keychain',
          entry: await newKeychainEntry(name),
          kind,
        };
        await provider(credential).write(credential, value);
      }
      const { text, raw } = plan(credential);
      writeFileSync(managed, text);
      if (raw) writeSidecar(raw);
      if (secret.drop)
        await dropSecret(secret.drop, raw ?? parseSidecar(sidecarFile));
      if (form.alias !== own) onRename(own, form.alias);
      return reload();
    },

    async deleteSession(alias, read, deleteSecret) {
      const now = current(alias);
      if (!now.block || now.read !== read) throw changed(alias);
      const { start, end } = now.block;
      const lines = [...now.lines];
      lines.splice(start, end - start);
      // The blank line that separated the block goes with it.
      if (
        lines[start]?.trim() === '' &&
        (start === 0 || !lines[start - 1].trim())
      )
        lines.splice(start, 1);
      writeFileSync(managed, lines.join(''));
      const raw = {
        ...now.raw,
        hosts: Object.fromEntries(
          Object.entries(now.raw.hosts ?? {}).filter(([a]) => a !== alias),
        ),
      };
      if (now.entry) writeSidecar(raw);
      const credential = credentialOf(now.entry);
      if (deleteSecret && credential) await dropSecret(credential, raw);
      return reload();
    },

    async sessionDefaults(alias, options) {
      // ponytail: a field cleared in an edit shows the value still in the file until Save. `-o` can't unset it.
      const r = await resolve(alias, undefined, options);
      const key = r.identityFiles.find((file) => existsSync(file));
      return {
        hostname: r.hostname,
        port: String(r.port),
        user: r.user,
        identityFile: key ? tildePath(key) : '',
      };
    },
  };
}
