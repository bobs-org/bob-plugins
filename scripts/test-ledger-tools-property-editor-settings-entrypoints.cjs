// Settings entrypoints (area/project): registry kinds, setting-focus
// requests, key alias mapping, and project-task Task Card handoffs.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
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
          ? { declared: false, effectiveValue: null, label: "required · missing" }
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
    row("created", 9),
  ] : [
    row("summary", 3, { value: "A calm area" }), row("theme", 4, { value: "Drafting" }),
    row("offclock", 5, { value: false, kind: "checkbox" }),
    row("offclock_types", 6, { value: ["writing"], kind: "list" }),
    row("created", 7),
    row("type", 8, { value: "area", role: "identity", reason: "Identity is fixed." }),
  ];
  return {
    schema_version: 1, ok: true, path: `notes/${kind}.md`, note_kind: kind,
    capabilities: ["props_v1", "props_contract_v1"], fingerprint: "sha256:before",
    frontmatter: { state: "ok", start_line: 1, end_line: 30 }, properties,
    contract: contract(kind), ...overrides,
  };
}

function modalFor(show, options = {}) {
  const modal = new H.PropertyEditorModal({}, { filePath: show.path, report: show, ...options });
  modal.paintPropertyEditor = () => {};
  return modal;
}

function registryHarness() {
  const inst = Object.create(LedgerToolsPlugin.prototype);
  inst.app = {};
  inst.addCommand = () => {};
  inst.setupSchemaDoubleEquals();
  inst.setupPropertyEditorSettingsEntrypoints();
  return inst;
}

test("caller keys map onto their logical setting id", () => {
  assert.equal(H.propertyEditorSettingIdForKey("theme"), "task_type");
  assert.equal(H.propertyEditorSettingIdForKey("offclock"), "clock");
  assert.equal(H.propertyEditorSettingIdForKey("offclock_types"), "clock");
  assert.equal(H.propertyEditorSettingIdForKey("ready_cap"), "ready_cap");
  assert.equal(H.propertyEditorSettingIdForKey("root"), "root");
  assert.equal(H.propertyEditorSettingIdForKey("summary"), "summary");
  assert.equal(H.propertyEditorSettingIdForKey("created"), "");
  assert.equal(H.propertyEditorSettingIdForKey("bank"), "");
  assert.equal(H.propertyEditorSettingIdForKey(""), "");
  assert.equal(H.propertyEditorSettingIdForKey(null), "");
});

test("area and project register after the builtins with bank precedence", () => {
  const harness = registryHarness();
  try {
    assert.deepEqual(harness.propertyCardKinds(), ["bank", "album", "record", "area", "project"]);
    assert.equal(harness.resolvePropertyCard({ path: "Areas/home.md", frontmatter: { type: "area" } }).kind, "area");
    assert.equal(harness.resolvePropertyCard({ path: "Projects/roadmap.md", frontmatter: { type: "project" } }).kind, "project");
    assert.equal(harness.resolvePropertyCard({ path: "bank.md", frontmatter: { type: "bank" } }).kind, "bank");
    assert.equal(
      harness.resolvePropertyCard({ path: "bank.md", frontmatter: { type: "area" } }).kind,
      "bank",
      "bank keeps precedence even when its frontmatter looks like an area",
    );
    assert.equal(harness.resolvePropertyCard({ path: "eat.md", frontmatter: { type: "[[album]]" } }).kind, "album");
    assert.equal(harness.resolvePropertyCard({ path: "eat/nagi.md", frontmatter: { type: "[[record]]" } }).kind, "record");
    assert.equal(harness.resolvePropertyCard({ path: "inbox.md", frontmatter: {} }), null);
    assert.equal(harness.resolvePropertyCard({ path: "done/old.md", frontmatter: { type: "project" } }), null);
    assert.equal(harness.resolvePropertyCard({ path: "_templates/x.md", frontmatter: { type: "area" } }), null);
  } finally {
    harness.teardownPropertyEditorSettingsEntrypoints();
    harness.teardownSchemaDoubleEquals();
  }
});

test("registry setup is idempotent and teardown removes only area and project", () => {
  const harness = registryHarness();
  try {
    harness.setupPropertyEditorSettingsEntrypoints();
    assert.deepEqual(harness.propertyCardKinds(), ["bank", "album", "record", "area", "project"]);
    harness.teardownPropertyEditorSettingsEntrypoints();
    assert.deepEqual(harness.propertyCardKinds(), ["bank", "album", "record"]);
    assert.equal(harness.resolvePropertyCard({ path: "Areas/home.md", frontmatter: { type: "area" } }), null);
    harness.setupPropertyEditorSettingsEntrypoints();
    assert.equal(harness.resolvePropertyCard({ path: "Areas/home.md", frontmatter: { type: "area" } }).kind, "area");
  } finally {
    harness.teardownPropertyEditorSettingsEntrypoints();
    harness.teardownSchemaDoubleEquals();
  }
});

