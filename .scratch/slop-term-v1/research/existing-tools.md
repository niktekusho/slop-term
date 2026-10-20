# Do existing tools already cover v1?

Researched 2026-10-19 for ticket `issues/01-existing-tools.md`. Sources are official repos, source code, docs and pricing pages, read on that date.

## Verdict

No free tool meets every v1 need on both Windows and macOS. Two needs fail almost everywhere:

1. Writing Saved sessions back to `~/.ssh/config`. Every tool checked either ignores the file, imports it once into its own store, or reads it live without writing. None writes it.
2. An external password manager that can be extended to Team Password Manager (TPM). Only XPipe has a generic hook (a custom command, read only). Tabby can get there through a plugin someone would have to write.

Tabby is the closest fit. It misses SSH config write-back, its SSH config hosts sit read-only in one fixed group, and TPM would need a custom Tabby plugin. XPipe is second, but it has no built-in terminal and only docks external terminals on Windows.

## Summary table

Legend: yes, partial, no. "Partial" is explained in the per-tool section.

| Need | Tabby | Electerm | XPipe (Community) | WindTerm | WezTerm | Termius free |
| --- | --- | --- | --- | --- | --- | --- |
| Unlimited Saved sessions | yes | yes | yes | yes | yes | not stated |
| SSH tabs | yes | yes | partial | yes | yes | yes |
| Folder tree of sessions | yes | yes | yes | yes | no | partial |
| SFTP browser next to terminal | yes | yes | partial | yes | no | yes |
| Local shells | yes | yes | partial | yes | yes | yes |
| Read `~/.ssh/config` | partial | partial | yes | partial | yes | partial |
| Write `~/.ssh/config` | no | no | no | no | no | no |
| OS keychain read and write | yes | partial | partial | no | no | no |
| External password manager hook | partial | no | partial | no | no | no |
| Licence | MIT | MIT | Apache-2.0 core + closed extensions | Apache-2.0 for released parts, partly closed | MIT | proprietary |
| Maintained | yes | yes | yes | slow | partial | yes |

## Tabby

Repo: https://github.com/Eugeny/tabby. MIT licence. Latest release v1.0.238 on 2026-10-07, last push 2026-10-19. Electron 43 (`package.json`). Windows, macOS, Linux.

