// Lane-walk pure model: planning, anchors, work-log reads, and notice
// models. Reuses the review-walk identity, repeat, date, and display
// helpers; nothing here touches Obsidian.
const LANE_WALK_REQUIRED_API_VERSION = 2;
const LANE_WALK_LANES = Object.freeze(["pending", "next", "ready"]);

function getLaneWalkApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const api =
      plugins &&
      plugins["bob-ledger-tools"] &&
      plugins["bob-ledger-tools"].api;
    const laneWalk = api && api.laneWalk;
    if (!laneWalk || typeof laneWalk !== "object") {
      return null;
    }
    if (
      !Number.isInteger(laneWalk.version) ||
      laneWalk.version < LANE_WALK_REQUIRED_API_VERSION
    ) {
      return null;
    }
    if (typeof laneWalk.queue !== "function") {
      return null;
    }
    return laneWalk;
  } catch (error) {
    return null;
  }
}

function normalizeLaneWalkLane(lane) {
  if (lane === "pending" || lane === "next" || lane === "ready") {
    return lane;
  }
  return null;
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

function laneWalkOrderOf(entry) {
  const lane = normalizeLaneWalkLane(entry && entry.lane);
  if (lane === "ready") {
    return 2;
  }
  if (lane === "next") {
    return 1;
  }
  return 0;
}

function laneWalkTupleCompare(left, right) {
  const laneDiff = laneWalkOrderOf(left) - laneWalkOrderOf(right);
  if (laneDiff !== 0) {
    return laneDiff;
  }
  const leftPath = String((left && left.path) || "");
  const rightPath = String((right && right.path) || "");
  if (leftPath !== rightPath) {
    return leftPath < rightPath ? -1 : 1;
  }
  const leftLine = Number.isInteger(left && left.line) ? left.line : 0;
  const rightLine = Number.isInteger(right && right.line) ? right.line : 0;
  return leftLine - rightLine;
}

function laneWalkEntryKey(entry) {
  try {
    return reviewQueueEntryKey(entry);
  } catch (error) {
    return entry && typeof entry.key === "string" ? entry.key : "";
  }
}

// Anchor: `{ day, key, lane, path, line, text }`, recorded after every
// successful landing and cleared on unload.
function buildLaneWalkAnchor(entry, todayText) {
  try {
    const day = typeof todayText === "string" ? todayText : "";
    const key =
      entry && typeof entry.key === "string" && entry.key
        ? entry.key
        : reviewQueueEntryKey(entry);
    const lane = normalizeLaneWalkLane(entry && entry.lane) || "pending";
    return Object.freeze({
      day,
      key,
      lane,
      path: entry && typeof entry.path === "string" ? entry.path : "",
      line: entry && Number.isInteger(entry.line) ? entry.line : 0,
      text:
        entry && typeof entry.originalMarkdown === "string"
          ? entry.originalMarkdown
          : "",
    });
  } catch (error) {
    return null;
  }
}

function laneWalkAnchorIsCurrentDay(anchor, todayText) {
  try {
    return reviewAnchorIsCurrentDay(anchor, todayText);
  } catch (error) {
    return false;
  }
}

function resolveLaneWalkOrigin(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const todayText =
    options && typeof options.todayText === "string" ? options.todayText : "";
  const cursor =
    options.cursor && typeof options.cursor === "object"
      ? options.cursor
      : null;
  let anchor =
    options.anchor && typeof options.anchor === "object"
      ? options.anchor
      : null;
  if (anchor && !laneWalkAnchorIsCurrentDay(anchor, todayText)) {
    anchor = null;
  }
  const freeze = (kind, index, tuple, lane) =>
    Object.freeze({
      kind,
      index: Number.isInteger(index) ? index : -1,
      tuple: tuple || null,
      lane: normalizeLaneWalkLane(lane) || null,
    });
  const none = () => freeze(null, -1, null, null);
  const anchorKey =
    anchor && typeof anchor.key === "string" && anchor.key
      ? anchor.key
      : null;
  const anchorLane = anchor ? normalizeLaneWalkLane(anchor.lane) : null;
  const anchorTuple = () => {
    if (!anchor || !anchorLane) {
      return null;
    }
    const path = typeof anchor.path === "string" ? anchor.path : "";
    if (!path) {
      return null;
    }
    return {
      lane: anchorLane,
      path,
      line: Number.isInteger(anchor.line) ? anchor.line : 0,
    };
  };
  const laneChange = () => {
    const tuple = anchorTuple();
    if (!tuple) {
      return none();
    }
    return freeze("lane-change", -1, tuple, tuple.lane);
  };
  const cursorIndex = cursor
    ? findReviewCursorIndex(list, cursor, new Set())
    : -1;
  if (cursorIndex >= 0) {
    const entry = list[cursorIndex];
    if (
      anchor &&
      anchorKey &&
      laneWalkEntryKey(entry) === anchorKey &&
      normalizeLaneWalkLane(entry && entry.lane) !== anchorLane
    ) {
      return laneChange();
    }
    return freeze("cursor", cursorIndex, entry, entry && entry.lane);
  }
  if (anchor) {
    const anchorIndex =
      anchorKey !== null
        ? list.findIndex((entry) => laneWalkEntryKey(entry) === anchorKey)
        : -1;
    if (anchorIndex >= 0) {
      const entry = list[anchorIndex];
      if (normalizeLaneWalkLane(entry && entry.lane) !== anchorLane) {
        return laneChange();
      }
      return freeze("anchor", anchorIndex, entry, entry && entry.lane);
    }
    const tuple = anchorTuple();
    if (tuple) {
      return freeze("anchor-gap", -1, tuple, tuple.lane);
    }
  }
  return none();
}

function finishLaneWalkJump(rows, at, wrapped, origin, extra = {}) {
  const step = Object.freeze({
    kind: "jump",
    entry: rows[at],
    rank: at + 1,
    total: rows.length,
    laneRank: rows[at].laneRank,
    laneTotal: rows[at].laneTotal,
    wrapped: Boolean(wrapped),
    origin: origin || null,
    ...extra,
  });
  return step;
}

function applyLaneWalkRepeat(rows, at, direction, wrapped, origin, repeat) {
  const count = normalizeVimRepeat(repeat);
  if (count <= 1) {
    return finishLaneWalkJump(rows, at, wrapped, origin);
  }
  const extra = count - 1;
  const raw = at + direction * extra;
  const rem = raw % rows.length;
  const finalIndex = rem < 0 ? rem + rows.length : rem;
  return finishLaneWalkJump(
    rows,
    finalIndex,
    Boolean(wrapped) || raw < 0 || raw >= rows.length,
    origin,
  );
}

function planLaneWalkFromTuple(rows, tuple, direction, originKind) {
  if (direction > 0) {
    for (let index = 0; index < rows.length; index += 1) {
      if (laneWalkTupleCompare(tuple, rows[index]) < 0) {
        return { at: index, wrapped: false, origin: originKind };
      }
    }
    return { at: 0, wrapped: true, origin: originKind };
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (laneWalkTupleCompare(tuple, rows[index]) > 0) {
      return { at: index, wrapped: false, origin: originKind };
    }
  }
  return { at: rows.length - 1, wrapped: true, origin: originKind };
}

// Pure jump planner. Returns `{ kind: "empty" }` or
// `{ kind: "jump", entry, rank, total, laneRank, laneTotal, wrapped, origin }`.
// `direction` is +1 (`]w`) or -1 (`[w`); `repeat` is N steps with wrap.
function planLaneWalkJump(list, options = {}) {
  const rows = Array.isArray(list) ? list.slice() : [];
  if (rows.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const direction = options.direction < 0 ? -1 : 1;
  const origin = resolveLaneWalkOrigin(rows, options);
  const finish = (at, wrapped, originKind) =>
    applyLaneWalkRepeat(
      rows,
      at,
      direction,
      wrapped,
      originKind,
      options.repeat,
    );
  if (origin.kind === "cursor" || origin.kind === "anchor") {
    let index = origin.index + direction;
    let wrapped = false;
    if (index < 0) {
      index = rows.length - 1;
      wrapped = true;
    } else if (index >= rows.length) {
      index = 0;
      wrapped = true;
    }
    return finish(index, wrapped, origin.kind);
  }
  if (
    (origin.kind === "anchor-gap" || origin.kind === "lane-change") &&
    origin.tuple
  ) {
    const stepped = planLaneWalkFromTuple(
      rows,
      origin.tuple,
      direction,
      origin.kind,
    );
    return finish(stepped.at, stepped.wrapped, stepped.origin);
  }
  if (direction < 0) {
    return finish(rows.length - 1, false, null);
  }
  return finish(0, false, null);
}

function laneWalkOccupiedLanes(rows) {
  const present = new Set();
  for (const entry of rows) {
    const lane = normalizeLaneWalkLane(entry && entry.lane);
    if (lane) {
      present.add(lane);
    }
  }
  return LANE_WALK_LANES.filter((lane) => present.has(lane));
}

function laneWalkFirstIndexOfLane(rows, lane) {
  return rows.findIndex(
    (entry) => normalizeLaneWalkLane(entry && entry.lane) === lane,
  );
}

function stepOccupiedLane(occupied, fromLane, direction) {
  const ring = LANE_WALK_LANES;
  const start = ring.indexOf(fromLane);
  const fromIndex = start >= 0 ? start : direction > 0 ? -1 : ring.length;
  let wrapped = false;
  let found = occupied[0];
  for (let n = 1; n <= ring.length; n += 1) {
    let idx = fromIndex + direction * n;
    if (idx >= ring.length || idx < 0) {
      wrapped = true;
      idx = ((idx % ring.length) + ring.length) % ring.length;
    }
    const lane = ring[idx];
    if (occupied.includes(lane)) {
      found = lane;
      break;
    }
  }
  return { lane: found, wrapped };
}

// Pure lane-jump planner for `]W` / `[W`. Lands on the first task of the
// next / previous non-empty lane, cycling, skipping empty lanes.
function planLaneWalkLaneJump(list, options = {}) {
  const rows = Array.isArray(list) ? list.slice() : [];
  if (rows.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const direction = options.direction < 0 ? -1 : 1;
  const occupied = laneWalkOccupiedLanes(rows);
  if (occupied.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const origin = resolveLaneWalkOrigin(rows, options);
  const steps = Math.max(1, normalizeVimRepeat(options.repeat));
  const fromLane = origin.lane;
  let wrapped = false;
  let targetLane = occupied[0];
  if (!origin.kind || fromLane === null) {
    if (direction > 0) {
      const raw = -1 + steps;
      const idx = ((raw % occupied.length) + occupied.length) % occupied.length;
      targetLane = occupied[idx];
      wrapped = raw >= occupied.length || raw < 0;
    } else {
      const raw = occupied.length - steps;
      const idx = ((raw % occupied.length) + occupied.length) % occupied.length;
      targetLane = occupied[idx];
      wrapped = raw < 0 || raw >= occupied.length;
    }
  } else {
    let current = fromLane;
    for (let s = 0; s < steps; s += 1) {
      const stepped = stepOccupiedLane(occupied, current, direction);
      current = stepped.lane;
      wrapped = wrapped || stepped.wrapped;
    }
    targetLane = current;
  }
  const index = laneWalkFirstIndexOfLane(rows, targetLane);
  if (index < 0) {
    return Object.freeze({ kind: "empty" });
  }
  return finishLaneWalkJump(rows, index, wrapped, origin.kind, {
    fromLane,
    laneJump: true,
  });
}

// Latest Work Log entry for the task at 0-based `taskLine` in `content`.
// Built on `findManagedTaskLogParents(..., WORK)`. Entries are newest-first
// `*YYYY-MM-DD* — summary`. More than one WORK LOG marker, a missing
// parent, or a malformed newest entry means no chip (null).
function readLatestWorkLog(content, taskLine) {
  try {
    const lines = String(content || "").split(/\r?\n/);
    const line = Math.floor(numericOrDefault(taskLine, Number.NaN));
    if (!Number.isFinite(line) || line < 0 || line >= lines.length) {
      return null;
    }
    const parents = findManagedTaskLogParents(
      lines,
      line,
      MANAGED_TASK_LOG_KIND_WORK,
    );
    if (!Array.isArray(parents) || parents.length !== 1) {
      return null;
    }
    const parentLine = parents[0].line;
    const entries = [];
    for (let index = parentLine + 1; index < lines.length; index += 1) {
      let owner = null;
      try {
        owner = findNearestParentListItem(lines, index);
      } catch (error) {
        owner = null;
      }
      if (owner !== parentLine) {
        const indentOk = lines[index] && lines[index].trim() !== "";
        if (indentOk) {
          const block = findCurrentBulletChildBlock(lines, parentLine);
          if (index >= block.endLineExclusive) {
            break;
          }
        }
        continue;
      }
      entries.push(String(lines[index] || ""));
    }
    if (entries.length === 0) {
      return null;
    }
    const newest = entries[0];
    const match = /^\s*(?:[-*+]|\d+[.)])\s+\*(\d{4}-\d{2}-\d{2})\*\s+—\s+(.+?)\s*$/.exec(
      newest,
    );
    if (!match) {
      return null;
    }
    const date = match[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return null;
    }
    const summaryRaw = String(match[2] || "").trim();
    if (!summaryRaw) {
      return null;
    }
    const summary =
      summaryRaw.length > 48 ? `${summaryRaw.slice(0, 48)}…` : summaryRaw;
    return Object.freeze({ date, summary });
  } catch (error) {
    return null;
  }
}

function laneWalkNoteName(path) {
  const base = String(path || "").split("/").pop() || "";
  return base.replace(/\.md$/i, "");
}

function laneWalkHintAction(lane) {
  return lane === "ready" ? "next" : "release";
}

// Pure notice model for one landing. `context` is
// `{ rank, total, wrapped, list, noteName, workLog }`; `list` is the full
// walk list for the rail (entries carry `lane`). Falls back to the entry's
// own rank/total when the plan rank is missing.
function buildLaneWalkNoticeModel(entry, context = {}) {
  try {
    const lane = normalizeLaneWalkLane(entry && entry.lane) || "pending";
    const laneLabel = laneWalkLaneLabel(lane);
    const rank =
      Number.isInteger(context.rank) && context.rank >= 1
        ? context.rank
        : Number.isInteger(entry && entry.rank)
          ? entry.rank
          : 1;
    const total =
      Number.isInteger(context.total) && context.total >= 1
        ? context.total
        : Number.isInteger(entry && entry.total)
          ? entry.total
          : 1;
    const laneRank =
      Number.isInteger(context.laneRank) && context.laneRank >= 1
        ? context.laneRank
        : Number.isInteger(entry && entry.laneRank)
          ? entry.laneRank
          : 1;
    const laneTotal =
      Number.isInteger(context.laneTotal) && context.laneTotal >= 1
        ? context.laneTotal
        : Number.isInteger(entry && entry.laneTotal)
          ? entry.laneTotal
          : 1;
    const list = Array.isArray(context.list) ? context.list : null;
    const railLanes = list
      ? list.map(
          (item) => normalizeLaneWalkLane(item && item.lane) || "pending",
        )
      : null;
    const wrapped = context.wrapped === true;
    const title = cleanTaskDisplayText(
      (entry && entry.originalMarkdown) || (entry && entry.text) || "",
    );
    const noteName =
      typeof context.noteName === "string" && context.noteName
        ? context.noteName
        : laneWalkNoteName(entry && entry.path);
    const workLog =
      context.workLog && typeof context.workLog === "object"
        ? context.workLog
        : null;
    const created =
      entry && typeof entry.created === "string" && entry.created
        ? entry.created
        : null;
    const railMode =
      railLanes && railLanes.length > 30 ? "bar" : "dots";
    const model = {
      empty: false,
      lane,
      laneLabel,
      laneRank,
      laneTotal,
      rank,
      total,
      wrapped,
      title,
      noteName,
      workLog,
      created,
      hintAction: laneWalkHintAction(lane),
      railMode,
      railLanes: railLanes ? Object.freeze(railLanes.slice()) : null,
      railTotal: railLanes ? railLanes.length : total,
    };
    model.text = formatLaneWalkNoticeText(model);
    return Object.freeze(model);
  } catch (error) {
    const fallback = {
      empty: false,
      lane: "pending",
      laneLabel: "PENDING",
      laneRank: 1,
      laneTotal: 1,
      rank: 1,
      total: 1,
      wrapped: false,
      title: "(untitled task)",
      noteName: "",
      workLog: null,
      created: null,
      hintAction: "release",
      railMode: "dots",
      railLanes: null,
      railTotal: 1,
    };
    fallback.text = formatLaneWalkNoticeText(fallback);
    return Object.freeze(fallback);
  }
}

function buildLaneWalkEmptyNoticeModel(counts = {}) {
  try {
    const todayPending = Math.max(
      0,
      Math.floor(numericOrDefault(counts.todayPending, 0)),
    );
    const todayNext = Math.max(
      0,
      Math.floor(numericOrDefault(counts.todayNext, 0)),
    );
    const todayReady = Math.max(
      0,
      Math.floor(numericOrDefault(counts.todayReady, 0)),
    );
    const reviewReady = Math.max(
      0,
      Math.floor(numericOrDefault(counts.reviewReady, 0)),
    );
    const today = todayPending + todayNext + todayReady;
    const review = reviewReady;
    let title;
    let text;
    if (review > 0) {
      title = "Ready tasks are waiting in review";
      const parts = ["Lanes clear", title, `REVIEW ${review}`];
      if (today > 0) {
        parts.push(`TODAY ${today}`);
      }
      parts.push("]s walks NEW and ROTTEN");
      text = parts.join(" · ");
    } else if (today > 0) {
      title = "Every Pending, Next, and Ready task is on today's plan";
      text = `Lanes clear · ${title} · TODAY ${today}`;
    } else {
      title = "No Pending, Next, or Ready tasks";
      text = `Lanes clear · ${title}`;
    }
    return Object.freeze({
      empty: true,
      lanesClear: true,
      hasToday: today > 0,
      hasReview: review > 0,
      today,
      todayPending,
      todayNext,
      todayReady,
      review,
      reviewReady,
      title,
      hint: review > 0 ? "]s walks NEW and ROTTEN" : null,
      text,
    });
  } catch (error) {
    return Object.freeze({
      empty: true,
      lanesClear: true,
      hasToday: false,
      hasReview: false,
      today: 0,
      todayPending: 0,
      todayNext: 0,
      todayReady: 0,
      review: 0,
      reviewReady: 0,
      title: "No Pending, Next, or Ready tasks",
      hint: null,
      text: "Lanes clear · No Pending, Next, or Ready tasks",
    });
  }
}

function formatLaneWalkNoticeText(model) {
  try {
    if (!model || typeof model !== "object") {
      return "";
    }
    if (model.empty === true) {
      return typeof model.text === "string" && model.text
        ? model.text
        : "Lanes clear · No Pending, Next, or Ready tasks";
    }
    const lane = normalizeLaneWalkLane(model.lane);
    const laneLabel = lane
      ? laneWalkLaneLabel(lane)
      : model.laneLabel || "PENDING";
    const head = `${laneLabel} ${model.laneRank} of ${model.laneTotal} · walk ${model.rank}/${model.total}`;
    const title = String(model.title || "").trim() || "(untitled task)";
    const parts = [`${head} — ${title}`];
    if (model.workLog && model.workLog.date && model.workLog.summary) {
      parts.push(
        `🛠️ ${reviewShortDate(model.workLog.date)} — ${model.workLog.summary}`,
      );
    } else if (model.created) {
      parts.push(`created ${reviewShortDate(model.created)}`);
    }
    const action = laneWalkHintAction(lane);
    parts.push(`Ctrl+Shift+Enter today · Alt+N ${action}`);
    let text = parts.join(" · ");
    if (model.wrapped === true) {
      text += " · wrapped around";
    }
    return text;
  } catch (error) {
    return "";
  }
}
