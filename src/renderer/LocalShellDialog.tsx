import { useState } from 'react';
import {
  shellKinds,
  type BackendClient,
  type LocalShellForm,
  type SessionTree,
  type Shell,
  type ShellKind,
  type TabId,
} from '../shared/ipc.ts';
import {
  aliasProblem,
  launchLine,
  shellMissing,
  takenNames,
} from '../shared/session-rules.ts';
import { Modal } from './SessionDialog.tsx';
import { folderPaths } from './SessionTree.tsx';

/** `edit` is the session as read when the dialog opened. `tab` is the unsaved Tab a Save keeps, whose shell is fixed. */
export type LocalDialogStart = {
  form: LocalShellForm;
  edit?: { name: string; read: string };
  tab?: { id: TabId; label: string };
};

const shellLabels: Record<ShellKind, string> = {
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  cmd: 'cmd',
  wsl: 'WSL',
  zsh: 'zsh',
  bash: 'bash',
};

export const newLocalForm = (
  folder: string,
  shells: Shell[] = [],
  shell: Partial<LocalShellForm> = {},
): LocalShellForm => ({
  name: '',
  folder,
  kind: shells[0]?.kind ?? 'bash',
  distro: '',
  startFolder: '',
  command: '',
  ...shell,
});

/** The launch line as the user would type it. The working folder of a shell other than WSL follows it. */
function launchNote(form: LocalShellForm) {
  const { args, cwd } = launchLine(form);
  const words =
    typeof args === 'string'
      ? [args]
      : args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
  return {
    line: [form.kind, ...words].filter(Boolean).join(' '),
    folder: cwd === '~' ? undefined : cwd,
  };
}

export function LocalShellDialog({
  backend,
  tree,
  shells,
  start,
  onCancel,
  onSaved,
}: {
  backend: BackendClient;
  tree: SessionTree;
  shells: Shell[];
  start: LocalDialogStart;
  onCancel(): void;
  onSaved(tree: SessionTree, name: string): void;
}) {
  const own = start.edit?.name;
  const [form, setForm] = useState(start.form);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<LocalShellForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  const taken = takenNames(tree).filter((name) => name !== own);
  const nameError = aliasProblem(form.name, taken);
  const kinds = shellKinds.filter(
    (kind) => !shellMissing({ kind, distro: '' }, shells),
  );
  const distros = shells.flatMap((s) => (s.kind === 'wsl' ? [s.distro] : []));
  const kindMissing = !kinds.includes(form.kind);
  const distroMissing =
    form.kind === 'wsl' && !!form.distro && !distros.includes(form.distro);
  const missing = kindMissing
    ? shellLabels[form.kind]
    : distroMissing && `WSL distro ${form.distro}`;
  const note = launchNote(form);
  const title = start.tab
    ? `Save ${start.tab.label}`
    : own
      ? `Edit ${own}`
      : 'New local shell session';

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await backend.saveLocalShell(form, start.edit), form.name);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const textInput = (field: 'startFolder' | 'command', label: string) => (
    <>
      <label htmlFor={`local-${field}`}>{label}</label>
      <input
        id={`local-${field}`}
        spellCheck={false}
        value={form[field]}
        placeholder={field === 'command' ? 'none: opens the shell' : '~'}
        onChange={(e) => update({ [field]: e.target.value })}
      />
    </>
  );

  return (
    <Modal label={title} className="local-dialog" onCancel={onCancel}>
      <h2>{title}</h2>
      <div className="fields">
        <label htmlFor="local-name">Name</label>
        <div>
          <input
            id="local-name"
            autoFocus
            spellCheck={false}
            value={form.name}
            aria-invalid={!!nameError}
            aria-describedby="local-name-status"
            onChange={(e) => update({ name: e.target.value.toLowerCase() })}
          />{' '}
          <span
            id="local-name-status"
            className={nameError ? 'problem' : 'free'}
          >
            {nameError ?? 'Free'}
          </span>
        </div>

        {!start.tab && (
          <>
            <label htmlFor="local-shell">Shell</label>
            <div>
              <select
                id="local-shell"
                value={form.kind}
                onChange={(e) => update({ kind: e.target.value as ShellKind })}
              >
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {shellLabels[kind]}
                  </option>
                ))}
                {kindMissing && (
                  <option value={form.kind}>
                    {shellLabels[form.kind]} (not on this machine)
                  </option>
                )}
              </select>
              {missing && (
                <p className="warn">
                  This machine has no {missing}. The session syncs and can be
                  edited, but won't open here.
                </p>
              )}
            </div>

            {form.kind === 'wsl' && (
              <>
                <label htmlFor="local-distro">WSL distro</label>
                <select
                  id="local-distro"
                  value={form.distro}
                  onChange={(e) => update({ distro: e.target.value })}
                >
                  <option value="">Default</option>
                  {distros.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  {distroMissing && (
                    <option value={form.distro}>
                      {form.distro} (not on this machine)
                    </option>
                  )}
                </select>
              </>
            )}

            {textInput('startFolder', 'Start folder')}
            {textInput('command', 'Command')}
            <span />
            <p className="note">
              Starts <code>{note.line}</code>
              {note.folder && ` in ${note.folder}`}
            </p>
          </>
        )}

        <label htmlFor="local-folder">Folder</label>
        <select
          id="local-folder"
          value={form.folder}
          onChange={(e) => update({ folder: e.target.value })}
        >
          <option value="">(top level)</option>
          {folderPaths(tree).map((f) => (
            <option key={f} value={f}>
              {f.split('/').join(' / ')}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
      <footer>
        <button onClick={onCancel}>Cancel</button>
        <button
          className="primary"
          disabled={saving || !!nameError}
          onClick={save}
        >
          Save
        </button>
      </footer>
    </Modal>
  );
}
