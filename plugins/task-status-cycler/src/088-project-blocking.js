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

async function applySuccessorNoteEditsWithUnblockedGuard(plugin, plan, context) {
  const required = successorReadyRecoveryEdits(plan);
  const markUnblockedLine = plugin &&
    typeof plugin.getFreshnessMarkUnblockedLine === "function"
    ? plugin.getFreshnessMarkUnblockedLine()
    : null;
  if (required.length === 0 || typeof markUnblockedLine === "function") {
    return plugin.applySuccessorNoteEdits(plan, context);
  }

  const failedLocations = new Set(required.map((edit) =>
    `${edit.path}\0${edit.line}`
  ));
  const failedRows = new Set();
  for (let index = 0; index < plan.unblocked.length; index += 1) {
    const row = plan.unblocked[index];
    if (
      row && failedLocations.has(`${row.note_path}\0${row.line}`)
    ) {
      row.link = null;
      row.not_linked = "failed";
      failedRows.add(index);
    }
  }
  plan.edits = plan.edits.filter((edit) =>
    !failedLocations.has(`${edit.path}\0${edit.line}`)
  );
  plan.placements = plan.placements.filter((placement) =>
    !failedRows.has(placement && placement.rowIndex)
  );
  const outcome = await plugin.applySuccessorNoteEdits(plan, context);
  outcome.failed += Math.max(required.length, failedRows.size);
  outcome.failureReason = outcome.failureReason ||
    "bob-ledger-tools freshness namespace v12 is required for recovery";
  return outcome;
}
