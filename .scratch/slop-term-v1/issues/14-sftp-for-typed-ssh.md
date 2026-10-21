# SFTP pane for `ssh <host>` typed in a local shell Tab

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by: 13

## Question

How does the app spot `ssh <host>` typed in a local shell Tab, and how does it open its own SFTP connection to that host?

Points to settle: how the app detects the command (watching typed input, the shell's window title, a shell integration script, or a "Browse files of..." action the user triggers); how it resolves `<host>` through SSH config, including Hand-written hosts and hosts with no entry at all; how it authenticates its separate connection when the Saved session has no Credential reference and the user typed the password into `ssh`; what the pane shows when the user leaves the remote host or chains `ssh` from it.

## Answer

Decided with the user on 2026-10-21.

1. Detection: when the user presses Enter in a PowerShell, cmd, zsh or bash Tab, the back end waits about 0.5 s, then looks for a direct child of the Tab's shell named `ssh` and reads its command line (a process query on the shell's pid on Windows, `ps` on macOS). While that `ssh` runs, the app only checks that its pid is alive. `ssh` started under `git` or `scp` doesn't count. If two `ssh` children exist, the newest wins.
2. Fallback: the pane's hint in every local shell Tab has a "Browse files of..." picker over SSH Saved sessions. WSL Tabs get only the picker, because Windows can't see processes inside WSL, and WSL's `ssh` reads WSL's own config.
3. Connecting: the pane connects on its own when it can log in without asking. Otherwise it shows "Browse files on alice@web1", which asks once. A failed connect shows the reason and a retry button.
4. Login order: the matching Saved session's Credential reference, then the SSH agent, then the `IdentityFile` keys, then a prompt in the pane. A typed secret stays in memory until that `ssh` exits, with no "save" option. Hosts with 2FA or other keyboard-interactive prompts ask on every connect. The app never reads what the user types into `ssh`. MobaXterm also logs in a second time for its browser; its patched `ssh` hands the GUI the typed password, which stock OpenSSH can't do (research: `research/mobaxterm-typed-ssh-browser.md`).
5. Resolving the host: the app runs `ssh -G` with the typed arguments, using the same `ssh` executable the process came from, and connects with its output. That covers Hand-written hosts, hosts with no entry, `Host *` defaults, `Match` blocks and options typed on the command line, so the pane reaches exactly what the terminal reached.
6. Matching a Saved session: the typed alias must equal an SSH Saved session's alias, and the resolved user must equal that session's user, so `ssh bob@web1` doesn't use alice's reference. A typed IP address or a host with no entry gets no reference.
7. Jump hosts: if `ssh -G` reports `ProxyJump` or `ProxyCommand`, the pane shows "This host uses a jump host" and doesn't connect. "ProxyJump in v1" decides the real behaviour.
8. Folder: a local shell Tab follows OSC 7 only while an `ssh` is detected, so a local prompt that sends OSC 7 (oh-my-posh) doesn't move the pane. The first OSC 7 hostname after detection is the pane's host.
9. Chained `ssh`: when OSC 7 reports a different hostname, the pane stays on the first host, stops following and shows "Terminal is on db1. This pane shows web1." Following resumes when the hostname matches again. The same rule applies to SSH Tabs. Switching the pane to the new host can come later.
10. When `ssh` exits: the pane closes its connections and shows the hint again. Running transfers finish. Editor-sync saves wait as "waiting for connection" and go out after the remote-change check if the user runs `ssh` to the same host again in that Tab. The typed secret is dropped.

Rejected: parsing typed input (misses aliases, history and scripts), relying on the remote's OSC 7 hostname alone, ControlMaster (Windows OpenSSH doesn't support it), and `SSH_ASKPASS` capture for v1 (moved to the "saving typed passwords" note in Not yet specified).
