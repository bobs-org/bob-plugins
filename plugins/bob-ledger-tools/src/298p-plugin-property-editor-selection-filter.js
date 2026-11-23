// Selection, visible-row filtering, and one-batch deletion for the native
// property editor parity phase. This fragment extends the landed guarded
// modal without introducing a second writer.
function propertyEditorSelectionFilterValueText(value, seen = new Set()) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  const parts = Array.isArray(value)
    ? value.map((item) => propertyEditorSelectionFilterValueText(item, seen))
    : Object.keys(value).flatMap((key) => [key, propertyEditorSelectionFilterValueText(value[key], seen)]);
  seen.delete(value);
  return parts.filter(Boolean).join(" ");
}

function propertyEditorSelectionFilterMatches(row, query) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = `${row && row.key || ""} ${propertyEditorSelectionFilterValueText(row && row.value)}`;
  return haystack.toLowerCase().includes(needle);
}

function propertyEditorSelectionFilterGroups(properties, query = "") {
  return propertyEditorGroupRows(properties).map((group) => ({
    ...group,
    rows: group.rows.filter((entry) => propertyEditorSelectionFilterMatches(entry.row, query)),
  })).filter((group) => group.rows.length > 0);
}

function propertyEditorSelectionFilterEntries(modal) {
  propertyEditorSelectionFilterEnsure(modal);
  const rows = modal && modal.report && Array.isArray(modal.report.properties)
    ? modal.properties
    : modal && modal.properties && modal.properties.length ? modal.properties : modal && modal.cacheRows;
  return propertyEditorSelectionFilterGroups(rows, modal && modal.propertyEditorFilterQuery)
    .flatMap((group) => group.rows);
}

function propertyEditorSelectionFilterEnsure(modal) {
  if (!modal) return;
  if (!(modal.propertyEditorManualMarks instanceof Set)) modal.propertyEditorManualMarks = new Set();
  if (!(modal.propertyEditorRangeMarks instanceof Set)) modal.propertyEditorRangeMarks = new Set();
  if (typeof modal.propertyEditorFilterQuery !== "string") modal.propertyEditorFilterQuery = "";
  if (typeof modal.propertyEditorFilterInputFocused !== "boolean") modal.propertyEditorFilterInputFocused = false;
  if (typeof modal.propertyEditorRangeActive !== "boolean") modal.propertyEditorRangeActive = false;
  if (typeof modal.propertyEditorRangeAnchorId !== "string") modal.propertyEditorRangeAnchorId = "";
}

function propertyEditorSelectionFilterMarkedIds(modal) {
  propertyEditorSelectionFilterEnsure(modal);
  return new Set([
    ...modal.propertyEditorManualMarks,
    ...modal.propertyEditorRangeMarks,
  ]);
}

function propertyEditorSelectionFilterClearMarks(modal) {
  propertyEditorSelectionFilterEnsure(modal);
  const hadMarks = modal.propertyEditorManualMarks.size > 0 || modal.propertyEditorRangeMarks.size > 0;
  modal.propertyEditorManualMarks.clear();
  modal.propertyEditorRangeMarks.clear();
  modal.propertyEditorRangeAnchorId = "";
  modal.propertyEditorRangeActive = false;
  return hadMarks;
}

function propertyEditorSelectionFilterSetQuery(modal, query) {
  propertyEditorSelectionFilterEnsure(modal);
  const next = String(query == null ? "" : query);
  if (next === modal.propertyEditorFilterQuery) return false;
  const hadMarks = propertyEditorSelectionFilterClearMarks(modal);
  const wasEmpty = modal.propertyEditorFilterQuery.length === 0;
  modal.propertyEditorFilterQuery = next;
  if (wasEmpty && next) modal.propertyEditorFilterReturnSelectionId = modal.selectedId || "";
  if (!next) {
    const returnId = modal.propertyEditorFilterReturnSelectionId;
    if (returnId && propertyEditorSelectionFilterEntries({
      ...modal,
      propertyEditorFilterQuery: "",
    }).some((entry) => entry.id === returnId)) modal.selectedId = returnId;
    modal.propertyEditorFilterReturnSelectionId = "";
  }
  const visible = propertyEditorSelectionFilterEntries(modal);
  if (!visible.some((entry) => entry.id === modal.selectedId)) {
    modal.selectedId = visible.length ? visible[0].id : "";
  }
  modal.announce = hadMarks ? "Filter changed — selection cleared." : "";
  return true;
}

