import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/backend/main.ts',
      fileName: () => 'backend.cjs',
      formats: ['cjs'],
    },
    rollupOptions: { external: ['node-pty'] },
  },
});
