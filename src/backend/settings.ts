import {
  existsSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  defaultSettings,
  type Backend,
  type BackendEvent,
  type Settings,
} from '../shared/ipc.ts';
import { openInEditor } from './editor.ts';

export function createSettings(
  dir: string,
  emit: (event: BackendEvent) => void,
): Pick<Backend, 'settings' | 'updateSettings' | 'openSettings'> {
  const file = path.join(dir, 'settings.json');
  let current = defaultSettings;

  // Editors save by truncating, writing or renaming over the file. Invalid JSON is a save in progress or a typo,
  // so reload keeps the last good settings.
  function reload() {
    let next: Settings;
    try {
      next = parse(read(file));
    } catch {
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    emit({ type: 'settings', settings: next });
  }

  // A watch on the folder, not the file, reports the file being created, deleted or replaced by a rename.
  mkdirSync(dir, { recursive: true });
  watch(dir, (_event, name) => {
    if (!name || name === 'settings.json') reload();
  });
  reload();

  return {
    async settings() {
      return current;
    },

    async updateSettings(patch) {
      // read() throws on invalid JSON, so this never overwrites a broken file.
      write(file, { ...read(file), ...patch });
      reload();
    },

    async openSettings() {
      // A new file lists the defaults, so the user sees which keys exist.
      if (!existsSync(file)) write(file, defaultSettings);
      await openInEditor(file, current.editor);
    },
  };
}

function write(file: string, settings: object) {
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

function read(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('settings.json must hold a JSON object');
  }
  return raw as Record<string, unknown>;
}

// A hand-edited key with the wrong type falls back to its default.
function parse(raw: Record<string, unknown>): Settings {
  const settings = { ...defaultSettings };
  if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system')
    settings.theme = raw.theme;
  if (typeof raw.fontFamily === 'string') settings.fontFamily = raw.fontFamily;
  if (isPositive(raw.fontSize)) settings.fontSize = raw.fontSize;
  if (isPositive(raw.scrollback)) settings.scrollback = raw.scrollback;
  if (typeof raw.editor === 'string') settings.editor = raw.editor;
  return settings;
}

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && value > 0;
