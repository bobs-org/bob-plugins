---
title: "Task Card"
description: "Reference for the Task Card's property controls, previews, and scheduling input."
---

The Task Card is the property-editing surface opened by
`Ctrl+Shift+P` (command
`bob-navigation-hotkeys:set-bullet-property`). It has no plugin
setting or activation date. It opens for the task under the cursor, a
dedicated Task Link's target, or a counted batch.

`Alt+P` (command `bob-navigation-hotkeys:roll-by-recommendation`) applies the
Task Card's recommended roll, decay, or confirmed cancel in one key.

`Ctrl+Shift+B` (command
`bob-navigation-hotkeys:task-card-depends-on`) opens the Depends-On
stage. `Ctrl+Shift+Alt+B` (command
`bob-navigation-hotkeys:task-card-blocks`) opens the reverse Blocks
stage. Both support counted targets. On a Depends-On or BLOCKS line, these
chords open the owning task's stage directly; `Ctrl+Shift+P` on a
BLOCKS line does the same. In the reverse stage, Enter toggles whether the
selected dependent waits on the source task.

`Ctrl+Shift+L` (command
`bob-navigation-hotkeys:task-card-links`) opens Links to for the task
under the cursor. `Ctrl+Shift+Alt+L` (command
`bob-navigation-hotkeys:task-card-linked-from`) opens Linked from. See
[Task relations](task-relations.md). On either relation line,
`Ctrl+Shift+P`, `Ctrl+Shift+L`, and `Ctrl+Shift+Alt+L` open that task's
matching stage directly.

## Card gestures

| Gesture | Outcome |
| --- | --- |
| `1`–`4` | Set that configured priority level and its frozen displayed date; extra configured levels receive unique digits through `9`. |
| `0` | Clear priority to implicit P0 and keep the scheduled date. |
| `Ctrl+Enter` | Apply the cached recommendation (with a `Cmd+Enter` alias). |
| `Alt+P` | Apply the cached recommendation; it aliases Ctrl+Enter. |
| `Ctrl+R` | Regenerate the recommendation and priority previews without writing. |
| `Enter` | Open the selected action; Schedule is the default. |
| `b` | Open Blocked by (Depends on). |
| `⇧B` | Open Blocks (reverse Depends on). |
| `l` | Open Links to (task relations). |
| `⇧L` | Open Linked from (task relations). |
| `f` | Open Review every (Refresh). |
| `x` | Open the cancel-reason stage; the key alone never cancels. |
| `Alt+N` | Commit to Next or release to Ready. |
| `Ctrl+D` | Delete the selected property; Schedule is selected by default. On Links to, clear all outgoing relations; Linked from is generated and refuses clearing. |
| Backspace on an empty field or Back | Return to the card without writing. |
| Escape, `q`, `Q` | Close and discard uncommitted state. `q` does not close while a text field is focused. |
| `Ctrl+[` | Close the card or a stage it opened, including a focused date, reason, or Work summary field. |

A resolving edit on a row just landed on by the review walk advances that
walk once. Every card gesture that writes closes the card. For a Next or
Pending task, choosing a priority level or recommendation first opens the
Schedule task Work summary stage.

## One-key roll

| Situation | Alt+P behavior |
| --- | --- |
| A roll or decay is available | Writes through the Ctrl+Enter path without showing the card, then shows the usual priority notice. |
| A Next or Pending task needs a Work summary | Shows the summary stage; Enter, blank Enter, or a second Alt+P submits. |
| The recommendation is cancel | Shows the danger banner without writing. A second Alt+P or Ctrl+Enter cancels; Escape keeps the task. |
| No priority can roll or a recommendation is unavailable | Shows the card and a notice without writing. |
| The task is in an inbox | Opens the route prompt before writing; backing out returns to the visible card. |
| A counted batch or Task Link batch includes a cancel | Waits on the card for confirmation before changing any target. |
| The cursor is on a Depends-On, BLOCKS, LINKS, or LINKED FROM line | Applies the recommendation to the owning task. |

## Scope and previews

The header shows the cleaned task text, note, lane, priority, schedule,
dependency counts, and review interval. Counted sessions identify their
N+1-item scope and mixed values. Task Links show `via Task Link`
and name their target notes. Each priority level shows its exact ISO date;
batches show a date span and per-target details.

Choosing the same priority level again is deliberate: selecting `2`
on a P2 task resets its roll streak. Unbound letters, `/`, and
digits that do not map to a configured priority level do nothing. Custom
list properties stay in More; choosing one opens its value stage.

## Scheduling input

The date field accepts a bare day count (`0` means today and
`1` means tomorrow), unsigned relative values with `d`,
`w`, or `m`, weekday names `mon` through
`sun` for the next occurrence strictly after today, ISO dates,
`M/D`, `M-D`, `+Nd`, `+Nw`,
`+Nm`, and the existing presets.

The preview shows the weekday, ISO date, relative distance, and year when a
date crosses a year boundary. Text after a complete date token becomes an
inline reason, such as `3 waiting on API`. `Shift+Enter`
skips the reason by using the blank-reason rule, but does not skip an
applicable Work summary. Otherwise, one combined Reason and Work summary
review appears. Invalid, negative, overflowing, or ambiguous input never
writes. Other date properties opened from More use the strict parser: ISO,
`M/D`, `M-D`, `+Nd/w/m`, and presets.

A blank reason records `🤷 no reason given` only when the target
already has a Schedule Log. A blank Work summary writes no Work Log. Priority
picks keep their deterministic 🎲 reason and offer a Work summary only for
an eligible Next or Pending target.

## Undo and direct stages

One local or counted edit is undoable as a unit. A cross-note Task Link edit
cannot be undone from the daily note with one `Ctrl+Z`.

Direct Depends-On or BLOCKS-line entries, dependency chips, the dependency
palette command, and decay-card **Less often** entries open their stage
without first showing the Task Card. The decay card accepts `x` as
an alias for `d` (Drop). Freshness-decay `Alt+F` cards
are a separate surface.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — navigation, task properties, and review gestures.
- [Bob Ledger Tools](bob-ledger-tools.md) — the shared plan budget, marks, and freshness views.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — dependency edits and their guards.
- [Freshness](https://bobs-org.github.io/freshness/) — review intervals and freshness decisions.
- [Projects](https://bobs-org.github.io/projects/) — project schedules and blocking.
