// Intention card editor modal: browse selection, intention/reflection/
// summary field stages, and the guarded periods session. All writes preview
// then apply through `createIntentionUpdateSession`; the server fingerprint
// rides every envelope. Drafts survive stale refusals; a reviewed retry is
// always explicit, never automatic.
const IntentionCardModalBase = typeof albumSchemaCardModalBase === "function"
  ? albumSchemaCardModalBase()
  : class IntentionCardFallback { constructor(app) { this.app = app; } open() { this.onOpen?.(); } close() { this.onClose?.(); } };

const INTENTION_CARD_EDITOR_SOFT_CAP = 4;
const INTENTION_CARD_EDITOR_SOFT_CAP_HINT = "Three is plenty — what can go?";
const INTENTION_CARD_EDITOR_SUMMARY_EXPLAINER = "agent drafted this; your edit makes it yours";
const INTENTION_CARD_EDITOR_NEEDS_UPDATE = "Update bob to edit intentions";
const INTENTION_CARD_EDITOR_STALE_TEXT = "The note changed elsewhere — refreshed; your draft is kept · Enter retries the reviewed write";
const INTENTION_CARD_EDITOR_SAVED_TEXT = "✓ Saved · u undo";
const INTENTION_CARD_EDITOR_SAVING_TEXT = "Saving…";
const INTENTION_CARD_EDITOR_READING_TEXT = "Reading intentions…";

// Rows carry a stable arrange identity (text plus occurrence), so the shared
// arrange animation follows a moved intention rather than its index.
function intentionCardEditorTargets(fields) {
  const list = fields && Array.isArray(fields.intentions) ? fields.intentions : [];
  const seen = new Map();
  const targets = list.map((value, index) => {
    const text = String(value);
    const occurrence = (seen.get(text) || 0) + 1;
    seen.set(text, occurrence);
    return {
      key: `intention:${index}`, kind: "intention", index,
      label: `Intention ${index + 1}`, value: text, arrangeId: `intention:${occurrence}:${text}`,
    };
  });
  targets.push({
    key: "reflection", kind: "reflection", arrangeId: "reflection",
    label: "Reflection", value: fields && typeof fields.reflection === "string" ? fields.reflection : "",
  });
  targets.push({
    key: "summary", kind: "summary", arrangeId: "summary",
    label: "Summary", value: fields && typeof fields.summary === "string" ? fields.summary : "",
    summaryState: fields && fields.summaryState ? fields.summaryState : "",
    summaryDrafted: fields && fields.summaryDrafted ? fields.summaryDrafted : "",
  });
  if (!list.length) {
    targets.unshift({ key: "add", kind: "add", label: "Add intention", value: "", arrangeId: "add" });
  }
  return targets;
}

function intentionCardEditorTargetByKey(targets, key) {
  return (Array.isArray(targets) ? targets : []).find((target) => target && target.key === key) || null;
}

// Open subjects land on the first intention (or Add when empty); closed
// subjects land on Reflection. An explicit requested field wins when valid.
function intentionCardEditorOpeningSelection(targets, state, requested = "") {
  const list = Array.isArray(targets) ? targets : [];
  if (requested && intentionCardEditorTargetByKey(list, requested)) return requested;
  if (state === "closed") return "reflection";
  const first = list.find((target) => target && target.kind === "intention");
  if (first) return first.key;
  if (intentionCardEditorTargetByKey(list, "add")) return "add";
  return list.length ? list[0].key : "";
}

function intentionCardEditorNavigate(targets, currentKey, delta) {
  const list = Array.isArray(targets) ? targets : [];
  if (!list.length) return "";
  const index = Math.max(0, list.findIndex((target) => target && target.key === currentKey));
  const next = (((index + (delta || 0)) % list.length) + list.length) % list.length;
  return list[next] ? list[next].key : "";
}

function intentionCardEditorStageFor(target) {
  if (!target) return null;
  if (target.kind === "intention" || target.kind === "add") return "intention";
  if (target.kind === "reflection") return "reflection";
  if (target.kind === "summary") return "summary";
  return null;
}

