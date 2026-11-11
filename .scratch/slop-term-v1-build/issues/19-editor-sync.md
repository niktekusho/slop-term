# 19 — Editor sync

**What to build:** Double-clicking a remote file opens it in the user's own editor, and saving uploads it back after checking that nobody changed the remote copy in the meantime. Saves survive a dropped connection and an app crash.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 18 — SFTP transfers

**Status:** done

- [x] Double-click or "Open in editor" downloads the file to an app temp folder and opens it in the editor from settings, else `code` on PATH, else `notepad++` on PATH, else `C:\Program Files\Notepad++\notepad++.exe` (Windows), else the OS default app.
- [x] "Upload on save" is on by default; off, the app asks on each save.
- [x] Before each upload the app compares the remote file with the downloaded version: SHA-256 of a fresh read up to 10 MB, modified time and size above; if changed it asks whether to overwrite or cancel.
- [x] Editor-sync files appear as transfer rows ("open in VS Code · uploaded 15:41").
- [x] On a drop, saves wait as "waiting for connection" and go out after the remote-change check once reconnected.
- [x] Closing a Tab with a file open for editor sync asks first. Temp copies are deleted when the Tab closes.
- [x] At startup, temp copies with saves that never reached the server are listed with their paths for recovery; the rest are deleted.
- [x] Back-end tests: save uploads, remote-changed detection under and over 10 MB, waiting save after reconnect, startup recovery listing.

## Test coverage

Back end: `src/backend/editor-sync.test.ts`, against `startFakeSshServer` with `sftp: true`. The fake now answers reads, opens a file without truncating it unless asked, and keeps a modified time per file in `mtimes`. UI: the "editor sync" block inside "transfers" in `src/renderer/SftpPane.test.tsx`, against `FakeBackend`.

- Open and editor: back end "downloads the file, opens it in the editor from settings and uploads each save" sets `editor` in `settings.json` to a script that writes the path it gets into a file. The copy sits under the app data folder, in `editor-sync/`. A second open of the same file shows the same copy and adds no row. UI "opens a file in the editor on double-click, Enter and Open in editor". The fallbacks (`code`, `notepad++`, the Notepad++ path, the OS default) depend on what the machine has installed, so no test covers them. `openInEditor` in `editor.ts` picks them.
- Upload on save: back end "asks on each save with upload on save off": "Not now" leaves the remote file alone, and the next save asks again. The default `true` is in the two default lists of `settings.test.ts`. "records what it uploaded when a save comes in while a question is open" saves again while "Upload?" is open and sees no "changed" question. It failed when the upload sent the file on disk but recorded the hash read before the question.
- Remote-changed check: back end "asks before uploading over a remote file up to 10 MB whose content changed, keeping its size and modified time" checks Cancel and Overwrite. "compares modified time and size of a remote file over 10 MB" changes only the content of a 10 MB + 1 byte file and sees no question, then changes only its modified time and sees one. Each half fails if the code always or never reads the file. UI "asks before uploading over a remote file that changed, and on each save with upload on save off" opens a collapsed pane to ask.
- Rows: UI "shows an open file as a row naming its editor and last upload, which stays" checks "open in VS Code · uploaded 15:41", "Waiting for connection", the reason with Retry, no cancel, and that the row is still there after the 3 s that clears a finished transfer.
- Drop: back end "holds a save made during a drop as waiting, and checks and uploads it after the reconnect" changes the remote file during the drop and sees the "changed" question after the reconnect. A first download cut by a drop fails and stays retryable, as a transfer does, and a yes to "Upload?" survives the drop so the save asks only once. No test covers these two branches.
- Closing a Tab: back end "deletes the temp copies when the Tab closes". UI "asks before closing a Tab with a file open in an editor, and shows its copy". An upload that finishes after the close writes no manifest, and the startup scan deletes a manifest with no folder. No test times a close against an upload.
- The save question sends only its question's id, held from when it opened. Its UI test emits a `tree` event while the dialog is open.
- Startup: back end "lists the copies with saves that never reached the host after a crash, and deletes the rest" kills the back end with a save waiting and starts a new one on the same home folder (`harness.crash()`). UI "lists the copies with saves that never reached the host at startup". The listed copies stay on disk, so each start lists them until the user deletes them.
- Platform fact checked by running it: on Windows, `openInEditor` starts a `.cmd` editor whose path has no spaces through `cmd` with the quoted command line, and the script gets the copy's path as `%~1`. The editor-sync tests ran on Windows 11.
