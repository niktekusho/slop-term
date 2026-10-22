# 05 — SSH Tab with key login and host key checks

**What to build:** Opening a Managed or Hand-written host opens an SSH Tab that logs in with a key or the SSH agent. Before connecting the app resolves the host with `ssh -G`, refuses jump hosts, and checks the host key against OpenSSH's `known_hosts`: an unknown host asks once inside the Tab, a changed key blocks until the user replaces it.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 04 — Session tree from SSH config

**Status:** ready-for-agent

- [ ] The resolver runs `ssh -G <alias>` with the `ssh` on PATH and connects `ssh2` 1.17.0 with its `HostName`, `Port`, `User` and `IdentityFile` values; login tries the agent, then the `IdentityFile` keys. A passphrase-protected key is out of this ticket (ticket 08).
- [ ] `proxyjump` or `proxycommand` other than `none` fails the connect with "This host uses a jump host. slop-term v1 can't connect to it."
- [ ] Host keys are read from and written to `~/.ssh/known_hosts` or what `UserKnownHostsFile` resolves to; the host name is the resolved `HostName` or `HostKeyAlias`, written `[host]:port` when the port isn't 22.
- [ ] An unknown host shows a question inside the Tab with alias, `host:port`, key type and SHA256 fingerprint in OpenSSH format; "Trust and connect" saves the key and connects; "Cancel" is the default; there is no "connect once".
- [ ] A changed key blocks with a red warning showing old and new fingerprints and the file and line of the old key; "Replace saved key" removes that line, saves the new key and connects after a confirm whose default is Cancel.
- [ ] `StrictHostKeyChecking accept-new` and `no` save an unknown key without asking; `ask` and `yes` ask; `UserKnownHostsFile /dev/null` saves nothing; a changed key always blocks, even with `no`.
- [ ] Hashed and plain entries are read; new entries are hashed when `HashKnownHosts yes` applies; `@cert-authority` and `@revoked` lines are ignored and kept.
- [ ] Key types already saved for the host go first in `ssh2`'s host key list; if the host offers none of them it counts as unknown and the question adds "A <type> key for this host is already saved".
- [ ] The back end keeps the key accepted for each Tab in memory for later connections on that Tab.
- [ ] Back-end tests against the Docker OpenSSH server: key login, agent login, unknown-host trust writes `known_hosts`, changed key blocks and replace works, `accept-new`, `/dev/null`, hashed write, jump-host refusal.
