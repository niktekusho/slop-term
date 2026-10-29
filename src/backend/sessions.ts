import { homedir } from 'node:os';
import { spawn } from 'node-pty';
import type {
  Backend,
  BackendEvent,
  TabId,
  TerminalSize,
} from '../shared/ipc.ts';
import { detectShells, launchLine } from './shells.ts';
import { oscScanner } from './osc.ts';
import { openSshTab, type TabMemory } from './ssh.ts';

type Tab = {
  write(data: string): void;
  resize(size: TerminalSize): void;
  close(): void;
  answerHostKey?(trust: boolean): void;
  answerSecret?(answers: string[] | null, save: boolean): void;
  keepalive?(): void;
};

type Open = (
  tab: TabId,
  emit: (event: BackendEvent) => void,
  onClose: () => void,
) => Tab;

export function createSessions(
  emit: (event: BackendEvent) => void,
): Pick<
  Backend,
  | 'listShells'
  | 'openLocalShell'
  | 'openSsh'
  | 'answerHostKey'
  | 'answerSecret'
  | 'close'
  | 'restart'
  | 'write'
  | 'resize'
  | 'wake'
> {
  const tabs = new Map<TabId, Tab>();
  // A Tab keeps its opener after it exits, so a restart opens the same thing again.
  const openers = new Map<TabId, Open>();
  let nextTab = 1;

  const start = (tab: TabId, open: Open) => {
    const scan = oscScanner((update) => emit({ type: 'tab', tab, ...update }));
    const send = (event: BackendEvent) => {
      emit(event);
      if (event.type === 'output') scan(event.data);
    };
    const live = open(tab, send, () => {
      if (tabs.get(tab) === live) tabs.delete(tab);
    });
    tabs.set(tab, live);
  };

  const launch = (open: Open) => {
    const tab = `tab-${nextTab++}`;
    openers.set(tab, open);
    start(tab, open);
    return tab;
  };

  return {
    listShells: detectShells,

    async openLocalShell(shell) {
      return launch((tab, emit, onClose) => {
        const [file, args] = launchLine(shell);
        const pty = spawn(file, args, {
          name: 'xterm-256color',
          cwd: homedir(),
          env: { ...process.env, COLORTERM: 'truecolor' },
        });
        pty.onData((data) => emit({ type: 'output', tab, data }));
        pty.onExit(({ exitCode }) => {
          onClose();
          emit({ type: 'exit', tab, code: exitCode });
        });
        return {
          write: (data) => pty.write(data),
          resize: ({ cols, rows }) => pty.resize(cols, rows),
          close: () => pty.kill(),
        };
      });
    },

    async openSsh(alias) {
      // Lives as long as the Tab, so a reconnect reuses what the user typed and the key they accepted.
      const memory: TabMemory = { typed: {} };
      return launch((tab, emit, onClose) =>
        openSshTab(alias, tab, emit, onClose, memory),
      );
    },

    async answerHostKey(tab, trust) {
      tabs.get(tab)?.answerHostKey?.(trust);
    },

    async answerSecret(tab, answers, save) {
      tabs.get(tab)?.answerSecret?.(answers, save);
    },

    async close(tab) {
      openers.delete(tab);
      tabs.get(tab)?.close();
    },

    async restart(tab) {
      const open = openers.get(tab);
      if (open && !tabs.has(tab)) start(tab, open);
    },

    async write(tab, data) {
      tabs.get(tab)?.write(data);
    },

    async resize(tab, size) {
      tabs.get(tab)?.resize(size);
    },

    async wake() {
      for (const tab of tabs.values()) tab.keepalive?.();
    },
  };
}
