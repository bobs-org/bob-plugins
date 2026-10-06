function planTaskCancelBatch(content, session, details = {}) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const targets =
    session && Array.isArray(session.targets) ? session.targets : [];

  const invalid = (error, extra = {}) =>
    Object.freeze({
      valid: false,
      error,
      recurring: Boolean(extra.recurring),
      stale: Boolean(extra.stale),
      content: text,
      cancelledCount: 0,
      skippedClosedCount: 0,
      loggedCount: 0,
      createdLogCount: 0,
      fallbackLoggedCount: 0,
      cancelled: Object.freeze([]),
      cursorLineShift: (line) => line,
    });

  if (!session || session.valid === false || targets.length === 0) {
    return invalid("Counted task session is unavailable");
  }

  for (const target of targets) {
    const liveLine =
      Number.isInteger(target.line) &&
      target.line >= 0 &&
      target.line < source.lines.length
        ? source.lines[target.line]
        : undefined;
    if (
      liveLine !== target.rawLine ||
      !isObsidianTaskAtLine(text, target.line, contexts, source.lines)
    ) {
      return invalid("A counted task changed while the picker was open", {
        stale: true,
      });
    }
  }

  const dateText = normalizeBulletPropertyValue(details.date);
  if (!dateText) {
    return invalid("Cancel date is required");
  }
  const reasonInput = String(details.reason ?? "");
  const fallbackInput = String(details.fallbackReason ?? "");
  const reasonByLine =
    details.reasonByLine instanceof Map ? details.reasonByLine : null;

  let skippedClosedCount = 0;
  const openTargets = [];
  for (const target of targets) {
    const status = getObsidianTaskCheckboxStatus(target.rawLine || "");
    if (
      !isObsidianTaskLine(target.rawLine || "") ||
      !OPEN_OBSIDIAN_TASK_STATUSES.has(status)
    ) {
      skippedClosedCount += 1;
      continue;
    }
    openTargets.push(target);
  }

  if (openTargets.length === 0) {
    const finalOriginsEmpty = source.lines.map((_, index) => index);
    return Object.freeze({
      valid: true,
      error: null,
      recurring: false,
      stale: false,
      content: text,
      cancelledCount: 0,
      skippedClosedCount,
      loggedCount: 0,
      createdLogCount: 0,
      fallbackLoggedCount: 0,
      cancelled: Object.freeze([]),
      cursorLineShift: (line) => {
        const numeric = Math.floor(numericOrDefault(line, NaN));
        if (!Number.isFinite(numeric)) {
          return line;
        }
        const found = finalOriginsEmpty.indexOf(numeric);
        return found === -1 ? line : found;
      },
    });
  }

  for (const target of openTargets) {
    if (isRecurringTaskLine(target.rawLine || "")) {
      return invalid(
        "Recurring tasks are cancelled with Obsidian Tasks so the next occurrence is handled; no tasks were updated",
        { recurring: true },
      );
    }
  }

  const workingLines = source.lines.slice();
  const lineOrigins = source.lines.map((_, index) => index);
  let loggedCount = 0;
  let createdLogCount = 0;
  let fallbackLoggedCount = 0;
  const cancelled = [];

  const ordered = openTargets.slice().sort((a, b) => b.line - a.line);
  for (const target of ordered) {
    const oldLine = String(workingLines[target.line] || "");
    const status = getObsidianTaskCheckboxStatus(oldLine);
    const fromStatus = getTaskCancelStatusLabel(status);
    const blockId = getTrailingBlockId(oldLine);
    const idField = findBulletPropertyField(oldLine, "id");
    const normalizedId = idField
      ? normalizeBulletPropertyValue(idField.value)
      : "";
    const taskId = normalizedId || blockId || null;

    const replaced = replaceObsidianTaskCheckboxStatus(oldLine, "-");
    const upserted = upsertBulletProperty(replaced, "cancelled", dateText);
    const nextTaskLine = upserted.line;
    workingLines[target.line] = nextTaskLine;

    const targetReason =
      reasonByLine && reasonByLine.has(target.line)
        ? String(reasonByLine.get(target.line) ?? "")
        : reasonInput;
    const plan = planCancelLogEntry(
      workingLines.join(source.lineEnding),
      target.line,
      { date: dateText, reason: targetReason, fallbackReason: fallbackInput },
    );
    let logApplied = false;
    if (plan.valid && plan.changed) {
      const insertAt = Math.floor(numericOrDefault(plan.insertLine, NaN));
      if (Number.isFinite(insertAt) && insertAt >= 0) {
        const insertTexts = Array.isArray(plan.lineTexts)
          ? plan.lineTexts.slice()
          : [];
        workingLines.splice(insertAt, 0, ...insertTexts);
        lineOrigins.splice(
          insertAt,
          0,
          ...insertTexts.map(() => null),
        );
        logApplied = true;
        loggedCount += 1;
        if (plan.createdParent) {
          createdLogCount += 1;
        }
        if (plan.usedFallback) {
          fallbackLoggedCount += 1;
        }
      }
    } else if (
      !plan.valid &&
      plan.reason !== "empty-reason" &&
      plan.reason !== "no-cancel-log"
    ) {
      // Any other guard (out-of-range, non-bullet) cannot happen after the
      // staleness check above; treat it as a batch failure rather than a
      // silent skip so callers never report success on a half-written task.
      return invalid(plan.reason || "Cancel log could not be planned");
    }

    cancelled.push(
      Object.freeze({
        originalLine: target.line,
        blockId,
        taskId,
        fromStatus,
        logged: logApplied,
      }),
    );
  }

  cancelled.sort((a, b) => a.originalLine - b.originalLine);
  const finalOrigins = lineOrigins.slice();
  const cursorLineShift = (line) => {
    const numeric = Math.floor(numericOrDefault(line, NaN));
    if (!Number.isFinite(numeric)) {
      return line;
    }
    const found = finalOrigins.indexOf(numeric);
    return found === -1 ? line : found;
  };

  return Object.freeze({
    valid: true,
    error: null,
    recurring: false,
    stale: false,
    content: workingLines.join(source.lineEnding),
    cancelledCount: openTargets.length,
    skippedClosedCount,
    loggedCount,
    createdLogCount,
    fallbackLoggedCount,
    cancelled: Object.freeze(cancelled),
    cursorLineShift,
  });
}

