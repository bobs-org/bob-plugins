// Simple setting stages and one-gesture clear/toggle through the shared
// property session. propertyEditorResolveSettingStage is the replacement
// seam: hue, type, clock-policy, and parent phases register their own
// handlers and leave this dispatch intact.
function propertyEditorSettingStageIdentity(modal, entry) {
  return {
    id: (modal.stageSeq || 0) + 1,
    rowId: entry.id,
    key: entry.row.key,
    settingId: entry.row.settingId,
    settingKeys: Array.isArray(entry.row.settingKeys) ? entry.row.settingKeys.slice() : [],
    line: entry.row.line,
    revision: 0,
    previewText: "",
    suggestionIndex: -1,
    itemDraft: "",
  };
}

function propertyEditorSettingOpenDraft(modal, entry, handler) {
  if (typeof modal.propertyEditorCancelStage === "function") modal.propertyEditorCancelStage({ quiet: true });
  const seeded = propertyEditorSettingSeedValue(entry);
  const base = propertyEditorSettingStageIdentity(modal, entry);
  modal.stageSeq = base.id;
  const stage = {
    ...base,
    kind: handler.wireKind || "text",
    wireKind: handler.wireKind || "text",
    settingStage: handler.kind,
    prose: handler.prose === true,
    value: "",
    items: [],
    off: false,
    suggestionCatalog: [],
  };
  if (handler.kind === "list") {
    stage.items = propertyEditorSettingAliasItems(seeded);
    stage.value = "";
    stage.suggestionCatalog = typeof propertyEditorSuggestValues === "function"
      ? propertyEditorSuggestValues(modal.app, entry.row.settingId || "project_name_aliases", modal.filePath)
      : [];
  } else if (handler.kind === "ready-cap") {
    const parsed = propertyEditorSettingReadyCapValue(seeded);
    stage.off = parsed.ok === true ? parsed.off === true : false;
    stage.value = parsed.ok === true && parsed.off !== true ? String(parsed.value) : "";
  } else if (handler.kind === "review") {
    const parsed = propertyEditorSettingReviewValue(seeded);
    stage.value = parsed.ok === true ? String(parsed.value) : "";
  } else if (handler.kind === "generic-clock") {
    stage.value = propertyEditorSettingClockSeedText(seeded);
  } else {
    stage.value = seeded == null ? "" : String(seeded);
    if (handler.kind === "generic-text" && typeof propertyEditorSuggestValues === "function") {
      const key = entry.row.settingKeys && entry.row.settingKeys[0] || entry.row.settingId;
      stage.suggestionCatalog = propertyEditorSuggestValues(modal.app, key, modal.filePath);
    }
  }
  modal.stage = stage;
  modal.pendingStageEnter = null;
  modal.stageComposing = false;
  modal.stageNeedsPreview = false;
  modal.refusal = null;
  modal.announce = "";
  modal.status = { kind: "ready", text: "" };
  return { ok: true, stage };
}

// The first preview or actions child of a painted stage. Setting notes go
// before it so a generic painter's notes sit with the control, as on the
// dedicated stages, never below Save/Cancel.
function propertyEditorSettingNotesAnchor(panel) {
  try {
    const children = panel && panel.children ? Array.from(panel.children) : [];
    return children.find((child) => /\bbob-property-editor-stage-(?:preview|actions)\b/.test(
      String((child && (child.className || (typeof child.getAttribute === "function" && child.getAttribute("class")))) || ""),
    )) || null;
  } catch (_) {
    return null;
  }
}

function propertyEditorPaintSettingNotes(doc, panel, options, anchor = null) {
  if (!doc || !panel || !options) return;
  const place = (node) => {
    if (anchor && anchor.parentNode === panel && typeof panel.insertBefore === "function") panel.insertBefore(node, anchor);
    else panel.appendChild(node);
  };
  if (options.counter) {
    const counter = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-counter");
    propertyEditorSetText(counter, options.counter);
    if (options.warnLong) counter.classList?.add?.("is-long");
    place(counter);
  }
  if (options.effectLine) {
    const effect = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note is-effect");
    propertyEditorSetText(effect, options.effectLine);
    place(effect);
  }
  if (options.helpNote) {
    const help = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note");
    propertyEditorSetText(help, options.helpNote);
    place(help);
  }
  if (options.previewExtras) {
    const extras = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note is-diagnostic");
    propertyEditorSetText(extras, options.previewExtras);
    place(extras);
  }
}

