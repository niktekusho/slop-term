# 09 — Disconnect and reconnect

**What to build:** A dropped SSH Tab shows within about 45 seconds, or within seconds of the machine waking, and keeps its scrollback. The user reconnects with R or a button, one Tab or all at once, and the new session continues below a divider in the same terminal.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 06 — Tabs in the tree; 08 — Password login and keychain provider

**Status:** done

- [x] Keepalives use `ServerAliveInterval` and `ServerAliveCountMax` from `ssh -G` as they are; 15 s and 3 when unset (0 counts as unset). A socket error or close is a drop at once.
- [x] On OS resume every SSH Tab sends one keepalive at once.
- [x] On a drop the terminal prints one dim line, `Connection lost (reason) at 14:32. Press R to reconnect, or click Reconnect`, and the header bar shows `user@host · disconnected` and a Reconnect button. Keys other than R do nothing; Enter doesn't close the Tab.
- [x] The tree row dims to 60% with a red broken-link icon.
- [x] Reconnect is manual only. A failed reconnect prints the reason and offers R again. "Reconnect all disconnected Tabs" is in the tree's right-click menu; password prompts come one at a time.
- [x] A reconnect continues in the same terminal below `── reconnected 14:35 ──` within the scrollback limit.
- [x] A reconnect re-reads the Saved session and the secret, reuses a typed password and the Tab's accepted host key, and asks again for keyboard-interactive prompts. A deleted Saved session prints "This Saved session no longer exists" and the Tab can only be closed. A key that changed during the drop shows the changed-key warning.
- [x] Closing a disconnected Tab doesn't ask.
- [x] Back-end tests: the Docker server dropping packets is detected within interval × count; resume triggers a keepalive; reconnect after a session edit uses the new values. UI tests: drop line, R handling, divider, dimmed row.