function propertyEditorSelectionFilterRangeTo(modal, targetId) {
  propertyEditorSelectionFilterEnsure(modal);
  const visible = propertyEditorSelectionFilterEntries(modal);
  const targetIndex = visible.findIndex((entry) => entry.id === targetId);
  if (targetIndex < 0) return;
  let anchorIndex = visible.findIndex((entry) => entry.id === modal.propertyEditorRangeAnchorId);
  if (anchorIndex < 0) {
    modal.propertyEditorRangeAnchorId = modal.selectedId || targetId;
    anchorIndex = visible.findIndex((entry) => entry.id === modal.propertyEditorRangeAnchorId);
  }
  if (anchorIndex < 0) anchorIndex = targetIndex;
  modal.propertyEditorRangeMarks = new Set(
    visible.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
      .map((entry) => entry.id),
  );
}

function propertyEditorSelectionFilterMove(modal, delta, extend = false) {
  propertyEditorSelectionFilterEnsure(modal);
  const visible = propertyEditorSelectionFilterEntries(modal);
  if (!visible.length) {
    modal.selectedId = "";
    modal.paintPropertyEditor();
    return;
  }
  let index = visible.findIndex((entry) => entry.id === modal.selectedId);
  if (index < 0) index = 0;
  const next = Math.max(0, Math.min(visible.length - 1, index + delta));
  if (extend && !modal.propertyEditorRangeActive) {
    modal.propertyEditorRangeActive = true;
    modal.propertyEditorRangeAnchorId = modal.selectedId || visible[index].id;
  }
  modal.selectedId = visible[next].id;
  modal.propertyEditorFilterInputFocused = false;
  modal.announce = "";
  if (modal.propertyEditorRangeActive) propertyEditorSelectionFilterRangeTo(modal, modal.selectedId);
  modal.paintPropertyEditor();
}

function propertyEditorSelectionFilterEdge(modal, edge) {
  const visible = propertyEditorSelectionFilterEntries(modal);
  if (!visible.length) {
    modal.selectedId = "";
    modal.paintPropertyEditor();
    return;
  }
  const target = edge === "top" ? visible[0] : visible[visible.length - 1];
  if (modal.propertyEditorRangeActive) propertyEditorSelectionFilterRangeTo(modal, target.id);
  modal.selectedId = target.id;
  modal.propertyEditorFilterInputFocused = false;
  modal.announce = "";
  modal.paintPropertyEditor();
}

function propertyEditorSelectionFilterToggleMark(modal) {
  const entry = propertyEditorSelectionFilterEntries(modal)
    .find((candidate) => candidate.id === modal.selectedId);
  if (!entry) return;
  propertyEditorSelectionFilterEnsure(modal);
  if (propertyEditorSelectionFilterMarkedIds(modal).has(entry.id)) {
    modal.propertyEditorManualMarks.delete(entry.id);
    modal.propertyEditorRangeMarks.delete(entry.id);
  } else modal.propertyEditorManualMarks.add(entry.id);
  modal.announce = propertyEditorSelectionFilterMarkedIds(modal).has(entry.id)
    ? `Marked ${entry.row.key}.`
    : `Unmarked ${entry.row.key}.`;
  modal.paintPropertyEditor();
}

function propertyEditorSelectionFilterToggleRange(modal) {
  propertyEditorSelectionFilterEnsure(modal);
  if (modal.propertyEditorRangeActive) {
    for (const id of modal.propertyEditorRangeMarks) modal.propertyEditorManualMarks.add(id);
    modal.propertyEditorRangeMarks.clear();
    modal.propertyEditorRangeAnchorId = "";
    modal.propertyEditorRangeActive = false;
    modal.announce = "Visual range kept.";
  } else {
    const entry = propertyEditorSelectionFilterEntries(modal)
      .find((candidate) => candidate.id === modal.selectedId);
    if (!entry) return;
    modal.propertyEditorRangeActive = true;
    modal.propertyEditorRangeAnchorId = entry.id;
    modal.propertyEditorRangeMarks = new Set([entry.id]);
    modal.announce = `Visual range starts at ${entry.row.key}.`;
  }
  modal.paintPropertyEditor();
}

