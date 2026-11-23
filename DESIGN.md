---
name: slop-term
description: A compact, grey desktop shell where only Session colours and state carry colour.
colors:
  canvas: '#ffffff'
  canvas-dark: '#0d1117'
  canvas-subtle: '#f6f8fa'
  canvas-subtle-dark: '#161b22'
  overlay: '#ffffff'
  overlay-dark: '#161b22'
  fg: '#1f2328'
  fg-dark: '#e6edf3'
  fg-muted: '#656d76'
  fg-muted-dark: '#7d8590'
  faint: '#818b98'
  faint-dark: '#6e7681'
  border: '#d0d7de'
  border-dark: '#30363d'
  button: '#f6f8fa'
  button-dark: '#21262d'
  button-hover: '#f3f4f6'
  button-hover-dark: '#30363d'
  teal: '#1b7c83'
  teal-dark: '#39c5cf'
  amber: '#9a6700'
  amber-dark: '#d29922'
  danger: '#d1242f'
  danger-dark: '#f85149'
  success: '#1a7f37'
  success-dark: '#3fb950'
  accent: '#1f883d'
  accent-dark: '#238636'
  session-red: '#ce2c31'
  session-red-dark: '#e5484d'
  session-orange: '#c2490c'
  session-orange-dark: '#f76b15'
  session-yellow: '#946800'
  session-yellow-dark: '#f5d90a'
  session-green: '#2a7e3b'
  session-green-dark: '#46a758'
  session-blue: '#1f5fd6'
  session-blue-dark: '#3e8bff'
  session-purple: '#7a3fc6'
  session-purple-dark: '#a06cf0'
  session-pink: '#c0237f'
  session-pink-dark: '#e5469f'
  session-grey: '#60646c'
  session-grey-dark: '#8b8d98'
typography:
  body:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 400
  caption:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 400
  title:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 600
  dialog-title:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 600
  group-label:
    fontFamily: 'system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 600
  code:
    fontFamily: "'JetBrains Mono', monospace"
    fontSize: '12px'
    fontWeight: 400
rounded:
  sm: '4px'
  md: '6px'
  lg: '8px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button:
    backgroundColor: '{colors.button}'
    textColor: '{colors.fg}'
    rounded: '{rounded.md}'
    padding: '3px 12px'
  button-hover:
    backgroundColor: '{colors.button-hover}'
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '#ffffff'
    rounded: '{rounded.md}'
    padding: '3px 12px'
  button-danger:
    backgroundColor: '{colors.danger}'
    textColor: '#ffffff'
    rounded: '{rounded.md}'
    padding: '3px 12px'
  input:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.fg}'
    rounded: '{rounded.md}'
    padding: '3px 6px'
  tree-row:
    height: '22px'
    padding: '0 8px'
  dialog:
    backgroundColor: '{colors.overlay}'
    rounded: '{rounded.lg}'
    padding: '16px 20px'
  menu:
    backgroundColor: '{colors.overlay}'
    rounded: '{rounded.md}'
    padding: '4px 0'
---

# Design System: slop-term

## Overview

**Creative North Star: "The Colour-Coded Switchboard"**

slop-term is a panel for many hosts at once. The chrome is grey and stays still. Colour is how you tell hosts apart: each Session can carry one of eight Session colours, and that colour tints the terminal, the header bar and the SFTP pane. Everything else is neutral, so a coloured Tab is the loudest thing on screen.

The look is compact. Rows are 22px, text is 13px, and borders are 1px. The user lives in this window all day, so density and speed come before decoration. The palette is GitHub Primer, in a light and a dark mode that follow the operating system or a setting.

Confirmed rejection: the app must not feel like a website. No large rounded cards, big padding or web-style toasts.

**Key Characteristics:**

- Grey chrome, with colour reserved for Session colours and for state (error, warning, success).
- Dense rows (22px) and small text (11 to 13px).
- Flat at rest. Shadows only on layers that float above the window.
- Light and dark modes use one token set, switched by `light-dark()`.
- No Tab strip. Open Tabs are listed in the tree under their Saved session.

## Colors

A Primer-derived neutral palette with one green action colour, two host-type hues, and eight Session colours. Each token has a light value and a `-dark` value in the frontmatter.

### Primary

- **Action Green** (`accent`): the primary button, the drop-target outline, transfer progress and text links in transfers. It is the only filled colour in the chrome.

### Secondary

- **SSH Teal** (`teal`): the left edge mark of SSH sessions, `link` buttons in dialogs and the selected popover tab underline.
- **Local Amber** (`amber`): the left edge mark of Local shell sessions. Warnings use the same hue (`warn` in CSS).

### Tertiary

- **Session colours** (`session-red` to `session-grey`): eight shades picked per Saved session. Each has a darker light-mode shade and a brighter dark-mode shade. The header bar uses the shade with black or white text, whichever contrasts more. The terminal background is the canvas mixed toward the shade by the user's tint setting.

### Neutral

- **Canvas** (`canvas`): the terminal, dialogs' inputs and the base window.
- **Canvas Subtle** (`canvas-subtle`): the session tree, the header bar, table headers and the checklist box.
- **Overlay** (`overlay`): menus, dialogs, popovers and the find bar. Same as canvas in light mode, one step lighter in dark mode.
- **Ink** (`fg`), **Muted Ink** (`fg-muted`), **Faint** (`faint`): primary text, secondary text and disabled or decorative text.
- **Hairline** (`border`): every divider and control outline.
- **Button Grey** (`button`, `button-hover`): button fill and its hover.
- **Danger** (`danger`), **Success** (`success`): errors and destructive buttons; passed checks and free-slot notes.

