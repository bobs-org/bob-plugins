// Day and period card group rail (bob-cli-oj group-rail): one nav answer
// per card from walkMode.links v7 (else api.navGroups), the group row on day,
// week, and quarter cards, the derived step row on notes with no recognized
// nav line, exists / creatable / ghost on rail items, chips, and arms, item
// and arm activation (re-validation, the card's leaf, periodNotes ensure),
// and existence repaints.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
  addCommand(command) { return command; }
}

const editorLivePreviewField = { live: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.ranges = []; } add(from, to, value) { this.ranges.push({ from, to, value }); } finish() { return { ranges: this.ranges }; } }
const Decoration = { none: { ranges: [] }, widget: (spec) => ({ spec }), set: (ranges) => ({ ranges }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } load() {} unload() {} },
    Notice: class {}, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    Keymap: { isModEvent: (event) => (event?.ctrlKey || event?.metaKey ? "tab" : false) },
    parseYaml: (text) => JSON.parse(text), normalizePath: (value) => value,
    editorInfoField: { info: true }, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType,
    EditorView: {
      decorations: { from: (field, get) => ({ field, get }) },
      editorAttributes: { of: (value) => value, from: (field, get) => ({ field, get }) },
      updateListener: { of: (listener) => ({ listener }) },
    },
    ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const TODAY = "2026-11-21";

// ---- Fake DOM -------------------------------------------------------------

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
      add(...names) { const xs = new Set(self.className.split(/\s+/).filter(Boolean)); for (const name of names) xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(...names) { self.setAttribute("class", self.className.split(/\s+/).filter((x) => x && !names.includes(x)).join(" ")); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value) { this.childNodes = []; this.appendChild(new FakeText(value, this.ownerDocument)); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) {
    node.parentNode?.removeChild?.(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, target: this, defaultPrevented: false, ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; };
    event.stopPropagation = () => {};
    let node = this;
    while (node) {
      for (const listener of node.listeners?.get?.(type) || []) listener(event);
      node = node.parentNode;
    }
    return event;
  }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = part.replace(/\[[^\]]*\]/g, "").match(/\.[\w-]+/g) || [];
      const attrs = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      if (!tag && !cls.length && !attrs.length) return false;
      if (!cls.every((name) => this.classList.contains(name.slice(1)))) return false;
      return attrs.every(([, name, value]) => (value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  const doc = {};
  doc.createElement = (tag) => new FakeNode(tag, doc);
  doc.createTextNode = (text) => new FakeText(text, doc);
  return doc;
}

const flush = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const text = (node) => node?.textContent ?? null;

// ---- Fake vault ------------------------------------------------------------

// The contract's world: today is 2026-11-21; 2025 has no week notes;
// 2026-W49–W53 do not exist yet; 2027-W01, 2027-W02, and 2027-Q1 exist.
function vaultPaths() {
  const paths = ["all_time.md", "2025.md", "2026.md", "2027.md"];
  for (let week = 1; week <= 48; week += 1) paths.push(`2026/2026-W${String(week).padStart(2, "0")}.md`);
  for (let quarter = 1; quarter <= 4; quarter += 1) paths.push(`2026/2026-Q${quarter}.md`);
  paths.push("2027/2027-W01.md", "2027/2027-W02.md", "2027/2027-Q1.md");
  paths.push("2026/20261109.md", "2026/20261120.md", "2026/20261121.md", "2026/20261221.md", "2026/20261231.md");
  paths.push("2027/20270104.md", "2025/20251229.md", "2026/20260105.md");
  return paths;
}

function note(body = "Body.\n", fields = {}) {
  return `---\n${JSON.stringify(fields)}\n---\n\n${body}`;
}

function world({ nav = "walkMode", patch = null } = {}) {
  const doc = makeDoc();
  const files = new Map();
  const disk = new Map();
  const opened = [];
  const commandsRun = [];
  const vaultEvents = {};
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()],
      async read(file) { return disk.get(file.path); },
      async cachedRead(file) { return disk.get(file.path); },
      on(name, callback) { vaultEvents[name] = callback; return { name }; },
    },
    metadataCache: {
      getFileCache: (file) => (files.has(file.path) ? { frontmatter: {} } : null),
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
      on: () => ({}),
    },
    workspace: {
      leaves: [],
      getLeavesOfType() { return this.leaves; },
      on: () => ({}),
      openLinkText(...args) { opened.push(args); return Promise.resolve(); },
      setActiveLeaf(leaf, options) { this.active = { leaf, options }; },
    },
    commands: {
      commands: {
        "bob-navigation-hotkeys:open-prev-link": {}, "bob-navigation-hotkeys:open-next-link": {},
        "bob-navigation-hotkeys:open-prev-group-link": {}, "bob-navigation-hotkeys:open-next-group-link": {},
      },
      executeCommandById(id) { commandsRun.push(id); return true; },
    },
    plugins: { plugins: {} },
  };
  const add = (path, body) => {
    files.set(path, { path, extension: "md" });
    disk.set(path, note(body));
  };
  for (const path of vaultPaths()) add(path);
  const plugin = new LedgerToolsPlugin(app);
  const timers = new Map();
  let next = 0;
  plugin.albumSetTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; };
  plugin.albumClearTimeout = (id) => timers.delete(id);
  plugin.intentionCardToday = () => TODAY;
  plugin.navGroupsTodayOverride = TODAY;
  const notices = [];
  plugin.intentionCardNotice = (message) => notices.push(message);
  const ensures = [];
  plugin.periodNotesEnsureForPath = async (path) => { ensures.push(path); return plugin.ensureResult || { ok: true }; };
  const walkMode = {
    version: 7,
    calls: 0,
    links({ path, content }) {
      walkMode.calls += 1;
      const provider = plugin.navGroupsResolve({ path, content });
      if (!provider.ok) return { ok: false };
      const stop = (value) => (value ? { ...value, text: value.landingLabel, exists: value.state === "exists" } : null);
      const answer = {
        ok: true, prev: stop(provider.step?.prev), next: stop(provider.step?.next),
        prevGroup: stop(provider.prevGroup), nextGroup: stop(provider.nextGroup),
        group: provider.group, groupNone: provider.none, groupConflict: null, groupConflicts: [],
      };
      return walkMode.patch ? walkMode.patch(answer, { path, content }) : answer;
    },
    patch,
  };
  if (nav === "walkMode") app.plugins.plugins["bob-navigation-hotkeys"] = { api: { version: 3, walkMode } };
  plugin.setupIntentionCard();
  const run = () => { for (const [id, timer] of Array.from(timers.entries())) { timers.delete(id); timer.fn(); } };
  const refreshes = { count: 0 };
  const host = plugin.intentionCardHost();
  const schedule = host.scheduleRefresh.bind(host);
  host.scheduleRefresh = () => { refreshes.count += 1; return schedule(); };
  return { doc, app, files, disk, add, plugin, opened, commandsRun, notices, ensures, timers, run, walkMode, vaultEvents, refreshes };
}

