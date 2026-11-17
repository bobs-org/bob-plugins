---
title: "Album cards"
description: "Live album counts, record-index folds, date chips, an expanded schema header, and repair controls in owner and album notes."
---

Bob Ledger Tools decorates the generated `[!albums]` catalog in area and project
notes in Reading view and Live Preview. The card takes its accent from the owner's
root area, like the notebook catalog. Project group rows remain headings; only
resolved album links receive chips. Source mode keeps editable Markdown.

Each album row shows its total record count, the first nonempty group in the
schema's declared order (for example **🔖 11 to try**), and an age since the latest
valid record **created** date. The age tooltip says **Last added**; it does not
claim when a restaurant was visited or a movie watched. Chips wrap beneath the
summary in narrow panes.

Hover or focus the group chip to peek at up to three record titles. Click it, or
press Enter or Space, to open that album at the group's generated list row. Ctrl
or Command opens a tab; adding Shift opens a split. Ordinary album links retain
Obsidian navigation and hover previews. Navigation Hotkeys records the group jump
in its jump history when installed. If the group is absent or ambiguous, Bob
opens the Records region and explains how to refresh it.

Counts come from the shared `bob albums list -f json` report. While a refresh runs,
cached counts stay visible with a status message. A failed read offers **Retry**;
missing data is never displayed as zero records. Empty albums still show a real
zero from the report.

A missing or stale generated catalog/index offers **Sync albums**, which shares
one operation across panes. Buttons disable while it runs. Damaged regions and
invalid schemas retain Bob's diagnostic and suggestions for manual repair; sync
cannot fix a schema. A missing catalog offers its action beside the owner's
Albums heading or title, with a body anchor when neither exists.

Painting, peeking, navigation, and day-rollover age refreshes do not change note
bytes. **Sync albums** explicitly invokes Bob's existing writer. Relevant
frontmatter edits also use the shared service's three-second sync debounce.

The generated `[!records]` index on an album note keeps Bob's tally, group
order, subgroup labels, facets, links, and empty-album teaching line. The first
top-level group starts expanded. Later groups start folded only when they hold
more than twelve **records** (the group's stored count, not its subgroup
headings). Fold choices stay in that pane's view state, keyed by album and
group, so a refresh keeps them and a second pane of the same album starts from
the defaults. A group jump from an owner card expands that group in the
destination pane before it scrolls.

Each record row may show age chips from cached `visited` and `watched_on`
frontmatter. Both dates, when valid, appear with their own **Visited** and
**Watched** tooltips. Missing, invalid, and future dates stay off the row.
Chips refresh when that metadata changes and at local midnight. Folding,
peeking, and date chips never rewrite the note.

On the subscriptions album, the generated `[!records]` index still stores
raw category keys and plain amount/cadence numbers. The plugin paints
category subgroup headings with the bank emoji and label (`💻 Tech & AI`),
formats amount plus cadence as `$9.99 a month`, and adds a quiet
`next ≈ Dec 21` chip from `bob bank subscriptions -f json`. Each
`subscriptions/*.md` record shows a header strip with the same money line,
a 12-dot charge timeline, and any finding as a sentence. A `bob-bank` fence
with `view: subscriptions` on `subscriptions.md` draws the album summary
card: monthly and yearly estimates labeled as an estimate of commitments,
not bank spend, status counts, the top five by monthly equivalent, and the
findings count. Unknown `bob-bank` views stay quiet. None of these surfaces
write the note.

Album notes also show a breadcrumb from their resolved area/project ancestry
and an expanded-by-default schema summary in Reading view and Live Preview.
The summary names the schema, field count, dated notes, and index grouping.
Chip rows show by default, one per field in declaration order: human labels,
kind and flag suffixes, required as a quiet `*`, choice chips with usage
counts, grouping annotations, and muted `legacy` chips. The summary's `▾`
toggle collapses them for the session. Collapse state lives
in view state keyed by the album, never in frontmatter. An invalid schema
paints the first diagnostic on the summary and expands to the lint list; an
empty schema teaches how to add fields so `Name @stem/` can collect facts.
The two states never impersonate each other.

**⊞ Schema** opens the editable Schema Card in the Task Card idiom: one title
line (`🍽️ Restaurant`), a truncated breadcrumb, and the album details row as
the header subtitle and selectable **Album details** target. Field rows use
pills for `required`, kind, and grouping, choice chips carry a count pill
(faded at zero), and `+ choice` / `+ field` are dashed add targets. A lint
banner, a one-line status rule (hidden when empty), and a contextual hint
strip sit below. The strip shows only keys valid for the current selection,
wrapping to at most two lines, with `⋯` opening an **All actions** list so
every gesture keeps a visible button equivalent. Previews run automatically
as you type; there is no **Preview this edit** button. Stage buttons are
**Save ⏎** (enabled when the current preview can apply, or while Enter is
latched) and **Cancel esc**.

