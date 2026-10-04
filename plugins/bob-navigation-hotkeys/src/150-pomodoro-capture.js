function capturePomodoroBulletSubtree(lines, targetLine, boundExclusive) {
  const rootWidth = getBulletIndentWidth(String(lines[targetLine] || ""));
  let endLineExclusive = targetLine + 1;
  let pendingBlankEnd = endLineExclusive;
  for (let index = targetLine + 1; index < boundExclusive; index += 1) {
    const candidate = String(lines[index] || "");
    if (candidate.trim() === "") {
      pendingBlankEnd = index + 1;
      continue;
    }
    if (getBulletIndentWidth(candidate) <= rootWidth) {
      break;
    }
    endLineExclusive = index + 1;
    pendingBlankEnd = endLineExclusive;
  }
  return Object.freeze({
    startLine: targetLine,
    endLineExclusive,
    lines: Object.freeze(lines.slice(targetLine, endLineExclusive)),
    root: parseTaskMoveListItem(String(lines[targetLine] || "")),
  });
}

// Remove a set of non-overlapping captured Pomodoro bullet ranges from
// `lines`, collapsing a doubled blank seam exactly as removeTaskMoveRanges
// does. Returns a new line array.
function removePomodoroBulletRanges(lines, ranges) {
  const nextLines = lines.slice();
  const ordered = (Array.isArray(ranges) ? ranges : [])
    .slice()
    .sort((left, right) => right.startLine - left.startLine);
  for (const range of ordered) {
    let deleteCount = range.endLineExclusive - range.startLine;
    const before = nextLines[range.startLine - 1];
    const after = nextLines[range.endLineExclusive];
    if (
      before !== undefined &&
      after !== undefined &&
      String(before).trim() === "" &&
      String(after).trim() === ""
    ) {
      deleteCount += 1;
    }
    nextLines.splice(range.startLine, deleteCount);
  }
  return nextLines;
}

// Rebase a captured Pomodoro bullet block onto a destination child indent:
// reuse rebaseTaskMoveBlock's column-0 stripping, then re-prefix every
// non-blank line with the destination's child indent instead of column 0.
function rebasePomodoroBulletBlock(block, destinationChildIndent) {
  const indent =
    typeof destinationChildIndent === "string" ? destinationChildIndent : "";
  return Object.freeze(
    rebaseTaskMoveBlock(block).map((line) => (line === "" ? "" : `${indent}${line}`)),
  );
}

