// Project blocking from the `^prj` line: recognition, block state, ADJ-11
// walk-through, recovery edges, and the resident-tag signal.
// Contract: `docs/task-dependencies.md` §13 (PDB/PDT) and Design §2–3.

const PROJECT_BLOCKED_TAG = "#prj_is_blocked";
const PROJECT_BLOCKED_TAG_RE =
  /(^|[\s([{])#prj_is_blocked(?=$|[\s)\]},.;:!?])/;
const PROJECT_TERMINAL_STATUSES = new Set(["done", "canceled", "cancelled"]);

function taskHasProjectBlockedTag(lineText) {
  return PROJECT_BLOCKED_TAG_RE.test(String(lineText || ""));
}

function collectProjectNoteTaskRows(content) {
  const { lines } = splitMarkdownContent(content);
  const contexts = getMarkdownLineContexts(content);
  const prj = [];
  const residents = [];
  for (let line = 0; line < lines.length; line += 1) {
    const context = contexts[line];
    if (!context || context.inFrontmatter || context.inFence) {
      continue;
    }
    const lineText = String(lines[line] || "");
    if (isBlockquotedMarkdownLine(lineText)) {
      continue;
    }
    if (!isObsidianTaskLine(lineText)) {
      continue;
    }
    const status = getObsidianTaskCheckboxStatus(lineText);
    if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
      continue;
    }
    const row = Object.freeze({
      line,
      text: lineText,
      status,
      blockId: getTrailingBlockId(lineText),
    });
    if (isProjectLifecycleTaskLine(lineText)) {
      prj.push(row);
    } else {
      residents.push(row);
    }
  }
  return Object.freeze({
    prj: Object.freeze(prj),
    residents: Object.freeze(residents),
  });
}

function readProjectFrontmatterRecognition(content) {
  const { lines } = splitMarkdownContent(content);
  if (!startsWithFrontmatter(lines)) {
    return Object.freeze({
      isProjectType: false,
      status: "",
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
      isProjectType: false,
      status: "",
    });
  }
  let typeValue = "";
  let statusValue = "";
  for (let lineIndex = 1; lineIndex < closingLine; lineIndex += 1) {
    const typeMatch = /^type[ \t]*:(.*)$/.exec(lines[lineIndex]);
    if (typeMatch && !typeValue) {
      typeValue = getYamlScalarText(typeMatch[1]);
    }
    const statusMatch = /^status[ \t]*:(.*)$/.exec(lines[lineIndex]);
    if (statusMatch && !statusValue) {
      statusValue = getYamlScalarText(statusMatch[1]);
    }
  }
  return Object.freeze({
    isProjectType: typeValue === PROJECT_TYPE_WIKILINK,
    status: normalizeStatus(statusValue),
  });
}

function projectLooksBlockedByPrjShortcut(content) {
  const rows = collectProjectNoteTaskRows(content);
  return rows.prj.length === 1 && rows.prj[0].status === "?";
}

function canonicalProjectDependencyPath(note, sourcePath) {
  const trimmed = String(note || "").trim();
  if (!trimmed) {
    return normalizeVaultRelativePath(sourcePath);
  }
  return canonicalRecoveryMarkdownPath(trimmed) || `${trimmed}.md`;
}

function collectProjectTaskDependencyItems(content, sourcePath) {
  const rows = collectProjectNoteTaskRows(content);
  if (rows.prj.length !== 1) {
    return Object.freeze([]);
  }
  const { lines } = splitMarkdownContent(content);
  const prjLine = rows.prj[0].line;
  const source = normalizeVaultRelativePath(sourcePath);
  const items = [];
  const sourceIndent = getBulletIndentWidth(lines[prjLine]);
  for (let line = prjLine + 1; line < lines.length; line += 1) {
    const lineText = String(lines[line] || "");
    if (!lineText.trim()) {
      continue;
    }
    if (getBulletIndentWidth(lineText) <= sourceIndent) {
      break;
    }
    if (findNearestParentListItem(lines, line) !== prjLine) {
      continue;
    }
    const details = parseDependencyNavigationBulletDetails(lineText);
    if (!details) {
      continue;
    }
    for (const link of details.links) {
      const path = canonicalProjectDependencyPath(link.note, source);
      const internal = !link.note || (source && path === source);
      const archive =
        isArchivedRecoveryTarget(link.note) || isArchivedRecoveryTarget(path);
      items.push(
        Object.freeze({
          note: String(link.note || ""),
          path,
          blockId: link.blockId,
          line,
          internal,
          archive,
        }),
      );
    }
  }
  return Object.freeze(items);
}

function readProjectTaskScheduledValue(lineText) {
  const field = findBulletPropertyField(lineText, "scheduled");
  return field ? String(field.value || "").trim() : "";
}

function getProjectBlockState(content, path, today, lookupOpen, options = {}) {
  const notePath = normalizeVaultRelativePath(path);
  const recognition = readProjectFrontmatterRecognition(content);
  const rows = collectProjectNoteTaskRows(content);
  const daily = Boolean(canonicalRecoveryDailyDate(notePath));
  const terminal = PROJECT_TERMINAL_STATUSES.has(recognition.status);
  const isProject =
    recognition.isProjectType &&
    !daily &&
    !terminal &&
    rows.prj.length === 1;
  const empty = (extra = {}) =>
    Object.freeze({
      isProject: false,
      reasons: Object.freeze([]),
      prjLine: rows.prj.length === 1 ? rows.prj[0].line : -1,
      prjStatus: rows.prj.length === 1 ? rows.prj[0].status : null,
      residents: rows.residents,
      openItems: Object.freeze([]),
      ...extra,
    });
  if (!isProject) {
    return empty();
  }

  const items = collectProjectTaskDependencyItems(content, notePath);
  const openLookup = typeof lookupOpen === "function" ? lookupOpen : () => false;
  const openItems = [];
  for (const item of items) {
    if (item.internal || item.archive) {
      continue;
    }
    if (openLookup(item.path, item.blockId, item)) {
      openItems.push(item);
    }
  }
  const reasons = [];
  if (openItems.length > 0) {
    reasons.push(
      Object.freeze({
        kind: "project_dependency",
        projectPath: notePath,
        targetIds: Object.freeze(
          openItems.map((item) => `${item.path}#^${item.blockId}`),
        ),
      }),
    );
  }
  const scheduledValue = Object.prototype.hasOwnProperty.call(
    options,
    "scheduledValue",
  )
    ? options.scheduledValue == null
      ? ""
      : String(options.scheduledValue)
    : readProjectTaskScheduledValue(rows.prj[0].text);
  if (isFutureInlineScheduledValue(scheduledValue, today)) {
    reasons.push(
      Object.freeze({
        kind: "project_schedule",
        projectPath: notePath,
        scheduled: scheduledValue,
      }),
    );
  }

  return Object.freeze({
    isProject: true,
    reasons: Object.freeze(reasons),
    prjLine: rows.prj[0].line,
    prjStatus: rows.prj[0].status,
    residents: rows.residents,
    openItems: Object.freeze(openItems),
  });
}

function resolveProjectDependencyFilePath(filesMap, sourcePath, item) {
  const raw = String(item && item.path ? item.path : "").trim();
  if (!raw) {
    return normalizeVaultRelativePath(sourcePath);
  }
  const exact = canonicalRecoveryMarkdownPath(
    String(raw).replace(/\.md$/i, ""),
  );
  if (exact && filesMap.has(exact)) {
    return exact;
  }
  const withMd = /\.md$/i.test(raw) ? raw : `${raw}.md`;
  const normalized = normalizeVaultRelativePath(withMd);
  if (filesMap.has(normalized)) {
    return normalized;
  }
  const base = recoveryMarkdownBasename(normalized).toLowerCase();
  let found = null;
  for (const filePath of filesMap.keys()) {
    if (recoveryMarkdownBasename(filePath).toLowerCase() === base) {
      if (found && found !== filePath) {
        return null;
      }
      found = filePath;
    }
  }
  return found;
}

function collectProjectDependencyPromotionRows(
  filesMap,
  projectPath,
  visited = new Set(),
) {
  const path = normalizeVaultRelativePath(projectPath);
  const visitKey = `prj:${path}`;
  if (!path || visited.has(visitKey)) {
    return [];
  }
  visited.add(visitKey);
  if (!filesMap.has(path)) {
    return [];
  }
  const items = collectProjectTaskDependencyItems(filesMap.get(path), path);
  const rows = [];
  for (const item of items) {
    if (item.internal || item.archive) {
      continue;
    }
    const targetPath = resolveProjectDependencyFilePath(filesMap, path, item);
    if (!targetPath || !filesMap.has(targetPath)) {
      continue;
    }
    const targetLines = String(filesMap.get(targetPath) || "").split(/\r?\n/);
    const line = findTaskLineByTrailingBlockId(targetLines, item.blockId);
    if (line === null) {
      continue;
    }
    const text = String(targetLines[line] || "");
    const status = getObsidianTaskCheckboxStatus(text);
    if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
      continue;
    }
    if (isProjectLifecycleTaskLine(text) && item.blockId === "prj") {
      rows.push(
        ...collectProjectDependencyPromotionRows(filesMap, targetPath, visited),
      );
      continue;
    }
    rows.push(
      Object.freeze({
        path: targetPath,
        line,
        text,
        blockId: item.blockId,
      }),
    );
  }
  return rows;
}

// Direct-child Depends-On links of open tasks in `lines`, each carrying
// that task's own checkbox status. Closed tasks never promote (ADJ-11
// move path).
function collectOpenTaskDependsOnLinks(lines) {
  const source = Array.isArray(lines) ? lines : [];
  const items = [];
  for (let line = 0; line < source.length; line += 1) {
    const text = String(source[line] || "");
    if (!isOpenObsidianTaskLine(text)) {
      continue;
    }
    const status = getObsidianTaskCheckboxStatus(text);
    const indent = getBulletIndentWidth(text);
    for (let child = line + 1; child < source.length; child += 1) {
      const childText = String(source[child] || "");
      if (!childText.trim()) {
        continue;
      }
      if (getBulletIndentWidth(childText) <= indent) {
        break;
      }
      if (findNearestParentListItem(source, child) !== line) {
        continue;
      }
      const details = parseDependencyNavigationBulletDetails(childText);
      if (!details) {
        continue;
      }
      for (const link of details.links || []) {
        items.push(Object.freeze({ status, link }));
      }
    }
  }
  return Object.freeze(items);
}

// Promote one open prerequisite for a move into a blocked project
// (ADJ-11/PDB9): never raise a `^prj` target; walk through to that
// project's open Depends-On links. Returns how many lines changed.
function promoteMovePrerequisiteTarget(
  files,
  changes,
  otherContents,
  refPath,
  blockId,
  desiredLane,
) {
  const path = normalizeVaultRelativePath(refPath);
  if (!path || !blockId || !files || !files.has(path) || !desiredLane) {
    return 0;
  }
  const content = String(files.get(path) || "");
  const contentLines = content.split(/\r?\n/);
  const at = findTaskLineByTrailingBlockId(contentLines, blockId);
  if (at === null) {
    return 0;
  }
  const text = String(contentLines[at] || "");
  const status = getObsidianTaskCheckboxStatus(text);
  // ADJ-11 walk-through runs before the `?` gate (like the dependency-edit
  // path): a `[?]` `^prj` never promotes itself, but its open Depends-On
  // targets still rise. Closed lines never promote.
  const isPrjWalkThrough =
    isProjectLifecycleTaskLine(text) && blockId === "prj";
  if (!OPEN_OBSIDIAN_TASK_STATUSES.has(status)) {
    return 0;
  }
  if (status === "?" && !isPrjWalkThrough) {
    return 0;
  }
  let count = 0;
  const applyPromotion = (targetPath, line, from, to) => {
    if (from === to) {
      return;
    }
    const current = String(files.get(targetPath) || "");
    const ending = current.includes("\r\n") ? "\r\n" : "\n";
    const nextLines = current.split(/\r?\n/);
    if (line < 0 || line >= nextLines.length) {
      return;
    }
    nextLines[line] = to;
    const after = nextLines.join(ending);
    files.set(targetPath, after);
    const before = changes.has(targetPath)
      ? changes.get(targetPath).before
      : otherContents && otherContents.get(targetPath);
    if (after !== before) {
      changes.set(
        targetPath,
        Object.freeze({ before: String(before || ""), after }),
      );
      count += 1;
    }
  };
  if (isProjectLifecycleTaskLine(text) && blockId === "prj") {
    for (const walked of collectProjectDependencyPromotionRows(files, path)) {
      applyPromotion(
        walked.path,
        walked.line,
        walked.text,
        promoteObsidianTaskCheckboxStatus(walked.text, desiredLane),
      );
    }
    return count;
  }
  applyPromotion(
    path,
    at,
    text,
    promoteObsidianTaskCheckboxStatus(text, desiredLane),
  );
  return count;
}

function formatProjectRecoveryReason(reasons) {
  const dependency = (Array.isArray(reasons) ? reasons : []).find(
    (reason) => reason.kind === "project_dependency",
  );
  if (dependency && dependency.targetIds && dependency.targetIds.length > 0) {
    return `project_dependency: ${dependency.targetIds[0]}`;
  }
  const scheduled = (Array.isArray(reasons) ? reasons : []).find(
    (reason) => reason.kind === "project_schedule",
  );
  if (scheduled && scheduled.scheduled) {
    return `project_schedule: ${scheduled.scheduled}`;
  }
  return "project_dependency";
}

function applyProjectRecoveryEdges(args = {}) {
  const markdownFiles = Array.isArray(args.markdownFiles) ? args.markdownFiles : [];
  const noteIndex = args.noteIndex;
  const blocks = args.blocks instanceof Map ? args.blocks : new Map();
  const edges = args.edges instanceof Map ? args.edges : new Map();
  const today = args.today || new Date();
  const projectBlocked = new Map();
  const lookupOpen = (sourcePath, item) => {
    if (!item || item.internal || item.archive) {
      return false;
    }
    if (isArchivedRecoveryTarget(item.path)) {
      return false;
    }
    const targetPath = resolveScheduledRecoveryNote(
      noteIndex,
      sourcePath,
      String(item.path || "").replace(/\.md$/i, ""),
    );
    if (!targetPath) {
      return false;
    }
    const matches = blocks.get(recoveryIdentity(targetPath, item.blockId)) || [];
    return matches.some(
      (task) =>
        task.statusRecognized && TASK_STATUS_OPEN_TYPES.has(task.statusType),
    );
  };

  const scheduledOverrideByPath =
    args.scheduledOverrideByPath instanceof Map
      ? args.scheduledOverrideByPath
      : null;
  for (const file of markdownFiles) {
    const path = normalizeVaultRelativePath(file.path);
    const extra = {};
    if (scheduledOverrideByPath && scheduledOverrideByPath.has(path)) {
      extra.scheduledValue = scheduledOverrideByPath.get(path);
    }
    const state = getProjectBlockState(
      file.content,
      path,
      today,
      (_targetPath, _blockId, item) => lookupOpen(path, item),
      extra,
    );
    if (!state.isProject || state.reasons.length === 0) {
      continue;
    }
    const reason = formatProjectRecoveryReason(state.reasons);
    const mark = (line) => {
      if (line >= 0) {
        projectBlocked.set(recoveryIdentity(path, String(line)), reason);
      }
    };
    mark(state.prjLine);
    const prjEdges = edges.get(recoveryIdentity(path, "prj"));
    for (const resident of state.residents) {
      mark(resident.line);
      if (!resident.blockId) {
        continue;
      }
      const source = recoveryIdentity(path, resident.blockId);
      if (prjEdges && prjEdges.size > 0) {
        if (!edges.has(source)) {
          edges.set(source, new Set());
        }
        for (const target of prjEdges) {
          edges.get(source).add(target);
        }
        continue;
      }
      for (const item of state.openItems) {
        const targetPath = resolveScheduledRecoveryNote(
          noteIndex,
          path,
          String(item.path || "").replace(/\.md$/i, ""),
        );
        const target = targetPath
          ? recoveryIdentity(targetPath, item.blockId)
          : null;
        if (!target || !blocks.has(target)) {
          continue;
        }
        if (!edges.has(source)) {
          edges.set(source, new Set());
        }
        edges.get(source).add(target);
      }
    }
  }
  return projectBlocked;
}
