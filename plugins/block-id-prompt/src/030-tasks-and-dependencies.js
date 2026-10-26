function startsWithFrontmatter(lines) {
  return lines.length > 0 && /^\s*---\s*$/.test(lines[0]);
}

function normalizeMarkdownLine(lineText) {
  return String(lineText || "").replace(/\r$/, "");
}

function getObsidianTaskLineMatch(lineText) {
  return OBSIDIAN_TASK_LINE_RE.exec(normalizeMarkdownLine(lineText));
}

function isOpenObsidianTaskLine(lineText) {
  const match = getObsidianTaskLineMatch(lineText);
  if (!match) {
    return false;
  }

  const status = match[1];
  const body = match[2] || "";
  return (
    OPEN_OBSIDIAN_TASK_STATUSES.has(status) && PROJECT_TASK_TAG_RE.test(body)
  );
}

function getTrailingBlockId(lineText) {
  const match = normalizeMarkdownLine(lineText).match(TRAILING_BLOCK_ID_RE);
  return match ? match[1] : null;
}

// Find every recognized `scheduled` field on a line, bracket or paren form, in
// any position/order. `value` is trimmed; callers decide validity separately
// so a malformed or duplicate field still counts toward ambiguity.
function findScheduledFieldMatches(lineText) {
  const text = normalizeMarkdownLine(lineText);
  const matches = [];
  let match;

  SCHEDULED_FIELD_RE.lastIndex = 0;
  while ((match = SCHEDULED_FIELD_RE.exec(text)) !== null) {
    const rawValue = match[1] !== undefined ? match[1] : match[2];
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value: rawValue.trim(),
    });
  }

  return matches;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

