import { createHash, createHmac, randomBytes } from 'node:crypto';

export type SavedKey = {
  file: string;
  line: number;
  type: string;
  key: string;
};

export const knownHostName = (host: string, port: number) =>
  port === 22 ? host : `[${host}]:${port}`;

const hashName = (salt: Buffer, name: string) =>
  createHmac('sha1', salt).update(name).digest('base64');

// ponytail: exact names and `|1|` hashes only, no `*`/`!` patterns; add them if someone keeps patterns in known_hosts.
function matches(field: string, name: string) {
  if (field.startsWith('|1|')) {
    const [, , salt, hash] = field.split('|');
    return hashName(Buffer.from(salt, 'base64'), name) === hash;
  }
  return field.toLowerCase().split(',').includes(name.toLowerCase());
}

/** Entries for `name`, with 1-based line numbers. `@cert-authority` and `@revoked` lines don't count. */
export function savedKeys(file: string, text: string, name: string) {
  const keys: SavedKey[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const [field, type, key] = line.trim().split(/\s+/);
    if (!key || field.startsWith('#') || field.startsWith('@')) return;
    if (matches(field, name)) keys.push({ file, line: i + 1, type, key });
  });
  return keys;
}

export function hostEntry(
  name: string,
  type: string,
  key: string,
  hashed: boolean,
) {
  if (!hashed) return `${name} ${type} ${key}`;
  const salt = randomBytes(20);
  return `|1|${salt.toString('base64')}|${hashName(salt, name)} ${type} ${key}`;
}

export function removeLine(text: string, line: number) {
  const lines = text.split(/(?<=\n)/);
  lines.splice(line - 1, 1);
  return lines.join('');
}

export const fingerprint = (key: string) =>
  'SHA256:' +
  createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest('base64')
    .replace(/=+$/, '');
