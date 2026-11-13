// Projects catalog cards: hued card, ring markers, live chips, Closed peek,
// nested children, copy/sync/retry, lifecycle, and notebook/album 🧩
// regressions. Mirrors the album catalog DOM/editor harness shape.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const util = require("node:util");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
  addCommand() {}
  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
  registerMarkdownCodeBlockProcessor() {}
  registerMarkdownPostProcessor(handler) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push(handler);
  }
  registerInterval(handle) {
    return handle;
  }
  registerDomEvent() {}
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const editorInfoField = { _projects: "info" };
const editorLivePreviewField = { _projects: "live" };

class StubWidgetType {
  eq(other) {
    return this === other;
  }
}

const widgetCalls = [];
const StubDecoration = {
  none: { none: true },
  widget: (args) => {
    widgetCalls.push(args);
    return { widget: args.widget, side: args.side, _widget: true };
  },
};

const StubStateEffect = {
  define: () => {
    const effect = {
      of: (value) => ({ effect, value }),
      is: (other) => other === effect,
    };
    return effect;
  },
};

class StubRangeSetBuilder {
  constructor() {
    this.ranges = [];
  }
  add(from, to, decoration) {
    this.ranges.push({ from, to, decoration });
  }
  finish() {
    return this.ranges;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      MarkdownRenderChild: class {
        constructor(el) {
          this.containerEl = el;
        }
      },
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      RangeSetBuilder: StubRangeSetBuilder,
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
      ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

function hide(node, fields) {
  for (const field of fields) {
    Object.defineProperty(node, field, { enumerable: false, configurable: true, writable: true });
  }
}

class FakeNode {
  constructor(tag, doc, nodeType) {
    this.tag = tag;
    this.tagName = tag ? String(tag).toUpperCase() : "";
    this.nodeName = this.tagName || "#text";
    this.nodeType = nodeType || 1;
    this.doc = doc;
    this.ownerDocument = doc;
    this.parentNode = null;
    this._childNodes = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = "";
    this.disabled = false;
    this.innerHTMLWrites = [];
    this.isConnected = true;
    hide(this, ["doc", "ownerDocument", "parentNode"]);
  }

  [util.inspect.custom]() {
    const cls = this.getAttribute("class");
    const kids = this._childNodes.length;
    const text = String(this.textContent || "").replace(/\s+/g, " ").slice(0, 40);
    const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
    return `FakeNode(${this.nodeName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }

  get children() {
    return this._childNodes.filter((node) => node.nodeType === 1);
  }

  get childNodes() {
    return this._childNodes;
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get classList() {
    const node = this;
    return {
      add(name) {
        const set = new Set(String(node.className || "").split(/\s+/).filter(Boolean));
        set.add(name);
        node.className = Array.from(set).join(" ");
      },
      contains(name) {
        return String(node.className || "").split(/\s+/).includes(name);
      },
    };
  }

  get textContent() {
    if (this.nodeType === 3) {
      return this._text;
    }
    return this._childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._text = String(value);
    if (this.nodeType === 1) {
      this._childNodes = [];
      if (this._text) {
        const text = new FakeNode("", this.doc, 3);
        text._text = this._text;
        text.parentNode = this;
        this._childNodes.push(text);
      }
    }
  }

  get nodeValue() {
    return this.nodeType === 3 ? this._text : null;
  }

  set nodeValue(value) {
    this._text = String(value);
  }

  get firstChild() {
    return this._childNodes[0] || null;
  }

  get previousSibling() {
    const parent = this.parentNode;
    if (!parent) {
      return null;
    }
    const at = parent._childNodes.indexOf(this);
    return at > 0 ? parent._childNodes[at - 1] || null : null;
  }

  get nextSibling() {
    const parent = this.parentNode;
    if (!parent) {
      return null;
    }
    const at = parent._childNodes.indexOf(this);
    return at >= 0 ? parent._childNodes[at + 1] || null : null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  appendChild(child) {
    if (child.parentNode && child.parentNode !== this) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this._childNodes.push(child);
    return child;
  }

  insertBefore(child, before) {
    // Real DOM moves an existing child; mirror that instead of duplicating it.
    const current = this._childNodes.indexOf(child);
    if (current !== -1) {
      this._childNodes.splice(current, 1);
    } else if (child.parentNode && child.parentNode !== this) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    const at = this._childNodes.indexOf(before);
    if (at === -1) {
      this._childNodes.push(child);
    } else {
      this._childNodes.splice(at, 0, child);
    }
    return child;
  }

  removeChild(child) {
    const at = this._childNodes.indexOf(child);
    if (at !== -1) {
      this._childNodes.splice(at, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  fire(type, extra = {}) {
    const event = {
      type,
      key: extra.key,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {},
      ...extra,
    };
    for (const handler of this.listeners.get(type) || []) {
      handler(event);
    }
    return event;
  }

  contains(node) {
    return node === this || this._childNodes.some((child) => child.contains(node));
  }

  focus() { this.ownerDocument.activeElement = this; }

  matches(selector) {
    return selectorParts(selector).some((part) => matchPart(this, part));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const parts = selectorParts(selector);
    const found = [];
    const walk = (node) => {
      if (node.nodeType === 1 && parts.some((part) => matchPart(node, part))) {
        found.push(node);
      }
      for (const child of node._childNodes || []) {
        walk(child);
      }
    };
    for (const child of this._childNodes) {
      walk(child);
    }
    return found;
  }

  set innerHTML(value) {
    this.innerHTMLWrites.push(String(value));
    this.textContent = String(value);
  }

  get innerHTML() {
    return this.textContent;
  }
}

function selectorParts(selector) {
  return String(selector).split(",").map((part) => part.trim()).filter(Boolean);
}

function matchPart(node, selector) {
  let rest = selector;
  let tag = "*";
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tagMatch) {
    tag = tagMatch[0].toUpperCase();
    rest = rest.slice(tagMatch[0].length);
  }
  const classes = [];
  const attrs = [];
  const classRe = /^\.([\w-]+)/;
  const attrRe = /^\[([^\]]+)\]/;
  while (rest) {
    const cls = classRe.exec(rest);
    if (cls) {
      classes.push(cls[1]);
      rest = rest.slice(cls[0].length);
      continue;
    }
    const attr = attrRe.exec(rest);
    if (attr) {
      const body = attr[1];
      const eq = body.indexOf("=");
      if (eq === -1) {
        attrs.push({ name: body, value: null });
      } else {
        attrs.push({
          name: body.slice(0, eq),
          value: body.slice(eq + 1).replace(/^["']|["']$/g, ""),
        });
      }
      rest = rest.slice(attr[0].length);
      continue;
    }
    return false;
  }
  if (tag !== "*" && node.tagName !== tag) {
    return false;
  }
  const className = String(node.getAttribute("class") || "");
  for (const name of classes) {
    if (!className.split(/\s+/).includes(name)) {
      return false;
    }
  }
  for (const attr of attrs) {
    const actual = node.getAttribute(attr.name);
    if (attr.value === null) {
      if (actual === null) {
        return false;
      }
    } else if (actual !== attr.value) {
      return false;
    }
  }
  return true;
}

function makeDoc() {
  const doc = {
    nodes: [],
    createElement(tag) {
      const node = new FakeNode(tag, doc, 1);
      doc.nodes.push(node);
      return node;
    },
    createTextNode(text) {
      const node = new FakeNode("", doc, 3);
      node._text = String(text);
      doc.nodes.push(node);
      return node;
    },
  };
  return doc;
}

function el(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "className" || name === "class") {
      node.className = value;
    } else if (name === "text") {
      node.appendChild(doc.createTextNode(value));
    } else {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    if (typeof child === "string") {
      node.appendChild(doc.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function makeEditorView({ text, live = true, path = "body.md", dom = null }) {
  const lines = String(text).split("\n");
  let offset = 0;
  const lineObjs = lines.map((line, index) => {
    const from = offset;
    const to = from + line.length;
    offset = to + 1;
    return { from, to, text: line, number: index + 1 };
  });
  return {
    state: {
      field(field) {
        if (field === editorLivePreviewField) {
          return live;
        }
        if (field === editorInfoField) {
          return { file: { path } };
        }
        return null;
      },
      doc: {
        lines: lineObjs.length,
        toString: () => String(text),
        line(number) {
          return lineObjs[number - 1];
        },
      },
    },
    dom,
  };
}

function project(overrides = {}) {
  return {
    path: "alpha.md", stem: "alpha", status: "wip", state: "open",
    criterion: "Ship the alpha outcome.", parent: "body.md", children: ["alpha/kid.md"],
    closed_on: null, prj: { line: 6, mark: " ", hidden: true, scheduled: null },
    blocked: null, tasks: { open: 3, shown: 1, today: 1 }, ...overrides,
  };
}

function catalog(overrides = {}) {
  return {
    host: "body", path: "body.md", kind: "area", state: "current",
    rows: { open: 6, blocked: 2, warning: 1, closed: 3 }, issues: [], ...overrides,
  };
}

function projects() {
  return [
    project(),
    project({ path: "alpha/kid.md", stem: "kid", criterion: "A nested child.", parent: "alpha.md", children: [], tasks: { open: 1, shown: 0, today: 0 } }),
    project({ path: "beta.md", stem: "beta", state: "scheduled", criterion: "Ship the deck pipeline.", parent: "body.md", children: [],
      prj: { line: 7, mark: " ", hidden: true, scheduled: "2026-12-08" },
      blocked: { kind: "scheduled", date: "2026-12-08" }, tasks: { open: 1, shown: 0, today: 0 } }),
    project({ path: "gamma.md", stem: "gamma", state: "blocked", criterion: "Plan the launch.", parent: "body.md", children: [],
      prj: { line: 6, mark: "?", hidden: true, scheduled: null },
      blocked: { kind: "dependency", waits_on: ["delta#^ship"] }, tasks: { open: 2, shown: 0, today: null } }),
    project({ path: "delta.md", stem: "delta", criterion: null, parent: "body.md", children: [], tasks: { open: null, shown: null, today: null } }),
    project({ path: "eps.md", stem: "eps", state: "warning", criterion: "Risky bet.", parent: "body.md", children: [], tasks: { open: 0, shown: 0, today: 0 } }),
    project({ path: "other/alpha.md", stem: "alpha", criterion: "The other alpha.", parent: "body.md", children: [], tasks: { open: 1, shown: 1, today: 0 } }),
    project({ path: "zeta.md", stem: "zeta", status: "done", state: "done", criterion: null, parent: "body.md", children: [],
      closed_on: "2026-11-10", prj: { line: null, mark: null, hidden: null, scheduled: null }, tasks: { open: 0, shown: 0, today: 0 } }),
    project({ path: "eta.md", stem: "eta", status: "done", state: "done", criterion: null, parent: "body.md", children: [],
      closed_on: "2026-11-12", prj: { line: null, mark: null, hidden: null, scheduled: null }, tasks: { open: 0, shown: 0, today: 0 } }),
    project({ path: "theta.md", stem: "theta", status: "canceled", state: "canceled", criterion: "Dropped.", parent: "body.md", children: [],
      closed_on: null, prj: { line: null, mark: null, hidden: null, scheduled: null }, tasks: { open: 0, shown: 0, today: 0 } }),
  ];
}

function report(rows = projects(), host = catalog(), extra = {}) {
  const decoded = helpers.projectsDecodeListReport(JSON.stringify({
    schema_version: 1, ok: true, command: "list", today: "2026-11-12",
    projects: rows, catalogs: [host], findings: [],
    counts: { projects: rows.length, catalogs: 1, errors: 0, warnings: 0 }, ...extra,
  }));
  assert.equal(decoded.ok, true);
  return decoded.report;
}

const FILES = ["body.md", "alpha.md", "alpha/kid.md", "beta.md", "gamma.md", "delta.md",
  "eps.md", "zeta.md", "eta.md", "theta.md", "orphan.md", "other/alpha.md", "project.md"];

function fixture(options = {}) {
  const doc = makeDoc();
  const row = (target, title = "Same title", tail = " — Stored criterion text.") => el(doc, "li", {}, [
    el(doc, "strong", {}, [el(doc, "a", { class: "internal-link", "data-href": target }, [title])]), tail]);
  const first = row("Alias", "Alpha");
  const kid = row("alpha/kid", "Kid");
  const group = el(doc, "li", {}, ["🧩 ", el(doc, "a", { class: "internal-link", "data-href": "project" }, ["Project"]), el(doc, "ul", {}, [kid])]);
  const ordinary = row("other/delta", "Delta");
  const dup = row("other/alpha", "Other alpha");
  const callout = el(doc, "div", { class: "callout", "data-callout": "projects" }, [
    el(doc, "div", { class: "callout-title" }, ["Projects"]),
    el(doc, "div", { class: "callout-content" }, [el(doc, "ul", {}, [first, group, ordinary, dup])])]);
  const albums = el(doc, "div", { class: "callout", "data-callout": "albums" }, [
    el(doc, "div", { class: "callout-title" }, ["Albums"]),
    el(doc, "div", { class: "callout-content" }, [
      el(doc, "ul", {}, [el(doc, "li", {}, ["🧩 ", el(doc, "a", { class: "internal-link", "data-href": "project" }, ["Project"])])])])]);
  const root = el(doc, "div", {}, [callout, albums]);
  const files = new Map(FILES.map((file) => [file, { path: file }]));
  let state = {
    report: report(), today: "2026-11-12", stale: false, refreshing: false,
    syncBusy: false, errorModel: null, syncErrorModel: null, ...options.state,
  };
  const writes = [];
  const app = {
    vault: {
      getAbstractFileByPath: (filePath) => files.get(filePath),
      cachedRead: async () => "",
      modify: (...args) => writes.push(args),
      process: (...args) => writes.push(args),
    },
    metadataCache: {
      getFirstLinkpathDest: (target, from) => {
        assert.equal(from, "body.md");
        if (target === "Alias") {
          return files.get("alpha.md");
        }
        return files.get(`${target}.md`);
      },
      getFileCache: (file) => ({ headings: [{ level: 1, heading: `H1 for ${file.path}` }] }),
    },
    workspace: {},
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.projectsCatalogActive = true;
  plugin.projectsCatalogReading = new Set();
  plugin.projectsCatalogEditors = new Set();
  plugin.projectsCatalogFoldByView = new WeakMap();
  plugin.projectsReportState = () => state;
  plugin.apiProjectsReport = () => { plugin.retries = (plugin.retries || 0) + 1; return Promise.resolve(state); };
  plugin.apiProjectsSync = () => { plugin.syncs = (plugin.syncs || 0) + 1; return Promise.resolve({ ok: true }); };
  plugin.apiProjectsSubscribe = () => () => {};
  return { doc, root, callout, first, kid, group, ordinary, dup, plugin, app, writes,
    state: () => state, setState: (next) => { state = { ...state, ...next }; } };
}

const chips = (node) => node.querySelectorAll(".bob-projects-chips");

test("all six states map to ring or glyph markers, unknowns stay visible", () => {
  assert.deepEqual(helpers.projectsCardMarker({ state: "open" }), { kind: "ring", glyph: "", label: "open" });
  assert.deepEqual(helpers.projectsCardMarker({ state: "scheduled" }), { kind: "glyph", glyph: "◷", label: "scheduled" });
  assert.deepEqual(helpers.projectsCardMarker({ state: "blocked" }), { kind: "glyph", glyph: "⛓", label: "blocked" });
  assert.deepEqual(helpers.projectsCardMarker({ state: "warning" }), { kind: "glyph", glyph: "⚠", label: "warning" });
  assert.deepEqual(helpers.projectsCardMarker({ state: "done" }), { kind: "glyph", glyph: "✓", label: "done" });
  assert.deepEqual(helpers.projectsCardMarker({ state: "canceled" }), { kind: "glyph", glyph: "✕", label: "canceled" });
  assert.equal(helpers.projectsCardMarker({ state: "mystery" }).kind, "unknown");
  assert.equal(helpers.projectsCardMarker(null).kind, "unknown");
  // A future report state the decoder does not know yet must stay visible in
  // the open lane rather than vanishing or closing.
  const rep = report();
  const mystery = project({ path: "orphan.md", stem: "orphan", state: "mystery", criterion: "Unknown state.", children: [] });
  rep.projects.push(mystery);
  rep.projectsByPath.set("orphan.md", mystery);
  const partition = helpers.projectsCardPartition(helpers.projectsCardRowEntries({ report: rep }, "body.md"));
  assert.ok(partition.open.some((entry) => entry.path === "orphan.md"));
  assert.ok(!partition.closed.some((entry) => entry.path === "orphan.md"));
});

test("tally counts blocked as a subset of open, never added twice", () => {
  const partition = helpers.projectsCardPartition(helpers.projectsCardRowEntries({ report: report() }, "body.md"));
  assert.equal(partition.open.length, 6);
  assert.equal(partition.closed.length, 3);
  const tally = helpers.projectsCardTally(partition);
  assert.equal(tally.full, "6 open · 2 blocked · 3 closed");
  assert.equal(tally.short, "6·2·3");
  assert.match(tally.hint, /6 open projects, 2 blocked, 3 closed/);
});

test("open rows sort by stem with path tiebreak, closed newest first then undated", () => {
  const partition = helpers.projectsCardPartition(helpers.projectsCardRowEntries({ report: report() }, "body.md"));
  const stems = partition.open.map((entry) => `${entry.stem}:${entry.path}`);
  assert.deepEqual(stems.slice(0, 2), ["alpha:alpha.md", "alpha:other/alpha.md"]);
  assert.deepEqual(partition.closed.map((entry) => entry.path), ["eta.md", "zeta.md", "theta.md"]);
});

test("blocked reasons render scheduled dates, waits-on stems, and parent blocks", () => {
  assert.deepEqual(helpers.projectsCardBlockedReason(project({ state: "scheduled", blocked: { kind: "scheduled", date: "2026-12-08" } }), "2026-11-12"),
    { text: "Dec 8 · in 3w", hint: "Scheduled 2026-12-08 (in 3w)." });
  assert.deepEqual(helpers.projectsCardBlockedReason(project({ blocked: { kind: "scheduled", date: "2026-11-12" } }), "2026-11-12"),
    { text: "Nov 12 · today", hint: "Scheduled 2026-11-12 (today)." });
  assert.deepEqual(helpers.projectsCardBlockedReason(project({ blocked: { kind: "dependency", waits_on: ["delta#^ship"] } }), "2026-11-12"),
    { text: "waits on delta", hint: "Blocked on delta." });
  assert.deepEqual(helpers.projectsCardBlockedReason(project({ blocked: { kind: "inherited" } }), "2026-11-12"),
    { text: "parent blocked", hint: "Blocked because its parent project is blocked." });
  assert.equal(helpers.projectsCardBlockedReason(project(), "2026-11-12"), null);
  assert.equal(helpers.projectsCardBlockedReason(project({ blocked: { kind: "scheduled", date: "not-a-date" } }), "2026-11-12").text, "scheduled");
  assert.equal(helpers.projectsCardRelativeDay("2026-11-01", "2026-11-12"), "11d overdue");
  assert.equal(helpers.projectsCardRelativeDay("2026-10-01", "2026-11-12"), "6w overdue");
  assert.equal(helpers.projectsCardRelativeDay("2026-11-13", "2026-11-12"), "in 1d");
  assert.equal(helpers.projectsCardRelativeDay("bad", "2026-11-12"), "");
});

test("chips omit unknown fields and empty shows only for explicitly visible rows", () => {
  const open = helpers.projectsCardChips(project(), "2026-11-12").map((chip) => chip.text);
  assert.deepEqual(open, ["3 tasks", "● today"]);
  const unknown = helpers.projectsCardChips(project({ tasks: { open: null, shown: null, today: null } }), "2026-11-12");
  assert.deepEqual(unknown, []);
  const hidden = helpers.projectsCardChips(project({ tasks: { open: 0, shown: 0, today: 0 }, prj: { line: 6, mark: " ", hidden: false, scheduled: null } }), "2026-11-12");
  assert.ok(hidden.some((chip) => chip.text === "empty"));
  const reasoned = helpers.projectsCardChips(project({ blocked: { kind: "inherited" }, tasks: { open: null, shown: null, today: null } }), "2026-11-12");
  assert.deepEqual(reasoned.map((chip) => chip.text), ["parent blocked"]);
});

test("copy text uses the catalog host identity, header model tracks catalog health", () => {
  assert.equal(helpers.projectsCardCopyText(catalog(), "body.md"), "@body^");
  assert.equal(helpers.projectsCardCopyText(catalog({ host: "" }), "body.md"), "@body^");
  assert.equal(helpers.projectsCardCopyText(null, ""), "");
  assert.equal(helpers.projectsCardHealthModel(catalog()), null);
  assert.equal(helpers.projectsCardHealthModel(catalog({ state: "missing" })).repairable, true);
  assert.equal(helpers.projectsCardHealthModel(catalog({ state: "damaged", issues: [{ code: "x", message: "Broken" }] })).repairable, false);
  assert.match(helpers.projectsCardHealthModel(catalog({ state: "damaged", issues: [{ path: "body.md", line: 4, message: "Broken" }] })).hint, /body\.md:4: Broken/);
  assert.equal(helpers.projectsCardIsClosedFolded(new Map(), "body.md"), true);
  assert.equal(helpers.projectsCardIsClosedFolded(new Map([["closed:body.md", false]]), "body.md"), false);
  assert.equal(helpers.projectsCardIsChildExpanded(new Map(), "body.md", "alpha.md"), false);
  assert.equal(helpers.projectsCardIsChildExpanded(new Map([["child:body.md:alpha.md", true]]), "body.md", "alpha.md"), true);
});

test("source scan and anchor line ignore YAML, fences, and non-projects callouts", () => {
  const examples = ["---", "example: |", "  > [!projects]", "---", "````md",
    "> [!projects]", "> - **[[alpha|Alpha]]**", "```", "> [!projects]", "````",
    "> [!albums]", "> - **[[eat|Eat]]**"].join("\n");
  assert.equal(helpers.projectsCardSourceRegions(examples).length, 0);
  const combined = `${examples}\n> [!projects]\n> - **[[alpha|Alpha]]** — Ship it.`;
  const regions = helpers.projectsCardSourceRegions(combined);
  assert.equal(regions.length, 1);
  assert.equal(combined.split("\n")[regions[0].begin], "> [!projects]");
  const withHeading = "# Body\n\n## Projects\n\n> [!projects]";
  assert.equal(helpers.projectsCardAnchorLine(withHeading), 2);
  assert.equal(helpers.projectsCardAnchorLine("# Body\n\ntext"), 0);
  assert.equal(helpers.projectsCardAnchorLine(""), 0);
});

test("Reading cards match aliases and paths, skip group rows and unrelated stems", () => {
  const f = fixture();
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map());
  assert.equal(chips(f.first).length, 1);
  assert.equal(chips(f.kid).length, 1);
  assert.equal(chips(f.dup).length, 1);
  assert.equal(f.group.children.filter((node) => node.className === "bob-projects-chips").length, 0);
  assert.equal(chips(f.ordinary).length, 0);
  assert.equal(f.root.querySelectorAll(".bob-projects-chips").length, 3);
  assert.match(f.first.textContent, /3 tasks/);
  assert.match(f.first.textContent, /today/);
  assert.equal(f.first.querySelector("a").getAttribute("data-href"), "Alias");
  assert.equal(f.first.querySelector("a").getAttribute("title"), "H1 for alpha.md");
  assert.equal(f.first.querySelector("a").listeners.get("click"), undefined);
  const criterion = f.first.querySelector(".bob-projects-criterion");
  assert.equal(criterion.textContent, " — Stored criterion text.");
  assert.equal(criterion.getAttribute("title"), "— Stored criterion text.");
  assert.equal(criterion.getAttribute("tabindex"), "0");
  assert.equal(f.callout.getAttribute("data-bob-projects-card"), "true");
  assert.equal(f.callout.getAttribute("data-stale"), null);
  const header = f.callout.querySelector(".bob-projects-header");
  assert.equal(header.getAttribute("role"), "heading");
  assert.match(header.textContent, /Projects/);
  assert.match(header.querySelector(".bob-projects-tally-full").textContent, /6 open · 2 blocked · 3 closed/);
  assert.equal(header.querySelector(".bob-projects-tally-short").getAttribute("aria-label"), header.querySelector(".bob-projects-tally-full").getAttribute("aria-label"));
  f.plugin.apiProjectsCopyStarter = (sourcePath) => { f.plugin.copied = sourcePath; return Promise.resolve({ ok: true }); };
  const copy = f.callout.querySelector(".bob-projects-copy");
  assert.equal(copy.textContent, "＋ project");
  copy.fire("click");
  assert.equal(f.plugin.copied, "body.md");
  assert.equal(f.callout.querySelector(".callout-content").firstChild.className, "bob-projects-header");
  assert.equal(f.writes.length, 0);
  assert.ok(f.doc.nodes.every((node) => node.innerHTMLWrites.length === 0));
  assert.equal(f.root.querySelectorAll(".bob-projects-chips").length, 3);
});

