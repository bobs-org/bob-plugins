// Property Editor setting stages: typed set/clear ops, simple controls,
// preview effects/warnings, and confirmed contract adoption.
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
          ? { declared: false, value: null, effectiveValue: null, source: "none", label: "required · missing" }
          : id === "color" ? { effectiveValue: "teal", label: "teal · inherited from parent" }
            : id === "root" ? { declared: false, disabled: true, effectiveValue: false, label: "Disabled on a top-level project" }
            : id === "ready_cap" ? { effectiveValue: 8, label: "8 · Bob setting (plan.max_ready_per_note)" }
              : id === "task_refresh" ? { effectiveValue: 7, label: "7 days · Bob setting (freshness.interval)" }
                : { effectiveValue: ["shared"], label: "inherited from parent" }));
  return { kind, settings, ...(kind === "project" ? { prj: {
    line: "- [ ] Ship the first slice #prj ^project-task", criterion: "Ship the first slice",
    scheduled: "2026-12-01", depends_on: ["[[Plan]]#^blocked-by"], blocks: [],
  } } : {}), ...overrides };
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
    row("theme", 6, { value: "Drafting" }), row("offclock", 7, { value: false, kind: "checkbox" }),
    row("offclock_types", 8, { value: ["writing"], kind: "list" }),
    row("created", 9),
  ] : [
    row("summary", 3, { value: "A calm area" }), row("theme", 4, { value: "Drafting" }),
    row("offclock", 5, { value: false, kind: "checkbox" }),
    row("offclock_types", 6, { value: ["writing"], kind: "list" }),
    row("created", 7), row("aliases", 8, { kind: "aliases" }),
    row("type", 12, { value: "area", role: "identity", reason: "Identity is fixed." }),
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

function previewSession(options = {}) {
  const session = {
    drafts: [],
    applied: [],
    inverse: options.inverse || [{ op: "prop.restore", key: "summary", value: "A calm area" }],
    state: { status: "browsing", draftOps: [], canApply: false, preview: null },
    setDraft(ops) {
      this.drafts.push(ops.slice());
      this.state = {
        status: ops.length ? "preview-pending" : "browsing",
        draftOps: ops.slice(), canApply: false, preview: null,
      };
      return this.state;
    },
    async previewNow() {
      const report = options.previewReport || {
        ok: true, dry_run: true, changed: true, properties: options.properties,
        contract: options.contract, effects: options.effects || [], warnings: options.warnings || [],
      };
      this.state = { status: "preview-ready", draftOps: this.state.draftOps.slice(), canApply: true, preview: report };
      return { ok: true, report };
    },
    getState() { return this.state; },
    async apply() {
      this.applied.push(this.state.draftOps.slice());
      const confirmed = options.applyReport || {
        ok: true, dry_run: false, changed: true, fingerprint_after: "sha256:after",
        properties: options.properties, contract: options.contract,
        inverse_ops: this.inverse,
      };
      return { ok: true, changed: true, report: confirmed };
    },
    async applyOps(ops) {
      this.setDraft(ops);
      await this.previewNow();
      return this.apply();
    },
    async undo() {
      this.applied.push(this.inverse.slice());
      return {
        ok: true, changed: true,
        report: options.undoReport || {
          ok: true, dry_run: false, changed: true, fingerprint_after: "sha256:before",
          properties: options.undoProperties, contract: options.undoContract,
          inverse_ops: this.state.draftOps,
        },
      };
    },
  };
  return session;
}

function inputFor(stage, value) {
  return {
    value,
    getAttribute(name) {
      if (name === "data-property-stage-kind") return stage.kind;
      if (name === "data-property-stage-id") return String(stage.id);
      return null;
    },
  };
}

test("setting op helpers emit typed set/clear shapes and refuse a scalar clock", () => {
  assert.deepEqual(H.propertyEditorSettingSetOp("summary", "Hello"), { op: "setting.set", setting: "summary", value: "Hello" });
  assert.deepEqual(H.propertyEditorSettingClearOp("color"), { op: "setting.clear", setting: "color" });
  assert.deepEqual(H.propertyEditorSettingClockObject("on").value, { mode: "on" });
  assert.deepEqual(H.propertyEditorSettingClockObject("MEET, CALL").value, { mode: "types", types: ["MEET", "CALL"] });
  assert.equal(H.propertyEditorSettingClockObject(true).ok, false);
  assert.match(H.propertyEditorSettingClockObject("").value.mode, /inherit/);
});

test("summary, ready cap, and review enforce boundaries while long summary still saves", () => {
  assert.equal(H.propertyEditorSettingSummaryValue("one\ntwo").ok, false);
  const long = H.propertyEditorSettingSummaryValue("x".repeat(141));
  assert.equal(long.ok, true);
  assert.equal(long.warnLong, true);
  assert.deepEqual(H.propertyEditorSettingReadyCapValue(false), { ok: true, value: "off", off: true });
  assert.deepEqual(H.propertyEditorSettingReadyCapValue("OFF"), { ok: true, value: "off", off: true });
  assert.equal(H.propertyEditorSettingReadyCapValue(0).ok, false);
  assert.equal(H.propertyEditorSettingReadyCapValue(1000).ok, false);
  assert.equal(H.propertyEditorSettingReadyCapValue(8).value, 8);
  assert.equal(H.propertyEditorSettingReviewValue(0).ok, false);
  assert.equal(H.propertyEditorSettingReviewValue(366).ok, false);
  assert.equal(H.propertyEditorSettingReviewValue(7).value, 7);
});

test("ghost Enter seeds an override draft from effective data and writes nothing until save", async () => {
  const show = report("area");
  const modal = modalFor(show);
  let writes = 0;
  modal.editorEnsureSession = () => ({
    applyOps: async () => { writes += 1; return { ok: true }; },
    setDraft() { return {}; },
    apply: async () => { writes += 1; return { ok: true }; },
  });
  const entry = H.propertyEditorSettingsFindEntry(modal, "setting::color");
  await modal.propertyEditorActivate(entry);
  assert.equal(modal.stage.settingId, "color");
  assert.equal(modal.stage.value, "teal");
  assert.equal(writes, 0);
  modal.propertyEditorCancelStage();
  assert.equal(modal.stage, null);
  assert.equal(writes, 0);
});

test("summary save uses setting.set and keeps ordinary text stages on prop.set", () => {
  const show = report("area");
  const modal = modalFor(show);
  const entry = H.propertyEditorSettingsFindEntry(modal, "setting::summary");
  const opened = modal.propertyEditorResolveSettingStage(entry);
  assert.equal(opened.ok, true);
  modal.stage.value = "Garden";
  const built = modal.propertyEditorBuildCurrentStage();
  assert.equal(built.ok, true);
  assert.deepEqual(built.ops, [{ op: "setting.set", setting: "summary", value: "Garden" }]);

  const loose = { id: "created::7", row: row("created", 7, { value: "2020-01-01" }) };
  modal.stage = { id: 9, rowId: loose.id, key: "created", kind: "text", wireKind: "text", value: "2021-01-01", items: [] };
  modal.editorOrderedRows = () => [loose];
  const generic = H.propertyEditorStageBuild(loose.row, modal.stage, { value: "2021-01-01" });
  assert.equal(generic.ops[0].op, "prop.set");
  assert.equal(generic.ops[0].key, "created");
});

test("ready cap writes off, never a stored count, and review stays in 1–365", async () => {
  const show = report("area");
  const modal = modalFor(show);
  const cap = H.propertyEditorSettingsFindEntry(modal, "setting::ready_cap");
  modal.propertyEditorResolveSettingStage(cap);
  modal.propertyEditorToggleReadyCapOff();
  const built = modal.propertyEditorBuildCurrentStage();
  assert.deepEqual(built.ops, [{ op: "setting.set", setting: "ready_cap", value: "off" }]);
  modal.stage.off = false;
  modal.stage.value = "12";
  assert.deepEqual(modal.propertyEditorBuildCurrentStage().ops[0], { op: "setting.set", setting: "ready_cap", value: 12 });

  const review = H.propertyEditorSettingsFindEntry(modalFor(show), "setting::task_refresh");
  const reviewModal = modalFor(show);
  reviewModal.propertyEditorResolveSettingStage(review);
  reviewModal.stage.value = "400";
  assert.equal(reviewModal.propertyEditorBuildCurrentStage().ok, false);
  reviewModal.stage.value = "30";
  assert.deepEqual(reviewModal.propertyEditorBuildCurrentStage().ops[0], { op: "setting.set", setting: "task_refresh", value: 30 });
});

test("capture names keep order on setting.set and clock never submits a scalar", () => {
  const modal = modalFor(report("area"));
  const names = H.propertyEditorSettingsFindEntry(modal, "setting::project_name_aliases");
  modal.propertyEditorResolveSettingStage(names);
  modal.stage.items = ["zeta", "alpha"];
  modal.stage.itemDraft = "beta";
  const built = modal.propertyEditorBuildCurrentStage();
  assert.deepEqual(built.ops[0], { op: "setting.set", setting: "project_name_aliases", value: ["zeta", "alpha", "beta"] });

  const clockModal = modalFor(report("area"));
  const clock = H.propertyEditorSettingsFindEntry(clockModal, "setting::clock");
  clockModal.propertyEditorResolveSettingStage(clock);
  assert.equal(clockModal.stage.value, "writing");
  clockModal.stage.value = "off";
  assert.deepEqual(clockModal.propertyEditorBuildCurrentStage().ops[0], {
    op: "setting.set", setting: "clock", value: { mode: "off" },
  });
});

test("stats root Enter sets true or clears, never root:false, and stays locked on top-level projects", async () => {
  const leafShow = report("project");
  const rootSetting = leafShow.contract.settings.find((item) => item.id === "root");
  rootSetting.disabled = false;
  rootSetting.declared = false;
  rootSetting.value = null;
  const modal = modalFor(leafShow);
  const entry = H.propertyEditorSettingsFindEntry(modal, "setting::root");
  const session = previewSession({ properties: leafShow.properties, contract: leafShow.contract });
  modal.editorEnsureSession = () => session;
  await modal.propertyEditorActivate(entry);
  assert.deepEqual(session.applied[0], [{ op: "setting.set", setting: "root", value: true }]);
  assert.match(modal.announce, /Past and future time regroup/);

  rootSetting.declared = true;
  rootSetting.value = true;
  leafShow.properties.push(row("root", 10, { value: true, kind: "checkbox" }));
  const declared = modalFor(leafShow);
  const declaredEntry = H.propertyEditorSettingsFindEntry(declared, "setting::root");
  const declaredSession = previewSession({ properties: leafShow.properties, contract: leafShow.contract });
  declared.editorEnsureSession = () => declaredSession;
  await declared.propertyEditorActivate(declaredEntry);
  assert.deepEqual(declaredSession.applied[0], [{ op: "setting.clear", setting: "root" }]);
  assert.equal(H.propertyEditorSettingRootOps(declaredEntry).ops.some((op) => op.value === false), false);

  const locked = modalFor(report("project"));
  let writes = 0;
  locked.editorEnsureSession = () => ({ applyOps: async () => { writes += 1; return { ok: true }; } });
  await locked.propertyEditorActivate(H.propertyEditorSettingsFindEntry(locked, "setting::root"));
  assert.equal(writes, 0);
});

test("preview warnings and candidate effective labels stay out of confirmed report state", async () => {
  const show = report("area");
  const modal = modalFor(show);
  const candidate = {
    kind: "area",
    settings: show.contract.settings.map((item) => item.id === "summary"
      ? { ...item, effective: { ...item.effective, label: "candidate inherited from parent" } }
      : item),
  };
  const session = previewSession({
    properties: show.properties,
    contract: candidate,
    warnings: [{ code: "area_summary_long", message: "Long summary", key: "summary" }],
    effects: [{ setting: "summary", kind: "inherited", message: "Applies below" }],
    applyReport: {
      ok: true, dry_run: false, changed: true, fingerprint_after: "sha256:after",
      properties: show.properties, contract: show.contract,
    },
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  const entry = H.propertyEditorSettingsFindEntry(modal, "setting::summary");
  modal.propertyEditorResolveSettingStage(entry);
  modal.stage.value = "x".repeat(141);
  modal.propertyEditorStageInputChanged(inputFor(modal.stage, modal.stage.value));
  await session.previewNow();
  modal.propertyEditorStageSyncPreview();
  const view = modal.propertyEditorStageView();
  assert.match(view.previewExtras, /candidate inherited from parent/);
  assert.match(view.previewExtras, /Applies below/);
  assert.match(view.previewExtras, /Long summary/);
  assert.equal(modal.report.contract.settings.find((item) => item.id === "summary").effective.label, "set on this note");

  const built = modal.propertyEditorBuildCurrentStage();
  session.state = { ...session.state, status: "preview-ready", canApply: true, draftOps: built.ops };
  await modal.propertyEditorApplyStage(built);
  assert.equal(modal.report.contract.settings.find((item) => item.id === "summary").effective.label, "set on this note");
  assert.equal(modal.report.dry_run, undefined);
});

test("older apply responses without contract invalidate it and re-read props show", async () => {
  const show = report("area");
  const modal = modalFor(show);
  let shows = 0;
  modal.propertyPlugin = {
    apiPropertyShow: async () => {
      shows += 1;
      return { ok: true, report: { ...show, fingerprint: "sha256:refreshed", contract: show.contract } };
    },
  };
  H.propertyEditorAdoptConfirmedContract(modal, {
    ok: true,
    report: { ok: true, dry_run: false, changed: true, fingerprint_after: "sha256:after", properties: show.properties },
  });
  assert.equal(modal.report.contract, undefined);
  assert.equal(modal.contractPending, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(shows, 1);
  assert.equal(modal.report.fingerprint, "sha256:refreshed");
  assert.equal(modal.report.contract.kind, "area");
});

test("clear, undo, and repeated Enter keep one inverse history item", async () => {
  const show = report("area");
  const modal = modalFor(show);
  const session = previewSession({
    properties: show.properties.filter((item) => item.key !== "summary"),
    contract: show.contract,
    undoProperties: show.properties,
    undoContract: show.contract,
  });
  modal.session = session;
  modal.editorEnsureSession = () => session;
  modal.selectedId = "setting::summary";
  await H.propertyEditorSettingsDelete(modal);
  assert.deepEqual(session.applied[0], [{ op: "setting.clear", setting: "summary" }]);
  await modal.propertyEditorHistory("undo");
  assert.equal(session.applied.length, 2);
  assert.deepEqual(session.applied[1], session.inverse);

  const stageModal = modalFor(show);
  const stageSession = previewSession({ properties: show.properties, contract: show.contract });
  stageModal.editorEnsureSession = () => stageSession;
  stageModal.session = stageSession;
  const entry = H.propertyEditorSettingsFindEntry(stageModal, "setting::summary");
  stageModal.propertyEditorResolveSettingStage(entry);
  stageModal.stage.value = "Garden";
  stageModal.propertyEditorStageInputChanged(inputFor(stageModal.stage, "Garden"));
  await stageModal.propertyEditorSaveStage();
  assert.ok(stageModal.pendingStageEnter);
  stageSession.state = { ...stageSession.state, status: "preview-ready", canApply: true };
  stageModal.propertyEditorStageSyncPreview();
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await stageModal.propertyEditorSaveStage();
  assert.equal(stageSession.applied.length, 1);
});

test("stale setting previews keep the draft and ordinary YAML/list builders stay on prop.*", async () => {
  const show = report("area");
  const modal = modalFor(show);
  const session = previewSession({ properties: show.properties, contract: show.contract });
  modal.editorEnsureSession = () => session;
  modal.session = session;
  const entry = H.propertyEditorSettingsFindEntry(modal, "setting::color");
  modal.propertyEditorResolveSettingStage(entry);
  modal.stage.value = "red";
  modal.propertyEditorStageInputChanged(inputFor(modal.stage, "red"));
  await modal.propertyEditorSaveStage();
  assert.ok(modal.pendingStageEnter);
  modal.propertyEditorReconcile({ ...show, fingerprint: "sha256:changed" });
  assert.equal(modal.stage.value, "red");
  assert.equal(modal.stageNeedsPreview, true);
  assert.equal(modal.pendingStageEnter, null);

  const yaml = H.propertyEditorYamlStageBuild(
    { yaml: true, key: "created", seedYaml: "created: 2020-01-01\n" },
    { value: "created: 2021-01-01\n" },
  );
  assert.equal(yaml.ops[0].op, "prop.set_yaml");
  const list = H.propertyEditorStageBuild(row("aliases", 8, { kind: "aliases", value: ["a"] }), { kind: "aliases", wireKind: "aliases" }, { items: ["a", "b"] });
  assert.equal(list.ops[0].op, "prop.set");
});

test("later phases can replace only their setting handler", () => {
  const previous = H.propertyEditorSettingStageHandler("color");
  assert.equal(previous.kind, "generic-text");
  assert.equal(H.propertyEditorRegisterSettingStageHandler("color", { kind: "swatch", wireKind: "text" }), true);
  assert.equal(H.propertyEditorSettingStageHandler("color").kind, "swatch");
  H.propertyEditorRegisterSettingStageHandler("color", previous);
  assert.equal(H.propertyEditorSettingStageHandler("parent").prose, true);
});

test("ready cap effect line uses local noteReady counts and stays quiet when unavailable", () => {
  const plugin = { apiNoteReadyForNote: () => ({ count: 6, cap: 8 }) };
  assert.equal(H.propertyEditorSettingReadyCapEffectLine({}, 8, plugin, "notes/area.md"), "6 ready · cap 8 → room for 2");
  assert.equal(H.propertyEditorSettingReadyCapEffectLine({}, "off", plugin, "notes/area.md"), "6 ready · cap off");
  assert.equal(H.propertyEditorSettingReadyCapEffectLine({}, 8, {}, "notes/area.md"), "");
});

test("a mixed setting-plus-property clear dry-runs first, and a refused preview never applies", async () => {
  const show = report("area");
  const modal = modalFor(show);
  modal.propertyEditorManualMarks = new Set(["setting::summary", "created::7"]);
  modal.propertyEditorRangeMarks = new Set();
  const session = previewSession({ properties: show.properties, contract: show.contract });
  session.previewNow = async () => ({ ok: false, message: "Bob refused this mixed batch." });
  modal.session = session;
  await H.propertyEditorSettingsDelete(modal);
  assert.equal(session.applied.length, 0);
  assert.deepEqual(session.drafts[0], [
    { op: "setting.clear", setting: "summary" },
    { op: "prop.unset", key: "created" },
  ]);
  assert.match(modal.refusal && modal.refusal.message || "", /refused this mixed batch/);
});

test("Ctrl+D on a ghost is a no-op and parent clear stays refused", async () => {
  const show = report("area");
  const ghost = modalFor(show);
  let writes = 0;
  ghost.editorEnsureSession = () => ({ applyOps: async () => { writes += 1; return { ok: true }; } });
  const color = H.propertyEditorSettingsFindEntry(ghost, "setting::color");
  ghost.propertyEditorResolveSettingStage(color);
  assert.equal(await ghost.propertyEditorClearCurrentSetting(), false);
  assert.equal(writes, 0);
  assert.match(ghost.announce, /inherited/);

  const parentShow = report("area");
  const requiredSetting = parentShow.contract.settings.find((item) => item.id === "parent");
  requiredSetting.declared = true;
  requiredSetting.value = "[[life]]";
  requiredSetting.effective = { value: "[[life]]", source: "self", from: null, label: "set on this note" };
  parentShow.properties.push(row("parent", 16, { value: "[[life]]" }));
  const parentModal = modalFor(parentShow);
  parentModal.editorEnsureSession = () => ({ applyOps: async () => { writes += 1; return { ok: true }; } });
  const parent = H.propertyEditorSettingsFindEntry(parentModal, "setting::parent");
  parentModal.propertyEditorResolveSettingStage(parent);
  assert.equal(await parentModal.propertyEditorClearCurrentSetting(), false);
  assert.equal(writes, 0);
  assert.match(parentModal.refusal.message, /required/);
});

test("confirmed merge never copies a dry-run candidate contract onto the live report", () => {
  const current = report("area");
  const candidate = { ...current, dry_run: true, contract: { kind: "area", settings: [] } };
  const merged = H.propertyEditorMergeConfirmedReport(current, candidate);
  assert.equal(merged.contract.settings.length, current.contract.settings.length);
  const confirmed = H.propertyEditorMergeConfirmedReport(current, {
    dry_run: false, fingerprint_after: "sha256:after", properties: current.properties, contract: current.contract,
  });
  assert.equal(confirmed.fingerprint, "sha256:after");
});
