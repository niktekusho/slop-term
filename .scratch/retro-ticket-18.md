# Retro: ticket 18, SFTP transfers

Session of 2026-11-11. These are improvements to the environment that would make future sessions faster or safer. They are ordered by severity. Findings 1, 3 and 4 are applied; see "Applied" under each.

## 1. The full suite can't tell a real failure from load on this laptop

Two full runs took 351 s each, against the 72 to 79 s that retro 13 measured. They failed 6 and then 4 tests, all on fixed timeouts (5 s for UI, 15 to 20 s for the back end), in files the ticket didn't touch: folders, KeePass, `ssh-tab`, `App.test.tsx`, `SessionColours.test.tsx`. `App.test.tsx` "numbers Tabs 1 to 9…" failed alone once at 5.5 s and passed on the next try. The machine has 16 GB and swaps, and the global CLAUDE.md asks for one heavy process at a time. With `maxWorkers: 4`, each back-end worker starts Electron, and three Docker containers run at once.

One real failure was in the first run among the timeouts: the fake server's new SFTP broke "fails a Test at SFTP on a server without the SFTP subsystem". It looked like the others until each file ran alone.

Cost: two full runs, four reruns of single files, and a failed attempt to build a HEAD baseline (finding 2), about 25 minutes.

Fix, in order:
- While iterating, run the test files that depend on what changed: `pnpm vitest related --run <changed src files>`. It would have run `ssh-tab.test.ts` as soon as `ssh-server.ts` changed, and found the real failure in one targeted run. Add one line to the repo `CLAUDE.md`, beside the `pnpm lint` line: "Run `pnpm vitest related --run <files>` after editing a shared test helper (`harness.ts`, `ssh-server.ts`, `fake-backend.ts`)."
- For the one full run at the end, run `pnpm test --maxWorkers=2` on this laptop, and measure the time and red count over 3 runs against 4 workers. If 2 is green, add it as a `test:local` script.
- Diagnose the UI 5 s timeouts on their own. The Tab-heavy tests in `App.test.tsx` and `SessionColours.test.tsx` start 9 Tabs. Measure how long they take alone and in the full suite, then decide between a longer `testTimeout` for the UI project and a lighter setup.

Applied:
- The `CLAUDE.md` line names `pnpm vitest related --run <file>`. After the change to `ssh-server.ts` in finding 3, it ran the 5 dependent files (87 tests, green).
- Workers, measured as three full suites each, one at a time:

  | Workers | Time | Result |
  |---|---|---|
  | 2 | 234 s, 258 s, 292 s | 3 of 3 green |
  | 4 | 214 s, 201 s, 186 s | 2 of 3 green: run 1 failed one whole file, with 27 tests skipped |

  `pnpm test:local` runs `vitest run --maxWorkers=2`, and a `CLAUDE.md` line points to it. CI keeps `pnpm test`.
- UI timeouts: alone, "numbers Tabs 1 to 9…" took 3.6 s and the two "fills the header with each shade…" tests 2.7 s and 4.1 s, against the 5 s default. Each new Tab re-renders every Tab's terminal and SFTP pane. A lighter setup would mean faking xterm, so the three tests take `manyTabsTimeout` (15 s) from `test-utils.tsx`, which states the reason.

## 2. A HEAD baseline has no cheap path, and `git add -N` breaks `git stash`

To check whether a UI test was already failing on HEAD, the agent first copied `node_modules` into a new worktree. That ran past 400 s, was stopped, and left a folder that took three delete attempts to remove. Then `git stash push -- src/renderer` failed with "Entry 'src/backend/transfers.test.ts' not uptodate. Cannot merge", because the code review had run `git add -N .`. Nothing was stashed, so the test ran on the changed code and passed. That answer was right, but it came by accident.

Fix:
- `custom-code-review` step 1: undo its intent-to-add entries after the diff is captured, with `git reset -q -- <the paths it marked>`, so the working tree goes back to the state it found.
- Add to the repo `CLAUDE.md`: "Check whether a test fails on HEAD with `git stash push -u`, the run, and `git stash pop`. A worktree needs its own `pnpm install`."

