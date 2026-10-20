# rsync for SFTP pane transfers

Research for ticket `issues/17-rsync-transfers.md`. Gathered 2026-10-20 on Windows 11 x64, with rsync tests run in WSL Ubuntu.

## Summary

- rsync cannot run inside the app. There is no maintained JavaScript or TypeScript implementation of the rsync wire protocol. To use rsync, the app spawns a local `rsync` binary, and the remote host also needs `rsync` installed.
- The local `rsync` does not need a local `ssh`. rsync talks to the remote side over the stdin and stdout of whatever program `-e` names. The app can name a small helper that relays those bytes into an `ssh2` exec channel running `rsync --server ...` on the transfer connection. That keeps the app's own auth, jump hosts and host key checks. I tested the stdio relay idea with a fake `-e` script in WSL. I did not test it on native Windows, because no Windows rsync is installed here.
- Windows has no rsync out of the box. Git for Windows 2.56 does not ship it (checked on this machine). The user would install MSYS2's `rsync` package (3.5.1) or cwRsync (6.5.0), or the app would bundle one of them.
- Recent macOS ships `openrsync` (protocol 29, a subset of the options) as `/usr/bin/rsync`. It may or may not ship the old samba rsync 2.6.9 next to it, depending on the macOS version.
- For whole-file uploads and downloads, rsync gains little over SFTP. Both run over the same encrypted SSH channel. SFTP can resume from an offset too.
- rsync gains a lot when a large file changes a little. In a WSL test, a 1-byte change in a 20 MB file sent about 27 KB. For small editor-sync files the saving is a few KB per save, and it costs a process spawn plus an rsync handshake on every save.
- The SFTP pane's "file already exists" question does not map onto rsync. rsync never asks per file. The app would have to check the target over SFTP first and pass the user's answers to rsync as options.
- Recommendation: stay on SFTP for v1. Offer rsync later, as an optional mode for large files, only if the user has it installed on both ends.

## Can rsync run over the app's ssh2 connection?

Yes, but only with a local `rsync` process. The app supplies the transport, not the protocol.

