// Leaf-project keep-moving offers (docs/task-dependencies.md §12.15–§12.17).
// Metadata resolution stays separate from the pure K1–K8 planner.

const SUCCESSOR_KEEP_MOVING_MAX_DEPTH = 16;
const SUCCESSOR_KEEP_MOVING_LANES = { "/": 0, "*": 1, " ": 2 };

function successorKeepMovingCollectStrings(value, into) {
  if (typeof value === "string") {
    into.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) successorKeepMovingCollectStrings(item, into);
  }
}

function successorKeepMovingType(frontmatter) {
  const values = [];
  successorKeepMovingCollectStrings(frontmatter && frontmatter.type, values);
  const types = values.map((value) => {
    const link = value.match(/^\[\[([^\]]+)\]\]$/);
    const inner = (link ? link[1] : value).split("|")[0].split("#")[0].trim();
    return inner.replace(/^\[+|\]+$/g, "").toLowerCase();
  });
  return types.includes("area") ? "area" : types.includes("project") ? "project" : "other";
}

function successorKeepMovingRootFlag(frontmatter) {
  const value = frontmatter && frontmatter.root;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function successorKeepMovingParentTarget(frontmatter) {
  const value = frontmatter && frontmatter.parent;
  let raw = "";
  if (typeof value === "string") {
    raw = value.trim();
  } else if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0]) &&
      value[0].length === 1 && typeof value[0][0] === "string") {
    raw = value[0][0].trim();
  }
  const match = raw.match(/^\[\[([^\]]+)\]\]$/);
  if (!match) return "";
  return String(match[1]).split("|")[0].split("#")[0].trim();
}

function successorKeepMovingMetadataCache(app, path) {
  try {
    const cache = app && app.metadataCache;
    if (!cache) return null;
    if (typeof cache.getCache === "function") return cache.getCache(path);
    const file = app.vault && app.vault.getAbstractFileByPath(path);
    return file && typeof cache.getFileCache === "function" ? cache.getFileCache(file) : null;
  } catch (_error) {
    return null;
  }
}

function successorKeepMovingResolveParent(app, target, sourcePath) {
  try {
    const vault = app && app.vault;
    const cache = app && app.metadataCache;
    if (!vault || !cache || typeof cache.getFirstLinkpathDest !== "function") return null;
    const clean = String(target || "").trim().replace(/\\/g, "/");
    if (!clean || clean.split("/").some((part) => part === "." || part === "..")) return null;
    if (!clean.includes("/") && typeof vault.getMarkdownFiles === "function") {
      const stem = clean.split("/").pop().replace(/\.md$/i, "").toLowerCase();
      const matches = vault.getMarkdownFiles().filter((file) =>
        String(file && file.path || "").split("/").pop().replace(/\.md$/i, "").toLowerCase() === stem,
      );
      if (matches.length > 1) return null;
    }
    const file = cache.getFirstLinkpathDest(clean, sourcePath);
    return file && typeof file.path === "string" ? file.path : null;
  } catch (_error) {
    return null;
  }
}

// Port of the R2 root-parent test. Ambiguous, missing, or unreadable parents
// stop the walk; a bounded cycle matches the resolver's non-self root.
function successorLeafProject(app, path) {
  try {
    const start = String(path || "");
    const initial = successorKeepMovingMetadataCache(app, start);
    if (!start || !initial || successorKeepMovingType(initial.frontmatter) !== "project" ||
        successorKeepMovingRootFlag(initial.frontmatter)) return false;
    const seen = new Set([start]);
    let current = start;
    for (let depth = 1; depth < SUCCESSOR_KEEP_MOVING_MAX_DEPTH; depth += 1) {
      const currentCache = successorKeepMovingMetadataCache(app, current);
      const target = successorKeepMovingParentTarget(currentCache && currentCache.frontmatter);
      if (!target) return false;
      const parent = successorKeepMovingResolveParent(app, target, current);
      if (!parent) return false;
      if (seen.has(parent)) return true;
      const parentCache = successorKeepMovingMetadataCache(app, parent);
      if (!parentCache) return false;
      const type = successorKeepMovingType(parentCache.frontmatter);
      if (type === "area") return false;
      if (type === "project") return true;
      seen.add(parent);
      current = parent;
    }
    return false;
  } catch (_error) {
    return false;
  }
}

