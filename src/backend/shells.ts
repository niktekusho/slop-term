import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Shell } from '../shared/ipc.ts';
import { launchLine } from '../shared/session-rules.ts';

export async function detectShells(): Promise<Shell[]> {
  if (process.platform !== 'win32') {
    return (['zsh', 'bash'] as const)
      .filter((kind) => existsSync(`/bin/${kind}`))
      .map((kind) => ({ kind }));
  }
  const shells: Shell[] = [
    { kind: pwshPath() ? 'pwsh' : 'powershell' },
    { kind: 'cmd' },
  ];
  for (const distro of await wslDistros()) shells.push({ kind: 'wsl', distro });
  return shells;
}

export function spawnLine(launch: Parameters<typeof launchLine>[0]) {
  const { args, cwd } = launchLine(launch);
  return {
    file:
      process.platform !== 'win32'
        ? `/bin/${launch.kind}`
        : launch.kind === 'pwsh'
          ? (pwshPath() ?? 'pwsh.exe')
          : `${launch.kind}.exe`,
    args,
    cwd: cwd.replace(/^~(?=$|[\\/])/, homedir()),
  };
}

// PATH can list an older x86 install first: Windows Terminal picks the 64-bit install too.
function pwshPath() {
  const x64 = path.join(
    process.env.ProgramFiles ?? '',
    'PowerShell',
    '7',
    'pwsh.exe',
  );
  return existsSync(x64) ? x64 : findOnPath('pwsh.exe');
}

export function findOnPath(file: string) {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, file))
    .find(existsSync);
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
