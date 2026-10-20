# Stack memory: Electron vs Electrobun vs Tauri

Measured 2026-10-19 (Electron, Electrobun) and 2026-10-20 (Tauri) on Windows 11 x64. Follow-up to `stack-options.md`.

## Summary

On Windows, Tauri used the least RAM, Electron came second, and Electrobun used the most. The gaps are modest.

With one terminal, Tauri used 124 MB private working set (210 MB private bytes). Electron used 133 MB (210 MB) and Electrobun 165 MB (410 MB). With ten full tabs, Tauri used 468 MB, Electron 544 MB and Electrobun 540 MB.

Private working set is the RAM a process holds for itself, and Task Manager's Details tab shows it by default. Private bytes also count memory the process has committed but never touched. Bun commits about 190 to 235 MB that it does not touch, so Electrobun looks much worse on private bytes than on RAM.

All three stacks render with Chromium on Windows: Electron bundles its own copy, and Tauri and Electrobun use the system WebView2. So the web side costs about the same everywhere. The differences come from the back-end process:

- Tauri's Rust host holds 7 MB private working set.
- Electron's main process holds 39 MB.
- Electrobun's Bun process holds 31 MB, plus 5 MB for its launcher.

Each extra tab with a full 10,000-line scrollback cost 38 MB private working set in Tauri, 42 MB in Electrobun and 46 MB in Electron. Most of that is the xterm.js buffer in the web renderer, about 36 to 38 MB per full tab in every stack. The back ends differ:

- Electron's `node-pty` adds about 8 MB private working set (14 MB private bytes) per shell, because each PTY gets its own Node worker thread.
- Tauri's `tauri-plugin-pty` adds about 0.1 MB per shell.
- Bun's built-in terminal adds about 0.1 MB per shell.

For the user's usual 5 tabs with full scrollback, the estimate is 277 MB private working set for Tauri, 316 MB for Electron and 332 MB for Electrobun. With little scrollback it is much lower. MobaXterm 25.0 with 2 tabs used 140 MB private bytes in total on this machine. The lightest stack, Tauri, would use about 210 MB private bytes for 2 lightly used tabs.

One window per terminal costs about 100 MB private working set per extra window in Electron and Electrobun, more than twice the cost of a tab. Use tabs in one window. I did not measure this design in Tauri.

There is also a finding that is not about memory. `node-pty` interactive sessions do not work under Bun on this machine. Under Electrobun 2.0.4's bundled Bun 1.4.0, PowerShell exits about 1 second after it starts. Under Bun 1.4.3, the shell stays alive, but output only arrives when it exits. `stack-options.md` reported `node-pty` as passing on Bun. That test ran a one-shot command, which works on Bun 1.4.3 and fails on Bun 1.4.0. Bun 1.4.3's own `Bun.spawn({ terminal })` worked interactively, but Electrobun 2.0.4 ships Bun 1.4.0 and has no setting to choose a newer Bun.

For the choice:

