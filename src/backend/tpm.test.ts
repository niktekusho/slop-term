import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
import {
  findKeychainCredentials,
  keychainEntry,
  startBackend,
} from './harness.ts';
import { startFakeSshServer } from './ssh-server.ts';
import { startFakeTpm } from './tpm-server.ts';

// Secrets go to a keychain service of this test run, never the app's own.
const service = `slop-term-test-tpm-${process.pid}`;
const keys = { publicKey: 'pub-123', privateKey: 'priv-456' };
const entries = [
  { id: 42, name: 'web prod', username: 'bob', password: 'hunter2' },
  { id: 43, name: 'web staging', username: 'carol', password: 'swordfish' },
  { id: 44, name: 'shared root', username: '', password: 'toor' },
];

let tpm: Awaited<ReturnType<typeof startFakeTpm>>;
beforeAll(async () => {
  tpm = await startFakeTpm(keys, entries);
});
afterAll(() => tpm.stop());

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(async () => {
  await harness.stop();
  tpm.requests.length = 0;
  for (const { account } of await findKeychainCredentials(service))
    await keychainEntry(service, account).deletePassword();
});

async function start({ files = {}, tpmUrl = tpm.url } = {}) {
  harness = await startBackend(
    {
      ...(tpmUrl && { 'settings.json': JSON.stringify({ tpmUrl }) }),
      ...files,
    },
    { SLOP_TERM_KEYCHAIN_SERVICE: service },
  );
}

const listed = (id: number) => {
  const { password: _, ...entry } = entries.find((e) => e.id === id)!;
  return { ...entry, id: String(id) };
};

it('reads an entry by its numeric id or by its URL with signed requests', async () => {
  await start();
  await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
  expect(await harness.backend.findTpm(' 42 ')).toEqual({
    entries: [listed(42)],
  });
  expect(
    await harness.backend.findTpm('https://tpm.example/index.php/pwd/view/43'),
  ).toEqual({ entries: [listed(43)] });
  expect(tpm.requests).toEqual([
    { method: 'GET', path: '/index.php/api/v6/passwords/42.json' },
    { method: 'GET', path: '/index.php/api/v6/passwords/43.json' },
  ]);
});

it('asks for the API keys before the first read, and keeps them in the keychain', async () => {
  await start();
  expect(await harness.backend.findTpm('42')).toEqual({
    keys: 'TPM needs your API keys, from My Account > API Keys in TPM.',
  });
  expect(tpm.requests).toEqual([]);
  await harness.backend.setTpmKeys(
    ` ${keys.publicKey}`,
    `${keys.privateKey}\n`,
  );
  expect(await harness.backend.findTpm('42')).toEqual({
    entries: [listed(42)],
  });
  expect(await findKeychainCredentials(service)).toHaveLength(1);
});

it('asks for the API keys again after a 401', async () => {
  await start();
  await harness.backend.setTpmKeys(keys.publicKey, 'renewed elsewhere');
  expect(await harness.backend.findTpm('42')).toEqual({
    keys: 'TPM rejected the API keys.',
  });
});

it('searches TPM for any text that is not an id or a URL', async () => {
  await start();
  await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
  expect(await harness.backend.findTpm('web')).toEqual({
    entries: [listed(42), listed(43)],
  });
  expect(await harness.backend.findTpm('web prod/2')).toEqual({ entries: [] });
  expect(tpm.requests.map((r) => r.path)).toEqual([
    '/index.php/api/v6/passwords/search/web.json',
    '/index.php/api/v6/passwords/search/web%20prod%2F2.json',
  ]);
});

it("says TPM isn't set up on a machine without a TPM address", async () => {
  await start({ tpmUrl: '' });
  await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
  await expect(harness.backend.findTpm('42')).rejects.toThrow(
    "TPM isn't set up on this machine.",
  );
});

