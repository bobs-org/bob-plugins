// Contract-backed settings and virtual project-task rows for the shared
// Property Editor. Synthetic rows never enter report.properties and never
// authorize generic YAML operations.
const PROPERTY_EDITOR_SETTING_ORDER = Object.freeze({
  area: ["summary", "parent", "color", "task_type", "clock", "ready_cap", "task_refresh", "project_name_aliases"],
  bank: ["summary", "parent", "color", "task_type", "clock", "ready_cap", "task_refresh", "project_name_aliases"],
  project: ["parent", "color", "task_type", "clock", "root", "ready_cap", "task_refresh", "project_name_aliases"],
});
const PROPERTY_EDITOR_SETTING_KEYS = Object.freeze({
  summary: ["summary"], parent: ["parent"], color: ["color"],
  task_type: ["task_type", "theme"], clock: ["offclock", "offclock_types"],
  root: ["root"], ready_cap: ["ready_cap"], task_refresh: ["task_refresh"],
  project_name_aliases: ["project_name_aliases"],
});
const PROPERTY_EDITOR_RETIRED_COUNTS = new Set(["task_count", "open_task_count"]);

function propertyEditorSettingsObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propertyEditorSettingsValueShape(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value)
    || Array.isArray(value) || propertyEditorSettingsObject(value);
}

function propertyEditorSettingsEffectiveShape(value) {
  return propertyEditorSettingsObject(value)
    && propertyEditorSettingsValueShape(value.value)
    && typeof value.source === "string" && value.source.length > 0
    && typeof value.label === "string"
    && (value.from === undefined || value.from === null || typeof value.from === "string");
}

function propertyEditorSettingsIssueShape(value) {
  return typeof propertyErrorShape === "function"
    ? propertyErrorShape(value)
    : propertyEditorSettingsObject(value) && typeof value.code === "string" && typeof value.message === "string";
}

function propertyEditorSettingsSettingShape(setting, kind) {
  if (!propertyEditorSettingsObject(setting)) return false;
  const expectedKeys = PROPERTY_EDITOR_SETTING_KEYS[setting.id];
  if (!expectedKeys || !Array.isArray(setting.keys)
    || JSON.stringify(setting.keys) !== JSON.stringify(expectedKeys)) return false;
  if (typeof setting.label !== "string" || !setting.label
    || typeof setting.stage !== "string" || !setting.stage
    || typeof setting.declared !== "boolean"
    || !propertyEditorSettingsValueShape(setting.value)
    || !propertyEditorSettingsEffectiveShape(setting.effective)
    || typeof setting.help !== "string" || typeof setting.disabled !== "boolean") return false;
  if (setting.choices !== undefined) {
    if (!Array.isArray(setting.choices) || !setting.choices.every((choice) =>
      propertyEditorSettingsObject(choice)
        && typeof choice.id === "string"
        && typeof choice.label === "string"
        && (choice.hue === undefined || choice.hue === null || typeof choice.hue === "string")
        && (choice.used_by === undefined || Array.isArray(choice.used_by)
          && choice.used_by.every((name) => typeof name === "string")))) return false;
  }
  if (setting.issues !== undefined && (!Array.isArray(setting.issues) || !setting.issues.every(propertyEditorSettingsIssueShape))) return false;
  return kind !== "project" || setting.id !== "root" || setting.keys[0] === "root";
}

function propertyEditorSettingsPrjShape(value) {
  if (!propertyEditorSettingsObject(value)) return false;
  return ["line", "criterion", "scheduled"].every((key) => value[key] === null || typeof value[key] === "string")
    && ["depends_on", "blocks"].every((key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === "string"));
}

function propertyEditorSettingsContractShape(contract, noteKind) {
  if (!propertyEditorSettingsObject(contract) || !PROPERTY_EDITOR_SETTING_ORDER[noteKind]) return false;
  if (contract.kind !== noteKind || !Array.isArray(contract.settings)) return false;
  const expected = PROPERTY_EDITOR_SETTING_ORDER[noteKind];
  if (contract.settings.length !== expected.length
    || !contract.settings.every((setting, index) => setting.id === expected[index]
      && propertyEditorSettingsSettingShape(setting, noteKind))) return false;
  if (noteKind === "project") return propertyEditorSettingsPrjShape(contract.prj);
  return contract.prj === undefined || contract.prj === null;
}

function propertyEditorSettingsPropertiesMatch(report) {
  if (!report || !Array.isArray(report.properties) || !propertyEditorSettingsObject(report.contract)) return false;
  for (const setting of report.contract.settings || []) {
    const matching = report.properties.filter((row) => row && setting.keys.includes(row.key));
    if (new Set(matching.map((row) => row.key)).size !== matching.length) return false;
    if (setting.declared !== (matching.length > 0)) return false;
    if (!setting.declared) continue;
    let expected;
    if (setting.id === "clock") {
      expected = {};
      for (const key of setting.keys) {
        const row = matching.find((item) => item.key === key);
        if (row) expected[key] = row.value;
      }
    } else {
      const row = setting.keys.map((key) => matching.find((item) => item.key === key)).find(Boolean);
      if (!row) return false;
      expected = row.value;
    }
    try {
      if (JSON.stringify(setting.value) !== JSON.stringify(expected)) return false;
    } catch (_) { return false; }
  }
  return true;
}

