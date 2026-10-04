function buildProjectSeedFromChildBullets(childLines, createdDateString) {
  const lines = Array.isArray(childLines)
    ? childLines.map((line) =>
        String(line === null || line === undefined ? "" : line),
      )
    : [];

  let directChildIndentLength = null;
  for (const line of lines) {
    const match = PROJECT_LIST_ITEM_RE.exec(line);
    if (match) {
      const length = match[1].length;
      if (
        directChildIndentLength === null ||
        length < directChildIndentLength
      ) {
        directChildIndentLength = length;
      }
    }
  }

  if (directChildIndentLength === null) {
    const hasContent = lines.some((line) => line.trim() !== "");
    return Object.freeze({
      taskLines: Object.freeze([]),
      sections: Object.freeze([]),
      managedLogLines: Object.freeze([]),
      lossless: !hasContent,
    });
  }

  // Pre-pass: for each direct-child line, record whether a nonblank list item
  // is nested deeper than it before the next direct child (section-bullet
  // eligibility needs this lookahead), and the indent of the shallowest such
  // nested list item (the base for re-indenting that section's notes).
  const directChildIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const listMatch = PROJECT_LIST_ITEM_RE.exec(lines[index]);
    if (listMatch && listMatch[1].length === directChildIndentLength) {
      directChildIndexes.push(index);
    }
  }

  const sectionSpanInfo = new Map();
  for (let i = 0; i < directChildIndexes.length; i += 1) {
    const start = directChildIndexes[i];
    const end =
      i + 1 < directChildIndexes.length
        ? directChildIndexes[i + 1]
        : lines.length;
    let nestedIndentLength = null;
    let nestedIndent = "";
    for (let index = start + 1; index < end; index += 1) {
      const listMatch = PROJECT_LIST_ITEM_RE.exec(lines[index]);
      if (listMatch && listMatch[1].length > directChildIndentLength) {
        if (
          nestedIndentLength === null ||
          listMatch[1].length < nestedIndentLength
        ) {
          nestedIndentLength = listMatch[1].length;
          nestedIndent = listMatch[1];
        }
      }
    }
    sectionSpanInfo.set(start, {
      hasNestedListItem: nestedIndentLength !== null,
      baseIndent: nestedIndent,
    });
  }

  const taskLines = [];
  const sectionEntries = [];
  const sectionEntryByTitle = new Map();
  const managedLogLines = [];
  let current = null;
  let currentSection = null;
  let currentManagedLog = null;
  let lossless = true;

  const flushTask = () => {
    if (!current) {
      return;
    }

    taskLines.push(current.taskLine);
    const nested = current.nested.slice();
    while (nested.length && nested[0].trim() === "") {
      nested.shift();
    }
    while (nested.length && nested[nested.length - 1].trim() === "") {
      nested.pop();
    }
    for (const nestedLine of nested) {
      taskLines.push(nestedLine);
    }
    current = null;
  };

  const flushSection = () => {
    if (!currentSection) {
      return;
    }

    const noteLines = currentSection.noteLines.slice();
    while (noteLines.length && noteLines[0].trim() === "") {
      noteLines.shift();
    }
    while (noteLines.length && noteLines[noteLines.length - 1].trim() === "") {
      noteLines.pop();
    }

    let entry = sectionEntryByTitle.get(currentSection.normalizedTitle);
    if (!entry) {
      entry = { title: currentSection.title, noteLines: [] };
      sectionEntryByTitle.set(currentSection.normalizedTitle, entry);
      sectionEntries.push(entry);
    }
    entry.noteLines.push(...noteLines);
    currentSection = null;
  };

  const flushManagedLog = () => {
    if (!currentManagedLog) {
      return;
    }

    const logLines = currentManagedLog.lines.slice();
    while (logLines.length && logLines[0].trim() === "") {
      logLines.shift();
    }
    while (logLines.length && logLines[logLines.length - 1].trim() === "") {
      logLines.pop();
    }
    managedLogLines.push(...logLines);
    currentManagedLog = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      if (current) {
        current.nested.push("");
      }
      if (currentSection) {
        currentSection.noteLines.push("");
      }
      if (currentManagedLog) {
        currentManagedLog.lines.push("");
      }
      continue;
    }

    const leadingMatch = /^(\s*)/.exec(line);
    const leading = leadingMatch ? leadingMatch[1] : "";
    const listMatch = PROJECT_LIST_ITEM_RE.exec(line);

    if (listMatch && listMatch[1].length === directChildIndentLength) {
      flushTask();
      flushSection();
      flushManagedLog();

      const parsedManagedLog = parseManagedTaskLogParentBullet(line);
      if (parsedManagedLog) {
        currentManagedLog = {
          markerIndent: parsedManagedLog.indent,
          lines: [
            normalizeProjectManagedLogLine(line, parsedManagedLog.indent),
          ],
        };
        continue;
      }

      const parsedChild = parseProjectChildListItem(
        line,
        directChildIndentLength - 1,
      );
      const sectionTitle =
        parsedChild && parsedChild.status === null
          ? parseProjectSectionBulletTitle(parsedChild.body)
          : null;
      const spanInfo = sectionSpanInfo.get(index);

      if (sectionTitle && spanInfo && spanInfo.hasNestedListItem) {
        currentSection = {
          title: sectionTitle,
          normalizedTitle: normalizeProjectSectionTitle(sectionTitle),
          noteLines: [],
          baseIndent: spanInfo.baseIndent,
        };
        continue;
      }

      const taskLine = buildProjectTaskLineFromChildBullet(
        parsedChild,
        createdDateString,
      );
      if (
        !parsedChild ||
        !taskLine ||
        String(parsedChild.body || "").trim() === ""
      ) {
        lossless = false;
        current = null;
        continue;
      }

      current = { taskLine, nested: [], directChildIndent: leading };
    } else if (leading.length > directChildIndentLength && current) {
      current.nested.push(normalizeNestedChildLine(line, current.directChildIndent));
    } else if (leading.length > directChildIndentLength && currentSection) {
      currentSection.noteLines.push(
        normalizeProjectSectionNoteLine(line, currentSection.baseIndent),
      );
    } else if (leading.length > directChildIndentLength && currentManagedLog) {
      currentManagedLog.lines.push(
        normalizeProjectManagedLogLine(line, currentManagedLog.markerIndent),
      );
    } else {
      lossless = false;
    }
  }

  flushTask();
  flushSection();
  flushManagedLog();

  return Object.freeze({
    taskLines: Object.freeze(taskLines),
    sections: Object.freeze(
      sectionEntries.map((entry) =>
        Object.freeze({
          title: entry.title,
          noteLines: Object.freeze(entry.noteLines),
        }),
      ),
    ),
    managedLogLines: Object.freeze(managedLogLines),
    lossless,
  });
}

