function isOpenDoneTaskStatus(taskStatus) {
  return !!taskStatus && OPEN_DONE_TASK_SYMBOLS.has(taskStatus.symbol);
}

// A Task Link whose target is a Cancelled `[-]` task: Ctrl+Enter must consume
// the key with a notice instead of falling back to completing the owning
// Pomodoro. Checked only after the normal open/done resolution fails, so
// links that resolve to no task keep their current fallback.
function isCancelledTaskStatus(taskStatus) {
  return !!taskStatus && taskStatus.symbol === "-";
}

function isCyclableTaskStatus(taskStatus) {
  return !!taskStatus && SOURCE_STATUS_CYCLE.includes(taskStatus.symbol);
}

function isTranscludedCompletionTraversableStatus(taskStatus) {
  return isOpenDoneTaskStatus(taskStatus);
}

function isTranscludedCompletionClosableStatus(taskStatus) {
  return !!taskStatus && CLOSABLE_TASK_SYMBOLS.has(taskStatus.symbol);
}

function isTranscludedReopenableStatus(taskStatus) {
  return !!taskStatus && taskStatus.symbol === "x";
}

function isNonTranscludedStartResolvableStatus(taskStatus) {
  return isOpenDoneTaskStatus(taskStatus);
}

function isNonTranscludedStartableStatus(taskStatus) {
  return (
    !!taskStatus && (taskStatus.symbol === " " || taskStatus.symbol === "*")
  );
}

function isTopLevelTaskLine(lineText) {
  return TOP_LEVEL_TASK_LINE_RE.test(String(lineText || ""));
}

function isTopLevelDashListToggleLine(lineText) {
  return TOP_LEVEL_DASH_LIST_TOGGLE_LINE_RE.test(String(lineText || ""));
}

function isTopLevelBulletLikeLine(lineText) {
  return TOP_LEVEL_LIST_ITEM_LINE_RE.test(String(lineText || ""));
}

function getNextOpenDoneSymbol(taskStatus) {
  if (!isOpenDoneTaskStatus(taskStatus)) {
    return null;
  }

  return taskStatus.symbol === "x" ? " " : "x";
}

function normalizeTaskMetadataSpacing(lineText) {
  const line = String(lineText || "");
  const blockIdMatch = line.match(TRAILING_BLOCK_ID_RE);
  if (!blockIdMatch) {
    return line.replace(/[ \t]+$/, "");
  }

  const beforeBlockId = line.slice(0, blockIdMatch.index).replace(/[ \t]+$/, "");
  return `${beforeBlockId} ${blockIdMatch[0].trim()}`;
}

function removeCompletionField(lineText) {
  return normalizeTaskMetadataSpacing(String(lineText || "").replace(COMPLETION_FIELD_RE, ""));
}

function isPlainStandaloneTaskTagAt(lineText, startIndex, endIndex) {
  const line = String(lineText || "");
  const before = startIndex > 0 ? line[startIndex - 1] : "";
  const after = endIndex < line.length ? line[endIndex] : "";
  return (
    (startIndex === 0 || !TASK_TAG_BOUNDARY_BEFORE_RE.test(before)) &&
    (endIndex === line.length || !TASK_TAG_BOUNDARY_AFTER_RE.test(after))
  );
}

function mergeTextRanges(ranges) {
  const sortedRanges = ranges
    .filter((range) => range && range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges[mergedRanges.length - 1];
    if (!previousRange || range.start > previousRange.end) {
      mergedRanges.push({ ...range });
      continue;
    }

    previousRange.end = Math.max(previousRange.end, range.end);
  }

  return mergedRanges;
}

