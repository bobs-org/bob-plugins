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

function parseWorkLogMarkerLine(lineText) {
  const match = WORK_LOG_PARENT_RE.exec(normalizeMarkdownLine(lineText));
  return match ? { indent: match[1], marker: match[2] } : null;
}

function parseListItemPrefix(lineText) {
  const match = /^([ \t]*)([-*+]|\d+[.)])[ \t]+/.exec(
    normalizeMarkdownLine(lineText),
  );
  return match ? { indent: match[1], marker: match[2] } : null;
}

function normalizeWorkSummary(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim()
    .replace(/\s+/g, " ");
}

function formatWorkLogEntry(summary, dateParts) {
  const normalizedSummary = normalizeWorkSummary(summary);
  if (!normalizedSummary) {
    return "";
  }

  return `${WORK_LOG_ENTRY_EMPHASIS}${formatCalendarDate(dateParts)}${WORK_LOG_ENTRY_EMPHASIS}${WORK_LOG_ENTRY_SEPARATOR}${normalizedSummary}`;
}

function workSummaryContainsDataviewInlineField(value) {
  return normalizeWorkSummary(value).includes("::");
}

function workSummaryPromptState(value, options = {}) {
  const summary = normalizeWorkSummary(value);
  const date = options.date || localTodayParts(options.now);
  const formattedEntry = summary ? formatWorkLogEntry(summary, date) : "";
  return {
    summary,
    date,
    formattedEntry,
    isBlank: summary.length === 0,
    hasDataviewWarning: summary.includes("::"),
    primaryButtonText: summary ? "Unlink & log" : "Unlink",
  };
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
// plugins/bob-navigation-hotkeys/src/020-config-load-and-tasks.js's findNearestParentListItem.
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

// The managed Work Log marker among `taskLine`'s direct children, or null.
// A marker belonging to a nested child task or any deeper subtree is ignored.
function findWorkLogMarker(lines, taskLine) {
  if (!Array.isArray(lines) || !Number.isInteger(taskLine) || taskLine < 0 || taskLine >= lines.length) {
    return null;
  }

  const endLine = findChildBlockEndLine(lines, taskLine);
  for (let line = taskLine + 1; line <= endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    const parsed = parseWorkLogMarkerLine(lineText);
    if (parsed && findNearestParentListItemLine(lines, line) === taskLine) {
      return { line, indent: parsed.indent, marker: parsed.marker };
    }
  }

  return null;
}

function findTaskDirectChildPrefix(lines, taskLine) {
  if (!Array.isArray(lines) || !Number.isInteger(taskLine)) {
    return null;
  }

  const endLine = findChildBlockEndLine(lines, taskLine);
  for (let line = taskLine + 1; line <= endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    const parsed = parseListItemPrefix(lineText);
    if (parsed && findNearestParentListItemLine(lines, line) === taskLine) {
      return parsed;
    }
  }

  return null;
}

function canonicalTaskChildIndent(lines, taskLine) {
  const taskPrefix = parseListItemPrefix(lines[taskLine] || "");
  const taskIndent = taskPrefix ? taskPrefix.indent : "";
  return `${taskIndent}${childIndentUnitForIndent(taskIndent)}`;
}

function findWorkLogEntryPrefix(lines, markerLine) {
  if (!Array.isArray(lines) || !Number.isInteger(markerLine)) {
    return null;
  }

  const endLine = findChildBlockEndLine(lines, markerLine);
  for (let line = markerLine + 1; line <= endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    const parsed = parseListItemPrefix(lineText);
    if (parsed && findNearestParentListItemLine(lines, line) === markerLine) {
      return parsed;
    }
  }

  return null;
}

function lineEndingForInsertion(content, lines, lineNumber) {
  if (
    Number.isInteger(lineNumber) &&
    lineNumber >= 0 &&
    lineNumber < lines.length &&
    String(lines[lineNumber] || "").endsWith("\r")
  ) {
    return "\r\n";
  }

  return String(content || "").includes("\r\n") ? "\r\n" : "\n";
}

function insertionEditAtLine(content, lines, insertLine, insertedLines, lineEnding) {
  if (insertLine < lines.length) {
    const insertionIndex = lineStartIndexFromLines(lines, insertLine);
    return {
      start: insertionIndex,
      end: insertionIndex,
      replacement: `${insertedLines.join(lineEnding)}${lineEnding}`,
    };
  }

  return {
    start: content.length,
    end: content.length,
    replacement: `${lineEnding}${insertedLines.join(lineEnding)}`,
  };
}

function planWorkLogInsertion(preimageContent, taskLine, rawSummary, options = {}) {
  const summary = normalizeWorkSummary(rawSummary);
  const content = String(preimageContent === null || preimageContent === undefined ? "" : preimageContent);
  if (!summary) {
    return {
      content,
      edits: [],
      summary,
      workLogDate: null,
      workLogFormattedEntry: "",
      workLogEntryAdded: false,
      workLogInsertLine: null,
      hasChanges: false,
    };
  }

  const workLogDate = options.date || localTodayParts(options.now);
  const workLogFormattedEntry = formatWorkLogEntry(summary, workLogDate);

  const lines = content.split("\n");
  if (!Number.isInteger(taskLine) || taskLine < 0 || taskLine >= lines.length) {
    return null;
  }

  const taskLineText = normalizeMarkdownLine(lines[taskLine] || "");
  if (!getObsidianTaskLineMatch(taskLineText)) {
    return null;
  }

  const marker = findWorkLogMarker(lines, taskLine);
  let edit;
  let workLogInsertLine;

  if (marker) {
    const entryPrefix =
      findWorkLogEntryPrefix(lines, marker.line) || {
        indent: `${marker.indent}${childIndentUnitForIndent(marker.indent)}`,
        marker: marker.marker,
      };
    const entryLineText = `${entryPrefix.indent}${entryPrefix.marker} ${workLogFormattedEntry}`;
    workLogInsertLine = marker.line + 1;
    edit = insertionEditAtLine(
      content,
      lines,
      workLogInsertLine,
      [entryLineText],
      lineEndingForInsertion(content, lines, marker.line),
    );
  } else {
    const directChildPrefix =
      findTaskDirectChildPrefix(lines, taskLine) || {
        indent: canonicalTaskChildIndent(lines, taskLine),
        marker: "-",
      };
    const entryIndent = `${directChildPrefix.indent}${childIndentUnitForIndent(directChildPrefix.indent)}`;
    const markerLineText = `${directChildPrefix.indent}${directChildPrefix.marker} ${WORK_LOG_EMOJI} **${WORK_LOG_LABEL}**`;
    const entryLineText = `${entryIndent}- ${workLogFormattedEntry}`;
    workLogInsertLine = findChildBlockEndLine(lines, taskLine) + 1;
    edit = insertionEditAtLine(
      content,
      lines,
      workLogInsertLine,
      [markerLineText, entryLineText],
      lineEndingForInsertion(content, lines, taskLine),
    );
  }

  const edits = [edit];
  return {
    content: applyTextEdits(content, edits),
    edits,
    summary,
    workLogDate,
    workLogFormattedEntry,
    workLogEntryAdded: true,
    workLogInsertLine,
    hasChanges: true,
  };
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

