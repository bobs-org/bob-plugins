function getYankPathText(kind, relativePath, basePath, homePath) {
  const vaultRelativePath = normalizeVaultRelativePath(relativePath);

  switch (kind) {
    case "absolute": {
      return joinFilesystemPath(basePath, vaultRelativePath);
    }
    case "absolute-tilde": {
      const absolutePath = joinFilesystemPath(basePath, vaultRelativePath);
      return absolutePath ? compactHomePath(absolutePath, homePath) : "";
    }
    case "basename":
      return getVaultPathBasename(vaultRelativePath);
    case "basename-no-extension":
      return getVaultPathBasenameWithoutExtension(vaultRelativePath);
    case "parent-directory":
      return getVaultRelativeParentDirectory(vaultRelativePath);
    case "relative":
      return vaultRelativePath;
    default:
      return null;
  }
}

function getYankPathPreviewText(result) {
  if (!result || !result.ok) {
    return result && result.message ? result.message : "Unavailable";
  }

  return result.text === "" ? "(empty string)" : result.text;
}

function createYankPathPickerItem(plugin, command, file) {
  const result = plugin.getActiveFileYankPath(command.kind, file);
  const available = !!(result && result.ok);

  return {
    kind: command.kind,
    title: YANK_PATH_PICKER_TITLES[command.kind] || command.name,
    preview: getYankPathPreviewText(result),
    actionLabel: available ? "Copy" : "Unavailable",
    available,
  };
}

function getCreatedNoteNoticeText(file, fallbackPath) {
  const path = file && file.path ? file.path : fallbackPath;
  const displayPath = String(path || "").trim();
  return displayPath ? `Created note: ${displayPath}` : "Created note";
}

function getDeletedFileNoticeText(path) {
  const displayPath = String(path || "").trim();
  return displayPath ? `Deleted "${displayPath}"` : "Deleted file";
}

function getFinalFileExtension(fileName) {
  const text = String(fileName || "");
  const basename = stripFinalExtension(text);
  return basename.length === text.length ? "" : text.slice(basename.length);
}

function getFileRenameParts(filePath) {
  const currentPath = normalizeVaultRelativePath(filePath);
  const { folderPath, fileName } = splitVaultPath(currentPath);
  const basename = stripFinalExtension(fileName);
  const extension = getFinalFileExtension(fileName);

  return {
    basename,
    currentPath,
    extension,
    fileName,
    folderPath,
  };
}

function normalizeRenameInput(input, extension) {
  let basename = String(input || "").trim();
  const preservedExtension = String(extension || "");

  if (
    preservedExtension &&
    basename.toLowerCase().endsWith(preservedExtension.toLowerCase())
  ) {
    basename = basename.slice(0, -preservedExtension.length).trim();
  }

  return basename;
}

function getRenameTargetPath(filePath, input) {
  const parts = getFileRenameParts(filePath);
  const basename = normalizeRenameInput(input, parts.extension);

  if (!basename) {
    return { ok: false, message: "File name is empty" };
  }

  if (basename.includes("/") || basename.includes("\\")) {
    return { ok: false, message: "File name cannot include folders" };
  }

  const fileName = `${basename}${parts.extension}`;
  const path = parts.folderPath
    ? joinPathSegments(parts.folderPath, fileName)
    : fileName;

  if (isUnsafeVaultPath(path)) {
    return { ok: false, message: "File name cannot include folders" };
  }

  if (path === parts.currentPath) {
    return { ok: false, message: "Choose a different name" };
  }

  return { ok: true, basename, path };
}

function createRenameLinkAudit(unavailable = false) {
  return {
    bodyLinks: 0,
    embeds: 0,
    frontmatterLinks: 0,
    referenceLinks: 0,
    sourceFilePaths: unavailable ? [] : new Set(),
    totalLinks: 0,
    unavailable,
  };
}

function getCachedReferenceItems(cache, key) {
  const value = cache && cache[key];
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value instanceof Map) {
    return Array.from(value.values()).flat();
  }

  if (typeof value === "object") {
    return Object.values(value).flat();
  }

  return [];
}

