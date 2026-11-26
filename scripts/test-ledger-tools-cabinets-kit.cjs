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

class FakeElement {
  constructor(attrs = {}, children = []) {
    this.attrs = new Map(Object.entries(attrs));
    this.children = children;
    this.isConnected = true;
    this.disabled = false;
    this.rect = { width: 20, height: 10 };
    this.listeners = new Map();
    this.events = [];
    this.classList = {
      add: (name) => { this.className = `${this.className || ""} ${name}`.trim(); },
    };
    this.ownerDocument = {
      defaultView: { CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } } },
      createElement: () => new FakeElement(),
      createTextNode: (text) => ({ textContent: text }),
    };
    for (const child of children) child.parentElement = this;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  getBoundingClientRect() { return this.rect; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatchEvent(event) { this.events.push(event); return true; }
  matches(selector) {
    if (selector === ".bob-property-card-cabinets") return (this.className || "").split(/\s+/).includes("bob-property-card-cabinets");
    if (selector === "[data-card-fold]") return this.getAttribute("data-card-fold") !== null;
    if (selector === "[data-cabinet-kind]") return this.getAttribute("data-cabinet-kind") !== null;
    return false;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const all = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        const role = child.getAttribute?.("data-card-fold-role");
        const kind = child.getAttribute?.("data-cabinet-kind");
        const fold = child.getAttribute?.("data-card-fold");
        if (selector === ".bob-property-card-cabinets" && child.matches?.(selector)) all.push(child);
        else if (selector === "[data-cabinet-kind]" && kind !== null) all.push(child);
        else if (selector.includes("data-card-fold-role='cabinet'") && role === "cabinet" && fold !== null) all.push(child);
        else if (selector === "[data-card-fold]" && fold !== null) all.push(child);
        visit(child);
      }
    };
    visit(this);
    return all;
  }
}

function cabinetRow(kind, foldKind = kind, source = "Areas/work.md", open = false) {
  const button = new FakeElement({
    "data-card-fold": foldKind,
    "data-card-fold-role": "cabinet",
    "data-card-fold-source": source,
    "data-cabinet-kind": kind,
    "aria-expanded": open ? "true" : "false",
  });
  const panel = new FakeElement({ "data-cabinet-kind": kind }, [button]);
  return { panel, button };
}

function cabinetView(rows, details = null) {
  const stack = new FakeElement({ "data-cabinet-source": "Areas/work.md" }, rows.map((row) => row.panel));
  stack.className = "bob-property-card-cabinets";
  const children = [stack];
  if (details) children.push(details);
  const root = new FakeElement({}, children);
  root.querySelectorAll = function querySelectorAll(selector) {
    if (selector === ".bob-property-card-cabinets") return [stack];
    if (selector === "[data-card-fold]") return rows.map((row) => row.button).concat(details ? [details] : []);
    return FakeElement.prototype.querySelectorAll.call(this, selector);
  };
  return { view: { dom: root, file: { path: "Areas/work.md" } }, root, stack };
}

test("cabinet gate reads only its own plugin-data key once", async () => {
  assert.equal(H.PROPERTY_CARD_CABINETS_PREVIEW_KEY, "cabinetsPreview");
  assert.equal(H.propertyCardCabinetsFromData({ cabinetsPreview: true }), true);
  assert.equal(H.propertyCardCabinetsFromData({ cardPreviewKinds: ["notebook"], refCardPreview: true }), false);
  assert.equal(H.propertyCardCabinetsFromData(null), false);
  H.propertyCardCabinetsSetGateForTests(false);
  let reads = 0;
  const plugin = { loadLedgerToolsPluginData: async () => { reads += 1; return { cabinetsPreview: true }; } };
  assert.equal(await H.propertyCardCabinetsLoad(plugin), true);
  assert.equal(await H.propertyCardCabinetsLoad(plugin), true);
  assert.equal(reads, 1);
  assert.equal(H.propertyCardCabinetsGateLive(), true);
  H.propertyCardCabinetsSetGateForTests(false);
  assert.equal(await H.propertyCardCabinetsLoad({ loadData: async () => { throw new Error("denied"); } }), false);
  assert.equal(H.propertyCardCabinetsGateLive(), false);
});

