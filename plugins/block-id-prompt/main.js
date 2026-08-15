const {
  MarkdownView,
  Modal,
  Notice,
  normalizePath,
  Plugin,
  Setting,
  setIcon,
  TFile,
} = require("obsidian");
const { EditorView } = require("@codemirror/view");

const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK_RE = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const FRONTMATTER_DELIMITER_RE = /^\s*(?:---|\.\.\.)\s*$/;
const OPENING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^( {0,3})(`{3,}|~{3,})\s*$/;
const BLOCKED_OBSIDIAN_TASK_STATUS = "?";
const OPEN_OBSIDIAN_TASK_STATUSES = new Set([
  " ",
  "/",
  "*",
  BLOCKED_OBSIDIAN_TASK_STATUS,
]);
const DONE_OBSIDIAN_TASK_STATUSES = new Set(["x", "X", "-"]);
const OBSIDIAN_TASK_LINE_RE =
  /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[([^\]\n])\](?:\s+(.*))?$/;
const TASK_CHECKBOX_STATUS_RE =
  /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)[^\]\n](\])/;
const PROJECT_TASK_TAG_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/;
const PROJECT_TASK_TAG_GLOBAL_RE = /(^|[\s([{])#task(?=$|[\s)\]},.;:!?])/g;
const HIDE_TASK_TAG_RE = /(^|[\s([{])#hide(?=$|[\s)\]},.;:!?])/;
const HIDE_TASK_TAG_GLOBAL_RE = /(^|[\s([{])#hide(?=$|[\s)\]},.;:!?])/g;
const TRAILING_BLOCK_ID_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const INLINE_ID_FIELD_RE = /\[id::([ \t]*)([^\]\n]*?)([ \t]*)\]/;
const INLINE_DEPENDS_ON_FIELD_RE = /\[dependsOn::([ \t]*)([^\]\n]*?)([ \t]*)\]/g;
const TASKS_INLINE_FIELD_RE = /[ \t]*\[[^\[\]\n]+::[^\]\n]*\]/g;
const TASKS_EMOJI_DATE_RE =
  /[ \t]*(?:[\u2600-\u27BF]|\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF])\s*\d{4}-\d{2}-\d{2}/g;
// Keep these Pomodoro ledger recognizers in sync with bob-ledger-tools/main.js.
const POMODOROS_HEADING_RE = /^##\s+Pomodoros(?:\s.*)?$/;
const LEVEL_TWO_HEADING_RE = /^##\s+/;
const LEDGER_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[([ /xX-])\]\s+)/;
const LIST_ITEM_RE = /^([ \t]*)(?:[-*+]|\d+[.)])\s+/;
const LIST_ITEM_PREFIX_RE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/;
const PLACEHOLDER_RE = /\(\s*\)/;
const COLON_TIME_RANGE_RE =
  /\((\*\*)?(\d\d):(\d\d)\s*-\s*(\d\d):(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const COMPACT_TIME_RANGE_RE =
  /\((\*\*)?(\d\d)(\d\d)\s*-\s*(\d\d)(\d\d)(\*\*)?(\s+[^)]*)?\)/;
const CANONICAL_BLOCK_LINK_PREFIX = "#^";
const SCAN_DEBOUNCE_MS = 75;
const EDIT_SUPPRESS_MS = 250;
// Recognizes the same task-level `scheduled` forms as `bob task-status-hooks`:
// `[scheduled:: YYYY-MM-DD]` and `(scheduled:: YYYY-MM-DD)`, anywhere on the
// line and in any field order. The captured value is validated separately so
// a malformed date still counts toward "more than one recognized field".
const SCHEDULED_FIELD_RE = /\[scheduled::([^\]\n]*)\]|\(scheduled::([^)\n]*)\)/g;
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
// Managed "schedule log" child bullet, mirroring
// bob-navigation-hotkeys/main.js's SCHEDULE_LOG_PARENT_RE: `🗓️ **SCHEDULE LOG**`,
// the emoji-less `**SCHEDULE LOG**`, and the legacy `**Schedule log:**` spelling.
// Kept as an independent copy here since plugins are deployed separately and
// must not import each other's main.js.
const SCHEDULE_LOG_EMOJI = "🗓️";
const SCHEDULE_LOG_LABEL = "SCHEDULE LOG";
const LEGACY_SCHEDULE_LOG_LABEL = "Schedule log";
const SCHEDULE_LOG_PARENT_RE = new RegExp(
  `^([ \\t]*)([-*+]|\\d+[.)])[ \\t]+(?:${SCHEDULE_LOG_EMOJI}[ \\t]+)?\\*\\*(?:${SCHEDULE_LOG_LABEL}|${LEGACY_SCHEDULE_LOG_LABEL}):?\\*\\*[ \\t]*$`,
);
const SCHEDULE_LOG_ENTRY_EMPHASIS = "_";
const SCHEDULE_LOG_TRANSITION = " → ";
const SCHEDULE_LOG_SEPARATOR = " — ";
const SCHEDULE_LOG_POMODORO_REASON = "🍅 pulled into today's Pomodoro";
// Daily Notes core-plugin lookup and filename-format parsing, mirroring
// bob-ledger-tools/main.js. Kept as an independent copy for the same reason
// as the Schedule Log constants above: plugins are deployed separately and
// must not import each other's main.js.
const DAILY_NOTES_COMMAND_ID = "daily-notes";
const DEFAULT_DAILY_NOTES_FORMAT = "YYYY/YYYYMMDD";
const DAILY_FORMAT_TOKENS = ["YYYY", "YY", "MM", "DD", "M", "D"];
// The canonical fallback indentation for a new Pomodoro sub-bullet when
// neither the target entry nor the rest of the section has an existing child
// bullet to copy indentation from. Mirrors bob-cli's `bob capture` default.
const CANONICAL_POMODORO_CHILD_INDENT = "  ";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch (error) {
    return value;
  }
}

function stripWrappingQuotes(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function normalizeLinkTarget(value) {
  let target = normalizeText(value);
  if (!target) {
    return "";
  }

  target = stripWrappingQuotes(target);
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }

  return safeDecodeUri(target);
}

function minPositiveIndex(first, second) {
  if (first === -1) {
    return second;
  }

  if (second === -1) {
    return first;
  }

  return Math.min(first, second);
}

function findSubpathIndex(linkText) {
  const headingIndex = linkText.indexOf("#");
  const blockIndex = linkText.indexOf("^");

  return minPositiveIndex(headingIndex, blockIndex);
}

function stripLinkSubpath(linkText) {
  const subpathIndex = findSubpathIndex(linkText);
  return subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
}

function stripMarkdownExtension(linkText) {
  const subpathIndex = findSubpathIndex(linkText);
  const pathPart = subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
  const subpathPart = subpathIndex === -1 ? "" : linkText.slice(subpathIndex);

  return pathPart.replace(/\.md$/i, "") + subpathPart;
}

function sourceKey(source) {
  return [
    source.kind || "marker-link",
    source.sourcePath,
    source.line,
    source.startCh,
    source.endCh,
    source.oldId,
  ].join(":");
}

function splitWikiLinkBody(body) {
  const pipeIndex = body.indexOf("|");
  return {
    destination: pipeIndex === -1 ? body : body.slice(0, pipeIndex),
    aliasSuffix: pipeIndex === -1 ? "" : body.slice(pipeIndex),
  };
}

function parseTaskPickerPosition(destination) {
  let blockPrefix;
  let targetText;

  if (destination.endsWith("#^")) {
    blockPrefix = "#^";
    targetText = destination.slice(0, -2);
  } else if (destination.endsWith("^")) {
    blockPrefix = "^";
    targetText = destination.slice(0, -1);
  } else {
    return null;
  }

  if (targetText.includes("^")) {
    return null;
  }

  return { targetText, blockPrefix };
}

function taskPickerMarkerFromPosition(
  match,
  position,
  aliasSuffix,
  raw,
  endCh,
  markerStartCh,
  markerEndCh,
) {
  const parsedPosition = parseTaskPickerPosition(position);
  if (!parsedPosition) {
    return null;
  }

  return {
    kind: "link-task-picker",
    raw,
    ...parsedPosition,
    aliasSuffix,
    startCh: match.index,
    endCh,
    markerStartCh,
    markerEndCh,
  };
}

function parseTrailingTaskPickerMarker(match) {
  const raw = match[0];
  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  let markerLength;

  if (destination.endsWith("#^^")) {
    markerLength = 3;
  } else if (destination.endsWith("^^")) {
    markerLength = 2;
  } else {
    return null;
  }

  const markerStartCh = match.index + 2 + destination.length - markerLength;
  const markerEndCh = match.index + 2 + destination.length;
  const rawBase = destination.slice(0, destination.length - markerLength);
  if (rawBase.endsWith("^")) {
    return null;
  }

  const base = markerLength === 3 ? `${rawBase}#` : rawBase;
  const position = `${getCaretCompletionDestination(base)}^`;

  return taskPickerMarkerFromPosition(
    match,
    position,
    aliasSuffix,
    raw,
    match.index + raw.length,
    markerStartCh,
    markerEndCh,
  );
}

function parseRapidTaskPickerMarker(match, lineText) {
  const linkRaw = match[0];
  const markerStartCh = match.index + linkRaw.length;
  if (
    lineText.slice(markerStartCh, markerStartCh + 2) !== "^^" ||
    lineText[markerStartCh + 2] === "^"
  ) {
    return null;
  }

  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  if (!normalizeText(destination)) {
    return null;
  }

  const position = `${getCaretCompletionDestination(destination)}^`;
  const markerEndCh = markerStartCh + 2;

  return taskPickerMarkerFromPosition(
    match,
    position,
    aliasSuffix,
    lineText.slice(match.index, markerEndCh),
    markerEndCh,
    markerStartCh,
    markerEndCh,
  );
}

function parseInlineMarkerLink(match) {
  const raw = match[0];
  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  const markerIndex = destination.lastIndexOf("#^^");

  if (markerIndex === -1) {
    return null;
  }

  const oldId = destination.slice(markerIndex + 3);
  if (!BLOCK_ID_RE.test(oldId)) {
    return null;
  }

  return {
    raw,
    targetText: destination.slice(0, markerIndex),
    oldId,
    aliasSuffix,
    blockPrefix: "#^",
    startCh: match.index,
    endCh: match.index + raw.length,
  };
}

function parseTrailingBlockDestination(destination) {
  const hashBlockIndex = destination.lastIndexOf("#^");
  if (hashBlockIndex !== -1) {
    const oldId = destination.slice(hashBlockIndex + 2);
    if (!BLOCK_ID_RE.test(oldId)) {
      return null;
    }

    return {
      targetText: destination.slice(0, hashBlockIndex),
      oldId,
      blockPrefix: "#^",
    };
  }

  const bareBlockIndex = destination.lastIndexOf("^");
  if (bareBlockIndex === -1) {
    return null;
  }

  const oldId = destination.slice(bareBlockIndex + 1);
  if (!BLOCK_ID_RE.test(oldId)) {
    return null;
  }

  return {
    targetText: destination.slice(0, bareBlockIndex),
    oldId,
    blockPrefix: "^",
  };
}

function getCaretCompletionDestination(destination) {
  const path = stripLinkSubpath(destination);
  return path === destination ? path : `${path}#`;
}

function hasSingleTrailingMarker(lineText, markerCh, markerChar) {
  return (
    lineText[markerCh] === markerChar && lineText[markerCh + 1] !== markerChar
  );
}

function parseTrailingAtBlockRenameMarker(match, lineText) {
  const raw = match[0];
  const markerCh = match.index + raw.length;
  if (!hasSingleTrailingMarker(lineText, markerCh, "@")) {
    return null;
  }

  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  const parsedDestination = parseTrailingBlockDestination(destination);
  if (!parsedDestination) {
    return null;
  }

  return {
    raw: raw + "@",
    ...parsedDestination,
    aliasSuffix,
    startCh: match.index,
    endCh: markerCh + 1,
  };
}

function parseTrailingCaretCompletionMarker(match, lineText) {
  const raw = match[0];
  const markerCh = match.index + raw.length;
  if (!hasSingleTrailingMarker(lineText, markerCh, "^")) {
    return null;
  }

  const { destination } = splitWikiLinkBody(match[1]);
  if (!normalizeText(destination)) {
    return null;
  }

  const completionDestination = getCaretCompletionDestination(destination);
  const insertionCh = match.index + 2 + completionDestination.length;

  return {
    kind: "file-link-jump",
    raw: raw + "^",
    destination,
    plainReplacement: `[[${completionDestination}]]`,
    completionReplacement: `[[${completionDestination}^]]`,
    startCh: match.index,
    endCh: markerCh + 1,
    insertionCh,
    finalCursorCh: insertionCh + 1,
  };
}

function parseMarkerLink(match, lineText) {
  return (
    parseTrailingCaretCompletionMarker(match, lineText) ||
    parseTrailingAtBlockRenameMarker(match, lineText) ||
    parseInlineMarkerLink(match)
  );
}

function parseBlockReferenceDestination(destination, options = {}) {
  const markerIndex = destination.lastIndexOf("#^^");
  if (markerIndex !== -1) {
    const oldId = destination.slice(markerIndex + 3);
    if (!BLOCK_ID_RE.test(oldId)) {
      return null;
    }

    return {
      targetText: destination.slice(0, markerIndex),
      oldId,
      blockPrefix: "#^",
    };
  }

  const hashBlockIndex = destination.lastIndexOf("#^");
  if (hashBlockIndex !== -1) {
    const oldId = destination.slice(hashBlockIndex + 2);
    if (!BLOCK_ID_RE.test(oldId)) {
      return null;
    }

    return {
      targetText: destination.slice(0, hashBlockIndex),
      oldId,
      blockPrefix: "#^",
    };
  }

  const bareBlockIndex = destination.lastIndexOf("^");
  if (
    bareBlockIndex === -1 ||
    (bareBlockIndex !== 0 && !options.allowPathBareBlock)
  ) {
    return null;
  }

  const oldId = destination.slice(bareBlockIndex + 1);
  if (!BLOCK_ID_RE.test(oldId)) {
    return null;
  }

  return {
    targetText: destination.slice(0, bareBlockIndex),
    oldId,
    blockPrefix: "^",
  };
}

function parseWikiBlockReference(match, lineText) {
  const raw = match[0];
  const markerCh = match.index + raw.length;
  const hasTrailingMarker =
    hasSingleTrailingMarker(lineText, markerCh, "^") ||
    hasSingleTrailingMarker(lineText, markerCh, "@");
  const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
  const parsedDestination = parseBlockReferenceDestination(destination, {
    allowPathBareBlock: true,
  });

  if (!parsedDestination) {
    return null;
  }

  const endCh = hasTrailingMarker ? markerCh + 1 : markerCh;

  return {
    raw: lineText.slice(match.index, endCh),
    ...parsedDestination,
    aliasSuffix,
    startCh: match.index,
    endCh,
  };
}

function findMarkerLinkNearCursor(lineText, cursorCh) {
  const candidates = [];
  let match;

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
    const parsed = parseMarkerLink(match, lineText);
    if (!parsed) {
      continue;
    }

    const cursorInside =
      cursorCh >= parsed.startCh && cursorCh <= parsed.endCh;
    const cursorJustAfter =
      cursorCh > parsed.endCh && cursorCh - parsed.endCh <= 2;
    if (!cursorInside && !cursorJustAfter) {
      continue;
    }

    candidates.push({
      ...parsed,
      distance: Math.abs(cursorCh - parsed.endCh),
    });
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0] || null;
}

function findTaskPickerMarkerNearCursor(lineText, cursorCh) {
  const candidates = [];
  let match;

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
    const parsed =
      parseTrailingTaskPickerMarker(match) ||
      parseRapidTaskPickerMarker(match, lineText);
    if (!parsed) {
      continue;
    }

    const cursorAtMarker =
      cursorCh >= parsed.markerStartCh && cursorCh <= parsed.markerEndCh + 2;
    if (!cursorAtMarker) {
      continue;
    }

    candidates.push({
      ...parsed,
      distance: Math.abs(cursorCh - parsed.markerEndCh),
    });
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0] || null;
}

