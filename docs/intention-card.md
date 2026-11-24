---
title: "Day and Period Cards"
description: "Reference for the day and period cards, formerly the intention card, and the card editor on daily and period notes."
---

The day and period cards were formerly called the intention card. Bob Ledger
Tools mounts a **day card** on canonical daily notes and a **period card** on
week, quarter, and year notes as the note's title block, in Reading view and
Live Preview. The **card editor** is the keyboard-first editor for their
intentions, summary, and reflection.

The generic [Property Editor](property-editor.md) handles loose properties on
these notes. It routes `intentions`, `summary`, and `reflection` back to the
card editor and keeps identity or derived values locked.

## Where the card appears

The card appears only on canonical subjects: `YYYY/YYYYMMDD.md` daily notes,
`YYYY/YYYY-Www.md` weeks, `YYYY/YYYY-Qn.md` quarters, and `YYYY.md` years,
with Bob's ISO-week quarters and ISO week-year. `all_time` and non-canonical
notes never qualify. Year has no editable parent.

The card always mounts on a canonical subject with valid values (intentions
is an array of nonempty one-line strings; summary is a one-line string;
reflection is a string) in desktop Obsidian, Reading or Live Preview. A note
with none of those fields gets an identity-only card. Malformed values,
Source mode, embeds, hover popovers, canvas nodes, and mobile keep native
rendering.

## Title block

The card mounts in Obsidian's title slot, after the hidden inline title.
Eligible cards replace the in-document native Properties block, whose DOM
node remains the slot anchor. Its title block holds:

- a leaf tile: the weekday over the date (`FRI` over `20`), or `WEEK` over
  `47`, `QTR` over `Q4`, and `YEAR` over `2026`;
- a kicker: `DAY · W47 · 2026`, `WEEK · 2026-Q4`, `QUARTER · 2026`, or
  `YEAR · All time`, whose parent parts link to the parent note;
- the title, computed from the path and never parsed from the H1:
  `Fri, Nov 20, 2026`, `2026-W47`, `2026-Q4`, or `2026`;
- a period subtitle: `Nov 16 – 22, 2026`,
  `W40–W53 · Sep 28, 2026 – Jan 3, 2027`, or
  `Dec 29, 2025 – Jan 3, 2027 · 53 weeks`;
- a state pill: `TODAY`, `YESTERDAY`, or `TOMORROW` on days, and
  `THIS WEEK`, `THIS QUARTER`, or `THIS YEAR` on the current period. The
  midnight rollover repaints it.

Days and periods use the temporal cyan accent, never an area hue. The card's
accessible name leads with the species word (`Day: Fri, Nov 20, 2026`), and
the pane shows exactly one level-1 title: the card's.

### Docked rail

When the note's recognized title block holds its nav line, the card docks a
rail: `‹ Thu 19 · ↑ W47 · Sat 21 ›` on days and `‹ W46 · ↑ 2026-Q4 · W48 ›`
on periods. Narrow panes compact it to `‹ Thu · ↑ W47 · Sat ›`. Week,
quarter, and year cards add a strip of children chips from the child-links
line, and the chip that contains today is marked current. Targets come from
the nav line's own links.

A note with no recognized nav line, such as a legacy daily, gets a derived
step row from the same calendar answer behind `[n` and `]n`, unless the body
already holds a written `prev`/`next` (or `‹`/`›`) link.

Day, week, and quarter cards add a quieter group row below the step row,
from the same resolver as `[N` and `]N`: `⏮ Q3   ▮▮▮▮▮▮▮■▯▯   2027-Q1 ⏭`.
Each arm shows a skip mark and the group's name; its tooltip and accessible
name add the note it lands on (Monday of the next week, the first week of the
next quarter, or Q1 of the next year). The center is one tick per member:
accent for this note, filled for existing notes, hollow for missing ones. Its
tooltip spells the position (`Week 8 of 14 in quarter Q4`), and a one-member
group shows no ticks. Narrow panes keep `⏮ Q3 … 2027-Q1 ⏭`. Year cards have
no group row, and a role with two conflicting `«` or `»` links has no arm.

Every missing target uses one look. Dashed with `+` means not created yet:
activating it creates the note (dailies from the daily template, periods with
`bob periods ensure`) and opens it. Dotted and faint with `· not in vault`
means navigation never creates it, such as a target before Bob's period notes
began; it only shows its reason. Rail items and chips draw the state as a
box; group arms underline the name instead. Tooltips name the key and
destination (`]N · next quarter: 2027-Q1 → 2027-W01`).

Kicker, rail, and chip links open like the Markdown links they mirror: Mod
opens a tab or split, and a middle click opens a tab. With Bob Navigation
Hotkeys enabled, an unmodified rail prev or next runs its `open-prev-link` or
`open-next-link` command in the card's pane, and a group arm first confirms
the stop is unchanged, then runs `open-prev-group-link` or
`open-next-group-link`, so jump history matches `[n`, `]n`, `[N`, and `]N`.
If the stop changed, the card repaints and says
`The group stop changed — try again`. Cards repaint when calendar notes are
created, deleted, or renamed, and at midnight.

