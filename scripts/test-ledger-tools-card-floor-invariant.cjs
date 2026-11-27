// Card-floor invariant (bob-cli-ra cards): whenever a rail exists it is the
// card's last direct child. Covers every species in Live Preview and Reading
// shells, cabinet open/close, a lazy body, a repaint, and an in-place swap.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent(value) { return value; }
}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class {},
      Plugin: TestPlugin,
      Platform: { isDesktopApp: true },
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    return { EditorView: class {}, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

class FakeText {
  constructor(text, doc) {
    this.nodeType = 3;
    this.nodeValue = String(text);
    this.ownerDocument = doc;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
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
    this.disabled = false;
    this.isConnected = true;
    const self = this;
    this.classList = {
      add(...values) {
        const names = new Set(self.className.split(/\s+/).filter(Boolean));
        values.forEach((value) => names.add(value));
        self.className = [...names].join(" ");
      },
      remove(...values) {
        const drop = new Set(values);
        self.className = self.className.split(/\s+/).filter((value) => value && !drop.has(value)).join(" ");
      },
      contains(value) { return self.className.split(/\s+/).includes(value); },
      toggle(value, force) {
        const on = force === undefined ? !self.classList.contains(value) : force === true;
        if (on) self.classList.add(value); else self.classList.remove(value);
        return on;
      },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get textContent() { return this.childNodes.map((node) => node.textContent || "").join(""); }
  set textContent(value) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(value));
  }
  setAttribute(name, value) { this.attrs.set(String(name), String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    if (node.parentNode && typeof node.parentNode.removeChild === "function") {
      try { node.parentNode.removeChild(node); } catch (_) {}
    }
    node.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(node);
    else this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    if (node.parentNode === this) node.parentNode = null;
    return node;
  }
  remove() { this.parentNode?.removeChild?.(this); }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains?.(node)); }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  click() {
    if (this.disabled) return;
    const event = { type: "click", target: this, preventDefault() {}, stopPropagation() {} };
    for (const callback of this.listeners.get("click") || []) callback(event);
  }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(value)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const name of value.match(/\.[\w-]+/g) || []) {
        if (!this.classList.contains(name.slice(1))) return false;
      }
      for (const match of value.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g)) {
        const [, name, expected] = match;
        const actual = this.getAttribute(name);
        if (actual === null || (expected !== undefined && actual !== expected)) return false;
      }
      return true;
    });
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const parts = String(selector).trim().split(/\s+/);
    let scope = [this];
    for (const part of parts) {
      const next = [];
      for (const root of scope) {
        const visit = (node) => {
          for (const child of node.children || []) {
            if (child.matches?.(part) && !next.includes(child)) next.push(child);
            visit(child);
          }
        };
        visit(root);
      }
      scope = next;
    }
    return scope;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
}

function treeStop(path, { groupLabel = "bob", landingLabel = null, wraps = false, source = "tree", state = "exists" } = {}) {
  const landing = landingLabel || path.replace(/\.md$/i, "").split("/").pop();
  return Object.freeze({
    path,
    target: path.replace(/\.md$/i, ""),
    groupLabel,
    landingLabel: landing,
    shortLabel: landing,
    state,
    ghostReason: null,
    wraps,
    source,
  });
}

function treeProvider({ kind = "project", lane = "open", parentLabel = "bob", parentPath = "bob.md", position = 2, size = 3, index = 1, count = 2 } = {}) {
  return Object.freeze({
    ok: true,
    route: "tree",
    kind,
    lane,
    step: Object.freeze({
      prev: treeStop("bob_git.md", { groupLabel: parentLabel, landingLabel: "bob_git" }),
      next: treeStop("bob_plugins.md", { groupLabel: parentLabel, landingLabel: "bob_plugins" }),
      parent: treeStop(`${parentLabel}.md`, { groupLabel: "Top level", landingLabel: parentLabel }),
    }),
    stepNone: null,
    group: Object.freeze({
      noun: "parent",
      memberNoun: kind,
      label: parentLabel,
      shortLabel: parentLabel,
      parentPath,
      position,
      size,
      index,
      count,
      members: [
        Object.freeze({ label: "bob_git", path: "bob_git.md", state: "exists" }),
        Object.freeze({ label: "bob", path: "bob.md", state: "current" }),
        Object.freeze({ label: "bob_plugins", path: "bob_plugins.md", state: "exists" }),
      ],
      atStart: false,
      atEnd: false,
      enteringNext: null,
      enteringPrev: null,
    }),
    prevGroup: treeStop("alpha.md", { groupLabel: "pig", landingLabel: "alpha" }),
    nextGroup: treeStop("beta.md", { groupLabel: "goo", landingLabel: "beta" }),
    none: null,
  });
}

