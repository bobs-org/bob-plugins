"use strict";

// Unit tests for the gate-open Reading paint budget (bob-cli-qq perf):
// a hidden Live Preview editor defers opted-in cabinet bodies until it
// shows, detached Reading sections defer their inline paint through the
// render container, a Reading body clones the note's unpainted stored
// callout instead of rendering it again, the host paintKey digest is
// memoized by report identity, and the Records body tags its Reading
// absorption before its card is inserted.

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

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

// A small DOM: class-aware compound selectors (tag, .class, [attr], [attr="v"])
// joined by commas, descendant search, cloning, and connection by root.
function parseCompound(part) {
  const out = { tag: null, classes: [], attrs: [] };
  const tag = /^[A-Za-z][A-Za-z0-9]*/.exec(part);
  if (tag) out.tag = tag[0].toUpperCase();
  const re = /\.([A-Za-z0-9_-]+)|\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/g;
  let m;
  while ((m = re.exec(part))) {
    if (m[1] !== undefined) out.classes.push(m[1]);
    else out.attrs.push([m[2], m[3]]);
  }
  return out;
}

class MiniNode {
  constructor(tag = "div", attrs = {}, doc = null) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.attrs = new Map(Object.entries(attrs).map(([key, value]) => [key, String(value)]));
    this.children = [];
    this.parentNode = null;
    this.connectedRoot = false;
    this.style = {};
    this.ownerDocument = doc || miniDoc();
    const node = this;
    this.classList = {
      add: (...names) => { const set = node.classSet(); for (const name of names) set.add(name); node.writeClasses(set); },
      remove: (...names) => { const set = node.classSet(); for (const name of names) set.delete(name); node.writeClasses(set); },
      contains: (name) => node.classSet().has(name),
    };
  }
  classSet() { return new Set(String(this.attrs.get("class") || "").split(/\s+/).filter(Boolean)); }
  writeClasses(set) { this.attrs.set("class", Array.from(set).join(" ")); }
  get className() { return this.attrs.get("class") || ""; }
  set className(value) { this.attrs.set("class", String(value)); }
  get attributes() { return Array.from(this.attrs.entries()).map(([name, value]) => ({ name, value })); }
  get isConnected() {
    let node = this;
    while (node) {
      if (node.connectedRoot) return true;
      node = node.parentNode;
    }
    return false;
  }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.children[0] || null; }
  get childElementCount() { return this.children.length; }
  get textContent() { return this.children.map((child) => child.textContent || "").join(""); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  matchesCompound(part) {
    const spec = parseCompound(part.trim());
    if (spec.tag && spec.tag !== this.tagName) return false;
    const classes = this.classSet();
    if (spec.classes.some((name) => !classes.has(name))) return false;
    return spec.attrs.every(([name, value]) => this.attrs.has(name) && (value === undefined || this.attrs.get(name) === value));
  }
  matches(selector) { return String(selector).split(",").some((part) => part.trim() && this.matchesCompound(part)); }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.nodeType === 1 && child.matches(selector)) out.push(child);
        if (child.children) visit(child);
      }
    };
    visit(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  cloneNode(deep) {
    const copy = new MiniNode(this.tagName, Object.fromEntries(this.attrs), this.ownerDocument);
    if (deep) for (const child of this.children) copy.appendChild(child.cloneNode(true));
    return copy;
  }
}

class MiniText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
    this.children = [];
    this.parentNode = null;
  }
  cloneNode() { return new MiniText(this.textContent); }
}

function miniDoc() {
  const doc = {
    createElement: (tag) => new MiniNode(tag, {}, doc),
    createTextNode: (text) => new MiniText(text),
  };
  return doc;
}

function el(tag, attrs = {}, children = []) {
  const node = new MiniNode(tag, attrs);
  for (const child of children) node.appendChild(child);
  return node;
}

// A native Reading render of one stored catalog callout, with the Reading
// chrome Obsidian adds and MarkdownRenderer omits.
function nativeCallout(kind = "records", extraAttrs = {}) {
  const item = (n) => el("li", { "data-line": String(n), dir: "auto" }, [
    el("span", { class: "list-bullet" }),
    el("a", { class: "internal-link", "data-href": `eat/place-${n}` }, [new MiniText(`Place ${n}`)]),
  ]);
  return el("div", { class: "callout node-insert-event", "data-callout": kind, ...extraAttrs }, [
    el("div", { class: "callout-title" }, [el("div", { class: "callout-title-inner" }, [new MiniText("Records")])]),
    el("div", { class: "callout-content" }, [el("ul", { class: "has-list-bullet" }, [item(1), item(2), item(3)])]),
  ]);
}

