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

// Freshness-mark surfaces (mark-surfaces): defensive CodeMirror/Obsidian
// imports. Every piece must exist before the Live Preview extension is
// registered, so the existing ledger-tools tests and their stubs keep
// passing unchanged. Never throws.
let ViewPlugin = null;
let Decoration = null;
let WidgetType = null;
try {
  const viewMod = require("@codemirror/view");
  ViewPlugin = viewMod.ViewPlugin || null;
  Decoration = viewMod.Decoration || null;
  WidgetType = viewMod.WidgetType || null;
} catch (error) {
  ViewPlugin = null;
  Decoration = null;
  WidgetType = null;
}
let StateEffect = null;
let RangeSetBuilder = null;
try {
  const stateMod = require("@codemirror/state");
  StateEffect = stateMod.StateEffect || null;
  RangeSetBuilder = stateMod.RangeSetBuilder || null;
} catch (error) {
  StateEffect = null;
  RangeSetBuilder = null;
}
let editorInfoField = null;
let editorLivePreviewField = null;
try {
  const obsidianMod = require("obsidian");
  editorInfoField = obsidianMod.editorInfoField || null;
  editorLivePreviewField = obsidianMod.editorLivePreviewField || null;
} catch (error) {
  editorInfoField = null;
  editorLivePreviewField = null;
}
let syntaxTree = null;
try {
  const languageMod = require("@codemirror/language");
  syntaxTree = (languageMod && languageMod.syntaxTree) || null;
} catch (error) {
  syntaxTree = null;
}
let freshnessMarksRefresh = null;
try {
  if (StateEffect && typeof StateEffect.define === "function") {
    freshnessMarksRefresh = StateEffect.define();
  }
} catch (error) {
  freshnessMarksRefresh = null;
}

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
const PLAN_LINT_NEXT_CAP = "next_cap_exceeded";
const PLAN_LINT_PENDING_CAP = "pending_cap_exceeded";
// Emitted only by the bob-ledger-tools `bob-plan` block: `bob plan` has
// no native READY count.
const PLAN_LINT_READY_CAP = "ready_cap_exceeded";
const PLAN_DAILY_PATH_RE = /(^|\/)\d{4}\/\d{8}\.md$/;
const PLAN_ENTRY_RE = /^- \[([^\]])\]/;
const PLAN_PLACEHOLDER_RE = /^\([ \t]*\)/;
const PLAN_BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const PLAN_ATX_RE = /^(?: {0,3})(#{1,6})(?:\s|$)/;
// This string must stay identical to the Tasks plugin's own event: the
// installed bundle (`~/bob/.obsidian/plugins/obsidian-tasks-plugin/main.js`,
// `TasksEvents.onReloadOpenSearchResults`) subscribes under exactly this
// name, and every open Tasks query re-reads only when it fires.
const TODAY_RELOAD_EVENT = "obsidian-tasks-plugin:reload-open-search-results";

function defaultPlanCaps() {
  return {
    maxThemes: 3,
    maxLinks: 10,
    maxNext: 15,
    maxPending: 10,
    maxReady: 100,
    strict: false,
    exempt: ["GTD"],
    inventoryLabels: ["LATER", "MISC", "NEW FEATURES", "SASE"],
  };
}

const PLAN_U32_MAX = 4294967295;

function planCapOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

function planReadyCapOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 1 && value <= PLAN_U32_MAX
    ? value
    : fallback;
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
    maxNext: planCapOrDefault(raw.maxNext, defaults.maxNext),
    maxPending: planCapOrDefault(raw.maxPending, defaults.maxPending),
    maxReady: planReadyCapOrDefault(raw.maxReady, defaults.maxReady),
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
    if (value === undefined || value === null) {
      return fallback;
    }
    if (!Number.isInteger(value) || value < 1) {
      invalid = true;
      return fallback;
    }
    return value;
  };
  const readyCap = (snake, camel, fallback) => {
    const value = pick(snake, camel);
    if (value === undefined || value === null) {
      return fallback;
    }
    if (!Number.isInteger(value) || value < 1 || value > PLAN_U32_MAX) {
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
  // Unknown keys (including a legacy `max_now`) stay ignored, so an old
  // config loads without error.
  const caps = {
    maxThemes: cap("max_themes", "maxThemes", defaults.maxThemes),
    maxLinks: cap("max_links", "maxLinks", defaults.maxLinks),
    maxNext: cap("max_next", "maxNext", defaults.maxNext),
    maxPending: cap("max_pending", "maxPending", defaults.maxPending),
    maxReady: readyCap("max_ready", "maxReady", defaults.maxReady),
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

// --- Today (ledger-derived) -------------------------------------------------
// JavaScript mirror of `today_links` in `src/native/plan_budget/today.rs`,
// which is exactly the `=x` / start lineup rule
// (`list_queued_links` in `src/native/capture_pomodoro_start.rs`):
// a direct child bullet at an open entry's first child indentation whose
// body, after stripping Pomodoro markers, is exactly one plain
// `[[target#^id]]` or embedded `![[target#^id]]` block link — not struck
// through and not fenced. `docs/plan.md` ("Today conformance examples")
// is the shared test vector source for both implementations.

function todayIndentLen(line) {
  const text = String(line || "");
  let indent = 0;
  while (text[indent] === " " || text[indent] === "\t") {
    indent += 1;
  }
  return indent;
}

function todayMarkerLen(afterIndent) {
  const text = String(afterIndent || "");
  const first = text[0];
  if (first === "-" || first === "*" || first === "+") {
    return 1;
  }
  if (first >= "0" && first <= "9") {
    let digits = 0;
    while (
      digits < text.length &&
      text[digits] >= "0" &&
      text[digits] <= "9"
    ) {
      digits += 1;
    }
    const closer = text[digits];
    if (closer === "." || closer === ")") {
      return digits + 1;
    }
  }
  return null;
}

// An indented list line (a possible sub-bullet): indented, with a valid
// marker followed by nothing or whitespace.
function todayIsSubBulletLine(line) {
  const text = String(line || "");
  if (text.trim() === "") {
    return false;
  }
  const indent = todayIndentLen(text);
  if (indent === 0) {
    return false;
  }
  const markerLen = todayMarkerLen(text.slice(indent));
  if (markerLen === null) {
    return false;
  }
  const rest = text.slice(indent + markerLen);
  return rest === "" || rest[0] === " " || rest[0] === "\t";
}

// The bullet body with trailing whitespace trimmed, or null when the line
// is not a well-formed bullet.
function todayBulletBody(line) {
  const text = String(line || "");
  const indent = todayIndentLen(text);
  const markerLen = todayMarkerLen(text.slice(indent));
  if (markerLen === null) {
    return null;
  }
  const afterMarker = text.slice(indent + markerLen);
  if (afterMarker !== "" && afterMarker[0] !== " " && afterMarker[0] !== "\t") {
    return null;
  }
  const bodyStart = indent + markerLen + (afterMarker === "" ? 0 : 1);
  const trimmed = text.slice(bodyStart).replace(/[ \t]+$/, "");
  if (trimmed === "") {
    return null;
  }
  return { bodyStart, bodyEnd: bodyStart + trimmed.length, body: trimmed };
}

function todayStripWrappingQuotes(value) {
  const text = String(value || "");
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'")
    ) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

function todayIsUriScheme(path) {
  const colon = String(path || "").indexOf(":");
  if (colon === -1) {
    return false;
  }
  const scheme = String(path).slice(0, colon);
  if (!scheme || !/[A-Za-z]/.test(scheme[0])) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme);
}

// One `[[target#^id]]` token on a line, mirroring
// `wikilink_tokens`/`parse_block_target`: the alias (`|…`) is ignored,
// the block ID must match `PLAN_BLOCK_ID_RE`, and paths holding `#`, `^`,
// or a URI scheme never parse.
function todayWikilinkTokens(line) {
  const text = String(line || "");
  const tokens = [];
  let cursor = 0;
  for (;;) {
    const open = text.indexOf("[[", cursor);
    if (open === -1) {
      break;
    }
    const innerStart = open + 2;
    const relativeClose = text.slice(innerStart).indexOf("]]");
    if (relativeClose === -1) {
      break;
    }
    const close = innerStart + relativeClose + 2;
    const inner = text.slice(innerStart, innerStart + relativeClose);
    const rawTarget = todayStripWrappingQuotes(
      inner.split("|")[0] || "",
    ).trim();
    const caret = rawTarget.indexOf("#^");
    if (caret !== -1) {
      const rawPath = rawTarget.slice(0, caret).trim();
      const blockId = rawTarget.slice(caret + 2).trim();
      if (
        blockId &&
        PLAN_BLOCK_ID_RE.test(blockId) &&
        !rawPath.includes("#") &&
        !rawPath.includes("^") &&
        !todayIsUriScheme(rawPath)
      ) {
        let pathPart = rawPath;
        if (/\.md$/i.test(pathPart)) {
          pathPart = pathPart.slice(0, -3);
        }
        const embedded = open > 0 && text[open - 1] === "!";
        tokens.push({
          start: embedded ? open - 1 : open,
          end: close,
          embedded,
          pathPart,
          blockId,
        });
      }
    }
    cursor = close;
  }
  return tokens;
}

// The trimmed body is exactly one plain or embedded block link, mirroring
// `bare_plain_link`/`bare_embedded_link` (a trailing `#` move-only marker
// disqualifies, exactly as in Rust).
function todayBareLink(body) {
  const text = String(body || "");
  const tokens = todayWikilinkTokens(text);
  if (tokens.length !== 1) {
    return null;
  }
  const token = tokens[0];
  return token.start === 0 && token.end === text.length ? token : null;
}

// A dedicated Task Link: strip leading Pomodoro markers (the Strip policy
// only removes markers directly before the link), then require a bare link
// outside `~~…~~` struck spans.
function todayLinkFromBody(body) {
  const stripped = String(body || "").replace(/^(?:🍅\s*)+/, "");
  if (stripped === "") {
    return null;
  }
  const token = todayBareLink(stripped);
  if (!token) {
    return null;
  }
  const struck = planStruckInnerSpans(stripped);
  if (
    struck.some(([start, end]) => token.start >= start && token.end <= end)
  ) {
    return null;
  }
  return token;
}

// Every dedicated Task Link under today's open entries, in ledger order.
// `dailyPath` canonicalizes empty targets only for key building in
// `resolveTodayKeys`; the recorded `target` is the written path part.
function computeTodayLinks(content, dailyPath) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const section = planSectionRange(lines);
  if (!section) {
    return [];
  }
  const fenced = planFencedLines(lines, section.start, section.end);
  const links = [];
  for (let index = section.start; index <= section.end; index += 1) {
    if (fenced.has(index)) {
      continue;
    }
    const line = String(lines[index] || "");
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }
    const parsed = planParseEntry(line);
    if (!parsed || parsed.state !== "open") {
      continue;
    }
    // The entry's sub-bullet range: following non-empty indented list
    // lines (a blank line, a column-0 line, or the section end stops it).
    const range = [];
    for (let sub = index + 1; sub <= section.end; sub += 1) {
      if (fenced.has(sub)) {
        continue;
      }
      if (!todayIsSubBulletLine(lines[sub])) {
        break;
      }
      range.push(sub);
    }
    if (range.length === 0) {
      continue;
    }
    const childIndent = todayIndentLen(lines[range[0]]);
    const entryName = (() => {
      const leading = planLeadingRange(parsed.body);
      if (leading.length === null) {
        return null;
      }
      return planParseNameTail(parsed.body.slice(leading.length));
    })();
    for (const sub of range) {
      if (todayIndentLen(lines[sub]) !== childIndent) {
        continue;
      }
      const bullet = todayBulletBody(lines[sub]);
      if (!bullet) {
        continue;
      }
      const token = todayLinkFromBody(bullet.body);
      if (!token) {
        continue;
      }
      links.push({
        entryLine: index + 1,
        entryName,
        ledgerLine: sub + 1,
        target: token.pathPart,
        blockId: token.blockId,
        embedded: token.embedded,
      });
    }
  }
  return links;
}

