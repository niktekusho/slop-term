# 10 — SSH Saved session dialog

**What to build:** The user creates, edits, duplicates and deletes SSH Saved sessions in a modal dialog that shows the connection as an editable `ssh` command line and every other option as a described `-o` row. The Secret row sets, attaches or removes the session's Credential reference. Saving writes the Managed config and Sidecar file without losing concurrent edits.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 04 — Session tree from SSH config; 08 — Password login and keychain provider

**Status:** ready-for-agent

- [ ] "New" beside the tree filter offers SSH session (Local shell session and Folder come in later tickets) and creates it in the selected row's folder. Right-click on a Saved session shows Open Tab (Enter), Edit (F2), Duplicate, Delete (Del, red, after a separator) with their keys.
- [ ] Dialog (~780 px): Alias, Folder and Colour rows (Colour arrives in ticket 14), a Connect row `ssh -p [Port] -i [IdentityFile] […] [User]@[HostName]` with inline inputs that show their `ssh -G` value in grey when empty, `…` to pick a key file, and the note "Typing `ssh <alias>` in a shell runs this command."
- [ ] `IdentityFile` is written as `~/.ssh/<name>` when the key is in the home folder; any other path is kept and flagged "won't work on macOS".
- [ ] Every other option is a row: `-o`, a `Key value` input, a shipped one-line description (blank when the keyword has none) and remove; "+ option" adds a row; an unparseable line or a `ProxyJump` line shows its problem under its row.
- [ ] New sessions start with the row `ServerAliveInterval 15`.
- [ ] Alias: lowercased as typed; spaces, `*`, `?`, `!` and `,` rejected; unique across Managed hosts, Hand-written hosts and Local shell sessions ignoring case; shows "Free" in green or the problem in red.
- [ ] Secret row: "Set secret…" popover with Password / Key passphrase switch (passphrase when a key file is set) and "Save to", keychain first, creating the entry on Save; "Attach existing…" popover with a "Same secret as…" tab (KeePass and TPM tabs arrive with their providers); "Remove" with the unticked delete-secret checkbox.
- [ ] Duplicate opens the New form with every field copied, the same Credential reference and alias `<alias>-2` or the next free number; nothing is written until Save.
- [ ] Delete confirms with Cancel focused and Delete red, says when Tabs are open ("2 Tabs are open. They stay open."), shows the unticked "Also delete the saved secret from keychain" only when no other session points at the entry, and says when a shared secret stays. Open Tabs of a deleted session move to the Unsaved group under the old alias.
- [ ] Save writes each file once, re-reading first and stopping with a conflict if the host changed. Edits don't touch live connections; the header bar and tree update straight away; a rename carries its Tabs along.
- [ ] A save never writes over a `slop-term.json` that is not valid JSON (the tree reads it as empty), and keeps Sidecar entries whose host is gone (from ticket 04).
- [ ] Back-end tests: create, edit, rename, duplicate, delete round-trip through the Managed config and Sidecar file, conflicts on concurrent edit, comments preserved, orphaned Sidecar entries kept, delete-secret rules. UI tests: command-line row placeholders, alias validation, option rows.
