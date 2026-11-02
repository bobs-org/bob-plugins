---
title: "Task Status Cycler"
description: "Change task and Pomodoro states in Bob's workflow."
---

Task Status Cycler changes task and Pomodoro states in Bob's workflow.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Task Status Cycler |
| ID | `task-status-cycler` |
| Version | 1.48.1 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Complete Pomodoros while carrying worked-on/deferred links, narrowing the closed name to worked types and shedding uncarried types from the created Pomodoro, and copying each Task Link sub-bullet's sub-sub-bullets into the linked task's Work Log, toggle empty Pomodoro placeholders/sub-bullets with Ctrl+Alt+] including named placeholders, toggle Obsidian tasks with Ctrl+Shift+] (a Vim count N<Ctrl+Shift+]> toggles the cursor item and the next N sibling items together, prompting at most once and sending the whole group to one section) — always prompting for promotion destinations when exact Tasks exists (Enter defaults to Tasks conversion, including in place when already there; typing creates a new section; non-Tasks stays plain; empty non-Tasks source sections are removed) and for demotions from Tasks — cycle Blocked tasks out with option+[/option+], recover affected Blocked dependents, propagate Ctrl+Enter to embedded task transclusions, and preserve embedded-task behavior. Ctrl+Enter on a Task Link closes the linked task and strikes the link, embedded or plain. A versioned `api.recoverBlockedDependents` lets other plugins recover Blocked dependents without retiring references; dependents with a strictly future `scheduled` date stay Blocked, and Ctrl+Enter on a Task Link to a Cancelled task shows a notice instead of completing the owning Pomodoro. Depends-On lines (managed ⛓️ **DEPENDS ON:** child bullets) are never struck, restored, reformatted, or tree-closed: Ctrl+Enter closes or reopens the linked prerequisite only, and Alt+[ / Alt+] cycle the link under the cursor. Ctrl+Enter on the PRE/POST row the bob-navigation-hotkeys review walk just landed on hands off to nav api v2, which completes the row and advances within its group when another live row remains. Alt+[ / Alt+] on a Pomodoro Task Link instead toggles the linked task between Next and In Progress through the nav api.taskLinkLane v1 namespace, never reformatting the bullet. Closing a planned task recovers what it unblocked and offers successor choices through nav `api.successors` v3 (hand-offs, project residents, project-finished pull-ins, leaf-project keep-moving rows when `plan.keep_moving` is enabled, and configured `relations.successor_labels` standing offers on managed Done and on Unlink of a Pending task with no live Task Link left today through `api.offerParkedSuccessors` (api v4)) — dependency and project offers gated on `[id::]`, relation offers from accepted LINKS even without ids — through open editors or preimage-checked vault writes, honouring `plan.link_unblocked` — and reports the result through nav `api.notice` v3 for relation and keep-moving rows (plain relation copy when notice is older than v3), the existing Unblocked card for other rows, the walk toast on review landings, or a plain notice without a compatible nav API. Reopening the predecessor the same day through Ctrl+Enter takes back untouched successor links and restores their statuses from an in-memory receipt; Alt+]/Alt+[ moves into Done join the same pass, while moves into Cancelled recover only. Project Schedule comes from the ^prj task; tagged #prj_is_blocked residents stay Blocked until project recovery, which strips the tag from every open resident including those that remain Blocked for their own reasons, never edits closed lines, and records [unblocked::] through ledger-tools v12 when available (otherwise it recovers with a console warning, including on the successor apply path). Alt+] / Alt+[ on a [?] ^prj that leaves the project with no remaining reason — a future date or an open Depends-On target resolved against the vault; a missing id never blocks — recover those open residents in the same gesture, including when Alt+[ cancels ^prj so the note is no longer project(T), and when the cycled ^prj is transcluded from another note. A tagged #prj_is_blocked ^prj inherits its parent project’s Blocked reason and cannot be cycled; closing its last open sub-project pulls in the parent ^prj. LINKS and LINKED FROM rows are not Pomodoro Task Links; Ctrl+Enter and Alt+] / Alt+[ act on their target root-only without formatting the row. Ctrl+Enter on a timed Pomodoro stamps the closed row `[off:: Nm]` when every Task Link it keeps is `#offclock` (aliases `#off-clock`, `#untracked`) and `[t:: Nm]` otherwise, with a notice when a session stays on the clock while linking an off-clock task; timed MEET closes place the carried continuation after the last open Pomodoro and leave the cursor on the next open entry. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Cycle task status backward | `cycle-task-status-backward` | — |
| Cycle task status forward | `cycle-task-status-forward` | — |
| Open child bullet line above | `open-child-bullet-line-above` | — |
| Open child bullet line below | `open-child-bullet-line-below` | — |
| Toggle Obsidian task | `toggle-obsidian-task` | — |
| Toggle Pomodoro placeholder/sub-bullet | `toggle-pomodoro-bullet` | Ctrl+Alt+] |
| Toggle task checkbox marker | `toggle-task-checkbox-marker` | — |
| Toggle task open/done | `toggle-task-open-done` | — |
<!-- END GENERATED: commands -->

