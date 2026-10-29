// Root-field place marks across the shared model, Live Preview, rendered
// tasks, the toggle, and restoration. The bob-cli root-field contract is
// authoritative; the plugin resolves against its shared home-chip mirror.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { rootMark: "info" };
const editorLivePreviewField = { rootMark: "live" };
class WidgetType {}
class RangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const Decoration = { none: { none: true }, replace: (spec) => ({ replace: true, ...spec }) };
const StateEffect = { define: () => { const type = {}; type.of = (value) => ({ value, is: (other) => other === type }); return type; } };
const ViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
const syntaxTree = () => ({ resolveInner: () => null });

class PluginStub {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); }
}
class NoticeStub { constructor(message) { NoticeStub.messages.push(String(message)); } }
NoticeStub.messages = [];

const entryPath = require.resolve("../plugins/bob-ledger-tools/main.js");
function loadPlugin() {
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === "obsidian") return { Notice: NoticeStub, Plugin: PluginStub, normalizePath: (value) => value, editorInfoField, editorLivePreviewField };
    if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
    if (request === "@codemirror/view") return { ViewPlugin, Decoration, WidgetType, EditorView: { updateListener: { of: (fn) => fn } }, keymap: { of: (value) => value } };
    if (request === "@codemirror/language") return { syntaxTree };
    return originalLoad.call(this, request, ...args);
  };
  try { delete require.cache[entryPath]; return require(entryPath); }
  finally { Module._load = originalLoad; }
}
const LedgerToolsPlugin = loadPlugin();
const H = LedgerToolsPlugin.helpers;

function makeVault() {
  const frontmatter = {
    "gtd.md": { type: "[[area]]", color: "orange" },
    "gtd_daily.md": { type: "[[area]]", parent: "[[gtd]]" },
    "dev.md": { type: "[[area]]", color: "blue" },
    "sase.md": { type: "[[project]]", parent: "[[dev]]", root: true },
    "sase_goals.md": { type: "[[project]]", parent: "[[sase]]" },
    "inbox.md": { type: "[[area]]", parent: "[[dev]]" },
    "plain.md": {},
  };
  const files = new Map(Object.keys(frontmatter).map((path) => [path, { path }]));
  const metadataCache = {
    getFileCache: (file) => ({ frontmatter: frontmatter[file.path] || {} }),
    getFirstLinkpathDest: (target) => {
      const raw = String(target || "").replace(/\.md$/i, "");
      const exact = [...files.values()].find((file) => file.path.replace(/\.md$/i, "") === raw);
      const basename = [...files.values()].filter((file) => file.path.replace(/\.md$/i, "").split("/").pop().toLowerCase() === raw.split("/").pop().toLowerCase());
      return exact || (basename.length === 1 ? basename[0] : null);
    },
  };
  return { files, frontmatter, metadataCache, vault: { getAbstractFileByPath: (path) => files.get(path) || null, getMarkdownFiles: () => [...files.values()] } };
}

function appFor(vaultState = makeVault()) {
  const workspaceHandlers = {};
  const cacheHandlers = {};
  return {
    ...vaultState,
    workspace: {
      handlers: workspaceHandlers,
      on: (name, fn) => { (workspaceHandlers[name] ||= []).push(fn); return { name, fn }; },
      getLeavesOfType: () => [],
      openLinkText: (...args) => { app.opened = args; },
    },
    metadataCache: {
      ...vaultState.metadataCache,
      on: (name, fn) => { (cacheHandlers[name] ||= []).push(fn); return { name, fn }; },
      handlers: cacheHandlers,
    },
  };
}

function makePlugin(app = appFor()) {
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.applyMarkGateClass = (name, enabled) => { plugin.gate = [name, enabled]; };
  plugin.registerMarkGatePopoutSync = () => {};
  return plugin;
}

