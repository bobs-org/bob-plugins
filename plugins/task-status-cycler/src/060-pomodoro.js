function getPomodoroMarkerPrefix(lineText, tokenStart) {
  const line = String(lineText || "");
  const start = Math.max(0, Math.min(Number(tokenStart) || 0, line.length));
  const match = line.slice(0, start).match(/(?:🍅[ \t]+)+$/u);
  if (!match) {
    return { start, end: start, count: 0, canonical: false };
  }
  return {
    start: start - match[0].length,
    end: start,
    count: (match[0].match(/🍅/gu) || []).length,
    canonical: match[0] === `${POMODORO_MARKER} `,
  };
}

function getPomodoroMarkerTokenStart(lineText, candidate, strikeSpans = null) {
  const line = String(lineText || "");
  const spans = strikeSpans || getStrikethroughSpans(line);
  const exactStrike = spans.find(
    (span) =>
      candidate.startIndex === span.start && candidate.endIndex === span.end,
  );
  return exactStrike ? exactStrike.start - 2 : candidate.startIndex;
}

function rewritePomodoroMarkersInLine(lineText, markerPolicy) {
  const line = String(lineText || "");
  const strikeSpans = getStrikethroughSpans(line);
  const edits = [];
  for (const candidate of getBlockLinkTokenCandidates(line)) {
    const exactStrike = strikeSpans.find(
      (span) =>
        candidate.startIndex === span.start && candidate.endIndex === span.end,
    );
    const tokenStart = exactStrike
      ? exactStrike.start - 2
      : candidate.startIndex;
    const prefix = getPomodoroMarkerPrefix(line, tokenStart);
    const marked = typeof markerPolicy === "function"
      ? !!markerPolicy({
        candidate,
        embedded: candidate.embedded,
        struck: !!exactStrike,
        prefix,
      })
      : !!markerPolicy;
    const replacement = marked ? `${POMODORO_MARKER} ` : "";
    if (
      (marked && prefix.canonical) ||
      (!marked && prefix.count === 0)
    ) {
      continue;
    }
    edits.push({ start: prefix.start, end: tokenStart, text: replacement });
  }

  let rewritten = line;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, edit.start)}${edit.text}${rewritten.slice(edit.end)}`;
  }
  return rewritten;
}

function completedPomodoroMarkerPolicy(occurrence) {
  if (occurrence.embedded) {
    return false;
  }
  if (occurrence.struck) {
    return occurrence.prefix.count > 0;
  }
  return true;
}

function stripPomodoroMarkersFromLine(lineText) {
  return rewritePomodoroMarkersInLine(lineText, false);
}

function rewritePomodoroMarkersInText(sourceText, marked) {
  const sourceLines = splitTextByLineEndings(sourceText);
  const fenced = getFencedLineNumbers(sourceLines.map((line) => line.text));
  for (let line = 0; line < sourceLines.length; line += 1) {
    if (!fenced.has(line)) {
      sourceLines[line].text = rewritePomodoroMarkersInLine(
        sourceLines[line].text,
        marked,
      );
    }
  }
  return sourceLines.map((line) => `${line.text}${line.ending}`).join("");
}

function getBareNonEmbeddedBlockLinkTargetFromListItem(lineText) {
  const moveOnlyLink = getMoveOnlyPomodoroBlockLinkFromListItem(lineText);
  if (moveOnlyLink) {
    return moveOnlyLink.target;
  }

  const line = String(lineText || "");
  const listMatch = line.match(LIST_ITEM_MARKER_RE);
  if (!listMatch) {
    return null;
  }

  const body = listMatch[2] || "";
  const leadingWhitespace = body.match(/^[ \t]*/)[0].length;
  const trailingWhitespace = body.match(/[ \t]*$/)[0].length;
  const bodyStart = listMatch[1].length;
  const trimmedStart = bodyStart + leadingWhitespace;
  const trimmedEnd = bodyStart + body.length - trailingWhitespace;
  if (trimmedStart >= trimmedEnd) {
    return null;
  }

  const candidates = parseNonEmbeddedBlockLinks(line);
  if (candidates.length !== 1) {
    return null;
  }

  const candidate = candidates[0];
  return candidate.startIndex === trimmedStart && candidate.endIndex === trimmedEnd
    ? candidate
    : null;
}

function getMoveOnlyPomodoroBlockLinkFromListItem(lineText) {
  const line = String(lineText || "");
  const listMatch = line.match(LIST_ITEM_MARKER_RE);
  if (!listMatch) {
    return null;
  }

  const body = listMatch[2] || "";
  const leadingWhitespace = body.match(/^[ \t]*/)[0].length;
  const trailingWhitespace = body.match(/[ \t]*$/)[0].length;
  const bodyStart = listMatch[1].length;
  const trimmedStart = bodyStart + leadingWhitespace;
  const trimmedEnd = bodyStart + body.length - trailingWhitespace;
  const directiveIndex = trimmedEnd - 1;
  if (directiveIndex <= trimmedStart || line[directiveIndex] !== "#") {
    return null;
  }

  const candidates = parseNonEmbeddedBlockLinks(line);
  if (candidates.length !== 1) {
    return null;
  }

  const target = candidates[0];
  if (
    target.startIndex !== trimmedStart ||
    target.endIndex !== directiveIndex
  ) {
    return null;
  }

  return {
    target,
    destinationLineText: `${line.slice(0, directiveIndex)}${line.slice(directiveIndex + 1)}`,
  };
}

function findPomodorosSectionInLines(lines) {
  if (!Array.isArray(lines)) {
    return null;
  }

  const headingLine = lines.findIndex((line) =>
    POMODOROS_HEADING_RE.test(String(line || "")),
  );
  if (headingLine === -1) {
    return null;
  }

  let endLine = lines.length - 1;
  for (let line = headingLine + 1; line < lines.length; line += 1) {
    if (LEVEL_TWO_HEADING_RE.test(String(lines[line] || ""))) {
      endLine = line - 1;
      break;
    }
  }

  return {
    headingLine,
    startLine: headingLine + 1,
    endLine,
  };
}

function lineIsInPomodorosSection(section, line) {
  return (
    !!section &&
    Number.isInteger(line) &&
    line >= section.startLine &&
    line <= section.endLine
  );
}

function isPomodoroTaskLine(lines, section, line) {
  return (
    Array.isArray(lines) &&
    lineIsInPomodorosSection(section, line) &&
    isTopLevelTaskLine(lines[line])
  );
}

function parsePomodoroEntryLineParts(lineText) {
  const line = String(lineText || "");
  if (!isTopLevelTaskLine(line)) {
    return null;
  }

  const taskMatch = line.match(TASK_LINE_RE);
  const body = taskMatch ? line.slice(taskMatch[0].length).trim() : "";
  const placeholderMatch = body.match(POMODORO_PLACEHOLDER_RE);
  let rangeMatch = null;
  let placeholder = false;

  if (placeholderMatch && placeholderMatch.index === 0) {
    rangeMatch = placeholderMatch;
    placeholder = true;
  } else {
    rangeMatch =
      body.match(POMODORO_COLON_TIME_RANGE_RE) ||
      body.match(POMODORO_COMPACT_TIME_RANGE_RE);
    if (!rangeMatch || rangeMatch.index !== 0) {
      return null;
    }
  }

  const rangeText = rangeMatch[0];
  const remainingBody = body.slice(rangeText.length);
  const tailMatch = remainingBody.match(POMODORO_NAME_TAIL_RE);
  let name = null;
  let trailingText = remainingBody;
  if (tailMatch) {
    const trimmedName = tailMatch[1].trim();
    if (trimmedName) {
      name = trimmedName;
    }
    trailingText = "";
  }

  return Object.freeze({
    placeholder,
    rangeText,
    name,
    trailingText,
  });
}

function formatPomodoroPlaceholderLine(name) {
  const trimmedName = name == null ? "" : String(name).trim();
  if (!trimmedName) {
    return POMODORO_PLACEHOLDER_LINE;
  }
  return `${POMODORO_PLACEHOLDER_LINE} ${POMODORO_NAME_SEPARATOR} ${trimmedName}`;
}

function getSubBulletBlockRange(lines, pomodoroLine, section = null) {
  if (!Array.isArray(lines) || !Number.isInteger(pomodoroLine)) {
    return null;
  }

  const endLine = section ? Math.min(section.endLine, lines.length - 1) : lines.length - 1;
  let line = pomodoroLine + 1;

  while (line <= endLine) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim() || !INDENTED_LIST_LINE_RE.test(lineText)) {
      break;
    }

    line += 1;
  }

  return {
    startLine: pomodoroLine + 1,
    endLine: line,
  };
}

function getPomodoroBulletToggle(lines, activeLine) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(activeLine) ||
    activeLine < 0 ||
    activeLine >= lines.length
  ) {
    return null;
  }

  const section = findPomodorosSectionInLines(lines);
  if (!lineIsInPomodorosSection(section, activeLine)) {
    return null;
  }

  const sourceLineText = String(lines[activeLine] || "");
  if (isTopLevelTaskLine(sourceLineText)) {
    const taskStatus = getTaskStatusForLine(sourceLineText, activeLine);
    const parsedPomodoro = parsePomodoroEntryLineParts(sourceLineText);
    const subBulletRange = getSubBulletBlockRange(
      lines,
      activeLine,
      section,
    );
    if (
      taskStatus &&
      taskStatus.symbol === " " &&
      parsedPomodoro &&
      parsedPomodoro.placeholder &&
      parsedPomodoro.trailingText === "" &&
      subBulletRange &&
      subBulletRange.startLine === subBulletRange.endLine
    ) {
      return {
        line: activeLine,
        direction: "to-bullet",
        sourceLineText,
        lineText: EMPTY_POMODORO_SUB_BULLET_LINE,
        cursorCh: EMPTY_POMODORO_SUB_BULLET_LINE.length,
      };
    }
    return null;
  }

  const listMarkerMatch = sourceLineText.match(INDENTED_LIST_LINE_RE);
  if (
    !listMarkerMatch ||
    sourceLineText.slice(listMarkerMatch[0].length).trim()
  ) {
    return null;
  }

  return {
    line: activeLine,
    direction: "to-pomodoro",
    sourceLineText,
    lineText: POMODORO_PLACEHOLDER_LINE,
    cursorCh: getPomodoroCursorTargetCh(POMODORO_PLACEHOLDER_LINE),
  };
}

// Resolve the top-level Pomodoro whose contiguous descendant-list block owns
// an active child line. Ownership is deliberately status-neutral: callers may
// use the same structure beneath open, completed, or otherwise historical
// Pomodoros and apply their own status-specific behavior afterward.
function getOwningPomodoroContextForLine(lines, activeLine) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(activeLine) ||
    activeLine < 0 ||
    activeLine >= lines.length
  ) {
    return null;
  }

  const section = findPomodorosSectionInLines(lines);
  if (
    !lineIsInPomodorosSection(section, activeLine) ||
    !INDENTED_LIST_LINE_RE.test(String(lines[activeLine] || ""))
  ) {
    return null;
  }

  let pomodoroLine = null;
  for (let line = activeLine - 1; line >= section.startLine; line -= 1) {
    if (isTopLevelTaskLine(lines[line])) {
      pomodoroLine = line;
      break;
    }
  }
  if (pomodoroLine === null) {
    return null;
  }

  const subBulletRange = getSubBulletBlockRange(lines, pomodoroLine, section);
  if (
    !subBulletRange ||
    activeLine < subBulletRange.startLine ||
    activeLine >= subBulletRange.endLine
  ) {
    return null;
  }

  const taskStatus = getTaskStatusForLine(lines[pomodoroLine], pomodoroLine);
  if (!taskStatus) {
    return null;
  }

  return {
    lines,
    section,
    pomodoroLine,
    taskStatus,
    subBulletRange,
    activeLine,
  };
}

function buildPomodoroMoveOnlyTogglePlan(lines, cursorLine, additionalLines = 0) {
  const ineligiblePlan = {
    eligible: false,
    edits: [],
  };
  if (!Array.isArray(lines) || !Number.isInteger(cursorLine)) {
    return ineligiblePlan;
  }

  const section = findPomodorosSectionInLines(lines);
  const fenced = getFencedLineNumbers(lines);
  if (
    !lineIsInPomodorosSection(section, cursorLine) ||
    fenced.has(cursorLine)
  ) {
    return ineligiblePlan;
  }

  let pomodoroLine = null;
  for (let line = cursorLine - 1; line >= section.startLine; line -= 1) {
    if (isTopLevelTaskLine(lines[line])) {
      pomodoroLine = line;
      break;
    }
  }
  if (pomodoroLine === null) {
    return ineligiblePlan;
  }

  const pomodoroStatus = getTaskStatusForLine(
    lines[pomodoroLine],
    pomodoroLine,
  );
  if (!pomodoroStatus || pomodoroStatus.symbol !== " ") {
    return ineligiblePlan;
  }

  const range = getSubBulletBlockRange(lines, pomodoroLine, section);
  if (
    !range ||
    cursorLine < range.startLine ||
    cursorLine >= range.endLine ||
    !getBareNonEmbeddedBlockLinkTargetFromListItem(lines[cursorLine])
  ) {
    return ineligiblePlan;
  }

  const boundedAdditionalLines = Math.max(
    0,
    Math.floor(Number(additionalLines) || 0),
  );
  const endLine = Math.min(
    range.endLine,
    cursorLine + boundedAdditionalLines + 1,
  );
  const edits = [];

  for (let line = cursorLine; line < endLine; line += 1) {
    if (fenced.has(line)) {
      continue;
    }

    const sourceLineText = String(lines[line] || "");
    const moveOnlyLink = getMoveOnlyPomodoroBlockLinkFromListItem(sourceLineText);
    if (moveOnlyLink) {
      edits.push({
        type: "remove",
        line,
        sourceLineText,
        lineText: moveOnlyLink.destinationLineText,
      });
      continue;
    }

    const target = getBareNonEmbeddedBlockLinkTargetFromListItem(sourceLineText);
    if (!target) {
      continue;
    }

    edits.push({
      type: "add",
      line,
      sourceLineText,
      lineText: `${sourceLineText.slice(0, target.endIndex)}#${sourceLineText.slice(target.endIndex)}`,
      target,
    });
  }

  return {
    eligible: true,
    pomodoroLine,
    range,
    startLine: cursorLine,
    endLine,
    edits,
  };
}

