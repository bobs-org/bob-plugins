function rewriteTaskMoveBlockLinks(content, options = {}) {
  const text = String(content || "");
  const sourcePath = normalizeVaultRelativePath(options.sourcePath);
  const destinationPath = normalizeVaultRelativePath(options.destinationPath);
  const currentPath = normalizeVaultRelativePath(options.currentPath);
  const role = String(options.role || "external");
  const movedBlockIds =
    options.movedBlockIds instanceof Set
      ? options.movedBlockIds
      : new Set(options.movedBlockIds || []);
  const sourceBlockIds =
    options.sourceBlockIds instanceof Set
      ? options.sourceBlockIds
      : new Set(options.sourceBlockIds || []);
  const sourceNote = sourcePath.replace(MARKDOWN_EXTENSION_RE, "");
  const destinationNote = destinationPath.replace(MARKDOWN_EXTENSION_RE, "");

  const nextNote = (note, blockId, markdown) => {
    const pathless = !String(note || "").trim();
    if (role === "moved" && pathless) {
      if (movedBlockIds.has(blockId)) {
        return note;
      }
      if (sourceBlockIds.has(blockId)) {
        return markdown ? sourcePath : sourceNote;
      }
      return note;
    }

    const targetsSource = pathless
      ? currentPath === sourcePath
      : taskMoveLinkNoteMatchesPath(note, sourcePath);
    if (targetsSource && movedBlockIds.has(blockId)) {
      return markdown ? destinationPath : destinationNote;
    }
    return note;
  };

  const rewriteLine = (line) => {
    let nextLine = String(line || "").replace(
      /(!?)\[\[([^\]\n|#]*?)#\^([A-Za-z0-9-]+)(\|[^\]\n]*)?\]\]/g,
      (match, embed, note, blockId, alias = "") => {
        const replacementNote = nextNote(note, blockId, false);
        return replacementNote === note
          ? match
          : `${embed}[[${replacementNote}#^${blockId}${alias || ""}]]`;
      },
    );
    nextLine = nextLine.replace(
      /(!?\[[^\]\n]*(?:\\.[^\]\n]*)*\]\()([^\s)#]*?)#\^([A-Za-z0-9-]+)([^)]*)\)/g,
      (match, prefix, note, blockId, suffix = "") => {
        const replacementNote = nextNote(note, blockId, true);
        return replacementNote === note
          ? match
          : `${prefix}${replacementNote}#^${blockId}${suffix || ""})`;
      },
    );
    return nextLine;
  };
  const source = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const next = source.lines
    .map((line, index) =>
      contexts[index] && contexts[index].inFence ? line : rewriteLine(line),
    )
    .join(source.lineEnding);
  return Object.freeze({ content: next, changed: next !== text });
}

function rewriteTaskMoveReferences(content, options = {}) {
  const text = String(content || "");
  const dependencyRewrite = rewriteDependsOnIdsInContent(
    text,
    options.idReplacements || new Map(),
  );
  return rewriteTaskMoveBlockLinks(dependencyRewrite.content, options);
}

function planTaskMoveAcrossFiles(options = {}) {
  const sourcePath = normalizeVaultRelativePath(options.sourcePath);
  const destinationPath = normalizeVaultRelativePath(options.destinationPath);
  const sourceContent = String(options.sourceContent || "");
  const destinationContent = String(options.destinationContent || "");
  if (!sourcePath || !destinationPath || sourcePath === destinationPath) {
    return Object.freeze({ valid: false, error: "Task move source and destination are invalid" });
  }

  const destination = parseTaskMoveDestinationFrontmatter(
    destinationContent,
    options,
  );
  if (!destination.valid) {
    return Object.freeze({ valid: false, error: destination.error });
  }
  const rangeResult = buildTaskMoveRanges(sourceContent, options.targets);
  if (!rangeResult.valid) {
    return Object.freeze({ valid: false, error: rangeResult.error });
  }
  const removal = removeTaskMoveRanges(sourceContent, rangeResult.ranges);
  if (!removal.valid) {
    return Object.freeze({ valid: false, error: removal.error });
  }

  const rebasedBlocks = rangeResult.ranges.map(rebaseTaskMoveBlock);
  const identities = prepareTaskMoveBlockIdentities(
    rebasedBlocks,
    sourcePath,
    destinationPath,
  );
  if (!identities.valid) {
    return Object.freeze({ valid: false, error: identities.error });
  }
  const destinationBlockIds = collectTaskMoveBlockIds(destinationContent);
  for (const blockId of identities.movedBlockIds) {
    if (destinationBlockIds.has(blockId)) {
      return Object.freeze({
        valid: false,
        error: `Destination already contains block ID: ${blockId}`,
      });
    }
  }

  const sourceBlockIds = collectTaskMoveBlockIds(sourceContent);
  const referenceOptions = {
    sourcePath,
    destinationPath,
    movedBlockIds: identities.movedBlockIds,
    sourceBlockIds,
    idReplacements: identities.idReplacements,
  };
  // Freshness is the last transformation of each moved open task line
  // (nav-stamps), applied at the destination. The stamper itself refuses
  // closed and recurring lines.
  const moveStamper = resolveFreshStamper(options);
  const moveFreshDateText = resolveFreshDateText(options);
  const movedBlocks = identities.blocks.map((block) => {
    const rewritten = rewriteTaskMoveReferences(block.join("\n"), {
      ...referenceOptions,
      currentPath: sourcePath,
      role: "moved",
    });
    let lines = rewritten.content.split("\n");
    if (moveStamper) {
      lines = lines.map((line) => applyFreshStampLine(line, moveStamper, moveFreshDateText));
    }
    return Object.freeze(lines);
  });
  const rewrittenSource = rewriteTaskMoveReferences(removal.content, {
    ...referenceOptions,
    currentPath: sourcePath,
    role: "source",
  }).content;
  const rewrittenDestination = rewriteTaskMoveReferences(destinationContent, {
    ...referenceOptions,
    currentPath: destinationPath,
    role: "destination",
  }).content;
  const insertion = insertTaskMoveBlocks(
    rewrittenDestination,
    movedBlocks,
    destination.kind,
  );
  if (!insertion.valid) {
    return Object.freeze({ valid: false, error: insertion.error });
  }

  const changes = new Map([
    [sourcePath, Object.freeze({ before: sourceContent, after: rewrittenSource })],
    [
      destinationPath,
      Object.freeze({ before: destinationContent, after: insertion.content }),
    ],
  ]);
  const otherContents =
    options.otherContents instanceof Map
      ? options.otherContents
      : new Map(Object.entries(options.otherContents || {}));
  for (const [path, content] of otherContents.entries()) {
    const normalizedPath = normalizeVaultRelativePath(path);
    if (!normalizedPath || normalizedPath === sourcePath || normalizedPath === destinationPath) {
      continue;
    }
    const before = String(content || "");
    const after = rewriteTaskMoveReferences(before, {
      ...referenceOptions,
      currentPath: normalizedPath,
      role: "external",
    }).content;
    if (after !== before) {
      changes.set(normalizedPath, Object.freeze({ before, after }));
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    changes,
    ranges: rangeResult.ranges,
    movedBlocks: Object.freeze(movedBlocks),
    movedBlockIds: identities.movedBlockIds,
    idReplacements: identities.idReplacements,
    nextSourceLine: removal.nextLine,
    destinationKind: destination.kind,
    destinationLine: insertion.insertedLine,
    destinationAnchorText: movedBlocks[0][0],
    destinationBlockId: getTrailingBlockId(movedBlocks[0][0]) || null,
  });
}

function resolveTaskMoveDestinationLine(content, anchor) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const anchorInfo = anchor && typeof anchor === "object" ? anchor : {};
  const anchorLine = anchorInfo.line;
  const anchorText = anchorInfo.text;
  const anchorBlockId = anchorInfo.blockId;

  if (
    Number.isInteger(anchorLine) &&
    anchorLine >= 0 &&
    anchorLine < lines.length &&
    lines[anchorLine] === anchorText
  ) {
    return Object.freeze({ line: anchorLine, source: "planned" });
  }

  if (anchorBlockId) {
    const blockIdLine = findTaskLineByBlockId(lines, anchorBlockId);
    if (blockIdLine !== null) {
      return Object.freeze({ line: blockIdLine, source: "block-id" });
    }
  }

  if (anchorText) {
    const contexts = getMarkdownLineContexts(text);
    for (let index = 0; index < lines.length; index += 1) {
      const context = contexts[index];
      if (context && (context.inFrontmatter || context.inFence)) {
        continue;
      }
      if (lines[index] === anchorText) {
        return Object.freeze({ line: index, source: "text" });
      }
    }
  }

  if (lines.length === 0) {
    return Object.freeze({ line: 0, source: "clamped" });
  }
  const clampedLine = Math.min(
    Math.max(numericOrDefault(anchorLine, 0), 0),
    lines.length - 1,
  );
  return Object.freeze({ line: clampedLine, source: "clamped" });
}

function getCountedPropertyTargetState(
  content,
  target,
  property,
  options = {},
) {
  const context = getProjectNotePropertyContext(
    content,
    target.line,
    options,
  );
  if (!context.valid) {
    return Object.freeze({ valid: false, error: context.error });
  }

  const descriptor = resolveBulletPropertyTarget(property.name, context);
  if (descriptor.kind === "project-frontmatter") {
    const defined = Boolean(
      context.frontmatter && context.frontmatter.scheduledDefined,
    );
    return Object.freeze({
      valid: true,
      error: null,
      target: descriptor,
      context,
      defined,
      value: defined ? context.frontmatter.scheduledValue : "",
    });
  }

  const field = findBulletPropertyField(target.rawLine, property.name);
  return Object.freeze({
    valid: true,
    error: null,
    target: descriptor,
    context,
    defined: Boolean(field),
    value: field ? field.value : "",
  });
}

// Aggregate a property row across counted source tasks. A value is "common"
// only when every source defines the same value; partial presence is mixed.
function createCountedBulletPropertyItems(
  config,
  content,
  session,
  options = {},
) {
  const validation = validateCountedTaskSession(content, session);
  if (!validation.valid) {
    return Object.freeze({ valid: false, error: validation.error, items: [] });
  }

  const items = [];
  for (let order = 0; order < config.properties.length; order += 1) {
    const property = config.properties[order];
    const states = [];
    for (const target of session.targets) {
      const state = getCountedPropertyTargetState(
        content,
        target,
        property,
        options,
      );
      if (!state.valid) {
        return Object.freeze({ valid: false, error: state.error, items: [] });
      }
      states.push(state);
    }

    const definedStates = states.filter((state) => state.defined);
    const values = Array.from(
      new Set(definedStates.map((state) => state.value)),
    );
    const allDefined = definedStates.length === states.length;
    const valueState =
      definedStates.length === 0
        ? "absent"
        : allDefined && values.length === 1
          ? "common"
          : "mixed";
    const currentLabels = Object.freeze(
      values.map((value) => getBulletPropertyCurrentLabel(property, value)),
    );
    items.push({
      kind: "property",
      property,
      target: Object.freeze({ kind: "counted-task-batch" }),
      order,
      defined: definedStates.length > 0,
      definedCount: definedStates.length,
      targetCount: states.length,
      currentValue: valueState === "common" ? values[0] : "",
      currentLabel: valueState === "common" ? currentLabels[0] : "",
      currentValues: Object.freeze(values),
      currentLabels,
      valueState,
      mixed: valueState === "mixed",
      dependencyEligible: true,
      sourceStates: Object.freeze(states),
    });
  }

  items.sort((first, second) => {
    if (first.defined !== second.defined) {
      return first.defined ? -1 : 1;
    }
    return first.order - second.order;
  });
  return Object.freeze({
    valid: true,
    error: null,
    items: Object.freeze(items),
  });
}

function validateDependencyParentForEditor(editor, cursor, expectedLine = null) {
  if (!editor || typeof editor.getValue !== "function" || !cursor) {
    return Object.freeze({
      valid: false,
      line: null,
      message: "No active markdown editor",
    });
  }
  const line = getEditorLine(editor, cursor.line);
  if (line === null) {
    return Object.freeze({
      valid: false,
      line: null,
      message: "No active markdown editor",
    });
  }
  const content = String(editor.getValue() || "");
  if (!isObsidianTaskAtLine(content, cursor.line)) {
    return Object.freeze({
      valid: false,
      line,
      message: "Dependencies can only be set on #task checkboxes.",
    });
  }
  if (isBlockquotedMarkdownLine(line)) {
    return Object.freeze({
      valid: false,
      line,
      message: "⛓ Dependencies can't be edited inside a blockquote",
    });
  }
  if (expectedLine !== null && line !== expectedLine) {
    return Object.freeze({
      valid: false,
      line,
      message: "Current task changed; dependencies not updated",
    });
  }
  return Object.freeze({ valid: true, line, message: null });
}

function isTaskTagLeftBoundary(character) {
  return (
    character === undefined || /\s/.test(character) || "([{".includes(character)
  );
}

function isTaskTagRightBoundary(character) {
  return (
    character === undefined ||
    /\s/.test(character) ||
    "])}:.,;!?".includes(character)
  );
}

function getWholeTaskTagSpans(text, tag) {
  const source = String(text || "");
  const spans = [];
  let offset = 0;
  while (offset < source.length) {
    const relativeIndex = source.indexOf(tag, offset);
    if (relativeIndex === -1) {
      break;
    }
    const end = relativeIndex + tag.length;
    if (
      isTaskTagLeftBoundary(source[relativeIndex - 1]) &&
      isTaskTagRightBoundary(source[end])
    ) {
      spans.push(Object.freeze({ start: relativeIndex, end }));
      offset = end;
    } else {
      offset = relativeIndex + 1;
    }
  }
  return spans;
}

function hasWholeTaskTag(text, tag) {
  return getWholeTaskTagSpans(text, tag).length > 0;
}

function removeTextSpans(line, spans) {
  return (Array.isArray(spans) ? spans : [])
    .slice()
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, span) => removeBulletPropertyFieldSpan(text, span),
      String(line || ""),
    );
}

