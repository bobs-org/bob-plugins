// Lives under stage with consequence preview and catalog refresh
// (plan:202611/area_project_cards.md phase editor-parent). It replaces the
// generic-text parent handler registered in 298x through the shared
// `propertyEditorRegisterSettingStageHandler` seam: the dispatch, the Ctrl+D
// refusal, ghost rendering, and undo history stay untouched.
//
// The stage reuses the nav-hotkeys restricted home picker model through the
// versioned `api.parentPicker` v1 namespace (`docs/develop/plugin-apis.md`):
// candidates show kind and hue pips and ineligible homes show the refusal
// text. It never copies the model. Without the namespace it falls back to a
// plain text stage guarded by bob's own validation.
//
// Preview and apply: a dry-run `setting.set parent` renders bob's `effects`
// and Enter applies only on a current preview. After apply, the stage runs
// exactly the `syncs[]` bob named (areas, projects, albums, notebooks)
// through the existing data-service sync paths inside the same guarded
// session and reports "Refreshing catalogs…" then the outcome. A sync
// failure keeps the write and surfaces the error; the catalogs' own
// stale-sync affordance is the backstop. Undo restores the parent and
// re-runs the same syncs. The existing Change parent gesture (682) keeps
// its byte-preserving writer.
function propertyEditorParentStemOf(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  const wiki = text.match(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
  const name = (wiki ? wiki[1] : text).trim().split("/").pop().replace(/\.md$/i, "").trim();
  return name;
}

function propertyEditorParentLinkFor(basename) {
  const stem = String(basename == null ? "" : basename).trim();
  if (!stem) return "";
  return `[[${stem}]]`;
}

function propertyEditorParentApi(modal) {
  try {
    const app = (modal && modal.app) || (modal && modal.propertyPlugin && modal.propertyPlugin.app);
    const plugins = app && app.plugins && app.plugins.plugins;
    const nav = plugins && plugins["bob-navigation-hotkeys"];
    const picker = nav && nav.api && nav.api.parentPicker;
    if (picker && Number(picker.version) >= 1 && typeof picker.list === "function") return picker;
  } catch (_) {}
  return null;
}

function propertyEditorParentHueFor(modal, path) {
  try {
    const plugin = modal && modal.propertyPlugin;
    if (plugin && typeof plugin.pomodoroHomeResolve === "function") {
      const home = plugin.pomodoroHomeResolve(path);
      if (home && typeof home.hue === "string" && home.hue) return home.hue;
      if (home && typeof home.color === "string" && home.color) return home.color;
    }
  } catch (_) {}
  try {
    const plugin = modal && modal.propertyPlugin;
    if (plugin && typeof plugin.apiNoteHomeForNote === "function") {
      const home = plugin.apiNoteHomeForNote(path);
      if (home && typeof home.hue === "string" && home.hue) return home.hue;
    }
  } catch (_) {}
  return "";
}

function propertyEditorParentListCandidates(modal, stage) {
  const api = propertyEditorParentApi(modal);
  if (!api) return { ok: false, reason: "unavailable", items: [], emptyText: "Type the parent note name — bob validates it.", currentParentPath: null };
  const query = String((stage && stage.parentQuery) || (stage && stage.value) || "");
  try {
    const result = api.list(modal && modal.filePath, query, 12);
    if (result && result.ok === true && Array.isArray(result.items)) {
      return {
        ok: true,
        items: result.items.slice(0, 12).map((item) => ({
          path: item.path,
          basename: item.basename,
          kind: item.kind || "plain",
          current: item.current === true,
          up: item.up === true,
          recent: item.recent === true,
          childCount: Number.isInteger(item.childCount) ? item.childCount : 0,
          hue: propertyEditorParentHueFor(modal, item.path),
        })),
        total: result.total,
        excludedOnly: result.excludedOnly === true,
        kindRefusal: result.kindRefusal || null,
        kindRefusalName: result.kindRefusalName || null,
        emptyText: result.emptyText || "",
        currentParentPath: result.currentParentPath || null,
      };
    }
  } catch (_) {}
  return { ok: false, reason: "unavailable", items: [], emptyText: "Type the parent note name — bob validates it.", currentParentPath: null };
}

function propertyEditorParentSeedQuery(entry) {
  const seeded = propertyEditorSettingSeedValue(entry);
  const stem = propertyEditorParentStemOf(seeded);
  if (stem) return stem;
  const effective = entry && entry.row && entry.row.effectiveValue;
  return propertyEditorParentStemOf(effective);
}

// Catalog syncs named by bob's parent `syncs[]` effect, through the existing
// data-service sync paths. Unknown names are never run.
function propertyEditorParentSyncNames(report, settingId = "parent") {
  const names = [];
  try {
    for (const effect of (report && Array.isArray(report.effects) ? report.effects : [])) {
      if (!effect || effect.setting !== settingId || effect.kind !== "syncs" || !Array.isArray(effect.syncs)) continue;
      for (const name of effect.syncs) {
        if (typeof name === "string" && name && !names.includes(name)) names.push(name);
      }
    }
  } catch (_) {}
  return names.filter((name) => ["areas", "projects", "albums", "notebooks"].includes(name));
}

async function propertyEditorParentRunSyncs(modal, names) {
  const plugin = modal && modal.propertyPlugin;
  const results = [];
  for (const name of names) {
    let outcome = null;
    try {
      if (name === "areas" && plugin && typeof plugin.apiAreasSync === "function") outcome = await plugin.apiAreasSync();
      else if (name === "projects" && plugin && typeof plugin.apiProjectsSync === "function") outcome = await plugin.apiProjectsSync({ automatic: false });
      else if (name === "albums" && plugin && typeof plugin.apiAlbumSync === "function") outcome = await plugin.apiAlbumSync({ automatic: false });
      else if (name === "notebooks" && plugin && typeof plugin.apiNotebookSync === "function") outcome = await plugin.apiNotebookSync({ automatic: false });
      else outcome = { ok: false, code: "sync-unsupported", message: `No sync path for ${name}.` };
    } catch (error) {
      outcome = { ok: false, code: "failed", message: (error && error.message) || `${name} sync failed.` };
    }
    results.push({ name, ok: Boolean(outcome && outcome.ok !== false && (!outcome.error)) });
    if (results[results.length - 1].ok === false) {
      const failure = (outcome && (outcome.error || outcome)) || {};
      results[results.length - 1].message = failure.message || `${name} sync failed.`;
    }
  }
  return results;
}

function propertyEditorParentSyncReport(names, results) {
  if (!names.length) return "";
  const failed = results.filter((row) => !row.ok);
  if (!failed.length) return `✓ Moved · ${names.length} catalog${names.length === 1 ? "" : "s"} refreshed · u undo`;
  return `Saved, but ${failed.map((row) => row.name).join(", ")} sync failed — the catalogs retry on their own. Undo still works.`;
}

function propertyEditorParentStageBuild(entry, stage, draft) {
  const settingId = "parent";
  const picked = stage && typeof stage.parentPickPath === "string" && stage.parentPickPath ? stage.parentPickPath : "";
  if (picked) {
    const stem = picked.split("/").pop().replace(/\.md$/i, "").trim();
    if (!stem) return { ok: false, message: "Choose the new home — the parent must be an existing note." };
    const current = propertyEditorParentStemOf(propertyEditorSettingSeedValue(entry));
    const value = propertyEditorParentLinkFor(stem);
    if (stem === current) return { ok: true, value, changed: false, ops: [] };
    return { ok: true, value, changed: true, ops: [propertyEditorSettingSetOp(settingId, value)] };
  }
  const hasDraft = draft && Object.prototype.hasOwnProperty.call(draft, "value");
  const raw = hasDraft ? String(draft.value) : "";
  const stem = propertyEditorParentStemOf(raw);
  if (!stem) return { ok: false, message: "Choose the new home — the parent must be an existing note." };
  const current = propertyEditorParentStemOf(propertyEditorSettingSeedValue(entry));
  if (stem === current) return { ok: true, value: propertyEditorParentLinkFor(stem), changed: false, ops: [] };
  return { ok: true, value: propertyEditorParentLinkFor(stem), changed: true, ops: [propertyEditorSettingSetOp(settingId, propertyEditorParentLinkFor(stem))] };
}

function propertyEditorPaintParentStage(doc, host, options, modal) {
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage is-setting is-parent");
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("data-setting-id", "parent");
  panel.setAttribute("aria-label", "Edit Lives under");
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, "parent · Lives under");
  panel.appendChild(title);
  const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-stage-label");
  const inputId = `bob-property-editor-stage-input-${options.stageId}`;
  label.setAttribute("for", inputId);
  propertyEditorSetText(label, "New home");
  panel.appendChild(label);
  let input = options.keptInput || null;
  if (!input) {
    // bob-text: literal Lives under parent note name
    input = propertyEditorCreateEl(doc, "input", "bob-property-editor-stage-input is-parent");
    input.setAttribute("type", "text");
    input.value = String(options.value == null ? "" : options.value);
  } else if (!options.composing && String(input.value == null ? "" : input.value) !== String(options.value == null ? "" : options.value)) {
    input.value = String(options.value == null ? "" : options.value);
  }
  input.setAttribute("id", inputId);
  input.setAttribute("data-property-stage-input", `property-stage-${options.stageId}`);
  input.setAttribute("data-property-stage-id", String(options.stageId));
  input.setAttribute("data-property-stage-kind", "text");
  input.setAttribute("aria-label", "New home");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("placeholder", "Type a home name…");
  if (options.disabled) input.disabled = true;
  panel.appendChild(input);
  const candidates = Array.isArray(options.parentCandidates) ? options.parentCandidates : [];
  if (candidates.length) {
    const list = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-suggestions is-parent-list");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Home notes");
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const button = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-suggestion is-parent-row");
      button.setAttribute("type", "button");
      button.setAttribute("role", "option");
      button.setAttribute("data-property-stage-action", "pick-parent");
      button.setAttribute("data-property-stage-index", String(index));
      button.setAttribute("aria-selected", options.parentSelected === index ? "true" : "false");
      if (options.parentSelected === index) button.classList?.add?.("is-selected");
      const kind = propertyEditorCreateEl(doc, "span", "bob-parent-row-kind");
      propertyEditorSetText(kind, String(candidate.kind || "note"));
      button.appendChild(kind);
      if (candidate.hue) {
        const pip = propertyEditorCreateEl(doc, "span", "bob-parent-row-hue");
        pip.setAttribute("data-hue", String(candidate.hue));
        pip.setAttribute("title", `Hue ${candidate.hue}`);
        pip.setAttribute("aria-label", `Hue ${candidate.hue}`);
        button.appendChild(pip);
      }
      const name = propertyEditorCreateEl(doc, "span", "bob-parent-row-name");
      propertyEditorSetText(name, `${candidate.basename || candidate.path}${candidate.current ? " · current" : ""}${candidate.up ? " · up a level" : ""}`);
      button.appendChild(name);
      if (candidate.childCount > 0) {
        const kids = propertyEditorCreateEl(doc, "span", "bob-parent-row-children");
        propertyEditorSetText(kids, `${candidate.childCount}`);
        button.appendChild(kids);
      }
      list.appendChild(button);
    }
    panel.appendChild(list);
  } else if (options.parentEmptyText) {
    const empty = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note is-parent-empty");
    propertyEditorSetText(empty, String(options.parentEmptyText));
    panel.appendChild(empty);
  }
  propertyEditorPaintSettingNotes(doc, panel, options);
  if (options.parentSyncText) {
    const sync = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note is-sync");
    propertyEditorSetText(sync, String(options.parentSyncText));
    panel.appendChild(sync);
  }
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  propertyEditorPaintSettingActions(doc, panel, options);
  host.appendChild(panel);
  return { panel, input, band: null };
}