test("duplicate stems keep path identity and album groups stay unpainted", () => {
  const f = fixture();
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map());
  assert.equal(f.dup.querySelector(".bob-projects-marker").getAttribute("data-state"), "open");
  assert.match(f.dup.textContent, /1 tasks/);
  assert.doesNotMatch(f.dup.textContent, /today/);
  assert.equal(f.root.querySelectorAll('[data-callout="albums"] .bob-projects-chips').length, 0);
  assert.equal(f.root.querySelectorAll('[data-callout="albums"] .bob-projects-criterion').length, 0);
  assert.equal(f.root.querySelectorAll('[data-callout="albums"] .bob-projects-header').length, 0);
});

test("repaint preserves keyboard focus and restores it across fold changes", () => {
  const f = fixture();
  f.plugin.renderProjectsCatalogInReading(f.root, { sourcePath: "body.md", addChild() {} });
  const folds = Array.from(f.plugin.projectsCatalogReading).find((widget) => widget.el === f.root).folds;
  const toggle = f.first.querySelector(".bob-projects-children-toggle");
  assert.match(toggle.textContent, /▸ 1/);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.focus();
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", folds, false);
  assert.equal(f.first.querySelector(".bob-projects-children-toggle"), toggle);
  assert.equal(toggle.listeners.get("click").length, 1);
  assert.equal(f.doc.activeElement, toggle);
  toggle.fire("click");
  const expanded = f.first.querySelector(".bob-projects-children-toggle");
  assert.notEqual(expanded, toggle);
  assert.match(expanded.textContent, /▾ 1/);
  assert.equal(expanded.getAttribute("aria-expanded"), "true");
  assert.equal(f.doc.activeElement, expanded);
  const kids = f.first.querySelectorAll(".bob-projects-mini");
  assert.equal(kids.length, 1);
  assert.equal(kids[0].querySelector("a").getAttribute("data-href"), "alpha/kid.md");
  assert.equal(kids[0].querySelectorAll("button").length, 0);
  assert.equal(f.writes.length, 0);
});