// Compact local YYYY-MM-DD, matching the [created::YYYY-MM-DD] convention used
// for project tasks elsewhere in the vault.
function formatProjectTaskCreatedDate(date) {
  const value = date instanceof Date ? date : new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Locate the `## Tasks` header line, ignoring frontmatter and fenced code, or
// -1 when there is no such header.
function findProjectTasksHeaderIndex(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
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

    if (line.trim() === PROJECT_TASKS_HEADER) {
      return lineIndex;
    }
  }

  return -1;
}

// Locate the project lifecycle `^prj` task line, ignoring frontmatter and fenced
// code, or -1 when there is no such task.
function findProjectLifecycleTaskIndex(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
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

    if (isProjectLifecycleTaskLine(line)) {
      return lineIndex;
    }
  }

  return -1;
}

// Insert already-rendered managed-log lines directly under the new note's
// lifecycle task. Returns { content, inserted }; inserted is false when there is
// nothing to insert or no `^prj` task exists.
function insertProjectManagedLogLines(content, managedLogLines) {
  const text = String(content || "");
  const logLines = Array.isArray(managedLogLines)
    ? managedLogLines.map((line) =>
        String(line === null || line === undefined ? "" : line),
      )
    : [];
  if (logLines.length === 0) {
    return Object.freeze({ content: text, inserted: false });
  }

  const { lines, lineEnding } = splitMarkdownContent(text);
  const lifecycleIndex = findProjectLifecycleTaskIndex(lines);
  if (lifecycleIndex === -1) {
    return Object.freeze({ content: text, inserted: false });
  }

  return Object.freeze({
    content: lines
      .slice(0, lifecycleIndex + 1)
      .concat(logLines, lines.slice(lifecycleIndex + 1))
      .join(lineEnding),
    inserted: true,
  });
}

