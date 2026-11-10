// Notebook catalog cards: CSS contract, chip model, Reading/Live Preview
// paint on a real Obsidian-shaped callout DOM, source-mode gating, and
// zero note-byte writes.
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

const widgetCalls = [];
const lineCalls = [];
const StubDecoration = {
  none: { none: true },
  widget: (args) => {
    widgetCalls.push(args);
    return { widget: args.widget, side: args.side, _widget: true };
  },
  line: (args) => {
    lineCalls.push(args);
    return { line: true, attributes: args && args.attributes, _line: true };
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

const {
  notebookDecodeListReport,
  notebookAgeChip,
  notebookCountChip,
  notebookSummaryIsBlank,
  notebookWikilinkTarget,
  notebookSourceRowKind,
  notebookCatalogRegions,
  notebookFindNotebooksHeadingLine,
  notebookFindHostTitleLine,
  notebookHostCatalog,
  notebookSyncActionModel,
  notebookRowModel,
  notebookLookupByTarget,
  notebookHostHueName,
  notebookPaintCallout,
  notebookPaintSyncAction,
  notebookPaintRetryAction,
  notebookFindCallouts,
  notebookLiIsProjectGroup,
  notebookRetryActionModel,
  notebookStatusModel,
} = helpers;

const pluginRoot = path.join(__dirname, "..", "plugins", "bob-ledger-tools");
const TODAY = "2026-11-09";

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

function makeCalloutDom(doc, rows, options = {}) {
  const content = el(doc, "div", { class: "callout-content" });
  const rootList = el(doc, "ul");
  const addItems = (list, items) => {
    for (const item of items) {
      const li = el(doc, "li");
      if (item.group) {
        li.appendChild(doc.createTextNode("🧩 "));
        li.appendChild(el(doc, "a", {
          class: "internal-link",
          "data-href": item.href,
          href: item.href,
          text: item.title,
        }));
      } else {
        const strong = el(doc, "strong");
        strong.appendChild(el(doc, "a", {
          class: "internal-link",
          "data-href": item.href,
          href: item.href,
          text: item.title,
        }));
        li.appendChild(strong);
        if (item.summary) {
          li.appendChild(doc.createTextNode(` \u2014 ${item.summary}`));
        }
      }
      if (item.children && item.children.length) {
        const nested = el(doc, "ul");
        addItems(nested, item.children);
        li.appendChild(nested);
      }
      list.appendChild(li);
    }
  };
  addItems(rootList, rows);
  if (!options.folded) {
    content.appendChild(rootList);
  }
  const callout = el(doc, "div", { class: "callout", "data-callout": "notebooks" }, [
    el(doc, "div", { class: "callout-title" }, [
      el(doc, "div", { class: "callout-icon" }),
      el(doc, "div", { class: "callout-title-inner", text: "Notebooks" }),
    ]),
    content,
  ]);
  return callout;
}

function notebookReport(overrides = {}) {
  const git = {
    stem: "git",
    path: "git.md",
    title: "Git",
    summary: "Commands and workflow.",
    parent: "dev_tools",
    parent_kind: "notebook",
    owner: "dev",
    root: "dev",
    breadcrumb: ["dev", "Developer tools", "Git"],
    children: [],
    notes: 7,
    sections: [{ title: "Config", notes: 3 }, { title: "Tips", notes: 4 }],
    last_note: "2026-11-08",
    issues: [],
  };
  const tools = {
    stem: "dev_tools",
    path: "dev_tools.md",
    title: "Developer tools",
    summary: "Command-line tools.",
    parent: "dev",
    parent_kind: "area",
    owner: "dev",
    root: "dev",
    breadcrumb: ["dev", "Developer tools"],
    children: ["git"],
    notes: 45,
    sections: [{ title: "Chezmoi", notes: 2 }],
    last_note: "2026-11-09",
    issues: [],
  };
  const blank = {
    stem: "ideas",
    path: "ideas.md",
    title: "Ideas",
    summary: "",
    parent: "dev",
    parent_kind: "area",
    owner: "dev",
    root: "dev",
    breadcrumb: ["dev", "Ideas"],
    children: [],
    notes: 3,
    sections: [],
    last_note: null,
    issues: [],
  };
  const twin = {
    stem: "other_git",
    path: "other_git.md",
    title: "Git",
    summary: "A different Git notebook.",
    parent: "dev",
    parent_kind: "area",
    owner: "dev",
    root: "dev",
    breadcrumb: ["dev", "Git"],
    children: [],
    notes: 1,
    sections: [],
    last_note: "2026-11-01",
    issues: [],
  };
  const nested = {
    stem: "child_nb",
    path: "child_nb.md",
    title: "Child",
    summary: "Nested under a project group.",
    parent: "sub",
    parent_kind: "project",
    owner: "sub",
    root: "dev",
    breadcrumb: ["dev", "sub", "Child"],
    children: [],
    notes: 2,
    sections: [{ title: "One", notes: 2 }],
    last_note: "2026-11-07",
    issues: [],
  };
  return {
    ok: true,
    schema_version: 1,
    notebooks: [tools, git, blank, twin, nested],
    catalogs: [{
      host: "dev",
      path: "dev.md",
      root: "dev",
      state: "current",
      notebooks: 5,
      issues: [],
    }],
    counts: { notebooks: 5, roots: 1, errors: 0, warnings: 0 },
    ...overrides,
  };
}

function decoded(overrides = {}) {
  return notebookDecodeListReport(JSON.stringify(notebookReport(overrides)), "");
}

function catalogSource(options = {}) {
  const callout = [
    "> [!notebooks]",
    ">",
    "> - **[[dev_tools|Developer tools]]** — Command-line tools.",
    ">   - **[[git|Git]]** — Commands and workflow.",
    "> - **[[ideas|Ideas]]**",
    "> - 🧩 [[sub]]",
    ">   - **[[child_nb|Child]]** — Nested under a project group.",
    "> - **[[other_git|Git]]** — A different Git notebook.",
  ].join("\n");
  const catalog = [
    "<!-- bob:notebooks:begin v1 -->",
    callout,
    "<!-- bob:notebooks:end -->",
  ].join("\n");
  const heading = options.heading === false ? "" : "## Notebooks\n\n";
  const title = options.title === false ? "" : "# Dev\n\n";
  const fence = options.fence
    ? "```markdown\n> [!notebooks]\n> - **[[git|Git]]**\n```\n\n"
    : "";
  return `${title}${fence}${heading}${catalog}\n`;
}

function makeApp(files) {
  const cache = new Map();
  const fileObjs = files.map((file) => {
    const obj = { path: file.path, extension: "md" };
    cache.set(file.path, { frontmatter: file.frontmatter || {} });
    return obj;
  });
  const writes = [];
  return {
    writes,
    vault: {
      adapter: { basePath: "/fixture-vault", write: (...args) => writes.push(["adapter.write", args]) },
      getMarkdownFiles: () => fileObjs,
      getAbstractFileByPath: (p) => fileObjs.find((file) => file.path === p) || null,
      modify: (...args) => writes.push(["vault.modify", args]),
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: (file) => cache.get(file && file.path) || null,
      getFirstLinkpathDest: (name) => {
        const wanted = String(name || "").replace(/\.md$/i, "");
        return fileObjs.find((file) => file.path.replace(/\.md$/i, "") === wanted)
          || { path: wanted.endsWith(".md") ? wanted : `${wanted}.md` };
      },
      on: () => ({}),
    },
    workspace: {
      on: () => ({}),
      onLayoutReady: () => {},
      getLeavesOfType: () => [],
      openLinkText: async () => {
        writes.push(["openLinkText"]);
      },
      getActiveViewOfType: () => null,
    },
    fileManager: {
      processFrontMatter: (...args) => writes.push(["processFrontMatter", args]),
    },
    commands: {
      executeCommandById: () => false,
    },
  };
}

function makePlugin(reportOverrides = {}, files) {
  const app = makeApp(files || [
    { path: "dev.md", frontmatter: { type: "[[area]]", color: "blue" } },
    { path: "dev_tools.md", frontmatter: { type: "[[notebook]]", parent: "[[dev]]" } },
    { path: "git.md", frontmatter: { type: "[[notebook]]", parent: "[[dev_tools]]" } },
    { path: "ideas.md", frontmatter: { type: "[[notebook]]", parent: "[[dev]]", summary: "" } },
    { path: "other_git.md", frontmatter: { type: "[[notebook]]", parent: "[[dev]]" } },
    { path: "child_nb.md", frontmatter: { type: "[[notebook]]", parent: "[[sub]]" } },
    { path: "sub.md", frontmatter: { type: "[[project]]", parent: "[[dev]]" } },
  ]);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.notebookTimers = {
    setTimeout: (cb) => {
      cb();
      return 1;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  };
  plugin.registerEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupNotebookData();
  const decodedReport = decoded(reportOverrides);
  plugin.notebookReport = decodedReport.report;
  plugin.notebookReportGeneration = 0;
  plugin.notebookVaultGeneration = 0;
  plugin.notebookReportStale = false;
  plugin.notebookLocalDay = TODAY;
  plugin.notebookDataActive = true;
  plugin.setupNotebookCatalog();
  return { plugin, app, writes: app.writes };
}

function makeEditorView({ text, live = true, path = "dev.md", dom = null }) {
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
        toString: () => String(text),
        line(number) {
          return lineObjs[number - 1];
        },
      },
    },
    dom,
  };
}

