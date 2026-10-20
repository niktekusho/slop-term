# MobaXterm session export format

Type: research
Status: resolved
Blocked by:

## Question

What is the structure of MobaXterm's saved sessions, as found in `.mxtsessions` exports and the `[Bookmarks]` sections of `MobaXterm.ini`? Specifically, how SSH sessions encode host, port, user, key file, folder and other settings, and where MobaXterm keeps saved passwords.

## Answer

`.mxtsessions` exports and `MobaXterm.ini` share one INI layout. `[Bookmarks]` is the root folder, each `[Bookmarks_N]` is one folder with its path in `SubRep` (levels separated by `\`), and each other key is one session: `name=#icon#type%host%port%user%...#terminal#tab#comment#colour`.
For SSH (type `0`) the `%` fields are host at index 1, port at 2, user at 3 and key path at 14 (with `_ProfileDir_` and `_CurrentDrive_` tokens). Indexes 8-10 hold jump hosts. Lines from older versions stop early, so a missing field means its default.
Passwords are never in the session lines. They are in `HKCU\Software\Mobatek\MobaXterm\P` and `\C`, or in the ini's `[Passwords]` and `[Credentials]` sections, encrypted with an undocumented scheme that changed in 25.0. This user stores none (`StorePasswords=Never`).
Mobatek publishes no spec. The field map comes from the open-source Sessionator library and was checked against the local ini.

Findings: [research/mobaxterm-export-format.md](../research/mobaxterm-export-format.md)
