"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class { constructor() {} }, Plugin: class {},
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
    this.className = attrs.class || "";
    this.ownerDocument = {
      defaultView: { CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } } },
      createElement: () => new FakeElement(),
      createTextNode: (text) => ({ textContent: text }),
      activeElement: null,
    };
    for (const child of children) child.parentElement = this;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  getBoundingClientRect() { return this.rect; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  scrollIntoView() { this.scrolled = true; }
  matches(selector) {
    if (selector === ".bob-property-card-cabinets") return this.className.split(/\s+/).includes("bob-property-card-cabinets");
    if (selector === "[data-card-fold]") return this.getAttribute("data-card-fold") !== null;
    if (selector === "[data-cabinet-kind]") return this.getAttribute("data-cabinet-kind") !== null;
    return false;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const all = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        const role = child.getAttribute?.("data-card-fold-role");
        const kind = child.getAttribute?.("data-cabinet-kind");
        const fold = child.getAttribute?.("data-card-fold");
        const keycap = child.getAttribute?.("data-cabinet-keycap");
        if (selector === ".bob-property-card-cabinets" && child.matches?.(selector)) all.push(child);
        else if (selector === "[data-cabinet-kind]" && kind !== null) all.push(child);
        else if (selector === "[data-card-fold-role='cabinet'][data-card-fold]" && role === "cabinet" && fold !== null) all.push(child);
        else if (selector === "[data-card-fold]" && fold !== null) all.push(child);
        else if (selector === "[data-cabinet-keycap]" && keycap !== null) all.push(child);
        visit(child);
      }
    };
    visit(this);
    return all;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector === "[data-cabinet-kind]" && node.getAttribute?.("data-cabinet-kind") !== null) return node;
      node = node.parentElement;
    }
    return null;
  }
}

function panelRow(kind, source = "Areas/work.md", open = false, number = null) {
  const button = new FakeElement({
    "data-card-fold": kind === "properties" ? "properties" : kind,
    "data-card-fold-role": "cabinet",
    "data-card-fold-source": source,
    "aria-expanded": open ? "true" : "false",
  });
  const keycap = new FakeElement({ "data-cabinet-keycap": "true", "data-cabinet-rest-key": "_" });
  button.appendChild(keycap);
  // Mirror the cabinet chrome's disclosure: a click owns the session-state
  // write and flips aria-expanded, which is what keyboard picks route through.
  button.clicks = 0;
  button.click = () => {
    button.clicks += 1;
    const next = button.getAttribute("aria-expanded") !== "true";
    H.propertyCardCabinetSetOpen(source, kind, next);
    button.setAttribute("aria-expanded", String(next));
  };
  const panel = new FakeElement({ "data-cabinet-kind": kind }, [button]);
  if (number !== null) panel.appendChild(new FakeElement({}));
  return { panel, button, keycap };
}

function pickView(rows, details = null, source = "Areas/work.md") {
  const stack = new FakeElement({ "data-cabinet-source": source }, rows.map((row) => row.panel));
  stack.className = "bob-property-card-cabinets";
  const children = [stack];
  if (details) children.push(details);
  const root = new FakeElement({}, children);
  root.querySelectorAll = function querySelectorAll(selector) {
    if (selector === ".bob-property-card-cabinets") return [stack];
    if (selector === "[data-card-fold]") return rows.map((row) => row.button).concat(details ? [details] : []);
    return FakeElement.prototype.querySelectorAll.call(this, selector);
  };
  const view = { dom: root, file: { path: source } };
  return { view, root, stack };
}

function fakePlugin() {
  const pushes = [];
  const pops = [];
  return {
    pushes, pops,
    app: { vault: {}, workspace: { on: () => ({ off: () => {} }) } },
    walkerFooterOverlayPush(text, options) { pushes.push({ text, options }); return { token: pushes.length }; },
    walkerFooterOverlayPop(token) { pops.push(token); return true; },
    register(release) { this._release = release; return release; },
  };
}

function keyEvent(key, extra = {}) {
  return {
    key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    repeat: false, isComposing: false, keyCode: 0, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.immediateStopped = true; },
    ...extra,
  };
}

