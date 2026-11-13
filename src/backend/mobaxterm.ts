import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ImportRow, SessionColour, SessionForm } from '../shared/ipc.ts';
import {
  importAliasProblem,
  joinFolder,
  nameOf,
  parentOf,
  slugify,
} from '../shared/session-rules.ts';

/** The folder of a running MobaXterm, where the portable edition keeps its ini. */
async function runningFolder() {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-Process MobaXterm* -ErrorAction SilentlyContinue | Select-Object -First 1).Path',
    ]);
    return stdout.trim() ? path.dirname(stdout.trim()) : undefined;
  } catch {
    return undefined;
  }
}

/** The installer edition keeps its ini in AppData or Documents, the portable one next to the executable. */
export async function findMobaxterm() {
  // ponytail: a portable copy that isn't running and isn't under Program Files is picked by hand.
  const inMobaxterm = [
    process.env.APPDATA,
    path.join(homedir(), 'Documents'),
  ].flatMap((f) => (f ? [path.join(f, 'MobaXterm')] : []));
  const files = [
    ...inMobaxterm,
    await runningFolder(),
    ...['ProgramFiles(x86)', 'ProgramFiles'].flatMap((v) =>
      process.env[v] ? [path.join(process.env[v], 'Mobatek', 'MobaXterm')] : [],
    ),
  ].flatMap((f) => (f ? [path.join(f, 'MobaXterm.ini')] : []));
  return files.find((file) => existsSync(file));
}

const unescape = (text: string) =>
  text
    .replaceAll('__DIEZE__', '#')
    .replaceAll('__PTVIRG__', ';')
    .replaceAll('__DBLQUO__', '"')
    .replaceAll('__PIPE__', '|')
    .trim();

/** Each session line of the `[Bookmarks*]` sections, with its folder from `SubRep`. */
function sessionLines(text: string) {
  const found: { folder: string; name: string; value: string }[] = [];
  let inBookmarks = false;
  let folder = '';
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\[(.*)\]\s*$/);
    if (section) {
      inBookmarks = /^Bookmarks(_\d+)?$/.test(section[1]);
      folder = '';
      continue;
    }
    const eq = line.indexOf('=');
    if (!inBookmarks || eq < 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (key === 'SubRep')
      folder = value
        .split('\\')
        .map((name) => name.trim())
        .filter(Boolean)
        .join('/');
    else if (key !== 'ImgNum') found.push({ folder, name: key, value });
  }
  return found;
}

/** A path with `/` between its names, and `~/...` for one in the home folder, which Windows spells in any case. */
function tilde(file: string) {
  const home = homedir().replaceAll('\\', '/');
  const key = file.replaceAll('\\', '/');
  return key.toLowerCase().startsWith(`${home.toLowerCase()}/`)
    ? `~${key.slice(home.length)}`
    : key;
}

/** The key path as OpenSSH config reads it on every system, or why it can't come across. */
function keyPath(raw: string, file: string) {
  if (!raw) return { path: '' };
  const drive = /^[A-Za-z]:/.exec(file)?.[0] ?? '';
  const key = tilde(
    raw.replace(/^_ProfileDir_/, '~').replace(/_CurrentDrive_:?/g, drive),
  );
  if (/\.ppk$/i.test(key))
    return {
      path: '',
      problem: `Uses a PuTTY key. Convert it once with PuTTYgen (Conversions, Export OpenSSH key), save it as ~/.ssh/${path.posix.basename(key, path.posix.extname(key))}, then pick it in the Saved session.`,
    };
  return key.startsWith('~/')
    ? { path: key }
    : { path: key, problem: `The key ${key} won't work on macOS.` };
}

// Pure hues: MobaXterm's picker offers the Windows basic colours, which these match exactly.
const hues: [SessionColour, number[]][] = [
  ['red', [255, 0, 0]],
  ['orange', [255, 128, 0]],
  ['yellow', [255, 255, 0]],
  ['green', [0, 192, 0]],
  ['blue', [0, 0, 255]],
  ['purple', [128, 0, 128]],
  ['pink', [255, 0, 255]],
  ['grey', [128, 128, 128]],
];

/** A tab colour is a Windows COLORREF, `0x00BBGGRR`; `-1` is none. A colour without hue (black, white, silver) reads as grey. */
function colourOf(raw: string): SessionColour | undefined {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 0) return undefined;
  const rgb = [n & 255, (n >> 8) & 255, (n >> 16) & 255];
  if (Math.max(...rgb) - Math.min(...rgb) < 48) return 'grey';
  const distance = (c: number[]) =>
    c.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
  return hues.reduce((a, b) => (distance(b[1]) < distance(a[1]) ? b : a))[0];
}

