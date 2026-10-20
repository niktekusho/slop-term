# Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client

Type: research
Status: resolved
Blocked by:

## Question

Which desktop stack fits a TypeScript SSH/SFTP GUI client on Windows and macOS: Electron, Electrobun, or Tauri?

Find out for each:
- Can it run the `ssh2` npm package (or an equal SSH/SFTP library)? For Electrobun, does `ssh2` work on Bun, including its native crypto parts?
- How it hosts xterm.js and spawns local shells with a pseudo-terminal (`node-pty` or equivalent) on Windows (ConPTY) and macOS.
- How it reaches the OS keychain (e.g. `keytar` or its successors, or native APIs).
- Maturity: release status, Windows support quality, bundle size.

Also find an SSH-config parsing library that can write the file back and keep the user's comments and ordering, and check whether `ssh2` honours `ProxyJump`.

## Answer

`ssh2`, `node-pty` (ConPTY), `@napi-rs/keyring` (writes real Windows Credential Manager items) and `ssh-config` all passed local tests on both Bun 1.4.3 and Electron 44.9.0 on Windows. Nothing was tested on macOS.
Electron and Electrobun can share one TypeScript back end. Tauri needs Rust (`russh`, `russh-sftp`, `portable-pty`, `keyring`) or a Node/Bun sidecar of about 80-90 MiB.
On Bun and Electron (both BoringSSL), `ssh2` drops ChaCha20 but keeps AES-GCM/CTR. `ssh2` ignores `~/.ssh/config`, so the app must read `ProxyJump` and chain the connections itself through `forwardOut` + `sock` (tested, works).
`ssh-config` 5.3.0 round-trips comments and ordering. It loses the spacing before end-of-line comments and does not follow `Include`. `keytar` has been archived since 2022.
Electrobun 2.x is young: 50 open Windows issues and a single maintainer. Electron is mature but 158.6 MB zipped. The facts favour Electron, with Electrobun second.

Findings: [research/stack-options.md](../research/stack-options.md)

Correction (2026-10-20): `node-pty` interactive shells do not work on Bun. The test above ran one-shot commands only. See [research/stack-memory.md](../research/stack-memory.md).
