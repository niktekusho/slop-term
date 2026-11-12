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
  type SFTPWrapper,
} from 'ssh2';
import type {
  BackendEvent,
  CredentialReference,
  HostKeyQuestion,
  KeepassTarget,
  NewTypedSession,
  SecretChange,
  SecretQuestion,
  TabId,
  TerminalSize,
} from '../shared/ipc.ts';
import { usernameMismatch } from '../shared/session-rules.ts';
import {
  hostExists,
  savedSession,
  saveCredential,
  sshError,
} from './config-store.ts';
import {
  accountName,
  LoginNeeded,
  newKeychainEntry,
  provider,
  providers,
  type ProviderRead,
} from './credentials.ts';
import {
  fingerprint,
  hostEntry,
  knownHostName,
  removeLine,
  savedKeys,
} from './known-hosts.ts';
import { resolve, type Resolved } from './resolver.ts';
import { call, sftpFiles } from './sftp.ts';

export type SshTab = {
  write(data: string): void;
  resize(size: TerminalSize): void;
  answerHostKey(trust: boolean): void;
  answerSecret(
    answers: string[] | null,
    save: boolean | KeepassTarget,
    create?: NewTypedSession,
  ): void;
  /** `finishTransfers` lets running transfers end on the transfer connection, which then closes. */
  close(finishTransfers?: boolean): void;
  keepalive(): void;
  /** The SFTP pane's files, over a channel on this connection that the first call opens. */
  files(): Promise<SftpFiles>;
  /** A new SFTP channel for transfers, which the caller ends. It runs on the transfer connection, or on this one for hosts that asked keyboard-interactive questions. */
  transferChannel(): Promise<SFTPWrapper>;
};

// Tests shorten the 5 minutes the transfer connection stays open with no channels.
const transferIdleMs = Number(process.env.SLOP_TRANSFER_IDLE_MS) || 5 * 60_000;

const openSftp = (client: Client) =>
  call<SFTPWrapper>((done) => client.sftp(done));

type SftpFiles = ReturnType<typeof sftpFiles>;
export const notConnected = () => new Error('The Tab is not connected.');

/** A Test connects with a dialog's unsaved values: `options` are its lines, passed to `ssh -G` as `-o`. */
export type TestPlan = {
  options: string[];
  credential?: CredentialReference;
};

/**
 * A local shell Tab's SFTP pane: no shell, for the host a typed `ssh` reached or a picked Saved session. `resolved` is that `ssh -G`.
 * `session` is the Saved session it matched; `handWritten` a Hand-written host it matched, which can't save a secret.
 * `folder` starts a `create` save; `create` saves the secret first, then a new Managed Saved session that points at it.
 */
export type PanePlan = {
  resolved: Resolved;
  session?: string;
  handWritten?: string;
  folder?: string;
  create(
    answer: NewTypedSession,
    secret: NonNullable<SecretChange['set']>,
  ): Promise<void>;
};

