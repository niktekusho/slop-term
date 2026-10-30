export const shellKinds = [
  'pwsh',
  'powershell',
  'cmd',
  'wsl',
  'zsh',
  'bash',
] as const;
export type ShellKind = (typeof shellKinds)[number];
/** A shell this machine has. */
export type Shell =
  | { kind: Exclude<ShellKind, 'wsl'> }
  | { kind: 'wsl'; distro: string };
export type TabId = string;
export type TerminalSize = { cols: number; rows: number };

/** The per-machine `settings.json`. A missing file or key means its default. */
export type Settings = {
  theme: 'system' | 'light' | 'dark';
  /** A system font; unset means the bundled JetBrains Mono. */
  fontFamily?: string;
  fontSize: number;
  scrollback: number;
  editor?: string;
};

/** Flat lists in file order: the UI builds the folders and sorts. */
export type SessionTree = {
  /** Folder paths from the Sidecar file, segments joined by `/`. */
  folders: string[];
  /** Managed hosts. One without a Sidecar folder sits at the tree root. */
  sessions: {
    alias: string;
    folder?: string;
    credential?: CredentialReference;
    /** The line of `~/.ssh/config` that also defines this alias. */
    alsoInConfig?: number;
  }[];
  handWritten: string[];
  localShells: LocalShellForm[];
  warnings: string[];
};

export const emptyTree: SessionTree = {
  folders: [],
  sessions: [],
  handWritten: [],
  localShells: [],
  warnings: [],
};

export const defaultSettings: Settings = {
  theme: 'system',
  fontSize: 12,
  scrollback: 1000,
};

/** A host key the user must decide on before an SSH Tab connects. `host` is `hostname:port`. */
export type HostKeyQuestion = {
  alias: string;
  host: string;
  type: string;
  fingerprint: string;
} & (
  | { kind: 'unknown'; savedType?: string }
  | {
      kind: 'changed';
      old: { fingerprint: string; file: string; line: number };
    }
);

/** Where a Saved session's secret lives. `entry` is the provider's id for it, never the alias. */
export type CredentialReference = {
  provider: string;
  entry: string;
  kind: 'password' | 'passphrase';
};

/** An SSH Saved session as the dialog edits it. An empty string means unset; `folder` '' is the top level. */
export type SessionForm = {
  alias: string;
  folder: string;
  hostname: string;
  port: string;
  user: string;
  identityFile: string;
  /** Every other line of the host block, as `Key value`. */
  options: string[];
  credential?: CredentialReference;
};

/** `read` is the session as read now, which a save or delete checks for conflicts. */
export type SavedSession = SessionForm & { read: string };

/** A Local shell session. An empty string means unset: the WSL default distro, the home folder, no command, the top level. */
export type LocalShellForm = {
  name: string;
  folder: string;
  kind: ShellKind;
  distro: string;
  startFolder: string;
  command: string;
};

export type SavedLocalShell = LocalShellForm & { read: string };

/** `set` saves a new secret to the keychain and points the session at it. `drop` deletes an entry the form removed, unless another session uses it. */
export type SecretChange = {
  set?: { kind: CredentialReference['kind']; secret: string };
  drop?: CredentialReference;
};

/** What `ssh -G` uses for each empty part of the command line. */
export type SessionDefaults = {
  hostname: string;
  port: string;
  user: string;
  identityFile: string;
};

/** One line of a Test's checklist. */
export type TestStep = {
  label: string;
  state: 'passed' | 'failed' | 'waiting';
  reason?: string;
};

/** A login question shown inside the Tab. A prompt with `echo` false hides what the user types. */
export type SecretQuestion = {
  alias: string;
  title: string;
  prompts: { prompt: string; echo: boolean }[];
  /** Why the app asks although the session has a Credential reference. */
  reason?: string;
  /** `new` offers "Save to: keychain / don't save"; `same` saves under the session's reference; `update` replaces its saved secret. */
  save?: 'new' | 'same' | 'update';
};

