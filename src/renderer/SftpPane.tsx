import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { ITheme } from '@xterm/xterm';
import type {
  BackendClient,
  FileCounts as Counts,
  Listing,
  RemoteFile,
} from '../shared/ipc.ts';
import { folderIcon, icon, type Tab } from './SessionTree.tsx';

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

/**
 * The SFTP pane of one Tab. It stays mounted while hidden, so its folder and selection survive a switch of Tabs.
 * It lists only while `shown` and connected: the first listing opens the back end's SFTP channel.
 */
export function SftpPane({
  backend,
  tab,
  shown,
  mac,
  theme,
  onCollapse,
}: {
  backend: BackendClient;
  tab: Tab;
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
  const menuRef = useRef<HTMLUListElement>(null);
  const grid = useRef<HTMLTableElement>(null);
  // A later request wins, so a slow listing can't replace a newer one.
  const request = useRef(0);
  const lastPath = useRef<string>(undefined);

  const away = !!tab.host && tab.host !== tab.firstHost;
  const down = !!tab.disconnected || tab.exit !== undefined;
  const go = (path?: string) => setPending({ path });
  // After an action, a folder the user went to meanwhile wins over the one the action ran in.
  const refresh = () => setPending((p) => p ?? { path: lastPath.current });

  useEffect(
    () =>
      backend.onEvent((event) => {
        if (!('tab' in event) || event.tab !== tab.id) return;
        if (event.type === 'connected') {
          setConnected(true);
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
  const open = (file: RemoteFile) => {
    // ponytail: a file opens in the editor only from ticket 19 on.
    if (file.folder) go(join(at, file.name));
  };
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
  // ponytail: downloads and uploads belong to ticket 18 and the editor to ticket 19, so their items stay disabled.
  const rowMenu = () => [
    one &&
      item(
        one.folder ? 'Open' : 'Open in editor',
        one.folder ? () => open(one) : undefined,
      ),
    item(picked.length > 1 ? `Download ${picked.length} items` : 'Download'),
    item('Download to…'),
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
    item('Upload files…'),
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
        {!tab.local && (
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
      {tab.local ? (
        <div className="sftp-empty">
          <p>No remote host</p>
          <p>
            Type <code>ssh &lt;host&gt;</code> in the terminal to browse its
            files here.
          </p>
        </div>
      ) : (
        <>
          {down ? (
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
          <div
            className={down ? 'file-list greyed' : 'file-list'}
            inert={down}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ left: e.clientX, top: e.clientY, row: false });
            }}
          >
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
    </div>
  );
}