function propertyEditorSelectionFilterRemapIds(ids, oldRows, newRows) {
  const oldById = new Map(oldRows.map((entry) => [entry.id, entry]));
  const newById = new Map(newRows.map((entry) => [entry.id, entry]));
  const oldCounts = new Map();
  const newCounts = new Map();
  for (const entry of oldRows) oldCounts.set(entry.row.key, (oldCounts.get(entry.row.key) || 0) + 1);
  for (const entry of newRows) newCounts.set(entry.row.key, (newCounts.get(entry.row.key) || 0) + 1);
  const mapped = new Set();
  for (const id of ids) {
    if (newById.has(id)) {
      mapped.add(id);
      continue;
    }
    const prior = oldById.get(id);
    if (!prior || oldCounts.get(prior.row.key) !== 1 || newCounts.get(prior.row.key) !== 1) continue;
    const current = newRows.find((entry) => entry.row.key === prior.row.key);
    if (current) mapped.add(current.id);
  }
  return mapped;
}

async function propertyEditorSelectionFilterDelete(modal) {
  if (modal.closed) return;
  if (modal.pendingApply) {
    modal.propertyEditorRefuseWhileSaving?.();
    return;
  }
  const visible = propertyEditorSelectionFilterEntries(modal);
  const visibleIds = new Set(visible.map((entry) => entry.id));
  const allRows = modal.editorOrderedRows();
  const marks = propertyEditorSelectionFilterMarkedIds(modal);
  const selected = marks.size
    ? allRows.filter((entry) => marks.has(entry.id) && visibleIds.has(entry.id))
    : visible.filter((entry) => entry.id === modal.selectedId);
  if (!selected.length) return;

  const locked = selected.filter((entry) => !propertyEditorCanMutate(entry.row));
  if (locked.length) {
    const names = locked.map((entry) => `“${entry.row.key}”`).join(", ");
    modal.refusal = {
      code: "locked",
      message: `Cannot delete selection; locked properties: ${names}.`,
      hint: "Remove the locked rows from the selection — y opens YAML.",
    };
    modal.status = { kind: "refusal", text: modal.refusal.message };
    modal.announce = modal.refusal.message;
    modal.paintPropertyEditor();
    return;
  }
  const ops = selected.map((entry) => propertyEditorUnsetOp(entry.row)).filter(Boolean);
  if (!ops.length) return;
  const session = modal.editorEnsureSession();
  if (!session) {
    modal.refusal = { code: "unavailable", message: "Property editing is unavailable.", hint: "" };
    modal.status = { kind: "refusal", text: modal.refusal.message };
    modal.paintPropertyEditor();
    return;
  }

  modal.status = propertyEditorStatusChecking();
  modal.refusal = null;
  modal.propertyEditorFilterInputFocused = false;
  modal.paintPropertyEditor();
  modal.pendingApply = true;
  let result = null;
  try {
    result = await session.applyOps(ops);
  } catch (error) {
    result = { ok: false, code: "failed", message: error?.message || "The property update failed." };
  } finally {
    modal.pendingApply = false;
  }
  if (modal.closed) return;
  modal.announce = "";
  if (result && result.ok === true) {
    const report = result.report && Array.isArray(result.report.properties)
      ? { ...modal.report, ...result.report }
      : null;
    if (report) modal.propertyEditorReconcile(report);
    modal.status = propertyEditorStatusSaved();
    modal.refusal = null;
    propertyEditorSelectionFilterClearMarks(modal);
  } else {
    const refusal = propertyEditorStatusRefusal(result && result.report && result.report.error
      ? result.report.error : result || {});
    modal.refusal = refusal;
    modal.status = { kind: "refusal", text: refusal.message };
  }
  modal.paintPropertyEditor();
}

