import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TabId } from '../shared/ipc.ts';
import { eventually, includeManaged, startBackend } from './harness.ts';
import { dockerRunning, startSshServer, testKeyPair } from './ssh-server.ts';

const docker = await dockerRunning();
const testKey = testKeyPair();

describe.skipIf(!docker)('SFTP pane against OpenSSH in Docker', () => {
  let server: Awaited<ReturnType<typeof startSshServer>>;
  let harness: Awaited<ReturnType<typeof startBackend>>;
  beforeAll(async () => {
    server = await startSshServer([testKey.public]);
  }, 90_000);
  // `docker stop` waits up to 10 s for the container, the default hook timeout.
  afterAll(() => server?.stop(), 30_000);
  afterEach(() => harness.stop());

  /** Opens an SSH Tab on the Docker server and waits for its shell. */
  async function open(extra = '') {
    harness = await startBackend({ '.ssh/id_test': testKey.private });
    const ssh = (name: string) => path.join(harness.home, '.ssh', name);
    await mkdir(path.dirname(ssh('config')), { recursive: true });
    await writeFile(
      ssh('slop-term.conf'),
      [
        'Host box',
        '  HostName 127.0.0.1',
        `  Port ${server.port}`,
        '  User test',
        '  IdentityFile ~/.ssh/id_test',
        '  UserKnownHostsFile /dev/null',
        '  StrictHostKeyChecking no',
        extra,
        '',
      ].join('\n'),
    );
    await writeFile(ssh('config'), includeManaged(harness.home));
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(harness.output(tab)).toContain('$ '));
    return tab;
  }

  /** Runs `command` in the Tab's shell and waits until it finished. */
  let runs = 0;
  async function shell(tab: TabId, command: string) {
    const done = `done-${++runs}`;
    await harness.backend.write(tab, `${command}; echo ${done}-$((1+1))\r`);
    await eventually(() => expect(harness.output(tab)).toContain(`${done}-2`));
  }

  it('starts in the home folder and lists a folder with folders first, size, modified time and permissions', async () => {
    const tab = await open();
    const home = await harness.backend.listFiles(tab);
    await shell(
      tab,
      'mkdir -p docs/sub && printf abc > docs/run.sh && chmod 754 docs/run.sh && touch docs/.hidden && ln -s sub docs/link',
    );
    const { path: docs, files } = await harness.backend.listFiles(
      tab,
      `${home.path}/docs`,
    );
    expect(docs).toBe(`${home.path}/docs`);
    expect(files.map((f) => [f.name, f.folder]).sort()).toEqual([
      ['.hidden', false],
      ['link', true],
      ['run.sh', false],
      ['sub', true],
    ]);
    const run = files.find((f) => f.name === 'run.sh')!;
    expect(run).toMatchObject({ size: 3, permissions: '-rwxr-xr--' });
    expect(Math.abs(run.modified - Date.now())).toBeLessThan(60_000);
    expect(files.find((f) => f.name === 'sub')!.permissions).toMatch(/^d/);
    expect(files.find((f) => f.name === 'link')!.permissions).toMatch(/^l/);
    // A relative path starts from the home folder, and `..` resolves.
    expect((await harness.backend.listFiles(tab, 'docs/sub/..')).path).toBe(
      docs,
    );
  });

  it('renames a file and creates a folder', async () => {
    const tab = await open();
    const { path: home } = await harness.backend.listFiles(tab);
    await shell(tab, 'mkdir -p work && printf x > work/a.txt');
    await harness.backend.renameFile(
      tab,
      `${home}/work/a.txt`,
      `${home}/work/b.txt`,
    );
    await harness.backend.makeFolder(tab, `${home}/work/new`);
    const { files } = await harness.backend.listFiles(tab, `${home}/work`);
    expect(files.map((f) => f.name).sort()).toEqual(['b.txt', 'new']);
  });

  it('counts the files and bytes of a folder, then deletes it with everything inside, deleting a link without following it', async () => {
    const tab = await open();
    const { path: home } = await harness.backend.listFiles(tab);
    await shell(
      tab,
      'mkdir -p keep gone/a/b && printf 12345 > keep/k && printf abc > gone/a/b/f && printf xy > gone/g && ln -s ../keep gone/a/link && printf q > lone',
    );
    expect(
      await harness.backend.measureFiles(tab, [`${home}/gone`, `${home}/lone`]),
    ).toEqual([
      // A link counts as a file of its own size: the length of `../keep`.
      { files: 3, bytes: 'abc'.length + 'xy'.length + '../keep'.length },
      { files: 1, bytes: 1 },
    ]);
    await harness.backend.deleteFiles(tab, [`${home}/gone`, `${home}/lone`]);
    const names = (await harness.backend.listFiles(tab)).files.map(
      (f) => f.name,
    );
    expect(names).toContain('keep');
    expect(names).not.toContain('gone');
    expect(names).not.toContain('lone');
    const kept = await harness.backend.listFiles(tab, `${home}/keep`);
    expect(kept.files.map((f) => f.name)).toEqual(['k']);
  });

  it('reports the OSC 7 folder with its hostname and the first hostname seen, so the pane sees a chained ssh', async () => {
    const tab = await open();
    const osc7 = (host: string, folder: string) =>
      `printf '\\033]7;file://${host}${folder}\\007'`;
    await shell(
      tab,
      `${osc7('web1', '/srv')}; ${osc7('db1', '/var/lib')}; ${osc7('web1', '/etc')}`,
    );
    expect(
      harness.events.filter((e) => e.type === 'tab' && 'folder' in e),
    ).toEqual([
      { type: 'tab', tab, folder: '/srv', host: 'web1', firstHost: 'web1' },
      { type: 'tab', tab, folder: '/var/lib', host: 'db1', firstHost: 'web1' },
      { type: 'tab', tab, folder: '/etc', host: 'web1', firstHost: 'web1' },
    ]);
  });

  it('refuses to browse a dropped Tab and browses over the new connection after a reconnect', async () => {
    const tab = await open('  ServerAliveInterval 1\n  ServerAliveCountMax 1');
    const { path: home } = await harness.backend.listFiles(tab);
    await server.pause();
    try {
      await eventually(() => expect(harness.dropped(tab)).toHaveLength(1));
    } finally {
      await server.unpause();
    }
    await expect(harness.backend.listFiles(tab, home)).rejects.toThrow(
      'The Tab is not connected.',
    );
    await harness.backend.restart(tab);
    await eventually(() =>
      expect(
        harness.events.filter((e) => e.type === 'connected' && e.tab === tab),
      ).toHaveLength(2),
    );
    expect((await harness.backend.listFiles(tab, home)).path).toBe(home);
  });
});
