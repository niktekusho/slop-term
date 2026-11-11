# Database GUI manager like DBeaver

Type: grilling
Status: open
Assignee: niktekusho
Blocked by: none

## Question

Should slop-term grow a database GUI manager in the style of DBeaver, and if so, how big is the first version and how does it fit the app's terminal-first design?

Points to settle: which databases come first (PostgreSQL, MySQL, SQLite, SQL Server, MongoDB); whether it is v2 work or a separate app that shares slop-term's Saved sessions and Credential providers; what a database connection is in the tree (a new Saved session type, with its own dialog and colour); how it reuses the SSH tunnel and the Credential providers (keychain, TPM, KeePass) so a password is never stored twice; what the first version does (browse schema, run a query, edit rows, export results) and what it skips (ER diagrams, data compare, migrations); where it shows up in the window (a Tab, a pane beside the terminal, or a result grid under a SQL editor); which editor and grid components it uses; how it handles production connections (read-only by default, coloured, confirm before a write); and whether this still fits the "memory first" reason for choosing Electron, since a result grid with large row counts costs memory.

Check "Build or adopt?" first: DBeaver and similar tools already exist, so the question is also what slop-term adds that they don't.
