# Terminal look

Type: prototype
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

What do the terminal and the Session colour look like? Build a rough xterm.js page with fake shell output (a prompt, `ls --color`, `git diff`, a `vim`-like screen) and react to it.

Points to settle, from "Keyboard shortcuts, themes and fonts": the dark and the light terminal palette, shown side by side with a few candidates each; which font the app bundles (Cascadia Mono or JetBrains Mono) and its default size, shown at a few sizes; the curated list of named Session colours, each with a dark and a light shade that stay readable; how a Tab with a Session colour shows it (a coloured frame round the terminal, a coloured header bar, a tinted background, a badge or edge in the tree, or a mix), and how that sits next to the tree's teal and amber edges from "Main window layout".

## Answer

Decided with the user on 2026-10-21, from a prototype of palettes, fonts, Session colours and five ways to show a Session colour.

1. Palettes: GitHub Dark and GitHub Light. Colours in order: black, red, green, yellow, blue, magenta, cyan, white.

   | | GitHub Dark | GitHub Light |
   |---|---|---|
   | Background / foreground | `#0d1117` / `#e6edf3` | `#ffffff` / `#1f2328` |
   | Cursor / selection | `#2f81f7` / `#264f78` | `#0969da` / `#b6d7ff` |
   | Normal | `#484f58 #ff7b72 #3fb950 #d29922 #58a6ff #bc8cff #39c5cf #b1bac4` | `#24292f #cf222e #116329 #4d2d00 #0969da #8250df #1b7c83 #6e7781` |
   | Bright | `#6e7681 #ffa198 #56d364 #e3b341 #79c0ff #d2a8ff #56d4dd #ffffff` | `#57606a #a40e26 #1a7f37 #633c01 #218bff #a475f9 #3192aa #8c959f` |

2. Font: JetBrains Mono (SIL OFL), bundled at weights 500 and 700. The terminal uses `fontWeight: 500`, `fontWeightBold: 700`, `letterSpacing: 0.5` and a default size of 12 px. Weight 500 and the extra spacing make the WebGL renderer look like the DOM renderer's ClearType text on Windows.
3. Renderer: `@xterm/addon-webgl` 0.19.0. The DOM renderer in xterm.js 6.0.0 checks an inverse cell's contrast against the wrong text colour (`DomRendererRowFactory.ts`, line 442), so with a contrast floor `reverse` text turns grey. If WebGL fails or loses its context, xterm falls back to the DOM renderer and that bug returns. That is acceptable for a rare fallback.
4. Contrast floor: `minimumContrastRatio` is 7 in dark mode and 4.5 in light mode, fixed in code. In light mode, 7 darkens every colour toward black and they lose saturation.
5. Session colours, each with a dark-theme and a light-theme shade:

   | Name | Dark | Light |
   |---|---|---|
   | Red | `#e5484d` | `#ce2c31` |
   | Orange | `#f76b15` | `#c2490c` |
   | Yellow | `#f5d90a` | `#946800` |
   | Green | `#46a758` | `#2a7e3b` |
   | Blue | `#3e8bff` | `#1f5fd6` |
   | Purple | `#a06cf0` | `#7a3fc6` |
   | Pink | `#e5469f` | `#c0237f` |
   | Grey | `#8b8d98` | `#60646c` |

   Teal and amber are left out, because the tree uses them for the SSH and local shell edges. The MobaXterm import maps red (`255`) to Red.
6. A Tab with a Session colour shows it two ways. The header bar above the terminal is filled with the shade, and its text is black or white, whichever contrasts more. The terminal background is the palette background mixed 10% toward the shade, and the contrast floor applies against that tinted background. `sessionColourTint` in the per-machine `settings.json` sets the mix in percent, default 10. 0 turns the tint off and leaves only the header bar.
7. Tree: a Saved session with a Session colour shows a dot on its own row, with no colour name. Its Tab rows have no dot. How sibling Tab rows tell each other apart belongs to "Session tree look".
8. The SFTP pane uses the terminal's palette. The rest of its look belongs to "SFTP pane look".

Rejected: a frame round the terminal, a stripe on the header, the tint alone, and the tree dot alone. The other palettes tried were One Dark, Tomorrow Night, Campbell and Catppuccin Mocha for dark, and One Light, Tomorrow, Solarized Light and Catppuccin Latte for light. Cascadia Mono was the other font.

Prototype: `.scratch/slop-term-v1/prototypes/terminal-look.html` on the local branch `prototype/terminal-look` (commit 41f56ef). It is never merged.
