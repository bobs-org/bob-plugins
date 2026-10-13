// Helpers for the project-blocked resident tag and its recovery write.
// The tag is the immediate project-blocked signal; reconcile remains the
// authority that adds or removes it from resident tasks.
const PROJECT_BLOCKED_RESIDENT_TAG_RE =
  /(^|[\s([{])#prj_is_blocked(?=$|[\s)\]},.;:!?])/;

function hasProjectBlockedResidentTag(lineText) {
  return PROJECT_BLOCKED_RESIDENT_TAG_RE.test(String(lineText || ""));
}

function stripProjectBlockedResidentTag(lineText) {
  return String(lineText || "")
    .replace(
      /(^|[ \t]+)#prj_is_blocked(?=$|[\s)\]},.;:!?])/g,
      "",
    );
}

function projectRecoveryTaskIsToday(plugin, task) {
  try {
    const plugins = plugin && plugin.app && plugin.app.plugins;
    const ledger = plugins && plugins.plugins && plugins.plugins["bob-ledger-tools"];
    const isToday = ledger && ledger.api && ledger.api.isToday;
    return typeof isToday === "function" ? Boolean(isToday(task)) : false;
  } catch (error) {
    return false;
  }
}

function rewriteRecoveredTaskLine(lineText, statusSymbol, options = {}) {
  const source = String(lineText || "");
  const current = getTaskStatusForLine(source);
  if (!current) {
    return null;
  }
  let next = `${source.slice(0, current.statusStart)}${statusSymbol}${source.slice(current.statusStart + 1)}`;
  if (current.symbol === "?" && statusSymbol === " " &&
      typeof options.markUnblockedLine === "function") {
    const marked = options.markUnblockedLine(next, {
      today: options.today || formatLocalDate(),
      isDailyNote: Boolean(options.isDailyNote),
      isToday: typeof options.isToday === "function"
        ? Boolean(options.isToday(options.task || current))
        : Boolean(options.isToday),
    });
    if (typeof marked !== "string") {
      return null;
    }
    next = marked;
  }
  return stripProjectBlockedResidentTag(next);
}

function successorReadyRecoveryEdits(plan) {
  return (Array.isArray(plan && plan.edits) ? plan.edits : []).filter((edit) => {
    if (typeof edit.before !== "string" || typeof edit.after !== "string") {
      return false;
    }
    const before = getTaskStatusForLine(edit.before);
    const after = getTaskStatusForLine(edit.after);
    return before && after && before.symbol === "?" && after.symbol === " ";
  });
}

const PROJECT_RECOVERY_MISSING_UNBLOCKED_WARNING =
  "Task Status Cycler: recovering blocked tasks without [unblocked::]; update bob-ledger-tools to freshness v12 to record review ticklers.";

function warnProjectRecoveryWithoutUnblocked() {
  console.warn(PROJECT_RECOVERY_MISSING_UNBLOCKED_WARNING);
}

// Only an id that resolves to an open task is a remaining reason
// (DC7: a missing id never blocks). Callers resolve cross-note ids
// against the vault and pass them as `openIds` before planning.
function asProjectRecoveryIdSet(value) {
  if (!value) {
    return new Set();
  }
  if (value instanceof Set) {
    return value;
  }
  return new Set(Array.from(value, String));
}

function dependencyIdIsOpen(id, tasks, openIds) {
  const key = String(id);
  const local = (Array.isArray(tasks) ? tasks : []).find(
    (candidate) => candidate && candidate.taskId === key,
  );
  if (local) {
    return DEPENDENCY_OPEN_TASK_SYMBOLS.has(local.status);
  }
  return openIds.has(key);
}

function projectHasRemainingBlockingReason(project, today, openIds) {
  if (project && prjInheritsBlock(project.projectTask.lineText)) {
    return true;
  }
  if (projectHasFutureSchedule(project, today)) {
    return true;
  }
  if (!project || project.dependencyIds.length === 0) {
    return false;
  }
  const resolvedOpen = asProjectRecoveryIdSet(openIds);
  return project.dependencyIds.some((id) =>
    dependencyIdIsOpen(id, project.tasks, resolvedOpen)
  );
}

function projectResidentRecoveryTasks(sourceText, path, project) {
  if (project) {
    return project.tasks;
  }
  return parseTaskDependencyDocument(sourceText, path).filter(
    (task) => !/^\s*>/.test(task.lineText),
  );
}

function planProjectResidentRecoveryEdits(sourceText, path, options = {}) {
  const today = options.today || formatLocalDate();
  const openIds = asProjectRecoveryIdSet(options.openIds);
  const project = projectDependencyInfo(sourceText, path);
  if (project && prjInheritsBlock(project.projectTask.lineText)) {
    return [];
  }
  // No open `^prj` means the note is not project(T) and has no project
  // reason: recover tagged open residents the same way as an unblocked
  // `^prj` (Alt+[ to Cancelled, or any cycle out of Blocked).
  if (project && projectHasRemainingBlockingReason(project, today, openIds)) {
    return [];
  }
  const tasks = projectResidentRecoveryTasks(sourceText, path, project);
  const edits = [];
  for (const task of tasks) {
    if (
      task.blockId === "prj" ||
      !DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) ||
      !hasProjectBlockedResidentTag(task.lineText)
    ) {
      continue;
    }
    const hasOwnReason = task.dependsOn.some((id) =>
      dependencyIdIsOpen(id, tasks, openIds)
    ) || !!findSingleFutureScheduledField(task.lineText, today);
    const recover = task.status === "?" && !hasOwnReason;
    const after = rewriteRecoveredTaskLine(
      task.lineText,
      recover ? " " : task.status,
      { ...options, today, task, isDailyNote: isDailyNotePath(path) },
    );
    if (typeof after === "string" && after !== task.lineText) {
      edits.push({
        path,
        line: task.line,
        before: task.lineText,
        after,
      });
    }
  }
  return edits;
}

async function resolveProjectRecoveryOpenIds(plugin, tasks, context) {
  const openIds = new Set();
  const localIds = new Set();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || !task.taskId) {
      continue;
    }
    const id = String(task.taskId);
    localIds.add(id);
    if (DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status)) {
      openIds.add(id);
    }
  }
  const wanted = new Set();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    for (const id of task && Array.isArray(task.dependsOn) ? task.dependsOn : []) {
      const key = String(id);
      if (!localIds.has(key)) {
        wanted.add(key);
      }
    }
  }
  if (wanted.size === 0 || !plugin) {
    return openIds;
  }
  try {
    const cacheRead = typeof plugin.readSuccessorTasksCache === "function"
      ? plugin.readSuccessorTasksCache()
      : null;
    if (cacheRead && cacheRead.ready && Array.isArray(cacheRead.tasks)) {
      for (const task of cacheRead.tasks) {
        if (
          task &&
          task.taskId &&
          wanted.has(String(task.taskId)) &&
          DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status)
        ) {
          openIds.add(String(task.taskId));
        }
      }
      return openIds;
    }
  } catch (_error) {
    // Fall through to the vault scan.
  }
  const vault = plugin.app && plugin.app.vault;
  const files = vault && typeof vault.getMarkdownFiles === "function"
    ? vault.getMarkdownFiles()
    : [];
  const cache = new Map();
  const localPath = context && context.activePath;
  for (const file of files) {
    if (wanted.size === 0) {
      break;
    }
    const path = file && file.path;
    if (!path || path === localPath) {
      continue;
    }
    let text = null;
    try {
      text = typeof plugin.readSuccessorNoteText === "function"
        ? await plugin.readSuccessorNoteText(path, context || {}, cache)
        : null;
    } catch (_error) {
      text = null;
    }
    if (typeof text !== "string") {
      continue;
    }
    for (const task of parseTaskDependencyDocument(text, path)) {
      if (!task.taskId || !wanted.has(String(task.taskId))) {
        continue;
      }
      wanted.delete(String(task.taskId));
      if (DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status)) {
        openIds.add(String(task.taskId));
      }
    }
  }
  return openIds;
}

