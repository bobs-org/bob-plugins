// --- Task freshness: evaluation ---------------------------------------------
// Computed at read time, never stored. Mirrors `state.rs`; both sides run
// the state (S) conformance vectors in `docs/freshness.md` verbatim.

// Parse a note's raw `task_refresh` frontmatter value: an integer 1-365
// (numbers stay numbers, quoted strings are unquoted), else a
// `task_refresh_invalid` lint that falls through to the next level.
function freshnessParseNoteRefresh(raw) {
  if (raw === undefined || raw === null) {
    return { days: null, lint: null };
  }
  const text = String(raw)
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (text === "") {
    return { days: null, lint: null };
  }
  if (!/^[+-]?\d+$/.test(text)) {
    return { days: null, lint: "task_refresh_invalid" };
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 365) {
    return { days: null, lint: "task_refresh_invalid" };
  }
  return { days: number, lint: null };
}

// Lane for one row: pending for `/`, next for `*`, ready for the
// Tasks status type TODO, none otherwise. Mirrors `lane_for_row` in
// `src/native/freshness/state.rs`.
function freshnessLaneForRow(statusSymbol, isTodo) {
  if (statusSymbol === "/") {
    return "pending";
  }
  if (statusSymbol === "*") {
    return "next";
  }
  if (isTodo) {
    return "ready";
  }
  return null;
}

// Exact, case-insensitive checklist tags from the Tasks tag list. PRE
// wins when both tags are present; prefixes, subtags, and tag text in a
// description never qualify.
function freshnessChecklistForTags(tags) {
  const tokens = new Set(
    (Array.isArray(tags) ? tags : [])
      .filter((tag) => typeof tag === "string")
      .map((tag) => tag.trim().toLowerCase()),
  );
  if (!tokens.has("#gtd")) {
    return null;
  }
  if (tokens.has("#pre")) {
    return "pre";
  }
  return tokens.has("#post") ? "post" : null;
}

// Lane interval for one lane: the configured `pendingInterval` /
// `nextInterval` (absent means the default 1); null means that lane is
// not walked (`false` off-switch).
function freshnessLaneIntervalDays(config, lane) {
  if (lane === "pending") {
    const raw =
      config && config.pendingInterval !== undefined
        ? config.pendingInterval
        : 1;
    return raw === null ? null : raw;
  }
  if (lane === "next") {
    const raw =
      config && config.nextInterval !== undefined ? config.nextInterval : 1;
    return raw === null ? null : raw;
  }
  return null;
}

// Effective interval and where it came from. A configured tracker
// interval wins for that tracker type (source `project` |
// `reference`). Otherwise a lane task in a walked lane uses that
// lane's interval (source `pending` | `next`), overriding the whole
// Ready chain below. Otherwise the task's `[refresh:: N]`, then the
// note's `task_refresh`, then `freshness.interval`, then 7. Mirrors
// `evaluate` + `interval_for` in `src/native/freshness/state.rs`.
function freshnessTrackerIntervalFor(config, tracker) {
  if (tracker === "prj") {
    const days =
      config && Number.isInteger(config.projectInterval)
        ? config.projectInterval
        : null;
    if (days !== null) {
      return { days, source: "project" };
    }
  } else if (tracker === "ref") {
    const days =
      config && Number.isInteger(config.referenceInterval)
        ? config.referenceInterval
        : null;
    if (days !== null) {
      return { days, source: "reference" };
    }
  }
  return null;
}
function freshnessIntervalFor(taskDays, noteDays, config, lane, tracker) {
  const trackerInterval = freshnessTrackerIntervalFor(config, tracker || null);
  if (trackerInterval !== null) {
    return trackerInterval;
  }
  if (lane === "pending") {
    const days = freshnessLaneIntervalDays(config, "pending");
    if (days !== null) {
      return { days, source: "pending" };
    }
  } else if (lane === "next") {
    const days = freshnessLaneIntervalDays(config, "next");
    if (days !== null) {
      return { days, source: "next" };
    }
  }
  if (taskDays !== null && taskDays !== undefined) {
    return { days: taskDays, source: "task" };
  }
  if (noteDays !== null && noteDays !== undefined) {
    return { days: noteDays, source: "note" };
  }
  const interval =
    config && Number.isInteger(config.interval) ? config.interval : 7;
  const fromConfig =
    Boolean(config && config.intervalFromConfig) || interval !== 7;
  if (fromConfig) {
    return { days: interval, source: "config" };
  }
  return { days: 7, source: "default" };
}

