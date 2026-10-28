---
title: "Bob Navigation Hotkeys"
description: "Navigate and edit Bob notes with keyboard commands."
---

Bob Navigation Hotkeys adds keyboard commands for navigating and editing Bob notes.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Navigation Hotkeys |
| ID | `bob-navigation-hotkeys` |
| Version | 2.58.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Ctrl+Shift+P always opens the Task Card, a focused first screen with exact P-level previews. Ctrl+Shift+B is Ctrl+Shift+P then `b`: it opens the Task Card's Depends on stage for the task, a Task Link's linked task, or a counted `N<Ctrl+Shift+B>` batch; Esc, q, or Ctrl+[ close it without writing, and its More section opens a property's value stage. Ctrl+Shift+Alt+B is Ctrl+Shift+P then `⇧B`: it opens the Blocks stage for a task or Task Link, supports counted `N<Ctrl+Shift+Alt+B>`, and works from Depends-On and BLOCKS lines, where Ctrl+Shift+P on a BLOCKS line also opens the owner’s stage directly. On an inbox task every non-closing answer asks where it goes before writing and moves there. Open and manage related notes, tabs, and task properties, including priority levels that roll scheduled dates. Ctrl+Enter on the card takes the recommended roll, decay, or cancel from the previewed ladder, including counted and Task Link batches. Scheduling a date opens one combined Reason and Work summary review; a Pending or Next task can record an optional Work Log summary as a dated entry under a WORK LOG child. A Cancel action closes tasks as Cancelled with an optional reason kept in a first-child Cancel Log. Alt+F and Ctrl+Alt+F prompt Pending tasks for an optional Work summary. A single counted Ready ROTTEN or scheduled TICKLER keep asks why, then stamps and writes one Rotten Log entry in one undo; blank logs no reason given, and Esc cancels. Counted N<Alt+F> and Task Link sessions show one combined prompt when Rotten keep reasons or Pending/Next Work summaries apply; Work summary comes first, followed by Keep reason, and one Enter submits both. Each counted keep gets its own entry; at-limit targets still skip unstamped and unlogged. The decay card shows the logged keeps in its header and its Keep swaps the rows for the same in-card reason stage, committing stamp, increment, and entry in one undo; Esc returns to the choices. On a landed RECURRING row both write nothing, show the recurring-tier notice, and stay. Ctrl+Enter on the PRE/POST row the review walk just landed on completes it and advances within the group when another live row remains (nav api v3). `]s` / `[s` away from the current review task first return to it. The Task Card level strip and priority notices render the shared signal-bar priority mark through the bob-ledger-tools api.priorityMarks v1 namespace, falling back to the Lucide signal icons without it. Alt+[ / Alt+] on a Pomodoro Task Link toggles the linked task between Next and In Progress — asking once for an optional Work Log summary when moving back to Next — through the nav api.taskLinkLane v1 namespace. Closing a planned task opens one grouped successor picker when offers exist; nothing starts selected, and the cycler applies only chosen links. The pulled-in summary is shown through nav api.notice v1. Review-row closes append the cycler's additive `successorNotice` line to the walk toast. Journals each counted ]s answer, with its outcome, through the bob-ledger-tools api.stats namespace. Depends-On writes now mirror open dependents into generated 🧱 BLOCKS lines, in the same-note transaction or a checked cross-note follow-up, including counted, marked, Ctrl+D, hand-edit (and undo), conversion, and Ctrl+Shift+M paths. Adding an open prerequisite from Ctrl+Shift+P also removes the newly Blocked task's live links from today's open Pomodoros, deleting an emptied entry. Cmd+Enter on a reading task, Task Link, or managed embed opens its source_pdf in Highlights without vault writes, while other targets retain Obsidian’s new-tab behavior. Turns on Templater's device-local "Trigger on file creation" when it is unset, so Cmd+N and other new notes get the vault's folder template (_templates/new_note.md). Only the BLOCKS chips in bob-ledger-tools use nav `api.blocks` v1, for ＋ and hover ×. The nav api gains an additive `openReferencePdf(path)` member (Promise of `{ok, reason?}`; the api `version` is unchanged) so the bob-ledger-tools Reading Board can hand a reference PDF to Highlights without vault writes. `Z` (mapped in the vault vimrc) or the "Zoom image on cursor line" command opens the image on the cursor line — an embed, image link, or Markdown image — in a read-only full-window viewer with keyboard and mouse zoom and pan; it never writes the vault, and native image clicks are unchanged. Task relations use 🪢 LINKS and generated LINKED FROM rows; nav api.relations v1 opens either stage and removes live links. The Task Card offers Links to (l) and Linked from (⇧L), with Ctrl+Shift+L and Ctrl+Shift+Alt+L commands. CURRENT shows existing links or sources, Enter applies or removes, Shift+Enter edits a relation label, `~` in the filter flips direction, and Ctrl+D clears all outgoing Links to relations while refusing generated Linked from rows. Counted Ctrl+Shift+L applies one target to every selected source; reverse counted links are refused. Alt+P applies the Task Card recommendation in one key, stays hidden for immediate rolls and decays, and waits on the visible card before cancellation. `]s` landings end their toast with the `Alt+P` roll preview from nav `api.quickRoll` v1. Pomodoro move and rename pickers offer recent themes with component swatches and near-duplicate hints; Ctrl+D hides or restores Recent suggestions only. `]w` / `[w` (mapped in the vault vimrc) walk Pending, Next, and Ready tasks off today's plan — the dash PENDING/NEXT/READY sections — with a lane-colored toast and walk rail; `]W` / `[W` jump to the first task of the next / previous lane, cycling. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Bob: Relation labels | `open-relation-labels-manager` | — |
| Close other tabs | `close-other-tabs` | — |
| Close tabs to the left | `close-tabs-left` | — |
| Close tabs to the right | `close-tabs-right` | — |
| Commit to Next / release to Ready | `toggle-task-lane` | Alt+N |
| Copy active file path | `copy-active-file-path` | Mod+Y |
| Create project note | `create-project-note` | — |
| Create project note from task | `create-project-note-from-task` | — |
| Delete current file | `delete-current-file` | — |
| Duplicate current tab | `duplicate-current-tab` | — |
| Edit task dependencies | `edit-task-dependencies` | — |
| Insert blank line above | `insert-blank-line-above` | — |
| Insert blank line below | `insert-blank-line-below` | — |
| Jump to first task due for freshness review | `jump-to-first-due-task` | — |
| Jump to last task due for freshness review | `jump-to-last-due-task` | — |
| Jump to next Pending, Next, or Ready task off today's plan | `jump-to-next-lane-task` | — |
| Jump to next open task or move a Pomodoro down | `jump-to-next-open-task` | — |
| Jump to next section header | `jump-to-next-section-header` | — |
| Jump to next task due for freshness review | `jump-to-next-due-task` | Ctrl+Alt+J |
| Jump to previous Pending, Next, or Ready task off today's plan | `jump-to-prev-lane-task` | — |
| Jump to previous open task or move a Pomodoro up | `jump-to-prev-open-task` | — |
| Jump to previous section header | `jump-to-prev-section-header` | — |
| Jump to previous task due for freshness review | `jump-to-prev-due-task` | Ctrl+Alt+K |
| Jump to the first task of the next lane off today's plan | `jump-to-next-lane` | — |
| Jump to the first task of the previous lane off today's plan | `jump-to-prev-lane` | — |
| Move tab left | `move-tab-left` | — |
| Move tab right | `move-tab-right` | — |
| Move tasks to note | `move-tasks-to-note` | Ctrl+Shift+M |
| Open alt file note | `open-alt-file-note` | — |
| Open alternate file | `open-alternate-file` | — |
| Open child note | `open-child-note` | — |
| Open dash Tasks section | `open-dash-tasks` | Ctrl+0 |
| Open next link | `open-next-link` | — |
| Open parent note | `open-parent-note` | — |
| Open previous link | `open-prev-link` | — |
| Open reference PDF in Highlights (or link in new tab) | `open-reference-pdf-in-highlights` | — |
| Open template note | `open-template-note` | — |
| Pomodoro themes | `open-pomodoro-themes-manager` | — |
| Refresh task freshness (confirm it still looks right) | `refresh-task-freshness` | Alt+F |
| Refresh task freshness and jump to the next due task | `refresh-task-freshness-and-advance` | Ctrl+Alt+F |
| Rename current file | `rename-current-file` | — |
| Task card (set properties) | `set-bullet-property` | — |
| Task card: Blocked by (Depends on) | `task-card-depends-on` | Ctrl+Shift+B |
| Task card: Blocks (reverse Depends on) | `task-card-blocks` | Ctrl+Shift+Alt+B |
| Task card: Linked from (task relation) | `task-card-linked-from` | Ctrl+Shift+Alt+L |
| Task card: Links to (task relation) | `task-card-links` | Ctrl+Shift+L |
| Task card: Roll by recommendation | `roll-by-recommendation` | Alt+P |
| Toggle current tab pin | `toggle-current-tab-pin` | — |
| Toggle line transclusions | `toggle-line-transclusions` | — |
| Yank absolute path | `yank-absolute-path` | — |
| Yank absolute path with tilde | `yank-absolute-path-tilde` | — |
| Yank basename | `yank-basename` | — |
| Yank basename without extension | `yank-basename-without-extension` | — |
| Yank parent directory | `yank-parent-directory` | — |
| Yank relative path | `yank-relative-path` | — |
| Zoom image on cursor line | `zoom-image-on-line` | — |
<!-- END GENERATED: commands -->

