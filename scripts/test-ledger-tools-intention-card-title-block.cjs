// Day and period cards (bob-cli-o6 day-period-cards): path-computed identity,
// the census of daily and period note shapes (hidden range and rail), the
// set-intentions ghost, the card DOM, the title-slot controller in Live
// Preview and Reading (fallback, onLost, keys, sweep, dispose), link routing,
// and the card editor's identity header.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
  addCommand(command) { return command; }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.ranges = []; } add(from, to, value) { this.ranges.push({ from, to, value }); } finish() { return { ranges: this.ranges }; } }
const Decoration = {
  none: { ranges: [] },
  widget: (spec) => ({ spec }),
  replace: (spec) => ({ spec, range(from, to) { return { from, to, value: this }; } }),
  set: (ranges) => ({ ranges }),
};
const EditorView = {
  decorations: { from: (field, get) => ({ facet: "decorations", field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ facet: "editorAttributes", field, get }) },
  updateListener: { of: (listener) => ({ listener }) },
};
// Obsidian's Keymap.isModEvent: Mod opens a tab, Mod+Alt a split.
const Keymap = {
  isModEvent: (event) => {
    const mod = Boolean(event?.ctrlKey || event?.metaKey);
    if (mod && event?.altKey) return "split";
    return mod ? "tab" : false;
  },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } load() {} unload() { this.unloaded = true; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true }, Keymap,
    parseYaml: (text) => JSON.parse(text), normalizePath: (value) => value,
    editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, EditorView, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const TODAY = "2026-11-20";
const DAY = "2026/20261120.md";
const WEEK = "2026/2026-W47.md";
const QUARTER = "2026/2026-Q4.md";
const YEAR = "2026.md";
const SLOT = "bob-property-card-title-slot";
const OWNS = "bob-property-card-owns-title";
const OWNED_ROW = "bob-property-card-owned-property";

// ---- Fake DOM -------------------------------------------------------------

class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  contains(node) { return node === this; }
}

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this.root = false;
    const self = this;
    this.classList = {
      add(...names) { const xs = new Set(self.className.split(/\s+/).filter(Boolean)); for (const name of names) xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(...names) { self.setAttribute("class", self.className.split(/\s+/).filter((x) => x && !names.includes(x)).join(" ")); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; this.appendChild(new FakeText(value, this.ownerDocument)); }
  get isConnected() { let node = this; while (node) { if (node.root) return true; node = node.parentNode; } return false; }
  get nextElementSibling() { const xs = this.parentNode?.children || []; const i = xs.indexOf(this); return i >= 0 ? xs[i + 1] || null : null; }
  get parentElement() { return this.parentNode; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, anchor) {
    if (anchor && anchor.parentNode !== this) throw new Error("anchor is not a child");
    node.parentNode?.removeChild?.(node);
    const index = anchor ? this.childNodes.indexOf(anchor) : this.childNodes.length;
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    this.ownerDocument.inserts += 1;
    return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild(this); }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, target: this, defaultPrevented: false, stopped: false, ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; };
    event.stopPropagation = () => { event.stopped = true; };
    let node = this;
    while (node && !event.stopped) {
      for (const listener of node.listeners?.get?.(type) || []) listener(event);
      node = node.parentNode;
    }
    return event;
  }
  getBoundingClientRect() { return { top: 0, bottom: 40, left: 0, right: 300, height: 40, width: 300 }; }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = part.replace(/\[[^\]]*\]/g, "").match(/\.[\w-]+/g) || [];
      const attrs = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      if (!tag && !cls.length && !attrs.length) return false;
      if (!cls.every((name) => this.classList.contains(name.slice(1)))) return false;
      return attrs.every(([, name, value]) => (value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc({ textNodes = true } = {}) {
  const doc = { inserts: 0, mutation: [], activeElement: null };
  doc.createElement = (tag) => new FakeNode(tag, doc);
  if (textNodes) doc.createTextNode = (text) => new FakeText(text, doc);
  doc.defaultView = {
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; doc.mutation.push(this); }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { this.targets = []; }
      fire() { if (this.targets.length) this.callback([], this); }
    },
    ResizeObserver: class { observe() {} disconnect() {} },
  };
  doc.body = doc.createElement("body");
  doc.body.root = true;
  return doc;
}

function el(doc, tag, cls, parent, ...kids) {
  const node = doc.createElement(tag);
  if (cls) node.setAttribute("class", cls);
  if (parent) parent.appendChild(node);
  for (const kid of kids) node.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
  return node;
}

function anchorEl(doc, target, text) {
  const node = el(doc, "a", "internal-link", null, text);
  node.setAttribute("data-href", target);
  return node;
}

function fireObservers(doc) { for (const observer of doc.mutation) observer.fire(); }
const order = (parent) => parent.children.map((node) => node.className.split(/\s+/)[0]);
const flush = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// ---- Fixtures ---------------------------------------------------------------

const DAY_NAV = "[[2026/20261119|prev]] · [[2026/2026-W47|W47]] · [[2026/20261121|next]]";
const WEEK_NAV = "[[2026/2026-W46|‹ W46]] · [[2026/2026-Q4|↑ 2026-Q4]] · [[2026/2026-W48|W48 ›]]";
const WEEK_KIDS = "[[2026/20261116|Mon Nov 16]] · [[2026/20261117|Tue 17]] · [[2026/20261118|Wed 18]] · [[2026/20261119|Thu 19]] · [[2026/20261120|Fri 20]] · [[2026/20261121|Sat 21]] · [[2026/20261122|Sun 22]]";
const QUARTER_NAV = "[[2026/2026-Q3|‹ Q3]] · [[2026|↑ 2026]] · [[2027/2027-Q1|2027-Q1 ›]]";
const QUARTER_KIDS = Array.from({ length: 14 }, (_, i) => `[[2026/2026-W${40 + i}|W${40 + i}]]`).join(" · ");
const YEAR_NAV = "[[2025|‹ 2025]] · [[all_time|↑ All time]] · [[2027|2027 ›]]";
const YEAR_KIDS = "[[2026/2026-Q1|Q1]] · [[2026/2026-Q2|Q2]] · [[2026/2026-Q3|Q3]] · [[2026/2026-Q4|Q4]]";