function prepare(w, path, body) {
  if (body !== undefined) w.disk.set(path, note(body));
  const prepared = w.plugin.intentionCardModelFor(path, w.disk.get(path));
  assert.ok(prepared, `${path} has a card model`);
  return prepared.model;
}

function card(w, path, body) {
  const model = prepare(w, path, body);
  const element = H.intentionCardBuildDom(model, w.plugin, w.doc);
  const rail = element.querySelector(".bob-property-card-rail");
  if (rail) {
    assert.equal(element.children.at(-1), rail, "the rail is the card's floor");
    assert.equal(rail.getAttribute("data-card-floor"), "link-walk");
  }
  return { model, element, rail };
}

function arm(element, direction) {
  return element.querySelector(`a.bob-property-card-group-arm[data-group="${direction}"]`);
}

function armText(node, cls) {
  return text(node?.querySelector(`.bob-property-card-group-${cls}`));
}

// A leaf whose container holds the card, so a click resolves the card's pane.
function mount(w, path, element) {
  const container = w.doc.createElement("div");
  container.appendChild(element);
  const leaf = { view: { file: { path }, containerEl: container, editor: { getValue: () => w.disk.get(path) } } };
  w.app.workspace.leaves.push(leaf);
  return leaf;
}

const WEEK_NAV = (week) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `[[2026/2026-W${pad(week - 1)}|‹ W${pad(week - 1)}]] · [[2026/2026-Q4|↑ 2026-Q4]] · [[2026/2026-W${pad(week + 1)}|W${pad(week + 1)} ›]]`;
};

// ---- Worked examples ----------------------------------------------------------

