import { useState } from 'react';
import type {
  BackendClient,
  KeepassTarget,
  NewTypedSession,
  SecretQuestion,
  SessionTree,
} from '../shared/ipc.ts';
import {
  aliasProblem,
  takenNames,
  typedAlias,
} from '../shared/session-rules.ts';
import { SaveTo, type SaveChoice } from './Keepass.tsx';
import { folderPaths } from './SessionTree.tsx';

const saveLabels = { same: 'Save it', update: 'Update saved secret' };

/**
 * A local shell Tab's SFTP pane asks for itself: `host` is its typed `ssh`'s destination as typed, `user` the user it resolved.
 * `keychain` is the keychain's name on this OS, which "Save to" shows.
 */
export type PaneAsk = {
  tree: SessionTree;
  host: string;
  user: string;
  keychain: string;
};

/** Shows over the Tab's terminal, or in the pane with `pane`. Enter connects; saving is ticked by default. */
export function SecretPrompt({
  backend,
  question: q,
  pane,
  onAnswer,
}: {
  backend: BackendClient;
  question: SecretQuestion;
  pane?: PaneAsk;
  onAnswer(
    answers: string[] | null,
    save: boolean | KeepassTarget,
    create?: NewTypedSession,
  ): void;
}) {
  const [answers, setAnswers] = useState(() => q.prompts.map(() => ''));
  // Undefined while KeePass is picked but its database is locked.
  const [save, setSave] = useState<SaveChoice | undefined>(true);
  const choice = q.save ? save : false;
  const folders = pane ? folderPaths(pane.tree) : [];
  const [alias, setAlias] = useState(() =>
    pane ? typedAlias(pane.host, pane.user, takenNames(pane.tree)) : '',
  );
  const [folder, setFolder] = useState(() =>
    folders.includes(q.folder ?? '') ? q.folder! : '',
  );
  const creating = q.save === 'create' && choice !== false;
  const problem =
    creating && pane ? aliasProblem(alias, takenNames(pane.tree)) : undefined;

  return (
    <form
      className={pane ? 'tab-prompt pane-prompt' : 'tab-prompt'}
      aria-label="Login"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice === undefined || problem) return;
        onAnswer(answers, choice, creating ? { alias, folder } : undefined);
      }}
    >
      <h2>{q.title}</h2>
      {pane && (
        <p className="note">
          This logs in the SFTP pane only. The terminal&apos;s ssh asks on its
          own.
        </p>
      )}
      {q.reason && <p role="alert">{q.reason}</p>}
      {q.prompts.map((p, i) => (
        <label key={i} className="field">
          <span>{p.prompt}</span>
          <input
            type={p.echo ? 'text' : 'password'}
            autoFocus={i === 0}
            value={answers[i]}
            onChange={(e) =>
              setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))
            }
          />
        </label>
      ))}
      {q.moveIn && (
        <p className="note">
          Move {q.moveIn} into slop-term to save its password.
        </p>
      )}
      {(q.save === 'new' || q.save === 'create') && (
        <SaveTo
          backend={backend}
          folder={q.save === 'create' ? folder : (q.folder ?? '')}
          allowNone
          keychainName={pane?.keychain}
          onChange={setSave}
        />
      )}
      {creating && (
        <>
          <label className="field">
            <span>Alias</span>
            <input
              aria-label="Alias"
              spellCheck={false}
              value={alias}
              aria-invalid={!!problem}
              onChange={(e) => setAlias(e.target.value.toLowerCase())}
            />
          </label>
          {problem && <p className="problem">{problem}</p>}
          <label className="field">
            <span>Folder</span>
            <select
              aria-label="Folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value="">Top level</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f.split('/').join(' / ')}
                </option>
              ))}
            </select>
          </label>
          {!problem && (
            <p className="note">
              Creates SSH Saved session {alias} in {folder || 'Top level'}.
            </p>
          )}
        </>
      )}
      {(q.save === 'same' || q.save === 'update') && (
        <label className="check">
          <input
            type="checkbox"
            checked={save === true}
            onChange={(e) => setSave(e.target.checked)}
          />
          {saveLabels[q.save]}
        </label>
      )}
      <div className="actions">
        <button type="submit" disabled={choice === undefined || !!problem}>
          Connect
        </button>
        <button type="button" onClick={() => onAnswer(null, false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
