import { AsyncEntry } from '@napi-rs/keyring';
import type { CredentialReference } from '../shared/ipc.ts';

/** Every method can fail or refuse: it rejects with an Error whose message the user can read. */
export type CredentialProvider = {
  read(ref: CredentialReference): Promise<string>;
  write(ref: CredentialReference, secret: string): Promise<void>;
  delete(ref: CredentialReference): Promise<void>;
};

// Tests point the keychain at a service of their own.
const service = process.env.SLOP_TERM_KEYCHAIN_SERVICE || 'slop-term';
const entry = (ref: CredentialReference) => new AsyncEntry(service, ref.entry);
const keychainError = (e: Error): never => {
  throw new Error(`Keychain: ${e.message}`);
};

const keychain: CredentialProvider = {
  async read(ref) {
    const secret = await entry(ref).getPassword().catch(keychainError);
    if (secret === null)
      throw new Error(`No saved ${ref.kind} in the keychain on this machine.`);
    return secret;
  },
  async write(ref, secret) {
    await entry(ref).setPassword(secret).catch(keychainError);
  },
  async delete(ref) {
    await entry(ref).deletePassword().catch(keychainError);
  },
};

/** Keyed by `CredentialReference.provider`. Tests add fakes before the back end starts. */
export const providers: Record<string, CredentialProvider> = { keychain };

/** A reference synced from a newer slop-term can name a provider this one lacks. */
export function provider(ref: CredentialReference) {
  if (!Object.hasOwn(providers, ref.provider))
    throw new Error(`slop-term has no credential provider "${ref.provider}".`);
  return providers[ref.provider];
}
