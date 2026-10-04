// Unavailable NEW/ROTTEN review model: explicit nulls, never a zero
// that could read as an empty success.
function freshnessReviewUnavailable() {
  return {
    available: false,
    new: null,
    returned: null,
    rotten: null,
    refreshedToday: null,
    upkeepToday: null,
    budget: null,
    budgetMet: false,
    meter: "✓ –",
    severity: "unavailable",
    escalated: false,
    oldestDaysOverdue: null,
    tooltip: "Review unavailable",
    newText: "NEW –",
    rottenText: "ROTTEN –",
  };
}

// Shared NEW/ROTTEN view-model from one freshness snapshot. `counts`
// is a `freshnessCounts` result and `queue` a `freshnessQueue` result
// over the same rows. The ROTTEN total includes RETURNED; escalation
// is per-row (`daysOverdue >= interval` for that row), never the
// confirmation age or the global default. The meter shows upkeep
// (`upkeepToday`); `refreshedToday` stays exposed for the census.
// An optional `visible` (`{ counts, queue }` projected onto the
// visible Ready pool) drives the NEW/ROTTEN chips and severity while
// the meter still uses the full counts; without it the full inputs
// drive everything (legacy behavior). Never throws.
function freshnessReviewModel(counts, queue, visible = null) {
  try {
    const chips =
      visible && typeof visible === "object" && visible.counts
        ? visible.counts
        : counts || {};
    const chipQueue =
      visible &&
      typeof visible === "object" &&
      Array.isArray(visible.queue)
        ? visible.queue
        : queue;
    const safe = chips;
    const freshNew =
      Number.isInteger(safe.new) && safe.new >= 0 ? safe.new : 0;
    const resurfaced =
      Number.isInteger(safe.resurfaced) && safe.resurfaced >= 0
        ? safe.resurfaced
        : 0;
    const ageExpired =
      Number.isInteger(safe.rotten) && safe.rotten >= 0 ? safe.rotten : 0;
    const rotten = resurfaced + ageExpired;
    const refreshed =
      Number.isInteger(safe.refreshedToday) && safe.refreshedToday >= 0
        ? safe.refreshedToday
        : 0;
    const upkeep =
      Number.isInteger(safe.upkeepToday) && safe.upkeepToday >= 0
        ? safe.upkeepToday
        : refreshed;
    const budget =
      Number.isInteger(safe.budget) && safe.budget >= 1 ? safe.budget : null;
    const budgetMet = Boolean(safe.budgetMet);
    let oldest = null;
    let escalated = false;
    for (const entry of Array.isArray(chipQueue) ? chipQueue : []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      if (entry.state !== "resurfaced" && entry.state !== "rotten") {
        continue;
      }
      if (Number.isInteger(entry.daysOverdue) && entry.daysOverdue >= 0) {
        if (oldest === null || entry.daysOverdue > oldest) {
          oldest = entry.daysOverdue;
        }
        if (
          Number.isInteger(entry.interval) &&
          entry.interval >= 1 &&
          entry.daysOverdue >= entry.interval
        ) {
          escalated = true;
        }
      }
    }
    const meter =
      budget !== null ? upkeep + "/" + budget : String(upkeep);
    // NEW is red above 0; ROTTEN is neutral at 0, orange above 0, red
    // once any returned or age-expired row is a full interval overdue.
    const severity =
      freshNew > 0 ? "new" : escalated ? "escalated" : rotten > 0 ? "rotten" : "none";
    const tooltip =
      "ROTTEN " +
      rotten +
      " = " +
      resurfaced +
      " returned + " +
      ageExpired +
      " rotten · oldest " +
      (oldest === null ? "–" : oldest + "d") +
      " overdue · ✓ " +
      meter +
      " today";
    return {
      available: true,
      new: freshNew,
      returned: resurfaced,
      rotten,
      refreshedToday: refreshed,
      upkeepToday: upkeep,
      budget,
      budgetMet,
      meter: "✓ " + meter,
      severity,
      escalated,
      oldestDaysOverdue: oldest,
      tooltip,
      newText: "NEW " + freshNew,
      rottenText: "ROTTEN " + rotten + " · ✓ " + meter,
    };
  } catch (error) {
    return freshnessReviewUnavailable();
  }
}

