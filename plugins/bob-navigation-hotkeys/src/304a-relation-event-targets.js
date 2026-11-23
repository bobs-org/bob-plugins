// Event Task targets for the Links stage (plan:202611/links_stage_event_tasks.md,
// decisions daily_scope=events, day_window=all_days).
// JS twin of bob-cli `src/native/event_task.rs` (`events_section_range`,
// `parse_event_span`, `clean_event_title`) and the `eventRunCleanTitle` twin in
// bob-ledger-tools `src/035-meet-event-run.js`. Fragment 304 is at its line
// cap, so the pure helpers live here. Comments cite the Rust functions;
// behavior copies the vectors the plan cites (LG25–LG29).

function isRelationStageDailyNotePath(path) {
  const normalized = String(path || "").replace(/\\/g, "");
  return /^\d{4}\/\d{8}\.md$/i.test(normalized);
}

function relationStageNoteDay(path) {
  const normalized = String(path || "").replace(/\\/g, "");
  const match = /^(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/i.exec(normalized);
  if (!match || match[1] !== match[2]) {
    return null;
  }
  try {
    if (typeof isValidDateParts === "function") {
      if (!isValidDateParts(match[2], match[3], match[4])) {
        return null;
      }
    }
  } catch (_error) {
    return null;
  }
  return `${match[2]}-${match[3]}-${match[4]}`;
}

// Twin of `event_task::events_section_range`: the half-open `## Events` body
// range over `lines`. Skips frontmatter and fenced rows through the shared
// line contexts, runs to the next level-two heading, and never throws.
function relationStageEventsSectionRange(lines) {
  const source = Array.isArray(lines) ? lines : [];
  let contexts = null;
  try {
    contexts = getMarkdownLineContextsForLines(source);
  } catch (_error) {
    contexts = null;
  }
  const isSkipped = (index) => {
    const context = contexts && contexts[index];
    return Boolean(context && (context.inFrontmatter || context.inFence));
  };
  const isEventsHeading = (lineText) => {
    const line = String(lineText || "");
    if (!line.startsWith("##")) {
      return false;
    }
    const rest = line.slice(2);
    if (rest[0] !== " " && rest[0] !== "\t") {
      return false;
    }
    return rest.trim() === "Events";
  };
  const isLevelTwoHeading = (lineText) => {
    const line = String(lineText || "");
    if (!line.startsWith("##")) {
      return false;
    }
    const rest = line.slice(2);
    return rest[0] === " " || rest[0] === "\t";
  };
  let start = null;
  for (let index = 0; index < source.length; index += 1) {
    if (isSkipped(index)) {
      continue;
    }
    const line = String(source[index] || "");
    if (start === null) {
      if (isEventsHeading(line)) {
        start = index + 1;
      }
    } else if (isLevelTwoHeading(line)) {
      return { start, end: index };
    }
  }
  if (start === null) {
    return null;
  }
  return { start, end: source.length };
}

function relationStageParseEventHhmm(value) {
  const text = String(value || "");
  if (text.length !== 4 || !/^\d{4}$/.test(text)) {
    return null;
  }
  const hour = Number(text.slice(0, 2));
  const minute = Number(text.slice(2));
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

// Twin of `event_task::parse_event_span`: a `#task` checkbox row whose text
// starts with `**HHMM-HHMM**`. Returns the `"HHMM-HHMM"` span or null.
function relationStageEventTaskSpan(rawLine) {
  const parsed = relationStageEventTaskSpanAndAfter(rawLine);
  return parsed ? parsed.span : null;
}

function relationStageEventTaskSpanAndAfter(rawLine) {
  let body = String(rawLine || "").replace(/^[ \t]+/, "");
  if (!body.startsWith("- ")) {
    return null;
  }
  body = body.slice(2);
  if (!body.startsWith("[")) {
    return null;
  }
  const close = body.indexOf("]");
  if (close === -1) {
    return null;
  }
  if ([...body.slice(1, close)].length !== 1) {
    return null;
  }
  body = body.slice(close + 1).replace(/^[ \t]+/, "");
  if (!body.startsWith("#task")) {
    return null;
  }
  body = body.slice("#task".length);
  if (body !== "" && body[0] !== " " && body[0] !== "\t") {
    return null;
  }
  body = body.replace(/^[ \t]+/, "");
  if (!body.startsWith("**")) {
    return null;
  }
  const raw = body.slice(2, 11);
  if (raw.length !== 9 || raw[4] !== "-") {
    return null;
  }
  if (body.slice(11, 13) !== "**") {
    return null;
  }
  const after = body.slice(13);
  if (after !== "" && after[0] !== " " && after[0] !== "\t") {
    return null;
  }
  for (let index = 0; index < 9; index += 1) {
    if (index === 4) {
      continue;
    }
    const char = raw[index];
    if (char < "0" || char > "9") {
      return null;
    }
  }
  if (
    relationStageParseEventHhmm(raw.slice(0, 4)) === null ||
    relationStageParseEventHhmm(raw.slice(5, 9)) === null
  ) {
    return null;
  }
  return { span: raw, after };
}

function relationStageMarkdownLinkEnd(text, open) {
  const rest = String(text || "").slice(open + 1);
  const textClose = rest.indexOf("]");
  if (textClose < 0) {
    return null;
  }
  const after = rest.slice(textClose + 1);
  if (!after.startsWith("(")) {
    return null;
  }
  const urlClose = after.slice(1).indexOf(")");
  if (urlClose < 0) {
    return null;
  }
  return open + 1 + textClose + 1 + 1 + urlClose + 1;
}

function relationStageStripTrailingField(title) {
  const trimmed = String(title || "").trimEnd();
  const open = trimmed.lastIndexOf("[");
  if (open < 0 || !trimmed.slice(open).includes("::") || !trimmed.endsWith("]")) {
    return trimmed;
  }
  return trimmed.slice(0, open).trimEnd();
}

// Twin of `clock_tags::strip_trailing_clock_tag`: removes one trailing
// standalone `#on` / `#off` (or deprecated alias) with its sentence
// punctuation. Repeated callers strip runs such as `#off #on`.
function relationStageStripTrailingClockTag(title) {
  const trimmed = String(title || "").trimEnd();
  const candidate = trimmed.replace(/[\]\)\}:.,;!?]+$/, "").trimEnd();
  const masked = candidate;
  const lower = masked.toLowerCase();
  const tags = ["#on", "#off", "#offclock", "#off-clock", "#untracked"];
  for (const tag of tags) {
    const start = lower.lastIndexOf(tag);
    if (start < 0 || start + tag.length !== candidate.length) {
      continue;
    }
    if (start > 0 && !/\s/.test(candidate[start - 1])) {
      continue;
    }
    return candidate.slice(0, start).trimEnd();
  }
  return trimmed;
}