function cursorDistanceToRange(cursorCh, startCh, endCh) {
  if (cursorCh < startCh) {
    return startCh - cursorCh;
  }

  if (cursorCh > endCh) {
    return cursorCh - endCh;
  }

  return 0;
}

function findBlockReferenceOnLine(lineText, cursorCh) {
  const candidates = [];
  let match;

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
    const raw = match[0];
    const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
    const parsedDestination = parseBlockReferenceDestination(destination, {
      allowPathBareBlock: true,
    });
    if (!parsedDestination) {
      continue;
    }

    const linkStartCh =
      match.index > 0 && lineText[match.index - 1] === "!"
        ? match.index - 1
        : match.index;
    const endCh = match.index + raw.length;
    const cursorInside = cursorCh >= linkStartCh && cursorCh <= endCh;

    candidates.push({
      kind: "link-block",
      raw,
      ...parsedDestination,
      aliasSuffix,
      startCh: match.index,
      endCh,
      prefillId: true,
      cursorInside,
      distance: cursorDistanceToRange(cursorCh, linkStartCh, endCh),
    });
  }

  candidates.sort((left, right) => {
    if (left.cursorInside !== right.cursorInside) {
      return left.cursorInside ? -1 : 1;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    return left.startCh - right.startCh;
  });

  return candidates[0] || null;
}

function getFenceOpening(line) {
  const match = String(line || "").match(OPENING_FENCE_RE);
  if (!match) {
    return null;
  }

  return {
    markerChar: match[2][0],
    markerLength: match[2].length,
  };
}

function isClosingFence(line, openingFence) {
  const match = String(line || "").match(CLOSING_FENCE_RE);
  if (!match) {
    return false;
  }

  return (
    match[2][0] === openingFence.markerChar &&
    match[2].length >= openingFence.markerLength
  );
}

function lineIsInsideCodeFence(editor, lineNumber) {
  let activeFence = null;

  for (let line = 0; line <= lineNumber; line += 1) {
    const lineText = editor.getLine(line) || "";

    if (!activeFence) {
      const openingFence = getFenceOpening(lineText);
      if (openingFence) {
        activeFence = openingFence;
      }
      continue;
    }

    if (isClosingFence(lineText, activeFence)) {
      if (line === lineNumber) {
        return true;
      }

      activeFence = null;
    }
  }

  return Boolean(activeFence);
}

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
  text = stripInternalTaskTags(text)
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text || "(untitled task)";
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

function isEditorPosition(position) {
  return (
    position &&
    Number.isInteger(position.line) &&
    Number.isInteger(position.ch) &&
    position.line >= 0 &&
    position.ch >= 0
  );
}

function compareEditorPositions(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.ch - right.ch;
}

function getSingleEditorSelection(editor) {
  if (!editor || typeof editor.getCursor !== "function") {
    return null;
  }

  if (typeof editor.listSelections === "function") {
    const selections = editor.listSelections();
    if (!Array.isArray(selections) || selections.length !== 1) {
      return null;
    }

    const selection = selections[0] || {};
    const anchor = selection.anchor || selection.from;
    const head = selection.head || selection.to;
    if (!isEditorPosition(anchor) || !isEditorPosition(head)) {
      return null;
    }

    const from = compareEditorPositions(anchor, head) <= 0 ? anchor : head;
    const to = from === anchor ? head : anchor;
    return {
      anchor,
      head,
      from,
      to,
      empty: compareEditorPositions(anchor, head) === 0,
    };
  }

  const cursor = editor.getCursor();
  if (!isEditorPosition(cursor)) {
    return null;
  }

  return {
    anchor: cursor,
    head: cursor,
    from: cursor,
    to: cursor,
    empty: true,
  };
}

function selectedLineSpan(selection) {
  let endLine = selection.to.line;
  if (!selection.empty && selection.to.ch === 0 && endLine > selection.from.line) {
    endLine -= 1;
  }

  return {
    startLine: selection.from.line,
    endLine,
  };
}

function lineStartIndexFromLines(lines, lineNumber) {
  let index = 0;
  for (let line = 0; line < lineNumber; line += 1) {
    index += lines[line].length + 1;
  }

  return index;
}

function lineEndIndexFromLines(lines, lineNumber) {
  return lineStartIndexFromLines(lines, lineNumber) + lines[lineNumber].length;
}

function contentLineAt(content, lineNumber) {
  const lines = String(content || "").split("\n");
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  return lines[lineNumber];
}

function setCheckboxStatus(lineText, newStatus) {
  const text = String(lineText || "");
  const match = TASK_CHECKBOX_STATUS_RE.exec(text);
  if (!match) {
    return null;
  }

  const statusStart = match[1].length;
  return text.slice(0, statusStart) + newStatus + text.slice(statusStart + 1);
}

function isPomodorosHeadingLine(lineText) {
  return POMODOROS_HEADING_RE.test(normalizeMarkdownLine(lineText));
}

function isLevelTwoHeadingLine(lineText) {
  return LEVEL_TWO_HEADING_RE.test(normalizeMarkdownLine(lineText));
}

function findPomodorosSectionRange(lines) {
  if (!Array.isArray(lines)) {
    return null;
  }

  const headingLine = lines.findIndex((line) =>
    isPomodorosHeadingLine(line),
  );
  if (headingLine === -1) {
    return null;
  }

  let endLine = lines.length - 1;
  for (let line = headingLine + 1; line < lines.length; line += 1) {
    if (isLevelTwoHeadingLine(lines[line])) {
      endLine = line - 1;
      break;
    }
  }

  return {
    startLine: headingLine + 1,
    endLine,
  };
}

function minutesFromTimeParts(hoursText, minutesText) {
  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function timeRangeFromMatch(match) {
  const openingBold = match[1] || "";
  const closingBold = match[6] || "";
  if (Boolean(openingBold) !== Boolean(closingBold)) {
    return null;
  }

  const startMinutes = minutesFromTimeParts(match[2], match[3]);
  const endMinutes = minutesFromTimeParts(match[4], match[5]);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  return { startMinutes, endMinutes };
}

function parsePomodoroTimeRange(lineText) {
  const text = String(lineText || "");
  let match = COLON_TIME_RANGE_RE.exec(text);
  if (match) {
    return timeRangeFromMatch(match);
  }

  match = COMPACT_TIME_RANGE_RE.exec(text);
  return match ? timeRangeFromMatch(match) : null;
}

function hasPomodoroTimeRange(lineText) {
  return parsePomodoroTimeRange(lineText) !== null;
}

function isPomodoroEntryLine(lineText) {
  const text = normalizeMarkdownLine(lineText);
  if (lineIndentWidth(text) !== 0 || !LEDGER_LINE_RE.test(text)) {
    return false;
  }

  return PLACEHOLDER_RE.test(text) || hasPomodoroTimeRange(text);
}

function pomodoroEntryStatus(lineText) {
  const text = normalizeMarkdownLine(lineText);
  if (!isPomodoroEntryLine(text)) {
    return null;
  }

  const match = LEDGER_LINE_RE.exec(text);
  return match ? match[2] : null;
}

function isOpenPomodoroStatus(status) {
  return typeof status === "string" && !DONE_OBSIDIAN_TASK_STATUSES.has(status);
}

function lineIndentWidth(lineText) {
  const match = /^[ \t]*/.exec(String(lineText || ""));
  return match ? match[0].length : 0;
}

function isListItemLine(lineText) {
  return LIST_ITEM_RE.test(normalizeMarkdownLine(lineText));
}

function findPomodoroSourceContext(lines, lineNumber) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(lineNumber) ||
    lineNumber < 0 ||
    lineNumber >= lines.length
  ) {
    return null;
  }

  const section = findPomodorosSectionRange(lines);
  if (
    !section ||
    lineNumber < section.startLine ||
    lineNumber > section.endLine ||
    !isListItemLine(lines[lineNumber])
  ) {
    return null;
  }

  let currentIndent = lineIndentWidth(lines[lineNumber]);
  if (currentIndent <= 0) {
    return null;
  }

  for (let line = lineNumber - 1; line >= section.startLine; line -= 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim() || !isListItemLine(lineText)) {
      continue;
    }

    const ancestorIndent = lineIndentWidth(lineText);
    if (ancestorIndent >= currentIndent) {
      continue;
    }

    if (isPomodoroEntryLine(lineText)) {
      const status = pomodoroEntryStatus(lineText);
      return {
        section,
        ownerLine: line,
        status,
        isOpen: isOpenPomodoroStatus(status),
      };
    }

    currentIndent = ancestorIndent;
    if (currentIndent <= 0) {
      return null;
    }
  }

  return null;
}

function isPomodoroSubBulletLine(lines, lineNumber) {
  return findPomodoroSourceContext(lines, lineNumber) !== null;
}

function parseScheduleLogMarkerLine(lineText) {
  const match = SCHEDULE_LOG_PARENT_RE.exec(normalizeMarkdownLine(lineText));
  return match ? { indent: match[1], marker: match[2] } : null;
}

// The exclusive-of-nothing-past-it last line of `parentLine`'s child block:
// every later line that is blank or indented deeper than the parent, stopping
// at the first nonblank line indented at or shallower than the parent.
function findChildBlockEndLine(lines, parentLine) {
  const parentIndent = lineIndentWidth(lines[parentLine] || "");
  let endLine = parentLine;

  for (let line = parentLine + 1; line < lines.length; line += 1) {
    const lineText = normalizeMarkdownLine(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    if (lineIndentWidth(lineText) > parentIndent) {
      endLine = line;
      continue;
    }

    break;
  }

  return endLine;
}

// Scanning backward from `childLine`, the nearest earlier list item whose
// indent is strictly smaller. Non-list lines with a smaller indent are
// skipped rather than stopping the search, matching
// bob-navigation-hotkeys/main.js's findNearestParentListItem.
function findNearestParentListItemLine(lines, childLine) {
  if (!Number.isInteger(childLine) || childLine <= 0) {
    return null;
  }

  const childIndent = lineIndentWidth(lines[childLine] || "");
  for (let line = childLine - 1; line >= 0; line -= 1) {
    const lineText = normalizeMarkdownLine(lines[line] || "");
    if (!lineText.trim() || lineIndentWidth(lineText) >= childIndent) {
      continue;
    }

    if (isListItemLine(lineText)) {
      return line;
    }
  }

  return null;
}

// The managed Schedule Log marker among `taskLine`'s direct children, or null.
// A marker belonging to a nested grandchild is ignored.
function findScheduleLogMarker(lines, taskLine) {
  if (!Array.isArray(lines) || !Number.isInteger(taskLine) || taskLine < 0 || taskLine >= lines.length) {
    return null;
  }

  const endLine = findChildBlockEndLine(lines, taskLine);
  for (let line = taskLine + 1; line <= endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    const parsed = parseScheduleLogMarkerLine(lineText);
    if (parsed && findNearestParentListItemLine(lines, line) === taskLine) {
      return { line, indent: parsed.indent, marker: parsed.marker };
    }
  }

  return null;
}

// The indentation for a new entry under `markerLine`: reuse an existing direct
// child's indentation when the marker already has entries, otherwise the
// marker's own indent plus one tab.
function findScheduleLogEntryIndent(lines, markerLine) {
  const markerIndent = (/^[ \t]*/.exec(String(lines[markerLine] || "")) || [""])[0];
  const endLine = findChildBlockEndLine(lines, markerLine);

  for (let line = markerLine + 1; line <= endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    if (isListItemLine(lineText) && findNearestParentListItemLine(lines, line) === markerLine) {
      return (/^[ \t]*/.exec(normalizeMarkdownLine(lineText)) || [""])[0];
    }
  }

  return `${markerIndent}\t`;
}

function formatScheduleLogEntryLine(indent, marker, oldDateText, newDateText) {
  return `${indent}${marker} ${SCHEDULE_LOG_ENTRY_EMPHASIS}${oldDateText}${SCHEDULE_LOG_TRANSITION}${newDateText}${SCHEDULE_LOG_ENTRY_EMPHASIS}${SCHEDULE_LOG_SEPARATOR}${SCHEDULE_LOG_POMODORO_REASON}`;
}

function sourcePomodoroContext(source) {
  if (
    !source ||
    !source.editor ||
    typeof source.editor.getValue !== "function" ||
    !Number.isInteger(source.line)
  ) {
    return null;
  }

  return findPomodoroSourceContext(
    source.editor.getValue().split("\n"),
    source.line,
  );
}

function isSoleContentLinkBullet(lineText, startCh, endCh) {
  if (!Number.isInteger(startCh) || !Number.isInteger(endCh)) {
    return false;
  }

  const line = normalizeMarkdownLine(lineText);
  const bounds = listItemBodyBounds(line);
  if (!bounds) {
    return false;
  }

  const linkStart =
    startCh > 0 && line[startCh - 1] === "!" ? startCh - 1 : startCh;
  return bounds.start === linkStart && bounds.end === endCh;
}

function sourceLinkIsSoleBulletContent(source) {
  if (
    !source ||
    !source.editor ||
    typeof source.editor.getLine !== "function" ||
    !Number.isInteger(source.line)
  ) {
    return false;
  }

  let lineText;
  try {
    lineText = source.editor.getLine(source.line);
  } catch (error) {
    return false;
  }

  return isSoleContentLinkBullet(lineText, source.startCh, source.endCh);
}

// Whether `source` is a task-picker link that is the sole content of an
// indented sub-bullet under an OPEN Pomodoro entry. This is the shared
// qualification for both the legacy Ready promotion and future-schedule
// activation; it intentionally does not look at the target task's status.
// Adding a link under completed/canceled Pomodoro history must never
// activate a target, so `isOpen` is checked explicitly here rather than
// merely requiring a Pomodoro owner to exist.
function sourceQualifiesForPomodoroActivation(source) {
  const context = sourcePomodoroContext(source);
  return Boolean(context && context.isOpen && sourceLinkIsSoleBulletContent(source));
}

function lineRangeText(lines, startLine, endLine) {
  return lines.slice(startLine, endLine + 1).join("\n");
}

function blockRangePreviewText(content, lines, range, blockMatch) {
  const rangeStart = lineStartIndexFromLines(lines, range.startLine);
  const rangeEnd = lineEndIndexFromLines(lines, range.endLine);
  let text = content.slice(rangeStart, rangeEnd);

  if (blockMatch) {
    const tokenStart = blockMatch.start - rangeStart;
    const tokenEnd = blockMatch.end - rangeStart;
    text = text.slice(0, tokenStart) + text.slice(tokenEnd);
  }

  return cleanPreviewText(text);
}

function discoverSelectedBlockIdSource(editor, file) {
  if (
    !editor ||
    typeof editor.getValue !== "function" ||
    typeof editor.getLine !== "function" ||
    typeof editor.replaceRange !== "function"
  ) {
    return {
      notice: "No active Markdown block selected",
    };
  }

  const selection = getSingleEditorSelection(editor);
  if (!selection) {
    return {
      notice: "No active Markdown block selected",
    };
  }

  const content = editor.getValue();
  const lines = content.split("\n");
  const range = findLocalMarkdownBlockRange(lines, selection.head.line);
  if (!range) {
    return {
      notice: "No active Markdown block selected",
    };
  }

  if (!selection.empty) {
    const span = selectedLineSpan(selection);
    if (span.startLine < range.startLine || span.endLine > range.endLine) {
      return {
        notice: "Selection spans multiple Markdown blocks",
      };
    }
  }

  const rangeStart = lineStartIndexFromLines(lines, range.startLine);
  const rangeEnd = lineEndIndexFromLines(lines, range.endLine);
  const blockMatches = collectBlockTokenMatches(content).filter(
    (match) => match.start >= rangeStart && match.end <= rangeEnd,
  );

  if (blockMatches.length > 1) {
    return {
      notice: "Multiple block IDs found in selected block",
    };
  }

  if (blockMatches.length === 1) {
    const blockMatch = blockMatches[0];
    const start = indexToEditorPosition(content, blockMatch.start);
    const end = indexToEditorPosition(content, blockMatch.end);

    return {
      source: {
        kind: "direct-rename",
        editor,
        sourcePath: file.path,
        targetText: "",
        oldId: blockMatch.id,
        aliasSuffix: "",
        blockPrefix: "#^",
        line: start.line,
        startCh: start.ch,
        endCh: end.ch,
        raw: `^${blockMatch.id}`,
        previewText: blockRangePreviewText(content, lines, range, blockMatch),
        prefillId: true,
      },
    };
  }

  const previewText = blockRangePreviewText(content, lines, range, null);
  const expectedBlockText = lineRangeText(lines, range.startLine, range.endLine);
  const isSingleLineBlock = range.startLine === range.contentEndLine;
  const insertionLine = range.contentEndLine;
  const insertionLineText = lines[insertionLine] || "";

  if (isSingleLineBlock) {
    const insertionCh = insertionLineText.replace(/[ \t]+$/g, "").length;
    return {
      source: {
        kind: "direct-add",
        editor,
        sourcePath: file.path,
        line: insertionLine,
        startCh: insertionCh,
        endCh: insertionLineText.length,
        addMode: "append",
        rangeStartLine: range.startLine,
        rangeEndLine: range.endLine,
        expectedBlockText,
        previewText,
      },
    };
  }

  return {
    source: {
      kind: "direct-add",
      editor,
      sourcePath: file.path,
      line: insertionLine,
      startCh: insertionLineText.length,
      endCh: insertionLineText.length,
      addMode: "standalone",
      rangeStartLine: range.startLine,
      rangeEndLine: range.endLine,
      expectedBlockText,
      previewText,
    },
  };
}

function cleanPreviewText(value) {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  const text = lines.map((line) => line.replace(/[ \t]+$/g, "")).join("\n");
  return text.trim() ? text : null;
}

function lineWithoutBlockToken(lineText, match, lineStart) {
  const tokenStart = match.start - lineStart;
  const tokenEnd = match.end - lineStart;
  const before = lineText.slice(0, tokenStart);
  const after = lineText.slice(tokenEnd);

  if (before.trim() && after.trim()) {
    return `${before.replace(/[ \t]+$/g, "")} ${after.replace(/^[ \t]+/g, "")}`;
  }

  return before + after;
}

function extractPreviousContiguousBlock(content, lineStart) {
  let prefix = content.slice(0, lineStart).replace(/\r\n?/g, "\n");
  if (prefix.endsWith("\n")) {
    prefix = prefix.slice(0, -1);
  }

  if (!prefix) {
    return null;
  }

  const lines = prefix.split("\n");
  let end = lines.length - 1;
  if (!lines[end].trim()) {
    return null;
  }

  let start = end;
  while (start > 0 && lines[start - 1].trim()) {
    start -= 1;
  }

  return cleanPreviewText(lines.slice(start, end + 1).join("\n"));
}

function extractBlockPreviewText(content, id) {
  if (typeof content !== "string" || !BLOCK_ID_RE.test(id || "")) {
    return null;
  }

  const matches = blockTokenMatches(content, id);
  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0];
  const lineStart =
    match.start === 0 ? 0 : content.lastIndexOf("\n", match.start - 1) + 1;
  const lineEndIndex = content.indexOf("\n", match.end);
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
  const lineText = content.slice(lineStart, lineEnd);
  const sameLinePreview = cleanPreviewText(
    lineWithoutBlockToken(lineText, match, lineStart),
  );

  if (sameLinePreview) {
    return sameLinePreview;
  }

  return extractPreviousContiguousBlock(content, lineStart);
}