function propertyEditorPaintSummaryStage(doc, host, options, modal) {
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage is-setting is-summary");
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("data-setting-id", options.settingId || "summary");
  panel.setAttribute("aria-label", "Edit Summary");
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, "summary · Summary");
  panel.appendChild(title);
  const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-stage-label");
  const inputId = `bob-property-editor-stage-input-${options.stageId}`;
  label.setAttribute("for", inputId);
  propertyEditorSetText(label, "Summary");
  panel.appendChild(label);
  let input = options.keptInput || null;
  if (!input) {
    // bob-text: literal one-line area/project summary
    input = propertyEditorCreateEl(doc, "textarea", "bob-property-editor-stage-input is-summary");
    input.value = options.value;
  } else if (!options.composing && String(input.value == null ? "" : input.value) !== options.value) {
    input.value = options.value;
  }
  input.setAttribute("id", inputId);
  input.setAttribute("data-property-stage-input", `property-stage-${options.stageId}`);
  input.setAttribute("data-property-stage-id", String(options.stageId));
  input.setAttribute("data-property-stage-kind", "text");
  input.setAttribute("aria-label", "Summary");
  if (options.disabled) input.disabled = true;
  panel.appendChild(input);
  if (typeof bobSoftLineAttach === "function") {
    try {
      bobSoftLineAttach(input, {
        onFold: () => {
          try { if (modal && modal.stage) modal.stage.summaryFoldNote = "Line breaks became spaces — a summary is one line."; } catch (_) {}
          try { modal?.paintPropertyEditor?.(); } catch (_) {}
        },
      });
    } catch (_) {}
  }
  try { if (typeof bobSoftLineAutosize === "function") bobSoftLineAutosize(input); } catch (_) {}
  propertyEditorPaintSettingNotes(doc, panel, options);
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  propertyEditorPaintSettingActions(doc, panel, options);
  host.appendChild(panel);
  return { panel, input, band: null };
}

function propertyEditorPaintSettingActions(doc, panel, options) {
  const actions = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-actions");
  actions.setAttribute("role", "group");
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
}

function propertyEditorPaintStepperStage(doc, host, options, modal) {
  const setting = options.settingStage === "review" ? "review" : "ready-cap";
  const panel = propertyEditorCreateEl(doc, "section", `bob-property-editor-stage is-setting is-${setting}`);
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("data-setting-id", options.settingId || "");
  panel.setAttribute("aria-label", `Edit ${options.key}`);
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, `${options.settingId} · ${options.key}`);
  panel.appendChild(title);
  const controls = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-stepper");
  const minus = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-step");
  minus.setAttribute("type", "button");
  minus.setAttribute("data-property-stage-action", "step-down");
  minus.setAttribute("aria-label", "Decrease");
  propertyEditorSetText(minus, "−");
  controls.appendChild(minus);
  let input = options.keptInput || null;
  if (!input) {
    // bob-text: none numeric setting stepper
    input = propertyEditorCreateEl(doc, "input", "bob-property-editor-stage-input is-stepper");
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.value = options.off ? "off" : options.value;
  } else if (!options.composing) {
    const next = options.off ? "off" : options.value;
    if (String(input.value == null ? "" : input.value) !== next) input.value = next;
  }
  input.setAttribute("id", `bob-property-editor-stage-input-${options.stageId}`);
  input.setAttribute("data-property-stage-input", `property-stage-${options.stageId}`);
  input.setAttribute("data-property-stage-id", String(options.stageId));
  input.setAttribute("data-property-stage-kind", "number");
  input.setAttribute("aria-label", options.key);
  if (options.disabled) input.disabled = true;
  controls.appendChild(input);
  const plus = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-step");
  plus.setAttribute("type", "button");
  plus.setAttribute("data-property-stage-action", "step-up");
  plus.setAttribute("aria-label", "Increase");
  propertyEditorSetText(plus, "+");
  controls.appendChild(plus);
  if (setting === "ready-cap") {
    const off = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-off");
    off.setAttribute("type", "button");
    off.setAttribute("data-property-stage-action", "toggle-off");
    off.setAttribute("aria-pressed", options.off ? "true" : "false");
    propertyEditorSetText(off, "off");
    controls.appendChild(off);
  }
  panel.appendChild(controls);
  propertyEditorPaintSettingNotes(doc, panel, options);
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  propertyEditorPaintSettingActions(doc, panel, options);
  host.appendChild(panel);
  return { panel, input, band: null };
}

