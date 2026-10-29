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
under the cursor or a dedicated Task Link's linked task, opening its note
first. `Ctrl+Shift+Alt+L` (command
`bob-navigation-hotkeys:task-card-linked-from`) opens Linked from. See
[Task relations](task-relations.md). On either relation line,
`Ctrl+Shift+P`, `Ctrl+Shift+L`, and `Ctrl+Shift+Alt+L` open that task's
matching stage directly. On a Depends-On or BLOCKS line, the L chords open
the owning task's Links or Linked-from stage.

## Card gestures

| Gesture | Outcome |
| --- | --- |
| `1`–`4` | Set that configured priority level and its frozen displayed date; extra configured levels receive unique digits through `9`. |
| `0` | Clear priority to implicit P0 and keep the scheduled date. |
| `Ctrl+Enter` | Apply the cached recommendation (with a `Cmd+Enter` alias). |
| `Alt+P` | Apply the cached recommendation; it aliases Ctrl+Enter. |
| `Ctrl+R` | Regenerate the recommendation and priority previews without writing; in the relation-label stage, open rename mode for the selected existing label. |
| `Enter` | Open the selected action; Schedule is the default. |
| `b` | Open Blocked by (Depends on). |
| `⇧B` | Open Blocks (reverse Depends on). |
| `l` | Open Links to (task relations); in its filter, `~` flips direction. |
| `⇧L` | Open Linked from (task relations); in its filter, `~` flips direction. |
| `f` | Open Review every (Refresh). |
| `t` | Open Theme; `Enter` on the Theme row opens the same stage. The stage offers Use default first with its inherited reason, then Today, Recent, and a validated typed new name. |
| `x` | Open the cancel-reason stage; the key alone never cancels. |
| `Alt+N` | Commit to Next or release to Ready. |
| `Ctrl+D` | Delete the selected property; Schedule is selected by default. On Theme, clear to Use default (field clearing only, never Recent hide; theme need not be in the configured property list). On Links to, clear all outgoing relations; Linked from is generated and refuses clearing. In the relation-label stage, hide or unhide the selected label; row zero toggles one-off instead. |
| `Ctrl+H` | In the relation-label stage, show or hide the Hidden section. |
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
dependency counts, and review interval, plus a Theme line (`Theme [X] this
task`, `Theme [X] from note`, `Theme none · t to set`) with catalog spelling,
declaring-note hue dot, and unknown/repair/mixed signals with tooltips; color
is never the only signal. Batch cards name their scope and mixed values and
never imply a value or default applies to all targets when it differs.
Counted sessions identify their N+1-item scope and mixed values. Task Links
show `via Task Link` and name their target notes. Each priority level shows
its exact ISO date; batches show a date span and per-target details.

A theme-only edit writes only `[theme:: ...]` fields through the Ledger Tools
setters with guarded identity and a revalidated default: selecting Use default
always clears (including invalid, duplicate, and none defaults), selecting the
inherited theme also clears, and other choices follow the single non-exempt
component rule with catalog spelling. Closed tasks keep their history. No
status, Task Link, ID, route, freshness, stamp, schedule, Work Log, or
review-walk change is caused by a theme-only edit; `Back`, `Escape`, and
`Ctrl+[` write nothing.

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

## Links stage and closing labels

The `l` Links to and `⇧L` Linked from stages list configured cancel labels with
`⊘ cancels` and complete labels with `✓ completes`, including typed rows and
labels with no previous use. Cancel previews dim the source as `⊘ {S}`; complete
previews dim it as `✓ {S}`, with the note stem when the source is remote. The
consequence strip names the source and its close effects (`unblocks dependents ·
offers successors` on a complete, plus `its N open tasks stay open` on a `^prj`
source). Return reads `↵ link & cancel`, `↵ link & complete`, or `↵ link & close`
when the selection mixes both. Recurring sources and an old Task Status Cycler
(`api.version` below 3) disable complete rows. A counted commit that would close
two or more sources first shows `⊘ Cancels {N} tasks — ↵ again to confirm`,
`✓ Completes {N} tasks — ↵ again to confirm`, or
`Closes {N} tasks · ✓ {a} · ⊘ {b} — ↵ again to confirm`; a second Return
commits, while Escape or changing the query or selection disarms it.

Inverse labels explain that they never cancel or complete and point to `⇧L` or
`l` with the closing label. A hand edit of a closing label into LINKS does not
close its source. Unlinking or relabelling a cancel edge away does not reopen
the source (`⊘ Stays Cancelled · reopen with Alt+]`); the same for a complete
edge says `stays Done · reopen with Alt+[`. See
[Task relations](task-relations.md) for the complete contract.

## Undo and direct stages

One local or counted edit is undoable as a unit. A cross-note Task Link edit
cannot be undone from the daily note with one `Ctrl+Z`.

Direct Depends-On or BLOCKS-line entries, dependency chips, the dependency
palette command, and decay-card **Less often** entries open their stage
without first showing the Task Card. The decay card accepts `x` as
an alias for `d` (Drop). Freshness-decay `Alt+F` cards
are a separate surface: their header shows the logged keeps, and Keep swaps
the rows for an in-card reason stage that commits the stamp, increment, and
Rotten Log entry in one undo.

## Related

- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — navigation, task properties, and review gestures.
- [Bob Ledger Tools](bob-ledger-tools.md) — the shared plan budget, marks, and freshness views.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — dependency edits and their guards.
- [Task relations](task-relations.md) — relation labels, including closing labels.
- [Freshness](https://bobs-org.github.io/freshness/) — review intervals and freshness decisions.
- [Projects](https://bobs-org.github.io/projects/) — project schedules and blocking.
