// Tests for the pure blocked-reason classifier and api.blockMarks v1.
// BM vectors below follow bob-cli `docs/blocked-marks.md` verbatim; BM24 is
// the Tasks-results CSS vector, asserted against styles.css and the CSS
// cascade helper (no JS writes Tasks DOM).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const blockMarksE2e = require("./obsidian-block-marks-e2e-lib.cjs");

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
  blockMarkIsDigitKey,
  blockMarkProjectTagSource,
  blockMarkAwaitingTagSource,
  blockMarkFoldTagForKey,
  blockMarkAwaitingPhrase,
  blockMarkIsMailFrontmatter,
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

test("fold helpers: digit keys, BM1/BM8/BM9 bars, BM7/BM19 pills", () => {
  assert.equal(blockMarkIsDigitKey("p1"), true);
  assert.equal(blockMarkIsDigitKey("p4"), true);
  assert.equal(blockMarkIsDigitKey("dep"), false);
  assert.equal(blockMarkIsDigitKey("prj"), false);
  assert.equal(blockMarkIsDigitKey(null), false);

  const bm1 = modelFor(BM_VECTORS[0].line);
  const bm8 = modelFor(BM_VECTORS[7].line);
  const bm9 = modelFor(BM_VECTORS[8].line);
  const bm7 = modelFor(BM_VECTORS[6].line);
  const bm19 = modelFor(BM_VECTORS[18].line);
  assert.equal(blockMarkIsDigitKey(bm1.key), true, "BM1 bars fold");
  assert.equal(blockMarkIsDigitKey(bm8.key), false, "BM8 bars shown");
  assert.equal(blockMarkIsDigitKey(bm9.key), false, "BM9 bars shown");

  const bm7Source = blockMarkProjectTagSource(BM_VECTORS[6].line);
  assert.ok(bm7Source);
  assert.equal(bm7.key, "prj");
  assert.equal(
    BM_VECTORS[6].line.slice(bm7Source.tagStart, bm7Source.tagEnd),
    "#prj_is_blocked",
  );
  assert.equal(bm7Source.foldSpace, true);

  const bm19Source = blockMarkProjectTagSource(BM_VECTORS[18].line);
  assert.ok(bm19Source);
  assert.equal(bm19.key, "dep");
  assert.equal(blockMarkProjectTagSource("- [?] #task L #prj_is_blocked_old"), null);
  assert.equal(
    blockMarkProjectTagSource("- [?] #task R `#prj_is_blocked`"),
    null,
  );

  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(
    css.includes('li.task-list-item[data-bob-block="p2"] .task-priority'),
    "source-note Tasks-classified digit rows clip .task-priority",
  );
});

