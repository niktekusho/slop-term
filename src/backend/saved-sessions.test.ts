import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AsyncEntry } from '@napi-rs/keyring';
import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialReference, SessionForm } from '../shared/ipc.ts';
import { startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

// Secrets go to a keychain service of this test run, never the app's own.
const service = `slop-term-test-${process.pid}`;
const keychain = (entry: string) => new AsyncEntry(service, entry);
const ref = (entry: string): CredentialReference => ({
  provider: 'keychain',
  entry,
  kind: 'password',
});

async function start(files: Record<string, string> = {}) {
  harness = await startBackend(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [`.ssh/${name}`, text]),
    ),
    { SLOP_TERM_KEYCHAIN_SERVICE: service },
  );
  return harness.backend;
}

const file = (name: string) => path.join(harness.home, '.ssh', name);
const read = (name: string) => readFile(file(name), 'utf8');
const sidecar = async () => JSON.parse(await read('slop-term.json'));

const form = (patch: Partial<SessionForm> = {}): SessionForm => ({
  alias: 'web',
  folder: '',
  hostname: '',
  port: '',
  user: '',
  identityFile: '',
  options: [],
  ...patch,
});

describe('saving a new session', () => {
  it('appends a Host block and its Sidecar entry, with the key file as ~/.ssh/<name>', async () => {
    const backend = await start({
      'slop-term.conf': 'Host db\n  HostName db.lan\n',
      'slop-term.json': JSON.stringify({ folders: ['Work'] }),
    });
    const tree = await backend.saveSession(
      form({
        folder: 'Work',
        hostname: '10.0.0.5',
        port: '2222',
        user: 'alice',
        identityFile: path.join(harness.home, '.ssh', 'id_web'),
        options: ['ServerAliveInterval 15', '  '],
      }),
    );
    expect(await read('slop-term.conf')).toBe(
      [
        'Host db',
        '  HostName db.lan',
        '',
        'Host web',
        '  HostName 10.0.0.5',
        '  Port 2222',
        '  User alice',
        '  IdentityFile ~/.ssh/id_web',
        '  ServerAliveInterval 15',
        '',
      ].join('\n'),
    );
    expect(await sidecar()).toEqual({
      folders: ['Work'],
      hosts: { web: { folder: 'Work' } },
    });
    expect(tree.sessions).toEqual([
      { alias: 'db' },
      { alias: 'web', folder: 'Work' },
    ]);
  });

  it('keeps any other key file path as typed', async () => {
    const backend = await start();
    await backend.saveSession(form({ identityFile: 'D:/keys/web key' }));
    expect(await read('slop-term.conf')).toBe(
      'Host web\n  IdentityFile "D:/keys/web key"\n',
    );
  });

  it('rejects an alias taken by a Hand-written host, ignoring case, and writes nothing', async () => {
    const backend = await start({
      config: 'Include ~/.ssh/slop-term.conf\nHost Web\n',
    });
    await expect(backend.saveSession(form())).rejects.toThrow(
      'web is already taken.',
    );
    await expect(read('slop-term.conf')).rejects.toThrow();
  });

  it('rejects an option ssh would not accept, so a typo never breaks ssh', async () => {
    const backend = await start();
    await expect(
      backend.saveSession(form({ options: ['ServerAliveIntervall 15'] })),
    ).rejects.toThrow(/^ssh rejects these values: .*serveraliveintervall/i);
    await expect(
      backend.saveSession(form({ options: ['Port 22'] })),
    ).rejects.toThrow('Set this in the command line above.');
    await expect(read('slop-term.conf')).rejects.toThrow();
  });

  it('saves a new password to the keychain under user@host-port before the files', async () => {
    const backend = await start();
    await backend.saveSession(
      form({ hostname: 'web.lan', port: '2222', user: 'alice' }),
      undefined,
      { set: { kind: 'password', secret: 'hunter2' } },
    );
    const credential = ref('alice@web.lan-2222');
    expect((await sidecar()).hosts.web).toEqual({ credential });
    expect(await keychain(credential.entry).getPassword()).toBe('hunter2');
    await keychain(credential.entry).deletePassword();
  });
});

