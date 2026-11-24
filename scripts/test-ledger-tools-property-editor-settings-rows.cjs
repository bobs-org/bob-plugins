const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } },
    keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

const AREA_IDS = ["summary", "parent", "color", "task_type", "clock", "ready_cap", "task_refresh", "project_name_aliases"];
const PROJECT_IDS = ["parent", "color", "task_type", "clock", "root", "ready_cap", "task_refresh", "project_name_aliases"];
const KEYS = {
  summary: ["summary"], parent: ["parent"], color: ["color"], task_type: ["task_type", "theme"],
  clock: ["offclock", "offclock_types"], root: ["root"], ready_cap: ["ready_cap"],
  task_refresh: ["task_refresh"], project_name_aliases: ["project_name_aliases"],
};
const LABELS = {
  summary: "Summary", parent: "Lives under", color: "Hue", task_type: "Default type", clock: "Clock",
  root: "Stats root", ready_cap: "Ready cap", task_refresh: "Review", project_name_aliases: "Capture names",
};

function setting(id, overrides = {}) {
  const declared = overrides.declared === true;
  const effectiveValue = Object.hasOwn(overrides, "effectiveValue") ? overrides.effectiveValue : null;
  return {
    id, label: LABELS[id], keys: KEYS[id], stage: id, declared,
    value: Object.hasOwn(overrides, "value") ? overrides.value : null,
    effective: {
      value: effectiveValue, source: overrides.source || "config", from: overrides.from || null,
      label: overrides.label || `${H.propertyEditorSettingsValueText(effectiveValue)} · Bob setting`,
    },
    choices: [], issues: [], help: `${LABELS[id]} help`, disabled: overrides.disabled === true,
    ...overrides.extra,
  };
}

function contract(kind = "area", overrides = {}) {
  const ids = kind === "project" ? PROJECT_IDS : AREA_IDS;
  const settings = ids.map((id) => setting(id, id === "summary"
    ? { declared: true, value: "A calm area", effectiveValue: "A calm area", source: "self", label: "set on this note" }
    : id === "task_type"
      ? { declared: true, value: "Drafting", effectiveValue: "Drafting", source: "self", label: "set on this note" }
      : id === "clock"
        ? { declared: true, value: { offclock: false, offclock_types: ["writing"] }, effectiveValue: { mode: "types", types: ["writing"] }, source: "self", label: "off-clock for writing" }
        : id === "parent"
          ? { declared: false, value: null, effectiveValue: null, source: "none", label: "required · missing", extra: { issues: [
            { code: "area_parent_missing", message: "A parent is required.", hint: "Choose the area or parent project.", key: "parent", line: null },
          ] } }
          : id === "color" ? { effectiveValue: "teal", label: "teal · inherited from parent", extra: { issues: [
              { code: "area_color_invalid", message: "Existing hue is invalid.", hint: "Choose a palette hue.", key: "color", line: 12 },
            ] } }
              : id === "root" ? { declared: false, disabled: true, effectiveValue: false, label: "Disabled on a top-level project" }
            : id === "ready_cap" ? { effectiveValue: 8, label: "8 · Bob setting (plan.max_ready_per_note)" }
              : id === "task_refresh" ? { effectiveValue: 7, label: "7 days · Bob setting (freshness.interval)" }
                : { effectiveValue: "inherited", label: "inherited from parent" }));
  return {
    kind, settings,
    ...(kind === "project" ? { prj: {
      line: "- [ ] Ship the first slice #prj ^project-task", criterion: "Ship the first slice",
      scheduled: "2026-12-01", depends_on: ["[[Plan]]#^blocked-by"], blocks: [],
    } } : {}),
    ...overrides,
  };
}

function row(key, line, overrides = {}) {
  return {
    key, line, end_line: line, value: "value", kind: "text", role: "loose", owner: "props",
    editor: null, reason: null, duplicate: false, opaque: false, ...overrides,
  };
}