test("BM24 Tasks CSS cascade: digit from future scheduled + medium, no project tag", () => {
  const key = blockMarksE2e.tasksResultCssKey({
    dataTask: "?",
    scheduled: "future-far",
    priority: "medium",
    hasPrjTag: false,
    hasRecurring: false,
  });
  assert.equal(key, "p2");
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "future-3d",
      priority: "high",
      hasPrjTag: false,
    }),
    "p1",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "future-far",
      priority: "lowest",
      hasPrjTag: false,
    }),
    "p4",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "future-far",
      priority: "medium",
      hasPrjTag: true,
    }),
    "prj",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "future-1d",
      priority: "normal",
      hasRecurring: true,
    }),
    "repeat",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "future-far",
      priority: "highest",
    }),
    "date",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "today",
      priority: "medium",
    }),
    "dep",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({ dataTask: "*", scheduled: "future-far", priority: "high" }),
    null,
  );

  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(css.includes('ul.plugin-tasks-query-result li.plugin-tasks-list-item[data-task="?"]'));
  assert.ok(css.includes('[data-task-scheduled^="future-"][data-task-priority="medium"]'));
  assert.ok(css.includes('content: "2"'));
  assert.ok(css.includes(':has(.tag[data-tag-name="#prj_is_blocked"])'));
  assert.ok(css.includes(":has(.task-recurring)"));
  assert.ok(css.includes("clip-path: inset(50%)"));
  assert.ok(
    css.includes(
      "body.bob-block-marks ul.plugin-tasks-query-result li.plugin-tasks-list-item[data-task=\"?\"] > .task-list-item-checkbox",
    ),
  );
  const tasksSection = css.slice(css.indexOf("Tasks query results: CSS-only"));
  assert.ok(tasksSection.length > 200, "Tasks CSS section is present");
  assert.ok(!/plugin-tasks-list-item[^{}!]*!important/.test(tasksSection));
  assert.ok(
    !/li\.plugin-tasks-list-item[^\n{]*\[data-bob-block\]/.test(tasksSection),
    "Tasks CSS must not key off JS data-bob-block attributes",
  );
  const ungatedTasks = tasksSection.match(
    /(?:^|\n)(?![^\n]*ul\.plugin-tasks-query-result)[^\n]*li\.plugin-tasks-list-item[^\n]*\{/g,
  );
  assert.equal(
    ungatedTasks,
    null,
    "Tasks paint must stay inside ul.plugin-tasks-query-result so source-note lis keep JS marks",
  );
});

// Awaiting-reply vectors (bob-cli `docs/blocked-marks.md`, AW1–AW7).
// Today is Sat 2026-11-07; `A` links a mail note whose `who` is Ada.
const AW_TODAY = "2026-11-07";
const AW_LINK = "[[mail/2026/261107_lease_renewal|✉️ Lease renewal · Ada]]";
const AW1_LINE = `- [?] #task #awaiting_reply ${AW_LINK} [scheduled:: 2026-11-10]`;
const AW_TOOLTIP = "Awaiting reply from Ada · nudge Tue, Nov 10 · in 3 days";

function awaitingModelFor(lineText, overrides = {}) {
  return modelFor(lineText, {
    today: AW_TODAY,
    mailWho: () => "Ada",
    ...overrides,
  });
}

const AW_VECTORS = [
  { id: "AW1", line: AW1_LINE, key: "awaiting", family: "waiting", digit: null, more: null, tooltip: AW_TOOLTIP, fold: "#awaiting_reply" },
  { id: "AW2", line: `${AW1_LINE} [priority:: medium]`, key: "awaiting", family: "waiting", digit: null, more: null, tooltip: AW_TOOLTIP, fold: "#awaiting_reply" },
  {
    id: "AW3",
    line: `${AW1_LINE} [dependsOn:: x]`,
    key: "dep",
    family: "held",
    digit: null,
    more: "awaiting",
    tooltip:
      "Blocked · after Finish the battery\n" +
      "Ctrl+Shift+B to edit prerequisites\n" +
      "Also awaiting reply from Ada · nudge Tue, Nov 10 · in 3 days",
    fold: null,
  },
  { id: "AW4", line: `- [?] #task #awaiting_reply ${AW_LINK} [scheduled:: 2026-11-07]`, key: "stale", family: "stale", digit: null, more: null, fold: null },
  { id: "AW5", line: `- [ ] #task #awaiting_reply ${AW_LINK} [scheduled:: 2026-11-05]`, key: null },
  {
    id: "AW6",
    line: `- [?] #task #awaiting_reply_old ${AW_LINK} [scheduled:: 2026-11-10]`,
    key: "date",
    family: "waiting",
    digit: null,
    more: null,
    tooltip: "Blocked · until Tue, Nov 10 · in 3 days\nCtrl+Shift+P to reschedule",
    fold: null,
  },
];

