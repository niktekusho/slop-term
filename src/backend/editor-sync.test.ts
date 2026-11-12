import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TabId, Transfer } from '../shared/ipc.ts';
import { eventually, includeManaged, startBackend } from './harness.ts';
import { startFakeSshServer, testKeyPair } from './ssh-server.ts';

const testKey = testKeyPair();

describe('editor sync against an in-process server', () => {
  let harness: Awaited<ReturnType<typeof startBackend>>;
  let fake: Awaited<ReturnType<typeof startFakeSshServer>>;
  afterEach(async () => {
    await harness.stop();
    await fake.stop();
  });

  /** Opens a Tab on a new fake server holding `files`, with an editor that writes the path it opens into `opened.txt`. */
  async function open(
    files: Record<string, string | Buffer> = {},
    settings = {},
    server: Parameters<typeof startFakeSshServer>[0] = {},
  ) {
    fake = await startFakeSshServer({ ...server, sftp: true });
    for (const [name, data] of Object.entries(files))
      fake.files.set(name, Buffer.from(data));
    harness = await startBackend({ '.ssh/id_test': testKey.private });
    const editor = path.join(
      harness.home,
      process.platform === 'win32' ? 'edit.cmd' : 'edit.sh',
    );
    const opened = path.join(harness.home, 'opened.txt');
    await writeFile(
      editor,
      process.platform === 'win32'
        ? `@echo %~1> "${opened}"\r\n`
        : `#!/bin/sh\necho "$1" > "${opened}"\n`,
      { mode: 0o755 },
    );
    await writeFile(
      path.join(harness.home, 'settings.json'),
      JSON.stringify({ editor, ...settings }),
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
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(harness.home, '.ssh', 'config'),
      includeManaged(harness.home),
    );
    await eventually(async () =>
      expect((await harness.backend.settings()).editor).toBe(editor),
    );
    const tab = await harness.backend.openSsh('box');
    if (server.code) {
      await eventually(() =>
        expect(harness.events).toContainEqual(
          expect.objectContaining({ type: 'secret', tab }),
        ),
      );
      await harness.backend.answerSecret(tab, [server.code], false);
    }
    await eventually(() => expect(harness.output(tab)).toContain('$ '));
    /** The local copy the editor was given. */
    const copy = async () => {
      let file = '';
      await eventually(async () => {
        file = (await readFile(opened, 'utf8')).trim();
        expect(file).not.toBe('');
      });
      return file;
    };
    return { tab, copy };
  }

  const row = (tab: TabId) =>
    harness.events.findLast(
      (e) => e.type === 'transfer' && e.tab === tab && e.transfer.edit,
    ) as { transfer: Transfer } | undefined;

  it('downloads the file, opens it in the editor from settings and uploads each save', async () => {
    const { tab, copy } = await open({ '/srv/app.conf': 'port 80' });
    await harness.backend.openInEditor(tab, '/srv/app.conf');
    const file = await copy();
    expect(path.basename(file)).toBe('app.conf');
    expect(file.startsWith(harness.home)).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('port 80');
    await eventually(() =>
      expect(row(tab)?.transfer).toMatchObject({
        name: 'app.conf',
        folder: '/srv',
        state: 'done',
        edit: { app: 'edit' },
      }),
    );
    expect(row(tab)?.transfer.edit?.uploaded).toBeUndefined();

    await writeFile(file, 'port 8080');
    await eventually(() =>
      expect(fake.files.get('/srv/app.conf')?.toString()).toBe('port 8080'),
    );
    await eventually(() =>
      expect(row(tab)?.transfer.edit?.uploaded).toBeGreaterThan(0),
    );

    await rm(path.join(harness.home, 'opened.txt'));
    await harness.backend.openInEditor(tab, '/srv/app.conf');
    expect(await copy()).toBe(file);
    const ids = new Set(
      harness.events.flatMap((e) =>
        e.type === 'transfer' && e.transfer.edit ? [e.transfer.id] : [],
      ),
    );
    expect(ids.size).toBe(1);
  });

  const questions = (tab: TabId) =>
    harness.events.flatMap((e) =>
      e.type === 'editorSave' && e.tab === tab && e.question
        ? [e.question]
        : [],
    );

  it('asks before uploading over a remote file up to 10 MB whose content changed, keeping its size and modified time', async () => {
    const { tab, copy } = await open({ '/srv/app.conf': 'port 80' });
    await harness.backend.openInEditor(tab, '/srv/app.conf');
    const file = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));
    fake.files.set('/srv/app.conf', Buffer.from('port 81'));

    await writeFile(file, 'port 8080');
    await eventually(() => expect(questions(tab)).toHaveLength(1));
    expect(questions(tab)[0]).toMatchObject({
      name: 'app.conf',
      reason: 'changed',
    });
    await harness.backend.answerEditorSave(tab, questions(tab)[0].id, false);
    await eventually(() =>
      expect(harness.events.at(-1)).toMatchObject({ type: 'editorSave', tab }),
    );
    expect(fake.files.get('/srv/app.conf')?.toString()).toBe('port 81');

    await writeFile(file, 'port 9090');
    await eventually(() => expect(questions(tab)).toHaveLength(2));
    await harness.backend.answerEditorSave(tab, questions(tab)[1].id, true);
    await eventually(() =>
      expect(fake.files.get('/srv/app.conf')?.toString()).toBe('port 9090'),
    );
  });

  it('compares modified time and size of a remote file over 10 MB', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');
    const { tab, copy } = await open({ '/srv/big.log': big });
    await harness.backend.openInEditor(tab, '/srv/big.log');
    const file = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));

    // Content alone is not read above 10 MB: this save uploads without asking.
    fake.files.set('/srv/big.log', Buffer.alloc(big.length, 'b'));
    await writeFile(file, Buffer.alloc(big.length, 'c'));
    await eventually(() =>
      expect(row(tab)?.transfer.edit?.uploaded).toBeGreaterThan(0),
    );
    expect(fake.files.get('/srv/big.log')?.at(-1)).toBe('c'.charCodeAt(0));
    expect(questions(tab)).toHaveLength(0);

    fake.mtimes.set('/srv/big.log', 1_700_000_000);
    await writeFile(file, Buffer.alloc(big.length, 'd'));
    await eventually(() => expect(questions(tab)).toHaveLength(1));
    expect(fake.files.get('/srv/big.log')?.[0]).toBe('c'.charCodeAt(0));
  });

  it('uploads a save over 10 MB on the Tab connection of a host that asked keyboard-interactive questions', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');
    const { tab, copy } = await open(
      { '/srv/big.log': big },
      {},
      { code: '424242' },
    );
    await harness.backend.openInEditor(tab, '/srv/big.log');
    const file = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));

    await writeFile(file, Buffer.alloc(big.length, 'c'));
    await eventually(() =>
      expect(row(tab)?.transfer.edit?.uploaded).toBeGreaterThan(0),
    );
    expect(fake.files.get('/srv/big.log')?.at(-1)).toBe('c'.charCodeAt(0));
    expect(fake.opened()).toBe(1);
  });

  it('asks on each save with upload on save off', async () => {
    const { tab, copy } = await open(
      { '/srv/app.conf': 'port 80' },
      { uploadOnSave: false },
    );
    await harness.backend.openInEditor(tab, '/srv/app.conf');
    const file = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));

    await writeFile(file, 'port 8080');
    await eventually(() => expect(questions(tab)).toHaveLength(1));
    expect(questions(tab)[0]).toMatchObject({
      name: 'app.conf',
      reason: 'save',
    });
    await harness.backend.answerEditorSave(tab, questions(tab)[0].id, false);
    await writeFile(file, 'port 9090');
    await eventually(() => expect(questions(tab)).toHaveLength(2));
    expect(fake.files.get('/srv/app.conf')?.toString()).toBe('port 80');
    await harness.backend.answerEditorSave(tab, questions(tab)[1].id, true);
    await eventually(() =>
      expect(fake.files.get('/srv/app.conf')?.toString()).toBe('port 9090'),
    );
  });

  it('records what it uploaded when a save comes in while a question is open', async () => {
    const { tab, copy } = await open(
      { '/srv/app.conf': 'port 80' },
      { uploadOnSave: false },
    );
    await harness.backend.openInEditor(tab, '/srv/app.conf');
    const file = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));
    await writeFile(file, 'port 8080');
    await eventually(() => expect(questions(tab)).toHaveLength(1));
    await writeFile(file, 'port 9090');
    await new Promise((r) => setTimeout(r, 600));
    await harness.backend.answerEditorSave(tab, questions(tab)[0].id, true);
    await eventually(() => expect(questions(tab)).toHaveLength(2));
    await harness.backend.answerEditorSave(tab, questions(tab)[1].id, true);
    const uploads = () =>
      new Set(
        harness.events.flatMap((e) =>
          e.type === 'transfer' && e.transfer.edit?.uploaded
            ? [e.transfer.edit.uploaded]
            : [],
        ),
      ).size;
    await eventually(() => expect(uploads()).toBe(2));
    expect(fake.files.get('/srv/app.conf')?.toString()).toBe('port 9090');
    expect(questions(tab).map((q) => q.reason)).toEqual(['save', 'save']);
  });

  it('holds a save made during a drop as waiting, and checks and uploads it after the reconnect', async () => {
    const { tab, copy } = await open({ '/srv/app.conf': 'port 80' });
    await harness.backend.openInEditor(tab, '/srv/app.conf');
    const file = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));
    fake.dropAll();
    await eventually(() => expect(harness.dropped(tab)).toHaveLength(1));

    await writeFile(file, 'port 8080');
    await eventually(() => expect(row(tab)?.transfer.state).toBe('queued'));
    fake.files.set('/srv/app.conf', Buffer.from('port 81'));
    await harness.backend.restart(tab);
    await eventually(() => expect(questions(tab)).toHaveLength(1));
    expect(questions(tab)[0].reason).toBe('changed');
    await harness.backend.answerEditorSave(tab, questions(tab)[0].id, true);
    await eventually(() =>
      expect(fake.files.get('/srv/app.conf')?.toString()).toBe('port 8080'),
    );
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));
  });

  it('deletes the temp copies when the Tab closes', async () => {
    const { tab, copy } = await open({ '/srv/app.conf': 'port 80' });
    await harness.backend.openInEditor(tab, '/srv/app.conf');
    const file = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));
    await harness.backend.close(tab);
    await eventually(() => expect(existsSync(path.dirname(file))).toBe(false));
  });

  it('lists the copies with saves that never reached the host after a crash, and deletes the rest', async () => {
    const { tab, copy } = await open({
      '/srv/a.conf': 'a',
      '/srv/b.conf': 'b',
    });
    await harness.backend.openInEditor(tab, '/srv/a.conf');
    const a = await copy();
    await eventually(() => expect(row(tab)?.transfer.state).toBe('done'));
    await rm(path.join(harness.home, 'opened.txt'));
    await harness.backend.openInEditor(tab, '/srv/b.conf');
    const b = await copy();
    await eventually(() =>
      expect(row(tab)?.transfer).toMatchObject({
        name: 'b.conf',
        state: 'done',
      }),
    );
    fake.dropAll();
    await eventually(() => expect(harness.dropped(tab)).toHaveLength(1));
    await writeFile(a, 'mine');
    await eventually(() =>
      expect(row(tab)?.transfer).toMatchObject({
        name: 'a.conf',
        state: 'queued',
      }),
    );

    await harness.crash();
    expect(await harness.backend.unsentEdits()).toEqual([
      { alias: 'box', remote: '/srv/a.conf', file: a },
    ]);
    expect(await readFile(a, 'utf8')).toBe('mine');
    expect(existsSync(path.dirname(b))).toBe(false);
  });
});
