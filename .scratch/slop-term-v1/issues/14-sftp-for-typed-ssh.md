# SFTP pane for `ssh <host>` typed in a local shell Tab

Type: grilling
Status: open
Blocked by: 13

## Question

How does the app spot `ssh <host>` typed in a local shell Tab, and how does it open its own SFTP connection to that host?

Points to settle: how the app detects the command (watching typed input, the shell's window title, a shell integration script, or a "Browse files of..." action the user triggers); how it resolves `<host>` through SSH config, including Hand-written hosts and hosts with no entry at all; how it authenticates its separate connection when the Saved session has no Credential reference and the user typed the password into `ssh`; what the pane shows when the user leaves the remote host or chains `ssh` from it.
