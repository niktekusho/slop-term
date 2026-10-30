import { spawn } from 'node-pty';
import type {
  Backend,
  BackendEvent,
  TabId,
  TerminalSize,
} from '../shared/ipc.ts';
import { shellMissing } from '../shared/session-rules.ts';
import { blockLines, localShell } from './config-store.ts';
import { detectShells, spawnLine } from './shells.ts';
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

const ptyTab =
  (launch: Parameters<typeof spawnLine>[0]): Open =>
  (tab, emit, onClose) => {
    const { file, args, cwd } = spawnLine(launch);
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cwd,
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
  };

export function createSessions(emit: (event: BackendEvent) => void): Pick<
  Backend,
  | 'listShells'
  | 'openLocalShell'
  | 'openShellSession'
  | 'openSsh'
  | 'answerHostKey'
  | 'answerSecret'
  | 'close'
  | 'restart'
  | 'write'
  | 'resize'
  | 'wake'
  | 'testSession'
> & {
  /** Points the SSH Tabs of a renamed Saved session at its new alias, so a reconnect finds it. */
  renamed(from: string, to: string): void;
} {
  const tabs = new Map<TabId, Tab>();
  // A Tab keeps its opener after it exits, so a restart opens the same thing again.
  const openers = new Map<TabId, Open>();
  const targets = new Map<TabId, { alias: string }>();
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
      return launch(ptyTab(shell));
    },

    // The Tab keeps the session as it was opened: a restart runs the same command even after an edit.
    async openShellSession(name) {
      const session = localShell(name);
      if (shellMissing(session, await detectShells()))
        throw new Error(`${name} is not available on this machine.`);
      return launch(ptyTab(session));
    },

    async openSsh(alias) {
      // Lives as long as the Tab, so a reconnect reuses what the user typed and the key they accepted.
      const memory: TabMemory = { typed: {} };
      const target = { alias };
      const id = launch((tab, emit, onClose) =>
        openSshTab(target.alias, tab, emit, onClose, memory),
      );
      targets.set(id, target);
      return id;
    },

    // A Test is a Tab with no opener: it can't restart.
    // ponytail: a field cleared in an edit still tests the value in the file. `-o` can't unset it.
    async testSession(form, secret) {
      const memory: TabMemory = {
        typed: secret ? { [secret.kind]: secret.secret } : {},
      };
      const plan = { options: blockLines(form), credential: form.credential };
      const test = `test-${nextTab++}`;
      start(test, (tab, emit, onClose) =>
        openSshTab(form.alias, tab, emit, onClose, memory, plan),
      );
      return test;
    },

    renamed(from, to) {
      for (const target of targets.values())
        if (target.alias === from) target.alias = to;
    },

    async answerHostKey(tab, trust) {
      tabs.get(tab)?.answerHostKey?.(trust);
    },

    async answerSecret(tab, answers, save) {
      tabs.get(tab)?.answerSecret?.(answers, save);
    },

    async close(tab) {
      openers.delete(tab);
      targets.delete(tab);
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
