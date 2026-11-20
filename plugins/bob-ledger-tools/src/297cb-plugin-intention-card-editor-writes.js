// Intention card editor writes: one busy window for every guarded write
// (stage saves, reorder, remove, Undo, and reviewed retries), the retained
// operation a stale or save-blocked write keeps, and one field reconciliation
// for initial reads, applies, stale refreshes, and Undo. A retry always shows
// its target against the refreshed fields and runs only on an explicit Enter.
const INTENTION_CARD_EDITOR_UNDO_STALE = "The note changed after that edit, so Undo was refused. Nothing was written.";
const INTENTION_CARD_EDITOR_CLOSE_DEFERRED = "Closing once the save finishes…";

function intentionCardEditorQuote(text) {
  const value = String(text === null || text === undefined ? "" : text);
  return `“${value.length > 60 ? `${value.slice(0, 59)}…` : value}”`;
}

// Exact text identity first; an unchanged index wins over a unique move.
function intentionCardEditorLocate(list, index, original) {
  const rows = Array.isArray(list) ? list : [];
  if (Number.isInteger(index) && rows[index] === original) return { index, moved: false };
  const hits = [];
  rows.forEach((value, at) => { if (value === original) hits.push(at); });
  if (hits.length === 1) return { index: hits[0], moved: true };
  return { index: -1, gone: hits.length === 0, ambiguous: hits.length > 1 };
}

// The intent a stage save carries. Clearing an existing intention removes it;
// a blank Add writes nothing; summary and reflection clear through unset.
function intentionCardEditorIntentFromStage(stage, draft, fields) {
  if (!stage) return null;
  const text = String(draft === null || draft === undefined ? "" : draft);
  const list = fields && Array.isArray(fields.intentions) ? fields.intentions : [];
  if (stage.kind === "intention") {
    const { value } = intentionCardNormalizeIntentionLine(text);
    if (stage.field === "add") {
      if (!value) return null;
      const index = Number.isInteger(stage.index) ? stage.index : list.length;
      return {
        kind: "insert", index, value,
        after: stage.after !== undefined ? stage.after : (index > 0 ? list[index - 1] : null),
        before: stage.before !== undefined ? stage.before : (index < list.length ? list[index] : null),
      };
    }
    const original = typeof stage.original === "string" ? stage.original : String(list[stage.index] || "");
    return value
      ? { kind: "replace", index: stage.index, original, value }
      : { kind: "remove", index: stage.index, original };
  }
  if (stage.kind === "reflection") return { kind: "reflection", value: text };
  if (stage.kind === "summary") return { kind: "summary", value: text };
  return null;
}

function intentionCardEditorInsertIndex(intent, list) {
  const unique = (value) => {
    if (value === null || value === undefined) return -1;
    const hits = list.reduce((found, row, at) => (row === value ? found.concat(at) : found), []);
    return hits.length === 1 ? hits[0] : -1;
  };
  const after = unique(intent.after);
  if (after >= 0) return after + 1;
  const before = unique(intent.before);
  if (before >= 0) return before;
  if (intent.after === null || intent.after === undefined) return 0;
  const index = Number.isInteger(intent.index) ? intent.index : list.length;
  return Math.max(0, Math.min(list.length, index));
}

