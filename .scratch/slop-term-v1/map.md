# Map: slop-term v1

Label: wayfinder:map

## Destination

A v1 spec for a personal, cross-platform (Windows + macOS) GUI SSH client with unlimited Saved sessions, ready to build with nothing left to decide.

## Notes

- Personal tool for one user. No installers, auto-update, telemetry or onboarding in v1.
- v1 features: SSH terminal with tabs, Saved-session tree with folders, SFTP pane in the same window as the terminal (it also opens for `ssh <host>` typed in a local shell Tab), local shells (PowerShell, WSL, cmd, zsh), import from MobaXterm.
- Saved sessions live in standard OpenSSH config plus a Sidecar file (see "What goes in SSH config vs the Sidecar file"). The user syncs the app's files between machines with a tool of their choice.
- Secrets come from Credential providers, which can both read and write. v1 has three: the OS keychain (Windows Credential Manager, macOS Keychain), Team Password Manager at https://tpm.gpi.it/index.php, and a KeePass database the app reads directly (see "Can a KeePass database be a Credential provider?"). A provider may refuse writes. Adding a provider is a code change.
- Stack: soft preference for TypeScript. The user used Electron 5+ years ago and is open to Electrobun if it's worth it.
- Vocabulary is in `GLOSSARY.md` at the repo root. Use its terms (Saved session, Tab, SFTP pane, SSH config, Managed config, Hand-written host, Sidecar file, Credential provider, Credential reference, Session colour).
- Every session should load the `domain-modeling` skill when a term moves.

## Decisions so far