`Ctrl+0` reuses an already open tab showing `dash.md` in any window before using
the current tab or opening a new one, including a background tab Obsidian has
not loaded yet. Pinned main-area tabs are preferred, followed by other main-area
tabs, pinned sidebar tabs, and other sidebar tabs.
When the current tab is a lower-ranked copy of `dash.md`, `Ctrl+0` switches to
the best-ranked tab and leaves that tab's scroll position untouched.

## Task Card

`Ctrl+Shift+P` always opens the Task Card: a focused first screen with exact
priority previews that closes on `Esc`, `q`, or `Ctrl+[`. There is no plugin
setting, no activation date, and no filtered property list — the card is the
only surface, and its actions open the existing stages and writers. On an inbox
task every non-closing answer asks where the task goes before writing and moves
there.

`Ctrl+Shift+B` is `Ctrl+Shift+P` then `b`: it opens the Task Card's Depends on
stage for the task under the cursor, a dedicated Task Link's linked task, or a
counted batch. `Ctrl+Shift+Alt+B` is `Ctrl+Shift+P` then `⇧B`: it opens the
Blocks stage for a task or Task Link, supports counted batches, and works from
Depends-On and BLOCKS lines, where `Ctrl+Shift+P` on a BLOCKS line opens the
owner's stage directly.

