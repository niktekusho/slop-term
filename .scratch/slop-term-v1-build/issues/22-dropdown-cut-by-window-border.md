# 22 — Dropdown gets cut by window border (bug)

**What is wrong:** The menu under the "New" button opens past the left edge of the window and the window border clips it. The first letters of "SSH session", "Local shell session" and "Folder" are not visible.

**Screenshot:** ![New dropdown clipped at the left window border](../screenshots/22-dropdown-cut-by-window-border.png)

**Blocked by:** none

**Status:** open

- [ ] The "New" dropdown stays fully inside the window at the narrow sidebar width shown in the screenshot.
- [ ] A renderer test opens the dropdown and checks that it is not clipped (or that it is aligned to the button's right edge).
