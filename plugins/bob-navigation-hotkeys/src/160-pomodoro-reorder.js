function renderPomodoroEntryReorderBlock(block, rangeSwap) {
  if (!rangeSwap || !block || !block.entry) {
    return block && Array.isArray(block.lines) ? block.lines : [];
  }
  const renderedLines = Array.isArray(block.lines) ? block.lines.slice() : [];
  if (renderedLines.length === 0) {
    return renderedLines;
  }
  if (block.entry.entryLine === rangeSwap.timedEntryLine) {
    renderedLines[0] = replacePomodoroEntryRangeText(
      renderedLines[0],
      block.entry,
      rangeSwap.placeholderRangeText,
    );
  } else if (block.entry.entryLine === rangeSwap.placeholderEntryLine) {
    renderedLines[0] = replacePomodoroEntryRangeText(
      renderedLines[0],
      block.entry,
      rangeSwap.timedRangeText,
    );
  }
  return renderedLines;
}

// Plan reordering an open future placeholder or the open timed current
// Pomodoro entry. `options.repeat` (Vim count, default 1) is an exact
// distance: the source block moves N positions in `direction` only when the
// requested span is either all open placeholders, or the earliest slot is the
// single open timed entry and every later slot is a placeholder. In the timed
// case, the first slot's exact parenthetical range remains in the first slot
// by exchanging it with the incoming placeholder's exact parenthetical bytes.
// `neighborEntry` is the entry originally occupying the destination slot (the
// adjacent sibling when repeat is 1). Returns a frozen
// `{ valid, error, after, entryLine, movedEntryLine, entry, neighborEntry, direction, repeat }`.
function planPomodoroEntryReorder(content, options = {}) {
  const text = String(content || "");
  const direction = numericOrDefault(options.direction, 1) < 0 ? -1 : 1;
  const repeat = normalizeVimRepeat(options.repeat);
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      entryLine: sourceEntryLine,
      movedEntryLine: null,
      entry: null,
      neighborEntry: null,
      direction,
      repeat,
    });

  const context = findPomodoroEntryContext(text, sourceEntryLine);
  if (!context) {
    return invalid("Place the cursor on a Pomodoro entry");
  }

  const { entries, entry, entryIndex } = context;
  const { lines, lineEnding } = splitMarkdownContent(text);
  const rawLine = String(lines[sourceEntryLine] || "");
  if (
    typeof options.sourceRawLine === "string" &&
    rawLine !== options.sourceRawLine
  ) {
    return invalid("The Pomodoro entry changed before it could be moved");
  }

  if (!isReorderablePomodoroEntry(entry)) {
    return invalid("Only open current or future Pomodoros can be moved");
  }

  const boundaryError = getPomodoroEntryReorderBoundaryError(
    entry,
    entries,
    direction,
    repeat,
  );
  const crossingError = getPomodoroEntryReorderCrossingError(
    entry,
    direction,
    repeat,
  );
  const targetEntryIndex = entryIndex + direction * repeat;
  if (targetEntryIndex < 0 || targetEntryIndex >= entries.length) {
    return invalid(boundaryError);
  }

  const neighborEntry = entries[targetEntryIndex];
  const startIndex = Math.min(entryIndex, targetEntryIndex);
  const endIndex = Math.max(entryIndex, targetEntryIndex);
  const spanEntries = entries.slice(startIndex, endIndex + 1);
  const timedEntryIndexes = [];
  for (let index = 0; index < spanEntries.length; index += 1) {
    const spanEntry = spanEntries[index];
    if (isOpenTimedPomodoroEntry(spanEntry)) {
      timedEntryIndexes.push(index);
    } else if (!isOpenPlaceholderPomodoroEntry(spanEntry)) {
      return invalid(crossingError);
    }
  }
  const hasTimedEntry = timedEntryIndexes.length > 0;
  const timedSpanIsLegal =
    timedEntryIndexes.length === 1 &&
    timedEntryIndexes[0] === 0 &&
    ((direction > 0 && spanEntries[0].entryLine === entry.entryLine) ||
      (direction < 0 && neighborEntry.entryLine === spanEntries[0].entryLine));
  if (hasTimedEntry && !timedSpanIsLegal) {
    return invalid(crossingError);
  }

  const blocks = spanEntries.map((spanEntry) =>
    Object.freeze({
      entry: spanEntry,
      lines: lines.slice(spanEntry.entryLine, spanEntry.childEndLineExclusive),
      isSource: spanEntry.entryLine === entry.entryLine,
    }),
  );
  const gaps = [];
  for (let index = 0; index < spanEntries.length - 1; index += 1) {
    gaps.push(
      lines.slice(
        spanEntries[index].childEndLineExclusive,
        spanEntries[index + 1].entryLine,
      ),
    );
  }

  // Down rotates [source, next1, ..., nextN] left; up rotates
  // [prevN, ..., prev1, source] right. Gaps stay in their physical slots.
  const rotated =
    direction > 0
      ? blocks.slice(1).concat(blocks[0])
      : [blocks[blocks.length - 1], ...blocks.slice(0, -1)];
  const rangeSwap = timedSpanIsLegal
    ? getPomodoroEntryReorderRangeSwap(spanEntries, entry, direction)
    : null;

  const spanStartLine = spanEntries[0].entryLine;
  const spanEndLineExclusive =
    spanEntries[spanEntries.length - 1].childEndLineExclusive;
  const rendered = [];
  let movedEntryLine = null;
  let currentLine = spanStartLine;
  for (let index = 0; index < rotated.length; index += 1) {
    if (rotated[index].isSource) {
      movedEntryLine = currentLine;
    }
    const blockLines = renderPomodoroEntryReorderBlock(rotated[index], rangeSwap);
    rendered.push(...blockLines);
    currentLine += blockLines.length;
    if (index < gaps.length) {
      rendered.push(...gaps[index]);
      currentLine += gaps[index].length;
    }
  }

  const nextLines = [
    ...lines.slice(0, spanStartLine),
    ...rendered,
    ...lines.slice(spanEndLineExclusive),
  ];

  return Object.freeze({
    valid: true,
    error: null,
    after: nextLines.join(lineEnding),
    entryLine: sourceEntryLine,
    movedEntryLine,
    entry,
    neighborEntry,
    direction,
    repeat,
  });
}

