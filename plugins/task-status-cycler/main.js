const { MarkdownView, Plugin } = require("obsidian");
const { EditorView } = require("@codemirror/view");

const TASKS_COMMAND_PREFIX = "obsidian-tasks-plugin:set-status-symbol-to-";
const TASKS_GLOBAL_FILTER = "#task";
const FIXED_SYMBOLS = [" ", "/", "B", "x", "-"];
const QUERY_CODE_BLOCK_LANGS = new Set(["tasks", "dataview", "dataviewjs"]);
const DEFAULT_HALF_PAGE_LINES = 20;
const TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)([^\]\n])(\])/;
const CONTINUATION_TASK_LINE_RE =
  /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+\[[^\]\n]\](?:[ \t]+|$)/;
const CONTINUATION_BULLET_LINE_RE = /^([ \t]*)[-+*](?:[ \t]+|$)/;
const LEADING_INDENT_RE = /^([ \t]*)/;
const COMPLETION_FIELD_RE = /[ \t]*\[completion::\s*[^\]\n]*\]/g;
const TRAILING_BLOCK_ID_RE = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/;
const EMBEDDED_WIKILINK_RE = /!\[\[([^\]\n]+)\]\]/g;
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;
// Conservative guards for recursive embedded Pomodoro source-task closure. The
// seen-set keyed by `path#^block-id` already stops cycles (A -> B -> A) and
// re-processing of shared targets; these caps just keep a pathologically deep
// chain or a huge accidental graph from running unbounded.
const MAX_TRANSCLUDED_RECURSION_DEPTH = 25;
const MAX_TRANSCLUDED_RECURSION_TARGETS = 250;
// Dependency-ID normalization: rewrite Tasks-generated `[id::]`/`[dependsOn::]`
// values to the target task's existing Obsidian block ID. See the SDD tale
// task_dependency_block_ids.md. The generated-ID heuristic matches Tasks
// 8.0.0's six-character base-36 helper; if Tasks changes it upstream we stop
// rewriting rather than risk touching intentional IDs.
const TRAILING_BLOCK_ID_CAPTURE_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const TASKS_GENERATED_ID_RE = /^[0-9a-z]{6}$/;
const INLINE_ID_FIELD_RE = /\[id::([ \t]*)([^\]\n]*?)([ \t]*)\]/;
const INLINE_DEPENDS_ON_FIELD_RE = /\[dependsOn::([ \t]*)([^\]\n]*?)([ \t]*)\]/g;
const DEPENDS_ON_ID_SEGMENT_RE = /^([ \t]*)([^ \t,]*)([ \t]*)$/;
const DEPENDENCY_NORMALIZE_DEBOUNCE_MS = 400;
const STANDALONE_BLOCK_ID_PREFIX_RE = "(^|[ \\t])";
const STANDALONE_BLOCK_ID_SUFFIX_RE = "(?=$|[ \\t])";
const MARKDOWN_EXTENSION_RE = /\.md$/i;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const TASK_CHECKBOX_MARKER_RE =
  /^([ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)\[[^\]\n]\]([ \t]*)(.*)$/;
const LIST_ITEM_MARKER_RE =
  /^([ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+)(.*)$/;
const POMODOROS_HEADING_RE = /^##\s+Pomodoros(?:\s.*)?$/;
const LEVEL_TWO_HEADING_RE = /^##\s+/;
const TOP_LEVEL_TASK_LINE_RE = /^(?:[-+*]|\d+[.)])\s+\[[^\]\n]\]/;
const INDENTED_LIST_LINE_RE = /^[ \t]+(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;
const TOP_LEVEL_DASH_LIST_TOGGLE_LINE_RE = /^-[ \t]+/;
// Any top-level (unindented, non-blockquoted) list item: dash/plus/star bullets,
// checklist items (which begin with one of those markers), and ordered items.
// Used to locate the last existing bullet block in a demotion target section.
const TOP_LEVEL_LIST_ITEM_LINE_RE = /^(?:[-+*]|\d+[.)])(?:[ \t]+|$)/;
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;
const POMODORO_PLACEHOLDER_RE = /\(\s*\)/;
const POMODORO_PLACEHOLDER_LINE = "- [ ] ()";
const EMPTY_POMODORO_SUB_BULLET_LINE = "\t- ";
const EMPTY_TASK_CHECKBOX_MARKER = "[ ] ";
// One Obsidian Tab-indent level for generated child bullets. A literal tab
// matches how Obsidian indents list items via Tab and the vault's dominant
// nested-list source style, unlike the prior two-space indent.
const CHILD_BULLET_INDENT_UNIT = "\t";
// Promotion uses CREATED_FIELD_RE to avoid adding a duplicate created field.
const CREATED_FIELD_RE = /\[created::\s*[^\]\n]*\]/;
const TASK_TAG_TEXT_RE = /#task/g;
const TASK_TAG_BOUNDARY_BEFORE_RE = /[A-Za-z0-9_/#-]/;
const TASK_TAG_BOUNDARY_AFTER_RE = /[A-Za-z0-9_/-]/;

function getLineIndentation(lineText) {
  const match = String(lineText || "").match(LEADING_INDENT_RE);
  return match ? match[1] : "";
}

function getOpenLineBelowPrefix(lineText) {
  const line = String(lineText || "");
  const taskMatch = line.match(CONTINUATION_TASK_LINE_RE);
  if (taskMatch) {
    return `${taskMatch[1]}- [ ] `;
  }

  const bulletMatch = line.match(CONTINUATION_BULLET_LINE_RE);
  if (bulletMatch) {
    return `${bulletMatch[1]}- `;
  }

  return getLineIndentation(line);
}

// Prefix for the Ctrl+Shift+o child-bullet open-line mapping. Unlike
// getOpenLineBelowPrefix(), this always emits a plain `- ` bullet one
// Obsidian Tab-indent level (CHILD_BULLET_INDENT_UNIT) deeper than the current
// line, never continuing a task or rewriting the current line's leading
// whitespace.
function getChildBulletOpenLinePrefix(lineText) {
  return `${getLineIndentation(lineText)}${CHILD_BULLET_INDENT_UNIT}- `;
}

function formatLocalDate(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeVimRepeat(value) {
  const repeat = Math.floor(Number(value === undefined ? 1 : value));
  return Number.isFinite(repeat) && repeat > 0 ? repeat : 1;
}

function getVimRepeat(actionArgs) {
  return normalizeVimRepeat(actionArgs && actionArgs.repeat);
}

function replaceTaskStatusSymbol(lineText, nextSymbol) {
  const line = String(lineText || "");
  const match = line.match(TASK_LINE_RE);
  if (!match) {
    return line;
  }

  return `${match[1]}${nextSymbol}${match[3]}${line.slice(match[0].length)}`;
}

function normalizeTaskStatusSymbol(symbol) {
  return symbol === "X" ? "x" : symbol;
}

function getTaskStatusForLine(lineText, lineNumber = 0) {
  const line = String(lineText || "");
  const match = line.match(TASK_LINE_RE);

  if (!match) {
    return null;
  }

  const rawSymbol = match[2];
  const statusStart = match[1].length;
  return {
    symbol: normalizeTaskStatusSymbol(rawSymbol),
    rawSymbol,
    line: lineNumber,
    lineText: line,
    statusStart,
    statusEnd: statusStart + rawSymbol.length,
  };
}

function isOpenDoneTaskStatus(taskStatus) {
  return !!taskStatus && (taskStatus.symbol === " " || taskStatus.symbol === "x");
}

function isTranscludedCompletionTraversableStatus(taskStatus) {
  return (
    !!taskStatus &&
    (taskStatus.symbol === " " ||
      taskStatus.symbol === "/" ||
      taskStatus.symbol === "x")
  );
}

function isTranscludedCompletionClosableStatus(taskStatus) {
  return !!taskStatus && (taskStatus.symbol === " " || taskStatus.symbol === "/");
}

function isNonTranscludedStartResolvableStatus(taskStatus) {
  return (
    !!taskStatus &&
    (taskStatus.symbol === " " ||
      taskStatus.symbol === "/" ||
      taskStatus.symbol === "x")
  );
}

function isNonTranscludedStartableStatus(taskStatus) {
  return !!taskStatus && taskStatus.symbol === " ";
}

function isTopLevelTaskLine(lineText) {
  return TOP_LEVEL_TASK_LINE_RE.test(String(lineText || ""));
}

function isTopLevelDashListToggleLine(lineText) {
  return TOP_LEVEL_DASH_LIST_TOGGLE_LINE_RE.test(String(lineText || ""));
}

function isTopLevelBulletLikeLine(lineText) {
  return TOP_LEVEL_LIST_ITEM_LINE_RE.test(String(lineText || ""));
}

function getNextOpenDoneSymbol(taskStatus) {
  if (!isOpenDoneTaskStatus(taskStatus)) {
    return null;
  }

  return taskStatus.symbol === " " ? "x" : " ";
}

function normalizeTaskMetadataSpacing(lineText) {
  const line = String(lineText || "");
  const blockIdMatch = line.match(TRAILING_BLOCK_ID_RE);
  if (!blockIdMatch) {
    return line.replace(/[ \t]+$/, "");
  }

  const beforeBlockId = line.slice(0, blockIdMatch.index).replace(/[ \t]+$/, "");
  return `${beforeBlockId} ${blockIdMatch[0].trim()}`;
}

function removeCompletionField(lineText) {
  return normalizeTaskMetadataSpacing(String(lineText || "").replace(COMPLETION_FIELD_RE, ""));
}

function isPlainStandaloneTaskTagAt(lineText, startIndex, endIndex) {
  const line = String(lineText || "");
  const before = startIndex > 0 ? line[startIndex - 1] : "";
  const after = endIndex < line.length ? line[endIndex] : "";
  return (
    (startIndex === 0 || !TASK_TAG_BOUNDARY_BEFORE_RE.test(before)) &&
    (endIndex === line.length || !TASK_TAG_BOUNDARY_AFTER_RE.test(after))
  );
}

function mergeTextRanges(ranges) {
  const sortedRanges = ranges
    .filter((range) => range && range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges[mergedRanges.length - 1];
    if (!previousRange || range.start > previousRange.end) {
      mergedRanges.push({ ...range });
      continue;
    }

    previousRange.end = Math.max(previousRange.end, range.end);
  }

  return mergedRanges;
}

function collectObsidianTaskTokenRanges(bodyText) {
  const body = String(bodyText || "");
  const ranges = [];
  let match;

  TASK_TAG_TEXT_RE.lastIndex = 0;
  while ((match = TASK_TAG_TEXT_RE.exec(body)) !== null) {
    const start = match.index;
    const end = start + TASKS_GLOBAL_FILTER.length;
    if (isPlainStandaloneTaskTagAt(body, start, end)) {
      ranges.push({ start, end });
    }
  }

  return mergeTextRanges(ranges);
}

function removeTextRanges(text, ranges) {
  const sourceText = String(text || "");
  let nextText = "";
  let cursor = 0;

  for (const range of mergeTextRanges(ranges)) {
    nextText += sourceText.slice(cursor, range.start);
    cursor = range.end;
  }

  return nextText + sourceText.slice(cursor);
}

function collapseWhitespaceOutsideBracketSpans(text) {
  const sourceText = String(text || "");
  let nextText = "";
  let bracketDepth = 0;
  let hasPendingWhitespace = false;

  for (const char of sourceText) {
    if (bracketDepth === 0 && /[ \t]/.test(char)) {
      hasPendingWhitespace = true;
      continue;
    }

    if (hasPendingWhitespace) {
      nextText += " ";
      hasPendingWhitespace = false;
    }

    nextText += char;

    if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    }
  }

  return nextText;
}

function cleanObsidianTaskBody(bodyText, tokenRanges = collectObsidianTaskTokenRanges(bodyText)) {
  const bodyWithoutTokens = removeTextRanges(bodyText, tokenRanges);
  const compactBody = collapseWhitespaceOutsideBracketSpans(bodyWithoutTokens);
  return normalizeTaskMetadataSpacing(compactBody).replace(/^[ \t]+/, "");
}

function lineHasCreatedField(lineText) {
  return CREATED_FIELD_RE.test(String(lineText || ""));
}

function getCursorChAfterTextEdits(cursorCh, nextLineText, edits) {
  const nextLine = String(nextLineText || "");
  const currentCh = Math.max(0, Math.floor(Number(cursorCh) || 0));
  const sortedEdits = Array.isArray(edits)
    ? edits
        .filter((edit) => edit && edit.start <= edit.end)
        .sort((left, right) => left.start - right.start || left.end - right.end)
    : [];
  let delta = 0;

  for (const edit of sortedEdits) {
    const replacementLength = String(edit.text || "").length;
    const removedLength = edit.end - edit.start;

    if (removedLength === 0) {
      if (currentCh >= edit.start) {
        delta += replacementLength;
      }
      continue;
    }

    if (currentCh <= edit.start) {
      break;
    }

    if (currentCh < edit.end) {
      return Math.max(0, Math.min(nextLine.length, edit.start + delta));
    }

    delta += replacementLength - removedLength;
  }

  return Math.max(0, Math.min(nextLine.length, currentCh + delta));
}

function isProperObsidianTaskLine(lineText) {
  const line = String(lineText || "");
  return TASK_CHECKBOX_MARKER_RE.test(line) && lineMatchesTasksGlobalFilterText(line);
}

function getDemoteObsidianTaskLineRewrite(lineText) {
  const line = String(lineText || "");
  const taskMatch = line.match(TASK_CHECKBOX_MARKER_RE);
  if (!taskMatch || !isProperObsidianTaskLine(line)) {
    return null;
  }

  const prefix = taskMatch[1];
  const body = taskMatch[3] || "";
  const markerStart = prefix.length;
  const markerEnd = line.length - body.length;
  const tokenRanges = collectObsidianTaskTokenRanges(body);
  const edits = [
    { start: markerStart, end: markerEnd, text: "" },
    ...tokenRanges.map((range) => ({
      start: markerEnd + range.start,
      end: markerEnd + range.end,
      text: "",
    })),
  ];

  return {
    sourceLineText: line,
    lineText: `${prefix}${cleanObsidianTaskBody(body, tokenRanges)}`,
    edits,
  };
}

function demoteObsidianTaskLine(lineText) {
  const rewrite = getDemoteObsidianTaskLineRewrite(lineText);
  return rewrite ? rewrite.lineText : null;
}

function addCreatedFieldToObsidianTaskLine(lineText, createdDateString) {
  const line = normalizeTaskMetadataSpacing(lineText);
  if (lineHasCreatedField(line)) {
    return line;
  }

  const createdField = `[created::${createdDateString || formatLocalDate()}]`;
  const blockIdMatch = line.match(TRAILING_BLOCK_ID_RE);
  if (!blockIdMatch) {
    return `${line} ${createdField}`;
  }

  const beforeBlockId = line.slice(0, blockIdMatch.index).replace(/[ \t]+$/, "");
  return `${beforeBlockId} ${createdField} ${blockIdMatch[0].trim()}`;
}

function getPromoteLineToObsidianTaskRewrite(lineText, createdDateString) {
  const line = String(lineText || "");
  const checkboxMatch = line.match(TASK_CHECKBOX_MARKER_RE);
  const listMatch = checkboxMatch ? null : line.match(LIST_ITEM_MARKER_RE);
  if (!checkboxMatch && !listMatch) {
    return null;
  }

  const edits = [];
  let nextLine = line;
  const hasTaskTag = lineMatchesTasksGlobalFilterText(line);

  if (checkboxMatch) {
    const body = checkboxMatch[3] || "";
    const markerEnd = line.length - body.length;
    const markerSpace = checkboxMatch[2] || "";
    const markerSpaceStart = markerEnd - markerSpace.length;
    const markerText = line.slice(0, markerSpaceStart);
    const markerSpaceText = " ";
    const taskTagText = hasTaskTag ? "" : `${TASKS_GLOBAL_FILTER} `;
    nextLine = `${markerText}${markerSpaceText}${taskTagText}${body}`;
    if (markerSpace !== markerSpaceText) {
      edits.push({
        start: markerSpaceStart,
        end: markerEnd,
        text: markerSpaceText,
      });
    }

    if (!hasTaskTag) {
      edits.push({ start: markerEnd, end: markerEnd, text: taskTagText });
    }
  } else {
    const prefix = listMatch[1];
    const body = listMatch[2] || "";
    const insertionText = `${EMPTY_TASK_CHECKBOX_MARKER}${hasTaskTag ? "" : `${TASKS_GLOBAL_FILTER} `}`;
    const insertionIndex = prefix.length;
    nextLine = `${prefix}${insertionText}${body}`;
    edits.push({ start: insertionIndex, end: insertionIndex, text: insertionText });
  }

  if (!lineHasCreatedField(nextLine)) {
    const createdField = `[created::${createdDateString || formatLocalDate()}]`;
    const blockIdMatch = line.match(TRAILING_BLOCK_ID_RE);
    const insertionIndex = blockIdMatch ? blockIdMatch.index : line.length;
    edits.push({
      start: insertionIndex,
      end: insertionIndex,
      text: ` ${createdField}`,
    });

    nextLine = addCreatedFieldToObsidianTaskLine(nextLine, createdDateString);
  }

  return {
    sourceLineText: line,
    lineText: nextLine,
    edits,
  };
}

function promoteLineToObsidianTask(lineText, createdDateString) {
  const rewrite = getPromoteLineToObsidianTaskRewrite(lineText, createdDateString);
  return rewrite ? rewrite.lineText : null;
}

function getObsidianTaskToggle(lineText, createdDateString) {
  const line = String(lineText || "");
  if (isProperObsidianTaskLine(line)) {
    return getDemoteObsidianTaskLineRewrite(line);
  }

  return getPromoteLineToObsidianTaskRewrite(line, createdDateString);
}

function getObsidianTaskToggleCursorCh(cursorCh, toggle) {
  if (!toggle) {
    return cursorCh;
  }

  return getCursorChAfterTextEdits(
    cursorCh,
    toggle.lineText,
    toggle.edits,
  );
}

const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HEADING_CLOSING_SEQUENCE_RE = /[ \t]+#+[ \t]*$/;
const YAML_FRONTMATTER_FENCE_RE = /^---[ \t]*$/;
const YAML_FRONTMATTER_END_RE = /^(?:---|\.\.\.)[ \t]*$/;
const CODE_FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CODE_FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const TASK_ROUTING_SECTION_TITLES = {
  tasks: "Tasks",
  futureWork: "Future Work",
};

function parseMarkdownHeadingLine(lineText) {
  const line = String(lineText || "");
  const match = line.match(ATX_HEADING_RE);
  if (!match) {
    return null;
  }

  const depth = match[1].length;
  const rawTitle = match[2] || "";
  const title = rawTitle.replace(HEADING_CLOSING_SEQUENCE_RE, "").trim();
  return { depth, title };
}

function findMarkdownHeadings(lines) {
  const headings = [];
  if (!Array.isArray(lines)) {
    return headings;
  }

  let inFrontmatter = false;
  let activeFence = null;

  for (let line = 0; line < lines.length; line += 1) {
    const lineText = String(lines[line] || "");

    if (line === 0 && YAML_FRONTMATTER_FENCE_RE.test(lineText)) {
      inFrontmatter = true;
      continue;
    }

    if (inFrontmatter) {
      if (YAML_FRONTMATTER_END_RE.test(lineText)) {
        inFrontmatter = false;
      }
      continue;
    }

    if (activeFence) {
      const closeMatch = lineText.match(CODE_FENCE_CLOSE_RE);
      if (
        closeMatch &&
        closeMatch[1][0] === activeFence.char &&
        closeMatch[1].length >= activeFence.length
      ) {
        activeFence = null;
      }
      continue;
    }

    const openMatch = lineText.match(CODE_FENCE_OPEN_RE);
    if (openMatch) {
      activeFence = { char: openMatch[1][0], length: openMatch[1].length };
      continue;
    }

    const heading = parseMarkdownHeadingLine(lineText);
    if (heading) {
      headings.push({ line, depth: heading.depth, title: heading.title });
    }
  }

  return headings;
}

function getMarkdownSectionFromHeadingIndex(lines, headings, index) {
  if (!Array.isArray(headings) || index < 0 || index >= headings.length) {
    return null;
  }

  const heading = headings[index];
  const total = Array.isArray(lines) ? lines.length : 0;
  let endLine = total;
  for (let next = index + 1; next < headings.length; next += 1) {
    if (headings[next].depth <= heading.depth) {
      endLine = headings[next].line;
      break;
    }
  }

  const nextHeadingLine =
    index + 1 < headings.length ? headings[index + 1].line : total;

  return {
    headingLine: heading.line,
    depth: heading.depth,
    endLine,
    nextHeadingLine,
    title: heading.title,
  };
}

function findNamedMarkdownSection(lines, title) {
  const headings = findMarkdownHeadings(lines);
  const index = headings.findIndex((heading) => heading.title === title);
  return getMarkdownSectionFromHeadingIndex(lines, headings, index);
}

// True when `line` falls in the direct body of a Markdown section: strictly
// after the heading and strictly before the next heading of any depth. Using
// section.nextHeadingLine (not section.endLine) means child headings nested
// under the section, such as a `### Future Work` below `## Tasks`, count as
// separate sections rather than part of the direct body.
function isLineInMarkdownSectionDirectBody(section, line) {
  if (!section || !Number.isInteger(line)) {
    return false;
  }
  return line > section.headingLine && line < section.nextHeadingLine;
}

// Find the first Markdown section whose heading appears at or after startLine in
// document order, regardless of the heading's depth or title. The demotion
// router calls this on the document with the source block already removed, so
// the first heading at/after the block's old position is the next section.
function findNextMarkdownSection(lines, startLine) {
  const headings = findMarkdownHeadings(lines);
  const target = Number.isInteger(startLine) ? startLine : 0;
  const index = headings.findIndex((heading) => heading.line >= target);
  return getMarkdownSectionFromHeadingIndex(lines, headings, index);
}

function findTaskRoutingSections(lines) {
  return {
    tasks: findNamedMarkdownSection(lines, TASK_ROUTING_SECTION_TITLES.tasks),
    futureWork: findNamedMarkdownSection(
      lines,
      TASK_ROUTING_SECTION_TITLES.futureWork,
    ),
  };
}

function getSectionInsertionLine(lines, section, options = {}) {
  if (!Array.isArray(lines) || !section) {
    return null;
  }

  const total = lines.length;
  const rawBoundary =
    options.stopAtChildHeadings === true
      ? section.nextHeadingLine
      : section.endLine;
  const boundary = Math.max(
    section.headingLine + 1,
    Math.min(rawBoundary, total),
  );

  let lastContentLine = -1;
  for (let line = boundary - 1; line > section.headingLine; line -= 1) {
    if (String(lines[line] || "").trim() !== "") {
      lastContentLine = line;
      break;
    }
  }

  if (lastContentLine >= 0) {
    return { insertLine: lastContentLine + 1, leadingBlank: false };
  }

  if (boundary > section.headingLine + 1) {
    return { insertLine: section.headingLine + 2, leadingBlank: false };
  }

  return { insertLine: section.headingLine + 1, leadingBlank: true };
}

// Insertion point for a demoted bullet within its target (next) section. The
// section's direct body runs from the heading to the next heading of any depth
// (section.nextHeadingLine) or EOF. The moved bullet lands after the last
// top-level bullet/checklist block in that body; when the body has none it
// becomes the section's first bullet, separated from the heading by exactly one
// blank line (without creating a duplicate blank when one already follows).
function getNextSectionBulletInsertion(lines, section) {
  if (!Array.isArray(lines) || !section) {
    return null;
  }

  const total = lines.length;
  const boundary = Math.max(
    section.headingLine + 1,
    Math.min(section.nextHeadingLine, total),
  );

  let lastBulletLine = -1;
  for (let line = section.headingLine + 1; line < boundary; line += 1) {
    if (isTopLevelBulletLikeLine(lines[line])) {
      lastBulletLine = line;
    }
  }

  if (lastBulletLine >= 0) {
    // Reuse the shared block scanner so the last bullet's child/continuation
    // lines move with it. It stops at blanks, headings, and the next top-level
    // line, so it never crosses the section boundary.
    const block = getListItemBlockRange(lines, lastBulletLine);
    return { insertLine: block.endLine + 1, leadingBlank: false };
  }

  const lineAfterHeading = section.headingLine + 1;
  if (
    lineAfterHeading < boundary &&
    String(lines[lineAfterHeading] || "").trim() === ""
  ) {
    return { insertLine: section.headingLine + 2, leadingBlank: false };
  }

  return { insertLine: section.headingLine + 1, leadingBlank: true };
}

function getListItemBlockRange(lines, activeLine) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(activeLine) ||
    activeLine < 0 ||
    activeLine >= lines.length
  ) {
    return null;
  }

  const activeIndent = getLineIndentation(lines[activeLine]).length;
  let endLine = activeLine;

  for (let line = activeLine + 1; line < lines.length; line += 1) {
    const lineText = String(lines[line] || "");
    if (lineText.trim() === "") {
      break;
    }
    if (parseMarkdownHeadingLine(lineText)) {
      break;
    }
    if (getLineIndentation(lineText).length <= activeIndent) {
      break;
    }

    endLine = line;
  }

  return { startLine: activeLine, endLine };
}

