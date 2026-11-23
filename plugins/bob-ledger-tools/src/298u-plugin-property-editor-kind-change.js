// Local kind conversion and explicit vault type changes for the native
// property editor parity phase (kind-change). `t` opens a conversion
// stage: current kind/value, a destination, and a converted preview.
// Note-local writes use prop.set (or the YAML stage for maps) and never
// mutate the vault type catalog. Vault-wide type changes are a separate
// confirmation through a feature-detected metadataTypeManager.
const PROPERTY_EDITOR_CONVERT_KINDS = [
  "text", "number", "checkbox", "date", "datetime", "list", "tags", "aliases", "map",
];
const PROPERTY_EDITOR_CONVERT_KIND_LABELS = {
  text: "Text", number: "Number", checkbox: "Checkbox", date: "Date",
  datetime: "Date & time", list: "List", tags: "Tags", aliases: "Aliases",
  map: "Map / YAML", null: "Empty", opaque: "Opaque",
};
const PROPERTY_EDITOR_CONVERT_CREATED_WARNING =
  "Obsidian's datetime widget can strip offsets. Bob keeps the stored offset style.";
const PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT =
  "Use the All Properties view to change this vault type.";
const PROPERTY_EDITOR_CONVERT_HINTS =
  "j/k move · r rename · t kind · Alt+J/K reorder · Space mark · V range · / filter · Mod+C copy · Mod+V paste · Ctrl+D delete · o/O add · Enter/l open · Enter opens maps as YAML · u undo · y YAML · Esc back";