function note(fields, body) {
  return `---\n${JSON.stringify(fields)}\n---\n\n${body}`;
}

const BODIES = {
  [DAY]: `# 2026-11-20 Fri\n\n${DAY_NAV}\n\n- [x] #task [[gtd_daily]] ^gtd\n`,
  [WEEK]: `# 2026-W47 · Nov 16 – 22\n\n${WEEK_NAV}\n\n${WEEK_KIDS}\n\n\`\`\`bob-stats-strip\n\`\`\`\n`,
  [QUARTER]: `# 2026-Q4 · W40–W53 · Sep 28, 2026 – Jan 3, 2027\n\n${QUARTER_NAV}\n\n${QUARTER_KIDS}\n`,
  [YEAR]: `# 2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks\n\n${YEAR_NAV}\n\n${YEAR_KIDS}\n`,
};

function fakeApp(doc) {
  const files = new Map();
  const caches = new Map();
  const disk = new Map();
  const opened = [];
  const commandsRun = [];
  const app = {
    document: doc,
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      async read(file) { return disk.get(file.path); },
    },
    metadataCache: {
      getFileCache: (file) => caches.get(file.path) || null,
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      on: () => ({}),
    },
    workspace: {
      leaves: [],
      getLeavesOfType() { return this.leaves; },
      on: () => ({}),
      openLinkText(...args) { opened.push(args); return Promise.resolve(); },
      setActiveLeaf(leaf, options) { this.active = { leaf, options }; },
    },
    commands: {
      commands: {},
      executeCommandById(id) { commandsRun.push(id); return true; },
    },
  };
  const seed = (path, fields = {}, body = BODIES[path] || "Body.\n") => {
    files.set(path, { path, extension: "md" });
    caches.set(path, { frontmatter: JSON.parse(JSON.stringify(fields)) });
    disk.set(path, note(fields, body));
  };
  return { app, files, caches, disk, opened, commandsRun, seed };
}

function makePlugin(world) {
  const plugin = new LedgerToolsPlugin(world.app);
  const timers = new Map();
  let next = 0;
  plugin.albumSetTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; };
  plugin.albumClearTimeout = (id) => timers.delete(id);
  plugin.intentionCardToday = () => TODAY;
  plugin.setupIntentionCard();
  const run = () => { for (const [id, timer] of Array.from(timers.entries())) { timers.delete(id); timer.fn(); } };
  return { plugin, timers, run };
}

async function world(paths = [DAY], fields = {}) {
  const doc = makeDoc();
  const w = fakeApp(doc);
  for (const path of [DAY, WEEK, QUARTER, YEAR, "2026/20261119.md", "2026/20261121.md", "2026/2026-W46.md", "2026/2026-W48.md"]) {
    w.seed(path, fields[path] || {});
  }
  const { plugin, timers, run } = makePlugin(w);
  for (const path of paths) await plugin.intentionCardEnsureSource(path);
  return { doc, ...w, plugin, timers, run };
}

// Live Preview: leaf > .markdown-source-view.is-live-preview > .cm-editor >
// .cm-scroller > .cm-sizer > (inline title, Properties, content).
function livePane(doc, w, path, { mode = "live" } = {}) {
  const leafEl = el(doc, "div", "workspace-leaf-content", doc.body);
  const source = el(doc, "div", "markdown-source-view mod-cm6 is-live-preview", leafEl);
  const scope = el(doc, "div", "cm-editor", source);
  const scroller = el(doc, "div", "cm-scroller", scope);
  const sizer = el(doc, "div", "cm-sizer", scroller);
  const title = el(doc, "div", "inline-title", sizer, path);
  const properties = el(doc, "div", "metadata-container", sizer);
  for (const key of ["intentions", "aliases"]) {
    const row = el(doc, "div", "metadata-property", properties);
    row.setAttribute("data-property-key", key);
  }
  const content = el(doc, "div", "cm-contentContainer", sizer);
  const reading = el(doc, "div", "markdown-reading-view", leafEl);
  const preview = el(doc, "div", "markdown-preview-view markdown-rendered", reading);
  const previewSizer = el(doc, "div", "markdown-preview-sizer", preview);
  const header = el(doc, "div", "mod-header", previewSizer);
  el(doc, "div", "inline-title", header, path);
  const previewProps = el(doc, "div", "metadata-container", header);
  const previewRow = el(doc, "div", "metadata-property", previewProps);
  previewRow.setAttribute("data-property-key", "intentions");
  const field = H.propertyCardTitleOwnershipExtension();
  const fields = new Map([[field, H.propertyCardTitleFieldCreate()]]);
  const view = { dom: scope, scrollDOM: scroller, contentDOM: content, dispatched: [], measures: 0, path, live: true };
  const stateFor = () => ({
    doc: Object.assign(fakeCmDoc(w.disk.get(view.path) || ""), { toString: () => w.disk.get(view.path) || "" }),
    selection: { ranges: [{ from: 0, to: 0 }] },
    field(which) {
      if (which === editorLivePreviewField) return view.live;
      if (which === editorInfoField) return { file: { path: view.path } };
      return fields.has(which) ? fields.get(which) : undefined;
    },
  });
  view.state = stateFor();
  view.dispatch = (spec) => {
    view.dispatched.push(spec);
    const nextState = stateFor();
    fields.set(field, H.propertyCardTitleFieldReduce(fields.get(field), { effects: [].concat(spec.effects || []), docChanged: false, state: nextState, startState: view.state }));
    view.state = nextState;
  };
  view.requestMeasure = () => { view.measures += 1; };
  view.owner = () => fields.get(field).owner;
  const leaf = {
    mode,
    view: {
      containerEl: leafEl,
      file: { path },
      editor: { cm: view },
      previewMode: { containerEl: reading, renderer: { headers: 0, updateHeader() { this.headers += 1; } } },
      getMode: () => (leaf.mode === "reading" ? "preview" : "source"),
      getState: () => ({ source: leaf.mode === "source" }),
    },
  };
  w.app.workspace.leaves.push(leaf);
  return { leaf, leafEl, scope, sizer, title, properties, content, view, preview, previewSizer, header, previewProps };
}

