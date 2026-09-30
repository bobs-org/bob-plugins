const {
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  normalizePath,
  parseYaml,
} = require("obsidian");
const { Prec } = require("@codemirror/state");
const { EditorView, keymap } = require("@codemirror/view");

const DAY_MINUTES = 24 * 60;
const STEP_MINUTES = 5;
const DAILY_NOTES_COMMAND_ID = "daily-notes";
const DEFAULT_DAILY_NOTES_FORMAT = "YYYY/YYYYMMDD";
const DAILY_FORMAT_TOKENS = ["YYYY", "YY", "MM", "DD", "M", "D"];
const DAILY_OPEN_ATTEMPTS = 10;
const DAILY_OPEN_RETRY_DELAY_MS = 50;
const CENTER_ON_LINE_ATTEMPTS = 5;
const DAILY_LOCATION_RESTORE_RETRIES = 5;
const DAILY_LOCATION_RESTORE_ASSERT_FRAMES = 2;
const TRIGGER_RE = /(^|[^A-Za-z0-9_])((?:dt|[dtD])-?\d+|se\d*(?:-\d*)?|ta)$/;
const LEDGER_TRIGGER_RE = /^se(\d*)(?:-(\d*))?$/;
const DATE_TIME_TRIGGER_RE = /^(dt|[dtD])(-?\d+)$/;
const INCOMPLETE_NEGATIVE_OFFSET_TRIGGER_RE = /(^|[^A-Za-z0-9_])(?:dt|[dtD])-$/;
const WORD_CHAR_RE = /[A-Za-z0-9_]/;
const EM_DASH_REPLACEMENT = "— ";
const POMODOROS_HEADING_RE = /^##\s+Pomodoros(?:\s.*)?$/;
const LEVEL_TWO_HEADING_RE = /^##\s+/;
const LEDGER_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[([ /xX-])\]\s+)/;
const PLACEHOLDER_RE = /\(\s*\)/;
const COLON_TIME_RANGE_RE =
  /\((\*\*)?(\d\d):(\d\d)\s*-\s*(\d\d):(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const COMPACT_TIME_RANGE_RE =
  /\((\*\*)?(\d\d)(\d\d)\s*-\s*(\d\d)(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const DURATION_FIELD_RE = /\[t::\s*([^\]]*?)\s*\]/i;
const DURATION_FIELD_GLOBAL_RE = /\[t::\s*[^\]]*?\s*\]/gi;
const LEGACY_STOPWATCH_DURATION_RE =
  /\u23f1\ufe0f?\s*((?:(?:\d+\s*h)\s*)?(?:\d+\s*m)|(?:\d+\s*h))/i;
const LEGACY_STOPWATCH_DURATION_GLOBAL_RE =
  /\u23f1\ufe0f?\s*((?:(?:\d+\s*h)\s*)?(?:\d+\s*m)|(?:\d+\s*h))/gi;

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

function computeRange(now, durationMultiplier, offsetMultiplier, dashPresent) {
  const safeDate = coerceDate(now);
  const durationSteps = numericOrDefault(durationMultiplier, 5);
  const offsetSteps = numericOrDefault(offsetMultiplier, dashPresent ? 1 : 0);
  const offsetMinutes = offsetSteps * STEP_MINUTES;
  const durationMinutes = durationSteps * STEP_MINUTES;
  const currentMinutes = safeDate.getHours() * 60 + safeDate.getMinutes();
  const startMinutes = normalizeMinutes(
    Math.ceil((currentMinutes - offsetMinutes) / STEP_MINUTES) * STEP_MINUTES,
  );
  const endMinutes = normalizeMinutes(startMinutes + durationMinutes);
  const start = formatTime(startMinutes);
  const end = formatTime(endMinutes);
  const metadata = ` ${formatDurationField(durationMinutes)}`;

  return {
    startMinutes,
    endMinutes,
    durationMinutes,
    start,
    end,
    text: formatTimeRange(startMinutes, endMinutes, "compact", metadata),
  };
}

function computeSnippetExpansion(trigger, now = new Date()) {
  if (!trigger) {
    return null;
  }

  if (trigger.kind === "emDash") {
    return { replacement: EM_DASH_REPLACEMENT };
  }

  if (trigger.kind === "task") {
    const createdDate = formatLocalDate(now);
    return {
      replacement: `#task  [created::${createdDate}]`,
      cursorOffset: "#task ".length,
    };
  }

  if (trigger.kind === "ledgerRange") {
    const range = computeRange(
      now,
      trigger.durationMultiplier,
      trigger.offsetMultiplier,
      trigger.dashPresent,
    ).text;
    return {
      replacement: `${range} `,
      range,
    };
  }

  if (trigger.kind === "time") {
    const text = formatOffsetTime(now, trigger.offset);
    return { replacement: text, text };
  }

  if (trigger.kind === "date") {
    const text = formatOffsetDate(now, trigger.offset);
    return { replacement: text, text };
  }

  if (trigger.kind === "datedEntry") {
    const dateText = formatOffsetDate(now, trigger.offset);
    const replacement = `_${dateText}_ — `;
    return {
      replacement,
      cursorOffset: replacement.length,
      text: replacement,
    };
  }

  if (trigger.kind === "datetime") {
    const text = formatOffsetDateTime(now, trigger.offset);
    return { replacement: text, text };
  }

  return null;
}

function expansionCursorCh(expansion) {
  if (!expansion) {
    return null;
  }

  const offset = Number.isInteger(expansion.cursorOffset)
    ? expansion.cursorOffset
    : String(expansion.replacement || "").length;
  return expansion.fromCh + offset;
}

function isWordChar(value) {
  return typeof value === "string" && WORD_CHAR_RE.test(value);
}

function isTriggerBoundaryBlocked(trigger, nextChar) {
  if (trigger.kind === "emDash") {
    return nextChar === "-";
  }

  return isWordChar(nextChar);
}

function findExpansion(line, cursorCh, now = new Date()) {
  if (typeof line !== "string" || !Number.isInteger(cursorCh)) {
    return null;
  }

  if (cursorCh < 0 || cursorCh > line.length) {
    return null;
  }

  const trigger = parseTrigger(line.slice(0, cursorCh));
  if (!trigger || isTriggerBoundaryBlocked(trigger, line[cursorCh])) {
    return null;
  }

  const snippetExpansion = computeSnippetExpansion(trigger, now);
  if (!snippetExpansion) {
    return null;
  }

  let fromCh = trigger.startCh;
  let toCh = cursorCh;
  let replacement = snippetExpansion.replacement;

  if (
    trigger.kind === "ledgerRange" &&
    line[fromCh - 1] === "(" &&
    line[cursorCh] === ")"
  ) {
    fromCh -= 1;
    toCh += 1;
    replacement = snippetExpansion.range;
  }

  const expansion = {
    fromCh,
    toCh,
    replacement,
    trigger: trigger.trigger,
  };

  if (snippetExpansion.range !== undefined) {
    expansion.range = snippetExpansion.range;
  }

  if (snippetExpansion.text !== undefined) {
    expansion.text = snippetExpansion.text;
  }

  if (snippetExpansion.cursorOffset !== undefined) {
    expansion.cursorOffset = snippetExpansion.cursorOffset;
  }

  return expansion;
}

function expandLineAtCursor(line, cursorCh, now = new Date()) {
  const expansion = findExpansion(line, cursorCh, now);

  if (!expansion) {
    return null;
  }

  return {
    line:
      line.slice(0, expansion.fromCh) +
      expansion.replacement +
      line.slice(expansion.toCh),
    cursorCh: expansionCursorCh(expansion),
    expansion,
  };
}

function sameEditorPosition(left, right) {
  return (
    !!left &&
    !!right &&
    left.line === right.line &&
    left.ch === right.ch
  );
}

function isCollapsedCodeMirrorSelection(cmView) {
  const selection = cmView && cmView.state && cmView.state.selection;

  if (!selection || !Array.isArray(selection.ranges)) {
    return true;
  }

  if (selection.ranges.length !== 1) {
    return false;
  }

  const range = selection.ranges[0];
  return range.empty || range.from === range.to;
}

function getEditorLines(cm) {
  if (!cm) {
    return null;
  }

  if (typeof cm.getValue === "function") {
    return String(cm.getValue()).split(/\r?\n/);
  }

  if (typeof cm.getLine !== "function") {
    return null;
  }

  const firstLine = typeof cm.firstLine === "function" ? cm.firstLine() : 0;
  const lastLine =
    typeof cm.lastLine === "function"
      ? cm.lastLine()
      : typeof cm.lineCount === "function"
        ? Math.max(firstLine, cm.lineCount() - 1)
        : firstLine;
  const lines = [];

  for (let line = firstLine; line <= lastLine; line += 1) {
    lines[line] = cm.getLine(line) || "";
  }

  return lines;
}

function getEditorCursorLine(cm) {
  if (!cm || typeof cm.getCursor !== "function") {
    return null;
  }

  const cursor = cm.getCursor();
  return cursor && Number.isInteger(cursor.line) ? cursor.line : null;
}

function getActiveMarkdownView(app) {
  const workspace = app && app.workspace;
  if (!workspace || typeof workspace.getActiveViewOfType !== "function") {
    return null;
  }

  const view = workspace.getActiveViewOfType(MarkdownView);
  if (!(view instanceof MarkdownView) || !view.editor) {
    return null;
  }

  return view;
}

function getActiveMarkdownViewPath(app, view) {
  const file = (view && view.file) || getActiveFile(app);
  return file && typeof file.path === "string"
    ? normalizeVaultPath(file.path)
    : "";
}

function delay(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, numericOrDefault(ms, 0))),
  );
}

async function waitForActiveMarkdownView(app, options = {}) {
  const expectedPath = normalizeVaultPath(options.path || "");
  const attempts = Math.max(
    1,
    Math.floor(numericOrDefault(options.attempts, DAILY_OPEN_ATTEMPTS)),
  );
  const delayMs = Math.max(
    0,
    Math.floor(numericOrDefault(options.delayMs, DAILY_OPEN_RETRY_DELAY_MS)),
  );

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const view = getActiveMarkdownView(app);
    if (
      view &&
      (!expectedPath ||
        sameVaultPath(getActiveMarkdownViewPath(app, view), expectedPath))
    ) {
      return view;
    }

    if (attempt < attempts - 1) {
      await delay(delayMs);
    }
  }

  return null;
}

async function executeDailyNotesCommand(app) {
  const commands = app && app.commands;
  if (!commands || typeof commands.executeCommandById !== "function") {
    return false;
  }

  try {
    const result = await commands.executeCommandById(DAILY_NOTES_COMMAND_ID);
    return result !== false;
  } catch (error) {
    return false;
  }
}

function parentVaultPath(path) {
  const normalized = normalizeVaultPath(path);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex === -1 ? "" : normalized.slice(0, slashIndex);
}

function isMarkdownFileLike(file, expectedPath = "") {
  if (!file || typeof file.path !== "string") {
    return false;
  }

  if (expectedPath && !sameVaultPath(file.path, expectedPath)) {
    return false;
  }

  if (Array.isArray(file.children)) {
    return false;
  }

  return !file.extension || String(file.extension).toLowerCase() === "md";
}

