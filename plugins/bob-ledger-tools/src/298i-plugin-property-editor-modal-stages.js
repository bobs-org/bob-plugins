// Property editor stage DOM, draft controller, preview latch, and lifecycle.
function propertyEditorStageIdentity(stage) {
  return stage ? `${stage.id}:${stage.rowId}:${stage.kind}` : "";
}

function propertyEditorStageFilterSuggestions(values, filter, tags = false) {
  const text = tags ? propertyEditorNormalizeTag(filter).toLowerCase() : String(filter || "").trim().toLowerCase();
  return (Array.isArray(values) ? values : []).filter((entry) => {
    const value = String(entry && entry.value || "");
    return !text || value.toLowerCase().includes(text);
  }).slice(0, 12);
}

function propertyEditorPaintStage(doc, host, options, modal) {
  if (!doc || !host || !options) return null;
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage");
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("aria-label", `Edit ${options.key}`);
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, `${options.key} · ${options.label}`);
  panel.appendChild(title);
  if (options.collection) {
    const chips = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-chips");
    chips.setAttribute("role", "list");
    chips.setAttribute("aria-label", `${options.key} values`);
    for (const [index, item] of options.items.entries()) {
      const chip = propertyEditorCreateEl(doc, "span", "bob-property-editor-stage-chip");
      chip.setAttribute("role", "listitem");
      const label = propertyEditorCreateEl(doc, "span", "bob-property-editor-stage-chip-label");
      const display = String(item == null ? "null" : item);
      propertyEditorSetText(label, options.kind === "tags" ? `#${display}` : display);
      chip.appendChild(label);
      const remove = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-chip-remove");
      remove.setAttribute("type", "button");
      remove.setAttribute("data-property-stage-action", "remove-item");
      remove.setAttribute("data-property-stage-index", String(index));
      remove.setAttribute("aria-label", `Remove ${display}`);
      propertyEditorSetText(remove, "×");
      chip.appendChild(remove);
      chips.appendChild(chip);
    }
    panel.appendChild(chips);
  }
  const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-stage-label");
  const inputId = `bob-property-editor-stage-input-${options.stageId}`;
  label.setAttribute("for", inputId);
  propertyEditorSetText(label, options.collection ? "Add value" : `New ${options.label.toLowerCase()} value`);
  panel.appendChild(label);
  const inputKey = `property-stage-${options.stageId}`;
  let input = options.keptInput || null;
  if (!input) {
    if (options.kind === "text") {
      // bob-text: prose S16 text and list property values use nav proseField.
      input = propertyEditorCreateEl(doc, "textarea", "bob-property-editor-stage-input is-text");
      input.setAttribute("rows", "3");
    } else {
      // bob-text: prose S16 text and list property values use nav proseField.
      input = propertyEditorCreateEl(doc, "input", "bob-property-editor-stage-input");
      input.setAttribute("type", "text");
      input.setAttribute("inputmode", options.kind === "number" ? "decimal" : "text");
    }
    input.value = options.value;
  } else if (!options.composing && String(input.value == null ? "" : input.value) !== options.value) {
    input.value = options.value;
  }
  input.setAttribute("id", inputId);
  input.setAttribute("data-property-stage-input", inputKey);
  input.setAttribute("data-property-stage-id", String(options.stageId));
  input.setAttribute("data-property-stage-kind", options.kind);
  input.setAttribute("aria-label", `${options.key} ${options.label.toLowerCase()}`);
  input.setAttribute("autocomplete", options.kind === "tags" ? "off" : "on");
  if (options.disabled) input.disabled = true;
  else input.disabled = false;
  if (!input.parentNode || input.parentNode !== panel) panel.appendChild(input);
  let band = options.keptBand || null;
  if (options.prose) {
    if (!band) band = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-prose");
    band.setAttribute("data-property-stage-band", String(options.stageId));
    panel.appendChild(band);
  }
  if (options.collection && typeof modal?.propertyEditorStageAddItem === "function") {
    const add = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-add");
    add.setAttribute("type", "button");
    add.setAttribute("data-property-stage-action", "add-item");
    add.setAttribute("aria-label", "Add value");
    propertyEditorSetText(add, "Add");
    panel.appendChild(add);
  }
  if (options.suggestions && options.suggestions.length) {
    const list = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-suggestions");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", options.kind === "tags" ? "Vault tags" : `Existing ${options.key} values`);
    for (const [index, suggestion] of options.suggestions.entries()) {
      const button = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-suggestion");
      button.setAttribute("type", "button");
      button.setAttribute("role", "option");
      button.setAttribute("data-property-stage-action", "pick-suggestion");
      button.setAttribute("data-property-stage-index", String(index));
      button.setAttribute("aria-label", String(suggestion.value));
      propertyEditorSetText(button, `${options.kind === "tags" ? "#" : ""}${suggestion.value}${suggestion.count ? ` · ${suggestion.count}` : ""}`);
      list.appendChild(button);
    }
    panel.appendChild(list);
  }
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  preview.setAttribute("aria-live", "polite");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  const actions = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Property value actions");
  const save = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-save");
  save.setAttribute("type", "button");
  save.setAttribute("data-property-stage-action", "save");
  save.disabled = options.disabled;
  propertyEditorSetText(save, "Save");
  actions.appendChild(save);
  const cancel = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-cancel");
  cancel.setAttribute("type", "button");
  cancel.setAttribute("data-property-stage-action", "cancel");
  propertyEditorSetText(cancel, "Cancel");
  actions.appendChild(cancel);
  panel.appendChild(actions);
  host.appendChild(panel);
  return { panel, input, band };
}

