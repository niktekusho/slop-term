// Run from the repo root: pnpm exec electron .scratch/slop-term-v1-build/issues/24-hit-test/main.cjs
const { app, BrowserWindow } = require('electron');

// Printing the error and exiting keeps Electron from showing its error dialog and waiting on it.
const fail = (e) => {
  console.error(e);
  app.exit(1);
};
process.on('uncaughtException', fail);
setTimeout(() => fail(new Error('timed out')), 30000);

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 900, height: 600 });
  await w.loadFile(`${__dirname}/page.html`);
  await new Promise((r) => setTimeout(r, 500));
  console.log('index.css as is:', await w.webContents.executeJavaScript('hit()'));
  await w.webContents.executeJavaScript(
    "document.getElementById('override').textContent = '.terminal { isolation: auto }'",
  );
  console.log('without isolation:', await w.webContents.executeJavaScript('hit()'));
  app.quit();
}).catch(fail);