function report(kind = "area", overrides = {}) {
  const properties = kind === "project" ? [
    row("type", 3, { value: "project", role: "identity", reason: "Identity is fixed." }),
    row("status", 4, { value: "active", role: "derived", owner: "project", reason: "Read from the ^prj checkbox." }),
    row("scheduled", 5, { value: "2026-11-25", role: "derived", owner: "project" }),
    row("theme", 6, { value: "Drafting" }), row("offclock", 7, { value: false, kind: "checkbox" }),
    row("offclock_types", 8, { value: ["writing"], kind: "list" }),
    row("created", 9), row("template", 10), row("done_tasks", 11, { value: "[[done/project_done]]", role: "derived", owner: "ledger" }),
  ] : [
    row("summary", 3, { value: "A calm area" }), row("theme", 4, { value: "Drafting" }),
    row("offclock", 5, { value: false, kind: "checkbox" }),
    row("offclock_types", 6, { value: ["writing"], kind: "list" }),
    row("created", 7), row("aliases", 8, { kind: "aliases" }), row("tags", 9, { kind: "tags" }),
    row("cssclasses", 10, { kind: "list" }), row("priority", 11, { kind: "number", value: 0 }),
    row("type", 12, { value: "area", role: "identity", reason: "Identity is fixed." }),
    row("template", 13), row("done_tasks", 14, { value: "[[done/area_done]]", role: "derived", owner: "ledger" }),
    row("task_count", 15, { value: 8, reason: "Retired count — nothing maintains it." }),
  ];
  return {
    schema_version: 1, ok: true, path: `notes/${kind}.md`, note_kind: kind,
    capabilities: ["props_v1", "props_contract_v1"], fingerprint: "sha256:before",
    frontmatter: { state: "ok", start_line: 1, end_line: 30 }, properties,
    contract: contract(kind), ...overrides,
  };
}

function modalFor(show) {
  const modal = new H.PropertyEditorModal({}, { filePath: show.path, report: show });
  modal.paintPropertyEditor = () => {};
  return modal;
}

test("the contract capability requires a complete, correctly ordered, kind-matched block", () => {
  const supported = report("area");
  assert.equal(H.propertyEditorSettingsSupported(supported), true);
  const malformed = structuredClone(supported);
  malformed.contract.settings[2].effective.label = 7;
  assert.equal(H.propertyEditorSettingsSupported(malformed), false);
  assert.equal(H.propertyEditorSettingsFindEntry(modalFor(malformed), "setting::color"), null);
  const wrongOrder = structuredClone(supported);
  [wrongOrder.contract.settings[1], wrongOrder.contract.settings[2]] = [wrongOrder.contract.settings[2], wrongOrder.contract.settings[1]];
  assert.equal(H.propertyEditorSettingsSupported(wrongOrder), false);
  const older = { ...supported, capabilities: ["props_v1"] };
  assert.equal(H.propertyEditorSettingsSupported(older), false);
  assert.equal(H.propertyEditorSettingsFallbackHint(older), "Update bob for typed settings.");
  assert.equal(H.propertyEditorSettingsFallbackHint({ ...supported, note_kind: "note" }), "");
});

test("show and update decoders retain contract, effects, and warnings without making them required", () => {
  const show = report("area");
  const decodedShow = H.propertyDecodeShowReport(JSON.stringify(show));
  assert.equal(decodedShow.ok, true);
  assert.equal(decodedShow.report.contract.kind, "area");

  const update = {
    schema_version: 1, ok: true, path: show.path, dry_run: true, changed: false,
    fingerprint_before: "sha256:before", fingerprint_after: "sha256:before", inverse_ops: [],
    changes: [], properties: show.properties, contract: show.contract,
    effects: [{ setting: "color", kind: "inherited", message: "Applies below", count: 2, syncs: [] }],
    warnings: [{ code: "area_summary_long", message: "Long summary", hint: "Shorten it.", key: "summary", line: 3 }],
  };
  const decodedUpdate = H.propertyDecodeUpdateReport(JSON.stringify(update));
  assert.equal(decodedUpdate.ok, true);
  assert.equal(decodedUpdate.report.contract.kind, "area");
  assert.deepEqual(decodedUpdate.report.effects, update.effects);
  assert.deepEqual(decodedUpdate.report.warnings, update.warnings);
  assert.equal(H.propertyDecodeShowReport(JSON.stringify({ ...show, capabilities: ["props_v1"] })).ok, true);
});

