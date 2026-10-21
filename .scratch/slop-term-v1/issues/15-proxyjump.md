# ProxyJump in v1

Type: grilling
Status: open
Blocked by:

## Question

Does v1 support `ProxyJump` / bastion hosts, or is it out of scope?

Points to settle: whether the user has any host today that needs a jump host (the MobaXterm file has none, but `~/.ssh/config` might); if it's in, how the app chains the `ssh2` connections itself (tested and working, per "Electron vs Electrobun vs Tauri for a TypeScript SSH/SFTP client"), which Credential reference each hop uses, and how the SFTP pane connects through the chain; if it's out, what the app shows when a Saved session's SSH config has `ProxyJump`.

Also settle: what the SFTP pane does for `ssh <host>` typed in a local shell Tab when `ssh -G` reports `ProxyJump` or `ProxyCommand`. Until this ticket decides, it shows "This host uses a jump host" and doesn't connect (from "SFTP pane for `ssh <host>` typed in a local shell Tab").