function buildPomodoroReopenMarkerEdits(lines, pomodoroLine) {
  const section = findPomodorosSectionInLines(lines);
  if (!isPomodoroTaskLine(lines, section, pomodoroLine)) {
    return [];
  }

  const range = getSubBulletBlockRange(lines, pomodoroLine, section);
  const fenced = getFencedLineNumbers(lines);
  const edits = [];
  for (let line = range.startLine; line < range.endLine; line += 1) {
    if (fenced.has(line)) {
      continue;
    }
    const sourceLineText = String(lines[line] || "");
    const lineText = stripPomodoroMarkersFromLine(sourceLineText);
    if (lineText !== sourceLineText) {
      edits.push({ line, sourceLineText, lineText });
    }
  }
  return edits;
}

function classifyPomodoroSubBullets(lines, range) {
  const transcludedTaskLinkBullets = [];
  const copyableTaskLinkBullets = [];
  const moveOnlyTaskLinkBullets = [];
  const startableNonTranscludedTaskLinkBullets = [];
  const noteBullets = [];

  if (!Array.isArray(lines) || !range) {
    return {
      transcludedTaskLinkBullets,
      copyableTaskLinkBullets,
      moveOnlyTaskLinkBullets,
      startableNonTranscludedTaskLinkBullets,
      noteBullets,
    };
  }

  const fenced = getFencedLineNumbers(lines);
  for (let line = range.startLine; line < range.endLine; line += 1) {
    const lineText = stripPomodoroMarkersFromLine(lines[line]);
    if (fenced.has(line)) {
      noteBullets.push({ line, lineText });
      continue;
    }

    const embeddedTargets = parseEmbeddedBlockTransclusions(lineText);

    if (embeddedTargets.length > 0) {
      transcludedTaskLinkBullets.push({
        line,
        lineText,
        targets: embeddedTargets,
      });
      continue;
    }

    const moveOnlyLink = getMoveOnlyPomodoroBlockLinkFromListItem(lineText);
    if (moveOnlyLink) {
      const bullet = {
        line,
        lineText,
        destinationLineText: moveOnlyLink.destinationLineText,
        targets: [moveOnlyLink.target],
      };
      moveOnlyTaskLinkBullets.push(bullet);
      continue;
    }

    const strikeSpans = getStrikethroughSpans(lineText);
    const nonEmbeddedTargets = parseNonEmbeddedBlockLinks(lineText).filter(
      (target) => !rangeIsStruck(target.startIndex, target.endIndex, strikeSpans),
    );
    if (nonEmbeddedTargets.length > 0) {
      copyableTaskLinkBullets.push({
        line,
        lineText,
        targets: nonEmbeddedTargets,
      });

      const bareTarget = getBareNonEmbeddedBlockLinkTargetFromListItem(lineText);
      if (bareTarget) {
        startableNonTranscludedTaskLinkBullets.push({
          line,
          lineText,
          targets: [bareTarget],
        });
      }
      continue;
    }

    noteBullets.push({
      line,
      lineText,
    });
  }

  return {
    transcludedTaskLinkBullets,
    copyableTaskLinkBullets,
    moveOnlyTaskLinkBullets,
    startableNonTranscludedTaskLinkBullets,
    noteBullets,
  };
}

