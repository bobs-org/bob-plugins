// The tiered review queue NEW → PROJECTS → PENDING → NEXT → RETURNED
// → REFERENCES → ROTTEN, with each tier's comparator from
// `docs/freshness.md` §4.
// Entries
// carry `{ key, path, line, lineNumber, text, originalMarkdown,
// blockId, state (null for lane rows), bucket, tier (machine),
// tierLabel, lane, created, fresh, dueOn, daysOverdue, interval,
// intervalSource, keeps, decide, rank, tierRank, tierTotal }` with
// 1-based `line` (Tasks' `lineNumber` is 0-based). `decide` means a
// choice is due, not permission to execute an action.
function freshnessQueue(rows, todayText, config) {
  const list = Array.isArray(rows) ? rows : [];
  const entries = [];
  for (const row of list) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const evaluated = freshnessEvaluate(row, todayText, config);
    if (evaluated.tier === null || evaluated.tier === undefined) {
      continue;
    }
    if (evaluated.lane === null || evaluated.lane === undefined) {
      continue;
    }
    entries.push({
      key: freshnessRowKey(row),
      path: String(row.path || ""),
      line: row.line,
      lineNumber:
        Number.isInteger(row.lineNumber) ? row.lineNumber : row.line - 1,
      text: typeof row.text === "string" ? row.text : "",
      originalMarkdown:
        typeof row.originalMarkdown === "string" ? row.originalMarkdown : "",
      blockId: row.blockId || null,
      state: evaluated.state,
      bucket: freshnessBucketForState(evaluated.state),
      tier: evaluated.tier,
      tierLabel: freshnessTierLabel(evaluated.tier),
      lane: evaluated.lane,
      created:
        row.created === undefined || row.created === null
          ? null
          : String(row.created),
      fresh: evaluated.fresh,
      dueOn: evaluated.dueOn,
      daysOverdue: evaluated.daysOverdue,
      interval: evaluated.intervalDays,
      intervalSource: evaluated.intervalSource,
      keeps: evaluated.keeps,
      decide: evaluated.decide,
      rank: 0,
      tierRank: 0,
      tierTotal: 0,
    });
  }

  entries.sort((left, right) => {
    const tierOrder =
      (FRESHNESS_TIER_ORDER[left.tier] ?? 99) -
      (FRESHNESS_TIER_ORDER[right.tier] ?? 99);
    if (tierOrder !== 0) {
      return tierOrder;
    }
    if (left.tier === "new") {
      return freshnessComparePathLine(left, right);
    }
    if (
      left.tier === "projects" ||
      left.tier === "pending" ||
      left.tier === "next" ||
      left.tier === "references"
    ) {
      return (
        freshnessCompareDueOn(left.dueOn, right.dueOn) ||
        freshnessCompareCreated(left.created, right.created, false) ||
        freshnessComparePathLine(left, right)
      );
    }
    if (left.tier === "returned") {
      return (
        freshnessCompareDueOn(left.dueOn, right.dueOn) ||
        freshnessCompareCreated(left.created, right.created, true) ||
        freshnessComparePathLine(left, right)
      );
    }
    return (
      left.interval - right.interval ||
      freshnessCompareDueOn(left.dueOn, right.dueOn) ||
      freshnessCompareCreated(left.created, right.created, true) ||
      freshnessComparePathLine(left, right)
    );
  });

  const totals = {};
  for (const entry of entries) {
    totals[entry.tier] = (totals[entry.tier] || 0) + 1;
  }
  const seen = {};
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    entry.rank = index + 1;
    seen[entry.tier] = (seen[entry.tier] || 0) + 1;
    entry.tierRank = seen[entry.tier];
    entry.tierTotal = totals[entry.tier] || 0;
  }
  return entries;
}

function freshnessIsExcludedCountPath(path) {
  return String(path || "")
    .split("/")
    .some((segment) => segment === "_templates" || segment === "_conflicts");
}