// Ordered, unique Today keys (`"<vault path with .md>#<block id>"`).
// `resolve(target, dailyPath)` wraps
// `app.metadataCache.getFirstLinkpathDest`; an empty target is the daily
// note itself. Unresolved targets are skipped.
function resolveTodayKeys(links, dailyPath, resolve) {
  const seen = new Set();
  const keys = [];
  const list = Array.isArray(links) ? links : [];
  for (const link of list) {
    if (!link || typeof link.blockId !== "string" || !link.blockId) {
      continue;
    }
    let resolved = null;
    const target = typeof link.target === "string" ? link.target : "";
    if (target === "") {
      resolved = typeof dailyPath === "string" ? dailyPath : null;
    } else if (typeof resolve === "function") {
      try {
        const file = resolve(target, dailyPath);
        resolved =
          file && typeof file.path === "string" ? file.path : null;
      } catch (error) {
        resolved = null;
      }
    }
    if (typeof resolved !== "string" || !resolved) {
      continue;
    }
    const withExtension = /\.md$/i.test(resolved)
      ? resolved
      : `${resolved}.md`;
    const key = `${withExtension}#${link.blockId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function planTaskBlockId(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  for (const key of ["blockLink", "blockId"]) {
    const value = task[key];
    if (typeof value !== "string") {
      continue;
    }
    // Tasks 8.4.0 keeps the block ID in `blockLink` as ` ^id` (see its
    // `blockLinkRegex`: `/ \^<id>$/`); the ID itself matches
    // `PLAN_BLOCK_ID_RE`.
    const trimmed = value.trim().replace(/^\^/, "");
    if (trimmed && PLAN_BLOCK_ID_RE.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function planTaskStatusSymbol(task) {
  if (!task || typeof task !== "object") {
    return "";
  }
  const status =
    task.status && typeof task.status === "object" ? task.status : {};
  for (const value of [status.symbol, task.statusSymbol, task.symbol]) {
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return "";
}

function planLaneVisible(task, list, todayDay) {
  if (planTaskIsDone(task)) {
    return false;
  }
  if (planTaskIsBlocked(task, list)) {
    return false;
  }
  const tags = planTaskTags(task);
  if (
    tags.some(
      (tag) => typeof tag === "string" && tag.toLowerCase().includes("#hide"),
    )
  ) {
    return false;
  }
  const loweredPath = String(planTaskPath(task) || "").toLowerCase();
  if (loweredPath.includes("_templates") || loweredPath.includes("_conflicts")) {
    return false;
  }
  if (todayDay !== null) {
    const scheduled = planTaskScheduledDay(task);
    if (scheduled !== null && scheduled > todayDay) {
      return false;
    }
  }
  return true;
}

// A lane budget over Tasks-plugin task objects: `"next"` is symbol `*`,
// `"pending"` is type IN_PROGRESS. Visibility matches the dash defaults
// (`docs/plan.md`, "Lanes"), counting the whole lane, Today included.
function laneBudgetFromTasks(tasks, today, caps, lane) {
  const effective = effectivePlanCaps(caps);
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(today === undefined ? new Date() : today);
  let count = 0;
  for (const task of list) {
    if (!planLaneVisible(task, list, todayDay)) {
      continue;
    }
    if (lane === "next") {
      if (planTaskStatusSymbol(task) !== "*") {
        continue;
      }
    } else if (lane === "pending") {
      const type =
        task && task.status && typeof task.status === "object"
          ? task.status.type
          : null;
      if (type !== "IN_PROGRESS") {
        continue;
      }
    } else {
      continue;
    }
    count += 1;
  }
  const cap = lane === "pending" ? effective.maxPending : effective.maxNext;
  return { count, cap, over: count > cap };
}

// --- READY backlog ----------------------------------------------------------
// The shared READY backlog (`docs/plan.md`, "READY backlog"): the global
// dashboard backlog, regardless of which daily file hosts the badge.
//
// The predicate matches the dashboard READY section's effective filters:
// TODO type (including custom TODO symbols), dashboard visibility
// (template exclusion, dash.md self-exclusion, exact `#hide` match, and
// the Tasks global query's `_conflicts` exclusion applied explicitly
// because `getTasks()` returns the raw cache), not dependency-blocked
// (against the full Tasks list), scheduled on or before the current
// local day, and not Today. Self-exclusion always refers to `dash.md`,
// never the hosting daily note.
//
// This deliberately does NOT reuse `planLaneVisible`: that helper's
// hide-subtag (`#hide/x`, case-insensitive) and lowercased path checks
// are broader than the dashboard's current explicit
// `!task.tags.includes("#hide")` rule. The distinction is pinned in
// fixtures.
const READY_DASH_PATH = "dash.md";
const READY_FALLBACK_CAP = 100;

function readyTaskStatusIsTodo(task) {
  if (!task || typeof task !== "object") {
    return false;
  }
  const status =
    task.status && typeof task.status === "object" ? task.status : null;
  if (status && typeof status.type === "string") {
    return status.type === "TODO";
  }
  return false;
}

function readyTaskVisible(task, todayDay) {
  if (!task || typeof task !== "object") {
    return false;
  }
  if (planTaskIsDone(task)) {
    return false;
  }
  if (!readyTaskStatusIsTodo(task)) {
    return false;
  }
  const path = String(planTaskPath(task) || "");
  if (!path) {
    return false;
  }
  if (path.includes("_templates")) {
    return false;
  }
  if (path.includes("_conflicts")) {
    return false;
  }
  if (path === READY_DASH_PATH) {
    return false;
  }
  const tags = planTaskTags(task);
  if (tags.includes("#hide")) {
    return false;
  }
  if (todayDay !== null && todayDay !== undefined) {
    const scheduled = planTaskScheduledDay(task);
    if (scheduled !== null && scheduled > todayDay) {
      return false;
    }
  }
  return true;
}

// Pure, testable READY count over Tasks-plugin task objects. `isToday`
// is the caller's Today predicate. Throws when `isToday` or `isBlocked`
// throws, so callers can degrade to an unavailable badge rather than a
// partial count.
//
// The optional `isReviewBucket` predicate gates the shared READY count
// (`docs/freshness.md` §4 in bob-cli): tasks it flags (NEW or ROTTEN
// review) are excluded from READY. A throwing predicate discards the
// partial gated count and recomputes the legacy ungated count, so a
// failure halfway through a batch never leaves a partially gated badge.
function readyCountFromTasks(tasks, today, isToday, isReviewBucket) {
  const list = Array.isArray(tasks) ? tasks : [];
  const todayDay = planDayNumber(today === undefined ? new Date() : today);
  const isTodayPredicate =
    typeof isToday === "function" ? isToday : () => false;
  const gated = typeof isReviewBucket === "function";
  const legacyCount = () => {
    let total = 0;
    for (const task of list) {
      if (!readyTaskVisible(task, todayDay)) {
        continue;
      }
      if (planTaskIsBlocked(task, list)) {
        continue;
      }
      let todayFlag = false;
      try {
        todayFlag = Boolean(isTodayPredicate(task));
      } catch (error) {
        throw error;
      }
      if (todayFlag) {
        continue;
      }
      total += 1;
    }
    return total;
  };
  if (!gated) {
    return legacyCount();
  }
  let count = 0;
  for (const task of list) {
    if (!readyTaskVisible(task, todayDay)) {
      continue;
    }
    if (planTaskIsBlocked(task, list)) {
      continue;
    }
    let todayFlag = false;
    try {
      todayFlag = Boolean(isTodayPredicate(task));
    } catch (error) {
      throw error;
    }
    if (todayFlag) {
      continue;
    }
    let review = false;
    try {
      review = Boolean(isReviewBucket(task));
    } catch (error) {
      return legacyCount();
    }
    if (review) {
      continue;
    }
    count += 1;
  }
  return count;
}

function readyBudgetFromTasks(tasks, today, caps, isToday, isReviewBucket) {
  const effective = effectivePlanCaps(caps);
  const cap = planReadyCapOrDefault(effective.maxReady, READY_FALLBACK_CAP);
  const count = readyCountFromTasks(
    tasks,
    today,
    isToday,
    isReviewBucket,
  );
  return { count, cap, over: count > cap };
}

// Shared READY badge view-model. `budget` is `{ count, cap, over }` with
// `count === null` for unavailable. Never throws.
function readyBadgeModel(budget, options = {}) {
  const invalid = Boolean(options.invalid);
  const cap =
    budget && Number.isInteger(budget.cap) && budget.cap >= 1
      ? budget.cap
      : READY_FALLBACK_CAP;
  const count =
    budget && (typeof budget.count === "number" || budget.count === null)
      ? budget.count
      : null;
  if (count === null || !Number.isInteger(count) || count < 0) {
    return {
      text: "READY –",
      tooltip:
        `READY backlog unavailable; limit ${cap}. ` +
        `Live current backlog excluding Today. Open READY Tasks in dash.` +
        (invalid ? " Plan config invalid, using defaults." : ""),
      aria: `READY: unavailable (limit ${cap}). Open READY Tasks in dash.`,
      over: false,
      placeholder: true,
      count: null,
      cap,
    };
  }
  const over = count > cap;
  const excess = count - cap;
  // Freshness-gated lanes carry total lane pressure: the gated READY
  // count plus the NEW and ROTTEN review buckets behind it.
  const lane = options.lane || null;
  const laneValid =
    lane &&
    Number.isInteger(lane.total) &&
    lane.total >= 0 &&
    Number.isInteger(lane.new) &&
    lane.new >= 0 &&
    Number.isInteger(lane.rotten) &&
    lane.rotten >= 0 &&
    lane.ready === count;
  const tooltip = laneValid
    ? `READY ${count}/${cap} · lane ${lane.total} = ${lane.new} new + ${lane.rotten} rotten + ${lane.ready} ready` +
      (over ? ` · ${excess} over the limit` : "") +
      (invalid ? " · plan config invalid, using defaults" : "")
    : over
      ? `${count} ready tasks; limit ${cap}; ${excess} over the limit. ` +
        `Live current backlog excluding Today. Open READY Tasks in dash.` +
        (invalid ? " Plan config invalid, using defaults." : "")
      : `${count} ready tasks; limit ${cap}. ` +
        `Live current backlog excluding Today. Open READY Tasks in dash.` +
        (invalid ? " Plan config invalid, using defaults." : "");
  const aria = over
    ? `READY: ${count} of ${cap} tasks, ${excess} over the limit. Open READY Tasks in dash.`
    : `READY: ${count} of ${cap} tasks. Open READY Tasks in dash.`;
  return {
    text: `READY ${count}/${cap}`,
    tooltip,
    aria,
    over,
    placeholder: false,
    count,
    cap,
  };
}

// Structured READY content: the shared badge renders separate label and
// value spans (`.bob-plan-ready-label` / `.bob-plan-ready-value`) so the
// dashboard and daily surfaces can style them like neighboring chips. One
// routine owns both initial paint and live refresh so updates never flatten
// the anchor back to plain text.
const READY_LABEL_TEXT = "READY";
const READY_LABEL_CLS = "bob-plan-ready-label";
const READY_VALUE_CLS = "bob-plan-ready-value";

function readyBadgeValueText(model) {
  if (
    !model ||
    model.placeholder ||
    model.count === null ||
    model.count === undefined
  ) {
    return "–";
  }
  return `${model.count}/${model.cap}`;
}

function setReadySpanText(span, text) {
  if (!span) {
    return;
  }
  if (typeof span.setText === "function") {
    span.setText(text);
    return;
  }
  // Real DOM elements expose textContent; minimal test stubs use `.text`.
  // Assigning `.text` on a real Element is a harmless expando, while setting
  // textContent on a stub without that field would create a misleading
  // duplicate source of truth, so prefer whichever already exists.
  if ("textContent" in span && typeof span.textContent === "string") {
    span.textContent = text;
  } else if ("text" in span) {
    span.text = text;
  } else if ("textContent" in span) {
    span.textContent = text;
  } else {
    span.text = text;
  }
}

function collectReadySpans(anchor, cls) {
  if (!anchor) {
    return [];
  }
  try {
    if (typeof anchor.querySelectorAll === "function") {
      return Array.from(anchor.querySelectorAll(`.${cls}`));
    }
  } catch (error) {
    // Fall through to the children scan below.
  }
  const children =
    (Array.isArray(anchor.children) && anchor.children) ||
    (Array.isArray(anchor.childNodes) && anchor.childNodes) ||
    [];
  return children.filter((child) => {
    if (!child) {
      return false;
    }
    if (typeof child.cls === "string") {
      return child.cls.split(/\s+/).includes(cls);
    }
    const classAttr =
      child.attrs && typeof child.attrs.class === "string"
        ? child.attrs.class
        : typeof child.className === "string"
          ? child.className
          : null;
    if (typeof classAttr === "string") {
      return classAttr.split(/\s+/).includes(cls);
    }
    if (child.classList && typeof child.classList.contains === "function") {
      try {
        return child.classList.contains(cls);
      } catch (error) {
        return false;
      }
    }
    return false;
  });
}

function findReadySpan(anchor, cls) {
  if (!anchor) {
    return null;
  }
  try {
    if (typeof anchor.querySelector === "function") {
      return anchor.querySelector(`.${cls}`) || null;
    }
  } catch (error) {
    // Fall through to the children scan below.
  }
  const matches = collectReadySpans(anchor, cls);
  return matches.length > 0 ? matches[0] : null;
}

function createReadySpan(anchor, cls, text) {
  if (anchor && typeof anchor.createEl === "function") {
    return anchor.createEl("span", { cls, text });
  }
  // Minimal-stub fallback: track the child so structure assertions still see
  // exactly one label and one value.
  const span = {
    tag: "span",
    cls,
    text,
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  if (Array.isArray(anchor.children)) {
    anchor.children.push(span);
  }
  return span;
}

// Update the anchor's child spans plus its model-dependent title,
// accessibility label, and state classes without replacing the anchor or
// disturbing its event listeners. Repeated calls leave exactly one label
// and one value span.
function setReadyAnchorContent(anchor, model) {
  if (!anchor) {
    return;
  }
  const valueText = readyBadgeValueText(model);
  let label = findReadySpan(anchor, READY_LABEL_CLS);
  if (!label) {
    label = createReadySpan(anchor, READY_LABEL_CLS, READY_LABEL_TEXT);
  }
  setReadySpanText(label, READY_LABEL_TEXT);
  let value = findReadySpan(anchor, READY_VALUE_CLS);
  if (!value) {
    value = createReadySpan(anchor, READY_VALUE_CLS, valueText);
  }
  setReadySpanText(value, valueText);
  // Drop extras so repeated updates never accumulate spans.
  for (const cls of [READY_LABEL_CLS, READY_VALUE_CLS]) {
    const matches = collectReadySpans(anchor, cls);
    for (let index = 1; index < matches.length; index += 1) {
      const extra = matches[index];
      try {
        if (extra && typeof extra.remove === "function") {
          extra.remove();
        } else if (
          anchor &&
          typeof anchor.removeChild === "function" &&
          extra &&
          extra.parentNode === anchor
        ) {
          anchor.removeChild(extra);
        } else if (anchor && Array.isArray(anchor.children)) {
          const at = anchor.children.indexOf(extra);
          if (at !== -1) {
            anchor.children.splice(at, 1);
          }
        }
      } catch (error) {
        // Best-effort dedupe only.
      }
    }
  }
  // Clear any flattened direct text left by older renders (or stub `.text`)
  // while preserving the span children. Never assign `.text` on a live
  // element: in Obsidian it is a setter that wipes the span children.
  try {
    const childNodes =
      anchor && anchor.childNodes != null ? anchor.childNodes : null;
    if (childNodes && typeof childNodes.length === "number") {
      for (const node of Array.from(childNodes)) {
        if (
          node &&
          node.nodeType === 3 &&
          node !== label &&
          node !== value
        ) {
          if (typeof anchor.removeChild === "function") {
            anchor.removeChild(node);
          }
        }
      }
    }
  } catch (error) {
    // Best-effort cleanup only.
  }
  try {
    const descriptor = anchor
      ? Object.getOwnPropertyDescriptor(anchor, "text")
      : undefined;
    if (descriptor && typeof descriptor.value === "string") {
      // Stub anchors carry `.text` as an own data property alongside
      // `.children`; keep it empty so a stale flattened value can never
      // shadow the spans. A live Obsidian accessor lives on the prototype
      // and must be left alone.
      anchor.text = "";
    }
  } catch (error) {
    // Best-effort cleanup only.
  }
  if (typeof anchor.setAttribute === "function") {
    anchor.setAttribute("title", model.tooltip);
    anchor.setAttribute("aria-label", model.aria);
    const cls =
      `bob-plan-chip bob-plan-ready${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`;
    anchor.setAttribute("class", cls);
    if (anchor.attrs && typeof anchor.attrs === "object") {
      anchor.attrs.class = cls;
    }
  }
  if (anchor && typeof anchor.cls === "string") {
    anchor.cls =
      `bob-plan-chip bob-plan-ready${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`;
  }
  if (anchor && typeof anchor.title === "string") {
    anchor.title = model.tooltip;
  }
}

// Shared NEW/ROTTEN chip content: separate label and value spans like
// the READY badge, so dashboard and rotten-summary chips style like
// neighboring chips. NEW shows 0 when empty and is red above 0;
// ROTTEN is neutral at 0, orange above 0, red once any returned or
// age-expired row is a full interval overdue.
const REVIEW_LABEL_CLS = "bob-plan-review-label";
const REVIEW_VALUE_CLS = "bob-plan-review-value";

function reviewChipText(kind, review) {
  const active = review && review.available === true ? review : null;
  if (kind === "rotten") {
    return {
      label: "ROTTEN",
      value: active ? active.rottenText.replace(/^ROTTEN /, "") : "–",
      tooltip: active ? active.tooltip : "ROTTEN unavailable",
      aria: active ? active.tooltip : "ROTTEN: unavailable",
    };
  }
  return {
    label: "NEW",
    value: active ? String(active.new) : "–",
    tooltip: active
      ? "NEW " + active.new + " unconfirmed · " + active.meter + " today"
      : "NEW unavailable",
    aria: active
      ? "NEW: " + active.new + " unconfirmed"
      : "NEW: unavailable",
  };
}

function reviewChipClass(kind, review) {
  const active = review && review.available === true ? review : null;
  let cls = "bob-plan-chip bob-plan-review bob-plan-" + kind;
  if (!active) {
    return cls + " bob-plan-unavailable";
  }
  if (kind === "rotten") {
    if (review.escalated) {
      return cls + " bob-plan-over";
    }
    if (review.rotten > 0) {
      return cls + " bob-plan-warn";
    }
    return cls;
  }
  if (review.new > 0) {
    return cls + " bob-plan-over";
  }
  return cls;
}

function reviewChipHref(kind) {
  return kind === "rotten" ? "rotten" : "dash#NEW Tasks";
}

function setReviewAnchorContent(anchor, kind, review) {
  if (!anchor) {
    return;
  }
  const content = reviewChipText(kind, review);
  const cls = reviewChipClass(kind, review);
  let label = findReadySpan(anchor, REVIEW_LABEL_CLS);
  if (!label) {
    label = createReadySpan(anchor, REVIEW_LABEL_CLS, content.label);
  }
  setReadySpanText(label, content.label);
  let value = findReadySpan(anchor, REVIEW_VALUE_CLS);
  if (!value) {
    value = createReadySpan(anchor, REVIEW_VALUE_CLS, content.value);
  }
  setReadySpanText(value, content.value);
  for (const spanCls of [REVIEW_LABEL_CLS, REVIEW_VALUE_CLS]) {
    const matches = collectReadySpans(anchor, spanCls);
    for (let index = 1; index < matches.length; index += 1) {
      const extra = matches[index];
      try {
        if (extra && typeof extra.remove === "function") {
          extra.remove();
        } else if (anchor && Array.isArray(anchor.children)) {
          const at = anchor.children.indexOf(extra);
          if (at !== -1) {
            anchor.children.splice(at, 1);
          }
        }
      } catch (error) {
        // Best-effort dedupe only.
      }
    }
  }
  if (typeof anchor.setAttribute === "function") {
    anchor.setAttribute("title", content.tooltip);
    anchor.setAttribute("aria-label", content.aria);
    anchor.setAttribute("class", cls);
    if (anchor.attrs && typeof anchor.attrs === "object") {
      anchor.attrs.class = cls;
    }
  }
  if (anchor && typeof anchor.cls === "string") {
    anchor.cls = cls;
  }
  if (anchor && typeof anchor.title === "string") {
    anchor.title = content.tooltip;
  }
}

function paintReviewElement(host, kind, review) {
  try {
    if (!host || typeof host.createEl !== "function") {
      return null;
    }
    const anchor = host.createEl("a", {
      cls: reviewChipClass(kind, review),
      title: reviewChipText(kind, review).tooltip,
      href: reviewChipHref(kind),
    });
    setReviewAnchorContent(anchor, kind, review);
    if (anchor && typeof anchor.setAttribute === "function") {
      anchor.setAttribute("aria-label", reviewChipText(kind, review).aria);
      anchor.setAttribute("role", "link");
      if (
        typeof anchor.hasAttribute !== "function" ||
        !anchor.hasAttribute("tabindex")
      ) {
        anchor.setAttribute("tabindex", "0");
      }
    }
    return anchor;
  } catch (error) {
    return null;
  }
}

// --- Task freshness: placement ----------------------------------------------
// Owned by `docs/freshness.md` in bob-cli; the Rust half is
// `src/native/freshness/placement.rs`. Both sides run the placement (P)
// conformance vectors in that doc verbatim.
//
// Placement is the exception to the copy-small-helpers rule: nav,
// task-status-cycler and block-id-prompt call
// `api?.freshness?.stampLine?.(line, dateText) ?? line` (api
// `version >= 3`) instead of placing `fresh` themselves. A missing stamp
// only means Bryan sees the task once more; a misplaced stamp hides
// Tasks fields — so the risky part lives here, and when ledger-tools is
// absent or old the gesture simply doesn't stamp.

// Tasks keys recognized at the end of a Dataview task line, in the order
// `docs/freshness.md` pins them.
const FRESHNESS_TASKS_KEYS = [
  "priority",
  "start",
  "created",
  "scheduled",
  "due",
  "completion",
  "cancelled",
  "repeat",
  "onCompletion",
  "id",
  "dependsOn",
];

// Any `[key:: value]` or `(key:: value)` field, with the key matched
// case-sensitively and any spacing allowed around `::`. Mirrors the Rust
// `INLINE_FIELD_RE` in `task_fields.rs`.
const FRESHNESS_INLINE_FIELD_SOURCE =
  "\\[([A-Za-z][A-Za-z0-9_-]*)\\s*::\\s*([^\\]\n]*)\]|\\(([A-Za-z][A-Za-z0-9_-]*)\\s*::\\s*([^)\n]*)\\)";

// Every `key` field on `line`, in line order: `{ start, end, value }`
// with UTF-16 offsets into `line`. The key match is case-sensitive and
// the value is trimmed of spaces/tabs only, like the Rust scanner.
function freshnessInlineFields(line, key) {
  const text = String(line || "");
  const pattern = new RegExp(FRESHNESS_INLINE_FIELD_SOURCE, "g");
  const out = [];
  let match = pattern.exec(text);
  while (match !== null) {
    const matchedKey = match[1] !== undefined ? match[1] : match[3];
    const raw = match[1] !== undefined ? match[2] : match[4];
    if (matchedKey === key) {
      const value = raw.replace(/^[ \t]+|[ \t]+$/g, "");
      out.push({ start: match.index, end: match.index + match[0].length, value });
    }
    match = pattern.exec(text);
  }
  return out;
}

function freshnessIsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

// A strict `YYYY-MM-DD` calendar date, else null. Anything else —
// including out-of-range months and days — is rejected, like the Rust
// `parse_strict_calendar_date`.
function parseFreshDateStrict(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  const daysInMonth = [
    31,
    freshnessIsLeapYear(year) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ][month - 1];
  if (day > daysInMonth) {
    return null;
  }
  return text;
}

function freshDateToUtc(text) {
  return Date.UTC(
    Number(text.slice(0, 4)),
    Number(text.slice(5, 7)) - 1,
    Number(text.slice(8, 10)),
  );
}

function freshPad2(number) {
  return String(number).padStart(2, "0");
}

// Add `days` to a canonical date. DST-safe via UTC noon arithmetic.
function freshDateAddDays(text, days) {
  const shifted = new Date(freshDateToUtc(text) + days * 86400000);
  return (
    String(shifted.getUTCFullYear()).padStart(4, "0") +
    "-" +
    freshPad2(shifted.getUTCMonth() + 1) +
    "-" +
    freshPad2(shifted.getUTCDate())
  );
}

// Whole days from `from` to `to` (both canonical dates).
function freshDateDiffDays(from, to) {
  return Math.round((freshDateToUtc(to) - freshDateToUtc(from)) / 86400000);
}

// Drop leading `>` quote markers the way the vault scanner does (up to
// three spaces, `>`, one optional space, repeated). Quoted tasks are
// still tasks; the `>` bytes stay in place on write.
function freshnessStripBlockquotePrefix(line) {
  let rest = String(line || "");
  for (;;) {
    const spaces = rest.match(/^ */)[0].length;
    if (spaces > 3 || rest[spaces] !== ">") {
      return rest;
    }
    rest = rest.slice(spaces + 1);
    if (rest.startsWith(" ")) {
      rest = rest.slice(1);
    }
  }
}

function freshnessAfterListMarker(line, index) {
  if (line[index] === "-" || line[index] === "*" || line[index] === "+") {
    return line[index + 1] !== undefined &&
      /\s/.test(line[index + 1])
      ? index + 1
      : null;
  }
  const digits = (line.slice(index).match(/^\d+/) || [""])[0].length;
  if (
    digits === 0 ||
    (line[index + digits] !== "." && line[index + digits] !== ")")
  ) {
    return null;
  }
  return line[index + digits + 1] !== undefined &&
    /\s/.test(line[index + digits + 1])
    ? index + digits + 1
    : null;
}

// The checkbox status char on a task line, or null when `line` is not a
// task line.
function freshnessTaskStatus(line) {
  const stripped = freshnessStripBlockquotePrefix(line);
  let index = 0;
  while (stripped[index] === " " || stripped[index] === "\t") {
    index += 1;
  }
  const after = freshnessAfterListMarker(stripped, index);
  if (after === null) {
    return null;
  }
  index = after;
  while (stripped[index] !== undefined && /\s/.test(stripped[index])) {
    index += 1;
  }
  if (stripped[index] !== "[") {
    return null;
  }
  const close = stripped.indexOf("]", index + 1);
  if (close === -1) {
    return null;
  }
  const inner = stripped.slice(index + 1, close);
  if ([...inner].length !== 1) {
    return null;
  }
  const trailing = stripped.slice(close + 1);
  if (trailing !== "" && !/^\s/.test(trailing)) {
    return null;
  }
  return inner;
}

function freshnessIsClosedStatus(status) {
  return status === "x" || status === "X" || status === "-";
}

function freshnessHasRepeatField(line) {
  return freshnessInlineFields(line, "repeat").length > 0;
}

// A `[refresh:: N]` value: an integer 1-365, nothing else.
function freshnessParseRefreshValue(value) {
  const trimmed = String(value || "").trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    return null;
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 1 || number > 365) {
    return null;
  }
  return number;
}

function freshnessFirstValidRefresh(line) {
  const fields = freshnessInlineFields(line, "refresh");
  for (const field of fields) {
    const days = freshnessParseRefreshValue(field.value);
    if (days !== null) {
      return days;
    }
  }
  return null;
}

// The scan floor: the start of the task body, or the end of a leading
// `#task` global-filter token. The suffix scan never moves left of it.
// Quote markers are detection-only: the floor is shifted back into the
// original line's coordinates.
function freshnessScanFloor(line) {
  const text = String(line || "");
  const stripped = freshnessStripBlockquotePrefix(text);
  const offset = text.length - stripped.length;
  let index = 0;
  while (stripped[index] === " " || stripped[index] === "\t") {
    index += 1;
  }
  const after = freshnessAfterListMarker(stripped, index);
  if (after === null) {
    return null;
  }
  index = after;
  while (stripped[index] !== undefined && /\s/.test(stripped[index])) {
    index += 1;
  }
  const close = stripped.indexOf("]", index);
  if (close === -1) {
    return null;
  }
  let bodyStart = close + 1;
  while (stripped[bodyStart] === " " || stripped[bodyStart] === "\t") {
    bodyStart += 1;
  }
  const body = stripped.slice(bodyStart);
  if (
    body === "#task" ||
    body.startsWith("#task ") ||
    body.startsWith("#task\t")
  ) {
    return offset + bodyStart + "#task".length;
  }
  return offset + bodyStart;
}

function freshnessTrimEndTo(text, cursor) {
  let end = Math.min(cursor, text.length);
  while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) {
    end -= 1;
  }
  return end;
}

// Start of a trailing ` ^id` block link, if `text` ends with one.
function freshnessTrailingBlockStart(text) {
  const trimmed = text.replace(/[ \t]+$/, "");
  const tokenStart = (() => {
    const last = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"));
    return last === -1 ? 0 : last + 1;
  })();
  const token = trimmed.slice(tokenStart);
  if (!token.startsWith("^")) {
    return null;
  }
  const id = token.slice(1);
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) {
    return null;
  }
  if (tokenStart > 0) {
    const before = trimmed[tokenStart - 1];
    if (before !== " " && before !== "\t") {
      return null;
    }
  }
  return text.replace(/[ \t]+$/, "").length - token.length;
}

// Start of a trailing `#tag`, if `trimmed` (already right-trimmed) ends
// with one starting at or after `floor`.
function freshnessTrailingTagStart(trimmed, floor) {
  const last = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"));
  const tokenStart = last === -1 ? 0 : last + 1;
  const start = Math.max(tokenStart, floor);
  const token = trimmed.slice(start);
  if (!token.startsWith("#")) {
    return null;
  }
  if (start > floor) {
    const before = trimmed[start - 1];
    if (before !== " " && before !== "\t") {
      return null;
    }
  }
  const value = token.slice(1);
  if (!value || /[\s!@#$%^&*(),.?":{}|<>]/.test(value)) {
    return null;
  }
  return start;
}

// The `(start, key)` of a trailing `[k:: v]` / `(k:: v)` field: the key
// must equal its trim.
function freshnessTrailingFieldKey(trimmed) {
  let end = trimmed.length;
  if (trimmed.endsWith(",")) {
    end -= 1;
    end = trimmed.slice(0, end).replace(/[ \t]+$/, "").length;
  }
  const head = trimmed.slice(0, end);
  const close = head[head.length - 1];
  const open = close === "]" ? "[" : close === ")" ? "(" : null;
  if (open === null) {
    return null;
  }
  const withoutClose = head.slice(0, -1);
  const start = withoutClose.lastIndexOf(open);
  if (start === -1) {
    return null;
  }
  const inner = withoutClose.slice(start + 1).trim();
  const separator = inner.indexOf("::");
  if (separator === -1) {
    return null;
  }
  const key = inner.slice(0, separator);
  if (key !== key.trim() || !key.trim()) {
    return null;
  }
  return { start, key: key.trim() };
}

// Byte offset where the trailing Tasks suffix starts. The suffix starts
// at the leftmost Tasks element (a Tasks-key field, a trailing tag, or
// `^id`) of the run scanned from the end of the line. `fresh` /
// `refresh` fields extend the run but are not part of the suffix.
// Returns the trimmed length when there is no suffix.
function freshnessTasksSuffixStart(line) {
  const text = String(line || "");
  const floor = freshnessScanFloor(text);
  if (floor === null) {
    return text.replace(/[ \t\n\r]+$/, "").length;
  }
  const trimmedLen = text.replace(/[ \t\n\r]+$/, "").length;
  let cursor = trimmedLen;
  let leftmost = null;

  const blockStart = freshnessTrailingBlockStart(text.slice(0, cursor));
  if (blockStart !== null && blockStart >= floor) {
    leftmost = blockStart;
    cursor = freshnessTrimEndTo(text.slice(0, blockStart), blockStart);
  }

  for (;;) {
    if (cursor <= floor) {
      break;
    }
    const slice = text.slice(0, cursor);
    const trimmed = slice.replace(/[ \t\n\r]+$/, "");
    const end = trimmed.length;
    if (end <= floor) {
      break;
    }
    const tagStart = freshnessTrailingTagStart(trimmed, floor);
    if (tagStart !== null) {
      leftmost = tagStart;
      cursor = freshnessTrimEndTo(text.slice(0, tagStart), tagStart);
      continue;
    }
    const field = freshnessTrailingFieldKey(trimmed);
    if (!field) {
      break;
    }
    if (field.start < floor) {
      break;
    }
    if (FRESHNESS_TASKS_KEYS.includes(field.key)) {
      leftmost = field.start;
      cursor = freshnessTrimEndTo(text.slice(0, field.start), field.start);
      continue;
    }
    if (field.key === "fresh" || field.key === "refresh") {
      cursor = freshnessTrimEndTo(text.slice(0, field.start), field.start);
      continue;
    }
    break;
  }

  return leftmost === null ? trimmedLen : leftmost;
}

// Remove every `fresh` and `refresh` field from `text`, collapsing the
// whitespace each removal leaves to a single space.
function freshnessRemoveFields(text) {
  const ranges = [];
  for (const field of freshnessInlineFields(text, "fresh")) {
    ranges.push([field.start, field.end]);
  }
  for (const field of freshnessInlineFields(text, "refresh")) {
    ranges.push([field.start, field.end]);
  }
  if (ranges.length === 0) {
    return text;
  }
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  let output = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    const before = text.slice(cursor, start).replace(/[ \t]+$/, "");
    output += before;
    let next = end;
    while (text[next] === " " || text[next] === "\t") {
      next += 1;
    }
    if (output !== "" && next < text.length) {
      output += " ";
    }
    cursor = next;
  }
  output += text.slice(cursor);
  return output;
}

