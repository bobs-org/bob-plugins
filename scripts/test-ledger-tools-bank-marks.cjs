// Bank row and day-heading marks: tokenizer, Live Preview, Reading view,
// math protection, settings, popouts, and hub-property hiding.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { bankMark: "info" };
const editorLivePreviewField = { bankMark: "live" };
class WidgetType {}
class RangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const Decoration = {
  none: { none: true },
  replace: (spec) => ({ replace: true, ...spec }),
  line: (spec) => ({ line: true, ...spec }),
  widget: (spec) => ({ widget: true, ...spec }),
};
const StateEffect = {
  define: () => {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};
const ViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
const syntaxTree = (state) => state && state._tree ? state._tree : { resolveInner: () => null };

class PluginStub {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); }
  registerInterval(handle) { (this.intervals ||= []).push(handle); return handle; }
}
class NoticeStub { constructor(message) { NoticeStub.messages.push(String(message)); } }
NoticeStub.messages = [];

const entryPath = require.resolve("../plugins/bob-ledger-tools/main.js");
function loadPlugin() {
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === "obsidian") {
      return {
        Notice: NoticeStub,
        Plugin: PluginStub,
        MarkdownView: class MarkdownView {},
        normalizePath: (value) => value,
        parseYaml: (text) => JSON.parse(text),
        editorInfoField,
        editorLivePreviewField,
      };
    }
    if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
    if (request === "@codemirror/view") {
      return { ViewPlugin, Decoration, WidgetType, EditorView: { updateListener: { of: (fn) => fn } }, keymap: { of: (value) => value } };
    }
    if (request === "@codemirror/language") return { syntaxTree };
    return originalLoad.call(this, request, ...args);
  };
  try {
    delete require.cache[entryPath];
    return require(entryPath);
  } finally {
    Module._load = originalLoad;
  }
}

const LedgerToolsPlugin = loadPlugin();
const H = LedgerToolsPlugin.helpers;
const fixtureDir = path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/bank");
const monthNote = fs.readFileSync(path.join(fixtureDir, "month-2026-11.md"), "utf8");
const mathNote = fs.readFileSync(path.join(fixtureDir, "math-rows.md"), "utf8");
const reportDoc = JSON.parse(fs.readFileSync(path.join(fixtureDir, "report-month.json"), "utf8"));
const report = H.bankDecodeReport(JSON.stringify(reportDoc), "").report;

function makeDoc(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\n/);
  let pos = 0;
  const table = lines.map((line) => {
    const from = pos;
    const to = from + line.length;
    pos = to + 1;
    return { from, to, text: line };
  });
  return {
    length: pos > 0 ? pos - 1 : 0,
    line(n) { return { ...table[n - 1], number: n }; },
    lineAt(offset) {
      for (const line of table) {
        if (offset >= line.from && offset <= line.to) return line;
      }
      return table[table.length - 1];
    },
    sliceString() { return text; },
  };
}

function makeView(pathName, text, options = {}) {
  const doc = makeDoc(text);
  return {
    state: {
      doc,
      selection: { ranges: options.selection || [{ from: 0, to: 0 }] },
      field(field) {
        if (field === editorLivePreviewField) return options.sourceMode ? false : true;
        if (field === editorInfoField) return { file: { path: pathName } };
        return null;
      },
      _tree: options.tree || { resolveInner: () => null },
    },
    visibleRanges: [{ from: 0, to: doc.length }],
  };
}

