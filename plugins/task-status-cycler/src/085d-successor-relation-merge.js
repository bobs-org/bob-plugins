// Relation merge helpers for the pure successor pipeline
// (docs/task-dependencies.md §12.18, §12.2). Shared scope with
// 085-successor-plan.js / 089b-successor-verdicts.js. Pure code only.
// Moved display helpers live here so 085 stays under the 1000-line cap.

function successorHasHideTag(rawLine) {
  return String(rawLine || "")
    .split(/\s+/)
    .some((token) => token === "#hide");
}

function successorIsProjectTask(blockId) {
  return typeof blockId === "string" && blockId.toLowerCase() === "prj";
}

function successorIsDonePath(path) {
  return isDoneArchivePath(path);
}

// Row display text: the mint-pipeline cleaning of the body after the status
// box (mirroring Rust's `clean_description` row text).
function successorDisplayText(task, globalFilter = "#task") {
  if (!task) {
    return "";
  }
  const filter = globalFilter === "#task" && task.globalFilter
    ? task.globalFilter
    : globalFilter;
  const rawLine = task.rawLine || task.lineText;
  if (rawLine) {
    return cleanDescription(
      successorBodyAfterStatusBox(rawLine),
      filter,
      task.blockId || null,
    );
  }
  return String(task.text || "");
}

function collectSuccessorUsedIds(noteText) {
  const used = new Set();
  for (const line of successorNormalizeLines(noteText)) {
    const id = getTrailingBlockId(line);
    if (id) {
      used.add(String(id));
    }
  }
  return used;
}

// Whether the caller supplied any relation inputs for the pure pipeline.
// Runtime (137) stays dormant: without these options no relation fields
// are emitted and disabled gestures stay unchanged.
function successorRelationHasInputs(options = {}) {
  return options.relationEvents !== undefined ||
    options.relationCandidates !== undefined ||
    options.relationOutgoing !== undefined ||
    options.relationSuccessorLabels !== undefined ||
    options.relationIndexReady !== undefined ||
    options.navSuccessorsVersion !== undefined ||
    options.relationBaselineLive !== undefined ||
    options.relationCurrentLive !== undefined ||
    options.relationParkedIdentities !== undefined;
}

function successorRelationLabelsFromOptions(options = {}) {
  const supplied = options.relationSuccessorLabels;
  if (supplied && typeof supplied === "object" && Array.isArray(supplied.keys)) {
    const labels = supplied.labels && typeof supplied.labels === "object" ? supplied.labels : {};
    const keys = supplied.keys.map((key) => relationLabelKey(key)).filter(Boolean);
    const seen = new Set();
    const ordered = [];
    const table = {};
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(key);
      table[key] = labels[key] || key;
    }
    return Object.freeze({ keys: Object.freeze(ordered), labels: Object.freeze({ ...table }) });
  }
  if (Array.isArray(supplied)) {
    const labels = {};
    const keys = [];
    for (const entry of supplied) {
      const normalized = typeof normalizeRelationLabel === "function"
        ? normalizeRelationLabel(entry)
        : String(entry || "").trim();
      if (!normalized) continue;
      const key = relationLabelKey(normalized);
      if (!key || keys.includes(key)) continue;
      keys.push(key);
      labels[key] = normalized;
    }
    return Object.freeze({ keys: Object.freeze(keys), labels: Object.freeze({ ...labels }) });
  }
  return emptyRelationLabelList();
}