// Pure, never-throwing line interval for nav's refresh row:
// `{ days, source, ready: { days, source } }`. Reads the status from
// the line (quote-aware) and the lane/tracker intervals from
// `config`. `ready` is the interval the task returns to after
// release, including a configured tracker override. A `^prj` in any
// lane shows the Ready-chain interval when no tracker interval is
// set (the weekly reminder never becomes a daily lane review); a
// lane `#ref`/`^ref` row is an ordinary lane row and shows the lane
// interval. Mirrors `docs/freshness.md` §4.
function freshnessIntervalForLine(line, noteRefreshRaw, config) {
  try {
    const text = typeof line === "string" ? line : "";
    const read = readFreshness(text, freshnessTodayFallback());
    const note = freshnessParseNoteRefresh(noteRefreshRaw);
    const blockMatch = / \^([A-Za-z0-9-]+)\s*$/.exec(
      String(text || "").split("\n")[0] || "",
    );
    const blockId = blockMatch !== null ? blockMatch[1] : null;
    const symbol = freshnessTaskStatus(text);
    const lane =
      symbol === "/" ? "pending" : symbol === "*" ? "next" : null;
    // Ref identity counts only in the Ready lane (lane is null
    // here); lane refs take the ordinary lane interval.
    let tracker = null;
    if (blockId === "prj") {
      tracker = "prj";
    } else if (lane === null) {
      if (blockId === "ref" || freshnessLineHasRefTag(text)) {
        tracker = "ref";
      }
    }
    const ready =
      freshnessTrackerIntervalFor(config, tracker) ||
      freshnessIntervalFor(read.refresh, note.days, config, null, null);
    if (tracker !== null) {
      const trackerInterval = freshnessTrackerIntervalFor(config, tracker);
      if (trackerInterval !== null) {
        return {
          days: trackerInterval.days,
          source: trackerInterval.source,
          ready: { ...ready },
        };
      }
    }
    if (lane !== null && tracker === null) {
      const days = freshnessLaneIntervalDays(config, lane);
      if (days !== null) {
        return { days, source: lane, ready: { ...ready } };
      }
    }
    return { days: ready.days, source: ready.source, ready: { ...ready } };
  } catch (error) {
    return {
      days: 7,
      source: "default",
      ready: { days: 7, source: "default" },
    };
  }
}

function freshnessEvaluateValidScheduled(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatLocalDate(value);
  }
  return parseFreshDateStrict(String(value).trim());
}

// The earliest of the row's valid `scheduled`, `due`, and `start`
// dates (Tasks' "happens" date); null when it has none of them.
// Mirrors `occurs_on` in `src/native/freshness/state.rs`.
function freshnessOccursOn(row) {
  const safe = row && typeof row === "object" ? row : {};
  const dates = [
    freshnessEvaluateValidScheduled(safe.scheduled),
    freshnessEvaluateValidScheduled(safe.due),
    freshnessEvaluateValidScheduled(safe.start),
  ].filter((date) => date !== null && date !== undefined);
  if (dates.length === 0) {
    return null;
  }
  dates.sort();
  return dates[0];
}

