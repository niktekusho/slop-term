# 20 — SFTP pane for typed `ssh`

**What to build:** Typing `ssh <host>` in a PowerShell, cmd, zsh or bash Tab gives that Tab an SFTP pane for the same host, as in MobaXterm. The pane resolves the host exactly as the terminal did, connects once the remote shell is up, logs in by itself when it can, and otherwise asks in its own card, where the user can save the password and create a Managed Saved session in one step. Every local shell Tab also has a "Browse files of..." picker, the only way in from WSL.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 10 — SSH Saved session dialog; 17 — SFTP pane browsing and file actions

**Status:** done

- [x] About 0.5 s after Enter in a PowerShell, cmd, zsh or bash Tab, the back end looks for a direct child named `ssh` of the Tab's shell (process query by pid on Windows, `ps` on macOS) and reads its command line. Newest wins; `ssh` under `git` or `scp` doesn't count; while it runs only its pid is checked.
- [x] The pane resolves with `ssh -G` and the typed arguments using the same `ssh` executable. `ProxyJump` or `ProxyCommand` shows the jump-host message and doesn't connect.
- [x] OSC 7 counts in a local shell Tab only while an `ssh` is detected; the first OSC 7 hostname is the pane's host. The pane connects on its own after that first OSC 7; until then it shows "Browse files on <user>@<host>". The chained-`ssh` banner from ticket 17 applies.
- [x] Saved session match: typed alias plus resolved user first; else the first session in tree order whose `HostName`, `Port` and `User` equal the resolved values and that has a reference. A matched session's Session colour shows on the Tab while `ssh` runs.
- [x] Login order: matched reference, SSH agent, `IdentityFile` keys, then the card. Host keys follow ticket 05; the pane's own question shows only if the user clicks the button while `ssh` waits at its prompt.
- [x] Card "Log in to <user>@<host>": says it is for the pane only and the terminal's `ssh` asks on its own; password field; "Save to" radios (keychain under its OS name, each KeePass database, "Don't save"), keychain default. Save is offered only for `password` logins or one hidden keyboard-interactive prompt in one round.
- [x] Saving with a matching Managed session that has no reference attaches it. Saving with no match adds an alias field (prefilled with the slugified host, or `<user>-<host>` when taken, checked as typed), a folder dropdown (existing folders plus "Top level", starting on the last folder used, remembered in settings, no folder creation) and a line naming the Saved session it creates; it creates a Managed session from the `ssh -G` `HostName`, `User` and `Port` plus `ServerAliveInterval 15`. A Hand-written host gets "Move web1 into slop-term to save its password" instead of "Save to".
- [x] Write order: secret first; a provider refusal writes nothing else and the pane still connects; a config conflict keeps the saved secret.
- [x] A typed secret stays in memory until that `ssh` exits. The app never reads what the user types into `ssh`; no `SSH_ASKPASS`.
- [x] When `ssh` exits the pane closes its connections, shows the hint again and drops the typed secret; running transfers finish; editor saves wait for the same host in that Tab.
- [x] The pane's connection can drop and reconnect with its own button, separately from the terminal's `ssh`.
- [x] Every local shell Tab's hint has "Browse files of..." over SSH Saved sessions; in WSL Tabs it is the only option and the hint says the pane can't see `ssh` inside WSL.
- [x] The Unsaved group shows `→ <alias>` for a Tab running a typed `ssh`.
- [x] Back-end tests: child-process detection on each system, `ssh -G` with typed options, alias/user match and host fallback, save creating a Managed session, refusal ordering. UI tests: card states, alias prefill, picker in WSL Tabs.

## Test coverage

Back end: `src/backend/typed-ssh.test.ts`, which opens a real local shell Tab and types a real `ssh` into it, against `startFakeSshServer`. The fake server's new `prompt` option sends a remote OSC 7. The tests use the in-process server, so CI runs them on Windows, Ubuntu and macOS: the Windows process query and the `ps` path each run there. UI: `src/renderer/TypedSsh.test.tsx`, against `FakeBackend`.

