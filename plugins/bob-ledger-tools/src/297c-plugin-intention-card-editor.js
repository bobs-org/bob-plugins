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

function intentionCardEditorTargets(fields) {
  const list = fields && Array.isArray(fields.intentions) ? fields.intentions : [];
  const targets = list.map((value, index) => ({
    key: `intention:${index}`, kind: "intention", index,
    label: `Intention ${index + 1}`, value: String(value),
  }));
  targets.push({
    key: "reflection", kind: "reflection",
    label: "Reflection", value: fields && typeof fields.reflection === "string" ? fields.reflection : "",
  });
  targets.push({
    key: "summary", kind: "summary",
    label: "Summary", value: fields && typeof fields.summary === "string" ? fields.summary : "",
  });
  if (!list.length) {
    targets.unshift({ key: "add", kind: "add", label: "Add intention", value: "" });
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

function intentionCardEditorEscLadder({ stage, pendingApply } = {}) {
  if (pendingApply === true) return "ignore";
  if (stage) return "cancel-stage";
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
    this.malformed = options.malformed === true || this.fields === null;
    this.fingerprint = typeof options.fingerprint === "string" ? options.fingerprint : "";
    this.latestReport = options.report || null;
    this.writable = options.writable !== false && !this.malformed;
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
    this.closed = false;
    this.retainedOps = null;
    this.retainedSelection = "";
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
      { subject: this.subject, subjectPath: this.subjectPath, expect: this.fingerprint },
      deps,
    );
    return this.session;
  }

  intentionSelect(key) {
    const target = intentionCardEditorTargetByKey(this.intentionTargets(), key);
    if (!target) return;
    this.selectedKey = key;
    this.announce = target.label;
    this.paintIntentionCard();
  }

  intentionMove(delta) {
    const next = intentionCardEditorNavigate(this.intentionTargets(), this.selectedKey, delta);
    if (next) this.intentionSelect(next);
  }

  intentionOpenStage(kind, fieldKey) {
    const target = intentionCardEditorTargetByKey(this.intentionTargets(), fieldKey || this.selectedKey);
    if (!target || !kind) return false;
    if (kind === "summary" && this.fields && this.fields.summaryState === "agent" && !this.stageExplained) {
      this.stageExplained = true;
      this.stageNote = INTENTION_CARD_EDITOR_SUMMARY_EXPLAINER;
    }
    this.selectedKey = target.key;
    this.stage = { kind, field: target.key, index: target.index };
    this.stageDraft = target.kind === "intention" ? target.value
      : target.kind === "reflection" ? target.value
      : target.kind === "summary" ? target.value : "";
    if (target.kind === "add") {
      this.stage = { kind: "intention", field: "add", index: this.fields ? this.fields.intentions.length : 0 };
      this.stageDraft = "";
    }
    this.stagePreview = null;
    this.paintIntentionCard();
    return true;
  }

  intentionCancelStage() {
    this.stage = null;
    this.stageDraft = "";
    this.stageNote = "";
    this.stagePreview = null;
    this.stageExplained = false;
    this.paintIntentionCard();
  }

  intentionHandleEscape() {
    return intentionCardEditorEscLadder({ stage: this.stage, pendingApply: this.pendingApply });
  }

  intentionBackOut(event) {
    const action = this.intentionHandleEscape();
    try { event?.preventDefault?.(); } catch (_) {}
    try { event?.stopPropagation?.(); } catch (_) {}
    try { event.__schemaEscapeHandled = true; } catch (_) {}
    if (action === "cancel-stage") this.intentionCancelStage();
    else if (action === "close") this.close();
    return action;
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
      stage: this.stage, undoAvailable, announce: this.announce,
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
    };
  }

  paintIntentionCard() {
    if (this.closed) return;
    const doc = this.intentionDoc();
    if (!doc) return;
    const options = this.intentionPaintOptions();
    let card = null;
    try { card = this.contentEl?.querySelector?.(".bob-intention-card-editor"); } catch (_) {}
    if (!card) {
      try { this.contentEl?.empty?.(); } catch (_) {}
      card = intentionCardEditorBuildEl(options, doc, this);
      if (card) {
        try { this.contentEl?.appendChild?.(card); } catch (_) {}
      }
      this.intentionRestoreFocus();
      return;
    }
    try { intentionCardEditorPaintAll(card, options, doc, this); } catch (_) {}
    this.intentionRestoreFocus();
  }

  // Browse controls keep focus: the modal never auto-focuses a stage input.
  intentionRestoreFocus() {
    try {
      const card = this.contentEl?.querySelector?.(".bob-intention-card-editor");
      if (!card || this.stage) return;
      const row = card.querySelector?.(`[data-intention-key="${this.selectedKey}"]`);
      if (row && typeof row.focus === "function") row.focus();
    } catch (_) {}
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
    try {
      if (typeof bobCardUnwireCloseKeys === "function") bobCardUnwireCloseKeys(this);
    } catch (_) {}
    try { this.session?.close?.(); } catch (_) {}
    this.session = null;
  }

  async intentionInitialRead() {
    if (this.closed || this.malformed) return;
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
      this.latestReport = result.report;
      this.fingerprint = typeof result.report.fingerprint_before === "string" ? result.report.fingerprint_before : this.fingerprint;
      try { this.session?.rebase?.(this.fingerprint); } catch (_) {}
      const after = result.report.after || {};
      this.fields = {
        intentions: Array.isArray(after.intentions) ? after.intentions.map(String) : (this.fields?.intentions || []),
        summary: typeof after.summary === "string" ? after.summary : (this.fields?.summary || ""),
        reflection: typeof after.reflection === "string" ? after.reflection : (this.fields?.reflection || ""),
        summaryState: this.fields?.summaryState || "",
        summaryDrafted: this.fields?.summaryDrafted || "",
      };
      if (this.statusKind === "reading") this.statusKind = this.writable ? "browsing" : "read-only";
      this.paintIntentionCard();
      return;
    }
    this.intentionConsumeFailure(result);
  }

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
    }
    this.sessionState = this.session?.getState?.() || this.sessionState;
    this.paintIntentionCard();
  }

  intentionOpsForStage(draft) {
    if (!this.stage) return null;
    const text = String(draft === undefined ? this.stageDraft : draft);
    if (this.stage.kind === "intention") {
      const { value } = intentionCardNormalizeIntentionLine(text);
      if (!value) return null;
      if (this.stage.field === "add") {
        const count = this.fields ? this.fields.intentions.length : 0;
        return intentionOpsInsert(this.stage.index != null ? this.stage.index : count, value);
      }
      return intentionOpsReplace(this.stage.index, value);
    }
    if (this.stage.kind === "reflection") return intentionOpsReflection(text);
    if (this.stage.kind === "summary") return intentionOpsSummary(text);
    return null;
  }

  async intentionSaveStage(options = {}) {
    if (!this.stage || this.pendingApply || !this.writable) return null;
    const ops = this.intentionOpsForStage();
    if (!ops) {
      if (this.stage.kind === "intention") {
        this.stageNote = "An intention needs one line of text.";
        this.paintIntentionCard();
      }
      return null;
    }
    const seq = this.intentionReadSeq();
    this.pendingApply = true;
    this.statusKind = "saving";
    this.stageNote = options.note || this.stageNote;
    this.paintIntentionCard();
    const plugin = this.intentionPlugin;
    try {
      if (typeof albumSchemaSaveOpenEditors === "function" && plugin) {
        const saved = await albumSchemaSaveOpenEditors(plugin, [this.subjectPath]);
        if (!this.intentionLive(seq)) return null;
        if (!saved || saved.ok !== true) {
          this.pendingApply = false;
          this.retainedOps = ops;
          this.retainedSelection = this.selectedKey;
          this.statusKind = "save-blocked";
          this.refusalMessage = saved?.message || "Open editors could not confirm they are saved.";
          this.refusalHint = "Save every pane showing the note in Source mode, then press Enter to retry. Nothing was written.";
          this.paintIntentionCard();
          return null;
        }
      }
    } catch (_) {}
    if (!this.intentionLive(seq)) return null;
    const session = this.ensureIntentionSession();
    try { session.rebase?.(this.fingerprint); } catch (_) {}
    session.setDraft(ops);
    const preview = await session.previewNow();
    if (!this.intentionLive(seq)) return null;
    if (!preview || preview.ok !== true || !preview.report || preview.report.ok !== true) {
      this.pendingApply = false;
      return this.intentionRetainAfterRefusal(preview, ops);
    }
    const applied = await session.apply();
    if (!this.intentionLive(seq)) return null;
    this.pendingApply = false;
    this.sessionState = session.getState();
    if (!applied || applied.ok !== true) {
      return this.intentionRetainAfterRefusal(applied, ops);
    }
    if (applied.changed === true && applied.report) {
      this.intentionConsumeApplied(applied.report, options);
      return applied;
    }
    this.stage = null;
    this.stageDraft = "";
    this.stageNote = "";
    this.statusKind = "saved";
    this.announce = INTENTION_CARD_EDITOR_SAVED_TEXT;
    this.paintIntentionCard();
    return applied;
  }

  intentionRetainAfterRefusal(result, ops) {
    const code = result && (result.code || (result.report?.error?.code)) || "";
    if (code === "stale_note" || (result && result.kind === "stale")) {
      this.retainedOps = Array.isArray(ops) ? ops : null;
      this.retainedSelection = this.selectedKey;
      this.statusKind = "stale";
      this.refusalMessage = INTENTION_CARD_EDITOR_STALE_TEXT;
      this.refusalHint = "Review the refreshed list, then press Enter to retry. Nothing was silently applied.";
      const fresh = result && result.report && typeof result.report.fingerprint_before === "string"
        ? result.report.fingerprint_before : "";
      if (fresh) {
        this.fingerprint = fresh;
        try { this.session?.rebase?.(fresh); } catch (_) {}
      }
      if (result && result.report && result.report.ok === true && result.report.after) {
        const after = result.report.after;
        this.fields = {
          intentions: Array.isArray(after.intentions) ? after.intentions.map(String) : [],
          summary: typeof after.summary === "string" ? after.summary : "",
          reflection: typeof after.reflection === "string" ? after.reflection : "",
          summaryState: this.fields?.summaryState || "",
          summaryDrafted: this.fields?.summaryDrafted || "",
        };
      }
      this.sessionState = this.session?.getState?.() || this.sessionState;
      this.paintIntentionCard();
      return result;
    }
    this.retainedOps = Array.isArray(ops) ? ops : this.retainedOps;
    this.retainedSelection = this.selectedKey;
    this.sessionState = this.session?.getState?.() || this.sessionState;
    this.intentionConsumeFailure(result || { ok: false, code: "failed", message: "The intention write failed." });
    return result;
  }

  intentionConsumeApplied(report, options = {}) {
    this.latestReport = report;
    this.fingerprint = typeof report.fingerprint_after === "string" ? report.fingerprint_after : this.fingerprint;
    try { this.session?.rebase?.(this.fingerprint); } catch (_) {}
    const after = report.after || {};
    this.fields = {
      intentions: Array.isArray(after.intentions) ? after.intentions.map(String) : [],
      summary: typeof after.summary === "string" ? after.summary : "",
      reflection: typeof after.reflection === "string" ? after.reflection : "",
      summaryState: this.fields?.summaryState || "",
      summaryDrafted: this.fields?.summaryDrafted || "",
    };
    this.retainedOps = null;
    const wasSummary = this.stage && this.stage.kind === "summary";
    if (wasSummary && this.fields.summary) {
      this.fields.summaryState = "edited";
      this.fields.summaryDrafted = "";
    }
    const nextKey = this.stage && this.stage.kind === "intention" && this.stage.field !== "add"
      ? this.stage.field : this.selectedKey;
    this.stage = null;
    this.stageDraft = "";
    this.stageNote = "";
    this.stagePreview = null;
    this.selectedKey = intentionCardEditorTargetByKey(this.intentionTargets(), nextKey) ? nextKey : this.intentionTargets()[0]?.key || "";
    this.statusKind = "saved";
    this.announce = INTENTION_CARD_EDITOR_SAVED_TEXT;
    this.consequence = "";
    if (options.close === true) {
      this.paintIntentionCard();
      this.close();
      return;
    }
    this.paintIntentionCard();
  }

  async intentionRetry() {
    if (this.statusKind !== "stale" && this.statusKind !== "save-blocked") return null;
    if (!this.retainedOps) return null;
    const ops = this.retainedOps;
    this.retainedOps = null;
    if (this.retainedSelection && intentionCardEditorTargetByKey(this.intentionTargets(), this.retainedSelection)) {
      this.selectedKey = this.retainedSelection;
    }
    const stage = this.stage;
    if (!stage) {
      const target = this.intentionSelected();
      const kind = intentionCardEditorStageFor(target);
      if (kind) this.intentionOpenStage(kind, target.key);
    }
    return this.intentionSaveStage({ retried: true });
  }

  async intentionUndo() {
    if (this.pendingApply) return null;
    const seq = this.intentionReadSeq();
    this.statusKind = "saving";
    this.paintIntentionCard();
    const session = this.ensureIntentionSession();
    const result = await session.undo();
    if (!this.intentionLive(seq)) return null;
    this.sessionState = session.getState();
    if (!result || result.ok !== true) {
      this.statusKind = "refusal";
      this.refusalMessage = (result && (result.message || result.report?.error?.message)) || "There is no edit to undo.";
      this.refusalHint = "";
      this.paintIntentionCard();
      return result;
    }
    if (result.changed === true && result.report) {
      this.intentionConsumeApplied(result.report);
      return result;
    }
    this.statusKind = "browsing";
    this.announce = "Nothing to undo.";
    this.paintIntentionCard();
    return result;
  }

  async intentionReorder(delta) {
    const target = this.intentionSelected();
    if (!target || target.kind !== "intention" || !this.writable) return null;
    const list = this.fields ? this.fields.intentions.slice() : [];
    const to = target.index + delta;
    if (to < 0 || to >= list.length) return null;
    const reordered = intentionCardReorderedList(list, target.index, to);
    const ops = intentionOpsMove(target.index, to);
    void reordered;
    const seq = this.intentionReadSeq();
    this.pendingApply = true;
    this.statusKind = "saving";
    this.paintIntentionCard();
    const session = this.ensureIntentionSession();
    try { session.rebase?.(this.fingerprint); } catch (_) {}
    session.setDraft(ops);
    const preview = await session.previewNow();
    if (!this.intentionLive(seq)) return null;
    if (!preview || preview.ok !== true) {
      this.pendingApply = false;
      return this.intentionRetainAfterRefusal(preview, ops);
    }
    const applied = await session.apply();
    if (!this.intentionLive(seq)) return null;
    this.pendingApply = false;
    this.sessionState = session.getState();
    if (!applied || applied.ok !== true) return this.intentionRetainAfterRefusal(applied, ops);
    if (applied.changed === true && applied.report) {
      this.intentionConsumeApplied(applied.report);
      this.selectedKey = `intention:${to}`;
      this.paintIntentionCard();
    }
    return applied;
  }

  async intentionRemove() {
    const target = this.intentionSelected();
    if (!target || target.kind !== "intention" || !this.writable || this.pendingApply) return null;
    const ops = intentionOpsRemove(target.index);
    const seq = this.intentionReadSeq();
    this.pendingApply = true;
    this.statusKind = "saving";
    this.paintIntentionCard();
    const session = this.ensureIntentionSession();
    try { session.rebase?.(this.fingerprint); } catch (_) {}
    session.setDraft(ops);
    const preview = await session.previewNow();
    if (!this.intentionLive(seq)) return null;
    if (!preview || preview.ok !== true) {
      this.pendingApply = false;
      return this.intentionRetainAfterRefusal(preview, ops);
    }
    const applied = await session.apply();
    if (!this.intentionLive(seq)) return null;
    this.pendingApply = false;
    this.sessionState = session.getState();
    if (!applied || applied.ok !== true) return this.intentionRetainAfterRefusal(applied, ops);
    if (applied.changed === true && applied.report) {
      this.intentionConsumeApplied(applied.report);
      const count = this.fields ? this.fields.intentions.length : 0;
      this.selectedKey = count ? `intention:${Math.min(target.index, count - 1)}` : "add";
      this.paintIntentionCard();
    }
    return applied;
  }

  intentionHandleAction(action, payload = {}) {
    if (!action || this.closed) return null;
    if (action === "close") { this.close(); return null; }
    if (action === "cancel-stage") { this.intentionCancelStage(); return null; }
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
      const target = this.intentionSelected();
      const count = this.fields ? this.fields.intentions.length : 0;
      const at = target && target.kind === "intention"
        ? target.index + (action === "insert-below" ? 1 : 0)
        : (action === "insert-below" ? count : 0);
      this.stage = { kind: "intention", field: "add", index: Math.max(0, Math.min(count, at)) };
      this.stageDraft = "";
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
    if (action === "retry") { void this.intentionRetry(); return null; }
    return null;
  }

  intentionOnKeyDown(event) {
    if (!event || event.isComposing || event.keyCode === 229) return;
    if (event.defaultPrevented || event.__schemaEscapeHandled) return;
    if (this.pendingApply) return;
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
      if (event.key === "Enter" && (event.ctrlKey === true || event.metaKey === true)) {
        event.preventDefault?.();
        void this.intentionSaveStage({ close: true });
      }
      return;
    }
    const action = intentionCardEditorKeyAction(event, {
      inInput: this.intentionInInput(event), stage: null, selected: this.intentionSelected(),
    });
    if (!action) return;
    if (action === "retry" || this.statusKind === "stale" || this.statusKind === "save-blocked") {
      if (event.key === "Enter" && !this.intentionInInput(event)) {
        event.preventDefault?.();
        void this.intentionRetry();
        return;
      }
    }
    if (action === "edit-selected" && this.selectedKey === "summary") {
      event.preventDefault?.();
      this.intentionOpenStage("summary", "summary");
      return;
    }
    event.preventDefault?.();
    this.intentionHandleAction(action);
  }

  intentionOnClick(event) {
    const button = event?.target?.closest?.("button[data-intention-action], button[data-intention-key]");
    if (!button) return;
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
    if (key) this.intentionSelect(key);
  }

  intentionOnStageInput(event) {
    if (this.stage) this.stageDraft = String(event?.target?.value || "");
  }
}

