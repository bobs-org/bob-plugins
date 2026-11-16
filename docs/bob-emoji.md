---
title: "Bob Emoji"
description: "Reference for Bob Emoji in Bob's Obsidian setup."
---

Bob Emoji opens a themed emoji menu when you type a colon at the start of a
line or immediately after whitespace in an Obsidian Markdown editor.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Emoji |
| ID | `bob-emoji` |
| Version | 0.2.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Complete GitHub-style emoji shortcodes from a colon typed after a space. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

This plugin registers no command palette commands.
<!-- END GENERATED: commands -->

## Trigger and filtering

Type a colon at the start of a line or after a space or other whitespace to
open the menu. The empty-query menu shows recently used emoji first, followed
by a curated popular list. Escape dismisses it; Enter immediately after the
colon selects the first row.

Continue with a GitHub-style shortcode query such as :fire, :thumbs, or :+1.
Queries are case-insensitive and can use letters, numbers, underscores, plus
signs, and hyphens. A closing colon is inert: typing a full :fire: leaves that
text in place and closes the menu. The plugin never auto-replaces a complete
shortcode.

The menu does not trigger when the colon follows a word, as in word:, 3:30, a
URL, or a Dataview field such as key::. It also skips code, math, HTML comments,
and YAML frontmatter when CodeMirror exposes those syntax nodes. If the syntax
tree API is unavailable, the feature keeps working without those context
guards. In Obsidian Vim, normal-mode colon opens the Ex command line and does
not edit the document; the menu works while typing in insert mode.

## Results and selection

Queries are normalized (lowercase, surrounding colons stripped; `_`, `-`, and
whitespace split tokens) and every token must match. Ranking is tiered, best
first: exact alias or keyword, alias prefix, alias word-start or keyword
prefix, alias substring, description word prefix, description substring, then
conservative fuzzy (edit distance 1 for tokens of 4+ chars, only when fewer
than 8 results). Recents and caller-supplied `boost` glyphs reorder only
within a tier. A query that is exactly one emoji grapheme returns that entry
first (VS16-insensitive). The catalog carries gemoji `category` plus CLDR
English keywords and TTS names (Unicode License, see
`plugins/bob-emoji/vendor/README.md`), deduped against aliases and tags. The
list shows up to 30 results.

Rows show the Unicode emoji, its primary shortcode, and up to two alternate
aliases or keywords. The matched shortcode text is highlighted. Use the arrow
keys to navigate; Enter, Tab, or a click inserts the Unicode emoji in place of
the colon and query. The insertion adds no trailing space. Pasted glyphs
(including ZWJ sequences, flags, keycaps, and tone modifiers) are preserved
byte-for-byte; digit keycaps (`0️⃣`–`9️⃣`) are accepted with the note that bob
stores a leading digit keycap as label text.

## Label suggestions

`suggestForLabel(label)` tokenizes the label, drops a small stop-word list,
lightly stems (`-s`, `-es`, `-ing`, `-ed`), and ranks by matched tokens, then
tier. For example, "Seed" suggests 🌱, "Ready" suggests ✅, and
"Automation (service)" suggests ⚙️ or 🛠️.

## Recents

Successful selections are saved in Bob Emoji's plugin data as the newest
30 shortcode and emoji pairs. Recent rows appear first when the query is empty.
The empty-query popular list and recent rows are deduplicated by emoji.