Every gesture dry-runs through `bob albums update` first and Enter applies
only the exact envelope whose dry run succeeded. If ⏎ arrives while that
revision's preview is still running, the card latches: it paints **Saving as
soon as bob confirms…** and applies when that preview succeeds. Any further
edit clears the latch. The dry run paints bob's consequence, affected and
newly-invalid counts, and derived keys in the status rule before Enter can
apply, and pending, error, or superseded responses never enable it until the
latch's matching preview succeeds. `u` previews Undo of the last successful
gesture and applies its inverse ops on a second Enter; a stale fingerprint
repaints instead of retrying, keeping the retained draft unconfirmed and
never silently rebasing it. Saved-local post-sync failures offer **Retry
sync**, which runs only `bob vault-sync` and never replays the mutation.
Defaults and numeric bounds edit through typed inputs with explicit Unset,
and choice edits change label and emoji while stored values stay fixed. Choice
edit/add and each initial choice in a new choices field use the shared Emoji
Slot: type the label, Tab to the square glyph well, then press Enter, Space,
or ↓ to open its in-card picker. Search filters as you type; an empty query
offers label matches, emoji used in your albums, shared recents, and category
tabs. Arrow keys move the highlight in two dimensions; Enter picks without
saving the schema stage, Tab leaves without picking, and the first Esc closes
only the picker. A live chip previews the stored token, and a small dot marks
an emoji already used by another choice in the same field. Pasted emoji,
including ZWJ sequences and flags, stay byte-for-byte; digit keycaps are
accepted when pasted with a note because Bob stores a leading digit keycap as
label text. If Bob Emoji v1 is unavailable, the glyph well falls back to a
plain input with an enable-search hint. `y`
from the card or a focused chip/lint row closes the card and jumps to that
field or issue line in Source mode. Bob's `issues[]` paint as lint marks with
their message and suggestions as text. The album's `record` property is
hidden only in that album's rendered Properties surface, and stays editable
in Source mode.

The card keeps typed stage drafts, choice rows, focus, and caret through its
debounced previews; adding or removing a staged initial choice never loses
other row edits. Undo carries the fingerprint from the successful apply, so
an intervening schema edit leaves the inverse draft unconfirmed until an
explicit rebase.

Reorders arrange locally and save as one envelope. `Alt+J`/`K` (or
`Alt+↑`/`↓`/`←`/`→`, matched by `event.code` so macOS Option never inserts
`∆`/`˚`) nudge the selected field or choice one slot, `Alt+Shift+J/K` jump to
the first or last slot, a count prefix such as `4Alt+K` repeats the nudge, and
`m` (or `Alt+M`) opens Move to… gap badges (`a`–`z`, two characters past 26
gaps) where typing a badge drops the item. Moved rows keep an accent ring and
a delta badge (`↑4`, `↓2`), position changes animate with 140 ms FLIP
(`prefers-reduced-motion` disables it), and a polite live region announces
“label, position X of N”. While moves are pending the hint strip becomes a
pending bar such as `↕ 1 move · 🔍 label 15 → 11 · ⏎ save · esc revert ·
u step back`; other gestures are unavailable and flash that bar.

Adding a choice or field shows a dashed ghost chip or row at its landing slot:
`Alt+J`/`K` (with `Shift` for ends, matched by `event.code` so nothing is typed
into the stage) slide it while focus stays in the inputs, `Alt+M` opens Move
to… gap badges, and the single `choice.add`/`field.add` carries the placement
as its `position` — still one op and one commit. Pointer drag arranges with
the same engine: a ⠿ grip appears on hover and focus at a chip's or row's
leading edge, dragging lifts the item and paints a 2 px insertion caret, the
card autoscrolls near its edges, a drop outside the item's scope shows a
not-allowed caret and snaps back, and `Esc` cancels the drag. Drops call the
same `placeAtGap` and one-envelope save pipeline as the keys.

