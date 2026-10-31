import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keychainEntry, startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

// Secrets go to a keychain service of this test run, never the app's own.
const service = `slop-term-test-folders-${process.pid}`;
const keychain = (entry: string) => keychainEntry(service, entry);

async function start(
  files: Record<string, string> = {},
  env: Record<string, string> = {},
) {
  harness = await startBackend(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [`.ssh/${name}`, text]),
    ),
    env,
  );
  return harness.backend;
}

const read = (name: string) =>
  readFile(path.join(harness.home, '.ssh', name), 'utf8');
const sidecar = async () => JSON.parse(await read('slop-term.json'));

describe('creating a folder', () => {
  it('adds an empty nested folder to the Sidecar folder list', async () => {
    const backend = await start({
      'slop-term.json': JSON.stringify({ folders: ['Work'] }),
    });
    const tree = await backend.createFolder('Work', 'Prod');
    expect(tree.folders).toEqual(['Work', 'Work/Prod']);
    expect(await sidecar()).toEqual({ folders: ['Work', 'Work/Prod'] });
  });

  it('rejects a name with / or one a sibling has, ignoring case, and writes nothing', async () => {
    const sidecarText = JSON.stringify({
      folders: ['Work'],
      hosts: { db: { folder: 'Home' } },
    });
    const backend = await start({
      'slop-term.conf': 'Host db\n',
      'slop-term.json': sidecarText,
    });
    await expect(backend.createFolder('', 'work')).rejects.toThrow(
      'work is already here.',
    );
    await expect(backend.createFolder('', 'HOME')).rejects.toThrow(
      'HOME is already here.',
    );
    await expect(backend.createFolder('Work', 'a/b')).rejects.toThrow(
      'No / in a folder name.',
    );
    await expect(backend.createFolder('Work', '  ')).rejects.toThrow(
      'Type a name.',
    );
    expect(await read('slop-term.json')).toBe(sidecarText);
  });
});

describe('moving', () => {
  it('moves a session into a folder and back to the top level, keeping its other fields', async () => {
    const credential = { provider: 'keychain', entry: 'a', kind: 'password' };
    const backend = await start({
      'slop-term.conf': 'Host db\nHost web\n',
      'slop-term.json': JSON.stringify({
        folders: ['Work'],
        hosts: { db: { credential } },
      }),
    });
    await backend.move({ alias: 'db' }, 'Work');
    await backend.move({ alias: 'web' }, 'Work');
    expect((await sidecar()).hosts).toEqual({
      db: { credential, folder: 'Work' },
      web: { folder: 'Work' },
    });
    const tree = await backend.move({ alias: 'web' }, '');
    expect((await sidecar()).hosts).toEqual({
      db: { credential, folder: 'Work' },
    });
    expect(tree.sessions).toEqual([
      { alias: 'db', folder: 'Work', credential },
      { alias: 'web' },
    ]);
  });

  it('keeps a folder only its last session named, as an empty folder', async () => {
    const backend = await start({
      'slop-term.conf': 'Host db\n',
      'slop-term.json': JSON.stringify({ hosts: { db: { folder: 'Lab' } } }),
    });
    expect((await backend.move({ alias: 'db' }, '')).folders).toEqual(['Lab']);
  });

  it('moves a folder with its subfolders and sessions', async () => {
    const backend = await start({
      'slop-term.conf': 'Host db\n',
      'slop-term.json': JSON.stringify({
        folders: ['Work', 'Work/Prod', 'Work/Prod/Eu', 'Home'],
        hosts: { db: { folder: 'Work/Prod/Eu' } },
      }),
    });
    await backend.move({ folder: 'Work/Prod' }, 'Home');
    expect(await sidecar()).toEqual({
      folders: ['Work', 'Home/Prod', 'Home/Prod/Eu', 'Home'],
      hosts: { db: { folder: 'Home/Prod/Eu' } },
    });
    await backend.move({ folder: 'Home/Prod' }, '');
    expect((await sidecar()).folders).toEqual([
      'Work',
      'Prod',
      'Prod/Eu',
      'Home',
    ]);
  });

  it('refuses to move a folder into itself, its subfolders or next to a namesake', async () => {
    const sidecarText = JSON.stringify({
      folders: ['Work', 'Work/Prod', 'Home', 'Home/prod'],
    });
    const backend = await start({ 'slop-term.json': sidecarText });
    await expect(backend.move({ folder: 'Work' }, 'Work')).rejects.toThrow(
      "A folder can't move into itself or its subfolders.",
    );
    await expect(backend.move({ folder: 'Work' }, 'Work/Prod')).rejects.toThrow(
      "A folder can't move into itself or its subfolders.",
    );
    await expect(backend.move({ folder: 'Work/Prod' }, 'Home')).rejects.toThrow(
      'Prod is already here.',
    );
    await expect(backend.move({ alias: 'gone' }, 'Home')).rejects.toThrow(
      'gone is no longer in slop-term.conf or slop-term.json.',
    );
    expect(await read('slop-term.json')).toBe(sidecarText);
  });
});

