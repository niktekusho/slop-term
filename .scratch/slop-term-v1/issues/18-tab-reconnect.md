# Tab disconnect and reconnect

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

What happens when an SSH Tab's connection drops, and how does it reconnect?

Points to settle: how the app notices a drop (keepalives, their interval, and whether `ServerAliveInterval` from SSH config is honoured); what the terminal shows once disconnected; whether reconnecting is automatic, with how many attempts and what delay, or done by a key or button as in MobaXterm; whether the old scrollback stays above the new session; how the Tab is marked in the tree while disconnected; how a reconnect reads the Credential reference again, or asks again for a password the user typed, given "SFTP pane behaviour" keeps typed passwords in memory for the Tab's lifetime; what a dropped local shell Tab does, if anything. "SFTP pane behaviour" relies on the result: the pane greys out on a drop, saves from editor sync wait for the connection, and the pane reopens at its last folder after reconnecting.

## Answer

Decided with the user on 2026-10-21.

1. Detection: the keepalive interval is `ServerAliveInterval` from `ssh -G` when it's between 1 and 15 seconds, and 15 s otherwise, so a config value of 60 still runs at 15. The miss count is `ServerAliveCountMax` from `ssh -G` (3 by default), so a drop shows within about 45 s. `ssh -G` prints 0 when the option is unset, so 0 counts as unset. A socket error or close is a drop straight away. On OS resume, every SSH Tab sends one keepalive at once, so dead Tabs show as dropped within seconds of wake. The SFTP pane's transfer connection uses the same values.
2. Terminal: on a drop the terminal prints one dim line, `Connection lost (reason) at 14:32. Press R to reconnect, or click Reconnect`, and the header bar shows a Reconnect button. Old output stays readable and selectable. Keys other than R do nothing, and Enter doesn't close the Tab, so a stray Enter can't lose the scrollback.
3. Reconnect: manual only in v1, by R or the button. A failed reconnect prints the reason and offers R again. "Reconnect all disconnected Tabs" is in the tree's right-click menu, with no shortcut. Tabs that need a typed password ask one at a time. The user doesn't expect mass drops to be common.
4. Scrollback: kept. The new session continues in the same xterm.js terminal below a `── reconnected 14:35 ──` line, within the 1,000-line scrollback from "Choose the stack". MobaXterm doesn't keep it.
5. Tree: a disconnected Tab's entry is dimmed with a "disconnected" icon, and the header bar shows `user@host · disconnected`. Closing a disconnected Tab doesn't ask, unless its SFTP pane has saves waiting.
6. Exit vs drop: a shell that ends with code 0 in a session with no command closes its Tab, as Windows Terminal does. A non-zero exit, or a session with a command, keeps the Tab open with "process exited with code N" and R to start it again. This applies to SSH and local shell Tabs alike. The user accepts this for now and may revisit it.
7. Secrets: a reconnect is a connect. It reads the Credential reference again, reuses a password the user typed for the Tab, and asks again for 2FA and other keyboard-interactive prompts. Auth failure uses the "ask again" flow from "Credential provider interface".
8. Edited or deleted session: a reconnect reads the Saved session fresh, so it uses the current host and user, and the header bar updates. If the Saved session was deleted, R prints "This Saved session no longer exists" and the Tab can only be closed.
9. Typed `ssh`: on a local shell Tab, the SFTP pane's own connection can drop while the terminal's `ssh` keeps running, or the other way round. The pane greys out and shows its own Reconnect button. R in the terminal doesn't apply, because the local shell didn't drop. If the typed `ssh` has exited, the rules from "SFTP pane for `ssh <host>` typed in a local shell Tab" apply.

Glossary: Tab now says it stays open after its connection drops or its shell exits.

Correction (2026-10-22, from "Saved session dialog look" point 6): point 1 changes. The keepalive interval is `ServerAliveInterval` from `ssh -G` as it is, with no 15 s cap, and 15 s only when it is unset. A Tab and a typed `ssh` to the same alias now behave alike. New Saved sessions start with `ServerAliveInterval 15`.