test("weeks: 2026-W30 mid-quarter and 2026-W47 crossing into 2027", () => {
  const w = world();
  const w30 = card(w, "2026/2026-W30.md");
  assert.equal(w30.model.navRail.unit, "quarter");
  const row = w30.rail.querySelector(".bob-property-card-group-row");
  assert.equal(row.getAttribute("aria-label"), "Quarter groups");
  assert.equal(armText(arm(w30.element, "prev"), "label"), "Q2");
  assert.equal(armText(arm(w30.element, "prev"), "landing"), null, "the landing is not painted");
  assert.equal(arm(w30.element, "prev").getAttribute("title"), "[N · previous quarter: Q2 → 2026-W14", "the tooltip names it");
  assert.equal(arm(w30.element, "prev").getAttribute("aria-label"), "Previous quarter group: Q2, opens 2026-W14");
  assert.equal(arm(w30.element, "prev").querySelector(".bob-property-card-group-glyph").getAttribute("data-icon"), "skip-back");
  assert.equal(arm(w30.element, "next").querySelector(".bob-property-card-group-glyph").getAttribute("data-icon"), "skip-forward");
  assert.ok(!/[«»]/.test(text(row)), "no « / » on the row");
  assert.equal(arm(w30.element, "prev").getAttribute("href"), "2026/2026-W14");
  assert.equal(armText(arm(w30.element, "next"), "label"), "Q4");
  assert.equal(arm(w30.element, "next").getAttribute("href"), "2026/2026-W40");
  assert.equal(row.querySelector(".bob-property-card-group-position-wide"), null, "no visible position text");
  assert.equal(row.querySelector(".bob-property-card-group-position-narrow"), null);
  assert.equal(text(row.querySelector(".bob-property-card-group-position-label")), "Week 4 of 13 in quarter Q3");
  assert.equal(row.querySelector(".bob-property-card-group-center").getAttribute("title"), "Week 4 of 13 in quarter Q3");
  const ticks = row.querySelectorAll(".bob-property-card-group-tick");
  assert.equal(ticks.length, 13);
  assert.equal(ticks[3].getAttribute("data-state"), "current");
  assert.ok(ticks.filter((tick) => tick.getAttribute("data-state") === "exists").length === 12);

  const w47 = card(w, "2026/2026-W47.md");
  const prev = arm(w47.element, "prev");
  const next = arm(w47.element, "next");
  assert.equal(prev.getAttribute("aria-label"), "Previous quarter group: Q3, opens 2026-W27");
  assert.equal(prev.getAttribute("title"), "[N · previous quarter: Q3 → 2026-W27");
  assert.equal(armText(next, "label"), "2027-Q1");
  assert.equal(armText(next, "landing"), null);
  assert.equal(next.getAttribute("data-state"), "exists");
  assert.equal(next.getAttribute("title"), "]N · next quarter: 2027-Q1 → 2027-W01");
  assert.equal(next.getAttribute("aria-label"), "Next quarter group: 2027-Q1, opens 2027-W01");
  const w47Ticks = w47.rail.querySelectorAll(".bob-property-card-group-tick").map((tick) => tick.getAttribute("data-state"));
  assert.equal(w47Ticks.length, 14, "Q4 takes W53");
  assert.deepEqual(w47Ticks.slice(7), ["current", "exists", "missing", "missing", "missing", "missing", "missing"]);
});

test("2026-W01 and 2026-Q4 show pre-adoption ghost arms that never link", () => {
  const w = world();
  const w01 = card(w, "2026/2026-W01.md");
  const ghost = arm(w01.element, "prev");
  assert.equal(ghost.getAttribute("data-state"), "ghost");
  assert.equal(ghost.getAttribute("href"), null);
  assert.equal(ghost.getAttribute("aria-disabled"), "true");
  assert.equal(armText(ghost, "label"), "2025-Q4");
  assert.equal(armText(ghost, "note"), "· not in vault");
  assert.equal(ghost.getAttribute("aria-label"), "Previous quarter group: 2025-Q4, 2025-W40 not in vault");
  assert.equal(ghost.getAttribute("title"), "2025-W40 is before Bob's period notes began — navigation never creates it");
  assert.equal(arm(w01.element, "next").getAttribute("href"), "2026/2026-W14");

  const q4 = card(w, "2026/2026-Q4.md");
  assert.equal(q4.model.navRail.unit, "year");
  const q4Ghost = arm(q4.element, "prev");
  assert.equal(q4Ghost.getAttribute("data-state"), "ghost");
  assert.equal(q4Ghost.getAttribute("aria-label"), "Previous year group: 2025, 2025-Q1 not in vault");
  assert.equal(q4Ghost.getAttribute("title"), "2025-Q1 is before Bob's period notes began — navigation never creates it");
  assert.equal(arm(q4.element, "next").getAttribute("title"), "]N · next year: 2027 → 2027-Q1");
  assert.equal(q4.rail.querySelector(".bob-property-card-group-center").getAttribute("title"), "Quarter 4 of 4 in year 2026");
});