function relationStageStripTrailingMarkdownLink(title) {
  const trimmed = String(title || "").trimEnd();
  const open = trimmed.lastIndexOf("[");
  if (open < 0 || relationStageMarkdownLinkEnd(trimmed, open) !== trimmed.length) {
    return trimmed;
  }
  return trimmed.slice(0, open).trimEnd();
}

// Twin of `event_task::clean_event_title`: strip the trailing `^id`, then
// trailing `[k:: v]` fields, clock tags, and Markdown links in any
// interleaving until nothing changes, then drop a trailing ` · *…*` tail.
function relationStageCleanEventTitle(after) {
  let title = String(after || "").trim();
  const id = /(?:^|\s)\^[A-Za-z0-9-]+$/.exec(title);
  if (id) {
    title = title.slice(0, id.index).trimEnd();
  }
  for (;;) {
    const before = title.length;
    title = relationStageStripTrailingField(title);
    let clockStripped = title;
    for (;;) {
      const next = relationStageStripTrailingClockTag(clockStripped);
      if (next.length === clockStripped.length) {
        break;
      }
      clockStripped = next;
    }
    title = clockStripped;
    title = relationStageStripTrailingMarkdownLink(title);
    if (title.length === before) {
      break;
    }
  }
  const tail = /^(.*) · \*([^*]*)\*$/.exec(title);
  if (tail) {
    title = tail[1].trimEnd();
  }
  return title.trim();
}

// The Links stage name for an Event Task row: `HHMM-HHMM Title`. Returns null
// for any line that is not an Event Task.
function relationStageEventTaskName(rawLine) {
  const parsed = relationStageEventTaskSpanAndAfter(rawLine);
  if (!parsed) {
    return null;
  }
  const title = relationStageCleanEventTitle(parsed.after);
  return title ? `${parsed.span} ${title}` : parsed.span;
}