// A task move uses the same count convention as counted property editing, but
// project lifecycle tasks are structural controls and therefore never become
// move targets. The first line must itself be movable; later ^prj tasks are
// skipped without consuming the requested count.
function discoverMovableObsidianTaskTargets(
  content,
  startLine,
  additionalTaskCount,
) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const line = Math.floor(numericOrDefault(startLine, Number.NaN));
  const additional = Math.max(
    0,
    Math.floor(numericOrDefault(additionalTaskCount, 0)),
  );
  const requestedCount = additional + 1;
  const contexts = getMarkdownLineContexts(text);
  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      explicit: additional > 0,
      startLine: Number.isFinite(line) ? line : null,
      requestedAdditionalCount: additional,
      requestedCount,
      actualCount: 0,
      clamped: false,
      targets: Object.freeze([]),
    });

  if (
    !Number.isFinite(line) ||
    !isObsidianTaskAtLine(text, line, contexts, source.lines)
  ) {
    return invalid("Move tasks must start on a real #task checkbox");
  }
  if (isProjectLifecycleTaskLine(source.lines[line])) {
    return invalid("Project lifecycle tasks cannot be moved");
  }

  const targets = [];
  for (
    let lineIndex = line;
    lineIndex < source.lines.length && targets.length < requestedCount;
    lineIndex += 1
  ) {
    if (
      isObsidianTaskAtLine(text, lineIndex, contexts, source.lines) &&
      !isProjectLifecycleTaskLine(source.lines[lineIndex])
    ) {
      targets.push(
        Object.freeze({
          line: lineIndex,
          rawLine: String(source.lines[lineIndex] || ""),
        }),
      );
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    explicit: additional > 0,
    startLine: line,
    requestedAdditionalCount: additional,
    requestedCount,
    actualCount: targets.length,
    clamped: targets.length < requestedCount,
    targets: Object.freeze(targets),
  });
}

function getTaskMoveColumn(text) {
  let column = 0;
  for (const character of String(text || "")) {
    column += character === "\t" ? 4 : 1;
  }
  return column;
}

