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
  type Settings,
  type Shell,
  type TabId,
} from '../shared/ipc.ts';
import { TerminalView } from './TerminalView.tsx';
import { ProfilingPanel } from './ProfilingPanel.tsx';
import { SessionTree } from './SessionTree.tsx';
import { terminalOptions } from './look.ts';
import { appShortcut } from './shortcuts.ts';

type Tab = { id: TabId; shell: Shell };

const shellLabel = (shell: Shell) =>
  shell.kind === 'wsl' ? `wsl: ${shell.distro}` : shell.kind;

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

  useEffect(
    () =>
      backend.onEvent((event) => {
        if (event.type === 'settings') return setSettings(event.settings);
        if (event.type === 'tree') return setTree(event.tree);
        const term = terms.current.get(event.tab);
        if (event.type === 'output') term?.write(event.data);
        else {
          term?.dispose();
          terms.current.delete(event.tab);
          setTabs((tabs) => tabs.filter((t) => t.id !== event.tab));
          setActive((id) => (id === event.tab ? undefined : id));
        }
      }),
    [backend],
  );

  const open = useCallback(
    async (shell: Shell) => {
      const id = await backend.openLocalShell(shell);
      const term = new Terminal(options);
      term.attachCustomKeyEventHandler((e) => !appShortcut(e, mac));
      term.onData((data) => backend.write(id, data));
      term.onResize((size) => backend.resize(id, size));
      terms.current.set(id, term);
      setTabs((tabs) => [...tabs, { id, shell }]);
      setActive(id);
    },
    [backend, mac, options],
  );

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
      // The terminal handles its own clipboard and find keys; elsewhere they keep their native meaning.
      if (
        !shortcut ||
        shortcut === 'copy' ||
        shortcut === 'paste' ||
        shortcut === 'find'
      )
        return;
      e.preventDefault();
      if (shortcut === 'profiling') setProfiling((p) => !p);
      else if (shortcut === 'settings') backend.openSettings();
      else if (shortcut === 'filter') filter.current?.focus();
      else if (shortcut === 'newTab') {
        if (shells[0]) open(shells[0]);
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
  }, [backend, mac, shells, open, settings.fontSize]);

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
          tabs={tabs.map((t) => ({ id: t.id, label: shellLabel(t.shell) }))}
          active={active}
          onSelectTab={setActive}
          query={query}
        />
      </nav>
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
      </main>
      <ProfilingPanel profiler={backend} open={profiling} />
    </div>
  );
}
