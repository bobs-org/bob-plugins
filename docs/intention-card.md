---
title: "Intention Card"
description: "Reference for the intention card and its editor on daily and period notes."
---

Bob Ledger Tools paints an **intention card** at the top of canonical daily
and period notes in Reading view and Live Preview. The **card editor** is the
keyboard-first editor for those values.

## Where the card appears

The card appears only on canonical subjects: `YYYY/YYYYMMDD.md` daily notes,
`YYYY/YYYY-Www.md` weeks, `YYYY/YYYY-Qn.md` quarters, and `YYYY.md` years,
with Bob's ISO-week quarters and ISO week-year. `all_time` and non-canonical
notes never qualify. Year has no editable parent.

The card needs at least one nonempty intention, summary, or reflection, valid
values (intentions is an array of nonempty one-line strings; summary is a
one-line string; reflection is a string), desktop Obsidian, and Reading or
Live Preview. Empty notes, Source mode, embeds, popovers, and mobile keep
native Properties visible.

Placement skips the H1, navigation lines, and direct-child link lines, then
inserts before the first unrelated block: above the daily `^gtd` line and
above period strip fences. The mount owns exactly seven keys —
`intentions`, `summary`, `summary_digest`, `summary_drafted`, `reflection`,
`review_digest`, `review_drafted` — and releases them on failure, mode
change, file change, and unload. Unrelated Properties stay visible, and the
card never spawns `bob`: painting reads metadataCache plus confirmed source
bytes and fails open.

A closed subject with intentions, closed within the last seven days, shows a
quiet missing band (`✦ summary pending · ＋ reflection r`), omitting parts
already present. Open, future, or older subjects never show it.

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
malformed notes. A malformed field opens a refusal with YAML recovery; it
never paints a display card. Browse controls keep focus: the modal never
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

Stage keys stay text while a stage is open; only explicit cancel or save
leaves the stage. Summary editing explains "agent drafted this; your edit
makes it yours" before the intentional edit. At four or more intentions the
card shows "Three is plenty — what can go?" without refusing. Pasted
newlines collapse to spaces with a quiet note. The Summary and Reflection
stages show the current summary read-only above the field; the reflection
textarea grows with its content, with Enter to save, Shift+Enter for a
newline, and Ctrl/Cmd+Enter to save and close. Clearing an existing intention
removes it, clearing summary or reflection unsets it, and a blank Add writes
nothing.

Every write awaits open Source panes for the pinned path first and carries
the server fingerprint. Writes, Undo, and retries share one busy window:
while one runs, keys, clicks, travel, and a second open wait, and the close
button closes the card only after the write settles. Superseded replies
after close or target change are ignored.

After an applied write, the card shows the written values at once, before
metadataCache catches up: a first intention mounts the card and removing the
last one removes it. This path-scoped overlay never shows a preview or
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
