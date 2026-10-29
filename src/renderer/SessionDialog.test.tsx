import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type {
  CredentialReference,
  SavedSession,
  SessionTree,
  TestStep,
} from '../shared/ipc.ts';
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

const dialog = () => screen.getByRole('dialog', { name: /SSH session|Edit/ });
const field = (name: string) => within(dialog()).getByRole('textbox', { name });
const save = () => within(dialog()).getByRole('button', { name: 'Save' });

const keychainRef = (entry: string): CredentialReference => ({
  provider: 'keychain',
  entry,
  kind: 'password',
});
const saved = (alias: string, patch: Partial<SavedSession> = {}) => ({
  alias,
  folder: '',
  hostname: `${alias}.lan`,
  port: '',
  user: '',
  identityFile: '',
  options: [],
  read: `read-${alias}`,
  ...patch,
});

async function setup(
  sessions: SessionTree['sessions'],
  stored: Record<string, SavedSession> = {},
  handWritten: string[] = [],
) {
  const backend = new FakeBackend();
  backend.tree = { folders: ['Work'], sessions, handWritten, warnings: [] };
  backend.savedSessions = stored;
  const user = userEvent.setup();
  render(<App backend={backend} mac={false} />);
  await vi.waitFor(() => expect(row(sessions[0].alias)).toBeDefined());
  return { backend, user };
}

async function openNew(user: User) {
  await user.click(screen.getByRole('button', { name: 'New' }));
  await user.click(screen.getByRole('menuitem', { name: 'SSH session' }));
}

async function openMenu(user: User, alias: string) {
  await user.pointer({ keys: '[MouseRight]', target: row(alias) });
  return screen.getByRole('menu');
}

async function edit(user: User, alias: string) {
  row(alias).focus();
  await user.keyboard('{F2}');
  return screen.findByRole('dialog', { name: `Edit ${alias}` });
}

