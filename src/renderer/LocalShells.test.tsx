import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type { LocalShellForm, SessionTree, Shell } from '../shared/ipc.ts';
import { FakeBackend } from './fake-backend.ts';

type User = ReturnType<typeof userEvent.setup>;

const tree = () => screen.getByRole('navigation', { name: 'Session tree' });
const unsaved = () => within(tree()).queryByRole('region', { name: 'Unsaved' });
const rowTexts = () =>
  [...tree().querySelectorAll('.row')].map((r) => r.textContent);
const row = (name: string) =>
  [...tree().querySelectorAll<HTMLElement>('.row')].find(
    (r) => r.textContent === name,
  )!;

const dialog = () => screen.getByRole('dialog');
const field = (name: string) => within(dialog()).getByRole('textbox', { name });
const select = (name: string) =>
  within(dialog()).getByRole<HTMLSelectElement>('combobox', { name });
const optionTexts = (name: string) =>
  [...select(name).options].map((o) => o.textContent);
const shownOption = (name: string) =>
  select(name).selectedOptions[0].textContent;

const shell = (
  name: string,
  patch: Partial<LocalShellForm> = {},
): LocalShellForm => ({
  name,
  folder: '',
  kind: 'cmd',
  distro: '',
  startFolder: '',
  command: '',
  ...patch,
});

const windows: Shell[] = [
  { kind: 'pwsh' },
  { kind: 'cmd' },
  { kind: 'wsl', distro: 'Ubuntu' },
];

const sample: SessionTree = {
  folders: ['Work'],
  sessions: [{ alias: 'web', folder: 'Work' }, { alias: 'db' }],
  handWritten: [],
  localShells: [
    shell('box', {
      folder: 'Work',
      kind: 'wsl',
      distro: 'Ubuntu',
      command: 'docker exec -it box bash',
    }),
    shell('mac', { kind: 'zsh' }),
    shell('cmd-shell'),
  ],
  warnings: [],
};

async function setup(patch: Partial<SessionTree> = {}) {
  const backend = new FakeBackend();
  backend.shells = windows;
  backend.tree = { ...sample, ...patch };
  backend.savedLocalShells = Object.fromEntries(
    backend.tree.localShells.map((s) => [
      s.name,
      { ...s, read: `read-${s.name}` },
    ]),
  );
  const user = userEvent.setup();
  render(<App backend={backend} mac={false} />);
  await vi.waitFor(() => expect(row('web')).toBeDefined());
  return { backend, user };
}

async function openMenu(user: User, name: string) {
  await user.pointer({ keys: '[MouseRight]', target: row(name) });
  return screen.getByRole('menu');
}

const press = async (user: User, name: string, key: string) => {
  row(name).focus();
  await user.keyboard(key);
};

