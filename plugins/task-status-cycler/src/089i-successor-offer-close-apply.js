const OFFER_CLOSE_FALLBACK_REASON = "🤷 no reason given";
const OFFER_CLOSE_OPEN_SYMBOLS = [" ", "/", "*", "?"];
function successorOfferCloseMapEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  return Object.entries(value || {});
}
function successorOfferCloseCoerceNoteMap(value) {
  if (value instanceof Map) {
    const out = new Map();
    for (const [path, text] of value) {
      if (typeof path === "string" && path && typeof text === "string") out.set(path, text);
    }
    return out;
  }
  return successorOfferCloseNoteMap(value);
}
function successorOfferCloseLineEnding(text) {
  return String(text || "").includes("\r\n") ? "\r\n" : "\n";
}
function successorOfferCloseDisplayForApply(offer, task) {
  try {
    if (task) return successorOfferCloseTaskDisplay(task);
  } catch (_error) {}
  return successorOfferCloseDisplayFromOffer(offer || {});
}
function successorOfferCloseOffersByKey(offers) {
  const byKey = new Map();
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (offer && typeof offer.key === "string" && offer.key && !byKey.has(offer.key)) {
      byKey.set(offer.key, offer);
    }
  }
  return byKey;
}

function successorOfferCloseExpectedMap(value) {
  const out = new Map();
  for (const [key, line] of successorOfferCloseMapEntries(value)) {
    if (typeof key === "string" && key && typeof line === "string") out.set(key, line);
  }
  return out;
}

function successorOfferCloseOfferPath(offer) {
  const task = offer && offer.task && typeof offer.task === "object" ? offer.task : null;
  const path = String((task && task.path) || (offer && offer.notePath) || "");
  const line = Number.isInteger(task && task.line)
    ? task.line
    : Number.isInteger(offer && offer.line)
      ? offer.line
      : -1;
  return { path, line, task };
}

// Validate one close against the line the pick pass was expected to leave:
// its verified successful postimage when that pass edited the row, otherwise
// the card preimage. Never accept an arbitrary freshly read line.
function successorOfferCloseValidateApplyRow(close, offer, expected, noteTexts, context, capabilities) {
  const key = String(close && close.key || "");
  const outcome = close && close.outcome;
  if (!key || (outcome !== "done" && outcome !== "cancelled")) {
    return { valid: false, key, outcome, refusal: "changed_identity", display: key || "task", status: " " };
  }
  if (!offer || typeof offer !== "object") {
    return { valid: false, key, outcome, refusal: "changed_identity", display: key, status: " " };
  }
  if (offer.selectable === false || offer.muted === true) {
    return { valid: false, key, outcome, refusal: "changed_identity", display: successorOfferCloseDisplayForApply(offer, null), status: " " };
  }
  const { path, line } = successorOfferCloseOfferPath(offer);
  const displayFallback = successorOfferCloseDisplayForApply(offer, null);
  if (!path || !Number.isInteger(line) || line < 0) {
    return { valid: false, key, outcome, refusal: "changed_identity", display: displayFallback, status: " " };
  }
  const noteText = noteTexts instanceof Map ? noteTexts.get(path) : null;
  if (typeof noteText !== "string") {
    return { valid: false, key, outcome, refusal: "changed_identity", display: displayFallback, status: " " };
  }
  const lines = String(noteText).split(/\r?\n/);
  if (line < 0 || line >= lines.length) {
    return { valid: false, key, outcome, refusal: "changed_identity", display: displayFallback, status: " " };
  }
  const expectedLine = typeof expected === "string"
    ? expected
    : (offer.task && typeof offer.task.rawLine === "string" ? offer.task.rawLine : null);
  if (typeof expectedLine !== "string") {
    return { valid: false, key, outcome, refusal: "changed_identity", display: displayFallback, status: " " };
  }
  const current = lines[line];
  if (current !== expectedLine) {
    const status = (getTaskStatusForLine(expectedLine, line) || {}).symbol || " ";
    return { valid: false, key, outcome, refusal: "changed_identity", display: successorOfferCloseDisplayForApply(offer, null), status };
  }
  const parsed = parseTaskDependencyLine(current, path, line);
  if (!parsed) {
    return { valid: false, key, outcome, refusal: "changed_identity", display: displayFallback, status: " " };
  }
  const statusSymbol = String(parsed.status || " ");
  const task = {
    path,
    line,
    status: statusSymbol,
    blockId: parsed.blockId || getTrailingBlockId(current) || null,
    taskId: parsed.taskId || null,
    dependsOn: Array.isArray(parsed.dependsOn) ? parsed.dependsOn.slice() : [],
    text: current,
    rawLine: current,
    globalFilter: (offer.task && offer.task.globalFilter) || "#task",
  };
  const display = successorOfferCloseDisplayForApply(offer, task);
  // New-task guard first, matching descriptors.
  const newKeys = context && context.newTaskKeys instanceof Set ? context.newTaskKeys : new Set();
  if (offer.isNewTask === true || offer.newlyCreated === true ||
      (offer.task && (offer.task.isNewTask === true || offer.task.newlyCreated === true)) ||
      newKeys.has(key)) {
    return { valid: false, key, outcome, refusal: "new_task", display, status: statusSymbol };
  }
  if (isRecurringTaskLine(current)) {
    return { valid: false, key, outcome, refusal: "recurring", display, status: statusSymbol };
  }
  if (!OFFER_CLOSE_OPEN_SYMBOLS.includes(statusSymbol)) {
    return { valid: false, key, outcome, refusal: "status", display, status: statusSymbol };
  }
  if (statusSymbol === "?" && context && context.dependencySnapshotAvailable !== true) {
    return { valid: false, key, outcome, refusal: "status", display, status: statusSymbol };
  }
  const liveKeys = context && context.liveKeys instanceof Set ? context.liveKeys : new Set();
  let live = liveKeys.has(key) || offer.liveLink === true;
  if (!live && context && typeof context.hasLiveLink === "function") {
    try {
      live = context.hasLiveLink(task) === true;
    } catch (_error) {
      live = false;
    }
  }
  if (live) {
    return { valid: false, key, outcome, refusal: "changed_identity", display, status: statusSymbol };
  }
  // Identity: block ID must still name this line; ID-less keys must still
  // resolve to this line and must not have become ambiguous.
  try {
    if (task.blockId) {
      if (key !== `${path}#^${task.blockId}`) {
        return { valid: false, key, outcome, refusal: "changed_identity", display, status: statusSymbol };
      }
    } else {
      const table = buildSuccessorNoteDigestTable(noteTexts);
      const probe = { ...task, rawLine: current, blockId: null };
      const assigned = assignSuccessorOfferKeys([probe], table).get(probe);
      if (!assigned || assigned !== key) {
        return { valid: false, key, outcome, refusal: "changed_identity", display, status: statusSymbol };
      }
    }
  } catch (_error) {
    return { valid: false, key, outcome, refusal: "changed_identity", display, status: statusSymbol };
  }
  // Writer eligibility: the engine's own verdict writers must accept the line.
  try {
    const writers = successorOfferCloseCapabilities(capabilities || {});
    const completeFn = writers.completeTaskLineText;
    const cancelApi = writers.cancel;
    if (typeof completeFn !== "function" || !cancelApi || typeof cancelApi.planCancel !== "function") {
      return { valid: false, key, outcome, refusal: "status", display, status: statusSymbol };
    }
    const complete = completeFn(current, { date: (context && context.today) || formatLocalDate() });
    if (!complete || complete.ok !== true || complete.unchanged === true || typeof complete.lineText !== "string") {
      return { valid: false, key, outcome, refusal: "status", display, status: statusSymbol };
    }
    const cancel = cancelApi.planCancel(noteText, [{ line, rawLine: current }], {
      date: (context && context.today) || formatLocalDate(),
      reason: "",
    });
    if (!cancel || cancel.valid !== true || typeof cancel.content !== "string") {
      return { valid: false, key, outcome, refusal: "status", display, status: statusSymbol };
    }
  } catch (_error) {
    return { valid: false, key, outcome, refusal: "status", display, status: statusSymbol };
  }
  return { valid: true, key, outcome, path, line, expected: expectedLine, current, task, display, status: statusSymbol };
}

