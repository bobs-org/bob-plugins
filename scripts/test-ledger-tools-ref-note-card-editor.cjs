// Ref Card editor (bob-cli-qp ref-editor): == routing on
// props_ref_contract_v1, REFERENCE settings rows, owned-elsewhere routes,
// set-only refusals, and the Esc/q/Ctrl+[ ladder.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {}, Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
      Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
      normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

const REF_IDS = ["title", "summary", "author", "published", "source", "aliases", "reading", "parent", "file_name"];
const REF_KEYS = {
  title: ["title"], summary: ["summary"], author: ["author"], published: ["published"],
  source: ["source_url", "url"], aliases: ["aliases"], reading: ["status"],
  parent: ["parent"], file_name: [],
};
const REF_STAGES = {
  title: "title", summary: "summary", author: "text", published: "published",
  source: "url", aliases: "list", reading: "read_only", parent: "read_only", file_name: "read_only",
};
const REF_LABELS = {
  title: "Title", summary: "Summary", author: "Authors", published: "Published",
  source: "Source", aliases: "Aliases", reading: "Reading", parent: "Lives under", file_name: "File name",
};

function refSetting(id, overrides = {}) {
  const owned = ["reading", "parent", "file_name"].includes(id);
  return {
    id, label: REF_LABELS[id], keys: REF_KEYS[id], stage: REF_STAGES[id],
    declared: overrides.declared === true,
    value: Object.hasOwn(overrides, "value") ? overrides.value : null,
    effective: {
      value: Object.hasOwn(overrides, "effectiveValue") ? overrides.effectiveValue : null,
      source: overrides.source || "none",
      from: Object.hasOwn(overrides, "from") ? overrides.from : null,
      label: overrides.label || "none",
    },
    choices: [], issues: [], help: `${REF_LABELS[id]} help`,
    disabled: owned,
    ...(owned ? {
      reason: overrides.reason || `${REF_LABELS[id]} is owned elsewhere.`,
      route: overrides.route || (id === "file_name" ? "ref_rename" : "reading_task"),
      ...(overrides.target !== undefined ? { target: overrides.target } : {}),
    } : {}),
    ...overrides.extra,
  };
}

function refContract(overrides = {}) {
  const settings = REF_IDS.map((id) => {
    if (id === "title") {
      return refSetting(id, {
        declared: true, value: "Attention Is All You Need", effectiveValue: "Attention Is All You Need",
        source: "self", label: "set on this note",
      });
    }
    if (id === "summary") {
      return refSetting(id, {
        declared: true, value: "Why transformers replaced recurrence.", effectiveValue: "Why transformers replaced recurrence.",
        source: "self", label: "set on this note",
      });
    }
    if (id === "author") {
      return refSetting(id, {
        declared: true, value: "Vaswani et al.", effectiveValue: "Vaswani et al.",
        source: "self", label: "set on this note",
      });
    }
    if (id === "published") {
      return refSetting(id, {
        declared: true, value: "2017-06", effectiveValue: "2017-06",
        source: "self", label: "set on this note",
      });
    }
    if (id === "source") {
      return refSetting(id, {
        declared: true, value: "https://arxiv.org/abs/1706.03762", effectiveValue: "https://arxiv.org/abs/1706.03762",
        source: "self", label: "set on this note",
      });
    }
    if (id === "aliases") {
      return refSetting(id, {
        declared: true, value: ["Transformer paper"], effectiveValue: ["Transformer paper"],
        source: "self", label: "set on this note",
      });
    }
    if (id === "reading") {
      return refSetting(id, {
        source: "task", label: "Owned by the reading task",
        target: "![[memory.md#^ref-attention]]",
      });
    }
    if (id === "parent") {
      return refSetting(id, {
        source: "task", label: "Follows the reading task's residence",
        target: "![[memory.md#^ref-attention]]",
      });
    }
    return refSetting(id, {
      value: "attention_is_all_you_need", effectiveValue: "attention_is_all_you_need",
      source: "path", label: "Rename through bob ref rename",
    });
  });
  return { kind: "reference", settings, ...overrides };
}

function refRow(key, line, overrides = {}) {
  return {
    key, line, end_line: line, value: "value", kind: "text", role: "loose", owner: "props",
    editor: null, reason: null, duplicate: false, opaque: false, ...overrides,
  };
}

