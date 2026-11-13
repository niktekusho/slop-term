# 23 — MobaXterm import writes an alias that ssh rejects (bug)

**What is wrong:** The MobaXterm import accepted the session "example-host-(testuser)" and wrote `Host example-host-(testuser)` to slop-term.conf. OpenSSH rejects that name, so the session cannot be opened. Editing the session and saving it fails with "ssh rejects these values: hostname contains invalid characters". Renaming the alias to "example-host-testuser" fixes it.

**Blocked by:** none

**Status:** done

## Agent brief

**Category:** bug. **State:** ready-for-agent.

**Cause:** `aliasProblem` in `src/shared/session-rules.ts` blocked only uppercase letters, whitespace, `*`, `?`, `!` and `,`. OpenSSH 10.6 also rejects `( ) ' & $ ; | < > "`, the backtick, `\ { }` in a host name (`ssh -G a<c>b` prints "hostname contains invalid characters"). The dialog Save runs `ssh -G`, so it catches this. `importSessions` in `src/backend/config-store.ts` skips that check (see its `ponytail:` comment), so it wrote the bad `Host` line. `slugify` in `session-rules.ts` builds the import alias (`mobaxterm.ts`, `alias: slugify(name)`) and the typed-`ssh` alias (`typedAlias`), and it kept those characters.

**Fix:** Put the characters OpenSSH rejects into one shared set in `session-rules.ts`. `aliasProblem` returns `No ( in an alias.` for them, like the existing `!` message. `slugify` replaces each run of them with `-`, like it does for spaces, and also collapses runs of dashes so `x-(y)` gives `x-y`. The import then proposes `example-host-testuser` and flags a hand-typed bad alias through `importAliasProblem`. Do not add `ssh -G` to the import.

**Test seam:** unit test of `aliasProblem` and `slugify`; an import test in `src/backend/mobaxterm.test.ts` with a session named `example-host-(testuser)`.

- [x] `aliasProblem("a(b)")` returns a message; `slugify("example-host-(testuser)")` returns `example-host-testuser`.
- [x] The MobaXterm preview proposes the cleaned alias, and a hand-typed `(` in the preview alias field shows the error and blocks Import.
- [x] A typed `ssh` host with one of these characters starts a Saved session with a cleaned alias.
- [x] Every character the rule blocks is rejected by `ssh -G` on the dev machine, and every character it allows is accepted.

## Test coverage

Back end: `src/backend/session-rules.test.ts`, `src/backend/mobaxterm.test.ts`.

- `aliasProblem` and `slugify`: the unit tests in `session-rules.test.ts` run each of the 14 blocked characters through `aliasProblem` and `slugify`, and `slugify` on the example name.
- Preview proposes the cleaned alias: "proposes an alias without the characters ssh rejects" in `mobaxterm.test.ts`.
- Hand-typed `(` blocks Import: `importAliasProblem` has a unit test. `ImportDialog.tsx` already shows that function's message and blocks Import on it, so no new UI test.
- Typed `ssh` host: `typedAlias` unit test, including the user-host fallback. The flow around it is unchanged.
- `ssh -G` agreement: no test runs ssh. Checked by hand with `ssh -G a<c>b` for the 14 blocked characters (all rejected) and for `# ~ + @ : / = % ^ [ ] . _ -` (all accepted). The test's `sshRejected` list is the result.
