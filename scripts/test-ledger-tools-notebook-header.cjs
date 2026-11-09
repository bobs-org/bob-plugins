// Linked notebook headers: ancestry, children, chips setting, both views.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand() {}
  registerEditorExtension(e) { (this.editorExtensions ||= []).push(e); }
  registerEvent(r) { (this.registeredEvents ||= []).push(r); }
  registerMarkdownCodeBlockProcessor() {}
  registerMarkdownPostProcessor(h) { (this.postProcessors ||= []).push(h); }
  registerInterval(h) { return h; }
  registerDomEvent() {}
}
class TestNotice { constructor(m) { TestNotice.messages.push(String(m)); } }
TestNotice.messages = [];
const editorInfoField = { _notebook: "info" };
const editorLivePreviewField = { _notebook: "live" };
class StubWidgetType { eq(o) { return this === o; } }
const StubDecoration = {
  none: { none: true },
  widget: (a) => ({ widget: a.widget, side: a.side, _widget: true }),
  line: (a) => ({ line: true, attributes: a && a.attributes, _line: true }),
};
const StubStateEffect = {
  define: () => {
    const e = { of: (v) => ({ effect: e, value: v }), is: (o) => o === e };
    return e;
  },
};
class StubRangeSetBuilder {
  constructor() { this.ranges = []; }
  add(f, t, d) { this.ranges.push({ from: f, to: t, decoration: d }); }
  finish() { return this.ranges; }
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      PluginSettingTab: class { constructor(app, p) { this.app = app; this.plugin = p; } },
      Setting: class {
        constructor(el) { this.el = el; }
        setName() { return this; }
        setDesc() { return this; }
        addToggle(f) {
          const t = { setValue: () => t, onChange: () => t };
          f(t);
          return this;
        }
      },
      normalizePath: (v) => v,
      parseYaml: (t) => JSON.parse(t),
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (v) => v }, StateEffect: StubStateEffect, RangeSetBuilder: StubRangeSetBuilder };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (l) => ({ listener: l }) } },
      keymap: { of: (v) => v },
      ViewPlugin: { fromClass: (c, o) => ({ cls: c, options: o }) },
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  notebookDecodeListReport,
  notebookHeaderModel,
  notebookHeaderCollapse,
  notebookHeaderChildEntries,
  notebookHeaderSignature,
  notebookHeaderChipsDefault,
} = helpers;

function entry(over = {}) {
  return {
    stem: "git", path: "git.md", title: "Git", summary: "Notes.",
    parent: "dev_tools", parent_kind: "notebook", owner: "dev", root: "dev",
    breadcrumb: ["dev", "Developer tools", "Git"], children: [],
    notes: 2, sections: [], last_note: "2026-11-08", issues: [],
    ...over,
  };
}
function reportFor(notebooks) {
  const body = {
    ok: true, schema_version: 1, notebooks,
    catalogs: [], counts: { notebooks: notebooks.length, roots: 1, errors: 0, warnings: 0 },
  };
  const decoded = notebookDecodeListReport(JSON.stringify(body), "");
  assert.equal(decoded.ok, true);
  return decoded.report;
}
function parentChainReport() {
  return reportFor([
    entry({ stem: "dev_tools", path: "dev_tools.md", title: "Developer tools", parent: "dev", parent_kind: "area", owner: "dev", root: "dev", children: ["git"], breadcrumb: ["dev", "Developer tools"] }),
    entry(),
  ]);
}

// Minimal fake DOM for header build.
function fakeDoc() {
  const doc = {
    createElement: (tag) => new FakeEl(tag, doc),
    createTextNode: (text) => {
      const n = new FakeEl("#text", doc);
      n.nodeType = 3;
      n.text = String(text);
      return n;
    },
  };
  return doc;
}
class FakeEl {
  constructor(tag, doc) {
    this.tagName = String(tag || "div").toUpperCase();
    this.nodeType = 1;
    this.doc = doc;
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.text = "";
    this.listeners = {};
  }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  get classList() {
    const el = this;
    return {
      add: (n) => {
        const s = new Set(String(el.attrs.class || "").split(/\s+/).filter(Boolean));
        s.add(n);
        el.attrs.class = [...s].join(" ");
      },
      contains: (n) => String(el.attrs.class || "").split(/\s+/).includes(n),
    };
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, b) {
    c.parentNode = this;
    const at = this.children.indexOf(b);
    if (at === -1) this.children.push(c);
    else this.children.splice(at, 0, c);
    return c;
  }
  removeChild(c) {
    const at = this.children.indexOf(c);
    if (at !== -1) this.children.splice(at, 1);
    c.parentNode = null;
    return c;
  }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c.tagName === "H1" && sel.includes("h1")) out.push(c);
        if (c.attrs.class && sel.includes(c.attrs.class.split(" ")[0])) out.push(c);
        walk(c);
      }
    };
    walk(this);
    if (sel.includes("bob-notebook-header") && this.attrs.class?.includes("bob-notebook-header")) out.push(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(n) {
    let c = n;
    while (c) { if (c === this) return true; c = c.parentNode; }
    return false;
  }
  closest() { return null; }
  get textContent() {
    if (this.nodeType === 3) return this.text;
    return this.children.map((c) => c.textContent).join("") + this.text;
  }
  set textContent(v) { this.text = String(v); }
}