class TextNode {
  constructor(value, doc) { this.nodeType = 3; this.nodeValue = String(value); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
}
class Element {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.ownerDocument = doc; this.childNodes = []; this.parentNode = null; this.className = ""; this.attrs = {}; this.isConnected = true; this.classList = { contains: (name) => this.className.split(/\s+/).includes(name) }; }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === "class") this.className = String(value); }
  getAttribute(name) { return name === "class" ? this.className : this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  appendChild(node) { if (node.parentNode && node.parentNode.removeChild) node.parentNode.removeChild(node); node.parentNode = this; this.childNodes.push(node); return node; }
  insertBefore(node, ref) { if (node.parentNode && node.parentNode.removeChild) node.parentNode.removeChild(node); node.parentNode = this; const i = this.childNodes.indexOf(ref); if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((node) => node.textContent || "").join(""); }
  addEventListener() {}
  querySelectorAll(selector) {
    const wanted = selector.split(",").map((part) => part.trim());
    const out = [];
    const stack = [...this.childNodes];
    while (stack.length) {
      const node = stack.shift();
      if (node.nodeType === 1 && wanted.some((part) => {
        const classes = part.match(/\.[A-Za-z0-9_-]+/g) || [];
        return classes.length > 0 && classes.every((name) => node.classList.contains(name.slice(1)));
      })) out.push(node);
      if (node.childNodes) stack.push(...node.childNodes);
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
class Document {
  createElement(tag) { return new Element(tag, this); }
  createTextNode(value) { return new TextNode(value, this); }
  createTreeWalker(root) {
    const nodes = [];
    const visit = (node) => { for (const child of node.childNodes || []) { if (child.nodeType === 3) nodes.push(child); else visit(child); } };
    visit(root);
    let index = 0;
    return { nextNode: () => nodes[index++] || null };
  }
}

test("root field state and the hue-dot model cover set, compact, roll-up, and repair", () => {
  assert.equal(H.rootMarkFieldState("- [ ] #task A").state, "none");
  assert.equal(H.rootMarkFieldState("- [ ] #task A [root:: sase]").state, "set");
  assert.equal(H.rootMarkFieldState("- [ ] #task A (root:: sase)").state, "set");
  assert.equal(H.rootMarkFieldState("- [ ] #task A [root:: sase] [root:: dev]").repair, "duplicate");
  assert.equal(H.rootMarkFieldState("- [ ] #task A [root:: [[sase]]]").repair, "invalid");

  const state = makeVault();
  const ctx = { sourcePath: "inbox.md", metadataCache: state.metadataCache, vault: state.vault };
  const set = H.rootMarkModel("- [ ] #task Work [root:: gtd_daily]", ctx);
  assert.equal(set.state, "set");
  assert.equal(set.targetLabel, "gtd_daily");
  assert.equal(set.hue, "orange");
  const compact = H.rootMarkModel("- [ ] #task [[gtd_daily]] [root:: gtd_daily]", ctx);
  assert.equal(compact.state, "compact");
  assert.equal(compact.tooltip.includes("::"), false);

  const roll = H.rootMarkModel("- [ ] #task Work [root:: sase_goals]", ctx);
  assert.equal(roll.state, "rolls-up");
  assert.equal(roll.rootLabel, "sase");
  assert.match(roll.tooltip, /groups under sase/);

  const missing = H.rootMarkModel("- [ ] #task Work [root:: nope]", ctx);
  const noHome = H.rootMarkModel("- [ ] #task Work [root:: plain]", ctx);
  const duplicate = H.rootMarkModel("- [ ] #task Work [root:: sase] [root:: dev]", ctx);
  assert.equal(missing.repair, "missing");
  assert.equal(noHome.repair, "no_home");
  assert.equal(duplicate.repair, "duplicate");
  for (const model of [missing, noHome, duplicate]) assert.equal(model.tooltip.includes("::"), false);
});

test("root mark element exposes the accessible state and compact DOM shape", () => {
  const doc = new Document();
  const model = { state: "compact", hue: "orange", tooltip: "Root parent gtd_daily · gtd area", targetPath: "gtd_daily.md", sourcePath: "inbox.md" };
  const mark = H.buildRootMarkElement(doc, model, { foldSpace: true });
  assert.equal(mark.classList.contains("bob-root-mark"), true);
  assert.equal(mark.getAttribute("data-root-state"), "compact");
  assert.equal(mark.getAttribute("data-root-hue"), "orange");
  assert.equal(mark.getAttribute("data-fold-space"), "true");
  assert.equal(mark.getAttribute("aria-label"), model.tooltip);
  assert.equal(mark.querySelectorAll(".bob-root-mark-label").length, 0);
  const repair = H.buildRootMarkElement(doc, { state: "repair", hue: null, raw: "nope", tooltip: "repair" });
  assert.equal(repair.querySelector(".bob-root-mark-dot").textContent, "○");
});

test("Live Preview replaces the field, respects selection reveal, and the session toggle is wired", () => {
  const lineText = "- [ ] #task Work [root:: gtd_daily]";
  const app = appFor();
  const plugin = makePlugin(app);
  plugin.taskRootMarksEnabled = true;
  const view = {
    state: {
      doc: { lineAt: () => ({ from: 0, to: lineText.length, text: lineText }) },
      field: (field) => field === editorLivePreviewField ? true : { file: { path: "inbox.md" } },
      selection: { ranges: [] },
    },
    visibleRanges: [{ from: 0, to: lineText.length }],
  };
  const decorations = plugin.buildRootMarkDecorations(view);
  assert.equal(decorations.adds.length, 1);
  assert.equal(decorations.adds[0].value.widget.model.targetLabel, "gtd_daily");
  view.state.selection.ranges = [{ from: lineText.indexOf("[root::"), to: lineText.length }];
  assert.equal(plugin.buildRootMarkDecorations(view).adds.length, 0);

  plugin.setupTaskRootMarks();
  assert.equal(plugin.commands.some((command) => command.id === "toggle-root-marks"), true);
  assert.equal(plugin.extensions.length, 1);
  assert.equal(plugin.postProcessors, undefined);
  assert.equal(app.metadataCache.handlers.changed.length, 1);
  assert.equal(plugin.toggleTaskRootMarks(), false);
  assert.deepEqual(plugin.gate, ["bob-root-marks", false]);
  assert.equal(NoticeStub.messages.at(-1), "Root marks off");
});

test("Reading and Tasks rows wrap root text without losing it and restore on unload", () => {
  const doc = new Document();
  const state = makeVault();
  const app = appFor(state);
  const plugin = makePlugin(app);
  plugin.taskRootMarksEnabled = true;
  const makeRow = (className) => {
    const row = doc.createElement("li");
    row.setAttribute("class", className);
    row.setAttribute("data-task", " ");
    row.setAttribute("data-task-path", "inbox.md");
    row.setAttribute("data-line", "0");
    row.appendChild(doc.createTextNode("- [ ] #task Work [root:: gtd_daily]"));
    return row;
  };
  const reading = makeRow("task-list-item");
  assert.equal(plugin.decorateRootMarkRow(reading, { sourcePath: "daily.md" }, "daily.md"), true);
  assert.equal(reading.querySelectorAll(".bob-root-mark").length, 1);
  plugin.rootMarkRestoreHosts(reading);
  assert.equal(reading.textContent, "- [ ] #task Work [root:: gtd_daily]");

  const codeRow = makeRow("task-list-item");
  codeRow.childNodes = [];
  const code = doc.createElement("code");
  code.appendChild(doc.createTextNode("[root:: gtd_daily]"));
  codeRow.appendChild(code);
  assert.equal(plugin.decorateRootMarkRow(codeRow, { sourcePath: "inbox.md" }, "inbox.md"), false);

  const nativeReading = makeRow("task-list-item");
  nativeReading.childNodes = [];
  const prefix = doc.createTextNode("- [ ] #task Work ");
  nativeReading.appendChild(prefix);
  const nativeField = doc.createElement("span");
  nativeField.setAttribute("class", "dataview inline-field");
  nativeField.setAttribute("data-dv-norm-key", "root");
  nativeField.appendChild(doc.createTextNode("root: gtd_daily"));
  nativeReading.appendChild(nativeField);
  assert.equal(plugin.decorateRootMarkRow(nativeReading, { sourcePath: "inbox.md" }, "inbox.md"), true);
  assert.equal(nativeReading.querySelectorAll(".bob-root-mark").length, 1);
  plugin.rootMarkRestoreHosts(nativeReading);
  assert.equal(nativeReading.querySelectorAll(".dataview").length, 1);
  assert.equal(nativeReading.textContent, "- [ ] #task Work root: gtd_daily");

  const tasks = makeRow("plugin-tasks-list-item");
  plugin.rootMarkFramePending = true;
  assert.equal(plugin.renderRootMarksIn(tasks, { sourcePath: "dash.md" }), true);
  plugin.runRootMarkFrame();
  assert.equal(tasks.querySelectorAll(".bob-root-mark").length, 1);
  doc.body = tasks;
  plugin.rootMarkDocuments = () => [doc];
  plugin.teardownTaskRootMarks();
  assert.equal(tasks.textContent, "- [ ] #task Work [root:: gtd_daily]");
});

test("the root-mark stylesheet has light/dark, state, and gate rules", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /\.theme-light \.bob-root-mark/);
  assert.match(css, /\.theme-dark \.bob-root-mark/);
  assert.match(css, /bob-root-mark-rolls-up/);
  assert.match(css, /bob-root-mark-repair/);
  assert.match(css, /body\.bob-root-marks \.bob-root-mark-native/);
});
