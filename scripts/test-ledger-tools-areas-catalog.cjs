const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
class TestPlugin { constructor(app) { this.app = app; } }
class StubWidgetType {}
const StubDecoration = { none: { none: true }, widget: (args) => ({ ...args, _widget: true }) };
class StubRangeSetBuilder { constructor() { this.ranges = []; } add(from, to, decoration) { this.ranges.push({ from, to, decoration }); } finish() { return this.ranges; } }
const StubStateEffect = { define() { const effect = { of: (value) => ({ effect, value }), is: (other) => other === effect }; return effect; } };
const originalLoad = Module._load;
Module._load = function loadAreasStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, PluginSettingTab: class {}, Setting: class {}, normalizePath: (value) => value, parseYaml: () => ({}),
    setIcon: (node, name) => { node.setAttribute("data-test-icon", name); },
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect: StubStateEffect, RangeSetBuilder: StubRangeSetBuilder };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } },
    keymap: { of: (value) => value },
    ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
    Decoration: StubDecoration, WidgetType: StubWidgetType,
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;

const {
  areasIndexReport,
  areasCardHost,
  areasCardRows,
  areasCardRowModel,
  areasCardHostHue,
  areasCardHealthModel,
  areasCardStatus,
  areasCardUnplacedModel,
  areasCardFoldKey,
  areasCardIsExpanded,
  areasCardTooltip,
  areasCardChips,
  areasPaintCallout,
  areasPaintStandalone,
  areasCleanCatalogDom,
} = LedgerToolsPlugin.helpers;
const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");

const issue = { path: "stray.md", code: "area_parent_missing", severity: "error", line: 2, message: "stray.md has no parent" };
const entries = [
  { path: "cash.md", stem: "cash", link: "cash", title: "Cash", titled: true, summary: "Money", parent: "area.md", parent_raw: "[[area]]", depth: 1, top: "cash", hue: "magenta", hue_source: "color", children: ["bank.md"], projects: { direct: 2, subtree: 3 }, today: { direct: 1, subtree: 1 }, issues: [] },
  { path: "bank.md", stem: "bank", link: "bank", title: "Bank", titled: false, summary: null, parent: "cash.md", parent_raw: "[[cash]]", depth: 2, top: "cash", hue: "blue", hue_source: "hash", children: [], projects: { direct: 1, subtree: 1 }, today: { direct: 0, subtree: 0 }, issues: [] },
  { path: "stray.md", stem: "stray", link: "stray", title: "Stray", titled: false, summary: null, parent: null, parent_raw: null, depth: null, top: null, hue: null, hue_source: null, children: [], projects: { direct: 0, subtree: 0 }, today: { direct: 0, subtree: 0 }, issues: [issue] },
];
const catalogs = [
  { host: "area", path: "area.md", kind: "root", state: "stale", rows: [{ path: "cash.md", link: "cash", depth: 0 }, { path: "bank.md", link: "bank", depth: 1 }], issues: [{ path: "area.md", code: "area_catalog_stale", severity: "warning", line: null, message: "catalog missing" }] },
  { host: "cash", path: "cash.md", kind: "area", state: "current", rows: [{ path: "bank.md", link: "bank", depth: 0 }], issues: [] },
];
function reportWith(nextCatalogs = catalogs, nextEntries = entries) {
  return areasIndexReport({ schema_version: 1, ok: false, command: "list", root: { path: "area.md", stem: "area", state: "found" }, areas: nextEntries, catalogs: nextCatalogs, findings: [issue], counts: { areas: nextEntries.length, top_level: 1, hosts: 2, errors: 1, warnings: 1, catalogs: { current: 1, missing: 0, stale: 1, damaged: 0 } } });
}
function state(report = reportWith(), overrides = {}) {
  return { report, stale: false, refreshing: false, error: null, errorModel: null, syncBusy: false, syncError: null, syncErrorModel: null, ...overrides };
}