// Insert the rendered child tasks into the `## Tasks` section, replacing the
// default placeholder task when present. Returns { content, replaced }; replaced
// is false (and content unchanged) when there is nothing to insert or no
// `## Tasks` section exists.
function replaceProjectTasksPlaceholder(content, renderedTaskLines) {
  const text = String(content || "");
  const taskLines = Array.isArray(renderedTaskLines)
    ? renderedTaskLines.map((line) =>
        String(line === null || line === undefined ? "" : line),
      )
    : [];
  if (taskLines.length === 0) {
    return Object.freeze({ content: text, replaced: false });
  }

  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const headerIndex = findProjectTasksHeaderIndex(lines);
  if (headerIndex === -1) {
    return Object.freeze({ content: text, replaced: false });
  }

  let sectionEnd = lines.length;
  let inFence = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
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

    if (SECTION_HEADER_RE.test(line)) {
      sectionEnd = index;
      break;
    }
  }

  let placeholderIndex = -1;
  for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
    const line = String(lines[index] || "");
    if (
      PROJECT_SOURCE_TASK_LINE_RE.test(line) &&
      line.includes(PROJECT_TASKS_PLACEHOLDER)
    ) {
      placeholderIndex = index;
      break;
    }
  }

  let nextLines;
  if (placeholderIndex !== -1) {
    nextLines = lines
      .slice(0, placeholderIndex)
      .concat(taskLines, lines.slice(placeholderIndex + 1));
  } else {
    let insertAt = headerIndex + 1;
    if (insertAt < sectionEnd && String(lines[insertAt] || "").trim() === "") {
      insertAt += 1;
    }
    nextLines = lines
      .slice(0, insertAt)
      .concat(taskLines, lines.slice(insertAt));
  }

  return Object.freeze({
    content: nextLines.join(lineEnding),
    replaced: true,
  });
}

// Locate an existing unfenced `##` header matching `title` (case-insensitive,
// whitespace-collapsed), skipping frontmatter. Returns
// { headerIndex, bodyEndExclusive } or null when no such header exists.
// bodyEndExclusive is one past the section's last nonblank line, bounded by
// the next level-one-or-two header (fence-aware) or EOF; it equals
// headerIndex + 1 for an empty body.
function findProjectSectionRange(lines, title) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const normalizedTarget = normalizeProjectSectionTitle(title);
  if (!normalizedTarget) {
    return null;
  }

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

    const headerMatch = PROJECT_SECTION_HEADER_RE.exec(line);
    if (
      !headerMatch ||
      normalizeProjectSectionTitle(headerMatch[1] || "") !== normalizedTarget
    ) {
      continue;
    }

    const headerIndex = lineIndex;
    let bodyEndExclusive = headerIndex + 1;
    let bodyInFence = null;
    for (let index = headerIndex + 1; index < sourceLines.length; index += 1) {
      const bodyLine = String(sourceLines[index] || "");

      if (bodyInFence) {
        if (isClosingFence(bodyLine, bodyInFence)) {
          bodyInFence = null;
        }
        bodyEndExclusive = index + 1;
        continue;
      }

      const bodyOpeningFence = getFenceOpening(bodyLine);
      if (bodyOpeningFence) {
        bodyInFence = bodyOpeningFence;
        bodyEndExclusive = index + 1;
        continue;
      }

      if (PROJECT_SECTION_BOUNDARY_HEADER_RE.test(bodyLine)) {
        break;
      }

      if (bodyLine.trim() !== "") {
        bodyEndExclusive = index + 1;
      }
    }

    return Object.freeze({ headerIndex, bodyEndExclusive });
  }

  return null;
}

