function planDependencyStageView(args = {}) {
  const current = Array.isArray(args.current) ? args.current : [];
  const pool = Array.isArray(args.candidates) ? args.candidates : [];
  const query = String(args.query || "");
  const dependent = args.dependent || {};
  const dependentPath = normalizeVaultRelativePath(dependent.path || "");
  const dependentLine = Math.floor(numericOrDefault(dependent.line, -1));
  const dependentKey = dependent.key || null;
  const edges = args.edges || new Map();
  const linkedKeys = args.linkedKeys instanceof Set ? args.linkedKeys : new Set();
  // Counted sessions (`N<Ctrl+Shift+P>`) match each candidate against every
  // source task's field set, so partially linked rows stay visible with a
  // `k/n depend` badge instead of being folded into CURRENT.
  const sourceValueSets =
    Array.isArray(args.sourceValueSets) && args.sourceValueSets.length > 0
      ? args.sourceValueSets.map((values) =>
          values instanceof Set ? values : new Set(values || []),
        )
      : null;
  const maxRows = Math.max(
    1,
    Math.floor(numericOrDefault(args.maxRows, DEPENDENCY_STAGE_MAX_ROWS)),
  );
  const markedCurrent = current.map((row, index) =>
    Object.freeze({
      ...row,
      stageSection: "current",
      alreadyLinked: true,
      firstInSection: index === 0,
      markKey:
        row.markKey ||
        (row.path
          ? `${normalizeVaultRelativePath(row.path)}#${row.blockId || `line:${row.line}`}`
          : row.line),
    }),
  );
  const candidateAliases = (candidate) => {
    const depValue =
      candidate.idField ||
      (candidate.blockId
        ? tryDependencyId(candidate.path, candidate.blockId)
        : null) ||
      "";
    return [depValue, candidate.idField, candidate.blockId]
      .map(normalizeBulletPropertyValue)
      .filter(Boolean);
  };
  const seen = new Set(linkedKeys);
  const fresh = [];
  for (const candidate of pool) {
    const key =
      candidate.path && candidate.blockId
        ? dependencyStageRowKey(candidate.path, candidate.blockId)
        : null;
    if (
      candidate.path === dependentPath &&
      candidate.line === dependentLine
    ) {
      continue;
    }
    if (sourceValueSets) {
      const aliases = candidateAliases(candidate);
      const linkedCount = sourceValueSets.filter((values) =>
        aliases.some((alias) => values.has(alias)),
      ).length;
      // Fully linked rows live in CURRENT; mixed and unlinked stay in RESULTS.
      if (linkedCount > 0 && linkedCount === sourceValueSets.length) {
        continue;
      }
      fresh.push({ candidate, key, linkedCount });
      continue;
    }
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    fresh.push({ candidate, key, linkedCount: 0 });
  }
  let ordered;
  if (!query.trim()) {
    // Empty query shows only what the design lists: CURRENT is separate,
    // RESULTS is same-note tasks plus the In Progress and Next lanes.
    // Ready tasks from other notes (and Blocked elsewhere) need typing.
    const emptyPool = fresh.filter(
      (entry) =>
        entry.candidate.path === dependentPath ||
        entry.candidate.status === "/" ||
        entry.candidate.status === "*",
    );
    ordered = emptyPool
      .slice()
      .sort((left, right) =>
        compareDependencyStageCanonical(
          left.candidate,
          right.candidate,
          dependentPath,
        ),
      )
      .map((entry) => entry.candidate);
  } else {
    const ranked = dependencyStageRank(
      fresh.map((entry) => entry.candidate),
      query,
    );
    const rankIndex = new Map(ranked.map((candidate, index) => [candidate, index]));
    ordered = fresh
      .slice()
      .sort((left, right) => {
        const leftRank = rankIndex.has(left.candidate)
          ? rankIndex.get(left.candidate)
          : Number.POSITIVE_INFINITY;
        const rightRank = rankIndex.has(right.candidate)
          ? rankIndex.get(right.candidate)
          : Number.POSITIVE_INFINITY;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return compareDependencyStageCanonical(
          left.candidate,
          right.candidate,
          dependentPath,
        );
      })
      .map((entry) => entry.candidate)
      .filter((candidate) => rankIndex.has(candidate));
  }
  const results = [];
  const blocked = [];
  for (const candidate of ordered) {
    if (candidate.blocked) {
      blocked.push(candidate);
    } else {
      results.push(candidate);
    }
  }
  const room = Math.max(0, maxRows - markedCurrent.length);
  const picked = [...results, ...blocked].slice(0, room);
  const linkedByCandidate = new Map(
    fresh.map((entry) => [entry.candidate, entry.linkedCount || 0]),
  );
  // Task descriptions by stage row key, so disabled cycle rows tooltip
  // readable `description → description` paths instead of raw
  // `path blockId` keys (`docs/task-dependencies.md` §6.4). Keys without a
  // row (the dependent itself, `id:` values) keep the raw key.
  const labelByKey = new Map();
  for (const row of [...current, ...pool]) {
    if (!row) {
      continue;
    }
    const rowKey =
      row.path && row.blockId
        ? dependencyStageRowKey(row.path, row.blockId)
        : null;
    const label = row.displayText || row.text || null;
    if (rowKey && label && !labelByKey.has(rowKey)) {
      labelByKey.set(rowKey, label);
    }
  }
  const labelDependencyStageCycle = (cycle) =>
    Object.freeze(
      (Array.isArray(cycle) ? cycle : []).map((key) =>
        labelByKey.has(key) ? labelByKey.get(key) : key,
      ),
    );
  // The dependent line itself is never a pool row, so its description would
  // otherwise fall back to the raw key at the end of every cycle path.
  if (
    dependentKey &&
    !labelByKey.has(dependentKey) &&
    (dependent.displayText || dependent.text)
  ) {
    labelByKey.set(dependentKey, dependent.displayText || dependent.text);
  }
  const guard = (candidate) => {
    const key =
      candidate.path && candidate.blockId
        ? dependencyStageRowKey(candidate.path, candidate.blockId)
        : null;
    if (key && dependentKey) {
      if (key === dependentKey) {
        const selfCycle = Object.freeze([dependentKey]);
        return {
          disabled: true,
          reason: "this task",
          cycle: selfCycle,
          cycleLabels: labelDependencyStageCycle(selfCycle),
        };
      }
      const cycle = findDependencyStageCycle(edges, dependentKey, key);
      if (cycle) {
        return {
          disabled: true,
          reason: "would create a cycle",
          cycle: Object.freeze(cycle),
          cycleLabels: labelDependencyStageCycle(cycle),
        };
      }
    }
    if (
      candidate.blockId &&
      !candidate.idField &&
      !tryDependencyId(candidate.path, candidate.blockId)
    ) {
      return {
        disabled: true,
        reason: "path can't be an id",
        cycle: null,
        cycleLabels: null,
      };
    }
    return { disabled: false, reason: null, cycle: null, cycleLabels: null };
  };
  const shape = (candidate, section, first) => {
    const verdict = guard(candidate);
    const depValue =
      candidate.idField ||
      (candidate.blockId
        ? tryDependencyId(candidate.path, candidate.blockId)
        : null) ||
      "";
    // BLOCKED rows name what blocks them (`docs/task-dependencies.md` §6.3):
    // `🔒 waits on N` only when N >= 1 open prerequisites remain (the
    // candidate's own open count when the builder attached one, else the
    // post-batch graph edges, else 0 — never `waits on 0`); with no open
    // prerequisite, a future `scheduled` date reads `🔒 scheduled
    // YYYY-MM-DD`, and otherwise the row reads `🔒 blocked`.
    let waitsOn = null;
    let blockedBadge = null;
    if (section === "blocked") {
      const rowKey =
        candidate.path && candidate.blockId
          ? dependencyStageRowKey(candidate.path, candidate.blockId)
          : null;
      const edgeCount =
        rowKey && edges instanceof Map && edges.get(rowKey)
          ? edges.get(rowKey).length
          : null;
      const open =
        Number.isInteger(candidate.openCount) && candidate.openCount >= 0
          ? candidate.openCount
          : Number.isInteger(edgeCount) && edgeCount > 0
            ? edgeCount
            : 0;
      if (open >= 1) {
        waitsOn = open;
        blockedBadge = `🔒 waits on ${open}`;
      } else {
        const scheduled =
          typeof candidate.scheduledDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(candidate.scheduledDate)
            ? candidate.scheduledDate
            : null;
        blockedBadge = scheduled ? `🔒 scheduled ${scheduled}` : "🔒 blocked";
      }
    }
    return Object.freeze({
      kind: "local-task",
      stageSection: section,
      firstInSection: first,
      path: candidate.path,
      blockId: candidate.blockId,
      route: candidate.route,
      note: candidate.note,
      noteLabel:
        candidate.path && candidate.path !== dependentPath
          ? dependencyStageBasenameOf(candidate.path)
          : null,
      line: candidate.line,
      rawLine: candidate.rawLine,
      status: candidate.status,
      displayText: candidate.displayText,
      text: candidate.text,
      searchText: [
        candidate.displayText,
        candidate.route,
        candidate.blockId
          ? `${candidate.route}:${candidate.blockId}`
          : "",
        candidate.blockId || "",
        candidate.section || "",
        candidate.note || "",
      ]
        .filter(Boolean)
        .join(" "),
      value: depValue,
      dependencyValue: depValue,
      legacyDependencyValue: candidate.idField || candidate.blockId || "",
      linkBlockId: candidate.blockId || "",
      badgeId: candidate.blockId || "",
      existingBlockId: candidate.blockId,
      existingIdField: candidate.idField,
      alreadyLinked: sourceValueSets
        ? (linkedByCandidate.get(candidate) || 0) === sourceValueSets.length &&
          sourceValueSets.length > 0
        : false,
      linkedSourceCount: linkedByCandidate.get(candidate) || 0,
      sourceCount: sourceValueSets ? sourceValueSets.length : 1,
      linkState: !sourceValueSets
        ? "none"
        : (linkedByCandidate.get(candidate) || 0) === 0
          ? "none"
          : (linkedByCandidate.get(candidate) || 0) >= sourceValueSets.length
            ? "all"
            : "mixed",
      needsBlockIdPrompt: !candidate.blockId,
      needsDependencyValue: !depValue,
      needsPromptForAdd: !candidate.blockId,
      hidden: candidate.hidden,
      section: candidate.section,
      markKey: `${candidate.path}#${candidate.line >= 0 ? candidate.line : (candidate.blockId || candidate.displayText)}`,
      disabled: verdict.disabled,
      disabledReason: verdict.reason,
      cycle: verdict.cycle,
      cycleLabels: verdict.cycleLabels || null,
      waitsOn,
      blockedBadge,
    });
  };
  const out = [...markedCurrent];
  const pickedResults = picked.filter((candidate) => !candidate.blocked);
  const pickedBlocked = picked.filter((candidate) => candidate.blocked);
  pickedResults.forEach((candidate, index) =>
    out.push(shape(candidate, "results", index === 0)),
  );
  pickedBlocked.forEach((candidate, index) =>
    out.push(shape(candidate, "blocked", index === 0)),
  );
  // The ~60-row cap truncates: append the "type to search N more" hint row
  // so keyboard filtering reaches the rest (`docs/task-dependencies.md` §6.3).
  const totalOrdered = [...results, ...blocked].length;
  const hiddenCount = Math.max(0, totalOrdered - picked.length);
  if (hiddenCount > 0) {
    out.push(
      Object.freeze({
        kind: "stage-more",
        stageSection: pickedBlocked.length > 0 ? "blocked" : "results",
        firstInSection: false,
        path: null,
        blockId: null,
        displayText: `type to search ${hiddenCount} more`,
        text: `type to search ${hiddenCount} more`,
        searchText: "",
        hiddenCount,
        disabled: true,
        disabledReason: `type to search ${hiddenCount} more`,
        cycle: null,
        cycleLabels: null,
        waitsOn: null,
      }),
    );
  }
  return Object.freeze(out);
}

