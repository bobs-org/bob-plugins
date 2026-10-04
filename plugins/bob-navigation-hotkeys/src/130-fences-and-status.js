function isClosingFence(line, openingFence) {
  const match = String(line).match(CLOSING_FENCE_RE);
  if (!match) {
    return false;
  }

  return (
    match[2][0] === openingFence.markerChar &&
    match[2].length >= openingFence.markerLength
  );
}

function getSectionHeaderLines(lines) {
  const sourceLines = Array.isArray(lines)
    ? lines
    : String(lines || "").split(/\r?\n/);
  const headerLines = [];
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

    if (SECTION_HEADER_RE.test(line)) {
      headerLines.push(lineIndex);
    }
  }

  return headerLines;
}

function getSectionHeaderJumpLine(lines, cursorLine, direction) {
  const currentLine = Math.floor(numericOrDefault(cursorLine, Number.NaN));
  if (!Number.isFinite(currentLine)) {
    return null;
  }

  const headerLines = getSectionHeaderLines(lines);
  if (direction < 0) {
    for (let index = headerLines.length - 1; index >= 0; index -= 1) {
      if (headerLines[index] < currentLine) {
        return headerLines[index];
      }
    }
    return headerLines.length > 0 ? headerLines[headerLines.length - 1] : null;
  }

  for (const headerLine of headerLines) {
    if (headerLine > currentLine) {
      return headerLine;
    }
  }

  return headerLines.length > 0 ? headerLines[0] : null;
}

// True for a genuine Markdown checkbox list item that carries the Tasks
// plugin's standalone `#task` global-filter token. Status is deliberately not
// considered here: done and custom-status tasks remain valid task records.
function isObsidianTaskLine(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  if (!match) {
    return false;
  }

  const body = match[2] || "";
  return PROJECT_TASK_TAG_RE.test(body);
}

function getObsidianTaskCheckboxStatus(lineText) {
  const match = OBSIDIAN_TASK_LINE_RE.exec(String(lineText || ""));
  return match && isObsidianTaskLine(lineText) ? match[1] : null;
}

function getObsidianTaskStatusRank(status) {
  const checkbox = String(status ?? "");
  return Object.prototype.hasOwnProperty.call(
    OBSIDIAN_TASK_STATUS_RANKS,
    checkbox,
  )
    ? OBSIDIAN_TASK_STATUS_RANKS[checkbox]
    : null;
}


// Blocked is open for dependency semantics but intentionally has no active
// promotion rank. A blocked parent therefore contributes the minimum Ready
// request while Next and In Progress retain their existing ordering.
function getDependencyPromotionStatus(status) {
  return status === "?" ? " " : status;
}

function promoteObsidianTaskCheckboxStatus(lineText, desiredStatus) {
  const line = String(lineText || "");
  const currentStatus = getObsidianTaskCheckboxStatus(line);
  const currentRank = getObsidianTaskStatusRank(currentStatus);
  const desiredRank = getObsidianTaskStatusRank(desiredStatus);
  if (
    currentRank === null ||
    desiredRank === null ||
    currentRank >= desiredRank
  ) {
    return line;
  }
  const match = OBSIDIAN_TASK_LINE_RE.exec(line);
  const checkboxOffset = match[0].indexOf(`[${currentStatus}]`) + 1;
  return (
    line.slice(0, checkboxOffset) +
    String(desiredStatus) +
    line.slice(checkboxOffset + 1)
  );
}

function blockObsidianTaskCheckboxStatus(lineText) {
  const line = String(lineText || "");
  const currentStatus = getObsidianTaskCheckboxStatus(line);
  if (!OPEN_OBSIDIAN_TASK_STATUSES.has(currentStatus) || currentStatus === "?") {
    return line;
  }
  const match = OBSIDIAN_TASK_LINE_RE.exec(line);
  const checkboxOffset = match[0].indexOf(`[${currentStatus}]`) + 1;
  return line.slice(0, checkboxOffset) + "?" + line.slice(checkboxOffset + 1);
}

