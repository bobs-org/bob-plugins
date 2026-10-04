function applyEditorLineChanges(cm, originalLines, nextLines, finalCursor = null) {
  if (
    !cm ||
    !Array.isArray(originalLines) ||
    !Array.isArray(nextLines) ||
    originalLines.length !== nextLines.length ||
    nextLines.some((line) => /[\r\n]/.test(String(line)))
  ) {
    return false;
  }

  const changes = [];
  for (let line = 0; line < originalLines.length; line += 1) {
    const originalLine = String(originalLines[line] || "");
    const nextLine = String(nextLines[line] || "");
    if (originalLine === nextLine) {
      continue;
    }
    changes.push({
      from: { line, ch: 0 },
      to: { line, ch: originalLine.length },
      text: nextLine,
    });
  }

  if (changes.length === 0) {
    return true;
  }

  const cursor = normalizePosition(finalCursor);
  if (typeof cm.transaction === "function") {
    const transaction = { changes };
    if (cursor) {
      transaction.selection = { from: cursor, to: cursor };
    }
    cm.transaction(transaction);
    return true;
  }

  if (typeof cm.replaceRange !== "function") {
    return false;
  }
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    cm.replaceRange(change.text, change.from, change.to);
  }
  if (cursor) {
    setEditorCursorSafely(cm, cursor.line, cursor.ch);
  }
  return true;
}

function applyEditorContentTransaction(
  cm,
  originalContent,
  nextContent,
  finalCursor = null,
) {
  if (!cm) {
    return false;
  }
  const originalText = String(originalContent || "");
  const nextText = String(nextContent || "");
  const original = splitMarkdownContent(originalText);
  const next = splitMarkdownContent(nextText);
  const cursor = normalizePosition(finalCursor);

  if (original.lines.length === next.lines.length) {
    return applyEditorLineChanges(cm, original.lines, next.lines, cursor);
  }
  if (originalText === nextText) {
    return true;
  }

  const lastLine = Math.max(original.lines.length - 1, 0);
  const change = {
    from: { line: 0, ch: 0 },
    to: {
      line: lastLine,
      ch: String(original.lines[lastLine] || "").length,
    },
    text: nextText,
  };
  if (typeof cm.transaction === "function") {
    const transaction = { changes: [change] };
    if (cursor) {
      transaction.selection = { from: cursor, to: cursor };
    }
    cm.transaction(transaction);
    return true;
  }
  if (typeof cm.replaceRange !== "function") {
    return false;
  }

  const scroll =
    typeof cm.getScrollInfo === "function" ? cm.getScrollInfo() : null;
  cm.replaceRange(change.text, change.from, change.to);
  if (cursor) {
    setEditorCursorSafely(cm, cursor.line, cursor.ch);
  }
  if (scroll && typeof cm.scrollTo === "function") {
    try {
      cm.scrollTo(scroll.left, scroll.top);
    } catch (error) {
      // Viewport restoration is best-effort on older editor adapters.
    }
  }
  return true;
}

function replaceEditorContent(cm, oldContent, newContent) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }
  const oldText = String(oldContent || "");
  const nextText = String(newContent || "");
  if (oldText === nextText) {
    return true;
  }
  const oldLines = oldText.split(/\r?\n/);
  const lastLine = Math.max(oldLines.length - 1, 0);
  cm.replaceRange(
    nextText,
    { line: 0, ch: 0 },
    { line: lastLine, ch: String(oldLines[lastLine] || "").length },
  );
  return true;
}

// Insert a full new line at the `line` boundary, pushing the existing line at
// that index (and everything below) down by one. When `line` is past the final
// line, the new line is appended after the last line instead. Kept separate from
// replaceEditorLine so a single-line replace is never overloaded with a
// multi-line insert.
function insertEditorLine(cm, line, lineText) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }

  const text = String(lineText === null || lineText === undefined ? "" : lineText);
  const lastLine = getEditorLastLine(cm);

  if (lastLine !== null && line > lastLine) {
    const lastLineText = getEditorLineText(cm, lastLine);
    const lastLineLength = lastLineText === null ? 0 : lastLineText.length;
    cm.replaceRange(`\n${text}`, { line: lastLine, ch: lastLineLength });
    return true;
  }

  cm.replaceRange(`${text}\n`, { line, ch: 0 });
  return true;
}

