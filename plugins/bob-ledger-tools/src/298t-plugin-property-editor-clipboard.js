// Source-exact property copy and previewed YAML paste. Clipboard operations
// never mutate a note; paste drafts use the shared guarded update session.
const PROPERTY_EDITOR_CLIPBOARD_SKIP_CODES = new Set([
  "prop_owned", "prop_derived", "prop_identity", "prop_opaque", "prop_ownership_unresolved",
]);

function propertyEditorClipboardFailure(code, message, hint = "y opens YAML.") {
  return { ok: false, code, message, hint };
}

function propertyEditorClipboardReportProblem(report) {
  if (!report || report.ok !== true || !Array.isArray(report.properties)) {
    return propertyEditorClipboardFailure("report-unavailable", "No current property report — retry the paste.");
  }
  const state = report.frontmatter && report.frontmatter.state;
  if (state !== "ok" && state !== "absent") {
    return propertyEditorClipboardFailure("recovery", "Frontmatter needs repair before properties can be pasted — y opens YAML.");
  }
  if (!propertyShowAllowsWrite(report)) {
    return propertyEditorClipboardFailure("unwritable", "Bob cannot safely preview property changes for this note — y opens YAML.");
  }
  return null;
}

function propertyEditorClipboardPlan(entries, properties) {
  const incoming = Array.isArray(entries) ? entries : [];
  const rows = Array.isArray(properties) ? properties : [];
  const byKey = new Map();
  for (const row of rows) {
    if (!row || typeof row.key !== "string") continue;
    const list = byKey.get(row.key) || [];
    list.push(row);
    byKey.set(row.key, list);
  }
  const duplicate = incoming.find((entry) => (byKey.get(entry.key) || []).length > 1);
  if (duplicate) {
    return propertyEditorClipboardFailure(
      "ambiguous-existing",
      `“${duplicate.key}” appears more than once in this note; repair the duplicate before pasting.`,
    );
  }
  const items = incoming.map((entry) => {
    const current = byKey.get(entry.key)?.[0] || null;
    if (!current) return { ...entry, status: "checking", current: null, reason: "" };
    const role = propertyEditorRoleOf(current);
    if (role !== "loose") {
      return {
        ...entry, status: "skipped", current,
        reason: current.reason || (role === "card" ? "Owned by the note's card." : role === "identity" ? "Identity property." : role === "derived" ? "Bob-managed property." : "Ownership is unresolved."),
      };
    }
    if (current.opaque === true || current.kind === "opaque") {
      return { ...entry, status: "skipped", current, reason: current.diagnostic || "Opaque values stay unchanged." };
    }
    return { ...entry, status: "replace", current, reason: "" };
  });
  return { ok: true, items };
}

function propertyEditorClipboardOps(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && (item.status === "new" || item.status === "replace"))
    .map((item) => propertyEditorYamlOp(item.key, item.valueYaml));
}

function propertyEditorClipboardOpsJson(ops) {
  try { return JSON.stringify(Array.isArray(ops) ? ops : []); } catch (_) { return "[]"; }
}

function propertyEditorClipboardSelection(sourceEntries, reportRows, markedIds, selectedId) {
  const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
  const rows = Array.isArray(reportRows) ? reportRows : [];
  const marked = markedIds instanceof Set ? markedIds : new Set();
  const useMarks = marked.size > 0;
  const selected = [];
  const occurrences = new Map();
  const ids = new Map();
  rows.forEach((row, index) => {
    if (!row || typeof row.key !== "string") return;
    const id = propertyEditorRowId(row, index);
    ids.set(id, (ids.get(id) || 0) + 1);
  });
  rows.forEach((row, index) => {
    if (!row || typeof row.key !== "string") return;
    const occurrence = (occurrences.get(row.key) || 0) + 1;
    occurrences.set(row.key, occurrence);
    const id = propertyEditorRowId(row, index);
    if (useMarks ? !marked.has(id) : id !== selectedId) return;
    if (ids.get(id) > 1) {
      selected.push({ ok: false, key: row.key });
      return;
    }
    const matches = entries.filter((entry) => entry.key === row.key && entry.occurrence === occurrence);
    if (matches.length !== 1) {
      selected.push({ ok: false, key: row.key });
      return;
    }
    selected.push({ ok: true, entry: matches[0], index });
  });
  if (!selected.length) return propertyEditorClipboardFailure("empty-selection", "Select a property to copy.");
  if (selected.some((item) => item.ok !== true)) {
    return propertyEditorClipboardFailure("ambiguous-selection", "The selected property cannot be matched to source bytes — y opens YAML.");
  }
  return { ok: true, entries: selected.sort((a, b) => a.index - b.index).map((item) => item.entry) };
}