// Build the classifier's recoveries map from the post-recovery pipeline
// state (recovers + stillBlocked). Keys are relation identities so the
// pure R1-R7 rule sees the effective post-recovery state while the write
// guard keeps exact preimage lines from noteTexts.
function buildSuccessorRelationRecoveries(recovers, successorMarks, stillBlocked, context = {}) {
  const table = {};
  const currentLive = relationLiveIdentitySet(context.dailyAfter, context.dailyPath || "");
  for (const recover of Array.isArray(recovers) ? recovers : []) {
    const task = recover && recover.task;
    if (!task || !task.path) continue;
    const key = relationIdentityKey(task.path, task.blockId, task.line);
    if (!key) continue;
    if (!table[key]) table[key] = {};
    table[key].recovered = true;
    if (task.status === "?") {
      table[key].effectiveStatus = recover.raiseToNext === true || currentLive.has(key)
        ? "*"
        : " ";
    }
    if (recover.foldedProject) table[key].project = String(recover.foldedProject);
  }
  // A hand-off/project mark is also a real recovery: an unpicked offer still
  // releases the blocked task to its post-close lane. Feed that effective
  // status to R4 so a relation reason can merge without causing recovery.
  for (const mark of Array.isArray(successorMarks) ? successorMarks : []) {
    const task = mark && mark.task;
    if (!task || !task.path || task.status !== "?") continue;
    const key = relationIdentityKey(task.path, task.blockId, task.line);
    if (!key) continue;
    if (!table[key]) table[key] = {};
    table[key].recovered = true;
    table[key].effectiveStatus = currentLive.has(key) ? "*" : " ";
  }
  for (const row of Array.isArray(stillBlocked) ? stillBlocked : []) {
    if (!row || !row.note_path) continue;
    const key = relationIdentityKey(row.note_path, row.block_id, row.line);
    if (!key) continue;
    const entry = table[key] || {};
    if (row.reason === "project") {
      entry.projectBlocked = true;
      if (row.project) entry.project = String(row.project);
    }
    if (row.reason === "waits_on") entry.openPrerequisites = Number(row.waits_on) || 0;
    if (row.scheduled) entry.scheduled = String(row.scheduled);
    table[key] = entry;
  }
  return table;
}

// Run the pure R1-R7 classifier for the merged pipeline. Returns the
// classifier result (marks/held/groups/relation_check/scan/warnings) or
// an empty non-scanning result when the gate is off.
function planSuccessorRelationForContext(context = {}) {
  const options = context.options || {};
  const recovers = context.recovers || [];
  const successorMarks = context.successorMarks || [];
  const stillBlocked = context.stillBlocked || [];
  const successorLabels = successorRelationLabelsFromOptions(options);
  const events = Array.isArray(options.relationEvents) ? options.relationEvents : [];
  const candidates = Array.isArray(options.relationCandidates) ? options.relationCandidates : [];
  const outgoing = Array.isArray(options.relationOutgoing)
    ? options.relationOutgoing
    : candidates;
  if (typeof planSuccessorRelations !== "function") {
    return { marks: [], held: [], groups: [], relation_check: null, scan: false, warnings: [] };
  }
  const recoveries = {
    ...buildSuccessorRelationRecoveries(recovers, successorMarks, stillBlocked, {
      dailyAfter: context.dailyAfter,
      dailyPath: context.dailyPath,
    }),
    ...((options.relationRecoveries && typeof options.relationRecoveries === "object")
      ? options.relationRecoveries
      : {}),
  };
  try {
    return planSuccessorRelations({
      events,
      candidates,
      outgoing,
      noteTexts: context.noteTexts || {},
      baselineDay: context.dailyBefore,
      currentDay: context.dailyAfter,
      dailyPath: context.dailyPath || "",
      today: context.today || "",
      previousDailyPath: options.relationPreviousDailyPath,
      successorLabels,
      linkUnblocked: context.linkUnblocked !== false,
      cancelled: context.cancelled === true,
      navSuccessorsVersion: options.navSuccessorsVersion,
      relationIndexReady: options.relationIndexReady,
      dependencySnapshotAvailable: options.dependencySnapshotAvailable,
      dependencyTasks: Array.isArray(context.dependencyTasks) ? context.dependencyTasks : [],
      closedTaskIds: Array.isArray(context.closedTaskIds) ? context.closedTaskIds : [],
      recoveries,
      parkedIdentities: options.relationParkedIdentities,
      baselineLive: options.relationBaselineLive,
      currentLive: options.relationCurrentLive,
    });
  } catch (_error) {
    return { marks: [], held: [], groups: [], relation_check: null, scan: false, warnings: [] };
  }
}
