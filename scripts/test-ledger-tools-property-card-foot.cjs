const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = {
  none: [],
  widget: (options) => ({ ...options, startSide: options.side }),
  replace: (options) => ({ ...options, startSide: 0, replace: true, spec: options, range(from, to) { return { from, to, value: this }; } }),
  set: (ranges) => ranges,
};
const EditorView = {
  decorations: { from: (field, get) => ({ facet: "decorations", field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ facet: "editorAttributes", field, get }) },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
    parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
    EditorView,
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

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
    this.disabled = false;
    this.scrollCalls = [];
    const self = this;
    this.classList = {
      add(name) { const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { const xs = (self.getAttribute("class") || "").split(/\s+/).filter((x) => x && x !== name); self.setAttribute("class", xs.join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = [new FakeNode("", this.ownerDocument, this._text)]; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { let item = this; while (item) { if (item.root) return true; item = item.parentNode; } return false; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild?.(this); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  scrollIntoView(options) { this.scrollCalls.push(options || {}); }
  dispatchEvent(event) {
    const payload = event || {};
    if (!payload.target) payload.target = this;
    if (typeof payload.preventDefault !== "function") payload.preventDefault = () => {};
    for (const callback of this.listeners?.get?.(payload.type) || []) callback(payload);
    return true;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: "click" }); }
  keydown(key, extra = {}) { this.dispatchEvent({ type: "keydown", key, ...extra }); }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      const tag = /^[a-z][\w-]*$/i.exec(value);
      const tagClass = /^([a-z][\w-]*)\.([\w-]+)$/i.exec(value);
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(value);
      const taggedAttr = /^([a-z][\w-]*)\[([\w-]+)(?:="([^"]*)")?\]$/i.exec(value);
      const hasAttr = (name, expected) => this.attrs.has(name) && (expected === undefined || this.getAttribute(name) === expected);
      return Boolean((tagClass && this.tagName === tagClass[1].toUpperCase() && this.classList.contains(tagClass[2])) || (cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase()) ||
        (attr && hasAttr(attr[1], attr[2])) ||
        (taggedAttr && this.tagName === taggedAttr[1].toUpperCase() && hasAttr(taggedAttr[2], taggedAttr[3])));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  const doc = {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
  doc.body = doc.createElement("body");
  doc.body.root = true;
  return doc;
}

function footSpec(doc, overrides = {}) {
  const source = overrides.source !== undefined ? overrides.source : [
    "---", "type: [[record]]", "parent: [[eat]]", "title: Smashburger",
    "status: to_try", "notes: hello", "extra: null", "---", "body",
  ].join("\n");
  const frontmatter = overrides.frontmatter !== undefined ? overrides.frontmatter : {
    type: "[[record]]", parent: "[[eat]]", title: "Smashburger",
    status: "to_try", notes: "hello", extra: null,
  };
  const where = overrides.where !== undefined ? overrides.where : {
    parent: "kicker", type: "tile", title: "title", status: "field", notes: "field", created: "foot",
  };
  const inventory = helpers.propertyCardInventory({
    path: "eat/smashburger.md",
    sourcePath: "eat/smashburger.md",
    cachePath: "eat/smashburger.md",
    sourceText: source,
    frontmatter,
    parseYaml: overrides.parseYaml !== undefined ? overrides.parseYaml : (() => ({})),
    where,
    nested: overrides.nested || {},
    legacy: overrides.legacy || {},
  });
  const createdRow = (inventory.rows || []).find((row) => row.key === "created");
  const stamp = helpers.propertyCardFormatCreatedStamp({
    kind: "record",
    value: frontmatter.created,
    present: Object.prototype.hasOwnProperty.call(frontmatter, "created"),
    sourceScalar: createdRow ? createdRow.sourceScalar : "",
  });
  return {
    path: "eat/smashburger.md",
    disclosureId: overrides.disclosureId !== undefined ? overrides.disclosureId : "bob-property-foot-1",
    open: overrides.open === true,
    inventory,
    stamp,
    handlers: overrides.handlers || {},
  };
}

function buildFoot(doc, overrides = {}) {
  const spec = footSpec(doc, overrides);
  const built = helpers.propertyCardFootBuildEl(doc, spec);
  assert.ok(built && built.element, "foot builds");
  return { spec, built };
}

test("foot open state is per path and starts closed", () => {
  helpers.propertyCardFootResetAll();
  assert.equal(helpers.propertyCardFootIsOpen("eat/a.md"), false);
  assert.equal(helpers.propertyCardFootSetOpen("eat/a.md", true), true);
  assert.equal(helpers.propertyCardFootIsOpen("eat/a.md"), true);
  assert.equal(helpers.propertyCardFootIsOpen("eat/b.md"), false, "a different note starts closed");
  assert.equal(helpers.propertyCardFootToggle("eat/a.md"), false);
  assert.equal(helpers.propertyCardFootToggle("eat/b.md"), true);
  helpers.propertyCardFootResetAll();
  assert.equal(helpers.propertyCardFootIsOpen("eat/a.md"), false, "reset clears session state");
});

test("rename carries open state and delete releases it", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  doc.body.appendChild(doc.createElement("div"));
  const host = doc.body.firstChild;
  const foot = doc.createElement("div");
  host.appendChild(foot);
  helpers.propertyCardFootSetOpen("eat/old.md", true);
  const mount = helpers.propertyCardFootRegisterMount(foot, "eat/old.md");
  assert.ok(mount && mount.id, "mount registers");
  assert.equal(helpers.propertyCardFootRenamePath("eat/old.md", "eat/new.md"), true);
  assert.equal(helpers.propertyCardFootIsOpen("eat/new.md"), true);
  assert.equal(helpers.propertyCardFootIsOpen("eat/old.md"), false, "rename drops old-path state");
  assert.deepEqual(helpers.propertyCardFootMountsFor("eat/new.md").map((entry) => entry.id), [mount.id]);
  assert.equal(helpers.propertyCardFootReleasePath("eat/new.md"), true);
  assert.equal(helpers.propertyCardFootIsOpen("eat/new.md"), false);
  assert.deepEqual(helpers.propertyCardFootMountsFor("eat/new.md"), []);
  helpers.propertyCardFootResetAll();
});

test("disclosure IDs stay unique across panes on one note", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const first = doc.createElement("div");
  const second = doc.createElement("div");
  const one = helpers.propertyCardFootRegisterMount(first, "eat/a.md");
  const two = helpers.propertyCardFootRegisterMount(second, "eat/a.md");
  assert.ok(one && two && one.id !== two.id);
  assert.ok(one.disclosureId && two.disclosureId && one.disclosureId !== two.disclosureId);
  assert.equal(helpers.propertyCardFootRegisterMount(first, "eat/a.md").id, one.id, "re-register keeps the mount");
  assert.equal(helpers.propertyCardFootUnregisterMount(one.id), true);
  assert.equal(helpers.propertyCardFootUnregisterMount(one.id), false);
  assert.equal(helpers.propertyCardFootUnregisterNode(second), true);
  helpers.propertyCardFootResetAll();
});

test("releaseScope drops detached mounts and keeps foreign paths", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const scope = doc.createElement("div");
  doc.body.appendChild(scope);
  const live = doc.createElement("div");
  scope.appendChild(live);
  const other = doc.createElement("div");
  scope.appendChild(other);
  const detached = doc.createElement("div");
  helpers.propertyCardFootRegisterMount(live, "eat/a.md");
  helpers.propertyCardFootRegisterMount(other, "eat/other.md");
  helpers.propertyCardFootRegisterMount(detached, "eat/a.md");
  assert.equal(helpers.propertyCardFootLiveMountsFor("eat/a.md").length, 1, "only the connected mount is live");
  const released = helpers.propertyCardFootReleaseScope(scope, "eat/a.md");
  assert.equal(released, 2, "connected mount plus the detached predecessor release");
  assert.equal(helpers.propertyCardFootMountsFor("eat/a.md").length, 0);
  assert.equal(helpers.propertyCardFootMountsFor("eat/other.md").length, 1, "foreign paths keep their mounts");
  helpers.propertyCardFootResetAll();
});

test("toggleProperties acts only on live path-matching mounts", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const view = { file: { path: "eat/a.md" } };
  assert.equal(helpers.propertyCardToggleProperties(view), false, "no mount does not act");
  assert.equal(helpers.propertyCardToggleProperties(null), false);
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const foot = doc.createElement("div");
  host.appendChild(foot);
  helpers.propertyCardFootRegisterMount(foot, "eat/a.md");
  assert.equal(helpers.propertyCardToggleProperties(view), true);
  assert.equal(helpers.propertyCardFootIsOpen("eat/a.md"), true, "two panes share per-path state");
  foot.remove();
  assert.equal(helpers.propertyCardToggleProperties(view), false, "a detached mount never acts");
  // A resolver supplies Live Preview paths that views do not carry directly.
  const live = doc.createElement("div");
  doc.body.appendChild(live);
  helpers.propertyCardFootRegisterMount(live, "eat/b.md");
  const release = helpers.propertyCardFootRegisterPathResolver((candidate) => candidate?.livePath || "");
  assert.equal(helpers.propertyCardToggleProperties({ livePath: "eat/b.md" }), true);
  assert.equal(helpers.propertyCardFootIsOpen("eat/b.md"), true);
  release();
  helpers.propertyCardFootResetAll();
});

