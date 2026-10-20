# Can SFTP pane transfers use rsync?

Type: research
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

Can the SFTP pane's uploads and downloads use rsync instead of SFTP, and is it worth it?

Find out: whether rsync can run over the app's own `ssh2` connection (for example by starting `rsync --server` on an exec channel and speaking the rsync protocol from the app), or whether it needs the `rsync` and `ssh` binaries on the local machine; whether a maintained JavaScript implementation of the rsync protocol exists; how a user gets `rsync` on Windows (it isn't built in) and on macOS (which ships `openrsync` on recent versions); what the remote host needs; what rsync gains over SFTP for whole-file transfers and for the small repeated uploads of editor sync; how progress, cancel and the "file already exists" choice from "SFTP pane behaviour" would work with it.

## Answer

Stay on SFTP. rsync gains little for whole-file transfers and costs a second transfer engine.

1. No maintained JavaScript or TypeScript rsync library exists. The app would spawn a local `rsync` binary.
2. That binary needs no local `ssh`. `rsync -e <helper>` treats the remote shell as a stdin/stdout pipe, so a helper can relay it into an `ssh2` exec channel running `rsync --server`. A fake `-e` script in WSL moved 20 MB both ways intact. Native Windows was not tested.
3. Windows has no rsync. Git for Windows 2.56 lacks it, and winget has no package. MSYS2 `rsync` 3.5.1 and cwRsync 6.5.0 are GPLv3. Recent macOS ships `openrsync` (protocol 29, a subset of the options). The remote host needs `rsync` and must allow exec channels, which SFTP-only accounts refuse.
4. Gains, measured in WSL: a 1-byte change in a 20 MB file sent about 27 KB instead of 20 MB. A 4 KB editor-sync save sent 609 bytes, but each save pays a process spawn and an rsync handshake.
5. rsync never asks per file, so the "file already exists" choice needs an SFTP check first. Progress means parsing rsync's text output.

Findings: [research/rsync-transfers.md](../research/rsync-transfers.md)
