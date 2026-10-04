const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HEADING_CLOSING_SEQUENCE_RE = /[ \t]+#+[ \t]*$/;
const YAML_FRONTMATTER_FENCE_RE = /^---[ \t]*$/;
const YAML_FRONTMATTER_END_RE = /^(?:---|\.\.\.)[ \t]*$/;
const CODE_FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CODE_FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const TASK_ROUTING_SECTION_TITLES = {
  tasks: "Tasks",
  futureWork: "Future Work",
  requirements: "Requirements",
};
const DEMOTION_PICKER_TITLE = "Move bullet to section";
const DEMOTION_PICKER_SUBTITLE =
  "Choose an existing section or type a new heading name.";
const DEMOTION_PICKER_INPUT_LABEL = "Section name or filter";
const DEMOTION_PICKER_TASKS_ONLY_PLACEHOLDER = "Requirements";
const DEMOTION_PICKER_EXISTING_PLACEHOLDER = "Filter or type a new section";
const DEMOTION_PICKER_RESULTS_LABEL = "Destination sections";
const DEMOTION_STALE_NOTICE =
  "The note changed. Retry Toggle Obsidian task to move the bullet.";
const DEMOTION_MISSING_SECTION_NOTICE =
  "That section is no longer available. Retry Toggle Obsidian task to move the bullet.";
const TASKS_DESTINATION_REJECTION = "Tasks is not a valid destination.";
const TASK_SECTION_PROMPT_KIND = {
  promotion: "promotion",
  demotion: "demotion",
};
const DEMOTION_PICKER_HINTS = [
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["^N", "^P"], label: "Move" },
  { keys: ["↵"], label: "Move" },
  { keys: ["esc"], label: "Cancel" },
];

function countTrailingBlankLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 0;
  }

  let count = 0;
  for (let line = lines.length - 1; line >= 0; line -= 1) {
    if (String(lines[line] || "").trim() !== "") {
      break;
    }
    count += 1;
  }
  return count;
}

function documentHasFinalNewline(lines) {
  return Array.isArray(lines) && lines.length > 0 && String(lines[lines.length - 1] || "") === "";
}

function getCreatedSectionMovePlan(
  remaining,
  movedBlock,
  originalLines,
  sourceLineText,
  lineText,
  finalCursorCh,
  title,
) {
  const headingTitle = String(title || "").trim();
  if (!headingTitle) {
    return null;
  }

  const contentLength = remaining.length - countTrailingBlankLines(remaining);
  const nextLines = remaining
    .slice(0, contentLength)
    .concat("", `## ${headingTitle}`, "", ...movedBlock);

  if (documentHasFinalNewline(originalLines)) {
    nextLines.push("");
  }

  const cursorLine = contentLength + 3;
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
    lineText,
    targetSection: "createdSection",
  };
}

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