function getCachedReferenceLinkText(reference) {
  if (typeof reference === "string") {
    return reference;
  }

  if (!reference || typeof reference !== "object") {
    return "";
  }

  return typeof reference.link === "string" ? reference.link : "";
}

function getRenameAuditCount(value) {
  return Math.max(0, Math.floor(numericOrDefault(value, 0)));
}

function getRenameSourceFileCount(audit) {
  if (!audit) {
    return 0;
  }

  if (Number.isFinite(audit.sourceFileCount)) {
    return getRenameAuditCount(audit.sourceFileCount);
  }

  if (audit.sourceFilePaths instanceof Set) {
    return audit.sourceFilePaths.size;
  }

  if (Array.isArray(audit.sourceFilePaths)) {
    return new Set(audit.sourceFilePaths.filter(Boolean)).size;
  }

  return 0;
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getRenameCategoryNoticeParts(audit) {
  return [
    [audit && audit.bodyLinks, "body", "body"],
    [audit && audit.embeds, "embed", "embeds"],
    [audit && audit.frontmatterLinks, "property", "properties"],
    [audit && audit.referenceLinks, "reference", "references"],
  ]
    .map(([count, singular, plural]) => [
      getRenameAuditCount(count),
      singular,
      plural,
    ])
    .filter(([count]) => count > 0)
    .map(([count, singular, plural]) => pluralize(count, singular, plural));
}

function getRenamedFileNoticeText(oldPath, newPath, audit) {
  const prefix = `Renamed "${oldPath}" to "${newPath}"`;

  if (!audit || audit.unavailable) {
    return `${prefix} (link summary unavailable)`;
  }

  const totalLinks = getRenameAuditCount(audit.totalLinks);
  if (totalLinks === 0) {
    return `${prefix} (no links found)`;
  }

  const sourceFileCount = getRenameSourceFileCount(audit);
  const sourceText =
    sourceFileCount > 0
      ? ` in ${pluralize(sourceFileCount, "file", "files")}`
      : "";
  const categoryParts = getRenameCategoryNoticeParts(audit);
  const categoryText =
    categoryParts.length > 0 ? `: ${categoryParts.join(", ")}` : "";

  return `${prefix} (updated ${pluralize(
    totalLinks,
    "link",
    "links",
  )}${sourceText}${categoryText})`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseProjectTaskDescription(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getProjectPriorityField(description) {
  return (
    parseBulletPropertyFields(description).find(
      (field) => field.key === "p" && /^\d+$/.test(field.value),
    ) || null
  );
}

function validateProjectScheduledDate(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return Object.freeze({
      valid: false,
      value: text,
      message: "Scheduled date must use YYYY-MM-DD",
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year >= 0 && year < 100) {
    date.setUTCFullYear(year);
  }
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return Object.freeze({
      valid: false,
      value: text,
      message: `Scheduled date is not a valid calendar date: ${text}`,
    });
  }

  return Object.freeze({ valid: true, value: text, year, month, day });
}

function extractProjectSourceSchedule(description) {
  const text = String(description || "");
  const fields = parseBulletPropertyFields(text).filter(
    (field) => field.key === "scheduled",
  );
  if (fields.length === 0) {
    return Object.freeze({
      description: text,
      scheduled: null,
      error: null,
    });
  }
  if (fields.length > 1) {
    return Object.freeze({
      description: text,
      scheduled: null,
      error: "Source task has multiple [scheduled:: ...] fields; keep exactly one",
    });
  }

  const validation = validateProjectScheduledDate(fields[0].value);
  if (!validation.valid) {
    return Object.freeze({
      description: text,
      scheduled: null,
      error: validation.message,
    });
  }

  const field = fields[0];
  return Object.freeze({
    description:
      text.slice(0, field.span.start) + text.slice(field.span.end),
    scheduled: validation.value,
    error: null,
  });
}

function parseProjectSourceTaskLine(lineText) {
  const text = String(lineText || "");
  const match = PROJECT_SOURCE_TASK_LINE_RE.exec(text);
  if (!match) {
    return null;
  }

  const status = match[2];
  const body = match[3] || "";
  if (
    !PROJECT_OPEN_TASK_STATUSES.has(status) ||
    !PROJECT_TASK_TAG_RE.test(body)
  ) {
    return null;
  }

  let description = body;
  let blockId = null;
  const blockIdSpan = getTrailingBlockIdSpan(description);
  if (blockIdSpan) {
    blockId = blockIdSpan.text.trim().slice(1);
    description =
      description.slice(0, blockIdSpan.start) +
      description.slice(blockIdSpan.end);
  }

  let priority = null;
  const priorityField = getProjectPriorityField(description);
  if (priorityField) {
    priority = priorityField.value;
    description =
      description.slice(0, priorityField.span.start) +
      description.slice(priorityField.span.end);
  }

  const schedule = extractProjectSourceSchedule(description);
  description = schedule.description;

  description = collapseProjectTaskDescription(
    description.replace(PROJECT_TASK_TAG_GLOBAL_RE, "$1"),
  );
  if (!description) {
    return null;
  }

  return Object.freeze({
    description,
    priority,
    blockId,
    status,
    scheduled: schedule.scheduled,
    scheduleError: schedule.error,
  });
}

function getProjectSourceTaskLineNoticeText(lineText) {
  const text = String(lineText || "");
  const match = PROJECT_SOURCE_TASK_LINE_RE.exec(text);
  if (!match) {
    return "Place the cursor on an open #task checkbox";
  }

  const status = match[2];
  const body = match[3] || "";
  if (status === "x" || status === "-") {
    return "Done or cancelled tasks cannot create project notes";
  }

  if (!PROJECT_OPEN_TASK_STATUSES.has(status)) {
    return "Only open tasks can create project notes";
  }

  if (!PROJECT_TASK_TAG_RE.test(body)) {
    return "Project source task must include #task";
  }

  return "Task description is empty";
}

// Capture the selected source task plus its contiguous child block. The block
// is the parent line followed by every later line that is blank or indented
// deeper than the parent, stopping at the first nonblank line indented at or
// shallower than the parent (or EOF). Trailing blank lines past the last
// deeper-indented child are excluded so the surrounding blank separators are
// preserved. Returns { startLine, endLineExclusive, lines, childLines } or
// null when the line is not a list item.
function getProjectSourceTaskBlock(editor, lineNumber, parentLineText) {
  const parentMatch = PROJECT_LIST_ITEM_RE.exec(String(parentLineText || ""));
  if (!parentMatch) {
    return null;
  }

  const startLine = Math.floor(numericOrDefault(lineNumber, Number.NaN));
  if (!Number.isFinite(startLine) || startLine < 0) {
    return null;
  }

  const parentIndentLength = parentMatch[1].length;
  const lastLine = getEditorLastLine(editor);
  const lines = [String(parentLineText)];
  // Offset within `lines` of the last nonblank, deeper-indented child line.
  // Stays 0 (the parent) while no child content has been seen.
  let lastContentOffset = 0;

  if (lastLine !== null) {
    for (let line = startLine + 1; line <= lastLine; line += 1) {
      const lineText = getEditorLineText(editor, line);
      if (lineText === null) {
        break;
      }

      if (lineText.trim() === "") {
        lines.push(lineText);
        continue;
      }

      const indentMatch = /^(\s*)/.exec(lineText);
      const indentLength = indentMatch ? indentMatch[1].length : 0;
      if (indentLength > parentIndentLength) {
        lines.push(lineText);
        lastContentOffset = lines.length - 1;
        continue;
      }

      break;
    }
  }

  const blockLines = lines.slice(0, lastContentOffset + 1);
  return Object.freeze({
    startLine,
    endLineExclusive: startLine + blockLines.length,
    lines: Object.freeze(blockLines),
    childLines: Object.freeze(blockLines.slice(1)),
  });
}

// Parse a single child list item that is indented deeper than
// `parentIndentLength`. Returns marker/checkbox/body metadata or null when the
// line is not a list item or is not deeper than the parent.
function parseProjectChildListItem(lineText, parentIndentLength) {
  const text = String(lineText || "");
  const match = PROJECT_CHILD_LIST_ITEM_RE.exec(text);
  if (!match) {
    return null;
  }

  const indentLength = match[1].length;
  const minIndent = Math.floor(numericOrDefault(parentIndentLength, -1));
  if (Number.isFinite(minIndent) && indentLength <= minIndent) {
    return null;
  }

  const status = match[2] === undefined ? null : match[2];
  const body = String(match[3] || "");
  return Object.freeze({
    indent: match[1],
    indentLength,
    status,
    body,
    hasTask: PROJECT_TASK_TAG_RE.test(body),
    hasCreated: !!findBulletPropertyField(body, "created"),
  });
}

// Render a parsed direct-child list item as a top-level project task: preserve
// any existing checkbox status (defaulting to open), add a standalone #task
// token unless one is present, and append [created::DATE] unless the child
// already carries a created field. A trailing block ID is preserved.
function buildProjectTaskLineFromChildBullet(parsedChild, createdDateString) {
  if (!parsedChild) {
    return null;
  }

  const status =
    parsedChild.status === null || parsedChild.status === undefined
      ? " "
      : parsedChild.status;
  const trimmedBody = String(parsedChild.body || "").trim();
  let taskBody;
  if (parsedChild.hasTask) {
    taskBody = trimmedBody;
  } else {
    taskBody = trimmedBody ? `#task ${trimmedBody}` : "#task";
  }

  if (!parsedChild.hasCreated && createdDateString) {
    const createdField = `[created::${createdDateString}]`;
    const appendIndex = getBulletPropertyAppendIndex(taskBody);
    const before = taskBody.slice(0, appendIndex).replace(/[ \t]+$/, "");
    const after = taskBody.slice(appendIndex).replace(/^[ \t]+/, " ");
    taskBody = `${before} ${createdField}${after}`;
  }

  return `- [${status}] ${taskBody}`;
}

// Re-indent a line nested below a direct child so it sits one level deeper than
// the converted top-level task: the extra indentation beyond the direct child
// becomes the indentation under the new task. Blank lines collapse to "".
function normalizeNestedChildLine(lineText, directChildIndent) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const baseIndent = String(directChildIndent || "");
  let relativeIndent;
  if (baseIndent && leading.startsWith(baseIndent)) {
    relativeIndent = leading.slice(baseIndent.length);
  } else {
    relativeIndent = "\t";
  }
  if (relativeIndent === "") {
    relativeIndent = "\t";
  }

  return `${relativeIndent}${content}`;
}

// Re-indent a line nested below a project-note section bullet. Identical to
// normalizeNestedChildLine() except an empty relative indent stays empty: a
// section's direct children become top-level notes at column 0 rather than
// nesting under a converted task.
function normalizeProjectSectionNoteLine(lineText, baseIndent) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const base = String(baseIndent || "");
  let relativeIndent;
  if (base && leading.startsWith(base)) {
    relativeIndent = leading.slice(base.length);
  } else {
    relativeIndent = "\t";
  }

  return `${relativeIndent}${content}`;
}

// Re-indent a line from the source task's managed-log subtree so the marker
// bullet sits one Obsidian Tab level under the new note's `^prj` task and every
// descendant keeps its depth relative to that marker. Blank lines collapse to
// "". A descendant whose indentation does not extend the marker's falls back to
// one level deeper, like normalizeNestedChildLine().
function normalizeProjectManagedLogLine(lineText, markerIndent) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const base = String(markerIndent || "");
  let relativeIndent;
  if (base && leading.startsWith(base)) {
    relativeIndent = leading.slice(base.length);
  } else if (!base && leading === "") {
    relativeIndent = "";
  } else {
    relativeIndent = MANAGED_TASK_LOG_INDENT_UNIT;
  }

  return `${MANAGED_TASK_LOG_INDENT_UNIT}${relativeIndent}${content}`;
}