### Named Rules

**The Session Colour Rule.** Session colours are the only decorative colour. Chrome never uses a hue for style alone.

**The State Colour Rule.** Red means error or destructive, amber means warning, green means success or the main action. Do not reuse them as decoration.

**The Contrast Rule.** Text over a Session colour is black or white, whichever contrasts more. Dimming is not applied there, so the contrast floor holds.

## Typography

**Interface Font:** system-ui (with sans-serif)
**Code and Path Font:** JetBrains Mono (with monospace)

**Character:** The interface uses the operating system font so it fits each desktop. Monospace marks anything the user may copy or type: commands, paths, host key fingerprints.

### Hierarchy

- **Title** (600, 16px): the heading of a login or host key question that covers a terminal.
- **Dialog title** (600, 15px): the heading of a dialog.
- **Body** (400, 13px, 1.5 for prose): rows, labels, buttons and form fields. Prose blocks cap at 640px wide.
- **Small** (400, 12px): the SFTP pane, the find bar, the profiling panel and dense dialog text.
- **Caption** (400/600, 11px): group labels in the tree (uppercase), transfer status, keycaps (10px) and "not available" notes.
- **Code** (400, 12px): commands, paths and fingerprints. The terminal itself uses JetBrains Mono at weight 500 with 0.5px letter spacing.

### Named Rules

**The Tabular Rule.** Sizes, times and counts use `font-variant-numeric: tabular-nums` so columns line up.

## Layout

One window with three columns: a 260px session tree, a flexible terminal and a 400px SFTP pane (30px when collapsed). A 28px header bar spans the terminal and the SFTP pane. Rows are 22px high and indent 14px per tree level.

Spacing steps are 4, 8, 12, 16 and 24px. Dialogs have fixed widths by purpose (420px confirm, 460px local shell, 780px session, 1100px import) and shrink to the window minus 32px. A host key or login question covers the terminal area instead of opening a dialog.

## Elevation & Depth

The system is flat. Panels are separated by 1px borders and by a one-step grey change (`canvas` against `canvas-subtle`). Shadows appear only on layers that float above the window.

### Shadow Vocabulary

- **Floating layer** (`box-shadow: 0 8px 24px var(--shadow)`): menus, dialogs, popovers, the find bar, paste question, SFTP hints and confirm card.
- **Backdrop** (`rgb(1 4 9 / 40%)`): behind dialogs, positioned 10vh from the top.

### Named Rules

**The Flat-At-Rest Rule.** Nothing carries a shadow until it floats above other content.

## Shapes

Corners are lightly rounded: 6px for buttons, inputs, menus and cards, 8px for dialogs, 4px for small controls such as icon buttons and keycaps (3px). Borders are always 1px, except the 2px dashed drop-zone outline and the 2px selected-tab underline. The colour edge mark on a tree row is a 3px by 14px bar. Colour dots are 8px circles.

## Components

### Buttons

- **Shape:** 6px corners, 1px border (`button-border`, a translucent edge).
- **Default:** grey fill (`button`), text inherits ink, padding 3px 12px.
- **Hover:** fill shifts to `button-hover`. No lift or shadow.
- **Primary:** green fill, white text, hover brightens by 10%. One per dialog.
- **Danger:** red fill, white text, for destructive confirmations only.
- **Link:** no fill or border, teal text.
- **Disabled:** 50% opacity.

### Inputs / Fields

- **Style:** canvas fill, 1px `border`, 6px corners, 3px 6px padding. Placeholder uses `faint`.
- **Error:** the border turns `danger` (`aria-invalid`).
- **Focus:** tables show a 1px accent outline. Other fields rely on the browser focus ring.

### Session tree

- A 22px row: chevron or colour mark, name, optional detail in muted ink. Hover is a faint grey wash (`row-hover`), the current row a stronger one (`row-selected`).
- SSH sessions show a teal edge mark, Local shells an amber one.
- The `+` button and a numbered keycap sit at the right end of the row and show on hover.
- Unavailable rows drop to 45% opacity. A disconnected Tab dims to 60% except its red broken-link icon.

### Menus and popovers

- Overlay fill, 6px corners, floating shadow. Menu rows are 22px with a keyboard hint pushed to the right edge in faint ink. Danger items use red text.

### Dialogs

- Overlay fill, 8px corners, 16px 20px padding. Field forms use a grid with an 80px label column in muted ink. Footer buttons sit right-aligned with 8px gaps. A test button may sit alone on the left.

### SFTP pane

- Toolbar of 24px by 22px icon buttons, an editable path field in monospace, and a sortable file table with sticky headers. Its background follows the terminal palette so a Session colour tints both.
- Banners tint a danger or warning colour at 12 to 14% over the pane. Dragging files shows a dashed accent drop zone.

## Do's and Don'ts

### Do:

- **Do** keep chrome neutral and let the Session colour be the loudest colour in the window.
- **Do** use 22px rows, 13px text and 1px borders for new list and form screens.
- **Do** take every colour from the tokens above, using `var(--name)` so light and dark both work.
- **Do** put one green primary button in a dialog and make danger actions red only when destructive.
- **Do** show hover-only controls (like the row `+`) on keyboard focus as well.
- **Do** use monospace for commands, paths and fingerprints.

### Don't:

- **Don't** make a screen feel like a website: no large rounded cards, oversized padding, hero blocks or web-style toasts.
- **Don't** add a Tab strip. Open Tabs live in the tree.
- **Don't** use a hue for decoration. Colour means a Session, or a state.
- **Don't** put a shadow on anything that does not float above the window.
- **Don't** dim or tint text placed on a Session colour; use plain black or white.
