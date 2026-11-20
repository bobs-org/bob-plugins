---
title: "Bob Chips"
description: "Type a copy: span or bob-copy fence to copy text, or a run: span or bob-run fence to run bob commands."
---

Bob Chips turns an inline code span that starts with `copy:` — or a
`bob-copy` fence — into a chip with a solid blue copy well that copies the
authored text exactly.
A `run:` span becomes a command chip that runs a bob command through Bob
Command Mode, and a `bob-run` fence becomes a sequence card; see
[Command chips](#command-chips).

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Chips |
| ID | `bob-chips` |
| Version | 0.15.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Click-to-copy chips from `copy:` spans and `bob-copy` fences, plus click-to-run `run:` bob command chips and `bob-run` sequence cards; ⌘↵ runs the command chip at the cursor, with an armed chip and a keycap hint from the live binding. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Copy chip at cursor | `copy-on-cursor-line` | — |
| Make or edit chip | `make-or-edit` | Mod+Shift+y |
| Run command chip at cursor | `run-at-cursor` | — |
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

The fence renders as a card in the same copy blue: a lightly tinted
header with the copy glyph in a solid blue well, the label, a meta line,
and a Copy button styled like a chip body, above a plain body in the text
font with `white-space: pre-wrap`. On a narrow card the Copy button (and
the meta, when it no longer fits) wraps to a right-aligned second header
row instead of squeezing the title. The meta reads "N lines · M chars" with tabular
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
| Palette "Make or edit chip" (`make-or-edit`), default Mod+Shift+Y | Editor, Source mode and Live Preview | Open the authoring card for the selection, chip, or cursor; it makes and edits both kinds |
| Alt+Click a chip | Live Preview | Open the authoring card for that chip (copy or command) |
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

Every copy chip is a two-part capsule: a solid **well** in the copy hue
holding a white Lucide `copy` glyph, beside a lightly tinted **body**
holding the face in hue-tinted ink. The well is the beacon that says "this
copies"; the body stays calm and readable. Unlabeled faces use the
monospace font; labeled faces use the text font at weight 500.

- **Hue.** One identity hue, `var(--color-blue)` by default. It is free on
  a daily note: links and command chips use the theme accent, inline code
  is cyan, and task lanes are red, green, and yellow. A CSS snippet can
  recolor every chip and `bob-copy` card by setting
  `--bob-copy-chip-hue` (for example on `body`); there is no plugin
  setting. All colors are theme variables mixed from that one ink: body
  fill 10%, border 50%, face ink 30% over `--text-normal`, glyph in
  `--text-on-accent`.
- **Geometry.** Padding `0.1em 0.5em 0.12em`, font size `.92em`, inherited
  line height, baseline-aligned, `box-decoration-break: clone`, and
  `cursor: copy`. The vertical padding never grows the line, and the
  well's box is exactly the body's.
- **One look in every view.** Live Preview spans and the buttons in
  Reading view, embeds, hover previews, and Tasks and Dataview results
  compute the same fill, border, shadow, ink, padding, font, and outline in
  every state; no chip picks up Obsidian's form-button fill or shadow.
- **Wrapping.** Long faces wrap like inline code and never truncate, but
  the glyph never sits alone at a line end: the chip never breaks between
  the well and the face's first character, and its end cap never wraps
  alone. Where a chip wraps, its cloned end cap may overhang the text
  column by its own padding (about half an em), as clone-decorated inline
  code does in Chromium.
- **Tooltip.** Hovering or keyboard-focusing a chip shows what a click
  copies after about 0.4 s: unlabeled chips say "Click to copy"; labeled
  chips say "Copy: " plus a 120-character preview with newlines as `⏎`.
  Live Preview adds " · Alt+Click to edit". The preview truncates; the
  clipboard never does. The tooltip describes the chip for assistive
  technology (`role="tooltip"`, `aria-describedby`). Like command-chip
  tooltips, it may clip at the top edge of the editor on the first visible
  line.

| State | Look |
| --- | --- |
| Rest | Blue well, 10% body, 50% border |
| Hover | Body at 17%, border at full ink; a 120 ms color transition |
| Pressed | Body at 24% |
| Keyboard focus | A 2 px outline in the ink, offset 2 px |
| Copied (about 1.2 s) | Green well with a white `check`, green-tinted body and border, one pulse in `--bob-yank-flash-bg` (fallback `rgba(80, 200, 120, .35)`), and a polite "Copied" announcement. No toast. |
| Failed (about 2 s) | Red (`--text-error`) well with a white `alert-triangle`, plus exactly one `Couldn't copy: <reason>` Notice. Failures are never silent. |

No state changes the border width, padding, weight, or the well's size; the
glyph swaps in a fixed-size slot, so feedback never reflows the line.

The `bob-copy` card wears the same identity: a blue-tinted frame, a header
at 8% ink with the glyph in a solid rounded well, the title in the face
ink, and a Copy button with the chip body's recipe (12% fill, 50% border,
full-ink border on hover). The button keeps a fixed `7.5em` minimum width so
"Copied ✓" and "Copy failed" never reflow the header, and a card copy or
failure swaps the whole card to green or red for the same dwell. The
show-all toggle stays muted until hovered. In the **Make or edit chip**
card, the **COPY CHIP** header icon is the same solid well; the **COMMAND
CHIP** header keeps the accent play glyph.

