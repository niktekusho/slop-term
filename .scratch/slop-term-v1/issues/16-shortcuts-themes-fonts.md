# Keyboard shortcuts, themes and fonts

Type: grilling
Status: resolved
Assignee: niktekusho
Blocked by:

## Question

What keyboard shortcuts, themes and fonts does v1 have?

Points to settle: how to move between Tabs from the keyboard, given there is no Tab strip ("Main window layout"); the shortcuts for new Tab, close Tab, Ctrl+K, collapsing the SFTP pane and the profiling panel (Ctrl+Shift+M in the prototype), and how they avoid keys the shell needs (Ctrl+C, Ctrl+W, Ctrl+K in bash); whether shortcuts can be changed; which terminal colour themes ship and whether the app follows the OS light or dark mode; the default font and size and where they're set; where these per-user settings live and whether they sync.

## Answer

Decided with the user on 2026-10-21. The user types on an Italian layout on both Windows and macOS.

1. Plain Ctrl+letter always goes to the shell. App shortcuts use Ctrl+Shift on Windows and Cmd on macOS. macOS keys follow iTerm2's defaults where slop-term has the same action. Cmd+D (an iTerm2 split) and Cmd+Shift+M (an iTerm2 mark) are reused, because slop-term has no splits or marks. The keys are fixed in code in v1.

   | Action | Windows | macOS |
   |---|---|---|
   | Open a Saved session by name (focus the tree filter) | Ctrl+Shift+O | Cmd+Shift+O |
   | New Tab (default local shell, unsaved) | Ctrl+Shift+T | Cmd+T |
   | Duplicate active Tab (another Tab of its Saved session) | Ctrl+Shift+D | Cmd+D |
   | Close active Tab | Ctrl+Shift+W | Cmd+W |
   | Next / previous Tab, in tree order | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab, Cmd+Option+Right / Left |
   | Go to the Nth Tab, in tree order | Ctrl+Shift+1–9 | Cmd+1–9 |
   | Collapse or open the SFTP pane | Ctrl+Shift+B | Cmd+B |
   | Open or close the profiling panel | Ctrl+Shift+M | Cmd+Shift+M |
   | Find in scrollback (`@xterm/addon-search`) | Ctrl+Shift+F | Cmd+F |
   | Copy / paste | Ctrl+Shift+C / Ctrl+Shift+V | Cmd+C / Cmd+V |
   | Zoom in / out / reset | Ctrl++ or Ctrl+=, Ctrl+-, Ctrl+0, Ctrl+wheel | Cmd++ or Cmd+=, Cmd+-, Cmd+0, Cmd+wheel |
   | Open settings file | Ctrl+, | Cmd+, |

2. Tab-number shortcuts read the physical digit key, because Shift+1 types `!` on the Italian layout. Zoom in accepts both `+` and `=`, because `=` is Shift+0 on the Italian layout. Cmd+Shift+[ and ] are left out, because `[` and `]` need Option on a Mac Italian keyboard.
3. Selecting text copies it and right-click pastes, as in MobaXterm. There is no smart Ctrl+C in v1.
4. Pasting text that contains a line break always asks "Paste 3 lines? Each line may run as a command." with Paste and Cancel. It asks for a single line that ends in a line break too, and asks even when the shell has bracketed paste on, because the app can't tell what a remote program does with the text. No setting turns it off.
5. Closing a Tab asks only when that Tab has queued uploads or a file open for editor sync.
6. The app UI and the terminal follow the OS light or dark mode. A `settings.json` value can force `light` or `dark`. There is one dark and one light terminal palette, with no picker and no theme import. "Terminal look" picks both palettes.
7. The app bundles one monospace font and uses it by default, so it doesn't depend on system fonts. `settings.json` can name a system font instead. "Terminal look" picks the font (Cascadia Mono or JetBrains Mono, both SIL OFL) and the default size. Zoom applies to the whole window and saves the new size.
8. Theme mode, font family and font size live in the per-machine `settings.json` in the app's data folder and don't sync. Ctrl+, / Cmd+, opens the file in the configured editor, and the app applies changes when the file is saved. v1 has no settings dialog.
9. Session colour: a Saved session (SSH or local shell) has an optional colour from a curated list of named colours, each with a dark-theme and a light-theme shade. It is stored on the Saved session in the Sidecar file and syncs. Folders have no colour. It is a visual tag only and changes no behaviour. "Terminal look" picks the list and how the colour shows.
10. The MobaXterm import maps each session's tab colour (block 6, a Windows colour number) to the nearest named colour and shows it in the preview, where the user can change it. `-1` means no colour. The user's MobaXterm file has three SSH sessions set to `255` (red), spread across two folders that also hold uncoloured sessions.
11. While a detected `ssh` child runs in a local shell Tab ("SFTP pane for `ssh <host>` typed in a local shell Tab"), the Tab shows the Session colour of the Saved session that the alias matches.

Out of v1: smart Ctrl+C (copy when text is selected, otherwise send Ctrl+C). The user wants it as an option after v1.

Addition (2026-10-21, from "SFTP pane look"): while the SFTP pane's file list has focus, Enter opens, F2 renames, Delete or Cmd+Backspace deletes, Backspace goes up a folder, Ctrl+A or Cmd+A selects all, and F5 or Cmd+R refreshes. Point 1 holds, because these keys never reach the pane while the terminal has focus.
