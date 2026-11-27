"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

class TextNode {
  constructor(text, ownerDocument) { this.nodeType = 3; this.nodeValue = String(text); this.ownerDocument = ownerDocument; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
}

class Element {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.isConnected = true;
    this.disabled = false;
    this.scrolled = false;
    this.classList = {
      add: (...values) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); values.forEach((value) => names.add(value)); this.className = [...names].join(" "); },
      remove: (...values) => { const names = new Set(values); this.className = this.className.split(/\s+/).filter((value) => value && !names.has(value)).join(" "); },
      contains: (value) => this.className.split(/\s+/).includes(value),
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.children.map((child) => child.textContent || "").join(""); }
  set textContent(value) { while (this.firstChild) this.removeChild(this.firstChild); this.appendChild(this.ownerDocument.createTextNode(value)); }
  appendChild(child) { child.parentNode?.removeChild?.(child); child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; }
  insertBefore(child, before) { child.parentNode?.removeChild?.(child); const index = this.children.indexOf(before); child.parentNode = this; this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; }
  remove() { this.parentNode?.removeChild?.(this); this.isConnected = false; }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
  getBoundingClientRect() { return { width: 120, height: 24 }; }
  scrollIntoView() { this.scrolled = true; }
  contains(node) { return node === this || this.children.some((child) => child === node || child.contains?.(node)); }
  matches(selector) {
    const parts = String(selector).trim().split(/\s+/);
    if (!fakeMatchesToken(this, parts[parts.length - 1])) return false;
    let node = this.parentNode;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      let found = false;
      while (node) {
        if (fakeMatchesToken(node, parts[index])) { found = true; node = node.parentNode; break; }
        node = node.parentNode;
      }
      if (!found) return false;
    }
    return true;
  }
  closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => { for (const child of node.children || []) { if (child.matches?.(selector)) result.push(child); visit(child); } };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function fakeMatchesToken(node, token) {
  if (!node || node.nodeType !== 1) return false;
  const tag = /^([a-z][a-z0-9-]*)/i.exec(token)?.[1];
  if (tag && String(node.tagName || "").toUpperCase() !== tag.toUpperCase()) return false;
  for (const name of token.match(/\.[\w-]+/g) || []) {
    if (typeof node.classList?.contains === "function") { if (!node.classList.contains(name.slice(1))) return false; }
    else if (!String(node.getAttribute?.("class") || "").split(/\s+/).includes(name.slice(1))) return false;
  }
  for (const match of token.matchAll(/\[([\w-]+)(?:=['"]([^'"]*)['"])?\]/g)) {
    let actual = null;
    try { actual = node.getAttribute?.(match[1]); } catch (_) { actual = null; }
    if (actual === null || actual === undefined) return false;
    if (match[2] !== undefined && String(actual) !== match[2]) return false;
  }
  return true;
}

class Document {
  constructor() { this.activeElement = null; this.roots = []; }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(text) { return new TextNode(text, this); }
}

const ALBUM_SOURCE = [
  "---",
  "type: album",
  "---",
  "",
  "# Eat",
  "",
  "## Records",
  "> [!records] 3 restaurants · 🍕 2 italian",
  ">",
  "> - **Italian** · 2",
  ">   - [[Pizza-A]]",
  ">   - [[Pizza-B]]",
  "> - **French** · 1",
  ">   - [[Bistro-C]]",
  "",
].join("\n");

const EMPTY_SOURCE = [
  "---",
  "type: album",
  "---",
  "",
  "# New",
  "",
  "## Records",
  "> [!records] No restaurants yet",
  ">",
  "> Add one with `Name @eat/`.",
  "",
].join("\n");

const SUBSCRIPTION_SOURCE = ALBUM_SOURCE.replace("type: album", "type: album").replace(/^# Eat$/m, "# subscriptions");

function fakeAlbum() {
  return {
    path: "eat.md",
    stem: "eat",
    noun: "restaurant",
    plural: "restaurants",
    group_field: "status",
    fields: [{ key: "status", label: "Status" }],
    groups: [
      { label: "Italian", value: "italian", count: 2 },
      { label: "French", value: "french", count: 1 },
    ],
  };
}

function fakePlugin(reportAlbum) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.albumReport = reportAlbum === undefined ? {
    albumsByPath: new Map([["eat.md", fakeAlbum()]]),
    albumsByStem: new Map([["eat", fakeAlbum()]]),
    catalogsByHostPath: new Map(),
  } : reportAlbum;
  plugin.albumRecordsFoldByView = new WeakMap();
  plugin.subscriptionSurfacesReport = null;
  plugin.refreshed = 0;
  plugin.scheduleAlbumHeaderRefresh = () => { plugin.refreshed += 1; };
  return plugin;
}