// Recurring overlay (`docs/freshness.md` §4): an open, visible,
// non-checklist recurring row whose occurrence date has arrived
// walks in RECURRING. Applied after the checklist logic at the
// single `freshnessEvaluate` exit so no early return in the
// evaluator can drop it. A checklist member never reaches a
// recurring tier. Mirrors `overlay_recurring` in
// `src/native/freshness/state.rs`: `tier`, `dueOn`, and
// `daysOverdue` are set from the occurrence date, `decide` is
// false, and `state`, `lane`, `fresh`, interval, keeps, and lints
// are left alone.
function freshnessApplyRecurringOverlay(row, today, evaluated) {
  const safe = row && typeof row === "object" ? row : {};
  if (safe.checklist === "pre" || safe.checklist === "post") {
    return evaluated;
  }
  if (!safe.recurring) {
    return evaluated;
  }
  if (evaluated.lane === null || evaluated.lane === undefined) {
    return evaluated;
  }
  if (!safe.laneVisible) {
    return evaluated;
  }
  if (safe.isDailyNote || safe.isToday) {
    return evaluated;
  }
  const occurs = freshnessOccursOn(safe);
  if (occurs === null || occurs === undefined) {
    return evaluated;
  }
  if (occurs > today) {
    return evaluated;
  }
  return {
    ...evaluated,
    tier: "recurring",
    dueOn: occurs,
    daysOverdue: freshDateDiffDays(occurs, today),
    decide: false,
  };
}