function collectObsidianTaskTokenRanges(bodyText) {
  const body = String(bodyText || "");
  const ranges = [];
  let match;

  TASK_TAG_TEXT_RE.lastIndex = 0;
  while ((match = TASK_TAG_TEXT_RE.exec(body)) !== null) {
    const start = match.index;
    const end = start + TASKS_GLOBAL_FILTER.length;
    if (isPlainStandaloneTaskTagAt(body, start, end)) {
      ranges.push({ start, end });
    }
  }

  return mergeTextRanges(ranges);
}

function removeTextRanges(text, ranges) {
  const sourceText = String(text || "");
  let nextText = "";
  let cursor = 0;

  for (const range of mergeTextRanges(ranges)) {
    nextText += sourceText.slice(cursor, range.start);
    cursor = range.end;
  }

  return nextText + sourceText.slice(cursor);
}

function collapseWhitespaceOutsideBracketSpans(text) {
  const sourceText = String(text || "");
  let nextText = "";
  let bracketDepth = 0;
  let hasPendingWhitespace = false;

  for (const char of sourceText) {
    if (bracketDepth === 0 && /[ \t]/.test(char)) {
      hasPendingWhitespace = true;
      continue;
    }

    if (hasPendingWhitespace) {
      nextText += " ";
      hasPendingWhitespace = false;
    }

    nextText += char;

    if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    }
  }

  return nextText;
}

function cleanObsidianTaskBody(bodyText, tokenRanges = collectObsidianTaskTokenRanges(bodyText)) {
  const bodyWithoutTokens = removeTextRanges(bodyText, tokenRanges);
  const compactBody = collapseWhitespaceOutsideBracketSpans(bodyWithoutTokens);
  return normalizeTaskMetadataSpacing(compactBody).replace(/^[ \t]+/, "");
}

function lineHasCreatedField(lineText) {
  return CREATED_FIELD_RE.test(String(lineText || ""));
}

function getCursorChAfterTextEdits(cursorCh, nextLineText, edits) {
  const nextLine = String(nextLineText || "");
  const currentCh = Math.max(0, Math.floor(Number(cursorCh) || 0));
  const sortedEdits = Array.isArray(edits)
    ? edits
        .filter((edit) => edit && edit.start <= edit.end)
        .sort((left, right) => left.start - right.start || left.end - right.end)
    : [];
  let delta = 0;

  for (const edit of sortedEdits) {
    const replacementLength = String(edit.text || "").length;
    const removedLength = edit.end - edit.start;

    if (removedLength === 0) {
      if (currentCh >= edit.start) {
        delta += replacementLength;
      }
      continue;
    }

    if (currentCh <= edit.start) {
      break;
    }

    if (currentCh < edit.end) {
      return Math.max(0, Math.min(nextLine.length, edit.start + delta));
    }

    delta += replacementLength - removedLength;
  }

  return Math.max(0, Math.min(nextLine.length, currentCh + delta));
}

function isProperObsidianTaskLine(lineText) {
  const line = String(lineText || "");
  return TASK_CHECKBOX_MARKER_RE.test(line) && lineMatchesTasksGlobalFilterText(line);
}

function getDemoteObsidianTaskLineRewrite(lineText) {
  const line = String(lineText || "");
  const taskMatch = line.match(TASK_CHECKBOX_MARKER_RE);
  if (!taskMatch || !isProperObsidianTaskLine(line)) {
    return null;
  }

  const prefix = taskMatch[1];
  const body = taskMatch[3] || "";
  const markerStart = prefix.length;
  const markerEnd = line.length - body.length;
  const tokenRanges = collectObsidianTaskTokenRanges(body);
  const edits = [
    { start: markerStart, end: markerEnd, text: "" },
    ...tokenRanges.map((range) => ({
      start: markerEnd + range.start,
      end: markerEnd + range.end,
      text: "",
    })),
  ];

  return {
    sourceLineText: line,
    lineText: `${prefix}${cleanObsidianTaskBody(body, tokenRanges)}`,
    edits,
  };
}

function demoteObsidianTaskLine(lineText) {
  const rewrite = getDemoteObsidianTaskLineRewrite(lineText);
  return rewrite ? rewrite.lineText : null;
}