`Enter` saves the whole arrangement through the unchanged guarded session:
it compiles `field.move`/`choice.move` ops, simulates them to prove the
projection, and previews once. Quiet arrangements save on the first `Enter`;
loud ones (index grouping changed, any newly-invalid count, or warnings)
paint amber with bob's consequence and need a second `Enter` (or **Confirm
save**). A pending preview latches `Enter`; any further move clears the
latch. Saves run in the background with a shimmer: the card stays navigable
and follow-on moves compile after the apply settles without ever calling
`setDraft` mid-apply. Success paints `Saved · u undo` (fading after ~3 s)
and records one commit with one Undo; refusals keep the arrangement pending
with a red rule. `u` steps back one local move while moves are pending and
otherwise stages Undo of the last save; `esc` leaves hint mode, then reverts
pending moves (nothing was written), then cancels a stage, then closes.
Closing during a save is allowed: the plugin-level apply finishes, an
Obsidian Notice reports “Album schema saved” (or the refusal), and a
reopened card offers Undo when its fresh fingerprint equals the saved
`afterFingerprint`.

The card is keyboard-first with visible button equivalents for every
gesture (on the hint strip, or under `⋯`): `↑`/`↓` (or `j`/`k`, `←`/`→`
across choices) move selection, `Enter` edits the selected row or saves a
pending arrangement (latching while that revision's preview is pending),
`a` adds a field, `c` adds a choice, `!` and `s` stage required/suggest
toggles, `Alt+J`/`K` (with `Shift` for ends, counts, and `m` gaps) arrange,
`Ctrl+D` stages removal, `y` jumps to Source, `u` steps back or previews
Undo, and `Esc` closes the All actions list, then cancels an open stage,
then leaves hint mode, then reverts pending moves, then closes from plain
browsing through one dispatch that survives Obsidian's capture-phase close;
an open Emoji Slot panel closes before the stage or pending arrangement.
Typing inside inputs never triggers
navigation letters, and composition keystrokes never apply. Consequence and
refusal paint in a live region with accessible names on every control.

Open the card from the header's **⊞ Schema**, the **Edit album schema**
palette command, Command Mode's Vault row, or `Ctrl+Shift+P` on an album note
where the Task Card has no target, including its title or a blank row. The
chord fallback resolves direct album notes only. The palette command resolves
the owning album directly, or a record note's actual `parent:` link; missing, cyclic,
ambiguous, or non-album parents teach instead of guessing. An invalid album
still opens with its lint and the YAML path. A **Done** button rides along
into Source mode for that album's pane: it shares a pending save across clicks,
checks pane identity after each asynchronous step, forces a fresh report, and
only returns and reopens the card when Bob reports a valid schema. Navigation,
pane close, or unload during save/report/restore abandons the excursion without
reopening a stale card; invalid schemas stay on the diagnostic line.

On Obsidian mobile the summary and chips still render from last-good album
data with an edit-in-YAML hint. The Schema button and write gestures are
absent.

The **＋ noun** button copies the exact `Name @stem/` capture starter for the
album. It does not open capture or create a record. Invalid schemas or capture
routes leave the header visible and disable the button with the report's
reason. Owner links use resolved note paths; incomplete or cyclic ancestry
shows only confirmed links. The breadcrumb ends at the top-level area; an ancestry
warning appears only when a parent link cannot be resolved, is malformed, cycles,
or exceeds the depth cap.

For stored album/record structure and capture routes, see
[Records](https://bobs-org.github.io/records/).

## Verification

The offline wrappers `scripts/test-obsidian-album-ui-e2e.cjs` and
`scripts/test-obsidian-album-schema-writer-e2e.cjs` are part of `npm test`;
run the real CDP walkthrough with an explicitly verified Bob binary:
`BOB_BIN=/path/to/bob xvfb-run -a node scripts/obsidian-album-ui-e2e.cjs -e /snap/bin/obsidian -r /tmp/album-schema.json -o /tmp/album-schema-shots`.
Its JSON report records Bob's path and version. Run the writer acceptance with
`BOB_BIN=/path/to/bob node scripts/obsidian-album-schema-writer-e2e.cjs --self-test`.
The wrappers report their real-Bob checks as skipped when `BOB_BIN` is absent.
The walkthrough covers owner chips,
group jump, folds, date chips, the schema header, property hiding, failure
and retry, cleanup, byte preservation, the debounced sync, and the Schema
Card walk: header, palette, record-parent, title-row album fallback with
Task Card priority, keyboard-only edit and Undo, previewed apply with a
double-Apply guard, two-pane stale refusal, YAML Done with invalid repair,
async Done navigation/unload guards, and light/dark screenshots near 375 px. The writer wrapper proves the
preview/apply/Undo envelope, stale and used-removal refusals, typed
semantics, single-commit and linear-history guarantees, sync-only retry, and
source validation plus stale-Undo refusal against the real writer in a scratch Git vault.
