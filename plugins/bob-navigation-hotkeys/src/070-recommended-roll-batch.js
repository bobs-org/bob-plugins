
// Compose the cancel and set-priority plans into one undoable editor
// transaction: cancel first, remap the remaining lines through the cancel's
// `cursorLineShift`, then set-priority for the roll and decay targets.
// `recommendationsByLine` maps original line numbers to
// `planPriorityRollRecommendation` records. Pure: recovery and freshness inputs
// pass through `details` and are remapped, never read from the app.
function planRecommendedRollBatch(
  content,
  session,
  recommendationsByLine,
  details = {},
) {
  const text = String(content || "");
  const property = details.property || null;
  const invalid = (error, extra = {}) =>
    Object.freeze({
      valid: false,
      error,
      stale: Boolean(extra.stale),
      recurring: Boolean(extra.recurring),
      content: text,
      changed: false,
    });
  if (!property || property.values !== "priority") {
    return invalid("Counted priority update is missing configured values");
  }
  const byLine =
    recommendationsByLine instanceof Map ? recommendationsByLine : new Map();
  if (byLine.size === 0) {
    return invalid("No recommendations to apply");
  }
  for (const [, recommendation] of byLine) {
    if (recommendation && recommendation.kind === "unavailable") {
      return invalid(
        recommendation.reason ||
          "Recurring tasks are cancelled with Obsidian Tasks so the next occurrence is handled; no tasks were updated",
        { recurring: true },
      );
    }
  }
  const targets =
    session && Array.isArray(session.targets) ? session.targets : [];
  if (!session || session.valid === false || targets.length === 0) {
    return invalid("Counted task session is unavailable", { stale: true });
  }
  const dateText = normalizeBulletPropertyValue(details.dateText);
  const baseDate =
    details.baseDate instanceof Date ? details.baseDate : new Date();
  const cancelEntries = [];
  const updateEntries = [];
  for (const target of targets) {
    if (!byLine.has(target.line)) {
      continue;
    }
    const recommendation = byLine.get(target.line);
    if (!recommendation) {
      continue;
    }
    if (recommendation.kind === "cancel") {
      cancelEntries.push({ target, recommendation });
    } else if (
      recommendation.kind === "roll" ||
      recommendation.kind === "decay"
    ) {
      updateEntries.push({ target, recommendation });
    }
  }
  if (cancelEntries.length === 0 && updateEntries.length === 0) {
    return invalid("No recommendations to apply");
  }

  let intermediateContent = text;
  let shift = (line) => line;
  let cancelPlan = null;
  if (cancelEntries.length > 0) {
    if (!dateText) {
      return invalid("Cancel date is required");
    }
    const cancelSession = Object.freeze({
      valid: true,
      error: null,
      explicit: true,
      targets: Object.freeze(
        cancelEntries.map((entry) => entry.target),
      ),
    });
    const reasonByLine = new Map(
      cancelEntries.map((entry) => [
        entry.target.line,
        formatPriorityDecayCancelReason({
          level: entry.recommendation.level,
          streak: entry.recommendation.streak,
        }),
      ]),
    );
    cancelPlan = planTaskCancelBatch(intermediateContent, cancelSession, {
      date: dateText,
      reasonByLine,
      fallbackReason: "",
    });
    if (!cancelPlan.valid) {
      return invalid(cancelPlan.error, {
        stale: cancelPlan.stale,
        recurring: cancelPlan.recurring,
      });
    }
    intermediateContent = cancelPlan.content;
    shift = cancelPlan.cursorLineShift;
  }

  let priorityPlan = null;
  if (updateEntries.length > 0) {
    const shiftedTargets = updateEntries.map((entry) =>
      Object.freeze({
        line: shift(entry.target.line),
        rawLine: entry.target.rawLine,
      }),
    );
    const shiftedSession = Object.freeze({
      valid: true,
      error: null,
      explicit: true,
      targets: Object.freeze(shiftedTargets),
    });
    const priorityValueByLine = new Map();
    const scheduledValueByLine = new Map();
    const reasonByLine = new Map();
    for (const entry of updateEntries) {
      const shiftedLine = shift(entry.target.line);
      const recommendation = entry.recommendation;
      const priorityValue =
        recommendation.kind === "decay" && recommendation.toLevel
          ? recommendation.toLevel.value
          : recommendation.level && recommendation.level.value;
      priorityValueByLine.set(shiftedLine, priorityValue);
      scheduledValueByLine.set(shiftedLine, recommendation.date);
      reasonByLine.set(shiftedLine, recommendation.reason);
    }
    const firstPriorityValue = normalizeBulletPropertyValue(
      priorityValueByLine.get(shiftedTargets[0].line),
    );
    let recoveryByLine = null;
    if (details.recoveryByLine instanceof Map) {
      recoveryByLine = new Map();
      for (const [line, meta] of details.recoveryByLine) {
        recoveryByLine.set(shift(line), meta);
      }
    }
    priorityPlan = planCountedBulletPropertyBatch(
      intermediateContent,
      shiftedSession,
      property.name,
      firstPriorityValue,
      {
        operation: "set-priority",
        priorityValue: firstPriorityValue,
        priorityValueByLine,
        scheduledPropertyName: property.schedules,
        scheduledValueByLine,
        today: baseDate,
        recoveryByLine,
        scheduleLog: { automatic: true, reasonByLine },
        schedulingWorkLog:
          details.schedulingWorkLog || details.workLog || null,
        stampLine:
          typeof details.stampLine === "function"
            ? details.stampLine
            : undefined,
        freshDateText: details.freshDateText,
      },
    );
    if (!priorityPlan.valid) {
      return invalid(priorityPlan.error, { stale: priorityPlan.stale });
    }
    intermediateContent = priorityPlan.content;
  }

  const rolledCount = updateEntries.filter(
    (entry) => entry.recommendation.kind === "roll",
  ).length;
  const decayedCount = updateEntries.filter(
    (entry) => entry.recommendation.kind === "decay",
  ).length;
  const cancelledCount = cancelEntries.length;
  const futureScheduledTaskLines = priorityPlan
    ? Array.from(priorityPlan.futureScheduledTaskLines || [])
    : [];
  const cancelledEntries = cancelPlan
    ? Array.from(cancelPlan.cancelled || [])
    : [];
  return Object.freeze({
    valid: true,
    error: null,
    stale: false,
    recurring: false,
    content: intermediateContent,
    changed: intermediateContent !== text,
    cancelPlan,
    priorityPlan,
    rolledCount,
    decayedCount,
    cancelledCount,
    futureScheduledTaskLines: Object.freeze(futureScheduledTaskLines),
    cancelledEntries: Object.freeze(cancelledEntries),
    cursorLineShift: shift,
  });
}