// --- Task freshness: display mark (mark-core) -------------------------------
// Owned by `docs/freshness.md` §§11-12 in bob-cli. Pure helpers only:
// source detection, resolution, model, consensus, tooltip dates, and a
// listener-free DOM builder. Every helper is synchronous and never
// throws; bad input yields null (or the unresolved model for the model
// builder). Reuses `freshnessInlineFields`, `readFreshness`,
// `freshnessTaskStatus`, `parseFreshDateStrict`, `freshDateDiffDays`,
// `freshDateAddDays`, `freshnessParseRefreshValue`, `freshnessIntervalFor`,
// `freshnessParseNoteRefresh`, and `freshnessEvaluate` above.

const FRESHNESS_MARK_WEEKDAYS = [
  "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
];

const FRESHNESS_MARK_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const FRESHNESS_MARK_CLOSED_REASONS = {
  x: "Done",
  X: "Done",
  "-": "Cancelled",
};

const FRESHNESS_MARK_STATUS_REASONS = {
  "*": "Next",
  "/": "In Progress",
  "?": "Blocked",
  x: "Done",
  X: "Done",
  "-": "Cancelled",
};

// The single folded `[refresh:: N]` after a fresh field, or null when the
// line's refresh field is absent, paren-wrapped, non-adjacent, duplicated,
// or invalid. Never throws.
function freshnessMarkFoldRefresh(text, freshField) {
  try {
    const fields = freshnessInlineFields(text, "refresh");
    if (fields.length !== 1) {
      return null;
    }
    const field = fields[0];
    if (text[field.start] !== "[") {
      return null;
    }
    if (field.start !== freshField.end + 1 || text[freshField.end] !== " ") {
      return null;
    }
    const days = freshnessParseRefreshValue(field.value);
    if (days === null) {
      return null;
    }
    return { field, days };
  } catch (error) {
    return null;
  }
}

// The single folded `[keeps:: N]` after the last folded fresh/refresh
// field, or null when the line's keeps field is absent,
// paren-wrapped, non-adjacent, duplicated, or invalid. Only one valid
// square-bracketed keeps field folds, exactly one space after
// `afterField`. Noncanonical keeps fields stay visible Dataview pills
// with repair styling. Never throws.
function freshnessMarkFoldKeeps(text, afterField) {
  try {
    const fields = freshnessInlineFields(text, "keeps");
    if (fields.length !== 1) {
      return null;
    }
    const field = fields[0];
    if (text[field.start] !== "[") {
      return null;
    }
    if (field.start !== afterField.end + 1 || text[afterField.end] !== " ") {
      return null;
    }
    const count = freshnessParseKeepsValue(field.value);
    if (count === null) {
      return null;
    }
    return { field, count };
  } catch (error) {
    return null;
  }
}

// Shared core for both source detectors: one square-bracketed fresh field
// with a strict, non-future date, plus adjacent refresh folding and
// adjacent keeps folding. Returns the fresh field, folds, and date, or
// null. Never throws.
function freshnessMarkSourceCore(text, today) {
  try {
    const freshFields = freshnessInlineFields(text, "fresh");
    if (freshFields.length !== 1) {
      return null;
    }
    const freshField = freshFields[0];
    if (text[freshField.start] !== "[") {
      return null;
    }
    const date = parseFreshDateStrict(freshField.value.trim());
    if (date === null || date > today) {
      return null;
    }
    const fold = freshnessMarkFoldRefresh(text, freshField);
    const anchor = fold === null ? freshField : fold.field;
    const keepsFold = freshnessMarkFoldKeeps(text, anchor);
    return { freshField, fold, keepsFold, date };
  } catch (error) {
    return null;
  }
}