async function ensureVaultFolder(app, folderPath) {
  const folder = normalizeVaultPath(folderPath);
  if (!folder) {
    return true;
  }

  const vault = app && app.vault;
  if (!vault) {
    return false;
  }

  let currentPath = "";
  for (const segment of folder.split("/")) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;

    const existing =
      typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(currentPath)
        : null;
    if (existing) {
      continue;
    }

    if (typeof vault.createFolder !== "function") {
      return false;
    }

    try {
      await vault.createFolder(currentPath);
    } catch (error) {
      const created =
        typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(currentPath)
          : null;
      if (!created) {
        return false;
      }
    }
  }

  return true;
}

async function resolveOrCreateDailyFile(app, path) {
  const vault = app && app.vault;
  if (!vault || typeof vault.getAbstractFileByPath !== "function") {
    return null;
  }

  const dailyPath = normalizeVaultPath(path);
  const existing = vault.getAbstractFileByPath(dailyPath);
  if (existing) {
    return isMarkdownFileLike(existing, dailyPath) ? existing : null;
  }

  if (typeof vault.create !== "function") {
    return null;
  }

  if (!(await ensureVaultFolder(app, parentVaultPath(dailyPath)))) {
    return null;
  }

  try {
    const created = await vault.create(dailyPath, "");
    return isMarkdownFileLike(created, dailyPath) ? created : null;
  } catch (error) {
    const created = vault.getAbstractFileByPath(dailyPath);
    return isMarkdownFileLike(created, dailyPath) ? created : null;
  }
}

async function openVaultFile(app, file) {
  const workspace = app && app.workspace;
  const leaf =
    workspace && typeof workspace.getLeaf === "function"
      ? workspace.getLeaf(false)
      : null;

  if (!leaf || typeof leaf.openFile !== "function") {
    return false;
  }

  try {
    await leaf.openFile(file);
    return true;
  } catch (error) {
    return false;
  }
}

function getMarkdownLeafFile(leaf) {
  const view = leaf && leaf.view;
  if (!(view instanceof MarkdownView)) {
    return null;
  }

  const file = view.file;
  return isMarkdownFileLike(file) ? file : null;
}

function getMarkdownLeafViewByPath(leaf, path = "") {
  const view = leaf && leaf.view;
  if (!(view instanceof MarkdownView) || !view.editor) {
    return null;
  }

  const file = getMarkdownLeafFile(leaf);
  if (!file) {
    return null;
  }

  const expectedPath = normalizeVaultPath(path || "");
  return !expectedPath || sameVaultPath(file.path, expectedPath) ? view : null;
}

function findOpenMarkdownLeafByPath(app, path) {
  const workspace = app && app.workspace;
  const expectedPath = normalizeVaultPath(path);
  if (
    !workspace ||
    !expectedPath ||
    typeof workspace.iterateAllLeaves !== "function"
  ) {
    return null;
  }

  let matchingLeaf = null;
  try {
    workspace.iterateAllLeaves((leaf) => {
      if (matchingLeaf) {
        return;
      }

      const file = getMarkdownLeafFile(leaf);
      if (file && sameVaultPath(file.path, expectedPath)) {
        matchingLeaf = leaf;
      }
    });
  } catch (error) {
    return null;
  }

  return matchingLeaf;
}

async function waitForMarkdownLeafViewByPath(leaf, options = {}) {
  const expectedPath = normalizeVaultPath(options.path || "");
  const attempts = Math.max(
    1,
    Math.floor(numericOrDefault(options.attempts, DAILY_OPEN_ATTEMPTS)),
  );
  const delayMs = Math.max(
    0,
    Math.floor(numericOrDefault(options.delayMs, DAILY_OPEN_RETRY_DELAY_MS)),
  );

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const view = getMarkdownLeafViewByPath(leaf, expectedPath);
    if (view) {
      return view;
    }

    if (attempt < attempts - 1) {
      await delay(delayMs);
    }
  }

  return null;
}

async function activateMarkdownLeaf(app, leaf, options = {}) {
  const workspace = app && app.workspace;
  if (!workspace || !leaf) {
    return null;
  }

  if (typeof workspace.revealLeaf === "function") {
    try {
      await workspace.revealLeaf(leaf);
    } catch (error) {
      // Continue with direct activation when revealing is unavailable or fails.
    }
  }

  let activated = false;
  if (typeof workspace.setActiveLeaf === "function") {
    try {
      await workspace.setActiveLeaf(leaf, { focus: true });
      activated = true;
    } catch (error) {
      try {
        await workspace.setActiveLeaf(leaf);
        activated = true;
      } catch (ignoredError) {
        // Fall through to the leaf-level focus API below.
      }
    }
  }

  if (!activated && typeof leaf.focus === "function") {
    try {
      await leaf.focus();
      activated = true;
    } catch (error) {
      // Report activation failure below.
    }
  }

  if (!activated) {
    return null;
  }

  return (
    (await waitForMarkdownLeafViewByPath(leaf, options)) ||
    waitForActiveMarkdownView(app, options)
  );
}

async function openTodayDailyNoteWithState(app, options = {}) {
  const dailyPath = todayDailyPath(
    options.now || new Date(),
    options.dailyOptions || getDailyNotesOptions(app),
  );
  const attempts = Math.max(
    1,
    Math.floor(numericOrDefault(options.attempts, DAILY_OPEN_ATTEMPTS)),
  );
  const delayMs = Math.max(
    0,
    Math.floor(numericOrDefault(options.delayMs, DAILY_OPEN_RETRY_DELAY_MS)),
  );

  const existingLeaf = findOpenMarkdownLeafByPath(app, dailyPath);
  if (existingLeaf) {
    const view = await activateMarkdownLeaf(app, existingLeaf, {
      path: dailyPath,
      attempts,
      delayMs,
    });
    return view
      ? { view, path: dailyPath, reusedOpenLeaf: true }
      : null;
  }

  if (await executeDailyNotesCommand(app)) {
    const commandView = await waitForActiveMarkdownView(app, {
      path: dailyPath,
      attempts,
      delayMs,
    });
    if (commandView) {
      return { view: commandView, path: dailyPath, reusedOpenLeaf: false };
    }
  }

  const file = await resolveOrCreateDailyFile(app, dailyPath);
  if (!file || !(await openVaultFile(app, file))) {
    return null;
  }

  const view =
    (await waitForActiveMarkdownView(app, {
      path: dailyPath,
      attempts,
      delayMs,
    })) || getActiveMarkdownView(app);
  if (
    !view ||
    !sameVaultPath(getActiveMarkdownViewPath(app, view), dailyPath)
  ) {
    return null;
  }

  return { view, path: dailyPath, reusedOpenLeaf: false };
}

async function openTodayDailyNote(app, options = {}) {
  const result = await openTodayDailyNoteWithState(app, options);
  return result ? result.view : null;
}

function getActiveEditorView(app) {
  const view = getActiveMarkdownView(app);
  if (!view) {
    return null;
  }

  return getEditorViewFromEditor(view.editor);
}

function getEditorViewFromEditor(cm) {
  // Resolve the underlying CodeMirror 6 EditorView from every shape the codebase
  // hands us: the codemirror-vim CM5 adapter (its CM6 view is `.cm6`), an
  // Obsidian Editor (its CM6 view is `.cm`), or a raw EditorView (itself).
  const editorView = cm && (cm.cm6 || cm.cm || cm);
  if (
    !editorView ||
    !editorView.state ||
    !editorView.state.doc ||
    typeof editorView.dispatch !== "function"
  ) {
    return null;
  }

  return editorView;
}

function positionFromCodeMirrorUpdate(update) {
  const state = update && (update.state || (update.view && update.view.state));
  const selection = state && state.selection;
  const mainSelection = selection && selection.main;
  const rawHead = mainSelection && mainSelection.head;
  const head = Math.floor(numericOrDefault(rawHead, Number.NaN));
  const doc = state && state.doc;
  if (!Number.isFinite(head) || !doc) {
    return null;
  }

  if (typeof doc.lineAt === "function") {
    try {
      const line = doc.lineAt(head);
      if (line && Number.isFinite(line.number) && Number.isFinite(line.from)) {
        return normalizeEditorPosition({
          line: line.number - 1,
          ch: head - line.from,
        });
      }
    } catch (error) {
      return null;
    }
  }

  if (typeof doc.toString === "function") {
    const text = doc.toString();
    const safeHead = Math.min(Math.max(head, 0), text.length);
    const beforeCursor = text.slice(0, safeHead);
    const lines = beforeCursor.split("\n");
    const line = lines.length - 1;
    const lastLine = lines[line] || "";
    return {
      line,
      ch: lastLine.endsWith("\r") ? lastLine.length - 1 : lastLine.length,
    };
  }

  return null;
}

function getEditorLastLine(cm) {
  if (!cm) {
    return null;
  }

  if (typeof cm.lastLine === "function") {
    const line = Math.floor(numericOrDefault(cm.lastLine(), Number.NaN));
    if (Number.isFinite(line)) {
      return Math.max(line, 0);
    }
  }

  if (typeof cm.lineCount === "function") {
    const count = Math.floor(numericOrDefault(cm.lineCount(), Number.NaN));
    if (Number.isFinite(count)) {
      return Math.max(count - 1, 0);
    }
  }

  if (typeof cm.getValue === "function") {
    return Math.max(String(cm.getValue()).split(/\r?\n/).length - 1, 0);
  }

  return null;
}

function getEditorLineText(cm, line) {
  if (!cm) {
    return null;
  }

  if (typeof cm.getLine === "function") {
    const text = cm.getLine(line);
    return text === null || text === undefined ? "" : String(text);
  }

  if (typeof cm.getValue === "function") {
    const lines = String(cm.getValue()).split(/\r?\n/);
    return lines[line] === undefined ? "" : lines[line];
  }

  return null;
}

function clampEditorPosition(cm, position) {
  const normalized = normalizeEditorPosition(position);
  if (!normalized) {
    return null;
  }

  const lastLine = getEditorLastLine(cm);
  const line =
    lastLine === null ? normalized.line : Math.min(normalized.line, lastLine);
  const lineText = getEditorLineText(cm, line);
  const ch =
    lineText === null ? normalized.ch : Math.min(normalized.ch, lineText.length);
  return { line, ch };
}

function getScrollDOMMaxScrollTop(scrollDOM) {
  if (!scrollDOM) {
    return Number.POSITIVE_INFINITY;
  }

  const scrollHeight = finiteNumberOrNull(scrollDOM.scrollHeight);
  const clientHeight = finiteNumberOrNull(scrollDOM.clientHeight);
  if (scrollHeight === null || clientHeight === null || clientHeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, scrollHeight - clientHeight);
}

function getScrollDOMMaxScrollLeft(scrollDOM) {
  if (!scrollDOM) {
    return Number.POSITIVE_INFINITY;
  }

  const scrollWidth = finiteNumberOrNull(scrollDOM.scrollWidth);
  const clientWidth = finiteNumberOrNull(scrollDOM.clientWidth);
  if (scrollWidth === null || clientWidth === null || clientWidth <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, scrollWidth - clientWidth);
}

