// Validated multiline YAML value stage for the native property editor
// parity phase (yaml-stage). Loose map values open it on Enter; any other
// loose value can open it through the "Edit value as YAML" menu route.
// The draft is seeded from the read-only source-fragment adapter and every
// write is exactly one `prop.set_yaml` op through the existing debounced
// Bob dry-run and preview latch. Local validation stays minimal on
// purpose: malformed drafts, sibling/document injection, and opaque content
// are Bob's dry-run verdicts, shown verbatim with the draft retained.
// `y` / Ctrl+E still mean the Source-mode excursion; this stage never
// steals them. Card maps keep routing to `=`.
function propertyEditorYamlStageKindForRow(row) {
  if (!row || typeof propertyEditorRoleOf !== "function") return null;
  if (propertyEditorRoleOf(row) !== "loose" || row.pending === true) return null;
  if (typeof propertyEditorIsCheckbox === "function" && propertyEditorIsCheckbox(row)) return null;
  if (typeof propertyEditorStageKindForRow === "function" && propertyEditorStageKindForRow(row)) return null;
  return "yaml";
}

function propertyEditorYamlStageAvailableForRow(row) {
  if (!row || typeof propertyEditorRoleOf !== "function") return false;
  if (propertyEditorRoleOf(row) !== "loose" || row.pending === true) return false;
  return true;
}

function propertyEditorYamlOp(key, yaml) {
  return { op: "prop.set_yaml", key, yaml: String(yaml == null ? "" : yaml) };
}

// Pure build: the exact draft becomes one `prop.set_yaml` op. Anything Bob
// would refuse (malformed YAML, sibling or document injection, opaque
// content) passes through untouched so the dry-run reports it verbatim.
function propertyEditorYamlStageBuild(stage, draft) {
  if (!stage || stage.yaml !== true) {
    return { ok: false, code: "no-yaml-stage", message: "There is no YAML value being edited." };
  }
  const key = typeof stage.key === "string" ? stage.key : "";
  if (!key) {
    return { ok: false, code: "missing-key", message: "Select a property to edit as YAML." };
  }
  const seed = typeof stage.seedYaml === "string" ? stage.seedYaml : "";
  const value = draft && Object.prototype.hasOwnProperty.call(draft, "value")
    ? String(draft.value)
    : seed;
  const changed = value !== seed;
  return {
    ok: true,
    value,
    kind: "yaml",
    ops: changed ? [propertyEditorYamlOp(key, value)] : [],
    changed,
  };
}

// Occurrence of the selected row among same-key rows in source order.
// Report properties stay source-ordered, so counting earlier same-key rows
// names the exact fragment even when a key repeats.
function propertyEditorYamlOrdinal(rows, id, key) {
  const list = Array.isArray(rows) ? rows : [];
  let ordinal = 0;
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index];
    if (!row || typeof row.key !== "string") continue;
    let rowId = "";
    try {
      rowId = propertyEditorRowId(row, index);
    } catch (_) {
      rowId = "";
    }
    if (rowId === id) break;
    if (row.key === key) ordinal += 1;
  }
  return ordinal;
}

// Open-pane editor texts for one note path. DOM-free: reads CodeMirror
// values through the workspace leaves. The caller compares them against
// disk so an unsaved pane seeds the editor snapshot instead of stale text.
function propertyEditorYamlEditorTexts(app, path) {
  const texts = [];
  const want = typeof propertyEditorSourceNormalizePath === "function"
    ? propertyEditorSourceNormalizePath(path)
    : String(path || "");
  let leaves = [];
  try {
    leaves = (app && app.workspace && typeof app.workspace.getLeavesOfType === "function"
      ? app.workspace.getLeavesOfType("markdown")
      : []) || [];
  } catch (_) {
    leaves = [];
  }
  for (const leaf of leaves) {
    try {
      const view = leaf && leaf.view;
      const file = view && view.file;
      if (!file || typeof file.path !== "string") continue;
      const seen = typeof propertyEditorSourceNormalizePath === "function"
        ? propertyEditorSourceNormalizePath(file.path)
        : String(file.path);
      if (seen !== want) continue;
      const editor = view.editor;
      if (editor && typeof editor.getValue === "function") texts.push(String(editor.getValue()));
    } catch (_) {}
  }
  return texts;
}

