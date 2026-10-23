import { useEffect, useState } from 'react';
import type { ProcessMetrics, Profiler } from '../shared/ipc.ts';

// Closing hides the panel instead of unmounting it, so a running trace can still be stopped after reopening.
export function ProfilingPanel({
  profiler,
  open,
}: {
  profiler: Profiler;
  open: boolean;
}) {
  const [processes, setProcesses] = useState<ProcessMetrics[]>([]);
  const [tracing, setTracing] = useState(false);
  const [savedPath, setSavedPath] = useState<string>();

  useEffect(() => {
    if (!open) return;
    const refresh = () => profiler.metrics().then(setProcesses);
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [profiler, open]);

  async function toggleTrace() {
    if (tracing) {
      setSavedPath(await profiler.stopTrace());
      setTracing(false);
    } else {
      await profiler.startTrace();
      setSavedPath(undefined);
      setTracing(true);
    }
  }

  return (
    <section className="profiling" aria-label="Profiling" hidden={!open}>
      <div className="profiling-actions">
        <button onClick={toggleTrace}>
          {tracing ? 'Stop and save trace' : 'Record trace'}
        </button>
        {savedPath && <span>Saved to {savedPath}</span>}
      </div>
      <table>
        <thead>
          <tr>
            <th>Process</th>
            <th>PID</th>
            <th>CPU</th>
            <th>Memory</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((p) => (
            <tr key={p.pid}>
              <td>{p.name}</td>
              <td>{p.pid}</td>
              <td>{p.cpuPercent.toFixed(1)} %</td>
              <td>{(p.memoryKB / 1024).toFixed(1)} MB</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