// Pure key dispatch for browse mode and the three field stages. Returns an
// action name; the modal maps it to behavior. `inInput` marks text controls.
function intentionCardEditorKeyAction(event, context = {}) {
  const key = event && event.key;
  const ctrl = event && (event.ctrlKey === true || event.metaKey === true);
  const alt = event && event.altKey === true;
  const shift = event && event.shiftKey === true;
  const rawStage = context.stage || null;
  const stage = typeof rawStage === "string" ? rawStage : (rawStage && rawStage.kind) || null;
  const inInput = context.inInput === true;
  const selected = context.selected || null;

  if (stage) {
    if (key === "Escape") return "cancel-stage";
    if (stage === "reflection") {
      if (key === "Enter" && !shift && ctrl) return "save-and-close";
      if (key === "Enter" && !shift) return "save-stage";
      return null;
    }
    if (key === "Enter") return "save-stage";
    return null;
  }

  if (alt && (key === "j" || key === "J" || key === "ArrowDown")) return "reorder-down";
  if (alt && (key === "K" || key === "k" || key === "ArrowUp")) return "reorder-up";
  if ((ctrl && (key === "d" || key === "D")) && !alt) return "remove";
  if (!ctrl && !alt && key === "u") return "undo";
  if (!ctrl && !alt && !shift && key === "i") return "edit-first-or-add";
  if (!ctrl && !alt && (key === "o" || key === "O")) return key === "o" ? "insert-below" : "insert-above";
  if (!ctrl && !alt && !shift && key === "r") return "open-reflection";
  if (!ctrl && !alt && !shift && key === "s") return "select-summary";
  if (!ctrl && !alt && key === "Enter" && !inInput) return "edit-selected";
  if (!ctrl && !alt && /^[1-9]$/.test(String(key || ""))) return `select-digit:${key}`;
  if (!ctrl && !alt && (key === "j" || key === "ArrowDown" || key === "Tab") && !shift) return "move-next";
  if (!ctrl && !alt && (key === "k" || key === "ArrowUp")) return "move-prev";
  if (!ctrl && !alt && key === "Tab" && shift) return "move-prev";
  if (selected && selected.kind === "intention" && !inInput) return null;
  return null;
}

// One layer per Esc (and its q / Ctrl+[ aliases): a pending write ignores
// it, a stage cancels, a retained retry is discarded, then the card closes.
function intentionCardEditorEscLadder({ stage, pendingApply, retained } = {}) {
  if (pendingApply === true) return "ignore";
  if (stage) return "cancel-stage";
  if (retained) return "discard-retry";
  return "close";
}

// Pasted newlines collapse to spaces with a quiet note; the stored value is
// always one line.
function intentionCardNormalizeIntentionLine(text) {
  const raw = String(text === null || text === undefined ? "" : text);
  const collapsed = raw.replace(/\r\n?|\u2028|\u2029/g, " ").replace(/\n+/g, " ");
  const value = collapsed.split(" ").filter((part) => part !== "").join(" ") || collapsed.trim();
  return { value: value.trim(), collapsed: /[\r\n\u2028\u2029]/.test(raw) };
}

function intentionCardReorderedList(list, from, to) {
  const rows = Array.isArray(list) ? list.slice() : [];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return rows;
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return rows;
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return rows;
}

function intentionCardEditorSoftCapHint(count) {
  return Number.isInteger(count) && count >= INTENTION_CARD_EDITOR_SOFT_CAP
    ? INTENTION_CARD_EDITOR_SOFT_CAP_HINT
    : "";
}

function intentionOpsSetIntentions(values) {
  return [{ op: "intentions.set", values: (Array.isArray(values) ? values : []).map(String) }];
}

function intentionOpsInsert(index, value) {
  return [{ op: "intentions.insert", index, value: String(value) }];
}

function intentionOpsReplace(index, value) {
  return [{ op: "intentions.replace", index, value: String(value) }];
}

function intentionOpsMove(from, to) {
  return [{ op: "intentions.move", from, to }];
}

function intentionOpsRemove(index) {
  return [{ op: "intentions.remove", index }];
}

function intentionOpsReflection(value) {
  return String(value || "").trim()
    ? [{ op: "reflection.set", value: String(value) }]
    : [{ op: "reflection.unset" }];
}