// Seed one YAML stage from validated source. Options carry the key,
// ordinal, note path, current report, and the injected readers; every
// field is replaceable in tests. Unsaved panes never seed stale disk text:
// a differing editor snapshot must correspond with the fresh report, or
// the reader refuses with a save hint and nothing opens.
async function propertyEditorYamlStageSeedFor(options = {}) {
  const key = typeof options.key === "string" ? options.key : "";
  const path = typeof options.path === "string" ? options.path : "";
  if (!key) {
    return { ok: false, code: "missing-key", message: "Select a property to edit as YAML.", hint: "y opens YAML." };
  }
  if (!path) {
    return { ok: false, code: "missing-path", message: "No note path — reopen the editor.", hint: "y opens YAML." };
  }
  const parseYaml = options.parseYaml;
  if (typeof parseYaml !== "function") {
    return { ok: false, code: "yaml-parser-unavailable", message: "YAML validation is unavailable.", hint: "y opens YAML." };
  }
  if (typeof options.readSource !== "function") {
    return { ok: false, code: "source-unavailable", message: "Note source is unavailable — retry the YAML stage.", hint: "y opens YAML." };
  }
  const ordinal = Number.isInteger(options.ordinal) && options.ordinal >= 0 ? options.ordinal : 0;
  const isCancelled = typeof options.isCancelled === "function" ? options.isCancelled : () => false;
  let disk = null;
  try {
    disk = await options.readSource(path);
  } catch (_) {
    disk = null;
  }
  if (isCancelled()) {
    return { ok: false, code: "cancelled", message: "Read cancelled — retry the YAML stage.", hint: "y opens YAML." };
  }
  let editors = [];
  try {
    const found = typeof options.editorTexts === "function" ? await options.editorTexts(path) : [];
    if (Array.isArray(found)) editors = found.filter((text) => typeof text === "string");
  } catch (_) {
    editors = [];
  }
  const differs = typeof disk === "string" ? editors.filter((text) => text !== disk) : editors.slice();
  const snapshot = await propertyEditorReadSourceSnapshot({
    path,
    report: options.report || null,
    readReport: options.readReport,
    readSource: async () => disk,
    hasUnsaved: differs.length > 0,
    getEditorContent: differs.length > 0 ? async () => differs[0] : undefined,
    parseYaml,
    isCancelled,
  });
  if (!snapshot || snapshot.ok !== true) {
    return {
      ok: false,
      code: (snapshot && snapshot.code) || "yaml-unavailable",
      message: (snapshot && snapshot.message) || "YAML source is unavailable.",
      hint: (snapshot && snapshot.hint) || "y opens YAML.",
    };
  }
  const match = snapshot.entries.find((entry) => entry && entry.key === key && entry.occurrence === ordinal + 1) || null;
  if (!match) {
    return { ok: false, code: "yaml-moved", message: `“${key}” moved in the note — close and reopen the YAML stage.`, hint: "y opens YAML." };
  }
  const structuralOpaque = match.support !== "ok";
  const rowOpaque = options.opaque === true;
  const refusal = match.refusal && typeof match.refusal.message === "string" ? match.refusal.message : "";
  return {
    ok: true,
    key,
    valueYaml: match.valueYaml,
    line: match.line,
    inspect: structuralOpaque || rowOpaque,
    diagnostic: structuralOpaque && refusal
      ? refusal
      : rowOpaque
        ? "This value stays opaque — Bob refuses the write (prop_opaque); y opens YAML."
        : null,
    flow: snapshot.flow === true,
    lineEnding: snapshot.lineEnding,
  };
}

function propertyEditorPaintYamlStage(doc, host, options, modal) {
  if (!doc || !host || !options) return null;
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage is-yaml");
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("data-property-yaml", "true");
  panel.setAttribute("aria-label", `Edit ${options.key} as YAML`);
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, `“${options.key}” as YAML`);
  panel.appendChild(title);
  if (options.diagnostic) {
    const note = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note is-diagnostic");
    propertyEditorSetText(note, options.diagnostic);
    panel.appendChild(note);
  }
  const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-stage-label");
  const inputId = `bob-property-editor-yaml-${options.stageId}`;
  label.setAttribute("for", inputId);
  propertyEditorSetText(label, "YAML value");
  panel.appendChild(label);
  let input = options.keptInput || null;
  if (!input) {
    // bob-text: literal YAML value bytes are code, not prose.
    input = propertyEditorCreateEl(doc, "textarea", "bob-property-editor-stage-input is-yaml");
    input.setAttribute("rows", "8");
    input.value = options.value;
  } else if (!options.composing && String(input.value == null ? "" : input.value) !== options.value) {
    input.value = options.value;
  }
  input.setAttribute("id", inputId);
  input.setAttribute("data-property-stage-input", `property-stage-${options.stageId}`);
  input.setAttribute("data-property-stage-id", String(options.stageId));
  input.setAttribute("data-property-stage-kind", "yaml");
  input.setAttribute("aria-label", `${options.key} as YAML`);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  if (options.disabled) input.disabled = true;
  else input.disabled = false;
  if (!input.parentNode || input.parentNode !== panel) panel.appendChild(input);
  const keys = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-keys");
  propertyEditorSetText(keys, "Mod+Enter saves · Enter adds a line · Esc cancels");
  panel.appendChild(keys);
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  preview.setAttribute("aria-live", "polite");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  const actions = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "YAML value actions");
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
  void modal;
  return { panel, input };
}

