import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteFile, SessionTree } from '../shared/ipc.ts';
import { App } from './App.tsx';
import { FakeBackend } from './fake-backend.ts';

const file = (name: string, extra: Partial<RemoteFile> = {}): RemoteFile => ({
  name,
  folder: false,
  size: 1200,
  modified: new Date(2026, 10, 9, 14, 32).getTime(),
  permissions: '-rw-r--r--',
  ...extra,
});
const folder = (name: string) =>
  file(name, { folder: true, size: 4096, permissions: 'drwxr-xr-x' });

const home = [
  file('notes.txt'),
  folder('src'),
  file('.profile', { size: 300 }),
  file('run.sh', { permissions: '-rwxr-xr-x', size: 10 }),
  folder('logs'),
  file('backup.tar.gz', { size: 3 * 1024 * 1024 }),
];

const pane = () => screen.getByRole('complementary', { name: 'SFTP pane' });
const files = () => within(pane()).getByRole('grid', { name: 'Files' });
const names = () =>
  within(files())
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.querySelector('.file-name')!.textContent);
const fileRow = (name: string) =>
  within(files())
    .getAllByRole('row')
    .find((r) => r.querySelector('.file-name')?.textContent === name)!;
const paneButton = (name: string) =>
  within(pane()).getByRole('button', { name });
const menuItem = (name: string) => screen.getByRole('menuitem', { name });

/** Opens SSH Tab `tab-1` of `db` and, unless `connect` is false, connects it as me@web1 with the home folder listed. */
async function setup({
  connect = true,
  mac = false,
  patch = {},
}: { connect?: boolean; mac?: boolean; patch?: Partial<SessionTree> } = {}) {
  const backend = new FakeBackend();
  backend.tree = { ...backend.tree, sessions: [{ alias: 'db' }], ...patch };
  backend.remote = {
    '/home/me': home,
    '/home/me/src': [file('main.c')],
    '/home/me/logs': [],
    '/home': [folder('me')],
    '/': [folder('home')],
    '/srv': [file('site.conf')],
  };
  const user = userEvent.setup();
  render(<App backend={backend} mac={mac} />);
  await user.dblClick(await screen.findByText('db'));
  await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
  if (connect) {
    act(() => {
      backend.emit({ type: 'tab', tab: 'tab-1', address: 'me@web1' });
      backend.emit({ type: 'connected', tab: 'tab-1' });
    });
    await vi.waitFor(() => expect(names()).toContain('notes.txt'));
  }
  return { backend, user };
}

const osc7 = (backend: FakeBackend, folder: string, host = 'web1') =>
  act(() =>
    backend.emit({
      type: 'tab',
      tab: 'tab-1',
      folder,
      host,
      firstHost: 'web1',
    }),
  );

