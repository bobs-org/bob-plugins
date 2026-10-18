function canonicalDependencyLink(target, sourcePath, markdownFiles) {
  const ref = normalizeDependencyTargetRef(target);
  const source = normalizeVaultRelativePath(sourcePath);
  let paths = [];
  if (markdownFiles instanceof Map) {
    paths = [...markdownFiles.keys()];
  } else if (Array.isArray(markdownFiles)) {
    paths = markdownFiles.map((entry) =>
      entry && typeof entry === "object" ? entry.path : entry,
    );
  } else if (markdownFiles && typeof markdownFiles === "object") {
    paths = Object.keys(markdownFiles);
  }
  paths = paths
    .map((entry) => normalizeVaultRelativePath(entry))
    .filter(Boolean);
  if (ref.path === source) {
    return Object.freeze({ note: "", text: `[[#^${ref.blockId}]]` });
  }
  const basename = ref.path.split("/").pop().replace(/\.md$/i, "");
  // Archive targets always keep the explicit `done/` path form (contract
  // §3): basename links do not search `done/`, so the short form would
  // stop resolving.
  const isArchiveTarget = /^done\//i.test(ref.path);
  const rivals = paths.filter(
    (entry) =>
      entry !== ref.path &&
      entry.split("/").pop().replace(/\.md$/i, "").toLowerCase() ===
        basename.toLowerCase(),
  );
  if (rivals.length === 0 && !isArchiveTarget) {
    return Object.freeze({ note: basename, text: `[[${basename}#^${ref.blockId}]]` });
  }
  const full = ref.path.replace(/\.md$/i, "");
  return Object.freeze({ note: full, text: `[[${full}#^${ref.blockId}]]` });
}

// Find the first `#task` line carrying a trailing `^blockId`, or null.
function findTaskLineByTrailingBlockId(lines, blockId) {
  const wanted = normalizeBulletPropertyValue(blockId);
  if (!wanted) {
    return null;
  }
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const content = sourceLines.join("\n");
  for (let index = 0; index < sourceLines.length; index += 1) {
    if (
      isObsidianTaskAtLine(content, index) &&
      getTrailingBlockId(String(sourceLines[index] || "")) === wanted
    ) {
      return index;
    }
  }
  return null;
}