// Return the Markdown container prefix before a line's content. The prefix may
// contain indentation and one or more blockquote markers. Keeping both its raw
// text and display column lets subtree detection handle nested/quoted tasks
// while still rebasing the captured block losslessly in the common case.
function parseTaskMoveContainerPrefix(lineText) {
  const text = String(lineText || "");
  let index = 0;
  let quoteDepth = 0;
  let initialIndentEnd = 0;
  let sawQuote = false;

  while (index < text.length) {
    const whitespaceStart = index;
    while (index < text.length && (text[index] === " " || text[index] === "\t")) {
      index += 1;
    }
    if (!sawQuote) {
      initialIndentEnd = index;
    }
    if (text[index] !== ">") {
      break;
    }
    sawQuote = true;
    quoteDepth += 1;
    index += 1;
    if (text[index] === " " || text[index] === "\t") {
      index += 1;
    }
    if (index === whitespaceStart) {
      break;
    }
  }

  const prefix = text.slice(0, index);
  const initialIndent = text.slice(0, initialIndentEnd);
  return Object.freeze({
    prefix,
    length: prefix.length,
    column: getTaskMoveColumn(prefix),
    quoteDepth,
    initialIndentColumn: getTaskMoveColumn(initialIndent),
  });
}

function parseTaskMoveListItem(lineText) {
  const text = String(lineText || "");
  const container = parseTaskMoveContainerPrefix(text);
  const remainder = text.slice(container.length);
  const markerMatch = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(remainder);
  if (!markerMatch) {
    return null;
  }
  return Object.freeze({
    ...container,
    markerIndex: container.length,
    markerText: markerMatch[0],
    contentColumn: container.column + getTaskMoveColumn(markerMatch[0]),
  });
}

function isTaskMoveBlankLine(lineText) {
  return /^[\s>]*$/.test(String(lineText || ""));
}

function taskMoveLineIsDescendant(root, lineText) {
  const text = String(lineText || "");
  if (!root || isTaskMoveBlankLine(text)) {
    return false;
  }
  const candidate = parseTaskMoveContainerPrefix(text);
  if (candidate.quoteDepth < root.quoteDepth) {
    return false;
  }
  // A top-level blockquote immediately following an unquoted task is a sibling
  // block, not task content. An indented blockquote can still be a child.
  if (
    root.quoteDepth === 0 &&
    candidate.quoteDepth > 0 &&
    candidate.initialIndentColumn <= root.initialIndentColumn
  ) {
    return false;
  }
  return candidate.column >= root.contentColumn;
}

function captureTaskMoveSubtree(content, target) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const line = target && Number.isInteger(target.line) ? target.line : -1;
  const contexts = getMarkdownLineContexts(text);
  if (
    line < 0 ||
    line >= source.lines.length ||
    source.lines[line] !== target.rawLine ||
    !isObsidianTaskAtLine(text, line, contexts, source.lines) ||
    isProjectLifecycleTaskLine(source.lines[line])
  ) {
    return Object.freeze({
      valid: false,
      error: "A selected task changed before it could be moved",
    });
  }

  const root = parseTaskMoveListItem(source.lines[line]);
  if (!root) {
    return Object.freeze({ valid: false, error: "Selected task is not a list item" });
  }

  let endLineExclusive = line + 1;
  let pendingBlankEnd = endLineExclusive;
  for (let index = line + 1; index < source.lines.length; index += 1) {
    const candidate = String(source.lines[index] || "");
    if (isTaskMoveBlankLine(candidate)) {
      pendingBlankEnd = index + 1;
      continue;
    }
    if (!taskMoveLineIsDescendant(root, candidate)) {
      break;
    }
    endLineExclusive = index + 1;
    pendingBlankEnd = endLineExclusive;
  }

  // Blank lines are retained only when followed by deeper content. Trailing
  // separators stay with the source/destination section rather than the task.
  const blockLines = source.lines.slice(line, endLineExclusive);
  return Object.freeze({
    valid: true,
    error: null,
    startLine: line,
    endLineExclusive,
    lines: Object.freeze(blockLines),
    root,
    pendingBlankEnd,
    selectedTargetLines: Object.freeze([line]),
  });
}

