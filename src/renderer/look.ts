import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import { defaultSettings, type Settings } from '../shared/ipc.ts';

export type Mode = 'light' | 'dark';

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

export function terminalOptions(
  settings: Settings,
  mode: Mode,
): ITerminalOptions {
  return {
    theme: palettes[mode],
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
