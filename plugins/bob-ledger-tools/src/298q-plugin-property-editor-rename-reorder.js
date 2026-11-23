// Guarded property rename and source-order reorder for the native
// property editor parity phase. Rename is a typed key stage through
// prop.rename; moves are discrete prop.move ops against the full source
// inventory. Animation is 120 ms and honors reduced motion.
const PROPERTY_EDITOR_REORDER_SLIDE_MS = 120;
const PROPERTY_EDITOR_REORDER_FILTER_HINT = "Clear the filter before reordering properties.";

function propertyEditorRenameExistingKeys(properties, currentKey) {
  return propertyEditorExistingKeys(properties).filter((key) => key !== currentKey);
}

function propertyEditorValidateRenameKey(name, properties, currentKey) {
  return propertyEditorValidateNewKey(name, propertyEditorRenameExistingKeys(properties, currentKey));
}

function propertyEditorRenameOp(key, to) {
  return { op: "prop.rename", key, to };
}

function propertyEditorRenameStageBuild(stage, draft, properties) {
  if (!stage || !stage.rename) {
    return { ok: false, message: "There is no property being renamed." };
  }
  const current = typeof stage.key === "string" ? stage.key : "";
  const name = propertyEditorNormalizePropertyName(draft && draft.value);
  const valid = propertyEditorValidateRenameKey(name, properties, current);
  if (!valid.ok) return valid;
  const changed = name !== current;
  return {
    ok: true,
    value: name,
    kind: "rename",
    ops: changed ? [propertyEditorRenameOp(current, name)] : [],
    changed,
  };
}

function propertyEditorSourceMovePlan(entries, selectedId, direction) {
  const rows = Array.isArray(entries) ? entries.filter((entry) => entry && entry.row && typeof entry.row.key === "string") : [];
  const index = rows.findIndex((entry) => entry.id === selectedId);
  if (index < 0) {
    return { ok: false, code: "missing", message: "Select a property to reorder." };
  }
  const entry = rows[index];
  if (!propertyEditorCanMutate(entry.row)) {
    const decision = propertyEditorActionForRow(entry.row);
    return {
      ok: false,
      code: "locked",
      message: decision.reason || `Cannot move “${entry.row.key}”.`,
      hint: "y opens YAML.",
    };
  }
  const down = direction === "down";
  const neighbor = down ? rows[index + 1] : rows[index - 1];
  if (!neighbor) return { ok: false, noop: true, code: "boundary" };
  const op = down
    ? { op: "prop.move", key: entry.row.key, after: neighbor.row.key }
    : { op: "prop.move", key: entry.row.key, before: neighbor.row.key };
  return {
    ok: true,
    direction: down ? "down" : "up",
    key: entry.row.key,
    neighbor: neighbor.row.key,
    fromIndex: index,
    toIndex: down ? index + 1 : index - 1,
    position: down ? index + 2 : index,
    total: rows.length,
    op,
  };
}

