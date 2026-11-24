// Local Area/Project card DOM (bob-cli-pl.4.1 presentation).
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
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, defaultPrevented: false, order: [], ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; event.order.push("preventDefault"); };
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
    return [`${key}: ${value}`];
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function areaModel(extra = {}) {
  return H.homeCardModel({
    path: "love.md",
    frontmatter: { type: "[[area]]", summary: "Two-line summary of this area.", task_type: "BUILD", ...extra.frontmatter },
    sourceText: extra.sourceText || yaml({
      type: "\"[[area]]\"",
      summary: "Two-line summary of this area.",
      task_type: "BUILD",
      ...(extra.frontmatter || {}),
    }, "# love\n"),
    ready: Object.prototype.hasOwnProperty.call(extra, "ready")
      ? extra.ready
      : { count: 2, cap: 5, cap_source: "default", state: "room" },
    hue: extra.hue || "green",
    inbox: extra.inbox === true,
    ancestors: extra.ancestors,
    ...extra.model,
  });
}

function projectModel(extra = {}) {
  return H.homeCardModel({
    path: "sase_blog.md",
    frontmatter: { type: "[[project]]", root: extra.root === true, ...extra.frontmatter },
    sourceText: extra.sourceText || yaml({
      type: "\"[[project]]\"",
      ...(extra.root === true ? { root: true } : {}),
      ...(extra.frontmatter || {}),
    }, extra.body || "- [ ] #task #prj goal ^prj\n"),
    ready: Object.prototype.hasOwnProperty.call(extra, "ready")
      ? extra.ready
      : { count: 2, cap: 5, cap_source: "default", state: "room" },
    hue: extra.hue || "blue",
    ancestors: extra.ancestors || [{ path: "dev.md", title: "dev", kind: "area", hue: "blue" }],
    clock: extra.clock || new Date(2026, 10, 22, 12, 0, 0),
    ...extra.model,
  });
}

test("area card uses the field tile, Settings, chips, Ready, and a collapsible summary", () => {
  const doc = makeDoc();
  const opened = [];
  const card = H.homeCardBuildEl(doc, areaModel({ inbox: true }), {
    onOpenEditor: (payload) => opened.push(payload),
    onLink: () => {},
  });
  assert.equal(card.tagName, "SECTION");
  assert.ok(card.classList.contains("bob-home-card"));
  assert.ok(card.classList.contains("bob-property-card"));
  assert.equal(card.getAttribute("data-card-kind"), "area");
  assert.equal(card.getAttribute("data-home-kind"), "area");
  assert.equal(card.getAttribute("aria-label"), "Area: love");
  assert.equal(card.querySelector(".bob-property-card-tile").getAttribute("data-tile-form"), "field");
  assert.equal(card.querySelector(".bob-property-card-tile-glyph").getAttribute("data-icon"), "layers");
  assert.equal(card.querySelector(".bob-property-card-kicker-species").textContent, "Area");
  assert.equal(card.querySelector(".bob-home-card-pill").textContent, "INBOX");
  const settings = card.querySelector(".bob-home-card-settings");
  assert.equal(settings.tagName, "BUTTON");
  assert.match(settings.textContent, /Settings/);
  settings.fire("click");
  assert.deepEqual(opened, [{ filePath: "love.md", key: undefined, mode: "browse" }]);
  const chip = card.querySelector(".bob-home-card-chip");
  assert.equal(chip.textContent, "#BUILD");
  chip.fire("click");
  assert.equal(opened[1].key, "task_type");
  assert.equal(card.querySelector(".bob-home-card-ready").textContent, "2/5 ready");
  assert.equal(card.querySelector(".bob-home-card-ready").getAttribute("data-ready-state"), "room");
  const summary = card.querySelector(".bob-home-card-summary");
  assert.ok(summary);
  assert.ok(summary.parentNode.classList.contains("bob-home-card-collapsible"));
  assert.ok(card.querySelector(".bob-home-card-meta").parentNode.classList.contains("bob-home-card-collapsible"));
});

test("project card uses the pennant tile, ancestry pip, ROOT, and a visible lifecycle", () => {
  const doc = makeDoc();
  const links = [];
  const card = H.homeCardBuildEl(doc, projectModel({ root: true }), {
    onLink: (target) => links.push(target),
  });
  assert.equal(card.getAttribute("data-card-kind"), "project");
  assert.equal(card.querySelector(".bob-property-card-tile").getAttribute("data-tile-form"), "pennant");
  assert.equal(card.querySelector(".bob-property-card-tile-glyph").getAttribute("data-icon"), "target");
  assert.equal(card.querySelector(".bob-property-card-kicker-species").textContent, "Project");
  const crumb = card.querySelector(".bob-property-card-kicker-link");
  assert.equal(crumb.textContent, "dev");
  assert.equal(crumb.querySelector(".bob-property-card-kicker-pip").getAttribute("data-root-hue"), "blue");
  crumb.fire("click");
  assert.deepEqual(links, ["dev.md"]);
  assert.equal(card.querySelector(".bob-home-card-pill").textContent, "ROOT");
  const lifecycle = card.querySelector(".bob-home-card-lifecycle");
  assert.equal(lifecycle.getAttribute("data-lifecycle"), "wip");
  assert.equal(lifecycle.querySelector(".bob-home-card-lifecycle-word").textContent, "WIP");
  assert.equal(lifecycle.parentNode.classList.contains("bob-home-card-collapsible"), false);
  const settings = card.querySelector(".bob-home-card-settings");
  assert.equal(settings.tagName, "SPAN", "no editor API keeps Settings inert");
});