test("toggle listeners notify adapters and the editor hook starts unset", () => {
  helpers.propertyCardFootResetAll();
  const seen = [];
  const release = helpers.propertyCardFootOnToggle((path, open) => seen.push([path, open]));
  helpers.propertyCardFootSetOpen("eat/a.md", true);
  helpers.propertyCardFootToggle("eat/a.md");
  assert.deepEqual(seen, [["eat/a.md", true], ["eat/a.md", false]]);
  release();
  assert.equal(helpers.propertyCardFootOpenEditor("eat/a.md", "status"), false, "unset hook never opens");
  let editorSeen = null;
  helpers.propertyCardFootSetEditorHook((path, options) => { editorSeen = [path, options]; });
  assert.equal(helpers.propertyCardFootOpenEditor("eat/a.md", "status", { mode: "edit" }), true);
  assert.deepEqual(editorSeen, ["eat/a.md", { key: "status", mode: { mode: "edit" } }]);
  helpers.propertyCardFootResetAll();
  assert.equal(helpers.propertyCardFootOpenEditor("eat/a.md", "status"), false, "reset clears the hook");
});

test("closed foot shows disclosure, count, and stamp without building rows", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const { built } = buildFoot(doc, { open: false });
  const { element, disclosure, drawer } = built;
  assert.equal(element.getAttribute("data-property-foot"), "true");
  assert.equal(disclosure.tagName, "BUTTON");
  assert.equal(disclosure.getAttribute("aria-expanded"), "false");
  assert.equal(disclosure.getAttribute("title"), "Toggle properties =-");
  const drawerId = disclosure.getAttribute("aria-controls");
  assert.ok(drawerId, "disclosure controls the drawer");
  assert.equal(drawer.getAttribute("id"), drawerId, "unique aria-controls target");
  assert.match(disclosure.textContent, /Properties · 6/);
  assert.equal(drawer.querySelectorAll(".bob-property-card-foot-list").length, 0, "closed drawer builds no rows");
  assert.match(element.querySelector(".bob-property-card-foot-stamp").textContent, /no created date/);
  assert.equal(element.querySelector(".bob-property-card-foot-lint-chip"), null, "clean foot has no lint chip");
  helpers.propertyCardFootResetAll();
});