// Normalize one Tasks cache task to pool shape, or null when it carries no
// usable location. Field names differ across Tasks versions, so every known
// alias is tried; the vault scan covers whatever falls through.
function normalizeStageCacheTask(entry) {
  const task = entry && typeof entry === "object" ? entry : null;
  if (!task) {
    return null;
  }
  const location =
    task.taskLocation && typeof task.taskLocation === "object"
      ? task.taskLocation
      : {};
  const file = task.file && typeof task.file === "object" ? task.file : {};
  const path = normalizeVaultRelativePath(
    task.path || location.path || file.path || "",
  );
  if (!path) {
    return null;
  }
  const status =
    (task.status && task.status.symbol) ||
    task.statusSymbol ||
    (typeof task.status === "string" ? task.status : null) ||
    " ";
  const lineCandidates = [
    task.lineNumber,
    task.line,
    location.lineNumber,
    location.line,
  ];
  let line = -1;
  for (const candidate of lineCandidates) {
    const numeric = Math.floor(numericOrDefault(candidate, Number.NaN));
    if (Number.isFinite(numeric) && numeric >= 0) {
      line = numeric;
      break;
    }
  }
  const rawLine =
    typeof task.originalMarkdown === "string" ? task.originalMarkdown : null;
  const text =
    (typeof task.description === "string" && task.description) ||
    (typeof task.text === "string" && task.text) ||
    (rawLine ? cleanTaskDisplayText(rawLine) : "(untitled task)");
  const trailingId =
    (typeof task.blockId === "string" && task.blockId) ||
    (rawLine ? getTrailingBlockId(rawLine) : null) ||
    null;
  const idField =
    (typeof task.id === "string" && task.id) ||
    (task.taskId && String(task.taskId)) ||
    null;
  const dependsOn = Array.isArray(task.dependsOn)
    ? task.dependsOn
        .map(normalizeBulletPropertyValue)
        .filter(Boolean)
    : [];
  return Object.freeze({
    path,
    route: dependencyStageRouteOf(path),
    note: dependencyStageBasenameOf(path),
    line,
    rawLine,
    status,
    displayText: text,
    text,
    blockId: trailingId ? normalizeBulletPropertyValue(trailingId) : null,
    existingBlockId: trailingId ? normalizeBulletPropertyValue(trailingId) : null,
    idField: idField ? normalizeBulletPropertyValue(idField) : null,
    existingIdField: idField ? normalizeBulletPropertyValue(idField) : null,
    section:
      (typeof task.section === "string" && task.section) ||
      (typeof task.precedingHeader === "string" && task.precedingHeader) ||
      null,
    open: OPEN_OBSIDIAN_TASK_STATUSES.has(status),
    blocked: status === "?",
    hidden: Boolean(task.hidden),
    dependsOn: Object.freeze(dependsOn),
  });
}

