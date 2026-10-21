# ProxyJump in v1

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

Does v1 support `ProxyJump` / bastion hosts, or is it out of scope?

Points to settle: whether the user has any host today that needs a jump host (the MobaXterm file has none, but `~/.ssh/config` might); if it's in, how the app chains the `ssh2` connections itself (tested and working, per "Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client"), which Credential reference each hop uses, and how the SFTP pane connects through the chain; if it's out, what the app shows when a Saved session's SSH config has `ProxyJump`.

Also settle: what the SFTP pane does for `ssh <host>` typed in a local shell Tab when `ssh -G` reports `ProxyJump` or `ProxyCommand`. Until this ticket decides, it shows "This host uses a jump host" and doesn't connect (from "SFTP pane for `ssh <host>` typed in a local shell Tab").

## Answer

Decided with the user on 2026-10-21.

1. The user has no host that needs a jump host. None of the six hosts in `~/.ssh/config` or the MobaXterm export uses `ProxyJump` or `ProxyCommand`.
2. v1 does not support jump hosts. The app never chains connections itself.
3. A Saved session that resolves to a jump host fails to connect with "This host uses a jump host. slop-term v1 can't connect to it." The app never connects without the jump.
4. Detection: before connecting, the app runs `ssh -G <alias>` with the `ssh` on the PATH and checks `proxyjump` and `proxycommand` in its output. This catches a jump set by `Host *` defaults or a `Match` block, not only one on the host's own entry. A value of `none` means no jump.
5. The SFTP pane for typed `ssh` keeps its decided behaviour and shows the same message as point 3, while the terminal works because the real `ssh` handles the jump. The user expects to type `ssh` rarely once the app runs, so this gets no more design.
6. The MobaXterm import keeps its rule: jump hosts are dropped and flagged in the preview.
