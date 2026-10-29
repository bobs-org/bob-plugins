const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) throw new Error("malformed yaml");
    result[match[1].trim()] = match[2].trim() || null;
  }
  return result;
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal {
      constructor(app) {
        this.app = app;
        this.contentEl = { empty: () => {} };
        this.modalEl = { removeClass: () => {} };
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: class { constructor() {} },
      Plugin: EmptyClass,
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/view") return { EditorView: class {} };
  if (request === "@codemirror/state") return { Prec: { highest: (v) => v } };
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = NavigationHotkeysPlugin;
const ledgerHelpers = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

const BASE_DATE = new Date(2026, 9, 3);
function sequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
function buildConfig() {
  const config = helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      { name: "priority", values: "priority", schedules: "scheduled", levels: [{ label: "P1", value: "high", min_days: 2, max_days: 7 }] },
      { name: "dependsOn", values: "local_task_id" },
    ],
  });
  assert.ok(config);
  return config;
}
function theme(name, key = name.toLowerCase(), extra = {}) {
  return { name, key, known: true, ...extra };
}
function noteSuggestion(name, stem = "sase_blog") {
  return {
    theme: theme(name, name.toLowerCase()),
    source: "note",
    label: `from ${stem}`,
    from: { path: `Areas/${stem}.md`, stem, kind: "area", hue: "green" },
  };
}
function makeThemeApi(options = {}) {
  const fields = options.fields || {};
  const suggestions = options.suggestions || {};
  const api = {
    version: 1,
    taskThemeOf(line) {
      if (typeof fields === "function") return fields(line);
      if (Object.prototype.hasOwnProperty.call(fields, line)) return fields[line];
      try {
        return ledgerHelpers.pomodoroThemeTaskFieldState(line);
      } catch (_e) {
        return { state: "none" };
      }
    },
    suggestFor(request) {
      if (typeof options.suggestFor === "function") return options.suggestFor(request);
      if (Object.prototype.hasOwnProperty.call(suggestions, request.line)) return suggestions[request.line];
      return null;
    },
    isKnownTheme(key) {
      if (typeof options.isKnownTheme === "function") return options.isKnownTheme(key);
      return true;
    },
    snapshot() {
      if (typeof options.snapshot === "function") return options.snapshot();
      return { themes: options.catalog || [], configured_themes: [] };
    },
    historyRows(queryOptions) {
      if (typeof options.historyRows === "function") return options.historyRows(queryOptions);
      const all = options.recent || [];
      const q = String((queryOptions && queryOptions.query) || "").trim().toLowerCase();
      return all.filter((e) => !q || String(e.key).includes(q) || String(e.name).toLowerCase().includes(q));
    },
    hueFor: () => null,
    setTaskTheme(line, name) {
      return ledgerHelpers.pomodoroThemeSetTaskTheme(line, name);
    },
    clearTaskTheme(line) {
      return ledgerHelpers.pomodoroThemeClearTaskTheme(line);
    },
    caps: () => ({ exempt: ["PLAN"] }),
  };
  return api;
}
function makeModel(overrides = {}) {
  const content = overrides.content || "- [ ] #task Ship report ^ship";
  const lineText = overrides.lineText || content.split(/\r?\n/)[0];
  return helpers.planTaskCard({
    config: buildConfig(),
    content,
    lineText,
    cursorLine: 0,
    filePath: "Tasks/Alpha.md",
    propertyContext: { isObsidianTask: true },
    baseDate: BASE_DATE,
    random: sequence([0.1]),
    freshnessApi: { setRefreshLine() {}, config() { return { interval: 7 }; } },
    ...overrides,
  });
}

