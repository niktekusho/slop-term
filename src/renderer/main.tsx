import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import { createClient } from '../shared/ipc.ts';
import { App } from './App.tsx';

const backend = createClient(window.slop.send, window.slop.onMessage);

createRoot(document.getElementById('root')!).render(
  <App backend={backend} mac={window.slop.platform === 'darwin'} />,
);
