# 15 — TPM provider

**What to build:** Work hosts read their passwords from Team Password Manager. The user attaches a TPM entry by URL, id or search; the app keeps the HMAC keys in the keychain, checks the entry's username against the Saved session's `User` on every connect, and refuses every write.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 10 — SSH Saved session dialog

**Status:** done

- [ ] TPM base URL lives in per-machine `settings.json`. On a machine without it, a TPM reference fails to read with "TPM isn't set up on this machine" and the app asks for the secret.
- [ ] HMAC public and private keys live in the keychain; the app asks for them the first time it reads a TPM reference without keys, and again after a 401.
- [ ] Reads use API v6 `GET index.php/api/v6/passwords/<id>.json` signed with HMAC; every request sends a `Content-Type` header, even a GET.
- [ ] `write` and `delete` refuse with "TPM is read-only in slop-term". The app never deletes a TPM entry, and no delete-secret checkbox appears for TPM.
- [ ] "Attach existing…" has a TPM tab: paste a URL or numeric id, one test read; then a search box using `GET passwords/search/<query>.json` (lower priority, after paste).
- [ ] Attaching copies the entry's username into `User`. On every connect a mismatch blocks with "TPM entry says `bob`, this Saved session says `alice`" and a "Use `bob`" button that updates `User`. An entry with no username skips the check. The dialog shows the mismatch inline.
- [ ] A failed login with a TPM secret says to update the entry in TPM instead of offering "Update saved secret".
- [ ] Back-end tests against a fake TPM server that checks HMAC signatures and the `Content-Type` header: read, missing keys, 401, not set up, refusal, search, username mismatch.

## Test coverage

Back end: `src/backend/tpm.test.ts`, against the fake TPM server in `src/backend/tpm-server.ts`. That server answers 415 without a `Content-Type` header and 401 for a request not signed with the test keys, so every passing read also checks both. UI: `src/renderer/Tpm.test.tsx`.

- Base URL in `settings.json`, and "TPM isn't set up on this machine" with an ask: back end "says TPM isn't set up on a machine without a TPM address" and "asks for the password on a machine where TPM isn't set up, and refuses to save it to TPM". The key is `tpmUrl`, the address up to and including `index.php`.
- HMAC keys in the keychain, asked for on first read and after a 401: back end "asks for the API keys before the first read, and keeps them in the keychain", "asks for the API keys again after a 401", "asks for the API keys inside the Tab when none are saved, then logs in", "asks for the keys again in the Tab after a 401". UI "asks for the API keys when TPM needs them, saves them and finds again".
- API v6 reads signed with HMAC, `Content-Type` on every request: back end "reads an entry by its numeric id or by its URL with signed requests" checks the paths. Two mutations showed the tests can fail: without the `Content-Type` header 5 of 6 read tests fail on the fake server's 415, and with the 401 branch broken the key tests fail.
- `write` and `delete` refuse, the app never deletes a TPM entry, and no delete checkbox: back end "asks for the password on a machine where TPM isn't set up, and refuses to save it to TPM" shows "Not saved: TPM is read-only in slop-term." and checks the fake TPM got no request and `slop-term.json` is unchanged; "never deletes the TPM entry with the last session that uses it" checks that TPM gets no request at all, so any delete call that reaches TPM fails it. UI "offers no delete-secret checkbox for a TPM entry and says it stays, on Remove or on Delete" (spec line 394 asks for the "TPM entry stays" note).
- "Attach existing…" TPM tab with paste and search: back end "reads an entry by its numeric id or by its URL…" and "searches TPM for any text that is not an id or a URL". UI "attaches a TPM entry by its pasted id and copies its username into User", "keeps User for an entry with no username, and lists every search result", "shows why TPM can't answer". One box takes a pasted URL, an id or a search.
- Username copied on attach, mismatch blocks every connect with "Use `bob`", no username skips, dialog shows it inline: back end "blocks the connect when the entry's username differs from User, before any login" (the SSH server sees no login attempt), "skips the username check for an entry with no username, and says to update a rejected password in TPM", "fails a Test at logged in when the username differs". UI "attaches a TPM entry by its pasted id and copies its username into User", "shows a username mismatch inline, and Use bob fixes User", "reads a TPM session's entry when its edit opens, to show a mismatch", "offers Use bob on a Tab blocked by a mismatch, saves User and reconnects".
- A failed login with a TPM secret says to update the entry in TPM, with no "Update saved secret": back end "skips the username check for an entry with no username, and says to update a rejected password in TPM", where the entry's password is wrong for the server and the question carries "TPM's password was rejected. Update the entry in TPM, then reconnect." and no `save`.
- The `refusing` test provider is gone: TPM now covers the refusal path it stood in for.
