import { useEffect, useId, useRef, useState } from 'react';
import type { ITerminalOptions, Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { appShortcut } from './shortcuts.ts';

export function TerminalView({
  term,
  options,
  active,
  mac,
}: {
  term: Terminal;
  options: ITerminalOptions;
  active: boolean;
  mac: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon>(null);
  const search = useRef<SearchAddon>(null);
  const [pending, setPending] = useState<string>();
  const [find, setFind] = useState<{ query: string; found: boolean }>();
  const id = useId();

  useEffect(() => {
    fit.current = new FitAddon();
    term.loadAddon(fit.current);
    search.current = new SearchAddon();
    term.loadAddon(search.current);
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
  // Right-click pastes, so it must not select a word first: copy-on-select would overwrite the clipboard.
  useEffect(() => {
    Object.assign(term.options, options, { rightClickSelectsWord: false });
    fit.current?.fit();
  }, [term, options]);

  useEffect(() => {
    if (!active) return;
    fit.current?.fit();
    term.focus();
  }, [active, term]);

  const copy = () => {
    if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection());
  };

  // Bracketed paste doesn't protect every shell, so any line break asks first, even a trailing one.
  const paste = (text: string) => {
    if (/[\r\n]/.test(text)) setPending(text);
    else term.paste(text);
  };

  const answer = (confirmed: boolean) => {
    if (confirmed && pending) term.paste(pending);
    setPending(undefined);
    term.focus();
  };

  const findNext = (query: string, backwards = false) => {
    const found = backwards
      ? search.current!.findPrevious(query)
      : search.current!.findNext(query, { incremental: true });
    setFind({ query, found });
  };

  const onKeyDown = async (e: React.KeyboardEvent) => {
    const shortcut = appShortcut(e.nativeEvent, mac);
    if (shortcut !== 'copy' && shortcut !== 'paste' && shortcut !== 'find')
      return;
    e.preventDefault();
    e.stopPropagation();
    if (shortcut === 'copy') copy();
    else if (shortcut === 'find') setFind({ query: '', found: true });
    else paste(await navigator.clipboard.readText());
  };

  const lines = pending
    ?.replace(/(\r\n|\r|\n)$/, '')
    .split(/\r\n|\r|\n/).length;

  return (
    <>
      <div
        ref={element}
        className="terminal"
        hidden={!active}
        onKeyDown={onKeyDown}
        // Copying on mouse-up, not on every selection change, keeps find's selected match off the clipboard.
        onMouseDown={(e) => {
          if (e.button === 0)
            window.addEventListener('mouseup', copy, { once: true });
        }}
        // Capture runs before xterm's own paste handler on its textarea, so menu and system pastes ask too.
        onPasteCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          paste(e.clipboardData.getData('text/plain'));
        }}
        onContextMenu={async (e) => {
          e.preventDefault();
          paste(await navigator.clipboard.readText());
        }}
      />
      {active && find && (
        <div className="find">
          <input
            type="search"
            aria-label="Find"
            placeholder="Find"
            autoFocus
            value={find.query}
            onChange={(e) => findNext(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findNext(find.query, e.shiftKey);
              else if (e.key === 'Escape') {
                setFind(undefined);
                term.focus();
              }
            }}
          />
          {find.query && !find.found && <span>No results</span>}
        </div>
      )}
      {active && pending !== undefined && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${id}-question`}
          className="question"
          onKeyDown={(e) => e.key === 'Escape' && answer(false)}
        >
          <p id={`${id}-question`}>
            Paste {lines} {lines === 1 ? 'line' : 'lines'}? Each line may run as
            a command.
          </p>
          <div className="question-actions">
            <button onClick={() => answer(true)}>Paste</button>
            <button autoFocus onClick={() => answer(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
