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
| Version | 0.2.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Click-to-copy chips from `copy:` inline code spans and `bob-copy` fences. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Copy chip on cursor line | `copy-on-cursor-line` | — |
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
newline. The fence grammar and `parseFenceInfo` / `fencePayload` API helpers
ship now; the titled fence card renders in a later phase.

## Gestures

| Gesture | Where | Effect |
| --- | --- | --- |
| Click / tap a chip | Live Preview, Reading view, embeds, hover previews, Tasks query results | Copy the payload |
| Palette "Copy chip on cursor line" (`copy-on-cursor-line`) | Editor, Source mode and Live Preview | Copy the chip at the cursor and flash it like a yank |
| Move the cursor into the span | Live Preview | Reveal the Markdown source, like a link |
| Enter / Space on a focused chip | Live Preview (span) and Reading view (button) | Copy the payload |

Live Preview never moves the caret on click: `mousedown` is prevented and the
widget ignores events. A copy fires only on a primary-button release inside
the same chip after under 4 px of movement, so a drag never copies. Touch taps
work; secondary buttons, cancellations, and releases outside never copy.

## Cursor rule

`api.copyChips.chipAt({ lines, line, ch })` uses zero-based lines and UTF-16
character offsets. `from` / `to` are line-relative offsets including the
delimiters, with `to` exclusive, matching `scanLine`:

1. A chip under the cursor wins (`from <= ch < to`).
2. Otherwise the only chip on the cursor line wins.
3. Two or more chips on the line with the cursor on none is `ambiguous`:
   "N chips on this line · move onto one". Never guess.
4. Zero chips, fenced lines, frontmatter, or invalid input is `none`.

Fenced lines — including opening, closing, and nested backtick/tilde fences —
always return `none` in this phase; the block fallback lands later. The cursor
command works in Source mode and with revealed source as well as rendered Live
Preview.

## Look and feedback

Quiet and theme-native: hairline border, padding `0 .45em`, font size `.92em`,
inherited line height, faint copy glyph, accent hover/focus, `cursor: copy`,
and a visible keyboard focus outline. Unlabeled faces use the monospace font;
labeled faces use the text font. Long faces wrap like inline code with
`box-decoration-break: clone` and never truncate; feedback never changes the
chip width.

- Rest: pill with a fixed-width `bob-copy-chip-glyph` slot (Lucide `copy` via
  `setIcon`) so success never reflows.
- Tooltip: unlabeled chips say "Click to copy"; labeled chips say "Copy: "
  plus a 120-character preview with newlines as `⏎`. The preview truncates;
  the clipboard never does.
- Success: the glyph swaps in place to a green `check` for about 1.2 s, the
  chip pulses once in `--bob-yank-flash-bg` (fallback
  `rgba(80, 200, 120, .35)`), and a shared polite live region announces
  "Copied". No toast. Reduced motion keeps the glyph change and drops the
  pulse.
- Failure: `alert-triangle` in `--text-error` for about two seconds plus
  exactly one `Couldn't copy: <reason>` Notice. Failures are never silent.
- Print and PDF export render the face as inline code with no interactive
  chrome.

Payloads live in `textContent` and JS closures or a `WeakMap`, never in
`innerHTML`, `innerText`, `dataset`, or payload-bearing attributes. Tooltips
are DOM text, so payload `::` never becomes an attribute Dataview rescans.
Reading controls are real `<button type="button">` elements whose accessible
name is `Copy` plus the visible face via `aria-labelledby`; literal payloads
are never duplicated into `aria-label`.

## Syntax fallback and exclusions

With the plugin off, every chip still reads as legible inline code or a
fence. Source mode always shows raw Markdown.

These spans never become chips: link labels, wikilinks, fenced and indented
code, math, comments, frontmatter, physical multiline spans, and empty or
whitespace-only payloads. Dataview `=` / `$=` spans and neighboring Bob marks
are untouched. Rendering and clicking never write the vault.

## Exactness contract

The clipboard gets exactly the declared text, byte for byte. Preview and
clipboard never disagree. Copy is awaited inside the gesture and confirmed
only after fulfillment; failures report their reason. Nothing is trimmed,
interpolated, HTML-decoded, or otherwise changed.

## Non-goals

Not a secret store: payloads are plain text in git. No variables, no snippet
expansion, no `obsidian://copy` protocol handler, and no masked previews.
The fence card, Copy card `C` row, make-or-edit card, Alt+Click editing,
vimrc mappings, and vault adoption land in later phases.

Authored payloads live on copy chips; live context lives on the Copy card.
