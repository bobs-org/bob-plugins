---
title: "Bob Vim Surround"
description: "Edit delimiters around text with Vim-style surround commands."
---

Bob Vim Surround adds Vim-style surround editing to Obsidian.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Vim Surround |
| ID | `bob-vim-surround` |
| Version | 1.5.2 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Add vim-surround ys motions, cs changes, ds deletes, and dot-repeat to Obsidian Vim mode. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

This plugin registers no command palette commands.
<!-- END GENERATED: commands -->

## Operators and delimiters

Bob Vim Surround adds `ys` motions, `cs` changes, `ds` deletes, and dot-repeat
through Obsidian's Vim emulation layer. Every visible, single-UTF-16-code-unit
letter, number, punctuation character, or symbol works as a surround key.

The standard bracket aliases keep vim-surround padding behavior; all other
accepted characters are symmetric delimiters. Symmetric delimiters are
discovered as sequential pairs of maximal same-line runs around the cursor, and
paired runs must have equal lengths. Delimiter runs inside the content can make
pairs ambiguous; the plugin intentionally does not attempt nested parsing.
`cs` replaces both complete matched runs with the requested pair, while each
`ds` removes one delimiter from each side.

Whitespace, controls and navigation keys, modifier chords, composition and dead
keys, combining marks, and multi-code-unit characters such as emoji are not
accepted as surround keys.

## Settings

This plugin adds no settings tab, registers no palette commands, and reads no
per-plugin settings. Its operators live entirely in the Vim keymap.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the plugin that owns
  the `\s` Vim mapping; surround uses the `ys`/`cs`/`ds` operators and claims
  no backslash mapping.