function normalizeProjectLifecycleHideTag(lineText, hide, includeProjectTask) {
  const text = String(lineText || "");
  if (!includeProjectTask) {
    return text;
  }
  const spans = getWholeTaskTagSpans(text, PROJECT_HIDE_TAG);
  if (!hide) {
    return removeTextSpans(text, spans);
  }
  if (spans.length > 0) {
    return removeTextSpans(text, spans.slice(1));
  }

  const trailingBlockId = getTrailingBlockIdSpan(text);
  const insertionIndex = trailingBlockId
    ? trailingBlockId.start
    : text.trimEnd().length;
  const before = text.slice(0, insertionIndex).replace(/[ \t]+$/, "");
  const after = text.slice(insertionIndex);
  return `${before} ${PROJECT_HIDE_TAG}${after}`;
}

function parseProjectTaskScheduledFields(lineText) {
  const text = String(lineText || "");
  const fields = [];
  const pattern =
    /(?:\[([^\[\]\n]+?)::([^\]\n]*)\]|\(([^()\n]+?)::([^)\n]*)\))/g;
  let match = pattern.exec(text);
  while (match) {
    const key = String(match[1] ?? match[3] ?? "").trim();
    if (key === "scheduled") {
      fields.push(
        Object.freeze({
          key,
          value: String(match[2] ?? match[4] ?? "").trim(),
          raw: match[0],
          span: Object.freeze({
            start: match.index,
            end: match.index + match[0].length,
          }),
        }),
      );
    }
    match = pattern.exec(text);
  }
  return fields;
}

