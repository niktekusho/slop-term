import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
beforeEach(async () => {
  harness = await startBackend();
});
afterEach(() => harness.stop());

const eventually = (assertion: () => void) =>
  vi.waitFor(assertion, { timeout: 10_000 });

const settingsFile = () => path.join(harness.home, 'settings.json');
const settingsEvents = () =>
  harness.events.flatMap((e) => (e.type === 'settings' ? [e.settings] : []));

describe('settings', () => {
  it('uses the defaults when settings.json is missing', async () => {
    expect(await harness.backend.settings()).toEqual({
      theme: 'system',
      fontSize: 12,
      scrollback: 1000,
    });
  });

  it('sends a settings message when settings.json changes on disk', async () => {
    await harness.backend.settings();
    await writeFile(
      settingsFile(),
      JSON.stringify({ theme: 'dark', fontFamily: 'Consolas' }),
    );
    await eventually(() =>
      expect(settingsEvents().at(-1)).toEqual({
        theme: 'dark',
        fontFamily: 'Consolas',
        fontSize: 12,
        scrollback: 1000,
      }),
    );
  });

  it('saves a new font size and keeps the other keys', async () => {
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
    await writeFile(settingsFile(), '{ "theme": "dark",');
    await expect(
      harness.backend.updateSettings({ fontSize: 14 }),
    ).rejects.toThrow();
    expect(await readFile(settingsFile(), 'utf8')).toBe('{ "theme": "dark",');
  });

  it('opens settings.json in the configured editor', async () => {
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
    await writeFile(settingsFile(), JSON.stringify({ editor }));
    await eventually(async () =>
      expect((await harness.backend.settings()).editor).toBe(editor),
    );

    await harness.backend.openSettings();
    await eventually(async () =>
      expect((await readFile(opened, 'utf8')).trim()).toBe(settingsFile()),
    );
  });
});