function fakeCmDoc(text) {
  const lines = [];
  const separator = /\r\n|\r|\n/g;
  let cursor = 0;
  let match;
  while ((match = separator.exec(text))) {
    lines.push({ text: text.slice(cursor, match.index), from: cursor, to: match.index });
    cursor = match.index + match[0].length;
  }
  lines.push({ text: text.slice(cursor), from: cursor, to: text.length });
  return { lines: lines.length, length: text.length, line: (n) => ({ number: n, ...lines[n - 1] }) };
}

// Reading sections for the daily fixture: H1, nav paragraph, task list.
function readingSections(doc, pane) {
  const h1Section = el(doc, "div", "el-h1", pane.previewSizer);
  const h1 = el(doc, "h1", "", h1Section, "2026-11-20 Fri");
  const navSection = el(doc, "div", "el-p", pane.previewSizer);
  const nav = el(doc, "p", "", navSection,
    anchorEl(doc, "2026/20261119", "prev"), " · ", anchorEl(doc, "2026/2026-W47", "W47"), " · ", anchorEl(doc, "2026/20261121", "next"));
  const taskSection = el(doc, "div", "el-ul", pane.previewSizer);
  el(doc, "ul", "", taskSection, el(doc, "li", "", null, "gtd"));
  return { h1Section, h1, navSection, nav, taskSection };
}

function model(w, path) {
  return w.plugin.intentionCardModelFor(path, w.disk.get(path));
}

test.afterEach(() => {
  H.propertyCardTitleSlotReleaseAll?.();
  H.propertyCardTitleReleaseAll?.();
});

// ---- Identity -----------------------------------------------------------------

test("day identity: path title, week kicker, leaf tile, and the TODAY / YESTERDAY / TOMORROW pills", () => {
  const subject = (path) => H.intentionCardSubjectForPath(path, TODAY);
  const today = H.intentionCardIdentity(subject(DAY));
  assert.deepEqual(today, {
    kind: "day", title: "Fri, Nov 20, 2026",
    kicker: [{ text: "W47", target: "2026/2026-W47" }, { text: "2026" }],
    subtitle: "", tile: { band: "FRI", value: "20" }, pill: { text: "TODAY", tone: "solid" },
  });
  assert.deepEqual(H.intentionCardIdentity(subject("2026/20261119.md")).pill, { text: "YESTERDAY", tone: "outline" });
  assert.deepEqual(H.intentionCardIdentity(subject("2026/20261121.md")).pill, { text: "TOMORROW", tone: "outline" });
  assert.equal(H.intentionCardIdentity(subject("2026/20261110.md")).pill, null, "past day");
  assert.equal(H.intentionCardIdentity(subject("2026/20261125.md")).pill, null, "future day");
  const isoYear = H.intentionCardIdentity(subject("2025/20251229.md"));
  assert.equal(isoYear.title, "Mon, Dec 29, 2025");
  assert.deepEqual(isoYear.kicker, [{ text: "W01", target: "2026/2026-W01" }, { text: "2026" }], "the ISO week-year");
  assert.deepEqual(isoYear.tile, { band: "MON", value: "29" });
  assert.equal(H.intentionCardIdentity(null), null);
});

test("period identity: titles, parent kicker, subtitles across months and years, tiles, and current pills", () => {
  const subject = (path) => H.intentionCardSubjectForPath(path, TODAY);
  assert.deepEqual(H.intentionCardIdentity(subject(WEEK)), {
    kind: "week", title: "2026-W47", kicker: [{ text: "2026-Q4", target: "2026/2026-Q4" }],
    subtitle: "Nov 16 – 22, 2026", tile: { band: "WEEK", value: "47" }, pill: { text: "THIS WEEK", tone: "solid" },
  });
  const crossMonth = H.intentionCardIdentity(subject("2026/2026-W44.md"));
  assert.equal(crossMonth.subtitle, "Oct 26 – Nov 1, 2026");
  assert.equal(crossMonth.pill, null, "a past week has no pill");
  const crossYear = H.intentionCardIdentity(subject("2026/2026-W53.md"));
  assert.equal(crossYear.subtitle, "Dec 28, 2026 – Jan 3, 2027");
  assert.equal(crossYear.tile.value, "53");
  const early = H.intentionCardIdentity(subject("2026/2026-W05.md"));
  assert.equal(early.tile.value, "5");
  assert.deepEqual(H.intentionCardIdentity(subject("2026/2026-Q2.md")), {
    kind: "quarter", title: "2026-Q2", kicker: [{ text: "2026", target: "2026" }],
    subtitle: "W14–W26 · Mar 30 – Jun 28, 2026", tile: { band: "QTR", value: "Q2" }, pill: null,
  });
  const q4 = H.intentionCardIdentity(subject(QUARTER));
  assert.equal(q4.subtitle, "W40–W53 · Sep 28, 2026 – Jan 3, 2027");
  assert.deepEqual(q4.pill, { text: "THIS QUARTER", tone: "solid" });
  assert.deepEqual(H.intentionCardIdentity(subject(YEAR)), {
    kind: "year", title: "2026", kicker: [{ text: "All time", target: "all_time" }],
    subtitle: "Dec 29, 2025 – Jan 3, 2027 · 53 weeks", tile: { band: "YEAR", value: "2026" },
    pill: { text: "THIS YEAR", tone: "solid" },
  });
  const nextYear = H.intentionCardIdentity(subject("2027.md"));
  assert.equal(nextYear.subtitle, "Jan 4, 2027 – Jan 2, 2028 · 52 weeks");
  assert.equal(nextYear.pill, null);
  const sameYear = H.intentionCardIdentity(subject("2018.md"));
  assert.equal(sameYear.subtitle, "Jan 1 – Dec 30, 2018 · 52 weeks", "a same-year ISO year appends its year");
});

