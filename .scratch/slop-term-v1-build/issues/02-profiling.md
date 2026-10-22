# 02 — Profiling

**What to build:** The user can see where memory and CPU go from the first build. `npm run start:profile` starts the app with inspectors on the main process and the back-end `utilityProcess`. Ctrl+Shift+M / Cmd+Shift+M opens a panel under the terminal listing CPU and memory per process every 2 seconds, with a button that records a Chrome trace to a file.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 01 — Walking skeleton: unsaved local shell Tab

**Status:** ready-for-agent

- [ ] `npm run start:profile` passes `--inspect` to the main process and, through `execArgv`, to the back-end `utilityProcess`; Chrome DevTools can attach to both.
- [ ] Ctrl+Shift+M (Windows) / Cmd+Shift+M (macOS) opens and closes the profiling panel under the terminal.
- [ ] The panel lists `app.getAppMetrics()` (CPU and memory per process) refreshed every 2 seconds.
- [ ] The panel records a Chrome trace with `contentTracing` and saves it to a file the user picks.
- [ ] UI test: the shortcut toggles the panel and the panel renders metrics from the fake back end.
