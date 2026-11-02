// Tests for the pure blocked-reason classifier and api.blockMarks v1.
// BM vectors below follow bob-cli `docs/blocked-marks.md` verbatim; BM24 is
// the Tasks-results CSS vector and belongs to a later rendering phase.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class StubWidgetType {}
class StubPlugin {
  constructor(app) {
    this.app = app;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithBlockMarkStubs(request) {
  if (request === "obsidian") {
    return {
      MarkdownView: class MarkdownView {},
      Notice: class Notice {},
      Platform: { isDesktopApp: true },
      Plugin: StubPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
      editorInfoField: {},
      editorLivePreviewField: {},
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: { define: () => ({ of: (value) => ({ value }) }) },
      RangeSetBuilder: class RangeSetBuilder {},
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (value) => value } },
      keymap: { of: (value) => value },
      ViewPlugin: { fromClass: (value) => value },
      Decoration: { none: {} },
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
};

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
delete require.cache[MAIN_PATH];
const LedgerToolsPlugin = require(MAIN_PATH);
Module._load = originalLoad;

const {
  blockMarkMaskInlineCode,
  blockMarkEligible,
  blockMarkDependsOnIds,
  blockMarkDigit,
  blockMarkClassify,
  blockMarkTooltip,
  blockMarkModel,
} = LedgerToolsPlugin.helpers;

const TODAY = "2026-11-01";
const LADDER = Object.freeze([
  Object.freeze({ label: "P1", value: "high", minDays: 2, maxDays: 7 }),
  Object.freeze({ label: "P2", value: "medium", minDays: 8, maxDays: 30 }),
  Object.freeze({ label: "P3", value: "low", minDays: 31, maxDays: 90 }),
  Object.freeze({ label: "P4", value: "lowest", minDays: 91, maxDays: 365 }),
]);

const TASKS = Object.freeze([
  Object.freeze({
    id: "x",
    status: Object.freeze({ type: "TODO" }),
    path: "Projects/Prerequisites.md",
    blockId: "x",
    description: "Finish the battery #task [id:: x]",
  }),
  Object.freeze({
    id: "y",
    status: Object.freeze({ type: "IN_PROGRESS" }),
    path: "Projects/Prerequisites.md",
    blockId: "y",
    description: "Review the plan #task [id:: y]",
  }),
  Object.freeze({
    id: "d",
    status: Object.freeze({ type: "DONE" }),
    path: "Projects/Archive.md",
    blockId: "d",
    description: "Closed item #task [id:: d]",
  }),
]);

const VECTOR_BASE = Object.freeze({
  today: TODAY,
  ladder: LADDER,
  notePath: "Projects/Example.md",
  lookupId: (id) => TASKS.filter((task) => task.id === id),
});

function modelFor(lineText, overrides = {}) {
  return blockMarkModel(lineText, { ...VECTOR_BASE, ...overrides });
}

const BM_VECTORS = [
  { id: "BM1", line: "- [?] #task A [priority:: medium] [scheduled:: 2026-11-20]", key: "p2", family: "waiting", digit: 2, more: null },
  { id: "BM2", line: "- [?] #task B [scheduled:: 2026-11-04]", key: "date", family: "waiting", digit: null, more: null },
  { id: "BM3", line: "- [?] #task C [repeat:: every day when done] [scheduled:: 2026-11-02]", key: "repeat", family: "waiting", digit: null, more: null },
  { id: "BM4", line: "- [?] #task D [dependsOn:: x]", key: "dep", family: "held", digit: null, more: null },
  { id: "BM5", line: "- [?] #task D [dependsOn:: d]", key: "stale", family: "stale", digit: null, more: null },
  { id: "BM6", line: "- [?] #task D [dependsOn:: x]", key: null, cacheReady: false },
  { id: "BM7", line: "- [?] #task E #prj_is_blocked", key: "prj", family: "held", digit: null, more: null },
  { id: "BM8", line: "- [?] #task F [dependsOn:: x] [priority:: low] [scheduled:: 2026-12-20]", key: "dep", family: "held", digit: null, more: "p3" },
  { id: "BM9", line: "- [?] #task G #prj_is_blocked [priority:: medium] [scheduled:: 2026-11-20]", key: "prj", family: "held", digit: null, more: "p2" },
  { id: "BM10", line: "- [?] #task H [priority:: highest] [scheduled:: 2026-11-20]", key: "date", family: "waiting", digit: null, more: null },
  { id: "BM11", line: "- [?] #task I [priority:: medium] [scheduled:: 2026-11-01]", key: "stale", family: "stale", digit: null, more: null },
  { id: "BM12", line: "- [*] #task J [priority:: high] [scheduled:: 2026-11-20]", key: null },
  { id: "BM13", line: "- [?] #task K [priority:: high] [scheduled:: 2026-11-05]", note: "whose newest Schedule Log entry is a typed reason", key: "p1", family: "waiting", digit: 1, more: null },
  { id: "BM14", line: "- [?] #task L #prj_is_blocked_old", key: "stale", family: "stale", digit: null, more: null },
  { id: "BM15", line: "- [?] #task M [priority:: High] [scheduled:: 2026-12-01]", key: "date", family: "waiting", digit: null, more: null },
  { id: "BM16", line: "- [?] plain bullet [scheduled:: 2026-11-20]", key: null },
  { id: "BM17", line: "- [?] #task N [dependsOn:: nope]", key: null },
  { id: "BM18", line: "- [?] #task O [dependsOn:: nope, x]", key: "dep", family: "held", digit: null, more: null },
  { id: "BM19", line: "- [?] #task P #prj_is_blocked [dependsOn:: y]", key: "dep", family: "held", digit: null, more: "prj" },
  { id: "BM20", line: "> - [?] #task Q [priority:: lowest] [scheduled:: 2027-03-03]", key: "p4", family: "waiting", digit: 4, more: null },
  { id: "BM21", line: "- [?] #task R `[scheduled:: 2026-11-20]`", key: "stale", family: "stale", digit: null, more: null },
  { id: "BM22", line: "- [?] #task A [priority:: medium] [scheduled:: 2026-11-20]", key: "p2", family: "waiting", digit: 2, more: null, ladder: [Object.freeze({ label: "Soon", value: "medium", minDays: 8, maxDays: 30 })] },
  { id: "BM23", line: "- [?] #task C [repeat:: every day when done] [scheduled:: 2026-11-02]", today: "2026-11-02", key: "stale", family: "stale", digit: null, more: null },
  { id: "BM25", line: "- [?] #task S [dependsOn:: x, d]", key: "dep", family: "held", digit: null, more: null },
  { id: "BM26", line: "- [ ] #task T [priority:: high] [scheduled:: 2026-11-20]", key: null },
  { id: "BM27", line: "- [?] #task U [scheduled:: 2026-10-22]", key: "stale", family: "stale", digit: null, more: null },
];

test("BM1–BM27 model vectors pass verbatim except Tasks-only BM24", () => {
  assert.equal(BM_VECTORS.length, 26);
  for (const vector of BM_VECTORS) {
    const overrides = {
      ...(vector.today ? { today: vector.today } : {}),
      ...(vector.ladder ? { ladder: vector.ladder } : {}),
      ...(vector.cacheReady === false ? { lookupId: () => null } : {}),
    };
    const model = modelFor(vector.line, overrides);
    assert.equal(model && model.key, vector.key, vector.id + ": key");
    if (vector.key === null) continue;
    assert.equal(model.family, vector.family, vector.id + ": family");
    assert.equal(model.digit, vector.digit, vector.id + ": digit");
    assert.equal(model.more, vector.more, vector.id + ": more");
    assert.ok(Object.isFrozen(model), vector.id + ": model is frozen");
    assert.ok(Object.isFrozen(model.reasons), vector.id + ": reasons are frozen");
    assert.ok(!model.tooltip.includes("::"), vector.id + ": tooltip has no inline-field syntax");
  }
});

test("BM tooltip wording and losing-reason order match the contract", () => {
  assert.equal(
    modelFor(BM_VECTORS[0].line).tooltip,
    "Blocked · P2 deferral · until Fri, Nov 20 · in 19 days\n" +
      "Ctrl+Shift+P to reschedule or change priority",
  );
  assert.equal(
    modelFor(BM_VECTORS[1].line).tooltip,
    "Blocked · until Wed, Nov 4 · in 3 days\nCtrl+Shift+P to reschedule",
  );
  assert.equal(
    modelFor(BM_VECTORS[2].line).tooltip,
    "Recurring · next run Mon, Nov 2 · tomorrow",
  );
  assert.equal(
    modelFor(BM_VECTORS[3].line).tooltip,
    "Blocked · after Finish the battery\nCtrl+Shift+B to edit prerequisites",
  );
  assert.equal(
    modelFor(BM_VECTORS[4].line).tooltip,
    "Blocked, but no reason is left\nClears on the next reconcile",
  );
  assert.equal(
    modelFor(BM_VECTORS[6].line).tooltip,
    "Blocked · via project Example",
  );
  assert.equal(
    modelFor(BM_VECTORS[7].line).tooltip,
    "Blocked · after Finish the battery\n" +
      "Ctrl+Shift+B to edit prerequisites\n" +
      "Also scheduled Sun, Dec 20 · in 49 days",
  );
  assert.equal(
    modelFor(BM_VECTORS[8].line).tooltip,
    "Blocked · via project Example\nAlso scheduled Fri, Nov 20 · in 19 days",
  );
  assert.equal(
    modelFor(BM_VECTORS[18].line).tooltip,
    "Blocked · after Review the plan\n" +
      "Ctrl+Shift+B to edit prerequisites\nAlso via project Example",
  );
});

test("pure helpers preserve canonical eligibility, ids, digits, and decisions", () => {
  assert.equal(blockMarkEligible("- [?] #task A"), true);
  assert.equal(blockMarkEligible("> - [?] #task A"), true);
  assert.equal(blockMarkEligible("- [*] #task A"), false);
  assert.equal(blockMarkEligible("- [?] #tasking A"), false);
  assert.equal(blockMarkEligible("- [?] `#task` A"), false);
  const masked = blockMarkMaskInlineCode("- [?] #task A `[scheduled:: 2026-11-20]`");
  assert.equal(masked.length, "- [?] #task A `[scheduled:: 2026-11-20]`".length);
  assert.ok(!masked.includes("scheduled::"));
  assert.deepEqual(
    blockMarkDependsOnIds("- [?] #task A [dependsOn:: x, d] (dependsOn:: y, x) `[dependsOn:: z]`"),
    ["x", "d", "y"],
  );
  assert.equal(blockMarkDigit("medium", LADDER), 2);
  assert.equal(blockMarkDigit("medium", [{ label: "Soon", value: "medium" }]), 2);
  assert.equal(blockMarkDigit("medium", [{ label: "P3", value: "medium" }]), 3);
  assert.equal(blockMarkDigit("highest", LADDER), null);

  const unknown = blockMarkClassify({
    dependencyState: "unknown",
    project: { blocked: true, text: "Example" },
    date: { key: "p2", digit: 2, date: "2026-11-20" },
  });
  assert.equal(unknown, null);
  assert.equal(
    blockMarkTooltip({ key: "stale", reasons: [] }),
    "Blocked, but no reason is left\nClears on the next reconcile",
  );
});

function pluginFor(tasks) {
  const memo = { tasks };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": { getTasks: () => tasks },
      },
    },
  };
  plugin.freshnessEnsureMemo = () => memo;
  plugin.priorityLadderSnapshot = () => ({ ladder: LADDER });
  plugin.dateMarksToday = () => TODAY;
  plugin.blockMarksEnabled = true;
  return { plugin, memo };
}

