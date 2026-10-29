# 12 — Folders and Move into slop-term

**What to build:** The user organises the tree: nested folders created and renamed inline, sessions and folders moved by drag and drop or a keyboard picker, and folders deleted with a clear count of what goes with them. Hand-written hosts can be moved into the Managed config with one click, and a Managed alias also defined in the user's own config shows a warning with a fix.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 10 — SSH Saved session dialog

**Status:** done

- [x] "New" offers Folder; a folder's menu has New SSH session here, New local shell here (enabled by ticket 13), New folder here, Rename (F2), Move to… (F7), Delete (Del).
- [x] Folders nest to any depth; empty folders persist in the Sidecar folder list; names are any text without `/`, unique among siblings ignoring case; a colliding rename is rejected, not merged.
- [x] New folder and Rename edit inline: Enter or blur commits, Esc cancels, an empty, taken or `/`-containing name keeps the field open with a red border.
- [x] Moving: drag and drop for sessions and folders; Move to… (F7) is a small dialog with a focused filter box over the folder list written `work / prod`, starting with "(top level)", current folder marked, ↑/↓ choose, Enter moves, Esc cancels; a folder can't move into itself or its subfolders. Moves carry open Tabs.
- [x] Deleting a non-empty folder confirms "Delete folder `prod`, 1 subfolder and 4 Saved sessions?", a line for open Tabs, and an unticked "Also delete N saved secrets from keychain / KeePass" counting only entries no session outside the folder uses, never TPM. Cancel focused, Delete red. An empty folder deletes without asking. Each file is written once.
- [x] Tree focus keys: Enter opens a Tab, F2 edits or renames, Delete asks to delete, F7 opens Move to….
- [x] "Move into slop-term" on a Hand-written host copies it into the Managed config, then after the user confirms comments out the original in `~/.ssh/config` with `# moved to slop-term.conf`, as a line edit. Nothing is deleted.
- [x] A Managed alias also defined in this machine's `~/.ssh/config` shows a warning icon with "Also defined in ~/.ssh/config line N" and a menu item "Comment out the copy in ~/.ssh/config" using the same line edit.
- [x] A rename from outside the app looks like a delete plus a new session: its Tabs move to the Unsaved group.
- [x] Back-end tests: folder create, rename, move, nested delete with secret counting, move-into with and without confirm, duplicate-alias detection. UI tests: inline edit validation, Move to… picker keys, drag and drop.

## Test coverage

Back end: `src/backend/folders.test.ts` and the "Move into slop-term" block of `src/backend/session-tree.test.ts`. UI: `src/renderer/Folders.test.tsx`.

1. New and the folder menu: "creates a folder inline in the selected row's folder from New" and "lists the folder menu with its keys".
2. Nesting and name rules: "adds an empty nested folder…", "rejects a name with / or one a sibling has…", "rejects a rename onto a sibling instead of merging…" and "keeps a folder only its last session named, as an empty folder".
3. Inline edit: "keeps an empty, taken or /-containing name open…", "renames with F2, and Esc cancels…" and "puts the focus on the folder row when the edit ends…".
4. Moving: "moves a session into a folder and back…", "moves a folder with its subfolders and sessions", "refuses to move a folder into itself…", the three Move to… tests and the two drag and drop tests. "opens with F7 on a session… moves it and its Tab" covers Tabs moving along.
5. Delete folder: "deletes its subfolders and sessions, and only the secrets no session outside uses", "keeps every secret when not asked, and deletes an empty folder", "stops with a conflict when the folder holds other sessions…", "counts what goes, names open Tabs…", "sends the sessions it counted…" and "deletes an empty folder without asking". "Each file is written once" has no test: the IPC seam can't count writes, and the store makes one `writeFileSync` call for each file.
6. Focus keys: the F2, F7 and Delete tests above. Enter is unchanged from ticket 06.
7. Move into slop-term: "copies the block into the Managed config…", "comments out the original under a marker once confirmed…", "refuses to comment out a host the Managed config lacks…" and the UI tests "moves a Hand-written host in, then comments out…" and "keeps both on request…".
8. Duplicate alias: "marks a Managed alias that ~/.ssh/config also defines…" and "comments out the copy of a synced Managed alias from its menu".
9. Rename from outside: "moves the Tabs of a session renamed outside the app to the Unsaved group".

Known limits: a namesake in a file that `~/.ssh/config` includes gets no warning, and Move into slop-term refuses a host that is not in `~/.ssh/config` itself.