test("dailies: Saturday's creatable next Monday, a Thursday in 2026-W53, and 20251229 in 2026-W01", () => {
  const w = world();
  const sat = card(w, "2026/20261121.md");
  assert.equal(sat.model.navRail.unit, "week");
  const next = arm(sat.element, "next");
  assert.equal(next.getAttribute("data-state"), "creatable");
  assert.equal(armText(next, "label"), "W48");
  assert.equal(armText(next, "landing"), null);
  assert.equal(armText(next, "plus"), "+");
  assert.equal(next.getAttribute("title"), "Mon Nov 23 isn't created yet — ]N creates it from the daily template");
  assert.equal(next.getAttribute("aria-label"), "Next week group: W48, not created yet — activating creates Mon Nov 23");
  assert.equal(arm(sat.element, "prev").getAttribute("aria-label"), "Previous week group: W46, opens Mon Nov 9");
  assert.equal(sat.rail.querySelector(".bob-property-card-group-center").getAttribute("title"), "Day 6 of 7 in week W47");
  assert.equal(text(sat.rail.querySelector(".bob-property-card-group-position-label")), "Day 6 of 7 in week W47");
  const states = sat.rail.querySelectorAll(".bob-property-card-group-tick").map((tick) => tick.getAttribute("data-state"));
  assert.deepEqual(states, ["missing", "missing", "missing", "missing", "exists", "current", "missing"]);

  const thu = card(w, "2026/20261231.md");
  assert.equal(arm(thu.element, "prev").getAttribute("href"), "2026/20261221");
  assert.equal(arm(thu.element, "next").getAttribute("href"), "2027/20270104");
  assert.equal(thu.model.navRail.group.label, "W53");
  assert.equal(thu.rail.querySelector(".bob-property-card-group-center").getAttribute("title"), "Day 4 of 7 in week W53");

  const mon = card(w, "2025/20251229.md");
  const ghost = arm(mon.element, "prev");
  assert.equal(ghost.getAttribute("data-state"), "ghost");
  assert.equal(armText(ghost, "label"), "2025-W52");
  assert.equal(arm(mon.element, "next").getAttribute("href"), "2026/20260105");
  assert.equal(mon.rail.querySelector(".bob-property-card-group-center").getAttribute("title"), "Day 1 of 7 in week W01");
});

test("years and all_time keep today's rail: no group row", () => {
  const w = world();
  const year = card(w, "2026.md", "# 2026 · Dec 29, 2025 – Jan 3, 2027 · 53 weeks\n\n[[2025|‹ 2025]] · [[all_time|↑ All time]] · [[2027|2027 ›]]\n");
  assert.equal(year.model.navRail, null);
  assert.ok(year.rail, "the written rail still shows");
  assert.equal(year.rail.querySelector(".bob-property-card-group-row"), null);
  assert.equal(H.intentionCardNavRailModel({ ok: true, group: { noun: "quarter", position: 1, size: 4 } },
    { subject: H.intentionCardSubjectForPath("2026.md", TODAY), written: true }), null);
  assert.equal(w.plugin.intentionCardModelFor("all_time.md", w.disk.get("all_time.md")), null, "all_time has no card");
});

// ---- Derived step row ------------------------------------------------------

