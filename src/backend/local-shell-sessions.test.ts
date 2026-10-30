import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalShellForm } from '../shared/ipc.ts';
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

const read = (name: string) =>
  readFile(path.join(harness.home, '.ssh', name), 'utf8');
const sidecar = async () => JSON.parse(await read('slop-term.json'));

const form = (patch: Partial<LocalShellForm> = {}): LocalShellForm => ({
  name: 'ubuntu',
  folder: '',
  kind: 'wsl',
  distro: '',
  startFolder: '',
  command: '',
  ...patch,
});

describe('saving a Local shell session', () => {
  it('adds it to its own Sidecar list keyed by name, keeping the rest of the file', async () => {
    const backend = await start({
      'slop-term.conf': 'Host db\n',
      'slop-term.json': JSON.stringify({
        folders: ['Work'],
        hosts: { db: { folder: 'Work' } },
      }),
    });
    const tree = await backend.saveLocalShell(
      form({
        name: 'box',
        folder: 'Work',
        distro: 'Ubuntu',
        startFolder: '~/src',
        command: 'docker exec -it box bash',
      }),
    );
    await backend.saveLocalShell(form({ name: 'cmd', kind: 'cmd' }));
    expect(await sidecar()).toEqual({
      folders: ['Work'],
      hosts: { db: { folder: 'Work' } },
      localShells: {
        box: {
          kind: 'wsl',
          distro: 'Ubuntu',
          startFolder: '~/src',
          command: 'docker exec -it box bash',
          folder: 'Work',
        },
        cmd: { kind: 'cmd' },
      },
    });
    expect(tree.localShells).toEqual([
      form({
        name: 'box',
        folder: 'Work',
        distro: 'Ubuntu',
        startFolder: '~/src',
        command: 'docker exec -it box bash',
      }),
    ]);
    expect((await backend.getTree()).localShells.map((s) => s.name)).toEqual([
      'box',
      'cmd',
    ]);
  });

  it('shares one namespace with SSH aliases and Hand-written hosts, ignoring case, and writes nothing on a clash', async () => {
    const sidecarText = JSON.stringify({
      localShells: { box: { kind: 'cmd' } },
    });
    const backend = await start({
      config: 'Host mine\n',
      'slop-term.conf': 'Host db\n',
      'slop-term.json': sidecarText,
    });
    for (const [name, problem] of [
      ['db', 'db is already taken.'],
      ['mine', 'mine is already taken.'],
      ['box', 'box is already taken.'],
      ['Box', 'Use lowercase letters.'],
      ['my box', 'No spaces in an alias.'],
    ])
      await expect(backend.saveLocalShell(form({ name }))).rejects.toThrow(
        problem,
      );
    await expect(
      backend.saveSession({
        alias: 'box',
        folder: '',
        hostname: 'h',
        port: '',
        user: '',
        identityFile: '',
        options: [],
      }),
    ).rejects.toThrow('box is already taken.');
    expect(await read('slop-term.json')).toBe(sidecarText);
  });

  it('edits and renames a session in place, and stops if the file changed since it was read', async () => {
    const backend = await start({
      'slop-term.json': JSON.stringify({
        localShells: {
          a: { kind: 'cmd' },
          box: { kind: 'cmd' },
          z: { kind: 'cmd' },
        },
      }),
    });
    const { read: before, ...saved } = await backend.getLocalShell('box');
    expect(saved).toEqual(form({ name: 'box', kind: 'cmd' }));
    await backend.saveLocalShell(
      form({ name: 'shell', kind: 'pwsh', command: 'Get-Date' }),
      { name: 'box', read: before },
    );
    expect(Object.entries((await sidecar()).localShells)).toEqual([
      ['a', { kind: 'cmd' }],
      ['shell', { kind: 'pwsh', command: 'Get-Date' }],
      ['z', { kind: 'cmd' }],
    ]);
    // `before` is stale now: the session it read was renamed.
    await expect(
      backend.saveLocalShell(form({ name: 'box' }), {
        name: 'box',
        read: before,
      }),
    ).rejects.toThrow('box changed');
    const { read } = await backend.getLocalShell('z');
    await backend.saveLocalShell(form({ name: 'z', kind: 'bash' }), {
      name: 'z',
      read,
    });
    await expect(backend.deleteLocalShell('z', read)).rejects.toThrow(
      'z changed',
    );
  });

  it('deletes a session after checking it is unchanged', async () => {
    const backend = await start({
      'slop-term.json': JSON.stringify({
        localShells: { box: { kind: 'cmd' }, z: { kind: 'cmd' } },
      }),
    });
    const { read } = await backend.getLocalShell('box');
    const tree = await backend.deleteLocalShell('box', read);
    expect(tree.localShells.map((s) => s.name)).toEqual(['z']);
    expect(await sidecar()).toEqual({ localShells: { z: { kind: 'cmd' } } });
  });
});