test("t and Enter open the theme stage; Ctrl+D clears to default", () => {
  const line = "- [ ] #task Example [theme:: FIX] ^example";
  const api = makeThemeApi({
    fields: { [line]: { state: "set", value: "FIX", key: "fix", fields: [{}] } },
    suggestions: { 1: { theme: theme("FIX"), source: "task", label: "this task", inherited: noteSuggestion("WRITE") } },
  });
  const model = makeModel({ content: line, lineText: line, themeApi: api, selectedRowId: "theme" });
  assert.equal(model.rows.find((r) => r.id === "theme").enabled, true);
  const openT = helpers.resolveTaskCardKey(model, { key: "t" });
  assert.equal(openT.type, "open-action");
  assert.equal(openT.action, "theme");
  const openEnter = helpers.resolveTaskCardKey(model, { key: "Enter" });
  assert.equal(openEnter.type, "open-action");
  const clear = helpers.resolveTaskCardKey(model, { key: "d", ctrlKey: true });
  assert.equal(clear.type, "clear-theme");
  assert.equal(helpers.resolveTaskCardKey(model, { key: "t", repeat: true }).type, "ignored");
  assert.equal(helpers.resolveTaskCardKey(model, { key: "d", ctrlKey: true, repeat: true }).type, "ignored");
});

test("Use default clears every target including none, exempt, repair, and mixed", () => {
  const dup = { state: "repair", repair: "duplicate", fields: [{}, {}] };
  const api = makeThemeApi({
    fields: (line) => {
      if (line.includes("[theme:: PLAN]")) return { state: "set", value: "PLAN", key: "plan", fields: [{}] };
      if (line.includes("bad")) return dup;
      return { state: "none" };
    },
    suggestFor: (req) => {
      if (req.text.includes("exempt")) return { theme: theme("PLAN", "plan"), source: "note", label: "from sase_blog", from: { path: "Areas/sase_blog.md", stem: "sase_blog" } };
      if (req.text.includes("bad")) return noteSuggestion("WRITE");
      return null;
    },
    catalog: [{ key: "write", name: "WRITE" }, { key: "plan", name: "PLAN" }],
  });
  const single = makeModel({ content: "- [ ] #task Plain ^a", lineText: "- [ ] #task Plain ^a", themeApi: api });
  const planNone = helpers.planTaskCardThemeEdits(single.themeProjection, { kind: "default" }, api, {});
  assert.equal(planNone.valid, true);
  assert.equal(planNone.edits[0].action, "clear");
  const exemptLine = "- [ ] #task Exempt [theme:: PLAN] ^e";
  const exemptModel = makeModel({ content: exemptLine, lineText: exemptLine, themeApi: api });
  const planExempt = helpers.planTaskCardThemeEdits(exemptModel.themeProjection, { kind: "default" }, api, {});
  assert.equal(planExempt.edits[0].action, "clear");
  const repairLine = "- [ ] #task Repair [theme:: bad] [theme:: ALSO] ^r";
  const repairModel = makeModel({ content: repairLine, lineText: repairLine, themeApi: api });
  const planRepair = helpers.planTaskCardThemeEdits(repairModel.themeProjection, { kind: "default" }, api, {});
  assert.equal(planRepair.edits[0].action, "clear");
  const cleared = api.clearTaskTheme(repairLine);
  assert.ok(!cleared.includes("[theme::"));
  const mixedContent = ["- [ ] #task One ^one", "- [ ] #task Two [theme:: WRITE] ^two"].join("\n");
  const mixedApi = makeThemeApi({
    fields: (line) => (line.includes("[theme:: WRITE]") ? { state: "set", value: "WRITE", key: "write", fields: [{}] } : { state: "none" }),
    suggestFor: (req) => (req.line === 1 ? noteSuggestion("WRITE", "sase_blog") : noteSuggestion("BUILD", "sase_cli")),
    catalog: [{ key: "write", name: "WRITE" }, { key: "plan", name: "PLAN" }],
  });
  const mixed = makeModel({
    content: mixedContent,
    lineText: "- [ ] #task One ^one",
    taskSession: { valid: true, explicit: true, requestedCount: 2, actualCount: 2, targets: [{ line: 0, rawLine: "- [ ] #task One ^one" }, { line: 1, rawLine: "- [ ] #task Two [theme:: WRITE] ^two" }] },
    themeApi: mixedApi,
  });
  assert.equal(mixed.themeProjection.mixed, true);
  const stage = helpers.buildTaskCardThemeStageModel(mixed.themeProjection, mixedApi, { query: "" });
  assert.equal(stage.rows[0].kind, "default");
  assert.match(stage.rows[0].detail, /each task to its own default/);
  const planMixed = helpers.planTaskCardThemeEdits(mixed.themeProjection, { kind: "default" }, mixedApi, {});
  assert.equal(planMixed.edits.length, 2);
  assert.ok(planMixed.edits.every((e) => e.action === "clear"));
});

