---
title: "Property Card Cabinets"
description: "Reference for the cabinet stack on property cards: kinds, order, defaults, the _ pick, absorption, and passive guarantees."
---

Every [property card](area-and-project-cards.md) ends in one ordered stack of
**cabinets**: named, independently collapsible compartments under the card's
own body. A cabinet has one header row — a chevron, the noun, a one-line
summary that still says what a closed cabinet holds, any attention chip or
stamp, and a keycap — over a body that opens in place. The stack replaces the
old per-card details fold and the loose catalog callouts: child catalogs
render as cabinets above the **Properties cabinet**, and `_` toggles or picks
them instead of folding the card.

## Kinds and order

Cabinets stack in one fixed top-to-bottom order. Numbers count upward from
the bottom extra, so they stay useful when one card owns only some of the
family:

| Cabinet | Noun | Role | On |
| --- | --- | --- | --- |
| Areas | Areas | content | Area and Project cards |
| Projects | Projects | content | Area and Project cards |
| Notebooks | Notebooks | content | Area and Project cards |
| Albums | Albums | content | Area and Project cards |
| Records | Records | content | Album cards |
| Outline | Outline | content | Prose cards |
| Schema | Schema | config | Album cards |
| Setup | Setup | config | The Bank card |
| Properties | Properties | properties | Every card, always last |

The Properties cabinet is the card's foot: `created` plus every top-level
key, with managed and sync-owned rows grouped under **Managed**. Only one
extra above it keeps a bare digit; with two or more, `_` arms the numbered
pick below. `__` toggles cabinet `1`, `-` toggles Properties, and Esc, `q`,
or Ctrl+`[` cancels an armed pick. A card with no cabinet above Properties
keeps `_` for its own details fold.

## Defaults

Every cabinet starts closed the first time a note shows in a session. A closed
header still carries an honest summary — the count, the field tally, or the
first diagnostic — plus any attention chip and Sync action, so nothing hides
silently. Problems never open a cabinet: they show only in the closed header's
chip, summary, and Sync action. Open or closed is session-only view state:
never frontmatter, never a vault write, and never a bob spawn. A session
choice always wins over config.

## Configuring defaults

A `cabinets:` block in Bob's config opens (or closes) chosen cabinets per card
type. Map a card type (or `all`) to cabinets (or `all`) and `open` or `closed`.
The most specific entry wins, and a card-type entry beats an `all` one. The
CLI ignores this block.

```yaml
# Property-card cabinets (bob-ledger-tools; "Defaults" above). Every cabinet
# starts closed the first time a note shows in a session.
cabinets:
  album:
    schema: open
```

Card-type keys are the property-card kinds (`album`, `record`, `day`,
`week`, `quarter`, `year`, `bank`, `area`, `project`, `notebook`, `prose`,
`ref`) plus `all`, with `article` as an alias of `prose`. Cabinet keys are
`areas`, `projects`, `notebooks`, `albums`, `records`, `outline`, `schema`,
`setup`, `properties`, plus `all`. Values are `open` or `closed`, trimmed and
case-insensitive. Precedence, first match wins: (type, cabinet), then (type,
`all`), then (`all`, cabinet), then (`all`, `all`), then the built-in closed.
A valid pair a card never shows (for example `area.records`) is harmless.
If `cabinets` is not a mapping, the whole block is ignored; a bad key or
value ignores only that entry and keeps the rest, logging one warning per
config. Mobile, a missing file, or a parse error all fall back to closed. A
config edit reaches a cabinet with no session choice on its next paint.

## The `_` pick

In Live Preview Vim normal mode, `_` routes on the extras above Properties:
zero extras falls back to the details fold, one extra toggles it at once, and
two or more arm a cancel-safe pick. Arming lights the digits on the headers
and pushes a footer overlay — `▤ Cabinets 1 Areas ▸ · 2 Projects ▸ · -
Properties esc` — with `▸`/`▾` naming each cabinet's state. A digit toggles
that cabinet, `_` again picks `1`, `-` picks Properties, and any other key
disarms. The pick snapshots semantic kinds, never positions, and re-checks
them before acting; a changed stack announces itself instead of toggling the
wrong cabinet. At 420 px the overlay sheds `esc` first, then truncates nouns
with an ellipsis; the label and the keycaps never clip.

## Absorption and fail-open

A content cabinet stands in for the bob-owned catalog callout in the note
(`[!areas]`, `[!projects]`, `[!notebooks]`, `[!albums]`, `[!records]`). The
callout stays in the Markdown, byte-for-byte bob's; only its rendered section
— plus an H2 that labels nothing else — hides while a working cabinet is
mounted. Recognition mirrors `region.rs`: a malformed, duplicated, or
ambiguous region is never absorbed, and a row that no longer looks
machine-owned keeps the source visible. Every claim is fingerprinted and
released on unmount, file change, mode change, and unload.

Fail-open is total: Source mode, embeds, hover previews, canvas, print,
mobile, a failed mount, uncertain evidence, and any denied context show the
stored section in the same frame. Heading links (`[[note#Projects]]`,
`#Records`) and the Outline pane open the matching cabinet, and a Find hit
inside a hidden range reveals the stored source. Painting, toggling, arming,
picking, cancelling, and the footer overlay never write the vault or spawn
bob; only an explicit **Sync** click invokes Bob's existing writer.

## Keys

In Live Preview Vim normal mode, `=` opens the species editor, `+` opens the
Property Editor, `-` toggles the Properties cabinet, and `_` routes as above.
The same dispatch backs **Toggle card details** (palette and Command Mode),
so arming also works in Reading view and digits work in any mode while armed.
Counts, registers, operator-pending keys, Source mode, insert and visual
modes, and views without a mounted foot keep Vim's motions.
