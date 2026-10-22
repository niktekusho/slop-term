# 14 — Session colours

**What to build:** The user gives a Saved session a Session colour, for example red for production hosts. Its Tabs fill the header bar with the colour and tint the terminal and SFTP pane backgrounds, and the tree shows a dot on the session's row.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 03 — Settings and terminal look; 10 — SSH Saved session dialog; 13 — Local shell Saved sessions

**Status:** ready-for-agent

- [ ] Eight named colours, each with the dark and light shades from the spec: Red, Orange, Yellow, Green, Blue, Purple, Pink, Grey. Teal and amber are not offered.
- [ ] Both dialogs have a Colour row; the colour is stored on the Saved session in the Sidecar file and syncs. Folders have no colour.
- [ ] A coloured Tab fills the full-width header bar with the shade, with black or white text by contrast.
- [ ] The terminal and SFTP pane backgrounds mix `sessionColourTint` percent toward the shade (setting default 10, 0 turns it off); the contrast floor applies against the tinted background.
- [ ] The Saved session's tree row shows a colour dot; Tab rows have none.
- [ ] A Session colour changes no behaviour.
- [ ] UI tests: header text contrast for each colour in both modes, tint off at 0, dot only on the session row.
