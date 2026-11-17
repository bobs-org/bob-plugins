---
title: "Record Card"
description: "Reference for the record sheet and the Record Card editor on canonical album records."
---

Bob Ledger Tools paints a **record sheet** directly under the first heading
of a canonical album record (`type: [[record]]`) in Reading view and Live
Preview. The **Record Card** is the keyboard-first editor for those values.
Native Properties and the filename-derived inline title stay visible in this
phase.

The sheet is desktop-only and reads the cached album report plus Obsidian
metadata. Opening, folding, or collapsing a record never requests a new
report and never writes the note. Source mode keeps native YAML.

## What the sheet shows

The sheet is a labelled group, *Title record details*, with the album
breadcrumb and noun, then a definition list of schema fields in declaration
order. Choice values are chips; dates use today / yesterday or a friendly
date plus age; URLs are safe `http(s)` anchors; wikilinks are internal
links with hover previews. Empty optional fields sit in a shared `＋ Label`
ghost row. A missing required field keeps its full row and an amber
**missing** pill. Invalid values stay visible in monospace with a reason.

`parent` lives in the breadcrumb and `type` is implicit identity. A title
that matches the heading is the heading; a mismatch, or a title with no
heading, appears in **N other properties**. A valid `created` date is a
footer (`added today, 7:55 AM`, `added yesterday`, or `added Aug 8, 2025`).
An invalid created value stays in that fold with lint. Legacy keys declared
on the album are labelled **legacy**. `null` compact values render as `—`.

The sheet starts expanded. Collapse is a session toggle per record path:
breadcrumb, selected choice chips with the group field first, then
`· N fields`. Fold and collapse choices are not stored in frontmatter or
plugin settings.

On a `subscriptions/*.md` record the existing subscription money line,
charge timeline, and finding sentence dock as a trailing band of this
sheet. Standalone subscription headers yield while the sheet owns the
path.

## Record Card

**Edit record** (`edit-record`) opens the card on the active canonical
record. Title is `<album emoji> <record title>`; subtitle is
`<Album> › <Noun> · <path>`. One selectable row exists for every schema
field, including a ghost row for each empty optional. Identity and leftover
keys stay read-only. The card opens on a requested field, else the first
missing required field, else the first field, and stays open after saves.

Writes go through the guarded `bob records update` session. Discrete
actions apply one field operation with the current fingerprint. Typed
editors for text, date, number, URL, link, and list fields arrive in a
later phase.

### Browse keys

| Gesture | Outcome |
| --- | --- |
| `j` / `k`, arrows, Tab / Shift+Tab | Next or previous field, including ghosts. |
| Home / End | First or last field. |
| Enter | Open the selected field's stage. Choices open the pick list; other kinds teach that YAML is the available edit route. |
| `1`–`9` on a choices row | Apply that schema-order choice. |
| `t` on a date | Set today in the local calendar date. |
| Ctrl+D | Unset an optional field. Required fields refuse, for example `Status is required — pick one of 6 choices`. |
| `u` / Ctrl+Z | Undo the last save for this record path. |
| `y` / Ctrl+E | Close and open Source on the field's YAML line, with Done. |
| `=` | Close and open the parent album Schema Card. |
| Esc / `q` / Ctrl+[ | Close All actions, then the stage, then the card. `q` types in the filter input. |

### Choices

The choices stage is inline under its field. Filter by label or value
without changing stored identity. Digit badges stay in schema order and
disappear for filtered-out rows. `j`/`k` outside the filter, arrows, and
Enter pick from the list; digits in the filter stay text. Positions past
nine remain reachable by navigation and click. Empty results and the
current choice are explicit. Filter text never invents a choice.

### Read-only states

A healthy canonical record without `record_values_v1` opens read-only with
**Update bob to edit here** and never starts a writable session. A broken
album schema opens a warning card with the album diagnostic and the album
YAML route. Mobile, missing report, bad parent, and non-record notes never
guess a record target. The palette on a non-record says
`Open a record note to edit its fields.`

### Undo and YAML

Undo memory is per record path for the plugin session, so reopening the
card can still undo. YAML Done saves the record pane, restores the previous
view, and reopens the card on the same field. Record findings never block
Done.

## Gestures still on the sheet

| Gesture | Outcome |
| --- | --- |
| Collapse control | Session-collapse or expand this record's sheet. |
| Other-properties disclosure | Session-show or hide leftover keys. |
| `y` on a focused row, ghost, or fold row | Open this record in Source on that YAML key. |
| Open album YAML (broken schema) | Open the parent album in Source on the diagnostic line. |
| Breadcrumb / wikilink / URL | Ordinary Obsidian navigation and hover previews. |

Sheet Edit, row/chip clicks, `==`, Command Mode, and `Ctrl+Shift+P` still
do not open the card. Those entry points land with the Properties hide in
a later phase.

## Fail-open

The sheet stays off when the note is not a canonical `[[record]]`, the
device is mobile, the album report is missing, metadata is missing, the
parent is missing, ambiguous, cyclic, or not an album, or the file is not
an immediate Markdown child of `<album-stem>/`. Bank months, mixed types,
legacy nouns, and Source mode keep their native surfaces.

A broken album schema still mounts a warning sheet with the diagnostic and
**Open album YAML**. Missing `record_values_v1` still mounts a healthy
read-only sheet; it does not enable editing or hide Properties.

## Write machine

Record edits go through `bob records show` and `bob records update -i -` only.
The plugin never calls `processFrontMatter`. A record session wraps the shared
guarded update session with opt-in direct apply (`applyOps`), saves every pane
showing the record or its album, and replays Undo from `inverse_ops` with
`expect` set to `fingerprint_after`. A successful apply suppresses the writer's
own album-sync echo and pushes an optimistic sheet overlay for at most 5s, or
until metadataCache matches the applied properties.

Identity fields (`parent`, `type`, `title`, `created`) stay uneditable here.
BOM notes refuse with `record_uneditable` and keep every byte; CRLF notes keep
their newlines.

See [Album cards](albums.md) for owner catalogs, generated indexes, and the
Schema Card.