// Register the dedicated handler after 298x so the parent row opens this
// stage instead of the generic text stage. Hue, type, and clock keep their
// own handlers from the sibling phase; this file only owns `parent`.
propertyEditorRegisterSettingStageHandler("parent", { kind: "parent", wireKind: "text", prose: true });

const propertyEditorSettingOpenDraftBeforeParent = propertyEditorSettingOpenDraft;
propertyEditorSettingOpenDraft = function propertyEditorSettingOpenDraftWithParent(modal, entry, handler) {
  if (!handler || handler.kind !== "parent") return propertyEditorSettingOpenDraftBeforeParent(modal, entry, handler);
  if (typeof modal.propertyEditorCancelStage === "function") modal.propertyEditorCancelStage({ quiet: true });
  const seeded = propertyEditorParentSeedQuery(entry);
  const base = propertyEditorSettingStageIdentity(modal, entry);
  modal.stageSeq = base.id;
  const stage = {
    ...base,
    kind: "parent",
    wireKind: "text",
    settingStage: "parent",
    prose: true,
    value: seeded || "",
    parentQuery: seeded || "",
    parentPickPath: "",
    parentSelected: -1,
    parentSyncText: "",
    items: [],
    off: false,
    suggestionCatalog: [],
  };
  modal.stage = stage;
  modal.pendingStageEnter = null;
  modal.stageComposing = false;
  modal.stageNeedsPreview = false;
  modal.refusal = null;
  modal.announce = "";
  modal.status = { kind: "ready", text: "" };
  try {
    const listed = propertyEditorParentListCandidates(modal, stage);
    stage.parentCandidates = listed.items;
    stage.parentEmptyText = listed.emptyText || "";
  } catch (_) {
    stage.parentCandidates = [];
    stage.parentEmptyText = "";
  }
  return { ok: true, stage };
};