function replaceObsidianTaskCheckboxStatus(
  lineText,
  replacement,
  expectedStatus = null,
) {
  const line = String(lineText || "");
  const currentStatus = getObsidianTaskCheckboxStatus(line);
  if (
    currentStatus === null ||
    (expectedStatus !== null && currentStatus !== expectedStatus) ||
    String(replacement || "").length !== 1
  ) {
    return line;
  }
  const match = OBSIDIAN_TASK_LINE_RE.exec(line);
  const checkboxOffset = match[0].indexOf(`[${currentStatus}]`) + 1;
  return (
    line.slice(0, checkboxOffset) +
    replacement +
    line.slice(checkboxOffset + 1)
  );
}

function unavailableTasksStatusRegistry(error) {
  return Object.freeze({
    safe: false,
    error: String(error || "Tasks status registry is unavailable"),
    globalFilter: "#task",
    statusTypes: CONVENTIONAL_TASK_STATUS_TYPES,
  });
}

function parseTasksStatusRegistry(settings) {
  let value = settings;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_error) {
      return unavailableTasksStatusRegistry(
        "Tasks settings are not valid JSON",
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return unavailableTasksStatusRegistry("Tasks settings are unreadable");
  }

  const globalFilter =
    typeof value.globalFilter === "string"
      ? value.globalFilter
      : "#task";
  const statusTypes = { ...CONVENTIONAL_TASK_STATUS_TYPES };
  const configuredSymbols = new Set();
  const definitions = [];
  let ambiguous = false;
  for (const collection of ["coreStatuses", "customStatuses"]) {
    const statuses =
      value.statusSettings &&
      Array.isArray(value.statusSettings[collection])
        ? value.statusSettings[collection]
        : [];
    for (const status of statuses) {
      if (!status || typeof status !== "object") {
        ambiguous = true;
        continue;
      }
      const symbol =
        typeof status.symbol === "string" ? status.symbol : "";
      const characters = Array.from(symbol);
      if (characters.length !== 1) {
        ambiguous = true;
        continue;
      }
      if (configuredSymbols.has(symbol)) {
        ambiguous = true;
        continue;
      }
      configuredSymbols.add(symbol);
      const type =
        typeof status.type === "string" ? status.type : "TODO";
      statusTypes[symbol] = type;
      definitions.push({
        symbol,
        name: typeof status.name === "string" ? status.name : "",
        nextStatusSymbol:
          typeof status.nextStatusSymbol === "string"
            ? status.nextStatusSymbol
            : "",
        availableAsCommand: status.availableAsCommand === true,
        type,
      });
    }
  }

  const blocked = definitions.filter(
    (definition) =>
      definition.symbol === "?" ||
      definition.name.toLowerCase() === "blocked",
  );
  const compatibleBlocked =
    blocked.length === 1 &&
    blocked[0].symbol === "?" &&
    blocked[0].name === "Blocked" &&
    blocked[0].type === "ON_HOLD" &&
    blocked[0].nextStatusSymbol === " " &&
    blocked[0].availableAsCommand;
  const safe = !ambiguous && compatibleBlocked;
  return Object.freeze({
    safe,
    error: safe
      ? null
      : ambiguous
        ? "Tasks status registry is ambiguous"
        : "Tasks Blocked status is missing or incompatible",
    globalFilter,
    statusTypes: Object.freeze(statusTypes),
  });
}

function recoveryTaskStatusType(registry, status) {
  if (
    !registry ||
    !registry.statusTypes ||
    !Object.prototype.hasOwnProperty.call(registry.statusTypes, status)
  ) {
    return null;
  }
  return registry.statusTypes[status];
}

function parseRecoveryTaskDependencies(value) {
  const text = String(value || "");
  if (!text || text.includes("\t")) {
    return null;
  }
  const dependencies = text.split(",").map((part) => part.trim());
  return dependencies.every((dependency) =>
    TASKS_DEPENDENCY_ID_RE.test(dependency),
  )
    ? dependencies
    : null;
}