// Pure planner (`docs/task-dependencies.md` §§2-3, 5-6). `add`/`remove` are
// arrays of `{path, blockId}`; `files` maps vault-relative note paths to
// contents for target `[id::]` lookup and link-form ranking. Returns a plan
// whose `nextContent` is the dependent note's full next text, `targetEdits`
// (same-note, applied in the one transaction) and `preparations`
// (cross-note, applied first) cover `^id` / `[id::]` writes, and `status`
// carries the Blocked / commitment-transfer / ADJ-8 recovery effects.
// `options.recovery` (`{registry, today}`) lets a removal recover the
// dependent to its derived rank immediately on the post-edit buffer.
function planDependencyEdit(args = {}) {
  const content = String(args.content || "");
  const parentPath = normalizeVaultRelativePath(args.parentPath || "");
  const parentIndex = Math.floor(numericOrDefault(args.parentLine, Number.NaN));
  const fail = (reason) =>
    Object.freeze({ ok: false, reason, changed: false, notice: null });
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  if (
    !Number.isFinite(parentIndex) ||
    parentIndex < 0 ||
    parentIndex >= lines.length
  ) {
    return fail("parent-out-of-range");
  }
  if (!isObsidianTaskAtLine(content, parentIndex)) {
    return fail("not-task");
  }
  if (isBlockquotedMarkdownLine(lines[parentIndex])) {
    return fail("in-blockquote");
  }
  const filesMap = new Map();
  const rawFiles = args.files;
  if (rawFiles instanceof Map) {
    for (const [filePath, fileContent] of rawFiles) {
      filesMap.set(normalizeVaultRelativePath(filePath), String(fileContent || ""));
    }
  } else if (rawFiles && typeof rawFiles === "object") {
    for (const filePath of Object.keys(rawFiles)) {
      filesMap.set(
        normalizeVaultRelativePath(filePath),
        String(rawFiles[filePath] || ""),
      );
    }
  }
  if (!filesMap.has(parentPath)) {
    filesMap.set(parentPath, content);
  }
  // Link-form ranking uses the vault's file list when the caller injects it
  // (`args.vaultFiles`); otherwise it falls back to the loaded notes. Link
  // paths resolve through `args.resolveLinkpath` (the vault's linkpath
  // resolver) with the same-note suffix heuristic as the fallback.
  const resolveLinkpath =
    typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const rankPaths =
    Array.isArray(args.vaultFiles) && args.vaultFiles.length > 0
      ? args.vaultFiles
          .map((entry) =>
            entry && typeof entry === "object" ? entry.path : entry,
          )
          .map((entry) => normalizeVaultRelativePath(entry))
          .filter(Boolean)
      : [...filesMap.keys()];

  const add = (Array.isArray(args.add) ? args.add : [])
    .map(normalizeDependencyTargetRef)
    .filter((ref) => ref.path && ref.blockId);
  const remove = (Array.isArray(args.remove) ? args.remove : [])
    .map(normalizeDependencyTargetRef)
    .filter((ref) => ref.path && ref.blockId);

  const parentStatusBefore = getObsidianTaskCheckboxStatus(lines[parentIndex]);
  // `^prj` in a recognized project note (§13.10): the ordinary line writer
  // also blocks, tags, and unlinks residents. A same-note target is a
  // guaranteed deadlock (§13.6) and refuses the whole gesture; removals of
  // hand-authored internal targets still flow below.
  const projectPrj = detectProjectPrjDependencyParent(
    args,
    content,
    parentPath,
    parentIndex,
  );
  const descendantPaths = Array.isArray(args.descendantPaths)
    ? args.descendantPaths
    : collectProjectDescendantPathsFromNotes(parentPath, filesMap);
  const internalAddReason = failProjectPrjInternalAdd(
    projectPrj,
    add,
    parentPath,
    descendantPaths,
  );
  if (internalAddReason) {
    return fail(internalAddReason);
  }
  // Legacy children join the order while the field (or this batch) still
  // manages them, so a touch folds them into the line in the same write.
  const collection = collectDependencyNavigationBullets(content, parentIndex, [
    ...add.map((ref) => ({
      blockId: ref.blockId,
      note: dependencyLinkNoteForPath(ref.path, parentPath),
    })),
    ...remove.map((ref) => ({
      blockId: ref.blockId,
      note: dependencyLinkNoteForPath(ref.path, parentPath),
    })),
  ]);
  if (collection.reason) {
    return fail(collection.reason);
  }
  const existing = collection.targets.map((target) =>
    Object.freeze({
      path: dependencyPathForLinkNote(target.note, parentPath, resolveLinkpath),
      blockId: target.blockId,
      note: String(target.note || "").trim(),
    }),
  );
  // Existing links keep their order; new links append; re-adds move to the
  // end; removals drop. Never re-sorts.
  const removeKeys = new Set(remove.map(dependencyTargetRefKey));
  const finalRefs = [];
  const seenKeys = new Set();
  for (const ref of existing) {
    const key = dependencyTargetRefKey(ref);
    if (removeKeys.has(key)) {
      continue;
    }
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    finalRefs.push(ref);
  }
  for (const ref of add) {
    const key = dependencyTargetRefKey(ref);
    if (seenKeys.has(key)) {
      const at = finalRefs.findIndex(
        (entry) => dependencyTargetRefKey(entry) === key,
      );
      if (at !== -1) {
        finalRefs.splice(at, 1);
      }
    }
    seenKeys.add(key);
    finalRefs.push(ref);
  }

  // Resolve every final target to its dependency id and canonical link.
  // A kept link whose note is not loaded (an unloaded cross-note target, or
  // a deleted note) stays verbatim: its id comes from the parent field by
  // position and it counts as open, so recovery never fires on unknowns.
  // Removing such a link always works. Only added links must resolve.
  const filePaths = [...filesMap.keys()];
  const keptExisting = existing.filter(
    (ref) => !removeKeys.has(dependencyTargetRefKey(ref)),
  );
  const parentField = findBulletPropertyField(lines[parentIndex], "dependsOn");
  const parentFieldValues = parentField
    ? parseLocalTaskIdList(parentField.value)
    : [];
  const addedKeys = new Set(add.map(dependencyTargetRefKey));
  const resolved = [];
  const targetRows = new Map();
  for (const ref of finalRefs) {
    const targetContent = filesMap.has(ref.path)
      ? String(filesMap.get(ref.path) || "").split(/\r?\n/)
      : null;
    if (!targetContent) {
      if (addedKeys.has(dependencyTargetRefKey(ref))) {
        return fail("target-not-found");
      }
      const comparableExisting = filterProjectedExisting(
        projectPrj,
        existing,
        parentPath,
      );
      if (parentFieldValues.length !== comparableExisting.length) {
        return fail("target-not-found");
      }
      const slot = comparableExisting.findIndex(
        (entry) => dependencyTargetRefKey(entry) === dependencyTargetRefKey(ref),
      );
      const keptValue =
        slot !== -1 ? parentFieldValues[slot] : undefined;
      if (!keptValue) {
        return fail("target-not-found");
      }
      const keptNote = slot !== -1 ? comparableExisting[slot].note : "";
      const row = Object.freeze({
        ref,
        depValue: keptValue,
        link: Object.freeze({
          note: keptNote,
          text: keptNote ? `[[${keptNote}#^${ref.blockId}]]` : `[[#^${ref.blockId}]]`,
        }),
        line: null,
        text: "",
        status: "?",
        open: true,
        description: `^${ref.blockId}`,
        needsBlockId: false,
        needsIdField: false,
      });
      resolved.push(row);
      targetRows.set(dependencyTargetRefKey(ref), row);
      continue;
    }
    const targetLine = findTaskLineByTrailingBlockId(targetContent, ref.blockId);
    if (targetLine === null) {
      return fail("target-not-found");
    }
    const targetText = String(targetContent[targetLine] || "");
    const depValue = dependencyTargetId(targetText, ref.path, ref.blockId);
    if (!depValue) {
      return fail("target-id-unencodable");
    }
    const link = canonicalDependencyLink(ref, parentPath, rankPaths);
    const status = getObsidianTaskCheckboxStatus(targetText);
    const row = Object.freeze({
      ref,
      depValue,
      link,
      line: targetLine,
      text: targetText,
      status,
      open: OPEN_OBSIDIAN_TASK_STATUSES.has(status),
      description: cleanTaskDisplayText(targetText),
      needsBlockId: !getTrailingBlockId(targetText),
      needsIdField:
        normalizeBulletPropertyValue(
          findBulletPropertyField(targetText, "id")
            ? findBulletPropertyField(targetText, "id").value
            : "",
        ) !== depValue,
    });
    resolved.push(row);
    targetRows.set(dependencyTargetRefKey(ref), row);
  }

  const projected = projectResolvedTargets(projectPrj, resolved, parentPath);

  const existingKeys = new Set(existing.map(dependencyTargetRefKey));
  const seenAddKeys = new Set();
  const addedRows = [];
  let addedCount = 0;
  for (const ref of add) {
    const key = dependencyTargetRefKey(ref);
    if (seenAddKeys.has(key)) {
      continue;
    }
    seenAddKeys.add(key);
    const row = targetRows.get(key);
    if (row) {
      addedRows.push(row);
    }
    if (!existingKeys.has(key) && !removeKeys.has(key)) {
      addedCount += 1;
    }
  }
  const removedCount = existing.filter(
    (ref) => !targetRows.has(dependencyTargetRefKey(ref)),
  ).length;

  // Field mirrors the line's order; an empty list removes the field (R9 has
  // no placeholder).
  const seenValues = new Set();
  const fieldValues = [];
  for (const row of projected) {
    if (seenValues.has(row.depValue)) {
      continue;
    }
    seenValues.add(row.depValue);
    fieldValues.push(row.depValue);
  }
  let parentText = String(lines[parentIndex] || "");
  if (fieldValues.length === 0) {
    parentText = deleteBulletProperty(parentText, "dependsOn").line;
  } else {
    const nextField = formatBulletPropertyField(
      "dependsOn",
      fieldValues.join(", "),
    );
    const existingField = findBulletPropertyField(parentText, "dependsOn");
    parentText = existingField
      ? parentText.slice(0, existingField.span.start) +
        nextField +
        parentText.slice(existingField.span.end)
      : upsertBulletProperty(parentText, "dependsOn", fieldValues.join(", ")).line;
  }

  // Status effects (§5). Adding an open prerequisite blocks the dependent;
  // when the dependent held Next/In Progress, the open target rises to at
  // least that lane (commitment transfer). The hand-edit mirror
  // (`mirrorTouch`) applies the same effects from the hand-edited state:
  // a hand-added open prerequisite blocks, but there is never a commitment
  // transfer.
  const mirrorTouch = args.mirrorTouch === true;
  const addedOpen = addedRows.filter((row) => row.open);
  let blockParent = false;
  const mirrorOpenRemaining = projected.filter((row) => row.open).length;
  if (mirrorTouch ? mirrorOpenRemaining > 0 : addedOpen.length > 0) {
    const blocked = blockObsidianTaskCheckboxStatus(parentText);
    blockParent = blocked !== parentText;
    parentText = blocked;
  }
  const promotions = [];
  const recordPromotion = (path, line, from, to) => {
    if (from === to) {
      return;
    }
    promotions.push(
      Object.freeze({
        path,
        line,
        from,
        to,
      }),
    );
  };
  const residentBlockPlan = planProjectResidentBlockEdits(
    projectPrj,
    lines,
    addedOpen,
  );
  const residentBlockEdits = residentBlockPlan.edits;
  const projectNewlyBlockedLines = residentBlockPlan.newlyBlocked;

  // Commitment-transfer lanes (Design §5): callers converting or seeding a
  // project pass the residents' pre-write lanes when the content no longer
  // shows them (e.g. a future-date seed already flipped residents to `[?]`);
  // otherwise lanes read off the current lines.
  const projectLaneStatuses = Array.isArray(args.projectLaneStatuses)
    ? args.projectLaneStatuses
    : projectPromotionLaneStatuses(projectPrj, lines);
  for (const row of (mirrorTouch ? [] : addedOpen)) {
    const desired = getDependencyPromotionStatus(
      parentStatusBefore,
      projectLaneStatuses,
    );
    if (!desired) {
      continue;
    }
    // ADJ-11 (`docs/task-dependencies.md` §13.4 PDB9): never raise a `^prj`
    // target; walk through it to that project's own Depends-On links.
    if (isProjectLifecycleTaskLine(row.text) && row.ref.blockId === "prj") {
      for (const walked of collectProjectDependencyPromotionRows(
        filesMap,
        row.ref.path,
      )) {
        recordPromotion(
          walked.path,
          walked.line,
          walked.text,
          promoteObsidianTaskCheckboxStatus(walked.text, desired),
        );
      }
      continue;
    }
    recordPromotion(
      row.ref.path,
      row.line,
      row.text,
      promoteObsidianTaskCheckboxStatus(row.text, desired),
    );
  }

  // Same-note target writes join the dependent's one transaction;
  // cross-note targets are prepared first (an unused id is acceptable, a
  // link to an unprepared target is not).
  const targetEdits = [];
  const preparations = [];
  const recordTargetWrite = (row, nextText) => {
    if (nextText === row.text) {
      return;
    }
    const edit = Object.freeze({
      path: row.ref.path,
      line: row.line,
      from: row.text,
      text: nextText,
    });
    if (row.ref.path === parentPath) {
      targetEdits.push(edit);
    } else {
      preparations.push(
        Object.freeze({ ...edit, kind: "target-identity" }),
      );
    }
  };
  for (const row of resolved) {
    let nextText = row.text;
    const promotion = promotions.find(
      (entry) =>
        entry.path === row.ref.path && entry.line === row.line,
    );
    if (promotion) {
      nextText = promotion.to;
    }
    if (row.needsBlockId) {
      nextText = appendBlockIdToLine(nextText, row.ref.blockId);
    }
    if (row.needsIdField || row.needsBlockId) {
      const upserted = upsertBulletProperty(nextText, "id", row.depValue);
      nextText = upserted.line;
    }
    recordTargetWrite(row, nextText);
  }
  for (const promotion of promotions) {
    const alreadyWritten = [...targetEdits, ...preparations].some(
      (edit) => edit.path === promotion.path && edit.line === promotion.line,
    );
    if (alreadyWritten) {
      continue;
    }
    const edit = Object.freeze({
      path: promotion.path,
      line: promotion.line,
      from: promotion.from,
      text: promotion.to,
    });
    if (promotion.path === parentPath) {
      targetEdits.push(edit);
    } else {
      preparations.push(Object.freeze({ ...edit, kind: "target-identity" }));
    }
  }

  const mergedSameNoteEdits = mergeProjectResidentBlockEdits(
    targetEdits,
    residentBlockEdits,
    parentPath,
  );

  // The line: create, append, remove, or delete (empty list deletes it).
  const linkTargets = resolved.map((row) => ({
    blockId: row.ref.blockId,
    note: row.link.note,
  }));
  const indent =
    collection.indent === null || collection.indent === undefined
      ? getDependencyChildIndent(lines, parentIndex)
      : collection.indent;
  const marker =
    collection.marker === null || collection.marker === undefined
      ? "-"
      : collection.marker;
  const lineText =
    linkTargets.length === 0
      ? null
      : formatDependencyNavigationBulletWithMarker(linkTargets, indent, marker);
  const structural = { replaceLine: null, insertAt: null, deleteLines: [] };
  if (collection.lineIndex !== null && collection.lineIndex !== undefined) {
    structural.replaceLine = collection.lineIndex;
  }
  for (const lineIndex of collection.lineIndices) {
    if (lineIndex !== structural.replaceLine) {
      structural.deleteLines.push(lineIndex);
    }
  }
  if (lineText === null) {
    if (structural.replaceLine !== null) {
      structural.deleteLines.push(structural.replaceLine);
      structural.replaceLine = null;
    }
    for (const emptyIndex of collectEmptyDependencyLineIndices(lines, parentIndex)) {
      if (!structural.deleteLines.includes(emptyIndex)) {
        structural.deleteLines.push(emptyIndex);
      }
    }
  } else if (structural.replaceLine === null) {
    structural.insertAt = getDependencyInsertLine(lines, parentIndex);
  }

  // Removing a dependency recovers the dependent to its derived rank
  // immediately (ADJ-8) when no open prerequisite and no future `scheduled`
  // date remain; otherwise it stays `[?]`. The hooks keep the final word.
  // A cleared field counts as a removal even when no link row was removed
  // (field-only Ctrl+D), and the hand-edit mirror recovers whenever no open
  // prerequisite remains, since the hand edit itself is the removal.
  const openRemaining = projected.filter((row) => row.open).length;
  const recoveryToday =
    args.recovery && args.recovery.today
      ? args.recovery.today
      : new Date();
  const fieldCleared =
    parentFieldValues.length > 0 && fieldValues.length === 0;
  let recoverParent =
    (removedCount > 0 || fieldCleared || mirrorTouch) &&
    openRemaining === 0 &&
    getObsidianTaskCheckboxStatus(parentText) === "?" &&
    !taskHasProjectBlockedTag(parentText) &&
    !dependencyParentHasFutureSchedule(parentText, recoveryToday);
  // Resident recovery runs only when `^prj` itself was Blocked before the
  // gesture (§13.10): removing a closed link from an unblocked `^prj` must
  // not flip residents that stay Blocked on their own prerequisites (the
  // vault snapshot loads only for `[?]` dependents, so unknown ids would
  // otherwise read as recovered).
  const projectWantsResidentRecovery =
    parentStatusBefore === "?" &&
    shouldRecoverProjectResidents(
      projectPrj,
      args.recovery,
      removedCount,
      fieldCleared,
      openRemaining,
      parentText,
      recoveryToday,
    );
  let recoveredOutcome = null;
  let projectRecoveredLines = [];
  let projectReadyLines = [];
  let residentRecoveryEdits = [];
  if (
    (recoverParent || projectWantsResidentRecovery) &&
    args.recovery &&
    args.recovery.registry
  ) {
    const preview = applyDependencyPlanLines(
      lines,
      parentIndex,
      parentText,
      mergedSameNoteEdits,
      structural,
      lineText,
      lineEnding,
    );
    // Recovery resolves over the vault snapshot with the edited buffer
    // overriding (`args.recovery.vaultContents`), so Pomodoro-linked
    // dependents in unloaded notes (including today's daily note) recover
    // to their derived rank instead of deferring or defaulting to Ready.
    const recoveryFiles = new Map();
    const vaultContents =
      args.recovery && args.recovery.vaultContents;
    if (vaultContents instanceof Map) {
      for (const [filePath, fileContent] of vaultContents) {
        const normalized = normalizeVaultRelativePath(filePath);
        if (normalized) {
          recoveryFiles.set(normalized, String(fileContent || ""));
        }
      }
    } else if (vaultContents && typeof vaultContents === "object") {
      for (const filePath of Object.keys(vaultContents)) {
        const normalized = normalizeVaultRelativePath(filePath);
        if (normalized) {
          recoveryFiles.set(normalized, String(vaultContents[filePath] || ""));
        }
      }
    }
    for (const filePath of filePaths) {
      recoveryFiles.set(
        filePath,
        filePath === parentPath
          ? preview.lines.join(preview.lineEnding)
          : String(filesMap.get(filePath) || ""),
      );
    }
    const recoveryIndex = buildScheduledRecoveryIndex(
      [...recoveryFiles].map(([path, content]) => ({ path, content })),
      args.recovery.registry,
      args.recovery.today,
    );
    if (recoverParent) {
      const metadata = getScheduledRecoveryMetadata(
        recoveryIndex,
        parentPath,
        parentIndex,
      );
      const reconciled = reconcileBlockedScheduledTaskLine(parentText, metadata);
      parentText = reconciled.line;
      recoveredOutcome = reconciled.outcome;
      recoverParent = reconciled.outcome === "still-blocked";
    }
    if (projectWantsResidentRecovery) {
      const markUnblockedLine =
        args.recovery && typeof args.recovery.markUnblockedLine === "function"
          ? args.recovery.markUnblockedLine
          : null;
      const recovery = recoverProjectResidents(
        projectPrj,
        lines,
        preview.lines,
        recoveryIndex,
        parentPath,
        structural,
        recoveryToday,
        markUnblockedLine,
        {
          isDailyNote: args.recovery && args.recovery.isDailyNote === true,
          isToday: args.recovery && args.recovery.isToday === true,
        },
      );
      residentRecoveryEdits = recovery.edits;
      projectRecoveredLines = recovery.recovered;
      projectReadyLines = recovery.ready;
    }
  }

  const next = applyDependencyPlanLines(
    lines,
    parentIndex,
    parentText,
    [...mergedSameNoteEdits, ...residentRecoveryEdits],
    structural,
    lineText,
    lineEnding,
  );
  const dependencyNextContent = next.lines.join(next.lineEnding);
  const blocksExisting = Array.isArray(args.blocksExisting)
    ? args.blocksExisting
        .map(normalizeDependencyTargetRef)
        .filter((ref) => ref.path && ref.blockId)
    : existing;
  const blocksPlan = planBlocksForDependencyEdit({
    content,
    nextContent: dependencyNextContent,
    parentPath,
    parentLine: parentIndex,
    existing: blocksExisting,
    resolved,
    files: filesMap,
    preparations,
    vaultFiles: rankPaths,
    resolveLinkpath,
    blocksLinesEnabled: args.blocksLinesEnabled === true,
    today: args.recovery && args.recovery.today,
  });
  const nextContent = blocksPlan.nextContent;
  const lineEdits = dependencyPlanLineEdits(structural, blocksPlan.lineEdits);
  const parentBlockId = getTrailingBlockId(String(lines[parentIndex] || ""));
  const summary = Object.freeze({
    added: addedCount,
    removed: removedCount,
    openRemaining,
    blockedAfter: getObsidianTaskCheckboxStatus(parentText) === "?",
    recoveredOutcome,
    pomodoroTargets: Object.freeze(
      !projectPrj &&
        !mirrorTouch &&
        addedOpen.length > 0 &&
        getObsidianTaskCheckboxStatus(parentText) === "?" &&
        parentBlockId
        ? [Object.freeze({ path: parentPath, blockId: parentBlockId })]
        : [],
    ),
    project: summarizeProjectDependencyEdit(projectPrj, {
      lines,
      parentIndex,
      parentText,
      addedOpen,
      newlyBlocked: projectNewlyBlockedLines,
      recovered: projectRecoveredLines,
      ready: projectReadyLines,
    }),
  });
  return Object.freeze({
    ok: true,
    reason: null,
    changed: nextContent !== content,
    parentPath,
    parentLine: parentIndex,
    parentLineNext: mapLineThroughLineEdits(parentIndex, lineEdits),
    lineEdits,
    nextContent,
    field: fieldValues.length === 0 ? null : fieldValues.join(", "),
    lineText,
    structural: Object.freeze({
      replaceLine: structural.replaceLine,
      insertAt: structural.insertAt,
      deleteLines: Object.freeze(structural.deleteLines.slice()),
    }),
    targetEdits: Object.freeze(targetEdits),
    preparations: Object.freeze(preparations),
    blocksFollowUps: blocksPlan.blocksFollowUps,
    blocksFailedPaths: blocksPlan.failedPaths,
    promotions: Object.freeze(promotions),
    blockParent,
    recoverParent,
    added: Object.freeze(addedRows.map((row) => row.description)),
    removed: Object.freeze(
      existing
        .filter((ref) => !targetRows.has(dependencyTargetRefKey(ref)))
        .map((ref) => describeRemovedDependencyTarget(ref, filesMap)),
    ),
    summary,
    notice: buildDependencyEditNoticeWithProject(summary, {
      added: addedRows.map((row) => row.description),
      removed: existing
        .filter((ref) => !targetRows.has(dependencyTargetRefKey(ref)))
        .map((ref) => describeRemovedDependencyTarget(ref, filesMap)),
    }),
  });
}

