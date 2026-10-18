// Task Card Blocks… availability and its warm Tasks-cache summary.

const TASK_CARD_BLOCKS_FINISHED_REASON =
  "A finished task can't block another task · reopen it first";

function taskCardBlocksAvailabilityReason(session, context = {}) {
  if (!session || session.valid !== true) {
    return (session && session.error) || "Task context is unavailable";
  }
  const targets = Array.isArray(session.targets) ? session.targets : [];
  if (targets.length === 0) {
    return "No task targets are available";
  }
  if (targets.some((target) => !isObsidianTaskLine(target && target.rawLine))) {
    return "Blocks requires a #task checkbox";
  }
  if (
    targets.some((target) =>
      !OPEN_OBSIDIAN_TASK_STATUSES.has(
        getObsidianTaskCheckboxStatus(target && target.rawLine),
      ),
    )
  ) {
    // The card row reads without the 🧱; the entry Notice adds it
    // (`taskCardBlocksEntryRefusal`, §15.2 / §15.4).
    return TASK_CARD_BLOCKS_FINISHED_REASON;
  }
  // The reverse twin of forward's "⛓ Dependencies can't be edited inside a
  // blockquote": a blockquoted task can never own a Depends-On line.
  if (
    targets.some((target) => isBlockquotedMarkdownLine(target && target.rawLine))
  ) {
    return "🧱 Blocks can't be edited inside a blockquote";
  }

  const paths = targets
    .map((target) => normalizeVaultRelativePath(target && target.path))
    .filter(Boolean);
  const filePaths = paths.length > 0
    ? paths
    : [normalizeVaultRelativePath(context.filePath || "")].filter(Boolean);
  if (filePaths.some((path) => isArchivedRecoveryTarget(path))) {
    return "This task is in a read-only note";
  }
  const today =
    context.baseDate instanceof Date ? context.baseDate : new Date();
  const vaultFiles = Array.isArray(context.vaultFiles)
    ? context.vaultFiles.map((path) => ({ path }))
    : [];
  const dailyPaths = scheduledRecoveryDailyPaths(vaultFiles, today);
  if (
    dailyPaths &&
    filePaths.includes(normalizeVaultRelativePath(dailyPaths.previous || ""))
  ) {
    return "The previous daily note is read-only";
  }

  for (const target of targets) {
    const rawLine = String((target && target.rawLine) || "");
    const id = findBulletPropertyField(rawLine, "id");
    const path = normalizeVaultRelativePath(target && target.path) ||
      normalizeVaultRelativePath(context.filePath || "");
    if (
      (!id || !normalizeBulletPropertyValue(id.value)) &&
      !tryDependencyId(path, getTrailingBlockId(rawLine) || "task")
    ) {
      return "🧱 This note's path can't be a dependency id · add [id::] or rename the note";
    }
  }
  if (
    session.type === "single" &&
    !isObsidianTaskAtLine(session.content, session.cursorLine)
  ) {
    return "Blocks requires a #task checkbox";
  }
  return null;
}

function taskCardBlocksEntryRefusal(context = {}) {
  const session = taskCardSessionContext(context);
  const reason = taskCardBlocksAvailabilityReason(session, context);
  return reason === TASK_CARD_BLOCKS_FINISHED_REASON ? `🧱 ${reason}` : reason;
}

function taskCardBlocksSummary(session, taskCache, baseDate = new Date()) {
  if (!taskCache || taskCache.ready !== true || !Array.isArray(taskCache.tasks)) {
    return null;
  }
  const targets = Array.isArray(session && session.targets) ? session.targets : [];
  const sourceIds = new Set();
  for (const target of targets) {
    const field = findBulletPropertyField(String((target && target.rawLine) || ""), "id");
    const id = normalizeBulletPropertyValue(field && field.value);
    if (!id) {
      return null;
    }
    sourceIds.add(id);
  }
  if (sourceIds.size === 0) {
    return null;
  }

  const tasks = taskCache.tasks
    .map((task) =>
      task && task.path && Array.isArray(task.dependsOn)
        ? task
        : normalizeStageCacheTask(task),
    )
    .filter(Boolean);
  const openAliases = new Set();
  for (const task of tasks) {
    if (!task.open) {
      continue;
    }
    const id = normalizeBulletPropertyValue(task.idField || "");
    const blockId = normalizeBulletPropertyValue(task.blockId || "");
    if (id) openAliases.add(id);
    if (blockId) {
      openAliases.add(blockId);
      const encoded = tryDependencyId(task.path, blockId);
      if (encoded) openAliases.add(normalizeBulletPropertyValue(encoded));
    }
  }
  const today = formatBulletPropertyDate(
    baseDate instanceof Date ? getLocalDateStart(baseDate) : getLocalDateStart(new Date()),
  );
  const dependents = tasks.filter(
    (task) =>
      task.open &&
      task.dependsOn.some((dependency) => sourceIds.has(normalizeBulletPropertyValue(dependency))),
  );
  const frees = dependents.filter((task) => {
    const otherOpenPrerequisite = task.dependsOn.some((dependency) => {
      const id = normalizeBulletPropertyValue(dependency);
      return !sourceIds.has(id) && openAliases.has(id);
    });
    const scheduled =
      task.scheduledDate ||
      (findBulletPropertyField(String(task.rawLine || ""), "scheduled") || {}).value ||
      "";
    const futureScheduled = /^\d{4}-\d{2}-\d{2}$/.test(String(scheduled)) && scheduled > today;
    const projectBlocked =
      /(?:^|\s)#prj_is_blocked(?:\s|$)/.test(String(task.rawLine || "")) ||
      (Array.isArray(task.tags) && task.tags.includes("prj_is_blocked"));
    return !otherOpenPrerequisite && !futureScheduled && !projectBlocked;
  }).length;
  return Object.freeze({ count: dependents.length, frees });
}
