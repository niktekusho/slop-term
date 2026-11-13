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
export const sessionColours = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'grey',
] as const;
export type SessionColour = (typeof sessionColours)[number];
export const isSessionColour = (value: unknown): value is SessionColour =>
  sessionColours.includes(value as SessionColour);
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
  /** Off, each save of an editor-sync file asks before it uploads. */
  uploadOnSave: boolean;
  /** How far a coloured Tab's backgrounds mix toward its Session colour, in percent. 0 turns the tint off. */
  sessionColourTint: number;
  /** The TPM address up to and including `index.php`, as `https://tpm.example.com/index.php`. Unset means TPM isn't set up on this machine. */
  tpmUrl?: string;
  /** The KeePass databases this machine has. */
  keepassDatabases: KeepassDatabaseSetting[];
  /** The group the last new KeePass entry went to, which the next "Save to" preselects. */
  keepassLastGroup?: KeepassTarget;
  /** Where Download saves; unset means the Downloads folder. */
  downloadFolder?: string;
  /** The folder the last Saved session created from a typed `ssh` went to, which the next one starts on. */
  typedSshFolder?: string;
};

/** `name` defaults to the file name without its extension. */
export type KeepassDatabaseSetting = { name: string; path: string };

/** A group of a KeePass database. `group` joins its names with `/` below the root group; '' is the root group. */
export type KeepassTarget = { database: string; group: string };

