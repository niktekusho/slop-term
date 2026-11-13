import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

/** A MobaXterm 25 SSH line: 35 connection fields, a terminal block, the tab setting, the comment and the tab colour. */
function sshLine(
  name: string,
  {
    host = 'web.lan',
    port = '22',
    user = '',
    key = '',
    command = '',
    jump = '',
    comment = ' ',
    colour = '-1',
  } = {},
) {
  const f = Array<string>(35).fill('');
  Object.assign(f, { 0: '0', 1: host, 2: port, 3: user, 5: '-1' });
  Object.assign(f, { 7: command, 8: jump, 12: user ? '0' : '-1', 13: '0' });
  f[14] = key;
  return `${name}=#109#${f.join('%')}#MobaFont%10%0%0%-1%15%236,236,236%30,30,30%180,180,192%0%-1%0%%xterm%-1%0%_Std_Colors_0_%80%24%0%1%-1%<none>%%0%1%-1%-1#0#${comment}#${colour}`;
}

const ini = (...sections: string[][]) =>
  sections.map((lines) => lines.join('\r\n')).join('\r\n\r\n') + '\r\n';

const root = (...sessions: string[]) => [
  '[Bookmarks]',
  'SubRep=',
  'ImgNum=42',
  ...sessions,
];

async function start(
  source: string | Buffer,
  files: Record<string, string> = {},
) {
  harness = await startBackend({ 'MobaXterm.ini': source, ...files });
  const file = path.join(harness.home, 'MobaXterm.ini');
  return { backend: harness.backend, file };
}

const read = (name: string) =>
  readFile(path.join(harness.home, '.ssh', name), 'utf8');

describe('MobaXterm import', () => {
  it('writes the confirmed rows to the Managed config and the Sidecar file', async () => {
    const { backend, file } = await start(
      ini(
        root(
          sshLine('Web 01', {
            host: 'web01.lan',
            user: 'deploy',
            key: '_ProfileDir_\\.ssh\\id_web',
            comment: 'Front __DIEZE__1',
            colour: '255',
          }),
          'WSL=#151#14%0%',
        ),
        [
          '[Bookmarks_1]',
          'SubRep=Clients\\Acme',
          'ImgNum=41',
          sshLine('db', { host: 'db.lan', port: '2222' }),
        ],
      ),
      {
        '.ssh/slop-term.conf': '# mine\nHost old\n  HostName old.lan\n',
        '.ssh/slop-term.json': JSON.stringify({ folders: ['Empty'] }),
      },
    );
    const rows = await backend.previewImport(file);
    const tree = await backend.importSessions(rows.filter((r) => r.ticked));
    expect(await read('slop-term.conf')).toBe(
      [
        '# mine',
        'Host old',
        '  HostName old.lan',
        '',
        '# Front #1',
        'Host web-01',
        '  HostName web01.lan',
        '  User deploy',
        '  IdentityFile ~/.ssh/id_web',
        '  ServerAliveInterval 15',
        '',
        'Host db',
        '  HostName db.lan',
        '  Port 2222',
        '  ServerAliveInterval 15',
        '',
      ].join('\n'),
    );
    expect(JSON.parse(await read('slop-term.json'))).toEqual({
      folders: ['Empty'],
      hosts: { 'web-01': { colour: 'red' }, db: { folder: 'Clients/Acme' } },
      localShells: { wsl: { kind: 'wsl' } },
    });
    expect(tree.sessions.map((s) => s.alias)).toEqual(['old', 'web-01', 'db']);
    expect(tree.localShells.map((s) => s.name)).toEqual(['wsl']);
  });

  it('writes nothing when an alias was taken after the preview', async () => {
    const { backend, file } = await start(
      ini(root(sshLine('web'), sshLine('db'))),
    );
    const rows = await backend.previewImport(file);
    await backend.saveLocalShell({
      name: 'db',
      folder: '',
      kind: 'cmd',
      distro: '',
      startFolder: '',
      command: '',
    });
    await expect(backend.importSessions(rows)).rejects.toThrow(
      'db: Already exists. Run the import again.',
    );
    expect(await read('slop-term.conf').catch(() => '')).toBe('');
  });
});

