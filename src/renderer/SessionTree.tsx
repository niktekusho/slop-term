import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import type { SessionTree as Model, Shell, TabId } from '../shared/ipc.ts';
import {
  folderProblem,
  inFolder,
  joinFolder,
} from '../shared/session-rules.ts';

/** `source` is the alias an SSH Tab opened, or the shell of a local one. */
export type Tab = {
  id: TabId;
  source: string | Shell;
  folder?: string;
  title?: string;
  address?: string;
  exit?: number;
  /** `retry` until R reconnects it. `final` when a reconnect can't help. */
  disconnected?: 'retry' | 'final';
};

type Folder = {
  name: string;
  path: string;
  folders: Folder[];
  sessions: string[];
};

export const shellLabel = (shell: Shell) =>
  shell.kind === 'wsl' ? `wsl: ${shell.distro}` : shell.kind;

export const tabLabel = (tab: Tab) =>
  typeof tab.source === 'string' ? tab.source : shellLabel(tab.source);

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

const depth = (d: number) => ({ '--depth': d }) as CSSProperties;

// Shells set the title to their own name or path, which says nothing about the Tab.
const namesShell = (title: string) =>
  /^-?(.*[\\/])?(bash|zsh|sh|fish|pwsh|powershell|cmd|wsl)(\.exe)?$/i.test(
    title,
  );

const icon = (className: string, shape: ReactNode) => (
  <svg className={`icon ${className}`} viewBox="0 0 16 16" aria-hidden="true">
    {shape}
  </svg>
);

const chevron = icon('chevron', <path d="M6 4l4 4-4 4" />);
const folderIcon = icon(
  'folder-icon',
  <path d="M1.5 3.5h4l1.5 1.5h7.5v7.5h-13z" />,
);
const exitIcon = icon(
  'exit-icon',
  <path d="M6.5 2.5h-4v11h4M10 5l3 3-3 3M13 8H6" />,
);
const brokenIcon = icon(
  'broken-icon',
  <path d="M6.5 9.5l-2 2a2 2 0 01-3-3l2-2M9.5 6.5l2-2a2 2 0 013 3l-2 2M5.5 1.5v2M1.5 5.5h2M10.5 14.5v-2M14.5 10.5h-2" />,
);
const lock = (
  <span className="lock" title="Hand-written host, read-only">
    {icon(
      'lock-icon',
      <>
        <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
        <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
      </>,
    )}
  </span>
);
const warnIcon = icon(
  'warn-icon',
  <path d="M8 1.5l6.5 12h-13zM8 6v3.5M8 11.5v.5" />,
);

// A session's folder shows even when the Sidecar folder list misses it. Folders and sessions come out sorted.
function nest(model: Model, keep: (name: string) => boolean): Folder {
  const root: Folder = { name: '', path: '', folders: [], sessions: [] };
  const nodes = new Map([['', root]]);
  const folder = (path: string) => {
    let node = root;
    for (const name of path.split('/').filter(Boolean)) {
      const key = node.path ? `${node.path}/${name}` : name;
      let child = nodes.get(key);
      if (!child) {
        child = { name, path: key, folders: [], sessions: [] };
        nodes.set(key, child);
        node.folders.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const path of model.folders) folder(path);
  for (const { alias, folder: path } of model.sessions)
    if (keep(alias)) folder(path ?? '').sessions.push(alias);
  for (const node of nodes.values()) {
    node.folders.sort((a, b) => byName(a.name, b.name));
    node.sessions.sort(byName);
  }
  return root;
}

const hasSessions = (f: Folder): boolean =>
  f.sessions.length > 0 || f.folders.some(hasSessions);

/** Every folder path in tree order, including folders only a session's folder names. */
export function folderPaths(model: Model) {
  const walk = (f: Folder): string[] => [f.path, ...f.folders.flatMap(walk)];
  return nest(model, () => true).folders.flatMap(walk);
}

export type TreeItem = { alias: string } | { folder: string };

const folderKeys = { F2: 'rename', Delete: 'delete', F7: 'move' } as const;

/** A folder row in edit mode. Enter or blur commits a valid name; Esc cancels. */
function FolderName({
  initial,
  siblings,
  level,
  onDone,
}: {
  initial: string;
  siblings: string[];
  level: number;
  onDone(name?: string): void;
}) {
  const [name, setName] = useState(initial);
  // Enter, Esc and the blur that follows them would each end the edit.
  const done = useRef(false);
  const problem = folderProblem(name, siblings);
  const finish = (result?: string) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  const commit = () => problem || finish(name.trim());
  return (
    <input
      className="folder-name"
      style={depth(level)}
      aria-label="Folder name"
      autoFocus
      spellCheck={false}
      value={name}
      aria-invalid={!!problem}
      title={problem}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') {
          e.stopPropagation();
          finish();
        }
      }}
    />
  );
}

