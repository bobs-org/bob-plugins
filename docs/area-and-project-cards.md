---
title: "Area and Project Cards"
description: "Local title cards for typed Area and Project notes in Live Preview and Reading view."
---

Typed Area and Project notes can show a compact card in desktop Live Preview and Reading
view. It gives the note a clear title, its place in the home hierarchy, and the
properties that the note explicitly declares. The typed Settings contract uses
`props_contract_v1` on top of `props_v1`. Whole-block ownership also requires matching
source and cache plus working editor routing. Missing or uncertain capability,
malformed or stale source, a failed mount, Source, embeds, hover previews, canvas,
print, and mobile leave native Properties available.

The card does not change the note. The original heading and properties stay in the
Markdown source, and the Project's `^prj` task stays directly below the card as its
editable control.

## Area cards

An Area card has a soft field tile with the `layers` icon and an `AREA` kicker. Its
title uses the first eligible body H1, then the first alias, then the file name without
changing its case or underscores. Parent links appear as clickable breadcrumbs; the
root `area` sentinel and the current note are omitted. The top-level ancestor has a
small hue pip. Inbox notes also show an `INBOX` pill.

An authored `summary` appears as a subtitle and can wrap to two lines. Areas do not
show a Project lifecycle row or a missing-created-date label.

## Project cards

A Project card uses a pennant tile with the `target` icon and a `PROJECT` kicker. A
project with `root: true` also shows a `ROOT` pill. Its subtitle comes from the local
top-level `^prj` task. Nested, fenced, or duplicate `^prj` rows are not the project
task:

| Project task | Card state |
| --- | --- |
| `[ ]`, `[*]`, or `[/]` | WIP |
| `[?]` with a future inline `[scheduled:: YYYY-MM-DD]` | SCHEDULED, with the start date and relative time |
| `[?]` without a future schedule | BLOCKED |
| `[x]` | DONE, with an inline completion date when present |
| `[-]` | CANCELED, with an inline cancellation date when present |
| No recognized task on an active project | A repair instruction for the missing `^prj` task |

Done and canceled projects keep their lifecycle label and use a muted, outlined tile.
An archived Project with terminal `status: done` or `status: canceled` keeps that state
even when no `^prj` task remains. The card never repeats or takes ownership of the goal
task itself.

## Authored properties and Ready

The card shows only policy values authored on that note, in a fixed order, and only
when the live Markdown source confirms both the key and a valid value:

- `task_type`, or legacy `theme` when no `task_type` is present;
- `offclock_types` or `offclock`, including an explicit on-clock value and a warning
  when one key shadows the other;
- `task_refresh` as the review interval;
- `project_name_aliases` as capture aliases.

An invalid or unsupported shape stays in the native Properties drawer and does not
become a chip. An `offclock_types` list that is present, even when empty or invalid,
wins over `offclock` on the same note and does not fall back to the boolean. Type
names are strings; numeric types and object `task_refresh` values are not chips.
Stale cached frontmatter never paints a policy the current source does not confirm.

When local Tasks data is available, the right side shows Ready tasks living in the
note and the cap that applies there, such as `2/5 ready`. Unknown data stays absent; a
missing snapshot is never shown as zero. Areas can show an inbox pill when the inbox
route API says the note is the inbox, and Projects can show a root pill, but cards do
not infer inbox status from the filename or display inherited policy values.

One shared Properties foot remains below the card. `-` toggles that drawer, `_` folds
the card's own details, `==` opens the Area or Project settings editor, and `+` opens
the generic Property Editor. A policy chip opens its own setting. Collapse is per-note
for the session.
Collapsing an Area hides its summary and property chips/readout; a Project keeps
its lifecycle line visible.

## Report-backed live parts

The card subscribes to the already-shared Areas and Projects report services and
patches itself in place when a fresh snapshot arrives. Painting still starts no
per-card fetch and no Bob process. A missing or stale snapshot hides only the
report-backed parts below; the card keeps painting everything local.

- **Blocked reasons:** a dependency-blocked Project names up to two `waits on`
  links (a `+N` remainder when more wait), and an inherited-blocked Project
  names its nearest blocked ancestor (`parent project [[sase]] is blocked`).
  The links navigate like crumbs.
- **Close dates:** a DONE or CANCELED project without a line date shows the
  report's `closed_on`. A date on the `^prj` line always wins.
- **Open and Today readouts:** Projects show `N open` and `N today`; Areas show
  direct `N today` only. A missing snapshot leaves them absent, never zero.
  Sub-area and sub-project counts never appear on the card.
- **Foot lint:** the foot chip counts the row's `contract_issues` alongside the
  local lint, and its tooltip names each issue. When a first affected setting
  is known, clicking the chip opens the Property Editor on that setting; the
  chip never opens the drawer by itself.

## Data and display rules

The cards use Bob's existing Area and Project type classifiers. Untyped notes do not
become homes based on their filenames. `bank.md` is excluded by its canonical path
because it is the taskless Bank hub, never an Area note; an accidental `area` type does
not make it eligible. The untyped type notes, `_templates/`, `done/`, and `_conflicts/`
are also excluded.

Painting uses the metadata cache, confirmed local Markdown bytes, the local home-hue
resolver, the ledger type-hue API, the synchronous Ready snapshot, and synchronous
reads of the cached Areas and Projects reports. It does not start a Bob process or
write the vault. If the card cannot safely own its title or source range, the native
title and heading remain available. Source mode, embeds, hover previews, canvas,
print, and mobile use Obsidian's ordinary note presentation.

While a Project card is mounted, the recognized `^prj` line (the first body task
line before any H2) renders slightly larger and medium weight, in Live Preview
and Reading view alike. The decoration touches only that line, never moves the
cursor, and is removed on unmount or in Source mode.

For album and Record cards, see [Album Cards](albums.md) and
[Record Card](record-card.md). For notebook, prose, and reference title cards,
see [Notebook Card](notebook-card.md), [Prose Card](prose-card.md), and
[Ref Card](ref-card.md). For editing YAML properties, see the
[Property Editor](property-editor.md).