- [How Team Password Manager API auth works with SSO](issues/03-tpm-api-auth.md): SSO (SAML) users can call API v6 only with personal HMAC keys, on TPM 10.138.240 or later, if the admin has enabled the API for them. Writes need "Edit data" permission.
- [MobaXterm session export format](issues/04-mobaxterm-export-format.md): sessions are INI lines, one `[Bookmarks_N]` section per folder, with the host, port, user and key path at fixed positions. Passwords are stored elsewhere, and this user stores none, so there's nothing to import.
- [Do existing tools already cover v1?](issues/01-existing-tools.md): no free tool covers v1. Tabby comes closest, but it can't write to SSH config and would need a custom plugin for TPM. XPipe has no built-in terminal on macOS.
- [Build or adopt?](issues/07-build-or-adopt.md): build. No tool has both an SFTP pane in the terminal's window and a way to read TPM without a fork. SSH config writes are a nice-to-have, and TPM writes aren't needed.
- [Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client](issues/02-stack-options.md): the TypeScript SSH stack (`ssh2`, `node-pty`, `@napi-rs/keyring`, `ssh-config`) works on Electron. On Bun, `node-pty` runs only one-shot commands and interactive shells fail (found later, in "Choose the stack"). Tauri needs Rust or a sidecar. The facts favour Electron, then Electrobun, which is young and has open Windows bugs. Tested on Windows only.
- [What goes in SSH config vs the Sidecar file](issues/05-ssh-config-and-sidecar.md): the app owns `~/.ssh/slop-term.conf`, included from `~/.ssh/config`, plus a `~/.ssh/slop-term.json` Sidecar for folders and Credential references. Only those two files sync. Hand-written hosts are read-only until moved in. The app re-reads before every write and never loses data.
- [Get TPM API access](issues/06-get-tpm-api-access.md): works with reads and writes on TPM 14.184.308, API v6, with the user's HMAC keys, which never expire. `user_permission` is an object `{id, label}`, and every request needs a `Content-Type` header, even a GET.
- [Credential provider interface](issues/08-credential-provider-interface.md): every provider has `read`, `write` and `delete`, and any of them can refuse with a reason. TPM is read-only in v1. A reference is `{provider, entry, kind}`. The app reads secrets on every connect with no cache (a typed password stays in memory for its Tab, from "SFTP pane behaviour"), and asks the user only when there's no reference or a read or auth fails. TPM's HMAC keys go in the keychain and its URL in per-machine settings. Attaching a TPM entry copies its username, and a later mismatch blocks the connect.
- [Choose the stack](issues/09-choose-stack.md): Electron 44 with React + TypeScript, xterm.js 6 (1,000-line scrollback by default), `ssh2`, `node-pty`, `@napi-rs/keyring` and `ssh-config`. The whole back end runs in one `utilityProcess` and talks to the UI only by IPC. Profiling (inspectors, per-process metrics, Chrome traces) is in from the first build. Electron Forge with Vite, npm, no installer. Tauri used about 40 MB less at 5 full Tabs, not enough to justify a Rust back end now.
- [How MobaXterm sessions map onto slop-term](issues/10-mobaxterm-import-mapping.md): the import shows a preview first, and the user can edit each alias there. The alias is the session name, slugified. Existing aliases are never overwritten, and hosts identical to existing ones start unticked. Folders map to Sidecar folders. `.ppk` keys, jump hosts and login commands are dropped and flagged. WSL sessions become local shell sessions, and other non-SSH types are skipped.
- [Main window layout](issues/11-ui-layout-prototype.md): the tree is a fixed left column, and each open Tab is listed in it under its Saved session, with no Tab strip. The SFTP pane sits right of the terminal and collapses for the whole window. Profiling opens as a panel under the terminal.
- [Local shell sessions](issues/12-local-shell-sessions.md): local shells are Saved sessions in the same tree, stored in the Sidecar file, with a shell kind, WSL distro, start folder and command. Names follow the alias rules. Detected shells open as unsaved Tabs in an "Unsaved" group. A session whose shell this machine lacks shows greyed out. MobaXterm WSL sessions import with the default distro.
- [SFTP pane behaviour](issues/13-sftp-pane-behaviour.md): the pane browses on the Tab's connection and transfers on a second one, follows the terminal folder through OSC 7, and shows hidden files. Uploads queue per Tab and ask on conflicts. Files drag in but not out. Double-click opens a file in a configured editor and uploads on save, after checking the remote copy didn't change.
- [Can SFTP pane transfers use rsync?](issues/17-rsync-transfers.md): no. No JavaScript rsync exists, Windows has no rsync binary, and the remote host needs one too. rsync only wins on small changes to big files.
- [Can a KeePass database be a Credential provider?](issues/19-keepass-provider.md): yes. The app reads the `.kdbx` file with `kdbxweb`, because the user runs KeeWeb, not KeePassXC. KeePassXC's browser protocol was the research's first pick, since it keeps the master password out of the app.
- [SFTP pane for `ssh <host>` typed in a local shell Tab](issues/14-sftp-for-typed-ssh.md): on Enter, the app looks for an `ssh` child of the shell and resolves its arguments with `ssh -G`. The pane logs in a second time, as MobaXterm does, and connects on its own unless it has to ask for a password. WSL Tabs get only a "Browse files of..." picker. A chained `ssh` leaves the pane on the first host.
- [ProxyJump in v1](issues/15-proxyjump.md): out of v1, since no host needs one. A Saved session that `ssh -G` resolves to a jump host fails to connect with a clear message. The typed-`ssh` pane and the MobaXterm import keep their earlier behaviour.
- [Keyboard shortcuts, themes and fonts](issues/16-shortcuts-themes-fonts.md): fixed shortcuts on Ctrl+Shift (Windows) and Cmd (macOS, after iTerm2), so plain Ctrl keys reach the shell. Tabs cycle in tree order. Multi-line paste always asks. Theme follows the OS, the font is bundled, and both live in per-machine `settings.json`. A Saved session can have a Session colour from a curated list, imported from MobaXterm tab colours.
- [Tab disconnect and reconnect](issues/18-tab-reconnect.md): keepalives every 15 s at most (or `ServerAliveInterval` if shorter), 3 misses, and a check on wake. Reconnect is manual (R or a button) and keeps the old scrollback above a divider. A clean shell exit closes the Tab, other exits keep it open. A reconnect reads secrets and the Saved session afresh.
- [KeePass provider details](issues/20-keepass-provider-details.md): master password only, asked once per app run per database. The database stays unlocked in memory until quit, sleep, screen lock or "Lock KeePass". Several databases per machine, named in `settings.json`, with `entry` as `<name>/<uuid>`. The app reloads the file when its modified time changes, and writes by reload, apply, temp file and rename. It updates and creates entries, and deletes one only when the user asks while deleting a Saved session. Attach is a search box, with the TPM username check.
- [Terminal look](issues/21-terminal-look.md): GitHub Dark and GitHub Light palettes, and JetBrains Mono at 12 px with weight 500 and 0.5 px letter spacing, on xterm's WebGL renderer. The contrast floor is 7 in dark mode and 4.5 in light mode. There are eight named Session colours. A coloured Tab gets a coloured header bar and a 10% background tint, which `settings.json` can turn off. The tree dot sits on the Saved session row only.
- [Saving passwords typed for `ssh <host>`](issues/22-save-typed-ssh-passwords.md): the SFTP pane's own prompt offers "Save to", with keychain as the default on every save prompt. There is no `SSH_ASKPASS`, so the terminal's `ssh` keeps asking. A host with no Saved session gets a new Managed one, with an editable alias and a folder picker. A later `ssh` finds it by alias and user, then by resolved host, port and user. Deleting a Saved session asks whether to delete its keychain or KeePass secret too.

