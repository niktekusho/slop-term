# Spec: slop-term v1

Label: ready-for-agent
Status: open
Map: [slop-term v1](map.md)

Every decision here comes from a resolved ticket on the map. Where a later ticket corrected an earlier one, this spec states the corrected version only. Terms follow `GLOSSARY.md`.

## Problem Statement

The user manages many SSH hosts from Windows and macOS and wants one GUI client for both. MobaXterm runs only on Windows. Its Saved sessions live in its own store, which plain `ssh`, `scp` and VS Code Remote-SSH can't read. Its passwords can't come from the user's password managers (Team Password Manager at work, KeePass files edited in KeeWeb). No free tool fills the gap. Tabby comes closest, but its SFTP browser is an overlay rather than a pane, and reading TPM would need a plugin. Electerm would need a fork for TPM. XPipe's file browser is a separate view, and on macOS its terminals are separate apps. None of them writes Saved sessions back to the standard SSH config.

The user wants a tool where:

- Saved sessions are standard OpenSSH config, so every other SSH tool sees them.
- The SFTP pane sits in the same window as the terminal and follows the terminal's folder, as in MobaXterm.
- Secrets come from the OS keychain, TPM or a KeePass file, and are never stored by the app.
- Local shells (PowerShell, cmd, WSL, zsh, bash) open in Tabs next to SSH Tabs.
- The existing MobaXterm sessions can be imported once.
- The same files sync between machines with a tool the user already uses.

## Solution

slop-term is a personal Electron desktop app for Windows and macOS. One window holds a Session tree on the left, the active Tab's terminal in the middle and its SFTP pane on the right. There is no Tab strip: each open Tab is listed in the tree under the Saved session it came from.

SSH Saved sessions live in `~/.ssh/slop-term.conf` (the Managed config), which `~/.ssh/config` includes, so `ssh <alias>` in any shell reaches the same host. Folders, Credential references, Session colours and Local shell sessions live in `~/.ssh/slop-term.json` (the Sidecar file). Only those two files sync. Hand-written hosts in the user's own `~/.ssh/config` open read-only and can be moved in with one click.

Secrets come from three Credential providers: the OS keychain, TPM (read-only) and KeePass databases the app reads and writes directly. The app reads the secret on every connect and asks the user only when there is no reference or a read or login fails.

The SFTP pane browses over the Tab's own connection and transfers over a second one. It follows the terminal's folder through OSC 7. In a local shell Tab it also opens for an `ssh <host>` the user types, by detecting the `ssh` child process and resolving its arguments with `ssh -G`.

A one-time MobaXterm import shows a preview of every session before writing anything.

## User Stories

### Saved sessions and storage

1. As the user, I want my SSH Saved sessions stored as standard OpenSSH `Host` blocks, so that `ssh`, `scp`, `sftp` and VS Code Remote-SSH reach the same hosts by alias.
2. As the user, I want the app to own a separate `~/.ssh/slop-term.conf` included at the top of `~/.ssh/config`, so that the app never rewrites my own config.
3. As the user, I want the include line added once and nothing else in `~/.ssh/config` changed except a commented-out moved host, so that I can trust the app with my config.
4. As the user, I want folders, Credential references, Session colours and Local shell sessions kept in `~/.ssh/slop-term.json`, so that OpenSSH config stays plain.
5. As the user, I want only `slop-term.conf` and `slop-term.json` to sync, so that `~/.ssh/config`, `known_hosts` and per-machine settings stay per machine.
6. As the user, I want key paths written as `~/.ssh/<name>`, so that one synced config works on Windows and macOS.
7. As the user, I want the app to re-read a file before every write and stop with a conflict if the host it is changing changed underneath it, so that no edit from another machine or editor is lost.
8. As the user, I want the tree to reload when `slop-term.conf`, `slop-term.json` or `~/.ssh/config` change on disk, so that a sync from my other machine shows up straight away.
9. As the user, I want `Include` files followed and `Match` blocks warned about, so that the tree reflects what OpenSSH will do.
10. As the user, I want pattern entries such as `Host *` hidden from the tree but applied when connecting, so that defaults keep working.
11. As the user, I want unlimited Saved sessions, so that every host I manage fits.
12. As the user, I want a Sidecar entry whose host I renamed or deleted by hand to be ignored but kept, so that nothing disappears silently.
13. As the user, I want a Managed host with no Sidecar entry to sit at the tree root, so that hosts I add by hand to `slop-term.conf` still show.

### Hand-written hosts

14. As the user, I want hosts from my own `~/.ssh/config` listed in the Unsaved group with a lock icon, so that I can open them without the app touching them.
15. As the user, I want Hand-written hosts to be fully read-only, with only Open Tab and "Move into slop-term" in their menu, so that the app never edits my file except by an explicit move.
16. As the user, I want "Move into slop-term" to copy the host into the Managed config and, after I confirm, comment out the original with a `# moved to slop-term.conf` marker, so that nothing is deleted.
17. As the user, I want a warning icon on a Managed host whose alias is also defined in this machine's `~/.ssh/config`, with "Comment out the copy in ~/.ssh/config" in its menu, so that I can clean up after moving a host on another machine.

### Creating and editing SSH Saved sessions