// Merge Tasks cache records under open-buffer notes: buffers win per note
// (unsaved edits count), cache-only notes fill the rest. Exclusions and the
// dependent match the note parser exactly.
function mergeStageCacheCandidates(cacheTasks, notes, options = {}) {
  const dependentPath = normalizeVaultRelativePath(options.dependentPath || "");
  const dependentLines =
    options.dependentLines instanceof Set
      ? options.dependentLines
      : new Set(options.dependentLines || []);
  const buffered = new Set(
    (Array.isArray(notes) ? notes : []).map((note) =>
      normalizeVaultRelativePath(note.path || ""),
    ),
  );
  const out = collectVaultDependencyCandidates(notes, {
    dependentPath,
    dependentLines,
  }).slice();
  for (const record of cacheTasks || []) {
    if (!record || buffered.has(record.path)) {
      continue;
    }
    if (isDependencyStageExcludedPath(record.path)) {
      continue;
    }
    if (!record.open) {
      continue;
    }
    if (
      record.path === dependentPath &&
      dependentLines.has(record.line)
    ) {
      continue;
    }
    out.push(record);
  }
  return Object.freeze(out);
}

// Register cache-only records in the lookup (for CURRENT rows and pill
// counts) and the basename table (for link resolution).
function registerStageCacheRecords(index, cacheTasks) {
  if (!index) {
    return;
  }
  for (const record of cacheTasks || []) {
    if (!record) {
      continue;
    }
    const basename = dependencyStageBasenameOf(record.path);
    if (index.basenames && !index.basenames.has(basename)) {
      index.basenames.set(basename, []);
    }
    if (index.basenames && !index.basenames.get(basename).includes(record.path)) {
      index.basenames.get(basename).push(record.path);
    }
    if (record.blockId) {
      const key = dependencyStageRowKey(record.path, record.blockId);
      if (key && index.byKey && !index.byKey.has(key)) {
        index.byKey.set(key, record);
      }
      if (index.byBlockId) {
        if (!index.byBlockId.has(record.blockId)) {
          index.byBlockId.set(record.blockId, []);
        }
        index.byBlockId.get(record.blockId).push(record);
      }
    }
    if (record.idField && index.byIdField && !index.byIdField.has(record.idField)) {
      index.byIdField.set(record.idField, record);
    }
  }
}

