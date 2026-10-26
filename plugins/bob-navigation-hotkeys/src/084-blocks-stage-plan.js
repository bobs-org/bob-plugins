// Reverse Blocks writer planner (`docs/task-dependencies.md` §15.6).
// `planBlocksEdit` puts sources N onto many dependents T by threading
// `planDependencyEdit` per T-note, preparing each N once at the strongest
// pre-gesture lane. RBW6 lives here as `mergeTargetPreparations`.

function strongerTaskLine(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  if (leftText === rightText) {
    return leftText;
  }
  const leftRank = getObsidianTaskStatusRank(
    getObsidianTaskCheckboxStatus(leftText),
  );
  const rightRank = getObsidianTaskStatusRank(
    getObsidianTaskCheckboxStatus(rightText),
  );
  const leftScore = leftRank === null ? -1 : leftRank;
  const rightScore = rightRank === null ? -1 : rightRank;
  let winner = rightScore > leftScore ? rightText : leftText;
  const other = rightScore > leftScore ? leftText : rightText;
  const otherId = findBulletPropertyField(other, "id");
  const winnerId = findBulletPropertyField(winner, "id");
  if (otherId && !winnerId) {
    winner = upsertBulletProperty(winner, "id", otherId.value).line;
  }
  const otherBlock = getTrailingBlockId(other);
  if (otherBlock && !getTrailingBlockId(winner)) {
    winner = appendBlockIdToLine(winner, otherBlock);
  }
  return winner;
}