Reduced motion drops the pulse, the color transitions, and the tooltip's
timed reveal (the tooltip shows at once); the glyph swap and state colors
stay. Print and PDF export render every chip, in every state, as plain
inline code: no border, fill, padding, well, tooltip, or weight, with the
monospace face for unlabeled chips. Fence cards print the full body as
plain text — the fold opens and the header fill, button, toggle, and glyph
hide.

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

Mod+Shift+Y (command **Make or edit chip**) opens one card that makes,
converts, and edits both kinds and writes the chip Markdown in one
undoable editor transaction. Alt+Click on a Live Preview chip of either
kind opens the same card for that occurrence, and Alt+Click on a Live
Preview `bob-run` card's Run button opens it for that fence. Payloads
always come from the note source, never from rendered text.

Context, in this order:

1. More than one selection: **One selection at a time**, no card.
2. A nonempty selection: wrap that exact text. Reversed and Vim visual
   ranges count. Label starts focused.
3. An empty selection on a chip of either kind: edit it, filled from the
   `bob-copy` or `bob-run` fence holding the cursor, the chip under the
   cursor, or the only chip on that line. `Mod+Shift+Y` never uses the
   task fallback. Two chips on the line with the cursor on neither, of
   any kinds, is **N chips on this line · move onto one**.
4. An empty selection inside a plain code span: convert that span's
   CommonMark-normalized text. Spans inside fences, links, wikilinks,
   frontmatter, math, or comments are left alone.
5. Otherwise insert at the cursor. A best-effort clipboard read prefills
   Text and selects it; an unavailable clipboard leaves Text empty. A late
   read never overwrites typing or a closed card.

### Kind

The **Kind** row is a two-button Copy | Run control in the Tab cycle; ←/→
pick a kind and Space toggles it. The header reads **COPY CHIP** or
**COMMAND CHIP** with the matching glyph, and Text is named **Command** in
Run. Switching kinds keeps Label and Text exactly and only changes the
grammar the card writes (`copy:` / `bob-copy` or `run:` / `bob-run`).

The starting kind is predictable and never switches on its own:

- Editing a chip keeps its kind, so a copy chip that holds a bob command
  stays a copy chip until you pick Run.
- A selection, a plain code span, or a clipboard prefill starts in Run when
  Command Mode resolves its text as a bob command line, including one
  only another host can run. Text that would resolve once `bob` is added
  (`task reconcile`) also starts in Run and offers **Add bob**.
- Everything else starts in Copy, and so does all new text without Command
  Mode. A late clipboard prefill picks the kind once, unless you already
  picked one.

### Run validation

In Run, a **Steps** row checks each `&&` step or fence line live against
Command Mode's catalog, without running anything:

