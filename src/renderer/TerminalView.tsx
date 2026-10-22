import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export function TerminalView({
  term,
  active,
}: {
  term: Terminal;
  active: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon>(null);

  useEffect(() => {
    fit.current = new FitAddon();
    term.loadAddon(fit.current);
    term.open(element.current!);
    const observer = new ResizeObserver(() => fit.current?.fit());
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, [term]);

  useEffect(() => {
    if (!active) return;
    fit.current?.fit();
    term.focus();
  }, [active, term]);

  return <div ref={element} className="terminal" hidden={!active} />;
}