// A Pomodoro sub-bullet is a "Task Link" for Work Log purposes when, after
// stripping Pomodoro markers and unwrapping one enclosing `~~ ~~` pair and an
// immediate trailing `#` deferral marker, its body is exactly one block link
// (embedded or not) and nothing else. This is deliberately not
// classifyPomodoroSubBullets: that function filters out struck links (they
// are carry-forward noise there), but for Work Log purposes a struck link is
// the most important case — a task finished this session. Aliased links
// qualify; two links, a link plus prose, or a bare note do not.
function getPomodoroWorkLogTaskLinkTarget(lineText) {
  const stripped = stripPomodoroMarkersFromLine(lineText);
  const listMatch = stripped.match(LIST_ITEM_MARKER_RE);
  if (!listMatch) {
    return null;
  }

  let start = listMatch[1].length;
  let end = stripped.length;
  const isWhitespace = (index) => /[ \t]/.test(stripped[index]);
  while (end > start && isWhitespace(end - 1)) {
    end -= 1;
  }
  while (start < end && isWhitespace(start)) {
    start += 1;
  }
  if (start >= end) {
    return null;
  }

  if (stripped[end - 1] === "#") {
    end -= 1;
    while (end > start && isWhitespace(end - 1)) {
      end -= 1;
    }
  }
  if (start >= end) {
    return null;
  }

  if (
    end - start >= 4 &&
    stripped[start] === "~" &&
    stripped[start + 1] === "~" &&
    stripped[end - 1] === "~" &&
    stripped[end - 2] === "~"
  ) {
    start += 2;
    end -= 2;
    while (end > start && isWhitespace(end - 1)) {
      end -= 1;
    }
    while (start < end && isWhitespace(start)) {
      start += 1;
    }
  }
  if (start >= end) {
    return null;
  }

  const candidates = getBlockLinkTokenCandidates(stripped);
  if (candidates.length !== 1) {
    return null;
  }

  const candidate = candidates[0];
  return candidate.startIndex === start && candidate.endIndex === end
    ? candidate
    : null;
}