test("open foot groups loose, card, and managed rows with where marks", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const source = ["---", "loose_key: 1", "parent: x", "status: ok", "zorg_note: 2", "---", ""].join("\n");
  const frontmatter = { loose_key: 1, parent: "x", status: "ok", zorg_note: 2 };
  const { built } = buildFoot(doc, {
    open: true, source, frontmatter,
    where: { parent: "kicker", status: "field", created: "foot" },
  });
  const { drawer } = built;
  assert.match(drawer.querySelector(".bob-property-card-foot-group").textContent, /On this card/);
  const marks = drawer.querySelectorAll(".bob-property-card-foot-mark").map((node) => node.textContent);
  assert.ok(marks.includes("kicker") && marks.includes("field"), `where marks render: ${marks.join(",")}`);
  const managed = drawer.querySelector(".bob-property-card-foot-managed");
  assert.ok(managed, "managed group folds");
  assert.equal(managed.querySelector(".bob-property-card-foot-managed-toggle").getAttribute("aria-expanded"), "false");
  assert.ok(managed.querySelector(".bob-property-card-foot-managed-body").hasAttribute("hidden"), "managed starts folded");
  assert.equal(managed.querySelectorAll(".bob-property-card-foot-row").length, 1, "managed rows render inside the folded body");
  helpers.propertyCardFootResetAll();
});