`parent` lives in the kicker and `type` is the tile. `intentions`, `summary`,
`reflection`, and `summary_drafted` (agent) mark the bands they actually
render. `created` lives in the foot; on a day, week, quarter, or year note a
missing `created` stays quiet (no stamp), and an invalid one shows an amber
stamp with the raw value kept in the drawer. Identity-only cards still carry
the foot. The drawer inventories every top-level key in file order — loose
keys, then **On this card** with those marks, then a folded **Managed**
group.

The foot follows the rail. The disclosure, `-` in Live Preview Vim normal
mode, and **Toggle card properties** (palette or Command Mode) toggle the same
drawer; open state is a per-note session toggle shared by every pane on the
note. `y` on a focused drawer row jumps to that key's exact YAML line. Painting
and toggling never spawn bob and never write the note.

### Hidden title lines

While the card owns the title, the inline title is hidden, and so is the
recognized source title block, at render time only. That block is the first
body H1 when it matches the date's shapes (`YYYY-MM-DD ddd`,
`Day: YYYY-MM-DD ddd`, `day = YYYY-MM-DD.ddd`), the first alias, or bob's
period title, plus the nav and child-link lines that follow it. In Live
Preview, placing the cursor on the hidden lines, or selecting into them,
reveals the raw Markdown for editing; moving away hides it again. Note bytes
never change, so heading links, the Outline, search, and `[n`/`]n` keep
working.

A note whose H1 is not recognized, such as the H1-less 2024 and 2025 dailies
and legacy year notes, keeps every body line visible and gets only the
derived rows. An unrecognized H1 or nav line stays visible as authored
content, and a nav line the card does not recognize (such as
`prev | day | next`) never gets a derived step row beside it.

### Set intentions

On current and future subjects with no intentions, one quiet dashed row
reads `＋ Set intentions` with a `==` keycap hint. A click or Enter opens the
card editor on the intention stage, and `==` opens it with Add selected. Past
subjects never show it, and it owns no Properties rows.

### Bands and owned rows

Below the title block, the parent intentions line and the intention,
summary, and reflection bands keep their content gates. A closed subject
with intentions, closed within the last seven days, shows a quiet missing
band (`✦ summary pending · ＋ reflection r`), omitting parts already present.
Open, future, or older subjects never show it.

Whole-frontmatter ownership is separate from title and individual-row
ownership. A mounted card and foot can replace the entire native Properties
block when valid source agrees with the metadata cache, the current bob
executable has confirmed `props_v1`, and property-editor routing is ready.
Identity-only day, week, quarter, and year cards qualify too. The `-` drawer
and `+` [Property Editor](property-editor.md) inventory every key;
**Add file property** opens that editor in Add mode on an owned note, and
the File Properties sidebar stays native.

When whole ownership is unavailable, the existing row fallback hides only
`intentions`, `summary`, `summary_digest`, `summary_drafted`, `reflection`,
`review_digest`, and `review_drafted`, and only while intentions, summary,
or reflection is nonempty. Identity-only cards hide no individual rows.
Invalid or stale source/cache evidence, uncertain capability, or failed
routing restores the native block. Source, file changes, failed mounts,
and unload release ownership. Painting reads metadataCache plus confirmed
source bytes, never spawns `bob`, and never writes the note.

### Fallback and fail-open

When the title slot is unavailable, or another writer keeps re-rendering it,
the card falls back to the body: after the H1 and nav lines, or before the
first body line of a note without an H1. A fallback card never owns the
title, so the note keeps its native title, H1, and nav lines plus the card.
Fallback clears on a file or mode change. Malformed values, Source mode,
embeds, hover popovers, mobile, plugin disable, and unload restore native
rendering: inline title, H1, nav line, and Properties.

## Provenance and ownership

Summary provenance uses the exact recipe in `bob periods`: CRLF and lone CR
to LF, trailing whitespace stripped per line, joined text trimmed, SHA-256
over UTF-8, first 16 lowercase hex characters prefixed `sha256:`. A matching
stamp renders `✦ agent · Nov 19`; any other nonempty summary renders
`✎ edited`. The writer — never YAML text edits — stamps provenance; summary
edits remove both stamps. Undo of a stamped summary restores its stamps via
the opaque `summary.restore` inverse op. The card and the card editor follow
the writer's reported `summary_state`, so that Undo shows `✦ agent` with its
restored date at once, and edited text never borrows an old digest.

All field writes preview then apply through `bob periods update <SUBJECT>`
with the server's field fingerprint in every envelope. Empty strings use
`unset`/`remove`, never invalid `.set`. Inverse ops stay opaque JSON.

## Card editor

