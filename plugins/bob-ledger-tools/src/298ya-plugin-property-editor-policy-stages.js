// Dedicated Hue, Default type, and Clock policy stages. Each stage edits the
// Bob settings contract through the same preview/apply/undo session as the
// simple settings stages; the controls never write while being browsed.
const PROPERTY_EDITOR_POLICY_INHERIT = "__bob_policy_inherit__";
const PROPERTY_EDITOR_POLICY_HUES = Object.freeze([
  "blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red", "grey",
]);
const PROPERTY_EDITOR_POLICY_HUE_KEYS = Object.freeze({
  inherit: "i", blue: "b", orange: "o", aqua: "a", yellow: "y",
  magenta: "m", green: "g", violet: "v", red: "r", grey: "e",
});
const PROPERTY_EDITOR_POLICY_CLOCK_MODES = Object.freeze(["inherit", "on", "off", "types"]);

function propertyEditorPolicyHue(value) {
  const hue = String(value == null ? "" : value).trim().toLowerCase();
  if (hue === "gray") return "grey";
  return PROPERTY_EDITOR_POLICY_HUES.includes(hue) ? hue : "";
}

function propertyEditorPolicyChoices(row) {
  return (Array.isArray(row && row.settingChoices) ? row.settingChoices : [])
    .filter((choice) => choice && typeof choice.id === "string" && choice.id)
    .map((choice) => ({
      id: choice.id,
      label: typeof choice.label === "string" && choice.label ? choice.label : choice.id,
      hue: propertyEditorPolicyHue(choice.hue),
      used_by: Array.isArray(choice.used_by) ? choice.used_by.filter((item) => typeof item === "string") : [],
    }));
}

function propertyEditorPolicyTypeCatalog(modal) {
  const settings = modal && modal.report && modal.report.contract && modal.report.contract.settings;
  const setting = Array.isArray(settings) ? settings.find((item) => item && item.id === "task_type") : null;
  return propertyEditorPolicyChoices({ settingChoices: setting && setting.choices });
}

function propertyEditorPolicyLegacyTheme(modal) {
  const rows = Array.isArray(modal && modal.report && modal.report.properties) ? modal.report.properties : [];
  return rows.some((row) => row && row.key === "theme")
    && !rows.some((row) => row && row.key === "task_type");
}

function propertyEditorPolicyShadowedClock(modal, entry) {
  const row = entry && entry.row;
  const issues = Array.isArray(row && row.issues) ? row.issues : [];
  const warnings = Array.isArray(modal && modal.report && modal.report.warnings) ? modal.report.warnings : [];
  if ([...issues, ...warnings].some((item) => item && /shadowed/i.test(`${item.code || ""} ${item.message || ""}`))) return true;
  const rows = Array.isArray(modal && modal.report && modal.report.properties) ? modal.report.properties : [];
  const offclock = rows.find((item) => item && item.key === "offclock");
  const types = rows.find((item) => item && item.key === "offclock_types");
  const hasBoolean = offclock && typeof offclock.value === "boolean";
  const typeItems = Array.isArray(types && types.value)
    ? types.value.filter((item) => String(item || "").trim())
    : typeof (types && types.value) === "string" ? [types.value.trim()].filter(Boolean) : [];
  return Boolean(hasBoolean && typeItems.length);
}

function propertyEditorPolicyTypeChoices(stage, query = "") {
  const entries = [
    { id: PROPERTY_EDITOR_POLICY_INHERIT, value: PROPERTY_EDITOR_POLICY_INHERIT, label: "Inherit", kind: "inherit" },
    { id: "off", value: "off", label: "off · Stop parent defaults", kind: "off" },
    ...(Array.isArray(stage && stage.policyChoices) ? stage.policyChoices.map((choice) => ({
      id: choice.id, value: choice.id, label: choice.label, hue: choice.hue, used_by: choice.used_by, kind: "type",
    })) : []),
  ];
  const current = String(stage && stage.value != null ? stage.value : "");
  if (current && current !== "off" && current !== PROPERTY_EDITOR_POLICY_INHERIT
    && !entries.some((entry) => entry.value === current)) {
    entries.push({ id: `existing:${current}`, value: current, label: `Unconfigured · ${current}`, kind: "unconfigured", custom: true });
  }
  const needle = String(query || "").trim().toLocaleLowerCase();
  const filtered = needle
    ? entries.filter((entry) => `${entry.label} ${entry.value}`.toLocaleLowerCase().includes(needle))
    : entries;
  if (needle && !entries.some((entry) => entry.value.toLocaleLowerCase() === needle)) {
    filtered.push({ id: `typed:${needle}`, value: String(query).trim(), label: `Use “${String(query).trim()}”`, kind: "typed", custom: true });
  }
  return filtered;
}

