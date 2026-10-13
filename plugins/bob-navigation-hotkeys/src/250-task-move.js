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
  const rewrittenMovedBlocks = identities.blocks.map((block) => {
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
  const today = options.today instanceof Date ? options.today : new Date();
  const recovery = options.recoveryIndex || null;
  const projectBlocked = new Map(
    recovery && recovery.projectBlocked instanceof Map
      ? recovery.projectBlocked
      : [],
  );
  for (const range of rangeResult.ranges) {
    range.lines.forEach((_line, offset) => {
      projectBlocked.delete(
        recoveryIdentity(sourcePath, String(range.startLine + offset)),
      );
    });
  }
  const recoveryIndex = recovery ? { ...recovery, projectBlocked } : null;
  const destinationIsBlockedProject =
    destination.kind === "project" &&
    projectLooksBlockedByPrjShortcut(destinationContent);
  const markUnblockedLine =
    typeof options.markUnblockedLine === "function"
      ? options.markUnblockedLine
      : null;
  let blockedOnDestinationCount = 0;
  let recoveredOnMoveCount = 0;
  const movedBlocks = rewrittenMovedBlocks.map((block, blockIndex) => {
    const range = rangeResult.ranges[blockIndex];
    const lines = block.map((line, offset) => {
      let nextLine = String(line || "");
      // Closed lines are never edited: a legacy tag on one stays put.
      if (
        taskHasProjectBlockedTag(nextLine) &&
        isOpenObsidianTaskLine(nextLine)
      ) {
        if (destinationIsBlockedProject) {
          nextLine = setProjectBlockedTag(nextLine, false);
        } else {
          const sourceLine = range.startLine + offset;
          const metadata = recoveryIndex
            ? getScheduledRecoveryMetadata(recoveryIndex, sourcePath, sourceLine)
            : deferredScheduledRecovery("project task recovery is unavailable");
          const result = recoverProjectResidentLine(nextLine, metadata, {
            today,
            markUnblockedLine,
            isDailyNote: Boolean(
              canonicalRecoveryDailyDate(
                normalizeVaultRelativePath(destinationPath),
              ),
            ),
            isToday: false,
          });
          nextLine = result.line;
          if (result.recovered) recoveredOnMoveCount += 1;
        }
      }
      if (
        destinationIsBlockedProject &&
        isOpenObsidianTaskLine(nextLine)
      ) {
        nextLine = blockProjectResidentLine(nextLine);
        blockedOnDestinationCount += 1;
      }
      return nextLine;
    });
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

  // Design §5 commitment transfer for a move into a blocked project: the
  // moved tasks lose their lanes to `[?]`. The destination project's `^prj`
  // prerequisites rise to the strongest moved lane; each moved open task's
  // own Depends-On targets rise to that task's lane. ADJ-11/PDB9: never
  // raise a `^prj` target — walk through to that project's open deps.
  // Closed tasks never promote. Unknown notes are left for reconcile.
  let promotedOnMoveCount = 0;
  if (destinationIsBlockedProject) {
    const working = new Map([
      [sourcePath, changes.get(sourcePath).after],
      [destinationPath, changes.get(destinationPath).after],
      ...otherContents,
    ]);
    const promote = (refPath, blockId, desiredLane) => {
      promotedOnMoveCount += promoteMovePrerequisiteTarget(
        working,
        changes,
        otherContents,
        refPath,
        blockId,
        desiredLane,
      );
    };
    const projectLane = strongestDependencyPromotionLane(
      rewrittenMovedBlocks
        .flat()
        .map((line) => getObsidianTaskCheckboxStatus(String(line || ""))),
    );
    if (projectLane) {
      for (
        const item of collectProjectTaskDependencyItems(
          changes.get(destinationPath).after,
          destinationPath,
        )
      ) {
        if (item.internal || item.archive || !item.blockId) {
          continue;
        }
        promote(item.path, item.blockId, projectLane);
      }
    }
    for (const block of rewrittenMovedBlocks) {
      for (const item of collectOpenTaskDependsOnLinks(block)) {
        const link = item.link;
        const note = String((link && link.note) || "").trim();
        const depPath = note
          ? canonicalProjectDependencyPath(note, destinationPath)
          : (
              identities.movedBlockIds.has(link && link.blockId)
                ? destinationPath
                : sourcePath
            );
        const desired = getDependencyPromotionStatus(item.status);
        if (!desired) {
          continue;
        }
        promote(depPath, link && link.blockId, desired);
      }
    }
  }

  let pomodoroCleanup = null;
  let pomodoroCleanupPath = null;
  if (blockedOnDestinationCount > 0) {
    const targets = movedBlocks
      .flat()
      .filter((line) => isOpenObsidianTaskLine(line) && taskHasProjectBlockedTag(line))
      .map((line) => getTrailingBlockId(line))
      .filter(Boolean)
      .map((blockId) => ({ path: destinationPath, blockId }));
    const files = [
      { path: sourcePath, content: changes.get(sourcePath).after },
      { path: destinationPath, content: changes.get(destinationPath).after },
      ...Array.from(otherContents, ([path, content]) => ({ path, content })),
    ];
    const dailyPath =
      normalizeVaultRelativePath(options.dailyPath) ||
      scheduledRecoveryDailyPaths(files, today).current;
    const dailyChange = dailyPath ? changes.get(dailyPath) : null;
    const dailyBefore = dailyChange ? dailyChange.after : null;
    const noteIndex = options.noteIndex || createScheduledRecoveryNoteIndex(files);
    if (dailyBefore !== null && targets.length > 0) {
      pomodoroCleanup = planDeferredPomodoroLinkCleanup(dailyBefore, targets, {
        dailyPath,
        noteIndex,
        removeEmptiedEntries: true,
      });
      if (pomodoroCleanup.changed) {
        pomodoroCleanupPath = dailyPath;
        changes.set(
          dailyPath,
          Object.freeze({
            before: dailyChange.before,
            after: pomodoroCleanup.content,
          }),
        );
      }
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
    blockedOnDestinationCount,
    recoveredOnMoveCount,
    promotedOnMoveCount,
    pomodoroCleanup,
    pomodoroCleanupPath,
  });
}

// `· N Blocked · M Ready again` suffix for move, route, and reversal
// notices (§13.10); empty when nothing was blocked or recovered.
function formatTaskMoveProjectCountsNotice(blocked, recovered) {
  const parts = [];
  const blockedCount = Math.max(0, Math.floor(numericOrDefault(blocked, 0)));
  if (blockedCount > 0) {
    parts.push(`${blockedCount} Blocked`);
  }
  const recoveredCount = Math.max(
    0,
    Math.floor(numericOrDefault(recovered, 0)),
  );
  if (recoveredCount > 0) {
    parts.push(`${recoveredCount} Ready again`);
  }
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
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

