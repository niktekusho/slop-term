import { AsyncEntry } from '@napi-rs/keyring';
import type {
  CredentialReference,
  KeepassTarget,
  SecretQuestion,
} from '../shared/ipc.ts';

/** `username` is the account the entry names, if the provider stores one, so a connect can check it. */
export type ProviderRead = { secret: string; username?: string };

/** What a new entry says about the account it unlocks. */
export type NewEntry = { title: string; username: string; url: string };

/** Every method can fail or refuse: it rejects with an Error whose message the user can read. */
export type CredentialProvider = {
  read(ref: CredentialReference): Promise<ProviderRead>;
  write(ref: CredentialReference, secret: string): Promise<void>;
  delete(ref: CredentialReference): Promise<void>;
  /** Makes a new entry in a place the user picked and returns its reference. Only KeePass has one: a keychain entry needs no place. */
  create?(
    target: KeepassTarget,
    entry: NewEntry,
    kind: CredentialReference['kind'],
    secret: string,
  ): Promise<CredentialReference>;
};

/**
 * A provider rejects a read with this when it needs its own login first, as TPM needs API keys and KeePass a master password.
 * The app asks `prompts` and passes the answers to `login`, which resolves to a reason when it refuses them.
 */
export class LoginNeeded extends Error {
  readonly title: string;
  readonly prompts: SecretQuestion['prompts'];
  readonly login: (answers: string[]) => Promise<string | void>;
  /** The reason the read fails with when the user cancels the question. Without it, a cancel ends the connect. */
  readonly cancelled?: string;
  constructor(
    reason: string,
    title: string,
    prompts: SecretQuestion['prompts'],
    login: (answers: string[]) => Promise<string | void>,
    cancelled?: string,
  ) {
    super(reason);
    this.title = title;
    this.prompts = prompts;
    this.login = login;
    this.cancelled = cancelled;
  }
}

// Tests point the keychain at a service of their own.
const service = process.env.SLOP_TERM_KEYCHAIN_SERVICE || 'slop-term';
export const entry = (id: string) => new AsyncEntry(service, id);
export const keychainError = (e: Error): never => {
  throw new Error(`Keychain: ${e.message}`);
};

const keychain: CredentialProvider = {
  async read(ref) {
    const secret = await entry(ref.entry).getPassword().catch(keychainError);
    if (secret === null)
      throw new Error(`No saved ${ref.kind} in the keychain on this machine.`);
    return { secret };
  },
  async write(ref, secret) {
    await entry(ref.entry).setPassword(secret).catch(keychainError);
  },
  async delete(ref) {
    await entry(ref.entry).deletePassword().catch(keychainError);
  },
};

/** A password belongs to an account: its new keychain entry is named `user@host`, with `-port` when the port isn't 22. */
export const accountName = (r: {
  user: string;
  hostname: string;
  port: number;
}) => `${r.user}@${r.hostname}${r.port === 22 ? '' : `-${r.port}`}`;

/**
 * A keychain entry id from `name` that no entry on this machine uses yet, adding `-2`, `-3` and so on.
 * Keychains differ in which characters they accept, so the id keeps only letters, digits and `._@-`.
 */
export async function newKeychainEntry(name: string) {
  const base = name.replace(/[^A-Za-z0-9._@-]+/g, '-').slice(0, 100);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if ((await entry(id).getPassword().catch(keychainError)) === null)
      return id;
  }
}

/** Keyed by `CredentialReference.provider`. The back end adds TPM once it has the settings. */
export const providers: Record<string, CredentialProvider> = { keychain };

/** A reference synced from a newer slop-term can name a provider this one lacks. */
export function provider(ref: CredentialReference) {
  if (!Object.hasOwn(providers, ref.provider))
    throw new Error(`slop-term has no credential provider "${ref.provider}".`);
  return providers[ref.provider];
}