function propertyEditorSelectionFilterPerform(modal, action) {
  if (action === "up") { propertyEditorSelectionFilterMove(modal, -1); return true; }
  if (action === "down") { propertyEditorSelectionFilterMove(modal, 1); return true; }
  if (action === "top" || action === "bottom") { propertyEditorSelectionFilterEdge(modal, action); return true; }
  if (action === "range-up") { propertyEditorSelectionFilterMove(modal, -1, true); return true; }
  if (action === "range-down") { propertyEditorSelectionFilterMove(modal, 1, true); return true; }
  if (action === "toggle-mark") { propertyEditorSelectionFilterToggleMark(modal); return true; }
  if (action === "visual-range") { propertyEditorSelectionFilterToggleRange(modal); return true; }
  if (action === "filter") {
    propertyEditorSelectionFilterEnsure(modal);
    modal.filterOpen = true;
    modal.propertyEditorFilterInputFocused = true;
    modal.announce = "Filter properties by key and value.";
    modal.paintPropertyEditor();
    return true;
  }
  if (action === "delete") {
    void propertyEditorSelectionFilterDelete(modal);
    return true;
  }
  return false;
}

const propertyEditorBasePaintOptionsSelectionFilter = PropertyEditorModal.prototype.propertyEditorPaintOptions;
PropertyEditorModal.prototype.propertyEditorPaintOptions = function propertyEditorPaintOptionsWithSelectionFilter() {
  propertyEditorSelectionFilterEnsure(this);
  const options = propertyEditorBasePaintOptionsSelectionFilter.call(this);
  const query = this.propertyEditorFilterQuery;
  options.groups = (options.groups || []).map((group) => ({
    ...group,
    rows: group.rows.filter((entry) => propertyEditorSelectionFilterMatches(entry.row, query)),
  })).filter((group) => group.rows.length > 0);
  options.visible = options.groups.flatMap((group) => group.rows);
  options.markedIds = propertyEditorSelectionFilterMarkedIds(this);
  options.filterOpen = this.filterOpen === true;
  options.filterQuery = query;
  options.filterInputFocused = this.propertyEditorFilterInputFocused === true;
  options.rangeActive = this.propertyEditorRangeActive === true;
  options.rangeAnchorId = this.propertyEditorRangeAnchorId;
  options.menuOpen = this.menuOpen === true;
  return options;
};

const propertyEditorBaseOrderedRowsSelectionFilter = PropertyEditorModal.prototype.editorOrderedRows;
PropertyEditorModal.prototype.editorOrderedRows = function editorOrderedRowsWithSelectionFilter() {
  if (this.report && Array.isArray(this.report.properties)) {
    return (this.properties || []).map((row, index) => ({ row, index, id: propertyEditorRowId(row, index) }))
      .filter((entry) => entry.row && typeof entry.row.key === "string");
  }
  return propertyEditorBaseOrderedRowsSelectionFilter.call(this);
};

PropertyEditorModal.prototype.editorSelected = function editorSelectedVisible() {
  const entries = propertyEditorSelectionFilterEntries(this);
  return entries.find((entry) => entry.id === this.selectedId) || entries[0] || null;
};

const propertyEditorBaseCaptureCaretSelectionFilter = PropertyEditorModal.prototype.editorCaptureCaret;
PropertyEditorModal.prototype.editorCaptureCaret = function editorCaptureCaretWithFilter(doc) {
  const caret = propertyEditorBaseCaptureCaretSelectionFilter.call(this, doc);
  const active = doc?.activeElement;
  if (active && active.getAttribute?.("data-property-filter-input") === "true") {
    return {
      ...(caret || {}),
      filter: true,
      selectionStart: active.selectionStart ?? null,
      selectionEnd: active.selectionEnd ?? null,
    };
  }
  return caret;
};

const propertyEditorBaseRestoreFocusSelectionFilter = PropertyEditorModal.prototype.editorRestoreFocus;
PropertyEditorModal.prototype.editorRestoreFocus = function editorRestoreFocusWithFilter(doc, caret) {
  if (this.menuOpen) {
    const item = this.contentEl?.querySelector?.("[role='menuitem']:not([disabled])");
    if (item && typeof item.focus === "function") { item.focus(); return; }
  }
  if (this.filterOpen && this.propertyEditorFilterInputFocused) {
    const input = this.contentEl?.querySelector?.("[data-property-filter-input='true']");
    if (input && typeof input.focus === "function") {
      input.focus();
      if (caret?.filter && Number.isInteger(caret.selectionStart)) {
        try { input.setSelectionRange(caret.selectionStart, caret.selectionEnd ?? caret.selectionStart); } catch (_) {}
      }
      return;
    }
  }
  propertyEditorBaseRestoreFocusSelectionFilter.call(this, doc, caret);
};

