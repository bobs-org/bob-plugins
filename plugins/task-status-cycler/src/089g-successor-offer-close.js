// Pure successor-card Done/Cancel descriptors and staged-choice normalization.
// The per-row consequences reuse the ordinary recover-only successor planner;
// this layer never reads the vault or writes an editor.

function successorOfferCloseEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  return Object.entries(value || {});
}

function successorOfferCloseNoteMap(value) {
  const notes = new Map();
  for (const [path, text] of successorOfferCloseEntries(value)) {
    if (typeof path === "string" && path && typeof text === "string") {
      notes.set(path, text);
    }
  }
  return notes;
}

function normalizeSuccessorCancelReason(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

// A malformed or conflicting close invalidates that row's whole choice. This
// prevents a duplicate Done/Cancel pair from silently selecting a destructive
// winner while preserving unrelated valid picks and closes.
function normalizeSuccessorChoices(result) {
  try {
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    const picks = [];
    const seenPicks = new Set();
    for (const pick of Array.isArray(result.picks) ? result.picks : []) {
      if (!pick || typeof pick !== "object") continue;
      const key = String(pick.key || "").trim();
      if (!key || seenPicks.has(key)) continue;
      seenPicks.add(key);
      const item = { key };
      const destination = normalizeSuccessorPickDestination(pick.destination);
      if (destination) item.destination = destination;
      picks.push(item);
    }
    const closesByKey = new Map();
    const invalidKeys = new Set();
    for (const close of Array.isArray(result.closes) ? result.closes : []) {
      if (!close || typeof close !== "object") continue;
      const key = typeof close.key === "string" ? close.key.trim() : "";
      if (!key) continue;
      const outcome = close.outcome;
      if (outcome !== "done" && outcome !== "cancelled") {
        invalidKeys.add(key);
        closesByKey.delete(key);
        continue;
      }
      let item = { key, outcome };
      if (outcome === "cancelled") {
        if (close.reason !== undefined && typeof close.reason !== "string") {
          invalidKeys.add(key);
          closesByKey.delete(key);
          continue;
        }
        const reason = normalizeSuccessorCancelReason(close.reason);
        if (reason) item.reason = reason;
      } else if (close.reason !== undefined &&
          (typeof close.reason !== "string" || normalizeSuccessorCancelReason(close.reason))) {
        invalidKeys.add(key);
        closesByKey.delete(key);
        continue;
      }
      if (invalidKeys.has(key)) continue;
      const previous = closesByKey.get(key);
      if (previous && (previous.outcome !== item.outcome || previous.reason !== item.reason)) {
        invalidKeys.add(key);
        closesByKey.delete(key);
        continue;
      }
      if (!previous) closesByKey.set(key, item);
    }
    const closes = [...closesByKey.values()];
    const closedKeys = new Set(closes.map((close) => close.key));
    const disjointPicks = picks.filter((pick) =>
      !closedKeys.has(pick.key) && !invalidKeys.has(pick.key),
    );
    if (disjointPicks.length === 0 && closes.length === 0) return null;
    return { picks: disjointPicks, closes };
  } catch (_error) {
    return null;
  }
}

function successorOfferCloseApplyEdits(noteTexts, edits) {
  const appliedPaths = new Set();
  let valid = true;
  for (const edit of Array.isArray(edits) ? edits : []) {
    if (!edit || typeof edit.path !== "string" || !Number.isInteger(edit.line) ||
        typeof edit.after !== "string") continue;
    const source = noteTexts.get(edit.path);
    if (typeof source !== "string") {
      valid = false;
      continue;
    }
    const lines = source.split(/\r?\n/);
    if (edit.line < 0 || edit.line >= lines.length ||
        (typeof edit.before === "string" && lines[edit.line] !== edit.before)) {
      valid = false;
      continue;
    }
    lines[edit.line] = edit.after;
    noteTexts.set(edit.path, lines.join("\n"));
    appliedPaths.add(edit.path);
  }
  return { appliedPaths, valid };
}

function successorOfferCloseTasksFromNotes(noteTexts) {
  const tasks = [];
  const seen = new Set();
  for (const [path, text] of noteTexts) {
    const parsed = tasksFromDocuments([{ path, text }]);
    const references = successorKeepMovingReferenceTasks(text, path);
    for (const task of [...parsed, ...references]) {
      const key = `${task.path}\0${task.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(task);
    }
  }
  return tasks;
}

// Snapshot once for all five offer groups. Planned predecessor recovery edits
// are overlaid before parsing, so every candidate simulation sees the same
// post-recovery dependency state and no candidate triggers a vault scan.
function createSuccessorOfferCloseContext(options = {}) {
  if (options && options.__successorOfferCloseContext === true) return options;
  const noteTexts = successorOfferCloseNoteMap(options.noteTexts || options.notes);
  const overlay = successorOfferCloseApplyEdits(
    noteTexts,
    options.plannedRecoveryEdits || options.recoveryEdits,
  );
  const suppliedTasks = Array.isArray(options.tasks) ? options.tasks : [];
  const retainedTasks = suppliedTasks.filter((task) =>
    task && !overlay.appliedPaths.has(String(task.path || "")),
  );
  const tasks = [...retainedTasks, ...successorOfferCloseTasksFromNotes(noteTexts)];
  const uniqueTasks = [];
  const seenTasks = new Set();
  for (const task of tasks) {
    const key = `${String(task && task.path || "")}\0${Number(task && task.line)}`;
    if (!task || seenTasks.has(key)) continue;
    seenTasks.add(key);
    uniqueTasks.push(task);
  }
  const dailyBefore = successorNormalizeLines(options.dailyBefore || []);
  const dailyAfter = successorNormalizeLines(
    options.dailyAfter === undefined ? dailyBefore : options.dailyAfter,
  );
  const context = {
    __successorOfferCloseContext: true,
    noteTexts,
    plannedRecoveryEdits: Object.freeze(Array.isArray(options.plannedRecoveryEdits || options.recoveryEdits)
      ? (options.plannedRecoveryEdits || options.recoveryEdits).map((edit) => Object.freeze({ ...edit }))
      : []),
    notePaths: Array.isArray(options.notePaths)
      ? options.notePaths.slice()
      : [...noteTexts.keys()],
    tasks: Object.freeze(uniqueTasks.map((task) => Object.freeze({ ...task }))),
    index: buildDependentsIndex(uniqueTasks),
    today: typeof options.today === "string" && options.today
      ? options.today
      : formatLocalDate(),
    dailyPath: typeof options.dailyPath === "string" ? options.dailyPath : "",
    dailyBefore: Object.freeze(dailyBefore),
    dailyAfter: Object.freeze(dailyAfter),
    dependencySnapshotAvailable: options.dependencySnapshotAvailable === true ||
      options.snapshotComplete === true,
    overlayValid: overlay.valid,
    markUnblockedLine: typeof options.markUnblockedLine === "function"
      ? options.markUnblockedLine
      : null,
    newTaskKeys: options.newTaskKeys instanceof Set
      ? new Set(options.newTaskKeys)
      : new Set(Array.isArray(options.newTaskKeys) ? options.newTaskKeys.map(String) : []),
    hasLiveLink: typeof options.hasLiveLink === "function" ? options.hasLiveLink : null,
    liveKeys: options.liveKeys instanceof Set ? new Set(options.liveKeys) : new Set(),
  };
  return Object.freeze(context);
}

function successorOfferCloseSupport(capabilities = {}) {
  const successors = capabilities.successors || capabilities.successorApi || null;
  const cancel = capabilities.cancel || capabilities.cancelApi || null;
  return !!(
    successors && Number(successors.version) >= 4 && typeof successors.pick === "function" &&
    cancel && Number(cancel.version) >= 1 && typeof cancel.planCancel === "function" &&
    typeof (capabilities.completeTaskLineText || capabilities.completeTaskLine) === "function" &&
    typeof (capabilities.applyOfferClosesNow || capabilities.applyOfferCloses) === "function"
  );
}

function isSuccessorOfferCloseSupported(capabilities) {
  return successorOfferCloseSupport(capabilities);
}

function successorOfferCloseCapabilities(capabilities = {}) {
  return {
    successors: capabilities.successors || capabilities.successorApi || null,
    cancel: capabilities.cancel || capabilities.cancelApi || null,
    completeTaskLineText: capabilities.completeTaskLineText || capabilities.completeTaskLine || null,
  };
}

function successorOfferCloseTaskSource(offer, context) {
  const task = offer && offer.task && typeof offer.task === "object" ? offer.task : null;
  const path = String(task && task.path || offer && offer.notePath || "");
  const line = Number.isInteger(task && task.line)
    ? task.line
    : Number.isInteger(offer && offer.line) ? offer.line : -1;
  const noteText = context.noteTexts.get(path) ??
    (offer && typeof offer.noteText === "string" ? offer.noteText : null);
  if (!path || line < 0 || typeof noteText !== "string") {
    return { refusal: "changed_identity" };
  }
  const lines = noteText.split(/\r?\n/);
  const cardPreimage = task && typeof task.rawLine === "string"
    ? task.rawLine
    : task && typeof task.lineText === "string" ? task.lineText
      : task && typeof task.text === "string" && TASK_LINE_RE.test(task.text) ? task.text
        : null;
  const currentLine = lines[line];
  let preimage = cardPreimage;
  if (preimage !== null && currentLine !== preimage) {
    const recovery = context.plannedRecoveryEdits.find((edit) => edit &&
      String(edit.path || "") === path && Number(edit.line) === line &&
      edit.before === cardPreimage && edit.after === currentLine,
    );
    if (recovery) preimage = currentLine;
  }
  if (preimage === null || currentLine !== preimage) {
    return { refusal: "changed_identity" };
  }
  const parsed = context.tasks.find((candidate) =>
    candidate && String(candidate.path || "") === path && Number(candidate.line) === line,
  );
  if (!parsed || String(parsed.rawLine || parsed.lineText || "") !== preimage) {
    return { refusal: "changed_identity" };
  }
  const status = getTaskStatusForLine(preimage, line);
  if (!status) return { refusal: "changed_identity" };
  const blockId = parsed.blockId || getTrailingBlockId(preimage) || null;
  const key = String(offer.key || "");
  if (blockId) {
    if (key !== `${path}#^${blockId}`) return { refusal: "changed_identity" };
  } else {
    const identityTask = { ...parsed, rawLine: preimage, blockId: null };
    const table = buildSuccessorNoteDigestTable(context.noteTexts);
    const identity = assignSuccessorOfferKeys([identityTask], table).get(identityTask);
    if (!identity || key !== identity) return { refusal: "changed_identity" };
  }
  return {
    path,
    line,
    noteText,
    preimage,
    status: status.symbol,
    task: { ...parsed, path, line, blockId, rawLine: preimage, text: preimage },
  };
}

function successorOfferCloseWriterAccepts(line, source, context, capabilities) {
  const writers = successorOfferCloseCapabilities(capabilities);
  const completeTaskLineText = writers.completeTaskLineText;
  if (typeof completeTaskLineText !== "function" || !writers.cancel ||
      typeof writers.cancel.planCancel !== "function") return false;
  try {
    const complete = completeTaskLineText(line, { date: context.today });
    if (!complete || complete.ok !== true || complete.unchanged === true ||
        typeof complete.lineText !== "string") return false;
    const cancel = writers.cancel.planCancel(
      source.noteText,
      [{ line: source.line, rawLine: line }],
      { date: context.today, reason: "" },
    );
    return !!(cancel && cancel.valid === true && typeof cancel.content === "string");
  } catch (_error) {
    return false;
  }
}

function successorOfferCloseSimulate(task, context) {
  if (!context.dependencySnapshotAvailable || !context.overlayValid) {
    return { unblocks: 0, suffix: "" };
  }
  try {
    const plan = planSuccessors({
      closed: [{
        path: task.path,
        blockId: task.blockId || "",
        taskId: task.taskId || "",
        text: successorDisplayText(task, task.globalFilter || "#task"),
      }],
      index: context.index,
      dailyBefore: context.dailyBefore,
      dailyAfter: context.dailyAfter,
      dailyPath: context.dailyPath,
      today: context.today,
      markUnblockedLine: context.markUnblockedLine,
      selection: [],
      linkUnblocked: false,
      cancelled: true,
      keepMoving: false,
      dependencySnapshotAvailable: context.dependencySnapshotAvailable,
      noteTexts: context.noteTexts,
      notePaths: context.notePaths,
    });
    const rows = successorOfferCloseUniqueRows(plan && plan.unblocked);
    return {
      unblocks: rows.length,
      suffix: successorOfferCloseRecoverySuffix(rows, plan && plan.edits, context.today),
    };
  } catch (_error) {
    return { unblocks: 0, suffix: "" };
  }
}

function successorOfferCloseUniqueRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const path = String(row.note_path || row.path || "");
    const blockId = String(row.block_id || row.blockId || "");
    const line = Number.isInteger(row.line) ? row.line : -1;
    const key = `${path}\0${blockId || `line:${line}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function successorOfferCloseRecoverySuffix(rows, edits, today) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  if (rows.length === 1) {
    const row = rows[0];
    const blockId = String(row.block_id || row.blockId || "");
    const text = cleanDescription(String(row.text || ""), "#task", blockId || null);
    let suffix = ` · unblocks “${text}”`;
    if (successorOfferCloseRowsStamped(rows, edits, today) === rows.length) {
      suffix += " · back tomorrow as a tickler";
    }
    return suffix;
  }
  let suffix = ` · unblocks ${rows.length} tasks`;
  if (successorOfferCloseRowsStamped(rows, edits, today) === rows.length) {
    suffix += " · back tomorrow as ticklers";
  }
  return suffix;
}

function successorOfferCloseRowsStamped(rows, edits, today) {
  const date = String(today || "");
  if (!date) return 0;
  const writes = Array.isArray(edits) ? edits : [];
  let count = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const path = String(row.note_path || row.path || "");
    const line = Number(row.line);
    const edit = writes.find((candidate) => candidate &&
      String(candidate.path || "") === path && Number(candidate.line) === line,
    );
    if (edit && typeof edit.after === "string" &&
        edit.after.includes(`[unblocked:: ${date}]`)) count += 1;
  }
  return count;
}

