# 20 — SFTP pane for typed `ssh`

**What to build:** Typing `ssh <host>` in a PowerShell, cmd, zsh or bash Tab gives that Tab an SFTP pane for the same host, as in MobaXterm. The pane resolves the host exactly as the terminal did, connects once the remote shell is up, logs in by itself when it can, and otherwise asks in its own card, where the user can save the password and create a Managed Saved session in one step. Every local shell Tab also has a "Browse files of..." picker, the only way in from WSL.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 10 — SSH Saved session dialog; 17 — SFTP pane browsing and file actions

**Status:** ready-for-agent

- [ ] About 0.5 s after Enter in a PowerShell, cmd, zsh or bash Tab, the back end looks for a direct child named `ssh` of the Tab's shell (process query by pid on Windows, `ps` on macOS) and reads its command line. Newest wins; `ssh` under `git` or `scp` doesn't count; while it runs only its pid is checked.
- [ ] The pane resolves with `ssh -G` and the typed arguments using the same `ssh` executable. `ProxyJump` or `ProxyCommand` shows the jump-host message and doesn't connect.
- [ ] OSC 7 counts in a local shell Tab only while an `ssh` is detected; the first OSC 7 hostname is the pane's host. The pane connects on its own after that first OSC 7; until then it shows "Browse files on <user>@<host>". The chained-`ssh` banner from ticket 17 applies.
- [ ] Saved session match: typed alias plus resolved user first; else the first session in tree order whose `HostName`, `Port` and `User` equal the resolved values and that has a reference. A matched session's Session colour shows on the Tab while `ssh` runs.
- [ ] Login order: matched reference, SSH agent, `IdentityFile` keys, then the card. Host keys follow ticket 05; the pane's own question shows only if the user clicks the button while `ssh` waits at its prompt.
- [ ] Card "Log in to <user>@<host>": says it is for the pane only and the terminal's `ssh` asks on its own; password field; "Save to" radios (keychain under its OS name, each KeePass database, "Don't save"), keychain default. Save is offered only for `password` logins or one hidden keyboard-interactive prompt in one round.
- [ ] Saving with a matching Managed session that has no reference attaches it. Saving with no match adds an alias field (prefilled with the slugified host, or `<user>-<host>` when taken, checked as typed), a folder dropdown (existing folders plus "Top level", starting on the last folder used, remembered in settings, no folder creation) and a line naming the Saved session it creates; it creates a Managed session from the `ssh -G` `HostName`, `User` and `Port` plus `ServerAliveInterval 15`. A Hand-written host gets "Move web1 into slop-term to save its password" instead of "Save to".
- [ ] Write order: secret first; a provider refusal writes nothing else and the pane still connects; a config conflict keeps the saved secret.
- [ ] A typed secret stays in memory until that `ssh` exits. The app never reads what the user types into `ssh`; no `SSH_ASKPASS`.
- [ ] When `ssh` exits the pane closes its connections, shows the hint again and drops the typed secret; running transfers finish; editor saves wait for the same host in that Tab.
- [ ] The pane's connection can drop and reconnect with its own button, separately from the terminal's `ssh`.
- [ ] Every local shell Tab's hint has "Browse files of..." over SSH Saved sessions; in WSL Tabs it is the only option and the hint says the pane can't see `ssh` inside WSL.
- [ ] The Unsaved group shows `→ <alias>` for a Tab running a typed `ssh`.
- [ ] Back-end tests: child-process detection on each system, `ssh -G` with typed options, alias/user match and host fallback, save creating a Managed session, refusal ordering. UI tests: card states, alias prefill, picker in WSL Tabs.