function intentionOpsSummary(value) {
  // Empty summaries unset (and drop both stamps); never an invalid `.set`.
  // A set carries the edited text; the writer stamps provenance itself.
  return String(value || "").trim()
    ? [{ op: "summary.set", value: String(value) }]
    : [{ op: "summary.unset" }];
}

function intentionCardEditorCreateEl(doc, tag, className) {
  if (!doc || typeof doc.createElement !== "function") return null;
  if (typeof notebookCreateEl === "function") {
    try { return notebookCreateEl(doc, tag, className); } catch (_) {}
  }
  const el = doc.createElement(tag);
  if (className) el.className = className;
  return el;
}

function intentionCardEditorSetText(el, value) {
  if (!el) return;
  if (typeof notebookSetText === "function") {
    try { notebookSetText(el, value); return; } catch (_) {}
  }
  el.textContent = String(value === null || value === undefined ? "" : value);
}

class IntentionCardModal extends IntentionCardModalBase {
  constructor(app, options = {}) {
    super(app);
    this.intentionPlugin = options.plugin || null;
    this.subject = String(options.subject || "");
    this.subjectPath = intentionCardPath(options.subjectPath || options.subject || "");
    this.subjectState = options.state === "closed" ? "closed" : "open";
    this.fields = options.fields && typeof options.fields === "object" ? options.fields : null;
    this.missing = options.missing === true;
    this.malformed = options.malformed === true || (this.fields === null && !this.missing);
    if (this.missing && this.fields === null) {
      this.fields = { intentions: [], summary: "", summaryState: "", summaryDrafted: "", reflection: "" };
    }
    this.fingerprint = typeof options.fingerprint === "string" ? options.fingerprint : "";
    this.latestReport = options.report || null;
    this.writable = options.writable !== false && !this.malformed && !this.missing;
    this.selectedKey = "";
    this.stage = null;
    this.stageDraft = "";
    this.stageNote = "";
    this.stagePreview = null;
    this.session = null;
    this.sessionState = null;
    this.readSeq = 0;
    this.closeToken = 0;
    this.pendingApply = false;
    this.closeRequested = false;
    this.closed = false;
    // A stale or save-blocked browse write (remove, move) waiting for an
    // explicit reviewed Enter: { intent, ops, reason, note }.
    this.retained = null;
    this.refusalMessage = this.malformed ? "The intention fields on this note are malformed." : "";
    this.refusalHint = this.malformed ? "Open the note in Source mode to repair the frontmatter, then reopen." : "";
    this.consequence = "";
    this.announce = "";
    this.statusKind = this.malformed ? "refusal" : "reading";
    this.returnSelection = typeof options.returnSelection === "string" ? options.returnSelection : "";
    const targets = this.intentionTargets();
    this.selectedKey = intentionCardEditorOpeningSelection(targets, this.subjectState, options.field || options.initialStage || "");
    if (options.stage && intentionCardEditorStageFor(intentionCardEditorTargetByKey(targets, options.stage))) {
      this.intentionOpenStage(intentionCardEditorStageFor(intentionCardEditorTargetByKey(targets, options.stage)), options.stage);
    } else if (typeof options.initialStage === "string" && options.initialStage) {
      const target = intentionCardEditorTargetByKey(targets, options.initialStage);
      if (target) this.intentionOpenStage(intentionCardEditorStageFor(target), target.key);
    }
  }

  intentionTargets() {
    return intentionCardEditorTargets(this.fields || { intentions: [], summary: "", reflection: "" });
  }

  intentionSelected() {
    return intentionCardEditorTargetByKey(this.intentionTargets(), this.selectedKey);
  }

  intentionReadSeq() {
    this.readSeq += 1;
    return this.readSeq;
  }

  intentionLive(seq) {
    return !this.closed && seq === this.readSeq;
  }

  intentionDoc() {
    return this.contentEl?.ownerDocument || this.app?.document || (typeof document !== "undefined" ? document : null);
  }

