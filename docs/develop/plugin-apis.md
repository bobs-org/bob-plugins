---
title: "Cross-plugin APIs"
description: "Reference for the versioned runtime interfaces shared by Bob plugins."
---

Plugins communicate through a loaded plugin's `api` at
`app.plugins.plugins["<plugin-id>"]` and never import another plugin's
`main.js`. Feature-detect the provider and method; an unloaded plugin is
not a dependency. APIs are additive: check a namespace `version` when
present, and handle failed calls.

## Block ID Prompt

`block-id-prompt.api.pomodoroLinkPicker` is namespace version 1.
`pick(request)` resolves to a selected open Pomodoro
(`{ kind: "existing", entryLine, entryText, title }`), a new
destination (`{ kind: "new", name }`), or `null` when
cancelled, unavailable, or unable to resolve today's Pomodoros. The promise
does not reject. A new choice made from Recent may include the additive
`preserveSpelling: true` field so the caller keeps the catalog's display name.
Navigation Hotkeys uses this picker for successor offers. An optional
`task: { path, line, text, displayText, status }` request member enables
task-aware preselection: `line` is one-based and `text` is the full live
Markdown note. Calls without it keep the generic successor picker. `pick()`
itself does not write a task type. Task-aware picks carry an additive
`themeIntent: { deliberate, retype, shown, tabPick? }` on the committed choice:
`deliberate` is true when the committed row differs from the suggested default
or a query is typed, `retype` is true only for Alt+Enter, `shown` is the
suggestion actually presented (or null), and `tabPick` is the cycled composite
type key after Tab. Ctrl+Shift+Enter consumes that intent in the existing
task-line and ledger edit after revalidating `shown` against a fresh
`suggestFor`. Enter applies `planLanding`'s default merge; Alt+Enter requests
its explicit retype path. A stale shown suggestion skips the type and name
change. Picks without task context keep the legacy shape, and a malformed
optional intent is dropped. The namespace version stays 1.

| Namespace | Version | Contract |
| --- | ---: | --- |
| `taskLinks` | 1 | `fieldAt()` returns UTF-16 prose-field ranges; `open()` returns an indexed session with `rank`, `linkFor`, `suggestions`, `validate`, `name`, `onChange`, and `close`. Subject tasks are guarded. `name()` rechecks identity and IDs, writes open editors after a preimage check or closed notes through `vault.process`, and returns `{ ok, link, notePath, id }` on success. |

## Bob Prose

Bob Prose keeps the plugin id `bob-articles` and exposes
`app.plugins.getPlugin("bob-articles")?.api?.prose`, namespace version 1.
Check `version === 1` before using it. `snapshot(path)` is a read-only lookup:
it never starts Bob and returns `null` until Bob Prose has remembered a
plan for that vault-relative path. A frozen snapshot contains `path`,
monotonic `generation`, `status` (`ready` or `refused`), Bob's `outline` and
`findings`, `refusal` (`{ code, message }` or `null`), and `numbering`.
Refused plans keep Bob's message and findings; their outline may be `null`.
The outline and findings are frozen copies of Bob's JSON values.

`subscribe(fn)` calls `fn(path)` after each remembered plan or forgotten
path and returns an unsubscribe function. A consumer reads the snapshot again
inside its callback; responses older than a newer request are discarded before
they can replace the cached generation. The Prose Card uses one subscription
and only filters and rounds these values.

## Bob Ledger Tools

The root `bob-ledger-tools.api` is version 3. It shares live
planning data and presentation helpers: `caps`,
`planBudget`, `todayKeys`, `isToday`,
`todayRank`, `nextBudget`, `pendingBudget`,
`dashboardLaneBudget`, `renderDashboardLaneBadge`,
`readyBudget`, `renderReadyBadge`, and
`renderReviewChip`. With `content` supplied,
`planBudget({ path?, content? })` measures post-write content
synchronously; without it, the API reads the target note asynchronously.
`isToday` uses the task path and Tasks block link; it returns false when
either identity field is missing or the Today ledger cache is not ready.
`todayRank(task)` returns that task's zero-based index in the cached Today
ledger, or `Number.MAX_SAFE_INTEGER` when the task has no rank.

`isSnoozedToday(task)` and `isPlannedToday(task)` are additive readers:
Today remains ledger-derived, while planned-today also includes live Asleep,
Due, and Blocked snoozed tasks. `snoozed.rows()` returns snapshots from the
current daily-note cache, `plannedKeys()` returns canonical identity keys,
`nextWakeAt()` returns the earliest live Asleep/Due RFC 3339 instant or
`null`, and `ready(now?)` reports cache readiness. These methods never write
notes. On desktop, Ledger Tools asks `bob snooze wake -q -f json` once per
eligible minute; Bob alone performs the wake mutation.
A successful wake into an unnamed Pomodoro still shows the single-task Ready
now Notice, with the destination-name segment omitted.

| Namespace | Version | Purpose |
| --- | ---: | --- |
| `taskSettle` | 1 | Pure settle, guarded editor apply, idle pending scheduler, and optional `onSettled` observer. |
| `stats` | 2 | Append validated review events; `host`, `fetch`, and `bobPath` support Stats and consumers. |
| `logs` | 1 | Read the cached `bob logs list --format json` phrase catalog; `snapshot()` includes the session overlay, `noteUsed(kind, text)` records a successful local write, and `onChange` subscribes to refreshes. |
| `themes` | 1 | Share the Pomodoro theme catalog; `hueFor`, `componentsOf`, `historyRows`, and `similarTo` are synchronous, `fetch` and `snapshot` serve the cached `bob themes list` report, `hide`/`unhide`/`color`/`rename` spawn bob with `--via`, and `onChange` subscribes to updates. |
| `workBadges` | 2 | Return count-to-limit badge tones through `tone` and `todayTone`. |
| `snoozed` | 1 | Read cached Snoozed rows, planned identities, and next wake time; the desktop waker invokes Bob's CLI writer internally. |
| `freshness` | 12 | Read or update freshness, refresh intervals, keep counts, review queue, and unblocked metadata. |
| `noteReady` | 1 | Read per-note Ready-lane counts and render the crowded-note chip. |
| `dashboardCollections` | 1 | Snapshot or render PROJECTS and REFERENCES badges. |
| `laneWalk` | 2 | Serve the Pending/Next/Ready-off-Today walk list behind `]w` / `[w` and `]W` / `[W`. |
| `priorityMarks` | 1 | Model and render priority marks. |
| `blockMarks` | 1 | Classify a canonical Blocked task line and explain its display mark. |
| `dateMarks` | 1 | Model and render canonical date marks. |
| `progressMarks` | 1 | Refresh the display-only In Progress Task Link mark. |
| `unblockedGlyph` | 1 | Refresh the display-only unblocked hand-off glyph. |
| `relationIndex` | 1 | Read the live, source-authoritative task relation index and label suggestions. |
| `relationLabels` | 1 | Read the relation-label catalog and delegate hide, unhide, and previewed rename writes to bob. |
| `attachments` | 1 | Look up recorded image origins and delegate image imports to bob. |
| `bank` | 2 | Fetch cached `bob bank list` / `report` JSON, subscribe mounts, and run guarded acknowledgment and Category card actions. |
| `bankWalk` | 1 | Serve the read-only bank-row walk snapshot, the shared step/day planners, cursor locate, live-buffer identity resolution, the session anchor, and the Category-card busy flag behind `]b` / `[b` and `]B` / `[B`. |
| `periodNotes` | 2 | Open or create a canonical period note through `bob periods ensure`; v2 refuses pre-adoption past targets unless `allowPreAdoption`. |
| `navGroups` | 1 | Resolve derived calendar group and step stops for `[N` / `]N` and legacy `[n` / `]n` fill-in. Records return `route: null` until record-groups. |

