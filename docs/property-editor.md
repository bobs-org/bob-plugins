---
title: "Property Editor"
description: "Keyboard reference for viewing and editing a note's YAML properties through Bob."
---

The **Property Editor** opens on any existing Markdown note. It reads the note's
property report from `bob props show` and sends every edit through the guarded
`bob props update` writer. Opening, browsing, and painting rows never writes the
note. The modal groups properties by ownership, keeps duplicate source lines
separate, and preserves Bob's source order within each group. Keyboard movement,
range selection, and filtering follow the visible grouped rows.

## Open the editor

- In Live Preview Vim normal mode, type `+` (Shift+`=` on a US keyboard, or
  an unshifted `+`). The key works on any Markdown note when the editor
  content has focus. Counts, registers, operator-pending keys (including a
  pending `=`), Source mode, insert and visual modes, and non-Markdown notes
  keep Vim's `+` motion.
- Run **Edit note properties** from the Command Palette or Command Mode.
- Press Enter on a focused row in a card's `-` Properties drawer.
- On a card that owns the in-document Properties block, run Obsidian's
  **Add file property** command (normally Mod+`;`, or your custom binding)
  to open this editor directly in Add mode.
- Sibling plugins can call the Bob Ledger Tools plugin method:

  ```js
  const ledgerTools = app.plugins.plugins["bob-ledger-tools"];
  await ledgerTools.openPropertyEditor({
    filePath: "Projects/roadmap.md", // optional; defaults to the active note
    key: "status",                   // optional initial row
    setting: "clock",                // optional setting id (aliases like theme map too)
    focusSettings: true,             // optional: land on the first settings row
    mode: "browse",                  // browse, edit, or add
  });
  ```

An explicit `filePath` wins over the active note. The editor refuses missing
files and non-Markdown targets. `mode: "edit"` opens the requested loose
property's value stage or hands a card property to its owner. A checkbox stays
selected so opening the editor never flips it as a side effect.
`mode: "add"` starts the property-name stage. A `setting` request selects that
settings row once the report arrives, even when the setting is a ghost; a raw
caller key such as `theme`, `offclock`, or `offclock_types` maps onto its
logical setting in browse mode. On a degraded report the request selects the
corresponding real property when present, otherwise a safe first row.

On area and project notes, `==` and the card Settings control open the editor
on the first settings row; a policy chip opens it on its own setting. `+`
opens the editor on any Markdown note: on `bank.md` it shows the area
settings, while `==` there keeps opening the bank card editor.

## Ownership and rows

Bob's `note_kind`, property kind, role, owner, editor, reason, source lines, and
fingerprint decide what each row can do.

| Group | What it contains | Enter |
| --- | --- | --- |
| Area/Project settings | Typed settings in Bob's contract order (summary, lives under, hue, default type, clock, caps, review, capture names; projects add stats root) | Open that setting's control |
| On the `^prj` line | Project goal, starts, and depends-on navigation rows | Open the current project task's Task Card |
| Loose | Values with no other Bob owner, including `created` | Edit the value here |
| On the `<Kind>` card | Fields owned by a record, album, bank, or day/period card | Hand off to that card's `==` editor |
| Identity | Note identity such as `type`, or a project `status` | Locked, except project `status`, which navigates to `^prj`; `y` opens YAML |
| Bob-managed | Derived and generated values | Locked with Bob's writer/reason; `y` opens YAML |

Locked rows stay locked for every action, including delete and type-specific
gestures. Unknown ownership is also locked until Bob reports a role. A card
field on a note without that card's editor explains the route instead of
pretending to edit it here.

## Area and project settings

On area, project, and bank notes with a current `props_contract_v1` report,
the editor groups typed settings before ordinary properties. Area and bank
notes show **AREA SETTINGS** (summary, lives under, hue, default type, clock,
ready cap, review, capture names); projects show **PROJECT SETTINGS** (lives
under, hue, default type, clock, stats root, ready cap, review, capture
names). Each row names its label, YAML keys, and effective or declared value,
with `set` only when the note declares it. `theme` merges into Default type
and both clock keys merge into Clock, so those source entries never appear
again as loose rows.

