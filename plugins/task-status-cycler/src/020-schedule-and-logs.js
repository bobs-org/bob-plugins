// `?` (Blocked) joins the option-bracket cycle as a source-only slot: it is
// always readable as a starting status, but never a writable destination
// (see getAdjacentSymbol). FIXED_SYMBOLS stays the destination set.
const BLOCKED_TASK_STATUS_SYMBOL = "?";
const SOURCE_STATUS_CYCLE = [BLOCKED_TASK_STATUS_SYMBOL, ...FIXED_SYMBOLS];

// Recognizes the same task-level `scheduled` forms as `bob task-status-hooks`
// and `plugins/block-id-prompt/main.js`: `[scheduled:: YYYY-MM-DD]` and
// `(scheduled:: YYYY-MM-DD)`, anywhere on the line and in any field order.
// The captured value is validated separately so a malformed or duplicate
// field still counts toward ambiguity.
const SCHEDULED_FIELD_RE = /\[scheduled::([^\]\n]*)\]|\(scheduled::([^)\n]*)\)/g;
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function isCalendarLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInScheduledMonth(year, month) {
  return month === 2 && isCalendarLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

// Require an exact four-digit year/two-digit month/two-digit day and validate
// the actual calendar date (rejects e.g. 2026-02-30).
function parseStrictCalendarDate(value) {
  const match = CALENDAR_DATE_RE.exec(
    String(value === null || value === undefined ? "" : value),
  );
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInScheduledMonth(year, month)) {
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

function findScheduledFieldMatches(lineText) {
  const text = String(lineText || "");
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

// Exactly one recognized scheduled field, syntactically valid, and strictly
// later than `todayDateString` — the only shape that qualifies for
// Blocked-retirement. Two or more recognized fields, an invalid date, or a
// today/past date are all treated the same way: left completely untouched.
function findSingleFutureScheduledField(lineText, todayDateString) {
  const today = parseStrictCalendarDate(todayDateString);
  if (!today) {
    return null;
  }

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
// whitespace. Other inline fields, tags, prose, list/quote prefixes, and a
// trailing block ID are all left untouched since they sit outside the span.
function removeSpanWithSpaceCollapse(lineText, start, end) {
  const line = String(lineText || "");
  const before = line.slice(0, start);
  const after = line.slice(end);

  if (before.trim() && after.trim()) {
    return `${before.replace(/[ \t]+$/g, "")} ${after.replace(/^[ \t]+/g, "")}`;
  }

  return before.replace(/[ \t]+$/g, "") + after.replace(/^[ \t]+/g, "");
}

function parseListItemPrefix(lineText) {
  const match = String(lineText || "").match(/^([ \t]*)([-*+]|\d+[.)])[ \t]+/);
  return match ? { indent: match[1], marker: match[2] } : null;
}

// Scanning backward from `childLine`, the nearest earlier list item whose
// indent is strictly smaller. Non-list lines with a smaller indent are
// skipped rather than stopping the search.
function findNearestParentListItemLine(lines, childLine) {
  if (!Array.isArray(lines) || !Number.isInteger(childLine) || childLine <= 0) {
    return null;
  }

  const childIndent = getLineIndentation(lines[childLine] || "").length;
  for (let line = childLine - 1; line >= 0; line -= 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim() || getLineIndentation(lineText).length >= childIndent) {
      continue;
    }

    if (parseListItemPrefix(lineText)) {
      return line;
    }
  }

  return null;
}

// The exclusive-of-nothing-past-it last line of `parentLine`'s child block:
// every later line that is blank or indented deeper than the parent, stopping
// at the first nonblank line indented at or shallower than the parent.
function findTaskChildBlockEndLine(lines, parentLine) {
  const parentIndent = getLineIndentation(lines[parentLine] || "").length;
  let endLine = parentLine;

  for (let line = parentLine + 1; line < lines.length; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }
    if (getLineIndentation(lineText).length > parentIndent) {
      endLine = line;
      continue;
    }
    break;
  }

  return endLine;
}

// Managed "schedule log" child bullet grammar: `- 🗓️ **SCHEDULE LOG**`, the
// emoji-less `- **SCHEDULE LOG**`, and the legacy `- **Schedule log:**`
// spelling. Mirrors plugins/bob-navigation-hotkeys/main.js's
// SCHEDULE_LOG_PARENT_RE and plugins/block-id-prompt/main.js and must stay
// compatible; kept as an independent copy since plugins are deployed
// separately and must not import each other's main.js.
const SCHEDULE_LOG_EMOJI = "🗓️";
const SCHEDULE_LOG_LABEL = "SCHEDULE LOG";
const LEGACY_SCHEDULE_LOG_LABEL = "Schedule log";
const SCHEDULE_LOG_PARENT_RE = new RegExp(
  `^([ \\t]*)([-*+]|\\d+[.)])[ \\t]+(?:${SCHEDULE_LOG_EMOJI}[ \\t]+)?\\*\\*(?:${SCHEDULE_LOG_LABEL}|${LEGACY_SCHEDULE_LOG_LABEL}):?\\*\\*[ \\t]*$`,
);
// bob-navigation-hotkeys' SCHEDULE_LOG_ENTRY_EMPHASIS/TRANSITION/SEPARATOR and
// bob-cli's capture_schedule_log.rs are the canonical entry-formatting
// vocabulary; the leading 🔓 (U+1F513) marks this entry as machine-written,
// joining 🎲, 🤷, and 🍅.
const SCHEDULE_LOG_ENTRY_EMPHASIS = "*";
const SCHEDULE_LOG_TRANSITION = " → ";
const SCHEDULE_LOG_SEPARATOR = " — ";
const SCHEDULE_LOG_UNBLOCKED_REASON = "🔓 unblocked by hand";

function parseScheduleLogMarkerLine(lineText) {
  const match = SCHEDULE_LOG_PARENT_RE.exec(String(lineText || ""));
  return match ? { indent: match[1], marker: match[2] } : null;
}

// The managed Schedule Log marker among `taskLine`'s direct children, or
// null. A marker belonging to a nested grandchild is ignored.
function findScheduleLogMarker(lines, taskLine) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(taskLine) ||
    taskLine < 0 ||
    taskLine >= lines.length
  ) {
    return null;
  }

  const endLine = findTaskChildBlockEndLine(lines, taskLine);
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

