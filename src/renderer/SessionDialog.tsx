import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  isSessionColour,
  sessionColours,
  type BackendClient,
  type CredentialReference,
  type HostKeyQuestion,
  type KeepassEntry,
  type KeepassFind,
  type KeepassTarget,
  type SecretChange,
  type SecretQuestion,
  type SessionColour,
  type SessionDefaults,
  type SessionForm,
  type SessionTree,
  type TabId,
  type TestStep,
  type TpmEntry,
  type TpmFind,
} from '../shared/ipc.ts';
import { HostKeyPrompt } from './HostKeyPrompt.tsx';
import {
  KeepassFinder,
  SaveTo,
  UnlockBeforeDelete,
  type SaveChoice,
} from './Keepass.tsx';
import { SecretPrompt } from './SecretPrompt.tsx';
import {
  aliasProblem,
  deletable,
  jumpWarning,
  keepassDatabaseOf,
  optionKey,
  optionProblem,
  providerName,
  sameEntry,
  takenNames,
  usernameMismatch,
} from '../shared/session-rules.ts';
import { optionDescriptions } from './option-descriptions.ts';

/** `edit` is the session as read when the dialog opened; none means New or Duplicate. */
export type DialogStart = {
  form: SessionForm;
  edit?: { alias: string; read: string };
};

export const newForm = (folder: string): SessionForm => ({
  alias: '',
  folder,
  hostname: '',
  port: '',
  user: '',
  identityFile: '',
  options: ['ServerAliveInterval 15'],
});