function propertyEditorPolicyClockTypes(stage) {
  const choices = Array.isArray(stage && stage.policyClockChoices) ? stage.policyClockChoices.slice() : [];
  const seen = new Set(choices.map((choice) => choice.id));
  for (const value of Array.isArray(stage && stage.clockTypes) ? stage.clockTypes : []) {
    const name = String(value || "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      choices.push({ id: name, label: name, hue: "", used_by: [], custom: true });
    }
  }
  return choices;
}

function propertyEditorPolicyClockSentence(mode, types = []) {
  if (mode === "on") return "Clock time stays on the clock for every type.";
  if (mode === "off") return "Clock time stays off the clock for every type.";
  if (mode === "types") {
    const names = Array.isArray(types) ? types.map((item) => String(item || "").trim()).filter(Boolean) : [];
    return names.length
      ? `Clock time stays off the clock for ${names.join(", ")}; other types stay on the clock.`
      : "Choose one or more types to keep off the clock.";
  }
  return "Inherit the clock policy from this note’s home and Bob’s defaults.";
}

function propertyEditorPolicyStageMode(stage) {
  if (stage && stage.settingStage === "hue") return "hue";
  if (stage && stage.settingStage === "type-picker") return "type";
  if (stage && stage.settingStage === "clock-policy") return "clock";
  return "";
}

function propertyEditorPolicyStageInit(modal, entry, stage) {
  const kind = propertyEditorPolicyStageMode(stage);
  if (!kind) return stage;
  stage.policyChoices = propertyEditorPolicyChoices(entry && entry.row);
  stage.policyWarning = String(entry && entry.row && entry.row.warning || "");
  stage.policyLegacyTheme = kind === "type" && propertyEditorPolicyLegacyTheme(modal);
  stage.policyShadowedClock = kind === "clock" && propertyEditorPolicyShadowedClock(modal, entry);
  stage.policyChoiceIndex = 0;
  if (kind === "hue") {
    const raw = entry && entry.row && entry.row.settingDeclared === true
      ? entry.row.settingValue : PROPERTY_EDITOR_POLICY_INHERIT;
    stage.value = propertyEditorPolicyHue(raw) || PROPERTY_EDITOR_POLICY_INHERIT;
    stage.policyEffectiveHue = propertyEditorPolicyHue(entry && entry.row && entry.row.effectiveValue);
  } else if (kind === "type") {
    const legacyTheme = Array.isArray(modal && modal.report && modal.report.properties)
      ? modal.report.properties.find((row) => row && row.key === "theme") : null;
    const raw = entry && entry.row && entry.row.settingDeclared === true
      ? entry.row.settingValue
      : legacyTheme ? legacyTheme.value : PROPERTY_EDITOR_POLICY_INHERIT;
    if (raw == null || String(raw) === "" || raw === PROPERTY_EDITOR_POLICY_INHERIT) stage.value = PROPERTY_EDITOR_POLICY_INHERIT;
    else {
      const text = String(raw);
      const normalized = text.toLocaleLowerCase();
      const match = stage.policyChoices.find((choice) => choice.id.toLocaleLowerCase() === normalized
        || choice.label.toLocaleLowerCase() === normalized);
      stage.value = match ? match.id : text;
    }
  } else {
    const raw = propertyEditorSettingSeedValue(entry);
    const parsed = propertyEditorSettingClockObject(raw);
    const clock = parsed && parsed.ok ? parsed.value : { mode: "inherit", types: [] };
    stage.clockMode = clock.mode;
    stage.clockTypes = Array.isArray(clock.types) ? clock.types.slice() : [];
    stage.policyClockChoices = propertyEditorPolicyTypeCatalog(modal);
    stage.value = "";
  }
  return stage;
}