function createDependencyNavigationCollection(fields) {
  return Object.freeze({
    lineIndices: Object.freeze((fields.lineIndices || []).slice()),
    blockIds: Object.freeze((fields.blockIds || []).slice()),
    targets: Object.freeze((fields.targets || []).slice()),
    indent: fields.indent === undefined ? null : fields.indent,
    marker: fields.marker === undefined ? null : fields.marker,
    lineIndex: fields.lineIndex === undefined ? null : fields.lineIndex,
    anyLegacy: Boolean(fields.anyLegacy),
    startLine: fields.startLine === undefined ? 0 : fields.startLine,
    endLineExclusive:
      fields.endLineExclusive === undefined ? 0 : fields.endLineExclusive,
    reason: fields.reason === undefined ? null : fields.reason,
  });
}

function collectDependencyNavigationBullets(
  content,
  parentLine,
  additionalManagedIds = [],
  prepared = null,
) {
  const text = String(content || "");
  const lines = prepared && Array.isArray(prepared.lines)
    ? prepared.lines
    : text.split(/\r?\n/);
  const contexts = prepared && prepared.contexts
    ? prepared.contexts
    : getMarkdownLineContextsForLines(lines);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));

  const emptyCollection = (reason) =>
    createDependencyNavigationCollection({
      lineIndices: [],
      blockIds: [],
      startLine:
        Number.isFinite(parentIndex) && parentIndex >= 0 ? parentIndex + 1 : 0,
      endLineExclusive:
        Number.isFinite(parentIndex) && parentIndex >= 0 ? parentIndex + 1 : 0,
      reason,
    });

  if (
    !Number.isFinite(parentIndex) ||
    parentIndex < 0 ||
    parentIndex >= lines.length
  ) {
    return emptyCollection("parent-out-of-range");
  }

  if (!isObsidianTaskAtLine(text, parentIndex, contexts, lines)) {
    return emptyCollection("not-task");
  }

  const block = findCurrentBulletChildBlock(lines, parentIndex);
  if (block.endLineExclusive <= block.startLine) {
    return emptyCollection(null);
  }
  const lineIndices = [];
  const blockIds = [];
  const targets = [];
  const seenTargetKeys = new Set();
  let indent = null;
  let marker = null;
  let lineIndex = null;
  let anyLegacy = false;
  const dependencyField = findBulletPropertyField(lines[parentIndex], "dependsOn");
  const managedIds = new Set(
    dependencyField ? parseLocalTaskIdList(dependencyField.value) : [],
  );
  const managedTargetKeys = new Set(
    normalizeDependencyNavigationTargets(additionalManagedIds).map(
      dependencyNavigationTargetKey,
    ),
  );
  let taskIdentities = null;
  const getTaskIdentities = () => {
    if (taskIdentities) {
      return taskIdentities;
    }
    if (prepared && prepared.entries) {
      taskIdentities = getDependencySnapshotIdentities(prepared);
      return taskIdentities;
    }
    taskIdentities = getTaskIdentityByBlockId(text, contexts, lines);
    return taskIdentities;
  };

  const rememberTarget = (target) => {
    const normalized = normalizeBulletPropertyValue(target.blockId);
    const frozen = Object.freeze({
      blockId: normalized,
      note: String(target.note || "").trim(),
      terminal: false,
      legacy: Boolean(target.legacy),
    });
    const targetKey = dependencyNavigationTargetKey(frozen);
    if (!normalized || seenTargetKeys.has(targetKey)) {
      return;
    }
    seenTargetKeys.add(targetKey);
    blockIds.push(normalized);
    targets.push(frozen);
  };

  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    const lineText = String(lines[index] || "");
    // Fenced code never counts, wherever it sits.
    if (contexts[index] && contexts[index].inFence) {
      continue;
    }
    if (findNearestParentListItem(lines, index) !== parentIndex) {
      continue;
    }
    // The managed Depends-On line: links first, then legacy children, so the
    // field mirrors the line's order (`docs/task-dependencies.md` §3).
    const parsedLine = parseDependencyLine(lineText, {
      isDirectChildOfTask: true,
    });
    if (parsedLine.verdict === "accept") {
      if (lineIndex === null) {
        lineIndex = index;
        indent = parsedLine.indent;
        marker = parsedLine.marker;
        lineIndices.unshift(index);
      }
      if (!parsedLine.canonical) {
        anyLegacy = true;
      }
      parsedLine.links.forEach(rememberTarget);
      continue;
    }
    if (parsedLine.verdict === "malformed" || parsedLine.verdict === "empty") {
      continue;
    }
    // R8 legacy child: a direct child bullet whose only content is one block
    // link (plain, embedded, or struck). It counts while the dependent's
    // field (or the in-flight batch) still manages its target id; anything
    // else — a `#^ref` reading embed, prose, a nested link — is content.
    const legacy = parseDependencyLegacyChildDetails(lineText);
    if (!legacy) {
      continue;
    }
    if (
      !legacyChildCoveredByField(
        legacy,
        managedIds,
        managedTargetKeys,
        getTaskIdentities(),
      )
    ) {
      continue;
    }
    if (lineIndices.length === 0) {
      indent = parsedLegacyIndent(lineText);
      marker = parsedLegacyMarker(lineText);
    }
    lineIndices.push(index);
    anyLegacy = true;
    rememberTarget({ blockId: legacy.blockId, note: legacy.note, legacy: true });
  }

  return createDependencyNavigationCollection({
    lineIndices,
    blockIds,
    targets,
    indent,
    marker,
    lineIndex,
    anyLegacy,
    startLine: block.startLine,
    endLineExclusive: block.endLineExclusive,
    reason: null,
  });
}