test("styles.css scopes the notebook card, icon, tree, chips, and focus", () => {
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  assert.ok(css.includes('.callout[data-callout="notebooks"]'));
  assert.ok(css.includes("lucide-notebook-tabs"));
  assert.ok(css.includes(".callout-title-inner"));
  assert.ok(css.includes("clip: rect(0, 0, 0, 0)"));
  assert.ok(css.includes(".callout-title .callout-icon"));
  assert.ok(css.includes("font-weight: 600"));
  assert.ok(css.includes(".bob-notebook-summary"));
  assert.ok(css.includes("border-inline-start"));
  assert.ok(css.includes("padding-block: 0.4em"));
  assert.ok(css.includes("font-variant-numeric: tabular-nums"));
  assert.ok(css.includes(".bob-notebook-add-summary"));
  assert.ok(css.includes(".bob-notebook-sync:focus-visible"));
  assert.ok(css.includes(".bob-notebook-retry"));
  assert.ok(css.includes("outline: 2px solid var(--interactive-accent)"));
  assert.ok(css.includes('[data-root-hue="blue"]'));
  assert.ok(css.includes("var(--bob-area-blue)"));
  assert.ok(css.includes("flex: 1 1 100%"));
  assert.equal(css.includes("padding-inline-end: 8.5em"), false);
  assert.ok(css.includes("375px"));
  const notebookCss = css.slice(css.indexOf("Notebook catalog card"));
  assert.equal(/#c98500/.test(notebookCss), false);
  assert.equal((css.match(/\.callout\[data-callout="notebooks"\]/g) || []).length > 5, true);
  assert.equal(css.includes("ul li {"), false);
});

test("age and count chips treat missing data as unavailable, not zero", () => {
  assert.equal(notebookAgeChip("2026-11-09", TODAY), "today");
  assert.equal(notebookAgeChip("2026-11-08", TODAY), "1d");
  assert.equal(notebookAgeChip("2026-11-07", TODAY), "2d");
  assert.equal(notebookAgeChip("2026-11-10", TODAY), null);
  assert.equal(notebookAgeChip("nope", TODAY), null);
  assert.equal(notebookAgeChip(null, TODAY), null);
  assert.equal(notebookAgeChip("2026-11-08", null), null);
  assert.equal(notebookCountChip(null), null);
  assert.equal(notebookCountChip({ notes: 0, sections: [] }), "0 notes \u00b7 0 \u00a7");
  assert.equal(notebookCountChip({ notes: 48, sections: [{}, {}, {}] }), "48 notes \u00b7 3 \u00a7");
  assert.equal(notebookCountChip({ notes: 4 }), "4 notes");
  assert.equal(notebookSummaryIsBlank(""), true);
  assert.equal(notebookSummaryIsBlank("  "), true);
  assert.equal(notebookSummaryIsBlank(null), true);
  assert.equal(notebookSummaryIsBlank("Scope."), false);
});

test("source regions skip fenced examples and classify project groups", () => {
  const text = catalogSource({ fence: true });
  const regions = notebookCatalogRegions(text);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].rows.filter((row) => row.kind === "project-group").length, 1);
  assert.equal(regions[0].rows.filter((row) => row.kind === "notebook-row").length, 5);
  assert.ok(regions[0].calloutLine > notebookFindNotebooksHeadingLine(text));
  assert.equal(notebookFindHostTitleLine(text), 0);
  const fencedOnly = "```markdown\n<!-- bob:notebooks:begin v1 -->\n> [!notebooks]\n> - **[[git|Git]]**\n<!-- bob:notebooks:end -->\n```\n";
  assert.deepEqual(notebookCatalogRegions(fencedOnly), []);
  assert.equal(notebookSourceRowKind("> - 🧩 [[sub]]"), "project-group");
  assert.equal(notebookSourceRowKind("> - **[[git|Git]]** — hi"), "notebook-row");
  assert.equal(notebookWikilinkTarget("git.md|Git"), "git.md");
});

