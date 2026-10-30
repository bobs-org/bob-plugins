---
title: "Cross-plugin APIs"
description: "Reference for the versioned runtime interfaces shared by Bob plugins."
---

Plugins communicate through a loaded plugin's `api` object,
available under `app.plugins.plugins["<plugin-id>"]`. They do not
import one another's generated `main.js` files. Consumers should
feature-detect both the provider and the method or namespace they need; an
unloaded plugin is not a usable dependency.

API objects are additive compatibility surfaces. Check a namespace's own
`version` when it has one instead of assuming every namespace
changes with the root version. Guard cross-plugin calls and handle failure
results.

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
`themeIntent: { deliberate, linkOnce, shown, tabPick? }` on the committed choice:
`deliberate` is true when the committed row differs from the suggested default
or a query is typed (Shift+Enter named commits are always deliberate, Alt+Enter
keep-type commits never are), `linkOnce` is true only for Alt+Enter, `shown`
is the suggestion actually presented (or null), and `tabPick` is the cycled
composite type key after Tab. Ctrl+Shift+Enter consumes that intent in the
existing task-line edit after revalidating a present `shown` against a fresh
`suggestFor`; a missing `shown` retypes from the live suggestion. Enter applies
`planRetype`. Alt+Enter is the keep-type merge and does not write a field. A
stale shown suggestion skips the field. Picks without task context keep the
legacy shape, and a malformed optional intent is dropped so it can never
enable a write. The namespace version stays 1.

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

| Namespace | Version | Purpose |
| --- | ---: | --- |
| `stats` | 2 | Append validated review events; `host`, `fetch`, and `bobPath` support Stats and consumers. |
| `themes` | 1 | Share the Pomodoro theme catalog; `hueFor`, `componentsOf`, `historyRows`, and `similarTo` are synchronous, `fetch` and `snapshot` serve the cached `bob themes list` report, `hide`/`unhide`/`color`/`rename` spawn bob with `--via`, and `onChange` subscribes to updates. |
| `workBadges` | 2 | Return count-to-limit badge tones through `tone` and `todayTone`. |
| `freshness` | 12 | Read or update freshness, refresh intervals, keep counts, review queue, and unblocked metadata. |
| `noteReady` | 1 | Read per-note Ready-lane counts and render the crowded-note chip. |
| `dashboardCollections` | 1 | Snapshot or render PROJECTS and REFERENCES badges. |
| `laneWalk` | 2 | Serve the Pending/Next/Ready-off-Today walk list behind `]w` / `[w` and `]W` / `[W`. |
| `priorityMarks` | 1 | Model and render priority marks. |
| `dateMarks` | 1 | Model and render canonical date marks. |
| `progressMarks` | 1 | Refresh the display-only In Progress Task Link mark. |
| `unblockedGlyph` | 1 | Refresh the display-only unblocked hand-off glyph. |
| `relationIndex` | 1 | Read the live, source-authoritative task relation index and label suggestions. |
| `relationLabels` | 1 | Read the relation-label catalog and delegate hide, unhide, and previewed rename writes to bob. |

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

The v1 namespace also exposes synchronous task-theme helpers:
`suggestFor({ path, line, text? })`, `taskThemeOf(text)`,
`setTaskTheme(text, name)`, `clearTaskTheme(text)`, and `isKnownTheme(key)`,
plus the additive
task-type routing surface: `effectiveTypeFor(request)`,
`typeComponentsOf(name)`, `typeAgrees(taskKey, entryName)`,
`planRetype(options)`, `planPlacement(options)`, and
`planRelocation(options)`. `suggestFor` uses a
vault-relative `path`, a one-based integer line number, and optional full live
Markdown text. When `text` is omitted it reads that line only from an open
editor whose path matches; it returns `null` when the path/line cannot be read
or no rule suggests a theme. It never substitutes another active note or
stale Tasks metadata. Suggestions contain the Rust `ThemeRef` shape and
`source`/`label`; only note suggestions have `from`, and task-field suggestions
always have `inherited`, including `null`. A valid task `[root:: NOTE]` field
starts the note-default walk at that note; a field needing repair falls back
to the task's own residence. A repaired theme field adds
`repair: "duplicate" | "invalid"` only when a suggestion remains. After the
note walk finds nothing, the cascade falls through to `plan.default_type`
(source `default`, label `default type`); `off` stops the note walk but still
falls through to the default. A note whose `task_type:` and legacy `theme:`
defaults disagree reports a `type_default_conflict` warning through the same
channel as `theme_default_invalid`, and `task_type:` wins. `from`
contains the declaring note's path, lowercase stem, `area`/`project` kind,
root-area hue when available, and the residence-to-declarer path chain.
Rust-compatible serialized `ThemeRef` values omit `known` when true and omit
`configured` when the catalog has no configured vocabulary.

