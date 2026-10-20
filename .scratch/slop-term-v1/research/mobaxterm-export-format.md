# MobaXterm session export format

Answers ticket `issues/04-mobaxterm-export-format.md`.

## Summary

A `.mxtsessions` export and the `[Bookmarks*]` sections of `MobaXterm.ini` use the same INI layout. Each section is one folder, and each line in it is one Saved session: `Session name=<value>`. The value splits on `#` into blocks, and the connection block splits on `%` into positional fields. For SSH, field 0 is the session type (`0`), then host, port, user, and at index 14 the private key path. Mobatek publishes no spec. The field map below comes from Sessionator, an open-source reader and writer, checked against a real `MobaXterm.ini` on this machine. Saved passwords never appear in the bookmark lines. They sit either in the registry under `HKCU\Software\Mobatek\MobaXterm\P` and `\C`, or in the `[Passwords]` and `[Credentials]` sections of `MobaXterm.ini`. The `PasswordsInRegistry` flag in `[Misc]` selects between the two.

Confidence labels: **high** means seen in the local file and in a source, **medium** means one credible source, **low** means inferred.

## Sources

- [S1] Sessionator, a PHP library that reads and writes `.mxtsessions` files: https://github.com/Ruzgfpegk/sessionator (commit `d8ccd67`, May 2026). The files used are `src/Formats/MobaXterm/Input.php`, `SSH.php`, `SettingBlock.php`, `Settings.md`, and the sample export in `public_html/index.php`.
- [S2] Mobatek, "MobaXterm configuration settings": https://blog.mobatek.net/post/mobaxterm-configuration-settings/
- [S3] HyperSine, how-does-MobaXterm-encrypt-password: https://github.com/HyperSine/how-does-MobaXterm-encrypt-password (2019). The files used are `README.md` and `python3/MobaXtermCipher.py`.
- [S4] Metasploit module `post/windows/gather/credentials/moba_xterm`: https://github.com/rapid7/metasploit-framework/blob/master/modules/post/windows/gather/credentials/moba_xterm.rb (read through a summary, not line by line).
- [S5] XM Cyber, "Extracting encrypted credentials from common tools 2": https://www.xmcyber.com/blog/extracting-encrypted-credentials-from-common-tools-2/
- [S6] CVE-2025-0714 (password storage in MobaXterm before 25.0): https://tenable.com/cve/CVE-2025-0714
- [S7] Devolutions forum, "Import sessions from MobaXterm", with sample lines from a user: https://forum.devolutions.net/topics/21272/import-sessions-from-mobaxterm
- [S8] Velociraptor artifact `Windows.MobaXterm.Passwords`: https://docs.velociraptor.app/exchange/artifacts/pages/custom.windows.mobaxterm.passwords
- [S9] Mobatek, MobaXterm 20.0 release notes: https://blog.mobatek.net/post/mobaxterm-new-release-20.0
- [S10] Portable Freeware forum, quoting the Mobatek 4.5 release note on ini password storage: https://www.portablefreeware.com/forums/viewtopic.php?p=46083 (seen through a search summary only)
- [L] The local `%APPDATA%\MobaXterm\MobaXterm.ini` on this machine (MobaXterm installed, 7 folders, 19 SSH sessions). Only the structure was inspected. No values are copied here.

## Where the files live

- Installer edition: `%MyDocuments%\MobaXterm\MobaXterm.ini`. Portable edition: next to the executable, falling back to `%MyDocuments%\MobaXterm` when that folder is read-only [S2]. **Medium.** On this machine the file is `%APPDATA%\MobaXterm\MobaXterm.ini` [L], so an importer should check `%APPDATA%\MobaXterm`, `%MyDocuments%\MobaXterm` and the executable's folder, or let the user pick the file. **High** for the fact that `%APPDATA%` is used too.
- The `-i <path>` command-line switch points MobaXterm at another ini file (Mobatek command-line docs, found through search, not read in full). **Low.**
- A `.mxtsessions` file is what MobaXterm writes when the user exports sessions. It holds only `[Bookmarks*]` sections, in the same format as the ini [S1][S7]. **High.**

## File layout

The file is INI with Windows (CRLF) line endings, in the system ANSI code page rather than UTF-8. Sessionator decodes it as Windows-1252 [S1], and a Chinese MCP server reads it as GBK. An importer should decode with the user's ANSI code page, falling back to Windows-1252. **Medium.**