const propertyEditorStageViewBeforeParent = PropertyEditorModal.prototype.propertyEditorStageView;
PropertyEditorModal.prototype.propertyEditorStageView = function propertyEditorStageViewWithParent() {
  const view = propertyEditorStageViewBeforeParent.call(this);
  const stage = this.stage;
  if (!view || !stage || stage.settingId !== "parent" || stage.settingStage !== "parent") return view;
  view.settingStage = "parent";
  view.kind = "parent";
  view.prose = true;
  view.parentCandidates = Array.isArray(stage.parentCandidates) ? stage.parentCandidates.slice() : [];
  view.parentEmptyText = typeof stage.parentEmptyText === "string" ? stage.parentEmptyText : "";
  view.parentSelected = Number.isInteger(stage.parentSelected) ? stage.parentSelected : -1;
  view.parentSyncText = typeof stage.parentSyncText === "string" ? stage.parentSyncText : "";
  view.value = String(stage.value == null ? "" : stage.value);
  const state = this.session && typeof this.session.getState === "function" ? this.session.getState() : this.sessionState;
  if (state && state.preview && state.preview.dry_run !== false && state.status === "preview-ready") {
    view.previewExtras = propertyEditorSettingPreviewText(state.preview, "parent", [view.helpNote]);
  }
  if (!view.effectLine) {
    try {
      const entry = this.propertyEditorStageFindRow(stage);
      const built = propertyEditorParentStageBuild(entry, stage, { value: stage.value });
      if (built.ok && built.ops && built.ops.length) {
        const preview = state && state.preview && state.preview.report ? state.preview : state && state.preview;
        const report = preview && preview.report ? preview.report : preview;
        if (report) view.previewExtras = propertyEditorSettingPreviewText(report, "parent", [view.helpNote, view.previewExtras].filter(Boolean));
      }
    } catch (_) {}
  }
  return view;
};