```text
╭─ ▶ COMMAND CHIP ──────────────────────────────────────────────────╮
│ Kind      [ Copy | ▶ Run ]                                        │
│ Label     [ Sync calendar and inboxes                           ] │
│ Command   [ bob gcal sync -n 2 && bob gkeep pull && bob gmail…  ] │
│ Steps     ✓ Sync Calendar events         writes · preview skipped │
│           ✓ Drain Keep inbox             writes · preview skipped │
│           ✓ Sync Gmail label             writes · preview skipped │
│ Preview   ▶ Sync calendar and inboxes · 3            inline chip  │
│ Markdown  `run[Sync calendar and inboxes]: bob gcal sync -n 2 …`  │
╰─ ⏎ save · ⇧⏎ new step · Tab next field · Esc cancel ──────────────╯
```

| Step mark | Meaning | Save |
| --- | --- | --- |
| ✓ title, effect, note | A catalog command. The note says what a click will do: **runs now**, **preview skipped**, **asks first**, or **opens its output** | Allowed |
| ✗ step and reason | Command Mode refuses it: no `bob`, shell syntax, an unknown or excluded command, or a missing argument | Blocked, with bob's reason |
| ⚠ step and reason | Only another host can run it | Allowed, with a warning: a Mac-only chip may be written on athena |
| · step | Command Mode is missing, disabled, or still loading its catalog | Allowed: the card says the commands can't be checked here |

A trailing or doubled `&&` and other syntax faults also block Save. When a
step lacks its leading `bob` and adding it would make a command, the
**Add bob** button (in the Tab cycle after Command; Enter or Space presses
it) inserts `bob ` before each such step and keeps every other byte. The
card rechecks when Command Mode's catalog changes.

### Preview, keys, and save

Preview is a live, noninteractive chip or card in the chosen kind:
**inline chip**, **block card · N lines** (Copy), or **sequence card · N
steps** (Run), plus a scrollable Markdown row of the exact replacement
bytes. A Run preview wears the face the chip would get on this host,
including ⊘ for a refused command. Invalid drafts cannot save: **nothing
to copy** or **nothing to run**, **whitespace only**, **labels are one
line**, **can't put a block card in a table cell**, **can't put a bob-run
fence in a table cell**, and, in Run, any ✗ step. A one-line draft writes
an inline span; Shift+Enter starts another line, which makes a fence (a
new step, in Run).

