// Setting set/clear ops, clock translation, preview copy, and confirmed
// contract adoption. Later hue/type/clock/parent phases replace handlers
// through propertyEditorRegisterSettingStageHandler only.
const PROPERTY_EDITOR_SETTING_STAGE_HANDLERS = Object.create(null);
const PROPERTY_EDITOR_SUMMARY_LIMIT = 140;
const PROPERTY_EDITOR_READY_CAP_MIN = 1;
const PROPERTY_EDITOR_READY_CAP_MAX = 999;
const PROPERTY_EDITOR_REVIEW_MIN = 1;
const PROPERTY_EDITOR_REVIEW_MAX = 365;
const PROPERTY_EDITOR_STATS_ROOT_HELP = "Past and future time regroup here, and leaf-project successor offers change.";
const PROPERTY_EDITOR_REVIEW_HELP = "Applies to tasks living in this note only.";

function propertyEditorSettingClone(value) {
  if (typeof propertyCloneJson === "function") return propertyCloneJson(value);
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function propertyEditorSettingIdOf(entryOrStage) {
  return entryOrStage && (entryOrStage.settingId || entryOrStage.row && entryOrStage.row.settingId) || "";
}

function propertyEditorSettingSetOp(setting, value) {
  return { op: "setting.set", setting, value };
}

function propertyEditorSettingClearOp(setting) {
  return { op: "setting.clear", setting };
}

function propertyEditorSettingSeedValue(entry) {
  const row = entry && entry.row;
  if (!row) return null;
  if (row.settingDeclared === true) return propertyEditorSettingClone(row.settingValue);
  return propertyEditorSettingClone(row.effectiveValue);
}

function propertyEditorSettingSummaryValue(raw) {
  const text = raw == null ? "" : String(raw);
  if (/[\r\n]/.test(text)) return { ok: false, message: "Summary must be one line." };
  return { ok: true, value: text, warnLong: text.length > PROPERTY_EDITOR_SUMMARY_LIMIT };
}

function propertyEditorSettingReadyCapValue(raw) {
  if (raw === false || raw === null || raw === undefined) return { ok: true, value: "off", off: true };
  if (typeof raw === "boolean") return raw ? { ok: false, message: "Ready cap is 1–999 or off." } : { ok: true, value: "off", off: true };
  const text = String(raw).trim().toLowerCase();
  if (text === "off" || text === "") return { ok: true, value: "off", off: true };
  const count = typeof raw === "number" ? raw : Number(text);
  if (Number.isInteger(count) && count >= PROPERTY_EDITOR_READY_CAP_MIN && count <= PROPERTY_EDITOR_READY_CAP_MAX) {
    return { ok: true, value: count, off: false };
  }
  return { ok: false, message: "Ready cap is 1–999 or off." };
}

function propertyEditorSettingReviewValue(raw) {
  const count = typeof raw === "number" ? raw : Number(String(raw == null ? "" : raw).trim());
  if (Number.isInteger(count) && count >= PROPERTY_EDITOR_REVIEW_MIN && count <= PROPERTY_EDITOR_REVIEW_MAX) {
    return { ok: true, value: count };
  }
  return { ok: false, message: "Review is 1–365 days." };
}

function propertyEditorSettingClockObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.mode === "string") {
    const mode = raw.mode;
    if (mode === "inherit" || mode === "on" || mode === "off") return { ok: true, value: { mode } };
    if (mode === "types") {
      const types = Array.isArray(raw.types) ? raw.types.map((item) => String(item || "").trim()).filter(Boolean) : [];
      if (!types.length) return { ok: false, message: "Clock types need at least one type name." };
      return { ok: true, value: { mode: "types", types } };
    }
    return { ok: false, message: "Clock mode must be inherit, on, off, or types." };
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const text = String(raw).trim();
    const lower = text.toLowerCase();
    if (!text || lower === "inherit") return { ok: true, value: { mode: "inherit" } };
    if (lower === "on") return { ok: true, value: { mode: "on" } };
    if (lower === "off") return { ok: true, value: { mode: "off" } };
    const types = text.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!types.length) return { ok: false, message: "Clock values use inherit, on, off, or a type list." };
    return { ok: true, value: { mode: "types", types } };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (Array.isArray(raw.offclock_types) && raw.offclock_types.length) {
      return { ok: true, value: { mode: "types", types: raw.offclock_types.map((item) => String(item)) } };
    }
    if (raw.offclock === true) return { ok: true, value: { mode: "off" } };
    if (raw.offclock === false) return { ok: true, value: { mode: "on" } };
  }
  if (raw == null) return { ok: true, value: { mode: "inherit" } };
  return { ok: false, message: "Clock values use inherit, on, off, or a type list — never a scalar setting.set." };
}