// Plan a pure, same-file move of one or more Pomodoro sub-bullets (plus their
// descendants) from `options.sourceEntryLine`'s child block into another
// entry, or into a brand-new named entry. The new entry lands just below the
// source when the source survives, or at the source's former position when
// moving out its last owned content deletes the source entry. See the epic
// plan's "Insertion", "Source deletion", and "Duplicate merging" design
// decisions for the algorithm this mirrors.
function planPomodoroBulletMove(content, options = {}) {
  const text = String(content || "");
  const { lines: originalLines, lineEnding } = splitMarkdownContent(text);
  const scope = options.scope === "entry" ? "entry" : "bullets";
  const targets = Array.isArray(options.targets) ? options.targets : [];
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;
  const preserveDuplicates = options.preserveDuplicates === true;
  const preserveSourceEntry = options.preserveSourceEntry === true;
  const destination =
    options.destination && typeof options.destination === "object"
      ? options.destination
      : {};

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      destinationEntryLine: null,
      firstMovedLine: null,
      movedCount: 0,
      skippedDuplicateCount: 0,
      createdPomodoro: false,
      createdPomodoroName: null,
      sourcePomodoroDeleted: false,
    });

  if (targets.length === 0 && scope !== "entry") {
    return invalid("No Pomodoro bullets were selected");
  }
  for (const target of targets) {
    if (String(originalLines[target.line] || "") !== target.rawLine) {
      return invalid("A selected bullet changed before it could be moved");
    }
  }
  if (
    scope === "entry" &&
    typeof options.sourceRawLine === "string" &&
    String(originalLines[sourceEntryLine] || "") !== options.sourceRawLine
  ) {
    return invalid("The Pomodoro entry changed before it could be moved");
  }

  const { entries } = collectPomodoroEntries(text);
  const sourceEntry = entries.find(
    (entry) => entry.entryLine === sourceEntryLine,
  );
  if (!sourceEntry) {
    return invalid("Source Pomodoro entry could not be found");
  }

  let createdPomodoroName = null;
  if (destination.kind === "existing") {
    if (destination.entryLine === sourceEntryLine) {
      return invalid("Choose a different Pomodoro to move into");
    }
    const destinationExists = entries.some(
      (entry) => entry.entryLine === destination.entryLine,
    );
    if (!destinationExists) {
      return invalid("Destination Pomodoro entry could not be found");
    }
  } else if (destination.kind === "new" && scope !== "entry") {
    const nameResult = normalizePomodoroName(destination.name);
    if (!nameResult.valid) {
      return invalid(nameResult.error);
    }
    createdPomodoroName = nameResult.name;
  } else {
    return invalid("Choose a Pomodoro destination");
  }

  // Capture each target's subtree against the source entry's original child
  // bounds, then remove the captured ranges from the document.
  const orderedTargets = targets.slice().sort((left, right) => left.line - right.line);
  const capturedBlocks = orderedTargets.map((target) =>
    capturePomodoroBulletSubtree(
      originalLines,
      target.line,
      sourceEntry.childEndLineExclusive,
    ),
  );
  const afterRemovalLines = removePomodoroBulletRanges(
    originalLines,
    capturedBlocks,
  );

  // Delete the source entry entirely when nothing it owns survives the
  // removal; otherwise leave it untouched.
  const sourceBlockAfterRemoval = findCurrentBulletChildBlock(
    afterRemovalLines,
    sourceEntry.entryLine,
  );
  let sourceChildIsBlank = true;
  for (
    let index = sourceBlockAfterRemoval.startLine;
    index < sourceBlockAfterRemoval.endLineExclusive;
    index += 1
  ) {
    if (String(afterRemovalLines[index] || "").trim() !== "") {
      sourceChildIsBlank = false;
      break;
    }
  }
  if (scope === "entry") {
    // No-silent-loss guard: every non-blank line in the source entry's
    // original child block must be covered by a captured target subtree or
    // be one of the discovery's dropped placeholder lines. Anything else
    // (an indented continuation, a stray note, a nested list under no
    // bullet) blocks the force-delete rather than destroying unmoved
    // content.
    const coveredLines = new Set();
    for (const block of capturedBlocks) {
      for (
        let index = block.startLine;
        index < block.endLineExclusive;
        index += 1
      ) {
        coveredLines.add(index);
      }
    }
    const entryDiscovery = discoverPomodoroEntryMoveTargets(
      text,
      sourceEntry.entryLine,
    );
    if (entryDiscovery.valid) {
      for (const dropped of entryDiscovery.droppedLines) {
        coveredLines.add(dropped.line);
      }
    }
    for (
      let index = sourceEntry.childStartLine;
      index < sourceEntry.childEndLineExclusive;
      index += 1
    ) {
      if (coveredLines.has(index)) {
        continue;
      }
      if (String(originalLines[index] || "").trim() !== "") {
        return invalid(
          "Pomodoro has content that cannot be moved; nothing was moved",
        );
      }
    }
  }

  let workingLines = afterRemovalLines;
  let sourcePomodoroDeleted = false;
  let sourceAnchorLine = null;
  if (!preserveSourceEntry && (scope === "entry" || sourceChildIsBlank)) {
    workingLines = removePomodoroBulletRanges(afterRemovalLines, [
      {
        startLine: sourceEntry.entryLine,
        endLineExclusive: sourceBlockAfterRemoval.endLineExclusive,
      },
    ]);
    sourcePomodoroDeleted = true;
    sourceAnchorLine = sourceEntry.entryLine;
  }

  // Re-locate the destination (and, for an existing destination, the source)
  // against the repaired content: mutations so far are confined to the
  // source entry's own child block, so any entry at or before the source
  // entry's line is unaffected, and any entry after it shifts by the net
  // line-count delta.
  const repairedContent = workingLines.join(lineEnding);
  const { entries: repairedEntries } = collectPomodoroEntries(repairedContent);
  const lineDelta = workingLines.length - originalLines.length;
  const shiftLine = (originalLine) =>
    originalLine > sourceEntry.entryLine ? originalLine + lineDelta : originalLine;

  let destEntry = null;
  if (destination.kind === "existing") {
    const shiftedDestinationEntryLine = shiftLine(destination.entryLine);
    destEntry = repairedEntries.find(
      (entry) => entry.entryLine === shiftedDestinationEntryLine,
    );
    if (!destEntry) {
      return invalid("Destination Pomodoro entry could not be found");
    }
  }
  const destinationChildIndent = destEntry ? destEntry.childIndent : "\t";

  // Rebase every captured block onto the destination child indent.
  const rebasedBlocks = capturedBlocks.map((block) => ({
    block,
    rebasedLines: rebasePomodoroBulletBlock(block, destinationChildIndent),
  }));

  // Drop exact-duplicate single-line blocks against the destination's
  // existing (pre-insertion) child lines.
  const existingChildTrimmed = new Set();
  if (destEntry) {
    for (
      let index = destEntry.childStartLine;
      index < destEntry.childEndLineExclusive;
      index += 1
    ) {
      const trimmed = String(workingLines[index] || "").trim();
      if (trimmed !== "") {
        existingChildTrimmed.add(trimmed);
      }
    }
  }

  let skippedDuplicateCount = 0;
  const insertedBlocks = [];
  for (const { block, rebasedLines } of rebasedBlocks) {
    const isSingleLine = block.endLineExclusive - block.startLine === 1;
    const trimmed = rebasedLines.length > 0 ? rebasedLines[0].trim() : "";
    if (!preserveDuplicates && isSingleLine && existingChildTrimmed.has(trimmed)) {
      skippedDuplicateCount += 1;
      continue;
    }
    insertedBlocks.push(rebasedLines);
  }
  const flatInserted = insertedBlocks.flat();

  // Insert the surviving blocks: into the existing destination's child
  // block, or below a brand-new entry created after the source's block.
  let finalLines;
  let destinationEntryLineFinal;
  let firstMovedLine = null;
  let createdPomodoro = false;

  if (destEntry) {
    const isLonePlaceholder =
      destEntry.childEndLineExclusive - destEntry.childStartLine === 1 &&
      PROJECT_LIST_ITEM_RE.test(
        String(workingLines[destEntry.childStartLine] || ""),
      ) &&
      !pomodoroBulletBodyBounds(
        String(workingLines[destEntry.childStartLine] || ""),
      );

    if (isLonePlaceholder && flatInserted.length > 0) {
      finalLines = workingLines
        .slice(0, destEntry.childStartLine)
        .concat(flatInserted, workingLines.slice(destEntry.childStartLine + 1));
      firstMovedLine = destEntry.childStartLine;
    } else if (isLonePlaceholder) {
      // Every moved block merged away as an exact duplicate of the
      // placeholder itself; leave the destination's placeholder in place
      // rather than deleting its only child line.
      finalLines = workingLines;
    } else {
      let insertAt = destEntry.childStartLine;
      for (
        let index = destEntry.childEndLineExclusive - 1;
        index >= destEntry.childStartLine;
        index -= 1
      ) {
        if (String(workingLines[index] || "").trim() !== "") {
          insertAt = index + 1;
          break;
        }
      }
      finalLines = workingLines
        .slice(0, insertAt)
        .concat(flatInserted, workingLines.slice(insertAt));
      if (flatInserted.length > 0) {
        firstMovedLine = insertAt;
      }
    }
    destinationEntryLineFinal = destEntry.entryLine;
  } else {
    // A deleted source has no surviving entry to anchor against: insert the
    // new entry at the deleted source's former position instead of below it.
    let insertAt;
    if (sourcePomodoroDeleted) {
      insertAt = sourceAnchorLine;
    } else {
      const repairedSourceEntry = repairedEntries.find(
        (entry) => entry.entryLine === sourceEntry.entryLine,
      );
      insertAt = repairedSourceEntry.childEndLineExclusive;
    }
    const insertion = [formatPomodoroEntryLine(createdPomodoroName), ...flatInserted];
    finalLines = workingLines
      .slice(0, insertAt)
      .concat(insertion, workingLines.slice(insertAt));
    destinationEntryLineFinal = insertAt;
    firstMovedLine = insertAt + 1;
    createdPomodoro = true;
  }

  if (firstMovedLine === null) {
    firstMovedLine = destinationEntryLineFinal;
  }

  return Object.freeze({
    valid: true,
    error: null,
    after: finalLines.join(lineEnding),
    destinationEntryLine: destinationEntryLineFinal,
    firstMovedLine,
    movedCount: insertedBlocks.length,
    skippedDuplicateCount,
    createdPomodoro,
    createdPomodoroName,
    sourcePomodoroDeleted,
  });
}

