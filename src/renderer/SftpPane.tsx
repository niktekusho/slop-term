import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { ITheme } from '@xterm/xterm';
import {
  unfinished,
  type BackendClient,
  type Conflict,
  type ConflictChoice,
  type EditorQuestion,
  type FileCounts as Counts,
  type FileSide,
  type HostKeyQuestion,
  type Listing,
  type RemoteFile,
  type SecretQuestion,
  type SessionTree,
  type Transfer,
  type TransferKeyChange,
  type TypedSsh,
  type UnsentEdit,
} from '../shared/ipc.ts';
import { HostKeyPrompt } from './HostKeyPrompt.tsx';
import { SecretPrompt } from './SecretPrompt.tsx';
import { Modal } from './SessionDialog.tsx';
import { folderIcon, hostOf, icon, type Tab } from './SessionTree.tsx';

type SortKey = 'name' | 'size' | 'modified' | 'permissions';
const columns: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'modified', label: 'Modified' },
  { key: 'permissions', label: 'Permissions' },
];

const join = (folder: string, name: string) =>
  `${folder === '/' ? '' : folder}/${name}`;
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

function formatSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return unit ? `${size.toFixed(1)} ${units[unit]}` : `${size} B`;
}

const pad = (n: number) => String(n).padStart(2, '0');
function formatTime(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const counted = ({ files, bytes }: Counts) =>
  `${files} ${files === 1 ? 'file' : 'files'}, ${formatSize(bytes)}`;

// The `ls` colours: folders blue, archives red, executables green.
const archive = /\.(gz|tgz|zip|tar|bz2|xz|zst|7z|rar)$/i;
const nameColour = (file: RemoteFile, theme: ITheme) =>
  file.folder
    ? theme.blue
    : archive.test(file.name)
      ? theme.red
      : /^-.*x/.test(file.permissions)
        ? theme.green
        : undefined;

const byName = (a: RemoteFile, b: RemoteFile) => a.name.localeCompare(b.name);
const comparer = (key: SortKey) => (a: RemoteFile, b: RemoteFile) =>
  (key === 'size' || key === 'modified'
    ? a[key] - b[key]
    : a[key].localeCompare(b[key])) || byName(a, b);

const fileIcon = icon(
  'file-icon',
  <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3" />,
);
const upIcon = icon('', <path d="M8 13V3M4 7l4-4 4 4" />);
const refreshIcon = icon('', <path d="M13 8a5 5 0 11-1.5-3.5M13 2v3h-3" />);
const followIcon = icon(
  '',
  <path d="M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10h2.5" />,
);
const hiddenIcon = icon(
  '',
  <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />,
);
const collapseIcon = icon('', <path d="M6 4l4 4-4 4" />);
export const expandIcon = icon('', <path d="M10 4L6 8l4 4" />);

/** `taken` holds the other names in the folder. */
function NameField({
  initial,
  taken,
  onDone,
}: {
  initial: string;
  taken: string[];
  onDone(name?: string): void;
}) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // Enter, Esc and the blur that follows them would each end the edit.
  const done = useRef(false);
  const problem = !name.trim()
    ? 'Enter a name.'
    : name.includes('/')
      ? "A name can't contain /."
      : taken.includes(name) || name === '.' || name === '..'
        ? `${name} already exists here.`
        : undefined;
  const finish = (result?: string) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  const commit = () => problem || finish(name);

  // The extension stays, so typing replaces only the name.
  useEffect(() => {
    const dot = initial.lastIndexOf('.');
    input.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  return (
    <input
      ref={input}
      className="file-name-field"
      aria-label="Name"
      autoFocus
      spellCheck={false}
      value={name}
      aria-invalid={!!problem}
      title={problem}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') finish();
      }}
    />
  );
}