test("day notes keep the temporal extension while area and project coexist", () => {
  const harness = registryHarness();
  try {
    assert.equal(harness.resolvePropertyCard({ path: "2026/20261125.md", frontmatter: {} }), null);
    harness.setupIntentionCardEditor();
    assert.deepEqual(harness.propertyCardKinds(), ["bank", "album", "record", "area", "project", "intentions"]);
    assert.equal(harness.resolvePropertyCard({ path: "2026/20261125.md", frontmatter: {} }).kind, "intentions");
    assert.equal(harness.resolvePropertyCard({ path: "Projects/roadmap.md", frontmatter: { type: "project" } }).kind, "project");
    harness.teardownIntentionCardEditor();
    assert.equal(harness.resolvePropertyCard({ path: "2026/20261125.md", frontmatter: {} }), null);
    assert.equal(harness.resolvePropertyCard({ path: "Areas/home.md", frontmatter: { type: "area" } }).kind, "area");
  } finally {
    try { harness.teardownIntentionCardEditor(); } catch (_) {}
    harness.teardownPropertyEditorSettingsEntrypoints();
    harness.teardownSchemaDoubleEquals();
  }
});

test("= and Settings open the editor on the first settings row", () => {
  const opened = [];
  const bankOpened = [];
  const harness = registryHarness();
  harness.openPropertyEditor = (options) => { opened.push(options); return { ok: true }; };
  harness.openBankSetupCard = (options) => { bankOpened.push(options); return { ok: true }; };
  try {
    const area = harness.resolvePropertyCard({ path: "Areas/home.md", frontmatter: { type: "area" } });
    area.open({ path: "Areas/home.md" });
    const project = harness.resolvePropertyCard({ path: "Projects/roadmap.md", frontmatter: { type: "project" } });
    project.open({ path: "Projects/roadmap.md" });
    const bank = harness.resolvePropertyCard({ path: "bank.md", frontmatter: { type: "bank" } });
    bank.open({ path: "bank.md" });
    assert.deepEqual(opened, [
      { filePath: "Areas/home.md", focusSettings: true },
      { filePath: "Projects/roadmap.md", focusSettings: true },
    ], "bank keeps its own = opener and never reaches the property editor");
    assert.deepEqual(bankOpened, [{ sourcePath: "bank.md" }]);
  } finally {
    harness.teardownPropertyEditorSettingsEntrypoints();
    harness.teardownSchemaDoubleEquals();
  }
});

test("a setting request selects its row on reconcile, even for ghosts", () => {
  const show = report("area");
  const modal = modalFor(show, { setting: "color" });
  assert.equal(modal.requestedSetting, "color");
  modal.propertyEditorReconcile(show);
  assert.equal(modal.selectedId, "setting::color");
  assert.equal(H.propertyEditorSettingsFindEntry(modal, "setting::color").row.isGhost, true);

  const declared = modalFor(show, { setting: "task_type" });
  declared.propertyEditorReconcile(show);
  assert.equal(declared.selectedId, "setting::task_type");
  assert.equal(H.propertyEditorSettingsFindEntry(declared, "setting::task_type").row.settingDeclared, true);
});

test("a bare first-settings request selects the first settings row once", () => {
  const show = report("project");
  const modal = modalFor(show, { focusSettings: true });
  modal.propertyEditorReconcile(show);
  assert.equal(modal.selectedId, "setting::parent");
  modal.propertyEditorSelect("project-task::goal");
  modal.propertyEditorReconcile(show);
  assert.equal(modal.selectedId, "project-task::goal", "a later reconcile never yanks the selection back");
});

test("a requested setting pre-selects its declared source row while loading", () => {
  const show = report("area");
  const cacheRows = show.properties.map((entry) => ({ ...entry }));
  const modal = new H.PropertyEditorModal({}, { filePath: show.path, cacheRows, setting: "task_type" });
  modal.paintPropertyEditor = () => {};
  const theme = cacheRows.findIndex((entry) => entry.key === "theme");
  assert.equal(modal.selectedId, H.propertyEditorRowId(cacheRows[theme], theme));
  modal.propertyEditorReconcile(show);
  assert.equal(modal.selectedId, "setting::task_type");
});