// Apply a task-line replacement plus its Schedule Log insertion as one editor
// change set, so one Ctrl+Z reverts date, priority, Blocked mark, stamp and
// log together. Coordinates are in the original document: the line count is
// unchanged by the task-line edit, so the planned insertLine stays valid.
// Falls back (returns false) when the editor has no `transaction`.
function applyInlinePropertyAndScheduleLogTransaction(
  cm,
  cursorLine,
  oldLineText,
  nextLine,
  scheduleLogPlan,
  finalCursor = null,
) {
  if (!cm || typeof cm.transaction !== "function") {
    return false;
  }
  const changes = [];
  if (String(nextLine) !== String(oldLineText)) {
    changes.push({
      from: { line: cursorLine, ch: 0 },
      to: { line: cursorLine, ch: String(oldLineText).length },
      text: String(nextLine),
    });
  }
  if (scheduleLogPlan && scheduleLogPlan.valid) {
    const text = String(
      scheduleLogPlan.lineText === null || scheduleLogPlan.lineText === undefined
        ? ""
        : scheduleLogPlan.lineText,
    );
    const lastLine = getEditorLastLine(cm);
    if (lastLine !== null && scheduleLogPlan.insertLine > lastLine) {
      const lastLineText = getEditorLineText(cm, lastLine);
      const lastLineLength = lastLineText === null ? 0 : lastLineText.length;
      changes.push({
        from: { line: lastLine, ch: lastLineLength },
        to: { line: lastLine, ch: lastLineLength },
        text: `\n${text}`,
      });
    } else {
      const atLine = Math.max(
        0,
        Math.floor(numericOrDefault(scheduleLogPlan.insertLine, Number.NaN)),
      );
      if (!Number.isFinite(atLine)) {
        return false;
      }
      changes.push({
        from: { line: atLine, ch: 0 },
        to: { line: atLine, ch: 0 },
        text: `${text}\n`,
      });
    }
  }
  if (changes.length === 0) {
    return true;
  }
  const cursor = normalizePosition(finalCursor);
  const transaction = { changes };
  if (cursor) {
    transaction.selection = { from: cursor, to: cursor };
  }
  cm.transaction(transaction);
  return true;
}

function deleteEditorLine(cm, line) {
  if (!cm || typeof cm.replaceRange !== "function") {
    return false;
  }

  const targetLine = Math.floor(numericOrDefault(line, Number.NaN));
  const lastLine = getEditorLastLine(cm);
  if (
    !Number.isFinite(targetLine) ||
    targetLine < 0 ||
    lastLine === null ||
    targetLine > lastLine
  ) {
    return false;
  }

  const lineText = getEditorLineText(cm, targetLine);
  const lineLength = lineText === null ? 0 : lineText.length;
  if (targetLine < lastLine) {
    cm.replaceRange(
      "",
      { line: targetLine, ch: 0 },
      { line: targetLine + 1, ch: 0 },
    );
    return true;
  }

  if (targetLine > 0) {
    const previousLineText = getEditorLineText(cm, targetLine - 1);
    const previousLineLength =
      previousLineText === null ? 0 : previousLineText.length;
    cm.replaceRange(
      "",
      { line: targetLine - 1, ch: previousLineLength },
      { line: targetLine, ch: lineLength },
    );
    return true;
  }

  cm.replaceRange(
    "",
    { line: targetLine, ch: 0 },
    { line: targetLine, ch: lineLength },
  );
  return true;
}

function setEditorCursorSafely(cm, line, ch) {
  if (!cm || typeof cm.setCursor !== "function") {
    return false;
  }

  try {
    cm.setCursor(line, ch);
  } catch (error) {
    cm.setCursor({ line, ch });
  }

  return true;
}

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

function scheduleDashTasksScrollAssert(plugin, targetLine, options = {}) {
  if (!plugin || typeof plugin.getActiveMarkdownView !== "function") {
    return false;
  }

  const line = Math.floor(numericOrDefault(targetLine, Number.NaN));
  if (!Number.isFinite(line) || line < 0) {
    return false;
  }

  cancelDeferred(plugin.pendingDashTasksScrollDeferred);
  plugin.pendingDashTasksScrollDeferred = null;

  const frames = Math.max(
    1,
    Math.floor(
      numericOrDefault(options.frames, DASH_TASKS_SCROLL_ASSERT_FRAMES),
    ),
  );

  const runFrame = (frame) => {
    plugin.pendingDashTasksScrollDeferred = null;

    const view = plugin.getActiveMarkdownView();
    if (
      !view ||
      !view.file ||
      view.file.path !== DASH_FILE_PATH ||
      !view.editor
    ) {
      return;
    }

    const cursor = getEditorCursor(view.editor);
    if (!cursor || cursor.line !== line) {
      setEditorCursor(view.editor, { line, ch: 0 });
    }

    scrollEditorLineToTop(view.editor, line);

    if (frame + 1 >= frames) {
      return;
    }

    plugin.pendingDashTasksScrollDeferred = deferToNextFrame(() =>
      runFrame(frame + 1),
    );
  };

  plugin.pendingDashTasksScrollDeferred = deferToNextFrame(() => runFrame(0));
  return true;
}