function resetCabinets() {
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetStateResetForTests();
}

function registerRecords(plugin) {
  const release = H.cabinetRecordsRegisterProvider(plugin);
  assert.equal(typeof release, "function");
  return release;
}

// A rendered records callout as MarkdownRenderer would emit it.
function makeCallout(doc, rows) {
  const callout = doc.createElement("div");
  callout.setAttribute("data-callout", "records");
  callout.setAttribute("class", "callout");
  const title = doc.createElement("div");
  title.setAttribute("class", "callout-title");
  title.textContent = "3 restaurants";
  callout.appendChild(title);
  const content = doc.createElement("div");
  content.setAttribute("class", "callout-content");
  callout.appendChild(content);
  const list = doc.createElement("ul");
  content.appendChild(list);
  for (const row of rows) {
    const li = doc.createElement("li");
    li.appendChild(doc.createTextNode(`${row.label} · ${row.count}`));
    const nested = doc.createElement("ul");
    for (const name of row.records) {
      const record = doc.createElement("li");
      const link = doc.createElement("a");
      link.setAttribute("class", "internal-link");
      link.setAttribute("data-href", name);
      link.textContent = name;
      record.appendChild(link);
      nested.appendChild(record);
    }
    li.appendChild(nested);
    list.appendChild(li);
  }
  return callout;
}

test("records applies only while its provider is registered", () => {
  resetCabinets();
  const context = { path: "eat.md", species: "album", source: ALBUM_SOURCE };
  assert.equal(H.propertyCardCabinetProviderApplies("records", context), null);
  const plugin = fakePlugin();
  registerRecords(plugin);
  assert.ok(H.propertyCardCabinetProviderApplies("records", context));
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  assert.equal(H.propertyCardCabinetProviderApplies("records", context), null);
  resetCabinets();
});

test("applies on album cards reads the stored tally plus grouping", () => {
  resetCabinets();
  const plugin = fakePlugin();
  registerRecords(plugin);
  const applied = H.propertyCardCabinetProviderApplies("records", { path: "eat.md", species: "album", source: ALBUM_SOURCE, frontmatter: {} });
  assert.ok(applied);
  assert.equal(applied.summary, "3 restaurants · 🍕 2 italian · by Status");
  assert.equal(applied.attention, undefined);
  resetCabinets();
});

test("applies covers the empty album, rejects other species, missing regions, and damage", () => {
  resetCabinets();
  const plugin = fakePlugin();
  registerRecords(plugin);
  const empty = H.propertyCardCabinetProviderApplies("records", { path: "new.md", species: "album", source: EMPTY_SOURCE, frontmatter: {} });
  assert.ok(empty);
  assert.equal(empty.summary, "No restaurants yet");
  assert.equal(H.propertyCardCabinetProviderApplies("records", { path: "cash.md", species: "area", source: ALBUM_SOURCE, frontmatter: {} }), null);
  assert.equal(H.propertyCardCabinetProviderApplies("records", { path: "eat.md", species: "album", source: "# Eat\n", frontmatter: {} }), null);
  const duplicate = H.propertyCardCabinetProviderApplies("records", {
    path: "eat.md",
    species: "album",
    source: `${ALBUM_SOURCE}\n## Records\n> [!records] 1 restaurant\n>\n> - [[Solo]]\n`,
    frontmatter: {},
  });
  assert.equal(duplicate, null);
  resetCabinets();
});

test("stale reports get an explicit Sync action and zero writes otherwise", () => {
  resetCabinets();
  const plugin = fakePlugin();
  plugin.albumReportStale = true;
  let writes = 0;
  plugin.apiAlbumSync = () => { writes += 1; };
  registerRecords(plugin);
  const applied = H.propertyCardCabinetProviderApplies("records", { path: "eat.md", species: "album", source: ALBUM_SOURCE, frontmatter: {} });
  assert.ok(applied);
  assert.deepEqual(applied.attention, { icon: "⚠", word: "stale", title: "Albums report is stale; sync to refresh" });
  assert.equal(applied.actions.length, 1);
  assert.equal(writes, 0);
  applied.actions[0].onClick();
  assert.equal(writes, 1);
  resetCabinets();
});

