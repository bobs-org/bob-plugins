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
| Version | 1.62.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Complete Pomodoros while carrying worked-on/deferred links, narrowing the closed name to worked types and shedding uncarried types from the created Pomodoro, and copying each Task Link sub-bullet's sub-sub-bullets into the linked task's Work Log, toggle empty Pomodoro placeholders/sub-bullets with Ctrl+Alt+] including named placeholders, toggle Obsidian tasks with Ctrl+Shift+] (a Vim count N<Ctrl+Shift+]> toggles the cursor item and the next N sibling items together, prompting at most once and sending the whole group to one section) — always prompting for promotion destinations when exact Tasks exists (Enter defaults to Tasks conversion, including in place when already there; typing creates a new section; non-Tasks stays plain; empty non-Tasks source sections are removed) and for demotions from Tasks — cycle Blocked tasks out with option+[/option+], recover affected Blocked dependents, propagate Ctrl+Enter to embedded task transclusions, and preserve embedded-task behavior. Ctrl+Enter on a Task Link closes the linked task and strikes the link, embedded or plain, including under a closed Pomodoro, where the 🍅 is dropped on close and restored on reopen. A versioned `api.recoverBlockedDependents` lets other plugins recover Blocked dependents without retiring references; dependents with a strictly future `scheduled` date stay Blocked, and Ctrl+Enter on a Task Link to a Cancelled task shows a notice instead of completing the owning Pomodoro. Depends-On lines (managed ⛓️ **DEPENDS ON:** child bullets) are never struck, restored, reformatted, or tree-closed: Ctrl+Enter closes or reopens the linked prerequisite only, and Alt+[ / Alt+] cycle the link under the cursor. Ctrl+Enter on the PRE/POST row the bob-navigation-hotkeys review walk just landed on hands off to nav api v2, which completes the row and advances within its group when another live row remains. Alt+[ / Alt+] on a Pomodoro Task Link instead toggles the linked task between Next and In Progress through the nav api.taskLinkLane v1 namespace, never reformatting the bullet. Closing a planned task recovers what it unblocked and offers successor choices through nav `api.successors` v3 (hand-offs, project residents, project-finished pull-ins, keep-moving rows for leaf sub-projects when `plan.keep_moving` is enabled, and configured `relations.successor_labels` standing offers on managed Done and on Unlink of a Pending task with no live Task Link left today through `api.offerParkedSuccessors` (api v4)) — dependency and project offers gated on `[id::]`, relation offers from accepted LINKS even without ids — through open editors or preimage-checked vault writes, honouring `plan.link_unblocked` — and reports the result through nav `api.notice` v3 for relation and keep-moving rows (plain relation copy when notice is older than v3), the existing Unblocked card for other rows, the walk toast on review landings, or a plain notice without a compatible nav API. Reopening the predecessor the same day through Ctrl+Enter takes back untouched successor links and restores their statuses from an in-memory receipt; Alt+]/Alt+[ moves into Done join the same pass, while moves into Cancelled recover only. Project Schedule comes from the ^prj task; tagged #prj_is_blocked residents stay Blocked until project recovery, which strips the tag from every open resident including those that remain Blocked for their own reasons, never edits closed lines, and records [unblocked::] through ledger-tools v12 when available (otherwise it recovers with a console warning, including on the successor apply path). Alt+] / Alt+[ on a [?] ^prj that leaves the project with no remaining reason — a future date or an open Depends-On target resolved against the vault; a missing id never blocks — recover those open residents in the same gesture, including when Alt+[ cancels ^prj so the note is no longer project(T), and when the cycled ^prj is transcluded from another note. A tagged #prj_is_blocked ^prj inherits its parent project’s Blocked reason and cannot be cycled; closing its last open sub-project pulls in the parent ^prj. LINKS and LINKED FROM rows are not Pomodoro Task Links; Ctrl+Enter and Alt+] / Alt+[ act on their target root-only without formatting the row. Ctrl+Enter on a timed Pomodoro stamps the closed row `[off:: Nm]` when every Task Link it keeps is `#offclock` (aliases `#off-clock`, `#untracked`) and `[t:: Nm]` otherwise, with a notice when a session stays on the clock while linking an off-clock task; timed MEET closes place the carried continuation after the last open Pomodoro and leave the cursor on the next open entry. Requirement lines refuse gestures with the contract copy; Alt+[ drops with a reason and Alt+] restores. Ctrl+] toggles a note and a requirement under a task, with the first requirement scooping loose notes into NOTES, and typing `- [` then space expands to `- [ ] ` with overtype absorption, atomic Backspace, Vim insert support, and one Undo back to the plain space. Closing a Gmail Task through Ctrl+Enter, Alt+[ / Alt+], a counted range, a Task Link, a transclusion, a Pomodoro cascade, an offer-close, or a checkbox click opens the Mail Close Card first. Only `y` confirms; any other key keeps the task open. Without Bob Navigation Hotkeys the close is refused. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Cycle task status backward | `cycle-task-status-backward` | — |
| Cycle task status forward | `cycle-task-status-forward` | — |
| Open child bullet line above | `open-child-bullet-line-above` | — |
| Open child bullet line below | `open-child-bullet-line-below` | — |
| Toggle Drawer | `toggle-task-drawer` | — |
| Toggle Obsidian task | `toggle-obsidian-task` | — |
| Toggle Pomodoro placeholder/sub-bullet | `toggle-pomodoro-bullet` | Ctrl+Alt+] |
| Toggle task checkbox marker | `toggle-task-checkbox-marker` | — |
| Toggle task open/done | `toggle-task-open-done` | — |
<!-- END GENERATED: commands -->

