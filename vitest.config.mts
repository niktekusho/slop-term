import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'backend',
          include: ['src/backend/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          include: ['src/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['src/renderer/test-setup.ts'],
        },
      },
    ],
  },
});
