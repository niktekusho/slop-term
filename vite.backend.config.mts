import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/backend/main.ts',
      fileName: () => 'backend.cjs',
      formats: ['cjs'],
    },
    // ssh2 loads its native helpers inside try/catch and falls back to pure JS: they stay out of the bundle.
    // @napi-rs/keyring picks its native package per platform at run time.
    rollupOptions: {
      external: ['node-pty', '@napi-rs/keyring', 'cpu-features', /\.node$/],
    },
  },
});
