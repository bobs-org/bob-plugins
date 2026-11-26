---
title: "Ref Card"
description: "Reference for the ref title card: identity, provenance, reading state, and keys."
---

> [!warning] Preview — not yet enabled
> Ref Cards are under acceptance review. The live-vault preview gate stays off until
> that review is complete. Native Properties remain visible until the `props_v1`
> evidence allows the card to own them. The note's ordinary title remains when a
> matching opening H1 cannot be adopted.

Bob Ledger Tools can paint a **Ref Card** at the top of a library reference in desktop
Live Preview and Reading view. A note qualifies when it has exactly the `ref` type and
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

Reading state comes from one shared `bob ref list` snapshot. It will patch the lane,
Today marker, annotation counts, reread version, identifiers, and diagnostics into the
card's existing slots. A missing or stale report leaves the local identity card intact.
The preview build reserves the readout area only when the note declares PDF or audio;
it never invents reading progress or annotation counts.

## Keys and takeover

In Live Preview Vim normal mode, `==` focuses or adds `title:`. `+` opens the ordinary
Property Editor, `-` opens the Properties drawer, and `_` compacts the card to its
kicker and title. The Reference editor will replace the title fallback when Bob reports
the `props_ref_contract_v1` capability.

The card paints only when the Ref Card preview gate is enabled and the note passes the
Ref species and library-path checks. It replaces the ordinary title only when a matching
opening H1 can be adopted. Native Properties are hidden separately, and only while the
generic `props_v1` source and ownership checks pass; uncertain metadata or ownership
keeps native Properties visible. The managed reading-task embed remains visible below
the card as its editable control. Painting, folding, and resizing never spawn Bob or
write the note or PDF.