// Cycle-guard edges from cache `[dependsOn::]` fields for notes with no
// open buffer: identity through the block id when present, else the stable
// `id:` key shared with the note parser's edge scheme.
function mergeStageCacheEdges(edges, cacheTasks, index) {
  if (!(edges instanceof Map)) {
    return;
  }
  for (const record of cacheTasks || []) {
    if (!record || !Array.isArray(record.dependsOn) || record.dependsOn.length === 0) {
      continue;
    }
    const from =
      (record.blockId && dependencyStageRowKey(record.path, record.blockId)) ||
      (record.idField ? `id:${record.idField}` : null);
    if (!from) {
      continue;
    }
    for (const id of record.dependsOn) {
      const target = index && index.byIdField ? index.byIdField.get(id) : null;
      const to =
        target && target.blockId
          ? dependencyStageRowKey(target.path, target.blockId)
          : null;
      if (to && to !== from) {
        if (!edges.has(from)) {
          edges.set(from, []);
        }
        if (!edges.get(from).includes(to)) {
          edges.get(from).push(to);
        }
      }
    }
  }
}

// Locate one open task by its cleaned display text: cache-only `+ id` rows
// carry no staged line text, so the target is matched fresh. Exactly one
// block-id-less match links; anything else refuses as stale.
function locateStageDisplayText(content, displayText) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const contexts = getMarkdownLineContextsForLines(lines);
  const want = String(displayText || "");
  const matches = [];
  for (let line = 0; line < lines.length; line += 1) {
    if (!isObsidianTaskAtLine(text, line, contexts, lines)) {
      continue;
    }
    if (!isOpenObsidianTaskLine(lines[line])) {
      continue;
    }
    if (cleanTaskDisplayText(lines[line]) !== want) {
      continue;
    }
    matches.push(
      Object.freeze({
        line,
        rawLine: String(lines[line] || ""),
        blockId: getTrailingBlockId(lines[line]),
      }),
    );
    if (matches.length > 1) {
      return null;
    }
  }
  // The unique match, with or without a block id (the caller routes `+ id`
  // prompts versus ready adds); ambiguous or absent matches refuse.
  return matches.length === 1 ? matches[0] : null;
}

