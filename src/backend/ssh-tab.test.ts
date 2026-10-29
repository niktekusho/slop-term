import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AsyncEntry, findCredentialsAsync } from '@napi-rs/keyring';
import { utils } from 'ssh2';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { CredentialReference, SessionForm, TabId } from '../shared/ipc.ts';
import { startBackend } from './harness.ts';
import { fingerprint, savedKeys } from './known-hosts.ts';
import {
  dockerRunning,
  startAgent,
  startFakeSshServer,
  startSshServer,
} from './ssh-server.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

const eventually = (assertion: () => void) =>
  vi.waitFor(assertion, { timeout: 15_000 });

const knownHosts = () => path.join(harness.home, '.ssh', 'known_hosts');
// OpenSSH expands `~` from the account, not from the temp HOME: test configs name files by absolute path.
const quoted = (file: string) => `"${file.replaceAll('\\', '/')}"`;

// Secrets go to a keychain service of this test run, never the app's own.
const service = `slop-term-test-${process.pid}`;
const keychain = (entry: string) => new AsyncEntry(service, entry);

/**
 * Starts the back end with `config` as `~/.ssh/config` and `managed` as the Managed config, which `config` includes.
 * `$KNOWN` stands for the temp known_hosts.
 */
async function start(
  config: string,
  {
    env = {},
    known,
    managed,
    sidecar,
    imports,
  }: {
    env?: Record<string, string>;
    known?: string;
    managed?: string;
    sidecar?: object;
    imports?: string[];
  } = {},
) {
  harness = await startBackend(
    { '.ssh/id_test': testKey.private, '.ssh/id_locked': lockedKey.private },
    { SLOP_TERM_KEYCHAIN_SERVICE: service, ...env },
    imports,
  );
  const ssh = (name: string) => path.join(harness.home, '.ssh', name);
  const fill = (text: string) =>
    text.replaceAll('$KNOWN', quoted(knownHosts()));
  // OpenSSH reads `Include ~/...` from the account home, so the test names the Managed config by its full path.
  const include = managed ? `Include ${quoted(ssh('slop-term.conf'))}\n` : '';
  if (managed) await writeFile(ssh('slop-term.conf'), fill(managed));
  if (sidecar) await writeFile(ssh('slop-term.json'), JSON.stringify(sidecar));
  await writeFile(ssh('config'), include + fill(config));
  if (known !== undefined) await writeFile(knownHosts(), known);
}

const sidecar = async () =>
  JSON.parse(
    await readFile(path.join(harness.home, '.ssh', 'slop-term.json'), 'utf8'),
  );

// Saving runs after the login, so it can finish after the shell prompt shows.
async function savedCredential(): Promise<CredentialReference> {
  let credential: CredentialReference | undefined;
  await eventually(async () => {
    credential = (await sidecar()).hosts.box.credential;
    expect(credential).toBeDefined();
  });
  return credential!;
}
const savedSecret = (entry: string, secret: string) =>
  eventually(async () =>
    expect(await keychain(entry).getPassword()).toBe(secret),
  );

const dropped = (tab: TabId) =>
  harness.events.filter((e) => e.type === 'dropped' && e.tab === tab);

const question = (tab: TabId) =>
  harness.events.flatMap((e) =>
    e.type === 'hostKey' && e.tab === tab ? [e.question] : [],
  );

const checklist = (test: TabId) =>
  harness.events
    .flatMap((e) => (e.type === 'test' && e.tab === test ? [e.steps] : []))
    .at(-1);

async function loggedIn(tab: TabId) {
  await eventually(() => expect(harness.output(tab)).toContain('$ '));
  await harness.backend.write(tab, 'echo slop-$((6*7))\r');
  await eventually(() => expect(harness.output(tab)).toContain('slop-42'));
}

const testKey = utils.generateKeyPairSync('ed25519');
const lockedKey = utils.generateKeyPairSync('ed25519', {
  passphrase: 'open sesame',
  cipher: 'aes256-ctr',
  rounds: 16,
});