// Whole-vault counts: `{ due, new, resurfaced, rotten, fresh,
// pendingDue, nextDue, projectsDue, referencesDue, byTier, walk, decide,
// refreshedToday, upkeepToday, budget, budgetMet }`. State totals
// (`due = new + resurfaced + rotten`) count evaluated Ready states
// over the full review universe, including eligible Ready trackers
// once each; `byTier` counts the actual full queue and `walk` sums
// it. `decide` counts the rows where a choice is due (never
// permission to act). `refreshedToday` counts tasks of any status
// outside `_templates` / `_conflicts` whose `fresh` equals today;
// `upkeepToday` counts those whose status symbol is neither `/` nor
// `*`. `budgetMet` compares the budget against upkeep, with zero NEW.
// Mirrors `counts` in `src/native/freshness/state.rs`.
function freshnessCounts(rows, todayText, config) {
  const today = freshnessNormalizeDateText(todayText);
  const list = Array.isArray(rows) ? rows : [];
  let due = 0;
  let freshNew = 0;
  let resurfaced = 0;
  let rotten = 0;
  let fresh = 0;
  const byTier = {
    new: 0,
    projects: 0,
    pending: 0,
    next: 0,
    returned: 0,
    references: 0,
    rotten: 0,
  };
  let decide = 0;
  let refreshedToday = 0;
  let upkeepToday = 0;

  for (const row of list) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const evaluated = freshnessEvaluate(row, today, config);
    if (evaluated.decide) {
      decide += 1;
    }
    if (
      !freshnessIsExcludedCountPath(row.path) &&
      evaluated.fresh === today
    ) {
      refreshedToday += 1;
      let symbol = null;
      try {
        if (
          row.statusSymbol !== undefined &&
          row.statusSymbol !== null &&
          String(row.statusSymbol) !== ""
        ) {
          symbol = String(row.statusSymbol)[0];
        } else {
          symbol = freshnessTaskStatus(row.rawLine || "");
        }
      } catch (error) {
        symbol = null;
      }
      if (symbol !== "/" && symbol !== "*") {
        upkeepToday += 1;
      }
    }
    if (evaluated.state === "new") {
      freshNew += 1;
      due += 1;
    } else if (evaluated.state === "resurfaced") {
      resurfaced += 1;
      due += 1;
    } else if (evaluated.state === "rotten") {
      rotten += 1;
      due += 1;
    } else if (evaluated.state === "fresh") {
      fresh += 1;
    }
    if (
      evaluated.tier === "new" ||
      evaluated.tier === "projects" ||
      evaluated.tier === "pending" ||
      evaluated.tier === "next" ||
      evaluated.tier === "returned" ||
      evaluated.tier === "references" ||
      evaluated.tier === "rotten"
    ) {
      byTier[evaluated.tier] += 1;
    }
  }

  const rawBudget =
    config && config.rottenDailyBudget !== undefined
      ? config.rottenDailyBudget
      : null;
  const budget =
    Number.isInteger(rawBudget) && rawBudget >= 1 ? rawBudget : null;
  const budgetMet =
    budget !== null && upkeepToday >= budget && freshNew === 0;
  const walk =
    byTier.new +
    byTier.projects +
    byTier.pending +
    byTier.next +
    byTier.returned +
    byTier.references +
    byTier.rotten;

  return {
    due,
    new: freshNew,
    resurfaced,
    rotten,
    fresh,
    pendingDue: byTier.pending,
    nextDue: byTier.next,
    projectsDue: byTier.projects,
    referencesDue: byTier.references,
    byTier: { ...byTier },
    walk,
    decide,
    refreshedToday,
    upkeepToday,
    budget,
    budgetMet,
  };
}

const FRESHNESS_LINT_MESSAGES = {
  fresh_malformed: "fresh date is not a YYYY-MM-DD calendar date",
  fresh_future: "fresh date is in the future",
  fresh_duplicate: "more than one fresh field; the latest valid date wins",
  fresh_misplaced:
    "fresh/refresh/keeps sits inside the Tasks suffix; the next stamp repairs it",
  refresh_invalid: "refresh is not an integer 1-365",
  keeps_invalid: "keeps is not an integer 1-999",
  keeps_duplicate: "more than one keeps field; the first valid count wins",
  task_refresh_invalid: "task_refresh is not an integer 1-365",
  freshness_stale_daily_budget_deprecated:
    "freshness.stale_daily_budget is deprecated; use freshness.rotten_daily_budget",
};

// Per-occurrence lints in row order: `{ code, path, line, message }`.
function freshnessCollectLints(rows, todayText, config) {
  const today = freshnessNormalizeDateText(todayText);
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const evaluated = freshnessEvaluate(row, today, config);
    for (const code of evaluated.lints) {
      out.push({
        code,
        path: String(row.path || ""),
        line: row.line,
        message: FRESHNESS_LINT_MESSAGES[code] || code,
      });
    }
  }
  return out;
}

