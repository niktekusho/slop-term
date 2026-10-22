# 01 — Walking skeleton: unsaved local shell Tab

**What to build:** The app starts on Windows and macOS and shows one window with the Session tree on the left and a terminal on the right. "New local shell" (and Ctrl+Shift+T / Cmd+T for the default shell) lists the shells this machine has and opens an unsaved Tab in the "Unsaved" group, labelled by shell. Typing in the terminal reaches the shell. This slice lays the path every later ticket extends: the back end in one `utilityProcess`, a typed IPC contract shared by the back end and a fake back end, and both test seams.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Electron 44 app built with Electron Forge (Vite + TypeScript template, Forge version pinned), React UI, npm. `npm run package` builds a runnable app on each system; no installer.
- [ ] The whole back end runs in one Electron `utilityProcess`; the main process only manages the window and relays messages; the UI talks to the back end only by IPC.
- [ ] The IPC contract is typed in one shared module; a fake back end implements the same contract for UI tests.
- [ ] Terminal uses xterm.js 6 with the `fit` addon; local shells use `node-pty` 1.2.0-beta.15 pinned exactly (ConPTY on Windows).
- [ ] Shell detection lists PowerShell 7 or Windows PowerShell, cmd and each `wsl -l -q` distro except names starting with `docker-desktop` on Windows, and zsh and bash on macOS.
- [ ] Unsaved Tabs sit in an "Unsaved" group at the top of the tree, labelled `pwsh`, `wsl: Ubuntu` and so on; the group disappears when empty.
- [ ] Scrollback defaults to 1,000 lines.
- [ ] Seam 1 harness: a test starts the back end as the app does and drives it only by IPC messages, with a temp home folder per test. A test opens a local shell and reads its output.
- [ ] Seam 2 harness: a test renders the UI against the fake back end, acts as the user and checks what renders and which messages are sent.
- [ ] The stack test scripts from "Choose the stack" pass on a Windows machine and a Mac.
