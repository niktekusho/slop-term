import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './index.css';
import { createClient } from '../shared/ipc.ts';
import { App } from './App.tsx';

const backend = {
  ...createClient(window.slop.send, window.slop.onMessage),
  ...window.slop.profiler,
  ...window.slop.window,
};

// xterm measures its cell size when a terminal opens, so the app loads the font before it renders.
Promise.all([
  document.fonts.load('500 12px "JetBrains Mono"'),
  document.fonts.load('700 12px "JetBrains Mono"'),
]).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <App backend={backend} mac={window.slop.platform === 'darwin'} />,
  ),
);
