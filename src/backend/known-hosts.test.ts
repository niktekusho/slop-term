import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  hostEntry,
  knownHostName,
  removeLine,
  savedKeys,
} from './known-hosts.ts';

// Made with ssh-keygen: the hashed line is `ssh-keygen -H` of `[db.lan]:2222 <keyA>`.
const keyA =
  'AAAAC3NzaC1lZDI1NTE5AAAAIGOxGjlM+gAr27iM8HY/XXlwEIRqe1sI4dMTcaWvhBEz';
const keyB =
  'AAAAC3NzaC1lZDI1NTE5AAAAIP1lPisfo5gY+x0gHZbWL/UI6MznwikEdC7FqTfaAUd0';
const hashedDb = '|1|DF8ntxKYT13fH4OAjSl80iTR/tY=|9CWyDUp08mULd4ZYBYNX+HIAYyA=';

describe('known_hosts', () => {
  it('names a host by its port only when the port is not 22', () => {
    expect(knownHostName('web1.lan', 22)).toBe('web1.lan');
    expect(knownHostName('db.lan', 2222)).toBe('[db.lan]:2222');
  });

  it('finds plain and hashed entries for a name and skips marker lines', () => {
    const text = [
      '# mine',
      `@cert-authority *.lan ssh-ed25519 ${keyB}`,
      `@revoked [db.lan]:2222 ssh-ed25519 ${keyB}`,
      `web1.lan,[DB.lan]:2222 ssh-ed25519 ${keyB}`,
      '',
      `${hashedDb} ssh-ed25519 ${keyA}`,
      `[db.lan]:22 ssh-rsa ${keyB}`,
    ].join('\r\n');
    expect(savedKeys('/h/known_hosts', text, '[db.lan]:2222')).toEqual([
      { file: '/h/known_hosts', line: 4, type: 'ssh-ed25519', key: keyB },
      { file: '/h/known_hosts', line: 6, type: 'ssh-ed25519', key: keyA },
    ]);
  });

  it('writes plain and hashed entries that read back', () => {
    expect(hostEntry('web1.lan', 'ssh-ed25519', keyA, false)).toBe(
      `web1.lan ssh-ed25519 ${keyA}`,
    );
    const hashed = hostEntry('[db.lan]:2222', 'ssh-ed25519', keyA, true);
    expect(hashed).toMatch(/^\|1\|[^|]+\|[^ ]+ ssh-ed25519 /);
    expect(hashed).not.toContain('db.lan');
    expect(savedKeys('f', hashed, '[db.lan]:2222')).toHaveLength(1);
    expect(savedKeys('f', hashed, 'db.lan')).toEqual([]);
  });

  it('removes one line and keeps the rest byte for byte', () => {
    const text = 'a\r\n@revoked x\r\nb\r\n';
    expect(removeLine(text, 1)).toBe('@revoked x\r\nb\r\n');
    expect(removeLine(text, 3)).toBe('a\r\n@revoked x\r\n');
  });

  it('shows the SHA256 fingerprint the way ssh-keygen does', () => {
    expect(fingerprint(keyA)).toBe(
      'SHA256:0QEMcQoudiF1gfSwRovJ4zXT3DFnOdU0sUHbHd1W/Z0',
    );
    expect(fingerprint(keyB)).toBe(
      'SHA256:J7OKCL/fk2lquQc2R3Zj6rMw2k1+4DV2Mgx9g/DBk+E',
    );
  });
});