async function propertyEditorClipboardProbeNewKey(options = {}) {
  const plugin = options.plugin;
  if (!plugin || typeof plugin.apiPropertyUpdatePreview !== "function") {
    return propertyEditorClipboardFailure("preview-unavailable", "Bob could not check the new property — retry the paste.");
  }
  const envelope = propertyUpdateEnvelopeText(options.fingerprint, [propertyEditorYamlOp(options.key, options.valueYaml)]);
  let outcome = null;
  try { outcome = await plugin.apiPropertyUpdatePreview(options.path, envelope); }
  catch (error) {
    return propertyEditorClipboardFailure("transport", error?.message || "Bob could not check the new property — retry the paste.");
  }
  if (!outcome || outcome.ok !== true || !outcome.report) {
    return propertyEditorClipboardFailure(outcome?.code || "transport", outcome?.message || "Bob could not check the new property — retry the paste.");
  }
  const report = outcome.report;
  if (report.ok === false) {
    const failure = report.error || {};
    const code = typeof failure.code === "string" ? failure.code : "preview-refused";
    if (PROPERTY_EDITOR_CLIPBOARD_SKIP_CODES.has(code)) {
      return { ok: true, status: "skipped", reason: failure.message || "Bob owns this property." };
    }
    return propertyEditorClipboardFailure(code, failure.message || "Bob refused the new property preview.", failure.hint || "y opens YAML.");
  }
  if (report.ok === true && report.dry_run === true) return { ok: true, status: "new", reason: "" };
  return propertyEditorClipboardFailure("preview-shape", "Bob returned no valid property preview — retry the paste.");
}

const propertyEditorClipboardBaseKeyAction = propertyEditorKeyAction;
function propertyEditorClipboardKeyAction(event, context = {}) {
  try {
    if (event?.target?.closest?.("[data-property-clipboard-action]")) return null;
  } catch (_) {}
  const base = propertyEditorClipboardBaseKeyAction(event, context);
  if (base) return base;
  if (!event || event.isComposing || event.keyCode === 229
    || context.inInput === true || propertyEditorKeyIsTypingTarget(event)) return null;
  const cmd = event.ctrlKey === true || event.metaKey === true;
  if (!cmd || event.altKey === true || event.shiftKey === true) return null;
  if (String(event.key || "").toLowerCase() === "c") return "copy";
  if (String(event.key || "").toLowerCase() === "v") return "paste";
  return null;
}
propertyEditorKeyAction = propertyEditorClipboardKeyAction;

function propertyEditorClipboardMenuButton(doc, menu, modal, label, action) {
  const button = propertyEditorCreateEl(doc, "button", "bob-property-editor-menu-item");
  if (!button) return;
  propertyEditorSetText(button, label);
  button.setAttribute("type", "button");
  button.setAttribute("role", "menuitem");
  button.setAttribute("data-property-command", action);
  button.addEventListener("click", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    modal.menuOpen = false;
    void modal.propertyEditorPerform(action, event);
  });
  menu.appendChild(button);
}

function propertyEditorClipboardValue(doc, row, label, value) {
  const line = propertyEditorCreateEl(doc, "div", "bob-property-editor-clipboard-value");
  const title = propertyEditorCreateEl(doc, "span", "bob-property-editor-clipboard-value-label");
  propertyEditorSetText(title, `${label}:`);
  line.appendChild(title);
  const text = propertyEditorCreateEl(doc, "code", "bob-property-editor-clipboard-value-text");
  let rendered;
  if (typeof value === "string") rendered = label === "Proposed" ? value.trim() : JSON.stringify(value);
  else {
    try { rendered = JSON.stringify(value); } catch (_) { rendered = String(value); }
  }
  propertyEditorSetText(text, rendered === undefined ? "undefined" : rendered);
  line.appendChild(text);
  row.appendChild(line);
}