Any card gesture that writes closes the card. The card's Cancel action (`x`)
closes the task as Cancelled with an optional reason kept in a first-child
Cancel Log, pruning its links from today's open Pomodoros. The card level strip
and priority notices render the shared signal-bar priority mark, falling back
to Lucide signal icons without the ledger-tools namespace.

## Navigation and counts

`Ctrl+Shift+J/K` navigates Ready, In Progress, and Next `#task` lines while
skipping Blocked `[?]` tasks — except on an open current or future Pomodoro
entry, where the same chord instead moves that Pomodoro and everything it owns
down or up among adjacent future Pomodoros, keeping the current slot's time
range with whichever entry is promoted there and refusing (with a notice,
without jumping) to cross the current/history boundary or the last future
Pomodoro. A `N<Ctrl+Shift+J/K>` count moves a current or future Pomodoro
exactly N positions atomically, or jumps to the Nth circular navigation target
elsewhere.

Normal-mode Enter on a link records a file-aware jump in a 100-entry session
history shared with native jumps: `Ctrl+O` returns to the originating note and
exact cursor, `Ctrl+I` goes forward without undoing the move, counts traverse
multiple entries, new jumps replace the forward branch, and same-note
heading/block and already-open tabs round-trip. Tab, insert, and visual Vim
behavior is unchanged.

