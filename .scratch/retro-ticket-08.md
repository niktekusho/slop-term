# Retro: ticket 08, password login and keychain provider

Session of 2026-10-28. These are improvements to the environment that would make future sessions faster or safer. They are ordered by severity, and none of them has been applied.

## 1. The tracker rules point at the wrong place

The global CLAUDE.md says the issue tracker is `.trail/<feature>/` and that ticket status changes only through the `trail` CLI. This repo keeps its tickets in `.scratch/slop-term-v1-build/issues/`, and `.trail/` holds only `state.json`.

What it cost:

- Looking up `08` matched two files: the build ticket and a grilling note with the same number. The agent had to read both to tell them apart.
- The trail stop hook blocked twice with "a flow skill ran with no current feature".
- The ticket was closed by editing its `Status:` line, which the global rule forbids.

Pick one of these fixes:

- Move the tickets into `trail` (`trail new slop-term-v1-build`), so the global rule and the hook hold as written.
- Or add a repo `CLAUDE.md` with a single pointer and turn the trail hook off for this repo:

  > Tickets: `.scratch/slop-term-v1-build/issues/NN-*.md`; their status lives in the `**Status:**` line. Spec: `.scratch/slop-term-v1/spec.md`. Design decisions: `.scratch/slop-term-v1/issues/`.

## 2. No guardrail runs the checks

The repo has no CI workflow and no pre-commit hook. `pnpm lint`, `pnpm typecheck` and `pnpm test` run only when an agent remembers to run them. Nothing slipped through this session, but only because they were run by hand.

Fix: add a pre-commit hook that runs `pnpm lint && pnpm typecheck` (a few seconds), and a CI job that also runs `pnpm test`. The Docker tests skip themselves when Docker isn't running, so the full suite is safe to run in CI.

## 3. Nothing checks that the packaged app loads native modules

The back end now loads two native modules from outside the bundle: `node-pty` and `@napi-rs/keyring`. Both must be listed in `vite.backend.config.mts` (`external`) and in `forge.config.mts` (`asar.unpack` and `ignore`), and no check covers this. A plain `vite build -c vite.backend.config.mts` crashes in `ssh2` even at HEAD, so that build can't serve as a smoke test.

What it cost: the packaged app is still unchecked after ticket 08, and the session dumped 53 KB of minified bundle output while trying the wrong build.

Fix: add a `smoke` script that runs `electron-forge package`, starts the packaged back end, and checks that it loads the keychain module. Point the "packaged build" line in the spec's Testing Decisions at it.

## 4. The test SSH server can't do keyboard-interactive login

`lscr.io/linuxserver/openssh-server` has no PAM, so the keyboard-interactive path in `src/backend/ssh.ts` (2FA prompts, the single hidden prompt counted as the password, the save rule across rounds) has no back-end test. The Spec reviewer found a retry bug next to this path that no test caught.

Fix: add a second test image, such as a small Dockerfile with `sshd`, PAM and `KbdInteractiveAuthentication yes`, started from `src/backend/ssh-server.ts` behind an option. Ticket 09 also needs it, because a reconnect "asks again for keyboard-interactive prompts".

## 5. The global pnpm shim is broken

`pnpm` fails with `Cannot find module …\pnpm\global\5\node_modules\pnpm\bin\pnpm.cjs`. The session worked around it with `npx -y pnpm@10.28.1`.

Fix: run `corepack enable`, or reinstall the global pnpm. `package.json` already pins `packageManager: pnpm@10.28.1`, so corepack would use that version.

## 6. Shell heredocs mangled escapes

Inline Python edit scripts sent through the Bash tool turned `'\n'` into real line breaks three times. Python on Windows also wrote CRLF line endings into every file it edited. `.gitattributes` (`eol=lf`) would have fixed the endings at commit, but the fix-ups took several rounds.

Fix: this is an agent habit, not a repo change. Edit files with the Edit tool, and write any patch script to a scratch file before running it. A feedback memory could record this.

## Checked, no change needed

- Code review ran in two sub-agents, which kept it out of the implementing agent's context. The Standards reviewer applied the global CLAUDE.md rules and caught a stale comment and a duplicated one. The Spec reviewer caught a real bug. Neither needs new rules.
- No mechanical violation turned up that a lint rule could catch. The review findings were judgement calls: naming, a stale comment and retry logic.
- The global CLAUDE.md is 93 lines, mostly writing rules that apply in every session. It doesn't need trimming.
