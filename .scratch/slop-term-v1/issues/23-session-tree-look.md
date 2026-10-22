# Session tree look

Type: prototype
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

What does the Saved-session tree look like in detail? Build on layout C from "Main window layout" with the palettes and Session colours from "Terminal look", and explore a few design ideas.

Points to settle: how sibling Tab rows of one Saved session tell each other apart, now that the Session colour dot sits only on the session row (the current folder from OSC 7, the terminal title, a number, or something else); how a Tab row shows that its connection dropped (from "Tab disconnect and reconnect"); how the tree shows folders, the teal and amber edges, a Hand-written host's read-only state, the "Unsaved" group and a greyed-out Local shell session (from "Local shell sessions"); how the tree looks in light and dark mode.

## Answer

Decided with the user on 2026-10-21, from a prototype of three tree variants. The user picked A ("Explorer rows") for its density.

1. Rows are one line, 22 px high, indented 14 px per level.
2. Tab rows: the last folder name from OSC 7, then the terminal title in grey. The title is hidden when it only names the shell (`bash`, `pwsh`). With no OSC 7 folder, the row shows the title alone. A dropped Tab keeps its last folder. The folder tells sibling Tabs apart. Two siblings in the same folder running the same thing look the same apart from their number, which is accepted.
3. Tab numbers: Tabs 1 to 9, in tree order, show their number as a keycap on the right. Its tooltip names the shortcut (Ctrl+Shift+N on Windows, Cmd+N on macOS, from "Keyboard shortcuts, themes and fonts"). The active Tab's keycap is brighter. Tab 10 and later have no keycap.
4. Dropped Tab: the row dims to 60%, and a red broken-link icon sits before the label. Exited Tab (a non-zero exit, or a session with a command): a grey exit arrow, and `exit N` in place of the title.
5. Saved session row: a 3 px bar before the name, teal for SSH and amber for a local shell, then the Session colour dot. Tab rows have no bar and no dot. A `+` shows on hover and opens another Tab.
6. Hand-written host: a grey lock on the right, with the tooltip "Hand-written host, read-only".
7. A Local shell session whose shell this machine lacks dims to 45% and shows `n/a` on the right, with the tooltip "not available on this machine". It has no `+`.
8. Folders: a chevron and a folder icon, with no colour and no count.
9. Order: the "Unsaved" group, then hosts with no Sidecar entry, then folders. Inside a folder, subfolders come first, then Saved sessions A to Z, SSH and local shells mixed.
10. "Unsaved" group: a small uppercase header. Each row shows the shell (`pwsh`, `wsl: Ubuntu`) and its folder. A Tab running a typed `ssh` shows `→ <alias>` in place of the folder.
11. Light and dark mode share the layout. Only the colours change: GitHub Primer UI colours, the teal and amber edges from the terminal palettes, and the light or dark shade of each Session colour.

The user may revisit any of these details later.

Rejected: B ("Rail + numbers"), with folders flattened to breadcrumb headers and a rail joining each session to its Tabs, and C ("Two-line rows"), with `user@host` and the full folder on a second line.

Prototype: `.scratch/slop-term-v1/prototypes/session-tree-look.html` on the local branch `prototype/session-tree-look` (commit e94e570). It is never merged.

Correction (2026-10-22, from "Creating and editing SSH Saved sessions" point 9): in points 6 and 9, Hand-written hosts move into the "Unsaved" group, after unsaved local shell Tabs and Tabs whose Saved session was deleted, A to Z, each with its lock. A Managed host with no Sidecar entry sits at the tree root.
