import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

const eventually = (assertion: () => void) =>
  vi.waitFor(assertion, { timeout: 10_000 });
const include = 'Include ~/.ssh/slop-term.conf';

async function start(files: Record<string, string> = {}) {
  harness = await startBackend(files);
  return harness.backend.getTree();
}

const read = (name: string) =>
  readFile(path.join(harness.home, '.ssh', name), 'utf8');

describe('include line', () => {
  it('creates a missing ~/.ssh/config with only the include line', async () => {
    await start();
    expect(await read('config')).toBe(`${include}\n`);
  });

  it('adds the line at the top and changes nothing else', async () => {
    const own = 'Host web1\r\n  HostName 10.0.0.1 # office\r\n';
    await start({ '.ssh/config': own });
    expect(await read('config')).toBe(`${include}\r\n${own}`);
  });

  it('leaves a config that already includes the Managed config before any Host alone', async () => {
    const own = '# mine\nInclude=slop-term.conf\nHost web1\n';
    await start({ '.ssh/config': own });
    expect(await read('config')).toBe(own);
  });

  it('adds the line at the top when the existing include sits under a Host', async () => {
    const own = `Host web1\n  User me\n\n${include}\n`;
    await start({ '.ssh/config': own });
    expect(await read('config')).toBe(`${include}\n${own}`);
  });
});

