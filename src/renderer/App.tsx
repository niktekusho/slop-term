import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import type { BackendClient, Shell, TabId } from '../shared/ipc.ts';
import { TerminalView } from './TerminalView.tsx';
import { ProfilingPanel } from './ProfilingPanel.tsx';

type Tab = { id: TabId; shell: Shell };

const shellLabel = (shell: Shell) =>
  shell.kind === 'wsl' ? `wsl: ${shell.distro}` : shell.kind;

// Windows shortcuts are always Ctrl+Shift so plain Ctrl keys reach the shell; macOS uses Cmd, some with Shift.
const shortcuts = {
  newTab: { code: 'KeyT', macShift: false },
  profiling: { code: 'KeyM', macShift: true },
};

const appShortcut = (e: KeyboardEvent, mac: boolean) =>
  (Object.keys(shortcuts) as (keyof typeof shortcuts)[]).find((name) => {
    const { code, macShift } = shortcuts[name];
    return (
      e.code === code &&
      !e.altKey &&
      (mac
        ? e.metaKey && !e.ctrlKey && e.shiftKey === macShift
        : e.ctrlKey && e.shiftKey && !e.metaKey)
    );
  });

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
  const terms = useRef(new Map<TabId, Terminal>());

  useEffect(() => {
    backend.listShells().then(setShells);
  }, [backend]);

  useEffect(
    () =>
      backend.onEvent((event) => {
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
      const term = new Terminal({ scrollback: 1000 });
      term.attachCustomKeyEventHandler((e) => !appShortcut(e, mac));
      term.onData((data) => backend.write(id, data));
      term.onResize((size) => backend.resize(id, size));
      terms.current.set(id, term);
      setTabs((tabs) => [...tabs, { id, shell }]);
      setActive(id);
    },
    [backend, mac],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = appShortcut(e, mac);
      if (shortcut === 'profiling') {
        e.preventDefault();
        setProfiling((p) => !p);
      } else if (shortcut === 'newTab' && shells[0]) {
        e.preventDefault();
        open(shells[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mac, shells, open]);

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
            active={tab.id === active}
          />
        ))}
      </main>
      <ProfilingPanel profiler={backend} open={profiling} />
    </div>
  );
}