// Collect embedded block transclusions (`![[note#^id]]`, `![[#^id]]`) found on
// the descendant list-item lines of a resolved task's list-item block. The task
// line itself (range.startLine) is excluded so this returns the task's children,
// which is what recursive Pomodoro closure follows. Same-file `![[#^id]]` child
// links carry an empty pathPart and are resolved by the caller against the
// source file they were found in.
function collectEmbeddedTranscludedTaskTargetsInListItemBlock(sourceText, taskLine) {
  const lines = splitTextByLineEndings(sourceText).map((line) => line.text);
  const range = getListItemBlockRange(lines, taskLine);
  if (!range) {
    return [];
  }

  const targets = [];
  for (let line = range.startLine + 1; line <= range.endLine; line += 1) {
    for (const target of parseEmbeddedBlockTransclusions(lines[line])) {
      targets.push(target);
    }
  }

  return targets;
}

function getLineArrayReplacement(oldLines, newLines) {
  const before = Array.isArray(oldLines) ? oldLines : [];
  const after = Array.isArray(newLines) ? newLines : [];
  const beforeLength = before.length;
  const afterLength = after.length;

  let prefix = 0;
  const maxPrefix = Math.min(beforeLength, afterLength);
  while (prefix < maxPrefix && String(before[prefix]) === String(after[prefix])) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(beforeLength, afterLength) - prefix;
  while (
    suffix < maxSuffix &&
    String(before[beforeLength - 1 - suffix]) ===
      String(after[afterLength - 1 - suffix])
  ) {
    suffix += 1;
  }

  const removedEndExclusive = beforeLength - suffix;
  const insertEndExclusive = afterLength - suffix;
  if (prefix === removedEndExclusive && prefix === insertEndExclusive) {
    return null;
  }

  return {
    startLine: prefix,
    removedEndExclusive,
    lines: after.slice(prefix, insertEndExclusive),
  };
}

function getObsidianTaskToggleDocumentPlan(
  lines,
  activeLine,
  cursorCh,
  createdDateString,
) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(activeLine) ||
    activeLine < 0 ||
    activeLine >= lines.length
  ) {
    return null;
  }

  const sourceLineText = String(lines[activeLine] || "");
  const toggle = getObsidianTaskToggle(sourceLineText, createdDateString);
  if (!toggle) {
    return null;
  }

  const finalCursorCh = getObsidianTaskToggleCursorCh(cursorCh, toggle);
  const demoting = isProperObsidianTaskLine(sourceLineText);

  const inPlacePlan = {
    mode: "replace",
    line: activeLine,
    sourceLineText,
    lineText: toggle.lineText,
    cursorLine: activeLine,
    cursorCh: finalCursorCh,
    targetSection: null,
  };

  if (!isTopLevelDashListToggleLine(sourceLineText)) {
    return inPlacePlan;
  }

  // Promotion moves a converted bullet into the Tasks section when one exists
  // and the source line is not already in the direct Tasks body; demotion now
  // routes to the next section by document order and needs no named sections.
  if (!demoting) {
    const tasksSection = findNamedMarkdownSection(
      lines,
      TASK_ROUTING_SECTION_TITLES.tasks,
    );
    if (!tasksSection) {
      return inPlacePlan;
    }
    if (isLineInMarkdownSectionDirectBody(tasksSection, activeLine)) {
      return inPlacePlan;
    }
  }

  const block = getListItemBlockRange(lines, activeLine);
  const movedBlock = [
    toggle.lineText,
    ...lines.slice(activeLine + 1, block.endLine + 1),
  ];

  const remaining = lines
    .slice(0, block.startLine)
    .concat(lines.slice(block.endLine + 1));

  const seam = block.startLine;
  if (
    seam > 0 &&
    seam < remaining.length &&
    String(remaining[seam - 1] || "").trim() === "" &&
    String(remaining[seam] || "").trim() === ""
  ) {
    remaining.splice(seam, 1);
  }

  let targetSection;
  let insertion;
  if (demoting) {
    const nextSection = findNextMarkdownSection(remaining, block.startLine);
    if (!nextSection) {
      return inPlacePlan;
    }
    targetSection = "nextSection";
    insertion = getNextSectionBulletInsertion(remaining, nextSection);
  } else {
    const postTarget = findNamedMarkdownSection(
      remaining,
      TASK_ROUTING_SECTION_TITLES.tasks,
    );
    if (!postTarget) {
      return inPlacePlan;
    }
    targetSection = "tasks";
    insertion = getSectionInsertionLine(remaining, postTarget, {
      stopAtChildHeadings: true,
    });
  }

  if (!insertion) {
    return inPlacePlan;
  }

  const insertLines = insertion.leadingBlank
    ? ["", ...movedBlock]
    : movedBlock.slice();
  const nextLines = remaining
    .slice(0, insertion.insertLine)
    .concat(insertLines, remaining.slice(insertion.insertLine));

  const cursorLine = insertion.insertLine + (insertion.leadingBlank ? 1 : 0);
  const convertedFirstLine = String(nextLines[cursorLine] || "");
  const cursorColumn = Math.max(
    0,
    Math.min(convertedFirstLine.length, finalCursorCh),
  );

  return {
    mode: "move",
    nextLines,
    cursorLine,
    cursorCh: cursorColumn,
    sourceLineText,
    lineText: toggle.lineText,
    targetSection,
  };
}

function addOrReplaceCompletionField(lineText, completionDateString) {
  const completionField = `[completion:: ${completionDateString}]`;
  const lineWithoutCompletion = removeCompletionField(lineText);
  const blockIdMatch = lineWithoutCompletion.match(TRAILING_BLOCK_ID_RE);

  if (!blockIdMatch) {
    return `${lineWithoutCompletion}  ${completionField}`;
  }

  const beforeBlockId = lineWithoutCompletion
    .slice(0, blockIdMatch.index)
    .replace(/[ \t]+$/, "");
  return `${beforeBlockId}  ${completionField} ${blockIdMatch[0].trim()}`;
}

function rewriteTaskLineForLocalFallback(lineText, nextSymbol, completionDateString) {
  const lineWithNextSymbol = replaceTaskStatusSymbol(lineText, nextSymbol);

  if (nextSymbol === "x") {
    return addOrReplaceCompletionField(lineWithNextSymbol, completionDateString);
  }

  if (nextSymbol === " " || nextSymbol === "/") {
    return removeCompletionField(lineWithNextSymbol);
  }

  return lineWithNextSymbol;
}

function lineMatchesTasksGlobalFilterText(lineText) {
  const escapedFilter = TASKS_GLOBAL_FILTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagPattern = new RegExp(
    `(^|[^A-Za-z0-9_/#-])${escapedFilter}(?=$|/|[^A-Za-z0-9_-])`,
  );
  return tagPattern.test(String(lineText || ""));
}

function rewriteTaskLineForTranscludedSource(
  lineText,
  nextSymbol,
  completionDateString,
) {
  if (lineMatchesTasksGlobalFilterText(lineText)) {
    return rewriteTaskLineForLocalFallback(
      lineText,
      nextSymbol,
      completionDateString,
    );
  }

  return replaceTaskStatusSymbol(lineText, nextSymbol);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch (error) {
    return value;
  }
}

function stripWrappingQuotes(value) {
  const text = String(value || "").trim();
  if (text.length < 2) {
    return text;
  }

  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1).trim();
  }

  return text;
}

function normalizeTranscludedLinkTarget(value) {
  let target = stripWrappingQuotes(String(value || "").trim());
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }

  return safeDecodeUri(target);
}

function stripMarkdownExtensionFromPathPart(pathPart) {
  return String(pathPart || "").replace(MARKDOWN_EXTENSION_RE, "");
}

