# Retro: ticket 09, disconnect and reconnect

Session of 2026-10-29. These are improvements to the environment that would make future sessions faster or safer. They are ordered by severity. Findings 1, 4 and 7 are applied; the rest are open. Four of the six findings from the ticket 08 retro came up again in this session.

## 1. A ticked acceptance item has no test, and no reviewer asked for one

The ticket says a reconnect "asks again for keyboard-interactive prompts". The box is ticked, but no test drives a keyboard-interactive login through a reconnect. The Spec reviewer read the checklist, found four real bugs, and still missed this gap, because its brief asks whether behaviour is implemented, not whether a test covers it.

The repo has no `CODING_STANDARDS.md`, so the Standards reviewer had only the global CLAUDE.md and the smell baseline.

Fix: add a `CODING_STANDARDS.md` with this judgement rule, which the review reads and the implementer doesn't need to carry:

> Every ticked acceptance item names the test that covers it, or says why no test can. A ticket's "Back-end tests" and "UI tests" lines are the minimum, not the whole list.

Then add the missing test. The new in-process server (see 4) can ask keyboard-interactive questions with a few more lines.

Applied: `CODING_STANDARDS.md` holds the rule, and "asks the keyboard-interactive questions again on a reconnect" covers the item with `startFakeSshServer({ code })`.

## 2. The tracker rules still point at the wrong place (repeat of 08 #1)

The ticket was closed by editing its `Status:` line again, which the global rule forbids. The SessionStart hook said "trail: no features yet", and the agent had to `ls` `.scratch` and grep the spec to find the ticket, the spec section and the design decision.

Fix: the same two options as before. Either run `trail new slop-term-v1-build` and move the tickets in, or add a repo `CLAUDE.md` with one pointer and turn the trail hook off for this repo:

> Tickets: `.scratch/slop-term-v1-build/issues/NN-*.md`, status in the `**Status:**` line. Spec: `.scratch/slop-term-v1/spec.md`. Design decisions: `.scratch/slop-term-v1/issues/`. Retros: `.scratch/retro-ticket-NN.md`.

## 3. Shell edits mangled code again (repeat of 08 #6)

A Python heredoc turned `'\n'` into a real line break in `ssh-tab.test.ts`, which cost a failed test run. Later, a `sed` rename of `kept` to `memory` also rewrote the plain word "kept" in an unrelated comment ("Provider secrets are never memory"). The 08 retro suggested a feedback memory, but nobody wrote one, so this session repeated the mistake.

Fix: this is now a second occurrence, so a memory is too weak. Add a `PreToolUse` hook on Bash that rejects commands which write into `src/` through `python -`, `sed -i` or a heredoc, with the message "Edit files in src/ with the Edit tool." For renames, the message can suggest the Edit tool's `replace_all` on an exact identifier.

## 4. The test docs don't mention the in-process SSH server

This session added `startFakeSshServer` in `src/backend/ssh-server.ts`. It counts keepalives, ends connections, closes shell channels without an exit status, and takes any login. It made the wake, edit, host key and no-exit-status tests take seconds instead of a Docker start. The spec's Testing Decisions still say every Seam 1 scenario runs against OpenSSH in Docker, so an agent on ticket 17 or 18 won't know the server exists.

Fix: add one line to Seam 1 in `.scratch/slop-term-v1/spec.md`:

> For scenarios OpenSSH in Docker can't stage (keepalive counts, server-side drops, keyboard-interactive), use `startFakeSshServer` in `src/backend/ssh-server.ts`. Use Docker for real OpenSSH behaviour, such as `docker pause` for dropped packets.

This also covers most of 08 #4: the fake server can ask keyboard-interactive questions without a PAM image.

Applied, in the Seam 1 list of the spec's Testing Decisions.

## 5. Still no guardrail (repeat of 08 #2)

There is still no pre-commit hook and no CI workflow. Lint, typecheck and tests ran only because the agent ran them by hand. `oxfmt` reformatted three files at the end, which a pre-commit hook would have done at commit time.

Fix: unchanged from 08 #2. Add a pre-commit hook running `pnpm lint && pnpm typecheck`, and a CI job that also runs `pnpm test`.

## 6. The global pnpm shim is still broken (repeat of 08 #5)

Every check ran as `npx -y pnpm@10.28.1 ...`, about 15 times, and each one paid the npx resolve cost.

`pnpm start` works in the user's own terminal, with an older global pnpm. So the shim is broken only in the agent's Git Bash, which finds a different global install on its PATH.

Fix: run `corepack enable`, so every shell uses the `pnpm@10.28.1` that `package.json` pins.

## 7. The design hook fires on back-end files

The impeccable `PostToolUse` hook scanned `src/backend/ssh.ts`, `ssh-server.ts` and `ssh-tab.test.ts`, and added "Suppressing further design hints" notes to the context. These files have no UI.

Fix: limit the hook's matcher to `src/renderer/**` and `*.css`.

Applied without touching the plugin: `detector.ignoreFiles` in `.impeccable/config.json` now lists `src/backend/**`, `src/shared/**`, `src/main.ts`, `src/preload.ts` and the test files. A test edit still reports a scan of `src/renderer/index.css`, which the hook checks as the related stylesheet.

## Checked, no change needed

- The two-axis review in subagents worked. The Spec reviewer found four real bugs: "Reconnect all" could run twice, focus was lost, the divider was in the wrong place, and a channel closing with no exit status removed the Tab. The Standards reviewer found a missing `ponytail:` marker and duplicated scan setup. All of these were judgement calls a linter can't catch.
- The hidden ordering dependency between `sessions.ts` and `ssh.ts` (closing a Tab before its first `await` throws inside `onClose`) cost one debug round. A comment at the call site now states it, and nothing else depends on it, so it doesn't need a check yet.
- The `ssh2` private fields behind `wake()` are pinned and marked with `ponytail:`. The wake test fails if they change, so an upgrade can't break them silently.