function getPomodoroEntryRangeLabel(entry) {
  const rangeText = String((entry && entry.rangeText) || "");
  if (!rangeText || POMODORO_PLACEHOLDER_RE.test(rangeText)) {
    return "Unscheduled";
  }

  let match = POMODORO_COLON_TIME_RANGE_RE.exec(rangeText);
  if (match && match.index === 0) {
    return `${match[2]}:${match[3]}-${match[4]}:${match[5]}`;
  }
  match = POMODORO_COMPACT_TIME_RANGE_RE.exec(rangeText);
  if (match && match.index === 0) {
    return `${match[2]}${match[3]}-${match[4]}${match[5]}`;
  }
  return rangeText;
}

function getNormalizedPomodoroEntryName(entry) {
  if (!entry || !entry.name) {
    return "";
  }
  const normalized = normalizePomodoroName(entry.name);
  return normalized.valid ? normalized.name : String(entry.name).trim();
}

function getPomodoroBulletMoveDestinationLabel(entry) {
  const name = getNormalizedPomodoroEntryName(entry);
  return name || `Pomodoro #${entry && entry.position}`;
}

function getPomodoroBulletMovePickerTitle(entry) {
  const name = getNormalizedPomodoroEntryName(entry);
  if (name) {
    return name;
  }
  const rangeLabel = getPomodoroEntryRangeLabel(entry);
  return rangeLabel === "Unscheduled"
    ? `Pomodoro #${entry && entry.position}`
    : rangeLabel;
}

function getPomodoroBulletMovePickerStatusLabel(entry) {
  const name = getNormalizedPomodoroEntryName(entry);
  const rangeLabel = getPomodoroEntryRangeLabel(entry);
  if (name) {
    return rangeLabel;
  }
  return rangeLabel === "Unscheduled" ? "Unscheduled" : "";
}