// The indentation of the marker's first direct-child entry, or null when the
// log has no entries yet.
function findScheduleLogEntryIndent(lines, markerLine) {
  const endLine = findTaskChildBlockEndLine(lines, markerLine);
  for (let line = markerLine + 1; line <= endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    const prefix = parseListItemPrefix(lineText);
    if (prefix && findNearestParentListItemLine(lines, line) === markerLine) {
      return prefix.indent;
    }
  }

  return null;
}

function formatScheduleLogEntry(removedDate, todayDate) {
  return `${SCHEDULE_LOG_ENTRY_EMPHASIS}${removedDate}${SCHEDULE_LOG_TRANSITION}${todayDate}${SCHEDULE_LOG_ENTRY_EMPHASIS}${SCHEDULE_LOG_SEPARATOR}${SCHEDULE_LOG_UNBLOCKED_REASON}`;
}

// Managed "work log" child bullet grammar: `- 🛠️ **WORK LOG**` and the legacy
// `- **Work log:**` spelling. Mirrors plugins/block-id-prompt/main.js's
// WORK_LOG_PARENT_RE and must stay byte-compatible, since bob-cli's
// src/native/capture.rs is a third implementation reading and writing the
// same logs; kept as an independent copy since plugins are deployed
// separately and must not import each other's main.js.
const WORK_LOG_EMOJI = "🛠️";
const WORK_LOG_LABEL = "WORK LOG";
const LEGACY_WORK_LOG_LABEL = "Work log";
const WORK_LOG_PARENT_RE = new RegExp(
  `^([ \\t]*)([-*+]|\\d+[.)])[ \\t]+(?:${WORK_LOG_EMOJI}[ \\t]+)?\\*\\*(?:${WORK_LOG_LABEL}|${LEGACY_WORK_LOG_LABEL}):?\\*\\*[ \\t]*$`,
);
const WORK_LOG_ENTRY_EMPHASIS = "*";
const WORK_LOG_ENTRY_SEPARATOR = " — ";

