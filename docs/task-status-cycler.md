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
| Version | 1.42.1 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Complete Pomodoros while carrying worked-on/deferred links, copying a closed named Pomodoro's name onto the created one, and copying each Task Link sub-bullet's sub-sub-bullets into the linked task's Work Log, toggle empty Pomodoro placeholders/sub-bullets with Ctrl+Alt+] including named placeholders, toggle Obsidian tasks with Ctrl+Shift+] (a Vim count N<Ctrl+Shift+]> toggles the cursor item and the next N sibling items together, prompting at most once and sending the whole group to one section) — always prompting for promotion destinations when exact Tasks exists (Enter defaults to Tasks conversion, including in place when already there; typing creates a new section; non-Tasks stays plain; empty non-Tasks source sections are removed) and for demotions from Tasks — cycle Blocked tasks out with option+[/option+], recover affected Blocked dependents, propagate Ctrl+Enter to embedded task transclusions, and preserve embedded-task behavior. Ctrl+Enter on a Task Link closes the linked task and strikes the link, embedded or plain. A versioned `api.recoverBlockedDependents` lets other plugins recover Blocked dependents without retiring references; dependents with a strictly future `scheduled` date stay Blocked, and Ctrl+Enter on a Task Link to a Cancelled task shows a notice instead of completing the owning Pomodoro. Depends-On lines (managed ⛓️ **DEPENDS ON:** child bullets) are never struck, restored, reformatted, or tree-closed: Ctrl+Enter closes or reopens the linked prerequisite only, and Alt+[ / Alt+] cycle the link under the cursor. Ctrl+Enter on the PRE/POST row the bob-navigation-hotkeys review walk just landed on hands off to nav api v2, which completes the row and advances within its group when another live row remains. Alt+[ / Alt+] on a Pomodoro Task Link instead toggles the linked task between Next and In Progress through the nav api.taskLinkLane v1 namespace, never reformatting the bullet. Closing a planned task recovers what it unblocked and offers to pull in successors (hand-offs, project residents, project-finished pull-ins) through nav `api.successors` v1 — gated on `[id::]`, through open editors or preimage-checked vault writes, honouring `plan.link_unblocked` — and reports it once: the Unblocked card through nav `api.notice` v1, the walk toast on review landings, or a plain not-pulled-in notice without nav. Reopening the predecessor the same day through Ctrl+Enter takes back untouched successor links and restores their statuses from an in-memory receipt; Alt+]/Alt+[ moves into Done join the same pass, while moves into Cancelled recover only. Project Schedule comes from the ^prj task; tagged #prj_is_blocked residents stay Blocked until project recovery, which strips the tag from every open resident including those that remain Blocked for their own reasons, never edits closed lines, and records [unblocked::] through ledger-tools v12 when available (otherwise it recovers with a console warning, including on the successor apply path). Alt+] / Alt+[ on a [?] ^prj that leaves the project with no remaining reason — a future date or an open Depends-On target resolved against the vault; a missing id never blocks — recover those open residents in the same gesture, including when Alt+[ cancels ^prj so the note is no longer project(T), and when the cycled ^prj is transcluded from another note. A tagged #prj_is_blocked ^prj inherits its parent project’s Blocked reason and cannot be cycled; closing its last open sub-project pulls in the parent ^prj. |
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
copied onto the Pomodoro that completion creates; and each Task Link
sub-bullet's sub-sub-bullets are copied as locally dated entries such as
`*2026-08-26* — Read research notes` into that link's task, under a
tab-indented managed `🛠️ **WORK LOG**` child bullet created when the task has
none. A Pomodoro close whose children are all deferred `#` links deletes the
closed entry instead of leaving it childless, carrying the stripped links to
the created placeholder.

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
task toggle `Ctrl+Shift+]>` / `Ctrl+}>` converts a task to or from a normal
bullet; a Vim count `N<Ctrl+Shift+]>` toggles the cursor item and the next N
sibling items together, prompting at most once and sending the whole group to
one section. Every eligible plain-bullet promotion in a note with an exact
`Tasks` section routes through a section picker (blank Enter chooses `Tasks`
and converts once to checkbox, `#task`, and `created`, including in-place when
the bullet is already there; other destinations keep the bullet plain).
Demoting from `Tasks` prompts for an existing or new destination; other
demotions go to the next Markdown section, and emptied non-`Tasks` source
sections are removed.

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

## Successor offers and take-backs

Closing a planned task recovers what it unblocked and offers to pull in
successors (hand-offs, project residents, project-finished pull-ins): the
Unblocked card, the walk toast on review landings, or a plain not-pulled-in
notice reports the outcome exactly once. Successor picks carrying a destination
override insert at the verified existing entry or a created `- [ ] () — NAME`
placeholder.

Reopening the predecessor the same day through `Ctrl+Enter` takes back
untouched successor links and restores their statuses from an in-memory receipt
— nothing is stored — deleting every open entry the take-back empties.
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
`successorNotice` line to the walk toast on review landings.

## Settings

This plugin adds no settings tab and reads no per-plugin settings. Lane,
schedule, and freshness inputs come from the task lines themselves and the
shared bob config file.

## Related

- [Task status hooks](https://bobs-org.github.io/task-status-hooks/) — how
  completion reconciles lanes and dependencies.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the
  Depends-On lines this plugin guards.
- [Projects](https://bobs-org.github.io/projects/) — project blocking and
  `^prj` schedules.
- [Freshness](https://bobs-org.github.io/freshness/) — the stamps completion
  writes.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the review walk and
  lane toggle this plugin hands off to.
- [Bob Ledger Tools](bob-ledger-tools.md) — the freshness stamper and
  successor-reporting surfaces.
