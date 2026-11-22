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
| `logs` | 1 | Read the cached `bob logs list --format json` phrase catalog; `snapshot()` includes the session overlay, `noteUsed(kind, text)` records a successful local write, and `onChange` subscribes to refreshes. |
| `themes` | 1 | Share the Pomodoro theme catalog; `hueFor`, `componentsOf`, `historyRows`, and `similarTo` are synchronous, `fetch` and `snapshot` serve the cached `bob themes list` report, `hide`/`unhide`/`color`/`rename` spawn bob with `--via`, and `onChange` subscribes to updates. |
| `workBadges` | 2 | Return count-to-limit badge tones through `tone` and `todayTone`. |
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

The v1 namespace also exposes synchronous task-theme helpers:
`suggestFor({ path, line, text? })`, `taskThemeOf(text)`,
`setTaskTheme(text, name)`, `clearTaskTheme(text)`, and `isKnownTheme(key)`,
plus the additive
task-type routing surface: `effectiveTypeFor(request)`,
`typeComponentsOf(name)`, `typeAgrees(taskKey, entryName)`,
`agreeEntry(input)`, `settleClosed(name, worked)`, and
`agreeLedgerEntries({ path, content, entryLines? })`,
`planRetype(options)`, `planLanding(options)`, `planSplit(options)`,
`mergeNames(base, others)`,
`narrowClosed(name, workedKeys)`, `shed(name, beforeKeys, afterKeys)`,
`planPlacement(options)`, and
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
suggestion or `null`. It accepts `{ path, line, text?, asIfOpen? }`; completed
and cancelled tasks return `null` by default, while `asIfOpen: true` resolves
their stored or inherited type using the same cascade as an open task. This is
for writers that need the task's pre-close type. `typeComponentsOf(name)`
returns `{ name, key, isType }` rows per D4. `typeAgrees(taskKey, entryName)`
answers the D5 invariant; a missing type always agrees. `agreeEntry({ name,
open?, children, sources? })` mirrors the shared name agreement rule and
returns `{ name, added, removed, unrepaired }`; each child is `{ kind:
"live" | "worked" | "unknown" | "prose", key?, name? }`. `settleClosed(name,
worked)` returns the closed session name based on worked `{ key, name }` rows.
`agreeLedgerEntries({ path, content, entryLines? })` asynchronously classifies
the direct children of the selected open entries (all open entries when
`entryLines` is omitted; otherwise one-based ledger lines), resolves task
blocks through the metadata cache and cached or open-editor note text, then
returns `{ content, changed, entries, unrepaired }`. It changes only name
tails in the returned text and never writes a file; unresolved, ambiguous, or
untyped links are reported as unknown and prevent unsupported types from being
dropped. `planLanding({ effective, inherited,
destination, retype?, selector?, tabPick?, sources? })` returns `container`,
`consistent`, `merge`, `set`, or `clear` per R2. `merge` preserves the task
type and returns the merged destination name; `retype: true` takes the
explicit task-field path. MEET uses that path regardless of `retype`.
`planRetype({ effective, effectiveName?, inherited, destination, selector?,
tabPick?, sources? })` remains as a v1 alias for `planLanding` with
`retype: true`. `planSplit({ name, open, linkKeys, splitSelectors?, sources? })`
partitions an open merged Pomodoro by type per R4, returning `ok` with the
remaining name and one created entry per split type (each with its moved
link indices, name-ordered, still created when empty) or an `error` with a
`split_*` code; a null or empty selector set splits every merged-in type.
`mergeNames(base, others)` joins components
in order and keeps the first spelling of duplicates. `narrowClosed(name,
workedKeys)` narrows a closed merged Pomodoro to the worked type components,
retaining labels and source order. `shed(name, beforeKeys, afterKeys)` removes
merged-in types whose last Task Link left, while retaining the base type,
labels, and unlinked types. `effective` and `inherited` accept
suggestion objects or keys.
`planPlacement({ type, typeName?, entries, alreadyQueued?, exempt? })`
returns `entry`, `create`, `alreadyQueued`, or `noType` per D7, and
`planRelocation({ entries, liveLink, type, typeName?, sources? })` returns
`unchanged`, `renameEntry`, `appendComponent`, `moveTo`, `renamePlaceholder`,
or `createBelow` per D8. Vocabulary, exempt, and inventory come from the
configured-rows snapshot and plan config; only `exempt` accepts an explicit
placement override. None of the
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