## Pomodoro gestures

The same move keymap on a Pomodoro sub-bullet moves that bullet plus the next N
siblings, each carrying its descendants, into another open Pomodoro in the same
note — or into a new `- [ ] () — NAME` Pomodoro created directly below the
current one from a typed, uppercased, em-dash-stripped picker name. Typing `=`
creates a fresh destination with the source Pomodoro's normalized name when the
source is named; typing `=NAME` peels every matching `NAME` component from a
merged source into a new placeholder containing the selected bullet subtrees.
Exact duplicate destination bullets merge away, and moving out a source's last
owned content deletes that Pomodoro entry instead of leaving it behind. Nested
`#task` lines under Pomodoro entries route to the Pomodoro move.

On a Pomodoro entry line itself the keymap opens a picker: Enter on another
open Pomodoro keeps the existing whole-entry move/delete behavior, typing a new
name renames the entry in place, and `Ctrl+X` on a highlighted open
current/future Pomodoro merges entries in one undoable edit (a current timed
entry survives and absorbs the selected future one; names combine
survivor-first with ` + ` up to 48 characters). Any count is accepted but
ignored since the operation is whole-entry.

Both pickers keep today's open Pomodoros first and offer recent themes for new
destinations or renames when the Ledger Tools `themes` catalog is available.
Recent rows keep catalog spelling; `+` components show their theme swatches,
and typed near-duplicates show a `like NAME` hint. `Ctrl+D` hides a Recent
suggestion and leaves a reversible hidden row; on a Today row it has no effect.
A theme that today's ledger uses only on a done or cancelled Pomodoro still
shows as a Recent row; only themes of the open Today rows (and, for rename,
the entry being renamed) are left out.

The **Bob: Pomodoro themes** command (no default hotkey) opens the themes
manager, with Active, Hidden, Possible duplicates, and All views on `Tab`.
Collision hints sit on top; rows carry today, hidden, pinned, exempt, hue, and
reappeared badges. `Ctrl+D` hides or restores the selected theme, `Enter`
offers rename, color, hide, and occurrences, and single keys (`r`/`c`/`h`/`o`
with an empty filter, `1`–`8`/`a` in the color list) jump straight there.
Rename previews the one-commit rename before applying; occurrences lists daily
notes and opens the entry. History and writes need the desktop app, where the
Ledger Tools `themes` catalog is available.

The **Bob: Relation labels** command manages the relation-label vocabulary
without a link gesture. Choose a label to hide or unhide it, or open the
previewed rename flow. The relation-label stage also uses `Ctrl+R` to rename
the selected existing label; it checks affected open editors before preview and
write, and requires explicit confirmation before merging labels.

## Task properties, dependencies, and moves

`Ctrl+Shift+P` edits scheduled, dependency, and priority task properties, with
priority levels that roll scheduled dates, report the exact rolled ISO
date/span and its distance from today, and offer date-picker re-roll
suggestions. Choosing a `scheduled` date opens one combined Reason/Work summary
review that records the optional reason as a nested entry under a Schedule Log
child bullet — an empty reason on a task that already keeps a log records `🤷
no reason given`, while a task with no log yet is left untouched. Choosing a
priority level or the pinned roll suggestion writes immediately with its own
deterministic reason. Giving a task a strictly future `scheduled` date removes
its live links from today's open Pomodoro entries. `N<Ctrl+Shift+P>` edits the
current task plus the next N real tasks; on a dedicated Task Link bullet the
same keymap edits the linked task in its own note instead.

