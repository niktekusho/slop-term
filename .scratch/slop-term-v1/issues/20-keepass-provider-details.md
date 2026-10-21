# KeePass provider details

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

How does the KeePass Credential provider work when the app reads the `.kdbx` file directly with `kdbxweb`?

The user chose the direct file read over KeePassXC's browser protocol (see "Can a KeePass database be a Credential provider?"), so the app has to unlock the database itself.

Points to settle: when the app asks for the master password and how long the unlocked database stays in memory, given "Credential provider interface" allows no secret cache (only a typed password held for its Tab, from "SFTP pane behaviour"); whether the master password can itself live in the OS keychain; key files and whether YubiKey challenge-response is supported; where the database path and key-file path are set (per machine or synced in the Sidecar file); whether the provider is read-only like TPM, or writes, and if it writes, how it avoids clobbering changes KeePassXC or the user's sync tool made to the file; when the app re-reads the file after it changes on disk; how the user attaches an entry (a picker over the database's groups, a search box, or pasting the UUID) and whether attaching copies the username as TPM does; the reference format (`provider: keepass`, `entry` as the 32-hex UUID); the `@xmldom/xmldom` 0.8.15 pin.

## Answer

Decided with the user on 2026-10-21. The user runs KeeWeb, not KeePassXC, and keeps the `.kdbx` files on OneDrive.

1. The app reads the `.kdbx` file with `kdbxweb` 2.1.1 and `hash-wasm` for Argon2. `@xmldom/xmldom` is pinned to 0.8.15 with npm `overrides`, because 0.9 breaks `kdbxweb` saves.
2. Unlock takes a master password only. Key files and YubiKey are out of v1. A database that needs a key file fails with "Key files aren't supported yet".
3. Each database unlocks the first time a reference needs it, and the app asks for its master password once per app run. The unlocked database stays in memory until the app quits, the OS sleeps, the screen locks, or the user picks "Lock KeePass", which locks every database. There is no idle timer, and the master password never goes in the OS keychain. A wrong password asks again. Cancel counts as a failed read, so the app asks for the SSH secret as in "Credential provider interface" point 5.
4. Opening the file holds no lock, so KeeWeb and OneDrive can change it at any time. On every read the app checks the file's modified time and reloads the file if it changed. If the reload fails because the master password changed, that database locks and the app asks again.
5. The per-machine `settings.json` lists the databases, each with a name and a path. The name defaults to the file name (`work.kdbx` gives `work`) and has to match on every machine. The reference is `{provider: "keepass", entry: "<name>/<32-hex uuid>", kind}`, with the UUID in lowercase hex. A name not set up on this machine fails with "KeePass database `work` isn't set up on this machine", and the app asks for the secret. So a personal machine never needs the work database.
6. The provider writes. "Update saved secret" sets the attached entry's password and keeps the old one in its history. Saving a new secret creates an entry in a database and group the user picks. The picker preselects the group whose name matches the Saved session's folder, or else the last group used. The entry's title is the alias, its username is the `User`, and its URL is `ssh://<host>`. The save dialog offers "Save to: keychain / KeePass / don't save". The app never deletes a KeePass entry.
7. A write reloads the file, applies the change to that fresh copy, checks the modified time again, writes a temp file next to the database and renames it over the original. KeeWeb watches local files and merges outside changes into its open database (`fs.watch` and `db.merge` in its 1.18.6 bundle), so it picks the write up. OneDrive conflict copies, from two machines saving before a sync, are not handled.
8. To attach an entry the user searches. The search box matches title, username, URL and group across every group of every unlocked database, skipping the Recycle Bin. Each locked database shows one "Unlock `<name>`" row. Attaching copies the entry's username into `User`, and a later mismatch blocks the connect with the same message and "Use `bob`" button as TPM. An entry with no username skips the check.

Out of scope for v1: syncing KeePass groups with the app's folders, and key files and YubiKey.

Correction (2026-10-21, from "Saving passwords typed for `ssh <host>`" point 10): in point 6, the app deletes a KeePass entry only when the user ticks "Also delete the saved secret" while deleting the last Saved session that points at it. The entry goes to the Recycle Bin when the database has one.
