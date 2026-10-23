import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { defaultSettings, type Settings, type Shell } from '../shared/ipc.ts';
import { FakeBackend } from './fake-backend.ts';

function setup({
  mac = false,
  shells,
  settings,
}: { mac?: boolean; shells?: Shell[]; settings?: Partial<Settings> } = {}) {
  const backend = new FakeBackend();
  if (shells) backend.shells = shells;
  if (settings) backend.savedSettings = { ...defaultSettings, ...settings };
  const user = userEvent.setup();
  render(<App backend={backend} mac={mac} />);
  return {
    backend,
    user,
    async newLocalShell(name: string) {
      await user.click(screen.getByRole('button', { name: 'New local shell' }));
      await user.click(screen.getByRole('menuitem', { name }));
    },
    shellsListed: () =>
      vi.waitFor(() => expect(backend.sent('listShells')).toHaveLength(1)),
  };
}

const tree = () => screen.getByRole('navigation', { name: 'Session tree' });
const unsaved = () => within(tree()).queryByRole('region', { name: 'Unsaved' });

describe('New local shell', () => {
  it('lists the shells this machine has, labelled by shell', async () => {
    const { user } = setup({
      shells: [
        { kind: 'pwsh' },
        { kind: 'cmd' },
        { kind: 'wsl', distro: 'Ubuntu' },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'New local shell' }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['pwsh', 'cmd', 'wsl: Ubuntu']);
  });

  it('opens an unsaved Tab in the Unsaved group', async () => {
    const { backend, newLocalShell } = setup();
    expect(unsaved()).toBeNull();
    await newLocalShell('bash');

    expect(backend.sent('openLocalShell')).toEqual([[{ kind: 'bash' }]]);
    expect(screen.queryByRole('menu')).toBeNull();
    const group = unsaved()!;
    expect(within(group).getByRole('button', { name: 'bash' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('removes the group when its last Tab exits', async () => {
    const { backend, newLocalShell } = setup();
    await newLocalShell('zsh');
    expect(unsaved()).not.toBeNull();

    act(() => backend.emit({ type: 'exit', tab: 'tab-1', code: 0 }));
    expect(unsaved()).toBeNull();
  });

  it('switches Tabs from the tree', async () => {
    const { user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await newLocalShell('bash');
    const zsh = within(unsaved()!).getByRole('button', { name: 'zsh' });
    await user.click(zsh);
    expect(zsh).toHaveAttribute('aria-current', 'true');
    expect(
      within(unsaved()!).getByRole('button', { name: 'bash' }),
    ).not.toHaveAttribute('aria-current');
  });
});

describe('New Tab shortcut', () => {
  it('opens the default shell with Ctrl+Shift+T on Windows', async () => {
    const { backend, user, shellsListed } = setup({
      shells: [{ kind: 'pwsh' }, { kind: 'cmd' }],
    });
    await shellsListed();
    await user.keyboard('{Control>}{Shift>}T{/Shift}{/Control}');
    await vi.waitFor(() =>
      expect(backend.sent('openLocalShell')).toEqual([[{ kind: 'pwsh' }]]),
    );
  });

  it('opens the default shell with Cmd+T on macOS', async () => {
    const { backend, user, shellsListed } = setup({ mac: true });
    await shellsListed();
    await user.keyboard('{Meta>}t{/Meta}');
    await vi.waitFor(() =>
      expect(backend.sent('openLocalShell')).toEqual([[{ kind: 'zsh' }]]),
    );
  });

  it('leaves Ctrl+T to the shell on macOS', async () => {
    const { backend, user, shellsListed } = setup({ mac: true });
    await shellsListed();
    await user.keyboard('{Control>}t{/Control}');
    expect(backend.sent('openLocalShell')).toEqual([]);
  });
});

describe('terminal', () => {
  it('sends typed keys to the active Tab', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await user.keyboard('ls');
    expect(
      backend
        .sent('write')
        .map(([, data]) => data)
        .join(''),
    ).toBe('ls');
    expect(backend.sent('write').every(([tab]) => tab === 'tab-1')).toBe(true);
  });

  it('shows the shell output', async () => {
    const { backend, newLocalShell } = setup();
    await newLocalShell('zsh');
    act(() =>
      backend.emit({ type: 'output', tab: 'tab-1', data: 'hello-slop' }),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole('main')).toHaveTextContent('hello-slop'),
    );
  });
});

const os = { dark: false, listeners: new Set<() => void>() };
function setOsDark(dark: boolean) {
  os.dark = dark;
  for (const listener of os.listeners) listener();
}
const terminalStyles = () =>
  [...screen.getByRole('main').querySelectorAll('style')]
    .map((style) => style.textContent)
    .join('');
const colorScheme = () => document.documentElement.style.colorScheme;

describe('theme', () => {
  beforeEach(() => {
    os.dark = false;
    os.listeners.clear();
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (media) =>
        ({
          get matches() {
            return media === '(prefers-color-scheme: dark)' && os.dark;
          },
          addEventListener: (_: string, l: () => void) => os.listeners.add(l),
          removeEventListener: (_: string, l: () => void) =>
            os.listeners.delete(l),
          addListener() {},
          removeListener() {},
        }) as unknown as MediaQueryList,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows the OS light or dark mode', async () => {
    const { newLocalShell } = setup();
    await newLocalShell('zsh');
    expect(colorScheme()).toBe('light');
    expect(terminalStyles()).toContain('#1f2328');

    act(() => setOsDark(true));
    expect(colorScheme()).toBe('dark');
    expect(terminalStyles()).toContain('#e6edf3');
  });

  it('uses the mode that settings force, whatever the OS mode', async () => {
    const { backend, newLocalShell } = setup();
    setOsDark(true);
    await newLocalShell('zsh');
    act(() =>
      backend.emit({
        type: 'settings',
        settings: { ...defaultSettings, theme: 'light' },
      }),
    );
    expect(colorScheme()).toBe('light');
    expect(terminalStyles()).toContain('#1f2328');
    expect(backend.theme).toBe('light');

    act(() => setOsDark(false));
    act(() => setOsDark(true));
    expect(colorScheme()).toBe('light');
  });
});

const savedSizes = (backend: FakeBackend) =>
  backend.sent('updateSettings').map(([patch]) => patch.fontSize);

describe('zoom', () => {
  it('zooms in with Ctrl+= or Ctrl++ and saves the new size', async () => {
    const { backend, user } = setup();
    await user.keyboard('{Control>}={/Control}');
    await user.keyboard('{Control>}+{/Control}');
    expect(savedSizes(backend)).toEqual([13, 14]);
  });

  it('zooms out with Ctrl+- and resets with Ctrl+0', async () => {
    const { backend, user } = setup({ settings: { fontSize: 15 } });
    await vi.waitFor(() => expect(backend.zoom).toBe(1.25));
    await user.keyboard('{Control>}-{/Control}');
    await user.keyboard('{Control>}0{/Control}');
    expect(savedSizes(backend)).toEqual([14, 12]);
  });

  it('applies the saved size to the whole window', async () => {
    const { backend } = setup({ settings: { fontSize: 18 } });
    await vi.waitFor(() => expect(backend.zoom).toBe(1.5));
  });

  it('zooms with Ctrl+wheel and scrolls with the plain wheel', async () => {
    const { backend } = setup();
    fireEvent.wheel(document.body, { deltaY: -100, ctrlKey: true });
    fireEvent.wheel(document.body, { deltaY: 100 });
    await vi.waitFor(() => expect(savedSizes(backend)).toEqual([13]));
  });

  it('zooms with Cmd on macOS, not Ctrl', async () => {
    const { backend, user } = setup({ mac: true });
    await user.keyboard('{Meta>}={/Meta}');
    await user.keyboard('{Control>}={/Control}');
    expect(savedSizes(backend)).toEqual([13]);
  });

  it('keeps the zoom keys away from the shell', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await user.keyboard('{Control>}-{/Control}');
    expect(backend.sent('write')).toEqual([]);
  });
});

describe('settings file', () => {
  it('opens with Ctrl+, on Windows', async () => {
    const { backend, user } = setup();
    await user.keyboard('{Control>},{/Control}');
    expect(backend.sent('openSettings')).toHaveLength(1);
  });

  it('opens with Cmd+, on macOS', async () => {
    const { backend, user } = setup({ mac: true });
    await user.keyboard('{Meta>},{/Meta}');
    expect(backend.sent('openSettings')).toHaveLength(1);
  });
});

const panel = () => screen.queryByRole('region', { name: 'Profiling' });
const panelRows = () =>
  within(panel()!)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );
const traceButton = (name: 'Record trace' | 'Stop and save trace') =>
  within(panel()!).getByRole('button', { name });
const togglePanel = '{Control>}{Shift>}M{/Shift}{/Control}';

describe('Profiling panel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens and closes with Ctrl+Shift+M on Windows', async () => {
    const { user } = setup();
    expect(panel()).toBeNull();
    await user.keyboard(togglePanel);
    expect(panel()).not.toBeNull();
    await user.keyboard(togglePanel);
    expect(panel()).toBeNull();
  });

  it('opens with Cmd+Shift+M on macOS', async () => {
    const { user } = setup({ mac: true });
    await user.keyboard('{Meta>}{Shift>}M{/Shift}{/Meta}');
    expect(panel()).not.toBeNull();
  });

  it('keeps the shortcut away from the shell', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await user.keyboard(togglePanel);
    expect(panel()).not.toBeNull();
    expect(backend.sent('write')).toEqual([]);
  });

  it('lists CPU and memory per process, refreshed every 2 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { backend, user } = setup();
    backend.processes = [
      { pid: 101, name: 'Browser', cpuPercent: 12.5, memoryKB: 153600 },
    ];
    await user.keyboard(togglePanel);
    await vi.waitFor(() =>
      expect(panelRows()).toEqual([['Browser', '101', '12.5 %', '150.0 MB']]),
    );

    backend.processes = [
      { pid: 101, name: 'Browser', cpuPercent: 3, memoryKB: 160000 },
      {
        pid: 102,
        name: 'Utility: slop-term back end',
        cpuPercent: 0,
        memoryKB: 51200,
      },
    ];
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(panelRows()).toEqual([
      ['Browser', '101', '3.0 %', '156.3 MB'],
      ['Utility: slop-term back end', '102', '0.0 %', '50.0 MB'],
    ]);
  });

  it('records a Chrome trace and saves it to the file the user picks', async () => {
    const { backend, user } = setup();
    await user.keyboard(togglePanel);
    await user.click(traceButton('Record trace'));
    expect(backend.tracing).toBe(true);

    await user.click(traceButton('Stop and save trace'));
    expect(backend.tracing).toBe(false);
    expect(panel()).toHaveTextContent('Saved to /tmp/slop-term-trace.json');
  });

  it('saves nothing when the user cancels the file picker', async () => {
    const { backend, user } = setup();
    backend.traceFile = undefined;
    await user.keyboard(togglePanel);
    await user.click(traceButton('Record trace'));
    await user.click(traceButton('Stop and save trace'));
    expect(panel()).not.toHaveTextContent('Saved to');
    expect(traceButton('Record trace')).toBeInTheDocument();
  });

  it('keeps recording while the panel is closed', async () => {
    const { user } = setup();
    await user.keyboard(togglePanel);
    await user.click(traceButton('Record trace'));
    await user.keyboard(togglePanel);
    await user.keyboard(togglePanel);
    expect(traceButton('Stop and save trace')).toBeInTheDocument();
  });
});