// Rebase one intent onto the current fields: the ops to send, the row to
// select, and the plain-language target the status line shows. A target that
// is gone or ambiguous is refused instead of guessed.
function intentionCardEditorRebaseIntent(intent, fields) {
  const list = fields && Array.isArray(fields.intentions) ? fields.intentions : [];
  if (!intent || typeof intent !== "object") return { ok: false, reason: "no-intent", message: "There is nothing to save." };
  const quote = intentionCardEditorQuote;
  if (intent.kind === "remove" || intent.kind === "move") {
    const from = intent.kind === "move" ? intent.from : intent.index;
    const at = intentionCardEditorLocate(list, from, intent.original);
    const verb = intent.kind === "move" ? "move" : "remove";
    if (at.index < 0) {
      return at.ambiguous
        ? { ok: false, reason: "target-ambiguous", message: `${quote(intent.original)} now appears more than once — select the one to ${verb}.` }
        : { ok: false, reason: "target-gone", message: `${quote(intent.original)} is no longer in the list — nothing to ${verb}.` };
    }
    if (intent.kind === "remove") {
      return {
        ok: true, intent: { ...intent, index: at.index }, ops: intentionOpsRemove(at.index),
        selectKey: `intention:${at.index}`, note: `Enter removes ${quote(intent.original)} (#${at.index + 1}).`,
      };
    }
    const delta = Number.isInteger(intent.delta) ? intent.delta : (intent.to - intent.from);
    const to = at.index + delta;
    if (to < 0 || to >= list.length) {
      return { ok: false, reason: "move-out-of-range", message: `${quote(intent.original)} is already at the ${delta < 0 ? "top" : "bottom"}.` };
    }
    return {
      ok: true, intent: { ...intent, from: at.index, to, delta }, ops: intentionOpsMove(at.index, to),
      selectKey: `intention:${at.index}`, note: `Enter moves ${quote(intent.original)} from #${at.index + 1} to #${to + 1}.`,
    };
  }
  if (intent.kind === "replace") {
    const at = intentionCardEditorLocate(list, intent.index, intent.original);
    if (at.index >= 0) {
      return {
        ok: true, intent: { ...intent, index: at.index }, ops: intentionOpsReplace(at.index, intent.value),
        selectKey: `intention:${at.index}`,
        note: at.moved ? `Enter saves your draft over ${quote(intent.original)} (now #${at.index + 1}).` : `Enter saves your draft as Intention ${at.index + 1}.`,
      };
    }
    if (Number.isInteger(intent.index) && intent.index >= 0 && intent.index < list.length) {
      const now = list[intent.index];
      return {
        ok: true, intent: { ...intent, original: now }, ops: intentionOpsReplace(intent.index, intent.value),
        selectKey: `intention:${intent.index}`,
        note: `Intention ${intent.index + 1} now reads ${quote(now)} — Enter replaces it with your draft.`,
      };
    }
    const insert = { kind: "insert", index: list.length, value: intent.value, after: list.length ? list[list.length - 1] : null, before: null };
    return {
      ok: true, intent: insert, ops: intentionOpsInsert(list.length, intent.value), selectKey: "add",
      note: `${quote(intent.original)} is gone — Enter adds your draft as Intention ${list.length + 1}.`,
    };
  }
  if (intent.kind === "insert") {
    const index = intentionCardEditorInsertIndex(intent, list);
    return {
      ok: true, intent: { ...intent, index }, ops: intentionOpsInsert(index, intent.value),
      selectKey: list.length ? `intention:${Math.min(index, list.length - 1)}` : "add",
      note: `Enter adds your draft as Intention ${index + 1}.`,
    };
  }
  if (intent.kind === "reflection") {
    return { ok: true, intent, ops: intentionOpsReflection(intent.value), selectKey: "reflection", note: "Enter saves your reflection over the refreshed one." };
  }
  if (intent.kind === "summary") {
    return { ok: true, intent, ops: intentionOpsSummary(intent.value), selectKey: "summary", note: "Enter saves your summary over the refreshed one." };
  }
  return { ok: false, reason: "unknown-intent", message: "That edit is not supported." };
}

// One reconciliation for every report: `after` is authoritative, so null or
// unset text clears cached modal text and `summary_state` replaces the old
// provenance. The drafted date comes from the applied restore op, unchanged
// agent text, or matching metadata, in that order.
function intentionCardEditorReconcileFields(modal, report, ops = []) {
  const after = report && report.after && typeof report.after === "object" ? report.after : {};
  const previous = modal && modal.fields ? modal.fields : {};
  const summary = typeof after.summary === "string" ? after.summary : "";
  let summaryState = typeof intentionSummaryStateFromReport === "function"
    ? intentionSummaryStateFromReport(after.summary_state) : "";
  if (!summary) summaryState = "empty";
  else if (!summaryState) summaryState = previous.summary === summary && previous.summaryState ? previous.summaryState : "edited";
  let summaryDrafted = "";
  if (summaryState === "agent") {
    summaryDrafted = (typeof intentionRestoredSummaryDrafted === "function" ? intentionRestoredSummaryDrafted(ops) : "")
      || (previous.summary === summary && previous.summaryState === "agent" ? previous.summaryDrafted || "" : "")
      || intentionCardEditorMetadataDrafted(modal, summary);
  }
  return {
    intentions: Array.isArray(after.intentions) ? after.intentions.map(String) : [],
    summary,
    reflection: typeof after.reflection === "string" ? after.reflection : "",
    summaryState,
    summaryDrafted,
  };
}

// Authoritative stamps from metadataCache, only when it describes the same
// agent-drafted text the modal shows.
function intentionCardEditorMetadataDrafted(modal, summary) {
  try {
    const read = modal?.intentionPlugin?.intentionCardEditorReadFields?.(modal.subjectPath);
    if (!read || !read.ok || !read.fields) return "";
    const fields = read.fields;
    if (fields.summaryState !== "agent" || String(fields.summary || "").trim() !== String(summary || "").trim()) return "";
    return fields.summaryDrafted || "";
  } catch (_) {
    return "";
  }
}

