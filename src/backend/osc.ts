import type { TabUpdate } from '../shared/ipc.ts';

// oxlint-disable-next-line no-control-regex -- OSC sequences are made of control characters.
const osc = /\x1b\](\d*);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

function pathOf(fileUrl: string) {
  try {
    return decodeURIComponent(new URL(fileUrl).pathname);
  } catch {
    return undefined;
  }
}

/** Reads the OSC 7 folder and the OSC 0 and 2 title out of terminal output that arrives in chunks. */
export function oscScanner(onUpdate: (update: TabUpdate) => void) {
  let rest = '';
  return (data: string) => {
    const text = rest + data;
    let end = 0;
    for (const m of text.matchAll(osc)) {
      end = m.index + m[0].length;
      const [, code, value] = m;
      const path = code === '7' ? pathOf(value) : undefined;
      if (code === '0' || code === '2') onUpdate({ title: value });
      else if (path !== undefined) onUpdate({ folder: path });
    }
    // A sequence cut by the chunk end waits for the next chunk. The cap drops one that never ends.
    const tail = text.slice(end);
    const start = tail.lastIndexOf('\x1b]');
    rest =
      start >= 0
        ? tail.slice(start, start + 4096)
        : tail.endsWith('\x1b')
          ? '\x1b'
          : '';
  };
}
