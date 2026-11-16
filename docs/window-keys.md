---
title: "Window keys (Ctrl+W)"
description: "Focus, move across, and create Obsidian splits from the keyboard."
---

`Ctrl+W` arms the **window prefix** for the main area's splits (tab groups):
press it, then one key. `H`/`L` move a tab, not a Vim window — the unit is
the tab, as in VS Code's "move editor into right group".

| Keys after `Ctrl+W` | Action | Behavior |
| --- | --- | --- |
| `h` / `←` · `l` / `→` | Focus split left / right | Geometric nearest neighbour; **never wraps**. At an edge it is a visible no-op (edge bump plus a dimmed row). |
| `w` · a second `Ctrl+W` | Focus next split | Reading order (left→right, top→bottom), **wraps**. With two splits this toggles. |
| `H` · `L` | Move the current tab left / right | **Join** the adjacent split; or **create** a split at that edge when other tabs stay behind; a split that the move empties **collapses**. The lone tab of the only split stays put. Focus follows the tab. |
| `v` | Split right, same note | Opens the same note in a new split on the right, like Vim's `<C-w>v`. |
| `Esc` · `Ctrl+[` · `q` | Cancel | Layout unchanged. |

Held Ctrl is accepted on every suffix, so `Ctrl+W Ctrl+L` equals `Ctrl+W l`.
No key in this family ever closes a note.

## Decision pictures

`[A B*]` is one split with tabs `A` and `B` (`*` is the focused tab);
`|` separates splits; `'` marks the selected tab of an unfocused split;
`!` marks a pinned tab.

```text
Create right:         [ A  B* ]                   L → [ A' ] | [ B* ]
Create left:          [ A  B* ]                   H → [ B* ] | [ A' ]
Join right:           [ A  B* ] | [ C'  D ]       L → [ A' ] | [ C  B*  D ]
Join left:            [ A'  B ] | [ C*  D ]       H → [ A  C*  B ] | [ D' ]
Last tab out:         [ A* ] | [ C  B' ]          L → [ C  B  A* ]              (left split closes)
Middle out:           [ A' ] | [ B* ] | [ C' ]    H → [ A  B* ] | [ C' ]         (middle split closes)
Only tab:             [ A* ]                      H or L → unchanged; "only tab · v splits"
Edge, sole tab:       [ A* ] | [ B' ]             H → unchanged; "already leftmost"
Pinned stays pinned:  [ P!*  B ] | [ Q!  C' ]     L → [ B' ] | [ Q!  P!*  C ]
Unpinned after pins:  [ A*  B ] | [ Q!'  R!  C ]  L → [ B' ] | [ Q!  R!  A*  C ]
Focus:                [ A* ] | [ B' ] | [ C' ]    l → B focused; h → unchanged + left-edge bump; w twice → C focused
Split:                [ A* ]                      v → [ A' ] | [ A* ]           (same note, new split focused)
```

A moved unpinned tab lands after the destination's selected tab (before any
trailing pins); a moved pinned tab keeps its pin at the pins' end. A source
split that survives a move-out shows its most recently used remaining tab.
Widths are never auto-equalized. Moves are lossless: the same tab object is
reparented, so undo history, cursor, selection, scroll, folds, pin, view
mode, and back/forward history all survive.

## Where Ctrl+W arms

`Ctrl+W` (physical Ctrl, never `Mod`; no Shift, Alt, or Meta; not a repeat)
arms the prefix only in the main window, only when the active tab lives in
the main area, and only when one of these holds:

- focus is in that tab's Markdown CodeMirror editor with Vim mode `normal`
  or `visual`, no Vim operator or count pending, and an empty key buffer; or
- focus is non-editable (not an input, textarea, or contenteditable) and not
  inside a modal, prompt, menu, suggestion popup, hover popover, Command
  Mode sheet, or Bob card — reading view, PDF, image, canvas background,
  graph, and empty tabs all arm.

Everything else passes through untouched: insert or replace mode (`Ctrl+W`
still deletes a word), the `:` line, search fields, sidebars, popout
windows, and any `Ctrl+W` an Obsidian hotkey already handled.

While armed, a calm theme-native hint shows the ring around the focused
split at once and, after a short pause, a card with a minimap of the splits
and one row per key. `Esc`, `Ctrl+[`, `q`, a click outside the card, window
blur, or a layout change the prefix did not cause all cancel.

## Linux behavior

On Linux, Obsidian binds `Ctrl+W` to Close tab by default, so that tab closes
before the prefix sees the key and the prefix stays idle. To get the prefix
on Linux, rebind vault Close tab away from `Ctrl+W` (for example to
`Super+W`); on macOS nothing needs to change, because `Ctrl+W` is unbound
there.

## Palette commands

Every verb is also a palette command with no default hotkey, so each can be
remapped or reached without the prefix:

- Focus split left / Focus split right / Focus next split
- Move tab to left split / Move tab to right split
- Show window keys (opens the prefix with the card shown at once)

The `v` verb has no Bob command, because Obsidian's native Split right
already covers it. A blocked command reports its reason as a notice.

## Scope

`j`/`k`/`J`/`K` and horizontal splits, `p` (previous split), `=` and
`<`/`>` resizing, counts, `x` exchange, close-or-merge verbs, numbered
splits, sidebars, popout windows, and hover editors are out of scope for v1.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — navigation and keyboard layers.
