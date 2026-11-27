// Cabinet absorption kit (bob-cli-qq absorption): recognizer, claims,
// Live Preview StateField, Reading tagging, and the catalog body renderer.
// Fixtures mirror src/native/host_catalog/region.rs and records_spec.
"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const effectType = { absorbEffect: true, of(value) { return { is: (type) => type === effectType, value }; } };
const StateEffect = {
  define: () => effectType,
};
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class RangeSetBuilder {
  constructor() {
    this.spans = [];
  }
  add(from, to, value) {
    this.spans.push({ from, to, value });
  }
  finish() {
    return this.spans;
  }
}
// A RangeSet-shaped stub: CodeMirror's cursor motion calls `.between()` on
// every atomicRanges result, so the stub carries it alongside list access.
class RangeSetStub {
  constructor(ranges) { this.ranges = ranges; }
  get length() { return this.ranges.length; }
  between(from, to, f) { for (const r of this.ranges) if (r.to >= from && r.from <= to) f(r.from, r.to, r.value); }
}
const Decoration = {
  none: new RangeSetStub([]),
  mark: (spec) => ({ spec, range: (from, to) => ({ from, to, value: spec }) }),
  widget: (options) => options,
  replace: (options) => ({
    replace: true,
    options,
    range: (from, to) => ({ from, to, replaced: true }),
  }),
  set: (ranges) => new RangeSetStub(ranges),
};
const EditorView = {
  decorations: { from: (field, get) => ({ field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ field, get }) },
  atomicRanges: { of: (value) => value },
};

function makeRendererStub(rendered) {
  return {
    calls: [],
    async render(app, source, target, path, component) {
      this.calls.push({ source, path });
      const doc = target?.ownerDocument;
      if (!doc || typeof target.appendChild !== "function") return;
      const callout = doc.createElement("div");
      callout.setAttribute("data-callout", "areas");
      callout.appendChild(doc.createTextNode(String(source).split("\n")[0]));
      const link = doc.createElement("a");
      link.setAttribute("class", "internal-link");
      link.setAttribute("data-href", "Target");
      link.setAttribute("href", "Target");
      link.appendChild(doc.createTextNode("Target"));
      callout.appendChild(link);
      target.appendChild(callout);
      if (rendered) rendered.push(callout);
    },
  };
}
let rendererStub = makeRendererStub();

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class {},
    MarkdownRenderer: { render: (...args) => rendererStub.render(...args) },
    Notice: class {},
    Plugin: TestPlugin,
    Platform: { isDesktopApp: true },
    normalizePath: (value) => value,
    editorInfoField,
    editorLivePreviewField,
    parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType: class {}, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) }, EditorView,
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  PROPERTY_CARD_CABINET_REGION_SPECS,
  propertyCardCabinetRegionSpec,
  propertyCardCabinetFingerprint,
  propertyCardCatalogScanSpec,
  propertyCardCatalogRegions,
  propertyCardCatalogRegionForHide,
  propertyCardCatalogClaim,
  propertyCardCatalogClaimed,
  propertyCardCatalogAbsorbed,
  propertyCardCabinetStandDown,
  propertyCardCatalogRevealClaim,
  propertyCardCatalogReleaseScope,
  propertyCardCatalogReleaseAll,
  propertyCardCabinetAbsorbRangesForPlan,
  propertyCardCabinetSelectionStrictlyInside,
  propertyCardCabinetAbsorbFieldReduce,
  propertyCardCabinetAbsorbFieldDecorations,
  propertyCardCabinetAbsorbAtomicRanges,
  propertyCardCabinetAbsorbAtomicRangeSet,
  propertyCardCabinetAbsorbShouldReveal,
  propertyCardCabinetAbsorbEditorExtension,
  propertyCardCabinetAbsorbInEditor,
  PROPERTY_CARD_CABINET_ABSORBED_CLASS,
  propertyCardCabinetAbsorbReadingTargets,
  propertyCardCabinetAbsorbPaintReading,
  propertyCardCabinetAbsorbRescanReading,
  propertyCardCabinetRenderCatalog,
} = helpers;

assert.ok(propertyCardCatalogRegions, "absorption helpers are exported");

