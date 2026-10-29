import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  BackendClient,
  CredentialReference,
  HostKeyQuestion,
  SecretChange,
  SecretQuestion,
  SessionDefaults,
  SessionForm,
  SessionTree,
  TabId,
  TestStep,
} from '../shared/ipc.ts';
import { HostKeyPrompt } from './HostKeyPrompt.tsx';
import { SecretPrompt } from './SecretPrompt.tsx';
import {
  aliasProblem,
  jumpWarning,
  optionKey,
  optionProblem,
  sameEntry,
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
  if (credential.provider !== 'keychain') return null;
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Also delete the saved secret from keychain
    </label>
  );
}

function SetSecret({
  kind: initialKind,
  onSet,
  onCancel,
}: {
  kind: CredentialReference['kind'];
  onSet(set: NonNullable<SecretChange['set']>): void;
  onCancel(): void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [secret, setSecret] = useState('');
  return (
    <form
      className="popover"
      aria-label="Set secret"
      onKeyDown={closeOnEscape(onCancel)}
      onSubmit={(e) => {
        e.preventDefault();
        onSet({ kind, secret });
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
      <label className="inline">
        Save to
        <select>
          <option>keychain</option>
        </select>
      </label>
      <div className="actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!secret}>
          Set
        </button>
      </div>
    </form>
  );
}

function AttachSecret({
  sessions,
  onAttach,
  onCancel,
}: {
  sessions: { alias: string; credential: CredentialReference }[];
  onAttach(credential: CredentialReference): void;
  onCancel(): void;
}) {
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
        <button role="tab" aria-selected="true">
          Same secret as…
        </button>
      </div>
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
                  <span className="detail">{kindLabel(s.credential.kind)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No other Saved session has a secret.</p>
        )}
      </div>
      <div className="actions">
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Modal({
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

  const taken = [
    ...tree.sessions.map((s) => s.alias),
    ...tree.handWritten,
  ].filter((alias) => alias !== own);
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
              ? `New ${kindLabel(set.kind).toLowerCase()}, saved to keychain on Save`
              : form.credential
                ? `${kindLabel(form.credential.kind)} in ${form.credential.provider}: ${form.credential.entry}`
                : 'None. slop-term asks when it connects.'}
          </span>{' '}
          <button onClick={() => setPopover('set')}>Set secret…</button>{' '}
          <button onClick={() => setPopover('attach')}>Attach existing…</button>{' '}
          {(set || form.credential) && <button onClick={remove}>Remove</button>}
          {popover === 'set' && (
            <SetSecret
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
              sessions={attachable}
              onAttach={(credential) => {
                setSet(undefined);
                update({ credential });
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
  alias,
  credential,
  tree,
  openTabs,
  onCancel,
  onDelete,
}: {
  alias: string;
  credential?: CredentialReference;
  tree: SessionTree;
  openTabs: number;
  onCancel(): void;
  onDelete(deleteSecret: boolean): Promise<void>;
}) {
  const [drop, setDrop] = useState(false);
  const [error, setError] = useState<string>();
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
      {openTabs > 0 && (
        <p>
          {openTabs === 1
            ? '1 Tab is open. It stays open.'
            : `${openTabs} Tabs are open. They stay open.`}
        </p>
      )}
      {credential && (
        <SecretOffer
          others={sharing(tree, credential, alias)}
          credential={credential}
          checked={drop}
          onChange={setDrop}
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
          onClick={() =>
            onDelete(drop).catch((e: Error) => setError(e.message))
          }
        >
          Delete
        </button>
      </footer>
    </Modal>
  );
}