test("pick footer and announce text order chips bottom-up with properties and esc", () => {
  const snapshot = [{ kind: "areas", number: 2 }, { kind: "albums", number: 1 }];
  const byKind = new Map([["areas", false], ["albums", true]]);
  const text = H.propertyCardCabinetPickFooterText(snapshot, byKind, 2);
  assert.match(text, /1 Albums ▾/);
  assert.match(text, /2 Areas ▸/);
  assert.ok(text.indexOf("1 Albums") < text.indexOf("2 Areas"));
  assert.match(text, /- Properties/);
  assert.match(text, /esc/);
  const announce = H.propertyCardCabinetPickAnnounceText(snapshot);
  assert.match(announce, /1 Albums/);
  assert.match(announce, /Escape to cancel/);
});

test("underscore routes zero extras to details, one to direct toggle, two to arm", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetPickSetDelayForTests(0);

  let detailsToggles = 0;
  const unregister = H.propertyCardRegisterFoldKind({}, "area", { toggle: () => { detailsToggles += 1; return true; } });
  const details = new FakeElement({
    "data-card-fold": "area", "data-card-fold-role": "details",
    "data-card-fold-source": "Areas/work.md", "aria-expanded": "false",
  });
  const zero = pickView([], details);
  assert.equal(H.propertyCardCabinetCanUnderscore(zero.view), true);
  assert.equal(H.propertyCardCabinetUnderscore(zero.view, fakePlugin()), true);
  assert.equal(detailsToggles, 1);
  unregister();

  const single = pickView([panelRow("areas")]);
  const plugin = fakePlugin();
  H.propertyCardRegisterCabinetProvider(plugin, "areas", { applies: () => ({ summary: "1" }), buildBody() {}, paintKey: () => "areas" });
  const stack = single.stack;
  const unmount = H.propertyCardCabinetRegisterMount(plugin, single.view, "Areas/work.md", stack, () => true);
  assert.equal(H.propertyCardCabinetUnderscore(single.view, plugin), true);
  assert.equal(H.propertyCardCabinetPickActive(), false);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/work.md", "areas"), true);

  const two = pickView([panelRow("areas"), panelRow("albums")]);
  const plugin2 = fakePlugin();
  H.propertyCardRegisterCabinetProvider(plugin2, "albums", { applies: () => ({ summary: "1" }), buildBody() {}, paintKey: () => "albums" });
  const unmount2 = H.propertyCardCabinetRegisterMount(plugin2, two.view, "Areas/work.md", two.stack, () => true);
  assert.equal(H.propertyCardCabinetCanUnderscore(two.view), true);
  assert.equal(H.propertyCardCabinetUnderscore(two.view, plugin2), true);
  assert.equal(H.propertyCardCabinetPickActive(), true);
  const snap = H.propertyCardCabinetPickSnapshotForTests();
  assert.equal(snap.snapshot.length, 2);
  H.propertyCardCabinetPickDisarmPick({ silent: true });
  assert.equal(H.propertyCardCabinetPickActive(), false);

  unmount(); unmount2();
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetProvidersReleasePlugin(plugin2);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
});

test("armed pick: digit toggles and disarms, out-of-range nudges, underscore picks 1, dash picks properties", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetPickSetDelayForTests(0);
  const rows = [panelRow("areas"), panelRow("albums")];
  const { view, stack } = pickView(rows);
  const plugin = fakePlugin();
  for (const kind of ["areas", "albums"]) {
    H.propertyCardRegisterCabinetProvider(plugin, kind, { applies: () => ({ summary: "1" }), buildBody() {}, paintKey: () => kind });
  }
  const unmount = H.propertyCardCabinetRegisterMount(plugin, view, "Areas/work.md", stack, () => true);
  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  assert.equal(H.propertyCardCabinetPickActive(), true);
  assert.equal(plugin.pushes.length, 1);

  const bad = keyEvent("9");
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(bad), false);
  assert.equal(bad.prevented, true);
  assert.equal(H.propertyCardCabinetPickActive(), true);

  const zero = keyEvent("0");
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(zero), false);
  assert.equal(H.propertyCardCabinetPickActive(), true);

  const one = keyEvent("1");
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(one), false);
  assert.equal(one.prevented, true);
  assert.equal(H.propertyCardCabinetPickActive(), false);
  assert.equal(plugin.pops.length, 1);
  // Numbers count up from the bottom extra, so 1 is Albums.
  assert.equal(rows[1].button.clicks, 1);
  assert.equal(rows[0].button.clicks, 0);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/work.md", "albums"), true);
  assert.equal(H.propertyCardCabinetIsOpen("Areas/work.md", "areas"), false);

  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  const dash = keyEvent("-");
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(dash), false);
  assert.equal(H.propertyCardCabinetPickActive(), false);

  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  const under = keyEvent("_");
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(under), false);
  assert.equal(H.propertyCardCabinetPickActive(), false);

  unmount();
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
});

