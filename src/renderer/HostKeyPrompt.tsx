import { useState } from 'react';
import type { HostKeyQuestion } from '../shared/ipc.ts';

/** Shows over the Tab's terminal. Cancel is the default button on every step. */
export function HostKeyPrompt({
  question: q,
  onAnswer,
}: {
  question: HostKeyQuestion;
  onAnswer(trust: boolean): void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (q.kind === 'unknown')
    return (
      <section className="host-key" aria-label="Host key">
        <h2>Unknown host {q.alias}</h2>
        <p>
          The authenticity of <code>{q.host}</code> can't be established.
        </p>
        <p>
          {q.type} key fingerprint is <code>{q.fingerprint}</code>.
        </p>
        {q.savedType && (
          <p>A {q.savedType} key for this host is already saved.</p>
        )}
        <div className="actions">
          <button onClick={() => onAnswer(true)}>Trust and connect</button>
          <button autoFocus onClick={() => onAnswer(false)}>
            Cancel
          </button>
        </div>
      </section>
    );

  return (
    <section className="host-key changed" aria-label="Host key">
      <div role="alert">
        <h2>The host key for {q.alias} has changed</h2>
        <p>
          <code>{q.host}</code> sent a different key than the one saved. Someone
          could be intercepting the connection.
        </p>
        <p>
          Saved {q.type} key: <code>{q.old.fingerprint}</code>
          <br />
          Key sent now: <code>{q.fingerprint}</code>
        </p>
        <p>
          Saved in{' '}
          <code>
            {q.old.file}, line {q.old.line}
          </code>
        </p>
      </div>
      {/* Keys remount each step, so autoFocus moves to its Cancel. */}
      {confirming ? (
        <div className="actions" key="confirm">
          <p>Replace the saved key and connect?</p>
          <button onClick={() => onAnswer(true)}>Replace</button>
          <button autoFocus onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="actions" key="warning">
          <button onClick={() => setConfirming(true)}>Replace saved key</button>
          <button autoFocus onClick={() => onAnswer(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