function propertyEditorStageLabels(kind) {
  return ({
    text: "Text", number: "Number", date: "Date", datetime: "Date & time",
    list: "List", tags: "Tags", aliases: "Aliases", checkbox: "Checkbox",
  })[kind] || "Value";
}

function propertyEditorStageOpsJson(ops) {
  try { return JSON.stringify(Array.isArray(ops) ? ops : []); } catch (_) { return ""; }
}

const propertyEditorPaintBeforeStages = PropertyEditorModal.prototype.paintPropertyEditor;
const propertyEditorActivateBeforeStages = PropertyEditorModal.prototype.propertyEditorActivate;
const propertyEditorSelectBeforeStages = PropertyEditorModal.prototype.propertyEditorSelect;
const propertyEditorClickBeforeStages = PropertyEditorModal.prototype.propertyEditorOnClick;
const propertyEditorKeyBeforeStages = PropertyEditorModal.prototype.propertyEditorOnKeyDown;
const propertyEditorBackOutBeforeStages = PropertyEditorModal.prototype.propertyEditorBackOut;
const propertyEditorReconcileBeforeStages = PropertyEditorModal.prototype.propertyEditorReconcile;
const propertyEditorOpenBeforeStages = PropertyEditorModal.prototype.onOpen;
const propertyEditorCloseBeforeStages = PropertyEditorModal.prototype.onClose;
const propertyEditorCaptureCaretBeforeStages = PropertyEditorModal.prototype.editorCaptureCaret;
const propertyEditorRestoreFocusBeforeStages = PropertyEditorModal.prototype.editorRestoreFocus;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorStageEntry(row) {
    const index = this.editorOrderedRows().findIndex((entry) => entry.row === row || (entry.row.key === row?.key && entry.row.line === row?.line));
    if (index < 0) return null;
    return this.editorOrderedRows()[index];
  }
,
  propertyEditorStageFindRow(stage = this.stage) {
    if (!stage) return null;
    const rows = this.editorOrderedRows();
    const exact = rows.find((entry) => entry.id === stage.rowId);
    if (exact) return exact;
    const sameKey = rows.filter((entry) => entry.row.key === stage.key);
    if (!sameKey.length) return null;
    const wantedLine = Number.isInteger(stage.line) ? stage.line : 0;
    sameKey.sort((left, right) => Math.abs((left.row.line || 0) - wantedLine) - Math.abs((right.row.line || 0) - wantedLine));
    stage.rowId = sameKey[0].id;
    stage.line = sameKey[0].row.line;
    return sameKey[0];
  }
