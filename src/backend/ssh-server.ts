import { execFile } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  AgentProtocol,
  Server,
  utils,
  type Connection,
  type ParsedKey,
  type ServerChannel,
  type Session,
  type SFTPWrapper,
} from 'ssh2';

const run = async (...args: string[]) =>
  (await promisify(execFile)('docker', args)).stdout.trim();

export async function dockerRunning() {
  try {
    // A Windows-container daemon (GitHub's windows-latest) cannot pull the Linux OpenSSH image.
    return (await run('info', '--format', '{{.OSType}}')) === 'linux';
  } catch {
    return false;
  }
}

function banner(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.setTimeout(1000);
    socket.once('data', (data) => {
      socket.destroy();
      resolve(data.toString().startsWith('SSH-'));
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('close', () => resolve(false));
  });
}

/** An OpenSSH server in Docker that lets user `test` in with any of `publicKeys` or with `password`. */
export async function startSshServer(publicKeys: string[], password?: string) {
  const id = await run(
    'run',
    '-d',
    '--rm',
    '-e',
    'USER_NAME=test',
    '-e',
    `PUBLIC_KEY=${publicKeys.join('\n')}`,
    ...(password
      ? ['-e', 'PASSWORD_ACCESS=true', '-e', `USER_PASSWORD=${password}`]
      : []),
    '-p',
    '127.0.0.1::2222',
    'lscr.io/linuxserver/openssh-server:latest',
  );
  const port = Number((await run('port', id, '2222')).split(':').at(-1));
  // Docker's port proxy accepts connections before sshd listens: only the SSH banner means it's up.
  const deadline = Date.now() + 60_000;
  while (!(await banner(port))) {
    if (Date.now() > deadline)
      throw new Error('OpenSSH container never answered');
    await new Promise((r) => setTimeout(r, 500));
  }
  // `ssh-keygen -A` writes the host keys before sshd starts.
  const hostKey = async (type: string) =>
    (
      await run(
        'exec',
        id,
        'cat',
        `/config/ssh_host_keys/ssh_host_${type}_key.pub`,
      )
    ).split(' ')[1];
  return {
    port,
    ed25519: await hostKey('ed25519'),
    rsa: await hostKey('rsa'),
    // A paused container still has its TCP connections open, but nothing answers on them.
    pause: () => run('pause', id),
    unpause: () => run('unpause', id),
    stop: () => run('stop', id),
  };
}

/** A key pair for tests. About 1 in 150 ed25519 keys ssh2 generates fail its own parser, so this generates until one parses. */
export function testKeyPair(
  type: 'ed25519' | 'rsa' = 'ed25519',
  locked?: { passphrase: string; cipher: string; rounds: number },
) {
  // `bits` sizes an RSA key; ed25519 ignores it.
  const opts = { bits: 2048, ...locked } as never;
  for (;;) {
    // oxlint-disable-next-line no-restricted-properties -- the one place that calls it.
    const pair = utils.generateKeyPairSync(type as 'ed25519', opts);
    if (!(utils.parseKey(pair.private, locked?.passphrase) instanceof Error))
      return pair;
  }
}

/**
 * An in-process SSH server for what OpenSSH in Docker can't show: keepalive and connection counts, drops on demand, a host key change, held SFTP writes.
 * Any login works, or with `code` only a keyboard-interactive login that answers it, or with `password` only that password. `users` lists each login's user name.
 * With `sftp`, it answers what an upload or a download needs and keeps the files in `files`, by path; without, it has no SFTP subsystem.
 */