function propertyEditorRenameReorderReducedMotion(modal, doc) {
  if (modal && modal.propertyEditorReducedMotionOverride === true) return true;
  if (modal && modal.propertyEditorReducedMotionOverride === false) return false;
  try {
    const view = (doc && doc.defaultView)
      || (typeof window !== "undefined" ? window : null);
    return view?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch (_) {
    return false;
  }
}

function propertyEditorRenameReorderClearSlide(modal) {
  if (!modal) return;
  const timer = modal.propertyEditorSlideTimer;
  modal.propertyEditorSlideTimer = null;
  if (timer == null) return;
  try {
    const clearer = modal.propertyEditorClearTimeout
      || (typeof clearTimeout === "function" ? clearTimeout : null);
    if (typeof clearer === "function") clearer(timer);
  } catch (_) {}
}

function propertyEditorRenameReorderScheduleSlide(modal, token) {
  propertyEditorRenameReorderClearSlide(modal);
  const setter = modal.propertyEditorSetTimeout
    || (typeof setTimeout === "function" ? setTimeout.bind(typeof globalThis !== "undefined" ? globalThis : null) : null);
  if (typeof setter !== "function") return;
  modal.propertyEditorSlideTimer = setter(() => {
    if (modal.closed || modal.propertyEditorSlideToken !== token) return;
    modal.propertyEditorSlide = null;
    modal.propertyEditorSlideTimer = null;
    try { modal.paintPropertyEditor(); } catch (_) {}
  }, PROPERTY_EDITOR_REORDER_SLIDE_MS);
}

function propertyEditorRenameRemapFocus(oldRows, newRows, fromKey, toKey, selectedId, markedIds) {
  const oldMatch = (Array.isArray(oldRows) ? oldRows : []).filter((entry) => entry.row && entry.row.key === fromKey);
  const newMatch = (Array.isArray(newRows) ? newRows : []).find((entry) => entry.row && entry.row.key === toKey);
  const nextMarks = markedIds instanceof Set ? new Set(markedIds) : new Set();
  let nextSelected = selectedId;
  if (oldMatch.length === 1 && newMatch) {
    if (selectedId === oldMatch[0].id) nextSelected = newMatch.id;
    if (nextMarks.has(oldMatch[0].id)) {
      nextMarks.delete(oldMatch[0].id);
      nextMarks.add(newMatch.id);
    }
  }
  return { selectedId: nextSelected, markedIds: nextMarks, renamedId: newMatch ? newMatch.id : "" };
}

function propertyEditorPaintRenameStage(doc, host, options, modal) {
  if (!doc || !host || !options) return null;
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage is-rename");
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("data-property-rename", "true");
  panel.setAttribute("aria-label", `Rename ${options.key}`);
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, `Rename “${options.key}”`);
  panel.appendChild(title);
  const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-stage-label");
  const inputId = `bob-property-editor-rename-${options.stageId}`;
  label.setAttribute("for", inputId);
  propertyEditorSetText(label, "Property name");
  panel.appendChild(label);
  let input = options.keptInput || null;
  if (!input) {
    // bob-text: literal property names are identifiers, not prose.
    input = propertyEditorCreateEl(doc, "input", "bob-property-editor-stage-input");
    input.setAttribute("type", "text");
    input.value = options.value;
  } else if (!options.composing && String(input.value == null ? "" : input.value) !== options.value) {
    input.value = options.value;
  }
  input.setAttribute("id", inputId);
  input.setAttribute("data-property-stage-input", `property-stage-${options.stageId}`);
  input.setAttribute("data-property-stage-id", String(options.stageId));
  input.setAttribute("data-property-stage-kind", "rename");
  input.setAttribute("aria-label", `Rename ${options.key}`);
  input.setAttribute("autocomplete", "off");
  input.disabled = options.disabled === true;
  if (!input.parentNode || input.parentNode !== panel) panel.appendChild(input);
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  preview.setAttribute("aria-live", "polite");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  const actions = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-actions");
  const save = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-save");
  save.setAttribute("type", "button");
  save.setAttribute("data-property-stage-action", "save");
  save.disabled = options.disabled === true;
  propertyEditorSetText(save, "Save");
  actions.appendChild(save);
  const cancel = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-cancel");
  cancel.setAttribute("type", "button");
  cancel.setAttribute("data-property-stage-action", "cancel");
  propertyEditorSetText(cancel, "Cancel");
  actions.appendChild(cancel);
  panel.appendChild(actions);
  host.appendChild(panel);
  void modal;
  return { panel, input };
}

function propertyEditorRenameReorderMenuButton(doc, menu, modal, label, action, disabled = false, title = "") {
  const button = propertyEditorCreateEl(doc, "button", "bob-property-editor-menu-item");
  if (!button) return;
  propertyEditorSetText(button, label);
  try {
    button.setAttribute("type", "button");
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-property-command", action);
    if (disabled) {
      button.disabled = true;
      button.setAttribute("disabled", "");
      if (title) button.setAttribute("title", title);
    }
    button.addEventListener("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (disabled) return;
      modal.menuOpen = false;
      modal.propertyEditorFilterInputFocused = false;
      void modal.propertyEditorPerform(action);
    });
  } catch (_) {}
  menu.appendChild(button);
}