// Evaluate one row for `todayText` under `config`. A row carries the
// caller-precomputed scope inputs:
//
//   { path, line (1-based), statusSymbol ("/", "*", or the line's
//     status; absent derives from rawLine), isTodo (Tasks status type
//     TODO), recurring, laneVisible (the NEXT/PENDING lane predicate),
//     isDailyNote (canonical YYYY/YYYYMMDD.md), isToday (Task Link
//     under today's open Pomodoros), scheduled (canonical date or
//     null), due (canonical date or null), start (canonical date or
//     null), created (canonical date or null, for queue order only),
//     rawLine (the task's originalMarkdown), noteRefreshRaw (the note's
//     raw `task_refresh`) }
//
// Returns `{ state ("new"|"resurfaced"|"rotten"|"fresh"|null; null is
// out of scope, see S13; lane rows keep a null state),
// tier ("new"|"projects"|"pending"|"next"|"recurring"|"tickler"|"references"|"rotten"|null),
// lane ("ready"|"pending"|"next"|null), fresh, intervalDays,
// intervalSource, dueOn, daysOverdue, keeps (the valid `[keeps:: N]`
// semantic count, 0 when absent), decide (a choice is due — never
// permission to act), lints }`. Exact `^ref` trackers bypass only the
// `#hide` exclusion; exact `^prj` rows use the ordinary lane-visible
// predicate (sync owns `#hide`). Due `^prj` rows walk in PROJECTS and
// due `^ref` rows in REFERENCES with the effective (tracker-override
// or Ready-chain) interval even when their Ready state is NEW or
// RESURFACED. Mirrors `evaluate_without_checklist` plus the checklist
// overlay in `src/native/freshness/state.rs`; `state` stays exactly
// as before so buckets never move. The RECURRING overlay is applied
// by `freshnessEvaluate` at its single exit, after this returns.
function freshnessEvaluateWithoutRecurring(row, todayText, config) {
  const safe = row && typeof row === "object" ? row : {};
  const today = freshnessNormalizeDateText(todayText);
  const read = readFreshness(safe.rawLine || "", today);
  const lints = [...read.lints];

  const note = freshnessParseNoteRefresh(safe.noteRefreshRaw);
  if (note.lint) {
    freshnessPushLint(lints, note.lint);
  }

  let writtenSymbol = null;
  try {
    writtenSymbol = freshnessTaskStatus(safe.rawLine || "");
  } catch (error) {
    writtenSymbol = null;
  }
  if (
    (writtenSymbol === null || writtenSymbol === undefined) &&
    typeof safe.statusSymbol === "string" &&
    safe.statusSymbol !== ""
  ) {
    writtenSymbol = String(safe.statusSymbol)[0];
  }
  let symbol = writtenSymbol;
  try {
    if (symbol === null || symbol === undefined || symbol === "") {
      symbol = freshnessTaskStatus(safe.rawLine || "");
    }
  } catch (error) {
    symbol = null;
  }
  if (symbol === null || symbol === undefined || symbol === "") {
    symbol = safe.isTodo ? " " : "?";
  } else {
    symbol = String(symbol)[0];
  }
  const checklist =
    safe.checklist === "pre" || safe.checklist === "post"
      ? safe.checklist
      : null;
  const lane =
    checklist !== null && writtenSymbol === "?"
      ? null
      : freshnessLaneForRow(symbol, Boolean(safe.isTodo));
  const laneDays =
    lane === "pending" || lane === "next"
      ? freshnessLaneIntervalDays(config, lane)
      : null;

  // Tracking identity from the row's block ID, tags, and line
  // (`^prj`, or `^ref` / whole-token `#ref` for references). A
  // configured tracker interval wins for that type; otherwise a
  // tracker keeps the Ready-chain cadence, never the lane interval.
  // Only Ready refs keep the tracker cadence and REFERENCES tier;
  // lane refs (`/`/`*`) are ordinary lane rows (the J4 split, mirroring
  // `evaluate_without_checklist` in `src/native/freshness/state.rs`).
  // `^prj` behavior is unchanged.
  const tracker = freshnessTrackerFromRow(safe);
  const isPrj = tracker === "prj";
  const isRef = tracker === "ref" && lane === "ready";
  const isTracker = isPrj || isRef;
  // Lane refs are ordinary lane rows, so the reference cadence never
  // applies to them — only the effective (Ready-gated) identity feeds
  // the interval.
  const effectiveTracker = isPrj ? "prj" : isRef ? "ref" : null;
  const trackerInterval = freshnessTrackerIntervalFor(
    config,
    effectiveTracker,
  );
  const readyInterval = freshnessIntervalFor(
    read.refresh,
    note.days,
    config,
    null,
    null,
  );
  const interval =
    trackerInterval !== null
      ? trackerInterval
      : isTracker
        ? readyInterval
        : freshnessIntervalFor(read.refresh, note.days, config, lane, null);
  const fresh = read.fresh;

  const walkScope =
    lane !== null &&
    Boolean(safe.laneVisible) &&
    !safe.recurring &&
    !safe.isDailyNote &&
    !safe.isToday;

  // Checklist visibility shares the established lane predicate, with
  // recurring, daily-note, and Today exclusions deliberately lifted.
  // The status must be the symbol actually written on the task line.
  const checklistScheduled = freshnessEvaluateValidScheduled(safe.scheduled);
  const checklistScope =
    checklist !== null &&
    [" ", "*", "/", "?"].includes(writtenSymbol) &&
    Boolean(safe.laneVisible) &&
    !(checklistScheduled !== null && checklistScheduled > today);

  // Ordinary lane due arithmetic uses the lane interval only.
  // Trackers never use it here; their lane arithmetic lives below.
  const effectiveLaneDays = laneDays;
  let laneDueOn = null;
  let laneDue = false;
  let laneDaysOverdue = null;
  if ((lane === "pending" || lane === "next") && effectiveLaneDays !== null) {
    if (fresh === null) {
      laneDue = true;
    } else {
      const due = freshDateAddDays(fresh, effectiveLaneDays);
      laneDueOn = due;
      if (today >= due) {
        laneDue = true;
        laneDaysOverdue = freshDateDiffDays(due, today);
      }
    }
  }

  const inScope =
    Boolean(safe.isTodo) &&
    lane === "ready" &&
    Boolean(safe.laneVisible) &&
    !safe.recurring &&
    !safe.isDailyNote &&
    !safe.isToday;

  // Effective resurfacing schedule: the inline schedule, once due.
  // Tracker rows use the same ordinary inline handling as every
  // other row.
  const inlineScheduled = freshnessEvaluateValidScheduled(safe.scheduled);
  let resurfacedOn = null;
  if (inScope) {
    if (
      inlineScheduled !== null &&
      fresh !== null &&
      fresh < inlineScheduled &&
      inlineScheduled <= today
    ) {
      resurfacedOn = inlineScheduled;
    }
  }

  // Ready state: lane rows keep a null state; Ready rows evaluate
  // normally, trackers included. A hidden `^prj` never arrives in
  // scope because it uses the ordinary lane-visible predicate.
  let state = null;
  if (inScope) {
    if (lane === "pending" || lane === "next") {
      state = null;
    } else if (fresh === null) {
      state = "new";
    } else if (resurfacedOn !== null) {
      state = "resurfaced";
    } else {
      const due = freshDateAddDays(fresh, interval.days);
      state = today >= due ? "rotten" : "fresh";
    }
  }

  // Tracker lane due date uses the effective (tracker-override or
  // Ready-chain) interval, never the lane interval; a disabled lane
  // walk does not disable the reminder.
  const trackerLaneEligible =
    isTracker && (lane === "pending" || lane === "next") && walkScope;
  const trackerLaneDue =
    trackerLaneEligible &&
    (fresh === null ||
      resurfacedOn !== null ||
      (fresh !== null && today >= freshDateAddDays(fresh, interval.days)));
  let trackerLaneDueOn = null;
  if (trackerLaneDue) {
    if (resurfacedOn !== null) {
      trackerLaneDueOn = resurfacedOn;
    } else if (fresh !== null) {
      trackerLaneDueOn = freshDateAddDays(fresh, interval.days);
    }
  }

  // PROJECTS is every due `^prj` (Ready NEW/RESURFACED/ROTTEN plus
  // every due lane tracker with its actual lane retained) and
  // REFERENCES every due Ready `#ref`/`^ref` row; both precede NEW
  // and the lane tiers, so a never-confirmed Ready reference walks
  // in REFERENCES, never NEW. Lane refs are ordinary lane rows.
  const trackerReadyDue =
    isTracker &&
    lane === "ready" &&
    (state === "new" || state === "resurfaced" || state === "rotten");
  const trackerLaneDueRow = trackerLaneEligible && trackerLaneDue;
  let tier = null;
  if (checklistScope) {
    tier = checklist;
  } else if (isPrj && (trackerReadyDue || trackerLaneDueRow)) {
    tier = "projects";
  } else if (isRef && (trackerReadyDue || trackerLaneDueRow)) {
    tier = "references";
  } else if (lane === "ready" && state === "new" && !isTracker) {
    tier = "new";
  } else if (lane === "pending" && walkScope && laneDue && !isTracker) {
    tier = "pending";
  } else if (lane === "next" && walkScope && laneDue && !isTracker) {
    tier = "next";
  } else if (state === "resurfaced") {
    tier = "tickler";
  } else if (state === "rotten") {
    tier = "rotten";
  }

  // A choice is due — never permission to act — for Ready due rows at
  // or over the keep limit. Mirrors the `decide` computation in
  // `evaluate` in `src/native/freshness/state.rs`.
  const keeps = read.keeps;
  const decide = freshnessDecideFor(lane, tier, keeps, config);

  // Lane rows use the lane due date; an unwalked lane falls back to
  // the Ready-chain interval with no due date (L4). Lane tracker rows
  // keep their actual lane with null state but use the effective
  // tracker due metadata; a disabled lane walk does not clear it.
  if (lane === "pending" || lane === "next") {
    if (isTracker) {
      let daysOverdue = null;
      if (trackerLaneDueOn !== null && today >= trackerLaneDueOn) {
        daysOverdue = freshDateDiffDays(trackerLaneDueOn, today);
      }
      return {
        state: null,
        tier,
        lane,
        fresh,
        intervalDays: interval.days,
        intervalSource: interval.source,
        dueOn: checklistScope ? null : trackerLaneDueOn,
        daysOverdue: checklistScope ? null : daysOverdue,
        keeps,
        decide,
        lints,
      };
    }
    let dueOn = checklistScope || fresh === null ? null : laneDueOn;
    let daysOverdue =
      checklistScope || fresh === null ? null : laneDaysOverdue;
    if (laneDays === null) {
      dueOn = null;
      daysOverdue = null;
    }
    return {
      state: null,
      tier,
      lane,
      fresh,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn,
      daysOverdue,
      keeps,
      decide,
      lints,
    };
  }

  if (state === null) {
    return {
      state: null,
      tier: checklistScope ? tier : null,
      lane,
      fresh,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn: null,
      daysOverdue: null,
      keeps,
      decide,
      lints,
    };
  }

  if (state === "new") {
    return {
      state,
      tier,
      lane,
      fresh: null,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn: null,
      daysOverdue: null,
      keeps,
      decide,
      lints,
    };
  }

  if (state === "resurfaced") {
    const scheduled =
      resurfacedOn !== null
        ? resurfacedOn
        : freshnessEvaluateValidScheduled(safe.scheduled);
    return {
      state,
      tier,
      lane,
      fresh,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn: checklistScope ? null : scheduled,
      daysOverdue: checklistScope ? null : freshDateDiffDays(scheduled, today),
      keeps,
      decide,
      lints,
    };
  }

  if (state === "rotten") {
    const dueOn = freshDateAddDays(fresh, interval.days);
    return {
      state,
      tier,
      lane,
      fresh,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn: checklistScope ? null : dueOn,
      daysOverdue: checklistScope ? null : freshDateDiffDays(dueOn, today),
      keeps,
      decide,
      lints,
    };
  }

  const dueOn = freshDateAddDays(fresh, interval.days);
  return {
    state,
    tier,
    lane,
    fresh,
    intervalDays: interval.days,
    intervalSource: interval.source,
    dueOn: checklistScope ? null : dueOn,
    daysOverdue: null,
    keeps,
    decide,
    lints,
  };
}

