---
title: "Area and Project Cards"
description: "Local title cards for typed Area and Project notes in Live Preview and Reading view."
---

Typed Area and Project notes show a compact card in desktop Live Preview and Reading
view. It gives the note a clear title, its place in the home hierarchy, and the
properties that the note explicitly declares. The card reads local note data and keeps
Obsidian's native Properties block visible.

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
`^prj` task:

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

The card shows only policy values authored on that note, in a fixed order:

- `task_type`, or legacy `theme` when no `task_type` is present;
- `offclock_types` or `offclock`, including an explicit on-clock value and a warning
  when one key shadows the other;
- `task_refresh` as the review interval;
- `project_name_aliases` as capture aliases.

When local Tasks data is available, the right side shows Ready tasks living in the
note and the cap that applies there, such as `2/5 ready`. Unknown data stays absent; a
missing snapshot is never shown as zero. Areas can show an inbox pill and Projects can
show a root pill, but cards do not infer or display inherited policy values.

The shared Properties foot remains below the card. Its collapsed state is remembered
per note for the current session. Collapsing an Area hides its summary and property
chips/readout; a Project keeps its lifecycle line visible.

## Data and display rules

The cards use Bob's existing Area and Project type classifiers. Untyped notes do not
become homes based on their filenames. The untyped type notes, `bank.md`, `_templates/`,
`done/`, and `_conflicts/` are excluded.

Painting uses the metadata cache, confirmed local Markdown bytes, the local home-hue
resolver, and the synchronous Ready snapshot. It does not start a Bob process or write
the vault. If the card cannot safely own its title or source range, the native title
and heading remain available. Source mode, embeds, hover previews, canvas, print, and
mobile use Obsidian's ordinary note presentation.

For album and Record cards, see [Album Cards](albums.md) and
[Record Card](record-card.md). For editing YAML properties, see the
[Property Editor](property-editor.md).
