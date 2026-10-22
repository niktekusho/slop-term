import { contextBridge, ipcRenderer } from 'electron';
import type { Message, Request } from './shared/ipc.ts';

contextBridge.exposeInMainWorld('slop', {
  platform: process.platform,
  send: (request: Request) => ipcRenderer.send('backend', request),
  onMessage: (listener: (message: Message) => void) =>
    ipcRenderer.on('backend', (_event, message: Message) => listener(message)),
});