test("unavailable, stale, missing, damaged, and refused reports keep distinct feedback", () => {
  const f = fixture({ state: { report: null, errorModel: { hint: "bob missing" } } });
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map(), false);
  assert.equal(chips(f.root).length, 0);
  assert.match(f.root.textContent, /bob missing/);
  f.root.querySelector(".bob-projects-action").fire("click");
  assert.equal(f.plugin.retries, 1);
  f.setState({ report: report(), errorModel: null, stale: true });
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map(), false);
  assert.equal(chips(f.first).length, 1);
  assert.equal(f.callout.getAttribute("data-stale"), "true");
  f.setState({ report: report(projects(), catalog({ state: "missing" })), stale: false });
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map(), false);
  assert.equal(f.root.querySelectorAll(".bob-projects-action").length, 1);
  assert.match(f.root.querySelector(".bob-projects-action").textContent, /↻ sync/);
  f.root.querySelector(".bob-projects-action").fire("keydown", { key: "Enter" });
  assert.equal(f.plugin.syncs, 1);
  f.root.querySelector(".bob-projects-action").fire("click");
  assert.equal(f.plugin.syncs, 2);
  f.setState({ report: report(projects(), catalog({ state: "damaged", issues: [{ code: "duplicate-heading", severity: "error", path: "body.md", line: 9, message: "Duplicate Projects headings" }] })), stale: false });
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map(), false);
  assert.match(f.root.textContent, /Duplicate Projects headings/);
  assert.equal(f.root.querySelector(".bob-projects-action"), null);
  f.setState({ report: report(projects(), catalog(), { ok: false, findings: [{ code: "skipped", message: "Note skipped" }] }), stale: false });
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map(), false);
  assert.equal(chips(f.first).length, 1);
  assert.match(f.root.textContent, /Findings: Note skipped/);
  f.setState({ syncBusy: true });
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", new Map(), false);
  const button = f.root.querySelector(".bob-projects-action");
  assert.equal(button.disabled, true);
  button.fire("click");
  button.fire("keydown", { key: " " });
  assert.equal(f.plugin.syncs, 2);
  assert.equal(f.writes.length, 0);
});

