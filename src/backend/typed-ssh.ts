import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SessionTree } from '../shared/ipc.ts';
import { resolve, type Resolved } from './resolver.ts';

const run = async (file: string, args: string[]) =>
  (await promisify(execFile)(file, args)).stdout.trim();

/** A running `ssh`: its pid, the executable it came from and the arguments after its name. */
export type SshProcess = { pid: number; file: string; args: string[] };

/** A Windows command line as `CommandLineToArgvW` reads it, for the quoting PowerShell and cmd write: quotes group, `\"` is a quote. */
function splitCommandLine(line: string) {
  const args: string[] = [];
  let arg = '';
  let quoted = false;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '"') {
      arg += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(c) && !quoted) {
      if (arg || started) args.push(arg);
      arg = '';
      started = false;
    } else arg += c;
  }
  if (arg || started) args.push(arg);
  return args;
}

/**
 * The newest direct child named `ssh` of the shell with pid `shell`. An `ssh` that `git` or `scp` started is their child, so it never counts.
 * ponytail: one PowerShell per check on Windows, about 1.5 s; a long-lived PowerShell reading pids from stdin if that shows in the profiler.
 */
export async function findSsh(shell: number): Promise<SshProcess | undefined> {
  if (process.platform === 'win32') {
    const json = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ParentProcessId=${shell} AND Name='ssh.exe'" | Sort-Object CreationDate | Select-Object -Last 1; if ($p) { @{ pid = $p.ProcessId; file = $p.ExecutablePath; line = $p.CommandLine } | ConvertTo-Json -Compress }`,
    ]);
    if (!json) return undefined;
    const p = JSON.parse(json) as { pid: number; file: string; line: string };
    return {
      pid: p.pid,
      file: p.file,
      args: splitCommandLine(p.line).slice(1),
    };
  }
  // macOS prints the executable's full path as `comm`; Linux prints only its name, so the `ssh` on PATH stands in.
  // ponytail: the highest pid counts as the newest; pids wrap only after about 99,999 processes on macOS.
  const children = (await run('ps', ['-A', '-o', 'pid=,ppid=,comm=']))
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter((m) => m && Number(m[2]) === shell && path.basename(m[3]) === 'ssh')
    .map((m) => ({ pid: Number(m![1]), comm: m![3] }));
  const newest = children.sort((a, b) => b.pid - a.pid)[0];
  if (!newest) return undefined;
  // ponytail: `ps` joins the arguments with spaces, so an argument with a space in it splits.
  const line = await run('ps', [
    '-ww',
    '-o',
    'args=',
    '-p',
    String(newest.pid),
  ]);
  return {
    pid: newest.pid,
    file: path.isAbsolute(newest.comm) ? newest.comm : 'ssh',
    args: line.split(/\s+/).slice(1),
  };
}

export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // The process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// The `ssh` options that take a value, from ssh(1).
const valued = new Set('BbcDEeFIiJLlmOoPpQRSWw');

/** The host part of the destination as typed: `web1` from `bob@web1`, `ssh://bob@web1:2222` or `-l bob web1`. */
export function destination(args: string[]) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return hostOf(args[i + 1]);
    if (!arg.startsWith('-') || arg === '-') return hostOf(arg);
    for (let j = 1; j < arg.length; j++)
      if (valued.has(arg[j])) {
        if (j === arg.length - 1) i++;
        break;
      }
  }
  return undefined;
}

function hostOf(target?: string) {
  if (!target) return undefined;
  const uri = target.match(/^ssh:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)/);
  if (uri) return uri[1].replace(/^\[|\]$/g, '');
  return target.slice(target.lastIndexOf('@') + 1);
}

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

/** Tree order: top-level sessions, then folders A to Z, and inside a folder its subfolders before its sessions. */
function treeOrder(
  a: { alias: string; folder?: string },
  b: { alias: string; folder?: string },
) {
  const x = a.folder ? a.folder.split('/') : [];
  const y = b.folder ? b.folder.split('/') : [];
  for (let i = 0; ; i++) {
    if (i === x.length && i === y.length) return byName(a.alias, b.alias);
    if (i === x.length) return i === 0 ? -1 : 1;
    if (i === y.length) return i === 0 ? 1 : -1;
    const names = byName(x[i], y[i]);
    if (names) return names;
  }
}

/**
 * The Saved session a typed `ssh` reached. The typed alias counts only with the user `ssh` resolved, so `ssh bob@web1` doesn't take alice's `web1`.
 * Else the first session in tree order with a Credential reference whose `HostName`, `Port` and `User` resolve to the same.
 */
export async function matchSession(
  tree: SessionTree,
  alias: string | undefined,
  r: Resolved,
): Promise<{ session?: string; handWritten?: string }> {
  const sameUser = async (a: string) =>
    (await resolve(a).catch(() => undefined))?.user === r.user;
  if (alias && tree.sessions.some((s) => s.alias === alias)) {
    if (await sameUser(alias)) return { session: alias };
  } else if (
    alias &&
    tree.handWritten.includes(alias) &&
    (await sameUser(alias))
  )
    return { handWritten: alias };
  const candidates = tree.sessions
    .filter((s) => s.credential)
    .toSorted(treeOrder);
  const found = await Promise.all(
    candidates.map((s) => resolve(s.alias).catch(() => undefined)),
  );
  const i = found.findIndex(
    (c) => c?.hostname === r.hostname && c.port === r.port && c.user === r.user,
  );
  return i < 0 ? {} : { session: candidates[i].alias };
}
