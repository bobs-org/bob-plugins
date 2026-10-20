---
title: "Zoom an image on the cursor line"
description: "Inspect an image on the current line in a read-only full-window viewer."
---

In Source mode, the **Zoom image on cursor line** command opens an image
reference from the cursor's line in a plugin-owned viewer. In Vim normal mode,
`Z` runs that command through the vault's `obsidian_vimrc.md` mapping; the plugin
does not assign `Z` by default.

The command recognizes `![[image.png]]`, `[[image.png]]`,
`![alt](image.png)`, and `[text](image.png)`, including aliases, embeds with
size hints, Markdown titles, and supported image URLs. It picks the reference
containing the cursor, otherwise the next reference on the line, otherwise the
previous one. It never searches beyond the current line. Code spans and fenced
code are skipped. A non-image link under the cursor shows a notice.

The viewer opens fitted without enlarging a small image. `1` shows device-pixel
1:1; `0` restores fit. It supports keyboard and pointer zoom and pan:

| Input | Action |
| --- | --- |
| `Esc`, `q` / `Q`, `Ctrl+[`, `Z` | Close |
| `+`, `=` / `-` | Zoom in / out |
| `0` / `1` | Fit / device-pixel 1:1 |
| `h` / `j` / `k` / `l`, arrow keys | Pan left / down / up / right |
| `Shift` + pan key | Pan three times farther |
| Wheel or trackpad pinch | Zoom toward the pointer |
| Drag | Pan when the image overflows the window |
| Double-click | Toggle fit and 1:1 at the pointer |
| Click outside the image | Close |

The command and viewer never write the vault. Native image click,
double-click, and Zoom-button behavior still own embedded images and Reading
view. Obsidian's `g+`, `g-`, and `:image grow` resize embeds and write `|width`
into the note; this viewer does neither.

Galleries, counted `NZ`, PDFs (`Cmd+Enter` opens reading PDFs in Highlights),
transcluded notes, and mobile are out of scope.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — navigation and keyboard layers.
- [Open reference PDF in Highlights](highlights.md) — open reading PDFs.
