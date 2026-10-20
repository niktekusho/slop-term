# Local shell sessions

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

Are local shells Saved sessions in the tree, and what does one store and where?

Points to settle: which shells the app offers on each system (PowerShell, cmd, each WSL distro, zsh); whether local shells sit in the Saved-session tree with folders or in a separate list, given they aren't SSH config entries; what a local shell session stores (shell, WSL distro, start folder, a command to run, such as `docker exec -it <container> bash`) and whether that goes in the Sidecar file or elsewhere; how sessions sync between Windows and macOS when a shell exists on only one of them; what an imported MobaXterm WSL session (type 14) becomes, from "How MobaXterm sessions map onto slop-term". WSL is a must. Docker needs no Docker code: a container shell is a local shell session that runs a command. The glossary defines a Saved session as SSH-only today, so the answer changes it.

## Answer

Decided with the user on 2026-10-20.

1. Local shell sessions are Saved sessions. They share the tree, its folders and Ctrl+K with SSH sessions, and sort with them alphabetically by name inside each folder.
2. They live in the Sidecar file (`~/.ssh/slop-term.json`), in their own list keyed by name, under the re-read-before-write rule from "What goes in SSH config vs the Sidecar file".
3. A Local shell session stores a name, a folder, a shell kind (`pwsh`, `powershell`, `cmd`, `wsl`, `zsh`, `bash`), a WSL distro (`wsl` only, empty means the WSL default distro), an optional start folder and an optional command. There is no custom executable path, environment variables or per-session look in v1.
4. Names follow the same rules as a `Host` alias and are unique across SSH and Local shell sessions.
5. The command runs through the shell: `pwsh -Command "<cmd>"`, `wsl -d <distro> -- <cmd>`, `zsh -lc "<cmd>"` and so on. When it exits, the Tab stays open and shows "process exited with code N" until the user closes it. A container shell is a session whose command is `docker exec -it <container> bash`.
6. The start folder is a path in the shell's own terms: a Linux path for WSL, which the app passes with `--cd`, and a Windows path for PowerShell and cmd. `~` works everywhere. Empty means the home folder.
7. "New local shell" lists the shells found on this machine (PowerShell 7 or Windows PowerShell, cmd, each distro from `wsl -l -q` except names starting with `docker-desktop`, zsh and bash on macOS) and opens an unsaved Tab. The app never creates Saved sessions on its own. Unsaved Tabs sit in an "Unsaved" group at the top of the tree, labelled by shell (`pwsh`, `wsl: Ubuntu`). "Save" asks for a name and a folder and moves the Tab under its new Saved session. The group disappears when it's empty.
8. The Sidecar file syncs, so a session whose shell or distro this machine lacks shows greyed out, marked "not available on this machine". It won't open, but it can be edited, moved and renamed.
9. MobaXterm import: a WSL session (type 14) becomes a `wsl` Local shell session with an empty distro. Its name is slugified like an SSH alias, and its MobaXterm folder is kept. The preview notes "opens your default WSL distro". The user's only WSL line is `14%1%`, which names no distro, and the undocumented `1` field is ignored.

`GLOSSARY.md` now defines Local shell session and widens Saved session, Tab and Sidecar file to match.
