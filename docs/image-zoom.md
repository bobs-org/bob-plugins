---
title: "Zoom an image on the cursor line"
description: "Inspect images and copy or restore their recorded original paths."
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
code are skipped. When the line has no image candidates, a non-image link
under the cursor shows a notice; otherwise the image pick rule still applies.

The viewer opens fitted without enlarging a small image. `1` shows device-pixel
1:1; `0` restores fit. It supports keyboard and pointer zoom and pan:

| Input | Action |
| --- | --- |
| `Esc`, `q` / `Q`, `Ctrl+[`, `Z` | Close |
| `+`, `=` / `-` | Zoom in / out |
| `0` / `1` | Fit / device-pixel 1:1 |
| `h` / `j` / `k` / `l`, arrow keys | Pan left / down / up / right |
| `Shift` + pan key | Pan three times farther |
| `y` | Copy the recorded original path, or the vault file path / URL when none is recorded |
| `r` | Restore the picked vault image link to its present recorded original path |
| Wheel or trackpad pinch | Zoom toward the pointer |
| Drag | Pan when the image overflows the window |
| Double-click | Toggle fit and 1:1 at the pointer |
| Click outside the image | Close |

The viewer shows a recorded origin below the title, with a state suffix when the
source is missing, changed, or recorded on another host. `y` copies the journal's
display path (for example, `~/tmp/photo.png`) even when the source is missing or
changed. Without a recorded origin, it copies the vault file's absolute path; for
web images it copies the URL. Copying shows a pill in the viewer.

`r` is available when the original source is present. It replaces only the picked
image link with the recorded display path in one undoable editor change, closes
the viewer, and confirms that the vault copy remains. A changed, missing, or
elsewhere origin shows a refusal pill; web images have no restore action. If bob can't
be reached or the origin lookup fails, `r` reports the lookup failure instead of saying
no original path was recorded. Native image click, double-click, and Zoom-button behavior
still own embedded images
and Reading view. Obsidian's `g+`, `g-`, and `:image grow` resize embeds and write
`|width` into the note; this viewer does neither.

## Import an image path

`Z` on a bullet holding only an image path imports the file through
`bob attachments import` — the same copy rules `%c` uses — rewrites the bullet
to bob's embed (`![[img/name.png|400]]`) in one undoable edit, and opens the
viewer on the new image with the pill `Imported to img/name.png · r to undo`
(`Linked existing …` when the file was already in the vault).

A path-only bullet is a list item (or a plain line) whose whole content is one
path starting with `~/`, `/`, or `file://` and ending in an image extension;
wrappers (`'…'`, `"…"`, `<…>`), spaces, and uppercase extensions are fine.
Task checkboxes, prose around the path, fenced code, and non-image extensions
(which raise `Not an image: <path>`) are refused, and a line that already holds
an image reference opens that reference instead. Pressing `r` in the import
viewer restores the bullet to the recorded display path, so `Z`/`r`
round-trips; the vault copy is kept either way.

Galleries, counted `NZ`, PDFs (`Cmd+Enter` opens reading PDFs in Highlights),
transcluded notes, and mobile are out of scope.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — navigation and keyboard layers.
- [Open reference PDF in Highlights](highlights.md) — open reading PDFs.
