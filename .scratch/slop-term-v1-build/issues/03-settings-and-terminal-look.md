# 03 — Settings and terminal look

**What to build:** The terminal looks the same on both machines and follows the OS light or dark mode. Per-machine preferences live in one `settings.json` in the app data folder, which Ctrl+, / Cmd+, opens in the configured editor and the app applies when the file is saved.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 01 — Walking skeleton: unsaved local shell Tab

**Status:** ready-for-agent

- [x] `settings.json` lives in the app data folder (`%APPDATA%\slop-term\` on Windows), is not synced, and is watched: saving it applies the change without a restart. A missing file means defaults.
- [x] Ctrl+, / Cmd+, opens `settings.json` in the configured editor (else `code`, else Notepad++, else the OS default).
- [x] The UI and terminal follow the OS light or dark mode; a settings value forces `light` or `dark`.
- [x] GitHub Dark and GitHub Light palettes with the exact colours from the spec.
- [x] JetBrains Mono bundled at weights 500 and 700; `fontWeight` 500, `fontWeightBold` 700, `letterSpacing` 0.5, 12 px default. Settings can name a system font and size.
- [x] Rendering uses `@xterm/addon-webgl` 0.19.0 and falls back to the DOM renderer when WebGL fails or loses its context.
- [x] `minimumContrastRatio` is 7 in dark mode and 4.5 in light mode, fixed in code.
- [x] Zoom in (Ctrl++ or Ctrl+=), out (Ctrl+-), reset (Ctrl+0) and Ctrl+wheel, Cmd on macOS, apply to the whole window and save the new size to settings.
- [x] Scrollback length comes from settings, default 1,000.
- [x] UI chrome uses GitHub Primer colours; light and dark share the layout.
- [x] Back-end test: a change to `settings.json` on disk reaches the UI as a settings message. UI test: the theme switches with the OS mode and with the forced value.

`fontSize` in `settings.json` is the zoom: the window zoom factor is `fontSize / 12` and the terminal stays at 12 CSS px, so zoom scales the tree too. Zoom keys step it by 1 between 6 and 36. `sessionColourTint` waits for "Session colours". Forcing `light` or `dark` also sets `nativeTheme.themeSource`, so the Windows title bar follows it. Ctrl+, writes the defaults into a missing `settings.json` before opening it. `updateSettings` refuses to save over a file that isn't valid JSON.

Windows run (2026-10-23, Windows 11 Pro 26200, `pnpm start`, driven over the DevTools protocol): JetBrains Mono loaded at 500 and 700, WebGL drew the terminal, the window followed the light OS mode, and `"theme": "dark"` saved by hand switched it live. Ctrl+=, Ctrl++, Ctrl+- and Ctrl+0 zoomed and saved 13, 14, 13 and 12, and Electron's default menu added no zoom of its own. Ctrl+, opened the file in the running VS Code. A font change re-fit the grid without a resize. Ctrl+wheel was checked with an in-page `WheelEvent` only, because the protocol's wheel event never reached the page. Not run on macOS; a Finder-launched app may lack `/usr/local/bin` on PATH, so Cmd+, would fall back to `open`.
