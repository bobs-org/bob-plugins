// Property editor add-flow modal: o/O/Mod+; name completion, then a typed
// value stage. Cancellation writes nothing; insertion anchors stay on the
// source key the add started with.
function propertyEditorPaintNameStage(doc, host, options, modal) {
  if (!doc || !host || !options) return null;
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage is-name");
  panel.setAttribute("data-property-add", "name");
  panel.setAttribute("aria-label", "Add property name");
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  const where = options.placement && options.placement.where === "above"
    ? "above"
    : options.placement && options.placement.where === "below" ? "below" : "at the end";
  propertyEditorSetText(title, `New property · ${where}`);
  panel.appendChild(title);
  const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-stage-label");
  const inputId = "bob-property-editor-add-name";
  label.setAttribute("for", inputId);
  propertyEditorSetText(label, "Property name");
  panel.appendChild(label);
  let input = options.keptInput || null;
  if (!input) {
    // bob-text: literal property names are identifiers, not prose.
    input = propertyEditorCreateEl(doc, "input", "bob-property-editor-stage-input");
    input.setAttribute("type", "text");
    input.value = options.name;
  } else if (!options.composing && String(input.value == null ? "" : input.value) !== options.name) {
    input.value = options.name;
  }
  input.setAttribute("id", inputId);
  input.setAttribute("data-property-add-input", "name");
  input.setAttribute("aria-label", "Property name");
  input.setAttribute("autocomplete", "off");
  input.disabled = options.disabled === true;
  if (!input.parentNode || input.parentNode !== panel) panel.appendChild(input);
  if (options.suggestions && options.suggestions.length) {
    const list = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-suggestions");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Vault property names");
    for (const [index, suggestion] of options.suggestions.entries()) {
      const button = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-suggestion");
      button.setAttribute("type", "button");
      button.setAttribute("role", "option");
      button.setAttribute("data-property-add-action", "pick-name");
      button.setAttribute("data-property-add-index", String(index));
      if (index === options.selectedSuggestion) button.setAttribute("aria-selected", "true");
      const typeLabel = suggestion.authoritative && suggestion.type
        ? suggestion.type
        : suggestion.authoritative === false ? "unknown type" : "text";
      const count = Number(suggestion.count) || 0;
      propertyEditorSetText(button, `${suggestion.name} · ${typeLabel} · ${count}`);
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
  const next = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-save");
  next.setAttribute("type", "button");
  next.setAttribute("data-property-add-action", "continue");
  propertyEditorSetText(next, "Continue");
  actions.appendChild(next);
  const literal = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-add");
  literal.setAttribute("type", "button");
  literal.setAttribute("data-property-add-action", "literal");
  propertyEditorSetText(literal, "Use this name as text");
  actions.appendChild(literal);
  const cancel = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-cancel");
  cancel.setAttribute("type", "button");
  cancel.setAttribute("data-property-add-action", "cancel");
  propertyEditorSetText(cancel, "Cancel");
  actions.appendChild(cancel);
  panel.appendChild(actions);
  host.appendChild(panel);
  void modal;
  return { panel, input };
}

const propertyEditorPaintBeforeAdd = PropertyEditorModal.prototype.paintPropertyEditor;
const propertyEditorPaintOptionsBeforeAdd = PropertyEditorModal.prototype.propertyEditorPaintOptions;
const propertyEditorPerformBeforeAdd = PropertyEditorModal.prototype.propertyEditorPerform;
const propertyEditorKeyBeforeAdd = PropertyEditorModal.prototype.propertyEditorOnKeyDown;
const propertyEditorClickBeforeAdd = PropertyEditorModal.prototype.propertyEditorOnClick;
const propertyEditorBackOutBeforeAdd = PropertyEditorModal.prototype.propertyEditorBackOut;
const propertyEditorReconcileBeforeAdd = PropertyEditorModal.prototype.propertyEditorReconcile;
const propertyEditorFindRowBeforeAdd = PropertyEditorModal.prototype.propertyEditorStageFindRow;
const propertyEditorBuildBeforeAdd = PropertyEditorModal.prototype.propertyEditorBuildCurrentStage;
const propertyEditorApplyBeforeAdd = PropertyEditorModal.prototype.propertyEditorApplyStage;
const propertyEditorCancelBeforeAdd = PropertyEditorModal.prototype.propertyEditorCancelStage;
const propertyEditorOpenBeforeAdd = PropertyEditorModal.prototype.onOpen;
const propertyEditorCloseBeforeAdd = PropertyEditorModal.prototype.onClose;
const propertyEditorCaptureBeforeAdd = PropertyEditorModal.prototype.editorCaptureCaret;
const propertyEditorRestoreBeforeAdd = PropertyEditorModal.prototype.editorRestoreFocus;
const propertyEditorInitialReadBeforeAdd = PropertyEditorModal.prototype.propertyEditorInitialRead;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorCanAdd() {
    const degraded = propertyEditorDegradedFor({
      capability: this.propertyPlugin?.propertyCapability ?? this.editorCapability(),
      report: this.report,
      cacheRows: this.cacheRows,
    });
    return degraded.writable === true;
  }
,
  propertyEditorAddNameView() {
    const add = this.addName;
    if (!add) return null;
    const suggestions = propertyEditorFilterPropertyNames(add.catalog, add.name);
    const retained = this._propertyAddRetained;
    return {
      name: String(add.name || ""),
      placement: add.placement,
      source: add.source,
      suggestions,
      selectedSuggestion: Number.isInteger(add.suggestionIndex) ? add.suggestionIndex : -1,
      previewText: add.previewText || "",
      disabled: this.pendingApply === true,
      composing: this.addComposing === true,
      keptInput: retained && retained.input ? retained.input : null,
    };
  }
,
  propertyEditorStartAdd(where) {
    if (this.closed) return false;
    if (this.pendingApply) {
      this.propertyEditorRefuseWhileSaving?.();
      return false;
    }
    // An open value stage keeps its draft: o/O/Mod+; refuses like `=`
    // instead of quietly cancelling the stage, even when its input lost
    // focus and the key reads as a browse gesture.
    if (this.stage) {
      const notice = typeof PROPERTY_EDITOR_FINISH_EDIT_FIRST === "string"
        ? PROPERTY_EDITOR_FINISH_EDIT_FIRST
        : "Finish the open edit first — = is reserved while drafting.";
      this.announce = notice;
      this.paintPropertyEditor();
      return false;
    }
    if (!this.propertyEditorCanAdd()) {
      this.refusal = {
        code: "unwritable",
        message: "Properties cannot be added until the note is writable.",
        hint: this.report ? "" : PROPERTY_EDITOR_CHECKING_TEXT,
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.paintPropertyEditor();
      return false;
    }
    try { this.propertyEditorCancelStage?.({ quiet: true }); } catch (_) {}
    const selected = this.editorSelected();
    const inventory = propertyEditorPropertyInfos(this.app);
    this.addName = {
      placement: propertyEditorAddPlacement(where, selected?.row?.key || "", this.properties),
      name: "",
      catalog: inventory.rows,
      source: inventory.source,
      suggestionIndex: inventory.rows.length ? 0 : -1,
      suggestionTouched: false,
      previewText: "Tab/Enter uses the highlighted name and type · Shift+Enter keeps this name as text",
    };
    this.addComposing = false;
    this.refusal = null;
    this.status = { kind: "ready", text: "" };
    this.announce = "";
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorCancelAdd(options = {}) {
    const had = Boolean(this.addName) || Boolean(this.stage && this.stage.add);
    this.addName = null;
    this.addComposing = false;
    if (this.stage && this.stage.add) {
      try { propertyEditorCancelBeforeAdd.call(this, { quiet: true }); } catch (_) { this.stage = null; }
    }
    if (options.quiet !== true) {
      this.refusal = null;
      this.status = { kind: "ready", text: had ? "Add cancelled." : "" };
    }
    this.paintPropertyEditor();
    return had;
  }
,
  propertyEditorSetAddName(raw) {
    if (!this.addName || this.closed) return;
    this.addName.name = String(raw == null ? "" : raw);
    this.addName.suggestionTouched = false;
    const suggestions = propertyEditorFilterPropertyNames(this.addName.catalog, this.addName.name);
    if (!suggestions.length) this.addName.suggestionIndex = -1;
    else if (!Number.isInteger(this.addName.suggestionIndex) || this.addName.suggestionIndex < 0
      || this.addName.suggestionIndex >= suggestions.length) {
      this.addName.suggestionIndex = 0;
    }
    this.addName.previewText = suggestions.length
      ? "Tab/Enter uses the highlighted name and type · Shift+Enter keeps this name as text"
      : "Shift+Enter or Enter creates this name as text";
    this.refusal = null;
    this.status = { kind: "ready", text: "" };
    this.paintPropertyEditor();
  }
,
  propertyEditorMoveAddSuggestion(delta) {
    if (!this.addName) return false;
    const suggestions = propertyEditorFilterPropertyNames(this.addName.catalog, this.addName.name);
    if (!suggestions.length) return false;
    const current = Number.isInteger(this.addName.suggestionIndex) ? this.addName.suggestionIndex : -1;
    this.addName.suggestionIndex = Math.max(0, Math.min(suggestions.length - 1, current + delta));
    this.addName.suggestionTouched = true;
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorCommitAddName(options = {}) {
    if (!this.addName || this.closed || this.pendingApply) return false;
    const accepted = propertyEditorAcceptAddName(this.addName.name, this.addName.catalog, {
      literal: options.literal === true,
      suggestionIndex: options.literal === true ? -1 : this.addName.suggestionIndex,
      suggestionTouched: options.literal === true ? false : this.addName.suggestionTouched === true,
    });
    const valid = propertyEditorValidateNewKey(accepted.name, propertyEditorExistingKeys(this.properties));
    if (!valid.ok) {
      this.refusal = { code: valid.code, message: valid.message, hint: "Choose another name." };
      this.status = { kind: "refusal", text: valid.message };
      this.addName.previewText = valid.message;
      this.paintPropertyEditor();
      return false;
    }
    const race = propertyEditorAddRace(accepted.name, this.addName.placement, this.properties);
    if (!race.ok) {
      this.refusal = { code: race.code, message: race.message, hint: race.hint || "" };
      this.status = { kind: "refusal", text: race.message };
      this.addName.previewText = race.message;
      this.paintPropertyEditor();
      return false;
    }
    return this.propertyEditorOpenAddValueStage(accepted, this.addName.placement);
  }
,
  propertyEditorOpenAddValueStage(accepted, placement) {
    const wireKind = PROPERTY_EDITOR_ADD_WIRE_KINDS.has(accepted.wireKind) ? accepted.wireKind : "text";
    const row = propertyEditorAddSyntheticRow(accepted.name, wireKind);
    const seeded = propertyEditorStageSeed(row, wireKind === "checkbox" ? "text" : wireKind);
    this.stageSeq = (this.stageSeq || 0) + 1;
    this.stage = {
      id: this.stageSeq,
      add: true,
      addPlacement: placement,
      addRow: row,
      rowId: `add:${accepted.name}`,
      key: accepted.name,
      line: null,
      kind: wireKind,
      wireKind,
      value: wireKind === "checkbox" ? "false" : (seeded.value ?? ""),
      items: seeded.items || [],
      itemDraft: "",
      revision: 0,
      previewText: "",
      suggestionIndex: -1,
      suggestionCatalog: wireKind === "tags"
        ? propertyEditorTagSuggestions(this.app)
        : ["text", "list", "aliases"].includes(wireKind)
          ? propertyEditorSuggestValues(this.app, accepted.name, this.filePath)
          : [],
    };
    this.addName = null;
    this.pendingStageEnter = null;
    this.stageComposing = false;
    this.stageNeedsPreview = false;
    this.refusal = null;
    this.status = { kind: "ready", text: "" };
    this.announce = "";
    this.paintPropertyEditor();
    this.propertyEditorStageInputChanged({
      value: this.stage.value,
      getAttribute: (name) => name === "data-property-stage-kind" ? this.stage.kind : String(this.stage.id),
    });
    return true;
  }
,
  propertyEditorMaybeStartModeAdd() {
    if (this.closed || this.addModeStarted || this.mode !== "add") return;
    if (!this.report) return;
    this.addModeStarted = true;
    this.propertyEditorStartAdd("end");
  }
,
  propertyEditorMaybeStartModeEdit() {
    if (this.closed || this.editModeStarted || this.mode !== "edit" || !this.report) return;
    const requested = typeof this.requestedKey === "string" ? this.requestedKey : "";
    if (requested) {
      const match = this.editorOrderedRows().find((entry) => entry.row.key === requested);
      // Wait for the requested key; do not start edit on the first report row.
      if (!match) return;
      this.selectedId = match.id;
    }
    const selected = this.editorSelected();
    if (!selected) return;
    this.editModeStarted = true;
    const decision = propertyEditorActionForRow(selected.row);
    if (decision.action === "edit") {
      this.propertyEditorOpenStage(selected);
      return;
    }
    if (decision.action === "handoff" || decision.action === "locked") {
      void this.propertyEditorActivate(selected);
      return;
    }
    // Opening an entry point must not flip a checkbox as a side effect.
    this.announce = `“${selected.row.key}” is a checkbox; press Enter to flip it.`;
    this.paintPropertyEditor();
  }
,
  propertyEditorPaintOptions() {
    const options = propertyEditorPaintOptionsBeforeAdd.call(this);
    options.addName = this.propertyEditorAddNameView();
    return options;
  }
,
  paintPropertyEditor() {
    this._propertyAddRetained = null;
    if (this.addName) {
      try {
        const input = this.contentEl?.querySelector?.("[data-property-add-input]");
        if (input) this._propertyAddRetained = { input };
      } catch (_) {}
    }
    try {
      return propertyEditorPaintBeforeAdd.call(this);
    } finally {
      this._propertyAddRetained = null;
    }
  }
,
  editorCaptureCaret(doc) {
    try {
      const active = doc?.activeElement;
      if (active?.getAttribute?.("data-property-add-input")) {
        return {
          propertyAdd: true,
          start: active.selectionStart ?? 0,
          end: active.selectionEnd ?? active.selectionStart ?? 0,
        };
      }
    } catch (_) {}
    return propertyEditorCaptureBeforeAdd.call(this, doc);
  }
,
  editorRestoreFocus(doc, caret) {
    if (caret?.propertyAdd === true && this.addName) {
      try {
        const input = this.contentEl?.querySelector?.("[data-property-add-input]");
        if (input && typeof input.focus === "function") {
          if (doc?.activeElement !== input) input.focus();
          if (typeof input.setSelectionRange === "function") input.setSelectionRange(caret.start, caret.end);
          return;
        }
      } catch (_) {}
    }
    return propertyEditorRestoreBeforeAdd.call(this, doc, caret);
  }
,
  async propertyEditorPerform(action, event) {
    if (action === "add-below") return this.propertyEditorStartAdd("below");
    if (action === "add-above") return this.propertyEditorStartAdd("above");
    if (action === "add-end") return this.propertyEditorStartAdd("end");
    return propertyEditorPerformBeforeAdd.call(this, action, event);
  }
,
  propertyEditorOnClick(event) {
    const addTarget = event?.target?.closest?.("[data-property-add-action]");
    if (addTarget && this.addName) {
      const action = addTarget.getAttribute("data-property-add-action");
      const index = Number(addTarget.getAttribute("data-property-add-index"));
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (action === "cancel") return this.propertyEditorCancelAdd();
      if (action === "continue") return this.propertyEditorCommitAddName();
      if (action === "literal") return this.propertyEditorCommitAddName({ literal: true });
      if (action === "pick-name" && Number.isInteger(index)) {
        this.addName.suggestionIndex = index;
        this.addName.suggestionTouched = true;
        return this.propertyEditorCommitAddName();
      }
    }
    if ((this.addName || (this.stage && this.stage.add)) && event?.target?.closest?.("[data-property-row]")) {
      this.propertyEditorCancelAdd({ quiet: true });
    }
    return propertyEditorClickBeforeAdd.call(this, event);
  }
,
  propertyEditorOnKeyDown(event) {
    const input = event?.target?.closest?.("[data-property-add-input]");
    if (input && this.addName) {
      if (event.isComposing || event.keyCode === 229 || this.addComposing) return;
      if (event.key === "Escape") {
        event.preventDefault?.();
        this.propertyEditorCancelAdd();
        return;
      }
      if (event.key === "ArrowDown" && this.propertyEditorMoveAddSuggestion(1)) {
        event.preventDefault?.();
        return;
      }
      if (event.key === "ArrowUp" && this.propertyEditorMoveAddSuggestion(-1)) {
        event.preventDefault?.();
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault?.();
        event.stopPropagation?.();
        this.propertyEditorCommitAddName({ literal: event.key === "Enter" && event.shiftKey === true });
        return;
      }
      return;
    }
    return propertyEditorKeyBeforeAdd.call(this, event);
  }
,
  propertyEditorBackOut(event) {
    if (this.addName) {
      this.propertyEditorCancelAdd();
      return;
    }
    if (this.stage && this.stage.add) {
      this.propertyEditorCancelAdd();
      return;
    }
    return propertyEditorBackOutBeforeAdd.call(this, event);
  }
,
  propertyEditorStageFindRow(stage = this.stage) {
    if (stage && stage.add && stage.addRow) {
      return { id: stage.rowId, index: -1, row: stage.addRow };
    }
    return propertyEditorFindRowBeforeAdd.call(this, stage);
  }
,
  propertyEditorBuildCurrentStage() {
    if (this.stage && this.stage.add) {
      return propertyEditorAddStageBuild(this.stage, this.propertyEditorCurrentStageDraft(), {
        now: this.propertyEditorNow,
        timeZone: this.propertyEditorTimeZone,
        properties: this.properties,
      });
    }
    return propertyEditorBuildBeforeAdd.call(this);
  }
,
  async propertyEditorApplyStage(built) {
    const adding = this.stage && this.stage.add === true;
    const newKey = this.stage && this.stage.key;
    const result = await propertyEditorApplyBeforeAdd.call(this, built);
    if (adding && result && result.ok === true && newKey) {
      const match = this.editorOrderedRows().find((entry) => entry.row.key === newKey);
      if (match) this.selectedId = match.id;
      this.paintPropertyEditor();
    }
    return result;
  }
,
  propertyEditorCancelStage(options = {}) {
    if (this.stage && this.stage.add) this.addName = null;
    return propertyEditorCancelBeforeAdd.call(this, options);
  }
,
  propertyEditorReconcile(report) {
    propertyEditorReconcileBeforeAdd.call(this, report);
    if (this.addName) {
      const race = propertyEditorAddRace(
        propertyEditorNormalizePropertyName(this.addName.name),
        this.addName.placement,
        this.properties,
      );
      if (!race.ok && this.addName.name) {
        this.refusal = { code: race.code, message: race.message, hint: race.hint || "" };
        this.status = { kind: "refusal", text: race.message };
        this.addName.previewText = race.message;
      }
    } else if (this.stage && this.stage.add) {
      const race = propertyEditorAddRace(this.stage.key, this.stage.addPlacement, this.properties);
      if (!race.ok) {
        this.pendingStageEnter = null;
        this.stageNeedsPreview = true;
        this.refusal = { code: race.code, message: race.message, hint: race.hint || "" };
        this.status = { kind: "refusal", text: race.message };
        this.stage.previewText = race.message;
      }
    }
    this.propertyEditorMaybeStartModeAdd();
    this.propertyEditorMaybeStartModeEdit();
  }
,
  onOpen() {
    propertyEditorOpenBeforeAdd.call(this);
    if (!this.addInputListener) {
      this.addInputListener = (event) => {
        const input = event?.target?.closest?.("[data-property-add-input]");
        if (input && this.addName) this.propertyEditorSetAddName(input.value);
      };
      this.addCompositionStartListener = (event) => {
        if (!event?.target?.closest?.("[data-property-add-input]") || !this.addName) return;
        this.addComposing = true;
      };
      this.addCompositionEndListener = (event) => {
        const input = event?.target?.closest?.("[data-property-add-input]");
        if (!input || !this.addName) return;
        this.addComposing = false;
        this.propertyEditorSetAddName(input.value);
      };
      this.contentEl?.addEventListener?.("input", this.addInputListener);
      this.contentEl?.addEventListener?.("compositionstart", this.addCompositionStartListener);
      this.contentEl?.addEventListener?.("compositionend", this.addCompositionEndListener);
    }
    this.propertyEditorMaybeStartModeAdd();
    this.propertyEditorMaybeStartModeEdit();
  }
,
  onClose() {
    try {
      this.contentEl?.removeEventListener?.("input", this.addInputListener);
      this.contentEl?.removeEventListener?.("compositionstart", this.addCompositionStartListener);
      this.contentEl?.removeEventListener?.("compositionend", this.addCompositionEndListener);
    } catch (_) {}
    this.addInputListener = null;
    this.addCompositionStartListener = null;
    this.addCompositionEndListener = null;
    this.addName = null;
    return propertyEditorCloseBeforeAdd.call(this);
  }
,
  async propertyEditorInitialRead() {
    await propertyEditorInitialReadBeforeAdd.call(this);
    this.propertyEditorMaybeStartModeAdd();
    this.propertyEditorMaybeStartModeEdit();
  }
,
});
