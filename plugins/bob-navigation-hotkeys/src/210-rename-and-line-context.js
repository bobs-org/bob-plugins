class RenameCurrentFileModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.parts = getFileRenameParts(file && file.path);
    this.submitting = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("bob-rename-file-modal");
    contentEl.addClass("bob-rename-file");

    const header = contentEl.createDiv({ cls: "bob-rename-file-header" });
    const icon = header.createDiv({ cls: "bob-rename-file-header-icon" });
    applyIcon(icon, "file-pen-line");

    const headerText = header.createDiv({ cls: "bob-rename-file-header-text" });
    headerText.createDiv({
      cls: "bob-rename-file-title",
      text: "Rename current file",
    });
    headerText.createDiv({
      cls: "bob-rename-file-subtitle",
      text: this.parts.currentPath,
    });

    const field = contentEl.createDiv({ cls: "bob-rename-file-field" });
    field.createEl("label", {
      cls: "bob-rename-file-label",
      text: "File name",
    });
    this.inputEl = field.createEl("input", {
      cls: "bob-rename-file-input",
      attr: {
        "aria-label": "File name",
        type: "text",
      },
    });
    this.inputEl.value = this.parts.basename;
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.submit();
    });

    const actions = contentEl.createDiv({ cls: "bob-rename-file-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => this.close());
    this.renameButtonEl = actions.createEl("button", {
      cls: "mod-cta",
      text: "Rename",
    });
    this.renameButtonEl.addEventListener("click", () => this.submit());

    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 0);
  }

  onClose() {
    this.modalEl.removeClass("bob-rename-file-modal");
    this.contentEl.empty();
  }

  setSubmitting(submitting) {
    this.submitting = submitting;
    if (this.renameButtonEl) {
      this.renameButtonEl.disabled = submitting;
    }
    if (this.inputEl) {
      this.inputEl.disabled = submitting;
    }
  }

  async submit() {
    if (this.submitting) {
      return;
    }

    this.setSubmitting(true);
    try {
      const renamed = await this.plugin.renameCurrentFileToName(
        this.inputEl ? this.inputEl.value : "",
      );
      if (renamed) {
        this.close();
      }
    } finally {
      this.setSubmitting(false);
    }
  }
}

function addElementClasses(el, ...classes) {
  if (!el || !el.classList) {
    return;
  }

  classes.filter(Boolean).forEach((className) => el.classList.add(className));
}

function fuzzyMatchesText(source, query) {
  const haystack = String(source || "").toLowerCase();
  const needle = String(query || "").toLowerCase();
  if (!needle) {
    return true;
  }

  let haystackIndex = 0;
  for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
    haystackIndex = haystack.indexOf(needle[needleIndex], haystackIndex);
    if (haystackIndex === -1) {
      return false;
    }
    haystackIndex += 1;
  }

  return true;
}

function truncateBulletPropertySubtitle(line) {
  const text = String(line || "").trim();
  if (text.length <= 140) {
    return text;
  }

  return `${text.slice(0, 137)}...`;
}

function getBulletPropertyFieldMap(line) {
  const fields = new Map();
  parseBulletPropertyFields(line).forEach((field) => {
    if (!fields.has(field.key)) {
      fields.set(field.key, field);
    }
  });
  return fields;
}

function splitMarkdownContent(content) {
  const text = String(content || "");
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  return {
    lines: text.split(/\r?\n/),
    lineEnding,
  };
}

function isProjectLifecycleTaskLine(lineText) {
  const text = String(lineText || "");
  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  if (!match || getTrailingBlockId(text) !== "prj") {
    return false;
  }

  return PROJECT_TASK_TAG_RE.test(match[2] || "");
}