describe('New and the command line', () => {
  it("creates a session from New in the selected row's folder, starting with ServerAliveInterval 15", async () => {
    const { backend, user } = await setup([{ alias: 'db', folder: 'Work' }]);
    await user.click(row('db'));
    await openNew(user);

    expect(
      within(dialog()).getByRole('combobox', { name: 'Folder' }),
    ).toHaveValue('Work');
    expect(field('Option 1')).toHaveValue('ServerAliveInterval 15');
    expect(
      within(dialog()).getByText(
        'Seconds between keepalives on an idle connection.',
      ),
    ).toBeInTheDocument();
    await user.type(field('Alias'), 'web');
    await user.type(field('HostName'), '10.0.0.5');
    await user.click(save());

    expect(backend.sent('saveSession')).toEqual([
      [
        {
          alias: 'web',
          folder: 'Work',
          hostname: '10.0.0.5',
          port: '',
          user: '',
          identityFile: '',
          options: ['ServerAliveInterval 15'],
        },
        undefined,
        {},
      ],
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rowTexts()).toContain('web');
  });

  it('shows the ssh -G value in grey in each empty part of the command line', async () => {
    const { backend, user } = await setup([{ alias: 'db' }]);
    await openNew(user);
    await user.type(field('Alias'), 'web');
    await vi.waitFor(() =>
      expect(field('HostName')).toHaveAttribute('placeholder', 'web'),
    );
    expect(field('Port')).toHaveAttribute('placeholder', '22');
    expect(field('User')).toHaveAttribute('placeholder', 'me');
    expect(field('IdentityFile')).toHaveAttribute(
      'placeholder',
      '~/.ssh/id_ed25519',
    );
    expect(backend.sent('sessionDefaults').at(-1)).toEqual([
      'web',
      ['ServerAliveInterval 15'],
    ]);
    expect(within(dialog()).getByText(/runs this command/)).toHaveTextContent(
      'Typing ssh web in a shell runs this command.',
    );
  });

  it('lowercases the alias as typed and checks its characters and that it is free, ignoring case', async () => {
    const { user } = await setup([{ alias: 'db' }], {}, ['Web1']);
    await openNew(user);
    const status = () => within(dialog()).getByText(/^Free$|alias|taken/);

    await user.type(field('Alias'), 'API');
    expect(field('Alias')).toHaveValue('api');
    expect(status()).toHaveTextContent('Free');
    expect(status()).toHaveClass('free');
    for (const [typed, problem] of [
      ['a x', 'No spaces in an alias.'],
      ['a*', 'No * in an alias.'],
      ['a?', 'No ? in an alias.'],
      ['a!', 'No ! in an alias.'],
      ['a,', 'No , in an alias.'],
      ['web1', 'web1 is already taken.'],
      ['DB', 'db is already taken.'],
    ]) {
      await user.clear(field('Alias'));
      await user.type(field('Alias'), typed);
      expect(status()).toHaveTextContent(problem);
      expect(status()).toHaveClass('problem');
      expect(save()).toBeDisabled();
    }
  });

  it('adds, describes, checks and removes option rows', async () => {
    const { backend, user } = await setup([{ alias: 'db' }]);
    await openNew(user);
    await user.type(field('Alias'), 'web');
    const add = () =>
      user.click(within(dialog()).getByRole('button', { name: '+ option' }));
    await add();
    expect(field('Option 2')).toHaveFocus();

    await user.type(field('Option 2'), 'Compression');
    expect(
      within(dialog()).getByText('Write it as Key value.'),
    ).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await user.type(field('Option 2'), ' yes');
    expect(
      within(dialog()).getByText(
        'Compresses the traffic, which helps on slow links.',
      ),
    ).toBeInTheDocument();

    await add();
    await user.type(field('Option 3'), 'Port 2222');
    expect(
      within(dialog()).getByText('Set this in the command line above.'),
    ).toBeInTheDocument();
    await user.clear(field('Option 3'));
    await user.type(field('Option 3'), 'ProxyJump bastion');
    expect(
      within(dialog()).getByText(/can't connect through a jump host/),
    ).toBeInTheDocument();
    expect(save()).toBeEnabled();

    await user.click(
      within(dialog()).getByRole('button', { name: 'Remove option 1' }),
    );
    await user.click(save());
    expect(backend.sent('saveSession')[0][0].options).toEqual([
      'Compression yes',
      'ProxyJump bastion',
    ]);
  });

  it('picks a key file and flags a path that works only on Windows', async () => {
    const { backend, user } = await setup([{ alias: 'db' }]);
    await openNew(user);
    const pick = () =>
      user.click(
        within(dialog()).getByRole('button', { name: 'Pick a key file' }),
      );
    await pick();
    expect(field('IdentityFile')).toHaveValue('~/.ssh/id_web');
    expect(within(dialog()).queryByText(/won't work on macOS/)).toBeNull();

    backend.keyFile = 'D:\\keys\\web';
    await pick();
    expect(field('IdentityFile')).toHaveValue('D:\\keys\\web');
    expect(within(dialog()).getByText(/won't work on macOS/)).toBeVisible();
  });
});

describe('Saved session menu', () => {
  it('lists Open Tab, Edit, Duplicate and a red Delete with their keys, and edits with Edit or F2', async () => {
    const { user } = await setup([{ alias: 'db' }], {
      db: saved('db', { port: '2222', options: ['Compression yes'] }),
    });
    const menu = await openMenu(user, 'db');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Open TabEnter',
      'EditF2',
      'Duplicate',
      'DeleteDel',
    ]);
    expect(items.map((i) => i.getAttribute('aria-keyshortcuts'))).toEqual([
      'Enter',
      'F2',
      null,
      'Delete',
    ]);
    expect(items[3].parentElement!.previousElementSibling).toHaveAttribute(
      'role',
      'separator',
    );
    expect(items[3]).toHaveClass('danger');

    await user.click(items[1]);
    expect(
      await screen.findByRole('dialog', { name: 'Edit db' }),
    ).toBeVisible();
    expect(field('Port')).toHaveValue('2222');
    expect(field('Option 1')).toHaveValue('Compression yes');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(await edit(user, 'db')).toBeVisible();
  });

  it('gives the focus back to the row when the dialog or the delete confirm closes', async () => {
    const { user } = await setup([{ alias: 'db' }], { db: saved('db') });
    await edit(user, 'db');
    expect(field('Alias')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(row('db')).toHaveFocus();

    await user.keyboard('{Delete}');
    await screen.findByRole('alertdialog', { name: 'Delete db' });
    await user.keyboard('{Escape}');
    expect(row('db')).toHaveFocus();
  });

  it('keeps Hand-written hosts read-only: no session menu and no F2', async () => {
    const { backend, user } = await setup([{ alias: 'db' }], {}, ['web1']);
    const menu = await openMenu(user, 'web1');
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    await user.keyboard('{Escape}');
    row('web1').focus();
    await user.keyboard('{F2}');
    expect(backend.sent('getSession')).toEqual([]);
  });

  it('renames in place: the Tabs, tree and header bar follow at once', async () => {
    const { backend, user } = await setup([{ alias: 'db' }], {
      db: saved('db'),
    });
    await user.dblClick(row('db'));
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
    await edit(user, 'db');
    expect(within(dialog()).getByText('Free')).toBeInTheDocument();

    await user.clear(field('Alias'));
    await user.type(field('Alias'), 'db-prod');
    await user.click(save());

    expect(backend.sent('saveSession')[0][1]).toEqual({
      alias: 'db',
      read: 'read-db',
    });
    expect(rowTexts()).toEqual(['db-prod', 'db-prod', 'Work']);
    expect(unsaved()).toBeNull();
    expect(screen.getByRole('banner')).toHaveTextContent('db-prod');
  });

  it('shows a conflict from Save and keeps the dialog open', async () => {
    const { backend, user } = await setup([{ alias: 'db' }], {
      db: saved('db'),
    });
    backend.saveError =
      'db changed in slop-term.conf or slop-term.json since it was opened. Cancel and open it again.';
    await edit(user, 'db');
    await user.click(save());
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'db changed in slop-term.conf',
    );
    expect(save()).toBeEnabled();
  });

  it('duplicates into the New form with every field, the same secret and the next free alias', async () => {
    const credential = keychainRef('a@db');
    const { backend, user } = await setup(
      [{ alias: 'db', folder: 'Work', credential }, { alias: 'db-2' }],
      { db: saved('db', { folder: 'Work', user: 'alice', credential }) },
    );
    await user.click(
      within(await openMenu(user, 'db')).getByRole('menuitem', {
        name: 'Duplicate',
      }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'New SSH session' }),
    ).toBeVisible();
    expect(field('Alias')).toHaveValue('db-3');
    expect(field('User')).toHaveValue('alice');
    expect(
      within(dialog()).getByText('Password in keychain: a@db'),
    ).toBeVisible();
    expect(backend.sent('saveSession')).toEqual([]);

    await user.click(save());
    expect(backend.sent('saveSession')[0]).toEqual([
      {
        alias: 'db-3',
        folder: 'Work',
        hostname: 'db.lan',
        port: '',
        user: 'alice',
        identityFile: '',
        options: [],
        credential,
      },
      undefined,
      {},
    ]);
  });
});

describe('Secret row', () => {
  it('sets a secret in a popover, a passphrase by default when a key file is set', async () => {
    const { backend, user } = await setup([{ alias: 'db' }], {
      db: saved('db', { identityFile: '~/.ssh/id_db' }),
    });
    await edit(user, 'db');
    await user.click(
      within(dialog()).getByRole('button', { name: 'Set secret…' }),
    );
    const popover = screen.getByRole('form', { name: 'Set secret' });
    expect(
      within(popover).getByRole('radio', { name: 'Key passphrase' }),
    ).toBeChecked();
    expect(
      within(popover).getByRole('combobox', { name: 'Save to' }),
    ).toHaveValue('keychain');
    await user.type(within(popover).getByLabelText('Secret'), 'sesame');
    await user.click(within(popover).getByRole('button', { name: 'Set' }));
    expect(
      within(dialog()).getByText(
        'New key passphrase, saved to keychain on Save',
      ),
    ).toBeVisible();

    await user.click(save());
    expect(backend.sent('saveSession')[0][2]).toEqual({
      set: { kind: 'passphrase', secret: 'sesame' },
    });
  });

  it('attaches the same secret as another session', async () => {
    const shared = keychainRef('a@api');
    const { backend, user } = await setup(
      [{ alias: 'api', credential: shared }, { alias: 'db' }, { alias: 'web' }],
      { db: saved('db') },
    );
    await edit(user, 'db');
    await user.click(
      within(dialog()).getByRole('button', { name: 'Attach existing…' }),
    );
    const popover = screen.getByRole('dialog', {
      name: 'Attach existing secret',
    });
    expect(
      within(popover).getByRole('tab', { name: 'Same secret as…' }),
    ).toHaveAttribute('aria-selected', 'true');
    await user.type(within(popover).getByRole('searchbox'), 'ap');
    await user.click(within(popover).getByRole('button', { name: /^api/ }));
    await user.click(save());
    expect(backend.sent('saveSession')[0][0].credential).toEqual(shared);
  });

  it('removes a secret with an unticked delete checkbox, or says a shared secret stays', async () => {
    const own = keychainRef('own');
    const shared = keychainRef('shared');
    const { backend, user } = await setup(
      [
        { alias: 'api', credential: shared },
        { alias: 'db', credential: own },
        { alias: 'web', credential: shared },
      ],
      {
        db: saved('db', { credential: own }),
        web: saved('web', { credential: shared }),
      },
    );
    await edit(user, 'db');
    await user.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    const box = within(dialog()).getByRole('checkbox', {
      name: 'Also delete the saved secret from keychain',
    });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(save());
    expect(backend.sent('saveSession')[0][0].credential).toBeUndefined();
    expect(backend.sent('saveSession')[0][2]).toEqual({ drop: own });

    await edit(user, 'web');
    await user.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    expect(within(dialog()).queryByRole('checkbox')).toBeNull();
    expect(
      within(dialog()).getByText('api uses the same secret, so it stays.'),
    ).toBeVisible();
  });
});

it('deletes nothing when a removed secret is replaced before Save', async () => {
  const own = keychainRef('own');
  const shared = keychainRef('shared');
  const { backend, user } = await setup(
    [
      { alias: 'api', credential: shared },
      { alias: 'db', credential: own },
    ],
    { db: saved('db', { credential: own }) },
  );
  await edit(user, 'db');
  await user.click(within(dialog()).getByRole('button', { name: 'Remove' }));
  await user.click(within(dialog()).getByRole('checkbox'));
  await user.click(
    within(dialog()).getByRole('button', { name: 'Attach existing…' }),
  );
  const popover = screen.getByRole('dialog', {
    name: 'Attach existing secret',
  });
  await user.click(within(popover).getByRole('button', { name: /^api/ }));
  expect(within(dialog()).queryByRole('checkbox')).toBeNull();
  await user.click(save());
  expect(backend.sent('saveSession')[0][0].credential).toEqual(shared);
  expect(backend.sent('saveSession')[0][2]).toEqual({});
});

describe('Test', () => {
  const checklist = () => within(dialog()).getByRole('list', { name: 'Test' });
  const step = (label: string) =>
    within(checklist()).getByText(label).closest('li')!;
  /** `passed` steps passed, and the next one failed when a `reason` is given. */
  const steps = (passed: number, reason?: string): TestStep[] =>
    ['resolved', 'reached web:22', 'host key', 'logged in as me', 'SFTP'].map(
      (label, i) =>
        i < passed
          ? { label, state: 'passed' }
          : i === passed && reason
            ? { label, state: 'failed', reason }
            : { label, state: 'waiting' },
    );

  it('sits left of Cancel and Save, tests the unsaved form with a secret set but not saved, and shows the first failure', async () => {
    const { backend, user } = await setup([{ alias: 'db' }]);
    await openNew(user);
    expect(
      within(dialog().querySelector('footer')!)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Test', 'Cancel', 'Save']);
    await user.type(field('Alias'), 'web');
    await user.click(
      within(dialog()).getByRole('button', { name: 'Set secret…' }),
    );
    const popover = screen.getByRole('form', { name: 'Set secret' });
    await user.type(within(popover).getByLabelText('Secret'), 'pw');
    await user.click(within(popover).getByRole('button', { name: 'Set' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Test' }));

    expect(backend.sent('testSession')).toEqual([
      [
        expect.objectContaining({ alias: 'web', hostname: '' }),
        { kind: 'password', secret: 'pw' },
      ],
    ]);
    act(() =>
      backend.emit({
        type: 'test',
        tab: 'test-1',
        steps: steps(1, 'connect ECONNREFUSED'),
      }),
    );
    expect(
      [...checklist().querySelectorAll('li')].map((li) => [
        li.className,
        li.textContent,
      ]),
    ).toEqual([
      ['passed', 'resolved'],
      ['failed', 'reached web:22connect ECONNREFUSED'],
      ['waiting', 'host key'],
      ['waiting', 'logged in as me'],
      ['waiting', 'SFTP'],
    ]);
    expect(within(step('reached web:22')).getByRole('alert')).toHaveTextContent(
      'connect ECONNREFUSED',
    );
    expect(
      within(dialog()).getByRole('button', { name: 'Test' }),
    ).toBeEnabled();
  });

  it('asks about the host key and the password inside their steps, and stops the Test when the dialog closes', async () => {
    const { backend, user } = await setup([{ alias: 'db' }]);
    await openNew(user);
    await user.type(field('Alias'), 'web');
    await user.click(within(dialog()).getByRole('button', { name: 'Test' }));
    expect(
      within(dialog()).getByRole('button', { name: 'Test' }),
    ).toBeDisabled();
    act(() => backend.emit({ type: 'test', tab: 'test-1', steps: steps(2) }));
    act(() =>
      backend.emit({
        type: 'hostKey',
        tab: 'test-1',
        question: {
          kind: 'unknown',
          alias: 'web',
          host: 'web:22',
          type: 'ssh-ed25519',
          fingerprint: 'SHA256:abc',
        },
      }),
    );
    // A question for a Tab with another id stays out of the dialog.
    act(() =>
      backend.emit({
        type: 'secret',
        tab: 'tab-9',
        question: { alias: 'x', title: 'Other', prompts: [] },
      }),
    );
    const hostKey = within(step('host key')).getByRole('region', {
      name: 'Host key',
    });
    expect(hostKey).toHaveTextContent('SHA256:abc');
    await user.click(
      within(hostKey).getByRole('button', { name: 'Trust and connect' }),
    );
    expect(backend.sent('answerHostKey')).toEqual([['test-1', true]]);

    act(() => {
      backend.emit({ type: 'hostKey', tab: 'test-1' });
      backend.emit({ type: 'test', tab: 'test-1', steps: steps(3) });
      backend.emit({
        type: 'secret',
        tab: 'test-1',
        question: {
          alias: 'web',
          title: 'Password for me@web',
          prompts: [{ prompt: 'Password', echo: false }],
        },
      });
    });
    expect(within(step('host key')).queryByRole('region')).toBeNull();
    const login = within(step('logged in as me')).getByRole('form', {
      name: 'Login',
    });
    expect(within(login).queryByRole('combobox')).toBeNull();
    await user.type(within(login).getByLabelText('Password'), 'hunter2{Enter}');
    expect(backend.sent('answerSecret')).toEqual([
      ['test-1', ['hunter2'], false],
    ]);

    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(backend.sent('close')).toEqual([['test-1']]);
  });
});

describe('Delete', () => {
  it('confirms with Cancel focused, names open Tabs and moves them to Unsaved', async () => {
    const own = keychainRef('own');
    const { backend, user } = await setup(
      [{ alias: 'db', credential: own }, { alias: 'web' }],
      { db: saved('db', { credential: own }) },
    );
    await user.dblClick(row('db'));
    await user.dblClick(row('db'));
    await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(2));
    await user.click(
      within(await openMenu(user, 'db')).getByRole('menuitem', {
        name: 'Delete',
      }),
    );
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Delete db',
    });
    expect(
      within(confirm).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    expect(within(confirm).getByRole('button', { name: 'Delete' })).toHaveClass(
      'danger',
    );
    expect(confirm).toHaveTextContent('2 Tabs are open. They stay open.');
    expect(
      within(confirm).getByRole('checkbox', {
        name: 'Also delete the saved secret from keychain',
      }),
    ).not.toBeChecked();

    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(backend.sent('deleteSession')).toEqual([['db', 'read-db', false]]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(
      within(unsaved()!).getAllByRole('button', { name: 'db' }),
    ).toHaveLength(2);
  });

  it('opens with the Delete key, says a shared secret stays and cancels with Escape', async () => {
    const shared = keychainRef('shared');
    const { backend, user } = await setup(
      [
        { alias: 'db', credential: shared },
        { alias: 'web', credential: shared },
      ],
      { db: saved('db', { credential: shared }) },
    );
    row('db').focus();
    await user.keyboard('{Delete}');
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Delete db',
    });
    expect(within(confirm).queryByRole('checkbox')).toBeNull();
    expect(confirm).toHaveTextContent('web uses the same secret, so it stays.');
    expect(confirm).not.toHaveTextContent('Tabs are open');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(backend.sent('deleteSession')).toEqual([]);
  });
});