/** The Colour row of both Saved session dialogs. */
export function ColourRow({
  id,
  value,
  onChange,
}: {
  id: string;
  value?: SessionColour;
  onChange(colour?: SessionColour): void;
}) {
  return (
    <>
      <label htmlFor={id}>Colour</label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) =>
          onChange(isSessionColour(e.target.value) ? e.target.value : undefined)
        }
      >
        <option value="">None</option>
        {sessionColours.map((c) => (
          <option key={c} value={c}>
            {c[0].toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
    </>
  );
}

/** `<alias>-2`, or the first free number after it. */
export function freeAlias(alias: string, taken: string[]) {
  for (let n = 2; ; n++) {
    const next = `${alias}-${n}`;
    if (!taken.some((t) => t.toLowerCase() === next)) return next;
  }
}

/** Every session in the tree except `own` that points at the same secret as `ref`. */
const sharing = (tree: SessionTree, ref: CredentialReference, own?: string) =>
  tree.sessions
    .filter((s) => s.alias !== own && sameEntry(s.credential, ref))
    .map((s) => s.alias);

const kindLabel = (kind: CredentialReference['kind']) =>
  kind === 'password' ? 'Password' : 'Key passphrase';

/** Where a new secret goes: the keychain, or `KeePass work / Servers`. */
const savedTo = (keepass?: KeepassTarget) =>
  keepass
    ? `KeePass ${[keepass.database, ...keepass.group.split('/').filter(Boolean)].join(' / ')}`
    : 'keychain';

/** What the Secret row names: the entry's title and where it is, or its raw id before the entry is read. */
const describe = (
  ref: CredentialReference,
  entry?: TpmEntry | KeepassEntry,
) => {
  if (!entry) return ref.entry;
  return 'database' in entry
    ? `${entry.name} in ${entry.database}`
    : `${entry.name} (${entry.id})`;
};

// A Windows path works only on the machine it names. `~/` paths work on both systems.
const windowsPath = (file: string) => /^[A-Za-z]:|\\/.test(file);

const closeOnEscape = (close: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  close();
};

/** The delete-secret offer that Remove and Delete share. A shared secret always stays. */
function SecretOffer({
  others,
  credential,
  checked,
  onChange,
}: {
  others: string[];
  credential: CredentialReference;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  if (others.length)
    return (
      <p className="note">
        {others.join(', ')} {others.length === 1 ? 'uses' : 'use'} the same
        secret, so it stays.
      </p>
    );
  if (!deletable(credential))
    return <p className="note">The TPM entry stays in TPM.</p>;
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Also delete the saved secret from {providerName(credential.provider)}
    </label>
  );
}

function SetSecret({
  backend,
  folder,
  kind: initialKind,
  onSet,
  onCancel,
}: {
  backend: BackendClient;
  folder: string;
  kind: CredentialReference['kind'];
  onSet(set: NonNullable<SecretChange['set']>): void;
  onCancel(): void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [secret, setSecret] = useState('');
  const [to, setTo] = useState<SaveChoice>();
  return (
    <form
      className="popover"
      aria-label="Set secret"
      onKeyDown={closeOnEscape(onCancel)}
      onSubmit={(e) => {
        e.preventDefault();
        if (to === undefined) return;
        onSet({ kind, secret, ...(typeof to === 'object' && { keepass: to }) });
      }}
    >
      <div role="radiogroup" aria-label="Kind" className="switch">
        {(['password', 'passphrase'] as const).map((k) => (
          <label key={k}>
            <input
              type="radio"
              name="kind"
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            {kindLabel(k)}
          </label>
        ))}
      </div>
      <input
        type="password"
        aria-label="Secret"
        autoFocus
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <SaveTo
        backend={backend}
        folder={folder}
        allowNone={false}
        onChange={setTo}
      />
      <div className="actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary"
          disabled={!secret || to === undefined}
        >
          Set
        </button>
      </div>
    </form>
  );
}

/** Finds a TPM entry by pasted URL, id or search, and asks for the API keys when TPM needs them. */
function TpmFinder({
  backend,
  onAttach,
}: {
  backend: BackendClient;
  onAttach(entry: TpmEntry): void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<TpmFind>();
  const [error, setError] = useState<string>();
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const find = () => {
    setError(undefined);
    backend.findTpm(query).then(setFound, (e: Error) => {
      setFound(undefined);
      setError(e.message);
    });
  };
  return (
    <div role="tabpanel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <input
          aria-label="TPM URL, id or search"
          autoFocus
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />{' '}
        <button type="submit" disabled={!query.trim()}>
          Find
        </button>
      </form>
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
      {found && 'keys' in found && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            backend
              .setTpmKeys(publicKey, privateKey)
              .then(find, (e: Error) => setError(e.message));
          }}
        >
          <p className="note">{found.keys}</p>
          <label className="field">
            <span>Public key</span>
            <input
              spellCheck={false}
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Private key</span>
            <input
              type="password"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={!publicKey.trim() || !privateKey.trim()}
          >
            Save keys
          </button>
        </form>
      )}
      {found &&
        'entries' in found &&
        (found.entries.length ? (
          <ul className="choices">
            {found.entries.map((entry) => (
              <li key={entry.id}>
                <button onClick={() => onAttach(entry)}>
                  {entry.name} <span className="detail">{entry.username}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No TPM entry matches.</p>
        ))}
    </div>
  );
}

function AttachSecret({
  backend,
  sessions,
  onAttach,
  onCancel,
}: {
  backend: BackendClient;
  sessions: { alias: string; credential: CredentialReference }[];
  /** `entry` is the TPM or KeePass entry attached, which names its username. */
  onAttach(credential: CredentialReference, entry?: TpmEntry): void;
  onCancel(): void;
}) {
  const [tab, setTab] = useState<'keepass' | 'tpm' | 'same'>('same');
  const [query, setQuery] = useState('');
  const shown = sessions.filter((s) => s.alias.includes(query.toLowerCase()));
  return (
    <div
      className="popover"
      role="dialog"
      aria-label="Attach existing secret"
      onKeyDown={closeOnEscape(onCancel)}
    >
      <div role="tablist" className="tabs">
        <button
          role="tab"
          aria-selected={tab === 'keepass'}
          onClick={() => setTab('keepass')}
        >
          KeePass
        </button>
        <button
          role="tab"
          aria-selected={tab === 'tpm'}
          onClick={() => setTab('tpm')}
        >
          TPM
        </button>
        <button
          role="tab"
          aria-selected={tab === 'same'}
          onClick={() => setTab('same')}
        >
          Same secret as…
        </button>
      </div>
      {tab === 'keepass' ? (
        <KeepassFinder
          backend={backend}
          onAttach={(entry) =>
            onAttach(
              { provider: 'keepass', entry: entry.id, kind: 'password' },
              entry,
            )
          }
        />
      ) : tab === 'tpm' ? (
        <TpmFinder
          backend={backend}
          onAttach={(entry) =>
            onAttach(
              { provider: 'tpm', entry: entry.id, kind: 'password' },
              entry,
            )
          }
        />
      ) : (
        <div role="tabpanel">
          <input
            type="search"
            aria-label="Search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {shown.length ? (
            <ul className="choices">
              {shown.map((s) => (
                <li key={s.alias}>
                  <button onClick={() => onAttach(s.credential)}>
                    {s.alias}{' '}
                    <span className="detail">
                      {kindLabel(s.credential.kind)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No other Saved session has a secret.</p>
          )}
        </div>
      )}
      <div className="actions">
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export const openTabsNote = (count: number) =>
  count > 0 && (
    <p>
      {count === 1
        ? '1 Tab is open. It stays open.'
        : `${count} Tabs are open. They stay open.`}
    </p>
  );

export function Modal({
  label,
  role = 'dialog',
  className,
  onCancel,
  children,
}: {
  label: string;
  role?: 'dialog' | 'alertdialog';
  className: string;
  onCancel(): void;
  children: ReactNode;
}) {
  // Focus goes back to the row that opened the dialog. Render runs before autoFocus moves it inside.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => opener?.focus(), [opener]);
  return (
    <div className="backdrop">
      <section
        role={role}
        aria-modal="true"
        aria-label={label}
        className={`dialog ${className}`}
        onKeyDown={closeOnEscape(onCancel)}
      >
        {children}
      </section>
    </div>
  );
}

export function SessionDialog({
  backend,
  tree,
  start,
  onCancel,
  onSaved,
}: {
  backend: BackendClient;
  tree: SessionTree;
  start: DialogStart;
  onCancel(): void;
  onSaved(tree: SessionTree, alias: string): void;
}) {
  const own = start.edit?.alias;
  const [form, setForm] = useState(start.form);
  const [defaults, setDefaults] = useState<SessionDefaults>();
  const [set, setSet] = useState<SecretChange['set']>();
  const [removed, setRemoved] = useState<CredentialReference>();
  const [dropRemoved, setDropRemoved] = useState(false);
  const [popover, setPopover] = useState<'set' | 'attach'>();
  // The TPM or KeePass entry the secret points at, which names its username.
  const [entry, setEntry] = useState<TpmEntry | KeepassEntry>();
  const [added, setAdded] = useState<number>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{
    steps?: TestStep[];
    hostKey?: HostKeyQuestion;
    secret?: SecretQuestion;
  }>();
  // Set as the id arrives, before React renders: the first checklist event can follow at once.
  const testId = useRef<TabId>(undefined);
  const closed = useRef(false);
  const update = (patch: Partial<SessionForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  const taken = takenNames(tree).filter((alias) => alias !== own);
  const aliasError = aliasProblem(form.alias, taken);
  const problems = form.options.map(optionProblem);
  // A string, so the effect below reruns only when the lines change, not on every render's new array.
  const options = JSON.stringify(
    form.options.filter((line, i) => line.trim() && !problems[i]),
  );

  // The latest answer wins: an older `ssh -G` that finishes late is ignored.
  useEffect(() => {
    if (!form.alias) return setDefaults(undefined);
    let live = true;
    backend.sessionDefaults(form.alias, JSON.parse(options)).then(
      (d) => live && setDefaults(d),
      () => live && setDefaults(undefined),
    );
    return () => {
      live = false;
    };
  }, [backend, form.alias, options]);

  // The entry's username can change in TPM or KeePass after the attach. A failed read shows nothing: a connect shows the reason.
  const openedWith = start.form.credential;
  useEffect(() => {
    if (openedWith?.provider !== 'tpm' && openedWith?.provider !== 'keepass')
      return;
    let live = true;
    const read: Promise<TpmFind | KeepassFind> =
      openedWith.provider === 'tpm'
        ? backend.findTpm(openedWith.entry)
        : backend.findKeepass(openedWith.entry);
    read.then(
      (found) => live && 'entries' in found && setEntry(found.entries[0]),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [backend, openedWith]);

  // Closing the dialog stops a running Test.
  useEffect(() => {
    const off = backend.onEvent((e) => {
      if (!('tab' in e) || e.tab !== testId.current) return;
      if (e.type === 'test') setTest((t) => ({ ...t, steps: e.steps }));
      if (e.type === 'hostKey') setTest((t) => ({ ...t, hostKey: e.question }));
      if (e.type === 'secret') setTest((t) => ({ ...t, secret: e.question }));
    });
    return () => {
      off();
      closed.current = true;
      if (testId.current) void backend.close(testId.current);
    };
  }, [backend]);

  const steps = test?.steps;
  const testing =
    !!test &&
    !steps?.some((s) => s.state === 'failed') &&
    !steps?.every((s) => s.state === 'passed');
  // The step a question belongs to: the first one that hasn't passed.
  const current = steps?.findIndex((s) => s.state !== 'passed');

  const runTest = () => {
    setTest({});
    setError(undefined);
    backend.testSession(form, set).then(
      (id) => {
        testId.current = id;
        // The dialog closed before the id arrived.
        if (closed.current) void backend.close(id);
      },
      (e: Error) => {
        setTest(undefined);
        setError(e.message);
      },
    );
  };

  const folders = [
    ...new Set([
      ...tree.folders,
      ...tree.sessions.flatMap((s) => s.folder ?? []),
      ...(form.folder ? [form.folder] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const attachable = tree.sessions.flatMap((s) =>
    s.credential && s.alias !== own
      ? [{ alias: s.alias, credential: s.credential }]
      : [],
  );

  const remove = () => {
    if (set) return setSet(undefined);
    // Only the secret the session had when it opened can be deleted with it.
    if (sameEntry(form.credential, start.form.credential))
      setRemoved(form.credential);
    update({ credential: undefined });
  };

  // The entry read for an earlier credential no longer applies after a Remove or another attach.
  const attached =
    (form.credential?.provider === 'tpm' ||
      form.credential?.provider === 'keepass') &&
    entry?.id === form.credential.entry
      ? entry
      : undefined;
  const user = form.user || defaults?.user;
  const mismatch =
    attached?.username && user && attached.username !== user
      ? attached.username
      : undefined;

  // A new or attached secret takes the removed one's place, and its delete offer goes with it.
  const offered = removed && !form.credential && !set ? removed : undefined;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    const secret: SecretChange = {
      ...(set && { set }),
      ...(offered && dropRemoved && { drop: offered }),
    };
    try {
      onSaved(await backend.saveSession(form, start.edit, secret), form.alias);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const commandInput = (
    field: 'port' | 'identityFile' | 'user' | 'hostname',
    label: string,
  ) => (
    <input
      aria-label={label}
      spellCheck={false}
      value={form[field]}
      placeholder={defaults?.[field] || label}
      onChange={(e) => update({ [field]: e.target.value })}
    />
  );

  return (
    <Modal
      label={own ? `Edit ${own}` : 'New SSH session'}
      className="session-dialog"
      onCancel={() => (popover ? setPopover(undefined) : onCancel())}
    >
      <h2>{own ? `Edit ${own}` : 'New SSH session'}</h2>
      <div className="fields">
        <label htmlFor="session-alias">Alias</label>
        <div>
          <input
            id="session-alias"
            autoFocus
            spellCheck={false}
            value={form.alias}
            aria-invalid={!!aliasError}
            aria-describedby="session-alias-status"
            onChange={(e) => update({ alias: e.target.value.toLowerCase() })}
          />{' '}
          <span
            id="session-alias-status"
            className={aliasError ? 'problem' : 'free'}
          >
            {aliasError ?? 'Free'}
          </span>
        </div>

        <label htmlFor="session-folder">Folder</label>
        <select
          id="session-folder"
          value={form.folder}
          onChange={(e) => update({ folder: e.target.value })}
        >
          <option value="">(top level)</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f.split('/').join(' / ')}
            </option>
          ))}
        </select>

        <ColourRow
          id="session-colour"
          value={form.colour}
          onChange={(colour) => update({ colour })}
        />

        <span className="label">Connect</span>
        <div>
          <div className="command">
            <code>ssh -p</code>
            {commandInput('port', 'Port')}
            <code>-i</code>
            {commandInput('identityFile', 'IdentityFile')}
            <button
              aria-label="Pick a key file"
              title="Pick a key file"
              onClick={async () => {
                const file = await backend.pickKeyFile();
                if (file) update({ identityFile: file });
              }}
            >
              …
            </button>
            {commandInput('user', 'User')}
            <code>@</code>
            {commandInput('hostname', 'HostName')}
          </div>
          {mismatch && (
            <p className="warn">
              <span>
                {usernameMismatch(form.credential!.provider, mismatch, user!)}
              </span>{' '}
              <button onClick={() => update({ user: mismatch })}>
                Use {mismatch}
              </button>
            </p>
          )}
          {windowsPath(form.identityFile) && (
            <p className="warn">
              This key path won't work on macOS. A key in your home folder syncs
              as ~/….
            </p>
          )}
          <p className="note">
            Typing <code>ssh {form.alias || '<alias>'}</code> in a shell runs
            this command.
          </p>
        </div>

        <span className="label">Options</span>
        <div>
          {form.options.map((line, i) => {
            const key = optionKey(line) ?? '';
            const warning = !problems[i] && jumpWarning(line);
            return (
              <div key={i} className="option">
                <code>-o</code>
                <input
                  aria-label={`Option ${i + 1}`}
                  spellCheck={false}
                  placeholder="Key value"
                  autoFocus={i === added}
                  value={line}
                  aria-invalid={!!problems[i]}
                  onChange={(e) =>
                    update({
                      options: form.options.map((o, j) =>
                        j === i ? e.target.value : o,
                      ),
                    })
                  }
                />
                <span className="description">
                  {Object.hasOwn(optionDescriptions, key)
                    ? optionDescriptions[key]
                    : ''}
                </span>
                <button
                  aria-label={`Remove option ${i + 1}`}
                  title="Remove"
                  onClick={() => {
                    setAdded(undefined);
                    update({ options: form.options.filter((_, j) => j !== i) });
                  }}
                >
                  ×
                </button>
                {problems[i] && <p className="problem">{problems[i]}</p>}
                {warning && <p className="warn">{warning}</p>}
              </div>
            );
          })}
          <button
            className="link"
            onClick={() => {
              setAdded(form.options.length);
              update({ options: [...form.options, ''] });
            }}
          >
            + option
          </button>
        </div>

        <span className="label">Secret</span>
        <div className="secret">
          <span>
            {set
              ? `New ${kindLabel(set.kind).toLowerCase()}, saved to ${savedTo(set.keepass)} on Save`
              : form.credential
                ? `${kindLabel(form.credential.kind)} in ${providerName(form.credential.provider)}: ${describe(form.credential, attached)}`
                : 'None. slop-term asks when it connects.'}
          </span>{' '}
          <button onClick={() => setPopover('set')}>Set secret…</button>{' '}
          <button onClick={() => setPopover('attach')}>Attach existing…</button>{' '}
          {(set || form.credential) && <button onClick={remove}>Remove</button>}
          {popover === 'set' && (
            <SetSecret
              backend={backend}
              folder={form.folder}
              kind={form.identityFile ? 'passphrase' : 'password'}
              onSet={(next) => {
                setSet(next);
                setPopover(undefined);
              }}
              onCancel={() => setPopover(undefined)}
            />
          )}
          {popover === 'attach' && (
            <AttachSecret
              backend={backend}
              sessions={attachable}
              onAttach={(credential, attachedEntry) => {
                setSet(undefined);
                update({
                  credential,
                  ...(attachedEntry?.username && {
                    user: attachedEntry.username,
                  }),
                });
                setEntry(attachedEntry);
                setPopover(undefined);
              }}
              onCancel={() => setPopover(undefined)}
            />
          )}
          {offered && (
            <SecretOffer
              others={sharing(tree, offered, own)}
              credential={offered}
              checked={dropRemoved}
              onChange={setDropRemoved}
            />
          )}
        </div>
      </div>
      {steps && (
        <ol className="checklist" aria-label="Test">
          {steps.map((s, i) => (
            <li key={i} className={s.state}>
              {s.label}
              {s.reason && (
                <p role="alert" className="problem">
                  {s.reason}
                </p>
              )}
              {i === current && test?.hostKey && (
                <HostKeyPrompt
                  question={test.hostKey}
                  onAnswer={(trust) => {
                    setTest((t) => ({ ...t, hostKey: undefined }));
                    void backend.answerHostKey(testId.current!, trust);
                  }}
                />
              )}
              {i === current && test?.secret && (
                <SecretPrompt
                  question={test.secret}
                  backend={backend}
                  onAnswer={(answers, save) => {
                    setTest((t) => ({ ...t, secret: undefined }));
                    void backend.answerSecret(testId.current!, answers, save);
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="problem">
          {error}
        </p>
      )}
      <footer>
        <button
          className="test"
          disabled={testing || !!aliasError || problems.some(Boolean)}
          onClick={runTest}
        >
          Test
        </button>
        <button onClick={onCancel}>Cancel</button>
        <button
          className="primary"
          disabled={saving || !!aliasError || problems.some(Boolean)}
          onClick={save}
        >
          Save
        </button>
      </footer>
    </Modal>
  );
}

export function DeleteSession({
  backend,
  alias,
  credential,
  tree,
  openTabs,
  onCancel,
  onDelete,
}: {
  backend: BackendClient;
  alias: string;
  credential?: CredentialReference;
  tree: SessionTree;
  openTabs: number;
  onCancel(): void;
  onDelete(deleteSecret: boolean): Promise<void>;
}) {
  const [drop, setDrop] = useState(false);
  const [error, setError] = useState<string>();
  // A KeePass entry can go only from an unlocked database: Delete asks for the master password first.
  const [unlocking, setUnlocking] = useState(false);
  const [stays, setStays] = useState(false);
  const go = (deleteSecret: boolean) =>
    onDelete(deleteSecret).catch((e: Error) => setError(e.message));
  return (
    <Modal
      label={`Delete ${alias}`}
      role="alertdialog"
      className="confirm"
      onCancel={onCancel}
    >
      <h2>
        Delete Saved session <code>{alias}</code>?
      </h2>
      {openTabsNote(openTabs)}
      {credential && (
        <SecretOffer
          others={sharing(tree, credential, alias)}
          credential={credential}
          checked={drop}
          onChange={setDrop}
        />
      )}
      {stays && <p className="note">The KeePass entry stays.</p>}
      {unlocking && credential && (
        <UnlockBeforeDelete
          backend={backend}
          names={[keepassDatabaseOf(credential)]}
          onUnlocked={() => {
            setUnlocking(false);
            void go(true);
          }}
          onCancel={() => {
            setUnlocking(false);
            setDrop(false);
            setStays(true);
          }}
        />
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
          disabled={unlocking}
          onClick={() => {
            setStays(false);
            if (drop && credential?.provider === 'keepass') setUnlocking(true);
            else void go(drop);
          }}
        >
          Delete
        </button>
      </footer>
    </Modal>
  );
}