// ponytail: the code page comes from the registry once per preview; a missing or unknown one decodes as Windows-1252.
async function decoder() {
  if (process.platform !== 'win32') return new TextDecoder('windows-1252');
  try {
    const { stdout } = await promisify(execFile)('reg', [
      'query',
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage',
      '/v',
      'ACP',
    ]);
    const acp = /ACP\s+REG_SZ\s+(\d+)/.exec(stdout)?.[1] ?? '';
    const label =
      {
        '932': 'shift_jis',
        '936': 'gbk',
        '949': 'euc-kr',
        '950': 'big5',
        '65001': 'utf-8',
      }[acp] ?? `windows-${acp}`;
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

/** A host already in the Managed config or `~/.ssh/config`, as its block writes it. */
export type ExistingHost = Pick<
  SessionForm,
  'alias' | 'hostname' | 'port' | 'user' | 'identityFile'
>;

const compared = (h: ExistingHost) => ({
  host: (h.hostname || h.alias).toLowerCase(),
  port: h.port || '22',
  user: h.user,
  key: tilde(h.identityFile),
});

/** "Already in SSH config" for a host whose four fields all match, else what differs from the first host with the same name. */
function hostMatch(row: ImportRow, hosts: ExistingHost[]) {
  const mine = compared(row);
  const same = hosts.filter((h) => compared(h).host === mine.host);
  const identical = same.find((h) =>
    (['port', 'user', 'key'] as const).every((k) => compared(h)[k] === mine[k]),
  );
  if (identical)
    return {
      identical: true,
      problem: `Already in SSH config as ${identical.alias}.`,
    };
  if (!same[0]) return {};
  const theirs = compared(same[0]);
  const shown = (v: string) => v || '(none)';
  const diffs = (['port', 'user', 'key'] as const)
    .filter((k) => theirs[k] !== mine[k])
    .map((k) => `${k} ${shown(mine[k])} here and ${shown(theirs[k])} there`);
  return {
    problem: `Same host as ${same[0].alias}, with ${diffs.join(', ')}.`,
  };
}

/** The folder path with each level that already exists ignoring case spelled as it is. */
function existingFolder(folder: string, folders: Set<string>) {
  let out = '';
  for (const name of folder.split('/').filter(Boolean)) {
    const next = joinFolder(out, name);
    out =
      [...folders].find(
        (f) =>
          parentOf(f) === out && nameOf(f).toLowerCase() === name.toLowerCase(),
      ) ?? next;
  }
  return out;
}

/** `taken` lists every alias and Local shell session name; `folders` every folder the tree shows. */
export async function previewRows(
  file: string,
  {
    taken,
    hosts,
    folders,
  }: {
    taken: string[];
    hosts: ExistingHost[];
    folders: Set<string>;
  },
): Promise<ImportRow[]> {
  const text = (await decoder()).decode(await readFile(file));
  const ticked: string[] = [];
  return sessionLines(text).map((line) => {
    const row = rowOf(line, file);
    row.folder = existingFolder(row.folder, folders);
    const match = row.kind === 'ssh' ? hostMatch(row, hosts) : {};
    if (match.problem) row.problems.push(match.problem);
    row.ticked =
      row.ticked &&
      !match.identical &&
      !importAliasProblem(row.alias, taken, ticked);
    if (row.ticked) ticked.push(row.alias);
    return row;
  });
}

// Positions in the `#` blocks of a session line and in its `%` connection block, from Sessionator.
const block = { connection: 2, comment: 5, colour: 6 };
const at = { type: 0, host: 1, port: 2, user: 3, command: 7, key: 14 };
const jumpFields = [8, 9, 10, 15];

function rowOf(
  { folder, name, value }: { folder: string; name: string; value: string },
  file: string,
): ImportRow {
  const blocks = value.split('#');
  const connection = (blocks[block.connection] ?? '').split('%');
  const field = (i: number) => unescape(connection[i] ?? '');
  const type = field(at.type);
  const kind = type === '0' ? 'ssh' : type === '14' ? 'wsl' : 'skipped';
  const ssh = kind === 'ssh';
  const key = ssh ? keyPath(field(at.key), file) : { path: '' };
  const command = field(at.command);
  const problems = [
    kind === 'wsl' && 'Opens your default WSL distro.',
    kind === 'skipped' &&
      `${typeNames[type] ?? 'These'} sessions are not imported.`,
    ssh && jumpFields.some(field) && 'Uses a jump host, not imported.',
    ssh && command && `The login command ${command} is not imported.`,
    key.problem,
  ].filter((p): p is string => !!p);
  const colour = colourOf(blocks[block.colour]?.trim() ?? '');
  return {
    name,
    kind,
    alias: slugify(name),
    folder,
    hostname: ssh ? field(at.host) : '',
    port: ssh ? field(at.port) || '22' : '',
    user: ssh ? field(at.user) : '',
    identityFile: key.path,
    comment: unescape(blocks[block.comment] ?? ''),
    ...(colour && { colour }),
    ticked: kind !== 'skipped',
    problems,
  };
}

// Sessionator's codes. Telnet, serial and the rest have no name here and read as "These sessions".
const typeNames: Record<string, string> = {
  '4': 'RDP',
  '5': 'VNC',
  '7': 'SFTP',
  '11': 'Browser',
};
