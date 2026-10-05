function resolvedFilePath(value) {
  if (typeof value === "string") {
    return value;
  }

  return value && typeof value.path === "string" ? value.path : null;
}

function referenceRemovalRange(content, reference) {
  let start = reference.start;
  let end = reference.end;

  if (start > 0 && content[start - 1] === "!") {
    start -= 1;
  }

  if (
    start >= 2 &&
    content.slice(start - 2, start) === "~~" &&
    content.slice(end, end + 2) === "~~"
  ) {
    start -= 2;
    end += 2;
  }

  return { start, end };
}

function lineContentBounds(lines, lineNumber) {
  const start = lineStartIndexFromLines(lines, lineNumber);
  const rawLine = String(lines[lineNumber] || "");
  const line = normalizeMarkdownLine(rawLine);
  return {
    start,
    end: start + line.length,
    line,
  };
}

function listItemBodyBounds(lineText) {
  const line = normalizeMarkdownLine(lineText);
  const prefix = LIST_ITEM_PREFIX_RE.exec(line);
  if (!prefix) {
    return null;
  }

  let start = prefix[0].length;
  while (start < line.length && /[ \t]/.test(line[start])) {
    start += 1;
  }

  let end = line.length;
  while (end > start && /[ \t]/.test(line[end - 1])) {
    end -= 1;
  }

  return start < end ? { start, end } : null;
}

function isDedicatedLinkBullet(lines, reference, removalRange) {
  const bounds = lineContentBounds(lines, reference.line);
  const bodyBounds = listItemBodyBounds(bounds.line);
  if (!bodyBounds) {
    return false;
  }

  return (
    removalRange.start === bounds.start + bodyBounds.start &&
    removalRange.end === bounds.start + bodyBounds.end
  );
}

function listItemSubtreeEdit(content, lines, lineNumber, rangeEndLine) {
  const itemIndent = lineIndentWidth(lines[lineNumber]);
  let endLine = lineNumber;

  for (let line = lineNumber + 1; line <= rangeEndLine; line += 1) {
    const lineText = normalizeMarkdownLine(lines[line]);
    if (lineText.trim() && lineIndentWidth(lineText) <= itemIndent) {
      break;
    }

    endLine = line;
  }

  const start = lineStartIndexFromLines(lines, lineNumber);
  const end =
    endLine + 1 < lines.length
      ? lineStartIndexFromLines(lines, endLine + 1)
      : content.length;
  return { start, end, replacement: "" };
}

function editContainsReference(edit, reference) {
  return edit.start <= reference.start && edit.end >= reference.end;
}

function planPomodoroLinkCleanupForRanges(content, ranges, options = {}) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const targetPath = resolvedFilePath(options.targetPath);
  const targetBlockId = normalizeText(options.targetBlockId);
  const resolveTarget = options.resolveTarget;

  if (
    !Array.isArray(ranges) ||
    ranges.length === 0 ||
    !targetPath ||
    !targetBlockId ||
    typeof resolveTarget !== "function"
  ) {
    return { edits: [], removedCount: 0 };
  }

  const matches = [];
  for (const reference of collectWikiBlockReferences(snapshot)) {
    if (reference.oldId !== targetBlockId) {
      continue;
    }

    const pomodoroRange = ranges.find(
      (range) =>
        reference.line >= range.startLine && reference.line <= range.endLine,
    );
    if (!pomodoroRange) {
      continue;
    }

    let resolved;
    try {
      resolved = resolveTarget(reference, options.sourcePath);
    } catch (error) {
      resolved = null;
    }

    if (resolvedFilePath(resolved) !== targetPath) {
      continue;
    }

    matches.push({
      reference,
      pomodoroRange,
      removalRange: referenceRemovalRange(snapshot, reference),
    });
  }

  if (matches.length === 0) {
    return { edits: [], removedCount: 0 };
  }

  const subtreeCandidates = matches
    .filter(({ reference, removalRange }) =>
      isDedicatedLinkBullet(lines, reference, removalRange),
    )
    .map(({ reference, pomodoroRange }) =>
      listItemSubtreeEdit(
        snapshot,
        lines,
        reference.line,
        pomodoroRange.endLine,
      ),
    )
    .sort((left, right) => left.start - right.start || right.end - left.end);

  const subtreeEdits = [];
  for (const edit of subtreeCandidates) {
    if (subtreeEdits.some((existing) => edit.start >= existing.start && edit.end <= existing.end)) {
      continue;
    }

    subtreeEdits.push(edit);
  }

  const tokenEdits = matches
    .filter(({ reference }) =>
      !subtreeEdits.some((edit) => editContainsReference(edit, reference)),
    )
    .map(({ removalRange }) => ({ ...removalRange, replacement: "" }));
  const edits = [...subtreeEdits, ...tokenEdits].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

  if (!validateNonOverlappingEdits(edits)) {
    return { edits: [], removedCount: 0 };
  }

  return {
    edits,
    removedCount: matches.length,
    references: matches.map(({ reference }) => reference),
  };
}

