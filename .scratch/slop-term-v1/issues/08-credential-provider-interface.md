# Credential provider interface

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by: 03

## Question

What does the Credential provider interface look like? Settle: the read and write operations; how a provider refuses a write and how the user sees that; what a Credential reference contains; when the app asks the user for a secret (first use, every connect, after a failure); whether and how long secrets are cached in memory; and how a provider that needs its own login (like TPM) gets its credentials.

## Context

From "Build or adopt?": the user doesn't need to write secrets to TPM. They proposed read and write for every provider to keep one interface, and are open to changing that. The map already allows a provider to refuse writes.

## Answer

Decided with the user on 2026-10-19.

1. Every provider has `read(ref)`, `write(ref, secret)` and `delete(ref)`. Each can fail or refuse with a reason the user can read. The app shows a refusal as one line where the user tried to save, and still uses any secret the user typed for the current connection.
2. The TPM provider refuses every write and delete in v1 ("TPM is read-only in slop-term"). That drops the `PUT` call and the `user_permission` check. Real TPM writes can come later; "Get TPM API access" showed they work.
3. A Credential reference is `{provider, entry, kind}`. `provider` is `keychain` or `tpm`. For TPM, `entry` is the numeric password id. For the keychain it is an id the app generates, stored under service `slop-term`, never the host alias, so a rename can't orphan a secret. `kind` is `password` or `passphrase`. A Saved session has at most one reference, stored in the Sidecar file.
4. The save dialog offers "Same secret as <Saved session>", which points the new reference at that session's keychain entry. TPM references share an entry by using the same id. The app deletes a keychain entry when the last Saved session pointing at it is deleted. It never deletes TPM entries.
5. When the app asks for a secret:
   - No reference: it asks on connect, with "Save to: keychain / don't save".
   - A reference that reads fine: it connects without asking.
   - The read fails (entry missing on this machine, TPM unreachable or not set up here): it shows the reason and asks. For a keychain reference it offers to save under the same reference.
   - Auth fails with a saved secret: it asks again with an "Update saved secret" checkbox. For a TPM reference it says to update the entry in TPM instead.
6. No cache in memory or on disk. The app reads the secret on every connect. An SSH Tab's SFTP pane uses the Tab's connection, so it doesn't log in again.
7. TPM's own login: the HMAC public and private keys live in the OS keychain. The app asks for them the first time it reads a TPM reference without keys, and again after a 401. `@napi-rs/keyring` handled Windows Credential Manager in the stack test, so there is no plain-text fallback. The TPM base URL goes in a per-machine `settings.json` in the app's data folder (`%APPDATA%\slop-term\` on Windows), because the user runs TPM on one machine only. On another machine a synced TPM reference fails to read with "TPM isn't set up on this machine" and falls back to asking, as in point 5.
8. To attach a TPM entry the user pastes its URL or numeric id, and the app does one test read. A search box using `GET passwords/search/<query>.json` is in v1 at low priority, built after paste.
9. Attaching a TPM entry copies its username into the Saved session's `User`. On every connect with a TPM reference, the app compares the two. If they differ it doesn't connect, and shows "TPM entry says `bob`, this Saved session says `alice`". For a Managed host it adds a "Use `bob`" button that updates `User`. For a Hand-written host it shows only the message. An entry with no username skips the check.

Out of scope for v1: creating Saved sessions from TPM entries, showing or copying a secret inside the app, and TPM writes.

Glossary: "Credential reference" now includes the secret's kind, at most one per Saved session, and that several Saved sessions can point at the same entry.

Correction (2026-10-20, from "SFTP pane behaviour"): point 6 changes. A password the user typed is held in memory for its Tab's lifetime, so the SFTP pane's second connection for transfers can log in without asking again. Secrets read from a provider are still never cached.

Correction (2026-10-21, from "KeePass provider details"): point 6 has a second exception. An unlocked KeePass database stays in memory until the app quits, the OS sleeps, the screen locks or the user locks it. `provider` can also be `keepass`, with `entry` set to `<database name>/<uuid>`.

Correction (2026-10-21, from "Saving passwords typed for `ssh <host>`"): in point 5, keychain is the default on every "Save to" choice.

Correction (2026-10-21, from "Saving passwords typed for `ssh <host>`" point 10): in point 4, the app no longer deletes a keychain entry on its own. Deleting the last Saved session that points at an entry asks, with an unticked checkbox, whether to delete the secret too.

Correction (2026-10-22, from "Creating and editing SSH Saved sessions" point 9): in point 9, the Hand-written host case no longer exists, because only Managed hosts carry a Credential reference.

Correction (2026-10-28, while building "Password login and keychain provider"): in point 3, a keychain entry id is no longer random. A new entry is named after what the secret unlocks, so the user can find and clean up entries in the OS keychain: `user@host` for a password (`user@host-port` when the port isn't 22) and `passphrase-<key file name>` for a passphrase. The id keeps only letters, digits and `._@-`, and gets `-2`, `-3` when the name is taken. A rename still can't orphan a secret, because the reference stores the id; the entry just keeps its old name.