test("area settings use report order and stable IDs; source rows stay in their own groups", () => {
  const show = report("area");
  const modal = modalFor(show);
  const groups = H.propertyEditorSettingsGroups(modal, "", true);
  assert.deepEqual(groups.map((group) => group.group), ["settings", "properties", "identity", "managed"]);
  assert.equal(groups[0].title, "AREA SETTINGS");
  assert.deepEqual(groups[0].rows.map((entry) => entry.row.settingId), AREA_IDS);
  assert.deepEqual(groups[1].rows.map((entry) => entry.row.key), ["created", "aliases", "tags", "cssclasses", "priority"]);
  assert.deepEqual(groups[2].rows.map((entry) => entry.row.key), ["type"]);
  assert.deepEqual(groups[3].rows.map((entry) => entry.row.key), ["template", "done_tasks", "task_count"]);
  const archive = groups[3].rows.find((entry) => entry.row.key === "done_tasks");
  assert.equal(H.propertyEditorActionForRow(archive.row).action, "archive");
  assert.equal(H.propertyEditorSettingsArchiveTarget(archive.row), "done/area_done");
  assert.equal(modal.properties.length, show.properties.length, "synthetic rows never enter the source inventory");
  assert.equal(H.propertyEditorSettingsFindEntry(modal, "setting::color").id, "setting::color");
  assert.equal(H.propertyEditorSettingsFindEntry(modal, "setting::color").row.isGhost, true);
  assert.match(H.propertyEditorSettingsFindEntry(modal, "setting::color").row.value, /color · .*inherited from parent/);
  assert.match(H.propertyEditorSettingsFindEntry(modal, "setting::ready_cap").row.value, /Bob setting \(plan.max_ready_per_note\)/);
  assert.match(H.propertyEditorSettingsFindEntry(modal, "setting::task_refresh").row.value, /Bob setting \(freshness.interval\)/);
  assert.match(H.propertyEditorSettingsFindEntry(modal, "setting::color").row.warning, /Existing hue is invalid/);
  assert.deepEqual(H.propertyEditorSettingsFindEntry(modal, "setting::clock").row.settingKeys, ["offclock", "offclock_types"]);
  const options = modal.propertyEditorPaintOptions();
  assert.equal(options.header.count, show.properties.length);
  assert.equal(options.badgeKind, "area");
});

test("bank keeps its card handoff row alongside the Area settings hybrid", () => {
  const show = report("bank", { properties: [
    row("summary", 3, { value: "A calm area" }), row("theme", 4, { value: "Drafting" }),
    row("offclock", 5, { value: false, kind: "checkbox" }), row("offclock_types", 6, { value: ["writing"], kind: "list" }),
    row("bank", 7, { value: "Checking", role: "card", owner: "bank", editor: "==" }),
    row("created", 8),
  ] });
  const modal = modalFor(show);
  const groups = H.propertyEditorSettingsGroups(modal);
  assert.equal(groups[0].title, "AREA SETTINGS");
  const bankGroup = groups.find((group) => group.group === "card");
  assert.equal(bankGroup.rows[0].row.key, "bank");
  assert.equal(H.propertyEditorActionForRow(bankGroup.rows[0].row).action, "handoff");
  assert.equal(H.propertyEditorBadgeKind("bank"), "bank");
});

test("project task rows carry current line text and become unavailable without a current task", () => {
  const show = report("project");
  const modal = modalFor(show);
  const groups = H.propertyEditorSettingsGroups(modal);
  assert.deepEqual(groups.map((group) => group.group), ["settings", "project-task", "properties", "identity", "managed"]);
  assert.equal(groups[1].title, "ON THE ^PRJ LINE");
  assert.deepEqual(groups[1].rows.map((entry) => entry.row.projectTaskField), ["goal", "starts", "depends_on"]);
  assert.equal(groups[1].rows[0].row.projectTaskLine, show.contract.prj.line);
  const status = H.propertyEditorSettingsFindEntry(modal, "status::4");
  assert.equal(status.entryType, "project-status");
  assert.equal(H.propertyEditorActionForRow(status.row).action, "project-task");

  const absent = report("project");
  absent.contract.prj.line = null;
  absent.contract.prj.criterion = null;
  absent.contract.prj.scheduled = null;
  absent.contract.prj.depends_on = [];
  const absentModal = modalFor(absent);
  const goal = H.propertyEditorSettingsFindEntry(absentModal, "project-task::goal");
  assert.equal(goal.row.value, "No current ^prj task");
  assert.equal(H.propertyEditorActionForRow(goal.row).action, "locked");
});