`inboxRoute` has `isInboxNote(path)`,
`prompt(request)`, and `commit(request)`.
`quickRoll` has `keyLabel` (`Alt+P`) and
`preview({ content | lines, line, tier })`. `preview` is synchronous
and never throws: it plans the same recommendation `Alt+P` would use
and returns the frozen `{ ok, kind, line, compact, detail, parts }` preview
(`kind` is `roll`, `decay`, `cancel`, or `assign`; unprioritized tasks
now preview), or `{ ok: false, reason }` for PRE/POST rows and lines
with no recommendation. `parts` is additive (`keyLabel`, `verb`, `fromLabel`,
`toLabel`, `step`, `limit`); joining it rebuilds `compact` exactly (`roll` and
`assign` join `toLabel`, `decay` joins `fromLabel→toLabel`, a limited roll adds
`step/limit`). With a null plugin (after unload) it returns
`{ ok: false, reason: "unavailable" }`; the root api `version` stays 3.
`taskLinkLane.matches({ content, line, path })` is synchronous;
`toggle(args)` performs the Next/In Progress change and resolves
to a result object. `logRecall.attach({ inputEl, kind, bandHost, density,
arrowKeys, ownKeys })` returns `handleKeydown`, `backOut`, `isRecalling`,
`setKind`, and `detach`; standalone modals set `ownKeys: true`, while picker
pipelines set it to false and call `handleKeydown` once. Passing additive
`links: true` (plus `sourcePath`) returns a `proseField` handle instead: the
same keys, plus `isLinkOpen()`, `rebind`, and `setSourcePath`. Older nav
ignores `links` and attaches recall only. `logRecall.noteUsed`
forwards a successful local write to Ledger Tools `logs.noteUsed`. Feature-detect
`api.proseField` with `Number(api.proseField.version) >= 1`. `proseField.attach`
takes `inputEl`, `bandHost`, `sourcePath` (`string | null | () => string | null`),
`recall`, `links`, `tasks` (defaults to `links`), `subjects`, `mode` (`inline` | `field`), `minOffset`, `density`, `ownKeys`,
and `scope`. v2 adds `isTaskOpen()`, `isNaming()`, and `setSubjects(next)`; `isLinkOpen()` covers both modes. The root api version stays 3. Enter and Tab accept a row while the
LINK band is open and never submit the prompt; only an Enter accept swallows
the held Enter. Hosts whose listeners run first (the Record Card) attach with
`ownKeys: false`, call `backOut()` as their first Esc rung, and offer every key
to `handleKeydown` first. Completion only inserts text. `successors.pick(model)` resolves to a result
with a `picks` array or `null` when no choice is made. Selectable
rows may carry additive `task: { path, line, text, displayText, status,
preimage }` so `Ctrl+Shift+Enter` can retarget through
`pomodoroLinkPicker.pick({ task })`. `line` is one-based and `text` is
the full matching note; `preimage` is the original task line used to
refuse a changed or missing source before the nested picker. Older rows
without `task` still retarget without changing a task type.
Destination overrides may carry additive `themeIntent` and
`preserveSpelling`. Both navigation's
`normalizeSuccessorDestinationOverride` and the cycler's
`normalizeSuccessorPickDestination` keep a valid intent, drop a
malformed one without rejecting the destination. Marked-row retargets run one picker per target
in displayed order and publish overrides only when every pick succeeds.
The context transport and nested picker never mutate a task field. For a
successor's default destination, the cycler resolves the task's effective
type with `effectiveTypeFor` and asks `planPlacement` to keep a matching
open Pomodoro, select another matching entry, or create the typed entry.
Strict-cap refusal leaves a requested successor unlinked. Default placement
does not edit the task field. An explicit retarget carries a valid deliberate
`themeIntent`; the cycler revalidates `shown` against a fresh
`effectiveTypeFor` and delegates to `planLanding`. The default merge updates
the destination Pomodoro name alongside the new Task Link; Alt+Enter delegates
to `setTaskTheme`/`clearTaskTheme` after status recovery and before
block-ID/freshness assembly. Untouched preselection, missing or changed
suggestions, and stale or refused destinations skip the type and name change.
`successors` v2 (keep-moving, `docs/task-dependencies.md` §12.13 and
§12.15 in bob-cli) adds a fourth group, `keep_moving`, which offers a
leaf project's ready tasks when a close drains its last planned task. A
group may carry a `caption` (the why line) and a `tag` (the contrast tag,
right-aligned on the heading), and its `folded` counts gain `blocked` and
`scheduled`. A `keep_moving` group folds into one
`2 blocked · 1 scheduled later · 1 hidden` line. Rows may carry a `lane`
(`Pending`, `Next`, `Ready`, or `Blocked`); every group shows the lane name
and derives it from `status` when `lane` is absent, so a raw status symbol is
never displayed. When every group is `keep_moving` the title (if the model
omits one) is `Keep ‹N› moving` / `Keep 2 projects moving` and the header icon
is `skip-forward`. Unknown groups are still dropped and v1 models render
exactly as before. Callers must offer `keep_moving` groups only when
`api.successors?.version >= 2`, because an older navigation drops the group.
`successors` v3 (relation successors, `docs/task-dependencies.md` §12.13 and
§12.18 in bob-cli) adds a fifth group, `relation`. A relation group carries
`header`, `caption`, `tag`, and `foldText`; `after: {notePath, blockId, text}`;
`event: "parked"|"done"`; and `label`. `folded` may include `alreadyStarted`
and `waitsFor`. A row on any group may carry `suffix` (several triggers) and
`reason` (a second reason). The relation group uses a neutral left accent and
the `link-2` icon; when every group is `relation` the modal title is the model
title (or `‹Label› “‹T›”` / `‹Label› k tasks`) and the header icon is
`link-2`. Unknown groups are still dropped and v1/v2 models render exactly as
before. Callers must offer `relation` groups only when
`api.successors?.version >= 3`.
`successors` v4 (offer verdicts, `docs/task-dependencies.md` §12.22 in
bob-cli) keeps every v3 group and adds per-row verdicts. A model may carry
`close: { supported: true }` and each row an engine-authored `close`
descriptor (`complete`, `cancel`, `why`, `completeConsequence`,
`cancelConsequence`, `scopeNote`, `unblocks`); the normalizer keeps row
`close` only when the model carries support, so v3-shaped models render
exactly as before. `pick(model)` resolves
`{ picks: [{ key, destination? }], closes: [{ key, outcome: "done" |
"cancelled", reason? }] }` or `null`. `null` still means no commit (Esc,
discard, click-outside, unload, or a second picker); zero picks with at
least one close is a commit, never `null`. Closes are re-filtered to keys
whose descriptor allows that outcome and never overlap picks. The card
stages one verdict per row (Leave, Pull in, Done, Cancel) with `Ctrl+X` /
`Ctrl+Shift+X` on literal Control, an optional inline Cancel reason, a
two-step Esc, hover buttons, and the `pull in {a} · ✓ {b} done · ⊘ {c}
cancel` footer; the task-merge card never receives `close` and stays
pull-in-only. Callers attach `close` descriptors only when
`api.successors?.version >= 4`.
`successors` v5 adds opt-in `jump: { supported: true }` to v4
(`docs/task-dependencies.md` §12.24); only exact `true` survives
normalization. Ctrl+J pins the highlighted keyed, selectable row without
moving it; muted rows, folds, and empty lists refuse. Pins suppress highlight
fallback and permit `{ picks: [], jump: { key } }`. Invalid pins drop; a result
is non-null only with picks, closes, or a valid jump. Supported cards show a
solid `Jump` capsule, hover button, `jump target` suffix, Ctrl+J chip, and
truncated `· ↗ “S”` summary. Opt in at `api.successors?.version >= 5`.
`taskSplit` v1 carries one task requirement into its own task.
`carryReq({ notePath, line, expectedLine?, expectedOwnerPreimage? })`
resolves to `{ ok: true, task, moveMap, restores, notice, cursor }` or
`{ ok: false, code, message, failedPaths? }`. `line` and the returned
`task.line` are one-based; `task` is `{ path, line, blockId, text }` and
`moveMap` is `{ sourcePath, destinationPath, moves }` with one-based line
moves. `restores` holds exact before/after snapshots plus `created` flags
for every changed file, so one guarded Undo restores the whole batch.
`expectedLine` is the digest of the requirement line the caller saw and
`expectedOwnerPreimage` is the exact owner-block text it saw; both refuse
as `split_stale_ref` when the note moved underneath the caller. Missing or
non-requirement targets refuse as `split_owner_missing` or `not_a_req`;
an unavailable writer refuses as `split_unavailable`. The API never
navigates and never shows an Undo notice: the standalone `Ctrl+Shift+T`
command owns its notice and landing, and the close card owns the batch
receipt. Feature-detect the namespace with
`Number(api.taskSplit?.version) >= 1`.