function getPomodoroBulletMovePickerMeta(entry) {
  const previewText = String((entry && entry.previewText) || "").trim();
  if (!previewText) {
    return "No sub-bullets yet";
  }
  const moreCount = Math.max(
    0,
    Math.floor(numericOrDefault(entry && entry.moreCount, 0)),
  );
  return moreCount > 0 ? `${previewText} +${moreCount} more` : previewText;
}

function pomodoroBulletMoveEntryMatchesQuery(entry, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const parts = [
    getNormalizedPomodoroEntryName(entry),
    entry && entry.name,
    entry && entry.rangeText,
    getPomodoroEntryRangeLabel(entry),
    entry && entry.position ? `#${entry.position}` : "",
    entry && entry.position ? String(entry.position) : "",
    entry && entry.previewText,
  ];
  return parts.some((part) =>
    String(part || "").toLowerCase().includes(normalizedQuery),
  );
}

function createPomodoroBulletMovePickerRows(
  entries,
  sourceEntryLine,
  rawQuery,
  options = {},
) {
  const mode = options && options.mode === "entry" ? "entry" : "bullets";
  const allEntries = Array.isArray(entries) ? entries : [];
  const openEntries = allEntries.filter(
    (entry) => entry && entry.open,
  );
  const queryText = String(rawQuery || "").trim();
  const query = queryText.toLowerCase();
  const existingNameEntries =
    mode === "entry"
      ? openEntries.filter((entry) => entry.entryLine !== sourceEntryLine)
      : openEntries;
  const existingNames = new Set(
    existingNameEntries
      .map((entry) => getNormalizedPomodoroEntryName(entry))
      .filter(Boolean),
  );
  const rows = [];

  if (mode === "bullets" && queryText.startsWith("=")) {
    const sourceEntry = allEntries.find(
      (entry) => entry && entry.entryLine === sourceEntryLine,
    );
    const missingSource = (kindLabel) =>
      Object.freeze([
        Object.freeze({
          kind: "invalid",
          statusText: `Source Pomodoro entry could not be found; ${kindLabel} needs a named source`,
        }),
      ]);
    const unnamedSource = (kindLabel) =>
      Object.freeze([
        Object.freeze({
          kind: "invalid",
          statusText: `${kindLabel} needs a named source Pomodoro; type a new name instead`,
        }),
      ]);

    if (queryText === "=") {
      if (!sourceEntry) {
        return missingSource("=");
      }
      if (!sourceEntry.name) {
        return unnamedSource("=");
      }
      const normalized = normalizePomodoroName(sourceEntry.name);
      if (!normalized.valid) {
        return Object.freeze([
          Object.freeze({
            kind: "invalid",
            statusText: `Source Pomodoro name is invalid: ${normalized.error}`,
          }),
        ]);
      }
      return Object.freeze([
        Object.freeze({
          kind: "new",
          name: normalized.name,
          title: `New Pomodoro ${normalized.name}`,
          meta: "Created below the current Pomodoro",
        }),
      ]);
    }

    if (!sourceEntry) {
      return missingSource("=NAME");
    }
    if (!sourceEntry.name) {
      return unnamedSource("=NAME");
    }
    const decomposition = peelPomodoroMergedName(
      sourceEntry.name,
      queryText.slice(1),
    );
    if (!decomposition.valid) {
      return Object.freeze([
        Object.freeze({
          kind: "invalid",
          statusText: decomposition.error,
        }),
      ]);
    }
    const remainingLabel = decomposition.remainingName || "unnamed";
    return Object.freeze([
      Object.freeze({
        kind: "split",
        name: decomposition.splitName,
        remainingName: decomposition.remainingName,
        title: `Split off ${decomposition.splitName}`,
        meta: `Creates a new Pomodoro below; source becomes ${remainingLabel}`,
        badge: "Split",
      }),
    ]);
  }

  if (queryText) {
    const normalized = normalizePomodoroName(queryText);
    if (!normalized.valid) {
      rows.push(
        Object.freeze({
          kind: "invalid",
          statusText: normalized.error,
        }),
      );
    } else if (!existingNames.has(normalized.name) && mode === "entry") {
      rows.push(
        Object.freeze({
          kind: "rename",
          name: normalized.name,
          title: `Rename to ${normalized.name}`,
          meta: "Renames the current Pomodoro",
          badge: "Rename",
        }),
      );
    } else if (!existingNames.has(normalized.name)) {
      rows.push(
        Object.freeze({
          kind: "new",
          name: normalized.name,
          title: `New Pomodoro ${normalized.name}`,
          meta: "Created below the current Pomodoro",
        }),
      );
    }
  }

  for (const entry of openEntries) {
    if (entry.entryLine === sourceEntryLine) {
      continue;
    }
    if (!pomodoroBulletMoveEntryMatchesQuery(entry, query)) {
      continue;
    }
    rows.push(
      Object.freeze({
        kind: "existing",
        entry,
        title: getPomodoroBulletMovePickerTitle(entry),
        meta: getPomodoroBulletMovePickerMeta(entry),
        statusEmoji: "",
        statusLabel: getPomodoroBulletMovePickerStatusLabel(entry),
      }),
    );
  }

  return Object.freeze(rows);
}

