---
title: "Album cards"
description: "Live album counts, record-index folds, date chips, a collapsed schema header, and repair controls in owner and album notes."
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

Album notes also show a breadcrumb from their resolved area/project ancestry
and a collapsed-by-default schema summary in Reading view and Live Preview.
The summary names the schema, field count, dated notes, and index grouping.
Expanding it shows one chip row per field in declaration order: human labels,
kind and flag suffixes, required as a quiet `*`, choice chips with usage
counts, grouping annotations, and muted `legacy` chips. Collapse state lives
in view state keyed by the album, never in frontmatter. An invalid schema
paints the first diagnostic on the summary and expands to the lint list; an
empty schema teaches how to add fields so `Name @stem/` can collect facts.
The two states never impersonate each other.

**⊞ Schema** opens a read-only Schema Card in the Task Card idiom: album
label, record counts, the same chip rows, a lint banner, and a footer of
navigation keys, `y`, and `esc`. The card has no write gestures. `y` from the
card or a focused chip/lint row jumps to that field or issue line in Source
mode. Bob's `issues[]` paint as lint marks with their message and suggestions
as text. Schema edits remain YAML or a later Schema Card editor; this surface
does not change note bytes. The album's `record` property is hidden only in
that album's rendered Properties surface, and stays editable in Source mode.

On Obsidian mobile the summary and chips still render from last-good album
data with an edit-in-YAML hint. The Schema button and write gestures are
absent.

The **＋ noun** button copies the exact `Name @stem/` capture starter for the
album. It does not open capture or create a record. Invalid schemas or capture
routes leave the header visible and disable the button with the report's
reason. Owner links use resolved note paths; incomplete or cyclic ancestry
shows only confirmed links.

For stored album/record structure and capture routes, see
[Records](https://bobs-org.github.io/records/).

## Verification

The offline wrapper `scripts/test-obsidian-album-ui-e2e.cjs` is part of
`npm test`; run the real CDP walkthrough with
`xvfb-run -a node scripts/obsidian-album-ui-e2e.cjs`. It covers owner chips,
group jump, folds, date chips, the collapsed header, property hiding, failure
and retry, cleanup, byte preservation, and the debounced sync.