describe("the import of a file shaped like the user's", () => {
  // 19 SSH sessions (6 of them short legacy lines), 1 WSL, 7 folders, 17 names with spaces, 1 .ppk key, 2 red tabs,
  // and 4 hosts already in ~/.ssh/config: 3 identical and 1 with another user.
  const folders = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'];
  const legacy = (name: string, host: string, key = '') =>
    `${name}=#109#0%${host}%22%root% %-1%-1% %%%%0%0%Interactive shell%${key}`;
  const source = ini(
    root('Ubuntu=#151#14%0%'),
    ...folders.map((folder, i) => {
      const sessions =
        i === 5
          ? [
              legacy('Legacy one', 'l1.lan'),
              legacy('Legacy two', 'l2.lan'),
              legacy('Legacy putty', 'l3.lan', 'C:\\Keys\\old.ppk'),
              legacy('Legacy four', 'l4.lan'),
              legacy('Legacy five', 'l5.lan'),
            ]
          : i === 2
            ? [
                legacy('Legacy six', 'l6.lan'),
                sshLine('Gamma plain', { host: 'g.lan' }),
                sshLine('Red one', {
                  host: 'r1.lan',
                  user: 'admin',
                  colour: '255',
                }),
                sshLine('Red two', {
                  host: 'r2.lan',
                  user: 'admin',
                  colour: '255',
                }),
              ]
            : [0, 1].map((n) =>
                sshLine(`${folder} host${n}`, {
                  host: `${folder}-${n}.lan`.toLowerCase(),
                  user: 'admin',
                  key: '_ProfileDir_\\.ssh\\id_ed25519',
                }),
              );
      return [
        `[Bookmarks_${i + 1}]`,
        `SubRep=${folder}`,
        'ImgNum=41',
        ...sessions,
      ];
    }),
    ['[Misc]', 'StorePasswords=Never'],
  )
    // Ubuntu, alpha0 and alpha1 have no space: 17 of the 20 names have one.
    .replace('Alpha host0=', 'alpha0=')
    .replace('Alpha host1=', 'alpha1=');
  const existing = [
    'Host a0\n  HostName alpha-0.lan\n  User admin\n  IdentityFile ~/.ssh/id_ed25519',
    'Host b0\n  HostName beta-0.lan\n  User admin\n  IdentityFile ~/.ssh/id_ed25519',
    'Host l1\n  HostName l1.lan\n  User root',
    'Host b1\n  HostName beta-1.lan\n  User someone\n  IdentityFile ~/.ssh/id_ed25519',
  ].join('\n');

  it('previews every session, imports the ticked ones and adds nothing on a second run', async () => {
    const { backend, file } = await start(source, { '.ssh/config': existing });
    const rows = await backend.previewImport(file);
    expect(rows).toHaveLength(20);
    expect(rows.filter((r) => r.name.includes(' '))).toHaveLength(17);
    expect(rows.filter((r) => r.kind === 'ssh')).toHaveLength(19);
    expect(new Set(rows.map((r) => r.folder))).toEqual(
      new Set(['', ...folders]),
    );
    const unticked = rows.filter((r) => !r.ticked).map((r) => r.alias);
    expect(unticked).toEqual(['alpha0', 'beta-host0', 'legacy-one']);
    expect(rows.find((r) => r.alias === 'beta-host1')?.problems).toEqual([
      'Same host as b1, with user admin here and someone there.',
    ]);
    expect(rows.find((r) => r.alias === 'legacy-putty')?.problems[0]).toMatch(
      /^Uses a PuTTY key/,
    );

    const tree = await backend.importSessions(rows.filter((r) => r.ticked));
    expect(tree.sessions).toHaveLength(16);
    expect(tree.sessions.filter((s) => s.colour === 'red')).toHaveLength(2);
    expect(tree.sessions.some((s) => 'credential' in s)).toBe(false);
    expect(tree.localShells).toEqual([
      {
        name: 'ubuntu',
        folder: '',
        kind: 'wsl',
        distro: '',
        startFolder: '',
        command: '',
      },
    ]);
    expect(
      (await read('slop-term.conf')).match(/ServerAliveInterval 15/g),
    ).toHaveLength(16);

    const again = await backend.previewImport(file);
    expect(again.filter((r) => r.ticked)).toEqual([]);
  });
});