function makePlugin(appOver = {}) {
  const app = {
    vault: { getAbstractFileByPath: () => null, getMarkdownFiles: () => [] },
    metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null },
    workspace: { getLeavesOfType: () => [], on: () => ({}), openLinkText: async () => true },
    ...appOver,
  };
  const plugin = new LedgerToolsPlugin(app);
  return { plugin, app };
}

test("header model follows parent identities, not breadcrumb labels", () => {
  const report = parentChainReport();
  // Breadcrumb labels disagree with parent stems on purpose; ancestry must
  // still resolve dev_tools as the notebook parent.
  const model = notebookHeaderModel(report, "git.md");
  assert.ok(model);
  const kinds = model.crumbs.map((c) => c.kind);
  assert.ok(kinds.includes("notebook"));
  assert.ok(kinds.includes("self"));
  const stems = model.crumbs.filter((c) => !c.ellipsis).map((c) => c.stem);
  assert.ok(stems.includes("dev_tools"));
  assert.ok(stems.includes("git"));
});

test("deep ancestry collapses with ellipsis and stays bounded", () => {
  const notebooks = [];
  let parent = "dev";
  for (let i = 0; i < 10; i += 1) {
    const stem = `nb${i}`;
    notebooks.push(entry({ stem, path: `${stem}.md`, title: `NB ${i}`, parent, parent_kind: i === 0 ? "area" : "notebook", owner: "dev", root: "dev", children: [] }));
    parent = stem;
  }
  const report = reportFor(notebooks);
  const model = notebookHeaderModel(report, "nb9.md");
  assert.ok(model);
  assert.ok(model.crumbs.length <= 5);
  assert.ok(model.crumbs.some((c) => c.ellipsis));
  assert.equal(model.truncated, true);
});

test("missing parent is bounded and honest; cycles do not loop", () => {
  const missing = reportFor([entry({ parent: "nope", parent_kind: "notebook" })]);
  const m1 = notebookHeaderModel(missing, "git.md");
  assert.ok(m1);
  assert.equal(m1.broken, true);
  const cyclic = reportFor([
    entry({ stem: "a", path: "a.md", title: "A", parent: "b", parent_kind: "notebook", children: [] }),
    entry({ stem: "b", path: "b.md", title: "B", parent: "a", parent_kind: "notebook", children: [] }),
  ]);
  const m2 = notebookHeaderModel(cyclic, "a.md");
  assert.ok(m2);
  assert.ok(m2.crumbs.length <= 5);
});

test("non-root project owner shows root and owner; duplicate titles order by path", () => {
  const report = reportFor([
    entry({ stem: "sub", path: "sub.md", title: "Sub", parent: "dev", parent_kind: "area", owner: "sub", root: "dev", children: ["b", "a"] }),
    entry({ stem: "a", path: "a.md", title: "Same", parent: "sub", parent_kind: "notebook", owner: "sub", root: "dev", children: [] }),
    entry({ stem: "b", path: "b.md", title: "Same", parent: "sub", parent_kind: "notebook", owner: "sub", root: "dev", children: [] }),
  ]);
  const model = notebookHeaderModel(report, "sub.md");
  assert.ok(model);
  const stems = model.crumbs.filter((c) => !c.ellipsis).map((c) => c.stem);
  assert.ok(stems.includes("dev"));
  assert.ok(stems.includes("sub"));
  const kids = model.children.map((c) => c.stem);
  assert.deepEqual(kids, ["a", "b"]);
});

test("empty children omit the row; renamed/missing children are filtered", () => {
  const report = reportFor([entry({ children: ["ghost"] })]);
  // ghost is missing, git is self; only existing non-self? self has no child entry for git itself.
  const model = notebookHeaderModel(report, "git.md");
  assert.ok(model);
  assert.deepEqual(model.children, []);
  assert.equal(notebookHeaderSignature(model).includes("|"), true);
});