test("collapsed cards keep kicker, title, and lifecycle while hiding summary and chips", () => {
  const doc = makeDoc();
  const area = H.homeCardBuildEl(doc, areaModel(), { collapsed: true });
  assert.ok(area.classList.contains("is-collapsed"));
  assert.ok(area.querySelector(".bob-property-card-title"));
  assert.ok(area.querySelector(".bob-property-card-kicker"));
  assert.ok(area.querySelector(".bob-home-card-summary"));
  assert.ok(area.querySelector(".bob-home-card-meta"));
  assert.equal(area.querySelector(".bob-home-card-collapse").getAttribute("aria-expanded"), "false");

  const project = H.homeCardBuildEl(doc, projectModel(), { collapsed: true, reducedMotion: true });
  assert.ok(project.classList.contains("is-collapsed"));
  assert.ok(project.classList.contains("is-reduced-motion"));
  assert.ok(project.querySelector(".bob-home-card-lifecycle"));
  assert.ok(project.querySelector(".bob-home-card-meta").parentNode.classList.contains("bob-home-card-collapsible"));
});

test("terminal projects outline the pennant and omit the chip row", () => {
  const doc = makeDoc();
  const card = H.homeCardBuildEl(doc, projectModel({
    sourceText: yaml({ type: "\"[[project]]\"" }, "- [x] #task #prj done [completion:: 2026-11-20] ^prj\n"),
    ready: { count: 2, cap: 5, state: "room" },
  }));
  assert.ok(card.classList.contains("is-terminal"));
  assert.equal(card.querySelector(".bob-property-card-tile").getAttribute("data-tile-outline"), "true");
  assert.equal(card.querySelector(".bob-home-card-lifecycle-word").textContent, "DONE");
  assert.equal(card.querySelector(".bob-home-card-meta"), null);
  assert.equal(card.querySelector(".bob-home-card-chip"), null);
  assert.equal(card.querySelector(".bob-home-card-ready"), null);
});

test("missing ^prj, shadowed clock, and unknown Ready stay truthful in the DOM", () => {
  const doc = makeDoc();
  const missing = H.homeCardBuildEl(doc, projectModel({
    sourceText: yaml({ type: "\"[[project]]\"" }, "# Heading only\n"),
    ready: null,
  }));
  assert.equal(missing.querySelector(".bob-home-card-lifecycle").getAttribute("data-lifecycle"), "warning");
  assert.equal(missing.querySelector(".bob-home-card-lifecycle-word").textContent, "NO ^prj TASK");
  assert.match(missing.querySelector(".bob-home-card-lifecycle-detail").textContent, /add "- \[ \] #task #prj/);

  const clock = H.homeCardBuildEl(doc, projectModel({
    frontmatter: { offclock: false, offclock_types: ["MEET"] },
    sourceText: yaml({ type: "\"[[project]]\"", offclock: false, offclock_types: ["MEET"] }, "- [ ] #task #prj x ^prj\n"),
  }));
  const chip = clock.querySelector(".bob-home-card-chip");
  assert.equal(chip.getAttribute("data-warning"), "true");
  assert.match(chip.textContent, /off-clock · MEET/);
  assert.match(chip.querySelector(".bob-home-card-chip-warning").textContent, /⚠/);

  const unknown = H.homeCardBuildEl(doc, areaModel({ ready: null, frontmatter: { summary: "" }, sourceText: yaml({ type: "\"[[area]]\"" }, "# love\n") }));
  assert.equal(unknown.querySelector(".bob-home-card-ready"), null);
});

test("builder fails closed and CSS keeps field, pennant, pip, and collapse tokens", () => {
  const doc = makeDoc();
  assert.equal(H.homeCardBuildEl(doc, null), null);
  assert.equal(H.homeCardBuildEl(doc, { kind: "album", title: { text: "x" } }), null);
  assert.equal(H.homeCardBuildEl(null, areaModel()), null);
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /\.bob-property-card-tile\[data-tile-form="field"\]/);
  assert.match(css, /\.bob-property-card-tile\[data-tile-form="pennant"\]/);
  assert.match(css, /clip-path: polygon/);
  assert.match(css, /\.bob-property-card-kicker-pip \{/);
  assert.match(css, /width: 6px;/);
  assert.match(css, /\.bob-home-card\.is-collapsed \.bob-home-card-collapsible/);
  assert.match(css, /\.bob-home-card\.is-reduced-motion \.bob-home-card-collapsible/);
  assert.match(css, /\.bob-home-card-settings-label \{ display: none; \}/);
});
