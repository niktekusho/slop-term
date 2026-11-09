import { createHmac } from 'node:crypto';
import type { Backend, Settings, TpmEntry } from '../shared/ipc.ts';
import {
  entry,
  keychainError,
  LoginNeeded,
  type CredentialProvider,
} from './credentials.ts';

// A password entry name has an `@` or starts with `passphrase-`, so it can't take this one.
const keysEntry = () => entry('tpm-api-keys');

const readOnly = async () => {
  throw new Error('TPM is read-only in slop-term.');
};

/** A pasted entry URL ends in the entry's id, as `…/index.php/pwd/view/42`. */
const entryId = (text: string) =>
  text.match(/^(\d+)$/)?.[1] ??
  text.match(/^https?:\/\/\S*\/(\d+)\/?(?:[?#]\S*)?$/)?.[1];

async function saveKeys(publicKey: string, privateKey: string) {
  const keys = JSON.stringify({
    publicKey: publicKey.trim(),
    privateKey: privateKey.trim(),
  });
  await keysEntry().setPassword(keys).catch(keychainError);
}

const askKeys = (reason: string) =>
  new LoginNeeded(
    reason,
    'TPM API keys',
    [
      { prompt: 'Public key', echo: true },
      { prompt: 'Private key', echo: false },
    ],
    ([publicKey = '', privateKey = '']) => saveKeys(publicKey, privateKey),
  );

async function readKeys() {
  const missing = 'TPM needs your API keys, from My Account > API Keys in TPM.';
  const saved = await keysEntry().getPassword().catch(keychainError);
  if (!saved) throw askKeys(missing);
  try {
    const keys = JSON.parse(saved) as { publicKey: string; privateKey: string };
    if (keys.publicKey && keys.privateKey) return keys;
  } catch {
    // A hand-edited keychain entry: ask again.
  }
  throw askKeys(missing);
}

type Json = Record<string, unknown>;

const entryOf = (e: Json): TpmEntry => ({
  id: String(e.id),
  name: typeof e.name === 'string' ? e.name : '',
  username: typeof e.username === 'string' ? e.username : '',
});

/** Team Password Manager over API v6, signed with the user's HMAC keys. slop-term v1 only reads. */
export function createTpm(settings: () => Promise<Settings>): {
  provider: CredentialProvider;
} & Pick<Backend, 'findTpm' | 'setTpmKeys'> {
  async function get(path: string): Promise<unknown> {
    const base = (await settings()).tpmUrl;
    if (!base) throw new Error("TPM isn't set up on this machine.");
    const { publicKey, privateKey } = await readKeys();
    // TPM signs the path after `index.php/`, then the Unix time, then the body, which a GET lacks.
    const signed = `api/v6/${path}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const hash = createHmac('sha256', privateKey)
      .update(signed + timestamp)
      .digest('hex');
    let res: Response;
    try {
      res = await fetch(`${base.replace(/\/+$/, '')}/${signed}`, {
        // TPM answers 415 to a request without `Content-Type`, a GET too.
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Public-Key': publicKey,
          'X-Request-Hash': hash,
          'X-Request-Timestamp': timestamp,
        },
      });
    } catch (e) {
      const cause = (e as Error & { cause?: Error }).cause;
      throw new Error(
        `TPM can't be reached: ${(cause ?? (e as Error)).message}`,
      );
    }
    if (res.status === 401) throw askKeys('TPM rejected the API keys.');
    const body = (await res.json().catch(() => undefined)) as Json | undefined;
    if (!res.ok)
      throw new Error(
        `TPM: ${typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`}`,
      );
    return body;
  }

  const byId = async (id: string) =>
    (await get(`passwords/${id}.json`)) as Json;

  return {
    provider: {
      async read(ref) {
        const e = await byId(ref.entry);
        const { username } = entryOf(e);
        return {
          secret: typeof e.password === 'string' ? e.password : '',
          ...(username && { username }),
        };
      },
      write: readOnly,
      delete: readOnly,
    },

    async findTpm(query) {
      const text = query.trim();
      if (!text) throw new Error('Paste a TPM URL or id, or type a search.');
      const id = entryId(text);
      try {
        if (id) return { entries: [entryOf(await byId(id))] };
        const found = await get(
          `passwords/search/${encodeURIComponent(text)}.json`,
        );
        return { entries: Array.isArray(found) ? found.map(entryOf) : [] };
      } catch (e) {
        if (e instanceof LoginNeeded) return { keys: e.message };
        throw e;
      }
    },

    setTpmKeys: saveKeys,
  };
}
