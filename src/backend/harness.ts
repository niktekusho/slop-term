import { execFile, fork } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import electronPath from 'electron';
import {
  createClient,
  type BackendEvent,
  type Message,
  type TabId,
} from '../shared/ipc.ts';

const keychainHome = process.env.SLOP_TEST_KEYCHAIN_HOME;

async function keychainTool(...args: string[]) {
  const { stdout } = await promisify(execFile)(
    electronPath as unknown as string,
    [path.join(import.meta.dirname, 'keychain-tool.ts'), ...args],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ...(keychainHome && { HOME: keychainHome }),
      },
    },
  );
  return JSON.parse(stdout);
}

/** The keychain entry a back end of {@link startBackend} sees, read and written from Electron like the back end does. */
export const keychainEntry = (service: string, account: string) => ({
  getPassword: (): Promise<string | null> =>
    keychainTool('get', service, account),
  setPassword: (password: string): Promise<void> =>
    keychainTool('set', service, account, password),
  deletePassword: (): Promise<boolean> =>
    keychainTool('delete', service, account),
});

export const findKeychainCredentials = (
  service: string,
): Promise<{ account: string; password: string }[]> =>
  keychainTool('find', service);

/**
 * Vitest's Node and Electron's Node have different V8 serialization versions:
 * messages cross as JSON. Starts the back end in Electron's own Node runtime
 * with a temp home folder seeded with `files` and drives it only through IPC messages. The home folder is also its app data folder.
 * Each of `imports` loads before the back end, so a test can add a fake Credential provider.
 */
export async function startBackend(
  files: Record<string, string> = {},
  env: Record<string, string> = {},
  imports: string[] = [],
) {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'slop-home-')));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(home, name)), { recursive: true });
    await writeFile(path.join(home, name), text);
  }
  // macOS finds the default keychain under $HOME: the link points every back end at the test keychain.
  if (keychainHome) {
    await mkdir(path.join(home, 'Library'));
    await symlink(
      path.join(keychainHome, 'Library', 'Keychains'),
      path.join(home, 'Library', 'Keychains'),
    );
  }
  const child = fork(path.join(import.meta.dirname, 'main.ts'), [home], {
    execPath: electronPath as unknown as string,
    execArgv: imports.flatMap((file) => ['--import', pathToFileURL(file).href]),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOME: home,
      USERPROFILE: home,
      ...env,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.once('exit', (code) => {
    if (code) throw new Error(`back end exited with code ${code}`);
  });
  const events: BackendEvent[] = [];
  const backend = createClient(
    (request) => child.send(request),
    (listener) => child.on('message', (m) => listener(m as Message)),
  );
  backend.onEvent((event) => events.push(event));

  return {
    backend,
    home,
    events,
    output: (tab: TabId) =>
      events
        .flatMap((e) => (e.type === 'output' && e.tab === tab ? e.data : []))
        .join(''),
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      }
      // Windows ends a killed back end's shells a moment later, and until then each holds its start folder open.
      await rm(home, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    },
  };
}
