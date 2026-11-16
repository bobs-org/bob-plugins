const test = require("node:test");
const assert = require("node:assert/strict");
const { ElementStub } = require("./modal-harness.cjs");
const { NavigationHotkeysPlugin, helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  buildWindowPrefixTabCatalog,
  buildWindowPrefixViewModel,
  windowTabNumeralsVerdict,
  WINDOW_TAB_NUMBERS_BODY_CLASS,
  WINDOW_TAB_NUMBERS_LIT_CLASS,
  WINDOW_TAB_NUMBERS_FLASH_CLASS,
  WINDOW_TAB_NUMBERS_FLASH_MS,
} = helpers;

function makeDoc(options = {}) {
  const body = new ElementStub({ tag: "body" });
  const doc = {
    body,
    documentElement: { clientHeight: options.viewportHeight ?? 0 },
    createElement(tag) {
      const el = new ElementStub({ tag });
      el.ownerDocument = doc;
      return el;
    },
    defaultView: {
      innerHeight: options.viewportHeight ?? 0,
      matchMedia: () => ({ matches: false }),
      navigator: { platform: "Linux x86_64" },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  body.ownerDocument = doc;
  return doc;
}

function makeHeader(label, opts = {}) {
  const headerEl = new ElementStub({ cls: `workspace-tab-header${opts.active ? " is-active" : ""}` });
  const inner = headerEl.createDiv({ cls: "workspace-tab-header-inner" });
  inner.createDiv({ cls: "workspace-tab-header-inner-icon", text: opts.icon === false ? "" : "icon" });
  inner.createDiv({ cls: "workspace-tab-header-inner-title", text: label });
  if (opts.pinned) headerEl.createDiv({ cls: "workspace-tab-header-pinned" });
  if (opts.close !== false) headerEl.createDiv({ cls: "workspace-tab-header-close" });
  return { headerEl, inner };
}

function leafEntry(id, label, doc, opts = {}) {
  const { headerEl } = makeHeader(label, opts);
  doc.body.createDiv({});
  return { id, headerEl };
}

function makeArea(doc, splitsDef, activeLeafId) {
  const splits = [];
  const leafById = new Map();
  const splitById = new Map();
  for (const def of splitsDef) {
    const group = { id: def.id };
    splitById.set(def.id, group);
    const leaves = [];
    for (const leafDef of def.leaves) {
      const entry = leafDef.headerEl ? leafDef : leafEntry(leafDef.id, leafDef.label || leafDef.id, doc, leafDef);
      const headerEl = entry.headerEl;
      const fakeLeaf = { id: leafDef.id, tabHeaderEl: headerEl, pinned: leafDef.pinned === true };
      leafById.set(leafDef.id, fakeLeaf);
      leaves.push({ id: leafDef.id, label: leafDef.label || leafDef.id, pinned: leafDef.pinned === true });
      // Keep header reachable for assertions.
      leafDef._headerEl = headerEl;
      leafDef._inner = headerEl.children.find((child) => (child.classes || []).includes("workspace-tab-header-inner"));
    }
    splits.push({
      id: def.id,
      rect: def.rect || { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
      leaves,
      selectedLeafId: def.selectedLeafId || def.leaves[0].id,
    });
  }
  return { splits, activeLeafId, leafById, splitById };
}

function twoSplitArea(doc) {
  const a = { id: "a", label: "A" };
  const b = { id: "b", label: "B" };
  const c = { id: "c", label: "C" };
  const d = { id: "d", label: "D" };
  const area = makeArea(doc, [
    { id: "left", leaves: [a, b], selectedLeafId: "b" },
    { id: "right", leaves: [c, d], selectedLeafId: "c" },
  ], "b");
  return { area, refs: { a, b, c, d } };
}

function pluginFor(doc, area, hotkeys = null) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const workspace = {
    containerEl: { ownerDocument: doc },
    rootSplit: {},
    on() { return {}; },
    off() {},
  };
  plugin.app = {
    workspace,
    hotkeyManager: hotkeys || { customKeys: {}, defaultKeys: {} },
    commands: { commands: {} },
  };
  plugin.windowPrefixDocument = doc;
  plugin.windowPrefixWindow = { addEventListener() {}, removeEventListener() {} };
  plugin.snapshotWindowPrefixMainArea = () => area;
  plugin.windowTabNumbersRequestFrame = (callback) => callback();
  plugin.windowTabNumbersSetTimeout = (callback) => {
    callback();
    return 1;
  };
  plugin.windowTabNumbersClearTimeout = () => {};
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  return plugin;
}

function innerFor(ref) {
  return ref._inner;
}

function headerFor(ref) {
  return ref._headerEl;
}

test("stamper stamps match the catalog in reading order", () => {
  const doc = makeDoc();
  const { area, refs } = twoSplitArea(doc);
  const plugin = pluginFor(doc, area);
  const result = plugin.refreshWindowTabNumbersNow();
  assert.equal(result.ok, true);
  assert.equal(result.shown, true);
  assert.equal(result.total, 4);
  assert.equal(innerFor(refs.a).attributes["data-bob-tab"], "1");
  assert.equal(innerFor(refs.b).attributes["data-bob-tab"], "2");
  assert.equal(innerFor(refs.c).attributes["data-bob-tab"], "3");
  assert.equal(innerFor(refs.d).attributes["data-bob-tab"], "4");
  assert.ok(doc.body.classes.includes(WINDOW_TAB_NUMBERS_BODY_CLASS));
  assert.equal(headerFor(refs.a).attributes["aria-description"], "Control W then N");
  plugin.stopWindowTabNumbers();
});

test("tabs past nine carry no numeral and moved tabs are cleared", () => {
  const doc = makeDoc();
  const leaves = Array.from({ length: 13 }, (_, index) => ({ id: `t${index + 1}`, label: `Tab ${index + 1}` }));
  const area = makeArea(doc, [
    { id: "left", leaves: leaves.slice(0, 6), selectedLeafId: "t1" },
    { id: "right", leaves: leaves.slice(6), selectedLeafId: "t7" },
  ], "t1");
  const plugin = pluginFor(doc, area);
  plugin.refreshWindowTabNumbersNow();
  for (let index = 0; index < 9; index += 1) {
    assert.equal(leaves[index]._inner.attributes["data-bob-tab"], String(index + 1));
  }
  for (let index = 9; index < 13; index += 1) {
    assert.equal(leaves[index]._inner.attributes["data-bob-tab"], undefined);
  }
  // Simulate a tab moved to a sidebar: drop it from the next catalog.
  const smaller = makeArea(doc, [
    { id: "left", leaves: leaves.slice(0, 5).map((leaf) => ({ id: leaf.id, label: leaf.label })), selectedLeafId: "t1" },
  ], "t1");
  // Reuse the same header elements for the remaining tabs so clearing is observable.
  for (let index = 0; index < 5; index += 1) {
    const kept = smaller.leafById.get(leaves[index].id);
    kept.tabHeaderEl = leaves[index]._headerEl;
  }
  plugin.snapshotWindowPrefixMainArea = () => smaller;
  plugin.refreshWindowTabNumbersNow();
  assert.equal(leaves[5]._inner.attributes["data-bob-tab"], undefined);
  plugin.stopWindowTabNumbers();
});

test("only changed attributes are written", () => {
  const doc = makeDoc();
  const { area } = twoSplitArea(doc);
  const plugin = pluginFor(doc, area);
  plugin.refreshWindowTabNumbersNow();
  let writes = 0;
  for (const leaf of area.leafById.values()) {
    const inner = leaf.tabHeaderEl.children.find((child) => (child.classes || []).includes("workspace-tab-header-inner"));
    const original = inner.setAttribute.bind(inner);
    inner.setAttribute = (name, value) => {
      writes += 1;
      return original(name, value);
    };
  }
  plugin.refreshWindowTabNumbersNow();
  assert.equal(writes, 0);
  plugin.stopWindowTabNumbers();
});

test("gates hide numerals: phone, one tab, owned Ctrl+W, unknown hotkeys", () => {
  const doc = makeDoc();
  const { area } = twoSplitArea(doc);
  // Phone gate.
  const phone = pluginFor(doc, area);
  phone.app.isMobile = true;
  assert.equal(phone.refreshWindowTabNumbersNow().shown, false);
  phone.stopWindowTabNumbers();
  delete phone.app.isMobile;

  // Single tab gate.
  const singleLeaf = { id: "only", label: "Only" };
  const single = makeArea(doc, [{ id: "only", leaves: [singleLeaf], selectedLeafId: "only" }], "only");
  const singlePlugin = pluginFor(makeDoc(), single);
  // Rebind headers into the new doc's area (headers live on stubs, doc is interchangeable).
  singlePlugin.snapshotWindowPrefixMainArea = () => single;
  singlePlugin.app = { workspace: { containerEl: { ownerDocument: doc } }, hotkeyManager: { customKeys: {}, defaultKeys: {} }, commands: { commands: {} } };
  singlePlugin.windowPrefixDocument = doc;
  assert.equal(singlePlugin.refreshWindowTabNumbersNow().reason, "one-tab");
  singlePlugin.stopWindowTabNumbers();

  // Ctrl+W owned gate (Linux Mod+W).
  const owned = pluginFor(doc, area);
  owned.app.commands = { commands: { "workspace:close": { hotkeys: [{ modifiers: ["Mod"], key: "W" }] } } };
  assert.equal(owned.refreshWindowTabNumbersNow().shown, false);
  // Lit implies shown: the same owned binding shows lit caps with the card.
  owned.windowTabNumbersLit = true;
  assert.equal(owned.refreshWindowTabNumbersNow().shown, true);
  owned.stopWindowTabNumbers();

  // Unknown hotkeys on Linux hide; on macOS they show. The bundled Platform
  // stub has no isMacOS in tests, so the mac case uses the test-only
  // windowTabNumbersForceMac override.
  const unknownLinux = pluginFor(doc, area);
  unknownLinux.app.hotkeyManager = {};
  unknownLinux.app.commands = {};
  unknownLinux.windowTabNumbersForceMac = false;
  assert.equal(unknownLinux.refreshWindowTabNumbersNow().shown, false);
  unknownLinux.stopWindowTabNumbers();
  const unknownMac = pluginFor(doc, area);
  unknownMac.app.hotkeyManager = {};
  unknownMac.app.commands = {};
  unknownMac.windowTabNumbersForceMac = true;
  assert.equal(unknownMac.refreshWindowTabNumbersNow().shown, true);
  unknownMac.stopWindowTabNumbers();
});

test("flash survives a refresh and clears after 220ms", async () => {
  const doc = makeDoc();
  const { area, refs } = twoSplitArea(doc);
  const plugin = pluginFor(doc, area);
  let flashCallback = null;
  plugin.windowTabNumbersSetTimeout = (callback, delay) => {
    if (delay === WINDOW_TAB_NUMBERS_FLASH_MS) {
      flashCallback = callback;
      return 7;
    }
    callback();
    return 8;
  };
  plugin.windowTabNumbersClearTimeout = () => {};
  plugin.refreshWindowTabNumbersNow();
  assert.equal(plugin.flashWindowTabNumber("c"), true);
  assert.ok(innerFor(refs.c).classes.includes(WINDOW_TAB_NUMBERS_FLASH_CLASS));
  // A refresh must not cancel the in-flight flash.
  plugin.refreshWindowTabNumbersNow();
  assert.ok(innerFor(refs.c).classes.includes(WINDOW_TAB_NUMBERS_FLASH_CLASS));
  assert.ok(typeof flashCallback === "function");
  flashCallback();
  assert.ok(!innerFor(refs.c).classes.includes(WINDOW_TAB_NUMBERS_FLASH_CLASS));
  assert.equal(WINDOW_TAB_NUMBERS_FLASH_MS, 220);
  plugin.stopWindowTabNumbers();
});

test("idempotent repaint and full unload cleanup", () => {
  const doc = makeDoc();
  const { area, refs } = twoSplitArea(doc);
  const plugin = pluginFor(doc, area);
  plugin.startWindowTabNumbers();
  plugin.refreshWindowTabNumbersNow();
  const first = innerFor(refs.a).attributes["data-bob-tab"];
  plugin.refreshWindowTabNumbersNow();
  plugin.refreshWindowTabNumbersNow();
  assert.equal(innerFor(refs.a).attributes["data-bob-tab"], first);
  assert.ok(doc.body.classes.includes(WINDOW_TAB_NUMBERS_BODY_CLASS));
  plugin.setWindowTabNumbersLit(true);
  assert.ok(doc.body.classes.includes(WINDOW_TAB_NUMBERS_LIT_CLASS));
  plugin.stopWindowTabNumbers();
  assert.ok(!doc.body.classes.includes(WINDOW_TAB_NUMBERS_BODY_CLASS));
  assert.ok(!doc.body.classes.includes(WINDOW_TAB_NUMBERS_LIT_CLASS));
  for (const ref of Object.values(refs)) {
    assert.equal(innerFor(ref).attributes["data-bob-tab"], undefined);
  }
});

test("missing headers never throw and report numbers hidden", () => {
  const doc = makeDoc();
  const area = {
    splits: [{
      id: "left",
      rect: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
      leaves: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      selectedLeafId: "a",
    }],
    activeLeafId: "a",
    leafById: new Map([
      ["a", { id: "a" }],
      ["b", { id: "b", tabHeaderEl: null }],
    ]),
    splitById: new Map(),
  };
  const plugin = pluginFor(doc, area);
  let result = null;
  assert.doesNotThrow(() => {
    result = plugin.refreshWindowTabNumbersNow();
  });
  assert.equal(result.shown, false);
  assert.equal(result.numbersHidden, true);
  // The card seam reports the same state through the view model flag.
  const view = buildWindowPrefixViewModel({ activeLeafId: "b", splits: area.splits });
  assert.equal(view.tabs.total, 2);
  plugin.stopWindowTabNumbers();
});

test("catalog verdict parity for the stamper inputs", () => {
  assert.deepEqual(windowTabNumeralsVerdict({ tabCount: 4, ctrlWOwner: null, hotkeysKnown: true }), {
    show: true, lit: false, reason: "available",
  });
  assert.equal(buildWindowPrefixTabCatalog({
    activeLeafId: "b",
    splits: [{
      id: "left",
      rect: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
      leaves: [{ id: "a" }, { id: "b" }],
      selectedLeafId: "b",
    }],
  }).tabs[1].leafId, "b");
});