test("a legacy daily with no nav line gets the derived step row, its parent, and the group row", () => {
  for (const nav of ["walkMode", "navGroups"]) {
    const w = world({ nav });
    const sat = card(w, "2026/20261121.md", "day::2026-11-21 Sat\n\nNotes.\n");
    assert.equal(sat.model.rail, null, `${nav}: no written rail`);
    assert.equal(sat.model.navRail.from, nav);
    const prev = sat.rail.querySelector('[data-rail="prev"]');
    const parent = sat.rail.querySelector('[data-rail="parent"]');
    const next = sat.rail.querySelector('[data-rail="next"]');
    assert.equal(text(prev.querySelector(".bob-property-card-rail-label-wide")), "Fri 20");
    assert.equal(prev.getAttribute("aria-label"), "Previous day: Fri, Nov 20, 2026");
    assert.equal(prev.getAttribute("data-state"), null, "an existing day keeps today's look");
    assert.equal(text(parent.querySelector(".bob-property-card-rail-label-wide")), "W47");
    assert.equal(parent.getAttribute("href"), "2026/2026-W47");
    assert.equal(text(next.querySelector(".bob-property-card-rail-label-wide")), "Sun 22");
    assert.equal(next.getAttribute("data-state"), "creatable");
    assert.ok(next.classList.contains("is-unresolved"), "the compatibility marker stays");
    assert.equal(next.getAttribute("title"), "Sun Nov 22 isn't created yet — clicking creates it from the daily template");
    const children = sat.rail.children.map((node) => node.className.split(/\s+/)[0]);
    assert.deepEqual(children, ["bob-property-card-rail-row", "bob-property-card-group-row"], `${nav}: step row, then group row`);
    assert.equal(sat.rail.querySelector(".bob-property-card-rail-children"), null, "no derived children");
  }

  const w = world();
  const week = card(w, "2026/2026-W30.md", "Legacy week.\n");
  assert.deepEqual(["prev", "parent", "next"].map((d) => text(week.rail.querySelector(`[data-rail="${d}"]`).querySelector(".bob-property-card-rail-label-wide"))),
    ["W29", "2026-Q3", "W31"]);
  assert.equal(week.rail.querySelector('[data-rail="parent"]').getAttribute("aria-label"), "Parent quarter: 2026-Q3");
});

test("an authored prev / next elsewhere in the body suppresses the derived step row", () => {
  const body = "Notes.\n\nSee [[2026/20261120|prev]] and [[2026/20261122|next]].\n";
  const w = world({
    patch: (answer) => ({ ...answer, prev: { ...answer.prev, source: "authored" }, next: { ...answer.next, source: "authored" } }),
  });
  const sat = card(w, "2026/20261121.md", body);
  assert.equal(sat.model.navRail.step, null);
  assert.equal(sat.rail.querySelector(".bob-property-card-rail-row"), null, "a group-only rail has no step row");
  assert.ok(sat.rail.querySelector(".bob-property-card-group-row"));

  const fallback = world({ nav: "navGroups" });
  const plain = card(fallback, "2026/20261121.md", body);
  assert.equal(plain.model.navRail.step, null, "without Navigation Hotkeys the body's step links still win");
  assert.equal(H.intentionCardHasAuthoredStepLink("[[a|‹ W46]]"), true);
  assert.equal(H.intentionCardHasAuthoredStepLink("[W48 ›](b.md)"), true);
  assert.equal(H.intentionCardHasAuthoredStepLink("[[a|« Q3]] · [[b|Q4 »]] and [[c|Other]]"), false);
});

test("a recognized nav line keeps the written rail and only adds the group row", () => {
  const w = world();
  const week = card(w, "2026/2026-W48.md", `# 2026-W48 · Nov 23 – 29\n\n${WEEK_NAV(48)}\n`);
  assert.ok(week.model.rail, "the written rail");
  assert.equal(week.model.navRail.step, null, "no derived row beside a written one");
  assert.equal(week.rail.querySelectorAll('[data-rail="prev"]').length, 1);
  const next = week.rail.querySelector('[data-rail="next"]');
  assert.equal(next.getAttribute("data-state"), "creatable", "W49 is missing in the contract world");
  assert.equal(next.getAttribute("title"), "2026-W49 isn't created yet — clicking creates it with bob periods ensure");
  assert.equal(week.rail.querySelector('[data-rail="prev"]').getAttribute("data-state"), null);
});