function refReport(overrides = {}) {
  const properties = [
    refRow("title", 3, { value: "Attention Is All You Need" }),
    refRow("summary", 4, { value: "Why transformers replaced recurrence." }),
    refRow("author", 5, { value: "Vaswani et al." }),
    refRow("published", 6, { value: "2017-06" }),
    refRow("source_url", 7, { value: "https://arxiv.org/abs/1706.03762" }),
    refRow("aliases", 8, { value: ["Transformer paper"], kind: "list" }),
    refRow("type", 9, { value: "[[ref]]", role: "identity", reason: "Identity is fixed." }),
    refRow("id", 10, { value: "1706.03762", role: "identity", reason: "Identity is fixed." }),
    refRow("created", 11),
  ];
  return {
    schema_version: 1, ok: true, path: "ref/attention_is_all_you_need.md", note_kind: "reference",
    capabilities: ["props_v1", "props_ref_contract_v1"], fingerprint: "sha256:before",
    frontmatter: { state: "ok", start_line: 1, end_line: 30 }, properties,
    contract: refContract(), ...overrides,
  };
}

function modalFor(show, options = {}, plugin = null) {
  const modal = new H.PropertyEditorModal({}, { filePath: show.path, report: show, plugin, ...options });
  modal.paintPropertyEditor = () => {};
  return modal;
}

test("the == route follows the reference capability", () => {
  assert.equal(H.refNoteCardEditorRoute(["props_v1", "props_ref_contract_v1"]), "settings");
  assert.equal(H.refNoteCardEditorRoute(["props_v1", "props_contract_v1"]), "title-fallback");
  assert.equal(H.refNoteCardEditorRoute(["props_v1"]), "title-fallback");
  assert.equal(H.refNoteCardEditorRoute([]), "title-fallback");
  assert.equal(H.refNoteCardEditorRoute(null), "title-fallback");
  assert.equal(H.refNoteCardEditorRoute(undefined), "title-fallback");
});

test("== opens settings mode when the capability is confirmed, else title focus-or-add", () => {
  const opened = [];
  const confirmed = {
    openPropertyEditor(options) { opened.push(options); return { ok: true }; },
    propertyCapabilityRefContractConfirmed() { return true; },
  };
  assert.equal(H.refNoteCardEditorCapabilityConfirmed(confirmed), true);
  assert.equal(H.refNoteCardEditorOpen(confirmed, "ref/attention_is_all_you_need.md"), true);
  assert.deepEqual(opened, [{
    filePath: "ref/attention_is_all_you_need.md", noteKind: "reference", focusSettings: true,
  }]);

  const pending = {
    openPropertyEditor(options) { opened.push(options); return { ok: true }; },
    propertyCapabilityRefContractConfirmed() { return false; },
  };
  assert.equal(H.refNoteCardEditorCapabilityConfirmed(pending), false);
  assert.equal(H.refNoteCardEditorOpen(pending, "ref/attention_is_all_you_need.md"), true);
  assert.deepEqual(opened[1], { filePath: "ref/attention_is_all_you_need.md", key: "title" });

  assert.equal(H.refNoteCardEditorCapabilityConfirmed({}), false, "unknown cache reads as pending");
  assert.equal(H.refNoteCardEditorCapabilityConfirmed(null), false);
  assert.equal(H.refNoteCardEditorOpen({}, "ref/x.md"), false, "no opener refuses");
  assert.equal(H.refNoteCardEditorOpen(confirmed, ""), false, "no path refuses");
});

test("the reference contract shape validates its nine settings", () => {
  assert.deepEqual(H.PROPERTY_EDITOR_SETTING_ORDER.reference, REF_IDS);
  for (const id of REF_IDS) {
    assert.deepEqual(H.PROPERTY_EDITOR_SETTING_KEYS[id], REF_KEYS[id]);
  }
  assert.equal(H.propertyEditorSettingsContractCapabilityFor("reference"), "props_ref_contract_v1");
  assert.equal(H.propertyEditorSettingsContractCapabilityFor("area"), "props_contract_v1");
  assert.equal(H.propertyEditorSettingsContractCapabilityFor("note"), "");
  assert.equal(H.propertyEditorSettingsContractShape(refContract(), "reference"), true);
  assert.equal(H.propertyEditorSettingsSupported(refReport()), true);
  assert.equal(
    H.propertyEditorSettingsSupported(refReport({ capabilities: ["props_v1"] })),
    false,
    "an older bob without the ref capability falls back to title focus-or-add",
  );
  assert.equal(
    H.propertyEditorSettingsSupported(refReport({ capabilities: ["props_v1", "props_contract_v1"] })),
    false,
    "the generic contract never stands in for the reference contract",
  );
  assert.equal(
    H.propertyEditorSettingsSupported(refReport({ note_kind: "area" })),
    false,
    "a reference contract on another kind is not supported",
  );
});