export interface Backend {
  listShells(): Promise<Shell[]>;
  openLocalShell(shell: Shell): Promise<TabId>;
  /** Rejects a Local shell session whose shell or distro this machine lacks. */
  openShellSession(name: string): Promise<TabId>;
  /** Resolves once the Tab exists; connecting, the host key question and login follow as events. */
  openSsh(alias: string): Promise<TabId>;
  /** `true` trusts an unknown key, or replaces a changed one. */
  answerHostKey(tab: TabId, trust: boolean): Promise<void>;
  /** One answer per prompt; `null` cancels the login. `save` follows the question's save offer. */
  answerSecret(
    tab: TabId,
    answers: string[] | null,
    save: boolean,
  ): Promise<void>;
  /** Ends the Tab's shell or connection. */
  close(tab: TabId): Promise<void>;
  /** Opens an exited Tab again from where it came from, under the same id. */
  restart(tab: TabId): Promise<void>;
  write(tab: TabId, data: string): Promise<void>;
  resize(tab: TabId, size: TerminalSize): Promise<void>;
  /** Sends a keepalive on every SSH Tab, so a connection that died while the computer slept shows as dropped. */
  wake(): Promise<void>;
  settings(): Promise<Settings>;
  /** Writes the keys into `settings.json`, keeping the others. */
  updateSettings(patch: Partial<Settings>): Promise<void>;
  openSettings(): Promise<void>;
  getTree(): Promise<SessionTree>;
  getSession(alias: string): Promise<SavedSession>;
  /**
   * Creates the session, or replaces `edit.alias` after checking it is unchanged since `edit.read`.
   * Writes the secret first, then each file once, and resolves to the new tree.
   */
  saveSession(
    form: SessionForm,
    edit?: { alias: string; read: string },
    secret?: SecretChange,
  ): Promise<SessionTree>;
  /** `deleteSecret` deletes the session's saved secret unless another session uses it. */
  deleteSession(
    alias: string,
    read: string,
    deleteSecret: boolean,
  ): Promise<SessionTree>;
  sessionDefaults(alias: string, options: string[]): Promise<SessionDefaults>;
  /**
   * Connects with the form's unsaved values, opens SFTP and disconnects. `secret` is a secret set in the form but not saved yet.
   * Its checklist comes as `test` events. Its questions come as a Tab's do, under the returned id; `close` stops it.
   */
  testSession(form: SessionForm, secret?: SecretChange['set']): Promise<TabId>;
  getLocalShell(name: string): Promise<SavedLocalShell>;
  /** Creates the session, or replaces `edit.name` after checking it is unchanged since `edit.read`. */
  saveLocalShell(
    form: LocalShellForm,
    edit?: { name: string; read: string },
  ): Promise<SessionTree>;
  deleteLocalShell(name: string, read: string): Promise<SessionTree>;
  /** Folder paths join their names with `/`; '' is the top level. */
  createFolder(parent: string, name: string): Promise<SessionTree>;
  renameFolder(folder: string, name: string): Promise<SessionTree>;
  /** Moves a Saved session (an SSH alias or a Local shell session name) or a folder, with everything in it, into `to`. */
  move(
    item: { alias: string } | { folder: string },
    to: string,
  ): Promise<SessionTree>;
  /**
   * Deletes the folder, its subfolders and their Saved sessions, writing each file once.
   * `aliases` are the sessions the user agreed to delete, SSH and local shell: any other set is a conflict.
   * `deleteSecrets` deletes their saved secrets that no session outside the folder uses.
   */
  deleteFolder(
    folder: string,
    aliases: string[],
    deleteSecrets: boolean,
  ): Promise<SessionTree>;
  /** Copies a Hand-written host's block from `~/.ssh/config` into the Managed config. */
  moveIn(alias: string): Promise<SessionTree>;
  /** Comments out a Managed host's copy in `~/.ssh/config` under a `# moved to slop-term.conf` marker. */
  commentOut(alias: string): Promise<SessionTree>;
}

// Served by the main process: native dialogs exist only there.
export interface Dialogs {
  /** Resolves to the picked file, as `~/…` when it is in the home folder. */
  pickKeyFile(): Promise<string | undefined>;
}