// Require an exact four-digit year/two-digit month/two-digit day and validate
// the actual calendar date (rejects e.g. 2026-02-30).
function parseStrictCalendarDate(value) {
  const match = CALENDAR_DATE_RE.exec(String(value === null || value === undefined ? "" : value));
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

function compareCalendarDates(left, right) {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function formatCalendarDate({ year, month, day }) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

// The clock is injectable so callers can pass a fixed `Date` in tests. Local
// calendar components are read directly (not toISOString()) so a date near a
// timezone boundary is never shifted to the wrong day.
function localTodayParts(now) {
  const date = now instanceof Date ? now : new Date();
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

// Task freshness: placement lives in bob-ledger-tools
// (`api.freshness.stampLine`, api `version >= 3`). This plugin never places
// `[fresh::]` itself: a missing stamp only means Bryan sees the task once
// more, while a misplaced stamp would hide Tasks fields. When ledger-tools is
// absent or old, gestures simply don't stamp.
function identityFreshStampLine(line) {
  return String(line || "");
}

function isPomodoroFreshnessLedgerLine(line) {
  const match = getObsidianTaskLineMatch(line);
  const body = match ? match[2] || "" : "";
  if (/^\(\s*\)/.test(body)) {
    return true;
  }
  const range = body.match(
    /^\((\*\*)?(\d{4}|\d{2}:\d{2})\s*-\s*(\d{4}|\d{2}:\d{2})(\*\*)?(?:\s+[^)]*)?\)/,
  );
  return Boolean(
    range &&
      Boolean(range[1]) === Boolean(range[4]) &&
      range[2].includes(":") === range[3].includes(":"),
  );
}

function applyFreshStampLine(line, stamper, dateText) {
  const text = String(line || "");
  if (isPomodoroFreshnessLedgerLine(text)) {
    return text;
  }
  const fn = typeof stamper === "function" ? stamper : identityFreshStampLine;
  try {
    const stamped = fn(text, dateText);
    return typeof stamped === "string" ? stamped : text;
  } catch (error) {
    return text;
  }
}

// Exactly one recognized scheduled field, syntactically valid, and strictly
// later than `today` — the only shape that qualifies for future-schedule
// removal. Two or more recognized fields, an invalid date, or a today/past
// date are all treated the same way: left completely untouched.
function findSingleFutureScheduledField(lineText, today) {
  const matches = findScheduledFieldMatches(lineText);
  if (matches.length !== 1) {
    return null;
  }

  const parsed = parseStrictCalendarDate(matches[0].value);
  if (!parsed || compareCalendarDates(parsed, today) <= 0) {
    return null;
  }

  return { ...matches[0], date: parsed };
}

// Remove `[start, end)` and collapse the whitespace it exposed so surviving
// tokens stay separated by exactly one space, without introducing trailing
// whitespace. Mirrors lineWithoutBlockToken's collapse rule.
function removeSpanWithSpaceCollapse(lineText, start, end) {
  const before = lineText.slice(0, start);
  const after = lineText.slice(end);

  if (before.trim() && after.trim()) {
    return `${before.replace(/[ \t]+$/g, "")} ${after.replace(/^[ \t]+/g, "")}`;
  }

  return before.replace(/[ \t]+$/g, "") + after.replace(/^[ \t]+/g, "");
}

function hasHideTaskTag(text) {
  return HIDE_TASK_TAG_RE.test(String(text || ""));
}

function collapseStrippedTagPrefix(match, prefix) {
  if (!prefix) {
    return "";
  }

  return /\s/.test(prefix) ? " " : prefix;
}

function stripInternalTaskTags(text) {
  return String(text || "")
    .replace(REF_AFTER_TASK_GLOBAL_RE, collapseStrippedTagPrefix)
    .replace(PROJECT_TASK_TAG_GLOBAL_RE, collapseStrippedTagPrefix)
    .replace(HIDE_TASK_TAG_GLOBAL_RE, collapseStrippedTagPrefix);
}

function cleanTaskDisplayText(lineText) {
  const match = getObsidianTaskLineMatch(lineText);
  let text = match ? match[2] || "" : normalizeMarkdownLine(lineText);

  text = text
    .replace(TRAILING_BLOCK_ID_RE, "")
    .replace(TASKS_INLINE_FIELD_RE, "")
    .replace(TASKS_EMOJI_DATE_RE, "");
  const isRefTask = REF_AFTER_TASK_RE.test(text);
  text = stripInternalTaskTags(text)
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (text === "") {
    return "(untitled task)";
  }
  return isRefTask ? REF_TASK_DISPLAY_PREFIX + text : text;
}

function taskItemFromLine(lineText, lineNumber, options = {}) {
  const match = getObsidianTaskLineMatch(lineText);
  if (!match) {
    return null;
  }

  const status = match[1];
  const body = match[2] || "";
  if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status) || !PROJECT_TASK_TAG_RE.test(body)) {
    return null;
  }

  if (!options.includeHidden && hasHideTaskTag(body)) {
    return null;
  }

  return {
    line: lineNumber,
    rawLine: lineText,
    status,
    existingId: getTrailingBlockId(lineText),
    displayText: cleanTaskDisplayText(lineText),
  };
}

// The task-line eligibility check for the direct-cursor Pomodoro link command
// (Ctrl+Shift+Enter): identical to the task-picker's own per-line parsing,
// except a `#hide` project task remains eligible since the user selected it
// directly by placing the cursor on it rather than finding it through the
// picker's filtered list.
function findDirectPomodoroLinkTask(lineText, lineNumber) {
  return taskItemFromLine(lineText, lineNumber, { includeHidden: true });
}

function forEachTaskPickerContentLine(content, callback) {
  const sourceLines = String(content || "").split("\n");
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = sourceLines[lineIndex] || "";

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }

    if (inFence) {
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      continue;
    }

    callback(line, lineIndex);
  }
}

function getOpenTasksInContent(content) {
  const tasks = [];

  forEachTaskPickerContentLine(content, (line, lineIndex) => {
    const task = taskItemFromLine(line, lineIndex);
    if (task) {
      tasks.push(task);
    }
  });

  return tasks;
}

function parseInlineIdField(lineText) {
  const match = normalizeMarkdownLine(lineText).match(INLINE_ID_FIELD_RE);
  if (!match) {
    return null;
  }

  const value = normalizeText(match[2]);
  return value || null;
}