function treeAnswerFrom(provider, overrides = {}) {
  return Object.freeze({
    ok: true,
    prev: provider.step?.prev ?? null,
    next: provider.step?.next ?? null,
    prevGroup: provider.prevGroup,
    nextGroup: provider.nextGroup,
    group: provider.group,
    groupConflicts: [],
    ...overrides,
  });
}

function yaml(fields, body = "") {
  const lines = Object.entries(fields).flatMap(([key, value]) => {
    if (Array.isArray(value)) return [`${key}:`, ...value.map((item) => `  - ${item}`)];
    if (typeof value === "boolean" || typeof value === "number") return [`${key}: ${value}`];
    return [`${key}: ${value}`];
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function makePlugin(extra = {}) {
  const writes = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => [],
      on: () => ({}),
      create: () => { writes.push("create"); throw new Error("must never write"); },
      modify: () => { writes.push("modify"); throw new Error("must never write"); },
      delete: () => { writes.push("delete"); throw new Error("must never write"); },
    },
    metadataCache: { getFileCache: () => null, on: () => ({}) },
    workspace: { onLayoutReady: (fn) => fn(), openLinkText: async () => {} },
    commands: { commands: {}, executeCommandById: () => false },
    plugins: { plugins: {} },
  };
  plugin.dependencyNavApi = () => null;
  plugin.navGroupsResolve = extra.navGroupsResolve || (() => treeProvider(extra.provider || {}));
  plugin.spawnBob = async () => { writes.push("spawn"); throw new Error("must never spawn"); };
  plugin.homeCardSourceCache = new Map();
  plugin.notebookCardSourceCache = new Map();
  plugin.proseNoteCardSourceCache = new Map();
  plugin.scheduleHomeCardRefresh = () => {};
  plugin.treeWalkRailMounted = new Map();
  plugin.treeWalkRailSubscribed = false;
  plugin._writes = writes;
  Object.assign(plugin, extra);
  return plugin;
}

function speciesCard(doc, kind, path) {
  const card = doc.createElement("section");
  card.setAttribute("class", "bob-property-card");
  card.setAttribute("data-card-kind", kind);
  card.setAttribute("data-card-path", path);
  const identity = doc.createElement("header");
  identity.setAttribute("class", "bob-property-card-title-block");
  card.appendChild(identity);
  const body = doc.createElement("div");
  body.setAttribute("class", "bob-property-card-body");
  card.appendChild(body);
  return card;
}

function place(doc, card, view) {
  const root = doc.createElement("div");
  root.setAttribute("class", view === "lp" ? "markdown-source-view" : "markdown-preview-view");
  const sizer = doc.createElement("div");
  sizer.setAttribute("class", view === "lp" ? "cm-contentContainer" : "markdown-preview-sizer");
  sizer.appendChild(card);
  root.appendChild(sizer);
  return root;
}

function assertFloor(card, label) {
  const floor = H.propertyCardFloorOf(card);
  assert.ok(floor, `${label}: a floor rail exists`);
  assert.equal(floor.getAttribute("data-card-floor"), "link-walk", `${label}: floor attr`);
  assert.equal(card.children.at(-1), floor, `${label}: the rail is the last direct child`);
  return floor;
}

function assertNoFloor(card, label) {
  assert.equal(H.propertyCardFloorOf(card), null, `${label}: no floor`);
  assert.ok(!card.children.some((child) => child.getAttribute?.("data-card-floor") === "link-walk"), `${label}: no floor child`);
}

const SPECIES = [
  { kind: "area", path: "love.md", rail: "tree" },
  { kind: "project", path: "sase_blog.md", rail: "tree" },
  { kind: "notebook", path: "Notes/Developer_tools.md", rail: "tree" },
  { kind: "prose", path: "notes/Launch.md", rail: "tree" },
  { kind: "day", path: "2026/20261120.md", rail: "calendar" },
  { kind: "week", path: "2026/2026-W47.md", rail: "calendar" },
  { kind: "quarter", path: "2026/2026-Q4.md", rail: "calendar" },
  { kind: "year", path: "2026.md", rail: "calendar" },
  { kind: "album", path: "eat.md", rail: "none" },
  { kind: "record", path: "eat/nagi.md", rail: "record" },
  { kind: "bank", path: "bank.md", rail: "none" },
  { kind: "ref", path: "ref/agentic-coding-ci.md", rail: "none" },
];

function dockSynthetic(doc, card) {
  const rail = doc.createElement("nav");
  rail.setAttribute("class", "bob-property-card-rail");
  return H.propertyCardFloorDock(card, rail);
}

test("every species keeps a docked rail last in Live Preview and Reading", () => {
  const plugin = makePlugin();
  for (const view of ["lp", "reading"]) {
    for (const item of SPECIES) {
      const doc = makeDoc();
      const card = speciesCard(doc, item.kind, item.path);
      place(doc, card, view);
      const label = `${item.kind} ${view}`;
      if (item.rail === "none") {
        assertNoFloor(card, `${label} before dock`);
        const cabinets = doc.createElement("div");
        cabinets.setAttribute("class", "bob-property-card-cabinets");
        H.propertyCardFloorAppend(card, cabinets);
        assert.equal(card.children.at(-1), cabinets, `${label}: no rail, stack is last`);
        dockSynthetic(doc, card);
        H.propertyCardFloorAppend(card, doc.createElement("section"));
        assertFloor(card, `${label} after a later dock`);
        continue;
      }
      if (item.rail === "tree") {
        const mounted = plugin.treeWalkRailMountOnCard(card, item.path, () => "");
        assert.ok(mounted, `${label}: tree rail mounts`);
        assert.ok(mounted.classList.contains("bob-link-walk-rail"), `${label}: tree class`);
      } else {
        dockSynthetic(doc, card);
      }
      const cabinets = doc.createElement("div");
      cabinets.setAttribute("class", "bob-property-card-cabinets");
      H.propertyCardFloorAppend(card, cabinets);
      const lazy = doc.createElement("div");
      lazy.setAttribute("class", "bob-property-card-lazy-body");
      H.propertyCardFloorAppend(card, lazy);
      assertFloor(card, label);
      assert.ok(card.children.includes(cabinets), `${label}: cabinets stay on the card`);
      assert.notEqual(card.children.at(-1), cabinets, `${label}: cabinets sit above the floor`);
    }
  }
  plugin.treeWalkRailTeardown();
  assert.deepEqual(plugin._writes, []);
});

test("area, project, notebook, and prose hosts mount the tree rail as the floor", () => {
  const plugin = makePlugin();
  const doc = makeDoc();

  const area = H.homeCardBuildEl(doc, H.homeCardModel({
    path: "love.md",
    frontmatter: { type: "[[area]]", summary: "Family." },
    sourceText: yaml({ type: "\"[[area]]\"", summary: "Family." }, "# love\n"),
    hue: "yellow",
    ready: { count: 2, cap: 5, cap_source: "default", state: "room" },
  }));
  assert.ok(area);
  plugin.treeWalkRailMountOnCard(area, "love.md", () => "");
  assertFloor(area, "area BuildEl");

  const project = H.homeCardBuildEl(doc, H.homeCardModel({
    path: "sase_blog.md",
    frontmatter: { type: "[[project]]", parent: "[[dev]]" },
    sourceText: yaml({ type: "\"[[project]]\"", parent: "\"[[dev]]\"" }, "- [ ] #task #prj Ship ^prj\n"),
    hue: "blue",
    ready: { count: 1, cap: 5, cap_source: "note", state: "room" },
    ancestors: [{ path: "dev.md", title: "dev", kind: "area", hue: "blue" }],
    clock: new Date(2026, 10, 22, 12, 0, 0),
  }));
  plugin.treeWalkRailMountOnCard(project, "sase_blog.md", () => "");
  assertFloor(project, "project BuildEl");

  const notebook = H.notebookCardBuildEl(doc, H.notebookCardModel({
    path: "Notes/Developer_tools.md",
    frontmatter: { type: "[[notebook]]", summary: "A short summary" },
    sourceText: "---\ntype: [[notebook]]\nsummary: A short summary\n---\n# Opening Title\n",
    headerModel: { crumbs: [{ kind: "root", path: "Areas/Dev.md", title: "Development" }] },
    hue: "green",
  }), {
    appendFoot: (parent, _model, ownerDoc) => {
      const foot = ownerDoc.createElement("div");
      foot.setAttribute("class", "bob-property-card-foot");
      parent.appendChild(foot);
    },
  });
  plugin.treeWalkRailMountOnCard(notebook, "Notes/Developer_tools.md", () => "");
  assertFloor(notebook, "notebook BuildEl");
  assert.ok(notebook.querySelector(".bob-property-card-foot"), "the foot stays above the floor");

  const prose = H.proseNoteCardBuildEl(doc, H.proseNoteCardModel({
    path: "notes/Launch.md",
    frontmatter: { type: "[[prose]]", title: "Launch" },
  }));
  plugin.treeWalkRailMountOnCard(prose, "notes/Launch.md", () => "");
  assertFloor(prose, "prose BuildEl");

  const built = plugin.homeCardBuildMounted(H.homeCardModel({
    path: "love.md",
    frontmatter: { type: "[[area]]", summary: "Family." },
    sourceText: yaml({ type: "\"[[area]]\"", summary: "Family." }, "# love\n"),
    hue: "yellow",
    ready: { count: 2, cap: 5, cap_source: "default", state: "room" },
  }), { sourceText: yaml({ type: "\"[[area]]\"", summary: "Family." }, "# love\n") }, doc);
  assert.ok(built);
  assertFloor(built, "homeCardBuildMounted");
  plugin.treeWalkRailTeardown();
});

test("day and period cards dock the rail as the floor", () => {
  const doc = makeDoc();
  for (const kind of ["day", "week", "quarter", "year"]) {
    const card = speciesCard(doc, kind, `2026/${kind}.md`);
    const stack = doc.createElement("div");
    stack.setAttribute("class", "bob-property-card-cabinets");
    const foot = doc.createElement("div");
    foot.setAttribute("class", "bob-property-card-foot");
    foot.setAttribute("data-cabinet-kind", "properties");
    stack.appendChild(foot);
    card.appendChild(stack);
    const built = H.propertyCardBuildRail(doc, {
      label: `${kind} navigation`,
      prev: { label: "prev", target: "prev" },
      next: { label: "next", target: "next" },
    });
    assert.ok(built?.element, `${kind} rail builds`);
    H.propertyCardFloorDock(card, built.element);
    H.propertyCardFloorAppend(card, doc.createElement("section"));
    assertFloor(card, kind);
    assert.ok(card.querySelector(".bob-property-card-cabinets"), `${kind}: cabinets sit above the floor`);
  }
});

test("record Live Preview docks the rail; Reading's paragraph fallback stays in-body", () => {
  const plugin = makePlugin();
  const doc = makeDoc();
  const sheet = doc.createElement("section");
  sheet.setAttribute("class", "bob-record-sheet bob-property-card");
  sheet.setAttribute("data-card-kind", "record");
  const foot = doc.createElement("div");
  foot.setAttribute("class", "bob-property-card-foot");
  sheet.appendChild(foot);
  const walk = {
    lineIndex: 0,
    lineState: "current",
    path: "eat/0.md",
    state: "current",
    album: { title: "Restaurants", hue: "blue", stem: "eat", emoji: "" },
    position: 1,
    size: 2,
    prev: { target: "eat/1", title: "Bravo", wraps: true, ariaLabel: "Bravo", tooltip: "prev" },
    next: { target: "eat/1", title: "Bravo", wraps: true, ariaLabel: "Bravo", tooltip: "next" },
    writtenLinks: [
      { target: "eat/1", label: "‹ Bravo" },
      { target: "eat/1", label: "Bravo ›" },
    ],
  };
  const rail = H.recordWalkRailBuildEl(walk, { hue: "blue" }, doc);
  assert.ok(rail, "a record rail builds");
  H.propertyCardFloorDock(sheet, rail);
  H.propertyCardFloorAppend(sheet, doc.createElement("div"));
  assertFloor(sheet, "record LP");

  const root = doc.createElement("div");
  const paragraph = doc.createElement("p");
  for (const [index, link] of walk.writtenLinks.entries()) {
    if (index) paragraph.appendChild(doc.createTextNode(" · "));
    const anchor = doc.createElement("a");
    anchor.setAttribute("class", "internal-link");
    anchor.setAttribute("data-href", link.target);
    anchor.setAttribute("href", link.target);
    anchor.appendChild(doc.createTextNode(link.label));
    paragraph.appendChild(anchor);
  }
  root.appendChild(paragraph);
  plugin.recordWalkFor = () => walk;
  plugin.recordSheetNodeBelongs = () => true;
  plugin.recordWalkOptions = () => ({ hue: "blue" });
  const painted = plugin.recordWalkPaintReading(root, "eat/0.md", null);
  assert.ok(painted);
  assert.equal(painted.parentNode, root, "paragraph-fallback stays in-body");
  assert.equal(root.childNodes.indexOf(painted) < root.childNodes.indexOf(paragraph), true, "fallback sits before the paragraph");
  assert.equal(painted.getAttribute("data-card-floor"), null, "in-body fallback is not the card floor");
});

test("cabinet open, close, lazy body, repaint, and in-place swap keep the rail last", () => {
  H.propertyCardCabinetStateResetForTests?.();
  H.propertyCardCabinetProvidersResetForTests?.();
  const plugin = makePlugin();
  const doc = makeDoc();
  const path = "love.md";
  const builds = { areas: 0 };
  H.propertyCardRegisterCabinetProvider(plugin, "areas", {
    applies: () => ({ summary: "3 · 1 nested" }),
    paintKey: () => "areas-v1",
    buildBody({ doc: bodyDoc, container }) {
      builds.areas += 1;
      const row = bodyDoc.createElement("li");
      row.textContent = "areas row";
      container.appendChild(row);
    },
  });
  const paint = () => {
    const card = speciesCard(doc, "area", path);
    plugin.treeWalkRailMountOnCard(card, path, () => "");
    const foot = H.propertyCardFootBuildEl(doc, {
      path,
      disclosureId: "floor-foot",
      open: false,
      keyLive: true,
      inventory: { count: 4, rows: [], groups: [], issues: [] },
      handlers: { onToggle: (_path, next) => next },
    });
    H.propertyCardFloorAppend(card, foot.element);
    const stack = H.propertyCardCabinetsAssemble(card, path, foot.element, {
      plugin, view: { file: { path }, dom: card }, component: plugin, keyLive: true,
      source: yaml({ type: "\"[[area]]\"" }, "# love\n"),
      frontmatter: { type: "[[area]]" },
      repaint: () => true,
    });
    return { card, stack };
  };

  let { card, stack } = paint();
  assertFloor(card, "after assemble");
  assert.ok(stack);
  assert.notEqual(card.children.at(-1), stack);

  const toggle = stack.querySelector("[data-cabinet-kind='areas'] .bob-cabinet-toggle");
  assert.ok(toggle, "areas cabinet has a toggle");
  toggle.click();
  assert.equal(H.propertyCardCabinetIsOpen(path, "areas"), true);
  ({ card, stack } = paint());
  assertFloor(card, "after open repaint");
  assert.ok(builds.areas >= 1, "lazy body mounts on open");

  stack.querySelector("[data-cabinet-kind='areas'] .bob-cabinet-toggle").click();
  assert.equal(H.propertyCardCabinetIsOpen(path, "areas"), false);
  ({ card } = paint());
  assertFloor(card, "after close repaint");

  const first = H.propertyCardFloorOf(card);
  plugin.navGroupsResolve = () => {
    const provider = treeProvider();
    return Object.freeze({
      ...provider,
      step: Object.freeze({
        ...provider.step,
        next: treeStop("other.md", { groupLabel: "bob", landingLabel: "other" }),
      }),
    });
  };
  assert.equal(plugin.treeWalkRailRefresh(path), true, "signature change swaps the rail");
  const second = assertFloor(card, "after in-place swap");
  assert.notEqual(second, first, "the swapped rail is a new node");
  assert.equal(second.parentNode, card);

  H.propertyCardCabinetProvidersReleasePlugin?.(plugin);
  H.propertyCardCabinetStateResetForTests?.();
  H.propertyCardFootResetAll?.();
  plugin.treeWalkRailTeardown();
  assert.deepEqual(plugin._writes, []);
});

test("a rail failure leaves the card as it was, and teardown untracks", () => {
  const plugin = makePlugin();
  const doc = makeDoc();
  const card = speciesCard(doc, "area", "love.md");
  const before = [...card.children];
  plugin.treeWalkRailModelFor = () => null;
  assert.equal(plugin.treeWalkRailMountOnCard(card, "love.md", () => ""), null);
  assert.deepEqual(card.children, before, "a cold model does not mutate the card");
  assertNoFloor(card, "failed mount");

  plugin.treeWalkRailModelFor = LedgerToolsPlugin.prototype.treeWalkRailModelFor;
  plugin.treeWalkRailMountOnCard(card, "love.md", () => "");
  assertFloor(card, "successful remount");
  assert.ok(plugin.treeWalkRailMountedMap().has("love.md"));
  plugin.treeWalkRailBind(null, "love.md");
  assert.equal(plugin.treeWalkRailMountedMap().has("love.md"), false, "bind(null) untracks");

  plugin.treeWalkRailMountOnCard(card, "love.md", () => "");
  plugin.treeWalkRailTeardown();
  assert.equal(plugin.treeWalkRailMountedMap().size, 0);
  assert.equal(plugin.treeWalkRailSubscribed, false);
});
