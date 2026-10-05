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
// the Pomodoros section, else the canonical tab fallback. Mirrors
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

  return CANONICAL_CHILD_INDENT_UNIT;
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
    // The ownership range extends through trailing separator blanks (and the
    // final empty split element from a terminal newline), but the new child
    // belongs immediately after the last nonblank descendant so separators
    // stay after it.
    let insertAfterLine = entryEndLine;
    while (
      insertAfterLine > entryLine &&
      !normalizeMarkdownLine(lines[insertAfterLine]).trim()
    ) {
      insertAfterLine -= 1;
    }
    const insertLine = insertAfterLine + 1;
    insertionEdits.push(
      insertionEditAtLine(
        snapshot,
        lines,
        insertLine,
        [entryLineText],
        lineEndingForInsertion(snapshot, lines, insertAfterLine),
      ),
    );
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
//   - the resulting checkbox status: with `forceNext`, only Ready/Blocked
//     become Next while Next and In Progress stay unchanged (linking never
//     lowers a lane); with plain `activationEligible`, only Ready/Blocked
//     are promoted to Next, and only when a future schedule was actually
//     removed for Blocked (the `^^` task-picker's original, more
//     conservative mode);
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
    // Linking never lowers a lane: only Ready and Blocked rise to Next.
    if (currentStatus === " " || currentStatus === BLOCKED_OBSIDIAN_TASK_STATUS) {
      newStatus = "*";
    }
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

  // Freshness is the last transformation of the task line, and only when
  // the gesture already rewrote the line (matching `bob capture`). The
  // stamper itself refuses closed and recurring lines, so those never
  // stamp. Pure planners take the stamper as an injected option.
  const lineRewritten = removedFutureSchedule || statusChanged || Boolean(newBlockId);
  let freshnessChanged = false;
  if (lineRewritten && typeof options.stampLine === "function") {
    const stamped = applyFreshStampLine(
      updatedLineText,
      options.stampLine,
      options.freshDateText,
    );
    freshnessChanged = stamped !== updatedLineText;
    updatedLineText = stamped;
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
    freshnessChanged,
    hasChanges: removedFutureSchedule || statusChanged || logEntryAdded || Boolean(newBlockId) || freshnessChanged,
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