18. As the user, I want a "New" button beside the tree filter that offers SSH session, Local shell session and Folder in the selected row's folder, so that I can add things where I'm looking.
19. As the user, I want an SSH dialog with rows for Alias, Folder and Colour, then the connection as an editable `ssh -p [Port] -i [IdentityFile] [User]@[HostName]` line, so that I learn the `ssh` flags while I fill in the fields.
20. As the user, I want each empty part of the command line to show in grey the value `ssh -G` would use, so that I know what an empty field means.
21. As the user, I want every other option of the host block as one `-o Key value` row with a short description, so that I can see and edit options I don't know by heart.
22. As the user, I want a line the app can't parse, or a `ProxyJump` line, to show its problem under its row, so that I fix it before saving.
23. As the user, I want new SSH Saved sessions to start with `ServerAliveInterval 15`, so that Tabs and typed `ssh` both keep idle connections alive.
24. As the user, I want the alias lowercased as I type, checked against legal characters and against every Managed host, Hand-written host and Local shell session ignoring case, and shown as "Free" or its problem, so that I never create an alias that breaks `ssh`.
25. As the user, I want a Test button that resolves the form's unsaved values with `ssh -G`, connects, checks the host key, logs in and opens SFTP, with a checklist showing each step, so that I know a Saved session works before saving it.
26. As the user, I want Duplicate to open the New form with every field copied and the alias set to `<alias>-2` or the next free number, so that similar hosts are quick to add.
27. As the user, I want editing a Saved session to leave open Tabs connected and apply the new values on the next connect, so that an edit never cuts me off.
28. As the user, I want a rename or move to carry open Tabs along, so that the tree stays consistent.
29. As the user, I want to delete a Saved session with open Tabs and have those Tabs stay open in the Unsaved group under the old alias, so that I don't lose a running session.

### Folders and moving

30. As the user, I want folders nested to any depth, so that I can mirror how I group hosts.
31. As the user, I want empty folders kept, so that a structure I set up survives before I fill it.
32. As the user, I want folder names that are any text without `/`, unique among siblings ignoring case, so that the tree stays unambiguous.
33. As the user, I want New folder and Rename to edit inline in the tree, with Enter or blur committing, Esc cancelling and a red border on an invalid name, so that renaming is fast.
34. As the user, I want deleting a non-empty folder to confirm with a count of its subfolders and Saved sessions, with Cancel focused, so that I can't delete a whole branch by accident.
35. As the user, I want an empty folder deleted without asking, so that cleanup is quick.
36. As the user, I want to move sessions and folders by drag and drop, by a Move to… picker with a filter box (F7), and by the folder field in the dialog, so that I can move with the mouse or the keyboard.
37. As the user, I want the Move to… picker to refuse moving a folder into itself or its subfolders, so that the tree can't break.
38. As the user, I want Enter, F2, Delete and F7 to open, edit, delete and move while the tree has focus, and the right-click menus to show those keys, so that I learn them.

### Local shells

39. As the user, I want Local shell sessions in the same tree, folders and filter as SSH sessions, sorted with them A to Z, so that a container shell sits next to the host it runs on.
40. As the user, I want a Local shell session to store a name, folder, shell kind (`pwsh`, `powershell`, `cmd`, `wsl`, `zsh`, `bash`), WSL distro, optional start folder, optional command and Session colour, so that one click opens exactly the shell I need.
41. As the user, I want a smaller Local shell dialog that shows the launch line, such as "Starts `wsl -d Ubuntu --cd ~/src`", so that I can see what will run.
42. As the user, I want a session's command to run through its shell, so that `docker exec -it <container> bash` gives me a container shell with no Docker feature in the app.
43. As the user, I want "New local shell" to list the shells this machine has (PowerShell 7 or Windows PowerShell, cmd, each WSL distro except `docker-desktop*`, zsh and bash on macOS) and open an unsaved Tab, so that I can get a shell without creating a Saved session.
44. As the user, I want unsaved Tabs listed in an "Unsaved" group at the top of the tree, labelled by shell, with a Save action that asks for a name and folder, so that I can keep a shell I liked.
45. As the user, I want a Local shell session whose shell or distro this machine lacks to show dimmed with `n/a` and refuse to open, while still being editable, movable and renamable, so that synced sessions from my other machine don't get in the way.

### Tabs and terminal

46. As the user, I want each open Tab listed in the tree under its Saved session, with no Tab strip, so that I see which host each Tab belongs to.
47. As the user, I want a Tab row to show the last folder from OSC 7 and then the terminal title, with the title hidden when it only names the shell, so that sibling Tabs are told apart by where they are.
48. As the user, I want Tabs 1 to 9 to show a keycap with their number, so that I know which shortcut jumps to each.
49. As the user, I want a `+` on hover and double-click on a Saved session to open another Tab, so that several Tabs of one host are one click away.
50. As the user, I want a header bar across the terminal and SFTP pane showing the session name and `user@host` or "local shell", so that I always know where I'm typing.
51. As the user, I want the terminal to keep 1,000 lines of scrollback by default, so that memory stays modest.
52. As the user, I want find in scrollback, so that I can locate earlier output.
53. As the user, I want selecting text to copy and right-click to paste, as in MobaXterm, so that my muscle memory still works.
54. As the user, I want pasting text with any line break to always ask "Paste N lines? Each line may run as a command.", so that I never run a pasted command by accident.
55. As the user, I want closing a Tab to ask only when it has queued uploads or a file open for editor sync, so that closing is usually instant.
56. As the user, I want a shell that exits with code 0 in a session with no command to close its Tab, and any other exit to keep the Tab with "process exited with code N" and R to restart, so that a failure stays visible.

### Keyboard shortcuts

57. As the user, I want every plain Ctrl+letter to reach the shell, with app shortcuts on Ctrl+Shift on Windows and Cmd on macOS, so that the shell's own keys always work.
58. As the user on an Italian keyboard, I want Tab-number shortcuts to read the physical digit key and zoom to accept both `+` and `=`, so that the shortcuts work on my layout.
59. As the user, I want next and previous Tab to cycle in tree order, so that the order matches what I see.
60. As the user, I want Ctrl+Shift+O / Cmd+Shift+O to focus the tree filter and open a Saved session by name, so that I reach any host without the mouse.

### Look and settings