function successorOfferCloseCancelLogOutcome(singleResult) {
  if (!singleResult || singleResult.valid !== true) return "none";
  if (Number(singleResult.loggedCount || 0) <= 0) return "none";
  if (Number(singleResult.fallbackLoggedCount || 0) > 0) return "fallback";
  if (Number(singleResult.createdLogCount || 0) > 0) return "created";
  return "written";
}

// Pure root planning: per-row stale refusal, same-note Done/Cancel batching
// with Cancel Log insertions shifting later rows. Descending application
// keeps earlier line numbers stable; a stale row never blocks its neighbours.
function planOfferCloseRoots(options = {}) {
  const noteTexts = successorOfferCloseCoerceNoteMap(options.noteTexts || options.notes);
  const closes = Array.isArray(options.closes) ? options.closes : [];
  const expectedLines = successorOfferCloseExpectedMap(options.expectedLines || options.expected);
  const offersByKey = options.offersByKey instanceof Map
    ? options.offersByKey
    : successorOfferCloseOffersByKey(options.offers || []);
  const context = options.context && typeof options.context === "object" ? options.context : {};
  const capabilities = options.capabilities || {};
  const today = typeof context.today === "string" && context.today ? context.today : formatLocalDate();
  const completeFn = (capabilities.completeTaskLineText || capabilities.completeTaskLine) || null;
  const cancelApi = capabilities.cancel || capabilities.cancelApi || null;
  const planCancel = cancelApi && typeof cancelApi.planCancel === "function" ? cancelApi.planCancel.bind(cancelApi) : null;

  const refused = [];
  const validRows = [];
  for (const close of closes) {
    const key = String(close && close.key || "");
    const offer = offersByKey.get(key) || null;
    const expected = expectedLines.has(key) ? expectedLines.get(key) : null;
    const checked = successorOfferCloseValidateApplyRow(close, offer, expected, noteTexts, context, capabilities);
    if (!checked.valid) {
      const why = successorOfferCloseRefusalDescriptor(checked.refusal, checked.display, checked.status).why;
      refused.push({ key, outcome: close && close.outcome, text: checked.display, why });
      continue;
    }
    validRows.push({
      key,
      outcome: checked.outcome,
      reason: checked.outcome === "cancelled" ? normalizeSuccessorCancelReason(close && close.reason) : "",
      path: checked.path,
      line: checked.line,
      expected: checked.expected,
      display: checked.display,
      status: checked.status,
      task: checked.task,
      offer,
    });
  }

  const byPath = new Map();
  for (const row of validRows) {
    if (!byPath.has(row.path)) byPath.set(row.path, []);
    byPath.get(row.path).push(row);
  }

  const planned = [];
  const intermediates = new Map();
  for (const [path, rows] of byPath) {
    const before = noteTexts.get(path);
    if (typeof before !== "string") {
      for (const row of rows) {
        refused.push({ key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("changed_identity", row.display, row.status).why });
      }
      continue;
    }
    const ending = successorOfferCloseLineEnding(before);
    let currentLines = String(before).split(/\r?\n/);
    const ordered = rows.slice().sort((a, b) => b.line - a.line);
    const pathPlanned = [];
    let pathFailed = false;
    for (const row of ordered) {
      if (row.line < 0 || row.line >= currentLines.length || currentLines[row.line] !== row.expected) {
        refused.push({ key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("changed_identity", row.display, row.status).why });
        continue;
      }
      if (row.outcome === "done") {
        if (typeof completeFn !== "function") {
          refused.push({ key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("status", row.display, row.status).why });
          continue;
        }
        let result = null;
        try {
          result = completeFn(currentLines[row.line], { date: today });
        } catch (_error) {
          result = null;
        }
        if (!result || result.ok !== true || result.unchanged === true || typeof result.lineText !== "string") {
          refused.push({ key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("status", row.display, row.status).why });
          continue;
        }
        const afterLine = result.lineText;
        currentLines[row.line] = afterLine;
        pathPlanned.push({ ...row, beforeLine: row.expected, afterLine, logOutcome: "none" });
      } else {
        if (typeof planCancel !== "function") {
          refused.push({ key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("status", row.display, row.status).why });
          continue;
        }
        const currentText = currentLines.join(ending);
        let result = null;
        try {
          result = planCancel(currentText, [{ line: row.line, rawLine: currentLines[row.line] }], {
            date: today,
            reason: row.reason || "",
            fallbackReason: OFFER_CLOSE_FALLBACK_REASON,
          });
        } catch (_error) {
          result = null;
        }
        if (!result || result.valid !== true || typeof result.content !== "string") {
          const stale = result && result.stale === true;
          refused.push({
            key: row.key,
            outcome: row.outcome,
            text: row.display,
            why: successorOfferCloseRefusalDescriptor(stale ? "changed_identity" : "status", row.display, row.status).why,
          });
          continue;
        }
        const nextLines = String(result.content).split(/\r?\n/);
        // The task line stays at its index; log insertions land below it.
        const afterLine = nextLines[row.line] != null ? nextLines[row.line] : currentLines[row.line];
        currentLines = nextLines;
        pathPlanned.push({ ...row, beforeLine: row.expected, afterLine, logOutcome: successorOfferCloseCancelLogOutcome(result), cancelResult: result });
      }
    }
    if (pathPlanned.length === 0) {
      pathFailed = true;
    }
    if (!pathFailed) {
      const after = currentLines.join(ending);
      intermediates.set(path, { before, after });
      for (const entry of pathPlanned) planned.push(entry);
    } else if (pathPlanned.length > 0) {
      const after = currentLines.join(ending);
      intermediates.set(path, { before, after });
      for (const entry of pathPlanned) planned.push(entry);
    }
  }

  // Deterministic order: sort planned by path then line for stable receipts.
  planned.sort((a, b) => String(a.path).localeCompare(String(b.path)) || a.line - b.line);
  refused.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return { planned, refused, intermediates };
}

