---
title: "Block ID Prompt"
description: "Create and manage block IDs and task links in Bob's Obsidian workflow."
---

Block ID Prompt helps create and manage stable block identifiers and task links in Obsidian.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Block ID Prompt |
| ID | `block-id-prompt` |
| Version | 1.33.3 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Prompt for custom block IDs and complete wiki block links to open tasks, with a plan-budget suffix. Ctrl+Shift+Enter refuses Depends-On ⛓️ **DEPENDS ON:** dependency lines. On inbox notes, Ctrl+Shift+Enter asks where the task goes before linking or unlinking, then moves it with the toggle applied (nav inboxRoute v1). Ctrl+Shift+Enter asks which of today's Pomodoros to link into (↵ = current/next, type to filter or name a new one). Project Schedule comes from the ^prj task; a future-scheduled ^prj link is refused only when its date is the sole remaining reason, dependency reasons are reported first, and a direct link raises a Ready ^prj to Next. A tagged #prj_is_blocked ^prj is refused as blocked by its parent project without raising prerequisites. Ctrl+Shift+Enter refuses LINKS with the relation notice and LINKED FROM with the generated-line notice; Pomodoro cleanup skips both. Link to today also offers recent themes with component swatches and near-duplicate hints; Ctrl+D hides or restores Recent suggestions only. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Rename selected block ID | `rename-selected-block-id` | Ctrl+6 |
| Toggle task Pomodoro link | `link-task-to-pomodoro` | Ctrl+Shift+Enter |
<!-- END GENERATED: commands -->

## Linking tasks to today

`Ctrl+Shift+Enter` (`link-task-to-pomodoro`) toggles the open task under the
cursor on link presence. An unlinked task opens the Link to today picker to
choose which of today's Pomodoros to link into: Enter takes the current or next
one, typing filters the list or names a new Pomodoro. A block ID prompt follows
when the task still needs one.

Today's open Pomodoros stay first. When the Ledger Tools `themes` catalog is
available, the picker also offers recent themes for new Pomodoros, with a
swatch for each `+` component and a `like NAME` hint on near-duplicates. A
recent row keeps its catalog spelling. `Ctrl+D` hides that theme from Recent
suggestions; the row remains as a reversible hidden suggestion. Typing the name
still works, and `Ctrl+D` on a Today row leaves it unchanged. A theme that
today's ledger uses only on a done or cancelled Pomodoro still shows as a
Recent row; only themes of the open Today rows are left out.

Linking applies lane changes: Ready and Blocked tasks become Next, while Next
and In Progress tasks stay unchanged. A `^^` task-picker link that is the sole
content of an open Pomodoro sub-bullet pulls a uniquely future-scheduled target
into today: it removes the target's `scheduled` date, promotes Blocked or Ready
to Next, and prepends a dated entry to an existing Schedule Log, never creating
one for a task that keeps none. The `Ctrl+Shift+Enter` flow applies the same
future-schedule and Schedule Log pull-forward.

New Pomodoro Task Links are inserted immediately after the entry's last child,
before any trailing blank separators. Every Pomodoro link cleanup deletes the
open entries it empties.

A linked task unlinks instead: its links under today's open Pomodoros are
removed without changing closed history, and the checkbox is never written.
Unlinking an In Progress task first opens an optional work-summary prompt titled
`Unlink task`; a nonblank summary is recorded as a locally dated entry such as
`*2026-08-15* — Added coverage` under a tab-indented managed `🛠️ **WORK LOG**`
child bullet.

## Task Link selection

`Ctrl+Shift+Enter` on a selected Task Link — a plain or embedded wiki block
link to a task, including 🍅-marked, `#` move-only, and struck `~~[[…]]~~`
forms — deletes the link and today's other open-Pomodoro duplicates. One link
per line is selected from anywhere on the line; several links are selected by
cursor. When the link is the bullet's only content, the whole bullet and its
children go with it.

Deleting a Task Link never changes the lane: Next, In Progress, Ready, and
Blocked all stay as they are. An In Progress target goes through the same
optional `Unlink task` Work Log prompt.

## Guards

`Ctrl+Shift+Enter` refuses several targets with a notice instead of writing:

- A Depends-On ⛓️ **DEPENDS ON:** line, including a malformed one with trailing
  prose, a half-typed link, or a prose-only label. The notice points to
  `Ctrl+Shift+P`, and no token is ever deleted there. A VS16 link-emoji shape
  is not a dependency line and takes the normal path.
- A 🧱 **BLOCKS:** mirror, including a malformed one, with the generated-line
  notice. Pomodoro scanners skip managed dependency lines.
- A `🪢 **LINKS:**` line with the relation notice, or a
  `🪢 **LINKED FROM:**` line with the generated-line notice. Pomodoro cleanup
  skips both relation lines.
- Closed targets and legacy transclusion children. Dependencies live on the
  Depends-On line, never as embedded children.

The task picker skips `#hide` tasks, lists Blocked `[?]` tasks in a separate
group beneath unblocked tasks, prunes duplicate links from future open
Pomodoros, and marks dependency-blocked tasks.

## Freshness, plan budget, and projects

`Ctrl+Shift+Enter` and `^^` stamp the target task's freshness
(`[fresh:: today]`) through Bob Ledger Tools whenever they rewrite its line.
Link, unlink, and Task Link notices append the live plan budget
(`· plan T/3 · L/10`, with 🔴 when over the cap) from Bob Ledger Tools.

Project Schedule comes from the `^prj` task. A future-scheduled `^prj` link is
refused only when its date is the sole remaining reason, with dependency
reasons reported first; a direct link raises a Ready `^prj` to Next. A tagged
`#prj_is_blocked` `^prj` is refused as blocked by its parent project without
raising prerequisites.

On an inbox note, `Ctrl+Shift+Enter` asks where the task goes before linking or
unlinking, then moves it with the toggle applied. A `Ctrl+Shift+Enter` link
from the row the review walk just landed on advances the walk once to the next
remaining item.

The plugin exposes the Link to today picker as `api.pomodoroLinkPicker` v1 so
the navigation successor picker can retarget rows per row.

## Settings

This plugin adds no settings tab. Block ID suggestions are generated from the
target task's headline and need no configuration.

## Related

- [Block ID defaults](block-id-defaults.md) — generated suggestions and collision handling.
- [Cross-plugin APIs](https://bobs-org.github.io/develop/plugins/plugin-apis/) — the Pomodoro link-picker interface.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the
  Depends-On line this plugin's guards defer to.
- [Plan](https://bobs-org.github.io/plan/) — the plan budget appended to link
  notices.
- [Task status hooks](https://bobs-org.github.io/task-status-hooks/) — how link
  changes reconcile lanes.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the Task Card and
  review walk this plugin hands off to.
