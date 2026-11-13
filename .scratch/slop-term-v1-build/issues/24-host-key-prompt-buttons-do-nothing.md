# 24 — Host key prompt buttons do not respond (bug)

**What is wrong:** Connecting to "example-host-testuser" shows the usual "Unknown host ..." prompt in the terminal. Clicking "Trust and connect" or "Cancel" does nothing. The prompt stays on screen and the mouse cursor stays a text caret over it.

**Blocked by:** none

**Status:** ready-for-agent

## Agent brief

**Category:** bug. **State:** ready-for-agent.

**Cause:** `TerminalView.tsx` loads `@xterm/addon-webgl`. The addon adds a `canvas.xterm-link-layer` with inline `z-index: 2` that covers the whole terminal. `.tab-prompt` in `src/renderer/index.css` is a later sibling with `position: absolute` and no `z-index`, so the canvas sits on top of it and takes every click. The caret cursor comes from `.xterm { cursor: text }`. This hits every Tab prompt, not only this host: `SecretPrompt` uses `.tab-prompt` too. Ticket 23's alias characters play no part. Tests pass because jsdom does no hit testing.

**Verified:** a hidden Electron window loaded `xterm.css`, `index.css`, xterm 6 with the WebGL addon, and a `.tab-prompt` with two buttons. `document.elementFromPoint` at each button's centre returned `canvas.xterm-link-layer`. With `.terminal { isolation: isolate }` added, it returned the buttons.

**Fix:** add `isolation: isolate` to the `.terminal` rule in `src/renderer/index.css`, with a one-line comment on why. This keeps every xterm `z-index` (2 to 11) inside the terminal, so later xterm layers can't cover the prompts either. Do not raise `.tab-prompt`'s `z-index` instead: xterm's scrollbar uses 11.

**Test seam:** none in jsdom. Check it in the real renderer: repeat the `elementFromPoint` hit test above in a hidden Electron window, or click both buttons in `pnpm start` against an unknown host.

- [ ] "Trust and connect" and "Cancel" on the unknown-host prompt respond to the mouse in `pnpm start`.
- [ ] The changed-key prompt's buttons and the password prompt (`SecretPrompt`) respond to the mouse.
- [ ] The paste confirmation (`.question`) and find bar (`.find`) still show above the terminal.

## Test coverage

jsdom does no hit testing, so no vitest test can cover these items. `24-hit-test/` next to this file loads `xterm.css`, `index.css`, xterm 6 with the WebGL addon, a `.tab-prompt` with two buttons, a `.question` and a `.find` in a hidden Electron window. It asks `document.elementFromPoint` what sits at each control's centre. Run it from the repo root:

```
pnpm exec electron .scratch/slop-term-v1-build/issues/24-hit-test/main.cjs
```

With the fix it prints `hit` for `trust`, `cancel`, `paste` and `find`. With `.terminal { isolation: auto }` swapped in, `trust` and `cancel` print `canvas.xterm-link-layer`. `HostKeyPrompt` (both variants) and `SecretPrompt` all render `section.tab-prompt` after the `.terminal` in `.terminals`, so the page's `.tab-prompt` covers them. The first item also asks for a manual click in `pnpm start` against an unknown host.