describe('Local shell sessions in the tree', () => {
  it('sorts them A to Z with SSH sessions, each with an amber bar', async () => {
    await setup();
    expect(rowTexts()).toEqual([
      'cmd-shell',
      'db',
      'mac n/a',
      'Work',
      'box',
      'web',
    ]);
    expect(row('box').querySelector('.edge.local')).not.toBeNull();
    expect(row('web').querySelector('.edge.ssh')).not.toBeNull();
  });

  it('dims a session whose shell this machine lacks: n/a, no +, and it does not open', async () => {
    const { backend, user } = await setup();
    const mac = row('mac n/a');
    expect(mac).toHaveClass('unavailable');
    expect(within(mac).getByText('n/a')).toHaveAttribute(
      'title',
      'not available on this machine',
    );
    expect(
      screen.queryByRole('button', { name: 'Open another Tab of mac' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open another Tab of box' }),
    ).toBeDefined();
    await user.dblClick(mac);
    await press(user, 'mac n/a', '{Enter}');
    const menu = await openMenu(user, 'mac n/a');
    expect(
      within(menu).getByRole('menuitem', { name: 'Open Tab' }),
    ).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
    expect(backend.sent('openShellSession')).toEqual([]);
  });

  it('dims a WSL session whose distro this machine lacks', async () => {
    await setup({
      localShells: [shell('deb', { kind: 'wsl', distro: 'Debian' })],
    });
    expect(row('deb n/a')).toHaveClass('unavailable');
  });

  it('still moves and edits an unavailable session', async () => {
    const { user } = await setup();
    await press(user, 'mac n/a', '{F7}');
    expect(screen.getByRole('dialog', { name: 'Move mac' })).toBeDefined();
    await user.keyboard('{Escape}');
    await press(user, 'mac n/a', '{F2}');
    expect(
      await screen.findByRole('dialog', { name: 'Edit mac' }),
    ).toBeDefined();
  });

  it('opens a Tab under the session, and a Tab running a command stays after exit 0', async () => {
    const { backend, user } = await setup();
    await user.dblClick(row('box'));
    await user.click(
      screen.getByRole('button', { name: 'Open another Tab of cmd-shell' }),
    );
    expect(backend.sent('openShellSession')).toEqual([['box'], ['cmd-shell']]);
    expect(screen.getByRole('banner')).toHaveTextContent('local shell');
    act(() => {
      backend.emit({ type: 'exit', tab: 'tab-1', code: 0 });
      backend.emit({ type: 'exit', tab: 'tab-2', code: 0 });
    });
    expect(rowTexts()).toEqual([
      'cmd-shell',
      'db',
      'mac n/a',
      'Work',
      'box',
      'exit 0',
      'web',
    ]);
  });

  it('offers Local shell session in New and New local shell here in a folder menu, in that folder', async () => {
    const { user } = await setup();
    row('web').focus();
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Local shell session' }),
    );
    expect(dialog()).toHaveAccessibleName('New local shell session');
    expect(shownOption('Folder')).toBe('Work');
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await openMenu(user, 'Work')).getByRole('menuitem', {
        name: 'New local shell here',
      }),
    );
    expect(shownOption('Folder')).toBe('Work');
  });
});