test("armed pick cancels on escape, q, ctrl-bracket and passes other keys through", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetPickSetDelayForTests(0);
  const { view, stack } = pickView([panelRow("areas"), panelRow("albums")]);
  const plugin = fakePlugin();
  for (const kind of ["areas", "albums"]) {
    H.propertyCardRegisterCabinetProvider(plugin, kind, { applies: () => ({ summary: "1" }), buildBody() {}, paintKey: () => kind });
  }
  const unmount = H.propertyCardCabinetRegisterMount(plugin, view, "Areas/work.md", stack, () => true);

  for (const key of ["Escape", "q", "Q"]) {
    assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
    const event = keyEvent(key === "Escape" ? "Escape" : key);
    assert.equal(H.propertyCardCabinetPickOnCaptureKey(event), false);
    assert.equal(event.prevented, true);
    assert.equal(H.propertyCardCabinetPickActive(), false);
  }
  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  const bracket = keyEvent("[", { ctrlKey: true, code: "BracketLeft" });
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(bracket), false);
  assert.equal(H.propertyCardCabinetPickActive(), false);

  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  const other = keyEvent("j");
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(other), true);
  assert.equal(other.prevented, undefined);
  assert.equal(H.propertyCardCabinetPickActive(), false);

  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  const combo = keyEvent("1", { ctrlKey: true });
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(combo), true);
  assert.equal(H.propertyCardCabinetPickActive(), false);

  const repeat = keyEvent("2", { repeat: true });
  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  assert.equal(H.propertyCardCabinetPickOnCaptureKey(repeat), false);
  assert.equal(H.propertyCardCabinetPickActive(), true);
  H.propertyCardCabinetPickDisarmPick({ silent: true });

  unmount();
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
});

test("vanished kind cancels with notice and mid-pick repaint keeps snapshot numbering", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetPickSetDelayForTests(0);
  const notes = [];
  globalThis.Notice = class { constructor(message) { notes.push(String(message)); } };
  const { view, stack } = pickView([panelRow("areas"), panelRow("albums")]);
  const plugin = fakePlugin();
  for (const kind of ["areas", "albums"]) {
    H.propertyCardRegisterCabinetProvider(plugin, kind, { applies: () => ({ summary: "1" }), buildBody() {}, paintKey: () => kind });
  }
  const unmount = H.propertyCardCabinetRegisterMount(plugin, view, "Areas/work.md", stack, () => true);
  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  stack.isConnected = false;
  const digit = keyEvent("1");
  const before = notes.length;
  H.propertyCardCabinetPickOnCaptureKey(digit);
  void before;
  assert.equal(H.propertyCardCabinetPickActive(), false);
  stack.isConnected = true;
  delete globalThis.Notice;
  unmount();
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
});

test("pick disarms on release and leaves no overlay or scope behind", () => {
  H.propertyCardCabinetsSetGateForTests(true);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetProvidersResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetPickSetDelayForTests(0);
  const { view, stack } = pickView([panelRow("areas"), panelRow("albums")]);
  const plugin = fakePlugin();
  for (const kind of ["areas", "albums"]) {
    H.propertyCardRegisterCabinetProvider(plugin, kind, { applies: () => ({ summary: "1" }), buildBody() {}, paintKey: () => kind });
  }
  const unmount = H.propertyCardCabinetRegisterMount(plugin, view, "Areas/work.md", stack, () => true);
  assert.equal(H.propertyCardCabinetUnderscore(view, plugin), true);
  assert.equal(H.propertyCardCabinetPickActive(), true);
  assert.equal(H.propertyCardCabinetPickReleasePlugin(plugin), true);
  assert.equal(H.propertyCardCabinetPickActive(), false);
  assert.equal(plugin.pops.length, 1);
  unmount();
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetStateResetForTests();
  H.propertyCardCabinetPickResetForTests();
  H.propertyCardCabinetsSetGateForTests(false);
});