// Insert each section's notes into `content`: reuse a matching existing `##`
// header (leaving the header line byte-identical) when one exists, otherwise
// append a new `## Title` section at EOF, in source order. Existing-header
// insertions are applied highest line index first so earlier insert points
// stay valid. Returns { content, insertedCount, createdCount }.
function insertProjectSectionNotes(content, sections) {
  const text = String(content || "");
  const sectionList = Array.isArray(sections) ? sections : [];
  const validSections = sectionList
    .map((section) => ({
      title: String(section && section.title ? section.title : "").trim(),
      noteLines: Array.isArray(section && section.noteLines)
        ? section.noteLines.map((line) =>
            String(line === null || line === undefined ? "" : line),
          )
        : [],
    }))
    .filter((section) => section.title && section.noteLines.length > 0);

  if (validSections.length === 0) {
    return Object.freeze({ content: text, insertedCount: 0, createdCount: 0 });
  }

  const { lineEnding } = splitMarkdownContent(text);
  let lines = text.split(/\r?\n/);

  const matches = [];
  const newSections = [];
  for (const section of validSections) {
    const range = findProjectSectionRange(lines, section.title);
    if (range) {
      matches.push({
        headerIndex: range.headerIndex,
        bodyEndExclusive: range.bodyEndExclusive,
        noteLines: section.noteLines,
      });
    } else {
      newSections.push(section);
    }
  }

  matches.sort((left, right) => right.headerIndex - left.headerIndex);

  for (const match of matches) {
    const bodyEmpty = match.bodyEndExclusive === match.headerIndex + 1;
    const insertion = bodyEmpty
      ? ["", ...match.noteLines]
      : match.noteLines.slice();
    lines = lines
      .slice(0, match.bodyEndExclusive)
      .concat(insertion, lines.slice(match.bodyEndExclusive));
  }

  let nextContent = lines.join(lineEnding);

  if (newSections.length > 0) {
    const hadTerminalNewline = /\r?\n$/.test(nextContent);
    for (const section of newSections) {
      if (nextContent && !nextContent.endsWith(lineEnding)) {
        nextContent += lineEnding;
      }
      if (nextContent && !nextContent.endsWith(lineEnding + lineEnding)) {
        nextContent += lineEnding;
      }
      nextContent += `## ${section.title}${lineEnding}${lineEnding}`;
      nextContent += section.noteLines.join(lineEnding);
    }
    if (hadTerminalNewline) {
      nextContent += lineEnding;
    }
  }

  return Object.freeze({
    content: nextContent,
    insertedCount: matches.length,
    createdCount: newSections.length,
  });
}

