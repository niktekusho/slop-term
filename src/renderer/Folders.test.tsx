import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type { CredentialReference, SessionTree } from '../shared/ipc.ts';
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
const nameBox = () => screen.getByRole('textbox', { name: 'Folder name' });

const keychainRef = (entry: string): CredentialReference => ({
  provider: 'keychain',
  entry,
  kind: 'password',
});

const sample: SessionTree = {
  folders: ['Work', 'Work/Prod', 'Home'],
  sessions: [
    { alias: 'db', folder: 'Work/Prod' },
    { alias: 'web', folder: 'Work' },
    { alias: 'nas', folder: 'Home' },
    { alias: 'loose' },
  ],
  handWritten: [],
  localShells: [],
  warnings: [],
};

async function setup(patch: Partial<SessionTree> = {}) {
  const backend = new FakeBackend();
  backend.tree = { ...sample, ...patch };
  const user = userEvent.setup();
  render(<App backend={backend} mac={false} />);
  await vi.waitFor(() => expect(row('Work')).toBeDefined());
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

describe('New folder and Rename', () => {
  it("creates a folder inline in the selected row's folder from New", async () => {
    const { backend, user } = await setup();
    row('web').focus();
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(screen.getByRole('menuitem', { name: 'Folder' }));
    expect(nameBox()).toHaveFocus();
    await user.keyboard('Staging{Enter}');
    expect(backend.sent('createFolder')).toEqual([['Work', 'Staging']]);
    expect(rowTexts()).toEqual([
      'loose',
      'Home',
      'nas',
      'Work',
      'Prod',
      'db',
      'Staging',
      'web',
    ]);
  });

  it('keeps an empty, taken or /-containing name open with a red border, and commits on blur', async () => {
    const { backend, user } = await setup();
    await user.click(
      within(await openMenu(user, 'Work')).getByRole('menuitem', {
        name: 'New folder here',
      }),
    );
    for (const typed of ['{Enter}', 'prod{Enter}', '{Backspace>4}a/b{Enter}']) {
      await user.keyboard(typed);
      expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    }
    expect(nameBox()).toHaveAccessibleDescription('No / in a folder name.');
    await user.clear(nameBox());
    await user.type(nameBox(), 'Eu');
    expect(nameBox()).toHaveAttribute('aria-invalid', 'false');
    await user.click(row('loose'));
    expect(backend.sent('createFolder')).toEqual([['Work', 'Eu']]);
  });

  it('renames with F2, and Esc cancels without a request', async () => {
    const { backend, user } = await setup();
    await press(user, 'Prod', '{F2}');
    expect(nameBox()).toHaveValue('Prod');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Folder name' })).toBeNull();

    await press(user, 'Prod', '{F2}');
    await user.clear(nameBox());
    await user.keyboard('Production{Enter}');
    expect(backend.sent('renameFolder')).toEqual([['Work/Prod', 'Production']]);
    expect(rowTexts()).toContain('Production');
  });

  it('puts the focus on the folder row when the edit ends, so the tree keys keep working', async () => {
    const { user } = await setup();
    await press(user, 'Prod', '{F2}');
    await user.keyboard('{Escape}');
    expect(row('Prod')).toHaveFocus();

    await user.keyboard('{F2}');
    await user.clear(nameBox());
    await user.keyboard('Eu{Enter}');
    expect(row('Eu')).toHaveFocus();

    await user.click(
      within(await openMenu(user, 'Home')).getByRole('menuitem', {
        name: 'New folder here',
      }),
    );
    await user.keyboard('Lab{Enter}');
    expect(row('Lab')).toHaveFocus();
  });

  it('lists the folder menu with its keys', async () => {
    const { user } = await setup();
    const items = within(await openMenu(user, 'Work')).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'New SSH session here',
      'New local shell here',
      'New folder here',
      'RenameF2',
      'Move to…F7',
      'DeleteDel',
    ]);
    expect(items[5]).toHaveClass('danger');

    await user.click(items[0]);
    expect(
      await screen.findByRole('dialog', { name: 'New SSH session' }),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Folder' })).toHaveValue(
      'Work',
    );
  });
});