function propertyEditorPolicyStageBuild(entry, stage) {
  const kind = propertyEditorPolicyStageMode(stage);
  if (!entry || !kind) return { ok: false, message: "This policy setting cannot be edited here." };
  const row = entry.row || {};
  const current = propertyEditorSettingSeedValue(entry);
  const declared = row.settingDeclared === true;
  let value;
  let changed;
  let ops;
  if (kind === "hue") {
    const selected = stage.value === PROPERTY_EDITOR_POLICY_INHERIT
      ? PROPERTY_EDITOR_POLICY_INHERIT : propertyEditorPolicyHue(stage.value);
    if (!selected) return { ok: false, message: "Choose a palette hue, grey, or Inherit." };
    if (selected === PROPERTY_EDITOR_POLICY_INHERIT) {
      changed = row.settingDeclared === true;
      value = null;
      ops = changed ? [propertyEditorSettingClearOp("color")] : [];
    } else {
      value = selected;
      changed = !declared || propertyEditorPolicyHue(row.settingValue) !== selected;
      ops = changed ? [propertyEditorSettingSetOp("color", selected)] : [];
    }
  } else if (kind === "type") {
    const selected = String(stage.value == null ? "" : stage.value);
    if (!selected) return { ok: false, message: "Choose Inherit, off, or a type." };
    if (selected === PROPERTY_EDITOR_POLICY_INHERIT) {
      changed = row.settingDeclared === true;
      value = null;
      ops = changed ? [propertyEditorSettingClearOp("task_type")] : [];
    } else {
      value = selected;
      changed = !declared || String(row.settingValue == null ? "" : row.settingValue) !== selected
        || stage.policyLegacyTheme === true;
      ops = changed ? [propertyEditorSettingSetOp("task_type", selected)] : [];
    }
  } else {
    const mode = PROPERTY_EDITOR_POLICY_CLOCK_MODES.includes(stage.clockMode) ? stage.clockMode : "inherit";
    const types = [...new Set((Array.isArray(stage.clockTypes) ? stage.clockTypes : [])
      .map((item) => String(item || "").trim()).filter(Boolean))];
    if (mode === "types" && !types.length) {
      return { ok: false, message: "Choose at least one type for the off-clock policy." };
    }
    value = mode === "types" ? { mode, types } : { mode };
    const parsed = propertyEditorSettingClockObject(current);
    const normalized = parsed && parsed.ok ? parsed.value : null;
    changed = !declared || stage.policyShadowedClock === true || !normalized
      || JSON.stringify(normalized) !== JSON.stringify(value);
    ops = changed ? [propertyEditorSettingSetOp("clock", value)] : [];
  }
  return { ok: true, value, changed, ops };
}

function propertyEditorPolicyHueAccelerator(key) {
  const value = String(key || "").toLowerCase();
  return Object.entries(PROPERTY_EDITOR_POLICY_HUE_KEYS).find(([, accelerator]) => accelerator === value)?.[0] || "";
}

function propertyEditorPolicyClockChoice(modal, settingId, selected) {
  if (settingId === "clock") {
    return {
      mode: selected,
      types: selected === "types" && Array.isArray(modal && modal.stage && modal.stage.clockTypes)
        ? modal.stage.clockTypes.slice() : [],
    };
  }
  return selected;
}

function propertyEditorPolicyPreviewHue(stage) {
  if (!stage || stage.settingStage !== "hue") return "";
  if (stage.value !== PROPERTY_EDITOR_POLICY_INHERIT) return propertyEditorPolicyHue(stage.value);
  return propertyEditorPolicyHue(stage.policyEffectiveHue);
}