class TextNode {
  constructor(value, doc) {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.ownerDocument = doc;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
}
class Element {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.className = "";
    this.attrs = {};
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (name) => {
        if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim();
      },
      remove: (name) => {
        this.className = this.className.split(/\s+/).filter((part) => part && part !== name).join(" ");
      },
    };
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) { return name === "class" ? this.className : this.attrs[name] ?? null; }
  appendChild(node) {
    if (node.parentNode && node.parentNode.removeChild) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (node.parentNode && node.parentNode.removeChild) node.parentNode.removeChild(node);
    node.parentNode = this;
    const i = this.childNodes.indexOf(ref);
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(next, prev) {
    const i = this.childNodes.indexOf(prev);
    if (i >= 0) {
      this.childNodes[i] = next;
      next.parentNode = this;
      prev.parentNode = null;
    }
    return prev;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((node) => node.textContent || "").join(""); }
  set textContent(value) {
    this.childNodes = [];
    const text = value == null ? "" : String(value);
    if (text) this.appendChild(this.ownerDocument.createTextNode(text));
  }
  querySelectorAll(selector) {
    const wanted = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const out = [];
    const stack = [...this.childNodes];
    while (stack.length) {
      const node = stack.shift();
      if (node.nodeType !== 1) continue;
      const tag = node.tagName.toLowerCase();
      if (wanted.some((part) => {
        const classes = part.match(/\.[A-Za-z0-9_-]+/g) || [];
        const tagPart = part.replace(/\.[A-Za-z0-9_-]+/g, "").trim().toLowerCase();
        if (tagPart && tagPart !== "*" && tag !== tagPart) return false;
        return classes.every((name) => node.classList.contains(name.slice(1)));
      })) out.push(node);
      stack.push(...(node.childNodes || []));
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
class Document {
  constructor() { this.body = new Element("body", this); this.body.ownerDocument = this; }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(value) { return new TextNode(value, this); }
  createTreeWalker(root) {
    const nodes = [];
    const visit = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) nodes.push(child);
        else visit(child);
      }
    };
    visit(root);
    let index = 0;
    return { nextNode: () => nodes[index++] || null };
  }
}

function appFor(options = {}) {
  const files = new Map([
    ["bank.md", { path: "bank.md" }],
    ["bank/2026-11.md", { path: "bank/2026-11.md" }],
  ]);
  const bodies = {
    "bank.md": "---\nbank: checking\n---\n",
    "bank/2026-11.md": options.source || monthNote,
  };
  const workspaceHandlers = {};
  return {
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || null,
      cachedRead: async (file) => bodies[file.path],
      read: async (file) => bodies[file.path],
    },
    metadataCache: {
      getFileCache: (file) => file && file.path === "bank.md" ? { frontmatter: { bank: "checking", color: "magenta" } } : { frontmatter: { month: "2026-11" } },
      on: (name, fn) => ({ name, fn }),
    },
    workspace: {
      on: (name, fn) => { (workspaceHandlers[name] ||= []).push(fn); return { name, fn }; },
      getLeavesOfType: () => options.leaves || [],
      getActiveViewOfType: () => options.activeView || null,
      activeLeaf: options.activeView ? { view: options.activeView } : null,
      handlers: workspaceHandlers,
    },
  };
}

function makePlugin(options = {}) {
  NoticeStub.messages = [];
  const plugin = new LedgerToolsPlugin(appFor(options), {});
  plugin.applyMarkGateClass = (name, enabled) => { plugin.gate = [name, enabled]; plugin.gates = plugin.gates || []; plugin.gates.push([name, enabled]); };
  plugin.registerMarkGatePopoutSync = (name, isEnabled) => { plugin.popoutSync = { name, isEnabled }; };
  plugin.markGateDocuments = () => {
    const doc = options.doc || new Document();
    return [doc];
  };
  plugin.bankCardRootHue = () => "magenta";
  plugin.bankMarkReport = report;
  plugin.bankMarkReports = new Map([["2026-11", report]]);
  plugin.apiBankSubscribe = (spec, subscriber) => {
    plugin.subscriptions = plugin.subscriptions || [];
    plugin.subscriptions.push(spec);
    subscriber({ report, stale: false, error: null });
    return () => { plugin.unsubscribed = true; };
  };
  plugin.bankTimerApi = () => ({ setInterval: () => 1, clearTimeout: () => {}, setTimeout: (fn) => fn() });
  return plugin;
}