test("project virtual rows jump to the exact current ^prj line without changing it", async () => {
  const modal = modalFor(report("project"));
  const text = ["---", "type: project", "---", "- [ ] Ship the first slice #prj ^project-task", ""].join("\n");
  let opened = null;
  modal.app = { vault: {
    getAbstractFileByPath: (path) => ({ path }),
    cachedRead: async () => text,
  } };
  modal.propertyPlugin = { propertyEditorYamlJump: async (...args) => { opened = args; return { ok: true }; } };
  modal.close = () => { modal.closed = true; };
  await modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(modal, "project-task::goal"));
  assert.deepEqual(opened, ["notes/project.md", 4]);
  assert.equal(modal.closed, true);
  assert.equal(modal.report.contract.prj.line, "- [ ] Ship the first slice #prj ^project-task");

  const absent = modalFor(report("project"));
  absent.report.contract.prj.line = null;
  const goal = H.propertyEditorSettingsFindEntry(absent, "project-task::goal");
  await absent.propertyEditorActivate(goal);
  assert.match(absent.announce, /No current \^prj task/);
});

test("missing required parent stays a ghost warning with no inherited value", () => {
  const show = report("area");
  const parent = show.contract.settings.find((item) => item.id === "parent");
  parent.declared = false;
  parent.value = null;
  parent.effective = { value: null, source: "none", from: null, label: "required · missing" };
  const modal = modalFor(show);
  const entry = H.propertyEditorSettingsFindEntry(modal, "setting::parent");
  assert.equal(entry.row.isGhost, true);
  assert.match(entry.row.value, /required · missing/);
  assert.match(entry.row.warning, /A parent is required/);
  assert.equal(entry.row.effectiveValue, null);
});

test("settings selection survives clear reconciliation and filtering includes setting identity", () => {
  const before = report("area");
  const modal = modalFor(before);
  modal.selectedId = "setting::color";
  const after = structuredClone(before);
  const color = after.contract.settings.find((item) => item.id === "color");
  color.declared = true;
  color.value = "indigo";
  color.effective = { value: "indigo", source: "self", from: null, label: "set on this note" };
  after.properties.push(row("color", 20, { value: "indigo" }));
  modal.propertyEditorReconcile(after);
  assert.equal(modal.selectedId, "setting::color");
  assert.equal(H.propertyEditorSettingsFindEntry(modal, modal.selectedId).row.isGhost, false);
  H.propertyEditorSelectionFilterSetQuery(modal, "inherited from parent");
  assert.equal(H.propertyEditorSelectionFilterEntries(modal).some((entry) => entry.id === "setting::color"), false);
  H.propertyEditorSelectionFilterSetQuery(modal, "offclock_types");
  assert.deepEqual(H.propertyEditorSelectionFilterEntries(modal).map((entry) => entry.id), ["setting::clock"]);
});

test("managed rows stay folded, preserve return focus, and clear marks when hidden", () => {
  const modal = modalFor(report("area"));
  const managed = H.propertyEditorSettingsAllEntries(modal).filter((entry) => entry.group === "managed");
  const selected = managed[0];
  modal.selectedId = selected.id;
  modal.propertyEditorManualMarks = new Set([selected.id]);
  const section = new FakeElement("div");
  const title = new FakeElement("div");
  title.setAttribute("class", "bob-property-editor-group-title");
  section.appendChild(title);
  const model = { group: "managed", title: "BOB-MANAGED", count: managed.length, collapsed: true };
  H.propertyEditorSettingsGroupToggle({ createElement: (tag) => new FakeElement(tag) }, section, model, modal);
  const toggle = section.children[0];
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(H.propertyEditorSelectionFilterEntries(modal).some((entry) => entry.group === "managed"), false);
  toggle.click();
  assert.equal(modal.propertyEditorManagedExpanded, true);
  assert.equal(modal.selectedId, selected.id);
  toggle.click();
  assert.equal(modal.propertyEditorManagedExpanded, false);
  assert.equal(modal.selectedId, "setting::summary");
  assert.equal(H.propertyEditorSelectionFilterMarkedIds(modal).size, 0);
});

