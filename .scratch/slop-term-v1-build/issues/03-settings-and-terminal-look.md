# 03 — Settings and terminal look

**What to build:** The terminal looks the same on both machines and follows the OS light or dark mode. Per-machine preferences live in one `settings.json` in the app data folder, which Ctrl+, / Cmd+, opens in the configured editor and the app applies when the file is saved.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 01 — Walking skeleton: unsaved local shell Tab

**Status:** ready-for-agent

- [ ] `settings.json` lives in the app data folder (`%APPDATA%\slop-term\` on Windows), is not synced, and is watched: saving it applies the change without a restart. A missing file means defaults.
- [ ] Ctrl+, / Cmd+, opens `settings.json` in the configured editor (else `code`, else Notepad++, else the OS default).
- [ ] The UI and terminal follow the OS light or dark mode; a settings value forces `light` or `dark`.
- [ ] GitHub Dark and GitHub Light palettes with the exact colours from the spec.
- [ ] JetBrains Mono bundled at weights 500 and 700; `fontWeight` 500, `fontWeightBold` 700, `letterSpacing` 0.5, 12 px default. Settings can name a system font and size.
- [ ] Rendering uses `@xterm/addon-webgl` 0.19.0 and falls back to the DOM renderer when WebGL fails or loses its context.
- [ ] `minimumContrastRatio` is 7 in dark mode and 4.5 in light mode, fixed in code.
- [ ] Zoom in (Ctrl++ or Ctrl+=), out (Ctrl+-), reset (Ctrl+0) and Ctrl+wheel, Cmd on macOS, apply to the whole window and save the new size to settings.
- [ ] Scrollback length comes from settings, default 1,000.
- [ ] UI chrome uses GitHub Primer colours; light and dark share the layout.
- [ ] Back-end test: a change to `settings.json` on disk reaches the UI as a settings message. UI test: the theme switches with the OS mode and with the forced value.