function setScrollDOMPosition(scrollDOM, scrollTop, scrollLeft = null) {
  if (!scrollDOM) {
    return false;
  }

  const targetScrollTop = clampNumber(
    scrollTop,
    0,
    getScrollDOMMaxScrollTop(scrollDOM),
  );
  const rawScrollLeft =
    finiteNumberOrNull(scrollLeft) ?? finiteNumberOrNull(scrollDOM.scrollLeft) ?? 0;
  const targetScrollLeft = clampNumber(
    rawScrollLeft,
    0,
    getScrollDOMMaxScrollLeft(scrollDOM),
  );

  if (typeof scrollDOM.scrollTo === "function") {
    try {
      scrollDOM.scrollTo({ top: targetScrollTop, left: targetScrollLeft });
      return true;
    } catch (error) {
      // Fall through to direct assignment.
    }
  }

  try {
    scrollDOM.scrollTop = targetScrollTop;
    scrollDOM.scrollLeft = targetScrollLeft;
    return true;
  } catch (error) {
    return false;
  }
}

function editorViewPositionFromLineCh(editorView, line, ch) {
  const doc = editorView && editorView.state && editorView.state.doc;
  if (!doc || typeof doc.line !== "function") {
    return null;
  }

  const lineCount =
    Number.isInteger(doc.lines) && doc.lines > 0 ? doc.lines : 1;
  const safeLine = Math.min(
    Math.max(Math.floor(numericOrDefault(line, 0)), 0),
    lineCount - 1,
  );

  let lineInfo;
  try {
    lineInfo = doc.line(safeLine + 1);
  } catch (error) {
    return null;
  }

  if (
    !lineInfo ||
    !Number.isInteger(lineInfo.from) ||
    !Number.isInteger(lineInfo.to)
  ) {
    return null;
  }

  const maxCh = Math.max(lineInfo.to - lineInfo.from, 0);
  const safeCh = Math.min(
    Math.max(Math.floor(numericOrDefault(ch, 0)), 0),
    maxCh,
  );
  return lineInfo.from + safeCh;
}

function centerEditorViewOnPosition(editorView, line, ch) {
  if (
    !editorView ||
    typeof editorView.dispatch !== "function" ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const position = editorViewPositionFromLineCh(editorView, line, ch);
  if (position === null) {
    return false;
  }

  try {
    editorView.dispatch({
      effects: EditorView.scrollIntoView(position, {
        y: "center",
        x: "nearest",
      }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

function scrollEditorIntoView(cm, line, ch) {
  if (cm && typeof cm.scrollIntoView === "function") {
    cm.scrollIntoView({ line, ch });
    return true;
  }

  return false;
}

function focusEditor(cm) {
  if (!cm) {
    return false;
  }

  if (typeof cm.focus === "function") {
    try {
      cm.focus();
      return true;
    } catch (error) {
      // Fall through to the underlying CodeMirror view when available.
    }
  }

  const editorView = getEditorViewFromEditor(cm);
  if (editorView && typeof editorView.focus === "function") {
    try {
      editorView.focus();
      return true;
    } catch (error) {
      return false;
    }
  }

  return false;
}

function setEditorCursor(cm, line, ch, options = {}) {
  if (!cm || typeof cm.setCursor !== "function") {
    return false;
  }

  try {
    cm.setCursor(line, ch);
  } catch (error) {
    cm.setCursor({ line, ch });
  }

  if (options.scroll !== false) {
    scrollEditorIntoView(cm, line, ch);
  }

  return true;
}

// Defer `callback` past the current synchronous turn (e.g. the codemirror-vim
// command cycle) so any scroll it dispatches runs after Vim's own trailing
// "keep cursor visible" scroll. Returns a handle that cancelDeferred can clear.
function deferToNextFrame(callback) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    return { type: "raf", handle: window.requestAnimationFrame(callback) };
  }

  return { type: "timeout", handle: setTimeout(callback, 0) };
}

function cancelDeferred(deferred) {
  if (!deferred) {
    return;
  }

  if (
    deferred.type === "raf" &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(deferred.handle);
    return;
  }

  if (deferred.type === "timeout") {
    clearTimeout(deferred.handle);
  }
}

function replaceEditorLine(cm, line, oldLineText, newLineText) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }

  cm.replaceRange(
    newLineText,
    { line, ch: 0 },
    { line, ch: oldLineText.length },
  );
  return true;
}

// --- Plan budget ----------------------------------------------------------
// JavaScript mirror of docs/plan.md (bob-cli), the authoritative definition.
// The Rust engine (src/native/plan_budget/) implements the same rules; both
// test against the same conformance examples. Field names are camelCase here.

const PLAN_UNNAMED_THEME = "(unnamed)";
const PLAN_CONFIG_RELATIVE_PATH = "bob/config.yml";
const PLAN_TASKS_PLUGIN_ID = "obsidian-tasks-plugin";
const PLAN_LINT_THEME_CAP = "plan_theme_cap_exceeded";
const PLAN_LINT_LINK_CAP = "plan_link_cap_exceeded";
const PLAN_LINT_DUPLICATE_NAME = "duplicate_open_pomodoro_name";
const PLAN_LINT_INVENTORY_LABEL = "inventory_label_open";
const PLAN_LINT_SUBHEADING = "subheading_in_pomodoros";
const PLAN_LINT_NOW_CAP = "now_cap_exceeded";
const PLAN_DAILY_PATH_RE = /(^|\/)\d{4}\/\d{8}\.md$/;
const PLAN_ENTRY_RE = /^- \[([^\]])\]/;
const PLAN_PLACEHOLDER_RE = /^\([ \t]*\)/;
const PLAN_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const PLAN_ATX_RE = /^(?: {0,3})(#{1,6})(?:\s|$)/;
const PLAN_NOW_TAG_RE = /(?:^|\s)#now(?:\s|$)/;

function defaultPlanCaps() {
  return {
    maxThemes: 3,
    maxLinks: 10,
    maxNow: 15,
    strict: false,
    exempt: ["GTD"],
    inventoryLabels: ["LATER", "MISC", "NEW FEATURES", "SASE"],
  };
}

function planCapOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

function planStringListOrDefault(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return [...fallback];
    }
    out.push(item.trim());
  }
  return out;
}

// Whole-token, case-sensitive `#now`: preceded by the line start or
// whitespace, followed by the end or whitespace. `#nowadays` and `#now/x`
// never match.
function hasNowTag(text) {
  return PLAN_NOW_TAG_RE.test(String(text || ""));
}

// Case-insensitive component key: collapsed whitespace, lowercased.
function normalizePlanComponent(value) {
  return String(value || "")
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

function splitPlanComponents(name) {
  return String(name || "")
    .split("+")
    .map((component) => component.trim())
    .filter((component) => component.length > 0);
}

// Normalize a camelCase caps object, substituting defaults for anything
// missing or invalid. Never throws.
function effectivePlanCaps(caps) {
  const defaults = defaultPlanCaps();
  const raw =
    caps && typeof caps === "object" && !Array.isArray(caps) ? caps : {};
  return {
    maxThemes: planCapOrDefault(raw.maxThemes, defaults.maxThemes),
    maxLinks: planCapOrDefault(raw.maxLinks, defaults.maxLinks),
    maxNow: planCapOrDefault(raw.maxNow, defaults.maxNow),
    strict:
      typeof raw.strict === "boolean" ? raw.strict : defaults.strict,
    exempt: planStringListOrDefault(raw.exempt, defaults.exempt),
    inventoryLabels: planStringListOrDefault(
      raw.inventoryLabels,
      defaults.inventoryLabels,
    ),
  };
}

// Read the `plan:` block out of a parsed config file (snake_case keys, with
// camelCase tolerated). Unknown keys stay ignored. A missing block means the
// defaults; any invalid value falls back to the full default block, as Rust
// does. Use coercePlanCaps when the invalid flag matters.
function parsePlanCaps(yamlObject) {
  return coercePlanCaps(planCapsBlock(yamlObject)).caps;
}

function planCapsBlock(yamlObject) {
  if (
    !yamlObject ||
    typeof yamlObject !== "object" ||
    Array.isArray(yamlObject)
  ) {
    return {};
  }
  const block = yamlObject.plan;
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return {};
  }
  return block;
}

function coercePlanCaps(block) {
  const defaults = defaultPlanCaps();
  const raw =
    block && typeof block === "object" && !Array.isArray(block) ? block : {};
  const pick = (snake, camel) =>
    raw[snake] !== undefined ? raw[snake] : raw[camel];
  let invalid = false;
  const cap = (snake, camel, fallback) => {
    const value = pick(snake, camel);
    if (value === undefined) {
      return fallback;
    }
    if (!Number.isInteger(value) || value < 1) {
      invalid = true;
      return fallback;
    }
    return value;
  };
  const list = (snake, camel, fallback) => {
    const value = pick(snake, camel);
    if (value === undefined) {
      return [...fallback];
    }
    if (!Array.isArray(value)) {
      invalid = true;
      return [...fallback];
    }
    const out = [];
    for (const item of value) {
      if (typeof item !== "string" || !item.trim()) {
        invalid = true;
        return [...fallback];
      }
      out.push(item.trim());
    }
    return out;
  };
  const strictValue = pick("strict", "strict");
  let strict = defaults.strict;
  if (strictValue !== undefined) {
    if (typeof strictValue !== "boolean") {
      invalid = true;
    } else {
      strict = strictValue;
    }
  }
  const caps = {
    maxThemes: cap("max_themes", "maxThemes", defaults.maxThemes),
    maxLinks: cap("max_links", "maxLinks", defaults.maxLinks),
    maxNow: cap("max_now", "maxNow", defaults.maxNow),
    strict,
    exempt: list("exempt", "exempt", defaults.exempt),
    inventoryLabels: list(
      "inventory_labels",
      "inventoryLabels",
      defaults.inventoryLabels,
    ),
  };
  // Like Rust, any invalid value falls back to the full default block.
  if (invalid) {
    return { caps: { ...defaults }, invalid: true };
  }
  return { caps, invalid: false };
}

function emptyPlanBudget(caps) {
  const effective = effectivePlanCaps(caps);
  return {
    hasSection: false,
    themes: { count: 0, cap: effective.maxThemes, over: false },
    links: { count: 0, cap: effective.maxLinks, over: false },
    status: "ok",
    themeNames: [],
    entries: [],
    warnings: [],
  };
}

function planFenceMarker(line) {
  const text = String(line || "");
  let indent = 0;
  while (text[indent] === " ") {
    indent += 1;
  }
  if (indent > 3) {
    return null;
  }
  const rest = text.slice(indent);
  const char = rest[0];
  if (char !== "`" && char !== "~") {
    return null;
  }
  let length = 0;
  while (rest[length] === char) {
    length += 1;
  }
  return length >= 3 ? { char, length } : null;
}

function planClosesFence(line, open) {
  const marker = planFenceMarker(line);
  if (!marker) {
    return false;
  }
  const trimmed = String(line || "").trimStart();
  return (
    marker.char === open.char &&
    marker.length >= open.length &&
    trimmed.slice(marker.length).trim() === ""
  );
}