test("paint keys track the stored fingerprint and report revision", () => {
  resetCabinets();
  const plugin = fakePlugin();
  registerRecords(plugin);
  const context = { path: "eat.md", species: "album", source: ALBUM_SOURCE, frontmatter: {} };
  assert.ok(H.propertyCardCabinetProviderApplies("records", context));
  const first = H.propertyCardCabinetProviderFor("records").paintKey("eat.md");
  assert.ok(first.includes("fnv1a:"));
  assert.ok(H.propertyCardCabinetProviderApplies("records", context));
  assert.equal(H.propertyCardCabinetProviderFor("records").paintKey("eat.md"), first);
  const changed = context.source.replace("3 restaurants", "4 restaurants");
  assert.ok(H.propertyCardCabinetProviderApplies("records", { ...context, source: changed }));
  assert.notEqual(H.propertyCardCabinetProviderFor("records").paintKey("eat.md"), first);
  resetCabinets();
});

test("cabinet paint matches the inline painter: folds, groups, ages, teaching line", () => {
  resetCabinets();
  const plugin = fakePlugin();
  const folds = plugin.albumRecordsFoldMap({});
  const callout = makeCallout(new Document(), [
    { label: "Italian", count: 2, records: ["Pizza-A", "Pizza-B"] },
    { label: "French", count: 1, records: ["Bistro-C"] },
  ]);
  assert.equal(H.cabinetRecordsPaintCallout(plugin, callout, "eat.md", folds, callout), true);
  assert.equal(callout.getAttribute("data-bob-records-card"), "true");
  const groups = callout.querySelectorAll("[data-bob-records-group]");
  assert.deepEqual(groups.map((node) => node.getAttribute("data-bob-records-group")), ["italian", "french"]);
  assert.deepEqual(groups.map((node) => node.getAttribute("data-bob-records-folded")), [null, null]);
  assert.equal(callout.querySelectorAll(".bob-records-fold").length, 2);
  folds.set("eat.md\0italian", true);
  assert.equal(H.cabinetRecordsPaintCallout(plugin, callout, "eat.md", folds, callout), true);
  assert.deepEqual(
    callout.querySelectorAll("[data-bob-records-group]").map((node) => node.getAttribute("data-bob-records-folded")),
    ["true", null],
  );
  const rows = callout.querySelectorAll("a.internal-link");
  assert.equal(rows.length, 3);
  // An album the report does not know keeps its stored teaching line verbatim,
  // exactly like the inline painter (chrome would be a lie without a model).
  const teaching = makeCallout(new Document(), []);
  teaching.querySelector(".callout-content").appendChild(new Document().createTextNode("Add one with Name @eat/."));
  assert.equal(H.cabinetRecordsPaintCallout(plugin, teaching, "new.md", new Map(), teaching), false);
  assert.match(teaching.textContent, /Add one with/);
  assert.equal(teaching.querySelectorAll(".bob-records-fold").length, 0);
  resetCabinets();
});

test("subscriptions decoration runs in the cabinet body without writes", () => {
  resetCabinets();
  const subAlbum = {
    path: "subscriptions.md",
    stem: "subscriptions",
    noun: "subscription",
    plural: "subscriptions",
    group_field: "",
    fields: [],
    groups: [{ label: "Video", value: "video", count: 1 }],
  };
  const plugin = fakePlugin({
    albumsByPath: new Map([["subscriptions.md", subAlbum]]),
    albumsByStem: new Map([["subscriptions", subAlbum]]),
    catalogsByHostPath: new Map(),
  });
  plugin.subscriptionSurfacesReport = { subscriptions: [], teaching_empty: false };
  const folds = plugin.albumRecordsFoldMap({});
  const callout = makeCallout(new Document(), [
    { label: "Video", count: 1, records: ["Show-X"] },
  ]);
  assert.equal(H.cabinetRecordsPaintCallout(plugin, callout, "subscriptions.md", folds, callout), true);
  assert.deepEqual(
    callout.querySelectorAll("[data-bob-records-group]").map((node) => node.getAttribute("data-bob-records-group")),
    ["video"],
  );
  resetCabinets();
});

test("stand-down skips cabinet bodies and absorbed callouts only", () => {
  resetCabinets();
  const doc = new Document();
  const cabinet = doc.createElement("div");
  cabinet.setAttribute("class", "bob-property-card-cabinets");
  const inside = doc.createElement("div");
  inside.setAttribute("data-callout", "records");
  cabinet.appendChild(inside);
  assert.equal(H.albumRecordsCabinetStandDown(inside, null, "eat.md"), true);
  const absorbed = doc.createElement("div");
  absorbed.setAttribute("data-callout", "records");
  absorbed.setAttribute("class", "bob-cabinet-absorbed");
  assert.equal(H.albumRecordsCabinetStandDown(absorbed, null, "eat.md"), true);
  const plain = doc.createElement("div");
  plain.setAttribute("data-callout", "records");
  assert.equal(H.albumRecordsCabinetStandDown(plain, null, "eat.md"), false);
  assert.equal(H.albumRecordsCabinetStandDown(null, null, "eat.md"), false);
  resetCabinets();
});