// Reads are pinned to the subject and request sequence they started for.
async function intentionCardEditorReadFresh(modal, seq) {
  const plugin = modal && modal.intentionPlugin;
  if (!plugin || typeof plugin.apiIntentionUpdatePreview !== "function") return null;
  const subjectPath = modal.subjectPath;
  let result = null;
  try {
    result = await plugin.apiIntentionUpdatePreview(modal.subject, intentionUpdateEnvelopeText("", []));
  } catch (_) {
    return null;
  }
  if (modal.closed || modal.readSeq !== seq || modal.subjectPath !== subjectPath) return null;
  if (!result || result.ok !== true || !result.report || result.report.ok !== true) return null;
  const fresh = typeof result.report.fingerprint_before === "string" ? result.report.fingerprint_before : "";
  if (!fresh) return null;
  modal.fingerprint = fresh;
  modal.latestReport = result.report;
  try { modal.session?.rebase?.(fresh); } catch (_) {}
  modal.fields = intentionCardEditorReconcileFields(modal, result.report);
  return result.report;
}

function intentionCardEditorResultCode(result) {
  return String((result && (result.code || (result.report && result.report.error && result.report.error.code))) || "");
}

function intentionCardEditorIsStale(result) {
  return Boolean(result && result.ok !== true && (result.kind === "stale" || intentionCardEditorResultCode(result) === "stale_note"));
}

// A timeout leaves the outcome unknown: reconcile against a fresh read and
// review the retry like a stale refusal, never blind-retry.
function intentionCardEditorIsUnknown(result) {
  const code = intentionCardEditorResultCode(result);
  return Boolean(result && result.ok !== true && (result.kind === "timeout-unknown" || code === "timeout"));
}

function intentionCardEditorFinishDeferredClose(modal) {
  if (!modal || !modal.closeRequested || modal.closed || modal.pendingApply) return false;
  modal.closeRequested = false;
  try { modal.close(); } catch (_) {}
  return true;
}

function intentionCardEditorRows(modal) {
  try { return modal?.contentEl?.querySelector?.(".bob-intention-editor-list") || null; } catch (_) { return null; }
}

// Settle after an applied write: one reconciliation, selection that follows
// the edited row, and the shared arrange animation for a successful move.
function intentionCardEditorConsumeApplied(modal, report, options = {}) {
  const intent = options.intent || null;
  const moved = intent && intent.kind === "move";
  const rows = moved ? intentionCardEditorRows(modal) : null;
  const beforeRects = rows && typeof schemaArrangeCollectRects === "function" ? schemaArrangeCollectRects(rows) : null;
  modal.latestReport = report;
  modal.fingerprint = typeof report.fingerprint_after === "string" && report.fingerprint_after ? report.fingerprint_after : modal.fingerprint;
  try { modal.session?.rebase?.(modal.fingerprint); } catch (_) {}
  modal.fields = intentionCardEditorReconcileFields(modal, report, options.ops);
  modal.retained = null;
  const count = modal.fields.intentions.length;
  let nextKey = modal.selectedKey;
  if (intent && (intent.kind === "replace" || intent.kind === "insert")) nextKey = `intention:${intent.index}`;
  else if (intent && intent.kind === "remove") nextKey = count ? `intention:${Math.min(intent.index, count - 1)}` : "add";
  else if (moved) nextKey = `intention:${intent.to}`;
  else if (intent && (intent.kind === "reflection" || intent.kind === "summary")) nextKey = intent.kind;
  const targets = modal.intentionTargets();
  modal.selectedKey = intentionCardEditorTargetByKey(targets, nextKey)
    ? nextKey : intentionCardEditorOpeningSelection(targets, modal.subjectState, "");
  modal.stage = null;
  modal.stageDraft = "";
  modal.stageNote = "";
  modal.stagePreview = null;
  modal.stageExplained = false;
  modal.statusKind = "saved";
  modal.announce = options.announce || INTENTION_CARD_EDITOR_SAVED_TEXT;
  modal.refusalMessage = "";
  modal.refusalHint = "";
  modal.consequence = "";
  modal.paintIntentionCard();
  if (moved && beforeRects && typeof schemaArrangePlayFlip === "function") {
    const after = intentionCardEditorRows(modal);
    if (after) modal.lastArrangePlan = schemaArrangePlayFlip(after, beforeRects);
  }
  if (options.close === true) modal.close();
}