// Collapse cross-note preparations of the same target line to one write at
// the strongest lane so counted forward (RBW6) and reverse (RBP7) never
// emit two `from` values that fight `target-changed`.
function mergeTargetPreparations(preparations) {
  const byKey = new Map();
  for (const prep of Array.isArray(preparations) ? preparations : []) {
    if (!prep || !Number.isInteger(prep.line)) {
      continue;
    }
    const path = normalizeVaultRelativePath(prep.path || "");
    if (!path) {
      continue;
    }
    const key = `${path}\x00${prep.line}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, prep);
      continue;
    }
    const from =
      existing.from !== undefined && existing.from !== null
        ? existing.from
        : prep.from;
    const text = strongerTaskLine(existing.text, prep.text);
    byKey.set(
      key,
      Object.freeze({
        ...existing,
        path,
        line: prep.line,
        from,
        text,
        kind: existing.kind || prep.kind || "target-identity",
      }),
    );
  }
  return Object.freeze([...byKey.values()]);
}

function applyStrongestLineEdits(content, preparations) {
  const text = String(content || "");
  const edits = Array.isArray(preparations) ? preparations : [];
  if (edits.length === 0) {
    return text;
  }
  const { lines, lineEnding } = splitMarkdownContent(text);
  let changed = false;
  for (const prep of edits) {
    if (
      !Number.isInteger(prep.line) ||
      prep.line < 0 ||
      prep.line >= lines.length
    ) {
      continue;
    }
    const next = strongerTaskLine(lines[prep.line], prep.text);
    if (next !== lines[prep.line]) {
      lines[prep.line] = next;
      changed = true;
    }
  }
  return changed ? lines.join(lineEnding) : text;
}

function resolveBlocksEditTaskRef(ref, files, fallbackPath) {
  const path = normalizeVaultRelativePath(
    (ref && ref.path) || fallbackPath || "",
  );
  if (!path || !(files instanceof Map) || !files.has(path)) {
    return null;
  }
  const content = String(files.get(path) || "");
  const lines = content.split(/\r?\n/);
  let line = Math.floor(numericOrDefault(ref && ref.line, Number.NaN));
  let blockId = normalizeBulletPropertyValue((ref && ref.blockId) || "");
  if (!Number.isFinite(line) && blockId) {
    const found = findTaskLineByTrailingBlockId(lines, blockId);
    line = found === null ? Number.NaN : found;
  }
  if (!Number.isFinite(line) || line < 0 || line >= lines.length) {
    return null;
  }
  if (!isObsidianTaskAtLine(content, line)) {
    return null;
  }
  if (!blockId) {
    blockId = getTrailingBlockId(String(lines[line] || "")) || "";
  }
  return Object.freeze({
    path,
    line,
    blockId,
    text: String(lines[line] || ""),
  });
}

function stampBlocksEditParentLine(content, parentLine, stamper, dateText) {
  if (typeof stamper !== "function") {
    return String(content || "");
  }
  const { lines, lineEnding } = splitMarkdownContent(content);
  if (parentLine < 0 || parentLine >= lines.length) {
    return String(content || "");
  }
  const next = applyFreshStampLine(lines[parentLine], stamper, dateText, {
    content: String(content || ""),
    line: parentLine,
  });
  if (next === lines[parentLine]) {
    return String(content || "");
  }
  lines[parentLine] = next;
  return lines.join(lineEnding);
}

function truncateBlocksNoticeName(name) {
  const text = String(name || "").trim();
  if (text.length <= 40) {
    return text;
  }
  return `${text.slice(0, 39)}\u2026`;
}

function blocksLaneLabel(status) {
  if (status === "/") {
    return "In Progress";
  }
  if (status === "*") {
    return "Next";
  }
  if (status === "?") {
    return "Blocked";
  }
  if (status === " ") {
    return "Ready";
  }
  return null;
}

function quoteBlocksNoticeName(name) {
  return `\u201c${truncateBlocksNoticeName(name)}\u201d`;
}

function buildBlocksEditNotice(details = {}) {
  const added = Array.isArray(details.added) ? details.added : [];
  const removed = Array.isArray(details.removed) ? details.removed : [];
  const sourceCount = Math.max(
    1,
    Math.floor(numericOrDefault(details.sourceCount, 1)),
  );
  const takes = details.takesLane;
  const failedCount = Math.max(
    0,
    Math.floor(numericOrDefault(details.failedCount, 0)),
  );
  const pomodoroRemoved = Math.max(
    0,
    Math.floor(numericOrDefault(details.pomodoroRemoved, 0)),
  );
  const pomodoroFailed = details.pomodoroFailed === true;
  const blocksFailed = details.blocksFailed === true;
  const parts = [];
  if (sourceCount > 1 && added.length + removed.length > 0 && removed.length === 0) {
    if (added.length === 1) {
      parts.push(
        `🧱 ${sourceCount} tasks now block ${quoteBlocksNoticeName(added[0].description)}`,
      );
    } else {
      parts.push(
        `🧱 ${sourceCount} tasks now block ${formatCountLabel(added.length, "task")}`,
      );
    }
  } else if (added.length === 1 && removed.length === 0) {
    const row = added[0];
    if (row.isProject) {
      const blocked = Math.max(
        0,
        Math.floor(numericOrDefault(row.blockedCount, 0)),
      );
      parts.push(
        `🧱 Now blocks project ${quoteBlocksNoticeName(row.description)}${
          blocked > 0
            ? ` \u00b7 ${formatCountLabel(blocked, "task")} Blocked`
            : ""
        }`,
      );
    } else if (row.fromStatus === "?") {
      const waiting = Math.max(
        1,
        Math.floor(numericOrDefault(row.openRemaining, 1)),
      );
      parts.push(
        `🧱 Now blocks ${quoteBlocksNoticeName(row.description)} \u00b7 still Blocked (waits on ${waiting})`,
      );
    } else {
      const fromLabel = blocksLaneLabel(row.fromStatus) || "Ready";
      let line = `🧱 Now blocks ${quoteBlocksNoticeName(row.description)} \u00b7 ${fromLabel} \u2192 Blocked`;
      if (takes === "/") {
        line += " \u00b7 takes In Progress";
      } else if (takes === "*") {
        line += " \u00b7 takes Next";
      }
      parts.push(line);
    }
  } else if (removed.length === 1 && added.length === 0) {
    const row = removed[0];
    parts.push(
      row.recovered
        ? `🧱 No longer blocks ${quoteBlocksNoticeName(row.description)} \u00b7 Ready again`
        : `🧱 No longer blocks ${quoteBlocksNoticeName(row.description)} \u00b7 still Blocked`,
    );
  } else if (added.length > 0 || removed.length > 0) {
    const chunks = [];
    if (added.length > 0) {
      chunks.push(`Now blocks ${formatCountLabel(added.length, "task")}`);
    }
    if (removed.length > 0) {
      chunks.push(`${removed.length} removed`);
    }
    let line = `🧱 ${chunks.join(" \u00b7 ")}`;
    if (takes === "/") {
      line += " \u00b7 takes In Progress";
    } else if (takes === "*") {
      line += " \u00b7 takes Next";
    }
    parts.push(line);
  } else {
    parts.push("🧱 No dependency changes");
  }
  let notice = parts.join("");
  if (pomodoroRemoved > 0) {
    notice += ` \u00b7 removed ${formatCountLabel(pomodoroRemoved, "Pomodoro link")}`;
  } else if (pomodoroFailed) {
    notice += "; Pomodoro links not removed";
  }
  if (failedCount > 0) {
    notice += ` \u00b7 ${formatCountLabel(failedCount, "task")} not updated (changed \u2014 reopen)`;
  }
  if (blocksFailed) {
    notice += " \u00b7 🧱 BLOCKS not updated";
  }
  return notice;
}

// Follow a staged row to its live line (§15.6 step 1). A block id wins over
// the staged line number, so cache-only rows that carry no line text still
// resolve; a staged `rawLine` must match the live text. Returns null when
// the task changed since the stage opened, and the ref untouched when
// there is nothing to compare (the planner rejects it).
function relocateBlocksEditRef(ref, content) {
  if (!ref || typeof content !== "string") {
    return ref;
  }
  const lines = content.split(/\r?\n/);
  const blockId = normalizeBulletPropertyValue((ref && ref.blockId) || "");
  const line = Math.floor(numericOrDefault(ref.line, Number.NaN));
  const lineValid = Number.isFinite(line) && line >= 0 && line < lines.length;
  const rawLine = typeof ref.rawLine === "string" ? ref.rawLine : null;
  if (blockId) {
    const found = findTaskLineByTrailingBlockId(lines, blockId);
    if (found !== null) {
      if (rawLine !== null && String(lines[found] || "") !== rawLine) {
        return null;
      }
      return found === line ? ref : Object.freeze({ ...ref, line: found });
    }
    // A minted id is not on the line yet; a different id means it moved.
    if (lineValid && getTrailingBlockId(String(lines[line] || ""))) {
      return null;
    }
  }
  if (!lineValid) {
    return ref;
  }
  if (rawLine !== null && String(lines[line] || "") !== rawLine) {
    return null;
  }
  return ref;
}

// Re-check the stage guards at apply time on the trial graph after the whole
// batch (§15.5, §15.6 step 1), for rows the stage could not guard from
// content (closed notes under a warm Tasks cache). `files` must hold the
// live touched notes plus N's Depends-On closure and project ancestors.
function checkBlocksEditGuards(args = {}) {
  const files = args.files instanceof Map ? args.files : new Map();
  const add = Array.isArray(args.add) ? args.add : [];
  const remove = Array.isArray(args.remove) ? args.remove : [];
  const sources = [];
  for (const ref of Array.isArray(args.sources) ? args.sources : []) {
    const path = normalizeVaultRelativePath((ref && ref.path) || "");
    const row = blocksStageSourceFromLine(files.get(path), path, ref && ref.line);
    if (!row) {
      continue;
    }
    const blockId =
      row.blockId || normalizeBulletPropertyValue((ref && ref.blockId) || "") || null;
    sources.push(
      Object.freeze({
        ...row,
        blockId,
        key: blockId ? dependencyStageRowKey(path, blockId) : row.key,
      }),
    );
  }
  const notes = [...files].map(([path, content]) => ({ path, content }));
  const edges = collectDependencyStageEdges(notes, indexDependencyStageNotes(notes));
  const trial = new Map();
  for (const [from, targets] of edges) {
    trial.set(from, targets.slice());
  }
  const sourceKeys = sources.map((row) => row.key).filter(Boolean);
  const labelByKey = new Map();
  for (const row of sources) {
    labelByKey.set(row.key, row.displayText);
  }
  const candidateFor = (ref) => {
    const path = normalizeVaultRelativePath((ref && ref.path) || "");
    const content = files.get(path);
    const lineText =
      typeof content === "string"
        ? String(content.split(/\r?\n/)[ref.line] || "")
        : "";
    const blockId =
      normalizeBulletPropertyValue((ref && ref.blockId) || "") ||
      getTrailingBlockId(lineText) ||
      null;
    return Object.freeze({
      path,
      line: ref.line,
      blockId,
      displayText: cleanTaskDisplayText(lineText),
    });
  };
  const addCandidates = add.map(candidateFor);
  for (const candidate of remove.map(candidateFor)) {
    const key = blocksStageRowKey(candidate);
    if (key && trial.has(key)) {
      trial.set(key, trial.get(key).filter((to) => !sourceKeys.includes(to)));
    }
  }
  for (const candidate of addCandidates) {
    const key = blocksStageRowKey(candidate);
    if (!key) {
      continue;
    }
    labelByKey.set(key, candidate.displayText);
    const targets = trial.get(key) || [];
    for (const sourceKey of sourceKeys) {
      if (!targets.includes(sourceKey)) {
        targets.push(sourceKey);
      }
    }
    trial.set(key, targets);
    // A project T adds a resident -> N edge for every open resident (§13.10).
    const content = files.get(candidate.path);
    const residentKeys =
      typeof content === "string"
        ? projectDependentResidentKeys(content, candidate.path, candidate.line)
        : [];
    for (const residentKey of residentKeys) {
      const residentTargets = trial.get(residentKey) || [];
      for (const sourceKey of sourceKeys) {
        if (!residentTargets.includes(sourceKey)) {
          residentTargets.push(sourceKey);
        }
      }
      trial.set(residentKey, residentTargets);
    }
  }
  for (const candidate of addCandidates) {
    const verdict = blocksStageGuard(candidate, sources, trial, files, labelByKey);
    if (!verdict.disabled) {
      continue;
    }
    const labels = Array.isArray(verdict.cycleLabels) ? verdict.cycleLabels : [];
    const detail =
      verdict.reason === "would create a cycle" && labels.length > 1
        ? `${verdict.reason}: ${labels.join(" \u2192 ")}`
        : verdict.reason;
    return Object.freeze({
      ok: false,
      reason: "guard",
      notice: `🧱 Can't block ${quoteBlocksNoticeName(candidate.displayText)} \u00b7 ${detail}`,
    });
  }
  return Object.freeze({ ok: true, reason: null, notice: null });
}