// ---- Census -------------------------------------------------------------------

function census(path, text, fm = {}) {
  const subject = H.intentionCardSubjectForPath(path, TODAY);
  const recognizer = subject ? H.intentionCardTitleRecognizer(subject, fm, TODAY) : null;
  const range = recognizer ? H.propertyCardTitleSourceRange(text, recognizer) : null;
  const rail = recognizer ? H.intentionCardRailModel(text, subject, recognizer, TODAY) : null;
  return { subject, recognizer, range, rail, model: H.intentionCardModelFor(path, fm, TODAY) };
}

test("census: legacy daily shapes hide only a recognized H1 and never invent a rail", () => {
  const dayColon = census("2023/20230719.md", "# Day: 2023-07-19 Wed\n\n~ gtd\nx Migrate bujo to notes\n");
  assert.deepEqual([dayColon.range.fromLine, dayColon.range.toLine], [0, 1]);
  assert.equal(dayColon.rail, null);
  assert.ok(dayColon.model, "the card still mounts");

  const pomodoro = census("2024/20240101.md", "---\n{}\n---\n# day = 2024-01-01.Mon\n# pomodoro = 15\n\n## Pomodoros\n");
  assert.deepEqual([pomodoro.range.fromLine, pomodoro.range.toLine], [3, 3], "only the first H1 is hidden");
  assert.equal(pomodoro.rail, null);

  for (const [path, line] of [["2025/20250301.md", "day::2025-03-01 Sat"], ["2026/20260115.md", "day::2026-01-15 Thu"]]) {
    const text = `---\n{}\n---\n${line}\n\nRelated notes:\n- [[${path.replace(/\.md$/, "")}]]\n`;
    const shape = census(path, text);
    assert.equal(shape.range, null, `${path}: hidden none`);
    assert.equal(shape.rail, null);
    assert.ok(shape.model, `${path}: H1-less dailies still get a card`);
    assert.equal(H.intentionCardPlacement(text, shape.subject, TODAY).insertBeforeLine, 3);
  }

  const june = census("2026/20260601.md",
    "---\n{}\n---\n\n# 2026-06-01 Mon\n\n[[2026/20260531|prev]] | [[2026/20260601|day]] | [[2026/20260602|next]]\n\n## Tasks\n");
  assert.deepEqual([june.range.fromLine, june.range.toLine], [4, 5], "the H1 and its blank hide; the unrecognized nav stays visible");
  assert.equal(june.rail, null);
});

test("census: current dailies dock a rail from their nav line, both three-link and two-link", () => {
  const text = note({ aliases: ["2026-11-20 Fri"] }, BODIES[DAY]);
  const current = census(DAY, text, { aliases: ["2026-11-20 Fri"] });
  assert.deepEqual([current.range.fromLine, current.range.toLine], [4, 7]);
  assert.deepEqual(current.rail.prev, { label: "Thu 19", shortLabel: "Thu", target: "2026/20261119", ariaLabel: "Previous day: Thu, Nov 19, 2026" });
  assert.deepEqual(current.rail.parent, { label: "W47", shortLabel: "W47", target: "2026/2026-W47", ariaLabel: "Parent week: 2026-W47" });
  assert.deepEqual(current.rail.next, { label: "Sat 21", shortLabel: "Sat", target: "2026/20261121", ariaLabel: "Next day: Sat, Nov 21, 2026" });
  assert.deepEqual(current.rail.children, []);

  const twoLink = census(DAY, "---\n{}\n---\n# Day: 2026-11-20 Fri\n[[2026/20261119|prev]] · [[2026/20261121|next]]\nBody\n");
  assert.deepEqual([twoLink.range.fromLine, twoLink.range.toLine], [3, 4]);
  assert.equal(twoLink.rail.parent.target, "2026/2026-W47", "the parent comes from the subject's week path");
  assert.equal(twoLink.rail.prev.target, "2026/20261119");
});

test("census: week, quarter, and year rails with children strips and today's chip current", () => {
  const week = census(WEEK, note({}, BODIES[WEEK]));
  assert.deepEqual([week.range.fromLine, week.range.toLine], [4, 9]);
  assert.deepEqual(week.rail.prev, { label: "W46", shortLabel: "W46", target: "2026/2026-W46", ariaLabel: "Previous week: 2026-W46" });
  assert.deepEqual(week.rail.parent, { label: "2026-Q4", shortLabel: "2026-Q4", target: "2026/2026-Q4", ariaLabel: "Parent quarter: 2026-Q4" });
  assert.deepEqual(week.rail.next, { label: "W48", shortLabel: "W48", target: "2026/2026-W48", ariaLabel: "Next week: 2026-W48" });
  assert.equal(week.rail.children.length, 7);
  assert.deepEqual(week.rail.children.filter((chip) => chip.current).map((chip) => chip.label), ["Fri 20"]);

  const quarter = census(QUARTER, note({}, BODIES[QUARTER]));
  assert.deepEqual([quarter.rail.prev.label, quarter.rail.parent.label, quarter.rail.next.label], ["Q3", "2026", "2027-Q1"]);
  assert.equal(quarter.rail.parent.ariaLabel, "Parent year: 2026");
  assert.deepEqual(quarter.rail.children.filter((chip) => chip.current).map((chip) => chip.label), ["W47"]);

  const year = census(YEAR, note({}, BODIES[YEAR]));
  assert.deepEqual([year.rail.prev.label, year.rail.parent.label, year.rail.next.label], ["2025", "All time", "2027"]);
  assert.equal(year.rail.parent.target, "all_time");
  assert.equal(year.rail.parent.ariaLabel, "Parent: All time");
  assert.deepEqual(year.rail.children.filter((chip) => chip.current).map((chip) => chip.label), ["Q4"]);

  const legacyYear = census("2025.md", "---\n{\"parent\":\"[[all_time]]\"}\n---\n- [[2024]]\n- [[2026]]\n");
  assert.ok(legacyYear.model, "the legacy H1-less 2025.md still gets a card");
  assert.equal(legacyYear.range, null);
  assert.equal(legacyYear.rail, null);
  assert.equal(H.intentionCardModelFor("all_time.md", {}, TODAY), null, "all_time has no card");
});

