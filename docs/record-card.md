---
title: "Record Card"
description: "Reference for the record card and its editor on canonical album records."
---

Bob Ledger Tools paints a **record card** (formerly the record sheet) in the
title slot of a canonical album record (`type: [[record]]`) in desktop Reading
view and Live Preview. When eligible, it replaces the in-document native
Properties block while keeping its DOM node as the title-slot anchor. The
**RECORD** kicker names the parent [album card](albums.md) and, once the
report arrives, the record noun; the sheet tile shows the album emoji else a
page icon. The title paints from local metadata before any report; fields
and ghosts join inside the same node, and the shared foot below the walk
rail carries the created stamp plus a `-` Properties cabinet with every frontmatter
key. Source mode, embeds, hover popovers, canvas, and mobile keep native
rendering. The **Record Card editor** is the keyboard-first editor for those
values.

For note-level loose properties, use the [Property Editor](property-editor.md).
Its role marks hand record fields back to this editor and keep identity or
derived values locked with a YAML escape.

Open or close the Properties cabinet with its **Properties** disclosure, `-` in Live
Preview Vim normal mode when the editor content has focus, the **Toggle card properties** palette
command, or the same Vault row in Command Mode. The command acts on the active
view and only when this card's foot is mounted there. Cabinet state is shared by
panes of the same note for the plugin session; reading properties never writes
the note. `=` remains the Record Card editor gesture.

