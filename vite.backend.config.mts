import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/backend/main.ts',
      fileName: () => 'backend.cjs',
      formats: ['cjs'],
    },
    // ssh2 loads its native helpers inside try/catch and falls back to pure JS: they stay out of the bundle.
    rollupOptions: { external: ['node-pty', 'cpu-features', /\.node$/] },
  },
});
