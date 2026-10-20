# Map: slop-term v1

Label: wayfinder:map

## Destination

A v1 spec for a personal, cross-platform (Windows + macOS) GUI SSH client with unlimited Saved sessions, ready to build with nothing left to decide.

## Notes

- Personal tool for one user. No installers, auto-update, telemetry or onboarding in v1.
- v1 features: SSH terminal with tabs, Saved-session tree with folders, SFTP pane in the same window as the terminal (it also opens for `ssh <host>` typed in a local shell Tab), local shells (PowerShell, WSL, cmd, zsh), import from MobaXterm.
- Saved sessions live in standard OpenSSH config plus a Sidecar file (see "What goes in SSH config vs the Sidecar file"). The user syncs the app's files between machines with a tool of their choice.
- Secrets come from Credential providers, which can both read and write. v1 has two: the OS keychain (Windows Credential Manager, macOS Keychain) and Team Password Manager at https://tpm.gpi.it/index.php. A provider may refuse writes. Adding a provider is a code change.
- Stack: soft preference for TypeScript. The user used Electron 5+ years ago and is open to Electrobun if it's worth it.
- Vocabulary is in `GLOSSARY.md` at the repo root. Use its terms (Saved session, Tab, SFTP pane, SSH config, Managed config, Hand-written host, Sidecar file, Credential provider, Credential reference).
- Every session should load the `domain-modeling` skill when a term moves.

## Decisions so far

- [How Team Password Manager API auth works with SSO](issues/03-tpm-api-auth.md): SSO (SAML) users can call API v6 only with personal HMAC keys, on TPM 10.138.240 or later, if the admin has enabled the API for them. Writes need "Edit data" permission.
- [MobaXterm session export format](issues/04-mobaxterm-export-format.md): sessions are INI lines, one `[Bookmarks_N]` section per folder, with the host, port, user and key path at fixed positions. Passwords are stored elsewhere, and this user stores none, so there's nothing to import.
- [Do existing tools already cover v1?](issues/01-existing-tools.md): no free tool covers v1. Tabby comes closest, but it can't write to SSH config and would need a custom plugin for TPM. XPipe has no built-in terminal on macOS.
- [Build or adopt?](issues/07-build-or-adopt.md): build. No tool has both an SFTP pane in the terminal's window and a way to read TPM without a fork. SSH config writes are a nice-to-have, and TPM writes aren't needed.
- [Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client](issues/02-stack-options.md): the TypeScript SSH stack (`ssh2`, `node-pty`, `@napi-rs/keyring`, `ssh-config`) works on Electron. On Bun, `node-pty` runs only one-shot commands and interactive shells fail (found later, in "Choose the stack"). Tauri needs Rust or a sidecar. The facts favour Electron, then Electrobun, which is young and has open Windows bugs. Tested on Windows only.
- [What goes in SSH config vs the Sidecar file](issues/05-ssh-config-and-sidecar.md): the app owns `~/.ssh/slop-term.conf`, included from `~/.ssh/config`, plus a `~/.ssh/slop-term.json` Sidecar for folders and Credential references. Only those two files sync. Hand-written hosts are read-only until moved in. The app re-reads before every write and never loses data.
- [Get TPM API access](issues/06-get-tpm-api-access.md): works with reads and writes on TPM 14.184.308, API v6, with the user's HMAC keys, which never expire. `user_permission` is an object `{id, label}`, and every request needs a `Content-Type` header, even a GET.
- [Credential provider interface](issues/08-credential-provider-interface.md): every provider has `read`, `write` and `delete`, and any of them can refuse with a reason. TPM is read-only in v1. A reference is `{provider, entry, kind}`. The app reads secrets on every connect with no cache, and asks the user only when there's no reference or a read or auth fails. TPM's HMAC keys go in the keychain and its URL in per-machine settings. Attaching a TPM entry copies its username, and a later mismatch blocks the connect.
- [Choose the stack](issues/09-choose-stack.md): Electron 44 with React + TypeScript, xterm.js 6 (1,000-line scrollback by default), `ssh2`, `node-pty`, `@napi-rs/keyring` and `ssh-config`. The whole back end runs in one `utilityProcess` and talks to the UI only by IPC. Profiling (inspectors, per-process metrics, Chrome traces) is in from the first build. Electron Forge with Vite, npm, no installer. Tauri used about 40 MB less at 5 full Tabs, not enough to justify a Rust back end now.
- [How MobaXterm sessions map onto slop-term](issues/10-mobaxterm-import-mapping.md): the import shows a preview first, and the user can edit each alias there. The alias is the session name, slugified. Existing aliases are never overwritten, and hosts identical to existing ones start unticked. Folders map to Sidecar folders. `.ppk` keys, jump hosts and login commands are dropped and flagged. WSL sessions become local shell sessions, and other non-SSH types are skipped.
- [Main window layout](issues/11-ui-layout-prototype.md): the tree is a fixed left column, and each open Tab is listed in it under its Saved session, with no Tab strip. The SFTP pane sits right of the terminal and collapses for the whole window. Profiling opens as a panel under the terminal.
- [Local shell sessions](issues/12-local-shell-sessions.md): local shells are Saved sessions in the same tree, stored in the Sidecar file, with a shell kind, WSL distro, start folder and command. Names follow the alias rules. Detected shells open as unsaved Tabs in an "Unsaved" group. A session whose shell this machine lacks shows greyed out. MobaXterm WSL sessions import with the default distro.

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
