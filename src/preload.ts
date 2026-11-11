import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
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
    pickFolder: () => ipcRenderer.invoke('dialogs', 'pickFolder'),
    pickFiles: () => ipcRenderer.invoke('dialogs', 'pickFiles'),
    showItem: (file) => ipcRenderer.invoke('dialogs', 'showItem', file),
    pathForFile: (file) => webUtils.getPathForFile(file),
  } satisfies Dialogs,
  window: {
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    setTheme: (theme) => ipcRenderer.send('theme', theme),
  } satisfies WindowControls,
});