// True when a non-collapsed selection covers two or more `#task` lines: the
// stage edits one dependent, so such selections are refused with a reason.
function editorSelectionSpansTasks(cm, content) {
  try {
    if (!cm || typeof cm.listSelections !== "function") {
      return false;
    }
    const text = String(content || "");
    const lines = text.split(/\r?\n/);
    const contexts = getMarkdownLineContextsForLines(lines);
    for (const selection of cm.listSelections() || []) {
      const anchor = selection && selection.anchor;
      const head = selection && selection.head;
      if (!anchor || !head) {
        continue;
      }
      if (anchor.line === head.line && anchor.ch === head.ch) {
        continue;
      }
      const from = Math.max(0, Math.min(anchor.line, head.line));
      const to = Math.max(0, Math.max(anchor.line, head.line));
      let tasks = 0;
      for (let line = from; line <= to && tasks < 2; line += 1) {
        if (isObsidianTaskAtLine(text, line, contexts, lines)) {
          tasks += 1;
        }
      }
      if (tasks >= 2) {
        return true;
      }
    }
    return false;
  } catch (_error) {
    return false;
  }
}

// Entry-point resolution (`docs/task-dependencies.md` §6.1): anywhere on a
// Depends-On line resolves to the owning task and skips the property step;
// a `#task` line (or any other line of its block) resolves to the owning
// task through the property step; prose with no owning task is refused.
function resolveDependencyStageEntry(content, line) {
  const text = String(content || "");
  const lines = text.split(/\r?\n/);
  const at = Math.floor(numericOrDefault(line, Number.NaN));
  if (!Number.isFinite(at) || at < 0 || at >= lines.length) {
    return Object.freeze({ ok: false, parentLine: null, reason: "no-task" });
  }
  const owning = findOwningTaskLine(lines, at);
  if (owning === null) {
    return Object.freeze({ ok: false, parentLine: null, reason: "no-task" });
  }
  if (
    findDependencyLineIndex(lines, owning) === at &&
    parseDependencyLine(String(lines[at] || ""), { isDirectChildOfTask: true })
      .verdict === "accept"
  ) {
    return Object.freeze({
      ok: true,
      parentLine: owning,
      skipPropertyStep: true,
      reason: null,
    });
  }
  return Object.freeze({
    ok: true,
    parentLine: owning,
    skipPropertyStep: false,
    reason: null,
  });
}