function propertyEditorInstallSettingSession(session, modal) {
  if (!session || session._settingSessionWrapped) return session;
  const originalApplyOps = typeof session.applyOps === "function" ? session.applyOps.bind(session) : null;
  const originalApply = typeof session.apply === "function" ? session.apply.bind(session) : null;
  const originalUndo = typeof session.undo === "function" ? session.undo.bind(session) : null;
  const originalRedo = typeof session.redo === "function" ? session.redo.bind(session) : null;
  async function adopt(result) {
    propertyEditorAdoptConfirmedContract(modal, result);
    return result;
  }
  if (originalApplyOps) {
    session.applyOps = async function applyOpsWithSettingPreview(ops) {
      const settingOps = Array.isArray(ops) && ops.some((op) => op && (op.op === "setting.set" || op.op === "setting.clear"));
      if (settingOps && typeof session.setDraft === "function" && typeof session.previewNow === "function" && originalApply) {
        session.setDraft(ops);
        const preview = await session.previewNow();
        if (!preview || preview.ok !== true) return preview || { ok: false, message: "The property preview was refused." };
        const settingId = ops.find((op) => op && (op.op === "setting.set" || op.op === "setting.clear"))?.setting;
        const text = propertyEditorSettingPreviewText(preview.report, settingId);
        if (text) {
          modal.announce = text;
          if (modal.stage) modal.stage.previewText = [modal.stage.previewText, text].filter(Boolean).join(" · ");
        }
        return adopt(await originalApply());
      }
      return adopt(await originalApplyOps(ops));
    };
  }
  if (originalApply) session.apply = async function applyWithConfirmedContract() { return adopt(await originalApply()); };
  if (originalUndo) session.undo = async function undoWithConfirmedContract() { return adopt(await originalUndo()); };
  if (originalRedo) session.redo = async function redoWithConfirmedContract() { return adopt(await originalRedo()); };
  session._settingSessionWrapped = true;
  return session;
}

const propertyEditorEnsureSessionBeforeSettings = PropertyEditorModal.prototype.editorEnsureSession;
PropertyEditorModal.prototype.editorEnsureSession = function editorEnsureSessionWithSettingContract() {
  const session = propertyEditorEnsureSessionBeforeSettings.call(this);
  return propertyEditorInstallSettingSession(session, this);
};

const propertyEditorPaintStageBeforeSettings = propertyEditorPaintStage;
propertyEditorPaintStage = function propertyEditorPaintStageWithSettings(doc, host, options, modal) {
  if (options && options.settingStage === "summary") return propertyEditorPaintSummaryStage(doc, host, options, modal);
  if (options && (options.settingStage === "ready-cap" || options.settingStage === "review")) {
    return propertyEditorPaintStepperStage(doc, host, options, modal);
  }
  const painted = propertyEditorPaintStageBeforeSettings(doc, host, options, modal);
  if (painted && painted.panel && options && options.settingId) {
    try { painted.panel.setAttribute("data-setting-id", options.settingId); } catch (_) {}
    painted.panel.classList?.add?.("is-setting");
    propertyEditorPaintSettingNotes(doc, painted.panel, options, propertyEditorSettingNotesAnchor(painted.panel));
  }
  return painted;
};

const propertyEditorActivateBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorActivate;
const propertyEditorStageViewBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorStageView;
const propertyEditorBuildBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorBuildCurrentStage;
const propertyEditorPreviewTextBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorStagePreviewText;
const propertyEditorSyncPreviewBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorStageSyncPreview;
const propertyEditorInputBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorStageInputChanged;
const propertyEditorKeyBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorOnKeyDown;
const propertyEditorClickBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorOnClick;
const propertyEditorResolveBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorResolveSettingStage;
const propertyEditorReconcileBeforeSettingActions = PropertyEditorModal.prototype.propertyEditorReconcile;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorReconcile(report) {
    if (!report || report.dry_run === true) return;
    const next = { ...report };
    delete next.dry_run;
    return propertyEditorReconcileBeforeSettingActions.call(this, next);
  },

  propertyEditorResolveSettingStage(entry) {
    if (!entry || this.closed || this.pendingApply) {
      return { ok: false, message: "Setting controls are not available." };
    }
    const settingId = entry.row && entry.row.settingId;
    const handler = propertyEditorSettingStageHandler(settingId);
    if (!handler) {
      return propertyEditorResolveBeforeSettingActions.call(this, entry);
    }
    if (entry.row.settingDisabled === true) {
      return { ok: false, message: entry.row.disabledReason || `${entry.row.key} is disabled for this note.` };
    }
    if (handler.kind === "toggle") return { ok: true, toggle: true, settingId };
    return propertyEditorSettingOpenDraft(this, entry, handler);
  },

  async propertyEditorActivate(entry) {
    const type = entry && (entry.entryType || entry.row && entry.row.propertyEntryType);
    if (type === "setting" && entry.row && entry.row.settingId === "root") {
      return this.propertyEditorToggleStatsRoot(entry);
    }
    return propertyEditorActivateBeforeSettingActions.call(this, entry);
  },

  async propertyEditorToggleStatsRoot(entry) {
    if (this.closed || this.pendingApply) return this.propertyEditorRefuseWhileSaving?.();
    const planned = propertyEditorSettingRootOps(entry);
    if (!planned.ok) {
      this.announce = planned.message;
      this.status = { kind: "refusal", text: planned.message };
      this.refusal = { code: "locked", message: planned.message };
      this.paintPropertyEditor();
      return planned;
    }
    this.announce = PROPERTY_EDITOR_STATS_ROOT_HELP;
    const session = this.editorEnsureSession();
    if (!session || typeof session.applyOps !== "function") {
      return propertyEditorSettingsNotice(this, "unavailable", "Property editing is unavailable.");
    }
    this.pendingApply = true;
    this.status = propertyEditorStatusChecking();
    this.paintPropertyEditor();
    let result;
    try { result = await session.applyOps(planned.ops); }
    catch (error) { result = { ok: false, message: error?.message || "The property update failed." }; }
    finally { this.pendingApply = false; }
    if (this.closed) return result;
    if (result && result.ok === true) {
      this.refusal = null;
      this.status = propertyEditorStatusSaved();
    } else {
      const refusal = propertyEditorStatusRefusal(result && result.report && result.report.error ? result.report.error : result || {});
      this.refusal = refusal;
      this.status = { kind: "refusal", text: refusal.message };
    }
    this.paintPropertyEditor();
    return result;
  },

  async propertyEditorClearCurrentSetting() {
    const stage = this.stage;
    const settingId = stage && stage.settingId;
    if (!settingId) return false;
    const entry = this.propertyEditorStageFindRow(stage);
    if (!entry || entry.row.settingDeclared !== true) {
      this.announce = "Already using the inherited value.";
      this.status = { kind: "ready", text: this.announce };
      this.paintPropertyEditor();
      return false;
    }
    if (settingId === "parent") {
      this.refusal = { code: "locked", message: "Lives under is required; Bob will not clear this setting." };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.paintPropertyEditor();
      return false;
    }
    if (this.report && this.report.note_kind === "reference"
      && (settingId === "title" || settingId === "source")) {
      this.refusal = {
        code: "locked",
        message: settingId === "title"
          ? "Title is set-only; clear it through YAML only when recovery requires it."
          : "Source is set-only; replace it instead of clearing it.",
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.paintPropertyEditor();
      return false;
    }
    this.propertyEditorCancelStage({ quiet: true });
    this.selectedId = entry.id;
    return propertyEditorSettingsDelete(this);
  },

  propertyEditorStageView() {
    const view = propertyEditorStageViewBeforeSettingActions.call(this);
    const stage = this.stage;
    if (!view || !stage || !stage.settingId) return view;
    view.settingId = stage.settingId;
    view.settingStage = stage.settingStage;
    view.key = stage.key;
    view.helpNote = stage.settingStage === "review" ? PROPERTY_EDITOR_REVIEW_HELP : "";
    view.off = stage.off === true;
    if (stage.settingStage === "summary") {
      const length = String(stage.value || "").length;
      view.counter = `${length}/${PROPERTY_EDITOR_SUMMARY_LIMIT}`;
      view.warnLong = length > PROPERTY_EDITOR_SUMMARY_LIMIT;
      view.prose = false;
      view.collection = false;
      view.kind = "text";
      if (stage.summaryFoldNote) view.helpNote = String(stage.summaryFoldNote);
    }
    if (stage.settingStage === "ready-cap") {
      view.effectLine = propertyEditorSettingReadyCapEffectLine(
        this.propertyEditorStageFindRow(stage),
        stage.off ? "off" : stage.value,
        this.propertyPlugin,
        this.filePath,
      );
      view.prose = false;
    }
    if (stage.settingId === "parent") view.prose = true;
    if (["color", "task_type", "clock"].includes(stage.settingId)) view.prose = false;
    const state = this.session && typeof this.session.getState === "function" ? this.session.getState() : this.sessionState;
    if (state && state.preview && state.preview.dry_run !== false && state.status === "preview-ready") {
      view.previewExtras = propertyEditorSettingPreviewText(state.preview, stage.settingId, [view.helpNote]);
    }
    return view;
  },

  propertyEditorBuildCurrentStage() {
    if (this.stage && this.stage.settingId) {
      const entry = this.propertyEditorStageFindRow();
      if (!entry) return { ok: false, message: "The setting is no longer available." };
      return propertyEditorSettingStageBuild(entry, this.stage, this.propertyEditorCurrentStageDraft());
    }
    return propertyEditorBuildBeforeSettingActions.call(this);
  },

  propertyEditorStagePreviewText(built) {
    const base = propertyEditorPreviewTextBeforeSettingActions.call(this, built);
    if (!this.stage || !this.stage.settingId) return base;
    const extras = [];
    if (built && built.warnLong === true) extras.push(`Over ${PROPERTY_EDITOR_SUMMARY_LIMIT} characters — Bob will warn without blocking.`);
    // Review's residence scope is the stage help line; it is not repeated here.
    return [base, ...extras].filter(Boolean).join(" · ");
  },

  propertyEditorStageSyncPreview() {
    return propertyEditorSyncPreviewBeforeSettingActions.call(this);
  },

  propertyEditorStageInputChanged(input) {
    if (this.stage && this.stage.settingStage === "ready-cap") {
      const text = String(input && input.value || "").trim().toLowerCase();
      this.stage.off = text === "off";
    }
    return propertyEditorInputBeforeSettingActions.call(this, input);
  },

  propertyEditorStepSetting(delta) {
    if (!this.stage) return false;
    if (this.stage.settingStage === "ready-cap") {
      if (this.stage.off) {
        this.stage.off = false;
        this.stage.value = String(PROPERTY_EDITOR_READY_CAP_MIN);
      } else {
        const current = Number(this.stage.value) || PROPERTY_EDITOR_READY_CAP_MIN;
        const next = Math.min(PROPERTY_EDITOR_READY_CAP_MAX, Math.max(PROPERTY_EDITOR_READY_CAP_MIN, current + delta));
        this.stage.value = String(next);
      }
    } else if (this.stage.settingStage === "review") {
      const current = Number(this.stage.value) || PROPERTY_EDITOR_REVIEW_MIN;
      this.stage.value = String(Math.min(PROPERTY_EDITOR_REVIEW_MAX, Math.max(PROPERTY_EDITOR_REVIEW_MIN, current + delta)));
    } else return false;
    this.stage.revision += 1;
    this.pendingStageEnter = null;
    this.propertyEditorStageInputChanged({
      value: this.stage.off ? "off" : this.stage.value,
      getAttribute: (name) => name === "data-property-stage-kind" ? this.stage.kind : String(this.stage.id),
    });
    return true;
  },

  propertyEditorToggleReadyCapOff() {
    if (!this.stage || this.stage.settingStage !== "ready-cap") return false;
    this.stage.off = this.stage.off !== true;
    if (this.stage.off) this.stage.value = "off";
    else if (!this.stage.value || this.stage.value === "off") this.stage.value = String(PROPERTY_EDITOR_READY_CAP_MIN);
    this.stage.revision += 1;
    this.pendingStageEnter = null;
    this.propertyEditorStageInputChanged({
      value: this.stage.off ? "off" : this.stage.value,
      getAttribute: (name) => name === "data-property-stage-kind" ? this.stage.kind : String(this.stage.id),
    });
    return true;
  },

  propertyEditorOnClick(event) {
    const action = event?.target?.closest?.("[data-property-stage-action]")?.getAttribute?.("data-property-stage-action");
    if (this.stage && action === "step-up") {
      event?.preventDefault?.();
      return this.propertyEditorStepSetting(1);
    }
    if (this.stage && action === "step-down") {
      event?.preventDefault?.();
      return this.propertyEditorStepSetting(-1);
    }
    if (this.stage && action === "toggle-off") {
      event?.preventDefault?.();
      return this.propertyEditorToggleReadyCapOff();
    }
    return propertyEditorClickBeforeSettingActions.call(this, event);
  },

  propertyEditorOnKeyDown(event) {
    if (this.stage && this.stage.settingId) {
      const inInput = Boolean(event?.target?.closest?.("[data-property-stage-input]"));
      const ctrl = event.ctrlKey === true;
      const meta = event.metaKey === true;
      const alt = event.altKey === true;
      if ((ctrl || meta) && !alt && (event.key === "d" || event.key === "D")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        void this.propertyEditorClearCurrentSetting();
        return;
      }
      if (!ctrl && !meta && !alt && this.stage.settingStage === "ready-cap" && !inInput && (event.key === "o" || event.key === "O")) {
        event.preventDefault?.();
        this.propertyEditorToggleReadyCapOff();
        return;
      }
      if (!ctrl && !meta && !alt && !inInput && (this.stage.settingStage === "ready-cap" || this.stage.settingStage === "review")) {
        if (event.key === "ArrowUp" || event.key === "+") {
          event.preventDefault?.();
          this.propertyEditorStepSetting(1);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "-") {
          event.preventDefault?.();
          this.propertyEditorStepSetting(-1);
          return;
        }
      }
    }
    return propertyEditorKeyBeforeSettingActions.call(this, event);
  },

  async propertyEditorRefreshContract() {
    if (this.closed || this._contractRefreshPending) return;
    if (!this.propertyPlugin || typeof this.propertyPlugin.apiPropertyShow !== "function") return;
    this._contractRefreshPending = true;
    this.status = { kind: "checking", text: "Refreshing settings…" };
    this.paintPropertyEditor();
    let result = null;
    try { result = await this.propertyPlugin.apiPropertyShow(this.filePath); }
    catch (_) { result = null; }
    this._contractRefreshPending = false;
    if (this.closed) return;
    if (result && result.ok === true && result.report) {
      this.contractPending = false;
      this.propertyEditorReconcile(result.report);
      if (!this.stage) this.status = propertyEditorStatusSaved();
    }
    this.paintPropertyEditor();
  },
});