test("AW1–AW6 awaiting-reply model vectors pass verbatim", () => {
  for (const vector of AW_VECTORS) {
    const model = awaitingModelFor(vector.line);
    assert.equal(model && model.key, vector.key, vector.id + ": key");
    if (vector.key === null) continue;
    assert.equal(model.family, vector.family, vector.id + ": family");
    assert.equal(model.digit, vector.digit, vector.id + ": digit");
    assert.equal(model.more, vector.more, vector.id + ": more");
    if (vector.tooltip) assert.equal(model.tooltip, vector.tooltip, vector.id + ": tooltip");
    assert.ok(!model.tooltip.includes("::"), vector.id + ": tooltip has no inline-field syntax");
    assert.ok(Object.isFrozen(model) && Object.isFrozen(model.reasons), vector.id + ": frozen");
    assert.equal(blockMarkFoldTagForKey(model.key), vector.fold, vector.id + ": fold");
    assert.equal(blockMarkIsDigitKey(model.key), false, vector.id + ": bars stay shown");
  }
});

test("awaiting owns its date: no date reason, no digit, no Also scheduled pip", () => {
  const aw2 = awaitingModelFor(`${AW1_LINE} [priority:: medium]`);
  assert.deepEqual(
    aw2.reasons.map((reason) => [reason.kind, reason.key, reason.text]),
    [["awaiting", "awaiting", "2026-11-10"]],
  );
  assert.ok(!aw2.tooltip.includes("Also scheduled"));

  const recurring = awaitingModelFor(
    `${AW1_LINE} [repeat:: every week]`,
  );
  assert.equal(recurring.key, "awaiting", "awaiting outranks every date source");

  const prj = awaitingModelFor(
    `- [?] #task #prj_is_blocked #awaiting_reply ${AW_LINK} [scheduled:: 2026-11-10]`,
  );
  assert.equal(prj.key, "prj");
  assert.equal(prj.more, "awaiting");
  assert.equal(blockMarkFoldTagForKey(prj.key), "#prj_is_blocked");
  assert.equal(
    prj.tooltip,
    "Blocked · via project Example\nAlso awaiting reply from Ada · nudge Tue, Nov 10 · in 3 days",
  );

  const depAndPrj = awaitingModelFor(
    `- [?] #task #prj_is_blocked #awaiting_reply ${AW_LINK} [scheduled:: 2026-11-10] [dependsOn:: x]`,
  );
  assert.equal(depAndPrj.key, "dep");
  assert.equal(depAndPrj.more, "prj", "the highest losing reason takes the pip");

  const inCode = awaitingModelFor(
    `- [?] #task \`#awaiting_reply\` ${AW_LINK} [scheduled:: 2026-11-10]`,
  );
  assert.equal(inCode.key, "date", "a tag in inline code is not the token");
});

test("AP1–AP4 Also-replied tooltip pip vectors pass verbatim", () => {
  const ap1 = modelFor(`- [?] #task ${AW_LINK} [dependsOn:: x]`, {
    today: AW_TODAY,
    mailFacts: () => ({ who: "Ada", turn: "yours", turnSince: "2026-11-07T14:00:00" }),
  });
  assert.ok(ap1.tooltip.includes("Also: Ada replied"), "AP1");
  assert.ok(!ap1.tooltip.includes("::"), "AP1: tooltip has no inline-field syntax");

  const ap2 = modelFor(
    `- [?] #task #awaiting_reply ${AW_LINK} [scheduled:: 2026-11-10] [dependsOn:: x]`,
    {
      today: AW_TODAY,
      mailFacts: () => ({ who: "Ada", turn: "yours", turnSince: "2026-11-07T14:00:00" }),
    },
  );
  assert.equal(ap2.tooltip.includes("replied"), false, "AP2: awaiting is live");
  assert.ok(ap2.tooltip.includes("Also awaiting reply from Ada"), "AP2 still names the wait");

  const ap3 = modelFor(`- [?] #task ${AW_LINK} [dependsOn:: x]`, {
    today: AW_TODAY,
    mailFacts: () => ({ who: "Ada", turn: "theirs", turnSince: "2026-11-07T14:00:00" }),
  });
  assert.equal(ap3.tooltip.includes("replied"), false, "AP3");

  const ap4 = modelFor(`- [?] #task ${AW_LINK} [dependsOn:: x]`, {
    today: AW_TODAY,
    mailFacts: () => ({ who: "", turn: "yours", turnSince: "2026-11-07T14:00:00" }),
  });
  assert.ok(ap4.tooltip.includes("Also: replied"), "AP4");
});

