import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TabId, TypedSsh } from '../shared/ipc.ts';
import {
  eventually,
  includeManaged,
  keychainEntry,
  startBackend,
} from './harness.ts';
import { startFakeSshServer, testKeyPair } from './ssh-server.ts';

// Secrets go to a keychain service of this test run, never the app's own.
const service = `slop-term-test-${process.pid}`;
const keychain = (entry: string) => keychainEntry(service, entry);
// What a remote shell set up for OSC 7 sends with its prompt.
const osc7 = '\x1b]7;file://remote1/home/test\x07';

let harness: Awaited<ReturnType<typeof startBackend>>;
let server: Awaited<ReturnType<typeof startFakeSshServer>> | undefined;
afterEach(async () => {
  await harness.stop();
  await server?.stop();
  server = undefined;
});

// Each typed `ssh` waits 0.5 s and then about 1.5 s for the Windows process query: a test that runs several needs longer than the default.
const longMs = 60_000;
// The terminal's own `ssh` must not ask about the fake server's host key.
const quiet = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null';

/** The pane states the Tab reported so far, none meaning `ssh` exited. */
const states = (tab: TabId) =>
  harness.events.flatMap((e) =>
    e.type === 'typedSsh' && e.tab === tab ? [e.ssh] : [],
  );
const last = (tab: TabId) => states(tab).at(-1);
const paneQuestions = (tab: TabId) =>
  harness.events.flatMap((e) =>
    e.type === 'secret' && e.tab === tab && e.pane && e.question
      ? [e.question]
      : [],
  );
const ssh = (name: string) => path.join(harness.home, '.ssh', name);
// The host's reply to the last write reached the app: a held write the host stores after the connection ended doesn't count.
const uploaded = (tab: TabId) =>
  harness.events.some(
    (e) =>
      e.type === 'transfer' &&
      e.tab === tab &&
      e.transfer.name === 'up.txt' &&
      e.transfer.state === 'done',
  );

/** Ends the terminal's `ssh` with its `~.` escape, which leaves the pane's own connections to the app. */
async function exitSsh(tab: TabId) {
  await harness.backend.write(tab, '\r');
  await harness.backend.write(tab, '~.');
  await eventually(() => expect(last(tab)).toBeUndefined());
}

/** Types `ssh` to the fake server into the Tab's shell, with `extra` options. */
const typeSsh = (tab: TabId, extra = '') =>
  harness.backend.write(
    tab,
    `ssh ${quiet} ${extra} -p ${server!.port} test@127.0.0.1\r`,
  );