test("settings and virtual rows paint as non-source rows with a faint, legible ghost state", () => {
  const modal = modalFor(report("area"));
  const ghost = H.propertyEditorSettingsFindEntry(modal, "setting::color");
  const host = new FakeElement("div");
  H.propertyEditorPaintRow({ createElement: (tag) => new FakeElement(tag) }, host, ghost, true, modal);
  const button = host.lastElementChild;
  assert.match(button.className, /is-ghost/);
  assert.match(button.className, /is-synthetic/);
  assert.equal(button.getAttribute("data-setting-id"), "color");
  assert.equal(button.getAttribute("data-property-entry-type"), "setting");
  assert.equal(button.getAttribute("data-property-action"), "setting");
  assert.notEqual(button.getAttribute("aria-disabled"), "true");
});

test("done_tasks opens its archive link without mutating the property", async () => {
  const modal = modalFor(report("area"));
  const entry = H.propertyEditorSettingsFindEntry(modal, "done_tasks::14");
  let opened = null;
  modal.app = { workspace: { openLinkText: async (...args) => { opened = args; } } };
  let writes = 0;
  modal.editorEnsureSession = () => ({ applyOps: async () => { writes += 1; } });
  await modal.propertyEditorActivate(entry);
  assert.deepEqual(opened, ["done/area_done", "notes/area.md", false]);
  assert.equal(writes, 0);
});

test("YAML escape from synthetic rows targets only real source keys or exact project lines", async () => {
  const area = modalFor(report("area"));
  area.close = () => { area.closed = true; };
  let escaped = null;
  area.onYamlEscape = async (info) => { escaped = info; };
  area.selectedId = "setting::task_type";
  await area.propertyEditorPerform("yaml");
  assert.equal(escaped.key, "theme");
  assert.equal(escaped.selection.key, "theme");
  assert.equal(escaped.line, 4);

  const ghost = modalFor(report("area"));
  ghost.close = () => { ghost.closed = true; };
  ghost.onYamlEscape = async (info) => { escaped = info; };
  ghost.selectedId = "setting::color";
  await ghost.propertyEditorPerform("yaml");
  assert.equal(escaped.key, "");
  assert.equal(escaped.selection.key, "");
  assert.equal(escaped.line, 0);

  const project = modalFor(report("project"));
  project.close = () => { project.closed = true; };
  project.app = { vault: {
    getAbstractFileByPath: (path) => ({ path }),
    cachedRead: async () => "---\ntype: project\n---\n- [ ] Ship the first slice #prj ^project-task\n",
  } };
  project.onYamlEscape = async (info) => { escaped = info; };
  project.selectedId = "project-task::goal";
  await project.propertyEditorPerform("yaml");
  assert.equal(escaped.key, "");
  assert.equal(escaped.line, 4);
});

test("setting activation and unsupported direct actions never issue generic writes", async () => {
  const modal = modalFor(report("area"));
  const entry = H.propertyEditorSettingsFindEntry(modal, "setting::color");
  let writes = 0;
  modal.editorEnsureSession = () => ({ applyOps: async () => { writes += 1; return { ok: true }; } });
  await modal.propertyEditorActivate(entry);
  assert.match(modal.announce, /not available yet/);
  assert.equal(await modal.propertyEditorStartRename(), false);
  assert.equal(await modal.propertyEditorStartConvert(), false);
  assert.equal(await modal.propertyEditorMoveFocused("up"), false);
  assert.equal(writes, 0);
  assert.equal(modal.stage, null);
});

