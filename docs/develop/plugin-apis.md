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
does not reject. Navigation Hotkeys uses this picker for successor offers.

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
| `workBadges` | 2 | Return count-to-limit badge tones through `tone` and `todayTone`. |
| `freshness` | 12 | Read or update freshness, refresh intervals, keep counts, review queue, and unblocked metadata. |
| `noteReady` | 1 | Read per-note Ready-lane counts and render the crowded-note chip. |
| `dashboardCollections` | 1 | Snapshot or render PROJECTS and REFERENCES badges. |
| `priorityMarks` | 1 | Model and render priority marks. |
| `dateMarks` | 1 | Model and render canonical date marks. |
| `progressMarks` | 1 | Refresh the display-only In Progress Task Link mark. |
| `unblockedGlyph` | 1 | Refresh the display-only unblocked hand-off glyph. |
| `relationIndex` | 1 | Read the live, source-authoritative task relation index and label suggestions. |

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
and the active editor's unsaved text. Relation targets are resolved with
Obsidian's link resolver and cached block IDs. Consumers render from this live
index; they do not read the generated `LINKED FROM` mirror as source data.

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
| `taskLinkLane` | 1 | Match a Pomodoro Task Link and toggle its Next/In Progress lane. |
| `notice` | 1 | Show the Unblocked card. |
| `successors` | 1 | Ask which offered successor links to add. |
| `blocks` | 1 | Open the reverse Blocks stage or remove a dependent. |
| `relations` | 0 | Remove a LINKS edge (`removeLink`). `openStage` opens the Links direction; the reverse direction settles `{ ok: false }` until both stage directions ship. |
| `openReferencePdf(path)` | Additive member | Open a vault-relative PDF in Highlights; resolves `{ ok, reason? }`. |
| `openDependencyStage(ref)` | Root method | Open the task's dependency stage. |
| `removeDependency(parentRef, target)` | Root method | Remove the requested prerequisite. |
| `claimReviewWalkCompletion(editor)` | Root method | Claim completion handoff for a landed review row. |

`inboxRoute` has `isInboxNote(path)`,
`prompt(request)`, and `commit(request)`.
`taskLinkLane.matches({ content, line, path })` is synchronous;
`toggle(args)` performs the Next/In Progress change and resolves
to a result object. `successors.pick(model)` resolves to a result
with a `picks` array or `null` when no choice is made.
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

`task-status-cycler.api` is version 2:

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

## Related

- [Block ID Prompt](https://bobs-org.github.io/reference/plugins/block-id-prompt/)
- [Bob Ledger Tools](https://bobs-org.github.io/reference/plugins/bob-ledger-tools/)
- [Bob Navigation Hotkeys](https://bobs-org.github.io/reference/plugins/bob-navigation-hotkeys/)
- [Task Status Cycler](https://bobs-org.github.io/reference/plugins/task-status-cycler/)
- [Plugin architecture](architecture.md) — generated sources and module boundaries.
