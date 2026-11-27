// Property editor modal on the shared chassis (bob-cli-pf.4.1.2
// editor-shell). Cache-first grouped rows, role routing, and discrete
// actions. Mounted internally for tests; public entry-point registration
// belongs to the entrypoints-yaml phase and must not live here.
const PropertyEditorModalBase = typeof albumSchemaCardModalBase === "function"
  ? albumSchemaCardModalBase()
  : class PropertyEditorFallback {
    constructor(app) {
      this.app = app;
      this.contentEl = { children: [], empty() { this.children = []; }, appendChild(n) { this.children.push(n); return n; } };
      this.modalEl = this.contentEl;
      this.containerEl = this.contentEl;
    }
    open() { this.onOpen?.(); }
    close() { this.onClose?.(); }
  };

function propertyEditorCreateEl(doc, tag, className) {
  try {
    if (typeof notebookCreateEl === "function") return notebookCreateEl(doc, tag, className);
  } catch (_) {}
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    const el = doc.createElement(tag);
    if (className) {
      try { el.setAttribute("class", className); } catch (_) {}
      try { el.className = className; } catch (_) {}
    }
    return el;
  } catch (_) {
    return null;
  }
}

function propertyEditorSetText(el, text) {
  try {
    if (typeof notebookSetText === "function") return notebookSetText(el, text);
  } catch (_) {}
  try { if (el) el.textContent = String(text == null ? "" : text); } catch (_) {}
}