Dependency writes go through one managed ⛓️ **DEPENDS ON:** first-child line
per task, committed in one undoable edit: adding an open prerequisite marks
the dependent Blocked, raises the target to its lane, and removes the
dependent's live links from today's open Pomodoros together with any emptied
entry. Cleanup deletes an open Pomodoro entry it empties, while entries with
prose children and untouched placeholders remain. Removing the last open
prerequisite recovers the dependent immediately when it has no future
`scheduled` date. `Ctrl+D` on the Depends-On row deletes that line and the
`[dependsOn::]` field in one writer transaction, leaving other child content
untouched, with immediate recovery. Hand edits are mirrored once the cursor
leaves the edited line; malformed lines are left alone. BLOCKED stage rows
show `🔒 waits on N` for one or more open prerequisites, otherwise
`🔒 scheduled YYYY-MM-DD` when a date blocks the task, otherwise `🔒 blocked`.
The Depends on value stage searches every open task in the vault, reachable from a task
line, the Depends-On line itself, a chip, a Task Link, or the `Edit task
dependencies` palette command. Blockquoted tasks refuse dependency edits.
Answering the landed review row advances the walk once to the next remaining
item.

Bare `Ctrl+Shift+M` moves the current task and focuses the destination note on
the moved task; `N<Ctrl+Shift+M>` moves it plus the next N movable tasks. A
move never advances the review walk, even from a landed row: the next `]s` /
`[s` resumes at the moved row's walk neighbour, with `Ctrl+O` returning to the
post-removal source seam and `Ctrl+I` returning to the first moved task without
undoing the move.

Project conversion and reversal keep Depends-On and inline dates on task lines.
Promoting a task with real project tasks expands each live dedicated Pomodoro
Task Link into one sibling link per new project task, while history, past
dates, struck links, and prose rewrite one-to-one to `^prj`. Project schedules
propagate to task-level `scheduled` properties and Blocked status, and
`#prj_is_blocked` follows `^prj`'s post-gesture status. Dependency additions
and removals update the generated 🧱 BLOCKS mirrors, governed by
`dependencies.blocks_lines` in the shared bob config file (default on; set it
to `false` to stop navigation gestures from writing BLOCKS lines).

**Create project note from task** converts an open task in an area or project
note. Its `Ctrl+Shift+Alt+N` shortcut from the original README is a custom
vault binding, not a registered default or a plugin keydown handler. The same
command on a project's `^prj` task converts the note back into a parent-task
block in the parent's `## Tasks` section, carrying its tasks, section bullets,
and project-task subtree, repointing `#^prj` links, then trashing the project
note. If backlink rewriting fails, the restored task remains and the project
note is kept with a notice.

When promoting a task, an unchecked, ALL-CAPS direct child bullet becomes a
title-cased `##` section only when it has its own nested list items. The
converter reuses a matching heading case-insensitively or appends a new one;
it copies descendants as notes rather than `#task` lines. Other eligible
child bullets become tasks. Managed Schedule Log and Work Log subtrees move
under the new `^prj` task in source order. If child content cannot be moved
losslessly, the source task is kept and a notice explains the partial result.
Task Card Depends on and Schedule edits on a `^prj` with sub-projects cascade
top-down with preimage-checked writes and report
`· N sub-projects Blocked / Ready again / not updated`.

`Alt+N` commits Ready to Next or releases Next/In Progress to Ready on the
current task plus the next N tasks (or the linked task plus the next N sibling
Task Links), unlinking released tasks from today and reporting the NEXT/PENDING
counts with the weekly-review hint when over the cap. `Alt+[` / `Alt+]` on a
Pomodoro Task Link toggles the linked task between Next and In Progress,
asking once for an optional Work Log summary when moving back to Next.

## Review walk

