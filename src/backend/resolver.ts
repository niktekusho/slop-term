import { execFile } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export type Resolved = Awaited<ReturnType<typeof resolve>>;

const expandTilde = (file: string) =>
  file.startsWith('~') ? path.join(homedir(), file.slice(1)) : file;

/**
 * Runs `ssh -G` with the `ssh` on PATH. OpenSSH finds `~` from the account, not from HOME.
 * `-F` would skip the system `ssh_config`, so it is passed only when HOME points elsewhere, as in tests.
 * Each of `options` is a `Key value` line passed as `-o`, which wins over the config files.
 */
export async function resolve(
  alias: string,
  config = homedir() === userInfo().homedir
    ? undefined
    : path.join(homedir(), '.ssh', 'config'),
  options: string[] = [],
) {
  const { stdout } = await promisify(execFile)('ssh', [
    ...(config ? ['-F', config] : []),
    ...options.flatMap((option) => ['-o', option]),
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
    // `ssh -G` prints 0 for an unset value.
    keepaliveSeconds: Number(one('serveraliveinterval')) || 15,
    keepaliveCount: Number(one('serveralivecountmax')) || 3,
    jumpHost: jump('proxyjump') || jump('proxycommand'),
  };
}