function intentionCardEditorBuildEl(options, doc, modal) {
  const host = intentionCardEditorCreateEl(doc, "div", "bob-intention-card-editor");
  if (!host) return null;
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", `Edit intentions · ${options.subject || options.subjectPath}`);
  intentionCardEditorPaintAll(host, options, doc, modal);
  try {
    host.addEventListener?.("click", (event) => modal?.intentionOnClick?.(event));
    host.addEventListener?.("keydown", (event) => modal?.intentionOnKeyDown?.(event));
    host.addEventListener?.("input", (event) => {
      if (event?.target?.hasAttribute?.("data-intention-input")) modal?.intentionOnStageInput?.(event);
    });
  } catch (_) {}
  return host;
}

function intentionCardEditorRowButton(doc, host, target, selected) {
  const button = intentionCardEditorCreateEl(doc, "button", "bob-intention-row");
  if (!button) return null;
  button.setAttribute("type", "button");
  button.setAttribute("data-intention-key", target.key);
  if (selected) button.setAttribute("aria-current", "true");
  const keycap = target.kind === "intention" && target.index < 9
    ? `${target.index + 1} ` : target.kind === "add" ? "+ " : "";
  intentionCardEditorSetText(button, `${keycap}${target.label}${target.value ? ` — ${target.value.slice(0, 80)}` : ""}`);
  host.appendChild(button);
  return button;
}