A ghost — a setting the note does not declare — is faint and italic but
legible, and shows Bob's effective label and help. A missing required parent
is a warning, never an inherited value. Ready cap and Review point at the Bob
setting rather than parent inheritance; Default type `off` stops parent
defaults and an explicit grey stays a mute.

Enter on a ghost opens an override draft seeded from the reported effective
value; opening never writes. Dedicated saves go through `setting.set` and
Ctrl+D clears through `setting.clear`, each dry-run first with the candidate
contract's effective label and `effects` rendered inline so a clear explains
what will apply and where it comes from. Every accepted batch is one undoable
history item, and the confirmed post-apply contract replaces the rows — a
candidate preview never leaks into cards or overlays.

Summary edits one line in a wrapping soft-line field with a live `N/140`
count (pasted line breaks fold to spaces with a quiet note; Bob warns
past 140 without blocking). Ready cap is a count stepper from 1 to 999
or `off` (`o` toggles in the control). Review takes 1–365 days and applies to
tasks living in the note. Capture names reuse the ordered List stage with
Bob's duplicate and collision warnings. Stats root toggles between `true` and
absence, and stays disabled on top-level projects. Parent, hue, default type,
and clock reuse generic stages for now, with Bob validating; a logical clock
value is always submitted as the strict mode object, and generic edits to an
actual clock key use that key's `prop.*` op.

Settings and project-task rows cannot be renamed, reordered, or kind-changed.
Copying a declared setting copies its actual source bytes; copying a ghost is
a no-op with a teaching message. Batch deletion maps declared settings to
`setting.clear` ops and refuses a mixed protected selection as a whole.

Projects add **ON THE `^PRJ` LINE**: goal, starts, and depends-on rows that
navigate to the current `^prj` task's Task Card. A missing or archived task
reports absence without creating anything; project `status` navigates only.
Navigation never writes task fields or frontmatter dates. The collapsed
Bob-managed group keeps its count, with source rows, writer labels, and YAML
access on expand; template stays editable and retired counts stay deletable
with their explanation, while `done_tasks` offers its archive link.

Without `props_contract_v1`, the editor renders the landed generic properties
with **Update bob for typed settings**. Without `props_v1`, cached rows stay
read-only with YAML recovery. Malformed YAML, duplicates, missing
fingerprints, and unresolved ownership keep their existing safety behavior.

## Browse keys

These keys act while browsing the rows, not while typing in a value field.