function propertyEditorConvertKindLabel(kind) {
  const key = String(kind || "").toLowerCase();
  if (PROPERTY_EDITOR_CONVERT_KIND_LABELS[key]) return PROPERTY_EDITOR_CONVERT_KIND_LABELS[key];
  if (!key) return "Value";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function propertyEditorConvertFormatValue(value) {
  if (value === undefined) return "—";
  if (value === null) return "null";
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function propertyEditorConvertWireKind(key, destination) {
  if (destination === "tags" && key !== "tags") return "list";
  if (destination === "aliases" && key !== "aliases") return "list";
  return destination;
}

function propertyEditorConvertWireToObsidianType(kind) {
  switch (String(kind || "").toLowerCase()) {
    case "text": return "text";
    case "number": return "number";
    case "checkbox": return "checkbox";
    case "date": return "date";
    case "datetime": return "datetime";
    case "list": return "multitext";
    case "tags": return "tags";
    case "aliases": return "aliases";
    default: return null;
  }
}

function propertyEditorObsidianTypeLabel(type) {
  switch (String(type || "").toLowerCase()) {
    case "multitext": return "List";
    case "datetime": return "Date & time";
    case "checkbox": return "Checkbox";
    case "text": return "Text";
    case "number": return "Number";
    case "date": return "Date";
    case "tags": return "Tags";
    case "aliases": return "Aliases";
    default: return type ? String(type) : "Unknown";
  }
}

function propertyEditorConvertLooksLikeIsoDateTime(text) {
  const raw = String(text || "").trim();
  if (typeof propertyEditorExplicitIsoDateTime === "function") {
    const explicit = propertyEditorExplicitIsoDateTime(raw);
    if (explicit && !explicit.error) return true;
  }
  if (typeof propertyEditorLocalIsoDateTime === "function") {
    const local = propertyEditorLocalIsoDateTime(raw);
    if (local && !local.error) return true;
  }
  return false;
}

function propertyEditorConvertInferredKind(key, value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) {
    if (key === "tags") return "tags";
    if (key === "aliases") return "aliases";
    return "list";
  }
  if (value && typeof value === "object") return "map";
  const text = String(value);
  if (key === "tags") return "tags";
  if (key === "aliases") return "aliases";
  if (typeof propertyEditorIsoDateParts === "function" && propertyEditorIsoDateParts(text)) return "date";
  if (propertyEditorConvertLooksLikeIsoDateTime(text)) return "datetime";
  return "text";
}

function propertyEditorConvertScalarText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function propertyEditorConvertCurrentKind(row) {
  const reported = String(row && row.kind || "").toLowerCase();
  if (reported && reported !== "null") return reported;
  return propertyEditorConvertInferredKind(row && row.key, row && row.value);
}

function propertyEditorConvertOptions(row, options = {}) {
  return {
    now: options.now,
    timeZone: options.timeZone,
    existingValue: row && row.value,
    existingStyle: row && row.style,
  };
}

function propertyEditorConvertParseDestination(destination, raw, options) {
  const text = raw == null ? "" : raw;
  if (destination === "text") return { ok: true, value: String(text) };
  if (destination === "number") return propertyEditorParseNumber(text);
  if (destination === "checkbox") return propertyEditorParseCheckbox(text);
  if (destination === "date") return propertyEditorDateValue(text, options);
  if (destination === "datetime") return propertyEditorDateTimeValue(text, options);
  if (destination === "list") {
    const item = String(text);
    return { ok: true, value: item === "" ? [] : [item] };
  }
  if (destination === "tags") {
    const tag = propertyEditorNormalizeTag(text);
    return { ok: true, value: tag ? [tag] : [] };
  }
  if (destination === "aliases") {
    const alias = String(text).trim();
    return { ok: true, value: alias ? [alias] : [] };
  }
  return { ok: false, message: "Map and exotic values convert through the YAML stage." };
}

function propertyEditorConvertResult(row, dest, value, extra = {}) {
  const wireKind = propertyEditorConvertWireKind(row.key, dest);
  const reportedKind = propertyEditorConvertInferredKind(row.key, value);
  const currentReported = propertyEditorConvertInferredKind(row.key, row.value);
  const sameValue = typeof propertyEditorJsonEqual === "function"
    ? propertyEditorJsonEqual(row.value, value)
    : row.value === value;
  let reportedKindNote = "";
  if (dest === "tags" && row.key !== "tags") {
    reportedKindNote = "Bob reports tags only on the tags key; this note will show a list.";
  } else if (dest === "aliases" && row.key !== "aliases") {
    reportedKindNote = "Bob reports aliases only on the aliases key; this note will show a list.";
  } else if (reportedKind !== dest) {
    reportedKindNote = `Bob will still report this value as ${propertyEditorConvertKindLabel(reportedKind).toLowerCase()}; the wire cannot force ${propertyEditorConvertKindLabel(dest).toLowerCase()}.`;
  }
  const kindChanged = currentReported !== dest && reportedKind === dest;
  const ops = (!sameValue || kindChanged) ? [{ op: "prop.set", key: row.key, value, kind: wireKind }] : [];
  return {
    ok: true,
    mode: extra.mode || "safe",
    kind: dest,
    wireKind,
    value,
    ops,
    changed: ops.length > 0,
    reportedKind,
    reportedKindNote,
    warning: extra.warning || "",
    message: extra.message || "",
    preview: propertyEditorConvertFormatValue(value),
    destructive: extra.destructive === true,
  };
}

function propertyEditorConvertAuto(row, dest, options) {
  const value = row.value;
  const opts = propertyEditorConvertOptions(row, options);
  const result = (next, extra) => propertyEditorConvertResult(row, dest, next, extra);
  if (dest === "list") {
    if (Array.isArray(value)) return result(value.slice());
    if (value === null || value === undefined) return result([]);
    return result([value]);
  }
  if (dest === "tags" || dest === "aliases") {
    if (Array.isArray(value)) {
      if (!value.every((item) => typeof item === "string" || typeof item === "number")) return null;
      const items = value.map((item) => (
        dest === "tags" ? propertyEditorNormalizeTag(item) : String(item)
      )).filter((item) => item !== "");
      return result(items);
    }
    const text = propertyEditorConvertScalarText(value);
    if (text == null && value !== null && value !== undefined) return null;
    const item = dest === "tags" ? propertyEditorNormalizeTag(text || "") : String(text || "").trim();
    return result(item ? [item] : []);
  }
  if (dest === "text") {
    if (Array.isArray(value)) {
      if (value.length === 1 && (typeof value[0] === "string" || typeof value[0] === "number" || typeof value[0] === "boolean")) {
        return result(String(value[0]));
      }
      return null;
    }
    const text = propertyEditorConvertScalarText(value);
    if (text == null) return null;
    return result(text);
  }
  if (dest === "number") {
    const source = Array.isArray(value) && value.length === 1 ? value[0] : value;
    const text = propertyEditorConvertScalarText(source);
    if (text == null) return null;
    const parsed = propertyEditorParseNumber(text);
    return parsed.ok ? result(parsed.value) : null;
  }
  if (dest === "checkbox") {
    const source = Array.isArray(value) && value.length === 1 ? value[0] : value;
    if (typeof source === "boolean") return result(source);
    const text = propertyEditorConvertScalarText(source);
    if (text == null) return null;
    const parsed = propertyEditorParseCheckbox(text);
    return parsed.ok ? result(parsed.value) : null;
  }
  if (dest === "date") {
    const source = Array.isArray(value) && value.length === 1 ? value[0] : value;
    const text = propertyEditorConvertScalarText(source);
    if (text == null) return null;
    if (propertyEditorConvertLooksLikeIsoDateTime(text)) return null;
    const parsed = propertyEditorDateValue(text, opts);
    return parsed.ok ? result(parsed.value) : null;
  }
  if (dest === "datetime") {
    const source = Array.isArray(value) && value.length === 1 ? value[0] : value;
    const text = propertyEditorConvertScalarText(source);
    if (text == null) return null;
    const parsed = propertyEditorDateTimeValue(text, opts);
    return parsed.ok ? result(parsed.value) : null;
  }
  return null;
}

function propertyEditorConvertSeed(row, dest) {
  const source = Array.isArray(row.value) && row.value.length === 1 ? row.value[0] : row.value;
  const text = propertyEditorConvertScalarText(source);
  if (dest === "date" && text && propertyEditorConvertLooksLikeIsoDateTime(text)) return text.slice(0, 10);
  if (dest === "text" && Array.isArray(row.value) && row.value.length > 1) return "";
  return text == null ? "" : text;
}

function propertyEditorConvertPreview(row, destination, draft = {}, options = {}) {
  if (!row || typeof propertyEditorRoleOf === "function" && propertyEditorRoleOf(row) !== "loose") {
    const decision = typeof propertyEditorActionForRow === "function" ? propertyEditorActionForRow(row) : null;
    return {
      ok: false, code: "locked", mode: "refused",
      message: (decision && decision.reason) || "This property cannot change kind here.",
      hint: "y opens YAML.",
    };
  }
  if (row.opaque === true || row.kind === "opaque") {
    return {
      ok: false, code: "opaque", mode: "refused",
      message: "Opaque values cannot change kind here — y opens YAML.",
      hint: "y opens YAML.",
    };
  }
  const dest = String(destination || "").toLowerCase();
  if (!PROPERTY_EDITOR_CONVERT_KINDS.includes(dest)) {
    return { ok: false, code: "bad-kind", mode: "refused", message: "Choose a property type." };
  }
  const warning = row.key === "created" && dest === "datetime" ? PROPERTY_EDITOR_CONVERT_CREATED_WARNING : "";
  const currentKind = propertyEditorConvertCurrentKind(row);
  if (dest === "map" || currentKind === "map") {
    return {
      ok: true, mode: "yaml", kind: dest, wireKind: "map", value: row.value, ops: [], changed: false,
      warning, message: "Map and exotic values convert through the YAML stage.",
      preview: propertyEditorConvertFormatValue(row.value),
    };
  }
  const opts = propertyEditorConvertOptions(row, options);
  if (draft && draft.touched === true) {
    const parsed = propertyEditorConvertParseDestination(dest, draft.value, opts);
    if (!parsed.ok) {
      return {
        ok: false, mode: "input", kind: dest, message: parsed.message, warning, seed: String(draft.value == null ? "" : draft.value),
      };
    }
    return propertyEditorConvertResult(row, dest, parsed.value, {
      mode: "input", warning,
      destructive: dest === "date" && propertyEditorConvertLooksLikeIsoDateTime(propertyEditorConvertScalarText(row.value) || ""),
    });
  }
  if (dest === currentKind) {
    return {
      ok: true, mode: "noop", kind: dest, wireKind: dest, value: row.value, ops: [], changed: false,
      warning, message: `Already ${propertyEditorConvertKindLabel(dest)}.`,
      preview: propertyEditorConvertFormatValue(row.value),
    };
  }
  const auto = propertyEditorConvertAuto(row, dest, options);
  if (auto && auto.ok === true) return { ...auto, warning: warning || auto.warning };
  const seed = propertyEditorConvertSeed(row, dest);
  const parsedSeed = propertyEditorConvertParseDestination(dest, seed, opts);
  if (parsedSeed.ok && seed !== "") {
    const destructive = dest === "date" && propertyEditorConvertLooksLikeIsoDateTime(propertyEditorConvertScalarText(row.value) || "");
    return {
      ...propertyEditorConvertResult(row, dest, parsedSeed.value, { mode: "input", warning, destructive }),
      seed,
      message: destructive
        ? "Saving as a date drops the time and offset. Edit the date or Save to confirm."
        : `Type a ${propertyEditorConvertKindLabel(dest).toLowerCase()} value, or Save the previewed conversion.`,
    };
  }
  return {
    ok: false, mode: "input", kind: dest, seed, warning,
    message: dest === "text" && Array.isArray(row.value) && row.value.length > 1
      ? "Type the text value; a multi-item list is not collapsed automatically."
      : `Type a ${propertyEditorConvertKindLabel(dest).toLowerCase()} value.`,
  };
}

function propertyEditorConvertStageBuild(stage, draft, row, options) {
  if (!stage || stage.convert !== true) {
    return { ok: false, message: "There is no property kind being converted." };
  }
  return propertyEditorConvertPreview(row, stage.destination, {
    value: draft && Object.prototype.hasOwnProperty.call(draft, "value") ? draft.value : stage.value,
    touched: stage.inputTouched === true,
  }, options);
}

function propertyEditorDetectTypeManager(manager) {
  if (manager == null) {
    return {
      ok: false, code: "missing",
      message: "Obsidian's property type manager is not available.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
  if (typeof manager !== "object" || typeof manager.setType !== "function") {
    return {
      ok: false, code: "unsupported",
      message: "This Obsidian build has no callable property type setter.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
  return {
    ok: true,
    setType: manager.setType.bind(manager),
    getAssignedType: typeof manager.getAssignedType === "function" ? manager.getAssignedType.bind(manager) : null,
  };
}

async function propertyEditorApplyVaultType(adapter, key, type) {
  if (!adapter || adapter.ok !== true || typeof adapter.setType !== "function") {
    return {
      ok: false, code: adapter && adapter.code || "unsupported",
      message: (adapter && adapter.message) || "Obsidian's property type manager is not available.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
  if (!key) return { ok: false, code: "missing-key", message: "Select a property to change its vault type." };
  if (!type) {
    return {
      ok: false, code: "unsupported-type",
      message: "Obsidian has no vault type for this kind.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
  try {
    const result = adapter.setType(key, type);
    if (result && typeof result.then === "function") await result;
    return { ok: true };
  } catch (error) {
    return {
      ok: false, code: "failed",
      message: error && error.message ? error.message : "The vault type could not be changed.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
}

function propertyEditorConvertCountKeyUses(app, key) {
  if (!key) return { ok: false, code: "missing-key", message: "Select a property." };
  if (typeof propertyEditorPropertyInfosFromApi === "function") {
    try {
      const infos = propertyEditorPropertyInfosFromApi(app);
      if (Array.isArray(infos)) {
        const row = infos.find((item) => item && item.name === key);
        if (row && row.authoritative === true && Number.isFinite(Number(row.count))) {
          return { ok: true, count: Number(row.count), source: "api" };
        }
      }
    } catch (_) {}
  }
  let files;
  try { files = app && app.vault && typeof app.vault.getMarkdownFiles === "function" ? app.vault.getMarkdownFiles() : null; }
  catch (error) {
    return {
      ok: false, code: "count-unavailable",
      message: error && error.message ? error.message : "Note usage for this property is unavailable.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
  if (!Array.isArray(files)) {
    return {
      ok: false, code: "count-unavailable",
      message: "Note usage for this property is unavailable.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
  let count = 0;
  try {
    for (const file of files) {
      const cache = app && app.metadataCache && typeof app.metadataCache.getFileCache === "function"
        ? app.metadataCache.getFileCache(file)
        : null;
      const frontmatter = cache && cache.frontmatter;
      if (frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
        && Object.prototype.hasOwnProperty.call(frontmatter, key)) {
        count += 1;
      }
    }
  } catch (error) {
    return {
      ok: false, code: "count-unavailable",
      message: error && error.message ? error.message : "Note usage for this property is unavailable.",
      hint: PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT,
    };
  }
  return { ok: true, count, source: "cache" };
}

function propertyEditorConvertVaultConfirmText(key, type, count) {
  const notes = Number(count) === 1 ? "1 note" : `${Number(count) || 0} notes`;
  return `Change vault type of “${key}” to ${propertyEditorObsidianTypeLabel(type)} for ${notes}? This does not rewrite other notes' values. u undoes this note's value, not the vault type.`;
}

function propertyEditorPaintConvertStage(doc, host, options, modal) {
  if (!doc || !host || !options) return null;
  const panel = propertyEditorCreateEl(doc, "section", "bob-property-editor-stage is-kind");
  if (!panel) return null;
  panel.setAttribute("data-property-stage", options.stageId);
  panel.setAttribute("data-property-kind-stage", "true");
  panel.setAttribute("aria-label", `Change kind of ${options.key}`);
  const title = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(title, `Change kind · ${options.key}`);
  panel.appendChild(title);
  const current = propertyEditorCreateEl(doc, "div", "bob-property-editor-kind-current");
  propertyEditorSetText(current, `Current: ${propertyEditorConvertKindLabel(options.currentKind)} · ${options.currentPreview}`);
  panel.appendChild(current);
  const chooser = propertyEditorCreateEl(doc, "div", "bob-property-editor-kind-choices");
  chooser.setAttribute("role", "group");
  chooser.setAttribute("aria-label", "Destination type");
  for (const kind of PROPERTY_EDITOR_CONVERT_KINDS) {
    const button = propertyEditorCreateEl(doc, "button",
      kind === options.destination ? "bob-property-editor-kind-choice is-selected" : "bob-property-editor-kind-choice");
    button.setAttribute("type", "button");
    button.setAttribute("data-property-kind-action", "destination");
    button.setAttribute("data-property-kind", kind);
    button.setAttribute("aria-pressed", kind === options.destination ? "true" : "false");
    propertyEditorSetText(button, propertyEditorConvertKindLabel(kind));
    button.addEventListener("click", (event) => {
      event.preventDefault?.();
      modal.propertyEditorConvertSetDestination(kind);
    });
    chooser.appendChild(button);
  }
  panel.appendChild(chooser);
  let input = options.keptInput || null;
  if (options.needsInput) {
    const label = propertyEditorCreateEl(doc, "label", "bob-property-editor-stage-label");
    const inputId = `bob-property-editor-kind-${options.stageId}`;
    label.setAttribute("for", inputId);
    propertyEditorSetText(label, `New ${propertyEditorConvertKindLabel(options.destination).toLowerCase()} value`);
    panel.appendChild(label);
    if (!input) {
      // bob-text: literal converted property values are typed tokens, not prose.
      input = propertyEditorCreateEl(doc, "input", "bob-property-editor-stage-input");
      input.setAttribute("type", "text");
      input.value = options.value;
    } else if (!options.composing && String(input.value == null ? "" : input.value) !== options.value) {
      input.value = options.value;
    }
    input.setAttribute("id", inputId);
    input.setAttribute("data-property-stage-input", `property-stage-${options.stageId}`);
    input.setAttribute("data-property-stage-id", String(options.stageId));
    input.setAttribute("data-property-stage-kind", "convert");
    input.setAttribute("aria-label", `Converted ${options.key} value`);
    input.disabled = options.disabled === true;
    if (!input.parentNode || input.parentNode !== panel) panel.appendChild(input);
  } else {
    input = null;
  }
  const preview = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-preview");
  preview.setAttribute("role", "status");
  preview.setAttribute("aria-live", "polite");
  propertyEditorSetText(preview, options.previewText || "");
  panel.appendChild(preview);
  if (options.reportedKindNote) {
    const note = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note");
    propertyEditorSetText(note, options.reportedKindNote);
    panel.appendChild(note);
  }
  if (options.warning) {
    const warn = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note is-diagnostic");
    warn.setAttribute("data-property-kind-warning", "created-datetime");
    propertyEditorSetText(warn, options.warning);
    panel.appendChild(warn);
  }
  const actions = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-actions");
  const save = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-save");
  save.setAttribute("type", "button");
  save.setAttribute("data-property-stage-action", "save");
  save.disabled = options.disabled === true;
  propertyEditorSetText(save, options.yaml === true ? "Edit as YAML" : "Save");
  actions.appendChild(save);
  const cancel = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-cancel");
  cancel.setAttribute("type", "button");
  cancel.setAttribute("data-property-stage-action", "cancel");
  propertyEditorSetText(cancel, "Cancel");
  actions.appendChild(cancel);
  panel.appendChild(actions);

  const vault = propertyEditorCreateEl(doc, "div", "bob-property-editor-kind-vault");
  const vaultTitle = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-title");
  propertyEditorSetText(vaultTitle, "Change vault property type");
  vault.appendChild(vaultTitle);
  const vaultNote = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-note");
  propertyEditorSetText(vaultNote, options.vaultMessage || PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT);
  if (options.vaultConfirm) vaultNote.setAttribute("data-property-kind-vault-confirm", "true");
  vault.appendChild(vaultNote);
  const vaultActions = propertyEditorCreateEl(doc, "div", "bob-property-editor-stage-actions");
  if (options.vaultPhase === "confirm") {
    const confirm = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-save");
    confirm.setAttribute("type", "button");
    confirm.setAttribute("data-property-kind-action", "vault-confirm");
    confirm.disabled = options.disabled === true || options.vaultBusy === true;
    propertyEditorSetText(confirm, "Confirm vault type");
    confirm.addEventListener("click", (event) => {
      event.preventDefault?.();
      void modal.propertyEditorConvertConfirmVaultType();
    });
    vaultActions.appendChild(confirm);
    const abort = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-cancel");
    abort.setAttribute("type", "button");
    abort.setAttribute("data-property-kind-action", "vault-cancel");
    propertyEditorSetText(abort, "Cancel vault change");
    abort.addEventListener("click", (event) => {
      event.preventDefault?.();
      modal.propertyEditorConvertCancelVaultType();
    });
    vaultActions.appendChild(abort);
  } else if (options.vaultPhase !== "unsupported") {
    const start = propertyEditorCreateEl(doc, "button", "bob-property-editor-stage-add");
    start.setAttribute("type", "button");
    start.setAttribute("data-property-kind-action", "vault-start");
    start.disabled = options.disabled === true || options.vaultBusy === true || options.yaml === true;
    propertyEditorSetText(start, "Change vault property type");
    start.addEventListener("click", (event) => {
      event.preventDefault?.();
      void modal.propertyEditorConvertStartVaultType();
    });
    vaultActions.appendChild(start);
  }
  vault.appendChild(vaultActions);
  panel.appendChild(vault);
  host.appendChild(panel);
  return { panel, input };
}

const propertyEditorPaintStageBeforeKind = propertyEditorPaintStage;
propertyEditorPaintStage = function propertyEditorPaintStageWithKind(doc, host, options, modal) {
  if (options && (options.convert === true || options.kind === "convert")) {
    return propertyEditorPaintConvertStage(doc, host, options, modal);
  }
  return propertyEditorPaintStageBeforeKind(doc, host, options, modal);
};

const propertyEditorPaintAllBeforeKind = propertyEditorPaintAll;
propertyEditorPaintAll = function propertyEditorPaintAllWithKind(host, options, doc, modal) {
  propertyEditorPaintAllBeforeKind(host, options, doc, modal);
  const menu = host && host.querySelector && host.querySelector("[role='menu']");
  if (menu && options && options.menuOpen && typeof propertyEditorRenameReorderMenuButton === "function") {
    const selected = modal && typeof modal.editorSelected === "function" ? modal.editorSelected() : null;
    const mutable = selected && selected.row && typeof propertyEditorCanMutate === "function"
      ? propertyEditorCanMutate(selected.row)
      : false;
    const busy = modal && (modal.pendingApply === true || Boolean(modal.stage) || Boolean(modal.addName));
    propertyEditorRenameReorderMenuButton(doc, menu, modal, "Change kind  t", "kind", !mutable || busy);
  }
  const hints = host && host.querySelector && host.querySelector(".bob-property-editor-hints");
  propertyEditorSetText(hints, PROPERTY_EDITOR_CONVERT_HINTS);
};

const propertyEditorStageViewBeforeKind = PropertyEditorModal.prototype.propertyEditorStageView;
const propertyEditorBuildBeforeKind = PropertyEditorModal.prototype.propertyEditorBuildCurrentStage;
const propertyEditorPreviewTextBeforeKind = PropertyEditorModal.prototype.propertyEditorStagePreviewText;
const propertyEditorPerformBeforeKind = PropertyEditorModal.prototype.propertyEditorPerform;
const propertyEditorSaveBeforeKind = PropertyEditorModal.prototype.propertyEditorSaveStage;
const propertyEditorInputBeforeKind = PropertyEditorModal.prototype.propertyEditorStageInputChanged;

Object.assign(PropertyEditorModal.prototype, {
  propertyEditorStartConvert() {
    if (this.closed) return false;
    if (this.pendingApply === true) {
      this.propertyEditorRefuseWhileSaving?.();
      return false;
    }
    if (this.stage || this.addName || this.propertyEditorClipboardStage) {
      this.announce = typeof PROPERTY_EDITOR_FINISH_EDIT_FIRST === "string"
        ? PROPERTY_EDITOR_FINISH_EDIT_FIRST
        : "Finish the open edit first.";
      this.paintPropertyEditor();
      return false;
    }
    const selected = this.editorSelected();
    if (!selected) return false;
    if (!propertyEditorCanMutate(selected.row) || selected.row.opaque === true || selected.row.kind === "opaque") {
      const preview = propertyEditorConvertPreview(selected.row, "text");
      this.refusal = {
        code: preview.code || "locked",
        message: preview.message || `Cannot change kind of “${selected.row.key}”.`,
        hint: preview.hint || "y opens YAML.",
      };
      this.status = { kind: "refusal", text: this.refusal.message };
      this.announce = this.refusal.message;
      this.paintPropertyEditor();
      return false;
    }
    const currentKind = propertyEditorConvertCurrentKind(selected.row);
    const destination = PROPERTY_EDITOR_CONVERT_KINDS.includes(currentKind) ? currentKind : "text";
    this.stageSeq = (this.stageSeq || 0) + 1;
    this.stage = {
      id: this.stageSeq,
      convert: true,
      rowId: selected.id,
      key: selected.row.key,
      line: selected.row.line,
      kind: "convert",
      wireKind: destination,
      destination,
      value: propertyEditorConvertSeed(selected.row, destination),
      items: [],
      itemDraft: "",
      inputTouched: false,
      revision: 0,
      previewText: "",
      suggestionIndex: -1,
      suggestionCatalog: [],
      vaultPhase: "idle",
      vaultMessage: "This changes only this note's value. Vault-wide type is a separate confirmation.",
      vaultCount: null,
      vaultType: null,
      vaultBusy: false,
    };
    this.propertyEditorConvertVaultToken = (this.propertyEditorConvertVaultToken || 0) + 1;
    this.pendingStageEnter = null;
    this.stageComposing = false;
    this.stageNeedsPreview = false;
    this.refusal = null;
    this.status = { kind: "ready", text: "" };
    this.announce = `Change kind of “${selected.row.key}”.`;
    this.menuOpen = false;
    this.propertyEditorConvertSync();
    return true;
  }
,
  propertyEditorConvertSync() {
    if (!this.stage || this.stage.convert !== true) return null;
    const built = this.propertyEditorBuildCurrentStage();
    this.stage.previewText = this.propertyEditorStagePreviewText(built);
    this.stage.reportedKindNote = built && built.reportedKindNote || "";
    this.stage.warning = built && built.warning || "";
    this.stage.convertMode = built && built.mode || "";
    const session = this.editorEnsureSession && this.editorEnsureSession();
    if (!built || built.ok !== true || !built.changed) {
      try { session && session.setDraft && session.setDraft([]); } catch (_) {}
      this.refusal = built && built.ok === false ? { code: built.code || "bad-stage-value", message: built.message, hint: built.hint || "" } : null;
      this.status = built && built.ok === false
        ? { kind: "refusal", text: built.message }
        : { kind: "ready", text: "" };
    } else {
      this.refusal = null;
      this.status = typeof propertyEditorStatusChecking === "function"
        ? propertyEditorStatusChecking()
        : { kind: "checking", text: "Checking value…" };
      try { session && session.setDraft && session.setDraft(built.ops); } catch (_) {}
    }
    this.sessionState = session && session.getState ? session.getState() : this.sessionState;
    this.paintPropertyEditor();
    return built;
  }
,
  propertyEditorConvertSetDestination(kind) {
    if (!this.stage || this.stage.convert !== true || this.closed || this.pendingApply) return false;
    const dest = String(kind || "").toLowerCase();
    if (!PROPERTY_EDITOR_CONVERT_KINDS.includes(dest)) return false;
    const entry = this.propertyEditorStageFindRow();
    this.stage.destination = dest;
    this.stage.wireKind = dest;
    this.stage.inputTouched = false;
    this.stage.value = entry ? propertyEditorConvertSeed(entry.row, dest) : "";
    this.stage.revision += 1;
    this.stage.vaultPhase = this.stage.vaultPhase === "confirm" ? "idle" : this.stage.vaultPhase;
    if (this.stage.vaultPhase === "idle") {
      this.stage.vaultMessage = "This changes only this note's value. Vault-wide type is a separate confirmation.";
    }
    this.pendingStageEnter = null;
    this.stageNeedsPreview = false;
    this.propertyEditorConvertSync();
    return true;
  }
,
  propertyEditorConvertTypeManager() {
    const app = (this.propertyPlugin && this.propertyPlugin.app) || this.app;
    return propertyEditorDetectTypeManager(app && app.metadataTypeManager);
  }
,
  async propertyEditorConvertStartVaultType() {
    if (!this.stage || this.stage.convert !== true || this.closed || this.pendingApply) return false;
    const dest = this.stage.destination;
    const type = propertyEditorConvertWireToObsidianType(dest);
    const adapter = this.propertyEditorConvertTypeManager();
    if (!adapter.ok || !type) {
      this.stage.vaultPhase = "unsupported";
      this.stage.vaultMessage = `${adapter.message || "Obsidian has no vault type for this kind."} ${adapter.hint || PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT}`;
      this.paintPropertyEditor();
      return false;
    }
    const app = (this.propertyPlugin && this.propertyPlugin.app) || this.app;
    const counted = propertyEditorConvertCountKeyUses(app, this.stage.key);
    if (!counted.ok) {
      this.stage.vaultPhase = "unsupported";
      this.stage.vaultMessage = `${counted.message} ${counted.hint || PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT}`;
      this.paintPropertyEditor();
      return false;
    }
    this.stage.vaultPhase = "confirm";
    this.stage.vaultType = type;
    this.stage.vaultCount = counted.count;
    this.stage.vaultSource = counted.source;
    this.stage.vaultMessage = propertyEditorConvertVaultConfirmText(this.stage.key, type, counted.count);
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorConvertCancelVaultType() {
    if (!this.stage || this.stage.convert !== true) return false;
    this.stage.vaultPhase = "idle";
    this.stage.vaultType = null;
    this.stage.vaultCount = null;
    this.stage.vaultMessage = "Vault type change cancelled. This note's value is unchanged.";
    this.paintPropertyEditor();
    return true;
  }
,
  async propertyEditorConvertConfirmVaultType() {
    if (!this.stage || this.stage.convert !== true || this.closed || this.stage.vaultPhase !== "confirm") return false;
    const token = (this.propertyEditorConvertVaultToken || 0) + 1;
    this.propertyEditorConvertVaultToken = token;
    const key = this.stage.key;
    const expectedType = this.stage.vaultType;
    const expectedCount = this.stage.vaultCount;
    this.stage.vaultBusy = true;
    this.paintPropertyEditor();
    const adapter = this.propertyEditorConvertTypeManager();
    const app = (this.propertyPlugin && this.propertyPlugin.app) || this.app;
    const counted = propertyEditorConvertCountKeyUses(app, key);
    if (this.closed || this.propertyEditorConvertVaultToken !== token || !this.stage || this.stage.convert !== true) return false;
    if (!adapter.ok || !counted.ok || counted.count !== expectedCount || propertyEditorConvertWireToObsidianType(this.stage.destination) !== expectedType) {
      this.stage.vaultBusy = false;
      this.stage.vaultPhase = "idle";
      this.stage.vaultMessage = "The vault type or note count changed — confirm again. Nothing was changed.";
      this.paintPropertyEditor();
      return false;
    }
    const result = await propertyEditorApplyVaultType(adapter, key, expectedType);
    if (this.closed || this.propertyEditorConvertVaultToken !== token || !this.stage || this.stage.convert !== true) return false;
    this.stage.vaultBusy = false;
    if (!result.ok) {
      this.stage.vaultPhase = "failed";
      this.stage.vaultMessage = `${result.message} ${result.hint || PROPERTY_EDITOR_CONVERT_ALL_PROPERTIES_HINT}`;
      this.refusal = { code: result.code || "failed", message: result.message, hint: result.hint || "" };
      this.status = { kind: "refusal", text: result.message };
      this.paintPropertyEditor();
      return false;
    }
    this.stage.vaultPhase = "done";
    this.stage.vaultMessage = `Vault type of “${key}” is now ${propertyEditorObsidianTypeLabel(expectedType)}. u undoes this note's value, not the vault type.`;
    this.announce = this.stage.vaultMessage;
    this.refusal = null;
    this.status = { kind: "ready", text: this.stage.vaultMessage };
    this.paintPropertyEditor();
    return true;
  }
,
  propertyEditorStageView() {
    const view = propertyEditorStageViewBeforeKind.call(this);
    if (view && this.stage && this.stage.convert === true) {
      const entry = this.propertyEditorStageFindRow();
      const built = this.propertyEditorBuildCurrentStage();
      const mode = built && built.mode || this.stage.convertMode;
      return {
        ...view,
        convert: true,
        kind: "convert",
        label: "Kind",
        collection: false,
        prose: false,
        suggestions: [],
        destination: this.stage.destination,
        currentKind: entry ? propertyEditorConvertCurrentKind(entry.row) : this.stage.destination,
        currentPreview: entry ? propertyEditorConvertFormatValue(entry.row.value) : "",
        needsInput: mode === "input",
        yaml: mode === "yaml",
        warning: (built && built.warning) || this.stage.warning || "",
        reportedKindNote: (built && built.reportedKindNote) || this.stage.reportedKindNote || "",
        vaultPhase: this.stage.vaultPhase,
        vaultMessage: this.stage.vaultMessage,
        vaultConfirm: this.stage.vaultPhase === "confirm",
        vaultBusy: this.stage.vaultBusy === true,
        value: String(this.stage.value == null ? "" : this.stage.value),
        previewText: this.stage.previewText || (built && this.propertyEditorStagePreviewText(built)) || "",
      };
    }
    return view;
  }
,
  propertyEditorBuildCurrentStage() {
    if (this.stage && this.stage.convert === true) {
      const entry = this.propertyEditorStageFindRow();
      if (!entry) return { ok: false, message: "The property is no longer available." };
      return propertyEditorConvertStageBuild(this.stage, this.propertyEditorCurrentStageDraft(), entry.row, {
        now: this.propertyEditorNow,
        timeZone: this.propertyEditorTimeZone,
      });
    }
    return propertyEditorBuildBeforeKind.call(this);
  }
,
  propertyEditorStagePreviewText(built) {
    if (this.stage && this.stage.convert === true) {
      if (built && built.mode === "yaml") return "Map values convert through the YAML stage · Enter opens YAML";
      if (!built || built.ok !== true) return (built && built.message) || "Choose a destination type.";
      if (built.mode === "noop" || !built.changed) return built.message || "Already this type · Esc returns to properties";
      const preview = built.preview || propertyEditorConvertFormatValue(built.value);
      return `${built.message ? `${built.message} · ` : ""}Preview · ${this.stage.key} = ${preview} as ${propertyEditorConvertKindLabel(built.kind)} · Enter saves`;
    }
    return propertyEditorPreviewTextBeforeKind.call(this, built);
  }
,
  async propertyEditorPerform(action, event) {
    if (this.stage && this.stage.convert === true) {
      if (action === "open") return this.propertyEditorSaveStage();
      if (action === "kind") return true;
    }
    if (action === "kind") return this.propertyEditorStartConvert();
    return propertyEditorPerformBeforeKind.call(this, action, event);
  }
,
  async propertyEditorSaveStage() {
    if (this.stage && this.stage.convert === true) {
      const built = this.propertyEditorBuildCurrentStage();
      if (built && built.mode === "yaml") {
        const entry = this.propertyEditorStageFindRow();
        this.propertyEditorCancelStage({ quiet: true });
        if (typeof this.propertyEditorStartYamlStage === "function") {
          return this.propertyEditorStartYamlStage(entry);
        }
        return built;
      }
    }
    return propertyEditorSaveBeforeKind.call(this);
  }
,
  propertyEditorStageInputChanged(input) {
    if (this.stage && this.stage.convert === true) this.stage.inputTouched = true;
    return propertyEditorInputBeforeKind.call(this, input);
  },
});