## Completing Pomodoros and tasks

`Ctrl+Enter` on a Pomodoro completes it: worked-on links carry above deferred
`#`-marked links, each in source order; a closed named Pomodoro's name is
narrowed to the types of worked Task Links, while the created Pomodoro sheds
types with no carried links; labels and component order stay in place, and
MEET keeps its calendar-owned name. The continuation carries the original
name when the close has no typed links. Each Task Link
sub-bullet's sub-sub-bullets are copied as entries stamped with the local
minute of the close, such as `*2026-08-26 14:32* — Read research notes`, into
that link's task, under a tab-indented managed `🛠️ **WORK LOG**` child bullet
created when the task has none. One close reads the clock once, so every entry
it writes carries the same stamp; the stamp is the write instant, never the
daily note's filename date, so closing yesterday's forgotten session this
morning stamps this morning. Older date-only entries are never rewritten. A
Pomodoro close whose children are all deferred `#` links deletes the closed
entry instead of leaving it childless, carrying the stripped links to the
created placeholder.

When Ctrl+Enter closes a MEET that carries later meetings with an open
Pomodoro below it, the created continuation moves after the last open
Pomodoro block. The cursor moves to the first open Pomodoro below the closed
entry so planned work stays next.

On a timed Pomodoro close the closed row is stamped with the clock its links
put it on, by the same counted-links rule `bob capture` uses (pinned by bob-cli's
shared `pomodoro_clock` vectors): the closed row gets `[off:: Nm]` iff the Task
Links the closed entry keeps are all `#offclock` (aliases `#off-clock` and
`#untracked`), and `[t:: Nm]` otherwise. The links it keeps are the direct-child
Task Link bullets that remain once the close has deferred and carried the
`#`-marked ones, after the Event Task clock rewrites below; a worked link that is
also carried forward still counts, and struck, embedded, and 🍅-marked links
count. An unlinked session, an unresolved link, or a single on-clock link keeps
the whole session worked. The recorded minutes move between keys unchanged; a
bare closed span is restamped from its span, and a row holding both keys
resolves to the target key. A session that stays worked while it links an
off-clock task shows a Notice, `◌ LUNCH stays on the clock: it also links Fix the
parser`. An untimed `()` close has no key to stamp. Later tag edits never rewrite
a closed row.

On a timed Pomodoro close, a bare plain link to an Event Task in the same
daily note's `## Events` section closes by the meeting clock instead: the
meeting that ended inside the session completes (counted, never carried),
later and earlier meetings defer and carry without starting, and a meeting
running at close starts and carries as usual. The close uses now when the
note is today's note, otherwise the session's written end; an untimed `()`
close, embedded links, authored `#` deferrals, and other-note links keep
their existing behavior.

`Ctrl+Enter` on a selected Task Link — embedded or plain, including inside an
open Pomodoro — closes the linked task and strikes the link through as
`~~[[…]]~~`; pressing it again reopens both. Plain links close root-only,
while embedded links close their transcluded tree. Only links that do not
resolve to a task fall back to completing the Pomodoro. `Ctrl+Enter` on a Task
Link to a Cancelled task shows a notice instead and leaves the Pomodoro open.
`Ctrl+Enter` on a task line wrapping an embedded block transclusion closes or
reopens the transcluded source task too.

