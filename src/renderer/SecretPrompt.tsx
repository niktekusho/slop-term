import { useState } from 'react';
import type {
  BackendClient,
  KeepassTarget,
  SecretQuestion,
} from '../shared/ipc.ts';
import { SaveTo, type SaveChoice } from './Keepass.tsx';

const saveLabels = { same: 'Save it', update: 'Update saved secret' };

/** Shows over the Tab's terminal. Enter connects; saving is ticked by default. */
export function SecretPrompt({
  backend,
  question: q,
  onAnswer,
}: {
  backend: BackendClient;
  question: SecretQuestion;
  onAnswer(answers: string[] | null, save: boolean | KeepassTarget): void;
}) {
  const [answers, setAnswers] = useState(() => q.prompts.map(() => ''));
  // Undefined while KeePass is picked but its database is locked.
  const [save, setSave] = useState<SaveChoice | undefined>(true);
  const choice = q.save ? save : false;

  return (
    <form
      className="tab-prompt"
      aria-label="Login"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice !== undefined) onAnswer(answers, choice);
      }}
    >
      <h2>{q.title}</h2>
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
      {q.save === 'new' && (
        <SaveTo
          backend={backend}
          folder={q.folder ?? ''}
          allowNone
          onChange={setSave}
        />
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
        <button type="submit" disabled={choice === undefined}>
          Connect
        </button>
        <button type="button" onClick={() => onAnswer(null, false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