test("frozen kinds use canonical order and bottom-up contiguous numbering", () => {
  assert.equal(Object.isFrozen(H.PROPERTY_CARD_CABINET_KINDS), true);
  assert.deepEqual(H.propertyCardCabinetOrder(["setup", "areas", "albums", "areas", "properties"]), ["areas", "albums", "setup", "properties"]);
  assert.equal(H.propertyCardCabinetKindForFold("album"), "schema");
  assert.equal(H.propertyCardCabinetKindForFold("bank"), "setup");
  assert.equal(H.propertyCardCabinetKindForFold("prose"), "outline");
  assert.equal(H.propertyCardCabinetKindForFold("area"), null);
  assert.deepEqual(H.propertyCardCabinetNumbering(["areas", "projects", "notebooks", "albums"]), [
    { kind: "areas", number: 4 }, { kind: "projects", number: 3 },
    { kind: "notebooks", number: 2 }, { kind: "albums", number: 1 },
  ]);
  assert.deepEqual(H.propertyCardCabinetNumbering(["schema", "records"]), [
    { kind: "records", number: 2 }, { kind: "schema", number: 1 },
  ]);
  assert.equal(H.propertyCardCabinetDefaultOpen("records"), true);
  assert.equal(H.propertyCardCabinetDefaultOpen("areas"), false);
  assert.equal(H.propertyCardCabinetDefaultOpen("schema"), false);
  assert.equal(H.propertyCardCabinetDefaultOpen("schema", { problems: "needs repair" }), true);
  assert.equal(H.propertyCardCabinetNumbering(["areas", "projects", "notebooks", "albums"]).some((row) => row.number === "q"), false);
});

test("content state carries by path and kind across rename and prunes on delete", () => {
  H.propertyCardCabinetStateResetForTests();
  assert.equal(H.propertyCardCabinetIsOpen("./Areas\\work.md", "areas"), false);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/work.md", "areas", { problems: "damaged" }), true);
  H.propertyCardCabinetSetOpen("Areas/work.md", "areas", false, { problems: "damaged" });
  assert.equal(H.propertyCardCabinetIsOpen("Areas/work.md", "areas", { problems: "damaged" }), false);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/work.md", "areas"), false);
  H.propertyCardCabinetSetOpen("Areas/work.md", "records", true);
  assert.equal(H.propertyCardCabinetRenamePath("Areas/work.md", "Areas/renamed.md"), true);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/renamed.md", "areas"), false);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/renamed.md", "records"), true);
  assert.equal(H.propertyCardCabinetOpenStates.has("Areas/work.md\u0000areas"), false);
  assert.equal(H.propertyCardCabinetReleasePath("Areas/renamed.md"), true);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/renamed.md", "records"), true);
  assert.equal(H.propertyCardCabinetOpenStates.has("Areas/renamed.md\u0000records"), false);
});

test("property-foot adapter binds cabinet rename and delete state cleanup", () => {
  H.propertyCardCabinetStateResetForTests();
  const handlers = new Map();
  const registered = [];
  const plugin = {
    app: { vault: { on: (name, handler) => { handlers.set(name, handler); return { name }; } } },
    registerEvent: (ref) => registered.push(ref),
  };
  H.propertyCardCabinetSetOpen("Areas/work.md", "areas", true);
  H.propertyCardFootAdapterBind(plugin, {});
  H.propertyCardFootAdapterBind(plugin, {});
  assert.equal(registered.length, 2);
  handlers.get("rename")({ path: "Areas/renamed.md" }, "Areas/work.md");
  assert.equal(H.propertyCardCabinetIsOpen("Areas/renamed.md", "areas"), true);
  handlers.get("delete")({ path: "Areas/renamed.md" });
  assert.equal(H.propertyCardCabinetOpenStates.has("Areas/renamed.md\u0000areas"), false);
  H.propertyCardCabinetSetOpen("Areas/renamed.md", "areas", true);
  assert.equal(H.propertyCardCabinetStateReleasePlugin(plugin), true);
  assert.equal(H.propertyCardCabinetOpenStates.size, 0);
});