function planFencedLines(lines, start, end) {
  const fenced = new Set();
  let open = null;
  for (let index = start; index <= end; index += 1) {
    const line = lines[index];
    if (open) {
      fenced.add(index);
      if (planClosesFence(line, open)) {
        open = null;
      }
    } else {
      const marker = planFenceMarker(line);
      if (marker) {
        fenced.add(index);
        open = marker;
      }
    }
  }
  return fenced;
}

function planAtxLevel(line) {
  const match = PLAN_ATX_RE.exec(String(line || ""));
  return match ? match[1].length : null;
}

// Ledger lines: from the `## Pomodoros` heading up to the next `## `
// heading. Frontmatter and fenced code blocks are skipped. Returns
// `{ start, end }` 0-based inclusive, or null.
function planSectionRange(lines) {
  if (!Array.isArray(lines)) {
    return null;
  }
  let frontmatterEnd = -1;
  if (String(lines[0] || "").trimEnd() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      if (String(lines[index] || "").trimEnd() === "---") {
        frontmatterEnd = index;
        break;
      }
    }
  }
  let sectionStart = -1;
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (index <= frontmatterEnd) {
      continue;
    }
    const line = String(lines[index] || "");
    if (fence) {
      if (planClosesFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const marker = planFenceMarker(line);
    if (marker) {
      fence = marker;
      continue;
    }
    if (sectionStart === -1) {
      if (/^##\s+Pomodoros(?:\s|$)/.test(line)) {
        sectionStart = index + 1;
      }
    } else if (/^##\s/.test(line)) {
      return { start: sectionStart, end: index - 1 };
    }
  }
  return sectionStart === -1
    ? null
    : { start: sectionStart, end: lines.length - 1 };
}

function planNormalizeHhmm(value) {
  const digits = String(value || "").replace(/:/g, "");
  if (!/^\d{4}$/.test(digits)) {
    return null;
  }
  const hours = Number.parseInt(digits.slice(0, 2), 10);
  const minutes = Number.parseInt(digits.slice(2), 10);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return digits;
}

function planParseParentheticalTime(inside) {
  const dash = String(inside || "").indexOf("-");
  if (dash === -1) {
    return null;
  }
  let rawStart = String(inside).slice(0, dash).trim();
  let bold = false;
  if (rawStart.startsWith("**")) {
    bold = true;
    rawStart = rawStart.slice(2).trim();
  }
  const start = planNormalizeHhmm(rawStart);
  if (!start) {
    return null;
  }
  const rawEnd = String(inside).slice(dash + 1).trimStart();
  const endMatch = /^[0-9:]+/.exec(rawEnd);
  if (!endMatch) {
    return null;
  }
  const end = planNormalizeHhmm(endMatch[0]);
  if (!end) {
    return null;
  }
  let rest = rawEnd.slice(endMatch[0].length);
  if (bold) {
    if (!rest.startsWith("**")) {
      return null;
    }
    rest = rest.slice(2);
  } else if (rest.startsWith("**")) {
    return null;
  }
  if (rest !== "" && !/^\s/.test(rest)) {
    return null;
  }
  return { start, end };
}

// Leading `()` placeholder or `(time-range)` of an entry body, mirroring
// capture_pomodoros::parse_entry_body. A name only exists after one of these.
function planLeadingRange(body) {
  const text = String(body || "");
  const placeholder = PLAN_PLACEHOLDER_RE.exec(text);
  if (placeholder) {
    return {
      length: placeholder[0].length,
      timeRange: null,
      placeholder: true,
    };
  }
  if (!text.startsWith("(")) {
    return { length: null, timeRange: null, placeholder: false };
  }
  const close = text.indexOf(")", 1);
  if (close === -1) {
    return { length: null, timeRange: null, placeholder: false };
  }
  const parsed = planParseParentheticalTime(text.slice(1, close));
  if (!parsed) {
    return { length: null, timeRange: null, placeholder: false };
  }
  return {
    length: close + 1,
    timeRange: `${parsed.start}-${parsed.end}`,
    placeholder: false,
  };
}

// The text after `—` (em dash) that follows the leading placeholder or time
// range. A merged name (`BOB + DECKS`) is split by the caller.
function planParseNameTail(remaining) {
  const trimmed = String(remaining || "").replace(/^[ \t]+/, "");
  if (!trimmed.startsWith("—")) {
    return null;
  }
  const name = trimmed.slice(1).replace(/^[ \t]+/, "").trim();
  return name ? name : null;
}

function planParseEntry(line) {
  const text = String(line || "");
  const match = PLAN_ENTRY_RE.exec(text);
  if (!match) {
    return null;
  }
  const afterBracket = text.slice(match[0].length);
  if (!/^\s/.test(afterBracket)) {
    return null;
  }
  const body = afterBracket.trim();
  const checkbox = String(match[1] || "").trim();
  if (/^x$/i.test(checkbox)) {
    return { state: "completed", body };
  }
  if (checkbox === "-") {
    return { state: "cancelled", body };
  }
  return { state: "open", body };
}

// Inner spans of `~~…~~` struck pairs on one line.
function planStruckInnerSpans(line) {
  const text = String(line || "");
  const marks = [];
  let base = 0;
  let rest = text;
  for (;;) {
    const found = rest.indexOf("~~");
    if (found === -1) {
      break;
    }
    marks.push(base + found);
    base += found + 2;
    rest = text.slice(base);
  }
  const spans = [];
  for (let index = 0; index + 1 < marks.length; index += 2) {
    spans.push([marks[index] + 2, marks[index + 1]]);
  }
  return spans;
}

// Block links `[[target#^id]]` (also `![[…]]` and `[[…|alias]]`, with or
// without a trailing `#` move-only marker) outside `~~…~~` struck spans.
// An empty target, the daily note's vault-relative path without `.md`, and
// its basename all canonicalize to the daily path itself (rule 6).
function planCanonicalTarget(target, dailyPath) {
  const name = String(target || "");
  if (!dailyPath) {
    return name;
  }
  const daily = String(dailyPath).replace(/\.md$/, "");
  if (!daily) {
    return name;
  }
  const basename = daily.split("/").pop();
  if (name === "" || name === daily || name === basename) {
    return daily;
  }
  return name;
}

function planBlockLinks(line, dailyPath) {
  const text = String(line || "");
  const struck = planStruckInnerSpans(text);
  const links = [];
  let base = 0;
  let rest = text;
  for (;;) {
    const open = rest.indexOf("[[");
    if (open === -1) {
      break;
    }
    const absoluteOpen = base + open;
    const afterOpen = rest.slice(open + 2);
    const close = afterOpen.indexOf("]]");
    if (close === -1) {
      break;
    }
    let inside = afterOpen.slice(0, close);
    let linkEnd = absoluteOpen + 2 + close + 2;
    if (rest.slice(open + 2 + close + 2).startsWith("#")) {
      linkEnd += 1;
    }
    if (inside.endsWith("#")) {
      inside = inside.slice(0, -1);
    }
    const pipe = inside.indexOf("|");
    const target = pipe === -1 ? inside : inside.slice(0, pipe);
    const caret = target.indexOf("#^");
    if (caret !== -1) {
      const blockId = target.slice(caret + 2).trim();
      if (
        blockId &&
        PLAN_BLOCK_ID_RE.test(blockId) &&
        !struck.some(
          ([start, end]) => absoluteOpen >= start && linkEnd <= end,
        )
      ) {
        let name = target.slice(0, caret).trim();
        if (name.endsWith(".md")) {
          name = name.slice(0, -3);
        }
        links.push([planCanonicalTarget(name, dailyPath), blockId]);
      }
    }
    base = linkEnd;
    rest = text.slice(base);
  }
  return links;
}

function planMeter(count, cap) {
  return { count, cap, over: count > cap };
}

// Pure ledger budget and lint engine implementing docs/plan.md rules 1–9.
function computePlanBudget(content, caps, dailyPath) {
  const effective = effectivePlanCaps(caps);
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const section = planSectionRange(lines);
  if (!section) {
    return emptyPlanBudget(effective);
  }
  const fenced = planFencedLines(lines, section.start, section.end);
  const warnings = [];
  for (let index = section.start; index <= section.end; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const level = planAtxLevel(lines[index]);
    if (level !== null && level >= 3) {
      warnings.push({
        code: PLAN_LINT_SUBHEADING,
        message:
          "subheading inside the Pomodoros section splits time totals",
        line: index + 1,
      });
    }
  }

  const scanned = [];
  for (let index = section.start; index <= section.end; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const line = String(lines[index] || "");
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }
    const parsed = planParseEntry(line);
    if (!parsed) {
      continue;
    }
    if (parsed.state === "cancelled") {
      continue;
    }
    const leading = planLeadingRange(parsed.body);
    const name =
      leading.length === null
        ? null
        : planParseNameTail(parsed.body.slice(leading.length));
    scanned.push({
      line: index + 1,
      state: parsed.state,
      name,
      timeRange: leading.timeRange,
      placeholder: leading.placeholder,
      isCurrent: false,
    });
  }

  const timedOpen = scanned.filter(
    (entry) => entry.state === "open" && entry.timeRange !== null,
  );
  if (timedOpen.length === 1) {
    timedOpen[0].isCurrent = true;
  }

  const exempt = new Set(
    effective.exempt.map((value) => normalizePlanComponent(value)),
  );
  const inventory = new Set(
    effective.inventoryLabels.map((value) => normalizePlanComponent(value)),
  );
  const entryLines = new Set(scanned.map((entry) => entry.line));

  const entries = [];
  const themeNames = [];
  const themeKeys = new Set();
  const seenThemes = new Map();
  const inventoryWarned = new Set();
  const seenLinks = new Set();
  let unnamedCounted = false;

  for (const entry of scanned) {
    if (entry.state !== "open") {
      continue;
    }
    const components = entry.name ? splitPlanComponents(entry.name) : [];
    const keys = components.map((component) =>
      normalizePlanComponent(component),
    );
    const exemptEntry =
      keys.length > 0 && keys.every((key) => exempt.has(key));
    let entryLinks = [];
    if (!exemptEntry) {
      for (
        let offset = 0;
        entry.line + offset <= section.end;
        offset += 1
      ) {
        const index = entry.line + offset;
        if (entryLines.has(index + 1)) {
          break;
        }
        if (fenced.has(index)) {
          continue;
        }
        const line = String(lines[index] || "");
        if (line !== "" && !line.startsWith(" ") && !line.startsWith("\t")) {
          break;
        }
        for (const link of planBlockLinks(line, dailyPath)) {
          entryLinks.push(link);
        }
      }
    }
    if (components.length === 0 && entryLinks.length === 0) {
      // An empty `()` placeholder never counts.
      continue;
    }

    const distinctLinks = new Set();
    if (!exemptEntry) {
      for (const [target, blockId] of entryLinks) {
        const key = `${target}\u0000${blockId}`;
        distinctLinks.add(key);
        seenLinks.add(key);
      }
    }

    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      const key = keys[index];
      if (exempt.has(key)) {
        continue;
      }
      if (seenThemes.has(key)) {
        warnings.push({
          code: PLAN_LINT_DUPLICATE_NAME,
          message:
            `${component} is open in more than one Pomodoro ` +
            `(lines ${seenThemes.get(key)} and ${entry.line})`,
          line: entry.line,
        });
      } else {
        seenThemes.set(key, entry.line);
      }
      if (inventory.has(key) && !inventoryWarned.has(key)) {
        inventoryWarned.add(key);
        warnings.push({
          code: PLAN_LINT_INVENTORY_LABEL,
          message: `${component} is an inventory label, not a theme`,
          line: entry.line,
        });
      }
    }

    if (components.length === 0 && !unnamedCounted) {
      unnamedCounted = true;
      themeKeys.add(PLAN_UNNAMED_THEME);
      themeNames.push(PLAN_UNNAMED_THEME);
    }
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      const key = keys[index];
      if (exempt.has(key) || themeKeys.has(key)) {
        continue;
      }
      themeKeys.add(key);
      themeNames.push(component);
    }

    const row = {
      line: entry.line,
      name: entry.name === null ? PLAN_UNNAMED_THEME : entry.name,
      components,
      exempt: exemptEntry,
      running: entry.isCurrent,
      highlight: false,
      links: distinctLinks.size,
    };
    if (entry.timeRange !== null) {
      row.timeRange = entry.timeRange;
    }
    entries.push(row);
  }

  const highlightIndex = entries.findIndex((entry) => !entry.exempt);
  if (highlightIndex !== -1) {
    entries[highlightIndex].highlight = true;
  }

  const themes = planMeter(themeNames.length, effective.maxThemes);
  const links = planMeter(seenLinks.size, effective.maxLinks);
  const status = themes.over || links.over ? "over" : "ok";
  if (themes.over) {
    warnings.push({
      code: PLAN_LINT_THEME_CAP,
      message: `today's plan has ${themes.count}/${themes.cap} themes`,
    });
  }
  if (links.over) {
    warnings.push({
      code: PLAN_LINT_LINK_CAP,
      message: `today's plan has ${links.count}/${links.cap} links`,
    });
  }

  return {
    hasSection: true,
    themes,
    links,
    status,
    themeNames,
    entries,
    warnings,
  };
}