function upsertProjectTaskScheduledField(lineText, scheduled) {
  const text = String(lineText || "");
  const fields = parseProjectTaskScheduledFields(text);
  if (fields.length > 1) {
    return Object.freeze({ line: text, changed: false, ambiguous: true });
  }
  if (fields.length === 1) {
    const validation = validateProjectScheduledDate(fields[0].value);
    if (validation.valid && validation.value >= scheduled) {
      return Object.freeze({
        line: text,
        changed: false,
        ambiguous: false,
      });
    }
    const nextLine =
      text.slice(0, fields[0].span.start) +
      formatBulletPropertyField("scheduled", scheduled) +
      text.slice(fields[0].span.end);
    return Object.freeze({
      line: nextLine,
      changed: nextLine !== text,
      ambiguous: false,
    });
  }
  const inserted = upsertBulletProperty(text, "scheduled", scheduled);
  return Object.freeze({
    line: inserted.line,
    changed: inserted.changed,
    ambiguous: false,
  });
}

function removeProjectTaskScheduledFields(lineText, predicate = () => true) {
  const text = String(lineText || "");
  const spans = parseProjectTaskScheduledFields(text)
    .filter((field) => predicate(field))
    .map((field) => field.span);
  return Object.freeze({
    line: removeTextSpans(text, spans),
    removedCount: spans.length,
  });
}