function addCreatedFieldToObsidianTaskLine(lineText, createdDateString) {
  const line = normalizeTaskMetadataSpacing(lineText);
  if (lineHasCreatedField(line)) {
    return line;
  }

  const createdField = `[created::${createdDateString || formatLocalDate()}]`;
  const blockIdMatch = line.match(TRAILING_BLOCK_ID_RE);
  if (!blockIdMatch) {
    return `${line} ${createdField}`;
  }

  const beforeBlockId = line.slice(0, blockIdMatch.index).replace(/[ \t]+$/, "");
  return `${beforeBlockId} ${createdField} ${blockIdMatch[0].trim()}`;
}

function getPromoteLineToObsidianTaskRewrite(lineText, createdDateString) {
  const line = String(lineText || "");
  const checkboxMatch = line.match(TASK_CHECKBOX_MARKER_RE);
  const listMatch = checkboxMatch ? null : line.match(LIST_ITEM_MARKER_RE);
  if (!checkboxMatch && !listMatch) {
    return null;
  }

  const edits = [];
  let nextLine = line;
  const hasTaskTag = lineMatchesTasksGlobalFilterText(line);

  if (checkboxMatch) {
    const body = checkboxMatch[3] || "";
    const markerEnd = line.length - body.length;
    const markerSpace = checkboxMatch[2] || "";
    const markerSpaceStart = markerEnd - markerSpace.length;
    const markerText = line.slice(0, markerSpaceStart);
    const markerSpaceText = " ";
    const taskTagText = hasTaskTag ? "" : `${TASKS_GLOBAL_FILTER} `;
    nextLine = `${markerText}${markerSpaceText}${taskTagText}${body}`;
    if (markerSpace !== markerSpaceText) {
      edits.push({
        start: markerSpaceStart,
        end: markerEnd,
        text: markerSpaceText,
      });
    }

    if (!hasTaskTag) {
      edits.push({ start: markerEnd, end: markerEnd, text: taskTagText });
    }
  } else {
    const prefix = listMatch[1];
    const body = listMatch[2] || "";
    const insertionText = `${EMPTY_TASK_CHECKBOX_MARKER}${hasTaskTag ? "" : `${TASKS_GLOBAL_FILTER} `}`;
    const insertionIndex = prefix.length;
    nextLine = `${prefix}${insertionText}${body}`;
    edits.push({ start: insertionIndex, end: insertionIndex, text: insertionText });
  }

  if (!lineHasCreatedField(nextLine)) {
    const createdField = `[created::${createdDateString || formatLocalDate()}]`;
    const blockIdMatch = line.match(TRAILING_BLOCK_ID_RE);
    const insertionIndex = blockIdMatch ? blockIdMatch.index : line.length;
    edits.push({
      start: insertionIndex,
      end: insertionIndex,
      text: ` ${createdField}`,
    });

    nextLine = addCreatedFieldToObsidianTaskLine(nextLine, createdDateString);
  }

  return {
    sourceLineText: line,
    lineText: nextLine,
    edits,
  };
}

function promoteLineToObsidianTask(lineText, createdDateString) {
  const rewrite = getPromoteLineToObsidianTaskRewrite(lineText, createdDateString);
  return rewrite ? rewrite.lineText : null;
}

function getObsidianTaskToggle(lineText, createdDateString) {
  const line = String(lineText || "");
  if (isProperObsidianTaskLine(line)) {
    return getDemoteObsidianTaskLineRewrite(line);
  }

  return getPromoteLineToObsidianTaskRewrite(line, createdDateString);
}

function getObsidianTaskToggleCursorCh(cursorCh, toggle) {
  if (!toggle) {
    return cursorCh;
  }

  return getCursorChAfterTextEdits(
    cursorCh,
    toggle.lineText,
    toggle.edits,
  );
}