/** Names what goes: one item, or up to five and a count of the rest, with the files and bytes of each folder. */
function DeleteConfirm({
  names,
  folders,
  counts,
  onCancel,
  onDelete,
}: {
  names: string[];
  folders: string[];
  counts?: Record<string, Counts>;
  onCancel(): void;
  onDelete(): void;
}) {
  const id = useId();
  const single = names.length === 1 ? names[0] : undefined;
  const size = (name: string) =>
    folders.includes(name) && (counts?.[name] ? counted(counts[name]) : '…');
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={id}
      className="sftp-confirm"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <h3 id={id}>Delete {single ?? `${names.length} items`}?</h3>
      {single ? (
        size(single) && <p>It holds {size(single)}.</p>
      ) : (
        <ul>
          {names.slice(0, 5).map((name) => (
            <li key={name}>
              {name}
              {size(name) && ` · ${size(name)}`}
            </li>
          ))}
          {names.length > 5 && <li>and {names.length - 5} more</li>}
        </ul>
      )}
      <p>SFTP has no trash: deleted files can't be restored.</p>
      <div className="question-actions">
        <button autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

/** How much of a transfer is done, in whole percent. */
export const percent = (t: Transfer) =>
  t.total ? Math.floor((t.bytes / t.total) * 100) : 0;

const upArrow = (
  <span role="img" aria-label="Upload" className="direction">
    ↑
  </span>
);
const downArrow = (
  <span role="img" aria-label="Download" className="direction">
    ↓
  </span>
);

const editMark = (
  <span role="img" aria-label="Editor sync" className="direction">
    ✎
  </span>
);

function TransferList({
  transfers,
  onCancel,
  onRetry,
  onShow,
}: {
  transfers: Transfer[];
  onCancel(id: string): void;
  onRetry(id: string): void;
  onShow(file: string): void;
}) {
  const active = transfers.filter(unfinished).length;
  const status = (t: Transfer) => {
    if (t.state === 'queued')
      return t.edit ? 'Waiting for connection' : 'Queued';
    if (t.state === 'running')
      return `${percent(t)}% · ${formatSize(t.bytes)} of ${formatSize(t.total)} · ${formatSize(t.speed)}/s`;
    if (t.state === 'failed')
      return <span className="transfer-error">{t.reason}</span>;
    if (t.edit) {
      const at = t.edit.uploaded && new Date(t.edit.uploaded);
      return `open in ${t.edit.app}${at ? ` · uploaded ${pad(at.getHours())}:${pad(at.getMinutes())}` : ''}`;
    }
    if (t.direction === 'upload') return 'Uploaded';
    return (
      <button className="link" onClick={() => onShow(t.local)}>
        Saved to {t.folder}
      </button>
    );
  };
  return (
    <section className="transfers" aria-label="Transfers">
      <h3>
        Transfers<span className="count">{active}</span>
      </h3>
      <ul>
        {transfers.map((t) => (
          <li key={t.id} className={t.state}>
            <div className="transfer-line">
              {t.edit
                ? editMark
                : t.direction === 'upload'
                  ? upArrow
                  : downArrow}
              <span className="transfer-name">{t.name}</span>
              <span className="transfer-folder">{t.folder}</span>
              {/* An editor-sync row has no cancel: closing the Tab ends it. */}
              {unfinished(t) && !t.edit && (
                <button
                  aria-label={`Cancel ${t.name}`}
                  title="Cancel"
                  onClick={() => onCancel(t.id)}
                >
                  ×
                </button>
              )}
              {t.state === 'failed' && (
                <button
                  aria-label={`Retry ${t.name}`}
                  onClick={() => onRetry(t.id)}
                >
                  Retry
                </button>
              )}
            </div>
            {t.state === 'running' && (
              <progress
                aria-label={`${t.name} progress`}
                value={t.bytes}
                max={t.total || 1}
              />
            )}
            <div className="transfer-status">{status(t)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Asks what to do with a transfer whose target exists. Keep both is the default: it loses nothing. */
function ConflictDialog({
  conflict,
  host,
  onAnswer,
}: {
  conflict: Conflict;
  host: string;
  onAnswer(choice: ConflictChoice, all: boolean): void;
}) {
  const [all, setAll] = useState(false);
  const side = (s: FileSide) =>
    `${formatSize(s.size)} · ${formatTime(s.modified)}`;
  const { name, others } = conflict;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`${name} already exists`}
      className="sftp-confirm"
      onKeyDown={(e) => e.key === 'Escape' && onAnswer('skip', all)}
    >
      <h3>{name} already exists</h3>
      <dl className="conflict-sides">
        <dt>On this computer</dt>
        <dd>{side(conflict.local)}</dd>
        <dt>On {host}</dt>
        <dd>{side(conflict.remote)}</dd>
      </dl>
      {others > 0 && (
        <label className="apply-all">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          Apply to the other {others} {others === 1 ? 'conflict' : 'conflicts'}
        </label>
      )}
      <div className="question-actions">
        <button onClick={() => onAnswer('overwrite', all)}>Overwrite</button>
        <button onClick={() => onAnswer('skip', all)}>Skip</button>
        <button autoFocus onClick={() => onAnswer('keep', all)}>
          Keep both
        </button>
      </div>
    </div>
  );
}

/** Asks whether a save of an editor-sync file uploads. Escape answers no: the save stays on this computer. */
function EditorSaveDialog({
  question,
  host,
  onAnswer,
}: {
  question: EditorQuestion;
  host: string;
  onAnswer(upload: boolean): void;
}) {
  const changed = question.reason === 'changed';
  const title = changed
    ? `${question.name} changed on ${host}`
    : `Upload ${question.name} to ${host}?`;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="sftp-confirm"
      onKeyDown={(e) => e.key === 'Escape' && onAnswer(false)}
    >
      <h3>{title}</h3>
      {changed && (
        <p>Someone changed it since you opened it. Overwrite their change?</p>
      )}
      <div className="question-actions">
        <button
          className={changed ? 'danger' : undefined}
          onClick={() => onAnswer(true)}
        >
          {changed ? 'Overwrite' : 'Upload'}
        </button>
        <button autoFocus onClick={() => onAnswer(false)}>
          {changed ? 'Cancel' : 'Not now'}
        </button>
      </div>
    </div>
  );
}

/** Lists the editor-sync copies the back end kept at startup. They stay on disk until the user deletes them. */
export function UnsentEdits({
  edits,
  onShow,
  onClose,
}: {
  edits: UnsentEdit[];
  onShow(file: string): void;
  onClose(): void;
}) {
  return (
    <Modal label="Unsent edits" className="confirm" onCancel={onClose}>
      <h2>Unsent edits</h2>
      <p>
        These copies have saves that never reached the host. Copy what you need
        back by hand, then delete them.
      </p>
      <ul className="unsent-edits">
        {edits.map((e) => (
          <li key={e.file}>
            <code>
              {e.alias}:{e.remote}
            </code>
            <button className="link" onClick={() => onShow(e.file)}>
              {e.file}
            </button>
          </li>
        ))}
      </ul>
      <footer>
        <button autoFocus onClick={onClose}>
          Close
        </button>
      </footer>
    </Modal>
  );
}

/** Asks before a Tab closes with transfers still queued or running, or files open in an editor. Show local copy reveals the first one's file on this computer. */
export function CloseTabConfirm({
  name,
  pending,
  onShow,
  onCancel,
  onClose,
}: {
  name: string;
  pending: Transfer[];
  onShow(file: string): void;
  onCancel(): void;
  onClose(): void;
}) {
  const edits = pending.filter((t) => t.edit).length;
  const transfers = pending.length - edits;
  const what = [
    transfers &&
      `${transfers} ${transfers === 1 ? 'transfer' : 'transfers'} not finished`,
    edits && `${edits} ${edits === 1 ? 'file' : 'files'} open in an editor`,
  ].filter(Boolean);
  const first = pending[0];
  return (
    <Modal
      label="Close Tab"
      role="alertdialog"
      className="confirm"
      onCancel={onCancel}
    >
      <h2>
        Close {name} with {what.join(' and ')}?
      </h2>
      {transfers > 0 && <p>Closing the Tab stops the transfers.</p>}
      {edits > 0 && (
        <p>
          Closing the Tab deletes the copies it opened, with any save not
          uploaded.
        </p>
      )}
      <footer>
        {/* An unfinished download may have no file yet: its folder shows instead. */}
        <button
          onClick={() =>
            onShow(
              first.edit || first.direction === 'upload'
                ? first.local
                : first.folder,
            )
          }
        >
          Show local copy
        </button>
        <button autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button className="danger" onClick={onClose}>
          Close Tab
        </button>
      </footer>
    </Modal>
  );
}

/** A local shell Tab's pane before it browses: the hint with no `ssh`, else where its own connection stands, and the picker in both. */
function LocalHint({
  ssh,
  wsl,
  tree,
  onBrowse,
}: {
  ssh?: TypedSsh;
  wsl: boolean;
  tree: SessionTree;
  onBrowse(alias?: string): void;
}) {
  const hosts = [
    ...tree.sessions.map((s) => s.alias),
    ...tree.handWritten,
  ].toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const where = ssh && `${ssh.user}@${ssh.host}`;
  return (
    <div className="sftp-empty">
      {!ssh ? (
        <>
          <p>No remote host</p>
          {wsl ? (
            <p>The pane can&apos;t see ssh inside WSL.</p>
          ) : (
            <p>
              Type <code>ssh &lt;host&gt;</code> in the terminal to browse its
              files here.
            </p>
          )}
        </>
      ) : ssh.jumpHost ? (
        <p>
          This host uses a jump host. slop-term v1 can&apos;t connect to it.
        </p>
      ) : ssh.state === 'connecting' ? (
        <p role="status">Connecting to {where}…</p>
      ) : (
        <p>
          <button onClick={() => onBrowse()}>Browse files on {where}</button>
        </p>
      )}
      {/* Every local shell Tab keeps the picker, for an `ssh` the pane can't follow. */}
      <select
        aria-label="Browse files of..."
        value=""
        onChange={(e) => e.target.value && onBrowse(e.target.value)}
      >
        <option value="">Browse files of...</option>
        {hosts.map((alias) => (
          <option key={alias}>{alias}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * The SFTP pane of one Tab. It stays mounted while hidden, so its folder and selection survive a switch of Tabs.
 * It lists only while `shown` and connected: the first listing opens the back end's SFTP channel.
 * A local shell Tab's pane browses over its own connection, for a typed `ssh` or a picked Saved session. `wsl` Tabs can only pick.
 */
export function SftpPane({
  backend,
  tab,
  tree,
  wsl,
  shown,
  mac,
  theme,
  onCollapse,
}: {
  backend: BackendClient;
  tab: Tab;
  tree: SessionTree;
  wsl: boolean;
  shown: boolean;
  mac: boolean;
  theme: ITheme;
  onCollapse(): void;
}) {
  const [connected, setConnected] = useState(false);
  // The folder to list as soon as the pane is shown and connected; `path` none is the home folder.
  const [pending, setPending] = useState<{ path?: string }>();
  const [listing, setListing] = useState<Listing>();
  const [pathText, setPathText] = useState('');
  const [error, setError] = useState<string>();
  const [follow, setFollow] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [sort, setSort] = useState({
    key: 'name' as SortKey,
    descending: false,
  });
  const [selected, setSelected] = useState(new Set<string>());
  const [anchor, setAnchor] = useState<string>();
  const [menu, setMenu] = useState<{
    left: number;
    top: number;
    row: boolean;
  }>();
  const [editing, setEditing] = useState<
    { rename: string } | { create: true }
  >();
  const [deleting, setDeleting] = useState<{
    paths: string[];
    names: string[];
    folders: string[];
    counts?: Record<string, Counts>;
  }>();
  const [conflict, setConflict] = useState<Conflict>();
  const [editorQuestion, setEditorQuestion] = useState<EditorQuestion>();
  const [keyChange, setKeyChange] = useState<TransferKeyChange>();
  const [dragging, setDragging] = useState(false);
  // A local shell Tab's pane asks its own questions.
  const [paneKey, setPaneKey] = useState<HostKeyQuestion>();
  const [paneSecret, setPaneSecret] = useState<SecretQuestion>();
  const menuRef = useRef<HTMLUListElement>(null);
  const grid = useRef<HTMLTableElement>(null);
  // A later request wins, so a slow listing can't replace a newer one.
  const request = useRef(0);
  const lastPath = useRef<string>(undefined);

  const away = !!tab.host && tab.host !== tab.firstHost;
  const typed = tab.typedSsh;
  const paneDropped = typed?.state === 'dropped';
  const down = !!tab.disconnected || tab.exit !== undefined || paneDropped;
  // A dropped pane keeps its listing greyed and its transfer rows, as a dropped Tab's pane does.
  const browsing = !tab.local || typed?.state === 'connected' || paneDropped;
  const go = (path?: string) => setPending({ path });
  // After an action, a folder the user went to meanwhile wins over the one the action ran in.
  const refresh = () => setPending((p) => p ?? { path: lastPath.current });

  useEffect(
    () =>
      backend.onEvent((event) => {
        if (!('tab' in event) || event.tab !== tab.id) return;
        if (event.type === 'hostKey' && event.pane) setPaneKey(event.question);
        else if (event.type === 'secret' && event.pane)
          setPaneSecret(event.question);
        else if (event.type === 'conflict') setConflict(event.conflict);
        else if (event.type === 'editorSave') setEditorQuestion(event.question);
        else if (event.type === 'transferKey') setKeyChange(event.change);
        else if (event.type === 'connected') {
          setConnected(true);
          // A new connection accepted a key of its own: the next transfer checks against that.
          setKeyChange(undefined);
          // A reconnect lists the folder the pane showed before the drop.
          refresh();
        } else if (event.type === 'dropped' || event.type === 'exit')
          setConnected(false);
        else if (
          event.type === 'tab' &&
          'folder' in event &&
          follow &&
          event.host === event.firstHost
        )
          setPending({ path: event.folder });
      }),
    [backend, tab.id, follow],
  );

  // A local shell Tab's pane connects and drops with its typed `ssh`, not with the Tab. A new `ssh` starts from its home folder.
  const typedState = typed?.state;
  useEffect(() => {
    if (!tab.local) return;
    setConnected(typedState === 'connected');
    if (typedState === 'connected') refresh();
    else if (!typedState) {
      setListing(undefined);
      setPending(undefined);
      setSelected(new Set());
      setError(undefined);
      lastPath.current = undefined;
    }
  }, [tab.local, typedState]);

  useEffect(() => {
    if (!shown || !connected || !pending) return;
    setPending(undefined);
    const id = ++request.current;
    backend.listFiles(tab.id, pending.path).then(
      (next) => {
        if (id !== request.current) return;
        lastPath.current = next.path;
        setListing(next);
        setPathText(next.path);
        setError(undefined);
        if (next.path !== listing?.path) setSelected(new Set());
      },
      (e: Error) => id === request.current && setError(e.message),
    );
  }, [backend, tab.id, shown, connected, pending, listing?.path]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (
        e instanceof globalThis.KeyboardEvent
          ? e.key === 'Escape'
          : !menuRef.current?.contains(e.target as Node)
      )
        setMenu(undefined);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const all = listing?.files ?? [];
  const cmp = comparer(sort.key);
  const files = all
    .filter((f) => showHidden || !f.name.startsWith('.'))
    .sort(
      (a, b) =>
        Number(b.folder) - Number(a.folder) ||
        (sort.descending ? -cmp(a, b) : cmp(a, b)),
    );
  const picked = files.filter((f) => selected.has(f.name));
  const one = picked.length === 1 ? picked[0] : undefined;
  const at = listing?.path ?? '';

  const fail = (e: Error) => setError(e.message);
  const browse = (alias?: string) =>
    backend.browseFiles(tab.id, alias).catch(fail);
  const open = (file: RemoteFile) =>
    file.folder
      ? go(join(at, file.name))
      : backend.openInEditor(tab.id, join(at, file.name)).catch(fail);
  const selectAll = () => setSelected(new Set(files.map((f) => f.name)));

  const click = (name: string, e: MouseEvent) => {
    if (e.shiftKey && anchor !== undefined) {
      const names = files.map((f) => f.name);
      const [from, to] = [names.indexOf(anchor), names.indexOf(name)].sort(
        (a, b) => a - b,
      );
      setSelected(new Set(names.slice(Math.max(from, 0), to + 1)));
      return;
    }
    setAnchor(name);
    if (mac ? e.metaKey : e.ctrlKey) {
      const next = new Set(selected);
      if (!next.delete(name)) next.add(name);
      setSelected(next);
    } else setSelected(new Set([name]));
  };

  const askDelete = () => {
    if (!picked.length) return;
    const names = picked.map((f) => f.name);
    const folders = picked.filter((f) => f.folder).map((f) => f.name);
    const paths = names.map((n) => join(at, n));
    setDeleting({ paths, names, folders });
    if (folders.length)
      backend
        .measureFiles(
          tab.id,
          folders.map((n) => join(at, n)),
        )
        .then((found) => {
          const counts = Object.fromEntries(
            folders.map((n, i) => [n, found[i]]),
          );
          setDeleting((d) => (d?.paths === paths ? { ...d, counts } : d));
        }, fail);
  };

  const finishEdit = (name?: string) => {
    const edit = editing;
    setEditing(undefined);
    grid.current?.focus();
    if (!edit || name === undefined) return;
    if ('rename' in edit) {
      if (name !== edit.rename)
        backend
          .renameFile(tab.id, join(at, edit.rename), join(at, name))
          .then(refresh, fail);
    } else backend.makeFolder(tab.id, join(at, name)).then(refresh, fail);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // A key in the name field or a header button belongs to it.
    if (e.target !== e.currentTarget) return;
    const command = mac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Enter' && one) open(one);
    else if (e.key === 'F2' && one) setEditing({ rename: one.name });
    else if (mac ? e.key === 'Backspace' && e.metaKey : e.key === 'Delete')
      askDelete();
    else if (e.key === 'Backspace' && at !== '/') go(parentOf(at));
    else if (command && key === 'a') selectAll();
    // Cmd+R would reload the window through the default menu.
    else if (e.key === 'F5' || (mac && e.metaKey && key === 'r')) refresh();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const names = files.map((f) => f.name);
      const i = names.indexOf(anchor ?? '');
      const next =
        names[
          Math.min(
            Math.max(e.key === 'ArrowDown' ? i + 1 : i - 1, 0),
            names.length - 1,
          )
        ];
      if (next === undefined) return;
      setAnchor(next);
      setSelected(new Set([next]));
    } else return;
    e.preventDefault();
  };

  const item = (
    label: string,
    run?: () => void,
    { danger = false, disabled = !run } = {},
  ) => (
    <li role="none" key={label}>
      <button
        role="menuitem"
        className={danger ? 'danger' : undefined}
        disabled={disabled}
        onClick={() => {
          setMenu(undefined);
          grid.current?.focus();
          run?.();
        }}
      >
        {label}
      </button>
    </li>
  );
  const pickedPaths = () => picked.map((f) => join(at, f.name));
  const download = () => backend.download(tab.id, pickedPaths()).catch(fail);
  const downloadTo = async () => {
    const paths = pickedPaths();
    const folder = await backend.pickFolder();
    if (folder) await backend.download(tab.id, paths, folder).catch(fail);
  };
  const upload = (paths: string[]) =>
    paths.length && backend.upload(tab.id, paths, at).catch(fail);
  const uploadFiles = async () => upload(await backend.pickFiles());
  // Text or a row dragged inside the page carries no files.
  const carriesFiles = (e: DragEvent) =>
    !down && !!listing && [...e.dataTransfer.types].includes('Files');

  const rowMenu = () => [
    one && item(one.folder ? 'Open' : 'Open in editor', () => open(one)),
    item(
      picked.length > 1 ? `Download ${picked.length} items` : 'Download',
      download,
    ),
    item('Download to…', downloadTo),
    item('Rename', () => setEditing({ rename: one!.name }), { disabled: !one }),
    <li key="separator" role="separator" />,
    item(
      picked.length > 1 ? `Delete ${picked.length} items` : 'Delete',
      askDelete,
      {
        danger: true,
      },
    ),
  ];
  const spaceMenu = () => [
    item('New folder', () => setEditing({ create: true })),
    item('Upload files…', uploadFiles),
    item('Refresh', refresh),
    item('Select all', selectAll),
  ];

  const names = all.map((f) => f.name);
  const nameCell = (file: RemoteFile) => (
    <span className="file-name" style={{ color: nameColour(file, theme) }}>
      {file.name}
    </span>
  );

  return (
    <div className="sftp-pane" hidden={!shown}>
      <div className="sftp-toolbar">
        {browsing && (
          <>
            <button
              aria-label="Up"
              title="Up"
              disabled={!listing || at === '/'}
              onClick={() => go(parentOf(at))}
            >
              {upIcon}
            </button>
            <input
              aria-label="Path"
              spellCheck={false}
              value={pathText}
              onChange={(e) => setPathText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go(pathText);
                else if (e.key === 'Escape') setPathText(at);
              }}
            />
            <button aria-label="Refresh" title="Refresh" onClick={refresh}>
              {refreshIcon}
            </button>
            <button
              aria-label="Follow terminal"
              title="Follow terminal"
              aria-pressed={follow && !away}
              onClick={() => setFollow(!follow)}
            >
              {followIcon}
            </button>
            <button
              aria-label="Show hidden files"
              title="Show hidden files"
              aria-pressed={showHidden}
              onClick={() => setShowHidden(!showHidden)}
            >
              {hiddenIcon}
            </button>
            {typed?.picked && (
              <button onClick={() => backend.stopBrowsing(tab.id)}>
                Stop browsing
              </button>
            )}
          </>
        )}
        <button
          className="collapse"
          aria-label="Collapse SFTP pane"
          title="Collapse SFTP pane"
          aria-keyshortcuts={mac ? 'Meta+B' : 'Control+Shift+B'}
          onClick={onCollapse}
        >
          {collapseIcon}
        </button>
      </div>
      {typed?.notice && (
        <p role="status" className="sftp-banner warn">
          {typed.notice}
        </p>
      )}
      {!browsing ? (
        <LocalHint ssh={typed} wsl={wsl} tree={tree} onBrowse={browse} />
      ) : (
        <>
          {paneDropped ? (
            <div role="status" className="sftp-banner danger">
              {typed.reason} <button onClick={() => browse()}>Reconnect</button>
            </div>
          ) : down ? (
            <p role="status" className="sftp-banner danger">
              Disconnected. Reconnect the Tab to browse again.
            </p>
          ) : (
            away && (
              <p role="status" className="sftp-banner warn">
                Terminal is on {tab.host}. This pane shows {tab.firstHost}.
              </p>
            )
          )}
          {error && (
            <p role="alert" className="sftp-error">
              {error}
            </p>
          )}
          {keyChange && (
            <div role="alert" className="sftp-banner danger key-change">
              <strong>The host key for transfers has changed</strong>
              <p>
                {keyChange.host} sent a different key than the one the Tab
                accepted. Someone could be intercepting the connection.
                Transfers fail until the key matches. Reconnect the Tab to check
                the key.
              </p>
              <p>
                Tab accepted {keyChange.keyType} key:{' '}
                <code>{keyChange.accepted}</code>
                <br />
                Key sent now: <code>{keyChange.fingerprint}</code>
              </p>
            </div>
          )}
          <div
            className={down ? 'file-list greyed' : 'file-list'}
            inert={down}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ left: e.clientX, top: e.clientY, row: false });
            }}
            onDragEnter={(e) => {
              if (!carriesFiles(e)) return;
              e.preventDefault();
              setDragging(true);
            }}
            // The browser only drops where dragover is cancelled.
            onDragOver={(e) => carriesFiles(e) && e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={(e) => {
              if (!carriesFiles(e)) return;
              e.preventDefault();
              setDragging(false);
              upload([...e.dataTransfer.files].map(backend.pathForFile));
            }}
          >
            {dragging && (
              <div className="drop-overlay">Drop to upload to {at}</div>
            )}
            <table
              ref={grid}
              role="grid"
              aria-label="Files"
              aria-multiselectable="true"
              tabIndex={0}
              onKeyDown={onKeyDown}
            >
              <thead>
                <tr>
                  {columns.map(({ key, label }) => (
                    <th
                      key={key}
                      aria-sort={
                        sort.key === key
                          ? sort.descending
                            ? 'descending'
                            : 'ascending'
                          : undefined
                      }
                    >
                      <button
                        onClick={() =>
                          setSort({
                            key,
                            descending: sort.key === key && !sort.descending,
                          })
                        }
                      >
                        {label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editing && 'create' in editing && (
                  <tr>
                    <td colSpan={4}>
                      {folderIcon}
                      <NameField
                        initial="New folder"
                        taken={names}
                        onDone={finishEdit}
                      />
                    </td>
                  </tr>
                )}
                {files.map((file) => (
                  <tr
                    key={file.name}
                    aria-selected={selected.has(file.name)}
                    className={
                      file.name.startsWith('.') ? 'hidden-file' : undefined
                    }
                    onClick={(e) => click(file.name, e)}
                    onDoubleClick={() => open(file)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selected.has(file.name)) {
                        setSelected(new Set([file.name]));
                        setAnchor(file.name);
                      }
                      setMenu({ left: e.clientX, top: e.clientY, row: true });
                    }}
                  >
                    <td>
                      {file.folder ? folderIcon : fileIcon}
                      {editing &&
                      'rename' in editing &&
                      editing.rename === file.name ? (
                        <NameField
                          initial={file.name}
                          taken={names.filter((n) => n !== file.name)}
                          onDone={finishEdit}
                        />
                      ) : (
                        nameCell(file)
                      )}
                    </td>
                    <td>{file.folder ? '' : formatSize(file.size)}</td>
                    <td>{formatTime(file.modified)}</td>
                    <td>{file.permissions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {picked.length > 0 && !down && (
            <div role="note" className="sftp-hints">
              Enter Open · F2 Rename · {mac ? '⌘⌫' : 'Del'} Delete · ⌫ Up ·{' '}
              {mac ? '⌘A' : 'Ctrl+A'} Select all · {mac ? '⌘R' : 'F5'} Refresh ·
              Right-click for more
            </div>
          )}
          {menu && (
            <ul
              ref={menuRef}
              role="menu"
              className="menu"
              style={{ left: menu.left, top: menu.top }}
            >
              {menu.row ? rowMenu() : spaceMenu()}
            </ul>
          )}
          {!!tab.transfers?.length && (
            <TransferList
              transfers={tab.transfers}
              onCancel={(id) => backend.cancelTransfer(tab.id, id)}
              onRetry={(id) => backend.retryTransfer(tab.id, id)}
              onShow={(file) => backend.showItem(file)}
            />
          )}
          {conflict && (
            <ConflictDialog
              key={conflict.name}
              conflict={conflict}
              host={hostOf(tab) ?? 'the host'}
              onAnswer={(choice, all) => {
                setConflict(undefined);
                backend.answerConflict(tab.id, choice, all);
              }}
            />
          )}
          {editorQuestion && (
            <EditorSaveDialog
              key={editorQuestion.id + editorQuestion.reason}
              question={editorQuestion}
              host={hostOf(tab) ?? 'the host'}
              onAnswer={(upload) => {
                setEditorQuestion(undefined);
                backend.answerEditorSave(tab.id, editorQuestion.id, upload);
              }}
            />
          )}
          {/* A drop hides the confirm: its Delete couldn't reach the host. */}
          {deleting && !down && (
            <DeleteConfirm
              {...deleting}
              onCancel={() => {
                setDeleting(undefined);
                grid.current?.focus();
              }}
              onDelete={() => {
                const { paths } = deleting;
                setDeleting(undefined);
                grid.current?.focus();
                backend.deleteFiles(tab.id, paths).then(refresh, fail);
              }}
            />
          )}
        </>
      )}
      {!browsing && error && (
        <p role="alert" className="sftp-error">
          {error}
        </p>
      )}
      {paneKey && (
        <HostKeyPrompt
          question={paneKey}
          onAnswer={(trust) => {
            setPaneKey(undefined);
            backend.answerHostKey(tab.id, trust);
          }}
        />
      )}
      {paneSecret && typed && (
        <SecretPrompt
          key={paneSecret.title + (paneSecret.reason ?? '')}
          backend={backend}
          question={paneSecret}
          pane={{
            tree,
            host: typed.alias,
            user: typed.user,
            keychain: mac ? 'macOS Keychain' : 'Windows Credential Manager',
          }}
          onAnswer={(answers, save, create) => {
            setPaneSecret(undefined);
            backend.answerSecret(tab.id, answers, save, create);
          }}
        />
      )}
    </div>
  );
}