61. As the user, I want the app and terminal to follow the OS light or dark mode, with a `settings.json` override, so that the app matches my desktop.
62. As the user, I want GitHub Dark and GitHub Light terminal palettes and a bundled JetBrains Mono font, so that the terminal looks the same on both machines.
63. As the user, I want a minimum contrast of 7 in dark mode and 4.5 in light mode, so that every colour stays readable.
64. As the user, I want zoom to apply to the whole window and save the new size, so that my preferred size sticks.
65. As the user, I want per-machine settings in one `settings.json` that Ctrl+, / Cmd+, opens in my editor and the app applies on save, so that I don't need a settings dialog.
66. As the user, I want to give a Saved session a Session colour from eight named colours, so that I spot production hosts at a glance.
67. As the user, I want a coloured Tab to fill the header bar with its colour and tint the terminal and SFTP pane backgrounds by 10%, adjustable with `sessionColourTint`, so that I can't miss which host I'm on.
68. As the user, I want a Session colour dot on the Saved session's tree row only, so that the tree stays calm.
69. As the user, I want a local shell Tab running a detected `ssh` to show the Session colour of the Saved session the alias matches, so that a typed `ssh prod` still looks dangerous.

### Credential providers

70. As the user, I want a Saved session to point at a secret in a Credential provider instead of storing it, so that synced files never hold secrets.
71. As the user, I want the app to read the secret on every connect and never cache provider secrets, so that a changed password takes effect at once.
72. As the user, I want to connect without being asked when the reference reads fine, so that most connects are one click.
73. As the user, I want to be asked on connect when there's no reference, with "Save to: keychain / KeePass / don't save" and keychain as default, so that saving is the easy path.
74. As the user, I want a failed read to show the reason and ask, offering to save under the same reference for the keychain, so that a missing entry on this machine is easy to fix.
75. As the user, I want a failed login with a saved secret to ask again with an "Update saved secret" checkbox, and for TPM to tell me to update the entry in TPM instead, so that I can recover from a changed password.
76. As the user, I want a provider that refuses a write to say why in one line where I tried to save, and still use what I typed for this connection, so that a refusal never blocks me.
77. As the user, I want "Set secret…", "Attach existing…" (KeePass search, TPM id or search, "Same secret as…") and "Remove" on the Secret row, so that I can manage references from the dialog.
78. As the user, I want several Saved sessions to share one entry, so that one password change covers every host that uses it.
79. As the user, I want deleting the last Saved session that points at a keychain or KeePass entry to offer an unticked "Also delete the saved secret" checkbox, so that secrets are deleted only when I say so.
80. As the user, I want the app never to delete a TPM entry, so that the work vault is safe from my client.

### Team Password Manager

81. As the user, I want to attach a TPM entry by pasting its URL or numeric id, with a test read, so that work hosts read their passwords from TPM.
82. As the user, I want a TPM search box, so that I don't need the entry id (lower priority, after paste).
83. As the user, I want the app to ask for my TPM HMAC keys the first time it needs them and again after a 401, and keep them in the OS keychain, so that I set TPM up once per machine.
84. As the user, I want the TPM base URL in per-machine settings, and a synced TPM reference on a machine without TPM to fail with "TPM isn't set up on this machine" and ask, so that my personal machine works without TPM.
85. As the user, I want attaching a TPM entry to copy its username into `User`, and a later mismatch to block the connect with "TPM entry says `bob`, this Saved session says `alice`" and a "Use `bob`" button, so that I never send a password to the wrong account.
86. As the user, I want TPM to refuse every write and delete with "TPM is read-only in slop-term", so that v1 can't change the work vault.

### KeePass

87. As the user, I want to list KeePass databases by name and path in per-machine settings, so that each machine opens only the databases it has.
88. As the user, I want each database to ask for its master password once per app run, the first time a reference needs it, so that I unlock only when needed.
89. As the user, I want unlocked databases to lock on quit, sleep, screen lock or "Lock KeePass", so that an unattended machine doesn't leave my vault open.
90. As the user, I want the app to reload a database when its file changes, so that edits from KeeWeb and OneDrive show up.
91. As the user, I want "Update saved secret" to keep the old password in the entry's history, and new entries to go in a group I pick (preselected by the folder name) with title, username and URL filled in, so that my KeePass file stays tidy.
92. As the user, I want writes to reload, apply, write a temp file and rename it over the database, so that KeeWeb merges the change and a crash can't corrupt the file.
93. As the user, I want to attach an entry by searching title, username, URL and group across unlocked databases, with an "Unlock `<name>`" row per locked one, so that I find entries without their ids.
94. As the user, I want the same username check for KeePass as for TPM, so that both providers protect me the same way.
95. As the user, I want a database that needs a key file to fail with "Key files aren't supported yet", so that I know why it won't open.

### Host keys

96. As the user, I want the app to read and write OpenSSH's `known_hosts`, so that the app and my terminal `ssh` agree on every host.
97. As the user, I want an unknown host to ask once inside the Tab with alias, `host:port`, key type and SHA256 fingerprint, with Cancel as default, so that I verify keys the OpenSSH way.
98. As the user, I want a changed key to block with old and new fingerprints and the file and line of the old key, and "Replace saved key" behind a confirm, so that a man-in-the-middle can't slip through.
99. As the user, I want `StrictHostKeyChecking accept-new` and `no` to skip the question for unknown hosts, but a changed key to block always, so that convenience never overrides safety.
100. As the user, I want the SFTP pane's transfer connection and reconnects to require the key the Tab accepted, so that I'm asked at most once per host.

### Disconnect and reconnect