function dedupeNonEmptyValues(values) {
  const deduped = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function parseDependsOnIds(lineText) {
  const line = normalizeMarkdownLine(lineText);
  const ids = [];
  let match;

  INLINE_DEPENDS_ON_FIELD_RE.lastIndex = 0;
  while ((match = INLINE_DEPENDS_ON_FIELD_RE.exec(line)) !== null) {
    ids.push(...String(match[2] || "").split(","));
  }

  return dedupeNonEmptyValues(ids);
}

function taskIdKeysFromLine(lineText) {
  const explicitId = parseInlineIdField(lineText);
  return explicitId
    ? [explicitId]
    : dedupeNonEmptyValues([getTrailingBlockId(lineText)]);
}

function isDoneTaskStatus(status) {
  return DONE_OBSIDIAN_TASK_STATUSES.has(status);
}

function buildTaskDependencyIndex(content) {
  const index = new Map();

  forEachTaskPickerContentLine(content, (line, lineNumber) => {
    const match = getObsidianTaskLineMatch(line);
    if (!match) {
      return;
    }

    const status = match[1];
    const entry = {
      status,
      done: isDoneTaskStatus(status),
      title: cleanTaskDisplayText(line),
      line: lineNumber,
    };

    taskIdKeysFromLine(line).forEach((key) => {
      const existing = index.get(key);
      if (!existing || (!entry.done && existing.done)) {
        index.set(key, entry);
      }
    });
  });

  return index;
}

function resolveTaskDependencyState(rawLine, index) {
  const depIds = parseDependsOnIds(rawLine);
  const unmetBlockers = [];
  const unresolvedIds = [];
  let metCount = 0;

  depIds.forEach((id) => {
    const dependency = index.get(id);
    if (!dependency) {
      unresolvedIds.push(id);
      return;
    }

    if (dependency.done) {
      metCount += 1;
      return;
    }

    unmetBlockers.push({
      id,
      title: dependency.title,
      line: dependency.line,
      status: dependency.status,
    });
  });

  return {
    depIds,
    unmetBlockers,
    metCount,
    unresolvedIds,
    isBlocked: unmetBlockers.length > 0,
  };
}

const PROJECT_BLOCKED_RESIDENT_TAG_RE =
  /(^|[\s([{])#prj_is_blocked(?=$|[\s)\]},.;:!?])/;

function hasProjectBlockedResidentTag(lineText) {
  return PROJECT_BLOCKED_RESIDENT_TAG_RE.test(String(lineText || ""));
}

function projectParentTarget(sourceText) {
  const lines = String(sourceText || "").split(/\r?\n/);
  if (!startsWithFrontmatter(lines)) {
    return null;
  }
  let count = 0;
  for (let line = 1; line < lines.length; line += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[line])) {
      break;
    }
    if (/^parent\s*:/.test(lines[line])) {
      count += 1;
    }
  }
  if (count !== 1) {
    return null;
  }
  const value = readProjectFrontmatterScalar(lines, "parent");
  const match = value && value.match(/^\[\[([^\]\n]+)\]\]$/);
  if (!match) {
    return null;
  }
  const target = String(match[1] || "")
    .split("|")[0]
    .split("#")[0]
    .trim();
  return target || null;
}

function readProjectFrontmatterScalar(lines, key) {
  for (let line = 1; line < lines.length; line += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[line])) {
      break;
    }
    const match = lines[line].match(new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`));
    if (!match) {
      continue;
    }
    let value = match[1].replace(/\s+#.*$/, "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

function parseProjectFrontmatter(sourceText, path = "", records = null) {
  const lines = String(sourceText || "").split(/\r?\n/);
  if (
    /(?:^|\/)\d{4}\/\d{8}\.md$/i.test(String(path || "")) ||
    !startsWithFrontmatter(lines)
  ) {
    return null;
  }
  const readScalar = (key) => {
    for (let line = 1; line < lines.length; line += 1) {
      if (FRONTMATTER_DELIMITER_RE.test(lines[line])) {
        break;
      }
      const match = lines[line].match(new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`));
      if (!match) {
        continue;
      }
      let value = match[1].replace(/\s+#.*$/, "").trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
    return null;
  };
  const type = readScalar("type");
  const status = readScalar("status");
  if (
    !type || !/^\[\[project\]\]$/i.test(type) ||
    !status || /^(?:done|canceled|cancelled)$/i.test(status)
  ) {
    return null;
  }
  const documentRecords = Array.isArray(records)
    ? records
    : taskDependencyRecordsFromDocuments([{
      path: String(path || ""),
      text: String(sourceText || ""),
    }]);
  const projectTasks = documentRecords.filter((task) =>
    task.path === String(path || "") && task.blockId === "prj" &&
    OPEN_OBSIDIAN_TASK_STATUSES.has(task.status)
  );
  if (projectTasks.length !== 1) {
    return null;
  }
  const scheduledFields = findScheduledFieldMatches(projectTasks[0].lineText);
  const scheduledField = scheduledFields.find((field) =>
    parseStrictCalendarDate(field.value)
  );
  const parsedSchedule = scheduledField &&
    parseStrictCalendarDate(scheduledField.value);
  return {
    path: String(path || ""),
    scheduled: parsedSchedule ? formatCalendarDate(parsedSchedule) : null,
    parent: projectParentTarget(sourceText),
  };
}