// Recover-only cascade over the actual joint closed set. No picker, no
// relation offers, no keep-moving, no linking, no ID minting. Uses the
// current rewriteRecoveredTaskLine and dependency rules; never a second
// offer round.
function planOfferCloseRecovery(options = {}) {
  const freshNoteTexts = successorOfferCloseCoerceNoteMap(options.noteTexts);
  const planned = Array.isArray(options.planned) ? options.planned : [];
  const context = options.context && typeof options.context === "object" ? options.context : {};
  const today = typeof context.today === "string" && context.today ? context.today : formatLocalDate();
  if (planned.length === 0) {
    return { recovered: [], edits: [], plan: null };
  }
  const closed = successorOfferCloseClosedIdentities(planned);
  const freshTasks = [];
  const seen = new Set();
  for (const [path, text] of freshNoteTexts) {
    let parsed = [];
    try {
      parsed = tasksFromDocuments([{ path, text }]);
    } catch (_error) {
      parsed = [];
    }
    let refs = [];
    try {
      refs = successorKeepMovingReferenceTasks(text, path);
    } catch (_error) {
      refs = [];
    }
    for (const task of [...parsed, ...refs]) {
      const key = `${task.path}\0${task.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      freshTasks.push(task);
    }
  }
  let index = null;
  try {
    index = buildDependentsIndex(freshTasks);
  } catch (_error) {
    index = { byDependsOn: new Map(), byTaskId: new Map(), tasks: freshTasks };
  }
  const notesObj = {};
  for (const [path, text] of freshNoteTexts) notesObj[path] = text;
  let plan = null;
  try {
    plan = planSuccessors({
      closed,
      index,
      dailyBefore: Array.isArray(context.dailyBefore) ? context.dailyBefore : [],
      dailyAfter: Array.isArray(context.dailyAfter) ? context.dailyAfter : (Array.isArray(context.dailyBefore) ? context.dailyBefore : []),
      dailyPath: typeof context.dailyPath === "string" ? context.dailyPath : "",
      today,
      markUnblockedLine: typeof context.markUnblockedLine === "function" ? context.markUnblockedLine : null,
      selection: [],
      linkUnblocked: false,
      cancelled: false,
      keepMoving: false,
      dependencySnapshotAvailable: context.dependencySnapshotAvailable === true,
      noteTexts: notesObj,
      notePaths: [...freshNoteTexts.keys()],
    });
  } catch (_error) {
    plan = null;
  }
  if (!plan) return { recovered: [], edits: [], plan: null };
  const edits = Array.isArray(plan.edits) ? plan.edits.slice() : [];
  const rows = Array.isArray(plan.unblocked) ? plan.unblocked.slice() : [];
  const recovered = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const path = String(row.note_path || row.path || "");
    const line = Number(row.line);
    if (!path || !Number.isInteger(line)) continue;
    const edit = edits.find((candidate) => candidate && String(candidate.path || "") === path && Number(candidate.line) === line);
    const after = edit && typeof edit.after === "string" ? edit.after : null;
    const stamped = typeof after === "string" && after.includes(`[unblocked:: ${today}]`);
    let text = String(row.text || "");
    try {
      const blockId = String(row.block_id || row.blockId || "");
      text = cleanDescription(text, "#task", blockId || null);
    } catch (_error) {}
    recovered.push({
      note_path: path,
      block_id: String(row.block_id || row.blockId || ""),
      line,
      text: String(text || row.text || ""),
      previous_status_symbol: String(row.previous_status_symbol || row.previous_status || ""),
      previous_status_name: String(row.status_name && row.previous_status_name ? row.previous_status_name : (row.previous_status_name || row.status_name || "")),
      status_name: String(row.status_name || ""),
      unblocked_stamped: stamped === true,
      unblocked_by: Array.isArray(row.unblocked_by) ? row.unblocked_by.slice() : (Array.isArray(row.predecessorRows) ? row.predecessorRows.slice() : []),
    });
  }
  // Deterministic order for joint attribution.
  recovered.sort((a, b) => String(a.note_path).localeCompare(String(b.note_path)) || a.line - b.line);
  edits.sort((a, b) => String(a.path).localeCompare(String(b.path)) || a.line - b.line);
  return { recovered, edits, plan };
}

function successorOfferCloseReceiptMessage(entry) {
  const display = String(entry.display || entry.text || "task");
  const status = String(entry.statusName || entry.previous_status_name || "Ready");
  const outcome = entry.outcome === "cancelled" ? "cancelled" : "done";
  const recovered = Array.isArray(entry.recovered) ? entry.recovered : [];
  let unblockedClause = "";
  if (recovered.length === 1) {
    unblockedClause = ` · unblocked “${String(recovered[0].text || "")}”`;
  } else if (recovered.length > 1) {
    unblockedClause = ` · unblocked ${recovered.length} tasks`;
  }
  if (outcome === "done") {
    return `✓ completed “${display}” · ${status} → Done${unblockedClause}`;
  }
  const reason = String(entry.reason || "");
  const reasonClause = reason ? ` · “${reason}”` : "";
  return `⊘ cancelled “${display}” · ${status} → Cancelled${reasonClause}${unblockedClause}`;
}

// Attribute each joint recovery deterministically once across receipt rows;
// descriptor counts stay independent single-row predictions.
function buildOfferCloseReceipt(planned, recovery, context) {
  const recovered = recovery && Array.isArray(recovery.recovered) ? recovery.recovered : [];
  const plannedKeys = planned.map((row) => String(row.key));
  const keySet = new Set(plannedKeys);
  const byKey = new Map(planned.map((row) => [String(row.key), row]));
  // Map predecessor identity -> close key for attribution.
  const predecessorKeyFor = (pred) => {
    if (!pred || typeof pred !== "object") return null;
    const path = String(pred.note_path || pred.path || "");
    const blockId = String(pred.block_id || pred.blockId || "");
    const text = String(pred.text || "");
    // Prefer exact blockId match, then taskId/text fallback.
    for (const row of planned) {
      if (String(row.path) === path) {
        const rowBlock = getTrailingBlockId(String(row.beforeLine || "")) || (row.task && row.task.blockId) || "";
        if (blockId && rowBlock && String(rowBlock) === blockId) return String(row.key);
        if (!blockId && !rowBlock && String(row.display) === cleanDescription(text, "#task", blockId || null)) return String(row.key);
      }
    }
    return null;
  };
  const assigned = new Map(plannedKeys.map((key) => [key, []]));
  for (const dep of recovered) {
    const candidates = [];
    for (const pred of Array.isArray(dep.unblocked_by) ? dep.unblocked_by : []) {
      const owner = predecessorKeyFor(pred);
      if (owner && keySet.has(owner) && !candidates.includes(owner)) candidates.push(owner);
    }
    // Fallback: when predecessor rows lack identity, attribute to the first
    // planned close in deterministic order (joint set is the whole batch).
    candidates.sort();
    const owner = candidates.length > 0 ? candidates[0] : plannedKeys.slice().sort()[0];
    if (owner && assigned.has(owner)) assigned.get(owner).push(dep);
  }
  const offerCloses = [];
  for (const row of planned) {
    const key = String(row.key);
    const statusName = successorOfferCloseStatusName(row.status);
    const entryRecovered = (assigned.get(key) || []).map((dep) => ({
      note_path: dep.note_path,
      block_id: dep.block_id,
      text: dep.text,
      previous_status_name: dep.previous_status_name,
      status_name: dep.status_name,
      unblocked_stamped: dep.unblocked_stamped === true,
    }));
    const message = successorOfferCloseReceiptMessage({
      display: row.display,
      statusName,
      outcome: row.outcome,
      reason: row.outcome === "cancelled" ? (row.reason || "") : "",
      recovered: entryRecovered,
    });
    const entry = {
      n: Number.isInteger(row.offer && row.offer.n) ? row.offer.n : undefined,
      key,
      outcome: row.outcome,
      ...(row.outcome === "cancelled" && row.reason ? { reason: row.reason } : {}),
      note_path: String(row.path || ""),
      line: Number(row.line),
      ...(row.task && row.task.blockId ? { block_id: String(row.task.blockId) } : {}),
      text: String(row.display || ""),
      previous_status: String(row.status || ""),
      previous_status_name: statusName,
      ...(row.outcome === "cancelled" ? { cancel_log: row.logOutcome || "none" } : {}),
      recovered: entryRecovered,
      message,
    };
    if (entry.n === undefined) delete entry.n;
    offerCloses.push(entry);
  }
  offerCloses.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return { offerCloses, assigned };
}

function coalesceOfferCloseRestores(intermediates, recoveryEdits, recoveryPlan) {
  // {path, before, after} across verdict + recovery writes. before is the
  // exact state after picks/predecessor recovery and before the verdict step;
  // after is what this step actually wrote. Safe for nav's guarded restore.
  const byPath = new Map();
  for (const [path, pair] of intermediates instanceof Map ? intermediates : new Map()) {
    if (!path || !pair || typeof pair.before !== "string" || typeof pair.after !== "string") continue;
    byPath.set(String(path), { path: String(path), before: String(pair.before), after: String(pair.after) });
  }
  const recoveryByPath = new Map();
  for (const edit of Array.isArray(recoveryEdits) ? recoveryEdits : []) {
    if (!edit || typeof edit.path !== "string") continue;
    if (!recoveryByPath.has(edit.path)) recoveryByPath.set(edit.path, []);
    recoveryByPath.get(edit.path).push(edit);
  }
  // Recovery edits apply on top of intermediates; fold them into after.
  // Callers that write in two phases pass the final texts instead; this
  // helper only coalesces when recovery touches the same paths.
  return [...byPath.values()];
}

function successorOfferCloseFinalTexts(intermediates, recoveryEdits) {
  const finals = new Map();
  for (const [path, pair] of intermediates instanceof Map ? intermediates : new Map()) {
    finals.set(String(path), String(pair.after));
  }
  // Apply recovery edits grouped by path in ascending order. Recovery edits
  // are single-line replacements (rewriteRecoveredTaskLine); no insertions.
  const byPath = new Map();
  for (const edit of Array.isArray(recoveryEdits) ? recoveryEdits : []) {
    if (!edit || typeof edit.path !== "string" || !Number.isInteger(edit.line) || typeof edit.after !== "string") continue;
    if (!byPath.has(edit.path)) byPath.set(edit.path, []);
    byPath.get(edit.path).push(edit);
  }
  for (const [path, edits] of byPath) {
    const base = finals.has(path) ? finals.get(path) : null;
    if (typeof base !== "string") continue;
    const ending = successorOfferCloseLineEnding(base);
    const lines = base.split(/\r?\n/);
    let valid = true;
    for (const edit of edits) {
      if (edit.line < 0 || edit.line >= lines.length || lines[edit.line] !== edit.before) {
        valid = false;
        break;
      }
      lines[edit.line] = edit.after;
    }
    if (!valid) continue;
    finals.set(path, lines.join(ending));
  }
  return finals;
}

async function writeOfferCloseNoteText(plugin, path, before, after, context) {
  const editors = typeof plugin.getOpenMarkdownEditors === "function"
    ? plugin.getOpenMarkdownEditors(context || {})
    : new Map();
  const editor = editors instanceof Map ? editors.get(path) : null;
  if (editor && typeof editor.getValue === "function" && typeof editor.replaceRange === "function") {
    let live = null;
    try {
      live = editor.getValue();
    } catch (_error) {
      live = null;
    }
    if (typeof live !== "string" || live !== before) return { ok: false, reason: "note changed before write" };
    try {
      const lines = String(before).split(/\r?\n/);
      const last = lines.length - 1;
      const lastLength = lines[last] != null ? lines[last].length : 0;
      editor.replaceRange(String(after), { line: 0, ch: 0 }, { line: last, ch: lastLength });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error && error.message ? error.message : "note cannot be updated safely" };
    }
  }
  const vault = plugin && plugin.app && plugin.app.vault;
  if (!vault) return { ok: false, reason: "note cannot be updated safely" };
  const file = typeof vault.getAbstractFileByPath === "function" ? vault.getAbstractFileByPath(path) : null;
  const target = file || (typeof vault.getMarkdownFiles === "function"
    ? vault.getMarkdownFiles().find((candidate) => candidate && candidate.path === path) || null
    : null);
  if (!target) return { ok: false, reason: "note disappeared before write" };
  try {
    if (typeof vault.process === "function") {
      await vault.process(target, (liveText) => {
        if (String(liveText || "") !== String(before)) throw new Error("note changed before write");
        return String(after);
      });
      return { ok: true };
    }
    if (typeof vault.read === "function" && typeof vault.modify === "function") {
      const live = await vault.read(target);
      if (String(live || "") !== String(before)) return { ok: false, reason: "note changed before write" };
      if (String(live || "") !== String(after)) await vault.modify(target, String(after));
      return { ok: true };
    }
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : "note changed before write" };
  }
  return { ok: false, reason: "note cannot be updated safely" };
}

class TaskStatusCyclerOfferCloseApplyMixin {
  async applyOfferClosesNow(options = {}) {
    const closesInput = Array.isArray(options.closes)
      ? options.closes
      : (options.choices && Array.isArray(options.choices.closes) ? options.choices.closes : []);
    const offers = Array.isArray(options.offers) ? options.offers : [];
    const offersByKey = options.offersByKey instanceof Map
      ? options.offersByKey
      : successorOfferCloseOffersByKey(offers);
    const expectedLines = successorOfferCloseExpectedMap(options.expectedLines || options.expected);
    // Fill missing expected lines from the card preimage so direct callers
    // without a pick pass still validate against the shown row.
    for (const [key, offer] of offersByKey) {
      if (!expectedLines.has(key) && offer && offer.task && typeof offer.task.rawLine === "string") {
        expectedLines.set(key, offer.task.rawLine);
      } else if (!expectedLines.has(key) && offer && typeof offer.noteText === "string" && Number.isInteger(offer.line)) {
        const probe = String(offer.noteText).split(/\r?\n/)[offer.line];
        if (typeof probe === "string") expectedLines.set(key, probe);
      }
    }
    const providedNotes = successorOfferCloseCoerceNoteMap(options.noteTexts || options.notes || (options.context && (options.context.noteTexts || options.context.notes)) || {});
    const context = options.context && typeof options.context === "object" ? options.context : {};
    const today = typeof context.today === "string" && context.today
      ? context.today
      : typeof options.today === "string" && options.today
        ? options.today
        : formatLocalDate();
    const capabilities = options.capabilities || {
      completeTaskLineText: (line, opts) => {
        try {
          return typeof this.completeTaskLineText === "function" ? this.completeTaskLineText(line, opts) : null;
        } catch (_error) {
          return null;
        }
      },
      cancel: (() => {
        try {
          const nav = this.app && this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["bob-navigation-hotkeys"];
          const api = nav && nav.api;
          if (api && api.cancel && Number(api.cancel.version) >= 1 && typeof api.cancel.planCancel === "function") return api.cancel;
        } catch (_error) {}
        return null;
      })(),
    };
    const fullContext = {
      ...context,
      today,
      noteTexts: providedNotes,
      dailyBefore: Array.isArray(context.dailyBefore) ? context.dailyBefore : [],
      dailyAfter: Array.isArray(context.dailyAfter) ? context.dailyAfter : (Array.isArray(context.dailyBefore) ? context.dailyBefore : []),
    };
    // Phase 1: pure root planning against the provided (post-pick) snapshot.
    const rootPlan = planOfferCloseRoots({
      noteTexts: providedNotes,
      closes: closesInput,
      expectedLines,
      offersByKey,
      context: fullContext,
      capabilities,
    });
    const refusedByKey = new Map(rootPlan.refused.map((entry) => [String(entry.key), entry]));
    // Live revalidation per note so one stale row never blocks its neighbours.
    // Re-read each touched note (editor first) and keep only rows whose
    // expected line still matches live; recompute that note's after from live.
    const liveNotes = new Map();
    const cache = options.cache instanceof Map ? options.cache : new Map();
    for (const [path] of rootPlan.intermediates) {
      let live = null;
      try {
        live = typeof this.readSuccessorNoteText === "function"
          ? await this.readSuccessorNoteText(path, options.context || {}, cache)
          : providedNotes.get(path);
      } catch (_error) {
        live = null;
      }
      if (typeof live !== "string") live = providedNotes.get(path);
      liveNotes.set(path, live);
    }
    // Also read notes for refused-only paths so a later recovery cannot
    // manufacture success on a deleted note.
    for (const entry of rootPlan.refused) {
      const offer = offersByKey.get(String(entry.key));
      const probe = offer ? successorOfferCloseOfferPath(offer) : null;
      if (probe && probe.path && !liveNotes.has(probe.path) && !rootPlan.intermediates.has(probe.path)) {
        let live = null;
        try {
          live = typeof this.readSuccessorNoteText === "function"
            ? await this.readSuccessorNoteText(probe.path, options.context || {}, cache)
            : providedNotes.get(probe.path);
        } catch (_error) {
          live = null;
        }
        if (typeof live === "string") liveNotes.set(probe.path, live);
      }
    }
    const stillPlannedByPath = new Map();
    for (const row of rootPlan.planned) {
      if (!stillPlannedByPath.has(row.path)) stillPlannedByPath.set(row.path, []);
      stillPlannedByPath.get(row.path).push(row);
    }
    const finalPlanned = [];
    const finalIntermediates = new Map();
    const liveRefused = [];
    for (const [path, rows] of stillPlannedByPath) {
      const beforeProvided = providedNotes.get(path);
      const live = liveNotes.has(path) ? liveNotes.get(path) : beforeProvided;
      if (typeof live !== "string") {
        for (const row of rows) {
          liveRefused.push({ key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("changed_identity", row.display, row.status).why });
          refusedByKey.set(String(row.key), liveRefused[liveRefused.length - 1]);
        }
        continue;
      }
      const liveLines = String(live).split(/\r?\n/);
      const kept = [];
      for (const row of rows) {
        if (!Number.isInteger(row.line) || row.line < 0 || row.line >= liveLines.length || liveLines[row.line] !== row.expected) {
          liveRefused.push({ key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("changed_identity", row.display, row.status).why });
          refusedByKey.set(String(row.key), liveRefused[liveRefused.length - 1]);
          continue;
        }
        kept.push(row);
      }
      if (kept.length === 0) continue;
      // Recompute after from live so unrelated user edits survive.
      const recomputed = planOfferCloseRoots({
        noteTexts: new Map([[path, live]]),
        closes: kept.map((row) => ({ key: row.key, outcome: row.outcome, ...(row.outcome === "cancelled" && row.reason ? { reason: row.reason } : {}) })),
        expectedLines: new Map(kept.map((row) => [row.key, row.expected])),
        offersByKey,
        context: fullContext,
        capabilities,
      });
      if (recomputed.planned.length !== kept.length) {
        // Any recompute refusal (e.g. digest ambiguity on live) is authoritative.
        for (const entry of recomputed.refused) {
          liveRefused.push(entry);
          refusedByKey.set(String(entry.key), entry);
        }
        const keptKeys = new Set(recomputed.planned.map((row) => String(row.key)));
        const surviving = kept.filter((row) => keptKeys.has(String(row.key)));
        if (surviving.length === 0) continue;
        // Use the recomputed intermediates for survivors.
        for (const [p, pair] of recomputed.intermediates) finalIntermediates.set(p, pair);
        for (const row of recomputed.planned) {
          const original = kept.find((candidate) => String(candidate.key) === String(row.key));
          finalPlanned.push({ ...row, display: original ? original.display : row.display, offer: original ? original.offer : row.offer });
        }
        continue;
      }
      for (const [p, pair] of recomputed.intermediates) finalIntermediates.set(p, pair);
      for (const row of recomputed.planned) {
        const original = kept.find((candidate) => String(candidate.key) === String(row.key));
        finalPlanned.push({ ...row, display: original ? original.display : row.display, offer: original ? original.offer : row.offer });
      }
    }
    // Phase 2: guarded root writes (whole-note, editor-first).
    const writeFailures = [];
    const writtenRoots = [];
    const snapshots = new Map();
    for (const [path, pair] of finalIntermediates) {
      const live = liveNotes.has(path) ? liveNotes.get(path) : providedNotes.get(path);
      // The recomputed pair's before is live; guard against a race between
      // revalidation and write by re-reading once more when possible.
      let guardBefore = pair.before;
      let guardAfter = pair.after;
      if (typeof live === "string" && live !== pair.before) {
        guardBefore = live;
        // Recompute once more from the newest live to avoid overwriting a
        // concurrent edit that landed after revalidation.
        const rowsForPath = finalPlanned.filter((row) => String(row.path) === String(path));
        const retry = planOfferCloseRoots({
          noteTexts: new Map([[path, live]]),
          closes: rowsForPath.map((row) => ({ key: row.key, outcome: row.outcome, ...(row.outcome === "cancelled" && row.reason ? { reason: row.reason } : {}) })),
          expectedLines: new Map(rowsForPath.map((row) => [row.key, row.expected])),
          offersByKey,
          context: fullContext,
          capabilities,
        });
        if (retry.planned.length !== rowsForPath.length) {
          for (const row of rowsForPath) {
            if (!retry.planned.some((candidate) => String(candidate.key) === String(row.key))) {
              const entry = { key: row.key, outcome: row.outcome, text: row.display, why: successorOfferCloseRefusalDescriptor("changed_identity", row.display, row.status).why };
              liveRefused.push(entry);
              refusedByKey.set(String(row.key), entry);
            }
          }
          const survivingKeys = new Set(retry.planned.map((row) => String(row.key)));
          const surviving = rowsForPath.filter((row) => survivingKeys.has(String(row.key)));
          if (surviving.length === 0) continue;
          const survivorPair = retry.intermediates.get(path);
          if (!survivorPair) continue;
          guardBefore = survivorPair.before;
          guardAfter = survivorPair.after;
          // Drop refused rows from finalPlanned.
          for (let index = finalPlanned.length - 1; index >= 0; index -= 1) {
            const candidate = finalPlanned[index];
            if (String(candidate.path) === String(path) && !survivingKeys.has(String(candidate.key))) {
              finalPlanned.splice(index, 1);
            }
          }
        } else {
          guardBefore = retry.intermediates.get(path).before;
          guardAfter = retry.intermediates.get(path).after;
        }
      }
      if (guardBefore === guardAfter) {
        snapshots.set(path, { path, before: providedNotes.get(path) != null ? String(providedNotes.get(path)) : String(guardBefore), after: String(guardAfter) });
        continue;
      }
      const result = await writeOfferCloseNoteText(this, path, guardBefore, guardAfter, options.context || {});
      if (!result || result.ok !== true) {
        const reason = (result && result.reason) || "note changed before write";
        writeFailures.push({ path, reason });
        // Mark every planned row in this note as failed; they stay visible.
        for (let index = finalPlanned.length - 1; index >= 0; index -= 1) {
          const candidate = finalPlanned[index];
          if (String(candidate.path) === String(path)) {
            const entry = { key: candidate.key, outcome: candidate.outcome, text: candidate.display, why: reason };
            liveRefused.push(entry);
            refusedByKey.set(String(candidate.key), entry);
            finalPlanned.splice(index, 1);
          }
        }
        finalIntermediates.delete(path);
        continue;
      }
      snapshots.set(path, { path, before: String(providedNotes.get(path) != null ? providedNotes.get(path) : guardBefore), after: String(guardAfter) });
      try { cache.delete(path); } catch (_error) {}
      for (const row of finalPlanned) {
        if (String(row.path) === String(path)) writtenRoots.push(row);
      }
    }
    // Phase 3: joint recover-only cascade over the actual successful writes.
    let recovery = { recovered: [], edits: [], plan: null };
    let recoveryFailures = [];
    if (finalPlanned.length > 0) {
      const freshForRecovery = new Map(providedNotes);
      for (const [path, snap] of snapshots) freshForRecovery.set(path, snap.after);
      // Rebuild fresh task documents after roots close so joint dependencies
      // resolve correctly.
      recovery = planOfferCloseRecovery({ noteTexts: freshForRecovery, planned: finalPlanned, context: fullContext });
      if (recovery.edits.length > 0) {
        // Group recovery edits by path; guard each file against changes
        // between root and recovery writes. Never overwrite or manufacture
        // a successful recovery receipt.
        const byPath = new Map();
        for (const edit of recovery.edits) {
          if (!byPath.has(edit.path)) byPath.set(edit.path, []);
          byPath.get(edit.path).push(edit);
        }
        const appliedRecovery = [];
        const refusedRecoveryPaths = new Set();
        for (const [path, edits] of byPath) {
          const rootSnap = snapshots.get(path);
          const baseText = rootSnap ? rootSnap.after : freshForRecovery.get(path);
          if (typeof baseText !== "string") {
            refusedRecoveryPaths.add(path);
            continue;
          }
          let live = null;
          try {
            live = typeof this.readSuccessorNoteText === "function"
              ? await this.readSuccessorNoteText(path, options.context || {}, cache)
              : baseText;
          } catch (_error) {
            live = null;
          }
          if (typeof live !== "string") live = baseText;
          if (live !== baseText) {
            refusedRecoveryPaths.add(path);
            recoveryFailures.push({ path, reason: "note changed before write" });
            continue;
          }
          const ending = successorOfferCloseLineEnding(baseText);
          const lines = String(baseText).split(/\r?\n/);
          let valid = true;
          for (const edit of edits) {
            if (edit.line < 0 || edit.line >= lines.length || lines[edit.line] !== edit.before) {
              valid = false;
              break;
            }
            lines[edit.line] = edit.after;
          }
          if (!valid) {
            refusedRecoveryPaths.add(path);
            recoveryFailures.push({ path, reason: "note changed before write" });
            continue;
          }
          const after = lines.join(ending);
          if (after === baseText) continue;
          const result = await writeOfferCloseNoteText(this, path, baseText, after, options.context || {});
          if (!result || result.ok !== true) {
            refusedRecoveryPaths.add(path);
            recoveryFailures.push({ path, reason: (result && result.reason) || "note changed before write" });
            continue;
          }
          const prev = snapshots.get(path);
          if (prev) snapshots.set(path, { path, before: prev.before, after });
          else snapshots.set(path, { path, before: String(providedNotes.get(path) != null ? providedNotes.get(path) : baseText), after });
          for (const edit of edits) appliedRecovery.push(edit);
        }
        // Drop recoveries whose file write was refused; never report them.
        if (refusedRecoveryPaths.size > 0) {
          const keptRecovered = [];
          for (const dep of recovery.recovered) {
            if (!refusedRecoveryPaths.has(dep.note_path)) keptRecovered.push(dep);
            else recoveryFailures.push({ path: dep.note_path, reason: "recovery refused: note changed" });
          }
          recovery = { ...recovery, recovered: keptRecovered, edits: appliedRecovery };
        } else {
          recovery = { ...recovery, edits: appliedRecovery };
        }
      }
    }
    const receipt = buildOfferCloseReceipt(finalPlanned, recovery, fullContext);
    const refused = [...refusedByKey.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const restores = [...snapshots.values()].map((entry) => ({ path: entry.path, before: entry.before, after: entry.after }));
    // Resolved identity refs for the walk: successful roots only. Refused
    // rows stay eligible for the walk.
    const resolvedRefs = finalPlanned.map((row) => {
      const blockId = getTrailingBlockId(String(row.beforeLine || "")) || (row.task && row.task.blockId) || "";
      const taskId = successorOfferCloseTaskIdFor(row.task, row.beforeLine);
      const offeredTask = row.offer && row.offer.task && typeof row.offer.task === "object"
        ? row.offer.task
        : {};
      return {
        key: String(row.key),
        path: String(row.path || ""),
        line: Number.isInteger(offeredTask.cardLine) ? offeredTask.cardLine : Number(row.line),
        raw: typeof offeredTask.cardRawLine === "string" && offeredTask.cardRawLine
          ? offeredTask.cardRawLine
          : String(row.beforeLine || ""),
        ...(blockId ? { blockId: String(blockId) } : {}),
        ...(taskId ? { taskId: String(taskId) } : {}),
        text: String(row.display || ""),
      };
    });
    const failures = [];
    for (const failure of writeFailures) failures.push({ kind: "write", ...failure });
    for (const failure of recoveryFailures) failures.push({ kind: "recovery", ...failure });
    return {
      offer_closes: receipt.offerCloses,
      offer_close_refused: refused.length > 0
        ? { count: refused.length, rows: refused.map((entry) => ({ text: String(entry.text || ""), why: String(entry.why || "") })) }
        : null,
      undo: restores.length > 0 ? { restores } : null,
      resolved: resolvedRefs,
      failures: failures.length > 0 ? failures : null,
      planned: finalPlanned,
      intermediates: finalIntermediates,
      recovery,
    };
  }
}