// Pure view-model for the status bar counter. `counts` is a
// `freshnessCounts` result; `mostOverdue` is the queue's largest
// `daysOverdue` (or null when nothing is due). The meter shows
// upkeep (`upkeepToday`); ROTTEN includes RETURNED, as on the chip.
// Hidden references still count here (they walk through the status
// bar, `]s`, and the CLI). Mirrors `docs/freshness.md` §4 (freshness
// namespace v5).
function freshnessStatusView(counts, options = {}) {
  const tasksAvailable = options.tasksAvailable !== false;
  if (!tasksAvailable) {
    return {
      text: "⟳ –",
      tooltip: "Tasks unavailable",
      mode: "unavailable",
    };
  }
  const safe = counts || {};
  // Tier counts drive the surfaces so the shown numbers sum to
  // `walk`. Without a `byTier` histogram fall back to the legacy
  // state counts. The rotten number keeps folding RETURNED in.
  const tierCount = (key, legacy) => {
    if (safe.byTier && typeof safe.byTier === "object") {
      const value = safe.byTier[key];
      if (Number.isInteger(value) && value >= 0) {
        return value;
      }
    }
    return Number.isInteger(legacy) && legacy >= 0 ? legacy : 0;
  };
  const tierNew = tierCount("new", safe.new);
  const tierProjects = tierCount("projects", safe.projectsDue);
  const tierPending = tierCount("pending", safe.pendingDue);
  const tierNext = tierCount("next", safe.nextDue);
  const tierReturned = tierCount("returned", safe.resurfaced);
  const tierReferences = tierCount("references", safe.referencesDue);
  const tierRotten = tierCount("rotten", safe.rotten);
  const rotten = tierReturned + tierRotten;
  const walk =
    Number.isInteger(safe.walk) && safe.walk >= 0
      ? safe.walk
      : tierNew +
        tierProjects +
        tierPending +
        tierNext +
        tierReturned +
        tierReferences +
        tierRotten;
  const upkeep =
    Number.isInteger(safe.upkeepToday) && safe.upkeepToday >= 0
      ? safe.upkeepToday
      : Number.isInteger(safe.refreshedToday) && safe.refreshedToday >= 0
        ? safe.refreshedToday
        : 0;
  const budget =
    Number.isInteger(safe.budget) && safe.budget >= 1 ? safe.budget : null;
  const meter = budget !== null ? upkeep + "/" + budget : String(upkeep);
  const text =
    "⟳ " +
    tierNew +
    " new · " +
    tierProjects +
    " projects · " +
    tierPending +
    " pending · " +
    tierNext +
    " next · " +
    tierReferences +
    " references · " +
    rotten +
    " rotten · ✓ " +
    meter +
    " today";
  const mostOverdue =
    Number.isInteger(options.mostOverdue) && options.mostOverdue >= 0
      ? options.mostOverdue
      : null;
  const tooltip =
    "Walk " +
    walk +
    " · NEW " +
    tierNew +
    " · PROJECTS " +
    tierProjects +
    " · PENDING " +
    tierPending +
    " · NEXT " +
    tierNext +
    " · RETURNED " +
    tierReturned +
    " · REFERENCES " +
    tierReferences +
    " · ROTTEN " +
    tierRotten +
    (mostOverdue === null
      ? " · nothing due"
      : " · oldest " + mostOverdue + "d overdue") +
    " · ✓ " +
    meter +
    " today";
  // Mode precedence: `new` (NEW > 0), then `due` while any
  // commitment tier (NEW, PROJECTS, PENDING, NEXT, RETURNED,
  // REFERENCES) remains, then `budget` (met), then `clear` (walk
  // empty), else `due`. The raw `budgetMet` formula is unchanged;
  // outstanding commitment tiers (including PROJECTS and REFERENCES)
  // take precedence in this mode.
  let mode = "due";
  if (tierNew > 0) {
    mode = "new";
  } else if (
    tierProjects > 0 ||
    tierPending > 0 ||
    tierNext > 0 ||
    tierReturned > 0 ||
    tierReferences > 0
  ) {
    mode = "due";
  } else if (safe.budgetMet) {
    mode = "budget";
  } else if (walk === 0) {
    mode = "clear";
  } else {
    mode = "due";
  }
  return { text, tooltip, mode };
}