async function openShell() {
  const [shell] = await harness.backend.listShells();
  const tab = await harness.backend.openLocalShell(shell);
  // The prompt shows once the shell reads input.
  await eventually(() => expect(harness.output(tab)).toMatch(/[>$%#] ?$/m));
  return tab;
}

describe('typed ssh in a local shell Tab', () => {
  it('finds the ssh child of the shell after Enter and reports its resolved host, then its exit', async () => {
    server = await startFakeSshServer();
    harness = await startBackend();
    const tab = await openShell();
    await harness.backend.write(
      tab,
      `ssh ${quiet} -p ${server.port} test@127.0.0.1\r`,
    );
    await eventually(() =>
      expect(last(tab)).toEqual<TypedSsh>({
        alias: '127.0.0.1',
        user: 'test',
        host: '127.0.0.1',
        port: server!.port,
        state: 'waiting',
      }),
    );
    server.dropAll();
    await eventually(() => expect(states(tab).at(-1)).toBeUndefined());
    expect(states(tab).length).toBeGreaterThan(1);
  });

  it('connects the pane on its own after the remote shell sends OSC 7, and transfers over it', async () => {
    server = await startFakeSshServer({ sftp: true, prompt: `${osc7}$ ` });
    server.files.set('/home/test/a.txt', Buffer.from('hello'));
    harness = await startBackend({ '.ssh/id_test': testKeyPair().private });
    const tab = await openShell();
    // The pane logs in with the key the typed `ssh` names, asking nothing.
    await typeSsh(tab, `-i "${ssh('id_test')}"`);
    await eventually(() => expect(last(tab)?.state).toBe('connected'));
    expect(harness.events).toContainEqual({
      type: 'tab',
      tab,
      folder: '/home/test',
      host: 'remote1',
      firstHost: 'remote1',
    });
    const into = path.join(harness.home, 'dl');
    await harness.backend.download(tab, ['/home/test/a.txt'], into);
    await eventually(async () =>
      expect(await readFile(path.join(into, 'a.txt'), 'utf8')).toBe('hello'),
    );
  });

  it('lets a running upload finish when ssh exits', async () => {
    server = await startFakeSshServer({ sftp: true, prompt: `${osc7}$ ` });
    harness = await startBackend({
      '.ssh/id_test': testKeyPair().private,
      'up.txt': 'upload me',
    });
    const tab = await openShell();
    await typeSsh(tab, `-i "${ssh('id_test')}"`);
    await eventually(() => expect(last(tab)?.state).toBe('connected'));
    server.hold();
    await harness.backend.upload(
      tab,
      [path.join(harness.home, 'up.txt')],
      '/tmp',
    );
    await eventually(() => expect(server!.waiting()).toBeGreaterThan(0));
    await exitSsh(tab);
    server.release();
    await eventually(() => expect(uploaded(tab)).toBe(true));
    expect(server.files.get('/tmp/up.txt')?.toString()).toBe('upload me');
  });

  it(
    'lets a running upload finish when ssh exits on a host that asks keyboard-interactive questions',
    async () => {
      server = await startFakeSshServer({
        sftp: true,
        code: '4242',
        prompt: `${osc7}$ `,
      });
      harness = await startBackend({ 'up.txt': 'upload me' });
      const tab = await openShell();
      await typeSsh(tab);
      await eventually(() =>
        expect(harness.output(tab)).toMatch(/Verification code:/),
      );
      await harness.backend.write(tab, '4242\r');
      // Without a key the pane tries a password first; the host turns it down and asks its code.
      await eventually(() =>
        expect(paneQuestions(tab).length).toBeGreaterThan(0),
      );
      if (paneQuestions(tab)[0].prompts[0].prompt === 'Password')
        await harness.backend.answerSecret(tab, ['wrong'], false);
      await eventually(() =>
        expect(paneQuestions(tab).at(-1)?.prompts[0].prompt).toBe(
          'Verification code: ',
        ),
      );
      await harness.backend.answerSecret(tab, ['4242'], false);
      await eventually(() => expect(last(tab)?.state).toBe('connected'));
      server.hold();
      await harness.backend.upload(
        tab,
        [path.join(harness.home, 'up.txt')],
        '/tmp',
      );
      await eventually(() => expect(server!.waiting()).toBeGreaterThan(0));
      await exitSsh(tab);
      server.release();
      await eventually(() => expect(uploaded(tab)).toBe(true));
    },
    longMs,
  );

  describe('with Saved sessions', () => {
    const ref = { provider: 'keychain', entry: 'unused', kind: 'password' };
    const key = testKeyPair();

    /** Managed hosts that reach the fake server: `box` and `other-box` by alias, `zed` and `alpha` with references, `jumpy` through a jump host. */
    async function start() {
      server = await startFakeSshServer();
      harness = await startBackend({ '.ssh/id_test': key.private });
      const host = (alias: string, user: string, ...extra: string[]) =>
        [
          `Host ${alias}`,
          '  HostName 127.0.0.1',
          `  Port ${server!.port}`,
          `  User ${user}`,
          `  IdentityFile "${ssh('id_test').replaceAll('\\', '/')}"`,
          '  UserKnownHostsFile /dev/null',
          '  StrictHostKeyChecking no',
          ...extra,
          '',
        ].join('\n');
      await writeFile(
        ssh('slop-term.conf'),
        [
          host('box', 'test'),
          host('other-box', 'other'),
          host('zed', 'test'),
          host('alpha', 'test'),
          host('jumpy', 'test', '  ProxyJump nowhere'),
        ].join('\n'),
      );
      await writeFile(
        ssh('slop-term.json'),
        JSON.stringify({
          hosts: {
            'other-box': { credential: ref },
            zed: { credential: ref },
            alpha: { folder: 'f', credential: ref },
          },
        }),
      );
      await writeFile(ssh('config'), includeManaged(harness.home));
      return openShell();
    }

    /** Runs a typed `ssh` until the pane reports it, then ends it. */
    async function matched(tab: TabId, args: string) {
      const before = states(tab).length;
      await harness.backend.write(tab, `ssh ${quiet} ${args}\r`);
      await eventually(() =>
        expect(states(tab).length).toBeGreaterThan(before),
      );
      const found = last(tab);
      server!.dropAll();
      await eventually(() => expect(last(tab)).toBeUndefined());
      return found;
    }

    it(
      'matches the typed alias with the resolved user, else the first session in tree order on the same host, port and user',
      async () => {
        const tab = await start();
        const config = `-F "${ssh('config')}"`;
        expect(await matched(tab, `${config} box`)).toMatchObject({
          alias: 'box',
          user: 'test',
          session: 'box',
        });
        // `box` logs in as test, so it doesn't count for other: other-box resolves to the same host as `other`.
        expect(await matched(tab, `${config} other@box`)).toMatchObject({
          alias: 'box',
          user: 'other',
          session: 'other-box',
        });
        // Typed options count: `ssh -G` resolves them as the terminal's `ssh` did. Top-level zed comes before alpha in folder f.
        expect(
          await matched(tab, `-o User=test -p ${server!.port} 127.0.0.1`),
        ).toMatchObject({ alias: '127.0.0.1', user: 'test', session: 'zed' });
        expect(
          await matched(tab, `-o User=nobody -p ${server!.port} 127.0.0.1`),
        ).not.toHaveProperty('session');
      },
      longMs,
    );

    it('browses a picked Saved session with no ssh running, and stops', async () => {
      const tab = await start();
      await harness.backend.browseFiles(tab, 'box');
      await eventually(() =>
        expect(last(tab)).toMatchObject({
          picked: true,
          session: 'box',
          state: 'connected',
        }),
      );
      // The pane's connection drops and reconnects with its own button.
      server!.dropAll();
      await eventually(() => expect(last(tab)?.state).toBe('dropped'));
      await harness.backend.browseFiles(tab);
      await eventually(() => expect(last(tab)?.state).toBe('connected'));
      await harness.backend.stopBrowsing(tab);
      await eventually(() => expect(last(tab)).toBeUndefined());
    });

    it("reports a jump host and doesn't connect", async () => {
      const tab = await start();
      await harness.backend.browseFiles(tab, 'jumpy');
      await eventually(() =>
        expect(last(tab)).toMatchObject({ jumpHost: true, state: 'waiting' }),
      );
      await new Promise((r) => setTimeout(r, 500));
      expect(states(tab).map((s) => s?.state)).toEqual(['waiting']);
      expect(server!.opened()).toBe(0);
    });
  });

  describe('a password login', () => {
    const entry = () => `test@127.0.0.1-${server!.port}`;
    afterEach(async () => {
      await keychain(entry()).deletePassword();
    });

    /** Logs the terminal's `ssh` in, then waits for the pane's own question. */
    async function login() {
      server = await startFakeSshServer({
        password: 'pw',
        prompt: `${osc7}$ `,
      });
      harness = await startBackend({}, { SLOP_TERM_KEYCHAIN_SERVICE: service });
      const tab = await openShell();
      await typeSsh(tab);
      await eventually(() => expect(harness.output(tab)).toMatch(/password:/i));
      await harness.backend.write(tab, 'pw\r');
      await eventually(() =>
        expect(paneQuestions(tab).at(-1)).toMatchObject({
          title: 'Log in to test@127.0.0.1',
          save: 'create',
        }),
      );
      return tab;
    }

    it('saves the password and creates a Managed Saved session from the ssh -G values', async () => {
      const tab = await login();
      await harness.backend.answerSecret(tab, ['pw'], true, {
        alias: 'web',
        folder: 'ops',
      });
      await eventually(() => expect(last(tab)?.session).toBe('web'));
      expect(last(tab)?.state).toBe('connected');
      const conf = await readFile(ssh('slop-term.conf'), 'utf8');
      expect(conf).toContain(
        [
          'Host web',
          '  HostName 127.0.0.1',
          `  Port ${server!.port}`,
          '  User test',
          '  ServerAliveInterval 15',
        ].join('\n'),
      );
      const sidecar = JSON.parse(await readFile(ssh('slop-term.json'), 'utf8'));
      expect(sidecar.hosts.web).toEqual({
        folder: 'ops',
        credential: { provider: 'keychain', entry: entry(), kind: 'password' },
      });
      expect(await keychain(entry()).getPassword()).toBe('pw');
      // The next card starts on the folder this save used.
      expect((await harness.backend.settings()).typedSshFolder).toBe('ops');
    });

    it(
      'forgets a typed password when ssh exits',
      async () => {
        const tab = await login();
        await harness.backend.answerSecret(tab, ['pw'], false);
        await eventually(() => expect(last(tab)?.state).toBe('connected'));
        await exitSsh(tab);
        const before = harness.output(tab).length;
        await typeSsh(tab);
        await eventually(() =>
          expect(harness.output(tab).slice(before)).toMatch(/password:/i),
        );
        await harness.backend.write(tab, 'pw\r');
        await eventually(() => expect(paneQuestions(tab)).toHaveLength(2));
      },
      longMs,
    );

    it(
      'offers to attach the password to a Managed session without a reference, and tells a Hand-written host to move in',
      async () => {
        server = await startFakeSshServer({
          password: 'pw',
          prompt: `${osc7}$ `,
        });
        harness = await startBackend(
          {},
          { SLOP_TERM_KEYCHAIN_SERVICE: service },
        );
        const block = (alias: string) =>
          [
            `Host ${alias}`,
            '  HostName 127.0.0.1',
            `  Port ${server!.port}`,
            '  User test',
            '  UserKnownHostsFile /dev/null',
            '  StrictHostKeyChecking no',
            '',
          ].join('\n');
        await writeFile(ssh('slop-term.conf'), block('box'));
        await writeFile(
          ssh('config'),
          includeManaged(harness.home) + block('web1'),
        );
        const tab = await openShell();
        const typed = async (alias: string) => {
          const before = harness.output(tab).length;
          const asked = paneQuestions(tab).length;
          await harness.backend.write(
            tab,
            `ssh -F "${ssh('config')}" ${alias}\r`,
          );
          await eventually(() =>
            expect(harness.output(tab).slice(before)).toMatch(/password:/i),
          );
          await harness.backend.write(tab, 'pw\r');
          await eventually(() =>
            expect(paneQuestions(tab).length).toBeGreaterThan(asked),
          );
          return paneQuestions(tab).at(-1)!;
        };
        const handWritten = await typed('web1');
        expect(handWritten.moveIn).toBe('web1');
        expect(handWritten).not.toHaveProperty('save');
        await harness.backend.answerSecret(tab, null, false);
        await exitSsh(tab);

        expect((await typed('box')).save).toBe('new');
        await harness.backend.answerSecret(tab, ['pw'], true);
        await eventually(async () =>
          expect(
            JSON.parse(await readFile(ssh('slop-term.json'), 'utf8')).hosts.box
              .credential,
          ).toEqual({ provider: 'keychain', entry: entry(), kind: 'password' }),
        );
        expect(await keychain(entry()).getPassword()).toBe('pw');
      },
      longMs,
    );

    it('writes nothing when the provider refuses the save, and the pane still connects', async () => {
      const tab = await login();
      await harness.backend.answerSecret(
        tab,
        ['pw'],
        { database: 'missing', group: '' },
        { alias: 'web', folder: '' },
      );
      await eventually(() => expect(last(tab)?.notice).toMatch(/^Not saved: /));
      expect(last(tab)?.state).toBe('connected');
      expect(existsSync(ssh('slop-term.conf'))).toBe(false);
      expect(
        await readFile(ssh('slop-term.json'), 'utf8').catch(() => ''),
      ).not.toContain('web');
    });
  });
});