function propertyEditorPolicyApplyHeaderPreview(modal, stage) {
  try {
    const header = modal && modal.contentEl && modal.contentEl.querySelector(".bob-property-editor-header");
    if (!header) return;
    const hue = propertyEditorPolicyPreviewHue(stage);
    if (hue) header.setAttribute("data-policy-preview-hue", hue);
    else header.removeAttribute("data-policy-preview-hue");
  } catch (_) {}
}

function propertyEditorPolicyStageUpdate(modal, options = {}) {
  if (!modal || modal.closed || !modal.stage || modal.pendingApply) return false;
  const stage = modal.stage;
  stage.revision = (Number(stage.revision) || 0) + 1;
  modal.pendingStageEnter = null;
  modal.stageNeedsPreview = false;
  const built = propertyEditorPolicyStageBuild(modal.propertyEditorStageFindRow(stage), stage);
  const session = modal.editorEnsureSession();
  if (!built.ok) {
    try { session?.setDraft?.([]); } catch (_) {}
    modal.refusal = { code: "bad-stage-value", message: built.message, hint: "Choose a valid policy or use Ctrl+D to inherit." };
    modal.status = { kind: "refusal", text: built.message };
    stage.previewText = built.message;
  } else if (!built.changed) {
    try { session?.setDraft?.([]); } catch (_) {}
    modal.refusal = null;
    modal.status = { kind: "ready", text: "" };
    stage.previewText = "No changes · Esc returns to properties";
  } else {
    modal.refusal = null;
    modal.status = propertyEditorStatusChecking();
    stage.previewText = modal.propertyEditorStagePreviewText(built);
    try { session?.setDraft?.(built.ops); } catch (_) {}
  }
  modal.sessionState = session?.getState?.() || modal.sessionState;
  if (options.paint !== false) modal.paintPropertyEditor();
  return built;
}

function propertyEditorPolicyStageOptionRows(options) {
  const mode = options && options.policyKind;
  if (mode === "hue") {
    return [
      { value: PROPERTY_EDITOR_POLICY_INHERIT, label: "Inherit", hue: "", used_by: [] },
      ...(Array.isArray(options.policyChoices) ? options.policyChoices : []).map((choice) => ({
        value: choice.id, label: choice.label, hue: choice.hue, used_by: choice.used_by,
      })),
    ];
  }
  if (mode === "type") return propertyEditorPolicyTypeChoices(options.stage, options.filterQuery);
  return [];
}

function propertyEditorPolicyButton(doc, label, attributes = {}, className = "bob-property-editor-policy-choice") {
  const button = propertyEditorCreateEl(doc, "button", className);
  button.setAttribute("type", "button");
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) button.setAttribute(name, String(value));
  }
  propertyEditorSetText(button, label);
  return button;
}

function propertyEditorPolicyPaintCommon(doc, panel, options) {
  propertyEditorPaintSettingNotes(doc, panel, options);
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  propertyEditorPaintSettingActions(doc, panel, options);
}

