// Tree walk rail (bob-cli-ra rail): disclosure, copy, signature, and the
// live-refresh mixin. Uses the real tree index for one integration vector
// plus focused fakes for every disclosure state.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class {},
      Plugin: TestPlugin,
      Platform: { isDesktopApp: false },
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return { EditorView: class {}, keymap: { of: (value) => value } };
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

const H = LedgerToolsPlugin.helpers;

// Mirrors the provider: step and parent stops carry the landing as their
// short label; group stops (group: true) carry the parent label.
function treeStop(path, { groupLabel = "bob", landingLabel = null, wraps = false, source = "tree", state = "exists", group = false } = {}) {
  const landing = landingLabel || path.replace(/\.md$/i, "").split("/").pop();
  return Object.freeze({
    path,
    target: path.replace(/\.md$/i, ""),
    groupLabel,
    landingLabel: landing,
    shortLabel: group ? groupLabel : landing,
    state,
    ghostReason: null,
    wraps,
    source,
  });
}

function treeProvider({ kind = "project", lane = "open", parentLabel = "bob", parentPath = "bob.md", position = 2, size = 3, index = 1, count = 2, members = null, parent = "parent", prevGroup = "prev", nextGroup = "next" } = {}) {
  const ring = members || [
    Object.freeze({ label: "bob_git", path: "bob_git.md", state: "exists" }),
    Object.freeze({ label: "bob", path: "bob.md", state: "current" }),
    Object.freeze({ label: "bob_plugins", path: "bob_plugins.md", state: "exists" }),
  ];
  return Object.freeze({
    ok: true,
    route: "tree",
    kind,
    lane,
    step: Object.freeze({
      prev: treeStop("bob_git.md", { groupLabel: parentLabel, landingLabel: "bob_git" }),
      next: treeStop("bob_plugins.md", { groupLabel: parentLabel, landingLabel: "bob_plugins" }),
      parent: parent === null ? null : treeStop(`${parentLabel}.md`, { groupLabel: "Top level", landingLabel: parentLabel }),
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
      members: ring,
      atStart: false,
      atEnd: false,
      enteringNext: null,
      enteringPrev: null,
    }),
    prevGroup: prevGroup === null ? null : treeStop("alpha.md", { groupLabel: "pig", landingLabel: "alpha", group: true }),
    nextGroup: nextGroup === null ? null : treeStop("beta.md", { groupLabel: "goo", landingLabel: "beta", group: true }),
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

class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
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
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  removeAttribute(n) { this.attrs.delete(n); }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
  addEventListener(t, cb) { const l = this.listeners.get(t) || []; l.push(cb); this.listeners.set(t, l); }
}

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
}

test("disclosure: full rail when the ring and the tour both have two or more", () => {
  const provider = treeProvider();
  const model = H.treeWalkRailModel({ answer: treeAnswerFrom(provider), provider });
  assert.ok(model);
  assert.ok(model.step.prev && model.step.next, "step row");
  assert.ok(model.group.prev && model.group.next && model.group.center, "full group row");
  assert.equal(model.label, "Link walk");
  assert.equal(model.group.center.text, "PROJECT · bob · 2 of 3 open");
  assert.equal(model.step.next.tooltip, "]n · next: bob_plugins");
  assert.equal(model.group.next.tooltip, "]N · next: goo's projects → beta");
  // The narrow (≤ 28rem) arm label names the parent, like the wide one.
  assert.equal(model.group.prev.shortLabel, "pig");
  assert.equal(model.group.next.shortLabel, "goo");
});

test("disclosure: ticks-only centre when the tour has one group", () => {
  const provider = treeProvider({ count: 1, prevGroup: null, nextGroup: null });
  const model = H.treeWalkRailModel({ answer: treeAnswerFrom(provider), provider });
  assert.ok(model.step, "step row stays");
  assert.ok(model.group, "ticks-only row stays");
  assert.equal(model.group.prev, null);
  assert.equal(model.group.next, null);
  assert.ok(model.group.center, "centre stays without arms");
});

test("disclosure: arms only when the ring is a singleton", () => {
  const single = [Object.freeze({ label: "solo", path: "solo.md", state: "current" })];
  const provider = treeProvider({ size: 1, position: 1, members: single });
  // Singleton ring has no step stops.
  const solo = Object.freeze({ ...provider, step: Object.freeze({ prev: null, next: null, parent: treeStop("bob.md", { landingLabel: "bob" }) }) });
  const model = H.treeWalkRailModel({ answer: treeAnswerFrom(solo), provider: solo });
  assert.ok(model);
  assert.equal(model.step, null, "no step row for a singleton");
  assert.ok(model.group.prev && model.group.next, "arms stay");
  assert.equal(model.group.center, null, "a one-member ring has no centre");
});

test("disclosure: no rail for a singleton in a single group, or a malformed parent", () => {
  const single = [Object.freeze({ label: "solo", path: "solo.md", state: "current" })];
  const lone = treeProvider({ size: 1, position: 1, members: single, count: 1, prevGroup: null, nextGroup: null });
  const singleAnswer = treeAnswerFrom({ ...lone, step: { prev: null, next: null, parent: treeStop("bob.md", { landingLabel: "bob" }) } });
  assert.equal(H.treeWalkRailModel({ answer: singleAnswer, provider: lone }), null);
  const malformed = Object.freeze({ ok: true, route: "tree", kind: "project", lane: "open", step: null, stepNone: { reason: "no-parent", message: "x" }, group: null, prevGroup: null, nextGroup: null, none: { reason: "no-parent", message: "x" } });
  assert.equal(H.treeWalkRailModel({ answer: treeAnswerFrom(malformed), provider: malformed }), null);
  assert.equal(H.treeWalkRailModel({ answer: null, provider: treeProvider() }), null);
  assert.equal(H.treeWalkRailModel({ answer: treeAnswerFrom(treeProvider()), provider: null }), null);
});

test("copy: lanes, wraps, sentinel parents, and the authored cue", () => {
  const closed = treeProvider({ lane: "closed" });
  const closedModel = H.treeWalkRailModel({ answer: treeAnswerFrom(closed), provider: closed });
  assert.equal(closedModel.group.center.text, "PROJECT · bob · 2 of 3 closed");
  const area = treeProvider({ kind: "area", lane: null });
  const areaModel = H.treeWalkRailModel({ answer: treeAnswerFrom(area), provider: area });
  assert.equal(areaModel.group.center.text, "AREA · bob · 2 of 3");

  const wrapping = treeProvider();
  const wrappedAnswer = treeAnswerFrom(wrapping, {
    next: treeStop("bob_git.md", { groupLabel: "bob", landingLabel: "bob_git", wraps: true }),
  });
  const wrapped = H.treeWalkRailModel({ answer: wrappedAnswer, provider: wrapping });
  assert.equal(wrapped.step.next.wraps, true);
  assert.match(wrapped.step.next.tooltip, /wraps to bob_git, first of bob's 3 open projects/);

  const sentinel = treeProvider();
  const noParent = Object.freeze({ ...sentinel, step: Object.freeze({ ...sentinel.step, parent: null }) });
  const sentinelModel = H.treeWalkRailModel({ answer: treeAnswerFrom(noParent), provider: noParent });
  assert.equal(sentinelModel.step.parent, null, "sentinel parents drop the up item");

  const authored = treeProvider();
  const authoredAnswer = treeAnswerFrom(authored, {
    next: treeStop("curated.md", { groupLabel: "bob", landingLabel: "curated", source: "authored" }),
  });
  const authoredModel = H.treeWalkRailModel({ answer: authoredAnswer, provider: authored });
  assert.equal(authoredModel.step.next.source, "authored");
  assert.match(authoredModel.step.next.tooltip, /Authored nav link/);
  assert.match(authoredModel.step.next.ariaLabel, /Authored nav link/);
});

test("signature: stable over the same paint, different when a target moves", () => {
  const provider = treeProvider();
  const first = H.treeWalkRailModel({ answer: treeAnswerFrom(provider), provider });
  const second = H.treeWalkRailModel({ answer: treeAnswerFrom(provider), provider });
  assert.equal(first.signature, second.signature);
  const moved = treeAnswerFrom(provider, { next: treeStop("other.md", { groupLabel: "bob", landingLabel: "other" }) });
  const third = H.treeWalkRailModel({ answer: moved, provider });
  assert.notEqual(first.signature, third.signature);
});

test("build: the kit rail paints step and group rows with tooltips", () => {
  const doc = makeDoc();
  const provider = treeProvider();
  const model = H.treeWalkRailModel({ answer: treeAnswerFrom(provider), provider });
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { workspace: {}, commands: {} };
  plugin.dependencyNavApi = () => null;
  const built = plugin.treeWalkRailBuild(doc, model, {});
  assert.ok(built && built.element, "a rail builds");
  assert.ok(built.items.next, "step next");
  assert.equal(built.group.arms.next.getAttribute("title"), "]N · next: goo's projects → beta");
});

test("answer: no nav plugin falls back to the provider, cold index means no rail", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const provider = treeProvider();
  plugin.navGroupsResolve = (request) => {
    assert.equal(request.lazy, true, "paint callers resolve lazy first");
    if (request.lazy === true) return provider;
    return provider;
  };
  plugin.dependencyNavApi = () => null;
  plugin.app = { workspace: {}, commands: {} };
  const resolved = plugin.treeWalkRailAnswer("bob.md", "body");
  assert.equal(resolved.from, "navGroups");
  assert.ok(resolved.answer.ok);

  const cold = Object.create(LedgerToolsPlugin.prototype);
  cold.navGroupsResolve = () => Object.freeze({ ok: true, route: "tree", kind: "project", lane: "open", step: null, stepNone: null, group: null, prevGroup: null, nextGroup: null, none: { reason: "indexing", message: "Link walk is indexing" } });
  cold.dependencyNavApi = () => null;
  cold.app = { workspace: {}, commands: {} };
  cold.treeWalkRailScheduleWarmRefresh = () => {};
  assert.equal(cold.treeWalkRailAnswer("bob.md", "body"), null, "indexing means no rail now");
  assert.equal(cold.treeWalkRailModelFor("bob.md", "body"), null);
});

test("activation: a changed stop repaints and refuses, a modified click opens a tab", async () => {
  const provider = treeProvider();
  const notices = [];
  const opened = [];
  const refreshed = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    workspace: { openLinkText: async (target, source, tab) => { opened.push([target, source, tab]); }, setActiveLeaf: () => {} },
    commands: { commands: {}, executeCommandById: () => { throw new Error("must not run nav on a tab click"); } },
  };
  plugin.dependencyNavApi = () => null;
  plugin.navGroupsResolve = () => provider;
  plugin.treeWalkRailNotice = (message) => { notices.push(message); };
  plugin.treeWalkRailPaneText = async () => "current pane text";
  plugin.treeWalkRailAnswer = () => ({ from: "navGroups", answer: treeAnswerFrom(provider, { next: treeStop("changed.md", { landingLabel: "changed" }) }), provider });
  plugin.treeWalkRailRefresh = (path) => { refreshed.push(path); return true; };
  plugin.treeWalkRailOpenLink = async (target, source, event) => {
    opened.push([target, source, event?.ctrlKey === true ? "tab" : false]);
    return true;
  };
  const item = { label: "bob_plugins", target: "bob_plugins", state: "exists", path: "bob_plugins.md" };
  const refused = await plugin.treeWalkRailActivate("next", item, "bob.md", {});
  assert.equal(refused, false);
  assert.deepEqual(refreshed, ["bob.md"]);
  assert.match(notices.join(" "), /try again/);

  const tabbed = await plugin.treeWalkRailActivate("next", item, "bob.md", { ctrlKey: true });
  assert.equal(tabbed, true);
  assert.ok(opened.length >= 1, "a modified click opens through the link opener");
});

