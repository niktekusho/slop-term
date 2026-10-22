import type {
  Backend,
  BackendClient,
  BackendEvent,
  Request,
  Shell,
  TabId,
} from '../shared/ipc.ts';

/** In-memory back end for UI tests: records every request and emits events on demand. */
export class FakeBackend implements BackendClient {
  requests: Omit<Request, 'id'>[] = [];
  shells: Shell[] = [{ kind: 'zsh' }, { kind: 'bash' }];
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

  async write(...args: Parameters<Backend['write']>) {
    this.requests.push({ method: 'write', args });
  }

  async resize(...args: Parameters<Backend['resize']>) {
    this.requests.push({ method: 'resize', args });
  }
}
