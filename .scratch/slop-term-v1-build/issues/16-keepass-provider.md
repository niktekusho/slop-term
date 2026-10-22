# 16 — KeePass provider

**What to build:** The user's KeePass databases, edited in KeeWeb and synced by OneDrive, become a Credential provider the app reads and writes directly. Each database unlocks with its master password once per app run and locks on quit, sleep, screen lock or "Lock KeePass". The user attaches entries by search and saves new secrets into a picked group.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 10 — SSH Saved session dialog

**Status:** ready-for-agent

- [ ] Uses `kdbxweb` 2.1.1 with `hash-wasm` for Argon2; `@xmldom/xmldom` pinned to 0.8.15 with npm `overrides`.
- [ ] Per-machine `settings.json` lists databases by name and path; the name defaults to the file name. The reference is `{provider: "keepass", entry: "<name>/<32 lowercase hex uuid>", kind}`. A name not set up here fails with "KeePass database `work` isn't set up on this machine" and the app asks for the secret.
- [ ] Unlock takes a master password only, asked the first time a reference needs the database, once per app run; a wrong password asks again; Cancel counts as a failed read. A database needing a key file fails with "Key files aren't supported yet". The master password never goes in the keychain.
- [ ] Unlocked databases stay in memory until quit, OS sleep, screen lock or "Lock KeePass" (locks all). No idle timer.
- [ ] Every read checks the file's modified time and reloads on change; a reload failing on a changed master password locks that database and asks again.
- [ ] Writes reload, apply, re-check the modified time, write a temp file next to the database and rename it over the original.
- [ ] "Update saved secret" sets the entry's password and keeps the old one in history. Saving a new secret creates an entry in a picked database and group (preselected by the folder name, else the last group used) with title = alias, username = `User`, URL = `ssh://<host>`. "Save to" offers KeePass only when a database is set up here.
- [ ] "Attach existing…" KeePass tab: a search over title, username, URL and group across every unlocked database, skipping the Recycle Bin, with one "Unlock `<name>`" row per locked database.
- [ ] Same username check and "Use `bob`" button as TPM.
- [ ] A ticked delete-secret checkbox moves the entry to the Recycle Bin when the database has one, else removes it; a locked database asks for its master password; Cancel keeps the entry and says so.
- [ ] Back-end tests with `.kdbx` fixtures: read, wrong password, key-file database, external modification reload, write via temp-and-rename, create in group, history kept, search, Recycle Bin delete, lock on a simulated sleep.