function intentionCardEditorPaintAll(host, options, doc, modal) {
  while (host.firstChild) host.removeChild(host.firstChild);
  const title = intentionCardEditorCreateEl(doc, "h2", "bob-intention-editor-title");
  intentionCardEditorSetText(title, `Edit intentions · ${options.subject || options.subjectPath}`);
  host.appendChild(title);

  const list = intentionCardEditorCreateEl(doc, "div", "bob-intention-editor-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Intention fields");
  for (const target of options.targets) {
    intentionCardEditorRowButton(doc, list, target, target.key === options.selectedKey);
  }
  host.appendChild(list);

  if (options.softCapHint) {
    const hint = intentionCardEditorCreateEl(doc, "p", "bob-intention-editor-hint");
    intentionCardEditorSetText(hint, options.softCapHint);
    host.appendChild(hint);
  }

  if (options.stage) {
    const stageHost = intentionCardEditorCreateEl(doc, "div", "bob-intention-editor-stage");
    const label = intentionCardEditorCreateEl(doc, "label", "bob-intention-stage-label");
    const target = intentionCardEditorTargetByKey(options.targets, options.stage.field);
    intentionCardEditorSetText(label, target ? `${target.label} · Enter saves · Esc cancels` : "Edit");
    stageHost.appendChild(label);
    if (options.stage.kind === "summary" && options.fields) {
      const current = intentionCardEditorCreateEl(doc, "p", "bob-intention-stage-current");
      intentionCardEditorSetText(current, `Current: ${options.fields.summary || "(empty)"}`);
      stageHost.appendChild(current);
    }
    const input = options.stage.kind === "reflection"
      ? intentionCardEditorCreateEl(doc, "textarea", "bob-intention-stage-input")
      : intentionCardEditorCreateEl(doc, "input", "bob-intention-stage-input");
    if (input) {
      input.setAttribute("data-intention-input", options.stage.kind);
      input.value = String(options.stageDraft || "");
      stageHost.appendChild(input);
    }
    if (options.stageNote) {
      const note = intentionCardEditorCreateEl(doc, "p", "bob-intention-stage-note");
      intentionCardEditorSetText(note, options.stageNote);
      stageHost.appendChild(note);
    }
    const save = intentionCardEditorCreateEl(doc, "button", "bob-intention-stage-save");
    save.setAttribute("type", "button");
    save.setAttribute("data-intention-action", "save-stage");
    intentionCardEditorSetText(save, "Save");
    stageHost.appendChild(save);
    host.appendChild(stageHost);
  }

  const status = intentionCardEditorCreateEl(doc, "p", "bob-intention-editor-status");
  const model = options.status;
  intentionCardEditorSetText(status, [
    model.announce, model.refusalMessage, model.refusalHint,
    model.statusKind === "stale" ? INTENTION_CARD_EDITOR_STALE_TEXT : "",
  ].filter(Boolean).join(" · ") || model.statusKind);
  host.appendChild(status);
}
