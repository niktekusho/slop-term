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
    { kind: findOnPath('pwsh.exe') ? 'pwsh' : 'powershell' },
    { kind: 'cmd' },
  ];
  for (const distro of await wslDistros()) shells.push({ kind: 'wsl', distro });
  return shells;
}

export function spawnLine(launch: Parameters<typeof launchLine>[0]) {
  const { args, cwd } = launchLine(launch);
  return {
    file:
      process.platform === 'win32'
        ? `${launch.kind}.exe`
        : `/bin/${launch.kind}`,
    args,
    cwd: cwd.replace(/^~(?=$|[\\/])/, homedir()),
  };
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
