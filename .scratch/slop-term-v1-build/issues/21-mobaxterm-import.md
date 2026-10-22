# 21 — MobaXterm import

**What to build:** The user imports their MobaXterm sessions once. A preview lists every session with a checkbox and its problems, and nothing is written until the user confirms. SSH sessions become Managed Saved sessions in nested folders, WSL sessions become Local shell sessions, and everything that can't come across is listed.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 12 — Folders and Move into slop-term; 13 — Local shell Saved sessions; 14 — Session colours

**Status:** ready-for-agent

- [ ] A file picker prefilled with the first `MobaXterm.ini` found in `%APPDATA%\MobaXterm`, `Documents\MobaXterm` or the executable's folder; `.mxtsessions` files accepted. Decoded with the system ANSI code page, falling back to Windows-1252.
- [ ] Parsing: `[Bookmarks]` is the root, each `[Bookmarks_N]` a folder whose `SubRep` splits on `\`; session lines `name=#icon#type%host%port%user%...#terminal#tab#comment#colour`; SSH (type `0`) host at 1, port 2, user 3, key path 14; a missing field means its default.
- [ ] Alias: lowercase, runs of spaces or illegal characters become `-`, editable in the preview and checked as typed.
- [ ] A row whose alias exists starts unticked "already exists"; a row whose host, port, user and key match an existing host starts unticked "already in SSH config as `<alias>`"; differing fields are shown; whitespace-only values count as empty. A second import adds nothing by default.
- [ ] Folders map to nested Sidecar folders, reusing existing paths; root sessions go to the tree root; no empty folders are created.
- [ ] Key paths: `_ProfileDir_` → `~`, `_CurrentDrive_` → the source file's drive, `\` → `/`, home paths written `~/...`, other absolute paths kept and flagged "won't work on macOS". `.ppk` keys are dropped and flagged with the PuTTYgen steps.
- [ ] Jump hosts (fields 8–10 and 15) and login commands (field 7) are dropped and listed. Empty user writes no `User`. X11 ignored. The comment becomes a `#` line above the block. Each SSH session gets `ServerAliveInterval 15`.
- [ ] WSL (type 14) becomes a `wsl` Local shell session with empty distro, noted "opens your default WSL distro". Other non-SSH types are skipped and listed.
- [ ] Tab colour maps to the nearest Session colour (`255` → Red, `-1` → none), shown and editable in the preview.
- [ ] Passwords are not imported. Host keys are not copied.
- [ ] Confirm writes the Managed config and the Sidecar file once each, under re-read-before-write.
- [ ] Back-end tests with fixture INI files shaped like the user's real file (19 SSH sessions, 1 WSL, 7 folders, 17 names with spaces, 1 `.ppk`, 3 identical and 1 differing match against existing hosts), plus short legacy lines and a second import adding nothing.