// Re-indent a line for the restored parent-task subtree. Blank lines collapse
// to "". Each nonblank line keeps the indent it had relative to `baseIndent`
// (the shallowest indent in its block) and is then prefixed with `depth` tabs.
// An indent that does not extend `baseIndent` falls back to one tab, matching
// normalizeProjectManagedLogLine().
function indentProjectReversalLine(lineText, baseIndent, depth) {
  const text = String(lineText || "");
  if (text.trim() === "") {
    return "";
  }

  const leadingMatch = /^(\s*)/.exec(text);
  const leading = leadingMatch ? leadingMatch[1] : "";
  const content = text.slice(leading.length);
  const base = String(baseIndent || "");
  let relativeIndent;
  if (leading.startsWith(base)) {
    relativeIndent = leading.slice(base.length);
  } else {
    relativeIndent = "\t";
  }

  const numericDepth = Math.max(0, Math.floor(numericOrDefault(depth, 0)));
  return `${"\t".repeat(numericDepth)}${relativeIndent}${content}`;
}

function getProjectReversalShallowestIndent(lines) {
  let base = null;
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = String(line === null || line === undefined ? "" : line);
    if (text.trim() === "") {
      continue;
    }
    const leadingMatch = /^(\s*)/.exec(text);
    const indent = leadingMatch ? leadingMatch[1] : "";
    if (base === null || indent.length < base.length) {
      base = indent;
    }
  }
  return base === null ? "" : base;
}

