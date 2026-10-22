# 18 — SFTP transfers

**What to build:** The user uploads and downloads files and folders from the SFTP pane, including by dragging files in from the OS, without making the terminal lag. Transfers queue per Tab with progress, cancel and retry, and an existing target asks overwrite, skip or keep both.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 08 — Password login and keychain provider; 17 — SFTP pane browsing and file actions

**Status:** ready-for-agent

- [ ] Transfers run on a second connection opened on the first transfer and closed after 5 minutes with no transfers. It logs in with the session's key, agent or Credential reference, or the password typed for the Tab, and must present the host key the Tab accepted: a different key blocks with the changed-key warning in the pane, never a question.
- [ ] Hosts that asked a keyboard-interactive prompt run transfers on the Tab's connection instead.
- [ ] Keepalives on the transfer connection use the Tab's values.
- [ ] One queue per Tab, one file at a time; folders transfer with everything inside.
- [ ] Download saves to the last folder used (Downloads the first time); Download to… opens a folder picker; Upload files… opens a file picker; files dragged in from the OS upload, with a dashed overlay "Drop to upload to <path>". No drag out.
- [ ] Transfer list docked at the bottom under "Transfers" with the active count; a row shows direction, name, target folder, progress bar with percent, bytes and speed, and cancel. Finished items clear after a few seconds; a finished download shows "Saved to <folder>" as a link that reveals the file in Explorer or Finder. Failed rows show the reason in red and retry.
- [ ] The collapsed strip shows the running upload's percentage.
- [ ] Conflict dialog names the file, compares size and modified time on this computer and on the host, and offers Overwrite, Skip and Keep both (` (1)` suffix), with "Apply to the other N conflicts".
- [ ] Closing a Tab with pending transfers asks first and offers "Show local copy".
- [ ] On a drop running transfers fail and stay retryable.
- [ ] Back-end tests against the Docker server: upload, download, recursive folder, conflict choices, second connection idle close, pinned host key mismatch, keyboard-interactive fallback to the Tab's connection.
