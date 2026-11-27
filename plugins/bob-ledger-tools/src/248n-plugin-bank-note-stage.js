// Category-card note stage (bank_row_notes note-stage). Space opens an
// in-card input in the caption's exact place; Enter writes the row's inline
// `— note` as its own undo step and returns to the same card on the same
// row: no tick, no advance, no session filing, no jump. The pure rules live
// in 246a (bankNoteNormalize, bankNoteWritePlan, bankNoteStagePreview).

const BANK_NOTE_STAGE_PLACEHOLDER = "What was this for?";
const BANK_NOTE_STAGE_HINT = "This note has links or fields — edit it on the row";
const BANK_NOTE_ROW_GONE = "Bank: the row is no longer open";
const BANK_NOTE_FRESH_MS = 600;
// Unmodified editing keys and the clipboard/undo/word chords the input
// handles natively. Everything else is swallowed so no hotkey leaks out.
const BANK_NOTE_STAGE_EDIT_KEYS = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End"];
const BANK_NOTE_STAGE_EDIT_CHORDS = ["a", "c", "v", "x", "z", "y", ...BANK_NOTE_STAGE_EDIT_KEYS];

function bankNoteStageInInput(event) {
  const target = event && event.target;
  return Boolean(target && typeof target.closest === "function" &&
    target.closest("input[data-bank-note-input]"));
}

// Up to two normalizer change chips, then "+N more"; each title says why.
function bankNoteChangeChips(changes) {
  const list = Array.isArray(changes) ? changes.filter(Boolean) : [];
  const chips = list.slice(0, 2).map((change) => ({
    text: change.to ? `${change.from} → ${change.to}` : `${change.from} dropped`,
    title: typeof change.why === "string" ? change.why : "",
  }));
  if (list.length > 2) {
    chips.push({
      text: `+${list.length - 2} more`,
      title: list.slice(2).map((change) => change.why).filter(Boolean).join("; "),
    });
  }
  return chips;
}

function bankNoteOutcomeText(action) {
  if (action === "remove") return "Note removed";
  if (action === "noop") return "No change";
  return "Note saved";
}