test("a conflicted role has no arm", () => {
  const w = world({ patch: (answer) => ({ ...answer, nextGroup: null, groupConflict: "next", groupConflicts: ["next"] }) });
  const week = card(w, "2026/2026-W30.md");
  assert.deepEqual(week.model.navRail.conflicts, ["next"]);
  assert.ok(arm(week.element, "prev"));
  assert.equal(arm(week.element, "next"), null);
  assert.ok(week.rail.querySelector('.bob-property-card-group-gap[data-group="next"]'));
});

// ---- Activation -----------------------------------------------------------------

test("ghost items, chips, and arms only show their reason: nothing opens or writes", async () => {
  const w = world();
  const w01 = card(w, "2026/2026-W01.md",
    "# 2026-W01 · Dec 29 – Jan 4\n\n[[2025/2025-W52|‹ 2025-W52]] · [[2026/2026-Q1|↑ 2026-Q1]] · [[2026/2026-W02|W02 ›]]\n");
  mount(w, "2026/2026-W01.md", w01.element);
  const prev = w01.rail.querySelector('[data-rail="prev"]');
  assert.equal(prev.getAttribute("data-state"), "ghost");
  assert.equal(prev.getAttribute("href"), null);
  assert.equal(prev.getAttribute("aria-disabled"), "true");
  prev.fire("click");
  arm(w01.element, "prev").fire("click");
  await flush();
  assert.deepEqual(w.notices, [
    "2025-W52 is before Bob's period notes began — navigation never creates it",
    "2025-W40 is before Bob's period notes began — navigation never creates it",
  ]);
  assert.deepEqual(w.opened, []);
  assert.deepEqual(w.commandsRun, []);
  assert.deepEqual(w.ensures, []);
});

test("a creatable period chip is created through periodNotesEnsureForPath, then opened; refusals surface", async () => {
  const w = world();
  const kids = Array.from({ length: 14 }, (_, i) => `[[2026/2026-W${40 + i}|W${40 + i}]]`).join(" · ");
  const q4 = card(w, "2026/2026-Q4.md", `# 2026-Q4 · W40–W53 · Sep 28, 2026 – Jan 3, 2027\n\n[[2026/2026-Q3|‹ Q3]] · [[2026|↑ 2026]] · [[2027/2027-Q1|2027-Q1 ›]]\n\n${kids}\n`);
  const chips = q4.rail.querySelectorAll(".bob-property-card-rail-chip");
  const w49 = chips.find((chip) => chip.getAttribute("data-href") === "2026/2026-W49");
  assert.equal(w49.getAttribute("data-state"), "creatable");
  assert.equal(text(w49.querySelector(".bob-property-card-rail-plus")), "+");
  w49.fire("click");
  await flush();
  assert.deepEqual(w.ensures, ["2026/2026-W49.md"]);
  assert.deepEqual(w.opened.map((args) => args[0]), ["2026/2026-W49"]);

  w.plugin.ensureResult = { ok: false, code: "not-adopted", message: "Period notes are not adopted yet." };
  w49.fire("click");
  await flush();
  assert.deepEqual(w.notices, ["Period notes are not adopted yet."]);
  assert.equal(w.opened.length, 1, "a refusal opens nothing");

  const existing = chips.find((chip) => chip.getAttribute("data-href") === "2026/2026-W41");
  assert.equal(existing.getAttribute("data-state"), null);
  existing.fire("click");
  await flush();
  assert.equal(w.ensures.length, 2, "existing chips never ensure");
  assert.equal(w.opened.at(-1)[0], "2026/2026-W41");
});

test("unmodified step items run the step commands in the card's leaf", async () => {
  const w = world();
  const sat = card(w, "2026/20261121.md", "Notes.\n");
  const leaf = mount(w, "2026/20261121.md", sat.element);
  sat.rail.querySelector('[data-rail="next"]').fire("click");
  await flush();
  assert.deepEqual(w.commandsRun, ["bob-navigation-hotkeys:open-next-link"]);
  assert.equal(w.app.workspace.active.leaf, leaf);
  assert.deepEqual(w.ensures, []);
});