- Detection: "finds the ssh child of the shell after Enter and reports its resolved host, then its exit". The `ssh` under `git` or `scp` rule needs no code: `findSsh` takes only direct children of the shell, and those `ssh` processes are children of `git` or `scp`. "Newest wins" and "only its pid is checked" have no test: staging two `ssh` children at once, or counting process queries, needs hooks the IPC seam doesn't have.
- `ssh -G` with typed arguments: the match test types `-F`, `-o User=…` and `-p` and checks the resolved user and port. The same executable: `findSsh` returns Windows' `ExecutablePath` and macOS' `comm`. No test puts a second `ssh` on PATH. Jump host: "reports a jump host and doesn't connect", via the picker, because a typed `ssh` through a jump host that can't connect exits before detection. UI: "shows why the pane dropped… and the jump host message without a button".
- OSC 7: "connects the pane on its own after the remote shell sends OSC 7, and transfers over it" checks the `firstHost` the pane gets. `local-shell.test.ts` checks that a local OSC 7 with no `ssh` gives `firstHost: ''`. UI: "ignores a local prompt's OSC 7 while no ssh runs", and the first UI test shows "Browse files on" and the OSC 7 folder the pane opens in. The chained-`ssh` banner reuses ticket 17's `away` rule, which `SftpPane.test.tsx` covers.
- Match: "matches the typed alias with the resolved user, else the first session in tree order…". It failed when the candidates were sorted by name only. Colour: UI "shows → <alias> on the Unsaved Tab row and the matched session's colour while ssh runs", including that a picked session doesn't colour the Tab.
- Login order: the OSC 7 test logs in with the typed `-i` key; the password tests reach the card after the agent and keys. The pane's host key question: UI "shows the pane's host key question inside the pane". The pane asks about a host key only before the terminal's `ssh` saved it, because it connects on its own only after OSC 7.
- Card: UI "asks in its own card…", "prefills <user>-<host>…", "attaches to a matched session…". Back end: the password tests check the title and `save: 'create'`, and "offers to attach… and tells a Hand-written host to move in" checks `save: 'new'` and `moveIn`. A passphrase or a second keyboard-interactive round gets no offer, from the existing `offers` rules in `ssh.ts`.
- Saving: "saves the password and creates a Managed Saved session from the ssh -G values" checks the host block, the Sidecar entry, the keychain and the remembered folder in `settings.json`. That check found `settings.ts` dropping the new key. The card's own test emits a `tree` event while it is open.
- Write order: "writes nothing when the provider refuses the save, and the pane still connects". A config conflict after the secret write has no test, because nothing can change the file between the two writes. The pane saves through `saveSession`, which writes the secret first and doesn't delete it on a later conflict.
- Typed secret: "forgets a typed password when ssh exits". `grep -rn ASKPASS src` finds nothing. The back end reads only `ps` and the process query, never the Tab's input.
- `ssh` exits: "lets a running upload finish when ssh exits" and the same for a host that asks keyboard-interactive questions, whose transfers run on the pane's own connection. Both failed when the connections closed at once. UI: the first test shows the hint again. Editor saves for one host wait in that host's sync: `sessions.ts` keeps one queue and one editor sync per host a Tab's pane reached. No test runs `ssh` to two hosts in one Tab.
- Pane reconnect: "browses a picked Saved session with no ssh running, and stops" drops the pane and reconnects it with `browseFiles`. UI: "shows why the pane dropped, with its own Reconnect…", and the first test checks that a drop keeps the listing greyed.
- Picker: UI "offers "Browse files of..." over SSH Saved sessions in every local shell Tab" and "offers only the picker in a WSL Tab…". The picker also lists Hand-written hosts, which are SSH hosts in the tree. "Stop browsing" ends a picked pane: without it the hint can't come back.
- `→ <alias>`: the UI colour test above.

Platform facts checked by running them:

- node-pty reports pid 0 right after spawn on Windows (ConPTY), and the real pid once the shell runs. The detection test failed with `findSsh(0)` until the pid was read at check time.
- One `powershell.exe` `Get-CimInstance Win32_Process` query takes about 1.5 s on this laptop (`Measure-Command` gave 1574 ms). A key login reaches the remote prompt sooner, so the back end keeps an OSC 7 that arrives during a check. The OSC 7 test stayed `waiting` without that.
- A `pwsh` Tab started from the test run found Git for Windows' `ssh.exe` on PATH. The process query showed it as a direct child of `pwsh.exe`.