test("provider unregistration is generation-bound and applies stays synchronous", () => {
  H.propertyCardCabinetProvidersResetForTests();
  const plugin = {};
  const first = { applies: () => ({ summary: "old" }), buildBody() {}, paintKey: () => "old" };
  const second = { applies: () => ({ summary: "new" }), buildBody() {}, paintKey: () => "new" };
  const unregisterOld = H.propertyCardRegisterCabinetProvider(plugin, "areas", first);
  const unregisterNew = H.propertyCardRegisterCabinetProvider(plugin, "areas", second);
  assert.equal(unregisterOld(), false);
  assert.equal(H.propertyCardCabinetProviderFor("areas"), second);
  assert.deepEqual(H.propertyCardCabinetProviderApplies("areas", {}), { summary: "new" });
  const asyncProvider = { applies: async () => ({ summary: "not synchronous" }), buildBody() {}, paintKey: () => "async" };
  H.propertyCardRegisterCabinetProvider(plugin, "projects", asyncProvider);
  assert.equal(H.propertyCardCabinetProviderApplies("projects", {}), null);
  assert.equal(H.propertyCardCabinetProvidersReleasePlugin(plugin), 2);
  assert.equal(unregisterNew(), false);
  assert.equal(H.propertyCardCabinetProviderFor("areas"), null);
});

test("fold controls acquire roles only while the cabinets gate is open", () => {
  const button = new FakeElement();
  H.propertyCardCabinetsSetGateForTests(false);
  assert.equal(H.propertyCardDecorateFoldControl(button, { kind: "area", path: "Areas/work.md", compact: true }), true);
  assert.equal(button.getAttribute("data-card-fold-role"), null);
  H.propertyCardCabinetsSetGateForTests(true);
  assert.equal(H.propertyCardDecorateFoldControl(button, { kind: "area", path: "Areas/work.md", compact: true }), true);
  assert.equal(button.getAttribute("data-card-fold-role"), "details");
  assert.equal(H.propertyCardDecorateFoldControl(button, { kind: "album", path: "Areas/work.md" }), true);
  assert.equal(button.getAttribute("data-card-fold-role"), "cabinet");
  H.propertyCardCabinetsSetGateForTests(false);
});

test("view collector rejects stale, disabled, and noncanonical cabinet stacks", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  const areas = cabinetRow("areas");
  const albums = cabinetRow("albums");
  const good = cabinetView([areas, albums]);
  assert.deepEqual(H.propertyCardCabinetsInView(good.view).extras.map(({ kind, number }) => ({ kind, number })), [
    { kind: "areas", number: 2 }, { kind: "albums", number: 1 },
  ]);
  const stale = cabinetRow("areas", "areas", "Other/note.md");
  assert.deepEqual(H.propertyCardCabinetsInView(cabinetView([stale]).view).extras, []);
  const disabled = cabinetRow("areas");
  disabled.button.disabled = true;
  assert.deepEqual(H.propertyCardCabinetsInView(cabinetView([disabled]).view).extras, []);
  assert.deepEqual(H.propertyCardCabinetsInView(cabinetView([albums, areas]).view).extras, []);
  H.propertyCardCabinetsSetGateForTests(false);
});

test("toggle router uses the provider state and the matching view mount", () => {
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetsSetGateForTests(true);
  const row = cabinetRow("areas");
  const { view, stack } = cabinetView([row]);
  const plugin = {};
  let paints = 0;
  H.propertyCardRegisterCabinetProvider(plugin, "areas", { applies: () => ({ summary: "1" }), buildBody() {}, paintKey: () => "areas" });
  const unmount = H.propertyCardCabinetRegisterMount(plugin, view, "Areas/work.md", stack, () => { paints += 1; });
  assert.equal(H.propertyCardCabinetToggle(view, "areas"), true);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/work.md", "areas"), true);
  assert.equal(paints, 1);
  assert.equal(H.propertyCardCabinetToggle(view, "missing"), false);
  unmount();
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
});

test("role-aware fold target skips cabinet rows when the gate is open", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  let toggled = 0;
  const unregisterDetails = H.propertyCardRegisterFoldKind({}, "area", { toggle: () => { toggled += 1; } });
  const details = new FakeElement({
    "data-card-fold": "area", "data-card-fold-role": "details",
    "data-card-fold-source": "Areas/work.md", "aria-expanded": "true",
  });
  const cabinet = cabinetRow("areas").button;
  const { view, root } = cabinetView([cabinetRow("areas")], details);
  root.querySelectorAll = (selector) => selector === "[data-card-fold]" ? [cabinet, details] : [];
  assert.equal(H.propertyCardFoldTarget(view).element, details);
  assert.equal(H.propertyCardToggleDetails(view), true);
  assert.equal(toggled, 1);
  unregisterDetails();
  H.propertyCardCabinetsSetGateForTests(false);
});