export async function startFakeSshServer({
  code,
  password,
  sftp: withSftp = false,
}: { code?: string; password?: string; sftp?: boolean } = {}) {
  const users: string[] = [];
  const connections = new Set<Connection>();
  const shells = new Set<ServerChannel>();
  const files = new Map<string, Buffer>();
  // In seconds, as SFTP reports them. A file without one reads 0.
  const mtimes = new Map<string, number>();
  let keepalives = 0;
  const perConnection = new Map<string, number>();
  let opened = 0;
  // Writes wait while held, so a transfer stays running.
  let held: Promise<void> = Promise.resolve();
  let release = () => {};
  let waiting = 0;
  const sftps = new Set<SFTPWrapper>();
  const sftp = (session: Session) =>
    session.on('sftp', (accept) => {
      const s = accept();
      sftps.add(s);
      const handles = new Map<number, string>();
      let next = 0;
      const { OK, EOF, NO_SUCH_FILE } = utils.sftp.STATUS_CODE;
      const { TRUNC } = utils.sftp.OPEN_MODE;
      s.on('OPEN', (id, path, flags) => {
        if (flags & TRUNC) {
          files.set(path, Buffer.alloc(0));
          mtimes.set(path, Math.floor(Date.now() / 1000));
        } else if (!files.has(path)) return s.status(id, NO_SUCH_FILE);
        handles.set(next, path);
        s.handle(id, Buffer.from([next++]));
      })
        .on('READ', (id, handle, offset, length) => {
          const file = files.get(handles.get(handle[0])!)!;
          if (offset >= file.length) return s.status(id, EOF);
          s.data(id, file.subarray(offset, offset + length));
        })
        .on('WRITE', (id, handle, offset, data) => {
          const path = handles.get(handle[0])!;
          waiting++;
          held.then(() => {
            waiting--;
            const old = files.get(path)!;
            const grown = Buffer.alloc(
              Math.max(old.length, offset + data.length),
            );
            old.copy(grown);
            data.copy(grown, offset);
            files.set(path, grown);
            s.status(id, OK);
          });
        })
        .on('CLOSE', (id) => s.status(id, OK));
      for (const op of ['STAT', 'LSTAT'] as const)
        s.on(op, (id: number, path: string) => {
          const file = files.get(path);
          if (!file) return s.status(id, NO_SUCH_FILE);
          s.attrs(id, {
            mode: 0o100644,
            size: file.length,
            uid: 0,
            gid: 0,
            atime: 0,
            mtime: mtimes.get(path) ?? 0,
          });
        });
    });
  // A host key change swaps the server the next connection reaches.
  const listening = (hostKey: string) =>
    new Server(
      {
        hostKeys: [hostKey],
        // ssh2 answers keepalives itself: only its debug log sees them, each line prefixed by its connection's id.
        debug: (line) => {
          if (!line.includes('GLOBAL_REQUEST (keepalive@openssh.com)')) return;
          keepalives++;
          const id = line.slice(0, line.indexOf(']'));
          perConnection.set(id, (perConnection.get(id) ?? 0) + 1);
        },
      },
      onConnection,
    );
  function onConnection(conn: Connection) {
    opened++;
    connections.add(conn);
    conn
      .on('authentication', (ctx) => {
        users.push(ctx.username);
        if (password !== undefined)
          return ctx.method === 'password' && ctx.password === password
            ? ctx.accept()
            : ctx.reject(['password']);
        if (!code) return ctx.accept();
        if (ctx.method !== 'keyboard-interactive')
          return ctx.reject(['keyboard-interactive']);
        ctx.prompt([{ prompt: 'Verification code: ', echo: true }], (answers) =>
          answers[0] === code ? ctx.accept() : ctx.reject(),
        );
      })
      .on('ready', () => {
        conn.on('session', (accept) => {
          const session = accept();
          session.on('pty', (ok) => ok?.());
          session.on('window-change', (ok) => ok?.());
          session.on('shell', (ok) => {
            const shell = ok();
            shells.add(shell);
            shell.write('$ ');
          });
          if (withSftp) sftp(session);
        });
      })
      .on('error', () => {})
      .on('close', () => connections.delete(conn));
  }
  let current = listening(testKeyPair().private);
  const server = createServer((socket) => current.injectSocket(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    users,
    files,
    /** Modified times in seconds, by path. Opening a file to write sets it to now. */
    mtimes,
    keepalives: () => keepalives,
    /** The keepalive count of each connection that sent one. */
    keepalivesPerConnection: () => [...perConnection.values()],
    /** Connections opened so far, and still open. */
    opened: () => opened,
    open: () => connections.size,
    dropAll: () => connections.forEach((c) => c.end()),
    /** Closes each shell channel with no exit status and keeps the connection. */
    closeShells: () => shells.forEach((s) => s.close()),
    /** New connections get a new host key; open ones keep theirs. */
    changeHostKey: (type: 'ed25519' | 'rsa' = 'ed25519') => {
      current = listening(testKeyPair(type).private);
    },
    /** Holds every SFTP write until `release`. */
    hold: () => {
      held = new Promise((resolve) => (release = resolve));
    },
    release: () => release(),
    /** SFTP writes the hold keeps waiting. */
    waiting: () => waiting,
    /** Closes each SFTP channel and keeps the connection. */
    closeSftp: () => sftps.forEach((s) => s.end()),
    // close() waits for open connections, so it ends them first.
    stop: () =>
      new Promise((resolve) => {
        server.close(resolve);
        connections.forEach((c) => c.end());
      }),
  };
}

/** A minimal SSH agent holding one key, listening where `SSH_AUTH_SOCK` can point. */
export async function startAgent(privateKey: string) {
  const key = utils.parseKey(privateKey) as ParsedKey;
  const name = `slop-agent-${process.pid}-${Date.now()}`;
  const socket =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\${name}`
      : path.join(tmpdir(), name);
  const server = createServer((conn) => {
    const agent = new AgentProtocol(false);
    agent.on('identities', (req) => agent.getIdentitiesReply(req, [key]));
    agent.on('sign', (req, _key, data, flags) =>
      agent.signReply(req, key.sign(data, flags.hash) as Buffer),
    );
    conn.pipe(agent).pipe(conn);
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  return {
    socket,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
