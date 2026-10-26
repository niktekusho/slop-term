# 07 — Clipboard, paste guard and find

**What to build:** Copy and paste work as in MobaXterm and are safe: selecting text copies it, right-click pastes, and any paste with a line break asks first. Find searches the scrollback.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 01 — Walking skeleton: unsaved local shell Tab

**Status:** ready-for-agent

- [x] Selecting text in the terminal copies it; right-click pastes.
- [x] Ctrl+Shift+C / Ctrl+Shift+V on Windows and Cmd+C / Cmd+V on macOS copy and paste.
- [x] Pasting text containing any line break, including a single line ending in one, asks "Paste N lines? Each line may run as a command." with Paste and Cancel, even with bracketed paste on. No setting turns it off.
- [x] Ctrl+Shift+F / Cmd+F opens find in scrollback with `@xterm/addon-search`.
- [x] No smart Ctrl+C: plain Ctrl+C always reaches the shell.
- [x] UI tests: paste with and without line breaks, Cancel sends nothing, find highlights a match.

Checked with the UI tests only (2026-10-26, Windows 11 Pro 26200); the app was not run live. Copy-on-select copies on the left mouse-up that ends a selection, not on every selection change: find selects its match, and copying that would overwrite the clipboard. Copy-on-select has no test because jsdom has no layout to drag across. Right-click never selects a word first (`rightClickSelectsWord` is off), so a right-click on macOS can't overwrite the clipboard before it pastes. The paste guard covers every route: the shortcut, right-click, and the native `paste` event that the Edit menu or the system sends. The question shows over the terminal, Cancel has the focus, and Escape cancels. Find selects the match as its highlight: highlighting every match needs xterm decorations, which need `allowProposedApi`. Enter finds the next match, Shift+Enter the previous one, and Escape closes find and leaves the match selected. With focus outside a terminal, the copy, paste and find keys keep their native meaning. Cmd+C and Cmd+V on macOS were not checked against Electron's default Edit menu. The shortcut table moved from `App.tsx` to `src/renderer/shortcuts.ts` so `TerminalView` can read it.