function propertyEditorSettingsSupported(report) {
  return Boolean(report && typeof report === "object"
    && report.ok === true
    && report.frontmatter && ["ok", "absent"].includes(report.frontmatter.state)
    && typeof propertyHasCapability === "function" && propertyHasCapability(report)
    && Array.isArray(report.capabilities) && report.capabilities.includes("props_contract_v1")
    && propertyEditorSettingsContractShape(report.contract, report.note_kind)
    && propertyEditorSettingsPropertiesMatch(report));
}

function propertyEditorSettingsFallbackHint(report) {
  if (!report || !["area", "project", "bank"].includes(report.note_kind)) return "";
  if (typeof propertyHasCapability !== "function" || !propertyHasCapability(report)) return "";
  if (!report.frontmatter || !["ok", "absent"].includes(report.frontmatter.state)) return "";
  return propertyEditorSettingsSupported(report) ? "" : "Update bob for typed settings.";
}

function propertyEditorSettingsValueText(value) {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value === "" ? "empty" : value;
  if (Array.isArray(value)) return value.length ? value.map(propertyEditorSettingsValueText).join(", ") : "empty list";
  if (propertyEditorSettingsObject(value)) {
    try { return JSON.stringify(value); } catch (_) { return "value"; }
  }
  return String(value);
}

function propertyEditorSettingsWarningText(report, setting) {
  const local = Array.isArray(setting && setting.issues) ? setting.issues : [];
  const shared = Array.isArray(report && report.warnings) ? report.warnings.filter((warning) => {
    if (!warning || typeof warning !== "object") return false;
    return warning.setting === setting.id || warning.key && setting.keys.includes(warning.key);
  }) : [];
  return [...local, ...shared].map((warning) => typeof warning === "string" ? warning : warning.message)
    .filter((message) => typeof message === "string" && message.trim()).join(" · ");
}

function propertyEditorSettingsEntry(setting, report) {
  const value = setting.declared ? setting.value : setting.effective.value;
  const keys = setting.keys.join(" + ");
  const effective = setting.effective.label;
  const warning = propertyEditorSettingsWarningText(report, setting);
  const details = [keys, propertyEditorSettingsValueText(value), effective, setting.declared ? "set" : ""]
    .filter(Boolean).join(" · ");
  const row = {
    key: setting.label, line: null, end_line: null, value: details, kind: "text",
    role: "setting", owner: "bob", editor: null, reason: setting.help,
    duplicate: false, opaque: false, settingId: setting.id, settingKeys: setting.keys.slice(),
    settingDeclared: setting.declared, settingValue: propertyCloneJson(setting.value),
    effectiveValue: propertyCloneJson(setting.effective.value), effectiveLabel: effective,
    help: setting.help, settingDisabled: setting.disabled,
    disabledReason: setting.disabled ? `${setting.label} is disabled for this note.` : "",
    issues: setting.issues || [],
    warning, isGhost: setting.declared !== true, propertyEntryType: "setting",
  };
  if (warning) row.value += ` · ${warning}`;
  return { id: `setting::${setting.id}`, index: null, row, entryType: "setting", source: false, group: "settings" };
}

function propertyEditorProjectEntries(contract) {
  const prj = contract && contract.prj;
  if (!propertyEditorSettingsPrjShape(prj)) return [];
  const current = typeof prj.line === "string" && prj.line.length > 0;
  return [
    ["goal", "Goal", prj.criterion || ""],
    ["starts", "Starts", prj.scheduled || ""],
    ["depends_on", "Depends on", prj.depends_on.join(", ")],
  ].map(([id, label, value]) => {
    const display = current ? (value || "not set") : "No current ^prj task";
    const row = {
      key: label, line: null, end_line: null, value: display, kind: "text",
      role: "project-task", owner: "project task", editor: null,
      reason: current ? "Opens the current project task; this row is navigation only." : "No current ^prj task is available.",
      duplicate: false, opaque: false, projectTaskField: id, projectTaskLine: prj.line,
      propertyEntryType: "project-task", unavailable: !current,
    };
    return { id: `project-task::${id}`, index: null, row, entryType: "project-task", source: false, group: "project-task" };
  });
}

function propertyEditorSettingsSourceEntries(modal) {
  const rows = modal && modal.report && Array.isArray(modal.report.properties)
    ? modal.report.properties
    : modal && Array.isArray(modal.properties) && modal.properties.length
      ? modal.properties : modal && Array.isArray(modal.cacheRows) ? modal.cacheRows : [];
  return rows.map((row, index) => ({
    id: propertyEditorRowId(row, index), index, row, entryType: "source", source: true,
    group: "properties",
  })).filter((entry) => entry.row && typeof entry.row.key === "string");
}

