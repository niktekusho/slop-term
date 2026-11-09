# 17 — SFTP pane browsing and file actions

**What to build:** Beside every SSH Tab's terminal, in the same window, the SFTP pane lists the remote host's files and follows the terminal's folder through OSC 7. The user navigates, renames, deletes and creates folders from a right-click menu or keys that act only while the file list has focus. The pane collapses for the whole window and greys out when the Tab drops.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 06 — Tabs in the tree; 09 — Disconnect and reconnect

**Status:** done

- [x] The pane browses over an SFTP channel on the Tab's own connection, opened the first time the pane shows for that Tab, starting in the home folder.
- [x] Toolbar, left to right: up (disabled at `/`), editable path box, refresh, "Follow terminal" toggle (on by default), hidden-files toggle, collapse button. Ctrl+Shift+B / Cmd+B collapses and opens.
- [x] Collapsed strip is 30 px wide with an expand arrow and vertical "SFTP · <host>"; clicking it opens the pane. The open or collapsed state applies to the whole window.
- [x] File list: Name, Size, Modified, Permissions, sortable by header, folders first, 22 px rows with icons; folders blue, executables green, archives red from the terminal palette; hidden files shown at 55% opacity by default.
- [x] With "Follow terminal" on, OSC 7 from the remote shell moves the pane. A hostname different from the first one seen stops following and shows the amber banner "Terminal is on db1. This pane shows web1."; following resumes when it matches again.
- [x] Right-click a row: Open or Open in editor (editor in ticket 19), Download and Download to… (ticket 18), Rename, Delete; with several rows "Delete N items" and Rename disabled. Right-click empty space: New folder, Upload files… (ticket 18), Refresh, Select all. Ctrl/Cmd-click and Shift-click multi-select.
- [x] Rename and New folder edit inline; Rename selects the name without its extension; Enter or blur commits, Esc cancels; empty, taken or `/` names keep the field open with a red border.
- [x] Delete confirm names the item or lists up to five and counts the rest, states files and bytes per folder, says SFTP has no trash, and has a red Delete. Folders delete recursively.
- [x] Keys only while the file list has focus: Enter opens, F2 renames, Delete (Windows) or Cmd+Backspace (macOS) deletes, Backspace goes up, Ctrl+A / Cmd+A selects all, F5 / Cmd+R refreshes. A floating bar shows them while rows are selected, with "Right-click for more".
- [x] A dropped Tab shows a red banner "Disconnected. Reconnect the Tab to browse again." and a greyed list that ignores clicks; after a reconnect the pane reopens at its last folder.
- [x] A local shell Tab with no remote host shows "No remote host" and the "type `ssh <host>`" hint (the picker comes in ticket 20).
- [x] No permission changes in v1.
- [x] A Tab with a Session colour tints the pane background with the same `sessionColourTint` mix as its terminal (`terminalOptions` in `look.ts` from ticket 14), and the header bar spans the terminal and the pane.
- [x] Back-end tests against the Docker server: list, rename, delete recursive, new folder, OSC 7 follow and hostname change. UI tests: focus-only keys, inline edit validation, dropped state, collapse.

## Test coverage

Back end: `src/backend/sftp.test.ts`, against OpenSSH in Docker. UI: `src/renderer/SftpPane.test.tsx`, against `FakeBackend`.