// Removal notices name the task's description, never its block id
// (`docs/task-dependencies.md` §6.7): resolve the removed target's display
// text from the loaded notes, falling back to `^blockId` when the note is
// gone or the line no longer resolves.
function describeRemovedDependencyTarget(ref, filesMap) {
  try {
    const path = normalizeVaultRelativePath((ref && ref.path) || "");
    const blockId = normalizeBulletPropertyValue((ref && ref.blockId) || "");
    if (!path || !blockId || !(filesMap instanceof Map)) {
      return blockId ? `^${blockId}` : "(missing task)";
    }
    const content = filesMap.get(path);
    if (content === undefined) {
      return `^${blockId}`;
    }
    const targetLines = String(content).split(/\r?\n/);
    const found = findTaskLineByTrailingBlockId(targetLines, blockId);
    if (found === null) {
      return `^${blockId}`;
    }
    const cleaned = cleanTaskDisplayText(String(targetLines[found] || ""));
    return cleaned || `^${blockId}`;
  } catch (_removedNameError) {
    const fallback = normalizeBulletPropertyValue((ref && ref.blockId) || "");
    return fallback ? `^${fallback}` : "(missing task)";
  }
}

// Sequencing core for the writer: preparations first (an unused target id is
// acceptable, a link to an unprepared target is not), then the dependent's
// one-transaction commit. Both effects are injected so tests can stub them;
// the plugin method below wires the real editor and vault. Preparations are
// awaited before the commit: a failed preparation aborts with the dependent
// untouched, so a failed gesture can never leave a promoted target behind.
// The sub-project cascade rides the same sequence (`docs/task-dependencies.md`
// §13.19): `io.planSubtreePass` runs before the commit (off the predicted
// content), `io.writeSubtreePass` runs after it, and the result carries the
// pass as `subtree` (null when no pass applied). A subtree failure is
// reported in counts, never rolled back: N's write stands (PDG14) and the
// next reconcile repairs the descendants.
async function applyDependencyEditTransaction(plan, io = {}) {
  if (!plan || plan.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: (plan && plan.reason) || "plan-failed",
    });
  }
  const prepare =
    typeof io.prepareTargetFile === "function"
      ? io.prepareTargetFile
      : async () => ({ ok: true });
  for (const preparation of plan.preparations || []) {
    let result = null;
    try {
      result = await prepare(preparation.path, preparation);
    } catch (_error) {
      result = { ok: false, reason: "target-preparation-threw" };
    }
    if (!result || result.ok !== true) {
      return Object.freeze({
        ok: false,
        reason: (result && result.reason) || "target-preparation-failed",
      });
    }
  }
  let subtreePass = null;
  if (typeof io.planSubtreePass === "function") {
    try {
      subtreePass = await io.planSubtreePass(plan);
    } catch (_error) {
      subtreePass = null;
    }
  }
  const commit =
    typeof io.commitDependentContent === "function"
      ? io.commitDependentContent
      : () => ({ ok: false, reason: "no-commit" });
  let committed = null;
  try {
    committed = commit(plan.nextContent, plan);
  } catch (_error) {
    committed = { ok: false, reason: "commit-threw" };
  }
  if (!committed || committed.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: (committed && committed.reason) || "commit-failed",
      subtree: null,
    });
  }
  let blocks = Object.freeze({ ok: true, failed: Object.freeze([]) });
  if (typeof io.applyBlocksFollowUps === "function") {
    try {
      blocks = await io.applyBlocksFollowUps(plan.blocksFollowUps || []);
    } catch (_error) {
      blocks = Object.freeze({
        ok: false,
        failed: Object.freeze((plan.blocksFollowUps || []).map((entry) => entry.path)),
      });
    }
  }
  let subtree = null;
  if (subtreePass && typeof io.writeSubtreePass === "function") {
    try {
      subtree = await io.writeSubtreePass(subtreePass);
    } catch (_error) {
      subtree = null;
    }
  }
  return Object.freeze({ ok: true, reason: null, notice: plan.notice, subtree, blocks });
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildMultiDependencyNotice(details = {}) {
  const added = Math.max(0, Math.floor(numericOrDefault(details.added, 0)));
  const removed = Math.max(0, Math.floor(numericOrDefault(details.removed, 0)));
  const navigationAdded = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationAdded, 0)),
  );
  const navigationRemoved = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationRemoved, 0)),
  );
  const navigationUpdated = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationUpdated, 0)),
  );
  const navigationConsolidated = Math.max(
    0,
    Math.floor(numericOrDefault(details.navigationConsolidated, 0)),
  );
  const skippedStale = Math.max(
    0,
    Math.floor(numericOrDefault(details.skippedStale, 0)),
  );
  const skippedOther = Math.max(
    0,
    Math.floor(numericOrDefault(details.skippedOther, 0)),
  );
  const parts = [];

  if (added > 0) {
    parts.push(
      `Linked ${formatCountLabel(added, "dependency", "dependencies")}`,
    );
  }
  if (removed > 0) {
    parts.push(
      `Unlinked ${formatCountLabel(removed, "dependency", "dependencies")}`,
    );
  }

  const navigationParts = [];
  if (navigationAdded > 0) {
    navigationParts.push(`added ${formatCountLabel(navigationAdded, "link")}`);
  }
  if (navigationRemoved > 0) {
    navigationParts.push(
      `removed ${formatCountLabel(navigationRemoved, "link")}`,
    );
  }
  if (navigationUpdated > 0) {
    navigationParts.push(
      `updated ${formatCountLabel(navigationUpdated, "bullet")}`,
    );
  }
  if (navigationConsolidated > 0) {
    navigationParts.push(
      `consolidated ${formatCountLabel(navigationConsolidated, "task")}`,
    );
  }
  if (navigationParts.length > 0) {
    parts.push(`Navigation ${navigationParts.join(", ")}`);
  }

  if (skippedStale > 0) {
    parts.push(
      `Skipped ${formatCountLabel(
        skippedStale,
        "changed task",
        "changed tasks",
      )}`,
    );
  }
  if (skippedOther > 0) {
    parts.push(
      `Skipped ${formatCountLabel(skippedOther, "task", "tasks")}`,
    );
  }

  return parts.length > 0 ? parts.join("; ") : "No dependency changes";
}

