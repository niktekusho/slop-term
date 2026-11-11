import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import {
  defaultSettings,
  sessionColours,
  type LocalShellForm,
  type SessionTree,
  type Settings,
} from '../shared/ipc.ts';
import { FakeBackend } from './fake-backend.ts';
import { manyTabsTimeout } from './test-utils.tsx';

const tree = () => screen.getByRole('navigation', { name: 'Session tree' });
const row = (name: string) =>
  [...tree().querySelectorAll<HTMLElement>('.row')].find(
    (r) => r.textContent === name,
  )!;
const dialog = () => screen.getByRole('dialog');
const colourSelect = () =>
  within(dialog()).getByRole<HTMLSelectElement>('combobox', { name: 'Colour' });
const terminalStyles = () =>
  [...screen.getByRole('main').querySelectorAll('style')]
    .map((style) => style.textContent)
    .join('');

const box: LocalShellForm = {
  name: 'box',
  folder: '',
  kind: 'bash',
  distro: '',
  startFolder: '',
  command: '',
};

function setup(model: Partial<SessionTree>, settings: Partial<Settings> = {}) {
  const backend = new FakeBackend();
  backend.tree = { ...backend.tree, ...model };
  backend.savedSettings = { ...defaultSettings, ...settings };
  const user = userEvent.setup();
  render(<App backend={backend} mac={false} />);
  return { backend, user };
}

// The spec's shades, dark then light.
const shades = {
  red: ['#e5484d', '#ce2c31'],
  orange: ['#f76b15', '#c2490c'],
  yellow: ['#f5d90a', '#946800'],
  green: ['#46a758', '#2a7e3b'],
  blue: ['#3e8bff', '#1f5fd6'],
  purple: ['#a06cf0', '#7a3fc6'],
  pink: ['#e5469f', '#c0237f'],
  grey: ['#8b8d98', '#60646c'],
};

// WCAG 2 relative luminance and contrast ratio of `rgb(r, g, b)` strings.
const luminance = (rgb: string) => {
  const [r, g, b] = rgb
    .match(/\d+/g)!
    .map(Number)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

describe('Session colours', () => {
  it.each(['dark', 'light'] as const)(
    'fills the header with each shade in %s mode, with the text colour that contrasts more',
    async (theme) => {
      const { user } = setup(
        {
          sessions: sessionColours.map((colour) => ({ alias: colour, colour })),
        },
        { theme },
      );
      await vi.waitFor(() => expect(row('red')).toBeDefined());
      for (const colour of sessionColours) {
        await user.dblClick(row(colour));
        const header = screen.getByRole('banner');
        await vi.waitFor(() => expect(header).toHaveTextContent(colour));
        const shade = rgb(shades[colour][theme === 'dark' ? 0 : 1]);
        expect(header.style.backgroundColor).toBe(shade);
        const [black, white] = ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'];
        const text = header.style.color;
        expect([black, white]).toContain(text);
        const other = text === black ? white : black;
        expect(contrast(text, shade)).toBeGreaterThan(contrast(other, shade));
      }
    },
    manyTabsTimeout,
  );

  it('keeps the plain header for a Tab without a colour', async () => {
    const { user } = setup({ sessions: [{ alias: 'web' }] });
    await vi.waitFor(() => expect(row('web')).toBeDefined());
    await user.dblClick(row('web'));
    const header = screen.getByRole('banner');
    await vi.waitFor(() => expect(header).toHaveTextContent('web'));
    expect(header.style.backgroundColor).toBe('');
  });

  it('mixes the terminal background sessionColourTint percent toward the shade, and not at all at 0', async () => {
    // Light mode: #ffffff mixed 10% toward Red #ce2c31.
    const tinted = '#faeaea';
    const first = setup({ sessions: [{ alias: 'prod', colour: 'red' }] });
    await vi.waitFor(() => expect(row('prod')).toBeDefined());
    await first.user.dblClick(row('prod'));
    await vi.waitFor(() => expect(terminalStyles()).toContain(tinted));
    first.backend.emit({
      type: 'settings',
      settings: { ...defaultSettings, sessionColourTint: 0 },
    });
    await vi.waitFor(() => expect(terminalStyles()).not.toContain(tinted));
    expect(terminalStyles()).toContain('#ffffff');
  });

  it('shows a dot on the Saved session row only, not on its Tab rows or on uncoloured sessions', async () => {
    const { user } = setup({
      sessions: [{ alias: 'prod', colour: 'red' }, { alias: 'web' }],
      localShells: [{ ...box, colour: 'blue' }],
    });
    await vi.waitFor(() => expect(row('prod')).toBeDefined());
    await user.dblClick(row('prod'));
    await vi.waitFor(() =>
      expect(tree().querySelectorAll('.tab .row')).toHaveLength(1),
    );
    const dots = [...tree().querySelectorAll('.dot')];
    expect(dots.map((d) => d.closest('.row'))).toEqual([
      row('box'),
      row('prod'),
    ]);
    expect(tree().querySelector('.tab .dot')).toBeNull();
  });

  it('saves the colour picked in the SSH dialog and shows the stored one in an edit', async () => {
    const { backend, user } = setup({ sessions: [{ alias: 'web' }] });
    backend.savedSessions = {
      web: {
        alias: 'web',
        folder: '',
        hostname: '',
        port: '',
        user: '',
        identityFile: '',
        options: [],
        colour: 'green',
        read: 'r',
      },
    };
    await vi.waitFor(() => expect(row('web')).toBeDefined());
    row('web').focus();
    await user.keyboard('{F2}');
    await screen.findByRole('dialog', { name: 'Edit web' });
    expect(colourSelect().value).toBe('green');
    expect([...colourSelect().options].map((o) => o.textContent)).toEqual([
      'None',
      'Red',
      'Orange',
      'Yellow',
      'Green',
      'Blue',
      'Purple',
      'Pink',
      'Grey',
    ]);
    await user.selectOptions(colourSelect(), 'Red');
    await user.click(within(dialog()).getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(screen.getByRole('menuitem', { name: 'SSH session' }));
    expect(colourSelect().value).toBe('');
    await user.type(
      within(dialog()).getByRole('textbox', { name: 'Alias' }),
      'db',
    );
    await user.click(within(dialog()).getByRole('button', { name: 'Save' }));

    expect(backend.sent('saveSession').map(([form]) => form.colour)).toEqual([
      'red',
      undefined,
    ]);
  });

  it('saves the colour picked in the Local shell dialog, and None clears it', async () => {
    const { backend, user } = setup({
      localShells: [{ ...box, colour: 'blue' }],
    });
    backend.savedLocalShells = { box: { ...box, colour: 'blue', read: 'r' } };
    await vi.waitFor(() => expect(row('box')).toBeDefined());
    row('box').focus();
    await user.keyboard('{F2}');
    await screen.findByRole('dialog', { name: 'Edit box' });
    expect(colourSelect().value).toBe('blue');
    await user.selectOptions(colourSelect(), 'None');
    await user.click(within(dialog()).getByRole('button', { name: 'Save' }));

    expect(backend.sent('saveLocalShell')[0][0].colour).toBeUndefined();
  });
});
