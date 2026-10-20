// Task Card Links to… row (`docs/task-relations.md` Rule 8). The detail
// reads the owner's own LINKS line, never the stored mirror and never the
// live index: `N · <first label> <first target, cut> +K`. The row is
// available on open and closed tasks; it is unavailable for non-tasks and
// in read-only notes (done/ and the previous daily note).

function taskCardLinksToAvailabilityReason(session, context = {}) {
  if (!session || session.valid !== true) {
    return (session && session.error) || "Task context is unavailable";
  }
  const targets = Array.isArray(session.targets) ? session.targets : [];
  if (targets.length === 0) {
    return "No task targets are available";
  }
  if (session.type !== "single" && session.type !== "counted") {
    return "Links to needs a single task";
  }
  if (targets.some((target) => !isObsidianTaskLine(target && target.rawLine))) {
    return "Links require a #task checkbox";
  }
  if (
    targets.some((target) => isBlockquotedMarkdownLine(target && target.rawLine))
  ) {
    return "🪢 Links can't be edited inside a blockquote";
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
  return null;
}

function taskCardLinksToEntryRefusal(context = {}) {
  const session = taskCardSessionContext(context);
  return taskCardLinksToAvailabilityReason(session, context);
}

// One owner's outgoing relation entries from its own LINKS children, in
// authored order. Closed tasks count: the row is available on open and
// closed tasks alike (LG vectors).
function taskCardLinksToEntries(content, taskLine) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const at = Math.floor(numericOrDefault(taskLine, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return Object.freeze([]);
  }
  const owner = findOwningTaskLine(lines, at) ?? at;
  if (!isObsidianTaskAtLine(text, owner, null, lines)) {
    return Object.freeze([]);
  }
  const children = findLinksChildren(lines, owner);
  const out = [];
  for (const index of children) {
    const parsed = parseLinksLine(String(lines[index] || ""), {
      isDirectChildOfTask: true,
    });
    if (parsed.verdict !== "accept") {
      continue;
    }
    for (const entry of parsed.entries || []) {
      out.push(entry);
    }
  }
  return Object.freeze(out);
}

function taskCardLinksToTargetName(entry, taskCache) {
  const blockId = normalizeBulletPropertyValue(entry && entry.blockId);
  if (
    taskCache &&
    taskCache.ready === true &&
    Array.isArray(taskCache.tasks) &&
    blockId
  ) {
    for (const task of taskCache.tasks) {
      if (!task) {
        continue;
      }
      const candidate =
        normalizeBulletPropertyValue(task.blockId || "") === blockId ||
        normalizeBulletPropertyValue(task.existingBlockId || "") === blockId;
      if (!candidate) {
        continue;
      }
      const text = String(task.displayText || task.text || "").trim();
      if (text) {
        return text;
      }
    }
  }
  return blockId ? `^${blockId}` : "";
}

function taskCardLinksToDetail(entries, taskCache) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    return "";
  }
  const first = list[0];
  const label = String((first && first.label) || "").trim();
  const target = taskCardLinksToTargetName(first, taskCache);
  const cut = target.length > 24 ? `${target.slice(0, 23)}…` : target;
  const middle = [label, cut].filter(Boolean).join(" ");
  const rest = list.length > 1 ? ` +${list.length - 1}` : "";
  return `${list.length} · ${middle}${rest}`.trim();
}

function taskCardLinksToSummary(session, context = {}) {
  if (!session || session.valid !== true || session.type !== "single") {
    return null;
  }
  const content = String(
    (session && session.content) || context.content || "",
  );
  const line = Math.floor(numericOrDefault(session.cursorLine, Number.NaN));
  if (!Number.isFinite(line)) {
    return null;
  }
  const entries = taskCardLinksToEntries(content, line);
  if (entries.length === 0) {
    return Object.freeze({ count: 0, detail: "" });
  }
  return Object.freeze({
    count: entries.length,
    detail: taskCardLinksToDetail(entries, context.taskCache),
  });
}

// Linked from… is a live-index summary. It deliberately has no stored-line
// fallback: LINKED FROM is a generated mirror, and the Task Card only shows
// this detail when the live index is ready.
function taskCardLinkedFromAvailabilityReason(session, context = {}) {
  if (session && session.type !== "single") {
    return "Linked from needs a single task";
  }
  return taskCardLinksToAvailabilityReason(session, context);
}

function taskCardRelationIndex(context = {}) {
  try {
    const plugins = context.app && context.app.plugins && context.app.plugins.plugins;
    const holder = plugins && plugins["bob-ledger-tools"];
    const api = holder && holder.api && holder.api.relationIndex;
    if (!api || Number(api.version) < 1 || typeof api.incoming !== "function") {
      return null;
    }
    if (typeof api.ready === "function" && api.ready() !== true) {
      return null;
    }
    return api;
  } catch (_error) {
    return null;
  }
}

function taskCardLinkedFromSummary(session, context = {}) {
  if (!session || session.valid !== true || session.type !== "single") {
    return null;
  }
  const target = (session.targets || [])[0];
  const path = normalizeVaultRelativePath((target && target.path) || context.filePath || "");
  const blockId = normalizeBulletPropertyValue(
    getTrailingBlockId((target && target.rawLine) || "") || "",
  );
  const index = taskCardRelationIndex(context);
  if (!path || !blockId || !index) {
    return null;
  }
  let incoming = [];
  try {
    incoming = index.incoming(path, blockId);
  } catch (_error) {
    incoming = [];
  }
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return Object.freeze({ count: 0, detail: "" });
  }
  const first = incoming[0] && incoming[0].source;
  const cleaned = first && first.text ? cleanTaskDisplayText(first.text) : "";
  const name = String(
    cleaned ||
      (first && first.blockId ? `^${first.blockId}` : "source task"),
  ).trim();
  return Object.freeze({
    count: incoming.length,
    detail: `${incoming.length} · ${name}`,
  });
}