```ini
[Bookmarks]
SubRep=
ImgNum=42
Root session=#109#0%root.example.com%22%alice%...

[Bookmarks_1]
SubRep=Clients\Acme
ImgNum=41
web-01=#109#0%web01.example.com%22%deploy%%-1%-1%%%%%0%0%0%_ProfileDir_\.ssh\id_ed25519%%-1%0%0%0%%1080%%0%0%1%%0%%%%0%-1%-1%0#MobaFont%10%0%0%-1%15%236,236,236%30,30,30%180,180,192%0%-1%0%%xterm%-1%0%_Std_Colors_0_%80%24%0%1%-1%<none>%%0%1%-1%-1#0#Free text comment#-1
```

- `[Bookmarks]` is the root folder. `[Bookmarks_N]`, numbered from 1, is one folder each [S1][L]. **High.**
- `SubRep` is the folder's full path from the root, with `\` between levels (`Main Directory\Subdir` in the S1 sample). An empty value means the root. Sub-folders are separate sections, not nested ones [S1]. **High** for the existence of the field, **medium** for the `\` separator, because every folder on this machine is one level deep [L].
- `ImgNum` is the folder icon: 42 on the root, 41 on a normal folder, other numbers for custom icons [S1][L]. **High.** An importer can ignore it.
- Every other key in a section is a session. The key is the display name and the value holds the settings. Names can contain spaces [S1]. **High.**

## Session value: `#` blocks

Sessionator splits the value on `#` into 7 parts [S1]. **High** (the local lines match).

| Part | Meaning | Notes |
| --- | --- | --- |
| 0 | Empty in every observed line | Sessionator calls it a reconnection setting (TODO) |
| 1 | Session icon number | 109 is the SSH icon. Some tools mistake this for the protocol code. It is not. |
| 2 | Connection block, `%`-separated | Field 0 is the session type. See below. |
| 3 | Terminal block, `%`-separated | Font, size, colours, `xterm`, columns and rows. Not needed for import. |
| 4 | Tab setting | `0` |
| 5 | Comment | `#` in the text is written as `__DIEZE__` [S1] |
| 6 | Tab colour | `-1` by default, `255` seen locally |

Session type codes (field 0 of part 2) [S1]: `0` SSH, `4` RDP, `5` VNC, `7` SFTP, `11` Browser. The local file also has `14` for a WSL session [L]. **High** for SSH. Other codes (Telnet, serial, shell) exist but don't matter for v1, which imports only SSH.

## SSH connection block (part 2)

Booleans are usually `-1` for on and `0` for off. A few use `1` and `0` [S1]. Field positions come from `SSH.php` in [S1].

| Index | Field | Notes | Confidence |
| --- | --- | --- | --- |
| 0 | Session type | `0` for SSH | High |
| 1 | Host | Hostname or IP | High |
| 2 | Port | `22` by default | High |
| 3 | User name | Empty means MobaXterm prompts | High |
| 4 | Unknown | Empty, or a single space in older lines [L] | High (unknown) |
| 5 | X11 forwarding | `-1`/`0` | Medium |
| 6 | Compression | `-1`/`0` | Medium |
| 7 | Command at login | `;` written as `__PTVIRG__`, `"` as `__DBLQUO__`, `\|` as `__PIPE__` | Medium |
| 8 | SSH gateway (jump host) hosts | List separated by `__PIPE__` | Medium |
| 9 | Gateway ports | Separated by `__PIPE__` | Medium |
| 10 | Gateway users | Separated by `__PIPE__` | Medium |
| 11 | Stay connected after the command | | Medium |
| 12 | "No user name" flag | `-1` when field 3 is empty | Medium |
| 13 | Remote environment | `0` interactive shell, `1` LXDE | Medium |
| 14 | Private key path | See path tokens below | High |
| 15 | Gateway private keys | Separated by `__PIPE__` | Medium |
| 16-17 | SFTP browser on, follow the terminal folder | `-1` | Medium |
| 19-22 | Proxy type, host, port, login | Type `0` none, `1` SOCKS4, `2` SOCKS5, `3` HTTP, `5` local, `6` SSH forwarding, `7` SSH command. Port `1080` by default. | Medium |
| 25 | File browser protocol | `0` off, `1` SFTP, `2` SCP fast, `3` SCP | Medium |
| 26 | Proxy command | | Medium |
| 27 | SSH version | `0` auto, `1` v2, `2` v1 | Medium |
| 28-30 | KEX, host key types, ciphers | Empty means default | Medium |
| 33 | Try the SSH agent | `-1` | Medium |
| 34 | Agent forwarding | `0` | Medium |
| 35-36 | Key certificate, host certificate | Newer versions only | Medium |

