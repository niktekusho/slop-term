import { act, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CredentialReference, SavedSession } from '../shared/ipc.ts';
import {
  button,
  dialog,
  field,
  newSession,
  popover,
  row,
  setup,
  type User,
} from './test-utils.tsx';

const tpmRef: CredentialReference = {
  provider: 'tpm',
  entry: '42',
  kind: 'password',
};
const bob = { id: '42', name: 'web prod', username: 'bob' };
/** Saved session `db`, which reads its password from TPM entry 42 and logs in as `user`. */
const tpmSession = (user: string): SavedSession => ({
  alias: 'db',
  folder: '',
  hostname: 'db.lan',
  port: '',
  user,
  identityFile: '',
  options: [],
  credential: tpmRef,
  read: 'read-db',
});

async function findInTpm(user: User, query: string) {
  await user.click(button('Attach existing…'));
  await user.click(within(popover()).getByRole('tab', { name: 'TPM' }));
  await user.type(
    within(popover()).getByRole('textbox', { name: 'TPM URL, id or search' }),
    query,
  );
  await user.click(within(popover()).getByRole('button', { name: 'Find' }));
}

it('attaches a TPM entry by its pasted id and copies its username into User', async () => {
  const { backend, user } = await setup();
  backend.tpmFind = { entries: [bob] };
  await newSession(user);
  await findInTpm(user, '42');
  expect(backend.sent('findTpm')).toEqual([['42']]);
  await user.click(
    within(popover()).getByRole('button', { name: 'web prod bob' }),
  );

  expect(
    screen.queryByRole('dialog', { name: 'Attach existing secret' }),
  ).toBeNull();
  expect(field('User')).toHaveValue('bob');
  expect(dialog()).toHaveTextContent('Password in TPM: web prod (42)');
  await user.click(button('Save'));
  expect(backend.sent('saveSession')[0][0]).toMatchObject({
    user: 'bob',
    credential: tpmRef,
  });
});

it('keeps User for an entry with no username, and lists every search result', async () => {
  const { backend, user } = await setup();
  backend.tpmFind = {
    entries: [bob, { id: '44', name: 'shared root', username: '' }],
  };
  await newSession(user);
  await user.type(field('User'), 'alice');
  await findInTpm(user, 'web');
  await user.click(
    within(popover()).getByRole('button', { name: 'shared root' }),
  );
  expect(field('User')).toHaveValue('alice');
  expect(dialog()).not.toHaveTextContent('TPM entry says');
});

it('asks for the API keys when TPM needs them, saves them and finds again', async () => {
  const { backend, user } = await setup();
  backend.tpmFind = { keys: 'TPM rejected the API keys.' };
  await newSession(user);
  await findInTpm(user, '42');
  expect(popover()).toHaveTextContent('TPM rejected the API keys.');

  backend.tpmFind = { entries: [bob] };
  await user.type(
    within(popover()).getByRole('textbox', { name: 'Public key' }),
    'pub',
  );
  await user.type(within(popover()).getByLabelText('Private key'), 'priv');
  await user.click(
    within(popover()).getByRole('button', { name: 'Save keys' }),
  );
  expect(backend.sent('setTpmKeys')).toEqual([['pub', 'priv']]);
  expect(backend.sent('findTpm')).toEqual([['42'], ['42']]);
  expect(
    await within(popover()).findByRole('button', { name: 'web prod bob' }),
  ).toBeInTheDocument();
});

it("shows why TPM can't answer", async () => {
  const { backend, user } = await setup();
  backend.tpmFind = new Error("TPM isn't set up on this machine.");
  await newSession(user);
  await findInTpm(user, '42');
  expect(await within(popover()).findByRole('alert')).toHaveTextContent(
    "TPM isn't set up on this machine.",
  );
});

it('shows a username mismatch inline, and Use bob fixes User', async () => {
  const { backend, user } = await setup();
  backend.tpmFind = { entries: [bob] };
  await newSession(user);
  await findInTpm(user, '42');
  await user.click(
    within(popover()).getByRole('button', { name: 'web prod bob' }),
  );
  await user.clear(field('User'));
  await user.type(field('User'), 'alice');
  expect(dialog()).toHaveTextContent(
    'TPM entry says bob, this Saved session says alice.',
  );
  await user.click(button('Use bob'));
  expect(field('User')).toHaveValue('bob');
  expect(dialog()).not.toHaveTextContent('TPM entry says');
});

it("reads a TPM session's entry when its edit opens, to show a mismatch", async () => {
  const { backend, user } = await setup([{ alias: 'db', credential: tpmRef }], {
    db: tpmSession('alice'),
  });
  backend.tpmFind = { entries: [bob] };
  row('db').focus();
  await user.keyboard('{F2}');
  await screen.findByRole('dialog', { name: 'Edit db' });
  expect(backend.sent('findTpm')).toEqual([['42']]);
  expect(
    await within(dialog()).findByText(
      'TPM entry says bob, this Saved session says alice.',
    ),
  ).toBeInTheDocument();
});

it('offers no delete-secret checkbox for a TPM entry and says it stays, on Remove or on Delete', async () => {
  const { backend, user } = await setup([{ alias: 'db', credential: tpmRef }], {
    db: tpmSession('bob'),
  });
  backend.tpmFind = { entries: [bob] };
  row('db').focus();
  await user.keyboard('{F2}');
  await screen.findByRole('dialog', { name: 'Edit db' });
  await user.click(button('Remove'));
  expect(within(dialog()).queryByRole('checkbox')).toBeNull();
  expect(dialog()).toHaveTextContent('The TPM entry stays in TPM.');
  await user.click(button('Cancel'));

  row('db').focus();
  await user.keyboard('{Delete}');
  const confirm = await screen.findByRole('alertdialog', { name: 'Delete db' });
  expect(within(confirm).queryByRole('checkbox')).toBeNull();
  expect(confirm).toHaveTextContent('The TPM entry stays in TPM.');
});

it('offers Use bob on a Tab blocked by a mismatch, saves User and reconnects', async () => {
  const stored = tpmSession('alice');
  const { backend, user } = await setup([{ alias: 'db', credential: tpmRef }], {
    db: stored,
  });
  await user.click(
    screen.getByRole('button', { name: 'Open another Tab of db' }),
  );
  await vi.waitFor(() => expect(backend.sent('openSsh')).toHaveLength(1));
  act(() =>
    backend.emit({
      type: 'dropped',
      tab: 'tab-1',
      reason: 'TPM entry says bob, this Saved session says alice.',
      user: 'bob',
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Use bob' }));
  await vi.waitFor(() => expect(backend.sent('restart')).toEqual([['tab-1']]));
  const { read: _, ...form } = stored;
  expect(backend.sent('saveSession')).toEqual([
    [
      { ...form, user: 'bob' },
      { alias: 'db', read: 'read-db' },
    ],
  ]);
  expect(screen.queryByRole('button', { name: 'Use bob' })).toBeNull();
});