// Evaluate one row for `todayText` under `config` (same shape as
// `freshnessEvaluateWithoutRecurring`): the base evaluation plus the
// RECURRING overlay at this single exit, so the lane-row and
// null-state early returns inside cannot drop the tier. Mirrors
// `evaluate` =
// `overlay_recurring(overlay_checklist(evaluate_without_checklist(…)))`
// in `src/native/freshness/state.rs`.
function freshnessEvaluate(row, todayText, config) {
  const evaluated = freshnessEvaluateWithoutRecurring(
    row,
    todayText,
    config,
  );
  return freshnessApplyRecurringOverlay(
    row,
    freshnessNormalizeDateText(todayText),
    evaluated,
  );
}

// One row's state: `"new"` | `"resurfaced"` | `"rotten"` | `"fresh"` |
// null (out of scope).
function freshnessState(row, todayText, config) {
  return freshnessEvaluate(row, todayText, config).state;
}

// Stable read-time bucket for dashboard gating (`docs/freshness.md`
// §4 in bob-cli): `"new"` surfaces in NEW, `"rotten"` (resurfaced or
// age-expired) surfaces in ROTTEN review, anything else (fresh or
// out of scope) has no bucket.
function freshnessBucketForState(state) {
  if (state === "new") {
    return "new";
  }
  if (state === "resurfaced" || state === "rotten") {
    return "rotten";
  }
  return null;
}

