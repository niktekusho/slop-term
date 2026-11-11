import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { findOnPath } from './shells.ts';

/**
 * Opens the file in `editor`, else `code`, else Notepad++, else the OS default app.
 * Resolves to the app's name as a row shows it: "VS Code", "Notepad++", "the default app" or the editor's file name.
 */
export async function openInEditor(file: string, editor?: string) {
  const command = editor || defaultEditor();
  // On Windows `code` is a .cmd script, which needs a shell; the quotes keep paths with spaces whole.
  const child =
    process.platform === 'win32'
      ? spawn(`"${command}" "${file}"`, {
          shell: true,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
      : spawn(command, [file], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return appName(command);
}

const notepadPlusPlus = String.raw`C:\Program Files\Notepad++\notepad++.exe`;

function defaultEditor() {
  if (process.platform !== 'win32')
    return findOnPath('code') ?? findOnPath('notepad++') ?? 'open';
  return (
    findOnPath('code.cmd') ??
    findOnPath('notepad++.exe') ??
    (existsSync(notepadPlusPlus) ? notepadPlusPlus : 'explorer.exe')
  );
}

function appName(command: string) {
  const name = path.parse(command).name;
  const known: Record<string, string> = {
    code: 'VS Code',
    'notepad++': 'Notepad++',
    explorer: 'the default app',
    open: 'the default app',
  };
  return known[name.toLowerCase()] ?? name;
}