test("reference rows split into REFERENCE SETTINGS and OWNED ELSEWHERE", () => {
  const show = refReport();
  const modal = modalFor(show);
  modal.propertyEditorReconcile(show);
  const groups = H.propertyEditorSettingsGroups(modal);
  assert.equal(groups[0].title, "REFERENCE SETTINGS");
  assert.deepEqual(groups[0].rows.map((entry) => entry.id), [
    "setting::title", "setting::summary", "setting::author",
    "setting::published", "setting::source", "setting::aliases",
  ]);
  assert.equal(groups[1].title, "OWNED ELSEWHERE");
  assert.deepEqual(groups[1].rows.map((entry) => entry.id), [
    "setting::reading", "setting::parent", "setting::file_name",
  ]);
  for (const entry of groups[1].rows) {
    assert.equal(entry.entryType, "reference-route");
    assert.equal(entry.group, "owned");
    assert.equal(entry.row.propertyEntryType, "reference-route");
    assert.ok(entry.row.settingRoute, "every owned row names its route");
    assert.ok(entry.row.disabledReason, "bob's reason explains the route");
  }
  const reading = H.propertyEditorSettingsFindEntry(modal, "setting::reading");
  assert.equal(reading.row.settingRoute, "reading_task");
  assert.equal(reading.row.settingTarget, "![[memory.md#^ref-attention]]");
  const name = H.propertyEditorSettingsFindEntry(modal, "setting::file_name");
  assert.equal(name.row.settingRoute, "ref_rename");
  assert.equal(name.row.settingTarget, "");
  assert.equal(H.propertyEditorBadgeKind("reference"), "reference");
});

test("== and = land on the first settings row once the contract arrives", () => {
  const show = refReport();
  const modal = modalFor(show, { focusSettings: true });
  modal.propertyEditorReconcile(show);
  assert.equal(modal.selectedId, "setting::title");
  modal.propertyEditorSelect("setting::reading");
  modal.propertyEditorReconcile(show);
  assert.equal(modal.selectedId, "setting::reading", "a later reconcile never yanks the selection back");
});

test("owned rows refuse generic edits and route instead", async () => {
  const show = refReport();
  const modal = modalFor(show);
  modal.propertyEditorReconcile(show);
  const reading = H.propertyEditorSettingsFindEntry(modal, "setting::reading");
  assert.equal(H.propertyEditorCanMutate(reading.row), false);
  assert.deepEqual(H.propertyEditorSettingsActionForRow(reading.row), {
    action: "reference-route", key: "Reading", route: "reading_task",
  });
  modal.selectedId = reading.id;
  await H.propertyEditorSettingsDelete(modal);
  assert.equal(modal.refusal.code, "locked");
  assert.match(modal.refusal.message, /owned elsewhere/);
  const title = H.propertyEditorSettingsFindEntry(modal, "setting::title");
  modal.selectedId = title.id;
  await H.propertyEditorSettingsDelete(modal);
  assert.equal(modal.refusal.code, "locked");
  assert.match(modal.refusal.message, /set-only/);
  const source = H.propertyEditorSettingsFindEntry(modal, "setting::source");
  modal.selectedId = source.id;
  await H.propertyEditorSettingsDelete(modal);
  assert.match(modal.refusal.message, /set-only/);
  modal.stage = { settingId: "title", rowId: title.id };
  assert.equal(await modal.propertyEditorClearCurrentSetting(), false);
  assert.match(modal.refusal.message, /set-only/);
});