// Local day number for a canonical `YYYY-MM-DD` date text, parsed as a
// local calendar date (never UTC, so DST boundaries match the vault's
// local day). Null when the text is not a strict calendar date.
function freshnessDayNumberForDateText(dateText) {
  try {
    const text = parseFreshDateStrict(dateText);
    if (text === null) {
      return null;
    }
    const parts = text.split("-").map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
      return null;
    }
    return planDayNumber(new Date(parts[0], parts[1] - 1, parts[2]));
  } catch (error) {
    return null;
  }
}

function freshnessRowKey(row) {
  const path = String(row.path || "");
  if (row.blockId) {
    return path + "#" + row.blockId;
  }
  return path + ":" + row.line;
}

// Walk tier order: PRE → NEW → PROJECTS → PENDING → NEXT → RECURRING →
// TICKLER → REFERENCES → ROTTEN → POST. Mirrors the `Tier` ordering in
// `src/native/freshness/state.rs`.
const FRESHNESS_TIER_ORDER = {
  pre: 0,
  new: 1,
  projects: 2,
  pending: 3,
  next: 4,
  recurring: 5,
  tickler: 6,
  references: 7,
  rotten: 8,
  post: 9,
};

// Whole-token `#ref` tag in a task line, case-insensitive.
// `#references` and `#ref/x` never qualify. Mirrors the tag half of
// `TrackerKind::from_tags_and_block_id` in
// `src/native/freshness/state.rs`.
function freshnessLineHasRefTag(line) {
  const text = typeof line === "string" ? line : "";
  const tokens = text.split(/[\s\ufeff]+/);
  for (const token of tokens) {
    const cleaned = token.replace(/^[>"'([{*\-+]+/, "").replace(/[.,;:!?)\]}'"]+$/, "");
    if (cleaned.toLowerCase() === "#ref") {
      return true;
    }
  }
  return false;
}