// The folded keeps count on a mark source: the valid semantic streak
// (1-999), or null when no keeps field folds into the mark.
function freshnessMarkSourceKeeps(core) {
  try {
    if (!core || !core.keepsFold) {
      return null;
    }
    return core.keepsFold.count;
  } catch (error) {
    return null;
  }
}

// A Live Preview task line's mark source, or null when the line gets no
// mark. `fieldStart`/`fieldEnd` are UTF-16 offsets of the folded field
// text, excluding the folded space. Never throws.
function freshnessMarkSource(line, todayText) {
  try {
    if (typeof line !== "string") {
      return null;
    }
    if (freshnessTaskStatus(line) === null) {
      return null;
    }
    const today = freshnessNormalizeDateText(todayText);
    const core = freshnessMarkSourceCore(line, today);
    if (core === null) {
      return null;
    }
    const read = readFreshness(line, today);
    if (read.fresh === null || read.fresh !== core.date) {
      return null;
    }
    for (const lint of [
      "fresh_malformed",
      "fresh_future",
      "fresh_duplicate",
      "fresh_misplaced",
    ]) {
      if (read.lints.includes(lint)) {
        return null;
      }
    }
    const lastFold =
      core.keepsFold !== null && core.keepsFold !== undefined
        ? core.keepsFold.field
        : core.fold === null
          ? core.freshField
          : core.fold.field;
    const fieldEnd = lastFold.end;
    const fieldStart = core.freshField.start;
    return {
      fieldStart,
      fieldEnd,
      foldSpace: fieldStart > 0 && line[fieldStart - 1] === " ",
      text: line.slice(fieldStart, fieldEnd),
      fresh: core.date,
      refresh: core.fold === null ? null : core.fold.days,
      keeps: freshnessMarkSourceKeeps(core),
    };
  } catch (error) {
    return null;
  }
}

// A rendered-view text node's mark source (`foldSpace` never applies, so
// it is omitted). Skips the task-line and misplaced checks because Tasks
// may have split off the suffix. Never throws.
function freshnessMarkSourceInText(text, todayText) {
  try {
    if (typeof text !== "string") {
      return null;
    }
    const today = freshnessNormalizeDateText(todayText);
    const core = freshnessMarkSourceCore(text, today);
    if (core === null) {
      return null;
    }
    const lastFold =
      core.keepsFold !== null && core.keepsFold !== undefined
        ? core.keepsFold.field
        : core.fold === null
          ? core.freshField
          : core.fold.field;
    const fieldEnd = lastFold.end;
    const fieldStart = core.freshField.start;
    return {
      fieldStart,
      fieldEnd,
      text: text.slice(fieldStart, fieldEnd),
      fresh: core.date,
      refresh: core.fold === null ? null : core.fold.days,
      keeps: freshnessMarkSourceKeeps(core),
    };
  } catch (error) {
    return null;
  }
}

// Fixed English short date from the UTC calendar date, so tooltips are
// deterministic across time zones. Appends the year only when it differs
// from today's year. Never throws: bad input yields null.
function freshnessShortDate(dateText, todayText) {
  try {
    const date = parseFreshDateStrict(String(dateText || ""));
    const today = parseFreshDateStrict(String(todayText || ""));
    if (date === null || today === null) {
      return null;
    }
    const day = new Date(freshDateToUtc(date));
    if (Number.isNaN(day.getTime())) {
      return null;
    }
    const base =
      FRESHNESS_MARK_WEEKDAYS[day.getUTCDay()] +
      ", " +
      FRESHNESS_MARK_MONTHS[Number(date.slice(5, 7)) - 1] +
      " " +
      String(Number(date.slice(8, 10)));
    return date.slice(0, 4) === today.slice(0, 4)
      ? base
      : base + ", " + date.slice(0, 4);
  } catch (error) {
    return null;
  }
}