describe('the import file picker', () => {
  it('starts at the first MobaXterm.ini of the AppData, Documents and install folders', async () => {
    harness = await startBackend({
      'Documents/MobaXterm/MobaXterm.ini': '',
      'AppData/Roaming/MobaXterm/other.ini': '',
    });
    expect(await harness.backend.findMobaxterm()).toBe(
      path.join(harness.home, 'Documents', 'MobaXterm', 'MobaXterm.ini'),
    );
  });

  it('prefers the AppData folder', async () => {
    harness = await startBackend({
      'Documents/MobaXterm/MobaXterm.ini': '',
      'AppData/Roaming/MobaXterm/MobaXterm.ini': '',
    });
    expect(await harness.backend.findMobaxterm()).toBe(
      path.join(
        harness.home,
        'AppData',
        'Roaming',
        'MobaXterm',
        'MobaXterm.ini',
      ),
    );
  });
});

describe('MobaXterm import preview', () => {
  it('lists an SSH session with its alias slugified from the name', async () => {
    const { backend, file } = await start(
      ini(root(sshLine('Web Prod 01', { host: 'web01.lan', user: 'deploy' }))),
    );
    expect(await backend.previewImport(file)).toEqual([
      {
        name: 'Web Prod 01',
        kind: 'ssh',
        alias: 'web-prod-01',
        folder: '',
        hostname: 'web01.lan',
        port: '22',
        user: 'deploy',
        identityFile: '',
        comment: '',
        ticked: true,
        problems: [],
      },
    ]);
  });

  it('proposes an alias without the characters ssh rejects', async () => {
    const { backend, file } = await start(
      ini(root(sshLine('example-host-(testuser)'))),
    );
    const [row] = await backend.previewImport(file);
    expect([row.alias, row.problems]).toEqual(['example-host-testuser', []]);
  });

  it('puts each session in the folder its SubRep names, nested on backslashes', async () => {
    const { backend, file } = await start(
      ini(
        root(sshLine('loose')),
        ['[Bookmarks_1]', 'SubRep=Clients\\Acme', 'ImgNum=41', sshLine('web')],
        ['[Bookmarks_2]', 'SubRep=Home', 'ImgNum=41', sshLine('nas')],
      ),
    );
    const rows = await backend.previewImport(file);
    expect(rows.map((r) => [r.alias, r.folder])).toEqual([
      ['loose', ''],
      ['web', 'Clients/Acme'],
      ['nas', 'Home'],
    ]);
  });

  it('turns a WSL session into a wsl Local shell session and lists other types as skipped', async () => {
    const { backend, file } = await start(
      ini(
        root(
          'Ubuntu=#151#14%0%',
          'Desktop=#91#4%desk.lan%3389%%-1%0%0%0',
          'Files=#140#7%files.lan%22%%-1',
        ),
      ),
    );
    const rows = await backend.previewImport(file);
    expect(
      rows.map(({ alias, kind, ticked, problems }) => ({
        alias,
        kind,
        ticked,
        problems,
      })),
    ).toEqual([
      {
        alias: 'ubuntu',
        kind: 'wsl',
        ticked: true,
        problems: ['Opens your default WSL distro.'],
      },
      {
        alias: 'desktop',
        kind: 'skipped',
        ticked: false,
        problems: ['RDP sessions are not imported.'],
      },
      {
        alias: 'files',
        kind: 'skipped',
        ticked: false,
        problems: ['SFTP sessions are not imported.'],
      },
    ]);
  });

  it('reads a short line from an older MobaXterm with defaults for the missing fields', async () => {
    const { backend, file } = await start(
      ini(
        root(
          'Old box=#109#0%old.lan%22%root%%-1%-1% %%%%0%0%Interactive shell%',
          'Older=#109#0%older.lan',
        ),
      ),
    );
    const rows = await backend.previewImport(file);
    expect(
      rows.map(({ hostname, port, user, identityFile, comment, problems }) => ({
        hostname,
        port,
        user,
        identityFile,
        comment,
        problems,
      })),
    ).toEqual([
      {
        hostname: 'old.lan',
        port: '22',
        user: 'root',
        identityFile: '',
        comment: '',
        problems: [],
      },
      {
        hostname: 'older.lan',
        port: '22',
        user: '',
        identityFile: '',
        comment: '',
        problems: [],
      },
    ]);
  });

  it('translates key paths to ~/... and flags the ones that stay absolute or are PuTTY keys', async () => {
    harness = await startBackend((home) => ({
      'MobaXterm.ini': ini(
        root(
          sshLine('profile', { key: '_ProfileDir_\\.ssh\\id_ed25519' }),
          sshLine('in home', {
            key: `${home.replaceAll('/', '\\')}\\keys\\id_rsa`,
          }),
          sshLine('drive', { key: '_CurrentDrive_:\\keys\\id_rsa' }),
          sshLine('putty', { key: '_ProfileDir_\\keys\\work.ppk' }),
        ),
      ),
    }));
    const file = path.join(harness.home, 'MobaXterm.ini');
    const drive = /^[A-Za-z]:/.exec(harness.home)?.[0] ?? '';
    const rows = await harness.backend.previewImport(file);
    expect(
      rows.map(({ identityFile, problems }) => ({ identityFile, problems })),
    ).toEqual([
      { identityFile: '~/.ssh/id_ed25519', problems: [] },
      { identityFile: '~/keys/id_rsa', problems: [] },
      {
        identityFile: `${drive}/keys/id_rsa`,
        problems: [`The key ${drive}/keys/id_rsa won't work on macOS.`],
      },
      {
        identityFile: '',
        problems: [
          'Uses a PuTTY key. Convert it once with PuTTYgen (Conversions, Export OpenSSH key), save it as ~/.ssh/work, then pick it in the Saved session.',
        ],
      },
    ]);
  });

  it('lists the jump hosts and login commands it drops, ignoring a login command of spaces', async () => {
    const { backend, file } = await start(
      ini(
        root(
          sshLine('jumped', { jump: 'bastion.lan' }),
          sshLine('command', { command: 'sudo su -__PTVIRG__ cd /srv' }),
          sshLine('blank', { command: ' ' }),
        ),
      ),
    );
    const rows = await backend.previewImport(file);
    expect(rows.map((r) => r.problems)).toEqual([
      ['Uses a jump host, not imported.'],
      ['The login command sudo su -; cd /srv is not imported.'],
      [],
    ]);
  });

  it('maps the tab colour to the nearest Session colour', async () => {
    const { backend, file } = await start(
      ini(
        root(
          sshLine('red', { colour: '255' }),
          sshLine('none', { colour: '-1' }),
          sshLine('green', { colour: String(0x00c000) }),
          sshLine('orange', { colour: String(0x0080ff) }),
          sshLine('blue', { colour: String(0xff0000) }),
          sshLine('grey', { colour: String(0xc0c0c0) }),
        ),
      ),
    );
    const rows = await backend.previewImport(file);
    expect(rows.map((r) => r.colour)).toEqual([
      'red',
      undefined,
      'green',
      'orange',
      'blue',
      'grey',
    ]);
  });

  it('starts a row unticked when its alias is taken, by an existing session or an earlier row', async () => {
    const { backend, file } = await start(
      ini(
        root(sshLine('managed'), sshLine('hand'), sshLine('shell')),
        ['[Bookmarks_1]', 'SubRep=Other', 'ImgNum=41', sshLine('Managed')],
        [
          '[Bookmarks_2]',
          'SubRep=Twice',
          'ImgNum=41',
          sshLine('new'),
          sshLine('New'),
        ],
      ),
      {
        '.ssh/config': 'Host hand\n  HostName hand.lan\n',
        '.ssh/slop-term.conf': 'Host managed\n  HostName managed.lan\n',
        '.ssh/slop-term.json': JSON.stringify({
          localShells: { shell: { kind: 'cmd' } },
        }),
      },
    );
    const rows = await backend.previewImport(file);
    expect(rows.map((r) => [r.alias, r.ticked])).toEqual([
      ['managed', false],
      ['hand', false],
      ['shell', false],
      ['managed', false],
      ['new', true],
      ['new', false],
    ]);
  });

  it('starts a row unticked when host, port, user and key all match an existing host, and shows what differs otherwise', async () => {
    const { backend, file } = await start(
      ini(
        root(
          sshLine('Same', {
            host: 'box.lan',
            user: 'admin',
            key: '_ProfileDir_\\.ssh\\id_box',
          }),
          sshLine('Other user', {
            host: 'BOX.lan',
            user: 'deploy',
            key: '_ProfileDir_\\.ssh\\id_box',
          }),
          sshLine('Bare', { host: 'bare.lan', user: ' ' }),
          sshLine('Unrelated', { host: 'elsewhere.lan' }),
        ),
      ),
      {
        '.ssh/config':
          'Host box\n  HostName box.lan\n  User admin\n  IdentityFile ~/.ssh/id_box\n',
        '.ssh/slop-term.conf': 'Host bare.lan\n  Port 22\n',
      },
    );
    const rows = await backend.previewImport(file);
    expect(rows.map(({ ticked, problems }) => ({ ticked, problems }))).toEqual([
      { ticked: false, problems: ['Already in SSH config as box.'] },
      {
        ticked: true,
        problems: ['Same host as box, with user deploy here and admin there.'],
      },
      { ticked: false, problems: ['Already in SSH config as bare.lan.'] },
      { ticked: true, problems: [] },
    ]);
  });

  it('matches an existing key written as an absolute path in the home folder', async () => {
    harness = await startBackend((home) => ({
      'MobaXterm.ini': ini(
        root(
          sshLine('box', {
            host: 'box.lan',
            key: '_ProfileDir_\\.ssh\\id_box',
          }),
        ),
      ),
      '.ssh/config': `Host old\n  HostName box.lan\n  IdentityFile ${path.join(home, '.ssh', 'id_box')}\n`,
    }));
    const [row] = await harness.backend.previewImport(
      path.join(harness.home, 'MobaXterm.ini'),
    );
    expect(row.problems).toEqual(['Already in SSH config as old.']);
  });

  it('reuses an existing folder whose path differs only in case', async () => {
    const { backend, file } = await start(
      ini(['[Bookmarks_1]', 'SubRep=work\\PROD', 'ImgNum=41', sshLine('web')]),
      {
        '.ssh/slop-term.json': JSON.stringify({
          folders: ['Work', 'Work/Prod'],
        }),
      },
    );
    const [row] = await backend.previewImport(file);
    expect(row.folder).toBe('Work/Prod');
  });

  it('decodes the file in the ANSI code page', async () => {
    const { backend, file } = await start(
      Buffer.from(ini(root(sshLine('Caf\xe9 box'))), 'latin1'),
    );
    const [row] = await backend.previewImport(file);
    expect([row.name, row.alias]).toEqual(['Café box', 'café-box']);
  });
});
