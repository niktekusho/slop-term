# Saved session dialog look

Type: prototype
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

What do the Saved session dialog and the tree's New button and right-click menus look like? "Creating and editing SSH Saved sessions" settled their behaviour. The user hardly touches these fields in MobaXterm and wants to see them before agreeing.

Points to settle: the SSH form's layout, with the eight fields, the grey `ssh -G` placeholders, the "Other options" text box and the Test checklist (points 2, 3 and 14); whether the field list is right once seen; whether a Local shell session uses the same dialog or a separate, smaller one (point 15); the New button beside the tree filter and the Saved session, folder and Hand-written host right-click menus (points 5 and 9); the Move to... picker (point 8); the folder delete confirm (point 7).

## Answer

Decided with the user on 2026-10-22, from a prototype in two rounds. Round 1 compared A ("Stacked form"), B ("Form + config"), C ("Sections") and D ("Command line"). The user was torn between B and D: D teaches the `ssh` flags, and B is simpler. Round 2 compared three hybrids, and the user picked E ("Rows + command line").

1. SSH dialog: a modal about 780 px wide. Labelled rows for Alias, Folder and Colour come first. A "Connect" row holds the command line `ssh -p [Port] -i [IdentityFile] […] [User]@[HostName]`, each part an inline input that shows its `ssh -G` value in grey when empty. `…` picks a key file. Under it a note reads "Typing `ssh <alias>` in a shell runs this command." Then the Secret row and the Test checklist. The footer has Test on the left, then Cancel and Save.
2. Fields: the eight from "Creating and editing SSH Saved sessions" point 2 are final. The Credential reference field is labelled "Secret".
3. Other options: no text box. Each line is a row under the command line: `-o`, an input holding `Key value`, a one-line description, and a remove button. "+ option" adds a row. A line the app can't parse shows its reason under its row, and so does the `ProxyJump` warning. The host block stores the lines as before.
4. Option descriptions: the app ships a short plain-language description for each `ssh_config` keyword, written for the app, and shows it beside the row. A keyword with no description shows nothing there.
5. Default options: every SSH Saved session the app creates starts with the row `ServerAliveInterval 15`. That covers New, the MobaXterm import and a session saved from a typed `ssh`. The user can edit or remove it. The list lives in code in v1. A `newSessionOptions` list in `settings.json` can come later.
6. Keepalives: a Tab uses `ServerAliveInterval` and `ServerAliveCountMax` from `ssh -G` as they are, with no 15 s cap, so a Tab and a typed `ssh` to the same alias behave alike. A host with no `ServerAliveInterval` still gets keepalives every 15 s from the app.
7. Local shell sessions get their own dialog, about 460 px wide: Name, Shell, WSL distro (WSL only), Start folder, Command, Folder and Colour. Under Command a note shows the launch line, for example "Starts `wsl -d Ubuntu --cd ~/src`". There is no Test button. A shell this machine lacks shows "(not on this machine)" in the Shell list, with a warning under it.
8. The New button sits right of the tree filter. Its menu lists SSH session, Local shell session and Folder, and creates the item in the selected row's folder.
9. Right-click menus show their shortcut on the right. A Saved session: Open Tab (Enter), Edit (F2), Duplicate, Move to… (F7), then Delete (Del) in red after a separator. A Managed host also defined in `~/.ssh/config` adds "Comment out the copy in ~/.ssh/config". A folder: New SSH session here, New local shell here, New folder here, Rename (F2), Move to… (F7), Delete (Del). A Hand-written host: Open Tab, Move into slop-term.
10. New folder and Rename edit the name inline in the tree. Enter or leaving the field commits and Esc cancels. An empty, taken or `/`-containing name keeps the field open with a red border.
11. Move to…: a small dialog with a focused filter box over the folder list, written as `work / prod` and starting with "(top level)". The current folder is marked. ↑ and ↓ choose, Enter moves, and Esc cancels. A folder can't move into itself or its subfolders.
12. Delete confirms: "Delete folder `prod`, 1 subfolder and 4 Saved sessions?", then a line for open Tabs, then the unticked "Also delete N saved secrets from keychain / KeePass". Cancel has focus and Delete is red. An empty folder is deleted without asking. A single Saved session gets the same dialog. It also says when other sessions share its secret, which then stays, and that a TPM entry always stays.
13. Smaller parts: the alias shows "Free" in green or its problem in red while typing. "Set secret…" is a popover with a Password / Key passphrase switch (passphrase when a key file is set) and "Save to", keychain first. It creates the entry on Save. "Attach existing…" is a popover with KeePass, TPM and "Same secret as…" tabs over a search box. The Test checklist asks about an unknown host key inside its host key step, and asks for a test-only password in its login step when no secret is attached.

The user saw the menus, the picker and the delete confirms in the prototype and asked for no changes. They may revisit any detail.

Changes "Tab disconnect and reconnect" point 1 and "Creating and editing SSH Saved sessions" points 3 and 15 (see the corrections there). Adds a default option to "How MobaXterm sessions map onto slop-term" and "Saving passwords typed for `ssh <host>`".

Rejected: A, with fields stacked under headings. C, with sections in a side list. B and D as they were. F ("Flags on the form"), B's form with each label showing its flag and the full command under it. G ("Paste a command"), one command box with a table breaking it down. For local shells: the SSH dialog with a kind switch. For defaults: a shared `Host *` block in `slop-term.conf`, which would also reach Hand-written hosts and could override `~/.ssh/config`, depending on where the `Include` line sits.

Prototype: `.scratch/slop-term-v1/prototypes/saved-session-dialog-look.html` on the local branch `prototype/saved-session-dialog-look` (round 1 d28de89, round 2 b9810e6). It is never merged.