(function installBankNoteStage() {
  if (typeof BankCategoryCardModal !== "function") return;
  const proto = BankCategoryCardModal.prototype;

  proto.noteStagePreview = function noteStagePreview() {
    const stage = this.noteStage || {};
    return bankNoteStagePreview({
      draft: stage.draft,
      existingNote: stage.existing,
      editable: stage.editable !== false,
    });
  };

  proto.focusNoteInput = function focusNoteInput(selection = null) {
    const input = this.noteStageInput;
    if (!input || typeof input.focus !== "function") return false;
    try {
      input.focus();
      const length = String(input.value || "").length;
      const start = selection && Number.isInteger(selection.start) ? selection.start : length;
      const end = selection && Number.isInteger(selection.end) ? selection.end : length;
      input.setSelectionRange?.(start, end);
    } catch (_) {}
    return true;
  };

  proto.openNoteStage = function openNoteStage(options = {}) {
    const direct = Boolean(options && options.direct === true);
    if (this.closed || this.summary) return false;
    if (!direct && (this.busy || this.waitingRefresh)) return false;
    if (this.newStage || this.subscriptionPicker || this.subscriptionCreateStage) return false;
    if (this.noteStage) {
      this.focusNoteInput();
      return true;
    }
    const row = this.cardRow();
    const existing = typeof row.note === "string" && row.note ? row.note : null;
    if (existing && row.noteEditable === false) {
      this.noteHint = BANK_NOTE_STAGE_HINT;
      this.announce(BANK_NOTE_STAGE_HINT);
      try { this.paint(); } catch (_) {}
      return false;
    }
    // Edit starts from the raw note bytes so Bryan sees exactly the row.
    const raw = existing && typeof row.noteRaw === "string" && row.noteRaw ? row.noteRaw : (existing || "");
    this.noteHint = null;
    this.noteStage = {
      direct,
      draft: raw,
      query: raw,
      selectedKey: null,
      suggestions: Object.freeze([]),
      suggestionQuery: null,
      suggestionLibrary: null,
      existing,
      editable: true,
      refusal: null,
      saving: false,
    };
    this.noteStageHost = null;
    this.noteStageInput = null;
    try { this.paint(); } catch (_) {}
    this.focusNoteInput();
    return true;
  };

  proto.closeNoteStage = function closeNoteStage() {
    if (!this.noteStage) return false;
    this.noteStage = null;
    this.noteStageHost = null;
    this.noteStageInput = null;
    try { this.paint(); } catch (_) {}
    try { this.contentEl?.focus?.(); } catch (_) {}
    return true;
  };

  // Esc, Ctrl+[, and q outside the input back out one layer. The direct
  // command has no tile layer beneath, so it closes the card.
  proto.backOutNoteStage = function backOutNoteStage() {
    const stage = this.noteStage;
    if (!stage) return false;
    if (stage.saving) return true;
    if (stage.direct) {
      this.close();
      return true;
    }
    return this.closeNoteStage();
  };

  proto.shouldPassNoteStageKey = function shouldPassNoteStageKey(event) {
    if (!this.noteStage || !event || !bankNoteStageInInput(event)) return false;
    if (event.isComposing || event.keyCode === 229) return true;
    const key = typeof event.key === "string" ? event.key : "";
    if (!key || key === "Escape" || key === "Enter" || this.noteStage.saving) return false;
    if (key === " " && event.repeat === true) return false;
    if (event.ctrlKey && key === "[") return false;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return BANK_NOTE_STAGE_EDIT_CHORDS.includes(key.length === 1 ? key.toLowerCase() : key);
    }
    return key.length === 1 || BANK_NOTE_STAGE_EDIT_KEYS.includes(key);
  };

  proto.routeNoteStageKey = async function routeNoteStageKey(event) {
    const stage = this.noteStage;
    if (!stage || !event || event.isComposing || event.keyCode === 229) return;
    const key = bankCategoryUiEventKey(event);
    if (!key) return;
    const inInput = bankNoteStageInInput(event);
    if (key === "Escape" || key === "Ctrl+[" || (!inInput && (key === "q" || key === "Q"))) {
      bankCategoryUiConsume(event);
      this.backOutNoteStage();
      return;
    }
    if (key === "Enter" || key === "Ctrl+Enter") {
      // Ctrl+Enter saves too; it never files from inside the stage.
      bankCategoryUiConsume(event);
      if (event.repeat === true || stage.saving) return;
      await this.saveNoteStage();
      return;
    }
    if (typeof this.routeNoteSuggestKey === "function" &&
        this.routeNoteSuggestKey(event, key, inInput) === true) return;
    if (inInput && this.shouldPassNoteStageKey(event)) return;
    bankCategoryUiConsume(event);
    if (inInput || stage.saving || event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === " " && event.repeat === true) return;
    // Editor focus: the key focuses the input and is appended.
    if (key.length === 1) this.setNoteDraft(`${stage.draft || ""}${key}`);
    else if (key === "Backspace") this.setNoteDraft(String(stage.draft || "").slice(0, -1));
  };

  proto.setNoteDraft = function setNoteDraft(value) {
    const stage = this.noteStage;
    if (!stage) return false;
    stage.draft = String(value === null || value === undefined ? "" : value);
    stage.query = stage.draft;
    stage.selectedKey = null;
    stage.suggestionQuery = null;
    stage.refusal = null;
    const input = this.noteStageInput;
    if (input && input.value !== stage.draft) {
      try { input.value = stage.draft; } catch (_) {}
    }
    this.refreshNoteStage();
    this.focusNoteInput();
    return true;
  };

  proto.onNoteInput = function onNoteInput(value) {
    const stage = this.noteStage;
    if (!stage || stage.saving) return;
    stage.draft = String(value === null || value === undefined ? "" : value);
    stage.query = stage.draft;
    stage.selectedKey = null;
    stage.suggestionQuery = null;
    stage.refusal = null;
    this.refreshNoteStage();
  };

  proto.refuseNoteStage = function refuseNoteStage(message) {
    const text = typeof message === "string" && message ? message : BANK_NOTE_WRITE_REFUSAL;
    if (this.noteStage) {
      this.noteStage.saving = false;
      this.noteStage.refusal = text;
    }
    this.announce(text);
    this.refreshNoteStage();
    this.focusNoteInput();
    return false;
  };

  proto.saveNoteStage = async function saveNoteStage() {
    const stage = this.noteStage;
    if (!stage || stage.saving || this.closed) return false;
    if (this.noteStageInput && typeof this.noteStageInput.value === "string") {
      stage.draft = this.noteStageInput.value;
    }
    const preview = this.noteStagePreview();
    if (preview.refusal) return this.refuseNoteStage(preview.refusal);
    let result = { ok: true, action: "noop" };
    if (preview.action !== "noop") {
      if (!this.onNote) return this.refuseNoteStage(BANK_NOTE_WRITE_REFUSAL);
      stage.saving = true;
      try {
        result = await this.onNote(stage.draft, this);
      } catch (error) {
        result = { ok: false, message: error && error.message ? `Bank: ${error.message}` : BANK_NOTE_WRITE_REFUSAL };
      }
      if (this.closed || this.noteStage !== stage) return Boolean(result && result.ok);
      stage.saving = false;
      if (!result || result.ok !== true) return this.refuseNoteStage(result && result.message);
    }
    const outcome = bankNoteOutcomeText(result.action);
    const announced = result.saveError ? `${outcome} · not saved to disk yet` : outcome;
    if (stage.direct) {
      this.close();
      new Notice(`Bank: ${outcome.toLowerCase()}`);
      return true;
    }
    this.noteStage = null;
    this.noteStageHost = null;
    this.noteStageInput = null;
    this.noteFreshUntil = result.action === "insert" || result.action === "replace"
      ? Date.now() + BANK_NOTE_FRESH_MS
      : 0;
    // The save Enter's keyup must arrive before Enter can accept a category.
    this.chord = bankCategoryChordInit(true);
    this.announce(announced);
    try { this.paint(); } catch (_) {}
    try { this.contentEl?.focus?.(); } catch (_) {}
    return true;
  };

  proto.onNoteStageClick = function onNoteStageClick(event) {
    const target = event && event.target;
    if (this.noteStage) {
      // Inert tiles never file while staged; clicks in the stage stay native.
      const host = this.noteStageHost;
      const inside = Boolean(host && target && typeof host.contains === "function" && host.contains(target));
      if (!inside) bankCategoryUiConsume(event);
      return true;
    }
    const caption = target && typeof target.closest === "function"
      ? target.closest("button[data-bank-note-caption]")
      : null;
    if (!caption) return false;
    bankCategoryUiConsume(event);
    if (!caption.disabled) this.openNoteStage();
    return true;
  };

  proto.detachNoteStageHost = function detachNoteStageHost() {
    const host = this.noteStage ? this.noteStageHost : null;
    if (!host) return null;
    const input = this.noteStageInput;
    const doc = host.ownerDocument;
    let focus = null;
    if (input && doc && doc.activeElement === input) {
      focus = { start: input.selectionStart, end: input.selectionEnd };
    }
    if (host.parentNode) {
      try { host.parentNode.removeChild(host); } catch (_) {}
    }
    return focus;
  };

  proto.buildNoteStageHost = function buildNoteStageHost(doc) {
    const stage = this.noteStage;
    const host = bankCategoryUiEl(doc, "div", "bob-bank-category-note-stage");
    if (!host || !stage) return null;
    const line = bankCategoryUiAppend(host, "div", "bob-bank-category-note-line");
    bankCategoryUiAppend(line, "span", "bob-bank-category-note-dash", "—", { "aria-hidden": "true" });
    const field = bankCategoryUiAppend(line, "div", "bob-bank-category-note-field");
    const ghost = bankCategoryUiAppend(field, "span", "bob-bank-category-note-ghost", null, {
      "aria-hidden": "true",
    });
    const payee = this.cardRow().payee;
    // bob-text: literal bank row note; bank fields never complete [[ and bankNoteNormalize folds links to text
    const input = bankCategoryUiAppend(field, "input", "bob-bank-category-note-input", null, {
      type: "text",
      "data-bank-note-input": "true",
      placeholder: BANK_NOTE_STAGE_PLACEHOLDER,
      "aria-label": `Note for ${typeof payee === "string" && payee ? payee : "this row"}`,
      "aria-describedby": "bob-bank-category-note-status",
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      "aria-controls": "bob-bank-category-note-options",
      autocomplete: "off",
      enterkeyhint: "done",
    });
    if (input) {
      try { input.value = stage.draft || ""; } catch (_) {}
      input.addEventListener?.("input", (event) => {
        this.onNoteInput(event && event.target ? event.target.value : input.value);
      });
      input.addEventListener?.("keyup", () => this.refreshNoteSuggestions?.());
      input.addEventListener?.("click", () => this.refreshNoteSuggestions?.());
      input.addEventListener?.("select", () => this.refreshNoteSuggestions?.());
    }
    const list = bankCategoryUiAppend(host, "div", "bob-bank-category-note-options", null, {
      id: "bob-bank-category-note-options",
      role: "listbox",
      "aria-label": "Past notes",
    });
    const status = bankCategoryUiAppend(host, "div", "bob-bank-category-note-status", null, {
      id: "bob-bank-category-note-status",
    });
    this.noteStageHost = host;
    this.noteStageField = field;
    this.noteStageGhost = ghost;
    this.noteStageInput = input;
    this.noteStageList = list;
    this.noteStageStatus = status;
    return host;
  };

  // The consequence line, normalizer chips, refusal, and keys line update in
  // place so typing never rebuilds (and never blurs) the input.
  proto.refreshNoteStage = function refreshNoteStage() {
    const stage = this.noteStage;
    if (!stage) return;
    const preview = this.noteStagePreview();
    const status = this.noteStageStatus;
    if (status) {
      if (typeof status.replaceChildren === "function") status.replaceChildren();
      else status.textContent = "";
      const refusal = stage.refusal || preview.refusal;
      if (refusal) {
        bankCategoryUiAppend(status, "p", "bob-bank-category-note-refusal", refusal);
      } else {
        bankCategoryUiAppend(status, "p",
          `bob-bank-category-note-consequence${preview.action === "remove" ? " is-remove" : ""}`,
          preview.consequence);
      }
      const chips = bankNoteChangeChips(preview.changes);
      if (chips.length) {
        const row = bankCategoryUiAppend(status, "div", "bob-bank-category-note-changes");
        for (const chip of chips) {
          bankCategoryUiAppend(row, "span", "bob-bank-category-note-change", chip.text, {
            title: chip.title || null,
          });
        }
      }
    }
    try { this.refreshNoteSuggestions?.(); } catch (_) {}
    if (this.noteStageKeys) this.noteStageKeys.textContent = this.noteStageKeysText(preview);
  };

  proto.noteStageKeysText = function noteStageKeysText(preview = this.noteStagePreview()) {
    const base = preview.keys || "↵ save · esc back";
    const keys = this.noteStage && Array.isArray(this.noteStage.suggestions) && this.noteStage.suggestions.length
      ? `⇥ complete · ⌃N/⌃P choose · ${base}`
      : base;
    return this.noteStage && this.noteStage.direct ? keys.replace(/esc back$/, "esc close") : keys;
  };

  proto.paintNoteSlot = function paintNoteSlot(root, model, noteFocus) {
    if (this.noteStage) {
      const host = this.noteStageHost || this.buildNoteStageHost(root && root.ownerDocument);
      if (host && root && typeof root.appendChild === "function") root.appendChild(host);
      this.refreshNoteStage();
      if (noteFocus) this.focusNoteInput(noteFocus);
      return;
    }
    const header = (model && model.header) || {};
    if (!header.note) return;
    const fresh = Date.now() < (this.noteFreshUntil || 0);
    const classes = ["bob-bank-category-note"];
    if (fresh) classes.push("is-fresh");
    if (header.noteEditable === false) classes.push("is-structured");
    const button = bankCategoryUiAppend(root, "button", classes.join(" "), null, {
      type: "button",
      "data-bank-note-caption": "true",
      title: header.note,
      "aria-label": `Note: ${header.note}`,
    });
    if (!button) return;
    button.disabled = this.busy || this.waitingRefresh;
    bankCategoryUiAppend(button, "span", "bob-bank-category-note-dash", "—", { "aria-hidden": "true" });
    bankCategoryUiAppend(button, "span", "bob-bank-category-note-text", header.note);
  };

  // The tiles stay painted in place, dimmed and inert, while the stage owns
  // the keyboard.
  proto.stageNoteTiles = function stageNoteTiles(root) {
    const staged = ["bob-bank-category-section", "bob-bank-category-new-row", "bob-bank-category-footer"];
    for (const child of Array.from((root && root.children) || [])) {
      const classes = String(child.className || "").split(/\s+/);
      if (!staged.some((name) => classes.includes(name))) continue;
      child.className = `${child.className} is-staged`;
      try { child.setAttribute?.("inert", ""); } catch (_) {}
      try { child.inert = true; } catch (_) {}
    }
  };

  proto.paintNoteStageKeys = function paintNoteStageKeys(root) {
    this.noteStageKeys = bankCategoryUiAppend(root, "p", "bob-bank-category-keys", this.noteStageKeysText());
  };
})();

