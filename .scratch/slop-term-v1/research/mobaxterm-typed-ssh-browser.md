# How MobaXterm opens the SSH-browser for a typed `ssh`

Research for ticket `issues/14-sftp-for-typed-ssh.md`. Gathered 2026-10-21 on Windows 11 x64. MobaXterm is not installed on this machine (only an old `MobaXterm.ini` remains), so nothing was run inside MobaXterm. The portable v26.5 download from mobatek.net was unpacked in a scratch folder and read, never executed. Nothing was tested on macOS.

## Summary

- MobaXterm ships its own patched OpenSSH for the local terminal. `ssh` in the local terminal is a shell wrapper that runs the real client, `_ssh.exe` (OpenSSH 10.5p1 in v26.5).
- The patch reports to the MobaXterm window. After a successful login, the client sends the connection details (terminal tab id, user, host, port, and the password or key path it used) to the GUI as a Windows message. The GUI then offers to save the password and opens the SSH-browser with **its own, separate SFTP connection** (SecureBlackbox, not OpenSSH). There is no ControlMaster, no shared channel, and no reuse of the terminal's connection.
- The settings are global, in Settings > Configuration > SSH: "Enable graphical SSH-browser" (`EnableSFTP`) and "Automatically switch to SSH-browser tab after login" (`AutoStartSSHGUI`).
- The patched client hooks password authentication only. Mobatek's own FAQ says keyboard-interactive servers make the SSH-browser ask for the password again or not appear.
- A Windows `ssh.exe` run in a cmd or PowerShell tab has no patch, so nothing reaches the GUI and no browser opens.
- For slop-term, ControlMaster is not an option on Windows: Win32-OpenSSH scopes it out. It works on macOS. The only cross-platform way to learn the typed secret from a stock OpenSSH is `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force`. It works with Windows OpenSSH 9.5p2, but it changes how every password prompt in that shell behaves.

Recommendation: don't try to copy MobaXterm's approach (it needs a patched ssh). For typed `ssh`, offer an explicit "Open SFTP for this host" action that opens slop-term's own `ssh2` connection, using the Saved session's or Credential provider's secret, or asking the user. On macOS, an optional ControlMaster route can reuse the typed connection. Details below.

## Sources

| Id | Source |
|---|---|
| D1 | MobaXterm documentation, <https://mobaxterm.mobatek.net/documentation.html> (fetched 2026-10-21) |
| D2 | MobaXterm Home Edition download page and changelog, <https://mobaxterm.mobatek.net/download-home-edition.html> |
| B1 | MobaXterm Portable v26.5, <https://download.mobatek.net/2652026082870834/MobaXterm_Portable_v26.5.zip>, unpacked and read (strings and disassembly), not run |
| U1 | University of Washington Sociolab SSH/SFTP guide (third party), <https://depts.washington.edu/sociolab/labfacilities/documents/SSH-Sociolab.pdf> |
| U2 | J. Zimmerman, "Setting up MobaXterm for SSH on Windows" (third party), <https://blog.jez.io/2014/09/28/setting-up-mobaxterm-for-ssh-on-windows/> |
| W1 | Win32-OpenSSH wiki, Project Scope, <https://github.com/PowerShell/Win32-OpenSSH/wiki/Project-Scope> |
| W2 | Win32-OpenSSH issue #405, <https://github.com/PowerShell/Win32-OpenSSH/issues/405> |
| W3 | Win32-OpenSSH issue #1328, <https://github.com/PowerShell/Win32-OpenSSH/issues/1328> |
| W4 | openssh-portable (PowerShell fork) PR #674 "Add support for AF_UNIX", <https://github.com/PowerShell/openssh-portable/pull/674> |
| O1 | OpenBSD `ssh_config(5)`, <https://man.openbsd.org/ssh_config> |
| O2 | OpenBSD `ssh(1)`, <https://man.openbsd.org/ssh> |
| L | Tests and inspection on this machine (Windows OpenSSH `OpenSSH_for_Windows_9.5p2`) |

## 1. Mechanism in MobaXterm

### Confirmed