/** Sorts Tabs under the hosts they came from. Unsaved holds local shells, then Tabs whose host left the tree. */
function place(model: Model, tabs: Tab[]) {
  const hosts = new Set([
    ...model.sessions.map((s) => s.alias),
    ...model.handWritten,
  ]);
  const under = new Map<string, Tab[]>();
  const shells: Tab[] = [];
  const orphans: Tab[] = [];
  for (const tab of tabs) {
    if (typeof tab.source !== 'string') shells.push(tab);
    else if (!hosts.has(tab.source)) orphans.push(tab);
    else under.set(tab.source, [...(under.get(tab.source) ?? []), tab]);
  }
  return { unsaved: [...shells, ...orphans], under };
}

/** Every Tab in the order the tree lists it, whatever the filter or collapsed folders hide. */
export function tabOrder(model: Model, tabs: Tab[]) {
  const { unsaved, under } = place(model, tabs);
  const root = nest(model, () => true);
  const of = (aliases: string[]) => aliases.flatMap((a) => under.get(a) ?? []);
  const walk = (f: Folder): Tab[] => [
    ...f.folders.flatMap(walk),
    ...of(f.sessions),
  ];
  return [
    ...unsaved,
    ...of(model.handWritten.toSorted(byName)),
    ...of(root.sessions),
    ...root.folders.flatMap(walk),
  ];
}

function TabRow({
  tab,
  level,
  number,
  active,
  unsaved,
  mac,
  onSelect,
}: {
  tab: Tab;
  level: number;
  number: number;
  active: boolean;
  unsaved: boolean;
  mac: boolean;
  onSelect(id: TabId): void;
}) {
  const folder = tab.folder && (tab.folder.split('/').findLast(Boolean) ?? '/');
  const title =
    tab.exit !== undefined
      ? `exit ${tab.exit}`
      : tab.title && !namesShell(tab.title)
        ? tab.title
        : undefined;
  // A Tab in the Unsaved list leads with its shell or alias and shows no title; a Tab under its host leads with its folder, else its title.
  const [name, ...details] = unsaved
    ? [tabLabel(tab), folder, tab.exit !== undefined ? title : undefined]
    : folder
      ? [folder, title]
      : [title ?? tabLabel(tab)];
  const numbered = number <= 9;
  return (
    <li className="tab">
      <button
        className={tab.disconnected ? 'row disconnected' : 'row'}
        style={depth(level)}
        aria-current={active || undefined}
        aria-keyshortcuts={
          numbered
            ? mac
              ? `Meta+${number}`
              : `Control+Shift+${number}`
            : undefined
        }
        onClick={() => onSelect(tab.id)}
      >
        {tab.exit !== undefined && exitIcon}
        {tab.disconnected && brokenIcon}
        <span className="name">{name}</span>
        {/* The space only separates the words in the accessible name: flex layout drops it. */}
        {details.map(
          (detail, i) =>
            detail && (
              <Fragment key={i}>
                {' '}
                <span className="detail">{detail}</span>
              </Fragment>
            ),
        )}
      </button>
      {numbered && (
        <kbd
          className="keycap"
          title={mac ? `Cmd+${number}` : `Ctrl+Shift+${number}`}
        >
          {number}
        </kbd>
      )}
    </li>
  );
}

