# 05 — SSH Tab with key login and host key checks

**What to build:** Opening a Managed or Hand-written host opens an SSH Tab that logs in with a key or the SSH agent. Before connecting the app resolves the host with `ssh -G`, refuses jump hosts, and checks the host key against OpenSSH's `known_hosts`: an unknown host asks once inside the Tab, a changed key blocks until the user replaces it.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 04 — Session tree from SSH config

**Status:** done

- [x] The resolver runs `ssh -G <alias>` with the `ssh` on PATH and connects `ssh2` 1.17.0 with its `HostName`, `Port`, `User` and `IdentityFile` values; login tries the agent, then the `IdentityFile` keys. A passphrase-protected key is out of this ticket (ticket 08).
- [x] `proxyjump` or `proxycommand` other than `none` fails the connect with "This host uses a jump host. slop-term v1 can't connect to it."
- [x] Host keys are read from and written to `~/.ssh/known_hosts` or what `UserKnownHostsFile` resolves to; the host name is the resolved `HostName` or `HostKeyAlias`, written `[host]:port` when the port isn't 22.
- [x] An unknown host shows a question inside the Tab with alias, `host:port`, key type and SHA256 fingerprint in OpenSSH format; "Trust and connect" saves the key and connects; "Cancel" is the default; there is no "connect once".
- [x] A changed key blocks with a red warning showing old and new fingerprints and the file and line of the old key; "Replace saved key" removes that line, saves the new key and connects after a confirm whose default is Cancel.
- [x] `StrictHostKeyChecking accept-new` and `no` save an unknown key without asking; `ask` and `yes` ask; `UserKnownHostsFile /dev/null` saves nothing; a changed key always blocks, even with `no`.
- [x] Hashed and plain entries are read; new entries are hashed when `HashKnownHosts yes` applies; `@cert-authority` and `@revoked` lines are ignored and kept.
- [x] Key types already saved for the host go first in `ssh2`'s host key list; if the host offers none of them it counts as unknown and the question adds "A <type> key for this host is already saved".
- [x] The back end keeps the key accepted for each Tab in memory for later connections on that Tab.
- [x] Back-end tests against the Docker OpenSSH server: key login, agent login, unknown-host trust writes `known_hosts`, changed key blocks and replace works, `accept-new`, `/dev/null`, hashed write, jump-host refusal.

Checked on Windows (2026-10-26, Windows 11 Pro 26200, OpenSSH_for_Windows 9.5p2) with the full suite: the SSH tests run against `lscr.io/linuxserver/openssh-server` and skip with a warning when Docker isn't running. The agent test uses a small agent built on `ssh2`'s `AgentProtocol`, reached through `SSH_AUTH_SOCK`. The app was not run live. OpenSSH finds `~` from the user account, not from `HOME` or `USERPROFILE`, so when `HOME` points away from the account home, as in tests, the resolver runs `ssh -F ~/.ssh/config -G` with `~` from Node's home folder. In the app the two match and it runs plain `ssh -G`, which also reads the system-wide `ssh_config`. Paths that `ssh -G` expands itself, such as a default `UserKnownHostsFile` or an `Include ~/...`, still come from the account home, so the tests name those files by absolute path. Without `SSH_AUTH_SOCK` the agent on Windows is `\\.\pipe\openssh-ssh-agent`. A host is opened by double-clicking its row or pressing Enter on it. Its Tab shows under Unsaved until ticket 06 moves Tabs under their session. The question covers the Tab's terminal. ssh2's handshake timeout is off, so the question can wait; if the server drops the connection first, the question disappears and nothing is saved. A cancelled question, a jump host or a failed connect prints its reason in the Tab and leaves it open with no connection, until ticket 09 adds reconnect. Keys typed before the remote shell opens are dropped. known_hosts matching covers exact names and `|1|` hashes, not `*` or `!` patterns. "Replace saved key" removes only the first saved key of that type when several are saved. The accepted key is kept on the Tab, but nothing reads it until reconnect. ssh2's optional native helpers (`cpu-features`, `sshcrypto.node`) stay out of the back-end bundle, and `pnpm package` builds.