function buildPomodoroBulletMoveNotice(plan = {}, discovery = {}, destinationLabel) {
  const fallbackCount =
    Math.max(0, Math.floor(numericOrDefault(plan.movedCount, 0))) +
    Math.max(0, Math.floor(numericOrDefault(plan.skippedDuplicateCount, 0)));
  const count = Math.max(
    0,
    Math.floor(numericOrDefault(discovery.actualCount, fallbackCount)),
  );
  const bulletText = count === 1 ? "bullet" : "bullets";
  let label = String(destinationLabel || "").trim();
  if (plan.createdPomodoro) {
    const name = String(plan.createdPomodoroName || label).trim();
    label = name ? `new Pomodoro ${name}` : "new Pomodoro";
  }
  if (!label) {
    label = "Pomodoro destination";
  }

  let text = `Moved ${count} ${bulletText} to ${label}`;
  const duplicateCount = Math.max(
    0,
    Math.floor(numericOrDefault(plan.skippedDuplicateCount, 0)),
  );
  if (duplicateCount > 0) {
    text += ` (merged ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"})`;
  }
  if (discovery && discovery.clamped) {
    text += ` (requested ${discovery.requestedCount}; reached end of Pomodoro)`;
  }
  return text;
}

// Notice text for a whole-entry Pomodoro move-and-delete: "Moved N bullets
// from Pomodoro #P to LABEL", with a merged-duplicate suffix, or "Deleted
// empty Pomodoro #P" when nothing moved and nothing merged.
function buildPomodoroEntryMoveNotice(plan = {}, discovery = {}, destinationLabel) {
  const movedCount = Math.max(
    0,
    Math.floor(numericOrDefault(plan.movedCount, 0)),
  );
  const duplicateCount = Math.max(
    0,
    Math.floor(numericOrDefault(plan.skippedDuplicateCount, 0)),
  );
  const sourcePosition =
    discovery && discovery.entry && discovery.entry.position
      ? discovery.entry.position
      : "?";

  if (movedCount === 0 && duplicateCount === 0) {
    return `Deleted empty Pomodoro #${sourcePosition}`;
  }

  const bulletText = movedCount === 1 ? "bullet" : "bullets";
  const label = String(destinationLabel || "").trim() || "Pomodoro destination";
  let text = `Moved ${movedCount} ${bulletText} from Pomodoro #${sourcePosition} to ${label}`;
  if (duplicateCount > 0) {
    text += ` (merged ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"})`;
  }
  return text;
}

function buildPomodoroEntryMergeNotice(plan = {}) {
  const absorbedLabel =
    String(plan.absorbedName || "").trim() ||
    `Pomodoro #${plan.absorbedPosition || "?"}`;
  const survivorLabel =
    String(plan.finalName || plan.survivorName || "").trim() ||
    `Pomodoro #${plan.survivorPosition || "?"}`;
  return `Merged ${absorbedLabel} into ${survivorLabel}`;
}

