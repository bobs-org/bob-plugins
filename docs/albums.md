---
title: "Album cards"
description: "Live album counts, group peeks, last-added ages, and repair controls in owner notes."
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

For stored album/record structure and capture routes, see
[Records](https://bobs-org.github.io/bob/records/).
