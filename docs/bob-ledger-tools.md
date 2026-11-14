---
title: "Bob Ledger Tools"
description: "Inspect task lanes, Pomodoros, freshness, planning marks, and calendar Events."
---

Renders task, Pomodoro, freshness, and planning information from Bob notes.

Album owner cards, group navigation, and sync controls are described in
[Album cards](albums.md).

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Ledger Tools |
| ID | `bob-ledger-tools` |
| Version | 1.116.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Expand Bob daily-note snippets and ledger time ranges, navigate and adjust Pomodoro entries, render the live plan-budget bob-plan block, track task freshness including [unblocked::] TICKLERs, render [priority::] fields as signal-bar priority marks, render display-only blocked-reason marks on visible Live Preview and rendered source-note task rows (Reading view, embeds, hover previews, and Dataview TASK views) with accessible tooltips, a session toggle, and cache-aware refresh, plus CSS-only marks in Tasks query results; expose the classifier and listener-free miniature renderer through api.blockMarks v1 with gated held/waiting/stale checkbox paint, render created/scheduled/completion/cancelled dates and `[repeat:: …]` rules as compact date-family marks (including date and recurrence marks in full and short Tasks query results), render `#task` tags as a teal hash task-tag mark (hidden in Tasks query results) and `#task #ref` pairs as an open-book ref mark, `#task #prj` pairs as a teal target mark, and exact `#hide` tags as a grey eye-off mark, and render canonical `#task #gtd #pre` / `#task #gtd #post` runs as teal sunrise / flag identity marks with quiet small-caps stage labels for configured stages across Live Preview and reading view (Tasks rows keep native pills) and Tasks rows. Render Depends-On lines as live dependency chips plus generated BLOCKS rows with live dependents, last-blocker keys, stale-entry styling, and frees-N summaries. Blocked chips draw the target's miniature block mark and reason line. Open BLOCKS rows add ＋ / hover × through nav api.blocks when present. Index raw task LINKS rows plus inert text mentions through api.relationIndex v2, with unsaved editor overlays, typed linkedFrom rows, a pure scanMentions helper, and label suggestions. Render Task Links under today's open Pomodoros with In Progress half-ring marks and read-time unblocked hand-off glyphs. Add a quiet 🔑 frees N mark after Task Links whose linked task is the last blocker of N open tasks, with a tooltip naming the freed tasks and a session toggle. Fetch `bob stats` JSON with stale-while-revalidate caching and render the responsive Stats page `bob-stats` block with metric-family context, accessible daily drill-down, definition disclosures, tiles, window time bars, and table. Fetch `bob ref list` JSON with a bounded stale-while-revalidate cache, decode audio paths, and provide pure Reading Board lane, card, Snoozed group, ordering, and validated fence models. Render the read-only `bob-reading-board` code block, a Reading / Next / Ready / Snoozed kanban of the reading queue drawn entirely from `bob ref list` JSON (wake dates and waiting-on reasons from bob, never from vault text), with keyed background refresh errors, repaint-safe navigation, roving keyboard focus, click and modifier routing to Obsidian navigation, the optional Highlights PDF hand-off through nav `openReferencePdf`, and the Open Reading Board command. Derive quiet lowercase Pomodoro home chips that name each linked task's root parent in Live Preview and Reading view, with area-hue dots, a tooltip, and a toggle. Show a display-only 🍅 Today mark on open task lines linked under today's open Pomodoros in Live Preview and Reading view, with a session toggle and jumps to the Task Link. Task relation lines are excluded from the plan Task Link count. Render 🪢 LINKS and LINKED FROM rows as live relation chips from that index, with label pills, inverse phrases, stale and broken styling, closed-row collapse, and ＋ / hover × through nav api.relations v1 when present. The footer shows the Alt+P preview on review rows and on any open task with a priority, including a hint-only footer when nothing is due; staged PRE/POST rows show their uppercase stage and a stage-local count when multiple rows are due, also in landing toasts. Each review group is painted in its tier color. In source-note Live Preview and Reading view, the freshness mark tooltip adds a per-rung tally line (`🥀 WIP 2 · Next 1 · last <date> — <reason>`) from the task's Rotten Log; Tasks and Dataview query rows never show it. Share the task type catalog through api.themes v1 and render Pomodoro name type pills with stable hues in Live Preview, Reading view, the plan block, and the Stats Types panel, with a session toggle; render explicit [type:: NAME] task fields as a colored #TYPE in the #task slot (folding the field, no trailing pill) with inherited-type and type-mark session toggles, mark disagreeing Task Links in today's ledger, and keep type colors active in every window. Render the read-only Day strip above the bob-plan badges of canonical daily notes with a quiet typical-day line under each numeric fact, support the bob-day-stats fence, and provide the Toggle Day stats session command and the Cycle Day stats bars command. api.laneWalk v2 serves the Pending/Next/Ready-off-Today walk list behind the navigation ]w / [w and ]W / [W keys. Run quiet `bob gcal sync` after the current daily note is created and paint Event Tasks and context rows (a dashed time pill and mark for `#offclock` Event Tasks, with `#off-clock` and `#untracked` as aliases) in Live Preview and Reading view, with `se<X>` starts that follow a MEET's event run, write `[off:: Nm]` instead of `[t:: Nm]` for an off-clock lineup, and warn before running into an event. An Off-Clock Pomodoro's home chip is dashed and shows its recorded minutes. Render a small status ring in front of every rendered link whose target is a `#task` line, with a session toggle. Render the same Event time pill before ledger Task Links to one of the note's Event Tasks, with its own session toggle; calendar event painting must also be on. Add a report-driven Worked, Off-clock, and Total clock chooser to Stats with per-device preference and clock-specific fetch caching, and render Off-clock dashed outlines and Total worked/off-clock tails in tiles, focus charts, window lanes, and time breakdowns, plus a Day strip off-clock hint below WORKED that opens the day's Off-clock lens. Show a shared dashed timer-off off chip after ledger Task Links whose task resolves off-clock, tagged or inherited, in Live Preview and Reading view. Expose task-merge writes through api.taskMerge v1: the Links stage previews a configured merge label with `bob task merge --dry-run -f json` and commits with picks, desktop-only. The api.notebooks v1 namespace runs bob notebooks create for the navigation plugin. Render linked notebook headers with ancestry and child chips in both views, with a Notebook chips setting. On TICKLER rows the Alt+P preview renders as a tier-tinted answer chip with a keycap (red when it would cancel), and it outlasts the meter as the bar narrows. Show a display-only count beside the last planned Task Link in a sub-project, with offered lanes, folded-task counts, a caret jump, modifier-click navigation, and a session toggle. Render `bob-bank` month and queue cards with bounded report fetching, safe existing-heading navigation, per-row acknowledgment, and a report-driven Bank Badge. Decorate bank month rows and day headings in both views. Render owner album cards with live counts, lead-group peeks and navigation, last-added ages, and shared sync/retry controls. Render the owner projects catalog card with hued state markers, live count and reason chips, a Closed peek, nested children, and shared sync/retry controls. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Bank: acknowledge this day | `bank-ack-day` | — |
| Bank: open today | `bank-open-today` | — |
| Bank: set category | `bank-set-category` | — |
| Check Google Keep now | `check-google-keep-now` | — |
| Cycle Day stats bars | `cycle-day-stats-bars` | — |
| Cycle period stats charts | `cycle-period-stats-charts` | — |
| Edit album schema | `edit-album-schema` | — |
| Expand Bob snippet | `expand-ledger-time-range-snippet` | — |
| Go to today's Task Link | `go-to-today-task-link` | — |
| Jump to current Pomodoro line | `jump-to-current-pomodoro` | Ctrl+9 |
| Open Reading Board | `open-reading-board` | — |
| Open Stats | `open-stats` | — |
| Open this week's note | `open-this-weeks-note` | — |
| Open today's daily note | `open-today-daily-note` | — |
| Toggle Day stats | `toggle-day-stats` | — |
| Toggle Gmail sync on daily-note creation | `toggle-gmail-sync-on-create` | — |
| Toggle Google Calendar sync on daily-note creation | `toggle-gcal-sync-on-create` | — |
| Toggle Keep inbox indicator | `toggle-keep-inbox-indicator` | — |
| Toggle Pomodoro home chips | `toggle-pomodoro-home-chips` | — |
| Toggle Task Link In Progress marks | `toggle-progress-marks` | — |
| Toggle Task Link event times | `toggle-event-link-times` | — |
| Toggle Task Link frees marks | `toggle-frees-marks` | — |
| Toggle Task Link keep-moving marks | `toggle-keep-moving-marks` | — |
| Toggle Task Link off-clock chips | `toggle-off-clock-link-chips` | — |
| Toggle Today marks | `toggle-today-marks` | — |
| Toggle bank marks | `toggle-bank-marks` | — |
| Toggle blocked-reason marks | `toggle-block-marks` | — |
| Toggle calendar event painting | `toggle-calendar-event-painting` | — |
| Toggle dependency chips | `toggle-dependency-chips` | — |
| Toggle inherited task types | `toggle-inherited-task-types` | — |
| Toggle mail link marks | `toggle-mail-link-marks` | — |
| Toggle root marks | `toggle-root-marks` | — |
| Toggle task date marks | `toggle-date-marks` | — |
| Toggle task freshness marks | `toggle-freshness-marks` | — |
| Toggle task link marks | `toggle-task-link-marks` | — |
| Toggle task priority marks | `toggle-priority-marks` | — |
| Toggle task tag marks | `toggle-task-tag-marks` | — |
| Toggle task type colors | `toggle-pomodoro-theme-colors` | — |
| Toggle task type marks | `toggle-task-theme-marks` | — |
| Toggle unblocked hand-off glyph | `toggle-unblocked-glyph` | — |
<!-- END GENERATED: commands -->

## Bank cards and the bank badge

`bob-bank` fences (`view: queue` on `bank.md`, `view: month` on `bank/YYYY-MM.md`): frontmatter matches the filename; only existing headings navigate; empty months teach. Queue rows run oldest-first; day buttons carry the drawn IDs. **Bank: open today** ensures today at the next row; **Bank: acknowledge this day** acks that day's snapshot; no default hotkeys. ID-less rows tick once verified; bulk ack reports leftovers, never `ack -D`. Month-note Enter continues rows, clears empty stubs; `[cat:: ` inserts ordered keys. The read-only bank badge follows the Day strip, hides when the period has no counted money or waiting rows, uses quiet neutral, green-surplus, and amber-waiting tones, and opens the rows behind that period. `stats.bank_badge` (default on) gates the badge; `stats.bank_chip` remains its legacy alias. `toggle-bank-marks` and `stats.bank_marks` (default on) gate decorations; `$` never renders as math; only `bank.md` hides its `bank` property.

On a waiting bank row, Task Status Cycler hands Ctrl+Enter to `api.bank` v2
`claimRowClose`, which opens the Category card. Bob's suggestion is
highlighted; Enter or a second Ctrl+Enter accepts it, a hotkey picks another
category, Space files without one, and Escape cancels. A filing ticks and
categorizes in one undo, advances, and records a `recordJump` so Ctrl+O
returns to the payee. **Bank: set category** corrects any row without
changing checkbox or cursor. Hidden categories stay on rows but out of the
card and `[cat:: ` suggestions. The waiting pill lands at the payee start.
Older APIs keep the `[ ]`↔`[x]` flip.

## Snippets and the plan block

The **Expand Bob snippet** command (or Tab) expands editor snippets. Date
calculation uses local calendar days: `d[-]<N>` (for example `d0`) expands to
the bare ISO date, while `D[-]<N>` (for example `D0`) expands to the emphasized
local date, an em dash, and a trailing space, with the cursor placed after that
space. One isolated `-` immediately before the cursor expands exactly that
hyphen to an em dash plus a trailing space; existing suffix whitespace is left
alone, and `--`, `---`, and longer hyphen runs are untouched so Markdown
thematic breaks, YAML frontmatter delimiters, and other multi-hyphen text keep
Obsidian's normal Tab behavior.

### Calendar-aware starts

`se<X>` + Tab inside a Pomodoro `()` mirrors `bob capture`'s `=<X>` for calendar
sessions, pinned by bob-cli's shared `meet_event_run` vectors.

On a session named `MEET`, an empty `se` follows the session's **event run**:
the earliest open, not-yet-ended Event Task linked as a plain same-note
`[[#^id]]` child, plus every touching or overlapping follower on its clock.
The occupied span adds any `[buffer::]` lead-in and lead-out for candidates,
sort, clustering, the written range, the early start, and the far-run warning.
A `+15` after Standup 1000-1030 bridges to a 1045 1:1, and `se` at 11:25 for
lunch with `-30 +15` writes `(**1130-1315**)`. A run never bridges
clocks. A late join starts where the latest closed session ended. A
run starting more than 25 minutes away still writes its future start with
a Notice (`pomodoro_event_run_later`) naming the `se5` escape hatch,
with the buffer label on a buffered first event (`Lunch (1200-1300 −30m)`).
In `<X>`, `+` starts later like `-` starts earlier (bare sign: one unit); `se+0` and two signs never expand, counted spans stay explicit, and fit drafts keep the sign.

#### Which clock a session is on

A timed Pomodoro row carries exactly one clock key. `[t:: Nm]` is on the clock;
`[off:: Nm]` marks an *Off-Clock Pomodoro*: a session Bob records but keeps off
the work clock (lunch, the gym, school pickup). A bare timed span, written by
older tools, reads as off-clock too and is counted by its span. Pinned by
bob-cli's shared `pomodoro_clock` and `meet_event_run` vectors, `se<X>` stamps
the key by the same counted-links rule `bob capture` uses:

- A session is **off the clock** iff it has a Task Link and every link resolves
  off-clock. First match: `#on`; `#off` or an alias (`#offclock`, `#off-clock`,
  `#untracked`); then the nearest area/project root-walk policy. A non-empty
  `offclock_types` list wins over same-note `offclock:` and matches the task's
  effective type; invalid lists stay worked. Without a list,
  `offclock: true|false` retains its inheritance. Effective type is the task
  field, reading rule, nearest note default, then `plan.default_type`; types
  need not be cataloged. No matching type means on-clock. Clock tags are
  standalone, case-insensitive tokens; writers never add inherited `#off`.
  `se<X>` falls back to tags when metadata is unavailable. Other plugins read
  the same decision through
  `api.pomodoroClock` v1 (`taskEffectiveOffClock(path, line)` →
  `{ offClock, source, notePath }`).
- An unlinked session, an unresolved link, or a single on-clock link keeps the
  **whole session worked**; a mixed session is never split.
- Counted links are the direct-child Task Link bullets (plain, struck,
  🍅-marked, or embedded). Deferred `[[…]]#` bodies, notes, and Depends-On
  lines do not count. Same-note links read the open note (Event Tasks first);
  other-note links read the linked task's line through the same source-text
  cache the home chips use, so a link whose note has not been read yet counts as
  unresolved and the session stays worked.
- A MEET with a non-empty event run uses the **run's** clock (future lineup
  events are queue, not participation); a MEET with no run, and every other
  session, uses its lineup. Only the key changes.

