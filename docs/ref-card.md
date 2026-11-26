---
title: "Ref Card"
description: "Reference for the ref title card: identity, provenance, reading state, and keys."
---

> [!warning] Preview — not yet enabled
> The Ref Card is under acceptance review and stays off in the live vault
> until the preview gate opens. Native Properties and the plain H1 render as
> today until then.

Bob Ledger Tools paints a **ref card** at the top of a library reference
note (exact `type: "[[ref]]"` under `ref/`) in desktop Live Preview and
Reading view. When eligible, it replaces the in-document native Properties
block and hides a matching first-body H1. The **REF** kicker names the kind
and the parent crumbs; the ribbon tile carries the kind's Lucide icon from
the shared ref vocabulary. The title reads `title:`, then the first-body H1,
then the humanized stem. An optional one-line `summary:` dek follows, then a
byline of author, source host, and publication date, plus PDF and Listen
chips when the note declares them.

Reading state arrives later through one shared `bob ref list` snapshot: the
lane chip, Today pill, annotation counts, reread lineage, identifiers, and
diagnostics patch existing rows with no layout shift. Absence is normal:
nothing is ever zeroed, and no ghost rows appear.

## Keys

In Live Preview Vim normal mode, `==` opens the Reference editor (or the
title fallback on an older bob), `+` opens the Property Editor, `-` toggles
the drawer, and `_` compacts the card to kicker and title. The managed
reading-task embed stays in the body untouched. Painting never spawns bob,
never writes the vault, and never touches a PDF.
