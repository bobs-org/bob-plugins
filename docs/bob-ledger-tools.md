---
title: "Bob Ledger Tools"
description: "Inspect task lanes, Pomodoros, freshness, planning marks, and calendar Events."
---

Bob Ledger Tools renders task, Pomodoro, freshness, and planning information from Bob notes.

<!-- BEGIN GENERATED: facts -->
## Plugin facts

| Fact | Value |
| --- | --- |
| Name | Bob Ledger Tools |
| ID | `bob-ledger-tools` |
| Version | 1.80.0 |
| Minimum Obsidian version | 1.8.7 |
| Desktop only | No |
| Description | Expand Bob daily-note snippets and ledger time ranges, navigate and adjust Pomodoro entries, render the live plan-budget bob-plan block, track task freshness including [unblocked::] TICKLERs, render [priority::] fields as signal-bar priority marks, render created/scheduled/completion/cancelled dates and `[repeat:: …]` rules as compact date-family marks (including date and recurrence marks in full and short Tasks query results), render `#task` tags as a teal hash task-tag mark (hidden in Tasks query results) and `#task #ref` pairs as an open-book ref mark, and render canonical `#task #gtd #pre` / `#task #gtd #post` runs as teal sunrise / flag identity marks across Live Preview, reading view, and Tasks rows. Render Depends-On lines as live dependency chips plus generated BLOCKS rows with live dependents, last-blocker keys, stale-entry styling, and frees-N summaries. Open BLOCKS rows add ＋ / hover × through nav api.blocks when present. Index raw task LINKS rows plus inert text mentions through api.relationIndex v2, with unsaved editor overlays, typed linkedFrom rows, a pure scanMentions helper, and label suggestions. Render Task Links under today's open Pomodoros with In Progress half-ring marks and read-time unblocked hand-off glyphs. Fetch `bob stats` JSON with stale-while-revalidate caching and render the responsive Stats page `bob-stats` block with metric-family context, accessible daily drill-down, definition disclosures, tiles, window time bars, and table. Fetch `bob ref list` JSON with a bounded stale-while-revalidate cache, decode audio paths, and provide pure Reading Board lane, card, Snoozed group, ordering, and validated fence models. Render the read-only `bob-reading-board` code block, a Reading / Next / Ready / Snoozed kanban of the reading queue drawn entirely from `bob ref list` JSON (wake dates and waiting-on reasons from bob, never from vault text), with keyed background refresh errors, repaint-safe navigation, roving keyboard focus, click and modifier routing to Obsidian navigation, the optional Highlights PDF hand-off through nav `openReferencePdf`, and the Open Reading Board command. Derive quiet lowercase Pomodoro home chips from linked task notes in Live Preview and Reading view, with area-hue dots, a tooltip, and a toggle. Show a display-only 🍅 Today mark on open task lines linked under today's open Pomodoros in Live Preview and Reading view, with a session toggle and jumps to the Task Link. Task relation lines are excluded from the plan Task Link count. Render 🪢 LINKS and LINKED FROM rows as live relation chips from that index, with label pills, inverse phrases, stale and broken styling, closed-row collapse, and ＋ / hover × through nav api.relations v1 when present. While the cursor is on a review row, the footer shows the Alt+P roll preview from nav api.quickRoll v1 in its hint slot and full sentence in its tooltip. In source-note Live Preview and Reading view, the freshness mark tooltip adds a `🥀 N keeps logged · last <date> — <reason>` line from the task's Rotten Log; Tasks and Dataview query rows never show it. Share the task type catalog through api.themes v1 and render Pomodoro name type pills with stable hues in Live Preview, Reading view, the plan block, and the Stats Types panel, with a session toggle; render explicit [type:: NAME] task fields as a colored #TYPE in the #task slot (folding the field, no trailing pill) with inherited-type and type-mark session toggles, mark disagreeing Task Links in today's ledger, and keep type colors active in every window. Render the read-only Day strip above the bob-plan badges of canonical daily notes with a quiet typical-day line under each numeric fact, support the bob-day-stats fence, and provide the Toggle Day stats session command and the Cycle Day stats bars command. api.laneWalk v2 serves the Pending/Next/Ready-off-Today walk list behind the navigation ]w / [w and ]W / [W keys. Run quiet `bob gcal sync` after the current daily note is created and paint Event Tasks and context rows in Live Preview and Reading view. |
<!-- END GENERATED: facts -->

<!-- BEGIN GENERATED: commands -->
## Registered commands

| Command | Command ID | Default hotkey |
| --- | --- | --- |
| Cycle Day stats bars | `cycle-day-stats-bars` | — |
| Expand Bob snippet | `expand-ledger-time-range-snippet` | — |
| Go to today's Task Link | `go-to-today-task-link` | — |
| Jump to current Pomodoro line | `jump-to-current-pomodoro` | Ctrl+9 |
| Open Reading Board | `open-reading-board` | — |
| Open Stats | `open-stats` | — |
| Open today's daily note | `open-today-daily-note` | — |
| Toggle Day stats | `toggle-day-stats` | — |
| Toggle Google Calendar sync on daily-note creation | `toggle-gcal-sync-on-create` | — |
| Toggle Pomodoro home chips | `toggle-pomodoro-home-chips` | — |
| Toggle Task Link In Progress marks | `toggle-progress-marks` | — |
| Toggle Today marks | `toggle-today-marks` | — |
| Toggle calendar event painting | `toggle-calendar-event-painting` | — |
| Toggle dependency chips | `toggle-dependency-chips` | — |
| Toggle inherited task types | `toggle-inherited-task-types` | — |
| Toggle root marks | `toggle-root-marks` | — |
| Toggle task date marks | `toggle-date-marks` | — |
| Toggle task freshness marks | `toggle-freshness-marks` | — |
| Toggle task priority marks | `toggle-priority-marks` | — |
| Toggle task tag marks | `toggle-task-tag-marks` | — |
| Toggle task type colors | `toggle-pomodoro-theme-colors` | — |
| Toggle task type marks | `toggle-task-theme-marks` | — |
| Toggle unblocked hand-off glyph | `toggle-unblocked-glyph` | — |
<!-- END GENERATED: commands -->

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

The plugin also renders a live `bob-plan` block: a `TODAY 3/3 · 7/10` chip with
the type and link budget (its tooltip lists each type with its link count),
`PENDING n/10`, `NEXT n/15`, and `READY n/100` chips that open the matching
dashboard sections, the `★ GOALS · DECKS · BOB` type line with the highlight
starred, and one muted line per lint. READY is the shared live current backlog
(Today excluded) and never changes the PLAN status; READY over its cap adds a
`ready_cap_exceeded` lint line. PENDING and NEXT show the live dashboard section
counts (Today excluded; `–` when Tasks or the current-day Today cache is
unready) and turn red only for a strict section excess, while whole-lane
pressure stays in the tooltip. `next_cap_exceeded` / `pending_cap_exceeded`
lint lines appear only when the matching badge is red and quote its section
count. Older daily notes follow
today's live lanes while keeping their own TODAY type and link budget.

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

The plugin shows a desktop review footer in the native status bar: nonempty
current walk groups only (PRE → NEW → PROJECTS → PENDING → NEXT → RECURRING →
TICKLER → ROTTEN → POST, with TICKS split from ROTTEN). The footer omits the
current review group from its trailing summary and shows the full summary when
no review row is current; it hides when the queue is empty or Tasks is
unavailable. The main button jumps to the next due task, falling back to
rotten. While the cursor is on a review row, the footer shows the `Alt+P` roll preview from nav `api.quickRoll` v1 in its hint slot and full sentence in its tooltip.

## Marks and rendered blocks

Marks are display-only: nothing writes them, and each has a session toggle that
restores the unmarked rendering:

- The freshness mark renders each canonical `[fresh:: YYYY-MM-DD]` stamp as a
  compact mark (`✓ today`, a draining lease ring with its age, `⟳ Nd` when due)
  in Live Preview and rendered views. Resolution is exact or neutral: an exact
  memo match or unanimous consensus drives the tone, otherwise the mark shows
  only the neutral lease and never a guessed due. In source-note Live Preview
  and Reading view, the freshness mark tooltip adds a
  `🥀 N keeps logged · last <date> — <reason>` line from the task's Rotten Log;
  Tasks and Dataview query rows never show it.
- The priority mark renders each canonical `[priority:: …]` field as one
  signal-bar glyph (4/3/2/1 filled bars for P1–P4, a solid `!` square for
  off-ladder `highest`) in Live Preview and rendered views. The glyph follows
  the stored Tasks value, never the ladder position; an unknown ladder omits
  P-labels instead of guessing.
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
  open-book mark.
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

The plugin also renders the TODAY/PENDING/NEXT/READY badges on dashboard and
daily `bob-plan` blocks as live section-over-cap counts that agree with their
Tasks sections (the BLOCKED badge stays informational and neutral with no
cap), the CROWDED chip, the `bob-ready-notes` ranked-bar block, `## Tasks`
heading chips, Pomodoro home chips (quiet lowercase chips with area-hue dots
derived from linked task notes, following each task's `[root:: NOTE]` field), Pomodoro type pills (one soft tint per
`+`-separated component of the ` — NAME` tail, with a gray pill for exempt
types such as PLAN, a tooltip naming the hue and day count, and a session
toggle now active in every window through the shared tint gate), and the display-only 🍅 Today mark on open
task lines linked under today's open Pomodoros, with a session toggle and a
jump to the Task Link. A name the catalog does not know stays neutral on the
cursor line while it is typed.
The shared behavior and hue contract is [Task types](https://bobs-org.github.io/task-types/).

The **Day strip** is a read-only daily Stats receipt rendered above the
`bob-plan` badges of canonical daily notes, in Live Preview and Reading view.
It shows that note's own day as a row of stacked stats (a small uppercase
label over a large value over a quiet typical-day line on each numeric
fact), followed by two lanes on the same working
minutes: the root-parent legend with `so far · HH:MM` over the
root-parent bar, then a type legend over the full-width type bar that
separates the strip from the badges — and paints from bob's Stats
report; it never changes the note and never writes the vault. A quiet
switch at the right of the top lane cycles both bars → root parents only
→ types only, for every daily note at once; the choice is remembered on
this device. Review
closed shows a green check, a red ✕, or the yellow In Progress half-ring
while today's review is still open. The roots bar groups working time
by root parent (falling back to areas with an honest "Time by area" label when
bob predates `root_parent`). The type bar groups the same minutes by task type and wears each type's hue;
clicking it opens Stats on the Types view. Each legend fits as many names as its line holds.
Daily notes without a `bob-plan` block show no strip. To place one explicitly,
add a `bob-day-stats` code fence in any note, optionally with `day: YYYY-MM-DD`.
A fence placed inside a daily note simply renders its own strip.

`DEPENDS ON` lines render as live dependency chips plus generated `BLOCKS` rows
with live dependents, last-blocker 🔑 badges, stale-entry styling, and `frees
N` summaries. Chips render in Live Preview and Reading view on owned
Depends-On rows only, with a session toggle; `waiting on N` counts open
prerequisites only. Open BLOCKS rows add ＋ to open the reverse Blocks stage
and hover × to remove a dependent. The Stats `bob-stats` block renders two window time bars above the tiles
that split the selected window's worked minutes by root parent and by
task type, then the responsive Root parents panel with Root parents
and Types views, area groups with sub-project disclosure, bucket fix-it
copy, and session drill-down, plus task counts; the Types view wears
each type's hue on its bars, with exempt types and `other` in gray. The `★` type line of
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

The plugin tracks task freshness from `[fresh:: YYYY-MM-DD]` / `[refresh:: N]`
/ `[keeps:: N]` stamps: the tiered PRE → NEW → PROJECTS → PENDING → NEXT →
RECURRING → TICKLER → ROTTEN → POST walk with ordinary reference freshness,
daily lane review, checklist tiers, and project reminders, plus the
freshness-gated READY lane, NEW/ROTTEN review models and chips, the review
queue, counts, lints, and the status bar. Folded keep pips always render in the
freshness mark; the leaf plus `Alt+F to decide` appears only when the
navigation decay-card capability is present and decay is on. READY counts gate
on the read-time bucket so NEW and ROTTEN review stay out of READY.

Other plugins never place `fresh` stamps themselves: navigation, the cycler,
and Block ID Prompt call the shared stamper instead. `keepLine` is the sole
increment helper (a counted keep stamps and increments once, saturating at 999,
with a valid prior `fresh` before today required; uncounted keeps preserve),
and every generic stamper clears `keeps`.

The `noteReady` surface backs the read-only per-note Ready cap: each
area/project note's Ready lane against `plan.max_ready_per_note` (default 5)
with per-note `ready_cap` overrides and crowded/full/room states.

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

`Cycle Day stats bars` cycles the Day strip bars switch (both bars → root
parents only → types only) for every strip on this device, with a Notice
naming the new view. It works with no strip on screen, since it changes the
view the next strip paints.

## Calendar Events

On by default, **Toggle Google Calendar sync on daily-note creation** watches
for today's canonical daily note after Obsidian finishes loading. When a new
note appears, Ledger Tools waits up to 15 seconds for Templater to add
`## Pomodoros`, then runs `bob gcal sync -q -f json` once. Bob remains the
only writer. Setup and writer-host errors go to the console; a runtime failure
shows at most one Notice per day. The toggle is session-only.

**Toggle calendar event painting** is also a session-only toggle. Events rows
in Live Preview and Reading view show quiet time pills, context tags, and
calendar/video/location badges. On today's note, a meeting in progress gets
the MEET hue and a past meeting dims. The clock refreshes once a minute while
today's note is active. Painting reads the note and never changes it.

`Ctrl+9` reuses an already open tab showing today's daily note in any window
before using the current tab or opening a new one, including a background tab
Obsidian has not loaded yet. Pinned main-area tabs are preferred, followed by
other main-area tabs, pinned sidebar tabs, and other sidebar tabs.
When the current tab is a lower-ranked copy of today's daily note, `Ctrl+9`
switches to the best-ranked tab first; it jumps to the current Pomodoro only
when pressed again on that home tab.

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
on. A live Task Link that disagrees with its task's type gets a dashed
`#TYPE` prefix in today's ledger. Day strip and Stats copy say **Time by
type** / **Types**; JSON still uses the `theme` dimension.

## Settings

This plugin adds no settings tab. It reads the shared bob config file: the
`plan:` block for lane caps, the `freshness:` block for decay and intervals,
the `stats.day_strip` switch (set it to `false` to hide the automatic Day
strip above the `bob-plan` badges), and per-note `task_refresh` frontmatter
for note overrides. It
also serves its rendered state to the other plugins through a versioned `api` surface
(`planBudget`, `todayKeys`, freshness, readiness, badge, lane walk, and mark namespaces)
so the dash and sibling plugins share one budget, one Today set, and one set of
glyphs.

## Related

- [Plan](https://bobs-org.github.io/plan/) — the lane model behind the plan
  block and badges.
- [Freshness](https://bobs-org.github.io/freshness/) — the stamp model behind
  freshness marks and review.
- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the
  Depends-On lines behind chips and BLOCKS rows.
- [Task tag marks](https://bobs-org.github.io/task-tag-marks/) — the tag-mark
  rendering contract, including `#TYPE` identity and ledger agreement marks.
- [Date marks](https://bobs-org.github.io/date-marks/) — the date-mark
  rendering contract.
- [Today marks](https://bobs-org.github.io/today-marks/) — the Today-mark
  rendering contract.
- [Dashboard](https://bobs-org.github.io/dashboard/) — the dashboard badges.
- [Stats](https://bobs-org.github.io/stats/) — the Stats block data.
- [Pomodoro homes](https://bobs-org.github.io/pomodoro-homes/) — the home-chip
  model.
- [Bob Navigation Hotkeys](bob-navigation-hotkeys.md) — the review walk and
  Task Card this plugin feeds.
- [Cross-plugin APIs](https://bobs-org.github.io/develop/plugins/plugin-apis/) — the versioned planning,
  freshness, stats, and mark interfaces.
