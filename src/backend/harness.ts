import { fork } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electronPath from 'electron';
import {
  createClient,
  type BackendEvent,
  type Message,
  type TabId,
} from '../shared/ipc.ts';

/**
 * Vitest's Node and Electron's Node have different V8 serialization versions:
 * messages cross as JSON. Starts the back end in Electron's own Node runtime
 * with a temp home folder seeded with `files` and drives it only through IPC messages. The home folder is also its app data folder.
 */
export async function startBackend(
  files: Record<string, string> = {},
  env: Record<string, string> = {},
) {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'slop-home-')));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(home, name)), { recursive: true });
    await writeFile(path.join(home, name), text);
  }
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
      await rm(home, { recursive: true, force: true });
    },
  };
}