async function applyProjectResidentRecovery(plugin, sourceText, path, context) {
  const today = plugin && typeof plugin.getScheduleLogDateString === "function"
    ? plugin.getScheduleLogDateString()
    : formatLocalDate();
  const project = projectDependencyInfo(sourceText, path);
  if (project && prjInheritsBlock(project.projectTask.lineText)) {
    return;
  }
  const tasks = projectResidentRecoveryTasks(sourceText, path, project);
  const openIds = await resolveProjectRecoveryOpenIds(plugin, tasks, context);
  const markUnblockedLine = plugin &&
    typeof plugin.getFreshnessMarkUnblockedLine === "function"
    ? plugin.getFreshnessMarkUnblockedLine()
    : null;
  const edits = planProjectResidentRecoveryEdits(sourceText, path, {
    today,
    markUnblockedLine,
    openIds,
    isToday: (task) => projectRecoveryTaskIsToday(plugin, task),
  });
  if (edits.length === 0) {
    return;
  }
  const plan = {
    edits,
    unblocked: successorReadyRecoveryEdits({ edits }).map((edit) => ({
      note_path: edit.path,
      line: edit.line,
      link: null,
      not_linked: "project_member",
    })),
    placements: [],
  };
  await applySuccessorNoteEditsWithUnblockedGuard(plugin, plan, context);
}

