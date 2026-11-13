import { useState } from 'react';
import type { BackendClient, ImportRow, SessionTree } from '../shared/ipc.ts';
import { importAliasProblem, takenNames } from '../shared/session-rules.ts';
import { ColourSelect, Modal } from './SessionDialog.tsx';

const where = (row: ImportRow) =>
  row.kind === 'wsl'
    ? 'WSL'
    : row.kind === 'skipped'
      ? ''
      : `${row.user ? `${row.user}@` : ''}${row.hostname}${row.port === '22' ? '' : `:${row.port}`}`;

/** The preview of a MobaXterm file: nothing is written until Import, which sends the ticked rows as shown. */
export function ImportDialog({
  backend,
  tree,
  rows: start,
  onCancel,
  onImported,
}: {
  backend: BackendClient;
  tree: SessionTree;
  rows: ImportRow[];
  onCancel(): void;
  onImported(tree: SessionTree): void;
}) {
  const [rows, setRows] = useState(start);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<ImportRow>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const taken = takenNames(tree);
  const problemOf = (row: ImportRow, i: number) =>
    row.kind === 'skipped'
      ? undefined
      : importAliasProblem(
          row.alias,
          taken,
          rows.filter((r, j) => j !== i && r.ticked).map((r) => r.alias),
        );
  const ticked = rows.filter((r) => r.ticked);
  const blocked = rows.some((r, i) => r.ticked && problemOf(r, i));
  const confirm = () => {
    setBusy(true);
    setError(undefined);
    backend
      .importSessions(ticked)
      .then(onImported, (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      label="Import from MobaXterm"
      className="import-dialog"
      onCancel={onCancel}
    >
      <h2>Import from MobaXterm</h2>
      <p className="note">
        Passwords and host keys stay in MobaXterm. Nothing is written until you
        import.
      </p>
      <table>
        <thead>
          <tr>
            <th aria-label="Import" />
            <th>Session</th>
            <th>Alias</th>
            <th>Folder</th>
            <th>Host</th>
            <th>Colour</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const problem = problemOf(row, i);
            return (
              <tr key={i} className={row.ticked ? undefined : 'unticked'}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Import ${row.name}`}
                    checked={row.ticked}
                    disabled={row.kind === 'skipped'}
                    onChange={(e) => update(i, { ticked: e.target.checked })}
                  />
                </td>
                <td>{row.name}</td>
                <td>
                  {row.kind !== 'skipped' && (
                    <>
                      <input
                        aria-label={`Alias of ${row.name}`}
                        spellCheck={false}
                        value={row.alias}
                        aria-invalid={!!problem}
                        onChange={(e) => update(i, { alias: e.target.value })}
                      />
                      {problem && <span className="problem">{problem}</span>}
                    </>
                  )}
                </td>
                <td>{row.folder.split('/').join(' / ')}</td>
                <td>{where(row)}</td>
                <td>
                  {row.kind !== 'skipped' && (
                    <ColourSelect
                      aria-label={`Colour of ${row.name}`}
                      value={row.colour}
                      onChange={(colour) => update(i, { colour })}
                    />
                  )}
                </td>
                <td>
                  {row.problems.map((p) => (
                    <p key={p} className="warn">
                      {p}
                    </p>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
      <footer>
        <button onClick={onCancel}>Cancel</button>
        <button
          className="primary"
          disabled={busy || blocked || !ticked.length}
          onClick={confirm}
        >
          Import {ticked.length} session{ticked.length === 1 ? '' : 's'}
        </button>
      </footer>
    </Modal>
  );
}
