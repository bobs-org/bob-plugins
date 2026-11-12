// Lane-walker footer view and its read-only Work Log detail helpers.
// This fragment mirrors the lane walk notice's work-log presentation without
// reaching across to bob-navigation-hotkeys during a cursor update.
const LANE_WALKER_FOOTER_LANES = Object.freeze([
  Object.freeze({ key: "pending", label: "WIP", cap: "maxPending", hint: "release" }),
  Object.freeze({ key: "next", label: "NEXT", cap: "maxNext", hint: "release" }),
  Object.freeze({ key: "ready", label: "READY", cap: "maxReady", hint: "next" }),
]);

const LANE_WALKER_FOOTER_BULLET_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s/;
const LANE_WALKER_FOOTER_WORK_LOG_PARENT_RE =
  /^(?<indent>\s*(?:>\s*)*)(?<marker>(?:[-*+]|\d+[.)]))[ \t]+(?<emoji>🛠️[ \t]+)?\*\*(?<label>WORK LOG|Work log):?\*\*[ \t]*$/;
const LANE_WALKER_FOOTER_WORK_LOG_ENTRY_RE =
  /^\s*(?:[-*+]|\d+[.)])\s+\*(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\*\s+—\s+(.+?)\s*$/;
const LANE_WALKER_FOOTER_DAY_MS = 24 * 60 * 60 * 1000;

function laneWalkerFooterIndentWidth(line) {
  try {
    const prefix = /^(\s*(?:>\s*)*)/.exec(String(line || ""));
    const indent = prefix ? prefix[1] : "";
    let width = 0;
    for (const character of indent) {
      if (character === "\t") {
        width += 4 - (width % 4);
      } else if (character === ">") {
        width += 4;
      } else {
        width += 1;
      }
    }
    return width;
  } catch (error) {
    return 0;
  }
}

function laneWalkerFooterNearestParent(lines, childLine) {
  try {
    const source = Array.isArray(lines) ? lines : [];
    const child = Math.floor(Number(childLine));
    if (!Number.isFinite(child) || child <= 0 || child >= source.length) {
      return null;
    }
    const childWidth = laneWalkerFooterIndentWidth(source[child]);
    for (let index = child - 1; index >= 0; index -= 1) {
      const line = String(source[index] || "");
      if (!line.trim() || laneWalkerFooterIndentWidth(line) >= childWidth) {
        continue;
      }
      if (LANE_WALKER_FOOTER_BULLET_RE.test(line)) {
        return index;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function laneWalkerFooterChildBlock(lines, parentLine) {
  const source = Array.isArray(lines) ? lines : [];
  const parent = Math.floor(Number(parentLine));
  if (!Number.isFinite(parent) || parent < 0 || parent >= source.length) {
    return { startLine: 0, endLineExclusive: 0 };
  }
  const parentWidth = laneWalkerFooterIndentWidth(source[parent]);
  let endLineExclusive = parent + 1;
  for (let index = parent + 1; index < source.length; index += 1) {
    const line = String(source[index] || "");
    if (!line.trim()) {
      continue;
    }
    if (laneWalkerFooterIndentWidth(line) > parentWidth) {
      endLineExclusive = index + 1;
      continue;
    }
    break;
  }
  return { startLine: parent + 1, endLineExclusive };
}

function laneWalkerFooterDateDay(dateText) {
  try {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ""));
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return Math.floor(date.getTime() / LANE_WALKER_FOOTER_DAY_MS);
  } catch (error) {
    return null;
  }
}

// Read the newest direct-child Work Log entry under a task line. Its grammar
// mirrors the lane toast: `*YYYY-MM-DD HH:MM* — summary` (time is optional).
// Ambiguous markers and malformed newest entries deliberately yield no chip.
function laneWalkerFooterReadLatestWorkLog(lines, taskLine) {
  try {
    const source = Array.isArray(lines) ? lines : [];
    const task = Math.floor(Number(taskLine));
    if (!Number.isFinite(task) || task < 0 || task >= source.length) {
      return null;
    }
    const taskBlock = laneWalkerFooterChildBlock(source, task);
    const parents = [];
    for (let index = taskBlock.startLine; index < taskBlock.endLineExclusive; index += 1) {
      if (laneWalkerFooterNearestParent(source, index) !== task) {
        continue;
      }
      const match = LANE_WALKER_FOOTER_WORK_LOG_PARENT_RE.exec(source[index] || "");
      if (match) {
        parents.push(index);
      }
    }
    if (parents.length !== 1) {
      return null;
    }
    const logBlock = laneWalkerFooterChildBlock(source, parents[0]);
    const entries = [];
    for (let index = logBlock.startLine; index < logBlock.endLineExclusive; index += 1) {
      if (laneWalkerFooterNearestParent(source, index) === parents[0]) {
        entries.push(String(source[index] || ""));
      }
    }
    if (entries.length === 0) {
      return null;
    }
    const match = LANE_WALKER_FOOTER_WORK_LOG_ENTRY_RE.exec(entries[0]);
    if (!match || laneWalkerFooterDateDay(match[1]) === null) {
      return null;
    }
    if (match[2] !== undefined) {
      const hour = Number(match[2].slice(0, 2));
      const minute = Number(match[2].slice(3, 5));
      if (hour > 23 || minute > 59) {
        return null;
      }
    }
    const summary = String(match[3] || "").trim();
    if (!summary) {
      return null;
    }
    return Object.freeze({
      date: match[1],
      time: match[2] || null,
      summary: summary.length > 48 ? `${summary.slice(0, 48)}…` : summary,
    });
  } catch (error) {
    return null;
  }
}

function laneWalkerFooterWorkLogLabel(workLog) {
  try {
    if (!workLog || !workLog.date || !workLog.summary) {
      return "";
    }
    const date = freshnessReviewShortDate(workLog.date);
    const time = typeof workLog.time === "string" && workLog.time
      ? ` ${workLog.time}`
      : "";
    return `🛠️ ${date}${time} — ${workLog.summary}`;
  } catch (error) {
    return "";
  }
}

function laneWalkerFooterAgeLabel(kind, dateText, todayText) {
  const dateDay = laneWalkerFooterDateDay(dateText);
  const todayDay = laneWalkerFooterDateDay(todayText);
  if (dateDay === null || todayDay === null) {
    return "";
  }
  const elapsed = todayDay - dateDay;
  const verb = kind === "created" ? "created" : "worked";
  if (elapsed < 0) {
    return `${verb} ${freshnessReviewShortDate(dateText)}`;
  }
  if (elapsed === 0) {
    return `${verb} today`;
  }
  if (elapsed === 1) {
    return kind === "created" ? "created yesterday" : "worked yesterday";
  }
  return `${verb} ${elapsed}d ago`;
}

function laneWalkerFooterSafeCount(counts, key, fallback) {
  const value = counts && counts[key];
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  return Number.isInteger(fallback) && fallback >= 0 ? fallback : 0;
}

function laneWalkerFooterGroups(counts, caps, currentLane) {
  const groups = [];
  for (const lane of LANE_WALKER_FOOTER_LANES) {
    if (lane.key === currentLane) {
      continue;
    }
    const count = laneWalkerFooterSafeCount(counts, lane.key, 0);
    const cap = Number.isInteger(caps && caps[lane.cap]) && caps[lane.cap] > 0
      ? caps[lane.cap]
      : null;
    const display = cap !== null && count > cap ? `${count}/${cap}` : String(count);
    groups.push({ key: lane.key, label: lane.label, count: display });
  }
  return groups;
}

// Pure view over one immutable api.laneWalk v2 result. Cursor positions are
// accepted only for the exact entry object from this snapshot, so stale rows
// never borrow a fraction after a move, release, delete, or refresh.
function laneWalkerFooterView(queue, options = {}) {
  try {
    if (!queue || queue.available !== true || !Array.isArray(queue.entries)) {
      return freshnessFooterHiddenView();
    }
    const entries = queue.entries;
    const counts = queue.counts && typeof queue.counts === "object"
      ? queue.counts
      : {};
    const total = entries.length;
    const pending = laneWalkerFooterSafeCount(counts, "pending", 0);
    const next = laneWalkerFooterSafeCount(counts, "next", 0);
    const ready = laneWalkerFooterSafeCount(counts, "ready", 0);
    const today =
      laneWalkerFooterSafeCount(counts, "todayPending", 0) +
      laneWalkerFooterSafeCount(counts, "todayNext", 0) +
      laneWalkerFooterSafeCount(counts, "todayReady", 0);
    const review = laneWalkerFooterSafeCount(counts, "reviewReady", 0);
    const caps = effectivePlanCaps(options.caps || defaultPlanCaps());
    const cursor =
      options.cursor &&
      typeof options.cursor === "object" &&
      typeof options.cursor.sourceLine === "string"
        ? options.cursor
        : null;
    const matched = cursor ? freshnessMatchQueueCursor(entries, cursor) : null;
    const currentIndex = matched ? entries.indexOf(matched) : -1;
    const current =
      currentIndex >= 0 &&
      Number.isInteger(matched.rank) &&
      matched.rank === currentIndex + 1 &&
      matched.total === total &&
      LANE_WALKER_FOOTER_LANES.some((lane) => lane.key === matched.lane)
        ? matched
        : null;
    const currentLane = current ? current.lane : null;
    const currentLaneInfo = current
      ? LANE_WALKER_FOOTER_LANES.find((lane) => lane.key === current.lane)
      : null;
    const groups = total > 0
      ? laneWalkerFooterGroups({ pending, next, ready }, caps, currentLane)
      : review > 0
        ? [{ key: "review", label: "REVIEW", count: String(review) }]
        : [];
    const groupsText = groups
      .map((group) => `${group.label} ${group.count}`)
      .join(" · ");
    const quickRoll = options.quickRoll && options.quickRoll.ok === true
      ? options.quickRoll
      : null;
    const workLog = options.workLog && typeof options.workLog === "object"
      ? options.workLog
      : null;
    const todayText = typeof queue.date === "string" ? queue.date : "";
    let dueText = "";
    let contextText = "";
    let detailText = "";
    let hintText = "";
    let meterText = "";
    let currentView = null;
    if (current && currentLaneInfo) {
      const laneCount = laneWalkerFooterSafeCount(counts, current.lane, 0);
      const laneTotal = Number.isInteger(current.laneTotal) && current.laneTotal === laneCount
        ? current.laneTotal
        : null;
      const laneRank = Number.isInteger(current.laneRank) && current.laneRank >= 1 && laneTotal !== null
        ? current.laneRank
        : null;
      dueText = `Lanes ${current.rank}/${total}`;
      contextText = laneRank !== null
        ? `${currentLaneInfo.label} ${laneRank}/${laneTotal}`
        : currentLaneInfo.label;
      detailText =
        laneWalkerFooterAgeLabel("worked", workLog && workLog.date, todayText) ||
        laneWalkerFooterAgeLabel("created", current.created, todayText);
      hintText = `Alt+N ${currentLaneInfo.hint}`;
      meterText = `TODAY ${today}`;
      currentView = {
        key: current.key || null,
        lane: current.lane,
        rank: current.rank,
        total,
        laneRank,
        laneTotal,
      };
    } else if (total > 0) {
      dueText = `Lanes ${total}`;
      contextText = "]] next";
      hintText = quickRoll && typeof quickRoll.compact === "string"
        ? quickRoll.compact
        : "";
      meterText = `TODAY ${today}`;
    } else {
      dueText = today > 0 || review > 0
        ? "Lanes clear"
        : "No Pending, Next, or Ready tasks";
      hintText = review > 0 ? "]s walks NEW and ROTTEN" : "";
      meterText = today > 0 ? `TODAY ${today}` : "";
    }
    const laneRows = LANE_WALKER_FOOTER_LANES.map((lane) => {
      const count = laneWalkerFooterSafeCount(counts, lane.key, 0);
      const cap = caps[lane.cap];
      const suffix = count > cap ? ` of ${cap} (over)` : ` of ${cap}`;
      return `${lane.label} ${count}${suffix}`;
    });
    const tooltipLines = [
      freshnessFooterJoin([dueText, contextText, detailText, hintText]),
      groupsText,
      total > 0 ? `${total} tasks off today's plan` : "",
      total > 0 ? laneRows.join(" · ") : "",
      today > 0 ? `TODAY ${today} already planned` : "",
      review > 0 ? `REVIEW ${review} wait in ]s` : "",
      current && workLog ? laneWalkerFooterWorkLogLabel(workLog) : "",
      current && quickRoll && typeof quickRoll.compact === "string"
        ? quickRoll.compact
        : "",
      quickRoll && typeof quickRoll.detail === "string" ? quickRoll.detail : "",
      "]] / [[ step · ]} / [{ jump lanes",
    ].filter(Boolean);
    const tooltip = tooltipLines.join("\n");
    return {
      visible: true,
      panel: "lanes",
      glyph: "≡",
      mode: "lanes",
      walk: total,
      commitments: 0,
      dueText,
      contextText,
      detailText,
      detailCompactText: detailText,
      hintText,
      groups,
      groupsText,
      meterText,
      tooltip,
      ariaLabel: freshnessFooterJoin([
        dueText,
        contextText,
        detailText,
        groupsText,
        meterText,
        hintText,
      ]),
      current: currentView,
      action: "jump",
      answer: null,
    };
  } catch (error) {
    return freshnessFooterHiddenView();
  }
}