function parseWorkLogMarkerLine(lineText) {
  const match = WORK_LOG_PARENT_RE.exec(String(lineText || ""));
  return match ? { indent: match[1], marker: match[2] } : null;
}

// The managed Work Log marker among `taskLine`'s direct children, or null. A
// marker belonging to a nested child task is ignored.
function findWorkLogMarker(lines, taskLine) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(taskLine) ||
    taskLine < 0 ||
    taskLine >= lines.length
  ) {
    return null;
  }

  const endLine = findTaskChildBlockEndLine(lines, taskLine);
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

// The list-item prefix (indent and marker) of `parentLine`'s first direct
// child list item, or null when it has none yet. Shared by both Work Log
// insertion sites: finding an existing entry's style under a marker, and
// finding a task's own child-bullet style when creating a fresh marker.
function findFirstDirectChildPrefix(lines, parentLine) {
  if (!Array.isArray(lines) || !Number.isInteger(parentLine)) {
    return null;
  }

  const endLine = findTaskChildBlockEndLine(lines, parentLine);
  for (let line = parentLine + 1; line <= endLine; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }

    const parsed = parseListItemPrefix(lineText);
    if (parsed && findNearestParentListItemLine(lines, line) === parentLine) {
      return parsed;
    }
  }

  return null;
}

// One Obsidian Tab-indent level below `parentIndent`. A literal tab is what
// Obsidian inserts for Tab (the vault leaves `useTab` at its default); a
// space-only parent indent is a legacy note style, reused as the unit so the
// child stays space-indented instead of becoming a tab/space mix. Duplicated
// from block-id-prompt's childIndentUnitForIndent (worklog-indent phase).
function childIndentUnitForIndent(parentIndent) {
  const indent = String(parentIndent || "");
  return indent && !indent.includes("\t") ? indent : CHILD_BULLET_INDENT_UNIT;
}

function formatWorkLogEntryBody(summary, dateString) {
  return `${WORK_LOG_ENTRY_EMPHASIS}${dateString}${WORK_LOG_ENTRY_EMPHASIS}${WORK_LOG_ENTRY_SEPARATOR}${summary}`;
}

// Renders a Task Link sub-bullet's collected descendant tree (see
// collectPomodoroWorkLogDescendantTree) as Work Log entry lines: each depth-1
// node becomes a dated `*<date>* — <body>` entry at `entryIndent`, and its
// deeper descendants are carried beneath it, keeping their relative depth,
// re-indented one childIndentUnitForIndent step per level. A node whose body
// is empty after trimming is dropped along with its whole subtree, since a
// deeper node without a dated parent has nothing to hang beneath.
function buildWorkLogEntryLines(descendantRoots, entryIndent, entryMarker, dateString) {
  const lines = [];
  for (const node of descendantRoots || []) {
    if (!node.bodyText) {
      continue;
    }
    lines.push(
      `${entryIndent}${entryMarker} ${formatWorkLogEntryBody(node.bodyText, dateString)}`,
    );
    appendWorkLogChildLines(node.children, entryIndent, lines);
  }
  return lines;
}

function appendWorkLogChildLines(children, parentIndent, lines) {
  if (!children || children.length === 0) {
    return;
  }

  const childIndent = `${parentIndent}${childIndentUnitForIndent(parentIndent)}`;
  for (const node of children) {
    if (!node.bodyText) {
      continue;
    }
    lines.push(`${childIndent}${node.marker} ${node.bodyText}`);
    appendWorkLogChildLines(node.children, childIndent, lines);
  }
}

