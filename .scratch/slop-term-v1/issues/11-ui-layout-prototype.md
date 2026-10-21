# Main window layout

Type: prototype
Status: resolved
Assignee: niktekusho
Blocked by: 09

## Question

How does the main window lay out the Saved-session tree, the Tabs and the SFTP pane? Build a rough React + xterm.js mock-up (fake data, no SSH) and react to it.

Points to settle: where the tree sits and whether it can be hidden; whether the SFTP pane sits beside or below the terminal, and whether each Tab has its own; how local shell Tabs and SSH Tabs look different; where the hidden profiling view from "Choose the stack" opens.

## Answer

Decided with the user on 2026-10-20, from a prototype of three layouts. The user picked layout C ("Tabs in the tree").

1. Tree: a fixed column on the left, with a filter box at the top. Ctrl+K in the filter box opens a Saved session by name. The prototype has no way to hide the tree, and the user didn't ask for one.
2. Tabs: there is no Tab strip. Each open Tab is listed in the tree as a child of the Saved session it came from, so a session with two Tabs shows two children. Clicking a child switches to that Tab. A `+` on the session, or a double-click, opens another Tab.
3. Header: a thin bar above the terminal shows the active Tab's session name and `user@host`, or "local shell".
4. SFTP pane: to the right of the terminal, showing the active Tab's remote files. One button collapses it to a thin strip, and clicking the strip opens it again. The open or collapsed state applies to the whole window, not to each Tab. A local shell Tab with no remote host shows a hint to type `ssh <host>`.
5. Local and SSH Tabs: each session in the tree has a coloured edge, teal for SSH and amber for a local shell. The prototype lists local shells separately at the bottom of the tree. "Local shell sessions" decides where they really go.
6. Profiling view: a panel under the terminal, opened and closed by a keyboard shortcut (Ctrl+Shift+M in the prototype). The final shortcut belongs to "Keyboard shortcuts, themes and fonts".

Rejected: a MobaXterm-style sidebar that switches between the tree and the SFTP pane (A), and a slide-over tree drawer with an SFTP pane below each terminal (B).

Prototype: `.scratch/slop-term-v1/prototypes/main-window-layout.html` on the local branch `prototype/main-window-layout` (commit d0c0ad1). It is never merged.

Correction (2026-10-21, from "SFTP pane look"): point 3's header bar spans the full window width, over the terminal and the SFTP pane.
