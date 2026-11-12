import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eventually, startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
afterEach(() => harness.stop());

// A file written right after the start can miss the settings watcher: on macOS its FSEvents stream starts later.
// So settings a test reads are in place before the start.
async function start(settings?: object) {
  harness = await startBackend(
    settings ? { 'settings.json': JSON.stringify(settings) } : {},
  );
}

const settingsFile = () => path.join(harness.home, 'settings.json');
const settingsEvents = () =>
  harness.events.flatMap((e) => (e.type === 'settings' ? [e.settings] : []));

describe('settings', () => {
  it('uses the defaults when settings.json is missing', async () => {
    await start();
    expect(await harness.backend.settings()).toEqual({
      theme: 'system',
      fontSize: 12,
      scrollback: 1000,
      uploadOnSave: true,
      sessionColourTint: 10,
      keepassDatabases: [],
    });
  });

  it('names a KeePass database after its file unless the list gives a name, and skips an entry without a path', async () => {
    await start({
      keepassDatabases: [
        { path: 'C:\\Users\\me\\OneDrive\\work.kdbx' },
        { name: 'home', path: '/Users/me/Passwords.kdbx' },
        { name: 'broken' },
      ],
    });
    expect((await harness.backend.settings()).keepassDatabases).toEqual([
      { name: 'work', path: 'C:\\Users\\me\\OneDrive\\work.kdbx' },
      { name: 'home', path: '/Users/me/Passwords.kdbx' },
    ]);
  });

  it('reads a Session colour tint from 0 to 100 and falls back to 10 for anything else', async () => {
    await start({ sessionColourTint: 0 });
    expect((await harness.backend.settings()).sessionColourTint).toBe(0);
    await harness.backend.updateSettings({ sessionColourTint: 101 });
    expect((await harness.backend.settings()).sessionColourTint).toBe(10);
  });

  it('sends a settings message when settings.json changes on disk', async () => {
    await start();
    // The watcher may miss a write in its first milliseconds, so the test saves again until it hears one.
    await eventually(async () => {
      await writeFile(
        settingsFile(),
        JSON.stringify({ theme: 'dark', fontFamily: 'Consolas' }),
      );
      expect(settingsEvents().at(-1)).toEqual({
        theme: 'dark',
        fontFamily: 'Consolas',
        fontSize: 12,
        scrollback: 1000,
        uploadOnSave: true,
        sessionColourTint: 10,
        keepassDatabases: [],
      });
    });
  });

  it('saves a new font size and keeps the other keys', async () => {
    await start();
    await writeFile(
      settingsFile(),
      JSON.stringify({ theme: 'light', tpmBaseUrl: 'https://tpm.example' }),
    );
    await harness.backend.updateSettings({ fontSize: 14 });

    expect(JSON.parse(await readFile(settingsFile(), 'utf8'))).toEqual({
      theme: 'light',
      tpmBaseUrl: 'https://tpm.example',
      fontSize: 14,
    });
    await eventually(() =>
      expect(settingsEvents().at(-1)).toMatchObject({
        theme: 'light',
        fontSize: 14,
      }),
    );
  });

  it('refuses to save over a settings.json that is not valid JSON', async () => {
    await start();
    await writeFile(settingsFile(), '{ "theme": "dark",');
    await expect(
      harness.backend.updateSettings({ fontSize: 14 }),
    ).rejects.toThrow();
    expect(await readFile(settingsFile(), 'utf8')).toBe('{ "theme": "dark",');
  });

  it('opens settings.json in the configured editor', async () => {
    await start();
    const opened = path.join(harness.home, 'opened.txt');
    const editor =
      process.platform === 'win32'
        ? path.join(harness.home, 'my editor.cmd')
        : path.join(harness.home, 'my editor.sh');
    await writeFile(
      editor,
      process.platform === 'win32'
        ? `@echo %~1> "${opened}"\r\n`
        : `#!/bin/sh\necho "$1" > "${opened}"\n`,
      { mode: 0o755 },
    );
    await harness.backend.updateSettings({ editor });

    await harness.backend.openSettings();
    await eventually(async () =>
      expect((await readFile(opened, 'utf8')).trim()).toBe(settingsFile()),
    );
  });
});
