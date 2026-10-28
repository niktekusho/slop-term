import { useState } from 'react';
import type { SecretQuestion } from '../shared/ipc.ts';

const saveLabels = { same: 'Save it', update: 'Update saved secret' };

/** Shows over the Tab's terminal. Enter connects; saving is ticked by default. */
export function SecretPrompt({
  question: q,
  onAnswer,
}: {
  question: SecretQuestion;
  onAnswer(answers: string[] | null, save: boolean): void;
}) {
  const [answers, setAnswers] = useState(() => q.prompts.map(() => ''));
  const [save, setSave] = useState(true);

  return (
    <form
      className="tab-prompt"
      aria-label="Login"
      onSubmit={(e) => {
        e.preventDefault();
        onAnswer(answers, !!q.save && save);
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
        <label className="field">
          <span>Save to</span>
          <select
            value={save ? 'keychain' : "don't save"}
            onChange={(e) => setSave(e.target.value === 'keychain')}
          >
            <option>keychain</option>
            <option>don't save</option>
          </select>
        </label>
      )}
      {(q.save === 'same' || q.save === 'update') && (
        <label className="check">
          <input
            type="checkbox"
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
          />
          {saveLabels[q.save]}
        </label>
      )}
      <div className="actions">
        <button type="submit">Connect</button>
        <button type="button" onClick={() => onAnswer(null, false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
