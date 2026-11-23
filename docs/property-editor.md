---
title: "Property Editor"
description: "Keyboard reference for viewing and editing a note's YAML properties through Bob."
---

The **Property Editor** opens on any existing Markdown note. It reads the note's
property report from `bob props show` and sends every edit through the guarded
`bob props update` writer. Opening, browsing, and painting rows never writes the
note. The modal groups properties by ownership, keeps duplicate source lines
separate, and preserves Bob's source order within each group. Keyboard movement,
range selection, and filtering follow the visible grouped rows.

## Open the editor

- In Live Preview Vim normal mode, type `=+` (`=` followed by Shift+`=` on a
  US keyboard). The chord works on any Markdown note.
- Run **Edit note properties** from the Command Palette or Command Mode.
- Press Enter on a focused row in a card's `=-` Properties drawer.
- Sibling plugins can call the Bob Ledger Tools plugin method:

  ```js
  const ledgerTools = app.plugins.plugins["bob-ledger-tools"];
  await ledgerTools.openPropertyEditor({
    filePath: "Projects/roadmap.md", // optional; defaults to the active note
    key: "status",                   // optional initial row
    mode: "browse",                  // browse, edit, or add
  });
  ```

An explicit `filePath` wins over the active note. The editor refuses missing
files and non-Markdown targets. `mode: "edit"` opens the requested loose
property's value stage or hands a card property to its owner. A checkbox stays
selected so opening the editor never flips it as a side effect.
`mode: "add"` starts the property-name stage.

## Ownership and rows

Bob's `note_kind`, property kind, role, owner, editor, reason, source lines, and
fingerprint decide what each row can do.

| Group | What it contains | Enter |
| --- | --- | --- |
| Loose | Values with no other Bob owner, including `created` | Edit the value here |
| On the `<Kind>` card | Fields owned by a record, album, bank, or day/period card | Hand off to that card's `==` editor |
| Identity | Note identity such as `type`, `parent`, or an album title | Locked; `y` opens YAML |
| Bob-managed | Derived and generated values | Locked with Bob's writer/reason; `y` opens YAML |

Locked rows stay locked for every action, including delete and type-specific
gestures. Unknown ownership is also locked until Bob reports a role. A card
field on a note without that card's editor explains the route instead of
pretending to edit it here.

## Browse keys

These keys act while browsing the rows, not while typing in a value field.