test("sync action follows catalog state and stays hidden when current", () => {
  assert.equal(notebookSyncActionModel({ state: "current" }), null);
  assert.equal(notebookSyncActionModel({ state: "stale" }).state, "stale");
  assert.equal(notebookSyncActionModel({ state: "missing" }).state, "missing");
  assert.equal(notebookSyncActionModel({ state: "damaged" }).hint.includes("damaged"), true);
  const busy = notebookSyncActionModel({ state: "current" }, { busy: true });
  assert.equal(busy.busy, true);
  assert.equal(busy.disabled, true);
});

test("rows match by resolved path/stem, not display title", () => {
  const report = decoded().report;
  const git = notebookLookupByTarget(report, "git", "dev.md", {
    getFirstLinkpathDest: () => ({ path: "git.md" }),
  }, null);
  const other = notebookLookupByTarget(report, "other_git", "dev.md", {
    getFirstLinkpathDest: () => ({ path: "other_git.md" }),
  }, null);
  assert.equal(git.path, "git.md");
  assert.equal(other.path, "other_git.md");
  assert.equal(git.title, other.title);
  const model = notebookRowModel(git, TODAY);
  assert.equal(model.counts, "7 notes \u00b7 2 \u00a7");
  assert.equal(model.age, "1d");
  assert.equal(model.addSummary, false);
  assert.equal(notebookRowModel(decoded().report.notebooksByStem.get("ideas"), TODAY).addSummary, true);
  assert.equal(notebookRowModel(null, TODAY).counts, null);
});