// preview > sizer > section > callout, connected like a live Reading view.
function readingView(callout) {
  const preview = el("div", { class: "markdown-preview-view" });
  const sizer = el("div", { class: "markdown-preview-sizer" });
  const section = el("div", { class: "el-div" }, [callout]);
  sizer.appendChild(section);
  preview.appendChild(sizer);
  preview.connectedRoot = true;
  return { preview, sizer, section };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a detached Reading section defers through its render container", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetInlineFallbackSetDelayForTests(10000);
  try {
    const { preview } = readingView(el("div"));
    const detached = el("div", { class: "el-div" }, [nativeCallout("projects")]);
    const ctx = (containerEl, type = "[[project]]") => ({
      sourcePath: "Projects/sase.md", frontmatter: { type }, containerEl, addChild: () => {},
    });
    assert.equal(detached.isConnected, false);
    assert.equal(H.propertyCardCabinetInlineEligible(detached, ctx(preview)), true);
    assert.equal(H.propertyCardCabinetDeferInlinePaint(detached, ctx(preview), "projects", () => {}), true);
    // Embeds, hover popovers, and our own cabinet-body renders never defer.
    const embed = el("div", { class: "markdown-embed" }, [el("div", { class: "markdown-preview-view" })]);
    embed.connectedRoot = true;
    assert.equal(H.propertyCardCabinetInlineEligible(detached, ctx(embed.children[0])), false);
    const popover = el("div", { class: "hover-popover" }, [el("div", { class: "markdown-preview-view" })]);
    assert.equal(H.propertyCardCabinetInlineEligible(detached, ctx(popover.children[0])), false);
    const body = el("div", { class: "bob-cabinet-body-source" });
    preview.appendChild(el("div", { class: "bob-property-card" }, [body]));
    assert.equal(H.propertyCardCabinetInlineEligible(detached, ctx(body)), false);
    assert.equal(H.propertyCardCabinetInlineEligible(detached, ctx(null)), false);
    // A connected section outside any preview still never defers.
    const loose = el("div");
    loose.connectedRoot = true;
    assert.equal(H.propertyCardCabinetInlineEligible(loose, ctx(preview)), false);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
    H.propertyCardCabinetsSetGateForTests(false);
  }
});

test("only a note whose card can own the catalog defers its inline paint", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetInlineFallbackSetDelayForTests(10000);
  try {
    const { preview } = readingView(el("div"));
    const section = () => el("div", { class: "el-div" }, [nativeCallout("projects")]);
    const ctx = (frontmatter) => ({ sourcePath: "x.md", frontmatter, containerEl: preview, addChild: () => {} });
    assert.equal(H.propertyCardCabinetInlineHostTyped(ctx({ type: "[[area]]" }), "projects"), true);
    assert.equal(H.propertyCardCabinetInlineHostTyped(ctx({ type: "[[Types/project|Project]]" }), "projects"), true);
    assert.equal(H.propertyCardCabinetInlineHostTyped(ctx({ type: ["[[album]]"] }), "records"), true);
    assert.equal(H.propertyCardCabinetInlineHostTyped(ctx({ type: "[[album]]" }), "projects"), false);
    assert.equal(H.propertyCardCabinetInlineHostTyped(ctx({ type: "[[note]]" }), "records"), false);
    assert.equal(H.propertyCardCabinetInlineHostTyped(ctx(null), "projects"), false);
    let paints = 0;
    assert.equal(H.propertyCardCabinetDeferInlinePaint(section(), ctx({ type: "[[note]]" }), "projects", () => { paints += 1; }), false);
    assert.equal(H.propertyCardCabinetDeferInlinePaint(section(), ctx(undefined), "projects", () => { paints += 1; }), false);
    assert.equal(paints, 0);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
    H.propertyCardCabinetsSetGateForTests(false);
  }
});

test("a deferred section inserted late still paints when no cabinet claims it", async () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetInlineFallbackSetDelayForTests(5);
  try {
    const { preview, sizer } = readingView(el("div"));
    const section = el("div", { class: "el-div" }, [nativeCallout("projects")]);
    let paints = 0;
    const deferred = H.propertyCardCabinetDeferInlinePaint(section, {
      sourcePath: "Projects/sase.md", frontmatter: { type: "[[project]]" }, containerEl: preview, addChild: () => {},
    }, "projects", () => { paints += 1; });
    assert.equal(deferred, true);
    await sleep(8);
    assert.equal(paints, 0);
    sizer.appendChild(section);
    await sleep(60);
    assert.equal(paints, 1);
  } finally {
    H.propertyCardCabinetInlineFallbackResetForTests();
    H.propertyCardCabinetsSetGateForTests(false);
  }
});