// Where and what to insert for one Task Link's collected notes against
// `taskLine`'s resolved target lines: prepend under an existing direct-child
// Work Log marker (inheriting its first entry's indent/marker, or deriving
// one when the marker has no entries yet), or append a fresh marker plus
// entries at the end of the task's child block, inheriting the task's own
// first direct child's indent/marker (or deriving one when the task has no
// children yet). Returns null when there is nothing to insert, either
// because `taskLine` is out of range or every descendant was dropped as
// empty.
//
// `priorInsertion`, when given, is the `nextInsertion` a previous call
// returned for this exact same target within the same Pomodoro close (see
// writePomodoroWorkLogNoteGroups): two Task Link sub-bullets can resolve to
// the same task, and both note sets must appear in source order rather than
// each independently prepending above the other. When present it skips
// marker detection and appends immediately after the prior group's entries,
// reusing their indent and marker style.
function planPomodoroWorkLogGroupInsertion(lines, taskLine, descendantRoots, dateString, priorInsertion = null) {
  let insertLine;
  let entryIndent;
  let entryMarker;
  let markerLineText = null;

  if (priorInsertion) {
    insertLine = priorInsertion.insertLine;
    entryIndent = priorInsertion.entryIndent;
    entryMarker = priorInsertion.entryMarker;
  } else {
    if (
      !Array.isArray(lines) ||
      !Number.isInteger(taskLine) ||
      taskLine < 0 ||
      taskLine >= lines.length
    ) {
      return null;
    }

    const marker = findWorkLogMarker(lines, taskLine);
    if (marker) {
      const entryPrefix = findFirstDirectChildPrefix(lines, marker.line);
      insertLine = marker.line + 1;
      entryIndent = entryPrefix
        ? entryPrefix.indent
        : `${marker.indent}${childIndentUnitForIndent(marker.indent)}`;
      entryMarker = entryPrefix ? entryPrefix.marker : "-";
    } else {
      const taskIndent = getLineIndentation(lines[taskLine] || "");
      const directChildPrefix = findFirstDirectChildPrefix(lines, taskLine);
      const parentIndent = directChildPrefix
        ? directChildPrefix.indent
        : `${taskIndent}${childIndentUnitForIndent(taskIndent)}`;
      const parentMarker = directChildPrefix ? directChildPrefix.marker : "-";
      insertLine = findTaskChildBlockEndLine(lines, taskLine) + 1;
      entryIndent = `${parentIndent}${childIndentUnitForIndent(parentIndent)}`;
      entryMarker = "-";
      markerLineText = `${parentIndent}${parentMarker} ${WORK_LOG_EMOJI} **${WORK_LOG_LABEL}**`;
    }
  }

  const entryLines = buildWorkLogEntryLines(
    descendantRoots,
    entryIndent,
    entryMarker,
    dateString,
  );
  if (entryLines.length === 0) {
    return null;
  }

  const insertedLines = markerLineText ? [markerLineText, ...entryLines] : entryLines;
  return {
    insertLine,
    insertedLines,
    nextInsertion: {
      insertLine: insertLine + insertedLines.length,
      entryIndent,
      entryMarker,
    },
  };
}

// Composes Blocked-status retirement for one task line: when (and only when)
// it carries exactly one syntactically valid, strictly future `scheduled`
// field, remove that field and, only if the task already owns a direct-child
// Schedule Log marker, plan one newest-first entry recording the move from
// the removed date to today. Never creates a marker. Returns null when
// nothing applies (no field, an ambiguous/invalid/past field, or the line is
// not a `#task`).
function planBlockedStatusRetirement(lines, taskLine, todayDateString) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(taskLine) ||
    taskLine < 0 ||
    taskLine >= lines.length
  ) {
    return null;
  }

  const taskLineText = String(lines[taskLine] || "");
  if (
    !getTaskStatusForLine(taskLineText, taskLine) ||
    !lineMatchesTasksGlobalFilterText(taskLineText)
  ) {
    return null;
  }

  const field = findSingleFutureScheduledField(taskLineText, todayDateString);
  if (!field) {
    return null;
  }

  const nextTaskLineText = removeSpanWithSpaceCollapse(
    taskLineText,
    field.start,
    field.end,
  );
  const removedDate = formatCalendarDate(field.date);

  const marker = findScheduleLogMarker(lines, taskLine);
  if (!marker) {
    return { lineText: nextTaskLineText, removedDate, insertion: null };
  }

  const existingIndent = findScheduleLogEntryIndent(lines, marker.line);
  const entryIndent =
    existingIndent !== null
      ? existingIndent
      : `${marker.indent}${CHILD_BULLET_INDENT_UNIT}`;
  const entryText = `${entryIndent}${marker.marker} ${formatScheduleLogEntry(removedDate, todayDateString)}`;

  return {
    lineText: nextTaskLineText,
    removedDate,
    insertion: { line: marker.line + 1, text: entryText },
  };
}