// Rebuild `line` with `[fresh:: dateText]` (and `[refresh:: N]` when
// kept) immediately before the Tasks suffix. The suffix bytes themselves
// are never changed.
function freshnessRebuildWithoutFields(line, dateText, keptRefresh) {
  const text = String(line || "");
  const trimmedLen = text.replace(/[ \t\n\r]+$/, "").length;
  const suffixStart = Math.min(freshnessTasksSuffixStart(text), trimmedLen);
  const headClean = freshnessRemoveFields(text.slice(0, suffixStart));
  const suffixClean = freshnessRemoveFields(text.slice(suffixStart, trimmedLen));
  const head = headClean.replace(/[ \t\n\r]+$/, "");
  const suffix = suffixClean.trim().replace(/^[ \t]+/, "");

  let output = head + " [fresh:: " + dateText + "]";
  if (keptRefresh !== null && keptRefresh !== undefined) {
    output += " [refresh:: " + keptRefresh + "]";
  }
  if (suffix !== "") {
    output += " " + suffix;
  }
  return output;
}

function freshnessTodayFallback() {
  return formatLocalDate(new Date());
}

function freshnessNormalizeDateText(dateText) {
  return parseFreshDateStrict(dateText) || freshnessTodayFallback();
}

// Stamp `line` with `dateText`, keeping the first valid existing
// `[refresh:: N]` if there is one. Refusals (not a task, recurring,
// done/cancelled) return the line unchanged with a reason. A line
// already stamped with `dateText` in canonical position is
// byte-identical with `changed: false`.
function freshnessStampLine(line, dateText) {
  const text = String(line || "");
  const day = freshnessNormalizeDateText(dateText);
  const status = freshnessTaskStatus(text);
  if (status === null) {
    return { line: text, changed: false, refused: "not_task" };
  }
  if (freshnessIsClosedStatus(status)) {
    return { line: text, changed: false, refused: "closed" };
  }
  if (freshnessHasRepeatField(text)) {
    return { line: text, changed: false, refused: "recurring" };
  }
  const output = freshnessRebuildWithoutFields(
    text,
    day,
    freshnessFirstValidRefresh(text),
  );
  return { line: output, changed: output !== text, refused: null };
}

// Set or clear `[refresh:: N]` and stamp with `dateText`. A value
// outside 1-365 clears the field instead of writing an invalid one,
// like the Rust `set_refresh`.
function freshnessSetRefreshLine(line, days, dateText) {
  const text = String(line || "");
  const day = freshnessNormalizeDateText(dateText);
  let normalized = days;
  if (typeof normalized === "string" && /^[+-]?\d+$/.test(normalized.trim())) {
    normalized = Number(normalized.trim());
  }
  const edit =
    Number.isSafeInteger(normalized) && normalized >= 1 && normalized <= 365
      ? normalized
      : null;
  const status = freshnessTaskStatus(text);
  if (status === null) {
    return { line: text, changed: false, refused: "not_task" };
  }
  if (freshnessIsClosedStatus(status)) {
    return { line: text, changed: false, refused: "closed" };
  }
  if (freshnessHasRepeatField(text)) {
    return { line: text, changed: false, refused: "recurring" };
  }
  const output = freshnessRebuildWithoutFields(text, day, edit);
  return { line: output, changed: output !== text, refused: null };
}

function freshnessPushLint(lints, code) {
  if (!lints.includes(code)) {
    lints.push(code);
  }
}

// Read the `fresh` / `refresh` fields on `line`: the latest valid
// `fresh` date not after `todayText` (a future date is treated as none),
// the first valid `[refresh:: N]`, and lint codes in first-seen order.
function readFreshness(line, todayText) {
  const text = String(line || "");
  const today = freshnessNormalizeDateText(todayText);
  const freshFields = freshnessInlineFields(text, "fresh");
  const refreshFields = freshnessInlineFields(text, "refresh");
  const lints = [];

  let best = null;
  for (const field of freshFields) {
    const date = parseFreshDateStrict(field.value.trim());
    if (date === null) {
      freshnessPushLint(lints, "fresh_malformed");
    } else if (date > today) {
      freshnessPushLint(lints, "fresh_future");
    } else if (best === null || date > best) {
      best = date;
    }
  }
  if (freshFields.length > 1) {
    freshnessPushLint(lints, "fresh_duplicate");
  }

  let refresh = null;
  let refreshInvalidSeen = false;
  for (const field of refreshFields) {
    const days = freshnessParseRefreshValue(field.value);
    if (days === null) {
      refreshInvalidSeen = true;
    } else if (refresh === null) {
      refresh = days;
    }
  }
  if (refreshInvalidSeen) {
    freshnessPushLint(lints, "refresh_invalid");
  }

  const suffixStart = freshnessTasksSuffixStart(text);
  const trimmedLen = text.replace(/[ \t\n\r]+$/, "").length;
  if (suffixStart < trimmedLen) {
    const misplaced = (name) =>
      freshnessInlineFields(text, name).some(
        (field) => field.start >= suffixStart,
      );
    if (misplaced("fresh") || misplaced("refresh")) {
      freshnessPushLint(lints, "fresh_misplaced");
    }
  }

  return { fresh: best, refresh, lints };
}

// --- Task freshness: config -------------------------------------------------
// Beside `planCapsBlock` / `coercePlanCaps`: the `freshness:` block in
// `~/.config/bob/config.yml` (`interval`, `rotten_daily_budget`).
// The removed `stale_daily_budget` key still supplies the budget for
// one release with a deprecation lint.

function defaultFreshnessConfig() {
  return { interval: 7, rottenDailyBudget: null };
}

// The raw `freshness:` block out of a parsed config file, or undefined
// when the file holds no such block. A present-but-bad block (null is
// fine, anything else that is not a mapping is not) is returned as-is
// so `coerceFreshnessConfig` can flag it; unknown keys stay ignored.
function freshnessBlock(yamlObject) {
  if (
    !yamlObject ||
    typeof yamlObject !== "object" ||
    Array.isArray(yamlObject)
  ) {
    return undefined;
  }
  const block = yamlObject.freshness;
  return block === undefined ? undefined : block;
}

function coerceFreshnessConfig(block) {
  const defaults = defaultFreshnessConfig();
  const fallback = () => ({
    config: { ...defaults, intervalFromConfig: false },
    invalid: false,
  });
  if (block === undefined || block === null) {
    return fallback();
  }
  if (typeof block !== "object" || Array.isArray(block)) {
    return {
      config: { ...defaults, intervalFromConfig: false },
      invalid: true,
    };
  }
  // Snake_case keys, with camelCase tolerated like the plan caps.
  const pick = (snake, camel) =>
    block[snake] !== undefined ? block[snake] : block[camel];
  let invalid = false;
  let interval = defaults.interval;
  let intervalFromConfig = false;
  const rawInterval = pick("interval", "interval");
  if (rawInterval !== undefined && rawInterval !== null) {
    if (
      typeof rawInterval === "number" &&
      Number.isInteger(rawInterval) &&
      rawInterval >= 1 &&
      rawInterval <= 365
    ) {
      interval = rawInterval;
      intervalFromConfig = true;
    } else {
      invalid = true;
    }
  }
  // The canonical `rotten_daily_budget` wins by presence, including
  // an explicit null (budget off). The removed `stale_daily_budget`
  // still supplies the budget for one release; when both occur the
  // legacy value is warned about and ignored.
  const rawCanonical =
    block.rotten_daily_budget !== undefined
      ? block.rotten_daily_budget
      : block.rottenDailyBudget;
  const rawLegacy =
    block.stale_daily_budget !== undefined
      ? block.stale_daily_budget
      : block.staleDailyBudget;
  const legacyPresent = rawLegacy !== undefined && rawLegacy !== null;
  let budget = defaults.rottenDailyBudget;
  let deprecatedStaleBudget = false;
  const coerceBudget = (raw) =>
    typeof raw === "number" && Number.isInteger(raw) && raw >= 1
      ? raw
      : null;
  if (rawCanonical !== undefined) {
    if (rawCanonical !== null) {
      const coerced = coerceBudget(rawCanonical);
      if (coerced === null) {
        invalid = true;
      } else {
        budget = coerced;
      }
    }
    deprecatedStaleBudget = legacyPresent;
  } else if (rawLegacy !== undefined) {
    if (rawLegacy !== null) {
      const coerced = coerceBudget(rawLegacy);
      if (coerced === null) {
        invalid = true;
      } else {
        budget = coerced;
        deprecatedStaleBudget = true;
      }
    }
  }
  // Like Rust, any invalid value falls back to the full default block.
  if (invalid) {
    return {
      config: { ...defaults, intervalFromConfig: false },
      invalid: true,
    };
  }
  return {
    config: {
      interval,
      rottenDailyBudget: budget,
      intervalFromConfig,
      deprecatedStaleBudget,
    },
    invalid: false,
  };
}

// Read `freshness:` from `~/.config/bob/config.yml` (honoring
// XDG_CONFIG_HOME), with the same injectable options as `loadPlanCaps`.
// Mobile (no desktop `fs`) and a missing file fall back to the defaults.
// Returns `{ config, invalid, configPath }`; `invalid` is true only when
// the file was read but held a present-but-bad value.
function loadFreshnessConfig(options = {}) {
  const defaults = defaultFreshnessConfig();
  const freshDefaults = () => ({ ...defaults, intervalFromConfig: false });
  const configPath = options.configPath || planConfigPath(options);
  const platform = options.Platform === undefined ? Platform : options.Platform;
  if (platform && platform.isDesktopApp === false) {
    return { config: freshDefaults(), invalid: false, configPath };
  }
  const fsModule =
    options.fsModule === undefined
      ? planRequireOptionalNodeModule("fs")
      : options.fsModule;
  if (!fsModule || typeof fsModule.readFileSync !== "function") {
    return { config: freshDefaults(), invalid: false, configPath };
  }
  let rawConfig;
  try {
    rawConfig = fsModule.readFileSync(configPath, "utf8");
  } catch (error) {
    return {
      config: freshDefaults(),
      invalid: Boolean(error && error.code && error.code !== "ENOENT"),
      configPath,
    };
  }
  const yamlParser =
    options.parseYaml === undefined ? parseYaml : options.parseYaml;
  if (typeof yamlParser !== "function") {
    return { config: freshDefaults(), invalid: false, configPath };
  }
  let parsed;
  try {
    parsed = yamlParser(rawConfig);
  } catch (error) {
    return { config: freshDefaults(), invalid: true, configPath };
  }
  const coerced = coerceFreshnessConfig(freshnessBlock(parsed));
  return { config: coerced.config, invalid: coerced.invalid, configPath };
}

// --- Task freshness: evaluation ---------------------------------------------
// Computed at read time, never stored. Mirrors `state.rs`; both sides run
// the state (S) conformance vectors in `docs/freshness.md` verbatim.

// Parse a note's raw `task_refresh` frontmatter value: an integer 1-365
// (numbers stay numbers, quoted strings are unquoted), else a
// `task_refresh_invalid` lint that falls through to the next level.
function freshnessParseNoteRefresh(raw) {
  if (raw === undefined || raw === null) {
    return { days: null, lint: null };
  }
  const text = String(raw)
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (text === "") {
    return { days: null, lint: null };
  }
  if (!/^[+-]?\d+$/.test(text)) {
    return { days: null, lint: "task_refresh_invalid" };
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 365) {
    return { days: null, lint: "task_refresh_invalid" };
  }
  return { days: number, lint: null };
}

// Effective interval and where it came from: the task's `[refresh:: N]`,
// then the note's `task_refresh`, then `freshness.interval`, then 7.
function freshnessIntervalFor(taskDays, noteDays, config) {
  if (taskDays !== null && taskDays !== undefined) {
    return { days: taskDays, source: "task" };
  }
  if (noteDays !== null && noteDays !== undefined) {
    return { days: noteDays, source: "note" };
  }
  const interval =
    config && Number.isInteger(config.interval) ? config.interval : 7;
  const fromConfig =
    Boolean(config && config.intervalFromConfig) || interval !== 7;
  if (fromConfig) {
    return { days: interval, source: "config" };
  }
  return { days: 7, source: "default" };
}

function freshnessEvaluateValidScheduled(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatLocalDate(value);
  }
  return parseFreshDateStrict(String(value).trim());
}

// Evaluate one row for `todayText` under `config`. A row carries the
// caller-precomputed scope inputs:
//
//   { path, line (1-based), isTodo (Tasks status type TODO), recurring,
//     laneVisible (the NEXT/PENDING lane predicate), isDailyNote
//     (canonical YYYY/YYYYMMDD.md), isToday (Task Link under today's open
//     Pomodoros), scheduled (canonical date or null), rawLine (the task's
//     originalMarkdown), noteRefreshRaw (the note's raw `task_refresh`) }
//
// Returns `{ state ("new"|"resurfaced"|"rotten"|"fresh"|null; null is out
// of scope, see S13), fresh, intervalDays, intervalSource, dueOn,
// daysOverdue, lints }`.
function freshnessEvaluate(row, todayText, config) {
  const today = freshnessNormalizeDateText(todayText);
  const read = readFreshness(row.rawLine || "", today);
  const lints = [...read.lints];

  const note = freshnessParseNoteRefresh(row.noteRefreshRaw);
  if (note.lint) {
    freshnessPushLint(lints, note.lint);
  }

  const interval = freshnessIntervalFor(read.refresh, note.days, config);
  const fresh = read.fresh;

  const inScope =
    Boolean(row.isTodo) &&
    Boolean(row.laneVisible) &&
    !row.recurring &&
    !row.isDailyNote &&
    !row.isToday;

  if (!inScope) {
    return {
      state: null,
      fresh,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn: null,
      daysOverdue: null,
      lints,
    };
  }

  if (fresh === null) {
    return {
      state: "new",
      fresh: null,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn: null,
      daysOverdue: null,
      lints,
    };
  }

  // RESURFACED beats ROTTEN: a deferral that returned is due as soon as
  // it returns, however old the stamp is.
  const scheduled = freshnessEvaluateValidScheduled(row.scheduled);
  if (scheduled !== null && fresh < scheduled && scheduled <= today) {
    return {
      state: "resurfaced",
      fresh,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn: scheduled,
      daysOverdue: freshDateDiffDays(scheduled, today),
      lints,
    };
  }

  const dueOn = freshDateAddDays(fresh, interval.days);
  if (today >= dueOn) {
    return {
      state: "rotten",
      fresh,
      intervalDays: interval.days,
      intervalSource: interval.source,
      dueOn,
      daysOverdue: freshDateDiffDays(dueOn, today),
      lints,
    };
  }

  return {
    state: "fresh",
    fresh,
    intervalDays: interval.days,
    intervalSource: interval.source,
    dueOn,
    daysOverdue: null,
    lints,
  };
}

// One row's state: `"new"` | `"resurfaced"` | `"rotten"` | `"fresh"` |
// null (out of scope).
function freshnessState(row, todayText, config) {
  return freshnessEvaluate(row, todayText, config).state;
}

// Stable read-time bucket for dashboard gating (`docs/freshness.md`
// §4 in bob-cli): `"new"` surfaces in NEW, `"rotten"` (resurfaced or
// age-expired) surfaces in ROTTEN review, anything else (fresh or
// out of scope) has no bucket.
function freshnessBucketForState(state) {
  if (state === "new") {
    return "new";
  }
  if (state === "resurfaced" || state === "rotten") {
    return "rotten";
  }
  return null;
}

// Local day number for a canonical `YYYY-MM-DD` date text, parsed as a
// local calendar date (never UTC, so DST boundaries match the vault's
// local day). Null when the text is not a strict calendar date.
function freshnessDayNumberForDateText(dateText) {
  try {
    const text = parseFreshDateStrict(dateText);
    if (text === null) {
      return null;
    }
    const parts = text.split("-").map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
      return null;
    }
    return planDayNumber(new Date(parts[0], parts[1] - 1, parts[2]));
  } catch (error) {
    return null;
  }
}

function freshnessRowKey(row) {
  const path = String(row.path || "");
  if (row.blockId) {
    return path + "#" + row.blockId;
  }
  return path + ":" + row.line;
}

function freshnessTierForState(state) {
  if (state === "new") {
    return "1 · NEW";
  }
  if (state === "resurfaced" || state === "rotten") {
    return "2 · DUE";
  }
  return "";
}

// The review queue: NEW by (path, line), then DUE by (dueOn, path,
// line). Entries carry `{ key, path, line, lineNumber, text,
// originalMarkdown, blockId, state, tier, fresh, dueOn, daysOverdue,
// interval }` with 1-based `line` (Tasks' `lineNumber` is 0-based).
function freshnessQueue(rows, todayText, config) {
  const list = Array.isArray(rows) ? rows : [];
  const freshEntries = [];
  const dueEntries = [];
  for (const row of list) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const evaluated = freshnessEvaluate(row, todayText, config);
    if (evaluated.state === null || evaluated.state === "fresh") {
      continue;
    }
    const entry = {
      key: freshnessRowKey(row),
      path: String(row.path || ""),
      line: row.line,
      lineNumber:
        Number.isInteger(row.lineNumber) ? row.lineNumber : row.line - 1,
      text: typeof row.text === "string" ? row.text : "",
      originalMarkdown:
        typeof row.originalMarkdown === "string" ? row.originalMarkdown : "",
      blockId: row.blockId || null,
      state: evaluated.state,
      tier: freshnessTierForState(evaluated.state),
      fresh: evaluated.fresh,
      dueOn: evaluated.dueOn,
      daysOverdue: evaluated.daysOverdue,
      interval: evaluated.intervalDays,
    };
    if (evaluated.state === "new") {
      freshEntries.push(entry);
    } else {
      dueEntries.push(entry);
    }
  }

  freshEntries.sort(
    (left, right) =>
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0) ||
      left.line - right.line,
  );
  dueEntries.sort(
    (left, right) =>
      (left.dueOn < right.dueOn ? -1 : left.dueOn > right.dueOn ? 1 : 0) ||
      (left.path < right.path ? -1 : left.path > right.path ? 1 : 0) ||
      left.line - right.line,
  );

  const ordered = [...freshEntries, ...dueEntries];
  for (let index = 0; index < ordered.length; index += 1) {
    ordered[index].rank = index + 1;
  }
  return ordered;
}

function freshnessIsExcludedCountPath(path) {
  return String(path || "")
    .split("/")
    .some((segment) => segment === "_templates" || segment === "_conflicts");
}

// Whole-vault counts: `{ due, new, resurfaced, rotten, fresh,
// refreshedToday, budget, budgetMet }`. `refreshedToday` counts tasks of
// any status outside `_templates` / `_conflicts` whose `fresh` equals
// today.
function freshnessCounts(rows, todayText, config) {
  const today = freshnessNormalizeDateText(todayText);
  const list = Array.isArray(rows) ? rows : [];
  let due = 0;
  let freshNew = 0;
  let resurfaced = 0;
  let rotten = 0;
  let fresh = 0;
  let refreshedToday = 0;

  for (const row of list) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const evaluated = freshnessEvaluate(row, today, config);
    if (
      !freshnessIsExcludedCountPath(row.path) &&
      evaluated.fresh === today
    ) {
      refreshedToday += 1;
    }
    if (evaluated.state === "new") {
      freshNew += 1;
      due += 1;
    } else if (evaluated.state === "resurfaced") {
      resurfaced += 1;
      due += 1;
    } else if (evaluated.state === "rotten") {
      rotten += 1;
      due += 1;
    } else if (evaluated.state === "fresh") {
      fresh += 1;
    }
  }

  const rawBudget =
    config && config.rottenDailyBudget !== undefined
      ? config.rottenDailyBudget
      : null;
  const budget =
    Number.isInteger(rawBudget) && rawBudget >= 1 ? rawBudget : null;
  const budgetMet =
    budget !== null && refreshedToday >= budget && freshNew === 0;

  return {
    due,
    new: freshNew,
    resurfaced,
    rotten,
    fresh,
    refreshedToday,
    budget,
    budgetMet,
  };
}

const FRESHNESS_LINT_MESSAGES = {
  fresh_malformed: "fresh date is not a YYYY-MM-DD calendar date",
  fresh_future: "fresh date is in the future",
  fresh_duplicate: "more than one fresh field; the latest valid date wins",
  fresh_misplaced:
    "fresh/refresh sits inside the Tasks suffix; the next stamp repairs it",
  refresh_invalid: "refresh is not an integer 1-365",
  task_refresh_invalid: "task_refresh is not an integer 1-365",
  freshness_stale_daily_budget_deprecated:
    "freshness.stale_daily_budget is deprecated; use freshness.rotten_daily_budget",
};

// Per-occurrence lints in row order: `{ code, path, line, message }`.
function freshnessCollectLints(rows, todayText, config) {
  const today = freshnessNormalizeDateText(todayText);
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const evaluated = freshnessEvaluate(row, today, config);
    for (const code of evaluated.lints) {
      out.push({
        code,
        path: String(row.path || ""),
        line: row.line,
        message: FRESHNESS_LINT_MESSAGES[code] || code,
      });
    }
  }
  return out;
}

// Pure view-model for the status bar counter. `counts` is a
// `freshnessCounts` result; `mostOverdue` is the queue's largest
// `daysOverdue` (or null when nothing is due).
function freshnessStatusView(counts, options = {}) {
  const tasksAvailable = options.tasksAvailable !== false;
  if (!tasksAvailable) {
    return {
      text: "⟳ –",
      tooltip: "Tasks unavailable",
      mode: "unavailable",
    };
  }
  const safe = counts || {};
  const due = safe.due || 0;
  const freshNew = safe.new || 0;
  const resurfaced = safe.resurfaced || 0;
  const ageExpired = safe.rotten || 0;
  const rotten = resurfaced + ageExpired;
  const refreshed = safe.refreshedToday || 0;
  const budget =
    Number.isInteger(safe.budget) && safe.budget >= 1 ? safe.budget : null;
  const meter = budget !== null ? refreshed + "/" + budget : String(refreshed);
  const text =
    "⟳ " +
    freshNew +
    " new · " +
    rotten +
    " rotten · ✓ " +
    meter +
    " today";
  const mostOverdue =
    Number.isInteger(options.mostOverdue) && options.mostOverdue >= 0
      ? options.mostOverdue
      : null;
  const tooltip =
    "NEW " +
    freshNew +
    " · RETURNED " +
    resurfaced +
    " · ROTTEN " +
    ageExpired +
    (mostOverdue === null
      ? " · nothing due"
      : " · oldest " + mostOverdue + "d overdue") +
    " · ✓ " +
    meter +
    " today";
  let mode = "due";
  if (safe.budgetMet) {
    mode = "budget";
  } else if (due === 0) {
    mode = "clear";
  } else if (freshNew > 0) {
    mode = "new";
  }
  return { text, tooltip, mode };
}