test("a degraded report selects the corresponding real property, else the safe first row", () => {
  const old = report("area", { capabilities: ["props_v1"], contract: undefined });
  const clock = modalFor(old, { setting: "clock" });
  clock.propertyEditorReconcile(old);
  const offclock = old.properties.findIndex((entry) => entry.key === "offclock");
  assert.equal(clock.selectedId, H.propertyEditorRowId(old.properties[offclock], offclock));

  const missing = modalFor(old, { setting: "parent" });
  const before = missing.selectedId;
  missing.propertyEditorReconcile(old);
  assert.equal(missing.selectedId, before, "no parent row exists, so the safe first row survives");
  assert.equal(H.propertyEditorSettingsSupported(missing.report), false);
});

test("policy chips and Settings route through homeCardOpenSetting by setting id", () => {
  const calls = [];
  const host = Object.create(LedgerToolsPlugin.prototype);
  host.openPropertyEditor = (options) => { calls.push(options); return { ok: true }; };
  assert.deepEqual(host.homeCardOpenSetting("Areas/home.md", "offclock_types"), { ok: true });
  assert.deepEqual(host.homeCardOpenSetting("Areas/home.md", "offclock"), { ok: true });
  assert.deepEqual(host.homeCardOpenSetting("Areas/home.md", "theme"), { ok: true });
  assert.deepEqual(host.homeCardOpenSetting("Areas/home.md", undefined), { ok: true });
  assert.deepEqual(host.homeCardOpenSetting("Areas/home.md", "created"), { ok: true });
  assert.deepEqual(calls, [
    { filePath: "Areas/home.md", setting: "clock", mode: "browse" },
    { filePath: "Areas/home.md", setting: "clock", mode: "browse" },
    { filePath: "Areas/home.md", setting: "task_type", mode: "browse" },
    { filePath: "Areas/home.md", focusSettings: true, mode: "browse" },
    { filePath: "Areas/home.md", key: "created", mode: "browse" },
  ]);
  assert.deepEqual(host.homeCardOpenSetting("", "clock"), { ok: false, reason: "missing-path" });
});

function entrypointsHarness({ files = ["notes/project.md"], activePath = "notes/project.md" } = {}) {
  const inst = Object.create(LedgerToolsPlugin.prototype);
  const vaultFiles = new Map(files.map((path) => [path, "---\ntitle: x\n---\nbody\n"]));
  const app = {
    vault: { getAbstractFileByPath: (path) => (vaultFiles.has(path) ? { path } : null) },
    workspace: { activeLeaf: activePath ? { view: { file: { path: activePath } } } : null },
  };
  inst.app = app;
  inst.addCommand = () => {};
  inst.apiPropertyShow = async () => ({ ok: false, code: "unavailable", message: "offline" });
  return inst;
}

test("openPropertyEditor forwards setting requests and maps keys in browse mode", async () => {
  const harness = entrypointsHarness();
  const viaSetting = await harness.openPropertyEditor({ filePath: "notes/project.md", setting: "clock" });
  assert.equal(viaSetting.ok, true);
  assert.equal(viaSetting.modal.requestedSetting, "clock");

  const viaKey = await harness.openPropertyEditor({ filePath: "notes/project.md", key: "theme" });
  assert.equal(viaKey.ok, true);
  assert.equal(viaKey.modal.requestedSetting, "task_type");

  const viaFocus = await harness.openPropertyEditor({ filePath: "notes/project.md", focusSettings: true });
  assert.equal(viaFocus.ok, true);
  assert.equal(viaFocus.modal.focusSettings, true);

  const viaAdd = await harness.openPropertyEditor({ filePath: "notes/project.md", key: "theme", mode: "add" });
  assert.equal(viaAdd.ok, true);
  assert.equal(viaAdd.modal.requestedSetting, "", "add mode keeps the raw key");

  assert.deepEqual(await harness.openPropertyEditor({ filePath: "notes/missing.md" }), { ok: false, reason: "missing-note" });
  assert.deepEqual((await harness.openPropertyEditor({ filePath: "notes/x.txt" })).reason, "non-markdown");

  harness.propertyEditorModal = { closed: false, pendingApply: true };
  assert.deepEqual(await harness.openPropertyEditor({ filePath: "notes/project.md", focusSettings: true }), {
    ok: false, reason: "busy",
  }, "a pending write still refuses the settings open");
});

