# Stack options: Electron vs Electrobun vs Tauri

Research for ticket `issues/02-stack-options.md`. Gathered 2026-10-19 on Windows 11 x64.

## Summary

- The TypeScript SSH pieces (`ssh2`, `node-pty`, `@napi-rs/keyring`, `ssh-config`) all ran on both Bun 1.4.3 and Electron 44.9.0 in local tests on Windows. Nothing was tested on macOS.
- Electron and Electrobun can share one TypeScript back end that uses those packages. Tauri cannot run them in-process. It needs either a Rust back end (`russh`, `russh-sftp`, `portable-pty`, `keyring`) or a bundled Node/Bun sidecar process.
- Electron is the mature option and has a real-world precedent: electerm, a terminal/SSH/SFTP client "based on electron/node-pty/xterm" ([xterm.js README](https://github.com/xtermjs/xterm.js)). Its cost is size: 158.6 MB download zip, 369 MB unpacked for the Windows x64 runtime alone.
- Electrobun is young (1.x stable since February 2026, 2.0 since August 2026). It has 50 open Windows issues, and its maintainer says there is "no expectation" of issue review.
- Tauri 2 is stable (2.0.0 on 2024-10-02, now 2.12.x) and smallest, but it moves the SSH code out of TypeScript.
- On the facts, Electron is the low-risk choice for a TypeScript-first personal tool where installer size does not matter (v1 ships no installers). Electrobun is viable if the user accepts framework churn and Windows bugs. Tauri fits only if the user is willing to write the back end in Rust.

## Versions checked

| Package | Version | Released | Source |
|---|---|---|---|
| electron | 44.9.0 (Node 24.22.0) | 2026-10-17 | npm registry |
| electrobun | 2.0.4 | 2026-10-18 | npm registry, [releases](https://github.com/blackboardsh/electrobun/releases) |
| tauri (crate) / @tauri-apps/cli | 2.12.4 / 2.12.3 | 2026-10-14 | crates.io, npm |
| bun | 1.4.3 | local install | `bun --version` |
| ssh2 | 1.17.0 | 2025-08-20 | npm |
| node-pty | 1.1.0 | 2025-12-22 | npm |
| @xterm/xterm | 6.0.0 | 2025-12-22 | npm |
| @napi-rs/keyring | 2.1.2 | 2026-10-19 | npm |
| keytar | 7.9.0 | repo archived 2022-12-15 | [atom/node-keytar](https://github.com/atom/node-keytar) |
| ssh-config | 5.3.0 | 2026-09-11 | npm |
| russh / russh-sftp / russh-config | 0.64.1 / 3.0.1 / 0.58.0 | 2026 | crates.io |
| portable-pty / keyring (crate) | 0.9.0 / 4.2.0 | 2025-02 / 2026-08 | crates.io |

## Test method

I ran an OpenSSH server in Docker (`lscr.io/linuxserver/openssh-server`) and ran the same scripts under `bun` 1.4.3, Node 22.22.0, and `electron.exe` 44.9.0 with `ELECTRON_RUN_AS_NODE=1`. The scripts covered password auth, `exec`, an interactive `shell` with a PTY request, SFTP `fastPut`/`fastGet` of 20 MB with byte comparison, `readdir`, and a manual jump through `forwardOut` + `sock`. I also tested public-key auth with a passphrase-protected OpenSSH-format ed25519 key and a PEM RSA 3072 key. Electron-as-Node runs the same Node and BoringSSL build as the Electron main process, but I did not open a real `BrowserWindow`.

## ssh2 on each stack

`ssh2` is mostly pure JavaScript on top of Node's `crypto`. It has two optional native parts:

- `lib/protocol/crypto/build/Release/sshcrypto.node`, built by an `install` script (`node install.js` runs `node-gyp rebuild`). The build is allowed to fail: "Failed to build optional crypto binding" and exit 0 ([install.js in ssh2 1.17.0](https://github.com/mscdex/ssh2/blob/master/install.js)). It ships no prebuilds.
- `cpu-features`, an optional dependency used only to order ciphers.

On this machine (no C++ build tools) the binding did not build under either Bun or npm, so all tests ran on the pure-JS path (`bindingAvailable: false`).

Results:

| Check | Bun 1.4.3 | Node 22 | Electron 44 |
|---|---|---|---|
| Password auth, exec, shell with PTY | pass | pass | pass |
| SFTP 20 MB put/get, bytes equal | pass (435 / 399 ms) | pass (792 / 553 ms) | pass (644 / 471 ms) |
| ed25519 key with passphrase, RSA PEM key | pass | pass | pass |
| Jump host via `forwardOut` + `sock` | pass | pass | pass |
| Negotiated by default | curve25519-sha256, ssh-ed25519, aes128-gcm | same | same |
| `chacha20-poly1305@openssh.com` | not offered | works | not offered |

Bun and Electron both use BoringSSL. In both runtimes `crypto.getCiphers()` lists no `chacha20` entry, so `ssh2` filters `chacha20-poly1305@openssh.com` out of its cipher list (`canUseCipher` in `lib/protocol/constants.js`). AES-GCM and AES-CTR are still offered, and current OpenSSH servers accept those. Only a server restricted to ChaCha20 would fail. The native binding would add ChaCha20, but it is a NAN addon built against the local Node headers and OpenSSL major version, so treat it as unavailable on Bun and Electron.

Hosting constraint for Electrobun: the 2.x Hutch resolver "ignores existing lockfiles" and "lifecycle scripts never run" ([migrating to v2](https://framework.blackboard.sh/electrobun/guides/migrating-to-v2/)). `ssh2` is unaffected because its install script is optional. `node-pty`'s install script (`node scripts/prebuild.js || node-gyp rebuild`) is skipped too, but its prebuilt `.node` files ship inside the npm tarball. The project can also choose npm or Bun as the package manager instead of Hutch's resolver ([README](https://github.com/blackboardsh/electrobun)).

Tauri: the webview cannot run `ssh2`, since it has no Node `net` or `crypto`. The options are:
1. A Rust back end with `russh` (0.64.1) plus `russh-sftp` (3.0.1), exposed to the TypeScript UI through Tauri commands.
2. A Node or Bun sidecar bundled through `bundle.externalBin` ([sidecar docs](https://v2.tauri.app/develop/sidecar/)). The official Node sidecar guide uses `@yao-pkg/pkg` and talks over stdout ([guide](https://v2.tauri.app/learn/sidecar-nodejs/)). The sidecar adds a whole JS runtime, which removes most of Tauri's size advantage: `node.exe` is 82 MiB and `bun.exe` is 92 MiB on this machine. It also adds a second IPC hop for every terminal byte.

## ProxyJump

`ssh2` does not read `~/.ssh/config` and does not know `ProxyJump`. The source has no reference to `.ssh`, `config` paths, or `ProxyJump`. Its README documents "connection hopping": open `forwardOut` on the first connection and pass the stream as the `sock` option of the next `Client` ([README, Connection hopping and `sock`](https://github.com/mscdex/ssh2#connection-hopping)). I tested this and it works on all three runtimes. To honour `ProxyJump`, the app reads it from the parsed SSH config and chains the connections itself. Comma-separated multi-hop is a loop over the same call. `ProxyCommand` would need a spawned process piped into `sock`.

On the Rust side, `russh-config` 0.58.0 parses `ProxyJump` into a `proxy_jump` field. Its `stream()` helper covers `ProxyCommand` only, so jumps are also left to the app.

## Local shells and xterm.js

- `node-pty` 1.1.0 is an N-API addon (`node-addon-api`). It ships prebuilds for `win32-x64`, `win32-arm64`, `darwin-x64`, and `darwin-arm64`, so neither Bun nor Electron needs a rebuild. Its README says it uses ConPTY on Windows 1809+, with winpty as the fallback ([node-pty README](https://github.com/microsoft/node-pty)).
- Local test: I spawned `powershell.exe` through ConPTY (`useConpty: true`), resized it to 120x30, ran a command, and read the output and exit code. It passed on Bun 1.4.3 and in Electron 44. Bun says it implements Node-API "from scratch, so most existing Node-API extensions work with Bun out of the box" ([Bun Node-API docs](https://bun.com/docs/runtime/node-api)).
- The `node-pty` package is 64 MB unpacked, mostly `.pdb` debug files. A packaging step can drop the `.pdb` files and the prebuilds for other platforms.
- Tauri: `portable-pty` 0.9.0 is WezTerm's PTY crate and supports ConPTY. `tauri-plugin-pty` 0.3.1 is a small community plugin (about 51k total downloads) that wraps it.
- xterm.js 6.0.0 officially supports the latest Chrome, Edge, Firefox, and Safari, and its README says it "works seamlessly in Electron" ([xterm.js README](https://github.com/xtermjs/xterm.js#browser-support)). Electron renders it in Chromium on both OSes. Electrobun and Tauri render it in WebView2 (Chromium) on Windows and WKWebView (Safari engine) on macOS ([Electrobun architecture](https://framework.blackboard.sh/electrobun/guides/architecture/overview/)). That means two engines to test. Electrobun can bundle CEF to get Chromium everywhere, at about 125-161 MB per CEF archive in the 2.0.4 release assets.

## OS keychain

- `keytar` is dead: the repo was archived on 2022-12-15.
- `@napi-rs/keyring` 2.1.2 calls itself a "100% compatible node-keytar alternative" and wraps the Rust `keyring` crate ([repo](https://github.com/Brooooooklyn/keyring-node)). Local test on Bun and Electron: set, get, and delete passed. `cmdkey /list` showed a Windows Credential Manager entry `LegacyGeneric:target=tester.slop-term-research-test`. So it writes real Credential Manager items, which matches the glossary's "OS keychain" Credential provider. It ships prebuilds for win32 and darwin and has no install script. macOS is untested.
- Electron `safeStorage` is different. It only encrypts and decrypts strings, and the app stores the ciphertext itself. On Windows the key comes from DPAPI, which does not protect against other apps running as the same user ([Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)). It does not put items in Credential Manager, so it does not fit the Credential provider as defined.
- Tauri: the Rust `keyring` crate 4.2.0 is the same library underneath. `tauri-plugin-stronghold` is an encrypted vault, not the OS keychain.

## SSH config library with write-back

`ssh-config` 5.3.0 ([cyjake/ssh-config](https://github.com/cyjake/ssh-config)) is pure JS with no dependencies, so it runs anywhere, including a Tauri webview. It had 0 open issues on 2026-10-19. Local round-trip test on a config with comments, `Include`, a multi-alias `Host`, `ProxyJump`, tab indentation, and `Match`:

- Full-line comments, blank lines, ordering, indentation (including tabs), and `Match` blocks survive `parse` followed by `stringify`.
- One loss: the whitespace before an end-of-line comment collapses. `ServerAliveInterval 30   # keepalive` comes back as `ServerAliveInterval 30# keepalive`. OpenSSH still reads it correctly, but the file text changes.
- You can edit a value in place, and `append` and `remove` work. `remove({Host: 'bastion'})` left the comment above the removed block in place. `append` after a `Match` block indented the new `Host` block to the Match block's indent level. OpenSSH still parses that correctly, but it looks odd.
- `find({Host: 'app1 app1-alias'})` does not match a multi-alias `Host` line, whose value is an array of `{val}` objects. Use the predicate form instead.
- `compute(host)` does not follow `Include`. It returns the `Include` line as an ordinary key. The app has to read included files itself if it needs them.
- `compute('app1')` returned `ProxyJump: 'bastion'`, so the ProxyJump value is available for the jump logic above.

I found no other maintained JS library that preserves comments on write. On the Rust side, `ssh2-config` and `russh-config` only read.

## Maturity, Windows quality, size

| | Electron | Electrobun | Tauri |
|---|---|---|---|
| Status | 44.x stable; major every 8 weeks (43.0.0 on 2026-06-30, 44.0.0 on 2026-08-25) | 2.0.4 stable; 1.x stable from 2026-02-08, 2.0.1 on 2026-08-22 with breaking build changes (Hutch) | 2.x stable since 2024-10-02 |
| Back-end language | Node (TypeScript) | Bun (TypeScript); experimental Cottontail runtime | Rust (or a sidecar) |
| Windows | Chromium bundled, long track record | Windows 11+ x64 "Official", ARM64 "Beta" ([README](https://github.com/blackboardsh/electrobun)). 50 open issues match "windows" out of 124 open, for example #569 (Ctrl+N in WebView2 opens a stray window), #514 (installed app gets a separate taskbar entry), #535 (unattended updates never apply), #571 (idle tray app grew to about 30 GB) | WebView2, which ships with Windows 11 |
| macOS | Chromium bundled | macOS 14+ "Official", WKWebView | WKWebView |
| Maintenance | Large org (OpenJS) | One main maintainer: "no expectation that I will review, respond to, or merge" issues or PRs; 12.9k stars | Large org |
| Size | Runtime zip 158.6 MB, 369 MB unpacked (win32-x64 44.9.0, measured) | No figure in current docs. Bundles the Bun runtime (`bun.exe` is 92 MiB uncompressed) zstd-compressed, plus the system webview. CEF adds about 125-161 MB. Not measured | "a minimal Tauri app can be less than 600KB" ([Tauri docs](https://v2.tauri.app/start/)). A sidecar adds about 80-90 MiB |

Size matters little here: v1 is a personal tool with no installers or auto-update (map notes).

## What the facts favour

The main split is whether SSH, PTY, and keychain code stays in TypeScript.

- Electron keeps it all in TypeScript, and every piece passed the tests. electerm is an existing Electron + node-pty + xterm.js SSH/SFTP client with the same feature set. The costs are a large runtime and an eight-week major-version cadence.
- Electrobun keeps the same TypeScript code, since the same packages passed on Bun. The costs are framework churn (a v2 rewrite of the build six months after 1.x), the open Windows bugs above, two webview engines unless CEF is bundled, and a single maintainer.
- Tauri means either Rust for the back end or a sidecar that cancels its size win.

For a personal TypeScript tool on Windows and macOS, the facts favour Electron, with Electrobun as a credible second choice. The choice belongs to `09-choose-stack`.

## Not verified

- Nothing ran on macOS (keychain, `node-pty` prebuilds, WKWebView rendering of xterm.js).
- No Electrobun or Tauri app was built. Bundle sizes for those two come from docs or are estimates.
- `ssh2`'s native crypto binding was not built, because no C++ toolchain was installed.