// Unavailable NEW/ROTTEN review model: explicit nulls, never a zero
// that could read as an empty success.
function freshnessReviewUnavailable() {
  return {
    available: false,
    new: null,
    returned: null,
    rotten: null,
    refreshedToday: null,
    budget: null,
    budgetMet: false,
    meter: "✓ –",
    severity: "unavailable",
    escalated: false,
    oldestDaysOverdue: null,
    tooltip: "Review unavailable",
    newText: "NEW –",
    rottenText: "ROTTEN –",
  };
}

// Shared NEW/ROTTEN view-model from one freshness snapshot. `counts`
// is a `freshnessCounts` result and `queue` a `freshnessQueue` result
// over the same rows. The ROTTEN total includes RETURNED; escalation
// is per-row (`daysOverdue >= interval` for that row), never the
// confirmation age or the global default. Never throws.
function freshnessReviewModel(counts, queue) {
  try {
    const safe = counts || {};
    const freshNew =
      Number.isInteger(safe.new) && safe.new >= 0 ? safe.new : 0;
    const resurfaced =
      Number.isInteger(safe.resurfaced) && safe.resurfaced >= 0
        ? safe.resurfaced
        : 0;
    const ageExpired =
      Number.isInteger(safe.rotten) && safe.rotten >= 0 ? safe.rotten : 0;
    const rotten = resurfaced + ageExpired;
    const refreshed =
      Number.isInteger(safe.refreshedToday) && safe.refreshedToday >= 0
        ? safe.refreshedToday
        : 0;
    const budget =
      Number.isInteger(safe.budget) && safe.budget >= 1 ? safe.budget : null;
    const budgetMet = Boolean(safe.budgetMet);
    let oldest = null;
    let escalated = false;
    for (const entry of Array.isArray(queue) ? queue : []) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      if (entry.state !== "resurfaced" && entry.state !== "rotten") {
        continue;
      }
      if (Number.isInteger(entry.daysOverdue) && entry.daysOverdue >= 0) {
        if (oldest === null || entry.daysOverdue > oldest) {
          oldest = entry.daysOverdue;
        }
        if (
          Number.isInteger(entry.interval) &&
          entry.interval >= 1 &&
          entry.daysOverdue >= entry.interval
        ) {
          escalated = true;
        }
      }
    }
    const meter =
      budget !== null ? refreshed + "/" + budget : String(refreshed);
    // NEW is red above 0; ROTTEN is neutral at 0, orange above 0, red
    // once any returned or age-expired row is a full interval overdue.
    const severity =
      freshNew > 0 ? "new" : escalated ? "escalated" : rotten > 0 ? "rotten" : "none";
    const tooltip =
      "ROTTEN " +
      rotten +
      " = " +
      resurfaced +
      " returned + " +
      ageExpired +
      " rotten · oldest " +
      (oldest === null ? "–" : oldest + "d") +
      " overdue · ✓ " +
      meter +
      " today";
    return {
      available: true,
      new: freshNew,
      returned: resurfaced,
      rotten,
      refreshedToday: refreshed,
      budget,
      budgetMet,
      meter: "✓ " + meter,
      severity,
      escalated,
      oldestDaysOverdue: oldest,
      tooltip,
      newText: "NEW " + freshNew,
      rottenText: "ROTTEN " + rotten + " · ✓ " + meter,
    };
  } catch (error) {
    return freshnessReviewUnavailable();
  }
}

// --- Task freshness: display mark (mark-core) -------------------------------
// Owned by `docs/freshness.md` §§11-12 in bob-cli. Pure helpers only:
// source detection, resolution, model, consensus, tooltip dates, and a
// listener-free DOM builder. Every helper is synchronous and never
// throws; bad input yields null (or the unresolved model for the model
// builder). Reuses `freshnessInlineFields`, `readFreshness`,
// `freshnessTaskStatus`, `parseFreshDateStrict`, `freshDateDiffDays`,
// `freshDateAddDays`, `freshnessParseRefreshValue`, `freshnessIntervalFor`,
// `freshnessParseNoteRefresh`, and `freshnessEvaluate` above.

const FRESHNESS_MARK_WEEKDAYS = [
  "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
];

const FRESHNESS_MARK_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const FRESHNESS_MARK_CLOSED_REASONS = {
  x: "Done",
  X: "Done",
  "-": "Cancelled",
};

const FRESHNESS_MARK_STATUS_REASONS = {
  "*": "Next",
  "/": "In Progress",
  "?": "Blocked",
  x: "Done",
  X: "Done",
  "-": "Cancelled",
};

// The single folded `[refresh:: N]` after a fresh field, or null when the
// line's refresh field is absent, paren-wrapped, non-adjacent, duplicated,
// or invalid. Never throws.
function freshnessMarkFoldRefresh(text, freshField) {
  try {
    const fields = freshnessInlineFields(text, "refresh");
    if (fields.length !== 1) {
      return null;
    }
    const field = fields[0];
    if (text[field.start] !== "[") {
      return null;
    }
    if (field.start !== freshField.end + 1 || text[freshField.end] !== " ") {
      return null;
    }
    const days = freshnessParseRefreshValue(field.value);
    if (days === null) {
      return null;
    }
    return { field, days };
  } catch (error) {
    return null;
  }
}

// Shared core for both source detectors: one square-bracketed fresh field
// with a strict, non-future date, plus adjacent refresh folding. Returns
// the fresh field and fold, or null. Never throws.
function freshnessMarkSourceCore(text, today) {
  try {
    const freshFields = freshnessInlineFields(text, "fresh");
    if (freshFields.length !== 1) {
      return null;
    }
    const freshField = freshFields[0];
    if (text[freshField.start] !== "[") {
      return null;
    }
    const date = parseFreshDateStrict(freshField.value.trim());
    if (date === null || date > today) {
      return null;
    }
    const fold = freshnessMarkFoldRefresh(text, freshField);
    return { freshField, fold, date };
  } catch (error) {
    return null;
  }
}

// A Live Preview task line's mark source, or null when the line gets no
// mark. `fieldStart`/`fieldEnd` are UTF-16 offsets of the folded field
// text, excluding the folded space. Never throws.
function freshnessMarkSource(line, todayText) {
  try {
    if (typeof line !== "string") {
      return null;
    }
    if (freshnessTaskStatus(line) === null) {
      return null;
    }
    const today = freshnessNormalizeDateText(todayText);
    const core = freshnessMarkSourceCore(line, today);
    if (core === null) {
      return null;
    }
    const read = readFreshness(line, today);
    if (read.fresh === null || read.fresh !== core.date) {
      return null;
    }
    for (const lint of [
      "fresh_malformed",
      "fresh_future",
      "fresh_duplicate",
      "fresh_misplaced",
    ]) {
      if (read.lints.includes(lint)) {
        return null;
      }
    }
    const fieldEnd =
      core.fold === null ? core.freshField.end : core.fold.field.end;
    const fieldStart = core.freshField.start;
    return {
      fieldStart,
      fieldEnd,
      foldSpace: fieldStart > 0 && line[fieldStart - 1] === " ",
      text: line.slice(fieldStart, fieldEnd),
      fresh: core.date,
      refresh: core.fold === null ? null : core.fold.days,
    };
  } catch (error) {
    return null;
  }
}

// A rendered-view text node's mark source (`foldSpace` never applies, so
// it is omitted). Skips the task-line and misplaced checks because Tasks
// may have split off the suffix. Never throws.
function freshnessMarkSourceInText(text, todayText) {
  try {
    if (typeof text !== "string") {
      return null;
    }
    const today = freshnessNormalizeDateText(todayText);
    const core = freshnessMarkSourceCore(text, today);
    if (core === null) {
      return null;
    }
    const fieldEnd =
      core.fold === null ? core.freshField.end : core.fold.field.end;
    const fieldStart = core.freshField.start;
    return {
      fieldStart,
      fieldEnd,
      text: text.slice(fieldStart, fieldEnd),
      fresh: core.date,
      refresh: core.fold === null ? null : core.fold.days,
    };
  } catch (error) {
    return null;
  }
}

// Fixed English short date from the UTC calendar date, so tooltips are
// deterministic across time zones. Appends the year only when it differs
// from today's year. Never throws: bad input yields null.
function freshnessShortDate(dateText, todayText) {
  try {
    const date = parseFreshDateStrict(String(dateText || ""));
    const today = parseFreshDateStrict(String(todayText || ""));
    if (date === null || today === null) {
      return null;
    }
    const day = new Date(freshDateToUtc(date));
    if (Number.isNaN(day.getTime())) {
      return null;
    }
    const base =
      FRESHNESS_MARK_WEEKDAYS[day.getUTCDay()] +
      ", " +
      FRESHNESS_MARK_MONTHS[Number(date.slice(5, 7)) - 1] +
      " " +
      String(Number(date.slice(8, 10)));
    return date.slice(0, 4) === today.slice(0, 4)
      ? base
      : base + ", " + date.slice(0, 4);
  } catch (error) {
    return null;
  }
}

// The out-of-scope reason for a resolved-but-out-of-scope row, in the
// documented order. Reads the row's `isToday`, `isDailyNote`,
// `recurring`, `_templates`/`_conflicts` path segments, and `scheduled`
// (only when after today). Never throws.
function freshnessMarkReason(status, row, today) {
  try {
    if (
      status !== null &&
      status !== undefined &&
      status !== " " &&
      Object.hasOwn(FRESHNESS_MARK_STATUS_REASONS, status)
    ) {
      return FRESHNESS_MARK_STATUS_REASONS[status];
    }
    if (status !== null && status !== undefined && status !== " ") {
      return "status [" + status + "]";
    }
    const safe = row && typeof row === "object" ? row : {};
    if (safe.isToday) {
      return "linked today";
    }
    if (safe.isDailyNote) {
      return "in a daily note";
    }
    if (safe.recurring) {
      return "recurring";
    }
    if (
      String(safe.path || "")
        .split("/")
        .some(
          (segment) => segment === "_templates" || segment === "_conflicts",
        )
    ) {
      return "in _templates or _conflicts";
    }
    const scheduled = freshnessEvaluateValidScheduled(safe.scheduled);
    if (scheduled !== null && scheduled > today) {
      return (
        "scheduled for " + (freshnessShortDate(scheduled, today) || scheduled)
      );
    }
    return "hidden or dependency-blocked";
  } catch (error) {
    return "hidden or dependency-blocked";
  }
}

// Wrap `freshnessEvaluate` for one memo row: `{ state, dueOn,
// scheduled, status, reason, intervalDays, intervalSource }`, where a
// null `state` means out of scope and `reason` is set only then. An
// evaluator `"new"` is treated as unresolved (null). Never throws.
function freshnessMarkResolution(row, todayText, config) {
  try {
    if (!row || typeof row !== "object") {
      return null;
    }
    const today = freshnessNormalizeDateText(todayText);
    const evaluated = freshnessEvaluate(row, today, config);
    if (evaluated.state === "new") {
      return null;
    }
    const status = freshnessTaskStatus(row.rawLine || "");
    const reason =
      evaluated.state === null
        ? freshnessMarkReason(status, row, today)
        : null;
    return {
      state: evaluated.state,
      dueOn: evaluated.dueOn,
      scheduled: freshnessEvaluateValidScheduled(row.scheduled),
      status,
      reason,
      intervalDays: evaluated.intervalDays,
      intervalSource: evaluated.intervalSource,
    };
  } catch (error) {
    return null;
  }
}

function freshnessMarkEveryPhrase(days, source) {
  const head = days === 1 ? "every 1 day" : "every " + days + " days";
  if (source === "task") {
    return head + " (this task)";
  }
  if (source === "note") {
    return head + " (this note)";
  }
  if (source === "config") {
    return head + " (config)";
  }
  return head;
}

function freshnessMarkValidInterval(input) {
  if (
    input &&
    typeof input === "object" &&
    Number.isSafeInteger(input.days) &&
    input.days >= 1 &&
    input.days <= 365
  ) {
    return { days: input.days, source: input.source || "default" };
  }
  return { days: 7, source: "default" };
}

// The render model for one mark: `{ text, fresh, ageDays, label,
// intervalDays, intervalSource, intervalLabel, remaining, tone, glyph
// ("check" | "ring" | "refresh"), resolved, tooltip }`. When resolved
// the model uses the resolution's interval, otherwise `input.interval`.
// Bad sources yield null. Never throws.
function freshnessMarkModel(input) {
  try {
    const args = input && typeof input === "object" ? input : null;
    if (args === null || !args.source || typeof args.source !== "object") {
      return null;
    }
    const source = args.source;
    const today = freshnessNormalizeDateText(args.today);
    const fresh = parseFreshDateStrict(String(source.fresh || ""));
    if (fresh === null) {
      return null;
    }
    const ageDays = freshDateDiffDays(fresh, today);
    if (!Number.isSafeInteger(ageDays) || ageDays < 0) {
      return null;
    }
    const resolution =
      args.resolution !== undefined && args.resolution !== null
        ? args.resolution
        : null;
    const interval = resolution
      ? freshnessMarkValidInterval({
          days: resolution.intervalDays,
          source: resolution.intervalSource,
        })
      : freshnessMarkValidInterval(args.interval);
    const status =
      args.status !== undefined && args.status !== null
        ? args.status
        : resolution && resolution.status !== undefined
          ? resolution.status
          : null;
    const closed =
      status === "x" || status === "X" || status === "-";
    const state = resolution ? resolution.state : null;
    let tone;
    if (closed) {
      tone = "resting";
    } else if (state === "rotten" || state === "resurfaced") {
      tone = "due";
    } else if (ageDays === 0) {
      tone = "today";
    } else if (resolution && state === null) {
      tone = "resting";
    } else {
      tone = "aging";
    }
    const glyph = tone === "today" ? "check" : tone === "due" ? "refresh" : "ring";
    const remaining =
      Math.round(
        (Math.min(Math.max((interval.days - ageDays) / interval.days, 0), 1) *
          10000),
      ) / 10000;
    const intervalLabel =
      source.refresh !== null &&
      source.refresh !== undefined &&
      tone !== "today"
        ? "/" + source.refresh + "d"
        : null;
    const shortFresh = freshnessShortDate(fresh, today) || fresh;
    const relative =
      ageDays === 0
        ? "today"
        : ageDays === 1
          ? "yesterday"
          : ageDays + " days ago";
    const line1 =
      ageDays === 0
        ? "Confirmed today"
        : "Confirmed " + shortFresh + " · " + relative;
    const every = freshnessMarkEveryPhrase(interval.days, interval.source);
    let line2;
    if (
      closed ||
      (resolution && resolution.state === null)
    ) {
      const reason = closed
        ? FRESHNESS_MARK_CLOSED_REASONS[status] || "status [" + status + "]"
        : resolution.reason || "hidden or dependency-blocked";
      line2 = "Not in the review queue: " + reason;
    } else if (resolution && resolution.state === "rotten") {
      const dueOn = freshnessShortDate(resolution.dueOn, today) || resolution.dueOn;
      line2 = "Due for review since " + dueOn + " · " + every;
    } else if (resolution && resolution.state === "resurfaced") {
      const when =
        freshnessShortDate(resolution.scheduled, today) ||
        resolution.scheduled ||
        resolution.dueOn;
      line2 = "Resurfaced " + when + ": scheduled after it was confirmed";
    } else {
      const next = freshDateAddDays(fresh, interval.days);
      const shortNext = freshnessShortDate(next, today) || next;
      line2 =
        today >= next
          ? "Review lease ended " + shortNext + " · " + every
          : "Next review " + shortNext + " · " + every;
    }
    const tooltip =
      tone === "due" ? line1 + "\n" + line2 + "\nAlt+F to confirm" : line1 + "\n" + line2;
    return {
      text: source.text,
      fresh,
      ageDays,
      label: ageDays === 0 ? "today" : ageDays + "d",
      intervalDays: interval.days,
      intervalSource: interval.source,
      intervalLabel,
      remaining,
      tone,
      glyph,
      resolved: resolution !== null,
      tooltip,
    };
  } catch (error) {
    return null;
  }
}

// Consensus across candidate models: the model when at least one
// candidate exists and all are deep-equal, else null. Never throws.
function freshnessMarkConsensus(models) {
  try {
    if (!Array.isArray(models) || models.length === 0) {
      return null;
    }
    const first = JSON.stringify(models[0]);
    for (const model of models) {
      if (JSON.stringify(model) !== first) {
        return null;
      }
    }
    return models[0] === null || models[0] === undefined ? null : models[0];
  } catch (error) {
    return null;
  }
}

// Listener-free mark element, so it survives Dataview's innerHTML
// round-trip. `doc` provides `createElement`, `createElementNS`, and
// `createTextNode` so tests can pass a fake document. Never throws:
// bad input yields null.
function buildFreshnessMarkElement(doc, model, options) {
  try {
    if (!doc || !model || typeof model !== "object") {
      return null;
    }
    const foldSpace = Boolean(options && options.foldSpace);
    const tone = model.tone;
    if (tone !== "today" && tone !== "aging" && tone !== "due" && tone !== "resting") {
      return null;
    }
    const span = doc.createElement("span");
    span.setAttribute("class", "bob-fresh-mark");
    span.setAttribute("data-tone", tone);
    span.setAttribute("data-resolved", model.resolved ? "true" : "false");
    span.setAttribute("data-fold-space", foldSpace ? "true" : "false");
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", String(model.tooltip || ""));
    span.setAttribute("data-tooltip-position", "top");
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "bob-fresh-mark-glyph");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const track = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "bob-fresh-mark-track");
    track.setAttribute("cx", "8");
    track.setAttribute("cy", "8");
    track.setAttribute("r", "6");
    if (model.glyph === "check") {
      track.setAttribute("opacity", "1");
      svg.appendChild(track);
      const tick = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      tick.setAttribute("d", "M5.4 8.2l1.8 1.8 3.4-3.6");
      svg.appendChild(tick);
    } else if (model.glyph === "refresh") {
      const arc = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      arc.setAttribute(
        "d",
        "M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.33",
      );
      svg.appendChild(arc);
      const head = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      head.setAttribute("d", "M14 2v3.33h-3.33");
      svg.appendChild(head);
    } else {
      svg.appendChild(track);
      if (model.remaining > 0) {
        const arc = doc.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        arc.setAttribute("class", "bob-fresh-mark-arc");
        arc.setAttribute("cx", "8");
        arc.setAttribute("cy", "8");
        arc.setAttribute("r", "6");
        arc.setAttribute("pathLength", "100");
        arc.setAttribute(
          "stroke-dasharray",
          (model.remaining * 100).toFixed(2) + " 100",
        );
        arc.setAttribute("transform", "rotate(-90 8 8)");
        svg.appendChild(arc);
      }
    }
    span.appendChild(svg);
    const label = doc.createElement("span");
    label.setAttribute("class", "bob-fresh-mark-label");
    label.appendChild(doc.createTextNode(String(model.label || "")));
    span.appendChild(label);
    if (model.intervalLabel !== null && model.intervalLabel !== undefined) {
      const suffix = doc.createElement("span");
      suffix.setAttribute("class", "bob-fresh-mark-interval");
      suffix.appendChild(doc.createTextNode(String(model.intervalLabel)));
      span.appendChild(suffix);
    }
    return span;
  } catch (error) {
    return null;
  }
}

