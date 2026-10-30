# Retro: ticket 13, Local shell Saved sessions

Session of 2026-10-30. These are improvements to the environment that would make future sessions faster or safer. They are ordered by severity. Findings 2, 3 and 4 are applied: the hook regex, two glossary terms and a rule in `CODING_STANDARDS.md`, and one line in the repo `CLAUDE.md`. Finding 1 needs its own diagnosis session.

## 1. The full suite is red on almost every run, and retro 12's fix doesn't work

With the ticket's changes, all 6 full runs in the default parallel setup failed at least one test. The failure moved between files and kinds:

- "opens the first shell and reads its output" (3 runs, 14.5 to 15.3 s)
- a UI test, "lowercases the alias as typed…", at the UI project's default 5 s timeout
- "sends one keepalive on every SSH Tab when the computer wakes" (18 s)
- one run with 6 timeouts across both local-shell files (231 s)

A run on the previous commit, without this ticket, failed "opens the first shell and reads its output" too. So the flake is the one from retro 12 #1, not new.

Retro 12 #1 proposed `fileParallelism: false` for the back-end project. I measured it: two runs took 264 s and 172 s (parallel takes 92 to 113 s), and the first still failed. That fix is ruled out.

The cost is high. Each full run takes about 100 s, and this session spent 8 of them, plus a baseline run, to tell real failures from the flake. CI on `windows-latest` runs the same suite, so CI is red at random.

What this session suggests about the cause:
- The UI project times out too, so the trigger is CPU contention from running both projects at once, not ConPTY alone.
- A test that waits twice in a row (exit, then restart) can pass each 15 s wait and still exceed the 20 s `testTimeout`. The local-shell tests now give each wait its own budget.

Fix: run the `diagnosing-bugs` skill on it as its own task. Measure the time to first output of "opens the first shell" alone, in the back-end project alone, and in the full suite. Then decide between a separate serial project for the two pty files (`local-shell.test.ts`, `local-shell-sessions.test.ts`) and longer waits. Count red runs over 5 full runs before and after.

## 2. The `src/` shell-edit hook blocks commands that only mention `src/`

`.claude/hooks/no-shell-src-edits.mjs` blocks any command that contains `src/` and also matches `<<`. It blocked `cat >> .scratch/…/13-local-shell-saved-sessions.md <<'EOF'`, which wrote only to `.scratch/`. The `src/` came from file names in the appended text. The agent then redid it with Edit.

It also correctly blocked `node - <<'EOF'`, a script that edited `src/shared/ipc.ts`, which cost 9 separate Edit calls. That block is wanted.

Fix: block on the write target, not on any mention. Treat `>`, `>>` and `tee` as writes only when their target is under `src/`, and keep the stdin-script case by matching `(node|python3?)\s+-` together with a `src/` mention:

```js
const redirect = /(>>?|tee(\s+-a)?)\s*["']?[^\s"']*src\//;
const script = /(node|python3?)\s+-|sed\s+-i/;
if (redirect.test(cmd) || (script.test(cmd) && cmd.includes('src/')))
```

## 3. Reviewers flagged two non-issues the implementer had already settled

Both came from facts that existed only in the implementer's context:

- The Spec reviewer called `wsl --cd ~/src` broken, citing Microsoft's docs. The implementer had run `wsl.exe --cd ~/.cache -- pwd` on this machine, and it printed the right folder. The reviewer prompt carried the other WSL fact (a quoted command after `--` is one word), but not this one.
- Both reviewers read the ticket's "the kind can't change after creation" as the shell kind (`pwsh` versus `wsl`). Spec line 280 says it means SSH versus local shell. The ticket puts the sentence right after the shell-kind list, and `GLOSSARY.md` defines neither term.

Fix:
- Add two entries to `GLOSSARY.md`: **Session kind** (SSH or local shell, fixed at creation) and **Shell kind** (`pwsh`, `powershell`, `cmd`, `wsl`, `zsh`, `bash`, editable). Tickets 14 and 21 touch both.
- Add one rule to `CODING_STANDARDS.md` under Tests, so the facts reach the reviewer through the ticket: "A platform fact the code relies on and the implementer checked by running it goes in the ticket's Test coverage section, with the command that showed it."

## 4. A reverted experiment left a broken config for two full runs

The agent removed its `fileParallelism` lines from `vitest.config.mts` with an Edit whose `old_string` began with a line break and whose `new_string` was empty. That also removed a line break and a closing brace. The next two full runs (about 200 s) used the changed config. `git status` showed it only after the baseline run, and `git checkout --` fixed it.

Fix: revert an experiment in a committed file with `git checkout -- <file>`, which can't leave a partial change. This is one clause in the repo `CLAUDE.md`. The rule is cheap, but the failure is rare. Skip it if `CLAUDE.md` should stay at pointers only.

## Checked, no change needed

- Retro 12 #3's FakeBackend rule held. Only `saveLocalShell` computes a tree, because the Tab-move tests depend on it. The Standards reviewer caught the one assertion that only checked the fake's own tree.
- Retro 12 #5's "Test coverage" section worked. Both reviewers used it, and the Standards reviewer checked each line against it.
- The spec's prototype commits were enough to find the Local shell dialog's launch-line format and shell labels with `git show b9810e6:…`.
- `grep` on the 60 KB spec found every Local shell line in one call, as retro 12 found.
- The 12 UI tests were written as one batch rather than one slice at a time. Two expectations were wrong, and reading them again caught both. Two temporary mutations then showed that the dimmed-row and exit-0 tests can fail. Nothing in the environment needs to change for this.