const propertyEditorBuildBeforeParent = PropertyEditorModal.prototype.propertyEditorBuildCurrentStage;
PropertyEditorModal.prototype.propertyEditorBuildCurrentStage = function propertyEditorBuildCurrentStageWithParent() {
  if (this.stage && this.stage.settingId === "parent" && this.stage.settingStage === "parent") {
    const entry = this.propertyEditorStageFindRow();
    if (!entry) return { ok: false, message: "The setting is no longer available." };
    return propertyEditorParentStageBuild(entry, this.stage, this.propertyEditorCurrentStageDraft());
  }
  return propertyEditorBuildBeforeParent.call(this);
};

const propertyEditorPaintStageBeforeParent = propertyEditorPaintStage;
propertyEditorPaintStage = function propertyEditorPaintStageWithParent(doc, host, options, modal) {
  if (options && options.settingStage === "parent") return propertyEditorPaintParentStage(doc, host, options, modal);
  return propertyEditorPaintStageBeforeParent(doc, host, options, modal);
};

// Keep the retained parent input across repaints (the base stage painter
// already retains by stage id; the parent list repaints around it).
const propertyEditorInputBeforeParent = PropertyEditorModal.prototype.propertyEditorStageInputChanged;
PropertyEditorModal.prototype.propertyEditorStageInputChanged = function propertyEditorStageInputChangedWithParent(input) {
  if (this.stage && this.stage.settingId === "parent" && this.stage.settingStage === "parent") {
    const text = String((input && input.value) == null ? "" : input.value);
    if (text !== this.stage.value) {
      this.stage.value = text;
      this.stage.parentQuery = text;
      this.stage.parentPickPath = "";
      this.stage.parentSelected = -1;
      this.stage.revision += 1;
      try {
        const listed = propertyEditorParentListCandidates(this, this.stage);
        this.stage.parentCandidates = listed.items;
        this.stage.parentEmptyText = listed.emptyText || "";
      } catch (_) {}
    }
  }
  return propertyEditorInputBeforeParent.call(this, input);
};