function indentProjectReversalLines(lines, depth) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const baseIndent = getProjectReversalShallowestIndent(sourceLines);
  const indented = [];
  for (const line of sourceLines) {
    const next = indentProjectReversalLine(line, baseIndent, depth);
    if (next) {
      indented.push(next);
    }
  }
  return indented;
}

// Inverse of getProjectBasenameFromTaskBlockId(): strip a leading
// `<parentBasename>_` when present, then turn `_` back into `-`. Block IDs
// cannot contain `_` or spaces, so a renamed note yields null.
function getProjectReversalBlockId(noteBasename, parentBasename) {
  const note = String(noteBasename || "").trim();
  if (!note) {
    return null;
  }

  const parent = String(parentBasename || "").trim();
  const prefix = parent ? `${parent}_` : "";
  const suffix =
    prefix && note.startsWith(prefix) ? note.slice(prefix.length) : note;
  if (!suffix) {
    return null;
  }

  const blockId = suffix.replace(/_/g, "-");
  return PROJECT_BLOCK_ID_RE.test(blockId) ? blockId : null;
}

function formatProjectReversalSectionTitle(headerText) {
  const title = String(headerText || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!PROJECT_SECTION_TITLE_RE.test(title) || !/[A-Z]/.test(title)) {
    return null;
  }

  return title;
}