test("a clone of the native callout drops Reading chrome and the absorption tag", () => {
  const native = nativeCallout("records");
  native.classList.add("bob-cabinet-absorbed");
  readingView(native);
  const copy = H.propertyCardCabinetCloneNativeCallout(native, "records");
  assert.ok(copy);
  assert.notEqual(copy, native);
  assert.equal(copy.classList.contains("callout"), true);
  assert.equal(copy.classList.contains("bob-cabinet-absorbed"), false);
  assert.equal(copy.classList.contains("node-insert-event"), false);
  assert.equal(copy.querySelectorAll(".list-bullet").length, 0);
  assert.equal(copy.querySelectorAll("[data-line]").length, 0);
  assert.equal(copy.querySelectorAll(".has-list-bullet").length, 0);
  assert.equal(copy.querySelectorAll("li").length, 3);
  assert.equal(copy.querySelectorAll("a.internal-link").length, 3);
  // The note's own callout keeps everything it had.
  assert.equal(native.classList.contains("bob-cabinet-absorbed"), true);
  assert.equal(native.querySelectorAll(".list-bullet").length, 3);
});

test("a painted, mismatched, embedded, or detached callout is never cloned", () => {
  const painted = nativeCallout("records", { "data-bob-records-card": "true" });
  readingView(painted);
  assert.equal(H.propertyCardCabinetCloneNativeCallout(painted, "records"), null);
  const hued = nativeCallout("projects", { "data-root-hue": "blue" });
  readingView(hued);
  assert.equal(H.propertyCardCabinetCloneNativeCallout(hued, "projects"), null);
  const other = nativeCallout("albums");
  readingView(other);
  assert.equal(H.propertyCardCabinetCloneNativeCallout(other, "records"), null);
  const withImage = nativeCallout("records");
  withImage.children[1].appendChild(el("img"));
  readingView(withImage);
  assert.equal(H.propertyCardCabinetCloneNativeCallout(withImage, "records"), null);
  assert.equal(H.propertyCardCabinetCloneNativeCallout(nativeCallout("records"), "records"), null);
  assert.equal(H.propertyCardCabinetCloneNativeCallout(null, "records"), null);
});

test("the Reading body clones the native callout and never re-renders it", async () => {
  const native = nativeCallout("records");
  const { preview } = readingView(native);
  const found = H.propertyCardCabinetReadingNativeCallout(preview, { kind: "records", startLine: 4, headingLine: null });
  assert.equal(found, native);
  let renders = 0;
  let painted = null;
  const container = el("div");
  const outcome = await H.propertyCardCabinetRenderCatalog({
    plugin: { app: { MarkdownRenderer: { render: async () => { renders += 1; } } } },
    doc: miniDoc(),
    container,
    path: "Albums/eat.md",
    regionSource: "> [!records]\n> - [[place-1]]",
    nativeCallout: found,
    calloutKind: "records",
    paint: (callout) => { painted = callout; },
    paintKey: `clone-${Date.now()}`,
  });
  assert.deepEqual(outcome, { reused: false, failed: false });
  assert.equal(renders, 0);
  assert.ok(painted);
  assert.notEqual(painted, native);
  assert.equal(painted.getAttribute("data-callout"), "records");
  assert.equal(container.querySelectorAll("li").length, 3);
  assert.equal(native.parentNode.parentNode.parentNode, preview);
  // A painted native callout falls back to MarkdownRenderer.
  const paintedNative = nativeCallout("records", { "data-bob-records-card": "true" });
  readingView(paintedNative);
  await H.propertyCardCabinetRenderCatalog({
    plugin: { app: { MarkdownRenderer: { render: async () => { renders += 1; } } } },
    doc: miniDoc(),
    container: el("div"),
    path: "Albums/eat.md",
    regionSource: "> [!records]\n> - [[place-1]]",
    nativeCallout: paintedNative,
    calloutKind: "records",
    paint: () => {},
    paintKey: `render-${Date.now()}`,
  });
  assert.equal(renders, 1);
});