function propertyEditorPaintPolicyStage(doc, host, options, modal) {
  const mode = options && options.policyKind;
  const panel = propertyEditorCreateEl(doc, "section", `bob-property-editor-stage is-setting is-policy is-${mode}`);
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("data-setting-id", options.settingId || "");
  panel.setAttribute("aria-label", `Edit ${options.key}`);
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, `${options.settingId} · ${options.key}`);
  panel.appendChild(title);

  if (mode === "hue") {
    const swatches = propertyEditorCreateEl(doc, "div", "bob-property-editor-policy-swatches");
    for (const choice of propertyEditorPolicyStageOptionRows(options)) {
      const isInherit = choice.value === PROPERTY_EDITOR_POLICY_INHERIT;
      const label = isInherit ? "Inherit" : `● ${choice.label}${choice.used_by && choice.used_by.length ? ` · ${choice.used_by.join(", ")}` : ""}`;
      const button = propertyEditorPolicyButton(doc, label, {
        "data-property-policy-choice": choice.value,
        "aria-pressed": options.value === choice.value ? "true" : "false",
        "aria-label": isInherit ? "Inherit hue" : `${choice.label}${choice.used_by && choice.used_by.length ? `, used by ${choice.used_by.join(", ")}` : ""}`,
        "data-root-hue": isInherit ? "" : choice.hue || choice.value,
      }, "bob-property-editor-policy-choice bob-property-editor-policy-swatch");
      if (choice.used_by && choice.used_by.length) button.setAttribute("title", `Used by: ${choice.used_by.join(", ")}`);
      swatches.appendChild(button);
    }
    panel.appendChild(swatches);
    propertyEditorPolicyApplyHeaderPreview(modal, options.stage);
  } else if (mode === "type") {
    const filterId = `bob-property-editor-stage-input-${options.stageId}`;
    // bob-text: literal configured type search
    const filter = options.keptInput || propertyEditorCreateEl(doc, "input", "bob-property-editor-stage-input is-policy-filter");
    filter.setAttribute("type", "text");
    filter.setAttribute("id", filterId);
    filter.setAttribute("data-property-stage-input", `property-stage-${options.stageId}`);
    filter.setAttribute("data-property-stage-id", String(options.stageId));
    filter.setAttribute("data-property-stage-kind", "text");
    filter.setAttribute("data-property-policy-filter", "true");
    filter.setAttribute("aria-label", "Filter configured types");
    if (!options.keptInput) filter.value = options.filterQuery || "";
    else if (!options.composing && String(filter.value || "") !== String(options.filterQuery || "")) filter.value = options.filterQuery || "";
    if (options.disabled) filter.disabled = true;
    panel.appendChild(filter);
    const choices = propertyEditorCreateEl(doc, "div", "bob-property-editor-policy-types");
    for (const [index, choice] of propertyEditorPolicyStageOptionRows(options).entries()) {
      const current = options.value === choice.value;
      const label = choice.hue
        ? `● ${choice.label}${choice.kind === "inherit" || choice.kind === "off" ? "" : ` · ${choice.value}`}`
        : choice.label;
      const button = propertyEditorPolicyButton(doc, label, {
        "data-property-policy-choice": choice.value,
        "aria-pressed": current ? "true" : "false",
        "aria-selected": options.policyChoiceIndex === index ? "true" : "false",
        "data-root-hue": choice.hue || "",
      }, "bob-property-editor-policy-choice bob-property-editor-policy-type");
      choices.appendChild(button);
    }
    panel.appendChild(choices);
  } else {
    const modes = propertyEditorCreateEl(doc, "div", "bob-property-editor-policy-modes");
    const labels = { inherit: "Inherit", on: "On", off: "Off", types: "Off for types…" };
    for (const clockMode of PROPERTY_EDITOR_POLICY_CLOCK_MODES) {
      modes.appendChild(propertyEditorPolicyButton(doc, labels[clockMode], {
        "data-property-policy-clock-mode": clockMode,
        "aria-pressed": options.clockMode === clockMode ? "true" : "false",
      }, "bob-property-editor-policy-choice bob-property-editor-policy-mode"));
    }
    panel.appendChild(modes);
    if (options.clockMode === "types") {
      const types = propertyEditorCreateEl(doc, "div", "bob-property-editor-policy-types");
      for (const choice of options.clockChoices || []) {
        types.appendChild(propertyEditorPolicyButton(doc, choice.label, {
          "data-property-policy-clock-type": choice.id,
          "aria-checked": options.clockTypes.includes(choice.id) ? "true" : "false",
          role: "checkbox",
          "data-root-hue": choice.hue || "",
        }, "bob-property-editor-policy-choice bob-property-editor-policy-type is-clock-type"));
      }
      panel.appendChild(types);
    }
  }
  propertyEditorPolicyPaintCommon(doc, panel, options);
  host.appendChild(panel);
  return { panel, input: mode === "type" ? panel.querySelector?.("[data-property-policy-filter]") || null : null, band: null };
}