`Ctrl+Alt+J/K` walks the tiered freshness review queue PRE → NEW → PROJECTS →
PENDING → NEXT → RECURRING → TICKLER → ROTTEN → POST vault-wide, wrapping with
a notice. `N]s` / `N[s` jump N review-queue entries in one landing. `]s` /
`[s` (and `Ctrl+Alt+J/K`) away from the current review task first return to it
with a `Back to current review task` toast; `<C-o>` goes back, and the next
press steps from the task. `[S` / `]S` jump to the first/last queue entries
without wrapping.

Before a same-pane note switch, the plugin saves the active note and checks its
disk text against the editor. A failed save or mismatch keeps the current note
open. If a landing opens with the previous note's text, a sticky warning stops
the walk; the plugin also checks again after Obsidian's save debounce. See the
Bob CLI vault-git-sync docs under “Clobbered notes” for recovery steps.

`Alt+F` and `Ctrl+Alt+F` stamp the cursor task, or the target of a dedicated
Task Link, through Ledger Tools' `keepLine`; a count also includes the next N
targets. An exact due Ready keep counts once; uncounted keeps preserve the
streak. A single counted ROTTEN or scheduled TICKLER keep first asks “Why keep
it as written?” The prompt shows the streak separately from the number of
keeps logged, previews the exact entry, and shows up to three earlier reasons.
Enter stamps, increments the streak, and writes one dated entry under
`🥀 **ROTTEN LOG**` in one undo step. A blank reason logs `🤷 no reason given`;
Esc writes nothing and retains the walk position. Alt+F stays, while Ctrl+Alt+F
advances after the write. If the note or local day changes while the prompt is
open, the keep is refused. Multiple Rotten Log markers also refuse the write.

NEW, early/FRESH, Pending, Next, PROJECTS, recurring, checklist, closed, and
unblock-tickler rows never ask for a keep reason or write a Rotten Log.
Pending tasks retain their optional Work summary prompt. Generic human stamps
clear the keep streak, independently of the logged history.

A single exact, due, at-limit source task opens the approved decay decision
card before any keep-reason prompt and writes nothing. The card header shows
`🥀 N keeps logged · last <date> — <reason>` when the task has logged keeps,
and its Keep row (`say why · logs 🥀 · asks again next review`) swaps the rows
for the same in-card reason stage instead of closing: Enter commits the stamp,
the increment, and one Rotten Log entry in one undo step, while Esc returns to
the card's choices and a second Esc writes nothing. If the card is
unavailable, the single keep uses the reason prompt and combined log write.
Counted `N<Alt+F>` and Task Link sessions show one prompt when counted Rotten
keeps or Pending/Next work are present. A mixed prompt puts Work summary first
and Keep reason second; one Enter submits both, routing each answer only to its
own log. The shared keep reason writes one entry per counted Rotten target.
At-limit targets still skip unstamped and unlogged with `N needs a decision`;
duplicate Task Links to the same source are handled once. If any prompt is open,
the active note, each linked note, and the local day are rechecked before writing.

On the exact PRE/POST row the walk just landed on, `Ctrl+Enter` completes
through the cycler and advances within the group. `Alt+F` completes a
checklist row in place; `Ctrl+Alt+F` completes and advances. On a landed
RECURRING row both write nothing, show the recurring-tier notice, and stay;
`Ctrl+Enter` completes and `Ctrl+Shift+Enter` links to Today, each advancing
once. POST multi-row reviews advance with `Ctrl+Enter` or `Ctrl+Alt+F`, and the
review closes on the last row. A resolving commit on a landed review row
advances the walk once to the next remaining item. Every `]s` landing on an
eligible row ends its toast with the `Alt+P` roll preview (for example
`Alt+P roll P2 1/1 · 8–30d`), naming the level, step or decay, and window
the key would use. In the successor picker,
`Ctrl+Shift+Enter` retargets the marked rows through the Block ID Prompt
picker.