The empty-placeholder toggle `Ctrl+Alt+]` toggles empty Pomodoro
placeholders and sub-bullets, including named empty placeholders. The Obsidian
task toggle `Ctrl+Shift+]` / `Ctrl+}` converts a task to or from a normal
bullet; a Vim count `N<Ctrl+Shift+]>` toggles the cursor item and the next N
sibling items together, prompting at most once and sending the whole group to
one section. Every eligible plain-bullet promotion in a note with an exact
`Tasks` section routes through a section picker (blank Enter chooses `Tasks`
and converts once to checkbox, `#task`, and `created`, including in-place when
the bullet is already there; other destinations keep the bullet plain).
Demoting from `Tasks` prompts for an existing or new destination; other
demotions go to the next Markdown section, and emptied non-`Tasks` source
sections are removed. The toggle refuses to move a column-zero `#task` row
into `## Pomodoros` and shows a notice, so an Event Task cannot become a ledger
entry.

A Blocked `[?]` task cycles to Ready or Cancelled with `Alt+]` / `Alt+[` —
retiring its own uniquely future `scheduled` date and prepending a `🔓
unblocked by hand` entry to an existing Schedule Log without ever creating
one — and recovers the affected Blocked dependents. Blocked dependents with a
strictly future `scheduled` date stay Blocked.

Depends-On ⛓️ **DEPENDS ON:** lines are never struck, restored, reformatted,
or tree-closed: `Ctrl+Enter` on one closes or reopens the linked prerequisite
only, and `Alt+[` / `Alt+]` cycle the link under the cursor. The same guard
covers malformed lines; VS16-emoji, lowercase, unmarked, and blockquoted
shapes stay unguarded. 🧱 **BLOCKS:** lines are likewise never struck,
restored, reformatted, or tree-closed; `Ctrl+Enter` closes the dependent
root-only and `Alt+[/]` cycles it without reformatting. Pomodoro and successor
scanners skip managed lines.

`🪢 **LINKS:**` and `🪢 **LINKED FROM:**` are managed relation lines too.
Their links never become Pomodoro Task Links or successor offers. `Ctrl+Enter`
and `Alt+]` / `Alt+[` on one act on the selected task root-only; the line is
never struck, restored, tree-closed, or reformatted.

## Successor offers and take-backs

Closing a planned task recovers what it unblocked and offers to pull in
successors (hand-offs, project residents, project-finished pull-ins, and
configured relation-label standing offers): the Unblocked card, the walk toast
on review landings, or a plain not-pulled-in notice reports the outcome
exactly once. Successor picks carrying a destination override insert at the
verified existing entry or a created `- [ ] () — NAME` placeholder.

With `plan.keep_moving` enabled, closing the last live planned task in a leaf
project can offer that project's Pending, Next, and Ready residents in a
separate `Keep <project> moving` group. The group can include `#ref` rows;
blocked, future-scheduled, and hidden residents appear only in fold counts.
The project root task counts as planned work, while child-project tasks stay
outside the offer. Picking a row raises it to Next, stamps freshness, and adds
its Task Link; leaving it unpicked does not edit it.

When `relations.successor_labels` is configured (for example `starts after`),
every managed Done gesture — `Ctrl+Enter` on a task, Task Link,
transclusion or tree, Pomodoro embedded completion, `Alt+]` into Done,
complete-label commits through `finalizeClosedTasks`, and PRE/POST walk
completion — also offers Ready and Next sources whose accepted `🪢 **LINKS:**`
entries use one of those labels to point at the completed task. Relation
offers do not need `[id::]` and never read generated `LINKED FROM`. They never
auto-link: only an explicit pick writes S (Ready becomes Next, Next stays
Next, mint a missing block ID, stamp freshness, and insert a Task Link). Esc
and an empty selection leave relation-only rows unchanged. Dependency and
project recovery still run even when a relation row wins the picker or
nothing is picked. Held rows (already started, blocked, hidden, waiting for
another successor target) appear only when no picker opened; already-planned
rows stay silent. If ledger-tools `api.relationIndex` is missing or not ready
after the feature is gated on, the close still succeeds and reports
`🪢 Couldn't check ‹label› links · nothing offered` (several labels:
`relation links`). Relation groups go to nav `api.successors` v3 and
`api.notice` v3; older notice APIs still get the same plain copy. A
relation-only picker titles `Starts after “T”` with caption `“T” is done` and
tag `your links · not dependents`; mixed pickers keep their existing title. A
picked notice reads `🪢 Next in DEST: S · label “T”` (or the plural linked
form). Cancel recovers dependents and never consults the relation index.

Successor offers use the selected task's effective type to choose a destination.
An explicit retarget applies the retype rule to keep its field and live Task Link
in agreement. Default placements, unpicked offers, stale tasks, and stale
destinations do not write a type field. A later daily-link failure preserves the
task's committed type change, and a same-day take-back restores the consolidated
post-image consistently.

