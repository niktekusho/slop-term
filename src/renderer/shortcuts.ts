// Windows shortcuts are always Ctrl+Shift so plain Ctrl keys reach the shell; macOS uses Cmd, some with Shift.
const shortcuts = {
  newTab: { code: 'KeyT', macShift: false },
  filter: { code: 'KeyO', macShift: true },
  profiling: { code: 'KeyM', macShift: true },
  copy: { code: 'KeyC', macShift: false },
  paste: { code: 'KeyV', macShift: false },
  find: { code: 'KeyF', macShift: false },
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

export const appShortcut = (e: KeyboardEvent, mac: boolean) => {
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!command || e.altKey) return;
  return (
    characterShortcuts[e.key] ??
    (Object.keys(shortcuts) as (keyof typeof shortcuts)[]).find(
      (name) =>
        e.code === shortcuts[name].code &&
        e.shiftKey === (mac ? shortcuts[name].macShift : true),
    )
  );
};