class FakeNode {
  constructor(tag, doc, attrs = {}) {
    this.tagName = String(tag || "div").toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.childNodes = this.children;
    this.attrs = new Map(Object.entries(attrs));
    this.listeners = new Map();
    this._text = "";
    this.disabled = false;
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get classList() { return { contains: (value) => this.className.split(/\s+/).includes(value) }; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get nextSibling() { const list = this.parentNode?.children || []; return list[list.indexOf(this) + 1] || null; }
  get previousSibling() { const list = this.parentNode?.children || []; return list[list.indexOf(this) - 1] || null; }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(""); }
  set textContent(value) { this._text = String(value ?? ""); this.children.length = 0; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === "hidden") this.hidden = true; }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); if (name === "hidden") this.hidden = false; }
  appendChild(node) { if (!node) return node; node.remove?.(); node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) {
    if (!node) return node;
    node.remove?.();
    node.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
    return node;
  }
  removeChild(node) { const at = this.children.indexOf(node); if (at >= 0) this.children.splice(at, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild(this); }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  addEventListener(name, callback) { const rows = this.listeners.get(name) || []; rows.push(callback); this.listeners.set(name, rows); }
  click() { for (const callback of this.listeners.get("click") || []) callback({ preventDefault() {}, stopPropagation() {} }); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  matches(selector) { return matches(this, selector); }
  querySelectorAll(selector) {
    const selectors = String(selector).split(",").map((part) => part.trim());
    const found = [];
    const visit = (node) => { for (const child of node.children) { if (selectors.some((part) => matches(child, part))) found.push(child); visit(child); } };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matches(node, selector) {
  return String(selector || "").split(",").some((part) => matchesOne(node, part));
}

function matchesOne(node, selector) {
  const raw = String(selector || "").trim();
  if (raw.startsWith(".")) return node.className.split(/\s+/).includes(raw.slice(1));
  const attr = raw.match(/^\[([^\s=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/);
  if (attr) {
    const actual = node.getAttribute(attr[1]);
    const expected = attr[2] ?? attr[3] ?? attr[4];
    return expected === undefined ? actual !== null : actual === expected;
  }
  return node.tagName.toLowerCase() === raw.toLowerCase();
}

class FakeDocument {
  constructor() { this.activeElement = null; }
  createElement(tag) { return new FakeNode(tag, this); }
  createTextNode(text) { const node = new FakeNode("span", this); node.textContent = text; return node; }
}

function callout(doc, links = ["cash", "bank"]) {
  const host = new FakeNode("div", doc, { class: "callout", "data-callout": "areas" });
  const title = new FakeNode("div", doc, { class: "callout-title" });
  host.appendChild(title);
  const content = new FakeNode("div", doc, { class: "callout-content" });
  host.appendChild(content);
  const list = new FakeNode("ul", doc);
  content.appendChild(list);
  for (const target of links) {
    const li = new FakeNode("li", doc);
    const strong = new FakeNode("strong", doc);
    const link = new FakeNode("a", doc, { class: "internal-link", "data-href": target });
    link.textContent = target;
    strong.appendChild(link);
    li.appendChild(strong);
    list.appendChild(li);
  }
  return host;
}

function areaMetadata() {
  return { getFirstLinkpathDest(target) { return entries.some((entry) => entry.stem === target) ? { path: `${target}.md` } : null; } };
}

function rowItem(doc, target) {
  const li = new FakeNode("li", doc);
  const strong = new FakeNode("strong", doc);
  const link = new FakeNode("a", doc, { class: "internal-link", "data-href": target });
  link.textContent = target;
  strong.appendChild(link);
  li.appendChild(strong);
  return li;
}

function nestedCallout(doc) {
  const host = new FakeNode("div", doc, { class: "callout", "data-callout": "areas" });
  const title = new FakeNode("div", doc, { class: "callout-title" });
  host.appendChild(title);
  const content = new FakeNode("div", doc, { class: "callout-content" });
  host.appendChild(content);
  const list = new FakeNode("ul", doc);
  content.appendChild(list);
  const cash = rowItem(doc, "cash");
  const nested = new FakeNode("ul", doc);
  nested.appendChild(rowItem(doc, "bank"));
  cash.appendChild(nested);
  list.appendChild(cash);
  return host;
}

function rowByStem(root, stem) {
  return root.querySelectorAll("li").find((li) => li.querySelector("a")?.textContent === stem) || null;
}

test("Areas host, row, hue, health, status, and unplaced models follow Bob's report", () => {
  const current = state();
  assert.equal(areasCardHost(current, "area.md").kind, "root");
  assert.equal(areasCardHost(current, "plain.md"), null);
  assert.equal(areasCardHostHue(current, "area.md"), null, "root remains neutral");
  assert.equal(areasCardHostHue(current, "cash.md"), "magenta");
  assert.deepEqual(areasCardRows(current, "area.md").map((row) => [row.path, row.depth, row.hue]), [
    ["cash.md", 0, "magenta"], ["bank.md", 1, "blue"],
  ]);
  assert.equal(areasCardRowModel(entries[0]).titled, true);
  assert.equal(areasCardHealthModel(catalogs[0]).repairable, true);
  assert.equal(areasCardStatus(current, "area.md").action.kind, "sync");
  assert.equal(areasCardUnplacedModel(current, "area.md").count, 1);
  assert.match(areasCardUnplacedModel(current, "area.md").tooltip, /stray\.md has no parent/);
  assert.equal(areasCardStatus(state(current.report, { error: { code: "timeout" }, errorModel: { hint: "Retry report" } }), "area.md").action.kind, "retry");
  const damaged = reportWith([{ ...catalogs[0], state: "damaged", issues: [{ ...issue, path: "area.md", line: 9, message: "bad opener" }] }, catalogs[1]]);
  assert.equal(areasCardHealthModel(damaged.catalogsByHostPath.get("area.md")).repairable, false);
  assert.equal(areasCardStatus(state(damaged), "area.md").action, null);
});

test("Reading card paints reported hue dots, sync and root warning without editing Markdown", () => {
  const doc = new FakeDocument();
  const host = callout(doc);
  const originalRows = host.querySelectorAll("li").length;
  let syncs = 0;
  const options = { state: state(), sourcePath: "area.md", metadataCache: areaMetadata(), vault: null, handlers: { sync: () => { syncs += 1; } } };
  assert.equal(areasPaintCallout(host, options), true);
  assert.equal(host.getAttribute("data-bob-areas-card"), "true");
  assert.equal(host.getAttribute("data-root-hue"), null);
  assert.equal(host.querySelectorAll(".bob-areas-dot").length, 2);
  assert.equal(host.querySelectorAll(".bob-areas-dot")[0].getAttribute("data-hue"), "magenta");
  assert.equal(host.querySelectorAll(".bob-areas-dot")[1].getAttribute("data-hue"), "blue");
  assert.match(host.querySelector(".bob-areas-header").textContent, /2 areas/);
  assert.equal(host.querySelector(".bob-areas-icon").getAttribute("data-test-icon"), "layers");
  assert.equal(host.querySelector(".bob-areas-icon").getAttribute("aria-hidden"), "true");
  assert.match(host.querySelector(".bob-areas-unplaced").getAttribute("title"), /stray\.md/);
  assert.equal(host.querySelector(".bob-areas-action").textContent, "↻ sync");
  assert.equal(syncs, 0, "painting does not write catalogs");
  host.querySelector(".bob-areas-action").click();
  assert.equal(syncs, 1, "only the explicit button starts sync");
  assert.equal(host.querySelectorAll("li").length, originalRows);

  areasCleanCatalogDom(host);
  assert.equal(host.getAttribute("data-bob-areas-card"), null);
  assert.equal(host.querySelectorAll(".bob-areas-dot").length, 0);
});

test("standalone cards show report rows; non-host and unavailable notes get no phantom card", () => {
  const doc = new FakeDocument();
  const host = doc.createElement("div");
  const options = { state: state(), sourcePath: "area.md", metadataCache: areaMetadata(), vault: null, handlers: {} };
  assert.equal(areasPaintStandalone(host, options), true);
  assert.equal(host.querySelectorAll("li").length, 2);
  assert.equal(host.querySelectorAll("ul").length, 2, "nested report depth creates one child list");
  assert.match(host.textContent, /cash/);
  assert.match(host.textContent, /Money/);

  const authored = callout(doc, ["cash"]);
  assert.equal(areasPaintCallout(authored, { ...options, sourcePath: "plain.md" }), false);
  assert.equal(authored.getAttribute("data-bob-areas-card"), null);
  assert.equal(authored.querySelectorAll(".bob-areas-dot").length, 0);
  assert.equal(areasPaintStandalone(doc.createElement("div"), { ...options, sourcePath: "plain.md" }), false);
  assert.equal(areasPaintStandalone(doc.createElement("div"), { ...options, state: { report: null }, sourcePath: "area.md" }), false);
});

test("standalone row nodes stay stable until rows, folds, or source path change", () => {
  const doc = new FakeDocument();
  const host = doc.createElement("div");
  const folds = new Map();
  const options = { state: state(), sourcePath: "area.md", folds, metadataCache: areaMetadata(), handlers: {} };
  areasPaintStandalone(host, options);
  const first = host.querySelectorAll("a")[0];
  assert.ok(first.classList.contains("internal-link"));
  assert.equal(first.getAttribute("href"), "cash");
  areasPaintStandalone(host, options);
  assert.equal(host.querySelectorAll("a")[0], first, "unchanged row links retain identity");
  folds.set(areasCardFoldKey("area.md", "cash.md"), false);
  areasPaintStandalone(host, options);
  const folded = host.querySelectorAll("a")[0];
  assert.notEqual(folded, first, "fold changes rebuild the list");
  const changedEntries = entries.map((entry) => entry.path === "cash.md" ? { ...entry, summary: "Changed" } : entry);
  areasPaintStandalone(host, { ...options, state: state(reportWith(catalogs, changedEntries)) });
  assert.notEqual(host.querySelectorAll("a")[0], folded, "report changes rebuild the list");
});

test("standalone area links open their target and request hover previews", () => {
  const opened = [];
  const previews = [];
  const plugin = new LedgerToolsPlugin({ workspace: {
    openLinkText: (...args) => { opened.push(args); },
    trigger: (name, detail) => previews.push([name, detail]),
  } });
  plugin.areasCatalogActive = true;
  plugin.areasCatalogState = () => state();
  plugin.areasCatalogFoldByView = new WeakMap();
  const doc = new FakeDocument();
  const host = doc.createElement("div");
  areasPaintStandalone(host, plugin.areasCatalogOptions("area.md", new Map(), state()));
  const link = host.querySelectorAll("a")[0];
  assert.ok(link.classList.contains("internal-link"));
  assert.equal(link.getAttribute("href"), "cash");
  link.click();
  assert.deepEqual(opened[0], ["cash", "area.md", false]);
  link.listeners.get("mouseover")[0]({ type: "mouseover" });
  assert.equal(previews[0][0], "hover-link");
  assert.equal(previews[0][1].linktext, "cash");
});

test("Areas renderer registers in Reading and Live Preview at the family priority", () => {
  const doc = new FakeDocument();
  const current = state();
  const plugin = new LedgerToolsPlugin({}, {});
  plugin.areasCatalogActive = false;
  plugin.areasCatalogState = () => current;
  plugin.areasReportState = () => current;
  plugin.apiAreasSubscribe = (callback) => { callback(current); return () => {}; };
  plugin.areasSetTimeout = () => 1;
  plugin.areasClearTimeout = () => {};
  plugin.notebookCatalogLivePath = (view) => view.path;
  plugin.registerMarkdownPostProcessor = (handler, priority) => { plugin.postProcessor = handler; plugin.postProcessorPriority = priority; };
  plugin.registerEditorExtension = (extension) => { plugin.areasExtension = extension; };
  plugin.setupAreasCatalog();
  assert.equal(plugin.postProcessorPriority, 52);
  assert.ok(plugin.areasExtension);

  const markdown = callout(doc);
  plugin.postProcessor(markdown, { sourcePath: "area.md", getSectionInfo: () => null });
  assert.equal(markdown.getAttribute("data-bob-areas-card"), "true");
  const noSection = doc.createElement("div");
  const noSectionHeading = new FakeNode("h2", doc);
  noSectionHeading.textContent = "Areas";
  noSection.appendChild(noSectionHeading);
  plugin.postProcessor(noSection, { sourcePath: "area.md", getSectionInfo: () => null });
  assert.equal(noSection.querySelector(".bob-areas-anchor"), null, "null section info cannot create an anchor");
  const noteCallout = doc.createElement("div");
  const calloutHeading = new FakeNode("h2", doc);
  calloutHeading.textContent = "Areas";
  noteCallout.appendChild(calloutHeading);
  plugin.postProcessor(noteCallout, { sourcePath: "area.md", getSectionInfo: () => ({
    text: "## Areas\n\n> [!areas]", lineStart: 0, lineEnd: 2,
  }) });
  assert.equal(noteCallout.querySelector(".bob-areas-anchor"), null, "a stored note callout suppresses duplicate standalone cards");
  const headingHost = doc.createElement("div");
  const areasHeading = new FakeNode("h2", doc);
  areasHeading.textContent = "Areas";
  headingHost.appendChild(areasHeading);
  plugin.postProcessor(headingHost, { sourcePath: "area.md", getSectionInfo: () => ({
    text: "# Root\n## Areas", lineStart: 1, lineEnd: 1,
  }) });
  assert.ok(headingHost.querySelector(".bob-areas-anchor"), "a host without a callout gets one anchor in its heading section");
  for (const cls of ["callout", "markdown-embed", "hover-popover", "plugin-tasks-list-item", "tasks-list-text", "block-language-tasks", "dataview", "block-language-dataview", "block-language-dataviewjs"]) {
    const wrapper = new FakeNode("div", doc, { class: cls });
    const child = doc.createElement("div");
    const heading = new FakeNode("h2", doc);
    heading.textContent = "Areas";
    child.appendChild(heading);
    wrapper.appendChild(child);
    plugin.postProcessor(child, { sourcePath: "area.md", getSectionInfo: () => ({ text: "## Areas", lineStart: 0, lineEnd: 0 }) });
    assert.equal(child.querySelector(".bob-areas-anchor"), null, `${cls} never gets a standalone anchor`);
  }
  const refreshHost = doc.createElement("div");
  const refreshHeading = new FakeNode("h2", doc);
  refreshHeading.textContent = "Areas";
  refreshHost.appendChild(refreshHeading);
  plugin.postProcessor(refreshHost, { sourcePath: "area.md", getSectionInfo: () => ({ text: "## Areas", lineStart: 0, lineEnd: 0 }) });
  assert.ok(refreshHost.querySelector(".bob-areas-anchor"));
  const refreshWrapper = new FakeNode("div", doc, { class: "tasks-list-text" });
  refreshWrapper.appendChild(refreshHost);
  let refresh = null;
  plugin.areasSetTimeout = (callback) => { refresh = callback; return 5; };
  plugin.areasClearTimeout = () => {};
  plugin.areasCatalogRefreshTimer = null;
  plugin.scheduleAreasCatalogRefresh();
  refresh();
  assert.equal(refreshHost.querySelector(".bob-areas-anchor"), null, "refresh removes an anchor from a now-excluded widget");
  const source = "## Areas\n\nA readable outline";
  const lines = source.split("\n");
  const view = { path: "area.md", dom: doc.createElement("div"), state: { doc: { lines: lines.length, toString: () => source, line: (number) => ({ to: lines.slice(0, number - 1).reduce((n, line) => n + line.length + 1, 0) + lines[number - 1].length }) } }, dispatch() {} };
  const decoration = plugin.buildAreasCatalogDecorations(view);
  assert.equal(decoration.length, 1, "Live Preview gets one standalone widget when stored callout is missing");
  assert.equal(plugin.buildAreasCatalogDecorations({ ...view, path: "plain.md" }).none, true, "non-hosts get no phantom decoration");
  plugin.teardownAreasCatalog();
});

test("workspace scroll guard resets forbidden containers and logs once per window", () => {
  const mainDoc = new FakeDocument();
  mainDoc.querySelector = () => null;
  const popoutDoc = new FakeDocument();
  popoutDoc.querySelector = () => null;
  let windowOpen;
  const previousDocument = global.document;
  const previousWarn = console.warn;
  const previousNow = Date.now;
  const warnings = [];
  const registrations = [];
  global.document = mainDoc;
  Date.now = () => 10000;
  console.warn = (...args) => warnings.push(args);
  try {
    const plugin = new LedgerToolsPlugin({ workspace: {
      activeLeaf: { view: { file: { path: "area.md" } } },
      on: (_event, callback) => { windowOpen = callback; return {}; },
    } });
    plugin.registerEvent = () => {};
    plugin.registerDomEvent = (target, type, handler, options) => registrations.push({ target, type, handler, options });
    plugin.setupWorkspaceScrollGuard();
    assert.equal(registrations[0].target, mainDoc);
    assert.equal(registrations[0].type, "scroll");
    assert.equal(registrations[0].options.capture, true);
    windowOpen({ document: popoutDoc });
    const mainScroll = registrations[0].handler;
    const popoutScroll = registrations[1].handler;
    const workspace = new FakeNode("div", mainDoc, { class: "workspace" });
    workspace.scrollTop = 14;
    workspace.scrollLeft = 3;
    mainScroll({ target: workspace });
    assert.equal(workspace.scrollTop, 0);
    assert.equal(workspace.scrollLeft, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /unexpected workspace scroll/);
    assert.equal(warnings[0][1].activePath, "area.md");
    workspace.scrollTop = 5;
    mainScroll({ target: workspace });
    assert.equal(workspace.scrollTop, 0);
    assert.equal(warnings.length, 1, "repeat warnings are rate-limited per document");
    for (const cls of ["view-content", "cm-scroller"]) {
      const allowed = new FakeNode("div", mainDoc, { class: cls });
      allowed.scrollTop = 7;
      mainScroll({ target: allowed });
      assert.equal(allowed.scrollTop, 7, `${cls} remains scrollable`);
    }
    const popoutWorkspace = new FakeNode("div", popoutDoc, { class: "workspace" });
    popoutWorkspace.scrollLeft = 9;
    popoutScroll({ target: popoutWorkspace });
    assert.equal(popoutWorkspace.scrollLeft, 0);
    assert.equal(warnings.length, 2, "each window can report its first reset");
  } finally {
    global.document = previousDocument;
    console.warn = previousWarn;
    Date.now = previousNow;
  }
});

test("fold helpers default expanded and key by pane host plus row", () => {
  const folds = new Map();
  assert.equal(areasCardIsExpanded(folds, "area.md", "cash.md"), true);
  folds.set(areasCardFoldKey("area.md", "cash.md"), false);
  assert.equal(areasCardIsExpanded(folds, "area.md", "cash.md"), false);
  assert.equal(areasCardIsExpanded(folds, "area.md", "bank.md"), true);
  assert.equal(areasCardIsExpanded(folds, "love.md", "cash.md"), true);
});

test("chips follow fold state and hide zeros; tooltips keep stems visible", () => {
  const cash = areasCardRowModel(entries[0]);
  assert.equal(cash.stem, "cash");
  assert.equal(cash.addSummary, false);
  assert.deepEqual(areasCardChips(cash, true).map((chip) => chip.kind), ["projects", "today"]);
  assert.equal(areasCardChips(cash, true)[0].text, "2 projects");
  assert.equal(areasCardChips(cash, false)[0].text, "3 projects");
  const quiet = areasCardRowModel({
    ...entries[1],
    projects: { direct: 0, subtree: 4 },
    today: { direct: 0, subtree: 2 },
  });
  assert.deepEqual(areasCardChips(quiet, true), []);
  assert.deepEqual(areasCardChips(quiet, false).map((chip) => [chip.kind, chip.text, chip.compact]), [
    ["projects", "4 projects", "4"],
    ["today", "today", "2"],
  ]);
  const tooltip = areasCardTooltip(cash);
  assert.match(tooltip, /^Cash\n@cash\n2 projects · 1 task today\n3 projects · 1 task today in this branch$/);
  assert.equal(areasCardRowModel(entries[1]).addSummary, true);
});

test("nested rows fold per map, switch chips, and keep stored stem link text", () => {
  const doc = new FakeDocument();
  const host = nestedCallout(doc);
  const folds = new Map();
  const options = {
    state: state(),
    sourcePath: "area.md",
    metadataCache: areaMetadata(),
    vault: null,
    folds,
    handlers: {
      toggleFold: (rowPath, expanded) => {
        folds.set(areasCardFoldKey("area.md", rowPath), expanded);
        areasPaintCallout(host, options);
      },
    },
  };
  assert.equal(areasPaintCallout(host, options), true);
  const cash = rowByStem(host, "cash");
  const bank = rowByStem(host, "bank");
  assert.equal(cash.querySelector("a").textContent, "cash");
  assert.equal(cash.getAttribute("data-folded"), null);
  assert.equal(cash.querySelector(".bob-areas-toggle").textContent, "▾");
  assert.equal(cash.querySelector(".bob-areas-toggle").getAttribute("aria-expanded"), "true");
  assert.match(cash.querySelector(".bob-areas-chip-projects").querySelector(".bob-areas-chip-full").textContent, /2 projects/);
  assert.match(cash.querySelector(".bob-areas-chip-today").querySelector(".bob-areas-chip-full").textContent, /today/);
  assert.match(cash.querySelector(".bob-areas-dot").getAttribute("title"), /@cash/);
  assert.match(cash.querySelector(".bob-areas-chip-projects").getAttribute("title"), /Cash/);
  assert.equal(bank.querySelector(".bob-areas-toggle"), null);
  assert.match(bank.querySelector(".bob-areas-chip-projects").querySelector(".bob-areas-chip-full").textContent, /1 project/);
  assert.equal(bank.querySelector(".bob-areas-add-summary")?.textContent, "add summary");
  assert.equal(cash.children.some((node) => (node.className || "").split(/\s+/).includes("bob-areas-add-summary")), false);

  cash.querySelector(".bob-areas-toggle").click();
  const folded = rowByStem(host, "cash");
  assert.equal(folded.getAttribute("data-folded"), "true");
  assert.equal(folded.querySelector(".bob-areas-toggle").textContent, "▸");
  assert.equal(folded.querySelector(".bob-areas-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(areasNestedHidden(folded), true);
  assert.match(folded.querySelector(".bob-areas-chip-projects").querySelector(".bob-areas-chip-full").textContent, /3 projects/);
});

function areasNestedHidden(li) {
  const nested = li.children.find((node) => node.tagName === "UL");
  return Boolean(nested && nested.getAttribute("hidden"));
}

test("add-summary is hover-only in CSS and opens the notebooks summary path", () => {
  assert.match(css, /li:hover > \.bob-areas-add-summary/);
  assert.match(css, /li:focus-within > \.bob-areas-add-summary/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@container bob-areas \(max-width: 440px\)/);
  assert.match(css, /\.bob-areas-chip-compact \{ display: inline-flex; \}/);
  const doc = new FakeDocument();
  const host = nestedCallout(doc);
  const opened = [];
  const options = {
    state: state(),
    sourcePath: "area.md",
    metadataCache: areaMetadata(),
    vault: null,
    folds: new Map(),
    handlers: { openSummary: (model) => opened.push(model.path) },
  };
  areasPaintCallout(host, options);
  const add = rowByStem(host, "bank").querySelector(".bob-areas-add-summary");
  assert.equal(add.textContent, "add summary");
  add.click();
  assert.deepEqual(opened, ["bank.md"]);
});

test("two panes keep independent folds across a repaint", () => {
  const current = state();
  const plugin = new LedgerToolsPlugin({}, {});
  plugin.areasCatalogActive = false;
  plugin.areasCatalogState = () => current;
  plugin.areasReportState = () => current;
  plugin.apiAreasSubscribe = () => () => {};
  plugin.areasSetTimeout = (callback) => { callback(); return 1; };
  plugin.areasClearTimeout = () => {};
  plugin.registerMarkdownPostProcessor = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.setupAreasCatalog();
  const first = nestedCallout(new FakeDocument());
  const second = nestedCallout(new FakeDocument());
  const left = plugin.areasCatalogFoldMap(first);
  const right = plugin.areasCatalogFoldMap(second);
  plugin.areasCatalogReading.add({ el: first, path: "area.md", folds: left, allowAnchor: false });
  plugin.areasCatalogReading.add({ el: second, path: "area.md", folds: right, allowAnchor: false });
  plugin.areasPaintReading(first, "area.md", left, false);
  plugin.areasPaintReading(second, "area.md", right, false);
  plugin.areasCatalogHandlers("area.md", left).toggleFold("cash.md", false);
  assert.equal(rowByStem(first, "cash").getAttribute("data-folded"), "true");
  assert.equal(rowByStem(second, "cash").getAttribute("data-folded"), null);
  plugin.areasPaintReading(first, "area.md", left, false);
  assert.equal(rowByStem(first, "cash").getAttribute("data-folded"), "true");
  plugin.teardownAreasCatalog();
});

test("fragment renders never paint standalone areas chrome", () => {
  const fragment = "Embedded paragraph. ^area-task";
  const section = () => ({ text: fragment, lineStart: 0, lineEnd: 0 });
  const makePlugin = (withCache) => {
    const doc = new FakeDocument();
    const current = state();
    const plugin = new LedgerToolsPlugin({}, {});
    plugin.areasCatalogActive = false;
    plugin.areasCatalogState = () => current;
    plugin.areasReportState = () => current;
    plugin.apiAreasSubscribe = () => () => {};
    plugin.areasSetTimeout = () => 1;
    plugin.areasClearTimeout = () => {};
    plugin.notebookCatalogLivePath = (view) => view.path;
    plugin.registerMarkdownPostProcessor = (handler) => { plugin.postProcessor = handler; };
    plugin.registerEditorExtension = () => {};
    plugin.app = plugin.app || {};
    plugin.app.metadataCache = withCache || {};
    plugin.setupAreasCatalog();
    return { doc, plugin };
  };
  for (const cls of ["markdown-embed", "hover-popover"]) {
    const { doc, plugin } = makePlugin({});
    const root = doc.createElement("div");
    const container = doc.createElement("div");
    const wrapper = new FakeNode("div", doc, { class: cls });
    wrapper.appendChild(container);
    plugin.postProcessor(root, { sourcePath: "cash.md", containerEl: container, getSectionInfo: section });
    assert.equal(root.querySelector(".bob-areas-anchor"), null, `${cls} fragment paints no areas anchor`);
    plugin.teardownAreasCatalog();
  }
  {
    const { doc, plugin } = makePlugin({ getCache: (p) => p === "cash.md" ? { frontmatterPosition: { start: { line: 0 } } } : null });
    const root = doc.createElement("div");
    plugin.postProcessor(root, { sourcePath: "cash.md", getSectionInfo: section });
    assert.equal(root.querySelector(".bob-areas-anchor"), null, "frontmatter-mismatch fragment paints no areas anchor");
    plugin.teardownAreasCatalog();
  }
});