function buildPomodoroBulletSplitNotice(plan = {}, discovery = {}) {
  const fallbackCount = Math.max(
    0,
    Math.floor(numericOrDefault(plan.movedCount, 0)),
  );
  const count = Math.max(
    0,
    Math.floor(numericOrDefault(discovery.actualCount, fallbackCount)),
  );
  const bulletText = count === 1 ? "bullet" : "bullets";
  const splitName = String(plan.splitName || "").trim() || "Pomodoro";
  const remainingName =
    String(plan.remainingName || "").trim() || "unnamed Pomodoro";
  let text = `Split ${count} ${bulletText} into new Pomodoro ${splitName}; source is now ${remainingName}`;
  if (discovery && discovery.clamped) {
    text += ` (requested ${discovery.requestedCount}; reached end of Pomodoro)`;
  }
  return text;
}

// Resolve `{ path, blockId }` deferred-pomodoro targets from a set of task
// line numbers (as produced by the writers below). A line with no trailing
// `^block-id` cannot be linked from a Pomodoro sub-bullet, so it contributes
// nothing.
function deferredPomodoroTargetsFromLines(sourcePath, lines, lineNumbers) {
  const path = normalizeVaultRelativePath(sourcePath);
  const sourceLines = Array.isArray(lines) ? lines : [];
  const targets = [];
  for (const lineNumber of Array.isArray(lineNumbers) ? lineNumbers : []) {
    const blockId = getTrailingBlockId(String(sourceLines[lineNumber] || ""));
    if (blockId) {
      targets.push(Object.freeze({ path, blockId }));
    }
  }
  return Object.freeze(targets);
}

function emptyDeferredPomodoroLinkCleanup(content, unresolvedCount = 0) {
  return Object.freeze({
    content,
    changed: false,
    removedBulletCount: 0,
    removedLinkCount: 0,
    removedTargets: Object.freeze([]),
    removedLineRanges: Object.freeze([]),
    unresolvedCount,
  });
}

