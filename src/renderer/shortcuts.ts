// Windows shortcuts are always Ctrl+Shift so plain Ctrl keys reach the shell; macOS uses Cmd, some with Shift.
const shortcuts = {
  newTab: { code: 'KeyT', macShift: false },
  filter: { code: 'KeyO', macShift: true },
  profiling: { code: 'KeyM', macShift: true },
  copy: { code: 'KeyC', macShift: false },
  paste: { code: 'KeyV', macShift: false },
  find: { code: 'KeyF', macShift: false },
  duplicate: { code: 'KeyD', macShift: false },
  close: { code: 'KeyW', macShift: false },
};

// Zoom and settings take plain Ctrl and match the typed character with any Shift: `=` is Shift+0 on the Italian layout.
const characterShortcuts: Partial<
  Record<string, 'zoomIn' | 'zoomOut' | 'zoomReset' | 'settings'>
> = {
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  '0': 'zoomReset',
  ',': 'settings',
};

const arrows: Partial<Record<string, 'nextTab' | 'previousTab'>> = {
  ArrowRight: 'nextTab',
  ArrowLeft: 'previousTab',
};

/** A number means "go to that Tab". */
export const appShortcut = (e: KeyboardEvent, mac: boolean) => {
  // Ctrl+Tab cycles Tabs on both systems; macOS also takes Cmd+Option+arrows.
  if (e.code === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey)
    return e.shiftKey ? 'previousTab' : 'nextTab';
  if (mac && e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey)
    return arrows[e.code];
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!command || e.altKey) return;
  // The physical digit key: Shift turns the digit into another character on many layouts.
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && e.shiftKey === !mac) return Number(digit[1]);
  return (
    characterShortcuts[e.key] ??
    (Object.keys(shortcuts) as (keyof typeof shortcuts)[]).find(
      (name) =>
        e.code === shortcuts[name].code &&
        e.shiftKey === (mac ? shortcuts[name].macShift : true),
    )
  );
};

/** The terminal handles its own clipboard and find keys; elsewhere they keep their native meaning. */
export const terminalShortcut = (
  shortcut: unknown,
): shortcut is 'copy' | 'paste' | 'find' =>
  shortcut === 'copy' || shortcut === 'paste' || shortcut === 'find';