describe('connecting with a TPM reference', () => {
  let ssh: Awaited<ReturnType<typeof startFakeSshServer>>;
  beforeAll(async () => {
    ssh = await startFakeSshServer({ password: 'hunter2' });
  });
  afterAll(() => ssh.stop());
  afterEach(() => {
    ssh.users.length = 0;
  });

  const eventually = (assertion: () => void) =>
    vi.waitFor(assertion, { timeout: 15_000 });

  /** A Managed host `box` that logs in as `user` with the password in TPM entry `id`. */
  async function managed(id: number, user: string, tpmUrl = tpm.url) {
    await start({ tpmUrl });
    const file = (name: string) => path.join(harness.home, '.ssh', name);
    await mkdir(path.dirname(file('config')), { recursive: true });
    await writeFile(
      file('slop-term.conf'),
      [
        'Host box',
        '  HostName 127.0.0.1',
        `  Port ${ssh.port}`,
        `  User ${user}`,
        '  IdentityFile ~/.ssh/missing',
        '  UserKnownHostsFile /dev/null',
        '  StrictHostKeyChecking no',
        '',
      ].join('\n'),
    );
    await writeFile(file('slop-term.json'), JSON.stringify(sidecar(id)));
    // OpenSSH reads `Include ~/...` from the account home, so the test names the Managed config by its full path.
    await writeFile(
      file('config'),
      `Include "${file('slop-term.conf').replaceAll('\\', '/')}"\n`,
    );
  }
  const sidecar = (id: number) => ({
    hosts: {
      box: {
        credential: { provider: 'tpm', entry: String(id), kind: 'password' },
      },
    },
  });
  const asked = (tab: TabId) =>
    harness.events.flatMap((e) =>
      e.type === 'secret' && e.tab === tab ? [e.question] : [],
    );
  const dropped = (tab: TabId) =>
    harness.events.filter((e) => e.type === 'dropped' && e.tab === tab);
  const loggedIn = (tab: TabId) =>
    eventually(() => expect(harness.output(tab)).toContain('$ '));
  const password = {
    alias: 'box',
    title: 'Password for bob@127.0.0.1',
    prompts: [{ prompt: 'Password', echo: false }],
  };

  it('logs in with the password from TPM without asking', async () => {
    await managed(42, 'bob');
    await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
    const tab = await harness.backend.openSsh('box');
    await loggedIn(tab);
    expect(asked(tab)).toEqual([]);
    expect(ssh.users.at(-1)).toBe('bob');
  });

  it('asks for the API keys inside the Tab when none are saved, then logs in', async () => {
    await managed(42, 'bob');
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(asked(tab)).toEqual([
        {
          alias: 'box',
          title: 'TPM API keys',
          prompts: [
            { prompt: 'Public key', echo: true },
            { prompt: 'Private key', echo: false },
          ],
          reason: 'TPM needs your API keys, from My Account > API Keys in TPM.',
        },
      ]),
    );
    await harness.backend.answerSecret(
      tab,
      [keys.publicKey, keys.privateKey],
      false,
    );
    await loggedIn(tab);
    expect(asked(tab)).toHaveLength(1);
    expect(await findKeychainCredentials(service)).toHaveLength(1);
  });

  it('asks for the keys again in the Tab after a 401', async () => {
    await managed(42, 'bob');
    await harness.backend.setTpmKeys(keys.publicKey, 'expired');
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(asked(tab)).toMatchObject([
        { title: 'TPM API keys', reason: 'TPM rejected the API keys.' },
      ]),
    );
  });

  it("asks for the password on a machine where TPM isn't set up, and refuses to save it to TPM", async () => {
    await managed(42, 'bob', '');
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(asked(tab)).toEqual([
        {
          ...password,
          reason: "TPM isn't set up on this machine.",
          save: 'same',
        },
      ]),
    );
    await harness.backend.answerSecret(tab, ['hunter2'], true);
    await loggedIn(tab);
    await eventually(() =>
      expect(harness.output(tab)).toContain(
        '\r\nNot saved: TPM is read-only in slop-term.\r\n',
      ),
    );
    expect(tpm.requests).toEqual([]);
    const written = await readFile(
      path.join(harness.home, '.ssh', 'slop-term.json'),
      'utf8',
    );
    expect(JSON.parse(written)).toEqual(sidecar(42));
  });

  it("blocks the connect when the entry's username differs from User, before any login", async () => {
    await managed(42, 'alice');
    await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
    const tab = await harness.backend.openSsh('box');
    await eventually(() =>
      expect(dropped(tab)).toEqual([
        {
          type: 'dropped',
          tab,
          reason: 'TPM entry says bob, this Saved session says alice.',
          user: 'bob',
        },
      ]),
    );
    expect(ssh.users).toEqual([]);
  });

  it('skips the username check for an entry with no username, and says to update a rejected password in TPM', async () => {
    await managed(44, 'alice');
    await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
    const tab = await harness.backend.openSsh('box');
    // Entry 44's password is wrong for this server: the login runs and the server rejects it.
    await eventually(() =>
      expect(asked(tab)).toEqual([
        {
          ...password,
          title: 'Password for alice@127.0.0.1',
          reason:
            "TPM's password was rejected. Update the entry in TPM, then reconnect.",
        },
      ]),
    );
    expect(ssh.users).toContain('alice');
  });

  it('fails a Test at logged in when the username differs', async () => {
    await managed(42, 'alice');
    await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
    const test = await harness.backend.testSession({
      alias: 'box',
      folder: '',
      hostname: '',
      port: '',
      user: '',
      identityFile: '',
      options: [],
      credential: { provider: 'tpm', entry: '42', kind: 'password' },
    });
    await eventually(() =>
      expect(
        harness.events
          .flatMap((e) =>
            e.type === 'test' && e.tab === test ? [e.steps] : [],
          )
          .at(-1)
          ?.find((s) => s.state === 'failed'),
      ).toEqual({
        label: 'logged in as alice',
        state: 'failed',
        reason: 'TPM entry says bob, this Saved session says alice.',
      }),
    );
  });

  it('never deletes the TPM entry with the last session that uses it', async () => {
    await managed(42, 'bob');
    await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
    const { read } = await harness.backend.getSession('box');
    await harness.backend.deleteSession('box', read, true);
    expect(tpm.requests).toEqual([]);
  });
});

it('shows why TPM has no such entry', async () => {
  await start();
  await harness.backend.setTpmKeys(keys.publicKey, keys.privateKey);
  await expect(harness.backend.findTpm('99')).rejects.toThrow(
    'TPM: Password not found',
  );
});