test("Closed group defaults folded with a two-row peek and keyboard toggles", () => {
  const f = fixture();
  f.plugin.renderProjectsCatalogInReading(f.root, { sourcePath: "body.md", addChild() {} });
  const closed = f.callout.querySelector(".bob-projects-closed");
  assert.ok(closed);
  const button = closed.querySelector(".bob-projects-closed-toggle");
  assert.equal(button.textContent, "Closed · 3");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  const peek = closed.querySelectorAll(".bob-projects-mini");
  assert.equal(peek.length, 2);
  assert.equal(peek[0].querySelector("a").getAttribute("data-href"), "eta.md");
  assert.equal(peek[1].querySelector("a").getAttribute("data-href"), "zeta.md");
  assert.match(peek[0].textContent, /✓/);
  button.fire("keydown", { key: " " });
  const opened = f.callout.querySelectorAll(".bob-projects-mini");
  assert.equal(opened.length, 3);
  assert.equal(f.callout.querySelector(".bob-projects-closed-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(f.writes.length, 0);
});

test("two panes stay independent and folds survive refresh and remount", () => {
  const f = fixture();
  const second = fixture();
  const children = [];
  f.plugin.renderProjectsCatalogInReading(f.root, { sourcePath: "body.md", addChild: (child) => children.push(child) });
  f.plugin.renderProjectsCatalogInReading(second.root, { sourcePath: "body.md", addChild: (child) => children.push(child) });
  assert.equal(f.plugin.projectsCatalogReading.size, 2);
  f.root.querySelector(".bob-projects-closed-toggle").fire("click");
  assert.equal(f.root.querySelectorAll(".bob-projects-mini").length, 3);
  assert.equal(second.root.querySelectorAll(".bob-projects-mini").length, 2);
  const folds = Array.from(f.plugin.projectsCatalogReading).find((widget) => widget.el === f.root).folds;
  f.plugin.paintProjectsCatalogReading(f.root, "body.md", folds, true);
  assert.equal(f.root.querySelectorAll(".bob-projects-mini").length, 3);
  assert.equal(f.root.querySelector(".bob-projects-closed-toggle").getAttribute("aria-expanded"), "true");
  children[0].onunload();
  assert.equal(chips(f.root).length, 0);
  assert.equal(chips(second.root).length, 3);
  assert.equal(f.callout.getAttribute("data-bob-projects-card"), null);
  assert.match(f.first.textContent, /Stored criterion text/);
  assert.equal(f.first.querySelector(".bob-projects-criterion"), null);
  f.plugin.teardownProjectsCatalog();
  assert.equal(chips(second.root).length, 0);
  assert.equal(f.plugin.projectsCatalogReading.size, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(second.writes.length, 0);
});

test("Live Preview paints callouts, leaves source text intact, and gates Source mode", () => {
  const f = fixture();
  const text = "# Body\n\n> [!projects]\n> - **[[alpha|Alpha]]** — Stored.";
  const view = makeEditorView({ text, path: "body.md", dom: f.root });
  f.plugin.paintProjectsCatalogEditor(view);
  assert.equal(chips(f.root).length, 3);
  assert.equal(view.state.doc.toString(), text);
  assert.equal(f.plugin.buildProjectsCatalogDecorations(view), StubDecoration.none);
  const sourceView = makeEditorView({ text, live: false, path: "body.md", dom: f.root });
  f.plugin.paintProjectsCatalogEditor(sourceView);
  assert.equal(chips(f.root).length, 0);
  assert.equal(f.plugin.buildProjectsCatalogDecorations(sourceView), StubDecoration.none);
  assert.equal(f.writes.length, 0);
});

test("Live Preview missing-catalog action is a widget outside frontmatter", () => {
  const f = fixture({ state: { report: report(projects(), catalog({ state: "missing" })) } });
  const text = '---\ntype: "[[area]]"\n---\n# Body\n';
  const view = makeEditorView({ text, path: "body.md", dom: f.root });
  const ranges = f.plugin.buildProjectsCatalogDecorations(view);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].from > text.indexOf("# Body"));
  assert.equal(f.plugin.buildProjectsCatalogDecorations(makeEditorView({ text, live: false, path: "body.md" })), StubDecoration.none);
});

test("Live Preview skips embeds and refresh extension cleans file switches", () => {
  const f = fixture();
  const timers = new Map();
  let next = 0;
  f.plugin.projectsSetTimeout = (callback) => { timers.set(++next, callback); return next; };
  f.plugin.projectsClearTimeout = (id) => { timers.delete(id); };
  const text = "> [!projects]\n> - **[[alpha|Alpha]]**";
  const view = makeEditorView({ text, path: "body.md", dom: f.root });
  const extension = f.plugin.createProjectsCatalogExtension();
  const instance = new extension.cls(view);
  assert.equal(chips(f.root).length, 0);
  const flush = () => { const work = Array.from(timers.values()); timers.clear(); for (const callback of work) callback(); };
  flush();
  assert.equal(chips(f.root).length, 3);
  const toggle = f.first.querySelector(".bob-projects-children-toggle");
  toggle.focus();
  instance.update({ view, transactions: [], docChanged: false });
  flush();
  assert.equal(f.doc.activeElement, toggle);
  const sourceView = makeEditorView({ text, path: "body.md", live: false, dom: f.root });
  view.state = sourceView.state;
  instance.update({ view, transactions: [], docChanged: true });
  flush();
  assert.equal(chips(f.root).length, 0);
  instance.destroy();
  assert.equal(f.plugin.projectsCatalogEditors.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(view.state.doc.toString(), text);
  assert.equal(f.writes.length, 0);
});

test("missing catalogs anchor at headings with sync, damaged stays diagnostic", () => {
  const f = fixture({ state: { report: report([], catalog({ state: "missing" })) } });
  const body = el(f.doc, "div", {}, [el(f.doc, "p", {}, ["Owner without H1"])]);
  f.plugin.paintProjectsCatalogReading(body, "body.md", new Map());
  assert.equal(body.querySelectorAll(".bob-projects-anchor").length, 1);
  body.querySelector(".bob-projects-action").fire("click");
  assert.equal(f.plugin.syncs, 1);
  f.plugin.paintProjectsCatalogReading(body, "body.md", new Map());
  assert.equal(body.querySelectorAll(".bob-projects-action").length, 1);
  f.setState({ report: report([], catalog({ state: "damaged", issues: [{ code: "duplicate-heading", severity: "error", message: "Duplicate Projects headings" }] })) });
  f.plugin.paintProjectsCatalogReading(body, "body.md", new Map());
  assert.match(body.textContent, /Duplicate Projects headings/);
  assert.equal(body.querySelector(".bob-projects-action"), null);
  f.setState({ report: report([], catalog()) });
  f.plugin.paintProjectsCatalogReading(body, "body.md", new Map());
  assert.equal(body.querySelector(".bob-projects-anchor"), null);
  assert.equal(body.querySelector(".bob-projects-header"), null);
});

test("all-closed hosts show header and group, empty hosts show no card", () => {
  const closedOnly = projects().filter((entry) => ["done", "canceled"].includes(entry.state));
  const f = fixture({ state: { report: report(closedOnly, catalog()) } });
  const body = el(f.doc, "div", {}, [el(f.doc, "h1", {}, ["Body"])]);
  f.plugin.paintProjectsCatalogReading(body, "body.md", new Map());
  assert.match(body.querySelector(".bob-projects-tally-full").textContent, /0 open · 0 blocked · 3 closed/);
  assert.equal(body.querySelector(".bob-projects-closed-toggle").textContent, "Closed · 3");
  assert.equal(body.querySelectorAll(".bob-projects-mini").length, 2);
  assert.equal(body.querySelector(".bob-projects-action"), null);
  const empty = fixture({ state: { report: report([], catalog()) } });
  const bare = el(empty.doc, "div", {}, [el(empty.doc, "p", {}, ["Nothing here"])]);
  empty.plugin.paintProjectsCatalogReading(bare, "body.md", new Map());
  assert.equal(bare.querySelector(".bob-projects-header"), null);
  assert.equal(bare.querySelector(".bob-projects-action"), null);
});

test("missing-catalog controls occur only in the selected source section", () => {
  const f = fixture({ state: { report: report([], catalog({ state: "missing" })) } });
  const text = "# Body\n\nIntro.\n\n## Projects\n\nOther paragraph.";
  const title = el(f.doc, "div", {}, [el(f.doc, "h1", {}, ["Body"])]);
  const heading = el(f.doc, "div", {}, [el(f.doc, "h2", {}, ["Projects"])]);
  const paragraph = el(f.doc, "div", {}, [el(f.doc, "p", {}, ["Other paragraph."])]);
  for (const [node, line] of [[title, 0], [heading, 4], [paragraph, 6]]) {
    f.plugin.renderProjectsCatalogInReading(node, { sourcePath: "body.md",
      getSectionInfo: () => ({ text, lineStart: line, lineEnd: line }), addChild() {} });
  }
  assert.equal(title.querySelector(".bob-projects-action"), null);
  assert.equal(paragraph.querySelector(".bob-projects-action"), null);
  assert.equal(heading.querySelectorAll(".bob-projects-action").length, 1);
});

test("copy starter writes @host^ and reports clipboard failures", async () => {
  const f = fixture();
  const copied = [];
  // Node ships a getter-only navigator without a clipboard; define the stub
  // explicitly instead of assigning to the accessor.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (value) => { copied.push(value); } } },
    configurable: true,
  });
  try {
    const result = await f.plugin.apiProjectsCopyStarter("body.md");
    assert.equal(result.value, "@body^");
    assert.deepEqual(copied, ["@body^"]);
    assert.match(TestNotice.messages.at(-1), /Copied @body\^/);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    } else {
      delete globalThis.navigator;
    }
  }
  const failed = await f.plugin.apiProjectsCopyStarter("body.md");
  assert.equal(failed.reason, "clipboard is unavailable");
  assert.equal(f.writes.length, 0);
});