function parseProjectLifecycleTaskBody(lineText) {
  const text = String(lineText || "");
  if (!isProjectLifecycleTaskLine(text)) {
    return null;
  }

  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  const status = match[1];
  let description = match[2] || "";
  const blockIdSpan = getTrailingBlockIdSpan(description);
  if (blockIdSpan) {
    description =
      description.slice(0, blockIdSpan.start) +
      description.slice(blockIdSpan.end);
  }

  description = collapseProjectTaskDescription(
    description
      .replace(PROJECT_TASK_TAG_GLOBAL_RE, "$1")
      .replace(PROJECT_LIFECYCLE_TAG_GLOBAL_RE, "$1"),
  );

  return Object.freeze({ status, description });
}

function getProjectFrontmatterCreatedDate(lines, closingLine) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const end = Math.floor(numericOrDefault(closingLine, Number.NaN));
  if (!Number.isFinite(end)) {
    return "";
  }

  for (
    let lineIndex = 1;
    lineIndex < end && lineIndex < sourceLines.length;
    lineIndex += 1
  ) {
    const match = /^created[ \t]*:(.*)$/.exec(
      String(sourceLines[lineIndex] || ""),
    );
    if (match) {
      const raw = getYamlScalarText(match[1]);
      const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
      return dateMatch ? dateMatch[1] : "";
    }
  }

  return "";
}

function appendProjectReversalTaskField(taskBody, fieldText) {
  const appendIndex = getBulletPropertyAppendIndex(taskBody);
  const before = taskBody.slice(0, appendIndex).replace(/[ \t]+$/, "");
  const after = taskBody.slice(appendIndex).replace(/^[ \t]+/, " ");
  return `${before} ${fieldText}${after}`;
}

