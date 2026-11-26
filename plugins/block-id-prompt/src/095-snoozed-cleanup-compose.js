// Compose explicit Snoozed-row removal with the existing open-Pomodoro
// cleanup. The row planner runs even when the note has no Pomodoros section.
function composeSnoozedRemovalEdits(pomodoroEdits, snoozedEdits) {
  const pomodoro = (pomodoroEdits || []).map((edit) => ({ ...edit }));
  const snoozed = (snoozedEdits || []).map((edit) => ({ ...edit }));
  const absorbed = new Set();
  for (const insertion of pomodoro) {
    if (insertion.start !== insertion.end) continue;
    const removal = snoozed.find((edit) =>
      edit.start === insertion.start && edit.end > edit.start,
    );
    if (!removal) continue;
    removal.replacement = `${insertion.replacement || ""}${removal.replacement || ""}`;
    absorbed.add(insertion);
  }
  return mergeCoveringEdits([
    ...pomodoro.filter((edit) => !absorbed.has(edit)),
    ...snoozed,
  ]);
}

function planAllOpenPomodoroLinkCleanup(content, options = {}) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const section = findPomodorosSectionRange(lines);
  const ranges = section ? collectAllOpenPomodoroRanges(lines, section) : [];
  const cleanup = section
    ? planPomodoroLinkCleanupForRanges(snapshot, ranges, options)
    : {
        edits: [],
        removedCount: 0,
        removedEntryCount: 0,
        entryEdits: [],
        touchedEntryOffsets: [],
        references: [],
        firstRemoved: null,
      };

  const targetPath = resolvedFilePath(options.targetPath);
  const targetBlockId = normalizeText(options.targetBlockId);
  const snoozed = targetPath && targetBlockId && typeof options.resolveTarget === "function"
    ? snoozeModel.planRemoveRows(snapshot, [snoozeModel.identityKey(targetPath, targetBlockId)], {
        resolveIdentity: (row) => {
          if (!row || row.blockId !== targetBlockId) return null;
          let file = null;
          try {
            file = typeof options.resolveSnoozedTarget === "function"
              ? options.resolveSnoozedTarget(row, options.sourcePath)
              : options.resolveTarget({
                  targetText: row.target,
                  oldId: row.blockId,
                  blockId: row.blockId,
                }, options.sourcePath);
          } catch (_error) {
            file = null;
          }
          return resolvedFilePath(file) === targetPath
            ? snoozeModel.identityKey(targetPath, row.blockId)
            : null;
        },
      })
    : { edits: [], detachedSubtrees: [], removedIdentities: [] };
  const snoozedEdits = (snoozed.edits || []).map((edit) => ({ ...edit }));
  const snoozeSection = snoozeModel.parseSection(snapshot);
  if (snoozeSection) {
    for (const edit of snoozedEdits) {
      if (edit.kind !== "empty-section" || edit.start >= snoozeSection.headerStart) continue;
      const precedingCleanup = (cleanup.edits || []).some((other) =>
        other.end > edit.start && other.start < snoozeSection.headerStart,
      );
      if (precedingCleanup) edit.start = snoozeSection.headerStart;
    }
  }
  const edits = mergeCoveringEdits([...(cleanup.edits || []), ...snoozedEdits])
    .sort((left, right) => left.start - right.start || left.end - right.end);
  if (!validateNonOverlappingEdits(edits)) {
    return {
      section,
      ranges,
      edits: [],
      removedCount: 0,
      removedEntryCount: 0,
      entryEdits: [],
      touchedEntryOffsets: [],
      references: [],
      firstRemoved: null,
      snoozedRemovedCount: 0,
      snoozedRemovedIdentities: [],
      snoozedDetachedSubtrees: [],
      content: snapshot,
      hasChanges: false,
    };
  }
  return {
    section,
    ranges,
    edits,
    removedCount: cleanup.removedCount || 0,
    removedEntryCount: cleanup.removedEntryCount || 0,
    entryEdits: cleanup.entryEdits || [],
    touchedEntryOffsets: cleanup.touchedEntryOffsets || [],
    references: cleanup.references || [],
    firstRemoved: cleanup.firstRemoved || null,
    snoozedRemovedCount: (snoozed.detachedSubtrees || []).length,
    snoozedRemovedIdentities: snoozed.removedIdentities || [],
    snoozedDetachedSubtrees: snoozed.detachedSubtrees || [],
    content: edits.length > 0 ? applyTextEdits(snapshot, edits) : snapshot,
    hasChanges: edits.length > 0,
  };
}