test("providers never write, never spawn, and never throw on a broken app", () => {
  const writes = [];
  const fail = (name) => () => { writes.push(name); throw new Error("must never write: " + name); };
  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => [],
      on: () => ({}),
      create: fail("create"),
      modify: fail("modify"),
      delete: fail("delete"),
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null, on: () => ({}) },
    workspace: { onLayoutReady: (fn) => fn(), openLinkText: async () => {} },
    commands: { commands: {}, executeCommandById: () => false },
    plugins: { plugins: {} },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.dependencyNavApi = () => null;
  plugin.navGroupsResolve = () => treeProvider();
  assert.doesNotThrow(() => plugin.treeWalkRailAnswer("bob.md", "body"));
  assert.doesNotThrow(() => plugin.treeWalkRailModelFor("bob.md", "body"));
  assert.doesNotThrow(() => plugin.treeWalkRailBuild(makeDoc(), H.treeWalkRailModel({ answer: treeAnswerFrom(treeProvider()), provider: treeProvider() }), {}));
  assert.deepEqual(writes, [], "zero writes and zero spawns");
  const broken = Object.create(LedgerToolsPlugin.prototype);
  broken.app = null;
  assert.equal(broken.treeWalkRailAnswer("bob.md", "body"), null);
  assert.equal(broken.treeWalkRailModelFor("bob.md", "body"), null);
  assert.equal(broken.treeWalkRailBuild(null, null, {}), null);
});

test("styles: the link-walk region follows the group row with a floor hairline", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const start = "/* Link walk rail (bob-cli-ra rail): start.";
  const end = "/* Link walk rail (bob-cli-ra rail): end. */";
  assert.equal(css.split(start).length, 2, "one start marker");
  assert.equal(css.split(end).length, 2, "one end marker");
  const block = css.slice(css.indexOf(start), css.indexOf(end));
  for (const needle of [
    '[data-card-floor="link-walk"]',
    "border-block-start: 1px solid",
    ".bob-link-walk-rail",
    ".bob-property-card-rail-wrap",
    "@container bob-property-card (max-width: 28rem)",
    "@media (forced-colors: active)",
    "CanvasText",
    "@media (prefers-reduced-motion: reduce)",
  ]) assert.ok(block.includes(needle), needle);
});
