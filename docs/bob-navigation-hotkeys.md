---
title: "Bob Navigation Hotkeys"
description: "Navigate and edit Bob notes with keyboard commands."
---

Navigate and edit Bob notes with keyboard commands.

`Cmd+Y` opens the [Copy card](copy-card.md): one key per path, block ID, or template row.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Navigation Hotkeys |
| ID | `bob-navigation-hotkeys` |
| Version | 2.107.6 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Requirement lines refuse lane gestures; Ctrl+Shift+P opens the owner's Task Card. `[S` / `]S` jump to the first task of the previous / next occupied review group, cycling. Ctrl+Shift+P always opens the Task Card, a focused first screen with exact P-level previews. Ctrl+Shift+B is Ctrl+Shift+P then `b`: it opens the Task Card's Depends on stage for the task, a Task Link's linked task, or a counted `N<Ctrl+Shift+B>` batch; Esc, q, or Ctrl+[ close it without writing, and its More section opens a property's value stage. Ctrl+Shift+Alt+B is Ctrl+Shift+P then `⇧B`: it opens the Blocks stage for a task or Task Link, supports counted `N<Ctrl+Shift+Alt+B>`, and works from Depends-On and BLOCKS lines, where Ctrl+Shift+P on a BLOCKS line also opens the owner’s stage directly. On an inbox task every non-closing Task Card answer, the Ctrl+Shift+Enter toggle, and Alt+N ask where the task goes before writing and move there. Open and manage related notes, tabs, and task properties, including priority levels that roll scheduled dates. Ctrl+Enter on the card takes the recommended roll, decay, or cancel from the previewed ladder, including counted and Task Link batches. Scheduling a date opens one combined Reason and Work summary review; a Pending or Next task can record an optional Work Log summary as a stamped `*YYYY-MM-DD HH:MM*` entry under a WORK LOG child. A Cancel action closes tasks as Cancelled with an optional reason kept in a first-child Cancel Log. Alt+F and Ctrl+Alt+F ask due WIP and Next tasks why they stay on their rung, and ask due Ready keeps why they stay; every counted keep on every rung writes one rung-qualified Rotten Log entry in one undo (blank logs no reason given), while early and Today-linked lane keeps stamp quietly with no prompt and no entry. Freshness gestures never ask for or write a Work Log summary. Counted N<Alt+F> and Task Link sessions show one Keep reason prompt; one Enter submits it. Each counted keep gets its own rung-qualified entry; Ready at-limit targets still skip unstamped and unlogged. The decay card shows the logged keeps in its header; Enter steps one rung (WIP → Next → Ready → priority, with the bottom level rolling in place), while Alt+F opens Stay and records its reason in Rotten Log. Step and Drop also log their rung event in the same undo as the task change; Ready alone offers Less often and explicit levels. On a landed RECURRING row both write nothing, show the recurring-tier notice, and stay. Ctrl+Enter on the PRE/POST row the review walk just landed on completes it and advances within the group when another live row remains; from the last PRE row onto the next group's first due row (nav api v3). Stage-ending completions append `· STAGE ✓`. `]s` / `[s` away from the current review task first return to it. The Task Card level strip and priority notices render the shared signal-bar priority mark through the bob-ledger-tools api.priorityMarks v1 namespace, falling back to the Lucide signal icons without it. The Task Card header's BLOCKED lane chip renders the shared blocked-reason miniature with its After / Until / Via reason list through the bob-ledger-tools api.blockMarks v1 namespace, and the P1-P4 strip shows a hollow teaching digit beside each level's bars, both falling back to today's look without it. Alt+[ / Alt+] on a Pomodoro Task Link toggles the linked task between Next and In Progress — asking once for an optional Work Log summary when moving back to Next — through the nav api.taskLinkLane v1 namespace. A planned-task close with offers opens an unmarked grouped picker; only marked links apply. `Tab` toggles and advances; empty-filter `Space` toggles in place; filtered `Space` types. V2 adds leaf-project keep-moving groups: why captions, `not dependents` tag, lane names, blocked/scheduled/hidden fold, last in mixed lists. V3 adds titled 🪢 relation groups with why captions, `your links · not dependents` tag, fold, lane names, and link-2 icon for all-relation pickers. nav api.notice v3 shows the pulled-in summary. Review-row closes add `successorNotice` to the walk toast. bob-ledger-tools api.stats journals each counted ]s answer and outcome. Depends-On writes now mirror open dependents into generated 🧱 BLOCKS lines, in the same-note transaction or a checked cross-note follow-up, including counted, marked, Ctrl+D, hand-edit (and undo), conversion, and Ctrl+Shift+M paths. Adding an open prerequisite from Ctrl+Shift+P consumes the newly Blocked task's live links from today's open Pomodoros by resolved task identity; link-only bullets with child notes become the task's clean display text and keep those notes. It removes only entries this gesture emptied, leaves childless placeholders alone, and preserves closed timed rows. Cmd+Enter first runs the bob-chips command chip the cursor targets (an ambiguous or refused chip shows its reason and stops there); otherwise, on a reading task, Task Link, or managed embed it opens its source_pdf in Highlights without vault writes, while other targets retain Obsidian’s new-tab behavior. Turns on Templater's device-local "Trigger on file creation" when it is unset, so Cmd+N and other new notes get the vault's folder template (_templates/new_note.md). Only the BLOCKS chips in bob-ledger-tools use nav `api.blocks` v1, for ＋ and hover ×. The nav api gains an additive `openReferencePdf(path)` member (Promise of `{ok, reason?}`; the api `version` is unchanged) so the bob-ledger-tools Reading Board can hand a reference PDF to Highlights without vault writes. `Z` (mapped in the vault vimrc) or the "Zoom image on cursor line" command opens the image or video on the cursor line — a wiki reference, Markdown reference, or path-only image/video bullet imported through bob — in a full-window viewer with keyboard and mouse zoom and pan; `y` copies its recorded original path (or the vault path / URL), and `r` restores only the picked link to a present recorded original path in one undoable edit. Native image clicks are unchanged. Task relations use 🪢 LINKS and generated LINKED FROM rows; nav api.relations v1 opens either stage and removes live links. The Task Card offers Links to (l) and Linked from (⇧L), with Ctrl+Shift+L and Ctrl+Shift+Alt+L commands; on a Task Link they open the linked task's stage in its own note, and on a Depends-On line they open the owner's. CURRENT shows existing links or sources, Enter applies or removes, Ctrl+Enter edits a relation label, `~` in the filter flips direction, and Ctrl+D clears all outgoing Links to relations while refusing generated Linked from rows. Counted Ctrl+Shift+L applies one target to every selected source; reverse counted links are refused. Alt+P applies the Task Card recommendation in one key, sets P1 on a task with no priority, stays hidden for immediate rolls and decays, and waits on the visible card before cancellation. `]s` landings end their toast with the `Alt+P` roll preview from nav `api.quickRoll` v1. Pomodoro move and rename pickers offer recent task types with component swatches and near-duplicate hints; rename previews count linked task type changes; Ctrl+D hides or restores Recent suggestions only. `]w` / `[w` (mapped in the vault vimrc) walk Pending, Next, and Ready tasks off today's plan — the dash PENDING/NEXT/READY sections — with a lane-colored toast and walk rail; `]W` / `[W` jump to the first task of the next / previous lane, cycling. [n` / `]n` (mapped in the vault vimrc) open the note's previous / next labeled link; `]]` / `[[` repeat the last bracket walk — `]s` review, `]w` lanes, or `]n` links — forward / backward, remembered per device. `]}` / `[{` repeat that family's uppercase jump — `]S` / `[S` review groups or `]W` / `[W` lanes, `]N` / `[N` link groups, or `]B` / `[B` bank days. Ctrl+Shift+- changes the current note's parent: a panel pre-filled with the current parent ranks existing notes, previews the new ancestry, refuses cycles, and rewrites only the `parent:` frontmatter line as a quoted wikilink in one undo. The status bar always shows the bracket-repeat mode as `[[ s w n b ]]` with the active walk lit; click a letter to switch. Ctrl+S splits the selected open merged Pomodoro by type: two types split the right one at once, three or more open a picker with an All row and Tab-marked type rows, and the Bob: Split Pomodoro by type palette command does the same with no default hotkey. Ctrl+Shift+T splits the bullet under the cursor into its own task (counted `N<Ctrl+Shift+T>` takes that bullet plus the next N siblings, and a visual selection splits every touched head line), leaving a live link stub and landing the cursor on the first new task in one undo. A merge label in Ctrl+Shift+L, counted Ctrl+Shift+L, and Ctrl+Shift+Alt+L previews and commits through `bob task merge` via the Bob Ledger Tools api.taskMerge namespace, with the consequence strip, an offer pick, an Undo merge notice, and a mobile refusal. `api.quickRoll` previews carry additive `parts`. Delete current file asks for y before trashing an established, journal, bob-managed, or parent note, or any file right after another delete; fresh notes still delete at once. Disk reloads of an open note stay out of that editor's undo history, so Ctrl+R survives background writes and u undoes your own edit. `]b` / `[b` walk bank rows (waiting rows first) and `]B` / `[B` jump bank days, with `]]` / `[[` and `]}` / `[{` repeats, a `[[ s w n b ]]` selector, and per-family `s/w/b` attention (a dot off-family, its hue as letter ink on the selected family) through nav `api.walkMode` v7. `Ctrl+W` arms window keys (`h`/`l` focus, `w` cycles, `H`/`L` move tab, `v` split, `1`–`9` jump to a numbered tab); see Window keys (Ctrl+W). A navigation-owned close of a Gmail Task opens the Mail Close Card; only y confirms, and any other key keeps the task open. The api.mailCloseGuard v1 namespace classifies targets and carries a confirmed-identities token into downstream close writers. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Bob: Relation labels | `open-relation-labels-manager` | — |
| Change parent note | `change-parent-note` | Ctrl+Shift+- |
| Close other tabs | `close-other-tabs` | — |
| Close tabs to the left | `close-tabs-left` | — |
| Close tabs to the right | `close-tabs-right` | — |
| Commit to Next / release to Ready | `toggle-task-lane` | Alt+N |
| Copy card: path, block ID, or template | `copy-active-file-path` | Mod+Y |
| Create notebook here | `create-notebook-here` | — |
| Create project note | `create-project-note` | — |
| Create project note from task | `create-project-note-from-task` | — |
| Delete current file | `delete-current-file` | — |
| Duplicate current tab | `duplicate-current-tab` | — |
| Edit task dependencies | `edit-task-dependencies` | — |
| Focus next split | `window-focus-next` | — |
| Focus split left | `window-focus-left` | — |
| Focus split right | `window-focus-right` | — |
| Insert blank line above | `insert-blank-line-above` | — |
| Insert blank line below | `insert-blank-line-below` | — |
| Jump to next Pending, Next, or Ready task off today's plan | `jump-to-next-lane-task` | — |
| Jump to next bank row (waiting rows first) | `jump-to-next-bank-row` | — |
| Jump to next open task or move a Pomodoro down | `jump-to-next-open-task` | — |
| Jump to next section header | `jump-to-next-section-header` | — |
| Jump to next task due for freshness review | `jump-to-next-due-task` | Ctrl+Alt+J |
| Jump to previous Pending, Next, or Ready task off today's plan | `jump-to-prev-lane-task` | — |
| Jump to previous bank row (waiting rows first) | `jump-to-prev-bank-row` | — |
| Jump to previous open task or move a Pomodoro up | `jump-to-prev-open-task` | — |
| Jump to previous section header | `jump-to-prev-section-header` | — |
| Jump to previous task due for freshness review | `jump-to-prev-due-task` | Ctrl+Alt+K |
| Jump to tab 1 | `window-jump-tab-1` | — |
| Jump to tab 2 | `window-jump-tab-2` | — |
| Jump to tab 3 | `window-jump-tab-3` | — |
| Jump to tab 4 | `window-jump-tab-4` | — |
| Jump to tab 5 | `window-jump-tab-5` | — |
| Jump to tab 6 | `window-jump-tab-6` | — |
| Jump to tab 7 | `window-jump-tab-7` | — |
| Jump to tab 8 | `window-jump-tab-8` | — |
| Jump to tab 9 | `window-jump-tab-9` | — |
| Jump to the first row of the next bank day | `jump-to-next-bank-day` | — |
| Jump to the first row of the previous bank day | `jump-to-prev-bank-day` | — |
| Jump to the first task of the next lane off today's plan | `jump-to-next-lane` | — |
| Jump to the first task of the next review group | `jump-to-last-due-task` | — |
| Jump to the first task of the previous lane off today's plan | `jump-to-prev-lane` | — |
| Jump to the first task of the previous review group | `jump-to-first-due-task` | — |
| Move tab left | `move-tab-left` | — |
| Move tab right | `move-tab-right` | — |
| Move tab to left split | `window-move-tab-left` | — |
| Move tab to right split | `window-move-tab-right` | — |
| Move tasks to note | `move-tasks-to-note` | Ctrl+Shift+M |
| Open alt file note | `open-alt-file-note` | — |
| Open alternate file | `open-alternate-file` | — |
| Open child note | `open-child-note` | — |
| Open dash Tasks section | `open-dash-tasks` | Ctrl+0 |
| Open next group link (]N) | `open-next-group-link` | — |
| Open next link | `open-next-link` | — |
| Open parent note | `open-parent-note` | — |
| Open previous group link ([N) | `open-prev-group-link` | — |
| Open previous link | `open-prev-link` | — |
| Open template note | `open-template-note` | — |
| Refresh task freshness (confirm it still looks right) | `refresh-task-freshness` | Alt+F |
| Refresh task freshness and jump to the next due task | `refresh-task-freshness-and-advance` | Ctrl+Alt+F |
| Rename current file | `rename-current-file` | — |
| Repeat last bracket walk backward ([s, [w, [n, or [b) | `repeat-prev-bracket-walk` | — |
| Repeat last bracket walk backward, uppercase ([S, [W, [N, or [B) | `repeat-prev-uppercase-bracket-walk` | — |
| Repeat last bracket walk forward (]s, ]w, ]n, or ]b) | `repeat-next-bracket-walk` | — |
| Repeat last bracket walk forward, uppercase (]S, ]W, ]N, or ]B) | `repeat-next-uppercase-bracket-walk` | — |
| Run command chip, or open in Highlights (reading task, highlight page, Gmail thread, or link in new tab) | `open-reference-pdf-in-highlights` | — |
| Show window keys | `window-keys` | — |
| Split Pomodoro by type | `split-pomodoro-by-type` | — |
| Split bullets into tasks | `split-bullets-into-tasks` | Ctrl+Shift+T |
| Task card (set properties) | `set-bullet-property` | — |
| Task card: Blocked by (Depends on) | `task-card-depends-on` | Ctrl+Shift+B |
| Task card: Blocks (reverse Depends on) | `task-card-blocks` | Ctrl+Shift+Alt+B |
| Task card: Linked from (task relation) | `task-card-linked-from` | Ctrl+Shift+Alt+L |
| Task card: Links to (task relation) | `task-card-links` | Ctrl+Shift+L |
| Task card: Roll by recommendation | `roll-by-recommendation` | Alt+P |
| Task types | `open-pomodoro-themes-manager` | — |
| Toggle Highlights hints | `toggle-highlights-hints` | — |
| Toggle current tab pin | `toggle-current-tab-pin` | — |
| Toggle line transclusions | `toggle-line-transclusions` | — |
| View image or video on cursor line | `zoom-image-on-line` | — |
| Yank absolute path | `yank-absolute-path` | — |
| Yank absolute path with tilde | `yank-absolute-path-tilde` | — |
| Yank basename | `yank-basename` | — |
| Yank basename without extension | `yank-basename-without-extension` | — |
| Yank parent directory | `yank-parent-directory` | — |
| Yank relative path | `yank-relative-path` | — |
| Yank task block ID | `yank-block-id` | — |
<!-- END GENERATED: commands -->

`Ctrl+0` reuses `dash.md` tabs across windows, including unloaded tabs. It
prefers pinned main-area tabs, other main-area tabs, pinned sidebar tabs, then
other sidebar tabs, preserving scroll position. With none open, it uses the
current tab or opens one.

## Project creation

Create project note uses `_templates/new_project.md`, changing only `parent:`
through Change parent's byte-preserving planner. The template owns all defaults,
including `type` and `status`. A notice warns if cached `type` lacks `[[project]]`.

## Task Card

`Ctrl+Shift+P` opens Task Card with priority previews. `Esc`, `q`, or `Ctrl+[` closes without writing; no setting is needed. Inbox answers that write ask the task's destination, then move there. See [Task Card](task-card.md) for details.

On album or record notes without a task, Task Link, dependency, or relation target, it opens Schema Card (Record Card on records), including title and blank rows. It resolves direct album or record-parent notes only; task targets keep Task Card priority.

`Ctrl+Shift+B` is `Ctrl+Shift+P` then `b` (Depends on). `Ctrl+Shift+Alt+B` is
`Ctrl+Shift+P` then `⇧B` (Blocks). `Ctrl+Shift+L` / `Ctrl+Shift+Alt+L` open
Links / Linked from. A Task Link opens the linked task's stage; a Depends-On,
BLOCKS, LINKS, LINKED FROM, or requirement line opens the owner's. `Alt+N`,
`Alt+F`, `Ctrl+Alt+F`, `Alt+P`, and `Ctrl+Shift+M` refuse a requirement with
the lane copy. Any writing gesture closes the card.

## Mail Close Card

On Gmail Task close, `y` confirms; otherwise it stays open. One card covers batches. Dismissal keeps the picker. See the [contract](https://bobs-org.github.io/mail-close-card/).

The card swallows its opening chord until keyup, ignores repeats, and keeps on any key but `y`. The footer names the verb and omits the open hint without a URL.

## Navigation and counts

`Ctrl+Shift+J/K` navigates Ready, In Progress, and Next `#task` lines while
skipping Blocked `[?]` tasks — except on an open current or future Pomodoro
entry, where the same chord instead moves that Pomodoro and its contents
among adjacent future Pomodoros (the current slot keeps its time range;
crossing the current/history boundary or the last future Pomodoro is refused
with a notice). A counted chord moves a Pomodoro N positions
atomically, or jumps to the Nth circular navigation target elsewhere.

Normal-mode Enter on a link records a file-aware jump in a 100-entry session
history shared with native jumps: `Ctrl+O` returns to the origin, `Ctrl+I`
goes forward, counts traverse, and same-note heading/block and already-open
tabs round-trip. Bank filings add `api.recordJump`.

## Parent note

`Ctrl+-` opens the current note's parent (`open-parent-note`), `Ctrl+=` opens a
child (`open-child-note`), and `Ctrl+Shift+-` changes the parent
(`change-parent-note`).

The Change parent panel is pre-filled with the current parent's name, fully
selected. Typing replaces it; Backspace clears it and shows suggestions: the
current parent, the grandparent (`up a level`), recent notes, then the most-used
parents. As you type, existing notes rank by exact, prefix, word-start,
substring, path, then fuzzy match, with the current parent, areas and open
projects, child count, and recency as tie-breaks. Rows reuse the child-picker
badges and add `current` / `up a level` / `recent` chips plus a faint child
count. Albums show an `album` icon and **Album** badge, records a `file-text`
icon and **Record** badge. A live **MOVES TO** (or **STAYS UNDER**) breadcrumb
previews the new ancestry. An album hangs under an area or a project of any
status; a record hangs under an album.

Enter or click writes only the `parent:` frontmatter line. The value is always a
canonical double-quoted wikilink (`"[[name]]"` at the vault root,
`"[[folder/name|name]]"` otherwise). Trailing comments and the file's line
endings stay put. A missing key is inserted first in the YAML block; a note with
no frontmatter gets a three-line block. The panel refuses cycles, stale edits,
unclosed frontmatter, duplicate `parent:` keys, unquotable names, and
[notebook parent rules](notebook-gestures.md); typing a ruled-out name explains
why, and Enter re-checks the live vault before writing, so a stale pick is
refused with the same wording. It never creates a note. One undo reverts the write in an open editor.

Root-parent grouping is computed from the new tree at read time. Inherited
project blocking (`#prj_is_blocked`) is repaired by the next
`bob task reconcile`.

## Deleting the current file

`Ctrl+Shift+D` deletes a note created in the last 24 hours at once, including
a future journal note made by following `next`. It asks for `y` before
trashing an established note (or one with no `created:` stamp), today's or
past journal notes, bob-managed references, the done archive, templates,
notes that other notes name as their parent, non-Markdown files, and any
file within five seconds of the previous delete. An old blank note with no
backlinks and no children does not ask.

The confirmation names why it is asking. `y` / `Y` moves the captured file
to trash; any other key, including Enter, Space, Escape, and a second
`Ctrl+Shift+D`, keeps it. While the confirmation is open, another Delete
current file call does nothing. Trashed files follow Obsidian's Deleted
files setting.

## Pomodoro gestures

The same move keymap on a Pomodoro sub-bullet moves that bullet plus the next N
siblings with their descendants, into another open Pomodoro in the same
note — or into a new `- [ ] () — NAME` Pomodoro created directly below the
current one from a typed, uppercased, em-dash-stripped picker name. Typing `=`
creates a fresh destination with the source Pomodoro's normalized name when the
source is named; typing `=NAME` peels every matching `NAME` component from a
merged source into a new placeholder containing the selected bullet subtrees.
Duplicate destination bullets merge away, and moving out a source's last
owned content deletes that Pomodoro entry instead of leaving it behind. Nested
`#task` lines under Pomodoro entries route to the Pomodoro move.

On a Pomodoro entry line itself the keymap opens a picker: Enter on another
open Pomodoro keeps the whole-entry move/delete behavior, typing a new
name renames the entry in place, and `Ctrl+X` on a highlighted open
current/future Pomodoro merges entries in one undoable edit (a current timed
entry survives and absorbs the selected future one; names combine
survivor-first with first-spelling kept; calendar-owned MEET entries cannot
merge; counts are ignored).

Both pickers keep today's open Pomodoros first and offer recent task types for
new destinations or renames when the Ledger Tools type catalog is available.
Recent rows keep catalog spelling; `+` components show their type swatches,
and typed near-duplicates show a `like NAME` hint. `Ctrl+D` hides a Recent
suggestion and leaves a reversible hidden row; on a Today row it has no effect.
A type that today's ledger uses only on a done or cancelled Pomodoro still
shows as a Recent row; only types of the open Today rows (and, for rename,
the entry being renamed) are left out.

When `Ctrl+Shift+M` moves bullets, Enter keeps each moved task's current type
and merges any missing types into the destination's Pomodoro name. Alt+Enter
retypes the moved tasks to the destination's type; Tab cycles the chosen type
component for a composite name. When the last Task Link of a type leaves a
merged source Pomodoro, its name sheds that type and keeps the base type.

`Ctrl+S` on a Pomodoro entry line — or anywhere in its child block — splits
the selected open merged Pomodoro by type in one undoable edit. Each
top-level Task Link subtree whose task's effective type is split moves into a
new planned `- [ ] () — T` entry directly below the source, in name order,
and the source keeps the remaining types; a split entry is still created when
a type has no links. Two types split the right one immediately (`Split FIX
out of BUILD + FIX · 2 tasks → FIX below`); three or more open a picker
titled `Split BUILD + FIX + READ` with a `BUILD stays` header, a preselected
`All · FIX, READ` row, one row per merged-in type with its hue swatch and
link count, a footer previewing the lineup (`BUILD + READ · FIX ↓`), and
`↵ split · ⇥ mark · esc` keys — `Tab` marks or unmarks type rows, `Enter`
applies the marked or highlighted row, and `Esc` cancels. Closed
entries, MEET entries, single-type entries (`BUILD has one type — nothing to
split`), and containers (`LATER holds any type — nothing to split`) are
refused with a notice and no edit. The **Bob: Split Pomodoro by type**
(`split-pomodoro-by-type`) palette command does the same with no default
hotkey.

The **Bob: Task types** command (no default hotkey) opens the type manager,
with Active, Hidden, Possible duplicates, and All views on `Tab`.
Collision hints sit on top; rows carry today, hidden, pinned, exempt, hue, and
reappeared badges. `Ctrl+D` hides or restores the selected type, `Enter`
offers rename, color, hide, and occurrences, and single keys (`r`/`c`/`h`/`o`
with an empty filter, `1`–`8`/`a` in the color list) jump there.
Rename previews the one-commit rename before applying; occurrences lists daily
notes and opens the entry. On a rename row, the footer counts linked tasks that
will change type and reports when a destination leaves task types unchanged.
History and writes need the desktop app, where Ledger Tools reads the type
catalog through Bob's `themes` command.

The **Bob: Relation labels** command manages the relation-label vocabulary
without a link gesture. Choose a label to hide or unhide it, or open the
previewed rename flow. The relation-label stage also uses `Ctrl+R` to rename
the selected existing label; it checks affected open editors before preview and
write, and requires explicit confirmation before merging labels.

## Task splitting

`Ctrl+Shift+T` splits the cursor bullet into its own task; counted and
visual forms split the touched bullets together. On a task line it opens a
picker over that task's splittable notes and requirements, drawer-scoped
from a title: nothing starts marked, `Tab` marks and advances, `Enter`
splits the marked or highlighted row, `Esc` cancels. Section
bullets become tasks in the note's `## Tasks` intake. Daily-note splits and
carries write to the `[root::]` note or the default inbox. Same-note writes
are one `Ctrl+Z` transaction; cross-note writes persist destination-first
under guard, and **Undo split** restores the text only while every affected
note matches, otherwise listing the changed paths. The cursor lands on the
first new task and `Ctrl+O` returns to the source, or names the path
otherwise. The gesture never advances the `]s` review walk. Each new task
links back with a 🪢 **LINKED FROM:** line in the managed-link zone, so a
fresh split is already tidy-clean.

On a requirement row the chord carries instead: the branch travels with
depth kept, notes attached, loose notes filed under a created `NOTES`
drawer, the row keeping a `[>]` stub as the new task links back, reusing a
trailing anchor. A cursor on a requirement note carries the innermost one;
counted carries take siblings. Dropped, carried, excluded, and overlapping
selections refuse with a teaching notice.

## Task properties, dependencies, and moves

`Ctrl+Shift+P` edits scheduled, dependency, and priority properties. Priority
levels roll scheduled dates, report the ISO date/span and distance from
today, and offer date-picker re-roll suggestions. Choosing `scheduled` opens a
combined Reason/Work summary review; its optional reason becomes a nested
Schedule Log entry. A blank reason on a task with a log records `🤷 no reason
given`; without a log, it leaves the task untouched. Priority choices and
pinned rolls write immediately with deterministic reasons. A strictly future
`scheduled` date removes live links from today's open Pomodoros.
`N<Ctrl+Shift+P>` edits the current and next N real tasks; on a dedicated Task
Link bullet, it edits that linked task in its own note. Counted sessions never
open the album Schema Card.

Dependency writes use one managed ⛓️ **DEPENDS ON:** first-child line per
task and one undoable edit. Adding an open prerequisite blocks the dependent,
raises the target to its lane, and removes the dependent's live Pomodoro links.
An emptied open entry is deleted; entries with prose children and untouched
placeholders remain. Removing the last open prerequisite recovers the dependent
unless a future `scheduled` date remains. `Ctrl+D` on the row deletes the line
and `[dependsOn::]`, leaves other children untouched, and recovers immediately.
Hand edits mirror after the cursor leaves the edited line in the same note; a note switch drops the pending pass (reconcile heals) and malformed lines stay unchanged.
BLOCKED rows show `🔒 waits on N`, `🔒 scheduled YYYY-MM-DD`, or `🔒 blocked`.
The Depends on value stage searches all open tasks from a task line, the
Depends-On line, a chip, a Task Link, or the `Edit task dependencies` palette
command. Blockquoted tasks refuse edits. Answering a landed review row advances
once to the next remaining item.

Bare `Ctrl+Shift+M` moves the current task and focuses it in the destination;
`N<Ctrl+Shift+M>` also moves the next N movable tasks. Moves never advance the
review walk: the next `]s` / `[s` resumes at the moved row's walk neighbour.
`Ctrl+O` returns to the post-removal source seam; `Ctrl+I` returns to the first
moved task without undoing the move. Move and inbox-route destinations include
only areas and open projects (never albums, records, or `bob vault-sync`
conflict copies under `_conflicts/`). Open child note also hides `_generated/`
notes.

Project conversion keeps Depends-On and inline dates on task lines in both
directions. Promoting a task planned today consumes every dedicated live link
to it and offers the new project's open tasks through Successor Offer; only
picked tasks are linked, raised to Next, given block IDs, and stamped fresh.
History, past dates, struck links, and prose rewrite one-to-one to `^prj`.
Project schedules propagate to task-level `scheduled` and Blocked status;
`#prj_is_blocked` follows the post-gesture `^prj` status. Dependency changes
update generated 🧱 BLOCKS mirrors, controlled by `dependencies.blocks_lines`
in shared bob config (default on; `false` stops navigation gestures writing
BLOCKS lines).

**Create project note from task** converts an open task in an area or project
note. `Ctrl+Shift+Alt+N` is a custom vault binding from the original README,
not a registered default or plugin keydown handler. Running it on a project's
`^prj` restores a parent-task block in the parent's `## Tasks`, carrying tasks,
drawers, and project-task children; it repoints `#^prj` links, then trashes the
project note. The generated `[!projects]` callout and a `## Projects` heading
containing only it are never copied. If backlink rewriting fails, the restored
task remains and the project note is kept with a notice.

When promoting a task, a bold drawer becomes a `##` keeping its title, empty
included; a legacy ALL-CAPS child still title-cases only with nested items.
Reversal writes `- **Title**`. The converter reuses a matching heading
case-insensitively or appends a new one; it copies descendants as notes rather
than `#task` lines. Other eligible child bullets become tasks. Managed logs
move under the new `^prj` task in source order. If child content cannot be
moved losslessly, the source task is kept and a notice explains the partial
result.

Task Card Depends on and Schedule edits on a `^prj` with sub-projects cascade
top-down with preimage-checked writes and report
`· N sub-projects Blocked / Ready again / not updated`.

`Alt+N` commits Ready to Next or releases Next/In Progress to Ready on the
current task and next N (or the linked task and N siblings), unlinking released
tasks from today and reporting NEXT/PENDING counts and cap advice. Inbox tasks
ask for a destination first; a Pending release keeps its Work Log prompt first.
The picker offers `commit to Next` / `release to Ready` (`N tasks · then …`
for counted runs). `↵` applies and moves, `⇧↵` applies in place, `Esc` cancels
without writing.

Log Recall (`USED BEFORE`, see the [contract](https://bobs-org.github.io/log-recall/)) covers Work prompts (schedule-review via `Tab`, schedule-work-log, lane-release, cancel), Rotten keeps (single, decay-card Stay, batch), and the successor inline cancel field; `Ctrl+N` / `Ctrl+P` fill a history row and `Esc` restores the typed draft first.

## Wikilink completion in prompts

Typing `[[` in a Bob-owned prose field opens a **LINK** band in the recall
slot or under the field: Work summary, Task Card
[reasons](task-card.md#links-in-reasons), Move to Next, Release task, Keep
reasons, the successor cancel reason, notebook Summary, Bob Mail's email task,
[Intention Card](intention-card.md) fields, and
[Record Card](record-card.md#wikilink-completion) stages.
Rows rank like `bob capture-complete`; a note row inserts its path
(`[[2026/2026-11-21]]`), and `[[#…` resolves against the task's note.
Completion never writes the vault. Identifiers, filters, code, and `\[[`
stay literal; paste, IME, and caret moves never open the band.

| Key | Band open |
| --- | --- |
| ↓ ↑, Ctrl+N/P | Move; never wraps. |
| Enter, Tab | Insert; never submits. Zero-row Enter closes. |
| Shift+Enter | Textarea newline; input inserts. |
| `#` `^` `\|` | Heading, block, or alias stage. |
| Esc, Ctrl+[ | Close only the band; `q` types. |

USED BEFORE hides while the band is open; Ctrl+[ mirrors Esc when closed.
Unresolved complete links show a faint hint; Enter still submits.
`((` also completes tasks; see [Task links in prompts](block-id-prompt.md#task-links-in-prompts).

## Review walk

`Ctrl+Alt+J/K` walks the tiered freshness review queue PRE → NEW → PROJECTS →
PENDING → NEXT → RECURRING → TICKLER → ROTTEN → POST vault-wide, wrapping with
notice. `N]s` / `N[s` jump N entries in one landing. `]s` /
`[s` (and `Ctrl+Alt+J/K`) away from the current review task first return to it
with a `Back to current review task` toast; `<C-o>` goes back, and the next
press steps from the task. `[S` / `]S` jump to the first due task of the
previous / next occupied review group, cycling. Both land on the
destination group's first remaining row. Empty groups are skipped. With no
origin, `]S` enters the first nonempty group and `[S` enters the last.
`N]S` / `N[S` move N occupied groups in one landing and wrap at the occupied
ends. Group jumps never return to the current review task. Vault mappings still
bind `[S` / `]S` to the legacy command IDs `jump-to-first-due-task` /
`jump-to-last-due-task`.
Before a same-pane note switch, the plugin saves the active note and checks its
disk text against the editor. A failed save or mismatch keeps the current note
open. The landing warning fires only when the pane switched to the new note but
shows the previous note's text. It stops the walk and disappears after eight
seconds. The plugin also checks the target's disk text again after Obsidian's
save debounce. A switch Obsidian opens in another tab is not checked on landing,
for example following a link from a pinned tab. See the Bob CLI vault-git-sync
docs under “Clobbered notes” for recovery steps.

`Alt+F` and `Ctrl+Alt+F` stamp the cursor task, or the target of a dedicated
Task Link, through Ledger Tools' `keepLine`; a count also includes the next N
targets. An exact due keep counts once per review day on its rung (WIP,
Next, Ready, or P-level); uncounted keeps preserve the streak. A due WIP
(`[/]`) keep asks “Why keep it in WIP?” and a due Next (`[*]`) keep asks
“Why keep it in Next?”, each with its rung allowance (`keep 1 of 2 in
Next`; `keep 2 of 2` names the decay card for Ready). The prompt shows
per-rung tallies, previews the exact entry, and lists up to three earlier
reasons. Every counted keep on every rung writes one rung-qualified Rotten
Log entry (`kept N× in WIP / in Next / in Ready`, `kept N× at P2`) under
`🥀 **ROTTEN LOG**` in the same undo step as the stamp; a blank reason logs
`🤷 no reason given`. Enter stamps and increments the streak. A counted
keep whose entry cannot be written (duplicate `🥀 ROTTEN LOG` markers,
unreadable history) writes nothing. Early and Today-linked keeps
stamp quietly with an “early · not counted” notice: no prompt and no entry.
Esc writes nothing and retains the walk position. Alt+F stays, while
Ctrl+Alt+F advances after a landed walk answer.
For P-levels, `<Rung>` is the configured level label (such as P2), never the
stored `[priority::]` value. While a prompt is open the active note, each
linked note, and the local day are rechecked, and the write is refused if
any changed. Freshness gestures never ask for or write a Work Log summary.

NEW, early/FRESH, Today-linked, PROJECTS, recurring, checklist, closed, and
unblock-tickler rows stamp without counting and write no Rotten Log entry.
Generic human stamps clear the keep streak, independently of the logged
history.

A single exact, due, at-limit task opens the approved decay decision card
before any keep-reason prompt. The card follows the task's current rung:
Enter steps WIP → Next → Ready → the configured priority ladder, with the
bottom level rolling in place; Alt+F opens the in-card Stay reason stage.
Ready also offers Less often and explicit level picks; every rung offers
Reword and Drop. Step, Stay, and Drop write a dated rung-qualified Rotten Log event with
the task change in one undo step; Stay also stamps and clears the keep
count. Lane steps write no Work Log. The card header shows per-rung tallies (`🥀 WIP 2 · Next 1 · last
<date> — <reason>`) when the task has logged keeps. Esc returns from the Stay
stage to the choices; a second Esc writes nothing. If the card is
unavailable, the single keep uses the reason prompt and combined log write.
Counted `N<Alt+F>` and Task Link sessions show one Keep reason prompt when
counted keeps are present; one Enter submits it, writing one rung-qualified
entry per counted target. Ready at-limit targets still skip unstamped and
unlogged with `N needs a decision`; duplicate Task Links to the same source
are handled once.

On the landed PRE/POST row, `Ctrl+Enter` completes and advances within the
group. From the last PRE row it lands where `]s` would. A 1.5 s guard
swallows a repeat; a wrap to a skipped PRE chore stays. `Alt+F` completes
a checklist row in place; `Ctrl+Alt+F` completes and advances. On a landed RECURRING row both write nothing, show the recurring-tier
notice, and stay; `Ctrl+Enter` completes and `Ctrl+Shift+Enter` links to
Today, each advancing once. POST never wraps and closes on the last row.
Finishing a stage adds `· STAGE ✓` after the task (for example,
`✓ Done · Read email · BROWSER ✓ · Ctrl+Enter → next PRE`); the walk never
pauses at a stage. A resolving commit on a landed review row advances once
to the next item. `Alt+N` also answers any due walk row, advances once to its successor, and
keeps PRE/POST and RECURRING in place; other answers remain landing-gated.
An unprioritized row previews `Alt+P set P1 · 2–7d`. `↑`/`↓` and
`Ctrl+N`/`Ctrl+P` move the successor picker's highlight without marking. In the successor picker,
`Tab` toggles and advances; empty-filter `Space` toggles in place; filtered
`Space` types. `Ctrl+Shift+Enter` retargets via Block ID Prompt in order;
cancel or unavailable/changed sources preserve overrides, marks, and
selection. Enter merges the type; Alt+Enter retypes. Picker v4 stages
Done/Cancel (`Ctrl+X`/`Ctrl+Shift+X`; repeat clears) and Pull in (`Tab` or
empty-filter `Space`); `Ctrl+A` skips, Enter applies, and two-step Esc
discards. v5 adds a `Ctrl+J` pin; promotion lands it, merge withholds it. v6
puts requirements first: `Ctrl+X` Met, `Ctrl+Shift+X` Drop (optional Log
Recall), `Ctrl+Shift+T` Carry, `Space`/`Tab` Carry+pull in; `Ctrl+J` pins
for navigation. Requirement rows start with the shared diamond —
hollow for pending and staged Met, red slashed for Drop, green arrow for
Own task or Pull in; headings carry a pending mark. Requirements-only cards
use the diamond icon.

The Task Card's Review every action sets or clears `[refresh:: N]` through the
ledger-tools stamper, reading lane intervals with the task's own refresh kept
as the once-Ready return value.

## Lane walk

`]w` / `[w` walk the vault's PENDING (`[/]`), NEXT (`[*]`), and READY
(`[ ]`) tasks that have no Task Link under today's open Pomodoros. These
are the tasks counted by the `PENDING n/cap`, `NEXT n/cap`, and
`READY n/cap` chips and listed in the dash's `### PENDING Tasks`,
`### NEXT Tasks`, and `### READY Tasks` sections. NEW and ROTTEN Ready
tasks stay with `]s`; they are not in the READY lane. The walk lists
PENDING first, then NEXT, then READY, in dash order; inside a lane it
moves top to bottom through each note.

Each press steps one entry from the cursor when the cursor is on a live
entry, else from today's anchor when the anchored task is still listed in
the same lane, else by inserting the anchor's `(lane, path, line)` tuple
into the current sort order and continuing. When the cursor or
a live anchor resolves to a task whose current lane differs from the
anchor's lane, the origin stays the anchor tuple in the **anchor's** lane,
so the walk does not teleport into the new lane. With no origin, `]w` lands on
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
title, the note name, the latest Work Log entry with its stamp time (or the
created date when there is no Work Log), and a lane-aware hint: PENDING / NEXT keep `Ctrl+Shift+Enter today · Alt+N
release`; READY uses `Ctrl+Shift+Enter today · Alt+N next`. The READY
toast uses the READY chip's blue and an empty `[ ]` checkbox glyph. When
Ready tasks are waiting in NEW or ROTTEN the empty card reads `Ready tasks
are waiting in review` with a `REVIEW n` chip and a `]s` hint; when every
Pending, Next, and Ready task is on today's plan it reads `Lanes clear`
with a `TODAY m` chip; with none of those tasks at all it reads `No
Pending, Next, or Ready tasks`. The walk never writes and never sets or
advances the `]s` review walk.

## Bank walk

`]b` / `[b` step parsed-amount bank rows vault-wide (`(date, path, line)`
order; `N` rows with a count). Scope: WAITING while any row waits
(oldest-first), else ALL. `]B` / `[B` jump to the next / previous occupied
day's first scope row (duplicates merged across months; from mid-day `[B`
takes the previous day). Steps wrap (`↻`).

Origin: cursor, daily note, live anchor, else oldest waiting or newest day.
Lands on the payee (`<C-o>`; one stale re-plan). Toast: scope, position, day
rail, day and amount, month and hint (`Ctrl+Enter file` waiting, `]} next day`
in ALL). Never writes or runs `bob`; no-ops with the Category card open.
(Vim's `[b` is `:bprevious`; here it walks bank rows.)

## Bracket repeat

`]]` repeats the last bracket-walk family forward, and `[[` repeats it
backward. The repeat key owns the direction, regardless of which way the last
walk moved. The active type is:

| Type | Keys that set it | Commands and other surfaces |
| --- | --- | --- |
| `s` | `[s` / `]s`, `[S` / `]S` | `jump-to-next/prev/first/last-due-task`; `Ctrl+Alt+J/K`; the Ledger Tools walker footer's `s` review panel |
| `w` | `[w` / `]w`, `[W` / `]W` | `jump-to-next/prev-lane-task`, `jump-to-next/prev-lane` |
| `n` | `[n` / `]n`, `[N` / `]N` | `open-prev/next-link`, `open-prev/next-group-link` |
| `b` | `[b` / `]b`, `[B` / `]B` | bank rows/days; the `b` panel |

Record notes carry Bob-maintained walk links; `[n` / `]n` never create missing album records.

Family commands select their family; `[N` / `]N` select `n`. `]]` / `[[` then
step, while `]}` / `[{` jump groups. Repeats delegate synchronously: task and
bank walks consume Vim counts; link navigation ignores them.

**Uppercase repeat.** `]}` repeats the remembered family's uppercase jump
forward, and `[{` repeats it backward: the key owns the direction, whichever
way the last walk moved, and neither key changes the remembered family.

| Active family | `]}` runs | `[{` runs |
| --- | --- | --- |
| `s` | first task of the next occupied review group (`]S`) | first task of the previous occupied review group (`[S`) |
| `w` | first task of the next lane (`]W`) | first task of the previous lane (`[W`) |
| `b` | first row of the next bank day (`]B`) | first row of the previous bank day (`[B`) |
| `n` | next group head (`]N`), existing only | previous group head (`[N`), existing only |

`N]}` / `N[{` keep count parity with `N]S` / `N[S`, `N]W` / `N[W`, and `N]B` / `N[B`. With no
type, both show the empty notice. Family `n` ignores counts, including `N]N`.

`]n` / `[n` open the first body link outside frontmatter and code fences labelled
`next` / `prev`, or carrying a single arrow: previous starts with `‹` / `<`;
next starts or ends with `›` / `>`. Doubled arrows never step.

`[N` / `]N` open the previous / next group head. On a link-only body line,
`« X` / `<< X` names the previous group; `X »`, `» X`, `X >>`, or `>> X` names
the next. Whitespace and `· • | / , – — -` separate links. Prose and code do
not qualify. Distinct destinations in one role refuse with “Two « links on nav
lines — keep one” (or »); identical destinations deduplicate.

Authored links win per role; Ledger Tools `api.navGroups` supplies the remaining
group and step stops, including legacy daily notes without a nav line. Missing
periods use `api.periodNotes.ensureNote`, never Templater; missing daily notes
use their daily template. Pre-adoption ghosts never create; missing album records
remain syncing. An explicit group key can create an eligible note; `]}` / `[{`
only open existing notes and tell you which explicit key can create the target.
Without Ledger Tools, authored navigation still works.

The family persists per device and vault. Before selection, repeats show
`Nothing to repeat yet — press ]s, ]w, ]n, or ]b first`. Repeats add no toast.

Only the family command callbacks and a click on a footer letter record a
type. Direct internal advances, stale retries, the decay card, `Ctrl+Alt+F`,
PRE/POST `Ctrl+Enter`, `jump-to-next-open-task`, section-header commands, and
`[<Space>` / `]<Space>` blank-line insertion do not record one. `]]` / `[[`
and `]}` / `[{` do not change the selected type and never write notes,
stats-journal events, freshness stamps, or local storage.

### Footer indicator

The desktop status bar shows `[[ s w n b ]]` with the active walk lit;
mobile shows no item. Without a saved or used type, it has no thumb and its tooltip
carries the empty notice. Each tooltip names the uppercase jump (`]S`, `]W`,
`]N`, or `]B`). The thumb slides between letters.
`]]` / `[[` flash their glyphs;
a cold press flashes all four letters. `]}` / `[{` reuse the directional
flash.
Clicking a letter persists that family per device and keeps editor focus.
It runs no walk, shows no notice, and writes no notes; the next `]]` uses
the chosen family.

The persisted family is published via nav `api.walkMode` v7: v1 `current()`/`select(type)`; v2 `links({path, content})`; v3
display-only `setAttention(type, value)`; v4 per-family attention; v5 lane
attention. V7 adds `prevGroup`, `nextGroup`, `group`, `groupNone`, and
`groupConflict` to `links`, plus `source`, `state`, and `ghostReason` on step
stops; v2 consumers retain `prev`/`next` and `exists`. `s` stays on iff `]s` has a row, including ROTTEN and POST; its hue
is the first due group (PRE/POST cyan, ROTTEN orange). Changes and setup fire
the doorbell; receivers re-read `current()`. Dots clear on selection or when
no rows wait (counts in tooltips; `Highlight` when forced).

## Relation-label stage

The Links and Linked-from relation-label stage marks configured cancel,
complete, and merge labels with `⊘ cancels`, `✓ completes`, and `⤵ merges`,
including labels with no previous use; Return reads `↵ link & merge` for a
merge label. Cancel and complete previews, counted confirms, inverse labels,
and hand edits follow
[Links stage and closing labels](task-card.md#links-stage-and-closing-labels).

Committing a merge label previews through `bob task merge --dry-run` (the
Bob Ledger Tools `api.taskMerge` namespace, desktop only) and fills the
consequence strip from the preview: `⤵ Merges “S” into “T” · copies N notes ·
cancels “S” · …`. When the preview reports offers, the successor
offer picker opens; the commit then runs `bob task merge` with the picks and shows an
**Undo merge** notice that restores the applied notes only while they still
match the post-merge text. Merging two or more sources waits for a second
Return behind the same batch banner. An already-closed source takes the plain
relation through the writer with `Already Cancelled · link only`,
and mobile shows `⤵ merging needs the desktop app` and writes nothing.
When a source or the target has no `^block-id`, Return first runs the
new-block-ID prompt for each one. Sources come first, then the target, and
each prompt is prefilled from the task text. The relation field then returns
and the merge previews as usual. Escape at a prompt closes the picker, and
IDs already confirmed stay. See [Task relations](task-relations.md) for the
behavior.

## Notes, tabs, and keyboard layers

Opens related notes/tabs, preserves pinned tabs on sibling close, and registers
read-only `obsidian://bob-goto-task` and `obsidian://bob-open-notes` handlers
that place external picks without vault writes. In Vim normal mode, `Z` opens
cursor-line media in a viewer (see [image-zoom](image-zoom.md)); only `r`
writes, replacing the picked link.

Keyboard layers:

- **Registered palette commands with defaults** are listed in the generated
  table above (`Alt+N`, `Ctrl+0`, `Ctrl+Alt+J/K`,
  `Ctrl+Shift+M`, `Ctrl+Shift+B`, `Ctrl+Shift+Alt+B`, `Mod+Y`, `Alt+F`,
  `Ctrl+Alt+F`). No `hotkeys` field means no registered default, not no keyboard behavior.
- **Custom vault bindings** live in the vault's `.obsidian/hotkeys.json` or
  `obsidian_vimrc.md`, not in this plugin. The vimrc maps `Z` to
  `bob-navigation-hotkeys:zoom-image-on-line`, `[n` / `]n` to previous/next
  link, and `[[` / `]]` and `[{` / `]}` to repeat commands; the vault binds
  `bob-navigation-hotkeys:open-reference-pdf-in-highlights` to `Meta+Enter`.
  A registered default would lose to Obsidian's built-in `Mod+Enter`. Do not
  re-record this binding in Obsidian Settings on a Mac: Obsidian may save `Mod`,
  claiming `Ctrl+Enter` elsewhere.
- **Meta+Enter:** run the command chip the cursor targets through Bob Chips
  `api.commandChips.runAtCursor`; a run or refusal ends the chain
  ([⌘↵ and the hint](bob-chips.md#and-the-hint)). Otherwise open Highlights
  targets, then Gmail context through bob-mail `api.mailOpen` v1, then
  Obsidian's link opener. Missing chip or mail APIs fall through.
- **Editor and Vim handlers** act below the palette layer. `\s` pins the
  current tab (Ledger Tools owns `\p` for Pomodoro increments). `==` opens
  card editors; `-` toggles the drawer; `+` opens the
  [Property Editor](property-editor.md). The vault vimrc leaves `-` and `+`
  unmapped. `nnoremap ==` yields to Vim's `=`.
  Exactly `Ctrl+S` with no Shift, Alt, or Meta inside a Pomodoro block of the first
  `## Pomodoros` section splits (stopping propagation only when it acts),
  with an `editor:save-file` callback fallback; everywhere else the key
  reaches Obsidian untouched (Save on Linux, nothing on macOS); the
  `split-pomodoro-by-type` palette command has no default.

- [Window keys](window-keys.md): `Ctrl+W` then `h`/`l`/`w`/`1`–`9`/`H`/`L`/`v`.

## Undo history and disk reloads

When a note open in the editor is rewritten on disk (by vault-sync, the
bob CLI, Mac Capture, or another plugin's `vault.process`), the reload no
longer enters that editor's undo history: Ctrl+R / redo survives, and `u`
undoes your own last edit instead of reverting the background write.

## Settings

This plugin adds no settings tab. It honors the shared bob config file
(`plan:` lane caps, `freshness:` decay and intervals, and
`dependencies.blocks_lines` for BLOCKS mirror writes) and per-note
`task_refresh` frontmatter.

## Related

- [Copy card](copy-card.md) — Cmd+Y path, block ID, and template copy.
- [Task Card](task-card.md) — property editing controls and scheduling input.
- [BLOCKS dependency mirrors](blocks-mirrors.md) — reverse dependency rows.
- [Go to task URI](goto-task-uri.md) — open a note at a searched line.
- [Open notes URI](open-notes-uri.md) — open a batch of notes.
- [Open reference PDF in Highlights](highlights.md) — open reading PDFs.
- [Image and video zoom](image-zoom.md) — inspect cursor-line media.
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
