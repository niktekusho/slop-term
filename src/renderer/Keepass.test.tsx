import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type {
  CredentialReference,
  KeepassDatabase,
  KeepassEntry,
  SavedSession,
  SessionTree,
} from '../shared/ipc.ts';
import { FakeBackend } from './fake-backend.ts';

type User = ReturnType<typeof userEvent.setup>;

const tree = () => screen.getByRole('navigation', { name: 'Session tree' });
const row = (name: string) =>
  [...tree().querySelectorAll<HTMLElement>('.row')].find(
    (r) => r.textContent === name,
  )!;
const dialog = () => screen.getByRole('dialog', { name: /SSH session|Edit/ });
const field = (name: string) => within(dialog()).getByRole('textbox', { name });
const button = (name: string) => within(dialog()).getByRole('button', { name });
const popover = () =>
  screen.getByRole('dialog', { name: 'Attach existing secret' });

const id = `work/${'a'.repeat(32)}`;
const keepassRef: CredentialReference = {
  provider: 'keepass',
  entry: id,
  kind: 'password',
};
const bob: KeepassEntry = {
  id,
  name: 'web prod',
  username: 'bob',
  group: 'Servers/Prod',
  database: 'work',
};
const unlocked: KeepassDatabase = {
  name: 'work',
  locked: false,
  groups: ['Servers', 'Servers/Prod'],
};
const locked: KeepassDatabase = { name: 'work', locked: true, groups: [] };

/** Saved session `db`, which reads its password from KeePass entry `id` and logs in as `user`. */
const keepassSession = (user: string): SavedSession => ({
  alias: 'db',
  folder: '',
  hostname: 'db.lan',
  port: '',
  user,
  identityFile: '',
  options: [],
  credential: keepassRef,
  read: 'read-db',
});

async function setup(
  sessions: SessionTree['sessions'] = [{ alias: 'db' }],
  stored: Record<string, SavedSession> = {},
  patch: Partial<SessionTree> = {},
) {
  const backend = new FakeBackend();
  backend.tree = {
    folders: [],
    sessions,
    handWritten: [],
    localShells: [],
    warnings: [],
    ...patch,
  };
  backend.savedSessions = stored;
  const user = userEvent.setup();
  render(<App backend={backend} mac={false} />);
  await vi.waitFor(() => expect(row(sessions[0].alias)).toBeDefined());
  return { backend, user };
}

async function newSession(user: User) {
  await user.click(screen.getByRole('button', { name: 'New' }));
  await user.click(screen.getByRole('menuitem', { name: 'SSH session' }));
  await user.type(field('Alias'), 'web');
  await user.type(field('HostName'), 'web.lan');
}

async function openKeepassTab(user: User) {
  await user.click(button('Attach existing…'));
  await user.click(within(popover()).getByRole('tab', { name: 'KeePass' }));
}