// The out-of-scope reason for a resolved-but-out-of-scope row, in the
// documented order: lane statuses, `isToday`, `isDailyNote`,
// `recurring`, `_templates`/`_conflicts` path segments, and
// `scheduled` (only when after today). Never throws.
function freshnessMarkReason(status, row, today) {
  try {
    const safe = row && typeof row === "object" ? row : {};
    if (
      status !== null &&
      status !== undefined &&
      status !== " " &&
      Object.hasOwn(FRESHNESS_MARK_STATUS_REASONS, status)
    ) {
      return FRESHNESS_MARK_STATUS_REASONS[status];
    }
    if (status !== null && status !== undefined && status !== " ") {
      return "status [" + status + "]";
    }
    if (safe.isToday) {
      return "linked today";
    }
    if (safe.isDailyNote) {
      return "in a daily note";
    }
    if (safe.recurring) {
      return "recurring";
    }
    if (
      String(safe.path || "")
        .split("/")
        .some(
          (segment) => segment === "_templates" || segment === "_conflicts",
        )
    ) {
      return "in _templates or _conflicts";
    }
    const scheduled = freshnessEvaluateValidScheduled(safe.scheduled);
    if (scheduled !== null && scheduled > today) {
      return (
        "scheduled for " + (freshnessShortDate(scheduled, today) || scheduled)
      );
    }
    return "hidden or dependency-blocked";
  } catch (error) {
    return "hidden or dependency-blocked";
  }
}

// Wrap `freshnessEvaluate` for one memo row: `{ state, tier, lane,
// dueOn, scheduled, status, reason, intervalDays, intervalSource,
// keeps, decide, decayKeeps, decayEnabled, decayCardCapable }`.
// A null `state` with a null `tier` and a reason means out of scope;
// a lane `tier` (pending/next) means due in the walk; an in-walk
// lane with a null tier and no reason is stamped today (M10). An
// evaluator `"new"` is treated as unresolved (null). `keeps` is the
// valid streak and `decide` whether a choice is due (never permission
// to act); both join model equality and consensus so ambiguous
// rendered matches stay neutral. `decayCardCapable` (from
// `options.cardCapable`, default false) records whether the compatible
// nav decision card is installed; only the display affordances read
// it, never the `decide` flag itself. Never throws.
function freshnessMarkResolution(row, todayText, config, options) {
  try {
    if (!row || typeof row !== "object") {
      return null;
    }
    const today = freshnessNormalizeDateText(todayText);
    const evaluated = freshnessEvaluate(row, today, config);
    // An evaluator `"new"` is unresolved (null) — except a due
    // tracker in PROJECTS or REFERENCES, which reads as its tier with
    // the effective interval so marks agree with the queue.
    if (
      evaluated.state === "new" &&
      evaluated.tier !== "projects" &&
      evaluated.tier !== "references"
    ) {
      return null;
    }
    const status = freshnessTaskStatus(row.rawLine || "");
    let reason = null;
    if (evaluated.tier === null || evaluated.tier === undefined) {
      if (
        (evaluated.lane === "pending" || evaluated.lane === "next") &&
        evaluated.state === null
      ) {
        // In-walk lane stamped today (or otherwise not due) keeps no
        // reason; outside the walk (Today, daily note, disabled lane,
        // recurring, hidden) keeps the existing reason.
        const walkScope =
          evaluated.lane !== null &&
          Boolean(row.laneVisible) &&
          !row.recurring &&
          !row.isDailyNote &&
          !row.isToday;
        const laneDays = freshnessLaneIntervalDays(config, evaluated.lane);
        if (!(walkScope && laneDays !== null)) {
          reason = freshnessMarkReason(status, row, today);
        } else if (evaluated.fresh !== today) {
          // A walked lane that is not due is stamped today; any other
          // fresh date here would already be due, so treat it as out
          // of scope rather than guessing.
          reason = freshnessMarkReason(status, row, today);
        }
      } else if (evaluated.state === null) {
        reason = freshnessMarkReason(status, row, today);
      }
    }
    const decay =
      config && config.decay && typeof config.decay === "object"
        ? config.decay
        : { enabled: true, keeps: 3 };
    return {
      state: evaluated.state,
      tier: evaluated.tier || null,
      lane: evaluated.lane || null,
      dueOn: evaluated.dueOn,
      scheduled: freshnessEvaluateValidScheduled(row.scheduled),
      status,
      reason,
      intervalDays: evaluated.intervalDays,
      intervalSource: evaluated.intervalSource,
      keeps: evaluated.keeps,
      decide: evaluated.decide,
      decayKeeps:
        Number.isInteger(decay.keeps) && decay.keeps >= 0 ? decay.keeps : 3,
      decayEnabled: decay.enabled !== false,
      decayCardCapable: Boolean(
        options && typeof options === "object" && options.cardCapable === true,
      ),
    };
  } catch (error) {
    return null;
  }
}