function validRecoveryTaskDateShape(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function parseTrailingRecoveryTaskMetadata(body) {
  let state = String(body || "").trimEnd();
  const trailingBlock = /\s+\^[A-Za-z0-9-]+\s*$/.exec(state);
  if (trailingBlock) {
    state = state.slice(0, trailingBlock.index).trimEnd();
  }
  const metadata = { taskId: null, dependsOn: [] };

  for (let iteration = 0; iteration < 20; iteration += 1) {
    state = state.trimEnd().replace(/,\s*$/, "").trimEnd();
    const close = state.at(-1);
    const open = close === "]" ? "[" : close === ")" ? "(" : null;
    if (!open) {
      const tag = /(?:^|\s)#[^\s#]+$/.exec(state);
      if (tag) {
        state = state.slice(0, tag.index).trimEnd();
        continue;
      }
      break;
    }
    const start = state.lastIndexOf(open);
    if (start === -1) {
      break;
    }
    const inner = state.slice(start + 1, -1).trim();
    const delimiter = inner.indexOf("::");
    if (delimiter === -1) {
      break;
    }
    const key = inner.slice(0, delimiter);
    const value = inner.slice(delimiter + 2).trim();
    let recognized = false;
    if (key === "id" && TASKS_DEPENDENCY_ID_RE.test(value)) {
      metadata.taskId = value;
      recognized = true;
    } else if (key === "dependsOn") {
      const dependencies = parseRecoveryTaskDependencies(value);
      if (dependencies) {
        metadata.dependsOn = dependencies;
        recognized = true;
      }
    } else if (key === "priority") {
      recognized = [
        "highest",
        "high",
        "medium",
        "low",
        "lowest",
      ].includes(value);
    } else if (key === "scheduled") {
      recognized = validateProjectScheduledDate(value).valid;
    } else if (
      ["start", "created", "due", "completion", "cancelled"].includes(key)
    ) {
      recognized = validRecoveryTaskDateShape(value);
    } else if (key === "repeat") {
      recognized = /^[A-Za-z0-9, !]*$/.test(value);
    } else if (key === "onCompletion") {
      recognized = /^[A-Za-z]+$/.test(value);
    }
    if (!recognized) {
      break;
    }
    state = state.slice(0, start).trimEnd();
  }
  return metadata;
}

function parseScheduledRecoveryTaskLine(
  lineText,
  registry,
  line = -1,
) {
  const text = String(lineText || "");
  const match = OBSIDIAN_TASK_LINE_RE.exec(text);
  if (!match) {
    return null;
  }
  const body = match[2] || "";
  const globalFilter =
    registry && typeof registry.globalFilter === "string"
      ? registry.globalFilter
      : "#task";
  if (!body.includes(globalFilter)) {
    return null;
  }
  const status = match[1];
  const statusType = recoveryTaskStatusType(registry, status);
  const metadata = parseTrailingRecoveryTaskMetadata(body);
  return Object.freeze({
    line,
    text,
    status,
    statusType,
    statusRecognized: statusType !== null,
    blockId: getTrailingBlockId(text),
    taskId: metadata.taskId,
    dependsOn: Object.freeze(metadata.dependsOn.slice()),
  });
}

function recoveryIdentity(path, blockId) {
  return `${normalizeVaultRelativePath(path)}\u0000${String(blockId || "")}`;
}

function isScheduledRecoveryMarkdownPath(path) {
  const normalized = normalizeVaultRelativePath(path);
  if (!MARKDOWN_EXTENSION_RE.test(normalized)) {
    return false;
  }
  const directories = normalized.split("/").slice(0, -1);
  return !directories.some(
    (directory) =>
      directory === "done" ||
      directory === "_generated" ||
      directory === "_templates" ||
      directory.startsWith("."),
  );
}

function canonicalRecoveryMarkdownPath(target) {
  const text = normalizeVaultRelativePath(target);
  if (
    !text ||
    text.startsWith("/") ||
    text.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return MARKDOWN_EXTENSION_RE.test(text) ? text : `${text}.md`;
}

function recoveryMarkdownBasename(path) {
  const parts = normalizeVaultRelativePath(path).split("/");
  return String(parts.at(-1) || "").replace(MARKDOWN_EXTENSION_RE, "");
}

function createScheduledRecoveryNoteIndex(files) {
  const paths = new Set();
  const basenames = new Map();
  let duplicatePath = false;
  for (const file of files) {
    const path = normalizeVaultRelativePath(file.path);
    if (paths.has(path)) {
      duplicatePath = true;
      continue;
    }
    paths.add(path);
    const basename = recoveryMarkdownBasename(path).toLowerCase();
    if (!basenames.has(basename)) {
      basenames.set(basename, path);
    } else if (basenames.get(basename) !== path) {
      basenames.set(basename, null);
    }
  }
  return { paths, basenames, duplicatePath };
}

function resolveScheduledRecoveryNote(index, sourcePath, target) {
  const rawTarget = String(target || "").trim();
  if (!rawTarget) {
    return normalizeVaultRelativePath(sourcePath);
  }
  const exact = canonicalRecoveryMarkdownPath(rawTarget);
  if (!exact) {
    return null;
  }
  if (index.paths.has(exact)) {
    return exact;
  }
  return index.basenames.get(recoveryMarkdownBasename(exact).toLowerCase()) || null;
}

// Promotion references on one child line (`docs/task-dependencies.md` §5):
// every Depends-On line link, plus an R8 legacy child only while the
// dependent's field manages its target id. Anything else — a `#^ref`
// reading embed, prose, a malformed line — yields nothing. `context` carries
// the dependent's `dependsOn` field, its note path, the note index, and the
// recovery block map for the R8 gate.
function recoveryDependencyReferences(lineText, dependsOn, blocks, context = {}) {
  const text = String(lineText || "");
  const parsed = parseDependencyLine(text, { isDirectChildOfTask: true });
  if (parsed && parsed.verdict === "accept") {
    return Object.freeze(
      parsed.links.map((link) =>
        Object.freeze({ target: link.note, blockId: link.blockId }),
      ),
    );
  }
  const legacy = parseDependencyLegacyChildDetails(text);
  if (!legacy) {
    return Object.freeze([]);
  }
  // The Rust reader takes no aliases on legacy children; an aliased sole
  // link is content until a writer canonicalises it onto the line.
  if (/\|[^]\n]*\]\]/.test(text)) {
    return Object.freeze([]);
  }
  if (
    !recoveryLegacyChildCovered(legacy, dependsOn || [], context, blocks)
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([
    Object.freeze({ target: legacy.note, blockId: legacy.blockId }),
  ]);
}