test("selecting inherited clears; other choices set with catalog spelling and exempt guard", () => {
  const line = "- [ ] #task Example [theme:: FIX] ^example";
  const inherited = noteSuggestion("WRITE");
  const api = makeThemeApi({
    fields: { [line]: { state: "set", value: "FIX", key: "fix", fields: [{}] } },
    suggestions: { 1: { theme: theme("FIX"), source: "task", label: "this task", inherited } },
    catalog: [{ key: "write", name: "WRITE" }, { key: "fix", name: "FIX" }, { key: "build", name: "BUILD" }],
  });
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  const planInherited = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "recent", key: "write", name: "WRITE" }, api, {});
  assert.equal(planInherited.edits[0].action, "clear");
  const planSet = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "recent", key: "build", name: "build" }, api, {});
  assert.equal(planSet.edits[0].action, "set");
  assert.equal(planSet.edits[0].name, "BUILD");
  const after = api.setTaskTheme("- [ ] #task Plain ^a", planSet.edits[0].name);
  assert.ok(after.includes("[theme:: BUILD]"));
  const planExempt = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "recent", key: "plan", name: "PLAN" }, api, {});
  assert.equal(planExempt.valid, false);
  const planComposite = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "new", key: "a+b", name: "A + B" }, api, {});
  assert.equal(planComposite.valid, false);
  const planInvalid = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "new", key: "", name: "!!!" }, api, {});
  assert.equal(planInvalid.valid, false);
});

test("new theme with no suggestion sets; same-key is byte-preserving no-op", () => {
  const line = "- [ ] #task Plain ^a";
  const api = makeThemeApi({ suggestions: {}, catalog: [{ key: "deep work", name: "DEEP WORK" }] });
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  assert.equal(model.themeProjection.display.text, "none · t to set");
  const plan = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "new", key: "deep work", name: "Deep Work" }, api, {});
  assert.equal(plan.valid, true);
  assert.equal(plan.edits[0].action, "set");
  const after = api.setTaskTheme(line, plan.edits[0].name);
  assert.ok(after.includes("[theme:: DEEP WORK]"));
  assert.ok(after.startsWith("- [ ] #task Plain"));
  assert.ok(after.endsWith("^a"));
  const setLine = "- [ ] #task Has [theme:: BUILD] ^h";
  const api2 = makeThemeApi({
    fields: { [setLine]: { state: "set", value: "BUILD", key: "build", fields: [{}] } },
    suggestions: { 1: null },
    catalog: [{ key: "build", name: "BUILD" }],
  });
  const model2 = makeModel({ content: setLine, lineText: setLine, themeApi: api2 });
  const noop = helpers.planTaskCardThemeEdits(model2.themeProjection, { kind: "recent", key: "build", name: "BUILD" }, api2, {});
  assert.equal(noop.edits[0].action, "none");
  assert.equal(api2.setTaskTheme(setLine, "BUILD"), setLine);
});

test("stage dedupes by key, preserves query, and keeps unknown inherited selectable", () => {
  const line = "- [ ] #task Old ^old";
  const inheritedUnknown = { theme: theme("OLD", "old", { known: false }), source: "note", label: "from elsewhere", from: { path: "Areas/Elsewhere.md", stem: "elsewhere" } };
  const api = makeThemeApi({
    fields: { [line]: { state: "none" } },
    suggestions: { 1: inheritedUnknown },
    isKnownTheme: (k) => k !== "old",
    catalog: [{ key: "write", name: "WRITE" }],
    recent: [{ key: "write", name: "WRITE" }, { key: "WRITE", name: "WRITE" }, { key: "build", name: "BUILD" }],
  });
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  const stage = helpers.buildTaskCardThemeStageModel(model.themeProjection, api, { query: "" });
  assert.equal(stage.rows[0].kind, "default");
  const keys = stage.rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  const unknown = stage.rows.find((r) => r.kind === "inherited-unknown");
  assert.ok(unknown);
  assert.equal(unknown.key, "old");
  const stageQ = helpers.buildTaskCardThemeStageModel(model.themeProjection, api, { query: "wri" });
  assert.equal(stageQ.query, "wri");
  const stageQ2 = helpers.buildTaskCardThemeStageModel(model.themeProjection, api, { query: "wri" });
  assert.deepEqual(stageQ.rows.map((r) => r.key), stageQ2.rows.map((r) => r.key));
  const typed = helpers.buildTaskCardThemeStageModel(model.themeProjection, api, { query: "Brand New" });
  assert.ok(typed.rows.some((r) => r.kind === "new" && r.key === "brand new"));
});