it('refuses a host that uses a jump host', async () => {
  await start('Host hop\n  ProxyJump bastion\n');
  const tab = await harness.backend.openSsh('hop');
  await eventually(() =>
    expect(dropped(tab)).toEqual([
      {
        type: 'dropped',
        tab,
        reason: "This host uses a jump host. slop-term v1 can't connect to it.",
        final: true,
      },
    ]),
  );
});

describe('drop and reconnect against an in-process server', () => {
  let fake: Awaited<ReturnType<typeof startFakeSshServer>>;
  beforeAll(async () => {
    fake = await startFakeSshServer();
  });
  afterAll(() => fake.stop());

  const fakeHost = (extra = '') =>
    [
      'Host box',
      '  HostName 127.0.0.1',
      `  Port ${fake.port}`,
      '  User test',
      '  IdentityFile ~/.ssh/id_test',
      '  UserKnownHostsFile /dev/null',
      '  StrictHostKeyChecking no',
      extra,
    ].join('\n');
  const connected = (tab: TabId) =>
    eventually(() =>
      expect(harness.events).toContainEqual({ type: 'connected', tab }),
    );

  it('reports a closed connection as a drop at once, not as an exit', async () => {
    await start(fakeHost());
    const tab = await harness.backend.openSsh('box');
    await connected(tab);
    fake.dropAll();
    await eventually(() =>
      expect(dropped(tab)).toEqual([
        { type: 'dropped', tab, reason: 'Connection closed.' },
      ]),
    );
    expect(harness.events.some((e) => e.type === 'exit')).toBe(false);
  });

  it('reports a shell that closes with no exit status as a drop', async () => {
    await start(fakeHost());
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(harness.output(tab)).toContain('$ '));
    fake.closeShells();
    await eventually(() =>
      expect(dropped(tab)).toEqual([
        { type: 'dropped', tab, reason: 'Connection closed.' },
      ]),
    );
    expect(harness.events.some((e) => e.type === 'exit')).toBe(false);
  });

  it('sends one keepalive on every SSH Tab when the computer wakes', async () => {
    await start(fakeHost('  ServerAliveInterval 600'));
    const tabs = [
      await harness.backend.openSsh('box'),
      await harness.backend.openSsh('box'),
    ];
    for (const tab of tabs) await connected(tab);
    const before = fake.keepalives();
    await harness.backend.wake();
    await eventually(() => expect(fake.keepalives()).toBe(before + 2));
  });

  const managedConfig = () => path.join(harness.home, '.ssh', 'slop-term.conf');
  async function openAndDrop() {
    const tab = await harness.backend.openSsh('box');
    await connected(tab);
    fake.dropAll();
    await eventually(() => expect(dropped(tab)).toHaveLength(1));
    return tab;
  }
  const connections = (tab: TabId) =>
    harness.events.filter((e) => e.type === 'connected' && e.tab === tab);

  it('reconnects with the values of a Saved session edited during the drop', async () => {
    await start('', { managed: fakeHost() });
    const tab = await openAndDrop();
    await writeFile(managedConfig(), fakeHost().replace('test', 'alice'));
    await harness.backend.restart(tab);
    await eventually(() => expect(connections(tab)).toHaveLength(2));
    expect(harness.events).toContainEqual({
      type: 'tab',
      tab,
      address: 'alice@127.0.0.1',
    });
    expect(fake.users.at(-1)).toBe('alice');
  });

  it('reconnects without asking again about the host key the Tab accepted', async () => {
    await start(fakeHost().replace('StrictHostKeyChecking no', ''));
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(question(tab)).toHaveLength(1));
    await harness.backend.answerHostKey(tab, true);
    await connected(tab);
    fake.dropAll();
    await eventually(() => expect(dropped(tab)).toHaveLength(1));
    await harness.backend.restart(tab);
    await eventually(() => expect(connections(tab)).toHaveLength(2));
    expect(question(tab)).toHaveLength(1);
  });

  it('asks the keyboard-interactive questions again on a reconnect', async () => {
    const twoFactor = await startFakeSshServer({ code: '424242' });
    try {
      await start(
        fakeHost().replace(`Port ${fake.port}`, `Port ${twoFactor.port}`),
      );
      const codes = (tab: TabId) =>
        harness.events.filter(
          (e) => e.type === 'secret' && e.tab === tab && e.question,
        );
      const tab = await harness.backend.openSsh('box');
      await eventually(() => expect(codes(tab)).toHaveLength(1));
      await harness.backend.answerSecret(tab, ['424242'], false);
      await connected(tab);
      twoFactor.dropAll();
      await eventually(() => expect(dropped(tab)).toHaveLength(1));

      await harness.backend.restart(tab);
      await eventually(() => expect(codes(tab)).toHaveLength(2));
      expect(codes(tab)[1]).toMatchObject({
        question: { prompts: [{ prompt: 'Verification code: ', echo: true }] },
      });
      await harness.backend.answerSecret(tab, ['424242'], false);
      await eventually(() => expect(connections(tab)).toHaveLength(2));
    } finally {
      await twoFactor.stop();
    }
  });

  it('leaves a connected Tab alone when its Saved session is edited', async () => {
    await start('', { managed: fakeHost() });
    const tab = await harness.backend.openSsh('box');
    await connected(tab);
    const { read, ...form } = await harness.backend.getSession('box');
    await harness.backend.saveSession(
      { ...form, user: 'alice' },
      { alias: 'box', read },
    );
    const before = fake.keepalives();
    await harness.backend.wake();
    await eventually(() => expect(fake.keepalives()).toBe(before + 1));
    expect(dropped(tab)).toEqual([]);
    expect(connections(tab)).toHaveLength(1);
  });

  it('reconnects under the new alias after a rename in the dialog', async () => {
    await start('', { managed: fakeHost() });
    const tab = await openAndDrop();
    const { read, ...form } = await harness.backend.getSession('box');
    await harness.backend.saveSession(
      { ...form, alias: 'box-prod' },
      { alias: 'box', read },
    );
    await harness.backend.restart(tab);
    await eventually(() => expect(connections(tab)).toHaveLength(2));
  });

  it('fails a Test at SFTP on a server without the SFTP subsystem', async () => {
    await start('');
    const test = await harness.backend.testSession({
      alias: 'box',
      folder: '',
      hostname: '127.0.0.1',
      port: String(fake.port),
      user: 'test',
      identityFile: '~/.ssh/id_test',
      options: ['UserKnownHostsFile /dev/null', 'StrictHostKeyChecking no'],
    });
    await eventually(() =>
      expect(checklist(test)).toEqual([
        { label: 'resolved', state: 'passed' },
        { label: `reached 127.0.0.1:${fake.port}`, state: 'passed' },
        { label: 'host key', state: 'passed' },
        { label: 'logged in as test', state: 'passed' },
        { label: 'SFTP', state: 'failed', reason: expect.any(String) },
      ]),
    );
  });

  it('refuses for good to reconnect a Saved session deleted during the drop', async () => {
    await start('', { managed: fakeHost() });
    const tab = await openAndDrop();
    await writeFile(managedConfig(), '');
    await harness.backend.restart(tab);
    await eventually(() =>
      expect(dropped(tab).at(-1)).toEqual({
        type: 'dropped',
        tab,
        reason: 'This Saved session no longer exists.',
        final: true,
      }),
    );
    expect(connections(tab)).toHaveLength(1);
  });
});

