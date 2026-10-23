import { useEffect, useRef } from 'react';
import type { ITerminalOptions, Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

export function TerminalView({
  term,
  options,
  active,
}: {
  term: Terminal;
  options: ITerminalOptions;
  active: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon>(null);

  useEffect(() => {
    fit.current = new FitAddon();
    term.loadAddon(fit.current);
    term.open(element.current!);
    // Disposing the WebGL addon puts xterm back on its DOM renderer.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL here: the DOM renderer stays.
    }
    const observer = new ResizeObserver(() => fit.current?.fit());
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, [term]);

  // A new font changes the cell size without resizing the element, so the ResizeObserver misses it.
  useEffect(() => {
    Object.assign(term.options, options);
    fit.current?.fit();
  }, [term, options]);

  useEffect(() => {
    if (!active) return;
    fit.current?.fit();
    term.focus();
  }, [active, term]);

  return <div ref={element} className="terminal" hidden={!active} />;
}