// `options.ownerLine` (paired with `options.section`) lets a caller that
// already knows the owning Pomodoro entry — e.g. the direct Ctrl+Shift+Enter
// link command, which selects the entry itself rather than deriving it from
// an existing marker's sub-bullet position — bypass the sub-bullet-relative
// `findPomodoroSourceContext` lookup. The owner is always treated as open:
// callers only pass `ownerLine` for an entry they already filtered to open.
function planFuturePomodoroLinkCleanup(content, options = {}) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const context =
    Number.isInteger(options.ownerLine) && options.section
      ? { section: options.section, ownerLine: options.ownerLine, isOpen: true }
      : findPomodoroSourceContext(lines, options.sourceLine);

  if (!context || !context.isOpen) {
    return { edits: [], removedCount: 0 };
  }

  const futureRanges = collectFutureOpenPomodoroRanges(lines, context);
  return planPomodoroLinkCleanupForRanges(snapshot, futureRanges, options);
}

function planAllOpenPomodoroLinkCleanup(content, options = {}) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  const section = findPomodorosSectionRange(lines);
  if (!section) {
    return {
      section: null,
      ranges: [],
      edits: [],
      removedCount: 0,
      references: [],
      content: snapshot,
      hasChanges: false,
    };
  }

  const ranges = collectAllOpenPomodoroRanges(lines, section);
  const cleanup = planPomodoroLinkCleanupForRanges(snapshot, ranges, options);
  return {
    section,
    ranges,
    edits: cleanup.edits,
    removedCount: cleanup.removedCount,
    references: cleanup.references || [],
    content: cleanup.edits.length > 0 ? applyTextEdits(snapshot, cleanup.edits) : snapshot,
    hasChanges: cleanup.edits.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Ctrl+Shift+Enter on a selected Task Link: link selection and deletion
// planning (the lane never changes). Mirrors task-status-cycler's definition
// of a "selected Task Link"
// (plain, embedded, 🍅-marked, `#` move-only-marked, or struck) but is kept
// self-contained because plugins are deployed separately.
// ---------------------------------------------------------------------------

// Remove `[start, end)` from `lineText` and collapse the whitespace it exposed,
// returning the minimal `{ start, end, replacement }` line-relative edit.
// Applying it yields exactly removeSpanWithSpaceCollapse's output, but as a
// narrow edit so it can merge with other edits that touch the same line.
function spanRemovalEdit(lineText, start, end) {
  const before = lineText.slice(0, start);
  const after = lineText.slice(end);
  const trailing = before.length - before.replace(/[ \t]+$/g, "").length;
  const leading = after.length - after.replace(/^[ \t]+/g, "").length;

  return {
    start: start - trailing,
    end: end + leading,
    replacement: before.trim() && after.trim() ? " " : "",
  };
}

// The span deleted when a Task Link token is removed inline: the `[[…]]`
// token, its `!` embed marker, a wrapping `~~…~~`, and any directly preceding
// run of `🍅 ` markers. Line-relative `{ start, end }`.
function taskLinkRemovalRange(lineText, startCh, endCh) {
  const range = referenceRemovalRange(lineText, { start: startCh, end: endCh });
  const marker = POMODORO_MARKER_PREFIX_RE.exec(lineText.slice(0, range.start));
  if (marker) {
    range.start -= marker[0].length;
  }

  return range;
}

function collectTaskLinkCandidates(lineText) {
  const line = normalizeMarkdownLine(lineText);
  const candidates = [];
  let match;

  WIKI_LINK_RE.lastIndex = 0;
  while ((match = WIKI_LINK_RE.exec(line)) !== null) {
    const raw = match[0];
    const endCh = match.index + raw.length;
    if (
      parseTrailingTaskPickerMarker(match) ||
      parseRapidTaskPickerMarker(match, line) ||
      hasSingleTrailingMarker(line, endCh, "@") ||
      hasSingleTrailingMarker(line, endCh, "^")
    ) {
      continue;
    }

    const { destination, aliasSuffix } = splitWikiLinkBody(match[1]);
    if (destination.includes("#^^")) {
      continue;
    }

    const parsedDestination = parseBlockReferenceDestination(destination, {
      allowPathBareBlock: true,
    });
    if (!parsedDestination) {
      continue;
    }

    const removal = taskLinkRemovalRange(line, match.index, endCh);
    candidates.push({
      raw,
      ...parsedDestination,
      aliasSuffix,
      startCh: match.index,
      endCh,
      embedded: match.index > 0 && line[match.index - 1] === "!",
      spanStartCh: removal.start,
      spanEndCh: removal.end,
    });
  }

  return candidates;
}

// Pick the Task Link a command should act on. One candidate on the line is
// selectable from anywhere on it; with several, the cursor (widened to cover
// the `!`, `~~…~~`, and `🍅` decoration) chooses. Returns `{ link, ambiguous }`:
// `link` is null when there is no candidate or the cursor is inside none of
// several, and `ambiguous` is true only for the latter.
function findSelectedTaskLinkOnLine(lineText, cursorCh) {
  const candidates = collectTaskLinkCandidates(lineText);
  if (candidates.length === 0) {
    return { link: null, ambiguous: false };
  }

  if (candidates.length === 1) {
    return { link: candidates[0], ambiguous: false };
  }

  let containing = candidates.filter(
    (candidate) =>
      cursorCh >= candidate.spanStartCh && cursorCh <= candidate.spanEndCh,
  );
  if (containing.length > 1) {
    containing = containing.filter((candidate) => cursorCh < candidate.spanEndCh);
  }

  return containing.length === 1
    ? { link: containing[0], ambiguous: false }
    : { link: null, ambiguous: true };
}

// Whether the list item holding `link` exists only to hold that link, so the
// whole bullet (and its children) can be deleted with it.
function isDedicatedTaskLinkBullet(lineText, link) {
  const line = normalizeMarkdownLine(lineText);
  const bounds = listItemBodyBounds(line);
  if (!bounds || link.startCh < bounds.start || link.endCh > bounds.end) {
    return false;
  }

  const before = DEDICATED_TASK_LINK_PREFIX_RE.exec(
    line.slice(bounds.start, link.startCh),
  );
  const after = DEDICATED_TASK_LINK_SUFFIX_RE.exec(line.slice(link.endCh, bounds.end));
  return Boolean(before && after && Boolean(before[1]) === Boolean(after[1]));
}

// The last line of the Pomodoro entry that owns `lineNumber` as a sub-bullet,
// or null when the line is not inside a Pomodoro entry's children.
function findOwningPomodoroEndLine(lines, lineNumber) {
  const section = findPomodorosSectionRange(lines);
  if (!section || lineNumber < section.startLine || lineNumber > section.endLine) {
    return null;
  }

  const fencedLines = computeFencedLineFlags(lines);
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    if (fencedLines[line] || !isPomodoroEntryLine(lines[line])) {
      continue;
    }

    const endLine = pomodoroEntryEndLine(lines, line, section.endLine);
    if (lineNumber <= endLine) {
      return lineNumber > line ? endLine : null;
    }

    line = endLine;
  }

  return null;
}

