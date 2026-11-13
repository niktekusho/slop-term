import {
  defaultSettings,
  emptyTree,
  type Backend,
  type BackendClient,
  type BackendEvent,
  type KeepassDatabase,
  type FileCounts,
  type ImportRow,
  type KeepassFind,
  type ProcessMetrics,
  type RemoteFile,
  type Request,
  type SavedLocalShell,
  type SavedSession,
  type SessionDefaults,
  type SessionTree,
  type Settings,
  type Shell,
  type TabId,
  type TpmFind,
  type UnsentEdit,
} from '../shared/ipc.ts';
import {
  inFolder,
  joinFolder,
  nameOf,
  parentOf,
} from '../shared/session-rules.ts';

/** In-memory back end for UI tests: records every request and emits events on demand. */
export class FakeBackend implements BackendClient {
  requests: Omit<Request, 'id'>[] = [];
  shells: Shell[] = [{ kind: 'zsh' }, { kind: 'bash' }];
  savedSettings: Settings = defaultSettings;
  zoom = 1;
  theme: Settings['theme'] = 'system';
  processes: ProcessMetrics[] = [];
  tracing = false;
  traceFile: string | undefined = '/tmp/slop-term-trace.json';
  tree: SessionTree = emptyTree;
  savedSessions: Record<string, SavedSession> = {};
  savedLocalShells: Record<string, SavedLocalShell> = {};
  defaults: SessionDefaults = {
    hostname: '',
    port: '22',
    user: 'me',
    identityFile: '~/.ssh/id_ed25519',
  };
  keyFile: string | undefined = '~/.ssh/id_web';
  /** What the folder and file pickers answer; none and [] are a cancel. */
  folder: string | undefined = '/local/picked';
  pickedFiles: string[] = ['/local/a.txt', '/local/b.txt'];
  /** The paths `showItem` revealed in the file manager. */
  shown: string[] = [];
  saveError: string | undefined;
  /** What every `findTpm` answers; an Error rejects with its message. */
  tpmFind: TpmFind | Error = { entries: [] };
  /** What every `findKeepass` answers; an Error rejects with its message. */
  keepassFind: KeepassFind | Error = { entries: [], locked: [] };
  /** The databases this machine has. None means "Save to" offers no KeePass. */
  keepassDbs: KeepassDatabase[] = [];
  keepassPassword = 'master';
  /** The remote files of every SFTP pane, by absolute folder path. A listing with no path starts at `remoteHome`. */
  remote: Record<string, RemoteFile[]> = { '/home/me': [] };
  remoteHome = '/home/me';
  /** What `measureFiles` answers per path; a path without one is a single file of 0 bytes. */
  measures: Record<string, FileCounts> = {};
  /** What `findMobaxterm` finds, the import picker answers (none is a cancel), and `previewImport` lists. */
  mobaxtermFile: string | undefined =
    'C:\\Users\\me\\AppData\\Roaming\\MobaXterm\\MobaXterm.ini';
  importFile: string | undefined = 'C:\\moba\\picked.ini';
  importRows: ImportRow[] = [];
  /** The folders the import picker started at. */
  pickedImportFrom: (string | undefined)[] = [];
  /** What `unsentEdits` answers at startup. */
  unsent: UnsentEdit[] = [];
  private listeners = new Set<(event: BackendEvent) => void>();
  private nextTab = 1;
  private holds = new Map<keyof Backend, Promise<void>>();

  /** Makes the next call of `method` wait until the returned function runs. */
  hold(method: keyof Backend) {
    let release!: () => void;
    this.holds.set(method, new Promise<void>((r) => (release = r)));
    return release;
  }

  private async gate(method: keyof Backend) {
    const held = this.holds.get(method);
    this.holds.delete(method);
    await held;
  }

