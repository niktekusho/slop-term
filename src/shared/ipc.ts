export type Shell =
  | { kind: 'pwsh' | 'powershell' | 'cmd' | 'zsh' | 'bash' }
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

export const defaultSettings: Settings = {
  theme: 'system',
  fontSize: 12,
  scrollback: 1000,
};

export interface Backend {
  listShells(): Promise<Shell[]>;
  openLocalShell(shell: Shell): Promise<TabId>;
  write(tab: TabId, data: string): Promise<void>;
  resize(tab: TabId, size: TerminalSize): Promise<void>;
  settings(): Promise<Settings>;
  /** Writes the keys into `settings.json`, keeping the others. */
  updateSettings(patch: Partial<Settings>): Promise<void>;
  openSettings(): Promise<void>;
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

export type BackendEvent =
  | { type: 'output'; tab: TabId; data: string }
  | { type: 'exit'; tab: TabId; code: number }
  | { type: 'settings'; settings: Settings };

type Events = {
  onEvent(listener: (event: BackendEvent) => void): () => void;
};

// Served by the preload and the main process: they change the Electron window itself.
export interface WindowControls {
  setZoom(factor: number): void;
  /** Makes the native title bar follow a forced theme. */
  setTheme(theme: Settings['theme']): void;
}

export type BackendClient = Backend & Profiler & WindowControls & Events;

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
  write: true,
  resize: true,
  settings: true,
  updateSettings: true,
  openSettings: true,
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
