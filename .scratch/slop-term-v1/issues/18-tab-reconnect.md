# Tab disconnect and reconnect

Type: grilling
Status: open
Blocked by:

## Question

What happens when an SSH Tab's connection drops, and how does it reconnect?

Points to settle: how the app notices a drop (keepalives, their interval, and whether `ServerAliveInterval` from SSH config is honoured); what the terminal shows once disconnected; whether reconnecting is automatic, with how many attempts and what delay, or done by a key or button as in MobaXterm; whether the old scrollback stays above the new session; how the Tab is marked in the tree while disconnected; how a reconnect reads the Credential reference again, or asks again for a password the user typed, given "SFTP pane behaviour" keeps typed passwords in memory for the Tab's lifetime; what a dropped local shell Tab does, if anything. "SFTP pane behaviour" relies on the result: the pane greys out on a drop, saves from editor sync wait for the connection, and the pane reopens at its last folder after reconnecting.
