import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Terminal } from '@xterm/xterm';
import {
  defaultSettings,
  emptyTree,
  type BackendClient,
  type CredentialReference,
  type HostKeyQuestion,
  type SecretQuestion,
  type SessionTree as Tree,
  type Settings,
  type Shell,
  type TabId,
} from '../shared/ipc.ts';
import { TerminalView } from './TerminalView.tsx';
import { ProfilingPanel } from './ProfilingPanel.tsx';
import {
  folderPaths,
  SessionTree,
  shellLabel,
  tabLabel,
  tabOrder,
  type Tab,
  type TreeItem,
} from './SessionTree.tsx';
import {
  CommentOut,
  DeleteFolder,
  MoveTo,
  type FolderContents,
} from './TreeDialogs.tsx';
import {
  deletable,
  inFolder,
  nameOf,
  parentOf,
  sameEntry,
  shellMissing,
  takenNames,
} from '../shared/session-rules.ts';
import {
  LocalShellDialog,
  newLocalForm,
  type LocalDialogStart,
} from './LocalShellDialog.tsx';
import { terminalOptions } from './look.ts';
import { HostKeyPrompt } from './HostKeyPrompt.tsx';
import { SecretPrompt } from './SecretPrompt.tsx';
import {
  DeleteSession,
  freeAlias,
  newForm,
  SessionDialog,
  type DialogStart,
} from './SessionDialog.tsx';
import { appShortcut, terminalShortcut } from './shortcuts.ts';

/** No question removes the Tab's entry. */
function withQuestion<Q>(questions: Map<TabId, Q>, tab: TabId, question?: Q) {
  const next = new Map(questions);
  if (question) next.set(tab, question);
  else next.delete(tab);
  return next;
}