test("host hue uses pomodoro home ancestry and falls back to neutral", () => {
  const { plugin } = makePlugin();
  assert.equal(
    notebookHostHueName("dev.md", plugin.app.metadataCache, plugin.app.vault),
    "blue",
  );
  plugin.app.metadataCache.getFileCache = (file) => {
    if (file && file.path === "dev.md") {
      return { frontmatter: { type: "[[area]]", color: "grey" } };
    }
    return { frontmatter: {} };
  };
  assert.equal(
    notebookHostHueName("dev.md", plugin.app.metadataCache, plugin.app.vault),
    null,
  );
});

test("Reading view paints hue, nested chips, and skips project groups on a real callout", () => {
  const { plugin } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [
    {
      href: "dev_tools",
      title: "Developer tools",
      summary: "Command-line tools.",
      children: [{ href: "git", title: "Git", summary: "Commands and workflow." }],
    },
    { href: "ideas", title: "Ideas" },
    {
      group: true,
      href: "sub",
      title: "sub",
      children: [{ href: "child_nb", title: "Child", summary: "Nested under a project group." }],
    },
    { href: "other_git", title: "Git", summary: "A different Git notebook." },
  ]);
  const root = el(doc, "div", {}, [
    el(doc, "h1", { text: "Dev" }),
    el(doc, "h2", { text: "Notebooks" }),
    callout,
  ]);
  plugin.paintNotebookCatalogReading(root, "dev.md");
  assert.equal(callout.getAttribute("data-root-hue"), "blue");
  assert.ok(callout.className.includes("bob-notebook-catalog"));
  const chips = root.querySelectorAll(".bob-notebook-chips");
  assert.equal(chips.length, 5);
  const paths = chips.map((node) => node.getAttribute("data-notebook-path")).sort();
  assert.deepEqual(paths, ["child_nb.md", "dev_tools.md", "git.md", "ideas.md", "other_git.md"].sort());
  const groupLi = root.querySelectorAll("li").find((li) => notebookLiIsProjectGroup(li));
  assert.ok(groupLi);
  const groupOwnChips = Array.from(groupLi.childNodes).filter((node) =>
    node.nodeType === 1 && String(node.getAttribute("class") || "").split(/\s+/).includes("bob-notebook-chips"),
  );
  assert.equal(groupOwnChips.length, 0);
  const ideas = chips.find((node) => node.getAttribute("data-notebook-stem") === "ideas");
  assert.ok(ideas.querySelector(".bob-notebook-add-summary"));
  assert.equal(ideas.querySelector(".bob-notebook-age"), null);
  const tools = chips.find((node) => node.getAttribute("data-notebook-stem") === "dev_tools");
  assert.equal(tools.querySelector(".bob-notebook-count").textContent, "45 notes \u00b7 1 \u00a7");
  assert.equal(tools.querySelector(".bob-notebook-age").textContent, "today");
  assert.ok(root.querySelector(".bob-notebook-summary"));
  assert.equal(root.querySelector(".bob-notebook-sync"), null);
});

