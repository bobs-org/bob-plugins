"use strict";

// Unit tests for the Reading inline-paint deferral (bob-cli-qq perf phase):
// skip the synchronous inline painter when a cabinet will own the catalog,
// repaint the native callout only when no cabinet absorption covers it, and
// keep every fail-open path on today's painted catalog.

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

// The bundle destructures MarkdownRenderChild from "obsidian", so the
// unload-cancel path is covered by stubbing it there.
const addedChildren = [];
class StubRenderChild {
  constructor(el) {
    this.el = el;
    this.onunload = null;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, MarkdownRenderChild: StubRenderChild, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

function matchPart(node, part) {
  const re = /\.([A-Za-z0-9_-]+)|\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/g;
  let found = false;
  let m;
  while ((m = re.exec(part))) {
    found = true;
    if (m[1] !== undefined) {
      const classes = String(node.className || "").split(/\s+/).filter(Boolean);
      if (!classes.includes(m[1])) return false;
    } else {
      const actual = node.getAttribute(m[2]);
      if (actual === null || actual === undefined) return false;
      if (m[3] !== undefined && actual !== m[3]) return false;
    }
  }
  return found;
}

function matchesSelector(node, selector) {
  return String(selector).split(",").map((part) => part.trim()).filter(Boolean)
    .some((part) => matchPart(node, part));
}

class FakeNode {
  constructor(tag = "div", attrs = {}, className = "") {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.attrs = { ...attrs };
    this.className = className;
    this.children = [];
    this.parent = null;
    this.isConnected = true;
  }
  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  matches(selector) {
    return matchesSelector(this, selector);
  }
  closest(selector) {
    let node = this;
    while (node) {
      try {
        if (typeof node.matches === "function" && node.matches(selector)) return node;
      } catch (_) {}
      node = node.parent;
    }
    return null;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        try {
          if (child.nodeType === 1 && child.matches(selector)) out.push(child);
        } catch (_) {}
        visit(child);
      }
    };
    visit(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function fakeDoc() {
  return {
    createElement: () => new FakeNode(),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  };
}

// A Reading section inside a main preview view: preview > section > callout.
function readingSection(kind = "projects") {
  const preview = new FakeNode("div", {}, "markdown-preview-view");
  const section = new FakeNode("div", {}, "el");
  const callout = new FakeNode("div", { "data-callout": kind }, "callout");
  callout.setAttribute("data-callout", kind);
  section.appendChild(callout);
  preview.appendChild(section);
  return { preview, section, callout };
}

// Reading contexts carry the note's frontmatter like Obsidian's: deferral
// applies only to a note whose card can own the catalog.
function readingCtx(path, children = addedChildren, extra = {}) {
  return {
    sourcePath: path,
    frontmatter: { type: String(path).startsWith("Albums/") ? "[[album]]" : "[[area]]" },
    addChild: (child) => { children.push(child); },
    ...extra,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("an untyped host never defers the inline paint", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(5);
  try {
    // The root area.md and other untyped hosts keep native catalogs, so their
    // inline painter always runs synchronously.
    const { section } = readingSection("projects");
    let paints = 0;
    const deferred = H.propertyCardCabinetDeferInlinePaint(
      section, readingCtx("area.md", addedChildren, { frontmatter: {} }), "projects", () => { paints += 1; });
    assert.equal(deferred, false);
    await sleep(30);
    assert.equal(paints, 0);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("an eligible Reading paint defers instead of painting synchronously", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(10000);
  try {
    const { section } = readingSection("projects");
    let paints = 0;
    const deferred = H.propertyCardCabinetDeferInlinePaint(
      section, readingCtx("Areas/work.md"), "projects", () => { paints += 1; });
    assert.equal(deferred, true);
    assert.equal(paints, 0);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("fallback paints the native callout when no cabinet covers it", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(5);
  try {
    const { section } = readingSection("projects");
    let paints = 0;
    const deferred = H.propertyCardCabinetDeferInlinePaint(
      section, readingCtx("Areas/work.md"), "projects", () => { paints += 1; });
    assert.equal(deferred, true);
    await sleep(40);
    assert.equal(paints, 1);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("fallback never paints an absorbed callout the cabinet owns", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(5);
  try {
    const { section, callout } = readingSection("projects");
    callout.className = "callout bob-cabinet-absorbed";
    let paints = 0;
    const deferred = H.propertyCardCabinetDeferInlinePaint(
      section, readingCtx("Areas/work.md"), "projects", () => { paints += 1; });
    assert.equal(deferred, true);
    await sleep(40);
    assert.equal(paints, 0);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("fallback waits while the stack is mounted, then paints when absorption never lands", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(5);
  try {
    const { section } = readingSection("projects");
    const stack = new FakeNode("div", { "data-cabinet-source": "Areas/work.md" }, "bob-property-card-cabinets");
    const panel = new FakeNode("div", { "data-cabinet-kind": "projects", "data-cabinet-source": "Areas/work.md" }, "");
    stack.appendChild(panel);
    section.appendChild(stack);
    let paints = 0;
    const deferred = H.propertyCardCabinetDeferInlinePaint(
      section, readingCtx("Areas/work.md"), "projects", () => { paints += 1; });
    assert.equal(deferred, true);
    await sleep(20);
    assert.equal(paints, 0);
    await sleep(80);
    assert.equal(paints, 1);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("fail-open contexts never defer: embeds, canvas, editors, and bare sections", () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(5);
  try {
    const noop = () => {};
    const inside = (hostClass) => {
      const host = new FakeNode("div", {}, hostClass);
      const section = new FakeNode("div", {}, "");
      host.appendChild(section);
      return section;
    };
    assert.equal(H.propertyCardCabinetDeferInlinePaint(
      inside("markdown-embed"), readingCtx("Areas/work.md"), "projects", noop), false);
    assert.equal(H.propertyCardCabinetDeferInlinePaint(
      inside("canvas-node"), readingCtx("Areas/work.md"), "projects", noop), false);
    assert.equal(H.propertyCardCabinetDeferInlinePaint(
      inside("cm-editor"), readingCtx("Areas/work.md"), "projects", noop), false);
    assert.equal(H.propertyCardCabinetDeferInlinePaint(
      inside("print"), readingCtx("Areas/work.md"), "projects", noop), false);
    assert.equal(H.propertyCardCabinetDeferInlinePaint(
      new FakeNode("div"), readingCtx("Areas/work.md"), "projects", noop), false);
    assert.equal(H.propertyCardCabinetDeferInlinePaint(
      readingSection("projects").section, { sourcePath: "" }, "projects", noop), false);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("unload cancels the pending fallback paint", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(5);
  const localChildren = [];
  try {
    const { section } = readingSection("records");
    let paints = 0;
    const deferred = H.propertyCardCabinetDeferInlinePaint(
      section, readingCtx("Albums/evening.md", localChildren), "records", () => { paints += 1; });
    assert.equal(deferred, true);
    assert.equal(localChildren.length, 1);
    section.isConnected = false;
    localChildren[0].onunload();
    await sleep(40);
    assert.equal(paints, 0);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("failed cabinet body releases the claim and repaints the native callout", async () => {
  const doc = fakeDoc();
  const container = new FakeNode("div", {}, "");
  const calls = [];
  const outcome = await H.propertyCardCabinetRenderCatalog({
    plugin: {},
    doc,
    container,
    path: "Areas/work.md",
    regionSource: "> [!projects]\n> - [[a]]",
    paint: () => { throw new Error("boom"); },
    paintKey: "key",
    releaseClaim: () => { calls.push("release"); },
    repaintNative: () => { calls.push("repaint"); },
  });
  assert.deepEqual(outcome, { reused: false, failed: true });
  assert.deepEqual(calls, ["release", "repaint"]);
  assert.equal(container.children.filter((child) =>
    child.getAttribute && child.getAttribute("class") === "bob-cabinet-body-failure").length, 1);
});

test("release-time repaint is passive: no vault or workspace access", () => {
  const boom = new Proxy({}, { get: () => { throw new Error("must stay passive"); } });
  const scheduled = [];
  H.propertyCardCabinetHostRepaintNative({
    scheduleAreasCatalogRefresh: () => { scheduled.push("areas"); },
    scheduleProjectsCatalogRefresh: () => { scheduled.push("projects"); },
    scheduleNotebookCatalogRefresh: () => { scheduled.push("notebooks"); },
    scheduleAlbumCatalogRefresh: () => { scheduled.push("albums"); },
    app: { vault: boom, workspace: boom },
  }, "projects");
  assert.deepEqual(scheduled, ["projects"]);
});

test("same-path projects re-render keeps the deferred paint deferred", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(10000);
  try {
    const { section } = readingSection("projects");
    let paints = 0;
    const self = {
      projectsCatalogActive: true,
      projectsCatalogReading: new Set(),
      projectsCatalogFoldMap: () => ({}),
      paintProjectsCatalogReading: () => { paints += 1; },
      app: {},
    };
    const render = LedgerToolsPlugin.prototype.renderProjectsCatalogInReading;
    render.call(self, section, readingCtx("Areas/work.md"));
    assert.equal(paints, 0);
    render.call(self, section, readingCtx("Areas/work.md"));
    assert.equal(paints, 0);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});

test("same-path records re-render keeps the deferred paint deferred", async () => {
  H.propertyCardCabinetInlineFallbackSetDelayForTests(10000);
  try {
    const { section } = readingSection("records");
    let paints = 0;
    const self = {
      albumRecordsActive: true,
      albumRecordsReading: new Set(),
      albumRecordsFoldMap: () => ({}),
      paintAlbumRecordsReading: () => { paints += 1; },
    };
    const render = LedgerToolsPlugin.prototype.renderAlbumRecordsInReading;
    render.call(self, section, readingCtx("Albums/evening.md"));
    assert.equal(paints, 0);
    render.call(self, section, readingCtx("Albums/evening.md"));
    assert.equal(paints, 0);
    render.call(self, section, { ...readingCtx("Albums/evening.md"),
      getSectionInfo: () => ({ text: "Embedded paragraph. ^para" }) });
    assert.equal(paints, 1);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
  }
});
