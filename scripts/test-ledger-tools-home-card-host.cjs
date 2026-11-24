// Home-card mount-foot unit tests (bob-cli-pl.4.1.2). Host gates, collapse,
// foot spec, links, editor seam, and no-write/no-spawn guards for the local
// Area/Project mount. Uses the same Obsidian/CodeMirror stubs as the
// presentation suites; host behavior is exercised through the mixin
// prototypes and the pure model/DOM seams without opening a vault.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ ...options }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
    EditorView: { editorAttributes: { of: (attributes) => attributes } },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const SRC = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "src");
const hostSrc = fs.readFileSync(path.join(SRC, "249d-plugin-home-card-host.js"), "utf8");
const footSrc = fs.readFileSync(path.join(SRC, "249e-plugin-home-card-foot.js"), "utf8");
const codeOnly = (text) => String(text).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

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
    const self = this;
    this.classList = {
      add(name) { const xs = new Set(self.className.split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { self.setAttribute("class", self.className.split(/\s+/).filter((x) => x && x !== name).join(" ")); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; this.appendChild(this.ownerDocument.createTextNode(value)); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name) ? true : false; }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { if (node.parentNode && typeof node.parentNode.removeChild === "function") { try { node.parentNode.removeChild(node); } catch (_) {} } node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  remove() { if (this.parentNode && typeof this.parentNode.removeChild === "function") this.parentNode.removeChild(this); }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, defaultPrevented: false, ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const cls of part.match(/\.[\w-]+/g) || []) if (!this.classList.contains(cls.slice(1))) return false;
      for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name)) return false;
        if (value !== undefined && this.getAttribute(name) !== value) return false;
      }
      return true;
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

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
}