`successors` v6 adds `requirements` groups before ordinary successor groups
(`docs/task-dependencies.md` §12.25 in bob-cli). A group has
`group: "requirements"`, `kind: "requirements"`, snapshot-bound `owner`,
canonical `copy` and `folded`, plus rows with the `offer`, `req`, and
`consequences` objects from bob. Requirement-only models need no ordinary
offer, close descriptor, or destination. The normalizer preserves these
objects and adapts each row to the picker shell at one boundary.

Requirement rows use `Ctrl+X` for Met, `Ctrl+Shift+X` for Drop with the
optional `Why drop it? (optional)` Log Recall field, `Ctrl+Shift+T` for Carry,
and `Space`/`Tab` for Carry plus pull-in (`Tab` advances). Repeating a choice
returns the row to Met. A structural choice folds its descendants while
retaining their staged choices; conflicting descendant choices remain visible
with the canonical ancestor message and block submission until resolved.
`Ctrl+A` never selects requirement rows. `Ctrl+J` pins a requirement row for
navigation only. The footer shows `reqs ✓N ⊘N →N`.

`pick(model)` adds `reqs: [{ key, verdict, reason? }]` to the existing result;
`verdict` is `met`, `drop`, `carry`, or `carry_pulled`. Default Met is
unstaged, while explicit Met remains a keyed result for validation. A req-only
or pin-only result is non-null and may carry an empty `picks` array. Callers
must offer requirement groups only when `api.successors?.version >= 6`; older
pickers continue to receive v5 models.
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
`notice` v2 reads an optional `keep_moving` row array (the same row shape as
`unblocked`, with `trigger: "last_planned"` and an `offer.project`). Only
picked rows (those with a `link`) are shown. When every row is keep-moving the
card reads `Keep ‹N› moving` with ⏭ in the glyph slot and the class
`is-keep-moving`; in a mixed card the keep-moving rows follow the dependency
rows with a `keeps ‹N› moving` chip and count as linked. A card with nothing
picked is silent. Callers add `keep_moving` rows only when
`api.notice?.version >= 2`.
`notice` v3 reads optional `relation_successors` and `relation_held` rows plus
`relation_check`. An all-relation card uses `‹Label› “‹T›”` as its title, 🪢
in the glyph slot, and the class `is-relation`. Mixed cards add a
`‹label› “‹T›”` chip; relation picks count as linked. The receipt reads
`✓ ‹T›` for done and `‹T› parked` for parked. Held-only and unavailable
checks use the muted copy from §12.18. Older payloads still render as before.
Callers add relation rows only when `api.notice?.version >= 3`.
`notice` v4 additionally reads `offer_closes` (`outcome`, `text`, `message`, and
`recovered` rows), `offer_close_refused` (`count`, `rows: [{text, why}]`), and
`undo: { restores: [{path, before, after}] }`. It renders Done / Cancel receipts,
`↳` tickler rows, a refusal line, and a guarded `Undo closes` action. The action
restores only when every note still matches the recorded postimage. Older payloads
retain the v3 rendering. v5 appends a trailing `↗ “S”` from `jump.label`
(`api.notice?.version >= 5`). v6 reads `req_outcomes` (`verdict`, `receipt`,
`row_key`) and `req_met` (`owner_key`, `count`, `receipt`) from the
requirement close apply service. A req-only card shows those receipts and a
guarded `Undo` action from `undo.restores`. Mixed cards keep `Undo closes`
and append the requirement receipts. Older payloads still render as before.
Callers add requirement receipts when `api.notice?.version >= 6`.

