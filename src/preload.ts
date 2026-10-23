import { contextBridge, ipcRenderer } from 'electron';
import type { Message, Profiler, Request } from './shared/ipc.ts';

const profile = (method: keyof Profiler) => () =>
  ipcRenderer.invoke('profiler', method);

contextBridge.exposeInMainWorld('slop', {
  platform: process.platform,
  send: (request: Request) => ipcRenderer.send('backend', request),
  onMessage: (listener: (message: Message) => void) =>
    ipcRenderer.on('backend', (_event, message: Message) => listener(message)),
  profiler: {
    metrics: profile('metrics'),
    startTrace: profile('startTrace'),
    stopTrace: profile('stopTrace'),
  } satisfies Profiler,
});