function successorKeepMovingLaneName(status) {
  return status === "/" ? "Pending" : status === "*" ? "Next" : status === " " ? "Ready" : "";
}

function successorKeepMovingIsCandidateStatus(status) {
  return Object.prototype.hasOwnProperty.call(SUCCESSOR_KEEP_MOVING_LANES, String(status));
}

function successorKeepMovingIsReferenceLine(lineText) {
  return /(^|[^A-Za-z0-9_\/#-])#ref(?=$|[^A-Za-z0-9_-])/.test(String(lineText || ""));
}

function successorKeepMovingReferenceTasks(noteText, path) {
  const lines = String(noteText || "").split(/\r?\n/);
  const fenced = getFencedLineNumbers(lines);
  const tasks = [];
  for (let line = 0; line < lines.length; line += 1) {
    const lineText = lines[line];
    if (fenced.has(line) || !successorKeepMovingIsReferenceLine(lineText) ||
        lineMatchesTasksGlobalFilterText(lineText)) continue;
    const status = getTaskStatusForLine(lineText, line);
    if (!status) continue;
    const metadata = parseTaskDependencyMetadata(lineText);
    tasks.push({
      path: String(path || ""), line, status: status.symbol,
      blockId: getTrailingBlockId(lineText), taskId: metadata.taskId,
      dependsOn: metadata.dependsOn, text: lineText, rawLine: lineText,
      lineText, globalFilter: "#ref", reference: true,
      scheduled: (findScheduledFieldMatches(lineText)[0] || {}).value || null,
    });
  }
  return tasks;
}

function successorKeepMovingResidents(project, noteText, path) {
  const tasks = Array.isArray(project && project.tasks) ? [...project.tasks] : [];
  const lines = new Set(tasks.map((task) => Number(task && task.line)));
  for (const task of successorKeepMovingReferenceTasks(noteText, path || project && project.path)) {
    if (!lines.has(Number(task.line))) tasks.push(task);
  }
  return tasks.sort((left, right) => Number(left.line) - Number(right.line));
}

function successorKeepMovingIsClosed(task, closed, skipKeys) {
  if (!task) return false;
  if (task.blockId && skipKeys.has(`${task.path}\0^${task.blockId}`)) return true;
  if (task.taskId && skipKeys.has(`${task.path}\0id:${task.taskId}`)) return true;
  return (Array.isArray(closed) ? closed : []).some((identity) =>
    identity && String(identity.path || "") === String(task.path || "") &&
    ((identity.blockId && task.blockId && String(identity.blockId) === String(task.blockId)) ||
      (identity.taskId && task.taskId && String(identity.taskId) === String(task.taskId))),
  );
}

// G1/G2: inspect only held text. This intentionally does not resolve parents,
// read today's ledger, or ask for a dependency pool.
function successorKeepMovingPotentialProjects(closed, noteTexts, today) {
  const paths = new Set();
  const skipKeys = projectClosedSkipKeys(closed);
  for (const identity of Array.isArray(closed) ? closed : []) {
    if (!identity || !identity.path || !identity.blockId || successorIsProjectTask(identity.blockId)) continue;
    const path = String(identity.path);
    const text = projectNoteTextFor(noteTexts, path);
    if (!text || !project089TypeIsProject(text) || project089StatusIsTerminal(text)) continue;
    const surface = projectSurfaceState(text, path, today, { skipKeys });
    if (!surface) continue;
    const candidate = successorKeepMovingResidents(surface.project, text, path).some((task) => {
      if (!task || !successorKeepMovingIsCandidateStatus(task.status) ||
          successorIsProjectTask(task.blockId) || successorKeepMovingIsClosed(task, closed, skipKeys)) return false;
      const raw = task.lineText || task.rawLine || "";
      return !successorHasHideTag(raw) && !findSingleFutureScheduledField(raw, today);
    });
    if (candidate) paths.add(path);
  }
  return [...paths];
}

function successorKeepMovingNeedsDependents(paths, closed, noteTexts, today) {
  const skipKeys = projectClosedSkipKeys(closed);
  for (const pathValue of Array.isArray(paths) ? paths : []) {
    const path = String(pathValue || "");
    const surface = projectSurfaceState(projectNoteTextFor(noteTexts, path), path, today, { skipKeys });
    if (!surface) continue;
    if (Array.isArray(surface.project.dependencyIds) && surface.project.dependencyIds.length) return true;
    for (const task of successorKeepMovingResidents(surface.project, projectNoteTextFor(noteTexts, path), path)) {
      if (!task || !successorKeepMovingIsCandidateStatus(task.status) ||
          successorIsProjectTask(task.blockId) || successorKeepMovingIsClosed({ ...task, path }, closed, skipKeys)) continue;
      const raw = task.lineText || task.rawLine || "";
      if (successorHasHideTag(raw) || findSingleFutureScheduledField(raw, today)) continue;
      if (Array.isArray(task.dependsOn) && task.dependsOn.length) return true;
    }
  }
  return false;
}

function successorKeepMovingOpenIds(index, closed) {
  const result = new Set();
  const byTaskId = index && index.byTaskId instanceof Map ? index.byTaskId : new Map();
  const closedIds = new Set((closed || []).map((item) => String(item && item.taskId || "")).filter(Boolean));
  for (const [id, task] of byTaskId) {
    if (task && DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) && !closedIds.has(String(id))) result.add(String(id));
  }
  return result;
}

function successorKeepMovingDependencyBlocked(task, openIds, snapshotAvailable, closedIds) {
  const dependencies = Array.isArray(task && task.dependsOn) ? task.dependsOn.map(String).filter(Boolean) : [];
  if (!dependencies.length) return false;
  if (!snapshotAvailable) return true;
  return dependencies.some((id) => openIds.has(id) && !closedIds.has(id));
}

function successorKeepMovingGroupPath(mark) {
  return String(mark && (mark.project || (mark.task && mark.task.path)) || "");
}

// Pure K1–K8 planner. `leafProject` is injected so fixtures and wiring share
// the same rule without coupling planning to Obsidian metadata reads.
function planSuccessorKeepMoving(options = {}) {
  const empty = { marks: [], foldedByProject: new Map() };
  if (options.enabled !== true || options.cancelled === true || options.linkUnblocked === false) return empty;
  const closed = Array.isArray(options.closed) ? options.closed : [];
  const noteTexts = options.noteTexts || {};
  const today = options.today || formatLocalDate();
  const paths = Array.isArray(options.candidatePaths) ? options.candidatePaths :
    successorKeepMovingPotentialProjects(closed, noteTexts, today);
  if (!paths.length) return empty;
  const baseline = successorNormalizeLines(options.baseline ?? options.dailyBefore ?? []);
  const liveEntries = parseSuccessorLedgerEntries(baseline);
  const liveLinks = liveEntries.flatMap((entry) => entry.links);
  const currentEntries = parseSuccessorLedgerEntries(successorNormalizeLines(options.currentDay ?? options.dailyAfter ?? baseline));
  const currentLinks = currentEntries.flatMap((entry) => entry.links);
  const skipKeys = projectClosedSkipKeys(closed);
  const closedIds = new Set(closed.map((item) => String(item && item.taskId || "")).filter(Boolean));
  const openIds = successorKeepMovingOpenIds(options.index, closed);
  const snapshotAvailable = options.dependencySnapshotAvailable !== false;
  const existingMarks = Array.isArray(options.existingMarks) ? options.existingMarks : [];
  const anchorHints = options.anchorHints instanceof Map
    ? options.anchorHints
    : new Map(Object.entries(options.anchorHints || {}));
  const anchors = computeSuccessorAnchors(closed, options.dailyBefore ?? baseline, {
    closingEntry: options.closingEntry,
    dailyPath: options.dailyPath,
  });
  const anchorFor = (identity) => {
    const i = closed.indexOf(identity);
    return i < 0 ? { kind: "none", entryLine: null, bulletLine: null } : anchors[i];
  };
  const marks = [];
  const foldedByProject = new Map();
  for (const pathValue of paths) {
    const path = String(pathValue || "");
    const text = projectNoteTextFor(noteTexts, path);
    const surface = projectSurfaceState(text, path, today, { skipKeys, notePaths: options.notePaths });
    if (!surface || typeof options.leafProject !== "function" || options.leafProject(path) !== true) continue;
    const project = surface.project;
    const root = project.projectTask;
    if (!root || root.status === "?" ||
        prjInheritsBlock(root.lineText) || projectScheduledIsFuture(surface.scheduled, today)) continue;
    if (closed.some((identity) => identity && String(identity.path || "") === path &&
        successorIsProjectTask(identity.blockId))) continue;
    const rootDeps = Array.isArray(project.dependencyIds) ? project.dependencyIds : [];
    if (!snapshotAvailable && rootDeps.some((id) => {
      if (closedIds.has(String(id))) return false;
      const local = project.tasks.find((task) => String(task.taskId || "") === String(id));
      return !local || DEPENDENCY_OPEN_TASK_SYMBOLS.has(local.status);
    })) continue;
    if (projectIsBlockedAfter(project, openIds, today, closedIds)) continue;
    if (projectIsBlockedAfter({ ...project, scheduled: surface.scheduled }, openIds, today, closedIds)) continue;
    const existingProjectGroup = existingMarks.some((mark) =>
      (mark.group === "project" || mark.group === "project_finished") &&
      successorKeepMovingGroupPath(mark) === path,
    );
    if (existingProjectGroup || surface.empty) continue;
    const predecessors = closed.filter((identity) =>
      identity && String(identity.path || "") === path && identity.blockId &&
      !successorIsProjectTask(identity.blockId) && liveLinks.some((link) =>
        successorLinkMatchesIdentity(link, identity, options.dailyPath),
      ),
    );
    if (!predecessors.length) continue;
    const residents = successorKeepMovingResidents(project, text, path);
    const openResidentOutsideClose = residents.some((task) =>
      task && DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) &&
      !successorKeepMovingIsClosed({ ...task, path }, closed, skipKeys) &&
      liveLinks.some((link) => successorLinkMatchesIdentity(link, { path, blockId: task.blockId }, options.dailyPath)),
    );
    if (openResidentOutsideClose) continue;
    const anchored = predecessors.map((identity) => ({ identity, anchor: anchorFor(identity) }))
      .filter((item) => item.anchor && item.anchor.kind !== "none")
      .sort((left, right) => successorAnchorPosition(left.anchor) - successorAnchorPosition(right.anchor) ||
        (left.anchor.bulletLine ?? -1) - (right.anchor.bulletLine ?? -1));
    const hint = anchorHints.get(path);
    if (hint && hint.kind === "closing" && Number.isInteger(options.closingEntry)) {
      anchored.unshift({ identity: predecessors[0], anchor: { kind: "closing", entryLine: options.closingEntry, bulletLine: null } });
    }
    if (!anchored.length) continue;
    const predecessorRows = predecessors.map((identity) => ({
      note_path: String(identity.path || ""),
      block_id: String(identity.blockId || ""),
      text: String(identity.text || ""),
    }));
    const dedup = new Set(existingMarks.filter((mark) => mark && mark.group === "hand_off")
      .map((mark) => `${mark.task && mark.task.path}\0${mark.task && mark.task.line}`));
    const folded = { blocked: 0, scheduled: 0, hidden: 0 };
    const selectable = [];
    for (const sourceTask of residents) {
      if (!sourceTask || successorIsProjectTask(sourceTask.blockId) ||
          !DEPENDENCY_OPEN_TASK_SYMBOLS.has(sourceTask.status) ||
          successorKeepMovingIsClosed({ ...sourceTask, path }, closed, skipKeys)) continue;
      const task = { ...sourceTask, path, rawLine: sourceTask.lineText || sourceTask.rawLine || "" };
      const key = `${path}\0${task.line}`;
      if (!["?", " ", "*", "/"].includes(task.status)) continue;
      const blocked = task.status === "?" || hasProjectBlockedResidentTag(task.rawLine) ||
        successorKeepMovingDependencyBlocked(task, openIds, snapshotAvailable, closedIds);
      const scheduled = !blocked && !!findSingleFutureScheduledField(task.rawLine, today);
      const hidden = !blocked && !scheduled && successorHasHideTag(task.rawLine);
      if (blocked) { folded.blocked += 1; continue; }
      if (scheduled) { folded.scheduled += 1; continue; }
      if (hidden) { folded.hidden += 1; continue; }
      const linkedNow = currentLinks.some((link) =>
        successorLinkMatchesIdentity(link, { path, blockId: task.blockId }, options.dailyPath),
      );
      if (!dedup.has(key) && !linkedNow && successorKeepMovingIsCandidateStatus(task.status)) selectable.push(task);
    }
    if (!selectable.length) continue;
    foldedByProject.set(path, folded);
    for (const task of selectable) {
      marks.push({
        task,
        anchor: anchored[0].anchor,
        predecessorRows,
        notePath: path,
        line: task.line,
        group: "keep_moving",
        project: path,
        trigger: "last_planned",
      });
    }
  }
  return { marks, foldedByProject };
}

