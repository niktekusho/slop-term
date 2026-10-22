import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackend } from './harness.ts';

let harness: Awaited<ReturnType<typeof startBackend>>;
beforeEach(async () => {
  harness = await startBackend();
});
afterEach(() => harness.stop());

const eventually = (assertion: () => void) =>
  vi.waitFor(assertion, { timeout: 10_000 });

async function openFirstShell() {
  const [shell] = await harness.backend.listShells();
  return harness.backend.openLocalShell(shell);
}

describe('local shells', () => {
  it('lists the shells this machine has', async () => {
    const shells = await harness.backend.listShells();
    if (process.platform === 'win32') {
      const kinds = shells.map((s) => s.kind);
      expect(kinds).toContain('cmd');
      expect(
        kinds.filter((k) => k === 'pwsh' || k === 'powershell'),
      ).toHaveLength(1);
      expect(
        shells.filter(
          (s) => s.kind === 'wsl' && s.distro.startsWith('docker-desktop'),
        ),
      ).toEqual([]);
    } else {
      expect(shells).toEqual([{ kind: 'zsh' }, { kind: 'bash' }]);
    }
  });

  it('opens the first shell and reads its output', async () => {
    const tab = await openFirstShell();
    await harness.backend.write(tab, 'echo slop""-42\r');
    await eventually(() => expect(harness.output(tab)).toContain('slop-42'));
  });

  it('starts the shell in the home folder', async () => {
    const tab = await openFirstShell();
    await harness.backend.write(tab, 'pwd\r');
    await eventually(() => expect(harness.output(tab)).toContain(harness.home));
  });

  it('reports the exit code when the shell exits', async () => {
    const tab = await openFirstShell();
    await harness.backend.write(tab, 'exit 3\r');
    await eventually(() =>
      expect(harness.events).toContainEqual({ type: 'exit', tab, code: 3 }),
    );
  });
});