describe('session tree', () => {
  it('lists Managed hosts with their Sidecar folders and Hand-written hosts', async () => {
    const tree = await start({
      '.ssh/config': `${include}\nHost web1\n  HostName 10.0.0.1\n`,
      '.ssh/slop-term.conf':
        'Host db\n  HostName db.lan\n\nHost loose\n  HostName loose.lan\n',
      '.ssh/slop-term.json': JSON.stringify({
        folders: ['Work', 'Work/Production', 'Empty'],
        hosts: { db: { folder: 'Work/Production' } },
      }),
    });
    expect(tree).toEqual({
      folders: ['Work', 'Work/Production', 'Empty'],
      sessions: [
        { alias: 'db', folder: 'Work/Production' },
        { alias: 'loose' },
      ],
      handWritten: ['web1'],
      localShells: [],
      warnings: [],
    });
  });

  it('follows Include in both configs, relative to ~/.ssh, and stops at a loop', async () => {
    const tree = await start({
      '.ssh/config': `${include}\nInclude config.d/*\n`,
      '.ssh/config.d/work': 'Host jenkins\n',
      '.ssh/config.d/home': 'Host nas\n  Include ~/.ssh/deeper.conf\n',
      '.ssh/deeper.conf': 'Host pi\nInclude config.d/home\n',
      '.ssh/slop-term.conf': 'Include "managed.d/*.conf"\nHost db\n',
      '.ssh/managed.d/a.conf': 'Host api\n',
    });
    expect(tree.sessions).toEqual([{ alias: 'api' }, { alias: 'db' }]);
    expect(tree.handWritten).toEqual(['nas', 'pi', 'jenkins']);
  });

  it('ignores Match blocks and warns about them', async () => {
    const tree = await start({
      '.ssh/config': `${include}\nMatch host *.lan\n  User admin\nHost web1\n`,
    });
    expect(tree.handWritten).toEqual(['web1']);
    expect(tree.warnings).toEqual([
      'Match blocks in ~/.ssh/config are ignored',
    ]);
  });

  it('shows only concrete aliases, never patterns', async () => {
    const tree = await start({
      '.ssh/config': `${include}\nHost *\n  ServerAliveInterval 15\nHost web1 web2 *.prod !bastion\n`,
      '.ssh/slop-term.conf': 'Host db?\nHost db\n',
    });
    expect(tree.handWritten).toEqual(['web1', 'web2']);
    expect(tree.sessions).toEqual([{ alias: 'db' }]);
  });

  it('ignores Sidecar entries whose host is gone and keeps them in the file', async () => {
    const sidecar = JSON.stringify({
      folders: ['Work'],
      hosts: { gone: { folder: 'Work' }, db: { folder: 'Work' } },
    });
    const tree = await start({
      '.ssh/slop-term.conf': 'Host db\n',
      '.ssh/slop-term.json': sidecar,
    });
    expect(tree.sessions).toEqual([{ alias: 'db', folder: 'Work' }]);
    expect(await read('slop-term.json')).toBe(sidecar);
  });

  it('warns about a Sidecar file that is not valid JSON', async () => {
    const tree = await start({
      '.ssh/slop-term.conf': 'Host db\n',
      '.ssh/slop-term.json': '{ "folders": [',
    });
    expect(tree.sessions).toEqual([{ alias: 'db' }]);
    expect(tree.warnings).toEqual([
      expect.stringContaining('slop-term.json is not valid JSON'),
    ]);
  });

  it('sends the new tree when any of the three files changes on disk', async () => {
    await start({ '.ssh/slop-term.conf': 'Host db\n' });
    const ssh = path.join(harness.home, '.ssh');
    const lastTree = () => {
      const event = harness.events.at(-1);
      return event?.type === 'tree' ? event.tree : undefined;
    };

    await writeFile(path.join(ssh, 'slop-term.conf'), 'Host db\nHost api\n');
    await eventually(() =>
      expect(lastTree()?.sessions).toEqual([{ alias: 'db' }, { alias: 'api' }]),
    );
    await writeFile(
      path.join(ssh, 'slop-term.json'),
      JSON.stringify({ hosts: { api: { folder: 'Work' } } }),
    );
    await eventually(() =>
      expect(lastTree()?.sessions).toContainEqual({
        alias: 'api',
        folder: 'Work',
      }),
    );
    await writeFile(path.join(ssh, 'config'), `${include}\nHost web1\n`);
    await eventually(() => expect(lastTree()?.handWritten).toEqual(['web1']));
  });

  it('warns about a file it cannot read and keeps going', async () => {
    const tree = await start({
      '.ssh/config': `${include}\nInclude broken\nHost web1\n`,
      '.ssh/broken/placeholder': '',
    });
    expect(tree.handWritten).toEqual(['web1']);
    expect(tree.warnings).toEqual([
      expect.stringMatching(/^Can't read ~[\\/]\.ssh[\\/]broken: /),
    ]);
  });
});

describe('Move into slop-term', () => {
  const config = [
    include,
    '',
    '# office',
    'Host web1',
    '  HostName 10.0.0.1',
    '  # old port',
    '  User me',
    '',
    'Host db',
    '',
  ].join('\r\n');

  it('copies the block into the Managed config and leaves ~/.ssh/config alone until confirmed', async () => {
    await start({
      '.ssh/config': config,
      '.ssh/slop-term.conf': 'Host api\n',
    });
    const tree = await harness.backend.moveIn('web1');
    expect(await read('slop-term.conf')).toBe(
      'Host api\n\nHost web1\n  HostName 10.0.0.1\n  # old port\n  User me\n',
    );
    expect(await read('config')).toBe(config);
    expect(tree.handWritten).toEqual(['db']);
    expect(tree.sessions).toEqual([
      { alias: 'api' },
      { alias: 'web1', alsoInConfig: 4 },
    ]);
  });

  it('comments out the original under a marker once confirmed, deleting nothing', async () => {
    await start({ '.ssh/config': config });
    await harness.backend.moveIn('web1');
    const tree = await harness.backend.commentOut('web1');
    expect(await read('config')).toBe(
      [
        include,
        '',
        '# office',
        '# moved to slop-term.conf',
        '# Host web1',
        '#   HostName 10.0.0.1',
        '#   # old port',
        '#   User me',
        '',
        'Host db',
        '',
      ].join('\r\n'),
    );
    expect(tree.sessions).toEqual([{ alias: 'web1' }]);
  });

  it('refuses to comment out a host the Managed config lacks, or to move one in twice', async () => {
    await start({
      '.ssh/config': config,
      '.ssh/slop-term.conf': 'Host db\n',
    });
    await expect(harness.backend.commentOut('web1')).rejects.toThrow(
      'web1 is not in slop-term.conf, so commenting it out would lose it.',
    );
    await expect(harness.backend.moveIn('db')).rejects.toThrow(
      'db is already in slop-term.conf.',
    );
    expect(await read('config')).toBe(config);
    expect(await read('slop-term.conf')).toBe('Host db\n');
  });

  it('marks a Managed alias that ~/.ssh/config also defines, as a synced move from another machine leaves it', async () => {
    const tree = await start({
      '.ssh/config': config,
      '.ssh/slop-term.conf': 'Host db\n  HostName db.lan\n',
    });
    expect(tree.sessions).toEqual([{ alias: 'db', alsoInConfig: 9 }]);
    expect(tree.handWritten).toEqual(['web1']);
    await harness.backend.commentOut('db');
    expect(await read('config')).toBe(
      config.replace('Host db', '# moved to slop-term.conf\r\n# Host db'),
    );
  });
});
