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

**⊞ Schema** opens the editable Schema Card in the Task Card idiom: album
label, record counts, the same chip rows, a lint banner, a staged-gesture
consequence line, and a footer of edit keys, `y`, and `esc`. Every gesture
dry-runs through `bob albums update` first and Enter applies only the exact
envelope whose dry run succeeded; the dry run paints bob's consequence,
affected and newly-invalid counts, and derived keys before Enter can apply,
and pending, error, or superseded responses never enable it. `u` previews
Undo of the last successful gesture and applies its inverse ops on a second
Enter; a stale fingerprint repaints instead of retrying, keeping the retained
draft unconfirmed and never silently rebasing it. Saved-local post-sync
failures offer **Retry sync**, which runs only `bob vault-sync` and never
replays the mutation. Defaults and numeric bounds edit through typed inputs
with explicit Unset, and choice edits change label and emoji while stored
values stay fixed. `y` from the card or a focused chip/lint row closes the
card and jumps to that field or issue line in Source mode. Bob's `issues[]`
paint as lint marks with their message and suggestions as text. The album's
`record` property is hidden only in that album's rendered Properties surface,
and stays editable in Source mode.

The card is keyboard-first with visible button equivalents for every
gesture: `↑`/`↓` (or `j`/`k`, `←`/`→` across choices) move, `Enter` edits the
selected row or applies a ready preview, `a` adds a field, `c` adds a choice,
`!` and `s` stage required/suggest toggles, `Alt+J`/`K` stage moves,
`Ctrl+D` stages removal, `y` jumps to Source, `u` previews Undo, and `Esc`
cancels a stage or closes from browsing. Typing inside inputs never triggers
navigation letters, and composition keystrokes never apply. Consequence and
refusal paint in a live region with accessible names on every control.

Open the card from the header's **⊞ Schema**, the **Edit album schema**
palette command, Command Mode's Vault row, or `Ctrl+Shift+P` on an album note
where the Task Card has no target. The palette command resolves the owning
album directly, or a record note's actual `parent:` link; missing, cyclic,
ambiguous, or non-album parents teach instead of guessing. An invalid album
still opens with its lint and the YAML path. A **Done** button rides along
into Source mode for that album's pane: it saves, forces a fresh report, and
only returns and reopens the card when Bob reports a valid schema, otherwise
staying put on the diagnostic line.

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
run the real CDP walkthrough with
`xvfb-run -a node scripts/obsidian-album-ui-e2e.cjs`. It covers owner chips,
group jump, folds, date chips, the collapsed header, property hiding, failure
and retry, cleanup, byte preservation, the debounced sync, and the Schema
Card walk: header, palette, record-parent, and album-fallback entry with
Task Card priority, keyboard-only edit and Undo, previewed apply with a
double-Apply guard, two-pane stale refusal, YAML Done with invalid repair,
and light/dark screenshots near 375 px. The writer wrapper proves the
preview/apply/Undo envelope, stale and used-removal refusals, typed
semantics, single-commit and linear-history guarantees, sync-only retry, and
source validation against the real writer in a scratch Git vault.