test("clear maps a declared setting to one setting.clear and a ghost to a no-op", async () => {
  const show = report("area");
  const modal = modalFor(show);
  modal.selectedId = "setting::task_type";
  let ops = null;
  modal.editorEnsureSession = () => ({ applyOps: async (next) => {
    ops = next;
    return { ok: true, report: { properties: show.properties.filter((item) => item.key !== "theme"), contract: show.contract } };
  } });
  modal.propertyEditorReconcile = (next) => { modal.report = next; modal.properties = next.properties; };
  await modal.propertyEditorDelete(H.propertyEditorSettingsFindEntry(modal, modal.selectedId));
  assert.deepEqual(ops, [{ op: "setting.clear", setting: "task_type" }]);

  const ghostModal = modalFor(report("area"));
  ghostModal.selectedId = "setting::color";
  let ghostWrites = 0;
  ghostModal.editorEnsureSession = () => ({ applyOps: async () => { ghostWrites += 1; } });
  await H.propertyEditorSettingsDelete(ghostModal);
  assert.equal(ghostWrites, 0);
  assert.equal(ghostModal.status.text, "Already using the inherited value.");

  const required = modalFor(report("area"));
  required.selectedId = "setting::parent";
  const requiredSetting = required.report.contract.settings.find((item) => item.id === "parent");
  requiredSetting.declared = true;
  requiredSetting.value = "[[Areas/Studio]]";
  requiredSetting.effective = { value: "[[Areas/Studio]]", source: "self", from: null, label: "set on this note" };
  requiredSetting.issues = [];
  required.report.properties.push(row("parent", 16, { value: "[[Areas/Studio]]" }));
  required.properties = required.report.properties;
  let requiredWrites = 0;
  required.editorEnsureSession = () => ({ applyOps: async () => { requiredWrites += 1; } });
  await H.propertyEditorSettingsDelete(required);
  assert.equal(requiredWrites, 0);
  assert.match(required.refusal.message, /required/);
});

test("a batch clears settings and unsets loose properties once, while protected rows refuse the whole batch", async () => {
  const show = report("area");
  const modal = modalFor(show);
  modal.propertyEditorManualMarks = new Set(["setting::summary", "created::7"]);
  modal.propertyEditorRangeMarks = new Set();
  let batches = 0;
  let ops = null;
  modal.editorEnsureSession = () => ({ applyOps: async (next) => {
    batches += 1; ops = next; return { ok: true, report: { properties: show.properties, contract: show.contract } };
  } });
  modal.propertyEditorReconcile = () => {};
  await H.propertyEditorSettingsDelete(modal);
  assert.equal(batches, 1);
  assert.deepEqual(ops, [{ op: "setting.clear", setting: "summary" }, { op: "prop.unset", key: "created" }]);

  const protectedModal = modalFor(show);
  protectedModal.propertyEditorManualMarks = new Set(["created::7", "type::12"]);
  protectedModal.propertyEditorRangeMarks = new Set();
  let protectedWrites = 0;
  protectedModal.editorEnsureSession = () => ({ applyOps: async () => { protectedWrites += 1; } });
  await H.propertyEditorSettingsDelete(protectedModal);
  assert.equal(protectedWrites, 0);
  assert.match(protectedModal.refusal.message, /Identity is fixed/);
});

test("disabled settings and project virtual rows are read-only through direct delete", async () => {
  const project = modalFor(report("project"));
  const root = H.propertyEditorSettingsFindEntry(project, "setting::root");
  assert.equal(H.propertyEditorActionForRow(root.row).action, "locked");
  let writes = 0;
  project.editorEnsureSession = () => ({ applyOps: async () => { writes += 1; } });
  await project.propertyEditorDelete(root);
  assert.equal(writes, 0);
  const goal = H.propertyEditorSettingsFindEntry(project, "project-task::goal");
  await project.propertyEditorDelete(goal);
  assert.equal(writes, 0);
  assert.match(project.refusal.message, /navigation row/);
});