// ---- Ghost ------------------------------------------------------------------------

test("the ghost shows on current and future subjects with no intentions only", () => {
  const ghost = (path, fm = {}) => {
    const m = H.intentionCardModelFor(path, fm, TODAY);
    return m ? H.intentionCardShowsGhost(m) : null;
  };
  assert.equal(ghost(DAY), true, "today");
  assert.equal(ghost("2026/20261121.md"), true, "tomorrow");
  assert.equal(ghost(WEEK), true, "the current week");
  assert.equal(ghost(DAY, { summary: "Done", reflection: "Calm" }), true, "summary or reflection may exist");
  assert.equal(ghost("2026/20261110.md"), false, "a past empty day");
  assert.equal(ghost(DAY, { intentions: ["Ship"] }), false, "a populated day");
  assert.equal(ghost(DAY, { intentions: "not a list" }), null, "malformed fields have no model");
  const empty = H.intentionCardModelFor(DAY, {}, TODAY);
  assert.equal(empty.hasContent, false);
  assert.equal(H.intentionCardModelFor(DAY, { reflection: "x" }, TODAY).hasContent, true);
});

// ---- DOM -------------------------------------------------------------------------

test("the card DOM: identity, one heading, child order, unresolved links, and the ghost button", async () => {
  const w = await world([DAY, WEEK]);
  w.files.delete("2026/20261121.md");
  const doc = makeDoc();
  const prepared = model(w, DAY);
  assert.equal(prepared.model.ghost, true);
  assert.equal(prepared.recognizer.key, "day:2026-11-20");
  const card = H.intentionCardBuildDom(prepared.model, w.plugin, doc);
  assert.equal(card.getAttribute("data-card-kind"), "day");
  assert.equal(card.getAttribute("aria-label"), "Day: Fri, Nov 20, 2026");
  assert.equal(card.getAttribute("role"), "group");
  assert.equal(card.getAttribute("data-intention-state"), "current");
  assert.equal(card.querySelectorAll('[aria-level="1"]').length, 1);
  assert.equal(card.querySelector('[aria-level="1"]').textContent, "Fri, Nov 20, 2026");
  assert.deepEqual(order(card), ["bob-property-card-title-block", "bob-intention-card-ghost", "bob-property-card-rail", "bob-property-card-foot"]);
  const pill = card.querySelector(".bob-property-card-pill");
  assert.equal(pill.textContent, "TODAY");
  assert.equal(card.querySelector('.bob-property-card-tile-band').textContent, "FRI");
  const kicker = card.querySelector(".bob-property-card-kicker").textContent;
  assert.equal(kicker, "Day·W47·2026");
  const next = card.querySelector('[data-rail="next"]');
  assert.ok(next.classList.contains("is-unresolved"), "a missing next note looks unresolved");
  assert.ok(!card.querySelector('[data-rail="prev"]').classList.contains("is-unresolved"));
  assert.equal(next.getAttribute("aria-label"), "Next day: Sat, Nov 21, 2026");
  assert.equal(card.querySelector(".bob-property-card-rail").getAttribute("aria-label"), "Day navigation");

  const ghost = card.querySelector(".bob-intention-card-ghost");
  assert.equal(ghost.tagName, "BUTTON");
  assert.equal(ghost.getAttribute("type"), "button");
  assert.equal(ghost.getAttribute("aria-label"), "Set intentions");
  assert.equal(ghost.querySelector("kbd").getAttribute("aria-hidden"), "true");
  assert.equal(ghost.fire("mousedown").defaultPrevented, true, "CodeMirror never takes the click");
  const opens = [];
  w.plugin.openIntentionCard = (options) => { opens.push(options); return { ok: true }; };
  const click = ghost.fire("click");
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.stopped, true);
  assert.deepEqual(opens, [{ filePath: DAY, initialStage: "add" }]);

  w.seed(DAY, { intentions: ["Ship the card"], reflection: "Steady." });
  await w.plugin.intentionCardEnsureSource(DAY);
  const full = H.intentionCardBuildDom(model(w, DAY).model, w.plugin, doc);
  assert.deepEqual(order(full), [
    "bob-property-card-title-block", "bob-intention-card-intentions", "bob-intention-card-band", "bob-property-card-rail",
    "bob-property-card-foot",
  ]);

  const week = H.intentionCardBuildDom(model(w, WEEK).model, w.plugin, doc);
  const chips = week.querySelectorAll(".bob-property-card-rail-chip");
  assert.equal(chips.length, 7);
  assert.deepEqual(chips.filter((chip) => chip.classList.contains("is-current")).map((chip) => chip.textContent), ["Fri 20"]);
  assert.equal(week.querySelector(".bob-property-card-subtitle").textContent, "Nov 16 – 22, 2026");
});

test("a missing kit (no text nodes for the builders) still shows a title", async () => {
  const w = await world([DAY]);
  const bare = makeDoc({ textNodes: false });
  const card = H.intentionCardBuildDom(model(w, DAY).model, w.plugin, bare);
  assert.ok(card, "the card still builds");
  const kicker = card.querySelector(".bob-intention-card-kicker");
  assert.ok(kicker, "the fallback kicker renders");
  assert.match(kicker.textContent, /^DAY · Fri Nov 20, 2026$/);
  assert.equal(card.querySelector(".bob-property-card-rail"), null);
});

// ---- Slot controller: Live Preview ---------------------------------------------------

