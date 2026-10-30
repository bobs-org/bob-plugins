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
    caps() {
      if (!Object.prototype.hasOwnProperty.call(options, "caps")) return { exempt: ["PLAN"] };
      return typeof options.caps === "function" ? options.caps() : options.caps;
    },
    typeComponentsOf(name) {
      try {
        return ledgerHelpers.typeComponents(name, {
          vocab: ["BUILD", "CHORE", "FIX", "MEET", "PLAN", "READ", "WRITE"],
          exempt: ["PLAN"],
          inventory: [],
        });
      } catch (_e) {
        return [];
      }
    },
    planRelocation(relocationOptions) {
      const opts = relocationOptions && typeof relocationOptions === "object" ? relocationOptions : {};
      return ledgerHelpers.planRelocation({
        entries: opts.entries,
        liveLink: opts.liveLink,
        typeKey: opts.typeKey !== undefined ? opts.typeKey : opts.type,
        typeName: opts.typeName,
        sources: {
          vocab: ["BUILD", "CHORE", "FIX", "MEET", "PLAN", "READ", "WRITE"],
          exempt: ["PLAN"],
          inventory: [],
        },
        ledgerKeys: opts.ledgerKeys || [],
        themesBefore: opts.themesBefore || 0,
        cap: opts.cap || 3,
        strict: opts.strict || false,
      });
    },
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

test("selecting inherited clears; other choices set with catalog spelling including PLAN", () => {
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
  assert.ok(after.includes("[type:: BUILD]"));
  const planExempt = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "recent", key: "plan", name: "PLAN" }, api, {});
  assert.equal(planExempt.valid, true);
  assert.equal(planExempt.edits[0].action, "set");
  assert.equal(planExempt.edits[0].name, "PLAN");
  const planComposite = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "new", key: "a+b", name: "A + B" }, api, {});
  assert.equal(planComposite.valid, false);
  const planInvalid = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "new", key: "", name: "!!!" }, api, {});
  assert.equal(planInvalid.valid, false);
});

test("new theme with no suggestion sets; same-key is a plan no-op", () => {
  const line = "- [ ] #task Plain ^a";
  const api = makeThemeApi({ suggestions: {}, catalog: [{ key: "deep work", name: "DEEP WORK" }] });
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  assert.equal(model.themeProjection.display.text, "none · t to set");
  const plan = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "new", key: "deep work", name: "Deep Work" }, api, {});
  assert.equal(plan.valid, true);
  assert.equal(plan.edits[0].action, "set");
  const after = api.setTaskTheme(line, plan.edits[0].name);
  assert.ok(after.includes("[type:: DEEP WORK]"));
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
  assert.equal(api2.setTaskTheme(setLine, "BUILD"), "- [ ] #task Has [type:: BUILD] ^h");
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

test("known inherited theme remains in Today or Recent; unknown inherited row is not preselected", () => {
  const line = "- [ ] #task Inherited ^inherited";
  const api = makeThemeApi({
    suggestions: { 1: noteSuggestion("WRITE") },
    catalog: [{ key: "write", name: "WRITE", today: true }],
    recent: [{ key: "write", name: "WRITE" }],
  });
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  const stage = helpers.buildTaskCardThemeStageModel(model.themeProjection, api, {});
  assert.ok(stage.rows.some((row) => row.key === "write" && row.kind === "today"));

  const unknownApi = makeThemeApi({
    suggestions: { 1: { ...noteSuggestion("OLD"), theme: theme("OLD", "old", { known: false }) } },
    isKnownTheme: () => false,
  });
  const unknownModel = makeModel({ content: line, lineText: line, themeApi: unknownApi });
  const unknownStage = helpers.buildTaskCardThemeStageModel(unknownModel.themeProjection, unknownApi, {});
  assert.equal(unknownStage.rows[0].kind, "default");
  assert.ok(unknownStage.rows.some((row) => row.kind === "inherited-unknown" && row.key === "old"));
});

