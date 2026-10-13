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