`==` on any canonical subject opens the card editor, including empty or
malformed notes. Its header shows the card's leaf tile and species word. A
malformed field opens a refusal with YAML recovery; it never paints a display
card. Browse controls keep focus: the modal never
auto-focuses an input. Open subjects land on the first intention (or Add
when empty); closed subjects land on Reflection.

| Gesture | Result |
| --- | --- |
| j/k, arrows, Tab/Shift+Tab | Move selection |
| 1–9 | Select that intention |
| Enter | Edit selected row |
| i | Edit first intention, or Add if empty |
| o/O | Insert below/above selected intention |
| r | Open reflection textarea with caret at end |
| s | Select Summary; Enter explains ownership before opening its edit stage |
| Alt+J/K | Reorder the selected intention with the shared arrange animation |
| Ctrl+D | Remove selected intention, undoable |
| u | Apply guarded inverse-operation Undo |
| Esc/q/Ctrl+[ | One layer back: cancel a stage, discard a retained retry, then close |
| [ / ] | Previous/next sibling subject inside the same modal |
| = | Climb day → week → quarter → year |
| y | Open Source on the selected field (YAML excursion) |

Done on a YAML excursion validates with a fresh dry run. Invalid YAML or
malformed intentions keep Source open with a notice; a valid note returns to
the prior view and reopens the card editor on the same field.

The line under the rows always lists the browse keys; moving the selection never
replaces it, and an outcome such as Saved or Undone stays only until the next move
(`s` briefly explains Summary ownership). Stage keys stay text while a stage is
open; only explicit cancel or save
leaves the stage. Summary editing explains "agent drafted this; your edit
makes it yours" before the intentional edit. At four or more intentions the
card shows "Three is plenty — what can go?" without refusing. Pasted
newlines collapse to spaces with a quiet note. The Summary and Reflection
stages show the current summary read-only above the field; the reflection
textarea grows with its content, with Enter to save, Shift+Enter for a
newline, and Ctrl/Cmd+Enter to save and close. Clearing an existing intention
removes it, clearing summary or reflection unsets it, and a blank Add writes
nothing.

Typing `[[` in the intention, summary, or reflection field opens Bob
Navigation Hotkeys' LINK band under the field. Links resolve against the
note the card is on, so `[[#` and the nearby list follow `[` / `]` travel.
Typing `((` opens the same band in tasks mode; choosing an ID-less task opens
the in-band NAME step, whose explicit Enter names the task and inserts its block
link while keeping focus in the field.
While the band is open, it handles the keys first. Enter, Tab, or
Ctrl/Cmd+Enter inserts the selected row and never saves, and a held Enter
cannot insert and then save. In the reflection field, Shift+Enter still
types a newline. The first Esc or Ctrl+[ closes only the band; the next
one cancels the stage, and `q` still types. A repaint keeps the band, its
selection, and the caret. The band only inserts text. Without that plugin,
the fields type `[[` as plain text.
See [Wikilink completion in prompts](bob-navigation-hotkeys.md#wikilink-completion-in-prompts).

Every write awaits open Source panes for the pinned path first and carries
the server fingerprint. Writes, Undo, and retries share one busy window:
while one runs, keys, clicks, travel, and a second open wait, and the close
button closes the card only after the write settles. Superseded replies
after close or target change are ignored.

After an applied write, the card shows the written values at once, before
metadataCache catches up: a first intention adds its band, and removing the
last one removes the band while the card stays. This path-scoped overlay never shows a preview or
overrides a fail-open gate. It clears when matching metadata arrives,
survives metadata that still shows the prior state, is dropped by a later
conflicting edit, and expires on a bound.

## Missing notes, old bob, and stale writes

Missing dailies show "no note for Fri Nov 20 yet" with edits disabled; the
modal never creates notes implicitly. Missing periods point at
`bob periods ensure` to create the note, then reopen. An unsupported update
command shows "Update bob to edit intentions" while painting continues;
real validation failures surface as refusals and keep any draft.

A stale or save-blocked write keeps its operation and refreshes the list. An
open stage keeps the exact draft and follows its target. A remove or reorder
becomes a retry that names its target, found by text rather than old index
(`Enter removes “Read” (#3)`). Enter runs the reviewed retry; Esc, q, or
Ctrl+[ discards it. A target that disappeared or became ambiguous is refused,
and a timed-out write is reconciled the same way, never blindly retried.

## Yesterday

**Edit intentions** opens the card editor for the active canonical note.
**Reflect on yesterday** pins yesterday's daily note — resolved through the
daily-notes folder and format with local calendar arithmetic — and opens its
Reflection. Both commands appear in the palette, Command Mode, and the
non-Vim Ctrl+Shift+P fallback after task, Task Link, relation, dependency,
and direct-stage routes.

Two Vim compositions end with the caret in yesterday's reflection textarea
and never insert a literal `r` or write the wrong note: `[n==r` (previous
note, `==`, `r`) and `==[r` (`==`, `[` to yesterday inside the modal, `r`).
Fast stage selection during data loading stays pinned to its target.
