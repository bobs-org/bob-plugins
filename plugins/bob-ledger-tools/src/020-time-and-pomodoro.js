
function parseEmDashTrigger(text) {
  if (!text.endsWith("-")) {
    return null;
  }

  const precedingChar = text.length > 1 ? text[text.length - 2] : "";
  if (precedingChar === "-") {
    return null;
  }

  return {
    kind: "emDash",
    trigger: "-",
    startCh: text.length - 1,
    endCh: text.length,
  };
}

function parseTrigger(textBeforeCursor) {
  const text = String(textBeforeCursor || "");
  const match = TRIGGER_RE.exec(text);

  if (!match) {
    if (INCOMPLETE_NEGATIVE_OFFSET_TRIGGER_RE.test(text)) {
      return null;
    }
    return parseEmDashTrigger(text);
  }

  const trigger = match[2];
  const startCh = text.length - trigger.length;
  const endCh = text.length;

  if (trigger === "ta") {
    return {
      kind: "task",
      trigger,
      startCh,
      endCh,
    };
  }

  const ledgerMatch = LEDGER_TRIGGER_RE.exec(trigger);

  if (!ledgerMatch) {
    const dateTimeMatch = DATE_TIME_TRIGGER_RE.exec(trigger);
    if (!dateTimeMatch) {
      return null;
    }

    const prefix = dateTimeMatch[1];
    const offset = Number.parseInt(dateTimeMatch[2], 10);
    if (!Number.isFinite(offset)) {
      return null;
    }

    let kind = "time";
    if (prefix === "dt") {
      kind = "datetime";
    } else if (prefix === "d") {
      kind = "date";
    } else if (prefix === "D") {
      kind = "datedEntry";
    }

    return {
      kind,
      trigger,
      startCh,
      endCh,
      offset,
    };
  }

  const durationText = ledgerMatch[1] || "";
  const offsetText = ledgerMatch[2];
  const dashPresent = trigger.includes("-");
  const durationMultiplier =
    durationText === "" ? 5 : Number.parseInt(durationText, 10);
  const offsetMultiplier =
    offsetText === undefined
      ? dashPresent
        ? 1
        : 0
      : offsetText === ""
        ? 1
        : Number.parseInt(offsetText, 10);

  if (!Number.isFinite(durationMultiplier) || !Number.isFinite(offsetMultiplier)) {
    return null;
  }

  return {
    kind: "ledgerRange",
    trigger,
    startCh,
    endCh,
    durationMultiplier,
    offsetMultiplier,
    dashPresent,
  };
}

function numericOrDefault(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max) {
  const safeMin = finiteNumberOrNull(min);
  const safeMax = finiteNumberOrNull(max);
  const lower = safeMin === null ? 0 : safeMin;
  const upper =
    safeMax === null ? Number.POSITIVE_INFINITY : Math.max(lower, safeMax);
  return Math.min(Math.max(Number(value) || 0, lower), upper);
}

function normalizeEditorPosition(position) {
  if (!position) {
    return null;
  }

  const line = Math.floor(numericOrDefault(position.line, Number.NaN));
  const ch = Math.floor(numericOrDefault(position.ch, 0));
  if (!Number.isFinite(line) || line < 0) {
    return null;
  }

  return { line, ch: Math.max(ch, 0) };
}

function normalizeDailyLocation(location) {
  if (!location) {
    return null;
  }

  const cursor = normalizeEditorPosition(
    location.cursor || location.position || location.sourcePosition,
  );
  const scrollTop = finiteNumberOrNull(location.scrollTop);
  const scrollLeft = finiteNumberOrNull(location.scrollLeft);
  if (!cursor && scrollTop === null && scrollLeft === null) {
    return null;
  }

  const normalized = {};
  if (cursor) {
    normalized.cursor = cursor;
  }
  if (scrollTop !== null) {
    normalized.scrollTop = Math.max(0, scrollTop);
  }
  if (scrollLeft !== null) {
    normalized.scrollLeft = Math.max(0, scrollLeft);
  }
  return normalized;
}

