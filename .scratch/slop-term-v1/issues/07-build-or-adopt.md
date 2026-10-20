# Build or adopt?

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by: 01

## Question

Given the findings in "Do existing tools already cover v1?", should the user build their own client or adopt an existing tool? If one tool comes close, decide whether its gaps are acceptable or fixable.

## Answer

Build. Decided with the user on 2026-10-19.

The user's hard requirements for any tool are an SFTP pane in the same window as the terminal, on both Windows and macOS, and reading secrets from TPM. Writing Saved sessions to SSH config is wanted for interop with plain `ssh`, but it is not a deal-breaker. Writing secrets to TPM is not needed.

No tool meets both hard requirements without custom code (see [research/existing-tools.md](../research/existing-tools.md)):

- Tabby could read TPM through a plugin, but its SFTP browser is an overlay opened from a toolbar button, not a pane.
- Electerm has a terminal and SFTP split view that follows the terminal's path, but it has no plugin point, so TPM means a fork.
- WindTerm has an SFTP pane but no plugin point and slow releases.
- XPipe's file browser is a separate view, and on macOS its terminals are separate apps.

Other answers from this session:

- The SFTP pane also opens when the user types `ssh <host>` in a local shell Tab, as in MobaXterm. In v1 this covers hosts the app can authenticate to by itself (key, agent or Credential reference). How it works is open, under "SFTP pane behaviour" on the map.
- Handing macOS terminals to iTerm2 is out of scope. macOS can't embed another app's window, so the SFTP pane would end up in a second window.
- "SFTP pane" is now a glossary term.
