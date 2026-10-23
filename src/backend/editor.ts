import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { findOnPath } from './shells.ts';

/** Opens the file in `editor`, else `code`, else Notepad++ (Windows), else the OS default app. */
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
}

const notepadPlusPlus = String.raw`C:\Program Files\Notepad++\notepad++.exe`;

function defaultEditor() {
  if (process.platform !== 'win32') return findOnPath('code') ?? 'open';
  return (
    findOnPath('code.cmd') ??
    findOnPath('notepad++.exe') ??
    (existsSync(notepadPlusPlus) ? notepadPlusPlus : 'explorer.exe')
  );
}
