import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import {
  defaultSettings,
  type SessionColour,
  type Settings,
} from '../shared/ipc.ts';

export type Mode = 'light' | 'dark';

const shades: Record<SessionColour, Record<Mode, string>> = {
  red: { dark: '#e5484d', light: '#ce2c31' },
  orange: { dark: '#f76b15', light: '#c2490c' },
  yellow: { dark: '#f5d90a', light: '#946800' },
  green: { dark: '#46a758', light: '#2a7e3b' },
  blue: { dark: '#3e8bff', light: '#1f5fd6' },
  purple: { dark: '#a06cf0', light: '#7a3fc6' },
  pink: { dark: '#e5469f', light: '#c0237f' },
  grey: { dark: '#8b8d98', light: '#60646c' },
};

export const sessionShade = (colour: SessionColour, mode: Mode) =>
  shades[colour][mode];

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** `amount` from 0 to 1 moves `from` toward `to`. */
const mix = (from: string, to: string, amount: number) => {
  const target = channels(to);
  return `#${channels(from)
    .map((c, i) =>
      Math.round(c + (target[i] - c) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

// WCAG 2 relative luminance.
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The header bar of a Tab with a Session colour: the shade, with black or white text, whichever contrasts more. */
export function headerColours(colour: SessionColour, mode: Mode) {
  const background = sessionShade(colour, mode);
  const l = luminance(background);
  const white = 1.05 / (l + 0.05) > (l + 0.05) / 0.05;
  return { background, color: white ? '#ffffff' : '#000000' };
}

const palettes: Record<Mode, ITheme> = {
  dark: {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#2f81f7',
    selectionBackground: '#264f78',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#0969da',
    selectionBackground: '#b6d7ff',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f',
  },
};

/** A Session colour replaces the palette background with the tinted one, which xterm's contrast floor then measures against. */
export function terminalOptions(
  settings: Settings,
  mode: Mode,
  colour?: SessionColour,
): ITerminalOptions {
  const palette = palettes[mode];
  return {
    theme: colour
      ? {
          ...palette,
          background: mix(
            palette.background!,
            sessionShade(colour, mode),
            settings.sessionColourTint / 100,
          ),
        }
      : palette,
    fontFamily: `${settings.fontFamily ?? '"JetBrains Mono"'}, monospace`,
    // Zoom scales the whole window, so the terminal keeps the default CSS size and the `fontSize` setting sets the zoom factor.
    fontSize: defaultSettings.fontSize,
    // Weight 500 and the extra spacing make WebGL text look like the DOM renderer's ClearType text on Windows.
    fontWeight: 500,
    fontWeightBold: 700,
    letterSpacing: 0.5,
    // In light mode a floor of 7 darkens every colour toward black.
    minimumContrastRatio: mode === 'dark' ? 7 : 4.5,
    scrollback: settings.scrollback,
  };
}