function planBlocksMirrorForSource(args = {}) {
  const content = String(args.content || "");
  if (args.blocksLinesEnabled !== true) {
    return Object.freeze({
      ok: true,
      changed: false,
      nextContent: content,
    });
  }
  const sourcePath = normalizeVaultRelativePath(args.sourcePath || "");
  const sourceBlockId = normalizeBulletPropertyValue(args.sourceBlockId || "");
  const lines = content.split(/\r?\n/);
  const ownerLine = findTaskLineByTrailingBlockId(lines, sourceBlockId);
  if (!sourcePath || ownerLine === null) {
    return Object.freeze({
      ok: false,
      reason: "source-not-found",
      changed: false,
      nextContent: content,
    });
  }
  const vaultFiles = Array.isArray(args.vaultFiles)
    ? args.vaultFiles
    : [];
  const resolveLinkpath =
    typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const children = findBlocksChildren(lines, ownerLine);
  const parsed = children.map((index) =>
    parseBlocksLine(lines[index], { isDirectChildOfTask: true }),
  );
  if (parsed.some((entry) => entry.verdict === "malformed")) {
    return Object.freeze({
      ok: false,
      reason: "malformed-blocks-line",
      changed: false,
      nextContent: content,
    });
  }
  const existing = children.flatMap((index) =>
    blocksExistingRows(sourcePath, lines[index], resolveLinkpath, vaultFiles),
  );
  const add = [];
  for (const ref of Array.isArray(args.add) ? args.add : []) {
    const path = normalizeVaultRelativePath(ref && ref.path);
    const blockId = normalizeBulletPropertyValue(ref && ref.blockId);
    if (!path || !blockId) {
      continue;
    }
    add.push(
      Object.freeze({
        identity: blocksIdentity(path, blockId),
        link: canonicalDependencyLink({ path, blockId }, sourcePath, vaultFiles)
          .text,
      }),
    );
  }
  const remove = [];
  for (const ref of Array.isArray(args.remove) ? args.remove : []) {
    const path = normalizeVaultRelativePath(ref && ref.path);
    const blockId = normalizeBulletPropertyValue(ref && ref.blockId);
    if (!path || !blockId) {
      continue;
    }
    remove.push(blocksIdentity(path, blockId));
  }
  const desired = blocksDesiredAfterDelta(
    existing,
    (entry) => entry.identity || null,
    add,
    remove,
  );
  return planBlocksLineEdit(content, ownerLine, desired);
}

