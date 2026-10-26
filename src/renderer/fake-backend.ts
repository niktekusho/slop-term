import {
  defaultSettings,
  emptyTree,
  type Backend,
  type BackendClient,
  type BackendEvent,
  type ProcessMetrics,
  type Request,
  type SessionTree,
  type Settings,
  type Shell,
  type TabId,
} from '../shared/ipc.ts';

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
  private listeners = new Set<(event: BackendEvent) => void>();
  private nextTab = 1;

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

  async write(...args: Parameters<Backend['write']>) {
    this.requests.push({ method: 'write', args });
  }

  async resize(...args: Parameters<Backend['resize']>) {
    this.requests.push({ method: 'resize', args });
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