export function SessionTree({
  model,
  tabs,
  active,
  mac,
  onSelectTab,
  onOpenHost,
  onSession,
  onFolder,
  onMove,
  editing,
  onEditDone,
  onSelectFolder,
  query,
}: {
  model: Model;
  tabs: Tab[];
  active: TabId | undefined;
  mac: boolean;
  onSelectTab(id: TabId): void;
  onOpenHost(alias: string): void;
  /** F2, Delete, F7 or a right-click at a position on a host's row. A Hand-written host sends only the right-click. */
  onSession(
    alias: string,
    action: 'edit' | 'delete' | 'move' | { left: number; top: number },
  ): void;
  onFolder(
    folder: string,
    action: 'rename' | 'delete' | 'move' | { left: number; top: number },
  ): void;
  /** A drag and drop. '' is the top level. */
  onMove(item: TreeItem, to: string): void;
  /** A new folder in `parent`, or a rename of `folder`. */
  editing?: { parent: string; folder?: string };
  /** The name to commit, or none when the user cancelled. */
  onEditDone(name?: string): void;
  /** The folder of the row that last had focus, where "New" creates. */
  onSelectFolder(folder: string): void;
  query: string;
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const dragged = useRef<TreeItem>(undefined);
  const list = useRef<HTMLUListElement>(null);
  // The edited row unmounts with its field, and a new or renamed folder's row appears only after the back end answers.
  const refocus = useRef<string>(undefined);
  useEffect(() => {
    const target = [
      ...(list.current?.querySelectorAll<HTMLElement>('[data-folder]') ?? []),
    ].find((el) => el.dataset.folder === refocus.current);
    if (!target) return;
    refocus.current = undefined;
    target.focus();
  });
  const editDone = (name?: string) => {
    refocus.current =
      name === undefined
        ? (editing?.folder ?? editing?.parent)
        : joinFolder(editing!.parent, name);
    onEditDone(name);
  };
  const [dropTarget, setDropTarget] = useState<string>();
  const alsoIn = new Map(model.sessions.map((s) => [s.alias, s.alsoInConfig]));

  // Folder rows and the top-level list take drops. The deepest folder under the pointer wins.
  const dropProps = (to: string) => {
    const allowed = () => {
      const item = dragged.current;
      return !!item && !('folder' in item && inFolder(to, item.folder));
    };
    return {
      onDragOver(e: DragEvent) {
        e.stopPropagation();
        if (!allowed()) return;
        e.preventDefault();
        setDropTarget(to);
      },
      onDrop(e: DragEvent) {
        e.stopPropagation();
        e.preventDefault();
        if (allowed()) onMove(dragged.current!, to);
        dragged.current = undefined;
        setDropTarget(undefined);
      },
    };
  };
  const dragProps = (item: TreeItem) => ({
    draggable: true,
    onDragStart: () => (dragged.current = item),
    onDragEnd: () => {
      dragged.current = undefined;
      setDropTarget(undefined);
    },
  });
  const keep = (name: string) =>
    name.toLowerCase().includes(query.toLowerCase());
  const root = nest(model, keep);
  const { unsaved: unsavedTabs, under } = place(model, tabs);
  const numbers = new Map(
    tabOrder(model, tabs).map((tab, i) => [tab.id, i + 1]),
  );
  const shownTabs = unsavedTabs.filter((t) => keep(tabLabel(t)));
  const handWritten = model.handWritten.filter(keep).toSorted(byName);

  const toggle = (path: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const tabRow = (tab: Tab, level: number, unsaved = false) => (
    <TabRow
      key={tab.id}
      tab={tab}
      level={level}
      number={numbers.get(tab.id)!}
      active={tab.id === active}
      unsaved={unsaved}
      mac={mac}
      onSelect={onSelectTab}
    />
  );

  // `folder` is undefined for a Hand-written host, which is read-only: only Enter and its menu work on it.
  const sessionRow = (
    alias: string,
    level: number,
    folder: string | undefined,
  ) => (
    <li key={alias} className="session">
      <button
        className="row"
        style={depth(level)}
        {...(folder !== undefined && dragProps({ alias }))}
        onFocus={() => folder !== undefined && onSelectFolder(folder)}
        onDoubleClick={() => onOpenHost(alias)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpenHost(alias);
          else if (folder === undefined) return;
          else if (e.key === 'F2') onSession(alias, 'edit');
          else if (e.key === 'Delete') onSession(alias, 'delete');
          else if (e.key === 'F7') onSession(alias, 'move');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSession(alias, { left: e.clientX, top: e.clientY });
        }}
      >
        <span className="slot" />
        <span className="edge ssh" />
        <span className="name">{alias}</span>
        {folder === undefined && lock}
        {alsoIn.get(alias) && (
          <span
            className="also"
            title={`Also defined in ~/.ssh/config line ${alsoIn.get(alias)}`}
          >
            {warnIcon}
          </span>
        )}
      </button>
      <button
        className="add"
        aria-label={`Open another Tab of ${alias}`}
        title="Open another Tab"
        onClick={() => onOpenHost(alias)}
      >
        +
      </button>
      {under.has(alias) && (
        <ul>{under.get(alias)!.map((tab) => tabRow(tab, level + 1))}</ul>
      )}
    </li>
  );

  const newFolder = (parent: Folder, level: number) =>
    editing &&
    editing.folder === undefined &&
    editing.parent === parent.path && (
      <li key="(new folder)">
        <FolderName
          initial=""
          siblings={parent.folders.map((f) => f.name)}
          level={level}
          onDone={editDone}
        />
      </li>
    );

  // While filtering, every match shows: collapsed folders open and empty ones hide.
  const folderRows = (folders: Folder[], level: number) =>
    folders
      .filter((f) => !query || hasSessions(f))
      .map((f) => {
        const open =
          !!query || !collapsed.has(f.path) || editing?.parent === f.path;
        return (
          <li
            key={f.path}
            className={dropTarget === f.path ? 'drop' : undefined}
            {...dropProps(f.path)}
          >
            {editing?.folder === f.path ? (
              <FolderName
                initial={f.name}
                siblings={folders.filter((o) => o !== f).map((o) => o.name)}
                level={level}
                onDone={editDone}
              />
            ) : (
              <button
                className="row"
                style={depth(level)}
                aria-expanded={open}
                {...dragProps({ folder: f.path })}
                data-folder={f.path}
                onFocus={() => onSelectFolder(f.path)}
                onClick={() => query || toggle(f.path)}
                onKeyDown={(e) => {
                  if (Object.hasOwn(folderKeys, e.key))
                    onFolder(
                      f.path,
                      folderKeys[e.key as keyof typeof folderKeys],
                    );
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFolder(f.path, { left: e.clientX, top: e.clientY });
                }}
              >
                {chevron}
                {folderIcon}
                <span className="name">{f.name}</span>
              </button>
            )}
            {open && (
              <ul>
                {newFolder(f, level + 1)}
                {folderRows(f.folders, level + 1)}
                {f.sessions.map((alias) =>
                  sessionRow(alias, level + 1, f.path),
                )}
              </ul>
            )}
          </li>
        );
      });

  return (
    <>
      {model.warnings.map((warning) => (
        <p key={warning} className="warning" role="status">
          {warning}
        </p>
      ))}
      {(shownTabs.length > 0 || handWritten.length > 0) && (
        <section aria-labelledby="unsaved-heading">
          <h2 id="unsaved-heading" className="group">
            Unsaved
          </h2>
          <ul>
            {shownTabs.map((tab) => tabRow(tab, 0, true))}
            {handWritten.map((alias) => sessionRow(alias, 0, undefined))}
          </ul>
        </section>
      )}
      <ul
        ref={list}
        className={dropTarget === '' ? 'top-level drop' : 'top-level'}
        {...dropProps('')}
      >
        {root.sessions.map((alias) => sessionRow(alias, 0, ''))}
        {newFolder(root, 0)}
        {folderRows(root.folders, 0)}
      </ul>
    </>
  );
}
