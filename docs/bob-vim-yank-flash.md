---
title: "Bob Vim Yank Flash"
description: "See a brief highlight on exactly the text a Vim yank copies."
---

Bob Vim Yank Flash briefly highlights the exact text a Vim yank copies in Obsidian.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Vim Yank Flash |
| ID | `bob-vim-yank-flash` |
| Version | 0.1.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Briefly highlight the exact text a Vim yank copies in Obsidian's Vim mode. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

This plugin registers no command palette commands.
<!-- END GENERATED: commands -->

## What flashes

Only the register writes made by the Vim **yank operator** flash, and only
when the live selection exactly equals the yanked text. The flash lasts
200 ms; a new yank replaces it immediately.

| Keys | What highlights |
| --- | --- |
| `yy`, `3yy` | Whole lines, blank lines included |
| `Y` | The whole current line in stock Vim. Bob's vault vimrc maps normal-mode `Y` to `y$`, so there it flashes like `y$` |
| `yw`, `y$`, `yiw`, `yi(`, `yap`, `yb`, `yG`, `ygg` | The exact charwise range the motion covers |
| `v…y`, `V…y`, `<C-v>…y`, visual `Y` | The exact visual selection, one mark per block row |
| `"ayy`, `"Ayy` | The lines, like an uncounted `yy` |
| Counts (`3yw`) and dot-repeat of a yank | The newly yanked range, flashing again |

## What never flashes

- The black-hole register (`"_yy`): the yank still works, but nothing draws.
- Any non-yank operator: `d`, `c`, `x`, `s`, `D`, `C`.
- Ex `:yank`, Cmd/Ctrl+C, Bob Navigation Hotkeys' `yank-*` path commands,
  Reading view, and Bob Vim Surround's `ys`.
- Anything uncertain: when the live selection does not exactly equal the
  yanked text, the plugin draws nothing rather than guessing.

## Colour

The flash is background paint only: no bold, no fade. The default is a soft
green, overridable per vault with a snippet:

```css
.cm-editor {
  --bob-yank-flash-bg: rgba(255, 200, 80, 0.35);
}
```

The line flash paints as an inset overlay, so it stays visible on tinted task
rows (In Progress, Next, Blocked, Cancelled) whose own backgrounds would hide
a plain background fill.

## Live Preview and widgets

Source mode and the Live Preview cursor line are the contract. Rendered
widgets, folded ranges, and replaced ranges are best-effort: the flash never
unfolds or scrolls to show itself.

## How it works

The plugin wraps the Vim adapter's `pushText(registerName, operator, text,
linewise, blockwise)` and flashes only when `operator === "yank"` on a
register other than `"_`. The original runs first and untouched, so register
contents, clipboard delivery, the cursor position, Obsidian's "N lines yanked"
notice, `p`, `.`, macros, and undo behave exactly as with the plugin
disabled.

Wrapping `pushText` — rather than overriding the yank operator — keeps
Obsidian's locally patched yank (including its report) intact, and unload
restores the original method. If another plugin wraps over ours, our wrapper
stays inert inside its chain instead of fighting it.

## Settings

This plugin adds no settings tab, registers no palette commands, and reads no
per-plugin settings. The plugin toggle is the off switch. Yanked text is
never stored or logged.

## Related

- [Bob Vim Surround](bob-vim-surround.md) — its `ys` operator deletes and
  re-inserts text rather than yanking it, so surround gestures never flash.

## Verification

Run the isolated real-Obsidian check on athena after an Obsidian upgrade. It
uses an owned scratch vault and profile, drives Vim through CDP, and writes a
structured report plus light and dark screenshots:

```bash
xvfb-run -a node scripts/obsidian-vim-yank-flash-e2e.cjs \
  -e /snap/bin/obsidian \
  -r /tmp/bob-yank-flash-e2e.json \
  -o /tmp/bob-yank-flash-e2e-shots
```

`node scripts/obsidian-vim-yank-flash-e2e.cjs --self-test` is an offline
fixture check only; it does not prove compatibility with Obsidian.
