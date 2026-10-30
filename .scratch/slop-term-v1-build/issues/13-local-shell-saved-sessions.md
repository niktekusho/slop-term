# 13 — Local shell Saved sessions

**What to build:** Local shells become Saved sessions in the same tree: a shell kind, WSL distro, start folder and command, so one click opens exactly the shell the user needs, including a container shell via `docker exec`. Unsaved Tabs can be saved. A session whose shell this machine lacks shows dimmed and won't open.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 04 — Session tree from SSH config; 06 — Tabs in the tree

**Status:** done

- [ ] Local shell sessions are stored in the Sidecar file in their own list keyed by name, with folder, shell kind (`pwsh`, `powershell`, `cmd`, `wsl`, `zsh`, `bash`), WSL distro, start folder and command; writes follow re-read-before-write.
- [ ] Names follow the alias rules and are unique across SSH and Local shell sessions; the kind can't change after creation.
- [ ] They sit in the tree with SSH sessions, sorted A to Z together, with a 3 px amber bar.
- [ ] Dialog (~460 px): Name, Shell, WSL distro (WSL only), Start folder, Command, Folder (Colour arrives in ticket 14), with a note showing the launch line such as "Starts `wsl -d Ubuntu --cd ~/src`". No Test button. A shell this machine lacks shows "(not on this machine)" with a warning.
- [ ] Launch runs the command through the shell (`pwsh -Command "<cmd>"`, `wsl -d <distro> --cd <folder> -- <cmd>`, `zsh -lc "<cmd>"` and so on). Empty distro means the WSL default; empty start folder means home; `~` works everywhere.
- [ ] "Save" on an unsaved Tab asks for a name and folder and moves the Tab under its new Saved session. The app never creates Saved sessions on its own.
- [ ] A session whose shell or distro this machine lacks dims to 45%, shows `n/a` with the tooltip "not available on this machine", has no `+`, won't open, and can still be edited, moved and renamed.
- [ ] "New" offers Local shell session; the folder menu's "New local shell here" works.
- [ ] Back-end tests: launch lines per shell kind, command exit keeps the Tab, unavailable detection. UI tests: dialog fields per shell kind, dimmed row.

## Test coverage

Back end: `src/backend/local-shell-sessions.test.ts`. UI: `src/renderer/LocalShells.test.tsx`.

- Sidecar list keyed by name, re-read-before-write: "adds it to its own Sidecar list keyed by name, keeping the rest of the file"; "edits and renames a session in place, and stops if the file changed since it was read"; "deletes a session after checking it is unchanged".
- Alias rules, one namespace: "shares one namespace with SSH aliases and Hand-written hosts, ignoring case, and writes nothing on a clash"; UI "shows WSL distro only for WSL and the launch line for each shell" (Free or taken while typing). The kind can't change: Local shell and SSH sessions have separate dialogs and save methods, so no path turns one into the other. No test.
- Tree, sorted with SSH sessions, amber bar: "sorts them A to Z with SSH sessions, each with an amber bar". Folders: "moves a session into a folder and back, keeping a folder it alone named"; "carries sessions along when their folder is renamed or moved"; "deletes the sessions of a deleted folder along with its SSH sessions"; UI "counts Local shell sessions in a folder delete".
- Dialog fields, launch-line note, no Test, "(not on this machine)": "shows WSL distro only for WSL and the launch line for each shell"; "marks a shell or distro this machine lacks as not on this machine, with a warning"; "edits and renames a session, carrying its Tabs along"; "deletes a session with the values read when the confirm opened".
- Launch through the shell, start folder, `~`: "runs the command through each shell this machine has, in its start folder" (pwsh, powershell, cmd and WSL on Windows; zsh and bash on macOS). Empty distro shows in the launch-line note test ("Starts wsl --cd ~"). The run test uses a named distro, since the WSL default on a machine with Docker Desktop can be `docker-desktop`.
- Command exit keeps the Tab: back end "reports the command's exit code and runs it again on restart"; UI "opens a Tab under the session, and a Tab running a command stays after exit 0".
- Save on an unsaved Tab: "asks for a name and folder and moves the Tab under its new session". The app never creates Saved sessions on its own: only the dialog's Save sends `saveLocalShell`. No test.
- Unavailable: back end "refuses a session whose shell or WSL distro this machine lacks"; UI "dims a session whose shell this machine lacks: n/a, no +, and it does not open", "dims a WSL session whose distro this machine lacks", "still moves and edits an unavailable session".
- Platform facts checked on Windows 11 with WSL Ubuntu: `wsl.exe --cd ~/.cache -- pwd` prints `/home/<user>/.cache`, so `--cd` takes `~/…`. `wsl.exe -- "echo a b"` fails with `echo a b: command not found`, so the command goes to WSL as raw command-line text.
- New and folder menu: "offers Local shell session in New and New local shell here in a folder menu, in that folder".