class FakeNode {
  constructor(tag, doc, text = "") {
    this.tagName = tag ? tag.toUpperCase() : "#TEXT";
    this.nodeType = tag ? 1 : 3;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = text;
    const self = this;
    this.classList = {
      add(name) { self.setAttribute("class", [...new Set([...(self.getAttribute("class") || "").split(/\s+/).filter(Boolean), name])].join(" ")); },
      remove(name) { self.setAttribute("class", (self.getAttribute("class") || "").split(/\s+/).filter((item) => item && item !== name).join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = [new FakeNode("", this.ownerDocument, this._text)]; }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { let item = this; while (item) { if (item.root === true) return true; item = item.parentNode; } return false; }
  setAttribute(name, value) { this.attrs.set(String(name), String(value)); }
  getAttribute(name) { return this.attrs.has(String(name)) ? this.attrs.get(String(name)) : null; }
  removeAttribute(name) { this.attrs.delete(String(name)); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild?.(this); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  closest(selector) {
    const cls = /^\.([\w-]+)$/.exec(selector);
    let item = this;
    while (item) {
      if (cls && item.classList && item.classList.contains(cls[1])) return item;
      item = item.parentNode;
    }
    return null;
  }
  matches(selector) {
    const cls = /^\.([\w-]+)$/.exec(selector);
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    const id = /^#([\w-]+)$/.exec(selector);
    const tag = /^[A-Za-z][\w-]*$/.exec(selector);
    const tagCls = /^([A-Za-z][\w-]*)\.([\w-]+)$/.exec(selector);
    return Boolean((cls && this.classList.contains(cls[1]))
      || (attr && this.attrs.has(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]))
      || (id && this.getAttribute("id") === id[1])
      || (tag && this.tagName === tag[0].toUpperCase())
      || (tagCls && this.tagName === tagCls[1].toUpperCase() && this.classList.contains(tagCls[2])));
  }
  querySelectorAll(selector) {
    const found = [];
    const parts = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType === 1 && parts.some((part) => child.matches(part))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { const items = this.listeners.get(type) || []; items.push(callback); this.listeners.set(type, items); }
  fire(type, event) { for (const callback of this.listeners.get(type) || []) callback(event); }
}

function fakeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
}

function absorbEffect(payload) {
  return { is: (type) => type === effectType, value: payload };
}

function fieldState({ text, path, live = true, selection = null }) {
  return {
    field: (field, notFound) => {
      if (field === editorLivePreviewField) return live;
      if (field === editorInfoField) return { file: { path } };
      return notFound;
    },
    doc: { toString: () => text },
    selection,
  };
}

// A fake Live Preview editor whose dispatch runs the real absorb reducer, so
// claim leases and the field stay comparable. `show(path)` switches files.
function fakeAbsorbEditor(text, path) {
  const field = propertyCardCabinetAbsorbEditorExtension();
  const deps = { effect: effectType, livePreviewField: editorLivePreviewField, infoField: editorInfoField };
  let shown = path;
  let value;
  const view = {
    dispatched: [],
    get state() {
      const base = fieldState({ text, path: shown });
      return { ...base, field: (f, notFound) => (f === field ? value : base.field(f, notFound)) };
    },
    dispatch(tr) {
      view.dispatched.push(tr.effects.value);
      value = propertyCardCabinetAbsorbFieldReduce(value, { effects: [tr.effects], docChanged: false, state: view.state }, deps);
    },
    show(next) {
      shown = next;
      value = propertyCardCabinetAbsorbFieldReduce(value, { effects: [], docChanged: true, state: view.state }, deps);
    },
    field: () => value,
  };
  return view;
}

const AREAS_NOTE = [
  "---",
  "type: area",
  "---",
  "",
  "# Cash",
  "",
  "## Areas",
  "",
  "> [!areas]",
  "> - [[Food]]",
  "> - [[Transit]]",
  "",
  "## Tasks",
  "",
  "- [ ] Buy milk",
  "",
].join("\n");

test("recognizer: table covers all five catalog kinds", () => {
  assert.deepEqual(PROPERTY_CARD_CABINET_REGION_SPECS.map((spec) => spec.kind), ["areas", "projects", "notebooks", "albums", "records"]);
  assert.ok(propertyCardCabinetRegionSpec("records"));
  assert.equal(propertyCardCabinetRegionSpec("nope"), null);
});

test("recognizer: basic areas region with a hideable heading", () => {
  const plan = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas");
  assert.equal(plan.damage, null);
  assert.equal(plan.startLine, 9);
  assert.equal(plan.endLine, 11);
  assert.equal(plan.headingLine, 7);
  assert.match(plan.fingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(propertyCardCatalogRegionForHide(AREAS_NOTE, "projects"), null);
});

test("recognizer: fingerprint notices a vault change", () => {
  const before = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas").fingerprint;
  const after = propertyCardCatalogRegionForHide(AREAS_NOTE.replace("> - [[Transit]]", "> - [[Transit]]\n> - [[Extra]]"), "areas");
  assert.notEqual(before, after.fingerprint);
});

test("recognizer: CRLF, BOM, and missing trailing newline", () => {
  const crlf = `\r\n## Projects\r\n\r\n> [!projects]\r\n> - [[A]]\r\n`;
  const plan = propertyCardCatalogRegionForHide(crlf, "projects");
  assert.equal(plan.damage, null);
  assert.equal(plan.startLine, 4, "1-based physical lines count the leading blank");
  assert.equal(plan.headingLine, 2);
  const bom = `\uFEFF---\ntype: area\n---\n## Areas\n\n> [!areas]\n> - [[A]]\n`;
  assert.equal(propertyCardCatalogRegionForHide(bom, "areas").startLine, 6);
  const eof = "## Albums\n\n> [!albums]\n> - [[A]]";
  const album = propertyCardCatalogRegionForHide(eof, "albums");
  assert.equal(album.damage, null);
  assert.equal(album.endLine, 4);
});

test("recognizer: fold signs, titles, and case do not matter", () => {
  for (const head of ["> [!areas]-", "> [!AREAS] + My areas", ">   [!areas]", "  > [!areas] Areas"]) {
    const plan = propertyCardCatalogRegionForHide(`## Areas\n\n${head}\n> - [[A]]\n`, "areas");
    assert.equal(plan.damage, null, head);
    assert.equal(plan.startLine, 3, head);
  }
  const alias = propertyCardCatalogRegionForHide("## Areas\n\n> [!areas|alias]\n> - [[A]]\n", "areas");
  assert.match(alias.damage.message, /malformed/, "a |alias form is not a head (strict damage, never hidden)");
});

test("recognizer: frontmatter and fences are ignored", () => {
  const note = ["---", "> [!areas]", "---", "", "## Areas", "", "> [!areas]", "> - [[A]]", ""].join("\n");
  const plan = propertyCardCatalogRegionForHide(note, "areas");
  assert.equal(plan.startLine, 7);
  const fenced = ["## Areas", "", "```", "> [!areas]", "```", "", "> [!areas]", "> - [[A]]", ""].join("\n");
  assert.equal(propertyCardCatalogRegionForHide(fenced, "areas").startLine, 7);
  const tilde = ["## Areas", "", "~~~", "> [!areas]", "~~~", "", "> [!areas]", "> - [[A]]", ""].join("\n");
  assert.equal(propertyCardCatalogRegionForHide(tilde, "areas").startLine, 7);
});

test("recognizer: a differing heading is never adopted", () => {
  const note = ["## Districts", "", "> [!areas]", "> - [[A]]", ""].join("\n");
  const plan = propertyCardCatalogRegionForHide(note, "areas");
  assert.equal(plan.damage, null);
  assert.equal(plan.headingLine, null);
  assert.equal(plan.startLine, 3);
});

test("recognizer: authored prose keeps the heading", () => {
  const note = ["## Areas", "", "My own intro.", "", "> [!areas]", "> - [[A]]", ""].join("\n");
  const plan = propertyCardCatalogRegionForHide(note, "areas");
  assert.equal(plan.damage, null);
  assert.equal(plan.headingLine, null);
  assert.equal(plan.startLine, 5);
});

test("recognizer: duplicates and malformed openers are damage", () => {
  const dup = ["## Areas", "", "> [!areas]", "> - [[A]]", "", "> [!areas]", "> - [[B]]", ""].join("\n");
  assert.match(propertyCardCatalogRegionForHide(dup, "areas").damage.message, /duplicate/);
  const bad = ["## Albums", "", "> [!albums", "> - [[A]]", ""].join("\n");
  assert.match(propertyCardCatalogRegionForHide(bad, "albums").damage.message, /malformed/);
  const cardLike = ["## Albums", "", "> [!albums-card]", "", "> [!albums]", "> - [[A]]", ""].join("\n");
  assert.equal(propertyCardCatalogRegionForHide(cardLike, "albums").damage, null, "[!albums-card] stays authored");
});

test("recognizer: only managed rows are absorbed; authored rows keep the section visible", () => {
  const closed = ["## Projects", "", "> [!projects]", ">", "> - **[[alpha]]**", "> - **Closed**", ">   - ✅ **[[beta]]** — shipped", ""].join("\n");
  const closedPlan = propertyCardCatalogRegionForHide(closed, "projects");
  assert.equal(closedPlan.damage, null, "bob's Projects closed-group label is a managed row");
  assert.equal(closedPlan.startLine, 3);
  assert.equal(closedPlan.headingLine, 1);
  const authored = ["## Projects", "", "> [!projects]", "> - **[[alpha]]**", "> - not-a-managed-row", ""].join("\n");
  assert.match(propertyCardCatalogRegionForHide(authored, "projects").damage.message, /ambiguous projects catalog row/);
  const closedElsewhere = ["## Areas", "", "> [!areas]", "> - **[[alpha]]**", "> - **Closed**", ""].join("\n");
  assert.match(propertyCardCatalogRegionForHide(closedElsewhere, "areas").damage.message, /ambiguous areas catalog row/,
    "the closed label is managed only where bob writes it");
  const titled = ["## Areas", "", "> [!areas]- Areas", ">", "> - **[[alpha]]**", ""].join("\n");
  assert.equal(propertyCardCatalogRegionForHide(titled, "areas").damage, null, "the callout head is framing, not a row");
});

test("recognizer: legacy notebook markers", () => {
  const legacy = ["## Notebooks", "", "<!-- bob:notebooks:begin v1 -->", "> [!notebooks]", "> - [[A]]", "<!-- bob:notebooks:end -->", ""].join("\n");
  const plan = propertyCardCatalogRegionForHide(legacy, "notebooks");
  assert.equal(plan.damage, null);
  assert.equal(plan.startLine, 3);
  assert.equal(plan.endLine, 6);
  const lone = ["## Notebooks", "", "<!-- bob:notebooks:end -->", ""].join("\n");
  assert.match(propertyCardCatalogRegionForHide(lone, "notebooks").damage.message, /no begin marker/);
  const reversed = ["<!-- bob:notebooks:end -->", "<!-- bob:notebooks:begin v1 -->"].join("\n");
  assert.match(propertyCardCatalogScanSpec(reversed, propertyCardCabinetRegionSpec("notebooks")).damage.message, /reversed/);
  const dupe = ["<!-- bob:notebooks:begin v1 -->", "<!-- bob:notebooks:begin v1 -->", "<!-- bob:notebooks:end -->"].join("\n");
  assert.match(propertyCardCatalogScanSpec(dupe, propertyCardCabinetRegionSpec("notebooks")).damage.message, /duplicated/);
});

test("recognizer: records heads carry the tally title", () => {
  const note = ["## Records", "", "> [!records] 24 restaurants · by Status", "> - [[A]]", ""].join("\n");
  const plan = propertyCardCatalogRegionForHide(note, "records");
  assert.equal(plan.damage, null);
  assert.equal(plan.startLine, 3);
  assert.equal(plan.headingLine, 1);
  const bare = ["## Records", "", "> [!records]", "> - [[A]]", ""].join("\n");
  assert.equal(propertyCardCatalogRegionForHide(bare, "records").startLine, 3);
});

test("recognizer: regions() scans every kind at once", () => {
  const all = propertyCardCatalogRegions(AREAS_NOTE);
  assert.deepEqual(Object.keys(all).sort(), ["albums", "areas", "notebooks", "projects", "records"]);
  assert.equal(all.areas.regions.length, 1);
  assert.equal(all.projects.regions.length, 0);
  assert.equal(all.projects.damage, null);
});

test("claims: lifecycle, generations, fingerprints, and release", () => {
  const view = {};
  const plan = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas");
  let revealed = 0;
  const release = propertyCardCatalogClaim({ view, path: "Cash.md", kind: "areas", fingerprint: plan.fingerprint, generation: 7, reveal: () => { revealed += 1; return true; } });
  assert.equal(propertyCardCatalogClaimed(view, "Cash.md", "areas", plan.fingerprint, 7), true);
  assert.equal(propertyCardCatalogClaimed(view, "Cash.md", "areas", plan.fingerprint, 8), false, "a stale generation reads unclaimed");
  assert.equal(propertyCardCatalogClaimed(view, "Cash.md", "areas", "fnv1a:deadbeef", 7), false, "a changed vault reads unclaimed");
  assert.equal(propertyCardCatalogAbsorbed(view, "Cash.md", "areas"), true);
  assert.equal(propertyCardCatalogRevealClaim(view, "Cash.md", "areas"), true);
  assert.equal(revealed, 1);
  release();
  release();
  assert.equal(propertyCardCatalogClaimed(view, "Cash.md", "areas", plan.fingerprint, 7), false);
  assert.equal(propertyCardCatalogAbsorbed(view, "Cash.md", "areas"), false);
  assert.equal(propertyCardCatalogRevealClaim(view, "Cash.md", "areas"), false);

  // A reveal that could not open its cabinet (a detached panel) reports
  // failure, so navigation falls through to the next candidate view.
  const stale = propertyCardCatalogClaim({ view, path: "Cash.md", kind: "areas", fingerprint: plan.fingerprint, generation: 8, reveal: () => false });
  assert.equal(propertyCardCatalogRevealClaim(view, "Cash.md", "areas"), false);
  stale();
  const thrower = propertyCardCatalogClaim({ view, path: "Cash.md", kind: "areas", fingerprint: plan.fingerprint, generation: 9, reveal: () => { throw new Error("gone"); } });
  assert.equal(propertyCardCatalogRevealClaim(view, "Cash.md", "areas"), false);
  thrower();
});

test("claims: scope and global release, and the painter stand-down", () => {
  const view = {};
  propertyCardCatalogClaim({ view, path: "A.md", kind: "areas", fingerprint: "f", generation: 1 });
  propertyCardCatalogClaim({ view, path: "A.md", kind: "projects", fingerprint: "f", generation: 1 });
  assert.equal(propertyCardCatalogReleaseScope(view), 2);
  assert.equal(propertyCardCatalogClaimed(view, "A.md", "areas", "f", 1), false);
  propertyCardCatalogClaim({ view, path: "B.md", kind: "albums", fingerprint: "f", generation: 1 });
  assert.ok(propertyCardCatalogReleaseAll() >= 1);
  assert.equal(propertyCardCatalogClaimed(view, "B.md", "albums", "f", 1), false);

  const doc = fakeDoc();
  const body = doc.createElement("div");
  body.setAttribute("class", "bob-property-card-cabinets");
  const inner = doc.createElement("div");
  body.appendChild(inner);
  assert.equal(propertyCardCabinetStandDown(inner, view, "B.md", "albums"), true, "inside a cabinet body painters stand down");
  const plain = doc.createElement("div");
  assert.equal(propertyCardCabinetStandDown(plain, view, "B.md", "albums"), false, "no claim, no stand-down");
});

test("editor: absorb effect hides the hide plan, Source mode fails open", () => {
  const plan = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas");
  const deps = { effect: effectType, livePreviewField: editorLivePreviewField, infoField: editorInfoField };
  const claimed = propertyCardCabinetAbsorbFieldReduce(
    undefined,
    { effects: [absorbEffect({ absorb: { path: "Cash.md", kind: "areas", fingerprint: plan.fingerprint, generation: 3 } })], docChanged: true, state: fieldState({ text: AREAS_NOTE, path: "Cash.md" }) },
    deps,
  );
  assert.equal(claimed.claim.kind, "areas");
  assert.equal(claimed.ranges.length, 1);
  assert.equal(claimed.revealed, false);
  const decos = propertyCardCabinetAbsorbFieldDecorations(claimed);
  assert.equal(decos.length, 1);
  assert.ok(propertyCardCabinetAbsorbAtomicRanges(claimed).length === 1, "rung b: atomic ranges cover the hidden span");

  const source = propertyCardCabinetAbsorbFieldReduce(
    claimed,
    { effects: [], docChanged: false, state: fieldState({ text: AREAS_NOTE, path: "Cash.md", live: false }) },
    deps,
  );
  assert.equal(source.claim, null);
  assert.deepEqual(source.ranges, []);
  assert.equal(propertyCardCabinetAbsorbFieldDecorations(source), Decoration.none);
});

test("editor: fingerprint mismatch and wrong file release the claim", () => {
  const deps = { effect: effectType, livePreviewField: editorLivePreviewField, infoField: editorInfoField };
  const claimed = propertyCardCabinetAbsorbFieldReduce(
    undefined,
    { effects: [absorbEffect({ absorb: { path: "Cash.md", kind: "areas", fingerprint: "fnv1a:stale", generation: 1 } })], docChanged: true, state: fieldState({ text: AREAS_NOTE, path: "Cash.md" }) },
    deps,
  );
  assert.equal(claimed.claim, null, "a stale fingerprint never hides");
  const other = propertyCardCabinetAbsorbFieldReduce(
    undefined,
    { effects: [absorbEffect({ absorb: { path: "Cash.md", kind: "areas", fingerprint: propertyCardCatalogRegionForHide(AREAS_NOTE, "areas").fingerprint, generation: 1 } })], docChanged: true, state: fieldState({ text: AREAS_NOTE, path: "Other.md" }) },
    deps,
  );
  assert.equal(other.claim, null, "a claim for another file never hides");
});

test("editor: strict-inside reveal, boundary contact never reveals", () => {
  const plan = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas");
  const ranges = propertyCardCabinetAbsorbRangesForPlan(AREAS_NOTE, plan);
  assert.equal(ranges.length, 1);
  const [range] = ranges;
  assert.ok(range.from < range.to);
  // The hidden span covers the heading, the callout, and one blank line.
  assert.match(AREAS_NOTE.slice(range.from, range.to), /## Areas/);
  assert.match(AREAS_NOTE.slice(range.from, range.to), /\[\!areas\]/);
  assert.equal(propertyCardCabinetSelectionStrictlyInside({ anchor: range.from + 2, head: range.from + 5 }, range), true);
  assert.equal(propertyCardCabinetSelectionStrictlyInside({ anchor: range.from, head: range.from + 5 }, range), false, "boundary contact never reveals");
  assert.equal(propertyCardCabinetSelectionStrictlyInside({ anchor: range.to - 1, head: range.to }, range), false, "boundary contact never reveals");
  assert.equal(propertyCardCabinetSelectionStrictlyInside({ anchor: range.from - 4, head: range.from - 1 }, range), false);
  assert.equal(propertyCardCabinetAbsorbShouldReveal({ ranges }, range.from + 2), true);
  assert.equal(propertyCardCabinetAbsorbShouldReveal({ ranges }, range.from), false);
  assert.equal(propertyCardCabinetAbsorbShouldReveal({ ranges }, range.to), false);

  const deps = { effect: effectType, livePreviewField: editorLivePreviewField, infoField: editorInfoField };
  const claimed = propertyCardCabinetAbsorbFieldReduce(
    undefined,
    { effects: [absorbEffect({ absorb: { path: "Cash.md", kind: "areas", fingerprint: plan.fingerprint, generation: 1 } })], docChanged: true, state: fieldState({ text: AREAS_NOTE, path: "Cash.md" }) },
    deps,
  );
  const touched = propertyCardCabinetAbsorbFieldReduce(
    claimed,
    { effects: [], docChanged: false, state: fieldState({ text: AREAS_NOTE, path: "Cash.md", selection: { anchor: range.from + 2, head: range.from + 5 } }) },
    deps,
  );
  assert.equal(touched.revealed, true);
  assert.equal(propertyCardCabinetAbsorbFieldDecorations(touched), Decoration.none);
});

test("editor: rungs default to atomic and select bare replace", () => {
  const deps = { effect: effectType, livePreviewField: editorLivePreviewField, infoField: editorInfoField };
  const plan = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas");
  const absorb = (rung) => propertyCardCabinetAbsorbFieldReduce(
    undefined,
    { effects: [absorbEffect({ absorb: { path: "Cash.md", kind: "areas", fingerprint: plan.fingerprint, generation: 1, rung } })], docChanged: true, state: fieldState({ text: AREAS_NOTE, path: "Cash.md" }) },
    deps,
  );
  assert.equal(absorb(undefined).claim.rung, "atomic");
  assert.equal(absorb("atomic").claim.rung, "atomic");
  assert.equal(absorb("replace").claim.rung, "replace");
  assert.equal(propertyCardCabinetAbsorbAtomicRanges(absorb(undefined)).length, 1, "rung b maps the cursor around the span");
  assert.deepEqual(propertyCardCabinetAbsorbAtomicRanges(absorb("replace")), [], "rung a leaves bare replace decorations");
});

test("editor: atomicRanges hands CodeMirror a RangeSet, never a plain array", () => {
  const field = propertyCardCabinetAbsorbEditorExtension();
  assert.ok(field, "the StateField builds with stubs");
  const provided = field.spec.provide(field);
  const atomic = provided.find((extension) => typeof extension === "function");
  assert.ok(atomic, "the field provides an atomicRanges function");
  const viewWith = (value) => ({ state: { field: () => value } });
  for (const value of [undefined, null, { claim: null, ranges: [] }]) {
    const set = atomic(viewWith(value));
    assert.equal(typeof set.between, "function", "an unclaimed editor still yields a RangeSet");
    assert.equal(set, Decoration.none);
  }
  const hidden = atomic(viewWith({ claim: { rung: "atomic" }, ranges: [{ from: 10, to: 40 }], revealed: false }));
  assert.equal(typeof hidden.between, "function");
  const seen = [];
  hidden.between(0, 100, (from, to) => seen.push([from, to]));
  assert.deepEqual(seen, [[10, 40]]);
  const throwing = atomic({ state: { field: () => { throw new Error("no field"); } } });
  assert.equal(throwing, Decoration.none, "a failing read falls back to the empty RangeSet");
  assert.equal(propertyCardCabinetAbsorbAtomicRangeSet([{ from: 5, to: 5 }, null, { from: "a", to: 3 }]), Decoration.none);
});

test("editor: extension and in-editor claim handle", () => {
  assert.ok(propertyCardCabinetAbsorbEditorExtension(), "the StateField builds with stubs");
  const view = fakeAbsorbEditor(AREAS_NOTE, "Cash.md");
  const dispatched = view.dispatched;
  const plan = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas");
  const absorbOptions = { path: "Cash.md", kind: "areas", fingerprint: plan.fingerprint, defer: (fn) => { fn(); } };
  const handle = propertyCardCabinetAbsorbInEditor(view, absorbOptions);
  assert.ok(handle, "a Live Preview editor carries the claim");
  assert.equal(typeof handle.generation, "number");
  assert.equal(dispatched.length, 1);
  assert.deepEqual(view.field().claims.map((claim) => claim.kind), ["areas"]);
  const same = propertyCardCabinetAbsorbInEditor(view, absorbOptions);
  assert.equal(dispatched.length, 1, "re-claiming the same region dispatches nothing");
  assert.notEqual(same, handle, "each mount holds its own lease");
  assert.equal(same.generation, handle.generation, "both leases share one editor claim");
  // A repaint mounts the new stack before the old one releases: the old
  // mount's release must not lift the claim the new mount still holds.
  handle();
  handle();
  assert.equal(dispatched.length, 1, "releasing one lease keeps the claim");
  same();
  assert.equal(dispatched.length, 2, "the last lease releases the claim");
  assert.deepEqual(dispatched[1], { release: handle.generation });
  assert.deepEqual(view.field().claims, []);
  const fresh = propertyCardCabinetAbsorbInEditor(view, absorbOptions);
  assert.notEqual(fresh.generation, handle.generation, "a released claim is never revived");
  // The editor shows another file, so the field drops the claim while the
  // stack that holds the lease stays registered. Returning re-asserts it.
  view.show("Other.md");
  assert.deepEqual(view.field().claims, []);
  view.show("Cash.md");
  const back = propertyCardCabinetAbsorbInEditor(view, absorbOptions);
  assert.equal(back.generation, fresh.generation);
  assert.deepEqual(dispatched.at(-1).absorb && dispatched.at(-1).absorb.generation, fresh.generation, "a dropped claim is re-dispatched");
  assert.deepEqual(view.field().claims.map((claim) => claim.generation), [fresh.generation]);
  const count = dispatched.length;
  const held = propertyCardCabinetAbsorbInEditor(view, absorbOptions);
  assert.equal(dispatched.length, count, "a claim the field still holds is not re-dispatched");
  fresh();
  back();
  held();
  assert.deepEqual(view.field().claims, []);
  assert.equal(propertyCardCatalogReleaseScope(view), 0, "editor claims ride the field, not the claim registry");
  assert.equal(propertyCardCabinetAbsorbInEditor(null), null);
  assert.equal(propertyCardCabinetAbsorbInEditor(view, { path: "Cash.md", kind: "nope" }), null);
});

test("editor: a host's catalogs absorb together, one claim per kind", () => {
  const note = [
    "---", "type: area", "---", "", "# Cash", "",
    "## Areas", "", "> [!areas]", "> - [[Food]]", "",
    "## Projects", "", "> [!projects]", "> - **[[Alpha]]**", "> - **Closed**", ">   - ✅ **[[Beta]]**", "",
    "## Notes", "", "Body.", "",
  ].join("\n");
  const deps = { effect: effectType, livePreviewField: editorLivePreviewField, infoField: editorInfoField };
  const areas = propertyCardCatalogRegionForHide(note, "areas");
  const projects = propertyCardCatalogRegionForHide(note, "projects");
  assert.equal(projects.damage, null);
  const both = propertyCardCabinetAbsorbFieldReduce(
    undefined,
    { effects: [
      absorbEffect({ absorb: { path: "Cash.md", kind: "areas", fingerprint: areas.fingerprint, generation: 1 } }),
      absorbEffect({ absorb: { path: "Cash.md", kind: "projects", fingerprint: projects.fingerprint, generation: 2 } }),
    ], docChanged: true, state: fieldState({ text: note, path: "Cash.md" }) },
    deps,
  );
  assert.deepEqual(both.claims.map((claim) => claim.kind), ["areas", "projects"], "a second kind never displaces the first");
  assert.equal(both.claim.kind, "projects");
  assert.deepEqual(both.ranges.map((range) => range.kind), ["areas", "projects"]);
  assert.equal(propertyCardCabinetAbsorbFieldDecorations(both).length, 2);
  assert.equal(propertyCardCabinetAbsorbAtomicRanges(both).length, 2);
  assert.match(note.slice(both.ranges[1].from, both.ranges[1].to), /\*\*Closed\*\*/);

  const [areaRange] = both.ranges;
  const inside = propertyCardCabinetAbsorbFieldReduce(
    both,
    { effects: [], docChanged: false, state: fieldState({ text: note, path: "Cash.md", selection: { anchor: areaRange.from + 2, head: areaRange.from + 3 } }) },
    deps,
  );
  assert.equal(inside.revealed, true);
  assert.deepEqual(inside.ranges.map((range) => range.revealed), [true, false]);
  const hiddenWhileRevealed = propertyCardCabinetAbsorbFieldDecorations(inside);
  assert.equal(hiddenWhileRevealed.length, 1, "revealing Areas keeps Projects hidden");
  assert.equal(hiddenWhileRevealed.ranges[0].from, both.ranges[1].from);

  const reclaimed = propertyCardCabinetAbsorbFieldReduce(
    both,
    { effects: [absorbEffect({ absorb: { path: "Cash.md", kind: "areas", fingerprint: areas.fingerprint, generation: 3 } })], docChanged: false, state: fieldState({ text: note, path: "Cash.md" }) },
    deps,
  );
  assert.deepEqual(reclaimed.claims.map((claim) => [claim.kind, claim.generation]), [["projects", 2], ["areas", 3]], "a kind's new claim replaces only its own");
  const released = propertyCardCabinetAbsorbFieldReduce(
    reclaimed,
    { effects: [absorbEffect({ release: 2 })], docChanged: false, state: fieldState({ text: note, path: "Cash.md" }) },
    deps,
  );
  assert.deepEqual(released.claims.map((claim) => claim.kind), ["areas"]);
  assert.deepEqual(released.ranges.map((range) => range.kind), ["areas"]);
  const stale = propertyCardCabinetAbsorbFieldReduce(
    released,
    { effects: [absorbEffect({ release: 1 })], docChanged: false, state: fieldState({ text: note, path: "Cash.md" }) },
    deps,
  );
  assert.equal(stale, released, "a superseded generation's release changes nothing");

  const view = fakeAbsorbEditor(note, "Cash.md");
  const dispatched = view.dispatched;
  const now = (fn) => { fn(); };
  const areaHandle = propertyCardCabinetAbsorbInEditor(view, { path: "Cash.md", kind: "areas", fingerprint: areas.fingerprint, defer: now });
  const projectHandle = propertyCardCabinetAbsorbInEditor(view, { path: "Cash.md", kind: "projects", fingerprint: projects.fingerprint, defer: now });
  assert.ok(areaHandle && projectHandle && areaHandle !== projectHandle);
  assert.deepEqual(dispatched.map((payload) => Object.keys(payload)[0]), ["absorb", "absorb"], "claiming Projects never releases Areas");
  assert.deepEqual(view.field().claims.map((claim) => claim.kind), ["areas", "projects"]);
  const areaAgain = propertyCardCabinetAbsorbInEditor(view, { path: "Cash.md", kind: "areas", fingerprint: areas.fingerprint, defer: now });
  assert.equal(areaAgain.generation, areaHandle.generation);
  areaHandle();
  areaHandle();
  assert.equal(dispatched.length, 2, "a repainted Areas cabinet still holds its claim");
  areaAgain();
  assert.deepEqual(dispatched.slice(2), [{ release: areaHandle.generation }]);
  projectHandle();
  assert.deepEqual(dispatched.slice(3), [{ release: projectHandle.generation }]);
  assert.deepEqual(view.field().claims, []);
});

function readingScope() {
  const doc = fakeDoc();
  const scope = doc.createElement("div");
  const sizer = doc.createElement("div");
  sizer.setAttribute("class", "markdown-preview-sizer");
  const section = doc.createElement("div");
  section.setAttribute("class", "el-h2");
  const heading = doc.createElement("h2");
  heading.appendChild(doc.createTextNode("Areas"));
  const callout = doc.createElement("div");
  callout.setAttribute("class", "callout");
  callout.setAttribute("data-callout", "areas");
  callout.appendChild(doc.createTextNode("> [!areas]"));
  section.appendChild(heading);
  section.appendChild(callout);
  sizer.appendChild(section);
  scope.appendChild(sizer);
  return { doc, scope, heading, callout };
}

test("reading: source-aware targets skip chrome, cards, and embeds", () => {
  const { scope, heading, callout } = readingScope();
  const plan = propertyCardCatalogRegionForHide(AREAS_NOTE, "areas");
  const targets = propertyCardCabinetAbsorbReadingTargets(scope, plan);
  assert.equal(targets.callout, callout);
  assert.equal(targets.heading, heading);

  const tagged = propertyCardCabinetAbsorbPaintReading(scope, plan, true);
  assert.equal(tagged.length, 2);
  assert.equal(tagged[0], callout);
  assert.equal(tagged[1], heading);
  assert.ok(callout.classList.contains(PROPERTY_CARD_CABINET_ABSORBED_CLASS));
  assert.ok(heading.classList.contains(PROPERTY_CARD_CABINET_ABSORBED_CLASS));
  const rescanned = propertyCardCabinetAbsorbRescanReading(scope, [{ plan }], tagged);
  assert.equal(rescanned.length, 2, "re-scan re-tags after clearing");

  const doc = fakeDoc();
  const cardScope = doc.createElement("div");
  const sizer = doc.createElement("div");
  sizer.setAttribute("class", "markdown-preview-sizer");
  const card = doc.createElement("div");
  card.setAttribute("class", "bob-property-card");
  sizer.appendChild(card);
  cardScope.appendChild(sizer);
  assert.equal(propertyCardCabinetAbsorbReadingTargets(cardScope, plan).callout, null, "cards are never tagged");
});

test("renderer: paints, binds links, re-uses, and fails open", async () => {
  const doc = fakeDoc();
  const plugin = { app: { workspace: { openLinkText: () => {}, trigger: () => {} } } };
  const regionSource = "> [!areas]\n> - [[Food]]\n> - [[Transit]]";
  let painted = 0;
  let paintedEl = null;
  const container = doc.createElement("div");
  const first = await propertyCardCabinetRenderCatalog({
    plugin, doc, container, path: "Cash.md", regionSource,
    paint: async (el) => { painted += 1; paintedEl = el; },
    paintKey: "areas:v1",
  });
  assert.deepEqual(first, { reused: false, failed: false });
  assert.equal(painted, 1);
  assert.equal(paintedEl.getAttribute("data-callout"), "areas");
  const link = container.querySelector("a.internal-link");
  assert.ok(link, "the body keeps internal links");
  assert.ok(link.__bobCabinetBound, "links are bound once");

  let opened = null;
  plugin.app.workspace.openLinkText = (target, path) => { opened = { target, path }; };
  let prevented = false;
  link.fire("click", { defaultPrevented: false, preventDefault: () => { prevented = true; }, ctrlKey: false, metaKey: false });
  assert.equal(prevented, true);
  assert.deepEqual(opened, { target: "Target", path: "Cash.md" });

  // A body still inside another mount's container belongs to that mount:
  // a second mount renders fresh instead of leaving the first one blank.
  const other = doc.createElement("div");
  const parallel = await propertyCardCabinetRenderCatalog({
    plugin, doc, container: other, path: "Cash.md", regionSource,
    paint: async () => { painted += 1; },
    paintKey: "areas:v1",
  });
  assert.deepEqual(parallel, { reused: false, failed: false });
  assert.equal(painted, 2, "a body owned by another mount is never moved");
  assert.ok(container.querySelector("a.internal-link"), "the first mount keeps its body");
  assert.ok(other.querySelector("a.internal-link"));

  // Once its mount clears it, the cached body is orphaned and re-attaches.
  while (other.firstChild) other.removeChild(other.firstChild);
  const detached = doc.createElement("div");
  const second = await propertyCardCabinetRenderCatalog({
    plugin, doc, container: detached, path: "Cash.md", regionSource,
    paint: async () => { painted += 1; },
    paintKey: "areas:v1",
  });
  assert.deepEqual(second, { reused: true, failed: false });
  assert.equal(painted, 2, "an orphaned cached body re-attaches without repainting");

  let released = 0;
  const failing = doc.createElement("div");
  const bad = await propertyCardCabinetRenderCatalog({
    plugin, doc, container: failing, path: "Cash.md", regionSource,
    paint: async () => { throw new Error("painter down"); },
    paintKey: "areas:broken",
    releaseClaim: () => { released += 1; },
  });
  assert.deepEqual(bad, { reused: false, failed: true });
  assert.equal(released, 1, "a failed body releases the claim so the section returns");
  assert.match(failing.textContent, /Couldn't render/);

  const empty = await propertyCardCabinetRenderCatalog({ plugin, doc, container: doc.createElement("div"), path: "Cash.md", regionSource: "  " });
  assert.equal(empty.failed, true);
  assert.deepEqual(await propertyCardCabinetRenderCatalog({}), { reused: false, failed: true });
});