| Keys | Action |
| --- | --- |
| `j` / `k`, ↑ / ↓, Ctrl+N / Ctrl+P | Move to the next or previous row |
| `g`, Home / `G`, End | Select the first or last row |
| Enter / `l` | Edit a loose value, flip a loose checkbox, or hand off a card field |
| `o` / `O` / Mod+; | Add below, above, or at the end |
| `r` | Rename the focused property |
| Alt+J / Alt+↓, Alt+K / Alt+↑ | Move the focused property down or up in source order |
| Ctrl+D / Mod+Backspace | Delete marked rows together, or the focused row |
| Space | Mark or unmark the focused row for batch actions |
| `V` | Start or stop a visual range; `j` / `k` extend it |
| Shift+↑ / Shift+↓ | Extend a selection range |
| `/` | Open the incremental key and value filter |
| `u` / Ctrl+Z | Undo the latest successful property edit |
| Ctrl+R / Ctrl+Shift+Z | Redo the latest undone edit |
| `y` / Ctrl+E | Open the property's YAML line in Source mode |
| `=` | Open the note's owning `==` card editor when one is available |
| Esc / `q` / Ctrl+[ | Back out one layer, then close |

`q` follows Esc's layer and types only in a text control. Ctrl+[ is Esc's alias
and never types in a field. A stage or add-name draft is canceled one layer at a
time; it is not silently committed.

The marks gutter shows selection separately from the focused row. Space toggles
one row; `V` marks a visual range from the current row, and `j` / `k` extend it.
Pressing `V` again keeps those marks and returns to ordinary movement. Opening
the filter does not clear marks by itself. Changing its query resets marks and
the range anchor, so rows hidden by a filter cannot remain selected for deletion.
Enter or ↓ in the filter returns focus to matching rows; with no matches, the
editor announces the empty result and keeps a stable keyboard target. Esc clears
the filter layer before closing the editor. The All actions menu exposes these
gestures, rename, source-order moves, and batch deletion; reorder actions are
disabled while a filter query is active.

Ctrl+D / Mod+Backspace deletes marked rows together as one undoable update. With
no marks, it deletes the focused visible row. A selection containing a card,
identity, derived, or unresolved property is refused as a whole and names the
locked rows; the editor never partially deletes a mixed selection.

`r` opens an inline name stage seeded with the current key. The current name is
excluded from the local duplicate check; a same-name save is a no-op. Bob still
refuses a destination that would be card-owned, identity, or derived, even when
that name is not on the note, and the typed draft stays for correction. A
successful rename keeps focus and any mark on the renamed key without dropping
other marks.

Alt+J / Alt+K (and Alt+↓ / Alt+↑) move only the focused property relative to its
neighbor in the full source inventory, not the grouped or filtered row list.
Leading comments travel with the entry through `prop.move`. Marks stay for later
batch actions. A protected row cannot itself be moved; a protected neighbor may
still be a position reference. Source-order boundaries, an open stage, a pending
write, and an active filter query are no-ops or refusals; held-key repeats do
not queue extra writes. A successful move announces the new source position,
keeps the row visible, and plays a 120 ms row slide unless reduced motion is
requested.

## Value and add stages

Loose values use a stage suited to Bob's reported kind: multiline Text, Number,
Date, Date & time, ordered List, Tags, or Aliases. A loose checkbox flips
immediately. Tags are stored without `#`; list and alias order is retained.
Date & time accepts `now`, local times such as `9:41pm`, weekdays such as
`fri`, relative dates such as `-3d`, and valid ISO values. Invalid or ambiguous
input remains visible for correction.

As a value changes, the editor waits 250 ms and asks Bob to preview that exact
write. Save applies only the matching successful preview. Open panes are saved
before apply. A stale refusal keeps the draft and rereads the report before a
retry. A lost or timed-out write is treated as unknown; the editor does not
blindly repeat it. Successful writes show `Saved · u undo` and update the
editor, cards, and drawer through a short-lived confirmed overlay.

The add-name stage suggests property names from the vault with their known
type and usage count. Tab or Enter accepts the highlighted suggestion and its
type. Shift+Enter keeps the typed name as a text property. New names are
checked locally and again by Bob for duplicates and valid YAML syntax. The
name and value are written together; canceling either stage writes nothing.

Undo and redo history is session-only, kept per normalized note path, and
bounded to 20 writes in each direction. Closing and reopening the editor keeps
that history for the session. A successful new edit clears redo.

## YAML escape and recovery

Press `y` / Ctrl+E on a property to jump to its source line in YAML. **Done**
returns to the prior view and reopens the editor on the same property. Maps,
opaque values, invalid or unclosed frontmatter, and duplicate keys use this
escape for repair; Bob never authorizes a write against a damaged or ambiguous
frontmatter mapping.

When Bob is too old to report `props_v1`, cached rows remain visible and edits
are disabled with **Update bob to edit properties here — y opens YAML**. An
empty note says **No properties yet — o adds the first**. Invalid YAML shows
Bob's diagnostic and source-line target. Once a capable Bob report arrives,
the current report—not cached metadata—authorizes mutations.

The editor supports viewing, value edits, add, rename, source-order reorder,
delete, undo/redo, ownership hand-off, YAML return, multi-select, filtering, and
batch deletion. Copy/paste, property-kind changes, and the inline YAML value
stage are the remaining native-Properties parity work.
