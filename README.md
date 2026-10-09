# bob-plugins

Source-of-truth monorepo for Bryan's custom [Obsidian](https://obsidian.md) plugins, used in the **Bob** vault.

These six plugins used to live only inside the vault under `~/bob/.obsidian/plugins/<id>/`, mixed in with third-party
community plugins and personal notes. This repo extracts the Bryan-authored plugins into one place so they can be
versioned, validated, and reviewed independently of the vault. The plugins are deployed back into the vault with
[`bob plugins sync`](#deploying-to-the-vault).

## Plugins

| Plugin                  | id                       | Version | Description                                                            |
| ----------------------- | ------------------------ | ------: | --------------------------------------------------------------------- |
| Block ID Prompt         | `block-id-prompt`        |  1.24.0 | Prompt for custom block IDs, complete wiki block links to open tasks (skipping `#hide` tasks and listing Blocked `[?]` tasks in a separate group beneath unblocked tasks), prune duplicate links from future open Pomodoros, mark dependency-blocked tasks, and — when a `^^` task-picker link is the sole content of an open Pomodoro sub-bullet — pull a uniquely future-scheduled target into today by removing its `scheduled` date, promoting Blocked/Ready to Next, and prepending a dated entry to an existing Schedule Log (never creating one for a task that keeps none); `Ctrl+Shift+Enter` toggles the open task under the cursor (including a `#hide` task) on link presence: an unlinked task opens the Link to today picker to choose which of today's Pomodoros to link into (↵ takes the current/next one, typing filters or names a new one) — prompting for a block ID next if needed — with Ready and Blocked becoming Next, Next and In Progress staying unchanged, and the same future-schedule/Schedule Log pull-forward as the `^^` flow; a linked task unlinks, removing its links under today's open Pomodoros without changing closed history and never writing the checkbox, and unlinking an In Progress task first opens an optional work-summary prompt titled `Unlink task` that records nonblank summaries as locally dated entries such as `*2026-08-15* — Added coverage` under a tab-indented managed `🛠️ **WORK LOG**` child bullet.; `Ctrl+Shift+Enter` on a selected Task Link (a plain or embedded wiki block link to a task, including 🍅-marked, `#` move-only, and struck `~~[[…]]~~` forms; one link per line is selected from anywhere on the line, several by cursor) deletes the link (the whole bullet and its children when the link is the bullet's only content) and today's other open-Pomodoro duplicates without ever changing the lane: Next, In Progress, Ready, and Blocked all stay as they are, with an In Progress target going through the same optional `Unlink task` Work Log prompt. Closed targets and legacy transclusion children are refused (dependencies live on the Depends-On line, never as embedded children). `Ctrl+Shift+Enter` on a Depends-On ⛓️ **DEPENDS ON:** line — including a malformed one with trailing prose, a half-typed link, or a prose-only label (DP31) — is refused with a notice pointing to `Ctrl+Shift+P`, and no token is ever deleted there. A VS16 link-emoji (DP24) shape is not a line and takes the normal path. Link, unlink, and Task Link Notices append the live plan budget (`· plan T/3 · L/10`, with 🔴 when over the cap) from bob-ledger-tools. `Ctrl+Shift+Enter` and `^^` stamp the target task's freshness (`[fresh:: today]`) through bob-ledger-tools when they rewrite its line. New Pomodoro Task Links are inserted immediately after the entry's last child, before any trailing blank separators. A `Ctrl+Shift+Enter` link from the row the review walk just landed on advances the walk once to the next remaining item. On an inbox note, `Ctrl+Shift+Enter` asks where the task goes before linking or unlinking, then moves it with the toggle applied (nav inboxRoute v1). |
| Bob Ledger Tools        | `bob-ledger-tools`       |  1.36.1 | Expand Bob daily-note snippets and ledger time ranges, navigate and adjust Pomodoro entries, render the live plan-budget `bob-plan` block (TODAY/PENDING/NEXT/READY chips, themes, lints), track task freshness (tiered PRE → NEW → PROJECTS → PENDING → NEXT → RECURRING → TICKLER → REFERENCES → ROTTEN → POST walk with daily lane review and `#gtd #pre`/`#gtd #post` completion-only checklist tiers and Ready-chain tracker reminders, freshness-gated READY, NEW/ROTTEN review models and chips, review queue, counts, lints, status bar), render dashboard PENDING/NEXT section badges as section/cap that agree with their Tasks sections (whole-lane pressure in the tooltip), render `[fresh::]` stamps as compact freshness marks, render `[priority::]` fields as signal-bar priority marks, render `created`/`scheduled`/`completion`/`cancelled` dates as compact date marks (including in Tasks query results), render `#task` tags as a teal hash task-tag mark (hidden in Tasks query results), render the CROWDED chip, the `bob-ready-notes` ranked-bar block, and `## Tasks` heading chips, render `DEPENDS ON` lines as live dependency chips (Live Preview plus Reading view, only on owned Depends-On rows — including DP30 rows owned by a task under a Work Log entry — with the emoji text hidden, Tasks-memo lookup folded into the freshness memo, 0-based nav api v2 refs with Reading actions on the order-mapped section line (each rendered row maps to its own source line, hidden when the counts disagree), session toggle, `waiting on N` counts open prerequisites only; Live Preview walks ancestors without copying the note), with a versioned `api` (`caps`, `planBudget`, `todayKeys`, `isToday`, `todayRank`, `nextBudget`, `pendingBudget`, `dashboardLaneBudget`, `renderDashboardLaneBadge`, `readyBudget`, `renderReadyBadge`, `renderReviewChip`, `freshness` namespace v9 (`keepLine` sole increment helper; generic stampers clear `keeps`; date-independent `decide`/`config.decay`; `trackerReview` capability with the PROJECTS tier, `projectsDue`, `referenceReview` capability with the REFERENCES tier, `referencesDue`, `recurringTier` capability with the RECURRING tier, `recurringDue`, the ten-key `byTier` histogram with `preDue`/`postDue` and `checklistTiers`, and additive `reviewEntryView`), `noteReady` namespace v1 with `renderCrowdedChip`, `dashboardCollections` namespace v1 with `snapshot`/`renderChip` for the Browse-row PROJECTS/REFERENCES badges, the additive `priorityMarks` namespace v1 (`model(value)`, `render(host, value, { decorative?, inheritColor? })`) serving the signal-bar glyph to the Task Card and priority notices, and the additive `dateMarks` namespace v1 (`model(field, dateText)`, `render(host, field, dateText, { decorative?, inheritColor? })`) serving the calendar-label glyph to later Task Card and notice rows, and the additive `progressMarks` namespace v1 (`expect`, `refresh`, `isEnabled`) driving the half-ring In Progress mark on Task Links under today's open Pomodoros with a `Toggle Task Link In Progress marks` session toggle) for the dash and the other plugins. |
| Bob Navigation Hotkeys  | `bob-navigation-hotkeys` |  2.15.0 | Task Card is the only `Ctrl+Shift+P` surface (on an inbox task every non-closing answer asks where it goes before writing and moves there): a focused first screen with exact priority previews that closes on `Esc`, `q`, or `Ctrl+[`, plus the decay-card `x` alias; its actions open the existing stages and writers. Open and manage related notes and tabs, including pinned-tab-preserving sibling closes; `Ctrl+Shift+J/K` navigates Ready, In Progress, and Next `#task` lines while skipping Blocked `[?]` tasks, except that on an open current or future Pomodoro entry the same chord instead moves that Pomodoro and everything it owns down/up among adjacent future Pomodoros, keeping the current slot's time range with whichever entry is promoted there and refusing (with a notice, without jumping) to cross the current/history boundary or the last future Pomodoro; `N<Ctrl+Shift+J/K>` moves a current/future Pomodoro exactly N positions atomically or jumps to the Nth circular navigation target elsewhere; project schedules propagate to task-level `scheduled` properties and Blocked status, `Ctrl+Shift+P` edits scheduled, dependency, and priority task properties with priority levels that roll scheduled dates, report the exact rolled ISO date/span and its distance from today, and offer date-picker re-roll suggestions, with one combined Reason/Work summary review after a `scheduled` date is chosen that records the optional reason as a nested entry under a `🗓️ **SCHEDULE LOG**` child bullet — an empty reason on a task that already keeps a log records `🤷 no reason given` rather than nothing, while a task with no log yet is left untouched — while choosing a priority level or the pinned roll suggestion instead writes immediately with its own deterministic reason that records the exact chosen relative day and configured priority window, giving a task a strictly future `scheduled` date also removes its live links from today's open Pomodoro entries, `N<Ctrl+Shift+P>` edits the current task plus the next N real tasks with independent schedule-log roll choices; on a dedicated Task Link bullet the same bare or counted keymap instead edits the linked task in its own note (with a Depends on row that opens that task's own stage), covering the link plus the next N sibling links and clamping at the Pomodoro end, with future-date picks marking the targets Blocked and pruning their links from today's open Pomodoros; dependency writes go through one managed `⛓️ **DEPENDS ON:**` first-child line per task (plain links in addition order, the `[dependsOn::]` field derived from the line, legacy sole-link children folded in, adding an open prerequisite marking the dependent Blocked and raising the target to its lane, removing the last open prerequisite recovering it immediately) committed in one undoable edit with cross-note `^id`/`[id::]` awaited and prepared first (aborting untouched on failure), blockquoted tasks refusing dependency edits, vault-wide link form (archive links keep the explicit `done/` path), unloaded-note tolerance, stale reopen, and `not-on-line` removal refusal, the Depends on value stage searches every open task in the vault (Tasks cache with open-buffer overrides (Warm-empty counts as ready), chunked cancellable scan fallback from one shared parse per note, capture-ranker order with `#hide` last, CURRENT/RESULTS/BLOCKED sections, empty-query same-note plus In Progress/Next with a type-to-search-more cap hint, short self/cycle/unencodable/stale guards with stale reopen, `−`/`＋`/`＋ id`/`🔒 waits on N` badges with muted `#hide` rows, description-named notices, Task Link batches, `＋ id` prompts checked against the target note) reachable from a task line, the Depends-On line itself, a chip, a Task Link, or the `Edit task dependencies` palette command, and a frozen api v3 (`openDependencyStage`, `removeDependency`, `claimReviewWalkCompletion`, plus `reviewWalk` with `capture`/`continue`) serves the ledger-tools chips; answering the landed review row advances the walk once to the next remaining item, bare `Ctrl+Shift+M` moves the current task and focuses the destination note on the moved task (separating the section's first moved task from the heading or count preamble with a blank line), `N<Ctrl+Shift+M>` moves it plus the next N movable tasks and focuses the destination note on the first of them, including from the row the review walk just landed on: a move never advances the walk, and the next `]s` / `[s` resumes at the moved row's walk neighbour, with `Ctrl+O` returning to the post-removal source seam and `Ctrl+I` returning to the first moved task without undoing the move, while the same bare or counted keymap on a Pomodoro sub-bullet instead moves that bullet plus the next N siblings, each carrying its descendants, into another open Pomodoro in the same note or into a new `- [ ] () — NAME` Pomodoro created directly below the current one from a typed, uppercased, em-dash-stripped picker name; typing `=` creates a fresh destination with the source Pomodoro's normalized name when the source is named, typing `=NAME` peels every matching `NAME` component from a merged source into a new placeholder containing the selected bullet subtrees while the source keeps the remaining name or becomes unnamed when no components remain, and unnamed sources or names that are not part of the source require typing a new name instead; exact duplicate destination bullets merge away, moving out a source's last owned content deletes that Pomodoro entry instead of leaving it behind, and nested `#task` lines under Pomodoro entries route to the Pomodoro move; the same keymap on a Pomodoro **entry** line itself instead opens a picker where Enter on another open Pomodoro keeps the existing whole-entry move/delete behavior, typing a name that is not an existing open Pomodoro's name renames the entry in place without moving or creating anything, and Ctrl+X on a highlighted open current/future Pomodoro merges entries in one undoable edit: a current timed entry survives and absorbs the selected future one, otherwise the highlighted entry survives, survivor bullets stay first, absorbed bullets append without duplicate suppression, names combine survivor-first with ` + ` up to the 48-character limit, and invalid or over-length names are refused without changing the note; any count is accepted but ignored since the operation is whole-entry; bare and counted `!` only toggle transclusion markers and are refused on ⛓️ **DEPENDS ON:** lines with a notice pointing to `Ctrl+Shift+P`, and `Ctrl+Shift+Alt+N` creates a project note from a task whose checkbox-less, ALL-CAPS direct child bullets with their own sub-bullets (e.g. `REQUIREMENTS`, `FUTURE WORK`) become title-cased `##` sections — reusing a matching existing header case-insensitively or appending a new one at the end of the note — with their descendants copied in verbatim as notes rather than converted into `#task` lines, while a source task's managed schedule and work logs, in source order, move under the new project's `^prj` task, and promoting a task with real project tasks expands each live dedicated Pomodoro Task Link to the source (today/future open entries) into one sibling link per new project task in document order — preserving embed, 🍅 markers, checkbox, move-only `#`, and the first link's subtree, dropping the old alias — while history, past dates, struck/closed links, prose, fenced examples, Markdown links, and zero-task projects still rewrite one-to-one to `^prj` (e.g. `[[Work_ship#^ship]]` becomes `[[Work_ship#^design]]` + `[[Work_ship#^test]]` live and `[[Work_ship#^prj]]` in history), and the same hotkey on a project note's `^prj` task converts that note back into a parent-task block in the parent's `## Tasks` section — carrying tasks, uppercased section bullets, and the `^prj` subtree back as children, repointing `#^prj` links, and trashing the note; Alt+N commits Ready to Next or releases Next/In Progress to Ready on the current task plus the next N tasks (or the linked task plus the next N sibling Task Links, clamped at the Pomodoro end), unlinking released tasks from today and reporting the NEXT/PENDING counts with the weekly-review hint when over the cap, with the same lane toggle on the Task Card (`Alt+N`) that asks for an optional Work Log summary when releasing In Progress; `Alt+[` / `Alt+]` on a Pomodoro Task Link toggles the linked task between Next and In Progress (start-wins batches, Move to Next prompt with an optional Work summary logged to each paused task, preimage-checked writes, In Progress mark hint) through `api.taskLinkLane` v1; the Task Card's Cancel action (`x`) closes the task as Cancelled with an optional reason kept in a first-child ❌ **CANCEL LOG**, pruning its links from today's open Pomodoros; `Ctrl+Alt+J/K` walks the tiered freshness review queue PRE → NEW → PROJECTS → PENDING → NEXT → RECURRING → TICKLER → REFERENCES → ROTTEN → POST vault-wide from bob-ledger-tools (wrapping with a notice); `N]s` / `N[s` jump N review-queue entries in one landing, and a bare chord stays one entry; `]s` / `[s` (and Ctrl+Alt+J/K) away from the current review task (the row the walk last landed on, even after opening another note) first return to it with a `Back to current review task` toast, the count is ignored on that press, `<C-o>` goes back, and the next press steps from the task; with tier-aware notices naming the tier rank and the confirmation age plus a keep/release/today second line on lane tiers, a Commitments-done/ROTTEN-next boundary line when stepping into ROTTEN upkeep (` · ]S closes the review` when POST remains), and a walk anchor that continues from the handled task's successor after keeps, releases, and rolls (`[s` after a stamp steps backwards), while `[S`/`]S` jump to the first/last queue entries without wrapping or the boundary preamble (`]S` closes on POST); On the exact PRE/POST row the review walk just landed on, Ctrl+Enter completes through task-status-cycler API v2 (including `[?]`) and advances to the next live row of that group without wrapping or crossing and shows a completion/landing toast; the final PRE row stays put with a `]s` next-tier hint, and an unclaimed Ctrl+Enter behaves as before. Alt+F completes a checklist row in place; Ctrl+Alt+F completes and advances, crossing PRE into the next tier. On a landed RECURRING row Alt+F and Ctrl+Alt+F write nothing, show the recurring-tier notice, and stay; Ctrl+Enter completes and Ctrl+Shift+Enter links to Today, each advancing once, while lane and route changes never resolve it. POST multi-row reviews advance with Ctrl+Enter or Ctrl+Alt+F, while Alt+F stays and counts remaining rows; the review closes on the last row. Checklist completion needs ledger freshness namespace v8 `checklistTiers` plus cycler v2; `Alt+F` stamps the cursor task — or a dedicated Task Link's target — plus the next N tasks when counted through `api.freshness.keepLine` (exact due Ready keeps count once; other stamps clear `keeps`); if a stamp target is Pending (`[/]`), Alt+F and Ctrl+Alt+F ask once for an optional Work Log summary, write it only to Pending targets, refresh without a log on blank Enter, and cancel without writing or advancing on Escape; `Ctrl+Alt+F` stamps then advances to the next due task; a single press on an exact, due, at-limit task instead opens the approved-decay decision card and writes nothing, while counted and Task Link sessions skip those targets with a `1 needs a decision` notice; tier notices need freshness api v4 and fall back to the v3 text otherwise, using additive `reviewEntryView` when present, with PROJECTS notices naming the empty project and REFERENCES notices naming the reference once the `trackerReview`/`referenceReview` capabilities are present; `Alt+N`, the `Ctrl+Shift+P` priority/scheduled/dependsOn/delete-property/lane rows, and `Ctrl+Shift+M` moves stamp every rewritten open task through `api.freshness.stampLine`; `Ctrl+D` on the Depends on row deletes the task's Depends-On line, its `[dependsOn::]` field, and any legacy children with immediate recovery, and hand edits mirror R1/R9 once the cursor leaves the edited line (malformed lines are left alone), seeding the baseline from the burst's first pre-change state with the owner resolved in baseline coordinates and mapped forward so an insertion above can never re-aim the lookup at the next sibling, and the BLOCKED badge counts open prerequisites from the candidate's own Depends-On line with or without a block id — showing `🔒 waits on N` only for N ≥ 1, else `🔒 scheduled YYYY-MM-DD`, else `🔒 blocked` — while cycle guards tooltip descriptions, same-note batches guard the post-batch graph, and every stale refusal (same-note, cross-note batch, counted vault, stale commit, `＋ id` prompts) reopens the stage fresh with nothing written, and the Task Card's Review every action sets or clears `[refresh:: N]` through `api.freshness.setRefreshLine` (which also stamps), reading lane intervals from `api.freshness.intervalForLine` with the task's own refresh kept as the once-Ready return value; `Ctrl+Enter` on `scheduled` takes the previewed recommended roll, decay, or cancel from the decay ladder, including one composed batch write for counted and Task Link sessions; on the Task Card, Enter opens Schedule so the recommendation shortcut lands immediately; scheduling a Pending or Next task offers an optional Work Log summary recorded as a dated entry under a WORK LOG child. Normal-mode Enter on a link and `Ctrl+Shift+M` task moves record a file-aware jump (100-entry session history shared with native gg/search jumps): Ctrl+O returns to the originating note and exact cursor (the post-removal seam for moves), Ctrl+I goes forward (the first moved task for counted moves) without undoing the move, counts traverse multiple entries, new jumps replace the forward branch, same-note heading/block and already-open tabs round-trip, Backspace shares the link path, and Tab/insert/visual Vim behavior is unchanged. The Task Card level strip and priority notices render the shared signal-bar priority mark through the bob-ledger-tools api.priorityMarks v1 namespace, falling back to the Lucide signal icons without it; closing a planned task links what it unblocked into its slot and reports it on the Unblocked card through the nav api.notice v1 namespace. |
| Bob Project Tasks       | `bob-project-tasks`      |   1.0.0 | Keep project task counts materialized in frontmatter.                 |
| Bob Vim Surround        | `bob-vim-surround`       |   1.5.2 | Add vim-surround `ys` motions, `cs` changes, `ds` deletes, and dot-repeat to Obsidian Vim mode. |
| Task Status Cycler      | `task-status-cycler`     |  1.27.0 | Complete Pomodoros (carrying worked-on links above deferred `#`-marked links, each in source order, copying a closed named Pomodoro's name onto the Pomodoro that completion creates, and copying each Task Link sub-bullet's sub-sub-bullets as locally dated entries such as `*2026-08-26* — Read \`research.15\`!` into that link's task, under a tab-indented managed `🛠️ **WORK LOG**` child bullet created when the task has none), toggle empty Pomodoro placeholders/sub-bullets with `Ctrl+Alt+]` including named empty placeholders, toggle an Obsidian task to or from a normal bullet with `<Ctrl+Shift+]>` / `<Ctrl+}>` — routing every eligible plain-bullet promotion in a note with exact `Tasks` through a section picker (blank Enter chooses `Tasks` and converts once to checkbox/`#task`/`created`, including in-place conversion when the bullet is already in that `Tasks` section; existing or typed non-`Tasks` destinations keep the bullet plain and create a bottom-level `##` heading when the title is novel; emptied non-`Tasks` source sections are removed), prompting for an existing or new destination when demoting from `Tasks` (blank Enter chooses the first real destination when sections exist and creates `## Requirements` only for a Tasks-only note), and routing other demotions into the next Markdown section — cycle a Blocked `[?]` task to Ready/Cancelled with `<option+]>`/`<option+[>` — retiring its own uniquely future `scheduled` date and prepending a `🔓 unblocked by hand` entry to an existing Schedule Log without ever creating one — recover affected Blocked dependents, preserve embedded-task behavior, and propagate `Ctrl+Enter` on a task line wrapping an embedded block transclusion to close/reopen the transcluded source task too (retirement still only touches indented references). `Ctrl+Enter` on a selected Task Link, embedded or plain and including inside an open Pomodoro, closes the linked task and strikes the link through as `~~[[…]]~~`, and pressing it again reopens both. Plain links close root-only, embedded links close their transcluded tree, and Depends-On ⛓️ **DEPENDS ON:** lines are never struck, restored, reformatted, or tree-closed (malformed lines guarded like accepted ones, including the DP31 prose-only line; VS16-emoji, lowercase, unmarked, and blockquoted shapes unguarded): `Ctrl+Enter` on one closes or reopens the linked prerequisite only, and `Alt+[`/`Alt+]` cycle the link under the cursor (counted cycling shows the same `⛓ Put the cursor on a dependency link` notice as the single form when the cursor names no link); on a Pomodoro Task Link line, `Alt+[`/`Alt+]` instead delegate to nav `api.taskLinkLane` v1 to toggle the linked task between Next and In Progress (asking once for an optional Work Log summary when moving back to Next), never reformatting the bullet; only links that do not resolve to a task fall back to completing the Pomodoro; Ctrl+Enter on a Task Link to a Cancelled task instead shows a notice and leaves the Pomodoro open, Blocked dependents with a strictly future `scheduled` date stay Blocked, and a versioned `api.recoverBlockedDependents` lets other plugins recover Blocked dependents without retiring references. `Alt+[`/`Alt+]` cycling to an open status (including leaving Blocked, counted lines, and transcluded targets) and `Ctrl+Enter` reopening stamp the task's freshness (`[fresh:: today]`) through bob-ledger-tools. Ctrl+Enter on the PRE/POST row the bob-navigation-hotkeys review walk just landed on hands off to that walk to complete the row and move within its group when another live row remains. Ctrl+Enter on a lane/other landed row closes it and continues the walk once, never onto a checklist row. |

Versions are tracked **per plugin** — there is no lockstep release. Each plugin's authoritative version lives in its own
`plugins/<id>/manifest.json` (e.g. `bob-navigation-hotkeys` is ahead of the others at `2.7.2`).

## Task Card

`Ctrl+Shift+P` (`bob-navigation-hotkeys:set-bullet-property`, palette **Task card
(set properties)**) always opens the **Task Card**. There is no plugin setting,
no activation date, and no filtered property list: the card is the only
surface. Screenshots are omitted until an interactive Obsidian pass records
light, dark, and narrow layouts.

| Gesture | Outcome |
| --- | --- |
| `1`–`4` | Set that configured P-level and its frozen displayed date; extra configured levels get unique digits up to `9` |
| `0` | Clear priority to implicit P0; keep the scheduled date |
| `Ctrl+Enter` | Apply the cached recommendation (`Cmd+Enter` alias) |
| `Ctrl+R` | Regenerate recommendation and priority previews; no write |
| `Enter` | Open the selected action; Schedule is the default |
| `b` | Blocked by (Depends on) |
| `f` | Review every (Refresh) |
| `x` | Cancel-reason stage; never cancels on the key alone |
| `Alt+N` | Commit to Next or release to Ready |
| `Ctrl+D` | Delete the selected property (default selection is Schedule) |
| Commit on a landed review row | A resolving commit advances the walk once to the next remaining item |
| Backspace on empty / Back | Return to the card without writing |
| Escape, `q`, `Q` | Close; discard uncommitted state (`q` never closes while a text field is focused) |
| `Ctrl+[` | Close from the card or from any stage it opened, including a focused date, reason, or Work summary field; nothing is written |

Any card gesture that writes closes the card. On a Next or Pending task, a
priority-level or recommendation gesture first opens the **Schedule task** Work
summary stage.

**Scope and previews.** The header shows the cleaned task text, note, lane,
priority, schedule, dependency counts, and review interval. Counted sessions
name N+1 scope and mixed values. Task Links say `via Task Link` and name target
notes. Each P-level shows its exact ISO date; batches show a span plus
per-target disclosure. Same-level `2` on P2 is a deliberate re-pick that resets
the roll streak. Unbound keys do nothing: letters, `/`, and digits that do not
map to a configured P-level never open a list and never write. Custom list
properties stay in the More section, and a More row opens that property's value
stage.

**Scheduling input.** The date field accepts a bare `N` days (`0` today, `1` tomorrow);
unsigned `Nd`, `Nw`, and `Nm`; weekday names `mon`…`sun` (the next occurrence
strictly after today); and the existing ISO, `M/D`, `M-D`, `+Nd/w/m`, and preset
forms. The preview row shows the weekday, ISO date, relative distance, and the
year at a year rollover. A complete date token followed by whitespace and text
is an inline reason (`3 waiting on API`). `Shift+Enter` skips the reason via the
blank-reason rule without skipping an applicable Work summary; otherwise one
combined Reason/Work summary review opens. Invalid, negative, overflow, or
ambiguous input never writes. Other date properties reached from More use the
strict parser: ISO, `M/D`, `M-D`, `+Nd/w/m`, and preset forms.

**Logs.** Blank reason writes `🤷 no reason given` only for targets that already
keep a Schedule Log. Blank Work summary writes no Work Log. Priority picks keep
their deterministic 🎲 reason and only offer Work summary when a Next/Pending
target qualifies.

**Deliberate changes from the old first screen.** Bare Enter on an unprioritized
task opens Schedule, not the lane. `Ctrl+D` with default focus clears Schedule.
Alt+N remains the fastest lane gesture.

**Undo.** One local/count edit is undoable. Cross-note Task Link writes do not
undo from the daily note with a single Ctrl+Z.

**Direct entries.** Direct Depends-On, chip, palette dependency, and decay
**Less often** entries still open their stage without the card. The decay card
accepts `x` as an alias for `d` Drop. Freshness-decay Alt+F cards are a
separate gesture from this Task Card surface.

Bob Ledger Tools expands editor snippets with Tab or the **Expand Bob snippet** command.
Date calculation uses local calendar days: `d[-]<N>` (e.g. `d0` -> `2026-08-16`, `d1` ->
`2026-08-17`, `d-1` -> `2026-08-15`) expands to the bare ISO date, while `D[-]<N>` (e.g.
`D0` -> `_2026-08-16_ — `, `D1` -> `_2026-08-17_ — `, `D-1` -> `_2026-08-15_ — `)
expands to the emphasized local date, an em dash, a trailing space, and places the cursor
immediately after that trailing space. One isolated `-` immediately before the cursor
(e.g. `left-right` with the cursor after the hyphen) expands exactly that hyphen to an
em dash followed by a trailing space (`— `, U+2014 U+0020), producing `left— right` and
placing the cursor right after the inserted space. Existing suffix whitespace is left
alone, so `- suffix` becomes `—  suffix`. `--`, `---`, and longer adjacent-hyphen runs
are left untouched so Markdown thematic breaks, YAML frontmatter delimiters, and other
multi-hyphen text keep Obsidian's normal Tab behavior.

Bob Ledger Tools also renders a live ` ```bob-plan ` block: a `TODAY 3/3 · 7/10` chip (the theme/link budget, whose tooltip lists each theme
with its link count), `PENDING n/10`, `NEXT n/15`, and `READY n/100` chips that open the matching `dash` sections, the
`★ GOALS · DECKS · BOB` theme line with the highlight starred, and one muted line per lint. READY is the shared live
current backlog (Today excluded, `dash#READY Tasks` destination, red only when over its soft `max_ready` cap) and never
changes the PLAN status. READY over its cap adds a `ready_cap_exceeded` lint line. Today is read from the
ledger at render time (the open tasks with a dedicated Task Link under today's open Pomodoros, per `docs/plan.md`
in bob-cli) and kept in a synchronous cache that rebuilds on layout ready, on daily-note change/create/delete/rename,
and at local-midnight rollover; when the key set changes, every open Tasks query re-reads via the
`obsidian-tasks-plugin:reload-open-search-results` event. Caps come from the `plan:` block in
`~/.config/bob/config.yml` (`max_next`, `max_pending`, `max_ready`, `max_ready_per_note`; a legacy `max_now` loads without error) with built-in
defaults when the file, the block, or a value is missing or invalid; the block re-renders live when the daily note
or the Tasks cache changes and shows `–` placeholders, never an error, when there is no daily note, no Pomodoros
section, or no Tasks plugin. Its supported interface for the dash and the other plugins (which never import one
another's `main.js`) is `app.plugins.plugins["bob-ledger-tools"].api`: `{ version: 3, caps(), planBudget({path?,
content?}), todayKeys(), isToday(task), todayRank(task), nextBudget(), pendingBudget(), dashboardLaneBudget(lane), renderDashboardLaneBadge(parent, {lane?, sourcePath?, component?}), readyBudget(), renderReadyBadge(parent, {sourcePath?, component?}), renderReviewChip(parent, {kind?, sourcePath?, component?}), freshness, noteReady, priorityMarks, dateMarks }`, where
`freshness` is `{ version: 8, trackerReview: true, referenceReview: true, checklistTiers: true, config(), stampLine(line, dateText?), setRefreshLine(line, days, dateText?),
keepLine(line, dateText?, { counted }?), state(task), bucket(task), reviewModel(), isDue(task), tier(task), rank(task), intervalFor(task), intervalForLine(line, noteRefreshRaw?), queue(), counts(), lints(), reviewEntryView(entry, { todayText }?) }` computed from
`[fresh:: YYYY-MM-DD]` / `[refresh:: N]` / `[keeps:: N]` per `docs/freshness.md` in bob-cli (config from the `freshness:` block,
note overrides from `task_refresh` frontmatter). `keepLine` is the sole increment helper (a counted keep stamps and
increments once, saturating at 999, with a valid prior `fresh` before today required; uncounted keeps preserve);
every generic stamper clears `keeps`. Queue rows carry `keeps`/`decide`, counts carry `decide`, and `config()`
reports normalized `decay` (`enabled`, `keeps`, `enter`) with no calendar gate.
Folded keep pips always render in the freshness mark; the leaf plus `Alt+F to decide` appears only when the nav card capability is present (`freshnessDecayCard.version >= 2`) and decay is on, with counting-only wording otherwise. READY counts gate on the read-time bucket (NEW and ROTTEN review
stay out of READY); `reviewModel()` shares the NEW/ROTTEN counts, meter, tooltip, and severity behind both chips.
Every `freshness` member is synchronous and never throws. `noteReady` is `{ version: 1, snapshot(now?), forNote(path), counted(task), inCrowdedNote(task), groupLabel(task), renderCrowdedChip(host, { sourcePath?, component? }) }` with the live `bob-ready-notes` code block and the `## Tasks` heading chip (Live Preview widget plus Reading view),
the read-only per-note Ready cap (`docs/plan.md`, "Ready cap per note" in bob-cli): each area/project note's
Ready lane against `plan.max_ready_per_note` (default 5) with per-note `ready_cap` overrides, crowded/full/room
states, freshness make-up, and lints, memoized in one O(tasks) pass with live invalidation. Every `noteReady`
member is synchronous and never throws.
Placement is the exception to the copy-small-helpers rule: nav, task-status-cycler, and block-id-prompt call
`api?.freshness?.stampLine?.(line, dateText) ?? line` (api `version >= 3`) instead of placing `fresh` themselves.
The plugin also shows a desktop review footer in the native status bar: nonempty walk groups only (PRE → NEW → PROJECTS → PENDING → NEXT → RECURRING → TICKLER → REFERENCES → ROTTEN → POST, with TICKS split from ROTTEN), using short tier labels (`WIP` for PENDING, `RECUR` for RECURRING, `TICKS` for TICKLER, `REFS` for REFERENCES) and omitting the current review group from the trailing summary (the full summary shows when no review row is current), a condensed `]s` context with the same short labels while the cursor is on a due task, and the `]s next` hint otherwise. `]s` jump notices and `reviewEntryView` keep full tier names. The tooltip carries a legend line for the abbreviations shown (`WIP = PENDING · RECUR = RECURRING · TICKS = TICKLER · REFS = REFERENCES`) and notes that the footer splits TICKS from ROTTEN while dashboard ROTTEN chips still fold both. The item hides entirely when the queue is empty (including a met upkeep budget) or Tasks is unavailable. The main button clicks through to nav's next-due-task jump, falling back to `rotten`. `reviewEntryView` is additive under freshness namespace v5 and remains on v9.

The freshness mark renders each canonical `[fresh:: YYYY-MM-DD]` stamp as a compact mark (`✓ today`, a draining lease ring with its age, `⟳ Nd` when due) in Live Preview and rendered views (reading view, Tasks query results, embeds, hover previews). Resolution is exact or neutral: an exact memo match or unanimous consensus drives the tone, otherwise the mark shows only the neutral lease and never a guessed due. Leftover Dataview pills in Live Preview are non-canonical stamps flagged for repair, and the "Toggle task freshness marks" command (session only, default on) restores the old pills. The mark is display-only: nothing writes it and the `freshness` api is unchanged.
The priority mark renders each canonical `[priority:: …]` field as one signal-bar glyph (4/3/2/1 filled bars for P1–P4, a solid `!` square for off-ladder `highest`) in Live Preview and rendered views, with Tasks query results covered by CSS alone on Tasks' own `data-task-priority`. The glyph is chosen by stored Tasks value, never by ladder position; labels and roll windows in the tooltip come from the `properties[]` priority ladder (leniently read, cached, and stat-checked), and an unknown ladder omits P-labels instead of guessing. Leftover `priority` Dataview pills in Live Preview are non-canonical fields flagged for repair, and the "Toggle task priority marks" command (session only, default on) restores the old pills and emoji. The mark is display-only: nothing writes it, and the additive `api.priorityMarks` v1 namespace (`model`/`render`) serves the glyph to the Task Card and priority notices.
The date mark renders each canonical `created`/`scheduled`/`completion`/`cancelled` field as one monochrome glyph plus a calendar label (`today`, `tomorrow`, `Fri`, `Oct 22`) in Live Preview and rendered views (reading view, embeds, hover previews, Dataview task views, Tasks descriptions that still carry a non-trailing field, and Tasks query results through a bounded frame pass with CSS-only short-mode glyphs). Near dates read as words with the exact date and distance in the tooltip; the cursor or a click reveals the raw field, malformed fields get a dashed repair flag, labels roll over at local midnight without a reload, and the "Toggle task date marks" command (session only, default on) restores the old pills. The mark is display-only: nothing writes it, and the additive `api.dateMarks` v1 namespace (`model`/`render`) serves the glyph to later Task Card and notice rows.
The task tag mark renders each exact `#task` tag on a task line as one small teal identity hash glyph in Live Preview and rendered views (reading view, embeds, hover previews, Dataview task views), while Tasks query results hide the tag entirely because every row is already a `#task` task. Closed tasks keep a faint ghost of the hue. The glyph is the one signal that a checkbox is a tracked task: plain checkboxes stay unmarked, non-task lines keep the raw pill, and the cursor or a click reveals `#task` for editing. The "Toggle task tag marks" command (session only, default on) restores the pills everywhere at once. The mark is display-only: nothing writes it, and there is no api namespace.
`planBudget({content})` budgets post-write text synchronously (handy for Notices); without `content` it reads the
target note and returns a Promise. `isToday` uses the task's path plus its Tasks `blockLink` (` ^id`) and returns
`false` before the first cache build or when fields are missing; `todayRank` is the ledger index or
`Number.MAX_SAFE_INTEGER`. `readyBudget()` is synchronous and guarded, returning `{ count, cap, over }` with
`count: null` (and `over: false`) when Tasks data, a non-`Warm` cache, the initial Today build, or the evaluation is
unavailable; `renderReadyBadge(parent, { sourcePath, component })` renders the shared READY badge (daily and dash use
the same element, classes, fraction, tooltip, and `dash#READY Tasks` destination; each host styles it in its own chip
style: two-tone label/value on the dash, single-tone inside the daily `bob-plan` block) with lifecycle-owned live updates.
`dashboardLaneBudget(lane)` is the additive dashboard contract (`pending` uses `IN_PROGRESS`, `next` uses symbol `*`):
it returns `{ section, lane, cap, over, today }` with `section`/`lane` null when unavailable (never a silent zero)
while no-argument `pendingBudget()`/`nextBudget()` keep whole-lane semantics for non-dashboard callers;
`renderDashboardLaneBadge(parent, { lane, sourcePath, component })` renders the section count over the whole-lane cap (`PENDING 49/10`, red when the whole lane exceeds the cap) with whole-lane
pressure (`49 in this section; whole lane 50/10; 1 in TODAY`) in the tooltip and lifecycle-owned live updates.

Task Status Cycler exposes a versioned cross-plugin surface the same way (plugins never import one another's `main.js`): `app.plugins.plugins["task-status-cycler"].api` is `{ version: 2, recoverBlockedDependents(identities, context?), completeTaskAtCursor(editor) }`. Each identity is `{ path, blockId, taskId }` with at least one of `blockId`/`taskId`; `recoverBlockedDependents` runs the same Blocked-dependent recovery Ctrl+Enter uses — including the strictly-future-`scheduled` guard — without retiring references, and resolves to `{ reopened, failures }` without ever throwing. `completeTaskAtCursor` closes the cursor `#task` through the Tasks `set-status-symbol-to-x` command (so recurrence fires), never stamps, never writes `[x]` raw, and resolves to `{ ok: true, lineDelta }` or `{ ok: false, reason }`.

Bob Vim Surround accepts every visible, single-UTF-16-code-unit letter, number,
punctuation character, or symbol as a surround key. The standard bracket aliases
retain vim-surround padding behavior; all other accepted characters are symmetric
delimiters. Whitespace, controls and navigation keys, modifier chords, composition
and dead keys, combining marks, and multi-code-unit characters such as emoji are
not accepted. Symmetric delimiters are discovered as sequential pairs of maximal
same-line runs around the cursor, and paired runs must have equal lengths. Delimiter
runs inside the content can therefore make pairs ambiguous; this intentionally does
not attempt nested parsing. `cs` replaces both complete matched runs with the
requested pair, while each `ds` removes one delimiter from each side.

## Layout

```text
bob-plugins/
  README.md
  LICENSE
  .gitignore
  package.json                  # dependency-free repo tooling
  scripts/
    build-plugins.mjs           # deterministic source-fragment build and staleness check
    check-split-parity.mjs      # compare a generated plugin with its recorded source base
    block-id-prompt-harness.cjs # shared block-id-prompt test harness
    ledger-tools-harness.cjs # shared ledger-tools test harness
    navigation-hotkeys-harness.cjs # shared navigation hotkeys test harness
    navigation-dependencies-stage-harness.cjs # shared navigation dependencies-stage test harness
    test-navigation-dependencies-stage-*.cjs # per-area navigation dependencies-stage coverage
    task-status-cycler-harness.cjs # shared task-status-cycler test harness
    test-block-id-prompt-*.cjs  # per-area block-id-prompt coverage
    test-ledger-tools-freshness-placement.cjs  # placement vectors, stamping/refusals, reader lints
    test-ledger-tools-freshness-states.cjs  # state vectors, config coercion/loading, interval precedence
    test-ledger-tools-freshness-namespace.cjs  # public namespace, invalidation/events, status bar, synchronous API
    test-ledger-tools-freshness-review-model.cjs  # bucket partition, calendar dates, model/chips, memo/config/cache identity
    test-ledger-tools-freshness-queue.cjs  # Q1/Q2, L1-L5, R1/R2, missing-created ordering, upkeep/meter
    test-ledger-tools-freshness-tracking.cjs  # tracker intervals/counts/queue, checklist vectors, reference capability
    test-ledger-tools-priority-marks.cjs  # priority-mark parser/model/tooltip, ladder reader, Live Preview, rendered views, api v1, CSS contract
    test-ledger-tools-progress-marks.cjs  # In Progress mark link model (P1-P14), hints, Live Preview widget, Reading view, api v1, CSS contract
    test-ledger-tools-date-marks.cjs  # date-mark parser/labels/tooltip, folding, Live Preview, rendered views, rollover, api v1, CSS contract
    test-ledger-tools-date-marks-tasks.cjs  # Tasks-result frame pass (T vectors), short-mode CSS, rollover relabel
    test-plugin-build.cjs       # focused build-contract coverage
    validate-manifests.mjs      # manifest + main.js sanity checks
    migrate-dependency-lines.mjs # dry-run-first Depends-On line migration
  plugins/
    block-id-prompt/{manifest.json,main.js,styles.css,src/fragments.json,src/*.js}
    bob-ledger-tools/{manifest.json,main.js,styles.css,src/fragments.json,src/*.js}
    bob-navigation-hotkeys/{manifest.json,main.js,styles.css,src/fragments.json,src/*.js}
    bob-project-tasks/{manifest.json,main.js}
    bob-vim-surround/{manifest.json,main.js}
    task-status-cycler/{manifest.json,main.js,styles.css,src/fragments.json,src/*.js}
```

Each `plugins/<id>/` folder is exactly the shape Obsidian loads from `<vault>/.obsidian/plugins/<id>/`.

## Development model

These are **plain CommonJS** Obsidian plugins. Plugins without `src/fragments.json` keep their current layout: their `main.js` is hand-edited source. block-id-prompt, task-status-cycler, bob-ledger-tools, and bob-navigation-hotkeys opt into the source build described below; each generated `main.js` remains the committed and deployed Obsidian entrypoint.

### Generated plugin sources

A plugin opts into the build contract by adding an ordered `src/fragments.json` array.
The array lists every JavaScript fragment relative to that plugin's `src/` directory.
Fragments are shared-scope scripts concatenated in manifest order; they are not separate
CommonJS modules, so declarations can be shared across fragment boundaries. The build
rejects missing, duplicate, escaping, malformed, or omitted fragments, syntax-checks each
fragment and the assembled bundle, and enforces a 1000-line limit for hand-edited
fragments. The generated entrypoint includes deterministic source banners and is committed
with the source fragments.

Block ID Prompt, Task Status Cycler, and Bob Ledger Tools group their plugin methods
into ordered plain mixin classes. Bob Navigation Hotkeys splits its picker into ordered
mixins that extend FilteredPickerModal so super still resolves; its plugin mixins are
plain classes.
Duplicate-safe installers copy each mixin's own method descriptors onto the plugin
prototype in source order, preserving the Obsidian plugin class interface.

Use `npm run build` after editing fragments and commit both the source and generated
`main.js`. Never hand-edit a generated entrypoint. `npm run build:check` is read-only
and reports a stale or missing bundle. Both `npm test` and `npm run validate` run this
staleness check before their other checks.

To verify a split against its recorded Git source base, run:

```bash
node scripts/check-split-parity.mjs --plugin task-status-cycler --base <git-sha>
node scripts/check-split-parity.mjs --plugin bob-ledger-tools --base <git-sha>
node scripts/check-split-parity.mjs --plugin block-id-prompt --base <git-sha>
node scripts/check-split-parity.mjs --plugin bob-navigation-hotkeys --base <git-sha> --split-helper BulletPropertyPickerModal
```

The parity checker compares the exported helpers, plugin prototype methods and
descriptors, and module-load dependency calls. Use repeatable `--split-helper <name>`
arguments for exported helper classes intentionally split into methods across source
fragments; those classes must keep their name, superclass, and every own prototype
method, but their whole-class source text is not compared.

Each plugin folder contains the files Obsidian reads when loading a plugin:

- **`manifest.json`** — plugin metadata. Obsidian loads a plugin from
  `<vault>/.obsidian/plugins/<id>/manifest.json` + `main.js`, so the manifest `id` must match the folder name. Shape:

  ```json
  {
    "id": "bob-project-tasks",
    "name": "Bob Project Tasks",
    "version": "1.0.0",
    "minAppVersion": "1.8.7",
    "description": "Keep project task counts materialized in frontmatter.",
    "author": "Bryan",
    "isDesktopOnly": false
  }
  ```

- **`main.js`** — the plugin code (CommonJS: `require(...)` / `module.exports`), generated from `src/` for plugins with `src/fragments.json`.
- **`styles.css`** — optional plugin CSS (currently `block-id-prompt`, `bob-ledger-tools`, `bob-navigation-hotkeys`, and `task-status-cycler` ship one).

### Validation

```bash
npm run build
npm run build:check
npm test
npm run validate
```

`npm test` runs the focused pure-helper coverage for Bob Navigation Hotkeys,
including scheduled-project task extraction, frontmatter handoff, date
boundaries, project-property target resolution, scheduled task-visibility
reconciliation, due/deleted inline-schedule recovery, current/previous
Pomodoro rank snapshots, named-Pomodoro parsing, Pomodoro bullet-move
and named-component peel/split planner coverage, Pomodoro entry move/rename/merge planner coverage,
Ctrl+X Pomodoro entry picker coverage,
guarded counted writes, deletion behavior,
child-picker presentation metadata, the tab-pin Vim mapping, and
pinned-tab-preserving sibling closes. The navigation hotkeys tests are the per-area
`scripts/test-navigation-hotkeys-*.cjs` files and they share
`scripts/navigation-hotkeys-harness.cjs`. The task-status-cycler tests are the
per-area `scripts/test-task-status-cycler-*.cjs` files and they share
`scripts/task-status-cycler-harness.cjs`. Run the cycler suite on its own with
`node --test scripts/test-task-status-cycler-*.cjs`. The block-id-prompt tests
are the per-area `scripts/test-block-id-prompt-*.cjs` files and they share
`scripts/block-id-prompt-harness.cjs`. Run that suite on its own with
`node --test scripts/test-block-id-prompt-*.cjs`. The split preserves the
original 179 cases. The ledger-tools freshness tests are the per-area
`scripts/test-ledger-tools-freshness-placement.cjs`,
`scripts/test-ledger-tools-freshness-states.cjs`,
`scripts/test-ledger-tools-freshness-namespace.cjs`,
`scripts/test-ledger-tools-freshness-review-model.cjs`,
`scripts/test-ledger-tools-freshness-queue.cjs`, and
`scripts/test-ledger-tools-freshness-tracking.cjs` files and they share
`scripts/ledger-tools-harness.cjs`. Run that suite on its own with
`node --test scripts/test-ledger-tools-freshness-placement.cjs scripts/test-ledger-tools-freshness-states.cjs scripts/test-ledger-tools-freshness-namespace.cjs scripts/test-ledger-tools-freshness-review-model.cjs scripts/test-ledger-tools-freshness-queue.cjs scripts/test-ledger-tools-freshness-tracking.cjs`.
(A `freshness-*.cjs` glob would also match the pre-existing `footer`,
`mark`, `mark-surfaces`, `keeps`, and `decision-card` suites, so the six
files are listed explicitly.) The split preserves the original 57 cases.

The navigation dependencies-stage suite uses the six per-area files
`scripts/test-navigation-dependencies-stage-ranker-and-pool.cjs`,
`scripts/test-navigation-dependencies-stage-entry-and-view.cjs`,
`scripts/test-navigation-dependencies-stage-writes.cjs`,
`scripts/test-navigation-dependencies-stage-mirror-and-badge.cjs`,
`scripts/test-navigation-dependencies-stage-stale-guards.cjs`, and
`scripts/test-navigation-dependencies-stage-performance.cjs`. They share
`scripts/navigation-dependencies-stage-harness.cjs`. Run them together with:

```sh
node --test scripts/test-navigation-dependencies-stage-ranker-and-pool.cjs scripts/test-navigation-dependencies-stage-entry-and-view.cjs scripts/test-navigation-dependencies-stage-writes.cjs scripts/test-navigation-dependencies-stage-mirror-and-badge.cjs scripts/test-navigation-dependencies-stage-stale-guards.cjs scripts/test-navigation-dependencies-stage-performance.cjs
```

The split preserves the original 61 cases.

`npm test` also
guards the distinct Vim mapping ownership: Bob
Ledger Tools uses `\p` for Pomodoro increments, while Bob Navigation Hotkeys
uses `\s` for toggling the current tab pin.

It also runs focused Bob Vim Surround coverage for accepted and rejected
delimiter keys, `ys`/`cs`/`ds` edits, bracket padding, event handling, and
dot-repeat. The suite also includes `scripts/test-plugin-build.cjs` for the source
manifest, deterministic output, read-only checks, and parity comparator.

`npm test` and `npm run validate` first run `npm run build:check`, which verifies
every opted-in plugin's generated bundle without writing it. `npm run validate` then
runs `scripts/validate-manifests.mjs` for every plugin under `plugins/`:

- `manifest.json` parses as JSON and has the required fields (`id`, `name`, `version`, `minAppVersion`, `description`,
  `author`);
- the manifest `id` matches its folder name;
- `version` is a valid `x.y.z` semver;
- `main.js` parses under Node (a syntax check via `node --check`; the code is never executed).

It exits non-zero if any plugin fails, so it is safe to run in CI or a pre-commit hook.

### Depends-On line migration

R8 legacy dependency children (sole-link `![[…]]` bullets) and legacy-label
`🔗`/`DEPENDENCIES` rows fold into one canonical `⛓️ **DEPENDS ON:**` line
per dependent, with `[dependsOn::]`/`[id::]` projected for open dependents
and field-only lines adopted (`docs/task-dependencies.md` §§2-4 in bob-cli).

Preview or apply the migration with:

```bash
node scripts/migrate-dependency-lines.mjs --vault ~/bob
node scripts/migrate-dependency-lines.mjs --vault ~/bob --write
```

Dry-run is the default; `--write` performs a preflight and updates files.
`--write` is refused when ambiguous resolutions exist.

## Deploying to the vault

This repo is the source of truth; the vault's `.obsidian/plugins/<id>/` folders are deploy targets.
For plugins with `src/fragments.json`, run `npm run build` before syncing; `bob plugins sync`
copies the committed generated `main.js` and never assembles fragments. Plugins without a
source manifest remain hand-edited. Deploy with
[bob-cli](https://github.com/bbugyi200/bob-cli):

```bash
bob plugins list                 # show repo plugins + their vault install/sync state
bob plugins sync                 # copy all six plugins repo -> vault
bob plugins sync -p bob-project-tasks   # sync a single plugin
bob plugins sync --dry-run       # preview without writing
```

`bob plugins sync` copies only `manifest.json`, `main.js`, and `styles.css` (when present). It never touches a plugin's
`data.json` or other runtime/settings files, and it refuses to overwrite vault plugin files that are dirty in the vault's
git repo unless `--force` is passed.

> During the migration the vault keeps its own working copies of these folders; `bob plugins sync` is the deploy path.
> Making this repo the *sole* source of truth (e.g. `git rm --cached` of the folders from the vault) is a deliberate
> later decision.

## Scope

This is a **private personal monorepo** for developing the Bob plugins, not a distribution channel. The Obsidian
community-plugin registry and BRAT both map one plugin id to one repository with one release stream, so a multi-plugin
monorepo is a poor fit for direct official publishing. If a plugin (e.g. `bob-vim-surround` or `block-id-prompt`) is ever
published, it should be split into its own public repo following the standard Obsidian layout (root `manifest.json`,
`README.md`, `LICENSE`, and releases tagged to match the manifest version).

## License

[MIT](./LICENSE)