test("folded callout chrome still receives data-root-hue", () => {
  const { plugin } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "x" }], { folded: true });
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [callout]), "dev.md");
  assert.equal(callout.getAttribute("data-root-hue"), "blue");
  assert.equal(callout.querySelector(".bob-notebook-chips"), null);
});

test("repeat mounting does not duplicate chips or sync actions", () => {
  const { plugin } = makePlugin({
    catalogs: [{ host: "dev", path: "dev.md", root: "dev", state: "stale", notebooks: 1, issues: [] }],
  });
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "Commands and workflow." }]);
  const heading = el(doc, "h2", { text: "Notebooks" });
  const root = el(doc, "div", {}, [heading, callout]);
  plugin.paintNotebookCatalogReading(root, "dev.md");
  plugin.paintNotebookCatalogReading(root, "dev.md");
  assert.equal(root.querySelectorAll(".bob-notebook-chips").length, 1);
  assert.equal(root.querySelectorAll(".bob-notebook-sync").length, 1);
  assert.equal(root.querySelectorAll(".bob-notebook-summary").length, 1);
});

test("malicious report strings never become HTML", () => {
  const { plugin } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{
    href: "ideas",
    title: "Ideas",
    summary: "<img src=x onerror=alert(1)>",
  }]);
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [callout]), "dev.md");
  const htmlWrites = doc.nodes.flatMap((node) => node.innerHTMLWrites || []);
  assert.deepEqual(htmlWrites, []);
  const summary = callout.querySelector(".bob-notebook-summary");
  assert.equal(summary.textContent, "<img src=x onerror=alert(1)>");
});

test("fenced example callouts are left alone", () => {
  const { plugin } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "x" }]);
  const pre = el(doc, "pre", {}, [el(doc, "code", {}, [callout])]);
  plugin.renderNotebookCatalogInReading(pre, { sourcePath: "dev.md", addChild() {} });
  assert.equal(callout.getAttribute("data-root-hue"), null);
  assert.equal(callout.querySelector(".bob-notebook-chips"), null);
});

test("missing catalog without an H2 puts sync on the host title", () => {
  const { plugin } = makePlugin({
    catalogs: [{ host: "dev", path: "dev.md", root: "dev", state: "missing", notebooks: 0, issues: [] }],
  });
  const doc = makeDoc();
  const title = el(doc, "h1", { text: "Dev" });
  const root = el(doc, "div", {}, [title]);
  plugin.paintNotebookCatalogReading(root, "dev.md");
  const sync = title.querySelector(".bob-notebook-sync");
  assert.ok(sync);
  assert.equal(sync.getAttribute("data-catalog-state"), "missing");
});

test("busy sync disables the same action mouse and keyboard invoke", () => {
  const { plugin } = makePlugin({
    catalogs: [{ host: "dev", path: "dev.md", root: "dev", state: "stale", notebooks: 1, issues: [] }],
  });
  plugin.notebookSyncBusy = true;
  const doc = makeDoc();
  const heading = el(doc, "h2", { text: "Notebooks" });
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [heading]), "dev.md");
  const sync = heading.querySelector(".bob-notebook-sync");
  assert.equal(sync.getAttribute("aria-busy"), "true");
  assert.equal(sync.disabled, true);
  let calls = 0;
  plugin.apiNotebookSync = async () => {
    calls += 1;
    return { ok: true };
  };
  plugin.notebookSyncBusy = false;
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [heading]), "dev.md");
  const live = heading.querySelector(".bob-notebook-sync");
  live.fire("click");
  live.fire("keydown", { key: "Enter" });
  live.fire("keydown", { key: " " });
  assert.equal(calls, 3);
});