- The local terminal's `ssh` is OpenSSH, not MobaXterm's PuTTY-based engine. The changelog speaks of "the embedded OpenSSH command", "the command-line SSH client based on OpenSSH", and OpenSSH CVE fixes that apply "for manual SSH connections from local terminal commandline only: 'normal' MobaXterm SSH sessions are not concerned" [D2].
- Typed `ssh` in the local terminal does bring up the SSH-browser. A UW guide has users run `ssh <username>@<hostname>` in "Start local terminal" and says the SFTP tab "typically opens automatically upon login" [U1]. A 2014 post says typed `ssh` in MobaXterm "will also ask if you want to save your password" [U2]. Both are third party. Mobatek's docs only say the browser opens "when you log to a remote server using SSH" [D1].
- In the shipped files [B1], `CygUtils64.plugin` is a zip whose entries are LZMA-compressed. `bin/ssh.exe` there is a zsh script, not a binary. It rewrites `-i`/`-l` arguments, asks the GUI for key files through `/bin/MobaBox.exe MobaSendMsg MobaXterm "AskKey ..."`, and then runs `/bin/_ssh.exe`.
- `_ssh.exe` reports `OpenSSH_10.5p1` and imports `FindWindowA` and `SendMessageA` from `USER32.dll`, which stock OpenSSH never does. It looks up the MobaXterm main window by class name `TMobaXtermForm` and sends it `WM_COPYDATA` messages. It reads the `TERMNUM` environment variable (set per tab by MobaXterm's `LaunchTabContent`) to say which terminal tab the message is about, and `TunneledHostname` for jump-host cases [B1].
- The patch points [B1]:
  - host key verification (it reports the host key to the GUI),
  - `userauth_passwd`, before the `%s@%s's password:` prompt. It asks the GUI for a saved password, and falls back to the normal terminal prompt if there is none,
  - public-key loading. It asks the GUI for a saved key passphrase,
  - right after the `Authenticated to %s ...` log line. It sends tab id, user, host, port, and either the password that was used or the path of the key that was used,
  - right after `client_loop()` returns. It sends only the tab id, which marks the session as ended.
- The GUI's handler strings match [B1]: `WMNewTab2: Saving password and CONNECTING SSH-Browser...`, `WMNewTab2: Saving sshkey and NOT CONNECTING SSH-Browser...`, `WMNewTab2: Connecting SSH-Browser...`, `SauvegarderMotDePasseSSH: Connecting SSH-Browser...` (French for "save SSH password"), and the prompts `Do you want to save password for ` / `Do you want to save this passphrase?`.
- The SSH-browser is a separate client. The main executable embeds EldoS SecureBlackbox (`TElSSHKey`, `ElSFTP1OpenConnection`, `(SSH-Browser) ConnectSSH(`) [B1]. Mobatek's FAQ describes it as a second login: "In order for MobaXterm to be able to save SSH passwords or to launch the SSH-browser without asking for password twice, you will have to re-enable 'normal' password authentication" [D1].
- SSH multiplexing exists only for MobaXterm's own sessions in SCP mode: "with SCP protocol, SSH-browser does not open a new SSH connection anymore, but makes use of the existing terminal connection instead (SSH multiplexing)" [D2]. The GUI's session settings include PuTTY's `ConnectionSharing` keys [B1]. Nothing in `_ssh.exe` or the wrapper sets up an OpenSSH ControlMaster.

### Inferred

- The typed password goes from the patched client to the GUI in memory through `WM_COPYDATA`. MobaXterm does not read it off the terminal screen. The GUI keeps it for the browser's login whether or not the user agrees to save it. This is a strong inference from the message contents and the "Saving password and CONNECTING SSH-Browser" path [B1]. I did not watch it at runtime.
- For key logins the GUI gets the key path, and the browser logs in with the same key. The "NOT CONNECTING" log line for the passphrase-save path suggests the browser starts from another code path in that case. **Medium.**

## 2. Settings

From the Configuration dialog's resources in the main executable [B1], matched to the `[SSH]` keys in `MobaXterm.ini`:

| UI label (Settings > Configuration > SSH, "SSH-browser settings" box) | Ini key | Default |
|---|---|---|
| Enable graphical SSH-browser | `EnableSFTP` | on |
| Automatically switch to SSH-browser tab after login | `AutoStartSSHGUI` | on |
| Remote-monitoring | `RemoteMonitoring` | on since a 2020s release [D2] |

The label-to-key mapping comes from the names and the order of the keys. **High**, but not checked in a running MobaXterm. Password saving is under Settings > Configuration > General > "MobaXterm passwords management" (`StorePasswords` in `[Misc]`, values such as `Always`, `Never`) [D1][B1]. I found no setting that applies only to typed `ssh`. The browser settings are global.

## 3. Edge cases

- **Password not saved.** The browser still connects. The GUI's handler opens the browser after the save prompt whatever the answer ("Saving password and CONNECTING SSH-Browser") [B1]. **Medium**, inferred.
- **Keyboard-interactive and 2FA.** The patch covers `userauth_passwd` only. Keyboard-interactive answers stay inside OpenSSH [B1]. Mobatek's FAQ says keyboard-interactive servers stop the browser from popping up, or make it ask for the password again [D1]. A changelog entry about MFA detection covers MobaXterm's own sessions [D2]. So with 2FA, expect a second prompt from the browser, or no browser. **Medium.**
- **Chained ssh from the remote host.** The second `ssh` runs on the remote machine, and it isn't MobaXterm's binary, so the GUI never hears about it. The browser stays on the first host. **High** (follows from the mechanism).
- **Jump hosts.** `TunneledHostname` and the `MOBATUNNEL:` message form exist for sessions MobaXterm starts through a gateway. For those, the browser goes through a local tunnel (`127.0.0.1`) [B1][D1]. Whether `ssh -J` typed by hand gets the same treatment is unknown.
- **When ssh exits.** The client sends an end-of-session message tagged with the tab id [B1]. The browser probably disconnects or closes. **Low** on what the UI shows.

## 4. Non-MobaXterm ssh

A Windows `ssh.exe` in a cmd or PowerShell tab, or WSL's `ssh`, has no `TMobaXtermForm` hook, so MobaXterm learns nothing and opens no browser. **High**, from the mechanism. No first-party source says so directly.

## 5. What slop-term could do with stock OpenSSH

slop-term can't patch the system `ssh`. Everything here works from outside the binary: environment, config, or a wrapper on `PATH` in the node-pty shell.

### ControlMaster

- **Windows.** Not available. The Project Scope page lists "Client ControlMaster" as scoped out [W1]. The maintainer said in 2016: "ControlMaster is not supported on Windows yet" [W2]. In 2019: "It relies on a particular feature of Unix Domain sockets (passing ancillary data), that's not easy to realize in Windows" [W3]. Setting `ControlPath` makes the client fail with `muxclient socket(): Unknown error` or `getsockname failed: Not a socket` [W2]. The AF_UNIX PR (#674, opened 2023-04-12) is still open and unmerged [W4]. The newest release on 2026-10-20 is `10.4.0.0p1-Preview`. The in-box client here is `OpenSSH_for_Windows_9.5p2` [L]. **High.**
- **macOS.** Supported. `ControlMaster`, `ControlPath` and `ControlPersist` are standard [O1]. If slop-term starts the shell with `-F` or an `Include` that sets `ControlMaster auto` and a `ControlPath` in slop-term's own folder, then a typed `ssh` creates a master socket. slop-term can then run `ssh -S <path> -s <host> sftp` (`-s` requests a subsystem [O2]) and speak SFTP over stdio, with no second login and with 2FA handled. The costs:
  - The `ssh2` library can't use the socket. slop-term would need a stdio SFTP client, or would have to run `sftp -o ControlPath=...`.
  - It changes the user's ssh behaviour. Masters linger with `ControlPersist`. A user's own `ControlPath` conflicts with slop-term's.
  - Matching a typed command to a socket needs the `%C` hash or the `-O check` command.
  - **Medium** overall.

### Injection points at spawn

| Method | Gives slop-term | Windows | macOS | Trade-offs |
|---|---|---|---|---|
| `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force` | The prompt text and the typed secret, through a slop-term helper that shows its own dialog | Works. Tested with `OpenSSH_for_Windows_9.5p2`: a `.cmd` helper received `(demo@test.rebex.net) Password: ` and the login succeeded [L] | Works, standard OpenSSH [O2] | Every prompt in that shell (passwords, passphrases, keyboard-interactive, and with `force` host-key confirmations too) leaves the terminal for slop-term's dialog. The helper gets no host or user except in the prompt text. Git and other tools that honour `SSH_ASKPASS` are also affected. The secret passes through a helper process, so it has to be handled per ticket 08's no-cache rule. |
| `PATH` shim named `ssh` | The command line, so it can parse host, user and port. It can also add `-o` options. | Possible, but `ssh.exe` is found through `PATH` and PowerShell/cmd lookup rules. A shim has to forward the console correctly (ConPTY). | Easy (a script ahead of `/usr/bin` on `PATH`) | Breaks if the user calls the full path or has their own wrapper. It doesn't give the secret unless combined with askpass. It's fragile across shells. |
| `-F` / `Include` of a slop-term `ssh_config` | Config options such as `ControlMaster`, `LocalCommand`, `PermitLocalCommand` | `-F` needs the shim. There's no env variable for the config path. | Same | `-F` replaces the user's `~/.ssh/config` unless the file `Include`s it. Editing the user's config is invasive. |
| `ProxyCommand` | The TCP byte stream, which is encrypted | Works | Works | No access to the session. slop-term can see host and port but nothing usable for SFTP. |
| `LocalCommand` (`PermitLocalCommand yes`) | A notification on successful connect, with `%h %p %r` | Works (`LocalCommand` isn't on the out-of-scope list [W1]) | Works | A clean signal that "user is now logged into host X" without touching the secret. It runs the command locally after connecting [O1]. It needs config injection as above. |
| `GIT_SSH`-style variables | Nothing | n/a | n/a | Only git reads them. Interactive `ssh` doesn't. |

### Assessment

- Copying MobaXterm (learn the typed password, open a second connection) is possible only through `SSH_ASKPASS` with `force`. It works on both platforms, but it moves every prompt out of the terminal and makes slop-term handle a secret the user typed for another program. It also doesn't solve 2FA, because the second `ssh2` login would need a fresh code.
- Reusing the typed connection works only on macOS, through ControlMaster. It's the only route that handles 2FA without a second prompt.
- The cheapest sound design: detect typed `ssh` (from a `LocalCommand` hook or by watching the shell's child processes) and offer an SFTP pane that logs in on its own with `ssh2`. It uses the Credential provider for a matching Saved session, or the agent, or asks. That matches what MobaXterm does in practice: its browser is a second login too [D1].

## Open questions

- Not checked in a running MobaXterm: what the browser shows when the typed `ssh` exits, and whether a typed `ssh -J` gets the tunnel path.
- The askpass test was non-interactive (stdin from `/dev/null`). Behaviour inside a ConPTY under node-pty wasn't tested. With `force`, OpenSSH uses askpass even with a terminal attached [O2].
