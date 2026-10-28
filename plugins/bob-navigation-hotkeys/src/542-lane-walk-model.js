// Lane-walk pure model: planning, anchors, work-log reads, and notice
// models. Reuses the review-walk identity, repeat, date, and display
// helpers; nothing here touches Obsidian.
const LANE_WALK_REQUIRED_API_VERSION = 1;

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
    if (!Number.isInteger(laneWalk.version) || laneWalk.version < 1) {
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

function laneWalkOrderOf(entry) {
  return entry && entry.lane === "next" ? 1 : 0;
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

// Anchor: `{ day, key, lane, path, line, text }`, recorded after every
// successful landing and cleared on unload.
function buildLaneWalkAnchor(entry, todayText) {
  try {
    const day = typeof todayText === "string" ? todayText : "";
    const key =
      entry && typeof entry.key === "string" && entry.key
        ? entry.key
        : reviewQueueEntryKey(entry);
    return Object.freeze({
      day,
      key,
      lane: entry && entry.lane === "next" ? "next" : "pending",
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

// Pure jump planner. Returns `{ kind: "empty" }` or
// `{ kind: "jump", entry, rank, total, laneRank, laneTotal, wrapped, origin }`.
// `direction` is +1 (`]w`) or -1 (`[w`); `endpoint` is "first", "last", or
// truthy for the directional end; `repeat` is N steps with wrap.
function planLaneWalkJump(list, options = {}) {
  const rows = Array.isArray(list) ? list.slice() : [];
  if (rows.length === 0) {
    return Object.freeze({ kind: "empty" });
  }
  const direction = options.direction < 0 ? -1 : 1;
  const endpointRaw =
    options && typeof options.endpoint === "string"
      ? options.endpoint.trim().toLowerCase()
      : "";
  const endpointFlag =
    endpointRaw === "first" || endpointRaw === "last"
      ? endpointRaw
      : options && options.endpoint
        ? direction < 0
          ? "first"
          : "last"
        : null;
  if (endpointFlag === "first" || endpointFlag === "last") {
    const index = endpointFlag === "first" ? 0 : rows.length - 1;
    const entry = rows[index];
    return Object.freeze({
      kind: "jump",
      entry,
      rank: index + 1,
      total: rows.length,
      laneRank: entry.laneRank,
      laneTotal: entry.laneTotal,
      wrapped: false,
      origin: null,
    });
  }
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
  const finish = (at, wrapped, origin) => {
    const step = Object.freeze({
      kind: "jump",
      entry: rows[at],
      rank: at + 1,
      total: rows.length,
      laneRank: rows[at].laneRank,
      laneTotal: rows[at].laneTotal,
      wrapped: Boolean(wrapped),
      origin: origin || null,
    });
    const repeat = normalizeVimRepeat(options.repeat);
    if (repeat <= 1) {
      return step;
    }
    const extra = repeat - 1;
    const raw = at + direction * extra;
    const rem = raw % rows.length;
    const finalIndex = rem < 0 ? rem + rows.length : rem;
    const finalEntry = rows[finalIndex];
    return Object.freeze({
      kind: "jump",
      entry: finalEntry,
      rank: finalIndex + 1,
      total: rows.length,
      laneRank: finalEntry.laneRank,
      laneTotal: finalEntry.laneTotal,
      wrapped: Boolean(wrapped) || raw < 0 || raw >= rows.length,
      origin: origin || null,
    });
  };
  const cursorIndex = cursor ? findReviewCursorIndex(rows, cursor, new Set()) : -1;
  if (cursorIndex >= 0) {
    let index = cursorIndex + direction;
    let wrapped = false;
    if (index < 0) {
      index = rows.length - 1;
      wrapped = true;
    } else if (index >= rows.length) {
      index = 0;
      wrapped = true;
    }
    return finish(index, wrapped, "cursor");
  }
  if (anchor) {
    const anchorKey =
      typeof anchor.key === "string" && anchor.key ? anchor.key : null;
    const anchorIndex =
      anchorKey !== null
        ? rows.findIndex((entry) => reviewQueueEntryKey(entry) === anchorKey)
        : -1;
    if (anchorIndex >= 0) {
      let index = anchorIndex + direction;
      let wrapped = false;
      if (index < 0) {
        index = rows.length - 1;
        wrapped = true;
      } else if (index >= rows.length) {
        index = 0;
        wrapped = true;
      }
      return finish(index, wrapped, "anchor");
    }
    const anchorTuple = {
      lane:
        anchor.lane === "next" ? "next" : anchor.lane === "pending" ? "pending" : null,
      path: typeof anchor.path === "string" ? anchor.path : "",
      line: Number.isInteger(anchor.line) ? anchor.line : 0,
    };
    if (anchorTuple.lane !== null && anchorTuple.path) {
      if (direction > 0) {
        for (let index = 0; index < rows.length; index += 1) {
          if (laneWalkTupleCompare(anchorTuple, rows[index]) < 0) {
            return finish(index, false, "anchor-gap");
          }
        }
        return finish(0, true, "anchor-gap");
      }
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (laneWalkTupleCompare(anchorTuple, rows[index]) > 0) {
          return finish(index, false, "anchor-gap");
        }
      }
      return finish(rows.length - 1, true, "anchor-gap");
    }
  }
  if (direction < 0) {
    return finish(rows.length - 1, false, null);
  }
  return finish(0, false, null);
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

// Pure notice model for one landing. `context` is
// `{ rank, total, wrapped, list, noteName, workLog }`; `list` is the full
// walk list for the rail (entries carry `lane`). Falls back to the entry's
// own rank/total when the plan rank is missing.
function buildLaneWalkNoticeModel(entry, context = {}) {
  try {
    const lane = entry && entry.lane === "next" ? "next" : "pending";
    const laneLabel = lane === "next" ? "NEXT" : "PENDING";
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
      ? list.map((item) => (item && item.lane === "next" ? "next" : "pending"))
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
      railLanes && railLanes.length > 30
        ? "bar"
        : "dots";
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
    const today = todayPending + todayNext;
    const model = {
      empty: true,
      lanesClear: true,
      hasToday: today > 0,
      today,
      todayPending,
      todayNext,
    };
    model.text =
      today > 0
        ? `Lanes clear · Every Pending and Next task is on today's plan · TODAY ${today}`
        : "Lanes clear · No Pending or Next tasks";
    return Object.freeze(model);
  } catch (error) {
    return Object.freeze({
      empty: true,
      lanesClear: true,
      hasToday: false,
      today: 0,
      todayPending: 0,
      todayNext: 0,
      text: "Lanes clear · No Pending or Next tasks",
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
        : "Lanes clear · No Pending or Next tasks";
    }
    const laneLabel =
      model.lane === "next" ? "NEXT" : model.laneLabel || "PENDING";
    const head = `${laneLabel} ${model.laneRank} of ${model.laneTotal} · walk ${model.rank}/${model.total}`;
    const title = String(model.title || "").trim() || "(untitled task)";
    const parts = [`${head} — ${title}`];
    if (model.workLog && model.workLog.date && model.workLog.summary) {
      parts.push(`🛠️ ${reviewShortDate(model.workLog.date)} — ${model.workLog.summary}`);
    } else if (model.created) {
      parts.push(`created ${reviewShortDate(model.created)}`);
    }
    parts.push("Ctrl+Shift+Enter today · Alt+N release");
    let text = parts.join(" · ");
    if (model.wrapped === true) {
      text += " · wrapped around";
    }
    return text;
  } catch (error) {
    return "";
  }
}