// Collects `subBulletLine`'s descendant lines (indented deeper than it, up to
// findTaskChildBlockEndLine) as a tree: each node is `{ marker, bodyText,
// children }`, nested by relative indentation width. Blank lines are dropped
// before depth is computed, so they neither participate in nor break the
// nesting structure.
function collectPomodoroWorkLogDescendantTree(lines, subBulletLine, endLine) {
  const rootIndentWidth = getLineIndentation(lines[subBulletLine] || "").length;
  const roots = [];
  const stack = [{ indentWidth: rootIndentWidth, children: roots }];

  for (let line = subBulletLine + 1; line <= endLine; line += 1) {
    const rawText = String(lines[line] || "");
    if (!rawText.trim()) {
      continue;
    }

    const indentWidth = getLineIndentation(rawText).length;
    while (stack.length > 1 && stack[stack.length - 1].indentWidth >= indentWidth) {
      stack.pop();
    }
    if (indentWidth <= stack[0].indentWidth) {
      continue;
    }

    const prefix = parseListItemPrefix(rawText);
    const marker = prefix ? prefix.marker : "-";
    const bodyText = prefix
      ? rawText.slice(prefix.indent.length + prefix.marker.length).trim()
      : rawText.trim();
    const node = { marker, bodyText, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ indentWidth, children: node.children });
  }

  return roots;
}