// Decides whether one daily-note row joins the Links pool (decisions
// daily_scope=events, day_window=all_days). `context` carries the section
// verdict (`range` or `lines`) and `today` for future windows; only the
// events/all_days branch is implemented. Admitted rows are decorated with
// `dailyNote`, `eventTask`, `noteDay`, and the clean event name.
function relationStageDailyAdmission(path, entry, context = {}) {
  if (!isRelationStageDailyNotePath(path)) {
    return null;
  }
  if (!entry || entry.isTask === false) {
    return null;
  }
  const noteDay = relationStageNoteDay(path);
  if (!noteDay) {
    return null;
  }
  const rawLine =
    (typeof entry.rawLine === "string" && entry.rawLine) ||
    (typeof entry.originalMarkdown === "string" && entry.originalMarkdown) ||
    (typeof entry.text === "string" && entry.text) ||
    "";
  if (!rawLine) {
    return null;
  }
  let inEvents = false;
  const range = context && context.range;
  if (range && Number.isFinite(range.start) && Number.isFinite(range.end)) {
    const line = Math.floor(Number(entry.line));
    inEvents = Number.isFinite(line) && line >= range.start && line < range.end;
  } else if (context && Array.isArray(context.lines)) {
    const computed = relationStageEventsSectionRange(context.lines);
    if (!computed) {
      return null;
    }
    const line = Math.floor(Number(entry.line));
    inEvents =
      Number.isFinite(line) && line >= computed.start && line < computed.end;
  } else {
    const section =
      (typeof entry.section === "string" && entry.section) || null;
    inEvents = section === "Events";
  }
  if (!inEvents) {
    return null;
  }
  const eventName = relationStageEventTaskName(rawLine);
  if (!eventName) {
    return null;
  }
  const route =
    typeof dependencyStageRouteOf === "function"
      ? dependencyStageRouteOf(path)
      : String(path || "").replace(/\.md$/i, "");
  const note =
    typeof dependencyStageBasenameOf === "function"
      ? dependencyStageBasenameOf(path)
      : route.split("/").pop();
  const blockId =
    (typeof entry.blockId === "string" && entry.blockId) ||
    (typeof getTrailingBlockId === "function" ? getTrailingBlockId(rawLine) : null) ||
    null;
  return Object.freeze({
    path: typeof normalizeVaultRelativePath === "function"
      ? normalizeVaultRelativePath(path)
      : String(path || ""),
    route,
    note,
    line: Math.floor(Number(entry.line)),
    rawLine: typeof entry.rawLine === "string" ? entry.rawLine : rawLine,
    status: entry.status != null ? entry.status : " ",
    displayText: eventName,
    text: eventName,
    blockId: blockId ? String(blockId) : null,
    existingBlockId: blockId ? String(blockId) : null,
    idField: entry.idField != null ? entry.idField : null,
    existingIdField: entry.idField != null ? entry.idField : null,
    section: (typeof entry.section === "string" && entry.section) || "Events",
    open: entry.open === true,
    closed: entry.open !== true,
    archived: false,
    blocked: entry.blocked === true,
    hidden: entry.hidden === true,
    dailyNote: true,
    eventTask: true,
    noteDay,
  });
}

// Compact call sites in `304-relation-stage-view.js`, so that fragment stays
// under its line cap. Each helper is pure and never throws.
function relationStageEventDisplayName(path, rawLine, fallback) {
  try {
    if (isRelationStageDailyNotePath(path)) {
      const eventName = relationStageEventTaskName(rawLine);
      if (eventName) {
        return eventName;
      }
    }
  } catch (_error) {
    // Fall through with the fallback text.
  }
  return fallback;
}

function relationStagePreviousDailyDisabled(candidate, previousDailyPath) {
  const noId = !candidate.blockId && previousDailyPath &&
    normalizeVaultRelativePath(candidate.path || "") === previousDailyPath;
  if (noId) {
    return { disabled: true, reason: "previous daily note is read-only" };
  }
  return { disabled: false, reason: null };
}

function relationStageDailyVisibleInEmptyFilter(candidate, sourcePath) {
  if (candidate.dailyNote === true) {
    return candidate.path === sourcePath ||
      candidate.status === "/" ||
      candidate.status === "*";
  }
  return candidate.path === sourcePath ||
    candidate.status === "/" ||
    candidate.status === "*" ||
    candidate.closed === true ||
    candidate.archived === true;
}

function relationStageCollectDailySnapshotCandidates(normalizedPath, snapshot, dependentPath, dependentLines) {
  const lines = Array.isArray(snapshot && snapshot.lines) ? snapshot.lines : [];
  const range = relationStageEventsSectionRange(lines);
  if (!range) {
    return [];
  }
  const out = [];
  const entries = Array.isArray(snapshot && snapshot.entries) ? snapshot.entries : [];
  for (const entry of entries) {
    if (!entry || entry.isTask !== true) {
      continue;
    }
    if (dependentPath && dependentLines && dependentLines.has(entry.line) && normalizedPath === dependentPath) {
      continue;
    }
    const admitted = relationStageDailyAdmission(normalizedPath, entry, { lines, range });
    if (admitted) {
      out.push(admitted);
    }
  }
  return out;
}
