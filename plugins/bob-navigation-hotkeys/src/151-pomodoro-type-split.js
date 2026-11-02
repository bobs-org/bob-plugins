// --- R4 type split planner: planPomodoroTypeSplit + mapPomodoroSplitCursor ---
// Pure content surgery for Ctrl+S. Kept next to 150-pomodoro-capture.js (see the epic plan);
// split here only because fragments cap hand-edited files at 1000 lines.
// Pure R4 type split over editor content (Ctrl+S). `split` is an
// api.themes.planSplit outcome (`{ remaining, created: [{ name,
// link_indices }] }`) and `linkTargets` parallels that outcome's
// `linkKeys` order: entry `i` is the top-level Task Link bullet target
// `{ line, rawLine }` for `linkKeys[i]`, or null when that child never
// moves (base type, unsplit type, untyped, prose, or drift). Every moving
// subtree travels with its descendants; one new planned entry
// `- [ ] () — T` is inserted directly below the source for each created
// type in name order, even when T had no links. Returns one undoable
// `after` string for applyEditorContentTransaction.
function planPomodoroTypeSplit(content, options = {}) {
  const text = String(content || "");
  const { lines: originalLines, lineEnding } = splitMarkdownContent(text);
  const sourceEntryLine = Number.isInteger(options.sourceEntryLine)
    ? options.sourceEntryLine
    : -1;
  const split = options.split && typeof options.split === "object" ? options.split : null;
  const linkTargets = Array.isArray(options.linkTargets) ? options.linkTargets : [];

  const invalid = (error) =>
    Object.freeze({
      valid: false,
      error,
      after: text,
      sourceEntryLine,
      sourceEntryLineFinal: null,
      splitEntryLines: Object.freeze([]),
      firstMovedLine: null,
      movedCount: 0,
      sourcePosition: null,
      sourceName: null,
      remainingName: null,
      splitNames: Object.freeze([]),
      sourcePomodoroPreserved: false,
    });

  if (!split || typeof split.remaining !== "string" || !Array.isArray(split.created)) {
    return invalid("Pomodoro split could not be planned");
  }
  if (split.created.length === 0) {
    return invalid("Pomodoro split could not be planned");
  }
  const rawLine = String(originalLines[sourceEntryLine] || "");
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
    return invalid("Source Pomodoro entry has unsupported trailing content");
  }
  const sourceName = parsed.name || "";

  const remainingResult = normalizePomodoroName(split.remaining);
  if (!remainingResult.valid) {
    return invalid(`Split Pomodoro name is invalid: ${remainingResult.error}`);
  }
  const groupNames = [];
  for (const created of split.created) {
    const nameResult = normalizePomodoroName(created && created.name);
    if (!nameResult.valid) {
      return invalid(`Split Pomodoro name is invalid: ${nameResult.error}`);
    }
    groupNames.push(nameResult.name);
  }

  const renamePlan = planPomodoroEntryRename(text, {
    sourceEntryLine,
    sourceRawLine: rawLine,
    name: remainingResult.name,
    preserveSpelling: true,
  });
  if (!renamePlan.valid) {
    return invalid(renamePlan.error);
  }
  const renamedLines = splitMarkdownContent(renamePlan.after).lines;
  const { entries: renamedEntries } = collectPomodoroEntries(renamePlan.after);
  const renamedSource = renamedEntries.find(
    (entry) => entry.entryLine === sourceEntryLine,
  );
  if (!renamedSource) {
    return invalid("Source Pomodoro entry could not be found");
  }

  const groups = [];
  const allBlocks = [];
  for (let groupIndex = 0; groupIndex < split.created.length; groupIndex += 1) {
    const created = split.created[groupIndex];
    const indices = Array.isArray(created && created.link_indices)
      ? created.link_indices
      : [];
    const targets = [];
    for (const index of indices) {
      const candidate = linkTargets[index];
      if (!candidate || !Number.isInteger(candidate.line)) {
        continue;
      }
      if (String(renamedLines[candidate.line] || "") !== candidate.rawLine) {
        return invalid("A Pomodoro bullet changed before it could be split");
      }
      targets.push(candidate);
    }
    targets.sort((left, right) => left.line - right.line);
    const blocks = targets.map((target) =>
      capturePomodoroBulletSubtree(
        renamedLines,
        target.line,
        renamedSource.childEndLineExclusive,
      ),
    );
    for (const block of blocks) {
      allBlocks.push(block);
    }
    groups.push({ name: groupNames[groupIndex], targets, blocks });
  }

  const afterRemovalLines = removePomodoroBulletRanges(renamedLines, allBlocks);
  const repairedContent = afterRemovalLines.join(lineEnding);
  const { entries: repairedEntries } = collectPomodoroEntries(repairedContent);
  const repairedSource = repairedEntries.find(
    (entry) => entry.entryLine === sourceEntryLine,
  );
  if (!repairedSource) {
    return invalid("Source Pomodoro entry could not be found");
  }
  const destinationChildIndent =
    typeof repairedSource.childIndent === "string" ? repairedSource.childIndent : "\t";

  const insertion = [];
  const splitEntryLines = [];
  let movedCount = 0;
  let firstMovedLine = null;
  let cursor = repairedSource.childEndLineExclusive;
  for (const group of groups) {
    const rebased = [];
    for (const block of group.blocks) {
      const lines = rebasePomodoroBulletBlock(block, destinationChildIndent);
      for (const line of lines) {
        rebased.push(line);
      }
    }
    const entryLine = cursor;
    splitEntryLines.push(entryLine);
    insertion.push(formatPomodoroEntryLine(group.name));
    cursor += 1;
    for (const line of rebased) {
      insertion.push(line);
      cursor += 1;
    }
    if (rebased.length > 0) {
      movedCount += group.blocks.length;
      if (firstMovedLine === null) {
        firstMovedLine = entryLine + 1;
      }
    }
  }

  const finalLines = afterRemovalLines
    .slice(0, repairedSource.childEndLineExclusive)
    .concat(insertion, afterRemovalLines.slice(repairedSource.childEndLineExclusive));
  const finalSplitLines = [];
  const movedLineMap = {};
  let running = repairedSource.childEndLineExclusive;
  for (const group of groups) {
    finalSplitLines.push(running);
    let offset = 0;
    for (const block of group.blocks) {
      const rebasedLength = rebasePomodoroBulletBlock(
        block,
        destinationChildIndent,
      ).length;
      for (let index = 0; index < rebasedLength; index += 1) {
        movedLineMap[block.startLine + index] = running + 1 + offset + index;
      }
      offset += rebasedLength;
    }
    running += 1 + offset;
  }
  if (firstMovedLine === null) {
    firstMovedLine = finalSplitLines[0] || repairedSource.childEndLineExclusive;
  }

  return Object.freeze({
    valid: true,
    error: null,
    after: finalLines.join(lineEnding),
    sourceEntryLine,
    sourceEntryLineFinal: sourceEntryLine,
    splitEntryLines: Object.freeze(finalSplitLines),
    firstMovedLine,
    movedCount,
    movedLineMap: Object.freeze({ ...movedLineMap }),
    insertionAt: repairedSource.childEndLineExclusive,
    insertedLineCount: running - repairedSource.childEndLineExclusive,
    sourcePosition: context.entry.position,
    sourceName,
    remainingName: remainingResult.name,
    splitNames: Object.freeze(groupNames.slice()),
    sourcePomodoroPreserved: true,
  });
}

