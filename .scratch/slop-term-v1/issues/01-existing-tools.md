# Do existing tools already cover v1?

Type: research
Status: resolved
Blocked by:

## Question

Does any free tool (Tabby, WindTerm, Electerm, WezTerm, Termius free tier, or others found along the way) meet every v1 need on both Windows and macOS?

The v1 needs are: unlimited saved sessions, SSH tabs, a folder tree of sessions, an SFTP browser next to the terminal, local shells, sessions read from and written to the standard `~/.ssh/config`, passwords read from and saved to the OS keychain, and some way to plug in an external password manager (Team Password Manager). For each tool, record which needs it meets, which it misses, its licence, and whether it is still maintained.

## Answer

No. None of Tabby, Electerm, XPipe, WindTerm, WezTerm or Termius free meets every v1 need on Windows and macOS (checked 2026-10-19).
None of them writes Saved sessions back to `~/.ssh/config`. Each imports or reads the file into its own store.
Tabby (MIT, active) comes closest. It has nested folders, an SFTP panel, local shells and keychain storage via keytar. Its SSH config hosts are read-only, and TPM would need a custom Tabby plugin.
XPipe has a custom-command password manager hook (read only) and reads SSH config live, but it has no built-in terminal and docks terminals on Windows only.

Findings: [research/existing-tools.md](../research/existing-tools.md)