When the lineup holds an off-clock link but the session stays worked, a Notice
mirrors bob's `pomodoro_clock_mixed` warning: `◌ LUNCH stays on the clock: it
also links Fix the parser`, or `◌ LUNCH stays on the clock: [[bob#^gone]] does
not resolve`. Swapping sessions, `~K` drops, and link starts are capture-only
gestures.

Starting, extending, or shifting a non-MEET session raises a Notice when its new
span newly overlaps the occupied span of an open Event Task that is not in its
own lineup (`pomodoro_runs_past_event`): `⚠ BOB 1150-1215 runs 15m into Standup
(1200-1230) · se2 ends at 1200`. With a buffer the overlap names the wing when
it sits wholly inside one (`Lunch's −30m buffer (1200-1300)`) and otherwise
carries the event's buffer label; the fit draft ends at the buffered start. A
session starting mid-meeting stays quiet. It covers `se<X>` + Tab, `N\p`,
`N\o`, and `N\O`; `N\P` and closes never warn, and the write is never blocked.
`N\p` and `N\P` keep the row's key and update its recorded minutes (`[t::]`
stays `[t::]`, `[off::]` stays `[off::]`, bare spans stamp `[off::]`, and a
row holding both keys resolves to `[t::]`); `N\o` and `N\O` move the span and
keep every key byte-for-byte. `Ctrl+Enter` re-stamps the closed row from the
links it keeps (see Task Status Cycler). Timed close classifies Event Task
links by the meeting span, so a MEET closed when lunch ends still completes
lunch even though its `+15` buffer runs on.

The plugin also renders a live `bob-plan` block: a `TODAY 7/10` chip for the
on-clock Task Link budget (off-clock links are uncapped; its tooltip lists each type with its link count, plus ` · N off-clock uncapped` when off-clock links were left out),
`PENDING n/10`, `NEXT n/15`, and `READY n/100` chips that open the matching
dashboard sections, the `★ GOALS · DECKS · BOB` type line with the highlight
starred, a hue-ringed roots line of today's root parents (`○ bob 5  ○ sase 2`)
directly after the type line, and one muted line per lint. Each real root is a
quiet link that opens its note; the faint count is how many open Today tasks
sit under that root, and `unfiled` is a dashed non-interactive bucket. The
roots line is a view, never a budget: it is omitted when Tasks is unavailable
or Today is empty. READY is the shared live current backlog
(Today excluded) and never changes the PLAN status; READY over its cap adds a
`ready_cap_exceeded` lint line. PENDING and NEXT show the live dashboard section
counts (Today excluded; `–` when Tasks or the current-day Today cache is
unready) and turn red only for a strict section excess, while whole-lane
pressure stays in the tooltip. `next_cap_exceeded` / `pending_cap_exceeded`
lint lines appear only when the matching badge is red and quote its section
count. Older daily notes follow
today's live lanes while keeping their own TODAY link budget.

Today is read from the ledger at render time — the open tasks with a dedicated
Task Link under today's open Pomodoros — and kept in a synchronous cache that
rebuilds on layout ready, on daily-note change, create, delete, and rename, and
at local-midnight rollover. When the cached Today key set changes, open Tasks
queries reload their results through the Tasks plugin's
`reload-open-search-results` event. Caps come from the `plan:` block in the shared bob
config file (`max_next`, `max_pending`, `max_ready`, `max_ready_per_note`; a
legacy `max_now` loads without error), with built-in defaults when the file,
the block, or a value is missing or invalid. The block re-renders live when the
daily note or the Tasks cache changes and shows `–` placeholders, never an
error, when there is no daily note, no Pomodoros section, or no Tasks plugin.

One walker footer follows the bracket walk (`s`/`w`/`n`), routed through
nav `api.walkMode` v1 and the walk-mode doorbell. The `s` panel is the review
footer, gated on `s`: nonempty walk groups (PRE → NEW → PROJECTS →
PENDING → NEXT → RECURRING → TICKLER → ROTTEN → POST; TICKS splits ROTTEN)
minus the active tier, tier-colored with a commitment/ROTTEN hairline,
shedding groups, detail, hint, meter. The button jumps like `]s`; TICK rows
show a tinted `Alt+P` chip (red when cancel). Empty shows
`⟳ Review clear · ✓ N today`, keeping the Alt+P preview on prioritized rows;
hints read `]] next` (`]s next` in the legacy no-nav footer). The `w` lane
footer shows `api.laneWalk` v2 counts (`Lanes N`, validated-row position,
`Lanes clear` / `REVIEW n` / `No Pending…` states, `n/cap` only over cap);
`Lanes` acts like `]]`, counts never filter. The `n` links compass previews
via `walkMode.links()` v2 with `[n` / `]n` arms. Hidden when unset, indexing,
loading, or mobile. Off-`s` review commitments arrive via `setAttention` (v3)
as a quiet dot on the selector's `s`.

## Marks and rendered blocks

Marks are display-only: nothing writes them, and each has a session toggle that
restores the unmarked rendering:

- The freshness mark renders each canonical `[fresh:: YYYY-MM-DD]` stamp as a
  compact mark (`✓ today`, a draining lease ring with its age, `⟳ Nd` when due)
  in Live Preview and rendered views. Resolution is exact or neutral: an exact
  memo match or unanimous consensus drives the tone, otherwise the mark shows
  only the neutral lease and never a guessed due. In source-note Live Preview
  and Reading view, the freshness mark tooltip adds a per-rung tally line
  (`🥀 WIP 2 · Next 1 · last <date> — <reason>`) from the task's Rotten Log;
  Tasks and Dataview query rows never show it.
- The blocked-reason mark paints each canonical Blocked `[?]` `#task`
  checkbox with the proven reason (`&`, project chevron, reply plane,
  P1–P4 digit, recurrence loop, hand-date `?`, or dashed stale `?`) in
  Live Preview,
  Reading view, embeds, hover previews, and Dataview `TASK` rows. Nested
  children keep their own checkbox. Source mapping uses the section text
  and `data-line`; when that is unavailable a conservative own-text
  fallback reconstructs only the list checkbox prefix and stays unmarked
  rather than guessing from transformed date/priority pills. Retained
  canonical text is reused only while the row's origin, status, and
  `data-line` still match and the current fallback is unavailable
  because a later processor transformed the fields; a recycled fallback
  row with new raw text is reclassified. Query rows require a proven
  origin path and never treat the query-note stem as the project. Tasks
  query rows, and `code`/`pre` hosts, stay excluded even when they are
  the processor root. Dataview TASK rows that prove an origin recover
  canonical text from the Tasks cache when inline-field pills have
  replaced the raw fields. Tooltip attributes restore only while they still
  match the last applied values, then the ownership record is released.
  Live Preview also attaches those attributes through a CodeMirror
  `requestMeasure` write-pass after rebuild. While the marks are on, a
  digit checkbox (`p1`–`p4`) folds that row's priority bars to zero
  width, and `prj` / `awaiting` checkboxes fold their exact
  `#prj_is_blocked` / `#awaiting_reply` pill; the cursor and a click
  still reveal the raw field, and either session toggle restores it.
- The priority mark renders each canonical `[priority:: …]` field as one
  signal-bar glyph (4/3/2/1 filled bars for P1–P4, a solid `!` square for
  off-ladder `highest`) in Live Preview and rendered views. The glyph follows
  the stored Tasks value, never the ladder position; an unknown ladder omits
  P-labels instead of guessing. Digit block-mark rows fold those bars
  while blocked-reason marks are also on.
- The date mark renders each canonical `created`/`scheduled`/`completion`/
  `cancelled` field as one monochrome glyph plus a calendar label (`today`,
  `tomorrow`, `Fri`, `Oct 22`) in Live Preview and rendered views, including
  Tasks query results, and each canonical `[repeat:: …]` rule as a quiet loop
  recurrence mark (`daily`, `Mondays`, `monthly · 1st`) in Live Preview and
  rendered views. Malformed fields get a dashed repair flag, and labels
  roll over at local midnight without a reload.
- The task tag mark renders each exact `#task` tag on a task line as one small
  teal identity hash glyph; Tasks query results hide the tag entirely because
  every row is already a task. Adjacent `#task #ref` pairs render as one teal
  open-book mark. Adjacent `#task #prj` pairs render as one teal target mark,
  and an exact `#hide` tag on a task line renders as a quiet grey eye-off.
- The task type mark renders each explicit `[type:: NAME]` field (and legacy
  `[theme:: NAME]` field) on a task line as one readable `#TYPE` mark in Live
  Preview, Reading view, and Tasks/Dataview task rows. The pill text is
  the canonical component spelling with normal text color and the shared
  16% light / 24% dark hue tint; there is no glyph and no `theme` label.
  Unknown names stay neutral with a dotted underline, and duplicate or
  invalid fields show the dashed repair treatment instead of a
  trustworthy pill. No field means no pill, even when a note or reading
  default exists; a stored field on a closed task still shows its
  history. Native Dataview `type | NAME` chips are replaced only when they
  represent an explicit task-line field; a page-default `task.theme` is
  left alone. Surrounding links, emphasis, tags, and nested lists stay in
  place. Touching the field in Live Preview reveals the source; clicking
  the pill puts the caret in the field. Hover or focus resolves the
  inherited reason lazily from the originating note
  (`Task type FIX · sase_blog suggests WRITE · Ctrl+Shift+P t to change`;
  reading and no-default rows use their shared phrases). Source
  mode, fenced code, inline code, and prose stay raw. The **Toggle task
  type marks** session command (default on) restores raw fields without
  writing them, independent of **Toggle Pomodoro theme colors** (default
  on), which keeps readable pills when colors are off.
- The root mark renders each explicit `[root:: NOTE]` / `(root:: NOTE)` task
  field as a hue-dot place mark in Live Preview, Reading view, and
  Tasks/Dataview rows. A root that is also linked in the task text collapses
  to its dot; child notes that roll up show a dotted label, and invalid,
  missing, or duplicate fields keep a hollow repair mark. Clicking reveals
  the source field, Mod-click opens the named note, and **Toggle root marks**
  (default on) restores the raw field without writing it.
- The task link mark renders a small status ring in front of every rendered
  link whose target is a `#task` line (Ready, Next, In Progress, Blocked,
  Done, Cancelled) in Live Preview and rendered views. Links to notes,
  headings, and non-task blocks stay unchanged. The **Toggle task link
  marks** session command (default on) restores plain links without writing
  the vault. Links inside fenced code, inline code, `%%` comments, and
  managed Depends-On, BLOCKS, LINKS, LINKED FROM, and Sub-projects rows stay
  plain, and a ring's swap animation is off under reduced motion. Contract:
  [Task link marks](https://bobs-org.github.io/task-link-marks/).
- The ledger echoes the In Progress half-ring and unblocked `🔓` glyphs with
  a compact `🔑 N` after today's eligible Task Links when closing the linked
  task would free N open tasks; its tooltip lists them and their waiting
  dependents. Contract: [Frees marks](https://bobs-org.github.io/frees-marks/).
- A quiet `⏭ N` after today's last planned Task Link in a sub-project counts
  the tasks its close would offer
  ([Keep-moving marks](https://bobs-org.github.io/keep-moving-marks/)).
- The off-clock link chip renders the shared dashed `timer-off` `off` chip
  after ledger Task Links whose task resolves off-clock, tagged or inherited,
  in Live Preview and Reading view. Closed ledger entries and past daily notes
  keep the task's current clock; prose links keep their status ring. Contract: [Off-clock link chips](https://bobs-org.github.io/off-clock-link-chips/).
- A Task Link that points at one of the same daily note's Event Tasks wears
  that event's time pill beside the link in Live Preview and Reading view:
  the meeting span, past/running/future state, MEET hue, off-clock dash, and
  buffer wings, display-only. Contract:
  [Event link times](https://bobs-org.github.io/event-link-times/).

The plugin renders live TODAY/PENDING/NEXT/READY badges, CROWDED, the `bob-ready-notes` ranked-bar block, and `## Tasks` heading chips. Pomodoro home chips name linked tasks' root parents with area hues and tooltips, and show recorded minutes for off-clock sessions. Type pills use shared catalog hues. The display-only 🍅 Today mark identifies open tasks linked under today's Pomodoros and jumps to the Task Link. Marks have session toggles; unknown type names stay neutral while typed. Behavior and hues: [Task types](https://bobs-org.github.io/task-types/).

The **Day strip** is a read-only daily Stats receipt rendered above the
`bob-plan` badges of canonical daily notes, in Live Preview and Reading view.
It shows that note's own day as a row of stacked stats (a small uppercase
label over a large value over a quiet typical-day line on each numeric
fact), followed by two lanes on the same working
minutes: the root-parent legend with `so far · HH:MM` over the
root-parent bar, then a type legend over the full-width type bar that
separates the strip from the badges — and paints from bob's Stats
report; it never writes the vault. A quiet
switch at the right of the top lane cycles both bars → root parents only
→ types only, for every daily note at once; the choice is remembered on
this device. Review
closed shows a green check, a red ✕, or the yellow In Progress half-ring
while today's review is still open. The roots bar groups working time
by root parent (falling back to areas with an honest "Time by area" label when
bob predates `root_parent`). Grey roots stay gray, after coloured roots. The type bar groups the same minutes by task type and wears each type's hue;
clicking it opens Stats on the Types view. Each legend fits as many names as its line holds.
When the day's Worked point carries positive off-clock time, a quiet `◌ +<display> off-clock` hint renders under WORKED and opens Stats on that day with the Off-clock lens.
Daily notes without a `bob-plan` block show no strip. To place one explicitly,
add a `bob-day-stats` code fence in any note, optionally with `day: YYYY-MM-DD`.
A fence inside a daily note renders its own strip.

The **period stats strip** (`bob-stats-strip`) paints Roots above Types for every period note. ●/■ and `Cycle period stats charts` cycle Both → Roots → Types per device, not Day strips. Arrows move, Enter opens the note, Alt+Enter opens Stats (days pin the day). Cache-driven read-only; Retry on failure. See bob-cli `docs/stats.md`.

`DEPENDS ON` lines render as live dependency chips plus generated `BLOCKS` rows
with live dependents, last-blocker 🔑 badges, stale-entry styling, and `frees
N` summaries. Blocked chips draw the target's miniature block mark and reason
line. Toggling blocked-reason marks off restores the plain `?` immediately
through CSS; Reading-view chip tooltips keep the reason text until the view
re-renders. Chips render in Live Preview and Reading view on owned
Depends-On rows only, with a session toggle; `waiting on N` counts open
prerequisites only. Open BLOCKS rows add ＋ to open the reverse Blocks stage
and hover × to remove a dependent. The Stats `bob-stats` block renders a report-driven Worked · Off-clock · Total clock control above the window bars (one checked native radio per `report.clock.options`, arrows wrap and select, `Space` activates, `c` cycles from the dash surface, remembered per device; clockless or no-adoption reports hide the control and stay on Worked without erasing the saved preference), then two window time bars above the tiles
that split the selected window's minutes by root parent and by
task type, then the responsive Root parents panel with Root parents
and Types views, area groups with sub-project disclosure, bucket fix-it
copy, and session drill-down, plus task counts; the Types view wears
each type's hue on its bars, with exempt and grey-area types and `other` in gray. Off-clock time renders as dashed outlines in the item's hue across tiles, focus charts, window lanes, and time breakdowns; under Total, a solid worked span ends in a dashed off-clock tail and off-clock sessions get a dashed edge. Total sums session minutes, so overlapping sessions count twice; it is neither occupied nor free time. Values: [Bob Stats page](https://bobs-org.github.io/stats/). The `★` type line of
the plan block renders the same pills. The read-only `bob-reading-board` block
renders a Reading / Next / Ready / Snoozed kanban of the reading queue drawn
entirely from `bob ref list` JSON — wake dates and waiting-on reasons come from
`bob`, never from vault text — with the Highlights PDF hand-off and the Open
Reading Board command.

`🪢 **LINKS:**` and `🪢 **LINKED FROM:**` rows are relation metadata. Their
wikilinks are excluded from the live plan Task Link count. Both rows render as
live relation chips in Live Preview and Reading view from the relation index,
never the stored mirror: label pills with arrows, inverse phrases on
LINKED FROM, dashed stale and broken chips, `✓×N` collapse for three or more
closed chips, and ＋ / hover × through nav `api.relations` v1 when present.
The shared `toggle-dependency-chips` command covers both rows. See
[Task relations](task-relations.md).

## Freshness, review, and readiness

The plugin tracks freshness from `[fresh:: YYYY-MM-DD]` / `[refresh:: N]` /
`[keeps:: N]` stamps: PRE → NEW → PROJECTS → PENDING → NEXT → RECURRING →
TICKLER → ROTTEN → POST, reference freshness, daily lane review, checklist
tiers, project reminders, freshness-gated READY, NEW/ROTTEN review models and
chips, plus the queue, counts, lints, and status bar. `freshness.decay` carries
per-rung allowances (`pending_keeps` for WIP, `next_keeps` for Next,
`ready_keeps` for Ready and every P-level, each 0–999 or `false`, resolved
against the `keeps` fallback), and `decide` is true on due PENDING and NEXT
rows at their rung limit as well as due Ready rows, so those rows join the
`counts().decide` "need a decision" total. Folded keep pips always render in the
freshness mark; the leaf plus `Alt+F to decide` appears only when the
navigation decay-card capability is present and decay is on. Due lane rows show
the leaf only with navigation's rung-aware card (capability 3+); with an older
or missing card they keep counting pips with counting-only wording. READY counts gate
on the read-time bucket so NEW and ROTTEN review stay out of READY.

PRE/POST sort by stage. Namespace v14 exposes `checklistStages`, stage fields,
and normalized lists through `config()`.
Staged POST says `Ctrl+Enter done · ]s skip`; unstaged says `Ctrl+Enter done · closes the review`.

Other plugins never place `fresh` stamps themselves: navigation, the cycler,
and Block ID Prompt call the shared stamper instead. `keepLine` is the sole
increment helper (a counted keep stamps and increments once, saturating at 999,
with a valid prior `fresh` before today required; uncounted keeps preserve),
and every generic stamper clears `keeps`.

The `noteReady` surface backs the read-only per-note Ready cap: each
area/project note's Ready lane against `plan.max_ready_per_note` (default 5)
with per-note `ready_cap` overrides and crowded/full/room states.

## Keep inbox indicator

The desktop status bar shows a `bob-keep-inbox` item beside the review
footer: a gold bulb pill counting the Google Keep notes a default
`bob gkeep pull` would take, a chevron connector, and an inbox-tray count
of open top-level tasks in the inbox tree: `inbox.md` and every area note
below it at any depth via `parent`, such as `mac_inbox.md` and
`gkeep_inbox.md`. Project and untyped notes filed under it do not count.
Each segment appears only while its count is above zero, and the item
disappears when both are zero. The bulb is gold when fresh and dashed when
last-known. The Keep pill also hides when its count is unknown or Keep is
unverified. After sign-in expires, a dashed `lightbulb-off` pill still
shows. The whole item hides when Keep is not configured or before the
first status read.

The Keep count comes from `bob gkeep status`; the inbox-tree count is
recomputed from the Tasks plugin cache on every
`obsidian-tasks-plugin:cache-update`. The inbox tray stays hidden until
Tasks is ready. The plugin never reads the vault file for the Keep count,
never reads a credential, and never decides backoff. It runs
`bob gkeep status -r` after layout settles, on focus/visibility/online
events, and when bob's `next_check_at` arrives, but only while Obsidian
is visible, focused, and has seen keyboard, pointer, or wheel input in the
last ten minutes. Unattended due checks wait for the next input; without
attention, focus only re-reads Bob's cached status, at most every ten
seconds, or every ten minutes while Keep is not configured. Bob still
applies its own freshness, budget, and backoff gates.

Click the bulb when its count is fresh to open Command Mode at a dry-run
`gkeep pull` preview; click a stale bulb to check now. After sign-in
expires, the bulb opens the `gkeep doctor` report. **Check Google Keep
now** still works from the palette while the item is hidden, and says
when there is nothing to pull. Right-click either visible count for
Check Google Keep now, Preview Keep pull, Open `gkeep_inbox.md`, Keep
setup check, or Hide until restart. The palette also offers **Check
Google Keep now** and **Toggle Keep inbox indicator**. Preview and setup
actions need Command Mode; without its preview API the bulb explains the
matching `bob` command to run. User-triggered checks pulse the bulb,
while background checks stay still. Bob caps unattended-safe checks with
its own 30-minute default interval and a 48-check daily budget (about 16
checks in eight attended hours); setting `gkeep.check_interval: off`
disables automatic Keep checks without affecting manual checks.

Hovering the inbox lists each note's open count. Clicking the inbox opens
the note with the most open tasks (then the earliest path) at its first
open top-level task; a missing note shows a Notice and never creates the
file. The context menu's **Open `gkeep_inbox.md`** still opens the Keep
pull target. Turning off the session toggle stops automatic and manual
`-r` requests until the next Obsidian restart.

## Session toggles

Every `Toggle …` command in the generated table above is a session-only toggle
(default on) that restores the unmarked rendering while the session lasts. The
jump and open commands (`Jump to current Pomodoro line` on `Ctrl+9`, `Go to
today's Task Link`, `Open today's daily note`, `Open Stats`, `Open Reading
Board`) are the only commands in this plugin with lasting effects; `Ctrl+9` is
its only registered default hotkey.

`Toggle Day stats` hides or restores the automatic Day strip above the
`bob-plan` badges for the current session. It does not remove an explicit
`bob-day-stats` fence.

`Toggle Task Link frees marks` and `Toggle Task Link keep-moving marks` hide
or restore today's `🔑 N` and `⏭ N` ledger echoes without writing the vault.

`Toggle Task Link off-clock chips` hides or restores the dashed `off` chip after
ledger Task Links whose task resolves off-clock. It is independent of calendar
event painting and marks closed rows and past daily notes too.

`Toggle Task Link event times` hides or restores the Event time pill beside
ledger Task Links that point at one of the note's Event Tasks, in Live
Preview and Reading view. The pill reuses the calendar Event painting look,
so calendar event painting must also be on; no vault text is written.

`Toggle blocked-reason marks` controls the display-only marks on canonical
Blocked `#task` rows. Live Preview reads the editor's current text, keeps
checkboxes native, and attaches the reason tooltip when a checkbox is hovered.
Reading view, embeds, hover previews, and Dataview `TASK` rows reuse the same
classifier in place: each row's own checkbox gets the reason tooltip, nested
children stay independent, and turning the toggle off restores prior
`aria-label` / `data-tooltip-position` values. Tasks cache updates,
priority-ladder changes, local midnight, and returning to the app refresh the
visible marks. The command refreshes editors and rendered hosts in both
directions; turning it off restores the ordinary `?` box.

`Cycle Day stats bars` cycles the Day strip bars switch (both bars → root
parents only → types only) for every Day strip on this device, with a Notice
naming the new view. Period strips keep their own chart view. It works with no Day strip on screen.

## Calendar Events

For daily-note auto-sync, event painting, and clock behavior, see
[Calendar Events](calendar-events.md). This heading remains as a stable link
target for existing Bob documentation.

## Period Notes

The hook stays inert until the vault adopts period notes (an `all_time.md`
next to `org.md`); without it, nothing spawns and **Open this week's note**
shows a Notice naming `bob periods migrate`. Once adopted, Ledger Tools runs
`bob periods ensure -q -f json` (15 s timeout) on today's daily-note creation,
once per local day after layout loads, and on the first 5-second tick after
local midnight, so the week → quarter → year → all_time tree exists before
anything reads it. Bob remains the only writer.

An older bob without `periods` logs one `console.warn` per session. A
`lock_busy` run retries once after 60 seconds. Any other failure shows at most
one Notice per local day: `Period notes could not be created — <message>`.

**Open this week's note** opens `GGGG/GGGG-Www.md` for the current week,
running ensure first when the note is missing. Without adoption it shows the
`bob periods migrate` Notice instead of opening anything.

A clicked dangling period link (a Templater frontmatter stub) is filled by
`bob periods ensure -d <first day>`; `api.periodNotes` v1 lets
bob-navigation-hotkeys do the same.

Agent instruction callouts (`> [!agent]- ...`) render as one quiet folded
line: no tinted background, a small muted title, and the expanded body in the
normal text colour.

## Command-mode run refresh

When Bob Command Mode is enabled, this plugin listens for its
`bob-command-mode:run-finished` workspace event and refreshes the caches a
finished run invalidates: the type catalog, relation labels and the relation
index, stats data, the Reading Board, and the plan, freshness, and Today
views. Tags this plugin does not own are ignored.

## Task type identity

Explicit `[type:: NAME]` (and legacy `[theme:: NAME]`) fields render as a
colored `#TYPE` in the `#task` slot. The field is folded; there is no
trailing pill on the task line. Inherited types stay a plain hash whose
tooltip names the type, until **Toggle inherited task types** is turned
on. A live Task Link that disagrees with its task's effective type (explicit
or inherited) gets a dashed `#TYPE` prefix in today's ledger. Day strip and Stats copy say **Time by
type** / **Types**; JSON still uses the `theme` dimension.
Exempt types such as PLAN, and grey-area types, have no hue, so their `#TYPE` uses the muted ink
(`--bob-type-ink-muted`) instead of a palette color.

## Notebooks

Catalogs use the host's ancestry hue, including mute. **add summary** opens
the notebook and focuses Properties `summary`. **↻ sync** rewrites missing,
stale, or damaged catalogs. Chrome (sync, Retry, status, anchor) paints only
in report-listed hosts (or pre-report notes with a real callout); non-hosts
get none, never at position 0. **Retry** needs a failed refresh or no report;
lag alone stays silent. Live data needs desktop Obsidian.

## Projects catalog card

An area or project host's `[!projects]` callout is a live, display-only view of
Bob's project report. State markers and task, Today, empty, and blocked-reason
chips come from `bob projects list -f json`; the card never derives membership
or lifecycle state and never edits catalog text. **Closed** starts folded with
a two-row peek and toggles with Space or Enter. A project's `▸ N` button
reveals only its direct children. Folds stay local to each pane.

Use **↻ sync** to refresh a missing or stale catalog, **Retry** after a report
failure, and **＋ project** to copy the `@<host>^` capture starter. Sync writes
through Bob; the starter only goes to the clipboard and does not submit
capture. A failed refresh keeps the last good rows visible. At narrow widths,
chips wrap below the criterion and the count shortens while keeping its full
accessible label.

## Gmail open hint

`⌘↵ Gmail` (`M-↵` elsewhere) marks the line's Gmail target: a `[[mail/…]]`
link, Gmail Task child, or one link-only Task Link hop. Live Preview requires
the mail-link-marks toggle and bob-mail's live open API. Embeds, struck links,
and unresolved hops stay quiet.

## Gmail archive receipts

Closed Gmail tasks may show `⤓ archived <day>` chips when linked mail notes
have active Bob receipts. The cached offline snapshot keeps row rendering
local; **Toggle mail link marks** hides these chips with reply badges. Daily
Gmail sync can report Bob's `recent_archive` count. The exact identity,
placement, cache, and notice contracts live in [bob-cli's mail link marks
guide](../../mail-link-marks.md).

## Settings

The **Notebook chips** setting (default on) hides live chips while keeping
styling, links, and sync. The plugin also reads the shared bob config file.

## Related

- [Plan](https://bobs-org.github.io/plan/)
- [Freshness](https://bobs-org.github.io/freshness/)
- [Task dependencies](https://bobs-org.github.io/task-dependencies/)
- [Task tag marks](https://bobs-org.github.io/task-tag-marks/)
- [Date marks](https://bobs-org.github.io/date-marks/)
- [Today marks](https://bobs-org.github.io/today-marks/)
- [Dashboard](https://bobs-org.github.io/dashboard/)
- [Stats](https://bobs-org.github.io/stats/)
- [Pomodoro homes](https://bobs-org.github.io/pomodoro-homes/)
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md)
- [Cross-plugin APIs](https://bobs-org.github.io/develop/plugins/plugin-apis/)
