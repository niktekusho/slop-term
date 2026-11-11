import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TabId, Transfer } from '../shared/ipc.ts';
import { eventually, includeManaged, startBackend } from './harness.ts';
import {
  dockerRunning,
  startFakeSshServer,
  startSshServer,
  testKeyPair,
} from './ssh-server.ts';

const docker = await dockerRunning();
const testKey = testKeyPair();

describe('SFTP transfers against an in-process server', () => {
  let harness: Awaited<ReturnType<typeof startBackend>>;
  let fake: Awaited<ReturnType<typeof startFakeSshServer>>;
  afterEach(async () => {
    fake.release();
    await harness.stop();
    await fake.stop();
  });

  /** Opens a Tab on a new fake server and resolves once its shell is open. `extra` adds lines to the host block. */
  async function open(
    options: Parameters<typeof startFakeSshServer>[0] = {},
    { idleMs = 1500, extra = '' } = {},
  ) {
    fake = await startFakeSshServer({ ...options, sftp: true });
    harness = await startBackend(
      { '.ssh/id_test': testKey.private },
      { SLOP_TRANSFER_IDLE_MS: String(idleMs) },
    );
    await writeFile(
      path.join(harness.home, '.ssh', 'slop-term.conf'),
      [
        'Host box',
        '  HostName 127.0.0.1',
        `  Port ${fake.port}`,
        '  User test',
        '  IdentityFile ~/.ssh/id_test',
        '  UserKnownHostsFile /dev/null',
        '  StrictHostKeyChecking no',
        extra,
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(harness.home, '.ssh', 'config'),
      includeManaged(harness.home),
    );
    const tab = await harness.backend.openSsh('box');
    const answer = options.code ?? options.password;
    if (answer) {
      await eventually(() =>
        expect(harness.events).toContainEqual(
          expect.objectContaining({ type: 'secret', tab }),
        ),
      );
      await harness.backend.answerSecret(tab, [answer], false);
    }
    await eventually(() => expect(harness.output(tab)).toContain('$ '));
    const file = path.join(harness.home, 'up.txt');
    await writeFile(file, 'payload');
    return { tab, file };
  }

  const last = (tab: TabId) =>
    harness.events.findLast((e) => e.type === 'transfer' && e.tab === tab) as
      | { transfer: Transfer }
      | undefined;

  it('opens the transfer connection on the first transfer and closes it when idle', async () => {
    const { tab, file } = await open();
    expect(fake.open()).toBe(1);
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() => expect(last(tab)?.transfer.state).toBe('done'));
    expect(fake.files.get('/up/up.txt')?.toString()).toBe('payload');
    expect(fake.opened()).toBe(2);
    expect(fake.open()).toBe(2);
    await eventually(() => expect(fake.open()).toBe(1));
    await harness.backend.upload(tab, [file], '/again');
    await eventually(() => expect(fake.files.has('/again/up.txt')).toBe(true));
    expect(fake.opened()).toBe(3);
  });

  it("sends keepalives on the transfer connection at the Tab's interval", async () => {
    const { tab, file } = await open(
      {},
      { idleMs: 10_000, extra: '  ServerAliveInterval 1' },
    );
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() => expect(last(tab)?.transfer.state).toBe('done'));
    // The default 15 s interval would send none in this time.
    await eventually(() =>
      expect(fake.keepalivesPerConnection().filter((n) => n >= 2)).toHaveLength(
        2,
      ),
    );
  });

  it("blocks with the changed-key warning when the transfer connection meets a key other than the Tab's, never asking", async () => {
    const { tab, file } = await open();
    fake.changeHostKey();
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() =>
      expect(last(tab)?.transfer).toMatchObject({
        state: 'failed',
        reason: 'The host sent a different key than the Tab accepted.',
      }),
    );
    const change = harness.events.find((e) => e.type === 'transferKey');
    expect(change).toMatchObject({
      tab,
      change: { host: `127.0.0.1:${fake.port}`, keyType: 'ssh-ed25519' },
    });
    const { accepted, fingerprint } = (
      change as { change: { accepted: string; fingerprint: string } }
    ).change;
    expect(accepted).toMatch(/^SHA256:/);
    expect(fingerprint).not.toBe(accepted);
    expect(harness.events.some((e) => e.type === 'hostKey')).toBe(false);
    expect(fake.files.size).toBe(0);
  });

  it('fails with a reason when the host no longer offers the type of key the Tab accepted', async () => {
    const { tab, file } = await open();
    fake.changeHostKey('rsa');
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() =>
      expect(last(tab)?.transfer).toMatchObject({
        state: 'failed',
        reason:
          'The host no longer offers the ssh-ed25519 key the Tab accepted.',
      }),
    );
    expect(harness.events.some((e) => e.type === 'hostKey')).toBe(false);
  });

  it('logs the transfer connection in with the password typed for the Tab, without asking', async () => {
    const { tab, file } = await open({ password: 'hunter2' });
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() => expect(last(tab)?.transfer.state).toBe('done'));
    expect(fake.opened()).toBe(2);
    expect(
      harness.events.filter((e) => e.type === 'secret' && e.question),
    ).toHaveLength(1);
  });

  it('transfers on the Tab connection for a host that asked keyboard-interactive questions', async () => {
    const { tab, file } = await open({ code: '424242' });
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() => expect(last(tab)?.transfer.state).toBe('done'));
    expect(fake.files.get('/up/up.txt')?.toString()).toBe('payload');
    expect(fake.opened()).toBe(1);
    expect(
      harness.events.filter((e) => e.type === 'secret' && e.question),
    ).toHaveLength(1);
  });

  it('fails a running transfer on a drop and retries it after the reconnect', async () => {
    const { tab, file } = await open();
    fake.hold();
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() => expect(last(tab)?.transfer.state).toBe('running'));
    fake.dropAll();
    await eventually(() =>
      expect(last(tab)?.transfer).toMatchObject({
        state: 'failed',
        reason: 'The Tab disconnected.',
      }),
    );
    fake.release();
    await harness.backend.restart(tab);
    await eventually(() =>
      expect(harness.events.filter((e) => e.type === 'connected')).toHaveLength(
        2,
      ),
    );
    await harness.backend.retryTransfer(tab, last(tab)!.transfer.id);
    await eventually(() => expect(last(tab)?.transfer.state).toBe('done'));
    expect(fake.files.get('/up/up.txt')?.toString()).toBe('payload');
  });

  it('asks again on a retry of a transfer whose conflict question a drop voided', async () => {
    const { tab, file } = await open();
    await harness.backend.upload(tab, [file], '/up');
    await eventually(() => expect(last(tab)?.transfer.state).toBe('done'));
    fake.files.set('/up/up.txt', Buffer.from('theirs'));
    await harness.backend.upload(tab, [file], '/up');
    const asked = () =>
      harness.events.filter((e) => e.type === 'conflict' && e.conflict);
    await eventually(() => expect(asked()).toHaveLength(1));
    fake.dropAll();
    await eventually(() =>
      expect(last(tab)?.transfer).toMatchObject({ state: 'failed' }),
    );
    expect(harness.events).toContainEqual({ type: 'conflict', tab });
    await harness.backend.restart(tab);
    await eventually(() =>
      expect(harness.events.filter((e) => e.type === 'connected')).toHaveLength(
        2,
      ),
    );
    await harness.backend.retryTransfer(tab, last(tab)!.transfer.id);
    await eventually(() => expect(asked()).toHaveLength(2));
    expect(fake.files.get('/up/up.txt')?.toString()).toBe('theirs');
  });

  it('cancels a running transfer and a queued one', async () => {
    const { tab, file } = await open();
    fake.hold();
    await harness.backend.upload(tab, [file], '/one');
    await harness.backend.upload(tab, [file], '/two');
    const states = () =>
      new Map(
        harness.events.flatMap((e) =>
          e.type === 'transfer' ? [[e.transfer.folder, e.transfer.state]] : [],
        ),
      );
    await eventually(() => expect(states().get('/one')).toBe('running'));
    expect(states().get('/two')).toBe('queued');
    const id = (folder: string) =>
      harness.events.flatMap((e) =>
        e.type === 'transfer' && e.transfer.folder === folder
          ? [e.transfer.id]
          : [],
      )[0];
    await harness.backend.cancelTransfer(tab, id('/two'));
    await harness.backend.cancelTransfer(tab, id('/one'));
    await eventually(() => expect(states().get('/one')).toBe('cancelled'));
    expect(states().get('/two')).toBe('cancelled');
    fake.release();
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.files.has('/two/up.txt')).toBe(false);
  });
});