,
  propertyEditorStageView() {
    const stage = this.stage;
    const entry = this.propertyEditorStageFindRow(stage);
    if (!stage || !entry) return null;
    const suggestions = stage.kind === "tags"
      ? propertyEditorStageFilterSuggestions(stage.suggestionCatalog || [], stage.itemDraft, true)
      : ["text", "list", "aliases"].includes(stage.kind)
        ? propertyEditorStageFilterSuggestions(stage.suggestionCatalog || [], stage.kind === "text" ? stage.value : stage.itemDraft)
        : [];
    const retained = this._propertyStageRetained;
    const sameRetained = retained && retained.stageId === stage.id;
    return {
      stageId: stage.id,
      key: entry.row.key,
      row: entry.row,
      kind: stage.kind,
      label: propertyEditorStageLabels(stage.kind),
      value: String(stage.value == null ? "" : stage.value),
      items: Array.isArray(stage.items) ? stage.items.slice() : [],
      itemDraft: String(stage.itemDraft || ""),
      collection: ["list", "tags", "aliases"].includes(stage.kind),
      suggestions,
      selectedSuggestion: Number.isInteger(stage.suggestionIndex) ? stage.suggestionIndex : -1,
      previewText: stage.previewText || "",
      disabled: this.pendingApply === true,
      composing: this.stageComposing === true,
      prose: stage.kind === "text" || stage.kind === "list",
      keptInput: sameRetained ? retained.input : null,
      keptBand: sameRetained ? retained.band : null,
    };
  }
,
  propertyEditorStageDataFrom(row, kind) {
    const config = { kind, wireKind: kind === "text" ? "text" : kind };
    return { ...config, ...propertyEditorStageSeed(row, kind) };
  }