function buildTaskLineFromProjectNote(fields) {
  const input = fields && typeof fields === "object" ? fields : {};
  const status =
    input.status === null || input.status === undefined ? " " : input.status;
  const description = collapseProjectTaskDescription(input.description);
  let taskBody = description ? `#task ${description}` : "#task";

  const scheduled = String(input.scheduled || "").trim();
  if (scheduled && !findBulletPropertyField(taskBody, "scheduled")) {
    taskBody = appendProjectReversalTaskField(
      taskBody,
      `[scheduled::${scheduled}]`,
    );
  }

  const created = String(input.created || "").trim();
  if (created && !findBulletPropertyField(taskBody, "created")) {
    taskBody = appendProjectReversalTaskField(taskBody, `[created::${created}]`);
  }

  const blockId = String(input.blockId || "").trim();
  if (blockId) {
    const appendIndex = getBulletPropertyAppendIndex(taskBody);
    const before = taskBody.slice(0, appendIndex).replace(/[ \t]+$/, "");
    taskBody = `${before} ^${blockId}`;
  }

  return `- [${status}] ${taskBody}`;
}

function getProjectParentBasenameFromLink(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  if (!text) {
    return "";
  }

  const wikiMatch = /\[\[([^\]|#\n]+)(?:[#|][^\]]*)?\]\]/.exec(text);
  if (wikiMatch) {
    const target = wikiMatch[1].trim().replace(/\\/g, "/");
    const base = target.split("/").pop() || "";
    return base.replace(MARKDOWN_EXTENSION_RE, "");
  }

  const markdownMatch = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/.exec(text);
  if (markdownMatch) {
    const target = String(markdownMatch[1] || "")
      .split("#")[0]
      .replace(/\\/g, "/");
    const base = target.split("/").pop() || "";
    return base.replace(MARKDOWN_EXTENSION_RE, "");
  }

  return "";
}

function isProjectFrontmatterParentLink(value) {
  if (value === null || value === undefined) {
    return false;
  }

  const text = String(value).trim();
  if (!text) {
    return false;
  }

  if (text.includes("[[") && text.includes("]]")) {
    return true;
  }

  return /\[[^\]]*\]\([^)\s]+\)/.test(text);
}

// Lowercase the whole body, uppercase the first character of every maximal
// run of letters/digits, and collapse internal whitespace runs to a single
// space. Acronyms are not special-cased: "API DESIGN" becomes "Api Design".
function formatProjectSectionTitle(body) {
  const collapsed = String(body || "")
    .trim()
    .replace(/\s+/g, " ");
  return collapsed
    .toLowerCase()
    .replace(/[a-z0-9]+/g, (run) => run.charAt(0).toUpperCase() + run.slice(1));
}

// The title-cased section title for a direct-child bullet body, or null when
// the trimmed body does not match the ALL-CAPS title shape (PROJECT_SECTION_TITLE_RE
// plus at least one letter, so an all-digit or empty body is rejected too).
function parseProjectSectionBulletTitle(body) {
  const trimmed = String(body || "").trim();
  if (!PROJECT_SECTION_TITLE_RE.test(trimmed) || !/[A-Z]/.test(trimmed)) {
    return null;
  }

  return formatProjectSectionTitle(trimmed);
}

// Casefolded, whitespace-collapsed comparison key for matching a section
// bullet's title against an existing note header regardless of casing.
function normalizeProjectSectionTitle(title) {
  return String(title || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Convert the captured child block into rendered Markdown lines for the new
// project's `## Tasks` section, note sections destined for other headers, and
// managed task-log child lines for the `^prj` task. Direct child list items
// (those at the shallowest child indentation) become top-level tasks unless they
// qualify as a managed schedule- or work-log marker or as a section bullet: no
// checkbox, an ALL-CAPS title (see PROJECT_SECTION_TITLE_RE), and at least one
// nonblank list item nested deeper than it. A qualifying section bullet's
// descendants are copied in verbatim as that section's notes instead; a
// non-qualifying bullet keeps today's task-conversion behavior. Two section
// bullets whose titles normalize equally merge into one section, in source
// order. Returns { taskLines, sections, managedLogLines, lossless }, where
// `sections` is [{ title, noteLines }] in source order, `managedLogLines` is
// already re-indented for insertion under `^prj` (schedule and work logs in
// source order), and `lossless` is false when any nonblank child line could not
// be represented (so the caller can keep the source block instead of losing
// content).