test("awaiting tooltip omits <who> when unknown and never throws on odd who", () => {
  assert.equal(
    awaitingModelFor(AW1_LINE, { mailWho: () => "" }).tooltip,
    "Awaiting reply · nudge Tue, Nov 10 · in 3 days",
  );
  assert.equal(
    awaitingModelFor(AW1_LINE, { mailWho: undefined }).tooltip,
    "Awaiting reply · nudge Tue, Nov 10 · in 3 days",
  );
  assert.equal(
    awaitingModelFor(AW1_LINE, {
      mailWho: () => {
        throw new Error("boom");
      },
    }).tooltip,
    "Awaiting reply · nudge Tue, Nov 10 · in 3 days",
  );
  assert.equal(
    awaitingModelFor(AW1_LINE, { mailWho: () => " Ada:: Lovelace\nsecond " }).tooltip,
    "Awaiting reply from Ada: Lovelace · nudge Tue, Nov 10 · in 3 days",
  );
  let calls = 0;
  awaitingModelFor(`- [?] #task #awaiting_reply_old ${AW_LINK} [scheduled:: 2026-11-10]`, {
    mailWho: () => {
      calls += 1;
      return "Ada";
    },
  });
  assert.equal(calls, 0, "the who lookup runs only for a live awaiting reason");
  assert.equal(
    blockMarkAwaitingPhrase("2026-11-08", AW_TODAY, "Ada"),
    "Awaiting reply from Ada · nudge Sun, Nov 8 · tomorrow",
  );
});

test("awaiting tag source is exact, quote-aware, and folds with its space", () => {
  const source = blockMarkAwaitingTagSource(AW1_LINE);
  assert.ok(source);
  assert.equal(AW1_LINE.slice(source.tagStart, source.tagEnd), "#awaiting_reply");
  assert.equal(source.foldSpace, true);
  assert.equal(blockMarkAwaitingTagSource("- [?] #task #awaiting_reply_old A"), null);
  assert.equal(blockMarkAwaitingTagSource("- [?] #task `#awaiting_reply` A"), null);
  assert.equal(blockMarkFoldTagForKey("dep"), null);
  assert.equal(blockMarkFoldTagForKey("p2"), null);
});

function mailPluginFor(files) {
  const { plugin } = pluginFor(TASKS);
  const lookups = [];
  plugin.app.metadataCache = {
    getFirstLinkpathDest(target, source) {
      lookups.push([target, source]);
      return Object.prototype.hasOwnProperty.call(files, target)
        ? { path: target + ".md" }
        : null;
    },
    getFileCache(file) {
      const frontmatter = files[String(file.path).replace(/\.md$/, "")];
      return frontmatter ? { frontmatter } : null;
    },
  };
  plugin.dateMarksToday = () => AW_TODAY;
  return { plugin, lookups };
}