describe('Move to…', () => {
  const picker = () => screen.getByRole('dialog', { name: /^Move / });
  const options = () =>
    within(picker())
      .getAllByRole('option')
      .map((o) => o.textContent);

  it('opens with F7 on a session, marks its folder and moves it and its Tab with the arrow keys and Enter', async () => {
    const { backend, user } = await setup();
    await user.dblClick(row('db'));
    await press(user, 'db', '{F7}');
    expect(
      screen.getByRole('searchbox', { name: 'Filter folders' }),
    ).toHaveFocus();
    expect(options()).toEqual([
      '(top level)',
      'Home',
      'Work',
      'Work / Prod (current)',
    ]);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}');
    expect(
      within(picker()).getByRole('option', { selected: true }),
    ).toHaveTextContent('Work');
    await user.keyboard('{Enter}');
    expect(backend.sent('move')).toEqual([[{ alias: 'db' }, 'Work']]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rowTexts()).toEqual([
      'loose',
      'Home',
      'nas',
      'Work',
      'Prod',
      'db',
      'db',
      'web',
    ]);
  });

  it('filters by part of a name and cancels with Esc', async () => {
    const { backend, user } = await setup();
    await press(user, 'web', '{F7}');
    await user.keyboard('ho');
    expect(options()).toEqual(['Home']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(backend.sent('move')).toEqual([]);
  });

  it("never offers a folder itself or its subfolders, from the folder menu's Move to…", async () => {
    const { backend, user } = await setup();
    await user.click(
      within(await openMenu(user, 'Work')).getByRole('menuitem', {
        name: 'Move to…',
      }),
    );
    expect(options()).toEqual(['(top level) (current)', 'Home']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(backend.sent('move')).toEqual([[{ folder: 'Work' }, 'Home']]);
  });
});

describe('drag and drop', () => {
  it('moves a session onto a folder, or onto the top level', async () => {
    const { backend } = await setup();
    fireEvent.dragStart(row('db'));
    fireEvent.dragOver(row('Home'));
    fireEvent.drop(row('Home'));
    expect(backend.sent('move')).toEqual([[{ alias: 'db' }, 'Home']]);

    fireEvent.dragStart(row('nas'));
    fireEvent.drop(row('loose'));
    expect(backend.sent('move').at(-1)).toEqual([{ alias: 'nas' }, '']);
  });

  it('drops a folder into another folder through any row inside it, but never into itself', async () => {
    const { backend } = await setup();
    for (const target of ['Prod', 'db', 'nas']) {
      fireEvent.dragStart(row('Work'));
      fireEvent.drop(row(target));
    }
    expect(backend.sent('move')).toEqual([[{ folder: 'Work' }, 'Home']]);
  });
});

describe('Delete folder', () => {
  it('counts what goes, names open Tabs, offers only unshared secrets, unticked, with Cancel focused', async () => {
    const own = keychainRef('own');
    const shared = keychainRef('shared');
    const { backend, user } = await setup({
      sessions: [
        { alias: 'db', folder: 'Work/Prod', credential: own },
        { alias: 'api', folder: 'Work/Prod', credential: own },
        { alias: 'web', folder: 'Work', credential: shared },
        {
          alias: 'team',
          folder: 'Work',
          credential: { ...own, provider: 'tpm' },
        },
        { alias: 'loose', credential: shared },
      ],
    });
    await user.dblClick(row('db'));
    await press(user, 'Work', '{Delete}');
    const confirm = screen.getByRole('alertdialog', { name: 'Delete Work' });
    expect(confirm).toHaveTextContent(
      'Delete folder Work, 1 subfolder and 4 Saved sessions?',
    );
    expect(confirm).toHaveTextContent('1 Tab is open. It stays open.');
    const box = within(confirm).getByRole('checkbox', {
      name: 'Also delete 1 saved secret from keychain / KeePass',
    });
    expect(box).not.toBeChecked();
    expect(confirm).toHaveTextContent(
      '2 saved secrets stay: shared with a session outside the folder, or kept in TPM.',
    );
    expect(
      within(confirm).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    expect(within(confirm).getByRole('button', { name: 'Delete' })).toHaveClass(
      'danger',
    );

    await user.click(box);
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(backend.sent('deleteFolder')).toEqual([
      ['Work', ['db', 'api', 'web', 'team'], true],
    ]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(
      within(unsaved()!).getByRole('button', { name: 'db' }),
    ).toBeVisible();
  });

  it('sends the sessions it counted, so a session synced in under the open confirm makes a conflict, not a bigger delete', async () => {
    const { backend, user } = await setup();
    await press(user, 'Prod', '{Delete}');
    act(() =>
      backend.emit({
        type: 'tree',
        tree: {
          ...sample,
          sessions: [...sample.sessions, { alias: 'new', folder: 'Work/Prod' }],
        },
      }),
    );
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(backend.sent('deleteFolder')).toEqual([
      ['Work/Prod', ['db'], false],
    ]);
  });

  it('deletes an empty folder without asking', async () => {
    const { backend, user } = await setup({ folders: ['Work', 'Empty'] });
    await press(user, 'Empty', '{Delete}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(backend.sent('deleteFolder')).toEqual([['Empty', [], false]]);
    expect(rowTexts()).not.toContain('Empty');
  });
});

describe('Move into slop-term', () => {
  it('moves a Hand-written host in, then comments out the original after the user confirms', async () => {
    const { backend, user } = await setup({ handWritten: ['jenkins'] });
    const items = within(await openMenu(user, 'jenkins')).getAllByRole(
      'menuitem',
    );
    expect(items.map((i) => i.textContent)).toEqual([
      'Open TabEnter',
      'Move into slop-term',
    ]);
    await user.click(items[1]);
    expect(backend.sent('moveIn')).toEqual([['jenkins']]);
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Comment out jenkins',
    });
    expect(confirm).toHaveTextContent('# moved to slop-term.conf');
    await user.click(
      within(confirm).getByRole('button', { name: 'Comment out' }),
    );
    expect(backend.sent('commentOut')).toEqual([['jenkins']]);
    expect(unsaved()).toBeNull();
    expect(within(row('jenkins')).queryByTitle(/Also defined/)).toBeNull();
  });

  it('keeps both on request, and then warns with a fix in the menu', async () => {
    const { backend, user } = await setup({ handWritten: ['jenkins'] });
    await user.click(
      within(await openMenu(user, 'jenkins')).getByRole('menuitem', {
        name: 'Move into slop-term',
      }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Keep both',
      }),
    );
    expect(backend.sent('commentOut')).toEqual([]);
    expect(
      within(row('jenkins')).getByTitle('Also defined in ~/.ssh/config line 1'),
    ).toBeInTheDocument();
  });

  it('comments out the copy of a synced Managed alias from its menu', async () => {
    const { backend, user } = await setup({
      sessions: [{ alias: 'db', alsoInConfig: 12 }],
    });
    expect(
      within(row('db')).getByTitle('Also defined in ~/.ssh/config line 12'),
    ).toBeInTheDocument();
    await user.click(
      within(await openMenu(user, 'db')).getByRole('menuitem', {
        name: 'Comment out the copy in ~/.ssh/config',
      }),
    );
    expect(backend.sent('commentOut')).toEqual([['db']]);
  });
});

it('moves the Tabs of a session renamed outside the app to the Unsaved group', async () => {
  const { backend, user } = await setup();
  await user.dblClick(row('web'));
  await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
  act(() =>
    backend.emit({
      type: 'tree',
      tree: {
        ...sample,
        sessions: [{ alias: 'web-prod', folder: 'Work' }],
      },
    }),
  );
  expect(within(unsaved()!).getByRole('button', { name: 'web' })).toBeVisible();
  expect(rowTexts()).toContain('web-prod');
});