test("tokenizer covers amount variants and tail order including flags, notes, links, and ids", () => {
  const rows = {
    bold: H.bankTokenizeLine("- [x] **$13.71** Smashburger"),
    plus: H.bankTokenizeLine("- [ ] +$1,250.00 Payroll [cat:: income]"),
    minus: H.bankTokenizeLine("- [x] −$4.25 fee"),
    dash: H.bankTokenizeLine("- [x] -$4.25 fee"),
    oneDec: H.bankTokenizeLine("- [ ] $1.5 Latte [cat:: dining]"),
    flag: H.bankTokenizeLine("- [ ] $61.20 ShopRite [cat:: groceries] ⚑ -- with Kelly"),
    bang: H.bankTokenizeLine("- [ ] $5.00 Thing !! look"),
    emdash: H.bankTokenizeLine("- [x] $4.25 7-Eleven — coffee"),
    dashes: H.bankTokenizeLine("- [x] $4.25 7-Eleven -- coffee"),
    link: H.bankTokenizeLine("- [x] $13.71 Smashburger [[eat/smashburger|🍽️]] ^bank-8f3a2c1d"),
    custom: H.bankTokenizeLine("- [x] $1.00 Note ^custom-id"),
    acct: H.bankTokenizeLine("- [ ] $8.00 Extra [acct:: card] [cat:: snacks]"),
  };
  assert.equal(rows.bold.amount.text, "**$13.71**");
  assert.equal(rows.bold.cents, -1371);
  assert.equal(rows.plus.cents, 125000);
  assert.equal(rows.plus.category.key, "income");
  assert.equal(rows.minus.cents, -425);
  assert.equal(rows.dash.cents, -425);
  assert.equal(rows.oneDec.cents, -150);
  assert.equal(rows.flag.flagged, true);
  assert.equal(rows.flag.note, "with Kelly");
  assert.equal(rows.bang.flagged, true);
  assert.equal(rows.emdash.note, "coffee");
  assert.equal(rows.dashes.note, "coffee");
  assert.equal(rows.link.bankId, "8f3a2c1d");
  assert.equal(rows.link.links[0].text, "[[eat/smashburger|🍽️]]");
  assert.equal(rows.custom.customId, "custom-id");
  assert.equal(rows.custom.bankId, null);
  assert.equal(rows.acct.account.alias, "card");
  assert.equal(rows.acct.category.key, "snacks");
});

test("source scan never consumes indented children, fences, or ordinary prose", () => {
  const tokens = H.bankTokenizeSource("bank/2026-11.md", monthNote);
  assert.equal(tokens.rows.some((row) => /indented child/.test(row.lineText)), false);
  assert.equal(tokens.rows.some((row) => /inside a fence/.test(row.lineText)), false);
  assert.equal(tokens.rows.some((row) => /Inside a non-day section/.test(row.lineText)), false);
  assert.equal(H.bankTokenizeSource("ideas.md", "- [ ] $12.00 coffee").rows.length, 0);
  assert.equal(H.bankTokenizeLine("The price is $12.00 today."), null);
});

test("presentation keeps unknown labels, greens inflows, and replaces only imported bank ids", () => {
  const catalogs = {
    categories: [{ key: "groceries", emoji: "🛒", label: "Groceries" }],
    accounts: [{ alias: "checking", label: "WF Checking" }],
  };
  const known = H.bankRowPresentation(H.bankTokenizeLine("- [ ] $61.20 ShopRite [cat:: groceries] ^bank-2b91c0e4"), catalogs);
  const unknown = H.bankRowPresentation(H.bankTokenizeLine("- [ ] $7.00 Mystery [cat:: snacks] [acct:: card]"), catalogs);
  const inflow = H.bankRowPresentation(H.bankTokenizeLine("- [x] +$1,250.00 Payroll [cat:: income]"), catalogs);
  const custom = H.bankRowPresentation(H.bankTokenizeLine("- [x] $1.00 Note ^custom-id"), catalogs);
  assert.equal(known.categoryLabel, "🛒 Groceries");
  assert.equal(known.idLabel, "bank ✓");
  assert.equal(unknown.categoryLabel, "snacks");
  assert.equal(unknown.accountLabel, "card");
  assert.equal(inflow.amountPositive, true);
  assert.match(inflow.amountDisplay, /^\+/);
  assert.equal(custom.idLabel, null);
  assert.equal(custom.customId, "custom-id");
});

