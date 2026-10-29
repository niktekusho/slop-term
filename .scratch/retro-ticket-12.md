# Retro: ticket 12, folders and Move into slop-term

Session of 2026-10-29. These are improvements to the environment that would make future sessions faster or safer. They are ordered by severity. Findings 2, 4 and 5 are applied: two rules in `CODING_STANDARDS.md` and one line in the repo `CLAUDE.md`. Findings 1 and 3 are not.

Most fixes from retros 08 to 11 have landed, and this session shows they work:

- The repo `CLAUDE.md` pointed straight at the ticket, the spec and the retros, so no tool calls went into finding them.
- The pre-commit hook ran lint and typecheck on the commit.
- CI runs lint, typecheck and tests.
- `pnpm` is on PATH, so no `npx pnpm@...` shim this time.
- The `src/` shell-edit hook blocked a heredoc append to `session-tree.test.ts`, and the edit went through Edit on the next turn.
- The `git diff HEAD` line made the review cover the uncommitted work without a detour.
- Every back-end test went red before its code existed, so no mutation checks were needed.

## 1. The local-shell flake is back, and CI now runs it

The first full run failed two tests in `src/backend/local-shell.test.ts`: "opens the first shell and reads its output" (11.8 s) and "starts the shell in the home folder" (5.5 s). The file passed 7 of 7 alone right after. This is the flake from retro 10 #6, which said to act if it repeats. It did not show in retro 11's two runs, so it is intermittent, not gone.

The cost is higher now. `.github/workflows/ci.yml` runs `pnpm test` on `windows-latest`, so this flake turns CI red at random, and a red CI that "always passes on rerun" teaches agents and the user to ignore it.

The cause is likely load. The backend project runs every harness file in parallel, and each file forks Electron as Node. Each ConPTY spawn competes with the Docker SSH tests and the other back ends, and the shell's first output misses the 10 s `eventually` window.

Fix: run the back-end project with fewer workers. For example, add `maxWorkers: 2` (or `fileParallelism: false` for that project alone) in `vitest.config.mts`, then time two full runs. If the suite gets too slow, raise the wait in `local-shell.test.ts` from 10 s to 20 s instead, since `testTimeout` is already 20 s.

## 2. Tests can't catch a confirm that recomputes what the user agreed to

The Spec reviewer found the worst bug of the session. The folder delete confirm rebuilt its list of sessions from the live tree on every render. A tree reload under the open dialog would have grown the delete, and the back end's conflict check could never fire from the real UI. The 31 tests passing at that point didn't catch it. Each one read the tree once, so none of them changed the tree under an open dialog.

Retro 11 #2 found the same class of bug, where a UI acted on state that changed under it. There it was an async race, and `FakeBackend.hold` fixed that. This time the trigger is a `tree` event while a modal is open. The fix (snapshot the values when the dialog opens) and its test (emit a tree event, then confirm) are both short once someone thinks of them.

Fix: add one judgement rule to `CODING_STANDARDS.md` under Tests, since no linter can see this:

> A dialog that asks the user to confirm a change sends the back end the values it showed, captured when it opened. Its test emits a `tree` event while the dialog is open.

The reviewer then checks every confirm in the diff against it.

## 3. `FakeBackend` grows by hand with every back-end method

The six new methods added about 80 lines to `src/renderer/fake-backend.ts`. They copy back-end logic (`relocate`, folder moves, delete filtering) in a second, simpler form. Two problems came from that:

- The Standards reviewer flagged the "keeps both on request" UI test as close to tautological. It checks the `alsoInConfig: 1` that the fake's `moveIn` hard-codes.
- The fake's folder logic used its own path splitting until the review moved the helpers into `session-rules.ts`.

This is cheap today, but every ticket adds methods: ticket 13 adds Local shell sessions, and 17 to 20 add SFTP. A fake that grows a second implementation can drift from the real one, and UI tests then pass against behaviour the back end doesn't have.

Fix: none yet. Keep fake methods to "record the request, return a tree the test sets" wherever a UI test only checks what renders. Let the fake compute a new tree only where the UI's next step depends on it. Revisit if a UI test passes against fake behaviour that the back end lacks.

## 4. The formatter rewrites files mid-session

`pnpm lint:fix` ran twice in the middle of the work. Each run reformatted files already in context, which led to seven "changed on disk" notices and extra Read calls before the next Edit of `App.tsx`, `SessionTree.tsx` and `config-store.ts`.

Fix: run `pnpm lint` (check only) during the work and `pnpm lint:fix` once, right before the commit. The pre-commit hook already catches a missed format. Applied as one line in the repo `CLAUDE.md`.

## 5. Ticket coverage lives only in the reviewer's report

`CODING_STANDARDS.md` asks that every acceptance item name its test. The Standards reviewer built that list in its report, but the ticket file didn't record it until the agent copied it in by hand, and ticket 11 has no such list. Without it, a later ticket that changes the same behaviour can't find the tests to update.

Fix: extend the rule in `CODING_STANDARDS.md`:

> Every acceptance item in the ticket names the test that covers it, or says why no test can, in a "Test coverage" section of the ticket file.

The reviewer then reports a missing section as a finding.

## Checked, no change needed

- The two-axis review earned its cost again. The Spec reviewer found the dead conflict check, the lost focus after an inline edit, a folder that disappeared with its last session, and the missing "secrets stay" note. The Standards reviewer found the duplicated path helpers, the unclear names and the coverage gap.
- Testing Library's `fireEvent.dragStart` and `drop` work in jsdom without a `DataTransfer` when the dragged item lives in a ref. No helper is needed.
- The 50 KB spec came back as a persisted file. `grep` on the folder and move terms found the relevant lines in one call. The spec is read rarely and grep handles it, so it needs no index.
