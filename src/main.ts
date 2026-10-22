import { app, BrowserWindow, ipcMain, utilityProcess } from 'electron';
import path from 'node:path';

app.whenReady().then(() => {
  const backend = utilityProcess.fork(path.join(__dirname, 'backend.cjs'), [], {
    serviceName: 'slop-term back end',
  });
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });

  ipcMain.on('backend', (_event, request) => backend.postMessage(request));
  backend.on('message', (message) =>
    window.webContents.send('backend', message),
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
