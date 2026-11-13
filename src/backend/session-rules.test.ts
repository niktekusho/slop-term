import { describe, expect, it } from 'vitest';
import {
  aliasProblem,
  importAliasProblem,
  slugify,
  typedAlias,
} from '../shared/session-rules.ts';

// Every character `ssh -G a<c>b` rejects with "hostname contains invalid characters" (OpenSSH 10.6).
const sshRejected = [...`()'&$;|<>"\`\\{}`];

describe('alias characters OpenSSH rejects', () => {
  it.each(sshRejected)('aliasProblem blocks %s', (c) => {
    expect(aliasProblem(`a${c}b`, [])).toBe(`No ${c} in an alias.`);
  });

  it('aliasProblem still accepts characters ssh accepts', () => {
    expect(aliasProblem('a.b_c-d#e~f+g@h:i/j=k%l^m[n]o', [])).toBeUndefined();
  });

  it('importAliasProblem blocks a hand-typed ( in the preview alias', () => {
    expect(importAliasProblem('a(b', [], [])).toBe('No ( in an alias.');
  });

  it('slugify turns each run of those characters into one dash', () => {
    expect(slugify('example-host-(testuser)')).toBe('example-host-testuser');
    expect(slugify(`a${sshRejected.join('')}b`)).toBe('a-b');
    expect(slugify('a--b')).toBe('a-b');
  });

  it('typedAlias cleans a typed host, and the user-host fallback when the host is taken', () => {
    expect(typedAlias('web$1', 'root', [])).toBe('web-1');
    expect(typedAlias('web$1', 'bob', ['web-1'])).toBe('bob-web-1');
  });
});