module.exports = class BobLedgerToolsPlugin extends Plugin {
  onload() {
    this.vimMappingsRegistered = false;
    this.pendingCenterDeferred = null;
    this.dailyLocations = new Map();
    this.dailyNavigationActionId = 0;
    this.dailyLocationRestoreToken = 0;
    this.pendingDailyLocationRestoreDeferred = null;
    this.pendingDailyLocationRestorePath = null;
    this.pendingDailyLocationCaptureDeferred = null;
    this.activeDailyScrollDOM = null;
    this.activeDailyScrollHandler = null;
    this.isRestoringDailyLocation = false;

    this.addCommand({
      id: "expand-ledger-time-range-snippet",
      name: "Expand Bob snippet",
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView && this.expandFromEditor(editor)) {
          return;
        }

        new Notice("No Bob snippet at cursor");
      },
    });

    this.addCommand({
      id: "open-today-daily-note",
      name: "Open today's daily note",
      callback: async () => {
        const view = await openTodayDailyNote(this.app);
        if (!view) {
          new Notice("Could not open daily note");
        }
      },
    });

    this.addCommand({
      id: "jump-to-current-pomodoro",
      name: "Jump to current Pomodoro line",
      hotkeys: [{ modifiers: ["Ctrl"], key: "9" }],
      callback: () => {
        const view = getActiveMarkdownView(this.app);
        if (!view || !view.editor) {
          new Notice("No active markdown editor");
          return;
        }
        this.jumpToCurrentPomodoro(view.editor);
      },
    });

    this.registerEditorExtension(
      Prec.highest(
        keymap.of([
          {
            key: "Tab",
            run: (cmView) => this.expandFromActiveEditor(cmView),
          },
        ]),
      ),
    );

    if (
      EditorView &&
      EditorView.updateListener &&
      typeof EditorView.updateListener.of === "function"
    ) {
      this.registerEditorExtension(
        EditorView.updateListener.of((update) =>
          this.trackDailyLocationUpdate(update),
        ),
      );
    }

    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      this.registerEvent(
        workspace.on("active-leaf-change", () =>
          this.handleActiveDailyViewChange(),
        ),
      );
      this.registerEvent(
        workspace.on("file-open", () => this.handleActiveDailyViewChange()),
      );
    }

    // Live plan budget: a ```bob-plan block plus the versioned `api` the dash
    // and the other plugins call instead of re-implementing docs/plan.md.
    this.planBlockViews = new Set();
    this.planBlockRerenderTimer = null;
    this.api = {
      version: 1,
      caps: () => loadPlanCaps().caps,
      planBudget: (options = {}) => this.planBudgetForCallers(options),
      nowBudget: () => {
        const { caps } = loadPlanCaps();
        return nowBudgetFromTasks(
          planBlockTasks(this.app) || [],
          new Date(),
          caps,
        );
      },
    };
    if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
      this.registerMarkdownCodeBlockProcessor("bob-plan", (source, el, ctx) =>
        this.renderPlanBlock(el, ctx),
      );
    }
    const metadataCache = this.app && this.app.metadataCache;
    if (metadataCache && typeof metadataCache.on === "function") {
      this.registerEvent(
        metadataCache.on("changed", (file) =>
          this.schedulePlanBlockRerenderForFile(file),
        ),
      );
    }
    const planWorkspace = this.app && this.app.workspace;
    if (planWorkspace && typeof planWorkspace.on === "function") {
      // The vault runs Tasks 8.4.0, which fires this on every cache update.
      this.registerEvent(
        planWorkspace.on("obsidian-tasks-plugin:cache-update", () =>
          this.schedulePlanBlockRerender(),
        ),
      );
    }
    const tasksPluginLoaded = Boolean(
      this.app &&
        this.app.plugins &&
        this.app.plugins.plugins &&
        this.app.plugins.plugins["obsidian-tasks-plugin"],
    );
    if (
      !tasksPluginLoaded &&
      typeof this.registerInterval === "function" &&
      typeof window !== "undefined" &&
      typeof window.setInterval === "function"
    ) {
      // Poll only when the Tasks plugin is not loaded; otherwise the
      // cache-update event above keeps the blocks fresh.
      this.registerInterval(
        window.setInterval(() => this.rerenderPlanBlocks(), 5000),
      );
    }

    this.app.workspace.onLayoutReady(() => {
      this.refreshDailyScrollCaptureTarget();
      this.captureActiveDailyLocation();
      if (this.registerVimMappings()) {
        return;
      }

      const ref = this.app.workspace.on("active-leaf-change", () => {
        if (this.registerVimMappings()) {
          this.app.workspace.offref(ref);
        }
      });
      this.registerEvent(ref);
    });
  }

  onunload() {
    if (
      this.planBlockRerenderTimer !== null &&
      this.planBlockRerenderTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.planBlockRerenderTimer);
    }
    this.planBlockRerenderTimer = null;
    if (this.planBlockViews) {
      this.planBlockViews.clear();
    }
    cancelDeferred(this.pendingCenterDeferred);
    this.pendingCenterDeferred = null;
    this.dailyNavigationActionId += 1;
    this.cancelPendingDailyLocationRestore();
    this.cancelPendingDailyLocationCapture();
    this.clearDailyScrollCaptureTarget();
    if (this.dailyLocations) {
      this.dailyLocations.clear();
    }
  }

  currentDailyPath() {
    return todayDailyPath(new Date(), getDailyNotesOptions(this.app));
  }

  // Supported `api.planBudget` input: `{ path?, content? }`. The `content`
  // option lets callers budget post-write text synchronously; otherwise the
  // target note is read and a Promise is returned. Never rejects: missing
  // notes degrade to `–` placeholders.
  planBudgetForCallers(options = {}) {
    const { caps } = loadPlanCaps();
    if (options && typeof options.content === "string") {
      const daily = typeof options.path === "string" ? options.path : null;
      return computePlanBudget(options.content, caps, daily);
    }
    return (async () => {
      try {
        const sourcePath =
          options && typeof options.path === "string" ? options.path : null;
        const targetPath = planBlockTargetPath(this.app, sourcePath);
        const content = await this.readPlanBlockContent(targetPath);
        return computePlanBudget(
          typeof content === "string" ? content : "",
          caps,
          targetPath,
        );
      } catch (error) {
        return emptyPlanBudget(caps);
      }
    })();
  }

  readPlanBlockContent(targetPath) {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getAbstractFileByPath !== "function") {
        return Promise.resolve(null);
      }
      const file = vault.getAbstractFileByPath(targetPath);
      if (!file) {
        return Promise.resolve(null);
      }
      if (typeof vault.cachedRead === "function") {
        return vault.cachedRead(file).catch(() => null);
      }
      if (typeof vault.read === "function") {
        return vault.read(file).catch(() => null);
      }
    } catch (error) {
      // Fall through to null below.
    }
    return Promise.resolve(null);
  }

  schedulePlanBlockRerenderForFile(file) {
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    if (!changedPath || !this.planBlockViews) {
      return;
    }
    for (const view of this.planBlockViews) {
      const target = planBlockTargetPath(this.app, view.sourcePath);
      if (target === changedPath) {
        this.schedulePlanBlockRerender();
        return;
      }
    }
  }

  schedulePlanBlockRerender() {
    if (
      this.planBlockRerenderTimer !== null &&
      this.planBlockRerenderTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.planBlockRerenderTimer = schedule(() => {
      this.planBlockRerenderTimer = null;
      this.rerenderPlanBlocks();
    }, 150);
  }

  rerenderPlanBlocks() {
    if (!this.planBlockViews) {
      return;
    }
    for (const view of Array.from(this.planBlockViews)) {
      try {
        this.paintPlanBlock(view.el, view.sourcePath);
      } catch (error) {
        // One stale block never breaks the others.
      }
    }
  }

  renderPlanBlock(el, ctx) {
    if (!el) {
      return;
    }
    const sourcePath = ctx && ctx.sourcePath;
    if (!this.planBlockViews) {
      this.planBlockViews = new Set();
    }
    const view = { el, sourcePath };
    this.planBlockViews.add(view);
    if (ctx && typeof ctx.addChild === "function") {
      // Unregister the view when the markdown preview drops the block.
      // Obsidian calls child.load() on the added child, so use a real
      // MarkdownRenderChild with a guarded fallback for test harnesses.
      let child = null;
      try {
        if (typeof MarkdownRenderChild === "function") {
          child = new MarkdownRenderChild(el);
          child.onunload = () => {
            if (this.planBlockViews) {
              this.planBlockViews.delete(view);
            }
          };
        }
      } catch (error) {
        child = null;
      }
      if (!child) {
        child = {
          unload: () => {
            if (this.planBlockViews) {
              this.planBlockViews.delete(view);
            }
          },
        };
      }
      try {
        ctx.addChild(child);
      } catch (error) {
        // Older hosts may reject the child; the Set is cleared on unload.
      }
    }
    this.paintPlanBlock(el, sourcePath);
  }

  paintPlanBlock(el, sourcePath) {
    const targetPath = planBlockTargetPath(this.app, sourcePath);
    const { caps, invalid } = loadPlanCaps();
    const tasks = planBlockTasks(this.app);
    Promise.resolve(this.readPlanBlockContent(targetPath))
      .then((content) => {
        if (!el || typeof el.empty !== "function") {
          return;
        }
        el.empty();
        const model = planBlockModel({
          content,
          tasks,
          today: new Date(),
          caps,
          sourcePath,
          app: this.app,
        });
        const container = el.createDiv({ cls: "bob-plan" });
        container.setAttribute("role", "status");
        container.setAttribute(
          "aria-label",
          `${model.planText}, ${model.nowText}${model.over ? ", over plan" : ""}`,
        );
        const planChip = container.createEl("span", {
          cls: `bob-plan-chip bob-plan-plan${
            model.budget.status === "over" ? " bob-plan-over" : ""
          }`,
          text: model.planText,
          title: model.planTitle,
        });
        planChip.setAttribute("aria-label", `Plan budget: ${model.planTitle}`);
        const nowChip = container.createEl("a", {
          cls: `bob-plan-chip bob-plan-now${
            model.hasTasks && model.now.over ? " bob-plan-over" : ""
          }`,
          text: model.nowText,
          title: "Open NOW tasks in dash",
          href: "dash#NOW Tasks",
        });
        nowChip.setAttribute("aria-label", "Open NOW tasks in dash");
        nowChip.addEventListener("click", (event) => {
          event.preventDefault();
          try {
            const workspace = this.app && this.app.workspace;
            if (workspace && typeof workspace.openLinkText === "function") {
              workspace.openLinkText("dash#NOW Tasks", "", false);
            }
          } catch (error) {
            // The chip still shows the count without the navigation.
          }
        });
        if (model.themesText) {
          container.createEl("span", {
            cls: "bob-plan-themes",
            text: model.themesText,
          });
        }
        for (const lint of model.lints) {
          container.createEl("div", {
            cls: "bob-plan-lint",
            text: lint,
          });
        }
        if (invalid) {
          container.createEl("div", {
            cls: "bob-plan-lint",
            text: "plan config invalid, using defaults",
          });
        }
      })
      .catch(() => {
        // The block shows `–` values, never an error; a failed paint keeps
        // the previous render.
      });
  }

  dailyLocationMap() {
    if (!(this.dailyLocations instanceof Map)) {
      this.dailyLocations = new Map();
    }
    return this.dailyLocations;
  }

  getRememberedDailyLocation(path) {
    const dailyPath = normalizeVaultPath(path);
    const remembered = normalizeDailyLocation(
      this.dailyLocationMap().get(dailyPath),
    );
    return remembered
      ? {
          ...remembered,
          ...(remembered.cursor ? { cursor: { ...remembered.cursor } } : {}),
        }
      : null;
  }

  isCurrentDailyView(view, expectedPath = this.currentDailyPath()) {
    return !!(
      view &&
      view.file &&
      view.editor &&
      sameVaultPath(view.file.path, expectedPath)
    );
  }

  handleActiveDailyViewChange() {
    const activeFile = getActiveFile(this.app);
    const activePath = activeFile && activeFile.path;
    if (
      this.pendingDailyLocationRestorePath &&
      !sameVaultPath(activePath, this.pendingDailyLocationRestorePath)
    ) {
      this.cancelPendingDailyLocationRestore();
    }

    this.cancelPendingDailyLocationCapture();
    this.refreshDailyScrollCaptureTarget();
    this.captureActiveDailyLocation();
  }

  refreshDailyScrollCaptureTarget(view = getActiveMarkdownView(this.app)) {
    const dailyPath = this.currentDailyPath();
    const editorView = this.isCurrentDailyView(view, dailyPath)
      ? getEditorViewFromEditor(view.editor)
      : null;
    const scrollDOM = editorView && editorView.scrollDOM;
    if (scrollDOM && scrollDOM === this.activeDailyScrollDOM) {
      return true;
    }

    this.clearDailyScrollCaptureTarget();
    if (!scrollDOM || typeof scrollDOM.addEventListener !== "function") {
      return false;
    }

    const handler = () => this.scheduleDailyLocationCapture();
    try {
      scrollDOM.addEventListener("scroll", handler, { passive: true });
    } catch (error) {
      scrollDOM.addEventListener("scroll", handler);
    }
    this.activeDailyScrollDOM = scrollDOM;
    this.activeDailyScrollHandler = handler;
    return true;
  }

  clearDailyScrollCaptureTarget() {
    if (
      this.activeDailyScrollDOM &&
      this.activeDailyScrollHandler &&
      typeof this.activeDailyScrollDOM.removeEventListener === "function"
    ) {
      try {
        this.activeDailyScrollDOM.removeEventListener(
          "scroll",
          this.activeDailyScrollHandler,
        );
      } catch (error) {
        // Best-effort cleanup only.
      }
    }

    this.activeDailyScrollDOM = null;
    this.activeDailyScrollHandler = null;
  }

  scheduleDailyLocationCapture() {
    if (this.isRestoringDailyLocation) {
      return false;
    }

    this.cancelPendingDailyLocationCapture();
    this.pendingDailyLocationCaptureDeferred = deferToNextFrame(() => {
      this.pendingDailyLocationCaptureDeferred = null;
      if (!this.isRestoringDailyLocation) {
        this.captureActiveDailyLocation();
      }
    });
    return true;
  }

  cancelPendingDailyLocationCapture() {
    cancelDeferred(this.pendingDailyLocationCaptureDeferred);
    this.pendingDailyLocationCaptureDeferred = null;
  }

  trackDailyLocationUpdate(update) {
    if (
      this.isRestoringDailyLocation ||
      !update ||
      (!update.selectionSet && !update.docChanged && !update.viewportChanged)
    ) {
      return false;
    }

    const view = getActiveMarkdownView(this.app);
    if (!this.isCurrentDailyView(view)) {
      return false;
    }

    const editorView = getEditorViewFromEditor(view.editor);
    if (update.view && (!editorView || update.view !== editorView)) {
      return false;
    }

    this.refreshDailyScrollCaptureTarget(view);
    const cursor =
      update.selectionSet || update.docChanged
        ? positionFromCodeMirrorUpdate(update)
        : null;
    return this.captureDailyLocationFromView(view, { cursor });
  }

  captureActiveDailyLocation() {
    return this.captureDailyLocationFromView(getActiveMarkdownView(this.app));
  }

  captureDailyLocationFromView(view, options = {}) {
    const dailyPath = this.currentDailyPath();
    if (
      !this.isCurrentDailyView(view, dailyPath) ||
      (this.isRestoringDailyLocation && !options.force)
    ) {
      return false;
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    const cursor =
      normalizeEditorPosition(options.cursor) ||
      (typeof view.editor.getCursor === "function"
        ? normalizeEditorPosition(view.editor.getCursor())
        : null);
    const location = {};
    if (cursor) {
      location.cursor = cursor;
    }
    if (scrollDOM) {
      const scrollTop = finiteNumberOrNull(scrollDOM.scrollTop);
      const scrollLeft = finiteNumberOrNull(scrollDOM.scrollLeft);
      if (scrollTop !== null) {
        location.scrollTop = Math.max(0, scrollTop);
      }
      if (scrollLeft !== null) {
        location.scrollLeft = Math.max(0, scrollLeft);
      }
    }

    const normalized = normalizeDailyLocation(location);
    if (!normalized) {
      return false;
    }
    this.dailyLocationMap().set(dailyPath, normalized);
    return true;
  }

  restoreOrDeferDailyLocation(
    path,
    location,
    retriesRemaining = DAILY_LOCATION_RESTORE_RETRIES,
  ) {
    const dailyPath = normalizeVaultPath(path);
    const normalized = normalizeDailyLocation(location);
    if (!dailyPath || !normalized) {
      return false;
    }

    this.cancelPendingDailyLocationCapture();
    this.cancelPendingDailyLocationRestore();
    this.isRestoringDailyLocation = true;
    this.pendingDailyLocationRestorePath = dailyPath;
    const token = this.dailyLocationRestoreToken;
    const state = {
      cursorApplied: !normalized.cursor,
      scrollApplied:
        normalized.scrollTop === undefined &&
        normalized.scrollLeft === undefined,
      assertFramesRemaining: DAILY_LOCATION_RESTORE_ASSERT_FRAMES,
    };

    return this.restoreOrDeferDailyLocationInternal(
      dailyPath,
      normalized,
      Math.max(0, Math.floor(numericOrDefault(retriesRemaining, 0))),
      state,
      token,
      false,
    );
  }

  restoreOrDeferDailyLocationInternal(
    path,
    location,
    retriesRemaining,
    state,
    token,
    assertScroll,
  ) {
    if (token !== this.dailyLocationRestoreToken) {
      return false;
    }

    const result = this.restoreActiveDailyLocation(
      path,
      location,
      state,
      { assertScroll },
    );
    if (!result.active) {
      const activeFile = getActiveFile(this.app);
      const activePath = activeFile && activeFile.path;
      if (!sameVaultPath(activePath, path) || retriesRemaining <= 0) {
        this.finishDailyLocationRestore(token);
        return false;
      }
    }

    const ready = state.cursorApplied && state.scrollApplied;
    const shouldAssert = ready && state.assertFramesRemaining > 0;
    const shouldRetry = !ready && retriesRemaining > 0;
    if (!shouldAssert && !shouldRetry) {
      this.finishDailyLocationRestore(token);
      return result.applied;
    }

    if (shouldAssert) {
      state.assertFramesRemaining -= 1;
    }
    this.pendingDailyLocationRestoreDeferred = deferToNextFrame(() => {
      this.pendingDailyLocationRestoreDeferred = null;
      this.restoreOrDeferDailyLocationInternal(
        path,
        location,
        shouldRetry ? retriesRemaining - 1 : retriesRemaining,
        state,
        token,
        shouldAssert,
      );
    });
    return result.applied;
  }

  restoreActiveDailyLocation(path, location, state, options = {}) {
    const result = { active: false, applied: false };
    const view = getActiveMarkdownView(this.app);
    if (!this.isCurrentDailyView(view, path)) {
      return result;
    }
    result.active = true;
    this.refreshDailyScrollCaptureTarget(view);

    if (!state.cursorApplied && location.cursor) {
      const cursor = clampEditorPosition(view.editor, location.cursor);
      if (
        cursor &&
        setEditorCursor(view.editor, cursor.line, cursor.ch, { scroll: false })
      ) {
        state.cursorApplied = true;
        result.applied = true;
      }
    }

    const editorView = getEditorViewFromEditor(view.editor);
    const scrollDOM = editorView && editorView.scrollDOM;
    const needsScroll =
      location.scrollTop !== undefined || location.scrollLeft !== undefined;
    if (
      scrollDOM &&
      needsScroll &&
      (!state.scrollApplied || options.assertScroll)
    ) {
      const scrollTop =
        location.scrollTop !== undefined
          ? location.scrollTop
          : finiteNumberOrNull(scrollDOM.scrollTop) || 0;
      const scrollLeft =
        location.scrollLeft !== undefined
          ? location.scrollLeft
          : finiteNumberOrNull(scrollDOM.scrollLeft) || 0;
      if (setScrollDOMPosition(scrollDOM, scrollTop, scrollLeft)) {
        state.scrollApplied = true;
        result.applied = true;
      }
    }
    return result;
  }

  finishDailyLocationRestore(token) {
    if (token !== this.dailyLocationRestoreToken) {
      return;
    }

    const path = this.pendingDailyLocationRestorePath;
    this.pendingDailyLocationRestoreDeferred = null;
    this.pendingDailyLocationRestorePath = null;
    this.isRestoringDailyLocation = false;
    const view = getActiveMarkdownView(this.app);
    if (this.isCurrentDailyView(view, path)) {
      this.captureDailyLocationFromView(view, { force: true });
    }
  }

  cancelPendingDailyLocationRestore() {
    cancelDeferred(this.pendingDailyLocationRestoreDeferred);
    this.pendingDailyLocationRestoreDeferred = null;
    this.pendingDailyLocationRestorePath = null;
    this.isRestoringDailyLocation = false;
    this.dailyLocationRestoreToken =
      Math.floor(numericOrDefault(this.dailyLocationRestoreToken, 0)) + 1;
  }

  registerVimMappings() {
    if (this.vimMappingsRegistered) {
      return true;
    }

    const codeMirrorAdapter =
      typeof window === "undefined" ? null : window.CodeMirrorAdapter;
    const vim = codeMirrorAdapter && codeMirrorAdapter.Vim;
    if (!vim) {
      return false;
    }

    vim.defineAction("bobLedgerJumpToCurrentPomodoro", (cm) =>
      this.jumpToCurrentPomodoro(cm),
    );
    vim.defineAction("bobLedgerAddPomodoroUnit", (cm, actionArgs) =>
      this.changePomodoroUnits(cm, this.getVimRepeat(actionArgs)),
    );
    vim.defineAction("bobLedgerSubtractPomodoroUnit", (cm, actionArgs) =>
      this.changePomodoroUnits(cm, -this.getVimRepeat(actionArgs)),
    );
    vim.defineAction("bobLedgerMovePomodoroLater", (cm, actionArgs) =>
      this.offsetPomodoroRange(cm, this.getVimRepeat(actionArgs) * STEP_MINUTES),
    );
    vim.defineAction("bobLedgerMovePomodoroEarlier", (cm, actionArgs) =>
      this.offsetPomodoroRange(cm, -this.getVimRepeat(actionArgs) * STEP_MINUTES),
    );

    vim.mapCommand("\\p", "action", "bobLedgerAddPomodoroUnit", {}, {
      context: "normal",
    });
    vim.mapCommand("\\P", "action", "bobLedgerSubtractPomodoroUnit", {}, {
      context: "normal",
    });
    vim.mapCommand("\\o", "action", "bobLedgerMovePomodoroLater", {}, {
      context: "normal",
    });
    vim.mapCommand("\\O", "action", "bobLedgerMovePomodoroEarlier", {}, {
      context: "normal",
    });

    this.vimMappingsRegistered = true;
    return true;
  }

  getVimRepeat(actionArgs) {
    const repeat = actionArgs && actionArgs.repeat;
    const parsedRepeat = Number(repeat);

    if (!Number.isFinite(parsedRepeat) || parsedRepeat < 1) {
      return 1;
    }

    return Math.floor(parsedRepeat);
  }

  jumpToCurrentPomodoro(cm) {
    this.dailyNavigationActionId =
      Math.floor(numericOrDefault(this.dailyNavigationActionId, 0)) + 1;
    const actionId = this.dailyNavigationActionId;
    const lines = getEditorLines(cm);
    if (!lines) {
      new Notice("No active markdown editor");
      return false;
    }

    const { target, error } = getJumpPomodoroTarget(lines);
    if (!target) {
      return this.openDailyFallbackOnly(error, actionId);
    }

    return this.jumpToPomodoroTarget(cm, target);
  }

  jumpToPomodoroTarget(cm, target) {
    this.cancelPendingDailyLocationRestore();
    if (!setEditorCursor(cm, target.line, 0, { scroll: false })) {
      return false;
    }
    focusEditor(cm);

    // Center *after* the Vim command cycle finishes. codemirror-vim dispatches
    // its own "nearest" cursor-visibility scroll as it finalizes the keystroke;
    // centering synchronously here would be clobbered by that trailing scroll.
    // Deferring one frame lets our centered scroll be the last word.
    this.scheduleCenterOnLine(cm, target.line);

    return true;
  }

  async openDailyFallbackOnly(error, actionId) {
    if (isTodayDailyFile(this.app, getActiveFile(this.app))) {
      new Notice(error || "No active Pomodoro line found");
      return false;
    }

    const dailyPath = this.currentDailyPath();
    // Snapshot before opening: activating a fresh daily editor can emit capture
    // events for its initial top-of-file state before the open promise resolves.
    const rememberedLocation = this.getRememberedDailyLocation(dailyPath);
    const result = await openTodayDailyNoteWithState(this.app);
    if (actionId !== this.dailyNavigationActionId) {
      return !!result;
    }
    if (!result || !result.view || !result.view.editor) {
      new Notice("Could not open daily note");
      return false;
    }

    if (!sameVaultPath(result.path, dailyPath)) {
      new Notice("Could not open daily note");
      return false;
    }

    focusEditor(result.view.editor);
    this.refreshDailyScrollCaptureTarget(result.view);
    if (!result.reusedOpenLeaf && rememberedLocation) {
      this.restoreOrDeferDailyLocation(dailyPath, rememberedLocation);
    } else {
      this.captureDailyLocationFromView(result.view);
    }
    return true;
  }

  scheduleCenterOnLine(cm, line, options = {}) {
    cancelDeferred(this.pendingCenterDeferred);
    const attempts = Math.max(
      1,
      Math.floor(numericOrDefault(options.attempts, CENTER_ON_LINE_ATTEMPTS)),
    );

    const runAttempt = (attempt) => {
      this.pendingCenterDeferred = null;

      // Prefer the editor that actually received the cursor move (vim adapter for
      // local jumps, the daily Editor for the fallback). Its CM6 view may lag by
      // a frame right after a daily tab is activated.
      const targetEditorView = getEditorViewFromEditor(cm);
      if (centerEditorViewOnPosition(targetEditorView, line, 0)) {
        return;
      }

      // Give the jumped editor a bounded number of frames to attach its view
      // before consulting the (possibly stale) active Markdown view.
      if (!targetEditorView && attempt + 1 < attempts) {
        this.pendingCenterDeferred = deferToNextFrame(() =>
          runAttempt(attempt + 1),
        );
        return;
      }

      // Fallback: center the active Markdown view if reachable; only if no view
      // can be centered do we issue the CM5 "nearest" scroll on the handed
      // editor. A successful center is always the last word — never clobbered.
      if (centerEditorViewOnPosition(getActiveEditorView(this.app), line, 0)) {
        return;
      }
      scrollEditorIntoView(cm, line, 0);
    };

    this.pendingCenterDeferred = deferToNextFrame(() => runAttempt(0));
  }

  changePomodoroUnits(cm, units) {
    const lines = getEditorLines(cm);
    const cursorLine = getEditorCursorLine(cm);
    if (!lines || cursorLine === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const { target, error } = getEditPomodoroTarget(lines, cursorLine, true);
    if (!target || !target.entry.range) {
      new Notice(error || "No Pomodoro line with a time range found");
      return false;
    }

    const newLineText = changePomodoroLineUnits(target.lineText, units);
    if (newLineText === null) {
      new Notice("No Pomodoro line with a time range found");
      return false;
    }

    return replaceEditorLine(cm, target.line, target.lineText, newLineText);
  }

  offsetPomodoroRange(cm, minutes) {
    return this.rewritePomodoroRange(cm, (range) => ({
      startMinutes: addMinutes(range.startMinutes, minutes),
      endMinutes: addMinutes(range.endMinutes, minutes),
    }));
  }

  rewritePomodoroRange(cm, buildRange) {
    const lines = getEditorLines(cm);
    const cursorLine = getEditorCursorLine(cm);
    if (!lines || cursorLine === null) {
      new Notice("No active markdown editor");
      return false;
    }

    const { target, error } = getEditPomodoroTarget(lines, cursorLine, true);
    if (!target || !target.entry.range) {
      new Notice(error || "No Pomodoro line with a time range found");
      return false;
    }

    const nextRange = buildRange(target.entry.range);
    const newLineText = replaceTimeRange(
      target.lineText,
      target.entry.range,
      nextRange.startMinutes,
      nextRange.endMinutes,
    );

    if (newLineText === null) {
      new Notice("No Pomodoro line with a time range found");
      return false;
    }

    return replaceEditorLine(cm, target.line, target.lineText, newLineText);
  }

  expandFromActiveEditor(cmView) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!(view instanceof MarkdownView) || !view.editor) {
      return false;
    }

    return this.expandFromEditor(view.editor, cmView);
  }

  expandFromEditor(editor, cmView = null) {
    if (!this.hasSingleCursor(editor, cmView)) {
      return false;
    }

    const expansion = this.findEditorExpansion(editor);
    if (!expansion) {
      return false;
    }

    editor.replaceRange(
      expansion.replacement,
      { line: expansion.line, ch: expansion.fromCh },
      { line: expansion.line, ch: expansion.toCh },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({
        line: expansion.line,
        ch: expansionCursorCh(expansion),
      });
    }

    return true;
  }

  hasSingleCursor(editor, cmView) {
    if (editor && typeof editor.listSelections === "function") {
      const selections = editor.listSelections();

      if (!Array.isArray(selections) || selections.length !== 1) {
        return false;
      }

      const selection = selections[0];
      return sameEditorPosition(selection.anchor, selection.head);
    }

    return isCollapsedCodeMirrorSelection(cmView);
  }

  findEditorExpansion(editor) {
    if (
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (
      !cursor ||
      !Number.isInteger(cursor.line) ||
      !Number.isInteger(cursor.ch)
    ) {
      return null;
    }

    const line = editor.getLine(cursor.line);
    const expansion = findExpansion(line, cursor.ch);

    return expansion ? { ...expansion, line: cursor.line } : null;
  }
};

// --- Plan NOW counter -----------------------------------------------------
// A NOW task is a `#task` line the native Tasks engine matches with the NOW
// query in docs/plan.md. This mirrors that predicate over Tasks-plugin task
// objects (tolerant of the shapes Tasks and dataview expose).

function planTaskDescription(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  for (const key of ["description", "text"]) {
    if (typeof task[key] === "string") {
      return task[key];
    }
  }
  return null;
}

function planTaskIsDone(task) {
  if (!task || typeof task !== "object") {
    return true;
  }
  if (task.done === true) {
    return true;
  }
  const type = task.status && task.status.type;
  if (type === "DONE" || type === "CANCELLED" || type === "NON_TASK") {
    return true;
  }
  const name = task.status && task.status.name;
  if (typeof name === "string" && /^(done|cancelled?)\s*$/i.test(name.trim())) {
    return true;
  }
  return false;
}

function planTaskIsBlocked(task, all) {
  if (!task || typeof task !== "object") {
    return false;
  }
  if (typeof task.isBlocked === "function") {
    try {
      return Boolean(task.isBlocked(all));
    } catch (error) {
      return false;
    }
  }
  return task.isBlocked === true || task.blocked === true;
}

function planTaskPath(task) {
  if (!task || typeof task !== "object") {
    return "";
  }
  if (typeof task.path === "string") {
    return task.path;
  }
  if (task.file && typeof task.file.path === "string") {
    return task.file.path;
  }
  return "";
}

function planDayNumber(value) {
  const date = planCoerceDate(value);
  if (!date) {
    return null;
  }
  return (
    date.getFullYear() * 10000 +
    (date.getMonth() + 1) * 100 +
    date.getDate()
  );
}

function planCoerceDate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object") {
    if (typeof value.isSameOrBefore === "function") {
      // A moment-like object.
      if (typeof value.year === "function") {
        const date = new Date(
          value.year(),
          (typeof value.month === "function" ? value.month() : 0) || 0,
          (typeof value.date === "function" ? value.date() : 1) || 1,
        );
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (typeof value.toDate === "function") {
        try {
          return planCoerceDate(value.toDate());
        } catch (error) {
          return null;
        }
      }
      if (typeof value.format === "function") {
        try {
          return planCoerceDate(value.format("YYYY-MM-DD"));
        } catch (error) {
          return null;
        }
      }
      return null;
    }
    if ("moment" in value) {
      return planCoerceDate(value.moment);
    }
    if (value instanceof Date) {
      return planCoerceDate(value);
    }
  }
  return null;
}