function buildTaskMoveRanges(content, targets) {
  const captured = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const block = captureTaskMoveSubtree(content, target);
    if (!block.valid) {
      return Object.freeze({ valid: false, error: block.error, ranges: [] });
    }
    captured.push(block);
  }
  captured.sort((left, right) => left.startLine - right.startLine);

  const ranges = [];
  for (const block of captured) {
    const previous = ranges[ranges.length - 1];
    if (previous && block.startLine < previous.endLineExclusive) {
      previous.selectedTargetLines.push(block.startLine);
      continue;
    }
    ranges.push({
      startLine: block.startLine,
      endLineExclusive: block.endLineExclusive,
      lines: [...block.lines],
      root: block.root,
      selectedTargetLines: [...block.selectedTargetLines],
    });
  }

  return Object.freeze({
    valid: ranges.length > 0,
    error: ranges.length > 0 ? null : "No movable tasks were selected",
    ranges: Object.freeze(
      ranges.map((range) =>
        Object.freeze({
          ...range,
          lines: Object.freeze(range.lines),
          selectedTargetLines: Object.freeze(range.selectedTargetLines),
        }),
      ),
    ),
  });
}

function removeTaskMoveRanges(content, ranges) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const nextLines = source.lines.slice();
  const ordered = (Array.isArray(ranges) ? ranges : [])
    .slice()
    .sort((left, right) => right.startLine - left.startLine);
  if (ordered.length === 0) {
    return Object.freeze({
      valid: false,
      error: "No task ranges are available",
      content: text,
      nextLine: 0,
    });
  }

  for (const range of ordered) {
    const expected = Array.isArray(range.lines) ? range.lines : [];
    const live = nextLines.slice(range.startLine, range.endLineExclusive);
    if (
      live.length !== expected.length ||
      live.some((line, index) => line !== expected[index])
    ) {
      return Object.freeze({
        valid: false,
        error: "A selected task subtree changed before it could be moved",
        content: text,
        nextLine: range.startLine,
      });
    }

    let deleteCount = range.endLineExclusive - range.startLine;
    const before = nextLines[range.startLine - 1];
    const after = nextLines[range.endLineExclusive];
    if (
      before !== undefined &&
      after !== undefined &&
      String(before).trim() === "" &&
      String(after).trim() === ""
    ) {
      // Avoid leaving a doubled seam while preserving one existing separator.
      deleteCount += 1;
    }
    nextLines.splice(range.startLine, deleteCount);
  }

  const firstStart = Math.min(...ordered.map((range) => range.startLine));
  return Object.freeze({
    valid: true,
    error: null,
    content: nextLines.join(source.lineEnding),
    nextLine: Math.min(firstStart, Math.max(nextLines.length - 1, 0)),
  });
}

function rebaseTaskMoveBlock(range) {
  const lines = range && Array.isArray(range.lines) ? range.lines : [];
  const root = range && range.root;
  if (!root || lines.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(
    lines.map((line, index) => {
      const text = String(line || "");
      if (isTaskMoveBlankLine(text)) {
        return "";
      }
      if (index === 0) {
        return text.slice(root.markerIndex);
      }
      if (root.prefix && text.startsWith(root.prefix)) {
        return text.slice(root.prefix.length);
      }
      // Mixed tabs/spaces or quote spacing can make the raw prefix differ.
      // Remove no more than the root's structural display width.
      let column = 0;
      let offset = 0;
      while (offset < text.length && column < root.column) {
        column += text[offset] === "\t" ? 4 : 1;
        offset += 1;
      }
      return text.slice(offset);
    }),
  );
}

function flattenTaskMoveBlocks(blocks) {
  const lines = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const blockLines = Array.isArray(block) ? block.map(String) : [];
    if (blockLines.length === 0) {
      continue;
    }
    lines.push(...blockLines);
  }
  return lines;
}

function parseTaskMoveDestinationFrontmatter(content, options = {}) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  if (!startsWithFrontmatter(source.lines)) {
    return Object.freeze({ valid: false, error: "Destination has no YAML frontmatter" });
  }
  let closingLine = -1;
  for (let index = 1; index < source.lines.length; index += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(source.lines[index])) {
      closingLine = index;
      break;
    }
  }
  if (closingLine === -1) {
    return Object.freeze({ valid: false, error: "Destination frontmatter is not closed" });
  }

  let data;
  try {
    const yamlParser = options.parseYaml || parseYaml;
    data = yamlParser(source.lines.slice(1, closingLine).join("\n"));
  } catch (error) {
    return Object.freeze({ valid: false, error: "Destination frontmatter is malformed" });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return Object.freeze({ valid: false, error: "Destination frontmatter must be a mapping" });
  }

  const noteInfo = getChildNoteInfo(data, options.now || new Date());
  if (noteInfo.kind === "area") {
    return Object.freeze({
      valid: true,
      error: null,
      kind: "area",
      statusKey: "",
      data,
      noteInfo,
    });
  }
  if (
    noteInfo.kind === "project" &&
    TASK_MOVE_OPEN_PROJECT_STATUSES.has(noteInfo.statusKey)
  ) {
    return Object.freeze({
      valid: true,
      error: null,
      kind: "project",
      statusKey: noteInfo.statusKey,
      data,
      noteInfo,
    });
  }

  const error =
    noteInfo.kind === "project"
      ? "Destination project is no longer open"
      : "Destination is no longer an area or open project";
  return Object.freeze({ valid: false, error, kind: noteInfo.kind, data, noteInfo });
}