// Plan a pure rename of a Pomodoro entry's name suffix in place. Never
// touches the checkbox status or the parenthetical body; only the text after
// the parenthetical changes. Returns a frozen
// `{ valid, error, after, entryLine, name, previousName, unchanged }`.
function planPomodoroEntryRename(content, options = {}) {
  const text = String(content || "");
  const { lines: originalLines, lineEnding } = splitMarkdownContent(text);
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      entryLine: sourceEntryLine,
      name: null,
      previousName: null,
      unchanged: false,
    });

  const nameResult = normalizePomodoroName(options.name);
  if (!nameResult.valid) {
    return invalid(nameResult.error);
  }

  const rawLine = String(originalLines[sourceEntryLine] || "");
  if (
    typeof options.sourceRawLine === "string" &&
    rawLine !== options.sourceRawLine
  ) {
    return invalid("The Pomodoro entry changed before it could be moved");
  }

  const parsed = parsePomodoroEntryLine(rawLine);
  if (!parsed) {
    return invalid("Source Pomodoro entry could not be found");
  }

  if (parsed.name === null && rawLine.slice(parsed.rangeEnd).trim() !== "") {
    return invalid(
      "Pomodoro entry has unsupported trailing content; rename it by hand",
    );
  }

  const previousName = getNormalizedPomodoroEntryName(parsed);
  if (nameResult.name === previousName) {
    return Object.freeze({
      valid: true,
      error: null,
      after: text,
      entryLine: sourceEntryLine,
      name: nameResult.name,
      previousName,
      unchanged: true,
    });
  }

  const renamedLine =
    rawLine.slice(0, parsed.rangeEnd) +
    ` ${POMODORO_NAME_SEPARATOR} ` +
    nameResult.name;
  const nextLines = originalLines.slice();
  nextLines[sourceEntryLine] = renamedLine;

  return Object.freeze({
    valid: true,
    error: null,
    after: nextLines.join(lineEnding),
    entryLine: sourceEntryLine,
    name: nameResult.name,
    previousName,
    unchanged: false,
  });
}