  ensureIntentionSession() {
    if (this.session) return this.session;
    const plugin = this.intentionPlugin;
    const deps = typeof intentionUpdateServiceDeps === "function" && plugin
      ? intentionUpdateServiceDeps(plugin, {
        subject: this.subject, subjectPath: this.subjectPath,
        onChange: () => { if (!this.closed) this.paintIntentionCard(); },
      })
      : { spawnPreview: () => Promise.resolve({ ok: false, code: "unavailable" }), spawnApply: () => Promise.resolve({ ok: false, code: "unavailable" }), saveEditors: () => Promise.resolve({ ok: true }), getGeneration: () => 0 };
    this.session = createIntentionUpdateSession(
      // Undo is path-scoped: a reopened card can still undo the last write.
      { subject: this.subject, subjectPath: this.subjectPath, expect: this.fingerprint, undo: plugin?.intentionUpdateLastUndo?.(this.subjectPath) || null },
      deps,
    );
    return this.session;
  }

  intentionSelect(key) {
    const target = intentionCardEditorTargetByKey(this.intentionTargets(), key);
    if (!target) return;
    this.selectedKey = key;
    // A move is not an outcome: the focused row already says where you are,
    // so the status line returns to the browse keys.
    this.announce = "";
    this.paintIntentionCard();
  }

  intentionMove(delta) {
    const next = intentionCardEditorNavigate(this.intentionTargets(), this.selectedKey, delta);
    if (next) this.intentionSelect(next);
  }

  // Opening a stage records the target's identity: the text an existing
  // intention held, or an Add's neighbours, so a stale retry can rebase.
  intentionOpenStage(kind, fieldKey) {
    const target = intentionCardEditorTargetByKey(this.intentionTargets(), fieldKey || this.selectedKey);
    if (!target || !kind || !this.writable || this.pendingApply) return false;
    this.stageNote = "";
    if (kind === "summary" && this.fields && this.fields.summaryState === "agent" && !this.stageExplained) {
      this.stageExplained = true;
      this.stageNote = INTENTION_CARD_EDITOR_SUMMARY_EXPLAINER;
    }
    this.retained = null;
    this.selectedKey = target.key;
    this.stage = { kind, field: target.key, index: target.index };
    if (target.kind === "intention") this.stage.original = target.value;
    this.stageDraft = target.kind === "add" ? "" : target.value;
    if (target.kind === "add") this.intentionStageAdd(this.fields ? this.fields.intentions.length : 0);
    this.stagePreview = null;
    this.paintIntentionCard();
    return true;
  }

  intentionStageAdd(index) {
    const list = this.fields ? this.fields.intentions : [];
    const at = Math.max(0, Math.min(list.length, index));
    this.stage = {
      kind: "intention", field: "add", index: at,
      after: at > 0 ? list[at - 1] : null, before: at < list.length ? list[at] : null,
    };
    this.stageDraft = "";
  }

  // Cancel leaves nothing behind: no hidden retained write a later Enter
  // could run, and no stale or blocked status describing a discarded draft.
  intentionCancelStage() {
    this.stage = null;
    this.stageDraft = "";
    this.stageNote = "";
    this.stagePreview = null;
    this.stageExplained = false;
    this.intentionClearRetry();
    this.paintIntentionCard();
  }

  intentionClearRetry() {
    this.retained = null;
    if (["stale", "save-blocked", "refusal"].includes(this.statusKind) && this.writable && !this.malformed && !this.missing) {
      this.statusKind = "browsing";
      this.refusalMessage = "";
      this.refusalHint = "";
    }
  }

  intentionDiscardRetained(announce = true) {
    if (!this.retained) return false;
    this.intentionClearRetry();
    if (announce) this.announce = "Retry discarded · nothing was written";
    this.paintIntentionCard();
    return true;
  }

  intentionHandleEscape() {
    return intentionCardEditorEscLadder({ stage: this.stage, pendingApply: this.pendingApply, retained: this.retained });
  }

  intentionBackOut(event) {
    // An open LINK band is the first rung: it closes alone.
    const action = !this.pendingApply && intentionCardEditorProseBackOut(this, event)
      ? "close-link" : this.intentionHandleEscape();
    try { event?.preventDefault?.(); } catch (_) {}
    try { event?.stopPropagation?.(); } catch (_) {}
    try { event.__schemaEscapeHandled = true; } catch (_) {}
    if (action === "cancel-stage") this.intentionCancelStage();
    else if (action === "discard-retry") this.intentionDiscardRetained();
    else if (action === "close") this.close();
    return action;
  }