function normalizeMinutes(minutes) {
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

function formatTime(minutes, style = "compact") {
  const normalized = normalizeMinutes(minutes);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const hourText = String(hour).padStart(2, "0");
  const minuteText = String(minute).padStart(2, "0");

  if (style === "colon") {
    return `${hourText}:${minuteText}`;
  }

  return `${hourText}${minuteText}`;
}

function coerceDate(value) {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatLocalDate(value) {
  const date = coerceDate(value);
  const yearText = String(date.getFullYear()).padStart(4, "0");
  const monthText = String(date.getMonth() + 1).padStart(2, "0");
  const dayText = String(date.getDate()).padStart(2, "0");
  return `${yearText}-${monthText}-${dayText}`;
}

function dailyDateFormatTokens(value) {
  const date = coerceDate(value);
  const yearText = String(date.getFullYear()).padStart(4, "0");
  const monthNumber = date.getMonth() + 1;
  const monthText = String(monthNumber).padStart(2, "0");
  const dayNumber = date.getDate();
  const dayText = String(dayNumber).padStart(2, "0");

  return {
    YYYY: yearText,
    YY: yearText.slice(-2),
    MM: monthText,
    DD: dayText,
    M: String(monthNumber),
    D: String(dayNumber),
  };
}

function formatDailyDate(value, format = DEFAULT_DAILY_NOTES_FORMAT) {
  const source = String(format || DEFAULT_DAILY_NOTES_FORMAT);
  const tokens = dailyDateFormatTokens(value);
  let result = "";

  for (let index = 0; index < source.length; ) {
    if (source[index] === "[") {
      const endIndex = source.indexOf("]", index + 1);
      if (endIndex !== -1) {
        result += source.slice(index + 1, endIndex);
        index = endIndex + 1;
        continue;
      }
    }

    const token = DAILY_FORMAT_TOKENS.find((candidate) =>
      source.startsWith(candidate, index),
    );
    if (token) {
      result += tokens[token];
      index += token.length;
      continue;
    }

    result += source[index];
    index += 1;
  }

  return result;
}

function normalizeVaultPath(value) {
  const text = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!text) {
    return "";
  }

  const compactPath = text.replace(/\/+/g, "/").replace(/\/$/, "");
  if (typeof normalizePath === "function") {
    return normalizePath(compactPath).replace(/^\/+/, "");
  }

  return compactPath;
}

function ensureMarkdownExtension(path) {
  const normalized = normalizeVaultPath(path);
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function joinVaultPath(folder, path) {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedFolder = normalizeVaultPath(folder);

  return normalizedFolder
    ? normalizeVaultPath(`${normalizedFolder}/${normalizedPath}`)
    : normalizedPath;
}

function todayDailyPath(now = new Date(), dailyOptions = {}) {
  const options = dailyOptions || {};
  const path = ensureMarkdownExtension(
    formatDailyDate(now, options.format || DEFAULT_DAILY_NOTES_FORMAT),
  );

  return joinVaultPath(options.folder || "", path);
}

function getDailyNotesOptions(app) {
  const internalPlugins = app && app.internalPlugins;
  const plugin =
    (internalPlugins &&
      internalPlugins.plugins &&
      internalPlugins.plugins[DAILY_NOTES_COMMAND_ID]) ||
    (internalPlugins && typeof internalPlugins.getPluginById === "function"
      ? internalPlugins.getPluginById(DAILY_NOTES_COMMAND_ID)
      : null);
  const instance = plugin && plugin.instance;

  return (instance && instance.options) || {};
}

function sameVaultPath(left, right) {
  return normalizeVaultPath(left) === normalizeVaultPath(right);
}

function getActiveFile(app) {
  const workspace = app && app.workspace;
  if (!workspace || typeof workspace.getActiveFile !== "function") {
    return null;
  }

  return workspace.getActiveFile();
}

function isTodayDailyFile(app, file, options = {}) {
  if (!file || typeof file.path !== "string") {
    return false;
  }

  const dailyPath = todayDailyPath(
    options.now || new Date(),
    options.dailyOptions || getDailyNotesOptions(app),
  );
  return sameVaultPath(file.path, dailyPath);
}

function formatLocalDateTime(value) {
  const date = coerceDate(value);
  const minutes = date.getHours() * 60 + date.getMinutes();
  return `${formatLocalDate(date)} ${formatTime(minutes, "colon")}`;
}

function addLocalMinutes(value, minutes) {
  const date = coerceDate(value);
  date.setMinutes(date.getMinutes() + numericOrDefault(minutes, 0));
  return date;
}

function addLocalDays(value, days) {
  const date = coerceDate(value);
  date.setDate(date.getDate() + numericOrDefault(days, 0));
  return date;
}

function formatOffsetTime(now, offsetMinutes) {
  const date = addLocalMinutes(now, offsetMinutes);
  return formatTime(date.getHours() * 60 + date.getMinutes());
}

function formatOffsetDate(now, offsetDays) {
  return formatLocalDate(addLocalDays(now, offsetDays));
}

function formatOffsetDateTime(now, offsetMinutes) {
  return formatLocalDateTime(addLocalMinutes(now, offsetMinutes));
}

function addMinutes(minutes, delta) {
  return normalizeMinutes(minutes + delta);
}

function validTime(hours, minutes) {
  return (
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  );
}

function minutesFromParts(hours, minutes) {
  const parsedHours = Number.parseInt(hours, 10);
  const parsedMinutes = Number.parseInt(minutes, 10);

  if (!validTime(parsedHours, parsedMinutes)) {
    return null;
  }

  return parsedHours * 60 + parsedMinutes;
}

function findPomodorosSection(lines) {
  if (!Array.isArray(lines)) {
    return null;
  }

  const headingLine = lines.findIndex((line) =>
    POMODOROS_HEADING_RE.test(String(line || "")),
  );

  if (headingLine === -1) {
    return null;
  }

  let endLine = lines.length - 1;
  for (let line = headingLine + 1; line < lines.length; line += 1) {
    if (LEVEL_TWO_HEADING_RE.test(String(lines[line] || ""))) {
      endLine = line - 1;
      break;
    }
  }

  return {
    headingLine,
    startLine: headingLine + 1,
    endLine,
  };
}

function parseTimeRange(line) {
  const text = String(line || "");
  let match = COLON_TIME_RANGE_RE.exec(text);

  if (match) {
    return rangeFromMatch(match, "colon");
  }

  match = COMPACT_TIME_RANGE_RE.exec(text);
  if (!match) {
    return null;
  }

  return rangeFromMatch(match, "compact");
}

function rangeFromMatch(match, style) {
  const openingBold = match[1] || "";
  const closingBold = match[6] || "";

  if (Boolean(openingBold) !== Boolean(closingBold)) {
    return null;
  }

  const startMinutes = minutesFromParts(match[2], match[3]);
  const endMinutes = minutesFromParts(match[4], match[5]);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  return {
    startCh: match.index,
    endCh: match.index + match[0].length,
    startMinutes,
    endMinutes,
    style,
    metadata: match[7] || "",
    bold: Boolean(openingBold),
  };
}

function formatTimeRange(
  startMinutes,
  endMinutes,
  style = "compact",
  metadata = "",
) {
  return `(**${formatTime(startMinutes, style)}-${formatTime(endMinutes, style)}**${metadata || ""})`;
}

function replaceTimeRange(line, range, startMinutes, endMinutes) {
  if (!range) {
    return null;
  }

  const text = String(line || "");
  const newRange = formatTimeRange(
    startMinutes,
    endMinutes,
    range.style,
    range.metadata,
  );
  return text.slice(0, range.startCh) + newRange + text.slice(range.endCh);
}

function durationField(rangeText) {
  const match = DURATION_FIELD_RE.exec(String(rangeText || ""));

  if (!match) {
    return null;
  }

  return {
    startCh: match.index,
    endCh: match.index + match[0].length,
    value: match[1],
  };
}

function legacyStopwatchDuration(rangeText) {
  const match = LEGACY_STOPWATCH_DURATION_RE.exec(String(rangeText || ""));

  if (!match) {
    return null;
  }

  return {
    startCh: match.index,
    endCh: match.index + match[0].length,
    value: match[1],
  };
}

function parseDurationMinutes(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }

  const minuteMatch = /^(\d+)\s*m$/.exec(text);
  if (minuteMatch) {
    return Number.parseInt(minuteMatch[1], 10);
  }

  const hourMinuteMatch = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
  if (!hourMinuteMatch || (!hourMinuteMatch[1] && !hourMinuteMatch[2])) {
    return null;
  }

  const hours = hourMinuteMatch[1]
    ? Number.parseInt(hourMinuteMatch[1], 10)
    : 0;
  const minutes = hourMinuteMatch[2]
    ? Number.parseInt(hourMinuteMatch[2], 10)
    : 0;
  return hours * 60 + minutes;
}

function formatDurationField(minutes) {
  const safeMinutes = Math.max(0, Math.floor(numericOrDefault(minutes, 0)));
  return `[t:: ${safeMinutes}m]`;
}

function rangeDurationMinutes(range) {
  if (!range) {
    return null;
  }

  return normalizeMinutes(range.endMinutes - range.startMinutes);
}

function removeDurationMetadata(metadata) {
  return String(metadata || "")
    .replace(DURATION_FIELD_GLOBAL_RE, "")
    .replace(LEGACY_STOPWATCH_DURATION_GLOBAL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function durationMetadata(minutes, metadata) {
  const rest = removeDurationMetadata(metadata);
  return rest
    ? ` ${formatDurationField(minutes)} ${rest}`
    : ` ${formatDurationField(minutes)}`;
}

function pomodoroDurationMinutes(line, range) {
  if (!range) {
    return null;
  }

  const rangeText = String(line || "").slice(range.startCh, range.endCh);
  const field = durationField(rangeText);
  if (field) {
    const fieldMinutes = parseDurationMinutes(field.value);
    if (fieldMinutes !== null) {
      return fieldMinutes;
    }
  }

  const legacy = legacyStopwatchDuration(rangeText);
  if (legacy) {
    const legacyMinutes = parseDurationMinutes(legacy.value);
    if (legacyMinutes !== null) {
      return legacyMinutes;
    }
  }

  return rangeDurationMinutes(range);
}

function changePomodoroLineUnits(line, units) {
  const range = parseTimeRange(line);

  if (!range) {
    return null;
  }

  const currentMinutes = pomodoroDurationMinutes(line, range);
  if (currentMinutes === null) {
    return null;
  }

  const nextMinutes = Math.max(
    0,
    currentMinutes + numericOrDefault(units, 0) * STEP_MINUTES,
  );
  const metadata = durationMetadata(nextMinutes, range.metadata);
  const nextEndMinutes = addMinutes(range.startMinutes, nextMinutes);
  const text = String(line || "");
  const newRange = formatTimeRange(
    range.startMinutes,
    nextEndMinutes,
    range.style,
    metadata,
  );
  return text.slice(0, range.startCh) + newRange + text.slice(range.endCh);
}

function offsetPomodoroLineRange(line, minutes) {
  const range = parseTimeRange(line);

  if (!range) {
    return null;
  }

  return replaceTimeRange(
    line,
    range,
    addMinutes(range.startMinutes, minutes),
    addMinutes(range.endMinutes, minutes),
  );
}

function parseLedgerLine(line) {
  const text = String(line || "");
  const match = LEDGER_LINE_RE.exec(text);

  if (!match) {
    return null;
  }

  const checkbox = match[2];
  return {
    checkbox,
    completed: checkbox === "x" || checkbox === "X",
    cancelled: checkbox === "-",
    open: checkbox === " " || checkbox === "/",
    inProgress: checkbox === "/",
    unchecked: checkbox === " ",
    range: parseTimeRange(text),
    placeholder: PLACEHOLDER_RE.test(text),
  };
}

function pomodoroItem(line, lineText, entry) {
  return {
    line,
    lineNumber: line,
    lineText,
    entry,
  };
}

function findActivePomodoroItemInSection(lines, section) {
  let latestTimed = null;
  let firstPlaceholder = null;

  for (let line = section.startLine; line <= section.endLine; line += 1) {
    const lineText = String(lines[line] || "");
    const entry = parseLedgerLine(lineText);

    if (!entry || !entry.open) {
      continue;
    }

    const item = pomodoroItem(line, lineText, entry);
    if (entry.range) {
      latestTimed = item;
    } else if (entry.placeholder && !firstPlaceholder) {
      firstPlaceholder = item;
    }
  }

  return latestTimed || firstPlaceholder;
}

function findCompletedPomodoroItemInSection(lines, section) {
  let lastCompleted = null;

  for (let line = section.startLine; line <= section.endLine; line += 1) {
    const lineText = String(lines[line] || "");
    const entry = parseLedgerLine(lineText);

    if (!entry || !entry.completed || (!entry.range && !entry.placeholder)) {
      continue;
    }

    lastCompleted = pomodoroItem(line, lineText, entry);
  }

  return lastCompleted;
}

function getActivePomodoroTarget(lines) {
  const section = findPomodorosSection(lines);

  if (!section) {
    return { target: null, error: "No ## Pomodoros section found" };
  }

  const target = findActivePomodoroItemInSection(lines, section);
  return {
    target,
    error: target ? null : "No active Pomodoro line found",
  };
}

function getJumpPomodoroTarget(lines) {
  const section = findPomodorosSection(lines);

  if (!section) {
    return { target: null, error: "No ## Pomodoros section found" };
  }

  const activeTarget = findActivePomodoroItemInSection(lines, section);
  if (activeTarget) {
    return { target: activeTarget, error: null };
  }

  const completedTarget = findCompletedPomodoroItemInSection(lines, section);
  return {
    target: completedTarget,
    error: completedTarget
      ? null
      : "No active or completed Pomodoro line found",
  };
}

function findActivePomodoroItem(lines) {
  return getActivePomodoroTarget(lines).target;
}

function currentPomodoroLineTarget(lines, section, cursorLine, requireRange) {
  if (
    !Number.isInteger(cursorLine) ||
    cursorLine < section.startLine ||
    cursorLine > section.endLine
  ) {
    return null;
  }

  const lineText = String(lines[cursorLine] || "");
  const entry = parseLedgerLine(lineText);

  if (!entry || (requireRange && !entry.range)) {
    return null;
  }

  return pomodoroItem(cursorLine, lineText, entry);
}

function getEditPomodoroTarget(lines, cursorLine, requireRange = true) {
  const section = findPomodorosSection(lines);

  if (!section) {
    return { target: null, error: "No ## Pomodoros section found" };
  }

  const currentTarget = currentPomodoroLineTarget(
    lines,
    section,
    cursorLine,
    requireRange,
  );
  if (currentTarget) {
    return { target: currentTarget, error: null };
  }

  const activeTarget = findActivePomodoroItemInSection(lines, section);
  if (!activeTarget) {
    return { target: null, error: "No active Pomodoro line found" };
  }

  if (requireRange && !activeTarget.entry.range) {
    return {
      target: null,
      error: "No Pomodoro line with a time range found",
    };
  }

  return { target: activeTarget, error: null };
}

function resolveEditPomodoroTarget(lines, cursorLine, requireRange = true) {
  return getEditPomodoroTarget(lines, cursorLine, requireRange).target;
}