test("browse = inside an area or project editor focuses settings without reopening", async () => {
  const show = report("project");
  const modal = modalFor(show);
  modal.propertyEditorSelect("project-task::goal");
  await modal.propertyEditorPerform("equals", {});
  assert.equal(modal.selectedId, "setting::parent");
  assert.equal(modal.announce, "");

  const loading = new H.PropertyEditorModal({}, { filePath: "Projects/x.md", noteKind: "project" });
  loading.paintPropertyEditor = () => {};
  await loading.propertyEditorPerform("equals", {});
  assert.equal(loading.announce, "Reading properties — settings focus when ready.");
  assert.equal(loading.focusSettings, true);
  loading.propertyEditorReconcile(report("project", { path: "Projects/x.md" }));
  assert.equal(loading.selectedId, "setting::parent", "the pending = request survives the initial read");

  const bankShow = report("bank");
  const handoffs = [];
  const bank = new H.PropertyEditorModal({}, {
    filePath: "bank.md", report: bankShow, onCardHandoff: (info) => { handoffs.push(info); },
  });
  bank.paintPropertyEditor = () => {};
  await bank.propertyEditorPerform("equals", {});
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].owner, "bank");
  assert.equal(handoffs[0].editor, "=");

  const ordinary = modalFor(report("note", { note_kind: "note", contract: undefined, capabilities: ["props_v1"] }));
  await ordinary.propertyEditorPerform("equals", {});
  assert.match(ordinary.announce, /no card editor/);

  const saving = modalFor(show);
  saving.pendingApply = true;
  await saving.propertyEditorPerform("equals", {});
  assert.match(saving.announce, /wait for the property save/i);
});

const PRJ_LINE = "- [ ] Ship the first slice #prj ^project-task";
const PRJ_SOURCE = ["---", "type: project", "---", PRJ_LINE, ""].join("\n");

function handoffModal({ source = PRJ_SOURCE, line = PRJ_LINE, withPicker = true, leaves = null } = {}) {
  const cursors = [];
  const focused = [];
  const editor = {
    content: source,
    getValue() { return this.content; },
    setCursor(pos) { cursors.push(pos); },
    scrollIntoView() {},
    focus() { focused.push(true); },
  };
  const leaf = { view: { file: { path: "notes/project.md" }, editor } };
  const writes = [];
  const picked = [];
  const openedLinks = [];
  const activeSets = [];
  const show = report("project");
  if (line !== PRJ_LINE) {
    show.contract = contract("project", { prj: { ...contract("project").prj, line } });
  }
  const app = {
    vault: {
      getAbstractFileByPath: (path) => ({ path }),
      cachedRead: async () => source,
      read: async () => source,
      modify: async () => { writes.push("modify"); },
      create: async () => { writes.push("create"); },
    },
    workspace: {
      activeLeaf: leaves === null ? leaf : null,
      getLeavesOfType: () => (leaves === null ? [leaf] : leaves),
      getMostRecentLeaf: () => (leaves === null ? leaf : null),
      setActiveLeaf: (...args) => { activeSets.push(args); },
      openLinkText: async (...args) => { openedLinks.push(args); },
    },
    plugins: withPicker
      ? { plugins: { "bob-navigation-hotkeys": { openBulletPropertyPicker: async (...args) => { picked.push(args); return true; } } } }
      : { plugins: {} },
  };
  const modal = modalFor(show);
  modal.app = app;
  modal.propertyPlugin = { app };
  modal.close = () => { modal.closed = true; };
  return { modal, editor, leaf, cursors, focused, writes, picked, openedLinks, activeSets };
}

test("project task rows hand off to the Task Card at the validated ^prj line", async () => {
  const fix = handoffModal();
  const entry = H.propertyEditorSettingsFindEntry(fix.modal, "project-task::goal");
  await fix.modal.propertyEditorActivate(entry);
  assert.deepEqual(fix.cursors, [{ line: 3, ch: 0 }]);
  assert.equal(fix.picked.length, 1);
  assert.equal(fix.picked[0][0], fix.editor);
  assert.equal(fix.modal.closed, true);
  assert.deepEqual(fix.writes, [], "navigation never writes task fields or frontmatter");
  assert.deepEqual(fix.openedLinks, [], "a leaf already shows the note, so no navigation opens");
});

test("project status rows navigate only, without writing", async () => {
  const fix = handoffModal();
  const entry = H.propertyEditorSettingsFindEntry(fix.modal, "status::4");
  assert.equal(entry.entryType, "project-status");
  await fix.modal.propertyEditorActivate(entry);
  assert.deepEqual(fix.cursors, [{ line: 3, ch: 0 }]);
  assert.equal(fix.picked.length, 1);
  assert.equal(fix.modal.closed, true);
  assert.deepEqual(fix.writes, []);
});