Reopening the predecessor the same day through `Ctrl+Enter` takes back
untouched successor links — including successful relation picks — and restores
their statuses from an in-memory receipt — nothing is stored — deleting every
open entry the take-back empties. Edited links and next-day reopens stay put.
`Alt+]` / `Alt+[` moves into Done join the same pass, while moves into
Cancelled recover only.

## Lanes, projects, and review handoffs

`Alt+[` / `Alt+]` cycling to an open status (including leaving Blocked, counted
lines, and transcluded targets) and `Ctrl+Enter` reopening stamp the task's
freshness (`[fresh:: today]`) through Bob Ledger Tools. On a Pomodoro Task
Link line, `Alt+[` / `Alt+]` instead delegate to the navigation lane toggle to
move the linked task between Next and In Progress — asking once for an
optional Work Log summary when moving back to Next — never reformatting the
bullet.

`Ctrl+Enter` on the PRE/POST row the navigation review walk just landed on
hands off to that walk to complete the row and move within its group when
another live row remains. `Ctrl+Enter` on a lane or other landed row closes it
and continues the walk once, never onto a checklist row.

Project Schedule comes from the `^prj` task: tagged `#prj_is_blocked`
residents stay Blocked until recovery, which strips the tag from every open
resident including those that remain Blocked for their own reasons, never
edits closed lines, and records `[unblocked::]` through the ledger-tools
namespace when available (otherwise it recovers with a console warning).
`Alt+]` / `Alt+[` on a `[?]` `^prj` that leaves the project with no remaining
reason — a future date or an open Depends-On target resolved against the
vault; a missing id never blocks — recover those open residents in the same
gesture, including when `Alt+[` cancels `^prj` so the note is no longer a
project, and when the cycled `^prj` is transcluded from another note. A tagged
`#prj_is_blocked` `^prj` inherits its parent project's Blocked reason and
cannot be cycled; closing its last open sub-project pulls in the parent `^prj`.

The plugin exposes a versioned cross-plugin surface the same way the other
plugins do (plugins never import one another's `main.js`):
`recoverBlockedDependents` runs the same Blocked-dependent recovery
`Ctrl+Enter` uses — including the strictly-future-`scheduled` guard — without
retiring references, and `completeTaskAtCursor` closes the cursor `#task`
through the Tasks command so recurrence fires, appending its additive
`successorNotice` line to the walk toast on review landings. The api is
version 4: `completeTaskLineText(lineText, { date }?)` returns a frozen
result with the exact local-fallback Done bytes (no freshness stamp),
leaves already-closed lines unchanged and refuses recurring and non-task
lines. `finalizeClosedTasks(identities, context?)` runs the post-Done pass —
recovery, embed retirement, the Unblocked notice, and the successor picker —
so complete-label commits close from the same bytes and the same pass.
`offerParkedSuccessors(identities, { slot }?)` plans relation-only
starts-after offers for a Pending task with no live Task Link left today,
presents the nav picker with `event: parked`, and resolves
`{ offered, picked }` without throwing.

## Settings

This plugin adds no settings tab and reads no per-plugin settings. Lane,
schedule, and freshness inputs come from the task lines themselves. The
shared Bob config file controls successor offers: `plan.keep_moving` defaults
to `true` and disables only the leaf-project keep-moving group when `false`;
`plan.link_unblocked` controls successor offers generally, including relation
standing offers. `relations.successor_labels` defaults to an empty list (no
relation offers). Invalid entries warn and skip; a label in more than one of
`cancel_labels`, `complete_labels`, and `successor_labels` is dropped from
every list.

## Related

- [Task status hooks](https://bobs-org.github.io/task-status-hooks/) — how
  completion reconciles lanes and dependencies.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the
  Depends-On lines this plugin guards.
- [Task relations](task-relations.md) — LINKS labels, including successor
  standing offers.
- [Projects](https://bobs-org.github.io/projects/) — project blocking and
  `^prj` schedules.
- [Freshness](https://bobs-org.github.io/freshness/) — the stamps completion
  writes.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the review walk and
  lane toggle this plugin hands off to.
- [Bob Ledger Tools](bob-ledger-tools.md) — the freshness stamper and
  successor-reporting surfaces.
- [Cross-plugin APIs](https://bobs-org.github.io/develop/plugins/plugin-apis/) — the completion and blocked-dependent interface.