test("type sets need no caps gate; default clears", () => {
  const line = "- [ ] #task Plain [root:: root-byte] ^plain";
  for (const caps of [
    null,
    () => { throw new Error("caps failed"); },
    () => Promise.resolve({ exempt: [] }),
    () => ({ exempt: "PLAN" }),
    () => ({ exempt: ["PLAN + BUILD"] }),
  ]) {
    const api = makeThemeApi({ caps });
    const model = makeModel({ content: line, lineText: line, themeApi: api });
    const set = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "new", key: "BUILD", name: "BUILD" }, api, {});
    assert.equal(set.valid, true);
    assert.equal(set.edits[0].action, "set");
    const clear = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "default" }, api, {});
    assert.equal(clear.valid, true);
    assert.equal(clear.edits[0].action, "clear");
  }
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

test("persisted post-images preserve status, links, root, and freshness bytes", () => {
  const api = makeThemeApi({ suggestions: { 1: noteSuggestion("WRITE") }, catalog: [{ key: "build", name: "BUILD" }] });
  const line = "- [ ] #task Ship [[Notes/Other]] [fresh:: today] [priority:: medium] [root:: project] ^ship";
  const model = makeModel({ content: line, lineText: line, themeApi: api });
  const plan = helpers.planTaskCardThemeEdits(model.themeProjection, { kind: "recent", key: "build", name: "BUILD" }, api, {});
  assert.equal(plan.edits[0].action, "set");
  const after = api.setTaskTheme(line, plan.edits[0].name);
  assert.ok(after.startsWith("- [ ] #task Ship"));
  assert.ok(after.includes("[[Notes/Other]]"));
  assert.ok(after.includes("[fresh:: today]"));
  assert.ok(after.includes("[priority:: medium]"));
  assert.ok(after.includes("[root:: project]"));
  assert.ok(after.includes("[type:: BUILD]"));
  assert.ok(after.endsWith("^ship"));
  const cleared = api.clearTaskTheme(after);
  assert.ok(!cleared.includes("[type::"));
  assert.ok(!cleared.includes("[theme::"));
  assert.ok(cleared.includes("[[Notes/Other]]"));
  assert.ok(cleared.includes("[fresh:: today]"));
  assert.ok(cleared.includes("[root:: project]"));
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

function noticeEdit(kind, inherited = noteSuggestion("WRITE", "job"), state = "none") {
  return {
    action: kind === "same" ? "none" : kind === "set" ? "set" : "clear",
    reason: kind === "default" ? "use-default" : kind === "inherited" ? "select-inherited-clears" : "same-key-noop",
    name: kind === "same" || kind === "set" ? "MEET" : null,
    target: { inherited, field: { state } },
  };
}

test("theme notices explain every single-target no-op source and default", () => {
  const project = { ...noteSuggestion("WRITE", "launch"), from: { stem: "launch", kind: "project" } };
  const otherNote = { ...noteSuggestion("WRITE"), from: { path: "Notes/misc.md", kind: "other" } };
  const reading = { source: "reading", theme: theme("READ") };
  const unknown = { source: "other", theme: theme("WRITE") };
  const cases = [
    [noticeEdit("inherited"), "WRITE is already inherited from area note job"],
    [noticeEdit("inherited", project), "WRITE is already inherited from project note launch"],
    [noticeEdit("inherited", otherNote), "WRITE is already inherited from note misc"],
    [noticeEdit("inherited", reading), "READ is already the default for reading tasks"],
    [noticeEdit("inherited", unknown), "WRITE is already this task's default"],
    [noticeEdit("inherited", { theme: { key: "write" } }), "write is already this task's default"],
    [noticeEdit("same"), "MEET is already set on this task"],
    [noticeEdit("set"), "MEET is already set on this task"],
    [noticeEdit("default"), "Already using the default (WRITE from area note job)"],
    [noticeEdit("default", project), "Already using the default (WRITE from project note launch)"],
    [noticeEdit("default", reading), "Already using the default (READ for reading tasks)"],
    [noticeEdit("default", unknown), "Already using the default (WRITE)"],
    [noticeEdit("default", null), "No type override to clear"],
  ];
  for (const [edit, expected] of cases) {
    assert.equal(helpers.taskCardThemeUnchangedNotice([edit]), `${expected}; nothing was written`);
  }
  assert.equal(helpers.taskCardThemeInheritedSourceText(project), "project note launch");
  assert.equal(helpers.taskCardThemeInheritedSourceText(otherNote), "note misc");
  assert.equal(helpers.taskCardThemeInheritedSourceText({ source: "note", from: { stem: "misc" } }), "note misc");
  for (const inherited of [null, {}, reading, { source: "note" }]) {
    assert.equal(helpers.taskCardThemeInheritedSourceText(inherited), null);
  }
});

test("theme no-op batches distinguish shared sources, different sources, explicit fields, and defaults", () => {
  const inherited = noticeEdit("inherited");
  const same = noticeEdit("same");
  const defaultEdit = noticeEdit("default");
  const cases = [
    [[inherited, inherited, inherited], "WRITE is already inherited from area note job by all 3 tasks"],
    [[inherited, noticeEdit("inherited", noteSuggestion("WRITE", "work")), inherited], "WRITE is already inherited by all 3 tasks"],
    [[same, same, same], "MEET is already set on all 3 tasks"],
    [[same, noticeEdit("inherited", noteSuggestion("MEET")), same], "MEET already applies to all 3 tasks"],
    [[defaultEdit, noticeEdit("default", null), defaultEdit], "All 3 tasks already use their defaults"],
  ];
  for (const [edits, expected] of cases) {
    assert.equal(helpers.taskCardThemeUnchangedNotice(edits), `${expected}; nothing was written`);
  }
  for (const edits of [[], null, [null], [{}], [inherited, same], [inherited, defaultEdit], [noticeEdit("inherited", null)]]) {
    assert.equal(helpers.taskCardThemeUnchangedNotice(edits), "Types are already set; nothing was written");
  }
});

test("theme save notices distinguish removed overrides, repaired fields, and default sources", () => {
  const sources = [
    [noteSuggestion("WRITE", "job"), "WRITE is inherited from area note job"],
    [{ ...noteSuggestion("WRITE"), from: { stem: "launch", kind: "project" } }, "WRITE is inherited from project note launch"],
    [{ source: "reading", theme: theme("READ") }, "READ is the default for reading tasks"],
    [{ theme: theme("WRITE") }, "WRITE is this task's default"],
  ];
  for (const [inherited, reason] of sources) {
    assert.equal(helpers.taskCardThemeSavedNotice(noticeEdit("inherited", inherited, "set")), `Override removed; ${reason}`);
    assert.equal(helpers.taskCardThemeSavedNotice(noticeEdit("inherited", inherited, "repair")), `Type fields repaired; ${reason}`);
    assert.equal(helpers.taskCardThemeSavedNotice(noticeEdit("default", inherited)), `Type cleared; ${reason}`);
  }
  assert.equal(helpers.taskCardThemeSavedNotice(noticeEdit("set")), "Type MEET");
  assert.equal(helpers.taskCardThemeSavedNotice(noticeEdit("default", null)), "Type cleared to default");
  for (const edit of [null, {}, { get action() { throw new Error("invalid edit"); } }]) {
    assert.equal(helpers.taskCardThemeSavedNotice(edit), "Type saved");
  }
});

test("stage rows keep subtitle and search fields while marking only a single inherited choice", () => {
  const inherited = noteSuggestion("WRITE", "job");
  const projection = { mixed: false, targets: [{ available: true, inherited }] };
  for (const today of [true, false]) {
    const api = makeThemeApi({ catalog: [{ key: "write", name: "WRITE", today }], recent: [{ key: "write", name: "WRITE" }] });
    const stage = helpers.buildTaskCardThemeStageModel(projection, api);
    assert.equal(stage.defaultDetail, "Use default · WRITE from job");
    assert.equal(stage.rows[0].detail, "WRITE from job");
    assert.deepEqual(helpers.taskCardThemeStageItem(stage.rows[0]), {
      key: "__default", themeKind: "default", themeKey: "__default", themeName: null,
      title: "Use default", detail: "WRITE from job", searchText: "use default WRITE from job",
      inheritedDefault: false, inheritedFrom: null,
    });
    const row = stage.rows.find((row) => row.key === "write");
    const detail = today ? "Today" : "Recent";
    assert.deepEqual(helpers.taskCardThemeStageItem(row), {
      key: "theme-write", themeKind: today ? "today" : "recent", themeKey: "write", themeName: "WRITE",
      title: "WRITE", detail, searchText: `WRITE ${detail} write`, inheritedDefault: true, inheritedFrom: "area note job",
    });
    const mixed = helpers.buildTaskCardThemeStageModel({ mixed: true, targets: [projection.targets[0], projection.targets[0]] }, api);
    assert.equal(mixed.rows[0].detail, "clear each task to its own default (2 tasks)");
    assert.equal(mixed.rows.some((row) => row.inheritedDefault), false);
  }
  for (const [source, inheritedFrom] of [["reading", "reading tasks"], ["other", null]]) {
    const stage = helpers.buildTaskCardThemeStageModel({ mixed: false, targets: [{ available: true, inherited: { theme: theme("READ"), source } }] }, makeThemeApi(), { query: "READ" });
    const row = stage.rows.find((row) => row.kind === "new");
    assert.equal(row.inheritedDefault, true);
    assert.equal(row.inheritedFrom, inheritedFrom);
  }
});

test("Use default names the default type source without from", () => {
  const inherited = { theme: theme("CHORE", "chore"), source: "default", label: "default type" };
  const projection = { mixed: false, targets: [{ available: true, inherited }] };
  const stage = helpers.buildTaskCardThemeStageModel(projection, makeThemeApi(), {});
  assert.equal(stage.defaultDetail, "Use default · CHORE default type");
  assert.equal(stage.rows[0].detail, "CHORE default type");
});

function taskCardTypeEditFor(action, key, name, blockId, inherited) {
  return {
    action,
    key: action === "set" ? key : null,
    name: action === "set" ? name : null,
    reason: action === "clear" ? "use-default" : "set-theme",
    target: {
      identity: { id: `id-${blockId}`, path: "Tasks/Alpha.md", line: 0, rawLine: `- [ ] #task Example ^${blockId}`, blockId },
      inherited: inherited || null,
      field: { state: "none" },
    },
  };
}

function dailyNoteWithLink(entryName, blockId, extraEntries = "") {
  const lines = [
    "## Pomodoros",
    `- [ ] () — ${entryName}`,
    `\t- [[Tasks/Alpha#^${blockId}]]`,
  ];
  if (extraEntries) lines.push(extraEntries);
  return lines.join("\n");
}

test("task-card-relocate: unlinked backlog retype is field-only", () => {
  const api = makeThemeApi();
  const edit = taskCardTypeEditFor("set", "build", "BUILD", "no-link-here", noteSuggestion("WRITE", "dev"));
  const daily = dailyNoteWithLink("FIX", "other-id");
  const built = helpers.taskCardTypeLedgerEntries(daily);
  assert.equal(built.entries.length, 1);
  const found = helpers.taskCardTypeFindLiveLink(built.details, "no-link-here");
  assert.equal(found, null);
  const plan = helpers.planTaskCardTypeLedgerMoves([edit], daily, api);
  assert.equal(plan.valid, true);
  assert.equal(plan.refused, null);
  assert.equal(plan.moves.length, 0);
  assert.equal(plan.content, daily);
  const consequence = helpers.taskCardTypeConsequence(edit, { relocation: { kind: "unchanged" }, hasLiveLink: false, sourceEntryName: "FIX", newType: { key: "build", name: "BUILD" } });
  assert.equal(consequence, "no live link · ledger unchanged");
});

test("task-card-relocate: planned link moves into existing planned BUILD", () => {
  const api = makeThemeApi();
  const edit = taskCardTypeEditFor("set", "build", "BUILD", "task-1", noteSuggestion("FIX", "dev"));
  const daily = [
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[Tasks/Alpha#^task-1]]",
    "- [ ] () — BUILD",
    "\t- [[Tasks/Other#^other]]",
  ].join("\n");
  const planned = helpers.planTaskCardTypeLedgerMoves([edit], daily, api);
  assert.equal(planned.valid, true);
  assert.equal(planned.refused, null);
  assert.equal(planned.moves.length, 1);
  assert.equal(planned.moves[0].relocation.kind, "moveTo");
  assert.equal(planned.moves[0].destinationName, "BUILD");
  assert.ok(planned.content.includes("- [ ] () — BUILD"));
  const consequence = helpers.taskCardTypeConsequence(edit, {
    relocation: planned.moves[0].relocation,
    hasLiveLink: true,
    sourceEntryName: "FIX",
    newType: { key: "build", name: "BUILD" },
  });
  assert.equal(consequence, "link moves FIX → BUILD");
  assert.equal(helpers.taskCardThemeSavedNotice(edit, { moved: true, destinationName: "BUILD" }), "Type BUILD · link moved to BUILD");
});

test("task-card-relocate: sole placeholder renames in place", () => {
  const api = makeThemeApi();
  const edit = taskCardTypeEditFor("set", "build", "BUILD", "sole-1", noteSuggestion("FIX", "dev"));
  const daily = dailyNoteWithLink("FIX", "sole-1");
  const planned = helpers.planTaskCardTypeLedgerMoves([edit], daily, api);
  assert.equal(planned.valid, true);
  assert.equal(planned.moves.length, 1);
  assert.equal(planned.moves[0].relocation.kind, "renamePlaceholder");
  assert.ok(planned.content.includes("- [ ] () — BUILD"));
  assert.equal(
    helpers.taskCardTypeConsequence(edit, {
      relocation: planned.moves[0].relocation,
      hasLiveLink: true,
      sourceEntryName: "FIX",
      newType: { key: "build", name: "BUILD" },
    }),
    "FIX placeholder becomes BUILD",
  );
});

test("task-card-relocate: crowded placeholder creates below the source", () => {
  const api = makeThemeApi();
  const edit = taskCardTypeEditFor("set", "build", "BUILD", "crowd-1", noteSuggestion("FIX", "dev"));
  const daily = [
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[Tasks/Alpha#^crowd-1]]",
    "\t- [[Tasks/Other#^crowd-2]]",
  ].join("\n");
  const planned = helpers.planTaskCardTypeLedgerMoves([edit], daily, api);
  assert.equal(planned.valid, true);
  assert.equal(planned.moves.length, 1);
  assert.equal(planned.moves[0].relocation.kind, "createBelow");
  assert.ok(planned.content.includes("new BUILD Pomodoro below FIX") === false);
  assert.ok(planned.content.includes("- [ ] () — BUILD"));
  assert.equal(
    helpers.taskCardTypeConsequence(edit, {
      relocation: planned.moves[0].relocation,
      hasLiveLink: true,
      sourceEntryName: "FIX",
      newType: { key: "build", name: "BUILD" },
    }),
    "new BUILD Pomodoro below FIX",
  );
});

test("task-card-relocate: running sole renames, running crowded appends", () => {
  const api = makeThemeApi();
  const timed = (name, links) => ({ name, open: true, running: true, links });
  const sole = api.planRelocation({ entries: [timed("FIX", 1)], liveLink: 0, typeKey: "build", typeName: "BUILD" });
  assert.equal(sole.kind, "renameEntry");
  assert.equal(sole.newName, "BUILD");
  const crowded = api.planRelocation({ entries: [timed("FIX", 2)], liveLink: 0, typeKey: "build", typeName: "BUILD" });
  assert.equal(crowded.kind, "appendComponent");
  assert.equal(crowded.newName, "FIX + BUILD");
  assert.equal(
    helpers.taskCardTypeConsequence(taskCardTypeEditFor("set", "build", "BUILD", "r1"), {
      relocation: sole, hasLiveLink: true, sourceEntryName: "FIX", newType: { key: "build", name: "BUILD" },
    }),
    "running FIX becomes BUILD",
  );
  assert.equal(
    helpers.taskCardTypeConsequence(taskCardTypeEditFor("set", "build", "BUILD", "r2"), {
      relocation: crowded, hasLiveLink: true, sourceEntryName: "FIX", newType: { key: "build", name: "BUILD" },
    }),
    "running FIX becomes FIX + BUILD",
  );
});

test("task-card-relocate: already under and strict refusal copy", () => {
  const edit = taskCardTypeEditFor("set", "build", "BUILD", "a1");
  assert.equal(
    helpers.taskCardTypeConsequence(edit, {
      relocation: { kind: "unchanged" }, hasLiveLink: true, sourceEntryName: "FIX", newType: { key: "build", name: "BUILD" },
    }),
    "already under BUILD",
  );
  const refused = { kind: "refused", code: "strict_cap", typeKey: "build", typeName: "BUILD", themesBefore: 3, cap: 3 };
  assert.equal(
    helpers.taskCardTypeConsequence(edit, {
      relocation: refused, hasLiveLink: true, sourceEntryName: "FIX", newType: { key: "build", name: "BUILD" },
    }),
    "plan.strict: BUILD would be type 4 of 3 · nothing written",
  );
  const clearEdit = taskCardTypeEditFor("clear", null, null, "c1", noteSuggestion("BUILD", "dev"));
  assert.equal(helpers.taskCardThemeSavedNotice(clearEdit, { moved: true, destinationName: "BUILD" }), "Type cleared · BUILD from dev · link moved to BUILD");
  assert.equal(helpers.taskCardThemeSavedNotice(edit, { moved: false, partial: true }), "Type BUILD set · link not moved — Ctrl+Shift+M to move it");
});

test("task-card-relocate: daily write is one undo with preimage guard", async () => {
  const daily = dailyNoteWithLink("FIX", "w1");
  const edit = taskCardTypeEditFor("set", "build", "BUILD", "w1", noteSuggestion("FIX", "dev"));
  const api = makeThemeApi();
  const planned = helpers.planTaskCardTypeLedgerMoves([edit], daily, api);
  assert.equal(planned.moves.length, 1);
  let transactions = 0;
  let stored = daily;
  const editor = {
    getValue: () => stored,
    transaction: ({ changes }) => {
      transactions += 1;
      let lines = stored.split("\n");
      const sorted = changes.slice().sort((a, b) => b.from.line - a.from.line);
      for (const change of sorted) {
        lines[change.from.line] = change.text;
      }
      stored = lines.join("\n");
    },
    getCursor: () => ({ line: 0, ch: 0 }),
    setCursor: () => {},
  };
  const snapshot = { dailyPath: "2026/20261028.md", content: daily, sameFile: false, editor: null, file: { path: "2026/20261028.md" }, snapshot: null };
  const deps = { plugin: { getOpenMarkdownEditorForPath: () => editor }, app: { vault: null } };
  const wrote = await helpers.writeTaskCardTypeDailyContent(deps, snapshot, daily, planned.content);
  assert.equal(wrote, true);
  assert.equal(transactions, 1);
  assert.ok(stored.includes("- [ ] () — BUILD"));
  const stale = await helpers.writeTaskCardTypeDailyContent(deps, snapshot, "stale preimage", planned.content);
  assert.equal(stale, false);
});