101. As the user, I want keepalives to follow `ServerAliveInterval` and `ServerAliveCountMax` from `ssh -G`, with 15 s and 3 when unset, so that a dead connection shows within about 45 s.
102. As the user, I want every SSH Tab to send a keepalive when the OS wakes, so that dead Tabs show as dropped within seconds.
103. As the user, I want a dropped Tab to print `Connection lost (reason) at 14:32. Press R to reconnect` and keep its scrollback, with keys other than R doing nothing, so that a stray Enter can't lose my output.
104. As the user, I want a reconnect to continue below a `── reconnected 14:35 ──` line in the same terminal, so that old output stays above.
105. As the user, I want reconnect to be manual by R or a button, with "Reconnect all disconnected Tabs" in the tree menu, so that I decide when to reconnect.
106. As the user, I want a dropped Tab dimmed in the tree with a red broken-link icon, so that I see it without opening it.
107. As the user, I want a reconnect to read the Saved session and secret afresh, and to say "This Saved session no longer exists" if it was deleted, so that edits take effect.

### SFTP pane

108. As the user, I want the SFTP pane beside the terminal in the same window, collapsible for the whole window to a 30 px strip, so that files and shell share one view.
109. As the user, I want the pane to browse over the Tab's connection and transfer over a second one that closes after 5 idle minutes, so that a big upload doesn't make typing lag.
110. As the user, I want transfers on hosts with 2FA or other keyboard-interactive prompts to run on the Tab's connection, so that I'm never prompted twice.
111. As the user, I want a password I typed to stay in memory for the Tab's lifetime, so that the transfer connection logs in without asking.
112. As the user, I want the pane to follow the terminal's folder through OSC 7, with a "Follow terminal" toggle, so that the files I see match where I am.
113. As the user, I want the pane to stay on its host and say "Terminal is on db1. This pane shows web1." when I `ssh` onward from the remote, so that I don't act on the wrong host's files.
114. As the user, I want Name, Size, Modified and Permissions columns, sortable, folders first, with `ls`-like colours and hidden files shown dimmed, so that the listing reads like my terminal.
115. As the user, I want up, a path box, refresh and a hidden-files toggle in the toolbar, so that I can navigate without the terminal.
116. As the user, I want Open, Download, Download to…, Rename and Delete in a right-click menu, and New folder, Upload files…, Refresh and Select all on empty space, so that every action is in one place.
117. As the user, I want Enter, F2, Delete, Backspace, Ctrl+A and F5 to act only while the file list has focus, with a floating hint bar while rows are selected, so that the shell keeps its keys.
118. As the user, I want deletes to confirm with item names, file and byte counts for folders, and a note that SFTP has no trash, so that I don't delete blindly.
119. As the user, I want files dragged in from the OS to upload, with a "Drop to upload to <path>" overlay, so that uploading is one gesture.
120. As the user, I want one transfer queue per Tab with progress, speed, cancel and retry in a list docked at the bottom of the pane, so that I can watch and recover transfers.
121. As the user, I want a conflict dialog comparing size and modified time with Overwrite, Skip, Keep both and "Apply to the other N conflicts", so that batch uploads don't stop at every file.
122. As the user, I want downloads to go to the last folder used, with a "Saved to <folder>" link that reveals the file, so that I can find what I downloaded.
123. As the user, I want double-click to open a file in my configured editor (else `code`, else Notepad++, else the OS default) and upload it on save, so that I edit remote files with my own editor.
124. As the user, I want editor-sync uploads to check that the remote file didn't change since I opened it, so that I don't overwrite someone else's edit.
125. As the user, I want a dropped Tab's pane to grey out, fail running transfers as retryable and hold editor saves as "waiting for connection", so that nothing is lost across a drop.
126. As the user, I want unsent editor-sync copies listed at startup after a crash, so that I can recover my edits.

### SFTP pane for typed `ssh`

127. As the user, I want typing `ssh <host>` in a PowerShell, cmd, zsh or bash Tab to give that Tab an SFTP pane for the same host, so that local shells work like MobaXterm.
128. As the user, I want the pane to resolve the host with `ssh -G` and the same `ssh` executable, so that it reaches exactly what the terminal reached.
129. As the user, I want the pane to connect on its own after the first OSC 7 from the remote shell, and otherwise show a "Browse files on alice@web1" button, so that it never races the terminal's host-key prompt.
130. As the user, I want the pane to log in with the matching Saved session's reference, then the agent, then `IdentityFile` keys, then a prompt, so that it asks only when it must.
131. As the user, I want the pane's password prompt to offer "Save to" with an alias field and folder dropdown, and saving to create a Managed Saved session from the `ssh -G` values, so that an ad-hoc host becomes a Saved session in one step.
132. As the user, I want a later `ssh` to find that Saved session by alias and user, then by resolved host, port and user, so that `ssh bob@web1` finds `bob-web1`.
133. As the user, I want a typed `ssh` to a Hand-written host to say "Move web1 into slop-term to save its password", so that I know how to save it.
134. As the user, I want a "Browse files of..." picker over SSH Saved sessions in every local shell Tab, so that WSL Tabs and `ssh` inside scripts or `tmux` still get a pane.
135. As the user, I want the pane to close its connections and drop the typed secret when `ssh` exits, so that nothing lingers.
136. As the user, I want the pane's own connection to drop and reconnect separately from the terminal's `ssh`, so that one failing doesn't hide the other.

### Jump hosts

137. As the user, I want a Saved session that resolves to `ProxyJump` or `ProxyCommand` to fail with "This host uses a jump host. slop-term v1 can't connect to it.", so that the app never connects some other way than I configured.

### MobaXterm import

