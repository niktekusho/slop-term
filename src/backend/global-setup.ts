import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// macOS tests get an unlocked keychain of their own: the login keychain asks the user before every read.
export async function setup() {
  if (process.platform !== 'darwin') return;
  const home = await mkdtemp(path.join(tmpdir(), 'slop-keychain-'));
  const file = path.join(home, 'Library', 'Keychains', 'login.keychain-db');
  await mkdir(path.dirname(file), { recursive: true });
  const security = (...args: string[]) =>
    promisify(execFile)('security', args, {
      env: { ...process.env, HOME: home },
    });
  await security('create-keychain', '-p', '', file);
  await security('set-keychain-settings', file);
  process.env.SLOP_TEST_KEYCHAIN_HOME = home;
  return () => rm(home, { recursive: true, force: true });
}