  // A pointer close (the X button, the backdrop) during a write waits for it
  // instead of superseding it; the write closes the card when it settles.
  close() {
    if (this.pendingApply && !this.intentionForceClose && !this.closed) {
      this.closeRequested = true;
      this.announce = INTENTION_CARD_EDITOR_CLOSE_DEFERRED;
      this.paintIntentionCard();
      return;
    }
    super.close();
  }

  intentionCloseKind(event) {
    try {
      if (typeof bobCardCloseKey === "function") return bobCardCloseKey(event);
    } catch (_) {}
    return event && event.key === "Escape" ? "escape" : null;
  }

  intentionShouldBackOut(kind, event) {
    if (kind !== "q" && kind !== "ctrl-bracket" && kind !== "escape") return false;
    if (kind === "q") {
      try {
        if (typeof bobCardTypesText === "function"
          && bobCardTypesText(event, this.modalEl || this.contentEl)) return false;
      } catch (_) {}
      return true;
    }
    return true;
  }

  onEscapeKey(event) {
    this.intentionBackOut(event);
    return false;
  }

  intentionInInput(event) {
    const target = event && event.target;
    return Boolean(target && target.closest && target.closest("input,select,textarea,[contenteditable]"));
  }

  intentionStatusModel() {
    const undo = this.sessionState && this.sessionState.undoAvailable;
    let undoAvailable = Boolean(undo);
    try {
      if (!undoAvailable && this.intentionPlugin?.intentionUpdateLastUndo?.(this.subjectPath)) undoAvailable = true;
    } catch (_) {}
    return {
      statusKind: this.statusKind, refusalMessage: this.refusalMessage, refusalHint: this.refusalHint,
      consequence: this.consequence, writable: this.writable, pendingApply: this.pendingApply,
      stage: this.stage, undoAvailable, announce: this.announce, retained: this.retained,
    };
  }

  intentionPaintOptions() {
    return {
      subject: this.subject, subjectPath: this.subjectPath, state: this.subjectState,
      selectedKey: this.selectedKey, targets: this.intentionTargets(),
      stage: this.stage, stageDraft: this.stageDraft, stageNote: this.stageNote,
      stagePreview: this.stagePreview, fields: this.fields,
      softCapHint: intentionCardEditorSoftCapHint(this.fields ? this.fields.intentions.length : 0),
      status: this.intentionStatusModel(),
      proseBand: Boolean(this.stage && intentionCardEditorProseApi(this)),
    };
  }

  paintIntentionCard() {
    if (this.closed) return;
    const doc = this.intentionDoc();
    if (!doc) return;
    const options = this.intentionPaintOptions();
    const caret = intentionCardEditorCaptureCaret(this, doc);
    let card = null;
    try { card = this.contentEl?.querySelector?.(".bob-intention-card-editor"); } catch (_) {}
    this.intentionProsePainting = true;
    try {
      if (!card) {
        try { this.contentEl?.empty?.(); } catch (_) {}
        card = intentionCardEditorBuildEl(options, doc, this);
        if (card) {
          try { this.contentEl?.appendChild?.(card); } catch (_) {}
        }
      } else {
        try { intentionCardEditorPaintAll(card, options, doc, this); } catch (_) {}
      }
      try {
        const live = card?.querySelector?.("[data-intention-input]");
        if (live && live.tagName === "TEXTAREA" && live.getAttribute?.("data-intention-input") !== "reflection"
          && typeof bobSoftLineAutosize === "function") {
          try { bobSoftLineAutosize(live); } catch (_) {}
        } else {
          intentionCardEditorAutogrow(live);
        }
      } catch (_) {}
      this.intentionRestoreFocus(caret);
    } finally {
      this.intentionProsePainting = false;
    }
    // The rebuilt stage keeps its LINK band: rebind after the caret is back.
    try { intentionCardEditorSyncProse(this); } catch (_) {}
  }

