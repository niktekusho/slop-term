import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import {
  defaultSettings,
  type HostKeyQuestion,
  type SessionTree,
  type Settings,
  type Shell,
} from '../shared/ipc.ts';
import { FakeBackend } from './fake-backend.ts';

function setup({
  mac = false,
  shells,
  settings,
  tree,
}: {
  mac?: boolean;
  shells?: Shell[];
  settings?: Partial<Settings>;
  tree?: Partial<SessionTree>;
} = {}) {
  const backend = new FakeBackend();
  if (shells) backend.shells = shells;
  if (settings) backend.savedSettings = { ...defaultSettings, ...settings };
  if (tree) backend.tree = { ...backend.tree, ...tree };
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

const written = (backend: FakeBackend) =>
  backend
    .sent('write')
    .map(([, data]) => data)
    .join('');

describe('clipboard', () => {
  it('pastes a single line with Ctrl+Shift+V without asking', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await navigator.clipboard.writeText('ls -la');
    await user.keyboard('{Control>}{Shift>}V{/Shift}{/Control}');
    await vi.waitFor(() => expect(written(backend)).toBe('ls -la'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before pasting several lines and pastes them on Paste', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await navigator.clipboard.writeText('cd /tmp\nrm -rf *');
    await user.keyboard('{Control>}{Shift>}V{/Shift}{/Control}');
    const question = await screen.findByRole('alertdialog');
    expect(question).toHaveTextContent(
      'Paste 2 lines? Each line may run as a command.',
    );
    expect(written(backend)).toBe('');
    await user.click(within(question).getByRole('button', { name: 'Paste' }));
    await vi.waitFor(() => expect(written(backend)).toBe('cd /tmp\rrm -rf *'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('sends nothing on Cancel, which has the focus', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await navigator.clipboard.writeText('a\nb\nc');
    await user.keyboard('{Control>}{Shift>}V{/Shift}{/Control}');
    const cancel = within(await screen.findByRole('alertdialog')).getByRole(
      'button',
      { name: 'Cancel' },
    );
    expect(cancel).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(written(backend)).toBe('');
  });

  it('pastes on right-click, asking for line breaks', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await navigator.clipboard.writeText('make\ntest');
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('main').querySelector('.terminal')!,
    });
    await screen.findByRole('alertdialog');
    expect(written(backend)).toBe('');
  });

  it('asks before a paste from the Edit menu or the system', async () => {
    const { backend, newLocalShell } = setup();
    await newLocalShell('zsh');
    fireEvent.paste(document.activeElement!, {
      clipboardData: { getData: () => 'one\ntwo' },
    });
    await screen.findByRole('alertdialog');
    expect(written(backend)).toBe('');
  });

  it('pastes with Cmd+V on macOS', async () => {
    const { backend, user, newLocalShell } = setup({ mac: true });
    await newLocalShell('zsh');
    await navigator.clipboard.writeText('pwd');
    await user.keyboard('{Meta>}v{/Meta}');
    await vi.waitFor(() => expect(written(backend)).toBe('pwd'));
  });

  it('sends plain Ctrl+C to the shell', async () => {
    const { backend, newLocalShell } = setup();
    await newLocalShell('zsh');
    // xterm reads `keyCode` for Ctrl+letter, which user-event leaves at 0.
    fireEvent.keyDown(document.activeElement!, {
      key: 'c',
      code: 'KeyC',
      keyCode: 67,
      ctrlKey: true,
    });
    expect(written(backend)).toBe('\x03');
  });

  it('asks for a single line that ends in a line break', async () => {
    const { user, newLocalShell } = setup();
    await newLocalShell('zsh');
    await navigator.clipboard.writeText('reboot\r\n');
    await user.keyboard('{Control>}{Shift>}V{/Shift}{/Control}');
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Paste 1 line? Each line may run as a command.',
    );
  });
});

describe('find', () => {
  async function shellWithOutput(mac = false) {
    const s = setup({ mac });
    await s.newLocalShell('zsh');
    act(() =>
      s.backend.emit({
        type: 'output',
        tab: 'tab-1',
        data: 'alpha needle omega\r\n',
      }),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole('main')).toHaveTextContent('needle'),
    );
    return s;
  }

  it('selects the match, which Ctrl+Shift+C copies after Escape', async () => {
    const { user } = await shellWithOutput();
    await user.keyboard('{Control>}{Shift>}F{/Shift}{/Control}');
    await user.type(screen.getByRole('searchbox', { name: 'Find' }), 'needle');
    await user.keyboard('{Enter}{Escape}');
    expect(screen.queryByRole('searchbox', { name: 'Find' })).toBeNull();
    await user.keyboard('{Control>}{Shift>}C{/Shift}{/Control}');
    expect(await navigator.clipboard.readText()).toBe('needle');
  });

  it('opens with Cmd+F on macOS and says when nothing matches', async () => {
    const { user } = await shellWithOutput(true);
    await user.keyboard('{Meta>}f{/Meta}');
    await user.type(screen.getByRole('searchbox', { name: 'Find' }), 'nothere');
    expect(screen.getByText('No results')).toBeInTheDocument();
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
const rowTexts = () =>
  [...tree().querySelectorAll('.row')].map((row) => row.textContent);
const row = (name: string) =>
  [...tree().querySelectorAll<HTMLElement>('.row')].find(
    (r) => r.textContent === name,
  )!;
const filterBox = () => screen.getByRole('searchbox', { name: 'Filter' });

const sampleTree: Partial<SessionTree> = {
  folders: ['Work', 'Home', 'Work/Production', 'Work/Empty'],
  sessions: [
    { alias: 'web-prod', folder: 'Work/Production' },
    { alias: 'api', folder: 'Work' },
    { alias: 'nas', folder: 'Home' },
    { alias: 'loose' },
    { alias: 'db-prod', folder: 'Work/Production' },
    { alias: 'adhoc' },
  ],
  handWritten: ['old-backup', 'jenkins'],
};

describe('Session tree', () => {
  it('orders Unsaved Tabs, Hand-written hosts, loose hosts, then folders', async () => {
    const { newLocalShell } = setup({ tree: sampleTree });
    await newLocalShell('zsh');
    expect(rowTexts()).toEqual([
      'zsh',
      'jenkins',
      'old-backup',
      'adhoc',
      'loose',
      'Home',
      'nas',
      'Work',
      'Empty',
      'Production',
      'db-prod',
      'web-prod',
      'api',
    ]);
    expect(
      within(unsaved()!).getByText('old-backup', { exact: false }),
    ).toBeInTheDocument();
  });

  it('shows the Unsaved group for Hand-written hosts with no Tabs open', async () => {
    setup({ tree: { handWritten: ['jenkins'] } });
    await vi.waitFor(() =>
      expect(within(unsaved()!).getByText('jenkins')).toBeInTheDocument(),
    );
  });

  it('draws each row shape', async () => {
    setup({ tree: sampleTree });
    await vi.waitFor(() => expect(row('db-prod')).toBeDefined());

    const handWritten = row('jenkins');
    expect(
      within(handWritten).getByTitle('Hand-written host, read-only'),
    ).toBeInTheDocument();
    expect(handWritten.querySelector('.edge.ssh')).not.toBeNull();

    const saved = row('db-prod');
    expect(saved.querySelector('.edge.ssh')).not.toBeNull();
    expect(
      within(saved).queryByTitle('Hand-written host, read-only'),
    ).toBeNull();
    expect(saved.style.getPropertyValue('--depth')).toBe('2');

    const folder = row('Production');
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    expect(folder.querySelector('.chevron')).not.toBeNull();
    expect(folder.querySelector('.folder-icon')).not.toBeNull();
    expect(folder.querySelector('.edge')).toBeNull();
    expect(folder.style.getPropertyValue('--depth')).toBe('1');
  });

  it('collapses and expands a folder', async () => {
    const { user } = setup({ tree: sampleTree });
    await vi.waitFor(() => expect(row('Home')).toBeDefined());
    await user.click(row('Home'));
    expect(row('Home')).toHaveAttribute('aria-expanded', 'false');
    expect(rowTexts()).not.toContain('nas');
    await user.click(row('Home'));
    expect(rowTexts()).toContain('nas');
  });

  it('narrows the tree by name', async () => {
    const { user } = setup({ tree: sampleTree });
    await vi.waitFor(() => expect(row('Home')).toBeDefined());
    await user.type(filterBox(), 'PROD');
    expect(rowTexts()).toEqual(['Work', 'Production', 'db-prod', 'web-prod']);
    expect(unsaved()).toBeNull();
  });

  it('focuses the filter with Ctrl+Shift+O on Windows and Cmd+Shift+O on macOS', async () => {
    const { user } = setup();
    await user.keyboard('{Control>}{Shift>}O{/Shift}{/Control}');
    expect(filterBox()).toHaveFocus();
    cleanup();

    const mac = setup({ mac: true });
    await mac.user.keyboard('{Meta>}{Shift>}O{/Shift}{/Meta}');
    expect(filterBox()).toHaveFocus();
  });

  it('reloads when the back end sends a new tree', async () => {
    const { backend } = setup({ tree: sampleTree });
    await vi.waitFor(() => expect(row('Home')).toBeDefined());
    act(() =>
      backend.emit({
        type: 'tree',
        tree: {
          folders: [],
          sessions: [{ alias: 'db' }],
          handWritten: [],
          warnings: ['Match blocks in ~/.ssh/config are ignored'],
        },
      }),
    );
    expect(rowTexts()).toEqual(['db']);
    expect(tree()).toHaveTextContent(
      'Match blocks in ~/.ssh/config are ignored',
    );
  });
});

describe('Tabs in the tree', () => {
  async function openHosts(aliases: string[], options = {}) {
    const app = setup({
      tree: { sessions: aliases.map((alias) => ({ alias })) },
      ...options,
    });
    await vi.waitFor(() => expect(row(aliases[0])).toBeDefined());
    return app;
  }
  const update = (backend: FakeBackend, tab: string, change: object) =>
    act(() => backend.emit({ type: 'tab', tab, ...change } as never));

  it('lists each Tab under its Saved session, opened by double-click or +', async () => {
    const { backend, user } = await openHosts(['db', 'web']);
    await user.dblClick(row('db'));
    await user.click(
      screen.getByRole('button', { name: 'Open another Tab of db' }),
    );
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(2));
    update(backend, 'tab-1', { folder: '/var/log' });
    update(backend, 'tab-2', { title: 'htop' });

    expect(rowTexts()).toEqual(['db', 'log', 'htop', 'web']);
    expect(row('log').querySelector('.edge')).toBeNull();
    expect(row('log').style.getPropertyValue('--depth')).toBe('1');
    expect(row('htop')).toHaveAttribute('aria-current', 'true');
    await user.click(row('log'));
    expect(row('log')).toHaveAttribute('aria-current', 'true');
  });

  it('shows the folder, then the title in grey unless it only names the shell', async () => {
    const { backend, user } = await openHosts(['db']);
    await user.dblClick(row('db'));
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
    update(backend, 'tab-1', { folder: '/srv/my%app' });
    update(backend, 'tab-1', { title: 'vim notes.md' });
    expect(
      row('my%app vim notes.md').querySelector('.detail'),
    ).toHaveTextContent('vim notes.md');
    update(backend, 'tab-1', {
      title: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });
    expect(rowTexts()).toEqual(['db', 'my%app']);
    update(backend, 'tab-1', { title: '-bash' });
    expect(rowTexts()).toEqual(['db', 'my%app']);
    update(backend, 'tab-1', { folder: '/' });
    expect(rowTexts()).toEqual(['db', '/']);
  });

  it('shows the shell and its folder for an unsaved Tab', async () => {
    const { backend, newLocalShell } = setup();
    await newLocalShell('zsh');
    update(backend, 'tab-1', { folder: '/Users/me/src' });
    expect(
      within(unsaved()!).getByRole('button', { name: 'zsh src' }),
    ).toBeInTheDocument();
  });

  it('numbers Tabs 1 to 9 in tree order with a keycap naming the shortcut', async () => {
    const { backend, user, newLocalShell } = await openHosts([
      'b-host',
      'a-host',
    ]);
    await user.dblClick(row('b-host'));
    await user.dblClick(row('a-host'));
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(2));
    for (let i = 0; i < 8; i++) await newLocalShell('zsh');
    update(backend, 'tab-1', { folder: '/b-dir' });
    update(backend, 'tab-2', { folder: '/a-dir' });

    const keycaps = [...tree().querySelectorAll('.keycap')];
    expect(keycaps.map((k) => k.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
    expect(keycaps[0]).toHaveAttribute('title', 'Ctrl+Shift+1');
    // The 8 unsaved Tabs come first, then a-host's Tab, then b-host's.
    expect(
      row('a-dir').parentElement!.querySelector('.keycap'),
    ).toHaveTextContent('9');
    expect(row('a-dir')).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+9',
    );
    expect(row('b-dir').parentElement!.querySelector('.keycap')).toBeNull();
  });

  it('names Cmd+N in the keycap tooltip on macOS', async () => {
    const { newLocalShell } = setup({ mac: true });
    await newLocalShell('zsh');
    expect(tree().querySelector('.keycap')).toHaveAttribute('title', 'Cmd+1');
  });

  it("names the active Tab's session and user@host in the header bar", async () => {
    const { backend, user, newLocalShell } = await openHosts(['db']);
    await user.dblClick(row('db'));
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
    update(backend, 'tab-1', { address: 'me@db.lan' });
    expect(screen.getByRole('banner')).toHaveTextContent('dbme@db.lan');

    await newLocalShell('bash');
    expect(screen.getByRole('banner')).toHaveTextContent('bashlocal shell');
  });
});

describe('exit rule', () => {
  it('keeps a Tab that exits with a non-zero code until R restarts it', async () => {
    const { backend, user, newLocalShell } = setup();
    await newLocalShell('zsh');
    act(() => backend.emit({ type: 'tab', tab: 'tab-1', folder: '/src' }));
    act(() => backend.emit({ type: 'exit', tab: 'tab-1', code: 2 }));

    expect(row('zsh src exit 2').querySelector('.exit-icon')).not.toBeNull();
    await vi.waitFor(() =>
      expect(screen.getByRole('main')).toHaveTextContent(
        'process exited with code 2',
      ),
    );
    await user.keyboard('x');
    expect(written(backend)).toBe('');
    expect(backend.sent('close')).toEqual([]);

    await user.keyboard('R');
    expect(backend.sent('restart')).toEqual([['tab-1']]);
    expect(row('zsh src').querySelector('.exit-icon')).toBeNull();
    await user.keyboard('ls');
    expect(written(backend)).toBe('ls');
  });

  it('closes the Tab on exit code 0', async () => {
    const { backend, newLocalShell } = setup();
    await newLocalShell('zsh');
    act(() => backend.emit({ type: 'exit', tab: 'tab-1', code: 0 }));
    expect(backend.sent('close')).toEqual([['tab-1']]);
    expect(rowTexts()).toEqual([]);
  });
});

describe('Tab shortcuts', () => {
  // b-host opens first, but a-host's Tab comes first in the tree.
  async function twoHosts(mac = false) {
    const app = setup({
      mac,
      tree: { sessions: [{ alias: 'b-host' }, { alias: 'a-host' }] },
    });
    await vi.waitFor(() => expect(row('a-host')).toBeDefined());
    await app.user.dblClick(row('b-host'));
    await app.user.dblClick(row('a-host'));
    await vi.waitFor(() => expect(header()).toHaveTextContent('a-host'));
    return app;
  }
  const header = () => screen.getByRole('banner');
  const press = (init: KeyboardEventInit) =>
    fireEvent.keyDown(document.activeElement ?? document.body, init);

  it('cycles in tree order with Ctrl+Tab and Ctrl+Shift+Tab', async () => {
    const { user } = await twoHosts();
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(header()).toHaveTextContent('b-host');
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(header()).toHaveTextContent('a-host');
    await user.keyboard('{Control>}{Shift>}{Tab}{/Shift}{/Control}');
    expect(header()).toHaveTextContent('b-host');
  });

  it('cycles with Cmd+Option+arrows and Ctrl+Tab on macOS', async () => {
    const { user } = await twoHosts(true);
    await user.keyboard('{Meta>}{Alt>}{ArrowRight}{/Alt}{/Meta}');
    expect(header()).toHaveTextContent('b-host');
    await user.keyboard('{Meta>}{Alt>}{ArrowLeft}{/Alt}{/Meta}');
    expect(header()).toHaveTextContent('a-host');
    await user.keyboard('{Control>}{Tab}{/Control}');
    expect(header()).toHaveTextContent('b-host');
  });

  it('goes to the Nth Tab by the physical digit key on an Italian layout', async () => {
    await twoHosts();
    // Shift+2 types " on the Italian layout.
    press({ key: '"', code: 'Digit2', ctrlKey: true, shiftKey: true });
    expect(header()).toHaveTextContent('b-host');
    press({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(header()).toHaveTextContent('a-host');
    press({ key: '£', code: 'Digit3', ctrlKey: true, shiftKey: true });
    expect(header()).toHaveTextContent('a-host');
  });

  it('goes to the Nth Tab with Cmd+N on macOS', async () => {
    const { user } = await twoHosts(true);
    await user.keyboard('{Meta>}2{/Meta}');
    expect(header()).toHaveTextContent('b-host');
  });

  it('duplicates the active Tab with Ctrl+Shift+D and Cmd+D', async () => {
    const { backend, user } = await twoHosts();
    await user.keyboard('{Control>}{Shift>}D{/Shift}{/Control}');
    await vi.waitFor(() =>
      expect(backend.sent('openSsh')).toEqual([
        ['b-host'],
        ['a-host'],
        ['a-host'],
      ]),
    );
    cleanup();

    const mac = setup({ mac: true });
    await mac.newLocalShell('bash');
    await mac.user.keyboard('{Meta>}d{/Meta}');
    await vi.waitFor(() =>
      expect(mac.backend.sent('openLocalShell')).toEqual([
        [{ kind: 'bash' }],
        [{ kind: 'bash' }],
      ]),
    );
  });

  it('closes the active Tab with Ctrl+Shift+W and moves to the next in tree order', async () => {
    const { backend, user } = await twoHosts();
    await user.keyboard('{Control>}{Shift>}W{/Shift}{/Control}');
    expect(backend.sent('close')).toEqual([['tab-2']]);
    expect(rowTexts()).toEqual(['a-host', 'b-host', 'b-host']);
    expect(header()).toHaveTextContent('b-host');
  });

  it('closes with Cmd+W on macOS', async () => {
    const { backend, user } = await twoHosts(true);
    await user.keyboard('{Meta>}w{/Meta}');
    expect(backend.sent('close')).toEqual([['tab-2']]);
  });

  it('sends plain Ctrl+D and Ctrl+W to the shell', async () => {
    const { backend } = await twoHosts();
    press({ key: 'd', code: 'KeyD', keyCode: 68, ctrlKey: true });
    press({ key: 'w', code: 'KeyW', keyCode: 87, ctrlKey: true });
    expect(written(backend)).toBe('\x04\x17');
    expect(backend.sent('close')).toEqual([]);
    expect(backend.sent('openSsh')).toHaveLength(2);
  });
});

describe('SSH Tab', () => {
  const unknown = {
    kind: 'unknown',
    alias: 'db',
    host: 'db.lan:2222',
    type: 'ssh-ed25519',
    fingerprint: 'SHA256:0QEMcQoudiF1gfSwRovJ4zXT3DFnOdU0sUHbHd1W/Z0',
  } as const;
  const changed = {
    ...unknown,
    kind: 'changed',
    old: {
      fingerprint: 'SHA256:J7OKCL/fk2lquQc2R3Zj6rMw2k1+4DV2Mgx9g/DBk+E',
      file: '/home/me/.ssh/known_hosts',
      line: 7,
    },
  } as const;

  async function openDb(question?: HostKeyQuestion) {
    const app = setup({ tree: { sessions: [{ alias: 'db' }] } });
    await vi.waitFor(() => expect(row('db')).toBeDefined());
    await app.user.dblClick(row('db'));
    await vi.waitFor(() =>
      expect(app.backend.sent('openSsh')).toEqual([['db']]),
    );
    if (question)
      act(() => app.backend.emit({ type: 'hostKey', tab: 'tab-1', question }));
    return app;
  }
  const button = (name: string) => screen.getByRole('button', { name });

  it('opens a host from the tree as an active Tab', async () => {
    await openDb();
    await vi.waitFor(() => expect(rowTexts()).toEqual(['db', 'db']));
    const tab = tree().querySelector('.tab > .row');
    expect(tab).toHaveAttribute('aria-current', 'true');
    expect(unsaved()).toBeNull();
  });

  it('asks about an unknown host inside the Tab with Cancel as the default', async () => {
    const { backend, user } = await openDb(unknown);
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('db.lan:2222');
    expect(main).toHaveTextContent('ssh-ed25519');
    expect(main).toHaveTextContent(unknown.fingerprint);
    expect(screen.queryByRole('button', { name: /once/i })).toBeNull();
    expect(button('Cancel')).toHaveFocus();

    await user.click(button('Trust and connect'));
    expect(backend.sent('answerHostKey')).toEqual([['tab-1', true]]);
    expect(
      screen.queryByRole('button', { name: 'Trust and connect' }),
    ).toBeNull();
  });

  it('cancels with Enter on the default button', async () => {
    const { backend, user } = await openDb(unknown);
    await user.keyboard('{Enter}');
    expect(backend.sent('answerHostKey')).toEqual([['tab-1', false]]);
  });

  it('drops the question when the connection closes first', async () => {
    const { backend } = await openDb(unknown);
    act(() => backend.emit({ type: 'hostKey', tab: 'tab-1' }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(backend.sent('answerHostKey')).toEqual([]);
  });

  it('names a key type already saved for the host', async () => {
    await openDb({ ...unknown, savedType: 'ssh-rsa' });
    expect(screen.getByRole('main')).toHaveTextContent(
      'A ssh-rsa key for this host is already saved',
    );
  });

  it('blocks a changed key until the user confirms the replacement', async () => {
    const { backend, user } = await openDb(changed);
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(changed.old.fingerprint);
    expect(warning).toHaveTextContent(changed.fingerprint);
    expect(warning).toHaveTextContent('/home/me/.ssh/known_hosts, line 7');
    expect(button('Cancel')).toHaveFocus();

    await user.click(button('Replace saved key'));
    expect(backend.sent('answerHostKey')).toEqual([]);
    expect(button('Cancel')).toHaveFocus();
    await user.click(button('Cancel'));
    expect(backend.sent('answerHostKey')).toEqual([]);

    await user.click(button('Replace saved key'));
    await user.click(button('Replace'));
    expect(backend.sent('answerHostKey')).toEqual([['tab-1', true]]);
  });
});