// R8 field gate for recovery: the legacy child's resolved target id (its
// `[id::]`, canonical id, or same-note bare block id) is in the dependent's
// field. Unresolvable targets are content here, never edges: unlike line
// links they must not poison `rankSafe`.
function recoveryLegacyChildCovered(legacy, dependsOn, context, blocks) {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) {
    return false;
  }
  const field = new Set(dependsOn);
  const sourcePath =
    context && context.sourcePath
      ? normalizeVaultRelativePath(context.sourcePath)
      : "";
  let targetPath = null;
  if (!legacy.note && sourcePath) {
    targetPath = sourcePath;
  } else if (context && context.noteIndex) {
    targetPath = resolveScheduledRecoveryNote(
      context.noteIndex,
      sourcePath,
      legacy.note,
    );
  }
  if (!targetPath) {
    return false;
  }
  const candidates = new Set();
  if (blocks instanceof Map) {
    for (const task of blocks.get(
      recoveryIdentity(targetPath, legacy.blockId),
    ) || []) {
      if (task && task.taskId) {
        candidates.add(task.taskId);
      }
    }
  }
  const canonical = tryDependencyId(targetPath, legacy.blockId);
  if (canonical) {
    candidates.add(canonical);
  }
  if (!legacy.note) {
    candidates.add(legacy.blockId);
  }
  for (const candidate of candidates) {
    if (field.has(candidate)) {
      return true;
    }
  }
  return false;
}

// Archived (`done/`) link targets are resolved, closed prerequisites: never
// edges and never `rankSafe` poison, the same as Rust.
function isArchivedRecoveryTarget(linkTarget) {
  const raw = String(linkTarget || "").trim();
  if (!raw) {
    return false;
  }
  const full = canonicalRecoveryMarkdownPath(raw);
  if (!full) {
    return false;
  }
  return full.split("/").slice(0, -1).includes("done");
}

function recoveryStrikethroughSpans(lineText) {
  const text = String(lineText || "");
  const delimiters = [];
  let offset = 0;
  while ((offset = text.indexOf("~~", offset)) !== -1) {
    delimiters.push(offset);
    offset += 2;
  }
  const spans = [];
  for (let index = 0; index + 1 < delimiters.length; index += 2) {
    spans.push({ start: delimiters[index], end: delimiters[index + 1] + 2 });
  }
  return spans;
}

