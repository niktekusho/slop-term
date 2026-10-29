import type { CredentialReference } from './ipc.ts';

/** Whether two references point at the same saved secret. */
export const sameEntry = (a?: CredentialReference, b?: CredentialReference) =>
  !!a && !!b && a.provider === b.provider && a.entry === b.entry;

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
