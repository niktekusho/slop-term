import { execFile } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AgentProtocol, utils, type ParsedKey } from 'ssh2';

const run = async (...args: string[]) =>
  (await promisify(execFile)('docker', args)).stdout.trim();

export async function dockerRunning() {
  try {
    await run('info');
    return true;
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
    stop: () => run('stop', id),
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
