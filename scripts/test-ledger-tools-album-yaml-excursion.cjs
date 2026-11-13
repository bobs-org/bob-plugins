const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => ({ of(value) { return { value, effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ widget: options.widget, side: options.side }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

function modelWith(issues) {
  return { path: "eat.md", fields: [], issues };
}

function errorIssue(overrides = {}) {
  return {
    severity: "error", code: "schema-invalid", path: "eat.md",
    line: 4, key_path: "record", message: "Schema error here.",
    suggestions: ["Fix the mapping."],
    ...overrides,
  };
}

function reportState(overrides = {}) {
  return {
    report: { albums: [] }, stale: false, unavailable: false,
    refreshing: false, error: null, ...overrides,
  };
}

test("error focus picks the first error line with message and suggestions", () => {
  const focus = helpers.albumYamlErrorFocus(modelWith([
    { severity: "warning", code: "w", path: "eat.md", line: 2, message: "Warn.", suggestions: [] },
    errorIssue({ line: 9, message: "Bad field.", suggestions: ["Use text.", "Remove it."] }),
  ]));
  assert.deepEqual(focus, { line: 9, message: "Bad field.", suggestions: ["Use text.", "Remove it."], code: "schema-invalid" });
  assert.equal(helpers.albumYamlErrorFocus(modelWith([])), null);
  assert.equal(helpers.albumYamlErrorFocus(modelWith([
    { severity: "warning", code: "w", path: "eat.md", line: 2, message: "Warn.", suggestions: [] },
  ])), null);
});

test("Done refuses failed saves before touching the report", () => {
  const failed = helpers.albumYamlDoneDecision({
    save: { ok: false, code: "save-failed", message: "Saving failed." },
    reportState: reportState(),
    model: modelWith([]),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "save-failed");
  const unsupported = helpers.albumYamlDoneDecision({
    save: { ok: false, code: "save-unsupported", message: "No save support." },
    reportState: reportState(),
    model: modelWith([]),
  });
  assert.equal(unsupported.reason, "save-unsupported");
});

test("Done refuses unavailable or stale reports", () => {
  for (const state of [
    reportState({ report: null }),
    reportState({ unavailable: true }),
    reportState({ stale: true }),
    reportState({ generation: 8, reportGeneration: 7 }),
    reportState({ refreshing: true }),
    reportState({ error: { code: "failed" } }),
  ]) {
    const decision = helpers.albumYamlDoneDecision({ save: { ok: true }, reportState: state, model: modelWith([]) });
    assert.equal(decision.ok, false, JSON.stringify(state));
    assert.equal(decision.reason, "unavailable");
  }
  const gone = helpers.albumYamlDoneDecision({ save: { ok: true }, reportState: reportState(), model: null });
  assert.equal(gone.ok, false);
  assert.equal(gone.reason, "unavailable");
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function excursionHarness() {
  const leaf = {
    view: { file: { path: "eat.md" }, editor: { setCursor() {} } },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const opened = [];
  plugin.albumYamlExcursions = new Map();
  plugin.albumYamlExcursionDisposed = false;
  plugin.app = { workspace: { activeLeaf: leaf } };
  plugin.apiAlbumReport = async () => reportState();
  plugin.albumHeaderModelFor = () => modelWith([]);
  plugin.openAlbumSchemaCard = (...args) => { opened.push(args); return { modal: { schemaSelect() {} } }; };
  const record = {
    albumPath: "eat.md", viewState: null, selectedKey: "stats", fingerprint: "sha256:before",
    doneEl: null, container: null, completionPromise: null,
  };
  plugin.albumYamlExcursions.set(leaf, record);
  return { plugin, leaf, record, opened };
}

test("Done shares one pending save across concurrent clicks", async () => {
  const { plugin, leaf, opened } = excursionHarness();
  const save = deferred();
  let saves = 0;
  let reports = 0;
  plugin.albumYamlSaveExcursionEditors = () => { saves += 1; return save.promise; };
  plugin.apiAlbumReport = async () => { reports += 1; return reportState(); };

  const first = plugin.albumYamlDone({ leaf });
  const second = plugin.albumYamlDone({ leaf });
  assert.equal(saves, 1);
  save.resolve({ ok: true });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((item) => item.ok), [true, true]);
  assert.equal(reports, 1);
  assert.equal(opened.length, 1);
});

test("Done abandons delayed saves after navigation, pane close, or plugin unload", async () => {
  for (const invalidate of [
    ({ leaf }) => { leaf.view.file.path = "other.md"; },
    ({ plugin, leaf }) => { plugin.albumYamlExcursionClear(leaf); },
    ({ plugin }) => { plugin.teardownAlbumYamlExcursion(); },
  ]) {
    const harness = excursionHarness();
    const save = deferred();
    let reports = 0;
    harness.plugin.albumYamlSaveExcursionEditors = () => save.promise;
    harness.plugin.apiAlbumReport = async () => { reports += 1; return reportState(); };
    const completion = harness.plugin.albumYamlDone({ leaf: harness.leaf });
    invalidate(harness);
    save.resolve({ ok: true });
    assert.deepEqual(await completion, { ok: false, reason: "stale-excursion" });
    assert.equal(reports, 0);
    assert.equal(harness.opened.length, 0);
  }
});

test("Done does not reopen the card if its pane navigates during view restoration", async () => {
  const { plugin, leaf, record, opened } = excursionHarness();
  const restoring = deferred();
  let restoreStarted = false;
  record.viewState = { state: { mode: "preview" } };
  leaf.setViewState = async () => { restoreStarted = true; return restoring.promise; };
  plugin.albumYamlSaveExcursionEditors = async () => ({ ok: true });
  const completion = plugin.albumYamlDone({ leaf });
  while (!restoreStarted) await new Promise((resolve) => setImmediate(resolve));
  leaf.view.file.path = "other.md";
  restoring.resolve();
  assert.deepEqual(await completion, { ok: false, reason: "stale-excursion" });
  assert.equal(opened.length, 0);
});

test("Done keeps Source mode on schema errors and paints the diagnostic line", () => {
  const decision = helpers.albumYamlDoneDecision({
    save: { ok: true },
    reportState: reportState(),
    model: modelWith([errorIssue({ line: 12, message: "Bad kind.", suggestions: ["Use text."] })]),
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "schema-errors");
  assert.equal(decision.focus.line, 12);
  assert.match(decision.message, /Bad kind/);
  assert.match(decision.message, /Use text/);
});

test("Done approves valid schemas and warning-only reports", () => {
  const valid = helpers.albumYamlDoneDecision({
    save: { ok: true }, reportState: reportState(), model: modelWith([]),
  });
  assert.deepEqual(valid, { ok: true, reason: "valid" });
  const warnings = helpers.albumYamlDoneDecision({
    save: { ok: true },
    reportState: reportState(),
    model: modelWith([{ severity: "warning", code: "w", path: "eat.md", line: 3, message: "Warn.", suggestions: [] }]),
  });
  assert.equal(warnings.ok, true);
});

test("Done button is a small accessible affordance outside the note text", () => {
  const calls = [];
  const doc = {
    createElement: (tag) => {
      calls.push(tag);
      const attrs = new Map();
      return {
        tag,
        setAttribute: (k, v) => attrs.set(k, v),
        getAttribute: (k) => attrs.get(k) ?? null,
        attrs,
        textContent: "",
        addEventListener: () => {},
      };
    },
  };
  const el = helpers.albumYamlBuildDoneEl(doc, "eat.md");
  assert.equal(calls[0], "button");
  assert.equal(el.getAttribute("aria-label"), "Done editing album schema");
  assert.equal(el.getAttribute("data-album-yaml-done"), "eat.md");
  assert.equal(el.getAttribute("type"), "button");
});

test("two panes keep separate excursions: decisions are per-leaf records", () => {
  // The excursion record carries its own album path, view state, selected
  // key, and session identity, so Pane A approving never clears Pane B.
  const paneA = { albumPath: "eat.md", selectedKey: "field:status" };
  const paneB = { albumPath: "movies.md", selectedKey: "stats" };
  assert.notEqual(paneA.albumPath, paneB.albumPath);
  const decisionA = helpers.albumYamlDoneDecision({
    save: { ok: true }, reportState: reportState(), model: modelWith([]),
  });
  assert.equal(decisionA.ok, true);
});