test("memo-local open-ID index keeps duplicate task IDs and project reasons one hop", () => {
  const projectTask = Object.freeze({
    id: "project-task-id",
    status: Object.freeze({ type: "ON_HOLD" }),
    path: "Projects/Example.md",
    blockId: "prj",
    description: "#task Example [dependsOn:: x] ^prj",
  });
  const closedDuplicate = Object.freeze({
    id: "x",
    status: Object.freeze({ type: "DONE" }),
    path: "Projects/Archive.md",
    blockId: "x-closed",
    description: "Closed duplicate #task",
  });
  const tasks = [...TASKS, closedDuplicate, projectTask];
  const { plugin, memo } = pluginFor(tasks);
  const index = plugin.blockMarksIdIndex();
  assert.ok(index instanceof Map);
  assert.strictEqual(plugin.blockMarksIdIndex(), index);
  assert.strictEqual(memo.blockMarksIdIndex, index);
  assert.equal(index.get("x").length, 2);

  const resident = plugin.blockMarkModelForLine(
    "Projects/Example.md",
    "- [?] #task Resident #prj_is_blocked",
  );
  assert.equal(resident.key, "prj");
  assert.equal(resident.tooltip, "Blocked · via project Example\nafter Finish the battery");

  const projectLine = plugin.blockMarkModelForLine(
    "Projects/Example.md",
    "- [?] #task Example [dependsOn:: x] ^prj",
  );
  assert.equal(projectLine.key, "dep");
  assert.equal(plugin.blockMarkProjectReason("Projects/Example.md"), "after Finish the battery");
});