propertyEditorRegisterSettingStageHandler("color", { kind: "hue", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("task_type", { kind: "type-picker", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("clock", { kind: "clock-policy", wireKind: "text" });

const propertyEditorSettingOpenDraftBeforePolicy = propertyEditorSettingOpenDraft;
propertyEditorSettingOpenDraft = function propertyEditorSettingOpenDraftWithPolicy(modal, entry, handler) {
  const result = propertyEditorSettingOpenDraftBeforePolicy(modal, entry, handler);
  if (result && result.ok === true && result.stage) propertyEditorPolicyStageInit(modal, entry, result.stage);
  return result;
};

const propertyEditorBuildCurrentStageBeforePolicy = PropertyEditorModal.prototype.propertyEditorBuildCurrentStage;
PropertyEditorModal.prototype.propertyEditorBuildCurrentStage = function propertyEditorBuildCurrentStageWithPolicy() {
  if (propertyEditorPolicyStageMode(this.stage)) {
    return propertyEditorPolicyStageBuild(this.propertyEditorStageFindRow(this.stage), this.stage);
  }
  return propertyEditorBuildCurrentStageBeforePolicy.call(this);
};

const propertyEditorStageViewBeforePolicy = PropertyEditorModal.prototype.propertyEditorStageView;
PropertyEditorModal.prototype.propertyEditorStageView = function propertyEditorStageViewWithPolicy() {
  const view = propertyEditorStageViewBeforePolicy.call(this);
  const stage = this.stage;
  const kind = propertyEditorPolicyStageMode(stage);
  if (!view || !kind) return view;
  const entry = this.propertyEditorStageFindRow(stage);
  view.policyKind = kind;
  view.settingId = stage.settingId;
  view.stage = stage;
  view.value = stage.value;
  view.policyChoices = kind === "hue" ? propertyEditorPolicyChoices(entry && entry.row)
    : kind === "type" ? propertyEditorPolicyTypeChoices(stage, stage.filterQuery)
      : [];
  view.filterQuery = String(stage.filterQuery || "");
  view.policyChoiceIndex = Number.isInteger(stage.policyChoiceIndex) ? stage.policyChoiceIndex : 0;
  view.clockMode = stage.clockMode || "inherit";
  view.clockTypes = Array.isArray(stage.clockTypes) ? stage.clockTypes.slice() : [];
  view.clockChoices = kind === "clock" ? propertyEditorPolicyClockTypes(stage) : [];
  if (kind === "clock") view.helpNote = propertyEditorPolicyClockSentence(stage.clockMode, stage.clockTypes);
  if (kind === "type") view.helpNote = [view.helpNote, "Inherit clears this note’s default; off stops parent defaults."].filter(Boolean).join(" ");
  if (stage.policyLegacyTheme) view.effectLine = "Saving migrates legacy theme to task_type.";
  const diagnostics = [stage.policyWarning, view.previewExtras].filter(Boolean);
  view.previewExtras = [...new Set(diagnostics)].join(" · ");
  if (kind === "hue") view.previewHue = propertyEditorPolicyPreviewHue(stage);
  return view;
};

const propertyEditorPaintStageBeforePolicy = propertyEditorPaintStage;
propertyEditorPaintStage = function propertyEditorPaintStageWithPolicy(doc, host, options, modal) {
  if (options && ["hue", "type", "clock"].includes(options.policyKind)) {
    return propertyEditorPaintPolicyStage(doc, host, options, modal);
  }
  return propertyEditorPaintStageBeforePolicy(doc, host, options, modal);
};

const propertyEditorResolveSettingStageBeforePolicy = PropertyEditorModal.prototype.propertyEditorResolveSettingStage;
PropertyEditorModal.prototype.propertyEditorResolveSettingStage = function propertyEditorResolveSettingStageWithPolicy(entry) {
  const result = propertyEditorResolveSettingStageBeforePolicy.call(this, entry);
  if (result && result.ok === true && this.stage && this.stage.settingStage === "clock-policy"
    && this.stage.policyShadowedClock === true) {
    propertyEditorPolicyStageUpdate(this, { paint: false });
    this.stage.previewText = "Shadowed clock keys will be cleaned in one save · Enter saves";
  }
  return result;
};

const propertyEditorStagePreviewTextBeforePolicy = PropertyEditorModal.prototype.propertyEditorStagePreviewText;
PropertyEditorModal.prototype.propertyEditorStagePreviewText = function propertyEditorStagePreviewTextWithPolicy(built) {
  const text = propertyEditorStagePreviewTextBeforePolicy.call(this, built);
  if (this.stage && this.stage.settingStage === "clock-policy" && this.stage.policyShadowedClock) {
    return ["Keep the effective clock policy and remove the shadowed key", text].filter(Boolean).join(" · ");
  }
  return text;
};

const propertyEditorStageInputChangedBeforePolicy = PropertyEditorModal.prototype.propertyEditorStageInputChanged;
PropertyEditorModal.prototype.propertyEditorStageInputChanged = function propertyEditorStageInputChangedWithPolicy(input) {
  if (this.stage && this.stage.settingStage === "type-picker"
    && input && input.getAttribute && input.getAttribute("data-property-policy-filter") === "true") {
    this.stage.filterQuery = String(input.value || "");
    this.stage.policyChoiceIndex = 0;
    const caret = typeof input.selectionStart === "number" ? { start: input.selectionStart, end: input.selectionEnd } : null;
    this.paintPropertyEditor();
    this.stage.caret = caret;
    return;
  }
  return propertyEditorStageInputChangedBeforePolicy.call(this, input);
};

function propertyEditorPolicyStageChoose(modal, value) {
  if (!modal || !modal.stage) return false;
  const stage = modal.stage;
  const kind = propertyEditorPolicyStageMode(stage);
  if (kind === "hue") {
    stage.value = value === PROPERTY_EDITOR_POLICY_INHERIT ? value : propertyEditorPolicyHue(value);
    if (!stage.value) return false;
  } else if (kind === "type") {
    stage.value = String(value == null ? "" : value);
  } else return false;
  return propertyEditorPolicyStageUpdate(modal);
}

function propertyEditorPolicyClockSetMode(modal, mode) {
  if (!modal || !modal.stage || modal.stage.settingStage !== "clock-policy"
    || !PROPERTY_EDITOR_POLICY_CLOCK_MODES.includes(mode)) return false;
  modal.stage.clockMode = mode;
  return propertyEditorPolicyStageUpdate(modal);
}

function propertyEditorPolicyClockToggleType(modal, type) {
  if (!modal || !modal.stage || modal.stage.settingStage !== "clock-policy") return false;
  const value = String(type || "").trim();
  if (!value) return false;
  const selected = new Set(Array.isArray(modal.stage.clockTypes) ? modal.stage.clockTypes : []);
  if (selected.has(value)) selected.delete(value); else selected.add(value);
  modal.stage.clockTypes = [...selected];
  modal.stage.clockMode = "types";
  return propertyEditorPolicyStageUpdate(modal);
}

function propertyEditorPolicyCycleStage(modal, delta) {
  const stage = modal && modal.stage;
  const kind = propertyEditorPolicyStageMode(stage);
  if (kind === "hue") {
    const choices = [PROPERTY_EDITOR_POLICY_INHERIT, ...propertyEditorPolicyChoices(modal.propertyEditorStageFindRow(stage).row).map((choice) => choice.id)];
    const current = choices.indexOf(stage.value);
    return propertyEditorPolicyStageChoose(modal, choices[(Math.max(0, current) + delta + choices.length) % choices.length]);
  }
  if (kind === "type") {
    const choices = propertyEditorPolicyTypeChoices(stage, stage.filterQuery);
    if (!choices.length) return false;
    const current = choices.findIndex((choice) => choice.value === stage.value);
    const next = choices[(Math.max(-1, current) + delta + choices.length) % choices.length];
    stage.policyChoiceIndex = choices.indexOf(next);
    return propertyEditorPolicyStageChoose(modal, next.value);
  }
  if (kind === "clock") {
    const index = PROPERTY_EDITOR_POLICY_CLOCK_MODES.indexOf(stage.clockMode);
    const next = PROPERTY_EDITOR_POLICY_CLOCK_MODES[(Math.max(0, index) + delta + PROPERTY_EDITOR_POLICY_CLOCK_MODES.length) % PROPERTY_EDITOR_POLICY_CLOCK_MODES.length];
    return propertyEditorPolicyClockSetMode(modal, next);
  }
  return false;
}

const propertyEditorClickBeforePolicy = PropertyEditorModal.prototype.propertyEditorOnClick;
PropertyEditorModal.prototype.propertyEditorOnClick = function propertyEditorOnClickWithPolicy(event) {
  const target = event && event.target && event.target.closest && event.target.closest(
    "[data-property-policy-choice], [data-property-policy-clock-mode], [data-property-policy-clock-type]",
  );
  if (target && this.stage && propertyEditorPolicyStageMode(this.stage)) {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (target.hasAttribute?.("data-property-policy-clock-mode")) {
      return propertyEditorPolicyClockSetMode(this, target.getAttribute("data-property-policy-clock-mode"));
    }
    if (target.hasAttribute?.("data-property-policy-clock-type")) {
      return propertyEditorPolicyClockToggleType(this, target.getAttribute("data-property-policy-clock-type"));
    }
    return propertyEditorPolicyStageChoose(this, target.getAttribute("data-property-policy-choice"));
  }
  return propertyEditorClickBeforePolicy.call(this, event);
};

const propertyEditorKeyBeforePolicy = PropertyEditorModal.prototype.propertyEditorOnKeyDown;
PropertyEditorModal.prototype.propertyEditorOnKeyDown = function propertyEditorOnKeyDownWithPolicy(event) {
  const stage = this.stage;
  const kind = propertyEditorPolicyStageMode(stage);
  if (!stage || !kind || event?.isComposing || event?.keyCode === 229 || this.stageComposing) {
    return propertyEditorKeyBeforePolicy.call(this, event);
  }
  if (event.key === "Escape" || event.ctrlKey || event.metaKey || event.altKey) {
    return propertyEditorKeyBeforePolicy.call(this, event);
  }
  const filter = event.target?.closest?.("[data-property-policy-filter]");
  if (filter && kind === "type") {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault?.();
      const choices = propertyEditorPolicyTypeChoices(stage, stage.filterQuery);
      if (choices.length) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        stage.policyChoiceIndex = (Math.max(0, Number(stage.policyChoiceIndex) || 0) + delta + choices.length) % choices.length;
        this.paintPropertyEditor();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault?.();
      event.stopPropagation?.();
      const choices = propertyEditorPolicyTypeChoices(stage, stage.filterQuery);
      const choice = choices[stage.policyChoiceIndex] || choices.find((item) => item.value.toLocaleLowerCase() === String(stage.filterQuery || "").trim().toLocaleLowerCase());
      if (!choice) return;
      propertyEditorPolicyStageChoose(this, choice.value);
      void this.propertyEditorSaveStage();
      return;
    }
    return propertyEditorKeyBeforePolicy.call(this, event);
  }
  if (kind === "hue" && event.key.length === 1) {
    const hue = propertyEditorPolicyHueAccelerator(event.key);
    if (hue) {
      event.preventDefault?.();
      propertyEditorPolicyStageChoose(this, hue === "inherit" ? PROPERTY_EDITOR_POLICY_INHERIT : hue);
      return;
    }
  }
  if (kind === "clock" && event.key === " "
    && event.target?.closest?.("[data-property-policy-clock-type]")) {
    event.preventDefault?.();
    propertyEditorPolicyClockToggleType(this, event.target.closest("[data-property-policy-clock-type]").getAttribute("data-property-policy-clock-type"));
    return;
  }
  if (["ArrowRight", "ArrowDown"].includes(event.key)) {
    event.preventDefault?.();
    propertyEditorPolicyCycleStage(this, 1);
    return;
  }
  if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
    event.preventDefault?.();
    propertyEditorPolicyCycleStage(this, -1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault?.();
    event.stopPropagation?.();
    void this.propertyEditorSaveStage();
    return;
  }
  return propertyEditorKeyBeforePolicy.call(this, event);
};