function findTransclusionToggleTargets(line) {
  const text = String(line || "");
  // A Depends-On line is never a transclusion target: `!` is refused there
  // and dependencies are edited through Ctrl+Shift+P instead
  // (`docs/task-dependencies.md` §7).
  if (parseDependencyLine(text, {}).verdict !== "not-a-line") {
    return [];
  }
  const dependencyBullet = parseDependencyTransclusionBulletDetails(text);
  if (dependencyBullet && dependencyBullet.terminal) {
    return [];
  }
  const targets = [];
  let index = 0;

  while (index < text.length) {
    const target = parseTransclusionToggleTargetAt(text, index);
    if (target) {
      targets.push(target);
      index = target.endIndex;
      continue;
    }

    const bracketEndIndex = findNonWikiBracketGroupEnd(text, index);
    if (bracketEndIndex !== -1) {
      index = bracketEndIndex + 1;
      continue;
    }

    index += 1;
  }

  return targets;
}

function parseTransclusionToggleTargetAt(line, index) {
  if (line.startsWith("![[", index)) {
    const wikiLink = parseTransclusionWikiLinkAt(line, index + 1);
    return wikiLink
      ? {
          kind: "wiki",
          transcluded: true,
          markerIndex: index,
          startIndex: index + 1,
          endIndex: wikiLink.endIndex,
        }
      : null;
  }

  if (line.startsWith("[[", index) && line[index - 1] !== "!") {
    const wikiLink = parseTransclusionWikiLinkAt(line, index);
    return wikiLink
      ? {
          kind: "wiki",
          transcluded: false,
          markerIndex: index,
          startIndex: index,
          endIndex: wikiLink.endIndex,
        }
      : null;
  }

  if (
    line.startsWith("![", index) &&
    line[index + 2] !== "[" &&
    line[index - 1] !== "["
  ) {
    const markdownLink = parseTransclusionMarkdownLinkAt(line, index + 1);
    return markdownLink
      ? {
          kind: "markdown",
          transcluded: true,
          markerIndex: index,
          startIndex: index + 1,
          endIndex: markdownLink.endIndex,
        }
      : null;
  }

  if (
    line[index] === "[" &&
    line[index + 1] !== "[" &&
    line[index - 1] !== "!" &&
    line[index - 1] !== "["
  ) {
    const markdownLink = parseTransclusionMarkdownLinkAt(line, index);
    return markdownLink
      ? {
          kind: "markdown",
          transcluded: false,
          markerIndex: index,
          startIndex: index,
          endIndex: markdownLink.endIndex,
        }
      : null;
  }

  return null;
}

function parseTransclusionWikiLinkAt(line, startIndex) {
  if (!line.startsWith("[[", startIndex)) {
    return null;
  }

  const endIndex = line.indexOf("]]", startIndex + 2);
  if (endIndex === -1) {
    return null;
  }

  const content = line.slice(startIndex + 2, endIndex);
  const aliasIndex = content.indexOf("|");
  const target =
    aliasIndex === -1 ? content.trim() : content.slice(0, aliasIndex).trim();

  return target ? { endIndex: endIndex + 2 } : null;
}

function parseTransclusionMarkdownLinkAt(line, startIndex) {
  if (line[startIndex] !== "[" || line[startIndex + 1] === "[") {
    return null;
  }

  const textEndIndex = findClosingMarkdownLabelBracket(line, startIndex);
  if (textEndIndex === -1 || line[textEndIndex + 1] !== "(") {
    return null;
  }

  const destinationStartIndex = textEndIndex + 2;
  const destinationEndIndex = findClosingMarkdownDestinationParen(
    line,
    destinationStartIndex,
  );
  if (destinationEndIndex === -1) {
    return null;
  }

  const destination = line.slice(destinationStartIndex, destinationEndIndex);
  if (!hasMarkdownDestination(destination)) {
    return null;
  }

  return { endIndex: destinationEndIndex + 1 };
}