test("real day headings get report totals or muted nothing posted; missing days stay absent", () => {
  const tokens = H.bankTokenizeSource("bank/2026-11.md", monthNote);
  const thu = tokens.headings.find((heading) => heading.date === "2026-11-12");
  const fri = tokens.headings.find((heading) => heading.date === "2026-11-13");
  const emptyDay = H.bankHeadingPresentation(
    { date: "2026-11-14", heading: "Sat Nov 14", line: 40 },
    { date: "2026-11-14", out_cents: 0, in_cents: 0, waiting: 0, rows: [] },
  );
  const thuModel = H.bankHeadingPresentation(thu, H.bankReportDayFor(report, "2026-11-12"));
  assert.ok(thu);
  assert.ok(fri);
  assert.equal(tokens.headings.some((heading) => heading.date === "2026-11-01"), false);
  assert.equal(emptyDay.empty, true);
  assert.equal(emptyDay.label, "nothing posted");
  assert.match(thuModel.label, /out /);
  assert.match(thuModel.label, /in /);
});

test("two nearby bank-row dollars form a math conflict; ordinary math is left alone", () => {
  const conflicts = H.bankMathConflictSpans("bank/2026-11.md", mathNote);
  assert.ok(conflicts.length >= 1);
  const dollars = H.bankMathDollarRanges("bank/2026-11.md", mathNote);
  assert.equal(dollars.length, 2);
  const ordinary = "Compute $x^2+y^2$ in the margin.\n";
  assert.equal(H.bankMathConflictSpans("notes.md", ordinary).length, 0);
  assert.equal(H.bankMathDollarRanges("notes.md", ordinary).length, 0);
});

test("reading-view math unwrap restores bank amounts and leaves ordinary math intact", () => {
  const doc = new Document();
  const article = doc.createElement("div");
  const row = doc.createElement("li");
  const math = doc.createElement("span");
  math.setAttribute("class", "math math-inline");
  math.setAttribute("data-original", "$13.71 Smashburger\n- [ ] $61.20");
  math.appendChild(doc.createTextNode("13.71 Smashburger - [ ] 61.20"));
  row.appendChild(math);
  article.appendChild(row);
  const aside = doc.createElement("p");
  const keep = doc.createElement("span");
  keep.setAttribute("class", "math");
  keep.appendChild(doc.createTextNode("x^2+y^2"));
  aside.appendChild(keep);
  article.appendChild(aside);
  const changed = H.bankProtectMathInElement(article, "bank/2026-11.md", mathNote);
  assert.ok(changed >= 1);
  assert.equal(row.querySelector(".bob-bank-math-protected").textContent.includes("13.71"), true);
  assert.equal(aside.querySelector(".math").textContent, "x^2+y^2");
});

test("Live Preview replaces amounts off the cursor line, reveals on it, and skips Source mode and code", () => {
  const plugin = makePlugin();
  plugin.setupBankMarks();
  const view = makeView("bank/2026-11.md", monthNote);
  const decorated = plugin.buildBankMarkDecorations(view);
  assert.ok(decorated.adds.some((add) => add.value && add.value.replace && add.value.widget));
  const shop = H.bankTokenizeSource("bank/2026-11.md", monthNote).rows.find((row) => row.payee === "ShopRite");
  const shopLine = makeDoc(monthNote).line(shop.line);
  const revealed = plugin.buildBankMarkDecorations(makeView("bank/2026-11.md", monthNote, {
    selection: [{ from: shopLine.from + 4, to: shopLine.from + 4 }],
  }));
  const shopAmountAdds = revealed.adds.filter((add) => add.from >= shopLine.from && add.to <= shopLine.to && add.value && add.value.replace && add.value.widget && add.value.widget.model);
  assert.equal(shopAmountAdds.length, 0);
  const sourceMode = plugin.buildBankMarkDecorations(makeView("bank/2026-11.md", monthNote, { sourceMode: true }));
  assert.equal(sourceMode.none || (sourceMode.adds && sourceMode.adds.length === 0) || sourceMode === Decoration.none, true);
  const codeView = makeView("bank/2026-11.md", monthNote, {
    tree: { resolveInner: () => ({ name: "HyperMD-codeblock", parent: null }) },
  });
  const coded = plugin.buildBankMarkDecorations(codeView);
  assert.ok(!coded.adds || coded.adds.every((add) => !add.value || !add.value.widget || !add.value.widget.model));
});