test("editable rows open typed stages and build setting ops", () => {
  const show = refReport();
  const modal = modalFor(show);
  modal.propertyEditorReconcile(show);
  assert.deepEqual(H.propertyEditorSettingStageHandler("title"), { kind: "generic-text", wireKind: "text" });
  assert.deepEqual(H.propertyEditorSettingStageHandler("author"), { kind: "generic-text", wireKind: "text" });
  assert.deepEqual(H.propertyEditorSettingStageHandler("published"), { kind: "generic-text", wireKind: "text" });
  assert.deepEqual(H.propertyEditorSettingStageHandler("source"), { kind: "generic-text", wireKind: "text" });
  assert.deepEqual(H.propertyEditorSettingStageHandler("aliases"), { kind: "list", wireKind: "list" });
  assert.equal(H.propertyEditorSettingStageHandler("reading"), null, "owned rows have no stage");
  assert.equal(H.propertyEditorSettingStageHandler("file_name"), null, "owned rows have no stage");
  const title = H.propertyEditorSettingsFindEntry(modal, "setting::title");
  const resolved = modal.propertyEditorResolveSettingStage(title);
  assert.equal(resolved.ok, true);
  modal.stage = resolved.stage;
  const stageInput = (stage, value) => ({
    value,
    getAttribute(name) {
      if (name === "data-property-stage-kind") return stage.kind;
      if (name === "data-property-stage-id") return String(stage.id);
      return null;
    },
  });
  modal.propertyEditorStageInputChanged(stageInput(modal.stage, "Attention Is All You Need (extended)"));
  modal.editorEnsureSession = () => ({
    applyOps: async () => ({ ok: true, report: { ok: true } }),
    getState: () => ({ status: "browsing", preview: null }),
  });
  const built = modal.propertyEditorBuildCurrentStage();
  assert.equal(built.ok, true);
  assert.deepEqual(built.ops, [{
    op: "setting.set", setting: "title", value: "Attention Is All You Need (extended)",
  }]);
  const aliases = H.propertyEditorSettingsFindEntry(modal, "setting::aliases");
  const aliasResolved = modal.propertyEditorResolveSettingStage(aliases);
  assert.equal(aliasResolved.ok, true);
  modal.stage = aliasResolved.stage;
  modal.stage.itemDraft = "Attention sequel";
  const aliasBuilt = modal.propertyEditorBuildCurrentStage();
  assert.equal(aliasBuilt.ok, true);
  assert.deepEqual(aliasBuilt.ops, [{
    op: "setting.set", setting: "aliases", value: ["Transformer paper", "Attention sequel"],
  }]);
});

test("the preview carries bob's marker-sync and link-text effects", () => {
  const preview = {
    contract: refContract(),
    effects: [
      {
        setting: "title", kind: "syncs", message: "Syncs to the PDF marker at the next writing scan",
        from: "Old", to: "New", count: null, syncs: ["pdf_marker"],
      },
      {
        setting: "title", kind: "reading_task_link_text",
        message: "The reading task keeps its link text; open it to retitle.", syncs: [],
      },
    ],
    warnings: [],
  };
  const text = H.propertyEditorSettingPreviewText(preview, "title");
  assert.match(text, /Syncs to the PDF marker/);
  assert.match(text, /reading task keeps its link text/);
});

test("Enter on Reading opens the reading task; legacy notes stay with a notice", async () => {
  const opened = [];
  let closed = 0;
  const app = { workspace: { openLinkText: async (link, source, leaf) => { opened.push([link, source, leaf]); } } };
  const show = refReport();
  const modal = modalFor(show, {}, { app });
  modal.close = () => { closed += 1; };
  modal.propertyEditorReconcile(show);
  const reading = H.propertyEditorSettingsFindEntry(modal, "setting::reading");
  const followed = await modal.propertyEditorActivate(reading);
  assert.equal(followed.ok, true);
  assert.deepEqual(opened, [["memory.md#^ref-attention", "ref/attention_is_all_you_need.md", false]]);
  assert.equal(closed, 1, "navigating away closes the editor");

  const legacySettings = refContract().settings.map((entry) => ["reading", "parent"].includes(entry.id)
    ? { ...entry, target: undefined, reason: "No managed reading-task tracker", route: "reading_task" }
    : entry);
  const legacy = refReport({ contract: refContract({ settings: legacySettings }) });
  const legacyModal = modalFor(legacy, {}, { app });
  legacyModal.propertyEditorReconcile(legacy);
  const legacyReading = H.propertyEditorSettingsFindEntry(legacyModal, "setting::reading");
  assert.equal(legacyReading.row.settingTarget, "");
  const refused = await legacyModal.propertyEditorActivate(legacyReading);
  assert.equal(refused.ok, false);
  assert.match(legacyModal.announce, /legacy reference/);
  assert.deepEqual(opened.length, 1, "no navigation without a target");
});