function propertyEditorSettingsCoveredKeys(report) {
  if (!propertyEditorSettingsSupported(report)) return new Set();
  return new Set(report.contract.settings.flatMap((setting) => setting.keys));
}

function propertyEditorSettingsManagedRow(row, noteKind) {
  return propertyEditorRoleOf(row) === "derived"
    || row.key === "template" || PROPERTY_EDITOR_RETIRED_COUNTS.has(row.key)
    || noteKind === "project" && row.key === "scheduled";
}

function propertyEditorSettingsArchiveTarget(row) {
  const value = row && row.value;
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const match = item.trim().match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
    if (match && match[1].trim()) return match[1].trim();
  }
  return "";
}

async function propertyEditorSettingsProjectLineNumber(modal, lineText) {
  if (!modal || typeof lineText !== "string" || !lineText) return 0;
  const vault = modal.app && modal.app.vault;
  if (!vault) return 0;
  let file = null;
  try { file = vault.getAbstractFileByPath?.(modal.filePath) || { path: modal.filePath }; }
  catch (_) { file = { path: modal.filePath }; }
  let source = null;
  try {
    if (typeof vault.cachedRead === "function") source = await vault.cachedRead(file);
    else if (typeof vault.read === "function") source = await vault.read(file);
  } catch (_) { source = null; }
  if (typeof source !== "string") return 0;
  const index = source.split("\n").findIndex((line) => line.replace(/\r$/, "") === lineText);
  return index < 0 ? 0 : index + 1;
}

function propertyEditorSettingsDeclaredSource(modal, entry) {
  if (!modal || !entry || entry.entryType !== "setting" || entry.row.settingDeclared !== true) return null;
  const rows = Array.isArray(modal.report && modal.report.properties) ? modal.report.properties : [];
  for (const key of entry.row.settingKeys || []) {
    const index = rows.findIndex((row) => row && row.key === key);
    if (index < 0) continue;
    const row = rows[index];
    const ordinal = rows.slice(0, index).filter((candidate) => candidate && candidate.key === key).length;
    return { row, selection: { key, ordinal, line: Number.isInteger(row.line) ? row.line : null } };
  }
  return null;
}

async function propertyEditorSettingsYamlTarget(modal, entry) {
  if (!entry || entry.source === true || entry.entryType === "source") return null;
  if (entry.entryType === "setting") {
    const source = propertyEditorSettingsDeclaredSource(modal, entry);
    return source
      ? { key: source.row.key, selection: source.selection, line: source.selection.line || 0 }
      : { key: "", selection: { key: "", ordinal: 0, line: null }, line: 0 };
  }
  if (entry.entryType === "project-task" || entry.entryType === "project-status") {
    const line = await propertyEditorSettingsProjectLineNumber(modal, entry.row.projectTaskLine);
    return { key: "", selection: { key: "", ordinal: 0, line: null }, line };
  }
  return { key: "", selection: { key: "", ordinal: 0, line: null }, line: 0 };
}

function propertyEditorSettingsAllEntries(modal) {
  const report = modal && modal.report;
  const base = propertyEditorSettingsSourceEntries(modal);
  if (!propertyEditorSettingsSupported(report)) return base;
  const covered = propertyEditorSettingsCoveredKeys(report);
  const settings = report.contract.settings.map((setting) => propertyEditorSettingsEntry(setting, report));
  const project = report.note_kind === "project" ? propertyEditorProjectEntries(report.contract) : [];
  const groups = { settings, "project-task": project, properties: [], card: [], identity: [], managed: [] };
  for (const sourceEntry of base) {
    let entry = sourceEntry;
    if (covered.has(entry.row.key)) continue;
    let row = entry.row;
    if (report.note_kind === "project" && row.key === "status") {
      row = { ...row, propertyEntryType: "project-status", projectTaskLine: report.contract.prj.line };
      entry = { ...entry, row, entryType: "project-status", group: "identity" };
      groups.identity.push(entry);
    } else if (propertyEditorRoleOf(row) === "identity") groups.identity.push(entry);
    else if (propertyEditorSettingsManagedRow(row, report.note_kind)) {
      if (row.key === "done_tasks") row = { ...row, archiveTarget: propertyEditorSettingsArchiveTarget(row) };
      groups.managed.push({ ...entry, row });
    }
    else if (propertyEditorRoleOf(row) === "card") groups.card.push(entry);
    else groups.properties.push(entry);
  }
  return [...settings, ...project, ...groups.properties, ...groups.card, ...groups.identity, ...groups.managed];
}