// A stale or save-blocked write keeps its intent. A stage keeps its exact
// draft and moves to the rebased target; a browse write (remove, move)
// becomes the retained retry Enter runs. Either way the target is shown.
function intentionCardEditorRetain(modal, intent, reason) {
  const plan = intentionCardEditorRebaseIntent(intent, modal.fields);
  modal.retained = null;
  modal.statusKind = reason;
  modal.announce = "";
  modal.refusalMessage = reason === "save-blocked"
    ? (modal.refusalMessage || "Open editors could not confirm they are saved.")
    : INTENTION_CARD_EDITOR_STALE_TEXT;
  if (!plan.ok) {
    modal.refusalHint = `${plan.message} Nothing was written.`;
    if (modal.stage) modal.stageNote = plan.message;
    modal.paintIntentionCard();
    return plan;
  }
  const hint = reason === "save-blocked"
    ? `Save every pane showing the note, then ${plan.note.charAt(0).toLowerCase()}${plan.note.slice(1)} Nothing was written.`
    : `${plan.note} Nothing was silently applied.`;
  modal.refusalHint = hint;
  if (modal.stage) {
    if (plan.intent.kind === "insert") {
      modal.stage = { ...modal.stage, kind: "intention", field: "add", index: plan.intent.index, after: plan.intent.after, before: plan.intent.before };
    } else if (plan.intent.kind === "replace" || plan.intent.kind === "remove") {
      modal.stage = { ...modal.stage, kind: "intention", field: `intention:${plan.intent.index}`, index: plan.intent.index, original: plan.intent.original };
    }
    if (intentionCardEditorTargetByKey(modal.intentionTargets(), plan.selectKey)) modal.selectedKey = plan.selectKey;
    modal.stageNote = plan.note;
  } else {
    modal.retained = { intent: plan.intent, ops: plan.ops, reason, note: plan.note };
    if (intentionCardEditorTargetByKey(modal.intentionTargets(), plan.selectKey)) modal.selectedKey = plan.selectKey;
  }
  modal.paintIntentionCard();
  return plan;
}

async function intentionCardEditorRunWrite(modal, plan, seq) {
  const live = () => modal.intentionLive(seq);
  const plugin = modal.intentionPlugin;
  // Flush panes showing the note before the preview; the guarded session
  // flushes again before its apply.
  if (typeof albumSchemaSaveOpenEditors === "function" && plugin) {
    let saved = null;
    try {
      saved = await albumSchemaSaveOpenEditors(plugin, [modal.subjectPath]);
    } catch (error) {
      saved = { ok: false, message: error && error.message ? String(error.message) : "Saving the open editors failed." };
    }
    if (!live()) return { superseded: true };
    if (!saved || saved.ok !== true) {
      return { saveBlocked: true, result: { ok: false, code: "save-blocked", message: (saved && saved.message) || "Open editors could not confirm they are saved." } };
    }
  }
  const session = modal.ensureIntentionSession();
  try { session.rebase?.(modal.fingerprint); } catch (_) {}
  session.setDraft(plan.ops);
  const { preview, applied, superseded } = await intentionCardEditorPreviewApply(session, live);
  if (superseded) return { superseded: true };
  modal.sessionState = session.getState();
  return { result: applied || preview || { ok: false, code: "failed", message: "The intention write failed." } };
}

function intentionCardEditorBeginBusy(modal) {
  modal.pendingApply = true;
  modal.retained = null;
  modal.statusKind = "saving";
  modal.announce = "";
  modal.refusalMessage = "";
  modal.refusalHint = "";
  modal.paintIntentionCard();
}