describe('editing a session', () => {
  const managed = [
    '# Office hosts',
    'Host web',
    '  # the old box',
    '  HostName 10.0.0.5',
    '  Port=2222',
    '  Compression yes',
    '  LocalForward 8080 localhost:80',
    '',
    '# Next one',
    'Host db',
    '  HostName db.lan',
    '',
  ].join('\r\n');

  it('round-trips the fields and options it reads', async () => {
    const backend = await start({
      'slop-term.conf': managed,
      'slop-term.json': JSON.stringify({
        hosts: { web: { folder: 'Work', credential: ref('a@web') } },
      }),
    });
    const { read: _, ...saved } = await backend.getSession('web');
    expect(saved).toEqual(
      form({
        folder: 'Work',
        hostname: '10.0.0.5',
        port: '2222',
        options: ['Compression yes', 'LocalForward 8080 localhost:80'],
        credential: ref('a@web'),
      }),
    );
  });

  it('changes only the lines that changed and keeps comments, line breaks and other blocks', async () => {
    const backend = await start({ 'slop-term.conf': managed });
    const { read: token, ...saved } = await backend.getSession('web');
    await backend.saveSession(
      {
        ...saved,
        port: '22',
        user: 'bob',
        options: ['LocalForward 8080 localhost:80', 'ServerAliveInterval 15'],
      },
      { alias: 'web', read: token },
    );
    expect(await read('slop-term.conf')).toBe(
      [
        '# Office hosts',
        'Host web',
        '  # the old box',
        '  HostName 10.0.0.5',
        '  Port 22',
        '  LocalForward 8080 localhost:80',
        '  User bob',
        '  ServerAliveInterval 15',
        '',
        '# Next one',
        'Host db',
        '  HostName db.lan',
        '',
      ].join('\r\n'),
    );
  });

  it('renames the Host line and the Sidecar entry, keeping orphaned entries', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\n  HostName web.lan\n',
      'slop-term.json': JSON.stringify({
        hosts: {
          gone: { folder: 'Old' },
          web: { folder: 'Work', credential: ref('a@web') },
        },
      }),
    });
    const { read: token, ...saved } = await backend.getSession('web');
    const tree = await backend.saveSession(
      { ...saved, alias: 'web-prod', folder: '' },
      { alias: 'web', read: token },
    );
    expect(await read('slop-term.conf')).toBe(
      'Host web-prod\n  HostName web.lan\n',
    );
    expect((await sidecar()).hosts).toEqual({
      gone: { folder: 'Old' },
      'web-prod': { credential: ref('a@web') },
    });
    expect(tree.sessions).toEqual([
      { alias: 'web-prod', credential: ref('a@web') },
    ]);
  });

  it('renames onto the alias of an orphaned Sidecar entry without losing its own fields', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\n',
      'slop-term.json': JSON.stringify({
        hosts: { web: { folder: 'Work' }, api: { folder: 'Old' } },
      }),
    });
    const { read: token, ...saved } = await backend.getSession('web');
    await backend.saveSession(
      { ...saved, alias: 'api' },
      { alias: 'web', read: token },
    );
    expect((await sidecar()).hosts).toEqual({ api: { folder: 'Work' } });
  });

  it('duplicates as a new session that shares the Credential reference', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\n  HostName web.lan\n',
      'slop-term.json': JSON.stringify({
        hosts: { web: { credential: ref('a@web') } },
      }),
    });
    const { read: _, ...saved } = await backend.getSession('web');
    await backend.saveSession({ ...saved, alias: 'web-2' });
    expect(await read('slop-term.conf')).toBe(
      'Host web\n  HostName web.lan\n\nHost web-2\n  HostName web.lan\n',
    );
    expect((await sidecar()).hosts).toEqual({
      web: { credential: ref('a@web') },
      'web-2': { credential: ref('a@web') },
    });
  });

  it('stops with a conflict when the host changed on disk since it was opened', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\n  HostName web.lan\n',
    });
    const { read: token, ...saved } = await backend.getSession('web');
    const edited = 'Host web\n  HostName other.lan\n';
    await writeFile(file('slop-term.conf'), edited);
    await expect(
      backend.saveSession(
        { ...saved, user: 'bob' },
        { alias: 'web', read: token },
      ),
    ).rejects.toThrow(/^web changed in slop-term.conf or slop-term.json/);
    expect(await read('slop-term.conf')).toBe(edited);
  });

  it('stops with a conflict when its Sidecar entry changed', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\n',
      'slop-term.json': JSON.stringify({ hosts: { web: { folder: 'A' } } }),
    });
    const { read: token, ...saved } = await backend.getSession('web');
    await writeFile(
      file('slop-term.json'),
      JSON.stringify({ hosts: { web: { folder: 'B' } } }),
    );
    await expect(
      backend.saveSession(saved, { alias: 'web', read: token }),
    ).rejects.toThrow(/changed/);
  });

  it('never writes over a Sidecar file that is not valid JSON', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\n',
      'slop-term.json': '{ "hosts": ',
    });
    await expect(backend.saveSession(form({ alias: 'api' }))).rejects.toThrow(
      /slop-term.json is not valid JSON/,
    );
    expect(await read('slop-term.json')).toBe('{ "hosts": ');
    expect(await read('slop-term.conf')).toBe('Host web\n');
  });

  it('removes the reference and deletes the secret only when no other session uses it', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\nHost api\nHost db\n',
      'slop-term.json': JSON.stringify({
        hosts: {
          web: { credential: ref('own') },
          api: { credential: ref('shared') },
          db: { credential: ref('shared') },
        },
      }),
    });
    await keychain('own').setPassword('one');
    await keychain('shared').setPassword('two');
    for (const alias of ['web', 'api']) {
      const {
        read: token,
        credential,
        ...saved
      } = await backend.getSession(alias);
      await backend.saveSession(
        saved,
        { alias, read: token },
        { drop: credential },
      );
    }
    expect((await sidecar()).hosts).toEqual({
      db: { credential: ref('shared') },
    });
    expect(await keychain('own').getPassword()).toBeNull();
    expect(await keychain('shared').getPassword()).toBe('two');
    await keychain('shared').deletePassword();
  });
});

