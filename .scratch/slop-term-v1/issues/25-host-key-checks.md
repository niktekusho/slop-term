# Host key checks

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

How does the app check a host's key when it connects? `ssh2` checks nothing by itself: it hands the app the key through `hostVerifier`, and the app decides.

Points to settle: where known keys live, either OpenSSH's `~/.ssh/known_hosts`, which the terminal `ssh` in local shell Tabs also reads and writes, or a file of the app's own, and whether it syncs (today only `slop-term.conf` and `slop-term.json` sync, from "What goes in SSH config vs the Sidecar file"); whether the app honours `StrictHostKeyChecking`, `UserKnownHostsFile` and `HashKnownHosts` from SSH config; what the first connect to an unknown host shows and what accepting it does; what a changed key does, and how the user clears the old one; how the SFTP pane's second connection and the pane for a typed `ssh <host>` (from "SFTP pane for `ssh <host>` typed in a local shell Tab") check keys without asking twice; whether a reconnect (from "Tab disconnect and reconnect") asks again.

## Answer

Decided with the user on 2026-10-22.

1. Storage: the app reads and writes OpenSSH's `~/.ssh/known_hosts`, or whatever `UserKnownHostsFile` resolves to, so the app and the terminal `ssh` agree on every host. The file doesn't sync. Each machine asks once per host.
2. Unknown host: the question shows inside the Tab, where the terminal would be. It names the alias, `host:port`, the key type and the SHA256 fingerprint in OpenSSH's format. "Trust and connect" saves the key and connects. "Cancel" is the default. There is no "connect once".
3. Changed key: the app blocks the connect and shows a red warning with the old and new fingerprints and the file and line of the old key. "Replace saved key" removes that line, saves the new key and connects, after a confirm whose default is Cancel. The app never connects over a changed key without that step.
4. `StrictHostKeyChecking`: `accept-new` and `no` save an unknown key without asking, and `UserKnownHostsFile /dev/null` saves nothing. `ask` and `yes` ask. A changed key always blocks, even with `no`, which is stricter than OpenSSH.
5. Matching follows OpenSSH: the name is the resolved `HostName` from `ssh -G`, or `HostKeyAlias`, written as `[host]:port` when the port isn't 22. The app reads hashed and plain entries and writes hashed ones when `HashKnownHosts yes` applies. It ignores `@cert-authority` and `@revoked` lines and leaves them in the file.
6. MobaXterm import doesn't copy host keys. Imported hosts ask once on first connect.
7. The back end keeps the key accepted for each Tab in memory. The SFTP pane's transfer connection must present that key and never asks. A different key blocks it with the warning from point 3, shown in the pane. The transfer connection opens only on the first transfer, after the Tab has logged in (from "SFTP pane behaviour").
8. A reconnect uses the same in-memory key and doesn't ask again. A key that changed during the drop shows the warning from point 3.
9. Key types: before connecting, the app puts the key types already saved for the host first in `ssh2`'s host key list, as OpenSSH does. If the host offers none of them, the host counts as unknown, and the question adds "A <type> key for this host is already saved". The app doesn't learn extra keys the way `UpdateHostKeys` does.
10. The pane for a typed `ssh <host>` logs in only after the terminal's `ssh` has. The first OSC 7 from the remote shell connects it on its own. Until then it shows the "Browse files on alice@web1" button. So the terminal's `ssh` has already checked and saved the key, and the pane's own "Trust and connect" question shows only if the user clicks the button while `ssh` waits at its yes/no prompt. A changed key shows the warning from point 3 in the pane.

Changes "SFTP pane for `ssh <host>` typed in a local shell Tab": point 3 (see the correction there).

Rejected: a `LocalCommand` hook in `slop-term.conf` as the login signal, because it would run for every `ssh` on the machine and override the user's own `LocalCommand`. Detecting the terminal's switch to raw mode can come after v1 if the button gets annoying. It needs research on Windows ConPTY.