Title ownership is independent of row hiding and whole-frontmatter ownership.
Whenever the card owns the title, the inline title and a matching first-body
H1 or walk line hide; a
Live Preview cursor on that line reveals the raw Markdown while the card and
its rail stay in the slot. Whole-frontmatter ownership requires a mounted
card and foot, valid source matching the metadata cache, confirmed `props_v1`
for the current bob executable, and working property-editor routing. The
Properties cabinet and `+` Property Editor inventory every key, including identity,
legacy, and unrelated values. **Add file property** opens the Property Editor
in Add mode on an owned note; the File Properties sidebar stays native.
See [native access and recovery](property-editor.md#native-properties-and-recovery).

If whole ownership becomes unavailable, native Properties returns with the
existing per-row fallback: only album-schema rows hide when the schema is
healthy and the cached report carries `record_values_v1`. Identity, legacy,
and unrelated rows remain native in that fallback. A failed mount or denied
context restores native rendering entirely. Opening the Properties cabinet, toggling
the foot, or collapsing a record never requests a new report and never
writes the note.

## Record walk position

On a record with a recognized walk line and verified neighbor targets, the
`n` links footer shows the compact position, such as `Links 3/104`. Its tooltip
names the album and spells out the position. The count is derived from the
immediate Markdown children of the album folder; it is never written into the
record. If the stored neighbor targets disagree with the title order, the
footer shows `Links ⟳`; when the cached album report enables walk repair, the
plugin requests one album sync for that mismatch episode. Missing or damaged
walk lines do not show a numeric count.

## Record walk rail

A recognized walk line becomes a rail under the record card in desktop Live
Preview and Reading view:

```text
‹ Pho House          🍽️ Eat · 3 of 104          Ramen Ya ›
```

The left and right links follow the destinations stored in the note. The
centre links to the album; its count is computed live in alphabetical title
order. A thin line in the card's root hue marks your location in the ring,
not task progress. At either end, `↺` and a tooltip announce the wrap. Two
records point both ways to each other. A singleton shows `1 of 1` with only
the album link and no track.

When the written neighbors disagree with the current album membership,
the count becomes `⟳` with “Record walk is syncing”. The links still follow
the written destinations. Missing or damaged lines stay as Markdown; a
frontmatter-only record has no rail. Rendering needs no cached album report
or CLI capability; automatic repair requests require `record_walk_v1`.
An arm rewritten by Obsidian after a rename or move is still recognized;
the rail shows `⟳` and requests one album sync, which rewrites the line.

When the album sets `walk_by`, the walk follows that field's groups, then
titles, and the rail adds a quieter group row in place of the location line:

```text
⏮ 🛑 Why SASE is still NOT ready?        ▮■▮        🏁 Conclusion ⏭
```

Each arm shows a skip mark and the neighboring group's name; its tooltip and
accessible name add that group's first record, and `↺` marks the wrap between
the last and first groups. The centre is one tick per member of the current
group, which the field's chip already names; its tooltip gives the group and
your place in it, and a one-member group shows no ticks. The count tooltip
becomes `By Section, then title · wraps around`. A plain click re-checks the
stop and runs the same commands as `[N` / `]N` in the card's pane; Mod-click
opens the head in a new tab. A head missing from the vault has a dotted
underline and `· not in vault` and only explains itself; navigation never
creates records. Below 28rem the row becomes `⏮ 🛑 Intro … 🏁 Conclusion ⏭`.
Ungrouped, single-group, and syncing walks keep the line.

Below 28rem the rail becomes `‹ 3/104 ›`, retaining full accessible names
and at least 32px link targets. Collapsing the card keeps the rail. Links
have visible keyboard focus and page previews. Ordinary arm clicks use the
same [navigation commands](bob-navigation-hotkeys.md) as `[n` / `]n`, including
jump history and bracket repeat. Mod-click and middle-click open new tabs;
missing records refuse navigation instead of creating an empty note.

The rail docks inside the card at its bottom, including while Live Preview
reveals a first-body walk line. Touching that line with any cursor or
selection shows the raw Markdown; the same card and rail stay mounted. A
walk line that is not first keeps in-place replacement. Source mode always
shows the original line. Reading view hides a first-body walk paragraph
through the title kit and restores it when ownership drops. Neither view
writes a count into the note. A moved walk line remains in its authored
position in Live Preview.

The isolated editor walkthrough covers both views, cursor reveal, wrap,
footer agreement, narrow layout, singletons, and the missing-target guard:

```bash
xvfb-run -a node scripts/obsidian-record-walk-e2e.cjs \
  -e /snap/obsidian/current/app/obsidian -r /tmp/record-walk.json
```

## What the record card shows

The card is a labelled group, *Record: Title*, with paper material and a
sheet tile. The kicker is `RECORD · <Album title link> · <noun>`. The title
is the frontmatter `title` (trimmed), then the first H1, then the file stem,
in page-title styling. Title text is rendered literally. Schema fields then
follow in declaration order. Choice values are chips; dates use today /
yesterday or a friendly date plus age; URLs are safe `http(s)` anchors;
wikilinks are internal links with hover previews. Empty optional fields sit
in a shared `＋ Label` ghost row. A missing required field keeps its full row
and an amber **missing** pill. Invalid values stay visible in monospace with
a reason.

`parent` lives in the kicker and `type` is implicit identity. The card is
the one home for the frontmatter `title`; H1 agreement or mismatch does not
create another title entry. `created` lives in the foot (`added today,
7:55 AM`, `added yesterday`, or `added Aug 8, 2025`); a missing `created`
shows a faint `no created date`, and an invalid one shows an amber stamp
with the raw value kept in the cabinet. The Properties cabinet inventories every
top-level key in file order — loose keys, then **On this card** with
`parent`→kicker, `type`→tile, `title`→title, and schema field marks, then a
folded **Managed** group — with duplicate keys as two linted rows. Legacy
keys declared on the album keep their **legacy** label. `null` renders as
`—`, empty strings and lists are labelled, and nested maps show a summary
with the species editor opener, never a YAML dump.

The foot follows the walk rail, outside the collapsible body, so the stamp
stays visible on identity-only, broken-schema, and collapsed cards. The
disclosure, `-` in Live Preview Vim normal mode, and **Toggle card
properties** (palette or Command Mode) toggle the same cabinet; open state is a
per-note session toggle shared by every pane on the note. `y` on a focused
cabinet row jumps to that key's exact YAML line. Painting, toggling, and
collapsing never spawn bob and never write the note.

The card starts expanded. Collapse is a per-path session toggle: title plus
choice chips (group field first) and `· N fields`. `_` folds it (`Toggle
record details (_)`). Cabinet and collapse state stay out of frontmatter and settings.

On a `subscriptions/*.md` record the existing subscription money line,
charge timeline, and finding sentence dock as a trailing band of this
card. Standalone subscription headers yield while the card owns the
path.

<a id="record-card"></a>
## Record Card editor

**Edit record** (`edit-record`) opens the editor on the active canonical
record. The header leads with a species badge: the album emoji (else a page
icon) in a folded-sheet tile, then **RECORD**. Title is `<record title>`;
subtitle is `<Album> › <Noun> · <path>`. Climbing with `=` to the album card
editor swaps the badge for the stacked **ALBUM** one. One selectable row exists for every schema
field, including a ghost row for each empty optional. Identity and leftover
keys stay read-only. The editor opens on a requested field, else the first
missing required field, else the first field, and stays open after saves.

Writes go through the guarded `bob records update` session. Discrete
actions (choice picks, `t` today, clear, Undo, explicit suggestion picks)
apply one field operation with the current fingerprint. Typed values
preview through a 250ms debounced dry run; Enter stays latched until a
current preview succeeds, then applies exactly once.

Digits here pick a choice; on the album card editor they jump to field N.

### Browse keys

| Gesture | Outcome |
| --- | --- |
| `j` / `k`, arrows, Ctrl+N / Ctrl+P, Tab / Shift+Tab | Next or previous field, including ghosts. Tab wraps; Shift+J/K clamps. |
| Shift+J / Shift+K | Step to the adjacent schema field including ghosts, clamp at the ends with a bump and `No next field` / `No previous field`, and announce `<Label>, field N of M`. Inert in stages, inputs, menus, and IME; never writes. All actions offers Previous/Next field. |
| Home / End | First or last field. |
| Enter | Open the selected field's stage. |
| Digit on a choices row | With fewer than 10 choices, one digit picks and saves. From 10 choices, the first digit opens the choices stage filtered to its code prefix; the next digit picks and saves. Elsewhere a digit does nothing and teaches `Digits pick a choice on choice fields`. |
| `t` on a date | Set today in the local calendar date. |
| Ctrl+D | Unset an optional field. Required fields refuse, for example `Status is required — pick one of 6 choices`. |
| `u` / Ctrl+Z | Undo the last save for this record path. |
| `y` / Ctrl+E | Close and open Source on the field's YAML line, with Done. |
| `=` | Close and open the parent album card editor on the same field, falling back to Album details. |
| Esc / `q` / Ctrl+[ | Close an open LINK band, then All actions, then the stage, then the editor. `q` types only in text controls. |

### Stages

Stages expand inline under their field with labelled controls, combobox
and listbox relationships, visible focus, and text-only user strings.
While a stage is open, its row and the stage form one accent-outlined
unit: the row stays the header and hides its value (the field already
shows the whole value), and the in-stage buttons shrink to Cancel and
Save. Save + next and Save + prev live on Tab, Shift+Tab, and All
actions.

| Stage | Behavior |
| --- | --- |
| Text | Soft-line field: one stored line that wraps across as many visual lines as it needs, grows to about six lines, then scrolls. Enter and Shift+Enter save; pasted line breaks fold to spaces with a quiet note. Long values clamp to three lines in the field list until opened. Typing `[[` opens the LINK band; `((` opens its tasks mode. |
| Suggest | Combobox over the full ranked `fields[].values` with rank and counts while filtering. Arrows or Ctrl+N / Ctrl+P step through candidates. Picking an existing suggestion applies it directly; free typing previews, including bob's `record_value_near` warning. Typing never implicitly picks. Typing `[[` or `((` opens the LINK band, which owns the arrows until it closes. |
| Date | Text input accepting `today`, `t`, `yesterday`, and ISO. The parsed echo comes from bob's preview. Browse `t` keeps its direct route. |
| Number | Text input with numeric inputmode and schema min/max hints. Incomplete tokens are preserved for bob; no `parseFloat`, empty-to-zero, NaN, or clamping. |
| URL | Text/URL input with bob's validation and hint; no normalization of invalid URLs. |
| Link | The whole value is one link. Typing a note name or `((` at offset 0 opens the LINK band; arrows or Ctrl+N / Ctrl+P move its rows, and Enter or Tab replaces the value with the selected note or task link. A second Enter saves once the band is closed. A bare name, `[[path]]`, `[[path#Heading]]`, `[[path#^block]]`, and `[[path\|Alias]]` are all accepted; an authored heading, block, or alias is kept. Candidates resolve relative to the record. Picks preview before save. |
| List | Chip editor with a separate item input. Enter on a nonempty item adds it; Enter on an empty item saves the list. Empty-input Backspace removes the last chip; chips expose edit/remove. Order and literal commas are preserved; values submit as a JSON array. Text-list items complete `[[` and `((` like the Text stage; link-list items complete like the Link stage. |

### Wikilink completion

The Text, Suggest, Link, and text or link List stages use the shared LINK band
from Bob Navigation Hotkeys (`proseField` v2; see
[Wikilink completion in prompts](bob-navigation-hotkeys.md#wikilink-completion-in-prompts)).
`((` offers task links alongside `[[` note links; the Link stage only opens task
completion when `((` begins the whole value. Picking an ID-less task opens NAME;
its explicit Enter writes the block ID and inserts `[[path#^id]]` without saving
the record field. Candidates resolve relative to the record note. Date, Number,
URL, and choice stages stay literal. While the band is open:

- Enter or Tab inserts the selected row and never saves or advances. With no
  rows, Enter closes the band and inserts nothing. A held Enter cannot insert
  and then save.
- Arrows and Ctrl+N / Ctrl+P move the band's rows. Suggest cycling and list
  Enter wait until the band closes.
- Esc / Ctrl+[ closes only the band; the next press backs out of the stage.
  `q` types.
- Shift+Enter in the Text stage closes the band and saves nothing.

The stage keeps its input element while you type, so the caret, IME
composition, the band, and one native Ctrl+Z after an insert all survive the
card's repaints. Completion only inserts text; it never writes the vault.
Without Bob Navigation Hotkeys, the stages are plain typing.

For list fields a choice or suggestion pick edits the list draft instead
of emitting a scalar `field.set`. Tab includes a nonempty pending list
item before preview so typed input is never lost. Scalar kind rules govern
each item.

Cancel, Save, and picker/list controls live in the stage; Save + next
and Save + prev live on Tab, Shift+Tab, and All actions. Hints stay
contextual; YAML stays available through its action.

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

While a typed value is being previewed, the status reads `Checking value…`;
`Saving…` is reserved for an apply or Undo in progress.
Enter, Tab, and Shift+Tab on a refused preview keep the refusal visible and
retain the draft without writing or advancing. Editing the draft requests a new
preview; the earlier refused save cannot apply that corrected draft.
The status rule shows the loading line, the preview consequence, `✓ Saved
· u undo`, bob's refusal message and hint verbatim, and the stale line
`This record changed elsewhere — refreshed; your draft is kept · ↵
retry`. The complete stage draft, chip state, selected candidate, active
control, caret, and field identity survive record and album refreshes and
stale refusals. Queued saves are invalidated before rebasing; retry
schedules a fresh preview of the retained ops. An external record change
also holds a dirty draft at this warning as soon as refresh detects it.
Background refreshes cannot dismiss the warning; Enter previews the retained
draft against the refreshed record, then Enter saves the current preview.
A refreshed schema that
removes or changes the field, or a lost capability, stops the old write
intent with a teaching line while keeping the safe read-only and YAML
route. Focus and selection survive repaints; IME composition nodes are
never replaced. Cancel and close clear timers, preview drafts, queued Tab
intent, and listeners.

### Choices

The choices stage is inline under its field. Filter by label or value
without changing stored identity. Every choice has a schema-order code; at
10 or more choices codes are zero-padded to the digit count (`01`–`17` for
17 choices). Badges stay in schema order and disappear for filtered-out
rows. `j`/`k` outside the filter, arrows and Ctrl+N / Ctrl+P (also inside
the filter), and Enter pick from the list. Bare digits in the filter type
choice codes and never become filter text. A pending code prefix narrows
the list and intersects with its text filter; Backspace removes one prefix
digit. A digit that matches no visible code teaches and writes nothing, and
a choice is picked only after its full code is typed. Empty results and the
current choice are explicit. Filter text never invents a choice.

### Read-only states

A healthy canonical record without `record_values_v1` opens read-only with
**Update bob to edit here** and never starts a writable session. A broken
album schema opens the editor with a warning, the album diagnostic, and the album
YAML route. Mobile, missing report, bad parent, and non-record notes never
guess a record target. The palette on a non-record says
`Open a record note to edit its fields.`

### Undo and YAML

Undo memory is per record path for the plugin session, so reopening the
editor can still undo. YAML Done saves the record pane, restores the previous
view, and reopens the editor on the same field. Record findings never block
Done.

## Entry points

| Gesture | Outcome |
| --- | --- |
| `⊞ Edit` in the card header | Open the Record Card editor (desktop plus capability; titled `Edit fields (=, Ctrl+Shift+P)`). |
| A card row | Open the editor on that field. |
| A value chip, ghost chip, or missing pill | Open that field's stage directly. |
| `=` in Vim normal mode in Live Preview on a record | Open the Record Card editor; counted `N=`, register prefixes, Source mode, insert and visual modes, and non-record notes keep Vim's `=`. |
| `Ctrl+Shift+P` on a record where the Task Card has no target | Open the Record Card editor; tasks, links, and dependency rows keep priority. |
| **Edit record** palette command | Open the editor; non-records say `Open a record note to edit its fields.` |
| Command Mode Vault row | Run **Edit record** through Obsidian's command route. |
| Collapse control / `_` | Session-collapse or expand this record card. |
| Properties disclosure (`Toggle properties (-)`) | Session-show or hide every frontmatter key in the Properties cabinet. |
| `-` in Vim normal mode in Live Preview | Toggle the Properties cabinet; counts, registers, operator-pending keys, Source mode, insert and visual modes, views without a mounted foot, and focus outside the editor content keep Vim's `-` motion. |
| **Toggle card properties** (palette or Command Mode) | Toggle the Properties cabinet. |
| `y` on a focused row, ghost, or cabinet row | Open this record in Source on that YAML key. |
| Open album YAML (broken schema) | Open the parent album in Source on the diagnostic line. |
| Breadcrumb / wikilink / URL | Ordinary Obsidian navigation and hover previews. |

Every affordance answers to click, Enter, and Space. A row click never
steals wikilink navigation, and `=` inside the editor climbs to the parent
album's card editor.

## Fail-open

The card stays off when the note is not a canonical `[[record]]`, the
device is mobile, the album report is missing, metadata is missing, the
parent is missing, ambiguous, cyclic, or not an album, or the file is not
an immediate Markdown child of `<album-stem>/`. Bank months, mixed types,
legacy nouns, and Source mode keep their native surfaces.

A broken album schema still mounts a warning card with the diagnostic and
**Open album YAML**. Missing `record_values_v1` still mounts a healthy
read-only card; it does not enable editing or hide Properties. Embedded
cards never hide native rows. Hiding belongs only to the view's own Properties
rows, including replacements after a tab switch. File, type, parent or mode
changes, view destruction, and plugin unload or disable restore those rows.

## Write machine

Record edits go through `bob records show` and `bob records update -i -` only.
The plugin never calls `processFrontMatter`. A record session wraps the shared
guarded update session with opt-in direct apply (`applyOps`), saves every pane
showing the record or its album, and replays Undo from `inverse_ops` with
`expect` set to `fingerprint_after`. A successful apply suppresses the writer's
own album-sync echo and pushes an optimistic card overlay for at most 5s, or
until metadataCache matches the applied properties.

Identity fields (`parent`, `type`, `title`, `created`) stay uneditable here.
BOM notes refuse with `record_uneditable` and keep every byte; CRLF notes keep
their newlines.

See [Album cards](albums.md) for owner catalogs, generated indexes, and the
album card editor.