### `taskSettle` v1

See [Task settle v1](task-settle.md).

`logs.fetch({ force? })` resolves `{ status, catalog, fetchedAt }`, where
`status` is `ok`, `stale`, `unavailable`, `unsupported`, or `error`. A cached
catalog is returned immediately while it revalidates; malformed replies keep
the last good catalog. `snapshot()` is synchronous and returns `null` before
the first successful fetch. The session overlay is capped at 50 phrases per
kind and schedules a fresh bob scan after a write. Mobile returns
`unavailable`; an older bob without `logs` returns `unsupported` for that bob
executable until Ledger Tools reloads.

`relationIndex.ready()` reports whether the chunked initial scan is complete;
`generation` increases whenever a complete pair of forward and reverse maps
is published. `outgoing(path, blockIdOrLine)` accepts a block ID, a 1-based
task line number, or the source task's line text, and returns its relation
rows, including unresolved targets. `incoming(path, blockId)` returns
only rows whose target path and block ID resolve. Each row contains `source`
and `target` task records (`path`, `blockId`, `line`, `text`, and `status`),
the optional `label`, relation line number and raw text, plus `resolved`,
`archived`, `embedded`, and `struck` flags. `labelSuggestions(prefix?)` returns
case-insensitively deduplicated `{ label, count }` rows ordered by count, then
Unicode code point. `onChange(callback)` subscribes to atomic map publications
and returns an unsubscribe function. Task text and status prefer the Tasks
cache and fall back to indexed note text, including read-only `done/` notes.

The index scans relation-bearing Markdown files in idle chunks, including
`done/`, and updates from metadata changes, vault create/delete/rename events,
and the active editor's unsaved text. Vault, metadata, overlay, and scan-driven
publishes coalesce to one rebuild per microtask. A pending rebuild flushes on
any `api.relationIndex` v1 read (`generation`, `ready`, `outgoing`,
`incoming`, `labelSuggestions`) so those calls observe the latest maps. The
Tasks-backed task memo is reused for every rebuild in the same turn. Relation
targets are resolved with Obsidian's link resolver and cached block IDs.
Consumers render from this live index; they do not read the generated
`LINKED FROM` mirror as source data.

`relationLabels.rows(query?, { hidden })` and `hiddenCount()` expose the
catalog and folded hidden preferences. `hide(name)`, `unhide(name)`, and
`rename(from, to, { dryRun?, merge?, via? })` resolve `{ ok, code?, message?,
report? }` without rejecting. Writes spawn bob with `--via` and refresh the
read-only journal fold; rename previews return the dry-run report without
writing.

`attachments.origin(vaultPath)` resolves to `{ ok, schema_version, path,
origin, warnings }`; `origin` is a recorded source and state or `null`.
`attachments.import(path, { via })` resolves to `{ ok, schema_version,
attachments }`, with bob's saved path, embed, reuse result, and source details.
Both methods return `{ ok: false, code, message }` on failure and refuse to
spawn bob outside the desktop app. The namespace version is 1; the root api
version stays unchanged.

`bank.fetch(options)` returns cached, generation-guarded `list` / `report`
documents; `subscribe(spec, subscriber)` registers a mount's date or month
requirements and `invalidate(reason)` revalidates on hub or canonical month
vault events, focus, local day rollover, or successful ensure and ack.
`monthPaths()` lists existing canonical month notes from the file catalogue,
`locateHeading(source, month, date)` resolves a real day heading, and
`recognize(path, source, line)` classifies a canonical bank row. Actions are
`ensureOpenDay(day, options)`, `ackDayAtCursor(editor, view)`,
`ackIds(ids, options)`, and `toggleIdLessRowAtCursor(editor,
expectedLineText)`; acknowledgment submits only the drawn snapshot's IDs and
ID-less toggles verify the exact row before flipping one byte. Version 2 adds
`claimRowClose(editor, view)`, which is synchronous and never throws: `true`
when ledger-tools takes Ctrl+Enter (opens or focuses the Category card, or
swallows the post-landing lock) and `false` when the cursor is not a waiting
bank row. `setCategory(editor, view)` opens the same card on any bank row
without advancing or changing its checkbox. Task Status Cycler
feature-detects `api.bank.version >= 2` and `claimRowClose` on waiting rows
only; a missing, v1, false, or throwing claim falls back to today's
`[ ]`↔`[x]` flip. Ticked rows never delegate.

`bankWalk` is namespace version 1. `snapshot()` returns a frozen
`{ available, reason?, generation, scope, counts, entries, days, files }`
document (WAITING while any row waits, else ALL) and never throws; `plan()`
is the pure step/day planner with the cursor-plus-anchor origin ladder;
`locate()` classifies the cursor; `resolve()` replays identity against the
live editor buffer (block ID, then exact line, then unique text in the day)
at the payee start; `anchor()` / `setAnchor()` carry the session landing;
`busy()` is true while the Category card modal is open. Nav keys, the footer
panel, and the Category card all read this one snapshot and planner, so arms
and jumps can never disagree. The top-level ledger api version is unchanged.

`periodNotes` v2 adds a `pre-adoption` refusal on past targets whose ISO
week-year has no week note (`allowPreAdoption` bypasses it). `navGroups` v1
`resolve({ path, content })` is synchronous and never throws: calendar notes
get derived step and group stops (`exists` / `creatable` / `ghost`;
pre-adoption past targets are ghosts; missing dailies in adopted years and
the future are creatable), year and `all_time` set `none`, and every other
path returns `route: null` until record-groups. The adopted-year cache
invalidates on week-note create, delete, and rename.

- Register `vault` `create` / `modify` listeners inside `workspace.onLayoutReady`,
  because Obsidian replays `create` for every vault file (PDFs included) during load.
- Never `read` / `cachedRead` non-Markdown files from a vault event.

