import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImportRow } from '../shared/ipc.ts';
import { App } from './App.tsx';
import { FakeBackend } from './fake-backend.ts';
import { row as treeRow } from './test-utils.tsx';

const ssh = (patch: Partial<ImportRow>): ImportRow => ({
  name: 'Web 01',
  kind: 'ssh',
  alias: 'web-01',
  folder: '',
  hostname: 'web01.lan',
  port: '22',
  user: 'deploy',
  identityFile: '',
  comment: '',
  ticked: true,
  problems: [],
  ...patch,
});

const rows: ImportRow[] = [
  ssh({ colour: 'red' }),
  ssh({
    name: 'db',
    alias: 'db',
    folder: 'Work',
    hostname: 'db.lan',
    ticked: false,
    problems: ['Already in SSH config as database.'],
  }),
  ssh({
    name: 'Ubuntu',
    kind: 'wsl',
    alias: 'ubuntu',
    hostname: '',
    port: '',
    user: '',
    problems: ['Opens your default WSL distro.'],
  }),
  ssh({
    name: 'Desktop',
    kind: 'skipped',
    alias: 'desktop',
    hostname: '',
    ticked: false,
    problems: ['RDP sessions are not imported.'],
  }),
];

async function setup() {
  const backend = new FakeBackend();
  backend.tree = {
    folders: [],
    sessions: [{ alias: 'box' }],
    handWritten: [],
    localShells: [],
    warnings: [],
  };
  backend.importRows = rows;
  const user = userEvent.setup();
  render(<App backend={backend} mac={false} />);
  await vi.waitFor(() => expect(treeRow('box')).toBeDefined());
  return { backend, user };
}

const preview = () =>
  screen.getByRole('dialog', { name: 'Import from MobaXterm' });
const tick = (name: string) =>
  within(preview()).getByRole('checkbox', { name: `Import ${name}` });
const alias = (name: string) =>
  within(preview()).getByRole('textbox', { name: `Alias of ${name}` });
const importButton = () =>
  within(preview()).getByRole('button', { name: /^Import \d+/ });

async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New' }));
  await user.click(
    screen.getByRole('menuitem', { name: 'Import from MobaXterm…' }),
  );
  await vi.waitFor(() => expect(preview()).toBeDefined());
}

describe('the MobaXterm import preview', () => {
  it('opens the picker at the MobaXterm.ini found and lists every row with its problems', async () => {
    const { backend, user } = await setup();
    await openPreview(user);
    expect(backend.pickedImportFrom).toEqual([
      'C:\\Users\\me\\AppData\\Roaming\\MobaXterm\\MobaXterm.ini',
    ]);
    expect(backend.sent('previewImport')).toEqual([['C:\\moba\\picked.ini']]);
    expect(tick('Web 01')).toBeChecked();
    expect(tick('db')).not.toBeChecked();
    expect(tick('Desktop')).toBeDisabled();
    expect(preview()).toHaveTextContent('Already in SSH config as database.');
    expect(preview()).toHaveTextContent('Opens your default WSL distro.');
    expect(preview()).toHaveTextContent('RDP sessions are not imported.');
    expect(importButton()).toHaveAccessibleName('Import 2 sessions');
  });

  it('writes nothing when the picker is cancelled', async () => {
    const { backend, user } = await setup();
    backend.importFile = undefined;
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Import from MobaXterm…' }),
    );
    expect(backend.sent('previewImport')).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('checks an edited alias as it is typed and blocks the import while a ticked row has a problem', async () => {
    const { user } = await setup();
    await openPreview(user);
    await user.clear(alias('Web 01'));
    await user.type(alias('Web 01'), 'box');
    expect(preview()).toHaveTextContent('Already exists.');
    expect(alias('Web 01')).toHaveAttribute('aria-invalid', 'true');
    expect(importButton()).toBeDisabled();
    await user.type(alias('Web 01'), '-2');
    expect(preview()).not.toHaveTextContent('Already exists.');
    expect(importButton()).toBeEnabled();
  });

  it('imports the ticked rows as shown, with the edited alias and colour, and takes the tree it returns', async () => {
    const { backend, user } = await setup();
    await openPreview(user);
    await user.clear(alias('Web 01'));
    await user.type(alias('Web 01'), 'web');
    await user.selectOptions(
      within(preview()).getByRole('combobox', { name: 'Colour of Web 01' }),
      'Blue',
    );
    await user.click(tick('db'));
    await user.click(tick('Ubuntu'));
    // A reload under the open preview leaves the rows it shows alone.
    act(() =>
      backend.emit({
        type: 'tree',
        tree: {
          ...backend.tree,
          sessions: [{ alias: 'box' }, { alias: 'nas' }],
        },
      }),
    );
    backend.tree = { ...backend.tree, sessions: [{ alias: 'web' }] };
    await user.click(importButton());
    expect(backend.sent('importSessions')).toEqual([
      [
        [
          { ...rows[0], alias: 'web', colour: 'blue' },
          { ...rows[1], ticked: true },
        ],
      ],
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(treeRow('web')).toBeDefined();
  });

  it('shows why the import failed and keeps the preview open', async () => {
    const { backend, user } = await setup();
    backend.saveError = 'web-01: Already exists. Run the import again.';
    await openPreview(user);
    await user.click(importButton());
    expect(preview()).toHaveTextContent(
      'web-01: Already exists. Run the import again.',
    );
  });
});