function planPomodoroBulletSplit(content, options = {}) {
  const text = String(content || "");
  const { lines, lineEnding } = splitMarkdownContent(text);
  const targets = Array.isArray(options.targets) ? options.targets : [];
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      sourceEntryLine,
      sourceEntryLineFinal: null,
      splitEntryLine: null,
      firstMovedLine: null,
      movedCount: 0,
      sourcePosition: null,
      sourceName: null,
      remainingName: null,
      splitName: null,
      sourcePomodoroPreserved: false,
    });

  if (targets.length === 0) {
    return invalid("No Pomodoro bullets were selected");
  }
  for (const target of targets) {
    if (String(lines[target.line] || "") !== target.rawLine) {
      return invalid("A selected bullet changed before it could be split");
    }
  }
  const rawLine = String(lines[sourceEntryLine] || "");
  if (
    typeof options.sourceRawLine === "string" &&
    rawLine !== options.sourceRawLine
  ) {
    return invalid("The source Pomodoro entry changed before it could be split");
  }

  const context = findPomodoroEntryContext(text, sourceEntryLine);
  if (!context) {
    return invalid("Source Pomodoro entry could not be found");
  }

  const parsed = parsePomodoroEntryLine(rawLine);
  if (!parsed) {
    return invalid("Source Pomodoro entry could not be found");
  }
  if (parsed.name === null && rawLine.slice(parsed.rangeEnd).trim() !== "") {
    return invalid(
      "Source Pomodoro entry has unsupported trailing content",
    );
  }

  const decomposition = peelPomodoroMergedName(
    parsed.name || "",
    options.splitName,
  );
  if (!decomposition.valid) {
    return invalid(decomposition.error);
  }

  let renamedContent;
  let renamedRawLine;
  if (!decomposition.remainingName) {
    const nextLines = lines.slice();
    nextLines[sourceEntryLine] = rawLine.slice(0, parsed.rangeEnd);
    renamedContent = nextLines.join(lineEnding);
    renamedRawLine = nextLines[sourceEntryLine];
  } else {
    const renamePlan = planPomodoroEntryRename(text, {
      sourceEntryLine,
      sourceRawLine: rawLine,
      name: decomposition.remainingName,
    });
    if (!renamePlan.valid) {
      return invalid(renamePlan.error);
    }
    renamedContent = renamePlan.after;
    renamedRawLine = String(
      splitMarkdownContent(renamePlan.after).lines[sourceEntryLine] || "",
    );
  }

  const movePlan = planPomodoroBulletMove(renamedContent, {
    targets,
    sourceEntryLine,
    sourceRawLine: renamedRawLine,
    destination: { kind: "new", name: decomposition.splitName },
    preserveDuplicates: true,
    preserveSourceEntry: true,
  });
  if (!movePlan.valid) {
    return invalid(movePlan.error);
  }

  return Object.freeze({
    valid: true,
    error: null,
    after: movePlan.after,
    sourceEntryLine,
    sourceEntryLineFinal: sourceEntryLine,
    splitEntryLine: movePlan.destinationEntryLine,
    firstMovedLine: movePlan.firstMovedLine,
    movedCount: movePlan.movedCount,
    sourcePosition: context.entry.position,
    sourceName: decomposition.sourceName,
    remainingName: decomposition.remainingName,
    splitName: decomposition.splitName,
    sourcePomodoroPreserved: !movePlan.sourcePomodoroDeleted,
  });
}