// Returns descriptors keyed by the existing offer identity. Muted rows have
// no slot; every other refusal keeps machine classification separate from its
// canonical human `why` sentence.
function buildSuccessorOfferCloseDescriptors(offers, inputContext = {}, capabilities = {}) {
  const offerNotes = successorOfferCloseNoteMap(
    inputContext.noteTexts || inputContext.notes,
  );
  for (const offer of Array.isArray(offers) ? offers : []) {
    const path = String(offer && offer.task && offer.task.path || offer && offer.notePath || "");
    if (path && !offerNotes.has(path) && typeof offer.noteText === "string") {
      offerNotes.set(path, offer.noteText);
    }
  }
  const context = createSuccessorOfferCloseContext({
    ...inputContext,
    noteTexts: offerNotes,
  });
  const descriptors = new Map();
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (!offer || typeof offer.key !== "string" || !offer.key ||
        offer.selectable === false || offer.muted === true) continue;
    const key = offer.key;
    const source = successorOfferCloseTaskSource(offer, context);
    const display = source.refusal
      ? successorOfferCloseDisplayFromOffer(offer)
      : successorOfferCloseTaskDisplay(source.task);
    let refusal = null;
    if (offer.isNewTask === true || offer.newlyCreated === true ||
        (offer.task && (offer.task.isNewTask === true || offer.task.newlyCreated === true)) ||
        context.newTaskKeys.has(key)) {
      refusal = "new_task";
    } else refusal = source.refusal || null;
    if (!refusal && isRecurringTaskLine(source.preimage)) refusal = "recurring";
    if (!refusal && ![" ", "/", "*", "?"].includes(source.status)) refusal = "status";
    if (!refusal && source.status === "?" && !context.dependencySnapshotAvailable) refusal = "status";
    if (!refusal) {
      const live = context.liveKeys.has(key) || offer.liveLink === true ||
        (context.hasLiveLink && context.hasLiveLink(source.task) === true);
      if (live) refusal = "changed_identity";
    }
    if (!refusal && !successorOfferCloseWriterAccepts(source.preimage, source, context, capabilities)) {
      refusal = "status";
    }
    if (refusal) {
      if (refusal === "muted") continue;
      descriptors.set(key, successorOfferCloseRefusalDescriptor(refusal, display, source.status));
      continue;
    }
    const simulation = successorOfferCloseSimulate(source.task, context);
    const copy = successorOfferCloseConsequences(
      source.task,
      offer.group,
      { ...simulation, context },
    );
    descriptors.set(key, {
      complete: true,
      cancel: true,
      completeConsequence: copy.complete,
      cancelConsequence: copy.cancel,
      ...(copy.scopeNote ? { scopeNote: copy.scopeNote } : {}),
      unblocks: simulation.unblocks,
    });
  }
  return descriptors;
}

function successorOfferCloseDescriptorFor(descriptors, key) {
  if (descriptors instanceof Map) return descriptors.get(String(key)) || null;
  const value = descriptors && typeof descriptors === "object" ? descriptors[String(key)] : null;
  return value && typeof value === "object" ? value : null;
}

// V4 support is attached only after the cycler's internal apply path exists.
// Clone groups/rows so the pure enrichment helper never mutates its input.
function enrichSuccessorPickerModelWithOfferCloses(model, descriptors, capabilities) {
  if (!model || typeof model !== "object" || !isSuccessorOfferCloseSupported(capabilities)) {
    return model;
  }
  const groups = (Array.isArray(model.groups) ? model.groups : []).map((group) => ({
    ...group,
    rows: (Array.isArray(group && group.rows) ? group.rows : []).map((row) => {
      const descriptor = row && row.selectable === true
        ? successorOfferCloseDescriptorFor(descriptors, row.key)
        : null;
      return descriptor ? { ...row, close: { ...descriptor } } : { ...row };
    }),
  }));
  return { ...model, close: { supported: true }, groups };
}