## Completing Pomodoros and tasks

`Ctrl+Enter` on a Pomodoro completes it: only dedicated Task Link bullets
(body is exactly one `[[path#^id]]` or `![[path#^id]]` after stripping 🍅,
one trailing `#`, and one enclosing `~~…~~`) carry or wear 🍅. Prose bullets
that mention a task stay in the closed session as history and are never
copied or marked. Worked-on dedicated links carry above deferred
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
Pomodoro close whose children are all deferred `#` links keeps the closed
`[x]` entry with its recorded minutes, matching `bob capture x`, while
carrying the stripped links to the created placeholder.

When Ctrl+Enter closes a MEET that carries later meetings with an open
Pomodoro below it, the created continuation moves after the last open
Pomodoro block. The cursor moves to the first open Pomodoro below the closed
entry so planned work stays next.

On a timed Pomodoro close the closed row is stamped with the clock its links
put it on, by the same counted-links rule `bob capture` uses (pinned by bob-cli's
shared `pomodoro_clock` vectors): the closed row gets `[off:: Nm]` iff every
Task Link it keeps resolves off-clock — `#off` (deprecated aliases `#offclock`,
`#off-clock`, `#untracked`), or an inherited area/project clock declaration on
the task's root walk, with `#on` as an override. A non-empty `offclock_types`
list off-clocks only tasks whose effective type is listed and takes precedence
over `offclock:` on the same note; an invalid list stays on the clock. Without
a list, `offclock: true|false` decides as before. Effective type follows the
task's `[type::]` / legacy `[theme::]` field, the reading-task rule, the nearest
`task_type:` / `theme:` note default, then `plan.default_type`. The close writes
`[t:: Nm]` when that rule keeps the session on the clock. It reads the decision through ledger-tools
`api.pomodoroClock` v1 when the plugin is present, and falls back to the
line's tags when it is not. The links it keeps are the direct-child
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

Under a closed Pomodoro (`- [x]` / `- [X]` at column 0 in `## Pomodoros`) the
same gesture still closes or reopens the linked task and never changes the
Pomodoro row: checkbox, span, `[t::]` / `[off::]`, and name stay put.
`🍅 [[X]]` becomes `~~[[X]]~~` (the 🍅 is dropped); pressing again restores
`🍅 [[X]]`, adding the marker when it was missing on a dedicated Task Link
bullet. Mentions stay unmarked on both strike and restore. A live dedicated
plain link whose task is already Done is retired in place as `🍅 ~~[[X]]~~`
with no task write; the next press hits the struck form and reopens both.