test("Live Preview mounts in the title slot before Properties, owns the title, and dedupes by signature", async () => {
  const w = await world([DAY], { [DAY]: { intentions: ["Ship"] } });
  const pane = livePane(w.doc, w, DAY);
  const built = w.plugin.buildIntentionCardDecorations(pane.view);
  assert.deepEqual(built.ranges, [], "no body widget in slot mode");
  await flush();
  const card = pane.sizer.children[1];
  assert.deepEqual(order(pane.sizer), ["inline-title", "bob-property-card", "metadata-container", "cm-contentContainer"]);
  assert.ok(card.classList.contains(SLOT));
  assert.equal(card.getAttribute("data-card-kind"), "day");
  assert.equal(pane.view.owner()?.path, DAY, "the kit field owns the title");
  assert.equal(pane.view.owner()?.recognizer?.key, "day:2026-11-20");
  assert.ok(pane.properties.children[0].classList.contains(OWNED_ROW), "content owns the intentions row");
  assert.ok(!pane.properties.children[1].classList.contains(OWNED_ROW), "other rows stay native");

  const inserts = w.doc.inserts;
  w.plugin.buildIntentionCardDecorations(pane.view);
  await flush();
  assert.equal(pane.sizer.children[1], card, "the same signature keeps the node");
  assert.equal(w.doc.inserts, inserts, "and never re-inserts it");

  w.seed(DAY, { intentions: ["Ship", "Rest"] });
  await w.plugin.intentionCardEnsureSource(DAY);
  w.plugin.buildIntentionCardDecorations(pane.view);
  await flush();
  const replaced = pane.sizer.children[1];
  assert.notEqual(replaced, card, "a changed signature replaces the node");
  assert.equal(card.parentNode, null);
  assert.equal(card.bobIntentionRender, null, "the old render component is released");
  assert.equal(replaced.querySelectorAll(".bob-intention-card-intention").length, 2);

  pane.view.live = false;
  pane.view.state = { ...pane.view.state, field: (which) => (which === editorLivePreviewField ? false : pane.view.state.field(which)) };
  w.plugin.buildIntentionCardDecorations(pane.view);
  assert.equal(pane.sizer.querySelectorAll(".bob-intention-card").length, 0, "Source mode restores native rendering");
  assert.equal(w.plugin.intentionCardSlots.size, 0);
  assert.ok(!pane.properties.children[0].classList.contains(OWNED_ROW));
});

test("an identity-only card owns no Properties rows", async () => {
  const w = await world([DAY]);
  const pane = livePane(w.doc, w, DAY);
  w.plugin.buildIntentionCardDecorations(pane.view);
  await flush();
  assert.ok(pane.sizer.querySelector(".bob-intention-card"), "the empty note still gets its card");
  assert.ok(pane.sizer.querySelector(".bob-intention-card-ghost"));
  assert.ok(!pane.properties.children[0].classList.contains(OWNED_ROW), "no content, no owned rows");
  assert.equal(w.plugin.intentionCardKeySlots.size, 0);
});

test("a null slot falls back to the body widget without title ownership; sticky until the path changes", async () => {
  const w = await world([DAY, WEEK], { [DAY]: { intentions: ["Ship"] } });
  const pane = livePane(w.doc, w, DAY);
  pane.content.remove();
  w.plugin.buildIntentionCardDecorations(pane.view);
  await flush();
  const entry = w.plugin.intentionCardSlots.get(pane.scope);
  assert.equal(entry.fallback, true);
  assert.equal(entry.path, DAY);
  assert.equal(pane.sizer.querySelectorAll(".bob-intention-card").length, 0);
  assert.equal(pane.view.owner(), null, "fallback never owns the title");
  assert.ok(pane.view.dispatched.length >= 1, "the view rebuilds with the fallback widget");
  const rebuilt = w.plugin.buildIntentionCardDecorations(pane.view);
  assert.equal(rebuilt.ranges.length, 1);
  const widget = rebuilt.ranges[0].value.spec.widget;
  assert.equal(rebuilt.ranges[0].value.spec.side, 1);
  const dom = widget.toDOM();
  assert.equal(dom.getAttribute("data-card-kind"), "day");
  assert.ok(pane.properties.children[0].classList.contains(OWNED_ROW), "the fallback widget still owns content rows");

  pane.sizer.appendChild(pane.content);
  w.plugin.buildIntentionCardDecorations(pane.view);
  await flush();
  assert.equal(w.plugin.intentionCardSlots.get(pane.scope).fallback, true, "fallback is sticky for the path");

  pane.view.path = WEEK;
  pane.leaf.view.file = { path: WEEK };
  const week = w.plugin.buildIntentionCardDecorations(pane.view);
  assert.deepEqual(week.ranges, [], "a path change clears the fallback");
  await flush();
  assert.equal(w.plugin.intentionCardSlots.get(pane.scope).path, WEEK);
  assert.equal(w.plugin.intentionCardSlots.get(pane.scope).fallback, false);
  assert.equal(pane.sizer.querySelector(".bob-intention-card").getAttribute("data-card-kind"), "week");
});

test("a note without an H1 puts the fallback widget at its first body line, before it (side -1)", async () => {
  const doc = makeDoc();
  const w = fakeApp(doc);
  const legacy = "2025/20250301.md";
  w.seed(legacy, {}, "day::2025-03-01 Sat\n\nRelated notes:\n");
  const { plugin } = makePlugin(w);
  const text = w.disk.get(legacy);
  const subject = H.intentionCardSubjectForPath(legacy, TODAY);
  const anchor = plugin.intentionCardLiveAnchor(text, subject);
  assert.equal(anchor.side, -1);
  assert.ok(text.slice(anchor.offset).startsWith("day::2025-03-01 Sat"));
  const empty = "---\n{}\n---\n";
  const end = plugin.intentionCardLiveAnchor(empty, subject);
  assert.deepEqual([end.offset, end.side], [empty.length, 1], "no body line: the end of the document");
  plugin.teardownIntentionCard();
});

// ---- Slot controller: Reading --------------------------------------------------------