test("add-summary fallback opens the notebook and explains Properties", async () => {
  TestNotice.messages = [];
  const { plugin } = makePlugin();
  const result = await plugin.apiNotebookOpenSummary("ideas.md", "dev.md");
  assert.equal(result.ok, true);
  assert.equal(result.focused, false);
  assert.ok(TestNotice.messages.some((message) => /Properties/i.test(message)));
  assert.ok(plugin.app.writes.some((row) => row[0] === "openLinkText"));
});

test("catalog paint never writes note bytes, including hue-only refresh", () => {
  const { plugin, app } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "Commands and workflow." }]);
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [callout]), "dev.md");
  app.metadataCache.getFileCache = (file) => {
    if (file && file.path === "dev.md") {
      return { frontmatter: { type: "[[area]]", color: "red" } };
    }
    return { frontmatter: {} };
  };
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [callout]), "dev.md");
  assert.equal(callout.getAttribute("data-root-hue"), "red");
  assert.deepEqual(app.writes, []);
});

test("Live Preview decorations gate on live preview and skip source mode", () => {
  widgetCalls.length = 0;
  lineCalls.length = 0;
  const { plugin } = makePlugin({
    catalogs: [{ host: "dev", path: "dev.md", root: "dev", state: "stale", notebooks: 1, issues: [] }],
  });
  const text = catalogSource();
  const source = plugin.buildNotebookCatalogDecorations(makeEditorView({ text, live: false }));
  assert.equal(source.none, true);
  const live = plugin.buildNotebookCatalogDecorations(makeEditorView({ text, live: true }));
  assert.ok(Array.isArray(live));
  assert.ok(live.some((range) => range.decoration && range.decoration._widget));
  assert.ok(live.some((range) => range.decoration && range.decoration._line));
  const fenced = plugin.buildNotebookCatalogDecorations(makeEditorView({
    text: "```markdown\n## Notebooks\n<!-- bob:notebooks:begin v1 -->\n> [!notebooks]\n> - **[[git|Git]]**\n<!-- bob:notebooks:end -->\n```\n",
    live: true,
  }));
  assert.equal(fenced.filter((range) => range.decoration && range.decoration._line).length, 0);
});

test("Live Preview paints the actual callout DOM, not only source lines", () => {
  const { plugin } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "Commands and workflow." }]);
  const view = makeEditorView({ text: catalogSource(), live: true, dom: el(doc, "div", { class: "cm-editor" }, [callout]) });
  assert.equal(plugin.notebookCatalogPaintEditorDom(view), true);
  assert.equal(callout.getAttribute("data-root-hue"), "blue");
  assert.ok(callout.querySelector(".bob-notebook-chips"));
});

test("reading postprocessor registers a render child and unloads it", () => {
  const { plugin } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "x" }]);
  const elRoot = el(doc, "div", {}, [callout]);
  const children = [];
  plugin.renderNotebookCatalogInReading(elRoot, {
    sourcePath: "dev.md",
    addChild(child) {
      children.push(child);
    },
  });
  assert.equal(children.length, 1);
  assert.equal(plugin.notebookCatalogReadingWidgets.size, 1);
  if (typeof children[0].onunload === "function") {
    children[0].onunload();
  } else {
    children[0].unload();
  }
  assert.equal(plugin.notebookCatalogReadingWidgets.size, 0);
});

test("all catalog states stay visible until the list report changes them", () => {
  for (const state of ["stale", "missing", "damaged"]) {
    const { plugin } = makePlugin({
      catalogs: [{ host: "dev", path: "dev.md", root: "dev", state, notebooks: 1, issues: [] }],
    });
    const current = notebookHostCatalog(plugin.notebookReportState(), "dev.md");
    assert.equal(current.state, state);
    assert.ok(notebookSyncActionModel(current));
  }
});

test("first list failure is unavailable with a list retry, not invented zeros", () => {
  const { plugin } = makePlugin();
  plugin.notebookReport = null;
  plugin.notebookReportStale = true;
  plugin.notebookReportError = {
    code: "bob-not-found",
    message: "Notebook data needs the desktop app, where bob can run.",
  };
  const state = plugin.notebookReportState();
  assert.equal(state.unavailable, true);
  const retry = notebookRetryActionModel(state);
  assert.ok(retry);
  assert.equal(retry.kind, "retry");
  assert.equal(plugin.notebookCatalogSyncModel("dev.md", state, false), null);
  const doc = makeDoc();
  const root = el(doc, "div", {});
  plugin.paintNotebookCatalogReading(root, "dev.md");
  const retryBtn = root.querySelector(".bob-notebook-retry");
  assert.ok(retryBtn);
  assert.ok(root.querySelector(".bob-notebook-status"));
  assert.equal(root.querySelectorAll(".bob-notebook-count").length, 0);
});