function freshnessMarkEveryPhrase(days, source) {
  const head = days === 1 ? "every 1 day" : "every " + days + " days";
  if (source === "task") {
    return head + " (this task)";
  }
  if (source === "note") {
    return head + " (this note)";
  }
  if (source === "config") {
    return head + " (config)";
  }
  if (source === "pending") {
    return head + " (pending lane)";
  }
  if (source === "next") {
    return head + " (next lane)";
  }
  if (source === "project") {
    return head + " (project)";
  }
  if (source === "reference") {
    return head + " (reference)";
  }
  return head;
}

function freshnessMarkValidInterval(input) {
  if (
    input &&
    typeof input === "object" &&
    Number.isSafeInteger(input.days) &&
    input.days >= 1 &&
    input.days <= 365
  ) {
    return { days: input.days, source: input.source || "default" };
  }
  return { days: 7, source: "default" };
}

// The dot cap for a keep threshold: thresholds 1-2 use the threshold
// itself, while larger, custom, and zero thresholds cap at three to
// keep line width bounded. Overflow renders as `+N`; the exact count
// is always in accessible text. Never throws.
function freshnessMarkDotCap(limit) {
  try {
    if (limit === 1 || limit === 2) {
      return limit;
    }
    return 3;
  } catch (error) {
    return 3;
  }
}

// The tooltip keeps line for a nonzero streak, or null when there is
// no streak to report. Wording is truthful about card availability:
// the "asks" clause appears only when decay is on and the compatible
// nav decision card is installed; with decay off or in a mixed-version
// session the line counts only. Proper singulars; an explicit sentence
// for threshold zero. Never throws.
function freshnessMarkKeepsLine(keeps, options) {
  try {
    if (!Number.isInteger(keeps) || keeps <= 0) {
      return null;
    }
    const head =
      "Kept " + keeps + (keeps === 1 ? " review in a row" : " reviews in a row");
    const settings =
      options && typeof options === "object" ? options : {};
    if (!settings.active) {
      return head;
    }
    if (!settings.enabled) {
      return head + " · decay off";
    }
    if (settings.limit === 0) {
      return head + " · Bob asks every review";
    }
    return head + " · Bob asks at " + settings.limit;
  } catch (error) {
    return null;
  }
}