// Served by the main process, not the back end: these Electron APIs exist only there.
export interface Profiler {
  metrics(): Promise<ProcessMetrics[]>;
  startTrace(): Promise<void>;
  /** Resolves to the saved file, or undefined when the user cancels the file picker. */
  stopTrace(): Promise<string | undefined>;
}

export type ProcessMetrics = {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryKB: number;
};

/** `folder` is the decoded path from OSC 7; `title` comes from OSC 0 or 2; `address` is an SSH Tab's `user@host`. */
export type TabUpdate =
  | { folder: string }
  | { title: string }
  | { address: string };

export type BackendEvent =
  | { type: 'output'; tab: TabId; data: string }
  | ({ type: 'tab'; tab: TabId } & TabUpdate)
  | { type: 'exit'; tab: TabId; code: number }
  /** An SSH Tab logged in. */
  | { type: 'connected'; tab: TabId }
  /** An SSH Tab's connection ended without its shell exiting. `final` means a reconnect can't help: the Tab can only close. */
  | { type: 'dropped'; tab: TabId; reason: string; final?: true }
  /** For both questions, none means the connection closed and the open question is void. */
  | { type: 'hostKey'; tab: TabId; question?: HostKeyQuestion }
  | { type: 'secret'; tab: TabId; question?: SecretQuestion }
  /** Steps pass in order. The first failure carries its reason and ends the Test. */
  | { type: 'test'; tab: TabId; steps: TestStep[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'tree'; tree: SessionTree };

type Events = {
  onEvent(listener: (event: BackendEvent) => void): () => void;
};

// Served by the preload and the main process: they change the Electron window itself.
export interface WindowControls {
  setZoom(factor: number): void;
  /** Makes the native title bar follow a forced theme. */
  setTheme(theme: Settings['theme']): void;
}

export type BackendClient = Backend &
  Profiler &
  Dialogs &
  WindowControls &
  Events;

export type Request = {
  [M in keyof Backend]: {
    id: number;
    method: M;
    args: Parameters<Backend[M]>;
  };
}[keyof Backend];

export type Message =
  | { id: number; result: unknown }
  | { id: number; error: string }
  | { event: BackendEvent };

// The type forces this list to name every Backend method exactly once.
const methods: { [M in keyof Backend]: true } = {
  listShells: true,
  openLocalShell: true,
  openShellSession: true,
  openSsh: true,
  answerHostKey: true,
  answerSecret: true,
  close: true,
  restart: true,
  write: true,
  resize: true,
  wake: true,
  settings: true,
  updateSettings: true,
  openSettings: true,
  getTree: true,
  getSession: true,
  saveSession: true,
  deleteSession: true,
  sessionDefaults: true,
  testSession: true,
  getLocalShell: true,
  saveLocalShell: true,
  deleteLocalShell: true,
  createFolder: true,
  renameFolder: true,
  move: true,
  deleteFolder: true,
  moveIn: true,
  commentOut: true,
};

export function serve(backend: Backend, send: (message: Message) => void) {
  return async ({ id, method, args }: Request) => {
    try {
      const call = backend[method] as (...a: unknown[]) => Promise<unknown>;
      send({ id, result: await call.apply(backend, args) });
    } catch (e) {
      send({ id, error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export function createClient(
  send: (request: Request) => void,
  onMessage: (listener: (message: Message) => void) => void,
): Backend & Events {
  const pending = new Map<
    number,
    { resolve(v: unknown): void; reject(e: Error): void }
  >();
  const listeners = new Set<(event: BackendEvent) => void>();
  let nextId = 1;

  onMessage((message) => {
    if ('event' in message) {
      for (const listener of listeners) listener(message.event);
      return;
    }
    const call = pending.get(message.id);
    pending.delete(message.id);
    if ('error' in message) call?.reject(new Error(message.error));
    else call?.resolve(message.result);
  });

  const client = {
    onEvent(listener: (event: BackendEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as Backend & Events;
  for (const method of Object.keys(methods) as (keyof Backend)[]) {
    client[method] = ((...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        send({ id, method, args } as Request);
      })) as never;
  }
  return client;
}