function taskDependencyRecordsFromDocuments(documents) {
  const records = [];
  for (const document of Array.from(documents || [])) {
    const path = String((document && document.path) || "");
    const content = String((document && document.text) || "");
    forEachTaskPickerContentLine(content, (line, lineNumber) => {
      const match = getObsidianTaskLineMatch(line);
      if (!match || !PROJECT_TASK_TAG_RE.test(match[2] || "")) {
        return;
      }
      const blockId = getTrailingBlockId(line);
      const taskId = parseInlineIdField(line) || blockId;
      records.push({
        path,
        line: lineNumber,
        lineText: line,
        status: match[1],
        blockId,
        taskId,
        dependsOn: parseDependsOnIds(line),
      });
    });
  }
  return records;
}

function canonicalDependencyId(path, blockId) {
  if (!path || !blockId) {
    return null;
  }
  return `${String(path).replace(/\.md$/i, "").replace(/\//g, "__")}__${blockId}`;
}

function projectDependencyInfoForRecords(document, records) {
  const metadata = parseProjectFrontmatter(
    document.text,
    document.path,
    records,
  );
  if (!metadata) {
    return null;
  }
  const tasks = records.filter((task) => task.path === metadata.path);
  const projectTasks = tasks.filter(
    (task) => task.blockId === "prj" && OPEN_OBSIDIAN_TASK_STATUSES.has(task.status),
  );
  return projectTasks.length === 1
    ? { ...metadata, tasks, projectTask: projectTasks[0] }
    : null;
}

function isDependencyTargetOpen(task) {
  return !!task && OPEN_OBSIDIAN_TASK_STATUSES.has(task.status);
}

