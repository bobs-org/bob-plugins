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
| Version | 0.1.0 |
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

Matches are ranked by alias prefix, alias substring, tag match, then
description word match. Exact aliases lead their tier, and recently selected
emoji receive a stable boost within a tier. The list shows up to 30 results.

Rows show the Unicode emoji, its primary shortcode, and up to two alternate
aliases or tags. The matched shortcode text is highlighted. Use the arrow keys
to navigate; Enter, Tab, or a click inserts the Unicode emoji in place of the
colon and query. The insertion adds no trailing space.

## Recents

Successful selections are saved in Bob Emoji's plugin data as the newest
30 shortcode and emoji pairs. Recent rows appear first when the query is empty.
The empty-query popular list and recent rows are deduplicated by emoji.
