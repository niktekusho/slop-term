# 17 — SFTP pane browsing and file actions

**What to build:** Beside every SSH Tab's terminal, in the same window, the SFTP pane lists the remote host's files and follows the terminal's folder through OSC 7. The user navigates, renames, deletes and creates folders from a right-click menu or keys that act only while the file list has focus. The pane collapses for the whole window and greys out when the Tab drops.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 06 — Tabs in the tree; 09 — Disconnect and reconnect

**Status:** ready-for-agent

- [ ] The pane browses over an SFTP channel on the Tab's own connection, opened the first time the pane shows for that Tab, starting in the home folder.
- [ ] Toolbar, left to right: up (disabled at `/`), editable path box, refresh, "Follow terminal" toggle (on by default), hidden-files toggle, collapse button. Ctrl+Shift+B / Cmd+B collapses and opens.
- [ ] Collapsed strip is 30 px wide with an expand arrow and vertical "SFTP · <host>"; clicking it opens the pane. The open or collapsed state applies to the whole window.
- [ ] File list: Name, Size, Modified, Permissions, sortable by header, folders first, 22 px rows with icons; folders blue, executables green, archives red from the terminal palette; hidden files shown at 55% opacity by default.
- [ ] With "Follow terminal" on, OSC 7 from the remote shell moves the pane. A hostname different from the first one seen stops following and shows the amber banner "Terminal is on db1. This pane shows web1."; following resumes when it matches again.
- [ ] Right-click a row: Open or Open in editor (editor in ticket 19), Download and Download to… (ticket 18), Rename, Delete; with several rows "Delete N items" and Rename disabled. Right-click empty space: New folder, Upload files… (ticket 18), Refresh, Select all. Ctrl/Cmd-click and Shift-click multi-select.
- [ ] Rename and New folder edit inline; Rename selects the name without its extension; Enter or blur commits, Esc cancels; empty, taken or `/` names keep the field open with a red border.
- [ ] Delete confirm names the item or lists up to five and counts the rest, states files and bytes per folder, says SFTP has no trash, and has a red Delete. Folders delete recursively.
- [ ] Keys only while the file list has focus: Enter opens, F2 renames, Delete (Windows) or Cmd+Backspace (macOS) deletes, Backspace goes up, Ctrl+A / Cmd+A selects all, F5 / Cmd+R refreshes. A floating bar shows them while rows are selected, with "Right-click for more".
- [ ] A dropped Tab shows a red banner "Disconnected. Reconnect the Tab to browse again." and a greyed list that ignores clicks; after a reconnect the pane reopens at its last folder.
- [ ] A local shell Tab with no remote host shows "No remote host" and the "type `ssh <host>`" hint (the picker comes in ticket 20).
- [ ] No permission changes in v1.
- [ ] Back-end tests against the Docker server: list, rename, delete recursive, new folder, OSC 7 follow and hostname change. UI tests: focus-only keys, inline edit validation, dropped state, collapse.
