---
title: "Ref Card"
description: "Reference for the ref title card: identity, provenance, reading state, and keys."
---

Bob Ledger Tools paints a **Ref Card** at the top of a library reference in desktop
Live Preview and Reading view. Native Properties remain visible until the `props_v1`
evidence allows the card to own them. The note's ordinary title remains when a
matching opening H1 cannot be adopted. A note qualifies when it has exactly the `ref` type and
lives under `ref/`; root `*_ref` hubs, mixed types, `ref_history/`, asset folders,
templates, and conflicts stay untouched. The `ref` species follows the shared card
precedence rules, so another card that owns the note keeps control.

## Identity

The ribbon tile carries the icon for the reference kind. The **REF** kicker names the
kind and links to its parent crumbs in the root hue. The title uses `title:`, then the
first body H1, then a humanized filename stem. The card hides an H1 only when its text
matches the card title; a different H1 remains in the note body. An optional one-line
`summary:` appears as a short dek.

The byline shows each available fact independently: `author:`, the host from
`source_url:` (or legacy `url:`), the `published:` date at its written precision, and
an `agent report` label when `agent:` is present. Unsafe or non-HTTP source URLs are
omitted. Missing facts do not leave placeholder labels or zeros.

The foot shows `created:` or, when that is absent, `captured:`. The Properties drawer
keeps every YAML key in source order. Reference identity and sync-owned values, such as
`id`, `ref_type`, `source_pdf`, `source_pdf_sha256`, `highlights_*`, `pipeline_version`,
`source_markdown`, and legacy provenance, are grouped under **Managed**. Citation
fields remain ordinary note-local properties.

## Access and reading state

When `source_pdf:` names a safe vault-relative PDF, **PDF** opens it through the
Highlights API on macOS when available, and through Obsidian elsewhere. The **Listen**
button opens a declared companion `audio:` file through Obsidian. Neither action builds
a shell command from frontmatter.

Reading state comes from one shared `bob ref list` snapshot. It patches the lane,
Today marker, annotation counts, reread version, identifiers, and diagnostics into the
card's existing slots. A missing or stale report leaves the local identity card intact.
The card reserves the readout area only when the note declares PDF or audio;
it never invents reading progress or annotation counts.

## Keys and takeover

In Live Preview Vim normal mode, `=` opens the Reference editor: the shared Property
Editor on Bob's `REFERENCE` settings contract when Bob reports the
`props_ref_contract_v1` capability, else focus-or-add on `title:`. `+` opens the
ordinary Property Editor, `-` opens the Properties drawer, and `_` compacts the card
to its kicker and title.

The Reference editor holds six editable rows — Title, Summary, Authors, Published,
Source, and Aliases — each with Bob's validation and a previewed, undoable
`bob props` write. Title also retitles a matching first-body H1 in the same atomic
write, syncs marker-held fields to the PDF marker at the next writing scan, and names
the reading task's unchanged link text with a jump to it. Three owned-elsewhere rows
stay read-only with Bob's reason: Reading and Lives under open the reading task (a
legacy note without one says so instead), and File name opens Command Mode while
copying `bob ref rename <stem> <NEW>`. Adding, removing, reordering, or retyping
fields — and any edit to `id`, `status`, `parent`, `ref_type`, pointers, hashes, or
`pipeline_version` — is refused, as are PDF writes, scans, task creation, and bundle
moves. `y` stays the YAML escape; Esc, `q`, and Ctrl+`[` back out of stages and close
the editor.

The card paints when the note passes the
Ref species and library-path checks. It replaces the ordinary title only when a matching
opening H1 can be adopted. Native Properties are hidden separately, and only while the
generic `props_v1` source and ownership checks pass; uncertain metadata or ownership
keeps native Properties visible. The managed reading-task embed remains visible below
the card as its editable control. Painting, folding, and resizing never spawn Bob or
write the note or PDF.

The [Reading Board](https://bobs-org.github.io/ref/#reading-board-in-obsidian) uses
the same lane and kind words for the reading queue. For loose properties, use the
[Property Editor](property-editor.md); for sibling title cards, see
[Notebook Card](notebook-card.md), [Prose Card](prose-card.md), and
[Area and Project Cards](area-and-project-cards.md).