function propertyEditorSettingsGroups(modal, query = "", includeCollapsed = false) {
  const report = modal && modal.report;
  if (!propertyEditorSettingsSupported(report)) {
    const rows = propertyEditorSettingsSourceEntries(modal).map((entry) => entry.row);
    return propertyEditorGroupRows(rows).map((group) => ({
      ...group,
      rows: group.rows.filter((entry) => propertyEditorSelectionFilterMatches(entry.row, query)),
    })).filter((group) => group.rows.length > 0);
  }
  const entries = propertyEditorSettingsAllEntries(modal);
  const byGroup = new Map([
    ["settings", { title: report.note_kind === "project" ? "PROJECT SETTINGS" : "AREA SETTINGS", rows: [] }],
    ["project-task", { title: "ON THE ^PRJ LINE", rows: [] }],
    ["properties", { title: "PROPERTIES", rows: [] }],
    ["card", { title: "On the kind's card", rows: [] }],
    ["identity", { title: "IDENTITY / LIFECYCLE", rows: [] }],
    ["managed", { title: "BOB-MANAGED", rows: [] }],
  ]);
  for (const entry of entries) byGroup.get(entry.group)?.rows.push(entry);
  const groups = [];
  for (const [group, model] of byGroup) {
    const matching = model.rows.filter((entry) => propertyEditorSelectionFilterMatches(entry.row, query));
    const isManaged = group === "managed";
    if (matching.length === 0 && !(isManaged && model.rows.length > 0 && !query)) continue;
    const collapsed = isManaged && modal.propertyEditorManagedExpanded !== true;
    groups.push({
      group, title: model.title, rows: isManaged && collapsed && !includeCollapsed ? [] : matching,
      count: model.rows.length, matchingCount: matching.length, collapsed,
    });
  }
  return groups;
}

function propertyEditorSettingsVisibleEntries(modal) {
  const query = modal && typeof modal.propertyEditorFilterQuery === "string" ? modal.propertyEditorFilterQuery : "";
  return propertyEditorSettingsGroups(modal, query).flatMap((group) => group.rows);
}

function propertyEditorSettingsFindEntry(modal, id) {
  return propertyEditorSettingsAllEntries(modal).find((entry) => entry.id === id) || null;
}

function propertyEditorSettingsActionForRow(row) {
  const kind = row && row.propertyEntryType;
  if (kind === "setting") return row.settingDisabled === true
    ? { action: "locked", reason: row.disabledReason || `${row.key} is disabled for this note.`, key: row.key }
    : {
      action: "setting", settingId: row.settingId, declared: row.settingDeclared === true,
      reason: row.help || "Setting actions are unavailable.",
    };
  if (kind === "project-task" || kind === "project-status") {
    if (!row.projectTaskLine) return { action: "locked", reason: "No current ^prj task is available.", key: row.key };
    return { action: "project-task", key: row.key, line: row.projectTaskLine, field: row.projectTaskField || "status" };
  }
  if (row && row.key === "done_tasks") {
    return row.archiveTarget
      ? { action: "archive", target: row.archiveTarget, key: row.key }
      : { action: "locked", reason: "The archive link is unavailable.", key: row.key };
  }
  return null;
}

function propertyEditorSettingsNotice(modal, code, message, hint = "") {
  if (!modal || modal.closed) return false;
  modal.refusal = { code, message, hint };
  modal.status = { kind: "refusal", text: message };
  modal.announce = message;
  modal.paintPropertyEditor();
  return false;
}

function propertyEditorSettingsDeleteRefusal(modal, message) {
  modal.refusal = { code: "locked", message, hint: "Remove the protected row from the selection." };
  modal.status = { kind: "refusal", text: message };
  modal.announce = message;
  modal.paintPropertyEditor();
}

