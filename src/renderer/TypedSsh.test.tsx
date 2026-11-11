import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  SecretQuestion,
  SessionTree,
  Shell,
  TypedSsh,
} from '../shared/ipc.ts';
import { App } from './App.tsx';
import { FakeBackend } from './fake-backend.ts';
import { row, tree } from './test-utils.tsx';

const pane = () => screen.getByRole('complementary', { name: 'SFTP pane' });
const paneButton = (name: string) =>
  within(pane()).getByRole('button', { name });
const card = () => within(pane()).getByRole('form', { name: 'Login' });

const waiting: TypedSsh = {
  alias: 'web1',
  user: 'test',
  host: 'web1.lan',
  port: 22,
  state: 'waiting',
};

/** Opens unsaved local shell Tab `tab-1` of `shell` over a tree with `patch`. */
async function setup({
  shell = { kind: 'zsh' } as Shell,
  patch = {} as Partial<SessionTree>,
} = {}) {
  const backend = new FakeBackend();
  backend.shells = [shell];
  backend.tree = { ...backend.tree, ...patch };
  backend.remote = { '/home/test': [], '/srv': [] };
  backend.remoteHome = '/home/test';
  const user = userEvent.setup();
  render(<App backend={backend} mac={false} />);
  await user.click(
    await screen.findByRole('button', { name: 'New local shell' }),
  );
  await user.click(screen.getByRole('menuitem', { name: /zsh|wsl/ }));
  await vi.waitFor(() =>
    expect(backend.sent('openLocalShell')).toHaveLength(1),
  );
  const typed = (ssh?: TypedSsh) =>
    act(() => backend.emit({ type: 'typedSsh', tab: 'tab-1', ssh }));
  const ask = (question?: SecretQuestion) =>
    act(() =>
      backend.emit({ type: 'secret', tab: 'tab-1', question, pane: true }),
    );
  return { backend, user, typed, ask };
}

const question = (extra: Partial<SecretQuestion> = {}): SecretQuestion => ({
  alias: 'web1',
  title: 'Log in to test@web1.lan',
  prompts: [{ prompt: 'Password', echo: false }],
  ...extra,
});