function successorPlanRows(plan) {
  if (plan && Array.isArray(plan.rows)) return plan.rows;
  if (plan && Array.isArray(plan.keep_moving)) return [...(plan.unblocked || []), ...plan.keep_moving];
  return plan && Array.isArray(plan.unblocked) ? plan.unblocked : [];
}

function successorKeepMovingNoticeText(model, baseNotice) {
  const source = model && typeof model === "object" ? model : {};
  const rows = Array.isArray(source.keep_moving) ? source.keep_moving : [];
  if (!rows.length) return typeof baseNotice === "function" ? baseNotice(source) : "";
  const normal = Array.isArray(source.unblocked) ? source.unblocked : [];
  const picked = rows.filter((row) => row && row.link && !row.not_linked);
  if (source.failure && Number(source.failure.count) > 0) {
    return baseNotice({ ...source, keep_moving: [], unblocked: [...normal, ...rows] });
  }
  if (normal.length) {
    return baseNotice({ ...source, keep_moving: [], unblocked: [...normal, ...picked] });
  }
  if (!picked.length) {
    return "";
  }
  const stems = [...new Set(picked.map((row) =>
    String(row.offer && row.offer.project || row.note_path || "").split("/").pop().replace(/\.md$/i, ""),
  ).filter(Boolean))];
  const suffix = stems.length === 1 ? `keeps ‹${stems[0]}› moving` : `keeps ${stems.length || 1} projects moving`;
  if (picked.length === 1) {
    const row = picked[0];
    const text = truncateSuccessorNoticeText(row.text);
    const link = row.link || {};
    const name = link.entry_name || "";
    const where = link.entry_created
      ? `Next in new ${name || "session"} session (next up): `
      : name ? `Next in ${name}: ` : `Next at line ${link.line || "?"}: `;
    const theme = typeof formatSuccessorThemeRowChip === "function" ? formatSuccessorThemeRowChip(row) : "";
    return `⏭ ${where}${text}${theme} · ${suffix}`;
  }
  const names = [...new Set(picked.map((row) => row.link && row.link.entry_name || "").filter(Boolean))];
  const destination = names.length === 1 ? `→ ${names[0]}` : names.length ? `· ${names.join(", ")}` : "";
  const themeCount = picked.filter((row) => row.theme_changed === true).length;
  const theme = themeCount ? ` · ${themeCount} task type${themeCount === 1 ? "" : "s"} saved` : "";
  return `⏭ ${picked.length} linked ${destination} · ${suffix}${theme}`;
}
