# How MobaXterm sessions map onto slop-term

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

When importing MobaXterm sessions (format in "MobaXterm session export format"), how does each one become a Saved session under the rules in "What goes in SSH config vs the Sidecar file"?

Points to settle: how a MobaXterm session name (which can contain spaces and slashes) becomes a `Host` alias; what happens when the alias already exists in the Managed config or as a Hand-written host; how MobaXterm folders map to Sidecar folders; what to do with `.ppk` key paths (convert, point to an existing OpenSSH key, or flag) and `_ProfileDir_` / `_CurrentDrive_` tokens; what to do with MobaXterm jump-host fields, given ProxyJump is still unresolved; and whether non-SSH sessions are skipped with a report.

## Answer

Decided with the user on 2026-10-20. The import shows a preview and writes nothing until the user confirms.

1. Source: a file picker, prefilled with the first `MobaXterm.ini` found in `%APPDATA%\MobaXterm`, `Documents\MobaXterm` or the MobaXterm executable's folder. It also accepts `.mxtsessions` exports, which use the same format. The app decodes the file with the system ANSI code page and falls back to Windows-1252.
2. Preview: one row per session, with a checkbox and the problems found. On confirm, the app writes the Managed config and the Sidecar file once each, under the re-read-before-write rule from "What goes in SSH config vs the Sidecar file".
3. Alias: the app lowercases the session name and turns each run of spaces or characters that are illegal in an alias into `-`. "Web Prod 01" becomes `web-prod-01`. The alias is the only name, with no separate display name. The user can edit the alias in the preview. The app checks an edited alias straight away: it must be legal and unused.
4. Collisions: a row whose alias already exists as a Managed or Hand-written host starts unticked, marked "already exists". The import never overwrites a host. Renaming the alias in the preview lets the row be imported. Running the import a second time adds nothing by default.
5. Same host under another alias: if host, port, user and key all match an existing host, the row starts unticked, marked "already in SSH config as `<alias>`". If any of them differ, the row starts ticked and shows the differing fields. Values that are only whitespace count as empty. OpenSSH picks an entry by the alias typed, so two entries for one host with different users work side by side.
6. Folders: `SubRep` splits on `\` into nested folders in the single Sidecar file. Sessions in the root section go to the tree root, with no "Imported" parent folder. A folder whose path already exists is reused. The import creates no empty folders.
7. Key paths: `_ProfileDir_` becomes `~`, `_CurrentDrive_` becomes the drive that holds the source file, and `\` becomes `/`. A path inside the home folder is written as `~/...`. Any other absolute path is kept and flagged "won't work on macOS".
8. `.ppk` keys: OpenSSH can't read PuTTY keys, so the session is imported without `IdentityFile` and flagged: "uses a PuTTY key. Convert it once with PuTTYgen (Conversions, Export OpenSSH key), save it as `~/.ssh/<name>`, then pick it in the Saved session." The app doesn't convert keys.
9. Jump hosts (fields 8-10 and 15): the session is imported without them and flagged "uses a jump host, not imported". This doesn't wait on the ProxyJump fog.
10. Login command (field 7): dropped and listed in the preview. Writing `RemoteCommand` would break `scp`, `sftp`, `ssh host <command>` and VS Code Remote-SSH for that host. All 6 login commands in the user's file are a single space.
11. Other fields: an empty user writes no `User` line, and the app asks at connect time. X11 forwarding is ignored, because the X11 server is out of scope. The comment becomes a `#` line above the `Host` entry.
12. Session types: WSL sessions (type 14) are imported as local shell sessions, in the shape "Local shell sessions" decides. Every other non-SSH type is skipped and listed in the preview.

The user's file, checked on 2026-10-20, has 19 SSH sessions, 1 WSL session, 7 folders one level deep, 17 names with spaces, 1 `.ppk` key, no jump hosts, no proxies and no custom ports. 4 sessions match hosts in `~/.ssh/config`: 3 are identical, and 1 differs only by user.

Correction (2026-10-22, from "Saved session dialog look" point 5): every imported SSH session also gets `ServerAliveInterval 15` in its host block.
