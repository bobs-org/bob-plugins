---
title: "Bob Copy Chips"
description: "Type a copy: code span or a bob-copy fence to author click-to-copy text."
---

Bob Copy Chips turns an inline code span that starts with `copy:` — or a
`bob-copy` fence — into a quiet chip that copies the authored text exactly.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Copy Chips |
| ID | `bob-copy-chips` |
| Version | 0.1.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Click-to-copy chips from `copy:` inline code spans and `bob-copy` fences. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

This plugin registers no command palette commands.
<!-- END GENERATED: commands -->

## Syntax

| You type | You see | One click copies |
| --- | --- | --- |
| `` `copy: ssh apollo` `` | ⧉ `ssh apollo` (monospace pill) | `ssh apollo` |
| `` `copy[Zoom]: https://zoom.us/j/123` `` | ⧉ Zoom (text-font pill) | the URL |
| a ` ```bob-copy Weekly status ` fence | a titled card with a Copy button | the fence body, byte-exact |

```markdown
launch an agent with
``copy[last-week prompt]: Update the last-week period note (`bob periods show last-week` prints its path)``
```

- An unlabeled chip shows its own text, in monospace: it _is_ the literal text.
- A labeled chip shows the label in the text font: it names a thing, like a link.
- With the plugin off, every chip still reads as legible inline code or a fence.

The inline grammar is `copy [ "[" LABEL "]" ] ":" [ " " ] TEXT` inside a
CommonMark code span, after the span's own normalization:

- `copy` is lowercase and first.
- `LABEL` is one line. `\]` becomes `]`, `\\` becomes `\`, and any other
  backslash stays literal. The label is trimmed; a blank label means no label.
- `TEXT` is everything after the colon and one optional space, verbatim. It
  must contain a non-whitespace character, so `` `copy:` `` and a
  whitespace-only payload are never chips.
- There are no other escapes: `\n` copies two characters, and nothing is
  interpolated.

A longer backtick run holds text that itself contains backticks. Inside a
table cell, write `\|` for a literal pipe.

A `bob-copy` fence is for multi-line text. The info string's language token
must be exactly `bob-copy`; the rest is the optional label, with surrounding
`[ ]` stripped. The body is the payload, joined with LF and never trimmed. An
extra empty body line before the closing fence keeps exactly one trailing
newline.

Live Preview, Reading view, and the make-or-edit card land in later phases.
Authored payloads live on copy chips; live context lives on the Copy card.
