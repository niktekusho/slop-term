# Stack on macOS

Checked 2026-10-21 on macOS 15.7.4 arm64 with Electron 44.9.3 (Node 24.22.0). Follow-up to `stack-options.md`, which ran on Windows only, and the first build step named in `issues/09-choose-stack.md`.

## Summary

Every back-end piece works on macOS inside a real Electron `utilityProcess`, with `node-pty` 1.2.0-beta.15.

- `node-pty` 1.1.0: fails with `posix_spawnp failed.` as installed, because the npm tarball ships `prebuilds/darwin-*/spawn-helper` as `-rw-r--r--`. After `chmod +x` an interactive `zsh -l` streams output while it runs. Known upstream: [microsoft/node-pty#850](https://github.com/microsoft/node-pty/issues/850), still unreleased on `latest` ([microsoft/node-pty#919](https://github.com/microsoft/node-pty/issues/919)).
- `node-pty` 1.2.0-beta.15: ships `spawn-helper` as `-rwxr-xr-x`. The same tests pass with no extra install step. Not tested on Windows.
- `@napi-rs/keyring` 2.1.2: set, get and delete pass against the macOS login keychain. A read after delete returns `null`, not an error.
- `ssh2` 1.17.0 against OpenSSH in Docker: password auth, `exec` and SFTP `readdir` pass. It negotiated `aes128-gcm@openssh.com` with `curve25519-sha256@libssh.org`, as on Windows.
- Typed `ssh` detection: `ps -A -o pid=,ppid=,comm=,args=` lists the `ssh` waiting at its password prompt as a direct child of the Tab's zsh, with its full arguments.
- `ssh -G` (OpenSSH 9.9p2): resolves user, host and port, and reports `proxyjump` for `-J`. Two parsing details: `identityfile` lines keep `~` and list the default key names whether or not the files exist, and `serveraliveinterval 0` means unset, so "Tab disconnect and reconnect" must not treat 0 as shorter than 15 s.

## Not tested

- `node-pty` 1.2.0-beta.15 on Windows. Its ConPTY code changed during the 1.2 betas.
- A packaged app (`npm run package`). `spawn-helper` must sit outside the asar, and Forge's Vite plugin must copy the native modules into the package.
- Keychain access from a rebuilt app. A locally built app is signed ad hoc, so the login keychain may ask "Always Allow" again after each rebuild.
- xterm.js and its WebGL renderer in a window. Electron uses the same Chromium on both systems.