const propertyEditorPaintStageBeforeYaml = propertyEditorPaintStage;
propertyEditorPaintStage = function propertyEditorPaintStageWithYaml(doc, host, options, modal) {
  if (options && (options.yaml === true || options.kind === "yaml")) {
    return propertyEditorPaintYamlStage(doc, host, options, modal);
  }
  return propertyEditorPaintStageBeforeYaml(doc, host, options, modal);
};

const propertyEditorPaintAllBeforeYaml = propertyEditorPaintAll;
propertyEditorPaintAll = function propertyEditorPaintAllWithYamlStage(host, options, doc, modal) {
  propertyEditorPaintAllBeforeYaml(host, options, doc, modal);
  const menu = host?.querySelector?.("[role='menu']");
  if (menu && options && options.menuOpen && typeof propertyEditorRenameReorderMenuButton === "function") {
    const selected = modal.editorSelected?.();
    const mutable = selected ? propertyEditorYamlStageAvailableForRow(selected.row) : false;
    const busy = modal.pendingApply === true || Boolean(modal.stage) || Boolean(modal.addName);
    propertyEditorRenameReorderMenuButton(doc, menu, modal, "Edit value as YAML", "edit-yaml", !mutable || busy);
  }
  const hints = host?.querySelector?.(".bob-property-editor-hints");
  propertyEditorSetText(hints,
    "j/k move · r rename · Alt+J/K reorder · Space mark · V range · / filter · Ctrl+D delete · o/O add · Enter/l open · Enter opens maps as YAML · u undo · y YAML · Esc back");
};

const propertyEditorOpenStageBeforeYaml = PropertyEditorModal.prototype.propertyEditorOpenStage;
const propertyEditorStageViewBeforeYaml = PropertyEditorModal.prototype.propertyEditorStageView;
const propertyEditorBuildBeforeYaml = PropertyEditorModal.prototype.propertyEditorBuildCurrentStage;
const propertyEditorPreviewTextBeforeYaml = PropertyEditorModal.prototype.propertyEditorStagePreviewText;
const propertyEditorPerformBeforeYaml = PropertyEditorModal.prototype.propertyEditorPerform;
const propertyEditorKeyDownBeforeYaml = PropertyEditorModal.prototype.propertyEditorOnKeyDown;
const propertyEditorCloseBeforeYaml = PropertyEditorModal.prototype.onClose;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorYamlSnapshotOptions(entry, token) {
    const plugin = this.propertyPlugin;
    const app = (plugin && plugin.app) || this.app;
    const path = this.filePath;
    const key = entry && entry.row ? entry.row.key : "";
    const rows = Array.isArray(this.properties) ? this.properties : [];
    const ordinal = propertyEditorYamlOrdinal(rows, entry && entry.id, key);
    const self = this;
    return {
      key,
      path,
      ordinal,
      opaque: Boolean(entry && entry.row && entry.row.opaque === true),
      report: this.report || null,
      parseYaml: typeof parseYaml === "function" ? parseYaml : null,
      readSource: (notePath) => propertyEditorEntryReadSource(plugin, notePath),
      readReport: async (notePath) => {
        try {
          const outcome = plugin && typeof plugin.apiPropertyShow === "function"
            ? await plugin.apiPropertyShow(notePath)
            : null;
          if (outcome && outcome.ok === true && outcome.report) return outcome.report;
        } catch (_) {}
        return null;
      },
      editorTexts: async (notePath) => propertyEditorYamlEditorTexts(app, notePath),
      isCancelled: () => self.closed === true || self.propertyEditorYamlReadToken !== token,
    };
  }
