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
import { promisify } from 'node:util';
import electronPath from 'electron';
import { vi } from 'vitest';
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

/** Retries `assertion` for 15 s: Electron starts slowly when several test files run at once. */
export const eventually = (assertion: () => void | Promise<void>) =>
  vi.waitFor(assertion, { timeout: 15_000 });

/**
 * Two lines include the Managed config because the `ssh` on PATH differs by machine.
 * Git for Windows' reads `~` from HOME and takes `C:/…` as relative. Windows OpenSSH reads either.
 * macOS OpenSSH reads `~` from the account, not HOME, so it needs the full path.
 */
export const includeManaged = (home: string) =>
  `Include ~/.ssh/slop-term.conf\nInclude "${path.join(home, '.ssh', 'slop-term.conf').replaceAll('\\', '/')}"\n`;

/**
 * Writes Managed host `box`, which reaches a fake SSH server on `port` as `user`, and `sidecar` as the Sidecar file.
 * `~/.ssh/config` includes the Managed config.
 */
export async function writeBox(
  home: string,
  { port, user, sidecar }: { port: number; user: string; sidecar: object },
) {
  const ssh = (name: string) => path.join(home, '.ssh', name);
  await mkdir(path.dirname(ssh('config')), { recursive: true });
  await writeFile(
    ssh('slop-term.conf'),
    [
      'Host box',
      '  HostName 127.0.0.1',
      `  Port ${port}`,
      `  User ${user}`,
      '  IdentityFile ~/.ssh/missing',
      '  UserKnownHostsFile /dev/null',
      '  StrictHostKeyChecking no',
      '',
    ].join('\n'),
  );
  await writeFile(ssh('slop-term.json'), JSON.stringify(sidecar));
  await writeFile(ssh('config'), includeManaged(home));
}

type Files = Record<string, string | Buffer>;

/**
 * Vitest's Node and Electron's Node have different V8 serialization versions:
 * messages cross as JSON. Starts the back end in Electron's own Node runtime
 * with a temp home folder seeded with `files` and drives it only through IPC messages. The home folder is also its app data folder.
 * `files` can be built from the home folder, for contents that name a path in it.
 */
export async function startBackend(
  files: Files | ((home: string) => Files) = {},
  env: Record<string, string> = {},
) {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'slop-home-')));
  const seed = typeof files === 'function' ? files(home) : files;
  for (const [name, text] of Object.entries(seed)) {
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
  const events: BackendEvent[] = [];
  async function launch() {
    const child = fork(path.join(import.meta.dirname, 'main.ts'), [home], {
      execPath: electronPath as unknown as string,
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
    const backend = createClient(
      (request) => child.send(request),
      (listener) => child.on('message', (m) => listener(m as Message)),
    );
    backend.onEvent((event) => events.push(event));
    // The spawn event comes before the back end has created `~/.ssh` and its include line. An answer means its startup is done.
    await backend.settings();
    return { child, backend };
  }
  let { child, backend } = await launch();
  const kill = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  };

  return {
    get backend() {
      return backend;
    },
    home,
    events,
    /** Kills the back end as a crash would and starts a new one on the same home folder. */
    async crash() {
      await kill();
      ({ child, backend } = await launch());
    },
    /** What the Tab printed, as text: shells put escape sequences around it, such as zsh's `\e[K\e[?2004h` after its prompt. */
    output: (tab: TabId) =>
      events
        .flatMap((e) => (e.type === 'output' && e.tab === tab ? e.data : []))
        .join('')
        .replace(
          /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
          '',
        ),
    /** The secret questions the Tab (or Test) asked so far. */
    asked: (tab: TabId) =>
      events.flatMap((e) =>
        e.type === 'secret' && e.tab === tab && e.question ? [e.question] : [],
      ),
    dropped: (tab: TabId) =>
      events.filter((e) => e.type === 'dropped' && e.tab === tab),
    async stop() {
      await kill();
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