function findNonWikiBracketGroupEnd(line, index) {
  if (
    line[index] !== "[" ||
    line[index + 1] === "[" ||
    line[index - 1] === "!" ||
    line[index - 1] === "["
  ) {
    return -1;
  }

  return findClosingMarkdownLabelBracket(line, index);
}

function findClosingMarkdownLabelBracket(line, startIndex) {
  let depth = 1;

  for (let index = startIndex + 1; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }

    if (line[index] === "[") {
      depth += 1;
      continue;
    }

    if (line[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findClosingMarkdownDestinationParen(line, startIndex) {
  let depth = 1;
  let inAngleDestination = false;

  for (let index = startIndex; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }

    if (inAngleDestination) {
      if (line[index] === ">") {
        inAngleDestination = false;
      }
      continue;
    }

    if (line[index] === "<") {
      inAngleDestination = true;
      continue;
    }

    if (line[index] === "(") {
      depth += 1;
      continue;
    }

    if (line[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function hasMarkdownDestination(destination) {
  const text = String(destination || "").trim();
  if (!text) {
    return false;
  }

  if (text.startsWith("<")) {
    const endIndex = text.indexOf(">");
    return endIndex > 1;
  }

  return true;
}

function toggleLineTransclusions(line) {
  const text = String(line || "");
  const targets = findTransclusionToggleTargets(text);
  if (targets.length === 0) {
    return {
      line: text,
      targets,
      changes: [],
      found: false,
      changed: false,
    };
  }

  const removeMarkers = targets.every((target) => target.transcluded);
  const changes = targets
    .filter((target) => removeMarkers || !target.transcluded)
    .map((target) => ({
      index: target.markerIndex,
      deleteCount: removeMarkers ? 1 : 0,
      insertText: removeMarkers ? "" : "!",
      delta: removeMarkers ? -1 : 1,
    }));

  return {
    line: applyTransclusionChanges(text, changes),
    targets,
    changes,
    found: true,
    changed: changes.length > 0,
  };
}

function getTransclusionToggleChanges(targets, removeMarkers) {
  return (Array.isArray(targets) ? targets : [])
    .filter((target) => removeMarkers || !target.transcluded)
    .map((target) => ({
      index: target.markerIndex,
      deleteCount: removeMarkers ? 1 : 0,
      insertText: removeMarkers ? "" : "!",
      delta: removeMarkers ? -1 : 1,
    }));
}

function toggleLineRangeTransclusions(lines, startLine, endLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const firstLine = Math.max(
    0,
    Math.floor(numericOrDefault(startLine, 0)),
  );
  const lastLine = Math.min(
    Math.max(firstLine, Math.floor(numericOrDefault(endLine, firstLine))),
    Math.max(sourceLines.length - 1, 0),
  );
  const lineTargets = [];

  for (let line = firstLine; line <= lastLine; line += 1) {
    const lineText = String(sourceLines[line] || "");
    const targets = findTransclusionToggleTargets(lineText);
    if (targets.length > 0) {
      lineTargets.push({ line, lineText, targets });
    }
  }

  if (lineTargets.length === 0) {
    return {
      found: false,
      changed: false,
      removeMarkers: false,
      lineTargets,
      changesByLine: [],
    };
  }

  const changesByLine = lineTargets
    .map((entry) => {
      const removeMarkers = entry.targets.every((target) => target.transcluded);
      const changes = getTransclusionToggleChanges(entry.targets, removeMarkers);
      return {
        ...entry,
        changes,
        nextLineText:
          changes.length > 0
            ? applyTransclusionChanges(entry.lineText, changes)
            : entry.lineText,
      };
    })
    .filter((entry) => entry.changes.length > 0);

  return {
    found: true,
    changed: changesByLine.length > 0,
    removeMarkers: null,
    lineTargets,
    changesByLine,
  };
}


function findTaskLineByBlockId(lines, blockId) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const content = sourceLines.join("\n");
  const id = normalizeBulletPropertyValue(blockId);
  if (!id) {
    return null;
  }
  for (let line = 0; line < sourceLines.length; line += 1) {
    const text = String(sourceLines[line] || "");
    if (
      isObsidianTaskAtLine(content, line) &&
      getTrailingBlockId(text) === id
    ) {
      return line;
    }
  }
  return null;
}




function applyTransclusionChanges(line, changes) {
  return changes
    .slice()
    .sort((first, second) => second.index - first.index)
    .reduce(
      (nextLine, change) =>
        nextLine.slice(0, change.index) +
        change.insertText +
        nextLine.slice(change.index + change.deleteCount),
      line,
    );
}

function adjustCursorChForTransclusionChanges(cursorCh, changes, newLineLength) {
  const originalCh = Math.max(
    Math.floor(numericOrDefault(cursorCh, 0)),
    0,
  );
  const adjustedCh = changes.reduce((ch, change) => {
    if (change.delta > 0 && change.index <= originalCh) {
      return ch + change.delta;
    }

    if (change.delta < 0 && change.index < originalCh) {
      return ch + change.delta;
    }

    return ch;
  }, originalCh);

  return Math.min(Math.max(adjustedCh, 0), Math.max(newLineLength, 0));
}

// Footer keyboard hints. Each entry pairs styled keycaps with a short label.
const KEYBOARD_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Open" },
  { keys: ["esc"], label: "Dismiss" },
];

const POMODORO_ENTRY_MOVE_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["^X"], label: "Merge" },
  { keys: ["↵"], label: "Move/rename" },
  { keys: ["esc"], label: "Dismiss" },
];

const BULLET_PROPERTY_STAGE_TWO_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Set" },
  { keys: ["esc"], label: "Dismiss" },
];

function getBulletPropertyStageTwoHints(hasPriorityRoll, rollPreview, options = {}) {
  const hints = !hasPriorityRoll
    ? [...BULLET_PROPERTY_STAGE_TWO_HINTS]
    : [
        ...BULLET_PROPERTY_STAGE_TWO_HINTS.slice(0, -1),
        { keys: ["^R"], label: "Re-roll" },
        BULLET_PROPERTY_STAGE_TWO_HINTS[
          BULLET_PROPERTY_STAGE_TWO_HINTS.length - 1
        ],
      ];
  if (rollPreview && rollPreview.footerLabel) {
    hints.splice(hints.length - 1, 0, {
      keys: ["^↵"],
      label: rollPreview.footerLabel,
    });
  }
  if (options && options.skipReason === true) {
    hints.splice(hints.length - 1, 0, {
      keys: ["⇧↵"],
      label: "Skip reason",
    });
  }
  return hints;
}

// Ctrl+Enter (or Cmd+Enter on macOS) takes the recommended roll. Alt and
// Shift variants are never a recommended roll.
function isRecommendedRollKeydown(event) {
  if (
    !event ||
    typeof event.key !== "string" ||
    event.key !== "Enter" ||
    event.altKey === true ||
    event.shiftKey === true
  ) {
    return false;
  }
  return event.ctrlKey === true || event.metaKey === true;
}

// The task's current level label for a recommendation: the roll/cancel level,
// or the decay's from level.
function getPriorityRollCurrentLabel(recommendation) {
  if (!recommendation) {
    return "";
  }
  if (recommendation.kind === "decay") {
    return normalizeBulletPropertyValue(
      recommendation.fromLevel && recommendation.fromLevel.label,
    );
  }
  return normalizeBulletPropertyValue(
    recommendation.level && recommendation.level.label,
  );
}

// A stage-two pinned `🎲 <level> roll` row built from an already-rolled
// recommendation date, so Ctrl+Enter and Enter on the pinned row write the
// identical date (one shared roll).
function createPriorityRollDateItemFromRecommendation(
  recommendation,
  currentValue,
) {
  if (
    !recommendation ||
    recommendation.kind !== "roll" ||
    !recommendation.level ||
    !recommendation.level.label
  ) {
    return null;
  }
  const value = normalizeBulletPropertyValue(recommendation.date);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const level = recommendation.level;
  const weekday = getBulletPropertyDateWeekday(date);
  return {
    kind: "value",
    value,
    label: `${level.label} roll`,
    detail: `${value} · ${weekday} · ${formatPriorityRollWindowText(level)}`,
    current: value === currentValue,
    dynamic: false,
    priorityRoll: true,
    level,
    rolledDays: recommendation.offset,
    searchText: `${level.label} roll ${value} ${weekday} random priority`,
  };
}

// Whether a recomputed recommendation still targets what the preview showed:
// the same kind, the same from or to level, and the same target line. The
// previewed date itself is allowed to differ (a re-roll), because the write
// reuses the previewed date, never the recomputed one. `unavailable` never
// writes, so it never matches.
