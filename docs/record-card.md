---
title: "Record Card"
description: "Reference for the record sheet and the Record Card editor on canonical album records."
---

Bob Ledger Tools paints a **record sheet** at the top of a canonical album
record's body (`type: [[record]]`) in Reading view and Live Preview. A legacy
first-level heading stays above the sheet until removed; notes without an H1,
including frontmatter-only notes, still show it at the top of the body. The
**Record Card** is the keyboard-first editor for those values.
When the sheet is hide-eligible — healthy schema, desktop Obsidian, and the
cached report carries `record_values_v1` — native Properties and the
filename-derived inline title hide behind the sheet. Every other case keeps
native Properties visible.

The sheet is desktop-only and reads the cached album report plus Obsidian
metadata. Opening, folding, or collapsing a record never requests a new
report and never writes the note. Source mode keeps native YAML.

## Record walk position

On a record with a recognized walk line and verified neighbor targets, the
`n` links footer shows the compact position, such as `Links 3/104`. Its tooltip
names the album and spells out the position. The count is derived from the
immediate Markdown children of the album folder; it is never written into the
record. If the stored neighbor targets disagree with the title order, the
footer shows `Links ⟳`; when the cached album report enables walk repair, the
plugin requests one album sync for that mismatch episode. Missing or damaged
walk lines do not show a numeric count.

## What the sheet shows

The sheet is a labelled group, *Title record details*. Its first row shows the
frontmatter `title` (trimmed), falling back to the first H1 and then the file
stem, in page-title styling. The muted album breadcrumb and noun follow on
their own line, then a definition list of schema fields in declaration order.
Title text is rendered literally. Choice values are chips; dates use today / yesterday or a friendly
date plus age; URLs are safe `http(s)` anchors; wikilinks are internal
links with hover previews. Empty optional fields sit in a shared `＋ Label`
ghost row. A missing required field keeps its full row and an amber
**missing** pill. Invalid values stay visible in monospace with a reason.

`parent` lives in the breadcrumb and `type` is implicit identity. The sheet is
the one home for the frontmatter `title`; H1 agreement or mismatch does not
create another title entry. A valid `created` date is a footer (`added today,
7:55 AM`, `added yesterday`, or `added Aug 8, 2025`).
An invalid created value stays in that fold with lint. Legacy keys declared
on the album are labelled **legacy**. `null` compact values render as `—`.

The sheet starts expanded. Collapse is a session toggle per record path:
the title stays visible, followed by one line with the breadcrumb, selected
choice chips (group field first), and `· N fields`. Fold and collapse choices
are not stored in frontmatter or plugin settings.

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
actions (choice picks, `t` today, clear, Undo, explicit suggestion picks)
apply one field operation with the current fingerprint. Typed values
preview through a 250ms debounced dry run; Enter stays latched until a
current preview succeeds, then applies exactly once.

Digits here pick a choice; on the album Schema Card they jump to field N.

### Browse keys

