# 11 — Test button

**What to build:** "Test" in the SSH dialog checks the form's unsaved values end to end and shows a checklist, so the user knows a Saved session works before saving it.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 05 — SSH Tab with key login and host key checks; 10 — SSH Saved session dialog

**Status:** ready-for-agent

- [ ] Test sits on the left of the dialog footer, for SSH sessions only.
- [ ] It runs `ssh -G <alias>` with each field and option row passed as `-o`, then connects with the host key checks, logs in with the form's Credential reference or a test-only password, opens SFTP and disconnects.
- [ ] The checklist shows: resolved, reached `host:port`, host key, logged in as `<user>`, SFTP. The first failure shows its reason.
- [ ] An unknown host asks inside the host key step, and Trust saves the key. With no secret attached, the login step asks for a password used for the test alone.
- [ ] A jump host fails at the resolved step with the jump-host message.
- [ ] Back-end test against the Docker server: success path and a failure at each step. UI test: checklist rendering and the inline prompts.