```markdown
- [x] (**0920-0950** [t:: 30m]) — DEEP
	- 🍅 [[Tasks#^a|Alias]]
```

Ctrl+Enter writes `\t- ~~[[Tasks#^a|Alias]]~~`. Ctrl+Enter again writes
`\t- 🍅 [[Tasks#^a|Alias]]`.
Closing a Gmail Task through Ctrl+Enter, Alt+[ / Alt+], a counted range, a
Task Link, a transclusion, a Pomodoro cascade, an offer-close, or a checkbox
click opens the Mail Close Card first. Only `y` confirms; any other key keeps
the task open. Without Bob Navigation Hotkeys the close is refused.
Checkbox clicks resolve in Live Preview and Reading view including splits and popouts; the token covers subsets when lines shift.
`Ctrl+Enter` on a task line wrapping an embedded block transclusion closes or
reopens the transcluded source task too. When the transcluded target lives in
a `done/` archive, reopening restores it to its bound source note with
`bob task restore -r` instead of reopening it in place, so no open task is
left inside `done/`; when the restore fails the archived task stays closed
and a notice shows bob's message.

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

Bank month-note rows are ordinary acknowledgment checkboxes, not tasks: cycle,
complete, counted and Vim toggles, completion handlers, transclusion writers,
and demotion paths all refuse them with a notice instead of stamping
freshness, status fields, or completion metadata. Ctrl+Enter on a waiting
row feature-detects ledger-tools `api.bank` v2 `claimRowClose` and opens the
Category card; a missing, older, false, or throwing claim falls back to
today's `[ ]`↔`[x]` flip. A ticked row still unticks. The guard stays active
when Bob Ledger Tools is disabled. See [Bob Ledger Tools](bob-ledger-tools.md)
for the Category card, bank commands, and ID-less acknowledgment semantics.

## Successor offers and take-backs

Closing a planned task recovers what it unblocked and offers to pull in
successors (hand-offs, project residents, project-finished pull-ins, and
configured relation-label standing offers): the Unblocked card, the walk toast
on review landings, or a plain not-pulled-in notice reports the outcome
exactly once. Successor and recovery pools skip `_conflicts/`, `_generated/`,
`_templates/`, and dot-directories, matching bob capture. Successor picks
carrying a destination override insert at the verified existing entry or a
created `- [ ] () — NAME` placeholder.

With navigation `api.successors` v5 and `api.landOnTask`, the successor card can
pin one offered task with Ctrl+J. The pin is independent of its Leave, Pull In,
Done, or Cancel choice. After the managed Done writes, reference retirement, and
notice finish, the cycler finds the task by its post-write identity and lands on
it. A Task Link Ctrl+Enter close finalizes in return mode, strikes the link,
then lands, so a cross-note jump never strands the strike. A stale Pull In pick
is left open and still remains a valid jump target. The pin stays hidden from
walk-composing callers until they opt in with `successorJumpTarget: "return"`
and nav `reviewWalk` v2; those callers receive the jump for
`reviewWalk.continue(..., { follow })` to park the walk and land, and the
walk-return card omits the jump line so only the follow toast shows it. A Left
pin resolves from the fresh plan row for its key, falling back to the card
offer only when the fresh plan lacks the key. The parked-successor picker also
lands on its pin after showing its notice, or returns it for the inbox-route
move to land after.

With navigation `api.successors` v4, the picker can also close an eligible
offered task as Done or Cancelled. Each choice is re-read and checked against
the card's line before it writes; a changed row is refused on its own, while
other valid choices can still apply. Bob's ordinary recovery of the row while the card is open still counts as the card's line. A successful close recovers only what
that task unblocks and does not start another successor round. The v4
Unblocked notice carries an Undo snapshot; older notice APIs receive plain
text listing every close, refusal, and recovery. From the review walk, the
receipt stays available with Undo and resolved tasks are skipped by identity
while the walk advances once from its original landing.

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
SUBOPEN prefers a `[!projects]` catalog when the note has one: a catalog row
is open unless its leading glyph is ✅ or ❌, including ⚠️ rows. With no
catalog it falls back to the legacy `🧩 **Sub-projects:**` marker. A
malformed `[!projects` opener is treated as open. The shared vectors live in
`plugins/task-status-cycler/scripts/fixtures/project_catalog/vectors.json`.

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