function yaml(fields, body = "") {
  const lines = Object.entries(fields).flatMap(([key, value]) => {
    if (Array.isArray(value)) return [`${key}:`, ...value.map((item) => `  - ${item}`)];
    if (typeof value === "boolean" || typeof value === "number") return [`${key}: ${value}`];
    if (value == null) return [`${key}:`];
    return [`${key}: ${value}`];
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function areaFrontmatter(extra = {}) {
  return { type: "[[area]]", parent: "[[area]]", summary: "Family and trips.", ...extra };
}

function projectFrontmatter(extra = {}) {
  return { type: "[[project]]", parent: "[[dev]]", ...extra };
}

function projectBody() {
  return "- [ ] #task #prj Ship the post ^prj\n";
}

test("host registers one shared adapter with desktop gates and no embed display", () => {
  assert.equal(H.HOME_CARD_HOST_KIND, "home");
  assert.equal(H.HOME_CARD_READING_PRIORITY, 46);
  assert.equal(H.HOME_CARD_SURFACE_CLASS, "bob-home-card-surface");
  assert.match(hostSrc, /allowEmbedDisplay:\s*false/);
  assert.match(hostSrc, /titleOwnership:\s*true/);
  assert.equal(H.homeCardIsDesktopPlatform({ isDesktopApp: true }), true);
  assert.equal(H.homeCardIsDesktopPlatform({ isDesktopApp: false }), false);
  assert.equal(H.homeCardIsDesktopPlatform({}), false);
});

test("denied contexts never show the card", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const scope = doc.createElement("div");
  root.appendChild(scope);
  const denied = (cls) => {
    const node = doc.createElement("div");
    node.setAttribute("class", cls);
    return node;
  };
  assert.equal(H.homeCardScopeDenied(denied("markdown-embed"), root), true);
  assert.equal(H.homeCardScopeDenied(denied("hover-popover"), root), true);
  assert.equal(H.homeCardScopeDenied(denied("canvas-node"), root), true);
  assert.equal(H.homeCardScopeDenied(denied("print"), root), true);
  assert.equal(H.homeCardScopeDenied(denied("markdown-preview-view"), root), false);
});

test("the same eligibility decision drives the mount", () => {
  for (const path of ["area.md", "project.md", "bank.md", "done/old.md", "_templates/a.md"]) {
    assert.equal(H.homeCardEligible(path, { type: "[[area]]" }), null, path);
  }
  assert.ok(H.homeCardEligible("love.md", areaFrontmatter()));
  assert.ok(H.homeCardEligible("sase_blog.md", projectFrontmatter()));
  assert.equal(H.homeCardEligible("love.md", {}), null);
  assert.equal(H.homeCardEligible("love.md", { type: "[[album]]" }), null);
});

test("modifier-aware links open tabs and splits", () => {
  assert.equal(H.homeCardLinkPane(null), false);
  assert.equal(H.homeCardLinkPane({ ctrlKey: true }), true);
  assert.equal(H.homeCardLinkPane({ metaKey: true }), true);
  assert.equal(H.homeCardLinkPane({ type: "auxclick", button: 1 }), "tab");
  assert.equal(H.homeCardLinkPane({ type: "auxclick", button: 2 }), false);
});

test("collapsed cards keep kicker, title, lifecycle, and foot while summary and chips hide", () => {
  const doc = makeDoc();
  const area = H.homeCardModel({
    path: "love.md",
    frontmatter: areaFrontmatter(),
    sourceText: yaml({ type: "\"[[area]]\"", parent: "\"[[area]]\"", summary: "Family and trips." }, "# love\n"),
    hue: "yellow",
    ready: { count: 2, cap: 5, cap_source: "default", state: "room" },
    clock: new Date(2026, 10, 22, 12, 0, 0),
  });
  assert.ok(area.subtitle.text);
  const open = H.homeCardBuildEl(doc, area, { collapsed: false });
  assert.equal(open.classList.contains("is-collapsed"), false);
  const shut = H.homeCardBuildEl(doc, area, { collapsed: true, onToggleCollapse: () => {} });
  assert.equal(shut.classList.contains("is-collapsed"), true);
  const wraps = shut.querySelectorAll(".bob-home-card-collapsible");
  assert.ok(wraps.length >= 2, "summary and chip row hide inside collapsible wrappers");
  const project = H.homeCardModel({
    path: "sase_blog.md",
    frontmatter: projectFrontmatter(),
    sourceText: yaml({ type: "\"[[project]]\"", parent: "\"[[dev]]\"" }, projectBody()),
    hue: "blue",
    ready: { count: 1, cap: 5, cap_source: "note", state: "room" },
    clock: new Date(2026, 10, 22, 12, 0, 0),
  });
  assert.equal(project.subtitle.kind, "lifecycle");
  const collapsedProject = H.homeCardBuildEl(doc, project, { collapsed: true, onToggleCollapse: () => {} });
  assert.equal(collapsedProject.classList.contains("is-collapsed"), true);
  assert.ok(collapsedProject.querySelector(".bob-home-card-lifecycle"), "lifecycle stays visible when collapsed");
});

test("collapse state is a per-normalized-path session map shared across panes", () => {
  const mixin = H.BobLedgerToolsHomeCardMixin.prototype;
  const plugin = Object.create(mixin);
  plugin.homeCardCollapsed = new Map();
  plugin.scheduleHomeCardRefresh = () => {};
  assert.equal(plugin.homeCardIsCollapsed("love.md"), false);
  plugin.homeCardSetCollapsed("love.md", true);
  assert.equal(plugin.homeCardIsCollapsed("love.md"), true);
  assert.equal(plugin.homeCardIsCollapsed("./love.md"), true, "keys normalize like model paths");
  plugin.homeCardSetCollapsed("love.md", false);
  assert.equal(plugin.homeCardIsCollapsed("love.md"), false);
});

test("where-marks stay truthful and housekeeping folds into managed", () => {
  const area = H.homeCardModel({
    path: "love.md",
    frontmatter: areaFrontmatter({ color: "yellow", task_type: "CHORE", ready_cap: 5 }),
    sourceText: yaml(
      { type: "\"[[area]]\"", parent: "\"[[area]]\"", summary: "x", color: "yellow", task_type: "CHORE", ready_cap: 5 },
      "# love\n",
    ),
    hue: "yellow",
    ready: { count: 2, cap: 5, cap_source: "note", state: "room" },
    clock: new Date(2026, 10, 22, 12, 0, 0),
  });
  assert.equal(area.where.type, "tile");
  assert.equal(area.where.summary, "subtitle");
  assert.equal(area.where.color, "tint");
  assert.equal(area.where.task_type, "chip");
  assert.equal(area.where.ready_cap, "readout");
  assert.deepEqual(area.managed, H.homeCardManagedMap());
  for (const key of ["done_tasks", "template", "scheduled", "task_count", "open_task_count"]) {
    assert.equal(area.managed[key], true, key);
  }
});

test("chip handoff uses one adapter callback and renders inert text without the editor", () => {
  const doc = makeDoc();
  const model = H.homeCardModel({
    path: "love.md",
    frontmatter: areaFrontmatter({ task_type: "CHORE" }),
    sourceText: yaml({ type: "\"[[area]]\"", parent: "\"[[area]]\"", task_type: "CHORE" }, "# love\n"),
    hue: "yellow",
    ready: { count: 0, cap: 5, cap_source: "default", state: "empty" },
    clock: new Date(2026, 10, 22, 12, 0, 0),
  });
  assert.ok(model.chips.length >= 1);
  assert.equal(model.chips[0].settingKey, "task_type");
  const inert = H.homeCardBuildEl(doc, model, {});
  const inertChip = inert.querySelector(".bob-home-card-chip");
  assert.equal(inertChip.tagName, "SPAN", "absent editor API renders plain text, never a disabled control");
  let opened = null;
  const live = H.homeCardBuildEl(doc, model, {
    onOpenEditor: (request) => { opened = request; },
  });
  const button = live.querySelector(".bob-home-card-chip");
  assert.equal(button.tagName, "BUTTON");
  button.fire("click");
  assert.deepEqual(opened, { filePath: "love.md", key: "task_type", mode: "browse" });
  const mixin = H.BobLedgerToolsHomeCardMixin.prototype;
  const withoutEditor = Object.create(mixin);
  withoutEditor.openPropertyEditor = undefined;
  assert.deepEqual(withoutEditor.homeCardOpenSetting("love.md", "task_type"), { ok: false, reason: "editor-unavailable" });
});

test("title adoption never consumes ^prj and the source task offsets survive the build", () => {
  const sourceText = yaml({ type: "\"[[project]]\"", parent: "\"[[dev]]\"" }, "# Local cards\n\n- [ ] #task #prj goal ^prj\n");
  const model = H.homeCardModel({
    path: "sase_blog.md",
    frontmatter: projectFrontmatter(),
    sourceText,
    hue: "blue",
    ready: null,
    clock: new Date(2026, 10, 22, 12, 0, 0),
  });
  assert.equal(model.title.text, "Local cards");
  assert.ok(model.prj);
  assert.match(sourceText.slice(model.prj.from, model.prj.to), /\^prj/);
  assert.equal(sourceText.slice(model.title.range.from, model.title.range.to).includes("^prj"), false);
  const doc = makeDoc();
  const card = H.homeCardBuildEl(doc, model, {});
  assert.ok(card, "failed builder returns null and the caller restores the native title");
  assert.equal(H.homeCardBuildEl(doc, null), null);
  assert.equal(H.homeCardBuildEl(null, model), null);
});

test("painting introduces no writes and no card-triggered subprocesses", () => {
  const scrubbed = `${codeOnly(hostSrc)}\n${codeOnly(footSrc)}`;
  for (const banned of [
    "processFrontMatter(",
    "propertyCardFrontmatterOwnMounted(",
    "propertyCardOwnFrontmatter(",
    "propertyCardFrontmatterOwnMountedDeferred(",
    "apiAlbumSubscribe(",
    "vault.modify(",
    "vault.create(",
    "vault.delete(",
    "execFile(",
    "spawn(",
    "spawnSync(",
  ]) {
    assert.equal(scrubbed.includes(banned), false, banned);
  }
  assert.match(hostSrc, /allowEmbedDisplay:\s*false/);
  const writes = [];
  const fakeVault = {
    read: async () => yaml({ type: "\"[[area]]\"" }, "# love\n"),
    modify: async () => { writes.push("modify"); },
    create: async () => { writes.push("create"); },
    getAbstractFileByPath: (p) => ({ path: p }),
  };
  const mixin = H.BobLedgerToolsHomeCardMixin.prototype;
  const plugin = Object.create(mixin);
  plugin.app = {
    vault: fakeVault,
    metadataCache: { getFileCache: () => ({ frontmatter: areaFrontmatter() }) },
    workspace: {},
  };
  // In production both home mixins are installed; the unit plugin only
  // carries the host half, so borrow the foot frontmatter reader here.
  plugin.homeCardFrontmatter = (note) => {
    void note;
    return areaFrontmatter();
  };
  plugin.apiNoteReadyForNote = () => ({ count: 1, cap: 5, cap_source: "default", state: "room" });
  const model = plugin.homeCardModelFor("love.md", yaml({ type: "\"[[area]]\"" }, "# love\n"));
  assert.ok(model);
  const doc = makeDoc();
  assert.ok(H.homeCardBuildEl(doc, model, {}));
  assert.deepEqual(writes, [], "model and DOM paths never write");
});