138. As the user, I want to import from `MobaXterm.ini` or a `.mxtsessions` file, with the picker prefilled from MobaXterm's usual folders, so that I find my sessions quickly.
139. As the user, I want a preview with a checkbox and problems per row, writing nothing until I confirm, so that I control what comes in.
140. As the user, I want aliases slugified from session names and editable in the preview, checked as I type, so that "Web Prod 01" becomes `web-prod-01` or what I choose.
141. As the user, I want rows whose alias exists, or whose host, port, user and key match an existing host, to start unticked, so that a second import adds nothing.
142. As the user, I want MobaXterm folders to become nested Sidecar folders, reusing existing ones, so that my structure carries over.
143. As the user, I want key paths translated to `~/...`, `.ppk` keys flagged with PuTTYgen steps, and jump hosts and login commands dropped and listed, so that I know what needs manual work.
144. As the user, I want WSL sessions imported as `wsl` Local shell sessions and other non-SSH types skipped and listed, so that the import is complete and honest.
145. As the user, I want MobaXterm tab colours mapped to the nearest Session colour in the preview, so that my red production hosts stay red.

### Profiling

146. As the user, I want `npm run start:profile` to open inspectors on the main and back-end processes, so that I can profile from the first build.
147. As the user, I want a profiling panel under the terminal (Ctrl+Shift+M / Cmd+Shift+M) listing CPU and memory per process every 2 seconds, with a button that records a Chrome trace to a file, so that I can see where memory goes.

## Implementation Decisions

### Stack and processes

- Electron 44, React and TypeScript, built with Electron Forge (Vite + TypeScript template, Forge version pinned) and npm.
- Terminal: xterm.js 6 (`@xterm/xterm`) with the `fit`, `search` and `webgl` 0.19.0 addons. The DOM renderer is the fallback when WebGL fails.
- SSH and SFTP: `ssh2` 1.17.0. `chacha20-poly1305` is unavailable under Electron's BoringSSL; AES-GCM and AES-CTR work.
- Local shells: `node-pty` 1.2.0-beta.15, pinned exactly (1.1.0 ships the macOS `spawn-helper` without the execute bit). ConPTY on Windows. The beta works on Windows 11 and macOS 15, in tests and in a packaged app.
- SSH config parsing: `ssh-config` 5.3.0. It doesn't follow `Include`, so the app does. Losing spacing before end-of-line comments in the Managed config is accepted.
- Keychain: `@napi-rs/keyring`, service `slop-term`. No plain-text fallback.
- KeePass: `kdbxweb` 2.1.1 with `hash-wasm` for Argon2. `@xmldom/xmldom` is pinned to 0.8.15 with npm `overrides`.
- Processes: the whole back end (`ssh2`, `node-pty`, providers, config files, process detection) runs in one Electron `utilityProcess`. The main process manages the window, relays messages and serves the profiling panel, whose Electron APIs exist only there. The UI talks to the back end only by IPC messages, so a later native back end could replace it. No worker threads for `node-pty`.
- One window. Tabs never open new windows.
- Distribution: no installer, no auto-update, no telemetry. The user runs `npm run package` on each machine.

### Modules

The back end splits into deep modules behind one IPC contract:

- **Config store**: reads and writes the Managed config, the Sidecar file and the one line edit in `~/.ssh/config`. Owns re-read-before-write, conflict detection, file watching, `Include` following and the merged tree model (Managed hosts, Local shell sessions, folders, Hand-written hosts).
- **Resolver**: runs `ssh -G` (the `ssh` on PATH, or the executable a typed `ssh` came from) with an alias, typed arguments or unsaved `-o` values, and returns the resolved options. Used for connect, Test, jump-host detection, keepalive values, host key names and grey placeholders in the dialog.
- **Credential providers**: keychain, TPM and KeePass behind one interface (below).
- **Host keys**: reads and writes `known_hosts` (or `UserKnownHostsFile`), hashed and plain, and keeps the key accepted per Tab in memory.
- **Sessions**: opens SSH and local shell Tabs, runs keepalives and wake checks, reports drops and exits, and reconnects.
- **SFTP**: browsing channel, transfer connection, per-Tab transfer queue, editor sync and its temp folder.
- **Typed-ssh detector**: finds the `ssh` child of a local shell after Enter, tracks its pid and reports start and exit.
- **MobaXterm importer**: parses the INI format into preview rows and applies the confirmed ones through the config store.
- **Settings**: per-machine `settings.json` in the app data folder (`%APPDATA%\slop-term\` on Windows), watched and applied on save.

The UI modules are the Session tree, the terminal view, the SFTP pane, the Saved session dialogs, the import preview, the prompts (secrets, host keys, conflicts) and the profiling panel.

### Files

- `~/.ssh/config`: the app adds `Include ~/.ssh/slop-term.conf` at the top once. OpenSSH scopes an `Include` after a `Host` line to that host, so it must go first. The only other edit is commenting out a moved host with a `# moved to slop-term.conf` marker, as a line edit.
- `~/.ssh/slop-term.conf` (Managed config): one `Host` block per SSH Saved session. A MobaXterm comment becomes a `#` line above its block. Existing comments stay.
- `~/.ssh/slop-term.json` (Sidecar file): a folder list (so empty folders survive); per Managed host alias, its folder, Credential reference and Session colour; a list of Local shell sessions keyed by name, each with folder, shell kind, WSL distro, start folder, command and Session colour. No secrets.
- `settings.json` (per machine, not synced): theme mode, font family and size, `sessionColourTint`, scrollback, editor path, TPM base URL, KeePass databases (name and path), last download folder, last folder used by the typed-ssh save prompt.
- `known_hosts`: OpenSSH's own file, not synced.
- Every write to the Managed config, Sidecar file or KeePass database re-reads the file, applies the change to the fresh copy and stops with a conflict if the item it changes was edited or removed since the last read. Multi-item operations (import, folder delete) write each file once.

### Aliases and names

- Aliases and Local shell session names share one namespace and one rule: lowercase, runs of spaces or illegal characters become `-` when slugifying, `*`, `?`, `!`, `,` and spaces rejected when typing, unique across Managed hosts, Hand-written hosts and Local shell sessions ignoring case.
- A session's kind (SSH or local shell) can't change after creation.

### Credential provider interface

```ts
// From "Credential provider interface", with the KeePass correction.
type CredentialReference = {
  provider: "keychain" | "tpm" | "keepass";
  entry: string; // keychain: app-generated id; tpm: numeric password id; keepass: "<database name>/<32 lowercase hex uuid>"
  kind: "password" | "passphrase";
};

interface CredentialProvider {
  read(ref): Promise<secret>;
  write(ref, secret): Promise<void>;
  delete(ref): Promise<void>;
  // Each can fail or refuse with a reason the user can read.
}
```

- A Saved session has at most one reference. Only Managed hosts and Local shell sessions carry Sidecar data; Hand-written hosts carry none.
- The keychain entry id never equals the alias, so a rename can't orphan a secret.
- Provider secrets are never cached. Exceptions: a password the user typed stays in back-end memory for its Tab's lifetime (or until a typed `ssh` exits), and an unlocked KeePass database stays in memory until quit, sleep, screen lock or "Lock KeePass".
- Ask rules: no reference asks on connect with "Save to"; a reference that reads fine connects; a failed read shows the reason and asks; a failed login asks with "Update saved secret". Keychain is the default on every "Save to".
- Write order when saving from a prompt: the secret first; if the provider refuses, nothing else is written; then the config files; a config conflict keeps the saved secret.
- Deleting the last Saved session pointing at a keychain or KeePass entry shows an unticked "Also delete the saved secret" checkbox, never for TPM and never when another session shares the entry. A KeePass delete moves the entry to the Recycle Bin when the database has one.
- Username check: attaching a TPM or KeePass entry copies its username into `User`; on connect a mismatch blocks with the "Use `bob`" button; an entry with no username skips the check.
- TPM: API v6 over HMAC with the user's keys (stored in the keychain), base URL per machine. Read with `GET index.php/api/v6/passwords/<id>.json`; search with `GET passwords/search/<query>.json`. Every request sends a `Content-Type` header, even a GET. `user_permission` is an object `{id, label}`. Writes and deletes refuse in v1.
- KeePass: master password only. Reload when the file's modified time changes. Writes reload, apply, re-check the modified time, write a temp file next to the database and rename it over. New entries take title = alias, username = `User`, URL = `ssh://<host>`, in a picked group preselected by folder name. "Update saved secret" keeps history. OneDrive conflict copies are not handled.

### Connecting

- Before every SSH connect the app runs `ssh -G <alias>`. `proxyjump` or `proxycommand` other than `none` fails the connect with the jump-host message.
- Keepalive: `ServerAliveInterval` and `ServerAliveCountMax` from `ssh -G` as they are; 15 s and 3 when unset (0 counts as unset). A socket error or close is a drop at once. On OS resume every SSH Tab sends one keepalive.
- Host keys: the name is the resolved `HostName` or `HostKeyAlias`, as `[host]:port` when the port isn't 22. Saved key types go first in `ssh2`'s host key list. `StrictHostKeyChecking accept-new`/`no` save unknown keys silently; `UserKnownHostsFile /dev/null` saves nothing; a changed key always blocks. Hashed entries are written when `HashKnownHosts yes` applies. `@cert-authority` and `@revoked` lines are ignored and kept.
- Reconnect is a connect: it re-reads the Saved session and the secret, reuses a typed password and the Tab's accepted host key, and asks again for keyboard-interactive prompts.
- Exit rule: code 0 in a session with no command closes the Tab; anything else keeps it with "process exited with code N".

### Local shells

- Launch through the shell: `pwsh -Command "<cmd>"`, `wsl -d <distro> --cd <folder> -- <cmd>`, `zsh -lc "<cmd>"` and so on. Empty start folder means home; `~` works everywhere.
- Detection lists PowerShell 7 or Windows PowerShell, cmd, each `wsl -l -q` distro not starting with `docker-desktop` on Windows, and zsh and bash on macOS.

### SFTP pane

- Browsing uses an SFTP channel on the Tab's connection, opened the first time the pane shows for that Tab. Transfers and editor sync use a second connection opened on the first transfer and closed after 5 idle minutes, presenting the Tab's accepted host key. Keyboard-interactive hosts transfer on the Tab's connection.
- OSC 7 sets the pane folder while "Follow terminal" is on. A hostname different from the first one seen stops following with the amber banner until it matches again. In a local shell Tab, OSC 7 counts only while an `ssh` child is detected.
- One transfer queue per Tab, one file at a time. Folders transfer recursively. Conflicts ask Overwrite / Skip / Keep both (` (1)` suffix) with apply-to-all.
- No drag out (Electron's `startDrag` needs the file on disk first). No permission changes in v1.
- Editor sync: download to an app temp folder, open in the configured editor (else `code` on PATH, else `notepad++` on PATH, else `C:\Program Files\Notepad++\notepad++.exe` on Windows, else the OS default), upload on save (default on). Before upload, compare a SHA-256 of a fresh read for files up to 10 MB, else modified time and size; ask if changed. Temp copies are deleted when the Tab closes; at startup unsent copies are listed and the rest deleted.

### Typed `ssh`

- About 0.5 s after Enter in a PowerShell, cmd, zsh or bash Tab, the back end looks for a direct child named `ssh` of the Tab's shell (process query by pid on Windows, `ps` on macOS) and reads its command line. Newest wins. `ssh` under `git` or `scp` doesn't count. While it runs, only its pid is checked.
- The pane resolves with `ssh -G` and the typed arguments, using the same executable, and connects on its own after the first OSC 7 from the remote shell. Before that it shows "Browse files on <user>@<host>".
- Saved session match: alias and resolved user first, then the first session in tree order whose `HostName`, `Port` and `User` equal the resolved values and that has a reference.
- Login order: matched reference, SSH agent, `IdentityFile` keys, a prompt. Save is offered for `password` logins and for `keyboard-interactive` with exactly one hidden prompt in one round. Saving creates a Managed Saved session from the `ssh -G` values plus `ServerAliveInterval 15`, with alias prefilled as the slugified host, or `<user>-<host>` when taken.
- WSL Tabs get only the "Browse files of..." picker, which every local shell Tab keeps.
- No `SSH_ASKPASS`. The app never reads what the user types into `ssh`.

### MobaXterm import

- Source decoded with the system ANSI code page, falling back to Windows-1252. `[Bookmarks]` is the root folder; each `[Bookmarks_N]` is a folder whose `SubRep` splits on `\`. Session line: `name=#icon#type%host%port%user%...#terminal#tab#comment#colour`. SSH (type `0`) fields: host 1, port 2, user 3, key path 14; jump hosts 8–10 and 15; login command 7. A missing field means its default.
- `_ProfileDir_` → `~`, `_CurrentDrive_` → the source file's drive, `\` → `/`; paths in home become `~/...`; other absolute paths are kept and flagged "won't work on macOS". `.ppk` keys are dropped and flagged with PuTTYgen steps.
- Empty user writes no `User` line. X11 is ignored. WSL (type 14) becomes a `wsl` Local shell session with empty distro. Tab colour maps to the nearest Session colour (`255` → Red, `-1` → none). Every imported SSH session gets `ServerAliveInterval 15`.
- Passwords are not imported.

### Look

- Palettes (GitHub Dark / GitHub Light):

  | | GitHub Dark | GitHub Light |
  |---|---|---|
  | Background / foreground | `#0d1117` / `#e6edf3` | `#ffffff` / `#1f2328` |
  | Cursor / selection | `#2f81f7` / `#264f78` | `#0969da` / `#b6d7ff` |
  | Normal | `#484f58 #ff7b72 #3fb950 #d29922 #58a6ff #bc8cff #39c5cf #b1bac4` | `#24292f #cf222e #116329 #4d2d00 #0969da #8250df #1b7c83 #6e7781` |
  | Bright | `#6e7681 #ffa198 #56d364 #e3b341 #79c0ff #d2a8ff #56d4dd #ffffff` | `#57606a #a40e26 #1a7f37 #633c01 #218bff #a475f9 #3192aa #8c959f` |

- Font: JetBrains Mono bundled at weights 500 and 700; `fontWeight: 500`, `fontWeightBold: 700`, `letterSpacing: 0.5`, 12 px. `minimumContrastRatio` 7 dark, 4.5 light, fixed in code.
- Session colours (dark / light): Red `#e5484d`/`#ce2c31`, Orange `#f76b15`/`#c2490c`, Yellow `#f5d90a`/`#946800`, Green `#46a758`/`#2a7e3b`, Blue `#3e8bff`/`#1f5fd6`, Purple `#a06cf0`/`#7a3fc6`, Pink `#e5469f`/`#c0237f`, Grey `#8b8d98`/`#60646c`. Teal and amber are reserved for the SSH and local shell edges.
- A coloured Tab fills the full-width header bar with its shade (black or white text by contrast) and mixes the terminal and pane backgrounds `sessionColourTint` percent (default 10, 0 off) toward it; the contrast floor applies against the tinted background.
- UI chrome uses GitHub Primer colours. Light and dark share every layout.

### Window and tree

- Fixed left tree column with a filter box and the New button. No Tab strip. Header bar across terminal and pane. SFTP pane right of the terminal; its open or collapsed state applies to the whole window. Profiling panel under the terminal.
- Tree rows: one line, 22 px, 14 px indent per level. Saved session rows: 3 px teal (SSH) or amber (local shell) bar, Session colour dot, `+` on hover. Tab rows: OSC 7 folder then title, keycap for Tabs 1–9, dimmed at 60% with a red broken-link icon when dropped, grey exit arrow and `exit N` when exited. Folders: chevron and icon, no colour or count. Unavailable local shells: 45% with `n/a`, no `+`.
- Order: the Unsaved group (unsaved local shell Tabs, then Tabs whose Saved session was deleted, then Hand-written hosts A to Z with locks), then Managed hosts with no Sidecar entry, then folders. Inside a folder: subfolders, then Saved sessions A to Z, kinds mixed. A Tab running a typed `ssh` in the Unsaved group shows `→ <alias>`.

### Shortcuts

| Action | Windows | macOS |
|---|---|---|
| Open a Saved session by name (focus the tree filter) | Ctrl+Shift+O | Cmd+Shift+O |
| New Tab (default local shell, unsaved) | Ctrl+Shift+T | Cmd+T |
| Duplicate active Tab | Ctrl+Shift+D | Cmd+D |
| Close active Tab | Ctrl+Shift+W | Cmd+W |
| Next / previous Tab, in tree order | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab, Cmd+Option+Right / Left |
| Go to the Nth Tab, in tree order | Ctrl+Shift+1–9 (physical digit) | Cmd+1–9 |
| Collapse or open the SFTP pane | Ctrl+Shift+B | Cmd+B |
| Open or close the profiling panel | Ctrl+Shift+M | Cmd+Shift+M |
| Find in scrollback | Ctrl+Shift+F | Cmd+F |
| Copy / paste | Ctrl+Shift+C / Ctrl+Shift+V | Cmd+C / Cmd+V |
| Zoom in / out / reset | Ctrl++ or Ctrl+=, Ctrl+-, Ctrl+0, Ctrl+wheel | Cmd++ or Cmd+=, Cmd+-, Cmd+0, Cmd+wheel |
| Open settings file | Ctrl+, | Cmd+, |

Tree focus: Enter open, F2 edit or rename, Delete delete, F7 move. File list focus: Enter open, F2 rename, Delete (Windows) or Cmd+Backspace (macOS) delete, Backspace up, Ctrl+A / Cmd+A select all, F5 / Cmd+R refresh. Keys are fixed in code.

### Saved session dialogs

- SSH dialog (~780 px): Alias, Folder, Colour rows; a Connect row with `ssh -p [Port] -i [IdentityFile] […] [User]@[HostName]` as inline inputs with `ssh -G` placeholders, and the note "Typing `ssh <alias>` in a shell runs this command."; one `-o` row per other option with a shipped one-line description and a remove button, plus "+ option"; the Secret row; the Test checklist. Footer: Test left, Cancel and Save right.
- Test resolves the unsaved values with `ssh -G` and `-o` per field and option, then connects with the host key checks (unknown host asks inside the step), logs in with the form's reference or a test-only password, opens SFTP and disconnects. Checklist steps: resolved, reached `host:port`, host key, logged in as `<user>`, SFTP. The first failure shows its reason; the TPM/KeePass username check shows here too.
- Local shell dialog (~460 px): Name, Shell, WSL distro (WSL only), Start folder, Command with the launch-line note, Folder, Colour. No Test. A missing shell shows "(not on this machine)" with a warning.
- "Set secret…" is a popover with a Password / Key passphrase switch (passphrase when a key file is set) and "Save to", keychain first; it creates the entry on Save. "Attach existing…" is a popover with KeePass, TPM and "Same secret as…" tabs over a search box.
- Delete confirms count subfolders, Saved sessions and open Tabs, offer the unticked secret checkbox, say when a shared secret or a TPM entry stays, focus Cancel and colour Delete red.

### Prototypes

The look decisions came from prototypes on unmerged local branches; they are the visual reference for the build: `prototype/main-window-layout` (d0c0ad1), `prototype/terminal-look` (41f56ef), `prototype/session-tree-look` (e94e570), `prototype/sftp-pane-look` (f01c13e), `prototype/saved-session-dialog-look` (b9810e6).

## Testing Decisions

- A good test drives a seam with inputs the user's actions produce and checks outputs the user would see or files they would find on disk. It never reaches into module internals, so a module can be rewritten without touching its tests.
- **Seam 1: the back-end IPC contract.** Tests start the back end as the app does and talk to it only with IPC messages. Each test gets:
  - a temp home folder holding `.ssh/config`, `slop-term.conf`, `slop-term.json`, `known_hosts`, `settings.json` and key files;
  - a local OpenSSH server in Docker, configured per scenario (key login, password login, keyboard-interactive, changed host key, a dropped connection for keepalive tests);
  - a fake TPM HTTP server that checks HMAC signatures and the `Content-Type` header and serves fixed entries;
  - `.kdbx` fixture files created with `kdbxweb`;
  - a keychain provider pointed at a test-only service name.
- Seam 1 covers the config store (round-trips, conflicts, include line, moving a Hand-written host), the resolver, every Credential provider rule, host key handling, connect, keepalive, drop and reconnect, SFTP browsing, transfers, conflicts and editor-sync checks, local shell launch and exit rules, typed-`ssh` detection and matching, and the MobaXterm import against fixture INI files (including the user's real file shape: 19 SSH sessions, 1 WSL, 7 folders, 1 `.ppk`, 4 matches against existing hosts).
- **Seam 2: the React UI against a fake back end.** Tests render the UI with a fake that speaks the same IPC contract, then act as the user (click, type, press shortcuts) and check what renders and which messages the UI sends. This covers the tree order and rows, shortcuts and focus rules, the dialogs and their validation, prompts, the SFTP pane states (dropped, chained `ssh`, collapsed) and paste confirmation.
- The IPC contract is typed in one shared module that both the back end and the fake implement, so the two seams can't drift apart.
- Platform-specific behaviour (ConPTY, `ps` vs Windows process queries, the macOS `spawn-helper`, keychain prompts after a rebuild, a packaged build) is checked by running the Seam 1 suite on both a Windows and a macOS machine. The first build task runs the stack test scripts from "Choose the stack" on both.
- There is no prior art in the repo: it holds only this spec, the map and its research.

## Out of Scope

- SSH tunnels and port forwarding.
- Jump hosts and `ProxyJump`/`ProxyCommand` chaining.
- A built-in X11 server.
- RDP, VNC, Telnet and serial connections.
- Multi-exec (typing into several Tabs at once).
- Plugin loading for Credential providers. Adding a provider is a code change.
- A sync server. File sync is the user's own tool.
- Installers, auto-update, telemetry and onboarding.
- Handing macOS terminals to iTerm2.
- Creating Saved sessions from TPM entries.
- Showing or copying a secret inside the app.
- Writing secrets to TPM.
- A native Rust rewrite. The IPC-only back end keeps it possible after v1.
- Built-in Docker integration. A Local shell session running `docker exec` covers it.
- rsync transfers.
- Smart Ctrl+C. The user wants it as an option after v1.
- Syncing KeePass groups with the app's folders.
- KeePass key files and YubiKey.
- Setting up key login (creating a key and adding it to `authorized_keys`).
- `SSH_ASKPASS` capture of passwords typed into the terminal's `ssh`.
- Changing file permissions in the SFTP pane, dragging files out of it, and switching the pane to a chained `ssh` host.
- A settings dialog, configurable shortcuts, theme pickers and a configurable list of default options for new sessions.
- Multi-select in the tree.

## Further Notes

- The user's TPM instance runs TPM 14.184.308 with API v6; HMAC keys don't expire there, so v1 has no key-renewal flow.
- The user types on an Italian layout on both systems, which shaped the shortcut choices.
- OpenSSH 10.5 matches aliases case-sensitively, which is why aliases are always lowercase.
- Detecting the terminal's switch to raw mode, to connect the typed-`ssh` pane without waiting for OSC 7, can come after v1; it needs research on ConPTY.
- The shell setup for OSC 7 (one line each for bash and zsh) goes in the docs.
- Research behind the decisions is in `.scratch/slop-term-v1/research/`.