function propertyEditorClipboardPaint(host, doc, modal) {
  const stage = modal && modal.propertyEditorClipboardStage;
  if (!stage || !host || !doc) return;
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage is-clipboard");
  if (!panel) return;
  panel.setAttribute("data-property-clipboard-stage", "true");
  panel.setAttribute("aria-label", "Paste YAML properties");
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, stage.phase === "loading" ? "Reading clipboard…" : `Paste YAML · ${stage.items?.length || 0} ${stage.items?.length === 1 ? "property" : "properties"}`);
  panel.appendChild(title);
  const list = propertyEditorCreateEl(doc, "div", "bob-property-editor-clipboard-list");
  list.setAttribute("role", "list");
  for (const item of stage.items || []) {
    const row = propertyEditorCreateEl(doc, "div", `bob-property-editor-clipboard-row is-${item.status || "checking"}`);
    row.setAttribute("role", "listitem");
    const head = propertyEditorCreateEl(doc, "div", "bob-property-editor-clipboard-head");
    const state = propertyEditorCreateEl(doc, "span", "bob-property-editor-clipboard-state");
    const label = item.status === "replace" ? "Replace" : item.status === "new" ? "New" : item.status === "skipped" ? "Skipped" : item.status === "blocked" ? "Blocked" : "Checking";
    propertyEditorSetText(state, label);
    head.appendChild(state);
    const key = propertyEditorCreateEl(doc, "strong", "bob-property-editor-clipboard-key");
    propertyEditorSetText(key, item.key);
    head.appendChild(key);
    row.appendChild(head);
    if (item.status === "replace") {
      propertyEditorClipboardValue(doc, row, "Old", item.current && item.current.value);
      propertyEditorClipboardValue(doc, row, "Proposed", item.valueYaml);
    } else if (item.status === "new" || item.status === "checking") {
      propertyEditorClipboardValue(doc, row, "Proposed", item.valueYaml);
    }
    if (item.reason) {
      const reason = propertyEditorCreateEl(doc, "div", "bob-property-editor-clipboard-reason");
      propertyEditorSetText(reason, item.reason);
      row.appendChild(reason);
    }
    list.appendChild(row);
  }
  panel.appendChild(list);
  if (stage.message) {
    const note = propertyEditorCreateEl(doc, "div", `bob-property-editor-stage-preview${stage.blocked ? " is-diagnostic" : ""}`);
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    propertyEditorSetText(note, stage.message);
    panel.appendChild(note);
  }
  const actions = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Paste properties actions");
  const apply = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-save");
  apply.setAttribute("type", "button");
  apply.setAttribute("data-property-clipboard-action", "apply");
  apply.disabled = stage.blocked === true || stage.applyUnknown === true || stage.refreshing === true
    || stage.ops?.length === 0 || !(stage.previewReady === true || stage.previewing === true);
  propertyEditorSetText(apply, stage.previewReady ? "Apply paste" : "Preview paste");
  apply.addEventListener("click", (event) => {
    event.preventDefault?.();
    void modal.propertyEditorClipboardSave();
  });
  actions.appendChild(apply);
  const cancel = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-cancel");
  cancel.setAttribute("type", "button");
  cancel.setAttribute("data-property-clipboard-action", "cancel");
  propertyEditorSetText(cancel, "Cancel");
  cancel.addEventListener("click", (event) => {
    event.preventDefault?.();
    modal.propertyEditorClipboardCancel();
  });
  actions.appendChild(cancel);
  panel.appendChild(actions);
  const status = host.querySelector?.(".bob-property-editor-status");
  if (status && typeof host.insertBefore === "function") host.insertBefore(panel, status);
  else host.appendChild(panel);
}

const propertyEditorClipboardPaintAllBase = propertyEditorPaintAll;
propertyEditorPaintAll = function propertyEditorPaintAllWithClipboard(host, options, doc, modal) {
  propertyEditorClipboardPaintAllBase(host, options, doc, modal);
  const menu = host?.querySelector?.("[role='menu']");
  if (menu && options?.menuOpen) {
    propertyEditorClipboardMenuButton(doc, menu, modal, "Copy properties · Mod+C", "copy");
    propertyEditorClipboardMenuButton(doc, menu, modal, "Paste properties · Mod+V", "paste");
  }
  propertyEditorClipboardPaint(host, doc, modal);
  const hints = host?.querySelector?.(".bob-property-editor-hints");
  propertyEditorSetText(hints,
    "j/k move · r rename · Alt+J/K reorder · Space mark · V range · / filter · Mod+C copy · Mod+V paste · Ctrl+D delete · o/O add · Enter/l open · Enter opens maps as YAML · u undo · y YAML · Esc back");
};