rsync runs a copy of itself on the remote host through a remote shell. The man page says "rsync must be installed on both the source and destination machines" and that "you can specify any remote shell you like, either by using the `-e` command line option, or by setting the `RSYNC_RSH` environment variable" ([rsync(1), SETUP](https://download.samba.org/pub/rsync/rsync.1)). The remote command is `rsync --server`, which the man page calls an internal option that "should never be typed by a user under normal circumstances" ([rsync(1), INTERNAL OPTIONS](https://github.com/RsyncProject/rsync/blob/master/rsync.1.md)).

Local test in WSL (rsync 3.2.7, protocol 31). I wrote a fake remote shell that drops the host name and runs the rest of the command locally:

```sh
#!/bin/sh
shift
echo "REMOTE CMD: $*" >&2
exec sh -c "$*"
```

Then I ran `rsync -e ./fakessh src/big.bin anyhost:/tmp/rt/dst/`. The 20 MB file arrived intact (`cmp` equal) in both directions. The commands rsync asked the "remote shell" to run were:

- upload: `rsync --server -e.LsfxCIvu . /tmp/rt/dst/`
- download: `rsync --server --sender -e.LsfxCIvu . /tmp/rt/src/big.bin`

So the transport is a plain byte pipe. In slop-term the `-e` program would be a helper shipped with the app, for example the Electron binary run with `ELECTRON_RUN_AS_NODE=1` and a small script. It connects back to the back-end utilityProcess over a named pipe or Unix socket. The utilityProcess calls `client.exec(remoteCommand)` on the transfer connection and pipes the channel to the helper's stdin and stdout. Nothing about `ssh2`'s exec channel prevents this, since the earlier stack research already ran `exec` on all three runtimes ([stack-options.md](stack-options.md)).

Untested pieces:

- A Windows rsync build (MSYS2 or Cygwin based) spawning a native Windows helper and talking to it over pipes. Cygwin-family programs normally handle this, but I could not test it here.
- Process start time for the helper. A Node-mode Electron start costs some hundreds of milliseconds, which matters for editor sync.

The other way is to let rsync run the system `ssh` with `-e ssh`. Windows ships OpenSSH in `C:\WINDOWS\System32\OpenSSH` (on PATH here) and macOS ships `ssh`. That path loses the app's own auth: Keychain passwords, its jump-host chaining and its known-hosts decisions would all have to be redone through `ssh` config and `SSH_ASKPASS`. It is the wrong fit for this app.

## Is there a JavaScript implementation of the rsync protocol?

No maintained one. I searched the npm registry for `rsync`, `rsync-protocol`, `node-rsync` and `rsyncjs` on 2026-10-20:

| Package | What it is |
|---|---|
| `rsyncwrapper` 3.1.0, `node-rsync` 1.0.3, `@mattlyons/rsync`, `gulp-rsync`, `grunt-rsync` | Wrappers that spawn the `rsync` binary |
| `drsync` 1.2.0-rc1 (2017) | Despite "over the native rsync protocol", its README says it "has a hard dependency on rsync" |
| `rsyncjs` 0.0.12 (2021) | A local directory copier with an rsync-like API. It does not speak the wire protocol |
| `@ai-ecoverse/wasm-rsync` 3.5.1-5 (2026-10-18) | Upstream rsync compiled to WebAssembly for the "slicc" kernel. "Local copies only for now", and "Remote shells (`-e ssh`) need an ssh client in the realm" ([README](https://github.com/ai-ecoverse/homescoop/tree/main/packages/rsync/package)). It needs that kernel, so it does not run in plain Node |

Writing one would mean starting from documentation that only covers an old protocol. The only written protocol description is openrsync's `rsync(5)` man page, which says it "is compatible with version 27 of the reference" ([Apple's openrsync rsync.5](https://github.com/apple-oss-distributions/rsync/blob/main/openrsync/rsync.5)). The openrsync README says "the protocol manpages should have all the information required" for a new implementation ([openrsync README](https://github.com/kristapsdz/openrsync)). Upstream rsync 3.5.1 speaks protocol 33 and still accepts clients down to protocol 20 (`PROTOCOL_VERSION 33`, `MIN_PROTOCOL_VERSION 20` in [rsync.h](https://github.com/RsyncProject/rsync/blob/master/rsync.h)), so a protocol 27 client would still be accepted. The work covers the file list, the generator, the sender and receiver roles, the rolling checksum, and MD4 block checksums. MD4 is available in Bun's BoringSSL and missing from Node 22's OpenSSL 3 (local test). I did not check Electron 44. This is a project of its own, not a feature of a personal SSH client.

## Getting rsync on Windows

Windows does not include rsync.

- **Git for Windows** does not ship it. On this machine, Git 2.56.0 has `ssh.exe` and friends in `C:\Program Files\Git\usr\bin` but no `rsync`. The request to add it, [git-for-windows/git#347](https://github.com/git-for-windows/git/issues/347), was closed in 2015. The maintainer asked for a pull request instead. Users add it by copying MSYS2's `rsync.exe` into Git's `usr\bin`.
- **MSYS2** has an `rsync` package, version 3.5.1-2, x86_64, GPL-3.0-or-later ([packages.msys2.org](https://packages.msys2.org/packages/rsync)). It links the MSYS2 runtime, so it uses `/c/...` style paths.
- **cwRsync** from Itefix is "a bare-bones Windows packaging of the rsync command-line tool" with SSH support, free edition 6.5.0 x64 ([itefix.net/cwrsync](https://itefix.net/cwrsync)). The page does not list the rsync version.
- **winget** has no rsync package. `winget search rsync` returned only rclone and other tools tagged "rsync" (checked on this machine). Chocolatey lists no plain `rsync` package either.
- **WSL** has rsync inside the Linux distribution (3.2.7 in Ubuntu here), but it reaches Windows files through `/mnt/c`. The app cannot count on WSL being installed.

Bundling MSYS2's `rsync.exe` with the app is possible. It needs `msys-2.0.dll` and the libraries rsync links (zlib, zstd, lz4, xxhash, popt, crypto), and it is GPLv3.

## Getting rsync on macOS

macOS ships openrsync, a BSD-licensed reimplementation, at protocol 29 (`RSYNC_PROTOCOL (29)` in Apple's [openrsync/extern.h](https://github.com/apple-oss-distributions/rsync/blob/main/openrsync/extern.h)). Its man page lists `--partial`, `--partial-dir`, `--progress`, `--ignore-existing`, `--backup`, `--suffix`, `--inplace` and `--append`, but its `--progress` text is only "Periodically report file transfer progress" ([openrsync.1](https://github.com/apple-oss-distributions/rsync/blob/main/openrsync/openrsync.1)). The openrsync README warns that it "accepts only a subset of rsync's command-line arguments".

Apple's source (tag `rsync-184`) still builds `rsync.samba` from rsync 2.6.9 (`PROTOCOL_VERSION 29` in [rsync/rsync.h](https://github.com/apple-oss-distributions/rsync/blob/main/rsync/rsync.h)) alongside openrsync. Reports say macOS 15.4 stopped installing `rsync.samba` and that 15.4 broke `--log-file` until 15.6 ([Apple Developer Forums thread 778978](https://developer.apple.com/forums/thread/778978)). I have no Mac to check what a current macOS installs. A user can also install rsync 3.x from Homebrew.

For the app this means the local rsync on macOS is a different implementation with a smaller option set. Every flag the app passes would need testing against openrsync.

## What the remote host needs

- An `rsync` binary on the PATH of a non-interactive exec, or a path the user supplies (`--rsync-path`). Most Linux distributions package rsync, but minimal containers, BusyBox systems and many appliances do not have it.
- Exec channels allowed. An SFTP-only account (`ForceCommand internal-sftp`, usually with `ChrootDirectory`) refuses exec, so rsync fails where SFTP works ([sshd_config(5)](https://man.openbsd.org/sshd_config)).
- A remote macOS host runs openrsync on the server side, which limits the options too.

The app would detect a missing remote rsync (exit code 127 from the exec, or rsync exit 12 "protocol data stream" errors) and fall back to SFTP.

## What rsync gains over SFTP

Whole-file transfers. Little. Both use the same SSH channel and the same encryption, and `ssh2` already offers `zlib@openssh.com` compression for SFTP ([ssh2 README](https://github.com/mscdex/ssh2#client-methods)). rsync's delta algorithm only helps when the target already has an older copy. rsync can verify a whole-file checksum after transfer, but SSH already protects every packet with a MAC. Resume after a broken connection works with rsync `--partial` and also with SFTP by reopening the file and writing from the current offset.

Upload of a changed large file. A big win. WSL test, 20 MB random file with 1 byte changed, `rsync -I --stats`:

- Literal data 8,944 bytes, matched data 19,991,056 bytes.
- 26,919 bytes sent and 26,873 received, against 20 MB for SFTP.

Note that without `-I` rsync's quick check (size and mtime) skipped the file. A same-size edit in the same second can look unchanged, so the app would pass `--checksum` or `-I` for editor sync.

Editor sync of a typical small file. A small win that costs more than it saves. WSL test, 4,000-byte file with 1 byte appended: 609 bytes sent and 71 received, against about 4 KB for an SFTP write. Each save would spawn the helper and rsync, open a new exec channel, start a remote rsync process, and run rsync's handshake and file list exchange. An SFTP write on an open SFTP session is a few requests on a channel that already exists. For files of a few KB the SFTP write is likely faster end to end. I did not time this.

Security. Old local rsync builds are a risk when the remote host is hostile. rsync 3.4.0 (15 Jan 2025) fixed CVE-2024-12086 "Server leaks arbitrary client files" and CVE-2024-12087 "Server can make client write files outside of destination directory using symbolic links" ([NEWS.md](https://github.com/RsyncProject/rsync/blob/master/NEWS.md)). A user-installed rsync can be any version.

## Progress, cancel, retry and "file already exists"

Progress. rsync prints text, not events. `--progress` prints the file name and then a line like `782,448B  63% 113,295B/s    0:00:04`, redrawn with carriage returns, and a final line with `(xfr#5, to-chk=169/396)` ([rsync(1), `--progress`](https://github.com/RsyncProject/rsync/blob/master/rsync.1.md)). The app parses these lines from stdout with `--outbuf=L`. The man page warns the rate "can be misleading if rsync's delta-transfer algorithm is in use". openrsync documents no format, so the parser would need a second set of rules on macOS.

Cancel. Kill the local rsync process. rsync exits with code 20 "Received SIGINT, SIGTERM, or SIGHUP" ([rsync(1), EXIT VALUES](https://github.com/RsyncProject/rsync/blob/master/rsync.1.md)). The app closes the exec channel, and the remote rsync stops when its stdin closes. By default rsync deletes the partial file. With `--partial-dir=.rsync-partial` it keeps it for the next run.

Retry. Run the same command again. With `--partial` or `--partial-dir`, rsync uses the partial file as the basis and sends only the rest.

"File already exists" (overwrite / skip / keep both). rsync has no per-file prompt. The app would check the target first over the SFTP browsing channel, which it already has, ask the user, and then run rsync with the answers:

- overwrite: the default.
- skip: `--ignore-existing`, or leave the file out of the list. In the WSL test `--ignore-existing` sent nothing for an existing target.
- keep both: transfer to a new name. rsync can copy a single file to a different name ([rsync(1), COPYING TO A DIFFERENT NAME](https://github.com/RsyncProject/rsync/blob/master/rsync.1.md)). `--backup --suffix=...` renames the old file instead, which is a different choice. The WSL test confirmed the remote side receives `-b --suffix=.bak`.

A dry run (`rsync -n -i`) can also list what would change. In the WSL test it printed `<f.sT...... small.txt` for a changed file. That costs an extra rsync round trip per transfer, and the SFTP `stat` the app already makes is cheaper.

So the SFTP pane's behaviour would stay the same, but the code would grow to two transfer engines with two progress parsers and one shared conflict check.

## Sources

- rsync man page source, master: <https://github.com/RsyncProject/rsync/blob/master/rsync.1.md> (also <https://download.samba.org/pub/rsync/rsync.1>)
- rsync protocol constants: <https://github.com/RsyncProject/rsync/blob/master/rsync.h>
- rsync NEWS: <https://github.com/RsyncProject/rsync/blob/master/NEWS.md>
- rsync releases (v3.5.1, 2026-09-21): <https://github.com/RsyncProject/rsync/releases>
- openrsync: <https://github.com/kristapsdz/openrsync>
- Apple's rsync and openrsync source: <https://github.com/apple-oss-distributions/rsync>
- Apple Developer Forums, macOS 15.4 rsync: <https://developer.apple.com/forums/thread/778978>
- MSYS2 rsync package: <https://packages.msys2.org/packages/rsync>
- cwRsync: <https://itefix.net/cwrsync>
- Git for Windows issue 347: <https://github.com/git-for-windows/git/issues/347>
- OpenSSH sshd_config(5): <https://man.openbsd.org/sshd_config>
- ssh2 README: <https://github.com/mscdex/ssh2>
- npm registry search API: <https://registry.npmjs.org/-/v1/search?text=rsync>