describe('deleting a session', () => {
  it('removes its block and Sidecar entry and nothing else', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\n  HostName web.lan\n\n# db\nHost db\n',
      'slop-term.json': JSON.stringify({
        folders: ['Work'],
        hosts: { web: { folder: 'Work' }, gone: { folder: 'Work' } },
      }),
    });
    const { read: token } = await backend.getSession('web');
    const tree = await backend.deleteSession('web', token, false);
    expect(await read('slop-term.conf')).toBe('# db\nHost db\n');
    expect(await sidecar()).toEqual({
      folders: ['Work'],
      hosts: { gone: { folder: 'Work' } },
    });
    expect(tree.sessions).toEqual([{ alias: 'db' }]);
  });

  it('deletes the saved secret when asked, unless another session uses it', async () => {
    const backend = await start({
      'slop-term.conf': 'Host web\nHost api\nHost db\n',
      'slop-term.json': JSON.stringify({
        hosts: {
          web: { credential: ref('own') },
          api: { credential: ref('shared') },
          db: { credential: ref('shared') },
        },
      }),
    });
    await keychain('own').setPassword('one');
    await keychain('shared').setPassword('two');
    for (const alias of ['web', 'api'])
      await backend.deleteSession(
        alias,
        (await backend.getSession(alias)).read,
        true,
      );
    expect(await keychain('own').getPassword()).toBeNull();
    expect(await keychain('shared').getPassword()).toBe('two');
    await keychain('shared').deletePassword();
  });

  it('stops with a conflict when the host changed on disk', async () => {
    const backend = await start({ 'slop-term.conf': 'Host web\n' });
    const { read: token } = await backend.getSession('web');
    await writeFile(file('slop-term.conf'), 'Host web\n  User bob\n');
    await expect(backend.deleteSession('web', token, false)).rejects.toThrow(
      /changed/,
    );
    expect(await read('slop-term.conf')).toBe('Host web\n  User bob\n');
  });
});

it('resolves the grey command-line values with ssh -G and the option rows', async () => {
  const backend = await start({ id_ed25519: 'key' });
  expect(
    await backend.sessionDefaults('slop-test-defaults', ['Port 2200']),
  ).toEqual({
    hostname: 'slop-test-defaults',
    port: '2200',
    user: expect.any(String),
    identityFile: '~/.ssh/id_ed25519',
  });
});