function propertyEditorSettingClockSeedText(raw) {
  const parsed = propertyEditorSettingClockObject(raw);
  if (!parsed.ok) return "";
  if (parsed.value.mode === "types") return parsed.value.types.join(", ");
  return parsed.value.mode;
}

function propertyEditorSettingAliasItems(raw) {
  if (Array.isArray(raw)) return raw.map((item) => item == null ? "" : String(item));
  if (raw == null || raw === "") return [];
  return [String(raw)];
}

function propertyEditorSettingReadyCapEffectLine(entry, capValue, plugin, path) {
  let count = null;
  try {
    const note = plugin && typeof plugin.apiNoteReadyForNote === "function"
      ? plugin.apiNoteReadyForNote(path)
      : null;
    if (note && Number.isInteger(note.count)) count = note.count;
  } catch (_) { count = null; }
  if (!Number.isInteger(count)) return "";
  if (capValue === "off" || capValue == null) return `${count} ready · cap off`;
  const cap = Number(capValue);
  if (!Number.isInteger(cap)) return `${count} ready`;
  if (count > cap) return `${count} ready · cap ${cap} → over by ${count - cap}`;
  return `${count} ready · cap ${cap} → room for ${Math.max(0, cap - count)}`;
}

function propertyEditorSettingMatchesWarning(warning, settingId) {
  if (!warning || typeof warning !== "object") return false;
  if (warning.setting === settingId) return true;
  const keys = typeof PROPERTY_EDITOR_SETTING_KEYS === "object" ? PROPERTY_EDITOR_SETTING_KEYS[settingId] : null;
  return Boolean(warning.key && Array.isArray(keys) && keys.includes(warning.key));
}

// Compare stage notes without case or trailing punctuation, so Bob's effect
// message and the stage's own help line count as the same sentence.
function propertyEditorSettingNoteKey(text) {
  return String(text == null ? "" : text).trim().replace(/[.\s]+$/u, "").toLowerCase();
}