const propertyEditorClipboardPerformBase = PropertyEditorModal.prototype.propertyEditorPerform;
const propertyEditorClipboardBackOutBase = PropertyEditorModal.prototype.propertyEditorBackOut;
const propertyEditorClipboardCloseBase = PropertyEditorModal.prototype.onClose;
const propertyEditorClipboardPreviewBase = PropertyEditorModal.prototype.propertyEditorStageSyncPreview;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorClipboardApi() {
    const candidates = [
      this.propertyEditorClipboard,
      this.app?.clipboard,
      this.editorDoc()?.defaultView?.navigator?.clipboard,
      typeof navigator !== "undefined" ? navigator.clipboard : null,
    ];
    return candidates.find((api) => api && (typeof api.readText === "function" || typeof api.writeText === "function")) || null;
  },

  async propertyEditorClipboardSnapshot(token) {
    const plugin = this.propertyPlugin;
    const app = plugin?.app || this.app;
    const path = this.filePath;
    if (typeof propertyEditorReadSourceSnapshot !== "function" || typeof propertyEditorEntryReadSource !== "function") {
      return propertyEditorClipboardFailure("source-unavailable", "Property source is unavailable — y opens YAML.");
    }
    let report = null;
    let reportOutcome = null;
    const readReport = async (notePath) => {
      try {
        reportOutcome = await plugin?.apiPropertyShow?.(notePath);
        if (reportOutcome?.ok === true && reportOutcome.report?.ok === true) {
          report = reportOutcome.report;
          return report;
        }
      } catch (_) {}
      return null;
    };
    let disk = null;
    try { disk = await propertyEditorEntryReadSource(plugin, path); } catch (_) {}
    if (this.closed || token !== this.propertyEditorClipboardToken) return propertyEditorClipboardFailure("cancelled", "Copy cancelled.");
    let editors = [];
    try { editors = propertyEditorYamlEditorTexts(app, path); } catch (_) {}
    const differing = typeof disk === "string" ? editors.filter((text) => text !== disk) : editors;
    const snapshot = await propertyEditorReadSourceSnapshot({
      path,
      readReport,
      readSource: (notePath) => propertyEditorEntryReadSource(plugin, notePath),
      hasUnsaved: differing.length > 0,
      getEditorContent: differing.length ? async () => differing[0] : undefined,
      parseYaml: typeof parseYaml === "function" ? parseYaml : null,
      isCancelled: () => this.closed === true || token !== this.propertyEditorClipboardToken,
    });
    if (this.closed || token !== this.propertyEditorClipboardToken) return propertyEditorClipboardFailure("cancelled", "Copy cancelled.");
    if (!snapshot || snapshot.ok !== true) {
      const message = reportOutcome?.message || snapshot?.message || "Property source is unavailable — y opens YAML.";
      return propertyEditorClipboardFailure(snapshot?.code || reportOutcome?.code || "source-unavailable", message, snapshot?.hint || "y opens YAML.");
    }
    const problem = propertyEditorClipboardReportProblem(report);
    if (problem) return problem;
    return { ...snapshot, report };
  },

  async propertyEditorClipboardCopy() {
    if (this.closed || this.pendingApply || this.stage || this.addName || this.propertyEditorClipboardBusy) return false;
    const clipboard = this.propertyEditorClipboardApi();
    if (!clipboard || typeof clipboard.writeText !== "function") return this.propertyEditorClipboardNotice("clipboard-unavailable", "Clipboard write access is unavailable — y opens YAML.");
    const token = (this.propertyEditorClipboardToken || 0) + 1;
    this.propertyEditorClipboardToken = token;
    this.propertyEditorClipboardBusy = true;
    this.status = propertyEditorStatusChecking();
    this.refusal = null;
    this.paintPropertyEditor();
    try {
      const snapshot = await this.propertyEditorClipboardSnapshot(token);
      if (this.closed || token !== this.propertyEditorClipboardToken) return false;
      if (!snapshot.ok) return this.propertyEditorClipboardNotice(snapshot.code, snapshot.message, snapshot.hint);
      this.propertyEditorReconcile(snapshot.report);
      // A caller may name exact source rows (declared settings copy keys
      // that are not visible rows); resolve them against the fresh report.
      const explicit = typeof this.propertyEditorClipboardCopyIds === "function"
        ? this.propertyEditorClipboardCopyIds(snapshot.report)
        : null;
      if (explicit && explicit.ok === false) return this.propertyEditorClipboardNotice(explicit.code || "ineligible-selection", explicit.message, explicit.hint);
      const marked = explicit && explicit.ids instanceof Set
        ? explicit.ids
        : typeof propertyEditorSelectionFilterMarkedIds === "function"
          ? propertyEditorSelectionFilterMarkedIds(this)
          : new Set();
      if (explicit && marked.size === 0) return this.propertyEditorClipboardNotice("empty-selection", "Select a declared property to copy.");
      const selection = propertyEditorClipboardSelection(snapshot.entries, snapshot.report.properties, marked, this.selectedId);
      if (!selection.ok) return this.propertyEditorClipboardNotice(selection.code, selection.message, selection.hint);
      const assembled = propertyEditorSourceAssembleEntries(selection.entries, snapshot.source, snapshot.lineEnding);
      if (!assembled.ok) return this.propertyEditorClipboardNotice(assembled.code, assembled.message, assembled.hint);
      try { await clipboard.writeText(assembled.yaml); }
      catch (error) { return this.propertyEditorClipboardNotice("clipboard-denied", error?.message || "Clipboard permission was denied — nothing was copied."); }
      this.refusal = null;
      this.announce = `Copied ${selection.entries.length} ${selection.entries.length === 1 ? "property" : "properties"}.`;
      this.status = { kind: "ready", text: this.announce };
      this.paintPropertyEditor();
      return true;
    } finally {
      if (this.propertyEditorClipboardToken === token) this.propertyEditorClipboardBusy = false;
    }
  },

  async propertyEditorClipboardStartPaste() {
    if (this.closed || this.pendingApply || this.stage || this.addName || this.propertyEditorClipboardBusy) return false;
    const clipboard = this.propertyEditorClipboardApi();
    if (!clipboard || typeof clipboard.readText !== "function") return this.propertyEditorClipboardNotice("clipboard-unavailable", "Clipboard read access is unavailable — y opens YAML.");
    const token = (this.propertyEditorClipboardToken || 0) + 1;
    this.propertyEditorClipboardToken = token;
    this.propertyEditorClipboardBusy = true;
    this.menuOpen = false;
    this.refusal = null;
    this.announce = "";
    const stage = this.propertyEditorClipboardStage = {
      token, phase: "loading", items: [], ops: [], opsJson: "[]", previewReady: false,
      previewing: false, blocked: false, applyUnknown: false, refreshing: false,
      pendingEnter: null, requiresPreview: false, message: "Reading the clipboard…",
    };
    this.paintPropertyEditor();
    try {
      let clipboardText;
      try { clipboardText = await clipboard.readText(); }
      catch (error) {
        this.propertyEditorClipboardBlock(stage, "clipboard-denied", error?.message || "Clipboard permission was denied.");
        return false;
      }
      if (!this.propertyEditorClipboardLive(stage)) return false;
      const decoded = propertyEditorClipboardDecode(clipboardText, typeof parseYaml === "function" ? parseYaml : null);
      if (!decoded || decoded.ok !== true) {
        this.propertyEditorClipboardBlock(stage, decoded?.code || "invalid-yaml", decoded?.message || "Clipboard YAML could not be read.");
        return false;
      }
      stage.clipboardEntries = decoded.entries.slice();
      stage.items = decoded.entries.map((entry) => ({ ...entry, status: "checking", current: null, reason: "" }));
      stage.message = "Checking the note and proposed keys…";
      this.paintPropertyEditor();
      if (!stage.clipboardEntries.length) {
        this.propertyEditorClipboardBlock(stage, "empty-clipboard", "Clipboard has no properties to paste.");
        return false;
      }
      const plugin = this.propertyPlugin;
      let outcome = null;
      try { outcome = await plugin?.apiPropertyShow?.(this.filePath); }
      catch (error) { outcome = { ok: false, code: "transport", message: error?.message || "Bob could not read the note." }; }
      if (!this.propertyEditorClipboardLive(stage)) return false;
      if (!outcome || outcome.ok !== true || !outcome.report) {
        this.propertyEditorClipboardBlock(stage, outcome?.code || "report-unavailable", outcome?.message || "No current property report — retry the paste.");
        return false;
      }
      const problem = propertyEditorClipboardReportProblem(outcome.report);
      if (problem) {
        this.propertyEditorClipboardBlock(stage, problem.code, problem.message);
        return false;
      }
      this.propertyEditorReconcile(outcome.report);
      const planned = propertyEditorClipboardPlan(stage.clipboardEntries, outcome.report.properties);
      if (!planned.ok) {
        this.propertyEditorClipboardBlock(stage, planned.code, planned.message);
        return false;
      }
      stage.items = planned.items;
      for (const item of stage.items) {
        if (item.status !== "checking") continue;
        const checked = await propertyEditorClipboardProbeNewKey({
          plugin, path: this.filePath, fingerprint: outcome.report.fingerprint,
          key: item.key, valueYaml: item.valueYaml,
        });
        if (!this.propertyEditorClipboardLive(stage)) return false;
        if (checked.ok !== true) {
          item.status = "blocked";
          item.reason = checked.message;
          if (checked.code === "prop_stale" || checked.code === "stale_generation") {
            stage.refreshing = true;
            stage.message = "The note changed during ownership checks; clipboard draft kept while the listing refreshes…";
            this.paintPropertyEditor();
            await this.propertyEditorClipboardRefresh(stage, false);
            if (this.propertyEditorClipboardLive(stage)) {
              stage.blocked = true;
              stage.message = "The note changed during key checks. Clipboard draft is kept; cancel and paste again to review the current property set.";
              this.refusal = { code: checked.code, message: stage.message, hint: "Nothing was written." };
              this.status = { kind: "refusal", text: stage.message };
              this.paintPropertyEditor();
            }
            return false;
          }
          this.propertyEditorClipboardBlock(stage, checked.code, checked.message);
          return false;
        }
        item.status = checked.status;
        item.reason = checked.reason || "";
      }
      stage.ops = propertyEditorClipboardOps(stage.items);
      stage.opsJson = propertyEditorClipboardOpsJson(stage.ops);
      stage.phase = "preview";
      stage.blocked = false;
      if (!stage.ops.length) {
        stage.message = "Every incoming property is skipped; nothing can be applied.";
        stage.previewReady = false;
        stage.previewing = false;
        this.status = { kind: "ready", text: stage.message };
        this.paintPropertyEditor();
        return true;
      }
      const session = this.editorEnsureSession();
      if (!session) {
        this.propertyEditorClipboardBlock(stage, "preview-unavailable", "Property preview is unavailable.");
        return false;
      }
      stage.previewing = true;
      stage.previewReady = false;
      stage.message = `Previewing ${stage.ops.length} editable ${stage.ops.length === 1 ? "property" : "properties"}…`;
      this.status = propertyEditorStatusChecking();
      session.setDraft(stage.ops);
      this.propertyEditorClipboardSyncPreview();
      return true;
    } finally {
      if (this.propertyEditorClipboardToken === token) this.propertyEditorClipboardBusy = false;
    }
  },

  propertyEditorClipboardLive(stage) {
    return !this.closed && stage && this.propertyEditorClipboardStage === stage
      && stage.token === this.propertyEditorClipboardToken;
  },

  propertyEditorClipboardBlock(stage, code, message) {
    if (!stage || !this.propertyEditorClipboardLive(stage)) return;
    stage.phase = "blocked";
    stage.blocked = true;
    stage.previewReady = false;
    stage.previewing = false;
    stage.pendingEnter = null;
    stage.message = message || "Paste is blocked — nothing was written.";
    this.refusal = { code: code || "blocked", message: stage.message, hint: "Cancel and correct the clipboard or note, then try again." };
    this.status = { kind: "refusal", text: stage.message };
    this.paintPropertyEditor();
  },

  propertyEditorClipboardCancel() {
    const stage = this.propertyEditorClipboardStage;
    if (!stage) return false;
    if (this.pendingApply === true) {
      this.propertyEditorRefuseWhileSaving?.();
      return false;
    }
    this.propertyEditorClipboardToken = (this.propertyEditorClipboardToken || 0) + 1;
    this.propertyEditorClipboardStage = null;
    try { this.session?.setDraft?.([]); } catch (_) {}
    this.refusal = null;
    this.status = { kind: "ready", text: "Paste canceled." };
    this.paintPropertyEditor();
    return true;
  },

  async propertyEditorClipboardSave() {
    const stage = this.propertyEditorClipboardStage;
    if (!stage || !this.propertyEditorClipboardLive(stage) || stage.blocked || stage.applyUnknown || stage.refreshing || this.pendingApply) return false;
    if (!stage.ops.length) {
      stage.message = "There are no writable properties to apply.";
      return this.paintPropertyEditor();
    }
    const session = this.editorEnsureSession();
    const state = session?.getState?.();
    const matches = state?.status === "preview-ready" && state.canApply === true
      && propertyEditorClipboardOpsJson(state.draftOps) === stage.opsJson;
    if (matches && stage.previewReady && !stage.requiresPreview) return this.propertyEditorClipboardApply(stage);
    stage.pendingEnter = { token: stage.token, opsJson: stage.opsJson };
    stage.requiresPreview = false;
    stage.previewReady = false;
    stage.previewing = true;
    stage.message = "Previewing the exact displayed property set…";
    this.status = propertyEditorStatusChecking();
    try { session?.setDraft?.(stage.ops); } catch (_) {}
    this.propertyEditorClipboardSyncPreview();
    return true;
  },

  propertyEditorClipboardSyncPreview() {
    const stage = this.propertyEditorClipboardStage;
    if (!stage || stage.blocked || stage.applyUnknown || stage.refreshing || !stage.ops.length) return;
    const state = this.session?.getState?.();
    if (!state) return;
    if (state.status === "preview-ready" && state.canApply === true) {
      if (propertyEditorClipboardOpsJson(state.draftOps) !== stage.opsJson) {
        stage.pendingEnter = null;
        stage.previewReady = false;
        stage.requiresPreview = true;
        stage.message = "The paste set changed; preview it again before applying.";
        this.paintPropertyEditor();
        return;
      }
      stage.previewReady = true;
      stage.previewing = false;
      stage.message = `Preview ready · Enter applies ${stage.ops.length} ${stage.ops.length === 1 ? "property" : "properties"} as one undoable update.`;
      this.status = { kind: "ready", text: "Preview ready." };
      const pending = stage.pendingEnter;
      if (pending && pending.token === stage.token && pending.opsJson === stage.opsJson && !stage.requiresPreview) {
        stage.pendingEnter = null;
        void this.propertyEditorClipboardApply(stage);
        return;
      }
      this.paintPropertyEditor();
      return;
    }
    if (state.status === "preview-pending" || state.status === "draft" || state.status === "applying") {
      stage.previewReady = false;
      stage.previewing = true;
      stage.message = state.status === "applying" ? "Saving the approved property set…" : "Previewing the exact displayed property set…";
      this.status = propertyEditorStatusChecking();
      this.paintPropertyEditor();
      return;
    }
    if (state.status === "refused" && state.refusal) {
      const failure = state.refusal;
      const code = failure.code || "preview-refused";
      stage.previewReady = false;
      stage.previewing = false;
      stage.pendingEnter = null;
      if (code === "prop_stale" || code === "stale_generation" || failure.kind === "stale") {
        stage.requiresPreview = true;
        stage.refreshing = true;
        stage.message = "The note changed. Clipboard draft kept; refreshing before another preview…";
        this.status = { kind: "refusal", text: stage.message };
        this.paintPropertyEditor();
        void this.propertyEditorClipboardRefresh(stage, false);
        return;
      }
      if (PROPERTY_EDITOR_CLIPBOARD_SKIP_CODES.has(code)) {
        stage.refreshing = true;
        stage.message = "A property's ownership changed. Clipboard draft kept; refreshing the listing…";
        this.status = { kind: "refusal", text: stage.message };
        this.paintPropertyEditor();
        void this.propertyEditorClipboardRefresh(stage, true);
        return;
      }
      stage.blocked = true;
      stage.message = failure.message || "Bob refused the property preview; nothing was written.";
      this.refusal = { code, message: stage.message, hint: failure.hint || "Cancel and review the note before retrying." };
      this.status = { kind: "refusal", text: stage.message };
      this.paintPropertyEditor();
    }
  },

  async propertyEditorClipboardRefresh(stage, ownershipChanged) {
    let outcome = null;
    try { outcome = await this.propertyPlugin?.apiPropertyShow?.(this.filePath); } catch (_) {}
    if (!this.propertyEditorClipboardLive(stage)) return;
    stage.refreshing = false;
    if (outcome?.ok === true && outcome.report?.ok === true) {
      const problem = propertyEditorClipboardReportProblem(outcome.report);
      if (!problem) this.propertyEditorReconcile(outcome.report);
      else {
        stage.blocked = true;
        stage.message = problem.message;
      }
    } else {
      stage.blocked = true;
      stage.message = outcome?.message || "The current listing could not be refreshed; clipboard draft kept.";
    }
    if (ownershipChanged) {
      stage.blocked = true;
      stage.requiresPreview = true;
      stage.message = "A property's ownership changed. Clipboard draft is kept; cancel and paste again to review the current editable set.";
    } else if (!stage.blocked) {
      stage.requiresPreview = true;
      stage.message = "The note changed. Clipboard draft is kept; press Enter to preview this same set again.";
    }
    this.refusal = { code: ownershipChanged ? "ownership-changed" : "prop_stale", message: stage.message, hint: "Nothing was written." };
    this.status = { kind: "refusal", text: stage.message };
    this.paintPropertyEditor();
  },

  async propertyEditorClipboardApply(stage) {
    if (!this.propertyEditorClipboardLive(stage) || this.pendingApply || stage.blocked || stage.applyUnknown) return false;
    const state = this.session?.getState?.();
    if (!stage.previewReady || state?.status !== "preview-ready" || state.canApply !== true
      || propertyEditorClipboardOpsJson(state.draftOps) !== stage.opsJson) {
      stage.previewReady = false;
      stage.requiresPreview = true;
      stage.message = "Preview this exact property set again before applying.";
      this.paintPropertyEditor();
      return false;
    }
    this.pendingApply = true;
    stage.previewReady = false;
    stage.message = "Saving the approved property set…";
    this.status = propertyEditorStatusChecking();
    this.paintPropertyEditor();
    let result = null;
    try { result = await this.session.apply(); }
    catch (error) { result = { ok: false, kind: "transport", code: "failed", message: error?.message || "The property update failed." }; }
    finally { this.pendingApply = false; }
    if (!this.propertyEditorClipboardLive(stage)) return false;
    if (result?.ok === true) {
      if (result.report?.properties) {
        const next = { ...this.report, ...result.report };
        if (result.report.fingerprint_after) next.fingerprint = result.report.fingerprint_after;
        this.propertyEditorReconcile(next);
      }
      this.propertyEditorClipboardStage = null;
      this.refusal = null;
      this.status = propertyEditorStatusSaved();
      this.announce = "Pasted properties · u undo";
      this.paintPropertyEditor();
      return true;
    }
    const failure = result?.report?.error || result || {};
    const code = failure.code || result?.code || "failed";
    const stale = code === "prop_stale" || code === "stale_generation" || result?.kind === "stale";
    stage.pendingEnter = null;
    stage.previewReady = false;
    if (stale) {
      stage.requiresPreview = true;
      stage.refreshing = true;
      stage.message = "The note changed during apply. Clipboard draft kept; refreshing before another preview…";
      this.status = { kind: "refusal", text: stage.message };
      void this.propertyEditorClipboardRefresh(stage, false);
      this.paintPropertyEditor();
      return false;
    }
    stage.blocked = true;
    stage.applyUnknown = result?.kind === "transport" || result?.kind === "timeout-unknown"
      || code === "timeout" || code === "unknown-outcome";
    stage.message = stage.applyUnknown
      ? "The write outcome is unknown. Refresh the note and reconcile before retrying; this paste will not be repeated."
      : failure.message || "Bob refused the paste; nothing was written.";
    this.refusal = { code, message: stage.message, hint: failure.hint || "Cancel and refresh the note before retrying." };
    this.status = { kind: "refusal", text: stage.message };
    this.paintPropertyEditor();
    return false;
  },

  propertyEditorClipboardNotice(code, message, hint = "y opens YAML.") {
    this.refusal = { code: code || "clipboard", message: message || "Clipboard action failed.", hint };
    this.status = { kind: "refusal", text: this.refusal.message };
    this.announce = this.refusal.message;
    this.paintPropertyEditor();
    return false;
  },
});