## Requirement lines

Requirement lines are checkboxes without `#task` owned by a real task. Every
cycler gesture refuses on one with the contract copy and writes nothing:
Ctrl+Enter shows the owner copy, Ctrl+Shift+] and counted ranges show the lane
copy, and carried `[>]` stubs show the carried copy. Alt+[ drops a pending req
through a reason prompt (Log Recall attached when nav exposes it) and Alt+]
restores a dropped req; each writes the writer twin's bytes as one undo step.
The transcluded tree close (Ctrl+Enter through a Pomodoro transclusion) never
checks a line without `#task`, matching bob-cli, while still walking that
line's embedded children.

### Requirement close card

A managed Done write opens the requirement-first card for each non-recurring
owner with Pending reqs when Navigation Hotkeys exposes successor picker API
v6. This includes idless owners; the cycler snapshots their pre-close path,
1-based line, and canonical `task_key` without minting an ID. The local
Ctrl+Enter toggle, `completeTaskAtCursor`, single and counted cycles, and
managed callers that pass `context.reqCloseOwners` use the same close path.
Req-less idless closes keep the no-extra-scan path. Cancelled, parked, and
offer-close verdicts do not open the card. With an older or missing picker,
the task still closes and the req bytes are left alone.

The task close is already written when the card opens. Submission applies
requirement carries, then drops, completes close bookkeeping and receipts,
applies any pull-in links, and resolves a pinned requirement landing last.
Before applying the staged choices, the cycler re-reads the owner and its req
lines against the captured post-close snapshot; moved or edited rows refuse
instead of targeting a new line. Only the owner block and its req rows count
as stale: changes elsewhere in the note, including Bob Project Tasks refreshing
`open_task_count` or a vault sync, do not refuse. A refusal always shows a
`⚠ Requirements unchanged: …` receipt. API line values are 1-based; conversion
to the editor's 0-based line happens at the editor boundary.

Drop, Carry, and ordinary offer-close receipts share one guarded Undo action.
It restores the requirement writes and ordinary offer-close writes together
while every affected note still matches the postimage, and leaves the
initiating owner Done. Reopening the task later that day takes back only the
untouched successor links recorded by the close pass; it does not undo a Drop
or Carry choice. Esc closes the card without writing requirement bytes.

### Ctrl+] note and requirement toggle

Ctrl+] (the command and the Vim mapping) toggles a list item between a note and
a requirement when it lives inside a `#task` block, through the same writer twin
as Alt+[ and Alt+]. On a plain list item whose structural parent chain reaches
a real `#task` line it makes a requirement; on a requirement it makes a note.
Depth-1 moves follow the contract: a new requirement lands at the end of the
reqs zone, and a depth-1 requirement turned into a note files into `NOTES`
(created only when a note lands there). A requirement nested deeper converts in
place. The first requirement a task gets also scoops its loose notes into
`NOTES` in the same write, with the notice `◇ First requirement · filed N
notes under NOTES` (just `◇ First requirement` when nothing moved). The cursor
lands on the toggled item at the same offset into its text. Writer refusals
(note under a note, note inside a drawer, a dropped or carried requirement, a
requirement with nested requirements, the 16-level depth bound) show the
writer's message and write nothing. Everything else keeps the old checkbox
toggle: list items outside any task block, `#task` lines including nested
subtasks, pasted checklists under notes, and lines in fences, quotes, or
frontmatter. Each write is one undo step.

### `- [` typing assist

