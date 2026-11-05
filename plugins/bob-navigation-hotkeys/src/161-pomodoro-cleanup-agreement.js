function emptyDeferredPomodoroLinkCleanup(content, unresolvedCount = 0) {
  return Object.freeze({
    content,
    changed: false,
    removedBulletCount: 0,
    removedLinkCount: 0,
    removedTargets: Object.freeze([]),
    removedLineRanges: Object.freeze([]),
    removedEntryCount: 0,
    touchedEntryLines: Object.freeze([]),
    unresolvedCount,
  });
}

async function agreeNavigationPomodoroCleanup(app, dailyPath, cleanup) {
  return await agreeDeferredPomodoroLinkCleanup(
    getNavigationPomodoroThemesApi(app),
    dailyPath,
    cleanup,
  );
}

// Map surviving entry offsets through the cleanup's original-offset edits.
function deferredPomodoroCleanupTouchedEntryLines(offsets, edits, content) {
  return [...new Set((Array.isArray(offsets) ? offsets : []).map((offset) => {
    let nextOffset = offset;
    for (const edit of Array.isArray(edits) ? edits : []) {
      if (edit.end <= offset) {
        nextOffset += edit.replacement.length - (edit.end - edit.start);
      }
    }
    const lineBreaks = String(content || "")
      .slice(0, Math.max(0, nextOffset))
      .match(/\r\n|\n|\r/g);
    return (lineBreaks ? lineBreaks.length : 0) + 1;
  }))].sort((left, right) => left - right);
}

// Agree only surviving open entries changed by a deferred link cleanup.
async function agreeDeferredPomodoroLinkCleanup(api, dailyPath, cleanup) {
  if (
    !cleanup || cleanup.changed !== true || cleanup.agreementApplied === true ||
    !Array.isArray(cleanup.touchedEntryLines) || cleanup.touchedEntryLines.length === 0 ||
    !api || typeof api.agreeLedgerEntries !== "function" ||
    !navigationPomodoroThemeAvailable(api)
  ) return cleanup;
  try {
    const outcome = await api.agreeLedgerEntries({
      content: cleanup.content,
      path: normalizeVaultRelativePath(dailyPath),
      entryLines: cleanup.touchedEntryLines,
    });
    if (!outcome || typeof outcome.content !== "string") return cleanup;
    if (Array.isArray(outcome.unrepaired) && outcome.unrepaired.some(
      (item) => item && item.code === "unknown_link",
    )) return cleanup;
    return Object.freeze({ ...cleanup, content: outcome.content, changed: true, agreementApplied: true });
  } catch (_error) {
    return cleanup;
  }
}