// Insert `newLineText` as a new line immediately before line index
// `insertLine` (or, when it equals the line count, as the new final line),
// giving it `inheritedEnding` and fixing up the now-former-last line's ending
// so the file's trailing-newline state is preserved.
// Insert `newLineTexts` as new lines immediately before line index
// `insertLine` (or, when it equals the line count, as the new final lines),
// giving interior lines a real separator ending and the last inserted line
// `inheritedEnding`, and fixing up the now-former-last line's ending so the
// file's trailing-newline state is preserved.
function insertLinesInSourceText(sourceText, insertLine, newLineTexts, inheritedEnding) {
  const texts = Array.isArray(newLineTexts) ? newLineTexts : [newLineTexts];
  if (texts.length === 0) {
    return String(sourceText || "");
  }

  const sourceLines = splitTextByLineEndings(sourceText);
  const index = Math.max(
    0,
    Math.min(Math.floor(Number(insertLine) || 0), sourceLines.length),
  );
  const nextLines = sourceLines.slice();
  const precedingIndex = index - 1;
  const precedingLine = precedingIndex >= 0 ? nextLines[precedingIndex] : null;

  if (precedingLine && precedingLine.ending === "") {
    nextLines[precedingIndex] = {
      ...precedingLine,
      ending: inheritedEnding || "\n",
    };
  }

  const insertedLines = texts.map((text, position) => ({
    text: String(text || ""),
    ending:
      position < texts.length - 1
        ? inheritedEnding || "\n"
        : inheritedEnding || "",
  }));
  nextLines.splice(index, 0, ...insertedLines);

  return nextLines.map((line) => `${line.text}${line.ending}`).join("");
}

function insertLineInSourceText(sourceText, insertLine, newLineText, inheritedEnding) {
  return insertLinesInSourceText(sourceText, insertLine, [newLineText], inheritedEnding);
}

// The dominant line ending across already-split `sourceLines`: CRLF when any
// line uses it, else LF. Used to pick the ending for a freshly inserted Work
// Log block written through the vault, where (unlike an editor buffer) the
// file's own CRLF-vs-LF convention must be preserved.
function sourceTextLineEnding(sourceLines) {
  return (sourceLines || []).some((line) => line.ending === "\r\n") ? "\r\n" : "\n";
}

// Text-level wrapper for the vault write path: re-derives the retirement plan
// from `sourceText` itself (never from stale coordinates) and applies the
// field removal and, when planned, the log insertion together, preserving
// each line's own ending and giving a new entry line the marker line's
// ending.
function applyBlockedStatusRetirementToSourceText(sourceText, taskLine, todayDateString) {
  const text = String(sourceText || "");
  const sourceLines = splitTextByLineEndings(text);
  const lines = sourceLines.map((line) => line.text);
  const plan = planBlockedStatusRetirement(lines, taskLine, todayDateString);
  if (!plan) {
    return null;
  }

  let nextText = replaceLineInSourceText(text, taskLine, plan.lineText);
  if (nextText === null) {
    return null;
  }

  if (plan.insertion) {
    const markerLine = plan.insertion.line - 1;
    const markerEnding = sourceLines[markerLine] ? sourceLines[markerLine].ending : "\n";
    nextText = insertLineInSourceText(
      nextText,
      plan.insertion.line,
      plan.insertion.text,
      markerEnding,
    );
  }

  return { text: nextText, removedDate: plan.removedDate };
}

