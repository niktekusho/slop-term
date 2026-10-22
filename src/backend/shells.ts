import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Shell } from '../shared/ipc.ts';

export async function detectShells(): Promise<Shell[]> {
  if (process.platform !== 'win32') {
    return (['zsh', 'bash'] as const)
      .filter((kind) => existsSync(`/bin/${kind}`))
      .map((kind) => ({ kind }));
  }
  const shells: Shell[] = [
    { kind: onPath('pwsh.exe') ? 'pwsh' : 'powershell' },
    { kind: 'cmd' },
  ];
  for (const distro of await wslDistros()) shells.push({ kind: 'wsl', distro });
  return shells;
}

export function launchLine(shell: Shell): [file: string, args: string[]] {
  switch (shell.kind) {
    case 'pwsh':
    case 'powershell':
    case 'cmd':
      return [`${shell.kind}.exe`, []];
    case 'wsl':
      return ['wsl.exe', ['-d', shell.distro, '--cd', '~']];
    case 'zsh':
    case 'bash':
      return [`/bin/${shell.kind}`, ['-l']];
  }
}

function onPath(file: string) {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => dir && existsSync(path.join(dir, file)));
}

async function wslDistros() {
  try {
    const { stdout } = await promisify(execFile)('wsl.exe', ['-l', '-q'], {
      env: { ...process.env, WSL_UTF8: '1' },
    });
    // Older wsl.exe ignores WSL_UTF8 and writes UTF-16LE: dropping NULs and the BOM recovers the names.
    return stdout
      .replace(/[\0﻿]/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((name) => name && !name.startsWith('docker-desktop'));
  } catch {
    return [];
  }
}