const propertyEditorBaseSelectSelectionFilter = PropertyEditorModal.prototype.propertyEditorSelect;
PropertyEditorModal.prototype.propertyEditorSelect = function propertyEditorSelectVisible(id) {
  if (!propertyEditorSelectionFilterEntries(this).some((entry) => entry.id === id)) return;
  this.propertyEditorFilterInputFocused = false;
  return propertyEditorBaseSelectSelectionFilter.call(this, id);
};

const propertyEditorBaseReconcileSelectionFilter = PropertyEditorModal.prototype.propertyEditorReconcile;
PropertyEditorModal.prototype.propertyEditorReconcile = function propertyEditorReconcileSelectionFilter(report) {
  propertyEditorSelectionFilterEnsure(this);
  const oldRows = this.editorOrderedRows();
  const oldManual = this.propertyEditorManualMarks;
  const oldRange = this.propertyEditorRangeMarks;
  const oldAnchor = this.propertyEditorRangeAnchorId;
  propertyEditorBaseReconcileSelectionFilter.call(this, report);
  if (report && Array.isArray(report.properties)) this.cacheRows = [];
  const newRows = this.editorOrderedRows();
  this.propertyEditorManualMarks = propertyEditorSelectionFilterRemapIds(oldManual, oldRows, newRows);
  this.propertyEditorRangeMarks = propertyEditorSelectionFilterRemapIds(oldRange, oldRows, newRows);
  const anchor = propertyEditorSelectionFilterRemapIds(new Set(oldAnchor ? [oldAnchor] : []), oldRows, newRows);
  this.propertyEditorRangeAnchorId = anchor.values().next().value || "";
  if (!this.propertyEditorRangeAnchorId) this.propertyEditorRangeActive = false;
  const visible = propertyEditorSelectionFilterEntries(this);
  if (!visible.some((entry) => entry.id === this.selectedId)) this.selectedId = visible[0]?.id || "";
  this.paintPropertyEditor();
};

const propertyEditorBaseBackOutSelectionFilter = PropertyEditorModal.prototype.propertyEditorBackOut;
PropertyEditorModal.prototype.propertyEditorBackOut = function propertyEditorBackOutSelectionFilter(event) {
  if (this.menuOpen || this.stage || this.addName) {
    return propertyEditorBaseBackOutSelectionFilter.call(this, event);
  }
  if (this.filterOpen || this.propertyEditorFilterQuery) {
    this.filterOpen = false;
    this.propertyEditorFilterInputFocused = false;
    if (this.propertyEditorFilterQuery) propertyEditorSelectionFilterSetQuery(this, "");
    else this.paintPropertyEditor();
    return;
  }
  return propertyEditorBaseBackOutSelectionFilter.call(this, event);
};

const propertyEditorBasePerformSelectionFilter = PropertyEditorModal.prototype.propertyEditorPerform;
PropertyEditorModal.prototype.propertyEditorPerform = async function propertyEditorPerformSelectionFilter(action, event) {
  if (propertyEditorSelectionFilterPerform(this, action)) return;
  return propertyEditorBasePerformSelectionFilter.call(this, action, event);
};

const propertyEditorBaseKeyDownSelectionFilter = PropertyEditorModal.prototype.propertyEditorOnKeyDown;
PropertyEditorModal.prototype.propertyEditorOnKeyDown = function propertyEditorOnKeyDownSelectionFilter(event) {
  const target = event?.target;
  const isFilterInput = target?.getAttribute?.("data-property-filter-input") === "true";
  if (isFilterInput && (event.key === "Enter" || event.key === "ArrowDown")
    && !event.ctrlKey && !event.metaKey && !event.altKey) {
    try { event.preventDefault?.(); } catch (_) {}
    this.propertyEditorFilterInputFocused = false;
    const visible = propertyEditorSelectionFilterEntries(this);
    if (!visible.some((entry) => entry.id === this.selectedId)) this.selectedId = visible[0]?.id || "";
    this.paintPropertyEditor();
    return;
  }
  return propertyEditorBaseKeyDownSelectionFilter.call(this, event);
};