function collectTaskMoveDestinations(files, sourcePath, getNoteInfo) {
  const source = normalizeVaultRelativePath(sourcePath);
  const infoFor =
    typeof getNoteInfo === "function"
      ? getNoteInfo
      : () => getChildNoteInfo(null);
  return (Array.isArray(files) ? files : [])
    .filter((file) => {
      const path = normalizeVaultRelativePath(file && file.path);
      return (
        path &&
        MARKDOWN_EXTENSION_RE.test(path) &&
        path !== source &&
        !TASK_MOVE_TEMPLATE_PATHS.has(path)
      );
    })
    .map((file) => ({ file, noteInfo: infoFor(file) }))
    .filter(
      ({ noteInfo }) =>
        noteInfo &&
        (noteInfo.kind === "area" ||
          (noteInfo.kind === "project" &&
            TASK_MOVE_OPEN_PROJECT_STATUSES.has(noteInfo.statusKey))),
    )
    .sort((left, right) => {
      const leftPath = String(left.file.path || "");
      const rightPath = String(right.file.path || "");
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    })
    .map((entry) => Object.freeze(entry));
}

function getTaskMoveSectionEnd(lines, headerIndex) {
  let inFence = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
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
    if (SECTION_HEADER_RE.test(line)) {
      return index;
    }
  }
  return lines.length;
}

function insertTaskMoveBlocks(content, blocks, destinationKind) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const movedLines = flattenTaskMoveBlocks(blocks);
  if (movedLines.length === 0) {
    return Object.freeze({ valid: false, error: "No task content is available", content: text });
  }

  let headerIndex = findProjectTasksHeaderIndex(source.lines);
  if (headerIndex === -1) {
    if (destinationKind !== "area") {
      return Object.freeze({
        valid: false,
        error: "Open project destination has no valid ## Tasks section",
        content: text,
      });
    }
    const hadTerminalNewline = /\r?\n$/.test(text);
    let next = text;
    if (next && !next.endsWith(source.lineEnding)) {
      next += source.lineEnding;
    }
    if (next && !next.endsWith(source.lineEnding + source.lineEnding)) {
      next += source.lineEnding;
    }
    next += `${PROJECT_TASKS_HEADER}${source.lineEnding}${source.lineEnding}`;
    const insertedLine = next.split(source.lineEnding).length - 1;
    next += movedLines.join(source.lineEnding);
    if (hadTerminalNewline) {
      next += source.lineEnding;
    }
    return Object.freeze({ valid: true, error: null, content: next, createdSection: true, insertedLine });
  }

  const sectionEnd = getTaskMoveSectionEnd(source.lines, headerIndex);
  const nonblankBody = [];
  for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
    if (String(source.lines[index] || "").trim() !== "") {
      nonblankBody.push(index);
    }
  }
  const placeholderIndex =
    nonblankBody.length === 1 &&
    PROJECT_SOURCE_TASK_LINE_RE.test(source.lines[nonblankBody[0]]) &&
    source.lines[nonblankBody[0]].includes(PROJECT_TASKS_PLACEHOLDER)
      ? nonblankBody[0]
      : -1;

  const lineContexts = getMarkdownLineContextsForLines(source.lines);
  const isPlaceholderLine = (lineIndex) =>
    PROJECT_SOURCE_TASK_LINE_RE.test(source.lines[lineIndex]) &&
    String(source.lines[lineIndex] || "").includes(PROJECT_TASKS_PLACEHOLDER);
  let sectionHasRealTask = false;
  for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
    if (index === placeholderIndex || isPlaceholderLine(index)) {
      continue;
    }
    if (isObsidianTaskAtLine(text, index, lineContexts, source.lines)) {
      sectionHasRealTask = true;
      break;
    }
  }

  let nextLines;
  let insertedLine;
  if (placeholderIndex !== -1) {
    const prefix = source.lines.slice(0, placeholderIndex);
    const needsSeparator =
      prefix.length > 0 &&
      String(prefix[prefix.length - 1] || "").trim() !== "";
    const separator = needsSeparator ? [""] : [];
    nextLines = prefix.concat(
      separator,
      movedLines,
      source.lines.slice(placeholderIndex + 1),
    );
    insertedLine = placeholderIndex + separator.length;
  } else {
    let insertAt = sectionEnd;
    while (
      insertAt > headerIndex + 1 &&
      String(source.lines[insertAt - 1] || "").trim() === ""
    ) {
      insertAt -= 1;
    }
    const insertion = [];
    if (!sectionHasRealTask) {
      if (insertAt === headerIndex + 1) {
        insertion.push("");
      } else if (String(source.lines[insertAt - 1] || "").trim() !== "") {
        insertion.push("");
      }
    }
    insertion.push(...movedLines);
    nextLines = source.lines
      .slice(0, insertAt)
      .concat(insertion, source.lines.slice(insertAt));
    insertedLine = insertAt + (insertion.length - movedLines.length);
  }

  return Object.freeze({
    valid: true,
    error: null,
    content: nextLines.join(source.lineEnding),
    createdSection: false,
    insertedLine,
  });
}

