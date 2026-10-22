# 15 — TPM provider

**What to build:** Work hosts read their passwords from Team Password Manager. The user attaches a TPM entry by URL, id or search; the app keeps the HMAC keys in the keychain, checks the entry's username against the Saved session's `User` on every connect, and refuses every write.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 10 — SSH Saved session dialog

**Status:** ready-for-agent

- [ ] TPM base URL lives in per-machine `settings.json`. On a machine without it, a TPM reference fails to read with "TPM isn't set up on this machine" and the app asks for the secret.
- [ ] HMAC public and private keys live in the keychain; the app asks for them the first time it reads a TPM reference without keys, and again after a 401.
- [ ] Reads use API v6 `GET index.php/api/v6/passwords/<id>.json` signed with HMAC; every request sends a `Content-Type` header, even a GET.
- [ ] `write` and `delete` refuse with "TPM is read-only in slop-term". The app never deletes a TPM entry, and no delete-secret checkbox appears for TPM.
- [ ] "Attach existing…" has a TPM tab: paste a URL or numeric id, one test read; then a search box using `GET passwords/search/<query>.json` (lower priority, after paste).
- [ ] Attaching copies the entry's username into `User`. On every connect a mismatch blocks with "TPM entry says `bob`, this Saved session says `alice`" and a "Use `bob`" button that updates `User`. An entry with no username skips the check. The dialog shows the mismatch inline.
- [ ] A failed login with a TPM secret says to update the entry in TPM instead of offering "Update saved secret".
- [ ] Back-end tests against a fake TPM server that checks HMAC signatures and the `Content-Type` header: read, missing keys, 401, not set up, refusal, search, username mismatch.