if (typeof BobLedgerToolsBankCategoryMixin === "function") {
  const mixin = BobLedgerToolsBankCategoryMixin.prototype;

  // `Bank: note this row`: set mode, directly in the note stage.
  mixin.bankCategoryNoteRow = function bankCategoryNoteRow(editor, view) {
    return this.bankCategoryOpenAtCursor(editor, view, "set", false, { noteDirect: true }) === true;
  };

  mixin.bankNoteIsolateHistory = function bankNoteIsolateHistory() {
    try {
      const commands = require("@codemirror/commands");
      const isolate = commands && commands.isolateHistory;
      return isolate && typeof isolate.of === "function" ? isolate : null;
    } catch (_) {
      return null;
    }
  };

  // One whole-line replacement, isolated in CM6 history so a filing key
  // pressed within the 500 ms grouping window stays its own undo step.
  mixin.bankNoteApplyEdits = function bankNoteApplyEdits(editor, plan) {
    if (!editor || !plan || plan.ok !== true) return null;
    const lineIndex = plan.line - 1;
    const raw = typeof editor.getLine === "function"
      ? editor.getLine(lineIndex)
      : String(editor.getValue() || "").split("\n")[lineIndex]?.replace(/\r$/, "");
    if (typeof raw !== "string") return null;
    const replacement = bankCategoryApplyLineEdits(raw, plan);
    if (replacement === null) return null;
    if (replacement === raw) return { raw, replacement };
    const cm = editor.cm;
    const isolate = this.bankNoteIsolateHistory();
    if (isolate && cm && cm.state && cm.state.doc && typeof cm.dispatch === "function") {
      try {
        const line = cm.state.doc.line(plan.line);
        if (line && line.text === raw) {
          cm.dispatch({
            changes: { from: line.from, to: line.to, insert: replacement },
            annotations: isolate.of("full"),
          });
          return { raw, replacement };
        }
      } catch (_) {}
    }
    if (typeof editor.replaceRange !== "function") return null;
    editor.replaceRange(replacement, { line: lineIndex, ch: 0 }, { line: lineIndex, ch: raw.length });
    return { raw, replacement };
  };

  // Unlike bankCategorySaveNote, report the persistence outcome.
  mixin.bankNoteSaveFile = async function bankNoteSaveFile(modal) {
    const path = modal && modal.context && modal.context.path;
    if (!path) return { ok: false, message: "no note path" };
    try {
      const view = modal.view;
      if (view && view.file && view.file.path === path && typeof view.save === "function") {
        await view.save();
        return { ok: true };
      }
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function"
        ? workspace.getLeavesOfType("markdown")
        : [];
      let saved = false;
      for (const leaf of Array.isArray(leaves) ? leaves : []) {
        const leafView = leaf && leaf.view;
        if (leafView && leafView.file && leafView.file.path === path && typeof leafView.save === "function") {
          await leafView.save();
          saved = true;
        }
      }
      return saved ? { ok: true } : { ok: false, message: "no open editor for the month note" };
    } catch (error) {
      return { ok: false, message: error && error.message ? String(error.message) : String(error) };
    }
  };

  // Writes the note and keeps the card on the row. It never calls the
  // session recorder, the next-waiting finder, bankCategoryRecordJump, or the
  // completion summary, and it never flips didInteract.
  mixin.bankNoteCommit = async function bankNoteCommit(modal, text) {
    if (!modal || modal.closed || modal !== this.bankCategoryModal) {
      return { ok: false, reason: "closed", message: BANK_NOTE_ROW_GONE };
    }
    const editor = modal.editor;
    if (!editor || typeof editor.getValue !== "function") {
      return { ok: false, reason: "closed", message: BANK_NOTE_ROW_GONE };
    }
    const context = modal.context || {};
    const plan = bankNoteWritePlan({
      capture: context.capture,
      currentPath: this.bankActiveFilePath(),
      currentSource: editor.getValue(),
      text,
    });
    if (!plan.ok) return { ok: false, reason: plan.reason, message: plan.message || BANK_NOTE_WRITE_REFUSAL };
    if (plan.action === "noop") return { ok: true, action: "noop", note: plan.note };
    const before = typeof editor.getCursor === "function" ? editor.getCursor() : null;
    const applied = this.bankNoteApplyEdits(editor, plan);
    if (!applied) return { ok: false, reason: "apply-failed", message: BANK_NOTE_WRITE_REFUSAL };
    const priorCh = before && Number.isInteger(before.ch) ? before.ch : 0;
    try {
      editor.setCursor?.({ line: plan.line - 1, ch: Math.max(0, Math.min(priorCh, applied.replacement.length)) });
    } catch (_) {}
    const saved = await this.bankNoteSaveFile(modal);
    const path = context.path;
    const next = this.bankCategoryContextAt(editor, { file: { path } }, plan.line);
    if (next) {
      // Re-capture so the next category key files this row, then re-anchor
      // the walk on the new text so text-keyed (ID-less) entries resolve.
      modal.context = next;
      let anchor = null;
      try { anchor = typeof this.bankWalkAnchor === "function" ? this.bankWalkAnchor() : null; } catch (_) {}
      const anchored = anchor && anchor.path === path && anchor.line === plan.line;
      if (modal.mode === "close" || anchored) {
        const row = { path, line: plan.line, date: next.row.date, text: next.capture.lineText };
        this.bankWalkHandOffOpenedRow(row);
        try {
          // A stale index entry would carry the old text (and, for ID-less
          // rows, a text-derived key); rebuild both from the new line.
          const after = this.bankWalkAnchor();
          if (after && after.text !== row.text) {
            const { key: _staleKey, ...rest } = after;
            this.bankWalkSetAnchor({ ...rest, ...row });
          }
        } catch (_) {}
      }
    }
    if (modal.mode === "close" && modal.session) {
      modal.session = bankCategorySessionNote(modal.session, Date.now());
      this.bankCategorySession = modal.session;
    }
    if (!saved.ok) new Notice(`Bank: the note is in the editor but was not saved (${saved.message})`);
    return {
      ok: true,
      action: plan.action,
      note: plan.note,
      line: plan.line,
      saveError: saved.ok ? null : saved.message,
    };
  };
}