function collectTaskMoveBlockIds(content) {
  const text = String(content || "");
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const ids = new Set();
  for (let index = 0; index < source.lines.length; index += 1) {
    const context = contexts[index];
    if (!context || context.inFrontmatter || context.inFence) {
      continue;
    }
    const id = getTrailingBlockId(source.lines[index]);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function prepareTaskMoveBlockIdentities(blocks, sourcePath, destinationPath) {
  const nextBlocks = (Array.isArray(blocks) ? blocks : []).map((block) =>
    Array.isArray(block) ? block.map(String) : [],
  );
  const movedBlockIds = new Set();
  const idReplacements = new Map();

  for (const block of nextBlocks) {
    for (let index = 0; index < block.length; index += 1) {
      const line = block[index];
      const blockId = getTrailingBlockId(line);
      if (!blockId) {
        continue;
      }
      if (movedBlockIds.has(blockId)) {
        return Object.freeze({ valid: false, error: `Moved task block ID is duplicated: ${blockId}` });
      }
      movedBlockIds.add(blockId);

      if (!isObsidianTaskLine(line)) {
        continue;
      }
      const oldCanonicalId = tryDependencyId(sourcePath, blockId);
      const newCanonicalId = tryDependencyId(destinationPath, blockId);
      if (!oldCanonicalId || !newCanonicalId) {
        return Object.freeze({
          valid: false,
          error: `Task block ID cannot be encoded for the move: ${blockId}`,
        });
      }
      const idFields = parseBulletPropertyFields(line).filter(
        (field) => field.key === "id",
      );
      if (idFields.length > 1) {
        return Object.freeze({
          valid: false,
          error: `Task has multiple [id::] fields: ${blockId}`,
        });
      }
      if (idFields.length === 1) {
        const existingId = normalizeBulletPropertyValue(idFields[0].value);
        if (existingId !== oldCanonicalId && existingId !== blockId) {
          return Object.freeze({
            valid: false,
            error: `Task has an ambiguous [id::] value: ${blockId}`,
          });
        }
        if (existingId) {
          idReplacements.set(existingId, newCanonicalId);
        }
      }
      idReplacements.set(oldCanonicalId, newCanonicalId);
      block[index] = upsertBulletProperty(line, "id", newCanonicalId).line;
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    blocks: Object.freeze(nextBlocks.map((block) => Object.freeze(block))),
    movedBlockIds,
    idReplacements,
  });
}

function taskMoveLinkNoteMatchesPath(note, filePath) {
  const target = normalizeVaultRelativePath(note).replace(MARKDOWN_EXTENSION_RE, "");
  const path = normalizeVaultRelativePath(filePath).replace(MARKDOWN_EXTENSION_RE, "");
  if (!target || !path) {
    return false;
  }
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return target === path || target === basename;
}