test("Reading ignores CodeMirror chrome and setup refreshes both surfaces", () => {
  const f = fixture();
  const frame = el(f.doc, "div", { class: "cm-editor" }, [f.root]);
  void frame;
  const inner = f.root;
  let subscriber = null;
  f.plugin.apiProjectsSubscribe = (fn) => { subscriber = fn; return () => { subscriber = null; }; };
  const timers = new Map();
  let next = 0;
  f.plugin.projectsSetTimeout = (callback) => { timers.set(++next, callback); return next; };
  f.plugin.projectsClearTimeout = (id) => { timers.delete(id); };
  const registered = f.plugin.postProcessors ? f.plugin.postProcessors.length : 0;
  f.plugin.setupProjectsCatalog();
  assert.ok(subscriber);
  assert.equal(f.plugin.postProcessors.length, registered + 1);
  const found = [];
  f.plugin.renderProjectsCatalogInReading(inner, { sourcePath: "body.md", addChild: (child) => found.push(child) });
  assert.equal(chips(inner).length, 0);
  assert.equal(f.plugin.projectsCatalogReading.size, 0);
  const flush = () => { const work = Array.from(timers.values()); timers.clear(); for (const callback of work) callback(); };
  subscriber();
  subscriber();
  assert.equal(timers.size, 1);
  flush();
  f.plugin.teardownProjectsCatalog();
  assert.equal(subscriber, null);
  assert.equal(f.plugin.projectsCatalogReading.size, 0);
  assert.equal(f.writes.length, 0);
});

test("CSS uses pane container wrapping, scoped projects hue, and keyboard outlines", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /@container bob-projects \(max-width: 440px\)/);
  assert.match(css, /data-callout="projects".*data-root-hue="aqua"/);
  assert.match(css, /--callout-icon: lucide-puzzle/);
  assert.match(css, /callout\[data-callout="projects"\] > \.callout-title \{\s*display: none/);
  assert.match(css, /\.bob-projects-children-toggle:focus-visible/);
  assert.match(css, /\.bob-projects-tally-short/);
});