const propertyEditorBaseMoveSelectionFilter = PropertyEditorModal.prototype.propertyEditorMove;
PropertyEditorModal.prototype.propertyEditorMove = function propertyEditorMoveVisible(delta) {
  return propertyEditorSelectionFilterMove(this, delta);
};
const propertyEditorBaseMoveEdgeSelectionFilter = PropertyEditorModal.prototype.propertyEditorMoveEdge;
PropertyEditorModal.prototype.propertyEditorMoveEdge = function propertyEditorMoveEdgeVisible(edge) {
  return propertyEditorSelectionFilterEdge(this, edge);
};

const propertyEditorBasePaintRowSelectionFilter = propertyEditorPaintRow;
propertyEditorPaintRow = function propertyEditorPaintRowWithMarks(doc, host, entry, selected, modal) {
  propertyEditorBasePaintRowSelectionFilter(doc, host, entry, selected, modal);
  const button = host?.lastElementChild || host?.lastChild;
  const grid = button?.querySelector?.(".bob-property-row-grid");
  if (!button || !grid) return;
  propertyEditorSelectionFilterEnsure(modal);
  const marks = propertyEditorSelectionFilterMarkedIds(modal);
  const marked = marks.has(entry.id);
  const gutter = propertyEditorCreateEl(doc, "span", `bob-property-row-mark${marked ? " is-marked" : ""}`);
  propertyEditorSetText(gutter, marked ? "✓" : "○");
  try {
    gutter.setAttribute("role", "img");
    gutter.setAttribute("aria-label", marked ? `Marked: ${entry.row.key}` : `Not marked: ${entry.row.key}`);
    gutter.setAttribute("data-property-mark-gutter", "true");
    button.setAttribute("data-property-marked", marked ? "true" : "false");
    button.setAttribute("aria-description", marked ? "Marked for batch actions" : "Not marked");
    if (marked) button.classList?.add?.("is-marked");
    if (modal.propertyEditorRangeActive && modal.propertyEditorRangeAnchorId === entry.id) {
      button.setAttribute("data-range-anchor", "true");
    }
  } catch (_) {}
  try { grid.insertBefore(gutter, grid.firstChild || null); } catch (_) { try { grid.prepend(gutter); } catch (_) {} }
};

const propertyEditorBasePaintAllSelectionFilter = propertyEditorPaintAll;
function propertyEditorSelectionFilterInsertBefore(parent, node, before) {
  try {
    if (parent && node && typeof parent.insertBefore === "function") parent.insertBefore(node, before || null);
    else parent?.appendChild?.(node);
  } catch (_) {}
}

