import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    // Each back-end test starts Electron, pwsh and wsl.exe: more workers slow every start and leave the total time unchanged.
    maxWorkers: 4,
    projects: [
      {
        test: {
          name: 'backend',
          include: ['src/backend/**/*.test.ts', 'src/shared/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['src/backend/global-setup.ts'],
          testTimeout: 20_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          include: ['src/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          // A fresh jsdom per file cost a third of the UI run: vmThreads creates one per worker and keeps each file isolated.
          pool: 'vmThreads',
          setupFiles: ['src/renderer/test-setup.ts'],
        },
      },
    ],
  },
});
