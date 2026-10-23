import { useState, type CSSProperties, type ReactNode } from 'react';
import type { SessionTree as Model, TabId } from '../shared/ipc.ts';

type Folder = {
  name: string;
  path: string;
  folders: Folder[];
  sessions: string[];
};

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' });

const depth = (d: number) => ({ '--depth': d }) as CSSProperties;

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

// A session's folder shows even when the Sidecar folder list misses it.
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
  return root;
}

const hasSessions = (f: Folder): boolean =>
  f.sessions.length > 0 || f.folders.some(hasSessions);

function SessionRow({
  alias,
  level,
  handWritten,
}: {
  alias: string;
  level: number;
  handWritten?: boolean;
}) {
  return (
    <li>
      <div className="row" style={depth(level)}>
        <span className="slot" />
        <span className="edge ssh" />
        <span className="name">{alias}</span>
        {handWritten && lock}
      </div>
    </li>
  );
}

export function SessionTree({
  model,
  tabs,
  active,
  onSelectTab,
  query,
}: {
  model: Model;
  tabs: { id: TabId; label: string }[];
  active: TabId | undefined;
  onSelectTab(id: TabId): void;
  query: string;
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const keep = (name: string) =>
    name.toLowerCase().includes(query.toLowerCase());
  const root = nest(model, keep);
  const shownTabs = tabs.filter((t) => keep(t.label));
  const handWritten = model.handWritten.filter(keep).toSorted(byName);

  const toggle = (path: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  // While filtering, every match shows: collapsed folders open and empty ones hide.
  const folderRows = (folders: Folder[], level: number) =>
    folders
      .filter((f) => !query || hasSessions(f))
      .toSorted((a, b) => byName(a.name, b.name))
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
                {sessionRows(f.sessions, level + 1)}
              </ul>
            )}
          </li>
        );
      });

  const sessionRows = (aliases: string[], level: number) =>
    aliases
      .toSorted(byName)
      .map((alias) => <SessionRow key={alias} alias={alias} level={level} />);

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
            {shownTabs.map((tab) => (
              <li key={tab.id}>
                <button
                  className="row"
                  style={depth(0)}
                  aria-current={tab.id === active || undefined}
                  onClick={() => onSelectTab(tab.id)}
                >
                  <span className="name">{tab.label}</span>
                </button>
              </li>
            ))}
            {handWritten.map((alias) => (
              <SessionRow key={alias} alias={alias} level={0} handWritten />
            ))}
          </ul>
        </section>
      )}
      <ul>
        {sessionRows(root.sessions, 0)}
        {folderRows(root.folders, 0)}
      </ul>
    </>
  );
}
