// Packages the app and copies it to the per-user apps folder, replacing the previous copy.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { platform, arch, env } = process;
if (platform !== 'win32' && platform !== 'darwin') {
  console.error(`install-app supports Windows and macOS, not ${platform}.`);
  process.exit(1);
}

// Windows locks a running exe, so the copy would fail after a full build.
const running =
  platform === 'win32'
    ? execFileSync('tasklist', ['/FI', 'IMAGENAME eq slop-term.exe', '/NH'])
        .toString()
        .includes('slop-term.exe')
    : spawnSync('pgrep', ['-x', 'slop-term']).status === 0;
if (running) {
  console.error('Close slop-term and run again.');
  process.exit(1);
}

// pnpm is a .cmd shim on Windows, which only a shell can run.
if (spawnSync('pnpm package', { stdio: 'inherit', shell: true }).status !== 0)
  process.exit(1);

const built = join('out', `slop-term-${platform}-${arch}`);
const [source, target] =
  platform === 'win32'
    ? [built, join(env.LOCALAPPDATA, 'Programs', 'slop-term')]
    : [
        join(built, 'slop-term.app'),
        join(homedir(), 'Applications', 'slop-term.app'),
      ];

rmSync(target, { recursive: true, force: true });
// The macOS bundle's frameworks are symlinks: copying their targets breaks the code signature.
cpSync(source, target, { recursive: true, verbatimSymlinks: true });
console.log(`Installed to ${target}`);

if (platform === 'win32') {
  const shortcut = join(
    env.APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'slop-term.lnk',
  );
  const quote = (s) => `'${s.replaceAll("'", "''")}'`;
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcut)}); ` +
      `$s.TargetPath = ${quote(join(target, 'slop-term.exe'))}; $s.WorkingDirectory = ${quote(target)}; $s.Save()`,
  ]);
  console.log(`Start menu shortcut: ${shortcut}`);
}
