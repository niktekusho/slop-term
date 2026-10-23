/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  slop: {
    platform: NodeJS.Platform;
    send(request: import('./shared/ipc.ts').Request): void;
    onMessage(
      listener: (message: import('./shared/ipc.ts').Message) => void,
    ): void;
    profiler: import('./shared/ipc.ts').Profiler;
  };
}