  // Browse mode focuses its row; only an explicitly opened stage owns focus.
  intentionRestoreFocus(caret = null) {
    intentionCardEditorFocus(this, caret);
  }

  onOpen() {
    this.paintIntentionCard();
    try {
      if (typeof bobCardWireCloseKeys === "function") {
        bobCardWireCloseKeys(this, { backOut: (event) => this.intentionBackOut(event) });
      }
    } catch (_) {}
    void this.intentionInitialRead();
  }

  onClose() {
    this.closed = true;
    this.closeToken += 1;
    this.closeRequested = false;
    try { intentionCardEditorProseDetach(this); } catch (_) {}
    try {
      if (typeof bobCardUnwireCloseKeys === "function") bobCardUnwireCloseKeys(this);
    } catch (_) {}
    try { this.session?.close?.(); } catch (_) {}
    this.session = null;
    try {
      if (this.intentionPlugin && this.intentionPlugin.intentionCardEditorModal === this) {
        this.intentionPlugin.intentionCardEditorModal = null;
      }
    } catch (_) {}
  }

  async intentionInitialRead() {
    if (this.closed || this.malformed || this.missing) return;
    const seq = this.intentionReadSeq();
    this.statusKind = "reading";
    this.paintIntentionCard();
    const plugin = this.intentionPlugin;
    let result = null;
    try {
      // The initial read is a dry run with an empty op list and no expect;
      // the guarded session never previews an empty draft, so read directly.
      const envelope = typeof intentionUpdateEnvelopeText === "function"
        ? intentionUpdateEnvelopeText("", [])
        : JSON.stringify({ schema_version: 1, ops: [] });
      result = plugin && typeof plugin.apiIntentionUpdatePreview === "function"
        ? await plugin.apiIntentionUpdatePreview(this.subject, envelope)
        : { ok: false, code: "unavailable", message: "The intention service is unavailable." };
    } catch (error) {
      result = { ok: false, code: "failed", message: error && error.message ? String(error.message) : "The intention read failed." };
    }
    if (!this.intentionLive(seq)) return;
    try {
      const session = this.ensureIntentionSession();
      this.sessionState = session.getState();
    } catch (_) {}
    this.intentionConsumePreview(result);
  }

  intentionConsumePreview(result) {
    if (!result) return;
    if (result.ok === true && result.report && result.report.ok === true) {
      if (intentionCardEditorApplyBlockingWarning(this, result.report)) return;
      this.latestReport = result.report;
      this.fingerprint = typeof result.report.fingerprint_before === "string" ? result.report.fingerprint_before : this.fingerprint;
      try { this.session?.rebase?.(this.fingerprint); } catch (_) {}
      this.fields = intentionCardEditorReconcileFields(this, result.report);
      if (!intentionCardEditorTargetByKey(this.intentionTargets(), this.selectedKey)) {
        this.selectedKey = intentionCardEditorOpeningSelection(this.intentionTargets(), this.subjectState, "");
      }
      if (this.statusKind === "reading") this.statusKind = this.writable ? "browsing" : "read-only";
      this.paintIntentionCard();
      return;
    }
    this.intentionConsumeFailure(result);
  }

  // Real validation refusals stay distinct from an old bob without the
  // update command; neither discards an open stage's draft.
  intentionConsumeFailure(result) {
    const code = result && (result.code || (result.report && result.report.error && result.report.error.code)) || "failed";
    const model = typeof intentionUpdateErrorModel === "function"
      ? intentionUpdateErrorModel(result.report?.error || result)
      : { code, hint: "" };
    if (model.code === "needs-update" || code === "needs-update") {
      this.statusKind = "needs-update";
      this.writable = false;
      this.refusalMessage = INTENTION_CARD_EDITOR_NEEDS_UPDATE;
      this.refusalHint = "Painting continues normally; native Properties remains available.";
    } else {
      this.statusKind = "refusal";
      this.refusalMessage = (result.report?.error?.message) || result.message || "The intention preview was refused.";
      this.refusalHint = (result.report?.error?.hint) || model.hint || "";
      if (this.stage) this.refusalHint = [this.refusalHint, "Your draft is kept."].filter(Boolean).join(" ");
    }
    this.sessionState = this.session?.getState?.() || this.sessionState;
    this.paintIntentionCard();
  }