test("Reading mounts in .mod-header before Properties, hides the H1 and nav, and owns keys only with content", async () => {
  const w = await world([DAY], { [DAY]: { intentions: ["Ship"] } });
  const pane = livePane(w.doc, w, DAY, { mode: "reading" });
  const sections = readingSections(w.doc, pane);
  const card = w.plugin.paintIntentionCardReading(sections.h1Section, DAY);
  assert.ok(card);
  assert.deepEqual(order(pane.header), ["inline-title", "bob-property-card", "metadata-container"]);
  assert.ok(pane.preview.classList.contains(OWNS), "the Reading scope owns the title");
  assert.ok(sections.h1.classList.contains("bob-property-card-title-source"));
  assert.ok(sections.nav.classList.contains("bob-property-card-title-source"));
  assert.ok(pane.previewProps.children[0].classList.contains(OWNED_ROW));
  assert.ok(pane.leaf.view.previewMode.renderer.headers > 0, "the renderer re-measures its header");

  const again = w.plugin.paintIntentionCardReading(sections.h1Section, DAY);
  assert.equal(again, card, "an unchanged repaint keeps the node and the title handle");

  w.seed(DAY, {});
  w.plugin.intentionCardInvalidateSource(DAY);
  await w.plugin.intentionCardEnsureSource(DAY);
  const identityOnly = w.plugin.paintIntentionCardReading(sections.h1Section, DAY);
  assert.notEqual(identityOnly, card);
  assert.ok(!pane.previewProps.children[0].classList.contains(OWNED_ROW), "removing content releases the rows");
  assert.ok(pane.preview.classList.contains(OWNS), "the title stays owned");
  assert.equal(pane.previewSizer.querySelectorAll(".bob-intention-card").length, 1);
});

test("a null Reading slot paints today's body layout with no title ownership", async () => {
  const w = await world([DAY, "2025/20250301.md"]);
  const pane = livePane(w.doc, w, DAY, { mode: "reading" });
  const sections = readingSections(w.doc, pane);
  const insert = pane.header.insertBefore.bind(pane.header);
  pane.header.insertBefore = () => { throw new Error("refused"); };
  const card = w.plugin.paintIntentionCardReading(sections.h1Section, DAY);
  pane.header.insertBefore = insert;
  assert.ok(card, "the body fallback paints");
  assert.equal(card.parentNode, sections.navSection, "after the H1 and nav sections");
  assert.equal(w.plugin.intentionCardSlots.get(pane.preview).fallback, true);
  assert.ok(!pane.preview.classList.contains(OWNS), "fallback never owns the title");
  assert.ok(!sections.h1.classList.contains("bob-property-card-title-source"));

  // A note without an H1 prepends inside its first content section.
  const legacy = "2025/20250301.md";
  w.seed(legacy, {}, "day::2025-03-01 Sat\n\nRelated notes:\n");
  await w.plugin.intentionCardEnsureSource(legacy);
  const other = livePane(w.doc, w, legacy, { mode: "reading" });
  const first = el(w.doc, "div", "el-p", other.previewSizer, el(w.doc, "p", "", null, "day::2025-03-01 Sat"));
  other.previewSizer.removeChild(other.header);
  w.plugin.intentionCardSlotMarkFallback(other.preview, "reading", legacy);
  const body = w.plugin.paintIntentionCardReading(first, legacy);
  assert.equal(body.parentNode, first);
  assert.equal(first.children[0], body, "prepended before the body line");
});

test("onLost: unstable marks fallback, path-changed remounts on refresh", async () => {
  const w = await world([DAY, WEEK]);
  const pane = livePane(w.doc, w, DAY, { mode: "reading" });
  const sections = readingSections(w.doc, pane);
  const card = w.plugin.paintIntentionCardReading(sections.h1Section, DAY);
  for (let i = 0; i < 30 && w.plugin.intentionCardSlots.get(pane.preview)?.fallback !== true; i += 1) {
    card.remove();
    fireObservers(w.doc);
  }
  assert.equal(w.plugin.intentionCardSlots.get(pane.preview).fallback, true, "a slot another writer keeps fighting over falls back");
  assert.ok(!pane.preview.classList.contains(OWNS));
  assert.ok(w.timers.size > 0, "a refresh is scheduled");

  // Path change: the pane switches to the week note.
  w.plugin.intentionCardSlotRelease(pane.preview);
  const mounted = w.plugin.paintIntentionCardReading(sections.h1Section, DAY);
  assert.ok(mounted);
  pane.leaf.view.file = { path: WEEK };
  fireObservers(w.doc);
  assert.equal(w.plugin.intentionCardSlots.has(pane.preview), false, "path-changed drops the entry without fallback");
  assert.equal(mounted.parentNode, null);
  w.run();
  const entry = w.plugin.intentionCardSlots.get(pane.preview);
  assert.equal(entry?.path, WEEK, "the refresh sweep remounts for the new path");
  assert.equal(entry.fallback, false);
  assert.equal(pane.header.querySelector(".bob-intention-card").getAttribute("data-card-kind"), "week");
});

test("the sweep frees the hidden Reading card while editing and mounts a Reading pane with no entry", async () => {
  const w = await world([DAY], { [DAY]: { intentions: ["Ship"] } });
  const pane = livePane(w.doc, w, DAY, { mode: "reading" });
  readingSections(w.doc, pane);
  w.plugin.intentionCardSweepTitleSlots();
  assert.ok(pane.header.querySelector(".bob-intention-card"), "a Reading pane whose post-processor never fired gets its card");
  assert.ok(pane.preview.classList.contains(OWNS));

  pane.leaf.mode = "live";
  w.plugin.intentionCardSweepTitleSlots();
  assert.equal(w.plugin.intentionCardSlots.has(pane.preview), false);
  assert.equal(pane.header.querySelector(".bob-intention-card"), null, "the hidden Reading card is released");
  assert.ok(!pane.preview.classList.contains(OWNS));
  assert.ok(!pane.previewProps.children[0].classList.contains(OWNED_ROW));

  w.plugin.buildIntentionCardDecorations(pane.view);
  await flush();
  assert.ok(pane.sizer.querySelector(".bob-intention-card"), "Live Preview mounts in the editor");
  pane.leaf.mode = "reading";
  w.plugin.buildIntentionCardDecorations(pane.view);
  await flush();
  assert.equal(pane.sizer.querySelector(".bob-intention-card"), null, "a hidden editor never holds a card");
});