describe('Attach existing… KeePass tab', () => {
  it('lists the entries of every unlocked database and attaches one, copying its username into User', async () => {
    const { backend, user } = await setup();
    backend.keepassFind = { entries: [bob], locked: [] };
    await newSession(user);
    await openKeepassTab(user);
    await user.type(
      within(popover()).getByRole('textbox', { name: 'KeePass search' }),
      'web',
    );
    await user.click(within(popover()).getByRole('button', { name: 'Find' }));
    expect(backend.sent('findKeepass').at(-1)).toEqual(['web']);
    await user.click(
      await within(popover()).findByRole('button', {
        name: /web prod bob Servers\/Prod/,
      }),
    );

    expect(field('User')).toHaveValue('bob');
    expect(dialog()).toHaveTextContent('Password in KeePass: web prod in work');
    await user.click(button('Save'));
    expect(backend.sent('saveSession')[0][0]).toMatchObject({
      user: 'bob',
      credential: keepassRef,
    });
  });

  it('shows an Unlock row for a locked database, asks for its master password again after a wrong one, then lists its entries', async () => {
    const { backend, user } = await setup();
    backend.keepassFind = { entries: [], locked: ['work'] };
    await newSession(user);
    await openKeepassTab(user);
    await user.click(
      await within(popover()).findByRole('button', { name: 'Unlock work' }),
    );
    const password = () =>
      within(popover()).getByLabelText('Master password for work');
    await user.type(password(), 'nope{Enter}');
    expect(await within(popover()).findByRole('alert')).toHaveTextContent(
      'Wrong master password.',
    );
    expect(backend.sent('unlockKeepass')).toEqual([['work', 'nope']]);

    backend.keepassFind = { entries: [bob], locked: [] };
    await user.clear(password());
    await user.type(password(), 'master{Enter}');
    expect(backend.sent('unlockKeepass').at(-1)).toEqual(['work', 'master']);
    expect(
      await within(popover()).findByRole('button', { name: /web prod bob/ }),
    ).toBeInTheDocument();
    expect(
      within(popover()).queryByRole('button', { name: 'Unlock work' }),
    ).toBeNull();
  });

  it('keeps User for an entry with no username', async () => {
    const { backend, user } = await setup();
    backend.keepassFind = {
      entries: [{ ...bob, username: '' }],
      locked: [],
    };
    await newSession(user);
    await user.type(field('User'), 'alice');
    await openKeepassTab(user);
    await user.click(
      await within(popover()).findByRole('button', { name: /web prod/ }),
    );
    expect(field('User')).toHaveValue('alice');
  });

  it("shows why KeePass can't search", async () => {
    const { backend, user } = await setup();
    backend.keepassFind = new Error("KeePass can't open work.kdbx: gone");
    await newSession(user);
    await openKeepassTab(user);
    expect(await within(popover()).findByRole('alert')).toHaveTextContent(
      "KeePass can't open work.kdbx: gone",
    );
  });
});