function propertyEditorSelectionFilterMenuButton(doc, menu, modal, label, action, disabled = false) {
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
      button.setAttribute("title", "Clear the filter before reordering properties.");
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

propertyEditorPaintAll = function propertyEditorPaintAllWithSelectionFilter(host, options, doc, modal) {
  propertyEditorBasePaintAllSelectionFilter(host, options, doc, modal);
  const header = host?.querySelector?.(".bob-property-editor-header");
  const list = host?.querySelector?.(".bob-property-editor-list");
  if (!header) return;

  const controls = propertyEditorCreateEl(doc, "div", "bob-property-editor-actions");
  const filterButton = propertyEditorCreateEl(doc, "button", "bob-property-editor-filter-button");
  const allButton = propertyEditorCreateEl(doc, "button", "bob-property-editor-actions-button");
  if (filterButton) {
    propertyEditorSetText(filterButton, "/ Filter");
    filterButton.setAttribute("type", "button");
    filterButton.setAttribute("aria-label", "Filter properties");
    filterButton.addEventListener("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      modal.menuOpen = false;
      void modal.propertyEditorPerform("filter");
    });
    controls?.appendChild(filterButton);
  }
  if (allButton) {
    propertyEditorSetText(allButton, "⋯ All actions");
    allButton.setAttribute("type", "button");
    allButton.setAttribute("aria-label", "All property actions");
    allButton.setAttribute("aria-expanded", options.menuOpen ? "true" : "false");
    allButton.addEventListener("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      modal.menuOpen = !modal.menuOpen;
      modal.propertyEditorFilterInputFocused = false;
      modal.paintPropertyEditor();
    });
    controls?.appendChild(allButton);
  }
  if (controls) header.appendChild(controls);

  let insertAfter = header;
  if (options.filterOpen) {
    const filter = propertyEditorCreateEl(doc, "div", "bob-property-editor-filter");
    const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-filter-label");
    const input = propertyEditorCreateEl(doc, "input", "bob-property-editor-filter-input");
    propertyEditorSetText(label, "Filter properties");
    if (input) {
      input.type = "search";
      input.value = options.filterQuery || "";
      input.setAttribute("type", "search");
      input.setAttribute("data-property-filter-input", "true");
      input.setAttribute("aria-label", "Filter properties by key and value");
      label.setAttribute("for", "bob-property-editor-filter-input");
      input.setAttribute("id", "bob-property-editor-filter-input");
      input.addEventListener("focus", () => { modal.propertyEditorFilterInputFocused = true; });
      input.addEventListener("input", () => {
        const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
        propertyEditorSelectionFilterSetQuery(modal, input.value);
        modal.paintPropertyEditor();
        const next = modal.contentEl?.querySelector?.("[data-property-filter-input='true']");
        try {
          next?.focus?.();
          if (Number.isInteger(start)) next?.setSelectionRange?.(start, end);
        } catch (_) {}
      });
      filter.appendChild(label);
      filter.appendChild(input);
    }
    propertyEditorSelectionFilterInsertBefore(host, filter, list);
    insertAfter = filter;
  }

  if (options.menuOpen) {
    const menu = propertyEditorCreateEl(doc, "div", "bob-property-editor-menu");
    if (menu) {
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "All property actions");
      const markedCount = options.markedIds?.size || 0;
      const selected = modal.editorSelected();
      propertyEditorSelectionFilterMenuButton(doc, menu, modal, "Filter properties  /", "filter");
      propertyEditorSelectionFilterMenuButton(doc, menu, modal,
        markedCount ? `Unmark current row  Space` : `Mark current row  Space`, "toggle-mark", !selected);
      propertyEditorSelectionFilterMenuButton(doc, menu, modal,
        options.rangeActive ? "Keep visual range  V" : "Start visual range  V", "visual-range", !selected);
      propertyEditorSelectionFilterMenuButton(doc, menu, modal,
        markedCount ? `Delete ${markedCount} marked properties  Ctrl+D` : "Delete current property  Ctrl+D",
        "delete", !selected);
      if (options.filterQuery) {
        propertyEditorSelectionFilterMenuButton(doc, menu, modal, "Reorder properties · clear filter first", "reorder", true);
      }
      propertyEditorSelectionFilterInsertBefore(host, menu, list);
      insertAfter = menu;
    }
  }

  if (options.filterQuery && (!options.visible || options.visible.length === 0)) {
    const empty = propertyEditorCreateEl(doc, "div", "bob-property-editor-filter-empty");
    propertyEditorSetText(empty, `No properties match “${options.filterQuery}”.`);
    try { empty.setAttribute("role", "status"); empty.setAttribute("aria-live", "polite"); } catch (_) {}
    propertyEditorSelectionFilterInsertBefore(host, empty, list);
    insertAfter = empty;
  }
  void insertAfter;
  const hints = host?.querySelector?.(".bob-property-editor-hints");
  propertyEditorSetText(hints, "j/k move · Space mark · V range · / filter · Ctrl+D delete selection · o/O add · Enter/l open · u undo · y YAML · Esc back");
};

const propertyEditorBaseReconcilePaintSelectionFilter = PropertyEditorModal.prototype.paintPropertyEditor;
PropertyEditorModal.prototype.paintPropertyEditor = function paintPropertyEditorSelectionFilter() {
  propertyEditorSelectionFilterEnsure(this);
  return propertyEditorBaseReconcilePaintSelectionFilter.call(this);
};