  async intentionSaveStage(options = {}) {
    if (!this.stage || this.pendingApply || !this.writable) return null;
    const intent = intentionCardEditorIntentFromStage(this.stage, this.stageDraft, this.fields);
    if (!intent) {
      this.stageNote = "An intention needs one line of text.";
      this.paintIntentionCard();
      return null;
    }
    return intentionCardEditorWrite(this, intent, options);
  }

  intentionConsumeApplied(report, options = {}) {
    return intentionCardEditorConsumeApplied(this, report, options);
  }

  // Enter after a stale or save-blocked browse write: the retained intent,
  // rebased onto the refreshed fields and shown, runs once.
  async intentionRetry() {
    if (!this.retained || this.pendingApply || this.stage) return null;
    const intent = this.retained.intent;
    return intentionCardEditorWrite(this, intent, { retried: true });
  }

  async intentionUndo() {
    return intentionCardEditorUndo(this);
  }

  async intentionReorder(delta) {
    const target = this.intentionSelected();
    if (!target || target.kind !== "intention" || !this.writable || this.pendingApply) return null;
    const count = this.fields ? this.fields.intentions.length : 0;
    const to = target.index + delta;
    if (to < 0 || to >= count) return null;
    return intentionCardEditorWrite(this, { kind: "move", from: target.index, to, delta, original: target.value });
  }

  async intentionRemove() {
    const target = this.intentionSelected();
    if (!target || target.kind !== "intention" || !this.writable || this.pendingApply) return null;
    return intentionCardEditorWrite(this, { kind: "remove", index: target.index, original: target.value });
  }

  // Later stamps from metadataCache (an Undo restores the drafted date only
  // through its op) show without a close/reopen when the text still matches.
  intentionOnMetadata(path) {
    if (this.closed || this.pendingApply || !this.fields || path !== this.subjectPath) return false;
    if (!this.fields.summary || this.fields.summaryState !== "agent") return false;
    const drafted = intentionCardEditorMetadataDrafted(this, this.fields.summary);
    if (!drafted || drafted === this.fields.summaryDrafted) return false;
    this.fields = { ...this.fields, summaryDrafted: drafted };
    this.paintIntentionCard();
    return true;
  }

  intentionHandleAction(action, payload = {}) {
    if (!action || this.closed || this.pendingApply) return null;
    if (action === "close") { this.close(); return null; }
    if (action === "cancel-stage") { this.intentionCancelStage(); return null; }
    if (action === "retry") { void this.intentionRetry(); return null; }
    if (this.retained) this.intentionDiscardRetained(false);
    if (action.startsWith("select-digit:")) {
      const digit = Number(action.slice("select-digit:".length));
      const key = `intention:${digit - 1}`;
      if (intentionCardEditorTargetByKey(this.intentionTargets(), key)) this.intentionSelect(key);
      return null;
    }
    if (action === "move-next") { this.intentionMove(1); return null; }
    if (action === "move-prev") { this.intentionMove(-1); return null; }
    if (action === "edit-selected") {
      const target = this.intentionSelected();
      if (!target || !this.writable) return null;
      this.intentionOpenStage(intentionCardEditorStageFor(target), target.key);
      return null;
    }
    if (action === "edit-first-or-add") {
      const first = this.intentionTargets().find((target) => target.kind === "intention");
      if (first) this.intentionOpenStage("intention", first.key);
      else this.intentionOpenStage("intention", "add");
      return null;
    }
    if (action === "insert-below" || action === "insert-above") {
      if (!this.writable) return null;
      const target = this.intentionSelected();
      const count = this.fields ? this.fields.intentions.length : 0;
      const at = target && target.kind === "intention"
        ? target.index + (action === "insert-below" ? 1 : 0)
        : (action === "insert-below" ? count : 0);
      this.intentionStageAdd(at);
      this.stagePreview = null;
      this.stageNote = "";
      this.paintIntentionCard();
      return null;
    }
    if (action === "open-reflection") { this.intentionOpenStage("reflection", "reflection"); return null; }
    if (action === "select-summary") {
      this.intentionSelect("summary");
      const target = intentionCardEditorTargetByKey(this.intentionTargets(), "summary");
      if (target) this.announce = "Summary selected · Enter explains ownership before opening its edit stage.";
      this.paintIntentionCard();
      return null;
    }
    if (action === "reorder-down") { void this.intentionReorder(1); return null; }
    if (action === "reorder-up") { void this.intentionReorder(-1); return null; }
    if (action === "remove") { void this.intentionRemove(); return null; }
    if (action === "undo") { void this.intentionUndo(); return null; }
    if (action === "save-stage") { void this.intentionSaveStage(); return null; }
    if (action === "save-and-close") { void this.intentionSaveStage({ close: true }); return null; }
    return null;
  }