// Plan the removal of every live link (in today's daily note, under an open
// Pomodoro entry) to one of `targets`. `options` carries `dailyPath` (the
// daily note's own vault-relative path, used to resolve a same-note
// `[[#^id]]` link) and `noteIndex` (from `createScheduledRecoveryNoteIndex`,
// used to resolve `[[target#^id]]` links to a vault path). Struck links and
// links under a closed/cancelled entry are never candidates. A dedicated link
// bullet (the link, its marker, and nothing else) is removed subtree and all;
// otherwise only the matched token is removed from its bullet.
function planDeferredPomodoroLinkCleanup(dailyContent, targets, options = {}) {
  const snapshot = String(dailyContent || "");
  const targetList = Array.from(targets || []).filter(
    (target) => target && target.path && target.blockId,
  );
  if (targetList.length === 0) {
    return emptyDeferredPomodoroLinkCleanup(snapshot);
  }

  const { lines, lineEnding } = splitMarkdownContent(snapshot);
  const contexts = getMarkdownLineContexts(snapshot);
  const section = findPomodorosSectionRange(snapshot);
  if (!section) {
    return emptyDeferredPomodoroLinkCleanup(snapshot);
  }
  const openRanges = collectOpenPomodoroRanges(lines, contexts, section);
  if (openRanges.length === 0) {
    return emptyDeferredPomodoroLinkCleanup(snapshot);
  }

  const dailyPath = normalizeVaultRelativePath(options.dailyPath);
  const noteIndex = options.noteIndex || null;
  const targetKeys = new Set(
    targetList.map(
      (target) =>
        `${normalizeVaultRelativePath(target.path)}\x00${target.blockId}`,
    ),
  );

  const lineStarts = [];
  let runningOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    lineStarts.push(runningOffset);
    runningOffset += lines[index].length + lineEnding.length;
  }

  const matches = [];
  const removedTargetKeys = new Set();
  let unresolvedCount = 0;

  for (const range of openRanges) {
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      if (contexts[line] && contexts[line].inFence) {
        continue;
      }
      const lineText = String(lines[line] || "");
      const occurrences = collectPomodoroBlockLinkOccurrences(lineText);
      for (const occurrence of occurrences) {
        if (occurrence.struck) {
          continue;
        }
        const resolved = noteIndex
          ? resolveScheduledRecoveryNote(noteIndex, dailyPath, occurrence.target)
          : null;
        if (!resolved) {
          unresolvedCount += 1;
          continue;
        }
        const key = `${resolved}\x00${occurrence.blockId}`;
        if (!targetKeys.has(key)) {
          continue;
        }
        matches.push({
          line,
          lineText,
          occurrence,
          start: lineStarts[line] + occurrence.start,
          end: lineStarts[line] + occurrence.end,
        });
        removedTargetKeys.add(key);
      }
    }
  }

  if (matches.length === 0) {
    return emptyDeferredPomodoroLinkCleanup(snapshot, unresolvedCount);
  }

  const matchesByLine = new Map();
  for (const match of matches) {
    if (!matchesByLine.has(match.line)) {
      matchesByLine.set(match.line, []);
    }
    matchesByLine.get(match.line).push(match);
  }

  const subtreeCandidates = [];
  for (const [line, lineMatches] of matchesByLine) {
    if (
      !isDedicatedPomodoroLinkLine(
        lineMatches[0].lineText,
        lineMatches.map((entry) => entry.occurrence),
      )
    ) {
      continue;
    }
    const block = findCurrentBulletChildBlock(lines, line);
    const end =
      block.endLineExclusive < lines.length
        ? lineStarts[block.endLineExclusive]
        : snapshot.length;
    subtreeCandidates.push({
      start: lineStarts[line],
      end,
      replacement: "",
      startLine: line,
      endLineExclusive: block.endLineExclusive,
    });
  }
  subtreeCandidates.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );

  // Merge overlapping or contained candidates into one edit (adjacent
  // dedicated bullets can overlap once the EOF adjustment below is applied).
  const subtreeEdits = [];
  for (const candidate of subtreeCandidates) {
    const last = subtreeEdits[subtreeEdits.length - 1];
    if (last && candidate.start <= last.end) {
      last.end = Math.max(last.end, candidate.end);
      last.endLineExclusive = Math.max(
        last.endLineExclusive,
        candidate.endLineExclusive,
      );
      continue;
    }
    subtreeEdits.push({ ...candidate });
  }

  // A merged edit reaching EOF removes each deleted line's own trailing
  // separator except the very last one, which has none — so its *leading*
  // separator (the newline ending the line before the run) is removed
  // instead, to avoid leaving a dangling trailing blank line.
  for (const edit of subtreeEdits) {
    if (edit.endLineExclusive >= lines.length && edit.startLine > 0) {
      edit.start -= lineEnding.length;
    }
  }

  const tokenMatches = matches.filter(
    (match) =>
      !subtreeEdits.some(
        (edit) => edit.start <= match.start && edit.end >= match.end,
      ),
  );
  const tokenMatchesByLine = new Map();
  for (const match of tokenMatches) {
    if (!tokenMatchesByLine.has(match.line)) {
      tokenMatchesByLine.set(match.line, []);
    }
    tokenMatchesByLine.get(match.line).push(match);
  }

  const lineEdits = [];
  for (const [line, lineMatches] of tokenMatchesByLine) {
    const lineStart = lineStarts[line];
    const lineText = String(lines[line] || "");
    let nextLine = lineText;
    const sorted = lineMatches
      .slice()
      .sort((left, right) => right.occurrence.start - left.occurrence.start);
    for (const match of sorted) {
      nextLine =
        nextLine.slice(0, match.occurrence.start) +
        nextLine.slice(match.occurrence.end);
    }
    // Collapse and trim only the bullet's body — the leading indent and list
    // marker must survive untouched even when they happen to contain runs of
    // spaces (e.g. a wide indent).
    const prefixLength = (PROJECT_LIST_ITEM_RE.exec(nextLine) || [""])[0].length;
    nextLine =
      nextLine.slice(0, prefixLength) +
      nextLine
        .slice(prefixLength)
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+$/, "");
    lineEdits.push({
      start: lineStart,
      end: lineStart + lineText.length,
      replacement: nextLine,
    });
  }

  const edits = [...subtreeEdits, ...lineEdits].sort(
    (left, right) => right.start - left.start,
  );
  let nextContent = snapshot;
  for (const edit of edits) {
    nextContent =
      nextContent.slice(0, edit.start) +
      edit.replacement +
      nextContent.slice(edit.end);
  }

  return Object.freeze({
    content: nextContent,
    changed: nextContent !== snapshot,
    // Counts dedicated bullets found, not text-splice operations — adjacent
    // dedicated bullets can merge into one contiguous edit above.
    removedBulletCount: subtreeCandidates.length,
    removedLinkCount: matches.length,
    removedTargets: Object.freeze(
      targetList.filter((target) =>
        removedTargetKeys.has(
          `${normalizeVaultRelativePath(target.path)}\x00${target.blockId}`,
        ),
      ),
    ),
    removedLineRanges: Object.freeze(
      subtreeEdits.map((edit) =>
        Object.freeze({
          startLine: edit.startLine,
          endLineExclusive: edit.endLineExclusive,
        }),
      ),
    ),
    unresolvedCount,
  });
}