The read-only `readyBudget()` returns
`{ count, cap, over }`; unavailable Tasks data or an unready cache
returns a null count. `dashboardLaneBudget(lane)` returns
`{ section, lane, cap, over, today }` with null section/lane when
unavailable. Here `pending` selects Tasks status `IN_PROGRESS` and `next`
selects status symbol `*`. The section count excludes Today; badges use it
for color and turn over only when `section > cap`. Whole-lane pressure remains
in the tooltip. The no-argument `pendingBudget()` and `nextBudget()` keep
whole-lane counts for existing callers. Render helpers accept a host and
optional source-path/component context so mounted views can refresh with their
lifecycle.

`laneWalk.queue()` returns `{ available, reason?, date?, entries, counts? }`
with `entries` in walk order (PENDING, then NEXT, then READY; path, then
1-based line) and `counts` (`pending`, `next`, `ready`, `total`,
`todayPending`, `todayNext`, `todayReady`, `reviewReady`). Each entry
carries `key`, `path`, `line`, `lineNumber`, `originalMarkdown`, `text`,
`blockId`, `lane` (`pending` | `next` | `ready`), `laneLabel`, `created`,
`rank`, `total`, `laneRank`, and `laneTotal`. PENDING / NEXT use the same
gating as the lane budget (Tasks array, Warm cache, ready Today cache);
READY uses that same Tasks and Today gate plus the freshness review gate
`readyBudget` uses, so READY `entries.length` equals `readyBudget().count`
on the same Tasks and freshness snapshot, and per PENDING / NEXT lane
`entries.length` equals the `dashboardLaneBudget` section. The call reports
`reason: "tasks" | "today" | "error"` when unavailable. The result is
memoized on the Tasks array identity, the local date text, the Today
generation, and the freshness snapshot identity, and the call never throws.

The `freshness` namespace advertises
`trackerReview`, `checklistTiers`, and
`recurringTier`. Its methods include `config`,
`stampLine`, `setRefreshLine`,
`keepLine`, `markUnblockedLine`,
`state`, `returnedBy`, `bucket`,
`reviewModel`, `isDue`, `tier`,
`rank`, `intervalFor`, `intervalForLine`,
`queue`, `counts`, `lints`, and
`reviewEntryView`. These calls are synchronous and do not throw;
`keepLine` is the sole helper that increments the keep streak.
Generic freshness stampers clear that count. A counted keep saturates at 999
and increments only when the line has a valid `[fresh::]` date before today;
missing, malformed, or same-day freshness does not add to the streak.

Navigation Hotkeys exposes `freshnessDecayCard.version >= 2` as a capability
for the approved decay decision card. Ledger Tools shows the decision-card
leaf and `Alt+F to decide` hint only when that capability is present and decay
is enabled. Without either condition, freshness marks use counting-only
wording.

Navigation Hotkeys, Task Status Cycler, and Block ID Prompt delegate freshness
placement to Ledger Tools with
`api?.freshness?.stampLine?.(line, dateText) ?? line` when the Ledger Tools
root API is version 3 or later. They do not place `[fresh::]` themselves.

`noteReady` provides `snapshot(now?)`,
`forNote(path)`, `counted(task)`,
`inCrowdedNote(task)`, `groupLabel(task)`, and
`renderCrowdedChip(host, options?)`. It reads the area/project
note's Ready lane against the shared cap and is synchronous.