const docker = await dockerRunning();
if (!docker)
  console.warn('Docker is not running: skipping the SSH server tests.');

describe.skipIf(!docker)('SSH Tab against OpenSSH in Docker', () => {
  let server: Awaited<ReturnType<typeof startSshServer>>;
  beforeAll(async () => {
    server = await startSshServer(
      [testKey.public, lockedKey.public],
      'hunter2',
    );
  }, 90_000);
  afterAll(() => server?.stop());

  const host = (extra = '') =>
    [
      'Host box',
      '  HostName 127.0.0.1',
      `  Port ${server.port}`,
      '  User test',
      '  IdentityFile ~/.ssh/id_test',
      '  UserKnownHostsFile $KNOWN',
      extra,
    ].join('\n');
  const name = () => `[127.0.0.1]:${server.port}`;

  it('logs in with a key and saves an unknown key silently with accept-new', async () => {
    await start(host('  StrictHostKeyChecking accept-new'));
    const tab = await harness.backend.openSsh('box');
    await loggedIn(tab);
    expect(question(tab)).toEqual([]);
    expect(await readFile(knownHosts(), 'utf8')).toBe(
      `${name()} ssh-ed25519 ${server.ed25519}\n`,
    );
  });

  // ssh2 and OpenSSH both give up on the keepalive after the last allowed miss: interval × (count + 1).
  it('drops a Tab whose server stops answering after ServerAliveCountMax missed keepalives', async () => {
    await start(
      host(
        '  StrictHostKeyChecking accept-new\n  ServerAliveInterval 1\n  ServerAliveCountMax 2',
      ),
    );
    const tab = await harness.backend.openSsh('box');
    await loggedIn(tab);
    await server.pause();
    try {
      const paused = Date.now();
      await eventually(() =>
        expect(dropped(tab)).toEqual([
          { type: 'dropped', tab, reason: 'Keepalive timeout' },
        ]),
      );
      expect(Date.now() - paused).toBeLessThan(5_000);
    } finally {
      await server.unpause();
    }
  });

  it('reports user@host, the OSC 7 folder and the exit code', async () => {
    await start(host('  StrictHostKeyChecking accept-new'));
    const tab = await harness.backend.openSsh('box');
    await loggedIn(tab);
    await harness.backend.write(
      tab,
      "printf '\\033]7;file://box/home/test\\007'; exit 4\r",
    );
    await eventually(() =>
      expect(harness.events).toEqual(
        expect.arrayContaining([
          { type: 'tab', tab, address: 'test@127.0.0.1' },
          { type: 'tab', tab, folder: '/home/test' },
          { type: 'exit', tab, code: 4 },
        ]),
      ),
    );
  });

  it('logs in through the agent and saves nothing with UserKnownHostsFile /dev/null', async () => {
    const agent = await startAgent(testKey.private);
    try {
      await start(
        host('  StrictHostKeyChecking no')
          .replace('~/.ssh/id_test', '~/.ssh/missing')
          .replace('$KNOWN', '/dev/null'),
        { env: { SSH_AUTH_SOCK: agent.socket } },
      );
      const tab = await harness.backend.openSsh('box');
      await loggedIn(tab);
      expect(existsSync(knownHosts())).toBe(false);
    } finally {
      await agent.stop();
    }
  });

  it('asks about an unknown host and saves the key when trusted', async () => {
    await start(host());
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(question(tab)).toEqual([
        {
          kind: 'unknown',
          alias: 'box',
          host: `127.0.0.1:${server.port}`,
          type: 'ssh-ed25519',
          fingerprint: fingerprint(server.ed25519),
        },
      ]),
    );
    expect(existsSync(knownHosts())).toBe(false);
    await harness.backend.answerHostKey(tab, true);
    await loggedIn(tab);
    expect(await readFile(knownHosts(), 'utf8')).toBe(
      `${name()} ssh-ed25519 ${server.ed25519}\n`,
    );
  });

  it('connects nowhere and saves nothing when the question is cancelled', async () => {
    await start(host('  StrictHostKeyChecking ask'));
    const tab = await harness.backend.openSsh('box');
    await eventually(() => expect(question(tab)).toHaveLength(1));
    await harness.backend.answerHostKey(tab, false);
    await eventually(() =>
      expect(dropped(tab)).toEqual([
        {
          type: 'dropped',
          tab,
          reason: 'Not connected: the host key was not trusted.',
        },
      ]),
    );
    expect(existsSync(knownHosts())).toBe(false);
  });

  it('blocks a changed key even with StrictHostKeyChecking no, and replaces it', async () => {
    const stale = utils.generateKeyPairSync('ed25519').public.split(' ')[1];
    await start(host('  StrictHostKeyChecking no'), {
      known: `@revoked * ssh-rsa AAAA\n${name()} ssh-ed25519 ${stale}\nother ssh-ed25519 ${stale}\n`,
    });
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(question(tab)).toEqual([
        {
          kind: 'changed',
          alias: 'box',
          host: `127.0.0.1:${server.port}`,
          type: 'ssh-ed25519',
          fingerprint: fingerprint(server.ed25519),
          old: { fingerprint: fingerprint(stale), file: knownHosts(), line: 2 },
        },
      ]),
    );
    await harness.backend.answerHostKey(tab, true);
    await loggedIn(tab);
    expect(await readFile(knownHosts(), 'utf8')).toBe(
      `@revoked * ssh-rsa AAAA\nother ssh-ed25519 ${stale}\n${name()} ssh-ed25519 ${server.ed25519}\n`,
    );
  });

  it('writes a hashed entry when HashKnownHosts is yes', async () => {
    await start(
      host('  StrictHostKeyChecking accept-new\n  HashKnownHosts yes'),
    );
    const tab = await harness.backend.openSsh('box');
    await loggedIn(tab);
    const text = await readFile(knownHosts(), 'utf8');
    expect(text).toMatch(/^\|1\|/);
    expect(savedKeys('f', text, name())).toMatchObject([
      { type: 'ssh-ed25519', key: server.ed25519 },
    ]);
  });

  it('asks for the saved key type first, so a saved RSA key connects without a question', async () => {
    await start(host(), { known: `${name()} ssh-rsa ${server.rsa}\n` });
    const tab = await harness.backend.openSsh('box');
    await loggedIn(tab);
    expect(question(tab)).toEqual([]);
  });

  it('counts a host that offers none of the saved key types as unknown', async () => {
    await start(host(), {
      known: `${name()} ecdsa-sha2-nistp521 AAAAE2VjZHNhLXNoYTItbmlzdHA1MjE=\n`,
    });
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(question(tab)).toMatchObject([
        {
          kind: 'unknown',
          type: 'ssh-ed25519',
          savedType: 'ecdsa-sha2-nistp521',
        },
      ]),
    );
  });

  describe('password and passphrase login', () => {
    afterEach(async () => {
      for (const { account } of await findCredentialsAsync(service))
        await keychain(account).deletePassword();
    });
    const passwordHost = () =>
      host('  StrictHostKeyChecking accept-new').replace(
        '~/.ssh/id_test',
        '~/.ssh/missing',
      );
    const asked = (tab: TabId) =>
      harness.events.flatMap((e) =>
        e.type === 'secret' && e.tab === tab ? [e.question] : [],
      );
    const password = {
      alias: 'box',
      title: 'Password for test@127.0.0.1',
      prompts: [{ prompt: 'Password', echo: false }],
    };
    async function savedReference(entry: string, secret: string) {
      await keychain(entry).setPassword(secret);
      const credential: CredentialReference = {
        provider: 'keychain',
        entry,
        kind: 'password',
      };
      return { hosts: { box: { credential } } };
    }

    it('asks for a password on a Saved session, logs in and saves it under user@host-port, next to a taken name', async () => {
      const account = `test@127.0.0.1-${server.port}`;
      await keychain(account).setPassword('someone else');
      await start('', { managed: passwordHost() });
      const tab = await harness.backend.openSsh('box');
      await eventually(() =>
        expect(asked(tab)).toEqual([{ ...password, save: 'new' }]),
      );
      await harness.backend.answerSecret(tab, ['hunter2'], true);
      await loggedIn(tab);
      const credential = await savedCredential();
      expect(credential).toEqual({
        provider: 'keychain',
        entry: `${account}-2`,
        kind: 'password',
      });
      await savedSecret(credential.entry, 'hunter2');
      expect(await keychain(account).getPassword()).toBe('someone else');
    });

    it('offers no save on a Hand-written host', async () => {
      await start(passwordHost());
      const tab = await harness.backend.openSsh('box');
      await eventually(() => expect(asked(tab)).toEqual([password]));
      await harness.backend.answerSecret(tab, ['hunter2'], true);
      await loggedIn(tab);
      expect(
        existsSync(path.join(harness.home, '.ssh', 'slop-term.json')),
      ).toBe(false);
    });

    it('connects without asking when the saved password reads fine', async () => {
      const entry = `ok-${process.pid}`;
      await start('', {
        managed: passwordHost(),
        sidecar: await savedReference(entry, 'hunter2'),
      });
      const tab = await harness.backend.openSsh('box');
      await loggedIn(tab);
      expect(asked(tab)).toEqual([]);
    });

    it('shows why a read failed, asks and saves under the same reference', async () => {
      const entry = `missing-${process.pid}`;
      const reference = await savedReference(entry, 'unused');
      await keychain(entry).deletePassword();
      await start('', { managed: passwordHost(), sidecar: reference });
      const tab = await harness.backend.openSsh('box');
      await eventually(() =>
        expect(asked(tab)).toEqual([
          {
            ...password,
            reason: 'No saved password in the keychain on this machine.',
            save: 'same',
          },
        ]),
      );
      await harness.backend.answerSecret(tab, ['hunter2'], true);
      await loggedIn(tab);
      await savedSecret(entry, 'hunter2');
      expect(await sidecar()).toEqual(reference);
    });

    it('asks again with "Update saved secret" when the saved password is wrong', async () => {
      const entry = `wrong-${process.pid}`;
      await start('', {
        managed: passwordHost(),
        sidecar: await savedReference(entry, 'wrong'),
      });
      const tab = await harness.backend.openSsh('box');
      await eventually(() =>
        expect(asked(tab)).toEqual([
          {
            ...password,
            reason: 'The saved password was rejected.',
            save: 'update',
          },
        ]),
      );
      await harness.backend.answerSecret(tab, ['hunter2'], true);
      await loggedIn(tab);
      await savedSecret(entry, 'hunter2');
    });

    it('unlocks a key with a passphrase and saves it as a passphrase', async () => {
      await start('', {
        managed: host('  StrictHostKeyChecking accept-new').replace(
          '~/.ssh/id_test',
          '~/.ssh/id_locked',
        ),
      });
      const tab = await harness.backend.openSsh('box');
      await eventually(() =>
        expect(asked(tab)).toMatchObject([
          {
            title: expect.stringMatching(/^Passphrase for .*id_locked$/),
            prompts: [{ prompt: 'Passphrase', echo: false }],
            save: 'new',
          },
        ]),
      );
      await harness.backend.answerSecret(tab, ['open sesame'], true);
      await loggedIn(tab);
      const credential = await savedCredential();
      expect(credential).toEqual({
        provider: 'keychain',
        entry: 'passphrase-id_locked',
        kind: 'passphrase',
      });
      expect(await keychain(credential.entry).getPassword()).toBe(
        'open sesame',
      );
    });

    it('shows a refusal as one line and still logs in with the typed password', async () => {
      const reference = {
        hosts: {
          box: {
            credential: { provider: 'refusing', entry: '7', kind: 'password' },
          },
        },
      };
      await start('', {
        managed: passwordHost(),
        sidecar: reference,
        imports: [path.join(import.meta.dirname, 'refusing-provider.ts')],
      });
      const tab = await harness.backend.openSsh('box');
      await eventually(() =>
        expect(asked(tab)).toEqual([
          {
            ...password,
            reason: 'The refusing provider has no secrets.',
            save: 'same',
          },
        ]),
      );
      await harness.backend.answerSecret(tab, ['hunter2'], true);
      await loggedIn(tab);
      await eventually(() =>
        expect(harness.output(tab)).toContain(
          '\r\nNot saved: The refusing provider is read-only.\r\n',
        ),
      );
      expect(await sidecar()).toEqual(reference);
    });

    it('stops with a conflict when the Sidecar entry changed while asking, keeping the saved secret', async () => {
      await start('', { managed: passwordHost(), sidecar: { hosts: {} } });
      const tab = await harness.backend.openSsh('box');
      await eventually(() => expect(asked(tab)).toHaveLength(1));
      const edited = { hosts: { box: { folder: 'Work' } } };
      await writeFile(
        path.join(harness.home, '.ssh', 'slop-term.json'),
        JSON.stringify(edited),
      );
      await harness.backend.answerSecret(tab, ['hunter2'], true);
      await loggedIn(tab);
      await eventually(() =>
        expect(harness.output(tab)).toContain(
          'Not saved: slop-term.json changed for box since it was read.',
        ),
      );
      expect(await sidecar()).toEqual(edited);
      const [kept] = await findCredentialsAsync(service);
      expect(kept.password).toBe('hunter2');
    });

    it('closes the Tab when the user cancels the question', async () => {
      await start(passwordHost());
      const tab = await harness.backend.openSsh('box');
      await eventually(() => expect(asked(tab)).toHaveLength(1));
      await harness.backend.answerSecret(tab, null, false);
      await eventually(() =>
        expect(dropped(tab)).toEqual([
          { type: 'dropped', tab, reason: 'Not connected: login cancelled.' },
        ]),
      );
    });
  });

  describe('Test button', () => {
    const form = (patch: Partial<SessionForm> = {}): SessionForm => ({
      alias: 'box',
      folder: '',
      hostname: '127.0.0.1',
      port: String(server.port),
      user: 'test',
      identityFile: '~/.ssh/id_test',
      options: [`UserKnownHostsFile ${quoted(knownHosts())}`],
      ...patch,
    });
    const labels = () => [
      'resolved',
      `reached 127.0.0.1:${server.port}`,
      'host key',
      'logged in as test',
      'SFTP',
    ];

    it('resolves the unsaved values, asks about an unknown host inside the host key step, saves it on Trust, logs in and opens SFTP', async () => {
      await start('');
      const test = await harness.backend.testSession(form());
      await eventually(() =>
        expect(checklist(test)).toEqual([
          { label: 'resolved', state: 'passed' },
          { label: `reached 127.0.0.1:${server.port}`, state: 'passed' },
          { label: 'host key', state: 'waiting' },
          { label: 'logged in as test', state: 'waiting' },
          { label: 'SFTP', state: 'waiting' },
        ]),
      );
      await eventually(() =>
        expect(question(test)).toEqual([
          expect.objectContaining({ kind: 'unknown', alias: 'box' }),
        ]),
      );
      await harness.backend.answerHostKey(test, true);
      await eventually(() =>
        expect(checklist(test)).toEqual(
          labels().map((label) => ({ label, state: 'passed' })),
        ),
      );
      expect(await readFile(knownHosts(), 'utf8')).toBe(
        `${name()} ssh-ed25519 ${server.ed25519}\n`,
      );
      expect(
        existsSync(path.join(harness.home, '.ssh', 'slop-term.conf')),
      ).toBe(false);
    });

    it('fails at resolved with the jump-host message', async () => {
      await start('');
      const test = await harness.backend.testSession(
        form({ options: ['ProxyJump bastion'] }),
      );
      await eventually(() =>
        expect(checklist(test)).toEqual([
          {
            label: 'resolved',
            state: 'failed',
            reason:
              "This host uses a jump host. slop-term v1 can't connect to it.",
          },
          ...['reached', 'host key', 'logged in', 'SFTP'].map((label) => ({
            label,
            state: 'waiting',
          })),
        ]),
      );
    });

    it('fails at reached when nothing listens on the port', async () => {
      await start('');
      const test = await harness.backend.testSession(form({ port: '1' }));
      await eventually(() =>
        expect(checklist(test)).toEqual([
          { label: 'resolved', state: 'passed' },
          {
            label: 'reached 127.0.0.1:1',
            state: 'failed',
            reason: expect.stringContaining('ECONNREFUSED'),
          },
          { label: 'host key', state: 'waiting' },
          { label: 'logged in as test', state: 'waiting' },
          { label: 'SFTP', state: 'waiting' },
        ]),
      );
    });

    it('fails at host key when the user cancels the question, saving nothing', async () => {
      await start('');
      const test = await harness.backend.testSession(form());
      await eventually(() => expect(question(test)).toHaveLength(1));
      await harness.backend.answerHostKey(test, false);
      await eventually(() =>
        expect(checklist(test)).toEqual([
          { label: 'resolved', state: 'passed' },
          { label: `reached 127.0.0.1:${server.port}`, state: 'passed' },
          {
            label: 'host key',
            state: 'failed',
            reason: 'Not connected: the host key was not trusted.',
          },
          { label: 'logged in as test', state: 'waiting' },
          { label: 'SFTP', state: 'waiting' },
        ]),
      );
      expect(existsSync(knownHosts())).toBe(false);
    });

    describe('login', () => {
      afterEach(async () => {
        for (const { account } of await findCredentialsAsync(service))
          await keychain(account).deletePassword();
      });
      const noKey = (patch: Partial<SessionForm> = {}) =>
        form({
          identityFile: '~/.ssh/missing',
          options: [
            `UserKnownHostsFile ${quoted(knownHosts())}`,
            'StrictHostKeyChecking accept-new',
          ],
          ...patch,
        });
      const asked = (test: TabId) =>
        harness.events.flatMap((e) =>
          e.type === 'secret' && e.tab === test ? [e.question] : [],
        );
      const allPassed = () =>
        eventually(() =>
          expect(checklist(test)).toEqual(
            labels().map((label) => ({ label, state: 'passed' })),
          ),
        );
      let test: TabId;

      it('asks for a password used for the test alone when no secret is attached, offering no save', async () => {
        await start('', { managed: 'Host box\n  HostName 127.0.0.1\n' });
        test = await harness.backend.testSession(noKey());
        await eventually(() =>
          expect(asked(test)).toEqual([
            {
              alias: 'box',
              title: 'Password for test@127.0.0.1',
              prompts: [{ prompt: 'Password', echo: false }],
            },
          ]),
        );
        await harness.backend.answerSecret(test, ['hunter2'], true);
        await allPassed();
        expect(await findCredentialsAsync(service)).toEqual([]);
        expect(
          existsSync(path.join(harness.home, '.ssh', 'slop-term.json')),
        ).toBe(false);
      });

      it("logs in with the form's Credential reference without asking", async () => {
        const entry = `test-ref-${process.pid}`;
        await keychain(entry).setPassword('hunter2');
        await start('');
        test = await harness.backend.testSession(
          noKey({
            credential: { provider: 'keychain', entry, kind: 'password' },
          }),
        );
        await allPassed();
        expect(asked(test)).toEqual([]);
      });

      it('logs in with a secret set in the form but not saved yet', async () => {
        await start('');
        test = await harness.backend.testSession(noKey(), {
          kind: 'password',
          secret: 'hunter2',
        });
        await allPassed();
        expect(asked(test)).toEqual([]);
        expect(await findCredentialsAsync(service)).toEqual([]);
      });

      it('fails at logged in when the user cancels the password question', async () => {
        await start('');
        test = await harness.backend.testSession(noKey());
        await eventually(() => expect(asked(test)).toHaveLength(1));
        await harness.backend.answerSecret(test, null, false);
        await eventually(() =>
          expect(checklist(test)).toEqual([
            { label: 'resolved', state: 'passed' },
            { label: `reached 127.0.0.1:${server.port}`, state: 'passed' },
            { label: 'host key', state: 'passed' },
            {
              label: 'logged in as test',
              state: 'failed',
              reason: 'Not connected: login cancelled.',
            },
            { label: 'SFTP', state: 'waiting' },
          ]),
        );
      });
    });
  });
});