The plugin registers its first CodeMirror editor extension. Typing a space
right after a list item's lone `[` expands it to `- [ ] ` with the caret after
it, for `-`, `+`, `*`, and numbered list markers at any indent, whether or not
Obsidian's `autoPairBrackets` added the closing `]`. It never fires on `- [x`,
`- [[`, `- [link`, with other text after the caret, or inside quotes, fenced
code, or frontmatter. The space lands as its own input step and the expansion
as a second, history-isolated step, so one Undo returns exactly the bytes a
plain space would have produced (`- [ ` or, with autopair, `- [ ]`). A `]`
typed immediately after the expansion is swallowed and so is a space typed
right after that, so typing `- [ ]` in full gives the same `- [ ] `; any other
key, edit, or caret move disarms the absorption. Backspace directly after a
list-item-start `[ ] ` removes the four checkbox bytes in one key and keeps the
rest of the line. Vim insert mode types and deletes through the same extension;
normal mode is untouched. Paste, templates, and programmatic edits never
trigger it.

### Drawer typing and Toggle Drawer

On an empty non-checkbox bullet directly under a real `#task`, typing `*`
expands to `- ****` with the caret between the delimiter pairs, for `-`, `+`,
`*`, and numbered markers, whether or not Obsidian's `autoPairMarkdown` would
pair the star. The typed star is its own input step and the completion is a
second, history-isolated step, so one Undo returns the literal `- *`. A `*`
typed at the end of a valid title, immediately before the closing `**`, steps
over both stars. Enter there opens a nested note bullet at the drawer's child
indent. Backspace inside empty `****` deletes all four stars and keeps the
list marker. The assist never fires in fences, quotes, frontmatter, on a
checkbox, or deeper than a task's direct children. Vim insert mode uses the
same adapter; Vim normal-mode `*` is unchanged.

**Toggle Drawer** (no default hotkey) wraps or unwraps an eligible direct
child bullet, preserving title bytes and descendants. A legacy ALL-CAPS drawer
becomes `- **NOTES**` without recasing; unwrapping a bold header yields its
plain title. Checkbox lines, managed lines, reserved names, invalid or
trailing-colon titles, and deeper positions show an actionable notice and
write nothing. See the [task drawer contract](https://bobs-org.github.io/task-drawers/).

### o and O continuation

Vim `o` opens a real sibling after the current line's whole subtree; `O` opens
the same sibling above. A new Ready task is
`{indent}- [ ] #task  [created::YYYY-MM-DD]` with the caret after `#task `.

On a root `#task` headline, `o` inserts that task after the whole block and
`O` inserts it directly above the headline. Inside `### Next & In Progress`,
`### Blocked`, or `### Done & Canceled`, both keys open at the end of the
`## Tasks` intake (just above the first status-group heading) and record a
`<C-o>` jump back to the origin row — a new task is never born inside a
status group. On a `^prj` headline both keys open at that intake with a jump;
with no `## Tasks` they refuse, and nothing is inserted above `^prj`.

Nested `#task` headlines, requirements, drawer headers, and note bullets open
a sibling after the subtree (`O` above). A requirement continues as `- [ ] `
at the same indent and never copies a `[-]` or `[>]` mark. Managed link
lines, Cancel Log, and managed log headers or entries redirect to the owning
task's note slot, creating the Notes drawer through the layout helper when
the owner has requirements and no drawer yet.

Pomodoro entries, Task Links, bank rows, and plain bullets outside task
blocks keep today's prefix bytes, placed after the item's subtree. Prose,
headings, frontmatter, fences, and empty lines stay byte-for-byte today's
`o`/`O`.

Leaving insert, blurring, or switching leaf while the scaffold still holds
no typed text removes it, including a Notes drawer created only for that
scaffold. `Ctrl+Shift+]` refuses managed link, Cancel Log, and managed log
lines with a short notice.

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
- [Bob Ledger Tools](bob-ledger-tools.md) — the freshness stamper,
  successor-reporting surfaces, and drawer trays.
- [Task drawers](https://bobs-org.github.io/task-drawers/) — dual-read
  headers, Notes home, and the limited title round-trip.
- [Cross-plugin APIs](https://bobs-org.github.io/develop/plugins/plugin-apis/) — the completion and blocked-dependent interface.