- Saved sessions and tabs: yes. SSH profiles open as tabs.
- Folder tree: yes since v1.0.235 (2026-07-22), which added "Group nesting "folders" & Profile tree view" (PR #10788). `ProfileGroup` has a `parentGroupId` field (`tabby-core/src/api/profileProvider.ts`).
- SFTP: yes, as a panel that slides over the SSH tab, opened by an "SFTP" toolbar button (`tabby-ssh/src/components/sshTab.component.pug`). It can follow the remote working directory if shell integration reports it. It is an overlay, not a fixed side pane.
- Local shells: yes. README lists "PowerShell (and PS Core), WSL, Git-Bash, Cygwin, MSYS2, Cmder and CMD support".
- SSH config: read only. `OpenSSHImporter` in `tabby-electron/src/sshImporters.ts` reads `~/.ssh/config` and creates profiles named `<host> (.ssh/config)` in the group `Imported from .ssh/config`. `tabby-ssh/src/profiles.ts` marks them `isBuiltin: true`, so they cannot be edited or moved into folders without duplicating them. Nothing writes the file. Open issues include #7110 (no `Include` support, 2022) and #9601 (2024).
- Keychain: yes. `tabby-ssh/src/services/passwordStorage.service.ts` saves, loads and deletes SSH passwords and key passphrases with `keytar` (Windows Credential Manager, macOS Keychain) unless the Tabby vault is on, in which case it uses the vault. Caveat: `keytar` is archived upstream (https://github.com/atom/node-keytar, archived, last push 2022-12-12).
- External password manager: partial. Tabby has an npm plugin system installable from Settings. A third-party plugin `tabby-keepass-ssh` (npm, published 2026-07-21) fills SSH passwords from KeePass via keyboard-interactive auth, which shows a plugin can supply secrets. No TPM plugin exists, so v1 would mean writing and maintaining one in Angular/TypeScript against Tabby's internal services.

## Electerm

Repo: https://github.com/electerm/electerm. MIT licence. Latest release v5.6.10 on 2026-10-15, last push 2026-10-17. Electron. Windows, macOS, Linux and more.

- Saved sessions ("bookmarks"), tabs, nested bookmark groups (`src/client/components/tree-list/`): yes.
- SFTP: yes, with a terminal and SFTP split view (`sshSftpSplitView` in `src/client/components/session/session.jsx`) and an option for the SFTP path to follow the SSH path (`sftpPathFollowSsh`).
- Local shells: yes (local terminal).
- SSH config: one-time import. `src/app/lib/ssh-config.js` loads the file with `ssh-config-loader`, and `load-ssh-configs.jsx` copies the chosen hosts into Electerm bookmarks (`store.addSshConfigs`). Later edits to the file do not flow in, and nothing writes the file.
- Keychain: partial. Passwords live in Electerm's own database. `src/app/lib/safe-storage.js` encrypts them with Electron `safeStorage` (Keychain key on macOS, DPAPI on Windows). The OS protects the key, but the secrets are not keychain entries that other tools can read or that the user manages in Keychain Access or Credential Manager.
- External password manager: no. Widgets load only from the app's own `src/app/widgets` folder (`load-widget.js`), so there is no outside plugin point. TPM would need a fork.

## XPipe (Community plan)

Repo: https://github.com/xpipe-io/xpipe. Open core: the repo is Apache-2.0, plan features and the shell library are closed source (README "open core model"). Latest release 24.7.1 on 2026-10-19. Windows, macOS, Linux.

- Saved sessions: yes. Pricing page lists "Unlimited connections" for Community, which it calls "A connection power-tool for your personal use cases". The page says "SSH connections are fully supported in the community plan", with some advanced auth methods held back (https://xpipe.io/pricing).
- Folder tree: yes, "hierarchical categories" (README).
- Terminal and tabs: partial. XPipe has no terminal emulator of its own. It "Launches you into a shell session in your favourite terminal" (README). XPipe 21 (2026-02-09) added docked terminals inside the XPipe window on Windows only (https://xpipe.io/blog/xpipe-21-released). On macOS the terminal is a separate app window.
- SFTP: partial. XPipe has a tabbed file browser, but it is its own view, not a pane beside a terminal tab.
- Local shells: partial, through the external terminal.
- SSH config: read live. "this is not an import functionality where the config data is converted to internal data", and changes "will be reflected in XPipe upon refresh". Wildcards and `Include` work (https://docs.xpipe.io/guide/ssh). The docs do not describe writing the file. Connections made in XPipe are stored in XPipe's vault.
- Keychain: partial. Windows Credential Manager (Generic Credentials) is a supported password manager. macOS Keychain is not on the list. The docs describe retrieval only: secrets "are only queried at runtime" (https://docs.xpipe.io/guide/password-manager).
- External password manager: partial. It supports 1Password, KeePassXC, Bitwarden, Keeper, Proton Pass, Passbolt and others, plus "the option of specifying a custom command to run to retrieve credentials". A TPM script could plug in there, but read only, and the command cannot prompt interactively. Pricing lists "Password authentication, including retrieval from password managers" as available. Whether work use counts as "personal use cases" is not settled by the page.

## WindTerm

Repo: https://github.com/kingToolbox/WindTerm. README: "Completely FREE for commercial and non-commercial use", released source under Apache-2.0, but "a partial open source project". Latest release 2.7.0 on 2025-03-11, the same as the last push. The previous release was 2.6.0 on 2024-01-23. Issues are still filed (latest 2026-10-17), so it has users, but releases are slow.

- Session tree, tabs, SFTP pane ("Integrated sftp, scp client", "Explorer Pane"), local shells (cmd, PowerShell, bash, zsh): yes (README).
- SSH config: one-time "Import OpenSSH Session". Issue #2508 (2024-08-22) says it "does not support incremental updates". #2222 asks how to re-import. #2530 asks for `Include`. All open. No write-back.
- Keychain: no. Credentials sit in WindTerm's own profile, with "Enhanced protection of the session username and password" (README). There are no keychain issues on the tracker.
- External password manager: no plugin system.

## WezTerm

Repo: https://github.com/wezterm/wezterm. MIT licence (`LICENSE.md`). Latest stable release `20240203-110809-5046fc22` on 2024-02-03. The nightly build was updated 2026-10-19, so development continues without stable releases.

- Tabs, local shells: yes.
- SSH config: yes for reading. `wezterm.default_ssh_domains()` "Computes a list of SshDomain objects based on the set of hosts discovered in your `~/.ssh/config`" (since 20230408). No write.
- No session tree GUI, no SFTP browser, no keychain storage, no password manager hook. It is a terminal emulator with Lua config, not a session manager.

## Termius (free Starter plan)

Proprietary. https://termius.com/pricing.

- Free includes "SSH and SFTP" and a "Local vault". Sync and the cloud vault are Pro ($10/month billed annually). The page does not state a host limit for free.
- SSH config: one-way import into the Termius vault. ProxyCommand entries are ignored (https://docs.termius.com/getting-started/import-existing-hosts/).
- Secrets live in the Termius vault. No OS keychain storage and no external password manager hook are documented.

## Others ruled out quickly

- Royal TSX / Royal TS: the free Lite edition is capped at "Up to 10 connections" and "1 document" (https://www.royalapps.com/ts/mac/features). Fails unlimited Saved sessions.
- MobaXterm: Windows only, so it fails the macOS need. It is the tool v1 replaces.
- Termora (https://github.com/TermoraDev/termora): AGPL-3.0 or commercial dual licence, Kotlin/JVM, SSH, SFTP and local terminal. Last release 1.0.17 on 2025-06-17. Its README mentions neither SSH config sync nor keychain nor password manager integration, so it fails the same needs as WindTerm. Not checked in depth.

## What this means for the build-or-adopt decision

- Adopting Tabby means giving up SSH config as the source of truth (it would be a read-only import) and writing a TPM plugin against Tabby's Angular internals.
- Adopting XPipe means giving up a built-in terminal on macOS and accepting a read-only TPM hook and an open-core licence.
- Every candidate keeps Saved sessions in its own store. The "sessions live in `~/.ssh/config` plus a Sidecar file" design is the part no existing tool offers.
