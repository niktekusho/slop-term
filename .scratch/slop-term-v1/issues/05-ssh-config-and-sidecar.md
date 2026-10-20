# What goes in SSH config vs the Sidecar file

Type: grilling
Status: resolved
Blocked by:

## Question

For a Saved session, which settings live in `~/.ssh/config` and which in the Sidecar file? And how do both files stay usable when synced between Windows and macOS?

Points to settle: where folders, display names and Credential references live; how a Sidecar entry stays linked to its `Host` entry if the user renames or deletes the host by hand; what the app does with `Include` files and `Match` blocks; and how per-machine differences (e.g. `IdentityFile` paths) work when the same files sync to both machines.

## Answer

Decided with the user on 2026-10-19.

1. The app owns `~/.ssh/slop-term.conf` (the Managed config). It adds `Include ~/.ssh/slop-term.conf` at the top of `~/.ssh/config` once; OpenSSH scopes an `Include` placed after a `Host` line to that host, so it must go first. Hosts in the user's own `~/.ssh/config` (Hand-written hosts) show in the tree read-only.
2. "Move into slop-term" copies a Hand-written host into the Managed config, then, after the user confirms, comments out the original in `~/.ssh/config` with a `# moved to slop-term.conf` marker. Nothing is deleted. This is the only edit the app ever makes to `~/.ssh/config`, and it is a line edit, not a rewrite through the config library.
3. The Sidecar file is `~/.ssh/slop-term.json`. It holds folders and Credential references keyed by host alias, for any host including Hand-written ones. No secrets.
4. Renames in the app update both files. A host renamed or deleted by hand leaves an orphaned Sidecar entry: the app ignores it but keeps it in the file. A host with no Sidecar entry shows at the top of the tree.
5. Only concrete aliases are Saved sessions. Pattern entries (`Host *`, `Host *.prod`) never show in the tree but still apply as defaults when connecting.
6. The app follows `Include` and ignores `Match`, showing a warning when it finds a `Match` block. The `ssh-config` library does not follow `Include`, so the app does.
7. Sync covers `slop-term.conf` and `slop-term.json` only. Key paths are written as `~/.ssh/<name>`, which OpenSSH expands on both systems. The user copies key files between machines by hand. `~/.ssh/config` stays per-machine.
8. No data loss: before every write the app re-reads the file and applies its change to the fresh copy. If the host it is changing was edited or removed since it last read the file, it stops and shows the conflict. Losing the spacing before end-of-line comments in the Managed config (a `ssh-config` library limit) is acceptable.
