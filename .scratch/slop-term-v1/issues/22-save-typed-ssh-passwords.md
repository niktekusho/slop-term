# Saving passwords typed for `ssh <host>`

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

How does the app save a password the user types for `ssh <host>` in a local shell Tab, where the host has no Saved session? Today it lives only in memory for its Tab (from "SFTP pane for `ssh <host>` typed in a local shell Tab").

Points to settle: how the app captures the password. One way is to set `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force` in the local shells the app starts, so `ssh` prompts go to an app dialog. It worked on Windows OpenSSH 9.5p2 (`research/mobaxterm-typed-ssh-browser.md`), but it needs a helper program and sends every prompt out of the terminal, `git` passphrases included. Where the saved password goes when there is no Saved session to hold a Credential reference: the keychain, or KeePass, which now writes (from "KeePass provider details"), and whether saving creates a Saved session. Whether the app suggests creating a key for the host instead. Many of the user's logins are shared accounts used by other teams, so changing that account's `authorized_keys` isn't always acceptable, and the suggestion needs a per-host way to skip it.

## Answer

Decided with the user on 2026-10-21.

1. The app saves only what the user types into the SFTP pane's own password prompt (from "SFTP pane for `ssh <host>` typed in a local shell Tab" point 4). There is no `SSH_ASKPASS`, so the terminal's `ssh` stays stock and asks every time. The pane's `ssh2` login proves the password before anything is saved. To skip the terminal's prompt, the user opens the host as a Saved session Tab.
2. The prompt has "Save to: keychain / KeePass / don't save". KeePass shows only when a database is set up on this machine. Keychain is the default, here and on every other save prompt (a change to "Credential provider interface" point 5). The app doesn't remember a "don't save" per host.
3. Save is offered when the pane logged in with the `password` method, or with `keyboard-interactive` that asked exactly one hidden prompt in one round. Next time the app answers that prompt with the saved secret. Any other login, such as 2FA, gets no save choice and asks on every connect.
4. A host with a matching Saved session but no Credential reference, Managed or Hand-written: saving attaches the reference to that Saved session in the Sidecar file. A Hand-written host doesn't have to move in.
5. A host with no matching Saved session: saving creates a Managed Saved session with `HostName`, `User` and `Port` from the `ssh -G` output, and puts the reference in the Sidecar file. The Managed config is included at the top of `~/.ssh/config`, so the new entry also applies to the user's own `ssh`, with the values `ssh` already resolved. With keychain as the default, ad-hoc hosts collect in the tree unless the user picks "don't save". The user accepted that.
6. The prompt has an alias field, prefilled with the typed host slugified by the import rules ("How MobaXterm sessions map onto slop-term" point 3). If that alias is taken, it prefills `<user>-<host>`, so `ssh bob@web1` next to alice's `web1` gives `bob-web1`. The app checks the alias straight away: it must be legal and unused.
7. The prompt has a folder dropdown listing existing folders plus "Top level". It starts on the folder the last save from this prompt used, or "Top level" the first time, and remembers it in the per-machine `settings.json`. It can't create folders. With KeePass, the group picker starts on the group named like the chosen folder, as in "KeePass provider details" point 6.
8. Matching a later `ssh` (a change to point 6 of "SFTP pane for `ssh <host>` typed in a local shell Tab"): the alias and user rule comes first. If it finds nothing, the app takes the first Saved session in tree order whose `HostName`, `Port` and `User` equal the `ssh -G` output and that has a Credential reference. So `ssh bob@web1` finds `bob-web1`.
9. Write order: the secret goes first. If the provider refuses, the app writes nothing else, shows the refusal as one line ("Credential provider interface" point 1), and the pane still connects with the typed secret. If the SSH config write then hits a conflict ("What goes in SSH config vs the Sidecar file" point 8), the app shows the conflict and keeps the secret it just saved. The keychain and KeePass behave the same here: nothing is deleted.
10. Deleting a Saved session (a change to "Credential provider interface" point 4 and "KeePass provider details" point 6): the delete confirmation has an unticked checkbox, "Also delete the saved secret from keychain" or "from KeePass `<name>`". It shows only when no other Saved session points at the same entry, and never for a TPM reference. A ticked KeePass delete moves the entry to the database's Recycle Bin, or removes it if the database has none, with the same reload, apply and rename steps as other KeePass writes. If the database is locked, the app asks for its master password. Cancelling deletes the Saved session, keeps the entry, and shows one line saying so. The keychain and KeePass follow the same rules.

Rejected: `SSH_ASKPASS` with `force`, which moves every prompt out of the terminal (`git` passphrases and host-key questions too), needs a helper program, and hands the app the password before a login proves it. Also rejected: a reference keyed by user, host and port outside Saved sessions, which adds a term and a second lookup path.

Out of scope for v1: a "set up key login" action that creates a key and adds it to the remote `authorized_keys`. The user wants it after v1, because they look up the steps every time. Shared accounts would need a per-host way to skip it.