function getCachedDependencyCollection(snapshot, content, parentLine, additionalManagedIds = []) {
  const normalizedIds = Array.isArray(additionalManagedIds) ? additionalManagedIds : [];
  if (snapshot && snapshot.collections && normalizedIds.length === 0) {
    const at = Math.floor(numericOrDefault(parentLine, Number.NaN));
    if (snapshot.collections.has(at)) {
      return snapshot.collections.get(at);
    }
    const built = collectDependencyNavigationBullets(snapshot.text, at, [], snapshot);
    snapshot.collections.set(at, built);
    return built;
  }
  return collectDependencyNavigationBullets(
    content,
    parentLine,
    normalizedIds,
    snapshot || null,
  );
}

// True when the task line carries a `[scheduled:: YYYY-MM-DD]` date after
// today (date-only comparison). A future schedule keeps a dependent `[?]`
// even with no open prerequisites (`docs/task-dependencies.md` §5).
function dependencyParentHasFutureSchedule(lineText, today = new Date()) {
  const field = findBulletPropertyField(String(lineText || ""), "scheduled");
  const raw = field ? String(field.value || "").trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    return false;
  }
  const base = today instanceof Date ? today : new Date(today);
  const startOfToday = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
  );
  const scheduled = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return scheduled.getTime() > startOfToday.getTime();
}