// Plan deleting the selected Task Link from `content`: the whole list item and
// its subtree for a dedicated link bullet (bounded by the owning Pomodoro, else
// the end of the note), otherwise just the token with its decoration. Returns
// `{ edit, kind, reference }` (absolute offsets; `reference` is the bare token)
// or null when `link` is no longer at `lineNumber`.
function planTaskLinkDeletion(content, lineNumber, link) {
  const snapshot = String(content || "");
  const lines = snapshot.split("\n");
  if (!link || !Number.isInteger(lineNumber) || lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  const lineText = normalizeMarkdownLine(lines[lineNumber]);
  if (lineText.slice(link.startCh, link.endCh) !== link.raw) {
    return null;
  }

  const lineStart = lineStartIndexFromLines(lines, lineNumber);
  const reference = { start: lineStart + link.startCh, end: lineStart + link.endCh };
  if (isDedicatedTaskLinkBullet(lineText, link)) {
    const rangeEndLine = findOwningPomodoroEndLine(lines, lineNumber);
    return {
      edit: listItemSubtreeEdit(
        snapshot,
        lines,
        lineNumber,
        rangeEndLine === null ? lines.length - 1 : rangeEndLine,
      ),
      kind: "subtree",
      reference,
    };
  }

  const removal = taskLinkRemovalRange(lineText, link.startCh, link.endCh);
  const edit = spanRemovalEdit(lineText, removal.start, removal.end);
  return {
    edit: {
      start: lineStart + edit.start,
      end: lineStart + edit.end,
      replacement: edit.replacement,
    },
    kind: "token",
    reference,
  };
}

// Drop every edit that another edit strictly covers (or duplicates, keeping
// the earlier one) so a subtree deletion can absorb the token deletions inside
// it. Only for link-deletion edits: status edits must never be absorbed.
function mergeCoveringEdits(edits) {
  return edits.filter(
    (edit, index) =>
      !edits.some((other, otherIndex) => {
        if (otherIndex === index || other.start > edit.start || other.end < edit.end) {
          return false;
        }

        return other.start < edit.start || other.end > edit.end || otherIndex < index;
      }),
  );
}

// Depends-On line recogniser (contract docs/task-dependencies.md section 2,
// DP vectors). Each plugin copies this small recogniser rather than importing
// it, since deployed plugins must not import one another's main.js. The line
// shape alone governs: writer form `⛓️ **DEPENDS ON:**` plus reader tolerance
// (legacy `🔗` emoji, missing emoji, missing VS16, `DEPENDENCIES` label, `•` /
// `·` / `,` / whitespace separators, aliased / struck / embedded links).
// Block links are found first and never split on separators, because an alias
// can contain one.
const TASK_DEPENDENCY_LINE_LINK_RE = /(?:~~)?!?(?:~~)?\[\[[^\]\n]+\]\](?:~~)?/g;
const TASK_DEPENDENCY_LINE_REMAINDER_RE =
  /^[ \t]*(?:⛓️?|🔗)?[ \t]*\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*[ \t•·,]*$/u;