function getPomodoroEntryMergeName(entry, roleLabel) {
  const rawName = entry && entry.name ? entry.name : "";
  if (!rawName) {
    return Object.freeze({ valid: true, name: "", error: null });
  }
  const normalized = normalizePomodoroName(rawName);
  if (!normalized.valid) {
    return Object.freeze({
      valid: false,
      name: "",
      error: `${roleLabel} Pomodoro name is invalid: ${normalized.error}; shorten a name before merging`,
    });
  }
  return normalized;
}

function validatePomodoroEntryMergeHeader(lineText, roleLabel) {
  const parsed = parsePomodoroEntryLine(lineText);
  if (!parsed) {
    return `${roleLabel} Pomodoro entry could not be found`;
  }
  if (parsed.name === null && String(lineText || "").slice(parsed.rangeEnd).trim() !== "") {
    return `${roleLabel} Pomodoro entry has unsupported trailing content; rename it by hand before merging`;
  }
  return null;
}

function buildPomodoroEntryMergeOptions(session, row) {
  const sourceContent = session && typeof session.sourceContent === "string"
    ? session.sourceContent
    : "";
  const { lines } = splitMarkdownContent(sourceContent);
  const selectedEntryLine =
    row && row.entry && Number.isInteger(row.entry.entryLine)
      ? row.entry.entryLine
      : -1;
  return Object.freeze({
    invokedEntryLine:
      session && session.discovery && Number.isInteger(session.discovery.entryLine)
        ? session.discovery.entryLine
        : -1,
    invokedRawLine:
      session && session.discovery && typeof session.discovery.rawEntryLine === "string"
        ? session.discovery.rawEntryLine
        : undefined,
    selectedEntryLine,
    selectedRawLine:
      selectedEntryLine >= 0 ? String(lines[selectedEntryLine] || "") : undefined,
  });
}