`Alt+N`, the Task Card property rows, and `Ctrl+Shift+M` moves stamp every
rewritten open task through the ledger-tools stamper. The Task Card's Review
every action sets or clears `[refresh:: N]` through the same namespace,
reading lane intervals with the task's own refresh kept as the once-Ready
return value.

## Lane walk

`]w` / `[w` walk the vault's PENDING (`[/]`), NEXT (`[*]`), and READY
(`[ ]`) tasks that have no Task Link under today's open Pomodoros. These
are exactly the tasks counted by the `PENDING n/cap`, `NEXT n/cap`, and
`READY n/cap` chips and listed in the dash's `### PENDING Tasks`,
`### NEXT Tasks`, and `### READY Tasks` sections. NEW and ROTTEN Ready
tasks stay with `]s`; they are not in the READY lane. The walk lists
PENDING first, then NEXT, then READY, in dash order; inside a lane it
moves top to bottom through each note.

Each press steps one entry from the cursor when the cursor is on a live
entry, else from today's anchor when the anchored task is still listed in
the same lane, else by inserting the anchor's `(lane, path, line)` tuple
into the current sort order and continuing from there. When the cursor or
a live anchor resolves to a task whose current lane differs from the
anchor's lane (for example after `Alt+N` released a landed NEXT task to
Ready), the origin stays the anchor tuple in the **anchor's** lane, so the
walk does not teleport into the new lane. With no origin, `]w` lands on
the first entry and `[w` on the last. Steps wrap at the ends and the toast
names the wrap. `N]w` / `N[w` take N steps in one landing.

`]W` / `[W` jump to the first task of the next / previous non-empty lane
and cycle at the ends (READY → PENDING, PENDING → READY). Empty lanes are
skipped. From mid-lane, `[W` lands on the previous lane's first task, not
the current lane's. `N]W` / `N[W` take N lane steps with cycling. With
only one non-empty lane, the jump lands on that lane's first task and
marks the wrap.

Each landing shows a lane-colored toast with the lane pill and `laneRank of
laneTotal`, the whole-walk `rank/total` receipt, a walk rail (dots up to 30
entries, a split bar beyond that highlights the current lane), the task
title, the note name, the latest Work Log entry (or the created date), and
a lane-aware hint: PENDING / NEXT keep `Ctrl+Shift+Enter today · Alt+N
release`; READY uses `Ctrl+Shift+Enter today · Alt+N next`. The READY
toast uses the READY chip's blue and an empty `[ ]` checkbox glyph. When
Ready tasks are waiting in NEW or ROTTEN the empty card reads `Ready tasks
are waiting in review` with a `REVIEW n` chip and a `]s` hint; when every
Pending, Next, and Ready task is on today's plan it reads `Lanes clear`
with a `TODAY m` chip; with none of those tasks at all it reads `No
Pending, Next, or Ready tasks`. The walk never writes and never sets or
advances the `]s` review walk.

## Relation-label stage

The Links and Linked-from relation-label stage adds a `⊘ cancels` cue to
configured cancel-label suggestions, including labels with no previous use.
The live sentence dims and prefixes the source task with `⊘`, the consequence
strip names the task and the Task Card Cancel effects, and Return reads
`↵ link & cancel`. Recurring sources show a disabled row with the Obsidian
Tasks instruction; inverse phrases explain that they never cancel and point to
`⇧L`. A counted commit that cancels two or more tasks waits for a second Return.

Hand-editing a configured cancel label into LINKS leaves an open task open and
shows a hint to use the relation stage or capture. Unlinking a cancel-label
edge or relabelling it away keeps a cancelled task cancelled; reopen it with
`Alt+]`. See [Task relations](task-relations.md) for the full behavior.

## Notes, tabs, and keyboard layers

