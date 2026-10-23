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
  type BackendClient,
  type Settings,
  type Shell,
  type TabId,
} from '../shared/ipc.ts';
import { TerminalView } from './TerminalView.tsx';
import { ProfilingPanel } from './ProfilingPanel.tsx';
import { terminalOptions } from './look.ts';

type Tab = { id: TabId; shell: Shell };

const shellLabel = (shell: Shell) =>
  shell.kind === 'wsl' ? `wsl: ${shell.distro}` : shell.kind;

// Windows shortcuts are always Ctrl+Shift so plain Ctrl keys reach the shell; macOS uses Cmd, some with Shift.
const shortcuts = {
  newTab: { code: 'KeyT', macShift: false },
  profiling: { code: 'KeyM', macShift: true },
};

// Zoom and settings take plain Ctrl and match the typed character with any Shift: `=` is Shift+0 on the Italian layout.
const characterShortcuts: Partial<
  Record<string, 'zoomIn' | 'zoomOut' | 'zoomReset' | 'settings'>
> = {
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  '0': 'zoomReset',
  ',': 'settings',
};

const appShortcut = (e: KeyboardEvent, mac: boolean) => {
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!command || e.altKey) return;
  return (
    characterShortcuts[e.key] ??
    (Object.keys(shortcuts) as (keyof typeof shortcuts)[]).find(
      (name) =>
        e.code === shortcuts[name].code &&
        e.shiftKey === (mac ? shortcuts[name].macShift : true),
    )
  );
};

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
      if (!shortcut) return;
      e.preventDefault();
      if (shortcut === 'profiling') setProfiling((p) => !p);
      else if (shortcut === 'settings') backend.openSettings();
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
        {tabs.length > 0 && (
          <section aria-labelledby="unsaved-heading">
            <h2 id="unsaved-heading" className="group">
              Unsaved
            </h2>
            <ul>
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    className="row"
                    aria-current={tab.id === active || undefined}
                    onClick={() => setActive(tab.id)}
                  >
                    {shellLabel(tab.shell)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </nav>
      <main className="terminals">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            term={terms.current.get(tab.id)!}
            options={options}
            active={tab.id === active}
          />
        ))}
      </main>
      <ProfilingPanel profiler={backend} open={profiling} />
    </div>
  );
}