// Every guarded write: plan against the current fields, one busy window with
// try/finally cleanup, then settle, retain for review, or show the refusal
// with any stage draft intact.
async function intentionCardEditorWrite(modal, intent, options = {}) {
  if (!modal || modal.closed || modal.pendingApply || !modal.writable || !intent) return null;
  const plan = intentionCardEditorRebaseIntent(intent, modal.fields);
  if (!plan.ok) {
    modal.retained = null;
    modal.statusKind = "refusal";
    modal.refusalMessage = plan.message;
    modal.refusalHint = "Nothing was written.";
    modal.paintIntentionCard();
    return { ok: false, code: plan.reason, message: plan.message };
  }
  const seq = modal.intentionReadSeq();
  if (options.note) modal.stageNote = options.note;
  intentionCardEditorBeginBusy(modal);
  let outcome = null;
  try {
    outcome = await intentionCardEditorRunWrite(modal, plan, seq);
    if (!outcome.superseded && !outcome.saveBlocked
      && (intentionCardEditorIsStale(outcome.result) || intentionCardEditorIsUnknown(outcome.result))) {
      outcome.refreshed = await intentionCardEditorReadFresh(modal, seq);
    }
  } catch (error) {
    outcome = { result: { ok: false, code: "failed", message: error && error.message ? String(error.message) : "The intention write failed." } };
  } finally {
    modal.pendingApply = false;
  }
  if (!outcome || outcome.superseded || !modal.intentionLive(seq)) {
    intentionCardEditorFinishDeferredClose(modal);
    return null;
  }
  const result = outcome.result;
  if (result && result.ok === true && result.report) {
    intentionCardEditorConsumeApplied(modal, result.report, {
      ops: plan.ops, intent: plan.intent, close: options.close,
      announce: result.changed === true ? "" : "No change — the note already says that.",
    });
  } else if (result && result.ok === true) {
    modal.stage = null;
    modal.stageDraft = "";
    modal.stageNote = "";
    modal.statusKind = "saved";
    modal.announce = "No change — the note already says that.";
    modal.paintIntentionCard();
    if (options.close === true) modal.close();
  } else if (outcome.saveBlocked) {
    modal.refusalMessage = result.message;
    intentionCardEditorRetain(modal, plan.intent, "save-blocked");
  } else if (intentionCardEditorIsStale(result) || intentionCardEditorIsUnknown(result)) {
    if (!outcome.refreshed) {
      modal.statusKind = "refusal";
      modal.retained = null;
      modal.refusalMessage = INTENTION_CARD_EDITOR_STALE_TEXT;
      modal.refusalHint = "The refresh failed, so nothing can be reviewed yet. Close and reopen the card. Nothing was written.";
      modal.paintIntentionCard();
    } else {
      intentionCardEditorRetain(modal, plan.intent, "stale");
    }
  } else {
    modal.retained = null;
    modal.intentionConsumeFailure(result || { ok: false, code: "failed", message: "The intention write failed." });
  }
  intentionCardEditorFinishDeferredClose(modal);
  return result;
}

// Undo shares the write busy window: competing keys, clicks, travel, and
// close wait for it, and the flag clears in finally whatever the outcome.
async function intentionCardEditorUndo(modal) {
  if (!modal || modal.closed || modal.pendingApply) return null;
  if (!modal.writable) {
    modal.announce = "Undo needs an editable note.";
    modal.paintIntentionCard();
    return null;
  }
  const seq = modal.intentionReadSeq();
  const record = (() => {
    try { return modal.intentionPlugin?.intentionUpdateLastUndo?.(modal.subjectPath) || null; } catch (_) { return null; }
  })();
  const ops = record && Array.isArray(record.inverseOps) ? record.inverseOps : [];
  intentionCardEditorBeginBusy(modal);
  let result = null;
  let refreshed = null;
  try {
    const session = modal.ensureIntentionSession();
    result = await session.undo();
    if (modal.intentionLive(seq)) modal.sessionState = session.getState();
    if (modal.intentionLive(seq) && intentionCardEditorIsStale(result)) refreshed = await intentionCardEditorReadFresh(modal, seq);
  } catch (error) {
    result = { ok: false, code: "failed", message: error && error.message ? String(error.message) : "Undo failed." };
  } finally {
    modal.pendingApply = false;
  }
  if (!modal.intentionLive(seq)) {
    intentionCardEditorFinishDeferredClose(modal);
    return null;
  }
  if (result && result.ok === true && result.changed === true && result.report) {
    intentionCardEditorConsumeApplied(modal, result.report, { ops, intent: { kind: "undo" }, announce: "↶ Undone · u redoes" });
  } else if (result && (result.ok === true || result.code === "nothing-to-undo")) {
    modal.statusKind = "browsing";
    modal.announce = "Nothing to undo.";
    modal.paintIntentionCard();
  } else if (intentionCardEditorIsStale(result)) {
    modal.statusKind = "refusal";
    modal.refusalMessage = INTENTION_CARD_EDITOR_UNDO_STALE;
    modal.refusalHint = refreshed ? "The card now shows the current fields." : "Close and reopen the card to see the current fields.";
    modal.paintIntentionCard();
  } else {
    modal.intentionConsumeFailure(result || { ok: false, code: "failed", message: "Undo failed." });
  }
  intentionCardEditorFinishDeferredClose(modal);
  return result;
}