function normalizeHeadingTitle(title) {
  return String(title || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isTasksHeadingTitle(title) {
  return normalizeHeadingTitle(title) === normalizeHeadingTitle(
    TASK_ROUTING_SECTION_TITLES.tasks,
  );
}

function getHeadingIdentity(heading) {
  if (!heading || !Number.isInteger(heading.line)) {
    return null;
  }

  return {
    line: heading.line,
    depth: heading.depth,
    title: heading.title,
  };
}

function headingIdentitiesEqual(left, right) {
  return (
    !!left &&
    !!right &&
    left.line === right.line &&
    left.depth === right.depth &&
    left.title === right.title
  );
}

function findHeadingIndexByIdentity(headings, identity) {
  if (!Array.isArray(headings) || !identity) {
    return -1;
  }

  return headings.findIndex((heading) => headingIdentitiesEqual(heading, identity));
}

function findOwningMarkdownHeadingIdentity(lines, activeLine) {
  if (!Array.isArray(lines) || !Number.isInteger(activeLine)) {
    return null;
  }

  const headings = findMarkdownHeadings(lines);
  let owner = null;
  for (let index = 0; index < headings.length; index += 1) {
    const section = getMarkdownSectionFromHeadingIndex(lines, headings, index);
    if (
      section &&
      activeLine > section.headingLine &&
      activeLine < section.endLine
    ) {
      owner = headings[index];
    }
  }

  return owner ? getHeadingIdentity(owner) : null;
}

function collectSelectableDemotionHeadings(lines) {
  return findMarkdownHeadings(lines)
    .filter((heading) => heading.title && !isTasksHeadingTitle(heading.title))
    .map((heading) => getHeadingIdentity(heading));
}

function collectSelectablePromotionHeadings(lines, sourceHeadingIdentity = null) {
  const headings = findMarkdownHeadings(lines)
    .filter((heading) => heading.title)
    .filter((heading) => {
      if (!headingIdentitiesEqual(heading, sourceHeadingIdentity)) {
        return true;
      }
      // Keep the source heading when it is exact Tasks so in-place promotion
      // can be the default. Other source headings stay excluded.
      return heading.title === TASK_ROUTING_SECTION_TITLES.tasks;
    });
  const tasks = headings.filter(
    (heading) => heading.title === TASK_ROUTING_SECTION_TITLES.tasks,
  );
  const nonTasks = headings.filter(
    (heading) => heading.title !== TASK_ROUTING_SECTION_TITLES.tasks,
  );
  return [...tasks, ...nonTasks].map((heading) => getHeadingIdentity(heading));
}

function isEligibleTasksSectionDemotion(lines, activeLine, sourceLineText) {
  if (!isTopLevelDashListToggleLine(sourceLineText) || !isProperObsidianTaskLine(sourceLineText)) {
    return false;
  }

  const tasksSection = findNamedMarkdownSection(
    lines,
    TASK_ROUTING_SECTION_TITLES.tasks,
  );
  return isLineInMarkdownSectionDirectBody(tasksSection, activeLine);
}

function createLineRemovalState(lines) {
  const source = Array.isArray(lines) ? lines : [];
  return {
    lines: source.slice(),
    originalLineByCurrentLine: source.map((_, index) => index),
  };
}

function removeCurrentLineRange(state, startLine, endLineExclusive) {
  if (
    !state ||
    !Array.isArray(state.lines) ||
    !Array.isArray(state.originalLineByCurrentLine)
  ) {
    return false;
  }

  const start = Math.max(0, Math.floor(Number(startLine) || 0));
  const end = Math.min(
    state.lines.length,
    Math.max(start, Math.floor(Number(endLineExclusive) || 0)),
  );
  if (start >= end) {
    return false;
  }

  state.lines.splice(start, end - start);
  state.originalLineByCurrentLine.splice(start, end - start);
  return true;
}

function removeDoubleBlankCurrentSeam(state, seamLine) {
  if (!state || !Array.isArray(state.lines)) {
    return false;
  }

  const seam = Math.floor(Number(seamLine) || 0);
  if (
    seam > 0 &&
    seam < state.lines.length &&
    String(state.lines[seam - 1] || "").trim() === "" &&
    String(state.lines[seam] || "").trim() === ""
  ) {
    return removeCurrentLineRange(state, seam, seam + 1);
  }

  return false;
}

function mapOriginalLineInRemovalState(state, originalLine) {
  if (
    !state ||
    !Array.isArray(state.originalLineByCurrentLine) ||
    !Number.isInteger(originalLine)
  ) {
    return null;
  }

  const mappedLine = state.originalLineByCurrentLine.indexOf(originalLine);
  return mappedLine >= 0 ? mappedLine : null;
}

function findHeadingIndexByMappedIdentity(lines, state, identity) {
  if (!identity) {
    return -1;
  }

  const mappedLine = mapOriginalLineInRemovalState(state, identity.line);
  if (mappedLine === null) {
    return -1;
  }

  return findMarkdownHeadings(lines).findIndex(
    (heading) =>
      heading.line === mappedLine &&
      heading.depth === identity.depth &&
      heading.title === identity.title,
  );
}

function removeSourceListItemBlockFromState(state, block) {
  if (!state || !block) {
    return { splicedSeam: false };
  }

  removeCurrentLineRange(state, block.startLine, block.endLine + 1);
  return {
    splicedSeam: removeDoubleBlankCurrentSeam(state, block.startLine),
  };
}

function isSectionEmptyAfterSourceBlockRemoval(lines, section) {
  if (!Array.isArray(lines) || !section) {
    return false;
  }

  if (section.nextHeadingLine < section.endLine) {
    return false;
  }

  for (
    let line = section.headingLine + 1;
    line < section.nextHeadingLine;
    line += 1
  ) {
    if (String(lines[line] || "").trim() !== "") {
      return false;
    }
  }

  return true;
}

function preserveOriginalFinalNewline(state, originalLines) {
  if (
    documentHasFinalNewline(originalLines) &&
    state &&
    Array.isArray(state.lines) &&
    state.lines.length > 0 &&
    String(state.lines[state.lines.length - 1] || "") !== ""
  ) {
    state.lines.push("");
    state.originalLineByCurrentLine.push(null);
  }
}

function removeEmptySourceSectionFromState(
  state,
  originalLines,
  sourceHeadingIdentity,
  destinationHeadingIdentity = null,
) {
  if (
    !state ||
    !sourceHeadingIdentity ||
    isTasksHeadingTitle(sourceHeadingIdentity.title) ||
    headingIdentitiesEqual(sourceHeadingIdentity, destinationHeadingIdentity)
  ) {
    return false;
  }

  const headingIndex = findHeadingIndexByMappedIdentity(
    state.lines,
    state,
    sourceHeadingIdentity,
  );
  if (headingIndex < 0) {
    return false;
  }

  const headings = findMarkdownHeadings(state.lines);
  const section = getMarkdownSectionFromHeadingIndex(
    state.lines,
    headings,
    headingIndex,
  );
  if (!isSectionEmptyAfterSourceBlockRemoval(state.lines, section)) {
    return false;
  }

  removeCurrentLineRange(state, section.headingLine, section.nextHeadingLine);
  removeDoubleBlankCurrentSeam(state, section.headingLine);
  preserveOriginalFinalNewline(state, originalLines);
  return true;
}

function removeSourceBlockForTaskPrompt(prompt, destinationHeadingIdentity = null) {
  if (!prompt || !Array.isArray(prompt.sourceLines) || !prompt.sourceBlock) {
    return null;
  }

  const state = createLineRemovalState(prompt.sourceLines);
  const { splicedSeam } = removeSourceListItemBlockFromState(
    state,
    prompt.sourceBlock,
  );
  const removedSourceSection =
    prompt.promptKind === TASK_SECTION_PROMPT_KIND.promotion
      ? removeEmptySourceSectionFromState(
          state,
          prompt.sourceLines,
          prompt.sourceHeading,
          destinationHeadingIdentity,
        )
      : false;

  return {
    remaining: state.lines,
    originalLineByCurrentLine: state.originalLineByCurrentLine,
    splicedSeam,
    removedSourceSection,
    mapOriginalLine(originalLine) {
      return mapOriginalLineInRemovalState(state, originalLine);
    },
  };
}

function removeSourceListItemBlock(lines, block) {
  const state = createLineRemovalState(lines);
  const { splicedSeam } = removeSourceListItemBlockFromState(state, block);
  return {
    remaining: state.lines,
    splicedSeam,
    originalLineByCurrentLine: state.originalLineByCurrentLine,
  };
}

function mapOriginalLineToRemaining(originalLine, block, splicedSeam) {
  if (!Number.isInteger(originalLine) || !block) {
    return null;
  }

  if (originalLine < block.startLine) {
    return originalLine;
  }

  if (originalLine <= block.endLine) {
    return null;
  }

  let mapped = originalLine - (block.endLine - block.startLine + 1);
  if (splicedSeam && mapped >= block.startLine) {
    mapped -= 1;
  }

  return mapped;
}

function buildObsidianTaskSectionMovePlan(
  remaining,
  insertion,
  movedBlock,
  sourceLineText,
  lineText,
  finalCursorCh,
  targetSection,
  preserveFinalNewline = documentHasFinalNewline(remaining),
) {
  if (!insertion) {
    return null;
  }

  const insertLines = insertion.leadingBlank
    ? ["", ...movedBlock]
    : movedBlock.slice();
  const hadFinalNewline = preserveFinalNewline === true;
  const nextLines = remaining
    .slice(0, insertion.insertLine)
    .concat(insertLines, remaining.slice(insertion.insertLine));
  if (
    hadFinalNewline &&
    nextLines.length > 0 &&
    String(nextLines[nextLines.length - 1] || "") !== ""
  ) {
    nextLines.push("");
  }
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
    lineText,
    targetSection,
  };
}

function getTaskSectionPromptKind(prompt) {
  return prompt && prompt.promptKind === TASK_SECTION_PROMPT_KIND.promotion
    ? TASK_SECTION_PROMPT_KIND.promotion
    : TASK_SECTION_PROMPT_KIND.demotion;
}

function isTaskSectionPromptExistingHeadingAllowed(prompt, headingIdentity) {
  if (!prompt || !headingIdentity) {
    return false;
  }

  if (!headingIdentity.title) {
    return false;
  }

  const kind = getTaskSectionPromptKind(prompt);
  if (
    kind === TASK_SECTION_PROMPT_KIND.demotion &&
    isTasksHeadingTitle(headingIdentity.title)
  ) {
    return false;
  }

  if (
    kind === TASK_SECTION_PROMPT_KIND.promotion &&
    headingIdentitiesEqual(headingIdentity, prompt.sourceHeading)
  ) {
    return headingIdentity.title === TASK_ROUTING_SECTION_TITLES.tasks;
  }

  return true;
}

function getTaskSectionPromptHeadings(prompt) {
  if (!prompt || !Array.isArray(prompt.sourceLines)) {
    return [];
  }

  if (Array.isArray(prompt.headings)) {
    return prompt.headings.slice();
  }

  return getTaskSectionPromptKind(prompt) === TASK_SECTION_PROMPT_KIND.promotion
    ? collectSelectablePromotionHeadings(prompt.sourceLines, prompt.sourceHeading)
    : collectSelectableDemotionHeadings(prompt.sourceLines);
}

function getTaskSectionPromptMovedBlock(prompt, destinationHeadingIdentity = null) {
  if (
    getTaskSectionPromptKind(prompt) === TASK_SECTION_PROMPT_KIND.promotion &&
    !isTasksHeadingTitle(destinationHeadingIdentity && destinationHeadingIdentity.title)
  ) {
    return Array.isArray(prompt.originalMovedBlock)
      ? prompt.originalMovedBlock.slice()
      : [];
  }

  return Array.isArray(prompt.movedBlock) ? prompt.movedBlock.slice() : [];
}

function getTaskSectionPromptLineText(prompt, destinationHeadingIdentity = null) {
  if (
    getTaskSectionPromptKind(prompt) === TASK_SECTION_PROMPT_KIND.promotion &&
    !isTasksHeadingTitle(destinationHeadingIdentity && destinationHeadingIdentity.title)
  ) {
    return prompt.sourceLineText;
  }

  return prompt.lineText;
}

function getTaskSectionPromptCursorCh(prompt, destinationHeadingIdentity = null) {
  if (
    getTaskSectionPromptKind(prompt) === TASK_SECTION_PROMPT_KIND.promotion &&
    !isTasksHeadingTitle(destinationHeadingIdentity && destinationHeadingIdentity.title)
  ) {
    return Number.isInteger(prompt.originalCursorCh)
      ? prompt.originalCursorCh
      : prompt.cursorCh;
  }

  return prompt.cursorCh;
}

function resolveSameSourceTasksPromotion(prompt) {
  if (
    !prompt ||
    !Array.isArray(prompt.sourceLines) ||
    !Number.isInteger(prompt.sourceLine) ||
    prompt.sourceLine < 0 ||
    prompt.sourceLine >= prompt.sourceLines.length
  ) {
    return null;
  }

  const nextLines = prompt.sourceLines.slice();
  nextLines[prompt.sourceLine] = prompt.lineText;
  const convertedFirstLine = String(nextLines[prompt.sourceLine] || "");
  const cursorLine = Number.isInteger(prompt.cursorLine)
    ? prompt.cursorLine
    : prompt.sourceLine;
  const cursorColumn = Math.max(
    0,
    Math.min(convertedFirstLine.length, prompt.cursorCh),
  );

  return {
    mode: "move",
    nextLines,
    cursorLine,
    cursorCh: cursorColumn,
    sourceLineText: prompt.sourceLineText,
    lineText: prompt.lineText,
    targetSection: "tasks",
  };
}

function resolveExistingTaskSectionPromptHeading(prompt, headingIdentity) {
  if (!prompt || !headingIdentity) {
    return null;
  }

  if (!isTaskSectionPromptExistingHeadingAllowed(prompt, headingIdentity)) {
    return null;
  }

  const sourceLines = prompt.sourceLines;
  const originalHeadings = findMarkdownHeadings(sourceLines);
  if (findHeadingIndexByIdentity(originalHeadings, headingIdentity) < 0) {
    return null;
  }

  if (
    getTaskSectionPromptKind(prompt) === TASK_SECTION_PROMPT_KIND.promotion &&
    headingIdentitiesEqual(headingIdentity, prompt.sourceHeading) &&
    headingIdentity.title === TASK_ROUTING_SECTION_TITLES.tasks
  ) {
    return resolveSameSourceTasksPromotion(prompt);
  }

  const removal = removeSourceBlockForTaskPrompt(prompt, headingIdentity);
  if (!removal) {
    return null;
  }

  const { remaining } = removal;
  const mappedLine = removal.mapOriginalLine(headingIdentity.line);
  const remainingHeadings = findMarkdownHeadings(remaining);
  const remainingIndex = remainingHeadings.findIndex(
    (heading) =>
      heading.line === mappedLine &&
      heading.depth === headingIdentity.depth &&
      heading.title === headingIdentity.title,
  );
  if (remainingIndex < 0) {
    return null;
  }

  const section = getMarkdownSectionFromHeadingIndex(
    remaining,
    remainingHeadings,
    remainingIndex,
  );
  const promptKind = getTaskSectionPromptKind(prompt);
  const movingToTasks =
    promptKind === TASK_SECTION_PROMPT_KIND.promotion &&
    isTasksHeadingTitle(headingIdentity.title);
  const insertion = movingToTasks
    ? getSectionInsertionLine(remaining, section, { stopAtChildHeadings: true })
    : getNextSectionBulletInsertion(remaining, section);
  return buildObsidianTaskSectionMovePlan(
    remaining,
    insertion,
    getTaskSectionPromptMovedBlock(prompt, headingIdentity),
    prompt.sourceLineText,
    getTaskSectionPromptLineText(prompt, headingIdentity),
    getTaskSectionPromptCursorCh(prompt, headingIdentity),
    movingToTasks ? "tasks" : "existingSection",
    documentHasFinalNewline(prompt.sourceLines),
  );
}

function resolveExistingDemotionHeading(prompt, headingIdentity) {
  if (getTaskSectionPromptKind(prompt) !== TASK_SECTION_PROMPT_KIND.demotion) {
    return null;
  }

  return resolveExistingTaskSectionPromptHeading(prompt, headingIdentity);
}

function resolveObsidianTaskPromptDestination(prompt, destination) {
  if (!prompt || prompt.mode !== "prompt" || !destination) {
    return null;
  }

  if (destination.kind === "existing") {
    return resolveExistingTaskSectionPromptHeading(prompt, destination.heading);
  }

  if (destination.kind !== "create") {
    return null;
  }

  const title = String(destination.title || "").trim();
  if (!title) {
    return null;
  }

  const headings = getTaskSectionPromptHeadings(prompt);
  const existing = headings.find(
    (heading) => normalizeHeadingTitle(heading.title) === normalizeHeadingTitle(title),
  );
  if (existing) {
    return resolveExistingTaskSectionPromptHeading(prompt, existing);
  }

  if (
    getTaskSectionPromptKind(prompt) === TASK_SECTION_PROMPT_KIND.demotion &&
    isTasksHeadingTitle(title)
  ) {
    return null;
  }

  const removal = removeSourceBlockForTaskPrompt(prompt, null);
  if (!removal) {
    return null;
  }

  return getCreatedSectionMovePlan(
    removal.remaining,
    getTaskSectionPromptMovedBlock(prompt, null),
    prompt.sourceLines,
    prompt.sourceLineText,
    getTaskSectionPromptLineText(prompt, null),
    getTaskSectionPromptCursorCh(prompt, null),
    title,
  );
}

function resolveObsidianTaskDemotionDestination(prompt, destination) {
  if (getTaskSectionPromptKind(prompt) !== TASK_SECTION_PROMPT_KIND.demotion) {
    return null;
  }

  return resolveObsidianTaskPromptDestination(prompt, destination);
}