// Dim, so the app's own lines stand apart from the shell's output.
const note = (text: string) => `\r\n\x1b[2m${text}\x1b[22m\r\n`;
const clock = () => new Date().toTimeString().slice(0, 5);

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
const subscribeToOsMode = (onChange: () => void) => {
  const query = darkQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function App({
  backend,
  mac,
}: {
  backend: BackendClient;
  mac: boolean;
}) {
  const [shells, setShells] = useState<Shell[]>();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<TabId>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  // With an alias or a folder, the menu of that row; with neither, the tree's own.
  const [treeMenu, setTreeMenu] = useState<{
    left: number;
    top: number;
    alias?: string;
    folder?: string;
  }>();
  const [selectedFolder, setSelectedFolder] = useState('');
  const [dialog, setDialog] = useState<DialogStart>();
  const [localDialog, setLocalDialog] = useState<LocalDialogStart>();
  const [deleting, setDeleting] = useState<{
    alias: string;
    read: string;
    credential?: CredentialReference;
    local?: true;
  }>();
  const [editing, setEditing] = useState<{ parent: string; folder?: string }>();
  const [moving, setMoving] = useState<{ item: TreeItem; current: string }>();
  const [deletingFolder, setDeletingFolder] = useState<FolderContents>();
  const [movedIn, setMovedIn] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const modal =
    !!dialog ||
    !!localDialog ||
    !!deleting ||
    !!moving ||
    !!deletingFolder ||
    !!movedIn;
  const [reconnectingAll, setReconnectingAll] = useState(false);
  const treeMenuRef = useRef<HTMLUListElement>(null);
  const [profiling, setProfiling] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [tree, setTree] = useState(emptyTree);
  const [query, setQuery] = useState('');
  const [questions, setQuestions] = useState(new Map<TabId, HostKeyQuestion>());
  const [secrets, setSecrets] = useState(new Map<TabId, SecretQuestion>());
  const filter = useRef<HTMLInputElement>(null);
  const terms = useRef(new Map<TabId, Terminal>());
  const osDark = useSyncExternalStore(
    subscribeToOsMode,
    () => darkQuery().matches,
  );
  const mode =
    settings.theme === 'system' ? (osDark ? 'dark' : 'light') : settings.theme;
  const options = useMemo(
    () => terminalOptions(settings, mode),
    [settings, mode],
  );

  useEffect(() => {
    backend.listShells().then(setShells);
    backend.settings().then(setSettings);
    backend.getTree().then(setTree);
  }, [backend]);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  useEffect(() => backend.setTheme(settings.theme), [backend, settings.theme]);

  useEffect(
    () => backend.setZoom(settings.fontSize / defaultSettings.fontSize),
    [backend, settings.fontSize],
  );

  // A halted Tab ignores every key but R, and a `final` one ignores R too.
  const halted = useRef(new Map<TabId, 'exited' | 'dropped' | 'final'>());
  const loggedIn = useRef(new Set<TabId>());
  // A Tab that ran a session's command stays after exit 0, so its output can still be read.
  const keepAfterExit = useRef(new Set<TabId>());
  const reconnecting = useRef(new Set<TabId>());
  // "Reconnect all" waits on each Tab's connected or dropped event before it starts the next.
  const settled = useRef(new Map<TabId, () => void>());
  const updateTab = (id: TabId, update: Partial<Tab>) =>
    setTabs((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...update } : t)));

  const restart = useCallback(
    (id: TabId) => {
      if (halted.current.get(id) === 'dropped') reconnecting.current.add(id);
      halted.current.delete(id);
      backend.restart(id);
      updateTab(id, { exit: undefined, disconnected: undefined });
      terms.current.get(id)?.focus();
    },
    [backend],
  );

  const settle = (id: TabId) => {
    settled.current.get(id)?.();
    settled.current.delete(id);
  };

  // A second run alongside the first would put two password prompts up at once.
  const reconnectAll = async () => {
    setReconnectingAll(true);
    const dropped = order.current.filter(
      (id) => halted.current.get(id) === 'dropped',
    );
    for (const id of dropped) {
      if (halted.current.get(id) !== 'dropped') continue;
      await new Promise<void>((resolve) => {
        settled.current.set(id, resolve);
        restart(id);
      });
    }
    setReconnectingAll(false);
  };

  // The back-end event listener subscribes once, so it reads the latest tree order from a ref.
  const order = useRef<TabId[]>([]);
  order.current = tabOrder(tree, tabs).map((t) => t.id);

  // The next Tab in tree order takes over, or the previous one for the last.
  const removeTab = useCallback(
    (id: TabId) => {
      backend.close(id);
      halted.current.delete(id);
      loggedIn.current.delete(id);
      keepAfterExit.current.delete(id);
      reconnecting.current.delete(id);
      settle(id);
      terms.current.get(id)?.dispose();
      terms.current.delete(id);
      const i = order.current.indexOf(id);
      const neighbour = order.current[i + 1] ?? order.current[i - 1];
      setTabs((tabs) => tabs.filter((t) => t.id !== id));
      setActive((a) => (a === id ? neighbour : a));
    },
    [backend],
  );

  useEffect(
    () =>
      backend.onEvent((event) => {
        if (event.type === 'settings') return setSettings(event.settings);
        if (event.type === 'tree') return setTree(event.tree);
        // The Saved session dialog shows a Test's checklist.
        if (event.type === 'test') return;
        if (event.type === 'tab') {
          const { type: _, tab, ...update } = event;
          return updateTab(tab, update);
        }
        if (event.type === 'hostKey' || event.type === 'secret') {
          // A Tab that "Reconnect all" started in the background comes forward to ask.
          if (event.question && settled.current.has(event.tab))
            setActive(event.tab);
          if (event.type === 'hostKey')
            return setQuestions((q) =>
              withQuestion(q, event.tab, event.question),
            );
          return setSecrets((q) => withQuestion(q, event.tab, event.question));
        }
        const term = terms.current.get(event.tab);
        if (!term) return;
        if (event.type === 'output') term.write(event.data);
        else if (event.type === 'connected') {
          loggedIn.current.add(event.tab);
          if (reconnecting.current.delete(event.tab))
            term.write(note(`── reconnected ${clock()} ──`));
          settle(event.tab);
        } else if (event.type === 'dropped') {
          const { tab, reason, final } = event;
          const offer = 'Press R to reconnect, or click Reconnect';
          term.write(
            note(
              final
                ? reason
                : loggedIn.current.delete(tab)
                  ? `Connection lost (${reason.replace(/\.$/, '')}) at ${clock()}. ${offer}`
                  : `${reason} ${offer}`,
            ),
          );
          reconnecting.current.delete(tab);
          halted.current.set(tab, final ? 'final' : 'dropped');
          updateTab(tab, { disconnected: final ? 'final' : 'retry' });
          settle(tab);
        } else if (event.code === 0 && !keepAfterExit.current.has(event.tab))
          removeTab(event.tab);
        else {
          halted.current.set(event.tab, 'exited');
          term.write(`\r\nprocess exited with code ${event.code}\r\n`);
          updateTab(event.tab, { exit: event.code });
        }
      }),
    [backend, removeTab],
  );

  const addTab = useCallback(
    (id: TabId, source: Tab['source'], local?: { command: boolean }) => {
      if (local?.command) keepAfterExit.current.add(id);
      const term = new Terminal(options);
      term.attachCustomKeyEventHandler((e) => !appShortcut(e, mac));
      term.onData((data) => {
        const state = halted.current.get(id);
        if (!state) backend.write(id, data);
        else if (state !== 'final' && data.toLowerCase() === 'r') restart(id);
      });
      term.onResize((size) => backend.resize(id, size));
      terms.current.set(id, term);
      setTabs((tabs) => [
        ...tabs,
        { id, source, ...(local && { local: true as const }) },
      ]);
      setActive(id);
    },
    [backend, mac, options, restart],
  );

  const open = useCallback(
    async (shell: Shell) =>
      addTab(await backend.openLocalShell(shell), shell, { command: false }),
    [backend, addTab],
  );

  const fail = (e: Error) => setNotice(e.message);
  const localOf = (name: string) =>
    tree.localShells.find((s) => s.name === name);
  const openSession = useCallback(
    async (name: string) => {
      const local = tree.localShells.find((s) => s.name === name);
      if (!local) return addTab(await backend.openSsh(name), name);
      // The back end refuses a session this machine can't open.
      await backend
        .openShellSession(name)
        .then((id) => addTab(id, name, { command: !!local.command }), fail);
    },
    [backend, addTab, tree],
  );

  const taken = () => takenNames(tree);
  const openDialog = (start: DialogStart) => {
    setNotice(undefined);
    setDialog(start);
  };
  const openLocalDialog = (start: LocalDialogStart) => {
    setNotice(undefined);
    setLocalDialog(start);
  };
  const editSession = (alias: string) =>
    localOf(alias)
      ? backend
          .getLocalShell(alias)
          .then(({ read, ...form }) =>
            openLocalDialog({ form, edit: { name: alias, read } }),
          )
          .catch(fail)
      : backend
          .getSession(alias)
          .then(({ read, ...form }) =>
            openDialog({ form, edit: { alias, read } }),
          )
          .catch(fail);
  const duplicateSession = (alias: string) =>
    localOf(alias)
      ? backend
          .getLocalShell(alias)
          .then((session) => {
            const { read: _, ...form } = session;
            openLocalDialog({
              form: { ...form, name: freeAlias(alias, taken()) },
            });
          })
          .catch(fail)
      : backend
          .getSession(alias)
          .then((session) => {
            const { read: _, ...form } = session;
            openDialog({ form: { ...form, alias: freeAlias(alias, taken()) } });
          })
          .catch(fail);
  const askDelete = (alias: string) =>
    (localOf(alias)
      ? backend
          .getLocalShell(alias)
          .then(({ read }) => ({ alias, read, local: true as const }))
      : backend
          .getSession(alias)
          .then(({ read, credential }) => ({ alias, read, credential }))
    )
      .then((target) => {
        setNotice(undefined);
        setDeleting(target);
      })
      .catch(fail);

  const update = (call: Promise<Tree>) => call.then(setTree, fail);

  const moveTo = (item: TreeItem) =>
    setMoving({
      item,
      current:
        'alias' in item
          ? (localOf(item.alias)?.folder ??
            tree.sessions.find((s) => s.alias === item.alias)?.folder ??
            '')
          : parentOf(item.folder),
    });

  const rename = (folder: string) =>
    setEditing({ parent: parentOf(folder), folder });

  const finishEdit = (name?: string) => {
    setEditing(undefined);
    if (!editing || name === undefined) return;
    const { parent, folder } = editing;
    if (!folder) void update(backend.createFolder(parent, name));
    else if (nameOf(folder) !== name)
      void update(backend.renameFolder(folder, name));
  };

  // What a folder delete takes along. A secret can go only when no session outside the folder uses it.
  const contents = (folder: string): FolderContents => {
    const sessions = tree.sessions.filter((s) =>
      inFolder(s.folder ?? '', folder),
    );
    const outside = tree.sessions.filter((s) => !sessions.includes(s));
    const refs = sessions
      .flatMap((s) => s.credential ?? [])
      .filter((ref, i, all) => !all.slice(0, i).some((r) => sameEntry(r, ref)));
    const secrets = refs.filter(
      (ref) =>
        deletable(ref) && !outside.some((s) => sameEntry(s.credential, ref)),
    ).length;
    const aliases = [
      ...sessions.map((s) => s.alias),
      ...tree.localShells
        .filter((s) => inFolder(s.folder, folder))
        .map((s) => s.name),
    ];
    return {
      folder,
      aliases,
      subfolders: folderPaths(tree).filter(
        (f) => f !== folder && inFolder(f, folder),
      ).length,
      secrets,
      kept: refs.length - secrets,
      openTabs: tabs.filter(
        (t) => typeof t.source === 'string' && aliases.includes(t.source),
      ).length,
    };
  };

  // The confirm keeps the sessions it counted, so a tree reload under it becomes a conflict instead of a bigger delete.
  const askDeleteFolder = (folder: string) => {
    const found = contents(folder);
    setNotice(undefined);
    if (found.aliases.length || found.subfolders) setDeletingFolder(found);
    else void update(backend.deleteFolder(folder, [], false));
  };

  const moveIn = (alias: string) =>
    backend
      .moveIn(alias)
      .then((next) => {
        setTree(next);
        setMovedIn(alias);
      })
      .catch(fail);

  // The key shows on the right; the accessible name stays the action alone.
  const menuItem = (
    label: string,
    run: () => void,
    {
      keys,
      className,
      disabled,
    }: {
      keys?: { aria: string; shown: string };
      className?: string;
      disabled?: boolean;
    } = {},
  ) => (
    <li role="none" key={label}>
      <button
        role="menuitem"
        className={className}
        disabled={disabled}
        aria-keyshortcuts={keys?.aria}
        onClick={() => {
          setTreeMenu(undefined);
          run();
        }}
      >
        {label}
        {keys && <kbd aria-hidden="true">{keys.shown}</kbd>}
      </button>
    </li>
  );
  const key = (aria: string, shown = aria) => ({ keys: { aria, shown } });
  const deleteItem = (run: () => void) => [
    <li key="separator" role="separator" />,
    menuItem('Delete', run, { ...key('Delete', 'Del'), className: 'danger' }),
  ];
  const sessionMenu = (alias: string) => {
    const local = localOf(alias);
    const openTab = menuItem('Open Tab', () => openSession(alias), {
      ...key('Enter'),
      disabled: !!local && !!shells && shellMissing(local, shells),
    });
    if (tree.handWritten.includes(alias))
      return [openTab, menuItem('Move into slop-term', () => moveIn(alias))];
    const session = tree.sessions.find((s) => s.alias === alias);
    return [
      openTab,
      menuItem('Edit', () => editSession(alias), key('F2')),
      menuItem('Duplicate', () => duplicateSession(alias)),
      menuItem('Move to…', () => moveTo({ alias }), key('F7')),
      session?.alsoInConfig &&
        menuItem('Comment out the copy in ~/.ssh/config', () =>
          update(backend.commentOut(alias)),
        ),
      ...deleteItem(() => askDelete(alias)),
    ];
  };
  const folderMenu = (folder: string) => [
    menuItem('New SSH session here', () =>
      openDialog({ form: newForm(folder) }),
    ),
    menuItem('New local shell here', () =>
      openLocalDialog({ form: newLocalForm(folder, shells) }),
    ),
    menuItem('New folder here', () => setEditing({ parent: folder })),
    menuItem('Rename', () => rename(folder), key('F2')),
    menuItem('Move to…', () => moveTo({ folder }), key('F7')),
    ...deleteItem(() => askDeleteFolder(folder)),
  ];

  const answer = (tab: TabId, trust: boolean) => {
    backend.answerHostKey(tab, trust);
    setQuestions((q) => withQuestion(q, tab));
    terms.current.get(tab)?.focus();
  };

  const answerSecret = (
    tab: TabId,
    answers: string[] | null,
    save: boolean,
  ) => {
    backend.answerSecret(tab, answers, save);
    setSecrets((q) => withQuestion(q, tab));
    terms.current.get(tab)?.focus();
  };

  useEffect(() => {
    // Each step starts from the last saved size, so the app drops key repeats and wheel ticks that come faster than a save.
    const zoom = (step: 'zoomIn' | 'zoomOut' | 'zoomReset') => {
      const size =
        step === 'zoomReset'
          ? defaultSettings.fontSize
          : settings.fontSize + (step === 'zoomIn' ? 1 : -1);
      backend.updateSettings({ fontSize: Math.min(Math.max(size, 6), 36) });
    };
    const onKey = (e: KeyboardEvent) => {
      if (modal) return;
      const shortcut = appShortcut(e, mac);
      if (!shortcut || terminalShortcut(shortcut)) return;
      e.preventDefault();
      if (shortcut === 'profiling') setProfiling((p) => !p);
      else if (shortcut === 'settings') backend.openSettings();
      else if (shortcut === 'filter') filter.current?.focus();
      else if (shortcut === 'newTab') {
        if (shells?.[0]) open(shells[0]);
      } else if (shortcut === 'duplicate') {
        const tab = tabs.find((t) => t.id === active);
        if (typeof tab?.source === 'string') openSession(tab.source);
        else if (tab) open(tab.source);
      } else if (shortcut === 'close') {
        if (active) removeTab(active);
      } else if (typeof shortcut === 'number') {
        const id = order.current[shortcut - 1];
        if (id) setActive(id);
      } else if (shortcut === 'nextTab' || shortcut === 'previousTab') {
        const ids = order.current;
        const i = ids.indexOf(active!);
        const id =
          shortcut === 'nextTab'
            ? ids[(i + 1) % ids.length]
            : ids.at(Math.max(i, 0) - 1);
        if (id) setActive(id);
      } else zoom(shortcut);
    };
    // The capture phase runs before xterm's own wheel handler, so a zoom doesn't also scroll.
    const onWheel = (e: WheelEvent) => {
      if (!(mac ? e.metaKey : e.ctrlKey) || !e.deltaY) return;
      e.preventDefault();
      e.stopPropagation();
      zoom(e.deltaY < 0 ? 'zoomIn' : 'zoomOut');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [
    backend,
    mac,
    shells,
    open,
    openSession,
    removeTab,
    tabs,
    active,
    settings.fontSize,
    modal,
  ]);

  useEffect(() => {
    if (!treeMenu) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !treeMenuRef.current?.contains(e.target as Node)
      )
        setTreeMenu(undefined);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [treeMenu]);

  const activeTab = tabs.find((t) => t.id === active);

  return (
    <div className="window">
      <nav
        className="tree"
        aria-label="Session tree"
        inert={modal}
        onContextMenu={(e) => {
          e.preventDefault();
          setTreeMenu({ left: e.clientX, top: e.clientY });
        }}
      >
        {treeMenu && (
          <ul
            ref={treeMenuRef}
            role="menu"
            className="menu"
            style={{ left: treeMenu.left, top: treeMenu.top }}
          >
            {treeMenu.alias ? (
              sessionMenu(treeMenu.alias)
            ) : treeMenu.folder !== undefined ? (
              folderMenu(treeMenu.folder)
            ) : (
              <li role="none">
                <button
                  role="menuitem"
                  disabled={
                    reconnectingAll ||
                    !tabs.some((t) => t.disconnected === 'retry')
                  }
                  onClick={() => {
                    setTreeMenu(undefined);
                    // The menu takes the focus with it when it closes.
                    if (active) terms.current.get(active)?.focus();
                    reconnectAll();
                  }}
                >
                  Reconnect all disconnected Tabs
                </button>
              </li>
            )}
          </ul>
        )}
        <div className="tree-actions">
          <input
            ref={filter}
            type="search"
            aria-label="Filter"
            placeholder="Filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="new">
            <button
              aria-haspopup="menu"
              onClick={() => setNewMenuOpen((o) => !o)}
            >
              New
            </button>
            {newMenuOpen && (
              <ul role="menu" className="menu">
                <li role="none">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setNewMenuOpen(false);
                      openDialog({ form: newForm(selectedFolder) });
                    }}
                  >
                    SSH session
                  </button>
                </li>
                <li role="none">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setNewMenuOpen(false);
                      openLocalDialog({
                        form: newLocalForm(selectedFolder, shells),
                      });
                    }}
                  >
                    Local shell session
                  </button>
                </li>
                <li role="none">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setNewMenuOpen(false);
                      setEditing({ parent: selectedFolder });
                    }}
                  >
                    Folder
                  </button>
                </li>
              </ul>
            )}
          </div>
          <div className="new">
            <button aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)}>
              New local shell
            </button>
            {menuOpen && (
              <ul role="menu" className="menu">
                {shells?.map((shell) => (
                  <li key={shellLabel(shell)} role="none">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        open(shell);
                      }}
                    >
                      {shellLabel(shell)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <SessionTree
          model={tree}
          tabs={tabs}
          active={active}
          mac={mac}
          onSelectTab={setActive}
          onOpenSession={openSession}
          shells={shells}
          onSession={(alias, action) => {
            if (action === 'edit') editSession(alias);
            else if (action === 'delete') askDelete(alias);
            else if (action === 'move') moveTo({ alias });
            else setTreeMenu({ ...action, alias });
          }}
          onFolder={(folder, action) => {
            if (action === 'rename') rename(folder);
            else if (action === 'delete') askDeleteFolder(folder);
            else if (action === 'move') moveTo({ folder });
            else setTreeMenu({ ...action, folder });
          }}
          onMove={(item, to) => void update(backend.move(item, to))}
          editing={editing}
          onEditDone={finishEdit}
          onSelectFolder={setSelectedFolder}
          query={query}
        />
        {notice && (
          <p role="alert" className="warning">
            {notice}
          </p>
        )}
      </nav>
      <header className="header" inert={modal}>
        {activeTab && (
          <>
            <span className="name">{tabLabel(activeTab)}</span>
            <span className="where">
              {activeTab.local ? 'local shell' : activeTab.address}
              {activeTab.disconnected && ' · disconnected'}
            </span>
            {activeTab.disconnected === 'retry' && (
              <button onClick={() => restart(activeTab.id)}>Reconnect</button>
            )}
            {typeof activeTab.source !== 'string' && (
              <button
                onClick={() => {
                  const shell = activeTab.source as Shell;
                  openLocalDialog({
                    form: newLocalForm(selectedFolder, [shell], {
                      distro: shell.kind === 'wsl' ? shell.distro : '',
                    }),
                    tab: { id: activeTab.id, label: tabLabel(activeTab) },
                  });
                }}
              >
                Save…
              </button>
            )}
          </>
        )}
      </header>
      <main className="terminals" inert={modal}>
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            term={terms.current.get(tab.id)!}
            options={options}
            active={tab.id === active}
            mac={mac}
          />
        ))}
        {active && questions.has(active) && (
          <HostKeyPrompt
            key={active}
            question={questions.get(active)!}
            onAnswer={(trust) => answer(active, trust)}
          />
        )}
        {active && secrets.has(active) && (
          <SecretPrompt
            key={active}
            question={secrets.get(active)!}
            onAnswer={(answers, save) => answerSecret(active, answers, save)}
          />
        )}
      </main>
      <ProfilingPanel profiler={backend} open={profiling} />
      {dialog && (
        <SessionDialog
          backend={backend}
          tree={tree}
          start={dialog}
          onCancel={() => setDialog(undefined)}
          onSaved={(next, alias) => {
            const from = dialog.edit?.alias;
            setTree(next);
            // A rename carries its Tabs along.
            if (from && from !== alias)
              setTabs((tabs) =>
                tabs.map((t) =>
                  t.source === from ? { ...t, source: alias } : t,
                ),
              );
            setDialog(undefined);
          }}
        />
      )}
      {localDialog && (
        <LocalShellDialog
          backend={backend}
          tree={tree}
          shells={shells ?? []}
          start={localDialog}
          onCancel={() => setLocalDialog(undefined)}
          onSaved={(next, name) => {
            const { edit, tab } = localDialog;
            setTree(next);
            if (tab) updateTab(tab.id, { source: name });
            // A rename carries its Tabs along.
            if (edit && edit.name !== name)
              setTabs((tabs) =>
                tabs.map((t) =>
                  t.source === edit.name ? { ...t, source: name } : t,
                ),
              );
            setLocalDialog(undefined);
          }}
        />
      )}
      {deleting && (
        <DeleteSession
          {...deleting}
          tree={tree}
          openTabs={tabs.filter((t) => t.source === deleting.alias).length}
          onCancel={() => setDeleting(undefined)}
          onDelete={async (deleteSecret) => {
            const { alias, read, local } = deleting;
            setTree(
              await (local
                ? backend.deleteLocalShell(alias, read)
                : backend.deleteSession(alias, read, deleteSecret)),
            );
            setDeleting(undefined);
          }}
        />
      )}
      {moving && (
        <MoveTo
          name={
            'alias' in moving.item
              ? moving.item.alias
              : nameOf(moving.item.folder)
          }
          folders={folderPaths(tree).filter(
            (f) =>
              !('folder' in moving.item && inFolder(f, moving.item.folder)),
          )}
          current={moving.current}
          onCancel={() => setMoving(undefined)}
          onMove={(to) => {
            setMoving(undefined);
            if (to !== moving.current)
              void update(backend.move(moving.item, to));
          }}
        />
      )}
      {deletingFolder && (
        <DeleteFolder
          contents={deletingFolder}
          onCancel={() => setDeletingFolder(undefined)}
          onDelete={async (deleteSecrets) => {
            const { folder, aliases } = deletingFolder;
            setTree(await backend.deleteFolder(folder, aliases, deleteSecrets));
            setDeletingFolder(undefined);
          }}
        />
      )}
      {movedIn && (
        <CommentOut
          alias={movedIn}
          onKeep={() => setMovedIn(undefined)}
          onCommentOut={async () => {
            setTree(await backend.commentOut(movedIn));
            setMovedIn(undefined);
          }}
        />
      )}
    </div>
  );
}