// Seed the new project note from the parsed source task: fill the `^prj`
// completion criteria, apply the source task's priority, optionally move the
// source task's managed logs under `^prj`, and optionally insert converted child
// tasks into the `## Tasks` section. Returns a result object:
//   seeded               - the `^prj` completion placeholder was found & filled
//   managedLogsInserted  - managed-log lines were inserted under `^prj`
//   tasksInserted        - child tasks were inserted into `## Tasks`
//   tasksSectionMissing  - child tasks were requested but `## Tasks` was absent
//   content              - the rewritten content (unchanged when not seeded)
function buildProjectContentFromTask(content, parsedTask, options = {}) {
  const text = String(content || "");
  if (!text.includes(PROJECT_COMPLETION_PLACEHOLDER)) {
    return Object.freeze({
      content: text,
      seeded: false,
      managedLogsInserted: false,
      tasksInserted: false,
      tasksSectionMissing: false,
      sectionsInserted: 0,
      sectionsCreated: 0,
    });
  }

  let nextContent = text.replace(
    PROJECT_COMPLETION_PLACEHOLDER,
    parsedTask.description,
  );
  if (parsedTask.priority !== null && parsedTask.priority !== undefined) {
    nextContent = nextContent.replace(
      /\[p::\s*2\s*\]/,
      `[p::${parsedTask.priority}]`,
    );
  }

  const managedLogLines = Array.isArray(options.managedLogLines)
    ? options.managedLogLines
    : [];
  let managedLogsInserted = false;
  if (managedLogLines.length > 0) {
    const managedLogResult = insertProjectManagedLogLines(
      nextContent,
      managedLogLines,
    );
    if (managedLogResult.inserted) {
      nextContent = managedLogResult.content;
      managedLogsInserted = true;
    }
  }

  const childTaskLines = Array.isArray(options.childTaskLines)
    ? options.childTaskLines
    : [];
  let tasksInserted = false;
  let tasksSectionMissing = false;
  if (childTaskLines.length > 0) {
    const tasksResult = replaceProjectTasksPlaceholder(
      nextContent,
      childTaskLines,
    );
    if (tasksResult.replaced) {
      nextContent = tasksResult.content;
      tasksInserted = true;
    } else {
      tasksSectionMissing = true;
    }
  }

  const sections = Array.isArray(options.sections) ? options.sections : [];
  let sectionsInserted = 0;
  let sectionsCreated = 0;
  if (sections.length > 0) {
    const sectionsResult = insertProjectSectionNotes(nextContent, sections);
    nextContent = sectionsResult.content;
    sectionsInserted = sectionsResult.insertedCount;
    sectionsCreated = sectionsResult.createdCount;
  }

  return Object.freeze({
    content: nextContent,
    seeded: true,
    managedLogsInserted,
    tasksInserted,
    tasksSectionMissing,
    sectionsInserted,
    sectionsCreated,
  });
}

function applyProjectCreationFrontmatter(
  frontmatter,
  parentLink,
  scheduled = null,
) {
  frontmatter.parent = parentLink;
  frontmatter.type = "[[project]]";
  frontmatter.status = "wip";
  if (scheduled !== null && scheduled !== undefined && scheduled !== "") {
    frontmatter.scheduled = scheduled;
  }
  return frontmatter;
}

// Remove a previously captured source task block (parent line plus any child
// lines). The block is removed at its original location when it still matches
// exactly there; otherwise it is removed only when it matches exactly at a
// single unique location. When no safe match exists the content is returned
// unchanged with removed=false so the caller can keep the source block.
function removeTaskBlockFromContent(content, block) {
  const text = String(content || "");
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const blockLines =
    block && Array.isArray(block.lines) ? block.lines.map(String) : [];
  if (blockLines.length === 0) {
    return Object.freeze({ content: text, removed: false });
  }

  const matchesAt = (index) => {
    if (index < 0 || index + blockLines.length > lines.length) {
      return false;
    }
    for (let offset = 0; offset < blockLines.length; offset += 1) {
      if (lines[index + offset] !== blockLines[offset]) {
        return false;
      }
    }
    return true;
  };

  const startLine = Math.floor(
    numericOrDefault(block && block.startLine, Number.NaN),
  );
  let removeIndex = -1;
  if (Number.isFinite(startLine) && matchesAt(startLine)) {
    removeIndex = startLine;
  } else {
    const matchingIndexes = [];
    for (let index = 0; index + blockLines.length <= lines.length; index += 1) {
      if (matchesAt(index)) {
        matchingIndexes.push(index);
      }
    }
    if (matchingIndexes.length === 1) {
      removeIndex = matchingIndexes[0];
    }
  }

  if (removeIndex === -1) {
    return Object.freeze({
      content: text,
      removed: false,
    });
  }

  lines.splice(removeIndex, blockLines.length);
  return Object.freeze({
    content: lines.join(lineEnding),
    removed: true,
  });
}