function taskStatusLabel(status) {
  return `[${status || " "}]`;
}

function taskStatusClass(status) {
  if (status === "/") {
    return "active";
  }

  if (status === "*") {
    return "next";
  }

  return "todo";
}

function validateBlockIdCandidate(id, content, options = {}) {
  const reservedIds =
    options.reservedIds instanceof Set
      ? options.reservedIds
      : new Set(options.reservedIds || []);
  const value = normalizeBulletPropertyValue(id);
  if (!value) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "invalid",
      message: "Enter a block ID",
    });
  }

  if (!BULLET_PROPERTY_BLOCK_ID_RE.test(value)) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "invalid",
      message: "Use only letters, numbers, and hyphens",
    });
  }

  if (blockIdExistsInContent(content, value)) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "duplicate",
      message: "Already exists in this file",
    });
  }

  if (reservedIds.has(value)) {
    return Object.freeze({
      id: value,
      valid: false,
      state: "duplicate",
      message: "Already chosen in this batch",
    });
  }

  return Object.freeze({
    id: value,
    valid: true,
    state: "valid",
    message: "Ready to create",
  });
}

function createBulletPropertyValueItems(propertyItem, baseDate) {
  const property = propertyItem.property;
  const currentValue = propertyItem.currentValue || "";
  if (property.values === "date") {
    return createBulletPropertyDateItems(baseDate, currentValue);
  }

  if (property.values === "local_task_id") {
    return [];
  }

  if (property.values === "priority") {
    return property.levels.map((level) => ({
      kind: "value",
      value: level.value,
      label: level.label,
      detail: `${level.value} · in ${level.minDays}–${level.maxDays} days`,
      current: level.value === currentValue,
      dynamic: false,
      priorityLevel: level,
      searchText: `${level.label} ${level.value} ${level.minDays}–${level.maxDays} days`,
    }));
  }

  return property.values.map((value) => ({
    kind: "value",
    value,
    label: value,
    detail: value === currentValue ? "Current value" : "",
    current: value === currentValue,
    dynamic: false,
    searchText: value,
  }));
}

