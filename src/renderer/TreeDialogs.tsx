import { useState } from 'react';
import { nameOf } from '../shared/session-rules.ts';
import { Modal, openTabsNote } from './SessionDialog.tsx';

const folderLabel = (folder: string) =>
  folder ? folder.split('/').join(' / ') : '(top level)';

const count = (n: number, noun: string) =>
  n ? `${n} ${noun}${n === 1 ? '' : 's'}` : undefined;

/** The keyboard way to move: type part of a folder name, pick with ↑/↓, move with Enter. */
export function MoveTo({
  name,
  folders,
  current,
  onMove,
  onCancel,
}: {
  name: string;
  /** Every folder the item may go into, in tree order. */
  folders: string[];
  current: string;
  onMove(to: string): void;
  onCancel(): void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const choices = ['', ...folders].filter((f) =>
    folderLabel(f).toLowerCase().includes(query.toLowerCase()),
  );
  const chosen = Math.min(index, choices.length - 1);
  return (
    <Modal label={`Move ${name}`} className="move-to" onCancel={onCancel}>
      <h2>
        Move <code>{name}</code> to…
      </h2>
      <input
        type="search"
        aria-label="Filter folders"
        aria-controls="move-choices"
        aria-activedescendant={
          chosen >= 0 ? `move-choice-${chosen}` : undefined
        }
        autoFocus
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown')
            setIndex(Math.min(chosen + 1, choices.length - 1));
          else if (e.key === 'ArrowUp') setIndex(Math.max(chosen - 1, 0));
          else if (e.key === 'Enter' && chosen >= 0) onMove(choices[chosen]);
          else return;
          e.preventDefault();
        }}
      />
      {choices.length ? (
        <ul role="listbox" id="move-choices" aria-label="Folders">
          {choices.map((f, i) => (
            <li
              key={f}
              id={`move-choice-${i}`}
              role="option"
              aria-selected={i === chosen}
              onClick={() => onMove(f)}
            >
              {folderLabel(f)}
              {f === current && <span className="detail"> (current)</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">No folder matches.</p>
      )}
    </Modal>
  );
}

/** What a folder delete takes along, counted when the user asked. */
export type FolderContents = {
  folder: string;
  /** The Saved sessions in the folder and its subfolders. */
  aliases: string[];
  subfolders: number;
  openTabs: number;
  /** Saved secrets that the delete can take: keychain entries that only sessions in the folder use. */
  secrets: number;
  /** Secrets that stay: TPM entries and entries a session outside the folder shares. */
  kept: number;
};

export function DeleteFolder({
  contents: { folder, aliases, subfolders, openTabs, secrets, kept },
  onCancel,
  onDelete,
}: {
  contents: FolderContents;
  onCancel(): void;
  onDelete(deleteSecrets: boolean): Promise<void>;
}) {
  const [deleteSecrets, setDeleteSecrets] = useState(false);
  const [error, setError] = useState<string>();
  const name = nameOf(folder);
  const parts = [
    count(subfolders, 'subfolder'),
    count(aliases.length, 'Saved session'),
  ].filter(Boolean);
  return (
    <Modal
      label={`Delete ${name}`}
      role="alertdialog"
      className="confirm"
      onCancel={onCancel}
    >
      <h2>
        Delete folder <code>{name}</code>
        {parts.length === 2
          ? `, ${parts[0]} and ${parts[1]}`
          : ` and ${parts[0]}`}
        ?
      </h2>
      {openTabsNote(openTabs)}
      {secrets > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={deleteSecrets}
            onChange={(e) => setDeleteSecrets(e.target.checked)}
          />
          Also delete {count(secrets, 'saved secret')} from keychain / KeePass
        </label>
      )}
      {kept > 0 && (
        <p className="note">
          {count(kept, 'saved secret')} {kept === 1 ? 'stays' : 'stay'}: shared
          with a session outside the folder, or kept in TPM.
        </p>
      )}
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
      <footer>
        <button autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button
          className="danger"
          onClick={() =>
            onDelete(deleteSecrets).catch((e: Error) => setError(e.message))
          }
        >
          Delete
        </button>
      </footer>
    </Modal>
  );
}

/** Asked after "Move into slop-term" has copied the host. Keep both leaves the warning and its menu fix. */
export function CommentOut({
  alias,
  onKeep,
  onCommentOut,
}: {
  alias: string;
  onKeep(): void;
  onCommentOut(): Promise<void>;
}) {
  const [error, setError] = useState<string>();
  return (
    <Modal
      label={`Comment out ${alias}`}
      role="alertdialog"
      className="confirm"
      onCancel={onKeep}
    >
      <h2>
        Comment out <code>{alias}</code> in ~/.ssh/config?
      </h2>
      <p>
        slop-term.conf now has a copy of {alias}. The original stays in
        ~/.ssh/config as comments under <code># moved to slop-term.conf</code>.
      </p>
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
      <footer>
        <button autoFocus onClick={onKeep}>
          Keep both
        </button>
        <button
          className="primary"
          onClick={() =>
            onCommentOut().catch((e: Error) => setError(e.message))
          }
        >
          Comment out
        </button>
      </footer>
    </Modal>
  );
}
