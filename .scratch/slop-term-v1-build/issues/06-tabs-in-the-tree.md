# 06 — Tabs in the tree

**What to build:** Each open Tab is listed in the tree under the Saved session it came from, with no Tab strip. A session can have several Tabs. Tab rows show where the shell is (OSC 7 folder) and what it runs (terminal title), and Tabs 1 to 9 show a keycap for their shortcut. A header bar names the active Tab's session. Keyboard shortcuts switch, duplicate and close Tabs in tree order, and a shell's exit closes or keeps its Tab by the exit rule.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 04 — Session tree from SSH config; 05 — SSH Tab with key login and host key checks

**Status:** ready-for-agent

- [ ] Clicking a Tab row switches to it; `+` on hover or double-click on a Saved session opens another Tab.
- [ ] Tab rows show the last folder from OSC 7, then the terminal title in grey; the title is hidden when it only names the shell; with no OSC 7 folder the row shows the title alone; a dropped Tab keeps its last folder.
- [ ] Tabs 1 to 9 in tree order show a keycap on the right whose tooltip names Ctrl+Shift+N or Cmd+N; the active Tab's keycap is brighter.
- [ ] Tab rows have no bar and no colour dot.
- [ ] Header bar across the window shows the session name and `user@host`, or "local shell".
- [ ] Shortcuts: Ctrl+Shift+D / Cmd+D duplicate, Ctrl+Shift+W / Cmd+W close, Ctrl+Tab / Ctrl+Shift+Tab next and previous in tree order (plus Cmd+Option+Right/Left on macOS), Ctrl+Shift+1–9 / Cmd+1–9 go to the Nth Tab reading the physical digit key.
- [ ] Plain Ctrl+letter always reaches the shell.
- [ ] Exit rule for SSH and local shell Tabs: exit code 0 in a session with no command closes the Tab; any other exit keeps it with "process exited with code N", a grey exit arrow and `exit N` in its row, and R starts it again.
- [ ] Back-end test: OSC 7 and title changes reach the UI as Tab updates; exit codes reported. UI tests: Tab rows, keycaps, shortcuts in tree order, physical-digit handling on an Italian layout.
