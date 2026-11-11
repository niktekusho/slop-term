import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteFile, SessionTree, Transfer } from '../shared/ipc.ts';
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
      expect(menuItem('Open in editor')).toBeEnabled();
      expect(menuItem('Download')).toBeEnabled();
      expect(menuItem('Download to…')).toBeEnabled();
      await user.keyboard('{Escape}');

      await user.click(fileRow('notes.txt'));
      await user.keyboard('{Control>}');
      await user.click(fileRow('run.sh'));
      await user.keyboard('{/Control}');
      await user.pointer({ keys: '[MouseRight]', target: fileRow('run.sh') });
      expect(menuItem('Rename')).toBeDisabled();
      expect(menuItem('Download 2 items')).toBeEnabled();
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

  describe('transfers', () => {
    const transfer = (patch: Partial<Transfer> = {}): Transfer => ({
      id: '1',
      direction: 'upload',
      name: 'a.txt',
      folder: '/home/me',
      local: '/local/a.txt',
      bytes: 0,
      total: 1000 * 1024,
      speed: 0,
      state: 'queued',
      ...patch,
    });
    const report = (backend: FakeBackend, patch: Partial<Transfer> = {}) =>
      act(() =>
        backend.emit({
          type: 'transfer',
          tab: 'tab-1',
          transfer: transfer(patch),
        }),
      );
    const list = () =>
      within(pane()).getByRole('region', { name: 'Transfers' });

    it('downloads the selected rows to the last folder, and Download to… to a picked folder', async () => {
      const { backend, user } = await setup();
      await user.pointer({
        keys: '[MouseRight]',
        target: fileRow('notes.txt'),
      });
      await user.click(menuItem('Download'));
      expect(backend.sent('download')).toEqual([
        ['tab-1', ['/home/me/notes.txt']],
      ]);
      await user.click(fileRow('notes.txt'));
      await user.keyboard('{Control>}');
      await user.click(fileRow('src'));
      await user.keyboard('{/Control}');
      await user.pointer({ keys: '[MouseRight]', target: fileRow('src') });
      await user.click(menuItem('Download to…'));
      await vi.waitFor(() => expect(backend.sent('download')).toHaveLength(2));
      expect(backend.sent('download')[1]).toEqual([
        'tab-1',
        ['/home/me/src', '/home/me/notes.txt'],
        '/local/picked',
      ]);
      // A cancelled picker downloads nothing.
      backend.folder = undefined;
      await user.pointer({ keys: '[MouseRight]', target: fileRow('src') });
      await user.click(menuItem('Download to…'));
      await new Promise((r) => setTimeout(r, 20));
      expect(backend.sent('download')).toHaveLength(2);
    });

    it('uploads picked files into the folder the pane shows', async () => {
      const { backend, user } = await setup();
      await user.pointer({
        keys: '[MouseRight]',
        target: pane().querySelector('.file-list')!,
      });
      await user.click(menuItem('Upload files…'));
      await vi.waitFor(() =>
        expect(backend.sent('upload')).toEqual([
          ['tab-1', ['/local/a.txt', '/local/b.txt'], '/home/me'],
        ]),
      );
    });

    it('uploads files dragged in from the OS, with a dashed overlay naming the folder', async () => {
      const { backend } = await setup();
      const list = pane().querySelector('.file-list')!;
      const files = [new File(['x'], 'a.txt'), new File(['y'], 'b.txt')];
      fireEvent.dragEnter(list, { dataTransfer: { types: ['Files'], files } });
      expect(
        within(pane()).getByText('Drop to upload to /home/me'),
      ).toBeVisible();
      fireEvent.dragLeave(list, { dataTransfer: { types: ['Files'] } });
      expect(within(pane()).queryByText(/Drop to upload/)).toBeNull();
      fireEvent.dragEnter(list, { dataTransfer: { types: ['Files'], files } });
      fireEvent.drop(list, { dataTransfer: { types: ['Files'], files } });
      expect(within(pane()).queryByText(/Drop to upload/)).toBeNull();
      expect(backend.sent('upload')).toEqual([
        ['tab-1', ['/local/a.txt', '/local/b.txt'], '/home/me'],
      ]);
      // Dragging text is no upload.
      fireEvent.dragEnter(list, { dataTransfer: { types: ['text/plain'] } });
      expect(within(pane()).queryByText(/Drop to upload/)).toBeNull();
    });

    it('lists transfers with the active count, direction, folder, progress, bytes and speed, and cancels', async () => {
      const { backend, user } = await setup();
      expect(
        within(pane()).queryByRole('region', { name: 'Transfers' }),
      ).toBeNull();
      report(backend, {
        state: 'running',
        bytes: 450 * 1024,
        speed: 120 * 1024,
      });
      report(backend, {
        id: '2',
        name: 'b.txt',
        direction: 'download',
        folder: '/local/dl',
        local: '/local/dl/b.txt',
      });
      expect(within(list()).getByRole('heading')).toHaveTextContent(
        'Transfers2',
      );
      const row = within(list()).getAllByRole('listitem')[0];
      expect(within(row).getByLabelText('Upload')).toBeDefined();
      expect(row).toHaveTextContent('a.txt');
      expect(row).toHaveTextContent('/home/me');
      expect(row).toHaveTextContent('45% · 450.0 KB of 1000.0 KB · 120.0 KB/s');
      expect(within(row).getByRole('progressbar')).toHaveAttribute(
        'value',
        String(450 * 1024),
      );
      expect(within(list()).getAllByRole('listitem')[1]).toHaveTextContent(
        'Queued',
      );
      expect(
        within(within(list()).getAllByRole('listitem')[1]).getByLabelText(
          'Download',
        ),
      ).toBeDefined();
      await user.click(
        within(row).getByRole('button', { name: 'Cancel a.txt' }),
      );
      expect(backend.sent('cancelTransfer')).toEqual([['tab-1', '1']]);
      report(backend, { state: 'cancelled' });
      expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    });

    it('shows a finished download as a Saved to link that reveals the file, and clears it after a few seconds', async () => {
      const { backend, user } = await setup();
      report(backend, {
        direction: 'download',
        folder: '/local/dl',
        local: '/local/dl/a.txt',
        state: 'done',
        bytes: 1000 * 1024,
      });
      expect(within(list()).getByRole('heading')).toHaveTextContent(
        'Transfers0',
      );
      await user.click(
        within(list()).getByRole('button', { name: 'Saved to /local/dl' }),
      );
      expect(backend.shown).toEqual(['/local/dl/a.txt']);
      await vi.waitFor(
        () =>
          expect(
            within(pane()).queryByRole('region', { name: 'Transfers' }),
          ).toBeNull(),
        { timeout: 5000 },
      );
    }, 10_000);

    it('shows the reason of a failed transfer in red and retries it', async () => {
      const { backend, user } = await setup();
      report(backend, { state: 'failed', reason: 'The Tab disconnected.' });
      const row = within(list()).getAllByRole('listitem')[0];
      expect(within(row).getByText('The Tab disconnected.')).toHaveClass(
        'transfer-error',
      );
      await user.click(
        within(row).getByRole('button', { name: 'Retry a.txt' }),
      );
      expect(backend.sent('retryTransfer')).toEqual([['tab-1', '1']]);
    });

    it("shows the running upload's percentage on the collapsed strip", async () => {
      const { backend, user } = await setup();
      await user.click(paneButton('Collapse SFTP pane'));
      report(backend, { state: 'running', bytes: 512 * 1024 });
      expect(
        screen.getByRole('button', { name: '51% SFTP · web1' }),
      ).toBeDefined();
      report(backend, { state: 'done', bytes: 1000 * 1024 });
      expect(screen.getByRole('button', { name: 'SFTP · web1' })).toBeDefined();
    });

    it('asks about a conflict with both sides, and answers for the other conflicts too', async () => {
      const { backend, user } = await setup();
      const conflict = {
        name: 'report.txt',
        local: {
          size: 1200,
          modified: new Date(2026, 10, 9, 14, 32).getTime(),
        },
        remote: { size: 300, modified: new Date(2026, 10, 10, 9, 5).getTime() },
        others: 2,
      };
      act(() => backend.emit({ type: 'conflict', tab: 'tab-1', conflict }));
      const dialog = within(pane()).getByRole('alertdialog', {
        name: 'report.txt already exists',
      });
      expect(dialog).toHaveTextContent(
        'On this computer1.2 KB · 2026-11-09 14:32',
      );
      expect(dialog).toHaveTextContent('On web1300 B · 2026-11-10 09:05');
      expect(
        within(dialog).getByRole('button', { name: 'Keep both' }),
      ).toHaveFocus();
      await user.click(
        within(dialog).getByRole('checkbox', {
          name: 'Apply to the other 2 conflicts',
        }),
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Overwrite' }),
      );
      expect(backend.sent('answerConflict')).toEqual([
        ['tab-1', 'overwrite', true],
      ]);
      expect(within(pane()).queryByRole('alertdialog')).toBeNull();

      act(() =>
        backend.emit({
          type: 'conflict',
          tab: 'tab-1',
          conflict: { ...conflict, others: 0 },
        }),
      );
      expect(within(pane()).queryByRole('checkbox')).toBeNull();
      await user.click(within(pane()).getByRole('button', { name: 'Skip' }));
      expect(backend.sent('answerConflict')[1]).toEqual([
        'tab-1',
        'skip',
        false,
      ]);
      // A void question closes the dialog.
      act(() => backend.emit({ type: 'conflict', tab: 'tab-1', conflict }));
      act(() => backend.emit({ type: 'conflict', tab: 'tab-1' }));
      expect(within(pane()).queryByRole('alertdialog')).toBeNull();
    });

    it('opens a collapsed pane to ask about a conflict, and opens it again on a switch back to a Tab still asking', async () => {
      const { backend, user } = await setup();
      const conflict = {
        name: 'report.txt',
        local: { size: 1, modified: 0 },
        remote: { size: 2, modified: 0 },
        others: 0,
      };
      await user.click(paneButton('Collapse SFTP pane'));
      act(() => backend.emit({ type: 'conflict', tab: 'tab-1', conflict }));
      expect(
        within(pane()).getByRole('alertdialog', {
          name: 'report.txt already exists',
        }),
      ).toBeVisible();

      await user.click(
        screen.getByRole('button', { name: 'Open another Tab of db' }),
      );
      await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(2));
      await user.click(paneButton('Collapse SFTP pane'));
      await user.keyboard('{Control>}{Shift>}1{/Shift}{/Control}');
      expect(
        within(pane()).getByRole('alertdialog', {
          name: 'report.txt already exists',
        }),
      ).toBeVisible();
    });

    it("warns in the pane when the transfer connection meets a key other than the Tab's", async () => {
      const { backend } = await setup();
      act(() =>
        backend.emit({
          type: 'transferKey',
          tab: 'tab-1',
          change: {
            host: 'web1:22',
            keyType: 'ssh-ed25519',
            accepted: 'SHA256:old',
            fingerprint: 'SHA256:new',
          },
        }),
      );
      const warning = within(pane()).getByRole('alert');
      expect(warning).toHaveTextContent(
        'The host key for transfers has changed',
      );
      expect(warning).toHaveTextContent(
        'web1:22 sent a different key than the one the Tab accepted.',
      );
      expect(warning).toHaveTextContent(
        'Tab accepted ssh-ed25519 key: SHA256:old',
      );
      expect(warning).toHaveTextContent('Key sent now: SHA256:new');
      expect(
        within(pane()).queryByRole('button', { name: /Trust|Replace/ }),
      ).toBeNull();
    });

    it('asks before closing a Tab with pending transfers, and offers Show local copy', async () => {
      const { backend, user } = await setup();
      report(backend, { state: 'running' });
      report(backend, { id: '2', name: 'b.txt', local: '/local/b.txt' });
      await user.keyboard('{Control>}{Shift>}W{/Shift}{/Control}');
      const confirm = screen.getByRole('alertdialog', { name: 'Close Tab' });
      expect(confirm).toHaveTextContent(
        'Close db with 2 transfers not finished?',
      );
      expect(
        within(confirm).getByRole('button', { name: 'Cancel' }),
      ).toHaveFocus();
      await user.click(
        within(confirm).getByRole('button', { name: 'Show local copy' }),
      );
      expect(backend.shown).toEqual(['/local/a.txt']);
      await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
      expect(backend.sent('close')).toEqual([]);
      await user.keyboard('{Control>}{Shift>}W{/Shift}{/Control}');
      await user.click(screen.getByRole('button', { name: 'Close Tab' }));
      expect(backend.sent('close')).toEqual([['tab-1']]);
    });

    it('closes a Tab whose transfers are all finished or failed without asking', async () => {
      const { backend, user } = await setup();
      report(backend, { state: 'failed', reason: 'No such file' });
      await user.keyboard('{Control>}{Shift>}W{/Shift}{/Control}');
      expect(backend.sent('close')).toEqual([['tab-1']]);
    });

    describe('editor sync', () => {
      const edit = (patch: Partial<Transfer> = {}) =>
        transfer({
          id: 'edit-1',
          direction: 'download',
          name: 'app.conf',
          folder: '/srv',
          local: '/tmp/editor-sync/edit-1/app.conf',
          state: 'done',
          edit: { app: 'VS Code' },
          ...patch,
        });
      const reportEdit = (
        backend: FakeBackend,
        patch: Partial<Transfer> = {},
      ) =>
        act(() =>
          backend.emit({
            type: 'transfer',
            tab: 'tab-1',
            transfer: edit(patch),
          }),
        );

      it('opens a file in the editor on double-click, Enter and Open in editor', async () => {
        const { backend, user } = await setup();
        await user.dblClick(fileRow('notes.txt'));
        expect(backend.sent('openInEditor')).toEqual([
          ['tab-1', '/home/me/notes.txt'],
        ]);
        await user.click(fileRow('run.sh'));
        await user.keyboard('{Enter}');
        await user.pointer({ keys: '[MouseRight]', target: fileRow('run.sh') });
        await user.click(menuItem('Open in editor'));
        expect(backend.sent('openInEditor').slice(1)).toEqual([
          ['tab-1', '/home/me/run.sh'],
          ['tab-1', '/home/me/run.sh'],
        ]);
      });

      it('shows an open file as a row naming its editor and last upload, which stays', async () => {
        const { backend, user } = await setup();
        reportEdit(backend);
        const row = () => within(list()).getAllByRole('listitem')[0];
        expect(row()).toHaveTextContent('open in VS Code');
        reportEdit(backend, {
          edit: {
            app: 'VS Code',
            uploaded: new Date(2026, 10, 11, 15, 41).getTime(),
          },
        });
        expect(row()).toHaveTextContent('open in VS Code · uploaded 15:41');
        expect(within(row()).queryByRole('button')).toBeNull();

        reportEdit(backend, { state: 'queued' });
        expect(row()).toHaveTextContent('Waiting for connection');
        expect(within(row()).queryByRole('button')).toBeNull();
        reportEdit(backend, { state: 'failed', reason: 'Permission denied' });
        await user.click(
          within(row()).getByRole('button', { name: 'Retry app.conf' }),
        );
        expect(backend.sent('retryTransfer')).toEqual([['tab-1', 'edit-1']]);

        reportEdit(backend, { state: 'done' });
        await new Promise((r) => setTimeout(r, 3500));
        expect(row()).toHaveTextContent('open in VS Code');
      }, 10_000);

      it('asks before uploading over a remote file that changed, and on each save with upload on save off', async () => {
        const { backend, user } = await setup();
        await user.click(paneButton('Collapse SFTP pane'));
        act(() =>
          backend.emit({
            type: 'editorSave',
            tab: 'tab-1',
            question: { id: 'edit-1', name: 'app.conf', reason: 'changed' },
          }),
        );
        const changed = within(pane()).getByRole('alertdialog', {
          name: 'app.conf changed on web1',
        });
        expect(changed).toHaveTextContent(
          'Someone changed it since you opened it.',
        );
        act(() =>
          backend.emit({
            type: 'tree',
            tree: { ...backend.tree, sessions: [{ alias: 'db2' }] },
          }),
        );
        await user.click(
          within(changed).getByRole('button', { name: 'Overwrite' }),
        );
        expect(backend.sent('answerEditorSave')).toEqual([
          ['tab-1', 'edit-1', true],
        ]);
        expect(within(pane()).queryByRole('alertdialog')).toBeNull();

        act(() =>
          backend.emit({
            type: 'editorSave',
            tab: 'tab-1',
            question: { id: 'edit-1', name: 'app.conf', reason: 'save' },
          }),
        );
        const save = within(pane()).getByRole('alertdialog', {
          name: 'Upload app.conf to web1?',
        });
        await user.click(within(save).getByRole('button', { name: 'Not now' }));
        expect(backend.sent('answerEditorSave')[1]).toEqual([
          'tab-1',
          'edit-1',
          false,
        ]);

        // A void question closes the dialog.
        act(() =>
          backend.emit({
            type: 'editorSave',
            tab: 'tab-1',
            question: { id: 'edit-1', name: 'app.conf', reason: 'save' },
          }),
        );
        act(() => backend.emit({ type: 'editorSave', tab: 'tab-1' }));
        expect(within(pane()).queryByRole('alertdialog')).toBeNull();
      });

      it('asks before closing a Tab with a file open in an editor, and shows its copy', async () => {
        const { backend, user } = await setup();
        reportEdit(backend);
        await user.keyboard('{Control>}{Shift>}W{/Shift}{/Control}');
        const confirm = screen.getByRole('alertdialog', { name: 'Close Tab' });
        expect(confirm).toHaveTextContent(
          'Close db with 1 file open in an editor?',
        );
        expect(confirm).toHaveTextContent(
          'Closing the Tab deletes the copies it opened, with any save not uploaded.',
        );
        await user.click(
          within(confirm).getByRole('button', { name: 'Show local copy' }),
        );
        expect(backend.shown).toEqual(['/tmp/editor-sync/edit-1/app.conf']);
      });

      it('lists the copies with saves that never reached the host at startup', async () => {
        const backend = new FakeBackend();
        backend.unsent = [
          { alias: 'db', remote: '/srv/app.conf', file: '/tmp/es/a/app.conf' },
        ];
        const user = userEvent.setup();
        render(<App backend={backend} mac={false} />);
        const dialog = await screen.findByRole('dialog', {
          name: 'Unsent edits',
        });
        expect(dialog).toHaveTextContent(
          'These copies have saves that never reached the host.',
        );
        expect(dialog).toHaveTextContent('db:/srv/app.conf');
        await user.click(
          within(dialog).getByRole('button', { name: '/tmp/es/a/app.conf' }),
        );
        expect(backend.shown).toEqual(['/tmp/es/a/app.conf']);
        await user.click(within(dialog).getByRole('button', { name: 'Close' }));
        expect(
          screen.queryByRole('dialog', { name: 'Unsent edits' }),
        ).toBeNull();
      });
    });
  });

  it("tints the pane like its Tab's terminal", async () => {
    await setup({ patch: { sessions: [{ alias: 'db', colour: 'red' }] } });
    expect(pane().style.background).toBe(
      (screen.getByRole('main') as HTMLElement).style.background,
    );
    expect(pane().style.background).not.toBe('');
  });
});
