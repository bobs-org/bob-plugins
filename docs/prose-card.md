---
title: "Prose Card"
description: "Reference for the quiet prose title card: identity, measures, outline, and keys."
---

Bob Ledger Tools paints a **prose card** — a quiet title page — at the top
of a prose note (`type: [[prose]]`, including the legacy `[[article]]`
spelling) in desktop Reading view and Live Preview. When eligible, it
replaces the in-document native Properties block. The **PROSE** kicker names
the parent crumbs; the folio tile holds the title's initial (or the pilcrow
icon). The title reads `title:`, then the first alias, then the verbatim
file stem; the optional one-line `summary:` dek shows in italics. Absence
of a dek is normal: no ghost, no nag.

When the file stem supplies the title, its tooltip says `Title from the file
name — press = to set one`. The title uses Bob Prose's heading face only
while that plugin's look class is active. The `§` chip runs Bob Prose's
**Toggle section numbers** command, which flips `section_numbers` through
bob in one undoable edit; the chip is inert only when Bob Prose is absent,
disabled, or older. It reads local `section_numbers`: an absent key or
`true` is numbered, `false` is unnumbered, and other values show a warning.
The foot carries the
authored `created` stamp and the Properties drawer.

The measure row comes from Bob Prose's read-only `api.prose` v1 snapshot.
The card uses Bob's word total, rounds it to the nearest 10 below 1,000 and
the nearest 100 from 1,000 up, and estimates reading time at 230 words per
minute. It shows the exact section count and counts only stub sections with no
deeper section as `N to write`; an umbrella heading with written subsections
is not counted. Missing parts are omitted rather than shown as zero. Word
counts are approximate because they include heading text.

If Bob Prose is absent, disabled, or exposes an older API, the card stays
identity-only and hides the measure row. With API v1 loaded, the row reserves
its height while a snapshot is pending. A refusal shows Bob's message instead
of empty measures. The foot lint chip counts Bob's findings. The card is folded
by default; `_` or a `to write` chip expands a bounded outline, followed by
findings. Outline rows show Bob's number only when numbering is on, the
de-numbered title, and `≈ words` or `to write`. A jump checks Bob's saved line
against the current buffer heading, then pairs by order with metadata-cache
headings if the line no longer matches. Findings jump to their reported lines.

The card never computes counts, numbers, or stubs, starts Bob, or writes the vault.

## Keys

In Live Preview Vim normal mode, `=` focuses `title` (Add mode prefilled
when missing), `+` opens the Property Editor, `-` toggles the drawer, and
`_` folds the outline. The card owns only the inline title: every body
heading is a numbered section and stays visible. Painting never spawns bob
and never writes the vault. Source mode, embeds, hover, canvas, print,
mobile, uncertain evidence, failed mounts, and unload keep or restore
native Properties.
