# 12 — Folders and Move into slop-term

**What to build:** The user organises the tree: nested folders created and renamed inline, sessions and folders moved by drag and drop or a keyboard picker, and folders deleted with a clear count of what goes with them. Hand-written hosts can be moved into the Managed config with one click, and a Managed alias also defined in the user's own config shows a warning with a fix.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 10 — SSH Saved session dialog

**Status:** ready-for-agent

- [ ] "New" offers Folder; a folder's menu has New SSH session here, New local shell here (enabled by ticket 13), New folder here, Rename (F2), Move to… (F7), Delete (Del).
- [ ] Folders nest to any depth; empty folders persist in the Sidecar folder list; names are any text without `/`, unique among siblings ignoring case; a colliding rename is rejected, not merged.
- [ ] New folder and Rename edit inline: Enter or blur commits, Esc cancels, an empty, taken or `/`-containing name keeps the field open with a red border.
- [ ] Moving: drag and drop for sessions and folders; Move to… (F7) is a small dialog with a focused filter box over the folder list written `work / prod`, starting with "(top level)", current folder marked, ↑/↓ choose, Enter moves, Esc cancels; a folder can't move into itself or its subfolders. Moves carry open Tabs.
- [ ] Deleting a non-empty folder confirms "Delete folder `prod`, 1 subfolder and 4 Saved sessions?", a line for open Tabs, and an unticked "Also delete N saved secrets from keychain / KeePass" counting only entries no session outside the folder uses, never TPM. Cancel focused, Delete red. An empty folder deletes without asking. Each file is written once.
- [ ] Tree focus keys: Enter opens a Tab, F2 edits or renames, Delete asks to delete, F7 opens Move to….
- [ ] "Move into slop-term" on a Hand-written host copies it into the Managed config, then after the user confirms comments out the original in `~/.ssh/config` with `# moved to slop-term.conf`, as a line edit. Nothing is deleted.
- [ ] A Managed alias also defined in this machine's `~/.ssh/config` shows a warning icon with "Also defined in ~/.ssh/config line N" and a menu item "Comment out the copy in ~/.ssh/config" using the same line edit.
- [ ] A rename from outside the app looks like a delete plus a new session: its Tabs move to the Unsaved group.
- [ ] Back-end tests: folder create, rename, move, nested delete with secret counting, move-into with and without confirm, duplicate-alias detection. UI tests: inline edit validation, Move to… picker keys, drag and drop.
