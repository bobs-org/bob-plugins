---
title: "Task relations"
description: "How 🪢 LINKS and LINKED FROM rows render as live chips."
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

## Related

- [BLOCKS dependency mirrors](blocks-mirrors.md) — the reverse-dependency
  precedent for generated mirror rows.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — relation stages and
  gestures.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) —
  dependency storage and behavior.
- [Task relations](https://bobs-org.github.io/task-relations/) — relation
  storage and behavior.
