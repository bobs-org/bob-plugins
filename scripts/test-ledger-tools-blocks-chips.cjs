// BLOCKS chips (bob-cli-7e chips). BK vectors come from the approved
// prerequisite-blocks plan; BC vectors cover both render surfaces.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { field: "info" };
const editorLivePreviewField = { field: "live" };
class StubWidgetType {}
class StubRangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const StubDecoration = {
  none: { none: true },
  replace: (value) => ({ replace: true, ...value }),
  widget: (value) => ({ widget: true, ...value }),
};
const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => type === other });
    return type;
  },
};
const StubViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
class TestPlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.editorExtensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.registeredEvents ||= []).push(ref); }
  registerInterval(handle) { (this.intervals ||= []).push(handle); return handle; }
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }

function hideNodeFields(node, fields) {
  for (const field of fields) {
    Object.defineProperty(node, field, {
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  assert.deepEqual(fields.filter((field) => Object.keys(node).includes(field)), []);
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {}, Notice: TestNotice, Platform: { isDesktopApp: true }, Plugin: TestPlugin,
      normalizePath: (value) => value, parseYaml: (value) => JSON.parse(value),
      editorInfoField, editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value }, StateEffect: StubStateEffect, RangeSetBuilder: StubRangeSetBuilder };
  }
  if (request === "@codemirror/view") {
    return { EditorView: { updateListener: { of: (value) => value } }, keymap: { of: (value) => value }, ViewPlugin: StubViewPlugin, Decoration: StubDecoration, WidgetType: StubWidgetType };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const helpers = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

const {
  parseBlocksLine, parseDependencyLine, blocksSortLinks, blocksDependentsIndex,
  blocksLastBlocker, blocksChipModel, buildBlocksChipElement, computePlanBudget,
  BLOCKS_CHIP_TOOLTIP, BLOCKS_CHIP_EDIT_TOOLTIP,
} = helpers;

function task({ blockId, id, dependsOn = [], description = "Task", path = "a.md", status = "TODO", symbol = " ", tags = [], scheduled, lineNumber }) {
  return {
    id, dependsOn, path, blockLink: blockId ? " ^" + blockId : "", description,
    status: { type: status, symbol }, tags, scheduled, lineNumber,
  };
}

function lookupFor(tasks, source = "a.md") {
  return (linkpath, blockId) => {
    const targetPath = linkpath ? (linkpath.endsWith(".md") ? linkpath : linkpath + ".md") : source;
    return tasks.find((item) => item.path === targetPath && item.blockLink.trim().replace(/^\^/, "") === blockId) || null;
  };
}

test("BK1-BK21 BLOCKS grammar, tolerance, and canonical ordering", () => {
  const cases = [
    ["BK1", "- 🧱 **BLOCKS:** [[#^a]]", {}, "accept", 1],
    ["BK2", "- 🧱 **BLOCKS:** [[#^a]] • [[cash#^b]] • [[money/cash#^c]]", {}, "accept", 3],
    ["BK3", "- 🧱 **BLOCKS:** [[#^a|b • c]]", {}, "accept", 1],
    ["BK4", "- **BLOCKS:** [[#^a]]", {}, "accept", 1],
    ["BK5", "- 🚧 **BLOCKS:** [[#^a]]", {}, "accept", 1],
    ["BK6", "- ⛓️ **BLOCKS:** [[#^a]]", {}, "accept", 1],
    ["BK6b", "- ⛓ **BLOCKS:** [[#^a]]", {}, "accept", 1],
    ["BK7", "- 🧱 **BLOCKING:** [[#^a]]", {}, "accept", 1],
    ["BK8a", "- 🧱 **BLOCKS:** [[#^a]] · [[#^b]]", {}, "accept", 2],
    ["BK8b", "- 🧱 **BLOCKS:** [[#^a]], [[#^b]]", {}, "accept", 2],
    ["BK8c", "- 🧱 **BLOCKS:** [[#^a]] [[#^b]]", {}, "accept", 2],
    ["BK9a", "- 🧱 **BLOCKS:** ~~[[#^a]]~~", {}, "accept", 1],
    ["BK9b", "- 🧱 **BLOCKS:** ![[#^a]]", {}, "accept", 1],
    ["BK10", "- 🧱 **BLOCKS:** [[cash#^b]] • [[#^a]]", {}, "accept", 2],
    ["BK11", "- 🧱 **BLOCKS:** [[#^a]] • [[#^a]]", {}, "accept", 2],
    ["BK12", "- 🧱 **BLOCKS:**", {}, "empty", 0],
    ["BK13", "- 🧱 **BLOCKS:** [[#^a", {}, "malformed"],
    ["BK14", "- 🧱 **BLOCKS:** [[#^a]] until Friday", {}, "malformed"],
    ["BK15a", "- 🧱 **BLOCKS:** [[note]]", {}, "malformed"],
    ["BK15b", "- 🧱 **BLOCKS:** [[note#Heading]]", {}, "malformed"],
    ["BK15c", "- 🧱 **BLOCKS:** • ,", {}, "malformed"],
    ["BK16", "- 🧱 **blocks:** [[#^a]]", {}, "not-a-line"],
    ["BK17", "- 🧱 **BLOCKED BY:** [[#^a]]", {}, "not-a-line"],
    ["BK18a", "- 🧱 **BLOCKS:** [[#^a]]", { inCode: true }, "not-a-line"],
    ["BK18b", "- 🧱 **BLOCKS:** [[#^a]]", { isDirectChild: false }, "not-a-line"],
    ["BK18c", "> - 🧱 **BLOCKS:** [[#^a]]", {}, "not-a-line"],
    ["BK18d", "🧱 **BLOCKS:** [[#^a]]", {}, "not-a-line"],
    ["BK19", "- 🧱 **BLOCKS:** [[#^a]]", {}, "accept", 1],
  ];
  for (const [id, line, opts, verdict, count] of cases) {
    const parsed = parseBlocksLine(line, opts);
    assert.equal(parsed.verdict, verdict, id);
    if (count !== undefined) assert.equal(parsed.targets.length, count, id + " count");
  }
  assert.equal(parseBlocksLine("- 🧱 **BLOCKS:** [[#^a]]").canonical, true);
  assert.equal(parseBlocksLine("- 🚧 **BLOCKING:** [[#^a]]").canonical, false);
  assert.equal(parseBlocksLine("- ⛓️ **DEPENDS ON:** [[#^a]]").verdict, "not-a-line");
  assert.equal(parseDependencyLine("- 🧱 **BLOCKS:** [[#^a]]").verdict, "not-a-line");
  const sorted = blocksSortLinks(["[[zeta#^e]]", "[[élan#^d]]", "[[cash#^c]]", "[[Cash#^a]]", "[[#^b]]"].map((linktext) => ({ linktext })));
  assert.deepEqual(sorted.map((row) => row.linktext), ["[[#^b]]", "[[Cash#^a]]", "[[cash#^c]]", "[[zeta#^e]]", "[[élan#^d]]"]);
});

test("reverse index and 🔑 last-blocker rules (BC1-BC7, BC11, BC13)", () => {
  const owner = task({ blockId: "owner", id: "root", description: "Owner" });
  const dep = task({ blockId: "dep", id: "dependent", dependsOn: ["root"], description: "Review the outline", symbol: "?", status: "ON_HOLD" });
  const memo = { tasks: [owner, dep], dateText: "2026-10-13" };
  const reverse = blocksDependentsIndex(memo);
  assert.equal(reverse.get("root").length, 1);
  assert.equal(blocksDependentsIndex(memo), reverse, "memo builds its index once");
  let model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, memo, lookupFor(memo.tasks), "2026-10-13");
  assert.equal(model.label, "🧱 blocks");
  assert.equal(model.chips[0].lastBlocker, true);
  assert.equal(model.summary, "frees 1");

  const other = task({ blockId: "other", id: "other", description: "Outline" });
  const waitsTwice = { ...dep, dependsOn: ["root", "other"] };
  const multiMemo = { tasks: [owner, other, waitsTwice], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, multiMemo, lookupFor(multiMemo.tasks), "2026-10-13");
  assert.equal(model.summary, "frees 0 of 1");
  assert.match(model.chips[0].tooltip, /also waits on "Outline"/);
  assert.equal(blocksLastBlocker(waitsTwice, owner, multiMemo, "2026-10-13").lastBlocker, false);

  const scheduled = { ...dep, scheduled: "2026-11-02" };
  const scheduledMemo = { tasks: [owner, scheduled], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, scheduledMemo, lookupFor(scheduledMemo.tasks), "2026-10-13");
  assert.equal(model.chips[0].lastBlocker, false);
  assert.match(model.chips[0].tooltip, /2026-11-02/);

  const project = { ...dep, tags: ["#prj_is_blocked"], path: "projects/sase.md" };
  const projectMemo = { tasks: [owner, project], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[projects/sase#^dep]]", "a.md", owner, projectMemo, lookupFor(projectMemo.tasks), "2026-10-13");
  assert.equal(model.chips[0].lastBlocker, false);
  assert.match(model.chips[0].tooltip, /project sase/);

  const cross = { ...dep, path: "money/cash.md" };
  const crossMemo = { tasks: [owner, cross], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[money/cash#^dep]]", "a.md", owner, crossMemo, lookupFor(crossMemo.tasks), "2026-10-13");
  assert.equal(model.chips[0].noteLabel, "↗ cash");

  const projectTask = task({ blockId: "prj", id: "project", dependsOn: ["root"], path: "projects/sase.md", description: "Project task" });
  const projectTaskMemo = { tasks: [owner, projectTask], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[projects/sase#^prj]]", "a.md", owner, projectTaskMemo, lookupFor(projectTaskMemo.tasks), "2026-10-13");
  assert.equal(model.chips[0].symbol, "🧩");
  assert.equal(model.chips[0].text, "sase");

  const hidden = { ...dep, tags: ["#hide"] };
  const hiddenMemo = { tasks: [owner, hidden], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, hiddenMemo, lookupFor(hiddenMemo.tasks), "2026-10-13");
  assert.equal(model.chips[0].hidden, true);

  const long = { ...dep, description: "x".repeat(60) };
  const longMemo = { tasks: [owner, long], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, longMemo, lookupFor(longMemo.tasks), "2026-10-13");
  assert.ok(model.chips[0].text.length <= 41);
  assert.equal(model.chips[0].fullText.length, 60);
});

test("stale, missing, canonical append, and frozen-owner models (BC8-BC10)", () => {
  const owner = task({ blockId: "owner", id: "root" });
  const noLongerDependent = task({ blockId: "dep", id: "dependent", dependsOn: ["elsewhere"], description: "Stale row" });
  let memo = { tasks: [owner, noLongerDependent], dateText: "2026-10-13" };
  let model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, memo, lookupFor(memo.tasks), "2026-10-13");
  assert.equal(model.chips[0].stale, true);
  assert.equal(model.chips[0].live, false);
  assert.equal(model.summary, "");
  assert.match(model.chips[0].tooltip, /No longer waiting on this task · refreshes on the next reconcile/);

  const z = task({ blockId: "z", id: "z", dependsOn: ["root"], path: "cash.md" });
  const a = task({ blockId: "a", id: "a", dependsOn: ["root"] });
  memo = { tasks: [owner, z, a], dateText: "2026-10-13" };
  model = blocksChipModel("- 🧱 **BLOCKS:**", "a.md", owner, memo, lookupFor(memo.tasks), "2026-10-13");
  assert.deepEqual(model.chips.map((chip) => chip.blockId), ["a", "z"]);
  assert.equal(model.summary, "frees 2");

  const closed = { ...owner, status: { type: "DONE", symbol: "x" } };
  model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", closed, { tasks: [closed, noLongerDependent] }, lookupFor([closed, noLongerDependent]), "2026-10-13");
  assert.equal(model.label, "🧱 was blocking");
  assert.equal(model.summary, "✓ freed 1");
  assert.equal(model.chips[0].stale, false);
  assert.equal(model.chips[0].lastBlocker, false);

  model = blocksChipModel("- 🧱 **BLOCKS:** [[#^missing]]", "a.md", closed, { tasks: [closed] }, lookupFor([closed]), "2026-10-13");
  assert.equal(model.chips[0].symbol, "⚠");
  assert.match(model.chips[0].text, /not found/);
});

class MiniNode {
  constructor(tag, nodeType = 1, value = "") {
    this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.nodeType = nodeType;
    this.nodeValue = nodeType === 3 ? value : null; this.childNodes = []; this.parentNode = null;
    this.attributes = {}; this.style = {}; this.dataset = {}; this.ownerDocument = null;
    this.className = ""; this.listeners = {};
    this.classList = {
      add: (...names) => { this.className = Array.from(new Set((this.className + " " + names.join(" ")).trim().split(/\s+/).filter(Boolean))).join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => name && !names.includes(name)).join(" "); },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
    hideNodeFields(this, ["parentNode", "ownerDocument"]);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "class") this.className = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  // Hidden back-references bound assert diffs; this descriptor keeps inspect and reporter output short.
  [require("node:util").inspect.custom]() {
    const cls = String(this.className || "");
    const kids = Array.isArray(this.childNodes) ? this.childNodes.length : 0;
    let raw = "";
    if (this.nodeType === 3) raw = String(this.nodeValue || "");
    else {
      const first = this.childNodes.find((node) => node && node.nodeType === 3);
      if (first) raw = String(first.nodeValue || "");
    }
    const flat = raw.replace(/\s+/g, " ");
    const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
    const dot = cls ? "." + cls.split(/\s+/).filter(Boolean).join(".") : "";
    return `MiniNode(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }
  appendChild(child) { child.parentNode = this; child.ownerDocument = this.ownerDocument; this.childNodes.push(child); return child; }
  removeChild(child) { this.childNodes = this.childNodes.filter((node) => node !== child); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; this.appendChild(new MiniNode("#text", 3, String(value))); }
  querySelectorAll(selector) {
    const found = [];
    const matches = (node) => selector === "li" ? node.tagName === "LI" : selector === "a.internal-link" ? node.tagName === "A" && node.classList.contains("internal-link") : false;
    const visit = (node) => { for (const child of node.childNodes || []) { if (child.nodeType === 1 && matches(child)) found.push(child); if (child.nodeType === 1) visit(child); } };
    visit(this); return found;
  }
}
class MiniDoc {
  createElement(tag) { const node = new MiniNode(tag); node.ownerDocument = this; return node; }
  createTextNode(text) { const node = new MiniNode("#text", 3, String(text)); node.ownerDocument = this; return node; }
}

function makeDoc(lines) {
  let offset = 0;
  const rows = lines.map((text, i) => { const row = { from: offset, to: offset + text.length, number: i + 1, text }; offset = row.to + 1; return row; });
  return { length: Math.max(0, offset - 1), line: (n) => rows[n - 1], lineAt: (pos) => rows.find((row) => pos >= row.from && pos <= row.to) || rows[rows.length - 1] };
}

function makeApp(tasks, text = "", navApi = null) {
  const plugins = { "obsidian-tasks-plugin": { getTasks: () => tasks } };
  if (navApi) {
    plugins["bob-navigation-hotkeys"] = { api: navApi };
  }
  return {
    plugins: { plugins },
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {}, getLeavesOfType: () => [], trigger: () => {} },
    vault: { getAbstractFileByPath: (path) => ({ path }), cachedRead: () => Promise.resolve(text) },
    metadataCache: { on: () => ({}), getFirstLinkpathDest: (linkpath) => ({ path: (linkpath || "a").replace(/\.md$/i, "") + ".md" }), getCache: () => ({}) },
  };
}

function makeBlocksNavApi(calls) {
  return {
    version: 3,
    blocks: {
      version: 1,
      openStage(ref) {
        calls.push(["openStage", ref]);
        return Promise.resolve({ ok: true });
      },
      removeDependent(ownerRef, target) {
        calls.push(["removeDependent", ownerRef, target]);
        return Promise.resolve({ ok: true });
      },
    },
  };
}

function findByClass(node, name, out = []) {
  if (node && node.nodeType === 1 && node.classList && node.classList.contains(name)) {
    out.push(node);
  }
  for (const child of node.childNodes || []) {
    findByClass(child, name, out);
  }
  return out;
}

function serializeNode(node) {
  if (!node) return "";
  if (node.nodeType === 3) {
    return JSON.stringify(node.nodeValue);
  }
  const attrs = Object.keys(node.attributes || {}).sort().map((key) => key + "=" + node.attributes[key]).join(" ");
  return "<" + node.tagName + (attrs ? " " + attrs : "") + ">" + (node.childNodes || []).map(serializeNode).join("") + "</" + node.tagName + ">";
}

function fire(node, type, extra = {}) {
  const event = {
    stopPropagation() {},
    preventDefault() {},
    target: node,
    key: extra.key,
  };
  for (const handler of node.listeners[type] || []) {
    handler(event);
  }
}

test("Live Preview, Reading view, shared toggle, and malformed rows (BC12, BC14, BC15)", async () => {
  const owner = task({ blockId: "owner", id: "root", description: "Owner", lineNumber: 0 });
  const dep = task({ blockId: "dep", id: "dependent", dependsOn: ["root"], description: "Dependent", lineNumber: 2 });
  const lines = ["- [ ] #task Owner ^owner", "  - 🧱 **BLOCKS:** [[#^dep]]", "- [?] #task Dependent [dependsOn:: root] ^dep"];
  const plugin = new LedgerToolsPlugin(makeApp([owner, dep], lines.join("\n")), {});
  plugin.dependencyChipsEnabled = true;
  const doc = makeDoc(lines);
  const view = {
    visibleRanges: [{ from: 0, to: doc.length }],
    state: {
      doc, selection: { ranges: [] },
      field: (field) => field === editorLivePreviewField ? true : field === editorInfoField ? { file: { path: "a.md" } } : null,
    },
  };
  const decorations = plugin.buildBlocksChipDecorations(view);
  assert.equal(decorations.adds.length, 1);
  assert.equal(decorations.adds[0].value.widget.model.chips[0].lastBlocker, true);

  const docNode = new MiniDoc();
  const root = docNode.createElement("div");
  const ownerLi = docNode.createElement("li");
  ownerLi.appendChild(docNode.createTextNode("#task Owner"));
  const list = docNode.createElement("ul"); ownerLi.appendChild(list);
  const row = docNode.createElement("li");
  row.appendChild(docNode.createTextNode("🧱 "));
  const strong = docNode.createElement("strong"); strong.appendChild(docNode.createTextNode("BLOCKS:")); row.appendChild(strong);
  row.appendChild(docNode.createTextNode(" "));
  const anchor = docNode.createElement("a"); anchor.classList.add("internal-link"); anchor.setAttribute("data-href", "#^dep"); anchor.setAttribute("href", "#^dep"); anchor.appendChild(docNode.createTextNode("Dependent")); row.appendChild(anchor);
  list.appendChild(row);
  const depLi = docNode.createElement("li"); depLi.appendChild(docNode.createTextNode("#task Dependent"));
  root.appendChild(ownerLi); root.appendChild(depLi);
  // querySelectorAll traverses nested list items in document order.
  const sectionInfo = { lineStart: 0, lineEnd: 2 };
  await plugin.renderBlocksChipsIn(root, { sourcePath: "a.md", getSectionInfo: () => sectionInfo });
  assert.ok(row.classList.contains("bob-blocks-row"));
  assert.ok(anchor.classList.contains("bob-blocks-chip"));
  assert.equal(anchor.querySelectorAll("a.internal-link").length, 0);
  assert.ok(anchor.childNodes.some((child) => child.className.includes("bob-blocks-key")));

  plugin.setupDependencyChips();
  assert.equal(plugin.editorExtensions.length, 3, "one dependency extension, one BLOCKS extension, and one relation extension");
  assert.equal(plugin.postProcessors.length, 3, "one toggle owns all three rendered rows");
  const toggle = plugin.commands.find((command) => command.id === "toggle-dependency-chips");
  assert.ok(toggle);
  assert.equal(toggle.callback(), false);
  assert.equal(plugin.dependencyChipsEnabled, false);

  const malformed = plugin.blocksChipModelForLine({ path: "a.md", text: "  - 🧱 **blocks:** [[#^dep]]" });
  assert.equal(malformed, null);
});

test("budget link counter ignores Depends-On and BLOCKS rows (MC1/MC2)", () => {
  const content = "## Pomodoros\n\n- [ ] () — WORK\n" +
    "    - 🧱 **BLOCKS:** [[#^owner]]\n" +
    "    - ⛓️ **DEPENDS ON:** [[#^prerequisite]]\n" +
    "    - [[#^real-task]]\n";
  const budget = computePlanBudget(content);
  assert.equal(budget.links.count, 1);
  assert.equal(budget.entries[0].links, 1);
});

test("chip builder includes the 🔑 badge and has no edit controls", () => {
  const owner = task({ blockId: "owner", id: "root" });
  const dep = task({ blockId: "dep", id: "dependent", dependsOn: ["root"], description: "Dependent" });
  const model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, { tasks: [owner, dep] }, lookupFor([owner, dep]));
  const doc = new MiniDoc();
  const el = buildBlocksChipElement(doc, model, {});
  assert.ok(el.classList.contains("bob-blocks-row"));
  assert.ok(el.querySelectorAll("button").length === 0);
  assert.equal(findByClass(el, "bob-dep-add").length, 0);
  assert.equal(findByClass(el, "bob-dep-chip-remove").length, 0);
  assert.equal(el.getAttribute("title"), BLOCKS_CHIP_TOOLTIP);
  assert.ok(el.childNodes.some((child) => child.childNodes.some((nested) => nested.className.includes("bob-blocks-key"))));
});

test("RBC1 open owner with api.blocks shows ＋ and openStage gets the 0-based line", async () => {
  const owner = task({ blockId: "owner", id: "root", description: "Owner", lineNumber: 0 });
  const dep = task({ blockId: "dep", id: "dependent", dependsOn: ["root"], description: "Dependent", lineNumber: 2, path: "a.md" });
  const lines = ["- [ ] #task Owner ^owner", "  - 🧱 **BLOCKS:** [[#^dep]]", "- [?] #task Dependent [dependsOn:: root] ^dep"];
  const calls = [];
  const plugin = new LedgerToolsPlugin(makeApp([owner, dep], lines.join("\n"), makeBlocksNavApi(calls)), {});
  plugin.dependencyChipsEnabled = true;
  const doc = makeDoc(lines);
  const view = {
    visibleRanges: [{ from: 0, to: doc.length }],
    state: {
      doc, selection: { ranges: [] },
      field: (field) => field === editorLivePreviewField ? true : field === editorInfoField ? { file: { path: "a.md" } } : null,
    },
  };
  const decorations = plugin.buildBlocksChipDecorations(view);
  assert.equal(decorations.adds.length, 1);
  const widget = decorations.adds[0].value.widget;
  assert.equal(widget.meta.interactive, true);
  assert.equal(widget.meta.lineNumber, 1);

  const model = widget.model;
  const mini = new MiniDoc();
  const el = buildBlocksChipElement(mini, model, {
    plugin,
    sourcePath: "a.md",
    interactive: true,
    onAdd: () => plugin.blocksOpenStage("a.md", widget.meta),
    onRemove: (chip) => plugin.blocksRemoveDependent(chip, "a.md", widget.meta),
  });
  const add = findByClass(el, "bob-dep-add");
  assert.equal(add.length, 1);
  assert.equal(add[0].getAttribute("aria-label"), "Edit what this task blocks");
  assert.equal(el.getAttribute("title"), BLOCKS_CHIP_EDIT_TOOLTIP);
  fire(add[0], "click");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["openStage", { path: "a.md", line: 1 }]);
});

test("RBC2 hover × on a live chip calls removeDependent; notice is nav's", async () => {
  TestNotice.messages = [];
  const owner = task({ blockId: "owner", id: "root" });
  const dep = task({ blockId: "dep", id: "dependent", dependsOn: ["root"], description: "Review the outline", path: "a.md" });
  const model = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, { tasks: [owner, dep] }, lookupFor([owner, dep]));
  assert.equal(model.chips[0].live, true);
  const calls = [];
  const plugin = new LedgerToolsPlugin(makeApp([owner, dep], "", makeBlocksNavApi(calls)), {});
  const mini = new MiniDoc();
  const el = buildBlocksChipElement(mini, model, {
    plugin,
    sourcePath: "a.md",
    interactive: true,
    onRemove: (chip) => plugin.blocksRemoveDependent(chip, "a.md", { lineNumber: 1 }),
  });
  const remove = findByClass(el, "bob-dep-chip-remove");
  assert.equal(remove.length, 1);
  assert.equal(remove[0].getAttribute("aria-label"), "Stop blocking Review the outline");
  fire(remove[0], "click");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "removeDependent");
  assert.deepEqual(calls[0][1], { path: "a.md", line: 1 });
  assert.deepEqual(calls[0][2], { path: "a.md", blockId: "dep" });
  await Promise.resolve();
  assert.deepEqual(TestNotice.messages, []);
});

test("RBC3 frozen, stale, and no api.blocks stay navigation-only", () => {
  const owner = task({ blockId: "owner", id: "root" });
  const dep = task({ blockId: "dep", id: "dependent", dependsOn: ["root"], description: "Dependent" });
  const liveModel = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", owner, { tasks: [owner, dep] }, lookupFor([owner, dep]));
  const mini = new MiniDoc();
  const plain = buildBlocksChipElement(mini, liveModel, {});
  const explicitOff = buildBlocksChipElement(new MiniDoc(), liveModel, { interactive: false });
  assert.equal(serializeNode(plain), serializeNode(explicitOff));
  assert.equal(findByClass(plain, "bob-dep-add").length, 0);
  assert.equal(findByClass(plain, "bob-dep-chip-remove").length, 0);
  assert.equal(plain.getAttribute("title"), BLOCKS_CHIP_TOOLTIP);

  const closed = { ...owner, status: { type: "DONE", symbol: "x" } };
  const frozen = blocksChipModel("- 🧱 **BLOCKS:** [[#^dep]]", "a.md", closed, { tasks: [closed, dep] }, lookupFor([closed, dep]));
  assert.equal(frozen.frozen, true);
  const frozenEl = buildBlocksChipElement(new MiniDoc(), frozen, { interactive: true });
  assert.equal(findByClass(frozenEl, "bob-dep-add").length, 0);
  assert.equal(findByClass(frozenEl, "bob-dep-chip-remove").length, 0);
  assert.equal(frozenEl.getAttribute("title"), BLOCKS_CHIP_TOOLTIP);

  const staleDep = task({ blockId: "dep", id: "dependent", dependsOn: ["elsewhere"], description: "Stale row" });
  const stillWaiting = task({ blockId: "live", id: "live", dependsOn: ["root"], description: "Still waiting" });
  const mixed = blocksChipModel(
    "- 🧱 **BLOCKS:** [[#^dep]] • [[#^live]]",
    "a.md",
    owner,
    { tasks: [owner, staleDep, stillWaiting] },
    lookupFor([owner, staleDep, stillWaiting]),
  );
  const liveChip = mixed.chips.find((chip) => chip.blockId === "live");
  const staleChip = mixed.chips.find((chip) => chip.blockId === "dep");
  assert.equal(staleChip.stale, true);
  assert.equal(staleChip.live, false);
  assert.equal(liveChip.live, true);
  const mixedEl = buildBlocksChipElement(new MiniDoc(), mixed, { interactive: true });
  assert.equal(findByClass(mixedEl, "bob-dep-add").length, 1);
  const removes = findByClass(mixedEl, "bob-dep-chip-remove");
  assert.equal(removes.length, 1);
  assert.equal(removes[0].getAttribute("aria-label"), "Stop blocking Still waiting");
});

test("RBC4 Reading view matches Live Preview ＋ / ×", async () => {
  const owner = task({ blockId: "owner", id: "root", description: "Owner", lineNumber: 0 });
  const dep = task({ blockId: "dep", id: "dependent", dependsOn: ["root"], description: "Dependent", lineNumber: 2, path: "a.md" });
  const lines = ["- [ ] #task Owner ^owner", "  - 🧱 **BLOCKS:** [[#^dep]]", "- [?] #task Dependent [dependsOn:: root] ^dep"];
  const calls = [];
  const plugin = new LedgerToolsPlugin(makeApp([owner, dep], lines.join("\n"), makeBlocksNavApi(calls)), {});
  plugin.dependencyChipsEnabled = true;
  const docNode = new MiniDoc();
  const root = docNode.createElement("div");
  const ownerLi = docNode.createElement("li");
  ownerLi.appendChild(docNode.createTextNode("#task Owner"));
  const list = docNode.createElement("ul"); ownerLi.appendChild(list);
  const row = docNode.createElement("li");
  row.appendChild(docNode.createTextNode("🧱 "));
  const strong = docNode.createElement("strong"); strong.appendChild(docNode.createTextNode("BLOCKS:")); row.appendChild(strong);
  row.appendChild(docNode.createTextNode(" "));
  const anchor = docNode.createElement("a"); anchor.classList.add("internal-link"); anchor.setAttribute("data-href", "#^dep"); anchor.setAttribute("href", "#^dep"); anchor.appendChild(docNode.createTextNode("Dependent")); row.appendChild(anchor);
  list.appendChild(row);
  const depLi = docNode.createElement("li"); depLi.appendChild(docNode.createTextNode("#task Dependent"));
  root.appendChild(ownerLi); root.appendChild(depLi);
  await plugin.renderBlocksChipsIn(root, { sourcePath: "a.md", getSectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) });
  assert.equal(row.getAttribute("title"), BLOCKS_CHIP_EDIT_TOOLTIP);
  const add = findByClass(row, "bob-dep-add");
  const remove = findByClass(row, "bob-dep-chip-remove");
  assert.equal(add.length, 1);
  assert.equal(remove.length, 1);
  assert.equal(add[0].getAttribute("aria-label"), "Edit what this task blocks");
  assert.equal(remove[0].getAttribute("aria-label"), "Stop blocking Dependent");
  fire(add[0], "click");
  fire(remove[0], "click");
  assert.equal(calls[0][0], "openStage");
  assert.deepEqual(calls[0][1], { path: "a.md", line: 1 });
  assert.equal(calls[1][0], "removeDependent");
  assert.deepEqual(calls[1][1], { path: "a.md", line: 1 });
  assert.deepEqual(calls[1][2], { path: "a.md", blockId: "dep" });

  const frozenOwner = { ...owner, status: { type: "DONE", symbol: "x" } };
  const frozenPlugin = new LedgerToolsPlugin(makeApp([frozenOwner, dep], lines.join("\n"), makeBlocksNavApi([])), {});
  frozenPlugin.dependencyChipsEnabled = true;
  const frozenDoc = new MiniDoc();
  const frozenRoot = frozenDoc.createElement("div");
  const frozenOwnerLi = frozenDoc.createElement("li");
  frozenOwnerLi.appendChild(frozenDoc.createTextNode("#task Owner"));
  const frozenList = frozenDoc.createElement("ul"); frozenOwnerLi.appendChild(frozenList);
  const frozenRow = frozenDoc.createElement("li");
  frozenRow.appendChild(frozenDoc.createTextNode("🧱 "));
  const frozenStrong = frozenDoc.createElement("strong"); frozenStrong.appendChild(frozenDoc.createTextNode("BLOCKS:")); frozenRow.appendChild(frozenStrong);
  frozenRow.appendChild(frozenDoc.createTextNode(" "));
  const frozenAnchor = frozenDoc.createElement("a"); frozenAnchor.classList.add("internal-link"); frozenAnchor.setAttribute("data-href", "#^dep"); frozenAnchor.setAttribute("href", "#^dep"); frozenAnchor.appendChild(frozenDoc.createTextNode("Dependent")); frozenRow.appendChild(frozenAnchor);
  frozenList.appendChild(frozenRow);
  const frozenDepLi = frozenDoc.createElement("li"); frozenDepLi.appendChild(frozenDoc.createTextNode("#task Dependent"));
  frozenRoot.appendChild(frozenOwnerLi); frozenRoot.appendChild(frozenDepLi);
  await frozenPlugin.renderBlocksChipsIn(frozenRoot, { sourcePath: "a.md", getSectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) });
  assert.equal(findByClass(frozenRow, "bob-dep-add").length, 0);
  assert.equal(findByClass(frozenRow, "bob-dep-chip-remove").length, 0);
  assert.equal(frozenRow.getAttribute("title"), BLOCKS_CHIP_TOOLTIP);
});
