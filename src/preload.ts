import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type {
  Dialogs,
  Message,
  Profiler,
  Request,
  WindowControls,
} from './shared/ipc.ts';

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
  dialogs: {
    pickKeyFile: () => ipcRenderer.invoke('dialogs', 'pickKeyFile'),
  } satisfies Dialogs,
  window: {
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    setTheme: (theme) => ipcRenderer.send('theme', theme),
  } satisfies WindowControls,
});
