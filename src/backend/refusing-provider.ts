import { providers } from './credentials.ts';

// Test-only: the harness loads this file before the back end. It reads nothing and refuses every write, as TPM does.
providers.refusing = {
  read: async () => {
    throw new Error('The refusing provider has no secrets.');
  },
  write: async () => {
    throw new Error('The refusing provider is read-only.');
  },
  delete: async () => {
    throw new Error('The refusing provider is read-only.');
  },
};
