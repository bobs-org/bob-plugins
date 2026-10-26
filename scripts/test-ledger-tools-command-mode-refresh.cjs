const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: class {},
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

function makeApp() {
  const handlers = new Map();
  return {
    handlers,
    plugins: { plugins: {} },
    workspace: {
      on: (name, callback) => {
        handlers.set(name, callback);
        return { name };
      },
      offref: () => {},
      onLayoutReady: () => {},
      getLeavesOfType: () => [],
      trigger: () => {},
    },
    vault: { getMarkdownFiles: () => [] },
    metadataCache: { on: () => ({}) },
  };
}

function makePlugin(app) {
  const plugin = new LedgerToolsPlugin(app, {});
  const registered = [];
  plugin.registerEvent = (ref) => {
    registered.push(ref);
  };
  return { plugin, registered };
}

function stubRefresh(plugin, calls) {
  plugin.schedulePomodoroThemesFetch = (reason) => {
    calls.push(["themes", reason]);
  };
  plugin.scheduleRelationLabelsJournalRefresh = (reason) => {
    calls.push(["relations-journal", reason]);
  };
  plugin.scheduleRelationIndexOverlayRefresh = () => {
    calls.push(["relations-index"]);
  };
  plugin.scheduleStatsRevalidate = (reason) => {
    calls.push(["stats", reason]);
  };
  plugin.apiReadingBoardRefresh = () => {
    calls.push(["references"]);
    return Promise.resolve({});
  };
  plugin.schedulePlanBlockRerender = () => {
    calls.push(["tasks-plan"]);
  };
  plugin.refreshTodayCacheFromDaily = () => {
    calls.push(["tasks-today"]);
  };
  plugin.scheduleFreshnessMarksRefresh = () => {
    calls.push(["tasks-freshness-marks"]);
  };
  plugin.scheduleFreshnessStatusBar = () => {
    calls.push(["tasks-freshness-status"]);
  };
}

test("setup subscribes to the command-mode run-finished workspace event", () => {
  const app = makeApp();
  const { plugin, registered } = makePlugin(app);

  plugin.setupCommandModeRunRefresh();

  assert.equal(registered.length, 1);
  assert.ok(app.handlers.has("bob-command-mode:run-finished"));
});

test("each invalidates tag refreshes its ledger cache and unknown tags are ignored", () => {
  const app = makeApp();
  const { plugin } = makePlugin(app);
  const calls = [];
  stubRefresh(plugin, calls);
  plugin.setupCommandModeRunRefresh();

  app.handlers.get("bob-command-mode:run-finished")({
    runId: "20261026-120000-ab12",
    argv: ["ref", "create", "area/note.md"],
    entryId: "ref-create",
    outcome: "completed",
    effect: "writes",
    invalidates: ["themes", "relations", "stats", "references", "tasks", "plugins"],
  });

  assert.deepEqual(calls, [
    ["themes", "command-mode"],
    ["relations-journal", "command-mode"],
    ["relations-index"],
    ["stats", "command-mode"],
    ["references"],
    ["tasks-plan"],
    ["tasks-today"],
    ["tasks-freshness-marks"],
    ["tasks-freshness-status"],
  ]);
});

test("duplicate tags refresh once and a failing hook never blocks the others", () => {
  const app = makeApp();
  const { plugin } = makePlugin(app);
  const calls = [];
  stubRefresh(plugin, calls);
  plugin.scheduleStatsRevalidate = () => {
    throw new Error("stats refresh blew up");
  };
  plugin.setupCommandModeRunRefresh();

  app.handlers.get("bob-command-mode:run-finished")({
    invalidates: ["stats", "stats", "tasks"],
  });

  assert.deepEqual(calls, [["tasks-plan"], ["tasks-today"], ["tasks-freshness-marks"], ["tasks-freshness-status"]]);
});

test("payloads without invalidates and setups without a workspace never throw", () => {
  const app = makeApp();
  const { plugin } = makePlugin(app);
  const calls = [];
  stubRefresh(plugin, calls);
  plugin.setupCommandModeRunRefresh();
  const handler = app.handlers.get("bob-command-mode:run-finished");

  assert.doesNotThrow(() => handler(undefined));
  assert.doesNotThrow(() => handler({ invalidates: "tasks" }));
  assert.doesNotThrow(() => handler({ invalidates: [null, 42, "tasks"] }));
  assert.deepEqual(
    calls.filter(([name]) => name.startsWith("tasks")),
    [["tasks-plan"], ["tasks-today"], ["tasks-freshness-marks"], ["tasks-freshness-status"]],
  );

  const bare = new LedgerToolsPlugin({ plugins: { plugins: {} } }, {});
  bare.registerEvent = () => {};
  assert.doesNotThrow(() => bare.setupCommandModeRunRefresh());
});