test("Enter on File name opens Command Mode when present and always copies the rename", async () => {
  const written = [];
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (text) => { written.push(text); } } },
    configurable: true, writable: true,
  });
  try {
    const show = refReport();
    const sheeted = [];
    const app = {
      workspace: {},
      plugins: { plugins: { "bob-command-mode": { api: { commandMode: {} } } } },
      commands: { executeCommandById: async (id) => { sheeted.push(id); } },
    };
    const modal = modalFor(show, {}, { app });
    let closed = 0;
    modal.close = () => { closed += 1; };
    modal.propertyEditorReconcile(show);
    const name = H.propertyEditorSettingsFindEntry(modal, "setting::file_name");
    const followed = await modal.propertyEditorActivate(name);
    assert.equal(followed.ok, true);
    assert.deepEqual(sheeted, ["bob-command-mode:open"]);
    assert.deepEqual(written, ["bob ref rename attention_is_all_you_need <NEW>"]);
    assert.equal(closed, 0, "the editor stays open behind the sheet");

    const plain = modalFor(show, {}, { workspace: {} });
    plain.propertyEditorReconcile(show);
    const plainName = H.propertyEditorSettingsFindEntry(plain, "setting::file_name");
    const copied = await plain.propertyEditorActivate(plainName);
    assert.equal(copied.ok, true);
    assert.deepEqual(written, [
      "bob ref rename attention_is_all_you_need <NEW>",
      "bob ref rename attention_is_all_you_need <NEW>",
    ], "without Command Mode the command still reaches the clipboard");
  } finally {
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    else delete globalThis.navigator;
  }
});

test("a rename without a clipboard says the command out loud", async () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  try {
    const show = refReport();
    const modal = modalFor(show, {}, { workspace: {} });
    modal.propertyEditorReconcile(show);
    const name = H.propertyEditorSettingsFindEntry(modal, "setting::file_name");
    const refused = await modal.propertyEditorActivate(name);
    assert.equal(refused.ok, false);
    assert.match(modal.announce, /bob ref rename attention_is_all_you_need <NEW>/);
  } finally {
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    else delete globalThis.navigator;
  }
});

test("the Esc/q/Ctrl+[ ladder still closes the Reference editor", () => {
  assert.equal(H.propertyEditorKeyAction({ key: "Escape" }, { inInput: false }), "close");
  assert.equal(H.propertyEditorKeyAction({ key: "q" }, { inInput: false }), "close");
  assert.equal(
    H.propertyEditorKeyAction({ key: "[", ctrlKey: true, code: "BracketLeft" }, { inInput: false }),
    "close",
  );
  const show = refReport();
  const modal = modalFor(show);
  modal.propertyEditorReconcile(show);
  const title = H.propertyEditorSettingsFindEntry(modal, "setting::title");
  const resolved = modal.propertyEditorResolveSettingStage(title);
  assert.equal(resolved.ok, true);
  assert.equal(
    H.propertyEditorCloseLadder({ menuOpen: false, stage: resolved.stage, filterOpen: false }),
    "stage",
    "the first rung parks the open stage, not the modal",
  );
  assert.equal(
    H.propertyEditorCloseLadder({ menuOpen: false, stage: null, filterOpen: false }),
    "modal",
    "the last rung closes the modal",
  );
});

test("an older bob keeps the title fallback and a stubbed new bob previews both contracts", () => {
  const old = refReport({ capabilities: ["props_v1"], contract: undefined });
  const modal = modalFor(old, { key: "title" });
  modal.propertyEditorReconcile(old);
  assert.equal(H.propertyEditorSettingsSupported(modal.report), false);
  const rows = H.propertyEditorSettingsAllEntries(modal);
  assert.ok(rows.every((entry) => entry.entryType === "source" || entry.source === true));
  const selected = H.propertyEditorSettingsFindEntry(modal, modal.selectedId);
  assert.ok(selected && selected.row.key === "title", "focus-or-add lands on the title row");
});

test("embed targets parse to openable links", () => {
  assert.equal(H.refNoteCardEmbedTarget("![[memory.md#^ref-attention]]"), "memory.md#^ref-attention");
  assert.equal(H.refNoteCardEmbedTarget("![[memory.md]]"), "memory.md");
  assert.equal(H.refNoteCardEmbedTarget("![[memory.md|Memory]]"), "memory.md");
  assert.equal(H.refNoteCardEmbedTarget(null), "");
  assert.equal(H.refNoteCardEmbedTarget("memory.md"), "");
  assert.equal(H.refNoteCardRenameCommand("attention_is_all_you_need"), "bob ref rename attention_is_all_you_need <NEW>");
});