describe('SFTP pane', () => {
  it('opens on the first show after the Tab connects, in the home folder, folders first', async () => {
    const { backend } = await setup();
    expect(backend.sent('listFiles')).toEqual([['tab-1', undefined]]);
    expect(within(pane()).getByRole('textbox', { name: 'Path' })).toHaveValue(
      '/home/me',
    );
    expect(names()).toEqual([
      'logs',
      'src',
      '.profile',
      'backup.tar.gz',
      'notes.txt',
      'run.sh',
    ]);
    expect(fileRow('notes.txt')).toHaveTextContent(
      'notes.txt1.2 KB2026-11-09 14:32-rw-r--r--',
    );
    expect(fileRow('.profile')).toHaveClass('hidden-file');
  });

  it("doesn't browse while collapsed, and opens the channel when the pane first shows", async () => {
    const { backend, user } = await setup({ connect: false });
    await user.click(paneButton('Collapse SFTP pane'));
    act(() => backend.emit({ type: 'connected', tab: 'tab-1' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(backend.sent('listFiles')).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'SFTP' }));
    await vi.waitFor(() => expect(names()).toContain('notes.txt'));
    expect(backend.sent('listFiles')).toEqual([['tab-1', undefined]]);
  });

  it('colours folders blue, executables green and archives red from the terminal palette', async () => {
    await setup();
    const colour = (name: string) =>
      (fileRow(name).querySelector('.file-name') as HTMLElement).style.color;
    // The light GitHub palette: jsdom reports no dark mode.
    expect(colour('src')).toBe('rgb(9, 105, 218)');
    expect(colour('run.sh')).toBe('rgb(17, 99, 41)');
    expect(colour('backup.tar.gz')).toBe('rgb(207, 34, 46)');
    expect(colour('notes.txt')).toBe('');
  });

  it('sorts by the clicked header, keeping folders first', async () => {
    const { user } = await setup();
    await user.click(within(files()).getByRole('button', { name: 'Size' }));
    expect(names()).toEqual([
      'logs',
      'src',
      'run.sh',
      '.profile',
      'notes.txt',
      'backup.tar.gz',
    ]);
    await user.click(within(files()).getByRole('button', { name: 'Size' }));
    expect(names()).toEqual([
      'src',
      'logs',
      'backup.tar.gz',
      'notes.txt',
      '.profile',
      'run.sh',
    ]);
  });

  it('hides hidden files with the toggle', async () => {
    const { user } = await setup();
    const toggle = paneButton('Show hidden files');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(names()).not.toContain('.profile');
  });

  it('goes up, disabled at /, goes where the path box says, and refreshes', async () => {
    const { backend, user } = await setup();
    await user.click(paneButton('Up'));
    await vi.waitFor(() => expect(names()).toEqual(['me']));
    await user.click(paneButton('Up'));
    await vi.waitFor(() => expect(names()).toEqual(['home']));
    expect(paneButton('Up')).toBeDisabled();
    const path = within(pane()).getByRole('textbox', { name: 'Path' });
    await user.clear(path);
    await user.type(path, '/srv{Enter}');
    await vi.waitFor(() => expect(names()).toEqual(['site.conf']));
    backend.remote['/srv'] = [file('site.conf'), file('new.conf')];
    await user.click(paneButton('Refresh'));
    await vi.waitFor(() => expect(names()).toContain('new.conf'));
  });

  it('shows the error and stays where it was when a path does not exist', async () => {
    const { user } = await setup();
    const path = within(pane()).getByRole('textbox', { name: 'Path' });
    await user.clear(path);
    await user.type(path, '/nowhere{Enter}');
    await vi.waitFor(() =>
      expect(within(pane()).getByRole('alert')).toHaveTextContent(
        'No such file: /nowhere',
      ),
    );
    expect(names()).toContain('notes.txt');
  });

  it('enters a folder on double-click', async () => {
    const { user } = await setup();
    await user.dblClick(fileRow('src'));
    await vi.waitFor(() => expect(names()).toEqual(['main.c']));
  });

  describe('Follow terminal', () => {
    it('moves with OSC 7, and stops with the amber banner while the terminal is on another host', async () => {
      const { backend, user } = await setup();
      const follow = paneButton('Follow terminal');
      expect(follow).toHaveAttribute('aria-pressed', 'true');
      osc7(backend, '/srv');
      await vi.waitFor(() => expect(names()).toEqual(['site.conf']));

      osc7(backend, '/home/me', 'db1');
      await vi.waitFor(() =>
        expect(within(pane()).getByRole('status')).toHaveTextContent(
          'Terminal is on db1. This pane shows web1.',
        ),
      );
      expect(follow).toHaveAttribute('aria-pressed', 'false');
      await new Promise((r) => setTimeout(r, 20));
      expect(names()).toEqual(['site.conf']);

      osc7(backend, '/home/me/src');
      await vi.waitFor(() => expect(names()).toEqual(['main.c']));
      expect(within(pane()).queryByRole('status')).toBeNull();
      expect(follow).toHaveAttribute('aria-pressed', 'true');
      await user.click(follow);
      osc7(backend, '/srv');
      await new Promise((r) => setTimeout(r, 20));
      expect(names()).toEqual(['main.c']);
    });

    it('starts in the folder the terminal reported before the pane first showed', async () => {
      const { backend } = await setup({ connect: false });
      osc7(backend, '/srv');
      act(() => backend.emit({ type: 'connected', tab: 'tab-1' }));
      await vi.waitFor(() => expect(names()).toEqual(['site.conf']));
      expect(backend.sent('listFiles')).toEqual([['tab-1', '/srv']]);
    });
  });

  describe('selection and menus', () => {
    it('selects with click, Ctrl-click and Shift-click', async () => {
      const { user } = await setup();
      await user.click(fileRow('logs'));
      await user.keyboard('{Shift>}');
      await user.click(fileRow('backup.tar.gz'));
      await user.keyboard('{/Shift}{Control>}');
      await user.click(fileRow('src'));
      await user.keyboard('{/Control}');
      const selected = within(files())
        .getAllByRole('row')
        .filter((r) => r.getAttribute('aria-selected') === 'true')
        .map((r) => r.querySelector('.file-name')!.textContent);
      expect(selected).toEqual(['logs', '.profile', 'backup.tar.gz']);
    });

    it('offers the actions for one row, and Delete N items with Rename disabled for several', async () => {
      const { user } = await setup();
      await user.pointer({ keys: '[MouseRight]', target: fileRow('src') });
      expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(
        ['Open', 'Download', 'Download to…', 'Rename', 'Delete'],
      );
      await user.keyboard('{Escape}');
      await user.pointer({
        keys: '[MouseRight]',
        target: fileRow('notes.txt'),
      });
      expect(menuItem('Open in editor')).toBeDisabled();
      expect(menuItem('Download')).toBeDisabled();
      expect(menuItem('Download to…')).toBeDisabled();
      await user.keyboard('{Escape}');

      await user.click(fileRow('notes.txt'));
      await user.keyboard('{Control>}');
      await user.click(fileRow('run.sh'));
      await user.keyboard('{/Control}');
      await user.pointer({ keys: '[MouseRight]', target: fileRow('run.sh') });
      expect(menuItem('Rename')).toBeDisabled();
      expect(menuItem('Download 2 items')).toBeDisabled();
      expect(menuItem('Delete 2 items')).toBeEnabled();
    });

    it('offers New folder, Upload files…, Refresh and Select all on empty space', async () => {
      const { user } = await setup();
      await user.pointer({
        keys: '[MouseRight]',
        target: pane().querySelector('.file-list')!,
      });
      expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(
        ['New folder', 'Upload files…', 'Refresh', 'Select all'],
      );
      expect(menuItem('Upload files…')).toBeDisabled();
      await user.click(menuItem('Select all'));
      expect(
        within(files())
          .getAllByRole('row')
          .filter((r) => r.getAttribute('aria-selected') === 'true'),
      ).toHaveLength(6);
    });
  });

  describe('inline names', () => {
    const nameField = () =>
      within(pane()).getByRole<HTMLInputElement>('textbox', { name: 'Name' });

    it('renames with the name selected without its extension, committing on Enter', async () => {
      const { backend, user } = await setup();
      await user.pointer({
        keys: '[MouseRight]',
        target: fileRow('notes.txt'),
      });
      await user.click(menuItem('Rename'));
      const field = nameField();
      expect(field).toHaveFocus();
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
      await user.keyboard('todo{Enter}');
      expect(backend.sent('renameFile')).toEqual([
        ['tab-1', '/home/me/notes.txt', '/home/me/todo.txt'],
      ]);
      await vi.waitFor(() => expect(names()).toContain('todo.txt'));
    });

    it('keeps the field open with a red border on an empty, taken or / name, and cancels on Esc', async () => {
      const { backend, user } = await setup();
      await user.click(fileRow('notes.txt'));
      await user.keyboard('{F2}');
      for (const bad of ['', 'run.sh', 'a/b', '..']) {
        await user.clear(nameField());
        if (bad) await user.type(nameField(), bad);
        await user.keyboard('{Enter}');
        expect(nameField()).toHaveAttribute('aria-invalid', 'true');
      }
      await user.click(paneButton('Refresh'));
      expect(nameField()).toHaveAttribute('aria-invalid', 'true');
      await user.click(nameField());
      await user.keyboard('{Escape}');
      expect(
        within(pane()).queryByRole('textbox', { name: 'Name' }),
      ).toBeNull();
      expect(backend.sent('renameFile')).toEqual([]);
    });

    it('commits on blur and creates a new folder from the empty-space menu', async () => {
      const { backend, user } = await setup();
      await user.pointer({
        keys: '[MouseRight]',
        target: pane().querySelector('.file-list')!,
      });
      await user.click(menuItem('New folder'));
      await user.clear(nameField());
      await user.type(nameField(), 'build');
      await user.click(paneButton('Up'));
      expect(backend.sent('makeFolder')).toEqual([['tab-1', '/home/me/build']]);
    });
  });

  describe('delete', () => {
    const confirm = () =>
      within(pane()).getByRole('alertdialog', { name: /^Delete/ });

    it('names one file, says SFTP has no trash, focuses Cancel and deletes on the red button', async () => {
      const { backend, user } = await setup();
      await user.pointer({
        keys: '[MouseRight]',
        target: fileRow('notes.txt'),
      });
      await user.click(menuItem('Delete'));
      expect(confirm()).toHaveAccessibleName('Delete notes.txt?');
      expect(confirm()).toHaveTextContent(
        "SFTP has no trash: deleted files can't be restored.",
      );
      expect(
        within(confirm()).getByRole('button', { name: 'Cancel' }),
      ).toHaveFocus();
      const button = within(confirm()).getByRole('button', { name: 'Delete' });
      expect(button).toHaveClass('danger');
      await user.click(button);
      expect(backend.sent('deleteFiles')).toEqual([
        ['tab-1', ['/home/me/notes.txt']],
      ]);
      await vi.waitFor(() => expect(names()).not.toContain('notes.txt'));
    });

    it('lists up to five items, counts the rest and states files and bytes per folder', async () => {
      const { backend, user } = await setup();
      backend.measures = {
        '/home/me/logs': { files: 12, bytes: 3_500_000 },
        '/home/me/src': { files: 1, bytes: 40 },
      };
      await user.click(fileRow('logs'));
      await user.keyboard('{Control>}a{/Control}{Delete}');
      expect(confirm()).toHaveAccessibleName('Delete 6 items?');
      await vi.waitFor(() =>
        expect(
          within(confirm())
            .getAllByRole('listitem')
            .map((i) => i.textContent),
        ).toEqual([
          'logs · 12 files, 3.3 MB',
          'src · 1 file, 40 B',
          '.profile',
          'backup.tar.gz',
          'notes.txt',
          'and 1 more',
        ]),
      );
      expect(backend.sent('measureFiles')).toEqual([
        ['tab-1', ['/home/me/logs', '/home/me/src']],
      ]);
    });

    it('deletes what it showed, though the pane follows the terminal elsewhere while it is open', async () => {
      const { backend, user } = await setup();
      await user.click(fileRow('notes.txt'));
      await user.keyboard('{Delete}');
      osc7(backend, '/srv');
      await vi.waitFor(() => expect(names()).toEqual(['site.conf']));
      await user.click(
        within(confirm()).getByRole('button', { name: 'Delete' }),
      );
      expect(backend.sent('deleteFiles')).toEqual([
        ['tab-1', ['/home/me/notes.txt']],
      ]);
    });
  });

  describe('keys', () => {
    it('act only while the file list has focus', async () => {
      const { backend, user } = await setup();
      await user.click(fileRow('notes.txt'));
      // The terminal takes the focus back, as a click in it would.
      act(() =>
        (document.querySelector('.terminal textarea') as HTMLElement).focus(),
      );
      await user.keyboard('{F2}{Delete}{Backspace}{F5}');
      expect(
        within(pane()).queryByRole('textbox', { name: 'Name' }),
      ).toBeNull();
      expect(within(pane()).queryByRole('alertdialog')).toBeNull();
      expect(backend.sent('listFiles')).toHaveLength(1);
    });

    it('open with Enter, go up with Backspace, select all with Ctrl+A and refresh with F5, with a hint bar while rows are selected', async () => {
      const { backend, user } = await setup();
      expect(within(pane()).queryByRole('note')).toBeNull();
      await user.click(fileRow('src'));
      expect(within(pane()).getByRole('note')).toHaveTextContent(
        'Enter Open · F2 Rename · Del Delete · ⌫ Up · Ctrl+A Select all · F5 Refresh · Right-click for more',
      );
      await user.keyboard('{Enter}');
      await vi.waitFor(() => expect(names()).toEqual(['main.c']));
      await user.keyboard('{Backspace}');
      await vi.waitFor(() => expect(names()).toContain('notes.txt'));
      await user.keyboard('{Control>}a{/Control}');
      expect(
        within(files())
          .getAllByRole('row')
          .filter((r) => r.getAttribute('aria-selected') === 'true'),
      ).toHaveLength(6);
      const before = backend.sent('listFiles').length;
      await user.keyboard('{F5}');
      expect(backend.sent('listFiles')).toHaveLength(before + 1);
    });

    it('take Cmd on macOS, where Cmd+Backspace deletes and Cmd+R refreshes', async () => {
      const { backend, user } = await setup({ mac: true });
      await user.click(fileRow('notes.txt'));
      expect(within(pane()).getByRole('note')).toHaveTextContent(
        'Enter Open · F2 Rename · ⌘⌫ Delete · ⌫ Up · ⌘A Select all · ⌘R Refresh · Right-click for more',
      );
      await user.keyboard('{Delete}');
      expect(within(pane()).queryByRole('alertdialog')).toBeNull();
      await user.keyboard('{Meta>}{Backspace}{/Meta}');
      expect(
        within(pane()).getByRole('alertdialog', { name: 'Delete notes.txt?' }),
      ).toBeDefined();
      await user.click(within(pane()).getByRole('button', { name: 'Cancel' }));
      await user.click(fileRow('notes.txt'));
      const before = backend.sent('listFiles').length;
      await user.keyboard('{Meta>}r{/Meta}');
      expect(backend.sent('listFiles')).toHaveLength(before + 1);
    });
  });

  it('greys out a dropped Tab with the red banner and reopens at its last folder after the reconnect', async () => {
    const { backend, user } = await setup();
    await user.dblClick(fileRow('src'));
    await vi.waitFor(() => expect(names()).toEqual(['main.c']));
    act(() =>
      backend.emit({
        type: 'dropped',
        tab: 'tab-1',
        reason: 'Keepalive timeout',
      }),
    );
    expect(within(pane()).getByRole('status')).toHaveTextContent(
      'Disconnected. Reconnect the Tab to browse again.',
    );
    expect(pane().querySelector('.file-list')).toHaveAttribute('inert');
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    act(() => backend.emit({ type: 'connected', tab: 'tab-1' }));
    await vi.waitFor(() =>
      expect(backend.sent('listFiles').at(-1)).toEqual([
        'tab-1',
        '/home/me/src',
      ]),
    );
    expect(within(pane()).queryByRole('status')).toBeNull();
  });

  it('shows "No remote host" and the ssh hint for a local shell Tab', async () => {
    const backend = new FakeBackend();
    const user = userEvent.setup();
    render(<App backend={backend} mac={false} />);
    await user.click(
      await screen.findByRole('button', { name: 'New local shell' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'zsh' }));
    expect(pane()).toHaveTextContent('No remote host');
    expect(pane()).toHaveTextContent(
      'Type ssh <host> in the terminal to browse its files here.',
    );
    expect(backend.sent('listFiles')).toEqual([]);
  });

  it('collapses for the whole window to a strip, by button, by Ctrl+Shift+B and by clicking the strip', async () => {
    const { backend, user } = await setup();
    await user.click(paneButton('Collapse SFTP pane'));
    const strip = screen.getByRole('button', { name: 'SFTP · web1' });
    expect(within(pane()).queryByRole('grid')).toBeNull();
    // Another Tab finds the pane collapsed too.
    await user.click(
      screen.getByRole('button', { name: 'Open another Tab of db' }),
    );
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'SFTP' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'SFTP' }));
    expect(
      within(pane()).getByRole('button', { name: 'Collapse SFTP pane' }),
    ).toBeVisible();
    await user.keyboard('{Control>}{Shift>}B{/Shift}{/Control}');
    expect(screen.getByRole('button', { name: 'SFTP' })).toBeDefined();
    await user.keyboard('{Control>}{Shift>}B{/Shift}{/Control}');
    expect(screen.queryByRole('button', { name: /^SFTP/ })).toBeNull();
    expect(strip).not.toBeInTheDocument();
  });

  it("tints the pane like its Tab's terminal", async () => {
    await setup({ patch: { sessions: [{ alias: 'db', colour: 'red' }] } });
    expect(pane().style.background).toBe(
      (screen.getByRole('main') as HTMLElement).style.background,
    );
    expect(pane().style.background).not.toBe('');
  });
});