function propertyEditorFindRowButton(host, id) {
  const nodes = host?.querySelectorAll?.("[data-property-row]") || [];
  for (const node of nodes) {
    if (node.getAttribute?.("data-property-row") === id) return node;
  }
  return null;
}

const propertyEditorPaintStageBeforeRename = propertyEditorPaintStage;
propertyEditorPaintStage = function propertyEditorPaintStageWithRename(doc, host, options, modal) {
  if (options && (options.rename === true || options.kind === "rename")) {
    return propertyEditorPaintRenameStage(doc, host, options, modal);
  }
  return propertyEditorPaintStageBeforeRename(doc, host, options, modal);
};

const propertyEditorPaintRowBeforeRename = propertyEditorPaintRow;
propertyEditorPaintRow = function propertyEditorPaintRowWithSlide(doc, host, entry, selected, modal) {
  propertyEditorPaintRowBeforeRename(doc, host, entry, selected, modal);
  const button = host?.lastElementChild || host?.lastChild;
  const slide = modal && modal.propertyEditorSlide;
  if (!button || !slide || slide.id !== entry.id) return;
  if (propertyEditorRenameReorderReducedMotion(modal, doc)) return;
  const className = slide.direction === "up" ? "is-sliding-up" : "is-sliding-down";
  try { button.classList?.add?.(className); } catch (_) {}
  try {
    const current = String(button.className || button.getAttribute?.("class") || "");
    if (!current.split(/\s+/).includes(className)) {
      const next = `${current} ${className}`.trim();
      button.className = next;
      button.setAttribute?.("class", next);
    }
  } catch (_) {}
};

const propertyEditorPaintAllBeforeRename = propertyEditorPaintAll;
propertyEditorPaintAll = function propertyEditorPaintAllWithRenameReorder(host, options, doc, modal) {
  propertyEditorPaintAllBeforeRename(host, options, doc, modal);
  const menu = host?.querySelector?.("[role='menu']");
  if (menu && options && options.menuOpen) {
    const selected = modal.editorSelected?.();
    const mutable = selected ? propertyEditorCanMutate(selected.row) : false;
    const filtered = Boolean(options.filterQuery);
    propertyEditorRenameReorderMenuButton(doc, menu, modal, "Rename current property  r", "rename", !mutable);
    if (!filtered) {
      propertyEditorRenameReorderMenuButton(doc, menu, modal, "Move down  Alt+J", "move-down", !mutable || modal.pendingApply === true);
      propertyEditorRenameReorderMenuButton(doc, menu, modal, "Move up  Alt+K", "move-up", !mutable || modal.pendingApply === true);
    }
  }
  const hints = host?.querySelector?.(".bob-property-editor-hints");
  propertyEditorSetText(hints,
    "j/k move · r rename · Alt+J/K reorder · Space mark · V range · / filter · Ctrl+D delete · o/O add · Enter/l open · u undo · y YAML · Esc back");
  const selectedId = options && options.selectedId;
  if (selectedId) {
    const button = propertyEditorFindRowButton(host, selectedId);
    try { button?.scrollIntoView?.({ block: "nearest" }); } catch (_) {}
  }
};

