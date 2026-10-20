# SFTP pane behaviour

Type: grilling
Status: open
Blocked by:

## Question

How does the SFTP pane behave for an SSH Tab?

Points to settle: whether it follows the terminal's current folder, as MobaXterm does, and how the app learns that folder (the shell's OSC 7 escape, polling `pwd` over a second channel, or not at all); what the pane shows and lets the user do (list, sort, hidden files, rename, delete, new folder, edit permissions); how uploads and downloads show progress, queue and handle a file that already exists; drag and drop to and from the OS on Windows and macOS; whether the pane opens a second SSH connection or a channel on the Tab's connection.