test("copy selection resolves legacy aliases and both clock source keys, and refuses ghosts or mixed virtual rows", () => {
  const show = report("area");
  const modal = modalFor(show);
  const type = H.propertyEditorSettingsFindEntry(modal, "setting::task_type");
  const typeIds = H.propertyEditorSettingsSourceCopyIds(modal, [type]);
  assert.equal(typeIds.ok, true);
  assert.deepEqual([...typeIds.ids], ["theme::4"]);
  const clock = H.propertyEditorSettingsSourceCopyIds(modal, [H.propertyEditorSettingsFindEntry(modal, "setting::clock")]);
  assert.deepEqual([...clock.ids], ["offclock::5", "offclock_types::6"]);
  const fragments = [
    { key: "theme", occurrence: 1, raw: "theme: Drafting # keep this spelling" },
    { key: "offclock", occurrence: 1, raw: "offclock: false" },
    { key: "offclock_types", occurrence: 1, raw: "offclock_types: [writing] # shadowed" },
  ];
  const copiedClock = H.propertyEditorClipboardSelection(fragments, show.properties, clock.ids, "");
  assert.equal(copiedClock.ok, true);
  assert.equal(H.propertyEditorSourceAssembleEntries(copiedClock.entries, "", "\n").yaml,
    "offclock: false\noffclock_types: [writing] # shadowed");
  const ghost = H.propertyEditorSettingsSourceCopyIds(modal, [H.propertyEditorSettingsFindEntry(modal, "setting::color")]);
  assert.equal(ghost.ok, false);
  assert.match(ghost.message, /inherited/);
  const mixed = H.propertyEditorSettingsSourceCopyIds(modal, [type, { entryType: "project-task", row: { key: "Goal" } }]);
  assert.equal(mixed.ok, false);
});

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.className = "";
    this.parentNode = null;
    this.textContent = "";
    this.classList = { add: (name) => {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      names.add(name); this.className = [...names].join(" "); this.attrs.set("class", this.className);
    } };
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get lastElementChild() { return this.lastChild; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, before) {
    child.parentNode = this;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  replaceChild(next, old) {
    const index = this.children.indexOf(old);
    if (index < 0) throw new Error("missing child");
    next.parentNode = this; old.parentNode = null; this.children[index] = next; return old;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === "class") this.className = String(value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  addEventListener(name, listener) { const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list); }
  click() { for (const listener of this.listeners.get("click") || []) listener({ preventDefault() {}, stopPropagation() {} }); }
  querySelector(selector) {
    const match = (node) => selector.startsWith(".")
      ? node.className.split(/\s+/).includes(selector.slice(1))
      : false;
    const queue = [...this.children];
    while (queue.length) { const node = queue.shift(); if (match(node)) return node; queue.push(...node.children); }
    return null;
  }
  insertBeforeChild(node, before) { return this.insertBefore(node, before); }
}

test("ghost copying teaches without reading a source snapshot or writing", async () => {
  const modal = modalFor(report("area"));
  modal.selectedId = "setting::color";
  let notice = null;
  modal.propertyEditorClipboardNotice = (...args) => { notice = args; return false; };
  let snapshots = 0;
  modal.propertyEditorClipboardSnapshot = async () => { snapshots += 1; return { ok: true }; };
  const result = await modal.propertyEditorClipboardCopy();
  assert.equal(result, false);
  assert.equal(snapshots, 0);
  assert.equal(notice[0], "ineligible-selection");
  assert.match(notice[1], /inherited/);
});

test("degraded old-Bob and damaged-frontmatter reports keep generic rows without synthetic settings", () => {
  const oldBob = report("area", { capabilities: ["props_v1"] });
  const oldModal = modalFor(oldBob);
  assert.equal(H.propertyEditorSettingsSupported(oldBob), false);
  assert.equal(H.propertyEditorSettingsFindEntry(oldModal, "setting::color"), null);
  assert.equal(oldModal.propertyEditorPaintOptions().settingsFallbackHint, "Update bob for typed settings.");

  const damaged = report("area", { frontmatter: { state: "invalid", start_line: 1, end_line: 30 } });
  const damagedModal = modalFor(damaged);
  assert.equal(H.propertyEditorSettingsSupported(damaged), false);
  assert.equal(H.propertyEditorDegradedFor({ report: damaged }).mode, "recovery");
  assert.equal(H.propertyEditorSettingsFindEntry(damagedModal, "setting::color"), null);
  assert.equal(damagedModal.propertyEditorPaintOptions().settingsFallbackHint, "");
});