function planPomodoroEntryMerge(content, options = {}) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const invokedEntryLine = Number.isInteger(options.invokedEntryLine)
    ? options.invokedEntryLine
    : -1;
  const selectedEntryLine = Number.isInteger(options.selectedEntryLine)
    ? options.selectedEntryLine
    : -1;

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      invokedEntryLine,
      selectedEntryLine,
      survivorOriginalEntryLine: null,
      absorbedOriginalEntryLine: null,
      survivorEntryLine: null,
      survivorName: null,
      absorbedName: null,
      finalName: null,
      survivorPosition: null,
      absorbedPosition: null,
      transferredBulletCount: 0,
      firstMovedLine: null,
    });

  if (invokedEntryLine === selectedEntryLine) {
    return invalid("Choose a different Pomodoro to merge");
  }
  if (typeof options.invokedRawLine === "string") {
    if (String(lines[invokedEntryLine] || "") !== options.invokedRawLine) {
      return invalid("The invoked Pomodoro entry changed before it could be merged");
    }
  }
  if (typeof options.selectedRawLine === "string") {
    if (String(lines[selectedEntryLine] || "") !== options.selectedRawLine) {
      return invalid("The selected Pomodoro entry changed before it could be merged");
    }
  }

  const { entries } = collectPomodoroEntries(text);
  const invokedEntry = entries.find(
    (entry) => entry.entryLine === invokedEntryLine,
  );
  const selectedEntry = entries.find(
    (entry) => entry.entryLine === selectedEntryLine,
  );
  if (!invokedEntry) {
    return invalid("Invoked Pomodoro entry could not be found");
  }
  if (!selectedEntry) {
    return invalid("Selected Pomodoro entry could not be found");
  }

  const invokedHeaderError = validatePomodoroEntryMergeHeader(
    String(lines[invokedEntryLine] || ""),
    "Invoked",
  );
  if (invokedHeaderError) {
    return invalid(invokedHeaderError);
  }
  const selectedHeaderError = validatePomodoroEntryMergeHeader(
    String(lines[selectedEntryLine] || ""),
    "Selected",
  );
  if (selectedHeaderError) {
    return invalid(selectedHeaderError);
  }

  const invokedIsTimed = isOpenTimedPomodoroEntry(invokedEntry);
  const selectedIsTimed = isOpenTimedPomodoroEntry(selectedEntry);
  const invokedIsFuture = isOpenPlaceholderPomodoroEntry(invokedEntry);
  const selectedIsFuture = isOpenPlaceholderPomodoroEntry(selectedEntry);
  if (!(invokedIsTimed || invokedIsFuture) || !(selectedIsTimed || selectedIsFuture)) {
    return invalid("Only open current or future Pomodoros can be merged");
  }
  if (invokedIsTimed && selectedIsTimed) {
    return invalid("Two timed Pomodoros cannot be merged automatically");
  }

  const survivor = invokedIsTimed ? invokedEntry : selectedEntry;
  const absorbed = invokedIsTimed ? selectedEntry : invokedEntry;
  const survivorRole = invokedIsTimed ? "Invoked" : "Selected";
  const absorbedRole = invokedIsTimed ? "Selected" : "Invoked";
  const survivorName = getPomodoroEntryMergeName(survivor, survivorRole);
  if (!survivorName.valid) {
    return invalid(survivorName.error);
  }
  const absorbedName = getPomodoroEntryMergeName(absorbed, absorbedRole);
  if (!absorbedName.valid) {
    return invalid(absorbedName.error);
  }

  const finalName = [survivorName.name, absorbedName.name]
    .filter(Boolean)
    .join(" + ");
  if (finalName) {
    const finalNameResult = normalizePomodoroName(finalName);
    if (!finalNameResult.valid || finalNameResult.name !== finalName) {
      return invalid(
        `Merged Pomodoro name is invalid: ${finalNameResult.error}; shorten a name before merging`,
      );
    }
  }

  const absorbedDiscovery = discoverPomodoroEntryMoveTargets(
    text,
    absorbed.entryLine,
  );
  if (!absorbedDiscovery.valid) {
    return invalid(absorbedDiscovery.error);
  }

  const movePlan = planPomodoroBulletMove(text, {
    scope: "entry",
    targets: absorbedDiscovery.targets,
    sourceEntryLine: absorbed.entryLine,
    sourceRawLine: String(lines[absorbed.entryLine] || ""),
    destination: { kind: "existing", entryLine: survivor.entryLine },
    preserveDuplicates: true,
  });
  if (!movePlan.valid) {
    return invalid(movePlan.error);
  }

  let after = movePlan.after;
  let survivorEntryLine = movePlan.destinationEntryLine;
  if (finalName) {
    const afterMoveLines = splitMarkdownContent(movePlan.after).lines;
    const renamePlan = planPomodoroEntryRename(movePlan.after, {
      sourceEntryLine: survivorEntryLine,
      sourceRawLine: String(afterMoveLines[survivorEntryLine] || ""),
      name: finalName,
    });
    if (!renamePlan.valid) {
      return invalid(renamePlan.error);
    }
    after = renamePlan.after;
    survivorEntryLine = renamePlan.entryLine;
  }

  return Object.freeze({
    valid: true,
    error: null,
    after,
    invokedEntryLine,
    selectedEntryLine,
    survivorOriginalEntryLine: survivor.entryLine,
    absorbedOriginalEntryLine: absorbed.entryLine,
    survivorEntryLine,
    survivorName: survivorName.name,
    absorbedName: absorbedName.name,
    finalName,
    survivorPosition: survivor.position,
    absorbedPosition: absorbed.position,
    transferredBulletCount: movePlan.movedCount,
    firstMovedLine: movePlan.firstMovedLine,
  });
}