PropertyEditorModal.prototype.propertyEditorPerform = async function propertyEditorPerformClipboard(action, event) {
  if (this.propertyEditorClipboardStage) {
    if (action === "open") return this.propertyEditorClipboardSave();
    if (action === "cancel-paste") return this.propertyEditorClipboardCancel();
    return undefined;
  }
  if (action === "copy") return this.propertyEditorClipboardCopy();
  if (action === "paste") return this.propertyEditorClipboardStartPaste();
  return propertyEditorClipboardPerformBase.call(this, action, event);
};

PropertyEditorModal.prototype.propertyEditorBackOut = function propertyEditorBackOutClipboard(event) {
  if (this.menuOpen) return propertyEditorClipboardBackOutBase.call(this, event);
  if (this.propertyEditorClipboardStage) return this.propertyEditorClipboardCancel();
  return propertyEditorClipboardBackOutBase.call(this, event);
};

PropertyEditorModal.prototype.propertyEditorStageSyncPreview = function propertyEditorStageSyncPreviewClipboard() {
  if (this.propertyEditorClipboardStage) return this.propertyEditorClipboardSyncPreview();
  return propertyEditorClipboardPreviewBase?.call(this);
};

PropertyEditorModal.prototype.onClose = function onCloseClipboard() {
  this.propertyEditorClipboardToken = (this.propertyEditorClipboardToken || 0) + 1;
  this.propertyEditorClipboardStage = null;
  this.propertyEditorClipboardBusy = false;
  return propertyEditorClipboardCloseBase.call(this);
};