function indexToEditorPosition(content, index) {
  let line = 0;
  let ch = 0;

  for (let offset = 0; offset < index; offset += 1) {
    if (content[offset] === "\n") {
      line += 1;
      ch = 0;
    } else {
      ch += 1;
    }
  }

  return { line, ch };
}

function editorPositionToIndex(content, position) {
  if (
    !position ||
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.ch) ||
    position.line < 0 ||
    position.ch < 0
  ) {
    return null;
  }

  let line = 0;
  let lineStart = 0;
  while (line < position.line) {
    const newlineIndex = content.indexOf("\n", lineStart);
    if (newlineIndex === -1) {
      return null;
    }

    lineStart = newlineIndex + 1;
    line += 1;
  }

  const newlineIndex = content.indexOf("\n", lineStart);
  const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
  if (position.ch > lineEnd - lineStart) {
    return null;
  }

  return lineStart + position.ch;
}

function sourceReplacement(source, id, blockPrefix = source.blockPrefix) {
  return `[[${source.targetText}${blockPrefix}${id}${source.aliasSuffix}]]`;
}

function taskPickerRevertReplacement(source) {
  return `[[${source.targetText}${source.blockPrefix}${source.aliasSuffix}]]`;
}

function taskPickerRevertCursorCh(source) {
  return source.startCh + 2 + source.targetText.length + source.blockPrefix.length;
}

function forEachContentLine(content, callback) {
  let lineNumber = 0;
  let lineStart = 0;

  while (lineStart <= content.length) {
    const newlineIndex = content.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? content.length : newlineIndex;
    callback(content.slice(lineStart, lineEnd), lineNumber, lineStart);

    if (newlineIndex === -1) {
      break;
    }

    lineNumber += 1;
    lineStart = newlineIndex + 1;
  }
}

function forEachMarkdownLineOutsideCodeFence(content, callback) {
  let activeFence = null;

  forEachContentLine(content, (lineText, lineNumber, lineStart) => {
    if (activeFence) {
      if (isClosingFence(lineText, activeFence)) {
        activeFence = null;
      }
      return;
    }

    const openingFence = getFenceOpening(lineText);
    if (openingFence) {
      activeFence = openingFence;
      return;
    }

    callback(lineText, lineNumber, lineStart);
  });
}

function collectWikiBlockReferences(content) {
  const references = [];

  forEachMarkdownLineOutsideCodeFence(content, (lineText, lineNumber, lineStart) => {
    let match;

    WIKI_LINK_RE.lastIndex = 0;
    while ((match = WIKI_LINK_RE.exec(lineText)) !== null) {
      const reference = parseWikiBlockReference(match, lineText);
      if (!reference) {
        continue;
      }

      references.push({
        ...reference,
        line: lineNumber,
        start: lineStart + reference.startCh,
        end: lineStart + reference.endCh,
      });
    }
  });

  return references;
}

function extractMarkdownLinkDestination(body) {
  const value = normalizeText(body);
  if (!value) {
    return "";
  }

  if (value.startsWith("<")) {
    const closeIndex = value.indexOf(">");
    return closeIndex === -1 ? "" : value.slice(1, closeIndex).trim();
  }

  const whitespaceMatch = value.match(/\s/);
  return whitespaceMatch ? value.slice(0, whitespaceMatch.index) : value;
}

function collectMarkdownBlockReferences(content) {
  const references = [];

  forEachMarkdownLineOutsideCodeFence(content, (lineText, lineNumber, lineStart) => {
    let match;

    MARKDOWN_LINK_RE.lastIndex = 0;
    while ((match = MARKDOWN_LINK_RE.exec(lineText)) !== null) {
      const target = extractMarkdownLinkDestination(match[1]);
      const parsedDestination = parseBlockReferenceDestination(target);
      if (!parsedDestination) {
        continue;
      }

      references.push({
        raw: match[0],
        ...parsedDestination,
        line: lineNumber,
        start: lineStart + match.index,
        end: lineStart + match.index + match[0].length,
      });
    }
  });

  return references;
}

function validateNonOverlappingEdits(edits) {
  const sorted = [...edits].sort((left, right) => left.start - right.start);

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) {
      return false;
    }
  }

  return true;
}

function applyTextEdits(content, edits) {
  let nextContent = content;
  const sorted = [...edits].sort((left, right) => right.start - left.start);

  for (const edit of sorted) {
    nextContent =
      nextContent.slice(0, edit.start) +
      edit.replacement +
      nextContent.slice(edit.end);
  }

  return nextContent;
}

function pomodoroEntryEndLine(lines, entryLine, sectionEndLine) {
  let endLine = entryLine;

  for (let line = entryLine + 1; line <= sectionEndLine; line += 1) {
    const lineText = normalizeMarkdownLine(lines[line]);
    if (lineText.trim() && lineIndentWidth(lineText) === 0) {
      break;
    }

    endLine = line;
  }

  return endLine;
}

function collectFutureOpenPomodoroRanges(lines, context) {
  const ranges = [];
  const sectionEndLine = context.section.endLine;

  for (let line = context.ownerLine + 1; line <= sectionEndLine; line += 1) {
    if (!isPomodoroEntryLine(lines[line])) {
      continue;
    }

    const status = pomodoroEntryStatus(lines[line]);
    const endLine = pomodoroEntryEndLine(lines, line, sectionEndLine);
    if (isOpenPomodoroStatus(status)) {
      ranges.push({
        entryLine: line,
        startLine: line + 1,
        endLine,
        status,
      });
    }

    line = endLine;
  }

  return ranges;
}

function collectAllOpenPomodoroRanges(lines, section) {
  const ranges = [];
  if (!Array.isArray(lines) || !section) {
    return ranges;
  }

  const fencedLines = computeFencedLineFlags(lines);
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    if (fencedLines[line] || !isPomodoroEntryLine(lines[line])) {
      continue;
    }

    const status = pomodoroEntryStatus(lines[line]);
    const endLine = pomodoroEntryEndLine(lines, line, section.endLine);
    if (isOpenPomodoroStatus(status)) {
      ranges.push({
        entryLine: line,
        startLine: line + 1,
        endLine,
        status,
      });
    }

    line = endLine;
  }

  return ranges;
}

function resolvedFilePath(value) {
  if (typeof value === "string") {
    return value;
  }

  return value && typeof value.path === "string" ? value.path : null;
}

function referenceRemovalRange(content, reference) {
  let start = reference.start;
  let end = reference.end;

  if (start > 0 && content[start - 1] === "!") {
    start -= 1;
  }

  if (
    start >= 2 &&
    content.slice(start - 2, start) === "~~" &&
    content.slice(end, end + 2) === "~~"
  ) {
    start -= 2;
    end += 2;
  }

  return { start, end };
}

function lineContentBounds(lines, lineNumber) {
  const start = lineStartIndexFromLines(lines, lineNumber);
  const rawLine = String(lines[lineNumber] || "");
  const line = normalizeMarkdownLine(rawLine);
  return {
    start,
    end: start + line.length,
    line,
  };
}

function listItemBodyBounds(lineText) {
  const line = normalizeMarkdownLine(lineText);
  const prefix = LIST_ITEM_PREFIX_RE.exec(line);
  if (!prefix) {
    return null;
  }

  let start = prefix[0].length;
  while (start < line.length && /[ \t]/.test(line[start])) {
    start += 1;
  }

  let end = line.length;
  while (end > start && /[ \t]/.test(line[end - 1])) {
    end -= 1;
  }

  return start < end ? { start, end } : null;
}

function isDedicatedLinkBullet(lines, reference, removalRange) {
  const bounds = lineContentBounds(lines, reference.line);
  const bodyBounds = listItemBodyBounds(bounds.line);
  if (!bodyBounds) {
    return false;
  }

  return (
    removalRange.start === bounds.start + bodyBounds.start &&
    removalRange.end === bounds.start + bodyBounds.end
  );
}

function listItemSubtreeEdit(content, lines, lineNumber, rangeEndLine) {
  const itemIndent = lineIndentWidth(lines[lineNumber]);
  let endLine = lineNumber;

  for (let line = lineNumber + 1; line <= rangeEndLine; line += 1) {
    const lineText = normalizeMarkdownLine(lines[line]);
    if (lineText.trim() && lineIndentWidth(lineText) <= itemIndent) {
      break;
    }

    endLine = line;
  }

  const start = lineStartIndexFromLines(lines, lineNumber);
  const end =
    endLine + 1 < lines.length
      ? lineStartIndexFromLines(lines, endLine + 1)
      : content.length;
  return { start, end, replacement: "" };
}

function editContainsReference(edit, reference) {
  return edit.start <= reference.start && edit.end >= reference.end;
}

function planPomodoroLinkCleanupForRanges(content, ranges, options = {}) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const targetPath = resolvedFilePath(options.targetPath);
  const targetBlockId = normalizeText(options.targetBlockId);
  const resolveTarget = options.resolveTarget;

  if (
    !Array.isArray(ranges) ||
    ranges.length === 0 ||
    !targetPath ||
    !targetBlockId ||
    typeof resolveTarget !== "function"
  ) {
    return { edits: [], removedCount: 0 };
  }

  const matches = [];
  for (const reference of collectWikiBlockReferences(snapshot)) {
    if (reference.oldId !== targetBlockId) {
      continue;
    }

    const pomodoroRange = ranges.find(
      (range) =>
        reference.line >= range.startLine && reference.line <= range.endLine,
    );
    if (!pomodoroRange) {
      continue;
    }

    let resolved;
    try {
      resolved = resolveTarget(reference, options.sourcePath);
    } catch (error) {
      resolved = null;
    }

    if (resolvedFilePath(resolved) !== targetPath) {
      continue;
    }

    matches.push({
      reference,
      pomodoroRange,
      removalRange: referenceRemovalRange(snapshot, reference),
    });
  }

  if (matches.length === 0) {
    return { edits: [], removedCount: 0 };
  }

  const subtreeCandidates = matches
    .filter(({ reference, removalRange }) =>
      isDedicatedLinkBullet(lines, reference, removalRange),
    )
    .map(({ reference, pomodoroRange }) =>
      listItemSubtreeEdit(
        snapshot,
        lines,
        reference.line,
        pomodoroRange.endLine,
      ),
    )
    .sort((left, right) => left.start - right.start || right.end - left.end);

  const subtreeEdits = [];
  for (const edit of subtreeCandidates) {
    if (subtreeEdits.some((existing) => edit.start >= existing.start && edit.end <= existing.end)) {
      continue;
    }

    subtreeEdits.push(edit);
  }

  const tokenEdits = matches
    .filter(({ reference }) =>
      !subtreeEdits.some((edit) => editContainsReference(edit, reference)),
    )
    .map(({ removalRange }) => ({ ...removalRange, replacement: "" }));
  const edits = [...subtreeEdits, ...tokenEdits].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

  if (!validateNonOverlappingEdits(edits)) {
    return { edits: [], removedCount: 0 };
  }

  return { edits, removedCount: matches.length };
}

// `options.ownerLine` (paired with `options.section`) lets a caller that
// already knows the owning Pomodoro entry — e.g. the direct Ctrl+Shift+Enter
// link command, which selects the entry itself rather than deriving it from
// an existing marker's sub-bullet position — bypass the sub-bullet-relative
// `findPomodoroSourceContext` lookup. The owner is always treated as open:
// callers only pass `ownerLine` for an entry they already filtered to open.
function planFuturePomodoroLinkCleanup(content, options = {}) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const context =
    Number.isInteger(options.ownerLine) && options.section
      ? { section: options.section, ownerLine: options.ownerLine, isOpen: true }
      : findPomodoroSourceContext(lines, options.sourceLine);

  if (!context || !context.isOpen) {
    return { edits: [], removedCount: 0 };
  }

  const futureRanges = collectFutureOpenPomodoroRanges(lines, context);
  return planPomodoroLinkCleanupForRanges(snapshot, futureRanges, options);
}