// The render model for one mark: `{ text, fresh, ageDays, label,
// intervalDays, intervalSource, intervalLabel, remaining, tone, glyph
// ("check" | "ring" | "refresh" | "leaf"), resolved, keeps, decide,
// dots, overflow, tooltip }`. When resolved the model uses the
// resolution's interval, otherwise `input.interval`. `keeps` is the
// folded streak (the resolution's evaluated count when resolved, else
// the source's folded count) and `decide` whether a choice is due;
// both join model equality and consensus. Dots render for any nonzero
// streak — including resting and unresolved marks, quietly — but the
// decision glyph appears only for an enabled, capable due choice:
// out-of-scope/closed tasks, decay-off rows, and mixed-version
// sessions (no compatible nav card) show historical dots and no leaf.
// Bad sources yield null. Never throws.
function freshnessMarkModel(input) {
  try {
    const args = input && typeof input === "object" ? input : null;
    if (args === null || !args.source || typeof args.source !== "object") {
      return null;
    }
    const source = args.source;
    const today = freshnessNormalizeDateText(args.today);
    const fresh = parseFreshDateStrict(String(source.fresh || ""));
    if (fresh === null) {
      return null;
    }
    const ageDays = freshDateDiffDays(fresh, today);
    if (!Number.isSafeInteger(ageDays) || ageDays < 0) {
      return null;
    }
    const resolution =
      args.resolution !== undefined && args.resolution !== null
        ? args.resolution
        : null;
    const interval = resolution
      ? freshnessMarkValidInterval({
          days: resolution.intervalDays,
          source: resolution.intervalSource,
        })
      : freshnessMarkValidInterval(args.interval);
    const status =
      args.status !== undefined && args.status !== null
        ? args.status
        : resolution && resolution.status !== undefined
          ? resolution.status
          : null;
    const closed =
      status === "x" || status === "X" || status === "-";
    const state = resolution ? resolution.state : null;
    const tier = resolution ? resolution.tier || null : null;
    const lane = resolution ? resolution.lane || null : null;
    let tone;
    if (closed) {
      tone = "resting";
    } else if (
      state === "rotten" ||
      state === "resurfaced" ||
      tier === "pending" ||
      tier === "next"
    ) {
      tone = "due";
    } else if (ageDays === 0) {
      tone = "today";
    } else if (resolution && state === null && tier === null) {
      tone = "resting";
    } else {
      tone = "aging";
    }
    let glyph = tone === "today" ? "check" : tone === "due" ? "refresh" : "ring";
    const remaining =
      Math.round(
        (Math.min(Math.max((interval.days - ageDays) / interval.days, 0), 1) *
          10000),
      ) / 10000;
    // The `/{N}d` suffix appears only when the effective interval
    // source is `task`, and never on the `today` tone; lane intervals
    // stay tooltip-only (M20).
    const intervalLabel =
      source.refresh !== null &&
      source.refresh !== undefined &&
      tone !== "today" &&
      interval.source === "task"
        ? "/" + source.refresh + "d"
        : null;
    const shortFresh = freshnessShortDate(fresh, today) || fresh;
    const relative =
      ageDays === 0
        ? "today"
        : ageDays === 1
          ? "yesterday"
          : ageDays + " days ago";
    const line1 =
      ageDays === 0
        ? "Confirmed today"
        : "Confirmed " + shortFresh + " · " + relative;
    const every = freshnessMarkEveryPhrase(interval.days, interval.source);
    let line2;
    const outOfScope =
      closed ||
      (resolution &&
        resolution.state === null &&
        (resolution.tier === null || resolution.tier === undefined) &&
        resolution.reason);
    if (outOfScope) {
      const reason = closed
        ? FRESHNESS_MARK_CLOSED_REASONS[status] || "status [" + status + "]"
        : resolution.reason || "hidden or dependency-blocked";
      line2 = "Not in the review queue: " + reason;
    } else if (resolution && (tier === "pending" || tier === "next")) {
      const dueOn =
        freshnessShortDate(resolution.dueOn, today) || resolution.dueOn;
      const laneWord = tier === "pending" ? "PENDING" : "NEXT";
      line2 = "Daily " + laneWord + " review due since " + dueOn + " · " + every;
    } else if (
      resolution &&
      (lane === "pending" || lane === "next") &&
      resolution.state === null &&
      (resolution.tier === null || resolution.tier === undefined)
    ) {
      const next = freshDateAddDays(fresh, interval.days);
      const shortNext = freshnessShortDate(next, today) || next;
      line2 = "Next review " + shortNext + " · " + every;
    } else if (resolution && resolution.state === "rotten") {
      const dueOn = freshnessShortDate(resolution.dueOn, today) || resolution.dueOn;
      line2 = "Due for review since " + dueOn + " · " + every;
    } else if (resolution && resolution.state === "resurfaced") {
      const when =
        freshnessShortDate(resolution.scheduled, today) ||
        resolution.scheduled ||
        resolution.dueOn;
      line2 = "Resurfaced " + when + ": scheduled after it was confirmed";
    } else {
      const next = freshDateAddDays(fresh, interval.days);
      const shortNext = freshnessShortDate(next, today) || next;
      line2 =
        today >= next
          ? "Review lease ended " + shortNext + " · " + every
          : "Next review " + shortNext + " · " + every;
    }
    // The leaf replaces `refresh` only for an enabled, capable due
    // choice (`docs/freshness.md` §2a): decay is on, the resolution says
    // a choice is due, and the compatible nav decision card is
    // installed. Everything else keeps its existing glyph and
    // counting-only wording.
    const cardCapable = Boolean(resolution && resolution.decayCardCapable);
    const showDecision =
      tone === "due" &&
      Boolean(resolution && resolution.decide) &&
      cardCapable &&
      resolution.decayEnabled !== false;
    if (showDecision) {
      glyph = "leaf";
    }
    let line3 = null;
    if (tone === "due") {
      if (tier === "pre") {
        line3 = "PRE checklist · complete to resolve";
      } else if (tier === "post") {
        line3 = "POST closeout · complete to close review";
      } else if (tier === "pending" || tier === "next") {
        line3 = "Alt+F keep · Alt+N release · Ctrl+Shift+Enter today";
      } else if (showDecision) {
        line3 = "Alt+F to decide";
      } else {
        line3 = "Alt+F to confirm";
      }
    }
    // Folded keep streak: the resolution's evaluated count when
    // resolved (so consensus sees the row's count), else the source's
    // folded count. Unresolved marks show historical dots quietly with
    // counting-only wording and never decide.
    const keeps =
      resolution &&
      Number.isInteger(resolution.keeps) &&
      resolution.keeps >= 0
        ? resolution.keeps
        : Number.isInteger(source.keeps) && source.keeps > 0
          ? source.keeps
          : 0;
    const decide = Boolean(resolution && resolution.decide);
    const limit =
      resolution && Number.isInteger(resolution.decayKeeps)
        ? resolution.decayKeeps
        : 3;
    const cap = freshnessMarkDotCap(limit);
    const shown = Math.min(keeps, cap);
    const dots = keeps > 0 ? "•".repeat(shown) : null;
    const overflow = keeps > cap ? "+" + (keeps - cap) : null;
    const keepsLine =
      resolution != null
        ? freshnessMarkKeepsLine(keeps, {
            active: cardCapable,
            enabled: resolution.decayEnabled !== false,
            limit,
          })
        : freshnessMarkKeepsLine(keeps, {
            active: false,
            enabled: true,
            limit,
          });
    let tooltip = line1 + "\n" + line2;
    if (keepsLine !== null) {
      tooltip += "\n" + keepsLine;
    }
    if (line3 !== null) {
      tooltip += "\n" + line3;
    }
    return {
      text: source.text,
      fresh,
      ageDays,
      label: ageDays === 0 ? "today" : ageDays + "d",
      intervalDays: interval.days,
      intervalSource: interval.source,
      intervalLabel,
      remaining,
      tone,
      glyph,
      resolved: resolution !== null,
      keeps,
      decide,
      dots,
      overflow,
      tooltip,
    };
  } catch (error) {
    return null;
  }
}