test("lint chip names problems and never opens the drawer", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  let toggled = 0;
  const source = ["---", "status: ok", "status: twice", "---", ""].join("\n");
  const { built } = buildFoot(doc, {
    open: false,
    source,
    frontmatter: { status: "twice", created: "soon" },
    handlers: { onToggle: () => { toggled += 1; return true; } },
  });
  const { element, disclosure } = built;
  const chip = element.querySelector(".bob-property-card-foot-lint-chip");
  assert.ok(chip, "problems raise a lint chip");
  assert.match(chip.getAttribute("title"), /invalid created/);
  assert.match(chip.getAttribute("title"), /duplicate key: status/);
  assert.equal(chip.tagName, "SPAN", "the chip is not a control");
  chip.click();
  assert.equal(toggled, 0, "the chip never opens the drawer");
  assert.equal(disclosure.getAttribute("aria-expanded"), "false");
  helpers.propertyCardFootResetAll();
});

test("value shapes render distinctly", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const calls = {};
  const source = [
    "---", "link: x", "url: x", "tags: x", "list: x", "yes: x", "no: x",
    "nothing: x", "blank: x", "blank_list: x", "nested: x", "long: x", "---", "",
  ].join("\n");
  const frontmatter = {
    link: "[[eat/smashburger|Smash]]",
    url: "https://example.test/beads",
    tags: ["phase", "#drawer"],
    list: ["a", "b", "c", "d", "e", "f", "g"],
    yes: true,
    no: false,
    nothing: null,
    blank: "",
    blank_list: [],
    nested: { inner: 1, other: 2 },
    long: "a very long scalar value that should clamp to two lines in the drawer",
  };
  const { built } = buildFoot(doc, {
    open: true, source, frontmatter,
    where: {},
    nested: { nested: "record" },
    handlers: {
      openPath: (target, event) => { calls.openPath = [target, Boolean(event)]; },
      hoverLink: (event, node, linktext) => { calls.hoverLink = linktext; },
      searchTag: (tag) => { calls.searchTag = tag; },
      openNested: (key) => { calls.openNested = key; },
    },
  });
  const rows = Object.fromEntries(
    built.drawer.querySelectorAll(".bob-property-card-foot-row").map((row) => [row.getAttribute("data-property-key"), row]),
  );
  const link = rows.link.querySelector("a");
  assert.equal(link.getAttribute("data-href"), "eat/smashburger");
  assert.equal(link.textContent, "Smash");
  link.dispatchEvent({ type: "mouseover" });
  assert.equal(calls.hoverLink, "[[eat/smashburger|Smash]]");
  link.click();
  assert.deepEqual(calls.openPath[0], "[[eat/smashburger|Smash]]", "value links navigate");
  const url = rows.url.querySelector("a");
  assert.equal(url.getAttribute("target"), "_blank");
  assert.equal(url.getAttribute("href"), "https://example.test/beads");
  const tag = rows.tags.querySelector(".bob-property-card-foot-tag");
  assert.ok(tag, "tag values render searchable chips");
  tag.click();
  assert.equal(calls.searchTag, "phase");
  const valueText = (row) => row.querySelector(".bob-property-card-foot-value").textContent;
  assert.match(valueText(rows.list), /\+1/, "lists preview six chips then +N");
  assert.equal(valueText(rows.yes), "✓");
  assert.equal(valueText(rows.no), "✗");
  assert.equal(valueText(rows.nothing), "—");
  assert.match(valueText(rows.blank), /empty/);
  assert.match(valueText(rows.blank_list), /empty list/);
  const opener = rows.nested.querySelector(".bob-property-card-foot-nested");
  assert.ok(opener, "nested maps get a species opener, never a YAML dump");
  assert.match(opener.textContent, /2 fields/);
  opener.click();
  assert.equal(calls.openNested, "nested");
  const scalar = rows.long.querySelector(".bob-property-card-foot-scalar");
  assert.equal(scalar.getAttribute("title"), frontmatter.long, "long scalars keep the full tooltip");
  helpers.propertyCardFootResetAll();
});

test("duplicate keys render one row per occurrence with exact lines", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const jumps = [];
  const source = ["---", "status: to_try", "notes: one", "status: loved", "---", ""].join("\n");
  const { built } = buildFoot(doc, {
    open: true, source,
    frontmatter: { status: "loved", notes: "one" },
    where: { status: "field", notes: "field" },
    handlers: { jumpYaml: (key, line) => jumps.push([key, line]) },
  });
  const dupes = built.drawer.querySelectorAll(".bob-property-card-foot-row").filter(
    (row) => row.getAttribute("data-property-key") === "status",
  );
  assert.equal(dupes.length, 2);
  assert.deepEqual(dupes.map((row) => row.getAttribute("data-line")), ["2", "4"]);
  assert.deepEqual(dupes.map((row) => row.getAttribute("data-occurrence")), ["1", "2"]);
  for (const row of dupes) assert.ok(row.querySelector(".bob-property-card-foot-lint"), "duplicates carry lint");
  dupes[1].keydown("y");
  assert.deepEqual(jumps, [["status", 4]], "y jumps to the exact occurrence line");
  helpers.propertyCardFootResetAll();
});

