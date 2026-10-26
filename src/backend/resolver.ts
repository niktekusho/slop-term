import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export type Resolved = Awaited<ReturnType<typeof resolve>>;

const expandTilde = (file: string) =>
  file.startsWith('~') ? path.join(homedir(), file.slice(1)) : file;

/**
 * Runs `ssh -G` with the `ssh` on PATH. OpenSSH finds `~` from the account, not from HOME:
 * `-F` makes it read the config the Session tree shows.
 */
export async function resolve(
  alias: string,
  config = path.join(homedir(), '.ssh', 'config'),
) {
  const { stdout } = await promisify(execFile)('ssh', [
    '-F',
    config,
    '-G',
    '--',
    alias,
  ]);
  const values = new Map<string, string[]>();
  for (const line of stdout.split(/\r?\n/)) {
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const key = line.slice(0, space);
    values.set(key, [...(values.get(key) ?? []), line.slice(space + 1)]);
  }
  const one = (key: string) => values.get(key)?.[0];
  const jump = (key: string) => (one(key) ?? 'none') !== 'none';
  return {
    hostname: one('hostname')!,
    port: Number(one('port')),
    user: one('user')!,
    identityFiles: (values.get('identityfile') ?? []).map(expandTilde),
    knownHostsFiles: (one('userknownhostsfile') ?? '')
      .split(' ')
      .filter(Boolean)
      .map(expandTilde),
    hostKeyAlias: one('hostkeyalias'),
    // `ssh -G` prints `no` as `false` and `yes` as `true`.
    saveUnknownKeys: ['accept-new', 'false', 'no', 'off'].includes(
      one('stricthostkeychecking') ?? '',
    ),
    hashKnownHosts: one('hashknownhosts') === 'yes',
    jumpHost: jump('proxyjump') || jump('proxycommand'),
  };
}
