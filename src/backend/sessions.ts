import { homedir } from 'node:os';
import { spawn, type IPty } from 'node-pty';
import type { Backend, BackendEvent, TabId } from '../shared/ipc.ts';
import { detectShells, launchLine } from './shells.ts';

export function createSessions(
  emit: (event: BackendEvent) => void,
): Pick<Backend, 'listShells' | 'openLocalShell' | 'write' | 'resize'> {
  const tabs = new Map<TabId, IPty>();
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
      tabs.set(tab, pty);
      pty.onData((data) => emit({ type: 'output', tab, data }));
      pty.onExit(({ exitCode }) => {
        tabs.delete(tab);
        emit({ type: 'exit', tab, code: exitCode });
      });
      return tab;
    },

    async write(tab, data) {
      tabs.get(tab)?.write(data);
    },

    async resize(tab, { cols, rows }) {
      tabs.get(tab)?.resize(cols, rows);
    },
  };
}