function planTaskScheduledDay(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  for (const key of ["scheduledDate", "scheduled", "scheduledDay"]) {
    if (task[key] !== undefined && task[key] !== null) {
      const day = planDayNumber(task[key]);
      if (day !== null) {
        return day;
      }
    }
  }
  return null;
}

function planTaskTags(task) {
  if (!task || typeof task !== "object" || !Array.isArray(task.tags)) {
    return [];
  }
  return task.tags.filter((tag) => typeof tag === "string");
}

// The dash's NOW predicate over Tasks-plugin task objects: visible (no
// `_templates`/`_conflicts`, no `#hide`), scheduled today or earlier (or
// unscheduled), not dependency-blocked, and carrying a whole `#now` token.
function nowBudgetFromTasks(tasks, today, caps) {
  const effective = effectivePlanCaps(caps);
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(today === undefined ? new Date() : today);
  let count = 0;
  for (const task of list) {
    if (planTaskIsDone(task)) {
      continue;
    }
    if (planTaskIsBlocked(task, list)) {
      continue;
    }
    const tags = planTaskTags(task);
    const description = planTaskDescription(task);
    if (description !== null) {
      if (!hasNowTag(description)) {
        continue;
      }
    } else if (!tags.includes("#now")) {
      continue;
    }
    if (
      tags.some(
        (tag) =>
          typeof tag === "string" && tag.toLowerCase().includes("#hide"),
      )
    ) {
      continue;
    }
    const path = planTaskPath(task);
    const loweredPath = String(path || "").toLowerCase();
    if (
      loweredPath.includes("_templates") ||
      loweredPath.includes("_conflicts")
    ) {
      continue;
    }
    if (todayDay !== null) {
      const scheduled = planTaskScheduledDay(task);
      if (scheduled !== null && scheduled > todayDay) {
        continue;
      }
    }
    count += 1;
  }
  const cap = effective.maxNow;
  return { count, cap, over: count > cap };
}

