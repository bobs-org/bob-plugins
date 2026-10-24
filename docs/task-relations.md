---
title: "Task relations"
description: "How 🪢 LINKS and LINKED FROM rows render as live chips, and how the Task Card links tasks."
---

A task relates to another task with an entry on its `🪢 **LINKS:**` line. The
reverse `🪢 **LINKED FROM:**` line is generated output: reconcile rebuilds it
from other tasks' LINKS lines, so edit the source side and let the mirror
converge. Relations never block, promote, consume, schedule, stamp, or route
anything.

Both rows render as live chips in Live Preview and Reading view from the
relation index (`api.relationIndex`), never the stored mirror:

- Labels show as muted small-caps pills on the arrow side: `‹label› → (chip)`
  on LINKS, and the inverse phrase (`merged into` reads `merged from`) on
  LINKED FROM, otherwise `(chip) · ‹label› → this`.
- A stored entry that is no longer live is dashed with the tooltip
  `No longer links here · refreshes on the next reconcile`. A live edge
  missing from the text is appended in canonical order. A target that cannot
  be resolved is a dashed `⚠ ^id not found`.
- Three or more closed chips collapse to `✓×N`, which expands on click.
- Closed and archived targets are dimmed and never struck; `#hide` tasks are
  muted. Colour carries status, never direction.
- With nav `api.relations` v1 present, a trailing ＋ opens the Links /
  Linked-from stage and a hover × on each live chip removes the link
  (`Unlink ‹name›` on LINKS, `Remove the link from ‹name›` on LINKED FROM).
  Without it the rows stay navigation-only.
- The shared `toggle-dependency-chips` command covers both rows.

Without this plugin, both lines still read as English.

## Linking from the Task Card

The Task Card's `Links to…` row (`l`, after `Blocks…`) shows
`N · <first label> <first target> +K` from the owner's LINKS line. Its
`Linked from…` row (`⇧L`) shows the counted source tasks from the live
relation index when ready; its detail stays empty while unavailable. Both
actions work on open and closed tasks. `Ctrl+Shift+L` (command
`bob-navigation-hotkeys:task-card-links`) opens Links to, and
`Ctrl+Shift+Alt+L` (command
`bob-navigation-hotkeys:task-card-linked-from`) opens Linked from. On
either relation line, `Ctrl+Shift+P` opens the owner's matching stage.

The Links stage title reads `🪢 Links · <task>` with the subtitle
`Links to K · searching P tasks · ⇥ to mark several · does not block`.
CURRENT holds the outgoing links with label pills in authored order,
RESULTS holds open tasks, and CLOSED holds closed tasks then `done/`
archives. `↵` links (or unlinks on CURRENT), `⇧↵` opens the relation field
(or relabels on CURRENT), `⇥` marks several, and id-less targets run the
block-ID prompt once on apply. The relation field offers suggestions from
the live index with a live `S — ‹label› → T` sentence; an empty field
commits a plain link. Same-note writes share one undo entry; cross-note
mirrors follow best-effort with a `· 🪢 LINKED FROM not updated` suffix when
they cannot.

Linked from lists incoming sources in CURRENT from `api.relationIndex`, or
from a generation-guarded vault scan while that index is unavailable.
Sources of every task status count, including Next `[*]` and Blocked `[?]`.
Its RESULTS are editable source tasks that can link here; Enter applies or
removes the selected source, and `Shift+Enter` adds or changes the relation
label. `Shift+Enter` labels the selected source's LINKS line, and the
relation field's live sentence reads `‹source› — ‹label› → this`. Built-in
labels use their inverse phrase in CURRENT. `N<Ctrl+Shift+L>`
applies one Links-to target and label to each of N+1 source tasks;
`N<Ctrl+Shift+Alt+L>` is refused because one target cannot be chosen for a
reverse batch. `Ctrl+D` on Links to removes every outgoing relation and
updates generated mirrors; Linked from refuses `Ctrl+D` because its row is
generated. Hand edits to LINKS update LINKED FROM with the same-note undo
transaction or checked cross-note mirrors; `Ctrl+Z` runs the mirror again.
Editing LINKED FROM shows the generated-line notice and does not change an
edge.

## Related

- [BLOCKS dependency mirrors](blocks-mirrors.md) — the reverse-dependency
  precedent for generated mirror rows.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — relation stages and
  gestures.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) —
  dependency storage and behavior.
- [Task relations](https://bobs-org.github.io/task-relations/) — relation
  storage and behavior.
