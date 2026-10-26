import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import type { SessionTree as Model, Shell, TabId } from '../shared/ipc.ts';

/** `source` is the alias an SSH Tab opened, or the shell of a local one. */
export type Tab = {
  id: TabId;
  source: string | Shell;
  folder?: string;
  title?: string;
  address?: string;
  exit?: number;
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
        className="row"
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
  query,
}: {
  model: Model;
  tabs: Tab[];
  active: TabId | undefined;
  mac: boolean;
  onSelectTab(id: TabId): void;
  onOpenHost(alias: string): void;
  query: string;
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
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

  const sessionRow = (alias: string, level: number, handWritten = false) => (
    <li key={alias} className="session">
      <button
        className="row"
        style={depth(level)}
        onDoubleClick={() => onOpenHost(alias)}
        onKeyDown={(e) => e.key === 'Enter' && onOpenHost(alias)}
      >
        <span className="slot" />
        <span className="edge ssh" />
        <span className="name">{alias}</span>
        {handWritten && lock}
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

  // While filtering, every match shows: collapsed folders open and empty ones hide.
  const folderRows = (folders: Folder[], level: number) =>
    folders
      .filter((f) => !query || hasSessions(f))
      .map((f) => {
        const open = !!query || !collapsed.has(f.path);
        return (
          <li key={f.path}>
            <button
              className="row"
              style={depth(level)}
              aria-expanded={open}
              onClick={() => query || toggle(f.path)}
            >
              {chevron}
              {folderIcon}
              <span className="name">{f.name}</span>
            </button>
            {open && (
              <ul>
                {folderRows(f.folders, level + 1)}
                {f.sessions.map((alias) => sessionRow(alias, level + 1))}
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
            {handWritten.map((alias) => sessionRow(alias, 0, true))}
          </ul>
        </section>
      )}
      <ul>
        {root.sessions.map((alias) => sessionRow(alias, 0))}
        {folderRows(root.folders, 0)}
      </ul>
    </>
  );
}
