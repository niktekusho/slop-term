import {
  defaultSettings,
  emptyTree,
  type Backend,
  type BackendClient,
  type BackendEvent,
  type ProcessMetrics,
  type Request,
  type SavedSession,
  type SessionDefaults,
  type SessionTree,
  type Settings,
  type Shell,
  type TabId,
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
  defaults: SessionDefaults = {
    hostname: '',
    port: '22',
    user: 'me',
    identityFile: '~/.ssh/id_ed25519',
  };
  keyFile: string | undefined = '~/.ssh/id_web';
  saveError: string | undefined;
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
    const [{ alias, folder, credential }, edit] = args;
    const others = this.tree.sessions.filter((s) => s.alias !== edit?.alias);
    const saved = {
      alias,
      ...(folder && { folder }),
      ...(credential && { credential }),
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

  async pickKeyFile() {
    return this.keyFile;
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