describe('the username check', () => {
  it('shows a mismatch inline, and Use bob fixes User', async () => {
    const { backend, user } = await setup();
    backend.keepassFind = { entries: [bob], locked: [] };
    await newSession(user);
    await openKeepassTab(user);
    await user.click(
      await within(popover()).findByRole('button', { name: /web prod bob/ }),
    );
    await user.clear(field('User'));
    await user.type(field('User'), 'alice');
    expect(dialog()).toHaveTextContent(
      'KeePass entry says bob, this Saved session says alice.',
    );
    await user.click(button('Use bob'));
    expect(field('User')).toHaveValue('bob');
    expect(dialog()).not.toHaveTextContent('KeePass entry says');
  });

  it("reads a KeePass session's entry when its edit opens, to show a mismatch", async () => {
    const { backend, user } = await setup(
      [{ alias: 'db', credential: keepassRef }],
      { db: keepassSession('alice') },
    );
    backend.keepassFind = { entries: [bob], locked: [] };
    row('db').focus();
    await user.keyboard('{F2}');
    await screen.findByRole('dialog', { name: 'Edit db' });
    expect(backend.sent('findKeepass')).toEqual([[id]]);
    expect(
      await within(dialog()).findByText(
        'KeePass entry says bob, this Saved session says alice.',
      ),
    ).toBeInTheDocument();
  });

  it('offers Use bob on a Tab blocked by a mismatch, saves User and reconnects', async () => {
    const stored = keepassSession('alice');
    const { backend, user } = await setup(
      [{ alias: 'db', credential: keepassRef }],
      { db: stored },
    );
    await user.click(
      screen.getByRole('button', { name: 'Open another Tab of db' }),
    );
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
    act(() =>
      backend.emit({
        type: 'dropped',
        tab: 'tab-1',
        reason: 'KeePass entry says bob, this Saved session says alice.',
        user: 'bob',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Use bob' }));
    await vi.waitFor(() =>
      expect(backend.sent('restart')).toEqual([['tab-1']]),
    );
    expect(backend.sent('saveSession')[0][0]).toMatchObject({ user: 'bob' });
  });
});

describe('Save to in a Tab prompt', () => {
  const question = {
    alias: 'db',
    title: 'Password for me@db.lan',
    prompts: [{ prompt: 'Password', echo: false }],
    save: 'new' as const,
  };
  async function asked(
    dbs: KeepassDatabase[],
    extra: { folder?: string } = {},
    last?: { database: string; group: string },
  ) {
    const { backend, user } = await setup();
    backend.keepassDbs = dbs;
    if (last)
      backend.savedSettings = {
        ...backend.savedSettings,
        keepassLastGroup: last,
      };
    await user.click(
      screen.getByRole('button', { name: 'Open another Tab of db' }),
    );
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
    act(() =>
      backend.emit({
        type: 'secret',
        tab: 'tab-1',
        question: { ...question, ...extra },
      }),
    );
    await screen.findByLabelText('Save to');
    return { backend, user };
  }
  const saveTo = () => screen.getByLabelText('Save to');

  it('offers KeePass only when a database is set up on this machine', async () => {
    await asked([]);
    expect(
      within(saveTo())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['keychain', "don't save"]);
  });

  it('saves to a new entry in the group named like the folder, then connects', async () => {
    const { backend, user } = await asked([unlocked], { folder: 'prod' });
    await vi.waitFor(() =>
      expect(
        within(saveTo())
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['keychain', 'KeePass', "don't save"]),
    );
    await user.selectOptions(saveTo(), 'KeePass');
    expect(screen.getByLabelText('Group')).toHaveValue('Servers/Prod');
    await user.type(screen.getByLabelText('Password'), 'hunter2{Enter}');
    expect(backend.sent('answerSecret')).toEqual([
      ['tab-1', ['hunter2'], { database: 'work', group: 'Servers/Prod' }],
    ]);
  });

  it('preselects the group used last when no group is named like the folder', async () => {
    await asked(
      [unlocked],
      { folder: 'elsewhere' },
      { database: 'work', group: 'Servers' },
    );
    await screen.findByRole('option', { name: 'KeePass' });
    await userEvent.selectOptions(saveTo(), 'KeePass');
    expect(screen.getByLabelText('Group')).toHaveValue('Servers');
  });

  it('asks for the master password of a locked database before it can connect', async () => {
    const { backend, user } = await asked([locked]);
    await screen.findByRole('option', { name: 'KeePass' });
    await user.selectOptions(saveTo(), 'KeePass');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await user.type(
      screen.getByLabelText('Master password for work'),
      'master{Enter}',
    );
    expect(backend.sent('unlockKeepass')).toEqual([['work', 'master']]);
    backend.keepassDbs = [unlocked];
    expect(await screen.findByLabelText('Group')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(backend.sent('answerSecret')).toEqual([
      ['tab-1', ['hunter2'], { database: 'work', group: '' }],
    ]);
  });
});

describe('Set secret…', () => {
  it('saves a new secret to KeePass on Save', async () => {
    const { backend, user } = await setup();
    backend.keepassDbs = [unlocked];
    await newSession(user);
    await user.click(button('Set secret…'));
    const set = screen.getByRole('form', { name: 'Set secret' });
    await user.type(within(set).getByLabelText('Secret'), 'hunter2');
    await user.selectOptions(
      await within(set).findByLabelText('Save to'),
      'KeePass',
    );
    await user.selectOptions(within(set).getByLabelText('Group'), 'Servers');
    await user.click(within(set).getByRole('button', { name: 'Set' }));
    expect(dialog()).toHaveTextContent(
      'New password, saved to KeePass work / Servers on Save',
    );
    await user.click(button('Save'));
    expect(backend.sent('saveSession')[0][2]).toEqual({
      set: {
        kind: 'password',
        secret: 'hunter2',
        keepass: { database: 'work', group: 'Servers' },
      },
    });
  });
});

describe('deleting a KeePass secret', () => {
  const sessions = [{ alias: 'db', credential: keepassRef }];
  const confirm = () => screen.findByRole('alertdialog', { name: 'Delete db' });

  async function askDelete(dbs: KeepassDatabase[]) {
    const { backend, user } = await setup(sessions, {
      db: keepassSession('bob'),
    });
    backend.keepassDbs = dbs;
    row('db').focus();
    await user.keyboard('{Delete}');
    const box = await confirm();
    await user.click(
      within(box).getByRole('checkbox', {
        name: 'Also delete the saved secret from KeePass',
      }),
    );
    return { backend, user, box };
  }

  it('deletes the entry with the session when the database is unlocked', async () => {
    const { backend, user, box } = await askDelete([unlocked]);
    await user.click(within(box).getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() =>
      expect(backend.sent('deleteSession')).toEqual([['db', 'read-db', true]]),
    );
    expect(backend.sent('unlockKeepass')).toEqual([]);
  });

  it('asks for the master password of a locked database, and again after a wrong one', async () => {
    const { backend, user, box } = await askDelete([locked]);
    await user.click(within(box).getByRole('button', { name: 'Delete' }));
    const password = await within(box).findByLabelText(
      'Master password for work',
    );
    await user.type(password, 'nope{Enter}');
    expect(await within(box).findByRole('alert')).toHaveTextContent(
      'Wrong master password.',
    );
    expect(backend.sent('deleteSession')).toEqual([]);
    await user.clear(password);
    await user.type(password, 'master{Enter}');
    await vi.waitFor(() =>
      expect(backend.sent('deleteSession')).toEqual([['db', 'read-db', true]]),
    );
  });

  it('keeps the entry and says so when the user cancels the master password', async () => {
    const { backend, user, box } = await askDelete([locked]);
    await user.click(within(box).getByRole('button', { name: 'Delete' }));
    await within(box).findByLabelText('Master password for work');
    const unlock = within(box).getByRole('group', { name: 'Unlock KeePass' });
    await user.click(within(unlock).getByRole('button', { name: 'Cancel' }));
    expect(box).toHaveTextContent('The KeePass entry stays.');
    expect(
      within(box).getByRole('checkbox', {
        name: 'Also delete the saved secret from KeePass',
      }),
    ).not.toBeChecked();
    expect(backend.sent('deleteSession')).toEqual([]);
    await user.click(within(box).getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() =>
      expect(backend.sent('deleteSession')).toEqual([['db', 'read-db', false]]),
    );
  });

  it('sends the values it showed when the tree reloads under the open confirm', async () => {
    const { backend, user, box } = await askDelete([locked]);
    await user.click(within(box).getByRole('button', { name: 'Delete' }));
    await within(box).findByLabelText('Master password for work');
    act(() =>
      backend.emit({
        type: 'tree',
        tree: {
          ...backend.tree,
          sessions: [
            { alias: 'db', credential: { ...keepassRef, entry: 'work/b' } },
          ],
        },
      }),
    );
    await user.type(
      within(box).getByLabelText('Master password for work'),
      'master{Enter}',
    );
    await vi.waitFor(() =>
      expect(backend.sent('deleteSession')).toEqual([['db', 'read-db', true]]),
    );
  });

  it('asks for the master password of each locked database before a folder delete takes its entries', async () => {
    const { backend, user } = await setup(
      [{ alias: 'db', folder: 'Work', credential: keepassRef }],
      {},
      { folders: ['Work'] },
    );
    backend.keepassDbs = [locked];
    row('Work').focus();
    await user.keyboard('{Delete}');
    const box = await screen.findByRole('alertdialog', { name: 'Delete Work' });
    await user.click(
      within(box).getByRole('checkbox', {
        name: 'Also delete 1 saved secret from keychain / KeePass',
      }),
    );
    await user.click(within(box).getByRole('button', { name: 'Delete' }));
    const password = await within(box).findByLabelText(
      'Master password for work',
    );
    // A session synced into the folder under the open confirm must make a conflict, not a bigger delete.
    act(() =>
      backend.emit({
        type: 'tree',
        tree: {
          ...backend.tree,
          sessions: [
            ...backend.tree.sessions,
            { alias: 'new', folder: 'Work' },
          ],
        },
      }),
    );
    await user.type(password, 'master{Enter}');
    await vi.waitFor(() =>
      expect(backend.sent('deleteFolder')).toEqual([['Work', ['db'], true]]),
    );
  });
});

describe('Lock KeePass', () => {
  const treeMenu = (user: User) =>
    user.pointer({ keys: '[MouseRight]', target: tree() });

  it('is in the tree menu when this machine has a database, and locks them all', async () => {
    const { backend, user } = await setup();
    backend.savedSettings = {
      ...backend.savedSettings,
      keepassDatabases: [{ name: 'work', path: '/x/work.kdbx' }],
    };
    act(() =>
      backend.emit({ type: 'settings', settings: backend.savedSettings }),
    );
    await treeMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Lock KeePass' }));
    expect(backend.sent('lockKeepass')).toEqual([[]]);
  });

  it('is not in the menu without a database', async () => {
    const { user } = await setup();
    await treeMenu(user);
    await screen.findByRole('menuitem', {
      name: 'Reconnect all disconnected Tabs',
    });
    expect(screen.queryByRole('menuitem', { name: 'Lock KeePass' })).toBeNull();
  });
});