const propertyEditorClickBeforeParent = PropertyEditorModal.prototype.propertyEditorOnClick;
PropertyEditorModal.prototype.propertyEditorOnClick = function propertyEditorOnClickWithParent(event) {
  const action = event?.target?.closest?.("[data-property-stage-action]")?.getAttribute?.("data-property-stage-action");
  if (this.stage && this.stage.settingId === "parent" && this.stage.settingStage === "parent" && action === "pick-parent") {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const index = Number(event?.target?.closest?.("[data-property-stage-action]")?.getAttribute?.("data-property-stage-index"));
    const candidates = Array.isArray(this.stage.parentCandidates) ? this.stage.parentCandidates : [];
    const picked = candidates[index];
    if (picked && picked.path) {
      this.stage.parentPickPath = picked.path;
      this.stage.value = picked.basename || "";
      this.stage.parentQuery = picked.basename || "";
      this.stage.parentSelected = index;
      this.stage.revision += 1;
      this.pendingStageEnter = null;
      try {
        this.propertyEditorStageInputChanged({ value: this.stage.value, getAttribute: (name) => name === "data-property-stage-kind" ? "text" : String(this.stage.id) });
      } catch (_) {}
      this.paintPropertyEditor();
    }
    return;
  }
  return propertyEditorClickBeforeParent.call(this, event);
};

const propertyEditorKeyBeforeParent = PropertyEditorModal.prototype.propertyEditorOnKeyDown;
PropertyEditorModal.prototype.propertyEditorOnKeyDown = function propertyEditorOnKeyDownWithParent(event) {
  if (this.stage && this.stage.settingId === "parent" && this.stage.settingStage === "parent") {
    const inInput = Boolean(event?.target?.closest?.("[data-property-stage-input]"));
    if (!event.ctrlKey && !event.metaKey && !event.altKey && inInput && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const candidates = Array.isArray(this.stage.parentCandidates) ? this.stage.parentCandidates : [];
      if (candidates.length) {
        event.preventDefault?.();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = ((Number.isInteger(this.stage.parentSelected) ? this.stage.parentSelected : -1) + delta + candidates.length) % candidates.length;
        this.stage.parentSelected = next;
        const picked = candidates[next];
        if (picked) {
          this.stage.parentPickPath = picked.path;
          this.stage.value = picked.basename || "";
          this.stage.parentQuery = picked.basename || "";
          this.stage.revision += 1;
          this.pendingStageEnter = null;
          try {
            this.propertyEditorStageInputChanged({ value: this.stage.value, getAttribute: () => String(this.stage.id) });
          } catch (_) {}
          this.paintPropertyEditor();
        }
        return;
      }
    }
  }
  return propertyEditorKeyBeforeParent.call(this, event);
};