Keys: Enter saves, Shift+Enter inserts a newline in Text, Tab / Shift+Tab
cycle Kind, Label, Text, and Add bob, and Mod+Shift+Y saves. Esc, Ctrl+[
(Ctrl alone), and q outside the fields cancel; q inside Label or Text
types a q. A second Mod+Shift+Y while the card is open saves it.

Save writes one editor transaction, isolated from the typing that came
before it, and parks the cursor after the chip. A fence nested in a list
item indents to the item's content column using the line's own whitespace.
If the note, editor, or captured source changed, save refuses with **The
note changed — reopen the card** and writes nothing. Saving never runs a
command chip.

Authored payloads live on copy chips; live context lives on the Copy card, whose `C` row copies the chip at the cursor.

## Command chip grammar

A command chip is a `run:` code span or a `bob-run` fence that holds a bob
command line. `api.commandChips` exposes the grammar. Live Preview, Reading
view, embeds, hover previews, and Tasks and Dataview results render and run
`run:` spans (see [Command chips](#command-chips)); `bob-run` fences render
as [sequence cards](#the-bob-run-card).

| You type | Parses as |
| --- | --- |
| `` `run: bob task reconcile` `` | Unlabeled chip, text `bob task reconcile` |
| `` `run[Sync]: bob gcal sync -n 2 && bob gkeep pull` `` | Chip labeled `Sync`, one `&&` sequence |
| a ` ```bob-run Morning sync ` fence | Block chip: the body, one step per line |

The inline grammar is `run [ "[" LABEL "]" ] ":" [ " " ] TEXT`. It is the
copy grammar above with a lowercase `run` prefix, so labels, escapes,
longer backtick runs, and `\|` in table cells work the same way. `TEXT` is
verbatim. The grammar never judges the command: Bob Command Mode decides
whether every step starts with the word `bob` and whether the text is free
of shell syntax. Plain `` `bob …` `` spans never become command chips.

A `bob-run` fence follows the `bob-copy` fence rules. The language token
is exactly `bob-run`, and the rest of the info string is the optional
label. The body is LF-joined and verbatim. A fence nested in a list item
dedents under its opening, and an unclosed fence runs to the end of the
note.

One scanning pass finds both kinds. Command chips skip every span that
copy chips skip: link labels, wikilinks, and physical multiline spans. The
pure scanner also skips command chips inside inline math (`$…$`,
`$$…$$`), `%%` comments, and HTML comments, because a command chip is a
button. An unclosed comment opener shields the rest of its line. Dollar
amounts such as `$5 and $6` stay prose.

Serializing writes an inline span for one-line text and a `bob-run` fence
for multi-line text. The fence marker is longer than any fence run in the
body, even an indented one, so a body line never closes the fence early.
A multi-line payload in a table cell is refused with **can't put a bob-run
fence in a table cell**, and a blank one with **nothing to run**.

### Which command chip ⌘↵ targets

`api.commandChips.chipAt({ lines, line, ch, scope? })` is the pure rule
that decides what ⌘↵ runs. Coordinates match `copyChips.chipAt`:

1. The cursor is on or inside a `bob-run` fence: that fence. Any other
   fence, and frontmatter, is `none`.
2. A command chip under the cursor (`from <= ch < to`): that chip.
3. The cursor is on a link: `none`, so the existing ⌘↵ chain opens it.
   Links are Markdown links and images, wikilinks and embeds, autolinks,
   and bare `http(s)://` URLs outside code spans.
4. One command chip on the line: that chip. Two or more is `ambiguous`:
   **N command chips on this line · move onto one**.
5. The line holds any link: `none`, so the line's own target wins.
6. The only command chip in the task scope: that chip. A touched `bob-run`
   fence counts once, and nested subtasks are outside the scope. Two or
   more is `ambiguous`: **N command chips in this task · move onto one**.
7. Otherwise `none`.

Copy chips never count here, and `gy` never sees command chips.

### ⌘↵ and the hint

⌘↵ (Meta+Enter) is the vault's binding for Bob Navigation Hotkeys'
Highlights dispatcher. It works in Live Preview and Source mode, in any Vim
mode. The dispatcher asks Bob Chips first, which applies the rule above:

| The rule finds | ⌘↵ does |
| --- | --- |
| One ready chip | Runs it exactly as a click would, with a brief accent pulse. A chip that is already running opens its live output. |
| Two or more chips | Shows one Notice, **N command chips on this line · move onto one**, and nothing else |
| A chip that bob refuses | Shows one Notice with bob's reason, and nothing else |
| No chip | Runs the existing chain: Highlights, then Gmail, then the link in a new tab |

A refusal never falls through to a link. In a copy-only note, on mobile, or
without Command Mode, the chip step is skipped, so ⌘↵ behaves exactly as
before. The palette command **Run command chip at cursor**
(`run-at-cursor`) has no default hotkey. It uses the same rule, for hosts
where the window manager takes Super+Enter, and it says so when nothing
qualifies.

When ⌘↵ would run a chip, the focused editor shows two cues:

- The target chip is **armed**: an accent border and an accent ▶, with no
  size change.
- A muted keycap capsule sits at the end of the cursor line. It reads
  **⌘↵ Run**, or **⌘↵ Run · LABEL** when the target sits on another line
  of the task, or **⌘↵ Output** while the target runs.

The keycap reads the live binding of
`bob-navigation-hotkeys:open-reference-pdf-in-highlights`. It uses macOS
glyphs on a Mac and Emacs-style `M-↵` elsewhere, like the `⌘↵ Gmail` hint.
It shows only when Bob Navigation Hotkeys reports that its dispatcher runs
chips. A rebound key shows the new keycap, and no binding shows nothing. An
ambiguous, refused, loading, or copy-only target never shows a keycap, and
neither does a selection or an unfocused editor. While the rule claims the
cursor, the `⌘↵ Gmail` capsule and the Highlights status chip and rail step
aside, so only one ⌘↵ cue shows at a time. Once the binding is live, chip
tooltips say "Click or ⌘↵ to run".

## Command chips

A `run:` span becomes a quiet play pill in Live Preview and a real
`<button type="button">` in Reading view, embeds, hover previews, and query
results. Only Bob Command Mode tokenizes the text, checks it against bob's
catalog, and runs it. There is no shell, and `confirm` commands always ask
first.

| Gesture | Effect |
| --- | --- |
| Click, tap, Enter, or Space | Run it, or copy it in a copy-only note |
| Shift+Click or Shift+Enter | Open it in Command Mode's guarded path |
| ⌘↵ in the editor | Run the chip the cursor targets; see [⌘↵ and the hint](#and-the-hint) |
| Alt+Click | Open the make-or-edit card for this chip (Live Preview); never runs or copies |
| Move the cursor into the span | Reveal the Markdown source (Live Preview) |

A click runs now. A `run` or `preview-first` writer skips its preview, a
`report` opens its output, and a `confirm` command opens its confirm card.
Several `&&` steps run as one Command Mode sequence. Clicking a chip that is
already running opens its live output and never starts a second run. Running
never completes, freshens, or advances the chip's task. Drags of 4 px or
more, secondary buttons, and releases outside do nothing, and a click never
moves the caret. A span that changed since it rendered refreshes and runs
nothing.

The note the chip's text comes from decides whether it may run, never the
note on screen. These chips are copy-only: they show a copy glyph and copy
the payload byte-exact with the copy-chip feedback.

- Notes under `mail/`, `ref/`, `ref_history/`, `.bob/`, or `_conflicts/`
  (any case), including a note renamed there after it rendered.
- An editor without a note, and query output whose note is unknown.
- Mobile.
- A missing or disabled Command Mode.

### Where a command chip may run

| Chip shown in | Its note is | Click |
| --- | --- | --- |
| Live Preview or Reading view | The open note | Runs, unless that note is copy-only |
| An embed or hover preview | The embedded note, even inside a dashboard | Runs, unless the embedded note is copy-only |
| A Tasks query row's description | The task's note (Tasks 8.6) | Runs, unless the task's note is copy-only |
| A Dataview `TASK` or list item | The item's note (Dataview 0.5.68) | Runs, unless the item's note is copy-only |
| A Tasks group heading, a Dataview table, `LIST`, group header, inline query, or inline field, `dataviewjs` output, or another plugin's block | Unknown: these render with the dashboard's path | Copies: **source note unknown** |
| An embed whose source differs from its link | Unknown | Copies: **source note unknown** |
| Anything Command Mode refuses | — | One Notice with the reason; nothing runs or copies |

A dashboard's own path never lets a result from `ref/` run. Each click
re-reads the note: a span that changed or vanished since it rendered
refreshes and runs nothing.

### What a command chip can never do

The text of a note can only name a bob command that the user could already
run from Command Mode:

- Every `&&` step must start with the literal word `bob`, and Command Mode
  checks every step before the first one starts.
- Only commands in bob's catalog run. Unknown and excluded commands, and
  commands for another host, refuse.
- There is no shell: unquoted pipes, redirects, `;`, backticks, `$(…)`,
  and variables refuse. Quoted text, `~`, and globs stay literal words.
- Note text cannot choose the program, the run options, the policy, or the
  catalog entry. A `confirm` command always asks first, even from a chip.
- Notes in the protected folders above, unknown query sources, mobile, and
  a missing Command Mode only copy. Commands run only on desktop.
- Rendering, hovering, scrolling, export, and catalog refreshes never run or
  copy. Only a deliberate click, tap, or key does.

A command that Command Mode refuses shows ⊘. Refusals cover non-bob steps,
shell syntax, unknown or excluded commands, missing arguments, and other
hosts. A click on ⊘ shows one Notice with the reason.

An unlabeled chip shows its resolved steps in monospace, with each later
step's leading `bob` drawn as a faint `›`. A labeled chip shows its label in
the text font, plus a faint `· N` for N steps. While the catalog loads, and
in copy-only notes, an unlabeled chip shows its payload verbatim.

| State | Glyph and ink |
| --- | --- |
| Ready | Faint ▶, accent on hover |
| Loading | Faint ▶ |
| Queued | Hourglass, dashed accent border |
| Running | Spinning loader; sequences add a 2 px segmented underline (done green, current accent, upcoming faint) and tint the current step |
| Completed | Green check for about 1.6 s plus one pulse, then Ready |
| Needs attention | Orange ▶, kept until the next run or reload |
| Failed | Error ▶, kept until the next run or reload |
| Unavailable | Ban glyph, muted text, dashed border |
| Copy only | Copy glyph |

Command chips keep their own quiet geometry: padding `0 .45em`, a hairline
accent border, and a 7% accent wash. No state changes the line's width or
height. Run state outlives editor
rebuilds and Reading re-renders, so a note rewritten mid-run keeps its live
chip, and every copy of one command on screen shows the same run.

The hover tooltip is DOM text with these lines:

1. The state.
2. The full command lines.
3. One policy line: "Runs now · skips its preview", "Asks first: …", or
   "Opens its output".
4. "Click to run · ⇧Click opens Command Mode", which becomes "Click or ⌘↵
   to run · …" once the ⌘↵ binding is live, plus "· ⌥Click edits" in Live
   Preview.

A failed chip's tooltip carries the first error line. A shared polite live
region announces "Running …", "… finished", "… needs attention", and
"… failed". The accessible name is "Run" (or "Copy") plus the face, via
`aria-labelledby`. Reduced motion drops the spin and pulse. Print and PDF
show every state as plain inline code; a label prints as its text. Rendering, hovering, scrolling, and catalog
refreshes never run or copy anything.

### The bob-run card

A `bob-run` fence holds a sequence, one `bob` command per line:

````markdown
```bob-run Morning sync
bob gcal sync -n 2
bob gkeep pull
bob gmail sync
```
````

It renders as a titled card in Live Preview, Reading view, embeds, and
hover previews:

```text
╭──────────────────────────────────────────────────────────────╮
│ ▶  Morning sync                    3 steps · syncs   [ Run ] │
├──────────────────────────────────────────────────────────────┤
│  1  bob gcal sync -n 2                                       │
│  2  bob gkeep pull                                           │
│  3  bob gmail sync                                           │
╰──────────────────────────────────────────────────────────────╯
```

- The header shows the play glyph, the label (or **Run · N steps** without
  one), a meta line, and a Run button. The meta reads "N steps · EFFECT",
  where the effect is the strongest step's (reads, then writes, then
  syncs), plus "· asks first" when a step is a `confirm` command.
- Steps are numbered and monospace. A line may hold several `&&` steps;
  blank lines are skipped.
- Only the Run button runs. Clicking the body selects text. Shift+Click on
  Run opens Command Mode's guarded path, as on an inline chip, and
  Alt+Click on Run in Live Preview opens the make-or-edit card for the
  fence.
- The card runs exactly as an inline chip with the same text: one Command
  Mode sequence that halts at the first failure, with the same source
  rules, confirm floor, and run state. An inline chip and a card with the
  same steps show the same run.

While it runs, each step carries a mark and the header follows along:

| Mark | Meaning |
| --- | --- |
| ✓ and a duration | Done |
| Spinner, accent text | Running now (an hourglass while queued) |
| ○ | Not run yet |
| ◐ | Needs attention; the sequence continues |
| ✗ with bob's first error line and an **Output** link | Failed |
| ■ or ? | Stopped, or an unknown outcome |
| – | Skipped after a halt |

The meta reads "2 of 3" while step 2 runs, and the Run button reads
**Output**, which opens the live output. Afterward the meta reads "done",
"stopped at 2 · failed", or "finished · needs attention". Completed cards
return to rest after about 1.6 s; failed and needs-attention marks stay
until the next run or reload. An **Output** link opens that step's output
and never runs anything. The button keeps one width, so no state reflows
the header.

- **Unavailable.** When Command Mode refuses the text, the header shows ⊘
  and "Can't run: REASON (step K)", and step K is marked ✗ with the reason.
  Run shows the same reason in a Notice.
- **Copy only.** In a copy-only note, the header shows the copy glyph and
  the reason, and the button reads **Copy**. It copies the fence body
  byte-exact.
- **Print.** Print and PDF export show the title over a plain code listing
  of the steps.

## Non-goals

Not a secret store: payloads are plain text in git. No variables, no snippet
expansion, no `obsidian://copy` protocol handler, and no masked previews.
Vimrc mappings and vault adoption land in later phases.
