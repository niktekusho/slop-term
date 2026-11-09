import { useEffect, useState } from 'react';
import type {
  BackendClient,
  KeepassDatabase,
  KeepassEntry,
  KeepassFind,
  KeepassTarget,
} from '../shared/ipc.ts';

/** Asks for a locked database's master password. A wrong one stays here with the reason. */
export function UnlockForm({
  backend,
  name,
  onUnlocked,
  onCancel,
}: {
  backend: BackendClient;
  name: string;
  onUnlocked(): void;
  onCancel?(): void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  // Not a <form>: this sits inside other forms.
  const unlock = () =>
    backend
      .unlockKeepass(name, password)
      .then(onUnlocked, (e: Error) => setError(e.message));
  return (
    <div className="unlock">
      <input
        type="password"
        aria-label={`Master password for ${name}`}
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (password) void unlock();
        }}
      />{' '}
      <button type="button" disabled={!password} onClick={unlock}>
        Unlock
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
    </div>
  );
}

/** Finds a KeePass entry across the unlocked databases, with an Unlock row for each locked one. */
export function KeepassFinder({
  backend,
  onAttach,
}: {
  backend: BackendClient;
  onAttach(entry: KeepassEntry): void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<KeepassFind>();
  const [error, setError] = useState<string>();
  const [unlocking, setUnlocking] = useState<string>();
  const find = (text: string) => {
    setError(undefined);
    backend.findKeepass(text).then(setFound, (e: Error) => {
      setFound(undefined);
      setError(e.message);
    });
  };
  // An empty search lists everything, so the Unlock rows show at once.
  useEffect(() => {
    setError(undefined);
    backend.findKeepass('').then(setFound, (e: Error) => setError(e.message));
  }, [backend]);
  return (
    <div role="tabpanel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          find(query);
        }}
      >
        <input
          aria-label="KeePass search"
          autoFocus
          spellCheck={false}
          placeholder="Title, username, URL or group"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />{' '}
        <button type="submit">Find</button>
      </form>
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
      {found?.locked.map((name) => (
        <div key={name}>
          {unlocking === name ? (
            <UnlockForm
              backend={backend}
              name={name}
              onUnlocked={() => {
                setUnlocking(undefined);
                find(query);
              }}
              onCancel={() => setUnlocking(undefined)}
            />
          ) : (
            <button onClick={() => setUnlocking(name)}>Unlock {name}</button>
          )}
        </div>
      ))}
      {found &&
        (found.entries.length ? (
          <ul className="choices">
            {found.entries.map((entry) => (
              <li key={entry.id}>
                <button onClick={() => onAttach(entry)}>
                  {entry.name}{' '}
                  <span className="detail">
                    {entry.username} {entry.group}
                  </span>{' '}
                  <span className="detail">{entry.database}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !found.locked.length && (
            <p className="note">No KeePass entry matches.</p>
          )
        ))}
    </div>
  );
}

/** `true` is the keychain, `false` saves nothing, a group is a new KeePass entry there. */
export type SaveChoice = boolean | KeepassTarget;

const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The group named like the Saved session's folder, else the group used last, else the root group. */
function pickGroup(
  database: KeepassDatabase,
  folder: string,
  last?: KeepassTarget,
) {
  const wanted = lastSegment(folder).toLowerCase();
  const named =
    wanted &&
    (database.groups.find((g) => g.toLowerCase() === folder.toLowerCase()) ??
      database.groups.find((g) => lastSegment(g).toLowerCase() === wanted));
  if (named) return named;
  return last?.database === database.name &&
    database.groups.includes(last.group)
    ? last.group
    : '';
}

/**
 * The "Save to" choice: keychain first, KeePass only when this machine has a database, and "don't save" when `allowNone`.
 * It reports `undefined` while KeePass is picked but its database is locked.
 */
export function SaveTo({
  backend,
  folder,
  allowNone,
  onChange,
}: {
  backend: BackendClient;
  /** The Saved session's folder, which preselects the group. */
  folder: string;
  allowNone: boolean;
  onChange(choice: SaveChoice | undefined): void;
}) {
  const [to, setTo] = useState<'keychain' | 'keepass' | 'none'>('keychain');
  const [databases, setDatabases] = useState<KeepassDatabase[]>([]);
  const [last, setLast] = useState<KeepassTarget>();
  const [picked, setPicked] = useState<string>();
  const [group, setGroup] = useState<string>();
  const load = () => backend.keepassDatabases().then(setDatabases, () => {});
  useEffect(() => {
    void load();
    backend.settings().then((s) => setLast(s.keepassLastGroup));
  }, [backend]);

  const database =
    databases.find((d) => d.name === picked) ??
    databases.find((d) => d.name === last?.database) ??
    databases[0];
  const chosen =
    database && !database.locked
      ? (group ?? pickGroup(database, folder, last))
      : undefined;

  const choice: SaveChoice | undefined =
    to === 'keychain'
      ? true
      : to === 'none'
        ? false
        : chosen === undefined
          ? undefined
          : { database: database!.name, group: chosen };
  const key = JSON.stringify(choice ?? null);
  useEffect(() => onChange(JSON.parse(key) ?? undefined), [key]);

  return (
    <>
      <label className="field">
        <span>Save to</span>
        <select value={to} onChange={(e) => setTo(e.target.value as typeof to)}>
          <option value="keychain">keychain</option>
          {databases.length > 0 && <option value="keepass">KeePass</option>}
          {allowNone && <option value="none">don't save</option>}
        </select>
      </label>
      {to === 'keepass' && database && (
        <>
          <label className="field">
            <span>Database</span>
            <select
              value={database.name}
              onChange={(e) => {
                setPicked(e.target.value);
                setGroup(undefined);
              }}
            >
              {databases.map((d) => (
                <option key={d.name}>{d.name}</option>
              ))}
            </select>
          </label>
          {database.locked ? (
            <UnlockForm
              key={database.name}
              backend={backend}
              name={database.name}
              onUnlocked={() => void load()}
            />
          ) : (
            <label className="field">
              <span>Group</span>
              <select value={chosen} onChange={(e) => setGroup(e.target.value)}>
                <option value="">(root)</option>
                {database.groups.map((g) => (
                  <option key={g} value={g}>
                    {g.split('/').join(' / ')}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </>
  );
}

/**
 * Unlocks each of `names` that is locked, one master password at a time, then calls `onUnlocked`.
 * Cancel stops there and leaves the rest locked.
 */
export function UnlockBeforeDelete({
  backend,
  names,
  onUnlocked,
  onCancel,
}: {
  backend: BackendClient;
  names: string[];
  onUnlocked(): void;
  onCancel(): void;
}) {
  const [waiting, setWaiting] = useState<string[]>();
  useEffect(() => {
    backend.keepassDatabases().then(
      (all) =>
        setWaiting(names.filter((n) => all.find((d) => d.name === n)?.locked)),
      // A database that can't be listed fails its own delete, which the back end leaves for the user to clean up.
      () => setWaiting([]),
    );
    // The names are fixed for the life of the confirm.
  }, [backend]);
  useEffect(() => {
    if (waiting && !waiting.length) onUnlocked();
  }, [waiting]);
  if (!waiting?.length) return null;
  return (
    <div role="group" aria-label="Unlock KeePass">
      <p>
        Deleting the saved secret needs the master password of{' '}
        <code>{waiting[0]}</code>.
      </p>
      <UnlockForm
        key={waiting[0]}
        backend={backend}
        name={waiting[0]}
        onUnlocked={() => setWaiting((w) => w!.slice(1))}
        onCancel={onCancel}
      />
    </div>
  );
}