test("unparseable and unclosed frontmatter show the recovery line", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const recovered = [];
  const badYaml = () => { throw new Error("Invalid YAML"); };
  for (const source of ["---\nbad: [\n---\n", "---\nstatus: ok\n"]) {
    const { built } = buildFoot(doc, {
      open: true, source,
      frontmatter: { status: "ok" },
      parseYaml: badYaml,
      handlers: { jumpRecovery: () => recovered.push(source) },
    });
    const recovery = built.drawer.querySelector(".bob-property-card-foot-recovery");
    assert.ok(recovery, `recovery line renders for ${JSON.stringify(source)}`);
    assert.equal(built.drawer.querySelectorAll(".bob-property-card-foot-row").length, 0, "no rows behind the failure");
    recovery.click();
    recovery.keydown("y");
  }
  assert.equal(recovered.length, 4, "click and y both recover");
  helpers.propertyCardFootResetAll();
});

test("disclosure click toggles and scrolls only on expand", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  let open = false;
  const first = helpers.propertyCardFootBuildEl(doc, {
    ...footSpec(doc, {}),
    open,
    handlers: { onToggle: (path, next) => { open = next; return next; } },
  });
  assert.ok(first);
  first.disclosure.click();
  assert.equal(open, true);
  assert.equal(first.element.scrollCalls.length, 1, "expand scrolls the foot into view");
  assert.deepEqual(Object.keys(first.element.scrollCalls[0]), ["block", "behavior"]);
  const second = helpers.propertyCardFootBuildEl(doc, {
    ...footSpec(doc, {}),
    open: true,
    handlers: { onToggle: (path, next) => { open = next; return next; } },
  });
  second.disclosure.click();
  assert.equal(open, false);
  assert.equal(second.element.scrollCalls.length, 0, "collapse never scrolls");
  helpers.propertyCardFootResetAll();
});

test("key labels invoke the editor only when registered", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const plain = buildFoot(doc, { open: true }).built;
  assert.equal(
    plain.drawer.querySelector(".bob-property-card-foot-key").querySelector("button"),
    null,
    "unset hook leaves keys as text",
  );
  let edited = null;
  const linkedSource = [
    "---", "type: [[record]]", "notes: See [[eat/x]]", "---", "",
  ].join("\n");
  const wired = buildFoot(doc, {
    open: true,
    source: linkedSource,
    frontmatter: { type: "[[record]]", notes: "See [[eat/x]]" },
    handlers: { onOpenEditor: (key) => { edited = key; } },
  }).built;
  const keyCell = wired.drawer.querySelector(".bob-property-card-foot-key");
  const button = keyCell.querySelector("button");
  assert.ok(button, "registered hook makes keys editable");
  button.click();
  assert.equal(edited, "type");
  edited = null;
  button.keydown("Enter");
  assert.equal(edited, "type");
  edited = null;
  const valueLink = wired.drawer.querySelector(".bob-property-card-foot-value a");
  if (valueLink) {
    valueLink.click();
    assert.equal(edited, null, "value links navigate, never edit");
  }
  helpers.propertyCardFootResetAll();
});

test("managed sub-fold toggles locally without a repaint", () => {
  helpers.propertyCardFootResetAll();
  const doc = makeDoc();
  const { built } = buildFoot(doc, {
    open: true,
    source: ["---", "status: ok", "zorg_note: 1", "---", ""].join("\n"),
    frontmatter: { status: "ok", zorg_note: 1 },
    where: { status: "field" },
  });
  const toggle = built.drawer.querySelector(".bob-property-card-foot-managed-toggle");
  const body = built.drawer.querySelector(".bob-property-card-foot-managed-body");
  assert.ok(toggle && body);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(body.hasAttribute("hidden"), false);
  assert.equal(body.querySelectorAll(".bob-property-card-foot-row").length, 1);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  helpers.propertyCardFootResetAll();
});