,
  async propertyEditorStartYamlStage(entry) {
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
    const target = entry || (typeof this.editorSelected === "function" ? this.editorSelected() : null);
    if (!target || !target.row) return false;
    if (!propertyEditorYamlStageAvailableForRow(target.row)) {
      const decision = typeof propertyEditorActionForRow === "function"
        ? propertyEditorActionForRow(target.row)
        : null;
      this.refusal = {
        code: "locked",
        message: (decision && decision.reason) || `Cannot edit “${target.row.key}” here.`,
        hint: "y opens YAML.",
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.announce = this.refusal.message;
      this.paintPropertyEditor();
      return false;
    }
    const token = (this.propertyEditorYamlReadToken || 0) + 1;
    this.propertyEditorYamlReadToken = token;
    this.menuOpen = false;
    this.refusal = null;
    this.status = typeof propertyEditorStatusChecking === "function"
      ? propertyEditorStatusChecking()
      : { kind: "checking", text: "Checking value…" };
    this.paintPropertyEditor();
    const seed = await propertyEditorYamlStageSeedFor(this.propertyEditorYamlSnapshotOptions(target, token));
    if (this.closed || this.propertyEditorYamlReadToken !== token) return false;
    if (!seed || seed.ok !== true) {
      this.refusal = {
        code: (seed && seed.code) || "yaml-unavailable",
        message: (seed && seed.message) || "YAML source is unavailable.",
        hint: (seed && seed.hint) || "y opens YAML.",
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.paintPropertyEditor();
      return false;
    }
    this.stageSeq = (this.stageSeq || 0) + 1;
    const inspect = seed.inspect === true;
    this.stage = {
      id: this.stageSeq,
      rowId: target.id,
      key: seed.key,
      line: target.row.line,
      kind: "yaml",
      wireKind: "yaml",
      yaml: true,
      seedYaml: seed.valueYaml,
      value: seed.valueYaml,
      items: [],
      itemDraft: "",
      inspect,
      diagnostic: seed.diagnostic || null,
      revision: 0,
      previewText: inspect && seed.diagnostic
        ? seed.diagnostic
        : "Edit YAML · Mod+Enter previews and saves",
      suggestionIndex: -1,
      suggestionCatalog: [],
    };
    this.pendingStageEnter = null;
    this.stageComposing = false;
    this.stageNeedsPreview = false;
    this.refusal = null;
    this.status = { kind: "ready", text: "" };
    this.announce = inspect && seed.diagnostic ? seed.diagnostic : `Edit “${seed.key}” as YAML.`;
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorOpenStage(entry) {
    const target = entry || (typeof this.editorSelected === "function" ? this.editorSelected() : null);
    if (target && propertyEditorYamlStageKindForRow(target.row) === "yaml") {
      void this.propertyEditorStartYamlStage(target);
      return true;
    }
    return propertyEditorOpenStageBeforeYaml.call(this, entry);
  }
,
  propertyEditorStageView() {
    const view = propertyEditorStageViewBeforeYaml.call(this);
    if (view && this.stage && this.stage.yaml === true) {
      return {
        ...view,
        yaml: true,
        kind: "yaml",
        label: "YAML",
        collection: false,
        prose: false,
        suggestions: [],
        seedYaml: this.stage.seedYaml,
        inspectOnly: this.stage.inspect === true,
        diagnostic: this.stage.diagnostic || null,
      };
    }
    return view;
  }
,
  propertyEditorBuildCurrentStage() {
    if (this.stage && this.stage.yaml === true) {
      return propertyEditorYamlStageBuild(this.stage, this.propertyEditorCurrentStageDraft());
    }
    return propertyEditorBuildBeforeYaml.call(this);
  }
,
  propertyEditorStagePreviewText(built) {
    if (this.stage && this.stage.yaml === true) {
      if (!built || built.ok !== true) return (built && built.message) || "Enter YAML for this value.";
      if (!built.changed) return "No changes · Esc returns to properties";
      const first = String(built.value == null ? "" : built.value).split("\n")[0];
      const summary = first.length > 60 ? `${first.slice(0, 60)}…` : first;
      return `Preview · ${this.stage.key} = ${summary || "(empty)"} · Mod+Enter saves`;
    }
    return propertyEditorPreviewTextBeforeYaml.call(this, built);
  }
,
  async propertyEditorPerform(action, event) {
    if (action === "edit-yaml") return this.propertyEditorStartYamlStage();
    return propertyEditorPerformBeforeYaml.call(this, action, event);
  }
,
  propertyEditorOnKeyDown(event) {
    const stage = this.stage;
    if (stage && stage.yaml === true && !this.closed) {
      const input = event?.target?.closest?.("[data-property-stage-input]");
      if (input) {
        if (event.isComposing || event.keyCode === 229 || this.stageComposing) return;
        if (event.key === "Enter" && event.altKey !== true
          && event.ctrlKey !== true && event.metaKey !== true) {
          // Plain (and Shift+) Enter inserts a newline; the input listener
          // folds it into the draft. Only Mod+Enter submits.
          return;
        }
        if (event.key === "Enter" && (event.ctrlKey === true || event.metaKey === true)
          && event.altKey !== true) {
          event.preventDefault?.();
          event.stopPropagation?.();
          void this.propertyEditorSaveStage();
          return;
        }
      }
    }
    return propertyEditorKeyDownBeforeYaml.call(this, event);
  }
,
  onClose() {
    this.propertyEditorYamlReadToken = (this.propertyEditorYamlReadToken || 0) + 1;
    return propertyEditorCloseBeforeYaml.call(this);
  }
,
});