function planAllOpenPomodoroLinkCleanup(content, options = {}) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const section = findPomodorosSectionRange(lines);
  if (!section) {
    return {
      section: null,
      ranges: [],
      edits: [],
      removedCount: 0,
      content: snapshot,
      hasChanges: false,
    };
  }

  const ranges = collectAllOpenPomodoroRanges(lines, section);
  const cleanup = planPomodoroLinkCleanupForRanges(snapshot, ranges, options);
  return {
    section,
    ranges,
    edits: cleanup.edits,
    removedCount: cleanup.removedCount,
    content: cleanup.edits.length > 0 ? applyTextEdits(snapshot, cleanup.edits) : snapshot,
    hasChanges: cleanup.edits.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Ctrl+Shift+Enter direct Pomodoro link: today's-daily-note resolution and
// destination-entry selection/insertion planning.
// ---------------------------------------------------------------------------

function dailyDateFormatTokens(value) {
  const date = value instanceof Date ? value : new Date(value);
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

// Which lines of `lines` fall inside a fenced code block, indexed the same
// way `lines` is (opening and closing fence lines both count as fenced).
function computeFencedLineFlags(lines) {
  const fenced = new Array(lines.length).fill(false);
  let activeFence = null;

  for (let line = 0; line < lines.length; line += 1) {
    const lineText = lines[line] || "";

    if (activeFence) {
      fenced[line] = true;
      if (isClosingFence(lineText, activeFence)) {
        activeFence = null;
      }
      continue;
    }

    const openingFence = getFenceOpening(lineText);
    if (openingFence) {
      fenced[line] = true;
      activeFence = openingFence;
    }
  }

  return fenced;
}

// An existing direct-child bullet's indentation, matching bob-cli's `bob
// capture` insertion-target rule: only `-`/`*`/`+` bullets count (unlike
// this file's own LIST_ITEM_RE, ordered-list children are not candidates).
function unorderedChildIndentation(lineText) {
  const text = normalizeMarkdownLine(lineText);
  const indentMatch = /^[ \t]*/.exec(text);
  const indent = indentMatch ? indentMatch[0] : "";
  if (!indent) {
    return null;
  }

  return /^[-*+][ \t]/.test(text.slice(indent.length)) ? indent : null;
}

// The indentation for a new sub-bullet under the selected Pomodoro entry:
// reuse an existing direct child's indentation when the entry already has
// one, else the section's own established child indentation anywhere else in
// the Pomodoros section, else the canonical two-space fallback. Mirrors
// bob-cli's `bob capture` (child_bullet_indentation /
// nearby_child_bullet_indentation) exactly.
function findPomodoroChildIndentation(lines, entryLine, entryEndLine, section) {
  for (let line = entryLine + 1; line <= entryEndLine; line += 1) {
    const indentation = unorderedChildIndentation(lines[line]);
    if (indentation !== null) {
      return indentation;
    }
  }

  for (let line = section.startLine; line <= section.endLine; line += 1) {
    const indentation = unorderedChildIndentation(lines[line]);
    if (indentation !== null) {
      return indentation;
    }
  }

  return CANONICAL_POMODORO_CHILD_INDENT;
}

// Selects the destination Pomodoro entry the same way `bob capture` does:
// among open, unfenced, top-level entries in the section, the single open
// timed entry wins; otherwise the first open entry (a placeholder). More
// than one open timed entry is ambiguous and reported as an error rather
// than silently picking one.
function selectPomodoroInsertionTarget(lines, section, fencedLines) {
  const openLines = [];
  const timedLines = [];

  for (let line = section.startLine; line <= section.endLine; line += 1) {
    if (fencedLines[line]) {
      continue;
    }

    if (!isPomodoroEntryLine(lines[line])) {
      continue;
    }

    const status = pomodoroEntryStatus(lines[line]);
    if (!isOpenPomodoroStatus(status)) {
      continue;
    }

    openLines.push(line);
    if (hasPomodoroTimeRange(lines[line])) {
      timedLines.push(line);
    }
  }

  if (timedLines.length > 1) {
    return { error: "multiple-open-timed" };
  }

  const entryLine = timedLines.length === 1 ? timedLines[0] : openLines[0];
  if (!Number.isInteger(entryLine)) {
    return { error: "no-eligible-entry" };
  }

  return { entryLine };
}

// Whether a wiki block link to `targetPath#^blockId` already occurs on a
// line within [startLine, endLine] of `content`, resolved via `resolveTarget`
// (an injectable link resolver so this stays testable without a real
// metadataCache). Used for insertion idempotence: repeating the command must
// not duplicate the link under the same Pomodoro entry.
function rangeContainsMatchingLink(
  content,
  startLine,
  endLine,
  targetPath,
  blockId,
  resolveTarget,
  sourcePath,
) {
  for (const reference of collectWikiBlockReferences(content)) {
    if (reference.oldId !== blockId) {
      continue;
    }

    if (reference.line < startLine || reference.line > endLine) {
      continue;
    }

    let resolved;
    try {
      resolved = resolveTarget(reference, sourcePath);
    } catch (error) {
      resolved = null;
    }

    if (resolvedFilePath(resolved) === targetPath) {
      return true;
    }
  }

  return false;
}

// Pure planner for inserting a task block link under today's current/next
// Pomodoro entry (the Ctrl+Shift+Enter command). Given the daily note's
// preimage, selects the destination entry, skips insertion when a matching
// link is already present there (idempotence), and always plans removal of
// matching duplicates from later still-open Pomodoros (reusing
// planFuturePomodoroLinkCleanup). Returns `{ error }` for any condition that
// must stop the command before any note is mutated: no Pomodoros section, no
// eligible open entry, or more than one open timed entry.
function planPomodoroLinkInsertion(content, options = {}) {
  const blockId = normalizeText(options.blockId);
  const targetPath = resolvedFilePath(options.targetPath);
  const sourcePath = options.sourcePath;
  const resolveTarget = options.resolveTarget;
  const linkText = options.linkText;

  if (!blockId || !targetPath || typeof resolveTarget !== "function" || !linkText) {
    return { error: "invalid-options" };
  }

  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const section = findPomodorosSectionRange(lines);
  if (!section) {
    return { error: "no-section" };
  }

  const fencedLines = computeFencedLineFlags(lines);
  const selection = selectPomodoroInsertionTarget(lines, section, fencedLines);
  if (selection.error) {
    return { error: selection.error };
  }

  const entryLine = selection.entryLine;
  const entryEndLine = pomodoroEntryEndLine(lines, entryLine, section.endLine);
  const alreadyLinked = rangeContainsMatchingLink(
    snapshot,
    entryLine + 1,
    entryEndLine,
    targetPath,
    blockId,
    resolveTarget,
    sourcePath,
  );

  const cleanup = planFuturePomodoroLinkCleanup(snapshot, {
    ownerLine: entryLine,
    section,
    sourcePath,
    targetPath,
    targetBlockId: blockId,
    resolveTarget,
  });

  const insertionEdits = [];
  if (!alreadyLinked) {
    const indentation = findPomodoroChildIndentation(lines, entryLine, entryEndLine, section);
    const entryLineText = `${indentation}- ${linkText}`;
    const insertLine = entryEndLine + 1;
    const markerHasCR = Boolean(lines[entryEndLine] && lines[entryEndLine].endsWith("\r"));

    if (insertLine < lines.length) {
      const insertionIndex = lineStartIndexFromLines(lines, insertLine);
      insertionEdits.push({
        start: insertionIndex,
        end: insertionIndex,
        replacement: `${entryLineText}${markerHasCR ? "\r" : ""}\n`,
      });
    } else {
      insertionEdits.push({
        start: snapshot.length,
        end: snapshot.length,
        replacement: `\n${entryLineText}`,
      });
    }
  }

  const edits = [...insertionEdits, ...cleanup.edits];
  if (!validateNonOverlappingEdits(edits)) {
    return { error: "overlap" };
  }

  return {
    section,
    entryLine,
    entryEndLine,
    alreadyLinked,
    edits,
    content: edits.length > 0 ? applyTextEdits(snapshot, edits) : snapshot,
    removedCount: cleanup.removedCount,
    hasChanges: edits.length > 0,
  };
}

// Pure target-note mutation planner for a `^^` task-picker completion or a
// direct Ctrl+Shift+Enter Pomodoro link. Given the destination note's
// preimage and the selected task's line, composes:
//   - future-schedule removal (whenever `activationEligible` or `forceNext`,
//     and the task carries exactly one valid, strictly future `scheduled`
//     field);
//   - the resulting checkbox status: with `forceNext`, every eligible open
//     status becomes Next unconditionally (the Ctrl+Shift+Enter mode); with
//     plain `activationEligible`, only Ready/Blocked are promoted to Next,
//     and only when a future schedule was actually removed for Blocked (the
//     `^^` task-picker's original, more conservative mode);
//   - an optional trailing block ID append, kept as the final task token; and
//   - a Schedule Log entry, only when the task already owns a direct-child
//     marker.
// Returns the complete postimage plus outcome metadata and the discrete edits
// needed to apply the same change to a live editor without disturbing
// unrelated document state. Returns null if `taskLine` cannot be read as an
// Obsidian task line (defensive; callers already guard freshness upstream).
function planTargetTaskUpdate(preimageContent, taskLine, options = {}) {
  const activationEligible = Boolean(options.activationEligible);
  const forceNext = Boolean(options.forceNext);
  const scheduleActivationEligible = activationEligible || forceNext;
  const newBlockId = normalizeText(options.newBlockId) || null;
  const content = String(preimageContent === null || preimageContent === undefined ? "" : preimageContent);
  const lines = content.split("\n");

  if (!Number.isInteger(taskLine) || taskLine < 0 || taskLine >= lines.length) {
    return null;
  }

  const rawLine = lines[taskLine];
  const hasCR = rawLine.endsWith("\r");
  const lineText = hasCR ? rawLine.slice(0, -1) : rawLine;
  const taskMatch = getObsidianTaskLineMatch(lineText);
  if (!taskMatch) {
    return null;
  }

  const currentStatus = taskMatch[1];
  const today = localTodayParts(options.now);
  const futureField = scheduleActivationEligible
    ? findSingleFutureScheduledField(lineText, today)
    : null;

  let updatedLineText = lineText;
  let removedFutureSchedule = false;
  let oldScheduledDate = null;
  if (futureField) {
    updatedLineText = removeSpanWithSpaceCollapse(updatedLineText, futureField.start, futureField.end);
    removedFutureSchedule = true;
    oldScheduledDate = futureField.value;
  }

  let newStatus = currentStatus;
  if (forceNext) {
    newStatus = "*";
  } else if (activationEligible) {
    if (removedFutureSchedule) {
      if (currentStatus === BLOCKED_OBSIDIAN_TASK_STATUS || currentStatus === " ") {
        newStatus = "*";
      }
    } else if (currentStatus === " ") {
      newStatus = "*";
    }
  }

  const statusChanged = newStatus !== currentStatus;
  if (statusChanged) {
    updatedLineText = setCheckboxStatus(updatedLineText, newStatus);
  }

  if (newBlockId) {
    const trimmedLength = updatedLineText.replace(/[ \t]+$/g, "").length;
    updatedLineText = `${updatedLineText.slice(0, trimmedLength)} ^${newBlockId}`;
  }

  const lineStart = lineStartIndexFromLines(lines, taskLine);
  const lineEnd = lineEndIndexFromLines(lines, taskLine);
  const edits = [
    {
      start: lineStart,
      end: hasCR ? lineEnd - 1 : lineEnd,
      replacement: updatedLineText,
    },
  ];

  const nextLines = lines.slice();
  nextLines[taskLine] = hasCR ? `${updatedLineText}\r` : updatedLineText;

  let logEntryAdded = false;
  let logInsertLine = null;
  if (removedFutureSchedule) {
    const marker = findScheduleLogMarker(nextLines, taskLine);
    if (marker) {
      const entryIndent = findScheduleLogEntryIndent(nextLines, marker.line);
      const entryLineText = formatScheduleLogEntryLine(
        entryIndent,
        marker.marker,
        oldScheduledDate,
        formatCalendarDate(today),
      );
      logInsertLine = marker.line + 1;

      const markerHasCR = Boolean(lines[marker.line] && lines[marker.line].endsWith("\r"));
      if (logInsertLine < lines.length) {
        const insertionIndex = lineStartIndexFromLines(lines, logInsertLine);
        edits.push({
          start: insertionIndex,
          end: insertionIndex,
          replacement: `${entryLineText}${markerHasCR ? "\r" : ""}\n`,
        });
      } else {
        edits.push({
          start: content.length,
          end: content.length,
          replacement: `\n${entryLineText}`,
        });
      }

      nextLines.splice(logInsertLine, 0, markerHasCR ? `${entryLineText}\r` : entryLineText);
      logEntryAdded = true;
    }
  }

  return {
    content: nextLines.join("\n"),
    edits,
    removedFutureSchedule,
    oldScheduledDate,
    statusChanged,
    newStatus,
    logEntryAdded,
    logInsertLine,
    blockIdAppended: Boolean(newBlockId),
    hasChanges: removedFutureSchedule || statusChanged || logEntryAdded || Boolean(newBlockId),
  };
}

function planTargetTaskOpenUpdate(preimageContent, taskLine) {
  const content = String(preimageContent === null || preimageContent === undefined ? "" : preimageContent);
  const lines = content.split("\n");

  if (!Number.isInteger(taskLine) || taskLine < 0 || taskLine >= lines.length) {
    return null;
  }

  const rawLine = lines[taskLine];
  const hasCR = rawLine.endsWith("\r");
  const lineText = hasCR ? rawLine.slice(0, -1) : rawLine;
  const taskMatch = getObsidianTaskLineMatch(lineText);
  const checkboxMatch = TASK_CHECKBOX_STATUS_RE.exec(lineText);
  if (!taskMatch || !checkboxMatch || taskMatch[1] !== "*") {
    return null;
  }

  const statusStart = lineStartIndexFromLines(lines, taskLine) + checkboxMatch[1].length;
  const updatedLineText = setCheckboxStatus(lineText, " ");
  const nextLines = lines.slice();
  nextLines[taskLine] = hasCR ? `${updatedLineText}\r` : updatedLineText;

  return {
    content: nextLines.join("\n"),
    edits: [
      {
        start: statusStart,
        end: statusStart + 1,
        replacement: " ",
      },
    ],
    oldStatus: "*",
    newStatus: " ",
    statusChanged: true,
    removedFutureSchedule: false,
    logEntryAdded: false,
    blockIdAppended: false,
    hasChanges: true,
  };
}

// Success-notice chips for a planTargetTaskUpdate outcome, in display order.
function activationSuccessChips(plan) {
  const chips = [];
  if (plan.removedFutureSchedule) {
    chips.push("removed future schedule");
  }
  if (plan.statusChanged) {
    chips.push("set Next");
  }
  if (plan.logEntryAdded) {
    chips.push("logged schedule change");
  }
  return chips;
}

function activationSuccessSuffix(plan) {
  const chips = activationSuccessChips(plan);
  return chips.length ? ` · ${chips.join(" · ")}` : "";
}

// Past-tense clauses for a partial-failure notice (target written, source
// link completion stopped). Never claims "set Next" alone when other target
// mutations also happened.
function activationPartialFailureParts(plan) {
  const parts = [];
  if (plan.removedFutureSchedule) {
    parts.push("unscheduled");
  }
  if (plan.statusChanged) {
    parts.push("set Next");
  }
  if (plan.logEntryAdded) {
    parts.push("logged");
  }
  return parts;
}

function pluralize(value, singular, plural) {
  return value === 1 ? singular : plural;
}

function setEditorCursorIfPossible(editor, position) {
  if (!editor || typeof editor.setCursor !== "function") {
    return false;
  }

  editor.setCursor(position);
  return true;
}

function dispatchFileLinkBlockCompletion(editor, line, marker) {
  const cm = editor && editor.cm;
  if (
    !cm ||
    typeof cm.dispatch !== "function" ||
    !cm.state ||
    !cm.state.doc ||
    typeof cm.state.doc.line !== "function"
  ) {
    return false;
  }

  try {
    const lineStart = cm.state.doc.line(line + 1).from;
    cm.dispatch({
      changes: {
        from: lineStart + marker.startCh,
        to: lineStart + marker.endCh,
        insert: marker.completionReplacement,
      },
      selection: { anchor: lineStart + marker.finalCursorCh },
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return true;
  } catch (error) {
    console.error("Block ID Prompt failed to dispatch block completion", error);
    return false;
  }
}

function applyFileLinkBlockCompletionWithEditorApi(editor, line, marker) {
  if (!editor || typeof editor.replaceRange !== "function") {
    return false;
  }

  editor.replaceRange(
    marker.plainReplacement,
    { line, ch: marker.startCh },
    { line, ch: marker.endCh },
  );

  const insertionPos = { line, ch: marker.insertionCh };
  setEditorCursorIfPossible(editor, insertionPos);
  editor.replaceRange("^", insertionPos);
  setEditorCursorIfPossible(editor, { line, ch: marker.finalCursorCh });
  return true;
}

const TASK_LINK_PICKER_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Link" },
  { keys: ["esc"], label: "Dismiss" },
];

function isCtrlKey(event, key) {
  return (
    event.ctrlKey === true &&
    event.altKey !== true &&
    event.metaKey !== true &&
    typeof event.key === "string" &&
    event.key.toLowerCase() === key
  );
}

function applyIcon(el, iconName) {
  if (!el || typeof setIcon !== "function") {
    return;
  }

  try {
    setIcon(el, iconName);
  } catch (error) {
    // Icons are decorative here; rendering should continue without them.
  }
}

function appendHighlighted(el, text, query) {
  const source = String(text === null || text === undefined ? "" : text);
  if (!query) {
    el.appendText(source);
    return;
  }

  const lowerSource = source.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = 0;
  let matchIndex = lowerSource.indexOf(lowerQuery);

  if (matchIndex === -1) {
    el.appendText(source);
    return;
  }

  while (matchIndex !== -1) {
    if (matchIndex > index) {
      el.appendText(source.slice(index, matchIndex));
    }
    el.createSpan({
      cls: "bid-tlp-hl",
      text: source.slice(matchIndex, matchIndex + lowerQuery.length),
    });
    index = matchIndex + lowerQuery.length;
    matchIndex = lowerSource.indexOf(lowerQuery, index);
  }

  if (index < source.length) {
    el.appendText(source.slice(index));
  }
}

function taskStatusLabel(status) {
  return `[${status || " "}]`;
}

function taskStatusClass(status) {
  if (status === "/") {
    return "active";
  }

  if (status === "*") {
    return "next";
  }

  if (status === BLOCKED_OBSIDIAN_TASK_STATUS) {
    return "blocked";
  }

  return "todo";
}

function taskBlockedState(task) {
  const dependency = (task && task.dependency) || null;
  const statusBlocked =
    Boolean(task) && task.status === BLOCKED_OBSIDIAN_TASK_STATUS;
  const dependencyBlocked = Boolean(dependency && dependency.isBlocked);

  return {
    isBlocked: statusBlocked || dependencyBlocked,
    statusBlocked,
    dependencyBlocked,
    depCount: dependency ? dependency.depIds.length : 0,
    metCount: dependency ? dependency.metCount : 0,
    unmetCount: dependency ? dependency.unmetBlockers.length : 0,
    unresolvedCount: dependency ? dependency.unresolvedIds.length : 0,
    unmetBlockers: dependency ? dependency.unmetBlockers : [],
  };
}

function countBlockedTasks(tasks) {
  return (tasks || [])
    .filter((task) => taskBlockedState(task).isBlocked)
    .length;
}

function blockedTaskCountSuffix(count) {
  return count > 0 ? ` · ${count} blocked` : "";
}

function partitionTaskPickerItems(tasks) {
  const unblocked = [];
  const blocked = [];

  (tasks || []).forEach((task) => {
    (taskBlockedState(task).isBlocked ? blocked : unblocked).push(task);
  });

  return { unblocked, blocked };
}

function blockedChipLabel(state) {
  return state.dependencyBlocked && state.depCount > 1
    ? `Blocked · ${state.unmetCount}`
    : "Blocked";
}

function buildBlockedTooltip(state) {
  if (!state || !state.isBlocked) {
    return "";
  }

  if (!state.dependencyBlocked) {
    if (state.depCount === 0) {
      return "Marked Blocked in the note; no dependencies listed";
    }

    if (state.unresolvedCount > 0) {
      return `Marked Blocked in the note; ${state.unresolvedCount} unresolved dependency ${pluralize(
        state.unresolvedCount,
        "reference",
        "references",
      )}`;
    }

    return `Marked Blocked in the note; all ${state.depCount} ${pluralize(
      state.depCount,
      "dependency",
      "dependencies",
    )} are done`;
  }

  const blockers = state.unmetBlockers || [];
  const visibleBlockers = blockers.slice(0, 3).map((blocker) =>
    normalizeText(blocker.title) || blocker.id,
  );
  const remainingCount = Math.max(0, blockers.length - visibleBlockers.length);
  let tooltip = `Blocked by: ${visibleBlockers.join(", ")}`;

  if (remainingCount > 0) {
    tooltip += `, +${remainingCount} more`;
  }

  if (state.unresolvedCount > 0) {
    tooltip += `; ${state.unresolvedCount} unresolved`;
  }

  return tooltip;
}

class TaskLinkPickerModal extends Modal {
  constructor(app, plugin, source, tasks, targetFile) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.tasks = tasks;
    this.targetFile = targetFile;
    this.visibleTasks = tasks;
    this.selectedIndex = 0;
    this.completed = false;
    this.opening = false;
    this.inputEl = null;
    this.subtitleEl = null;
    this.resultsEl = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bid-tlp-modal");
    contentEl.addClass("bid-tlp");

    const header = contentEl.createDiv({ cls: "bid-tlp-header" });
    const headerIcon = header.createDiv({ cls: "bid-tlp-header-icon" });
    applyIcon(headerIcon, "list-checks");
    const headerText = header.createDiv({ cls: "bid-tlp-header-text" });
    headerText.createDiv({ cls: "bid-tlp-title", text: "Link to task" });
    this.subtitleEl = headerText.createDiv({ cls: "bid-tlp-subtitle" });

    const searchEl = contentEl.createDiv({ cls: "bid-tlp-search" });
    const searchIcon = searchEl.createDiv({ cls: "bid-tlp-search-icon" });
    applyIcon(searchIcon, "search");
    this.inputEl = searchEl.createEl("input", {
      cls: "bid-tlp-input",
      attr: {
        "aria-label": "Filter tasks",
        placeholder: "Filter tasks",
        type: "text",
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.selectedIndex = 0;
      this.renderResults();
    });
    this.inputEl.addEventListener("keydown", (event) =>
      this.handleKeydown(event),
    );

    this.resultsEl = contentEl.createDiv({
      cls: "bid-tlp-results",
      attr: {
        role: "listbox",
        "aria-label": "Open tasks",
      },
    });

    this.renderFooter(contentEl);
    this.renderResults();

    window.setTimeout(() => {
      if (this.inputEl) {
        this.inputEl.focus();
      }
    }, 0);
  }

  renderFooter(contentEl) {
    const footerEl = contentEl.createDiv({ cls: "bid-tlp-footer" });
    TASK_LINK_PICKER_HINTS.forEach((hint) => {
      const group = footerEl.createDiv({ cls: "bid-tlp-hint" });
      hint.keys.forEach((key) =>
        group.createEl("kbd", { cls: "bid-tlp-kbd", text: key }),
      );
      group.createEl("span", { cls: "bid-tlp-hint-label", text: hint.label });
    });
  }

  onClose() {
    this.modalEl.removeClass("bid-tlp-modal");
    this.contentEl.empty();

    if (!this.completed) {
      this.plugin.cancelTaskLinkPicker(this.source);
    }

    this.plugin.lastPromptKey = null;
    this.plugin.promptOpen = false;
  }

  handleKeydown(event) {
    if (event.key === "ArrowDown" || isCtrlKey(event, "n")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp" || isCtrlKey(event, "p")) {
      event.preventDefault();
      event.stopPropagation();
      this.moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.openSelectedTask();
    }
  }

  moveSelection(delta) {
    if (this.visibleTasks.length === 0) {
      return;
    }

    this.selectedIndex =
      (this.selectedIndex + delta + this.visibleTasks.length) %
      this.visibleTasks.length;
    this.renderResults();
  }

  getQuery() {
    return this.inputEl ? this.inputEl.value.trim().toLowerCase() : "";
  }

  getFilteredTasks() {
    const query = this.getQuery();
    if (!query) {
      return this.tasks;
    }

    return this.tasks.filter((task) =>
      fuzzyIncludes(task.displayText, query),
    );
  }

  renderResults() {
    if (!this.resultsEl) {
      return;
    }

    const groups = partitionTaskPickerItems(this.getFilteredTasks());
    this.visibleTasks = groups.unblocked.concat(groups.blocked);
    this.selectedIndex = this.clampSelectedIndex(
      this.selectedIndex,
      this.visibleTasks.length,
    );
    this.updateSubtitle();
    this.resultsEl.empty();

    if (this.visibleTasks.length === 0) {
      this.renderEmptyState();
      return;
    }

    const showGroupHeaders =
      groups.unblocked.length > 0 && groups.blocked.length > 0;
    const query = this.getQuery();
    this.visibleTasks.forEach((task, index) => {
      if (showGroupHeaders && index === 0) {
        this.renderGroupHeader("Unblocked", groups.unblocked.length, "unblocked");
      }
      if (showGroupHeaders && index === groups.unblocked.length) {
        this.renderGroupHeader("Blocked", groups.blocked.length, "blocked");
      }

      const isSelected = index === this.selectedIndex;
      const blockedState = taskBlockedState(task);
      const rowEl = this.resultsEl.createDiv({
        cls: [
          "bid-tlp-row",
          isSelected ? "is-selected" : "",
          blockedState.isBlocked ? "is-blocked" : "",
        ].filter(Boolean).join(" "),
        attr: {
          role: "option",
          "aria-selected": isSelected ? "true" : "false",
        },
      });

      this.renderTaskRow(rowEl, task, query);

      rowEl.addEventListener("mousedown", (event) => event.preventDefault());
      rowEl.addEventListener("click", () => this.openTaskAtIndex(index));

      if (isSelected) {
        this.scrollRowIntoView(rowEl);
      }
    });
  }

  renderGroupHeader(label, count, variant) {
    const headerEl = this.resultsEl.createDiv({
      cls: `bid-tlp-group is-${variant}`,
      attr: { role: "presentation", "aria-hidden": "true" },
    });
    headerEl.createSpan({ cls: "bid-tlp-group-label", text: label });
    headerEl.createSpan({ cls: "bid-tlp-group-count", text: String(count) });
  }

  renderTaskRow(rowEl, task, query) {
    rowEl.createDiv({
      cls: `bid-tlp-status-pill is-${taskStatusClass(task.status)}`,
      text: taskStatusLabel(task.status),
    });

    const textEl = rowEl.createDiv({ cls: "bid-tlp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bid-tlp-row-title" });
    appendHighlighted(titleEl, task.displayText, query);

    const metaEl = textEl.createDiv({ cls: "bid-tlp-row-meta" });
    metaEl.createSpan({ text: `Line ${task.line + 1}` });
    const blockedState = taskBlockedState(task);
    if (blockedState.isBlocked) {
      const tooltip = buildBlockedTooltip(blockedState);
      const chipEl = metaEl.createSpan({
        cls: "bid-tlp-blocked-chip",
        attr: {
          "aria-label": tooltip,
          title: tooltip,
        },
      });
      const iconEl = chipEl.createSpan({
        cls: "bid-tlp-blocked-icon",
        attr: { "aria-hidden": "true" },
      });
      applyIcon(iconEl, "lock");
      chipEl.createSpan({
        cls: "bid-tlp-blocked-label",
        text: blockedChipLabel(blockedState),
      });
    }

    const badgeEl = rowEl.createDiv({
      cls: `bid-tlp-badge ${task.existingId ? "is-existing" : "is-create"}`,
    });
    if (task.existingId) {
      badgeEl.createSpan({ cls: "bid-tlp-badge-action", text: "↵ link" });
      badgeEl.createSpan({ cls: "bid-tlp-badge-id", text: `^${task.existingId}` });
    } else {
      badgeEl.createSpan({ cls: "bid-tlp-badge-action", text: "+ id" });
    }
  }

  renderEmptyState() {
    const basename = this.targetFile && this.targetFile.basename;
    const hasTasks = this.tasks.length > 0;
    const emptyEl = this.resultsEl.createDiv({ cls: "bid-tlp-empty" });
    const iconEl = emptyEl.createDiv({ cls: "bid-tlp-empty-icon" });
    applyIcon(iconEl, hasTasks ? "search-x" : "list-x");
    emptyEl.createDiv({
      cls: "bid-tlp-empty-text",
      text: hasTasks
        ? "No matching tasks"
        : `No open tasks in ${basename || "target note"}`,
    });
  }

  updateSubtitle() {
    if (!this.subtitleEl) {
      return;
    }

    const total = this.tasks.length;
    const shown = this.visibleTasks.length;
    const basename = this.targetFile && this.targetFile.basename;
    if (shown !== total) {
      this.subtitleEl.textContent =
        `Showing ${shown} of ${total}${blockedTaskCountSuffix(
          countBlockedTasks(this.visibleTasks),
        )}`;
      return;
    }

    this.subtitleEl.textContent =
      `${total} open ${pluralize(total, "task", "tasks")}` +
      `${basename ? ` in ${basename}` : ""}` +
      blockedTaskCountSuffix(countBlockedTasks(this.tasks));
  }

  clampSelectedIndex(index, length) {
    if (length === 0) {
      return 0;
    }

    return Math.min(Math.max(index, 0), length - 1);
  }

  scrollRowIntoView(rowEl) {
    if (!rowEl || typeof rowEl.scrollIntoView !== "function") {
      return;
    }

    try {
      rowEl.scrollIntoView({ block: "nearest" });
    } catch (error) {
      try {
        rowEl.scrollIntoView(false);
      } catch (ignoredError) {
        // Scrolling is optional; never let it break selection.
      }
    }
  }

  openSelectedTask() {
    this.openTaskAtIndex(this.selectedIndex);
  }

  async openTaskAtIndex(index) {
    if (this.opening) {
      return;
    }

    const task = this.visibleTasks[index];
    if (!task) {
      return;
    }

    this.opening = true;
    let promptSource = null;
    try {
      const result = await this.plugin.selectTaskLinkTask(this.source, task);
      if (!result) {
        return;
      }

      promptSource = result.promptSource || null;
      this.completed = true;
      this.close();
    } finally {
      this.opening = false;
    }

    if (promptSource) {
      window.setTimeout(() => this.plugin.openBlockIdPrompt(promptSource), 0);
    }
  }
}

class BlockIdPromptModal extends Modal {
  constructor(app, plugin, source) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.completed = false;
    this.submitting = false;
    this.input = null;
    this.previewEl = null;
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Block ID" });
    this.createPreviewEl();
    this.loadPreview();

    new Setting(this.contentEl).setName("ID").addText((text) => {
      this.input = text;
      text.setPlaceholder("my-id");
      if (this.source.prefillId && this.source.oldId) {
        text.setValue(this.source.oldId);
      }
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        this.submit();
      });
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText("Save")
          .setCta()
          .onClick(() => this.submit()),
      );

    window.setTimeout(() => {
      if (this.input && this.input.inputEl) {
        this.input.inputEl.focus();
        if (this.source.prefillId && this.input.getValue()) {
          this.input.inputEl.select();
        }
      }
    }, 0);
  }

  createPreviewEl() {
    this.previewEl = this.contentEl.createEl("div", {
      text: "Loading block contents...",
    });
    this.previewEl.setAttribute("aria-label", "Current block contents");
    this.previewEl.setAttribute("role", "note");
    Object.assign(this.previewEl.style, {
      backgroundColor: "var(--background-secondary)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "4px",
      color: "var(--text-muted)",
      lineHeight: "var(--line-height-normal)",
      margin: "0 0 12px 0",
      maxHeight: "12rem",
      overflowWrap: "anywhere",
      overflowY: "auto",
      padding: "10px 12px",
      userSelect: "text",
      whiteSpace: "pre-wrap",
    });
  }

  setPreviewText(text, muted) {
    if (!this.previewEl) {
      return;
    }

    this.previewEl.textContent = text;
    this.previewEl.style.color = muted
      ? "var(--text-muted)"
      : "var(--text-normal)";
  }

  async loadPreview() {
    const previewEl = this.previewEl;
    const previewText = await this.plugin.readBlockPreviewText(this.source);

    if (!previewEl || previewEl !== this.previewEl || !previewEl.isConnected) {
      return;
    }

    if (previewText) {
      this.setPreviewText(previewText, false);
    } else {
      this.setPreviewText("Block contents unavailable", true);
    }
  }

  async submit() {
    if (this.submitting) {
      return;
    }

    const id = this.input ? this.input.getValue().trim() : "";
    if (!id) {
      new Notice("Block ID cannot be blank");
      return;
    }

    if (!BLOCK_ID_RE.test(id)) {
      new Notice("Block ID can only contain letters, numbers, and hyphens");
      return;
    }

    this.submitting = true;
    try {
      const accepted = await this.plugin.submitBlockId(this.source, id);
      if (accepted) {
        this.completed = true;
        this.close();
      }
    } finally {
      this.submitting = false;
    }
  }

  onClose() {
    this.contentEl.empty();

    if (!this.completed && !this.submitting) {
      this.plugin.cancelBlockIdPrompt(this.source);
    }

    this.plugin.lastPromptKey = null;
    this.plugin.promptOpen = false;
  }
}

module.exports = class BlockIdPromptPlugin extends Plugin {
  onload() {
    this.promptOpen = false;
    this.scanTimer = null;
    this.scanView = null;
    this.suppressUntil = 0;
    this.lastPromptKey = null;

    this.addCommand({
      id: "rename-selected-block-id",
      name: "Rename selected block ID",
      hotkeys: [{ modifiers: ["Ctrl"], key: "6" }],
      editorCallback: (editor, view) =>
        this.openSelectedBlockIdPrompt(editor, view),
    });

    this.addCommand({
      id: "link-task-to-pomodoro",
      name: "Toggle task Pomodoro link",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "Enter" }],
      editorCallback: (editor, view) =>
        this.openPomodoroTaskLink(editor, view),
    });

    this.registerEditorExtension(
      EditorView.updateListener.of((update) => this.scheduleScan(update)),
    );

    this.register(() => {
      if (this.scanTimer !== null) {
        window.clearTimeout(this.scanTimer);
      }
    });
  }

  scheduleScan(update) {
    if (!update.docChanged) {
      return;
    }

    if (this.promptOpen) {
      return;
    }

    this.scanView = update.view;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
    }

    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null;
      this.inspectActiveEditor(this.scanView);
      this.scanView = null;
    }, SCAN_DEBOUNCE_MS);
  }

  inspectActiveEditor(cmView) {
    if (this.promptOpen) {
      return;
    }

    const scansSuppressed = Date.now() < this.suppressUntil;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(view instanceof MarkdownView) || !view.editor) {
      return;
    }

    if (view.editor.cm && cmView && view.editor.cm !== cmView) {
      return;
    }

    if (!this.hasSingleCursor(view.editor)) {
      return;
    }

    const file = view.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    const cursor = view.editor.getCursor();
    if (!cursor || !Number.isInteger(cursor.line)) {
      return;
    }

    const lineText = view.editor.getLine(cursor.line) || "";
    const taskMarker = findTaskPickerMarkerNearCursor(lineText, cursor.ch || 0);
    if (taskMarker) {
      if (lineIsInsideCodeFence(view.editor, cursor.line)) {
        return;
      }

      void this.openTaskLinkPicker({
        ...taskMarker,
        editor: view.editor,
        sourcePath: file.path,
        line: cursor.line,
      });
      return;
    }

    if (scansSuppressed) {
      return;
    }

    const marker = findMarkerLinkNearCursor(lineText, cursor.ch || 0);
    if (!marker) {
      this.lastPromptKey = null;
      return;
    }

    if (lineIsInsideCodeFence(view.editor, cursor.line)) {
      return;
    }

    if (marker.kind === "file-link-jump") {
      this.applyFileLinkJumpMarker(marker, view.editor, cursor.line);
      return;
    }

    const source = {
      ...marker,
      editor: view.editor,
      sourcePath: file.path,
      line: cursor.line,
    };
    this.openBlockIdPrompt(source);
  }

  openSelectedBlockIdPrompt(editor, view) {
    if (this.promptOpen) {
      return;
    }

    const markdownView =
      view instanceof MarkdownView
        ? view
        : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(markdownView instanceof MarkdownView) || !editor) {
      new Notice("No active Markdown block selected");
      return;
    }

    const file = markdownView.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("No active Markdown block selected");
      return;
    }

    if (!this.hasSingleCursor(editor)) {
      new Notice("No active Markdown block selected");
      return;
    }

    const selection = getSingleEditorSelection(editor);
    const cursor = selection && selection.head;
    if (!isEditorPosition(cursor)) {
      new Notice("No active Markdown block selected");
      return;
    }

    if (lineIsInsideCodeFence(editor, cursor.line)) {
      return;
    }

    const lineText = editor.getLine(cursor.line) || "";
    const blockReference = findBlockReferenceOnLine(
      lineText,
      cursor.ch || 0,
    );
    if (blockReference) {
      this.openBlockIdPrompt({
        ...blockReference,
        editor,
        sourcePath: file.path,
        line: cursor.line,
      });
      return;
    }

    const result = discoverSelectedBlockIdSource(editor, file);
    if (!result || !result.source) {
      new Notice(
        (result && result.notice) || "No active Markdown block selected",
      );
      return;
    }

    this.openBlockIdPrompt(result.source);
  }

  openBlockIdPrompt(source) {
    if (this.promptOpen) {
      return;
    }

    const key = sourceKey(source);
    if (key === this.lastPromptKey) {
      return;
    }

    this.lastPromptKey = key;
    this.promptOpen = true;
    new BlockIdPromptModal(this.app, this, source).open();
  }

  async openTaskLinkPicker(source) {
    if (this.promptOpen) {
      return;
    }

    const key = sourceKey(source);
    if (key === this.lastPromptKey) {
      return;
    }

    this.lastPromptKey = key;
    this.promptOpen = true;

    try {
      const destination = await this.readDestinationForValidation(source);
      if (!destination) {
        new Notice("Task link blocked: target note could not be resolved");
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      if (destination.content === null) {
        new Notice(`Task link blocked: ${destination.file.path} could not be read`);
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      if (!this.sourceMarkerStillPresent(source, { quiet: true })) {
        this.lastPromptKey = null;
        this.promptOpen = false;
        return;
      }

      const tasks = collectTaskPickerItems(destination.content);
      new TaskLinkPickerModal(
        this.app,
        this,
        {
          ...source,
          destinationPath: destination.file.path,
        },
        tasks,
        destination.file,
      ).open();
    } catch (error) {
      console.error("Block ID Prompt failed to open task link picker", error);
      new Notice("Task link blocked: target note could not be read");
      this.lastPromptKey = null;
      this.promptOpen = false;
    }
  }

  cancelTaskLinkPicker(source) {
    this.revertTaskPickerMarker(source, { quiet: true });
  }

  async selectTaskLinkTask(source, task) {
    if (task.existingId) {
      return this.completeTaskLinkWithExistingId(source, task);
    }

    if (!this.sourceMarkerStillPresent(source)) {
      return null;
    }

    return {
      promptSource: {
        ...source,
        kind: "link-task-complete",
        task: { ...task },
        previewText: task.displayText,
        prefillId: false,
      },
    };
  }

  async completeTaskLinkWithExistingId(source, task) {
    if (!this.sourceMarkerStillPresent(source)) {
      return null;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Task link blocked: target note could not be resolved");
      return null;
    }

    if (!this.taskLineStillPresent(destination.content, task, destination.file.path)) {
      return null;
    }

    const currentId = getTrailingBlockId(task.rawLine);
    if (currentId !== task.existingId) {
      new Notice("Task link blocked: selected task block ID changed");
      return null;
    }

    const activationEligible = sourceQualifiesForPomodoroActivation(source);
    const plan = planTargetTaskUpdate(destination.content, task.line, {
      activationEligible,
      now: this.now(),
    });
    if (!plan) {
      new Notice(`Task link stopped: selected task changed in ${destination.file.path}`);
      return null;
    }

    if (plan.hasChanges) {
      if (
        !(await this.applyTargetTaskPlan(destination.file, source, plan, destination.content))
      ) {
        return null;
      }
    }

    const completionSource = this.adjustSourceForPlan(source, destination.file.path, plan);
    const completion = this.completeTaskSourceLink(
      completionSource,
      task.existingId,
      destination.file.path,
    );
    if (!completion) {
      if (plan.hasChanges) {
        const parts = activationPartialFailureParts(plan);
        new Notice(
          `Task ${parts.length ? parts.join(", ") : "linked"}, but the source link changed before completion`,
        );
      }
      return null;
    }

    new Notice(
      `Linked task block${activationSuccessSuffix(plan)}${this.futureLinkCleanupNoticeSuffix(completion.removedCount)}`,
    );
    return { completed: true };
  }

  hasSingleCursor(editor) {
    if (
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    if (typeof editor.listSelections !== "function") {
      return true;
    }

    const selections = editor.listSelections();
    return Array.isArray(selections) && selections.length === 1;
  }

  cancelBlockIdPrompt(source) {
    if (source.kind === "link-task-complete") {
      this.revertTaskPickerMarker(source, { quiet: true });
      return;
    }

    if (
      source.kind === "direct-add" ||
      source.kind === "direct-rename" ||
      source.kind === "link-block" ||
      source.kind === "link-task-pomodoro"
    ) {
      return;
    }

    this.replaceSourceLink(source, source.oldId, { quiet: true });
  }

  applyFileLinkJumpMarker(marker, editor, line) {
    if (!editor || typeof editor.getLine !== "function") {
      return false;
    }

    const lineText = editor.getLine(line) || "";
    if (lineText.slice(marker.startCh, marker.endCh) !== marker.raw) {
      return false;
    }

    this.suppressEditorScans();
    if (!dispatchFileLinkBlockCompletion(editor, line, marker)) {
      applyFileLinkBlockCompletionWithEditorApi(editor, line, marker);
    }
    this.lastPromptKey = null;
    return true;
  }

  async submitBlockId(source, newId) {
    if (source.kind === "direct-add") {
      return this.submitDirectBlockAdd(source, newId);
    }

    if (source.kind === "direct-rename") {
      return this.submitDirectBlockRename(source, newId);
    }

    if (source.kind === "link-task-complete") {
      return this.submitLinkTaskBlockId(source, newId);
    }

    if (source.kind === "link-task-pomodoro") {
      return this.submitPomodoroTaskLinkBlockId(source, newId);
    }

    return this.submitLinkedBlockId(source, newId);
  }

  async submitLinkedBlockId(source, newId) {
    if (!this.sourceMarkerStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Block ID rename blocked: target note could not be resolved");
      return false;
    }

    if (newId !== source.oldId) {
      const duplicateMatches = blockTokenMatches(destination.content, newId);
      if (duplicateMatches.length > 0) {
        new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
        return false;
      }
    }

    const oldMatches = blockTokenMatches(destination.content, source.oldId);
    if (oldMatches.length !== 1) {
      new Notice(
        `Block ID rename blocked: old ID was not found exactly once in ${destination.file.path}`,
      );
      return false;
    }

    const plan = await this.buildReferenceRewritePlan(source, destination, newId);
    if (!plan) {
      return false;
    }

    if (plan.unsupportedCount > 0) {
      new Notice(
        `Block ID rename blocked: ${plan.unsupportedCount} old ${pluralize(
          plan.unsupportedCount,
          "link",
          "links",
        )} could not be rewritten safely`,
      );
      return false;
    }

    if (!(await this.applyReferenceRewritePlan(plan, source))) {
      return true;
    }

    if (
      !(await this.renameDestinationBlock(
        destination.file,
        source,
        source.oldId,
        newId,
        plan.destinationContentAfterReferences,
      ))
    ) {
      return true;
    }

    if (newId === source.oldId) {
      new Notice(
        `Updated ${plan.editCount} ${pluralize(plan.editCount, "link", "links")}`,
      );
    } else {
      new Notice(
        `Renamed block ID and updated ${plan.editCount} ${pluralize(
          plan.editCount,
          "link",
          "links",
        )}`,
      );
    }

    return true;
  }

  async submitDirectBlockRename(source, newId) {
    if (!this.directRenameSourceStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Block ID rename blocked: target note could not be resolved");
      return false;
    }

    if (newId !== source.oldId) {
      const duplicateMatches = blockTokenMatches(destination.content, newId);
      if (duplicateMatches.length > 0) {
        new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
        return false;
      }
    }

    const oldMatches = blockTokenMatches(destination.content, source.oldId);
    if (oldMatches.length !== 1) {
      new Notice(
        `Block ID rename blocked: old ID was not found exactly once in ${destination.file.path}`,
      );
      return false;
    }

    const plan = await this.buildReferenceRewritePlan(
      source,
      destination,
      newId,
      { requireSourceMarker: false },
    );
    if (!plan) {
      return false;
    }

    if (plan.unsupportedCount > 0) {
      new Notice(
        `Block ID rename blocked: ${plan.unsupportedCount} old ${pluralize(
          plan.unsupportedCount,
          "link",
          "links",
        )} could not be rewritten safely`,
      );
      return false;
    }

    if (!(await this.applyReferenceRewritePlan(plan, source))) {
      return true;
    }

    if (
      !(await this.renameDestinationBlock(
        destination.file,
        source,
        source.oldId,
        newId,
        plan.destinationContentAfterReferences,
      ))
    ) {
      return true;
    }

    if (newId === source.oldId) {
      new Notice(
        `Updated ${plan.editCount} ${pluralize(plan.editCount, "link", "links")}`,
      );
    } else {
      new Notice(
        `Renamed block ID and updated ${plan.editCount} ${pluralize(
          plan.editCount,
          "link",
          "links",
        )}`,
      );
    }

    return true;
  }

  submitDirectBlockAdd(source, newId) {
    if (!this.directAddSourceStillPresent(source)) {
      return false;
    }

    const content = source.editor.getValue();
    const duplicateMatches = blockTokenMatches(content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${source.sourcePath}`);
      return false;
    }

    this.suppressEditorScans();
    if (source.addMode === "append") {
      source.editor.replaceRange(
        ` ^${newId}`,
        { line: source.line, ch: source.startCh },
        { line: source.line, ch: source.endCh },
      );
    } else {
      source.editor.replaceRange(
        `\n^${newId}`,
        { line: source.line, ch: source.startCh },
        { line: source.line, ch: source.endCh },
      );
    }

    new Notice("Added block ID");
    return true;
  }

  async submitLinkTaskBlockId(source, newId) {
    if (!this.sourceMarkerStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Task link blocked: target note could not be resolved");
      return false;
    }

    const duplicateMatches = blockTokenMatches(destination.content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
      return false;
    }

    if (!this.taskLineStillPresent(destination.content, source.task, destination.file.path)) {
      return false;
    }

    const activationEligible = sourceQualifiesForPomodoroActivation(source);
    const plan = planTargetTaskUpdate(destination.content, source.task.line, {
      newBlockId: newId,
      activationEligible,
      now: this.now(),
    });
    if (!plan) {
      new Notice(`Task link stopped: selected task changed in ${destination.file.path}`);
      return false;
    }

    if (
      !(await this.applyTargetTaskPlan(destination.file, source, plan, destination.content))
    ) {
      return false;
    }

    const completionSource = this.adjustSourceForPlan(source, destination.file.path, plan);
    const completion = this.completeTaskSourceLink(
      completionSource,
      newId,
      destination.file.path,
    );
    if (!completion) {
      const parts = activationPartialFailureParts(plan);
      new Notice(
        `Task block ID added${parts.length ? ` and ${parts.join(", ")}` : ""}, but the source link changed before completion`,
      );
      return true;
    }

    new Notice(
      `Added block ID and linked task${activationSuccessSuffix(plan)}${this.futureLinkCleanupNoticeSuffix(completion.removedCount)}`,
    );
    return true;
  }

  // Ctrl+Shift+Enter: non-Next tasks link to today's current/next Pomodoro and
  // become Next; Next tasks become Open and lose current/future Pomodoro links.
  // Unlike the `^^` task-picker flow, this command already knows the task (the
  // cursor's own line) and has no marker text to complete or revert.
  async openPomodoroTaskLink(editor, view) {
    if (this.promptOpen) {
      return;
    }

    const markdownView =
      view instanceof MarkdownView
        ? view
        : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!(markdownView instanceof MarkdownView) || !editor) {
      new Notice("No active Markdown task selected");
      return;
    }

    const file = markdownView.file || this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("No active Markdown task selected");
      return;
    }

    const resolved = this.resolvePomodoroLinkTaskFromEditor(editor);
    if (resolved.error) {
      new Notice(resolved.error);
      return;
    }

    const { task } = resolved;
    const source = {
      kind: "link-task-pomodoro",
      editor,
      file,
      sourcePath: file.path,
      line: task.line,
      task: { ...task },
    };

    if (task.status === "*") {
      this.promptOpen = true;
      try {
        await this.applyPomodoroTaskUnlink(source);
      } finally {
        this.promptOpen = false;
      }
      return;
    }

    if (task.existingId) {
      this.promptOpen = true;
      try {
        await this.completePomodoroTaskLink(source, task.existingId);
      } finally {
        this.promptOpen = false;
      }
      return;
    }

    this.openBlockIdPrompt({
      ...source,
      previewText: task.displayText,
      prefillId: false,
    });
  }

  // The cursor/task-eligibility half of openPomodoroTaskLink, split out so it
  // is testable without an Obsidian MarkdownView/TFile: single cursor, not
  // fenced, an open task line (including a `#hide` project task) under it,
  // and — when that task already has a block ID — that the ID is not
  // duplicated elsewhere in this note. Returns `{ task }` or `{ error }`.
  resolvePomodoroLinkTaskFromEditor(editor) {
    if (!this.hasSingleCursor(editor)) {
      return { error: "No active Markdown task selected" };
    }

    const selection = getSingleEditorSelection(editor);
    const cursor = selection && selection.head;
    if (!isEditorPosition(cursor)) {
      return { error: "No active Markdown task selected" };
    }

    if (lineIsInsideCodeFence(editor, cursor.line)) {
      return { error: "Cannot link a task inside a code block" };
    }

    const lineText = editor.getLine(cursor.line) || "";
    const task = findDirectPomodoroLinkTask(lineText, cursor.line);
    if (!task) {
      return { error: "No open task under cursor" };
    }

    if (task.existingId) {
      const duplicateMatches = blockTokenMatches(editor.getValue(), task.existingId);
      if (duplicateMatches.length !== 1) {
        return { error: `Block ID '${task.existingId}' is duplicated in this note` };
      }
    }

    return { task };
  }

  resolveTodayDailyFile() {
    const vault = this.app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") {
      return null;
    }

    const dailyPath = todayDailyPath(this.now(), getDailyNotesOptions(this.app));
    const file = vault.getAbstractFileByPath(dailyPath);
    return file instanceof TFile && file.extension === "md" ? file : null;
  }

  resolveTaskFile(sourcePath) {
    const vault = this.app.vault;
    if (!vault || typeof vault.getAbstractFileByPath !== "function") {
      return null;
    }

    const file = vault.getAbstractFileByPath(sourcePath);
    return file instanceof TFile ? file : null;
  }

  buildPomodoroLinkTargetText(taskFile, dailyPath) {
    if (taskFile.path === dailyPath) {
      return "";
    }

    const metadataCache = this.app.metadataCache;
    if (metadataCache && typeof metadataCache.fileToLinktext === "function") {
      return metadataCache.fileToLinktext(taskFile, dailyPath, true);
    }

    return stripMarkdownExtension(taskFile.path);
  }

  async completePomodoroTaskLink(source, id) {
    return this.applyPomodoroTaskLink(source, id, false);
  }

  async submitPomodoroTaskLinkBlockId(source, newId) {
    const currentLine = source.editor.getLine(source.line) || "";
    if (currentLine !== source.task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${source.sourcePath}`);
      return false;
    }

    const duplicateMatches = blockTokenMatches(source.editor.getValue(), newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${source.sourcePath}`);
      return false;
    }

    return this.applyPomodoroTaskLink(source, newId, true);
  }

  // Shared core for both the existing-ID (completePomodoroTaskLink) and
  // newly-prompted-ID (submitPomodoroTaskLinkBlockId) paths. Always
  // re-validates the task line and plans the daily-note edit BEFORE planning
  // or applying anything to the task note, so a missing/ambiguous Pomodoro
  // ledger stops the command with zero edits. When the task and the daily
  // note are the same file, every edit is merged into one editor transaction
  // against a single snapshot; otherwise the task note is written first
  // (guarded) and the daily note second (guarded), reporting the exact
  // partial result if the second write fails after the first succeeds.
  async applyPomodoroTaskLink(source, id, isNewId) {
    const currentLine = source.editor.getLine(source.line) || "";
    if (currentLine !== source.task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${source.sourcePath}`);
      return false;
    }

    const dailyFile = this.resolveTodayDailyFile();
    if (!dailyFile) {
      new Notice("Task link blocked: today's daily note could not be found");
      return false;
    }

    const taskFile = this.resolveTaskFile(source.sourcePath);
    if (!taskFile) {
      new Notice("Task link blocked: active note could not be resolved");
      return false;
    }

    const sameNote = dailyFile.path === taskFile.path;
    const taskContent = source.editor.getValue();
    const dailyContent = sameNote
      ? taskContent
      : await this.readFileSnapshot(dailyFile, source);
    if (dailyContent === null) {
      new Notice(`Task link blocked: ${dailyFile.path} could not be read`);
      return false;
    }

    const linkTargetText = sameNote
      ? ""
      : this.buildPomodoroLinkTargetText(taskFile, dailyFile.path);
    const linkText = sourceReplacement(
      { targetText: linkTargetText, aliasSuffix: "" },
      id,
      CANONICAL_BLOCK_LINK_PREFIX,
    );

    const pomodoroPlan = planPomodoroLinkInsertion(dailyContent, {
      blockId: id,
      targetPath: taskFile.path,
      sourcePath: dailyFile.path,
      resolveTarget: (reference, referrerPath) =>
        this.resolveReferenceDestination(reference, referrerPath),
      linkText,
    });
    if (pomodoroPlan.error) {
      new Notice(this.pomodoroPlanErrorNotice(pomodoroPlan.error, dailyFile.path));
      return false;
    }

    const plan = planTargetTaskUpdate(taskContent, source.line, {
      activationEligible: true,
      forceNext: true,
      newBlockId: isNewId ? id : null,
      now: this.now(),
    });
    if (!plan) {
      new Notice(`Task link stopped: selected task changed in ${source.sourcePath}`);
      return false;
    }

    if (sameNote) {
      const allEdits = [...plan.edits, ...pomodoroPlan.edits];
      if (
        !validateNonOverlappingEdits(allEdits) ||
        source.editor.getValue() !== taskContent
      ) {
        new Notice(`Task link stopped: ${source.sourcePath} changed before update`);
        return false;
      }

      this.suppressEditorScans();
      const sorted = [...allEdits].sort((left, right) => right.start - left.start);
      for (const edit of sorted) {
        source.editor.replaceRange(
          edit.replacement,
          indexToEditorPosition(taskContent, edit.start),
          indexToEditorPosition(taskContent, edit.end),
        );
      }

      this.reportPomodoroLinkOutcome(plan, pomodoroPlan, isNewId);
      return true;
    }

    if (plan.hasChanges) {
      if (!(await this.applyTargetTaskPlan(taskFile, source, plan, taskContent))) {
        return false;
      }
    }

    if (pomodoroPlan.hasChanges) {
      if (!(await this.applyTargetTaskPlan(dailyFile, source, pomodoroPlan, dailyContent))) {
        this.reportPomodoroLinkPartialFailure(plan, isNewId, dailyFile.path);
        return false;
      }
    }

    this.reportPomodoroLinkOutcome(plan, pomodoroPlan, isNewId);
    return true;
  }

  async applyPomodoroTaskUnlink(source) {
    const currentLine = source.editor.getLine(source.line) || "";
    if (currentLine !== source.task.rawLine) {
      new Notice(`Task toggle blocked: selected task changed in ${source.sourcePath}`);
      return false;
    }

    const taskFile = source.file || this.resolveTaskFile(source.sourcePath);
    if (!taskFile) {
      new Notice("Task toggle blocked: active note could not be resolved");
      return false;
    }

    const taskContent = source.editor.getValue();
    const originalCursor =
      typeof source.editor.getCursor === "function" ? source.editor.getCursor() : null;
    const taskPlan = planTargetTaskOpenUpdate(taskContent, source.line);
    if (!taskPlan) {
      new Notice(`Task toggle stopped: selected task changed in ${source.sourcePath}`);
      return false;
    }

    let cleanupPlan = {
      edits: [],
      removedCount: 0,
      content: "",
      hasChanges: false,
    };
    let dailyFile = null;
    let dailyContent = null;

    if (source.task.existingId) {
      dailyFile = this.resolveTodayDailyFile();
      if (dailyFile) {
        const sameNote = dailyFile.path === taskFile.path;
        dailyContent = sameNote
          ? taskContent
          : await this.readFileSnapshot(dailyFile, source);
        if (dailyContent === null) {
          new Notice(`Task toggle blocked: ${dailyFile.path} could not be read`);
          return false;
        }

        cleanupPlan = planAllOpenPomodoroLinkCleanup(dailyContent, {
          sourcePath: dailyFile.path,
          targetPath: taskFile.path,
          targetBlockId: source.task.existingId,
          resolveTarget: (reference, referrerPath) =>
            this.resolveReferenceDestination(reference, referrerPath),
        });

        if (sameNote) {
          const allEdits = [...taskPlan.edits, ...cleanupPlan.edits];
          if (
            !validateNonOverlappingEdits(allEdits) ||
            source.editor.getValue() !== taskContent
          ) {
            new Notice(`Task toggle stopped: ${source.sourcePath} changed before update`);
            return false;
          }

          this.suppressEditorScans();
          const sorted = [...allEdits].sort((left, right) => right.start - left.start);
          for (const edit of sorted) {
            source.editor.replaceRange(
              edit.replacement,
              indexToEditorPosition(taskContent, edit.start),
              indexToEditorPosition(taskContent, edit.end),
            );
          }

          setEditorCursorIfPossible(source.editor, originalCursor);
          this.reportPomodoroUnlinkOutcome(cleanupPlan);
          return true;
        }
      }
    }

    if (cleanupPlan.hasChanges) {
      if (
        !(await this.applyTargetTaskPlan(
          dailyFile,
          source,
          cleanupPlan,
          dailyContent,
          { noticePrefix: "Task toggle stopped" },
        ))
      ) {
        return false;
      }
    }

    const statusApplied = await this.applyTargetTaskPlan(
      taskFile,
      source,
      taskPlan,
      taskContent,
      {
        noticePrefix: "Task toggle stopped",
        quiet: cleanupPlan.removedCount > 0,
      },
    );
    if (!statusApplied) {
      if (cleanupPlan.removedCount > 0) {
        this.reportPomodoroUnlinkPartialFailure(cleanupPlan);
      }
      return false;
    }

    setEditorCursorIfPossible(source.editor, originalCursor);
    this.reportPomodoroUnlinkOutcome(cleanupPlan);
    return true;
  }

  pomodoroPlanErrorNotice(error, dailyPath) {
    switch (error) {
      case "no-section":
        return `Task link blocked: ${dailyPath} has no Pomodoros section`;
      case "no-eligible-entry":
        return `Task link blocked: ${dailyPath} has no eligible open Pomodoro`;
      case "multiple-open-timed":
        return `Task link blocked: ${dailyPath} has multiple open timed Pomodoros`;
      default:
        return `Task link blocked: ${dailyPath} could not be updated`;
    }
  }

  reportPomodoroLinkOutcome(plan, pomodoroPlan, isNewId) {
    const base = pomodoroPlan.alreadyLinked
      ? "Task already linked to Pomodoro"
      : isNewId
        ? "Added block ID and linked task to Pomodoro"
        : "Linked task to Pomodoro";

    new Notice(
      `${base}${activationSuccessSuffix(plan)}${this.futureLinkCleanupNoticeSuffix(pomodoroPlan.removedCount)}`,
    );
  }

  reportPomodoroUnlinkOutcome(cleanupPlan) {
    new Notice(
      `Task set Open${this.currentFutureLinkCleanupNoticeSuffix(cleanupPlan.removedCount, { includeNoop: true })}`,
    );
  }

  reportPomodoroUnlinkPartialFailure(cleanupPlan) {
    const removedCount = cleanupPlan.removedCount;
    new Notice(
      `Removed ${removedCount} current/future Pomodoro ${pluralize(
        removedCount,
        "link",
        "links",
      )}, but task remains Next`,
    );
  }

  reportPomodoroLinkPartialFailure(plan, isNewId, dailyPath) {
    const parts = activationPartialFailureParts(plan);
    if (isNewId) {
      new Notice(
        `Task block ID added${parts.length ? ` and ${parts.join(", ")}` : ""}, but ${dailyPath} could not be updated`,
      );
      return;
    }

    new Notice(
      `Task ${parts.length ? parts.join(", ") : "updated"}, but ${dailyPath} could not be updated`,
    );
  }

  currentFutureLinkCleanupNoticeSuffix(removedCount, options = {}) {
    if (Number.isInteger(removedCount) && removedCount > 0) {
      return ` · removed ${removedCount} current/future Pomodoro ${pluralize(
        removedCount,
        "link",
        "links",
      )}`;
    }

    return options.includeNoop ? " · no current/future Pomodoro links removed" : "";
  }

  sourceMarkerStillPresent(source, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    return true;
  }

  taskLineStillPresent(content, task, filePath) {
    const currentLine = contentLineAt(content, task && task.line);
    if (currentLine === null || currentLine !== task.rawLine) {
      new Notice(`Task link blocked: selected task changed in ${filePath}`);
      return false;
    }

    return true;
  }

  // Apply a planTargetTaskUpdate() plan as one guarded target-note write: for
  // the active source note, every discrete edit is applied to the live editor
  // (so unrelated document state is left untouched); for any other note, the
  // complete postimage is written in a single vault.modify call. Re-reads and
  // matches `expectedContent` first so a target that changed since the plan
  // was built is never silently overwritten.
  async applyTargetTaskPlan(file, source, plan, expectedContent, options = {}) {
    const noticePrefix = options.noticePrefix || "Task link stopped";
    const quiet = options.quiet === true;
    const content = await this.readFileSnapshot(file, source);
    if (content === null) {
      if (!quiet) {
        new Notice(`${noticePrefix}: ${file.path} could not be read`);
      }
      return false;
    }

    if (content !== expectedContent) {
      if (!quiet) {
        new Notice(`${noticePrefix}: ${file.path} changed before update`);
      }
      return false;
    }

    if (file.path === source.sourcePath) {
      if (!source.editor || typeof source.editor.replaceRange !== "function") {
        if (!quiet) {
          new Notice(`${noticePrefix}: active note could not be modified`);
        }
        return false;
      }

      this.suppressEditorScans();
      const sortedEdits = [...plan.edits].sort((left, right) => right.start - left.start);
      for (const edit of sortedEdits) {
        source.editor.replaceRange(
          edit.replacement,
          indexToEditorPosition(content, edit.start),
          indexToEditorPosition(content, edit.end),
        );
      }
      return true;
    }

    try {
      await this.app.vault.modify(file, plan.content);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify task note", error);
      if (!quiet) {
        new Notice(`${noticePrefix}: ${file.path} could not be modified`);
      }
      return false;
    }
  }

  // When a Schedule Log entry was inserted into the same note the Pomodoro
  // source link lives in, everything from that insertion point onward shifts
  // down by one line. Return a copy of `source` with its line corrected so
  // sourceMarkerStillPresent/completeTaskSourceLink keep locating the marker
  // by position rather than by fuzzy text search.
  adjustSourceForPlan(source, targetPath, plan) {
    if (
      !plan ||
      !plan.logEntryAdded ||
      targetPath !== source.sourcePath ||
      plan.logInsertLine > source.line
    ) {
      return source;
    }

    return { ...source, line: source.line + 1 };
  }

  directRenameSourceStillPresent(source) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      new Notice("Block ID rename blocked: selected block changed before rename");
      return false;
    }

    return true;
  }

  directAddSourceStillPresent(source) {
    if (!source.editor || typeof source.editor.getValue !== "function") {
      new Notice("Block ID add blocked: active note could not be read");
      return false;
    }

    const lines = source.editor.getValue().split("\n");
    if (
      source.rangeStartLine < 0 ||
      source.rangeEndLine >= lines.length ||
      source.line >= lines.length
    ) {
      new Notice("Block ID add blocked: selected block changed before add");
      return false;
    }

    const currentBlockText = lineRangeText(
      lines,
      source.rangeStartLine,
      source.rangeEndLine,
    );
    if (currentBlockText !== source.expectedBlockText) {
      new Notice("Block ID add blocked: selected block changed before add");
      return false;
    }

    return true;
  }

  async buildReferenceRewritePlan(source, destination, newId, options = {}) {
    const requireSourceMarker = options.requireSourceMarker !== false;
    const candidateFiles = await this.collectCandidateReferenceFiles(
      destination.file,
      source,
    );
    const filePlans = [];
    let editCount = 0;
    let unsupportedCount = 0;
    let sourceMarkerPlanned = false;
    let destinationContentAfterReferences = null;

    for (const file of candidateFiles) {
      const snapshot = await this.readFileSnapshot(file, source);
      if (snapshot === null) {
        new Notice(`Block ID rename blocked: ${file.path} could not be read`);
        return null;
      }

      const sourceMarkerStart =
        requireSourceMarker && file.path === source.sourcePath
          ? editorPositionToIndex(snapshot, {
              line: source.line,
              ch: source.startCh,
            })
          : null;
      const sourceMarkerEnd =
        sourceMarkerStart === null ? null : sourceMarkerStart + source.raw.length;
      const edits = [];

      for (const reference of collectWikiBlockReferences(snapshot)) {
        if (reference.oldId !== source.oldId) {
          continue;
        }

        const targetFile = this.resolveReferenceDestination(reference, file.path);
        if (!targetFile || targetFile.path !== destination.file.path) {
          continue;
        }

        if (snapshot.slice(reference.start, reference.end) !== reference.raw) {
          unsupportedCount += 1;
          continue;
        }

        const replacement = sourceReplacement(reference, newId);
        if (replacement !== reference.raw) {
          edits.push({
            start: reference.start,
            end: reference.end,
            replacement,
          });
          editCount += 1;
        }

        if (
          file.path === source.sourcePath &&
          reference.start === sourceMarkerStart &&
          reference.end === sourceMarkerEnd
        ) {
          sourceMarkerPlanned = true;
        }
      }

      for (const reference of collectMarkdownBlockReferences(snapshot)) {
        if (reference.oldId !== source.oldId) {
          continue;
        }

        const targetFile = this.resolveReferenceDestination(reference, file.path);
        if (targetFile && targetFile.path === destination.file.path) {
          unsupportedCount += 1;
        }
      }

      if (!validateNonOverlappingEdits(edits)) {
        new Notice("Block ID rename blocked: overlapping link edits were found");
        return null;
      }

      if (file.path === destination.file.path) {
        destinationContentAfterReferences = applyTextEdits(snapshot, edits);
      }

      if (edits.length > 0) {
        filePlans.push({
          file,
          content: snapshot,
          edits,
        });
      }
    }

    if (requireSourceMarker && !sourceMarkerPlanned) {
      new Notice("Block ID rename blocked: source marker link was not found");
      return null;
    }

    return {
      filePlans,
      editCount,
      unsupportedCount,
      destinationContentAfterReferences:
        destinationContentAfterReferences === null
          ? destination.content
          : destinationContentAfterReferences,
    };
  }

  replaceSourceLink(source, id, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    this.suppressEditorScans();
    source.editor.replaceRange(
      sourceReplacement(source, id),
      { line: source.line, ch: source.startCh },
      { line: source.line, ch: source.endCh },
    );

    return true;
  }

  completeTaskSourceLink(source, id, destinationPath) {
    if (
      !source.editor ||
      typeof source.editor.getValue !== "function" ||
      typeof source.editor.replaceRange !== "function"
    ) {
      new Notice("Block marker link changed before it could be rewritten");
      return null;
    }

    const snapshot = source.editor.getValue();
    const markerStart = editorPositionToIndex(snapshot, {
      line: source.line,
      ch: source.startCh,
    });
    const markerEnd = markerStart === null ? null : markerStart + source.raw.length;
    if (
      markerStart === null ||
      markerEnd === null ||
      snapshot.slice(markerStart, markerEnd) !== source.raw
    ) {
      new Notice("Block marker link changed before it could be rewritten");
      return null;
    }

    const replacement = sourceReplacement(source, id, CANONICAL_BLOCK_LINK_PREFIX);
    const cleanup = planFuturePomodoroLinkCleanup(snapshot, {
      sourceLine: source.line,
      sourcePath: source.sourcePath,
      targetPath: destinationPath,
      targetBlockId: id,
      resolveTarget: (reference) =>
        this.resolveReferenceDestination(reference, source.sourcePath),
    });
    const edits = [
      { start: markerStart, end: markerEnd, replacement },
      ...cleanup.edits,
    ];

    if (
      !validateNonOverlappingEdits(edits) ||
      source.editor.getValue() !== snapshot
    ) {
      new Notice("Block marker link changed before it could be rewritten");
      return null;
    }

    this.suppressEditorScans();
    const sorted = [...edits].sort((left, right) => right.start - left.start);
    for (const edit of sorted) {
      source.editor.replaceRange(
        edit.replacement,
        indexToEditorPosition(snapshot, edit.start),
        indexToEditorPosition(snapshot, edit.end),
      );
    }

    setEditorCursorIfPossible(source.editor, {
      line: source.line,
      ch: source.startCh + replacement.length,
    });

    return { removedCount: cleanup.removedCount };
  }

  futureLinkCleanupNoticeSuffix(removedCount) {
    if (!Number.isInteger(removedCount) || removedCount <= 0) {
      return "";
    }

    return ` · removed ${removedCount} future ${pluralize(
      removedCount,
      "link",
      "links",
    )}`;
  }

  revertTaskPickerMarker(source, options = {}) {
    const lineText = source.editor.getLine(source.line) || "";
    const currentText = lineText.slice(source.startCh, source.endCh);

    if (currentText !== source.raw) {
      if (!options.quiet) {
        new Notice("Block marker link changed before it could be rewritten");
      }
      return false;
    }

    this.suppressEditorScans();
    source.editor.replaceRange(
      taskPickerRevertReplacement(source),
      { line: source.line, ch: source.startCh },
      { line: source.line, ch: source.endCh },
    );
    setEditorCursorIfPossible(source.editor, {
      line: source.line,
      ch: taskPickerRevertCursorCh(source),
    });

    return true;
  }

  async readDestinationForValidation(source) {
    const file = this.resolveDestinationFile(source);
    if (!file) {
      return null;
    }

    if (file.path === source.sourcePath && typeof source.editor.getValue === "function") {
      return {
        file,
        content: source.editor.getValue(),
      };
    }

    try {
      return {
        file,
        content: await this.app.vault.read(file),
      };
    } catch (error) {
      console.error("Block ID Prompt failed to read target note", error);
      return {
        file,
        content: null,
      };
    }
  }

  async readBlockPreviewText(source) {
    if (Object.prototype.hasOwnProperty.call(source, "previewText")) {
      return source.previewText || null;
    }

    try {
      const destination = await this.readDestinationForValidation(source);
      if (!destination || destination.content === null) {
        return null;
      }

      return extractBlockPreviewText(destination.content, source.oldId);
    } catch (error) {
      return null;
    }
  }

  resolveDestinationFile(source) {
    return this.resolveReferenceDestination(source, source.sourcePath);
  }

  resolveReferenceDestination(reference, sourcePath) {
    const linkText = stripMarkdownExtension(normalizeLinkTarget(reference.targetText));
    const lookupText = stripLinkSubpath(linkText);

    if (!lookupText) {
      const currentFile = this.app.vault.getAbstractFileByPath(sourcePath);
      return currentFile instanceof TFile ? currentFile : null;
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(
      lookupText,
      sourcePath,
    );

    return file instanceof TFile ? file : null;
  }

  async collectCandidateReferenceFiles(destinationFile, source) {
    // Candidates are discovered from Obsidian's in-memory metadata cache only
    // (backlinks + resolvedLinks). We intentionally do NOT scan every vault note
    // from disk: on a large vault that was thousands of sequential reads per
    // rename. Downstream (buildReferenceRewritePlan / applyReferenceRewritePlan)
    // re-reads, re-parses, and re-verifies every candidate, so narrowing the set
    // never weakens correctness — it only changes which files we look at.
    //
    // Accepted residual risk: a note that references the block but was edited
    // *externally* (e.g. by bob-cli) and not yet re-indexed by Obsidian could be
    // missed until Obsidian re-indexes it (which it does on file change). The two
    // common cases — the active note and the destination note — are always
    // covered below regardless of cache freshness.
    const candidatePaths = new Set();
    this.addCandidatePath(candidatePaths, destinationFile.path);
    // Always include the current/active note, independent of the metadata cache.
    // Never remove this: the user often renames a block id immediately after
    // Obsidian auto-creates it when linking to an unnamed block, and at that
    // instant the active note may not yet be re-indexed. readFileSnapshot reads
    // this note from the live editor buffer (source.editor.getValue()), so even
    // unsaved edits are handled correctly.
    this.addCandidatePath(candidatePaths, source.sourcePath);
    this.addBacklinkCandidatePaths(candidatePaths, destinationFile);
    this.addResolvedLinkCandidatePaths(candidatePaths, destinationFile);

    return Array.from(candidatePaths)
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file) => file instanceof TFile && file.extension === "md")
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  addCandidatePath(candidatePaths, path) {
    if (typeof path === "string" && path) {
      candidatePaths.add(path);
    }
  }

  addBacklinkCandidatePaths(candidatePaths, destinationFile) {
    const metadataCache = this.app.metadataCache;
    if (
      !metadataCache ||
      typeof metadataCache.getBacklinksForFile !== "function"
    ) {
      return;
    }

    const backlinks = metadataCache.getBacklinksForFile(destinationFile);
    const data = backlinks && backlinks.data;
    if (!data) {
      return;
    }

    if (data instanceof Map) {
      for (const path of data.keys()) {
        this.addCandidatePath(candidatePaths, path);
      }
      return;
    }

    if (typeof data === "object") {
      for (const path of Object.keys(data)) {
        this.addCandidatePath(candidatePaths, path);
      }
    }
  }

  addResolvedLinkCandidatePaths(candidatePaths, destinationFile) {
    const resolvedLinks = this.app.metadataCache && this.app.metadataCache.resolvedLinks;
    if (!resolvedLinks || typeof resolvedLinks !== "object") {
      return;
    }

    for (const [sourcePath, destinations] of Object.entries(resolvedLinks)) {
      if (
        destinations &&
        Object.prototype.hasOwnProperty.call(destinations, destinationFile.path)
      ) {
        this.addCandidatePath(candidatePaths, sourcePath);
      }
    }
  }

  async readFileSnapshot(file, source) {
    if (
      file.path === source.sourcePath &&
      source.editor &&
      typeof source.editor.getValue === "function"
    ) {
      return source.editor.getValue();
    }

    try {
      return await this.app.vault.read(file);
    } catch (error) {
      console.error("Block ID Prompt failed to read note", error);
      return null;
    }
  }

  async applyReferenceRewritePlan(plan, source) {
    if (!(await this.verifyPlannedFilesUnchanged(plan, source))) {
      return false;
    }

    for (const filePlan of plan.filePlans) {
      if (!(await this.applyReferenceEdits(filePlan, source))) {
        return false;
      }
    }

    return true;
  }

  async verifyPlannedFilesUnchanged(plan, source) {
    for (const filePlan of plan.filePlans) {
      const currentContent = await this.readFileSnapshot(filePlan.file, source);
      if (currentContent === null) {
        new Notice(`Block ID rename blocked: ${filePlan.file.path} could not be read`);
        return false;
      }

      if (currentContent !== filePlan.content) {
        new Notice(
          `Block ID rename blocked: ${filePlan.file.path} changed before rewrite`,
        );
        return false;
      }
    }

    return true;
  }

  async applyReferenceEdits(filePlan, source) {
    if (filePlan.file.path === source.sourcePath) {
      return this.applyActiveReferenceEdits(filePlan, source.editor);
    }

    const nextContent = applyTextEdits(filePlan.content, filePlan.edits);
    try {
      await this.app.vault.modify(filePlan.file, nextContent);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify backlink note", error);
      new Notice(`Block ID rename stopped: ${filePlan.file.path} could not be modified`);
      return false;
    }
  }

  applyActiveReferenceEdits(filePlan, editor) {
    if (!editor || typeof editor.replaceRange !== "function") {
      new Notice("Block ID rename stopped: active note could not be modified");
      return false;
    }

    this.suppressEditorScans();
    const sorted = [...filePlan.edits].sort((left, right) => right.start - left.start);
    for (const edit of sorted) {
      editor.replaceRange(
        edit.replacement,
        indexToEditorPosition(filePlan.content, edit.start),
        indexToEditorPosition(filePlan.content, edit.end),
      );
    }

    return true;
  }

  async renameDestinationBlock(file, source, oldId, newId, expectedContent) {
    if (newId === oldId) {
      return true;
    }

    const content = await this.readFileSnapshot(file, source);
    if (content === null) {
      new Notice(`Block ID rename stopped: ${file.path} could not be read`);
      return false;
    }

    if (typeof expectedContent === "string" && content !== expectedContent) {
      new Notice(`Block ID rename stopped: ${file.path} changed before rename`);
      return false;
    }

    const duplicateMatches = blockTokenMatches(content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${file.path}`);
      return false;
    }

    const matches = blockTokenMatches(content, oldId);
    if (matches.length !== 1) {
      new Notice(
        `Block ID rename stopped: old ID was not found exactly once in ${file.path}`,
      );
      return false;
    }

    const match = matches[0];
    if (file.path === source.sourcePath) {
      this.suppressEditorScans();
      source.editor.replaceRange(
        `^${newId}`,
        indexToEditorPosition(content, match.start),
        indexToEditorPosition(content, match.end),
      );
      return true;
    }

    const nextContent =
      content.slice(0, match.start) + `^${newId}` + content.slice(match.end);
    try {
      await this.app.vault.modify(file, nextContent);
      return true;
    } catch (error) {
      console.error("Block ID Prompt failed to modify target note", error);
      new Notice(`Block ID rename stopped: ${file.path} could not be modified`);
      return false;
    }
  }

  suppressEditorScans() {
    this.suppressUntil = Date.now() + EDIT_SUPPRESS_MS;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
      this.scanView = null;
    }
  }

  // The "today" clock for planTargetTaskUpdate's future-schedule comparison.
  // Overridable so tests can inject a fixed local date.
  now() {
    return new Date();
  }
};