function propertyEditorRowText(row) {
  try {
    if (row && row.pending === true) return "…";
    if (typeof propertyCardFootRowText === "function") {
      const valueState = row && row.valueState
        ? row.valueState
        : row && row.value === null ? "null"
          : row && row.value === "" ? "empty-string"
            : Array.isArray(row && row.value) && row.value.length === 0 ? "empty-list"
              : row && row.value === true ? "true"
                : row && row.value === false ? "false"
                  : null;
      if (valueState) return propertyCardFootRowText({ ...row, valueState });
    }
  } catch (_) {}
  const value = row ? row.value : undefined;
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "empty" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "empty list" : value.map((v) => String(v)).join(", ");
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function propertyEditorBadgeKind(noteKind) {
  const kind = String(noteKind || "").trim().toLowerCase();
  if (kind === "record") return "record";
  if (kind === "album") return "album";
  if (kind === "bank") return "bank";
  return null;
}

class PropertyEditorModal extends PropertyEditorModalBase {
  constructor(app, options = {}) {
    super(app);
    this.propertyPlugin = options.plugin || null;
    this.filePath = typeof propertyNotePath === "function"
      ? propertyNotePath(options.filePath || options.path || "")
      : String(options.filePath || options.path || "");
    this.mode = options.mode === "edit" || options.mode === "add" ? options.mode : "browse";
    const fromSelection = typeof propertyEditorNormalizeSelection === "function"
      ? propertyEditorNormalizeSelection(options.selection)
      : null;
    const requestedKey = (fromSelection && fromSelection.key)
      || (typeof options.key === "string" ? options.key : "");
    this.requestedKey = requestedKey;
    // A setting-focus request survives the initial async report and works
    // for ghosts: reconcile consumes it once a report arrives. See
    // 298z settings-entrypoints for the alias map and consume logic.
    this.requestedSetting = typeof propertyEditorSettingIdForKey === "function"
      ? propertyEditorSettingIdForKey(options.setting || "")
      : "";
    this.focusSettings = options.focusSettings === true;
    this.propertyEditorSettingFocusDone = false;
    this.requestedSelection = fromSelection
      ? { ...fromSelection, key: fromSelection.key || requestedKey }
      : (requestedKey ? { key: requestedKey, ordinal: 0, line: null } : null);
    this.report = options.report && typeof options.report === "object" ? options.report : null;
    this.cacheRows = Array.isArray(options.cacheRows) ? options.cacheRows : [];
    this.properties = Array.isArray(options.properties)
      ? options.properties
      : this.report && Array.isArray(this.report.properties) ? this.report.properties.slice() : [];
    this.noteKind = options.noteKind
      || (this.report && typeof this.report.note_kind === "string" ? this.report.note_kind : "note");
    this.onCardHandoff = typeof options.onCardHandoff === "function" ? options.onCardHandoff : null;
    this.onYamlEscape = typeof options.onYamlEscape === "function" ? options.onYamlEscape : null;
    this.menuOpen = false;
    this.stage = null;
    this.filterOpen = false;
    this.selectedId = typeof options.selectedId === "string" && options.selectedId ? options.selectedId : "";
    this.status = { kind: "reading", text: propertyEditorStatusChecking().text };
    this.refusal = null;
    this.session = null;
    this.readSeq = 0;
    this.closed = false;
    this.closeToken = 0;
    this.pendingApply = false;
    this.announce = "";
    const initialRows = this.properties.length ? this.properties : this.cacheRows;
    const wanted = this.requestedSelection || (requestedKey ? { key: requestedKey, ordinal: 0, line: null } : null);
    if (typeof propertyEditorNearestId === "function") {
      if (!this.selectedId) this.selectedId = propertyEditorNearestId(initialRows, { key: "", ordinal: 0, line: null });
      if (wanted && wanted.key) {
        this.selectedId = propertyEditorNearestId(initialRows, wanted);
      }
    } else {
      const ids = propertyEditorOrderedIds(initialRows);
      if (!this.selectedId && ids.length) this.selectedId = ids[0];
      if (wanted && wanted.key) {
        const sameKey = initialRows.filter((row) => row && row.key === wanted.key);
        const match = (Number.isInteger(wanted.ordinal) && sameKey[wanted.ordinal]) || sameKey[0]
          || initialRows.find((row) => row && row.key === wanted.key);
        if (match) {
          const idx = initialRows.indexOf(match);
          this.selectedId = propertyEditorRowId(match, idx);
        }
      }
    }
    // A requested setting pre-selects its declared source row while the
    // report loads; reconcile moves it onto the settings row (or, when
    // degraded, the corresponding real property).
    if (this.requestedSetting && typeof PROPERTY_EDITOR_SETTING_KEYS === "object" && PROPERTY_EDITOR_SETTING_KEYS) {
      try {
        const keys = PROPERTY_EDITOR_SETTING_KEYS[this.requestedSetting] || [];
        const matchIndex = initialRows.findIndex((row) => row && keys.includes(row.key));
        if (matchIndex >= 0 && typeof propertyEditorRowId === "function") {
          this.selectedId = propertyEditorRowId(initialRows[matchIndex], matchIndex);
        }
      } catch (_) {}
    }
  }

  editorDoc() {
    return this.contentEl?.ownerDocument || this.app?.document
      || (typeof document !== "undefined" ? document : null);
  }

  editorReadSeq() {
    this.readSeq += 1;
    return this.readSeq;
  }

  editorLive(seq) {
    return !this.closed && seq === this.readSeq;
  }

  editorOrderedRows() {
    const rows = this.properties.length ? this.properties : this.cacheRows;
    return rows
      .map((row, index) => ({ row, index, id: propertyEditorRowId(row, index) }))
      .filter((entry) => entry.row && typeof entry.row.key === "string");
  }

  editorSelected() {
    const ordered = this.editorOrderedRows();
    if (!ordered.length) return null;
    const found = ordered.find((entry) => entry.id === this.selectedId);
    return found || ordered[0];
  }

  editorEnsureSession() {
    if (this.session) return this.session;
    const plugin = this.propertyPlugin;
    let deps = {
      spawnPreview: () => Promise.resolve({ ok: false, code: "unavailable", message: "Preview is unavailable." }),
      spawnApply: () => Promise.resolve({ ok: false, code: "unavailable", message: "Apply is unavailable." }),
      saveEditors: () => Promise.resolve({ ok: true }),
      getGeneration: () => 0,
    };
    try {
      if (plugin && typeof propertyUpdateServiceDeps === "function") {
        deps = propertyUpdateServiceDeps(plugin, {
          path: this.filePath,
          onChange: () => {
            if (this.closed) return;
            try { this.propertyEditorSyncLockWait?.(); } catch (_) {}
            try { this.propertyEditorStageSyncPreview?.(); } catch (_) {}
            this.paintPropertyEditor();
          },
        });
      }
    } catch (_) {}
    const expect = this.report && typeof this.report.fingerprint === "string" ? this.report.fingerprint : "";
    try {
      this.session = createPropertyUpdateSession(
        { path: this.filePath, expect, properties: this.properties },
        deps,
      );
    } catch (_) {
      this.session = null;
    }
    try {
      if (typeof propertyEditorRegisterSession === "function") propertyEditorRegisterSession(this);
    } catch (_) {}
    try {
      if (!this._propertyOverlayUnsub && this.propertyPlugin
        && typeof this.propertyPlugin.propertyOverlayStore === "function") {
        const store = this.propertyPlugin.propertyOverlayStore();
        if (store && typeof store.subscribe === "function") {
          const modal = this;
          this._propertyOverlayUnsub = store.subscribe((path) => {
            if (modal.closed) return;
            if (path !== modal.filePath) return;
            try { modal.paintPropertyEditor(); } catch (_) {}
          });
        }
      }
    } catch (_) {}
    return this.session;
  }

  editorRebase(fingerprint) {
    try { this.session?.rebase?.(fingerprint); } catch (_) {}
  }

  paintPropertyEditor() {
    if (this.closed) return;
    const doc = this.editorDoc();
    if (!doc) return;
    const caret = this.editorCaptureCaret(doc);
    let host = null;
    try { host = this.contentEl?.querySelector?.(".bob-property-editor"); } catch (_) {}
    if (!host) {
      try { this.contentEl?.empty?.(); } catch (_) {}
      host = propertyEditorCreateEl(doc, "div", "bob-property-editor");
      if (!host) return;
      try { host.setAttribute("role", "dialog"); } catch (_) {}
      try { host.setAttribute("tabindex", "-1"); } catch (_) {}
      try { host.setAttribute("aria-label", `Edit properties · ${this.filePath}`); } catch (_) {}
      try {
        host.addEventListener?.("click", (event) => this.propertyEditorOnClick(event));
        host.addEventListener?.("keydown", (event) => this.propertyEditorOnKeyDown(event));
      } catch (_) {}
      try { this.contentEl?.appendChild?.(host); } catch (_) {}
    }
    try {
      while (host.firstChild) host.removeChild(host.firstChild);
    } catch (_) {}
    try { propertyEditorPaintAll(host, this.propertyEditorPaintOptions(), doc, this); } catch (_) {}
    this.editorRestoreFocus(doc, caret);
  }

  propertyEditorPaintOptions() {
    const base = this.properties.length ? this.properties : this.cacheRows;
    let rows = base;
    try {
      if (typeof propertyEditorOverlayFor === "function" && typeof propertyEditorOverlayRows === "function") {
        const overlay = propertyEditorOverlayFor(this.propertyPlugin, this.filePath);
        if (overlay) rows = propertyEditorOverlayRows(base, overlay);
      }
    } catch (_) {
      rows = base;
    }
    const degraded = propertyEditorDegradedFor({
      capability: this.propertyPlugin?.propertyCapability ?? this.editorCapability(),
      report: this.report,
      cacheRows: this.cacheRows,
    });
    return {
      path: this.filePath,
      noteKind: this.noteKind,
      header: propertyEditorHeaderModel({ noteKind: this.noteKind, path: this.filePath, count: rows.length }),
      badgeKind: propertyEditorBadgeKind(this.noteKind),
      groups: propertyEditorGroupRows(rows),
      ordered: this.editorOrderedRows(),
      selectedId: this.selectedId,
      stage: typeof this.propertyEditorStageView === "function" ? this.propertyEditorStageView() : null,
      status: this.status,
      refusal: this.refusal,
      announce: this.announce,
      degraded,
      filterSlot: PROPERTY_EDITOR_FILTER_SLOT,
    };
  }

  editorCapability() {
    try {
      if (this.propertyPlugin && typeof this.propertyPlugin.apiPropertyUpdateCapable === "function") {
        return null;
      }
    } catch (_) {}
    return null;
  }

  editorCaptureCaret(doc) {
    try {
      const active = doc?.activeElement;
      if (!active || typeof active.getAttribute !== "function") return null;
      const key = active.getAttribute("data-property-key");
      if (!key) return null;
      return { key, selectionStart: active.selectionStart ?? null, selectionEnd: active.selectionEnd ?? null };
    } catch (_) {
      return null;
    }
  }

  editorRestoreFocus(doc, caret) {
    try {
      // Browse keys can change selection before the old button is removed.
      // Restore the selected source occurrence, not the previously focused
      // key: native Space would otherwise click that old row after a move.
      // Existing stage/add inputs restore their own caret before reaching
      // this method; newly opened inputs take focus from the browse row.
      // Empty notes still need a keyboard target for o/O and Mod+;.
      const host = this.contentEl?.querySelector?.(".bob-property-editor");
      const selected = this.contentEl?.querySelector?.("[data-property-add-input]")
        || this.contentEl?.querySelector?.("[data-property-stage-input]")
        || this.contentEl?.querySelector?.('[aria-current="true"]') || host;
      // Deletion overlays and the initial read can temporarily leave no
      // selected button. Return focus from the persistent host when a row
      // becomes available again.
      if (selected && typeof selected.focus === "function"
        && (caret?.key || doc?.activeElement === host
          || !doc?.activeElement || !this.contentEl?.contains?.(doc.activeElement))) {
        selected.focus();
      }
    } catch (_) {}
  }

  propertyEditorSelect(id) {
    const ordered = this.editorOrderedRows();
    if (!ordered.some((entry) => entry.id === id)) return;
    this.selectedId = id;
    this.announce = "";
    this.paintPropertyEditor();
  }

  propertyEditorMove(delta) {
    const ordered = this.editorOrderedRows();
    if (!ordered.length) return;
    let index = ordered.findIndex((entry) => entry.id === this.selectedId);
    if (index < 0) index = 0;
    const next = Math.max(0, Math.min(ordered.length - 1, index + delta));
    this.propertyEditorSelect(ordered[next].id);
  }

  propertyEditorMoveEdge(edge) {
    const ordered = this.editorOrderedRows();
    if (!ordered.length) return;
    this.propertyEditorSelect(edge === "top" ? ordered[0].id : ordered[ordered.length - 1].id);
  }

  // Reconcile a fresh show report without stealing focus or losing
  // selection: keep the selected source-line identity when it survives,
  // otherwise fall back to the nearest surviving row.
  propertyEditorReconcile(report) {
    if (this.closed || !report || typeof report !== "object") return;
    let wanted = null;
    try {
      wanted = typeof propertyEditorWantedSelection === "function"
        ? propertyEditorWantedSelection(this)
        : null;
    } catch (_) {
      wanted = null;
    }
    this.report = report;
    if (typeof report.note_kind === "string" && report.note_kind) this.noteKind = report.note_kind;
    const rows = Array.isArray(report.properties) ? report.properties.slice() : [];
    this.properties = rows;
    try { this.session?.rememberProperties?.(rows); } catch (_) {}
    if (typeof report.fingerprint === "string" && report.fingerprint) this.editorRebase(report.fingerprint);
    const ids = new Set(propertyEditorOrderedIds(rows));
    if (!ids.has(this.selectedId)) {
      if (typeof propertyEditorNearestId === "function" && wanted) {
        this.selectedId = propertyEditorNearestId(rows, wanted);
      } else {
        const ordered = this.editorOrderedRows();
        this.selectedId = ordered.length ? ordered[0].id : "";
      }
    }
    if (this.status.kind === "reading" || this.status.kind === "checking") {
      this.status = rows.length
        ? { kind: "ready", text: "" }
        : { kind: "ready", text: PROPERTY_EDITOR_EMPTY_TEXT };
    }
    this.paintPropertyEditor();
  }

  propertyEditorOnClick(event) {
    try {
      const target = event?.target?.closest?.("[data-property-key]");
      if (!target) return;
      const key = target.getAttribute("data-property-key");
      const entry = this.editorOrderedRows().find((row) => row.row.key === key
        && (target.getAttribute("data-property-row") || row.id) === (target.getAttribute("data-property-row") || row.id));
      const ordered = this.editorOrderedRows();
      const match = ordered.find((row) => row.id === target.getAttribute("data-property-row"))
        || ordered.find((row) => row.row.key === key);
      if (match) this.propertyEditorSelect(match.id);
      if (event?.detail === 2 || target.getAttribute("data-property-open") === "true") {
        void this.propertyEditorActivate(match || this.editorSelected());
      }
    } catch (_) {}
  }

  propertyEditorOnKeyDown(event) {
    let action = null;
    try {
      action = propertyEditorKeyAction(event, {
        inInput: propertyEditorEventInInput(event, this.contentEl),
      });
    } catch (_) {}
    if (!action) return;
    if (action === "close") {
      try { event?.preventDefault?.(); } catch (_) {}
      this.propertyEditorBackOut(event);
      return;
    }
    try { event?.preventDefault?.(); } catch (_) {}
    void this.propertyEditorPerform(action, event);
  }

  async propertyEditorPerform(action, event) {
    if (this.closed) return;
    if (action === "up") return this.propertyEditorMove(-1);
    if (action === "down") return this.propertyEditorMove(1);
    if (action === "top") return this.propertyEditorMoveEdge("top");
    if (action === "bottom") return this.propertyEditorMoveEdge("bottom");
    if (action === "open" || action === "toggle") return this.propertyEditorActivate(this.editorSelected());
    if (action === "delete") return this.propertyEditorDelete(this.editorSelected());
    if (action === "undo") return this.propertyEditorHistory("undo");
    if (action === "redo") return this.propertyEditorHistory("redo");
    if (action === "equals") {
      // A pending save refuses routing first: handing off would close the
      // modal and strand the flight. An open stage or add draft keeps its
      // text: routing never discards an uncommitted draft.
      if (this.pendingApply === true) {
        this.propertyEditorRefuseWhileSaving?.();
        return;
      }
      if (this.stage || this.addName) {
        this.announce = "Finish the open edit first — = is reserved while drafting.";
        return this.paintPropertyEditor();
      }
      const selected = this.editorSelected();
      const decision = selected ? propertyEditorActionForRow(selected.row) : null;
      if (decision && decision.action === "handoff") {
        try {
          this.onCardHandoff?.({
            key: selected.row.key,
            editor: decision.editor,
            owner: decision.owner,
            row: selected.row,
          });
        } catch (_) {}
        return;
      }
      // Area, project, and reference notes own no card editor: browse `=`
      // focuses the settings group in place instead of closing and
      // reopening. The request survives a pending report and applies on
      // arrival.
      if (this.noteKind === "area" || this.noteKind === "project" || this.noteKind === "reference") {
        this.focusSettings = true;
        this.propertyEditorSettingFocusDone = false;
        let focused = false;
        try {
          if (typeof propertyEditorSettingsSupported === "function"
            && propertyEditorSettingsSupported(this.report)
            && typeof propertyEditorSettingsFocusFirst === "function") {
            focused = propertyEditorSettingsFocusFirst(this) === true;
          }
        } catch (_) {
          focused = false;
        }
        if (focused) {
          this.focusSettings = false;
          this.propertyEditorSettingFocusDone = true;
          return;
        }
        this.announce = "Reading properties — settings focus when ready.";
        return this.paintPropertyEditor();
      }
      const species = typeof propertyEditorNoteKindSpecies === "function"
        ? propertyEditorNoteKindSpecies(this.noteKind)
        : null;
      if (species) {
        try {
          await this.onCardHandoff?.({
            key: selected && selected.row ? selected.row.key : "",
            editor: "=",
            owner: species,
            row: selected ? selected.row : null,
          });
        } catch (_) {}
        return;
      }
      this.announce = "This note has no card editor — y opens YAML.";
      return this.paintPropertyEditor();
    }
    if (action === "yaml") {
      if (this.pendingApply === true) {
        this.propertyEditorRefuseWhileSaving?.();
        return;
      }
      // Close the modal first, as the record card does: the Source view
      // owns the leaf while the excursion runs, and Done reopens the
      // editor on the preserved key, ordinal, and source line.
      const selected = this.editorSelected()?.row;
      let selection = null;
      try {
        selection = typeof propertyEditorWantedSelection === "function"
          ? propertyEditorWantedSelection(this)
          : null;
      } catch (_) {
        selection = null;
      }
      const key = (selection && selection.key) || selected?.key || "";
      // A key alone loses the selected occurrence when YAML has duplicates.
      // Unique keys omit line so recovery can still jump to the parse error.
      const line = selected?.duplicate === true && Number.isInteger(selected.line) ? selected.line : 0;
      const filePath = this.filePath;
      try { this.close(); } catch (_) {}
      try {
        this.onYamlEscape?.({
          path: filePath, filePath, key, selection,
          ...(line > 0 ? { line } : {}),
        });
      } catch (_) {}
      return;
    }
    void event;
  }

  async propertyEditorActivate(entry) {
    if (!entry) return;
    if (this.pendingApply) {
      this.propertyEditorRefuseWhileSaving?.();
      return;
    }
    const row = entry.row;
    const decision = propertyEditorActionForRow(row);
    if (decision.action === "handoff") {
      try {
        if (this.onCardHandoff) {
          this.onCardHandoff({ key: row.key, editor: decision.editor, owner: decision.owner, row });
          return;
        }
      } catch (_) {}
      this.refusal = {
        code: "card-handoff",
        message: `“${row.key}” lives on the ${this.noteKind} card.`,
        hint: "Open it from the card — y opens YAML.",
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      return this.paintPropertyEditor();
    }
    if (decision.action === "locked") {
      this.refusal = { code: "locked", message: decision.reason, hint: "y opens YAML." };
      this.status = { kind: "refusal", text: decision.reason };
      return this.paintPropertyEditor();
    }
    if (decision.action === "toggle") return this.propertyEditorFlip(entry);
    this.announce = `“${row.key}” opens in a typed stage — press Enter.`;
    this.status = { kind: "ready", text: "" };
    return this.paintPropertyEditor();
  }

  async propertyEditorFlip(entry) {
    if (!entry) return;
    if (this.pendingApply) {
      this.propertyEditorRefuseWhileSaving?.();
      return;
    }
    const op = propertyEditorToggleOp(entry.row);
    if (!op) return;
    this.status = propertyEditorStatusChecking();
    this.refusal = null;
    this.paintPropertyEditor();
    const session = this.editorEnsureSession();
    if (!session) {
      this.refusal = { code: "unavailable", message: "Property editing is unavailable.", hint: "" };
      this.status = { kind: "refusal", text: this.refusal.message };
      return this.paintPropertyEditor();
    }
    this.pendingApply = true;
    let result = null;
    try {
      result = await session.applyOps([op]);
    } catch (error) {
      result = { ok: false, code: "failed", message: error?.message || "The property update failed." };
    } finally {
      this.pendingApply = false;
    }
    if (this.closed) return;
    this.announce = "";
    if (result && result.ok === true) {
      if (result.report && Array.isArray(result.report.properties)) {
        this.propertyEditorReconcile({ ...this.report, ...result.report });
      }
      this.status = propertyEditorStatusSaved();
      this.refusal = null;
    } else {
      const refusal = propertyEditorStatusRefusal(result && result.report && result.report.error
        ? result.report.error : result || {});
      this.refusal = refusal;
      this.status = { kind: "refusal", text: refusal.message };
    }
    this.paintPropertyEditor();
  }

  async propertyEditorDelete(entry) {
    if (!entry) return;
    if (this.pendingApply) {
      this.propertyEditorRefuseWhileSaving?.();
      return;
    }
    const decision = propertyEditorActionForRow(entry.row);
    if (decision.action !== "toggle" && decision.action !== "edit") {
      this.refusal = {
        code: "locked",
        message: decision.reason || "This property cannot be deleted here.",
        hint: "y opens YAML.",
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      return this.paintPropertyEditor();
    }
    const op = propertyEditorUnsetOp(entry.row);
    if (!op) return;
    this.status = propertyEditorStatusChecking();
    this.refusal = null;
    this.paintPropertyEditor();
    const session = this.editorEnsureSession();
    if (!session) return;
    this.pendingApply = true;
    let result = null;
    try {
      result = await session.applyOps([op]);
    } catch (error) {
      result = { ok: false, code: "failed", message: error?.message || "The property update failed." };
    } finally {
      this.pendingApply = false;
    }
    if (this.closed) return;
    this.announce = "";
    if (result && result.ok === true) {
      if (result.report && Array.isArray(result.report.properties)) {
        this.propertyEditorReconcile({ ...this.report, ...result.report });
      }
      this.status = propertyEditorStatusSaved();
      this.refusal = null;
    } else {
      const refusal = propertyEditorStatusRefusal(result && result.report && result.report.error
        ? result.report.error : result || {});
      this.refusal = refusal;
      this.status = { kind: "refusal", text: refusal.message };
    }
    this.paintPropertyEditor();
  }

  async propertyEditorHistory(kind) {
    if (this.pendingApply) {
      this.propertyEditorRefuseWhileSaving?.();
      return;
    }
    const session = this.editorEnsureSession();
    if (!session) return;
    this.pendingApply = true;
    this.status = propertyEditorStatusChecking();
    this.paintPropertyEditor();
    let result = null;
    try {
      result = await (kind === "redo" ? session.redo() : session.undo());
    } catch (error) {
      result = { ok: false, code: "failed", message: error?.message || "History is unavailable." };
    } finally {
      this.pendingApply = false;
    }
    if (this.closed) return;
    this.announce = "";
    if (result && result.ok === true) {
      if (result.report && Array.isArray(result.report.properties)) {
        this.propertyEditorReconcile({ ...this.report, ...result.report });
      }
      this.status = propertyEditorStatusSaved();
      this.refusal = null;
    } else {
      const refusal = propertyEditorStatusRefusal(result || {});
      this.refusal = refusal;
      this.status = { kind: "refusal", text: refusal.message || "Nothing to undo." };
    }
    this.paintPropertyEditor();
  }

  // Close ladder: open menu, then typed stage, then the reserved filter
  // layer, then the modal. Esc, q, and Ctrl+[ share it even when focus
  // strays; q types in text controls and never closes from them.
  propertyEditorBackOut(event) {
    if (this.menuOpen) {
      this.menuOpen = false;
      this.paintPropertyEditor();
      return;
    }
    if (this.stage) {
      this.stage = null;
      this.paintPropertyEditor();
      return;
    }
    if (this.filterOpen) {
      this.filterOpen = false;
      this.paintPropertyEditor();
      return;
    }
    try { this.close(); } catch (_) {}
  }

  onOpen() {
    try { this.modalEl?.classList?.add("bob-property-editor-modal"); } catch (_) {}
    try { this.modalEl?.addClass?.("bob-property-editor-modal"); } catch (_) {}
    this.paintPropertyEditor();
    try {
      if (typeof bobCardWireCloseKeys === "function") {
        bobCardWireCloseKeys(this, { backOut: (event) => this.propertyEditorBackOut(event) });
      }
    } catch (_) {}
    void this.propertyEditorInitialRead();
  }

  onClose() {
    this.closed = true;
    this.closeToken += 1;
    try {
      if (typeof this._propertyOverlayUnsub === "function") this._propertyOverlayUnsub();
    } catch (_) {}
    this._propertyOverlayUnsub = null;
    try {
      if (typeof bobCardUnwireCloseKeys === "function") bobCardUnwireCloseKeys(this);
    } catch (_) {}
    try {
      if (typeof propertyEditorUnregisterSession === "function") propertyEditorUnregisterSession(this);
    } catch (_) {}
    try { this.session?.close?.(); } catch (_) {}
    this.session = null;
    this.menuOpen = false;
    this.stage = null;
    this.filterOpen = false;
  }

  async propertyEditorInitialRead() {
    if (this.closed || this.report) return;
    const seq = this.editorReadSeq();
    this.status = propertyEditorStatusChecking();
    this.paintPropertyEditor();
    const plugin = this.propertyPlugin;
    if (!plugin || typeof plugin.apiPropertyShow !== "function") return;
    let outcome = null;
    try {
      outcome = await plugin.apiPropertyShow(this.filePath);
    } catch (error) {
      outcome = { ok: false, code: "failed", message: error?.message || "bob props show failed." };
    }
    if (!this.editorLive(seq) || this.closed) return;
    if (outcome && outcome.ok === true && outcome.report) {
      this.propertyEditorReconcile(outcome.report);
      return;
    }
    const refusal = propertyEditorStatusRefusal(outcome || {});
    this.refusal = refusal;
    if (refusal.code === "needs-bob" || refusal.code === "desktop-only") {
      this.status = { kind: "refusal", text: PROPERTY_EDITOR_OLD_BOB_HINT };
    } else {
      this.status = { kind: "refusal", text: refusal.message };
    }
    this.paintPropertyEditor();
  }
}

function propertyEditorEventInInput(event, root) {
  try {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return false;
    if (target.closest("input,select,textarea")) return true;
    const editable = target.closest("[contenteditable]");
    if (editable) {
      const value = typeof editable.getAttribute === "function"
        ? editable.getAttribute("contenteditable")
        : editable.contentEditable;
      if (String(value).toLowerCase() !== "false") return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function propertyEditorPaintAll(host, options, doc, modal) {
  const header = propertyEditorCreateEl(doc, "div", "bob-property-editor-header");
  if (header) {
    if (options.badgeKind && typeof propertyCardBuildIdentityBadge === "function") {
      try {
        const badge = propertyCardBuildIdentityBadge(doc, { kind: options.badgeKind });
        if (badge) header.appendChild(badge);
      } catch (_) {}
    } else {
      const tile = propertyEditorCreateEl(doc, "span", "bob-property-editor-tile");
      propertyEditorSetText(tile, "▤");
      if (tile) header.appendChild(tile);
    }
    const titles = propertyEditorCreateEl(doc, "div", "bob-property-editor-titles");
    if (titles) {
      const heading = propertyEditorCreateEl(doc, "h2", "bob-property-editor-heading");
      propertyEditorSetText(heading, options.header.heading);
      titles.appendChild(heading);
      const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-title");
      propertyEditorSetText(title, options.header.title);
      titles.appendChild(title);
      const sub = propertyEditorCreateEl(doc, "div", "bob-property-editor-sub");
      propertyEditorSetText(sub, options.header.sub);
      titles.appendChild(sub);
      header.appendChild(titles);
    }
    host.appendChild(header);
  }

  const degraded = options.degraded || { mode: "ready", writable: true };
  if (degraded.mode === "old-bob" || degraded.writable === false && degraded.mode === "cache") {
    const banner = propertyEditorCreateEl(doc, "div", "bob-property-editor-banner");
    propertyEditorSetText(banner, degraded.mode === "old-bob" ? degraded.hint : PROPERTY_EDITOR_CHECKING_TEXT);
    if (banner) host.appendChild(banner);
  }
  if (degraded.mode === "recovery") {
    const banner = propertyEditorCreateEl(doc, "div", "bob-property-editor-banner is-recovery");
    const message = degraded.message || PROPERTY_EDITOR_RECOVERY_TEXT;
    const line = degraded.line !== null && degraded.line !== undefined ? ` · line ${degraded.line}` : "";
    const ownership = Array.isArray(degraded.ownership) && degraded.ownership.length
      ? ` · ${degraded.ownership.join("; ")}`
      : "";
    propertyEditorSetText(banner, `${message}${line}${ownership}`);
    if (banner) host.appendChild(banner);
  }
  if (degraded.mode === "empty") {
    const empty = propertyEditorCreateEl(doc, "div", "bob-property-editor-empty");
    propertyEditorSetText(empty, PROPERTY_EDITOR_EMPTY_TEXT);
    if (empty) host.appendChild(empty);
  }

  const list = propertyEditorCreateEl(doc, "div", "bob-property-editor-list");
  if (list) {
    try { list.setAttribute("role", "listbox"); } catch (_) {}
    try { list.setAttribute("aria-label", "Properties"); } catch (_) {}
    for (const group of options.groups || []) {
      const section = propertyEditorCreateEl(doc, "div", "bob-property-editor-group");
      if (section) {
        try { section.setAttribute("data-property-group", group.group); } catch (_) {}
        const heading = propertyEditorCreateEl(doc, "div", "bob-property-editor-group-title");
        propertyEditorSetText(heading, group.title);
        section.appendChild(heading);
        for (const entry of group.rows) {
          propertyEditorPaintRow(doc, section, entry, entry.id === options.selectedId, modal);
        }
        list.appendChild(section);
      }
    }
    host.appendChild(list);
  }

  if (options.addName && typeof propertyEditorPaintNameStage === "function") {
    try { propertyEditorPaintNameStage(doc, host, options.addName, modal); } catch (_) {}
  }
  if (options.stage && typeof propertyEditorPaintStage === "function") {
    try { propertyEditorPaintStage(doc, host, options.stage, modal); } catch (_) {}
  }

  const status = propertyEditorCreateEl(doc, "div", "bob-property-editor-status");
  if (status) {
    const text = options.refusal && options.refusal.message
      ? `${options.refusal.message}${options.refusal.hint ? ` — ${options.refusal.hint}` : ""}`
      : options.status && options.status.text ? options.status.text : "";
    propertyEditorSetText(status, text);
    try {
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
    } catch (_) {}
    host.appendChild(status);
  }

  const hints = propertyEditorCreateEl(doc, "div", "bob-property-editor-hints");
  propertyEditorSetText(hints, "j/k move · o/O add · Mod+; end · Enter/l open · Ctrl+D delete · u undo · y YAML · Esc close");
  if (hints) host.appendChild(hints);

  if (options.announce) {
    const live = propertyEditorCreateEl(doc, "div", "bob-property-editor-announce");
    propertyEditorSetText(live, options.announce);
    try {
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
    } catch (_) {}
    if (live) host.appendChild(live);
  }
}

function propertyEditorPaintRow(doc, host, entry, selected, modal) {
  const row = entry.row;
  const decision = propertyEditorActionForRow(row);
  const className = [
    "bob-property-row",
    selected ? "is-selected" : "",
    decision.action === "locked" ? "is-locked" : "",
  ].filter(Boolean).join(" ");
  const button = propertyEditorCreateEl(doc, "button", className);
  if (!button) return;
  try {
    button.setAttribute("type", "button");
    button.setAttribute("data-property-key", row.key);
    button.setAttribute("data-property-row", entry.id);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) button.setAttribute("aria-current", "true");
    button.setAttribute("data-property-action", decision.action);
    if (decision.action === "locked") button.setAttribute("aria-disabled", "true");
    if (row && typeof row.diagnostic === "string" && row.diagnostic) {
      try { button.setAttribute("title", row.diagnostic); } catch (_) {}
    }
  } catch (_) {}
  // Chromium sizes a <button> from its first line box, so a two-row grid on
  // the button itself overflows onto the next row. Keep the grid on an inner
  // span (phrasing content stays valid) and size the button as a column flex
  // container so the stacked value row is included in the button height.
  const grid = propertyEditorCreateEl(doc, "span", "bob-property-row-grid");
  const icon = propertyEditorCreateEl(doc, "span", "bob-property-row-icon");
  propertyEditorSetText(icon, propertyEditorKindIcon(row.kind));
  if (icon) {
    try { icon.setAttribute("aria-hidden", "true"); } catch (_) {}
    (grid || button).appendChild(icon);
  }
  const key = propertyEditorCreateEl(doc, "span", "bob-property-row-key");
  propertyEditorSetText(key, row.key);
  if (key) (grid || button).appendChild(key);
  const value = propertyEditorCreateEl(doc, "span", "bob-property-row-value");
  propertyEditorSetText(value, propertyEditorRowText(row));
  if (value) (grid || button).appendChild(value);
  if (grid) button.appendChild(grid);
  host.appendChild(button);
  void modal;
}

function propertyEditorKindIcon(kind) {
  switch (String(kind || "")) {
    case "checkbox": return "☑";
    case "number": return "#";
    case "date":
    case "datetime": return "📅";
    case "list":
    case "tags":
    case "aliases": return "☰";
    case "map": return "{}";
    case "null":
    case "opaque": return "◌";
    default: return "≡";
  }
}

// Mount internally for tests: no global command, palette, or drawer hook
// registration. Public entry points belong to entrypoints-yaml.
function openPropertyEditor(app, options = {}) {
  const modal = new PropertyEditorModal(app, options);
  try { modal.open(); } catch (_) {}
  return modal;
}