## 3. Generated ssh2 keys fail to parse about 1 time in 150

The fake server failed with "Cannot parse privateKey: Malformed OpenSSH private key" in one run. A loop under Electron's Node found 13 of 2000 ed25519 keys from `utils.generateKeyPairSync` that `utils.parseKey` rejects. The session fixed it only for the fake server's host keys (`newHostKey` in `ssh-server.ts`). Four test sites still generate keys the old way, so each of those files fails at random about 1 run in 150: `sftp.test.ts:10`, `ssh-tab.test.ts:103`, `ssh-tab.test.ts:104` (with a passphrase) and `transfers.test.ts:14`.

Fix: export a `testKeyPair(options?)` from `harness.ts` that retries until `parseKey` accepts the key, and use it at all four sites. Then add `"no-restricted-properties"` (or the oxlint equivalent) for `utils.generateKeyPairSync` in test files, with the message "Use testKeyPair from harness.ts", so a new test can't bring the flake back.

Applied: `testKeyPair(type?, locked?)` lives in `ssh-server.ts`, not `harness.ts`, because the fake server's retry was already there. All four sites use it. `.oxlintrc.json` sets `no-restricted-properties` on `utils.generateKeyPairSync` for the whole repo, since nothing outside `ssh-server.ts` calls it. `ssh-server.ts` disables the rule for its one call. A temporary call in `sftp.test.ts` failed lint with the rule's message.

## 4. The `src/` shell-edit hook still blocks writes to `.scratch/`

`.claude/hooks/no-shell-src-edits.mjs` blocked one command that appended the Test coverage section to the ticket with `cat >> .scratch/… <<'EOF'` and then ran `sed -i` on the same ticket. The `script` pattern matches `sed -i`, and the appended text named `src/` files. Neither write touched `src/`. The agent redid it with Read and Write.

Fix: treat `sed -i` like a redirect, by its target. Block it only when a path argument after the expression is under `src/`:

```js
const sedInPlace = /sed\s+-i\S*\s+(?:'[^']*'|"[^"]*"|\S+)\s+["']?[^\s"']*src\//;
```

Keep the `(node|python3?) -` check together with any `src/` mention. Test both commands from this session: the blocked `.scratch/` one must pass, and `sed -i 's/a/b/' src/x.ts` must still block.

Applied with a split, not the regex above: the hook splits the command on `;`, `&`, `|` and newlines, and blocks a `sed -i` part whose last word is under `src/`. A quoted expression that names `src/` can't trip it. Six cases ran through the hook: the session's `.scratch/` command and a read-only `grep` pass. `sed -i` on `src/`, `sed -i -e` on `src/`, a redirect into `src/` and a `node -` script naming `src/` block. Testing it needs a script file, because a Bash command that holds the cases trips the hook itself.

## 5. The Spec reviewer missed half of the test file

The Spec sub-agent reported that "all of `src/backend/transfers.test.ts` runs against the in-process fake". The file has a second `describe` block with 5 Docker tests. The claim would have sent the implementer to move tests that were already there. The implementer checked it against the file and set it aside.

Fix: in `custom-code-review`, the Spec brief asks for each "missing" finding to name the search it ran (`grep -n "describe(" <file>` here). A claim that something is absent then carries its own evidence.

## 6. One-off probes can't import the source

A probe script in the scratchpad that imported `src/backend/ssh-server.ts` failed twice. Plain Node 22 couldn't resolve `ssh2` from outside the repo. Electron's Node 24 resolved it but rejects the named `Server` import from the CommonJS package, which Vitest's transform allows. The agent gave up and wrapped `sftp.end` without knowing whether the fake server answers a channel close. A plain-ssh2 probe with a default import worked later for the key-parse count.

Fix: a probe of source code runs as a throwaway test, for example `pnpm vitest run .scratch/probe.test.ts`. That needs `.scratch/**/*.test.ts` in the back-end project's `include`, or a separate `probe` project, so the transform and Electron's Node match what the tests use. Without that, add one line to `CLAUDE.md` saying probes import only packages, with default imports, under `ELECTRON_RUN_AS_NODE=1`.