function getMarkdownLineContext(content, targetLine) {
  const { lines } = splitMarkdownContent(content);
  if (
    !Number.isInteger(targetLine) ||
    targetLine < 0 ||
    targetLine >= lines.length
  ) {
    return Object.freeze({ valid: false, inFrontmatter: false, inFence: false });
  }

  let inFrontmatter = startsWithFrontmatter(lines);
  let inFence = null;
  for (let lineIndex = 0; lineIndex <= targetLine; lineIndex += 1) {
    const line = String(lines[lineIndex] || "");
    if (inFrontmatter) {
      if (lineIndex > 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      if (lineIndex === targetLine) {
        return Object.freeze({
          valid: true,
          inFrontmatter: true,
          inFence: false,
        });
      }
      continue;
    }

    if (inFence) {
      const targetIsInFence = lineIndex === targetLine;
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      if (targetIsInFence) {
        return Object.freeze({
          valid: true,
          inFrontmatter: false,
          inFence: true,
        });
      }
      continue;
    }

    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      if (lineIndex === targetLine) {
        return Object.freeze({
          valid: true,
          inFrontmatter: false,
          inFence: true,
        });
      }
      continue;
    }

    if (lineIndex === targetLine) {
      return Object.freeze({
        valid: true,
        inFrontmatter: false,
        inFence: false,
      });
    }
  }

  return Object.freeze({ valid: false, inFrontmatter: false, inFence: false });
}

function getMarkdownLineContextsForLines(lines) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const contexts = [];
  let inFrontmatter = startsWithFrontmatter(sourceLines);
  let inFence = null;
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = String(sourceLines[lineIndex] || "");
    if (inFrontmatter) {
      contexts.push(
        Object.freeze({ valid: true, inFrontmatter: true, inFence: false }),
      );
      if (lineIndex > 0 && FRONTMATTER_DELIMITER_RE.test(line)) {
        inFrontmatter = false;
      }
      continue;
    }
    if (inFence) {
      contexts.push(
        Object.freeze({ valid: true, inFrontmatter: false, inFence: true }),
      );
      if (isClosingFence(line, inFence)) {
        inFence = null;
      }
      continue;
    }
    const openingFence = getFenceOpening(line);
    if (openingFence) {
      inFence = openingFence;
      contexts.push(
        Object.freeze({ valid: true, inFrontmatter: false, inFence: true }),
      );
      continue;
    }
    contexts.push(
      Object.freeze({ valid: true, inFrontmatter: false, inFence: false }),
    );
  }
  return Object.freeze(contexts);
}

function getMarkdownLineContexts(content) {
  return getMarkdownLineContextsForLines(splitMarkdownContent(content).lines);
}

// Short-lived per-note parse snapshot shared by one dependency stage build.
// Tied to exact note content: lines, Markdown contexts, scanned task entries
// (with forward-carried sections), lazily built block-id identities, and a
// per-parent dependency-collection cache. Never reuse across changed editor
// content, write-planner intermediate content, or reopened stages.
function createDependencyNoteSnapshot(content) {
  const text = String(content || "");
  const { lines, lineEnding } = splitMarkdownContent(text);
  const contexts = getMarkdownLineContextsForLines(lines);
  let currentSection = null;
  const entries = [];
  for (let line = 0; line < lines.length; line += 1) {
    const rawLine = String(lines[line] || "");
    const sectionMatch = DEPENDENCY_STAGE_SECTION_RE.exec(rawLine);
    if (sectionMatch) {
      const heading = (sectionMatch[1] || "").trim() || null;
      currentSection = heading;
    }
    const context = contexts[line] || {};
    if (!context.valid || context.inFrontmatter || context.inFence) {
      continue;
    }
    if (isObsidianTaskLine(rawLine)) {
      const match = OBSIDIAN_TASK_LINE_RE.exec(rawLine);
      const status = match ? match[1] : " ";
      const idField = findBulletPropertyField(rawLine, "id");
      entries.push(
        Object.freeze({
          line,
          rawLine,
          isTask: true,
          status,
          open: OPEN_OBSIDIAN_TASK_STATUSES.has(status),
          blocked: status === "?",
          text: cleanTaskDisplayText(rawLine),
          blockId: getTrailingBlockId(rawLine),
          idField: idField
            ? normalizeBulletPropertyValue(idField.value)
            : null,
          hidden: hasWholeTaskTag(rawLine, PROJECT_HIDE_TAG),
          section: currentSection,
        }),
      );
      continue;
    }
    const blockId = getTrailingBlockId(rawLine);
    if (blockId) {
      entries.push(
        Object.freeze({
          line,
          rawLine,
          isTask: false,
          status: null,
          open: false,
          blocked: false,
          text: rawLine.trim(),
          blockId,
          idField: null,
          hidden: false,
          section: currentSection,
        }),
      );
    }
  }
  return {
    text,
    lines,
    lineEnding,
    contexts,
    entries: Object.freeze(entries),
    identities: null,
    collections: new Map(),
  };
}