// Tracking-task identity from the row's block ID, tag list, and
// line: the exact trailing block ID `prj`, or — for references —
// the exact trailing block ID `ref` or a whole-token `#ref` tag
// (case-insensitive). `^prj-extra`, `#references`, description text,
// and `[[x#^prj]]` links/embeds are never identities. Mirrors
// `TrackerKind::from_tags_and_block_id` in
// `src/native/freshness/state.rs`.
function freshnessTrackerFromRow(row) {
  const safe = row && typeof row === "object" ? row : {};
  const blockId =
    typeof safe.tracker === "string"
      ? safe.tracker
      : typeof safe.blockId === "string"
        ? safe.blockId
        : null;
  if (blockId === "prj") {
    return "prj";
  }
  if (blockId === "ref") {
    return "ref";
  }
  if (
    Array.isArray(safe.tags) &&
    safe.tags.some(
      (tag) => typeof tag === "string" && tag.trim().toLowerCase() === "#ref",
    )
  ) {
    return "ref";
  }
  const line =
    typeof safe.rawLine === "string"
      ? safe.rawLine
      : typeof safe.originalMarkdown === "string"
        ? safe.originalMarkdown
        : "";
  if (freshnessLineHasRefTag(line)) {
    return "ref";
  }
  return null;
}

function freshnessTierLabel(tier) {
  if (tier === "pre") {
    return "PRE";
  }
  if (tier === "new") {
    return "NEW";
  }
  if (tier === "projects") {
    return "PROJECTS";
  }
  if (tier === "pending") {
    return "PENDING";
  }
  if (tier === "next") {
    return "NEXT";
  }
  if (tier === "recurring") {
    return "RECURRING";
  }
  if (tier === "tickler") {
    return "TICKLER";
  }
  if (tier === "references") {
    return "REFERENCES";
  }
  if (tier === "rotten") {
    return "ROTTEN";
  }
  if (tier === "post") {
    return "POST";
  }
  return "";
}

// Compact status-bar label for the review footer.
function freshnessTierFooterLabel(tier) {
  if (tier === "pending") {
    return "WIP";
  }
  if (tier === "recurring") {
    return "RECUR";
  }
  if (tier === "tickler") {
    return "TICKS";
  }
  if (tier === "references") {
    return "REFS";
  }
  return freshnessTierLabel(tier);
}

// Compare `created` with missing dates always last, in both ascending
// and descending keys. Mirrors `compare_created` in `state.rs`.
function freshnessCompareCreated(a, b, descending) {
  if (a === null || a === undefined) {
    return b === null || b === undefined ? 0 : 1;
  }
  if (b === null || b === undefined) {
    return -1;
  }
  if (a === b) {
    return 0;
  }
  if (descending) {
    return a < b ? 1 : -1;
  }
  return a < b ? -1 : 1;
}

function freshnessCompareDueOn(a, b) {
  if (a === null || a === undefined) {
    return b === null || b === undefined ? 0 : -1;
  }
  if (b === null || b === undefined) {
    return 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function freshnessComparePathLine(a, b) {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  return a.line - b.line;
}
