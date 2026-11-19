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
| Version | 0.5.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Click-to-copy chips from `copy:` inline code spans and `bob-copy` fences. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Copy chip at cursor | `copy-on-cursor-line` | — |
| Make or edit copy chip | `make-or-edit` | Mod+Shift+y |
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

A `bob-copy` fence is for multi-line text that should read as a titled
card: prompts, emails, addresses. Ordinary code listings keep the native
fence copy button. The info string's language token must be exactly
`bob-copy`; the rest is the optional label, with surrounding `[ ]`
stripped. The body is the payload, joined with LF and never trimmed. An
extra empty body line before the closing fence keeps exactly one trailing
newline. A fence nested in a list item dedents under its opening, and an
unclosed fence runs to the end of the note.

The fence renders as a card: a header with the copy glyph, the label, a
meta line, and a Copy button, above the body in the text font with
`white-space: pre-wrap`. The meta reads "N lines · M chars" with tabular
figures, plus "· ends with ⏎" when the payload ends with LF. An unlabeled
fence — or one whose section info is missing, as in callouts and some
embeds — is titled "Copy · N lines". The body folds after eight lines
behind a "Show all N lines" toggle; the fold is session-only. Clicking the
body selects text and never copies. Only the button copies, flipping to
"Copied ✓" for about 1.2 s on success.

## Gestures

| Gesture | Where | Effect |
| --- | --- | --- |
| Click / tap a chip | Live Preview, Reading view, embeds, hover previews, Tasks query results | Copy the payload |
| Copy button on a `bob-copy` card | Live Preview, Reading view, embeds | Copy the fence payload, byte-exact |
| Palette "Copy chip at cursor" (`copy-on-cursor-line`) | Editor, Source mode and Live Preview | Copy the chip at the cursor, or the only chip in the cursor's task, and flash it like a yank |
| `gy` (normal mode; mapped in the vault vimrc to `copy-on-cursor-line`) | Editor, normal mode | Copy the chip at the cursor, or the only chip in the cursor's task, and flash it |
| `Mod+Y` then `C` (Copy card) | Copy card | Copy the chip at the cursor, or the only chip in the cursor's task, previewed first |
| Palette "Make or edit copy chip" (`make-or-edit`), default Mod+Shift+Y | Editor, Source mode and Live Preview | Open the authoring card for the selection, chip, or cursor |
| Alt+Click a chip | Live Preview | Open the authoring card for that chip |
| Move the cursor into the span | Live Preview | Reveal the Markdown source, like a link |
| Enter / Space on a focused chip | Live Preview (span) and Reading view (button) | Copy the payload |

Live Preview never moves the caret on click: `mousedown` is prevented and the
widget ignores events. A copy fires only on a primary-button release inside
the same chip after under 4 px of movement, so a drag never copies. Touch taps
work; secondary buttons, cancellations, and releases outside never copy.

## Cursor rule

`api.copyChips.chipAt({ lines, line, ch, scope? })` uses zero-based lines and UTF-16
character offsets. `from` / `to` are line-relative offsets including the
delimiters, with `to` exclusive, matching `scanLine`:

1. A chip under the cursor wins (`from <= ch < to`).
2. Otherwise the only chip on the cursor line wins.
3. Otherwise the `bob-copy` fence the cursor is on or inside wins as a
   block chip (`form: "block"`), with the whole fence payload. Inline chips
   on the cursor line still win, so example spans inside a fence body never
   resolve on their own.
4. Two or more chips on the line with the cursor on none is `ambiguous`:
   "N chips on this line · move onto one". Never guess.
5. If the cursor line has no chip and the caller supplies a valid task scope,
   the only chip on the task's owned lines wins. A nested `#task` subtree is
   excluded. A `bob-copy` fence touched by the scope counts once; other fences
   and frontmatter contribute nothing.
6. Two or more chips in that task scope are `ambiguous`:
   "N chips in this task · move onto one". Never guess.
7. Zero chips, non-`bob-copy` cursor fences, frontmatter, or invalid input is
   `none`.

`scope` is opt-in: `{ kind: "task", lines }` contains the zero-based lines
owned by the cursor's task and must include the cursor line. Ready and
ambiguous results add `scope: "cursor"` or `scope: "task"`; `none` keeps its
`{ state: "none", count: 0 }` shape. Without a valid scope, resolution stays
line-only. `gy` uses the task step when Bob Navigation Hotkeys exposes
`taskScope`; without that plugin it stays line-only. `Mod+Shift+Y` never uses
the task step.

A block chip carries `{ form: "block", label, text, line, from, to }` where
`line` is the cursor line for a cursor result or the fence opening line for a
task-scope result, and `[from, to]` covers that line, so a missing card still
flashes where the chip lives. Fence detection matches the Copy card's
list-nested backtick and tilde fence handling. The cursor command works in
Source mode and with revealed source as well as rendered Live Preview, and
flashes the card when one is visible.

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
  A fence card failure also flips its button to "Copy failed" for the same
  dwell.
- Print and PDF export render the face as inline code with no interactive
  chrome. Fence cards print the full body as plain text — the fold opens
  and the button, toggle, and glyph hide.

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

## Authoring

Mod+Shift+Y (command **Make or edit copy chip**) opens a card that writes
the chip Markdown in one undoable editor transaction. Alt+Click on a Live
Preview chip opens the same card for that occurrence. Payloads always come
from the note source, never from rendered text.

Context, in this order:

1. More than one selection: **One selection at a time**, no card.
2. A nonempty selection: wrap that exact text. Reversed and Vim visual
   ranges count. Label starts focused.
3. An empty selection on a copy chip: **Edit copy chip**, filled from the
   chip under the cursor or the only chip on that line. `Mod+Shift+Y` never
   uses the task fallback. Two chips on the line with the cursor on neither
   is **N chips on this line · move onto one**.
4. An empty selection inside a plain code span: convert that span's
   CommonMark-normalized text. Spans inside fences, links, wikilinks,
   frontmatter, math, or comments are left alone.
5. Otherwise insert at the cursor. A best-effort clipboard read prefills
   Text and selects it; an unavailable clipboard leaves Text empty. A late
   read never overwrites typing or a closed card.

The card has a one-line Label (placeholder **optional — shown instead of
the text**) and a monospace Text field. Preview is a live, noninteractive
chip or fence card — **inline chip** or **block card · N lines** — plus a
scrollable Markdown row of the exact replacement bytes. Invalid drafts
cannot save: **nothing to copy**, **whitespace only — nothing to copy**,
**labels are one line**, and **can't put a block card in a table cell**.

Keys: Enter saves, Shift+Enter inserts a newline in Text, Tab / Shift+Tab
cycle the fields, and Mod+Shift+Y saves. Esc, Ctrl+[ (Ctrl alone), and q
outside the fields cancel; q inside Label or Text types a q. A second
Mod+Shift+Y while the card is open saves it.

Save writes one editor transaction, isolated from the typing that came
before it, and parks the cursor after the chip. A fence nested in a list
item indents to the item's content column using the line's own whitespace.
If the note, editor, or captured source changed, save refuses with **The
note changed — reopen the card** and writes nothing.

Authored payloads live on copy chips; live context lives on the Copy card, whose `C` row copies the chip at the cursor.

## Non-goals

Not a secret store: payloads are plain text in git. No variables, no snippet
expansion, no `obsidian://copy` protocol handler, and no masked previews.
Vimrc mappings and vault adoption land in later phases.