function parseTranscludedBlockTarget(rawTarget) {
  const target = normalizeTranscludedLinkTarget(rawTarget);
  const blockMarkerIndex = target.indexOf("#^");

  if (blockMarkerIndex === -1) {
    return null;
  }

  const rawPathPart = target.slice(0, blockMarkerIndex).trim();
  const blockId = target.slice(blockMarkerIndex + 2).trim();

  if (
    !BLOCK_ID_RE.test(blockId) ||
    rawPathPart.includes("#") ||
    rawPathPart.includes("^") ||
    URI_SCHEME_RE.test(rawPathPart)
  ) {
    return null;
  }

  return {
    target,
    pathPart: stripMarkdownExtensionFromPathPart(rawPathPart),
    blockId,
  };
}

function parseEmbeddedBlockTransclusions(lineText) {
  const line = String(lineText || "");
  const candidates = [];
  let match;

  EMBEDDED_WIKILINK_RE.lastIndex = 0;
  while ((match = EMBEDDED_WIKILINK_RE.exec(line)) !== null) {
    const rawTarget = String(match[1] || "").split("|")[0].trim();
    const parsedTarget = parseTranscludedBlockTarget(rawTarget);
    if (!parsedTarget) {
      continue;
    }

    candidates.push({
      ...parsedTarget,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return candidates;
}

function parseNonEmbeddedBlockLinks(lineText) {
  const line = String(lineText || "");
  const candidates = [];
  let match;

  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(line)) !== null) {
    if (match.index > 0 && line[match.index - 1] === "!") {
      continue;
    }

    const rawTarget = String(match[1] || "").split("|")[0].trim();
    const parsedTarget = parseTranscludedBlockTarget(rawTarget);
    if (!parsedTarget) {
      continue;
    }

    candidates.push({
      ...parsedTarget,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return candidates;
}

function getBareNonEmbeddedBlockLinkTargetFromListItem(lineText) {
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

function classifyPomodoroSubBullets(lines, range) {
  const transcludedTaskLinkBullets = [];
  const copyableTaskLinkBullets = [];
  const bareNonTranscludedTaskLinkBullets = [];
  const noteBullets = [];

  if (!Array.isArray(lines) || !range) {
    return {
      transcludedTaskLinkBullets,
      copyableTaskLinkBullets,
      bareNonTranscludedTaskLinkBullets,
      noteBullets,
    };
  }

  for (let line = range.startLine; line < range.endLine; line += 1) {
    const lineText = String(lines[line] || "");
    const embeddedTargets = parseEmbeddedBlockTransclusions(lineText);

    if (embeddedTargets.length > 0) {
      transcludedTaskLinkBullets.push({
        line,
        lineText,
        targets: embeddedTargets,
      });
      continue;
    }

    const nonEmbeddedTargets = parseNonEmbeddedBlockLinks(lineText);
    if (nonEmbeddedTargets.length > 0) {
      copyableTaskLinkBullets.push({
        line,
        lineText,
        targets: nonEmbeddedTargets,
      });

      const bareTarget = getBareNonEmbeddedBlockLinkTargetFromListItem(lineText);
      if (bareTarget) {
        bareNonTranscludedTaskLinkBullets.push({
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
    bareNonTranscludedTaskLinkBullets,
    noteBullets,
  };
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

function getPomodoroSubBulletTargetKeys(lines, range) {
  const keys = new Set();
  if (!Array.isArray(lines) || !range) {
    return keys;
  }

  for (let line = range.startLine; line < range.endLine; line += 1) {
    for (const key of getBlockLinkTargetKeysFromLine(lines[line])) {
      keys.add(key);
    }
  }

  return keys;
}

function getNonDuplicateCopyablePomodoroBullets(copyableBullets, existingKeys) {
  const keys = existingKeys instanceof Set ? new Set(existingKeys) : new Set();
  const copiedBullets = [];

  for (const bullet of Array.isArray(copyableBullets) ? copyableBullets : []) {
    const bulletKeys = getBlockLinkTargetKeys(bullet.targets);
    if (bulletKeys.some((key) => keys.has(key))) {
      continue;
    }

    copiedBullets.push(bullet.lineText);
    for (const key of bulletKeys) {
      keys.add(key);
    }
  }

  return copiedBullets;
}

function buildPomodoroCompletionPlan(lines, section, pomodoroLine) {
  if (!isPomodoroTaskLine(lines, section, pomodoroLine)) {
    return null;
  }

  const taskStatus = getTaskStatusForLine(lines[pomodoroLine], pomodoroLine);
  if (!taskStatus || taskStatus.symbol !== " ") {
    return null;
  }

  const sourceRange = getSubBulletBlockRange(lines, pomodoroLine, section);
  const sourceBullets = classifyPomodoroSubBullets(lines, sourceRange);
  const nextPomodoroLine = findNextPomodoroLine(lines, section, pomodoroLine);
  const edits = [
    {
      type: "replaceLine",
      line: pomodoroLine,
      sourceLineText: String(lines[pomodoroLine] || ""),
      lineText: replaceTaskStatusSymbol(lines[pomodoroLine], "x"),
    },
  ];
  // Only insert a fresh placeholder Pomodoro when there is something to carry
  // forward (one or more copyable, non-transcluded task-link bullets) or when
  // this is the last Pomodoro in the section. When a later Pomodoro already
  // exists and there are no copyable bullets, complete in place and jump the
  // cursor to that existing next Pomodoro instead of leaving an empty
  // placeholder between them. A created placeholder is inserted directly below
  // the completed Pomodoro's own sub-bullet block, carrying forward its
  // copyable bullets; existing lower Pomodoros are left untouched and pushed
  // down by the insertion.
  const copyableBulletLines = sourceBullets.copyableTaskLinkBullets.map(
    (bullet) => bullet.lineText,
  );
  const isLastPomodoro = nextPomodoroLine === null;
  const shouldCreatePomodoro = copyableBulletLines.length > 0 || isLastPomodoro;

  let createdPomodoro = false;
  let copiedBulletLines = [];
  let cursorTargetLine = nextPomodoroLine;

  if (shouldCreatePomodoro) {
    createdPomodoro = true;
    copiedBulletLines = copyableBulletLines;
    edits.push({
      type: "insertLines",
      line: sourceRange.endLine,
      lines: [
        POMODORO_PLACEHOLDER_LINE,
        ...(copiedBulletLines.length > 0
          ? copiedBulletLines
          : [EMPTY_POMODORO_SUB_BULLET_LINE]),
      ],
    });
    cursorTargetLine = sourceRange.endLine;
  }

  return {
    pomodoroLine,
    sourceRange,
    sourceBullets,
    nextPomodoroLine,
    createdPomodoro,
    cursorTargetLine,
    copiedBulletLines,
    edits,
  };
}

function getUnambiguousTranscludedBlockCandidate(candidates, cursorCh) {
  const matches = Array.isArray(candidates) ? candidates : [];
  if (matches.length === 1) {
    return matches[0];
  }

  const ch = Math.max(0, Math.floor(Number(cursorCh) || 0));
  const cursorMatches = matches.filter(
    (candidate) => ch >= candidate.startIndex && ch < candidate.endIndex,
  );
  return cursorMatches.length === 1 ? cursorMatches[0] : null;
}

function getStandaloneBlockIdRegex(blockId) {
  return new RegExp(
    `${STANDALONE_BLOCK_ID_PREFIX_RE}\\^${escapeRegExp(blockId)}${STANDALONE_BLOCK_ID_SUFFIX_RE}`,
  );
}

function lineContainsStandaloneBlockId(lineText, blockId) {
  if (!BLOCK_ID_RE.test(String(blockId || ""))) {
    return false;
  }

  return getStandaloneBlockIdRegex(blockId).test(String(lineText || ""));
}

function splitTextByLineEndings(text) {
  const sourceText = String(text || "");
  const lines = [];
  const lineRe = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match;

  while ((match = lineRe.exec(sourceText)) !== null) {
    if (match[0] === "" && match.index === sourceText.length) {
      break;
    }

    lines.push({
      text: match[1],
      ending: match[2],
    });

    if (match[2] === "") {
      break;
    }
  }

  return lines.length ? lines : [{ text: "", ending: "" }];
}

function getLineTextFromSourceText(sourceText, lineNumber) {
  const lineIndex = Math.floor(Number(lineNumber));
  if (!Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }

  const lines = splitTextByLineEndings(sourceText);
  return lines[lineIndex] ? lines[lineIndex].text : null;
}

function replaceLineInSourceText(sourceText, lineNumber, nextLineText) {
  const lineIndex = Math.floor(Number(lineNumber));
  if (!Number.isFinite(lineIndex) || lineIndex < 0) {
    return null;
  }

  const lines = splitTextByLineEndings(sourceText);
  if (!lines[lineIndex]) {
    return null;
  }

  lines[lineIndex] = {
    ...lines[lineIndex],
    text: String(nextLineText || ""),
  };
  return lines.map((line) => `${line.text}${line.ending}`).join("");
}

function findBlockLineInSourceText(sourceText, blockId) {
  const lines = splitTextByLineEndings(sourceText);
  for (let line = 0; line < lines.length; line += 1) {
    if (lineContainsStandaloneBlockId(lines[line].text, blockId)) {
      return line;
    }
  }

  return null;
}

function isTasksGeneratedId(value) {
  return TASKS_GENERATED_ID_RE.test(String(value || ""));
}

function getTrailingBlockId(lineText) {
  const match = String(lineText || "").match(TRAILING_BLOCK_ID_CAPTURE_RE);
  return match ? match[1] : null;
}

// Rewrite a target task line's Tasks-generated `[id:: <gen>]` to its trailing
// block ID. Returns { lineText, generatedId, blockId } when a rewrite applies,
// otherwise null. Only generated-shaped IDs paired with a block ID are touched,
// so user-authored IDs are preserved and the block ID stays the final token.
function rewriteGeneratedIdToBlockId(lineText) {
  const line = String(lineText || "");
  const blockId = getTrailingBlockId(line);
  if (!blockId) {
    return null;
  }

  const idMatch = line.match(INLINE_ID_FIELD_RE);
  if (!idMatch) {
    return null;
  }

  const leadingWs = idMatch[1];
  const idValue = idMatch[2];
  const trailingWs = idMatch[3];
  if (!isTasksGeneratedId(idValue) || idValue === blockId) {
    return null;
  }

  const nextField = `[id::${leadingWs}${blockId}${trailingWs}]`;
  const nextLineText =
    line.slice(0, idMatch.index) +
    nextField +
    line.slice(idMatch.index + idMatch[0].length);
  if (nextLineText === line) {
    return null;
  }

  return { lineText: nextLineText, generatedId: idValue, blockId };
}

// Rewrite `[dependsOn:: ...]` values on a single line using a
// generatedId -> blockId map. Comma-separated lists and whitespace variations
// are preserved; unmapped (e.g. user-authored) IDs are left untouched.
function rewriteDependsOnIdsInLine(lineText, idMap) {
  const line = String(lineText || "");
  if (!idMap || typeof idMap !== "object" || !Object.keys(idMap).length) {
    return line;
  }

  return line.replace(
    INLINE_DEPENDS_ON_FIELD_RE,
    (full, leadingWs, value, trailingWs) => {
      if (value === "") {
        return full;
      }

      let changed = false;
      const nextValue = value
        .split(",")
        .map((segment) => {
          const segmentMatch = segment.match(DEPENDS_ON_ID_SEGMENT_RE);
          if (!segmentMatch) {
            return segment;
          }

          const token = segmentMatch[2];
          if (
            token &&
            Object.prototype.hasOwnProperty.call(idMap, token) &&
            idMap[token] &&
            idMap[token] !== token
          ) {
            changed = true;
            return `${segmentMatch[1]}${idMap[token]}${segmentMatch[3]}`;
          }

          return segment;
        })
        .join(",");

      if (!changed) {
        return full;
      }

      return `[dependsOn::${leadingWs}${nextValue}${trailingWs}]`;
    },
  );
}

function rewriteDependsOnBlockIdsInText(sourceText, idMap) {
  const lines = splitTextByLineEndings(sourceText);
  let changed = false;
  const nextLines = lines.map((line) => {
    const nextText = rewriteDependsOnIdsInLine(line.text, idMap);
    if (nextText !== line.text) {
      changed = true;
    }
    return { ...line, text: nextText };
  });

  if (!changed) {
    return { text: String(sourceText || ""), changed: false };
  }

  return {
    text: nextLines.map((line) => `${line.text}${line.ending}`).join(""),
    changed: true,
  };
}

// Normalize an entire document: collect generatedId -> blockId mappings from
// target task lines, rewrite those `[id:: ...]` fields, and rewrite matching
// `[dependsOn:: ...]` values in the same document. Returns the (possibly
// unchanged) text, a changed flag, and the discovered mapping for cross-file
// propagation. Re-running on already-normalized text is a no-op (block IDs are
// not generated-shaped, or equal the ID), which keeps write loops from forming.
function normalizeTaskDependencyBlockIds(sourceText) {
  const lines = splitTextByLineEndings(sourceText);
  const idMap = {};

  for (const line of lines) {
    const rewrite = rewriteGeneratedIdToBlockId(line.text);
    if (rewrite) {
      idMap[rewrite.generatedId] = rewrite.blockId;
    }
  }

  let changed = false;
  const nextLines = lines.map((line) => {
    let text = line.text;
    const idRewrite = rewriteGeneratedIdToBlockId(text);
    if (idRewrite) {
      text = idRewrite.lineText;
    }
    text = rewriteDependsOnIdsInLine(text, idMap);
    if (text !== line.text) {
      changed = true;
    }
    return { ...line, text };
  });

  if (!changed) {
    return { text: String(sourceText || ""), changed: false, idMap };
  }

  return {
    text: nextLines.map((line) => `${line.text}${line.ending}`).join(""),
    changed: true,
    idMap,
  };
}

function numericLine(value) {
  const line = Math.floor(Number(value));
  return Number.isFinite(line) && line >= 0 ? line : null;
}

function getBlockCacheEntryLine(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const position = entry.position || entry.pos || null;
  const startPosition = position && (position.start || position);
  const directLine = numericLine(entry.line);
  const startLine = numericLine(entry.startLine);
  const positionLine = startPosition ? numericLine(startPosition.line) : null;

  if (positionLine !== null) {
    return positionLine;
  }
  if (startLine !== null) {
    return startLine;
  }
  return directLine;
}

function blockCacheEntryMatchesBlockId(entry, key, blockId) {
  if (String(key || "") === blockId) {
    return true;
  }

  if (!entry || typeof entry !== "object") {
    return false;
  }

  return [entry.id, entry.blockId, entry.block].some(
    (value) => String(value || "") === blockId,
  );
}

function addBlockCacheEntries(entries, value, key) {
  if (Array.isArray(value)) {
    for (const item of value) {
      addBlockCacheEntries(entries, item, key);
    }
    return;
  }

  entries.push({ entry: value, key });
}

function collectBlockCacheEntries(blocks) {
  const entries = [];
  if (!blocks) {
    return entries;
  }

  if (Array.isArray(blocks)) {
    for (const entry of blocks) {
      addBlockCacheEntries(entries, entry, null);
    }
    return entries;
  }

  if (blocks instanceof Map) {
    for (const [key, value] of blocks.entries()) {
      addBlockCacheEntries(entries, value, key);
    }
    return entries;
  }

  if (typeof blocks === "object") {
    for (const [key, value] of Object.entries(blocks)) {
      addBlockCacheEntries(entries, value, key);
    }
  }

  return entries;
}

function getBlockLineFromCache(fileCache, blockId) {
  const entries = collectBlockCacheEntries(fileCache && fileCache.blocks);

  for (const { entry, key } of entries) {
    if (!blockCacheEntryMatchesBlockId(entry, key, blockId)) {
      continue;
    }

    const line = getBlockCacheEntryLine(entry);
    if (line !== null) {
      return line;
    }
  }

  return null;
}

function getTaskCheckboxMarkerToggle(lineText) {
  const line = String(lineText || "");
  const taskMatch = line.match(TASK_CHECKBOX_MARKER_RE);

  if (taskMatch) {
    const prefix = taskMatch[1];
    const body = taskMatch[3] || "";
    const markerStart = prefix.length;
    const markerEnd = line.length - body.length;

    return {
      lineText: `${prefix}${body}`,
      markerStart,
      markerEnd,
      delta: markerStart - markerEnd,
    };
  }

  const listMatch = line.match(LIST_ITEM_MARKER_RE);
  if (!listMatch) {
    return null;
  }

  const prefix = listMatch[1];
  const body = listMatch[2] || "";

  return {
    lineText: `${prefix}${EMPTY_TASK_CHECKBOX_MARKER}${body}`,
    markerStart: prefix.length,
    markerEnd: prefix.length,
    delta: EMPTY_TASK_CHECKBOX_MARKER.length,
  };
}

function rewriteTaskCheckboxMarker(lineText) {
  const toggle = getTaskCheckboxMarkerToggle(lineText);
  return toggle ? toggle.lineText : null;
}

function getTaskCheckboxMarkerCursorCh(cursorCh, toggle) {
  if (!toggle) {
    return cursorCh;
  }

  const currentCh = Math.max(0, Math.floor(Number(cursorCh) || 0));
  let nextCh = currentCh;

  if (toggle.delta < 0) {
    if (currentCh > toggle.markerStart && currentCh < toggle.markerEnd) {
      nextCh = toggle.markerStart;
    } else if (currentCh >= toggle.markerEnd) {
      nextCh = currentCh + toggle.delta;
    }
  } else if (currentCh >= toggle.markerStart) {
    nextCh = currentCh + toggle.delta;
  }

  return Math.max(0, Math.min(toggle.lineText.length, nextCh));
}

// Alt-bracket whole-bullet formatting cycle. On non-checkbox list items the
// task-status cycle commands fall back to cycling the visible bullet body
// through normal -> bold -> italic -> strike (and the reverse), leaving the
// list marker, surrounding whitespace, and any trailing block id untouched.
// See the SDD tale obsidian_alt_bracket_bullet_formatting.md.
const BULLET_FORMAT_STATES = ["normal", "bold", "italic", "strike"];
const BULLET_FORMAT_MARKERS = {
  normal: "",
  bold: "**",
  italic: "*",
  strike: "~~",
};
// Detection accepts the canonical markers above plus common alternatives, but
// rewrites only emit canonical markers so repeated cycling normalizes the line.
const BULLET_FORMAT_DETECTORS = [
  { state: "bold", marker: "**" },
  { state: "bold", marker: "__" },
  { state: "strike", marker: "~~" },
  { state: "italic", marker: "*" },
  { state: "italic", marker: "_" },
];

function isBodyWrappedWithMarker(text, marker) {
  const body = String(text || "");
  if (body.length < marker.length * 2 + 1) {
    return false;
  }
  if (!body.startsWith(marker) || !body.endsWith(marker)) {
    return false;
  }

  const inner = body.slice(marker.length, body.length - marker.length);
  // A premature copy of the marker inside means this is not a single whole-body
  // span (e.g. `**a** **b**`), so it does not define the bullet state.
  return inner.length > 0 && !inner.includes(marker);
}

function parseWholeBulletFormat(coreText) {
  const core = String(coreText || "");
  for (const { state, marker } of BULLET_FORMAT_DETECTORS) {
    if (isBodyWrappedWithMarker(core, marker)) {
      return {
        state,
        content: core.slice(marker.length, core.length - marker.length),
        openMarker: marker,
        closeMarker: marker,
      };
    }
  }

  return { state: "normal", content: core, openMarker: "", closeMarker: "" };
}

function splitTrailingBlockIdFromBody(bodyText) {
  const body = String(bodyText || "");
  const match = body.match(TRAILING_BLOCK_ID_RE);
  if (!match) {
    return { content: body, blockIdSuffix: "" };
  }

  return {
    content: body.slice(0, match.index),
    blockIdSuffix: body.slice(match.index),
  };
}

function getWholeBulletFormatState(bodyText) {
  const { content } = splitTrailingBlockIdFromBody(String(bodyText || ""));
  return parseWholeBulletFormat(content.trim()).state;
}

function getAdjacentBulletFormatState(currentState, direction) {
  const index = BULLET_FORMAT_STATES.indexOf(currentState);
  if (index === -1 || BULLET_FORMAT_STATES.length < 2) {
    return null;
  }

  const step = direction < 0 ? -1 : 1;
  const nextIndex =
    (index + step + BULLET_FORMAT_STATES.length) % BULLET_FORMAT_STATES.length;
  return BULLET_FORMAT_STATES[nextIndex];
}

function getPlainListItemFormattingTarget(lineText) {
  const line = String(lineText || "");
  if (TASK_CHECKBOX_MARKER_RE.test(line)) {
    return null;
  }

  const match = line.match(LIST_ITEM_MARKER_RE);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  const body = match[2] || "";
  const { content, blockIdSuffix } = splitTrailingBlockIdFromBody(body);
  if (content.trim() === "") {
    return null;
  }

  return {
    prefix,
    body,
    content,
    blockIdSuffix,
    bodyStart: prefix.length,
  };
}

function getPlainBulletFormatToggle(lineText, direction) {
  const line = String(lineText || "");
  const target = getPlainListItemFormattingTarget(line);
  if (!target) {
    return null;
  }

  const leadingWs = (target.content.match(/^[ \t]*/) || [""])[0];
  const trailingWs = (target.content.match(/[ \t]*$/) || [""])[0];
  const core = target.content.slice(
    leadingWs.length,
    target.content.length - trailingWs.length,
  );
  if (core === "") {
    return null;
  }

  const parsed = parseWholeBulletFormat(core);
  const nextState = getAdjacentBulletFormatState(parsed.state, direction);
  if (!nextState || nextState === parsed.state) {
    return null;
  }

  const nextMarker = BULLET_FORMAT_MARKERS[nextState];
  const coreStart = target.bodyStart + leadingWs.length;
  const contentStart = coreStart + parsed.openMarker.length;
  const contentEnd = contentStart + parsed.content.length;

  // Emit marker-level edits (insert/delete/replace at each end of the content)
  // so the edit-aware cursor helper keeps the caret on the same visible text.
  const edits = [];
  if (parsed.openMarker !== nextMarker) {
    edits.push({
      start: coreStart,
      end: coreStart + parsed.openMarker.length,
      text: nextMarker,
    });
  }
  if (parsed.closeMarker !== nextMarker) {
    edits.push({
      start: contentEnd,
      end: contentEnd + parsed.closeMarker.length,
      text: nextMarker,
    });
  }

  const newCore = `${nextMarker}${parsed.content}${nextMarker}`;
  const nextLineText = `${target.prefix}${leadingWs}${newCore}${trailingWs}${target.blockIdSuffix}`;

  return {
    sourceLineText: line,
    lineText: nextLineText,
    edits,
  };
}

function getEditorViewFromEditor(editorOrCm) {
  // Resolve the underlying CodeMirror 6 EditorView from every editor shape this
  // codebase hands us: the codemirror-vim CM5 adapter (its CM6 view is `.cm6`),
  // an Obsidian Editor (its CM6 view is `.cm`), or a raw EditorView (itself).
  const editorView =
    editorOrCm && (editorOrCm.cm6 || editorOrCm.cm || editorOrCm);
  if (
    !editorView ||
    !editorView.state ||
    !editorView.state.doc ||
    typeof editorView.dispatch !== "function"
  ) {
    return null;
  }

  return editorView;
}

function editorViewPositionFromLineCh(editorView, line, ch) {
  const doc = editorView && editorView.state && editorView.state.doc;
  if (!doc || typeof doc.line !== "function") {
    return null;
  }

  const lineCount = Number.isInteger(doc.lines) && doc.lines > 0 ? doc.lines : 1;
  const safeLine = Math.min(
    Math.max(Math.floor(Number(line) || 0), 0),
    lineCount - 1,
  );

  let lineInfo;
  try {
    lineInfo = doc.line(safeLine + 1);
  } catch (error) {
    return null;
  }

  if (
    !lineInfo ||
    !Number.isInteger(lineInfo.from) ||
    !Number.isInteger(lineInfo.to)
  ) {
    return null;
  }

  const maxCh = Math.max(lineInfo.to - lineInfo.from, 0);
  const safeCh = Math.min(Math.max(Math.floor(Number(ch) || 0), 0), maxCh);
  return lineInfo.from + safeCh;
}

function centerEditorViewOnPosition(editorView, line, ch) {
  if (
    !editorView ||
    typeof editorView.dispatch !== "function" ||
    !EditorView ||
    typeof EditorView.scrollIntoView !== "function"
  ) {
    return false;
  }

  const position = editorViewPositionFromLineCh(editorView, line, ch);
  if (position === null) {
    return false;
  }

  try {
    editorView.dispatch({
      effects: EditorView.scrollIntoView(position, {
        y: "center",
        x: "nearest",
      }),
    });
  } catch (error) {
    return false;
  }

  return true;
}

// Bounded number of animation frames to wait for the target editor view to
// attach before falling back to an editor-level reveal. One frame is usually
// enough for the active editor; the small budget only covers the rare case
// where the CM6 view lags by a frame right after the completion edits.
const CENTER_ON_LINE_ATTEMPTS = 5;

// Defer `callback` past the current synchronous turn (e.g. the codemirror-vim
// command cycle) so any scroll it dispatches runs after Vim's own trailing
// "keep cursor visible" scroll. Returns a handle that cancelDeferred can clear.
function deferToNextFrame(callback) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    return { type: "raf", handle: window.requestAnimationFrame(callback) };
  }

  return { type: "timeout", handle: setTimeout(callback, 0) };
}

function cancelDeferred(deferred) {
  if (!deferred) {
    return;
  }

  if (
    deferred.type === "raf" &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(deferred.handle);
    return;
  }

  if (deferred.type === "timeout") {
    clearTimeout(deferred.handle);
  }
}

module.exports = class TaskStatusCyclerPlugin extends Plugin {
  onload() {
    // Handle for a deferred `zz`-style center of the newly created Pomodoro
    // placeholder after a completion keymap. Tracked so repeated presses cancel
    // the previous pending center instead of stacking stale scrolls.
    this.pendingPomodoroCenterDeferred = null;

    this.addCommand({
      id: "cycle-task-status-forward",
      name: "Cycle task status forward",
      editorCheckCallback: (checking, editor, view) =>
        this.handleCycleCommand(checking, editor, view, 1),
    });

    this.addCommand({
      id: "cycle-task-status-backward",
      name: "Cycle task status backward",
      editorCheckCallback: (checking, editor, view) =>
        this.handleCycleCommand(checking, editor, view, -1),
    });

    this.addCommand({
      id: "open-child-bullet-line-below",
      name: "Open child bullet line below",
      editorCheckCallback: (checking, editor, view) =>
        this.handleOpenChildBulletLineCommand(checking, editor, view, "below"),
    });

    this.addCommand({
      id: "open-child-bullet-line-above",
      name: "Open child bullet line above",
      editorCheckCallback: (checking, editor, view) =>
        this.handleOpenChildBulletLineCommand(checking, editor, view, "above"),
    });

    this.registerChildBulletInputListeners();
    this.registerTranscludedTaskStartInputListeners();

    this.addCommand({
      id: "toggle-task-open-done",
      name: "Toggle task open/done",
      editorCheckCallback: (checking, editor, view) =>
        this.handleToggleOpenDoneCommand(checking, editor, view),
    });

    this.addCommand({
      id: "toggle-task-checkbox-marker",
      name: "Toggle task checkbox marker",
      editorCheckCallback: (checking, editor, view) =>
        this.handleToggleCheckboxMarkerCommand(checking, editor, view),
    });

    this.addCommand({
      id: "toggle-obsidian-task",
      name: "Toggle Obsidian task",
      editorCheckCallback: (checking, editor, view) =>
        this.handleToggleObsidianTaskCommand(checking, editor, view),
    });

    // Normalize Tasks-generated dependency IDs to block IDs after Tasks writes
    // `[id::]`/`[dependsOn::]`. The active editor handles the common same-file
    // flow; vault modify events cover cross-file dependency creation.
    this.activeEditorDependencyTimer = null;
    this.vaultDependencyTimers = new Map();
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        this.scheduleActiveEditorDependencyNormalize(editor, info);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.scheduleVaultFileDependencyNormalize(file);
      }),
    );

    this.vimMappingsRegistered = false;
    this.app.workspace.onLayoutReady(() => {
      if (this.registerVimMappings()) {
        return;
      }

      const ref = this.app.workspace.on("active-leaf-change", () => {
        if (this.registerVimMappings()) {
          this.app.workspace.offref(ref);
        }
      });
      this.registerEvent(ref);
    });
  }

  onunload() {
    if (this.pendingPomodoroCenterDeferred) {
      cancelDeferred(this.pendingPomodoroCenterDeferred);
      this.pendingPomodoroCenterDeferred = null;
    }
    if (this.activeEditorDependencyTimer) {
      window.clearTimeout(this.activeEditorDependencyTimer);
      this.activeEditorDependencyTimer = null;
    }
    if (this.vaultDependencyTimers) {
      for (const timer of this.vaultDependencyTimers.values()) {
        window.clearTimeout(timer);
      }
      this.vaultDependencyTimers.clear();
    }
  }

  scheduleActiveEditorDependencyNormalize(editor, info) {
    if (!editor) {
      return;
    }

    const file =
      (info && info.file) ||
      (this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);

    if (this.activeEditorDependencyTimer) {
      window.clearTimeout(this.activeEditorDependencyTimer);
    }
    this.activeEditorDependencyTimer = window.setTimeout(() => {
      this.activeEditorDependencyTimer = null;
      Promise.resolve(
        this.normalizeActiveEditorDependencyBlockIds(editor, file),
      ).catch(() => {});
    }, DEPENDENCY_NORMALIZE_DEBOUNCE_MS);
  }

  scheduleVaultFileDependencyNormalize(file) {
    if (!file || !file.path || !MARKDOWN_EXTENSION_RE.test(file.path)) {
      return;
    }

    if (!this.vaultDependencyTimers) {
      this.vaultDependencyTimers = new Map();
    }

    const path = file.path;
    if (this.vaultDependencyTimers.has(path)) {
      window.clearTimeout(this.vaultDependencyTimers.get(path));
    }
    const timer = window.setTimeout(() => {
      this.vaultDependencyTimers.delete(path);
      Promise.resolve(
        this.normalizeVaultFileDependencyBlockIds(file),
      ).catch(() => {});
    }, DEPENDENCY_NORMALIZE_DEBOUNCE_MS);
    this.vaultDependencyTimers.set(path, timer);
  }

  async normalizeActiveEditorDependencyBlockIds(editor, file) {
    if (!editor || typeof editor.getLine !== "function") {
      return false;
    }

    const oldLines = this.getEditorLineArray(editor);
    const result = normalizeTaskDependencyBlockIds(oldLines.join("\n"));

    if (result.changed) {
      const nextLines = result.text.split("\n");
      const cursor =
        typeof editor.getCursor === "function" ? editor.getCursor() : null;

      for (
        let line = 0;
        line < nextLines.length && line < oldLines.length;
        line += 1
      ) {
        if (
          nextLines[line] !== oldLines[line] &&
          typeof editor.replaceRange === "function"
        ) {
          editor.replaceRange(
            nextLines[line],
            { line, ch: 0 },
            { line, ch: oldLines[line].length },
          );
        }
      }

      if (cursor && typeof editor.setCursor === "function") {
        const cursorLineText =
          typeof editor.getLine === "function"
            ? editor.getLine(cursor.line) || ""
            : "";
        editor.setCursor({
          line: cursor.line,
          ch: Math.max(0, Math.min(cursor.ch, cursorLineText.length)),
        });
      }
    }

    await this.propagateDependencyBlockIds(result.idMap, file);
    return result.changed;
  }

  async normalizeVaultFileDependencyBlockIds(file) {
    if (!file || !this.app.vault) {
      return;
    }

    // Route the active file through the editor path so the cursor stays stable
    // and we never clobber an open editor buffer with a disk write.
    const activeView =
      this.app.workspace &&
      typeof this.app.workspace.getActiveViewOfType === "function"
        ? this.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
    if (
      activeView &&
      activeView.editor &&
      activeView.file &&
      activeView.file.path === file.path
    ) {
      await this.normalizeActiveEditorDependencyBlockIds(activeView.editor, file);
      return;
    }

    let idMap = {};
    await this.processVaultFileText(file, (text) => {
      const result = normalizeTaskDependencyBlockIds(text);
      idMap = result.idMap || {};
      return result.changed ? result.text : text;
    });

    await this.propagateDependencyBlockIds(idMap, file);
  }

  async propagateDependencyBlockIds(idMap, originFile) {
    const ids = idMap ? Object.keys(idMap) : [];
    if (
      !ids.length ||
      !this.app.vault ||
      typeof this.app.vault.getMarkdownFiles !== "function"
    ) {
      return;
    }

    const originPath = originFile && originFile.path ? originFile.path : null;
    const remaining = new Set(ids);

    const allFiles = this.app.vault.getMarkdownFiles();
    const openPaths = new Set(this.getOpenMarkdownFilePaths());
    // Narrow pass over open/current files first, then the rest of the vault.
    const orderedFiles = [
      ...allFiles.filter((candidate) => candidate && openPaths.has(candidate.path)),
      ...allFiles.filter((candidate) => candidate && !openPaths.has(candidate.path)),
    ];

    for (const candidate of orderedFiles) {
      if (!remaining.size) {
        break;
      }
      if (!candidate || candidate.path === originPath) {
        continue;
      }

      let cachedText;
      try {
        cachedText =
          typeof this.app.vault.cachedRead === "function"
            ? await this.app.vault.cachedRead(candidate)
            : await this.app.vault.read(candidate);
      } catch (error) {
        continue;
      }

      const present = [...remaining].filter((id) => cachedText.includes(id));
      if (!present.length) {
        continue;
      }

      const subset = {};
      for (const id of present) {
        subset[id] = idMap[id];
      }

      const changed = await this.processVaultFileText(candidate, (text) => {
        const rewrite = rewriteDependsOnBlockIdsInText(text, subset);
        return rewrite.changed ? rewrite.text : text;
      });

      if (changed) {
        for (const id of present) {
          remaining.delete(id);
        }
      }
    }
  }

  getOpenMarkdownFilePaths() {
    const paths = [];
    if (!this.app.workspace) {
      return paths;
    }

    if (typeof this.app.workspace.getActiveFile === "function") {
      const active = this.app.workspace.getActiveFile();
      if (active && active.path) {
        paths.push(active.path);
      }
    }

    if (typeof this.app.workspace.getLeavesOfType === "function") {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const leafFile = leaf && leaf.view && leaf.view.file;
        if (leafFile && leafFile.path) {
          paths.push(leafFile.path);
        }
      }
    }

    return paths;
  }

  async processVaultFileText(file, transform) {
    if (!file || !this.app.vault || typeof transform !== "function") {
      return false;
    }

    let changed = false;
    const applyTransform = (text) => {
      const next = transform(text);
      if (typeof next === "string" && next !== text) {
        changed = true;
        return next;
      }
      return text;
    };

    try {
      if (typeof this.app.vault.process === "function") {
        await this.app.vault.process(file, applyTransform);
        return changed;
      }

      if (
        typeof this.app.vault.read !== "function" ||
        typeof this.app.vault.modify !== "function"
      ) {
        return false;
      }

      const text = await this.app.vault.read(file);
      const nextText = applyTransform(text);
      if (!changed) {
        return false;
      }

      await this.app.vault.modify(file, nextText);
      return true;
    } catch (error) {
      return false;
    }
  }

  registerVimMappings() {
    if (this.vimMappingsRegistered) {
      return true;
    }

    const vim = window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
    if (!vim) {
      return false;
    }

    vim.defineAction("taskStatusCyclerOpenNextLineLink", (cm, actionArgs) =>
      this.handleVimEnterLinkOrFallthrough(cm, actionArgs),
    );
    vim.defineAction("taskStatusCyclerToggleTaskOpenDone", (cm) =>
      this.handleVimTaskToggleOpenDone(cm),
    );
    vim.defineAction("taskStatusCyclerToggleOpenDone", (cm) =>
      this.handleVimTaskToggleOpenDone(cm),
    );
    vim.defineAction("taskStatusCyclerToggleCheckboxMarker", () =>
      this.handleVimToggleCheckboxMarker(),
    );
    vim.defineAction("taskStatusCyclerToggleObsidianTask", () =>
      this.handleVimToggleObsidianTask(),
    );
    vim.defineAction("taskStatusCyclerOpenLineBelow", (cm) =>
      this.handleVimOpenLineBelow(cm),
    );
    vim.defineAction("taskStatusCyclerOpenLineAbove", (cm) =>
      this.handleVimOpenLineAbove(cm),
    );
    vim.defineAction("taskStatusCyclerOpenPreviousLineLink", (cm, actionArgs) =>
      this.handleVimBackspaceLinkOrFallthrough(cm, actionArgs),
    );
    vim.mapCommand("<CR>", "action", "taskStatusCyclerOpenNextLineLink", {}, {
      context: "normal",
    });
    for (const key of ["<C-CR>", "<C-Enter>"]) {
      vim.mapCommand(key, "action", "taskStatusCyclerToggleTaskOpenDone", {}, {
        context: "normal",
      });
    }
    vim.mapCommand("<C-]>", "action", "taskStatusCyclerToggleCheckboxMarker", {}, {
      context: "normal",
    });
    for (const key of ["<C-}>", "<C-S-]>"]) {
      vim.mapCommand(key, "action", "taskStatusCyclerToggleObsidianTask", {}, {
        context: "normal",
      });
    }
    vim.mapCommand(
      "<BS>",
      "action",
      "taskStatusCyclerOpenPreviousLineLink",
      {},
      { context: "normal" },
    );
    vim.mapCommand("o", "action", "taskStatusCyclerOpenLineBelow", {}, {
      context: "normal",
    });
    vim.mapCommand("O", "action", "taskStatusCyclerOpenLineAbove", {}, {
      context: "normal",
    });
    this.registerVimNavigationMappings(vim);

    this.vimMappingsRegistered = true;
    return true;
  }

  registerVimNavigationMappings(vim) {
    vim.defineAction("taskStatusCyclerHalfPageDownSkipQueries", (cm) =>
      this.handleVimHalfPageSkipQueries(cm, 1),
    );
    vim.defineAction("taskStatusCyclerHalfPageUpSkipQueries", (cm) =>
      this.handleVimHalfPageSkipQueries(cm, -1),
    );

    vim.mapCommand(
      "<C-d>",
      "action",
      "taskStatusCyclerHalfPageDownSkipQueries",
      {},
      { context: "normal" },
    );
    vim.mapCommand(
      "<C-u>",
      "action",
      "taskStatusCyclerHalfPageUpSkipQueries",
      {},
      { context: "normal" },
    );
  }

  handleVimEnterLinkOrFallthrough(cm, actionArgs) {
    const repeat = getVimRepeat(actionArgs);
    if (this.handleVimEnterLinkAction(cm, actionArgs)) {
      return;
    }

    this.vimEnterFallthrough(cm, repeat);
  }

  handleVimTaskToggleOpenDone() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    const taskStatus = this.getActiveTaskStatus(view.editor);
    const activeFile = view.file || this.app.workspace.getActiveFile();
    const pomodoroContext =
      activeFile && taskStatus && taskStatus.symbol === " "
        ? this.getActivePomodoroTaskContext(view.editor, taskStatus)
        : null;
    if (pomodoroContext) {
      void this.completeActivePomodoroTask(
        view.editor,
        activeFile,
        pomodoroContext,
        view,
      ).catch(() => false);
      return;
    }

    if (this.isOpenDoneTaskStatus(taskStatus)) {
      this.toggleActiveCheckboxOpenDone(view.editor, taskStatus);
      return;
    }

    // A transcluded task link that is a Pomodoro sub-bullet closes its whole
    // embedded target tree recursively; any other transcluded line keeps the
    // single-target open/done toggle.
    void (async () => {
      const handled = await this.completeActivePomodoroTranscludedTaskLine(
        view.editor,
        activeFile,
      );
      if (!handled) {
        const started = await this.startActivePomodoroNonTranscludedTaskLine(
          view.editor,
          activeFile,
        );
        if (!started) {
          await this.toggleActiveTranscludedTaskOpenDone(view.editor, activeFile);
        }
      }
    })().catch(() => false);
  }

  handleVimToggleCheckboxMarker() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    this.toggleActiveCheckboxMarker(view.editor);
  }

  handleVimToggleObsidianTask() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return;
    }

    this.toggleActiveObsidianTask(view.editor, undefined, view);
  }

  handleVimBackspaceLinkOrFallthrough(cm, actionArgs) {
    const repeat = getVimRepeat(actionArgs);
    if (this.handleVimBackspaceLinkAction(cm, actionArgs)) {
      return;
    }

    this.vimBackspaceFallthrough(cm, repeat);
  }

  handleVimEnterLinkAction(cm, actionArgs) {
    const navigationPlugin =
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["bob-navigation-hotkeys"];
    if (
      !navigationPlugin ||
      typeof navigationPlugin.handleVimEnterLinkAction !== "function"
    ) {
      return false;
    }

    try {
      return navigationPlugin.handleVimEnterLinkAction(cm, actionArgs) === true;
    } catch (error) {
      return false;
    }
  }

  handleVimBackspaceLinkAction(cm, actionArgs) {
    const navigationPlugin =
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["bob-navigation-hotkeys"];
    if (
      !navigationPlugin ||
      typeof navigationPlugin.handleVimBackspaceLinkAction !== "function"
    ) {
      return false;
    }

    try {
      return (
        navigationPlugin.handleVimBackspaceLinkAction(cm, actionArgs) === true
      );
    } catch (error) {
      return false;
    }
  }

  handleVimHalfPageSkipQueries(cm, direction) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const firstLine = this.getCodeMirrorFirstLine(cm);
    const lastLine = this.getCodeMirrorLastLine(cm);
    const lineCount = this.getHalfPageLineCount(cm);
    const rawTargetLine = this.clampLine(
      cursor.line + direction * lineCount,
      firstLine,
      lastLine,
    );
    const queryBlocks = this.findQueryCodeBlocks(cm);
    const targetLine = this.findNearestNonQueryLine(
      queryBlocks,
      rawTargetLine,
      direction,
      firstLine,
      lastLine,
    );
    const lineText =
      typeof cm.getLine === "function" ? cm.getLine(targetLine) || "" : "";
    const targetCh = Math.min(Math.max(cursor.ch || 0, 0), lineText.length);

    cm.setCursor(targetLine, targetCh);
    if (typeof cm.scrollIntoView === "function") {
      cm.scrollIntoView({ line: targetLine, ch: targetCh });
    }
  }

  handleVimOpenLineBelow(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const continuationPrefix = getOpenLineBelowPrefix(lineText);
    const targetLine = cursor.line + 1;
    const targetCh = continuationPrefix.length;

    cm.replaceRange("\n" + continuationPrefix, {
      line: cursor.line,
      ch: lineText.length,
    });
    cm.setCursor(targetLine, targetCh);
    this.enterVimInsertMode(cm);
  }

  handleVimOpenLineAbove(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const continuationPrefix = getOpenLineBelowPrefix(lineText);
    const targetCh = continuationPrefix.length;

    cm.replaceRange(continuationPrefix + "\n", {
      line: cursor.line,
      ch: 0,
    });
    cm.setCursor(cursor.line, targetCh);
    this.enterVimInsertMode(cm);
  }

  handleVimOpenChildBulletLineBelow(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const childPrefix = getChildBulletOpenLinePrefix(lineText);
    const targetLine = cursor.line + 1;
    const targetCh = childPrefix.length;

    cm.replaceRange("\n" + childPrefix, {
      line: cursor.line,
      ch: lineText.length,
    });
    cm.setCursor(targetLine, targetCh);
    this.enterVimInsertMode(cm);
  }

  handleVimOpenChildBulletLineAbove(cm) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const lineText = cm.getLine(cursor.line) || "";
    const childPrefix = getChildBulletOpenLinePrefix(lineText);
    const targetCh = childPrefix.length;

    cm.replaceRange(childPrefix + "\n", {
      line: cursor.line,
      ch: 0,
    });
    cm.setCursor(cursor.line, targetCh);
    this.enterVimInsertMode(cm);
  }

  enterVimInsertMode(cm) {
    const vim = window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
    if (vim && typeof vim.handleKey === "function") {
      vim.handleKey(cm, "i", "mapping");
    }
  }

  vimEnterFallthrough(cm, repeat = 1) {
    this.vimLineOffsetFallthrough(cm, 1, repeat);
  }

  vimBackspaceFallthrough(cm, repeat = 1) {
    this.vimLineOffsetFallthrough(cm, -1, repeat);
  }

  vimLineOffsetFallthrough(cm, direction, repeat = 1) {
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return;
    }

    const cursor = cm.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return;
    }

    const firstLine = this.getCodeMirrorFirstLine(cm);
    const lastLine = this.getCodeMirrorLastLine(cm);
    const repeatCount = normalizeVimRepeat(repeat);
    const offsetDirection = direction < 0 ? -1 : 1;
    const targetLine = this.clampLine(
      cursor.line + offsetDirection * repeatCount,
      firstLine,
      lastLine,
    );
    const lineText =
      typeof cm.getLine === "function" ? cm.getLine(targetLine) || "" : "";
    const firstNonBlank = lineText.search(/\S/);
    const col = firstNonBlank === -1 ? 0 : firstNonBlank;
    cm.setCursor(targetLine, col);
  }

  handleCycleCommand(checking, editor, view, direction) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const taskStatus = this.getActiveTaskStatus(editor);
    const nextSymbol = taskStatus
      ? this.getAdjacentSymbol(taskStatus.symbol, direction)
      : null;
    if (nextSymbol) {
      if (checking) {
        return true;
      }

      this.setActiveCheckboxStatus(editor, taskStatus, nextSymbol);
      return true;
    }

    // Fall back to whole-bullet formatting on non-checkbox list items.
    const bulletToggle = this.getActivePlainBulletFormatToggle(editor, direction);
    if (!bulletToggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    return this.toggleActivePlainBulletFormat(editor, bulletToggle);
  }

  handleOpenChildBulletLineCommand(checking, editor, view, direction) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const cm = this.resolveNormalModeVimCm(editor, view);
    if (!cm) {
      return false;
    }

    if (checking) {
      return true;
    }

    if (direction === "above") {
      this.handleVimOpenChildBulletLineAbove(cm);
    } else {
      this.handleVimOpenChildBulletLineBelow(cm);
    }
    return true;
  }

  registerChildBulletInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-insert when both fire for the same keydown.
    this.handledChildBulletEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleChildBulletPhysicalKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  handleChildBulletPhysicalKeydown(event) {
    const direction = this.getChildBulletKeydownDirection(event);
    if (!direction) {
      return false;
    }
    return this.dispatchChildBulletEvent(event, direction);
  }

  dispatchChildBulletEvent(event, direction) {
    if (this.handledChildBulletEvents && this.handledChildBulletEvents.has(event)) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view) {
      return false;
    }

    const cm = this.resolveNormalModeVimCm(view.editor, view);
    if (!cm) {
      return false;
    }

    if (this.handledChildBulletEvents) {
      this.handledChildBulletEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    if (direction === "above") {
      this.handleVimOpenChildBulletLineAbove(cm);
    } else {
      this.handleVimOpenChildBulletLineBelow(cm);
    }
    return true;
  }

  getChildBulletKeydownDirection(event) {
    // Narrow capture-phase fallback matching the official hotkey binding:
    // exactly Ctrl+Shift+o. Alt/Option and Meta combinations are never ours.
    if (
      !event ||
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey
    ) {
      return null;
    }

    const isChildBulletKey =
      event.code === "KeyO" || ["o", "O"].includes(event.key);
    if (!isChildBulletKey) {
      return null;
    }

    // Ctrl+Shift+o opens a child bullet below; there is no shifted "above"
    // variant.
    return "below";
  }

  registerTranscludedTaskStartInputListeners() {
    // Tracks events already dispatched so the window + document capture
    // listeners cannot double-start when both fire for the same keydown.
    this.handledTranscludedTaskStartEvents = new WeakSet();

    const keydownHandler = (event) =>
      this.handleTranscludedTaskStartPhysicalKeydown(event);

    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }

    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  handleTranscludedTaskStartPhysicalKeydown(event) {
    if (!this.isTranscludedTaskStartKeydown(event)) {
      return false;
    }
    return this.dispatchTranscludedTaskStartEvent(event);
  }

  dispatchTranscludedTaskStartEvent(event) {
    if (
      this.handledTranscludedTaskStartEvents &&
      this.handledTranscludedTaskStartEvents.has(event)
    ) {
      return false;
    }

    const view = this.getFocusedMarkdownEditorView(event);
    if (!view) {
      return false;
    }

    const cm = this.resolveNormalModeVimCm(view.editor, view);
    if (!cm) {
      return false;
    }

    const activeFile =
      view.file ||
      (this.app.workspace &&
      typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    const activePath = activeFile && activeFile.path;
    const candidate = this.getActiveLineTranscludedTaskTarget(
      view.editor,
      activePath,
    );
    if (!candidate) {
      return false;
    }

    if (this.handledTranscludedTaskStartEvents) {
      this.handledTranscludedTaskStartEvents.add(event);
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    void this.startActiveTranscludedTaskLine(
      view.editor,
      activeFile,
      candidate,
    ).catch(() => false);
    return true;
  }

  isTranscludedTaskStartKeydown(event) {
    return (
      !!event &&
      event.key === "@" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    );
  }

  getFocusedMarkdownEditorView(event) {
    const workspace = this.app && this.app.workspace;
    const view =
      workspace && typeof workspace.getActiveViewOfType === "function"
        ? workspace.getActiveViewOfType(MarkdownView)
        : null;
    if (!(view instanceof MarkdownView) || !this.isEditorEventTarget(event, view)) {
      return null;
    }

    return view;
  }

  isEditorEventTarget(event, view) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") {
      return false;
    }

    const editorEl = target.closest(".cm-editor");
    if (!editorEl) {
      return false;
    }

    const containerEl = view && view.containerEl;
    return (
      !containerEl ||
      typeof containerEl.contains !== "function" ||
      containerEl.contains(editorEl)
    );
  }

  resolveNormalModeVimCm(editor, view) {
    const editorCm = editor && editor.cm && editor.cm.cm;
    const viewCm =
      view &&
      view.editMode &&
      view.editMode.editor &&
      view.editMode.editor.cm &&
      view.editMode.editor.cm.cm;
    const cm = editorCm || viewCm;
    if (
      !cm ||
      typeof cm.getCursor !== "function" ||
      typeof cm.getLine !== "function" ||
      typeof cm.replaceRange !== "function" ||
      typeof cm.setCursor !== "function"
    ) {
      return null;
    }

    const mode = this.getCurrentVimMode(cm);
    if (["insert", "visual", "visual-block", "visual-line", "replace"].includes(mode)) {
      return null;
    }

    return cm;
  }

  getCurrentVimMode(cm) {
    const vimState = cm && cm.state && cm.state.vim;
    if (vimState) {
      if (vimState.insertMode === true) {
        return "insert";
      }
      if (vimState.visualMode === true) {
        return "visual";
      }
      if (vimState.replaceMode === true) {
        return "replace";
      }
      if (typeof vimState.mode === "string") {
        return vimState.mode;
      }
    }

    const vimrcSupport =
      this.app &&
      this.app.plugins &&
      this.app.plugins.plugins &&
      this.app.plugins.plugins["obsidian-vimrc-support"];
    return vimrcSupport && typeof vimrcSupport.currentVimStatus === "string"
      ? vimrcSupport.currentVimStatus
      : null;
  }

  handleToggleOpenDoneCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const taskStatus = this.getActiveTaskStatus(editor);
    if (!this.isOpenDoneTaskStatus(taskStatus)) {
      return false;
    }

    if (checking) {
      return true;
    }

    this.toggleActiveCheckboxOpenDone(editor, taskStatus);
    return true;
  }

  handleToggleCheckboxMarkerCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const checkboxToggle = this.getActiveTaskCheckboxMarkerToggle(editor);
    if (!checkboxToggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    return this.toggleActiveCheckboxMarker(editor, checkboxToggle);
  }

  handleToggleObsidianTaskCommand(checking, editor, view) {
    if (!(view instanceof MarkdownView)) {
      return false;
    }

    const obsidianTaskToggle = this.getActiveObsidianTaskToggle(editor);
    if (!obsidianTaskToggle) {
      return false;
    }

    if (checking) {
      return true;
    }

    return this.toggleActiveObsidianTask(editor, obsidianTaskToggle, view);
  }

  toggleActiveCheckboxOpenDone(editor, taskStatus = this.getActiveTaskStatus(editor)) {
    if (!this.isOpenDoneTaskStatus(taskStatus)) {
      return false;
    }

    return this.setActiveCheckboxStatus(
      editor,
      taskStatus,
      getNextOpenDoneSymbol(taskStatus),
    );
  }

  async toggleActiveTranscludedTaskOpenDone(editor, activeFile) {
    const activePath = activeFile && activeFile.path;
    const candidate = this.getActiveLineTranscludedTaskTarget(editor, activePath);
    if (!candidate) {
      return false;
    }

    // Direct single-line toggle: the active note is both the link-resolution
    // origin and the active editor buffer, and this path stays non-recursive.
    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    const resolvedTarget = await this.resolveTranscludedBlockTarget(
      candidate,
      context,
    );
    if (!resolvedTarget) {
      return false;
    }

    return this.replaceResolvedTranscludedTaskLine(resolvedTarget, context);
  }

  async startActiveTranscludedTaskLine(editor, activeFile, candidate = null) {
    const activePath = activeFile && activeFile.path;
    const target =
      candidate || this.getActiveLineTranscludedTaskTarget(editor, activePath);
    if (!activePath || !target) {
      return false;
    }

    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(target, context, {
        taskStatusPredicate: isNonTranscludedStartableStatus,
      });
    } catch (error) {
      return false;
    }
    if (!resolvedTarget) {
      return false;
    }

    return this.replaceResolvedTranscludedTaskLine(
      resolvedTarget,
      context,
      "/",
    );
  }

  // Direct Pomodoro sub-bullet path: when the active line is an embedded
  // transcluded task link under a Pomodoro task, recursively force that selected
  // target tree to done, mirroring Pomodoro completion semantics (eligible
  // non-done targets -> done, already-done roots stay done but are still
  // traversed for eligible descendants).
  // Unlike full Pomodoro completion this does not touch the local Pomodoro line,
  // create a placeholder, carry bullets forward, or move the cursor. Returns
  // true once the root target resolved as such a sub-bullet transclusion, even
  // if every task in the tree was already done, so the caller does not fall
  // through to the non-recursive toggle (which would reopen a done target).
  async completeActivePomodoroTranscludedTaskLine(editor, activeFile) {
    const activePath = activeFile && activeFile.path;
    if (!activePath) {
      return false;
    }

    const target = this.getActivePomodoroTranscludedTaskLineTarget(
      editor,
      activePath,
    );
    if (!target) {
      return false;
    }

    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(
        target.candidate,
        context,
        {
          taskStatusPredicate: isTranscludedCompletionTraversableStatus,
        },
      );
    } catch (error) {
      return false;
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return false;
    }

    // Fresh seen-set scopes cycle/dup detection to this single sub-bullet action.
    const seen = new Set();
    try {
      await this.completeResolvedTranscludedTaskTargetTree(
        resolvedTarget,
        context,
        seen,
      );
    } catch (error) {
      // Best effort: a mid-traversal failure still counts as handled because the
      // root target resolved as a Pomodoro sub-bullet transclusion.
    }
    return true;
  }

  // Direct Pomodoro sub-bullet path for a strict bare non-transcluded task
  // block link. This starts only the selected linked root task without
  // completing the local Pomodoro or copying bullets forward.
  async startActivePomodoroNonTranscludedTaskLine(editor, activeFile) {
    const activePath = activeFile && activeFile.path;
    if (!activePath) {
      return false;
    }

    const target = this.getActivePomodoroBareNonTranscludedTaskLineTarget(
      editor,
      activePath,
    );
    if (!target) {
      return false;
    }

    const context = {
      editor,
      activePath,
      originPath: activePath,
    };
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(
        target.candidate,
        context,
        {
          linePredicate: isProperObsidianTaskLine,
          taskStatusPredicate: isNonTranscludedStartResolvableStatus,
        },
      );
    } catch (error) {
      return false;
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return false;
    }

    const seen = new Set();
    try {
      await this.startResolvedNonTranscludedTaskTarget(
        resolvedTarget,
        context,
        seen,
      );
    } catch (error) {
      // Best effort: the keybinding was still handled because the root target
      // resolved as an eligible Pomodoro sub-bullet target.
    }
    return true;
  }

  async completeActivePomodoroTask(
    editor,
    activeFile,
    context = this.getActivePomodoroTaskContext(editor),
    markdownView = null,
  ) {
    const sourcePath = activeFile && activeFile.path;
    if (!sourcePath || !context) {
      return false;
    }

    const cursor =
      editor && typeof editor.getCursor === "function"
        ? editor.getCursor()
        : { line: context.pomodoroLine, ch: 0 };
    let lines = this.getEditorLineTexts(editor);
    let section = findPomodorosSectionInLines(lines);
    if (!isPomodoroTaskLine(lines, section, context.pomodoroLine)) {
      return false;
    }

    const subBulletRange = getSubBulletBlockRange(
      lines,
      context.pomodoroLine,
      section,
    );
    const subBullets = classifyPomodoroSubBullets(lines, subBulletRange);
    await this.completePomodoroTranscludedTaskBullets(
      subBullets.transcludedTaskLinkBullets,
      {
        editor,
        activePath: sourcePath,
        originPath: sourcePath,
      },
    );
    await this.startPomodoroNonTranscludedTaskBullets(
      subBullets.bareNonTranscludedTaskLinkBullets,
      {
        editor,
        activePath: sourcePath,
        originPath: sourcePath,
      },
    );

    lines = this.getEditorLineTexts(editor);
    section = findPomodorosSectionInLines(lines);
    const plan = buildPomodoroCompletionPlan(
      lines,
      section,
      context.pomodoroLine,
    );
    if (!plan) {
      return false;
    }

    this.applyPomodoroCompletionPlan(editor, plan, cursor, markdownView);
    return true;
  }

  async completePomodoroTranscludedTaskBullets(bullets, context) {
    // One shared seen-set across every immediate embedded target so the whole
    // Pomodoro operation dedupes targets and terminates on cycles.
    const seen = new Set();
    for (const bullet of Array.isArray(bullets) ? bullets : []) {
      for (const target of Array.isArray(bullet.targets) ? bullet.targets : []) {
        try {
          await this.completeTranscludedTaskTargetTree(target, context, seen);
        } catch (error) {
          // Best effort: one broken embed should not block Pomodoro completion.
        }
      }
    }
  }

  async startPomodoroNonTranscludedTaskBullets(bullets, context) {
    const seen = new Set();
    for (const bullet of Array.isArray(bullets) ? bullets : []) {
      for (const target of Array.isArray(bullet.targets) ? bullet.targets : []) {
        try {
          await this.startNonTranscludedTaskTarget(target, context, seen);
        } catch (error) {
          // Best effort: one broken link should not block Pomodoro completion.
        }
      }
    }
  }

  // Recursively forces an embedded transcluded task tree to done. The candidate
  // is resolved relative to context.originPath; descendant embedded
  // transclusions are followed with originPath rebased to the resolved file so
  // same-file `![[#^child]]` links resolve correctly. Already-done targets are
  // not rewritten but are still traversed for eligible descendants. The seen-set
  // (keyed by resolved `path#^block-id`) plus the depth/target caps keep cycles
  // and large accidental graphs bounded. Returns { visited, changed }: visited
  // is true once the candidate resolved to a fresh in-bounds target, changed is
  // true when this node or any descendant was forced to done.
  async completeTranscludedTaskTargetTree(candidate, context, seen, depth = 0) {
    if (depth > MAX_TRANSCLUDED_RECURSION_DEPTH) {
      return { visited: false, changed: false };
    }

    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(candidate, context, {
        taskStatusPredicate: isTranscludedCompletionTraversableStatus,
      });
    } catch (error) {
      return { visited: false, changed: false };
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false };
    }

    return this.completeResolvedTranscludedTaskTargetTree(
      resolvedTarget,
      context,
      seen,
      depth,
    );
  }

  // Resolved-target half of the recursive closure. Splitting it out lets a
  // direct sub-bullet caller resolve once, know the command was handled, and
  // avoid falling through to the non-recursive toggle when the root is already
  // done. The seen-check and seen-add live here so both the candidate entry
  // point and direct callers share identical cycle/dup and cap handling.
  async completeResolvedTranscludedTaskTargetTree(
    resolvedTarget,
    context,
    seen,
    depth = 0,
  ) {
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false };
    }

    const seenKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
    if (seen.has(seenKey) || seen.size >= MAX_TRANSCLUDED_RECURSION_TARGETS) {
      return { visited: false, changed: false };
    }
    seen.add(seenKey);

    const childContext = {
      editor: context.editor,
      activePath: context.activePath,
      originPath: resolvedTarget.file.path,
    };
    const childTargets = collectEmbeddedTranscludedTaskTargetsInListItemBlock(
      resolvedTarget.sourceText,
      resolvedTarget.line,
    );
    let changed = false;
    for (const childTarget of childTargets) {
      try {
        const childResult = await this.completeTranscludedTaskTargetTree(
          childTarget,
          childContext,
          seen,
          depth + 1,
        );
        if (childResult && childResult.changed) {
          changed = true;
        }
      } catch (error) {
        // Best effort: one broken descendant should not block its siblings.
      }
    }

    // Done parents stay done; open and in-progress tasks are forced to done.
    // The replacement path revalidates the line and block ID before writing.
    if (isTranscludedCompletionClosableStatus(resolvedTarget.taskStatus)) {
      const wrote = await this.replaceResolvedTranscludedTaskLine(
        resolvedTarget,
        context,
        "x",
      );
      if (wrote) {
        changed = true;
      }
    }

    return { visited: true, changed };
  }

  // Starts a single strict bare non-transcluded Pomodoro link target. Unlike
  // embedded transclusions, non-transcluded starts deliberately treat the
  // resolved source task as a leaf and do not inspect its descendants.
  async startNonTranscludedTaskTarget(candidate, context, seen) {
    let resolvedTarget;
    try {
      resolvedTarget = await this.resolveTranscludedBlockTarget(candidate, context, {
        linePredicate: isProperObsidianTaskLine,
        taskStatusPredicate: isNonTranscludedStartResolvableStatus,
      });
    } catch (error) {
      return { visited: false, changed: false };
    }
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false };
    }

    return this.startResolvedNonTranscludedTaskTarget(
      resolvedTarget,
      context,
      seen,
    );
  }

  async startResolvedNonTranscludedTaskTarget(
    resolvedTarget,
    context,
    seen,
  ) {
    if (!resolvedTarget || !resolvedTarget.file) {
      return { visited: false, changed: false };
    }

    const seenKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
    if (seen && seen.has(seenKey)) {
      return { visited: false, changed: false };
    }
    if (seen) {
      seen.add(seenKey);
    }

    let changed = false;
    if (isNonTranscludedStartableStatus(resolvedTarget.taskStatus)) {
      const wrote = await this.replaceResolvedTranscludedTaskLine(
        resolvedTarget,
        context,
        "/",
      );
      if (wrote) {
        changed = true;
      }
    }

    return { visited: true, changed };
  }

  toggleActiveCheckboxMarker(
    editor,
    checkboxToggle = this.getActiveTaskCheckboxMarkerToggle(editor),
  ) {
    if (!checkboxToggle) {
      return false;
    }

    editor.replaceRange(
      checkboxToggle.lineText,
      { line: checkboxToggle.line, ch: 0 },
      { line: checkboxToggle.line, ch: checkboxToggle.sourceLineText.length },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({
        line: checkboxToggle.line,
        ch: getTaskCheckboxMarkerCursorCh(checkboxToggle.cursorCh, checkboxToggle),
      });
    }

    return true;
  }

  toggleActiveObsidianTask(
    editor,
    plan = this.getActiveObsidianTaskToggle(editor),
    view = null,
  ) {
    if (!plan) {
      return false;
    }

    if (plan.mode === "move") {
      return this.applyObsidianTaskMovePlan(editor, plan, view);
    }

    return this.applyObsidianTaskReplacePlan(editor, plan);
  }

  applyObsidianTaskReplacePlan(editor, plan) {
    editor.replaceRange(
      plan.lineText,
      { line: plan.line, ch: 0 },
      { line: plan.line, ch: plan.sourceLineText.length },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({ line: plan.cursorLine, ch: plan.cursorCh });
    }

    return true;
  }

  applyObsidianTaskMovePlan(editor, plan, view = null) {
    const oldLines = this.getEditorLineArray(editor);
    this.applyDocumentLineReplacement(editor, oldLines, plan.nextLines);

    if (typeof editor.setCursor === "function") {
      const targetLine = plan.cursorLine;
      const lineText =
        typeof editor.getLine === "function"
          ? editor.getLine(targetLine) || ""
          : "";
      const targetCh = Math.max(0, Math.min(plan.cursorCh, lineText.length));
      editor.setCursor({ line: targetLine, ch: targetCh });

      this.centerEditorLineInView(editor, targetLine, targetCh, view);
    }

    return true;
  }

  centerEditorLineInView(editor, line, ch, markdownView = null) {
    const editorView =
      getEditorViewFromEditor(editor) ||
      (markdownView ? getEditorViewFromEditor(markdownView.editor) : null);
    if (centerEditorViewOnPosition(editorView, line, ch)) {
      return true;
    }

    if (!editor || typeof editor.scrollIntoView !== "function") {
      return false;
    }

    // Fall back to Obsidian's editor-level reveal, preferring the two-argument
    // centered shape before the plain one-argument reveal.
    const position = { line, ch };
    try {
      editor.scrollIntoView({ from: position, to: position }, true);
      return true;
    } catch (error) {
      // Fall through to the one-argument reveal shape below.
    }

    try {
      editor.scrollIntoView({ from: position, to: position });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Defer a `zz`-style center of `line`/`ch` past the current Vim command turn
  // so it is the final scroll instruction, then keep it the last word: a
  // successful CM6 center never falls through to a later nearest-scroll. The
  // bounded retry only waits for the target editor view to attach; it never
  // re-fires against the user once a center has landed.
  scheduleCenterEditorLineInView(editor, line, ch, markdownView = null, options = {}) {
    cancelDeferred(this.pendingPomodoroCenterDeferred);

    const requestedAttempts = Math.floor(Number(options.attempts));
    const attempts = Math.max(
      1,
      Number.isFinite(requestedAttempts)
        ? requestedAttempts
        : CENTER_ON_LINE_ATTEMPTS,
    );

    const runAttempt = (attempt) => {
      this.pendingPomodoroCenterDeferred = null;

      // Prefer the editor that actually received the cursor move. Its CM6 view
      // may lag by a frame right after the completion edits are applied.
      const targetEditorView = getEditorViewFromEditor(editor);
      if (centerEditorViewOnPosition(targetEditorView, line, ch)) {
        return;
      }

      // Give the edited editor a bounded number of frames to attach its view
      // before consulting the passed Markdown view or the editor-level reveal.
      if (!targetEditorView && attempt + 1 < attempts) {
        this.pendingPomodoroCenterDeferred = deferToNextFrame(() =>
          runAttempt(attempt + 1),
        );
        return;
      }

      const viewEditorView = markdownView
        ? getEditorViewFromEditor(markdownView.editor)
        : null;
      if (centerEditorViewOnPosition(viewEditorView, line, ch)) {
        return;
      }

      // Final fallback: the existing editor-level reveal, which prefers the
      // two-argument centered shape before the plain one-argument reveal.
      this.centerEditorLineInView(editor, line, ch, markdownView);
    };

    this.pendingPomodoroCenterDeferred = deferToNextFrame(() => runAttempt(0));
  }

  applyDocumentLineReplacement(editor, oldLines, newLines) {
    if (!editor || typeof editor.replaceRange !== "function") {
      return false;
    }

    const replacement = getLineArrayReplacement(oldLines, newLines);
    if (!replacement) {
      return false;
    }

    const { startLine, removedEndExclusive, lines } = replacement;
    const oldCount = Array.isArray(oldLines) ? oldLines.length : 0;
    const text = lines.join("\n");

    if (removedEndExclusive > startLine) {
      const lastRemoved = removedEndExclusive - 1;
      const lastRemovedText = String(oldLines[lastRemoved] || "");

      if (lines.length > 0) {
        editor.replaceRange(
          text,
          { line: startLine, ch: 0 },
          { line: lastRemoved, ch: lastRemovedText.length },
        );
      } else if (removedEndExclusive < oldCount) {
        editor.replaceRange(
          "",
          { line: startLine, ch: 0 },
          { line: removedEndExclusive, ch: 0 },
        );
      } else if (startLine > 0) {
        const previous = startLine - 1;
        editor.replaceRange(
          "",
          { line: previous, ch: String(oldLines[previous] || "").length },
          { line: lastRemoved, ch: lastRemovedText.length },
        );
      } else {
        editor.replaceRange(
          "",
          { line: 0, ch: 0 },
          { line: lastRemoved, ch: lastRemovedText.length },
        );
      }

      return true;
    }

    if (startLine >= oldCount) {
      if (oldCount === 0) {
        editor.replaceRange(text, { line: 0, ch: 0 });
      } else {
        const last = oldCount - 1;
        editor.replaceRange(`\n${text}`, {
          line: last,
          ch: String(oldLines[last] || "").length,
        });
      }
    } else {
      editor.replaceRange(`${text}\n`, { line: startLine, ch: 0 });
    }

    return true;
  }

  getEditorLineArray(editor) {
    const count = this.getEditorLineCount(editor);
    const lines = [];
    for (let line = 0; line < count; line += 1) {
      lines.push(
        typeof editor.getLine === "function" ? editor.getLine(line) || "" : "",
      );
    }
    return lines;
  }

  setActiveCheckboxStatusLocal(editor, taskStatus, nextSymbol) {
    if (!taskStatus || !FIXED_SYMBOLS.includes(nextSymbol)) {
      return false;
    }

    editor.replaceRange(
      nextSymbol,
      { line: taskStatus.line, ch: taskStatus.statusStart },
      { line: taskStatus.line, ch: taskStatus.statusEnd },
    );
    return true;
  }

  setActiveCheckboxStatus(editor, taskStatus, nextSymbol) {
    if (!taskStatus || !FIXED_SYMBOLS.includes(nextSymbol)) {
      return false;
    }

    const commandId = this.commandIdForSymbol(nextSymbol);
    if (
      this.lineMatchesTasksGlobalFilter(taskStatus.lineText) &&
      this.tryExecuteTasksCommand(commandId)
    ) {
      return true;
    }

    if (this.lineMatchesTasksGlobalFilter(taskStatus.lineText)) {
      return this.setActiveCheckboxStatusLocalWithTaskMetadata(
        editor,
        taskStatus,
        nextSymbol,
      );
    }

    return this.setActiveCheckboxStatusLocal(editor, taskStatus, nextSymbol);
  }

  setActiveCheckboxStatusLocalWithTaskMetadata(editor, taskStatus, nextSymbol) {
    if (!taskStatus || !FIXED_SYMBOLS.includes(nextSymbol)) {
      return false;
    }

    const nextLineText = rewriteTaskLineForLocalFallback(
      taskStatus.lineText,
      nextSymbol,
      this.getCompletionDateString(),
    );
    editor.replaceRange(
      nextLineText,
      { line: taskStatus.line, ch: 0 },
      { line: taskStatus.line, ch: taskStatus.lineText.length },
    );
    return true;
  }

  getActiveTaskCheckboxMarkerToggle(editor) {
    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lineText = editor.getLine(cursor.line);
    const checkboxToggle = getTaskCheckboxMarkerToggle(lineText);
    if (!checkboxToggle) {
      return null;
    }

    return {
      ...checkboxToggle,
      line: cursor.line,
      cursorCh: cursor.ch,
      sourceLineText: lineText,
    };
  }

  getActiveObsidianTaskToggle(editor) {
    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lines = this.getEditorLineArray(editor);
    return getObsidianTaskToggleDocumentPlan(
      lines,
      cursor.line,
      cursor.ch,
      this.getCreatedDateString(),
    );
  }

  getActivePlainBulletFormatToggle(editor, direction) {
    if (!editor || typeof editor.getCursor !== "function") {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lineText =
      typeof editor.getLine === "function" ? editor.getLine(cursor.line) : "";
    const toggle = getPlainBulletFormatToggle(lineText, direction);
    if (!toggle) {
      return null;
    }

    return {
      ...toggle,
      line: cursor.line,
      cursorCh: cursor.ch,
    };
  }

  toggleActivePlainBulletFormat(editor, toggle) {
    if (!toggle || !editor || typeof editor.replaceRange !== "function") {
      return false;
    }

    editor.replaceRange(
      toggle.lineText,
      { line: toggle.line, ch: 0 },
      { line: toggle.line, ch: toggle.sourceLineText.length },
    );

    if (typeof editor.setCursor === "function") {
      editor.setCursor({
        line: toggle.line,
        ch: getCursorChAfterTextEdits(
          toggle.cursorCh,
          toggle.lineText,
          toggle.edits,
        ),
      });
    }

    return true;
  }

  getActivePomodoroTaskContext(
    editor,
    taskStatus = this.getActiveTaskStatus(editor),
  ) {
    if (!taskStatus || taskStatus.symbol !== " ") {
      return null;
    }

    const lines = this.getEditorLineTexts(editor);
    const section = findPomodorosSectionInLines(lines);
    if (!isPomodoroTaskLine(lines, section, taskStatus.line)) {
      return null;
    }

    return {
      lines,
      section,
      pomodoroLine: taskStatus.line,
      taskStatus,
    };
  }

  applyPomodoroCompletionPlan(editor, plan, cursor, markdownView = null) {
    if (!editor || !plan || !Array.isArray(plan.edits)) {
      return false;
    }

    const sortedEdits = plan.edits
      .slice()
      .sort((left, right) => right.line - left.line);

    for (const edit of sortedEdits) {
      if (edit.type === "insertLines") {
        this.insertEditorLines(edit.line, edit.lines, editor);
      } else if (edit.type === "replaceLine") {
        this.replaceEditorLine(edit.line, edit.lineText, editor);
      }
    }

    if (cursor && typeof editor.setCursor === "function") {
      const targetLine = Number.isInteger(plan.cursorTargetLine)
        ? plan.cursorTargetLine
        : plan.pomodoroLine;
      const lineText =
        typeof editor.getLine === "function"
          ? editor.getLine(targetLine) || ""
          : "";
      const targetCh = Number.isInteger(plan.cursorTargetLine)
        ? getPomodoroCursorTargetCh(lineText)
        : cursor.ch || 0;
      const clampedTargetCh = Math.min(Math.max(targetCh, 0), lineText.length);
      editor.setCursor({
        line: targetLine,
        ch: clampedTargetCh,
      });
      // Center the cursor target line: the newly created Pomodoro placeholder
      // when one was inserted, otherwise the pre-existing next Pomodoro the
      // cursor jumped to. The center is deferred so it lands after Vim's and
      // Obsidian's trailing cursor-visibility scrolls instead of being clobbered
      // by them. Other toggle paths keep their existing scrolling behavior.
      if (Number.isInteger(plan.cursorTargetLine)) {
        this.scheduleCenterEditorLineInView(
          editor,
          targetLine,
          clampedTargetCh,
          markdownView,
        );
      }
    }

    return true;
  }

  replaceEditorLine(line, lineText, editor) {
    if (
      !editor ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    const currentLineText = editor.getLine(line) || "";
    editor.replaceRange(
      String(lineText || ""),
      { line, ch: 0 },
      { line, ch: currentLineText.length },
    );
    return true;
  }

  insertEditorLines(line, lines, editor) {
    const insertedLines = Array.isArray(lines)
      ? lines.map((insertedLine) => String(insertedLine || ""))
      : [];
    if (
      insertedLines.length === 0 ||
      !editor ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    const insertText = insertedLines.join("\n");
    const lineCount = this.getEditorLineCount(editor);
    if (lineCount <= 0) {
      editor.replaceRange(insertText, { line: 0, ch: 0 });
      return true;
    }

    if (line >= lineCount) {
      const lastLine = lineCount - 1;
      const lastLineText =
        typeof editor.getLine === "function" ? editor.getLine(lastLine) || "" : "";
      editor.replaceRange(`\n${insertText}`, {
        line: lastLine,
        ch: lastLineText.length,
      });
      return true;
    }

    editor.replaceRange(`${insertText}\n`, { line, ch: 0 });
    return true;
  }

  getActiveLineTranscludedTaskTarget(editor, sourcePath) {
    if (
      !sourcePath ||
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lineText = editor.getLine(cursor.line);
    const candidates = parseEmbeddedBlockTransclusions(lineText);
    const candidate = getUnambiguousTranscludedBlockCandidate(
      candidates,
      cursor.ch,
    );

    return candidate
      ? {
          ...candidate,
          sourcePath,
          activeLine: cursor.line,
          activeLineText: lineText,
        }
      : null;
  }

  getActiveLineBareNonTranscludedTaskTarget(editor, sourcePath) {
    if (
      !sourcePath ||
      !editor ||
      typeof editor.getCursor !== "function" ||
      typeof editor.getLine !== "function"
    ) {
      return null;
    }

    const cursor = editor.getCursor();
    if (!cursor || typeof cursor.line !== "number") {
      return null;
    }

    const lineText = editor.getLine(cursor.line);
    const candidate = getBareNonEmbeddedBlockLinkTargetFromListItem(lineText);

    return candidate
      ? {
          ...candidate,
          sourcePath,
          activeLine: cursor.line,
          activeLineText: lineText,
        }
      : null;
  }

  // Detect when the active line is an embedded transcluded task link that is a
  // sub-bullet of a Pomodoro task. Returns { candidate, pomodoroLine } so the
  // caller can run recursive forced-done over the selected tree; null otherwise,
  // which keeps the generic non-recursive transcluded toggle as the fallback.
  // The active line must sit in the `## Pomodoros` section, be an indented list
  // line, carry an unambiguous embedded block transclusion, and fall inside the
  // sub-bullet block of the nearest top-level Pomodoro task above it.
  getActivePomodoroTranscludedTaskLineTarget(editor, activePath) {
    const candidate = this.getActiveLineTranscludedTaskTarget(editor, activePath);
    if (!candidate) {
      return null;
    }

    const lines = this.getEditorLineTexts(editor);
    const section = findPomodorosSectionInLines(lines);
    const activeLine = candidate.activeLine;
    if (!lineIsInPomodorosSection(section, activeLine)) {
      return null;
    }

    if (!INDENTED_LIST_LINE_RE.test(String(lines[activeLine] || ""))) {
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

    const range = getSubBulletBlockRange(lines, pomodoroLine, section);
    if (!range || activeLine < range.startLine || activeLine >= range.endLine) {
      return null;
    }

    return { candidate, pomodoroLine };
  }

  getActivePomodoroBareNonTranscludedTaskLineTarget(editor, activePath) {
    const candidate = this.getActiveLineBareNonTranscludedTaskTarget(
      editor,
      activePath,
    );
    if (!candidate) {
      return null;
    }

    const lines = this.getEditorLineTexts(editor);
    const section = findPomodorosSectionInLines(lines);
    const activeLine = candidate.activeLine;
    if (!lineIsInPomodorosSection(section, activeLine)) {
      return null;
    }

    if (!INDENTED_LIST_LINE_RE.test(String(lines[activeLine] || ""))) {
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

    const pomodoroStatus = getTaskStatusForLine(lines[pomodoroLine], pomodoroLine);
    if (!pomodoroStatus || pomodoroStatus.symbol !== " ") {
      return null;
    }

    const range = getSubBulletBlockRange(lines, pomodoroLine, section);
    if (!range || activeLine < range.startLine || activeLine >= range.endLine) {
      return null;
    }

    return { candidate, pomodoroLine };
  }

  async resolveTranscludedBlockTarget(candidate, context, options = {}) {
    const file = this.resolveTranscludedTargetFile(candidate, context.originPath);
    if (!this.isMarkdownFile(file)) {
      return null;
    }

    const sourceText = await this.readTranscludedTargetSourceText(file, context);
    if (sourceText === null) {
      return null;
    }

    const fileCache =
      this.app.metadataCache &&
      typeof this.app.metadataCache.getFileCache === "function"
        ? this.app.metadataCache.getFileCache(file)
        : null;
    const cachedLine = getBlockLineFromCache(fileCache, candidate.blockId);
    const resolvedCachedLine = this.resolveTranscludedTaskLineFromSourceText(
      sourceText,
      cachedLine,
      candidate.blockId,
      options,
    );

    if (resolvedCachedLine) {
      return {
        ...resolvedCachedLine,
        file,
        blockId: candidate.blockId,
        sourceText,
      };
    }

    const scannedLine = findBlockLineInSourceText(sourceText, candidate.blockId);
    const resolvedScannedLine = this.resolveTranscludedTaskLineFromSourceText(
      sourceText,
      scannedLine,
      candidate.blockId,
      options,
    );

    return resolvedScannedLine
      ? {
          ...resolvedScannedLine,
          file,
          blockId: candidate.blockId,
          sourceText,
        }
      : null;
  }

  resolveTranscludedTaskLineFromSourceText(sourceText, line, blockId, options = {}) {
    if (line === null) {
      return null;
    }

    const lineText = getLineTextFromSourceText(sourceText, line);
    if (!lineContainsStandaloneBlockId(lineText, blockId)) {
      return null;
    }

    const linePredicate =
      typeof options.linePredicate === "function" ? options.linePredicate : null;
    if (linePredicate && !linePredicate(lineText)) {
      return null;
    }

    const taskStatus = getTaskStatusForLine(lineText, line);
    const taskStatusPredicate =
      typeof options.taskStatusPredicate === "function"
        ? options.taskStatusPredicate
        : this.isOpenDoneTaskStatus.bind(this);
    if (!taskStatusPredicate(taskStatus)) {
      return null;
    }

    return {
      line,
      lineText,
      taskStatus,
    };
  }

  resolveTranscludedTargetFile(candidate, originPath) {
    if (!candidate || !originPath) {
      return null;
    }

    // Empty pathPart means a same-file `![[#^id]]` link: resolve it against the
    // origin note it was found in (the active note for first-level links, or a
    // recursed-into source note for descendant links).
    if (!candidate.pathPart) {
      const originFile =
        this.app.vault &&
        typeof this.app.vault.getAbstractFileByPath === "function"
          ? this.app.vault.getAbstractFileByPath(originPath)
          : null;
      return this.isMarkdownFile(originFile) ? originFile : null;
    }

    if (
      !this.app.metadataCache ||
      typeof this.app.metadataCache.getFirstLinkpathDest !== "function"
    ) {
      return null;
    }

    return (
      this.app.metadataCache.getFirstLinkpathDest(candidate.pathPart, originPath) ||
      null
    );
  }

  async readTranscludedTargetSourceText(file, context) {
    // Read the live editor buffer only for the active note; every other source
    // note (including notes recursed into) is read from the vault.
    const editor = context && context.editor;
    if (this.fileMatchesPath(file, context && context.activePath) && editor) {
      if (typeof editor.getValue === "function") {
        return editor.getValue();
      }
    }

    if (!this.app.vault || typeof this.app.vault.read !== "function") {
      return null;
    }

    try {
      return await this.app.vault.read(file);
    } catch (error) {
      return null;
    }
  }

  async replaceResolvedTranscludedTaskLine(
    resolvedTarget,
    context,
    forcedNextSymbol = null,
  ) {
    // Write through the editor only when the resolved task lives in the active
    // note; all other source notes are written through the vault.
    if (this.fileMatchesPath(resolvedTarget.file, context && context.activePath)) {
      const replacedInEditor = this.replaceResolvedTranscludedTaskLineInEditor(
        resolvedTarget,
        context && context.editor,
        forcedNextSymbol,
      );
      if (replacedInEditor) {
        return true;
      }
    }

    return this.replaceResolvedTranscludedTaskLineInVault(
      resolvedTarget,
      forcedNextSymbol,
    );
  }

  replaceResolvedTranscludedTaskLineInEditor(
    resolvedTarget,
    editor,
    forcedNextSymbol = null,
  ) {
    if (
      !editor ||
      typeof editor.getLine !== "function" ||
      typeof editor.replaceRange !== "function"
    ) {
      return false;
    }

    const currentLineText = editor.getLine(resolvedTarget.line);
    const nextLineText = this.getNextTranscludedTaskLineText(
      currentLineText,
      resolvedTarget.line,
      resolvedTarget.blockId,
      forcedNextSymbol,
    );
    if (nextLineText === null || nextLineText === currentLineText) {
      return false;
    }

    editor.replaceRange(
      nextLineText,
      { line: resolvedTarget.line, ch: 0 },
      { line: resolvedTarget.line, ch: currentLineText.length },
    );
    return true;
  }

  async replaceResolvedTranscludedTaskLineInVault(
    resolvedTarget,
    forcedNextSymbol = null,
  ) {
    if (!this.app.vault) {
      return false;
    }

    let changed = false;
    const updateSourceText = (sourceText) => {
      const currentLineText = getLineTextFromSourceText(
        sourceText,
        resolvedTarget.line,
      );
      const nextLineText = this.getNextTranscludedTaskLineText(
        currentLineText,
        resolvedTarget.line,
        resolvedTarget.blockId,
        forcedNextSymbol,
      );
      if (nextLineText === null || nextLineText === currentLineText) {
        return sourceText;
      }

      const nextSourceText = replaceLineInSourceText(
        sourceText,
        resolvedTarget.line,
        nextLineText,
      );
      if (nextSourceText === null) {
        return sourceText;
      }

      changed = true;
      return nextSourceText;
    };

    try {
      if (typeof this.app.vault.process === "function") {
        await this.app.vault.process(resolvedTarget.file, updateSourceText);
        return changed;
      }

      if (
        typeof this.app.vault.read !== "function" ||
        typeof this.app.vault.modify !== "function"
      ) {
        return false;
      }

      const sourceText = await this.app.vault.read(resolvedTarget.file);
      const nextSourceText = updateSourceText(sourceText);
      if (!changed) {
        return false;
      }

      await this.app.vault.modify(resolvedTarget.file, nextSourceText);
      return true;
    } catch (error) {
      return false;
    }
  }

  getNextTranscludedTaskLineText(lineText, line, blockId, forcedNextSymbol = null) {
    if (!lineContainsStandaloneBlockId(lineText, blockId)) {
      return null;
    }

    const taskStatus = getTaskStatusForLine(lineText, line);
    const nextSymbol = forcedNextSymbol || getNextOpenDoneSymbol(taskStatus);
    if (!nextSymbol) {
      return null;
    }

    if (forcedNextSymbol) {
      if (
        !this.canForceTranscludedTaskStatus(taskStatus, forcedNextSymbol) ||
        taskStatus.symbol === forcedNextSymbol
      ) {
        return null;
      }
    }

    return rewriteTaskLineForTranscludedSource(
      lineText,
      nextSymbol,
      this.getCompletionDateString(),
    );
  }

  canForceTranscludedTaskStatus(taskStatus, forcedNextSymbol) {
    if (!FIXED_SYMBOLS.includes(forcedNextSymbol)) {
      return false;
    }

    if (forcedNextSymbol === "x") {
      return isTranscludedCompletionClosableStatus(taskStatus);
    }

    if (forcedNextSymbol === "/") {
      return isNonTranscludedStartableStatus(taskStatus);
    }

    return isOpenDoneTaskStatus(taskStatus);
  }

  fileMatchesPath(file, path) {
    return !!file && !!path && file.path === path;
  }

  isMarkdownFile(file) {
    return (
      !!file &&
      typeof file.path === "string" &&
      file.path.toLowerCase().endsWith(".md")
    );
  }

  getCompletionDateString() {
    return formatLocalDate();
  }

  getCreatedDateString() {
    return formatLocalDate();
  }

  isOpenDoneTaskStatus(taskStatus) {
    return isOpenDoneTaskStatus(taskStatus);
  }

  isTranscludedCompletionTraversableStatus(taskStatus) {
    return isTranscludedCompletionTraversableStatus(taskStatus);
  }

  isTranscludedCompletionClosableStatus(taskStatus) {
    return isTranscludedCompletionClosableStatus(taskStatus);
  }

  getActiveTaskStatus(editor) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    return getTaskStatusForLine(line, cursor.line);
  }

  getEditorLineTexts(editor) {
    if (!editor) {
      return [];
    }

    if (typeof editor.getValue === "function") {
      return splitTextByLineEndings(editor.getValue()).map((line) => line.text);
    }

    if (typeof editor.getLine !== "function") {
      return [];
    }

    const firstLine =
      typeof editor.firstLine === "function" ? editor.firstLine() : 0;
    const lastLine = this.getCodeMirrorLastLine(editor);
    const lines = [];

    for (let line = firstLine; line <= lastLine; line += 1) {
      lines[line] = editor.getLine(line) || "";
    }

    return lines;
  }

  getEditorLineCount(editor) {
    if (!editor) {
      return 0;
    }

    if (typeof editor.lineCount === "function") {
      return Math.max(0, editor.lineCount());
    }

    if (typeof editor.lastLine === "function") {
      return Math.max(0, editor.lastLine() + 1);
    }

    return this.getEditorLineTexts(editor).length;
  }

  lineMatchesTasksGlobalFilter(lineText) {
    return lineMatchesTasksGlobalFilterText(lineText);
  }

  tryExecuteTasksCommand(commandId) {
    if (!this.app.commands.commands[commandId]) {
      return false;
    }

    try {
      return this.app.commands.executeCommandById(commandId) !== false;
    } catch (error) {
      return false;
    }
  }

  getAdjacentSymbol(currentSymbol, direction) {
    const cycle = this.getStatusCycle();
    const currentIndex = cycle.indexOf(currentSymbol);

    if (currentIndex === -1 || cycle.length < 2) {
      return null;
    }

    const nextIndex = (currentIndex + direction + cycle.length) % cycle.length;
    return cycle[nextIndex];
  }

  getStatusCycle() {
    return FIXED_SYMBOLS;
  }

  getHalfPageLineCount(cm) {
    if (
      cm &&
      typeof cm.getScrollInfo === "function" &&
      typeof cm.defaultTextHeight === "function"
    ) {
      const scrollInfo = cm.getScrollInfo();
      const lineHeight = cm.defaultTextHeight();
      if (
        scrollInfo &&
        Number.isFinite(scrollInfo.clientHeight) &&
        scrollInfo.clientHeight > 0 &&
        Number.isFinite(lineHeight) &&
        lineHeight > 0
      ) {
        return Math.max(1, Math.floor(scrollInfo.clientHeight / lineHeight / 2));
      }
    }

    return DEFAULT_HALF_PAGE_LINES;
  }

  findQueryCodeBlocks(cm) {
    if (!cm || typeof cm.getLine !== "function") {
      return [];
    }

    const blocks = [];
    const firstLine = this.getCodeMirrorFirstLine(cm);
    const lastLine = this.getCodeMirrorLastLine(cm);
    let activeFence = null;

    for (let line = firstLine; line <= lastLine; line += 1) {
      const lineText = cm.getLine(line) || "";

      if (!activeFence) {
        const openingFence = this.getFenceOpening(lineText);
        if (openingFence) {
          activeFence = {
            ...openingFence,
            startLine: line,
            isQuery: this.isQueryFenceInfo(lineText),
          };
        }
        continue;
      }

      if (this.isClosingFence(lineText, activeFence)) {
        if (activeFence.isQuery) {
          blocks.push({ startLine: activeFence.startLine, endLine: line });
        }
        activeFence = null;
      }
    }

    if (activeFence && activeFence.isQuery) {
      blocks.push({ startLine: activeFence.startLine, endLine: lastLine });
    }

    return blocks;
  }

  isQueryFenceInfo(line) {
    const openingFence = this.getFenceOpening(line);
    if (!openingFence) {
      return false;
    }

    const language = openingFence.info.trim().split(/\s+/)[0].toLowerCase();
    return QUERY_CODE_BLOCK_LANGS.has(language);
  }

  lineIsInsideAnyQueryCodeBlock(blocks, line) {
    return !!this.findQueryCodeBlockAtLine(blocks, line);
  }

  findNearestNonQueryLine(blocks, line, direction, firstLine, lastLine) {
    if (!this.lineIsInsideAnyQueryCodeBlock(blocks, line)) {
      return line;
    }

    const preferredDirection = direction >= 0 ? 1 : -1;
    const preferredLine = this.walkToNonQueryLine(
      blocks,
      line,
      preferredDirection,
      firstLine,
      lastLine,
    );
    if (preferredLine !== null) {
      return preferredLine;
    }

    const fallbackLine = this.walkToNonQueryLine(
      blocks,
      line,
      -preferredDirection,
      firstLine,
      lastLine,
    );
    return fallbackLine === null ? line : fallbackLine;
  }

  walkToNonQueryLine(blocks, line, direction, firstLine, lastLine) {
    let candidate = line;

    while (candidate >= firstLine && candidate <= lastLine) {
      const block = this.findQueryCodeBlockAtLine(blocks, candidate);
      if (!block) {
        return candidate;
      }

      candidate = direction >= 0 ? block.endLine + 1 : block.startLine - 1;
    }

    return null;
  }

  findQueryCodeBlockAtLine(blocks, line) {
    return blocks.find((block) => line >= block.startLine && line <= block.endLine);
  }

  getFenceOpening(line) {
    const match = String(line).match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (!match) {
      return null;
    }

    return {
      markerChar: match[2][0],
      markerLength: match[2].length,
      info: match[3] || "",
    };
  }

  isClosingFence(line, openingFence) {
    const match = String(line).match(/^( {0,3})(`{3,}|~{3,})\s*$/);
    if (!match) {
      return false;
    }

    return (
      match[2][0] === openingFence.markerChar &&
      match[2].length >= openingFence.markerLength
    );
  }

  getCodeMirrorFirstLine(cm) {
    return typeof cm.firstLine === "function" ? cm.firstLine() : 0;
  }

  getCodeMirrorLastLine(cm) {
    if (typeof cm.lastLine === "function") {
      return cm.lastLine();
    }

    if (typeof cm.lineCount === "function") {
      return Math.max(0, cm.lineCount() - 1);
    }

    return 0;
  }

  clampLine(line, firstLine, lastLine) {
    return Math.max(firstLine, Math.min(lastLine, line));
  }

  normalizeStatusSymbol(symbol) {
    return normalizeTaskStatusSymbol(symbol);
  }

  commandIdForSymbol(symbol) {
    return `${TASKS_COMMAND_PREFIX}${symbol === " " ? "space" : symbol}`;
  }
};

module.exports.helpers = {
  addOrReplaceCompletionField,
  addCreatedFieldToObsidianTaskLine,
  buildPomodoroCompletionPlan,
  centerEditorViewOnPosition,
  classifyPomodoroSubBullets,
  cleanObsidianTaskBody,
  collectEmbeddedTranscludedTaskTargetsInListItemBlock,
  collectObsidianTaskTokenRanges,
  collapseWhitespaceOutsideBracketSpans,
  demoteObsidianTaskLine,
  editorViewPositionFromLineCh,
  findBlockLineInSourceText,
  findMarkdownHeadings,
  findNamedMarkdownSection,
  findNextMarkdownSection,
  findNextPomodoroLine,
  findPomodorosSectionInLines,
  findTaskRoutingSections,
  formatLocalDate,
  getBlockLineFromCache,
  getBlockLinkTargetKey,
  getBlockLinkTargetKeysFromLine,
  getBareNonEmbeddedBlockLinkTargetFromListItem,
  getCursorChAfterTextEdits,
  getEditorViewFromEditor,
  getAdjacentBulletFormatState,
  getPlainBulletFormatToggle,
  getPlainListItemFormattingTarget,
  getWholeBulletFormatState,
  parseWholeBulletFormat,
  splitTrailingBlockIdFromBody,
  getLineArrayReplacement,
  getLineTextFromSourceText,
  getListItemBlockRange,
  getNextOpenDoneSymbol,
  getNextSectionBulletInsertion,
  getObsidianTaskToggle,
  getObsidianTaskToggleCursorCh,
  getObsidianTaskToggleDocumentPlan,
  getPomodoroCursorTargetCh,
  getSectionInsertionLine,
  getSubBulletBlockRange,
  getStandaloneBlockIdRegex,
  getTrailingBlockId,
  isTasksGeneratedId,
  normalizeTaskDependencyBlockIds,
  rewriteDependsOnBlockIdsInText,
  rewriteDependsOnIdsInLine,
  rewriteGeneratedIdToBlockId,
  getTaskCheckboxMarkerCursorCh,
  getTaskCheckboxMarkerToggle,
  getTaskStatusForLine,
  getVimRepeat,
  isPomodoroTaskLine,
  isLineInMarkdownSectionDirectBody,
  isProperObsidianTaskLine,
  isOpenDoneTaskStatus,
  isNonTranscludedStartResolvableStatus,
  isNonTranscludedStartableStatus,
  isTranscludedCompletionClosableStatus,
  isTranscludedCompletionTraversableStatus,
  isTopLevelTaskLine,
  isTopLevelBulletLikeLine,
  isTopLevelDashListToggleLine,
  getLineIndentation,
  getOpenLineBelowPrefix,
  getChildBulletOpenLinePrefix,
  lineContainsStandaloneBlockId,
  lineHasCreatedField,
  lineMatchesTasksGlobalFilterText,
  parseEmbeddedBlockTransclusions,
  parseMarkdownHeadingLine,
  parseNonEmbeddedBlockLinks,
  parseTranscludedBlockTarget,
  normalizeVimRepeat,
  promoteLineToObsidianTask,
  removeCompletionField,
  removeTextRanges,
  replaceLineInSourceText,
  replaceTaskStatusSymbol,
  rewriteTaskCheckboxMarker,
  rewriteTaskLineForLocalFallback,
  rewriteTaskLineForTranscludedSource,
  splitTextByLineEndings,
};
