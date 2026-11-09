# 14 — Session colours

**What to build:** The user gives a Saved session a Session colour, for example red for production hosts. Its Tabs fill the header bar with the colour and tint the terminal and SFTP pane backgrounds, and the tree shows a dot on the session's row.

**Spec:** [Spec: slop-term v1](../../slop-term-v1/spec.md)

**Blocked by:** 03 — Settings and terminal look; 10 — SSH Saved session dialog; 13 — Local shell Saved sessions

**Status:** done

- [ ] Eight named colours, each with the dark and light shades from the spec: Red, Orange, Yellow, Green, Blue, Purple, Pink, Grey. Teal and amber are not offered.
- [ ] Both dialogs have a Colour row; the colour is stored on the Saved session in the Sidecar file and syncs. Folders have no colour.
- [ ] A coloured Tab fills the full-width header bar with the shade, with black or white text by contrast.
- [ ] The terminal and SFTP pane backgrounds mix `sessionColourTint` percent toward the shade (setting default 10, 0 turns it off); the contrast floor applies against the tinted background.
- [ ] The Saved session's tree row shows a colour dot; Tab rows have none.
- [ ] A Session colour changes no behaviour.
- [ ] UI tests: header text contrast for each colour in both modes, tint off at 0, dot only on the session row.

## Test coverage

Back end: `src/backend/session-colours.test.ts` and `src/backend/settings.test.ts`. UI: `src/renderer/SessionColours.test.tsx`.

- Eight named colours with the spec's shades, no teal or amber: UI "fills the header with each shade in dark mode…" and "…in light mode…" check every shade against the spec's table. The back end "refuses to save a colour the app does not offer" (`teal`) and "ignores a colour the app does not offer in a hand-edited file".
- Colour row in both dialogs, stored on the Saved session in the Sidecar file: back end "stores an SSH session colour in the Sidecar file and returns it in the tree and the session", "removes the colour when an edit clears it", "stores a Local shell session colour and returns it in the tree and the session", "keeps the colour when a session moves to another folder". UI "saves the colour picked in the SSH dialog and shows the stored one in an edit", "saves the colour picked in the Local shell dialog, and None clears it". Syncing needs no code: the colour lives in `slop-term.json`, which syncs. Folders have no colour: neither the folder list nor the folder rows carry one, so there is nothing to test.
- Header bar with black or white text by contrast: the two header tests above, which compute both WCAG ratios and expect the picked text to win; "keeps the plain header for a Tab without a colour".
- Tint: "mixes the terminal background sessionColourTint percent toward the shade, and not at all at 0"; settings "reads a Session colour tint from 0 to 100 and falls back to 10 for anything else". The contrast floor against the tinted background has no test: jsdom has no renderer to measure it. The tint replaces the xterm theme's `background`. In `node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs` (0.19.0), the contrast check gets the cell background from `_resolveBackgroundRgba`, which falls back to the theme background (`grep -o 'minimumContrastRatio.\{0,160\}'` on that file shows the call).
- The SFTP pane tint and the header over the pane wait for ticket 17, which builds the pane. Ticket 17 now lists it as an acceptance item. The header already spans the whole area right of the tree.
- Dot on the session row only: "shows a dot on the Saved session row only, not on its Tab rows or on uncoloured sessions".
- No behaviour change: the colour is read only by `look.ts`, the header, the tree dot and the dialogs. No test.
