# Saving passwords typed for `ssh <host>`

Type: grilling
Status: open
Blocked by:

## Question

How does the app save a password the user types for `ssh <host>` in a local shell Tab, where the host has no Saved session? Today it lives only in memory for its Tab (from "SFTP pane for `ssh <host>` typed in a local shell Tab").

Points to settle: how the app captures the password. One way is to set `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force` in the local shells the app starts, so `ssh` prompts go to an app dialog. It worked on Windows OpenSSH 9.5p2 (`research/mobaxterm-typed-ssh-browser.md`), but it needs a helper program and sends every prompt out of the terminal, `git` passphrases included. Where the saved password goes when there is no Saved session to hold a Credential reference: the keychain, or KeePass, which now writes (from "KeePass provider details"), and whether saving creates a Saved session. Whether the app suggests creating a key for the host instead. Many of the user's logins are shared accounts used by other teams, so changing that account's `authorized_keys` isn't always acceptable, and the suggestion needs a per-host way to skip it.
