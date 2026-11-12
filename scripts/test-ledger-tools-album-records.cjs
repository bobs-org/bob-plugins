// Record index cards: view-only folds, date chips, group-jump expand,
// pane isolation, and no note writes.
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

const editorInfoField = { _notebook: "info" };
const editorLivePreviewField = { _notebook: "live" };

class StubWidgetType {
  eq(other) {
    return this === other;
  }
}

const StubDecoration = {
  none: { none: true },
  widget: (args) => ({ widget: args.widget, side: args.side, _widget: true }),
  line: (args) => ({ line: true, attributes: args && args.attributes, _line: true }),
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
    if (child.parentNode && child.parentNode !== this) {
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

function makeEditorView({ text, live = true, path = "eat.md", dom = null }) {
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

function album(overrides = {}) {
  return {
    path: "eat.md",
    stem: "eat",
    title: "Restaurants",
    plural: "restaurants",
    owner: "body",
    root: "body",
    records: 25,
    groups: [
      { value: "to_try", label: "🔖 To try", count: 20, peek: ["Ani"] },
      { value: "liked", label: "💚 Liked", count: 13, peek: ["Clark place"] },
      { value: "needs_status", label: "⚠️ Needs a status", count: 1, peek: ["Odd"] },
    ],
    last_record: "2026-11-10",
    index: { state: "current" },
    issues: [],
    ...overrides,
  };
}

function report(rows = [album()]) {
  return helpers.albumIndexReport({
    albums: rows,
    catalogs: [{ path: "body.md", host: "body", state: "current", issues: [] }],
    counts: {},
    ok: true,
    schema_version: 1,
  });
}

function recordLi(doc, target, title, facets = "") {
  const kids = [el(doc, "a", { class: "internal-link", "data-href": target }, [title])];
  if (facets) kids.push(` — ${facets}`);
  return el(doc, "li", {}, kids);
}

function groupLi(doc, label, count, children) {
  return el(doc, "li", {}, [
    el(doc, "strong", {}, [label]),
    ` · ${count}`,
    el(doc, "ul", {}, children),
  ]);
}

function recordsCallout(doc, groups, title = "25 restaurants · 🔖 20 to try · 💚 13 liked") {
  return el(doc, "div", { class: "callout", "data-callout": "records" }, [
    el(doc, "div", { class: "callout-title" }, [title]),
    el(doc, "div", { class: "callout-content" }, [el(doc, "ul", {}, groups)]),
  ]);
}

function fixture(options = {}) {
  const doc = makeDoc();
  const toTry = groupLi(doc, "🔖 To try", options.firstCount ?? 20, [
    recordLi(doc, "eat/ani", "Ani Ramen House", "Ramen · Cranford"),
    recordLi(doc, "eat/future", "Future Place"),
    recordLi(doc, "eat/bad", "Bad Date"),
  ]);
  const likedKids = options.likedChildren || [
    el(doc, "li", {}, [el(doc, "strong", {}, ["Clark"]), " · 7", el(doc, "ul", {}, [
      recordLi(doc, "eat/clark_one", "Clark One"),
    ])]),
    el(doc, "li", {}, [el(doc, "strong", {}, ["Cranford"]), " · 6", el(doc, "ul", {}, [
      recordLi(doc, "eat/both", "Both Dates"),
    ])]),
  ];
  const liked = groupLi(doc, "💚 Liked", options.likedCount ?? 13, likedKids);
  const needs = groupLi(doc, "⚠️ Needs a status", options.needsCount ?? 1, [
    recordLi(doc, "eat/odd", "Odd"),
  ]);
  const groups = options.groups || [toTry, liked, needs];
  const callout = recordsCallout(doc, groups, options.title);
  const root = el(doc, "div", {}, [callout]);
  const files = new Map([
    ["eat.md", { path: "eat.md" }],
    ["eat/ani.md", { path: "eat/ani.md" }],
    ["eat/future.md", { path: "eat/future.md" }],
    ["eat/bad.md", { path: "eat/bad.md" }],
    ["eat/clark_one.md", { path: "eat/clark_one.md" }],
    ["eat/both.md", { path: "eat/both.md" }],
    ["eat/odd.md", { path: "eat/odd.md" }],
  ]);
  const frontmatter = {
    "eat/ani.md": { visited: "2026-11-10" },
    "eat/future.md": { visited: "2026-12-01" },
    "eat/bad.md": { visited: "not-a-date", watched_on: "bogus" },
    "eat/clark_one.md": { watched_on: "2026-11-01" },
    "eat/both.md": { visited: "2026-11-08", watched_on: "2026-11-09" },
    "eat/odd.md": {},
    ...options.frontmatter,
  };
  let state = {
    report: options.report === undefined ? report() : options.report,
    today: "2026-11-12",
    stale: false,
    syncBusy: false,
    ...options.state,
  };
  const writes = [];
  const app = {
    vault: {
      getAbstractFileByPath: (filePath) => files.get(filePath),
      cachedRead: async () => source,
      modify: (...args) => writes.push(args),
      process: (...args) => writes.push(args),
    },
    metadataCache: {
      getFirstLinkpathDest: (target) => files.get(`${target}.md`) || files.get(target),
      getFileCache: (file) => ({ frontmatter: frontmatter[file.path] || {} }),
    },
  };
  const plugin = new LedgerToolsPlugin(app);
  plugin.albumRecordsActive = true;
  plugin.albumRecordsReading = new Set();
  plugin.albumRecordsEditors = new Set();
  plugin.albumRecordsFoldByView = new WeakMap();
  plugin.albumReportState = () => state;
  plugin.apiAlbumSubscribe = (callback) => {
    plugin.recordsCallback = callback;
    return () => { plugin.recordsUnsub = true; };
  };
  return {
    doc, root, callout, toTry, liked, needs, plugin, app, writes, files, frontmatter,
    state: () => state,
    setState: (next) => { state = { ...state, ...next }; },
    paint() { plugin.paintAlbumRecordsReading(root, "eat.md", plugin.albumRecordsFoldMap(root)); },
  };
}

const source = [
  "---",
  'type: "[[album]]"',
  "---",
  "# Restaurants",
  "",
  "## Records",
  "",
  "> [!records] 25 restaurants · 🔖 20 to try · 💚 13 liked",
  ">",
  "> - **🔖 To try** · 20",
  ">   - [[eat/ani|Ani]]",
  "> - **💚 Liked** · 13",
  ">   - **Clark** · 7",
  ">     - [[eat/clark_one|Clark One]]",
  "> - **⚠️ Needs a status** · 1",
  ">   - [[eat/odd|Odd]]",
].join("\n");

test("default folds: first group stays open, later groups fold only above twelve records", () => {
  assert.equal(helpers.ALBUM_RECORDS_FOLD_AFTER, 12);
  assert.equal(helpers.albumRecordsDefaultFolded(0, 20), false);
  assert.equal(helpers.albumRecordsDefaultFolded(1, 12), false);
  assert.equal(helpers.albumRecordsDefaultFolded(1, 13), true);
  assert.equal(helpers.albumRecordsDefaultFolded(2, 1), false);
  const f = fixture();
  f.paint();
  assert.equal(f.toTry.getAttribute("data-bob-records-folded"), null);
  assert.equal(f.liked.getAttribute("data-bob-records-folded"), "true");
  assert.equal(f.needs.getAttribute("data-bob-records-folded"), null);
  assert.equal(f.toTry.querySelector(".bob-records-fold").getAttribute("aria-expanded"), "true");
  assert.equal(f.liked.querySelector(".bob-records-fold").getAttribute("aria-expanded"), "false");
  assert.match(f.liked.querySelector(".bob-records-fold").getAttribute("aria-label"), /Expand 💚 Liked, 13 records/);
  assert.equal(f.liked.getAttribute("data-bob-records-group"), "liked");
});

test("later group of twelve stays open; thirteen folds even when only two subgroup items exist", () => {
  const twelve = fixture({ likedCount: 12, report: report([album({ groups: [
    { value: "to_try", label: "🔖 To try", count: 20, peek: [] },
    { value: "liked", label: "💚 Liked", count: 12, peek: [] },
    { value: "needs_status", label: "⚠️ Needs a status", count: 1, peek: [] },
  ] })]) });
  twelve.paint();
  assert.equal(twelve.liked.getAttribute("data-bob-records-folded"), null);
  const thirteen = fixture();
  thirteen.paint();
  const nested = Array.from(thirteen.liked.children).find((node) => node.tagName === "UL");
  assert.equal(nested.children.length, 2);
  assert.equal(thirteen.liked.getAttribute("data-bob-records-folded"), "true");
});

test("empty and flat indexes stay readable without fold controls", () => {
  const emptyDoc = makeDoc();
  const emptyCallout = el(emptyDoc, "div", { class: "callout", "data-callout": "records" }, [
    el(emptyDoc, "div", { class: "callout-title" }, ["No restaurants yet"]),
    el(emptyDoc, "div", { class: "callout-content" }, [
      el(emptyDoc, "p", {}, ["Add one with `Name @eat/`."]),
    ]),
  ]);
  const emptyRoot = el(emptyDoc, "div", {}, [emptyCallout]);
  const empty = fixture();
  empty.plugin.paintAlbumRecordsReading(emptyRoot, "eat.md", empty.plugin.albumRecordsFoldMap(emptyRoot));
  assert.equal(emptyRoot.querySelectorAll(".bob-records-fold").length, 0);
  assert.match(emptyRoot.textContent, /Add one with/);

  const flatDoc = makeDoc();
  const flatCallout = recordsCallout(flatDoc, [
    recordLi(flatDoc, "eat/ani", "Ani"),
    recordLi(flatDoc, "eat/both", "Both Dates"),
  ], "2 restaurants");
  const flatRoot = el(flatDoc, "div", {}, [flatCallout]);
  empty.plugin.paintAlbumRecordsReading(flatRoot, "eat.md", empty.plugin.albumRecordsFoldMap(flatRoot));
  assert.equal(flatRoot.querySelectorAll(".bob-records-fold").length, 0);
  assert.equal(flatRoot.querySelectorAll(".bob-records-age").length, 3);
});

test("user fold choices persist across refresh and stay isolated per pane", () => {
  const first = fixture();
  const second = fixture();
  first.paint();
  second.paint();
  first.liked.querySelector(".bob-records-fold").fire("click");
  assert.equal(first.liked.getAttribute("data-bob-records-folded"), null);
  assert.equal(second.liked.getAttribute("data-bob-records-folded"), "true");
  first.paint();
  assert.equal(first.liked.getAttribute("data-bob-records-folded"), null);
  assert.equal(first.liked.querySelector(".bob-records-fold").getAttribute("aria-expanded"), "true");
  second.paint();
  assert.equal(second.liked.getAttribute("data-bob-records-folded"), "true");
});

test("group jump expands only the destination pane before scroll", async () => {
  const first = fixture();
  const second = fixture();
  first.plugin.albumRecordsReading = first.plugin.albumRecordsReading;
  first.paint();
  second.plugin.albumRecordsFoldByView = first.plugin.albumRecordsFoldByView;
  second.plugin.albumRecordsReading = first.plugin.albumRecordsReading;
  first.plugin.albumRecordsReading.add({ el: first.root, path: "eat.md", folds: first.plugin.albumRecordsFoldMap(first.root) });
  first.plugin.albumRecordsReading.add({ el: second.root, path: "eat.md", folds: first.plugin.albumRecordsFoldMap(second.root) });
  const view = { containerEl: first.root, file: { path: "eat.md" } };
  await first.plugin.albumRevealRecordGroup(view, { path: "eat.md", value: "liked", label: "💚 Liked", line: 11, found: true });
  assert.equal(first.liked.getAttribute("data-bob-records-folded"), null);
  assert.equal(second.liked.getAttribute("data-bob-records-folded"), "true");
});

test("visited and watched_on chips are distinct, skip invalid/future dates, and refresh on day rollover", () => {
  const f = fixture();
  f.paint();
  const ani = f.root.querySelector('a[data-href="eat/ani"]').parentNode;
  assert.equal(ani.querySelector(".bob-records-age").textContent, "2d");
  assert.equal(ani.querySelector(".bob-records-age").getAttribute("title"), "Visited: 2026-11-10");
  assert.equal(f.root.querySelector('a[data-href="eat/future"]').parentNode.querySelector(".bob-records-age"), null);
  assert.equal(f.root.querySelector('a[data-href="eat/bad"]').parentNode.querySelector(".bob-records-age"), null);
  const both = f.root.querySelector('a[data-href="eat/both"]').parentNode;
  const chips = both.querySelectorAll(".bob-records-age");
  assert.equal(chips.length, 2);
  assert.equal(chips[0].getAttribute("title"), "Visited: 2026-11-08");
  assert.equal(chips[1].getAttribute("title"), "Watched: 2026-11-09");
  f.setState({ today: "2026-11-13" });
  f.paint();
  assert.equal(ani.querySelector(".bob-records-age").textContent, "3d");
  f.frontmatter["eat/ani.md"] = { visited: "2026-11-12" };
  f.paint();
  assert.equal(ani.querySelector(".bob-records-age").textContent, "1d");
});

test("painting, folding, and date chips never write note bytes", () => {
  const f = fixture();
  const before = source;
  f.paint();
  f.liked.querySelector(".bob-records-fold").fire("keydown", { key: "Enter" });
  f.toTry.querySelector(".bob-records-fold").fire("click");
  assert.equal(f.writes.length, 0);
  assert.equal(source, before);
  assert.ok(f.doc.nodes.every((node) => node.innerHTMLWrites.length === 0));
});

test("fenced examples are ignored; Live Preview paints, Source mode removes chrome", () => {
  const f = fixture();
  const pre = el(f.doc, "pre", {}, [f.callout]);
  const fencedRoot = el(f.doc, "div", {}, [pre]);
  f.plugin.paintAlbumRecordsReading(fencedRoot, "eat.md", f.plugin.albumRecordsFoldMap(fencedRoot));
  assert.equal(fencedRoot.querySelectorAll(".bob-records-fold").length, 0);

  const live = fixture();
  const text = source;
  const view = makeEditorView({ text, path: "eat.md", dom: live.root });
  live.plugin.paintAlbumRecordsEditor(view);
  assert.ok(live.root.querySelectorAll(".bob-records-fold").length > 0);
  assert.equal(view.state.doc.toString(), text);
  const sourceView = makeEditorView({ text, live: false, path: "eat.md", dom: live.root });
  live.plugin.paintAlbumRecordsEditor(sourceView);
  assert.equal(live.root.querySelectorAll(".bob-records-fold").length, 0);
  assert.equal(live.liked.getAttribute("data-bob-records-folded"), null);
});

test("reading children clean on unload and teardown restores hidden rows", () => {
  const f = fixture();
  const children = [];
  f.plugin.renderAlbumRecordsInReading(f.root, { sourcePath: "eat.md", addChild: (child) => children.push(child) });
  assert.equal(f.liked.getAttribute("data-bob-records-folded"), "true");
  children[0].onunload();
  assert.equal(f.root.querySelectorAll(".bob-records-fold").length, 0);
  assert.equal(f.liked.getAttribute("data-bob-records-folded"), null);
  f.plugin.renderAlbumRecordsInReading(f.root, { sourcePath: "eat.md", addChild: (child) => children.push(child) });
  f.plugin.teardownAlbumRecords();
  assert.equal(f.root.querySelectorAll(".bob-records-fold").length, 0);
  assert.equal(f.callout.getAttribute("data-bob-records-card"), null);
  assert.equal(f.plugin.albumRecordsReading.size, 0);
});

test("non-album notes and embeds in the outer editor are left alone", () => {
  const f = fixture({ report: report([album({ path: "eat.md" })]) });
  f.plugin.paintAlbumRecordsReading(f.root, "body.md", f.plugin.albumRecordsFoldMap(f.root));
  assert.equal(f.root.querySelectorAll(".bob-records-fold").length, 0);
  const embed = fixture();
  embed.callout.className = "callout markdown-embed";
  // closest('.markdown-embed') matches the callout itself via class.
  embed.callout.setAttribute("class", "callout");
  const wrap = el(embed.doc, "div", { class: "markdown-embed" }, [embed.callout]);
  const outer = el(embed.doc, "div", {}, [wrap]);
  const view = makeEditorView({ text: source, path: "eat.md", dom: outer });
  embed.plugin.paintAlbumRecordsEditor(view);
  assert.equal(outer.querySelectorAll(".bob-records-fold").length, 0);
});

test("CSS hides folded nested lists and styles the tally with area hue", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /data-callout="records".*data-root-hue="aqua"/);
  assert.match(css, /li\[data-bob-records-folded="true"\] > ul \{ display: none; \}/);
  assert.match(css, /\.bob-records-fold:focus-visible/);
  assert.match(css, /container-name: bob-records/);
});