async function applySuccessorNoteEditsWithUnblockedGuard(plugin, plan, context) {
  const required = successorReadyRecoveryEdits(plan);
  const markUnblockedLine = plugin &&
    typeof plugin.getFreshnessMarkUnblockedLine === "function"
    ? plugin.getFreshnessMarkUnblockedLine()
    : null;
  if (required.length > 0 && typeof markUnblockedLine !== "function") {
    warnProjectRecoveryWithoutUnblocked();
  }
  return plugin.applySuccessorNoteEdits(plan, context);
}

// Project pull-in recognition + recovery wiring (P3/P5): kept in 088 so 089 stays ≤1000 lines.
function project089TrimScalar(value) {
  let text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
      (text.startsWith("'") && text.endsWith("'") && text.length >= 2)) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function project089TypeIsProject(sourceText) {
  const lines = String(sourceText || "").split(/\r?\n/);
  if (lines.length === 0 || !/^\s*---\s*$/.test(lines[0])) {
    return false;
  }
  let inFrontmatter = true;
  let inTypeList = false;
  for (let line = 1; line < lines.length; line += 1) {
    const text = lines[line];
    if (/^\s*---\s*$/.test(text)) {
      break;
    }
    if (!inTypeList) {
      const match = text.match(/^type\s*:\s*(.*?)\s*$/);
      if (!match) {
        continue;
      }
      const rest = match[1];
      if (!rest) {
        inTypeList = true;
        continue;
      }
      const trimmed = rest.trim();
      if (trimmed.startsWith("[")) {
        const inner = trimmed.replace(/^\[/, "").replace(/\]$/, "");
        for (const item of inner.split(",")) {
          const clean = project089TrimScalar(item).replace(/^\[+|\]+$/g, "").replace(/^["']+|["']+$/g, "").trim();
          if (clean === "[[project]]" || clean === "project") {
            return true;
          }
        }
        return false;
      }
      if (project089TrimScalar(trimmed) === "[[project]]") {
        return true;
      }
      return false;
    }
    if (!text.trim()) {
      continue;
    }
    const item = text.trimStart().match(/^-\s*(.*?)\s*$/);
    if (!item) {
      break;
    }
    const clean = project089TrimScalar(item[1]).replace(/^\[+|\]+$/g, "").replace(/^["']+|["']+$/g, "").trim();
    if (clean === "[[project]]" || clean === "project") {
      return true;
    }
  }
  return false;
}

function project089StatusIsTerminal(sourceText) {
  const value = parseFrontmatterScalar(sourceText, "status");
  if (value == null) {
    return false;
  }
  const normalized = project089TrimScalar(value).toLowerCase();
  if (normalized === "" || normalized === "wip") {
    return false;
  }
  return normalized === "done" || normalized === "canceled" || normalized === "cancelled";
}

function project089IsValidPrjLine(lineText) {
  if (!lineHasTrailingPrjAnchor(lineText)) {
    return false;
  }
  const offset = projectTaskTextOffset(lineText);
  return projectWholeTagSpans(String(lineText).slice(offset), "#task").length > 0;
}

function project089Info(sourceText, path) {
  const notePath = String(path || "");
  const tasks = parseTaskDependencyDocument(sourceText, notePath).filter(
    (task) => !/^\s*>/.test(task.lineText),
  );
  const prjTasks = tasks.filter(
    (task) => task.blockId === "prj" && DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) && project089IsValidPrjLine(task.lineText),
  );
  if (prjTasks.length !== 1) {
    return null;
  }
  const scheduledFields = findScheduledFieldMatches(prjTasks[0].lineText);
  const scheduledField = scheduledFields.find((field) =>
    parseStrictCalendarDate(field.value)
  );
  const scheduledDate = scheduledField &&
    parseStrictCalendarDate(scheduledField.value);
  return {
    path: notePath,
    tasks,
    projectTask: prjTasks[0],
    dependencyIds: prjTasks[0].dependsOn.slice(),
    scheduled: scheduledDate ? formatCalendarDate(scheduledDate) : null,
  };
}

// Shared project-recovery wiring for pull-in cascades (§12.10 + §12.2): the
// same path for the `[id::]` branch and the id-less branch (P3), so a `[?]`
// R pull-in recovers N's residents even when A has no `[id::]`.
function projectPullInRecoveryWiring(noteTexts, index, pullIns, today, closedTaskIds) {
  const byTaskId = index && index.byTaskId instanceof Map ? index.byTaskId : new Map();
  const openIdsAfter = new Set();
  for (const [id, task] of byTaskId) {
    if (task && DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) && !closedTaskIds.has(String(id))) {
      openIdsAfter.add(String(id));
    }
  }
  const state = projectSuccessorRecoveryState(noteTexts, closedTaskIds, openIdsAfter, today);
  const projectInfoByPath = state.projectInfoByPath;
  const projectRecoveryPaths = state.projectRecoveryPaths;
  for (const path of pullIns.cascadePaths) {
    projectRecoveryPaths.add(path);
    if (!projectInfoByPath.has(path)) {
      const info = project089Info(noteTexts[path] || "", path);
      if (info) {
        projectInfoByPath.set(path, info);
      }
    }
  }
  const projectTagStripEdits = projectSuccessorTagStripEdits(projectInfoByPath, projectRecoveryPaths, openIdsAfter, today);
  return { projectInfoByPath, projectRecoveryPaths, projectTagStripEdits, openIdsAfter };
}

function projectPullInRecoveryMembersForIdless(noteTexts, index, pullIns, today) {
  const closedTaskIds = new Set();
  const wiring = projectPullInRecoveryWiring(noteTexts, index, pullIns, today, closedTaskIds);
  const members = projectSuccessorRecoveryMembers(wiring.projectInfoByPath, wiring.projectRecoveryPaths);
  const recovers = [];
  for (const task of members) {
    const open = Array.isArray(task.dependsOn) && task.dependsOn.some((id) => wiring.openIdsAfter.has(String(id)));
    if (open) {
      continue;
    }
    if (task.rawLine && findSingleFutureScheduledField(task.rawLine, today)) {
      continue;
    }
    const project = wiring.projectInfoByPath.get(task.path);
    const preds = project ? (project.dependencyIds || []) : [];
    recovers.push({
      task,
      reason: "project_member",
      predecessorRows: [],
    });
  }
  return { recovers, projectTagStripEdits: wiring.projectTagStripEdits };
}