`taskThemeOf` returns `{ state: "none" }`,
`{ state: "set", value, key, fields }`, or
`{ state: "repair", repair, fields }`; field spans use JavaScript UTF-16
offsets. The parser accepts the `type` and `theme` keys in both
`[key:: value]` and `(key:: value)` forms with Rust's spacing and name rules;
two or more type-ish fields on one line are the `duplicate` repair state.
`setTaskTheme` emits `[type:: NAME]` and removes both spellings; the two
setters return rewritten strings and do not write the vault.
`effectiveTypeFor(request)` runs the same cascade as `suggestFor` (field,
reading task, note defaults, then `plan.default_type`) and returns the full
suggestion or `null`. `typeComponentsOf(name)` returns `{ name, key, isType }`
rows per D4. `typeAgrees(taskKey, entryName)` answers the D5 invariant; a
missing type always agrees. `planRetype({ effective, effectiveName?,
inherited, destination, selector?, keepType?, tabPick?, sources? })` returns
`{ kind }` with `container`, `consistent`, `merge`, `set`, or `clear`
outcomes per D6; `effective` and `inherited` accept suggestion objects or keys.
`planPlacement({ type, typeName?, entries, alreadyQueued?, ...overrides })`
returns `entry`, `create`, `refused`, `alreadyQueued`, or `noType` per D7, and
`planRelocation({ entries, liveLink, type, typeName?, ...overrides })` returns
`unchanged`, `renameEntry`, `appendComponent`, `moveTo`, `renamePlaceholder`,
`createBelow`, or `refused` per D8. Vocabulary, exempt, and inventory come
from the configured-rows snapshot and plan caps; `exempt`, `ledgerKeys`,
`themesBefore`, `cap`, and `strict` accept explicit overrides. None of the
routing methods spawns bob, writes the vault, or throws: unusable input
resolves to `null` (`typeComponentsOf` resolves to `[]`, `typeAgrees` to
`true`).

`isKnownTheme(key)` is synchronous and read-only. It checks the cached theme
catalog and today's Pomodoro names, preferring an open daily editor so unsaved
components count immediately. Hidden names remain known. Suggestion warnings
such as invalid note defaults are available from the exported pure resolver
helper for contract tests; `suggestFor` returns only a suggestion or `null`,
not a command-response envelope. All additions are additive under
`themes` v1; the root API remains v3.

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
| `reviewWalk` | 1 | Capture a review landing with `capture(editor)`, then continue it after a gesture with `continue(origin, outcome)`. |
| `inboxRoute` | 1 | Test an inbox path and prompt or commit a route. |
| `quickRoll` | 1 | Preview the `Alt+P` roll for a review row. |
| `taskLinkLane` | 1 | Match a Pomodoro Task Link and toggle its Next/In Progress lane. |
| `notice` | 1 | Show the Unblocked card. |
| `successors` | 1 | Ask which offered successor links to add. |
| `blocks` | 1 | Open the reverse Blocks stage or remove a dependent. |
| `relations` | 0 | Remove a LINKS edge (`removeLink`). `openStage` opens the Links direction; the reverse direction settles `{ ok: false }` until both stage directions ship. |
| `openReferencePdf(path)` | Additive member | Open a vault-relative PDF in Highlights; resolves `{ ok, reason? }`. |
| `openFileInActiveLeaf(file)` | Additive member | Save and verify the current note before opening a Markdown file in the active leaf; reports `{ ok, reason? }` and checks for a clobbered landing. |
| `openDependencyStage(ref)` | Root method | Open the task's dependency stage. |
| `removeDependency(parentRef, target)` | Root method | Remove the requested prerequisite. |
| `claimReviewWalkCompletion(editor)` | Root method | Claim completion handoff for a landed review row. |