async function propertyEditorSettingsDelete(modal) {
  if (!modal || modal.closed) return;
  if (modal.pendingApply) return modal.propertyEditorRefuseWhileSaving?.();
  const visible = propertyEditorSelectionFilterEntries(modal);
  const marks = propertyEditorSelectionFilterMarkedIds(modal);
  const selected = marks.size
    ? visible.filter((entry) => marks.has(entry.id))
    : visible.filter((entry) => entry.id === modal.selectedId);
  if (!selected.length) return;
  const ops = [];
  const cleared = new Set();
  let ghostCount = 0;
  for (const entry of selected) {
    if (entry.entryType === "setting") {
      if (entry.row.settingDisabled === true) {
        return propertyEditorSettingsDeleteRefusal(modal, entry.row.disabledReason || `${entry.row.key} is disabled for this note.`);
      }
      if (entry.row.settingDeclared !== true) { ghostCount += 1; continue; }
      if (entry.row.settingId === "parent") {
        return propertyEditorSettingsDeleteRefusal(modal, "Lives under is required; Bob will not clear this setting.");
      }
      if (!cleared.has(entry.row.settingId)) {
        cleared.add(entry.row.settingId);
        ops.push({ op: "setting.clear", setting: entry.row.settingId });
      }
      continue;
    }
    if (entry.entryType === "project-task" || entry.entryType === "project-status") {
      return propertyEditorSettingsDeleteRefusal(modal, `“${entry.row.key}” is a navigation row and cannot be deleted.`);
    }
    const decision = propertyEditorActionForRow(entry.row);
    if (!propertyEditorCanMutate(entry.row)) {
      return propertyEditorSettingsDeleteRefusal(modal, decision.reason || `“${entry.row.key}” is managed and cannot be deleted here.`);
    }
    const op = propertyEditorUnsetOp(entry.row);
    if (op) ops.push(op);
  }
  if (!ops.length) {
    const message = ghostCount ? "Already using the inherited value." : "Nothing in this selection can be deleted.";
    modal.refusal = null;
    modal.status = { kind: "ready", text: message };
    modal.announce = message;
    modal.paintPropertyEditor();
    return;
  }
  if (ops.some((op) => op.op === "setting.clear")
    && !(typeof propertyShowAllowsWrite === "function" && propertyShowAllowsWrite(modal.report))) {
    return propertyEditorSettingsDeleteRefusal(modal, "Bob cannot safely clear settings from this report — refresh or open YAML to repair the note.");
  }
  const session = modal.editorEnsureSession();
  if (!session) return propertyEditorSettingsNotice(modal, "unavailable", "Property editing is unavailable.");
  modal.status = propertyEditorStatusChecking();
  modal.refusal = null;
  modal.announce = "";
  modal.paintPropertyEditor();
  modal.pendingApply = true;
  let result;
  try { result = await session.applyOps(ops); }
  catch (error) { result = { ok: false, code: "failed", message: error?.message || "The property update failed." }; }
  finally { modal.pendingApply = false; }
  if (modal.closed) return;
  if (result && result.ok === true) {
    const report = result.report && Array.isArray(result.report.properties)
      ? { ...modal.report, ...result.report } : null;
    if (report) modal.propertyEditorReconcile(report);
    modal.status = propertyEditorStatusSaved();
    modal.refusal = null;
    propertyEditorSelectionFilterClearMarks(modal);
  } else {
    const failure = result && result.report && result.report.error ? result.report.error : result || {};
    const refusal = propertyEditorStatusRefusal(failure);
    if (failure.code === "prop_owned" && selected.some((entry) => entry.row.settingId === "parent")) {
      refusal.message = "Lives under is required; Bob refused to clear this setting.";
    }
    modal.refusal = refusal;
    modal.status = { kind: "refusal", text: refusal.message };
  }
  modal.paintPropertyEditor();
}

function propertyEditorSettingsSourceCopyIds(modal, entries) {
  const reportRows = Array.isArray(modal.report && modal.report.properties) ? modal.report.properties : [];
  const ids = new Set();
  for (const entry of entries) {
    const type = entry && (entry.entryType || entry.row?.propertyEntryType) || "source";
    if (type === "source") {
      if (!propertyEditorCanMutate(entry.row)) return { ok: false, message: `“${entry.row.key}” cannot be copied as a property.`, hint: "Remove it from the selection." };
      ids.add(entry.id);
      continue;
    }
    if (type !== "setting" || entry.row.settingDeclared !== true) {
      return { ok: false, message: type === "setting"
        ? "This setting uses its inherited value; there are no declared bytes to copy."
        : `“${entry.row.key}” is not a frontmatter property and cannot be copied.`, hint: "Select declared properties instead." };
    }
    for (const key of entry.row.settingKeys) {
      reportRows.forEach((row, index) => {
        if (row && row.key === key) ids.add(propertyEditorRowId(row, index));
      });
    }
    const present = reportRows.filter((row) => row && entry.row.settingKeys.includes(row.key));
    if (!present.length) return { ok: false, message: `Declared bytes for “${entry.row.key}” are unavailable.`, hint: "Refresh the property report and try again." };
  }
  return { ok: true, ids };
}

function propertyEditorSettingsGroupToggle(doc, section, model, modal) {
  if (!section || !model || model.group !== "managed" || !(model.count > 0)) return;
  const old = section.querySelector?.(".bob-property-editor-group-title");
  if (!old) return;
  const button = propertyEditorCreateEl(doc, "button", "bob-property-editor-group-title bob-property-editor-group-toggle");
  if (!button) return;
  propertyEditorSetText(button, `${model.title} · ${model.count}`);
  button.setAttribute("type", "button");
  button.setAttribute("aria-expanded", model.collapsed ? "false" : "true");
  button.setAttribute("aria-label", `${model.collapsed ? "Expand" : "Collapse"} Bob-managed properties (${model.count})`);
  button.setAttribute("data-property-group-toggle", "managed");
  button.addEventListener("click", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    const collapse = modal.propertyEditorManagedExpanded === true;
    modal.propertyEditorManagedExpanded = !collapse;
    if (collapse) {
      const managedIds = new Set(propertyEditorSettingsAllEntries(modal).filter((entry) => entry.group === "managed").map((entry) => entry.id));
      propertyEditorSelectionFilterClearMarks(modal);
      if (managedIds.has(modal.selectedId)) {
        modal.propertyEditorManagedReturnSelectionId = modal.selectedId;
        const first = propertyEditorSettingsVisibleEntries(modal)[0];
        modal.selectedId = first ? first.id : "";
      }
    } else {
      const returning = modal.propertyEditorManagedReturnSelectionId;
      if (returning && propertyEditorSettingsVisibleEntries(modal).some((entry) => entry.id === returning)) {
        modal.selectedId = returning;
      }
      modal.propertyEditorManagedReturnSelectionId = "";
    }
    modal.announce = collapse ? "Bob-managed properties collapsed." : "Bob-managed properties expanded.";
    modal.paintPropertyEditor();
  });
  try { old.parentNode.replaceChild(button, old); }
  catch (_) {
    propertyEditorSetText(old, `${model.title} · ${model.count}`);
    old.setAttribute("role", "button");
    old.setAttribute("tabindex", "0");
    old.setAttribute("aria-expanded", model.collapsed ? "false" : "true");
    old.addEventListener("click", () => button.click());
  }
}