test("plugin <who> lookup reads the first linked mail note through the metadata cache", () => {
  const { plugin, lookups } = mailPluginFor({
    "Projects/Other": { type: "[[area]]", who: "Nope" },
    "mail/2026/261107_lease_renewal": { type: "[[mail]]", who: "Ada" },
  });
  const line =
    "- [?] #task #awaiting_reply [[Projects/Other]] " +
    AW_LINK +
    " `[[mail/2026/261107_lease_renewal]]` [scheduled:: 2026-11-10]";
  const model = plugin.blockMarkModelForLine("Projects/Example.md", line);
  assert.equal(model.key, "awaiting");
  assert.equal(model.tooltip, AW_TOOLTIP);
  assert.deepEqual(lookups, [
    ["Projects/Other", "Projects/Example.md"],
    ["mail/2026/261107_lease_renewal", "Projects/Example.md"],
  ]);

  const api = plugin.blockMarksApi();
  assert.equal(api.model(AW1_LINE, { path: "Projects/Example.md" }).tooltip, AW_TOOLTIP);

  const { plugin: unknown } = mailPluginFor({});
  assert.equal(
    unknown.blockMarkModelForLine("Projects/Example.md", AW1_LINE).tooltip,
    "Awaiting reply · nudge Tue, Nov 10 · in 3 days",
  );
  const { plugin: noCache } = pluginFor(TASKS);
  noCache.dateMarksToday = () => AW_TODAY;
  assert.equal(noCache.blockMarkMailWho(AW1_LINE, "Projects/Example.md"), "");

  assert.equal(blockMarkIsMailFrontmatter({ type: "[[mail]]" }), true);
  assert.equal(blockMarkIsMailFrontmatter({ type: ["mail"] }), true);
  assert.equal(blockMarkIsMailFrontmatter({ gmail_thread_id: "abc" }), true);
  assert.equal(blockMarkIsMailFrontmatter({ type: "[[area]]" }), false);
  assert.equal(blockMarkIsMailFrontmatter(null), false);
});

test("AW7 Tasks CSS cascade: the plane beats the digit, prj beats the plane", () => {
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "future-3d",
      priority: "medium",
      hasAwaitingTag: true,
    }),
    "awaiting",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "future-3d",
      priority: "medium",
      hasAwaitingTag: true,
      hasPrjTag: true,
    }),
    "prj",
  );
  assert.equal(
    blockMarksE2e.tasksResultCssKey({
      dataTask: "?",
      scheduled: "today",
      priority: "medium",
      hasAwaitingTag: true,
    }),
    "dep",
    "a nudge-due row cannot prove a reason in Tasks results",
  );

  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  const tasksSection = css.slice(css.indexOf("Tasks query results: CSS-only"));
  const notPrj =
    ':not(:has(.tag[data-tag-name="#prj_is_blocked"])):not(:has(.tag[href="#prj_is_blocked"]))';
  const plane =
    'li.plugin-tasks-list-item[data-task="?"][data-task-scheduled^="future-"]' +
    notPrj +
    ':has(.tag[data-tag-name="#awaiting_reply"]) > .task-list-item-checkbox:checked::after';
  const planeAt = tasksSection.indexOf(plane);
  assert.ok(planeAt !== -1, "the plane rule excludes prj rows explicitly");
  const planeBody = tasksSection.slice(planeAt, tasksSection.indexOf("}", planeAt));
  assert.ok(planeBody.includes("mask-image: var(--bob-block-glyph-sent)"));
  const digitAt = tasksSection.indexOf('[data-task-priority="medium"] > .task-list-item-checkbox:checked::after');
  const prjAt = tasksSection.indexOf(':has(.tag[data-tag-name="#prj_is_blocked"]) > .task-list-item-checkbox:checked::after');
  assert.ok(digitAt !== -1 && digitAt < planeAt && planeAt < prjAt, "ranked after the digits, before prj");
  assert.ok(
    tasksSection.includes(
      ':not(:has(.tag[data-tag-name="#awaiting_reply"])):not(:has(.tag[href="#awaiting_reply"])) .task-priority',
    ),
    "plane rows keep their bars",
  );
  assert.ok(
    tasksSection.includes(notPrj + ' .tag[data-tag-name="#awaiting_reply"]'),
    "plane rows clip the #awaiting_reply tag; prj rows keep it",
  );
  assert.ok(!tasksSection.includes('[data-tag-name^="#awaiting_reply"]'), "the tag is matched exactly");
});
