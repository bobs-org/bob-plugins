---
title: "Record Card"
description: "Reference for the read-only record sheet on canonical album records."
---

Bob Ledger Tools paints a read-only **record sheet** directly under the first
heading of a canonical album record (`type: [[record]]`) in Reading view and
Live Preview. Native Properties and the filename-derived inline title stay
visible. Editing, hiding Properties, and the Record Card dialog arrive in a
later phase.

The sheet is desktop-only and reads the cached album report plus Obsidian
metadata. Opening, folding, or collapsing a record never requests a new
report and never writes the note. Source mode keeps native YAML.

## What it shows

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

## Gestures

| Gesture | Outcome |
| --- | --- |
| Collapse control | Session-collapse or expand this record's sheet. |
| Other-properties disclosure | Session-show or hide leftover keys. |
| `y` on a focused row, ghost, or fold row | Open this record in Source on that YAML key. |
| Open album YAML (broken schema) | Open the parent album in Source on the diagnostic line. |
| Breadcrumb / wikilink / URL | Ordinary Obsidian navigation and hover previews. |

There is no Edit control in this phase. Values and ghosts are not clickable
editors. `==`, the command palette, Command Mode, and `Ctrl+Shift+P` are
unchanged.

## Fail-open

The sheet stays off when the note is not a canonical `[[record]]`, the
device is mobile, the album report is missing, metadata is missing, the
parent is missing, ambiguous, cyclic, or not an album, or the file is not
an immediate Markdown child of `<album-stem>/`. Bank months, mixed types,
legacy nouns, and Source mode keep their native surfaces.

A broken album schema still mounts a warning sheet with the diagnostic and
**Open album YAML**. Missing `record_values_v1` still mounts a healthy
read-only sheet; it does not enable editing or hide Properties.

See [Album cards](albums.md) for owner catalogs, generated indexes, and the
Schema Card.