// The note groups eligible for Work Log copying when `pomodoroLine` closes: a
// direct child of `pomodoroLine` (findNearestParentListItemLine(lines, line)
// === pomodoroLine) that is a Task Link and has at least one nonblank
// descendant line. Two sub-bullets may resolve to the same task; both are
// returned, deliberately not deduplicated.
function collectPomodoroWorkLogNoteGroups(lines, pomodoroLine, range) {
  const groups = [];
  if (!Array.isArray(lines) || !range) {
    return groups;
  }

  const fenced = getFencedLineNumbers(lines);
  for (let line = range.startLine; line < range.endLine; line += 1) {
    if (fenced.has(line) || !String(lines[line] || "").trim()) {
      continue;
    }
    if (findNearestParentListItemLine(lines, line) !== pomodoroLine) {
      continue;
    }

    const target = getPomodoroWorkLogTaskLinkTarget(lines[line]);
    if (!target) {
      continue;
    }

    const endLine = findTaskChildBlockEndLine(lines, line);
    const descendantRoots = collectPomodoroWorkLogDescendantTree(lines, line, endLine);
    if (descendantRoots.length === 0) {
      continue;
    }

    groups.push({ sourceLine: line, target, descendantRoots });
  }

  return groups;
}

function findNextPomodoroLine(lines, section, afterLine) {
  if (!Array.isArray(lines) || !section || !Number.isInteger(afterLine)) {
    return null;
  }

  for (let line = afterLine + 1; line <= section.endLine; line += 1) {
    if (isTopLevelTaskLine(lines[line])) {
      return line;
    }
  }

  return null;
}

