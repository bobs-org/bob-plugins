// Property-card group row (bob-cli-oj group-rail): the kit's group-row
// builder, the shared missing-target states on rail items and chips, the
// rail's optional group row, and the CSS block contract.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
}

const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ ...options }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField: { info: true }, editorLivePreviewField: { live: true },
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
    EditorView: { editorAttributes: { of: (attributes) => attributes } },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { helpers: H } = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;

class FakeText {
  constructor(text, doc) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
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
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
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
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc(options = {}) {
  const doc = {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
  if (options.svg) {
    doc.createElementNS = function createElementNS(ns, tag) {
      const node = new FakeNode(tag, this);
      node.namespaceURI = ns;
      return node;
    };
  }
  return doc;
}

const classes = (node) => node.className.split(/\s+/).filter(Boolean);
const childClasses = (node) => node.children.map((child) => classes(child)[0]);
// Tag, sorted attributes, and children: a stable serialization for
// byte-identity checks on legacy specs.
function serialize(node) {
  if (node.nodeType === 3) return JSON.stringify(node.nodeValue);
  const attrs = [...node.attrs.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`);
  return `<${node.tagName.toLowerCase()}${attrs.length ? " " + attrs.join(" ") : ""}>${node.childNodes.map(serialize).join("")}</${node.tagName.toLowerCase()}>`;
}

const ARMS = {
  prev: {
    groupLabel: "Q3", landingLabel: "W27", shortLabel: "Q3", target: "2026/2026-W27", state: "exists",
    tooltip: "[N · previous quarter: Q3 → 2026-W27", ariaLabel: "Previous quarter group: Q3, opens 2026-W27",
  },
  next: {
    groupLabel: "2027-Q1", landingLabel: "W01", shortLabel: "2027-Q1", target: "2027/2027-W01", state: "creatable",
    tooltip: "2027-W01 isn't created yet — ]N creates it with bob periods ensure",
    ariaLabel: "Next quarter group: 2027-Q1, not created yet — activating creates it",
  },
};

function weekCenter(extra = {}) {
  const members = Array.from({ length: 14 }, (_, index) => ({
    label: `W${27 + index}`,
    state: index === 7 ? "current" : index > 10 ? "missing" : "exists",
  }));
  return { text: "week 8 of 14", shortText: "8/14", position: 8, size: 14, members, ...extra };
}

test("target state: explicit state wins, unresolved means creatable, else exists", () => {
  assert.deepEqual([...H.PROPERTY_CARD_TARGET_STATES], ["exists", "creatable", "ghost"]);
  assert.ok(Object.isFrozen(H.PROPERTY_CARD_TARGET_STATES));
  assert.equal(H.PROPERTY_CARD_GROUP_TICK_LIMIT, 21);
  assert.equal(H.PROPERTY_CARD_GHOST_NOTE, "· not in vault");
  assert.equal(H.propertyCardTargetState({}), "exists");
  assert.equal(H.propertyCardTargetState(null), "exists");
  assert.equal(H.propertyCardTargetState({ unresolved: true }), "creatable");
  assert.equal(H.propertyCardTargetState({ unresolved: "yes" }), "exists", "only a literal true is legacy unresolved");
  assert.equal(H.propertyCardTargetState({ state: "ghost", unresolved: true }), "ghost");
  assert.equal(H.propertyCardTargetState({ state: "exists", unresolved: true }), "exists", "an explicit state wins");
  assert.equal(H.propertyCardTargetState({ state: " creatable " }), "creatable");
  assert.equal(H.propertyCardTargetState({ state: "missing", unresolved: true }), "creatable", "unknown states fall back");
  assert.equal(H.propertyCardTargetState({ state: "bogus" }), "exists");
});

test("group row: null without an arm or a centre, and never throws", () => {
  const doc = makeDoc();
  assert.equal(H.propertyCardBuildGroupRow(doc, {}), null);
  assert.equal(H.propertyCardBuildGroupRow(doc), null);
  assert.equal(H.propertyCardBuildGroupRow(doc, null), null);
  assert.equal(H.propertyCardBuildGroupRow(null, { prev: ARMS.prev }), null);
  assert.equal(H.propertyCardBuildGroupRow({}, { prev: ARMS.prev }), null);
  assert.equal(H.propertyCardBuildGroupRow(doc, { prev: { ...ARMS.prev, groupLabel: "  " } }), null, "an arm needs a group label");
  assert.equal(H.propertyCardBuildGroupRow(doc, { next: { ...ARMS.next, target: "" } }), null, "a non-ghost arm needs a target");
  assert.equal(H.propertyCardBuildGroupRow(doc, { center: { text: " ", position: 1, size: 2 } }), null, "a centre needs text");
  assert.equal(H.propertyCardBuildGroupRow(doc, { prev: "Q3", center: 5 }), null);
  const throwing = { createElement() { throw new Error("boom"); }, createTextNode() { throw new Error("boom"); } };
  assert.equal(H.propertyCardBuildGroupRow(throwing, { prev: ARMS.prev }), null);
  const ghostOnly = H.propertyCardBuildGroupRow(doc, { prev: { groupLabel: "2025", state: "ghost", ghostReason: "x" } });
  assert.ok(ghostOnly?.arms.prev, "a ghost arm needs no target");
});

test("group row: three grid cells, arm reading order, aria-hidden marks, tooltips, and names", () => {
  const doc = makeDoc();
  const row = H.propertyCardBuildGroupRow(doc, { label: "Week groups", prev: ARMS.prev, next: ARMS.next, center: weekCenter() });
  assert.deepEqual(Object.keys(row).sort(), ["arms", "center", "element", "track"]);
  const element = row.element;
  assert.equal(element.tagName, "DIV");
  assert.deepEqual(classes(element), ["bob-property-card-group-row"]);
  assert.equal(element.getAttribute("role"), "group");
  assert.equal(element.getAttribute("aria-label"), "Week groups");
  assert.deepEqual(childClasses(element), [
    "bob-property-card-group-arm", "bob-property-card-group-center", "bob-property-card-group-arm",
  ]);
  assert.equal(element.children[0], row.arms.prev);
  assert.equal(element.children[1], row.center);
  assert.equal(element.children[2], row.arms.next);

  const prev = row.arms.prev;
  assert.equal(prev.tagName, "A");
  assert.equal(prev.getAttribute("data-group"), "prev");
  assert.equal(prev.getAttribute("data-state"), "exists");
  assert.equal(prev.getAttribute("href"), "2026/2026-W27");
  assert.equal(prev.getAttribute("data-href"), "2026/2026-W27");
  assert.equal(prev.getAttribute("title"), "[N · previous quarter: Q3 → 2026-W27", "the tooltip still names the landing");
  assert.equal(prev.getAttribute("aria-label"), "Previous quarter group: Q3, opens 2026-W27", "so does the accessible name");
  assert.equal(prev.getAttribute("aria-disabled"), null);
  assert.equal(prev.getAttribute("tabindex"), null);
  assert.ok(!prev.classList.contains("internal-link"));
  assert.deepEqual(childClasses(prev), [
    "bob-property-card-group-glyph", "bob-property-card-group-label", "bob-property-card-group-label-narrow",
  ], "the mark and the group name only: no separator, no landing");
  assert.equal(prev.querySelector(".bob-property-card-group-landing"), null);
  assert.equal(prev.querySelector(".bob-property-card-group-sep"), null);
  assert.ok(!prev.textContent.includes("W27"), "the landing is never painted");
  assert.ok(!/[«»]/.test(prev.textContent), "no quotation-mark glyphs");
  const glyph = prev.querySelector(".bob-property-card-group-glyph");
  assert.equal(glyph.getAttribute("aria-hidden"), "true");
  assert.equal(glyph.getAttribute("data-icon"), "skip-back");
  assert.equal(glyph.children.length, 0, "a document without createElementNS leaves the mark empty");
  assert.equal(glyph.textContent, "");
  const visible = (arm) => arm.children.filter((node) => !classes(node)[0].endsWith("-narrow")).map((node) => node.textContent).filter(Boolean).join(" ");
  assert.equal(visible(prev), "Q3");
  assert.equal(prev.querySelector(".bob-property-card-group-label-narrow").getAttribute("aria-hidden"), "true");
  assert.equal(prev.querySelector(".bob-property-card-group-label").getAttribute("aria-hidden"), null);

  const next = row.arms.next;
  assert.equal(next.getAttribute("data-group"), "next");
  assert.deepEqual(childClasses(next), [
    "bob-property-card-group-label", "bob-property-card-group-label-narrow", "bob-property-card-group-plus",
    "bob-property-card-group-glyph",
  ]);
  assert.equal(next.querySelector(".bob-property-card-group-glyph").getAttribute("data-icon"), "skip-forward");
  assert.equal(visible(next), "2027-Q1 +");
  assert.equal(next.getAttribute("title"), "2027-W01 isn't created yet — ]N creates it with bob periods ensure");
  assert.equal(next.getAttribute("aria-label"), "Next quarter group: 2027-Q1, not created yet — activating creates it");
});

test("group mark: Lucide skip-back / skip-forward drawn inline with createElementNS", () => {
  assert.deepEqual(Object.keys(H.PROPERTY_CARD_GROUP_MARKS), ["prev", "next"]);
  assert.ok(Object.isFrozen(H.PROPERTY_CARD_GROUP_MARKS));
  const doc = makeDoc({ svg: true });
  const back = H.propertyCardGroupMark(doc, "prev");
  assert.deepEqual(classes(back), ["bob-property-card-group-glyph"]);
  assert.equal(back.getAttribute("aria-hidden"), "true");
  assert.equal(back.getAttribute("data-icon"), "skip-back");
  const svg = back.children[0];
  assert.equal(svg.tagName, "SVG");
  assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
  for (const [name, value] of [
    ["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"],
    ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["width", "1em"], ["height", "1em"], ["aria-hidden", "true"],
  ]) assert.equal(svg.getAttribute(name), value, name);
  assert.deepEqual(svg.children.map((shape) => [shape.tagName, shape.namespaceURI === svg.namespaceURI]), [["POLYGON", true], ["LINE", true]]);
  assert.equal(svg.children[0].getAttribute("points"), "19 20 9 12 19 4 19 20");
  assert.deepEqual(["x1", "x2", "y1", "y2"].map((name) => svg.children[1].getAttribute(name)), ["5", "5", "19", "5"]);
  const forward = H.propertyCardGroupMark(doc, "next");
  assert.equal(forward.getAttribute("data-icon"), "skip-forward");
  assert.equal(forward.children[0].children[0].getAttribute("points"), "5 4 15 12 5 20 5 4");
  assert.deepEqual(["x1", "x2", "y1", "y2"].map((name) => forward.children[0].children[1].getAttribute(name)), ["19", "19", "5", "19"]);
  const throwing = { ...makeDoc(), createElementNS() { throw new Error("boom"); } };
  const fallback = H.propertyCardGroupMark(throwing, "prev");
  assert.equal(fallback.getAttribute("data-icon"), "skip-back", "a failing SVG build keeps the empty span");
  assert.equal(fallback.children.length, 0);
  const row = H.propertyCardBuildGroupRow(doc, { prev: ARMS.prev });
  assert.equal(row.arms.prev.children[0].children[0].tagName, "SVG", "the row builds the same mark");
});

test("group row: a missing arm or centre keeps its column with a gap span", () => {
  const doc = makeDoc();
  const prevOnly = H.propertyCardBuildGroupRow(doc, { prev: ARMS.prev });
  assert.equal(prevOnly.element.getAttribute("aria-label"), "Group navigation");
  assert.deepEqual(prevOnly.element.children.map((node) => [classes(node)[0], node.getAttribute("data-group")]), [
    ["bob-property-card-group-arm", "prev"],
    ["bob-property-card-group-gap", "center"],
    ["bob-property-card-group-gap", "next"],
  ]);
  assert.equal(prevOnly.center, null);
  assert.equal(prevOnly.track, null);
  assert.equal(prevOnly.arms.next, null);
  const centerOnly = H.propertyCardBuildGroupRow(doc, { center: weekCenter() });
  assert.deepEqual(centerOnly.element.children.map((node) => [classes(node)[0], node.getAttribute("data-group")]), [
    ["bob-property-card-group-gap", "prev"],
    ["bob-property-card-group-center", null],
    ["bob-property-card-group-gap", "next"],
  ]);
  assert.deepEqual(centerOnly.arms, { prev: null, next: null });
});

test("group row states: creatable plus, ghost note, no href, aria-disabled, and Enter or Space activation", () => {
  const doc = makeDoc();
  const activated = [];
  const ghostArm = {
    groupLabel: "2025", landingLabel: "W40", target: "2025/2025-W40", state: "ghost",
    ghostReason: "2025-Q1 is before Bob's period notes began — navigation never creates it",
    ariaLabel: "Previous year group: 2025, not in vault",
  };
  const row = H.propertyCardBuildGroupRow(doc, {
    prev: ghostArm, next: ARMS.next,
    onActivate: (direction, arm, event) => activated.push([direction, arm.state, arm.target, event.type, event.key || ""]),
  });
  const next = row.arms.next;
  assert.equal(next.getAttribute("data-state"), "creatable");
  const plus = next.querySelector(".bob-property-card-group-plus");
  assert.equal(plus.textContent, "+");
  assert.equal(plus.getAttribute("aria-hidden"), "true");
  assert.equal(next.querySelector(".bob-property-card-group-note"), null);
  assert.equal(next.getAttribute("href"), "2027/2027-W01");

  const ghost = row.arms.prev;
  assert.equal(ghost.getAttribute("data-state"), "ghost");
  assert.equal(ghost.getAttribute("href"), null);
  assert.equal(ghost.getAttribute("data-href"), null);
  assert.equal(ghost.getAttribute("role"), "link");
  assert.equal(ghost.getAttribute("tabindex"), "0");
  assert.equal(ghost.getAttribute("aria-disabled"), "true");
  assert.equal(ghost.getAttribute("title"), ghostArm.ghostReason, "a ghost without a tooltip shows its reason");
  assert.equal(ghost.getAttribute("aria-label"), "Previous year group: 2025, not in vault");
  const note = ghost.querySelector(".bob-property-card-group-note");
  assert.equal(note.textContent, "· not in vault");
  assert.equal(note.getAttribute("aria-hidden"), null);
  assert.equal(ghost.querySelector(".bob-property-card-group-plus"), null);

  const click = next.fire("click");
  assert.equal(click.defaultPrevented, true);
  assert.equal(next.fire("auxclick", { button: 2 }).defaultPrevented, false, "a right click is not an activation");
  next.fire("auxclick", { button: 1 });
  assert.equal(next.fire("keydown", { key: "Enter" }).defaultPrevented, false, "real links keep their native Enter");
  assert.equal(ghost.fire("keydown", { key: "Enter" }).defaultPrevented, true);
  ghost.fire("keydown", { key: " " });
  ghost.fire("keydown", { key: "a" });
  ghost.fire("click");
  assert.deepEqual(activated, [
    ["next", "creatable", "2027/2027-W01", "click", ""],
    ["next", "creatable", "2027/2027-W01", "auxclick", ""],
    ["prev", "ghost", "2025/2025-W40", "keydown", "Enter"],
    ["prev", "ghost", "2025/2025-W40", "keydown", " "],
    ["prev", "ghost", "2025/2025-W40", "click", ""],
  ]);

  const titled = H.propertyCardBuildGroupRow(doc, { next: { ...ghostArm, tooltip: "custom" } });
  assert.equal(titled.arms.next.getAttribute("title"), "custom", "an explicit tooltip wins over the reason");
  const legacy = H.propertyCardBuildGroupRow(doc, { next: { groupLabel: "W48", target: "x", unresolved: true }, onActivate: (d, arm) => activated.push(arm.state) });
  assert.equal(legacy.arms.next.getAttribute("data-state"), "creatable");
  legacy.arms.next.fire("click");
  assert.equal(activated.at(-1), "creatable", "the activated arm carries its resolved state");
  const bare = H.propertyCardBuildGroupRow(doc, { next: { groupLabel: "W48", target: "x" } });
  assert.equal(bare.arms.next.getAttribute("data-state"), "exists");
  assert.equal(bare.arms.next.getAttribute("title"), null);
  assert.equal(bare.arms.next.getAttribute("aria-label"), null);
  assert.doesNotThrow(() => bare.arms.next.fire("click"), "no handler is fine");
});

test("group row: wrap glyph, narrow spans, and arms that never paint a landing", () => {
  const doc = makeDoc();
  const row = H.propertyCardBuildGroupRow(doc, {
    prev: { groupLabel: "🛑 Why SASE is still NOT ready?", shortLabel: "🛑", landingLabel: "AI Slop", target: "zettel/ai-slop", state: "exists", wraps: true },
    next: { groupLabel: "🏁 Conclusion", landingLabel: "Wrap-up", target: "zettel/wrap-up", state: "exists", wraps: true },
  });
  const prev = row.arms.prev;
  assert.deepEqual(childClasses(prev).at(-1), "bob-property-card-group-wrap");
  assert.equal(prev.querySelector(".bob-property-card-group-wrap").textContent, "↺");
  assert.equal(prev.querySelector(".bob-property-card-group-wrap").getAttribute("aria-hidden"), "true");
  assert.equal(prev.querySelector(".bob-property-card-group-label-narrow").textContent, "🛑");
  assert.ok(!prev.textContent.includes("AI Slop"));
  const next = row.arms.next;
  assert.deepEqual(childClasses(next).slice(-2), ["bob-property-card-group-glyph", "bob-property-card-group-wrap"]);
  assert.equal(next.querySelector(".bob-property-card-group-label-narrow").textContent, "🏁 Conclusion", "narrow falls back to the label");
  assert.ok(!next.textContent.includes("Wrap-up"));

  const plain = H.propertyCardBuildGroupRow(doc, { prev: { groupLabel: "2025", target: "2025", state: "exists", wraps: "yes" } });
  assert.equal(plain.arms.prev.querySelector(".bob-property-card-group-wrap"), null, "only a literal true wraps");
  assert.equal(plain.arms.prev.querySelector(".bob-property-card-group-sep"), null);
  assert.equal(plain.arms.prev.querySelector(".bob-property-card-group-landing"), null);
});

test("group row centre: only the track, a hidden position label, a title, and ticks per member state", () => {
  const doc = makeDoc();
  const row = H.propertyCardBuildGroupRow(doc, { center: weekCenter({ ariaLabel: "Week 8 of 14 in quarter Q3", tooltip: "Week 8 of 14 in quarter Q3" }) });
  const center = row.center;
  assert.equal(center.getAttribute("title"), "Week 8 of 14 in quarter Q3");
  assert.deepEqual(childClasses(center), ["bob-property-card-group-position-label", "bob-property-card-group-track"],
    "no visible group name or position text");
  const label = center.querySelector(".bob-property-card-group-position-label");
  assert.equal(label.textContent, "Week 8 of 14 in quarter Q3");
  assert.equal(label.getAttribute("aria-hidden"), null, "screen readers read the hidden label");
  for (const gone of ["name", "name-sep", "position", "position-wide", "position-narrow"]) {
    assert.equal(center.querySelector(`.bob-property-card-group-${gone}`), null, gone);
  }
  assert.ok(!center.textContent.includes("week 8 of 14"));
  assert.ok(!center.textContent.includes("8/14"));

  const track = row.track;
  assert.equal(track, center.querySelector(".bob-property-card-group-track"));
  assert.equal(track.getAttribute("aria-hidden"), "true");
  assert.equal(track.getAttribute("data-track"), "ticks");
  const ticks = track.querySelectorAll(".bob-property-card-group-tick");
  assert.equal(ticks.length, 14);
  assert.deepEqual(ticks.map((tick) => tick.getAttribute("data-state")).join(","),
    "exists,exists,exists,exists,exists,exists,exists,current,exists,exists,exists,missing,missing,missing");
  assert.equal(ticks[7].getAttribute("title"), "W34");
  assert.equal(track.querySelector(".bob-property-card-group-thumb"), null);

  const record = H.propertyCardBuildGroupRow(doc, {
    center: { name: "🔮 Future Work", text: "2 of 3", shortText: "2/3", position: 2, size: 3,
      members: [{ label: "a", state: "exists" }, { label: "b", state: "current" }, { state: "weird" }, null] },
  });
  assert.deepEqual(childClasses(record.center), ["bob-property-card-group-position-label", "bob-property-card-group-track"]);
  assert.equal(record.center.querySelector(".bob-property-card-group-name"), null, "the name is accepted, never painted");
  assert.ok(!record.center.textContent.includes("Future Work"));
  assert.equal(record.center.querySelector(".bob-property-card-group-position-label").textContent, "2 of 3", "the label falls back to the text");
  assert.equal(record.center.getAttribute("title"), "2 of 3", "the title falls back to the label");
  assert.deepEqual(record.track.querySelectorAll(".bob-property-card-group-tick").map((tick) => tick.getAttribute("data-state")),
    ["exists", "current", "exists"], "unknown member states read as exists; non-objects are skipped");
  assert.equal(record.track.querySelectorAll(".bob-property-card-group-tick")[2].getAttribute("title"), null);
  const labelled = H.propertyCardBuildGroupRow(doc, { center: { text: "day 6 of 7", ariaLabel: "Day 6 of 7 in week W47", position: 6, size: 7 } });
  assert.equal(labelled.center.getAttribute("title"), "Day 6 of 7 in week W47");
});

test("group row centre: a one-member group has no centre and no track", () => {
  const doc = makeDoc();
  const single = { name: "📜 Prompt language (macros)", text: "1 of 1", shortText: "1/1", position: 1, size: 1,
    members: [{ label: "Layers of Prompt Management", state: "current" }] };
  const row = H.propertyCardBuildGroupRow(doc, { prev: ARMS.prev, next: ARMS.next, center: single });
  assert.equal(row.center, null);
  assert.equal(row.track, null);
  assert.deepEqual(row.element.children.map((node) => [classes(node)[0], node.getAttribute("data-group")]), [
    ["bob-property-card-group-arm", "prev"],
    ["bob-property-card-group-gap", "center"],
    ["bob-property-card-group-arm", "next"],
  ], "the gap cell keeps the grid");
  assert.equal(row.element.querySelectorAll(".bob-property-card-group-tick").length, 0);
  assert.equal(H.propertyCardBuildGroupRow(doc, { center: single }), null, "a lone one-member centre builds no row");
  assert.equal(H.propertyCardBuildGroupRow(doc, { center: { ...single, size: 0, position: 0 } }), null);
  assert.ok(H.propertyCardBuildGroupRow(doc, { center: { ...single, size: 2, members: null } }).center, "two members keep the centre");
});

test("group row track: groups larger than 21 or without members use a bar and thumb", () => {
  const doc = makeDoc();
  const members = Array.from({ length: 22 }, (_, index) => ({ label: String(index + 1), state: index === 4 ? "current" : "exists" }));
  const big = H.propertyCardBuildGroupRow(doc, { center: { text: "5 of 22", position: 5, size: 22, members } });
  assert.equal(big.track.getAttribute("data-track"), "bar");
  assert.equal(big.track.querySelectorAll(".bob-property-card-group-tick").length, 0);
  const thumb = big.track.querySelector(".bob-property-card-group-thumb");
  assert.equal(thumb.getAttribute("style"), "left: 20.45%");
  const sizeOnly = H.propertyCardBuildGroupRow(doc, { center: { text: "week 8 of 30", position: 8, size: 30, members: members.slice(0, 3) } });
  assert.equal(sizeOnly.track.getAttribute("data-track"), "bar", "a size above 21 wins over a short member list");
  const noMembers = H.propertyCardBuildGroupRow(doc, { center: { text: "quarter 4 of 4", position: 4, size: 4, members: null } });
  assert.equal(noMembers.track.getAttribute("data-track"), "bar");
  assert.equal(noMembers.track.querySelector(".bob-property-card-group-thumb").getAttribute("style"), "left: 87.5%");
  const exactly21 = H.propertyCardBuildGroupRow(doc, { center: { text: "1 of 21", position: 1, size: 21, members: members.slice(0, 21) } });
  assert.equal(exactly21.track.getAttribute("data-track"), "ticks");
  assert.equal(exactly21.track.children.length, 21);
  for (const [position, size] of [[0, 4], [5, 4], [1.5, 4], ["x", 4], [undefined, undefined]]) {
    const row = H.propertyCardBuildGroupRow(doc, { center: { text: "?", position, size } });
    assert.equal(row.track, null, `${position}/${size}`);
    assert.equal(row.center.querySelector(".bob-property-card-group-track"), null);
  }
  assert.equal(H.propertyCardBuildGroupRow(doc, { center: { text: "?", position: 1, size: 0 } }), null, "size 0 is no centre");
});

test("group row writes text only through text nodes", () => {
  const doc = makeDoc();
  const hostile = "<img src=x onerror=alert(1)> & [[link]]";
  const row = H.propertyCardBuildGroupRow(doc, {
    prev: { groupLabel: hostile, landingLabel: hostile, target: "x", state: "exists" },
    center: { name: hostile, text: hostile, position: 1, size: 2 },
  });
  assert.equal(row.center.getAttribute("title"), hostile, "attributes take the raw text");
  assert.equal(row.arms.prev.querySelector(".bob-property-card-group-landing"), null);
  assert.equal(row.center.querySelector(".bob-property-card-group-name"), null);
  for (const node of [
    row.arms.prev.querySelector(".bob-property-card-group-label"),
    row.center.querySelector(".bob-property-card-group-position-label"),
  ]) {
    assert.equal(node.children.length, 0);
    assert.equal(node.textContent, hostile);
  }
});

test("rail items and chips: state mapping, unresolved back-compat, plus, ghost note, and stated navigation", () => {
  const doc = makeDoc();
  const navigated = [];
  const rail = H.propertyCardBuildRail(doc, {
    prev: { label: "W46", target: "2026/2026-W46", state: "exists", unresolved: true },
    parent: { label: "2025-Q4", target: "2025/2025-Q4", state: "ghost", ghostReason: "2025-Q4 is before Bob's period notes began" },
    next: { label: "W48", shortLabel: "W48", target: "2026/2026-W48", unresolved: true, tooltip: "2026-W48 isn't created yet" },
    children: [
      { label: "Mon 16", target: "2026/20261116" },
      { label: "Tue 17", target: "2026/20261117", state: "creatable" },
      { label: "Wed 18", target: "2025/20251218", state: "ghost", ghostReason: "not in vault reason" },
    ],
    onNavigate: (direction, item, event) => navigated.push([direction, item.state, item.target, event.type]),
  });
  const { prev, parent, next } = rail.items;
  assert.equal(prev.getAttribute("data-state"), null, "an explicit exists state wins over unresolved");
  assert.ok(!prev.classList.contains("is-unresolved"));

  assert.equal(next.getAttribute("data-state"), "creatable");
  assert.ok(next.classList.contains("is-creatable"));
  assert.ok(next.classList.contains("is-unresolved"), "the compatibility marker stays");
  assert.equal(next.getAttribute("href"), "2026/2026-W48");
  assert.equal(next.getAttribute("title"), "2026-W48 isn't created yet");
  assert.deepEqual(childClasses(next), [
    "bob-property-card-rail-label-wide", "bob-property-card-rail-label-narrow", "bob-property-card-rail-plus", "bob-property-card-rail-glyph",
  ]);
  assert.equal(next.querySelector(".bob-property-card-rail-plus").getAttribute("aria-hidden"), "true");
  assert.equal(next.children.at(-1).textContent, " ›", "the plus sits before the next glyph");

  assert.equal(parent.getAttribute("data-state"), "ghost");
  assert.ok(parent.classList.contains("is-ghost"));
  assert.ok(parent.classList.contains("is-unresolved"));
  assert.equal(parent.getAttribute("href"), null);
  assert.equal(parent.getAttribute("data-href"), null);
  assert.equal(parent.getAttribute("role"), "link");
  assert.equal(parent.getAttribute("tabindex"), "0");
  assert.equal(parent.getAttribute("aria-disabled"), "true");
  assert.equal(parent.getAttribute("title"), "2025-Q4 is before Bob's period notes began");
  assert.equal(parent.querySelector(".bob-property-card-rail-note").textContent, "· not in vault");
  assert.equal(parent.querySelector(".bob-property-card-rail-plus"), null);

  const [exists, creatable, ghost] = rail.children;
  assert.equal(exists.getAttribute("data-state"), null);
  assert.equal(exists.children.length, 0);
  assert.equal(creatable.getAttribute("data-state"), "creatable");
  assert.ok(creatable.classList.contains("is-unresolved"));
  assert.equal(creatable.getAttribute("role"), "listitem");
  assert.equal(creatable.querySelector(".bob-property-card-rail-plus").textContent, "+");
  assert.equal(ghost.getAttribute("data-state"), "ghost");
  assert.equal(ghost.getAttribute("role"), "listitem", "a chip keeps its list role");
  assert.equal(ghost.getAttribute("href"), null);
  assert.equal(ghost.getAttribute("aria-disabled"), "true");
  assert.equal(ghost.getAttribute("tabindex"), "0");
  assert.equal(ghost.getAttribute("title"), "not in vault reason", "chips put the reason only in the tooltip");
  assert.equal(ghost.children.length, 0, "ghost chips show no note and no plus");
  assert.equal(ghost.textContent, "Wed 18");

  next.fire("click");
  parent.fire("keydown", { key: "Enter" });
  next.fire("keydown", { key: "Enter" });
  creatable.fire("click");
  ghost.fire("keydown", { key: " " });
  prev.fire("click");
  assert.deepEqual(navigated, [
    ["next", "creatable", "2026/2026-W48", "click"],
    ["parent", "ghost", "2025/2025-Q4", "keydown"],
    ["child", "creatable", "2026/20261117", "click"],
    ["child", "ghost", "2025/20251218", "keydown"],
    ["prev", "exists", "2026/2026-W46", "click"],
  ]);
});

test("rail group row: between the step row and the children, group-only rails, and the group return", () => {
  const doc = makeDoc();
  const activated = [];
  const group = { label: "Week groups", prev: ARMS.prev, next: ARMS.next, center: weekCenter(), onActivate: (direction) => activated.push(direction) };
  const full = H.propertyCardBuildRail(doc, {
    prev: { label: "W46", target: "2026/2026-W46" },
    next: { label: "W48", target: "2026/2026-W48", unresolved: true },
    children: [{ label: "Mon 16", target: "2026/20261116" }],
    group,
  });
  assert.deepEqual(childClasses(full.element), [
    "bob-property-card-rail-row", "bob-property-card-group-row", "bob-property-card-rail-children",
  ]);
  assert.equal(full.group.element, full.element.children[1]);
  assert.equal(full.group.arms.next, full.element.querySelector('.bob-property-card-group-arm[data-group="next"]'));
  full.group.arms.prev.fire("click");
  assert.deepEqual(activated, ["prev"]);

  const groupOnly = H.propertyCardBuildRail(doc, { group });
  assert.ok(groupOnly, "a rail with only a group row renders");
  assert.deepEqual(childClasses(groupOnly.element), ["bob-property-card-group-row"], "no empty step row");
  assert.deepEqual(groupOnly.items, { prev: null, parent: null, next: null });
  assert.deepEqual(groupOnly.children, []);

  const groupAndChildren = H.propertyCardBuildRail(doc, { group, children: [{ label: "Mon 16", target: "x" }] });
  assert.deepEqual(childClasses(groupAndChildren.element), ["bob-property-card-group-row", "bob-property-card-rail-children"]);

  const emptyGroup = H.propertyCardBuildRail(doc, { group: { prev: { groupLabel: "" } } });
  assert.equal(emptyGroup, null, "a group spec that builds nothing does not make a rail");
  const childrenOnly = H.propertyCardBuildRail(doc, { children: [{ label: "Q1", target: "2026/2026-Q1" }], group: "nope" });
  assert.equal(childrenOnly.group, null);
  assert.equal(childrenOnly.element.querySelectorAll(".bob-property-card-rail-gap").length, 3, "legacy children-only rails keep their gap row");
  const stepOnly = H.propertyCardBuildRail(doc, { prev: { label: "W46", target: "x" } });
  assert.equal(stepOnly.group, null);
});

test("legacy rail specs (no state, no group) render byte-identical DOM", () => {
  const doc = makeDoc();
  const rail = H.propertyCardBuildRail(doc, {
    label: "Week navigation",
    prev: { label: "W46 · Nov 9 – 15", shortLabel: "W46", target: "2026/2026-W46", ariaLabel: "Previous week" },
    parent: { label: "2026-Q4", target: "2026/2026-Q4" },
    next: { label: "W48", target: "2026/2026-W48" },
    children: [
      { label: "Mon 16", target: "2026/20261116" },
      { label: "Fri 20", target: "2026/20261120", current: true },
    ],
  });
  assert.equal(rail.group, null);
  const expected = [
    '<nav aria-label="Week navigation" class="bob-property-card-rail">',
    '<div class="bob-property-card-rail-row">',
    '<a aria-label="Previous week" class="bob-property-card-rail-item" data-href="2026/2026-W46" data-rail="prev" href="2026/2026-W46">',
    '<span aria-hidden="true" class="bob-property-card-rail-glyph">"‹ "</span>',
    '<span class="bob-property-card-rail-label-wide">"W46 · Nov 9 – 15"</span>',
    '<span class="bob-property-card-rail-label-narrow">"W46"</span></a>',
    '<a class="bob-property-card-rail-item" data-href="2026/2026-Q4" data-rail="parent" href="2026/2026-Q4">',
    '<span aria-hidden="true" class="bob-property-card-rail-glyph">"↑ "</span>',
    '<span class="bob-property-card-rail-label-wide">"2026-Q4"</span>',
    '<span class="bob-property-card-rail-label-narrow">"2026-Q4"</span></a>',
    '<a class="bob-property-card-rail-item" data-href="2026/2026-W48" data-rail="next" href="2026/2026-W48">',
    '<span class="bob-property-card-rail-label-wide">"W48"</span>',
    '<span class="bob-property-card-rail-label-narrow">"W48"</span>',
    '<span aria-hidden="true" class="bob-property-card-rail-glyph">" ›"</span></a>',
    "</div>",
    '<div class="bob-property-card-rail-children" role="list">',
    '<a class="bob-property-card-rail-chip" data-href="2026/20261116" href="2026/20261116" role="listitem">"Mon 16"</a>',
    '<a aria-current="true" class="bob-property-card-rail-chip is-current" data-href="2026/20261120" href="2026/20261120" role="listitem">"Fri 20"</a>',
    "</div></nav>",
  ].join("");
  assert.equal(serialize(rail.element), expected);
});

test("styles: the group-row block follows the kit block with states, narrow, forced-colors, and reduced motion", () => {
  const css = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"), "utf8");
  const kitEnd = "/* Property-card identity kit (bob-cli-o6 identity-kit): end. */";
  const start = "/* Property-card group row (bob-cli-oj group-rail): start.";
  const end = "/* Property-card group row (bob-cli-oj group-rail): end. */";
  assert.equal(css.split(start).length, 2, "one start marker");
  assert.equal(css.split(end).length, 2, "one end marker");
  assert.ok(css.indexOf(kitEnd) < css.indexOf(start), "the block follows the kit block");
  assert.equal(css.slice(css.indexOf(kitEnd) + kitEnd.length, css.indexOf(start)).trim(), "", "right after the kit block");
  const block = css.slice(css.indexOf(start), css.indexOf(end));
  const balance = [...block].reduce((depth, ch) => depth + (ch === "{" ? 1 : ch === "}" ? -1 : 0), 0);
  assert.equal(balance, 0, "braces balance");
  for (const needle of [
    '.bob-property-card-rail-item[data-state]',
    '.bob-property-card-rail-chip[data-state="ghost"]',
    '.bob-property-card-group-arm[data-state="creatable"] .bob-property-card-group-label',
    '.bob-property-card-group-arm[data-state="creatable"] .bob-property-card-group-plus',
    '.bob-property-card-group-arm[data-state="ghost"] .bob-property-card-group-label',
    "text-decoration-style: dashed",
    "text-decoration-style: dotted",
    ".bob-property-card-group-mark",
    ".bob-freshness-link-group .bob-property-card-group-glyph",
    "border: 1px dashed",
    "border-style: dotted",
    '.bob-property-card-group-tick[data-state="current"]',
    '.bob-property-card-group-tick[data-state="missing"]',
    '.bob-property-card-group-track[data-track="bar"]',
    ".bob-property-card-group-thumb",
    "@container bob-property-card (max-width: 28rem)",
    "@container record-walk (max-width: 28rem)",
    "@media (forced-colors: active)",
    "CanvasText", "GrayText", "Highlight",
    "@media (prefers-reduced-motion: reduce)",
    "min-width: 32px",
  ]) assert.ok(block.includes(needle), needle);
  assert.ok(!/--text-error|text-decoration-style:\s*var\(--link-unresolved/.test(block), "never error red or unresolved-link styling");
  // Stated items drop the kit's is-unresolved underline and opacity.
  assert.match(block, /\.bob-property-card-rail-chip\[data-state\]\s*\{[^}]*opacity: 1;[^}]*text-decoration: none;/);
  // Group arms draw their states as underlines, never a box, and the spans
  // that no longer render have no rules.
  assert.match(block, /\.bob-property-card-group-arm \{[^}]*border: 0;/);
  assert.ok(!/\.bob-property-card-group-arm\[data-state="(?:creatable|ghost)"\]\s*(?:,[^{]*)?\{[^}]*border/.test(block), "no arm border box");
  for (const gone of ["group-landing", "group-sep", "group-name", "group-position-wide", "group-position-narrow"]) {
    assert.ok(!block.includes(`.bob-property-card-${gone}`), gone);
  }
  assert.match(block, /@media \(forced-colors: active\)[\s\S]*text-decoration-color: CanvasText/);
});
