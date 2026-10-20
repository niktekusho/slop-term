# Glossary

**Saved session**: The stored settings for one connection: host, port, user, auth method, folder. There is no limit on how many exist.

**Tab**: A live connection opened from a Saved session, or a local shell. One Saved session can have several Tabs open at once.

**SFTP pane**: The file browser beside a Tab, in the same window, showing the files of the remote host that Tab is connected to. It belongs to the Tab, so a local shell Tab running `ssh` can have one too.
_Avoid_: file browser, SSH-browser, SFTP browser

**SSH config**: The user's standard OpenSSH config file (`~/.ssh/config`). Other SSH tools read the same file. Each `Host` entry with a concrete alias is a Saved session; pattern entries such as `Host *` are defaults, not Saved sessions.

**Managed config**: The OpenSSH-format file the app owns, included from the SSH config. Saved sessions created in the app live here. It is synced between machines.

**Hand-written host**: A Saved session defined in the user's own SSH config rather than the Managed config. The app shows it but does not edit it until the user moves it into the Managed config.

**Sidecar file**: A file next to the Managed config that holds what OpenSSH config cannot express, such as folders and Credential references, for any Saved session. It never contains secrets.

**Credential provider**: A source the app reads secrets (password or key passphrase) from and saves them to. The OS keychain is one; an external password manager is another. A provider may refuse writes.

**Credential reference**: What a Saved session stores instead of a secret: which Credential provider to ask, the id of the entry there, and whether the secret is a password or a key passphrase. A Saved session has at most one; several Saved sessions can point at the same entry.
