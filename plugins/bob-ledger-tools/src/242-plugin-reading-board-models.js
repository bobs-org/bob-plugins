// --- Reading Board pure view models (bob-cli-99.2) ------------------------
// Lane membership and blocking reasons come from `bob ref list`. These
// helpers arrange and label those facts; they never inspect or write vault
// files and never reimplement bob's blocking rules.

const READING_BOARD_KIND_MAP = Object.freeze({
  ai: Object.freeze({ icon: "🤖", label: "AI" }),
  papers: Object.freeze({ icon: "📄", label: "Paper" }),
  blogs: Object.freeze({ icon: "📰", label: "Blog" }),
  docs: Object.freeze({ icon: "📚", label: "Docs" }),
  chat: Object.freeze({ icon: "💬", label: "Chat" }),
});

function readingBoardStripComment(value) {
  const text = String(value || "");
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") {
        quote = "";
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "#") {
      return text.slice(0, index).trim();
    }
  }
  return text.trim();
}

function readingBoardUnquote(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { ok: false, value: "" };
  }
  const first = text[0];
  const last = text[text.length - 1];
  if (first === "'" || first === '"') {
    if (last !== first || text.length < 2) {
      return { ok: false, value: "" };
    }
    return { ok: true, value: text.slice(1, -1).trim() };
  }
  return { ok: true, value: text };
}

function readingBoardParseTypeList(value) {
  let text = String(value || "").trim();
  const quoted = readingBoardUnquote(text);
  if (quoted.ok) {
    text = quoted.value;
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1).trim();
  }
  if (!text) {
    return null;
  }
  const values = [];
  for (const raw of text.split(",")) {
    const decoded = readingBoardUnquote(raw);
    if (!decoded.ok || !decoded.value) {
      return null;
    }
    values.push(decoded.value);
  }
  return values.length > 0 ? values : null;
}

// Parse the deliberately small YAML surface accepted by the board fence.
// Invalid lines and options become lints, never a failed board request.
function readingBoardParseFence(source) {
  const result = { parent: null, type: null, lints: [] };
  const seen = new Set();
  let pendingTypeList = false;
  let pendingTypes = [];
  const finishTypeList = () => {
    if (!pendingTypeList) {
      return;
    }
    if (pendingTypes.length === 0) {
      result.lints.push("Invalid type: use one or more comma-separated reference types.");
    } else {
      result.type = pendingTypes;
    }
    pendingTypeList = false;
    pendingTypes = [];
  };
  const lines = String(source || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = readingBoardStripComment(rawLine).trim();
    if (!line) {
      continue;
    }
    if (pendingTypeList) {
      const item = line.match(/^-\s*(.*)$/);
      if (item) {
        const value = readingBoardUnquote(item[1]);
        if (!value.ok || !value.value) {
          result.lints.push("Invalid type: use one or more comma-separated reference types.");
        } else {
          pendingTypes.push(value.value);
        }
        continue;
      }
      finishTypeList();
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) {
      result.lints.push(`Ignored invalid Reading Board setting: ${line}`);
      continue;
    }
    const key = match[1];
    const rawValue = match[2].trim();
    if (key !== "parent" && key !== "type") {
      result.lints.push(`Unknown Reading Board option: ${key}`);
      continue;
    }
    if (seen.has(key)) {
      result.lints.push(`Ignored duplicate Reading Board option: ${key}`);
      continue;
    }
    seen.add(key);
    if (key === "parent") {
      const decoded = readingBoardUnquote(rawValue);
      if (!decoded.ok || !decoded.value || /[\r\n]/.test(decoded.value)) {
        result.lints.push("Invalid parent: expected a note name.");
        continue;
      }
      result.parent = decoded.value;
      continue;
    }
    if (!rawValue) {
      pendingTypeList = true;
      continue;
    }
    const values = readingBoardParseTypeList(rawValue);
    if (!values) {
      result.lints.push("Invalid type: use one or more comma-separated reference types.");
      continue;
    }
    result.type = values;
  }
  finishTypeList();
  return result;
}

