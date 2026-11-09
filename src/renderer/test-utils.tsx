import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';
import type { SavedSession, SessionTree } from '../shared/ipc.ts';
import { App } from './App.tsx';
import { FakeBackend } from './fake-backend.ts';

export type User = ReturnType<typeof userEvent.setup>;

export const tree = () =>
  screen.getByRole('navigation', { name: 'Session tree' });
export const row = (name: string) =>
  [...tree().querySelectorAll<HTMLElement>('.row')].find(
    (r) => r.textContent === name,
  )!;

/** The New or Edit SSH session dialog. */
export const dialog = () =>
  screen.getByRole('dialog', { name: /SSH session|Edit/ });
export const field = (name: string) =>
  within(dialog()).getByRole('textbox', { name });
export const button = (name: string) =>
  within(dialog()).getByRole('button', { name });
export const popover = () =>
  screen.getByRole('dialog', { name: 'Attach existing secret' });

/** Renders the app over a fake back end whose tree holds `sessions`, and waits for the first one's row. */
export async function setup(
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

/** Opens New > SSH session and fills the alias `web` and host `web.lan`. */
export async function newSession(user: User) {
  await user.click(screen.getByRole('button', { name: 'New' }));
  await user.click(screen.getByRole('menuitem', { name: 'SSH session' }));
  await user.type(field('Alias'), 'web');
  await user.type(field('HostName'), 'web.lan');
}