| Gesture | Outcome |
| --- | --- |
| `j` / `k`, arrows, Tab / Shift+Tab | Next or previous field, including ghosts. Tab wraps; Shift+J/K clamps. |
| Shift+J / Shift+K | Step to the adjacent schema field including ghosts, clamp at the ends with a bump and `No next field` / `No previous field`, and announce `<Label>, field N of M`. Inert in stages, inputs, menus, and IME; never writes. All actions offers Previous/Next field. |
| Home / End | First or last field. |
| Enter | Open the selected field's stage. |
| `1`–`9` on a choices row | Pick that schema-order choice and save. Elsewhere a digit does nothing and teaches `Digits pick a choice on choice fields`. |
| `t` on a date | Set today in the local calendar date. |
| Ctrl+D | Unset an optional field. Required fields refuse, for example `Status is required — pick one of 6 choices`. |
| `u` / Ctrl+Z | Undo the last save for this record path. |
| `y` / Ctrl+E | Close and open Source on the field's YAML line, with Done. |
| `=` | Close and open the parent album Schema Card on the same field, falling back to Album details. |
| Esc / `q` / Ctrl+[ | Close All actions, then the stage, then the card. `q` types only in text controls. |

### Stages

Stages expand inline under their field with labelled controls, combobox
and listbox relationships, visible focus, and text-only user strings.

| Stage | Behavior |
| --- | --- |
| Text | Auto-growing textarea. Pasted newlines are preserved for bob to refuse; Enter saves, never inserts a newline. |
| Suggest | Combobox over the full ranked `fields[].values` with rank and counts while filtering. Picking an existing suggestion applies it directly; free typing previews, including bob's `record_value_near` warning. Typing never implicitly picks. |
| Date | Text input accepting `today`, `t`, `yesterday`, and ISO. The parsed echo comes from bob's preview. Browse `t` keeps its direct route. |
| Number | Text input with numeric inputmode and schema min/max hints. Incomplete tokens are preserved for bob; no `parseFloat`, empty-to-zero, NaN, or clamping. |
| URL | Text/URL input with bob's validation and hint; no normalization of invalid URLs. |
| Link | Vault note suggester accepting a bare name or `[[wikilink]]`, resolved relative to the record with Obsidian metadata. Aliases, headings, and block anchors are preserved; picks preview before save. |
| List | Chip editor with a separate item input. Enter on a nonempty item adds it; Enter on an empty item saves the list. Empty-input Backspace removes the last chip; chips expose edit/remove. Order and literal commas are preserved; values submit as a JSON array. |

For list fields a choice or suggestion pick edits the list draft instead
of emitting a scalar `field.set`. Tab includes a nonempty pending list
item before preview so typed input is never lost. Scalar kind rules govern
each item.

Save, Save + next/previous, Cancel, and picker/list controls live in the
stage. Hints stay contextual; YAML stays available through its action.

### Save and advance

One changed field produces one operation. Explicitly empty optional
scalars and lists produce `field.unset`; a deliberately cleared required
field refuses with the teaching pattern and never applies. Tab and
Shift+Tab consume the key in every stage, including choices and
comboboxes: unchanged moves with no preview or write using wrapping
navigation; changed latches one advance with the current stage and draft
identity, waits for its current successful preview, applies once, then
advances only on success including no-ops. Refusal or stale ends the
pending advance and keeps the stage open. Editing, canceling, changing
field, closing, or starting composition invalidates it. A new stage starts
from the applied or read state, preserving the optimistic overlay and Undo.

### Refusals and retry

The status rule shows the loading line, the preview consequence, `✓ Saved
· u undo`, bob's refusal message and hint verbatim, and the stale line
`This record changed elsewhere — refreshed; your draft is kept · ↵
retry`. The complete stage draft, chip state, selected candidate, active
control, caret, and field identity survive record and album refreshes and
stale refusals. Queued saves are invalidated before rebasing; retry
schedules a fresh preview of the retained ops. A refreshed schema that
removes or changes the field, or a lost capability, stops the old write
intent with a teaching line while keeping the safe read-only and YAML
route. Focus and selection survive repaints; IME composition nodes are
never replaced. Cancel and close clear timers, preview drafts, queued Tab
intent, and listeners.

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

## Entry points

| Gesture | Outcome |
| --- | --- |
| `⊞ Edit` in the sheet header | Open the card (desktop plus capability; titled `Edit fields (==, Ctrl+Shift+P)`). |
| A sheet row | Open the card on that field. |
| A value chip, ghost chip, or missing pill | Open that field's stage directly. |
| `==` in Vim normal mode in Live Preview on a record | Open the Record Card; `N==`, register prefixes, Source mode, insert and visual modes, and non-record notes keep Vim's reindent. |
| `Ctrl+Shift+P` on a record where the Task Card has no target | Open the Record Card; tasks, links, and dependency rows keep priority. |
| **Edit record** palette command | Open the card; non-records say `Open a record note to edit its fields.` |
| Command Mode Vault row | Run **Edit record** through Obsidian's command route. |
| Collapse control | Session-collapse or expand this record's sheet. |
| Other-properties disclosure | Session-show or hide leftover keys. |
| `y` on a focused row, ghost, or fold row | Open this record in Source on that YAML key. |
| Open album YAML (broken schema) | Open the parent album in Source on the diagnostic line. |
| Breadcrumb / wikilink / URL | Ordinary Obsidian navigation and hover previews. |

Every affordance answers to click, Enter, and Space. A row click never
steals wikilink navigation, and `=` inside the card climbs to the parent
album's Schema Card.

## Fail-open

The sheet stays off when the note is not a canonical `[[record]]`, the
device is mobile, the album report is missing, metadata is missing, the
parent is missing, ambiguous, cyclic, or not an album, or the file is not
an immediate Markdown child of `<album-stem>/`. Bank months, mixed types,
legacy nouns, and Source mode keep their native surfaces.

A broken album schema still mounts a warning sheet with the diagnostic and
**Open album YAML**. Missing `record_values_v1` still mounts a healthy
read-only sheet; it does not enable editing or hide Properties. Embedded
sheets never hide Properties: the hide class applies only to the view's own
source-view or preview-view container, so embedded notes keep their own
Properties. The class is removed on file switch, type or parent change,
mode switch, view destroy, and plugin unload or disable.

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