function isOpenPlaceholderPomodoroEntry(entry) {
  return Boolean(entry && entry.open && entry.placeholder);
}

function isOpenTimedPomodoroEntry(entry) {
  return Boolean(
    entry &&
      entry.open &&
      !entry.placeholder &&
      hasPomodoroTimeRange(entry.rangeText),
  );
}

function isReorderablePomodoroEntry(entry) {
  return isOpenPlaceholderPomodoroEntry(entry) || isOpenTimedPomodoroEntry(entry);
}

// True when a findPomodoroEntryContext() context sits on a Pomodoro entry that
// should be handled by the reorder route: an open future placeholder or the
// open timed current entry. The planner enforces direction and span legality.
function isMovablePomodoroEntryContext(context) {
  return Boolean(context && isReorderablePomodoroEntry(context.entry));
}

function getPomodoroEntryReorderBoundaryError(entry, entries, direction, repeat) {
  const label = getPomodoroBulletMoveDestinationLabel(entry);
  const directionWord = direction < 0 ? "up" : "down";
  const hasCurrentEntry = Array.isArray(entries)
    ? entries.some((candidate) => isOpenTimedPomodoroEntry(candidate))
    : false;

  if (hasCurrentEntry) {
    const boundary =
      direction < 0
        ? "the current/history boundary"
        : "the available future Pomodoros";
    return repeat > 1
      ? `${label} cannot move ${directionWord} ${repeat} positions beyond ${boundary}`
      : `${label} cannot move ${directionWord} beyond ${boundary}`;
  }

  return repeat > 1
    ? `${label} cannot move ${directionWord} ${repeat} positions without crossing the ${
        direction < 0 ? "first" : "last"
      } planned Pomodoro`
    : `${label} is already the ${
        direction < 0 ? "first" : "last"
      } planned Pomodoro`;
}

function getPomodoroEntryReorderCrossingError(entry, direction, repeat) {
  const label = getPomodoroBulletMoveDestinationLabel(entry);
  const directionWord = direction < 0 ? "up" : "down";
  return repeat > 1
    ? `${label} cannot move ${directionWord} ${repeat} positions across the current/history boundary`
    : `${label} cannot move ${directionWord} across the current/history boundary`;
}

function replacePomodoroEntryRangeText(lineText, entry, rangeText) {
  const line = String(lineText || "");
  if (
    !entry ||
    !Number.isInteger(entry.rangeStart) ||
    !Number.isInteger(entry.rangeEnd) ||
    entry.rangeStart < 0 ||
    entry.rangeEnd < entry.rangeStart
  ) {
    return line;
  }
  return (
    line.slice(0, entry.rangeStart) +
    String(rangeText || "") +
    line.slice(entry.rangeEnd)
  );
}

function getPomodoroEntryReorderRangeSwap(spanEntries, entry, direction) {
  const timedEntries = spanEntries.filter((spanEntry) =>
    isOpenTimedPomodoroEntry(spanEntry),
  );
  if (timedEntries.length !== 1) {
    return null;
  }
  const timedEntry = timedEntries[0];
  const placeholderEntry =
    direction > 0
      ? spanEntries[1]
      : spanEntries.find((spanEntry) => spanEntry.entryLine === entry.entryLine);
  if (
    !placeholderEntry ||
    !isOpenPlaceholderPomodoroEntry(placeholderEntry) ||
    !isOpenTimedPomodoroEntry(timedEntry)
  ) {
    return null;
  }
  return Object.freeze({
    timedEntryLine: timedEntry.entryLine,
    placeholderEntryLine: placeholderEntry.entryLine,
    timedRangeText: timedEntry.rangeText,
    placeholderRangeText: placeholderEntry.rangeText,
  });
}

