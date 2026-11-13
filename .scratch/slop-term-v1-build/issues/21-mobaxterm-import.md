# 21 — MobaXterm import

**What to build:** The user imports their MobaXterm sessions once. A preview lists every session with a checkbox and its problems, and nothing is written until the user confirms. SSH sessions become Managed Saved sessions in nested folders, WSL sessions become Local shell sessions, and everything that can't come across is listed.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 12 — Folders and Move into slop-term; 13 — Local shell Saved sessions; 14 — Session colours

**Status:** done

- [x] A file picker prefilled with the first `MobaXterm.ini` found in `%APPDATA%\MobaXterm`, `Documents\MobaXterm` or the executable's folder; `.mxtsessions` files accepted. Decoded with the system ANSI code page, falling back to Windows-1252.
- [x] Parsing: `[Bookmarks]` is the root, each `[Bookmarks_N]` a folder whose `SubRep` splits on `\`; session lines `name=#icon#type%host%port%user%...#terminal#tab#comment#colour`; SSH (type `0`) host at 1, port 2, user 3, key path 14; a missing field means its default.
- [x] Alias: lowercase, runs of spaces or illegal characters become `-`, editable in the preview and checked as typed.
- [x] A row whose alias exists starts unticked "already exists"; a row whose host, port, user and key match an existing host starts unticked "already in SSH config as `<alias>`"; differing fields are shown; whitespace-only values count as empty. A second import adds nothing by default.
- [x] Folders map to nested Sidecar folders, reusing existing paths; root sessions go to the tree root; no empty folders are created.
- [x] Key paths: `_ProfileDir_` → `~`, `_CurrentDrive_` → the source file's drive, `\` → `/`, home paths written `~/...`, other absolute paths kept and flagged "won't work on macOS". `.ppk` keys are dropped and flagged with the PuTTYgen steps.
- [x] Jump hosts (fields 8–10 and 15) and login commands (field 7) are dropped and listed. Empty user writes no `User`. X11 ignored. The comment becomes a `#` line above the block. Each SSH session gets `ServerAliveInterval 15`.
- [x] WSL (type 14) becomes a `wsl` Local shell session with empty distro, noted "opens your default WSL distro". Other non-SSH types are skipped and listed.
- [x] Tab colour maps to the nearest Session colour (`255` → Red, `-1` → none), shown and editable in the preview.
- [x] Passwords are not imported. Host keys are not copied.
- [x] Confirm writes the Managed config and the Sidecar file once each, under re-read-before-write.
- [x] Back-end tests with fixture INI files shaped like the user's real file (19 SSH sessions, 1 WSL, 7 folders, 17 names with spaces, 1 `.ppk`, 3 identical and 1 differing match against existing hosts), plus short legacy lines and a second import adding nothing.

## Test coverage

Back end: `src/backend/mobaxterm.test.ts`. UI: `src/renderer/Import.test.tsx`.

- Picker prefill: "the import file picker" tests (AppData first, then Documents). The UI test "opens the picker at the MobaXterm.ini found" checks that the picker starts there. The `.ini`/`.mxtsessions` filter lives in the main process's native dialog (`src/main.ts`), which no seam reaches. A running MobaXterm's folder and the Program Files folders have no test: the test machine has neither. Decoding: "decodes the file in the ANSI code page". This machine's code page is 1252, from `reg query "HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage" /v ACP`.
- Parsing: "lists an SSH session…", "puts each session in the folder its SubRep names…", "reads a short line from an older MobaXterm…".
- Alias: "lists an SSH session with its alias slugified" (back end). "checks an edited alias as it is typed…" (UI).
- Existing aliases and hosts: "starts a row unticked when its alias is taken…", "starts a row unticked when host, port, user and key all match…" (whitespace-only user included), "matches an existing key written as an absolute path…". The second import is in "previews every session, imports the ticked ones and adds nothing on a second run".
- Folders: "puts each session in the folder its SubRep names…", "reuses an existing folder whose path differs only in case". "writes the confirmed rows…" checks that the folder list gains no folders.
- Key paths: "translates key paths to ~/... and flags…".
- Jump hosts, login commands, empty user, comment, `ServerAliveInterval 15`: "lists the jump hosts and login commands it drops…" and "writes the confirmed rows…". X11 has no test: the parser never reads field 5.
- WSL and other types: "turns a WSL session into a wsl Local shell session…".
- Colour: "maps the tab colour to the nearest Session colour" (back end). "imports the ticked rows as shown, with the edited alias and colour…" (UI).
- Passwords and host keys: the real-shape test checks that no imported session has a Credential reference. The import never writes `known_hosts`, so that has no test.
- Confirm and re-read before write: "writes nothing when an alias was taken after the preview" and "writes the confirmed rows…". The import writes each file once by construction (`importSessions` in `config-store.ts`). The UI test emits a `tree` event while the preview is open.
- Fixture shaped like the user's file: "previews every session, imports the ticked ones and adds nothing on a second run" (19 SSH, 6 short legacy lines, 1 WSL, 7 folders, 17 names with spaces, 1 `.ppk`, 3 identical matches and 1 differing match).