function cabinetPanel(open = true) {
  const doc = miniDoc();
  const panel = new MiniNode("section", { class: "bob-cabinet-panel" }, doc);
  const drawer = new MiniNode("div", { class: "bob-cabinet-drawer", "data-open": open ? "true" : "false" }, doc);
  const inner = new MiniNode("div", { class: "bob-cabinet-drawer-inner" }, doc);
  drawer.appendChild(inner);
  panel.appendChild(drawer);
  return { panel, inner };
}

function hiddenEditor(display = "none") {
  const source = el("div", { class: "markdown-source-view" });
  source.style.display = display;
  const dom = el("div", { class: "cm-editor" });
  source.appendChild(dom);
  source.connectedRoot = true;
  return { dispatch: () => {}, dom, source };
}

test("a hidden Live Preview editor waits to build an opted-in body until it shows", () => {
  const observers = [];
  const previous = global.IntersectionObserver;
  global.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  };
  try {
    const view = hiddenEditor();
    assert.equal(H.propertyCardCabinetEditorHidden(view), true);
    assert.equal(H.propertyCardCabinetEditorHidden(hiddenEditor("")), false);
    assert.equal(H.propertyCardCabinetEditorHidden({ dom: view.dom }), false);
    const { panel } = cabinetPanel(true);
    view.source.appendChild(panel);
    let builds = 0;
    const provider = { deferWhileHidden: true, buildBody: () => { builds += 1; } };
    const state = H.propertyCardCabinetProviderBody(panel, provider, { view }, "projects", "Projects/sase.md", "k1", true);
    assert.equal(builds, 0);
    assert.equal(state.built, false);
    assert.equal(state.pending, false);
    assert.equal(observers.length, 1);
    observers[0].callback([{ isIntersecting: false }]);
    assert.equal(builds, 0);
    view.source.style.display = "";
    observers[0].callback([{ isIntersecting: true }]);
    assert.equal(builds, 1);
    assert.equal(observers[0].disconnected, true);
    // Providers that claim inside buildBody (no opt-in) still build at once.
    const eager = cabinetPanel(true);
    const hidden = hiddenEditor();
    hidden.source.appendChild(eager.panel);
    let eagerBuilds = 0;
    H.propertyCardCabinetProviderBody(eager.panel, { buildBody: () => { eagerBuilds += 1; } }, { view: hidden },
      "records", "Albums/eat.md", "k2", true);
    assert.equal(eagerBuilds, 1);
  } finally {
    global.IntersectionObserver = previous;
  }
});

test("without IntersectionObserver a hidden editor builds its body at once", () => {
  const previous = global.IntersectionObserver;
  delete global.IntersectionObserver;
  try {
    const view = hiddenEditor();
    const { panel } = cabinetPanel(true);
    view.source.appendChild(panel);
    let builds = 0;
    H.propertyCardCabinetProviderBody(panel, { deferWhileHidden: true, buildBody: () => { builds += 1; } }, { view },
      "projects", "Projects/plain.md", "k3", true);
    assert.equal(builds, 1);
  } finally {
    if (previous !== undefined) global.IntersectionObserver = previous;
  }
});

test("the host digest is memoized by source and report identity", () => {
  let reports = { areas: { areas: [] }, projects: { projects: [] } };
  const plugin = {
    areasCatalogState: () => ({ report: reports.areas, today: "2026-11-27" }),
    projectsReportState: () => ({ report: reports.projects, today: "2026-11-27", errorModel: { fresh: Math.random() } }),
    notebookCatalogState: () => ({ report: null, today: "2026-11-27" }),
    albumReportState: () => ({ report: null }),
    homeCardCardModelFor: () => ({ kind: "area" }),
  };
  const source = "---\ntype: \"[[area]]\"\n---\n## Projects\n\n> [!projects]\n> - [[sase]]\n";
  const first = H.propertyCardCabinetHostDigest(plugin, "Areas/cash.md", source);
  assert.ok(first);
  assert.equal(plugin.cabinetHostDigestMemo instanceof Map, true);
  const memoEntry = plugin.cabinetHostDigestMemo.get("Areas/cash.md");
  assert.equal(H.propertyCardCabinetHostDigest(plugin, "Areas/cash.md", source), first);
  assert.equal(plugin.cabinetHostDigestMemo.get("Areas/cash.md"), memoEntry);
  // A replaced report or a changed source recomputes.
  reports = { ...reports, projects: { projects: [{ path: "sase.md", stem: "sase" }] } };
  const replaced = H.propertyCardCabinetHostDigest(plugin, "Areas/cash.md", source);
  assert.notEqual(plugin.cabinetHostDigestMemo.get("Areas/cash.md"), memoEntry);
  assert.notEqual(replaced, first);
  const edited = H.propertyCardCabinetHostDigest(plugin, "Areas/cash.md", `${source}\nmore\n`);
  assert.notEqual(edited, replaced);
});