test("stale last-good catalog keeps counts and offers retry", () => {
  const { plugin } = makePlugin();
  plugin.notebookReportStale = true;
  plugin.notebookReportError = { code: "timeout", message: "bob notebooks timed out." };
  const state = plugin.notebookReportState();
  assert.equal(state.stale, true);
  assert.ok(state.report);
  const retry = notebookRetryActionModel(state);
  assert.equal(retry.state, "stale");
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "Commands and workflow." }]);
  const heading = el(doc, "h2", { text: "Notebooks" });
  const root = el(doc, "div", {}, [heading, callout]);
  plugin.paintNotebookCatalogReading(root, "dev.md");
  assert.equal(callout.getAttribute("data-stale"), "true");
  assert.ok(root.querySelector(".bob-notebook-chips"));
  assert.ok(heading.querySelector(".bob-notebook-retry"));
  let reports = 0;
  plugin.apiNotebookReport = async () => {
    reports += 1;
    return plugin.notebookReportState();
  };
  heading.querySelector(".bob-notebook-retry").fire("keydown", { key: "Enter" });
  assert.equal(reports, 1);
});

test("retry recovers after a later successful list", () => {
  const { plugin } = makePlugin();
  plugin.notebookReport = null;
  plugin.notebookReportError = { code: "failed", message: "nope" };
  const doc = makeDoc();
  const heading = el(doc, "h2", { text: "Notebooks" });
  const root = el(doc, "div", {}, [heading]);
  plugin.paintNotebookCatalogReading(root, "dev.md");
  assert.ok(heading.querySelector(".bob-notebook-retry"));
  plugin.notebookReport = decoded().report;
  plugin.notebookReportError = null;
  plugin.notebookReportStale = false;
  plugin.notebookReportGeneration = plugin.notebookVaultGeneration || 0;
  plugin.paintNotebookCatalogReading(root, "dev.md");
  assert.equal(heading.querySelector(".bob-notebook-retry"), null);
  assert.equal(heading.querySelector(".bob-notebook-status"), null);
});

test("sync refusal keeps damaged feedback until the list succeeds", () => {
  const { plugin } = makePlugin({
    catalogs: [{ host: "dev", path: "dev.md", root: "dev", state: "damaged", notebooks: 1, issues: [] }],
  });
  plugin.notebookSyncError = {
    code: "sync-refused",
    message: "bob notebooks sync found a damaged catalog or could not complete.",
  };
  const doc = makeDoc();
  const heading = el(doc, "h2", { text: "Notebooks" });
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [heading]), "dev.md");
  assert.equal(heading.querySelector(".bob-notebook-sync").getAttribute("data-catalog-state"), "damaged");
  assert.ok(heading.querySelector(".bob-notebook-status"));
});

test("missing catalog without H1 or H2 uses a rendered-only anchor", () => {
  const { plugin } = makePlugin({
    catalogs: [{ host: "dev", path: "dev.md", root: "dev", state: "missing", notebooks: 0, issues: [] }],
  });
  const doc = makeDoc();
  const para = el(doc, "p", { text: "No headings." });
  const root = el(doc, "div", {}, [para]);
  plugin.paintNotebookCatalogReading(root, "dev.md");
  const anchor = root.querySelector(".bob-notebook-anchor");
  assert.ok(anchor);
  assert.ok(anchor.querySelector(".bob-notebook-sync"));
  assert.equal(anchor.querySelector(".bob-notebook-sync").getAttribute("data-catalog-state"), "missing");
});