function truncateProjectTaskDescription(description) {
  const text = String(description || "").trim();
  if (text.length <= 80) {
    return text;
  }

  return `${text.slice(0, 77)}...`;
}

function getProjectFromTaskNoticeText(
  description,
  sourceBasename,
  createdBasename,
  updatedLinkCount,
  sectionCount,
  movedLogKinds = [],
) {
  const taskText = truncateProjectTaskDescription(description);
  const sourceText = String(sourceBasename || "").trim();
  const sourceSuffix = sourceText ? ` from ${sourceText}` : "";
  const createdText = String(createdBasename || "").trim();
  const projectSuffix = createdText ? ` ${createdText}` : "";
  const details = [`task removed${sourceSuffix}`];
  const numericLinkCount = numericOrDefault(updatedLinkCount, 0);
  if (numericLinkCount > 0) {
    details.push(
      `${numericLinkCount} ${numericLinkCount === 1 ? "link" : "links"} updated`,
    );
  }
  const numericSectionCount = numericOrDefault(sectionCount, 0);
  if (numericSectionCount > 0) {
    details.push(
      `${numericSectionCount} ${numericSectionCount === 1 ? "section" : "sections"} seeded`,
    );
  }
  const kindSet =
    movedLogKinds instanceof Set
      ? movedLogKinds
      : new Set(Array.isArray(movedLogKinds) ? movedLogKinds : []);
  if (kindSet.has(MANAGED_TASK_LOG_KIND_SCHEDULE)) {
    details.push("schedule log moved");
  }
  if (kindSet.has(MANAGED_TASK_LOG_KIND_WORK)) {
    details.push("work log moved");
  }
  if (kindSet.has(MANAGED_TASK_LOG_KIND_CANCEL)) {
    details.push("cancel log moved");
  }

  return `Created project${projectSuffix} from task "${taskText}" (${details.join("; ")})`;
}

function getProjectNoteToTaskNoticeText(
  noteBasename,
  parentBasename,
  taskCount,
  sectionCount,
  updatedLinkCount,
) {
  const note = String(noteBasename || "").trim() || "note";
  const parent = String(parentBasename || "").trim() || "parent";
  const details = [];
  const numericTaskCount = numericOrDefault(taskCount, 0);
  if (numericTaskCount > 0) {
    details.push(
      `${numericTaskCount} ${numericTaskCount === 1 ? "task" : "tasks"}`,
    );
  }
  const numericSectionCount = numericOrDefault(sectionCount, 0);
  if (numericSectionCount > 0) {
    details.push(
      `${numericSectionCount} ${
        numericSectionCount === 1 ? "section" : "sections"
      }`,
    );
  }
  const numericLinkCount = numericOrDefault(updatedLinkCount, 0);
  if (numericLinkCount > 0) {
    details.push(
      `${numericLinkCount} ${numericLinkCount === 1 ? "link" : "links"} updated`,
    );
  }

  const detailText =
    details.length > 0 ? details.join("; ") : "no child content";
  return `Converted ${note} into a task in ${parent} (${detailText})`;
}

function backlinkTextReferencesBlockId(text, blockId) {
  const id = String(blockId || "");
  if (!PROJECT_BLOCK_ID_RE.test(id)) {
    return false;
  }

  const re = new RegExp(`#\\^${escapeRegExp(id)}(?:$|[^A-Za-z0-9-])`);
  return re.test(String(text || ""));
}

function getProjectBasenameFromTaskBlockId(sourceBasename, blockId) {
  const sourceText = String(sourceBasename || "").trim();
  const id = String(blockId || "").trim();
  if (!sourceText || !PROJECT_BLOCK_ID_RE.test(id)) {
    return null;
  }

  return `${sourceText}_${id.replace(/-/g, "_")}`;
}