const propertyEditorStageViewBeforeRename = PropertyEditorModal.prototype.propertyEditorStageView;
const propertyEditorBuildBeforeRename = PropertyEditorModal.prototype.propertyEditorBuildCurrentStage;
const propertyEditorPreviewTextBeforeRename = PropertyEditorModal.prototype.propertyEditorStagePreviewText;
const propertyEditorPerformBeforeRename = PropertyEditorModal.prototype.propertyEditorPerform;
const propertyEditorApplyBeforeRename = PropertyEditorModal.prototype.propertyEditorApplyStage;
const propertyEditorReconcileBeforeRename = PropertyEditorModal.prototype.propertyEditorReconcile;
const propertyEditorCloseBeforeRename = PropertyEditorModal.prototype.onClose;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorStartRename() {
    if (this.closed) return false;
    if (this.pendingApply === true) {
      this.propertyEditorRefuseWhileSaving?.();
      return false;
    }
    if (this.stage || this.addName) {
      this.announce = typeof PROPERTY_EDITOR_FINISH_EDIT_FIRST === "string"
        ? PROPERTY_EDITOR_FINISH_EDIT_FIRST
        : "Finish the open edit first.";
      this.paintPropertyEditor();
      return false;
    }
    const selected = this.editorSelected();
    if (!selected) return false;
    if (!propertyEditorCanMutate(selected.row)) {
      const decision = propertyEditorActionForRow(selected.row);
      this.refusal = {
        code: "locked",
        message: decision.reason || `Cannot rename “${selected.row.key}”.`,
        hint: "y opens YAML.",
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.announce = this.refusal.message;
      this.paintPropertyEditor();
      return false;
    }
    this.stageSeq = (this.stageSeq || 0) + 1;
    this.stage = {
      id: this.stageSeq,
      rename: true,
      rowId: selected.id,
      key: selected.row.key,
      line: selected.row.line,
      kind: "rename",
      wireKind: "text",
      value: selected.row.key,
      items: [],
      itemDraft: "",
      revision: 0,
      previewText: "Type a new name · Enter previews and saves",
      suggestionIndex: -1,
      suggestionCatalog: [],
    };
    this.pendingStageEnter = null;
    this.stageComposing = false;
    this.stageNeedsPreview = false;
    this.refusal = null;
    this.status = { kind: "ready", text: "" };
    this.announce = `Rename “${selected.row.key}”.`;
    this.menuOpen = false;
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorReorderLockReason() {
    if (typeof this.propertyEditorFilterQuery === "string" && this.propertyEditorFilterQuery) {
      return PROPERTY_EDITOR_REORDER_FILTER_HINT;
    }
    if (this.stage || this.addName) {
      return typeof PROPERTY_EDITOR_FINISH_EDIT_FIRST === "string"
        ? PROPERTY_EDITOR_FINISH_EDIT_FIRST
        : "Finish the open edit first.";
    }
    if (this.pendingApply === true) {
      return typeof PROPERTY_EDITOR_SAVING_TEXT === "string"
        ? PROPERTY_EDITOR_SAVING_TEXT
        : "A property save is already running.";
    }
    return "";
  }
,
  async propertyEditorMoveFocused(direction, event) {
    if (this.closed) return false;
    if (event && event.repeat === true) return false;
    const lock = this.propertyEditorReorderLockReason();
    if (lock) {
      if (this.pendingApply === true) this.propertyEditorRefuseWhileSaving?.();
      else {
        this.announce = lock;
        this.status = { kind: "ready", text: lock };
        this.paintPropertyEditor();
      }
      return false;
    }
    const plan = propertyEditorSourceMovePlan(this.editorOrderedRows(), this.selectedId, direction);
    if (!plan.ok) {
      if (plan.noop === true) return false;
      this.refusal = { code: plan.code || "locked", message: plan.message, hint: plan.hint || "" };
      this.status = { kind: "refusal", text: plan.message };
      this.announce = plan.message;
      this.paintPropertyEditor();
      return false;
    }
    const session = this.editorEnsureSession();
    if (!session) {
      this.refusal = { code: "unavailable", message: "Property editing is unavailable.", hint: "" };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.paintPropertyEditor();
      return false;
    }
    this.status = propertyEditorStatusChecking();
    this.refusal = null;
    this.menuOpen = false;
    this.paintPropertyEditor();
    this.pendingApply = true;
    let result = null;
    try {
      result = await session.applyOps([plan.op]);
    } catch (error) {
      result = { ok: false, code: "failed", message: error?.message || "The property update failed." };
    } finally {
      this.pendingApply = false;
    }
    if (this.closed) return false;
    if (result && result.ok === true) {
      const report = result.report && Array.isArray(result.report.properties)
        ? { ...this.report, ...result.report }
        : null;
      if (report) this.propertyEditorReconcile(report);
      this.status = propertyEditorStatusSaved();
      this.refusal = null;
      this.announce = `Moved “${plan.key}” to source position ${plan.position} of ${plan.total}.`;
      this.propertyEditorSlideToken = (this.propertyEditorSlideToken || 0) + 1;
      const token = this.propertyEditorSlideToken;
      const reduced = propertyEditorRenameReorderReducedMotion(this, this.contentEl?.ownerDocument);
      if (!reduced) {
        this.propertyEditorSlide = { id: this.selectedId, direction: plan.direction, token };
        propertyEditorRenameReorderScheduleSlide(this, token);
      } else {
        this.propertyEditorSlide = null;
      }
    } else {
      const refusal = propertyEditorStatusRefusal(result && result.report && result.report.error
        ? result.report.error : result || {});
      this.refusal = refusal;
      this.status = { kind: "refusal", text: refusal.message };
      this.announce = refusal.message;
    }
    this.paintPropertyEditor();
    return Boolean(result && result.ok === true);
  }
,
  propertyEditorStageView() {
    const view = propertyEditorStageViewBeforeRename.call(this);
    if (view && this.stage && this.stage.rename) {
      return {
        ...view,
        rename: true,
        kind: "rename",
        label: "Name",
        collection: false,
        prose: false,
        suggestions: [],
      };
    }
    return view;
  }
,
  propertyEditorBuildCurrentStage() {
    if (this.stage && this.stage.rename) {
      return propertyEditorRenameStageBuild(this.stage, this.propertyEditorCurrentStageDraft(), this.properties);
    }
    return propertyEditorBuildBeforeRename.call(this);
  }
,
  propertyEditorStagePreviewText(built) {
    if (this.stage && this.stage.rename) {
      if (!built || built.ok !== true) return built?.message || "Enter a valid property name.";
      if (!built.changed) return "Same name · Esc returns to properties";
      return `Preview · rename “${this.stage.key}” to “${built.value}” · Enter saves`;
    }
    return propertyEditorPreviewTextBeforeRename.call(this, built);
  }
,
  async propertyEditorPerform(action, event) {
    if (action === "rename") return this.propertyEditorStartRename();
    if (action === "move-up") return this.propertyEditorMoveFocused("up", event);
    if (action === "move-down") return this.propertyEditorMoveFocused("down", event);
    return propertyEditorPerformBeforeRename.call(this, action, event);
  }
,
  async propertyEditorApplyStage(built) {
    if (this.stage && this.stage.rename && built && built.ok === true && built.changed === true) {
      this.propertyEditorPendingRename = { from: this.stage.key, to: built.value };
    }
    try {
      return await propertyEditorApplyBeforeRename.call(this, built);
    } finally {
      this.propertyEditorPendingRename = null;
    }
  }
,
  propertyEditorReconcile(report) {
    const pending = this.propertyEditorPendingRename;
    const oldRows = pending ? this.editorOrderedRows() : [];
    const oldSelected = this.selectedId;
    const oldMarks = pending && typeof propertyEditorSelectionFilterMarkedIds === "function"
      ? new Set(propertyEditorSelectionFilterMarkedIds(this))
      : new Set();
    propertyEditorReconcileBeforeRename.call(this, report);
    if (!pending || !pending.from || !pending.to || pending.from === pending.to) return;
    const mapped = propertyEditorRenameRemapFocus(
      oldRows,
      this.editorOrderedRows(),
      pending.from,
      pending.to,
      oldSelected,
      oldMarks,
    );
    if (!mapped.renamedId) return;
    this.selectedId = mapped.selectedId;
    if (!(this.propertyEditorManualMarks instanceof Set)) this.propertyEditorManualMarks = new Set();
    if (mapped.markedIds.has(mapped.renamedId)) this.propertyEditorManualMarks.add(mapped.renamedId);
  }
,
  onClose() {
    this.propertyEditorSlideToken = (this.propertyEditorSlideToken || 0) + 1;
    propertyEditorRenameReorderClearSlide(this);
    this.propertyEditorSlide = null;
    this.propertyEditorPendingRename = null;
    return propertyEditorCloseBeforeRename.call(this);
  }
,
});