test("host hue uses the local override and honour mute, not root_hue", () => {
  const files = [
    { path: "dev.md", frontmatter: { type: "[[area]]" } },
    { path: "root.md", frontmatter: { type: "[[project]]", parent: "[[dev]]", color: "blue" } },
    { path: "sub.md", frontmatter: { type: "[[project]]", parent: "[[root]]", color: "orange" } },
  ];
  const { plugin } = makePlugin({}, files);
  assert.equal(notebookHostHueName("sub.md", plugin.app.metadataCache, plugin.app.vault), "orange");
  plugin.app.metadataCache.getFileCache = (file) => {
    if (file && file.path === "sub.md") {
      return { frontmatter: { type: "[[project]]", parent: "[[root]]", color: "grey" } };
    }
    if (file && file.path === "root.md") {
      return { frontmatter: { type: "[[project]]", parent: "[[dev]]", color: "blue" } };
    }
    if (file && file.path === "dev.md") {
      return { frontmatter: { type: "[[area]]" } };
    }
    return { frontmatter: {} };
  };
  assert.equal(notebookHostHueName("sub.md", plugin.app.metadataCache, plugin.app.vault), null);
});

test("Live Preview and Reading both expose retry after a first fetch failure", () => {
  const { plugin } = makePlugin();
  plugin.notebookReport = null;
  plugin.notebookReportError = { code: "timeout", message: "timed out" };
  const reading = el(makeDoc(), "div", {});
  plugin.paintNotebookCatalogReading(reading, "dev.md");
  assert.ok(reading.querySelector(".bob-notebook-retry"));
  widgetCalls.length = 0;
  const live = plugin.buildNotebookCatalogDecorations(makeEditorView({
    text: "Just a paragraph.\n",
    live: true,
  }));
  assert.ok(Array.isArray(live));
  assert.ok(live.some((range) => range.decoration && range.decoration._widget));
});

test("add-summary focuses the opened notebook view, never another pane", async () => {
  TestNotice.messages = [];
  const { plugin } = makePlugin();
  let focusedOther = false;
  plugin.app.workspace.getLeavesOfType = () => [
    { view: { file: { path: "ideas.md" }, contentEl: { querySelector: () => null, querySelectorAll: () => [] } } },
  ];
  plugin.notebookFocusSummaryProperty = (view) => {
    if (!view || !view.file || view.file.path !== "ideas.md") {
      focusedOther = true;
    }
    return false;
  };
  const result = await plugin.apiNotebookOpenSummary("ideas.md", "dev.md");
  assert.equal(result.ok, true);
  assert.equal(focusedOther, false);
});

test("create and metadata events refresh the shared catalog through one cache", async () => {
  const { plugin } = makePlugin();
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "Commands and workflow." }]);
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [el(doc, "h2", { text: "Notebooks" }), callout]), "dev.md");
  const gen = plugin.notebookVaultGeneration;
  plugin.notebooksSpawn = async () => ({
    ok: true,
    report: {
      schema_version: 1,
      ok: true,
      command: "create",
      notebook: { path: "nvim.md", stem: "nvim", title: "Nvim", summary: "x", parent: "dev" },
      warnings: [],
    },
  });
  const created = await plugin.apiNotebooksCreate({ parent: "dev.md", id: "nvim", summary: "Neovim notes." });
  assert.equal(created.ok, true);
  plugin.notebookHandleVaultEvent("create", { path: "nvim.md" });
  plugin.notebookHandleMetadataChanged(
    { path: "nvim.md" },
    { frontmatter: { type: "[[notebook]]", parent: "[[dev]]", summary: "Neovim notes." } },
  );
  assert.ok(plugin.notebookVaultGeneration > gen);
  assert.equal(plugin.notebookReportStale, true);
  assert.equal(Boolean(plugin.notebookSyncBusy), false);
});

test("desktop-unavailable live data is explicit and read-only styling still paints", () => {
  const { plugin } = makePlugin();
  plugin.notebookReport = decoded().report;
  plugin.notebookReportError = {
    code: "bob-not-found",
    message: "Notebook data needs the desktop app, where bob can run.",
  };
  plugin.notebookReportStale = true;
  const state = plugin.notebookReportState();
  assert.equal(notebookRetryActionModel(state).code, "desktop-only");
  const doc = makeDoc();
  const callout = makeCalloutDom(doc, [{ href: "git", title: "Git", summary: "Commands and workflow." }]);
  plugin.paintNotebookCatalogReading(el(doc, "div", {}, [callout]), "dev.md");
  assert.equal(callout.getAttribute("data-root-hue"), "blue");
  assert.ok(callout.querySelector(".bob-notebook-chips"));
  void notebookPaintRetryAction;
  void notebookStatusModel;
});