// One sole block link on a child bullet: plain, `![[…]]`, or `~~[[…]]~~`
// (never both). Mirrors `task_dependencies::legacy_child_reference` in
// bob-cli; the field-membership half of R8 is checked by the caller.
function parseDependencyLegacyChildDetails(line) {
  const text = String(line || "");
  const match = DEPENDENCY_TRANSCLUSION_BULLET_RE.exec(text);
  if (!match) {
    return null;
  }
  const { strike, embed, note, blockId } = match.groups;
  if (strike && embed) {
    return null;
  }
  return Object.freeze({
    note: String(note || "").trim(),
    blockId,
    transcluded: Boolean(embed),
    terminal: Boolean(strike),
  });
}

function parsedLegacyIndent(line) {
  const match = DEPENDENCY_TRANSCLUSION_BULLET_RE.exec(String(line || ""));
  return match ? match.groups.indent : "";
}

function parsedLegacyMarker(line) {
  const match = DEPENDENCY_TRANSCLUSION_BULLET_RE.exec(String(line || ""));
  return match ? match.groups.marker : "-";
}

// R8 field gate: the legacy child's resolved target id (its `[id::]`,
// canonical id, or same-note bare block id) is in the dependent's field, or
// the in-flight batch already manages its link.
function legacyChildCoveredByField(
  legacy,
  managedIds,
  managedTargetKeys,
  taskIdentities,
) {
  if (managedTargetKeys.has(dependencyNavigationTargetKey(legacy))) {
    return true;
  }
  if (legacy.note) {
    const qualified = tryDependencyId(
      `${legacy.note}.md`,
      legacy.blockId,
    );
    return Boolean(qualified && managedIds.has(qualified));
  }
  return (
    managedIds.has(legacy.blockId) ||
    managedIds.has(
      taskIdentities ? taskIdentities.get(legacy.blockId) : undefined,
    )
  );
}

function computeFinalDependencyLinkOrder(existingIds, addIds, removeIds) {
  const removeSet = new Set(
    normalizeDependencyNavigationTargets(removeIds).map(
      dependencyNavigationTargetKey,
    ),
  );
  const finalTargets = [];
  const seenTargets = new Set();

  normalizeDependencyNavigationTargets(existingIds).forEach((target) => {
    const key = dependencyNavigationTargetKey(target);
    if (removeSet.has(key) || seenTargets.has(key)) {
      return;
    }

    seenTargets.add(key);
    finalTargets.push(compactDependencyNavigationTarget(target));
  });

  normalizeDependencyNavigationTargets(addIds).forEach((target) => {
    const key = dependencyNavigationTargetKey(target);
    if (seenTargets.has(key)) {
      // Re-adding a present link moves it to the end, never re-sorts the
      // rest (`docs/task-dependencies.md` §2.1).
      const existingIndex = finalTargets.findIndex(
        (entry) => dependencyNavigationTargetKey(entry) === key,
      );
      if (existingIndex !== -1) {
        finalTargets.splice(existingIndex, 1);
      }
    }

    seenTargets.add(key);
    finalTargets.push(compactDependencyNavigationTarget(target));
  });

  return finalTargets;
}