function planTaskLinkBlockConsumption(documents, targetPath, targetLine, today = new Date()) {
  const docs = Array.from(documents || []).map((document) => ({
    path: String((document && document.path) || ""),
    text: String((document && document.text) || ""),
  }));
  const records = taskDependencyRecordsFromDocuments(docs);
  const target = records.find(
    (task) => task.path === String(targetPath || "") && task.line === targetLine,
  );
  if (!target || !OPEN_OBSIDIAN_TASK_STATUSES.has(target.status)) {
    return null;
  }
  const byId = new Map();
  for (const task of records) {
    const keys = dedupeNonEmptyValues([
      task.taskId,
      canonicalDependencyId(task.path, task.blockId),
    ]);
    for (const key of keys) {
      const existing = byId.get(key);
      if (!existing || (!isDependencyTargetOpen(existing) && isDependencyTargetOpen(task))) {
        byId.set(key, task);
      }
    }
  }
  const projects = new Map();
  for (const document of docs) {
    const project = projectDependencyInfoForRecords(document, records);
    if (project) {
      projects.set(project.path, project);
    }
  }
  const project = projects.get(target.path);
  const resident = target.blockId !== "prj" &&
    hasProjectBlockedResidentTag(target.lineText);
  const inheritedProjectBlocked = !!(
    project && hasProjectBlockedResidentTag(project.projectTask.lineText)
  );
  const resolveOpenIds = (ids, internalOnly = false) => ids.filter((id) => {
    const dependency = byId.get(String(id));
    if (!isDependencyTargetOpen(dependency)) {
      return false;
    }
    return !internalOnly || dependency.path !== target.path;
  });
  const ownOpen = resolveOpenIds(target.dependsOn, target.blockId === "prj");
  const projectOpen = project && (resident || target.blockId === "prj")
    ? resolveOpenIds(project.projectTask.dependsOn, true)
    : [];
  const requiredIds = [...new Set([
    ...target.dependsOn.filter((id) => {
      if (target.blockId !== "prj") {
        return true;
      }
      const dependency = byId.get(String(id));
      return !dependency || dependency.path !== target.path;
    }),
    ...(project && (resident || target.blockId === "prj")
      ? project.projectTask.dependsOn.filter((id) => {
        const dependency = byId.get(String(id));
        return !dependency || dependency.path !== target.path;
      })
      : []),
  ])];
  const unresolvedIds = requiredIds.filter((id) => !byId.has(String(id)));
  const todayParts = today instanceof Date
    ? localTodayParts(today)
    : today;
  const ownSchedule = findSingleFutureScheduledField(
    target.lineText,
    todayParts,
  );
  const projectSchedule = project && resident
    ? project.scheduled && parseStrictCalendarDate(project.scheduled)
    : null;
  const projectScheduleIsFuture = !!projectSchedule &&
    compareCalendarDates(projectSchedule, todayParts) > 0;
  const projectDependencyBlocked =
    inheritedProjectBlocked ||
    (resident && (projectOpen.length > 0 || !projectScheduleIsFuture)) ||
    (target.blockId === "prj" && ownOpen.length > 0);
  const dependencyBlocked = ownOpen.length > 0 || projectDependencyBlocked ||
    projectOpen.length > 0;
  // A project's own date is a special refusal only when it is the sole
  // remaining reason. Dependency reasons take precedence and can be raised.
  const projectDateRefusal = target.blockId === "prj" && !!ownSchedule &&
    !dependencyBlocked;
  if (!dependencyBlocked && !projectScheduleIsFuture && !projectDateRefusal) {
    return { blocked: false, target, ownSchedule };
  }

  const documentByPath = new Map(docs.map((document) => [document.path, document]));
  const updatesByPath = new Map();
  const promoted = [];
  const visited = new Set();
  const queue = [...new Set([...ownOpen, ...projectOpen])];
  while (queue.length > 0) {
    const id = String(queue.shift());
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    const task = byId.get(id);
    if (!isDependencyTargetOpen(task)) {
      continue;
    }
    const dependencyProject = projects.get(task.path);
    const isProjectTask = task.blockId === "prj";
    const isProjectResident = dependencyProject && !isProjectTask &&
      dependencyProject.tasks.some((candidate) => candidate.line === task.line);
    if (task.status === " " && !isProjectTask && !isProjectResident) {
      const statusStart = task.lineText.indexOf("[") + 1;
      const after = `${task.lineText.slice(0, statusStart)}*${task.lineText.slice(statusStart + 1)}`;
      const document = documentByPath.get(task.path);
      if (!updatesByPath.has(task.path)) {
        updatesByPath.set(task.path, {
          preimage: document.text,
          text: document.text,
          edits: [],
        });
      }
      const lines = updatesByPath.get(task.path).text.split("\n");
      let start = 0;
      for (let line = 0; line < task.line; line += 1) {
        start += lines[line].length + 1;
      }
      updatesByPath.get(task.path).edits.push({
        start: start + statusStart,
        end: start + statusStart + 1,
        replacement: "*",
      });
      promoted.push(id);
    }
    const edges = [...task.dependsOn];
    if (dependencyProject && (isProjectTask || isProjectResident)) {
      edges.push(...dependencyProject.projectTask.dependsOn);
    }
    queue.push(...edges);
  }
  for (const [path, update] of updatesByPath) {
    for (const edit of [...update.edits].sort((left, right) => right.start - left.start)) {
      const before = update.text.slice(edit.start, edit.end);
      if (before !== " ") {
        continue;
      }
      update.text = `${update.text.slice(0, edit.start)}${edit.replacement}${update.text.slice(edit.end)}`;
    }
  }
  return {
    blocked: true,
    dependencyBlocked,
    projectDependencyBlocked,
    inheritedProjectBlocked,
    projectParent: inheritedProjectBlocked ? project.parent : null,
    projectScheduleIsFuture,
    projectDateRefusal,
    ownSchedule,
    projectSchedule: projectScheduleIsFuture ? formatCalendarDate(projectSchedule) : null,
    projectPath: project ? project.path : null,
    unresolvedIds,
    target,
    promoted,
    updatesByPath,
  };
}