- Channel and home folder: back end "starts in the home folder and lists a folder…" (no path means `realpath('.')`, and a relative path starts there). UI "opens on the first show after the Tab connects…" and "doesn't browse while collapsed, and opens the channel when the pane first shows" check that the first `listFiles` goes out only once the pane shows and the Tab is connected. Back end "refuses to browse a dropped Tab and browses over the new connection after a reconnect" lists right after the second `connected` event. A first version waited for the shell channel and failed this test under load, because `connected` comes before the shell opens.
- Toolbar: UI "goes up, disabled at /, goes where the path box says, and refreshes" and "hides hidden files with the toggle". The button order is in `SftpPane.tsx`, and the key is `sftp` in `shortcuts.ts`. UI "collapses for the whole window…" presses Ctrl+Shift+B. Cmd+B goes through the same `appShortcut` table as every macOS shortcut.
- Collapsed strip: UI "collapses for the whole window to a strip…" checks the label "SFTP · web1", that a second Tab finds the pane collapsed, and that a click on the strip opens it. No test can check the 30 px width, the vertical label, the 22 px rows or the header span (`grid-column: 2 / -1` in `index.css`), because jsdom computes no layout.
- File list: UI "opens on the first show…" checks folders first, the four columns, and the class that dims a hidden file. The 55% opacity is in `.hidden-file`, which jsdom doesn't apply. UI "sorts by the clicked header…" and "colours folders blue, executables green and archives red from the terminal palette". Back end "starts in the home folder…" checks size, modified time, `ls`-style permissions, and a link to a folder listed as a folder. No test covers a link to a file: `/^-.*x/` keeps it out of the green.
- Follow terminal: back end "reports the OSC 7 folder with its hostname and the first hostname seen…". UI "moves with OSC 7, and stops with the amber banner…" also resumes on a match and stops when toggled off. UI "starts in the folder the terminal reported before the pane first showed". After a reconnect with Follow on, the new shell's first OSC 7 moves the pane, as Follow says. The pane reopens at its last folder when no OSC 7 arrives or Follow is off.
- Menus and selection: UI "selects with click, Ctrl-click and Shift-click", "offers the actions for one row, and Delete N items with Rename disabled for several", and "offers New folder, Upload files…, Refresh and Select all on empty space". Open in editor, Download, Download to… and Upload files… stay disabled until tickets 18 and 19.
- Inline names: UI "renames with the name selected without its extension, committing on Enter", "keeps the field open with a red border on an empty, taken or / name, and cancels on Esc" (also `..`, and a blur on an invalid name), and "commits on blur and creates a new folder…". Back end "renames a file and creates a folder".
- Delete: UI "names one file, says SFTP has no trash, focuses Cancel and deletes on the red button" and "lists up to five items, counts the rest and states files and bytes per folder". Back end "counts the files and bytes of a folder, then deletes it with everything inside, deleting a link without following it": the folder the link points to survives. The CODING_STANDARDS rule for confirm dialogs asks for a `tree` event while the dialog is open. The pane's listing doesn't come from the tree, so UI "deletes what it showed, though the pane follows the terminal elsewhere while it is open" moves the pane with OSC 7 instead, and checks that the paths shown at open are the ones deleted.
- Keys: UI "act only while the file list has focus" gives the terminal the focus and checks that F2, Delete, Backspace and F5 do nothing in the pane. UI "open with Enter, go up with Backspace, select all with Ctrl+A and refresh with F5, with a hint bar while rows are selected" and "take Cmd on macOS, where Cmd+Backspace deletes and Cmd+R refreshes". Not checked on a Mac: whether Electron's default menu acts on Cmd+R (Reload) despite the pane's `preventDefault`.
- Dropped Tab: UI "greys out a dropped Tab with the red banner and reopens at its last folder after the reconnect" checks the banner, `inert` on the list, and the listing after the reconnect. An open delete confirm hides while the Tab is down, because its Delete couldn't reach the host.
- Local shell Tab: UI "shows "No remote host" and the ssh hint for a local shell Tab", which also checks that no listing goes out.
- No permission changes: the pane has no action that changes permissions. There is nothing to test.
- Session colour: UI "tints the pane like its Tab's terminal" compares the pane's background with the terminal area's tinted one.
- Full suite: one of three full runs failed `docker stop` hook timeouts in `ssh-tab.test.ts` and a KeePass history assertion, with two Docker containers running at once. Each of those files passed alone, and the next full run was green (341 passed, 1 skipped). `sftp.test.ts` gives its `afterAll` 30 s for `docker stop`.