const propertyEditorSettingsBaseAction = propertyEditorActionForRow;
propertyEditorActionForRow = function propertyEditorActionForSettingsRow(row) {
  return propertyEditorSettingsActionForRow(row) || propertyEditorSettingsBaseAction(row);
};

const propertyEditorSettingsBaseCanMutate = propertyEditorCanMutate;
propertyEditorCanMutate = function propertyEditorCanMutateSettingsRow(row) {
  if (row && ["setting", "project-task", "project-status"].includes(row.propertyEntryType)) return false;
  return propertyEditorSettingsBaseCanMutate(row);
};

const propertyEditorSettingsBaseBadgeKind = propertyEditorBadgeKind;
propertyEditorBadgeKind = function propertyEditorBadgeKindWithHomeSpecies(noteKind) {
  return propertyEditorSettingsBaseBadgeKind(noteKind)
    || (["area", "project"].includes(String(noteKind || "").toLowerCase()) ? String(noteKind).toLowerCase() : null);
};

const propertyEditorSettingsBasePaintOptions = PropertyEditorModal.prototype.propertyEditorPaintOptions;
PropertyEditorModal.prototype.propertyEditorPaintOptions = function propertyEditorPaintSettingsRows() {
  const options = propertyEditorSettingsBasePaintOptions.call(this);
  const query = typeof this.propertyEditorFilterQuery === "string" ? this.propertyEditorFilterQuery : "";
  options.groups = propertyEditorSettingsGroups(this, query);
  options.visible = options.groups.flatMap((group) => group.rows);
  options.ordered = propertyEditorSettingsAllEntries(this);
  options.settingsFallbackHint = propertyEditorSettingsFallbackHint(this.report);
  options.badgeKind = propertyEditorBadgeKind(this.noteKind);
  return options;
};

PropertyEditorModal.prototype.editorOrderedRows = function editorOrderedRowsWithSettingsEntries() {
  return propertyEditorSettingsAllEntries(this);
};

PropertyEditorModal.prototype.editorSelected = function editorSelectedSettingsVisible() {
  const visible = propertyEditorSettingsVisibleEntries(this);
  return visible.find((entry) => entry.id === this.selectedId) || visible[0] || null;
};

const propertyEditorSettingsBaseVisibleEntries = propertyEditorSelectionFilterEntries;
propertyEditorSelectionFilterEntries = function propertyEditorSelectionFilterEntriesWithSettings(modal) {
  if (!propertyEditorSettingsSupported(modal && modal.report)) return propertyEditorSettingsBaseVisibleEntries(modal);
  return propertyEditorSettingsVisibleEntries(modal);
};

const propertyEditorSettingsBaseReconcile = PropertyEditorModal.prototype.propertyEditorReconcile;
PropertyEditorModal.prototype.propertyEditorReconcile = function propertyEditorReconcileSettingsRows(report) {
  const selectedBefore = this.selectedId;
  const selectedWasSynthetic = Boolean(propertyEditorSettingsFindEntry(this, selectedBefore)
    && propertyEditorSettingsFindEntry(this, selectedBefore).source !== true);
  propertyEditorSettingsBaseReconcile.call(this, report);
  if (selectedWasSynthetic && propertyEditorSettingsFindEntry(this, selectedBefore)) this.selectedId = selectedBefore;
  const visible = propertyEditorSelectionFilterEntries(this);
  if (!visible.some((entry) => entry.id === this.selectedId)) this.selectedId = visible[0]?.id || "";
  this.paintPropertyEditor();
};

const propertyEditorSettingsBasePaintRow = propertyEditorPaintRow;
propertyEditorPaintRow = function propertyEditorPaintSettingsRow(doc, host, entry, selected, modal) {
  propertyEditorSettingsBasePaintRow(doc, host, entry, selected, modal);
  const button = host?.lastElementChild || host?.lastChild;
  if (!button || !entry || !entry.row) return;
  const type = entry.entryType || entry.row.propertyEntryType || "source";
  try {
    button.setAttribute("data-property-entry-type", type);
    if (entry.row.settingId) button.setAttribute("data-setting-id", entry.row.settingId);
    if (entry.row.projectTaskField) button.setAttribute("data-project-task-field", entry.row.projectTaskField);
    if (entry.row.help) button.setAttribute("title", entry.row.help);
    if (entry.row.isGhost) button.classList?.add?.("is-ghost");
    if (type !== "source") button.classList?.add?.("is-synthetic");
    const description = [entry.row.help, entry.row.reason, entry.row.warning].filter(Boolean).join(" ");
    if (description) button.setAttribute("aria-description", description);
  } catch (_) {}
};

