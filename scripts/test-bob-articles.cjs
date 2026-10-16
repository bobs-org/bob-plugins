const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
class TestPlugin { constructor(app) { this.app = app; } }
class TestModal { constructor(app) { this.app = app; this.contentEl = {}; } }
class TestPluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
class TestSetting {}

const userEvent = Symbol("userEvent");
const userEventAnnotation = {
  of: (value) => ({ key: userEvent, value }),
  key: userEvent,
};
const originalLoad = Module._load;
Module._load = function loadWithArticleStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: TestModal,
      Notice: class TestNotice {},
      Plugin: TestPlugin,
      PluginSettingTab: TestPluginSettingTab,
      Setting: TestSetting,
    };
  }
  if (request === "@codemirror/state") {
    return { Transaction: { userEvent: userEventAnnotation } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: { updateListener: { of: (callback) => ({ callback }) } } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const BobArticlesPlugin = require("../plugins/bob-articles/main.js");
Module._load = originalLoad;
const helpers = BobArticlesPlugin.helpers;

function articlePlan(overrides = {}) {
  return {
    schema_version: 1,
    notes: [{
      path: "article.md",
      status: "changed",
      reason: null,
      sha256: "abc",
      edits: [{ line: 1, delete: 1, insert: ["# 1. Article"] }],
      changes: {},
      replaced: [],
      notice: "Article formatted · 1 sections numbered",
      findings: [],
      outline: {},
      inbound: [],
      ...overrides,
    }],
    summary: { articles: 1, changed: 1, unchanged: 0, skipped: 0, errors: 0 },
  };
}

test("article detection accepts scalar and list frontmatter values", () => {
  assert.equal(helpers.articleHasArticleType({ type: "[[article]]" }), true);
  assert.equal(helpers.articleHasArticleType({ type: ["project", "article"] }), true);
  assert.equal(helpers.articleHasArticleType({ type: "[[project]]" }), false);
});

test("bob resolution prefers its setting, then known install paths, then PATH", () => {
  assert.deepEqual(helpers.articleResolveBobPath("~/bin/bob", { home: "/home/b" }), {
    path: "/home/b/bin/bob",
    source: "config",
  });
  assert.deepEqual(helpers.articleResolveBobPath("", {
    home: "/home/b",
    existsSync: (path) => path === "/home/b/.local/bin/bob",
  }), { path: "/home/b/.local/bin/bob", source: "candidate" });
  assert.deepEqual(helpers.articleResolveBobPath("", { home: "/home/b", existsSync: () => false }), {
    path: "bob",
    source: "path",
  });
});

test("plan decoder accepts v1 and rejects a foreign schema version", () => {
  assert.equal(helpers.articleDecodePlan(JSON.stringify(articlePlan())).ok, true);
  assert.equal(helpers.articleDecodePlan(JSON.stringify({ schema_version: 2, notes: [] })).code, "schema-mismatch");
  assert.equal(helpers.articleDecodePlan("not json").code, "bad-json");
  assert.equal(helpers.articleDecodePlan(JSON.stringify({ schema_version: 1, notes: [] })).code, "bad-shape");
});

test("bob stdin spawn passes the article contract and vault environment", async () => {
  const child = new EventEmitter();
  child.stdin = { end: (value) => { child.input = value; } };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const seen = {};
  const promise = helpers.articleSpawnBob(
    "/home/b/.local/bin/bob",
    ["articles", "format", "--stdin", "folder/article.md", "-f", "json"],
    "article buffer",
    "/vault",
    {
      timeout: 100,
      childProcess: {
        spawn(binary, args, options) {
          seen.binary = binary;
          seen.args = args;
          seen.options = options;
          queueMicrotask(() => {
            child.stdout.emit("data", JSON.stringify(articlePlan()));
            child.emit("close", 0);
          });
          return child;
        },
      },
    },
  );
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(child.input, "article buffer");
  assert.equal(seen.binary, "/home/b/.local/bin/bob");
  assert.deepEqual(seen.args, ["articles", "format", "--stdin", "folder/article.md", "-f", "json"]);
  assert.equal(seen.options.env.BOB_DIR, "/vault");
  assert.equal(seen.options.env.NO_COLOR, "1");
  assert.deepEqual(seen.options.stdio, ["pipe", "pipe", "pipe"]);
});

test("line hunks become minimal cursor-preserving changes", () => {
  const source = "# 1. Start\n\n## Draft\nBody\n";
  const edits = [{ line: 3, delete: 1, insert: ["## 1.1 Draft"] }];
  const formatted = helpers.articleApplyEditsToText(source, edits);
  const changes = helpers.articleBuildChanges(source, edits);
  assert.equal(formatted, "# 1. Start\n\n## 1.1 Draft\nBody\n");
  assert.deepEqual(changes, [{ from: 15, to: 15, insert: "1.1 " }]);
  assert.equal(helpers.articleApplyChangesToText(source, changes), formatted);
});

test("insert, multi-line replace, and deletion hunks reproduce the formatted note", () => {
  const examples = [
    ["A\nB\nC\n", [{ line: 2, delete: 0, insert: ["X"] }]],
    ["A\nB\nC\n", [{ line: 2, delete: 2, insert: ["X", "Y", "Z"] }]],
    ["A\nB\nC", [{ line: 2, delete: 1, insert: [] }]],
    ["A\nB\nC", [{ line: 3, delete: 1, insert: [] }]],
  ];
  for (const [source, edits] of examples) {
    const formatted = helpers.articleApplyEditsToText(source, edits);
    const changes = helpers.articleBuildChanges(source, edits);
    assert.equal(helpers.articleApplyChangesToText(source, changes), formatted, JSON.stringify(edits));
  }
  const crlf = "## Draft\r\nBody\r\n";
  const crlfEdits = [{ line: 1, delete: 1, insert: ["## 1. Draft"] }];
  assert.equal(
    helpers.articleApplyChangesToText(crlf, helpers.articleBuildChanges(crlf, crlfEdits)),
    helpers.articleApplyEditsToText(crlf, crlfEdits),
  );
  assert.equal(helpers.articleApplyEditsToText(crlf, crlfEdits), "## 1. Draft\r\nBody\r\n");
});

test("notice shows bob's text and at most two warning findings", () => {
  const plan = {
    notice: "Article formatted",
    findings: [
      { severity: "warning", message: "first" },
      { severity: "warning", message: "second" },
      { severity: "warning", message: "third" },
      { severity: "info", message: "ignored" },
    ],
  };
  assert.equal(helpers.articleNoticeText(plan), "Article formatted\nfirst · second · +1 more");
});

test("inbound changes apply only when their target line still matches the preimage", async () => {
  const file = { path: "notes.md" };
  const content = new Map([[file.path, "[[article#Old]]\nkeep\n"]]);
  const app = {
    vault: {
      getAbstractFileByPath: (path) => path === file.path ? file : null,
      async process(target, transform) {
        content.set(target.path, transform(content.get(target.path)));
      },
    },
  };
  const plugin = new BobArticlesPlugin(app, {});
  await plugin.articleApplyInbound({ inbound: [
    { path: file.path, line: 1, before: "[[article#Old]]", after: "[[article#1. New]]" },
    { path: file.path, line: 2, before: "changed", after: "not applied" },
  ] });
  assert.equal(content.get(file.path), "[[article#1. New]]\nkeep\n");
});

test("undo guard blocks a reformat until a fresh input or delete event", () => {
  const view = { file: { path: "article.md" }, editor: {} };
  const plugin = new BobArticlesPlugin({ workspace: { getActiveViewOfType: () => view } }, {});
  plugin.articleUndoBlocked = new Set();
  plugin.articleFormatHistory = new Map([["article.md", { before: "before", after: "after" }]]);
  const update = (event, text) => ({
    transactions: [{ annotation: (key) => key === userEventAnnotation ? event : undefined }],
    state: { doc: { toString: () => text } },
  });
  plugin.articleObserveEditorUpdate(update("undo", "before"));
  assert.equal(plugin.articleUndoBlocked.has("article.md"), true);
  plugin.articleObserveEditorUpdate(update("input.type", "fresh"));
  assert.equal(plugin.articleUndoBlocked.has("article.md"), false);
});

test("format drops its response if the editor changed while bob was running", async () => {
  let value = "## Draft\n";
  let dispatches = 0;
  const file = { path: "article.md" };
  const editor = {
    getValue: () => value,
    cm: { dispatch() { dispatches += 1; } },
  };
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter: { type: "[[article]]" } }) },
    vault: {},
    workspace: {},
  };
  const plugin = new BobArticlesPlugin(app, {});
  plugin.settings = { formatOnSave: true };
  plugin.articleUndoBlocked = new Set();
  plugin.articleFormatHistory = new Map();
  plugin.articleRunPlan = async () => {
    value = "## Fresh edit\n";
    return { ok: true, plan: articlePlan({ edits: [{ line: 1, delete: 1, insert: ["## 1. Draft"] }] }).notes[0] };
  };
  plugin.articleApplyInbound = async () => {};
  const view = { file, editor };
  assert.equal(await plugin.articleFormatView(view), false);
  assert.equal(dispatches, 0);
  assert.equal(value, "## Fresh edit\n");
});