`themes` shares the Pomodoro theme catalog (namespace version 1). Every
picker uses it; no plugin keeps its own hidden list or history scanner.
`available()` is false on mobile, where pickers stay today-only but colors
(hash, area, and journal pins from the vault `.bob/themes/` fold) still
render. `fetch()` resolves `{ report, stale, error }` with stale-while-
revalidate single flight over `bob themes list -a -f json`;
`snapshot()` returns the last report without spawning, including Bob's
`configured_themes`, `counts.configured`, and per-row `configured` fields
when the vocabulary is present. `isConfigured(key)` returns `true` or
`false` when that snapshot has a configured vocabulary, and `null` when it
does not. `hueFor(key, name)` returns `{ hue, hue_source, configured }`
and never throws; `hue_source` preserves `config` and `unconfigured`.
`componentsOf(name)` returns `{ raw, key }` rows, `historyRows({ query,
limit, exclusions })` ranks visible configured themes per PT7 group B then D
when configured themes exist (including never-used names in config order),
and `similarTo(name)` returns up to 2 visible configured near-duplicate
names. `hide`,
`unhide`, `color`, and `rename` spawn bob with `--via bob-ledger-tools`,
then refresh; they resolve `{ ok, code?, message? }` and never reject —
an older bob without the writers resolves `code: "unsupported"`.
`onChange(callback)` subscribes to catalog changes and returns an
unsubscribe function. The `--bob-hue-*` tokens in the ledger stylesheet are
the single source for theme color; later picker surfaces reuse them. The JS
mirrors of the hue rule, the journal fold, the PT7 ranking, and the D4–D8
routing planners are pinned by
`scripts/fixtures/pomodoro_themes/vectors.json`, copied byte-for-byte from
bob-cli. See the [Pomodoro themes contract](https://bobs-org.github.io/pomodoro-themes/)
for the shared catalog, hue, and menu rules.

The `themes` v1 namespace also exposes synchronous task-type helpers:
`suggestFor({ path, line, text? })`, `taskThemeOf(text)`,
`setTaskTheme(text, name)`, `clearTaskTheme(text)`, `isKnownTheme(key)`,
`effectiveTypeFor(request)`, and the pure agreement and routing planners.

`suggestFor` uses a vault-relative path, one-based line, and optional live note
text. Without `text`, it reads only a matching open editor. It returns the
Rust-compatible `ThemeRef` plus `source` and `label`, or `null`; it never
substitutes another note or stale Tasks metadata. `taskThemeOf` returns
`{ state: "none" }`, `{ state: "set", value, key, fields }`, or
`{ state: "repair", repair, fields }`; spans are UTF-16 offsets. The parser
accepts `type` and legacy `theme` fields in bracket or parenthesis form.
`setTaskTheme` writes canonical `[type:: NAME]` text in its returned string
and removes both spellings; these helpers never write the vault.

`effectiveTypeFor({ path, line, text?, asIfOpen? })` applies the same
suggestion cascade. Done and cancelled tasks return `null` unless
`asIfOpen: true` requests their stored or inherited type. `typeComponentsOf`
returns `{ name, key, isType }` rows; `typeAgrees` checks the shared entry
invariant. `agreeEntry` returns `{ name, added, removed, unrepaired }`;
`settleClosed` narrows a closed entry to its worked components.
`agreeLedgerEntries({ path, content, entryLines? })` asynchronously returns
reconciled text and entry reports without writing; unresolved or ambiguous
links remain unknown and prevent type removal.

The pure planners are `planLanding`, its v1 alias `planRetype`, `planSplit`,
`mergeNames`, `narrowClosed`, `shed`, `planPlacement`, and `planRelocation`.
They return the selected type or placement action, split partitions, or an
unusable-input result without spawning Bob or writing. Full cascade, parser,
and planner rules are in the [Pomodoro Themes contract](https://bobs-org.github.io/pomodoro-themes/).

Explicit `[theme:: NAME]` / `(theme:: NAME)` fields render as PT13 pills in
Live Preview, Reading view, and Tasks/Dataview task rows through the same
canonical mark model. A Dataview `theme | NAME` chip is replaced only when it
is an explicit task-line field; `task.theme` inherited from page frontmatter
is not enough. Hover tooltips resolve `suggestFor` lazily from the originating
note, never from a dashboard path, and never put `::` in `aria-label` or
`title`.
`dashboardCollections` provides `snapshot()` and
`renderChip(host, options?)` for live PROJECTS/REFERENCES badges.

`priorityMarks` exposes `model(value)` and
`render(host, value, { decorative?, inheritColor? })`.
`blockMarks.model(lineText, { path })` returns the frozen mark model for an eligible
Blocked `#task` line, or `null` when the line is ineligible or its prerequisite state
cannot be proven from the Tasks cache. `blockMarks.render(host, model,
{ decorative? })` appends one listener-free `span.bob-block-mark` carrying the same
`data-bob-block`, `data-bob-block-family`, and `data-bob-block-more` attributes as a
marked row and returns it, or `null` for invalid input, a disabled gate, or an
unavailable DOM. Meaningful miniatures get `role="img"` plus the model tooltip as
`aria-label`; `decorative` miniatures get `aria-hidden="true"`. The renderer accepts
synthetic digit models (for example a Task Card `{ key: "p2", family: "waiting" }`)
and never requires a source task. Every function is synchronous, display-only, and
never throws.
`dateMarks` exposes `model(field, dateText)` and
`render(host, field, dateText, { decorative?, inheritColor? })`;
its fields are `created`, `scheduled`,
`completion`, and `cancelled`. These glyphs are
display-only. `progressMarks` exposes `expect(entries)`,
`refresh()`, and `isEnabled()`; the
`unblockedGlyph` namespace exposes `refresh()` and
`isEnabled()`.

## Bob Navigation Hotkeys

The root `bob-navigation-hotkeys.api` is version 3:

| Namespace or method | Version | Purpose |
| --- | ---: | --- |
| `reviewWalk` | 2 | Capture a review landing with `capture(editor)`, then continue it after a gesture with `continue(origin, outcome)`. v2 parks and lands on `outcome.follow`. |
| `inboxRoute` | 1 | Test an inbox path and prompt or commit a route. |
| `quickRoll` | 1 | Preview the `Alt+P` roll for a review row. |
| `taskLinkLane` | 1 | Match a Pomodoro Task Link and toggle its Next/In Progress lane. |
| `taskScope` | 1 | `at({ lines, line })` returns the frozen task owner and its owned zero-based lines, or `null`. |
| `logRecall` | 1 | Attach the USED BEFORE phrase band to a host-owned text field and record successful Work Log writes. Additive `links: true` delegates to `proseField`. |
| `proseField` | 2 | Attach the controller that owns USED BEFORE and the LINK band for `[[` notes mode plus `((` tasks mode (list + in-band NAME) in prose prompts. |
| `notice` | 6 | Show the Unblocked card; v2 `keep_moving`, v3 `relation_successors`, v4 `offer_closes`, v5 a trailing `↗ “S”` jump line, v6 `req_outcomes`/`req_met`. |
| `successors` | 5 | Ask which offered successor links to add; v2 accepts `keep_moving`, v3 accepts the `relation` group, v4 resolves verdict closes, and v5 stages a `Ctrl+J` jump pin. |
| `mailCloseGuard` | 1 | Classify task close targets as Gmail Tasks and show the Mail Close Card before a navigation-owned close. |
| `parentPicker` | 1 | Restricted home picker as a choose-only API: `list(sourcePath, query?, limit?)` ranks homes through the Change parent model and `choose(sourcePath, { candidatePath? })` validates headlessly or opens the panel choose-only. Never writes; bob validates the committed `setting.set parent`. |
| `taskSplit` | 1 | Carry one task requirement into its own task through `carryReq`. |
| `blocks` | 1 | Open the reverse Blocks stage or remove a dependent. |
| `relations` | 0 | Remove a LINKS edge (`removeLink`). `openStage` opens the Links direction; the reverse direction settles `{ ok: false }` until both stage directions ship. |
| `openReferencePdf(path)` | Additive member | Open a vault-relative PDF in Highlights; resolves `{ ok, reason? }`. |
| `openFileInActiveLeaf(file)` | Additive member | Save and verify the current note before opening a Markdown file in the active leaf; reports `{ ok, reason? }` and checks for a clobbered landing. |
| `openDependencyStage(ref)` | Root method | Open the task's dependency stage. |
| `removeDependency(parentRef, target)` | Root method | Remove the requested prerequisite. |
| `claimReviewWalkCompletion(editor)` | Root method | Claim completion handoff for a landed review row. |
| `recordJump(from, to)` | Additive member | Record one origin→destination transition on the same file-aware Vim jump history `Ctrl+O` uses. Synchronous, never throws, returns `true` when recorded. Feature-detect the method; the root `version` stays 3. |
| `landOnTask(target, options?)` | Additive member | Re-find a task by identity (`{path, blockId?, text?, line?, description?, label?}`). Resolves `{ok, reason?, line?}`. Records a Vim jump and flashes the line. Never stamps or touches the walk. |

`mailCloseGuard.classify(targets)` resolves to the target rows that are Gmail Tasks.
Each target is `{ path, line, lineText?, before, after }`: `line` is one-based,
`before` is an open checkbox status, and `after` is `x`, `X`, or `-`.
Classification follows the shared Mail Close Card predicate, resolving the task's
own links and direct link-only children against mail-note frontmatter.
`mailCloseGuard.confirm(targets, { context?, openingKeys? })` resolves to
`{ confirmed, guarded, token }`. It returns immediately with `confirmed: true`
when no target is a Gmail Task. A guarded close opens one card; only `y` confirms.
The `token` names confirmed identities and covers subsets when lines shift; pass
it as `context.mailCloseConfirmed` so one gesture prompts once. Both methods settle
without throwing. The root API remains version 3 because this is additive.


`inboxRoute.isInboxNote(path)` is synchronous and never throws. `prompt(request)`
resolves `{ kind: "move", path, name }`, `{ kind: "stay" }`, or
`{ kind: "cancel" }`; `commit(request)` resolves
`{ ok, name, count, notice, handledRefs, reason }`. Neither promise rejects.
After unload, prompt resolves `stay` and commit resolves unavailable.
The shared route rules are in the [Task Dependencies contract](https://bobs-org.github.io/task-dependencies/) §9.

`quickRoll` provides `keyLabel` (`Alt+P`) and
`preview({ content | lines, line, tier })`. The synchronous, non-throwing
preview returns `{ ok, kind, line, compact, detail, parts }` or
`{ ok: false, reason }`; `parts` reconstruct `compact`, and kinds are `roll`,
`decay`, `cancel`, and `assign`. Unprioritized tasks preview; PRE/POST rows
and lines without a recommendation refuse. After unload it returns unavailable.

`taskLinkLane.matches({ content, line, path })` is synchronous and
`toggle(args)` settles to a result object. `logRecall.attach(...)` provides
`handleKeydown`, `backOut`, `isRecalling`, `setKind`, and `detach`; its
`noteUsed(kind, text)` forwards successful writes to Ledger Tools. With
`links: true`, it delegates to `proseField`. `proseField.attach` accepts
`inputEl`, `bandHost`, `sourcePath`, `recall`, `links`, `tasks`, `subjects`,
`mode`, `minOffset`, `density`, `ownKeys`, and `scope`. Its v2 handle adds
`isTaskOpen`, `isNaming`, and `setSubjects`; completion inserts text only.
Feature-detect `api.proseField.version >= 1`.

`successors.pick(model)` resolves to a picker result or `null`. Rows may carry
snapshot-bound task identities for nested retargeting; that picker never edits
a task field. Additive destination `themeIntent` is retained only when valid,
then revalidated against a fresh type suggestion before a caller changes the
task or Pomodoro name. Successor versions 2–6 add keep-moving and relation
groups, close verdicts, jump pins, and requirement outcomes. Results can carry
`picks`, `closes`, `jump`, or `reqs`; close-only, jump-only, and requirement-
only commits are non-null. Offer each group only when the corresponding
`api.successors.version` is supported. The [Task Dependencies contract](https://bobs-org.github.io/task-dependencies/)
defines group and receipt behavior (sections 12.13, 12.15, 12.18, 12.22,
12.24, and 12.25).

`taskSplit.carryReq({ notePath, line, expectedLine?, expectedOwnerPreimage? })`
resolves `{ ok: true, task, moveMap, restores, notice, cursor }` or
`{ ok: false, code, message, failedPaths? }`; it never rejects. The one-based
`task.line` is in `{ path, line, blockId, text }`; `moveMap` contains source and
destination paths plus one-based line moves. `restores` holds exact before /
after snapshots and `created` flags for guarded Undo. The expected line digest
and exact owner preimage refuse stale requests as `split_stale_ref`; missing
owners (`split_owner_missing`), non-requirements (`not_a_req`), and unavailable
writes (`split_unavailable`) return typed refusals. It does not navigate or
show a notice. Feature-detect `Number(api.taskSplit?.version) >= 1`.

`blocks.openStage(ref)` and `blocks.removeDependent(ownerRef, target)` settle
to result objects. `relations.removeLink(sourceRef, targetRef)` removes the
authored edge and best-effort updates its mirror;
`relations.openStage({ path, line, direction })` opens the owner's Links stage
for `to` and otherwise returns unavailable. `notice.showUnblocked(model)`
handles successor receipts; versions 2–6 add keep-moving, relation, close,
jump, and requirement outcomes. Their payload details follow the same Task
Dependencies contract.

`cancel` v1 exposes the pure `planCancel(content, targets, { date, reason })`.
Targets
contain the source `line` and `rawLine`; blank reasons use `🤷 no reason given`
only when a Cancel Log already exists. Callers write its returned content
through their own transaction.

Navigation methods settle to result objects or `null`, not rejected promises.
`reviewWalk.capture(editor)` returns `null` without a current landing;
`continue(origin, outcome)` resolves the advance result, with v2 parking then
landing on `outcome.follow`. The additive `walkMode` namespace persists the
selected family and attention: v4 adds bank walk, v5 lane walk, and v6 paints
selected-family attention as letter ink and other attention as a dot. Feature-
detect the required `walkMode.version` before using each family.

## Task Status Cycler

`task-status-cycler.api` is version 7:

- `recoverBlockedDependents(identities, context?)` runs the same
  dependent recovery as task completion without retiring references. It
  resolves to `{ reopened, failures }`; tasks with a strictly
  future `scheduled` date remain Blocked.
  Each identity has `path` and at least one of
  `blockId` or `taskId`. The method never throws; failures are returned in
  the result.
- `completeTaskAtCursor(editor, options?)` completes the cursor task through
  Tasks' `set-status-symbol-to-x` command so recurrence can run; it never
  writes `[x]` directly. It returns
  `{ ok: true, lineDelta, successorNotice }` or
  `{ ok: false, reason }` and does not stamp the task. An unconfirmed Gmail
  Task close returns `{ ok: false, reason: "mail-close-kept" }` after the
  Mail Close Card (nav `api.mailCloseGuard` v1); pass
  `options.context.mailCloseConfirmed` to skip a second prompt in the same
  gesture. With `options.successorJumpTarget === "return"`, a compatible
  pinned successor is returned as `jump` for the walk owner to follow.
- `completeTaskLineText(lineText, { date }?)` returns a frozen result.
  Completable open tasks return `{ ok: true, unchanged: false, lineText }`
  with the exact local-fallback bytes (`[x]` plus `[completion:: date]`,
  defaulting to today) and no freshness stamp. Already-closed tasks return
  `{ ok: true, unchanged: true, lineText }`; recurring and non-task lines
  return `{ ok: false, reason: "recurring"|"not_completable", lineText }`.
  Complete-label writers compose the rewrite with their LINKS edit in one
  transaction. It never throws.
- `finalizeClosedTasks(identities, context?)` runs the post-Done pass
  Ctrl+Enter runs after its write: dependent recovery, embed retirement,
  the Unblocked notice, and the successor picker. It resolves to
  `{ reopened, retired, recoveryFailures, retirementFailures, successors,
  successorNotice, jump? }` and never throws. Managed Done close gestures
  capture requirement forests before their write and include them in the
  same successor card when Navigation Hotkeys exposes picker v6 or newer.
  The capture includes idless owners with Pending requirements. Their close
  identity is the note path, pre-close 1-based line, and canonical `task_key`;
  the cycler never mints a block ID to open the requirement-only pass. An
  idless close with no Pending requirements stays on the no-extra-scan path.
  The card defaults Pending requirements to Met, applies explicit Drop/Carry/
  Carry plus pull-in choices, and resolves a requirement jump after all writes.
  Callers that own the close write can pass pre-close snapshots as
  `context.reqCloseOwners`; cancellation, parked, automated, and offer-close
  verdict paths do not open a requirement audit. A normal caller's pinned offer
  lands after retirement and its notice; a walk owner opts into
  `context.successorJumpTarget: "return"` and receives the jump to park and
  follow.
- `captureReqCloseOwners(identities, { preCloseNotes?, activePath?, editor? }?)`
  is the read-only pre-close capture for external managed Done writers. It
  returns opaque owner snapshots in identity order; pass the result to
  `finalizeClosedTasks` as `context.reqCloseOwners`. When `preCloseNotes` is
  supplied, it maps vault-relative paths to the exact pre-write text. An
  idless identity supplies `{ path, line, task_key }`, where `line` is
  1-based and `task_key` is the canonical key produced by
  `reqCloseStableTaskKey`; the owner forest is still captured from the
  pre-close text. If an idless owner is the only closing row,
  `finalizeClosedTasks` calls the requirement-only successor pass with an
  empty close list, so it does not plan recovery, retirement, or successor
  links for that owner.
- `offerParkedSuccessors(identities, { slot, successorJumpTarget?, successorJumpBox? }?)`
  plans relation-only successor offers for Pending (`[/]`) tasks that have no
  live Task Link left on today's daily note. It presents the nav picker with
  `event: parked`, applies picks, and shows the notice. `slot` is the removed
  link's `{ entryLine, bulletLine, entryDeleted }`. With
  `successorJumpTarget: "return"` and a `successorJumpBox`, it returns the jump
  through the box instead of landing, so the inbox-route move can land after.
  Older cyclers ignore the return fields and land immediately. The method never
  throws; it resolves `{ offered, picked }`. Still-linked, non-Pending, and
  empty identities are silence (`{ offered: 0, picked: 0 }`). Consumers
  feature-detect `api.version >= 4` and the method.
- `describeOfferCloses({ rows, gesture }?)` reports per-row Done/Cancel
  eligibility for the project-promotion successor card. Each row is
  `{ key, text, notePath, status, selectable, line, rawLine, blockId? }`
  with promotion-minted keys (`path#^id`, `path@digest~n`). It resolves to
  `{ descriptors: { [key]: { complete, cancel, why?, completeConsequence?,
  cancelConsequence?, scopeNote?, unblocks } }, supported }`. `supported`
  is false when nav speaks older `successors`/`cancel` namespaces; in that
  case `descriptors` is empty and the card stays pull-in-only. ID-less keys
  are translated to the engine's digest per call, so the shared validators
  keep refusing look-alike neighbours. The method never throws.
- `applyOfferCloses({ closes, expectedLines, rows? }?)` runs the guarded
  verdict step for the promotion card: revalidates each close against its
  card preimage line, applies root-only Done / Task-Card-parity Cancel
  writes, then runs one recover-only cascade over the joint closed set. It
  resolves to `{ offer_closes, offer_close_refused, undo: { restores }?,
  resolved?, failures? }` for the `api.notice` v4 receipt. Both methods are
  queued like the other public cycler methods. Consumers feature-detect
  `api.version >= 5` and the method.

## Bob Command Mode

`bob-command-mode.api.commandMode` is namespace version 1. Feature-detect
the plugin and namespace first:

```js
const commandMode = app.plugins.plugins["bob-command-mode"]?.api?.commandMode;
if (commandMode?.version >= 1) {
  const result = await commandMode.run(["plan"]);
}
```

`run(argv, opts)` settles to `{ ok, runId, outcome, exitCode, reason? }`
and does not reject. `openOutput(runId)` opens a run in the pager;
`activeRuns()` lists live records; `catalog()` and `lastRun()` read the
cached catalog and newest record. `onRunStarted`, `onRunState`,
`onRunFinished`, and `onCatalogChanged` subscribe to lifecycle changes and
return unsubscribe functions. Feature-detect each additive member before use.

### Command-chip members

These command-chip members never throw or reject.

`resolve(text)` is pure and synchronous over the cached catalog; it never
spawns bob or starts a catalog load. Steps split at unquoted `&&`
and at line breaks; blank lines are skipped, and a line break right after
`&&` continues the chain. Quotes and escapes follow the sheet's typed-argv
tokenizer; `~` and globs stay literal. It returns a frozen
`{ ok, state, signature, steps, reason, step }`:

- `state` is `ready`, `invalid` (syntax, unquoted shell syntax such as `;`,
  `|`, `||`, a lone `&`, `>`, `>>`, `<`, a backtick, `$(`, `${`, or
  `$NAME`, an empty step, a first word other than exactly `bob`, an excluded
  or unknown command, or a missing argument), `unavailable` (host-restricted
  command, or bob missing or unreadable), or `loading` (no catalog yet).
  Syntax faults win, so a malformed chip is `invalid` even while loading.
- `steps` (ready only) holds frozen `{ index, text, argv, entryId, entry_id,
  title, effect, policy, presentation, hasPreview, confirm }`. `index` is
  1-based, `text` is the trimmed authored step (quotes kept, for faces),
  `argv` is alias-resolved without the leading `bob`, and `confirm` is the
  confirm prompt or `null`.
- `signature` is the engine's canonical sequence signature (the same one
  the sheet's sequences use), or `null` when not ready.
- `reason` and the 1-based `step` name the first failure, or are `null`.

`runText(text, { source, onState })` reads only those two options; the
trigger is always `chip`. It re-resolves at activation. A `loading` verdict
waits up to 5 s for a catalog load already in flight, never starting one.
A verdict that is not ready settles `{ ok: false, outcome: "refused", stage:
"refused", state, step, reason }` without spawning. Otherwise it settles
`{ ok, stage, outcome, runId, sequenceId, reason? }` plus the runner's or
sequence driver's existing fields, where `stage` is:

| `stage` | When | `outcome` |
| --- | --- | --- |
| `run` | One step, run now with preview-first skipped | the run's outcome |
| `sequence` | Several steps through the sequence driver | the summary outcome; `runId` is the focus run and `stoppedAt` the halting step |
| `output` | A report runs into the sheet's output stage, or the signature is already live (`duplicate: true`, its output opens) | the run's outcome, or the live state |
| `confirm`, `review` | A `confirm` policy opens its card for one step or several | `opened`; `runId` is `null` and nothing ran |

`onState` receives frozen `{ state, kind, signature, runId, sequenceId,
step, total, outcome, reason, exitCode, stoppedAt }`, with `kind` `run` or
`sequence`. `queued` and `running` come from the runner for each run that
really queues and spawns; `step` reports each settled sequence step with its
outcome and first error line; one `finished` closes every activation that
reached execution, carrying the outcome, `reason`, and `exitCode` for failed
ink. A sequence's `finished` is separate from its steps' `step` events.
Refusals and card stages send no events, and a throwing or rejecting
callback never affects the run.

`openText(text, { source, onState })` is the guarded path: a preview-first
command opens its preview (`stage: "preview"`, whose fields describe the
dry run and send no `onState`), a report runs into output as in `runText`,
and anything else opens the review card (`confirm` or `review`).

`activeRun(signature)` returns a frozen `{ kind, state, runId, sequenceId,
step, total, … }` or `null`. Sequences match on their immutable steps, so
the lookup still succeeds between two steps; there `state` is `running` and
`runId` names the last finished step's run. `activeRun(text)` keeps the
shipped record shape. A dry-run preview never counts as the command running.

`catalogInfo()` returns a frozen `{ state, status, ready, loading,
fingerprint, generation, token }`. A cached startup catalog is ready at once.
`onCatalogChanged` fires on the first usable catalog of a session and on
every catalog-content or binary-fingerprint change, even when the catalog
JSON is identical. Its payload is `{ catalog, bobVersion, fingerprint,
generation, token, reason }`. Drop cached chip verdicts when `token` changes.

Run records carry `trigger` and optional `{ path, line }` source
provenance: `path` survives only as a vault-relative string of at most 512
characters (no leading slash, drive, or `..`), and `line` only as a
non-negative integer. Each finish also triggers
`bob-command-mode:run-finished` with `{ runId, argv, entryId, outcome,
effect, invalidates, trigger, source }`; start and state updates use
`bob-command-mode:run-started` and `bob-command-mode:run-state`, and catalog
changes use `bob-command-mode:catalog-changed` with the `onCatalogChanged`
payload.

## Bob Emoji

`bob-emoji.api` is version 1. It serves the same tiered search the editor
`:shortcode:` menu uses, plus label suggestions and catalog browsing for the
shared Emoji Slot. Feature-detect the plugin and `api.version >= 1` before
calling it; the api exists even when `EditorSuggest` is unavailable, because
the index builds anyway. Every method is total: it returns empty arrays or
`null` and never throws.

```js
const emoji = app.plugins.plugins["bob-emoji"]?.api;
if (emoji?.version >= 1) {
  const rows = emoji.search("white check mark", { limit: 10 });
}
```

Rows are `{ emoji, name, alias, aliases, category, keywords, matchTier }`
where `name` is the gemoji description, `alias` is the primary alias,
`category` is the gemoji category, and `keywords` are CLDR English keywords
plus TTS names deduped against aliases and tags. `matchTier` is the search
tier (0–6) or `null` for browse, info, and recents rows.

- `search(query, { limit, boost })` ranks with multi-token AND, tiered
  matching, VS16-insensitive single-glyph lookup, and conservative fuzzy.
  `boost` is an array of glyphs (or `{ emoji }` rows) that reorder only
  within a tier.
- `suggestForLabel(label, { limit, exclude })` ranks catalog entries by
  matched label tokens, then tier. `exclude` is an array of glyphs to skip.
- `categories()` returns the 9 gemoji category names in catalog order.
- `browse(categoryId, { limit, offset })` lists one category in catalog
  order. `categoryId` matches case- and punctuation-insensitively.
- `info(glyph)` returns one row for a glyph (VS16-insensitive) or `null`.
- `recents({ limit })` returns the persisted recent rows, newest first.
- `remember(glyphOrRow)` maps a glyph to its primary alias, shares the
  editor's persisted recents, and returns `true` when remembered.

## Bob Chips

`app.plugins.plugins["bob-chips"].api.copyChips` is namespace version 2.
It is frozen and never throws. Feature-detect the plugin and namespace
before calling it. During the transition, Bob Navigation Hotkeys checks
`bob-chips`, then the retired `bob-copy-chips` id; Bob Chips disables a
loaded old plugin after layout ready without changing the enabled list.

```js
const plugins = app.plugins.plugins;
const copyChips = (plugins["bob-chips"] ?? plugins["bob-copy-chips"])?.api?.copyChips;
const nav = app.plugins.plugins["bob-navigation-hotkeys"]?.api;
if (copyChips?.version >= 2) {
  const task = nav?.version >= 3 && nav.taskScope?.version >= 1
    ? nav.taskScope.at({ lines, line })
    : null;
  const hit = copyChips.chipAt({
    lines,
    line,
    ch,
    ...(task ? { scope: { kind: "task", lines: task.lines } } : {}),
  });
  if (hit.state === "ready") await copyChips.copy(hit.chip.text);
}
```

Coordinates are zero-based lines and UTF-16 offsets. An inline chip's
`from` / `to` are line-relative, include the delimiters, and end exclusive,
matching `scanLine`. A ready inline chip is frozen
`{ form: "inline", label, text, line, from, to }`. A ready block chip from a
`bob-copy` fence is frozen `{ form: "block", label, text, line, from, to }`
where `line` is the cursor line for cursor results or the opening line for a
task-scope fence; `count` is the number of eligible chips on the resolving
line or in the task. Ready and ambiguous results add `scope: "cursor"` or
`scope: "task"`; `none` keeps its exact shape. A v1 provider ignores
`scope`, so feature-detect version 2 before passing it. Invalid inputs yield
`{ state: "none", count: 0 }`. Non-`bob-copy` fenced lines stay `none`.

| Member | Contract |
| --- | --- |
| `version` | `2` |
| `parse`, `scanLine`, `serialize` | Existing grammar behavior |
| `parseFenceInfo`, `fencePayload` | Existing additive helpers |
| `fencePayloadFromSource(source)` | Processor `source` to payload, verbatim |
| `chipAt({ lines, line, ch, scope? })` | Frozen none/ambiguous/ready result above |
| `copy(text)` | Promise of `{ ok, reason? }`, never throws/rejects |
| `copyChip(chip, { view? })` | One clipboard write plus success/failure feedback |
| `flash(chip, { view? })` | Boolean success feedback shown; no write |

`copyChip` locates the matching widget in the supplied editor view; two
identical payloads at different positions stay independent. A revealed source
span uses a short-lived `StateEffect` / mark-decoration flash in
`--bob-yank-flash-bg`. A failed visual lookup never turns a successful
clipboard write into a false failure.

### Command chips

`app.plugins.plugins["bob-chips"].api.commandChips` is namespace version 1,
beside the unchanged `copyChips` v2. It is frozen and never throws. The
grammar members are pure. The editor-bound `targetAt` and `runAtCursor`
are additive; detect them with `typeof`.

```js
const commandChips = app.plugins.plugins["bob-chips"]?.api?.commandChips;
if (commandChips?.version >= 1) {
  const task = nav?.version >= 3 && nav.taskScope?.version >= 1
    ? nav.taskScope.at({ lines, line })
    : null;
  const hit = commandChips.chipAt({
    lines,
    line,
    ch,
    ...(task ? { scope: { kind: "task", lines: task.lines } } : {}),
  });
  if (hit.state === "ambiguous") new Notice(hit.message);
}
```

| Member | Contract |
| --- | --- |
| `version` | `1` |
| `parse(content)` | `run:` grammar over normalized span content: frozen `{ label, text }` or `null` |
| `scanLine(line, { table? })` | Frozen command chips only, `{ from, to, raw, label, text }`, the copy `scanLine` shape |
| `parseFenceInfo(info)` | `bob-run` info string: frozen `{ label }` or `null` |
| `fencePayload(bodyLines)` | Body lines joined with LF, verbatim |
| `serialize({ label, text }, { table?, indent? })` | Frozen `{ ok: true, form, markdown }` or `{ ok: false, reason }`; a multi-line payload in a table cell is refused |
| `chipAt({ lines, line, ch, scope? })` | The ⌘↵ target rule in [Bob Chips](https://bobs-org.github.io/reference/plugins/bob-chips/) |
| `targetAt(view)` | ⌘↵'s target in a CM6 view, `Editor`, or `{ editor, file }`, from cached verdicts: frozen `none` (`skipped` names a copy-only context), `ambiguous`, `blocked` with `reason`, or `ready` with `chip`, `via`, `running`, `loading`, `key` |
| `runAtCursor(view)` | Promise of frozen `{ handled, outcome, stage, reason }`: `none` is unhandled, a refusal shows one Notice, and `ready` activates the chip, settling after the run |

`chipAt` returns one of three frozen shapes:

- `{ state: "none", count: 0 }`;
- `{ state: "ambiguous", count, via: "line" | "task", message }`;
- `{ state: "ready", count, via: "fence" | "cursor" | "line" | "task", chip }`.

An inline chip is `{ form: "inline", label, text, line, from, to }`, with
the copy-chip coordinates. A `bob-run` block chip adds
`fence: { open, close }`, the zero-based opening and closing lines. `close`
is `null` for an unclosed fence. `line` is the cursor line for a `fence`
result and the opening line for a `task` result, and `[from, to)` covers
that line. `count` is the line's command-chip count for `cursor` and `1`
for other ready results. `scope` is `copyChips.chipAt`'s
`{ kind: "task", lines }`; one that does not own the cursor line is
ignored. Bob Navigation Hotkeys' ⌘↵ dispatcher calls `runAtCursor` first
and stops on `handled`; its `commandChipDispatch = 1` flag gates the keycap
and the `⌘↵ Gmail` yield.

### Command-chip runtime (internal)

Bob Chips fragments share this runtime; it is not part of
`api.commandChips`. `plugin.commandChipRuntime` holds one
`CommandChipRunStore`, one resolve cache, and one
`bob-command-mode:catalog-changed` subscription.

- **Policy.** `commandChipEligibility(app, ctx)` returns frozen
  `{ mode: "run" | "copy", reason, sourcePath, engine }`. Copy wins for a
  root `mail/`, `ref/`, `ref_history/`, `.bob/`, or `_conflicts/` note (any
  case); for an absolute, `..`, malformed, or missing path; for a `query`
  origin without `sourceVerified: true`; on mobile; and without an enabled
  Command Mode 0.4+. `ctx.resolveSourcePath()` wins over `ctx.sourcePath`.
- **Painting.** `commandChipPaintModel(plugin, chip, ctx)` returns frozen
  `{ face, mode, reason, verdict, key, snapshot, armed, sourcePath }` with
  no side effects. `face` is `copy`, `queued`, `running`, `completed`,
  `attention`, `failed`, `loading`, `unavailable`, `armed`, or `ready`.
  Verdicts are cached per engine, catalog token, and payload; `loading` is
  never cached. Repaint from `commandChipOnCatalogChanged(plugin, fn)` and
  `store.subscribe(key, fn)`; both return unsubscribe functions.
- **Store.** Keys are the canonical signature, or `text:` plus the payload
  while loading. `snapshot(key)` is frozen `{ state, kind, runId,
  sequenceId, step, total, steps, outcome, reason, exitCode, stoppedAt, … }`.
  `state` is `idle`, `pending` (paint as resting), `queued`, `running`,
  `completed` (idle after 1.6 s), `attention`, or `failed`; the last two
  persist until the next run. `setArmed(target)`, `armedTarget()`, and
  `isArmed(identity)` serve keymap. A target is `{ key, sourcePath, form,
  line, from, to, fence? }` in `chipAt` coordinates (block chips match on
  `fence.open`), so equal commands in two notes share run state but arm
  separately.
- **Activation.** `commandChipActivate(chip, ctx)` settles frozen
  `{ action, ok, stage, outcome, reason, runId, sequenceId, signature }`.
  `ctx` carries `plugin`, the source path, zero-based `line`, `origin`,
  `view`/`element`, `shift`, `alt`, `edit()`, `refresh()`, and stale evidence:
  `checkSource()`, a Live Preview `range: { from, to, raw }`, or
  `readSource()` plus a line-relative `snapshot`. Copy contexts copy byte-exact.
  Otherwise it resolves afresh and takes a per-key latch (≥ 400 ms,
  through acceptance) before any await. Then it rechecks the source, policy,
  and verdict, and calls `runText` or (Shift) `openText` with only
  `{ source, onState }`. A live key opens its output once per latch window;
  a pending one swallows the gesture. Invalid, unavailable, and refused
  activations show one Notice. Cards and previews restore the prior ink;
  failures never retry. Alt calls `edit()`. Nothing calls task or walk APIs.
- **Face.** `commandChipBuildInline(doc, chip, { interactive })` builds the
  shared `.bob-run-chip`: a `<button type="button">`, or a focusable
  `role="button"` span. `commandChipPaint(host, paint)` repaints it in place.
  `commandChipMount(plugin, host, chip, { context, paint?, gestureHost?, editable? })`
  subscribes to the run key and catalog changes and wires gestures; the
  `bob-run` card passes its painter and Run button. `context()` returns
  fresh evidence without `plugin` or `element`. `commandChipUnmount(host)`
  never touches the run. Live Preview reads the note from its own
  `editorInfoField`. When set, `plugin.commandChipRunHotkey` adds the key to
  the tooltip.
- **Reading.** The one post-processor mounts `run:` buttons with one
  `MarkdownRenderChild` per pass. `context()` reads the button's ancestors
  each call: `li.plugin-tasks-list-item` with `.task-description`, or
  `li.dataview.task-list-item`/`task-list-basic-item`, is a verified `query`
  row whose render `sourcePath` is the owner; other `block-language-*` or
  `.dataview` output is unverified. Embeds and popovers keep their render
  path. Detached buttons without section info stay copy-only until
  `onNodeInserted`. Section info yields `snapshot`; otherwise `checkSource()`
  needs the span somewhere in the note.

## Related

- [Block ID Prompt](https://bobs-org.github.io/reference/plugins/block-id-prompt/)
- [Bob Ledger Tools](https://bobs-org.github.io/reference/plugins/bob-ledger-tools/)
- [Bob Navigation Hotkeys](https://bobs-org.github.io/reference/plugins/bob-navigation-hotkeys/)
- [Task Status Cycler](https://bobs-org.github.io/reference/plugins/task-status-cycler/)
- [Plugin architecture](architecture.md) — generated sources and module boundaries.
- [Bob Command Mode](https://bobs-org.github.io/reference/plugins/bob-command-mode/)
