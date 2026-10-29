# Retro: ticket 10, SSH Saved session dialog

Session of 2026-10-29. These are improvements to the environment that would make future sessions faster or safer. They are ordered by severity. None are applied yet. Four findings repeat earlier retros, and three of those have now come up in all three retros.

## 1. The test-coverage rule never fires, because nobody ticks the boxes

`CODING_STANDARDS.md` says "Every ticked acceptance item in a ticket names the test that covers it". Ticket 10 was closed with every box still unticked, so the Standards reviewer reported "no ticked items yet" and checked nothing. The Spec reviewer found the coverage gaps only because its prompt asked for them directly. Its findings were "Edits don't touch live connections" and "Save writes each file once" with no test, and a rename onto an orphaned alias with no test.

Fix: tie the rule to the checklist, not to the tick marks:

> Every acceptance item in the ticket names the test that covers it, or says why no test can. A ticket's "Back-end tests" and "UI tests" lines are the minimum, not the whole list.

Then the reviewer checks coverage on every review, whether or not anyone ticked the boxes.

## 2. The tracker pointer is still missing (third time: 08 #1, 09 #2)

The SessionStart hook said `current: slop-term-llm` and "no ticket files". Ticket 10 lives in `.scratch/slop-term-v1-build/issues/`, which the hook doesn't know about. The agent found it by reading `.trail/` and the git log of ticket 09, which cost three tool calls before any work began.

Fix: the one-line repo `CLAUDE.md` pointer from 09 #2. Writing it now also gives the status-line permission a permanent home, so it no longer depends on a memory:

> Tickets: `.scratch/slop-term-v1-build/issues/NN-*.md`. Set `**Status:** done` by hand when a ticket ships. Spec: `.scratch/slop-term-v1/spec.md`. Design decisions: `.scratch/slop-term-v1/issues/`. Retros: `.scratch/retro-ticket-NN.md`.

## 3. Implementation went in before its tests

The agent wrote the whole back end, then loaded the `tdd` skill, then wrote 17 back-end tests that all passed on their first run. A test that never went red proves little, so the agent had to break the code on purpose twice, once for comment-keeping and once for rename-reconnect, to show the tests could fail. The `tdd` skill also tells the agent to confirm seams with the user before writing a test, but the spec's Testing Decisions already fix both seams, so that step is friction in this repo.

Fix: in the repo `CLAUDE.md` pointer from finding 2, add one clause:

> Test seams are fixed in the spec's Testing Decisions: write the first failing test before the first `src/` edit.

## 4. Shell edits in `src/` (repeat of 08 #6 and 09 #3)

This session used Bash to change `src/` four times:

- A `cat >> App.test.tsx <<'EOF'` heredoc of about 200 lines failed to parse, so that turn was wasted. The tests then went into a new file through the Write tool.
- The CSS was appended with a heredoc, and the colour tokens were added with `sed -i`.
- The two mutation checks used `sed -i` to break code and restore it.

None of them broke code this time, but the parse failure cost a full turn. The `PreToolUse` hook from 09 #3 would have sent all four to Edit or Write.

Fix: add the hook as 09 #3 describes. The mutation check needs a sanctioned path too. Point the hook's message at the Edit tool for a temporary edit followed by its reverse.

## 5. Still no guardrail (repeat of 08 #2 and 09 #5)

Lint, typecheck and tests ran only because the agent ran them by hand. `oxfmt --write` reformatted seven files at the end, and oxlint found an unused parameter after the first full run.

Fix: unchanged. Add a pre-commit hook running `pnpm lint && pnpm typecheck`, and a CI job that also runs `pnpm test`.

## 6. A local shell test timed out under the full suite

`local-shell.test.ts > opens the first shell and reads its output` failed at 14.5 s in the second full run and passed alone, 7 of 7. This change doesn't touch local shells. The full suite runs the Docker OpenSSH tests, several back ends and ConPTY at once, so the shell's first output was probably just slow.

Fix: look for this failure in the next two full runs. If it repeats, give that test a wait of its own or run the back-end project with fewer workers (`poolOptions` in `vitest.config.mts`). A suite with a known flake teaches agents to dismiss failures.

## 7. `ssh -G` in tests reads the real account's `~/.ssh`

The harness sets HOME to a temp folder, and the resolver passes `-F` for that folder's config. But the config's `Include ~/.ssh/slop-term.conf` expands `~` from the account, not from HOME. So in a test, `sessionDefaults` and the save-time `ssh -G` check also read the developer's real `slop-term.conf`. The defaults test picks the alias `slop-test-defaults` so that no real host matches it, but nothing enforces that.

Fix: none needed yet. If a test ever needs the temp Managed config to apply through `ssh -G`, write the include into the temp config with an absolute path, as `ssh-tab.test.ts` already does.

## 8. The pnpm shim (repeat of 08 #5 and 09 #6)

Every check ran as `npx -y pnpm@10.28.1 ...`, about 15 times.

Fix: unchanged. Run `corepack enable`.

## Checked, no change needed

- The two-axis review earned its cost again. The Spec reviewer found three real bugs that 32 passing tests missed:
  - A rename onto an orphaned Sidecar alias lost the renamed session's data.
  - A hidden delete-secret checkbox still deleted the old secret.
  - Focus didn't go back to the tree row when a dialog closed.

  The Standards reviewer found the duplicated menu block and the unneeded `onRename` default.
- Testing Library ignores `inert`, so a query by role also finds rows behind a modal. One test needed a scoped `within(popover)` for this. That is a one-off gotcha and doesn't need a doc.
- The design hook fired on renderer files as intended. With `.impeccable/config.json` from 09 #7, it stayed off the back-end files.
