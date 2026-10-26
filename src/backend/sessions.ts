import { homedir } from 'node:os';
import { spawn } from 'node-pty';
import type {
  Backend,
  BackendEvent,
  TabId,
  TerminalSize,
} from '../shared/ipc.ts';
import { detectShells, launchLine } from './shells.ts';
import { openSshTab } from './ssh.ts';

type Tab = {
  write(data: string): void;
  resize(size: TerminalSize): void;
  answerHostKey?(trust: boolean): void;
};

export function createSessions(
  emit: (event: BackendEvent) => void,
): Pick<
  Backend,
  | 'listShells'
  | 'openLocalShell'
  | 'openSsh'
  | 'answerHostKey'
  | 'write'
  | 'resize'
> {
  const tabs = new Map<TabId, Tab>();
  let nextTab = 1;

  return {
    listShells: detectShells,

    async openLocalShell(shell) {
      const [file, args] = launchLine(shell);
      const pty = spawn(file, args, {
        name: 'xterm-256color',
        cwd: homedir(),
        env: { ...process.env, COLORTERM: 'truecolor' },
      });
      const tab = `tab-${nextTab++}`;
      tabs.set(tab, {
        write: (data) => pty.write(data),
        resize: ({ cols, rows }) => pty.resize(cols, rows),
      });
      pty.onData((data) => emit({ type: 'output', tab, data }));
      pty.onExit(({ exitCode }) => {
        tabs.delete(tab);
        emit({ type: 'exit', tab, code: exitCode });
      });
      return tab;
    },

    async openSsh(alias) {
      const tab = `tab-${nextTab++}`;
      tabs.set(
        tab,
        openSshTab(alias, tab, emit, () => tabs.delete(tab)),
      );
      return tab;
    },

    async answerHostKey(tab, trust) {
      tabs.get(tab)?.answerHostKey?.(trust);
    },

    async write(tab, data) {
      tabs.get(tab)?.write(data);
    },

    async resize(tab, size) {
      tabs.get(tab)?.resize(size);
    },
  };
}