// Insertion point for a new Depends-On line: the first direct child, or the
// second when a `❌ **CANCEL LOG**` child exists.
function getDependencyInsertLine(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(parentIndex) || parentIndex < 0) {
    return 0;
  }
  const block = findCurrentBulletChildBlock(sourceLines, parentIndex);
  const cancel = findCancelLogParent(sourceLines, parentIndex);
  if (
    cancel &&
    cancel.line >= block.startLine &&
    cancel.line < block.endLineExclusive &&
    findNearestParentListItem(sourceLines, cancel.line) === parentIndex
  ) {
    return cancel.line + 1;
  }
  return block.startLine;
}

// Owning task of any line in its block: the line itself when it is a task,
// else the nearest ancestor list item that is one. Returns null for prose.
function findOwningTaskLine(lines, line) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const content = sourceLines.join("\n");
  const contexts = getMarkdownLineContextsForLines(sourceLines);
  let current = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(current) || current < 0 || current >= sourceLines.length) {
    return null;
  }
  while (Number.isFinite(current) && current >= 0) {
    if (isObsidianTaskAtLine(content, current, contexts, sourceLines)) {
      return current;
    }
    const parent = findNearestParentListItem(sourceLines, current);
    if (parent === null || parent >= current) {
      return null;
    }
    current = parent;
  }
  return null;
}

// Index of the task's Depends-On line among its direct children, or null.
function findDependencyLineIndex(lines, parentLine) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const parentIndex = Math.floor(numericOrDefault(parentLine, Number.NaN));
  if (!Number.isFinite(parentIndex) || parentIndex < 0) {
    return null;
  }
  const block = findCurrentBulletChildBlock(sourceLines, parentIndex);
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    if (findNearestParentListItem(sourceLines, index) !== parentIndex) {
      continue;
    }
    const parsed = parseDependencyLine(String(sourceLines[index] || ""), {
      isDirectChildOfTask: true,
    });
    if (parsed.verdict === "accept") {
      return index;
    }
  }
  return null;
}

// Removed lines between two note snapshots (common prefix/suffix diff), for
// the hand-edit mirror's deleted-line detection.
function findRemovedLineText(oldContent, newContent) {
  const before = String(oldContent || "").split(/\r?\n/);
  const after = String(newContent || "").split(/\r?\n/);
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return before.slice(prefix, before.length - suffix).join("\n");
}

// Offset of a 0-based line's first character in note content, for the
// hand-edit mirror's owner anchor (`ChangeSet.mapPos` works on offsets, not
// lines). Clamps to the final line; null when the line is not a number.
function dependencyMirrorOffsetOfLine(content, line) {
  const target = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(target) || target < 0) {
    return null;
  }
  const text = String(content || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const clamped = Math.min(target, lines.length - 1);
  let offset = 0;
  for (let index = 0; index < clamped; index += 1) {
    offset += lines[index].length + newline.length;
  }
  return offset;
}