function collectTaskPickerItems(content) {
  const dependencyIndex = buildTaskDependencyIndex(content);

  return getOpenTasksInContent(content).map((task) => ({
    ...task,
    dependency: resolveTaskDependencyState(task.rawLine, dependencyIndex),
  }));
}

function fuzzyIncludes(text, query) {
  const haystack = String(text || "").toLowerCase();
  const needle = String(query || "").toLowerCase();
  if (!needle) {
    return true;
  }

  if (haystack.includes(needle)) {
    return true;
  }

  let offset = 0;
  for (const char of needle) {
    offset = haystack.indexOf(char, offset);
    if (offset === -1) {
      return false;
    }
    offset += 1;
  }

  return true;
}

function blockTokenMatches(content, id) {
  const matches = [];
  const re = new RegExp(
    `(^|[ \\t])\\^${escapeRegExp(id)}(?=$|[ \\t\\r\\n])`,
    "gm",
  );
  let match;

  while ((match = re.exec(content)) !== null) {
    const start = match.index + match[1].length;
    matches.push({
      start,
      end: start + 1 + id.length,
    });
  }

  return matches;
}

function collectBlockTokenMatches(content) {
  const matches = [];
  const re = /(^|[ \t])\^([A-Za-z0-9-]+)(?=$|[ \t\r\n])/gm;
  let match;

  while ((match = re.exec(content)) !== null) {
    const start = match.index + match[1].length;
    matches.push({
      id: match[2],
      start,
      end: start + 1 + match[2].length,
    });
  }

  return matches;
}

function standaloneBlockIdFromLine(lineText) {
  const match = String(lineText || "").match(/^\s*\^([A-Za-z0-9-]+)\s*$/);
  return match ? match[1] : null;
}

function markdownLineKind(lineText) {
  const line = String(lineText || "");
  const trimmed = line.trim();

  if (!trimmed) {
    return "blank";
  }

  if (standaloneBlockIdFromLine(line)) {
    return "standalone-id";
  }

  if (getFenceOpening(line)) {
    return "fence";
  }

  if (/^\s{0,3}#{1,6}\s+/.test(line)) {
    return "heading";
  }

  if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
    return "list";
  }

  if (/^\s*>/.test(line)) {
    return "quote";
  }

  if (/^\s*\|.*\|\s*$/.test(line)) {
    return "table";
  }

  return "paragraph";
}

function findContentBlockRange(lines, lineNumber) {
  const kind = markdownLineKind(lines[lineNumber]);
  if (kind === "blank" || kind === "fence" || kind === "standalone-id") {
    return null;
  }

  if (kind === "heading" || kind === "list") {
    return {
      startLine: lineNumber,
      contentEndLine: lineNumber,
      endLine: lineNumber,
    };
  }

  let startLine = lineNumber;
  while (startLine > 0 && markdownLineKind(lines[startLine - 1]) === kind) {
    startLine -= 1;
  }

  let endLine = lineNumber;
  while (
    endLine < lines.length - 1 &&
    markdownLineKind(lines[endLine + 1]) === kind
  ) {
    endLine += 1;
  }

  return {
    startLine,
    contentEndLine: endLine,
    endLine,
  };
}

function includeFollowingStandaloneBlockIds(lines, range) {
  let endLine = range.endLine;
  while (
    endLine < lines.length - 1 &&
    markdownLineKind(lines[endLine + 1]) === "standalone-id"
  ) {
    endLine += 1;
  }

  return {
    ...range,
    endLine,
  };
}

function findLocalMarkdownBlockRange(lines, lineNumber) {
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  const kind = markdownLineKind(lines[lineNumber]);
  if (kind === "blank" || kind === "fence") {
    return null;
  }

  if (kind === "standalone-id") {
    let baseLine = lineNumber - 1;
    while (baseLine >= 0 && markdownLineKind(lines[baseLine]) === "standalone-id") {
      baseLine -= 1;
    }

    const baseRange = findContentBlockRange(lines, baseLine);
    if (!baseRange) {
      return null;
    }

    return {
      ...baseRange,
      endLine: lineNumber,
    };
  }

  const range = findContentBlockRange(lines, lineNumber);
  return range ? includeFollowingStandaloneBlockIds(lines, range) : null;
}