function isTaskDependencyLine(lineText) {
  const line = normalizeMarkdownLine(lineText);
  const prefix = LIST_ITEM_PREFIX_RE.exec(line);
  if (!prefix) {
    return false;
  }
  const body = line.slice(prefix[0].length);
  TASK_DEPENDENCY_LINE_LINK_RE.lastIndex = 0;
  const remainder = body.replace(TASK_DEPENDENCY_LINE_LINK_RE, "");
  TASK_DEPENDENCY_LINE_LINK_RE.lastIndex = 0;
  if (remainder === body) {
    // No block links: only a bare label line (R9 empty) still counts.
    return TASK_DEPENDENCY_LINE_REMAINDER_RE.test(body);
  }
  return TASK_DEPENDENCY_LINE_REMAINDER_RE.test(remainder);
}

// A malformed Depends-On line (contract R10) is refused by
// Ctrl+Shift+Enter with the dependency notice instead of deleting the
// link token. Covers DP15 (half-typed link), DP16 (trailing prose), and
// DP31 (prose-only line, no link): the list marker and bold label shape
// are present but `isTaskDependencyLine` is false. DP23 (bare note link), DP25
// (heading link), and DP26 (separator-only) are malformed per the
// contract but stay guard-true through `isTaskDependencyLine` instead,
// so this stays false for them. Every not-a-line vector stays false
// here and unguarded: DP24 (link emoji with VS16 — a VS16 emoji is
// never a malformed label), DP27 (lowercase label, no match below),
// DP28 (no list marker), DP29 (blockquote, never matches the prefix).
function isMalformedTaskDependencyLine(lineText) {
  const line = normalizeMarkdownLine(lineText);
  if (!LIST_ITEM_PREFIX_RE.test(line)) {
    return false;
  }
  if (!/\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*/.test(line)) {
    return false;
  }
  // DP24: only the pre-label emoji counts, as in the ledger-tools
  // parser, so a VS16 sequence inside a link alias cannot trip it.
  const labelAt = line.search(/\*\*(?:DEPENDS ON|DEPENDENCIES):\*\*/);
  if (/🔗\uFE0F/.test(labelAt === -1 ? line : line.slice(0, labelAt))) {
    return false;
  }
  return !isTaskDependencyLine(lineText);
}

// An embedded link that is the sole content of a direct child bullet of a
// `#task` line is that task's rendered dependency transclusion. Deleting it
// alone would leave `[dependsOn:: …]` and the parent's Blocked state stale.
function isDependencyTransclusionLink(lines, lineNumber, link) {
  if (!link.embedded || !Array.isArray(lines) || !Number.isInteger(lineNumber)) {
    return false;
  }

  const lineText = normalizeMarkdownLine(lines[lineNumber]);
  if (!isSoleContentLinkBullet(lineText, link.startCh, link.endCh)) {
    return false;
  }

  const indent = lineIndentWidth(lineText);
  for (let line = lineNumber - 1; line >= 0; line -= 1) {
    const parentText = normalizeMarkdownLine(lines[line]);
    if (!parentText.trim() || lineIndentWidth(parentText) >= indent) {
      continue;
    }

    const parent = getObsidianTaskLineMatch(parentText);
    return Boolean(parent && PROJECT_TASK_TAG_RE.test(parent[2] || ""));
  }

  return false;
}

// ---------------------------------------------------------------------------
// Ctrl+Shift+Enter direct Pomodoro link: today's-daily-note resolution and
// destination-entry selection/insertion planning.
// ---------------------------------------------------------------------------

