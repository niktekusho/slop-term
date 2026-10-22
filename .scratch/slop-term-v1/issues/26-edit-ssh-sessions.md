# Creating and editing SSH Saved sessions

Type: grilling
Status: open
Blocked by:

## Question

How does the user create, edit and organise SSH Saved sessions in the app? Earlier tickets decided where they are stored ("What goes in SSH config vs the Sidecar file"), how they arrive from MobaXterm and from a typed `ssh` ("Saving passwords typed for `ssh <host>`"), and how the tree looks ("Session tree look"), but not the editing itself.

Points to settle: which fields the form shows (alias, `HostName`, `Port`, `User`, `IdentityFile`, folder, Credential reference, Session colour), and what it does with other OpenSSH options already in the host's block; where New, Edit, Duplicate and Delete live; whether folders nest, and how the user creates, renames, deletes and moves between them (drag and drop in the tree or a picker); whether the alias rules from "How MobaXterm sessions map onto slop-term" apply to every new alias; what editing a Hand-written host offers, given it is read-only until moved in; what happens to open Tabs when their Saved session changes.