function getRealMarkdownTaskLines(content) {
  const { lines } = splitMarkdownContent(content);
  const tasks = [];
  let inFrontmatter = startsWithFrontmatter(lines);
  let inFence = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = String(lines[lineIndex] || "");
    if (inFrontmatter) {
      if (lineIndex > 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
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
    if (!OBSIDIAN_TASK_LINE_RE.test(line)) {
      continue;
    }

    tasks.push(
      Object.freeze({
        line: lineIndex,
        text: line,
        isProjectTask: isProjectLifecycleTaskLine(line),
      }),
    );
  }

  return tasks;
}

function getProjectScheduleRecoveryTargetLines(content) {
  return getRealMarkdownTaskLines(content)
    .filter((task) => {
      if (task.isProjectTask) {
        return false;
      }
      const match = OBSIDIAN_TASK_LINE_RE.exec(task.text);
      return Boolean(match && OPEN_OBSIDIAN_TASK_STATUSES.has(match[1]));
    })
    .map((task) => task.line);
}

function planProjectTaskSchedules(
  content,
  scheduled,
  today = new Date(),
  options = {},
) {
  const validation = validateProjectScheduledDate(scheduled);
  if (!validation.valid) {
    return Object.freeze({
      valid: false,
      error: validation.message,
      content: String(content || ""),
      changed: false,
      changedTaskCount: 0,
      scheduledTaskCount: 0,
      removedHideTaskCount: 0,
      blockedTaskCount: 0,
      recoveredReadyTaskCount: 0,
      recoveredNextTaskCount: 0,
      recoveredInProgressTaskCount: 0,
      stillBlockedTaskCount: 0,
      deferredRecoveryTaskCount: 0,
      ambiguousTaskLines: Object.freeze([]),
      taskCount: 0,
      futureScheduledTaskLines: Object.freeze([]),
    });
  }

  const scheduledDate = new Date(
    validation.year,
    validation.month - 1,
    validation.day,
  );
  const localToday = getLocalDateStart(today);
  const future = compareLocalDates(scheduledDate, localToday) > 0;
  const source = splitMarkdownContent(content);
  const tasks = getRealMarkdownTaskLines(content);
  let changedTaskCount = 0;
  let scheduledTaskCount = 0;
  let removedHideTaskCount = 0;
  let blockedTaskCount = 0;
  let projectHideChanged = false;
  const ambiguousTaskLines = [];
  const futureScheduledTaskLines = [];
  const recoveryCounts = emptyScheduledRecoveryCounts();
  tasks.forEach((task) => {
    if (task.isProjectTask) {
      let nextLine = normalizeProjectLifecycleHideTag(
        task.text,
        future,
        future || tasks.length === 1,
      );
      nextLine = removeProjectTaskScheduledFields(nextLine).line;
      if (nextLine !== task.text) {
        source.lines[task.line] = nextLine;
        changedTaskCount += 1;
        projectHideChanged =
          getWholeTaskTagSpans(nextLine, PROJECT_HIDE_TAG).length !==
          getWholeTaskTagSpans(task.text, PROJECT_HIDE_TAG).length;
      }
      // `^prj` never receives an inline `scheduled` field — its schedule lives
      // in frontmatter only — so it is never blocked by the branch below. It
      // still needs pruning from today's open Pomodoros when the project
      // itself moves to a future date.
      if (future) {
        futureScheduledTaskLines.push(task.line);
      }
      return;
    }

    const scheduledFields = parseProjectTaskScheduledFields(task.text);
    if (scheduledFields.length > 1) {
      ambiguousTaskLines.push(task.line);
      return;
    }

    let nextLine = removeTextSpans(
      task.text,
      getWholeTaskTagSpans(task.text, PROJECT_HIDE_TAG),
    );
    if (nextLine !== task.text) {
      removedHideTaskCount += 1;
    }
    const match = OBSIDIAN_TASK_LINE_RE.exec(nextLine);
    const status = match ? match[1] : null;
    if (OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
      const scheduleResult = upsertProjectTaskScheduledField(
        nextLine,
        validation.value,
      );
      nextLine = scheduleResult.line;
      if (scheduleResult.changed) {
        scheduledTaskCount += 1;
      }

      const finalFields = parseProjectTaskScheduledFields(nextLine);
      const futureTaskSchedule =
        finalFields.length === 1 &&
        isFutureInlineScheduledValue(finalFields[0].value, today);
      if (futureTaskSchedule) {
        futureScheduledTaskLines.push(task.line);
        const blockedLine = blockObsidianTaskCheckboxStatus(nextLine);
        if (blockedLine !== nextLine) {
          nextLine = blockedLine;
          blockedTaskCount += 1;
        }
      } else if (finalFields.length === 1) {
        const recovery = reconcileBlockedScheduledTaskLine(
          nextLine,
          getTargetScheduledRecovery(options, task.line),
        );
        nextLine = recovery.line;
        recordScheduledRecoveryOutcome(recoveryCounts, recovery.outcome);
      }
    }
    if (nextLine !== task.text) {
      source.lines[task.line] = nextLine;
      changedTaskCount += 1;
    }
  });

  const nextContent = source.lines.join(source.lineEnding);
  return Object.freeze({
    valid: true,
    error: null,
    content: nextContent,
    changed: nextContent !== String(content || ""),
    changedTaskCount,
    scheduledTaskCount,
    removedHideTaskCount,
    blockedTaskCount,
    recoveredReadyTaskCount: recoveryCounts.ready,
    recoveredNextTaskCount: recoveryCounts.next,
    recoveredInProgressTaskCount: recoveryCounts.inProgress,
    stillBlockedTaskCount: recoveryCounts.stillBlocked,
    deferredRecoveryTaskCount: recoveryCounts.deferred,
    ambiguousTaskLines: Object.freeze(ambiguousTaskLines),
    taskCount: tasks.length,
    future,
    projectHideChanged,
    futureScheduledTaskLines: Object.freeze(futureScheduledTaskLines),
  });
}

function removeAllBulletProperties(line, name) {
  let text = String(line || "");
  let field = findBulletPropertyField(text, name);
  while (field) {
    text = removeBulletPropertyFieldSpan(text, field.span);
    field = findBulletPropertyField(text, name);
  }
  return text;
}

function replaceMarkdownLine(content, lineIndex, nextLine) {
  const source = splitMarkdownContent(content);
  if (lineIndex < 0 || lineIndex >= source.lines.length) {
    return String(content || "");
  }
  source.lines[lineIndex] = nextLine;
  return source.lines.join(source.lineEnding);
}

function updateProjectScheduledFrontmatter(content, frontmatter, value) {
  const source = splitMarkdownContent(content);
  let cursorLineDelta = 0;
  if (value === null) {
    if (frontmatter.scheduledDefined) {
      source.lines.splice(frontmatter.scheduledLine, 1);
      cursorLineDelta = -1;
    }
  } else if (frontmatter.scheduledDefined) {
    source.lines[frontmatter.scheduledLine] = `scheduled: ${value}`;
  } else {
    source.lines.splice(frontmatter.closingLine, 0, `scheduled: ${value}`);
    cursorLineDelta = 1;
  }

  return Object.freeze({
    content: source.lines.join(source.lineEnding),
    cursorLineDelta,
  });
}

function planProjectScheduledUpdate(
  content,
  cursorLine,
  scheduled,
  today = new Date(),
  options = {},
) {
  const validation = validateProjectScheduledDate(scheduled);
  if (!validation.valid) {
    return Object.freeze({ valid: false, error: validation.message });
  }
  const context = getProjectNotePropertyContext(content, cursorLine, options);
  if (!context.valid || !context.isProjectTask) {
    return Object.freeze({
      valid: false,
      error: context.error || "Cursor is not on a valid ^prj task",
    });
  }

  const propagation = planProjectTaskSchedules(
    content,
    validation.value,
    today,
    options,
  );
  if (!propagation.valid) {
    return Object.freeze({ valid: false, error: propagation.error });
  }
  const frontmatterUpdate = updateProjectScheduledFrontmatter(
    propagation.content,
    context.frontmatter,
    validation.value,
  );

  return Object.freeze({
    valid: true,
    error: null,
    content: frontmatterUpdate.content,
    changed: frontmatterUpdate.content !== String(content || ""),
    cursorLine: cursorLine + frontmatterUpdate.cursorLineDelta,
    scheduled: validation.value,
    future: propagation.future,
    changedTaskCount: propagation.changedTaskCount,
    scheduledTaskCount: propagation.scheduledTaskCount,
    removedHideTaskCount: propagation.removedHideTaskCount,
    futureScheduledTaskLines: propagation.futureScheduledTaskLines,
    blockedTaskCount: propagation.blockedTaskCount,
    recoveredReadyTaskCount: propagation.recoveredReadyTaskCount,
    recoveredNextTaskCount: propagation.recoveredNextTaskCount,
    recoveredInProgressTaskCount:
      propagation.recoveredInProgressTaskCount,
    stillBlockedTaskCount: propagation.stillBlockedTaskCount,
    deferredRecoveryTaskCount: propagation.deferredRecoveryTaskCount,
    ambiguousTaskLines: propagation.ambiguousTaskLines,
  });
}

