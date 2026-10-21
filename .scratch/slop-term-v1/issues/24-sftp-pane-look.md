# SFTP pane look

Type: prototype
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

What does the SFTP pane look like? It uses the terminal's palette (from "Terminal look"). In the "Terminal look" prototype it sat as a grey panel under a coloured header bar, which the user found ugly. The user wants to explore design ideas for the file list.

Points to settle: whether the pane takes the Session colour tint along with the terminal, and whether the coloured header bar spans the pane or only the terminal; the file list layout (a flat list of one folder, an expandable tree, columns for size and date, icons); how hidden files show (the pane shows them, from "SFTP pane behaviour"); how the upload queue and conflict prompts show; the collapse button and the collapsed strip (from "Main window layout"), which the prototype left out; how the pane looks for a local shell Tab with no remote host; the pane's password prompt, with its alias field, folder dropdown and "Save to" choice (from "Saving passwords typed for `ssh <host>`").

## Answer

Decided with the user on 2026-10-21, from a prototype in two rounds. Round 1 compared three file list layouts, and the user picked A ("Columns"). Round 2 compared three ways to reach file actions, and the user picked M ("Context menu").

1. Session colour: the header bar spans the full window width, over the terminal and the SFTP pane. The tint covers the pane's background too, with the same `sessionColourTint` mix. A Tab with no Session colour keeps the plain header and backgrounds.
2. Toolbar, left to right: up (disabled at `/`), an editable path box, refresh, the "Follow terminal" toggle, the hidden-files toggle, then the collapse button, which Ctrl+Shift+B / Cmd+B also triggers.
3. File list: one folder at a time, in the columns Name, Size, Modified and Permissions, sortable by header, folders first. Rows are 22 px high, like the Session tree, each with a folder or file icon. Names take colours from the terminal palette: folders blue, executables green, archives (`.gz`, `.zip`, `.tar`) red.
4. Hidden files show at 55% opacity.
5. Actions: right-clicking a row opens a menu with Open (a folder) or Open in editor (a file), Download, Download to..., Rename and Delete. With several rows selected, the menu reads "Download N items" and "Delete N items", and Rename is disabled. Right-clicking empty space offers New folder, Upload files..., Refresh and Select all. Ctrl-click or Cmd-click and Shift-click select several rows.
6. Shortcuts act only while the file list has focus, so the shell keeps its keys: Enter opens, F2 renames, Delete (Windows) or Cmd+Backspace (macOS) deletes, Backspace goes up a folder, Ctrl+A or Cmd+A selects all, and F5 or Cmd+R refreshes. While rows are selected, a floating bar over the bottom of the file list shows these shortcuts and "Right-click for more".
7. Rename and New folder edit the name inline. Rename selects the name without its extension. Enter or leaving the field commits, and Esc cancels. An empty or taken name, or one with `/`, keeps the field open with a red border.
8. Delete confirmation: it names the item, or lists up to five items and counts the rest. For each folder it states how many files and bytes go with it. It says SFTP has no trash, and its Delete button is red.
9. Transfers: a list docked at the bottom of the pane, under a "Transfers" header with the count of active items. A row shows the direction icon, the name, the target folder, a progress bar with percent, bytes and speed, and cancel. A failed row shows the reason in red and a retry button. A finished download shows "Saved to <folder>" as a link. Editor-sync files are rows too ("open in VS Code · uploaded 15:41").
10. Conflicts: a dialog over the pane names the file, compares size and modified time on this computer and on the host, and offers Overwrite, Skip and Keep both, with "Apply to the other N conflicts" for a batch.
11. Dragging files over the pane shows a dashed overlay, "Drop to upload to <path>".
12. Collapsed strip: 30 px wide, with an expand arrow at the top, the running upload's percentage, and the vertical label "SFTP · <host>". Clicking anywhere on it opens the pane.
13. A local shell Tab with no remote host shows "No remote host", the "type `ssh <host>`" hint, and the "Browse files of..." picker over SSH Saved sessions. The picker stays in every local shell Tab, as point 2 of "SFTP pane for `ssh <host>` typed in a local shell Tab" decided. In WSL Tabs it is the only way to get a pane. In other shells it covers an `ssh` that detection misses, such as one started by a script or inside `tmux`. A WSL Tab's hint says the pane can't see `ssh` inside WSL.
14. Password prompt: a Tab whose typed `ssh` needs a password first shows a "Browse files on <user>@<host>" button. It opens a card titled "Log in to <user>@<host>", which says it is for the pane only and that the terminal's `ssh` asks on its own. The card has a password field, then "Save to" as radio buttons (the keychain under its OS name, each KeePass database, "Don't save"). When saving, it adds the alias field, checked as the user types ("Free", or the reason in red), the folder dropdown, and a line naming the Saved session it creates. Then Connect and Cancel.
15. Dropped Tab: a red banner under the toolbar, "Disconnected. Reconnect the Tab to browse again.", and a greyed-out list that ignores clicks. Transfer rows stay.
16. Chained `ssh`: an amber banner, "Terminal is on db1. This pane shows web1.", with "Follow terminal" switched off.
17. Light and dark mode share the layout. Only the colours change.

Changes "Main window layout" point 3 and "Terminal look" point 6: the header bar spans the terminal and the SFTP pane, and the tint covers the pane too.

Adds to "Keyboard shortcuts, themes and fonts": the pane's own shortcuts in point 6. They don't break that ticket's point 1, because they act only while the file list has focus, never while the terminal does.

Rejected: for the layout, B ("Tree"), an expandable tree with details in a footer and transfers folded into one line, and C ("Breadcrumb rows"), two-line rows under a clickable breadcrumb with transfers in a popover. For actions, H (hover icons in place of the Permissions cell) and S (a selection bar under the toolbar, which shifts the list down). Also tried: the header bar over the terminal only, the tint on the terminal only, and the collapse button before the up button.

Prototype: `.scratch/slop-term-v1/prototypes/sftp-pane-look.html` on the local branch `prototype/sftp-pane-look` (commit f01c13e). It is never merged.
