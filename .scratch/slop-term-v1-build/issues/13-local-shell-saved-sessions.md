# 13 — Local shell Saved sessions

**What to build:** Local shells become Saved sessions in the same tree: a shell kind, WSL distro, start folder and command, so one click opens exactly the shell the user needs, including a container shell via `docker exec`. Unsaved Tabs can be saved. A session whose shell this machine lacks shows dimmed and won't open.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 04 — Session tree from SSH config; 06 — Tabs in the tree

**Status:** ready-for-agent

- [ ] Local shell sessions are stored in the Sidecar file in their own list keyed by name, with folder, shell kind (`pwsh`, `powershell`, `cmd`, `wsl`, `zsh`, `bash`), WSL distro, start folder and command; writes follow re-read-before-write.
- [ ] Names follow the alias rules and are unique across SSH and Local shell sessions; the kind can't change after creation.
- [ ] They sit in the tree with SSH sessions, sorted A to Z together, with a 3 px amber bar.
- [ ] Dialog (~460 px): Name, Shell, WSL distro (WSL only), Start folder, Command, Folder (Colour arrives in ticket 14), with a note showing the launch line such as "Starts `wsl -d Ubuntu --cd ~/src`". No Test button. A shell this machine lacks shows "(not on this machine)" with a warning.
- [ ] Launch runs the command through the shell (`pwsh -Command "<cmd>"`, `wsl -d <distro> --cd <folder> -- <cmd>`, `zsh -lc "<cmd>"` and so on). Empty distro means the WSL default; empty start folder means home; `~` works everywhere.
- [ ] "Save" on an unsaved Tab asks for a name and folder and moves the Tab under its new Saved session. The app never creates Saved sessions on its own.
- [ ] A session whose shell or distro this machine lacks dims to 45%, shows `n/a` with the tooltip "not available on this machine", has no `+`, won't open, and can still be edited, moved and renamed.
- [ ] "New" offers Local shell session; the folder menu's "New local shell here" works.
- [ ] Back-end tests: launch lines per shell kind, command exit keeps the Tab, unavailable detection. UI tests: dialog fields per shell kind, dimmed row.
