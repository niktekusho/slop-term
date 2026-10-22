# 07 — Clipboard, paste guard and find

**What to build:** Copy and paste work as in MobaXterm and are safe: selecting text copies it, right-click pastes, and any paste with a line break asks first. Find searches the scrollback.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 01 — Walking skeleton: unsaved local shell Tab

**Status:** ready-for-agent

- [ ] Selecting text in the terminal copies it; right-click pastes.
- [ ] Ctrl+Shift+C / Ctrl+Shift+V on Windows and Cmd+C / Cmd+V on macOS copy and paste.
- [ ] Pasting text containing any line break, including a single line ending in one, asks "Paste N lines? Each line may run as a command." with Paste and Cancel, even with bracketed paste on. No setting turns it off.
- [ ] Ctrl+Shift+F / Cmd+F opens find in scrollback with `@xterm/addon-search`.
- [ ] No smart Ctrl+C: plain Ctrl+C always reaches the shell.
- [ ] UI tests: paste with and without line breaks, Cancel sends nothing, find highlights a match.
