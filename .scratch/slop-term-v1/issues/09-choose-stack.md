# Choose the stack

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by: 02, 07

## Question

Using the findings in "Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client", which desktop stack, SSH/SFTP library, terminal component and SSH-config library does v1 use?

## Answer

v1 is an Electron 44 app with a React + TypeScript UI and a TypeScript back end.

1. Desktop runtime: Electron 44. The user cares more about memory than download size. Tauri used the least memory, but only about 40 MB less than Electron at 5 full Tabs, and that saving needs a Rust back end. A native Rust rewrite stays possible once the v1 features are in (see the map's out-of-scope list).
2. Terminal: xterm.js 6 (`@xterm/xterm`) with the `fit` addon. Add other addons when a feature needs them.
3. Scrollback: 1,000 lines per Tab by default (about 3.8 MB for a full Tab), and the user can change it. Where the setting lives belongs to "Keyboard shortcuts, themes and fonts".
4. SSH and SFTP: `ssh2` 1.17.0. Electron uses BoringSSL, so `chacha20-poly1305` is unavailable. AES-GCM and AES-CTR work.
5. Local shells: `node-pty` 1.2.0-beta.15, pinned exactly, using ConPTY on Windows. 1.1.0, npm's `latest`, ships the macOS `spawn-helper` without the execute bit (microsoft/node-pty#919). Each shell costs about 14 MB private bytes.
6. SSH config: `ssh-config` 5.3.0.
7. Keychain: `@napi-rs/keyring` (from "Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client").
8. Processes: the whole back end (`ssh2`, `node-pty`, keychain, config files) runs in one Electron `utilityProcess` from the start. The main process only manages windows and relays messages. The UI talks to the back end only by IPC messages, so a later Rust back end can replace it. Worker threads are not used for `node-pty`, because its README says it is not thread safe. Add worker threads only for CPU-heavy work that shows up later.
9. Profiling from the first build:
   - `npm run start:profile` starts the app with `--inspect` on the main process and on the back-end `utilityProcess` (through its `execArgv`), so Chrome DevTools can attach to both. The renderer already has DevTools.
   - A hidden view, opened by a keyboard shortcut, lists `app.getAppMetrics()` (CPU and memory per process) every 2 seconds.
   - The same view can record a Chrome trace with Electron's `contentTracing` and save it to a file.
10. Tooling: Electron Forge with the Vite + TypeScript template, and npm. On 2026-10-20, Forge's Vite plugin (7.11.2) is still marked experimental, which means minor releases may break things, with migration steps in the release notes. electron-vite's own maintainer recommends Forge. Pin the Forge version.
11. Distribution: no installer. Clone the repo and run `npm run package` on each machine. A locally built macOS app gets no quarantine flag.
12. Tabs live in one window. Each extra window costs about 100 MB.

The first build step runs the test scripts from "Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client" on a Mac. It is a build task, not a map ticket.

Correction to "Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client": `node-pty` interactive shells do not work on Bun. Under Electrobun 2.0.4 (Bun 1.4.0) PowerShell exits after about 1 second. Under Bun 1.4.3 output arrives only when the shell exits. The earlier test ran only one-shot commands.

Memory measurements (Electron, Electrobun, Tauri, MobaXterm): [research/stack-memory.md](../research/stack-memory.md)

Addition (2026-10-21): the back end also works on macOS 15 arm64 inside an Electron 44 `utilityProcess`. `node-pty` 1.1.0 fails there because npm installs `spawn-helper` without the execute bit, so the stack pins 1.2.0-beta.15, which ships it executable. The beta also works on Windows 11 (see the 2026-10-23 note in build ticket 01). A packaged build and keychain prompts after a rebuild are still untested: [research/stack-macos.md](../research/stack-macos.md)