// 0-based line holding a note-content offset (clamped into range), so a
// `mapPos`-mapped owner anchor becomes the line the mirror runs on.
function dependencyMirrorLineOfOffset(content, offset) {
  const at = Math.floor(numericOrDefault(offset, Number.NaN));
  if (!Number.isFinite(at) || at < 0) {
    return null;
  }
  const text = String(content || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let rest = Math.min(at, text.length);
  for (let index = 0; index < lines.length; index += 1) {
    if (rest <= lines[index].length || index === lines.length - 1) {
      return index;
    }
    rest -= lines[index].length + newline.length;
  }
  return lines.length - 1;
}

// Direct-child Depends-On verdicts for the hand-edit mirror. Fences never
// count; only direct children of the owning task are scanned.
function dependencyHandEditChildVerdicts(lines, owning) {
  const content = lines.join("\n");
  const block = findCurrentBulletChildBlock(lines, owning);
  const contexts = getMarkdownLineContexts(content);
  const verdicts = [];
  for (let index = block.startLine; index < block.endLineExclusive; index += 1) {
    if (contexts[index] && contexts[index].inFence) {
      continue;
    }
    if (findNearestParentListItem(lines, index) !== owning) {
      continue;
    }
    const parsed = parseDependencyLine(String(lines[index] || ""), {
      isDirectChildOfTask: true,
    });
    if (parsed.verdict !== "not-a-line") {
      verdicts.push({ line: index, verdict: parsed.verdict });
    }
  }
  return verdicts;
}

// The edited task across a snapshot pair: the owner in the old content,
// mapped onto the new content by task identity (trailing block id). Deleting
// a Depends-On line that is its task's last child shifts the next sibling
// into its index, so an index comparison would mistake the sibling for the
// owner and clear the sibling's field. When the owning task itself is gone,
// there is nothing to mirror.
function dependencyHandEditOwningLine(
  oldLines,
  newLines,
  editedLine,
  currentLine = editedLine,
) {
  // `editedLine` is in burst-baseline coordinates (the first update's
  // pre-change document): the old owner is always looked up there. Never
  // index the baseline with a current-document line: an insertion above the
  // owner in the same burst would otherwise pick the next sibling.
  // `currentLine` is the same owner mapped forward into the current
  // document; only the fallbacks below (tasks without a block id) read it.
  const at = Math.floor(numericOrDefault(editedLine, Number.NaN));
  const now = Math.floor(numericOrDefault(currentLine, Number.NaN));
  if (!Number.isFinite(at)) {
    return null;
  }
  if (oldLines.length > 0) {
    const oldOwning = findOwningTaskLine(
      oldLines,
      Math.max(0, Math.min(at, oldLines.length - 1)),
    );
    if (oldOwning !== null && oldOwning !== undefined) {
      const oldId = getTrailingBlockId(String(oldLines[oldOwning] || ""));
      if (oldId) {
        const newContent = newLines.join("\n");
        for (let index = 0; index < newLines.length; index += 1) {
          if (
            getTrailingBlockId(String(newLines[index] || "")) === oldId &&
            isObsidianTaskAtLine(newContent, index)
          ) {
            return index;
          }
        }
        return null;
      }
      if (
        Number.isFinite(now) &&
        now >= 0 &&
        now < newLines.length &&
        isObsidianTaskAtLine(newLines.join("\n"), now) &&
        !getTrailingBlockId(String(newLines[now] || ""))
      ) {
        const newOwning = findOwningTaskLine(
          newLines,
          Math.max(0, Math.min(now, newLines.length - 1)),
        );
        if (newOwning !== null && newOwning !== undefined) {
          return newOwning;
        }
        return now;
      }
    }
  }
  if (newLines.length === 0) {
    return null;
  }
  const fallback = Number.isFinite(now) ? now : at;
  return findOwningTaskLine(
    newLines,
    Math.max(0, Math.min(fallback, newLines.length - 1)),
  );
}

// Hand-edit mirror verdict (`docs/task-dependencies.md` §7) for the edited
// task: "touch" projects the line into the field and canonicalises it (R1);
// "clear-empty" drops a linkless line and the field (R9); "clear-field" drops
// the field after the line was deleted; null leaves the task alone (no task,
// malformed line, legacy-only children that the hooks still read, or nothing
// to do).
function planDependencyHandEditMirror(
  oldContent,
  newContent,
  editedLine,
  removedText,
  baselineLine = editedLine,
) {
  const text = String(newContent || "");
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) {
    return null;
  }
  const oldLines = String(oldContent === undefined ? newContent : oldContent).split(/\r?\n/);
  // `editedLine` is the owner mapped forward into the current document;
  // `baselineLine` identifies that same owner in the burst baseline. Direct
  // callers pass one line for both; the burst scheduler passes both.
  const owning = dependencyHandEditOwningLine(oldLines, lines, baselineLine, editedLine);
  if (owning === null) {
    return null;
  }
  if (isBlockquotedMarkdownLine(lines[owning])) {
    return null;
  }
  const verdicts = dependencyHandEditChildVerdicts(lines, owning);
  if (verdicts.some((entry) => entry.verdict === "malformed")) {
    return null;
  }
  const collection = collectDependencyNavigationBullets(text, owning);
  if (collection.reason) {
    return null;
  }
  if (collection.lineIndex !== null && collection.lineIndex !== undefined) {
    return Object.freeze({ kind: "touch", owning });
  }
  if (collection.targets.length > 0) {
    return null;
  }
  const empties = verdicts
    .filter((entry) => entry.verdict === "empty")
    .map((entry) => entry.line);
  if (empties.length > 0) {
    return Object.freeze({
      kind: "clear-empty",
      owning,
      emptyLines: Object.freeze(empties),
    });
  }
  const removed = String(removedText || "").split("\n");
  const removedDependsOn = removed.some(
    (line) => parseDependencyLine(line, {}).verdict !== "not-a-line",
  );
  const field = findBulletPropertyField(lines[owning], "dependsOn");
  if (removedDependsOn && field) {
    return Object.freeze({ kind: "clear-field", owning });
  }
  return null;
}