// --- Plan config ----------------------------------------------------------

function planRequireOptionalNodeModule(name) {
  try {
    if (typeof require !== "function") {
      return null;
    }
    return require(name);
  } catch (error) {
    return null;
  }
}

function planJoinPathSegments(firstSegment, ...restSegments) {
  const trim = (text, side) => {
    const value = String(text || "");
    if (side === "left") {
      return value.replace(/^\/+/, "");
    }
    if (side === "right") {
      return value.replace(/\/+$/, "");
    }
    return value.replace(/^\/+|\/+$/g, "");
  };
  const first = trim(firstSegment, "right");
  const rest = restSegments
    .map((segment) => trim(segment, "both"))
    .filter((segment) => segment.length > 0);
  return [first, ...rest].filter((segment) => segment.length > 0).join("/");
}

function planConfigHomeDir(osModule, env) {
  if (osModule && typeof osModule.homedir === "function") {
    try {
      const home = osModule.homedir();
      if (typeof home === "string" && home.trim()) {
        return home;
      }
    } catch (error) {
      // Fall through to $HOME below.
    }
  }
  if (env && typeof env.HOME === "string" && env.HOME.trim()) {
    return env.HOME;
  }
  return "~";
}

function planConfigPath(options = {}) {
  const env =
    options.env ||
    (typeof process !== "undefined" && process.env ? process.env : {});
  const osModule =
    options.osModule === undefined
      ? planRequireOptionalNodeModule("os")
      : options.osModule;
  const xdgConfigHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
      ? env.XDG_CONFIG_HOME
      : null;
  const configHome =
    xdgConfigHome ||
    planJoinPathSegments(planConfigHomeDir(osModule, env), ".config");
  return planJoinPathSegments(configHome, PLAN_CONFIG_RELATIVE_PATH);
}

