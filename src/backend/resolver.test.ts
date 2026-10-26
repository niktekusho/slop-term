import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from './resolver.ts';

let dir: string;
let config: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'slop-resolver-'));
  config = path.join(dir, 'config');
  await writeFile(
    config,
    [
      'Host box',
      '  HostName 10.0.0.5',
      '  Port 2200',
      '  User alice',
      '  IdentityFile ~/.ssh/id_box',
      '  UserKnownHostsFile /keys/one /keys/two',
      '  HostKeyAlias boxkey',
      '  StrictHostKeyChecking no',
      '  HashKnownHosts yes',
      'Host hop',
      '  ProxyJump box',
      'Host piped',
      '  ProxyCommand nc %h %p',
      'Host plain',
      '  ProxyJump none',
      '  StrictHostKeyChecking yes',
    ].join('\n'),
  );
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('resolver', () => {
  it('returns the values ssh -G resolves for an alias', async () => {
    expect(await resolve('box', config)).toEqual({
      hostname: '10.0.0.5',
      port: 2200,
      user: 'alice',
      identityFiles: [path.join(homedir(), '.ssh/id_box')],
      knownHostsFiles: ['/keys/one', '/keys/two'],
      hostKeyAlias: 'boxkey',
      saveUnknownKeys: true,
      hashKnownHosts: true,
      jumpHost: false,
    });
  });

  it('flags ProxyJump and ProxyCommand as a jump host, but not none', async () => {
    expect((await resolve('hop', config)).jumpHost).toBe(true);
    expect((await resolve('piped', config)).jumpHost).toBe(true);
    const plain = await resolve('plain', config);
    expect(plain.jumpHost).toBe(false);
    expect(plain.saveUnknownKeys).toBe(false);
    expect(plain.hostname).toBe('plain');
    expect(plain.port).toBe(22);
  });
});