test("stale line and changed default refuse; cancellation writes nothing", () => {
  const line = "- [ ] #task Example ^example";
  const api = makeThemeApi({ suggestions: { 1: noteSuggestion("WRITE") } });
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  const plan = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "default" }, api, {});
  const staleProjection = {
    targets: [{ identity: { path: "Tasks/Alpha.md", line: 0, rawLine: "- [ ] #task CHANGED ^example" }, available: true, inherited: noteSuggestion("WRITE") }],
  };
  const check = helpers.taskCardThemeRevalidateEdit(plan.edits[0], staleProjection);
  assert.equal(check.ok, false);
  const changedDefault = {
    targets: [{ identity: plan.edits[0].target.identity, available: true, inherited: noteSuggestion("OTHER") }],
  };
  const check2 = helpers.taskCardThemeRevalidateEdit(plan.edits[0], changedDefault);
  assert.equal(check2.ok, false);
  assert.equal(helpers.resolveTaskCardKey(model, { key: "Backspace" }).type, "back");
  assert.equal(helpers.resolveTaskCardKey(model, { key: "Escape" }).type, "close-card");
});

test("persisted post-images preserve status, links, and freshness bytes", () => {
  const api = makeThemeApi({ suggestions: { 1: noteSuggestion("WRITE") }, catalog: [{ key: "build", name: "BUILD" }] });
  const line = "- [ ] #task Ship [[Notes/Other]] [fresh:: today] [priority:: medium] ^ship";
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  const plan = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "recent", key: "build", name: "BUILD" }, api, {});
  assert.equal(plan.edits[0].action, "set");
  const after = api.setTaskTheme(line, plan.edits[0].name);
  assert.ok(after.startsWith("- [ ] #task Ship"));
  assert.ok(after.includes("[[Notes/Other]]"));
  assert.ok(after.includes("[fresh:: today]"));
  assert.ok(after.includes("[priority:: medium]"));
  assert.ok(after.includes("[theme:: BUILD]"));
  assert.ok(after.endsWith("^ship"));
  const cleared = api.clearTaskTheme(after);
  assert.ok(!cleared.includes("[theme::"));
  assert.ok(cleared.includes("[[Notes/Other]]"));
  assert.ok(cleared.includes("[fresh:: today]"));
});

test("linked and mixed counted plans carry per-target identity without guessing", () => {
  const targetLine = "- [ ] #task Actual [theme:: FIX] ^actual";
  const targetContent = ["# target", targetLine].join("\n");
  const api = makeThemeApi({
    fields: { [targetLine]: { state: "set", value: "FIX", key: "fix", fields: [{}] } },
    suggestions: { 2: { theme: theme("FIX"), source: "task", label: "this task", inherited: null } },
  });
  const model = makeModel({
    content: "- [[Projects/Target#^actual]]",
    lineText: "- [[Projects/Target#^actual]]",
    filePath: "2026/20261003.md",
    linkSession: { kind: "task-link", valid: true, resolved: [{ path: "Projects/Target.md", content: targetContent, line: 1, rawLine: targetLine, blockId: "actual", displayText: "Actual" }], targets: [] },
    themeApi: api,
  });
  assert.equal(model.themeProjection.targetCount, 1);
  assert.equal(model.themeProjection.targets[0].identity.path, "Projects/Target.md");
  const plan = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "default" }, api, {});
  assert.equal(plan.edits[0].action, "clear");
  const cleared = api.clearTaskTheme(targetLine);
  assert.ok(!cleared.includes("[theme::"));
  assert.ok(cleared.includes("^actual"));
});