function recoveryBlockReferences(lineText) {
  const text = String(lineText || "");
  const spans = recoveryStrikethroughSpans(text);
  const references = [];
  const pattern = /!?\[\[([^|\]\n]*?)#\^([A-Za-z0-9-]+)(?:\|[^\]\n]*)?\]\]/g;
  let match = null;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    const retired = spans.some(
      (span) => start >= span.start + 2 && end <= span.end - 2,
    );
    if (!retired) {
      references.push(
        Object.freeze({ target: match[1].trim(), blockId: match[2] }),
      );
    }
  }
  return references;
}

function recentPomodoroReferences(content) {
  const text = String(content || "");
  const { lines } = splitMarkdownContent(text);
  const contexts = getMarkdownLineContexts(text);
  const heading = lines.findIndex(
    (line, index) =>
      !contexts[index].inFrontmatter &&
      !contexts[index].inFence &&
      isPomodorosHeading(line),
  );
  if (heading === -1) {
    return Object.freeze([]);
  }
  const references = [];
  let eligibleEntry = false;
  for (let index = heading + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (!contexts[index].inFence && isLevelTwoHeading(line)) {
      break;
    }
    if (contexts[index].inFence) {
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const entry = /^-\s+\[([^\]\n])\](?:\s+(.*))?$/.exec(line);
      eligibleEntry = Boolean(
        entry && POMODORO_NAVIGATION_STATUSES.has(entry[1]),
      );
      continue;
    }
    if (line.trim() && !/^[ \t]/.test(line)) {
      eligibleEntry = false;
      continue;
    }
    if (!eligibleEntry || !/^\s+(?:[-*+]|\d+[.)])\s+/.test(line)) {
      continue;
    }
    references.push(...recoveryBlockReferences(line));
  }
  return Object.freeze(references);
}