| Keys | Action |
| --- | --- |
| `j` / `k`, ↑ / ↓, Ctrl+N / Ctrl+P | Move to the next or previous row |
| `g`, Home / `G`, End | Select the first or last row |
| Enter / `l` | Edit a loose value (maps and opaque values open the YAML stage), flip a loose checkbox, or hand off a card field |
| `o` / `O` / Mod+; | Add below, above, or at the end |
| `r` | Rename the focused property |
| `t` | Change this value's kind, with a separate vault-type confirmation |
| Alt+J / Alt+↓, Alt+K / Alt+↑ | Move the focused property down or up in source order |
| Ctrl+D / Mod+Backspace | Delete marked rows together, or the focused row |
| Space | Mark or unmark the focused row for batch actions |
| `V` | Start or stop a visual range; `j` / `k` extend it |
| Shift+↑ / Shift+↓ | Extend a selection range |
| `/` | Open the incremental key and value filter |
| `u` / Ctrl+Z | Undo the latest successful property edit |
| Ctrl+R / Ctrl+Shift+Z | Redo the latest undone edit |
| `y` / Ctrl+E | Open the property's YAML line in Source mode |
| Mod+C / Mod+V | Copy marked properties or the focused property; paste a YAML mapping |
| `=` | Open the note's owning `==` card editor when one is available; on an area or project note, focus the settings group in place |
| Esc / `q` / Ctrl+[ | Back out one layer, then close |

`q` follows Esc's layer and types only in a text control. Ctrl+[ is Esc's alias
and never types in a field. A stage or add-name draft is canceled one layer at a
time; it is not silently committed.

The marks gutter shows selection separately from the focused row. Space toggles
one row; `V` marks a visual range from the current row, and `j` / `k` extend it.
Pressing `V` again keeps those marks and returns to ordinary movement. Opening
the filter does not clear marks by itself. Changing its query resets marks and
the range anchor, so rows hidden by a filter cannot remain selected for deletion.
Enter or ↓ in the filter returns focus to matching rows; with no matches, the
editor announces the empty result and keeps a stable keyboard target. Esc clears
the filter layer before closing the editor. The All actions menu exposes these
gestures, rename, kind conversion, source-order moves, YAML editing, and batch
deletion; reorder actions are disabled while a filter query is active.

Ctrl+D / Mod+Backspace deletes marked rows together as one undoable update. With
no marks, it deletes the focused visible row. A selection containing a card,
identity, derived, or unresolved property is refused as a whole and names the
locked rows; the editor never partially deletes a mixed selection.

`r` opens an inline name stage seeded with the current key. The current name is
excluded from the local duplicate check; a same-name save is a no-op. Bob still
refuses a destination that would be card-owned, identity, or derived, even when
that name is not on the note, and the typed draft stays for correction. A
successful rename keeps focus and any mark on the renamed key without dropping
other marks.

Alt+J / Alt+K (and Alt+↓ / Alt+↑) move only the focused property relative to its
neighbor in the full source inventory, not the grouped or filtered row list.
Leading comments travel with the entry through `prop.move`. Marks stay for later
batch actions. A protected row cannot itself be moved; a protected neighbor may
still be a position reference. Source-order boundaries, an open stage, a pending
write, and an active filter query are no-ops or refusals; held-key repeats do
not queue extra writes. A successful move announces the new source position,
keeps the row visible, and plays a 120 ms row slide unless reduced motion is
requested.

## Value and add stages

Loose values use a stage suited to Bob's reported kind: multiline Text, Number,
Date, Date & time, ordered List, Tags, Aliases, or the YAML stage for maps and
other exotic values. A loose checkbox flips immediately. Tags are stored without `#`; list and alias order is retained.
Date & time accepts `now`, local times such as `9:41pm`, weekdays such as
`fri`, relative dates such as `-3d`, and valid ISO values. Invalid or ambiguous
input remains visible for correction.

As a value changes, the editor waits 250 ms and asks Bob to preview that exact
write. Save applies only the matching successful preview. Open panes are saved
before apply. A stale refusal keeps the draft and rereads the report before a
retry. A lost or timed-out write is treated as unknown; the editor does not
blindly repeat it. Successful writes show `Saved · u undo` and update the
editor, cards, and drawer through a short-lived confirmed overlay.

The add-name stage suggests property names from the vault with their known
type and usage count. Tab or Enter accepts the highlighted suggestion and its
type. Shift+Enter keeps the typed name as a text property. New names are
checked locally and again by Bob for duplicates and valid YAML syntax. The
name and value are written together; canceling either stage writes nothing.

Undo and redo history is session-only, kept per normalized note path, and
bounded to 20 writes in each direction. Closing and reopening the editor keeps
that history for the session. A successful new edit clears redo.

## YAML value stage

Enter on a loose map (or any other loose value without a typed stage) opens a
multiline YAML stage seeded with that key's exact source bytes, including block
scalar chomping and nested flow content. The All actions menu offers **Edit
value as YAML** for any other loose value, so typed values can also be edited
as raw YAML. Opaque values (anchors, aliases, merge keys, custom tags) open
for inspection with a diagnostic; saving one is refused by Bob with
`prop_opaque`, and the draft is kept.

The draft builds exactly one `prop.set_yaml` op and previews through the same
250 ms Bob dry-run as every other stage; Bob's error and hint show verbatim.
Plain Enter inserts a newline, Mod+Enter saves through the current preview
latch, and Esc cancels the stage without closing the modal or applying the
draft. Multiline editing keeps caret, composition, and native text undo. Stale
reports keep the draft and require a new preview, and one save is one undoable
batch. `y` / Ctrl+E still mean the Source-mode excursion, and card maps still
route to `==`.

## Source fragments (read-only)

Copying and the inline YAML value stage read through a read-only source
adapter, never through a reconstructed note. The adapter returns the
source-ordered entries with their exact byte spans, attached leading trivia,
and a `valueYaml` fragment suitable for `prop.set_yaml`. Block entries keep
their original bytes; root flow mappings are reassembled with only the
necessary braces and commas. Anchors, aliases, merge keys, and custom tags
stay explicitly opaque: copying one is refused with the YAML escape rather
than flattened. Clipboard text decodes through the same adapter and accepts
exactly one mapping, optionally wrapped in one frontmatter delimiter pair;
fences, note bodies, extra documents, duplicate keys, and non-mapping roots
are refused. The snapshot reader checks the note path, source, and report
inventory against each other with bounded retries, refuses unsaved panes
without saving, and stops on cancellation. Every write still goes through
Bob's guarded `prop.set_yaml` preview and session flow.

## Copy and paste

Mod+C copies marked properties in file order, or the focused property when
nothing is marked. Copy uses validated source bytes, including comments
attached to each property; it never reconstructs YAML from the displayed value.
Read-only properties can be copied. An opaque or ambiguous source selection is
refused with the `y` YAML escape, and clipboard permission failures leave the
note untouched.

Mod+V reads one YAML mapping from the clipboard and opens a review stage. Each
incoming key is labelled **New**, **Replace** with its old and proposed value,
or **Skipped** with the ownership or opacity reason. Bob dry-runs new keys to
resolve ownership; invalid YAML, invalid values, damaged frontmatter, and
transport failures block the proposal. The complete editable set is previewed
against the current fingerprint. Enter applies only that exact preview as one
undoable update. A stale preview keeps the clipboard draft and requires a new
confirmation; an uncertain write is never repeated. An all-skipped paste has
no enabled apply action.

## YAML escape and recovery

Press `y` / Ctrl+E on a property to jump to its source line in YAML. **Done**
returns to the prior view and reopens the editor on the same property. Maps,
opaque values, invalid or unclosed frontmatter, and duplicate keys use this
escape for repair; Bob never authorizes a write against a damaged or ambiguous
frontmatter mapping.

When Bob is too old to report `props_v1`, cached rows remain visible and edits
are disabled with **Update bob to edit properties here — y opens YAML**. An
empty note says **No properties yet — o adds the first**. Invalid YAML shows
Bob's diagnostic and source-line target. Once a capable Bob report arrives,
the current report—not cached metadata—authorizes mutations.

The editor supports viewing, value edits, add, rename, source-order reorder,
delete, undo/redo, ownership hand-off, YAML return, multi-select, filtering,
batch deletion, YAML copy/paste, and kind conversion.

## Kind conversion

`t` opens a conversion stage on a loose property. It shows the current kind
and value, destination types (text, number, checkbox, date, date & time, list,
tags, aliases, and map/YAML), and a preview of the converted value. Safe
scalar conversions, a single text value to a one-item list, and validated
date/datetime tokens convert through the existing parsers. Ambiguous or
destructive conversions keep an editable field instead of guessing. Null,
empty, false, and zero stay distinct; list order is preserved; tags and
aliases stay key-specific. Map and opaque values convert through the YAML
stage. Bob infers kind from the stored YAML, so a date-looking string written
as text is still reported as date.

Note-local conversion writes `prop.set` with the supported kind, or
`prop.set_yaml` via the YAML stage, through the standard preview, apply, and
history flow. It never changes the vault's property type. Converting
`created` to datetime warns that Obsidian's datetime widget can strip
offsets; Bob still preserves the stored offset style.

**Change vault property type** is a separate action in the same stage. The
editor feature-detects `app.metadataTypeManager.setType` and counts distinct
notes that contain the key. Confirmation names the key, proposed type, and
note count, then rechecks both before applying. A missing, throwing, or
unusable manager explains how to use All Properties and makes no global
change. Vault type mutation is not a property undo token: `u` undoes this
note's value, not the vault type. Local conversion and the vault confirmation
are separate submissions. Changing the vault type does not rewrite other
notes' values. The editor never writes `.obsidian/types.json` itself.

## Native Properties and recovery

Album, record, day, week, quarter, and year cards can replace the entire
in-document native Properties block in desktop Live Preview and Reading.
This requires a mounted card and foot, a valid closed frontmatter mapping
that matches the metadata cache, confirmed `props_v1` for the current bob
executable, and working native-command routing. Identity-only temporal cards
qualify. The foot's `-` drawer and this editor expose every top-level key;
`==` still opens the species editor. The drawer's Enter, Add property, and
Edit all actions also open this editor.

Obsidian's **Add file property** command routes to Add mode only while the
originating document actually owns its Properties block. The palette,
default shortcut, and custom bindings share that route. A failed opener
releases ownership before falling back to Obsidian's native action. Native
property-focus helpers likewise use the editor for an owned document and
keep native focus elsewhere.

The **File Properties sidebar** remains available for native editing even
when the document card owns Properties. Metadata Menu's native Properties
context menu is unavailable on the hidden in-document block; use the native
sidebar or Source when you need native access. Bank retains its native
Properties block alongside its foot and drawer. Ordinary notes, Source,
embeds, hover popovers, canvas, print, and mobile never acquire whole-block
ownership.

Unknown or absent capability, malformed or unclosed YAML, duplicate keys,
source/cache disagreement, and failed routing leave the native block
available. Losing whole ownership returns to the card's existing per-row
hiding; losing the card or entering a denied context restores native
rendering entirely. Navigation and plugin disable/unload release ownership.
Hidden controls cannot receive focus, and the native DOM node stays in place
as the card's title-slot anchor. Painting and drawer toggles never launch
bob or write the note; capability discovery happens separately on lifecycle
events. See the [ownership architecture](https://bobs-org.github.io/develop/plugins/architecture/#frontmatter-ownership).

The current Vim family is `==`, `-`, and `+`. The former `=-` and `=+`
chords fall through to Vim; Reading uses the disclosure and commands.

## Native Properties parity

How each native Properties action maps to the editor. Everything below is
covered by the disposable-vault real-Obsidian acceptance run
(`scripts/obsidian-property-editor-e2e.cjs`).

The same run loads `scripts/obsidian-property-editor-e2e-settings.cjs` for the
area/project contract matrix: `+`, `==`, Settings, and policy-chip focus;
ghost override, clear, undo, and redo; Stats root and project-task navigation;
managed and loose-row parity; capability fallback; and light/dark, wide/narrow
captures of populated settings and the Summary stage.

| Native Properties action | Property Editor | Notes |
| --- | --- | --- |
| Add property | `o` / `O` / Mod+`;`, or All actions | Name and value are written together; Tab accepts the known type |
| Edit value | Enter / `l`, or the typed value stage | 250 ms Bob dry-run; Save applies only the matching preview |
| Rename | `r` | Bob refuses card-owned, identity, and derived destinations; same-name is a no-op |
| Delete | Ctrl+D / Mod+Backspace, marked rows as one batch | A mixed protected selection is refused as a whole with the locked rows named |
| Reorder | Alt+J / Alt+K (Alt+↓ / Alt+↑) | Keyboard-only; leading comments travel; disabled while a filter query is active |
| Select | Space, `V` range, Shift+↑ / Shift+↓ | Marks live in a separate gutter; filter-query edits reset marks |
| Copy / paste | Mod+C / Mod+V with a New / Replace / Skipped review | One guarded undoable batch; opaque selections are refused, never flattened |
| Property kinds | `t` conversion stage, map kinds through YAML | Safe conversions preview; ambiguous ones keep an editable field |
| Global property types | Separate **Change vault property type** confirmation | Names the key, type, and affected-note count; never implicit |
| Nested maps and YAML | Inline YAML value stage (Enter on a map, or All actions) | Seeded from exact source bytes; Mod+Enter saves through the preview latch |
| Protected and opaque rows | Locked rows; `y` opens YAML | Identity, derived, and opaque values are never written from the editor |