function getPomodoroCursorTargetCh(lineText) {
  const line = String(lineText || "");
  const match = POMODORO_PLACEHOLDER_RE.exec(line);
  return match ? match.index + match[0].length - 1 : 0;
}

function getBlockLinkTargetKey(target) {
  if (!target || !BLOCK_ID_RE.test(String(target.blockId || ""))) {
    return null;
  }

  return `${String(target.pathPart || "")}#^${target.blockId}`;
}

function getBlockLinkTargetKeys(targets) {
  return (Array.isArray(targets) ? targets : [])
    .map((target) => getBlockLinkTargetKey(target))
    .filter(Boolean);
}

function getBlockLinkTargetKeysFromLine(lineText) {
  return getBlockLinkTargetKeys([
    ...parseEmbeddedBlockTransclusions(lineText),
    ...parseNonEmbeddedBlockLinks(lineText),
  ]);
}

function buildPomodoroCompletionPlan(lines, section, pomodoroLine) {
  if (!isPomodoroTaskLine(lines, section, pomodoroLine)) {
    return null;
  }

  const taskStatus = getTaskStatusForLine(lines[pomodoroLine], pomodoroLine);
  if (!taskStatus || taskStatus.symbol !== " ") {
    return null;
  }

  const parsedPomodoro = parsePomodoroEntryLineParts(lines[pomodoroLine]);
  const createdPomodoroName = parsedPomodoro && parsedPomodoro.name
    ? parsedPomodoro.name
    : null;
  const sourceRange = getSubBulletBlockRange(lines, pomodoroLine, section);
  const sourceBullets = classifyPomodoroSubBullets(lines, sourceRange);
  const nextPomodoroLine = findNextPomodoroLine(lines, section, pomodoroLine);
  const fenced = getFencedLineNumbers(lines);
  const movedSourceLines = new Set(
    sourceBullets.moveOnlyTaskLinkBullets.map((bullet) => bullet.line),
  );
  const edits = [
    {
      type: "replaceLine",
      line: pomodoroLine,
      sourceLineText: String(lines[pomodoroLine] || ""),
      lineText: replaceTaskStatusSymbol(lines[pomodoroLine], "x"),
    },
  ];
  for (let line = sourceRange.startLine; line < sourceRange.endLine; line += 1) {
    if (movedSourceLines.has(line)) {
      edits.push({
        type: "removeLine",
        line,
        sourceLineText: String(lines[line] || ""),
      });
      continue;
    }
    if (fenced.has(line)) {
      continue;
    }
    const sourceLineText = String(lines[line] || "");
    const lineText = rewritePomodoroMarkersInLine(
      sourceLineText,
      completedPomodoroMarkerPolicy,
    );
    if (lineText !== sourceLineText) {
      edits.push({ type: "replaceLine", line, sourceLineText, lineText });
    }
  }
  // Only insert a fresh placeholder Pomodoro when there is something to carry
  // forward (an ordinary copyable link or a move-only link) or when this is the
  // last Pomodoro in the section. When a later Pomodoro already exists and
  // there is nothing to carry, complete in place and jump the cursor to that
  // existing next Pomodoro instead of leaving an empty placeholder between
  // them. A created placeholder is inserted directly below the completed
  // Pomodoro's own sub-bullet block; existing lower Pomodoros are left untouched
  // and pushed down by the insertion.
  //
  // Carried links are grouped worked-on (copyable) links first, then deferred
  // (#-marked, move-only) links second, each group kept in its own source
  // order: the fresh Pomodoro reads as "keep going on what you were working
  // on, then pick up what you deferred".
  const copyableBulletLines = [
    ...sourceBullets.copyableTaskLinkBullets
      .slice()
      .sort((left, right) => left.line - right.line)
      .map((bullet) => stripPomodoroMarkersFromLine(bullet.lineText)),
    ...sourceBullets.moveOnlyTaskLinkBullets
      .slice()
      .sort((left, right) => left.line - right.line)
      .map((bullet) => bullet.destinationLineText),
  ];
  const isLastPomodoro = nextPomodoroLine === null;
  const shouldCreatePomodoro = copyableBulletLines.length > 0 || isLastPomodoro;
  const removedLineCountBefore = (line) =>
    [...movedSourceLines].filter((removedLine) => removedLine < line).length;

  let createdPomodoro = false;
  let plannedCreatedPomodoroName = null;
  let copiedBulletLines = [];
  let cursorTargetLine = Number.isInteger(nextPomodoroLine)
    ? nextPomodoroLine - removedLineCountBefore(nextPomodoroLine)
    : nextPomodoroLine;

  if (shouldCreatePomodoro) {
    createdPomodoro = true;
    plannedCreatedPomodoroName = createdPomodoroName;
    copiedBulletLines = copyableBulletLines;
    edits.push({
      type: "insertLines",
      line: sourceRange.endLine,
      lines: [
        formatPomodoroPlaceholderLine(createdPomodoroName),
        ...(copiedBulletLines.length > 0
          ? copiedBulletLines
          : [EMPTY_POMODORO_SUB_BULLET_LINE]),
      ],
    });
    cursorTargetLine =
      sourceRange.endLine - removedLineCountBefore(sourceRange.endLine);
  }

  return {
    pomodoroLine,
    sourceRange,
    sourceBullets,
    nextPomodoroLine,
    createdPomodoro,
    createdPomodoroName: plannedCreatedPomodoroName,
    cursorTargetLine,
    copiedBulletLines,
    edits,
  };
}

