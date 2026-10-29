# Retro: ticket 11, Test button

Session of 2026-10-29. These are improvements to the environment that would make future sessions faster or safer. They are ordered by severity. None are applied yet. Four findings repeat earlier retros, and none of the fixes from retros 08, 09 or 10 has landed: there is still no repo `CLAUDE.md`, no `.claude/settings.json`, no git hook and no CI.

## 1. Still no guardrail (fourth time: 08 #2, 09 #5, 10 #5)

Lint, typecheck and tests ran only because the agent ran them by hand. `oxfmt --check` failed on three files after the first full pass, and a second `oxfmt --write` was needed after the review fixes. A session that skips the manual run commits unformatted or untyped code, and nothing stops it.

Fix: unchanged. Add a pre-commit hook running `pnpm lint && pnpm typecheck`, and a CI job that also runs `pnpm test`. This is the cheapest finding on the list, and every retro so far has raised it.

## 2. A race had no test because `FakeBackend` answers at once

The Spec reviewer found the worst bug of the session. If the dialog closed before `testSession` resolved, the Test was never closed, and it could wait forever on a host key question. The fix is three lines in `SessionDialog.tsx`, but no UI test covers it. `FakeBackend` resolves every call in the same tick, so a test can't put a user action between the request and its answer.

The same gap applies to any UI code that awaits a back-end call and then acts on the result: `saveSession`, `getSession` and the coming SFTP calls.

Fix: give `FakeBackend` a way to hold a method's answer until the test releases it. For example, `const release = backend.hold('testSession')` makes the next call wait until `release()`. Then the race test is short: click Test, click Cancel, release, and expect `close`. Write that test when the helper lands.

## 3. A test helper copies the production logic

Two helpers build the checklist with the same "first N passed, next failed, rest waiting" rule as `report` in `ssh.ts`. They are `failedAt` in `ssh-tab.test.ts` and `steps` in `SessionDialog.test.tsx`. The Standards reviewer pointed out that `failedAt` checks the code against a copy of itself, which the `tdd` skill calls a tautological test. The session fixed the other smells and left this one.

The risk is real but small: a bug in the shared rule, such as marking the wrong step failed, would appear in both copies and pass.

Fix: no new rule is needed, since the `tdd` skill already names the anti-pattern. Write the checklist as literal arrays in at least one back-end failure test, as the success test already does. In review, treat "tautological test" as a finding to fix, not a note.

## 4. Shell edits in `src/` (fourth time: 08 #6, 09 #3, 10 #4)

The first `src/` edit of the session was a Python heredoc that rewrote `src/shared/ipc.ts` with four string replacements. It worked, but a replacement that missed its target would have failed silently, and a later step would have broken instead. After that edit the agent switched to Edit, and the mutation check also used Edit.

Fix: unchanged. Add the `PreToolUse` hook from 09 #3. It sends Bash commands that write under `src/` to Edit or Write.

## 5. The tracker pointer and the test-first clause (repeat of 10 #2 and #3)

This time the user passed the ticket path, so finding the ticket cost nothing. The spec still needed a `find`, and the agent read `CODING_STANDARDS.md` and the ticket 10 retro to learn the conventions. Retro 10 #3 asked for "write the first failing test before the first `src/` edit", and this session followed it: the first test went red with `testSession is not a function` before any `src/` change. That clause would make the behaviour reliable, and today nothing in the repo states it.

Fix: write the repo `CLAUDE.md` from 10 #2 and #3. Five lines cover the ticket folder, the spec, the retros, the fixed test seams and the test-first rule.

## 6. The coverage rule still says "ticked" (repeat of 10 #1)

`CODING_STANDARDS.md` line 7 still reads "Every ticked acceptance item". The Standards reviewer checked coverage on every item only because its prompt told it to. The next session that writes a plainer prompt gets no coverage check.

Fix: unchanged. Apply the wording from 10 #1.

## 7. The review skill can't see uncommitted work

The `implement` skill runs `code-review` before the commit. `code-review` diffs `<fixed-point>...HEAD`, which is empty while the work is uncommitted. The agent noticed and gave both reviewers `git diff HEAD` instead. A less careful run would have reviewed an empty diff, or failed at the "diff is non-empty" check and stopped.

Fix: in this repo's flow, run `git diff HEAD` for an uncommitted review. That can be one line in the repo `CLAUDE.md` from finding 5, or a commit made before review that the review fixes then amend. The repo `CLAUDE.md` line is cheaper.

## 8. The pnpm shim (fifth time)

Every check ran as `npx -y pnpm@10.28.1 ...`, about 12 times. `pnpm` is still not on PATH, and corepack 0.34.0 is installed but not enabled.

Fix: unchanged. Run `corepack enable`.

## 9. Collection-time helpers in `ssh-tab.test.ts`

A `const trusting = form({...})` at `describe` level called `knownHosts()`, which reads `harness.home`. `harness` exists only after `start()`, so the whole file failed to collect and the run reported "0 test". That cost one turn. The fix was to build the form inside a function.

Fix: none needed. The error names the line, and the fix is obvious once seen. Revisit only if it happens again.

## Checked, no change needed

- The local-shell flake from 10 #6 did not repeat. `local-shell.test.ts` passed in both full runs of this session, 183 of 183 each time. If the next two runs also pass, close that finding.
- The two-axis review earned its cost again. The Spec reviewer found the orphaned-Test race, and both reviewers flagged that the change had altered the `ssh -G` error wording for ordinary Tabs. The Standards reviewer found the duplicated label list and the duplicated `checklist` lookup.
- One deliberate mutation check confirmed that the test-only password test goes red when the no-save guard breaks. One check was enough, because the other new back-end tests each have a step that only the new code can pass.
- Reusing `openSshTab` for the Test kept the change at about 80 lines in `ssh.ts`. The cost is around eight `if (test)` branches through one function. Split it if another kind of connection is added, such as the SFTP pane's own connection in ticket 17.