const propertyEditorSettingsBasePaintAll = propertyEditorPaintAll;
propertyEditorPaintAll = function propertyEditorPaintAllWithSettings(host, options, doc, modal) {
  propertyEditorSettingsBasePaintAll(host, options, doc, modal);
  if (options && options.settingsFallbackHint) {
    const banner = propertyEditorCreateEl(doc, "div", "bob-property-editor-banner is-settings-fallback");
    propertyEditorSetText(banner, options.settingsFallbackHint);
    const list = host?.querySelector?.(".bob-property-editor-list");
    if (banner) {
      try { host.insertBefore(banner, list || null); } catch (_) { host.appendChild(banner); }
    }
  }
  for (const model of options && Array.isArray(options.groups) ? options.groups : []) {
    if (model.group !== "managed") continue;
    const section = host?.querySelector?.(`[data-property-group="${model.group}"]`);
    propertyEditorSettingsGroupToggle(doc, section, model, modal);
  }
};

const propertyEditorDeleteBeforeSettings = PropertyEditorModal.prototype.propertyEditorDelete;
const propertyEditorSettingsBaseClipboardCopy = PropertyEditorModal.prototype.propertyEditorClipboardCopy;
const propertyEditorSettingsBaseActivate = PropertyEditorModal.prototype.propertyEditorActivate;
Object.assign(PropertyEditorModal.prototype, {
  propertyEditorResolveSettingStage(entry) {
    return { ok: false, message: `${entry?.row?.key || "Setting"} controls are not available yet.` };
  },
  async propertyEditorResolveProjectTask(entry) {
    const taskLine = entry?.row?.projectTaskLine;
    if (!taskLine) return { ok: false, message: "No current ^prj task is available." };
    const line = await propertyEditorSettingsProjectLineNumber(this, taskLine);
    if (!line) return { ok: false, message: "The current ^prj task could not be found in this note." };
    const plugin = this.propertyPlugin;
    if (!plugin || typeof plugin.propertyEditorYamlJump !== "function") {
      return { ok: false, message: "Project task navigation is unavailable." };
    }
    let jumped;
    try { jumped = await plugin.propertyEditorYamlJump(this.filePath, line); }
    catch (_) { jumped = null; }
    if (!jumped || jumped.ok !== true) return { ok: false, message: "The current ^prj task could not be opened." };
    this.close();
    return { ok: true, line };
  },
  async propertyEditorActivate(entry) {
    const row = entry && entry.row;
    const type = entry && (entry.entryType || row?.propertyEntryType);
    if (row?.key === "done_tasks") {
      const target = propertyEditorSettingsArchiveTarget(row);
      const workspace = this.app?.workspace;
      if (!target || typeof workspace?.openLinkText !== "function") {
        this.announce = target ? "Archive navigation is unavailable." : "The archive link is unavailable.";
        this.status = { kind: "ready", text: this.announce };
        this.refusal = null;
        return this.paintPropertyEditor();
      }
      try { await workspace.openLinkText(target, this.filePath, false); }
      catch (_) {
        this.announce = "The archive link could not be opened.";
        this.status = { kind: "ready", text: this.announce };
        return this.paintPropertyEditor();
      }
      return;
    }
    if (type === "setting") {
      const resolved = this.propertyEditorResolveSettingStage(entry);
      if (!resolved || resolved.ok !== true) {
        this.announce = resolved?.message || `${row.key} controls are not available yet.`;
        this.status = { kind: "ready", text: this.announce };
        this.refusal = null;
        return this.paintPropertyEditor();
      }
      if (resolved.stage) {
        this.stage = resolved.stage;
        this.announce = "";
        this.refusal = null;
        this.status = { kind: "ready", text: "" };
        this.paintPropertyEditor();
      }
      return resolved;
    }
    if (type === "project-task" || type === "project-status") {
      const resolved = this.propertyEditorResolveProjectTask(entry);
      if (!resolved || resolved.ok !== true) {
        this.announce = resolved?.message || "Project task navigation is not available yet.";
        this.status = { kind: "ready", text: this.announce };
        this.refusal = null;
        return this.paintPropertyEditor();
      }
      return resolved;
    }
    return propertyEditorSettingsBaseActivate.call(this, entry);
  },
  async propertyEditorDelete(entry) {
    const type = entry && (entry.entryType || entry.row?.propertyEntryType);
    if (type === "setting") {
      this.selectedId = entry.id;
      return propertyEditorSettingsDelete(this);
    }
    if (type === "project-task" || type === "project-status") {
      return propertyEditorSettingsNotice(this, "locked", `“${entry.row.key}” is a navigation row and cannot be deleted.`);
    }
    return propertyEditorDeleteBeforeSettings.call(this, entry);
  },
  async propertyEditorClipboardCopy() {
    const visible = propertyEditorSelectionFilterEntries(this);
    const marked = propertyEditorSelectionFilterMarkedIds(this);
    const selected = marked.size
      ? visible.filter((entry) => marked.has(entry.id))
      : visible.filter((entry) => entry.id === this.selectedId);
    if (marked.size && selected.length !== marked.size) {
      return this.propertyEditorClipboardNotice("ineligible-selection", "Some marked rows are hidden; reveal them or clear the selection before copying.");
    }
    const requested = propertyEditorSettingsSourceCopyIds(this, selected);
    if (!requested.ok) return this.propertyEditorClipboardNotice("ineligible-selection", requested.message, requested.hint);
    if (!requested.ids.size) return this.propertyEditorClipboardNotice("empty-selection", "Select a declared property to copy.");
    const oldManual = this.propertyEditorManualMarks;
    const oldRange = this.propertyEditorRangeMarks;
    const oldAnchor = this.propertyEditorRangeAnchorId;
    this.propertyEditorManualMarks = new Set(requested.ids);
    this.propertyEditorRangeMarks = new Set();
    this.propertyEditorRangeAnchorId = "";
    try { return await propertyEditorSettingsBaseClipboardCopy.call(this); }
    finally {
      this.propertyEditorManualMarks = oldManual;
      this.propertyEditorRangeMarks = oldRange;
      this.propertyEditorRangeAnchorId = oldAnchor;
      if (!this.closed) this.paintPropertyEditor();
    }
  },
});