  intentionOnKeyDown(event) {
    if (!event || event.isComposing || event.keyCode === 229) return;
    if (event.defaultPrevented || event.__schemaEscapeHandled) return;
    if (this.pendingApply) {
      // Every key waits for the write; none may supersede it.
      try { event.preventDefault?.(); } catch (_) {}
      return;
    }
    // An open LINK band sees stage keys first; Esc reaches it via back-out.
    if (this.stage && intentionCardEditorProseKey(this, event)) return;
    const closeKind = this.intentionCloseKind(event);
    if (closeKind && this.intentionShouldBackOut(closeKind, event)) {
      this.intentionBackOut(event);
      return;
    }
    if (this.stage) {
      if (event.key === "Enter" || event.key === "Escape") {
        const inInput = this.intentionInInput(event);
        const stage = this.stage.kind;
        if (stage === "reflection" && event.key === "Enter") {
          const ctrl = event.ctrlKey === true || event.metaKey === true;
          const shift = event.shiftKey === true;
          if (shift && !ctrl) return;
          event.preventDefault?.();
          void this.intentionSaveStage({ close: ctrl });
          return;
        }
        if (event.key === "Enter" && !inInput) return;
        if (event.key === "Enter") {
          event.preventDefault?.();
          void this.intentionSaveStage();
          return;
        }
      }
      return;
    }
    const plain = event.ctrlKey !== true && event.metaKey !== true && event.altKey !== true && event.shiftKey !== true;
    if (this.retained && event.key === "Enter" && plain && !this.intentionInInput(event)) {
      event.preventDefault?.();
      void this.intentionRetry();
      return;
    }
    const action = intentionCardEditorKeyAction(event, {
      inInput: this.intentionInInput(event), stage: null, selected: this.intentionSelected(),
    });
    if (!action) return;
    if (action === "edit-selected" && this.selectedKey === "summary") {
      event.preventDefault?.();
      if (this.retained) this.intentionDiscardRetained(false);
      this.intentionOpenStage("summary", "summary");
      return;
    }
    event.preventDefault?.();
    this.intentionHandleAction(action);
  }

  intentionOnClick(event) {
    const button = event?.target?.closest?.("button[data-intention-action], button[data-intention-key]");
    if (!button) return;
    if (this.pendingApply || this.closed) {
      event.preventDefault?.();
      return;
    }
    const action = button.getAttribute("data-intention-action");
    if (action === "save-stage") {
      const input = this.contentEl?.querySelector?.("[data-intention-input]");
      if (input) this.stageDraft = String(input.value || "");
      event.preventDefault?.();
      void this.intentionSaveStage();
      return;
    }
    if (action) {
      event.preventDefault?.();
      this.intentionHandleAction(action);
      return;
    }
    const key = button.getAttribute("data-intention-key");
    if (key && !this.stage) {
      if (this.retained) this.intentionDiscardRetained(false);
      this.intentionSelect(key);
    }
  }

  intentionOnStageInput(event) {
    if (this.stage) this.stageDraft = String(event?.target?.value || "");
    try {
      const target = event?.target;
      if (target && target.tagName === "TEXTAREA" && target.getAttribute?.("data-intention-input") !== "reflection"
        && typeof bobSoftLineAutosize === "function") {
        bobSoftLineAutosize(target);
        return;
      }
    } catch (_) {}
    intentionCardEditorAutogrow(event?.target);
  }
}