// ---------- Depends-On identity, link form, planner, and writer ----------
//
// `docs/task-dependencies.md` §§2-3, 5-6 in bob-cli are authoritative. Vectors
// live in that doc's §11; `scripts/test-navigation-dependencies.cjs` copies
// the DP (parse) and DW (write) tables it needs.

// Normalise a dependency target reference to `{path, blockId}`. `path` is the
// vault-relative note path (with `.md`); the empty path means the dependent's
// own note and is resolved by the caller.
function normalizeDependencyTargetRef(ref) {
  const source = ref && typeof ref === "object" ? ref : {};
  return Object.freeze({
    path: normalizeVaultRelativePath(source.path || ""),
    blockId: normalizeBulletPropertyValue(source.blockId || ""),
  });
}

function dependencyTargetRefKey(ref) {
  return `${ref.path}#^${ref.blockId}`;
}

// Link-note form of a vault path relative to the dependent's note: same-note
// targets link bare, others strip the `.md` suffix.
function dependencyLinkNoteForPath(targetPath, parentPath) {
  const target = normalizeVaultRelativePath(targetPath);
  const parent = normalizeVaultRelativePath(parentPath);
  if (target === parent) {
    return "";
  }
  return target.replace(/\.md$/i, "");
}

function dependencyPathForLinkNote(linkNote, parentPath, resolveLinkpath = null) {
  const note = String(linkNote || "").trim();
  if (!note) {
    return normalizeVaultRelativePath(parentPath);
  }
  if (typeof resolveLinkpath === "function") {
    try {
      const resolved = resolveLinkpath(note, parentPath);
      const normalized = normalizeVaultRelativePath(resolved || "");
      if (normalized) {
        return normalized;
      }
    } catch (_error) {
      // Fall through to the suffix heuristic below.
    }
  }
  return normalizeVaultRelativePath(`${note}.md`);
}

// Prerequisite id (`docs/task-dependencies.md` §3): the target's existing
// valid `[id::]` when it has one (never rewritten), else the canonical
// `dependency_id(path, blockId)`, else null for an unencodable path.
function dependencyTargetId(targetLineText, notePath, blockId) {
  const line = String(targetLineText || "");
  const idField = findBulletPropertyField(line, "id");
  const existing = idField
    ? normalizeBulletPropertyValue(idField.value)
    : "";
  if (existing && TASKS_DEPENDENCY_ID_RE.test(existing)) {
    return existing;
  }
  return tryDependencyId(notePath, blockId);
}

// Shortest unambiguous link form (`docs/task-dependencies.md` §3):
// `[[#^id]]` in the same note, `[[basename#^id]]` when the basename is
// unique in the vault (case-insensitive), else the full vault-relative path
// without `.md`. `markdownFiles` is an array of paths or `{path}` entries,
// a Map of path to content, or a plain object of path to content.
