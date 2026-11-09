import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  LocalShellForm,
  SessionColour,
  SessionForm,
} from '../shared/ipc.ts';
import { startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

async function start(files: Record<string, string> = {}) {
  harness = await startBackend(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [`.ssh/${name}`, text]),
    ),
  );
  return harness.backend;
}

const sidecar = async () =>
  JSON.parse(
    await readFile(path.join(harness.home, '.ssh', 'slop-term.json'), 'utf8'),
  );

const ssh = (patch: Partial<SessionForm> = {}): SessionForm => ({
  alias: 'prod',
  folder: '',
  hostname: '',
  port: '',
  user: '',
  identityFile: '',
  options: [],
  ...patch,
});

const local = (patch: Partial<LocalShellForm> = {}): LocalShellForm => ({
  name: 'box',
  folder: '',
  kind: 'cmd',
  distro: '',
  startFolder: '',
  command: '',
  ...patch,
});

describe('Session colours', () => {
  it('stores an SSH session colour in the Sidecar file and returns it in the tree and the session', async () => {
    const backend = await start({ 'slop-term.json': '{"folders":["Work"]}' });
    const tree = await backend.saveSession(
      ssh({ folder: 'Work', colour: 'red' }),
    );
    expect(await sidecar()).toEqual({
      folders: ['Work'],
      hosts: { prod: { folder: 'Work', colour: 'red' } },
    });
    expect(tree.sessions).toEqual([
      { alias: 'prod', folder: 'Work', colour: 'red' },
    ]);
    expect(await backend.getSession('prod')).toMatchObject({ colour: 'red' });
  });

  it('removes the colour when an edit clears it', async () => {
    const backend = await start({
      'slop-term.conf': 'Host prod\n',
      'slop-term.json': JSON.stringify({ hosts: { prod: { colour: 'red' } } }),
    });
    const { read, ...form } = await backend.getSession('prod');
    const tree = await backend.saveSession(
      { ...form, colour: undefined },
      { alias: 'prod', read },
    );
    expect(await sidecar()).toEqual({ hosts: {} });
    expect(tree.sessions).toEqual([{ alias: 'prod' }]);
  });

  it('stores a Local shell session colour and returns it in the tree and the session', async () => {
    const backend = await start();
    const tree = await backend.saveLocalShell(local({ colour: 'blue' }));
    expect(await sidecar()).toEqual({
      localShells: { box: { kind: 'cmd', colour: 'blue' } },
    });
    expect(tree.localShells).toEqual([local({ colour: 'blue' })]);
    expect(await backend.getLocalShell('box')).toMatchObject({
      colour: 'blue',
    });
  });

  it('keeps the colour when a session moves to another folder', async () => {
    const backend = await start({
      'slop-term.conf': 'Host prod\n',
      'slop-term.json': JSON.stringify({
        folders: ['Work'],
        hosts: { prod: { colour: 'red' } },
        localShells: { box: { kind: 'cmd', colour: 'blue' } },
      }),
    });
    await backend.move({ alias: 'prod' }, 'Work');
    const tree = await backend.move({ alias: 'box' }, 'Work');
    expect(tree.sessions).toEqual([
      { alias: 'prod', folder: 'Work', colour: 'red' },
    ]);
    expect(tree.localShells).toEqual([
      local({ folder: 'Work', colour: 'blue' }),
    ]);
  });

  it('ignores a colour the app does not offer in a hand-edited file', async () => {
    const backend = await start({
      'slop-term.conf': 'Host prod\n',
      'slop-term.json': JSON.stringify({
        hosts: { prod: { colour: 'teal' } },
        localShells: { box: { kind: 'cmd', colour: 7 } },
      }),
    });
    const tree = await backend.getTree();
    expect(tree.sessions).toEqual([{ alias: 'prod' }]);
    expect(tree.localShells).toEqual([local()]);
  });

  it('refuses to save a colour the app does not offer', async () => {
    const backend = await start();
    const teal = 'teal' as SessionColour;
    await expect(backend.saveSession(ssh({ colour: teal }))).rejects.toThrow(
      'teal is not a Session colour.',
    );
    await expect(
      backend.saveLocalShell(local({ colour: teal })),
    ).rejects.toThrow('teal is not a Session colour.');
  });
});