// Whether a CodeMirror position sits inside code: the syntax node at
// the position, or any ancestor, is a codeblock (mirroring Dataview's
// `HyperMD-codeblock` check) or inline code. Missing trees never throw
// and never match. Pure helper for the Live Preview decoration.
function freshnessMarkPosInCode(tree, pos) {
  try {
    if (!tree || typeof tree.resolveInner !== "function") {
      return false;
    }
    let node = tree.resolveInner(pos, -1);
    while (node) {
      const name = node.name || "";
      if (
        name === "HyperMD-codeblock" ||
        name.indexOf("inline-code") !== -1
      ) {
        return true;
      }
      node = node.parent;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Live Preview click widget for one freshness mark. `eq` compares a key
// built from `JSON.stringify(model)` plus `foldSpace`, so an unchanged
// mark never flickers. `toDOM` builds the listener-free element and adds
// the reveal-on-click listener only. Defined only when `WidgetType`
// exists; otherwise null and the extension is not registered.
let FreshnessMarkWidget = null;
if (WidgetType && typeof WidgetType === "function") {
  FreshnessMarkWidget = class extends WidgetType {
    constructor(model, foldSpace) {
      super();
      this.model = model;
      this.foldSpace = Boolean(foldSpace);
      let key = "";
      try {
        key = JSON.stringify(model) + "|" + (this.foldSpace ? "1" : "0");
      } catch (error) {
        key = String(model && model.text) + "|" + (this.foldSpace ? "1" : "0");
      }
      this.key = key;
    }

    eq(other) {
      return (
        Boolean(other) &&
        other instanceof FreshnessMarkWidget &&
        other.key === this.key
      );
    }

    toDOM(view) {
      const dom = buildFreshnessMarkElement(
        typeof document !== "undefined" ? document : null,
        this.model,
        { foldSpace: this.foldSpace },
      );
      // In tests `document` is undefined and the caller passes a fake
      // doc via `buildFreshnessMarkElement` directly; never throw here.
      if (!dom) {
        const fallback =
          typeof document !== "undefined" && document
            ? document.createElement("span")
            : null;
        return fallback;
      }
      try {
        const self = this;
        dom.addEventListener("mousedown", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
            let anchor = null;
            try {
              anchor =
                view && typeof view.posAtDOM === "function"
                  ? view.posAtDOM(dom)
                  : null;
            } catch (error) {
              anchor = null;
            }
            if (typeof anchor === "number") {
              view.dispatch({
                selection: { anchor: anchor + (self.foldSpace ? 1 : 0) },
              });
            }
            if (view && typeof view.focus === "function") {
              view.focus();
            }
          } catch (error) {
            // Reveal is best-effort; the mark itself still renders.
          }
        });
      } catch (error) {
        // A listener-free mark still renders.
      }
      return dom;
    }
  };
}

// Adapt one Tasks-plugin task to a freshness evaluation row. `context`
// is `{ list, todayDay, noteRefreshRawFor(path), isToday(task) }`.
// Never throws: missing fields degrade to an out-of-scope row.
function freshnessRowFromTask(task, index, context) {
  const safeContext = context || {};
  const list = Array.isArray(safeContext.list) ? safeContext.list : [];
  const fallbackLine =
    Number.isInteger(index) && index >= 0 ? index + 1 : 1;
  try {
    if (!task || typeof task !== "object") {
      return {
        path: "",
        line: fallbackLine,
        lineNumber: fallbackLine - 1,
        text: "",
        originalMarkdown: "",
        blockId: null,
        isTodo: false,
        recurring: false,
        laneVisible: false,
        isDailyNote: false,
        isToday: false,
        scheduled: null,
        rawLine: "",
        noteRefreshRaw: undefined,
      };
    }
    const path = planTaskPath(task) || "";
    const lineNumber = Number.isInteger(task.lineNumber)
      ? task.lineNumber
      : fallbackLine - 1;
    const description = planTaskDescription(task);
    const rawLine =
      typeof task.originalMarkdown === "string"
        ? task.originalMarkdown
        : typeof description === "string"
          ? description
          : "";
    const statusType =
      task.status && typeof task.status === "object"
        ? task.status.type
        : undefined;
    const isTodo =
      typeof statusType === "string"
        ? statusType === "TODO"
        : planTaskStatusSymbol(task) === " ";
    const recurring =
      Boolean(task.recurrence) ||
      task.isRecurring === true ||
      task.recurring === true ||
      freshnessHasRepeatField(rawLine);
    let laneVisible = false;
    try {
      laneVisible = Boolean(
        planLaneVisible(task, list, safeContext.todayDay ?? null),
      );
    } catch (error) {
      laneVisible = false;
    }
    const isDailyNote = PLAN_DAILY_PATH_RE.test(path);
    let isToday = false;
    try {
      isToday =
        typeof safeContext.isToday === "function"
          ? Boolean(safeContext.isToday(task))
          : false;
    } catch (error) {
      isToday = false;
    }
    let scheduled = null;
    try {
      for (const key of ["scheduledDate", "scheduled", "scheduledDay"]) {
        if (task[key] === undefined || task[key] === null) {
          continue;
        }
        const day = planDayNumber(task[key]);
        if (day === null) {
          continue;
        }
        const coerced = planCoerceDate(task[key]);
        if (coerced) {
          scheduled = formatLocalDate(coerced);
          break;
        }
      }
      if (scheduled === null) {
        const fields = freshnessInlineFields(rawLine, "scheduled");
        for (const field of fields) {
          const parsed = parseFreshDateStrict(field.value.trim());
          if (parsed !== null) {
            scheduled = parsed;
            break;
          }
        }
      }
    } catch (error) {
      scheduled = null;
    }
    let noteRefreshRaw = undefined;
    try {
      noteRefreshRaw =
        typeof safeContext.noteRefreshRawFor === "function"
          ? safeContext.noteRefreshRawFor(path)
          : undefined;
    } catch (error) {
      noteRefreshRaw = undefined;
    }
    return {
      path,
      line: lineNumber + 1,
      lineNumber,
      text: typeof description === "string" ? description : "",
      originalMarkdown: rawLine,
      blockId: planTaskBlockId(task),
      isTodo,
      recurring,
      laneVisible,
      isDailyNote,
      isToday,
      scheduled,
      rawLine,
      noteRefreshRaw,
    };
  } catch (error) {
    return {
      path: "",
      line: fallbackLine,
      lineNumber: fallbackLine - 1,
      text: "",
      originalMarkdown: "",
      blockId: null,
      isTodo: false,
      recurring: false,
      laneVisible: false,
      isDailyNote: false,
      isToday: false,
      scheduled: null,
      rawLine: "",
      noteRefreshRaw: undefined,
    };
  }
}

// True when the review-relevant snapshot changed: queue order/keys
// or any row's state. A bucket/state change notifies even when the due
// key set is unchanged. Never throws.
function freshnessMemoReviewChanged(
  previousDueKeys,
  previousEvaluated,
  next,
) {
  try {
    const dueKeys = (next && Array.isArray(next.dueKeys)) ? next.dueKeys : [];
    const previous = Array.isArray(previousDueKeys) ? previousDueKeys : [];
    if (previous.length !== dueKeys.length) {
      return true;
    }
    if (previous.some((key, index) => key !== dueKeys[index])) {
      return true;
    }
    const current =
      next && next.evaluatedByKey instanceof Map
        ? next.evaluatedByKey
        : null;
    if (!(previousEvaluated instanceof Map) || current === null) {
      return true;
    }
    if (previousEvaluated.size !== current.size) {
      return true;
    }
    for (const [key, value] of current) {
      const before = previousEvaluated.get(key);
      if (!before || before.state !== value.state) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return true;
  }
}

// __FRESHNESS_A2_END__
// __FRESHNESS_A1_END__

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
    // Task freshness (api v3, freshness namespace v3): memoized
    // review queue plus status bar.
    this.freshnessMemo = null;
    this.freshnessFrontGen = 0;
    // Freshness config snapshot cache (`{ path, statKey, checkedAt,
    // config, invalid }`): the file is stat-checked at most once per
    // 60-second tick and reparsed only on change.
    this.freshnessConfigCache = null;
    // Tasks cache generation observed by this plugin: bumped on every
    // `obsidian-tasks-plugin:cache-update`, so a cache update that
    // reuses the same array object still invalidates the memo.
    this.freshnessTasksGen = 0;
    // Shared NEW/ROTTEN review chips (dashboard and rotten summary use
    // the same live models). Mirrors `readyWidgets` below.
    this.reviewWidgets = new Set();
    this.reviewRefreshTimer = null;
    this.freshnessFrontValues = new Map();
    this.freshnessStatusTimer = null;
    this.freshnessStatusEl = null;
    // Freshness marks (mark-surfaces): session toggle plus a
    // filesystem-free cached snapshot refreshed on the status bar paths.
    this.freshnessMarksEnabled = true;
    this.freshnessMarkSnapshot = null;
    this.freshnessMarksTimer = null;

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
    // Shared READY backlog widgets (daily `bob-plan` chips and dashboard
    // `renderReadyBadge` anchors). Reuses one batch state so reopening a
    // note never accumulates widgets, listeners, or timers.
    this.readyWidgets = new Set();
    this.readyRefreshTimer = null;
    this.readyLastCapsKey = null;
    this.readyLastDay = null;
    this.planPaintGen = 0;
    this.planPaintGens = new Map();
    // Synchronous Today cache: `{ date, dailyPath, keys, rank }`. Built
    // from the daily note's text (never awaited inside the api); before
    // the first build `isToday` returns false for every task.
    this.todayCache = { date: null, dailyPath: null, keys: [], rank: new Map() };
    this.api = Object.freeze({
      version: 3,
      caps: () => loadPlanCaps().caps,
      planBudget: (options = {}) => this.planBudgetForCallers(options),
      todayKeys: () => this.todayKeys(),
      isToday: (task) => this.isTodayTask(task),
      todayRank: (task) => this.todayRankOfTask(task),
      nextBudget: () => {
        const { caps } = loadPlanCaps();
        return laneBudgetFromTasks(
          planBlockTasks(this.app) || [],
          new Date(),
          caps,
          "next",
        );
      },
      pendingBudget: () => {
        const { caps } = loadPlanCaps();
        return laneBudgetFromTasks(
          planBlockTasks(this.app) || [],
          new Date(),
          caps,
          "pending",
        );
      },
      readyBudget: () => this.readyBudget(),
      renderReadyBadge: (parent, options = {}) =>
        this.renderReadyBadge(parent, options),
      renderReviewChip: (parent, options = {}) =>
        this.renderReviewChip(parent, options),
      // Task freshness (freshness namespace v3: `state`/`counts`/
      // `config` use the rotten vocabulary; the removed
      // `stale_daily_budget` key still parses for one release with a
      // deprecation lint. Top-level api stays v3).
      // `freshness` mirrors `docs/freshness.md` §4 in bob-cli. Every
      // member is synchronous, never awaits and never throws. Missing
      // or old freshness namespaces degrade vault queries to the
      // legacy READY visibility: guard calls with try/catch as well as
      // optional chaining, since optional chaining alone does not
      // catch a throwing api.
      freshness: Object.freeze({
        version: 3,
        config: () => this.apiFreshnessConfig(),
        stampLine: (line, dateText) =>
          this.apiFreshnessStampLine(line, dateText),
        setRefreshLine: (line, days, dateText) =>
          this.apiFreshnessSetRefreshLine(line, days, dateText),
        state: (task) => this.apiFreshnessState(task),
        bucket: (task) => this.apiFreshnessBucket(task),
        reviewModel: () => this.freshnessReviewModel(),
        isDue: (task) => this.apiFreshnessIsDue(task),
        tier: (task) => this.apiFreshnessTier(task),
        rank: (task) => this.apiFreshnessRank(task),
        intervalFor: (task) => this.apiFreshnessIntervalFor(task),
        queue: () => this.apiFreshnessQueue(),
        counts: () => this.apiFreshnessCounts(),
        lints: () => this.apiFreshnessLints(),
      }),
    });
    if (typeof this.registerMarkdownCodeBlockProcessor === "function") {
      this.registerMarkdownCodeBlockProcessor("bob-plan", (source, el, ctx) =>
        this.renderPlanBlock(el, ctx),
      );
    }
    const metadataCache = this.app && this.app.metadataCache;
    if (metadataCache && typeof metadataCache.on === "function") {
      this.registerEvent(
        metadataCache.on("changed", (file, data) => {
          this.schedulePlanBlockRerenderForFile(file);
          this.refreshTodayCacheForChangedFile(file, data);
          this.refreshFreshnessForChangedFile(file, data);
        }),
      );
      this.registerEvent(
        metadataCache.on("resolved", () => this.refreshTodayCacheFromDaily()),
      );
    }
    const vault = this.app && this.app.vault;
    if (vault && typeof vault.on === "function") {
      for (const event of ["create", "delete", "rename"]) {
        this.registerEvent(
          vault.on(event, (file) => this.refreshTodayCacheForVaultEvent(file)),
        );
      }
    }
    if (
      typeof this.registerInterval === "function" &&
      typeof window !== "undefined" &&
      typeof window.setInterval === "function"
    ) {
      // Local-midnight rollover: rebuild once the daily path changes.
      // The same minute tick picks up a changed `max_ready` (or day)
      // within 60 seconds without a plugin reload or a per-badge poller,
      // and refreshes READY even when no daily note exists and the Today
      // key set remains empty.
      this.registerInterval(
        window.setInterval(() => {
          const rolled = this.refreshTodayCacheForRollover();
          this.refreshFreshnessForRollover();
          const capsChanged = this.checkReadyCapsAndDay(new Date());
          if (!rolled && !capsChanged) {
            try {
              this.refreshReadyBadges(new Date());
            } catch (error) {
              // Best-effort refresh only.
            }
          }
          // Calendar-derived labels and escalation refresh each day
          // even when every due task remains due.
          try {
            this.refreshReviewChips(new Date());
          } catch (error) {
            // Best-effort refresh only.
          }
        }, 60 * 1000),
      );
    }
    const planWorkspace = this.app && this.app.workspace;
    if (planWorkspace && typeof planWorkspace.on === "function") {
      // The vault runs Tasks 8.4.0, which fires this on every cache update.
      // A Ready task being linked or unlinked from Today refreshes both
      // badges even if its checkbox has not yet reconciled.
      this.registerEvent(
        planWorkspace.on("obsidian-tasks-plugin:cache-update", () => {
          // Bump the observed Tasks generation first: a cache update
          // may reuse the same array object, and the freshness memo
          // must still rebuild on the next read.
          this.freshnessTasksGen = (this.freshnessTasksGen || 0) + 1;
          this.schedulePlanBlockRerender();
          this.scheduleReadyRefresh();
          this.scheduleFreshnessStatusBar();
          this.scheduleFreshnessMarksRefresh();
          this.scheduleReviewChipsRefresh();
        }),
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
      this.refreshTodayCacheFromDaily();
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

    this.setupFreshnessStatusBar();
    this.scheduleFreshnessStatusBar();
    this.setupFreshnessMarks();
    this.scheduleFreshnessMarksRefresh();
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
    if (
      this.readyRefreshTimer !== null &&
      this.readyRefreshTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.readyRefreshTimer);
    }
    this.readyRefreshTimer = null;
    if (this.readyWidgets) {
      this.readyWidgets.clear();
    }
    if (
      this.reviewRefreshTimer !== null &&
      this.reviewRefreshTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.reviewRefreshTimer);
    }
    this.reviewRefreshTimer = null;
    if (this.reviewWidgets) {
      this.reviewWidgets.clear();
    }
    this.freshnessConfigCache = null;
    this.freshnessTasksGen = 0;
    this.readyLastCapsKey = null;
    this.readyLastDay = null;
    if (this.planPaintGens) {
      this.planPaintGens.clear();
    }
    this.todayCache = { date: null, dailyPath: null, keys: [], rank: new Map() };
    if (
      this.freshnessStatusTimer !== null &&
      this.freshnessStatusTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.freshnessStatusTimer);
    }
    this.freshnessStatusTimer = null;
    this.freshnessMemo = null;
    if (this.freshnessFrontValues) {
      this.freshnessFrontValues.clear();
    }
    this.freshnessStatusEl = null;
    if (
      this.freshnessMarksTimer !== null &&
      this.freshnessMarksTimer !== undefined &&
      typeof clearTimeout === "function"
    ) {
      clearTimeout(this.freshnessMarksTimer);
    }
    this.freshnessMarksTimer = null;
    this.freshnessMarkSnapshot = null;
    try {
      if (
        typeof document !== "undefined" &&
        document &&
        document.body &&
        document.body.classList &&
        typeof document.body.classList.remove === "function"
      ) {
        document.body.classList.remove("bob-fresh-marks");
      }
    } catch (error) {
      // Body class cleanup is best-effort.
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

  // --- Synchronous Today cache -----------------------------------------

  todayLocalDate(now = new Date()) {
    const date = now instanceof Date ? now : new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  todayCacheKey(task) {
    if (!task || typeof task !== "object") {
      return null;
    }
    const rawPath = planTaskPath(task);
    if (typeof rawPath !== "string" || !rawPath) {
      return null;
    }
    const blockId = planTaskBlockId(task);
    if (!blockId) {
      return null;
    }
    const path = /\.md$/i.test(rawPath) ? rawPath : `${rawPath}.md`;
    return `${path}#${blockId}`;
  }

  todayKeys() {
    const keys = (this.todayCache && this.todayCache.keys) || [];
    return [...keys];
  }

  isTodayTask(task) {
    const key = this.todayCacheKey(task);
    if (!key || !this.todayCache || !(this.todayCache.rank instanceof Map)) {
      return false;
    }
    return this.todayCache.rank.has(key);
  }

  todayRankOfTask(task) {
    const key = this.todayCacheKey(task);
    if (!key || !this.todayCache || !(this.todayCache.rank instanceof Map)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const rank = this.todayCache.rank.get(key);
    return typeof rank === "number" ? rank : Number.MAX_SAFE_INTEGER;
  }

  // --- READY backlog (api v3, additive) ----------------------------------
  // Synchronous, guarded `{ count, cap, over }`. `count` is `null` when
  // unavailable (no Tasks data, a non-Warm cache, no initial Today build,
  // or a failed evaluation) and `over` is false in that case. Zero is
  // reserved for a successfully evaluated empty queue.
  tasksCacheState() {
    try {
      const plugins =
        this.app && this.app.plugins && this.app.plugins.plugins;
      const tasks = plugins && plugins[PLAN_TASKS_PLUGIN_ID];
      if (tasks && typeof tasks.getState === "function") {
        return tasks.getState();
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  isTodayCacheReady(now = new Date()) {
    try {
      const expectedDate = this.todayLocalDate(now);
      const expectedPath = this.currentTodayDailyPath(now);
      if (!expectedPath) {
        return false;
      }
      const cache = this.todayCache;
      if (!cache || !(cache.rank instanceof Map)) {
        return false;
      }
      if (cache.date !== expectedDate) {
        return false;
      }
      if (!sameVaultPath(cache.dailyPath || "", expectedPath)) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  readyBudget(now = new Date()) {
    try {
      const loaded = loadPlanCaps();
      const caps = loaded.caps;
      const effective = effectivePlanCaps(caps);
      const cap = planReadyCapOrDefault(
        effective.maxReady,
        READY_FALLBACK_CAP,
      );
      const unavailable = { count: null, cap, over: false };
      const tasks = planBlockTasks(this.app);
      if (!Array.isArray(tasks)) {
        return unavailable;
      }
      const state = this.tasksCacheState();
      if (typeof state === "string" && state !== "Warm") {
        return unavailable;
      }
      if (!this.isTodayCacheReady(now)) {
        return unavailable;
      }
      // Gate the shared READY count from one validated freshness
      // snapshot. A missing or throwing snapshot degrades to the
      // legacy ungated count, never a partially gated one.
      let gate = null;
      let gateMemo = null;
      try {
        gateMemo = this.freshnessEnsureMemo(now);
        if (gateMemo && gateMemo.tasksAvailable) {
          gate = this.freshnessReviewPredicate(gateMemo);
        }
      } catch (error) {
        gate = null;
        gateMemo = null;
      }
      let count;
      try {
        count = readyCountFromTasks(
          tasks,
          now,
          (task) => this.isTodayTask(task),
          gate,
        );
      } catch (error) {
        return unavailable;
      }
      if (!Number.isInteger(count) || count < 0) {
        return unavailable;
      }
      // Total lane pressure for the gated tooltip: the gated count
      // plus the NEW and ROTTEN buckets behind it.
      let lane = null;
      try {
        if (
          gateMemo &&
          gateMemo.tasksAvailable &&
          gateMemo.counts &&
          Number.isInteger(gateMemo.counts.new) &&
          Number.isInteger(gateMemo.counts.resurfaced) &&
          Number.isInteger(gateMemo.counts.rotten)
        ) {
          const rotten =
            gateMemo.counts.resurfaced + gateMemo.counts.rotten;
          lane = {
            total: gateMemo.counts.new + rotten + count,
            new: gateMemo.counts.new,
            rotten,
            ready: count,
          };
        }
      } catch (error) {
        lane = null;
      }
      return { count, cap, over: count > cap, lane };
    } catch (error) {
      return {
        count: null,
        cap: READY_FALLBACK_CAP,
        over: false,
      };
    }
  }

  // Shared READY element renderer used by both the daily `bob-plan`
  // block and the dashboard. Returns the anchor element or null. The
  // element structure (separate READY label and count/cap value spans),
  // classes, fraction, over state, tooltip, and destination are shared;
  // each host page styles them in its own chip language through
  // `styles.css` (single-tone inside the daily block, two-tone on the
  // dashboard).
  paintReadyElement(host, budget, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const invalid = Boolean(options.invalid);
      const model = readyBadgeModel(budget, {
        invalid,
        lane: budget && budget.lane ? budget.lane : null,
      });
      const anchor = host.createEl("a", {
        cls: `bob-plan-chip bob-plan-ready${model.over ? " bob-plan-over" : ""}${model.placeholder ? " bob-plan-unavailable" : ""}`,
        title: model.tooltip,
        href: "dash#READY Tasks",
      });
      setReadyAnchorContent(anchor, model);
      if (anchor && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("aria-label", model.aria);
        anchor.setAttribute("role", "link");
        if (!anchor.hasAttribute("tabindex")) {
          anchor.setAttribute("tabindex", "0");
        }
      }
      const open = (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        try {
          const workspace = this.app && this.app.workspace;
          if (
            workspace &&
            typeof workspace.openLinkText === "function"
          ) {
            const newLeaf = Boolean(
              event && (event.ctrlKey || event.metaKey),
            );
            workspace.openLinkText("dash#READY Tasks", sourcePath, newLeaf);
          }
        } catch (error) {
          // The badge still shows the count without the navigation.
        }
      };
      if (anchor && typeof anchor.addEventListener === "function") {
        anchor.addEventListener("click", open);
        anchor.addEventListener("keydown", (event) => {
          if (
            event &&
            (event.key === "Enter" || event.key === " ")
          ) {
            open(event);
          }
        });
        anchor.addEventListener("mouseover", (event) => {
          try {
            const workspace = this.app && this.app.workspace;
            if (workspace && typeof workspace.trigger === "function") {
              workspace.trigger("hover-link", {
                event,
                source: "bob-plan",
                hoverParent: host,
                targetEl: anchor,
                linktext: "dash#READY Tasks",
                sourcePath,
              });
            }
          } catch (error) {
            // Hover preview is best-effort only.
          }
        });
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  // Dashboard entry point: `api.renderReadyBadge(parent, { sourcePath,
  // component })`. Uses the shared element renderer and registers
  // lifecycle-owned live updates. Replaces a component's old widget on
  // Dataview rerender and prunes detached nodes.
  renderReadyBadge(parent, options = {}) {
    try {
      if (!parent || typeof parent.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const component = options.component || null;
      if (!this.readyWidgets) {
        this.readyWidgets = new Set();
      }
      // Replace this component's old widget on Dataview rerender.
      if (component) {
        for (const widget of Array.from(this.readyWidgets)) {
          if (widget.component === component) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (
                widget.el &&
                typeof widget.el.remove === "function"
              ) {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.readyWidgets.delete(widget);
          }
        }
      }
      // Prune detached nodes before adding.
      for (const widget of Array.from(this.readyWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            // Only prune nodes that are truly detached and parentless;
            // freshly created anchors not yet attached are kept by the
            // caller adding them below.
            if (!parent.contains || !parent.contains(el)) {
              this.readyWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      const loaded = loadPlanCaps();
      const budget = this.readyBudget(new Date());
      const anchor = this.paintReadyElement(parent, budget, {
        sourcePath,
        invalid: loaded.invalid,
      });
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, sourcePath, component };
      this.readyWidgets.add(widget);
      if (
        component &&
        typeof component.register === "function"
      ) {
        try {
          component.register(() => {
            this.readyWidgets.delete(widget);
          });
        } catch (error) {
          // The widget still refreshes with the batch; only the
          // component-owned unregister is skipped.
        }
      }
      this.rememberReadyCaps(new Date());
      return anchor;
    } catch (error) {
      return null;
    }
  }

  rememberReadyCaps(now = new Date()) {
    try {
      const { caps } = loadPlanCaps();
      const effective = effectivePlanCaps(caps);
      this.readyLastCapsKey = JSON.stringify(effective);
      this.readyLastDay = this.todayLocalDate(now);
    } catch (error) {
      // Best-effort snapshot only.
    }
  }

  refreshReadyBadges(now = new Date()) {
    if (!this.readyWidgets || this.readyWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    const loaded = loadPlanCaps();
    const budget = this.readyBudget(now);
    for (const widget of Array.from(this.readyWidgets)) {
      try {
        const el = widget.el;
        if (!el || typeof el.empty === "function") {
          // Dataview container anchors are replaced in place.
        }
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          // Prune widgets whose host is gone.
          if (!el || !el.isConnected) {
            this.readyWidgets.delete(widget);
          }
          continue;
        }
        const model = readyBadgeModel(budget, {
          invalid: loaded.invalid,
          lane: budget && budget.lane ? budget.lane : null,
        });
        // One shared routine keeps the label/value spans (and the
        // model-dependent title, aria label, and state classes) current
        // without replacing the anchor or flattening it to plain text,
        // so listeners and widget registration survive live updates.
        setReadyAnchorContent(el, model);
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    this.rememberReadyCaps(now);
    return refreshed;
  }

  scheduleReadyRefresh() {
    if (
      this.readyRefreshTimer !== null &&
      this.readyRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.readyRefreshTimer = schedule(() => {
      this.readyRefreshTimer = null;
      try {
        this.refreshReadyBadges(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
      try {
        this.rerenderPlanBlocks();
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

  checkReadyCapsAndDay(now = new Date()) {
    try {
      const { caps } = loadPlanCaps();
      const key = JSON.stringify(effectivePlanCaps(caps));
      const day = this.todayLocalDate(now);
      if (this.readyLastCapsKey === null || this.readyLastDay === null) {
        this.readyLastCapsKey = key;
        this.readyLastDay = day;
        return false;
      }
      if (key !== this.readyLastCapsKey || day !== this.readyLastDay) {
        this.readyLastCapsKey = key;
        this.readyLastDay = day;
        this.refreshReadyBadges(now);
        this.schedulePlanBlockRerender();
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // --- NEW/ROTTEN review chips (freshness namespace v3) ----------------
  // Lifecycle-owned live chips for DataviewJS surfaces (dash NEW, the
  // rotten summary): the same widget pattern as the READY badge — one
  // anchor per component, detached nodes pruned, refreshed on the same
  // debounce paths, subscriptions dropped when the component unloads.
  // Models come from `freshnessReviewModel` so dash and rotten share
  // counts, meter, tooltip, and severity.
  renderReviewChip(parent, options = {}) {
    try {
      if (!parent || typeof parent.createEl !== "function") {
        return null;
      }
      const kind =
        options.kind === "rotten" ? "rotten" : "new";
      const component = options.component || null;
      if (!this.reviewWidgets) {
        this.reviewWidgets = new Set();
      }
      if (component) {
        for (const widget of Array.from(this.reviewWidgets)) {
          if (widget.component === component && widget.kind === kind) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (
                widget.el &&
                typeof widget.el.remove === "function"
              ) {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.reviewWidgets.delete(widget);
          }
        }
      }
      for (const widget of Array.from(this.reviewWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            if (!parent.contains || !parent.contains(el)) {
              this.reviewWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      const review = this.freshnessReviewModel(new Date());
      const anchor = paintReviewElement(parent, kind, review);
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, kind, component };
      this.reviewWidgets.add(widget);
      if (component && typeof component.register === "function") {
        try {
          component.register(() => {
            this.reviewWidgets.delete(widget);
          });
        } catch (error) {
          // The widget still refreshes with the batch; only the
          // component-owned unregister is skipped.
        }
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  refreshReviewChips(now = new Date()) {
    if (!this.reviewWidgets || this.reviewWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    let review = null;
    try {
      review = this.freshnessReviewModel(now);
    } catch (error) {
      return false;
    }
    for (const widget of Array.from(this.reviewWidgets)) {
      try {
        const el = widget.el;
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          if (!el || !el.isConnected) {
            this.reviewWidgets.delete(widget);
          }
          continue;
        }
        setReviewAnchorContent(el, widget.kind, review);
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    return refreshed;
  }

  scheduleReviewChipsRefresh() {
    if (
      this.reviewRefreshTimer !== null &&
      this.reviewRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    const self = this;
    this.reviewRefreshTimer = schedule(() => {
      self.reviewRefreshTimer = null;
      try {
        self.refreshReviewChips(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

  // --- Task freshness (freshness namespace v3) --------------------------
  // Rows come from the Tasks cache (`planBlockTasks`); `fresh` /
  // `refresh` come from `originalMarkdown`; frontmatter comes from
  // `metadataCache.getCache(path)?.frontmatter?.task_refresh`.
  // Visibility is `planLaneVisible` plus status type TODO,
  // `!task.recurrence`, not a canonical daily-note path, and
  // `!isTodayTask`. The evaluated rows and queue are memoized on the
  // identity of the array `getTasks()` returns, the local date, a
  // frontmatter generation, and the config — so `rank(task)` stays O(1)
  // inside Tasks' `sort by function`.

  freshnessTodayText(now = new Date()) {
    try {
      return this.todayLocalDate(now);
    } catch (error) {
      return formatLocalDate(new Date());
    }
  }

  // Cached freshness config snapshot: the config path plus its
  // mtime/size is checked at most once per 60-second tick (or on
  // explicit invalidation via `refreshFreshnessConfig`), and the file
  // is reparsed only when the check differs. Creation, deletion,
  // invalid edits and recovery, environment path overrides, and
  // mobile's default-config behavior all flow through the same key, so
  // a config edit is visible within the existing 60-second tick with
  // no per-task disk reads or YAML parses.
  freshnessConfigSnapshot(now = new Date()) {
    const fallback = () => ({
      config: { ...defaultFreshnessConfig(), intervalFromConfig: false },
      invalid: false,
    });
    try {
      const configPath = planConfigPath();
      const cached = this.freshnessConfigCache;
      let nowMs = NaN;
      try {
        nowMs =
          now instanceof Date
            ? now.getTime()
            : Number.isFinite(Number(now))
              ? Number(now)
              : Date.now();
      } catch (error) {
        nowMs = Date.now();
      }
      if (
        cached &&
        cached.path === configPath &&
        Number.isFinite(nowMs) &&
        Number.isFinite(cached.checkedAt) &&
        nowMs - cached.checkedAt < 60 * 1000
      ) {
        return { config: cached.config, invalid: cached.invalid };
      }
      // One stat per check: missing-file errors become part of the key
      // so creation and deletion invalidate like edits do.
      let statKey = null;
      try {
        const fsModule = planRequireOptionalNodeModule("fs");
        if (fsModule && typeof fsModule.statSync === "function") {
          try {
            const stat = fsModule.statSync(configPath);
            const mtime =
              stat && typeof stat.mtimeMs === "number"
                ? stat.mtimeMs
                : String(stat && stat.mtime);
            statKey = mtime + ":" + String(stat && stat.size);
          } catch (statError) {
            statKey =
              "missing:" +
              String(
                (statError && statError.code) || "error",
              );
          }
        }
      } catch (error) {
        statKey = null;
      }
      if (
        cached &&
        cached.path === configPath &&
        statKey !== null &&
        cached.statKey === statKey
      ) {
        cached.checkedAt = nowMs;
        return { config: cached.config, invalid: cached.invalid };
      }
      const loaded = loadFreshnessConfig();
      this.freshnessConfigCache = {
        path: configPath,
        statKey,
        checkedAt: nowMs,
        config: loaded.config,
        invalid: Boolean(loaded.invalid),
      };
      return {
        config: loaded.config,
        invalid: Boolean(loaded.invalid),
      };
    } catch (error) {
      return fallback();
    }
  }

  // Explicit config invalidation: drop the cached snapshot so the next
  // read re-stats and reparses. Returns true when a cache entry existed.
  refreshFreshnessConfig() {
    try {
      const had =
        this.freshnessConfigCache !== null &&
        this.freshnessConfigCache !== undefined;
      this.freshnessConfigCache = null;
      return had;
    } catch (error) {
      return false;
    }
  }

  freshnessFrontValueKey(value) {
    if (value === undefined) {
      return "u";
    }
    return typeof value + ":" + String(value);
  }

  // The note's raw `task_refresh` frontmatter value, cached per path.
  noteFreshnessRawFor(path) {
    const key = String(path || "");
    if (!key) {
      return undefined;
    }
    try {
      if (
        this.freshnessFrontValues &&
        this.freshnessFrontValues instanceof Map &&
        this.freshnessFrontValues.has(key)
      ) {
        return this.freshnessFrontValues.get(key);
      }
      const cache =
        this.app &&
        this.app.metadataCache &&
        typeof this.app.metadataCache.getCache === "function"
          ? this.app.metadataCache.getCache({ path: key })
          : null;
      const frontmatter =
        cache && typeof cache === "object" ? cache.frontmatter : null;
      const value =
        frontmatter && typeof frontmatter === "object"
          ? frontmatter.task_refresh
          : undefined;
      if (this.freshnessFrontValues instanceof Map) {
        this.freshnessFrontValues.set(key, value);
      }
      return value;
    } catch (error) {
      return undefined;
    }
  }

  freshnessContextFor(list, todayText, todayDay) {
    const self = this;
    return {
      list,
      todayDay,
      noteRefreshRawFor: (path) => self.noteFreshnessRawFor(path),
      isToday: (task) => self.isTodayTask(task),
    };
  }

  freshnessBuildMemo(tasks, dateText, snapshot, todayStamp) {
    const list = Array.isArray(tasks) ? tasks : [];
    // One supplied local date throughout the rebuild: the snapshot's
    // date text drives lane visibility too, never a second `new Date()`.
    const todayDay = freshnessDayNumberForDateText(dateText);
    const context = this.freshnessContextFor(list, dateText, todayDay);
    const rows = list.map((task, index) =>
      freshnessRowFromTask(task, index, context),
    );
    const queue = freshnessQueue(rows, dateText, snapshot.config);
    const counts = freshnessCounts(rows, dateText, snapshot.config);
    const lints = freshnessCollectLints(rows, dateText, snapshot.config);
    // One deprecation diagnostic per loaded config — never one per
    // task — when the removed `stale_daily_budget` key supplied the
    // budget or was ignored beside the canonical key.
    if (snapshot.config && snapshot.config.deprecatedStaleBudget) {
      let configPath = "";
      try {
        configPath =
          typeof planConfigPath === "function" ? planConfigPath() : "";
      } catch (error) {
        configPath = "";
      }
      lints.unshift({
        code: "freshness_stale_daily_budget_deprecated",
        path: String(configPath || ""),
        line: null,
        message:
          FRESHNESS_LINT_MESSAGES[
            "freshness_stale_daily_budget_deprecated"
          ] || "freshness_stale_daily_budget_deprecated",
      });
    }
    const rank = new Map(queue.map((entry, index) => [entry.key, index]));
    // Key-to-evaluated-result map built once per snapshot, covering
    // FRESH and out-of-scope rows too — not just the review queue — so
    // warm per-row lookups never re-parse a task or re-read the config.
    // A miss (a task object outside the snapshot) falls back to the
    // per-row evaluator with this memo's config, never a second
    // `ensure` call or a normal-path linear `indexOf` scan.
    const indexByTask = new Map();
    for (let index = 0; index < list.length; index += 1) {
      const task = list[index];
      if (task && typeof task === "object" && !indexByTask.has(task)) {
        indexByTask.set(task, index);
      }
    }
    // Per-row evaluated results aligned with `rows`, so a task object
    // already in the snapshot always serves its own row even when its
    // rank key collides with another row (duplicate block IDs). The
    // key map below only carries unambiguous keys: an ambiguous or
    // missing identity never borrows another row's classification and
    // instead falls back to the per-row evaluator (the neutral policy
    // for genuinely unresolved identity).
    const keyCounts = new Map();
    for (const row of rows) {
      const key = freshnessRowKey(row);
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
    const evaluatedByIndex = [];
    const evaluatedByKey = new Map();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      try {
        const evaluated = freshnessEvaluate(row, dateText, snapshot.config);
        const entry = {
          state: evaluated.state,
          bucket: freshnessBucketForState(evaluated.state),
          fresh: evaluated.fresh,
          dueOn: evaluated.dueOn,
          daysOverdue: evaluated.daysOverdue,
          intervalDays: evaluated.intervalDays,
          intervalSource: evaluated.intervalSource,
        };
        evaluatedByIndex[rowIndex] = entry;
        if (keyCounts.get(freshnessRowKey(row)) === 1) {
          evaluatedByKey.set(freshnessRowKey(row), entry);
        }
      } catch (error) {
        // One bad row never breaks the snapshot; lookups miss and use
        // the per-row fallback instead.
      }
    }
    return {
      tasks,
      dateText,
      frontGen: this.freshnessFrontGen || 0,
      configKey: JSON.stringify([snapshot.config, snapshot.invalid]),
      config: snapshot.config,
      invalid: snapshot.invalid,
      todayStamp:
        typeof todayStamp === "string" ? todayStamp : null,
      tasksGen: this.freshnessTasksGen || 0,
      tasksAvailable: Array.isArray(tasks),
      rows,
      indexByTask,
      evaluatedByIndex,
      evaluatedByKey,
      queue,
      counts,
      lints,
      rank,
      dueKeys: queue.map((entry) => entry.key),
    };
  }

  // Snapshot key for Today membership and readiness: the cache's
  // date, daily path, and link keys. Any Today change (link, unlink,
  // daily rebuild, rollover) invalidates the memo, because rows bake
  // the membership in at build time.
  freshnessTodayStamp() {
    try {
      const cache = this.todayCache;
      if (!cache || !(cache.rank instanceof Map)) {
        return JSON.stringify([null, null, null]);
      }
      return JSON.stringify([
        cache.date || null,
        cache.dailyPath || null,
        Array.isArray(cache.keys) ? cache.keys : [],
      ]);
    } catch (error) {
      return JSON.stringify(["error", "error", "error"]);
    }
  }

  // Rebuild the memoized rows when the Tasks array identity or
  // generation, the local date, the frontmatter generation, the
  // config, or Today membership/readiness changed. When the queue keys
  // or any row's state/bucket change because of rollover, a
  // frontmatter change, a config change, or a Today-link-only change
  // (not task edits, which Tasks re-renders itself), every open Tasks
  // query re-reads via TODAY_RELOAD_EVENT and the badges, status bar,
  // marks, and review chips refresh on the existing debounce paths.
  freshnessEnsureMemo(now = new Date()) {
    const tasks = planBlockTasks(this.app);
    const dateText = this.freshnessTodayText(now);
    const snapshot = this.freshnessConfigSnapshot(now);
    const configKey = JSON.stringify([snapshot.config, snapshot.invalid]);
    const todayStamp = this.freshnessTodayStamp();
    const tasksGen = this.freshnessTasksGen || 0;
    const memo = this.freshnessMemo;
    if (
      memo &&
      memo.tasks === tasks &&
      memo.dateText === dateText &&
      (memo.frontGen || 0) === (this.freshnessFrontGen || 0) &&
      memo.configKey === configKey &&
      (memo.todayStamp || null) === (todayStamp || null) &&
      (memo.tasksGen || 0) === tasksGen
    ) {
      return memo;
    }
    const previousDueKeys = memo && Array.isArray(memo.dueKeys)
      ? memo.dueKeys
      : null;
    const previousEvaluated =
      memo && memo.evaluatedByKey instanceof Map
        ? memo.evaluatedByKey
        : null;
    const tasksOnlyChange =
      Boolean(memo) &&
      previousDueKeys !== null &&
      (memo.tasks !== tasks || (memo.tasksGen || 0) !== tasksGen) &&
      memo.dateText === dateText &&
      (memo.frontGen || 0) === (this.freshnessFrontGen || 0) &&
      memo.configKey === configKey &&
      (memo.todayStamp || null) === (todayStamp || null);
    const next = this.freshnessBuildMemo(
      tasks,
      dateText,
      snapshot,
      todayStamp,
    );
    this.freshnessMemo = next;
    if (
      !tasksOnlyChange &&
      previousDueKeys !== null &&
      freshnessMemoReviewChanged(previousDueKeys, previousEvaluated, next)
    ) {
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // The memo is still correct; only the live refresh is skipped.
      }
      for (const refresh of [
        () => this.scheduleReadyRefresh(),
        () => this.scheduleFreshnessStatusBar(),
        () => this.scheduleFreshnessMarksRefresh(),
        () => this.scheduleReviewChipsRefresh(),
      ]) {
        try {
          refresh();
        } catch (error) {
          // One missed schedule never breaks the memo.
        }
      }
    }
    return next;
  }

  freshnessMemoRankKey(task) {
    try {
      if (!task || typeof task !== "object") {
        return null;
      }
      const path = planTaskPath(task) || "";
      if (!path) {
        return null;
      }
      const blockId = planTaskBlockId(task);
      if (blockId) {
        return path + "#" + blockId;
      }
      const line = Number.isInteger(task.lineNumber) ? task.lineNumber + 1 : 1;
      return path + ":" + line;
    } catch (error) {
      return null;
    }
  }

  apiFreshnessConfig() {
    try {
      const snapshot = this.freshnessConfigSnapshot();
      return {
        interval: snapshot.config.interval,
        rottenDailyBudget: snapshot.config.rottenDailyBudget,
        invalid: snapshot.invalid,
        deprecatedStaleBudget: Boolean(
          snapshot.config.deprecatedStaleBudget,
        ),
      };
    } catch (error) {
      return {
        interval: 7,
        rottenDailyBudget: null,
        invalid: false,
        deprecatedStaleBudget: false,
      };
    }
  }

  apiFreshnessStampLine(line, dateText) {
    try {
      const day =
        parseFreshDateStrict(dateText) || this.freshnessTodayText();
      return freshnessStampLine(line, day).line;
    } catch (error) {
      return String(line || "");
    }
  }

  apiFreshnessSetRefreshLine(line, days, dateText) {
    try {
      const day =
        parseFreshDateStrict(dateText) || this.freshnessTodayText();
      return freshnessSetRefreshLine(line, days, day).line;
    } catch (error) {
      return String(line || "");
    }
  }

  // Snapshot context for a per-row fallback: the already-acquired
  // memo's date and config, never a second `ensure` call.
  freshnessFallbackContext(memo) {
    const list =
      memo && Array.isArray(memo.tasks) ? memo.tasks : [];
    return this.freshnessContextFor(
      list,
      (memo && memo.dateText) || this.freshnessTodayText(),
      freshnessDayNumberForDateText((memo && memo.dateText) || ""),
    );
  }

  apiFreshnessRowFor(task, memo) {
    const active = memo || this.freshnessEnsureMemo();
    const index =
      active && active.indexByTask instanceof Map
        ? active.indexByTask.get(task)
        : undefined;
    if (Number.isInteger(index) && active.rows[index]) {
      return active.rows[index];
    }
    // Miss (a task object outside the snapshot): evaluate this row
    // alone with the memo's config, not a second `ensure` call or a
    // linear `indexOf` scan.
    const fallbackIndex =
      task && Number.isInteger(task.lineNumber) ? task.lineNumber : 0;
    return freshnessRowFromTask(
      task,
      fallbackIndex,
      this.freshnessFallbackContext(active),
    );
  }

  // Evaluated `{ state, bucket, ... }` for one task: a warm map hit
  // inside the snapshot, or the per-row evaluator with the memo's
  // config on a miss. Throws only when the memo itself is unusable, so
  // the gated READY count can fall back to the legacy count.
  freshnessEvaluatedFor(task, memo) {
    const active = memo || this.freshnessEnsureMemo();
    // A task object already in the snapshot serves its own row's
    // cached result first, so a duplicate block ID (or any other key
    // collision) can never borrow another row's classification.
    if (active && active.indexByTask instanceof Map) {
      const index = active.indexByTask.get(task);
      if (
        Number.isInteger(index) &&
        Array.isArray(active.evaluatedByIndex) &&
        active.evaluatedByIndex[index]
      ) {
        return active.evaluatedByIndex[index];
      }
    }
    // Cloned Tasks query objects (same key, new identity) share the
    // unambiguous key's cached result; ambiguous keys are absent from
    // the map and fall through to the per-row evaluator below.
    const key = this.freshnessMemoRankKey(task);
    if (
      key &&
      active &&
      active.evaluatedByKey instanceof Map &&
      active.evaluatedByKey.has(key)
    ) {
      return active.evaluatedByKey.get(key);
    }
    const row = this.apiFreshnessRowFor(task, active);
    const evaluated = freshnessEvaluate(
      row,
      (active && active.dateText) || this.freshnessTodayText(),
      (active && active.config) || { interval: 7 },
    );
    return {
      state: evaluated.state,
      bucket: freshnessBucketForState(evaluated.state),
      fresh: evaluated.fresh,
      dueOn: evaluated.dueOn,
      daysOverdue: evaluated.daysOverdue,
      intervalDays: evaluated.intervalDays,
      intervalSource: evaluated.intervalSource,
    };
  }

  apiFreshnessState(task) {
    try {
      return this.freshnessEvaluatedFor(task).state;
    } catch (error) {
      return null;
    }
  }

  apiFreshnessBucket(task) {
    try {
      return this.freshnessEvaluatedFor(task).bucket;
    } catch (error) {
      return null;
    }
  }

  // Snapshot-backed READY gate: true when the task sits in NEW or
  // ROTTEN review. Bound to one validated snapshot by the caller.
  freshnessReviewPredicate(memo) {
    const active = memo || this.freshnessMemo;
    return (task) =>
      this.freshnessEvaluatedFor(task, active).bucket !== null;
  }

  // Shared NEW/ROTTEN review model with an explicit availability bit.
  // Unavailable while Tasks data, a Warm cache, or Today is missing —
  // never an empty success.
  freshnessReviewModel(now = new Date()) {
    try {
      const tasks = planBlockTasks(this.app);
      if (!Array.isArray(tasks)) {
        return freshnessReviewUnavailable();
      }
      const state = this.tasksCacheState();
      if (typeof state === "string" && state !== "Warm") {
        return freshnessReviewUnavailable();
      }
      if (!this.isTodayCacheReady(now)) {
        return freshnessReviewUnavailable();
      }
      const memo = this.freshnessEnsureMemo(now);
      return freshnessReviewModel(memo.counts, memo.queue);
    } catch (error) {
      return freshnessReviewUnavailable();
    }
  }

  apiFreshnessIsDue(task) {
    try {
      const state = this.apiFreshnessState(task);
      return state === "new" || state === "resurfaced" || state === "rotten";
    } catch (error) {
      return false;
    }
  }

  apiFreshnessTier(task) {
    try {
      return freshnessTierForState(this.apiFreshnessState(task));
    } catch (error) {
      return "";
    }
  }

  apiFreshnessRank(task) {
    try {
      const memo = this.freshnessEnsureMemo();
      const key = this.freshnessMemoRankKey(task);
      if (!key || !(memo.rank instanceof Map)) {
        return Number.MAX_SAFE_INTEGER;
      }
      const rank = memo.rank.get(key);
      return typeof rank === "number" ? rank : Number.MAX_SAFE_INTEGER;
    } catch (error) {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  apiFreshnessIntervalFor(task) {
    try {
      // One memo acquisition, then the same evaluated result used for
      // state/bucket: the cached interval, never a warm row reparse,
      // re-evaluation, or config re-read. A miss still evaluates the
      // row once through the shared path with the acquired memo.
      const memo = this.freshnessEnsureMemo();
      const evaluated = this.freshnessEvaluatedFor(task, memo);
      if (
        evaluated &&
        Number.isInteger(evaluated.intervalDays) &&
        evaluated.intervalDays >= 1 &&
        typeof evaluated.intervalSource === "string"
      ) {
        return {
          days: evaluated.intervalDays,
          source: evaluated.intervalSource,
        };
      }
      return { days: 7, source: "default" };
    } catch (error) {
      return { days: 7, source: "default" };
    }
  }

  apiFreshnessQueue() {
    try {
      const memo = this.freshnessEnsureMemo();
      return memo.queue.map((entry) => ({ ...entry }));
    } catch (error) {
      return [];
    }
  }

  apiFreshnessCounts() {
    try {
      const memo = this.freshnessEnsureMemo();
      return { ...memo.counts };
    } catch (error) {
      return {
        due: 0,
        new: 0,
        resurfaced: 0,
        rotten: 0,
        fresh: 0,
        refreshedToday: 0,
        budget: null,
        budgetMet: false,
      };
    }
  }

  apiFreshnessLints() {
    try {
      const memo = this.freshnessEnsureMemo();
      return memo.lints.map((lint) => ({ ...lint }));
    } catch (error) {
      return [];
    }
  }

  // Bump the frontmatter generation when a note's `task_refresh`
  // differs, and re-read the config on bumps and at rollover. Returns
  // true when the generation changed.
  refreshFreshnessForChangedFile(file, data) {
    try {
      const changedPath =
        file && typeof file.path === "string" ? file.path : null;
      if (!changedPath) {
        return false;
      }
      let current = undefined;
      try {
        const cache =
          this.app &&
          this.app.metadataCache &&
          typeof this.app.metadataCache.getCache === "function"
            ? this.app.metadataCache.getCache(file)
            : null;
        const frontmatter =
          cache && typeof cache === "object" ? cache.frontmatter : null;
        current =
          frontmatter && typeof frontmatter === "object"
            ? frontmatter.task_refresh
            : undefined;
      } catch (error) {
        current = undefined;
      }
      if (!(this.freshnessFrontValues instanceof Map)) {
        this.freshnessFrontValues = new Map();
      }
      const had = this.freshnessFrontValues.has(changedPath);
      const previous = had ? this.freshnessFrontValues.get(changedPath) : undefined;
      if (
        had &&
        this.freshnessFrontValueKey(previous) ===
          this.freshnessFrontValueKey(current)
      ) {
        return false;
      }
      if (!had && current === undefined) {
        return false;
      }
      this.freshnessFrontValues.set(changedPath, current);
      this.freshnessFrontGen = (this.freshnessFrontGen || 0) + 1;
      try {
        this.freshnessEnsureMemo();
      } catch (error) {
        // The generation still counts; the memo rebuilds on next access.
      }
      this.scheduleReadyRefresh();
      this.scheduleFreshnessStatusBar();
      this.scheduleFreshnessMarksRefresh();
      this.scheduleReviewChipsRefresh();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Local-midnight rollover for the review queue. Returns true when the
  // date changed.
  refreshFreshnessForRollover(now = new Date()) {
    try {
      const dateText = this.freshnessTodayText(now);
      if (
        this.freshnessMemo &&
        this.freshnessMemo.dateText === dateText
      ) {
        return false;
      }
      try {
        this.freshnessEnsureMemo(now);
      } catch (error) {
        // The memo rebuilds on next access.
      }
      this.scheduleReadyRefresh();
      this.scheduleFreshnessStatusBar();
      this.scheduleFreshnessMarksRefresh();
      this.scheduleReviewChipsRefresh();
      return true;
    } catch (error) {
      return false;
    }
  }

  // --- Task freshness: status bar -----------------------------------------
  // Desktop only: `⟳ 3 new · 31 rotten · ✓ 12 today` (or `✓ 12/15`
  // with a budget; `⟳ –` while Tasks is unavailable). An accent while
  // `new > 0`, a muted "clear" style when nothing is due, a budget-met
  // style when `budget_met` holds. Clicking runs
  // `bob-navigation-hotkeys:jump-to-next-due-task`, falling back to
  // opening `rotten` (switched in the dash-gating rollout with the review page).

  setupFreshnessStatusBar() {
    try {
      const platform =
        typeof Platform !== "undefined" ? Platform : null;
      if (platform && platform.isDesktopApp === false) {
        return;
      }
      if (platform && platform.isMobile === true) {
        return;
      }
      if (typeof this.addStatusBarItem !== "function") {
        return;
      }
      if (this.freshnessStatusEl) {
        return;
      }
      const el = this.addStatusBarItem();
      if (!el) {
        return;
      }
      this.freshnessStatusEl = el;
      try {
        if (typeof el.addClass === "function") {
          el.addClass("bob-freshness");
        } else if (el.classList && typeof el.classList.add === "function") {
          el.classList.add("bob-freshness");
        } else if (typeof el.className === "string") {
          el.className = (el.className + " bob-freshness").trim();
        }
        if (typeof el.setAttribute === "function") {
          el.setAttribute("role", "button");
        }
        if (el.style && typeof el.style === "object") {
          el.style.cursor = "pointer";
        }
      } catch (error) {
        // Cosmetic only; the text update below still applies.
      }
      const self = this;
      try {
        if (typeof el.addEventListener === "function") {
          el.addEventListener("click", () => self.freshnessStatusClicked());
        } else {
          el.onclick = () => self.freshnessStatusClicked();
        }
      } catch (error) {
        // A status bar without a click still shows the counts.
      }
    } catch (error) {
      this.freshnessStatusEl = null;
    }
  }

  scheduleFreshnessStatusBar() {
    try {
      if (
        this.freshnessStatusTimer !== null &&
        this.freshnessStatusTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.freshnessStatusTimer = schedule(() => {
        self.freshnessStatusTimer = null;
        self.updateFreshnessStatusBar();
      }, 150);
    } catch (error) {
      // No timer host (or no status bar); nothing to schedule.
    }
  }

  updateFreshnessStatusBar() {
    const el = this.freshnessStatusEl;
    if (!el) {
      return;
    }
    try {
      const memo = this.freshnessEnsureMemo();
      let mostOverdue = null;
      for (const entry of memo.queue) {
        if (
          Number.isInteger(entry.daysOverdue) &&
          (mostOverdue === null || entry.daysOverdue > mostOverdue)
        ) {
          mostOverdue = entry.daysOverdue;
        }
      }
      const view = freshnessStatusView(memo.counts, {
        tasksAvailable: memo.tasksAvailable,
        mostOverdue,
      });
      if (typeof el.setText === "function") {
        el.setText(view.text);
      } else if ("textContent" in el) {
        el.textContent = view.text;
      }
      const label =
        view.mode === "unavailable"
          ? view.tooltip
          : view.tooltip + " · click for the next due task";
      try {
        if (typeof el.setAttribute === "function") {
          el.setAttribute("aria-label", label);
          el.setAttribute("title", label);
        } else {
          el.title = label;
        }
      } catch (error) {
        // Labels are cosmetic.
      }
      const modes = [
        "bob-freshness-unavailable",
        "bob-freshness-new",
        "bob-freshness-due",
        "bob-freshness-clear",
        "bob-freshness-budget",
      ];
      const wanted = "bob-freshness-" + view.mode;
      try {
        if (el.classList && typeof el.classList.add === "function") {
          for (const mode of modes) {
            if (mode === wanted) {
              el.classList.add(mode);
            } else if (typeof el.classList.remove === "function") {
              el.classList.remove(mode);
            }
          }
        } else if (typeof el.setAttribute === "function") {
          const current = typeof el.className === "string" ? el.className : "";
          const rest = current
            .split(/\s+/)
            .filter((name) => name && !modes.includes(name));
          rest.push("bob-freshness", wanted);
          el.setAttribute("class", rest.join(" "));
        }
      } catch (error) {
        // Classes are cosmetic.
      }
    } catch (error) {
      // The status bar never throws; it keeps its previous text.
    }
  }

  freshnessStatusClicked() {
    try {
      const commands = this.app && this.app.commands;
      const commandId = "bob-navigation-hotkeys:jump-to-next-due-task";
      let exists = false;
      try {
        if (commands && commands.commands && commands.commands[commandId]) {
          exists = true;
        } else if (commands && typeof commands.findCommand === "function") {
          exists = Boolean(commands.findCommand(commandId));
        }
      } catch (error) {
        exists = false;
      }
      if (exists && typeof commands.executeCommandById === "function") {
        commands.executeCommandById(commandId);
        return;
      }
    } catch (error) {
      // Fall through to opening rotten.
    }
    try {
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.openLinkText === "function") {
        workspace.openLinkText("rotten", "", false);
      }
    } catch (error) {
      // Nothing to fall back to.
    }
  }

  // --- Task freshness marks: Live Preview + rendered views (mark-surfaces)
  // Display-only; nothing ever writes. The mark snapshot is a
  // filesystem-free cache (`{ dateText, config, memo, index }`) built from
  // one `freshnessEnsureMemo()` call and refreshed on the status bar
  // paths. Decoration builds reuse it and never touch the filesystem.

  setupFreshnessMarks() {
    try {
      if (typeof this.freshnessMarksEnabled !== "boolean") {
        this.freshnessMarksEnabled = true;
      }
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList &&
          typeof document.body.classList.add === "function"
        ) {
          if (this.freshnessMarksEnabled) {
            document.body.classList.add("bob-fresh-marks");
          } else {
            document.body.classList.remove("bob-fresh-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-freshness-marks",
            name: "Toggle task freshness marks",
            callback: () => this.toggleFreshnessMarks(),
          });
        }
      } catch (error) {
        // The toggle is best-effort.
      }
      try {
        const extension = this.createFreshnessMarkExtension();
        if (
          extension &&
          typeof this.registerEditorExtension === "function"
        ) {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview marks are best-effort.
      }
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderFreshnessMarksIn(el, ctx),
            50,
          );
        }
      } catch (error) {
        // Rendered-view marks are best-effort.
      }
    } catch (error) {
      // Marks setup never throws.
    }
  }

  freshnessMarksAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          StateEffect &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          FreshnessMarkWidget &&
          freshnessMarksRefresh,
      );
    } catch (error) {
      return false;
    }
  }

  createFreshnessMarkExtension() {
    try {
      if (!this.freshnessMarksAvailable()) {
        return null;
      }
      if (
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const MarkPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildFreshnessMarkDecorations(view);
          } catch (error) {
            try {
              this.decorations = Decoration.none;
            } catch (inner) {
              this.decorations = null;
            }
          }
        }

        update(u) {
          try {
            if (plugin.freshnessMarkShouldRebuild(u)) {
              this.decorations =
                plugin.buildFreshnessMarkDecorations(u.view);
            }
          } catch (error) {
            // Keep previous decorations on failure.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(MarkPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  rebuildFreshnessMarkSnapshot() {
    try {
      const memo = this.freshnessEnsureMemo();
      this.freshnessMarkSnapshot = {
        dateText: memo.dateText,
        config: memo.config,
        memo,
        index: null,
      };
    } catch (error) {
      // The snapshot rebuilds on next access.
    }
  }

  freshnessMarkEnsureSnapshot() {
    try {
      const current = this.freshnessMarkSnapshot;
      if (
        current &&
        current.memo &&
        typeof current.dateText === "string" &&
        current.config
      ) {
        return current;
      }
      const memo = this.freshnessEnsureMemo();
      this.freshnessMarkSnapshot = {
        dateText: memo.dateText,
        config: memo.config,
        memo,
        index: null,
      };
      return this.freshnessMarkSnapshot;
    } catch (error) {
      return null;
    }
  }

  freshnessMarkSnapshotIndex(snapshot) {
    try {
      if (!snapshot || !snapshot.memo) {
        return null;
      }
      if (
        snapshot.index &&
        snapshot.index.byLine instanceof Map &&
        snapshot.index.byPath instanceof Map
      ) {
        return snapshot.index;
      }
      const byLine = new Map();
      const byPath = new Map();
      const rows = (snapshot.memo && snapshot.memo.rows) || [];
      for (const row of rows) {
        try {
          if (!row || typeof row !== "object") {
            continue;
          }
          const path = String(row.path || "");
          const lineNumber = row.lineNumber;
          if (!Number.isInteger(lineNumber)) {
            continue;
          }
          const key = path + "\u0000" + String(lineNumber);
          if (!byLine.has(key)) {
            byLine.set(key, row);
          }
          let list = byPath.get(path);
          if (!list) {
            list = [];
            byPath.set(path, list);
          }
          list.push(row);
        } catch (error) {
          continue;
        }
      }
      snapshot.index = { byLine, byPath };
      return snapshot.index;
    } catch (error) {
      return null;
    }
  }

  freshnessMarkUnresolvedInterval(snapshot, path, source) {
    try {
      const taskDays =
        source &&
        source.refresh !== null &&
        source.refresh !== undefined
          ? source.refresh
          : null;
      let noteDays = null;
      try {
        const raw = this.noteFreshnessRawFor(path);
        const parsed = freshnessParseNoteRefresh(raw);
        noteDays =
          parsed && parsed.days !== null && parsed.days !== undefined
            ? parsed.days
            : null;
      } catch (error) {
        noteDays = null;
      }
      const config =
        snapshot && snapshot.config
          ? snapshot.config
          : { interval: 7 };
      return freshnessIntervalFor(taskDays, noteDays, config);
    } catch (error) {
      return { days: 7, source: "default" };
    }
  }

  freshnessMarkModelForLine(args) {
    try {
      const input = args && typeof args === "object" ? args : null;
      if (!input || !input.source) {
        return null;
      }
      const source = input.source;
      const text = typeof input.text === "string" ? input.text : "";
      const path = typeof input.path === "string" ? input.path : "";
      const lineNumber = input.lineNumber;
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
        return freshnessMarkModel({
          source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: freshnessTaskStatus(text),
          resolution: null,
        });
      }
      const dateText = snapshot.dateText;
      const config = snapshot.config;
      const status = freshnessTaskStatus(text);
      try {
        const index = this.freshnessMarkSnapshotIndex(snapshot);
        if (index && Number.isInteger(lineNumber)) {
          const row = index.byLine.get(path + "\u0000" + String(lineNumber));
          if (row && row.rawLine === text) {
            const resolution = freshnessMarkResolution(row, dateText, config);
            if (resolution) {
              const model = freshnessMarkModel({
                source,
                today: dateText,
                interval: this.freshnessMarkUnresolvedInterval(
                  snapshot,
                  path,
                  source,
                ),
                status,
                resolution,
              });
              if (model) {
                return model;
              }
            }
          }
        }
      } catch (error) {
        // Fall through to consensus.
      }
      try {
        const index = this.freshnessMarkSnapshotIndex(snapshot);
        const candidates =
          index && index.byPath ? index.byPath.get(path) || [] : [];
        const models = [];
        let hasCandidates = false;
        for (const row of candidates) {
          try {
            if (!row || typeof row !== "object") {
              continue;
            }
            const candidateSource = freshnessMarkSource(
              row.rawLine || "",
              dateText,
            );
            if (!candidateSource || candidateSource.text !== source.text) {
              continue;
            }
            hasCandidates = true;
            const resolution = freshnessMarkResolution(row, dateText, config);
            const model = freshnessMarkModel({
              source,
              today: dateText,
              interval: this.freshnessMarkUnresolvedInterval(
                snapshot,
                path,
                source,
              ),
              status,
              resolution,
            });
            models.push(model);
          } catch (error) {
            continue;
          }
        }
        if (hasCandidates) {
          const consensus = freshnessMarkConsensus(models);
          if (consensus) {
            return consensus;
          }
        }
      } catch (error) {
        // Fall through to unresolved.
      }
      return freshnessMarkModel({
        source,
        today: dateText,
        interval: this.freshnessMarkUnresolvedInterval(snapshot, path, source),
        status,
        resolution: null,
      });
    } catch (error) {
      try {
        const input = args && typeof args === "object" ? args : null;
        if (!input || !input.source) {
          return null;
        }
        return freshnessMarkModel({
          source: input.source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: null,
          resolution: null,
        });
      } catch (inner) {
        return null;
      }
    }
  }

  freshnessMarkModelForText(args) {
    try {
      const input = args && typeof args === "object" ? args : null;
      if (!input || !input.source) {
        return null;
      }
      const source = input.source;
      const path =
        typeof input.path === "string"
          ? input.path
          : input.path === null || input.path === undefined
            ? ""
            : String(input.path);
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
        return freshnessMarkModel({
          source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: null,
          resolution: null,
        });
      }
      const dateText = snapshot.dateText;
      const config = snapshot.config;
      try {
        const index = this.freshnessMarkSnapshotIndex(snapshot);
        const candidates =
          index && index.byPath ? index.byPath.get(path) || [] : [];
        const models = [];
        let hasCandidates = false;
        for (const row of candidates) {
          try {
            if (!row || typeof row !== "object") {
              continue;
            }
            const candidateSource = freshnessMarkSource(
              row.rawLine || "",
              dateText,
            );
            if (!candidateSource || candidateSource.text !== source.text) {
              continue;
            }
            hasCandidates = true;
            const resolution = freshnessMarkResolution(row, dateText, config);
            const status =
              resolution &&
              resolution.status !== undefined &&
              resolution.status !== null
                ? resolution.status
                : null;
            const model = freshnessMarkModel({
              source,
              today: dateText,
              interval: this.freshnessMarkUnresolvedInterval(
                snapshot,
                path,
                source,
              ),
              status,
              resolution,
            });
            models.push(model);
          } catch (error) {
            continue;
          }
        }
        if (hasCandidates) {
          const consensus = freshnessMarkConsensus(models);
          if (consensus) {
            return consensus;
          }
        }
      } catch (error) {
        // Fall through to unresolved.
      }
      return freshnessMarkModel({
        source,
        today: dateText,
        interval: this.freshnessMarkUnresolvedInterval(snapshot, path, source),
        status: null,
        resolution: null,
      });
    } catch (error) {
      try {
        const input = args && typeof args === "object" ? args : null;
        if (!input || !input.source) {
          return null;
        }
        return freshnessMarkModel({
          source: input.source,
          today: freshnessTodayFallback(),
          interval: { days: 7, source: "default" },
          status: null,
          resolution: null,
        });
      } catch (inner) {
        return null;
      }
    }
  }

  freshnessMarkShouldRebuild(u) {
    try {
      if (!u || typeof u !== "object") {
        return false;
      }
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        return true;
      }
      try {
        const transactions = u.transactions || [];
        for (const transaction of transactions) {
          try {
            const effects =
              transaction && transaction.effects !== undefined
                ? transaction.effects
                : null;
            if (!effects) {
              continue;
            }
            const list = Array.isArray(effects) ? effects : [effects];
            for (const effect of list) {
              try {
                if (!effect) {
                  continue;
                }
                if (effect === freshnessMarksRefresh) {
                  return true;
                }
                if (
                  freshnessMarksRefresh &&
                  typeof effect.is === "function" &&
                  effect.is(freshnessMarksRefresh)
                ) {
                  return true;
                }
              } catch (error) {
                continue;
              }
            }
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        // Effect scan is best-effort.
      }
      try {
        if (editorLivePreviewField && u.startState && u.state) {
          let before = null;
          let after = null;
          try {
            before = u.startState.field(editorLivePreviewField);
          } catch (error) {
            before = null;
          }
          try {
            after = u.state.field(editorLivePreviewField);
          } catch (error) {
            after = null;
          }
          if (before !== after) {
            return true;
          }
        }
        if (editorInfoField && u.startState && u.state) {
          let beforePath = null;
          let afterPath = null;
          try {
            const beforeInfo = u.startState.field(editorInfoField);
            beforePath =
              beforeInfo && beforeInfo.file ? beforeInfo.file.path : null;
          } catch (error) {
            beforePath = null;
          }
          try {
            const afterInfo = u.state.field(editorInfoField);
            afterPath =
              afterInfo && afterInfo.file ? afterInfo.file.path : null;
          } catch (error) {
            afterPath = null;
          }
          if (beforePath !== afterPath) {
            return true;
          }
        }
      } catch (error) {
        // Field comparison is best-effort.
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  buildFreshnessMarkDecorations(view) {
    try {
      if (!this.freshnessMarksEnabled) {
        return Decoration.none;
      }
      if (!Decoration || !RangeSetBuilder || !FreshnessMarkWidget) {
        return Decoration.none;
      }
      if (!editorInfoField || !editorLivePreviewField) {
        return Decoration.none;
      }
      let live = null;
      try {
        live = view.state.field(editorLivePreviewField);
      } catch (error) {
        return Decoration.none;
      }
      if (!live) {
        return Decoration.none;
      }
      let info = null;
      try {
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      const filePath =
        info && info.file && typeof info.file.path === "string"
          ? info.file.path
          : null;
      if (!filePath) {
        return Decoration.none;
      }
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
        return Decoration.none;
      }
      const ranges =
        (view && view.visibleRanges) || [];
      let selectionRanges = [];
      try {
        selectionRanges =
          (view.state.selection && view.state.selection.ranges) || [];
      } catch (error) {
        selectionRanges = [];
      }
      let tree = null;
      try {
        if (syntaxTree && typeof syntaxTree === "function" && view.state) {
          tree = syntaxTree(view.state);
        } else if (
          syntaxTree &&
          typeof syntaxTree.resolveInner === "function"
        ) {
          tree = syntaxTree;
        }
      } catch (error) {
        tree = null;
      }
      const builder = new RangeSetBuilder();
      const doc = view.state.doc;
      if (!doc || typeof doc.lineAt !== "function") {
        return builder.finish();
      }
      const docLength =
        typeof doc.length === "number" ? doc.length : Number.MAX_SAFE_INTEGER;
      for (const range of ranges) {
        try {
          if (!range || typeof range.from !== "number") {
            continue;
          }
          let pos = Math.max(0, range.from);
          const end = Math.min(
            typeof range.to === "number" ? range.to : docLength,
            docLength,
          );
          let guard = 0;
          while (pos <= end && guard < 10000) {
            guard += 1;
            let line = null;
            try {
              line = doc.lineAt(pos);
            } catch (error) {
              break;
            }
            if (!line || typeof line.text !== "string") {
              break;
            }
            try {
              if (line.text.indexOf("fresh::") !== -1) {
                const source = freshnessMarkSource(
                  line.text,
                  snapshot.dateText,
                );
                if (source) {
                  const absFrom = line.from + source.fieldStart;
                  const absTo = line.from + source.fieldEnd;
                  let revealed = false;
                  for (const selection of selectionRanges) {
                    try {
                      if (
                        selection &&
                        typeof selection.from === "number" &&
                        typeof selection.to === "number" &&
                        selection.from <= absTo &&
                        selection.to >= absFrom
                      ) {
                        revealed = true;
                        break;
                      }
                    } catch (error) {
                      continue;
                    }
                  }
                  if (!revealed) {
                    let inCode = false;
                    try {
                      if (tree) {
                        inCode = freshnessMarkPosInCode(tree, absFrom);
                      }
                    } catch (error) {
                      inCode = false;
                    }
                    if (!inCode) {
                      const model = this.freshnessMarkModelForLine({
                        path: filePath,
                        lineNumber:
                          typeof line.number === "number"
                            ? line.number - 1
                            : null,
                        text: line.text,
                        source,
                      });
                      if (model) {
                        const from =
                          line.from +
                          source.fieldStart -
                          (source.foldSpace ? 1 : 0);
                        builder.add(
                          from,
                          absTo,
                          Decoration.replace({
                            widget: new FreshnessMarkWidget(
                              model,
                              source.foldSpace,
                            ),
                          }),
                        );
                      }
                    }
                  }
                }
              }
            } catch (error) {
              // One bad line never breaks the build.
            }
            if (typeof line.to !== "number" || line.to >= end) {
              break;
            }
            if (line.to < pos) {
              break;
            }
            pos = line.to + 1;
          }
        } catch (error) {
          continue;
        }
      }
      return builder.finish();
    } catch (error) {
      try {
        return Decoration.none;
      } catch (inner) {
        return null;
      }
    }
  }

  freshnessMarkExcludedAncestor(node, root) {
    try {
      let current =
        node && node.parentNode ? node.parentNode : null;
      let guard = 0;
      while (current && current !== root && guard < 100) {
        guard += 1;
        try {
          const tag =
            current.tagName || current.nodeName
              ? String(current.tagName || current.nodeName)
              : "";
          if (tag === "CODE" || tag === "code" || tag === "PRE" || tag === "pre") {
            return true;
          }
          let classText = "";
          try {
            if (
              current.classList &&
              typeof current.classList.contains === "function"
            ) {
              if (current.classList.contains("bob-fresh-mark")) {
                return true;
              }
              if (
                current.classList.contains("dataview") &&
                current.classList.contains("inline-field")
              ) {
                return true;
              }
            }
            if (typeof current.className === "string") {
              classText = current.className;
            } else if (typeof current.getAttribute === "function") {
              classText = current.getAttribute("class") || "";
            }
          } catch (error) {
            classText = "";
          }
          if (
            classText &&
            classText.indexOf("bob-fresh-mark") !== -1
          ) {
            return true;
          }
          if (
            classText &&
            classText.indexOf("dataview") !== -1 &&
            classText.indexOf("inline-field") !== -1
          ) {
            return true;
          }
        } catch (error) {
          // Keep walking on per-ancestor failure.
        }
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  renderFreshnessMarksIn(el, ctx) {
    try {
      if (!this.freshnessMarksEnabled) {
        return;
      }
      if (!el || !ctx) {
        return;
      }
      const path =
        typeof ctx.sourcePath === "string"
          ? ctx.sourcePath
          : ctx.sourcePath === null || ctx.sourcePath === undefined
            ? ""
            : String(ctx.sourcePath);
      const snapshot = this.freshnessMarkEnsureSnapshot();
      if (!snapshot) {
        return;
      }
      const textNodes = [];
      try {
        const docNode =
          (el.ownerDocument && el.ownerDocument) ||
          (typeof document !== "undefined" ? document : null);
        const showText =
          (docNode &&
            docNode.defaultView &&
            docNode.defaultView.NodeFilter &&
            docNode.defaultView.NodeFilter.SHOW_TEXT) ||
          (typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4);
        let walker = null;
        try {
          const creator =
            docNode && typeof docNode.createTreeWalker === "function"
              ? docNode
              : typeof document !== "undefined" &&
                  typeof document.createTreeWalker === "function"
                ? document
                : null;
          if (creator) {
            walker = creator.createTreeWalker(el, showText, {
              acceptNode: (node) => {
                try {
                  if (this.freshnessMarkExcludedAncestor(node, el)) {
                    return 2;
                  }
                  return 1;
                } catch (error) {
                  return 1;
                }
              },
            });
          }
        } catch (error) {
          walker = null;
        }
        if (walker) {
          let current = null;
          try {
            current = walker.nextNode();
          } catch (error) {
            current = null;
          }
          let guard = 0;
          while (current && guard < 10000) {
            guard += 1;
            try {
              const value =
                typeof current.nodeValue === "string"
                  ? current.nodeValue
                  : typeof current.textContent === "string"
                    ? current.textContent
                    : "";
              if (value.indexOf("fresh::") !== -1) {
                textNodes.push(current);
              }
            } catch (error) {
              // Skip unreadable nodes.
            }
            try {
              current = walker.nextNode();
            } catch (error) {
              break;
            }
          }
        } else {
          const stack = [el];
          let guard = 0;
          while (stack.length > 0 && guard < 10000) {
            guard += 1;
            const top = stack.pop();
            try {
              const children =
                (top && top.childNodes) || [];
              for (let index = children.length - 1; index >= 0; index -= 1) {
                const child = children[index];
                if (!child) {
                  continue;
                }
                const nodeType = child.nodeType;
                if (nodeType === 3) {
                  const value =
                    typeof child.nodeValue === "string"
                      ? child.nodeValue
                      : typeof child.textContent === "string"
                        ? child.textContent
                        : "";
                  if (
                    value.indexOf("fresh::") !== -1 &&
                    !this.freshnessMarkExcludedAncestor(child, el)
                  ) {
                    textNodes.push(child);
                  }
                } else if (nodeType === 1) {
                  if (!this.freshnessMarkExcludedAncestor(child, el)) {
                    const tag = String(child.tagName || child.nodeName || "");
                    if (
                      tag !== "CODE" &&
                      tag !== "code" &&
                      tag !== "PRE" &&
                      tag !== "pre"
                    ) {
                      stack.push(child);
                    }
                  }
                }
              }
            } catch (error) {
              continue;
            }
          }
        }
      } catch (error) {
        return;
      }
      for (const textNode of textNodes) {
        try {
          if (!textNode || !textNode.parentNode) {
            continue;
          }
          if (this.freshnessMarkExcludedAncestor(textNode, el)) {
            continue;
          }
          const value =
            typeof textNode.nodeValue === "string"
              ? textNode.nodeValue
              : typeof textNode.textContent === "string"
                ? textNode.textContent
                : "";
          if (!value || value.indexOf("fresh::") === -1) {
            continue;
          }
          const source = freshnessMarkSourceInText(value, snapshot.dateText);
          if (!source) {
            continue;
          }
          const model = this.freshnessMarkModelForText({ path, source });
          if (!model) {
            continue;
          }
          const parent = textNode.parentNode;
          if (!parent) {
            continue;
          }
          const docNode =
            textNode.ownerDocument ||
            (typeof document !== "undefined" ? document : null);
          if (!docNode) {
            continue;
          }
          const beforeText = value.slice(0, source.fieldStart);
          const afterText = value.slice(source.fieldEnd);
          const markEl = buildFreshnessMarkElement(docNode, model, {
            foldSpace: false,
          });
          if (!markEl) {
            continue;
          }
          try {
            if (beforeText) {
              parent.insertBefore(
                docNode.createTextNode(beforeText),
                textNode,
              );
            }
            parent.insertBefore(markEl, textNode);
            if (afterText) {
              parent.insertBefore(
                docNode.createTextNode(afterText),
                textNode,
              );
            }
            parent.removeChild(textNode);
          } catch (error) {
            continue;
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  toggleFreshnessMarks() {
    try {
      this.freshnessMarksEnabled = !this.freshnessMarksEnabled;
      const enabled = this.freshnessMarksEnabled;
      try {
        if (
          typeof document !== "undefined" &&
          document &&
          document.body &&
          document.body.classList
        ) {
          if (enabled) {
            if (typeof document.body.classList.add === "function") {
              document.body.classList.add("bob-fresh-marks");
            }
          } else if (typeof document.body.classList.remove === "function") {
            document.body.classList.remove("bob-fresh-marks");
          }
        }
      } catch (error) {
        // Body class is best-effort.
      }
      try {
        this.refreshFreshnessMarkEditors();
      } catch (error) {
        // Editor refresh is best-effort.
      }
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // Tasks re-render is best-effort.
      }
      try {
        new Notice(
          enabled ? "Freshness marks on" : "Freshness marks off",
        );
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.freshnessMarksEnabled;
    }
  }

  refreshFreshnessMarkEditors() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      for (const leaf of leaves) {
        try {
          const cm =
            leaf && leaf.view && leaf.view.editor
              ? leaf.view.editor.cm
              : null;
          if (cm && typeof cm.dispatch === "function" && freshnessMarksRefresh) {
            cm.dispatch({ effects: freshnessMarksRefresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh never throws.
    }
  }

  scheduleFreshnessMarksRefresh() {
    try {
      if (
        this.freshnessMarksTimer !== null &&
        this.freshnessMarksTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const self = this;
      this.freshnessMarksTimer = schedule(() => {
        self.freshnessMarksTimer = null;
        try {
          self.rebuildFreshnessMarkSnapshot();
        } catch (error) {
          // Rebuild is best-effort.
        }
        try {
          self.refreshFreshnessMarkEditors();
        } catch (error) {
          // Refresh is best-effort.
        }
      }, 150);
    } catch (error) {
      // No timer host; nothing to schedule.
    }
  }

  // __FRESHNESS_E1_END__

  resolveTodayLink(target, dailyPath) {
    try {
      const metadataCache = this.app && this.app.metadataCache;
      if (
        !metadataCache ||
        typeof metadataCache.getFirstLinkpathDest !== "function"
      ) {
        return null;
      }
      return metadataCache.getFirstLinkpathDest(target, dailyPath);
    } catch (error) {
      return null;
    }
  }

  // Rebuild the cache from daily-note text. When the key set changes,
  // every open Tasks query re-reads via TODAY_RELOAD_EVENT and the
  // bob-plan blocks re-render (debounced, like the existing re-render).
  // Returns true when the keys changed.
  rebuildTodayCache(content, dailyPath, now = new Date()) {
    if (!this.todayCache || !(this.todayCache.rank instanceof Map)) {
      this.todayCache = {
        date: null,
        dailyPath: null,
        keys: [],
        rank: new Map(),
      };
    }
    const links = computeTodayLinks(content, dailyPath);
    const keys = resolveTodayKeys(links, dailyPath, (target, daily) =>
      this.resolveTodayLink(target, daily),
    );
    const previous = this.todayCache.keys || [];
    const changed =
      previous.length !== keys.length ||
      previous.some((key, index) => key !== keys[index]);
    this.todayCache = {
      date: this.todayLocalDate(now),
      dailyPath,
      keys,
      rank: new Map(keys.map((key, index) => [key, index])),
    };
    if (changed) {
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // The cache is still correct; only the live refresh is skipped.
      }
      this.schedulePlanBlockRerender();
      this.scheduleFreshnessStatusBar();
      this.scheduleFreshnessMarksRefresh();
    }
    return changed;
  }

  currentTodayDailyPath(now = new Date()) {
    try {
      return todayDailyPath(now, getDailyNotesOptions(this.app));
    } catch (error) {
      return null;
    }
  }

  refreshTodayCacheFromDaily(now = new Date()) {
    const dailyPath = this.currentTodayDailyPath(now);
    if (!dailyPath) {
      return Promise.resolve(false);
    }
    return Promise.resolve(this.readPlanBlockContent(dailyPath)).then(
      (content) => {
        // A missing daily note means an empty Today, not an error.
        if (typeof content !== "string") {
          return this.rebuildTodayCache("", dailyPath, now);
        }
        return this.rebuildTodayCache(content, dailyPath, now);
      },
    );
  }

  refreshTodayCacheForChangedFile(file, data, now = new Date()) {
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    if (!changedPath) {
      return false;
    }
    if (!sameVaultPath(changedPath, this.currentTodayDailyPath(now))) {
      return false;
    }
    if (typeof data === "string") {
      this.rebuildTodayCache(data, changedPath, now);
      return true;
    }
    this.refreshTodayCacheFromDaily(now);
    return true;
  }

  refreshTodayCacheForVaultEvent(file, now = new Date()) {
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    if (!changedPath) {
      return false;
    }
    const candidates = [this.currentTodayDailyPath(now)];
    if (
      this.todayCache &&
      typeof this.todayCache.dailyPath === "string" &&
      this.todayCache.dailyPath
    ) {
      candidates.push(this.todayCache.dailyPath);
    }
    if (!candidates.some((candidate) => sameVaultPath(changedPath, candidate))) {
      return false;
    }
    this.refreshTodayCacheFromDaily(now);
    return true;
  }

  refreshTodayCacheForRollover(now = new Date()) {
    const dailyPath = this.currentTodayDailyPath(now);
    if (!dailyPath) {
      return false;
    }
    if (
      this.todayCache &&
      sameVaultPath(this.todayCache.dailyPath || "", dailyPath)
    ) {
      return false;
    }
    this.refreshTodayCacheFromDaily(now);
    return true;
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
      this.scheduleReadyRefresh();
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
    this.scheduleReadyRefresh();
  }

  rerenderPlanBlocks() {
    if (!this.planBlockViews) {
      try {
        this.refreshReadyBadges(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
      return;
    }
    for (const view of Array.from(this.planBlockViews)) {
      try {
        this.paintPlanBlock(view.el, view.sourcePath);
      } catch (error) {
        // One stale block never breaks the others.
      }
    }
    try {
      this.refreshReadyBadges(new Date());
    } catch (error) {
      // Best-effort refresh only.
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
            if (this.planPaintGens) {
              this.planPaintGens.delete(el);
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
            if (this.planPaintGens) {
              this.planPaintGens.delete(el);
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
    if (!this.planPaintGens) {
      this.planPaintGens = new Map();
    }
    const paintGen = (this.planPaintGens.get(el) || 0) + 1;
    this.planPaintGens.set(el, paintGen);
    Promise.resolve(this.readPlanBlockContent(targetPath))
      .then((content) => {
        if (this.planPaintGens.get(el) !== paintGen) {
          return;
        }
        if (!el || typeof el.empty !== "function") {
          return;
        }
        el.empty();
        const paintDay = new Date();
        // Gate READY from one validated snapshot; a missing snapshot
        // keeps the legacy ungated count and tooltip.
        let planGate = null;
        let planReview = null;
        try {
          const gateMemo = this.freshnessEnsureMemo(paintDay);
          if (gateMemo && gateMemo.tasksAvailable) {
            planGate = this.freshnessReviewPredicate(gateMemo);
            planReview = {
              new: gateMemo.counts.new,
              rotten:
                gateMemo.counts.resurfaced + gateMemo.counts.rotten,
            };
          }
        } catch (error) {
          planGate = null;
          planReview = null;
        }
        const model = planBlockModel({
          content,
          tasks,
          today: paintDay,
          caps,
          sourcePath,
          app: this.app,
          isToday: (task) => this.isTodayTask(task),
          isReviewBucket: planGate,
          review: planReview,
        });
        const container = el.createDiv({ cls: "bob-plan" });
        container.setAttribute("role", "status");
        container.setAttribute(
          "aria-label",
          `${model.planText}, ${model.pendingText}, ${model.nextText}, ${model.readyText}${model.over ? ", over plan" : ""}`,
        );
        const planChip = container.createEl("span", {
          cls: `bob-plan-chip bob-plan-plan${
            model.budget.status === "over" ? " bob-plan-over" : ""
          }`,
          text: model.planText,
          title: model.planTitle,
        });
        planChip.setAttribute("aria-label", `TODAY: ${model.planTitle}`);
        const laneChips = [
          {
            cls: "bob-plan-pending",
            text: model.pendingText,
            title: "Open PENDING tasks in dash",
            href: "dash#PENDING Tasks",
            over: model.hasTasks && model.pending.over,
          },
          {
            cls: "bob-plan-next",
            text: model.nextText,
            title: "Open NEXT tasks in dash",
            href: "dash#NEXT Tasks",
            over: model.hasTasks && model.next.over,
          },
        ];
        for (const chip of laneChips) {
          const laneChip = container.createEl("a", {
            cls: `bob-plan-chip ${chip.cls}${chip.over ? " bob-plan-over" : ""}`,
            text: chip.text,
            title: chip.title,
            href: chip.href,
          });
          laneChip.setAttribute("aria-label", chip.title);
          laneChip.addEventListener("click", (event) => {
            event.preventDefault();
            try {
              const workspace = this.app && this.app.workspace;
              if (workspace && typeof workspace.openLinkText === "function") {
                workspace.openLinkText(chip.href, "", false);
              }
            } catch (error) {
              // The chip still shows the count without the navigation.
            }
          });
        }
        try {
          this.paintReadyElement(container, model.ready ? { count: model.ready.count, cap: model.ready.cap, over: model.ready.over, lane: model.lane || null } : { count: null, cap: effectivePlanCaps(caps).maxReady }, {
            sourcePath: typeof sourcePath === "string" ? sourcePath : "",
            invalid,
          });
        } catch (error) {
          // The READY badge degrades to a placeholder; other chips stay.
        }
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

// --- Plan lane counter ----------------------------------------------------
// A lane task is a `#task` line the native Tasks engine matches with the
// NEXT or PENDING query in docs/plan.md. This mirrors that predicate over
// Tasks-plugin task objects (tolerant of the shapes Tasks and dataview
// expose).

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
// `isToday` is the caller's Today predicate over cached Tasks tasks
// (the plugin passes its synchronous cache); it still feeds READY.
// READY is the shared live current backlog (Today excluded); it never
// changes what the ledger's PLAN status means.
function planBlockModel({
  content,
  tasks,
  today,
  caps,
  sourcePath,
  app,
  isToday,
  isReviewBucket,
  review,
}) {
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
  const isTodayPredicate =
    typeof isToday === "function" ? isToday : () => false;
  const taskList = hasTasks ? tasks : [];
  const day = today === undefined ? new Date() : today;
  let next;
  let pending;
  try {
    next = laneBudgetFromTasks(taskList, day, effective, "next");
  } catch (error) {
    next = { count: 0, cap: effective.maxNext, over: false };
  }
  try {
    pending = laneBudgetFromTasks(taskList, day, effective, "pending");
  } catch (error) {
    pending = { count: 0, cap: effective.maxPending, over: false };
  }
  let ready = null;
  if (hasTasks) {
    try {
      ready = readyBudgetFromTasks(
        taskList,
        day,
        effective,
        isTodayPredicate,
        isReviewBucket,
      );
    } catch (error) {
      ready = null;
    }
  }
  const over =
    budget.status === "over" ||
    (hasTasks && (next.over || pending.over)) ||
    (hasTasks && ready && ready.over);
  const lintWarnings = budget.warnings.slice();
  if (hasTasks && next.over) {
    lintWarnings.push({
      code: PLAN_LINT_NEXT_CAP,
      message: `NEXT has ${next.count}/${next.cap} tasks; release some with Alt+N`,
    });
  }
  if (hasTasks && pending.over) {
    lintWarnings.push({
      code: PLAN_LINT_PENDING_CAP,
      message: `PENDING has ${pending.count}/${pending.cap} tasks; release some with Alt+N`,
    });
  }
  if (
    hasTasks &&
    ready &&
    Number.isInteger(ready.count) &&
    ready.over
  ) {
    lintWarnings.push({
      code: PLAN_LINT_READY_CAP,
      message: `READY has ${ready.count}/${ready.cap} tasks; prune at the weekly review`,
    });
  }
  const themeCounts = budget.entries
    .filter((entry) => !entry.exempt)
    .map((entry) => `${entry.name} ${entry.links}`);
  // Total lane pressure for the gated READY tooltip: the gated
  // count plus the NEW and ROTTEN buckets behind it. Without a review
  // breakdown the badge keeps its legacy tooltip.
  const reviewLane =
    review &&
    Number.isInteger(review.new) &&
    review.new >= 0 &&
    Number.isInteger(review.rotten) &&
    review.rotten >= 0 &&
    ready &&
    Number.isInteger(ready.count) &&
    ready.count >= 0
      ? {
          total: review.new + review.rotten + ready.count,
          new: review.new,
          rotten: review.rotten,
          ready: ready.count,
        }
      : null;
  const readyModel = readyBadgeModel(
    ready
      ? { count: ready.count, cap: ready.cap, over: ready.over }
      : { count: null, cap: effective.maxReady },
    reviewLane ? { lane: reviewLane } : {},
  );
  return {
    targetPath,
    hasContent: typeof content === "string",
    hasTasks,
    planText: budget.hasSection
      ? `TODAY ${budget.themes.count}/${budget.themes.cap} · ${budget.links.count}/${budget.links.cap}`
      : "TODAY –",
    planTitle: budget.hasSection
      ? themeCounts.join(" · ") || "no themes"
      : "no Pomodoros section",
    nextText: hasTasks ? `NEXT ${next.count}/${next.cap}` : "NEXT –",
    pendingText: hasTasks
      ? `PENDING ${pending.count}/${pending.cap}`
      : "PENDING –",
    readyText: hasTasks ? readyModel.text : "READY –",
    readyModel,
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
    next,
    pending,
    ready,
    lane: reviewLane,
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
  normalizePlanComponent,
  splitPlanComponents,
  computePlanBudget,
  emptyPlanBudget,
  computeTodayLinks,
  resolveTodayKeys,
  laneBudgetFromTasks,
  readyCountFromTasks,
  readyBudgetFromTasks,
  readyBadgeModel,
  readyTaskVisible,
  readyTaskStatusIsTodo,
  loadPlanCaps,
  planConfigPath,
  planBlockTargetPath,
  planBlockModel,
  planSectionRange,
  TODAY_RELOAD_EVENT,
  freshnessInlineFields,
  parseFreshDateStrict,
  freshDateAddDays,
  freshDateDiffDays,
  freshnessTasksSuffixStart,
  freshnessStampLine,
  freshnessSetRefreshLine,
  readFreshness,
  defaultFreshnessConfig,
  freshnessBlock,
  coerceFreshnessConfig,
  loadFreshnessConfig,
  freshnessParseNoteRefresh,
  freshnessIntervalFor,
  freshnessEvaluate,
  freshnessState,
  freshnessBucketForState,
  freshnessQueue,
  freshnessCounts,
  freshnessCollectLints,
  freshnessStatusView,
  freshnessDayNumberForDateText,
  freshnessReviewModel,
  freshnessReviewUnavailable,
  freshnessMemoReviewChanged,
  reviewChipText,
  reviewChipClass,
  reviewChipHref,
  paintReviewElement,
  setReviewAnchorContent,
  freshnessRowFromTask,
  freshnessTierForState,
  freshnessTaskStatus,
  freshnessMarkSource,
  freshnessMarkSourceInText,
  freshnessMarkResolution,
  freshnessMarkModel,
  freshnessMarkConsensus,
  freshnessShortDate,
  buildFreshnessMarkElement,
  freshnessMarkPosInCode,
};