- Tauri saves about 40 MB (5 tabs, full scrollback) compared with Electron, and about 9 MB on idle. The cost is a Rust back end (or a sidecar, which would add back a JS runtime's memory).
- Electron costs a little more and keeps the whole back end in TypeScript, with a working `node-pty`.
- Electrobun is the heaviest of the three and has the PTY problem above.

The Tauri numbers rest on one reading per scenario, so treat differences under about 5% as noise.

## Versions

| Component | Version |
|---|---|
| Electron | 44.9.0 (Chromium 152.0.7977.167, Node 24.22.0) |
| Electrobun | 2.0.4, built with Hutch 0.28.1, dev build, `bundleCEF: false` (system WebView2) |
| Bun inside Electrobun | 1.4.0 as shipped; 1.4.3 swapped in for the working-PTY variant |
| Tauri | tauri 2.12.4, tauri-plugin-pty 0.3.1 (portable-pty 0.9.0, ConPTY), webview2-com 0.39.1, tauri-pty (JS) 0.3.1 |
| Tauri build toolchain (in WSL Ubuntu 22.04) | rustc/cargo 1.99.1, target `x86_64-pc-windows-msvc`, cargo-xwin 0.23.1, clang/lld/llvm-tools from conda-forge |
| WebView2 Runtime | 155.0.4283.62 |
| @xterm/xterm / @xterm/addon-fit | 6.0.0 / 0.11.0 (default DOM renderer, no WebGL addon) |
| node-pty | 1.1.0 (`useConpty: true`) |
| OS / hardware | Windows 11 Pro 10.0.26200, Intel i5-1335U, 15.6 GB RAM |

## Method

I built one test app per runtime with the same renderer code. Each app wires it to its back end differently:

- Electron uses a preload script with `contextBridge` and IPC.
- Electrobun uses its typed RPC.
- Tauri uses `invoke` for its two app commands and the `tauri-pty` JS API for the PTY.

Each window is 1280x800. In Electron and Electrobun that is the outer size, which fits the terminal to 151 columns by 40 or 41 rows. In Tauri it is the inner size, which gives 153 by 43. The wider terminal makes each Tauri scrollback line about 1% larger, which works against Tauri.

Each terminal spawns a local `powershell.exe -NoLogo` through a PTY. All build files are in the session scratchpad, not in the repo.

I built the Tauri app in WSL by cross-compiling with `cargo xwin build --release --target x86_64-pc-windows-msvc`. The `tauri` crate has its `custom-protocol` feature on, so the exe embeds the frontend and does not need a dev server. The result is one 9.3 MB `memtest-tauri.exe` that runs on Windows against the installed WebView2 Runtime, with no installer.

Scenarios:

- **Baseline.** One window, one terminal, scrollback limit 10,000, not filled.
- **Filled.** The same as baseline, with 10,000 lines of 120 characters written into the scrollback. I added this so the per-tab cost can also be computed without the cost of filling the first tab.
- **Ten tabs.** One window, ten terminals, each filled the same way and each with its own PowerShell. Only the first one is visible; the others are `display: none`, as background tabs would be.
- **Ten windows.** Ten windows, one filled terminal and one PowerShell each. I did not run this for Tauri.

Runtime variants:

- **Electron.** `node-pty` in the main process. I set `backgroundThrottling: false`, because with the default, Chromium throttled timers in occluded windows and the scrollback fill stalled for minutes.
- **Electrobun, Bun 1.4.3 terminal.** The built app with `bin/bun.exe` replaced by Bun 1.4.3, using `Bun.spawn({ terminal })`. All shells stayed alive. Electrobun does not support this setup; I used it to get a working PTY.
- **Electrobun as shipped.** Bun 1.4.0 with `node-pty`. The shells exit about 1 second after they start, so this variant measures an app with dead terminals.
- **Tauri.** `tauri-plugin-pty` in the Rust host. All shells stayed alive.

Reading: a PowerShell script launched the app and waited for the renderer to report that every terminal was set up and filled. It then waited 10 seconds. It collected the whole process tree through `Get-CimInstance Win32_Process` (ParentProcessId), including `msedgewebview2.exe` children. It read private bytes (`PrivateMemorySize64`) and working set (`WorkingSet64`) from `Get-Process`, and private working set from the `Win32_PerfRawData_PerfProc_Process` counter. Then it killed the tree.

Each reading is a fresh launch. The Electron and Electrobun runs were interleaved across runtimes. Before measuring, each runtime got one discarded warm-up launch, which also creates the WebView2 user data folder on first use.

The totals leave out the PowerShell and `conhost.exe` processes, because each stack spawns the same ones. Each PowerShell costs about 45 to 62 MB private bytes, 66 to 86 MB working set and 25 to 33 MB private working set, plus 1.5 MB for its `conhost.exe`.

Summed working set overstates real use, because every Chromium process maps the same DLL pages and each process counts them again. Private working set does not have that problem and is the best single number for RAM.

Reading counts:

- **Electron and Electrobun.** I stopped the runs early so test windows would stop opening on the user's screen. Baseline and filled have 3 readings each, except Electrobun as shipped baseline, which has 2. Ten tabs and ten windows have 2 readings each, and their "median" is the mean of the two.
- **Tauri.** 1 reading per scenario, with one discarded warm-up, to keep windows from opening on the user's screen.
- **Dropped data.** I dropped one Electrobun reading that captured no processes. In one Electron ten-windows reading, PID reuse attached two Adobe processes to the tree, and I left them out.

Where a scenario had more than one reading, the readings stayed within 2% of each other for baseline and filled, and within 5% for tabs and windows.

## Results

Totals over the process tree, in MB, without the shells. n is the number of readings.

| Runtime | Scenario | n | Private bytes | Working set | Private working set |
|---|---|---|---|---|---|
| Tauri | Baseline | 1 | 209.8 | 404.3 | 124.4 |
| Tauri | Filled | 1 | 253.0 | 440.6 | 168.5 |
| Tauri | Ten tabs | 1 | 553.7 | 735.0 | 468.2 |
| Electron | Baseline | 3 | 210.1 | 382.6 | 133.1 |
| Electron | Filled | 3 | 261.4 | 434.4 | 182.7 |
| Electron | Ten tabs | 2 | 675.0 | 777.7 | 543.8 |
| Electron | Ten windows | 2 | 1270.2 | 1790.1 | 1013.5 |
| Electrobun, Bun 1.4.3 terminal | Baseline | 3 | 409.8 | 464.0 | 165.4 |
| Electrobun, Bun 1.4.3 terminal | Filled | 3 | 461.7 | 517.3 | 217.0 |
| Electrobun, Bun 1.4.3 terminal | Ten tabs | 2 | 775.4 | 829.0 | 539.5 |
| Electrobun, Bun 1.4.3 terminal | Ten windows | 2 | 1596.4 | 1839.1 | 1059.5 |
| Electrobun as shipped (shells dead) | Baseline | 2 | 453.6 | 482.9 | 181.5 |
| Electrobun as shipped (shells dead) | Filled | 3 | 503.5 | 533.5 | 230.2 |
| Electrobun as shipped (shells dead) | Ten tabs | 2 | 1077.6 | 929.4 | 624.6 |
| Electrobun as shipped (shells dead) | Ten windows | 2 | 1884.8 | 1931.9 | 1143.4 |

Per process type, median MB, as private bytes / working set / private working set:

| Process | Electron baseline | Electron ten tabs | Electrobun 1.4.3 baseline | Electrobun 1.4.3 ten tabs |
|---|---|---|---|---|
| Main (Electron) or Bun | 57.1 / 114.7 / 38.6 | 180.7 / 187.1 / 109.0 | 191.0 / 66.7 / 31.1 | 193.0 / 67.9 / 32.0 |
| Electrobun launcher.exe | | | 7.8 / 15.0 / 4.5 | 7.8 / 15.0 / 4.5 |
| Browser process (WebView2) | | | 42.8 / 122.5 / 31.9 | 42.6 / 121.0 / 31.7 |
| Renderer | 36.7 / 85.0 / 23.4 | 377.9 / 422.8 / 363.2 | 37.6 / 76.2 / 23.9 | 385.3 / 424.7 / 370.0 |
| GPU | 98.0 / 127.4 / 60.5 | 98.4 / 119.7 / 61.1 | 91.5 / 99.8 / 54.1 | 107.7 / 116.3 / 81.2 |
| Network service | 18.2 / 55.4 / 10.6 | 18.0 / 48.0 / 10.5 | 17.6 / 44.7 / 9.7 | 17.6 / 44.6 / 9.7 |
| Storage service | | | 13.1 / 24.3 / 5.7 | 13.1 / 24.3 / 5.7 |
| Crashpad handler | | | 8.5 / 15.3 / 4.7 | 8.4 / 15.3 / 4.7 |

Tauri, 1 reading each, same format:

| Process | Tauri baseline | Tauri ten tabs |
|---|---|---|
| Main (memtest-tauri.exe) | 11.2 / 32.6 / 7.0 | 12.1 / 33.4 / 7.7 |
| Browser process (WebView2) | 39.3 / 115.3 / 28.4 | 35.8 / 101.6 / 26.4 |
| Renderer | 34.9 / 69.4 / 21.0 | 360.4 / 399.9 / 344.8 |
| GPU | 85.1 / 100.0 / 47.6 | 106.0 / 114.4 / 68.6 |
| Network service | 17.8 / 46.4 / 10.0 | 18.0 / 45.1 / 10.2 |
| Storage service | 13.2 / 24.9 / 5.8 | 13.2 / 24.9 / 5.8 |
| Crashpad handler | 8.4 / 15.6 / 4.6 | 8.4 / 15.6 / 4.7 |

The Electron main process grows by 124 MB private bytes with ten shells, because `node-pty` starts one worker thread per PTY. The Tauri host grows by 0.9 MB for the same ten shells. Under Electrobun as shipped, `node-pty` on Bun grows the Bun process from 235 to 501 MB private bytes (46 to 134 MB private working set) for ten PTYs, even though the shells died.

In the ten-windows scenario the GPU process grows the most: Electron from 98 to 248 MB private bytes, WebView2 from 92 to 244 MB.

## Per-tab cost

Per-tab cost = (ten tabs minus baseline) / 9, as the brief asked. The baseline terminal is not filled, so this number also carries the cost of filling the first tab. The "vs filled" row uses (ten tabs minus filled) / 9 and leaves that out.

| Runtime | Basis | Private bytes | Working set | Private working set |
|---|---|---|---|---|
| Tauri | vs baseline | 38.2 | 36.7 | 38.2 |
| Tauri | vs filled | 33.4 | 32.7 | 33.3 |
| Electron | vs baseline | 51.7 | 43.9 | 45.6 |
| Electron | vs filled | 46.0 | 38.1 | 40.1 |
| Electrobun, Bun 1.4.3 terminal | vs baseline | 40.6 | 40.6 | 41.6 |
| Electrobun, Bun 1.4.3 terminal | vs filled | 34.9 | 34.6 | 35.8 |
| Electrobun as shipped | vs baseline | 69.3 | 49.6 | 49.2 |

Per extra window in the ten-windows design, (ten windows minus baseline) / 9, as private bytes / working set / private working set: Electron 117.8 / 156.4 / 97.8 MB, and Electrobun with Bun 1.4.3 131.9 / 152.8 / 99.3 MB. Not measured for Tauri.

Where the per-tab cost goes:

- **Renderer.** About 36 to 38 MB private bytes per full tab in all three stacks:
  - Electron renderer: 36.7 to 377.9 MB.
  - Electrobun WebView2 renderer: 37.6 to 385.3 MB.
  - Tauri WebView2 renderer: 34.9 to 360.4 MB.

  xterm.js stores each buffer line as typed arrays sized to the terminal width, so a 151-column terminal with 10,000 lines needs about 18 MB for the cells alone. JS objects and heap overhead account for the rest. A narrower window or a smaller scrollback limit lowers this cost in proportion.
- **Back end.** Per PTY:
  - Electron with `node-pty`: 13.7 MB private bytes (8.0 MB working set, 7.8 MB private working set).
  - Tauri with `tauri-plugin-pty`: about 0.1 MB.
  - Bun's built-in terminal: about 0.2 MB.
- **Shell.** Each PowerShell adds 45 to 62 MB private bytes outside the app. For SSH tabs that cost sits on the server, and the client pays only for the SSH session, which I did not measure.

## Estimate for 5 tabs, and MobaXterm

These are extrapolations from the measurements above (baseline plus 4 times the per-tab cost vs baseline), not measurements of 5 tabs.

| | Private bytes | Private working set |
|---|---|---|
| Tauri, 5 tabs, full scrollback | about 363 | about 277 |
| Electron, 5 tabs, full scrollback | about 417 | about 316 |
| Electrobun with Bun 1.4.3, 5 tabs, full scrollback | about 572 | about 332 |
| Tauri, 5 tabs, almost empty scrollback (lower bound: baseline plus 4 PTYs) | at least 210 | at least 125 |
| Electron, 5 tabs, almost empty scrollback (lower bound: baseline plus 4 node-pty workers) | at least 265 | at least 164 |
| MobaXterm 25.0 Personal, 2 tabs, measured by the coordinator | 139.8 (207.6 working set) | not recorded |

MobaXterm ran 6 processes, including a 24.1 MB private X server. Each MoTTY terminal process used about 11 to 12 MB private bytes. A tab in MobaXterm costs about as much as the `node-pty` back end of one Electron tab, with no 36 to 38 MB scrollback buffer on top. I don't know how full MobaXterm's scrollback was.

With two lightly used tabs, each stack would use about this many private bytes:

| Stack | 2 lightly used tabs | Compared with MobaXterm (140 MB) |
|---|---|---|
| Tauri | about 210 MB | 1.5 times |
| Electron | about 225 MB | 1.6 times |

With full scrollback the gap grows by 33 to 46 MB per tab. Most of that floor is the WebView2 or Chromium process set (browser, GPU, network, storage), about 165 to 175 MB private bytes, which no web-based stack avoids.

## Tauri

Measured here on Windows (see Results), with 1 reading per scenario. On Windows, Tauri runs the same WebView2 process set as Electrobun: browser, renderer, GPU, network, storage and crashpad. Those processes measured within a few MB of Electrobun's. The difference is the host process. Tauri's Rust host uses 11 MB private bytes and 7 MB private working set. Electrobun's `launcher.exe` plus `bun.exe` use 199 MB and 36 MB.

Tauri uses WebView2 on Windows and WKWebView on macOS ([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)).

Published numbers, for comparison:

- Tauri issue #5889 (Dec 2022) compared web apps in Tauri and Electron and argued that the official benchmark ignored shared memory. On Windows, Tauri used 399 MB vs Electron 318 MB for postman.com, and 370 MB vs 312 MB for vscode.dev. Tauri maintainers called the official benchmark a smoke test, not a scientific report, and said the result plausibly reflects WebKit vs Chromium ([tauri-apps/tauri#5889](https://github.com/tauri-apps/tauri/issues/5889)). My measurement found the opposite order for an xterm.js app on current WebView2. The issue measured heavy web apps with Resource Monitor, four years ago.
- Better Stack built one screen-recorder app in four frameworks and measured idle memory on macOS with Activity Monitor: Deno Desktop 98 MB, Tauri 109 MB, Electron 128 MB, Electrobun 208 MB (Electrobun with bundled Chromium). For Tauri they summed the main process (about 36 MB) and the webview processes. The page gives no framework versions and no sample count ([Better Stack, updated 2026-07-20](https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/)).

## macOS (not measured here)

- Electron bundles Chromium on macOS. Tauri, and Electrobun without CEF, use the system WKWebView, which runs web content in separate WebKit processes. A fair total has to include those processes; Better Stack notes that Tauri's main process alone looks deceptively small (about 36 MB).
- Tauri issue #5889 measured on macOS 12.6.1 and found WKWebView higher than Electron: 421 MB vs 337 MB (postman.com) and 429 MB vs 332 MB (vscode.dev). Safari itself used 471 MB on postman.com. The author concluded that WebKit uses more memory than Chromium for web apps.
- The Better Stack macOS test found the opposite order for a small app: Tauri 109 MB vs Electron 128 MB.
- So the published macOS data is mixed and depends on the page content. Neither source tested xterm.js. On Windows, the scrollback buffer dominated the per-tab cost and the host process set the baseline. If that holds on macOS, Tauri keeps its host-process advantage there, and the engine choice matters less than the scrollback limit. That is my inference, not a measurement.

## Not verified

- macOS: nothing measured.
- Tauri has 1 reading per scenario, and no ten-windows scenario.
- I did not check that Tauri's terminals displayed PowerShell output. The check only confirmed that all ten PowerShell processes were alive under the Tauri host.
- Ten tabs and ten windows have 2 readings each for Electron and Electrobun, not 3, because I stopped the runs early.
- Electrobun with a working PTY ran on a Bun binary that Electrobun 2.0.4 does not ship. Electrobun 2.0.4 has no setting to choose the Bun version.
- I tested `node-pty` on Bun with a 6-second interactive test outside Electrobun, on Bun 1.4.0 and 1.4.3. I did not look for the cause in `node-pty` or Bun.
- Electron ran from `electron.exe` with an app folder, not as a packaged app. Electrobun ran as a dev build. Tauri ran as a release exe without an installer. I expect packaging to change memory little, but I did not check.
- No SSH session was measured. The SSH client cost per connection is unknown for `ssh2` (Electron, Electrobun) and for `russh` (Tauri).
- xterm.js used its default DOM renderer. The WebGL addon would move work and memory into the GPU process.
- Each reading is a snapshot 10 seconds after the app was ready. I did not measure growth over hours.

What these tests installed outside the scratchpad:

- **Windows.** The Electrobun bootstrap ran the Hutch installer. It added `C:\Users\u20939\.hutch\bin` to the user PATH and downloaded toolchains into `C:\Users\u20939\.hutch`.
- **WSL.** Nothing went onto Windows for the Tauri build; everything went into the WSL user's home:
  - the `x86_64-pc-windows-msvc` Rust target, through rustup.
  - `cargo-xwin` 0.23.1 in `~/.cargo/bin`. It caches the MSVC CRT and Windows SDK files it downloads under `~/.cache/cargo-xwin`.
  - micromamba in `~/mm`, and a conda-forge environment `~/llvm-env` (1.3 GB) with clang, lld and llvm-tools. I used it because `sudo` needs a password in this WSL distro, so apt was not available.
  - the Cargo build output in `~/memtest-tauri-target`.

## Sources

- [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)
- [tauri-apps/tauri#5889, "Memory benchmark might be incorrect"](https://github.com/tauri-apps/tauri/issues/5889)
- [Better Stack, Tauri vs. Electron vs. Deno Desktop vs. Electrobun](https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/)
- [Microsoft, process model for WebView2 apps](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model): one browser process per user data folder, one or more renderers, and helper processes such as the GPU process.
- [Electron blog, Electron and WebView2 (2021-07-22)](https://www.electronjs.org/blog/webview2): "Every Electron application is a separate process tree"; WebView2 apps can share processes when they share a user data folder.
- Local measurements: scripts and raw readings in the session scratchpad (`memtest\measure.ps1`, `memtest\analyze.py`, `memtest\results.jsonl`), and the Tauri project in `memtest\tauri`.
