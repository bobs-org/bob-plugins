const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
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
      notice: "Article formatted · 1 section numbered",
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

test("bob plan stdout decodes UTF-8 split across chunks", async () => {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const payload = Buffer.from(JSON.stringify(articlePlan({ notice: "Café 🍎" })), "utf8");
  const split = payload.indexOf(Buffer.from("é")) + 1;
  const resultPromise = helpers.articleSpawnBob("bob", [], "", "/vault", {
    timeout: 100,
    childProcess: {
      spawn() {
        queueMicrotask(() => {
          child.stdout.emit("data", payload.subarray(0, split));
          child.stdout.emit("data", payload.subarray(split));
          child.emit("close", 0);
        });
        return child;
      },
    },
  });
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.plan.notice, "Café 🍎");
});

test("early bob exit on stdin reports EPIPE as a run failure", async () => {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => queueMicrotask(() => child.stdin.emit("error", new Error("EPIPE")));
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const result = await helpers.articleSpawnBob("bob", [], "buffer", "/vault", {
    timeout: 100,
    childProcess: { spawn: () => child },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "stdin-error");
  assert.match(result.message, /EPIPE/);
});

test("line hunks become minimal cursor-preserving changes", () => {
  const source = "# 1. Start\n\n## Draft\nBody\n";
  const edits = [{ line: 3, delete: 1, insert: ["## 1.1 Draft"] }];
  const formatted = helpers.articleApplyEditsToText(source, edits);
  const changes = helpers.articleBuildChanges(source, edits);
  assert.equal(formatted, "# 1. Start\n\n## 1.1 Draft\nBody\n");
  assert.deepEqual(changes, [{ from: 15, to: 15, insert: "1.1 " }]);
  assert.equal(helpers.articleApplyChangesToText(source, changes), formatted);
  const cursor = source.indexOf("Body");
  const change = changes[0];
  const mappedCursor = cursor >= change.to
    ? cursor + change.insert.length - (change.to - change.from)
    : cursor;
  assert.equal(formatted.slice(mappedCursor, mappedCursor + 4), "Body");
});

test("insert, multi-line replace, and deletion hunks reproduce the formatted note", () => {
  const examples = [
    ["A\nB\nC\n", [{ line: 2, delete: 0, insert: ["X"] }]],
    ["A\nB\nC\n", [{ line: 2, delete: 2, insert: ["X", "Y", "Z"] }]],
    ["A\nB\nC", [{ line: 2, delete: 1, insert: [] }]],
    ["A\nB\nC", [{ line: 3, delete: 1, insert: [] }]],
    ["A\nB\nC\n", [{ line: 2, delete: 2, insert: [] }]],
    ["A\nB\nC\n", [{ line: 2, delete: 2, insert: ["X"] }]],
    ["A\nB\n", [{ line: 1, delete: 2, insert: [] }]],
    ["A\nB\nC\n\n\n", [{ line: 3, delete: 3, insert: [] }]],
    ["A\r\nB\r\nC\r\n", [{ line: 2, delete: 2, insert: [] }]],
    ["A\r\nB\r\n", [{ line: 1, delete: 2, insert: [] }]],
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

  let seed = 0x6d2b79f5;
  const random = (limit) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % limit;
  };
  for (let run = 0; run < 80; run += 1) {
    const count = 1 + random(7);
    const eol = random(2) ? "\n" : "\r\n";
    const lines = Array.from({ length: count }, (_, index) => `line-${run}-${index}`);
    const trailingNewline = random(2) === 1;
    const source = lines.join(eol) + (trailingNewline ? eol : "");
    const line = 1 + random(count + 1);
    const deleteCount = line <= count ? random(count - line + 2) : 0;
    const insertCount = random(4);
    const insert = Array.from({ length: insertCount }, (_, index) => `new-${run}-${index}`);
    const edits = [{ line, delete: deleteCount, insert }];
    assert.equal(
      helpers.articleApplyChangesToText(source, helpers.articleBuildChanges(source, edits)),
      helpers.articleApplyEditsToText(source, edits),
      `seeded edit ${run}: ${JSON.stringify(edits)} on ${JSON.stringify(source)}`,
    );
  }
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

test("leave formatting observes the undo guard before saving or reading", async () => {
  const file = { path: "article.md" };
  let saved = 0;
  let read = 0;
  const previousView = { save: async () => { saved += 1; } };
  const plugin = new BobArticlesPlugin({
    vault: {
      read: async () => { read += 1; return "text"; },
      process: async () => {},
    },
  }, {});
  plugin.settings = { formatOnLeave: true };
  plugin.articleUndoBlocked = new Set([file.path]);
  plugin.articleLeaveTimers = new Set();
  plugin.articleQueueLeave({ file, view: previousView });
  assert.equal(plugin.articleLeaveTimers.size, 0);
  await plugin.articleFormatSavedFile(file, previousView);
  assert.equal(saved, 0);
  assert.equal(read, 0);
});

test("Convert shows bob's refusal on every invocation", async () => {
  const notices = [];
  const file = { path: "plain.md" };
  const plugin = new BobArticlesPlugin({}, {});
  plugin.articleRunPlan = async () => ({
    ok: true,
    plan: {
      status: "skipped",
      reason: { code: "holds-anchor", message: "articles cannot be projects or refs" },
    },
  });
  plugin.articleShowNotice = (message) => notices.push(message);
  const view = { file, editor: { getValue: () => "text" } };
  await plugin.articleAdoptActive(view);
  await plugin.articleAdoptActive(view);
  assert.deepEqual(notices, [
    "articles cannot be projects or refs",
    "articles cannot be projects or refs",
  ]);
});

test("old bob's non-JSON article response gets one update notice per session", () => {
  const notices = [];
  const plugin = new BobArticlesPlugin({}, {});
  plugin.articleShowNotice = (message) => notices.push(message);
  plugin.articleReportRunFailure({ code: "bad-json" });
  plugin.articleReportRunFailure({ code: "bad-json" });
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Update bob/);
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

const LOOK_TEXT = "# 1. Start\n\n## 1.1 Draft\nBody\n";
const LOOK_OUTLINE = {
  numbering: true,
  sections: [
    { line: 1, end_line: 2, written: "1.", number: "1.", stale: false, title: "Start", output_line: 1 },
    { line: 3, end_line: 4, written: "1.1", number: "1.2", stale: true, title: "Draft", output_line: 3 },
  ],
};

test("decoration ranges mark written section numbers from the outline", () => {
  const ranges = helpers.articleSecnoDecorationRanges(LOOK_TEXT, LOOK_OUTLINE);
  assert.deepEqual(ranges.map((range) => ({
    from: range.from,
    to: range.to,
    token: range.token,
    stale: range.stale,
    titleAttr: range.titleAttr,
  })), [
    { from: 2, to: 4, token: "1.", stale: false, titleAttr: "" },
    { from: 15, to: 18, token: "1.1", stale: true, titleAttr: "Becomes 1.2 on save" },
  ]);
  const mapped = helpers.articleMapDecorationRanges(ranges, { mapPos: (pos) => pos + 3 });
  assert.equal(mapped[0].from, 5);
  assert.equal(mapped[0].to, 7);
  assert.deepEqual(helpers.articleSecnoDecorationRanges(LOOK_TEXT, { sections: [] }), []);
  assert.equal(
    helpers.articleSecnoDecorationRanges(LOOK_TEXT, LOOK_OUTLINE, { savesBlocked: true })[1].titleAttr,
    "",
  );
});

test("a new outline rerenders each open Reading view once for that generation", () => {
  let previewRenders = 0;
  let otherRenders = 0;
  const preview = {
    file: { path: "article.md" },
    getMode: () => "preview",
    previewMode: { rerender() { previewRenders += 1; } },
  };
  const source = {
    file: { path: "article.md" },
    getMode: () => "source",
    previewMode: { rerender() { otherRenders += 1; } },
  };
  const other = {
    file: { path: "other.md" },
    getMode: () => "preview",
    previewMode: { rerender() { otherRenders += 1; } },
  };
  const plugin = new BobArticlesPlugin({
    workspace: { getLeavesOfType: () => [{ view: preview }, { view: source }, { view: other }] },
  }, {});
  plugin.articleRefreshSecnoViews = () => {};
  plugin.articleRememberPlan("article.md", { outline: { sections: [] } });
  plugin.articleRefreshReadingViews("article.md");
  assert.equal(previewRenders, 1);
  assert.equal(otherRenders, 0);
  plugin.articleRememberPlan("article.md", { outline: { sections: [{ line: 1 }] } });
  assert.equal(previewRenders, 2);
});

test("section at a given line uses the innermost outline range", () => {
  assert.equal(helpers.articleSectionAtLine(LOOK_OUTLINE, 1).title, "Start");
  assert.equal(helpers.articleSectionAtLine(LOOK_OUTLINE, 2).title, "Start");
  assert.equal(helpers.articleSectionAtLine(LOOK_OUTLINE, 3).title, "Draft");
  assert.equal(helpers.articleSectionAtLine(LOOK_OUTLINE, 4).title, "Draft");
  assert.equal(helpers.articleSectionAtLine(LOOK_OUTLINE, 0), null);
  const nested = {
    numbering: true,
    sections: [
      { line: 1, end_line: 10, number: "1.", title: "Outer" },
      { line: 4, end_line: 7, number: "1.1", title: "Inner" },
    ],
  };
  assert.equal(helpers.articleSectionAtLine(nested, 5).title, "Inner");
  assert.equal(helpers.articleSectionAtLine(nested, 9).title, "Outer");
  assert.deepEqual(helpers.articleStatusBarModel(LOOK_OUTLINE, 3), {
    text: "§ 1.2",
    title: "Draft",
  });
  assert.deepEqual(helpers.articleStatusBarModel(LOOK_OUTLINE, 1), {
    text: "§ 1",
    title: "Start",
  });
  assert.equal(helpers.articleStatusBarModel({ numbering: false, sections: LOOK_OUTLINE.sections }, 3), null);
  assert.equal(helpers.articleStatusBarModel({ numbering: true, sections: [{ line: 8, end_line: 12, number: "1.", title: "Later" }] }, 2), null);
});

test("stale-hint debounce and in-flight state machine", () => {
  const state = helpers.articleCreateLookState();
  const edit = helpers.articleNoteStaleHintEdit(state, "a.md");
  assert.equal(edit.action, "schedule");
  assert.equal(edit.delay, helpers.ARTICLE_STALE_HINT_MS);
  assert.equal(edit.version, 1);

  const composing = helpers.articleNoteStaleHintTimer(state, "a.md", {
    composing: true,
    desktop: true,
    enabled: true,
  });
  assert.equal(composing.action, "schedule");

  const spawn = helpers.articleNoteStaleHintTimer(state, "a.md", { desktop: true, enabled: true });
  assert.equal(spawn.action, "spawn");
  assert.equal(spawn.version, 1);
  assert.equal(helpers.articleNoteStaleHintTimer(state, "a.md", { desktop: true, enabled: true }).action, "wait");

  helpers.articleNoteStaleHintEdit(state, "a.md");
  const dropped = helpers.articleNoteStaleHintResult(state, "a.md", 1);
  assert.equal(dropped.accept, false);
  assert.equal(dropped.reschedule, true);

  const spawn2 = helpers.articleNoteStaleHintTimer(state, "a.md", { desktop: true, enabled: true });
  assert.equal(spawn2.action, "spawn");
  assert.equal(spawn2.version, 2);
  const accepted = helpers.articleNoteStaleHintResult(state, "a.md", 2);
  assert.equal(accepted.accept, true);
  assert.equal(accepted.reschedule, false);

  const mobile = helpers.articleCreateLookState();
  helpers.articleNoteStaleHintEdit(mobile, "a.md");
  assert.equal(helpers.articleNoteStaleHintTimer(mobile, "a.md", { desktop: false, enabled: true }).action, "idle");
  const disabled = helpers.articleCreateLookState();
  helpers.articleNoteStaleHintEdit(disabled, "a.md");
  assert.equal(helpers.articleNoteStaleHintTimer(disabled, "a.md", { desktop: true, enabled: false }).action, "idle");
});

test("reading-view wrapping puts the leading number token in span.bob-secno", () => {
  assert.deepEqual(
    helpers.articleWrappedHeadingChildren("1. The Abstractions", {
      written: "1.",
      number: "1.",
      stale: false,
    }),
    [
      { type: "span", className: "bob-secno", title: "", value: "1." },
      { type: "text", value: " The Abstractions" },
    ],
  );
  assert.deepEqual(
    helpers.articleWrappedHeadingChildren("1.2 Draft", {
      written: "1.2",
      number: "1.3",
      stale: true,
    }),
    [
      { type: "span", className: "bob-secno is-stale", title: "Becomes 1.3 on save", value: "1.2" },
      { type: "text", value: " Draft" },
    ],
  );
  assert.equal(
    helpers.articleHeadingWrapSpec("1.2 Draft", {
      written: "1.2", number: "1.3", stale: true,
    }, { savesBlocked: true }).title,
    "",
  );
  assert.equal(helpers.articleHeadingWrapSpec("No number", { written: "1." }), null);

  const textNode = { nodeType: 3, nodeName: "#text", nodeValue: "1. Title", parentNode: null };
  const heading = {
    childNodes: [textNode],
    querySelector(selector) {
      return selector === ".bob-secno"
        ? this.childNodes.find((node) => node.className && String(node.className).includes("bob-secno")) || null
        : null;
    },
    insertBefore(node, ref) {
      const index = this.childNodes.indexOf(ref);
      this.childNodes.splice(index, 0, node);
      node.parentNode = this;
    },
    removeChild(node) {
      this.childNodes.splice(this.childNodes.indexOf(node), 1);
    },
  };
  textNode.parentNode = heading;
  const documentRef = {
    createElement() {
      return {
        className: "",
        title: "",
        childNodes: [],
        setAttribute(name, value) { this[name] = value; },
        appendChild(node) { this.childNodes.push(node); this.textContent = node.nodeValue; },
      };
    },
    createTextNode(value) {
      return { nodeType: 3, nodeName: "#text", nodeValue: value };
    },
  };
  assert.equal(
    helpers.articleWrapHeadingElement(heading, { written: "1.", number: "1.1", stale: true }, documentRef),
    true,
  );
  assert.equal(heading.childNodes[0].className, "bob-secno is-stale");
  assert.equal(heading.childNodes[0].title, "Becomes 1.1 on save");
  assert.equal(heading.childNodes[1].nodeValue, " Title");
  assert.equal(helpers.articleWrapHeadingElement(heading, { written: "1.", stale: true }, documentRef), false);
});

test("applied plans remap outline lines onto the formatted buffer", () => {
  const remapped = helpers.articleOutlineForCurrentBuffer({
    numbering: true,
    sections: [{ line: 4, output_line: 6, written: "3.", number: "1.2", stale: true, title: "Draft" }],
  }, true);
  assert.deepEqual(remapped.sections[0], {
    line: 6,
    output_line: 6,
    written: "1.2",
    number: "1.2",
    stale: false,
    title: "Draft",
  });
});

test("article styles scope the reading look under .bob-article", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-articles/styles.css"),
    "utf8",
  );
  assert.match(css, /\.bob-article\s*\{/);
  assert.match(css, /--file-line-width:\s*40rem/);
  assert.match(css, /--line-height-normal:\s*1\.65/);
  assert.match(css, /bob-article-serif/);
  assert.match(css, /ui-serif/);
  assert.match(css, /\.bob-secno/);
  assert.match(css, /tabular-nums/);
  assert.match(css, /is-stale/);
  assert.match(css, /@container/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /\.bob-article \.markdown-preview-view,\s*\.bob-article \.markdown-preview-sizer/);
  assert.match(css, /\.HyperMD-header-1\s*\{[^}]*padding-block-start/s);
  assert.doesNotMatch(css, /\.HyperMD-header-1\s*\{[^}]*margin-block/s);
});

test("look settings default to serif typeface and stale-number hints", () => {
  assert.deepEqual(helpers.articleDefaultSettings(), {
    formatOnSave: true,
    formatOnLeave: true,
    bobPath: "",
    articleTypeface: "serif",
    staleNumberHints: true,
  });
});
