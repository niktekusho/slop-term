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
  type HostKeyQuestion,
  type Settings,
  type Shell,
  type TabId,
} from '../shared/ipc.ts';
import { TerminalView } from './TerminalView.tsx';
import { ProfilingPanel } from './ProfilingPanel.tsx';
import {
  SessionTree,
  shellLabel,
  tabLabel,
  tabOrder,
  type Tab,
} from './SessionTree.tsx';
import { terminalOptions } from './look.ts';
import { HostKeyPrompt } from './HostKeyPrompt.tsx';
import { appShortcut, terminalShortcut } from './shortcuts.ts';

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
  const [shells, setShells] = useState<Shell[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<TabId>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profiling, setProfiling] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [tree, setTree] = useState(emptyTree);
  const [query, setQuery] = useState('');
  const [questions, setQuestions] = useState(new Map<TabId, HostKeyQuestion>());
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

  const exited = useRef(new Set<TabId>());
  const updateTab = (id: TabId, update: Partial<Tab>) =>
    setTabs((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...update } : t)));

  // The back-end event listener subscribes once, so it reads the latest tree order from a ref.
  const order = useRef<TabId[]>([]);
  order.current = tabOrder(tree, tabs).map((t) => t.id);

  // The next Tab in tree order takes over, or the previous one for the last.
  const removeTab = useCallback(
    (id: TabId) => {
      backend.close(id);
      exited.current.delete(id);
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
        if (event.type === 'tab') {
          const { type: _, tab, ...update } = event;
          return updateTab(tab, update);
        }
        if (event.type === 'hostKey')
          return setQuestions((q) => {
            const next = new Map(q);
            if (event.question) next.set(event.tab, event.question);
            else next.delete(event.tab);
            return next;
          });
        const term = terms.current.get(event.tab);
        if (!term) return;
        if (event.type === 'output') term.write(event.data);
        else if (event.code === 0) removeTab(event.tab);
        else {
          exited.current.add(event.tab);
          term.write(`\r\nprocess exited with code ${event.code}\r\n`);
          updateTab(event.tab, { exit: event.code });
        }
      }),
    [backend, removeTab],
  );

  const addTab = useCallback(
    (id: TabId, source: Tab['source']) => {
      const term = new Terminal(options);
      term.attachCustomKeyEventHandler((e) => !appShortcut(e, mac));
      // An exited Tab ignores every key but R, which starts it again.
      term.onData((data) => {
        if (!exited.current.has(id)) backend.write(id, data);
        else if (data.toLowerCase() === 'r') {
          exited.current.delete(id);
          backend.restart(id);
          updateTab(id, { exit: undefined });
        }
      });
      term.onResize((size) => backend.resize(id, size));
      terms.current.set(id, term);
      setTabs((tabs) => [...tabs, { id, source }]);
      setActive(id);
    },
    [backend, mac, options],
  );

  const open = useCallback(
    async (shell: Shell) => addTab(await backend.openLocalShell(shell), shell),
    [backend, addTab],
  );

  const openHost = useCallback(
    async (alias: string) => addTab(await backend.openSsh(alias), alias),
    [backend, addTab],
  );

  const answer = (tab: TabId, trust: boolean) => {
    backend.answerHostKey(tab, trust);
    setQuestions((q) => {
      const next = new Map(q);
      next.delete(tab);
      return next;
    });
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
      const shortcut = appShortcut(e, mac);
      if (!shortcut || terminalShortcut(shortcut)) return;
      e.preventDefault();
      if (shortcut === 'profiling') setProfiling((p) => !p);
      else if (shortcut === 'settings') backend.openSettings();
      else if (shortcut === 'filter') filter.current?.focus();
      else if (shortcut === 'newTab') {
        if (shells[0]) open(shells[0]);
      } else if (shortcut === 'duplicate') {
        const tab = tabs.find((t) => t.id === active);
        if (typeof tab?.source === 'string') openHost(tab.source);
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
    openHost,
    removeTab,
    tabs,
    active,
    settings.fontSize,
  ]);

  const activeTab = tabs.find((t) => t.id === active);

  return (
    <div className="window">
      <nav className="tree" aria-label="Session tree">
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
            <button aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)}>
              New local shell
            </button>
            {menuOpen && (
              <ul role="menu" className="menu">
                {shells.map((shell) => (
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
          onOpenHost={openHost}
          query={query}
        />
      </nav>
      <header className="header">
        {activeTab && (
          <>
            <span className="name">{tabLabel(activeTab)}</span>
            <span className="where">
              {typeof activeTab.source === 'string'
                ? activeTab.address
                : 'local shell'}
            </span>
          </>
        )}
      </header>
      <main className="terminals">
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
      </main>
      <ProfilingPanel profiler={backend} open={profiling} />
    </div>
  );
}