/** Flat lists in file order: the UI builds the folders and sorts. */
export type SessionTree = {
  /** Folder paths from the Sidecar file, segments joined by `/`. */
  folders: string[];
  /** Managed hosts. One without a Sidecar folder sits at the tree root. */
  sessions: {
    alias: string;
    folder?: string;
    credential?: CredentialReference;
    colour?: SessionColour;
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
  uploadOnSave: true,
  sessionColourTint: 10,
  keepassDatabases: [],
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
  colour?: SessionColour;
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
  colour?: SessionColour;
};

export type SavedLocalShell = LocalShellForm & { read: string };

/** `set` saves a new secret to the keychain, or to a new entry in the `keepass` group, and points the session at it. `drop` deletes an entry the form removed, unless another session uses it. */
export type SecretChange = {
  set?: {
    kind: CredentialReference['kind'];
    secret: string;
    keepass?: KeepassTarget;
  };
  drop?: CredentialReference;
};

/** What `ssh -G` uses for each empty part of the command line. */
export type SessionDefaults = {
  hostname: string;
  port: string;
  user: string;
  identityFile: string;
};

/**
 * One MobaXterm session as the import preview shows it. `name` is MobaXterm's; `alias` is what it imports as. `skipped` is a type the import can't bring over.
 * `ticked` is the row's starting state. `problems` lists what doesn't come across and why the row may start unticked.
 */
export type ImportRow = {
  name: string;
  kind: 'ssh' | 'wsl' | 'skipped';
  alias: string;
  folder: string;
  hostname: string;
  port: string;
  user: string;
  identityFile: string;
  comment: string;
  colour?: SessionColour;
  ticked: boolean;
  problems: string[];
};

/** A TPM password entry as a search lists it, without its secret. `id` is the Credential reference's `entry`. */
export type TpmEntry = { id: string; name: string; username: string };

/** A KeePass entry as a search lists it, without its secret. `id` is the Credential reference's `entry`: `<database>/<uuid>`. `name` is its title. */
export type KeepassEntry = TpmEntry & { group: string; database: string };

/** `locked` names the databases this machine has that a search couldn't open. */
export type KeepassFind = { entries: KeepassEntry[]; locked: string[] };

/** A database this machine has. A locked one lists no groups. */
export type KeepassDatabase = {
  name: string;
  locked: boolean;
  groups: string[];
};

/** `keys` is why TPM needs the user's HMAC API keys before it can answer. */
export type TpmFind = { entries: TpmEntry[] } | { keys: string };

/** A remote file as the SFTP pane lists it. `modified` is in ms since 1970; `permissions` reads like `ls -l`, as `drwxr-xr-x`. A link to a folder is a folder. */
export type RemoteFile = {
  name: string;
  folder: boolean;
  size: number;
  modified: number;
  permissions: string;
};

/** What a path takes with it: a folder counts everything inside. */
export type FileCounts = { files: number; bytes: number };

/** `path` is absolute and resolved. */
export type Listing = { path: string; files: RemoteFile[] };

/**
 * One item of a Tab's transfer queue: a file, or a folder with everything inside. `folder` is where it goes, remote for an upload and local for a download.
 * `local` is the file or folder on this computer: an upload's source, a download's saved copy. `speed` is in bytes per second.
 * A `cancelled` item was cancelled or skipped and leaves the list.
 */
export type Transfer = {
  id: string;
  direction: 'upload' | 'download';
  name: string;
  folder: string;
  local: string;
  bytes: number;
  total: number;
  speed: number;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  reason?: string;
  /**
   * An editor-sync file, open in `app`. It downloads first, then each save uploads it again; `queued` waits for the connection.
   * `uploaded` is the last upload, in ms since 1970.
   */
  edit?: { app: string; uploaded?: number };
};

/** Queued or running: a cancel can still stop it, and closing its Tab asks first. */
export const unfinished = (t: Transfer) =>
  t.state === 'queued' || t.state === 'running';

/** Size and modified time (ms since 1970) of one side of a conflict. */
export type FileSide = { size: number; modified: number };

/** A transfer whose target exists. `others` counts the conflicts of the same batch still to answer after this one. */
export type Conflict = {
  name: string;
  local: FileSide;
  remote: FileSide;
  others: number;
};

/** `keep` transfers under a free name with a ` (1)` suffix. */
export type ConflictChoice = 'overwrite' | 'skip' | 'keep';

/** A save of an editor-sync file waiting on the user: `save` when upload on save is off, `changed` when the remote file changed since the last download or upload. */
export type EditorQuestion = {
  id: string;
  name: string;
  reason: 'save' | 'changed';
};

/** An editor-sync copy, found at startup, with a save that never reached `remote` on host `alias`. */
export type UnsentEdit = { alias: string; remote: string; file: string };

/** The transfer connection met a host key other than the one the Tab accepted. Fingerprints are SHA256. */
export type TransferKeyChange = {
  host: string;
  keyType: string;
  accepted: string;
  fingerprint: string;
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
  /**
   * `new` offers "Save to: keychain / KeePass / don't save"; `same` saves under the session's reference; `update` replaces its saved secret.
   * `create` is a typed `ssh` with no Saved session: saving also creates one, under the alias and folder the answer names.
   */
  save?: 'new' | 'same' | 'update' | 'create';
  /** The Saved session's folder, which preselects the KeePass group of a `new` save. For `create`, the folder the last one went to. */
  folder?: string;
  /** A typed `ssh` to this Hand-written host: it has to move into slop-term before it can save a secret. */
  moveIn?: string;
};

/**
 * The `ssh` a local shell Tab runs, or a Saved session the user picked to browse. `alias` is the destination as typed; `host`, `user` and `port` are what `ssh -G` resolved.
 * `session` is the Saved session it matched. `state` is the SFTP pane's own connection: `waiting` until it connects on its own or the user asks.
 */
export type TypedSsh = {
  alias: string;
  user: string;
  host: string;
  port: number;
  session?: string;
  /** No `ssh` process: the pane browses a Saved session the user picked. */
  picked?: true;
  jumpHost?: true;
  state: 'waiting' | 'connecting' | 'connected' | 'dropped';
  /** Why the pane's connection dropped. */
  reason?: string;
  /** A line about the last save, as "Not saved: …". */
  notice?: string;
};

/** A save that also creates a Saved session for a typed `ssh`. `folder` '' is the top level. */
export type NewTypedSession = { alias: string; folder: string };

export interface Backend {
  listShells(): Promise<Shell[]>;
  openLocalShell(shell: Shell): Promise<TabId>;
  /** Rejects a Local shell session whose shell or distro this machine lacks. */
  openShellSession(name: string): Promise<TabId>;
  /** Resolves once the Tab exists; connecting, the host key question and login follow as events. */
  openSsh(alias: string): Promise<TabId>;
  /** `true` trusts an unknown key, or replaces a changed one. */
  answerHostKey(tab: TabId, trust: boolean): Promise<void>;
  /**
   * One answer per prompt; `null` cancels the login. `save` follows the question's save offer: a group saves a new secret to KeePass, `true` to the keychain.
   * A `create` offer that saves names the Saved session in `create`. A local shell Tab's answer goes to its SFTP pane.
   */
  answerSecret(
    tab: TabId,
    answers: string[] | null,
    save: boolean | KeepassTarget,
    create?: NewTypedSession,
  ): Promise<void>;
  /**
   * Connects a local shell Tab's SFTP pane now: to the host its typed `ssh` reached, or with `alias` to that SSH Saved session.
   * A dropped pane reconnects the same way.
   */
  browseFiles(tab: TabId, alias?: string): Promise<void>;
  /** Ends a pane that browses a picked Saved session. */
  stopBrowsing(tab: TabId): Promise<void>;
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
  /** A pasted TPM URL or numeric id reads that entry once; any other text searches TPM. */
  findTpm(query: string): Promise<TpmFind>;
  /** Saves the user's TPM HMAC API keys in the keychain, replacing any saved before. */
  setTpmKeys(publicKey: string, privateKey: string): Promise<void>;
  /** A pasted `<database>/<uuid>` reads that entry; any other text searches title, username, URL and group of every unlocked database. */
  findKeepass(query: string): Promise<KeepassFind>;
  keepassDatabases(): Promise<KeepassDatabase[]>;
  /** Rejects with "Wrong master password." when it is wrong. */
  unlockKeepass(name: string, password: string): Promise<void>;
  /** Locks every database. */
  lockKeepass(): Promise<void>;
  /** The first `MobaXterm.ini` in MobaXterm's usual folders, for the import's file picker. */
  findMobaxterm(): Promise<string | undefined>;
  /** Reads a `MobaXterm.ini` or `.mxtsessions` file into one row per session. Writes nothing. */
  previewImport(file: string): Promise<ImportRow[]>;
  /** Imports the rows the user confirmed, writing each file once. Rejects, writing nothing, when an alias got taken since the preview. */
  importSessions(rows: ImportRow[]): Promise<SessionTree>;
  /** Copies a Hand-written host's block from `~/.ssh/config` into the Managed config. */
  moveIn(alias: string): Promise<SessionTree>;
  /** Comments out a Managed host's copy in `~/.ssh/config` under a `# moved to slop-term.conf` marker. */
  commentOut(alias: string): Promise<SessionTree>;
  /**
   * Lists a folder over the SFTP channel on the Tab's own connection, which the first call opens.
   * No path is the home folder; a relative one starts there. Rejects while the Tab isn't connected.
   */
  listFiles(tab: TabId, path?: string): Promise<Listing>;
  renameFile(tab: TabId, from: string, to: string): Promise<void>;
  makeFolder(tab: TabId, path: string): Promise<void>;
  /** The files and bytes each path takes with it, counting a folder's contents. A link counts as a file and is never followed. */
  measureFiles(tab: TabId, paths: string[]): Promise<FileCounts[]>;
  /** Deletes folders with everything inside. A link is deleted, never followed. */
  deleteFiles(tab: TabId, paths: string[]): Promise<void>;
  /**
   * Queues local files and folders for upload into a remote folder. Resolves once they are queued:
   * their progress comes as `transfer` events and existing targets ask as `conflict` events.
   */
  upload(tab: TabId, paths: string[], folder: string): Promise<void>;
  /** Queues remote files and folders for download, into `folder` or else the last download folder. A `folder` becomes the last download folder. */
  download(tab: TabId, paths: string[], folder?: string): Promise<void>;
  cancelTransfer(tab: TabId, id: string): Promise<void>;
  /** Queues a failed transfer again, to the same target, without asking. */
  retryTransfer(tab: TabId, id: string): Promise<void>;
  /** `all` gives the same answer to the other conflicts of the batch. */
  answerConflict(
    tab: TabId,
    choice: ConflictChoice,
    all: boolean,
  ): Promise<void>;
  /** Downloads a remote file to the app's temp folder and opens it in the editor. Its row and its uploads come as `transfer` events. */
  openInEditor(tab: TabId, path: string): Promise<void>;
  /** `true` uploads the save the question is about; `false` keeps it on this computer only. */
  answerEditorSave(tab: TabId, id: string, upload: boolean): Promise<void>;
  /** The copies the back end found at startup with saves that never reached the host. It deleted the other copies. */
  unsentEdits(): Promise<UnsentEdit[]>;
}

// Served by the main process, where native dialogs and the file manager live. Only `pathForFile` comes from the preload.
export interface Dialogs {
  /** Resolves to the picked file, as `~/…` when it is in the home folder. */
  pickKeyFile(): Promise<string | undefined>;
  pickFolder(): Promise<string | undefined>;
  /** A `MobaXterm.ini` or `.mxtsessions` file, starting at `defaultPath`. */
  pickImportFile(defaultPath?: string): Promise<string | undefined>;
  /** Files only: the native picker can't offer files and folders at once on Windows. */
  pickFiles(): Promise<string[]>;
  /** Opens Explorer or Finder with the file selected. */
  showItem(path: string): Promise<void>;
  /** The path of a file dropped from the OS. */
  pathForFile(file: File): string;
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

/**
 * `folder` is the decoded path from OSC 7 and `host` its hostname. `firstHost` is the hostname of the Tab's first OSC 7: a different `host` means the terminal ran `ssh` onward.
 * In a local shell Tab, `firstHost` is the first OSC 7 since its typed `ssh` started, and '' while none runs: only then does OSC 7 move the pane.
 * `title` comes from OSC 0 or 2; `address` is an SSH Tab's `user@host`.
 */
export type TabUpdate =
  | { folder: string; host: string; firstHost: string }
  | { title: string }
  | { address: string };

export type BackendEvent =
  | { type: 'output'; tab: TabId; data: string }
  | ({ type: 'tab'; tab: TabId } & TabUpdate)
  | { type: 'exit'; tab: TabId; code: number }
  /** An SSH Tab logged in. */
  | { type: 'connected'; tab: TabId }
  /**
   * An SSH Tab's connection ended without its shell exiting. `final` means a reconnect can't help: the Tab can only close.
   * `user` is the username the session's TPM entry names, which the UI offers to save as the session's `User`.
   */
  | { type: 'dropped'; tab: TabId; reason: string; final?: true; user?: string }
  /** For both questions, none means the connection closed and the open question is void. */
  /** `pane` is a question of a local shell Tab's SFTP pane, which the pane shows instead of the terminal. */
  | { type: 'hostKey'; tab: TabId; question?: HostKeyQuestion; pane?: true }
  | { type: 'secret'; tab: TabId; question?: SecretQuestion; pane?: true }
  /** None means the `ssh` exited, or the picked Saved session stopped browsing. */
  | { type: 'typedSsh'; tab: TabId; ssh?: TypedSsh }
  /** Steps pass in order. The first failure carries its reason and ends the Test. */
  | { type: 'test'; tab: TabId; steps: TestStep[] }
  | { type: 'transfer'; tab: TabId; transfer: Transfer }
  /** None means no question is open: it was answered, or the Tab dropped or closed. */
  | { type: 'conflict'; tab: TabId; conflict?: Conflict }
  | { type: 'transferKey'; tab: TabId; change: TransferKeyChange }
  /** None closes the question, as for `conflict`. */
  | { type: 'editorSave'; tab: TabId; question?: EditorQuestion }
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
  findMobaxterm: true,
  previewImport: true,
  importSessions: true,
  findTpm: true,
  setTpmKeys: true,
  findKeepass: true,
  keepassDatabases: true,
  unlockKeepass: true,
  lockKeepass: true,
  listFiles: true,
  renameFile: true,
  makeFolder: true,
  measureFiles: true,
  deleteFiles: true,
  upload: true,
  download: true,
  cancelTransfer: true,
  retryTransfer: true,
  answerConflict: true,
  openInEditor: true,
  answerEditorSave: true,
  unsentEdits: true,
  browseFiles: true,
  stopBrowsing: true,
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