describe('SFTP pane for a typed ssh', () => {
  it('offers "Browse files on" while the pane waits, browses once connected and shows the hint again when ssh exits', async () => {
    const { backend, user, typed } = await setup();
    typed(waiting);
    expect(
      within(pane()).getByRole('combobox', { name: 'Browse files of...' }),
    ).toBeInTheDocument();
    await user.click(paneButton('Browse files on test@web1.lan'));
    expect(backend.sent('browseFiles')).toEqual([['tab-1', undefined]]);
    typed({ ...waiting, state: 'connecting' });
    expect(pane()).toHaveTextContent('Connecting to test@web1.lan');
    // An OSC 7 from the remote shell before the pane connects picks the folder it opens in.
    act(() =>
      backend.emit({
        type: 'tab',
        tab: 'tab-1',
        folder: '/srv',
        host: 'web1',
        firstHost: 'web1',
      }),
    );
    typed({ ...waiting, state: 'connected' });
    await vi.waitFor(() =>
      expect(within(pane()).getByRole('textbox', { name: 'Path' })).toHaveValue(
        '/srv',
      ),
    );
    // A drop keeps the listing, greyed, under the reason and the pane's own Reconnect.
    typed({ ...waiting, state: 'dropped', reason: 'Connection closed.' });
    expect(within(pane()).getByRole('grid').closest('.file-list')).toHaveClass(
      'greyed',
    );
    expect(paneButton('Reconnect')).toBeInTheDocument();
    typed({
      ...waiting,
      state: 'connected',
      notice: 'Not saved: KeePass says no.',
    });
    expect(within(pane()).getByRole('status')).toHaveTextContent(
      'Not saved: KeePass says no.',
    );
    typed(undefined);
    expect(pane()).toHaveTextContent('No remote host');
    expect(within(pane()).queryByRole('grid')).toBeNull();
  });

  it("ignores a local prompt's OSC 7 while no ssh runs", async () => {
    const { backend, typed } = await setup();
    act(() =>
      backend.emit({
        type: 'tab',
        tab: 'tab-1',
        folder: '/Users/me/src',
        host: 'laptop',
        firstHost: '',
      }),
    );
    typed({ ...waiting, state: 'connected' });
    await vi.waitFor(() =>
      expect(within(pane()).getByRole('textbox', { name: 'Path' })).toHaveValue(
        '/home/test',
      ),
    );
  });

  it('shows why the pane dropped, with its own Reconnect, and the jump host message without a button', async () => {
    const { backend, user, typed } = await setup();
    typed({ ...waiting, state: 'dropped', reason: 'Connection closed.' });
    expect(pane()).toHaveTextContent('Connection closed.');
    await user.click(paneButton('Reconnect'));
    expect(backend.sent('browseFiles')).toEqual([['tab-1', undefined]]);
    typed({ ...waiting, jumpHost: true });
    expect(pane()).toHaveTextContent(
      "This host uses a jump host. slop-term v1 can't connect to it.",
    );
    expect(
      within(pane()).queryByRole('button', { name: /Browse files on/ }),
    ).toBeNull();
  });

  it('asks in its own card, with an alias prefilled from the host and a folder, and creates the Saved session', async () => {
    const { backend, user, typed, ask } = await setup({
      patch: { folders: ['prod', 'test'] },
    });
    backend.keepassDbs = [{ name: 'work', locked: false, groups: [] }];
    typed({ ...waiting, state: 'connecting' });
    ask(question({ save: 'create', folder: 'prod' }));
    expect(card()).toHaveTextContent('Log in to test@web1.lan');
    expect(card()).toHaveTextContent(
      "This logs in the SFTP pane only. The terminal's ssh asks on its own.",
    );
    // The card is the pane's: nothing shows over the terminal.
    expect(screen.getAllByRole('form', { name: 'Login' })).toHaveLength(1);
    const radios = () => within(card()).getAllByRole('radio');
    await vi.waitFor(() =>
      expect(radios().map((r) => r.closest('label')!.textContent)).toEqual([
        'Windows Credential Manager',
        'KeePass work',
        "Don't save",
      ]),
    );
    expect(radios()[0]).toBeChecked();
    expect(within(card()).getByRole('textbox', { name: 'Alias' })).toHaveValue(
      'web1',
    );
    expect(
      within(card()).getByRole('combobox', { name: 'Folder' }),
    ).toHaveValue('prod');
    expect(card()).toHaveTextContent('Creates SSH Saved session web1 in prod.');
    // A tree reload under the open card keeps what it shows.
    act(() =>
      backend.emit({
        type: 'tree',
        tree: { ...backend.tree, folders: ['prod', 'test', 'staging'] },
      }),
    );
    expect(within(card()).getByRole('textbox', { name: 'Alias' })).toHaveValue(
      'web1',
    );
    expect(card()).toHaveTextContent('Creates SSH Saved session web1 in prod.');
    await user.type(within(card()).getByLabelText('Password'), 'pw');
    await user.selectOptions(
      within(card()).getByRole('combobox', { name: 'Folder' }),
      'Top level',
    );
    await user.click(within(card()).getByRole('button', { name: 'Connect' }));
    expect(backend.sent('answerSecret')).toEqual([
      ['tab-1', ['pw'], true, { alias: 'web1', folder: '' }],
    ]);
    // The card stays until the back end closes the question.
    ask(undefined);
    expect(within(pane()).queryByRole('form', { name: 'Login' })).toBeNull();
  });

  it('prefills <user>-<host> when the host alias is taken, checks the alias as typed, and hides it for "Don\'t save"', async () => {
    const { backend, user, typed, ask } = await setup({
      patch: { sessions: [{ alias: 'web1' }] },
    });
    typed({ ...waiting, state: 'connecting' });
    ask(question({ save: 'create' }));
    const alias = within(card()).getByRole('textbox', { name: 'Alias' });
    expect(alias).toHaveValue('test-web1');
    await user.clear(alias);
    await user.type(alias, 'web1');
    expect(card()).toHaveTextContent('web1 is already taken.');
    expect(
      within(card()).getByRole('button', { name: 'Connect' }),
    ).toBeDisabled();
    await user.click(within(card()).getByRole('radio', { name: "Don't save" }));
    expect(within(card()).queryByRole('textbox', { name: 'Alias' })).toBeNull();
    await user.type(within(card()).getByLabelText('Password'), 'pw');
    await user.click(within(card()).getByRole('button', { name: 'Connect' }));
    expect(backend.sent('answerSecret')).toEqual([
      ['tab-1', ['pw'], false, undefined],
    ]);
  });

  it('attaches to a matched session without asking for an alias, and tells a Hand-written host to move in', async () => {
    const { backend, user, typed, ask } = await setup();
    typed({ ...waiting, state: 'connecting', session: 'web1' });
    ask(question({ save: 'new' }));
    expect(within(card()).queryByRole('textbox', { name: 'Alias' })).toBeNull();
    await user.type(within(card()).getByLabelText('Password'), 'pw');
    await user.click(within(card()).getByRole('button', { name: 'Connect' }));
    expect(backend.sent('answerSecret')).toEqual([
      ['tab-1', ['pw'], true, undefined],
    ]);
    ask(question({ moveIn: 'web1' }));
    expect(card()).toHaveTextContent(
      'Move web1 into slop-term to save its password.',
    );
    expect(within(card()).queryAllByRole('radio')).toEqual([]);
  });

  it("shows the pane's host key question inside the pane", async () => {
    const { backend, user, typed } = await setup();
    typed({ ...waiting, state: 'connecting' });
    act(() =>
      backend.emit({
        type: 'hostKey',
        tab: 'tab-1',
        pane: true,
        question: {
          alias: 'web1',
          host: 'web1.lan:22',
          type: 'ssh-ed25519',
          fingerprint: 'SHA256:abc',
          kind: 'unknown',
        },
      }),
    );
    const prompt = within(pane()).getByRole('region', { name: 'Host key' });
    await user.click(within(prompt).getByRole('button', { name: /Trust/ }));
    expect(backend.sent('answerHostKey')).toEqual([['tab-1', true]]);
  });

  it('offers "Browse files of..." over SSH Saved sessions in every local shell Tab', async () => {
    const { backend, user } = await setup({
      patch: { sessions: [{ alias: 'db' }], handWritten: ['old'] },
    });
    const picker = within(pane()).getByRole('combobox', {
      name: 'Browse files of...',
    });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Browse files of...', 'db', 'old']);
    await user.selectOptions(picker, 'db');
    expect(backend.sent('browseFiles')).toEqual([['tab-1', 'db']]);
  });

  it("offers only the picker in a WSL Tab, and says the pane can't see ssh there", async () => {
    await setup({
      shell: { kind: 'wsl', distro: 'Ubuntu' },
      patch: { sessions: [{ alias: 'db' }] },
    });
    expect(pane()).toHaveTextContent("The pane can't see ssh inside WSL.");
    expect(pane()).not.toHaveTextContent('Type ssh <host>');
    expect(
      within(pane()).getByRole('combobox', { name: 'Browse files of...' }),
    ).toBeInTheDocument();
  });

  it('stops browsing a picked Saved session', async () => {
    const { backend, user, typed } = await setup({
      patch: { sessions: [{ alias: 'db' }] },
    });
    typed({
      ...waiting,
      alias: 'db',
      session: 'db',
      picked: true,
      state: 'connected',
    });
    await user.click(
      await within(pane()).findByRole('button', { name: 'Stop browsing' }),
    );
    expect(backend.sent('stopBrowsing')).toEqual([['tab-1']]);
  });

  it("shows → <alias> on the Unsaved Tab row and the matched session's colour while ssh runs", async () => {
    const { typed } = await setup({
      patch: { sessions: [{ alias: 'web1', colour: 'red' }] },
    });
    const header = screen.getByRole('banner');
    expect(header.style.backgroundColor).toBe('');
    typed({ ...waiting, session: 'web1' });
    expect(
      within(tree())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toContain('zsh → web1');
    expect(header.style.backgroundColor).not.toBe('');
    expect(row('web1')).toBeDefined();
    // A picked Saved session has no `ssh` running: the Tab keeps its own look.
    typed({ ...waiting, session: 'web1', picked: true });
    expect(header.style.backgroundColor).toBe('');
  });
});