// Zero-based line indices of every open `#task` line, skipping leading
// frontmatter and fenced code blocks with the same state machine used for
// section headers so task-shaped lines inside YAML, examples, and `tasks`
// query blocks are ignored.
function getOpenObsidianTaskLines(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const taskLines = [];
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
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

    if (isOpenObsidianTaskLine(line)) {
      taskLines.push(lineIndex);
    }
  }

  return taskLines;
}

// Zero-based line indices of every open-task navigation target: Ready, In
// Progress, and Next `#task` lines anywhere in the note (Blocked `[?]` stays
// open for dependency/scheduling workflows but is not a jump target) plus
// open or done top-level Pomodoro ledger lines inside a `## Pomodoros`
// section. Leading frontmatter and fenced code blocks are skipped with the
// same state machine used for the proper-task scanner, so task-shaped lines
// inside YAML, examples, and `tasks` query blocks are ignored. A line that
// qualifies as both a `#task` and a Pomodoro is added once, and indices are
// returned in ascending file order.
function getOpenTaskNavigationLines(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const taskLines = [];
  let lineIndex = 0;
  let inFrontmatter = false;
  let inFence = null;
  let inPomodorosSection = false;

  if (startsWithFrontmatter(sourceLines)) {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");

    if (inFrontmatter) {
      if (FRONTMATTER_DELIMITER_RE.test(line)) {
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

    // Any unfenced level-two heading ends a prior `## Pomodoros` section; a
    // `## Pomodoros` heading (re)opens one. The heading line itself is never a
    // task or top-level checkbox, so it is not added below.
    if (isLevelTwoHeading(line)) {
      inPomodorosSection = isPomodorosHeading(line);
    }

    if (isActiveObsidianTaskNavigationLine(line)) {
      taskLines.push(lineIndex);
    } else if (inPomodorosSection && isPomodoroNavigationTaskLine(line)) {
      taskLines.push(lineIndex);
    }
  }

  return taskLines;
}

// Circular open-task navigation: jump to the nearest navigation target
// (Ready/In Progress/Next `#task` line or open/done Pomodoro ledger line) in
// the given direction, wrapping across the file boundary when there is no
// strict neighbour. An optional `repeat` (Vim count, default 1) then advances
// another `repeat - 1` eligible targets in the same direction, modulo the
// target list, so a count can wrap once or many times without rescanning.
// Returns null only when there are no matching targets, or when the sole
// matching target is already on the cursor line (so the caller can show its
// no-target notice and leave the editor untouched).
