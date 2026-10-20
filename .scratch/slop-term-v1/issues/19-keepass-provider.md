# Can a KeePass database be a Credential provider?

Type: research
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

Can slop-term read secrets from (and maybe write them to) a KeePass database as a third Credential provider, and what would it take?

Find out: the ways in: reading the `.kdbx` file directly from Node (for example `kdbxweb`, with KDBX 4 and Argon2 support), going through KeePassXC (its browser-integration protocol through `keepassxc-proxy`, or `keepassxc-cli`), or through a KeePass 2 plugin such as KeePassRPC or KeePassHttp; which of these work on Windows and macOS; how the database unlocks (master password, key file, Windows user account, hardware key) and whether the app would ask for the master password or rely on an already unlocked KeePassXC; what a stable entry id is (the entry UUID) for a Credential reference `{provider, entry, kind}`; whether writing is safe while KeePass or KeePassXC has the file open, and how the user's own file-sync tool affects conflicts; licences of the libraries. Check which KeePass apps are installed on this machine.

## Answer

Yes. The best way in is KeePassXC's browser-integration protocol. Reading the `.kdbx` file with `kdbxweb` is the fallback.

1. KeePassXC 2.7.12 and KeeWeb 1.18.6 are installed on this machine. KeePass 2 is not, and `keepassxc-cli` is not on PATH.
2. Browser protocol: the app connects to KeePassXC's local socket (the named pipe `org.keepassxc.KeePassXC.BrowserServer_<USERNAME>` on Windows, a socket in the temp folder on macOS). Messages are JSON encrypted with NaCl. The user approves the association once. `get-logins` with `keepassxc://by-uuid/<hex>` returns the login and password, `set-login` with a `uuid` updates an entry after a KeePassXC prompt, and `delete-entry` exists. KeePassXC does every unlock, including YubiKey, and every write, so slop-term never holds the master password and never races the user's sync tool on the file. KeePassXC must be running with browser integration on (it is off here). This doesn't work with KeePass 2 or KeeWeb. Read from the 2.7.12 source, not tested.
3. `kdbxweb` 2.1.1 (MIT) worked in Node 22 and Electron 44.9.0 as Node. It created, read and rewrote KDBX 4 (Argon2id, key file) and KDBX 3.1 files, and `keepassxc-cli` read them back. It needs an npm `overrides` pin of `@xmldom/xmldom` to 0.8.15. The app would have to ask for the master password, which "Credential provider interface" doesn't allow for today.
4. Rejected: `keepassxc-cli` (master password, plus a process per read), KeePassHttp (removed in KeePassXC 2.4.0), KeePassRPC (needs KeePass 2, which runs on macOS only through Mono).
5. Entry id: the 16-byte entry UUID, stored as 32 hex digits. The `kdbxweb` base64 form, the CLI `{...}` form and the protocol's hex form are the same bytes.

Findings: [research/keepass-provider.md](../research/keepass-provider.md)
