import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
// Node's ESM loader finds `Client` in ssh2's CommonJS exports, not `utils`.
import ssh2, {
  Client,
  type AnyAuthMethod,
  type ClientChannel,
  type Prompt,
} from 'ssh2';
import type {
  BackendEvent,
  CredentialReference,
  HostKeyQuestion,
  SecretQuestion,
  TabId,
  TerminalSize,
} from '../shared/ipc.ts';
import { hostExists, savedSession, saveCredential } from './config-store.ts';
import { accountName, newKeychainEntry, provider } from './credentials.ts';
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
  answerSecret(answers: string[] | null, save: boolean): void;
  close(): void;
  keepalive(): void;
};

/** What a Tab remembers across its connections. */
export type TabMemory = {
  typed: Typed;
  /** The host key the Tab accepted, in base64. */
  hostKey?: string;
};

// ssh2 has no public way to send one keepalive now. This is the request its own keepalive timer sends.
// The server's reply takes the next callback from the same queue.
// ponytail: private ssh2 fields, pinned at 1.17.0; check them on an ssh2 upgrade.
type Internals = { _callbacks: (() => void)[]; _protocol: { ping(): void } };

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

type Kind = CredentialReference['kind'];
/** Secrets the user typed, kept in memory for the Tab's lifetime. Provider secrets are never kept. */
export type Typed = Partial<Record<Kind, string>>;
type Reply = { answers: string[]; save: boolean };

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
  memory: TabMemory,
): SshTab {
  const { typed } = memory;
  const client = new Client();
  let size: TerminalSize = { cols: 80, rows: 24 };
  let channel: ClientChannel | undefined;
  let answer: ((trust: boolean) => void) | undefined;
  let reply: ((reply?: Reply) => void) | undefined;
  let closed = false;

  const print = (text: string) =>
    emit({ type: 'output', tab, data: `\r\n${text}\r\n` });
  // No reason means the user closed the Tab or its shell exited.
  const close = (reason?: string, final?: true) => {
    if (closed) return;
    closed = true;
    if (answer) {
      answer(false);
      answer = undefined;
      emit({ type: 'hostKey', tab });
    }
    if (reply) {
      reply();
      reply = undefined;
      emit({ type: 'secret', tab });
    }
    client.end();
    onClose();
    if (reason) emit({ type: 'dropped', tab, reason, ...(final && { final }) });
  };
  const ask = (question: HostKeyQuestion) =>
    new Promise<boolean>((resolve) => {
      answer = resolve;
      emit({ type: 'hostKey', tab, question });
    });

  const askSecret = (question: SecretQuestion) =>
    new Promise<Reply | undefined>((resolve) => {
      reply = resolve;
      emit({ type: 'secret', tab, question });
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
    answerSecret(answers, save) {
      reply?.(answers ? { answers, save } : undefined);
      reply = undefined;
    },
    close: () => close(),
    keepalive() {
      if (!channel || closed) return;
      const internals = client as unknown as Internals;
      internals._callbacks.push(() => {});
      internals._protocol.ping();
    },
  };

  async function connect() {
    // Closing before the first await would call onClose before openSshTab returns the Tab.
    const r = await resolve(alias);
    if (!hostExists(alias))
      return close('This Saved session no longer exists.', true);
    if (r.jumpHost) return close(jumpHostMessage, true);
    emit({ type: 'tab', tab, address: `${r.user}@${r.hostname}` });

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
      if (key === memory.hostKey || sameType.some((k) => k.key === key))
        return true;
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

    // Undefined for a Hand-written host: it carries no reference and offers no save.
    const session = savedSession(alias);
    const ref = session?.credential;
    const username = r.user;
    const title = `Password for ${r.user}@${r.hostname}`;
    const offers: Partial<Record<Kind, SecretQuestion['save']>> = {};
    const fromProvider: Partial<Record<Kind, boolean>> = {};
    const account = accountName(r);
    type Save = { kind: Kind; secret: string; name: string };
    let toSave: Save | undefined;

    /** Typed, then read from the reference, then asked. `retry` means the last one was rejected. */
    async function secret(
      kind: Kind,
      heading: string,
      name: string,
      retry = false,
    ) {
      const own = ref?.kind === kind ? ref : undefined;
      let reason: string | undefined;
      if (retry) {
        delete typed[kind];
        if (fromProvider[kind]) {
          reason = `The saved ${kind} was rejected.`;
          offers[kind] = 'update';
        } else
          reason =
            kind === 'password'
              ? 'Permission denied, please try again.'
              : "That passphrase doesn't unlock the key.";
      } else if (typed[kind]) return typed[kind];
      else if (own)
        try {
          const read = await provider(own).read(own);
          fromProvider[kind] = true;
          return read;
        } catch (e) {
          reason = (e as Error).message;
          offers[kind] = 'same';
        }
      else if (session && !ref) offers[kind] = 'new';
      fromProvider[kind] = false;
      const got = await askSecret({
        alias,
        title: heading,
        prompts: [
          {
            prompt: kind === 'password' ? 'Password' : 'Passphrase',
            echo: false,
          },
        ],
        ...(reason && { reason }),
        ...(offers[kind] && { save: offers[kind] }),
      });
      if (!got) return undefined;
      const answer = got.answers[0] ?? '';
      typed[kind] = answer;
      toSave =
        got.save && offers[kind] ? { kind, secret: answer, name } : undefined;
      return answer;
    }

    // The secret goes first: a refusal writes nothing else, and a Sidecar conflict keeps the saved secret.
    async function saveSecret({ kind, secret, name }: Save) {
      try {
        const target: CredentialReference =
          ref?.kind === kind
            ? ref
            : {
                provider: 'keychain',
                entry: await newKeychainEntry(name),
                kind,
              };
        await provider(target).write(target, secret);
        if (target !== ref) saveCredential(alias, target, session!.read);
      } catch (e) {
        print(`Not saved: ${(e as Error).message}`);
      }
    }

    const cancelled = () => {
      close('Not connected: login cancelled.');
      return false as const;
    };

    const agent = agentPath();
    const keyFiles = r.identityFiles.flatMap((file) => {
      const key = readText(file);
      return key ? [{ file, key }] : [];
    });
    // ssh2 has no "is encrypted" check: parsing without a passphrase fails with a message that names it.
    const locked = ({ key }: { key: string }) => {
      const parsed = ssh2.utils.parseKey(key);
      return parsed instanceof Error && /passphrase/i.test(parsed.message);
    };
    const plain: AnyAuthMethod[] = [
      ...(agent ? [{ type: 'agent' as const, username, agent }] : []),
      ...keyFiles
        .filter((k) => !locked(k))
        .map(({ key }) => ({ type: 'publickey' as const, username, key })),
    ];
    const lockedKeys = keyFiles.filter(locked);

    // A wrong passphrase fails here, before the server sees the key.
    async function unlock({ file, key }: { file: string; key: string }) {
      for (let retry = false; ; retry = true) {
        const passphrase = await secret(
          'passphrase',
          `Passphrase for ${file}`,
          `passphrase-${path.basename(file)}`,
          retry,
        );
        if (passphrase === undefined) return cancelled();
        if (!(ssh2.utils.parseKey(key, passphrase) instanceof Error))
          return { type: 'publickey' as const, username, key, passphrase };
      }
    }

    // ponytail: keyboard-interactive prompts are asked on every connect, never saved. Only a single hidden prompt in one round counts as the password.
    let rounds = 0;
    // The method that last sent a password. Only a rejection by that same method makes the next ask a retry.
    let passwordSentBy: 'password' | 'keyboard-interactive' | undefined;
    const interactive = (retry: boolean): AnyAuthMethod => ({
      type: 'keyboard-interactive',
      username,
      prompt(name, instructions, _lang, prompts: Prompt[], finish) {
        rounds++;
        const answered = (answers: string[] | undefined) =>
          answers ? finish(answers) : cancelled();
        const failed = (e: Error) => close(e.message);
        if (rounds === 1 && prompts.length === 1 && !prompts[0].echo) {
          passwordSentBy = 'keyboard-interactive';
          secret('password', title, account, retry).then(
            (p) => answered(p === undefined ? undefined : [p]),
            failed,
          );
          return;
        }
        askSecret({
          alias,
          title: instructions || name || title,
          prompts: prompts.map((p) => ({ prompt: p.prompt, echo: !!p.echo })),
        }).then((got) => answered(got?.answers), failed);
      },
    });

    async function nextAuth(left: string[] | null, partial: boolean) {
      const allows = (method: string) => !left || left.includes(method);
      const retry =
        !!passwordSentBy && !partial && !!left?.includes(passwordSentBy);
      passwordSentBy = undefined;
      const next = retry ? undefined : plain.shift();
      if (next) return next;
      const lockedKey = !retry && allows('publickey') && lockedKeys.shift();
      if (lockedKey) return unlock(lockedKey);
      rounds = 0;
      if (allows('password')) {
        const password = await secret('password', title, account, retry);
        if (password === undefined) return cancelled();
        passwordSentBy = 'password';
        return { type: 'password' as const, username, password };
      }
      if (allows('keyboard-interactive')) return interactive(retry);
      return false as const;
    }

    let declined = false;
    client
      .on('error', (e: Error & { level?: string }) => {
        // A missing agent is not fatal: `ssh2` goes on to the key files.
        if (e.level === 'agent') return;
        close(
          declined ? 'Not connected: the host key was not trusted.' : e.message,
        );
      })
      .on('ready', () => {
        // Comes first, so the UI's reconnect divider sits above the save messages.
        emit({ type: 'connected', tab });
        // A second keyboard-interactive round means the first prompt wasn't the whole login.
        if (toSave && rounds <= 1) void saveSecret(toSave);
        else if (toSave)
          print('Not saved: this host asks more than one question to log in.');
        client.shell({ term: 'xterm-256color', ...size }, (err, stream) => {
          if (err) return close(err.message);
          channel = stream;
          const out = new StringDecoder('utf8');
          const errOut = new StringDecoder('utf8');
          let code: number | undefined;
          stream.on('data', (d: Buffer) =>
            emit({ type: 'output', tab, data: out.write(d) }),
          );
          stream.stderr.on('data', (d: Buffer) =>
            emit({ type: 'output', tab, data: errOut.write(d) }),
          );
          stream.on('exit', (c: number | null) => (code = c ?? 1));
          // A dropped connection closes the client before its channels: that close is no exit.
          // A channel that closes with no exit status, as when sshd shuts down, is a drop too.
          stream.on('close', () => {
            if (closed) return;
            if (code === undefined) return close('Connection closed.');
            close();
            emit({ type: 'exit', tab, code });
          });
        });
      })
      .on('close', () => close('Connection closed.'))
      .connect({
        host: r.hostname,
        port: r.port,
        username: r.user,
        authHandler: (left, partial, next) => {
          nextAuth(left, partial).then(
            (method) => next(method as AnyAuthMethod),
            (e: Error) => close(e.message),
          );
        },
        // The handshake waits on the host key question for as long as the user reads it.
        // ponytail: no handshake timeout; sshd's LoginGraceTime still drops a stalled login.
        readyTimeout: 0,
        keepaliveInterval: r.keepaliveSeconds * 1000,
        keepaliveCountMax: r.keepaliveCount,
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
              if (ok) memory.hostKey = blob.toString('base64');
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
