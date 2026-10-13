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

// Cross-note ids that this note cannot prove closed still count as a
// remaining project reason, so Alt+] on a date-only `^prj` recovers
// residents while a still-open Depends-On target does not.
function projectHasRemainingBlockingReason(project, today) {
  if (projectHasFutureSchedule(project, today)) {
    return true;
  }
  if (!project || project.dependencyIds.length === 0) {
    return false;
  }
  const closedIds = new Set();
  for (const task of project.tasks) {
    if (task.taskId && !DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status)) {
      closedIds.add(String(task.taskId));
    }
  }
  return project.dependencyIds.some((id) => !closedIds.has(String(id)));
}

function planProjectResidentRecoveryEdits(sourceText, path, options = {}) {
  const today = options.today || formatLocalDate();
  const project = projectDependencyInfo(sourceText, path);
  if (!project || projectHasRemainingBlockingReason(project, today)) {
    return [];
  }
  const edits = [];
  for (const task of project.tasks) {
    if (
      task.blockId === "prj" ||
      !DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status) ||
      !hasProjectBlockedResidentTag(task.lineText)
    ) {
      continue;
    }
    const hasOwnReason = task.dependsOn.some((id) => {
      const dependency = project.tasks.find((candidate) =>
        candidate.taskId === String(id)
      );
      return !dependency || DEPENDENCY_OPEN_TASK_SYMBOLS.has(dependency.status);
    }) || !!findSingleFutureScheduledField(task.lineText, today);
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
