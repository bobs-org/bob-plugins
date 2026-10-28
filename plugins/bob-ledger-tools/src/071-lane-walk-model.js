// --- Lane walk queue (api.laneWalk v1) --------------------------------------
// Pure Pending/Next-off-Today walk list behind the navigation `]w` / `[w`
// keys. Membership is the dash PENDING/NEXT section predicate
// (`dashboardLaneSectionVisible`), minus every task with a dedicated Task
// Link under today's open Pomodoros (`isToday`). Order is lane-first
// (PENDING = 0, NEXT = 1, matching the dash and chips), then path (raw
// string compare), then 1-based line, so each lane walks top to bottom
// through each note and the lanes appear in dash order.

function laneWalkLaneOrder(lane) {
  return lane === "next" ? 1 : 0;
}

function laneWalkCompareEntries(left, right) {
  const laneDiff =
    laneWalkLaneOrder(left.lane) - laneWalkLaneOrder(right.lane);
  if (laneDiff !== 0) {
    return laneDiff;
  }
  return freshnessComparePathLine(left, right);
}

// Pure queue over Tasks-plugin task objects. `now` sets the local day for
// future-schedule exclusion; `isToday` is the caller's Today predicate.
// Returns a frozen `{ entries, counts }` where each entry carries
// `{ key, path, line, lineNumber, originalMarkdown, text, blockId, lane,
// laneLabel, created, rank, total, laneRank, laneTotal }` and `counts` is
// `{ pending, next, total, todayPending, todayNext }`. Per lane,
// `entries.length` equals `dashboardLaneBudgetFromTasks(...).section` on
// the same snapshot. Throws only when `isToday` throws.
function laneWalkQueueFromTasks(tasks, now, isToday, options = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(now === undefined ? new Date() : now);
  const isTodayPredicate =
    typeof isToday === "function" ? isToday : () => false;
  const order =
    options && typeof options.order === "string" ? options.order : "lane";
  void order;
  const built = [];
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
      continue;
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
    built.push({
      key,
      path,
      line,
      lineNumber,
      originalMarkdown,
      text,
      blockId,
      lane,
      laneLabel: lane === "next" ? "NEXT" : "PENDING",
      created,
      rank: 0,
      total: 0,
      laneRank: 0,
      laneTotal: 0,
    });
  }
  built.sort(laneWalkCompareEntries);
  const total = built.length;
  let pendingTotal = 0;
  let nextTotal = 0;
  for (const entry of built) {
    if (entry.lane === "pending") {
      pendingTotal += 1;
    } else {
      nextTotal += 1;
    }
  }
  let pendingSeen = 0;
  let nextSeen = 0;
  const entries = built.map((entry, at) => {
    let laneRank = 0;
    let laneTotal = 0;
    if (entry.lane === "pending") {
      pendingSeen += 1;
      laneRank = pendingSeen;
      laneTotal = pendingTotal;
    } else {
      nextSeen += 1;
      laneRank = nextSeen;
      laneTotal = nextTotal;
    }
    return Object.freeze({
      ...entry,
      rank: at + 1,
      total,
      laneRank,
      laneTotal,
    });
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    counts: Object.freeze({
      pending: pendingTotal,
      next: nextTotal,
      total,
      todayPending,
      todayNext,
    }),
  });
}
