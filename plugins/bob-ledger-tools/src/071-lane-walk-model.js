// --- Lane walk queue (api.laneWalk v2) --------------------------------------
// Pure Pending/Next/Ready-off-Today walk list behind the navigation
// `]w` / `[w` and `]W` / `[W` keys. PENDING / NEXT membership is the dash
// section predicate (`dashboardLaneSectionVisible`); READY membership is
// the gated READY chip (`readyLaneScanFromTasks`). Today tasks are
// counted then dropped. Order is lane-first (PENDING = 0, NEXT = 1,
// READY = 2, matching the dash and chips), then path (raw string
// compare), then 1-based line, so each lane walks top to bottom through
// each note and the lanes appear in dash order. A task that matches more
// than one lane lands only in the first one (PENDING, then NEXT, then
// READY).

function laneWalkLaneOrder(lane) {
  if (lane === "ready") {
    return 2;
  }
  if (lane === "next") {
    return 1;
  }
  return 0;
}

function laneWalkLaneLabel(lane) {
  if (lane === "ready") {
    return "READY";
  }
  if (lane === "next") {
    return "NEXT";
  }
  return "PENDING";
}

function laneWalkCompareEntries(left, right) {
  const laneDiff =
    laneWalkLaneOrder(left.lane) - laneWalkLaneOrder(right.lane);
  if (laneDiff !== 0) {
    return laneDiff;
  }
  return freshnessComparePathLine(left, right);
}

function laneWalkEntryFromTask(task, index, list, todayDay, todayFlag, lane) {
  let row = null;
  try {
    row = freshnessRowFromTask(task, index, {
      list,
      todayDay,
      isToday: () => todayFlag,
    });
  } catch (error) {
    row = null;
  }
  const path = row ? String(row.path || "") : planTaskPath(task) || "";
  if (!path) {
    return null;
  }
  const line = row && Number.isInteger(row.line) ? row.line : index + 1;
  const lineNumber =
    row && Number.isInteger(row.lineNumber) ? row.lineNumber : line - 1;
  const originalMarkdown =
    row && typeof row.originalMarkdown === "string"
      ? row.originalMarkdown
      : typeof task.originalMarkdown === "string"
        ? task.originalMarkdown
        : "";
  const text =
    row && typeof row.text === "string"
      ? row.text
      : typeof task.description === "string"
        ? task.description
        : "";
  const blockId = row ? row.blockId || null : planTaskBlockId(task);
  const created =
    row && (row.created === null || typeof row.created === "string")
      ? row.created
      : null;
  const key = row ? freshnessRowKey(row) : `${path}:${line}`;
  return {
    key,
    path,
    line,
    lineNumber,
    originalMarkdown,
    text,
    blockId,
    lane,
    laneLabel: laneWalkLaneLabel(lane),
    created,
    rank: 0,
    total: 0,
    laneRank: 0,
    laneTotal: 0,
  };
}

// Pure queue over Tasks-plugin task objects. `now` sets the local day for
// future-schedule exclusion; `isToday` is the caller's Today predicate.
// `options.isReviewBucket` is the same READY gate the chip uses. Returns
// a frozen `{ entries, counts }` where each entry carries
// `{ key, path, line, lineNumber, originalMarkdown, text, blockId, lane,
// laneLabel, created, rank, total, laneRank, laneTotal }` and `counts` is
// `{ pending, next, ready, total, todayPending, todayNext, todayReady,
// reviewReady }`. Per PENDING / NEXT lane, `entries.length` equals
// `dashboardLaneBudgetFromTasks(...).section`; READY `entries.length`
// equals `readyCountFromTasks(...)` on the same snapshot. Throws only
// when `isToday` throws.
function laneWalkQueueFromTasks(tasks, now, isToday, options = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(now === undefined ? new Date() : now);
  const isTodayPredicate =
    typeof isToday === "function" ? isToday : () => false;
  const isReviewBucket =
    options && typeof options.isReviewBucket === "function"
      ? options.isReviewBucket
      : null;
  const built = [];
  const claimed = new Set();
  let todayPending = 0;
  let todayNext = 0;
  for (let index = 0; index < list.length; index += 1) {
    const task = list[index];
    let lane = null;
    if (dashboardLaneSectionVisible(task, list, todayDay, "pending")) {
      lane = "pending";
    } else if (dashboardLaneSectionVisible(task, list, todayDay, "next")) {
      lane = "next";
    } else {
      continue;
    }
    let todayFlag = false;
    try {
      todayFlag = Boolean(isTodayPredicate(task));
    } catch (error) {
      throw error;
    }
    if (todayFlag) {
      if (lane === "pending") {
        todayPending += 1;
      } else {
        todayNext += 1;
      }
      continue;
    }
    const entry = laneWalkEntryFromTask(
      task,
      index,
      list,
      todayDay,
      todayFlag,
      lane,
    );
    if (!entry) {
      continue;
    }
    claimed.add(index);
    built.push(entry);
  }
  const scan = readyLaneScanFromTasks(
    list,
    now,
    isTodayPredicate,
    isReviewBucket,
  );
  for (const index of scan.members) {
    if (claimed.has(index)) {
      continue;
    }
    const task = list[index];
    const entry = laneWalkEntryFromTask(
      task,
      index,
      list,
      todayDay,
      false,
      "ready",
    );
    if (!entry) {
      continue;
    }
    built.push(entry);
  }
  built.sort(laneWalkCompareEntries);
  const total = built.length;
  const laneTotals = { pending: 0, next: 0, ready: 0 };
  for (const entry of built) {
    const lane =
      entry.lane === "next" || entry.lane === "ready" ? entry.lane : "pending";
    laneTotals[lane] += 1;
  }
  const laneSeen = { pending: 0, next: 0, ready: 0 };
  const entries = built.map((entry, at) => {
    const lane =
      entry.lane === "next" || entry.lane === "ready" ? entry.lane : "pending";
    laneSeen[lane] += 1;
    return Object.freeze({
      ...entry,
      rank: at + 1,
      total,
      laneRank: laneSeen[lane],
      laneTotal: laneTotals[lane],
    });
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    counts: Object.freeze({
      pending: laneTotals.pending,
      next: laneTotals.next,
      ready: laneTotals.ready,
      total,
      todayPending,
      todayNext,
      todayReady: scan.today,
      reviewReady: scan.review,
    }),
  });
}