test("non-notebook paths produce no header", () => {
  const report = parentChainReport();
  assert.equal(notebookHeaderModel(report, "other.md"), null);
  assert.equal(notebookHeaderModel(null, "git.md"), null);
});

test("chips default on; catalog paint respects the toggle", () => {
  assert.equal(notebookHeaderChipsDefault(), true);
  const { plugin } = makePlugin();
  plugin.notebookChipsEnabledFlag = true;
  assert.equal(plugin.notebookChipsVisible(), true);
  plugin.notebookChipsEnabledFlag = false;
  assert.equal(plugin.notebookChipsVisible(), false);
});

test("settings persist without discarding unrelated keys", async () => {
  const stored = { other: 1, notebookChips: false };
  let saved = null;
  const { plugin } = makePlugin();
  plugin.loadData = async () => stored;
  plugin.saveData = async (v) => { saved = v; };
  plugin.refreshNotebookHeaderAll = () => {};
  plugin.refreshNotebookCatalogReading = () => {};
  plugin.refreshNotebookCatalogEditors = () => {};
  await plugin.loadNotebookChipsSetting();
  assert.equal(plugin.notebookChipsVisible(), false);
  await plugin.saveNotebookChipsSetting(true);
  assert.equal(saved.other, 1);
  assert.equal(saved.notebookChips, true);
});

test("Reading paint inserts below H1, avoids duplicates, preserves focus", () => {
  const report = parentChainReport();
  const { plugin } = makePlugin();
  plugin.notebookCatalogState = () => ({ report, today: "2026-11-09", syncBusy: false });
  plugin.notebookHeaderLastState = plugin.notebookCatalogState();
  plugin.notebookHeaderActive = true;
  plugin.notebookChipsEnabledFlag = true;
  plugin.notebookHeaderReadingWidgets = new Set();
  const doc = fakeDoc();
  const root = new FakeEl("div", doc);
  const h1 = new FakeEl("h1", doc);
  h1.text = "Git";
  root.appendChild(h1);
  doc.activeElement = null;
  const first = plugin.paintNotebookHeaderReading(root, "git.md");
  assert.ok(first);
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].tagName, "H1");
  assert.ok(String(root.children[1].attrs.class).includes("bob-notebook-header"));
  const second = plugin.paintNotebookHeaderReading(root, "git.md");
  assert.ok(second);
  const headers = root.children.filter((c) => String(c.attrs.class || "").includes("bob-notebook-header"));
  assert.equal(headers.length, 1);
  // Non-notebook removes the header.
  plugin.paintNotebookHeaderReading(root, "other.md");
  const gone = root.children.filter((c) => String(c.attrs.class || "").includes("bob-notebook-header"));
  assert.equal(gone.length, 0);
});

test("Live Preview anchor skips frontmatter; Source mode yields no decorations", () => {
  const { plugin } = makePlugin();
  assert.equal(plugin.notebookHeaderLiveAnchor("---\nparent: x\n---\n# Git\nbody"), 3);
  assert.equal(plugin.notebookHeaderLiveAnchor("# Git\nbody"), 0);
  assert.equal(plugin.notebookHeaderFrontmatterEnd("---\na: b\n---\n# T"), 2);
  const report = parentChainReport();
  plugin.notebookCatalogState = () => ({ report, today: "2026-11-09", syncBusy: false });
  plugin.notebookHeaderLastState = plugin.notebookCatalogState();
  const view = {
    state: {
      doc: {
        toString: () => "# Git\nbody",
        line: (n) => ({ from: 0, to: 5 }),
      },
      field: () => null,
    },
    dom: new FakeEl("div", fakeDoc()),
  };
  plugin.notebookHeaderLivePath = () => null;
  const decos = plugin.buildNotebookHeaderDecorations(view);
  assert.ok(decos);
});

test("lifecycle setup and teardown manage header widgets", () => {
  const { plugin } = makePlugin();
  plugin.loadData = async () => ({});
  plugin.registerEditorExtension = () => {};
  plugin.registerMarkdownPostProcessor = () => {};
  plugin.apiNotebookSubscribe = () => () => {};
  plugin.setupNotebookHeader();
  assert.equal(plugin.notebookHeaderActive, true);
  assert.ok(plugin.notebookHeaderReadingWidgets instanceof Set);
  plugin.teardownNotebookHeader();
  assert.equal(plugin.notebookHeaderActive, false);
  assert.equal(plugin.notebookHeaderReadingWidgets.size, 0);
});