describe('deleting a folder', () => {
  const ref = (provider: string, entry: string) => ({
    provider,
    entry,
    kind: 'password',
  });

  it('deletes its subfolders and sessions, and only the secrets no session outside uses', async () => {
    const backend = await start(
      {
        'slop-term.conf':
          'Host db\n  HostName db.lan\n\nHost api\n\nHost web\nHost team\n',
        'slop-term.json': JSON.stringify({
          folders: ['Work', 'Work/Prod', 'Work/Empty', 'Home'],
          hosts: {
            db: { folder: 'Work/Prod', credential: ref('keychain', 'own') },
            web: { folder: 'Work', credential: ref('keychain', 'shared') },
            team: { folder: 'Work', credential: ref('tpm', '42') },
            api: { credential: ref('keychain', 'shared') },
            gone: { folder: 'Work' },
          },
        }),
      },
      { SLOP_TERM_KEYCHAIN_SERVICE: service },
    );
    await keychain('own').setPassword('one');
    await keychain('shared').setPassword('two');
    const tree = await backend.deleteFolder(
      'Work',
      ['web', 'team', 'db'],
      true,
    );
    expect(await read('slop-term.conf')).toBe('Host api\n\n');
    expect(await sidecar()).toEqual({
      folders: ['Home'],
      hosts: {
        api: { credential: ref('keychain', 'shared') },
        gone: { folder: 'Work' },
      },
    });
    expect(tree.sessions.map((s) => s.alias)).toEqual(['api']);
    expect(await keychain('own').getPassword()).toBeNull();
    expect(await keychain('shared').getPassword()).toBe('two');
    await keychain('shared').deletePassword();
  });

  it('keeps every secret when not asked, and deletes an empty folder', async () => {
    const backend = await start(
      {
        'slop-term.conf': 'Host db\n',
        'slop-term.json': JSON.stringify({
          folders: ['Work', 'Empty'],
          hosts: { db: { folder: 'Work', credential: ref('keychain', 'own') } },
        }),
      },
      { SLOP_TERM_KEYCHAIN_SERVICE: service },
    );
    await keychain('own').setPassword('one');
    await backend.deleteFolder('Work', ['db'], false);
    expect(await keychain('own').getPassword()).toBe('one');
    await keychain('own').deletePassword();
    expect((await backend.deleteFolder('Empty', [], false)).folders).toEqual(
      [],
    );
  });

  it('stops with a conflict when the folder holds other sessions than the user agreed to delete', async () => {
    const files = {
      'slop-term.conf': 'Host db\nHost web\n',
      'slop-term.json': JSON.stringify({
        folders: ['Work'],
        hosts: { db: { folder: 'Work' }, web: { folder: 'Work' } },
      }),
    };
    const backend = await start(files);
    await expect(backend.deleteFolder('Work', ['db'], false)).rejects.toThrow(
      'Work changed since you asked to delete it. Try again.',
    );
    expect(await read('slop-term.conf')).toBe(files['slop-term.conf']);
    expect(await read('slop-term.json')).toBe(files['slop-term.json']);
  });
});

describe('renaming a folder', () => {
  it('renames its subfolders and the folder of every session in it', async () => {
    const backend = await start({
      'slop-term.conf': 'Host db\nHost web\nHost nas\n',
      'slop-term.json': JSON.stringify({
        folders: ['Work', 'Work/Prod', 'Workshop'],
        hosts: {
          db: { folder: 'Work/Prod', credential: { x: 1 } },
          web: { folder: 'Work' },
          nas: { folder: 'Workshop' },
        },
      }),
    });
    const tree = await backend.renameFolder('Work', 'Office');
    expect(await sidecar()).toEqual({
      folders: ['Office', 'Office/Prod', 'Workshop'],
      hosts: {
        db: { folder: 'Office/Prod', credential: { x: 1 } },
        web: { folder: 'Office' },
        nas: { folder: 'Workshop' },
      },
    });
    expect(tree.sessions).toEqual([
      { alias: 'db', folder: 'Office/Prod' },
      { alias: 'web', folder: 'Office' },
      { alias: 'nas', folder: 'Workshop' },
    ]);
  });

  it('rejects a rename onto a sibling instead of merging, but allows a change of case', async () => {
    const backend = await start({
      'slop-term.json': JSON.stringify({ folders: ['Work', 'Home'] }),
    });
    await expect(backend.renameFolder('Work', 'home')).rejects.toThrow(
      'home is already here.',
    );
    expect((await backend.renameFolder('Work', 'WORK')).folders).toEqual([
      'WORK',
      'Home',
    ]);
  });
});
