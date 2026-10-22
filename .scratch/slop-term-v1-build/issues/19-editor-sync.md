# 19 — Editor sync

**What to build:** Double-clicking a remote file opens it in the user's own editor, and saving uploads it back after checking that nobody changed the remote copy in the meantime. Saves survive a dropped connection and an app crash.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 18 — SFTP transfers

**Status:** ready-for-agent

- [ ] Double-click or "Open in editor" downloads the file to an app temp folder and opens it in the editor from settings, else `code` on PATH, else `notepad++` on PATH, else `C:\Program Files\Notepad++\notepad++.exe` (Windows), else the OS default app.
- [ ] "Upload on save" is on by default; off, the app asks on each save.
- [ ] Before each upload the app compares the remote file with the downloaded version: SHA-256 of a fresh read up to 10 MB, modified time and size above; if changed it asks whether to overwrite or cancel.
- [ ] Editor-sync files appear as transfer rows ("open in VS Code · uploaded 15:41").
- [ ] On a drop, saves wait as "waiting for connection" and go out after the remote-change check once reconnected.
- [ ] Closing a Tab with a file open for editor sync asks first. Temp copies are deleted when the Tab closes.
- [ ] At startup, temp copies with saves that never reached the server are listed with their paths for recovery; the rest are deleted.
- [ ] Back-end tests: save uploads, remote-changed detection under and over 10 MB, waiting save after reconnect, startup recovery listing.