function readingBoardTitleParts(title) {
  const text = typeof title === "string" ? title : "";
  const parts = [];
  const code = /(`+)([\s\S]*?)\1/g;
  let last = 0;
  let match = null;
  while ((match = code.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", text: text.slice(last, match.index) });
    }
    parts.push({ type: "code", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length || parts.length === 0) {
    parts.push({ type: "text", text: text.slice(last) });
  }
  return parts;
}

function readingBoardKind(type) {
  const key = typeof type === "string" ? type.toLowerCase() : "";
  const known = READING_BOARD_KIND_MAP[key];
  if (known) {
    return { type: key, icon: known.icon, label: known.label, text: `${known.icon} ${known.label}` };
  }
  if (!key) {
    return { type: null, icon: "🔖", label: "Ref", text: "🔖 Ref" };
  }
  const label = key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
  return { type: key, icon: "🔖", label, text: `🔖 ${label}` };
}

function readingBoardTaskKey(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  const rawPath = typeof task.path === "string" ? task.path.trim() : "";
  const blockId = typeof task.block_id === "string" ? task.block_id.trim() : "";
  if (!rawPath || !blockId) {
    return null;
  }
  const path = /\.md$/i.test(rawPath) ? rawPath : `${rawPath}.md`;
  return `${path}#${blockId}`;
}

function readingBoardPriorityMarkModel(value) {
  const mark = priorityMarkModel(value);
  if (!mark) {
    return null;
  }
  const tooltip = String(mark.tooltip || "")
    .split("\n")
    .filter((line) => !line.startsWith("Ctrl+Shift+P to"))
    .join("\n");
  return Object.freeze({
    ...mark,
    tooltip,
    key: JSON.stringify([mark.value, mark.glyph, mark.filled, mark.label, tooltip]),
  });
}

function readingBoardDateMarkModel(field, date, today) {
  const mark = dateMarkModel(field, date, today);
  if (!mark) {
    return null;
  }
  const tooltip = String(mark.tooltip || "").split("\n")[0];
  return Object.freeze({
    ...mark,
    tooltip,
    key: JSON.stringify([mark.field, mark.date, mark.label, mark.when, tooltip]),
  });
}

function readingBoardTodayRankFor(key, todayRank) {
  if (!key) {
    return null;
  }
  let value;
  if (todayRank instanceof Map) {
    value = todayRank.get(key);
  } else if (todayRank && typeof todayRank === "object") {
    value = todayRank[key];
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readingBoardStrictDate(value) {
  const text = typeof value === "string" ? value : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    return null;
  }
  return { text, timestamp };
}

function readingBoardProjectStem(value) {
  const path = typeof value === "string" ? value : "";
  const name = path.split("/").filter(Boolean).pop() || path;
  return name.replace(/\.md$/i, "");
}

function readingBoardReasonModel(reasons, today, legacy = false) {
  const rows = Array.isArray(reasons) ? reasons : [];
  const dependencies = [];
  const projects = [];
  const schedules = [];
  const tooltips = [];
  for (const reason of rows) {
    if (!reason || typeof reason !== "object") {
      continue;
    }
    if (reason.kind === "local_dependency") {
      const prerequisites = Array.isArray(reason.prerequisites)
        ? reason.prerequisites.filter((item) => item && typeof item === "object")
        : [];
      const title = prerequisites[0] && prerequisites[0].title
        ? prerequisites[0].title
        : "a prerequisite";
      const extra = Math.max(0, prerequisites.length - 1);
      dependencies.push({
        text: `⛓ after ${title}${extra ? ` +${extra}` : ""}`,
        tooltip: extra
          ? `Waiting for ${title} and ${extra} more prerequisite${extra === 1 ? "" : "s"}.`
          : `Waiting for ${title}.`,
        prerequisites,
      });
      tooltips.push(dependencies[dependencies.length - 1].tooltip);
    } else if (reason.kind === "project") {
      const project = readingBoardProjectStem(reason.project) || "project";
      projects.push({
        text: `🧱 in blocked project ${project}`,
        tooltip: `Waiting for the ${project} project to unblock.`,
        project,
        link: typeof reason.link === "string" ? reason.link : null,
      });
      tooltips.push(projects[projects.length - 1].tooltip);
    } else if (reason.kind === "local_schedule") {
      const date = readingBoardStrictDate(reason.date);
      if (date) {
        const label = dateMarkLabel(date.text, today) || date.text;
        const mark = readingBoardDateMarkModel("scheduled", date.text, today);
        const tooltip = mark && mark.tooltip
          ? `Snoozed until ${mark.tooltip.replace(/^Scheduled\s+/i, "")}`
          : `Snoozed until ${date.text}`;
        schedules.push({ date: date.text, label, tooltip, mark });
        tooltips.push(tooltip);
      }
    }
  }
  const parts = [
    ...dependencies.map((entry) => entry.text),
    ...projects.map((entry) => entry.text),
  ];
  if (legacy) {
    parts.push("⏸ blocked");
    tooltips.push("Update bob-cli to see why this reference is snoozed.");
  }
  if (parts.length === 0 && rows.length > 0 && !schedules.length) {
    parts.push("⏸ blocked");
  }
  return {
    text: parts.join(" · "),
    tooltip: tooltips.join(" "),
    dependencies,
    projects,
    schedules,
  };
}

function readingBoardWeekEnd(today) {
  const parsed = readingBoardStrictDate(today);
  if (!parsed) {
    return null;
  }
  const day = new Date(parsed.timestamp).getUTCDay();
  const throughSunday = (7 - day) % 7;
  return parsed.timestamp + throughSunday * 24 * 60 * 60 * 1000;
}

function readingBoardScheduleGroup(date, today) {
  const wake = readingBoardStrictDate(date);
  const base = readingBoardStrictDate(today);
  if (!wake || !base) {
    return "waiting_on";
  }
  const thisWeekEnd = readingBoardWeekEnd(today);
  if (wake.timestamp <= thisWeekEnd) {
    return "this_week";
  }
  if (wake.text.slice(0, 7) === base.text.slice(0, 7)) {
    return "this_month";
  }
  return "later";
}

function readingBoardCardModel(row, order, context) {
  const task = row.task && typeof row.task === "object" ? row.task : null;
  const reasons = Array.isArray(row.blocked_by) ? row.blocked_by : [];
  const legacy = row._legacy_blocked_by === true ||
    (row.blocked === true && !Array.isArray(row.blocked_by));
  const reason = readingBoardReasonModel(reasons, context.today, legacy);
  const scheduleOnly =
    reasons.length === 1 &&
    reasons[0] &&
    reasons[0].kind === "local_schedule" &&
    reason.schedules.length === 1;
  let snoozedGroup = null;
  if (row.blocked === true) {
    if (legacy) {
      snoozedGroup = "waiting_on";
    } else if (reasons.length === 0) {
      snoozedGroup = "waking";
    } else if (scheduleOnly) {
      snoozedGroup = readingBoardScheduleGroup(reason.schedules[0].date, context.today);
    } else {
      snoozedGroup = "waiting_on";
    }
  }
  const taskKey = readingBoardTaskKey(task);
  const todayRank = context.todayReady
    ? readingBoardTodayRankFor(taskKey, context.todayRank)
    : null;
  const status = typeof row.status === "string" ? row.status : "";
  let returnLane = null;
  if (status === "next") {
    returnLane = { id: "next", text: "→ ⭐ Next" };
  } else if (status === "wip") {
    returnLane = { id: "reading", text: "→ 📖 Reading" };
  }
  const priority = task && typeof task.priority === "string" ? task.priority : null;
  const added = typeof row.added === "string" ? row.added : null;
  const waking = snoozedGroup === "waking";
  const wakeReturnLane = status === "next"
    ? "⭐ Next"
    : status === "wip"
      ? "📖 Reading"
      : "📥 Ready";
  return {
    path: typeof row.path === "string" ? row.path : "",
    title: typeof row.title === "string" ? row.title : "Untitled reference",
    titleParts: readingBoardTitleParts(row.title),
    kind: readingBoardKind(row.type),
    type: typeof row.type === "string" ? row.type : null,
    parent: typeof row.parent === "string" ? row.parent : null,
    status,
    blocked: row.blocked === true,
    task,
    taskKey,
    today: todayRank !== null,
    todayRank,
    priority,
    priorityMark: priority ? readingBoardPriorityMarkModel(priority) : null,
    added,
    addedMark: added ? readingBoardDateMarkModel("created", added, context.today) : null,
    audio: row.audio === true,
    annotationCount:
      Number.isInteger(row.annotation_count) && row.annotation_count > 0
        ? row.annotation_count
        : 0,
    source: typeof row.source === "string" ? row.source : null,
    sourcePdf: typeof row.source_pdf === "string" ? row.source_pdf : null,
    statusSync: typeof row.status_sync === "string" ? row.status_sync : "ok",
    snoozedGroup,
    wakeLabel: waking ? "⏰ now" : null,
    wakeTooltip: waking
      ? `No reason left — the next reconcile returns it to ${wakeReturnLane}.`
      : null,
    reasons,
    reasonText: reason.text,
    reasonTooltip: reason.tooltip,
    schedule: reason.schedules.length > 0 ? reason.schedules[0] : null,
    prerequisites: reason.dependencies.flatMap((entry) => entry.prerequisites),
    projects: reason.projects,
    returnLane,
    bobOrder: order,
  };
}

function readingBoardSortAwake(cards, todayReady) {
  return cards.sort((left, right) => {
    if (todayReady && left.today !== right.today) {
      return left.today ? -1 : 1;
    }
    if (todayReady && left.today && right.today && left.todayRank !== right.todayRank) {
      return left.todayRank - right.todayRank;
    }
    return left.bobOrder - right.bobOrder;
  });
}

function readingBoardSortScheduled(cards) {
  return cards.sort((left, right) => {
    const leftDate = left.schedule && left.schedule.date ? left.schedule.date : "";
    const rightDate = right.schedule && right.schedule.date ? right.schedule.date : "";
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }
    return left.bobOrder - right.bobOrder;
  });
}

function readingBoardModel(report, options = {}) {
  const source = report && typeof report === "object" ? report : {};
  const opts = options && typeof options === "object" ? options : {};
  const today = readingBoardStrictDate(opts.today)
    ? opts.today
    : readingBoardLocalDate(opts.now instanceof Date ? opts.now : new Date());
  const todayReady = opts.todayReady === true;
  const rows = Array.isArray(source.refs) ? source.refs : [];
  const filtered = rows.filter((row) =>
    row &&
    typeof row === "object" &&
    row.era === "modern" &&
    ["wip", "next", "ready"].includes(row.status),
  );
  const context = {
    today,
    todayReady,
    todayRank: opts.todayRank,
  };
  const cards = filtered.map((row, index) => readingBoardCardModel(row, index, context));
  const reading = readingBoardSortAwake(
    cards.filter((card) => !card.blocked && card.status === "wip"),
    todayReady,
  );
  const next = readingBoardSortAwake(
    cards.filter((card) => !card.blocked && card.status === "next"),
    todayReady,
  );
  const ready = readingBoardSortAwake(
    cards.filter((card) => !card.blocked && card.status === "ready"),
    todayReady,
  );
  const snoozedCards = cards.filter((card) => card.blocked);
  const groups = [
    { id: "waking", label: "Waking", cards: snoozedCards.filter((card) => card.snoozedGroup === "waking") },
    { id: "this_week", label: "This week", cards: readingBoardSortScheduled(snoozedCards.filter((card) => card.snoozedGroup === "this_week")) },
    { id: "this_month", label: "This month", cards: readingBoardSortScheduled(snoozedCards.filter((card) => card.snoozedGroup === "this_month")) },
    { id: "later", label: "Later", cards: readingBoardSortScheduled(snoozedCards.filter((card) => card.snoozedGroup === "later")) },
    { id: "waiting_on", label: "Waiting on", cards: snoozedCards.filter((card) => card.snoozedGroup === "waiting_on") },
  ];
  const awakeCount = reading.length + next.length + ready.length;
  const lints = Array.isArray(opts.lints)
    ? opts.lints.filter((lint) => typeof lint === "string" && lint.trim())
    : [];
  if (
    source._legacy_blocked_by === true ||
    snoozedCards.some((card) => card.snoozedGroup === "waiting_on" && card.reasonText === "⏸ blocked")
  ) {
    lints.push("Update bob-cli to see why references are snoozed.");
  }
  return {
    today,
    generatedAt: typeof source.generated_at === "string" ? source.generated_at : null,
    summary: { awake: awakeCount, snoozed: snoozedCards.length },
    lanes: {
      reading: { id: "reading", label: "📖 Reading", count: reading.length, cards: reading, emptyText: "Nothing in progress" },
      next: { id: "next", label: "⭐ Next", count: next.length, cards: next, emptyText: "Nothing next" },
      ready: { id: "ready", label: "📥 Ready", count: ready.length, cards: ready, emptyText: "Nothing ready" },
      snoozed: {
        id: "snoozed",
        label: "💤 Snoozed",
        count: snoozedCards.length,
        cards: groups.flatMap((group) => group.cards),
        groups,
        emptyText: "Nothing snoozed",
      },
    },
    emptyText: cards.length === 0 ? "Nothing queued ✓" : null,
    lints: [...new Set(lints)],
  };
}

function readingBoardSignature(model) {
  if (!model || typeof model !== "object") {
    return "";
  }
  const lane = (entry) =>
    (entry && Array.isArray(entry.cards) ? entry.cards : []).map((card) => [
      card.path,
      card.title,
      card.status,
      card.blocked,
      card.today,
      card.todayRank,
      card.priority,
      card.added,
      card.snoozedGroup,
      card.reasonText,
      card.schedule && card.schedule.date,
      card.sourcePdf,
      card.annotationCount,
      card.audio,
      card.statusSync,
    ]);
  return JSON.stringify({
    today: model.today,
    generatedAt: model.generatedAt,
    summary: model.summary,
    lints: model.lints,
    reading: lane(model.lanes && model.lanes.reading),
    next: lane(model.lanes && model.lanes.next),
    ready: lane(model.lanes && model.lanes.ready),
    snoozed: lane(model.lanes && model.lanes.snoozed),
  });
}
