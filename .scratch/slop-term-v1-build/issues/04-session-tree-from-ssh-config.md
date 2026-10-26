# 04 — Session tree from SSH config

**What to build:** The Session tree shows the user's hosts. On first run the app adds `Include ~/.ssh/slop-term.conf` at the top of `~/.ssh/config`. Managed hosts from `~/.ssh/slop-term.conf` show in their Sidecar folders; Hand-written hosts from the user's own config show locked in the Unsaved group. The tree reloads when any of these files changes, for example after a sync from the other machine. A filter box finds a Saved session by name. Opening Tabs is not part of this ticket.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 01 — Walking skeleton: unsaved local shell Tab

**Status:** done

- [x] The include line goes at the top of `~/.ssh/config` once, as a line edit; nothing else in that file changes. A missing `~/.ssh/config` is created with only that line.
- [x] The config store reads the Managed config with `ssh-config` 5.3.0, follows `Include` itself, ignores `Match` blocks and shows a warning when it finds one.
- [x] Only concrete aliases are hosts; pattern entries such as `Host *` never show.
- [x] The Sidecar file `~/.ssh/slop-term.json` provides the folder list (empty folders kept) and, per Managed alias, its folder. Orphaned Sidecar entries are ignored but kept.
- [x] Tree order: the Unsaved group (unsaved local shell Tabs, then Hand-written hosts A to Z with a grey lock and the tooltip "Hand-written host, read-only"), then Managed hosts with no Sidecar entry, then folders. Inside a folder: subfolders first, then Saved sessions A to Z.
- [x] Rows are one line, 22 px high, indented 14 px per level. Saved session rows have a 3 px teal bar for SSH. Folders show a chevron and folder icon, no colour or count.
- [x] The app watches `slop-term.conf`, `slop-term.json` and `~/.ssh/config` and reloads the tree when they change.
- [x] The filter box narrows the tree by name; Ctrl+Shift+O / Cmd+Shift+O focuses it.
- [x] Back-end tests against a temp home: include line added once and idempotent; `Include` followed; `Match` warning; patterns hidden; orphaned Sidecar entries survive a write; tree reflects an external file change.
- [x] UI test: tree order and row shapes from a fake tree model.

Checked on macOS by driving the dev build over the DevTools protocol with `HOME` set to a seeded temp folder: the include line went to the top of the temp `config`, the tree drew in light and dark mode with the `Match` warning, the filter narrowed it to `prod` rows, and a host appended to `slop-term.conf` showed up without a restart. On Windows (2026-10-26, Windows 11 Pro 26200) the full suite passed after one fix: warnings showed `~\.ssh\config`, so tilde paths now always use `/`. The app was not run live on Windows. The back end returns flat lists in file order (`SessionTree` in `src/shared/ipc.ts`); the UI nests and sorts them, so folders and root hosts are also A to Z. Folders collapse on click. An existing include line counts only above the first `Host` or `Match` line; otherwise the app adds its own at the top. An unreadable file or invalid `slop-term.json` shows a warning in the tree and is read as empty. Only the three named files are watched: an edit to another file they `Include` reloads nothing until one of the three changes. This ticket writes no Sidecar data, so the orphan test checks that the file stays untouched; the write case moved to ticket 10.
