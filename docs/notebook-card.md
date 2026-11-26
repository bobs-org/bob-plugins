---
title: "Notebook Card"
description: "Reference for the notebook title card: identity, sections, children, and keys."
---

Bob Ledger Tools paints a **notebook card** in the title slot of a notebook
(`type: [[notebook]]`) in desktop Reading view and Live Preview. When
eligible, it replaces the in-document native Properties block and the linked
notebook header wherever it mounts. The **NOTEBOOK** kicker names the
notebook's crumbs, and the spine tile carries the pickers' `notebook-tabs`
icon. The title follows the notebook rule (eligible opening H1, first alias,
humanized stem); a matching H1 hides at render time. The `summary:` scope
line shows in full when present; a missing summary shows a quiet
`＋ Add summary` ghost that opens focus-or-add on `summary`.

The readout line below the summary shows the direct note count and the
newest authored `[created::]` date when the shared notebook report has
arrived; while folded it also names the section count. Missing report data
is omitted, never zeroed. Section chips jump to their `##` headings: past
eight, a `+N` chip reveals the rest for the session, and a heading the
report no longer matches stays inert until the report catches up. Child
notebooks open like crumbs. Hard errors show a visible pill that jumps to
the first error line; warnings join the foot lint chip. The kit foot
carries `created` (silent when missing), the quiet `@stem` capture route
(click copies), and the Properties drawer, where zorg importer keys fold
under Managed.

## Keys

In Live Preview Vim normal mode, `==` focuses `summary` (Add mode
prefilled when missing), `+` opens the Property Editor, `-` toggles the
drawer, and `_` folds the card's details. The card paints from local data
and the shared report; painting never spawns bob and never writes the
vault. Source mode, embeds, hover, canvas, print, mobile, uncertain
evidence, failed mounts, and unload keep or restore native Properties and
the header.