// Map a pre-split cursor through a `planPomodoroTypeSplit` outcome: the
// cursor stays on its own line, and follows a moved bullet to its new
// entry. `cursor` is `{ line, ch }`; returns a clamped `{ line, ch }`.
// Moved lines use the plan's exact map; every other line keeps its text:
// the first after-line with the same trimmed text wins, else the same
// line number clamped into range.
function mapPomodoroSplitCursor(before, after, plan, cursor) {
  const beforeLines = splitMarkdownContent(String(before || "")).lines;
  const afterLines = splitMarkdownContent(String(after || "")).lines;
  const lastLine = Math.max(afterLines.length - 1, 0);
  const clampLine = (line) => Math.min(Math.max(line, 0), lastLine);
  if (!cursor || !Number.isInteger(cursor.line)) {
    return { line: 0, ch: 0 };
  }
  const ch = Math.max(0, Math.floor(Number(cursor.ch) || 0));
  const at = (line) => ({
    line: clampLine(line),
    ch: Math.min(ch, String(afterLines[clampLine(line)] || "").length),
  });
  const mapped =
    plan && plan.valid === true && plan.movedLineMap
      ? plan.movedLineMap[cursor.line]
      : undefined;
  if (Number.isInteger(mapped)) {
    return at(mapped);
  }
  const wanted = String(beforeLines[cursor.line] || "").trim();
  if (wanted) {
    const found = afterLines.findIndex(
      (line) => String(line || "").trim() === wanted,
    );
    if (found !== -1) {
      return at(found);
    }
  }
  return at(cursor.line);
}