## Not yet specified

## Out of scope

- SSH tunnels / port forwarding: dropped until the user needs them.
- Built-in X11 server.
- RDP, VNC, Telnet and serial connections.
- Multi-exec (typing into several Tabs at once).
- Plugin loading for Credential providers.
- A sync server. File sync is the user's own tool.
- Handing macOS terminals to iTerm2 ([Build or adopt?](issues/07-build-or-adopt.md)): the SFTP pane must share the terminal's window, and macOS can't embed another app's window.
- Creating Saved sessions from TPM entries ([Credential provider interface](issues/08-credential-provider-interface.md)): attaching an entry to an existing Saved session covers the need.
- Showing or copying a secret inside the app ([Credential provider interface](issues/08-credential-provider-interface.md)): a convenience the user doesn't need.
- Writing secrets to TPM ([Credential provider interface](issues/08-credential-provider-interface.md)): the TPM provider refuses writes in v1.
- A native Rust rewrite ([Choose the stack](issues/09-choose-stack.md)): a possible step after the v1 features are in. The IPC-only back end keeps it possible.
- Built-in Docker integration, meaning listing containers and browsing their files ([How MobaXterm sessions map onto slop-term](issues/10-mobaxterm-import-mapping.md)): a local shell session that runs `docker exec` covers the user's need.
- rsync transfers ([Can SFTP pane transfers use rsync?](issues/17-rsync-transfers.md)): no JavaScript rsync exists and Windows lacks the binary. A later optional mode for big files is possible.
- Jump hosts / `ProxyJump` chaining ([ProxyJump in v1](issues/15-proxyjump.md)): the user has no host that needs one. Returns only as a new effort.
- Smart Ctrl+C, which copies when text is selected and otherwise sends Ctrl+C ([Keyboard shortcuts, themes and fonts](issues/16-shortcuts-themes-fonts.md)): a stray selection would swallow an interrupt. The user wants it as an option after v1.
- Syncing KeePass groups with the app's folders ([KeePass provider details](issues/20-keepass-provider-details.md)): an idea for after v1. In v1 the save picker preselects the group whose name matches the folder.
- KeePass key files and YubiKey ([KeePass provider details](issues/20-keepass-provider-details.md)): the user unlocks with a master password only. `kdbxweb` handles key files, so they can come later.
- Setting up key login, meaning creating a key and adding it to the remote `authorized_keys` ([Saving passwords typed for `ssh <host>`](issues/22-save-typed-ssh-passwords.md)): the user wants it after v1. Shared accounts would need a per-host way to skip it.
