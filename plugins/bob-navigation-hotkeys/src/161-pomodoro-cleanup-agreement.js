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

// Resolve `{ path, blockId }` deferred-pomodoro targets from task line
// numbers. A line without a trailing block id cannot be linked.
function deferredPomodoroTargetsFromLines(sourcePath, lines, lineNumbers) {
  const path = normalizeVaultRelativePath(sourcePath);
  const targets = [];
  for (const lineNumber of Array.isArray(lineNumbers) ? lineNumbers : []) {
    const blockId = getTrailingBlockId(String((lines || [])[lineNumber] || ""));
    if (blockId) targets.push(Object.freeze({ path, blockId }));
  }
  return Object.freeze(targets);
}

// Return replacement text only for a dedicated link bullet with authored
// child list items; other consumed bullets retain the ordinary cleanup path.
function deferredPomodoroPreservedNoteReplacement(
  lines,
  contexts,
  lineMatches,
  block,
  targets,
  keepNotes,
) {
  if (keepNotes !== true) return null;
  const parentIndent = getBulletIndentWidth(lineMatches[0].lineText);
  let hasChildNotes = false;
  for (
    let childLine = block.startLine;
    childLine < block.endLineExclusive;
    childLine += 1
  ) {
    const text = String(lines[childLine] || "");
    if (
      !contexts[childLine]?.inFence &&
      PROJECT_LIST_ITEM_RE.test(text) &&
      getBulletIndentWidth(text) > parentIndent
    ) {
      hasChildNotes = true;
      break;
    }
  }
  if (!hasChildNotes) return null;
  const displayText = (match) => {
    const target = targets.find((entry) =>
      `${normalizeVaultRelativePath(entry.path)}\x00${entry.blockId}` ===
      match.targetKey,
    );
    return String((target && target.displayText) || "").trim();
  };
  const names = [...new Set(lineMatches.map(displayText).filter(Boolean))];
  const prefix = (PROJECT_LIST_ITEM_RE.exec(lineMatches[0].lineText) || [""])[0];
  const fallback = `^${lineMatches[0].occurrence.blockId}`;
  return `${prefix}${names.length ? names.join(" · ") : fallback}`;
}

function deferredPomodoroPreservedNoteLineEdits(noteLines, lines, lineStarts) {
  return [...noteLines].map(([line, replacement]) => ({
    start: lineStarts[line],
    end: lineStarts[line] + String(lines[line] || "").length,
    replacement,
  }));
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