test("a plain click on a group arm re-validates, then runs the group command in the card's leaf", async () => {
  const w = world();
  const sat = card(w, "2026/20261121.md");
  const leaf = mount(w, "2026/20261121.md", sat.element);
  const before = w.walkMode.calls;
  arm(sat.element, "next").fire("click");
  await flush();
  assert.ok(w.walkMode.calls > before, "the stop is asked again");
  assert.deepEqual(w.commandsRun, ["bob-navigation-hotkeys:open-next-group-link"]);
  assert.equal(w.app.workspace.active.leaf, leaf);
  assert.deepEqual(w.app.workspace.active.options, { focus: true });
  assert.deepEqual(w.notices, []);

  // A modified click on an existing arm opens it like a Markdown link.
  arm(sat.element, "prev").fire("click", { ctrlKey: true });
  await flush();
  assert.deepEqual(w.opened, [["2026/20261109", "2026/20261121.md", "tab"]]);
  assert.equal(w.commandsRun.length, 1);
});

test("a changed group stop refuses, repaints, and runs nothing", async () => {
  const w = world();
  const sat = card(w, "2026/20261121.md");
  mount(w, "2026/20261121.md", sat.element);
  w.add("2026/20261123.md");
  const before = w.refreshes.count;
  arm(sat.element, "next").fire("click");
  await flush();
  assert.deepEqual(w.notices, [H.INTENTION_CARD_GROUP_CHANGED]);
  assert.equal(H.INTENTION_CARD_GROUP_CHANGED, "The group stop changed — try again");
  assert.deepEqual(w.commandsRun, []);
  assert.deepEqual(w.opened, []);
  assert.ok(w.refreshes.count > before, "a repaint is scheduled");
});

test("without Navigation Hotkeys an existing arm opens through the card's opener and a creatable one explains", async () => {
  const w = world({ nav: "navGroups" });
  const sat = card(w, "2026/20261121.md");
  mount(w, "2026/20261121.md", sat.element);
  arm(sat.element, "prev").fire("click");
  arm(sat.element, "next").fire("click");
  await flush();
  assert.deepEqual(w.opened.map((args) => args[0]), ["2026/20261109"]);
  assert.deepEqual(w.notices, ["Mon Nov 23 isn't created yet — Bob Navigation Hotkeys creates it with ]N"]);
  assert.deepEqual(w.commandsRun, []);
});

// ---- Repaint ----------------------------------------------------------------------

test("vault create, delete, and rename of calendar notes repaint; the signature tracks existence", () => {
  const w = world();
  assert.equal(typeof w.vaultEvents.create, "function", "listeners registered at setup");
  assert.equal(typeof w.vaultEvents.delete, "function");
  assert.equal(typeof w.vaultEvents.rename, "function");
  const before = prepare(w, "2026/20261121.md");
  w.add("2026/20261123.md");
  let count = w.refreshes.count;
  w.vaultEvents.create({ path: "2026/20261123.md" });
  assert.equal(w.refreshes.count, count + 1, "a calendar create schedules a refresh");
  const after = prepare(w, "2026/20261121.md");
  assert.notEqual(after.signature, before.signature, "the next arm's state changed the signature");
  assert.equal(after.navRail.nextGroup.state, "exists");

  count = w.refreshes.count;
  w.vaultEvents.create({ path: "notes/other.md" });
  assert.equal(w.refreshes.count, count, "other notes never repaint cards");
  w.vaultEvents.rename({ path: "notes/elsewhere.md" }, "2026/2026-W48.md");
  assert.equal(w.refreshes.count, count + 1, "a rename away from a calendar path repaints");
  w.vaultEvents.delete({ path: "2026/2026-W47.md" });
  assert.equal(w.refreshes.count, count + 2);

  // The midnight rollover: a new today moves the current group member.
  const today = prepare(w, "2026/20261121.md").signature;
  w.plugin.navGroupsTodayOverride = "2026-11-22";
  w.plugin.intentionCardToday = () => "2026-11-22";
  assert.notEqual(prepare(w, "2026/20261121.md").signature, today);
});

test("the nav answer never throws and a broken walkMode keeps today's rail", () => {
  const w = world({ patch: () => { throw new Error("boom"); } });
  const week = card(w, "2026/2026-W47.md", `# 2026-W47 · Nov 16 – 22\n\n${WEEK_NAV(47)}\n`);
  assert.equal(week.model.navRail, null);
  assert.ok(week.rail.querySelector('[data-rail="prev"]'));
  assert.equal(week.rail.querySelector(".bob-property-card-group-row"), null);
  assert.equal(H.intentionCardNavRailModel(null, {}), null);
  assert.equal(H.intentionCardGroupRowSpec(null), null);
  assert.equal(H.intentionCardNavRailSignature(null), null);
});