describe('the Local shell dialog', () => {
  async function openNew(user: User) {
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Local shell session' }),
    );
  }

  it('shows WSL distro only for WSL and the launch line for each shell', async () => {
    const { backend, user } = await setup();
    await openNew(user);
    expect(optionTexts('Shell')).toEqual([
      'PowerShell 7',
      'Windows PowerShell',
      'cmd',
      'WSL',
    ]);
    expect(
      within(dialog()).queryByRole('combobox', { name: 'WSL distro' }),
    ).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: 'Test' })).toBeNull();
    const note = () => within(dialog()).getByText(/^Starts/);
    expect(note()).toHaveTextContent('Starts pwsh');

    await user.selectOptions(select('Shell'), 'WSL');
    expect(optionTexts('WSL distro')).toEqual(['Default', 'Ubuntu']);
    expect(note()).toHaveTextContent('Starts wsl --cd ~');
    await user.selectOptions(select('WSL distro'), 'Ubuntu');
    await user.type(field('Start folder'), '~/src');
    expect(note()).toHaveTextContent('Starts wsl -d Ubuntu --cd ~/src');
    await user.type(field('Command'), 'docker exec -it box bash');
    expect(note()).toHaveTextContent(
      'Starts wsl -d Ubuntu --cd ~/src -- docker exec -it box bash',
    );

    await user.selectOptions(select('Shell'), 'cmd');
    expect(
      within(dialog()).queryByRole('combobox', { name: 'WSL distro' }),
    ).toBeNull();
    expect(note()).toHaveTextContent(
      'Starts cmd /c docker exec -it box bash in ~/src',
    );
    await user.selectOptions(select('Shell'), 'PowerShell 7');
    expect(note()).toHaveTextContent(
      'Starts pwsh -Command "docker exec -it box bash" in ~/src',
    );

    await user.type(field('Name'), 'db');
    expect(within(dialog()).getByText('db is already taken.')).toBeDefined();
    await user.clear(field('Name'));
    await user.type(field('Name'), 'Box2');
    expect(field('Name')).toHaveValue('box2');
    expect(within(dialog()).getByText('Free')).toBeDefined();
    await user.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(backend.sent('saveLocalShell')).toEqual([
      [
        expect.objectContaining({
          name: 'box2',
          folder: '',
          kind: 'pwsh',
          startFolder: '~/src',
          command: 'docker exec -it box bash',
        }),
        undefined,
      ],
    ]);
  });

  it('marks a shell or distro this machine lacks as not on this machine, with a warning', async () => {
    const { user } = await setup({
      localShells: [
        shell('mac', { kind: 'zsh' }),
        shell('deb', { kind: 'wsl', distro: 'Debian' }),
      ],
    });
    await press(user, 'mac n/a', '{F2}');
    await screen.findByRole('dialog', { name: 'Edit mac' });
    expect(shownOption('Shell')).toBe('zsh (not on this machine)');
    expect(dialog()).toHaveTextContent(
      "This machine has no zsh. The session syncs and can be edited, but won't open here.",
    );
    await user.keyboard('{Escape}');
    await press(user, 'deb n/a', '{F2}');
    await screen.findByRole('dialog', { name: 'Edit deb' });
    expect(shownOption('WSL distro')).toBe('Debian (not on this machine)');
    expect(dialog()).toHaveTextContent(
      'This machine has no WSL distro Debian.',
    );
  });

  it('edits and renames a session, carrying its Tabs along', async () => {
    const { backend, user } = await setup();
    await user.dblClick(row('box'));
    await press(user, 'box', '{F2}');
    await screen.findByRole('dialog', { name: 'Edit box' });
    expect(field('Command')).toHaveValue('docker exec -it box bash');
    expect(shownOption('WSL distro')).toBe('Ubuntu');
    await user.clear(field('Name'));
    await user.type(field('Name'), 'boxy');
    act(() =>
      backend.emit({ type: 'tree', tree: { ...sample, localShells: [] } }),
    );
    await user.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(backend.sent('saveLocalShell')).toEqual([
      [
        { ...sample.localShells[0], name: 'boxy' },
        { name: 'box', read: 'read-box' },
      ],
    ]);
    expect(rowTexts().slice(-3)).toEqual(['boxy', 'boxy', 'web']);
  });

  it('deletes a session with the values read when the confirm opened', async () => {
    const { backend, user } = await setup();
    await user.click(
      within(await openMenu(user, 'box')).getByRole('menuitem', {
        name: 'Delete',
      }),
    );
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Delete box',
    });
    act(() =>
      backend.emit({ type: 'tree', tree: { ...sample, localShells: [] } }),
    );
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(backend.sent('deleteLocalShell')).toEqual([['box', 'read-box']]);
  });

  it('counts Local shell sessions in a folder delete', async () => {
    const { backend, user } = await setup();
    await user.click(
      within(await openMenu(user, 'Work')).getByRole('menuitem', {
        name: 'Delete',
      }),
    );
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('2 Saved sessions');
    act(() =>
      backend.emit({ type: 'tree', tree: { ...sample, localShells: [] } }),
    );
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(backend.sent('deleteFolder')[0][1].toSorted()).toEqual([
      'box',
      'web',
    ]);
  });
});

describe('saving an unsaved Tab', () => {
  it('asks for a name and folder and moves the Tab under its new session', async () => {
    const { backend, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'New local shell' }));
    await user.click(screen.getByRole('menuitem', { name: 'wsl: Ubuntu' }));
    expect(unsaved()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save…' }));
    expect(dialog()).toHaveAccessibleName('Save wsl: Ubuntu');
    expect(
      within(dialog()).queryByRole('combobox', { name: 'Shell' }),
    ).toBeNull();
    expect(
      within(dialog()).queryByRole('textbox', { name: 'Command' }),
    ).toBeNull();
    await user.type(field('Name'), 'ubuntu');
    await user.selectOptions(select('Folder'), 'Work');
    await user.click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(backend.sent('saveLocalShell')).toEqual([
      [
        shell('ubuntu', { folder: 'Work', kind: 'wsl', distro: 'Ubuntu' }),
        undefined,
      ],
    ]);
    expect(unsaved()).toBeNull();
    expect(rowTexts().slice(-4)).toEqual(['box', 'ubuntu', 'ubuntu', 'web']);
    expect(screen.queryByRole('button', { name: 'Save…' })).toBeNull();
  });
});
