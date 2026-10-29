import {
  app,
  BrowserWindow,
  contentTracing,
  dialog,
  ipcMain,
  nativeTheme,
  powerMonitor,
  utilityProcess,
} from 'electron';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Dialogs, Profiler, Request, Settings } from './shared/ipc.ts';

// `start:profile` gives the main process the default inspector port 9229, so the back end takes 9230.
// Packaged builds skip it: their EnableNodeCliInspectArguments fuse rejects inspector arguments.
const inspect = !app.isPackaged && app.commandLine.hasSwitch('inspect');

app.whenReady().then(() => {
  const backend = utilityProcess.fork(
    path.join(__dirname, 'backend.cjs'),
    [app.getPath('userData')],
    {
      serviceName: 'slop-term back end',
      execArgv: inspect ? ['--inspect=9230'] : [],
    },
  );
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });

  ipcMain.on('backend', (_event, request) => backend.postMessage(request));
  ipcMain.on('theme', (_event, theme: Settings['theme']) => {
    nativeTheme.themeSource = theme;
  });
  backend.on('message', (message) =>
    window.webContents.send('backend', message),
  );
  // The renderer numbers its requests from 1, so its client ignores the reply to id 0.
  powerMonitor.on('resume', () =>
    backend.postMessage({ id: 0, method: 'wake', args: [] } satisfies Request),
  );

  const profiler: Profiler = {
    async metrics() {
      return app.getAppMetrics().map((m) => ({
        pid: m.pid,
        name: m.name ? `${m.type}: ${m.name}` : m.type,
        cpuPercent: m.cpu.percentCPUUsage,
        memoryKB: m.memory.workingSetSize,
      }));
    },
    startTrace: () =>
      contentTracing.startRecording({ included_categories: ['*'] }),
    async stopTrace() {
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: 'slop-term-trace.json',
        filters: [{ name: 'Chrome trace', extensions: ['json'] }],
      });
      if (!canceled) return contentTracing.stopRecording(filePath);
      // Tracing can only stop by writing a file, so a cancelled save writes a temp file and deletes it.
      await rm(await contentTracing.stopRecording(), { force: true });
      return undefined;
    },
  };
  ipcMain.handle('profiler', (_event, method: keyof Profiler) =>
    profiler[method](),
  );

  const dialogs: Dialogs = {
    async pickKeyFile() {
      const home = app.getPath('home');
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        defaultPath: path.join(home, '.ssh'),
        properties: ['openFile', 'showHiddenFiles'],
      });
      if (canceled || !filePaths[0]) return undefined;
      // The same `~/` form the config store writes, so a synced config works on Windows and macOS.
      const inHome = path.relative(home, filePaths[0]);
      return inHome.startsWith('..') || path.isAbsolute(inHome)
        ? filePaths[0]
        : `~/${inHome.replaceAll(path.sep, '/')}`;
    },
  };
  ipcMain.handle('dialogs', (_event, method: keyof Dialogs) =>
    dialogs[method](),
  );

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
});

// ponytail: one window and one back end per run, so closing the window quits on every system.
app.on('window-all-closed', () => app.quit());
