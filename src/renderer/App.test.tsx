import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import type { Shell } from '../shared/ipc.ts';
import { FakeBackend } from './fake-backend.ts';

function setup({
  mac = false,
  shells,
}: { mac?: boolean; shells?: Shell[] } = {}) {
  const backend = new FakeBackend();
  if (shells) backend.shells = shells;
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
