import type {
  CredentialReference,
  SessionTree,
  Shell,
  ShellKind,
} from './ipc.ts';

/** An unsaved Tab's shell, or a Local shell session. An empty or missing field means unset. */
type Launch = {
  kind: ShellKind;
  distro?: string;
  startFolder?: string;
  command?: string;
};

/**
 * The arguments and working folder a local shell starts with. WSL takes its start folder as `--cd`.
 * A string goes on the command line as it is: cmd and WSL read the command after `/c` or `--` raw, so quoting would change it.
 */
export function launchLine({ kind, distro, startFolder, command }: Launch): {
  args: string[] | string;
  cwd: string;
} {
  const cwd = startFolder || '~';
  switch (kind) {
    case 'wsl':
      return {
        args: [
          ...(distro ? [`-d ${distro}`] : []),
          `--cd ${/\s/.test(cwd) ? `"${cwd}"` : cwd}`,
          ...(command ? [`-- ${command}`] : []),
        ].join(' '),
        cwd: '~',
      };
    case 'cmd':
      return { args: command ? `/c ${command}` : '', cwd };
    case 'pwsh':
    case 'powershell':
      return { args: command ? ['-Command', command] : [], cwd };
    case 'zsh':
    case 'bash':
      return { args: command ? ['-lc', command] : ['-l'], cwd };
  }
}

/** Whether this machine lacks the session's shell or WSL distro. Windows PowerShell comes with every Windows, as cmd does. */
export function shellMissing(
  { kind, distro }: { kind: ShellKind; distro: string },
  shells: Shell[],
) {
  if (kind === 'wsl')
    return !shells.some(
      (s) => s.kind === 'wsl' && (!distro || s.distro === distro),
    );
  const needs = kind === 'powershell' ? 'cmd' : kind;
  return !shells.some((s) => s.kind === needs);
}

/** Whether two references point at the same saved secret. */
export const sameEntry = (a?: CredentialReference, b?: CredentialReference) =>
  !!a && !!b && a.provider === b.provider && a.entry === b.entry;

/** Every name an alias or Local shell session name must not repeat. */
export const takenNames = (tree: SessionTree) => [
  ...tree.sessions.map((s) => s.alias),
  ...tree.handWritten,
  ...tree.localShells.map((s) => s.name),
];

/** The alias rules the dialog shows while typing and the back end checks on save. `taken` leaves out the session's own alias. */
export function aliasProblem(alias: string, taken: string[]) {
  if (!alias) return 'Type an alias.';
  if (alias !== alias.toLowerCase()) return 'Use lowercase letters.';
  const bad = alias.match(/[\s*?!,]/)?.[0];
  if (bad) return `No ${/\s/.test(bad) ? 'spaces' : bad} in an alias.`;
  if (taken.some((t) => t.toLowerCase() === alias))
    return `${alias} is already taken.`;
  return undefined;
}

/** The folder name rules the inline edit shows and the back end checks. `siblings` leaves out the folder's own name. */
export function folderProblem(name: string, siblings: string[]) {
  const trimmed = name.trim();
  if (!trimmed) return 'Type a name.';
  if (trimmed.includes('/')) return 'No / in a folder name.';
  if (siblings.some((s) => s.toLowerCase() === trimmed.toLowerCase()))
    return `${trimmed} is already here.`;
  return undefined;
}

// A folder path joins its names with `/`; '' is the top level.
export const parentOf = (folder: string) =>
  folder.slice(0, Math.max(folder.lastIndexOf('/'), 0));
export const nameOf = (folder: string) =>
  folder.slice(folder.lastIndexOf('/') + 1);
export const joinFolder = (parent: string, name: string) =>
  parent ? `${parent}/${name}` : name;

/** Whether a folder path is `folder` itself or one of its subfolders. */
export const inFolder = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

/** TPM entries belong to the team's password manager: the app deletes only secrets it saved itself. */
export const deletable = (ref: CredentialReference) =>
  ref.provider === 'keychain';

/** `ssh -G` sees every line of a block, so these three in an option row would hide behind the command line's values. */
const commandLineKeys = new Set(['hostname', 'port', 'user']);

export const optionKey = (line: string) =>
  line.match(/^\s*([A-Za-z]+)/)?.[1].toLowerCase();

/** Why an `-o` row can't be saved. An empty row is skipped, not a problem. */
export function optionProblem(line: string) {
  if (!line.trim()) return undefined;
  if (!/^\s*[A-Za-z]+(\s*=\s*|\s+)\S/.test(line))
    return 'Write it as Key value.';
  const key = optionKey(line)!;
  if (key === 'host' || key === 'match')
    return `${key === 'host' ? 'Host' : 'Match'} starts a new block, so it can't be an option.`;
  if (commandLineKeys.has(key)) return 'Set this in the command line above.';
  if ((line.match(/"/g)?.length ?? 0) % 2) return 'A quote is not closed.';
  return undefined;
}

/** A warning only: the line saves, and a Tab of the session fails to connect. */
export const jumpWarning = (line: string) =>
  /^\s*proxy(jump|command)(\s*=\s*|\s+)(?!none\s*$)\S/i.test(line)
    ? "slop-term v1 can't connect through a jump host: Tabs of this session fail. Typing ssh in a shell still works."
    : undefined;