`cancel` v1 exposes the pure `planCancel(content, targets, {date, reason})` planner.
Each target is `{line, rawLine}` from the source shown to the user. It wraps the Task
Card cancel planner and fixes the blank-reason fallback to `🤷 no reason given`; blank
reasons write that fallback only when the task already has a Cancel Log. Callers write
the returned content through their own transaction.

Async navigation methods settle to result objects or `null` rather
than rejecting. `taskLinkLane.matches` is synchronous and
`toggle` settles its result. `reviewWalk.capture` returns
`null` when there is no current landing;
`reviewWalk.continue` resolves its advance result. v2 parks then lands when
`outcome.follow` is set (`{ok, advanced: false, parked, landed}`); stale
origins still land, and without `follow` v1 is unchanged.

The persisted family rides additive nav `api.walkMode` (root `version` stays 3):
v4 `current()`/`select("b")` and `setAttention` for `"s"`/`"b"`; v5 adds `"w"`;
v6 paints selected-family attention as letter ink and off-family as a dot.
Ledger feature-detects `walkMode.version >= 4` before `b` and `>= 5` before `w`.

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
  `{ ok: false, reason }` and does not stamp the task. With
  `options.successorJumpTarget === "return"`, a compatible pinned successor is
  returned as `jump` for the walk owner to follow.
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
  supplied, it maps vault-relative paths to the exact pre-write text.
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
