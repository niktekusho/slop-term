# 08 — Password login and keychain provider

**What to build:** Hosts that need a password or a key passphrase work. The Credential provider interface lands with its first provider, the OS keychain. A Saved session's Credential reference lives in the Sidecar file. The app reads the secret on every connect, asks only when there is no reference or a read or login fails, and offers to save what the user typed.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 05 — SSH Tab with key login and host key checks

**Status:** done

- [x] Every provider has `read(ref)`, `write(ref, secret)` and `delete(ref)`; each can fail or refuse with a reason the user can read. A refusal shows as one line where the user tried to save, and the typed secret is still used for the connection.
- [x] A Credential reference is `{provider, entry, kind}` with `kind` `password` or `passphrase`, at most one per Saved session, stored in the Sidecar file under the Managed alias. Hand-written hosts carry none.
- [x] Keychain provider uses `@napi-rs/keyring` under service `slop-term`, with an app-generated entry id, never the alias. No plain-text fallback.
- [x] Ask rules: no reference asks on connect with "Save to: keychain / don't save" (keychain default); a reference that reads fine connects without asking; a failed read shows the reason and asks, offering to save under the same reference; failed auth with a saved secret asks again with an "Update saved secret" checkbox.
- [x] Provider secrets are never cached. A password the user typed stays in back-end memory for its Tab's lifetime.
- [x] Keyboard-interactive prompts (such as 2FA) are shown to the user and asked on every connect; no save is offered for them except a single hidden prompt in one round.
- [x] Writes to the Sidecar file re-read it first and stop with a conflict if the entry changed since the last read.
- [x] Back-end tests against the Docker server and a test-only keychain service: password login with save, connect without asking, read failure path, wrong saved password path, passphrase key, refusal from a fake refusing provider.
