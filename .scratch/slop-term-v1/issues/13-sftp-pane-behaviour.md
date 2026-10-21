# SFTP pane behaviour

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

How does the SFTP pane behave for an SSH Tab?

Points to settle: whether it follows the terminal's current folder, as MobaXterm does, and how the app learns that folder (the shell's OSC 7 escape, polling `pwd` over a second channel, or not at all); what the pane shows and lets the user do (list, sort, hidden files, rename, delete, new folder, edit permissions); how uploads and downloads show progress, queue and handle a file that already exists; drag and drop to and from the OS on Windows and macOS; whether the pane opens a second SSH connection or a channel on the Tab's connection.

## Answer

Decided with the user on 2026-10-20.

1. Connections: the pane browses over an SFTP channel on the Tab's own connection, opened the first time the pane is shown for that Tab. Transfers and editor sync run on a second connection, so a big upload can't make typing lag. All channels on one SSH connection share one TCP stream, so a full send buffer delays keystrokes on slow links. The second connection opens on the first transfer and closes after 5 minutes with no transfers.
2. Transfer login: the second connection logs in with the session's key, agent or Credential reference. A password the user typed stays in memory in the back end for the Tab's lifetime and is reused. Hosts that ask for a 2FA code or any other keyboard-interactive prompt run their transfers on the Tab's connection instead, so the user is never prompted twice.
3. Folder: the pane starts in the home folder. It follows the terminal's folder when the remote shell sends OSC 7, and a "Follow terminal" toggle (on by default) turns that off. The docs give the one-line bash and zsh setup. Polling `pwd` can't work, because a second channel has its own shell.
4. Listing: name, size, modified date and permissions, sortable by header, folders first. Hidden files show by default, with a toggle. Double-click enters a folder, plus an up button, a path box and refresh. Actions: rename, delete with a confirm prompt (folders with everything inside), new folder. No permission changes in v1.
5. Transfers: one queue per Tab, one file at a time. A transfer list at the bottom of the pane shows progress, speed and cancel. Finished items clear after a few seconds, and failed ones stay with retry. Folders transfer with everything inside. An existing target asks overwrite, skip or keep both (` (1)` suffix), with "apply to all" for the batch. Closing a Tab with pending transfers asks first and offers "Show local copy".
6. Drag and drop: files dragged in from the OS upload. There is no drag out, because Electron's `startDrag` needs the file on disk before the drop. "Download" saves to the last folder used (Downloads the first time) and its finished item shows a path that opens Explorer or Finder with the file selected. "Download to..." opens a folder picker.
7. Editor sync: double-clicking a file downloads it to an app temp folder and opens it in the configured editor. When that per-machine setting is empty, the app looks for `code` on PATH, then `notepad++` on PATH, then `C:\Program Files\Notepad++\notepad++.exe` (Windows only), and otherwise uses the OS default app. "Upload on save" is on by default. Off, the app asks on each save.
8. Remote changes: before each editor-sync upload, the app checks the remote file against the version it downloaded. Up to 10 MB it compares a SHA-256 of a fresh SFTP read. Above that it compares modified time and size. SFTP has no checksum command OpenSSH supports. If the remote changed, the app asks whether to overwrite it or cancel.
9. Drops and crashes: on a drop the pane greys out and shows "disconnected". Running transfers fail and stay retryable, and saves wait as "waiting for connection". After a reconnect the pane reopens at its last folder, and waiting uploads go out after the check in point 8. Temp copies are deleted when the Tab closes. At startup, copies with saves that never reached the server are listed with their paths for recovery, and the rest are deleted.

Changes "Credential provider interface": a password the user typed is held in memory for its Tab's lifetime (point 2), and transfers log in a second time (point 1).

Out of scope: rsync transfers, from "Can SFTP pane transfers use rsync?".

Addition (2026-10-21, from "SFTP pane for `ssh <host>` typed in a local shell Tab"): when OSC 7 reports a hostname different from the first one seen on the Tab, the user ran `ssh` again from the remote host. The pane stays on its host, stops following the folder and shows "Terminal is on db1. This pane shows web1." Following resumes when the hostname matches again.