function parseLocalTaskIdList(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function rewriteDependsOnIdsInLine(line, replacements) {
  const mapping = replacements instanceof Map
    ? replacements
    : new Map(Object.entries(replacements || {}));
  if (mapping.size === 0) {
    return String(line || "");
  }
  return String(line || "").replace(
    /\[(\s*dependsOn\s*::)([^\]\n]*)\]/g,
    (field, prefix, value) => {
      let changed = false;
      const nextValue = value
        .split(",")
        .map((segment) => {
          const leading = /^\s*/.exec(segment)[0];
          const trailing = /\s*$/.exec(segment)[0];
          const token = segment.slice(leading.length, segment.length - trailing.length);
          const replacement = mapping.get(token);
          if (!replacement || replacement === token) {
            return segment;
          }
          changed = true;
          return `${leading}${replacement}${trailing}`;
        })
        .join(",");
      return changed ? `[${prefix}${nextValue}]` : field;
    },
  );
}

function rewriteDependsOnIdsInContent(content, replacements) {
  const text = String(content || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lineContexts = getMarkdownLineContexts(text);
  const sourceLines = text.split(/\r?\n/);
  const next = sourceLines
    .map((line, lineIndex) =>
      isObsidianTaskAtLine(text, lineIndex, lineContexts, sourceLines)
        ? rewriteDependsOnIdsInLine(line, replacements)
        : line,
    )
    .join(newline);
  return Object.freeze({ content: next, changed: next !== text });
}