`inboxRoute` has `isInboxNote(path)`,
`prompt(request)`, and `commit(request)`.
`quickRoll` has `keyLabel` (`Alt+P`) and
`preview({ content | lines, line, tier })`. `preview` is synchronous
and never throws: it plans the same recommendation `Alt+P` would use
and returns the frozen `{ ok, kind, line, compact, detail }` preview
(`kind` is `roll`, `decay`, `cancel`, or `assign`; unprioritized tasks
now preview), or `{ ok: false, reason }` for PRE/POST rows and lines
with no recommendation. With a null plugin (after unload) it returns
`{ ok: false, reason: "unavailable" }`; the root api `version` stays 3.
`taskLinkLane.matches({ content, line, path })` is synchronous;
`toggle(args)` performs the Next/In Progress change and resolves
to a result object. `successors.pick(model)` resolves to a result
with a `picks` array or `null` when no choice is made. Selectable
rows may carry additive `task: { path, line, text, displayText, status,
preimage }` so `Ctrl+Shift+Enter` can retarget through
`pomodoroLinkPicker.pick({ task })`. `line` is one-based and `text` is
the full matching note; `preimage` is the original task line used to
refuse a changed or missing source before the nested picker. Older rows
without `task` still retarget, without permission to edit a task type.
Destination overrides may carry additive `themeIntent` and
`preserveSpelling`. Both navigation's
`normalizeSuccessorDestinationOverride` and the cycler's
`normalizeSuccessorPickDestination` keep a valid intent, drop a
malformed one without rejecting the destination, and let `linkOnce`
override `deliberate`. Marked-row retargets run one picker per target
in displayed order and publish overrides only when every pick succeeds.
The context transport and nested picker never mutate a task field. For a
successor's default destination, the cycler resolves the task's effective
type with `effectiveTypeFor` and asks `planPlacement` to keep a matching
open Pomodoro, select another matching entry, or create the typed entry.
Strict-cap refusal leaves a requested successor unlinked. Default placement
does not edit the task field. An explicit retarget carries a valid deliberate
`themeIntent`; the cycler revalidates `shown` against a fresh
`effectiveTypeFor`, delegates to `planRetype`, and applies
`setTaskTheme`/`clearTaskTheme` after status recovery and before
block-ID/freshness assembly. Link-once, untouched preselection, missing or
changed suggestions, and stale or refused destinations skip the field edit.
`blocks.openStage(ref)` and
`blocks.removeDependent(ownerRef, target)` resolve to result
objects. `relations.removeLink(sourceRef, targetRef)` removes the
authored LINKS edge from the source and best-effort-updates the
target's LINKED FROM mirror; `relations.openStage({path, line,
direction})` opens the owner's Links stage for `direction: "to"` (or an
absent direction) and settles `{ ok: false, reason: "unavailable" }`
otherwise. Callers
feature-detect `api.relations?.version >= 1` before showing chip
controls. `notice.showUnblocked(model)` presents the Unblocked card.

Async navigation methods settle to result objects or `null` rather
than rejecting. `taskLinkLane.matches` is synchronous and
`toggle` settles its result. `reviewWalk.capture` returns
`null` when there is no current landing;
`reviewWalk.continue` resolves its advance result.

## Task Status Cycler

`task-status-cycler.api` is version 3:

- `recoverBlockedDependents(identities, context?)` runs the same
  dependent recovery as task completion without retiring references. It
  resolves to `{ reopened, failures }`; tasks with a strictly
  future `scheduled` date remain Blocked.
  Each identity has `path` and at least one of
  `blockId` or `taskId`. The method never throws; failures are returned in
  the result.
- `completeTaskAtCursor(editor)` completes the cursor task through
  Tasks' `set-status-symbol-to-x` command so recurrence can run; it never
  writes `[x]` directly. It returns
  `{ ok: true, lineDelta, successorNotice }` or
  `{ ok: false, reason }` and does not stamp the task.
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
  successorNotice }` and never throws.

## Bob Command Mode

`bob-command-mode.api.commandMode` is namespace version 1. Consumers should
feature-detect both the plugin and namespace before calling it:

```js
const commandMode = app.plugins.plugins["bob-command-mode"]?.api?.commandMode;
if (commandMode?.version >= 1) {
  const result = await commandMode.run(["plan"]);
}
```

`run(argv, opts)` settles to `{ ok, runId, outcome, exitCode, reason? }`
and does not reject. `openOutput(runId)` opens a run in the pager;
`onRunFinished(callback)` subscribes to finished runs and returns an
unsubscribe function; `catalog()` and `lastRun()` read the cached catalog
and newest record. Each finish also triggers the workspace event
`bob-command-mode:run-finished` with `{ runId, argv, entryId, outcome,
effect, invalidates }`.

## Related

- [Block ID Prompt](https://bobs-org.github.io/reference/plugins/block-id-prompt/)
- [Bob Ledger Tools](https://bobs-org.github.io/reference/plugins/bob-ledger-tools/)
- [Bob Navigation Hotkeys](https://bobs-org.github.io/reference/plugins/bob-navigation-hotkeys/)
- [Task Status Cycler](https://bobs-org.github.io/reference/plugins/task-status-cycler/)
- [Plugin architecture](architecture.md) — generated sources and module boundaries.
- [Bob Command Mode](https://bobs-org.github.io/reference/plugins/bob-command-mode/)