function planBlocksEdit(args = {}) {
  const fail = (reason) =>
    Object.freeze({
      ok: false,
      reason,
      changed: false,
      notice: null,
      sourceWrites: Object.freeze([]),
      dependentWrites: Object.freeze([]),
      preparations: Object.freeze([]),
      pomodoroTargets: Object.freeze([]),
    });
  const filesMap = new Map();
  const rawFiles = args.files;
  if (rawFiles instanceof Map) {
    for (const [filePath, fileContent] of rawFiles) {
      filesMap.set(normalizeVaultRelativePath(filePath), String(fileContent || ""));
    }
  } else if (rawFiles && typeof rawFiles === "object") {
    for (const filePath of Object.keys(rawFiles)) {
      filesMap.set(
        normalizeVaultRelativePath(filePath),
        String(rawFiles[filePath] || ""),
      );
    }
  }
  const resolveLinkpath =
    typeof args.resolveLinkpath === "function" ? args.resolveLinkpath : null;
  const vaultFiles = Array.isArray(args.vaultFiles)
    ? args.vaultFiles
        .map((entry) =>
          entry && typeof entry === "object" ? entry.path : entry,
        )
        .map((entry) => normalizeVaultRelativePath(entry))
        .filter(Boolean)
    : [...filesMap.keys()];
  const blocksLinesEnabled = args.blocksLinesEnabled === true;
  const stamper = typeof args.stamper === "function" ? args.stamper : null;
  const dateText = args.dateText;
  const recovery = args.recovery && typeof args.recovery === "object"
    ? args.recovery
    : null;
  const lanesByPath =
    args.projectLaneStatusesByPath instanceof Map
      ? args.projectLaneStatusesByPath
      : new Map();

  const sources = [];
  for (const ref of Array.isArray(args.sources) ? args.sources : []) {
    const resolved = resolveBlocksEditTaskRef(ref, filesMap);
    if (!resolved) {
      return fail("invalid-source");
    }
    if (!resolved.blockId) {
      return fail("source-id-missing");
    }
    sources.push(resolved);
  }
  if (sources.length === 0) {
    return fail("invalid-source");
  }
  const sourceRefs = sources.map((row) =>
    Object.freeze({ path: row.path, blockId: row.blockId }),
  );
  const sourceLineKeys = new Set(
    sources.map((row) => `${row.path}\x00${row.line}`),
  );
  const identityPreps = [];
  const planningFiles = new Map(filesMap);
  for (const source of sources) {
    let text = source.text;
    if (source.blockId && !getTrailingBlockId(text)) {
      text = appendBlockIdToLine(text, source.blockId);
    }
    const depValue = dependencyTargetId(text, source.path, source.blockId);
    if (depValue) {
      const field = findBulletPropertyField(text, "id");
      const existing = field
        ? normalizeBulletPropertyValue(field.value)
        : "";
      if (existing !== depValue) {
        text = upsertBulletProperty(text, "id", depValue).line;
      }
    }
    if (text === source.text) {
      continue;
    }
    const prep = Object.freeze({
      path: source.path,
      line: source.line,
      from: source.text,
      text,
      kind: "target-identity",
    });
    identityPreps.push(prep);
    planningFiles.set(
      source.path,
      applyStrongestLineEdits(planningFiles.get(source.path), [prep]),
    );
  }

  const addRows = [];
  for (const ref of Array.isArray(args.add) ? args.add : []) {
    const resolved = resolveBlocksEditTaskRef(ref, filesMap);
    if (!resolved) {
      return fail("invalid-target");
    }
    addRows.push(Object.freeze({ ...resolved, kind: "add" }));
  }
  const removeRows = [];
  for (const ref of Array.isArray(args.remove) ? args.remove : []) {
    const resolved = resolveBlocksEditTaskRef(ref, filesMap);
    if (!resolved) {
      return fail("invalid-target");
    }
    removeRows.push(Object.freeze({ ...resolved, kind: "remove" }));
  }
  if (addRows.length === 0 && removeRows.length === 0) {
    return Object.freeze({
      ok: true,
      reason: "unchanged",
      changed: false,
      notice: null,
      sourceWrites: Object.freeze([]),
      dependentWrites: Object.freeze([]),
      preparations: Object.freeze([]),
      pomodoroTargets: Object.freeze([]),
      sources: Object.freeze(sources),
      added: Object.freeze([]),
      removed: Object.freeze([]),
      takesLane: null,
    });
  }

  const byNote = new Map();
  const register = (row) => {
    if (!byNote.has(row.path)) {
      byNote.set(row.path, []);
    }
    byNote.get(row.path).push(row);
  };
  for (const row of addRows) {
    register(row);
  }
  for (const row of removeRows) {
    register(row);
  }

  const notePlans = [];
  const allPreparations = identityPreps.slice();
  const addedDrafts = [];
  const removedDrafts = [];
  let takesLane = null;
  const recordTakes = (promotions, tPath, trackedSources) => {
    for (const promo of Array.isArray(promotions) ? promotions : []) {
      const promoPath = normalizeVaultRelativePath(promo.path);
      // A source in the T's own note moves with the working copy; every
      // other note is planned from its unshifted original lines.
      const isSource =
        promoPath === tPath
          ? trackedSources.some((entry) => entry.line === promo.line)
          : sourceLineKeys.has(`${promoPath}\x00${promo.line}`);
      if (!isSource) {
        continue;
      }
      const status = getObsidianTaskCheckboxStatus(promo.to);
      if (status === "/") {
        takesLane = "/";
      } else if (status === "*" && takesLane !== "/") {
        takesLane = "*";
      }
    }
  };

  for (const [tPath, rows] of byNote) {
    const original = String(filesMap.get(tPath) || "");
    let working = String(planningFiles.get(tPath) || original);
    // Every row (planned or not) and every same-note source is followed
    // through each plan's line shifts, so a later plan never acts on a
    // stale index (a same-note prerequisite above can gain a BLOCKS line,
    // and an emptied one is deleted).
    const tracked = rows
      .map((row) => ({ row, line: row.line, plan: null }))
      .sort((first, second) => second.line - first.line);
    const trackedSources = sources
      .filter((row) => row.path === tPath)
      .map((row) => ({ line: row.line }));
    const noteEdits = [];
    const drafts = [];
    const lanes = lanesByPath.get(tPath);
    const noteRecovery = recovery
      ? { ...recovery, ...navNoteScopeFlags(tPath) }
      : null;
    for (const entry of tracked) {
      const row = entry.row;
      const planFiles = new Map(planningFiles);
      planFiles.set(tPath, working);
      const sourceIsPrj =
        Array.isArray(lanes) &&
        lanes.length > 0 &&
        isProjectLifecycleTaskLine(
          String(working.split(/\r?\n/)[entry.line] || ""),
        );
      const plan = planDependencyEdit({
        content: working,
        parentLine: entry.line,
        parentPath: tPath,
        add: row.kind === "add" ? sourceRefs : [],
        remove: row.kind === "remove" ? sourceRefs : [],
        files: planFiles,
        vaultFiles,
        resolveLinkpath,
        blocksLinesEnabled,
        ...(sourceIsPrj ? { projectLaneStatuses: lanes } : {}),
        recovery: noteRecovery,
      });
      if (!plan.ok) {
        return fail(plan.reason);
      }
      allPreparations.push(...(plan.preparations || []));
      recordTakes(plan.promotions, tPath, trackedSources);
      let nextWorking = plan.nextContent;
      if (plan.changed && stamper && Number.isInteger(plan.parentLineNext)) {
        nextWorking = stampBlocksEditParentLine(
          nextWorking,
          plan.parentLineNext,
          stamper,
          dateText,
        );
      }
      working = nextWorking;
      noteEdits.push(...(plan.lineEdits || []));
      for (const other of [...tracked, ...trackedSources]) {
        other.line = mapLineThroughLineEdits(other.line, plan.lineEdits);
        if (other.line === null) {
          return fail("not-task");
        }
      }
      entry.plan = plan;
      // Notices name T, never the prerequisite (N) the planner describes.
      const description = cleanTaskDisplayText(row.text);
      const fromStatus = getObsidianTaskCheckboxStatus(row.text);
      if (row.kind === "add" && plan.summary && plan.summary.added > 0) {
        const project = plan.summary.project;
        addedDrafts.push({
          entry,
          info: {
            path: tPath,
            description,
            fromStatus,
            isProject: Boolean(project),
            blockedCount: project
              ? (project.newlyBlocked || []).length + 1
              : 0,
            openRemaining: plan.summary.openRemaining,
          },
        });
        drafts.push(addedDrafts[addedDrafts.length - 1]);
      }
      if (row.kind === "remove" && plan.summary && plan.summary.removed > 0) {
        removedDrafts.push({
          entry,
          info: {
            path: tPath,
            description,
            recovered: plan.summary.recoveredOutcome === "ready",
          },
        });
        drafts.push(removedDrafts[removedDrafts.length - 1]);
      }
    }
    const finalLines = working.split(/\r?\n/);
    // The planner's final line and block id for each T: later stages
    // (mirror, committed refs) use these, never the pre-plan index.
    const tPlans = tracked
      .map((entry) => {
        const finalLine = entry.line;
        return Object.freeze({
          row: entry.row,
          plan: entry.plan,
          parentLine: finalLine,
          finalLine,
          blockId:
            getTrailingBlockId(String(finalLines[finalLine] || "")) ||
            entry.row.blockId ||
            "",
        });
      });
    for (const draft of drafts) {
      const finalLine = draft.entry.line;
      draft.info.line = finalLine;
      draft.info.blockId =
        getTrailingBlockId(String(finalLines[finalLine] || "")) ||
        draft.entry.row.blockId;
    }
    notePlans.push(
      Object.freeze({
        path: tPath,
        original,
        nextContent: working,
        lineEdits: Object.freeze(noteEdits),
        tPlans: Object.freeze(tPlans),
      }),
    );
  }
  const addedInfo = addedDrafts.map((draft) => Object.freeze(draft.info));
  const removedInfo = removedDrafts.map((draft) => Object.freeze(draft.info));

  const mergedPreparations = mergeTargetPreparations(allPreparations);
  const sourcePaths = [...new Set(sources.map((row) => row.path))];
  const sourcePathSet = new Set(sourcePaths);
  const noteByPath = new Map(notePlans.map((entry) => [entry.path, entry]));
  // A preparation is carried by the source or T note it names. Anything
  // else would be dropped, so the gesture refuses instead.
  for (const prep of mergedPreparations) {
    const prepPath = normalizeVaultRelativePath(prep.path);
    if (!sourcePathSet.has(prepPath) && !noteByPath.has(prepPath)) {
      return fail("unexpected-preparation");
    }
  }
  // Preparation lines are in the note's original coordinates; follow them
  // through that note's plan shifts, then keep the stronger lane per line.
  const withPreparations = (path, content, noteEdits) => {
    const preps = mergedPreparations
      .filter((prep) => normalizeVaultRelativePath(prep.path) === path)
      .map((prep) => ({
        ...prep,
        line: mapLineThroughLineEdits(prep.line, noteEdits),
      }))
      .filter((prep) => prep.line !== null);
    return applyStrongestLineEdits(content, preps);
  };
  const sourceWrites = [];
  for (const sourcePath of sourcePaths) {
    const original = String(filesMap.get(sourcePath) || "");
    const sameNote = noteByPath.get(sourcePath);
    sourceWrites.push(
      Object.freeze({
        path: sourcePath,
        original,
        nextContent: withPreparations(
          sourcePath,
          sameNote ? sameNote.nextContent : original,
          sameNote ? sameNote.lineEdits : [],
        ),
        foldedDependents: Boolean(sameNote),
      }),
    );
  }
  const dependentWrites = notePlans
    .filter((entry) => !sourcePathSet.has(entry.path))
    .map((entry) =>
      Object.freeze({
        path: entry.path,
        original: entry.original,
        nextContent: withPreparations(
          entry.path,
          entry.nextContent,
          entry.lineEdits,
        ),
        tPlans: entry.tPlans,
      }),
    );
  const pomodoroTargets = collectDependencyPlanPomodoroTargets(
    notePlans.flatMap((note) => note.tPlans.map((entry) => entry.plan)),
  );
  const sourceChanged = sourceWrites.some(
    (entry) => entry.nextContent !== entry.original,
  );
  const dependentChanged = dependentWrites.some(
    (entry) => entry.nextContent !== entry.original,
  );
  const changed = sourceChanged || dependentChanged;
  return Object.freeze({
    ok: true,
    reason: changed ? null : "unchanged",
    changed,
    notice: null,
    sourceWrites: Object.freeze(sourceWrites),
    dependentWrites: Object.freeze(dependentWrites),
    preparations: mergedPreparations,
    pomodoroTargets,
    sources: Object.freeze(sources),
    sourceRefs: Object.freeze(sourceRefs),
    added: Object.freeze(addedInfo),
    removed: Object.freeze(removedInfo),
    takesLane,
    notePlans: Object.freeze(notePlans),
    vaultFiles: Object.freeze(vaultFiles),
    blocksLinesEnabled,
  });
}