function getDependencySnapshotIdentities(snapshot) {
  if (!snapshot) {
    return new Map();
  }
  if (snapshot.identities) {
    return snapshot.identities;
  }
  const identities = new Map();
  for (const entry of snapshot.entries) {
    if (!entry.isTask || !entry.blockId) {
      continue;
    }
    identities.set(
      entry.blockId,
      entry.idField || entry.blockId,
    );
  }
  snapshot.identities = identities;
  return identities;
}

function dependencySnapshotKey(additionalManagedIds) {
  if (!additionalManagedIds || additionalManagedIds.length === 0) {
    return "";
  }
  try {
    return JSON.stringify(
      normalizeDependencyNavigationTargets(additionalManagedIds).map(
        dependencyNavigationTargetKey,
      ),
    );
  } catch (_error) {
    return `count:${additionalManagedIds.length}`;
  }
}

function vaultStageYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Whole-note dependency operations must reject task-shaped examples in YAML
// frontmatter and fenced code, even when the individual line looks valid.
function isObsidianTaskAtLine(
  content,
  lineIndex,
  lineContexts = null,
  sourceLines = null,
) {
  const lines = sourceLines || splitMarkdownContent(content).lines;
  const context = lineContexts
    ? lineContexts[lineIndex] || {
        valid: false,
        inFrontmatter: false,
        inFence: false,
      }
    : getMarkdownLineContext(content, lineIndex);
  return (
    context.valid &&
    !context.inFrontmatter &&
    !context.inFence &&
    isObsidianTaskLine(lines[lineIndex])
  );
}

function isProjectLifecycleTaskAtLine(content, lineIndex) {
  const { lines } = splitMarkdownContent(content);
  const context = getMarkdownLineContext(content, lineIndex);
  return (
    context.valid &&
    !context.inFrontmatter &&
    !context.inFence &&
    isProjectLifecycleTaskLine(lines[lineIndex])
  );
}

