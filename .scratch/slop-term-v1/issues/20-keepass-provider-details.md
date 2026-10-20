# KeePass provider details

Type: grilling
Status: open
Blocked by:

## Question

How does the KeePass Credential provider work when the app reads the `.kdbx` file directly with `kdbxweb`?

The user chose the direct file read over KeePassXC's browser protocol (see "Can a KeePass database be a Credential provider?"), so the app has to unlock the database itself.

Points to settle: when the app asks for the master password and how long the unlocked database stays in memory, given "Credential provider interface" allows no secret cache (only a typed password held for its Tab, from "SFTP pane behaviour"); whether the master password can itself live in the OS keychain; key files and whether YubiKey challenge-response is supported; where the database path and key-file path are set (per machine or synced in the Sidecar file); whether the provider is read-only like TPM, or writes, and if it writes, how it avoids clobbering changes KeePassXC or the user's sync tool made to the file; when the app re-reads the file after it changes on disk; how the user attaches an entry (a picker over the database's groups, a search box, or pasting the UUID) and whether attaching copies the username as TPM does; the reference format (`provider: keepass`, `entry` as the 32-hex UUID); the `@xmldom/xmldom` 0.8.15 pin.