// Apply with catalog refresh: after the guarded write lands, run exactly the
// syncs bob named and report the outcome on the stage. Undo re-runs the
// same syncs so the catalogs follow the restored parent.
const propertyEditorApplyStageBeforeParent = PropertyEditorModal.prototype.propertyEditorApplyStage;
PropertyEditorModal.prototype.propertyEditorApplyStage = async function propertyEditorApplyStageWithParent(built) {
  if (!this.stage || this.stage.settingId !== "parent" || this.stage.settingStage !== "parent") {
    return propertyEditorApplyStageBeforeParent.call(this, built);
  }
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
  if (result?.ok !== true) {
    const failure = result?.report?.error || result || {};
    const refusal = propertyEditorStatusRefusal(failure);
    this.refusal = refusal;
    this.status = { kind: "refusal", text: refusal.message };
    this.stage.previewText = `${refusal.message}${refusal.hint ? ` — ${refusal.hint}` : ""}`;
    this.paintPropertyEditor();
    return result;
  }
  const names = propertyEditorParentSyncNames(result.report, "parent");
  const stem = propertyEditorParentStemOf(built && built.value);
  if (this.report && result.report) {
    try { this.propertyEditorReconcile({ ...this.report, ...result.report }); } catch (_) {}
  }
  if (!names.length) {
    this.propertyEditorCancelStage({ quiet: true });
    this.refusal = null;
    this.status = propertyEditorStatusSaved();
    this.paintPropertyEditor();
    return result;
  }
  try {
    if (this.stage) {
      this.stage.parentSyncText = "Refreshing catalogs…";
      this.status = { kind: "checking", text: "Refreshing catalogs…" };
      this.paintPropertyEditor();
    }
  } catch (_) {}
  let syncs = [];
  try {
    syncs = await propertyEditorParentRunSyncs(this, names);
  } catch (_) {
    syncs = names.map((name) => ({ name, ok: false, message: `${name} sync failed.` }));
  }
  if (this.closed) return result;
  const line = propertyEditorParentSyncReport(names, syncs);
  try {
    if (this.stage && this.stage.id === stageId) {
      this.stage.parentSyncText = line;
      this.stage.previewText = [this.stage.previewText, line].filter(Boolean).join(" · ");
    }
  } catch (_) {}
  this.refusal = syncs.some((row) => !row.ok) ? { code: "sync-failed", message: line } : null;
  this.status = syncs.some((row) => !row.ok) ? { kind: "refusal", text: line } : propertyEditorStatusSaved();
  if (this.stage) this.announce = line || `Moved under ${stem || "the new home"}`;
  this.paintPropertyEditor();
  // Undo for a re-home re-runs the same catalog syncs inside the guarded
  // session wrapper below.
  try {
    this._propertyParentLastSyncs = names.slice();
  } catch (_) {}
  return { ...result, parentSyncs: syncs };
};

const propertyEditorInstallSettingSessionBeforeParent = propertyEditorInstallSettingSession;
propertyEditorInstallSettingSession = function propertyEditorInstallSettingSessionWithParent(session, modal) {
  const wrapped = propertyEditorInstallSettingSessionBeforeParent(session, modal);
  if (!wrapped || wrapped._parentSyncWrapped) return wrapped;
  const originalUndo = typeof wrapped.undo === "function" ? wrapped.undo.bind(wrapped) : null;
  if (originalUndo) {
    wrapped.undo = async function undoWithParentSyncs() {
      const result = await originalUndo();
      try {
        const names = Array.isArray(modal && modal._propertyParentLastSyncs) ? modal._propertyParentLastSyncs : [];
        if (result && result.ok === true && names.length && modal && !modal.closed) {
          if (modal.stage) {
            modal.stage.parentSyncText = "Refreshing catalogs…";
            modal.paintPropertyEditor();
          }
          const syncs = await propertyEditorParentRunSyncs(modal, names);
          if (modal && !modal.closed && modal.stage) {
            modal.stage.parentSyncText = propertyEditorParentSyncReport(names, syncs);
            modal.paintPropertyEditor();
          }
        }
      } catch (_) {}
      return result;
    };
  }
  wrapped._parentSyncWrapped = true;
  return wrapped;
};