function getYamlScalarText(rawValue) {
  const text = String(rawValue || "").trim();
  const quoted = /^(["'])(.*)\1(?:[ \t]+#.*)?$/.exec(text);
  if (quoted) {
    return quoted[2].trim();
  }

  return text.replace(/[ \t]+#.*$/, "").trim();
}

function parseProjectNoteFrontmatter(content, options = {}) {
  const { lines, lineEnding } = splitMarkdownContent(content);
  if (!startsWithFrontmatter(lines)) {
    return Object.freeze({
      valid: false,
      error: "Project note has no YAML frontmatter",
    });
  }

  let closingLine = -1;
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[lineIndex])) {
      closingLine = lineIndex;
      break;
    }
  }
  if (closingLine === -1) {
    return Object.freeze({
      valid: false,
      error: "Project note frontmatter is not closed",
    });
  }

  const yamlText = lines.slice(1, closingLine).join("\n");
  let data;
  try {
    const yamlParser = options.parseYaml || parseYaml;
    data = yamlParser(yamlText);
  } catch (error) {
    return Object.freeze({
      valid: false,
      error: "Project note frontmatter is malformed",
    });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return Object.freeze({
      valid: false,
      error: "Project note frontmatter must be a YAML mapping",
    });
  }
  const typeLine = lines
    .slice(1, closingLine)
    .map((line, index) => ({
      line: index + 1,
      match: /^type[ \t]*:(.*)$/.exec(line),
    }))
    .find((entry) => entry.match);
  const rawType = typeLine ? getYamlScalarText(typeLine.match[1]) : "";
  if (!isProjectType(data.type) && rawType !== PROJECT_TYPE_WIKILINK) {
    return Object.freeze({
      valid: false,
      error: "The ^prj task is not in a project note",
    });
  }

  const scheduledLines = [];
  for (let lineIndex = 1; lineIndex < closingLine; lineIndex += 1) {
    const match = /^scheduled[ \t]*:(.*)$/.exec(lines[lineIndex]);
    if (match) {
      scheduledLines.push({ line: lineIndex, rawValue: match[1] });
    }
  }
  if (scheduledLines.length > 1) {
    return Object.freeze({
      valid: false,
      error: "Project note has multiple scheduled properties",
    });
  }

  const scheduledDefined = Object.prototype.hasOwnProperty.call(
    data,
    "scheduled",
  );
  if (scheduledDefined !== (scheduledLines.length === 1)) {
    return Object.freeze({
      valid: false,
      error: "Project scheduled must be a top-level YAML property",
    });
  }

  let scheduledValue = "";
  if (scheduledDefined) {
    const parsedValue = data.scheduled;
    if (
      parsedValue !== null &&
      parsedValue !== undefined &&
      typeof parsedValue !== "string" &&
      !(parsedValue instanceof Date)
    ) {
      return Object.freeze({
        valid: false,
        error: "Project scheduled must be a YYYY-MM-DD date",
      });
    }
    scheduledValue = getYamlScalarText(scheduledLines[0].rawValue);
    const validation = validateProjectScheduledDate(scheduledValue);
    if (!validation.valid) {
      return Object.freeze({ valid: false, error: validation.message });
    }
    scheduledValue = validation.value;
  }

  return Object.freeze({
    valid: true,
    error: null,
    data,
    lines,
    lineEnding,
    closingLine,
    scheduledDefined,
    scheduledValue,
    scheduledLine: scheduledDefined ? scheduledLines[0].line : null,
  });
}

function emptyProjectNoteReversalSplit(error, extra = {}) {
  return Object.freeze({
    valid: false,
    error,
    status: extra.status === undefined ? null : extra.status,
    description:
      extra.description === undefined ? null : extra.description,
    lifecycleChildLines: Object.freeze(
      Array.isArray(extra.lifecycleChildLines)
        ? extra.lifecycleChildLines.slice()
        : [],
    ),
    taskLines: Object.freeze([]),
    sections: Object.freeze([]),
  });
}

function getProjectReversalChildLines(lines, startIndex) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const parentLine = String(sourceLines[startIndex] || "");
  const parentMatch = PROJECT_LIST_ITEM_RE.exec(parentLine);
  if (!parentMatch) {
    return [];
  }

  const parentIndentLength = parentMatch[1].length;
  const collected = [];
  let lastContentOffset = -1;
  for (let index = startIndex + 1; index < sourceLines.length; index += 1) {
    const lineText = String(sourceLines[index] || "");
    if (lineText.trim() === "") {
      collected.push(lineText);
      continue;
    }

    const indentMatch = /^(\s*)/.exec(lineText);
    const indentLength = indentMatch ? indentMatch[1].length : 0;
    if (indentLength > parentIndentLength) {
      collected.push(lineText);
      lastContentOffset = collected.length - 1;
      continue;
    }

    break;
  }

  return lastContentOffset === -1
    ? []
    : collected.slice(0, lastContentOffset + 1);
}

function formatProjectReversalSnippet(lineText) {
  return truncateProjectTaskDescription(String(lineText || "").trim());
}

function formatProjectReversalSectionLabel(headerText) {
  return String(headerText || "")
    .trim()
    .replace(/\s+/g, " ");
}