describe.skipIf(!docker)('SFTP transfers against OpenSSH in Docker', () => {
  let server: Awaited<ReturnType<typeof startSshServer>>;
  let harness: Awaited<ReturnType<typeof startBackend>>;
  beforeAll(async () => {
    server = await startSshServer([testKey.public]);
  }, 90_000);
  // `docker stop` waits up to 10 s for the container, the default hook timeout.
  afterAll(() => server?.stop(), 30_000);
  afterEach(() => harness.stop());

  /** Opens an SSH Tab on the Docker server, waits for its shell and returns it with the remote home folder. */
  async function open() {
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
        '',
      ].join('\n'),
    );
    await writeFile(ssh('config'), includeManaged(harness.home));
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(harness.output(tab)).toContain('$ '));
    const { path: home } = await harness.backend.listFiles(tab);
    return { tab, home };
  }

  let runs = 0;
  /** Runs `command` in the Tab's shell and resolves to what it printed. */
  async function shell(tab: TabId, command: string) {
    const mark = `mark-${++runs}`;
    const start = harness.output(tab).length;
    await harness.backend.write(
      tab,
      `echo ${mark}-$((1+1)); ${command}; echo ${mark}-$((2+1))\r`,
    );
    await eventually(() => expect(harness.output(tab)).toContain(`${mark}-3`));
    const out = harness.output(tab).slice(start);
    return out
      .slice(
        out.indexOf(`${mark}-2`) + `${mark}-2`.length,
        out.indexOf(`${mark}-3`),
      )
      .trim();
  }

  /** The last state of each transfer of the Tab, by name. */
  const transfers = (tab: TabId) => {
    const last = new Map<string, Transfer>();
    for (const e of harness.events)
      if (e.type === 'transfer' && e.tab === tab)
        last.set(e.transfer.id, e.transfer);
    return Object.fromEntries([...last.values()].map((t) => [t.name, t]));
  };

  async function local(name: string, text: string) {
    const file = path.join(harness.home, 'local', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    return file;
  }

  it('uploads a file into a remote folder with progress', async () => {
    const { tab, home } = await open();
    const file = await local('a.txt', 'x'.repeat(100_000));
    await harness.backend.upload(tab, [file], home);
    await eventually(() =>
      expect(transfers(tab)['a.txt']).toMatchObject({
        direction: 'upload',
        folder: home,
        local: file,
        state: 'done',
        bytes: 100_000,
        total: 100_000,
      }),
    );
    expect(await shell(tab, 'wc -c < a.txt')).toBe('100000');
  });

  it('downloads to Downloads the first time, then to the last folder a Download to… picked', async () => {
    const { tab, home } = await open();
    await shell(tab, 'printf hello > d.txt && printf again > e.txt');
    await harness.backend.download(tab, [`${home}/d.txt`]);
    const downloads = path.join(harness.home, 'Downloads');
    await eventually(() =>
      expect(transfers(tab)['d.txt']).toMatchObject({
        direction: 'download',
        folder: downloads,
        local: path.join(downloads, 'd.txt'),
        state: 'done',
      }),
    );
    expect(await readFile(path.join(downloads, 'd.txt'), 'utf8')).toBe('hello');

    const picked = path.join(harness.home, 'picked');
    await harness.backend.download(tab, [`${home}/d.txt`], picked);
    await harness.backend.download(tab, [`${home}/e.txt`]);
    await eventually(() =>
      expect(transfers(tab)['e.txt']).toMatchObject({
        folder: picked,
        state: 'done',
      }),
    );
    expect(await readFile(path.join(picked, 'e.txt'), 'utf8')).toBe('again');
    expect((await harness.backend.settings()).downloadFolder).toBe(picked);
  });

  it('transfers folders with everything inside, both ways', async () => {
    const { tab, home } = await open();
    await local('tree/a.txt', 'aa');
    await local('tree/sub/deep/b.txt', 'bbb');
    await mkdir(path.join(harness.home, 'local', 'tree', 'empty'));
    await harness.backend.upload(
      tab,
      [path.join(harness.home, 'local', 'tree')],
      home,
    );
    await eventually(() =>
      expect(transfers(tab)['tree']).toMatchObject({ state: 'done', total: 5 }),
    );
    expect(
      await shell(tab, 'cd tree && find . | sort | tr "\\n" " " && cd ..'),
    ).toBe('. ./a.txt ./empty ./sub ./sub/deep ./sub/deep/b.txt');

    const back = path.join(harness.home, 'back');
    await harness.backend.download(tab, [`${home}/tree`], back);
    await eventually(() =>
      expect(transfers(tab)['tree']).toMatchObject({
        direction: 'download',
        state: 'done',
      }),
    );
    expect(
      await readFile(path.join(back, 'tree', 'sub', 'deep', 'b.txt'), 'utf8'),
    ).toBe('bbb');
    expect(await readFile(path.join(back, 'tree', 'a.txt'), 'utf8')).toBe('aa');
  });

  it('asks about each existing target with both sides, and overwrites, skips or keeps both', async () => {
    const { tab, home } = await open();
    await shell(
      tab,
      'printf old1 > one.txt && printf old2 > two.txt && printf old3 > three && printf "x" > "three (1)"',
    );
    const files = await Promise.all(
      ['one.txt', 'two.txt', 'three', 'new.txt'].map((n) =>
        local(n, `new-${n}`),
      ),
    );
    await harness.backend.upload(tab, files, home);
    const asked = () =>
      harness.events.flatMap((e) =>
        e.type === 'conflict' && e.tab === tab && e.conflict
          ? [e.conflict]
          : [],
      );
    await eventually(() => expect(asked()).toHaveLength(1));
    expect(asked()[0]).toMatchObject({
      name: 'one.txt',
      local: { size: 'new-one.txt'.length },
      remote: { size: 4 },
      others: 2,
    });
    expect(Math.abs(asked()[0].remote.modified - Date.now())).toBeLessThan(
      60_000,
    );
    await harness.backend.answerConflict(tab, 'overwrite', false);
    await eventually(() => expect(asked()).toHaveLength(2));
    expect(asked()[1]).toMatchObject({ name: 'two.txt', others: 1 });
    await harness.backend.answerConflict(tab, 'skip', false);
    await eventually(() => expect(asked()).toHaveLength(3));
    await harness.backend.answerConflict(tab, 'keep', false);
    await eventually(() =>
      expect(transfers(tab)['new.txt']?.state).toBe('done'),
    );
    expect(transfers(tab)['two.txt'].state).toBe('cancelled');
    expect(transfers(tab)['three (2)'].state).toBe('done');
    expect(
      await shell(
        tab,
        'for f in one.txt two.txt three "three (2)" new.txt; do cat "$f"; echo; done | tr "\\n" " "',
      ),
    ).toBe('new-one.txt old2 old3 new-three new-new.txt');
  });

  it('gives one answer to the other conflicts of the batch, keeping both of each', async () => {
    const { tab, home } = await open();
    const downloads = path.join(harness.home, 'Downloads');
    await shell(tab, 'printf r1 > report.txt && printf r2 > notes');
    await mkdir(downloads, { recursive: true });
    await writeFile(path.join(downloads, 'report.txt'), 'mine');
    await writeFile(path.join(downloads, 'notes'), 'mine');
    await harness.backend.download(tab, [
      `${home}/report.txt`,
      `${home}/notes`,
    ]);
    const asked = () =>
      harness.events.filter((e) => e.type === 'conflict' && e.conflict);
    await eventually(() => expect(asked()).toHaveLength(1));
    await harness.backend.answerConflict(tab, 'keep', true);
    await eventually(() =>
      expect(transfers(tab)['notes (1)']?.state).toBe('done'),
    );
    expect(asked()).toHaveLength(1);
    expect(harness.events).toContainEqual({ type: 'conflict', tab });
    expect(await readFile(path.join(downloads, 'report (1).txt'), 'utf8')).toBe(
      'r1',
    );
    expect(await readFile(path.join(downloads, 'report.txt'), 'utf8')).toBe(
      'mine',
    );
  });
});