Things an importer has to handle:

- **Trailing fields can be missing.** On this machine, 6 of the 19 SSH lines stop after index 13 or 14 (`...%0%0%Interactive shell%` with no terminal block). The S7 sample has the same shape, with the text `Interactive shell` at index 13 instead of `0`. These are lines from older MobaXterm versions, and the program still loads them [L][S7]. **High.** Treat a missing field as its default, and accept either `0` or `Interactive shell` at index 13.
- **Path tokens in the key path.** MobaXterm writes `_CurrentDrive_` for the drive of the MobaXterm executable (`_CurrentDrive_:\keys\id_rsa`) [S1] and `_ProfileDir_` for the user's home folder (`_ProfileDir_\.ssh\id_ed25519`) [L]. Plain absolute paths such as `C:\Users\...\key.ppk` also appear [L]. **High.** Expand `_ProfileDir_` to `%USERPROFILE%` (or `~` on macOS) and `_CurrentDrive_` to the drive that holds the ini file. There may be more tokens. Sessionator's notes mention `<>` for the executable folder in log paths [S1]. **Low** on whether that list is complete.
- **Key format.** MobaXterm accepts PuTTY `.ppk` keys as well as OpenSSH keys. A `.ppk` path in field 14 works in MobaXterm but not in OpenSSH's `IdentityFile`. An importer has to warn about it or convert the key. **Medium** (from general MobaXterm and PuTTY behaviour, not from a source that covers this format).
- **Escapes.** Values use `__PTVIRG__` for `;`, `__DBLQUO__` for `"`, `__PIPE__` for `|` and `__DIEZE__` for `#` [S1]. **Medium.** There is no known escape for `%` or `=`.

## Saved passwords

Passwords are never in the bookmark lines. MobaXterm keeps them in one of two places, and `PasswordsInRegistry` in `[Misc]` picks which [S4]. **Medium.**

- **Registry.** `HKCU\Software\Mobatek\MobaXterm\P` holds session passwords, `\C` holds named credentials, and `\M` holds the master-password data [S3][S5][S8]. **High** (three independent sources). Password value names look like `ssh22:alice@host.example.com`, meaning protocol plus port, user and host. Credential entries are named by the credential's label and hold `user:<encrypted password>` [S3]. **Medium.**
- **Ini file.** Since version 4.5, MobaXterm saves passwords in the ini by default unless the registry already has some [S10]. They go in `[Passwords]`, `[Credentials]` and `[Sesspass]`, with the same key formats [S4]. **Medium.**
- **Encryption.** Without a master password, older versions use a weak custom cipher keyed from the `SessionP` value in `[Misc]` or the registry, plus the Windows user and host names [S3]. With a master password, MobaXterm stores the SHA-512 of the master password under DPAPI in `\M`. Each password is AES-CFB-8 encrypted with the first 32 bytes of that hash and a fixed IV [S3][S5]. Version 20.0 made the master password mandatory for stored passwords [S9]. Version 25.0 changed the scheme to fix the fixed IV (CVE-2025-0714) [S6], and no public source describes the new scheme yet. **Medium** for the old schemes, **low** for anything after 25.0.
- **On this machine** the settings are `StorePasswords=Never`, `PasswordsInRegistry=0` and `StoreSSHKeysPassphrases=0`. The ini has no `[Passwords]` or `[Credentials]` section and there is no `HKCU\Software\Mobatek` key [L]. **High.** This user has no MobaXterm passwords to migrate.

## What this means for slop-term

- Map host (1), port (2), user (3), key path (14) and folder (`SubRep`) onto SSH config and the Sidecar file. Fields 8-10 and 15 map to `ProxyJump` if bastions are ever needed.
- Import no secrets in v1. The user stores none, and decrypting them would mean depending on an undocumented scheme that changed in 25.0. If needed later, the safe route is to ask the user to type each password once into a Credential provider.
- Read the user's own `MobaXterm.ini` directly instead of asking for an export. The format is the same, and the user doesn't have to do anything in MobaXterm.

## Open questions

- Index 4 and index 18 of the SSH block have no known meaning. Both are empty or `0` on every line seen.
- Whether a `.mxtsessions` export can include passwords. No source says so, and the export dialog was not tested.
- Whether a session name can contain `=`, and how MobaXterm would write it.