function taskCardSessionContext(context = {}) {
  const content = String(context.content || "");
  const cursorLine = Math.floor(
    numericOrDefault(
      context.cursorLine ?? (context.cursor && context.cursor.line),
      0,
    ),
  );
  const lines = content.split(/\r?\n/);
  const lineText = String(
    context.lineText ?? lines[cursorLine] ?? "",
  );
  const linkSession = context.linkSession || null;
  const taskSession = context.taskSession || null;
  if (
    linkSession &&
    linkSession.kind === "task-link" &&
    Array.isArray(linkSession.resolved)
  ) {
    const resolvedTargets = deduplicateTaskCardTargets(linkSession.resolved).map(
      (entry) => entry.target,
    );
    return Object.freeze({
      type: "linked",
      content,
      lineText,
      cursorLine,
      taskSession,
      linkSession,
      targets: resolvedTargets,
      sourceTargets: linkSession.targets || [],
      targetCount: resolvedTargets.length,
      requestedCount: linkSession.requestedCount || linkSession.resolved.length,
      clamped: linkSession.clamped === true,
      valid: linkSession.valid !== false && resolvedTargets.length > 0,
      error:
        linkSession.valid === false
          ? linkSession.error || "Linked task context is unavailable"
          : resolvedTargets.length > 0
            ? null
            : "No linked tasks are available",
    });
  }
  if (
    taskSession &&
    taskSession.explicit &&
    Array.isArray(taskSession.targets) &&
    taskSession.targets.length > 0
  ) {
    const validation = validateCountedTaskSession(content, taskSession);
    return Object.freeze({
      type: "counted",
      content,
      lineText,
      cursorLine,
      taskSession,
      linkSession: null,
      targets: taskSession.targets,
      sourceTargets: taskSession.targets,
      targetCount: taskSession.targets.length,
      requestedCount: taskSession.requestedCount || taskSession.targets.length,
      clamped: taskSession.clamped === true,
      valid: validation.valid,
      error: validation.valid ? null : validation.error,
    });
  }
  const target = Object.freeze({
    line: cursorLine,
    rawLine: lineText,
    path: context.filePath || "",
  });
  return Object.freeze({
    type: "single",
    content: content || lineText,
    lineText,
    cursorLine,
    taskSession: null,
    linkSession: null,
    targets: lineText ? [target] : [],
    sourceTargets: lineText ? [target] : [],
    targetCount: lineText ? 1 : 0,
    requestedCount: lineText ? 1 : 0,
    clamped: false,
    valid: Boolean(lineText),
    error: lineText ? null : "No task or bullet is selected",
  });
}

function taskCardTargetIdentity(target, index = 0) {
  const item = target && typeof target === "object" ? target : {};
  const path = normalizeVaultRelativePath(
    item.path || item.filePath || (item.file && item.file.path) || "",
  );
  const rawLine = String(item.rawLine || "");
  const blockId = normalizeBulletPropertyValue(
    item.blockId || item.id || getTrailingBlockId(rawLine),
  );
  if (blockId) {
    return `${path}#^${blockId}`;
  }
  if (Number.isInteger(item.line)) {
    return `${path}:line:${item.line}`;
  }
  return `${path}:target:${index}:${rawLine}`;
}

function deduplicateTaskCardTargets(targets) {
  const items = Array.isArray(targets) ? targets : [];
  const seen = new Set();
  const unique = [];
  for (let index = 0; index < items.length; index += 1) {
    const target = items[index];
    const id = taskCardTargetIdentity(target, index);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(Object.freeze({ id, target }));
  }
  return Object.freeze(unique);
}