function splitProjectNoteForReversal(content) {
  const { lines } = splitMarkdownContent(content);
  const contexts = getMarkdownLineContexts(content);
  const prjIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const context = contexts[index];
    if (!context || context.inFrontmatter || context.inFence) {
      continue;
    }
    if (isProjectLifecycleTaskLine(lines[index])) {
      prjIndexes.push(index);
    }
  }

  if (prjIndexes.length === 0) {
    return emptyProjectNoteReversalSplit("Project note has no ^prj task");
  }
  if (prjIndexes.length > 1) {
    return emptyProjectNoteReversalSplit(
      "Project note has multiple ^prj tasks",
    );
  }

  const prjIndex = prjIndexes[0];
  const parsed = parseProjectLifecycleTaskBody(lines[prjIndex]);
  const status = parsed ? parsed.status : null;
  const description = parsed ? parsed.description : "";
  const lifecycleChildLines = getProjectReversalChildLines(lines, prjIndex);
  const prjBlockEnd = prjIndex + lifecycleChildLines.length;
  const splitExtra = { status, description, lifecycleChildLines };

  const taskLines = [];
  const sections = [];
  let index = 0;
  while (index < lines.length) {
    const context = contexts[index];
    if (!context || context.inFrontmatter) {
      index += 1;
      continue;
    }

    if (index === prjIndex) {
      index = prjBlockEnd + 1;
      continue;
    }

    const line = String(lines[index] || "");
    if (
      context.valid &&
      !context.inFence &&
      PROJECT_SECTION_HEADER_RE.test(line)
    ) {
      const headerMatch = PROJECT_SECTION_HEADER_RE.exec(line);
      const headerText = headerMatch && headerMatch[1] ? headerMatch[1] : "";
      const sectionLabel = formatProjectReversalSectionLabel(headerText);
      const bodyLines = [];
      let bodyIndex = index + 1;
      for (; bodyIndex < lines.length; bodyIndex += 1) {
        const bodyContext = contexts[bodyIndex];
        const bodyLine = String(lines[bodyIndex] || "");
        if (
          bodyContext &&
          bodyContext.valid &&
          !bodyContext.inFrontmatter &&
          !bodyContext.inFence &&
          PROJECT_SECTION_BOUNDARY_HEADER_RE.test(bodyLine)
        ) {
          break;
        }
        if (bodyLine.trim() === "") {
          continue;
        }
        if (
          bodyContext &&
          bodyContext.valid &&
          !bodyContext.inFence &&
          PROJECT_LIST_ITEM_RE.test(bodyLine)
        ) {
          bodyLines.push(bodyLine);
          continue;
        }

        return emptyProjectNoteReversalSplit(
          `Section "${sectionLabel}" has content that is not a list item: "${formatProjectReversalSnippet(bodyLine)}"`,
          splitExtra,
        );
      }

      if (normalizeProjectSectionTitle(headerText) === "tasks") {
        for (const item of bodyLines) {
          if (!item.includes(PROJECT_TASKS_PLACEHOLDER)) {
            taskLines.push(item);
          }
        }
      } else if (bodyLines.length > 0) {
        const title = formatProjectReversalSectionTitle(headerText);
        if (!title) {
          return emptyProjectNoteReversalSplit(
            `Section "${sectionLabel}" cannot be converted into a task bullet`,
            splitExtra,
          );
        }
        sections.push(
          Object.freeze({
            title,
            noteLines: Object.freeze(bodyLines.slice()),
          }),
        );
      }

      index = bodyIndex;
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    return emptyProjectNoteReversalSplit(
      `Project note has content outside the ^prj task and its sections: "${formatProjectReversalSnippet(line)}"`,
      splitExtra,
    );
  }

  return Object.freeze({
    valid: true,
    error: null,
    status,
    description,
    lifecycleChildLines: Object.freeze(lifecycleChildLines.slice()),
    taskLines: Object.freeze(taskLines),
    sections: Object.freeze(sections),
  });
}

function emptyProjectNoteReversalBlock(error, extra = {}) {
  return Object.freeze({
    valid: false,
    error,
    lines: Object.freeze([]),
    taskCount: 0,
    sectionCount: 0,
    blockId: extra.blockId === undefined ? null : extra.blockId,
    scheduled: extra.scheduled || "",
    created: extra.created || "",
    parentLink: extra.parentLink === undefined ? null : extra.parentLink,
  });
}