const propertyEditorSettingsBaseRename = PropertyEditorModal.prototype.propertyEditorStartRename;
PropertyEditorModal.prototype.propertyEditorStartRename = function propertyEditorStartRenameSettingsGuard() {
  const selected = propertyEditorSettingsFindEntry(this, this.selectedId);
  if (selected && selected.source !== true) {
    this.announce = "Settings and project task rows cannot be renamed.";
    this.status = { kind: "ready", text: this.announce };
    this.paintPropertyEditor();
    return false;
  }
  return propertyEditorSettingsBaseRename.call(this);
};

const propertyEditorSettingsBaseConvert = PropertyEditorModal.prototype.propertyEditorStartConvert;
PropertyEditorModal.prototype.propertyEditorStartConvert = function propertyEditorStartConvertSettingsGuard() {
  const selected = propertyEditorSettingsFindEntry(this, this.selectedId);
  if (selected && selected.source !== true) {
    this.announce = "Settings and project task rows cannot change property kind.";
    this.status = { kind: "ready", text: this.announce };
    this.paintPropertyEditor();
    return false;
  }
  return propertyEditorSettingsBaseConvert.call(this);
};

const propertyEditorSettingsBaseMove = PropertyEditorModal.prototype.propertyEditorMoveFocused;
PropertyEditorModal.prototype.propertyEditorMoveFocused = function propertyEditorMoveFocusedSettingsGuard(direction, event) {
  const selected = propertyEditorSettingsFindEntry(this, this.selectedId);
  if (selected && selected.source !== true) {
    this.announce = "Settings and project task rows cannot be reordered.";
    this.status = { kind: "ready", text: this.announce };
    this.paintPropertyEditor();
    return false;
  }
  return propertyEditorSettingsBaseMove.call(this, direction, event);
};

const propertyEditorSettingsBaseBatchDelete = propertyEditorSelectionFilterDelete;
propertyEditorSelectionFilterDelete = async function propertyEditorSelectionFilterDeleteWithSettings(modal) {
  if (!propertyEditorSettingsSupported(modal && modal.report)) return propertyEditorSettingsBaseBatchDelete(modal);
  return propertyEditorSettingsDelete(modal);
};

const propertyEditorSettingsBaseMovePlan = propertyEditorSourceMovePlan;
propertyEditorSourceMovePlan = function propertyEditorSourceMovePlanOnlySourceEntries(entries, selectedId, direction) {
  const source = Array.isArray(entries) ? entries.filter((entry) =>
    !entry.entryType || entry.entryType === "source" || entry.source === true) : [];
  return propertyEditorSettingsBaseMovePlan(source, selectedId, direction);
};

const propertyEditorSettingsBasePerform = PropertyEditorModal.prototype.propertyEditorPerform;
PropertyEditorModal.prototype.propertyEditorPerform = async function propertyEditorPerformSettingsYaml(action, event) {
  if (action === "yaml") {
    if (this.pendingApply === true) return this.propertyEditorRefuseWhileSaving?.();
    const selected = this.editorSelected();
    const target = await propertyEditorSettingsYamlTarget(this, selected);
    if (target) {
      if (typeof this.onYamlEscape !== "function") {
        return propertyEditorSettingsNotice(this, "unavailable", "YAML navigation is unavailable.");
      }
      const filePath = this.filePath;
      try { this.close(); } catch (_) {}
      try {
        return await this.onYamlEscape({
          ...target, path: filePath, filePath, modal: this,
        });
      } catch (_) { return false; }
    }
  }
  return propertyEditorSettingsBasePerform.call(this, action, event);
};