test("assembled album cards mount Records open beside closed Schema with bottom-up numbers", async () => {
  resetCabinets();
  const plugin = fakePlugin();
  registerRecords(plugin);
  const path = "eat.md";
  const doc = new Document();
  const card = doc.createElement("section");
  card.setAttribute("class", "bob-property-card");
  card.setAttribute("data-card-kind", "album");
  const fold = H.propertyCardBuildFoldRow(doc, {
    kind: "album", path, noun: "Schema", summary: "6 fields", open: false, keyLive: true,
  });
  card.appendChild(fold.element);
  const body = doc.createElement("div");
  body.setAttribute("id", fold.bodyId);
  body.setAttribute("hidden", "");
  body.textContent = "Schema fields";
  card.appendChild(body);
  const foot = H.propertyCardFootBuildEl(doc, {
    path,
    disclosureId: "records-foot",
    open: false,
    keyLive: true,
    inventory: { count: 9 },
    handlers: { onToggle: (_nextPath, next) => next },
  });
  card.appendChild(foot.element);
  const view = { file: { path }, dom: card };
  const stack = H.propertyCardCabinetsAssemble(card, path, foot.element, {
    plugin, view, component: plugin, keyLive: true, source: ALBUM_SOURCE, frontmatter: {},
    repaint: () => true,
  });
  assert.ok(stack);
  await Promise.resolve();
  const panels = stack.querySelectorAll("[data-cabinet-kind]");
  assert.deepEqual(
    panels.map((panel) => panel.getAttribute("data-cabinet-kind")),
    ["records", "schema", "properties"],
  );
  const rows = H.propertyCardCabinetsInView(view);
  assert.deepEqual(rows.extras.map(({ kind, number }) => [kind, number]), [["records", 2], ["schema", 1]]);
  assert.equal(rows.extras[0].open, true);
  assert.equal(rows.extras[1].open, false);
  assert.equal(rows.properties.open, false);
  const summary = panels[0].querySelector(".bob-cabinet-summary");
  assert.ok(summary);
  assert.equal(summary.textContent, "3 restaurants · 🍕 2 italian · by Status");
  assert.deepEqual(
    H.propertyCardCabinetNumbering(["records", "schema"]),
    [{ kind: "records", number: 2 }, { kind: "schema", number: 1 }],
  );
  resetCabinets();
});

test("group jump opens Records, expands the group, and scrolls", async () => {
  resetCabinets();
  const plugin = fakePlugin();
  registerRecords(plugin);
  const doc = new Document();
  const container = doc.createElement("div");
  container.setAttribute("class", "markdown-preview-view");
  const sizer = doc.createElement("div");
  container.appendChild(sizer);
  const stack = doc.createElement("div");
  stack.setAttribute("class", "bob-property-card-cabinets");
  sizer.appendChild(stack);
  const panel = doc.createElement("section");
  panel.setAttribute("data-cabinet-kind", "records");
  panel.setAttribute("data-cabinet-source", "eat.md");
  stack.appendChild(panel);
  const list = doc.createElement("ul");
  panel.appendChild(list);
  const group = doc.createElement("li");
  group.setAttribute("data-bob-records-group", "italian");
  group.appendChild(doc.createTextNode("Italian · 2"));
  list.appendChild(group);
  const view = { file: { path: "eat.md" }, containerEl: container, dom: container, editor: null };
  const handled = await H.cabinetRecordsRevealGroup(plugin, view, "eat.md", { value: "italian", label: "Italian" });
  assert.equal(handled, true);
  assert.equal(H.propertyCardCabinetIsOpen("eat.md", "records"), true);
  assert.ok(plugin.albumRecordsPendingExpand);
  assert.equal(plugin.albumRecordsPendingExpand.identity, "italian");
  assert.equal(group.scrolled, true);
  assert.ok(plugin.refreshed >= 1);
  resetCabinets();
});

test("group jump stays on today's line jump with no target, path, or view", async () => {
  resetCabinets();
  const plugin = fakePlugin();
  registerRecords(plugin);
  assert.equal(await H.cabinetRecordsRevealGroup(plugin, {}, "eat.md", {}), false);
  assert.equal(await H.cabinetRecordsRevealGroup(plugin, {}, "", { value: "italian" }), false);
  assert.equal(await H.cabinetRecordsRevealGroup(plugin, null, "eat.md", { value: "italian" }), false);
  resetCabinets();
});
