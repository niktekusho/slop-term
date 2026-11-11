# What would a Rust version of slop-term take?

Type: research
Status: open
Blocked by:

## Question

What would converting slop-term to Rust take, and what would it save?

"Choose the stack" kept this open: the back end talks to the UI only by IPC messages, so a Rust back end can replace the TypeScript one.

Find out:
- Which Rust crates replace what the back end uses today: SSH and SFTP (`russh`, `russh-sftp`, `ssh2`), the shell pseudo-terminal (`portable-pty`), the keychain (`keyring`), an SSH config parser that keeps comments and order, a KeePass reader (`kdbx-rs` or similar), and an HTTP client for the TPM API. Note maturity and Windows and macOS support for each.
- Which target shapes exist: Tauri with a webview UI and a Rust back end, a native UI (egui, Slint, others), or Electron with a Rust sidecar. For each, whether xterm.js stays and what replaces it otherwise.
- What the numbers in `research/stack-memory.md` say about Tauri against Electron now, and whether a native UI would cut memory further.
- Whether the IPC boundary allows moving one piece at a time, and which piece is the cheapest first step.
- Which v1 features have no Rust equivalent yet.