module.exports.helpers = {
  activationPartialFailureParts,
  activationSuccessChips,
  activationSuccessSuffix,
  applyFileLinkBlockCompletionWithEditorApi,
  blockedChipLabel,
  buildBlockedTooltip,
  buildTaskDependencyIndex,
  collectAllOpenPomodoroRanges,
  collectTaskPickerItems,
  computeFencedLineFlags,
  countBlockedTasks,
  findDirectPomodoroLinkTask,
  findMarkerLinkNearCursor,
  findPomodoroChildIndentation,
  findPomodoroSourceContext,
  findScheduledFieldMatches,
  findScheduleLogEntryIndent,
  findScheduleLogMarker,
  findSingleFutureScheduledField,
  findTaskPickerMarkerNearCursor,
  formatCalendarDate,
  formatDailyDate,
  getCaretCompletionDestination,
  getDailyNotesOptions,
  isSoleContentLinkBullet,
  lineIsInsideCodeFence,
  listItemBodyBounds,
  parseDependsOnIds,
  parseInlineIdField,
  parseStrictCalendarDate,
  partitionTaskPickerItems,
  planAllOpenPomodoroLinkCleanup,
  planFuturePomodoroLinkCleanup,
  planPomodoroLinkInsertion,
  planTargetTaskOpenUpdate,
  planTargetTaskUpdate,
  resolveTaskDependencyState,
  selectPomodoroInsertionTarget,
  sourceQualifiesForPomodoroActivation,
  taskBlockedState,
  taskIdKeysFromLine,
  taskPickerRevertCursorCh,
  taskPickerRevertReplacement,
  taskStatusClass,
  todayDailyPath,
};
