import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node-pty';
import type {
  Backend,
  BackendEvent,
  NewTypedSession,
  SecretChange,
  TabId,
  TerminalSize,
  TypedSsh,
} from '../shared/ipc.ts';
import { shellMissing } from '../shared/session-rules.ts';
import { blockLines, localShell } from './config-store.ts';
import { detectShells, spawnLine } from './shells.ts';
import { oscScanner, type OscUpdate } from './osc.ts';
import { createEditorSync, recoverEdits } from './editor-sync.ts';
import { resolve, resolveTyped, type Resolved } from './resolver.ts';
import { createTransfers } from './transfers.ts';
import {
  alive,
  destination,
  findSsh,
  matchSession,
  type SshProcess,
} from './typed-ssh.ts';
import {
  notConnected,
  openSshTab,
  type PanePlan,
  type SshTab,
  type TabMemory,
} from './ssh.ts';

type Tab = {
  files?: SshTab['files'];
  transferChannel?: SshTab['transferChannel'];
  write(data: string): void;
  resize(size: TerminalSize): void;
  close(): void;
  answerHostKey?(trust: boolean): void;
  answerSecret?: SshTab['answerSecret'];
  keepalive?(): void;
  /** A local shell's process. `detects` is whether a typed `ssh` in it can be seen: not inside WSL. */
  shell?: { pid(): number; detects: boolean };
};

type Open = (
  tab: TabId,
  emit: (event: BackendEvent) => void,
  onClose: () => void,
) => Tab;

/**
 * A local shell Tab's SFTP pane. `pid` is the typed `ssh` it follows; none means a Saved session the user picked.
 * `firstHost` is the hostname of the first OSC 7 since that `ssh` started. `memory` lives as long as the `ssh`.
 */
type Pane = {
  info: TypedSsh;
  plan: PanePlan;
  memory: TabMemory;
  pid?: number;
  poll?: NodeJS.Timeout;
  conn?: SshTab;
  firstHost?: string;
};

type OscFolder = Extract<OscUpdate, { host: string }>;

// Long enough for the shell to start the command after Enter.
const detectDelayMs = 500;
const exitPollMs = 1000;

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
      // ConPTY sets the pid after spawn returns: it reads 0 until the shell runs.
      shell: { pid: () => pty.pid, detects: launch.kind !== 'wsl' },
    };
  };

export function createSessions(
  emit: (event: BackendEvent) => void,
  settings: Pick<Backend, 'settings' | 'updateSettings'>,
  /** Where editor-sync copies live, one folder each. */
  editorRoot: string,
  store: Pick<Backend, 'getTree' | 'saveSession'>,
): Pick<
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
  | 'browseFiles'
  | 'stopBrowsing'
  | 'listFiles'
  | 'renameFile'
  | 'makeFolder'
  | 'measureFiles'
  | 'deleteFiles'
  | 'upload'
  | 'download'
  | 'cancelTransfer'
  | 'retryTransfer'
  | 'answerConflict'
  | 'openInEditor'
  | 'answerEditorSave'
  | 'unsentEdits'