function buildTaskBlockFromProjectNote(content, options = {}) {
  const frontmatter = parseProjectNoteFrontmatter(content, options);
  if (!frontmatter.valid) {
    return emptyProjectNoteReversalBlock(frontmatter.error);
  }

  const split = splitProjectNoteForReversal(content);
  if (
    split.error === "Project note has multiple ^prj tasks" ||
    split.error === "Project note has no ^prj task"
  ) {
    return emptyProjectNoteReversalBlock(split.error, {
      parentLink: frontmatter.data && frontmatter.data.parent,
    });
  }

  if (split.status === null || split.status === undefined) {
    return emptyProjectNoteReversalBlock(
      split.error || "Project note has no ^prj task",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }

  if (!PROJECT_OPEN_TASK_STATUSES.has(split.status)) {
    return emptyProjectNoteReversalBlock(
      "Only open projects can be converted back to a task",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }
  if (
    String(split.description || "").includes(PROJECT_COMPLETION_PLACEHOLDER)
  ) {
    return emptyProjectNoteReversalBlock(
      "Project completion criteria is still the template placeholder",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }
  if (!split.description) {
    return emptyProjectNoteReversalBlock(
      "Project completion criteria is empty",
      { parentLink: frontmatter.data && frontmatter.data.parent },
    );
  }
  if (!split.valid) {
    return emptyProjectNoteReversalBlock(split.error, {
      parentLink: frontmatter.data && frontmatter.data.parent,
    });
  }

  const noteBasename = String(options.noteBasename || "").trim();
  const parentBasename =
    options.parentBasename === undefined
      ? getProjectParentBasenameFromLink(
          frontmatter.data && frontmatter.data.parent,
        )
      : String(options.parentBasename || "").trim();
  const blockId = getProjectReversalBlockId(noteBasename, parentBasename);
  const scheduled = frontmatter.scheduledValue || "";
  const createdRaw = getProjectFrontmatterCreatedDate(
    frontmatter.lines,
    frontmatter.closingLine,
  );
  const now = options.now instanceof Date ? options.now : new Date();
  const created = createdRaw || formatProjectTaskCreatedDate(now);
  const taskLine = buildTaskLineFromProjectNote({
    status: split.status,
    description: split.description,
    scheduled,
    created,
    blockId,
  });

  const indentedTasks = indentProjectReversalLines(split.taskLines, 1);
  const lines = [taskLine, ...indentedTasks];
  let sectionCount = 0;
  for (const section of split.sections) {
    lines.push(`\t- ${section.title}`);
    lines.push(...indentProjectReversalLines(section.noteLines, 2));
    sectionCount += 1;
  }
  lines.push(...indentProjectReversalLines(split.lifecycleChildLines, 1));

  let taskCount = 0;
  for (const line of indentedTasks) {
    const parsedChild = parseProjectChildListItem(line, 0);
    if (parsedChild && parsedChild.indent === "\t") {
      taskCount += 1;
    }
  }

  return Object.freeze({
    valid: true,
    error: null,
    lines: Object.freeze(lines),
    taskCount,
    sectionCount,
    blockId,
    scheduled,
    created,
    parentLink: frontmatter.data && frontmatter.data.parent,
  });
}

function getProjectNotePropertyContext(content, lineIndex, options = {}) {
  if (!isProjectLifecycleTaskAtLine(content, lineIndex)) {
    return Object.freeze({
      valid: true,
      isProjectTask: false,
      frontmatter: null,
    });
  }

  const frontmatter = parseProjectNoteFrontmatter(content, options);
  if (!frontmatter.valid) {
    return Object.freeze({
      valid: false,
      isProjectTask: true,
      error: frontmatter.error,
      frontmatter,
    });
  }

  return Object.freeze({
    valid: true,
    isProjectTask: true,
    error: null,
    frontmatter,
  });
}