// Consensus across candidate models: the model when at least one
// candidate exists and all are deep-equal, else null. Never throws.
function freshnessMarkConsensus(models) {
  try {
    if (!Array.isArray(models) || models.length === 0) {
      return null;
    }
    const first = JSON.stringify(models[0]);
    for (const model of models) {
      if (JSON.stringify(model) !== first) {
        return null;
      }
    }
    return models[0] === null || models[0] === undefined ? null : models[0];
  } catch (error) {
    return null;
  }
}

// Listener-free mark element, so it survives Dataview's innerHTML
// round-trip. `doc` provides `createElement`, `createElementNS`, and
// `createTextNode` so tests can pass a fake document. Never throws:
// bad input yields null.
function buildFreshnessMarkElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    const foldSpace = Boolean(options && options.foldSpace);
    const tone = model.tone;
    if (tone !== "today" && tone !== "aging" && tone !== "due" && tone !== "resting") {
      return null;
    }
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-fresh-mark");
    span.setAttribute("data-tone", tone);
    span.setAttribute("data-resolved", model.resolved ? "true" : "false");
    span.setAttribute("data-fold-space", foldSpace ? "true" : "false");
    span.setAttribute(
      "data-decide",
      model.glyph === "leaf" ? "true" : "false",
    );
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", String(model.tooltip || ""));
    span.setAttribute("data-tooltip-position", "top");
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bob-fresh-mark-glyph");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const track = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "bob-fresh-mark-track");
    track.setAttribute("cx", "8");
    track.setAttribute("cy", "8");
    track.setAttribute("r", "6");
    if (model.glyph === "check") {
      track.setAttribute("opacity", "1");
      svg.appendChild(track);
      const tick = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      tick.setAttribute("d", "M5.4 8.2l1.8 1.8 3.4-3.6");
      svg.appendChild(tick);
    } else if (model.glyph === "refresh") {
      const arc = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      arc.setAttribute(
        "d",
        "M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33",
      );
      svg.appendChild(arc);
      const head = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      head.setAttribute("d", "M14 2v3.33h-3.33");
      svg.appendChild(head);
    } else if (model.glyph === "leaf") {
      // Active decision due (`docs/freshness.md` §2a): a code-native leaf
      // in the established 16-unit box and 1.9 stroke, inheriting the due
      // capsule's subdued orange — no new theme variables, no bitmap.
      const body = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      body.setAttribute(
        "d",
        "M12.8 3.2C7.6 3.4 4 6.6 3.4 12.6 9.4 12 12.6 8.4 12.8 3.2Z",
      );
      svg.appendChild(body);
      const vein = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      vein.setAttribute("d", "M4.2 11.8C6.6 9.4 9 7 11.8 4.2");
      svg.appendChild(vein);
    } else {
      svg.appendChild(track);
      if (model.remaining > 0) {
        const arc = doc.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        arc.setAttribute("class", "bob-fresh-mark-arc");
        arc.setAttribute("cx", "8");
        arc.setAttribute("cy", "8");
        arc.setAttribute("r", "6");
        arc.setAttribute("pathLength", "100");
        arc.setAttribute(
          "stroke-dasharray",
          (model.remaining * 100).toFixed(2) + " 100",
        );
        arc.setAttribute("transform", "rotate(-90 8 8)");
        svg.appendChild(arc);
      }
    }
    span.appendChild(svg);
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-fresh-mark-label");
    label.appendChild(doc.createTextNode(String(model.label || "")));
    span.appendChild(label);
    // Folded keep pips: filled dots (about 0.34em with 0.14em gaps via
    // CSS), capped per threshold with `+N` overflow. The dots are
    // aria-hidden; the exact count lives in the accessible tooltip
    // text. Dots stay faint on every tone — never green on `today`,
    // subdued orange in a `due` capsule — with no red, border, or
    // achievement styling.
    if (typeof model.dots === "string" && model.dots !== "") {
      const pips = doc.createElement("span");
      pips.setAttribute("class", "bob-fresh-mark-dots");
      pips.setAttribute("aria-hidden", "true");
      pips.appendChild(
        doc.createTextNode(
          model.dots +
            (typeof model.overflow === "string" ? model.overflow : ""),
        ),
      );
      span.appendChild(pips);
    }
    if (model.intervalLabel !== null && model.intervalLabel !== undefined) {
      const suffix = doc.createElement("span");
      suffix.setAttribute("class", "bob-fresh-mark-interval");
      suffix.appendChild(doc.createTextNode(String(model.intervalLabel)));
      span.appendChild(suffix);
    }
    return span;
  } catch (error) {
    return null;
  }
}