// `omit` lists notes the stage already shows (its help line); matching parts
// and repeats are dropped so one sentence never paints twice.
function propertyEditorSettingPreviewText(preview, settingId, omit = []) {
  if (!preview || typeof preview !== "object") return "";
  const parts = [];
  const settings = preview.contract && Array.isArray(preview.contract.settings) ? preview.contract.settings : [];
  const setting = settings.find((item) => item && item.id === settingId);
  if (setting && setting.effective && typeof setting.effective.label === "string" && setting.effective.label) {
    parts.push(setting.effective.label);
  }
  for (const effect of Array.isArray(preview.effects) ? preview.effects : []) {
    if (!effect || typeof effect.message !== "string" || !effect.message) continue;
    if (!settingId || effect.setting === settingId || !effect.setting) parts.push(effect.message);
  }
  for (const warning of Array.isArray(preview.warnings) ? preview.warnings : []) {
    if (!warning || typeof warning.message !== "string" || !warning.message) continue;
    if (!settingId || propertyEditorSettingMatchesWarning(warning, settingId)) parts.push(warning.message);
  }
  const seen = new Set((Array.isArray(omit) ? omit : [omit]).map(propertyEditorSettingNoteKey).filter(Boolean));
  return parts.filter((part) => {
    const key = propertyEditorSettingNoteKey(part);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" · ");
}

function propertyEditorSettingStageChanged(settingId, current, next) {
  try { return JSON.stringify(current) !== JSON.stringify(next); } catch (_) { return current !== next; }
}

function propertyEditorSettingStageBuild(entry, stage, draft) {
  const settingId = stage && stage.settingId || propertyEditorSettingIdOf(entry);
  if (!settingId) return { ok: false, message: "This setting cannot be edited here." };
  const current = propertyEditorSettingSeedValue(entry);
  let parsed;
  if (settingId === "summary") parsed = propertyEditorSettingSummaryValue(draft && draft.value);
  else if (settingId === "ready_cap") {
    parsed = stage && stage.off === true
      ? propertyEditorSettingReadyCapValue("off")
      : propertyEditorSettingReadyCapValue(draft && Object.prototype.hasOwnProperty.call(draft, "value") ? draft.value : current);
  } else if (settingId === "task_refresh") parsed = propertyEditorSettingReviewValue(draft && draft.value);
  else if (settingId === "project_name_aliases" || settingId === "aliases") {
    const items = Array.isArray(draft && draft.items) ? draft.items.slice() : propertyEditorSettingAliasItems(current);
    const extra = String((draft && draft.itemDraft) || "").trim();
    if (extra) items.push(extra);
    parsed = { ok: true, value: items };
  } else if (settingId === "clock") {
    parsed = propertyEditorSettingClockObject(draft && Object.prototype.hasOwnProperty.call(draft, "value") ? draft.value : current);
  } else if (settingId === "root") {
    parsed = { ok: true, value: true };
  } else {
    parsed = { ok: true, value: draft && Object.prototype.hasOwnProperty.call(draft, "value") ? String(draft.value) : (current == null ? "" : String(current)) };
  }
  if (!parsed || parsed.ok !== true) return parsed || { ok: false, message: "Enter a valid value." };
  const changed = propertyEditorSettingStageChanged(settingId, current, parsed.value);
  return {
    ok: true,
    value: parsed.value,
    warnLong: parsed.warnLong === true,
    changed,
    ops: changed ? [propertyEditorSettingSetOp(settingId, parsed.value)] : [],
  };
}

function propertyEditorSettingRootOps(entry) {
  const row = entry && entry.row;
  if (!row) return { ok: false, message: "Stats root is unavailable." };
  if (row.settingDisabled === true) {
    return { ok: false, message: row.disabledReason || "Stats root is disabled on a top-level project." };
  }
  if (row.settingDeclared === true && row.settingValue === true) {
    return { ok: true, ops: [propertyEditorSettingClearOp("root")], clearing: true };
  }
  return { ok: true, ops: [propertyEditorSettingSetOp("root", true)], clearing: false };
}

function propertyEditorNeedsContractRefresh(report) {
  return Boolean(report && ["area", "project", "reference"].includes(report.note_kind)
    && Array.isArray(report.capabilities) && report.capabilities.includes("props_v1"));
}

function propertyEditorMergeConfirmedReport(current, incoming) {
  if (!incoming || incoming.dry_run === true) return current || incoming;
  const next = { ...(current || {}), ...incoming };
  delete next.dry_run;
  if (typeof incoming.fingerprint_after === "string" && incoming.fingerprint_after) {
    next.fingerprint = incoming.fingerprint_after;
  }
  delete next.fingerprint_after;
  if (Object.prototype.hasOwnProperty.call(incoming, "contract")) {
    next.contract = incoming.contract;
    next._contractPending = false;
  } else if (propertyEditorNeedsContractRefresh(next)) {
    delete next.contract;
    next._contractPending = true;
  }
  return next;
}

function propertyEditorAdoptConfirmedContract(modal, result) {
  if (!modal || modal.closed || !result || result.ok !== true || !result.report) return;
  if (result.report.dry_run === true) return;
  if (!modal.report) return;
  const next = propertyEditorMergeConfirmedReport(modal.report, result.report);
  modal.contractPending = next._contractPending === true;
  delete next._contractPending;
  if (typeof modal.propertyEditorReconcile === "function") modal.propertyEditorReconcile(next);
  if (modal.contractPending && typeof modal.propertyEditorRefreshContract === "function") {
    void modal.propertyEditorRefreshContract();
  }
}

function propertyEditorRegisterSettingStageHandler(settingId, handler) {
  if (typeof settingId !== "string" || !settingId || !handler || typeof handler !== "object") return false;
  PROPERTY_EDITOR_SETTING_STAGE_HANDLERS[settingId] = handler;
  return true;
}

function propertyEditorSettingStageHandler(settingId) {
  return settingId && PROPERTY_EDITOR_SETTING_STAGE_HANDLERS[settingId] || null;
}

function propertyEditorSettingGenericSeed(entry) {
  const seeded = propertyEditorSettingSeedValue(entry);
  return { value: seeded == null ? "" : String(seeded), items: [] };
}

propertyEditorRegisterSettingStageHandler("summary", { kind: "summary", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("ready_cap", { kind: "ready-cap", wireKind: "number" });
propertyEditorRegisterSettingStageHandler("task_refresh", { kind: "review", wireKind: "number" });
propertyEditorRegisterSettingStageHandler("project_name_aliases", { kind: "list", wireKind: "list" });
propertyEditorRegisterSettingStageHandler("root", { kind: "toggle", wireKind: "checkbox" });
propertyEditorRegisterSettingStageHandler("parent", { kind: "generic-text", wireKind: "text", prose: true });
propertyEditorRegisterSettingStageHandler("color", { kind: "generic-text", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("task_type", { kind: "generic-text", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("clock", { kind: "generic-clock", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("title", { kind: "generic-text", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("author", { kind: "generic-text", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("published", { kind: "generic-text", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("source", { kind: "generic-text", wireKind: "text" });
propertyEditorRegisterSettingStageHandler("aliases", { kind: "list", wireKind: "list" });