function canonicalRecoveryDailyDate(path) {
  const match = /^(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/.exec(
    normalizeVaultRelativePath(path),
  );
  if (!match || match[1] !== match[2]) {
    return null;
  }
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (!isValidDateParts(match[2], match[3], match[4])) {
    return null;
  }
  return Object.freeze({
    value: year * 10000 + month * 100 + day,
    path: normalizeVaultRelativePath(path),
  });
}

function scheduledRecoveryDailyPaths(files, today = new Date()) {
  const localToday = getLocalDateStart(today);
  const todayValue =
    localToday.getFullYear() * 10000 +
    (localToday.getMonth() + 1) * 100 +
    localToday.getDate();
  const dates = files
    .map((file) => canonicalRecoveryDailyDate(file.path))
    .filter(Boolean);
  const current = dates.find((entry) => entry.value === todayValue) || null;
  const previous =
    dates
      .filter((entry) => entry.value < todayValue)
      .sort((left, right) => right.value - left.value)[0] || null;
  return Object.freeze({
    current: current ? current.path : null,
    previous: previous ? previous.path : null,
  });
}

function strongestScheduledRecoveryRank(tasks) {
  let rank = null;
  for (const task of tasks || []) {
    const current = getObsidianTaskStatusRank(task.status);
    if (current !== null && (rank === null || current > rank)) {
      rank = current;
    }
  }
  return rank;
}

function computeScheduledRecoveryRanks(roots, edges, blocks) {
  const ranks = new Map();
  const queue = [];
  for (const root of roots) {
    const rank = Math.max(1, strongestScheduledRecoveryRank(blocks.get(root)) ?? 1);
    if (!ranks.has(root) || ranks.get(root) < rank) {
      ranks.set(root, rank);
      queue.push(root);
    }
  }
  while (queue.length > 0) {
    const source = queue.shift();
    const sourceRank = ranks.get(source);
    for (const target of edges.get(source) || []) {
      const targetRank = Math.max(
        sourceRank,
        strongestScheduledRecoveryRank(blocks.get(target)) ?? sourceRank,
      );
      if (!ranks.has(target) || ranks.get(target) < targetRank) {
        ranks.set(target, targetRank);
        queue.push(target);
      }
    }
  }
  return ranks;
}

function deferredScheduledRecovery(reason) {
  return Object.freeze({
    state: "deferred",
    rank: null,
    reason: String(reason || "status reconciliation is unsafe"),
  });
}

function buildScheduledRecoveryIndex(files, registry, today = new Date()) {
  const markdownFiles = (Array.isArray(files) ? files : [])
    .filter((file) => isScheduledRecoveryMarkdownPath(file.path))
    .map((file) => ({
      path: normalizeVaultRelativePath(file.path),
      content: String(file.content || ""),
    }));
  const noteIndex = createScheduledRecoveryNoteIndex(markdownFiles);
  const tasksByTarget = new Map();
  const blocks = new Map();
  const dependencyIds = new Map();
  const fileModels = new Map();
  let rankSafe = !noteIndex.duplicatePath;

  for (const file of markdownFiles) {
    const { lines } = splitMarkdownContent(file.content);
    const contexts = getMarkdownLineContexts(file.content);
    const tasks = [];
    for (let line = 0; line < lines.length; line += 1) {
      if (contexts[line].inFrontmatter || contexts[line].inFence) {
        continue;
      }
      const task = parseScheduledRecoveryTaskLine(
        lines[line],
        registry,
        line,
      );
      if (!task) {
        continue;
      }
      tasks.push(task);
      tasksByTarget.set(recoveryIdentity(file.path, String(line)), task);
      if (task.blockId) {
        const identity = recoveryIdentity(file.path, task.blockId);
        if (!blocks.has(identity)) {
          blocks.set(identity, []);
        }
        blocks.get(identity).push(task);
      }
      if (task.taskId) {
        if (!dependencyIds.has(task.taskId)) {
          dependencyIds.set(task.taskId, []);
        }
        dependencyIds.get(task.taskId).push(task);
      }
    }
    fileModels.set(file.path, { file, lines, contexts, tasks });
  }

  const edges = new Map();
  for (const [path, model] of fileModels) {
    for (const task of model.tasks) {
      if (!task.blockId) {
        continue;
      }
      const source = recoveryIdentity(path, task.blockId);
      const sourceIndent = getBulletIndentWidth(model.lines[task.line]);
      for (let line = task.line + 1; line < model.lines.length; line += 1) {
        const lineText = String(model.lines[line] || "");
        if (!lineText.trim() || model.contexts[line].inFence) {
          continue;
        }
        if (getBulletIndentWidth(lineText) <= sourceIndent) {
          break;
        }
        if (findNearestParentListItem(model.lines, line) !== task.line) {
          continue;
        }
        // Promotion edges (`docs/task-dependencies.md` §5): the Depends-On
        // line links plus R8 legacy children, the same as Rust. `#^ref`
        // reading embeds and other unmanaged sole embeds are content, never
        // edges.
        for (const reference of recoveryDependencyReferences(
          lineText,
          task.dependsOn || [],
          blocks,
          { noteIndex, sourcePath: path },
        )) {
          if (isArchivedRecoveryTarget(reference.target)) {
            continue;
          }
          const targetPath = resolveScheduledRecoveryNote(
            noteIndex,
            path,
            reference.target,
          );
          const target = targetPath
            ? recoveryIdentity(targetPath, reference.blockId)
            : null;
          if (!target || !blocks.has(target)) {
            rankSafe = false;
            continue;
          }
          if (!edges.has(source)) {
            edges.set(source, new Set());
          }
          edges.get(source).add(target);
        }
      }
    }
  }

  const dailyPaths = scheduledRecoveryDailyPaths(markdownFiles, today);
  const roots = new Set();
  for (const dailyPath of [dailyPaths.current, dailyPaths.previous]) {
    if (!dailyPath) {
      continue;
    }
    const daily = fileModels.get(dailyPath);
    for (const reference of recentPomodoroReferences(daily.file.content)) {
      const targetPath = resolveScheduledRecoveryNote(
        noteIndex,
        dailyPath,
        reference.target,
      );
      const target = targetPath
        ? recoveryIdentity(targetPath, reference.blockId)
        : null;
      if (!target || !blocks.has(target)) {
        rankSafe = false;
        continue;
      }
      roots.add(target);
    }
  }
  const ranks = computeScheduledRecoveryRanks(roots, edges, blocks);

  return Object.freeze({
    safe: Boolean(registry && registry.safe),
    error:
      registry && registry.safe
        ? null
        : registry && registry.error
          ? registry.error
          : "Tasks status registry is unavailable",
    rankSafe,
    registry,
    tasksByTarget,
    blocks,
    dependencyIds,
    ranks,
    dailyPaths,
  });
}