The plugin opens and manages related notes and tabs, including pinned-tab
preserving sibling closes, and registers the read-only `obsidian://bob-goto-task`
and `obsidian://bob-open-notes` protocol handlers so external picks land the
caret without writing the vault. `Cmd+Enter` on a reading task, Task Link, or
managed embed opens its PDF in Highlights without vault writes; other targets
keep Obsidian's new-tab behavior. In Vim normal mode, `Z` opens the image on
the cursor line in a read-only viewer. Bare and counted `!` only toggle
transclusion markers and are refused on dependency lines with a notice pointing
to `Ctrl+Shift+P`. Managed reference notes under `ref/` with a nonempty
`source_pdf` must be renamed with `bob ref rename`; ordinary file rename does
not move their PDF, reading task, and links together.

Three keyboard layers are in play, and they are not the same thing:

- **Registered palette commands with defaults** are listed in the generated
  table above (`Alt+N`, `Ctrl+0`, `Ctrl+Alt+J/K`,
  `Ctrl+Shift+M`, `Ctrl+Shift+B`, `Ctrl+Shift+Alt+B`, `Mod+Y`, `Alt+F`,
  `Ctrl+Alt+F`). An absent `hotkeys` field means no registered default, not an
  absence of all keyboard behavior.
- **Custom vault bindings** live in the vault's `.obsidian/hotkeys.json` or
  `obsidian_vimrc.md`, not in this plugin. In particular, the vimrc maps `Z`
  to `bob-navigation-hotkeys:zoom-image-on-line`, and the vault binds
  `bob-navigation-hotkeys:open-reference-pdf-in-highlights` to `Meta+Enter`;
  that binding is custom vault configuration, not a registered plugin default.
  A registered default would lose to Obsidian's built-in `Mod+Enter`. Do not
  re-record the binding in Obsidian Settings on a Mac: Obsidian may save `Mod`,
  which would claim `Ctrl+Enter` on other platforms.
- **Editor and Vim handlers** act below the palette layer. The plugin maps
  `\s` in Vim normal mode to toggling the current tab pin (Bob Ledger Tools
  owns the distinct `\p` mapping for Pomodoro increments), and its
  editor/Vim-aware dispatch narrows capture-phase fallbacks to match the
  vault's bindings exactly.

## Settings

This plugin adds no settings tab. It honors the shared bob config file
(`plan:` lane caps, `freshness:` decay and intervals, and
`dependencies.blocks_lines` for BLOCKS mirror writes) and per-note
`task_refresh` frontmatter.

## Related

- [Task Card](task-card.md) — property editing controls and scheduling input.
- [BLOCKS dependency mirrors](blocks-mirrors.md) — reverse dependency rows.
- [Go to task URI](goto-task-uri.md) — open a note at a searched line.
- [Open notes URI](open-notes-uri.md) — open a batch of notes.
- [Open reference PDF in Highlights](highlights.md) — open reading PDFs.
- [Zoom an image on the cursor line](image-zoom.md) — inspect the image on the current line.
- [Templater new-note trigger](templater-trigger.md) — device-local trigger handling.
- [Cross-plugin APIs](https://bobs-org.github.io/develop/plugins/plugin-apis/) — navigation and successor interfaces.
- [Task move](https://bobs-org.github.io/task-move/) — the move semantics
  behind `Ctrl+Shift+M`.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the
  Depends-On line and BLOCKS mirrors.
- [Task status hooks](https://bobs-org.github.io/task-status-hooks/) — how
  lane changes reconcile.
- [Projects](https://bobs-org.github.io/projects/) — project notes and
  `^prj` scheduling.
- [Freshness](https://bobs-org.github.io/freshness/) — the review queue and
  stamp model.
- [Plan](https://bobs-org.github.io/plan/) — the NEXT/PENDING caps reported by
  lane toggles.
- [Block ID Prompt](block-id-prompt.md) — the Today-link picker this plugin
  retargets.
- [Task Status Cycler](task-status-cycler.md) — the completion gestures the
  walk hands off to.
- [Bob Ledger Tools](bob-ledger-tools.md) — the marks, chips, and freshness
  state this plugin renders through.