test("a Records body built before its card is inserted tags the host Reading view", () => {
  const native = nativeCallout("records");
  const { preview } = readingView(native);
  const container = el("div");
  const release = H.cabinetRecordsClaimBody({}, {
    view: null,
    container,
    readingScope: preview,
    path: "Albums/eat.md",
    fingerprint: "fp-1",
    plan: { kind: "records", startLine: 4, headingLine: null },
  });
  assert.equal(native.classList.contains("bob-cabinet-absorbed"), true);
  release();
  assert.equal(native.classList.contains("bob-cabinet-absorbed"), false);
  // An embed around the scope never lends its host view.
  const embed = el("div", { class: "markdown-embed" });
  const embedded = nativeCallout("records");
  const inner = readingView(embedded).preview;
  embed.appendChild(inner);
  embed.connectedRoot = true;
  const releaseEmbedded = H.cabinetRecordsClaimBody({}, {
    view: null, container: el("div"), readingScope: inner, path: "Albums/other.md", fingerprint: "fp-2",
    plan: { kind: "records", startLine: 4, headingLine: null },
  });
  assert.equal(embedded.classList.contains("bob-cabinet-absorbed"), false);
  releaseEmbedded();
});

test("a Live Preview Records claim survives a later Reading claim's sweep while its editor stands", () => {
  const path = "Albums/sweep.md";
  const plan = { kind: "records", startLine: 4, headingLine: null };
  // The leaf's Live Preview editor claims first (hidden behind Reading).
  const editor = hiddenEditor();
  const releaseEditor = H.cabinetRecordsClaimBody({}, {
    view: editor, container: el("div"), path, fingerprint: "fp-sweep", plan,
  });
  assert.equal(H.propertyCardCatalogClaimed(editor, path, "records", "fp-sweep"), true);
  // The Reading body claims next; its disconnected-entry sweep must keep the
  // editor's claim, which has no Reading scope by design.
  const native = nativeCallout("records");
  const releaseReading = H.cabinetRecordsClaimBody({}, {
    view: null, container: el("div"), readingScope: readingView(native).preview, path, fingerprint: "fp-sweep", plan,
  });
  assert.equal(H.propertyCardCatalogClaimed(editor, path, "records", "fp-sweep"), true);
  assert.equal(native.classList.contains("bob-cabinet-absorbed"), true);
  // Once the editor's DOM is gone, the next sweep releases its claim.
  editor.source.connectedRoot = false;
  const releaseAgain = H.cabinetRecordsClaimBody({}, {
    view: null, container: el("div"), readingScope: readingView(nativeCallout("records")).preview,
    path: "Albums/other-sweep.md", fingerprint: "fp-other", plan,
  });
  assert.equal(H.propertyCardCatalogClaimed(editor, path, "records", "fp-sweep"), false);
  releaseEditor();
  releaseReading();
  releaseAgain();
});

test("a hidden editor's Records body claims at once but renders only once shown", () => {
  const observers = [];
  const previous = global.IntersectionObserver;
  global.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  try {
    let runs = 0;
    const hidden = hiddenEditor();
    const { panel, inner } = cabinetPanel(true);
    hidden.source.appendChild(panel);
    const body = el("div", { class: "bob-cabinet-provider-content" });
    inner.appendChild(body);
    assert.equal(H.propertyCardCabinetWhenShown(body.closest(".bob-cabinet-panel"), () => { runs += 1; }), true);
    assert.equal(observers[0].target, panel);
    observers[0].callback([{ isIntersecting: false }]);
    assert.equal(runs, 0);
    observers[0].callback([{ isIntersecting: true }]);
    assert.equal(runs, 1);
    assert.equal(observers[0].disconnected, true);
    // A panel dropped before it ever showed never runs.
    const dropped = cabinetPanel(true).panel;
    H.propertyCardCabinetWhenShown(dropped, () => { runs += 1; });
    observers[1].callback([{ isIntersecting: true }]);
    assert.equal(runs, 1);
  } finally {
    global.IntersectionObserver = previous;
  }
});
