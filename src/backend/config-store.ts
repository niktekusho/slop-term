import {
  globSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import SSHConfig, { LineType, type Line } from 'ssh-config';
import type { Backend, BackendEvent, SessionTree } from '../shared/ipc.ts';

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

const tildePath = (file: string) =>
  file.startsWith(homedir()) ? '~' + file.slice(homedir().length) : file;

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

type Sidecar = {
  folders: string[];
  folderOf: (alias: string) => string | undefined;
};

// The file is synced and edited by hand, so every field is checked before use.
function readSidecar(file: string, warnings: Set<string>): Sidecar {
  let raw: { folders?: unknown; hosts?: Record<string, { folder?: unknown }> } =
    {};
  try {
    raw = JSON.parse(readText(file) ?? '{}') ?? {};
  } catch (e) {
    warnings.add(
      e instanceof SyntaxError
        ? `slop-term.json is not valid JSON: ${e.message}`
        : cantRead(file, e),
    );
  }
  const folders = Array.isArray(raw.folders) ? raw.folders : [];
  return {
    folders: folders.filter((f) => typeof f === 'string'),
    folderOf(alias) {
      const folder = Object.hasOwn(raw.hosts ?? {}, alias)
        ? raw.hosts?.[alias]?.folder
        : undefined;
      return typeof folder === 'string' && folder ? folder : undefined;
    },
  };
}

export function createConfigStore(
  emit: (event: BackendEvent) => void,
): Pick<Backend, 'getTree'> {
  const dir = path.join(homedir(), '.ssh');
  const managed = path.join(dir, 'slop-term.conf');
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
        return folder ? { alias, folder } : { alias };
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

  return {
    async getTree() {
      return load();
    },
  };
}