> & {
  /** Points the SSH Tabs of a renamed Saved session at its new alias, so a reconnect finds it. */
  renamed(from: string, to: string): void;
} {
  const tabs = new Map<TabId, Tab>();
  // A Tab keeps its opener after it exits, so a restart opens the same thing again.
  const openers = new Map<TabId, Open>();
  const targets = new Map<TabId, { alias: string }>();
  // Kept across reconnects: the first OSC 7 names the host the Tab's pane browses.
  const firstHosts = new Map<TabId, string>();
  const panes = new Map<TabId, Pane>();
  // Tabs with a check for a typed `ssh` scheduled or running, and the last OSC 7 each saw meanwhile.
  const checks = new Set<TabId>();
  const early = new Map<TabId, OscFolder>();
  let nextTab = 1;

  /** What the pane talks to: a local shell Tab's pane connection, else the SSH Tab itself. */
  const connOf = (tab: TabId) => panes.get(tab)?.conn ?? tabs.get(tab);

  const files = (tab: TabId) =>
    connOf(tab)?.files?.() ?? Promise.reject(notConnected());

  // A local shell Tab's queue and editor sync belong to one host: a later `ssh` to another host in the Tab gets its own.
  const scopeOf = (tab: TabId) => {
    const info = panes.get(tab)?.info;
    return info ? `${info.user}@${info.host}:${info.port}` : '';
  };
  const keyOf = (tab: TabId, scope = scopeOf(tab)) => `${tab}\n${scope}`;
  const ofTab = <T>(map: Map<string, T>, tab: TabId) =>
    [...map].filter(([k]) => k.startsWith(`${tab}\n`)).map(([, v]) => v);

  const transferChannel = (tab: TabId, scope: string) => () =>
    (scopeOf(tab) === scope && connOf(tab)?.transferChannel?.()) ||
    Promise.reject(notConnected());

  // Kept across reconnects, so a transfer that failed on a drop can retry on the new connection.
  const queues = new Map<string, ReturnType<typeof createTransfers>>();
  const queue = (tab: TabId) => {
    const scope = scopeOf(tab);
    let q = queues.get(keyOf(tab, scope));
    if (!q) {
      q = createTransfers(tab, emit, transferChannel(tab, scope));
      queues.set(keyOf(tab, scope), q);
    }
    return q;
  };

  // Runs before the first copy opens, so it never deletes a new one.
  const unsent = recoverEdits(editorRoot);
  // Kept across reconnects, so a save that waits for the connection goes out on the new one.
  const syncs = new Map<string, ReturnType<typeof createEditorSync>>();
  const sync = (tab: TabId) => {
    const scope = scopeOf(tab);
    let s = syncs.get(keyOf(tab, scope));
    if (!s) {
      const info = panes.get(tab)?.info;
      const paneAlias = info?.session ?? info?.alias ?? '';
      s = createEditorSync(
        tab,
        emit,
        transferChannel(tab, scope),
        editorRoot,
        settings.settings,
        () => targets.get(tab)?.alias ?? paneAlias,
      );
      syncs.set(keyOf(tab, scope), s);
    }
    return s;
  };

  const show = (tab: TabId, pane: Pane, patch: Partial<TypedSsh>) => {
    pane.info = { ...pane.info, ...patch };
    if (panes.get(tab) === pane)
      emit({ type: 'typedSsh', tab, ssh: pane.info });
  };

  /** The pane's connection reports as the pane, never as the Tab: the terminal keeps running whatever happens to it. */
  const paneEvents = (tab: TabId, pane: Pane) => (event: BackendEvent) => {
    if (event.type === 'hostKey' || event.type === 'secret')
      return emit({ ...event, pane: true });
    if (panes.get(tab) !== pane) return;
    if (event.type === 'connected') {
      show(tab, pane, { state: 'connected', reason: undefined });
      syncs.get(keyOf(tab))?.connected();
    } else if (event.type === 'dropped') {
      show(tab, pane, { state: 'dropped', reason: event.reason });
      queues.get(keyOf(tab))?.fail('The pane disconnected.');
      syncs.get(keyOf(tab))?.dropped();
    } else if (event.type === 'output')
      // The only lines a pane prints are about its last save.
      show(tab, pane, { notice: event.data.trim() });
    else emit(event);
  };

  function connectPane(tab: TabId, pane: Pane) {
    if (pane.info.jumpHost || panes.get(tab) !== pane) return;
    pane.conn?.close();
    show(tab, pane, { state: 'connecting', reason: undefined });
    const conn = openSshTab(
      pane.info.alias,
      tab,
      paneEvents(tab, pane),
      () => {
        if (pane.conn === conn) pane.conn = undefined;
      },
      pane.memory,
      undefined,
      pane.plan,
    );
    pane.conn = conn;
  }

  /** Closes the pane's connection and forgets what the user typed for it. Running transfers finish; editor saves wait for this host again. */
  function endPane(tab: TabId) {
    const pane = panes.get(tab);
    if (!pane) return;
    syncs.get(keyOf(tab))?.dropped();
    panes.delete(tab);
    clearInterval(pane.poll);
    pane.conn?.close(true);
    emit({ type: 'typedSsh', tab });
  }

  async function createSession(
    tab: TabId,
    pane: Pane,
    { alias, folder }: NewTypedSession,
    secret: NonNullable<SecretChange['set']>,
  ) {
    const r = pane.plan.resolved;
    const tree = await store.saveSession(
      {
        alias,
        folder,
        hostname: r.hostname,
        port: String(r.port),
        user: r.user,
        identityFile: '',
        options: ['ServerAliveInterval 15'],
      },
      undefined,
      { set: secret },
    );
    emit({ type: 'tree', tree });
    await settings.updateSettings({ typedSshFolder: folder });
    pane.plan.session = alias;
    show(tab, pane, { session: alias });
  }

  async function openPane(
    tab: TabId,
    alias: string,
    r: Resolved,
    pid?: number,
  ) {
    const match = await matchSession(await store.getTree(), alias, r);
    const { typedSshFolder } = await settings.settings();
    if (!tabs.has(tab)) return;
    endPane(tab);
    firstHosts.delete(tab);
    const pane: Pane = {
      info: {
        alias,
        user: r.user,
        host: r.hostname,
        port: r.port,
        ...(match.session && { session: match.session }),
        ...(pid === undefined && { picked: true as const }),
        ...(r.jumpHost && { jumpHost: true as const }),
        state: 'waiting',
      },
      memory: { typed: {} },
      pid,
      plan: {
        resolved: r,
        ...match,
        ...(typedSshFolder && { folder: typedSshFolder }),
        create: (answer, secret) => createSession(tab, pane, answer, secret),
      },
    };
    panes.set(tab, pane);
    emit({ type: 'typedSsh', tab, ssh: pane.info });
    if (pid !== undefined)
      pane.poll = setInterval(() => {
        if (!alive(pid)) endPane(tab);
      }, exitPollMs);
    return pane;
  }

  async function typedSsh(tab: TabId, found: SshProcess) {
    const r = await resolveTyped(found.file, found.args);
    const pane = await openPane(
      tab,
      destination(found.args) ?? r.hostname,
      r,
      found.pid,
    );
    const seen = early.get(tab);
    early.delete(tab);
    if (pane && seen) remoteFolder(tab, pane, seen);
  }

  function remoteFolder(tab: TabId, pane: Pane, update: OscFolder) {
    pane.firstHost ??= update.host;
    emit({ type: 'tab', tab, ...update, firstHost: pane.firstHost });
    // The first OSC 7 proves the terminal's `ssh` logged in, so the pane can't race its host key question.
    if (pane.info.state === 'waiting' && !pane.conn) connectPane(tab, pane);
  }

  /** Looks for a typed `ssh` a moment after Enter. While one runs, only its pid is checked. */
  function detect(tab: TabId) {
    const live = tabs.get(tab);
    if (!live?.shell?.detects || checks.has(tab)) return;
    if (panes.get(tab)?.pid !== undefined) return;
    checks.add(tab);
    early.delete(tab);
    const t0 = Date.now();
    console.log(`[DEBUG-w7k3] enter tab=${tab} shell=${live.shell!.pid()}`);
    setTimeout(() => {
      findSsh(live.shell!.pid())
        .then((found) => {
          console.log(`[DEBUG-w7k3] first check after ${Date.now() - t0}ms found=${JSON.stringify(found)}`);
          if (!found)
            for (const ms of [2000, 5000, 10000])
              setTimeout(() => findSsh(live.shell!.pid()).then((f) => console.log(`[DEBUG-w7k3] probe +${ms}ms found=${JSON.stringify(f)}`), (e) => console.log(`[DEBUG-w7k3] probe error ${e}`)), ms);
          return found;
        })
        .then((found) =>
          found && tabs.get(tab) === live && panes.get(tab)?.pid === undefined
            ? typedSsh(tab, found)
            : undefined,
        )
        // ponytail: an `ssh` whose arguments `ssh -G` rejects gets no pane.
        .catch((e) => console.log(`[DEBUG-w7k3] check error ${e}`))
        .finally(() => checks.delete(tab));
    }, detectDelayMs);
  }

  const start = (tab: TabId, open: Open) => {
    const scan = oscScanner((update) => {
      if (!('host' in update)) return emit({ type: 'tab', tab, ...update });
      // A local shell's OSC 7 counts for the pane only while a typed `ssh` runs: a local prompt can send it too.
      if (tabs.get(tab)?.shell) {
        const pane = panes.get(tab);
        if (pane?.pid !== undefined) return remoteFolder(tab, pane, update);
        // A key login can reach the remote prompt before the check finds its `ssh`: the pane counts that OSC 7 once it opens.
        if (checks.has(tab)) early.set(tab, update);
        return emit({ type: 'tab', tab, ...update, firstHost: '' });
      }
      if (!firstHosts.has(tab)) firstHosts.set(tab, update.host);
      emit({ type: 'tab', tab, ...update, firstHost: firstHosts.get(tab)! });
    });
    const send = (event: BackendEvent) => {
      emit(event);
      if (event.type === 'output') scan(event.data);
      if (event.type === 'dropped' || event.type === 'exit') {
        for (const q of ofTab(queues, tab)) q.fail('The Tab disconnected.');
        for (const s of ofTab(syncs, tab)) s.dropped();
        endPane(tab);
      }
      if (event.type === 'connected') syncs.get(keyOf(tab))?.connected();
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

    async browseFiles(tab, alias) {
      if (alias === undefined) {
        const pane = panes.get(tab);
        if (pane) connectPane(tab, pane);
        return;
      }
      const pane = await openPane(tab, alias, await resolve(alias));
      if (pane) connectPane(tab, pane);
    },

    async stopBrowsing(tab) {
      if (panes.get(tab)?.info.picked) endPane(tab);
    },

    renamed(from, to) {
      for (const target of targets.values())
        if (target.alias === from) target.alias = to;
    },

    async answerHostKey(tab, trust) {
      connOf(tab)?.answerHostKey?.(trust);
    },

    async answerSecret(tab, answers, save, create) {
      connOf(tab)?.answerSecret?.(answers, save, create);
    },

    async close(tab) {
      openers.delete(tab);
      targets.delete(tab);
      firstHosts.delete(tab);
      endPane(tab);
      const edits = ofTab(syncs, tab);
      for (const q of ofTab(queues, tab)) q.fail('The Tab closed.');
      for (const map of [queues, syncs])
        for (const key of map.keys())
          if (key.startsWith(`${tab}\n`)) map.delete(key);
      tabs.get(tab)?.close();
      await Promise.all(edits.map((s) => s.close()));
    },

    async restart(tab) {
      const open = openers.get(tab);
      if (open && !tabs.has(tab)) start(tab, open);
    },

    async write(tab, data) {
      tabs.get(tab)?.write(data);
      if (data.includes('\r')) detect(tab);
    },

    async resize(tab, size) {
      tabs.get(tab)?.resize(size);
    },

    async wake() {
      for (const tab of tabs.values()) tab.keepalive?.();
      for (const pane of panes.values()) pane.conn?.keepalive();
    },

    listFiles: async (tab, path) => (await files(tab)).list(path),
    renameFile: async (tab, from, to) => (await files(tab)).rename(from, to),
    makeFolder: async (tab, path) => (await files(tab)).makeFolder(path),
    measureFiles: async (tab, paths) => (await files(tab)).measure(paths),
    deleteFiles: async (tab, paths) => (await files(tab)).remove(paths),

    async upload(tab, paths, folder) {
      queue(tab).enqueue('upload', paths, folder);
    },

    async download(tab, paths, folder) {
      if (folder) await settings.updateSettings({ downloadFolder: folder });
      const into =
        folder ??
        (await settings.settings()).downloadFolder ??
        path.join(homedir(), 'Downloads');
      await mkdir(into, { recursive: true });
      queue(tab).enqueue('download', paths, into);
    },

    cancelTransfer: async (tab, id) => {
      for (const q of ofTab(queues, tab)) q.cancel(id);
    },
    retryTransfer: async (tab, id) => {
      for (const q of ofTab(queues, tab)) q.retry(id);
      for (const s of ofTab(syncs, tab)) s.retry(id);
    },
    answerConflict: async (tab, choice, all) => {
      for (const q of ofTab(queues, tab)) q.answer(choice, all);
    },

    async openInEditor(tab, path) {
      await unsent;
      await sync(tab).open(path);
    },
    unsentEdits: () => unsent,
    answerEditorSave: async (tab, id, upload) => {
      for (const s of ofTab(syncs, tab)) s.answer(id, upload);
    },
  };
}
