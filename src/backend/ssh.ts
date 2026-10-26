import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Client, type AnyAuthMethod, type ClientChannel } from 'ssh2';
import type {
  BackendEvent,
  HostKeyQuestion,
  TabId,
  TerminalSize,
} from '../shared/ipc.ts';
import {
  fingerprint,
  hostEntry,
  knownHostName,
  removeLine,
  savedKeys,
} from './known-hosts.ts';
import { resolve } from './resolver.ts';

export type SshTab = {
  write(data: string): void;
  resize(size: TerminalSize): void;
  answerHostKey(trust: boolean): void;
  /** The key this Tab accepted, in base64, for its later connections. */
  hostKey?: string;
};

const jumpHostMessage =
  "This host uses a jump host. slop-term v1 can't connect to it.";

// `ssh2` names RSA by its signature algorithms; known_hosts names the key.
const algorithms: Record<string, string[]> = {
  'ssh-ed25519': ['ssh-ed25519'],
  'ecdsa-sha2-nistp256': ['ecdsa-sha2-nistp256'],
  'ecdsa-sha2-nistp384': ['ecdsa-sha2-nistp384'],
  'ecdsa-sha2-nistp521': ['ecdsa-sha2-nistp521'],
  'ssh-rsa': ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
};

const nullDevice = (file: string) => /^(\/dev\/null|nul)$/i.test(file);

function readText(file: string) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function keyType(key: Buffer) {
  return key.subarray(4, 4 + key.readUInt32BE(0)).toString();
}

const agentPath = () =>
  process.env.SSH_AUTH_SOCK ||
  (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);

export function openSshTab(
  alias: string,
  tab: TabId,
  emit: (event: BackendEvent) => void,
  onClose: () => void,
): SshTab {
  const client = new Client();
  let size: TerminalSize = { cols: 80, rows: 24 };
  let channel: ClientChannel | undefined;
  let answer: ((trust: boolean) => void) | undefined;
  let closed = false;

  const print = (text: string) =>
    emit({ type: 'output', tab, data: `\r\n${text}\r\n` });
  const close = (message?: string) => {
    if (closed) return;
    closed = true;
    if (answer) {
      answer(false);
      answer = undefined;
      emit({ type: 'hostKey', tab });
    }
    if (message) print(message);
    client.end();
    onClose();
  };
  const ask = (question: HostKeyQuestion) =>
    new Promise<boolean>((resolve) => {
      answer = resolve;
      emit({ type: 'hostKey', tab, question });
    });

  const sshTab: SshTab = {
    write: (data) => channel?.write(data),
    resize(next) {
      size = next;
      channel?.setWindow(next.rows, next.cols, 0, 0);
    },
    answerHostKey(trust) {
      answer?.(trust);
      answer = undefined;
    },
  };

  async function connect() {
    const r = await resolve(alias);
    if (r.jumpHost) return close(jumpHostMessage);

    const name = knownHostName(r.hostKeyAlias ?? r.hostname, r.port);
    // `ssh -G` on Windows mixes `\` and `/`; the changed-key warning shows the native path.
    const files = r.knownHostsFiles
      .filter((f) => !nullDevice(f))
      .map(path.normalize);
    const saved = files.flatMap((f) => savedKeys(f, readText(f) ?? '', name));
    const savedTypes = [...new Set(saved.map((k) => k.type))].flatMap(
      (t) => algorithms[t] ?? [],
    );
    const save = (type: string, key: string) => {
      if (!files[0]) return;
      mkdirSync(path.dirname(files[0]), { recursive: true });
      const text = readText(files[0]) ?? '';
      const eol = text && !text.endsWith('\n') ? '\n' : '';
      appendFileSync(
        files[0],
        `${eol}${hostEntry(name, type, key, r.hashKnownHosts)}\n`,
      );
    };

    async function trusted(blob: Buffer) {
      const key = blob.toString('base64');
      const type = keyType(blob);
      const facts = {
        alias,
        host: `${r.hostname}:${r.port}`,
        type,
        fingerprint: fingerprint(key),
      };
      const sameType = saved.filter((k) => k.type === type);
      if (sameType.some((k) => k.key === key)) return true;
      // A changed key blocks even with `StrictHostKeyChecking no`.
      const old = sameType[0];
      if (old) {
        const { file, line } = old;
        const changed = { fingerprint: fingerprint(old.key), file, line };
        if (!(await ask({ ...facts, kind: 'changed', old: changed })))
          return false;
        writeFileSync(old.file, removeLine(readText(old.file) ?? '', old.line));
        save(type, key);
        return true;
      }
      if (r.saveUnknownKeys) {
        save(type, key);
        return true;
      }
      const question = { ...facts, kind: 'unknown' as const };
      const trust = await ask(
        saved[0] ? { ...question, savedType: saved[0].type } : question,
      );
      if (trust) save(type, key);
      return trust;
    }

    const agent = agentPath();
    const keys = r.identityFiles.flatMap((file) => {
      const key = readText(file);
      return key ? [{ type: 'publickey' as const, username: r.user, key }] : [];
    });
    const auth: AnyAuthMethod[] = [
      ...(agent ? [{ type: 'agent' as const, username: r.user, agent }] : []),
      ...keys,
    ];

    let declined = false;
    client
      .on('error', (e: Error & { level?: string }) => {
        // A missing agent is not fatal: `ssh2` goes on to the key files.
        if (e.level === 'agent') return;
        close(
          declined ? 'Not connected: the host key was not trusted.' : e.message,
        );
      })
      .on('ready', () =>
        client.shell({ term: 'xterm-256color', ...size }, (err, stream) => {
          if (err) return close(err.message);
          channel = stream;
          const out = new StringDecoder('utf8');
          const errOut = new StringDecoder('utf8');
          let code = 0;
          stream.on('data', (d: Buffer) =>
            emit({ type: 'output', tab, data: out.write(d) }),
          );
          stream.stderr.on('data', (d: Buffer) =>
            emit({ type: 'output', tab, data: errOut.write(d) }),
          );
          stream.on('exit', (c: number | null) => (code = c ?? 1));
          stream.on('close', () => {
            close();
            emit({ type: 'exit', tab, code });
          });
        }),
      )
      .on('close', () => close('Connection closed.'))
      .connect({
        host: r.hostname,
        port: r.port,
        username: r.user,
        authHandler: auth,
        // The handshake waits on the host key question for as long as the user reads it.
        // ponytail: no handshake timeout; sshd's LoginGraceTime still drops a stalled login.
        readyTimeout: 0,
        algorithms: savedTypes.length
          ? {
              serverHostKey: {
                remove: savedTypes,
                prepend: savedTypes,
              } as never,
            }
          : undefined,
        hostVerifier: (blob: Buffer, verify: (ok: boolean) => void) => {
          trusted(blob).then(
            (ok) => {
              declined = !ok;
              if (ok) sshTab.hostKey = blob.toString('base64');
              verify(ok);
            },
            (e: Error) => close(e.message),
          );
        },
      });
  }

  connect().catch((e: Error) => close(e.message));
  return sshTab;
}