describe('Local shell sessions in folders', () => {
  it('moves a session into a folder and back, keeping a folder it alone named', async () => {
    const backend = await start({
      'slop-term.json': JSON.stringify({
        localShells: { box: { kind: 'cmd', folder: 'Lab' } },
      }),
    });
    await backend.move({ alias: 'box' }, 'Work');
    expect(await sidecar()).toEqual({
      folders: ['Lab'],
      localShells: { box: { kind: 'cmd', folder: 'Work' } },
    });
    const tree = await backend.move({ alias: 'box' }, '');
    expect(tree.localShells).toEqual([form({ name: 'box', kind: 'cmd' })]);
  });

  it('carries sessions along when their folder is renamed or moved', async () => {
    const backend = await start({
      'slop-term.json': JSON.stringify({
        localShells: { box: { kind: 'cmd', folder: 'Lab/Docker' } },
      }),
    });
    await backend.renameFolder('Lab', 'Home');
    await backend.move({ folder: 'Home/Docker' }, '');
    expect((await sidecar()).localShells).toEqual({
      box: { kind: 'cmd', folder: 'Docker' },
    });
  });

  it('deletes the sessions of a deleted folder along with its SSH sessions', async () => {
    const backend = await start({
      'slop-term.conf': 'Host db\n',
      'slop-term.json': JSON.stringify({
        hosts: { db: { folder: 'Lab' } },
        localShells: {
          box: { kind: 'cmd', folder: 'Lab/Docker' },
          keep: { kind: 'cmd' },
        },
      }),
    });
    await expect(backend.deleteFolder('Lab', ['db'], false)).rejects.toThrow(
      'Lab changed since you asked to delete it.',
    );
    await backend.deleteFolder('Lab', ['box', 'db'], false);
    expect(await sidecar()).toEqual({
      folders: [],
      hosts: {},
      localShells: { keep: { kind: 'cmd' } },
    });
    expect(await read('slop-term.conf')).toBe('');
  });
});

describe('opening a Local shell session', () => {
  const win = process.platform === 'win32';
  const eventually = (assertion: () => void) =>
    vi.waitFor(assertion, { timeout: 15_000 });

  it('runs the command through each shell this machine has, in its start folder', async () => {
    const backend = await start();
    await mkdir(path.join(harness.home, 'sub dir'));
    const folder = path.join(harness.home, 'sub dir');
    const shells = await backend.listShells();
    const has = (kind: string) => shells.some((s) => s.kind === kind);
    const distro = shells.find((s) => s.kind === 'wsl')?.distro;
    // Each command keeps a quoted string, which the launch line must pass through intact.
    const cases: [LocalShellForm, string][] = win
      ? [
          ...(['pwsh', 'powershell'] as const)
            .filter((kind) => kind === 'powershell' || has(kind))
            .map((kind): [LocalShellForm, string] => [
              form({
                name: kind,
                kind,
                startFolder: '~/sub dir',
                command: `Write-Output "slop ${kind} $PWD"`,
              }),
              `slop ${kind} ${folder}`,
            ]),
          [
            form({
              name: 'cmd',
              kind: 'cmd',
              startFolder: '~/sub dir',
              command: 'echo "slop cmd" %CD%',
            }),
            `"slop cmd" ${folder}`,
          ],
          ...(distro
            ? [
                [
                  form({
                    name: 'wsl',
                    distro,
                    startFolder: '/tmp',
                    command: 'echo "slop  wsl" $(pwd)',
                  }),
                  'slop  wsl /tmp',
                ] as [LocalShellForm, string],
              ]
            : []),
        ]
      : (['zsh', 'bash'] as const).map((kind) => [
          form({
            name: kind,
            kind,
            startFolder: '~/sub dir',
            command: `echo "slop  ${kind}" "$PWD"`,
          }),
          `slop  ${kind} ${folder}`,
        ]);
    for (const [session] of cases) await backend.saveLocalShell(session);
    const tabs = await Promise.all(
      cases.map(([session]) => backend.openShellSession(session.name)),
    );
    await eventually(() =>
      expect(tabs.map((tab) => harness.output(tab))).toEqual(
        cases.map(([, line]) => expect.stringContaining(line)),
      ),
    );
    // Four shells start at once, and WSL may have to boot its VM first.
  }, 45_000);

  it("reports the command's exit code and runs it again on restart", async () => {
    const backend = await start();
    await backend.saveLocalShell(
      form({
        name: 'job',
        kind: win ? 'cmd' : 'bash',
        command: `echo slop-run ${win ? '&' : ';'} exit 3`,
      }),
    );
    const tab = await backend.openShellSession('job');
    const exits = () =>
      harness.events.filter((e) => e.type === 'exit' && e.tab === tab);
    await eventually(() =>
      expect(exits()).toEqual([{ type: 'exit', tab, code: 3 }]),
    );
    await backend.restart(tab);
    await eventually(() => expect(exits()).toHaveLength(2));
    expect(harness.output(tab).match(/slop-run/g)).toHaveLength(2);
  });

  it('refuses a session whose shell or WSL distro this machine lacks', async () => {
    const backend = await start();
    await backend.saveLocalShell(
      form({ name: 'elsewhere', kind: win ? 'zsh' : 'cmd' }),
    );
    await backend.saveLocalShell(form({ name: 'nodistro', distro: 'no-such' }));
    for (const name of ['elsewhere', 'nodistro'])
      await expect(backend.openShellSession(name)).rejects.toThrow(
        `${name} is not available on this machine.`,
      );
  });
});
