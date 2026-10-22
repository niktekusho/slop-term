# 04 — Session tree from SSH config

**What to build:** The Session tree shows the user's hosts. On first run the app adds `Include ~/.ssh/slop-term.conf` at the top of `~/.ssh/config`. Managed hosts from `~/.ssh/slop-term.conf` show in their Sidecar folders; Hand-written hosts from the user's own config show locked in the Unsaved group. The tree reloads when any of these files changes, for example after a sync from the other machine. A filter box finds a Saved session by name. Opening Tabs is not part of this ticket.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 01 — Walking skeleton: unsaved local shell Tab

**Status:** ready-for-agent

- [ ] The include line goes at the top of `~/.ssh/config` once, as a line edit; nothing else in that file changes. A missing `~/.ssh/config` is created with only that line.
- [ ] The config store reads the Managed config with `ssh-config` 5.3.0, follows `Include` itself, ignores `Match` blocks and shows a warning when it finds one.
- [ ] Only concrete aliases are hosts; pattern entries such as `Host *` never show.
- [ ] The Sidecar file `~/.ssh/slop-term.json` provides the folder list (empty folders kept) and, per Managed alias, its folder. Orphaned Sidecar entries are ignored but kept.
- [ ] Tree order: the Unsaved group (unsaved local shell Tabs, then Hand-written hosts A to Z with a grey lock and the tooltip "Hand-written host, read-only"), then Managed hosts with no Sidecar entry, then folders. Inside a folder: subfolders first, then Saved sessions A to Z.
- [ ] Rows are one line, 22 px high, indented 14 px per level. Saved session rows have a 3 px teal bar for SSH. Folders show a chevron and folder icon, no colour or count.
- [ ] The app watches `slop-term.conf`, `slop-term.json` and `~/.ssh/config` and reloads the tree when they change.
- [ ] The filter box narrows the tree by name; Ctrl+Shift+O / Cmd+Shift+O focuses it.
- [ ] Back-end tests against a temp home: include line added once and idempotent; `Include` followed; `Match` warning; patterns hidden; orphaned Sidecar entries survive a write; tree reflects an external file change.
- [ ] UI test: tree order and row shapes from a fake tree model.