test("api.blockMarks v1 model is synchronous, frozen, toggle-aware, and neutral while cold", () => {
  const { plugin } = pluginFor(TASKS);
  const api = plugin.blockMarksApi();
  assert.equal(api.version, 1);
  assert.ok(Object.isFrozen(api));
  const model = api.model("- [?] #task A [priority:: medium] [scheduled:: 2026-11-20]", {
    path: "Projects/Example.md",
  });
  assert.equal(model.key, "p2");
  assert.equal(api.model(null, null), null);
  plugin.blockMarksEnabled = false;
  assert.equal(api.model("- [?] #task A [scheduled:: 2026-11-20]", { path: "x.md" }), null);

  const { plugin: coldPlugin } = pluginFor([]);
  const coldApi = coldPlugin.blockMarksApi();
  assert.equal(
    coldApi.model("- [?] #task A [dependsOn:: x]", { path: "Projects/Example.md" }),
    null,
  );
  assert.equal(coldPlugin.blockMarksIdIndex(), null);
});

test("model keys are stable for equal results and change with a changed mark", () => {
  const first = modelFor(BM_VECTORS[0].line);
  const second = modelFor(BM_VECTORS[0].line);
  const changed = modelFor("- [?] #task A [priority:: medium] [scheduled:: 2026-11-21]");
  assert.equal(first.modelKey, second.modelKey);
  assert.notEqual(first.modelKey, changed.modelKey);
});
