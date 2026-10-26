import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
import type { TabId } from '../shared/ipc.ts';
import { startBackend } from './harness.ts';
import { fingerprint, savedKeys } from './known-hosts.ts';
import { dockerRunning, startAgent, startSshServer } from './ssh-server.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

const eventually = (assertion: () => void) =>
  vi.waitFor(assertion, { timeout: 15_000 });

const knownHosts = () => path.join(harness.home, '.ssh', 'known_hosts');
// OpenSSH expands `~` from the account, not from the temp HOME: test configs name files by absolute path.
const quoted = (file: string) => `"${file.replaceAll('\\', '/')}"`;

/** Starts the back end with `config` as `~/.ssh/config`; `$KNOWN` stands for the temp known_hosts. */
async function start(
  config: string,
  { env = {}, known }: { env?: Record<string, string>; known?: string } = {},
) {
  harness = await startBackend({ '.ssh/id_test': testKey.private }, env);
  await writeFile(
    path.join(harness.home, '.ssh', 'config'),
    config.replaceAll('$KNOWN', quoted(knownHosts())),
  );
  if (known !== undefined) await writeFile(knownHosts(), known);
}

const question = (tab: TabId) =>
  harness.events.flatMap((e) =>
    e.type === 'hostKey' && e.tab === tab ? [e.question] : [],
  );

async function loggedIn(tab: TabId) {
  await eventually(() => expect(harness.output(tab)).toContain('$ '));
  await harness.backend.write(tab, 'echo slop-$((6*7))\r');
  await eventually(() => expect(harness.output(tab)).toContain('slop-42'));
}

const testKey = utils.generateKeyPairSync('ed25519');

it('refuses a host that uses a jump host', async () => {
  await start('Host hop\n  ProxyJump bastion\n');
  const tab = await harness.backend.openSsh('hop');
  await eventually(() =>
    expect(harness.output(tab)).toContain(
      "This host uses a jump host. slop-term v1 can't connect to it.",
    ),
  );
});

const docker = await dockerRunning();
if (!docker)
  console.warn('Docker is not running: skipping the SSH server tests.');

describe.skipIf(!docker)('SSH Tab against OpenSSH in Docker', () => {
  let server: Awaited<ReturnType<typeof startSshServer>>;
  beforeAll(async () => {
    server = await startSshServer(testKey.public);
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
      expect(harness.output(tab)).toContain(
        'Not connected: the host key was not trusted.',
      ),
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
});
