const { MarkdownView, Notice, Plugin, normalizePath } = require("obsidian");
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
const TRIGGER_RE = /(^|[^A-Za-z0-9_])((?:dt|[dt])-?\d+|se\d*(?:-\d*)?|ta)$/;
const LEDGER_TRIGGER_RE = /^se(\d*)(?:-(\d*))?$/;
const DATE_TIME_TRIGGER_RE = /^(dt|[dt])(-?\d+)$/;
const WORD_CHAR_RE = /[A-Za-z0-9_]/;
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

function parseTrigger(textBeforeCursor) {
  const text = String(textBeforeCursor || "");
  const match = TRIGGER_RE.exec(text);

  if (!match) {
    return null;
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

    return {
      kind: prefix === "dt" ? "datetime" : prefix === "d" ? "date" : "time",
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

function findExpansion(line, cursorCh, now = new Date()) {
  if (typeof line !== "string" || !Number.isInteger(cursorCh)) {
    return null;
  }

  if (cursorCh < 0 || cursorCh > line.length) {
    return null;
  }

  const trigger = parseTrigger(line.slice(0, cursorCh));
  if (!trigger || isWordChar(line[cursorCh])) {
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

  try {
    if (typeof workspace.revealLeaf === "function") {
      await workspace.revealLeaf(leaf);
    } else if (typeof workspace.setActiveLeaf === "function") {
      await workspace.setActiveLeaf(leaf, { focus: true });
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }

  return (
    (await waitForMarkdownLeafViewByPath(leaf, options)) ||
    waitForActiveMarkdownView(app, options)
  );
}

async function openTodayDailyNote(app, options = {}) {
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
    return activateMarkdownLeaf(app, existingLeaf, {
      path: dailyPath,
      attempts,
      delayMs,
    });
  }

  if (await executeDailyNotesCommand(app)) {
    const commandView = await waitForActiveMarkdownView(app, {
      path: dailyPath,
      attempts,
      delayMs,
    });
    if (commandView) {
      return commandView;
    }
  }

  const file = await resolveOrCreateDailyFile(app, dailyPath);
  if (!file || !(await openVaultFile(app, file))) {
    return null;
  }

  return (
    (await waitForActiveMarkdownView(app, {
      path: dailyPath,
      attempts,
      delayMs,
    })) || getActiveMarkdownView(app)
  );
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

module.exports = class BobLedgerToolsPlugin extends Plugin {
  onload() {
    this.vimMappingsRegistered = false;
    this.pendingCenterDeferred = null;

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

    this.app.workspace.onLayoutReady(() => {
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
    cancelDeferred(this.pendingCenterDeferred);
    this.pendingCenterDeferred = null;
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
    const lines = getEditorLines(cm);
    if (!lines) {
      new Notice("No active markdown editor");
      return false;
    }

    const { target, error } = getJumpPomodoroTarget(lines);
    if (!target) {
      return this.openDailyFallbackAndJump(error);
    }

    return this.jumpToPomodoroTarget(cm, target);
  }

  jumpToPomodoroTarget(cm, target) {
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

  async openDailyFallbackAndJump(error) {
    if (isTodayDailyFile(this.app, getActiveFile(this.app))) {
      new Notice(error || "No active Pomodoro line found");
      return false;
    }

    const view = await openTodayDailyNote(this.app);
    if (!view || !view.editor) {
      new Notice("Could not open daily note");
      return false;
    }

    const lines = getEditorLines(view.editor);
    if (!lines) {
      new Notice("Could not open daily note");
      return false;
    }

    const { target, error: dailyError } = getJumpPomodoroTarget(lines);
    if (!target) {
      new Notice(dailyError || "No active Pomodoro line found");
      return false;
    }

    return this.jumpToPomodoroTarget(view.editor, target);
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

module.exports.helpers = {
  parseTrigger,
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
  openTodayDailyNote,
  deferToNextFrame,
  cancelDeferred,
  findExpansion,
  expandLineAtCursor,
  expansionCursorCh,
};