/** What a Tab remembers across its connections. */
export type TabMemory = {
  typed: Typed;
  /** The host key the Tab accepted, in base64. */
  hostKey?: string;
  /** The host asked keyboard-interactive questions, which a transfer connection can't answer. */
  interactive?: boolean;
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
type Reply = {
  answers: string[];
  save: boolean | KeepassTarget;
  create?: NewTypedSession;
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
  memory: TabMemory,
  test?: TestPlan,
  pane?: PanePlan,
): SshTab {
  const { typed } = memory;
  // A Test's checklist. A failure lands on the first step that hasn't passed.
  // `ssh -G` fills in where and as whom once it has resolved.
  let where = '';
  let who = '';
  let passed = 0;
  const report = (reason?: string) =>
    emit({
      type: 'test',
      tab,
      steps: [
        'resolved',
        `reached${where}`,
        'host key',
        `logged in${who}`,
        'SFTP',
      ].map((label, i) =>
        i < passed
          ? { label, state: 'passed' }
          : i === passed && reason
            ? { label, state: 'failed', reason }
            : { label, state: 'waiting' },
      ),
    });
  const pass = () => {
    if (!test) return;
    passed++;
    report();
  };
  const client = new Client();
  let size: TerminalSize = { cols: 80, rows: 24 };
  let channel: ClientChannel | undefined;
  let answer: ((trust: boolean) => void) | undefined;
  let reply: ((reply?: Reply) => void) | undefined;
  let closed = false;
  let files: Promise<SftpFiles> | undefined;
  // Set on login, before the shell opens: the pane may ask as soon as the `connected` event arrives.
  let ready = false;
  // Set on login: opens the transfer connection with what this login knows, asking nothing.
  let transferLogin: (() => Promise<Client>) | undefined;
  let transferClient: Promise<Client> | undefined;
  let channels = 0;
  let idle: NodeJS.Timeout | undefined;
  const endTransfers = () => {
    clearTimeout(idle);
    transferClient?.then(
      (c) => c.end(),
      () => {},
    );
    transferClient = undefined;
  };
  // A closed Tab that let its transfers finish ends its connections after the last one.
  let finishing = false;
  const release = () => {
    if (--channels > 0) return;
    if (finishing) {
      client.end();
      endTransfers();
    } else if (!closed) idle = setTimeout(endTransfers, transferIdleMs);
  };

  // The server's close reply can lag or never come: ending the channel releases it too, once.
  const counted = (sftp: SFTPWrapper) => {
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      release();
    };
    sftp.on('close', done);
    const end = sftp.end.bind(sftp);
    sftp.end = () => {
      end();
      done();
    };
    return sftp;
  };

  const print = (text: string) =>
    emit({ type: 'output', tab, data: `\r\n${text}\r\n` });
  // No reason means the user closed the Tab or its shell exited.
  const close = (
    reason?: string,
    extra: { final?: true; user?: string } = {},
    finishTransfers = false,
  ) => {
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
    // A keyboard-interactive host's transfers run on this connection, so it waits for them too.
    finishing = finishTransfers && channels > 0;
    if (!finishing) {
      client.end();
      endTransfers();
    }
    onClose();
    if (reason && test) report(reason);
    else if (reason) emit({ type: 'dropped', tab, reason, ...extra });
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
    answerSecret(answers, save, create) {
      reply?.(answers ? { answers, save, create } : undefined);
      reply = undefined;
    },
    close: (finishTransfers) => close(undefined, {}, finishTransfers),
    keepalive() {
      if (!channel || closed) return;
      const internals = client as unknown as Internals;
      internals._callbacks.push(() => {});
      internals._protocol.ping();
    },
    files() {
      if (!ready || closed) return Promise.reject(notConnected());
      // A failed open isn't kept, so the next call tries again.
      files ??= openSftp(client)
        .then(sftpFiles)
        .catch((e) => {
          files = undefined;
          throw e;
        });
      return files;
    },
    async transferChannel() {
      if (!ready || closed) throw notConnected();
      // Counted before the first await, so a channel closing meanwhile can't start the idle timer.
      channels++;
      clearTimeout(idle);
      try {
        if (memory.interactive) return counted(await openSftp(client));
        if (!transferClient) {
          const opening = transferLogin!();
          transferClient = opening;
          // A connection that ends or never opens isn't kept, so the next transfer opens a new one.
          const forget = () => {
            if (transferClient === opening) transferClient = undefined;
          };
          opening.then((c) => c.on('close', forget), forget);
        }
        return counted(await openSftp(await transferClient));
      } catch (e) {
        release();
        throw e;
      }
    },
  };

  async function connect() {
    // Closing before the first await would call onClose before openSshTab returns the Tab.
    const r = await (pane
      ? Promise.resolve(pane.resolved)
      : resolve(alias, undefined, test?.options).catch((e) => {
          throw test ? new Error(sshError(e)) : e;
        }));
    if (!test && !pane && !hostExists(alias))
      return close('This Saved session no longer exists.', { final: true });
    if (r.jumpHost) return close(jumpHostMessage, { final: true });
    if (test) {
      where = ` ${r.hostname}:${r.port}`;
      who = ` as ${r.user}`;
      pass();
    } else if (!pane)
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

    // Undefined for a Hand-written host and for a Test: neither offers a save. A pane has the Saved session it matched.
    const sessionAlias = pane ? pane.session : test ? undefined : alias;
    const session = sessionAlias ? savedSession(sessionAlias) : undefined;
    const ref = test ? test.credential : session?.credential;
    const username = r.user;
    const title = pane
      ? `Log in to ${r.user}@${r.hostname}`
      : `Password for ${r.user}@${r.hostname}`;
    const offers: Partial<Record<Kind, SecretQuestion['save']>> = {};
    const fromProvider: Partial<Record<Kind, boolean>> = {};
    const account = accountName(r);
    /** `to` is the KeePass group the user picked for a new entry; none means the keychain. */
    type Save = {
      kind: Kind;
      secret: string;
      name: string;
      to?: KeepassTarget;
      create?: NewTypedSession;
    };
    let toSave: Save | undefined;

    type Read = ProviderRead | { reason: string };
    /**
     * Logs in to the provider first when it asks, as TPM does for its API keys and KeePass for a master password.
     * Undefined means the user cancelled that login and the provider has no read to fall back on.
     */
    async function readRef(
      own: CredentialReference,
    ): Promise<Read | undefined> {
      let refused: string | undefined;
      for (;;) {
        try {
          return await provider(own).read(own);
        } catch (e) {
          if (!(e instanceof LoginNeeded))
            return { reason: (e as Error).message };
          const got = await askSecret({
            alias,
            title: e.title,
            prompts: e.prompts,
            reason: refused ?? e.message,
          });
          if (!got) return e.cancelled ? { reason: e.cancelled } : undefined;
          refused = (await e.login(got.answers)) || undefined;
        }
      }
    }
    // The reference is read before the first login method, so the username check runs before any secret goes out.
    // The first `secret()` of the reference's kind takes this read instead of reading again.
    let firstRead: Read | undefined;

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
        if (fromProvider[kind] && ref?.provider === 'tpm')
          reason = `TPM's ${kind} was rejected. Update the entry in TPM, then reconnect.`;
        else if (fromProvider[kind]) {
          reason = `The saved ${kind} was rejected.`;
          if (session) offers[kind] = 'update';
        } else
          reason =
            kind === 'password'
              ? 'Permission denied, please try again.'
              : "That passphrase doesn't unlock the key.";
      } else if (typed[kind]) return typed[kind];
      else if (own) {
        const read = firstRead ?? (await readRef(own));
        firstRead = undefined;
        if (!read) return undefined;
        if ('secret' in read) {
          fromProvider[kind] = true;
          return read.secret;
        }
        reason = read.reason;
        if (session) offers[kind] = 'same';
      } else if (!ref && (!pane || kind === 'password')) {
        // A pane saves only passwords. A Hand-written host has to move in first.
        if (session) offers[kind] = 'new';
        else if (pane && !pane.handWritten) offers[kind] = 'create';
      }
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
        ...(offers[kind] === 'new' &&
          session?.folder && { folder: session.folder }),
        ...(offers[kind] === 'create' &&
          pane?.folder && { folder: pane.folder }),
        ...(kind === 'password' &&
          pane?.handWritten && { moveIn: pane.handWritten }),
      });
      if (!got) return undefined;
      const answer = got.answers[0] ?? '';
      typed[kind] = answer;
      const fresh = offers[kind] === 'new' || offers[kind] === 'create';
      toSave =
        got.save && offers[kind] && (offers[kind] !== 'create' || got.create)
          ? {
              kind,
              secret: answer,
              name,
              ...(typeof got.save === 'object' && fresh && { to: got.save }),
              ...(offers[kind] === 'create' && { create: got.create }),
            }
          : undefined;
      return answer;
    }

    // The secret goes first: a refusal writes nothing else, and a Sidecar conflict keeps the saved secret.
    async function saveSecret({ kind, secret, name, to, create }: Save) {
      try {
        let target: CredentialReference;
        if (create)
          return await pane!.create(create, {
            kind,
            secret,
            ...(to && { keepass: to }),
          });
        if (ref?.kind === kind) {
          target = ref;
          await provider(target).write(target, secret);
        } else if (to) {
          target = await providers.keepass.create!(
            to,
            { title: sessionAlias!, username, url: `ssh://${r.hostname}` },
            kind,
            secret,
          );
        } else {
          target = {
            provider: 'keychain',
            entry: await newKeychainEntry(name),
            kind,
          };
          await provider(target).write(target, secret);
        }
        if (target !== ref)
          saveCredential(sessionAlias!, target, session!.read);
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

    // Copies: the Tab's own login takes methods off `plain` and `lockedKeys`.
    const quietPlain = [...plain];
    const quietLocked = [...lockedKeys];
    /** Typed, else read from the reference. Never asks: a provider that needs its own login fails the read. */
    const known = async (kind: Kind) =>
      typed[kind] ??
      (ref?.kind === kind ? (await provider(ref).read(ref)).secret : undefined);
    transferLogin = () =>
      new Promise<Client>((resolve, reject) => {
        const steps: (() => Promise<AnyAuthMethod | undefined>)[] = [
          ...quietPlain.map((method) => async () => method),
          ...quietLocked.map(({ key }) => async () => {
            const passphrase = await known('passphrase');
            return passphrase === undefined
              ? undefined
              : { type: 'publickey' as const, username, key, passphrase };
          }),
          async () => {
            const password = await known('password');
            return password === undefined
              ? undefined
              : { type: 'password' as const, username, password };
          },
        ];
        const accepted = Buffer.from(memory.hostKey!, 'base64');
        let failure: Error | undefined;
        const conn = new Client();
        conn
          .on('ready', () => {
            // With Nagle on, Linux holds the last small packet of each SFTP request for a delayed ACK: 40 ms or more per request.
            conn.setNoDelay(true);
            resolve(conn);
          })
          .on('error', (e: Error & { level?: string }) => {
            if (e.level === 'agent') return;
            // The host key list holds only the accepted key's type, so a host without that type fails the handshake.
            if (/no matching host key/.test(e.message))
              failure ??= new Error(
                `The host no longer offers the ${keyType(accepted)} key the Tab accepted.`,
              );
            reject(failure ?? e);
          })
          .on('close', () => reject(failure ?? new Error('Connection closed.')))
          .connect({
            host: r.hostname,
            port: r.port,
            username,
            keepaliveInterval: r.keepaliveSeconds * 1000,
            keepaliveCountMax: r.keepaliveCount,
            algorithms: {
              serverHostKey: algorithms[keyType(accepted)] as never,
            },
            // Only the key the Tab accepted: the Tab answered the question once, and a transfer never asks.
            hostVerifier: (blob: Buffer) => {
              if (blob.equals(accepted)) return true;
              failure = new Error(
                'The host sent a different key than the Tab accepted.',
              );
              emit({
                type: 'transferKey',
                tab,
                change: {
                  host: `${r.hostname}:${r.port}`,
                  keyType: keyType(blob),
                  accepted: fingerprint(memory.hostKey!),
                  fingerprint: fingerprint(blob.toString('base64')),
                },
              });
              return false;
            },
            authHandler: (left, _partial, next) => {
              const allowed = (m: AnyAuthMethod) =>
                !left ||
                left.includes(m.type === 'agent' ? 'publickey' : m.type);
              (async () => {
                for (let step; (step = steps.shift()); ) {
                  const method = await step();
                  if (method && allowed(method)) return method;
                }
                return false as const;
              })().then(
                (method) => next(method as AnyAuthMethod),
                (e: Error) => {
                  failure = e;
                  next(false as never);
                },
              );
            },
          });
      });

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
        if (prompts.length) memory.interactive = true;
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

    let refRead = false;
    async function nextAuth(left: string[] | null, partial: boolean) {
      if (ref && !refRead) {
        refRead = true;
        const read = await readRef(ref);
        if (!read) return cancelled();
        const named = 'username' in read ? read.username : undefined;
        if (named && named !== username) {
          close(usernameMismatch(ref.provider, named, username), {
            user: named,
          });
          return false as const;
        }
        firstRead = read;
      }
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
      .on('connect', pass)
      .on('ready', () => {
        // With Nagle on, Linux holds each SFTP request on this connection for a delayed ACK, as on the transfer connection.
        client.setNoDelay(true);
        if (test) {
          pass();
          return client.sftp((err) => {
            if (err) return close(err.message);
            pass();
            close();
          });
        }
        ready = true;
        // Comes first, so the UI's reconnect divider sits above the save messages.
        emit({ type: 'connected', tab });
        // A second keyboard-interactive round means the first prompt wasn't the whole login.
        if (toSave && rounds <= 1) void saveSecret(toSave);
        else if (toSave)
          print('Not saved: this host asks more than one question to log in.');
        if (pane) return;
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
              if (ok) {
                memory.hostKey = blob.toString('base64');
                pass();
              }
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