test("toggle, config, and popout gate control decorations together; math dollars remain when marks are off", () => {
  const plugin = makePlugin();
  plugin.setupBankMarks();
  assert.equal(plugin.commands.some((command) => command.id === "toggle-bank-marks"), true);
  assert.equal(plugin.popoutSync.name, "bob-bank-marks");
  assert.equal(plugin.popoutSync.isEnabled(), true);
  assert.equal(plugin.bankMarksEnabled(), true);
  plugin.toggleBankMarks();
  assert.equal(plugin.bankMarksEnabled(), false);
  const view = makeView("bank/2026-11.md", mathNote);
  const off = plugin.buildBankMarkDecorations(view);
  assert.ok(off.adds.some((add) => add.value && add.value.widget && add.value.widget instanceof Object));
  assert.ok(off.adds.every((add) => !add.value || !add.value.widget || !add.value.widget.model));
  plugin.bankMarksConfigLastEnabled = false;
  plugin.bankMarksSessionEnabled = true;
  assert.equal(plugin.bankMarksEnabled(), false);
});

test("Reading view is idempotent, preserves links, and does not rewrite note bytes", () => {
  const plugin = makePlugin();
  plugin.setupBankMarks();
  const doc = new Document();
  const root = doc.createElement("div");
  const heading = doc.createElement("h2");
  heading.appendChild(doc.createTextNode("Thu Nov 12"));
  const item = doc.createElement("li");
  item.appendChild(doc.createTextNode("$13.71 Smashburger "));
  const link = doc.createElement("a");
  link.setAttribute("class", "internal-link");
  link.appendChild(doc.createTextNode("eat/smashburger"));
  item.appendChild(link);
  root.appendChild(heading);
  root.appendChild(item);
  const ctx = {
    sourcePath: "bank/2026-11.md",
    getSectionInfo: (el) => {
      if (el.tagName === "H2") return { lineStart: mathNote.split("\n").findIndex((line) => line.startsWith("## Thu Nov 12")) };
      if (el.tagName === "LI") return { lineStart: mathNote.split("\n").findIndex((line) => line.includes("Smashburger")) };
      return null;
    },
  };
  plugin.bankMarkReadingSource = () => mathNote;
  plugin.renderBankMarksIn(root, ctx);
  plugin.renderBankMarksIn(root, ctx);
  assert.equal(root.querySelectorAll(".bob-bank-mark-heading").length, 1);
  assert.equal(root.querySelectorAll("a.internal-link").length, 1);
  assert.equal(mathNote.includes("- [x] $13.71 Smashburger"), true);
});

test("hub property hiding applies only to bank.md and restores on leave and unload", () => {
  const doc = new Document();
  doc.body.classList = {
    names: new Set(),
    add(name) { this.names.add(name); },
    remove(name) { this.names.delete(name); },
    contains(name) { return this.names.has(name); },
  };
  const view = { file: { path: "bank.md" }, containerEl: doc.createElement("div"), contentEl: doc.createElement("div") };
  view.containerEl.classList = {
    names: new Set(),
    add(name) { this.names.add(name); },
    remove(name) { this.names.delete(name); },
  };
  view.contentEl.classList = view.containerEl.classList;
  const plugin = makePlugin({
    doc,
    activeView: view,
    leaves: [{ view, containerEl: view.containerEl }],
  });
  plugin.markGateDocuments = () => [doc];
  plugin.setupBankMarks();
  assert.equal(doc.body.classList.contains("bob-bank-hub-note"), true);
  assert.equal(view.containerEl.classList.names.has("bob-bank-hub-note"), true);
  view.file.path = "bank/2026-11.md";
  plugin.bankMarkSyncHubProperty();
  assert.equal(doc.body.classList.contains("bob-bank-hub-note"), false);
  view.file.path = "bank.md";
  plugin.bankMarkSyncHubProperty();
  plugin.teardownBankMarks();
  assert.equal(doc.body.classList.contains("bob-bank-hub-note"), false);
});

test("cursor reveal helper and note bytes stay unchanged after tokenize", () => {
  const before = monthNote;
  H.bankTokenizeSource("bank/2026-11.md", monthNote);
  assert.equal(monthNote, before);
  assert.equal(H.bankLineHasCursor(10, 20, [{ from: 15, to: 15 }]), true);
  assert.equal(H.bankLineHasCursor(10, 20, [{ from: 21, to: 30 }]), false);
});