,
  propertyEditorOpenStage(entry) {
    if (!entry || this.closed || this.pendingApply) return false;
    const decision = propertyEditorActionForRow(entry.row);
    if (decision.action !== "edit") return false;
    const kind = propertyEditorStageKindForRow(entry.row);
    if (!kind) {
      this.refusal = { code: "unsupported-kind", message: `“${entry.row.key}” uses a value type that is not available in this stage.`, hint: "y opens YAML." };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.paintPropertyEditor();
      return false;
    }
    if (!propertyEditorStageListShape(entry.row, kind)) {
      this.refusal = { code: "scalar-list", message: `“${entry.row.key}” is a scalar value reported as a list.`, hint: "Use YAML to preserve its shape." };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.paintPropertyEditor();
      return false;
    }
    this.propertyEditorCancelStage({ quiet: true });
    const seeded = propertyEditorStageSeed(entry.row, kind);
    this.stageSeq = (this.stageSeq || 0) + 1;
    this.stage = {
      id: this.stageSeq,
      rowId: entry.id,
      key: entry.row.key,
      line: entry.row.line,
      kind,
      wireKind: kind,
      value: seeded.value ?? "",
      items: seeded.items || [],
      itemDraft: "",
      revision: 0,
      previewText: "",
      suggestionIndex: -1,
      suggestionCatalog: kind === "tags"
        ? propertyEditorTagSuggestions(this.app)
        : ["text", "list", "aliases"].includes(kind)
          ? propertyEditorSuggestValues(this.app, entry.row.key, this.filePath)
          : [],
    };
    this.pendingStageEnter = null;
    this.stageComposing = false;
    this.stageNeedsPreview = false;
    this.refusal = null;
    this.status = { kind: "ready", text: "" };
    this.announce = "";
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorCurrentStageDraft() {
    if (!this.stage) return null;
    return { value: this.stage.value, items: this.stage.items.slice(), itemDraft: this.stage.itemDraft };
  }
,
  propertyEditorBuildCurrentStage() {
    const entry = this.propertyEditorStageFindRow();
    if (!entry || !this.stage) return { ok: false, message: "The property is no longer available." };
    return propertyEditorStageBuild(entry.row, this.stage, this.propertyEditorCurrentStageDraft(), {
      now: this.propertyEditorNow,
      timeZone: this.propertyEditorTimeZone,
    });
  }
,
  propertyEditorStagePreviewText(built) {
    if (!built || built.ok !== true) return built?.message || "Enter a valid value.";
    if (this.stage?.kind === "list" || this.stage?.kind === "tags" || this.stage?.kind === "aliases") {
      return `Preview · ${built.value.length} ${built.value.length === 1 ? "value" : "values"} · Enter saves`;
    }
    const preview = JSON.stringify(built.value);
    return `Preview · ${this.stage?.rowId ? this.propertyEditorStageFindRow()?.row?.key || "property" : "property"} = ${preview} · Enter saves`;
  }
,
  propertyEditorStageInputChanged(input) {
    if (!this.stage || this.closed || this.pendingApply || this.stageComposing) return;
    const kind = input?.getAttribute?.("data-property-stage-kind") || this.stage.kind;
    if (Number(input?.getAttribute?.("data-property-stage-id")) !== this.stage.id || kind !== this.stage.kind) return;
    if (this.stage.kind === "list" || this.stage.kind === "tags" || this.stage.kind === "aliases") this.stage.itemDraft = String(input.value ?? "");
    else this.stage.value = String(input.value ?? "");
    if (typeof input.selectionStart === "number") this.stage.caret = { start: input.selectionStart, end: input.selectionEnd };
    this.stage.revision += 1;
    this.stage.suggestionIndex = -1;
    this.pendingStageEnter = null;
    this.stageNeedsPreview = false;
    const built = this.propertyEditorBuildCurrentStage();
    const session = this.editorEnsureSession();
    if (!built.ok) {
      try { session?.setDraft?.([]); } catch (_) {}
      this.refusal = { code: "bad-stage-value", message: built.message, hint: "Correct the value or use Ctrl+D to unset it." };
      this.status = { kind: "refusal", text: built.message };
      this.stage.previewText = built.message;
      this.paintPropertyEditor();
      return;
    }
    const entry = this.propertyEditorStageFindRow();
    if (!entry || !built.changed) {
      try { session?.setDraft?.([]); } catch (_) {}
      this.refusal = null;
      this.status = { kind: "ready", text: "" };
      this.stage.previewText = built.changed === false ? "No changes · Esc returns to properties" : "";
      this.paintPropertyEditor();
      return;
    }
    this.refusal = null;
    this.status = propertyEditorStatusChecking();
    this.stage.previewText = this.propertyEditorStagePreviewText(built);
    try { session?.setDraft?.(built.ops); } catch (_) {}
    this.sessionState = session?.getState?.() || this.sessionState;
    this.paintPropertyEditor();
  }
,
  propertyEditorStageAddItem(raw = null) {
    if (!this.stage || !["list", "tags", "aliases"].includes(this.stage.kind)) return false;
    const inputValue = raw == null ? this.stage.itemDraft : String(raw);
    const value = this.stage.kind === "tags" ? propertyEditorNormalizeTag(inputValue) : String(inputValue).trim();
    if (!value) return false;
    this.stage.items.push(value);
    this.stage.itemDraft = "";
    this.stage.revision += 1;
    this.pendingStageEnter = null;
    this.propertyEditorStageInputChanged({
      value: "", getAttribute: (name) => name === "data-property-stage-kind" ? this.stage.kind : String(this.stage.id),
    });
    return true;
  }
,
  propertyEditorStageRemoveItem(index) {
    if (!this.stage || !Array.isArray(this.stage.items) || !Number.isInteger(index) || index < 0 || index >= this.stage.items.length) return false;
    this.stage.items.splice(index, 1);
    this.stage.revision += 1;
    this.pendingStageEnter = null;
    this.propertyEditorStageInputChanged({
      value: this.stage.itemDraft,
      getAttribute: (name) => name === "data-property-stage-kind" ? this.stage.kind : String(this.stage.id),
    });
    return true;
  }
,
  propertyEditorPickStageSuggestion(index) {
    if (!this.stage || !Number.isInteger(index)) return false;
    const view = this.propertyEditorStageView();
    const suggestion = view?.suggestions?.[index];
    if (!suggestion) return false;
    if (["list", "tags", "aliases"].includes(this.stage.kind)) return this.propertyEditorStageAddItem(suggestion.value);
    this.stage.value = String(suggestion.value);
    this.stage.revision += 1;
    const input = this.contentEl?.querySelector?.("[data-property-stage-input]");
    if (input) input.value = this.stage.value;
    this.propertyEditorStageInputChanged(input || { value: this.stage.value, getAttribute: (name) => name === "data-property-stage-kind" ? this.stage.kind : String(this.stage.id) });
    return true;
  }
,
  propertyEditorMoveStageSuggestion(delta) {
    const view = this.propertyEditorStageView();
    if (!view || !view.suggestions.length) return false;
    const current = Number.isInteger(view.selectedSuggestion) ? view.selectedSuggestion : -1;
    const next = Math.max(0, Math.min(view.suggestions.length - 1, current + delta));
    this.stage.suggestionIndex = next;
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorStageSyncPreview() {
    if (!this.stage || this.closed || !this.session) return;
    const state = this.session.getState?.();
    this.sessionState = state || this.sessionState;
    if (!state) return;
    // The shared lock wait surfaces in the status line while it runs;
    // Esc stops the wait without retrying the uncertain write.
    if (state.lockWait) {
      this.status = {
        kind: "checking",
        text: typeof propertyEditorLockWaitText === "function"
          ? propertyEditorLockWaitText(state.lockWait)
          : "Waiting for another Bob vault maintenance run… · Esc stops waiting",
      };
      this.paintPropertyEditor();
      return;
    }
    if (state.status === "preview-pending" || state.status === "draft" || state.status === "applying") {
      this.status = state.status === "applying" ? { kind: "checking", text: "Saving…" } : propertyEditorStatusChecking();
      this.paintPropertyEditor();
      return;
    }
    if (state.status === "preview-ready" && state.canApply) {
      const built = this.propertyEditorBuildCurrentStage();
      const matches = built.ok && propertyEditorStageOpsJson(state.draftOps) === propertyEditorStageOpsJson(built.ops);
      if (!matches) {
        this.pendingStageEnter = null;
        this.stageNeedsPreview = true;
        this.status = { kind: "ready", text: "The value changed; preview it again before saving." };
        this.paintPropertyEditor();
        return;
      }
      this.refusal = null;
      this.status = { kind: "ready", text: "Preview ready · Enter saves" };
      this.stage.previewText = this.propertyEditorStagePreviewText(built);
      const pending = this.pendingStageEnter;
      if (pending && pending.stageId === this.stage.id && pending.revision === this.stage.revision
        && pending.opsJson === propertyEditorStageOpsJson(built.ops) && !this.stageComposing) {
        this.pendingStageEnter = null;
        void this.propertyEditorApplyStage(built);
        return;
      }
      this.paintPropertyEditor();
      return;
    }
    if (state.status === "refused" && state.refusal) {
      const refusal = state.refusal;
      const stale = refusal.kind === "stale" || refusal.code === "prop_stale" || refusal.code === "stale_generation";
      this.pendingStageEnter = null;
      if (stale) this.stageNeedsPreview = true;
      this.refusal = { code: refusal.code || "failed", message: refusal.message || "The property preview was refused.", hint: refusal.hint || "" };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.stage.previewText = this.refusal.message;
      this.paintPropertyEditor();
      if (stale) void this.propertyEditorRefreshStale(this.stage.id, this.stage.revision);
      return;
    }
  }
,
  async propertyEditorRefreshStale(stageId, revision) {
    if (this.staleRefreshPending || this.closed || !this.propertyPlugin?.apiPropertyShow) return;
    this.staleRefreshPending = true;
    let result;
    try { result = await this.propertyPlugin.apiPropertyShow(this.filePath); } catch (_) { result = null; }
    this.staleRefreshPending = false;
    if (this.closed || !this.stage || this.stage.id !== stageId || this.stage.revision !== revision) return;
    if (result?.ok === true && result.report) this.propertyEditorReconcile(result.report);
    this.stageNeedsPreview = true;
    this.pendingStageEnter = null;
    this.status = { kind: "refusal", text: "The note changed. Your draft is kept; press Enter to preview it against the current note." };
    this.refusal = { code: "prop_stale", message: this.status.text, hint: "Nothing was written." };
    this.paintPropertyEditor();
  }
,
  async propertyEditorSaveStage() {
    if (!this.stage || this.closed || this.pendingApply || this.stageComposing) return null;
    const built = this.propertyEditorBuildCurrentStage();
    if (!built.ok) {
      this.refusal = { code: "bad-stage-value", message: built.message, hint: "Correct the value or use Ctrl+D to unset it." };
      this.status = { kind: "refusal", text: built.message };
      this.stage.previewText = built.message;
      this.paintPropertyEditor();
      return built;
    }
    if (!built.changed) {
      this.propertyEditorCancelStage({ quiet: true });
      this.status = { kind: "ready", text: "No changes." };
      this.paintPropertyEditor();
      return { ok: true, changed: false, noOp: true };
    }
    const session = this.editorEnsureSession();
    if (!session) return null;
    const state = session.getState?.();
    const matches = state?.status === "preview-ready" && state.canApply
      && !this.stageNeedsPreview
      && propertyEditorStageOpsJson(state.draftOps) === propertyEditorStageOpsJson(built.ops);
    if (matches) return this.propertyEditorApplyStage(built);
    this.pendingStageEnter = { stageId: this.stage.id, revision: this.stage.revision, opsJson: propertyEditorStageOpsJson(built.ops) };
    if (this.stageNeedsPreview || !state || propertyEditorStageOpsJson(state.draftOps) !== propertyEditorStageOpsJson(built.ops)
      || state.status === "refused" || state.status === "browsing") {
      this.stageNeedsPreview = false;
      this.status = propertyEditorStatusChecking();
      this.stage.previewText = this.propertyEditorStagePreviewText(built);
      try { session.setDraft(built.ops); } catch (_) {}
    } else {
      this.status = propertyEditorStatusChecking();
    }
    this.sessionState = session.getState?.() || this.sessionState;
    this.paintPropertyEditor();
    return { ok: false, code: "preview-pending", message: "Waiting for a current property preview." };
  }
,
  async propertyEditorApplyStage(built) {
    if (!this.stage || this.closed || this.pendingApply || !built?.ok) return null;
    const stageId = this.stage.id;
    const revision = this.stage.revision;
    this.pendingStageEnter = null;
    this.pendingApply = true;
    this.status = { kind: "checking", text: "Saving…" };
    this.paintPropertyEditor();
    let result;
    try {
      try { result = await this.session.apply(); }
      catch (error) { result = { ok: false, code: "failed", message: error?.message || "The property update failed." }; }
    } finally {
      this.pendingApply = false;
    }
    if (this.closed || !this.stage || this.stage.id !== stageId || this.stage.revision !== revision) return result;
    this.announce = "";
    if (result?.ok === true) {
      if (result.report?.properties) this.propertyEditorReconcile({ ...this.report, ...result.report });
      this.propertyEditorCancelStage({ quiet: true });
      this.refusal = null;
      this.status = propertyEditorStatusSaved();
    } else {
      const failure = result?.report?.error || result || {};
      const refusal = propertyEditorStatusRefusal(failure);
      const stale = result?.kind === "stale" || result?.code === "prop_stale" || failure?.code === "prop_stale" || failure?.code === "stale_generation";
      this.refusal = refusal;
      this.status = { kind: "refusal", text: refusal.message };
      this.stage.previewText = `${refusal.message}${refusal.hint ? ` — ${refusal.hint}` : ""}`;
      if (stale) {
        this.stageNeedsPreview = true;
        this.pendingStageEnter = null;
        void this.propertyEditorRefreshStale(stageId, revision);
      }
    }
    this.paintPropertyEditor();
    return result;
  }
,
  propertyEditorCancelStage(options = {}) {
    if (!this.stage) return false;
    // A pending save refuses the cancel: clearing the draft mid-write
    // would turn bob's completed write into a superseded no-op and strand
    // pendingApply. The modal-level close ladder already refuses first;
    // this guard keeps row clicks and selection changes safe too.
    if (this.pendingApply === true) {
      this.propertyEditorRefuseWhileSaving?.();
      return false;
    }
    const session = this.session;
    this.stage = null;
    this.pendingStageEnter = null;
    this.stageNeedsPreview = false;
    this.stageComposing = false;
    this.staleRefreshPending = false;
    try { session?.setDraft?.([]); } catch (_) {}
    if (options.quiet !== true) {
      this.refusal = null;
      this.status = { kind: "ready", text: "" };
    }
    this.paintPropertyEditor();
    return true;
  }
,
  paintPropertyEditor() {
    this._propertyStageRetained = null;
    if (this.stage) {
      try {
        const input = this.contentEl?.querySelector?.("[data-property-stage-input]");
        const band = this.contentEl?.querySelector?.("[data-property-stage-band]");
        if (input && Number(input.getAttribute?.("data-property-stage-id")) === this.stage.id) {
          this._propertyStageRetained = { stageId: this.stage.id, input, band: band || null };
        }
      } catch (_) {}
    }
    try {
      const result = propertyEditorPaintBeforeStages.call(this);
      this.propertyEditorSyncProseField?.();
      return result;
    } finally { this._propertyStageRetained = null; }
  }
,
  editorCaptureCaret(doc) {
    try {
      const active = doc?.activeElement;
      if (active?.getAttribute?.("data-property-stage-input")) {
        return {
          propertyStage: true,
          stageId: Number(active.getAttribute("data-property-stage-id")),
          start: active.selectionStart ?? 0,
          end: active.selectionEnd ?? active.selectionStart ?? 0,
        };
      }
    } catch (_) {}
    return propertyEditorCaptureCaretBeforeStages.call(this, doc);
  }
,
  editorRestoreFocus(doc, caret) {
    if (caret?.propertyStage === true && this.stage && this.stage.id === caret.stageId) {
      try {
        const input = this.contentEl?.querySelector?.("[data-property-stage-input]");
        if (input && typeof input.focus === "function") {
          if (doc?.activeElement !== input) input.focus();
          if (typeof input.setSelectionRange === "function") input.setSelectionRange(caret.start, caret.end);
          return;
        }
      } catch (_) {}
    }
    return propertyEditorRestoreFocusBeforeStages.call(this, doc, caret);
  }
,
  propertyEditorActivate(entry) {
    const decision = entry ? propertyEditorActionForRow(entry.row) : null;
    if (decision?.action === "edit") return this.propertyEditorOpenStage(entry);
    return propertyEditorActivateBeforeStages.call(this, entry);
  }
,
  propertyEditorSelect(id) {
    if (this.stage && id !== this.selectedId) this.propertyEditorCancelStage({ quiet: true });
    return propertyEditorSelectBeforeStages.call(this, id);
  }
,
  propertyEditorOnClick(event) {
    const target = event?.target?.closest?.("[data-property-stage-action]");
    if (target && this.stage) {
      const action = target.getAttribute("data-property-stage-action");
      const index = Number(target.getAttribute("data-property-stage-index"));
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (action === "cancel") return this.propertyEditorCancelStage();
      if (action === "save") return void this.propertyEditorSaveStage();
      if (action === "add-item") return this.propertyEditorStageAddItem();
      if (action === "remove-item") return this.propertyEditorStageRemoveItem(index);
      if (action === "pick-suggestion") return this.propertyEditorPickStageSuggestion(index);
    }
    if (this.stage && event?.target?.closest?.("[data-property-row]")) this.propertyEditorCancelStage({ quiet: true });
    return propertyEditorClickBeforeStages.call(this, event);
  }
,
  propertyEditorOnKeyDown(event) {
    const input = event?.target?.closest?.("[data-property-stage-input]");
    if (input && this.stage) {
      if (this.propertyEditorProseOffer?.(event)) return;
      if (event.isComposing || event.keyCode === 229 || this.stageComposing) return;
      if (event.key === "Escape") {
        event.preventDefault?.();
        this.propertyEditorBackOut(event);
        return;
      }
      if (event.key === "ArrowDown" && this.propertyEditorMoveStageSuggestion(1)) {
        event.preventDefault?.();
        return;
      }
      if (event.key === "ArrowUp" && this.propertyEditorMoveStageSuggestion(-1)) {
        event.preventDefault?.();
        return;
      }
      if (event.key === "Enter") {
        const view = this.propertyEditorStageView();
        if (Number.isInteger(view?.selectedSuggestion) && view.selectedSuggestion >= 0) {
          event.preventDefault?.();
          event.stopPropagation?.();
          this.propertyEditorPickStageSuggestion(view.selectedSuggestion);
          return;
        }
        if (this.stage.kind === "text" && event.shiftKey) {
          // Soft-line inputs save like Enter; only the generic multi-line
          // Text stage keeps Shift+Enter as a new line.
          let softLine = false;
          try { softLine = Boolean(event.target?.closest?.("[data-soft-line]")); } catch (_) { softLine = false; }
          if (!softLine) return;
        }
        event.preventDefault?.();
        event.stopPropagation?.();
        if (["list", "tags", "aliases"].includes(this.stage.kind) && String(this.stage.itemDraft || "").trim()) {
          this.propertyEditorStageAddItem();
        } else {
          void this.propertyEditorSaveStage();
        }
        return;
      }
      if (event.key === "Backspace" && ["list", "tags", "aliases"].includes(this.stage.kind)
        && !String(this.stage.itemDraft || "") && this.stage.items.length) {
        event.preventDefault?.();
        this.propertyEditorStageRemoveItem(this.stage.items.length - 1);
        return;
      }
      return;
    }
    return propertyEditorKeyBeforeStages.call(this, event);
  }
,
  propertyEditorBackOut(event) {
    if (this.propertyEditorProseBackOut?.(event)) return;
    if (this.stage) {
      this.propertyEditorCancelStage();
      return;
    }
    return propertyEditorBackOutBeforeStages.call(this, event);
  }
,
  propertyEditorReconcile(report) {
    const incoming = report && typeof report === "object" && typeof report.fingerprint_after === "string"
      ? { ...report, fingerprint: report.fingerprint_after }
      : report;
    const before = this.report?.fingerprint || "";
    propertyEditorReconcileBeforeStages.call(this, incoming);
    const after = this.report?.fingerprint || "";
    if (this.stage && before && after && before !== after) {
      this.pendingStageEnter = null;
      this.stageNeedsPreview = true;
      this.stage.previewText = "The note changed; preview this draft again before saving.";
    }
  }
,
  onOpen() {
    propertyEditorOpenBeforeStages.call(this);
    if (!this.stageInputListener) {
      this.stageInputListener = (event) => {
        const input = event?.target?.closest?.("[data-property-stage-input]");
        if (input) this.propertyEditorStageInputChanged(input);
      };
      this.stageCompositionStartListener = (event) => {
        const input = event?.target?.closest?.("[data-property-stage-input]");
        if (!input || !this.stage) return;
        this.stageComposing = true;
        this.pendingStageEnter = null;
        try { this.session?.setDraft?.([]); } catch (_) {}
      };
      this.stageCompositionEndListener = (event) => {
        const input = event?.target?.closest?.("[data-property-stage-input]");
        if (!input || !this.stage) return;
        this.stageComposing = false;
        this.propertyEditorStageInputChanged(input);
      };
      this.contentEl?.addEventListener?.("input", this.stageInputListener);
      this.contentEl?.addEventListener?.("compositionstart", this.stageCompositionStartListener);
      this.contentEl?.addEventListener?.("compositionend", this.stageCompositionEndListener);
    }
    this.propertyEditorSyncProseField?.();
  }
,
  onClose() {
    this.propertyEditorDetachProseField?.();
    try {
      this.contentEl?.removeEventListener?.("input", this.stageInputListener);
      this.contentEl?.removeEventListener?.("compositionstart", this.stageCompositionStartListener);
      this.contentEl?.removeEventListener?.("compositionend", this.stageCompositionEndListener);
    } catch (_) {}
    this.stageInputListener = null;
    this.stageCompositionStartListener = null;
    this.stageCompositionEndListener = null;
    return propertyEditorCloseBeforeStages.call(this);
  }
,
});