test("a stale ^prj line refuses instead of landing on another task", async () => {
  const gone = ["---", "type: project", "---", "- [ ] Something else entirely", ""].join("\n");
  const fix = handoffModal({ source: gone });
  await fix.modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(fix.modal, "project-task::depends_on"));
  assert.match(fix.modal.announce, /could not be found/);
  assert.equal(fix.picked.length, 0);
  assert.equal(fix.modal.closed, false);
  assert.deepEqual(fix.cursors, []);
});

test("an editor that disagrees with the vault refuses the handoff", async () => {
  const fix = handoffModal();
  fix.editor.content = ["---", "type: project", "---", "- [ ] Rewritten elsewhere", ""].join("\n");
  await fix.modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(fix.modal, "project-task::goal"));
  assert.match(fix.modal.announce, /could not be found/);
  assert.equal(fix.picked.length, 0);
  assert.equal(fix.modal.closed, false);
});

test("a missing Task Card falls back to the cursor without writing", async () => {
  const fix = handoffModal({ withPicker: false });
  await fix.modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(fix.modal, "project-task::starts"));
  assert.deepEqual(fix.cursors, [{ line: 3, ch: 0 }]);
  assert.equal(fix.focused.length, 1);
  assert.equal(fix.modal.closed, true);
  assert.deepEqual(fix.writes, []);
});

test("an absent ^prj reports absence without creating anything", async () => {
  const fix = handoffModal({ line: null });
  await fix.modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(fix.modal, "project-task::goal"));
  assert.match(fix.modal.announce, /No current \^prj task/);
  assert.equal(fix.picked.length, 0);
  assert.equal(fix.modal.closed, false);
  assert.deepEqual(fix.openedLinks, [], "absence never navigates, let alone creates");
  assert.deepEqual(fix.writes, []);
});

test("a closed project still navigates to its ^prj line", async () => {
  const doneLine = "- [x] Ship the first slice #prj ^project-task @done(2026-11-20)";
  const doneSource = ["---", "type: project", "---", "status: done", doneLine, ""].join("\n");
  const fix = handoffModal({ source: doneSource, line: doneLine });
  await fix.modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(fix.modal, "project-task::goal"));
  assert.equal(fix.picked.length, 1);
  assert.deepEqual(fix.cursors, [{ line: 4, ch: 0 }]);
  assert.equal(fix.modal.closed, true);
  assert.deepEqual(fix.writes, []);
});

test("a project not shown in any pane opens before its ^prj line is validated", async () => {
  // The editor was opened by path while another note (the bank) holds the
  // recent pane: the handoff must navigate rather than read the wrong note.
  const fix = handoffModal({ leaves: [] });
  const bankEditor = { getValue: () => "# Bank\n", setCursor() { throw new Error("wrong note"); }, focus() {} };
  const pane = { view: { file: { path: "bank.md" }, editor: bankEditor } };
  const workspace = fix.modal.app.workspace;
  workspace.activeLeaf = pane;
  workspace.getMostRecentLeaf = () => pane;
  workspace.getLeavesOfType = () => [pane];
  workspace.openLinkText = async (...args) => {
    fix.openedLinks.push(args);
    pane.view = fix.leaf.view;
  };
  await fix.modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(fix.modal, "project-task::goal"));
  assert.equal(fix.openedLinks.length, 1, "the project note is opened first");
  assert.equal(fix.openedLinks[0][1], fix.modal.filePath);
  assert.deepEqual(fix.cursors, [{ line: 3, ch: 0 }]);
  assert.equal(fix.picked.length, 1);
  assert.equal(fix.picked[0][0], fix.editor);
  assert.equal(fix.modal.closed, true);
  assert.deepEqual(fix.writes, []);
});

test("a project that still cannot be shown refuses without touching another note", async () => {
  const fix = handoffModal({ leaves: [] });
  const pane = { view: { file: { path: "bank.md" }, editor: { getValue: () => "# Bank\n", setCursor() { throw new Error("wrong note"); } } } };
  fix.modal.app.workspace.activeLeaf = pane;
  fix.modal.app.workspace.getMostRecentLeaf = () => pane;
  await fix.modal.propertyEditorActivate(H.propertyEditorSettingsFindEntry(fix.modal, "project-task::goal"));
  assert.equal(fix.openedLinks.length, 1);
  assert.match(fix.modal.announce, /could not be opened/);
  assert.equal(fix.picked.length, 0);
  assert.equal(fix.modal.closed, false);
  assert.deepEqual(fix.writes, []);
});