  onEvent(listener: (event: BackendEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: BackendEvent) {
    for (const listener of this.listeners) listener(event);
  }

  sent<M extends keyof Backend>(method: M) {
    return this.requests
      .filter((r) => r.method === method)
      .map((r) => r.args as Parameters<Backend[M]>);
  }

  async listShells() {
    this.requests.push({ method: 'listShells', args: [] });
    return this.shells;
  }

  async openLocalShell(shell: Shell): Promise<TabId> {
    this.requests.push({ method: 'openLocalShell', args: [shell] });
    return `tab-${this.nextTab++}`;
  }

  async openShellSession(name: string): Promise<TabId> {
    this.requests.push({ method: 'openShellSession', args: [name] });
    return `tab-${this.nextTab++}`;
  }

  async openSsh(alias: string): Promise<TabId> {
    this.requests.push({ method: 'openSsh', args: [alias] });
    return `tab-${this.nextTab++}`;
  }

  async answerHostKey(...args: Parameters<Backend['answerHostKey']>) {
    this.requests.push({ method: 'answerHostKey', args });
  }

  async answerSecret(...args: Parameters<Backend['answerSecret']>) {
    this.requests.push({ method: 'answerSecret', args });
  }

  async close(...args: Parameters<Backend['close']>) {
    this.requests.push({ method: 'close', args });
  }

  async restart(...args: Parameters<Backend['restart']>) {
    this.requests.push({ method: 'restart', args });
  }

  async write(...args: Parameters<Backend['write']>) {
    this.requests.push({ method: 'write', args });
  }

  async resize(...args: Parameters<Backend['resize']>) {
    this.requests.push({ method: 'resize', args });
  }

  async wake() {
    this.requests.push({ method: 'wake', args: [] });
  }

  async settings() {
    this.requests.push({ method: 'settings', args: [] });
    return this.savedSettings;
  }

  async updateSettings(...args: Parameters<Backend['updateSettings']>) {
    this.requests.push({ method: 'updateSettings', args });
    this.savedSettings = { ...this.savedSettings, ...args[0] };
    this.emit({ type: 'settings', settings: this.savedSettings });
  }

  async openSettings() {
    this.requests.push({ method: 'openSettings', args: [] });
  }

  async getTree() {
    this.requests.push({ method: 'getTree', args: [] });
    return this.tree;
  }

  async getSession(alias: string) {
    this.requests.push({ method: 'getSession', args: [alias] });
    await this.gate('getSession');
    const session = this.savedSessions[alias];
    if (!session) throw new Error(`${alias} is not in slop-term.conf.`);
    return session;
  }

  /** Puts the Saved session in the tree, as the real back end's reload would. */
  async saveSession(...args: Parameters<Backend['saveSession']>) {
    this.requests.push({ method: 'saveSession', args });
    await this.gate('saveSession');
    if (this.saveError) throw new Error(this.saveError);
    const [{ alias, folder, credential, colour }, edit] = args;
    const others = this.tree.sessions.filter((s) => s.alias !== edit?.alias);
    const saved = {
      alias,
      ...(folder && { folder }),
      ...(credential && { credential }),
      ...(colour && { colour }),
    };
    this.tree = { ...this.tree, sessions: [...others, saved] };
    return this.tree;
  }

  async deleteSession(...args: Parameters<Backend['deleteSession']>) {
    this.requests.push({ method: 'deleteSession', args });
    const sessions = this.tree.sessions.filter((s) => s.alias !== args[0]);
    this.tree = { ...this.tree, sessions };
    return this.tree;
  }

  async sessionDefaults(...args: Parameters<Backend['sessionDefaults']>) {
    this.requests.push({ method: 'sessionDefaults', args });
    return { ...this.defaults, hostname: args[0] };
  }

  async testSession(...args: Parameters<Backend['testSession']>) {
    this.requests.push({ method: 'testSession', args });
    await this.gate('testSession');
    return `test-${this.nextTab++}`;
  }

  async getLocalShell(name: string) {
    this.requests.push({ method: 'getLocalShell', args: [name] });
    const session = this.savedLocalShells[name];
    if (!session) throw new Error(`${name} is no longer in slop-term.json.`);
    return session;
  }

  /** Puts the session in the tree, so a test sees its Tabs move under it. */
  async saveLocalShell(...args: Parameters<Backend['saveLocalShell']>) {
    this.requests.push({ method: 'saveLocalShell', args });
    const [form, edit] = args;
    const others = this.tree.localShells.filter((s) => s.name !== edit?.name);
    this.tree = { ...this.tree, localShells: [...others, form] };
    return this.tree;
  }

  async deleteLocalShell(...args: Parameters<Backend['deleteLocalShell']>) {
    this.requests.push({ method: 'deleteLocalShell', args });
    return this.tree;
  }

  private relocate(from: string, to: string) {
    const swap = (p: string) =>
      inFolder(p, from) ? to + p.slice(from.length) : p;
    this.tree = {
      ...this.tree,
      folders: this.tree.folders.map(swap),
      sessions: this.tree.sessions.map((s) =>
        s.folder ? { ...s, folder: swap(s.folder) } : s,
      ),
    };
    return this.tree;
  }

  async createFolder(...args: Parameters<Backend['createFolder']>) {
    this.requests.push({ method: 'createFolder', args });
    const folder = joinFolder(...args);
    this.tree = { ...this.tree, folders: [...this.tree.folders, folder] };
    return this.tree;
  }

  async renameFolder(...args: Parameters<Backend['renameFolder']>) {
    this.requests.push({ method: 'renameFolder', args });
    const [folder, name] = args;
    return this.relocate(folder, joinFolder(parentOf(folder), name));
  }

  async move(...args: Parameters<Backend['move']>) {
    this.requests.push({ method: 'move', args });
    const [item, to] = args;
    if ('folder' in item)
      return this.relocate(item.folder, joinFolder(to, nameOf(item.folder)));
    const sessions = this.tree.sessions.map((s) => {
      if (s.alias !== item.alias) return s;
      const { folder: _, ...rest } = s;
      return to ? { ...rest, folder: to } : rest;
    });
    this.tree = { ...this.tree, sessions };
    return this.tree;
  }

  async deleteFolder(...args: Parameters<Backend['deleteFolder']>) {
    this.requests.push({ method: 'deleteFolder', args });
    const [folder] = args;
    this.tree = {
      ...this.tree,
      folders: this.tree.folders.filter((f) => !inFolder(f, folder)),
      sessions: this.tree.sessions.filter(
        (s) => !inFolder(s.folder ?? '', folder),
      ),
    };
    return this.tree;
  }

  /** Leaves the namesake in `~/.ssh/config`, as the real back end does until `commentOut`. */
  async moveIn(...args: Parameters<Backend['moveIn']>) {
    this.requests.push({ method: 'moveIn', args });
    const [alias] = args;
    this.tree = {
      ...this.tree,
      sessions: [...this.tree.sessions, { alias, alsoInConfig: 1 }],
      handWritten: this.tree.handWritten.filter((a) => a !== alias),
    };
    return this.tree;
  }

  async commentOut(...args: Parameters<Backend['commentOut']>) {
    this.requests.push({ method: 'commentOut', args });
    const sessions = this.tree.sessions.map((s) => {
      if (s.alias !== args[0]) return s;
      const { alsoInConfig: _, ...rest } = s;
      return rest;
    });
    this.tree = { ...this.tree, sessions };
    return this.tree;
  }

  async findTpm(...args: Parameters<Backend['findTpm']>) {
    this.requests.push({ method: 'findTpm', args });
    if (this.tpmFind instanceof Error) throw this.tpmFind;
    return this.tpmFind;
  }

  async setTpmKeys(...args: Parameters<Backend['setTpmKeys']>) {
    this.requests.push({ method: 'setTpmKeys', args });
  }

  async findKeepass(...args: Parameters<Backend['findKeepass']>) {
    this.requests.push({ method: 'findKeepass', args });
    if (this.keepassFind instanceof Error) throw this.keepassFind;
    return this.keepassFind;
  }

  async keepassDatabases() {
    this.requests.push({ method: 'keepassDatabases', args: [] });
    return this.keepassDbs;
  }

  /** Unlocks the database when the password is `keepassPassword`, as the real back end does with the right one. */
  async unlockKeepass(...args: Parameters<Backend['unlockKeepass']>) {
    this.requests.push({ method: 'unlockKeepass', args });
    if (args[1] !== this.keepassPassword)
      throw new Error('Wrong master password.');
    this.keepassDbs = this.keepassDbs.map((d) =>
      d.name === args[0] ? { ...d, locked: false } : d,
    );
  }

  async lockKeepass() {
    this.requests.push({ method: 'lockKeepass', args: [] });
  }

  async listFiles(...args: Parameters<Backend['listFiles']>) {
    this.requests.push({ method: 'listFiles', args });
    const [, path = this.remoteHome] = args;
    const at = path.startsWith('/') ? path : `${this.remoteHome}/${path}`;
    const files = this.remote[at];
    if (!files) throw new Error(`No such file: ${at}`);
    return { path: at, files };
  }

  /** Changes `remote`, so the pane's next listing shows the result. */
  private inFolder(
    path: string,
    change: (files: RemoteFile[], name: string) => RemoteFile[],
  ) {
    const slash = path.lastIndexOf('/');
    const folder = path.slice(0, slash) || '/';
    this.remote[folder] = change(
      this.remote[folder] ?? [],
      path.slice(slash + 1),
    );
  }

  async renameFile(...args: Parameters<Backend['renameFile']>) {
    this.requests.push({ method: 'renameFile', args });
    const [, from, to] = args;
    const moved = to.slice(to.lastIndexOf('/') + 1);
    this.inFolder(from, (files, name) =>
      files.map((f) => (f.name === name ? { ...f, name: moved } : f)),
    );
  }

  async makeFolder(...args: Parameters<Backend['makeFolder']>) {
    this.requests.push({ method: 'makeFolder', args });
    this.inFolder(args[1], (files, name) => [
      ...files,
      {
        name,
        folder: true,
        size: 4096,
        modified: 0,
        permissions: 'drwxr-xr-x',
      },
    ]);
  }

  async measureFiles(...args: Parameters<Backend['measureFiles']>) {
    this.requests.push({ method: 'measureFiles', args });
    return args[1].map((p) => this.measures[p] ?? { files: 1, bytes: 0 });
  }

  async deleteFiles(...args: Parameters<Backend['deleteFiles']>) {
    this.requests.push({ method: 'deleteFiles', args });
    for (const path of args[1])
      this.inFolder(path, (files, name) =>
        files.filter((f) => f.name !== name),
      );
  }

  async upload(...args: Parameters<Backend['upload']>) {
    this.requests.push({ method: 'upload', args });
  }

  async download(...args: Parameters<Backend['download']>) {
    this.requests.push({ method: 'download', args });
  }

  async cancelTransfer(...args: Parameters<Backend['cancelTransfer']>) {
    this.requests.push({ method: 'cancelTransfer', args });
  }

  async retryTransfer(...args: Parameters<Backend['retryTransfer']>) {
    this.requests.push({ method: 'retryTransfer', args });
  }

  async answerConflict(...args: Parameters<Backend['answerConflict']>) {
    this.requests.push({ method: 'answerConflict', args });
  }

  async openInEditor(...args: Parameters<Backend['openInEditor']>) {
    this.requests.push({ method: 'openInEditor', args });
  }

  async answerEditorSave(...args: Parameters<Backend['answerEditorSave']>) {
    this.requests.push({ method: 'answerEditorSave', args });
  }

  async browseFiles(...args: Parameters<Backend['browseFiles']>) {
    this.requests.push({ method: 'browseFiles', args });
  }

  async stopBrowsing(...args: Parameters<Backend['stopBrowsing']>) {
    this.requests.push({ method: 'stopBrowsing', args });
  }

  async unsentEdits() {
    this.requests.push({ method: 'unsentEdits', args: [] });
    return this.unsent;
  }

  async pickKeyFile() {
    return this.keyFile;
  }

  async pickFolder() {
    return this.folder;
  }

  async pickImportFile(defaultPath?: string) {
    this.pickedImportFrom.push(defaultPath);
    return this.importFile;
  }

  async findMobaxterm() {
    this.requests.push({ method: 'findMobaxterm', args: [] });
    return this.mobaxtermFile;
  }

  async previewImport(...args: Parameters<Backend['previewImport']>) {
    this.requests.push({ method: 'previewImport', args });
    return this.importRows;
  }

  /** Fails with `saveError`, else answers the tree as it is: a test sets the tree the import leads to. */
  async importSessions(...args: Parameters<Backend['importSessions']>) {
    this.requests.push({ method: 'importSessions', args });
    if (this.saveError) throw new Error(this.saveError);
    return this.tree;
  }

  async pickFiles() {
    return this.pickedFiles;
  }

  async showItem(path: string) {
    this.shown.push(path);
  }

  /** A dropped file's path, as the preload would give it. */
  pathForFile(file: File) {
    return `/local/${file.name}`;
  }

  setZoom(factor: number) {
    this.zoom = factor;
  }

  setTheme(theme: Settings['theme']) {
    this.theme = theme;
  }

  async metrics() {
    return this.processes;
  }

  async startTrace() {
    this.tracing = true;
  }

  async stopTrace() {
    this.tracing = false;
    return this.traceFile;
  }
}
