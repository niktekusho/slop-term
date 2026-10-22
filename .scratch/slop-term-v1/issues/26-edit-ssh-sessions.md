# Creating and editing SSH Saved sessions

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

How does the user create, edit and organise SSH Saved sessions in the app? Earlier tickets decided where they are stored ("What goes in SSH config vs the Sidecar file"), how they arrive from MobaXterm and from a typed `ssh` ("Saving passwords typed for `ssh <host>`"), and how the tree looks ("Session tree look"), but not the editing itself.

Points to settle: which fields the form shows (alias, `HostName`, `Port`, `User`, `IdentityFile`, folder, Credential reference, Session colour), and what it does with other OpenSSH options already in the host's block; where New, Edit, Duplicate and Delete live; whether folders nest, and how the user creates, renames, deletes and moves between them (drag and drop in the tree or a picker); whether the alias rules from "How MobaXterm sessions map onto slop-term" apply to every new alias; what editing a Hand-written host offers, given it is read-only until moved in; what happens to open Tabs when their Saved session changes.

## Answer

Decided with the user on 2026-10-22.

1. A modal dialog creates and edits a Saved session. Save writes the Managed config and the Sidecar file once each, under the re-read-before-write rule from "What goes in SSH config vs the Sidecar file".
2. The SSH form shows alias, `HostName`, `Port`, `User`, `IdentityFile` (with a file picker), folder, Credential reference and Session colour. An empty field shows in grey the value `ssh -G` would use. `IdentityFile` is written as `~/.ssh/<name>` when the key sits in the home folder. Any other path is kept and flagged "won't work on macOS". There is no note field, and existing `#` comments stay as they are. The user hardly touches these fields in MobaXterm, so the list is final only after "Saved session dialog look".
3. An "Other options" text box holds every other line of the host's block, one `Key value` per line. The app parses it on Save and rejects lines it can't parse. A `ProxyJump` line stays visible there and fails at connect, as "ProxyJump in v1" decides.
4. Every alias created or renamed in the app follows the import rules from "How MobaXterm sessions map onto slop-term" point 3. The app lowercases it as the user types and rejects spaces, `*`, `?`, `!` and `,` with a message. The alias must be unused across Managed hosts, Hand-written hosts and Local shell sessions, ignoring case. OpenSSH 10.5 matches aliases case-sensitively, so `Host Web1` doesn't match `ssh web1`.
5. Actions. A "New" button beside the tree filter offers SSH session, Local shell session and Folder. A Saved session's right-click menu has Open Tab, Edit, Duplicate, Move to... and Delete. A folder's menu has New SSH session here, New local shell here, New folder here, Rename and Delete. While the tree has focus, Enter opens a Tab, F2 opens Edit, Delete asks to delete, and F7 opens Move to.... There are no new global shortcuts.
6. Folders nest to any depth. Empty folders are kept, so the Sidecar file stores a folder list as well as each session's folder. A folder name is any text without `/`, unique among its siblings ignoring case. A rename that would collide is rejected, not merged.
7. Deleting a non-empty folder asks first and counts what it holds: "Delete folder `prod`, 2 subfolders and 12 Saved sessions?". Cancel is the default. One unticked checkbox, "Also delete 5 saved secrets from keychain / KeePass", counts only entries no Saved session outside the folder uses, and never TPM. A locked KeePass database asks for its master password, as a single delete does. Open Tabs of the deleted sessions move to the Unsaved group. The app writes each file once, not once per session.
8. Moving: drag and drop in the tree for sessions and folders, Move to... (F7, a picker with a filter box: type part of a folder name, then Enter), and the folder field on the form. No multi-select in v1.
9. Hand-written hosts are fully read-only and are no longer Saved sessions. They have no folder, Credential reference or Session colour, and no Edit or Duplicate. Their menu has Open Tab and "Move into slop-term". They sit in the Unsaved group, which lists unsaved local shell Tabs, then Tabs whose Saved session was deleted, then Hand-written hosts A to Z, each with a lock and its Tabs under it. A Managed host with no Sidecar entry sits at the tree root.
10. Same alias in both files: after "Move into slop-term" on one machine, a synced `slop-term.conf` can define an alias that another machine's `~/.ssh/config` also defines. OpenSSH merges them, the Managed entry winning for each option it sets. The tree shows only the Managed host, with a warning icon whose tooltip reads "Also defined in ~/.ssh/config line 12". Its menu adds "Comment out the copy in ~/.ssh/config", the same line edit that Move uses.
11. Duplicate opens the New form with every field copied, including Other options, folder, Session colour and the same Credential reference, so the two share the secret. The alias is `<alias>-2`, or the first free number after it. Nothing is written until Save.
12. The Credential reference field shows the provider, the entry and the kind. "Set secret..." takes a password or passphrase with "Save to: keychain / KeePass" and creates an entry. "Attach existing..." offers KeePass search, a TPM id or search, and "Same secret as `<Saved session>`". "Remove" drops the reference and shows the unticked delete-secret checkbox from "Saving passwords typed for `ssh <host>`" point 10, under the same rules. A `User` that differs from an attached TPM entry's username shows inline, the same check that blocks the connect.
13. Open Tabs: an edit doesn't touch live connections. The header bar, Session colour and tree position update straight away, and new values apply on the next connect ("Tab disconnect and reconnect" point 8). A rename or move carries the Tabs along. Deleting a session with open Tabs says "2 Tabs are open. They stay open." on the confirm, and the Tabs move to the Unsaved group under the old alias. The app watches `slop-term.conf`, `slop-term.json` and `~/.ssh/config` and reloads the tree when they change. A rename from outside the app looks like a delete plus a new session, so its Tabs move to the Unsaved group.
14. "Test" sits in the dialog footer, for SSH sessions only. It uses the form's unsaved values: `ssh -G <alias>` with each field and Other options line passed as `-o`, then an `ssh2` connect with the checks from "Host key checks" (an unknown host asks inside the dialog, and Trust saves the key), a login with the form's Credential reference or a password asked for the test alone, an SFTP open, and a disconnect. A checklist under the fields shows each step: resolved, reached `host:port`, host key, logged in as `alice`, SFTP. The first failure shows its reason. The TPM username check shows there too.
15. Local shell sessions get a New and Edit form too. Whether it is the same dialog as the SSH form is open in "Saved session dialog look". A session's kind (SSH or local shell) can't change after creation.

Changes "Saving passwords typed for `ssh <host>`" point 4, "Session tree look" point 9, "What goes in SSH config vs the Sidecar file" points 3 and 4, and "Credential provider interface" point 9 (see the corrections there).

Glossary: Saved session now means a Managed host or a Local shell session. Hand-written host, SSH config and Tab change to match.

Rejected: Sidecar fields on Hand-written hosts, since "Move into slop-term" is one click and loses nothing; cut and paste as the move shortcut, since without multi-select it gains nothing over the picker.

Correction (2026-10-22, from "Saved session dialog look"): point 2's field list is final. Point 3's text box becomes one `-o` row per line under the `ssh` command line, each with a short description, and new sessions start with `ServerAliveInterval 15`. Point 15: a Local shell session has its own smaller dialog.