// Read `plan:` from `~/.config/bob/config.yml` (honoring XDG_CONFIG_HOME).
// Mobile (no desktop `fs`) and read errors fall back to the defaults.
// Returns `{ caps, invalid, configPath }`; `invalid` is true only when the
// file was read but held a present-but-bad value.
function loadPlanCaps(options = {}) {
  const defaults = defaultPlanCaps();
  const configPath = options.configPath || planConfigPath(options);
  const platform = options.Platform === undefined ? Platform : options.Platform;
  if (platform && platform.isDesktopApp === false) {
    return { caps: defaults, invalid: false, configPath };
  }
  const fsModule =
    options.fsModule === undefined
      ? planRequireOptionalNodeModule("fs")
      : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return { caps: defaults, invalid: false, configPath };
  }
  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (error) {
    return {
      caps: defaults,
      invalid: Boolean(error && error.code && error.code !== "ENOENT"),
      configPath,
    };
  }
  const yamlParser =
    options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof yamlParser !== "function") {
    return { caps: defaults, invalid: false, configPath };
  }
  let parsed;
  try {
    parsed = yamlParser(rawConfig);
  } catch (error) {
    return { caps: defaults, invalid: true, configPath };
  }
  const coerced = coercePlanCaps(planCapsBlock(parsed));
  return { caps: coerced.caps, invalid: coerced.invalid, configPath };
}

// --- Plan block model -----------------------------------------------------

function planBlockTargetPath(app, sourcePath) {
  if (sourcePath && PLAN_DAILY_PATH_RE.test(String(sourcePath))) {
    return String(sourcePath);
  }
  return todayDailyPath(new Date(), getDailyNotesOptions(app));
}

function planBlockTasks(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const tasks = plugins && plugins[PLAN_TASKS_PLUGIN_ID];
    if (tasks && typeof tasks.getTasks === "function") {
      const all = tasks.getTasks();
      return Array.isArray(all) ? all : null;
    }
  } catch (error) {
    // The Tasks plugin is optional; the block shows `–` without it.
  }
  return null;
}

// Synchronous view-model for the ```bob-plan block. Never throws: missing
// content, caps, or Tasks all degrade to `–` placeholders, never an error.
function planBlockModel({ content, tasks, today, caps, sourcePath, app }) {
  const effective = effectivePlanCaps(caps);
  const targetPath = planBlockTargetPath(app, sourcePath);
  let budget;
  try {
    budget =
      typeof content === "string"
        ? computePlanBudget(content, effective, targetPath)
        : emptyPlanBudget(effective);
  } catch (error) {
    budget = emptyPlanBudget(effective);
  }
  const hasTasks = Array.isArray(tasks);
  let now;
  try {
    now = hasTasks
      ? nowBudgetFromTasks(tasks, today === undefined ? new Date() : today, effective)
      : { count: 0, cap: effective.maxNow, over: false };
  } catch (error) {
    now = { count: 0, cap: effective.maxNow, over: false };
  }
  const over = budget.status === "over" || (hasTasks && now.over);
  const lintWarnings = budget.warnings.slice();
  if (hasTasks && now.over) {
    lintWarnings.push({
      code: "now_cap_exceeded",
      message: `this week's NOW has ${now.count}/${now.cap} tasks`,
    });
  }
  const themeCounts = budget.entries
    .filter((entry) => !entry.exempt)
    .map((entry) => `${entry.name} ${entry.links}`);
  return {
    targetPath,
    hasContent: typeof content === "string",
    hasTasks,
    planText: budget.hasSection
      ? `PLAN ${budget.themes.count}/${budget.themes.cap} · ${budget.links.count}/${budget.links.cap}`
      : "PLAN –",
    planTitle: budget.hasSection
      ? themeCounts.join(" · ") || "no themes"
      : "no Pomodoros section",
    nowText: hasTasks ? `NOW ${now.count}/${now.cap}` : "NOW –",
    themesText:
      budget.themeNames.length > 0
        ? `★ ${budget.themeNames.join(" · ")}`
        : "",
    lints: lintWarnings.map((warning) =>
      warning.line === undefined || warning.line === null
        ? `${warning.message}  ${warning.code}`
        : `${warning.message} (line ${warning.line})  ${warning.code}`,
    ),
    over,
    budget,
    now,
  };
}

module.exports.helpers = {
  parseTrigger,
  parseEmDashTrigger,
  computeRange,
  computeSnippetExpansion,
  normalizeMinutes,
  formatTime,
  formatLocalDate,
  formatLocalDateTime,
  formatDailyDate,
  todayDailyPath,
  getDailyNotesOptions,
  isTodayDailyFile,
  addLocalMinutes,
  addLocalDays,
  formatOffsetTime,
  formatOffsetDate,
  formatOffsetDateTime,
  addMinutes,
  findPomodorosSection,
  parseTimeRange,
  formatTimeRange,
  replaceTimeRange,
  durationField,
  legacyStopwatchDuration,
  parseDurationMinutes,
  formatDurationField,
  rangeDurationMinutes,
  pomodoroDurationMinutes,
  changePomodoroLineUnits,
  offsetPomodoroLineRange,
  parseLedgerLine,
  findActivePomodoroItem,
  getJumpPomodoroTarget,
  resolveEditPomodoroTarget,
  getEditorViewFromEditor,
  getActiveEditorView,
  editorViewPositionFromLineCh,
  centerEditorViewOnPosition,
  scrollEditorIntoView,
  focusEditor,
  getActiveMarkdownView,
  waitForActiveMarkdownView,
  getMarkdownLeafFile,
  getMarkdownLeafViewByPath,
  findOpenMarkdownLeafByPath,
  waitForMarkdownLeafViewByPath,
  activateMarkdownLeaf,
  openTodayDailyNoteWithState,
  openTodayDailyNote,
  normalizeEditorPosition,
  normalizeDailyLocation,
  clampEditorPosition,
  positionFromCodeMirrorUpdate,
  setScrollDOMPosition,
  deferToNextFrame,
  cancelDeferred,
  findExpansion,
  expandLineAtCursor,
  expansionCursorCh,
  defaultPlanCaps,
  effectivePlanCaps,
  parsePlanCaps,
  coercePlanCaps,
  hasNowTag,
  normalizePlanComponent,
  splitPlanComponents,
  computePlanBudget,
  emptyPlanBudget,
  nowBudgetFromTasks,
  loadPlanCaps,
  planConfigPath,
  planBlockTargetPath,
  planBlockModel,
  planSectionRange,
};