test("dispose leaves no entries, slot nodes, or owned titles", async () => {
  const w = await world([DAY], { [DAY]: { intentions: ["Ship"] } });
  const live = livePane(w.doc, w, DAY);
  w.plugin.buildIntentionCardDecorations(live.view);
  await flush();
  const reading = livePane(w.doc, w, DAY, { mode: "reading" });
  const sections = readingSections(w.doc, reading);
  w.plugin.paintIntentionCardReading(sections.h1Section, DAY);
  assert.equal(w.plugin.intentionCardSlots.size, 2);
  w.plugin.teardownIntentionCard();
  assert.equal(w.plugin.intentionCardSlots.size, 0);
  assert.equal(H.propertyCardTitleSlotLiveCount(), 0);
  assert.equal(w.doc.body.querySelectorAll(`.${SLOT}`).length, 0);
  assert.equal(w.doc.body.querySelectorAll(`.${OWNS}`).length, 0);
  assert.equal(w.doc.body.querySelectorAll(".bob-property-card-title-source").length, 0);
  await flush();
  assert.equal(live.view.owner(), null, "the editor title is released");
});

// ---- Link routing ---------------------------------------------------------------------

test("links open through Keymap pane types; middle click opens a tab", async () => {
  assert.equal(H.intentionCardLinkPaneType({ type: "click", button: 0 }), false);
  assert.equal(H.intentionCardLinkPaneType({ type: "click", button: 0, ctrlKey: true }), "tab");
  assert.equal(H.intentionCardLinkPaneType({ type: "click", button: 0, metaKey: true, altKey: true }), "split");
  assert.equal(H.intentionCardLinkPaneType({ type: "auxclick", button: 1 }), "tab");
  const w = await world([DAY]);
  const card = H.intentionCardBuildDom(model(w, DAY).model, w.plugin, makeDoc());
  const week = card.querySelector(".bob-property-card-kicker-link");
  week.fire("click", { ctrlKey: true });
  week.fire("auxclick", { button: 1 });
  card.querySelector('[data-rail="parent"]').fire("click");
  assert.deepEqual(w.opened, [
    ["2026/2026-W47", DAY, "tab"],
    ["2026/2026-W47", DAY, "tab"],
    ["2026/2026-W47", DAY, false],
  ]);
});

test("rail prev and next run the nav-hotkeys command only in the card's own matching pane", async () => {
  const w = await world([DAY]);
  const pane = livePane(w.doc, w, DAY);
  const card = H.intentionCardBuildDom(model(w, DAY).model, w.plugin, w.doc);
  pane.sizer.appendChild(card);
  const prev = card.querySelector('[data-rail="prev"]');
  const next = card.querySelector('[data-rail="next"]');

  prev.fire("click");
  await flush();
  assert.deepEqual(w.opened.pop(), ["2026/20261119", DAY, false], "no command: the link opens");

  w.app.commands.commands["bob-navigation-hotkeys:open-prev-link"] = { id: "open-prev-link" };
  w.app.commands.commands["bob-navigation-hotkeys:open-next-link"] = { id: "open-next-link" };
  prev.fire("click");
  next.fire("click");
  await flush();
  assert.deepEqual(w.commandsRun, ["bob-navigation-hotkeys:open-prev-link", "bob-navigation-hotkeys:open-next-link"]);
  assert.equal(w.app.workspace.active.leaf, pane.leaf, "the card's pane becomes active first");
  assert.equal(w.opened.length, 0);

  next.fire("click", { ctrlKey: true });
  await flush();
  assert.deepEqual(w.opened.pop(), ["2026/20261121", DAY, "tab"], "a modified click opens like the link");
  pane.leaf.view.file = { path: WEEK };
  next.fire("click");
  await flush();
  assert.deepEqual(w.opened.pop(), ["2026/20261121", DAY, false], "a pane showing another note never runs the command");
  assert.equal(w.commandsRun.length, 2);
});

// ---- Card editor header -----------------------------------------------------------------

test("the card editor header shows the tile and species word, and repaints with the subject", () => {
  const doc = makeDoc();
  const host = doc.createElement("div");
  const options = (subjectPath) => ({
    subject: subjectPath, subjectPath, targets: [], selectedKey: "", stage: null,
    status: { statusKind: "browsing", writable: true }, fields: null,
  });
  const expected = [
    [DAY, "day", "Day", "FRI", "20"],
    [WEEK, "week", "Week", "WEEK", "47"],
    [QUARTER, "quarter", "Quarter", "QTR", "Q4"],
    [YEAR, "year", "Year", "YEAR", "2026"],
  ];
  for (const [path, kind, word, band, value] of expected) {
    H.intentionCardEditorPaintAll(host, options(path), doc, null);
    const row = host.children[0];
    assert.equal(row.className, "bob-intention-editor-identity");
    assert.equal(row.getAttribute("data-card-kind"), kind);
    assert.equal(row.querySelectorAll(".bob-property-card-identity").length, 1, "one shared badge per editor");
    const badge = row.querySelector(".bob-property-card-identity");
    assert.equal(badge.getAttribute("data-card-kind"), kind);
    assert.equal(badge.querySelector(".bob-property-card-tile").getAttribute("data-tile-form"), "leaf");
    assert.equal(badge.querySelector(".bob-property-card-tile-band").textContent, band);
    assert.equal(badge.querySelector(".bob-property-card-tile-value").textContent, value);
    assert.equal(badge.querySelector(".bob-property-card-identity-word").textContent, word);
    assert.equal(row.querySelector(".bob-property-card-kicker-species"), null, "the shared species word is used");
    assert.equal(host.children[1].tagName, "H2", "the title h2 stays");
    assert.match(host.children[1].textContent, /^Edit intentions · /);
    assert.equal(host.querySelectorAll("h1").length, 0, "the editor does not add a level-one heading");
    assert.equal(host.querySelectorAll(".bob-intention-editor-identity").length, 1, "one row per paint");
  }
});
