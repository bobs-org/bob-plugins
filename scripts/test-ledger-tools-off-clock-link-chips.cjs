// Off-clock link chip vectors from bob-cli's docs/off-clock-link-chips.md.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const {
  clockEnvFor: vectorClockEnv,
  planCapsForVector,
} = require("./pomodoro-clock-vector-helpers.cjs");

const editorInfoField = { chipField: "info" };
const editorLivePreviewField = { chipField: "live" };
class StubWidgetType {}
class StubRangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const StubDecoration = {
  none: { none: true },
  widget: (spec) => ({ ...spec, widgetDecoration: true }),
};
const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};
const StubViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
class FakeRenderChild { constructor(container) { this.container = container; } }
class FakePlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.editorExtensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, sortOrder) { (this.postProcessors ||= []).push({ handler, sortOrder }); }
  registerEvent(event) { (this.registeredEvents ||= []).push(event); }
  register(callback) { (this.cleanups ||= []).push(callback); }
}
const originalLoad = Module._load;
Module._load = function loadWithChipStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: FakeRenderChild,
    Notice: class {},
    Plugin: FakePlugin,
    normalizePath: (value) => value,
    parseYaml: () => ({}),
    editorInfoField,
    editorLivePreviewField,
  };
  if (request === "@codemirror/state") return {
    Prec: { highest: (value) => value },
    StateEffect: StubStateEffect,
    RangeSetBuilder: StubRangeSetBuilder,
  };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } },
    keymap: { of: (value) => value },
    ViewPlugin: StubViewPlugin,
    Decoration: StubDecoration,
    WidgetType: StubWidgetType,
  };
  if (request === "@codemirror/language") return { syntaxTree: () => ({ resolveInner: () => null }) };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const h = LedgerToolsPlugin.helpers;
const ROOT = path.join(__dirname, "..");
const DAILY = "2026/20261103.md";
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/scripts/fixtures/pomodoro_clock/vectors.json"), "utf8"));

function markdown(lines) { return ["## Pomodoros", ...lines].join("\n"); }

test("OC: only exact ledger Task Link rows in canonical daily Pomodoros qualify", () => {
  const lines = [
    "---", "title: ignored", "---", "## Pomodoros",
    "- [ ] () — LUNCH", "  - [[love#^lunch]]",
    "- [x] (**1200-1300** [off:: 60m]) — CLOSED", "  - [[love#^lunch]]",
    "- [ ] () — MARKED", "  - 🍅 [[love#^lunch]]",
    "- [ ] () — DEFERRED", "  - [[love#^lunch]] #",
    "- [ ] () — STRUCK", "  - ~~[[love#^lunch]]~~",
    "- [ ] () — ALIASED", "  - [[love#^lunch|Lunch]]",
    "- [ ] () — EMBED", "  - ![[love#^lunch]]",
    "- [ ] () — PROSE", "  - lunch with [[love#^lunch]]",
    "- [ ] () — DEEP", "  - details", "    - [[love#^lunch]]",
    "```md", "- [ ] () — FENCED", "  - [[love#^lunch]]", "```",
    "%%", "- [ ] () — COMMENT", "  - [[love#^lunch]]", "%%",
    "## Notes", "- [[love#^lunch]]",
  ];
  const links = h.offClockLinkChipLinks(lines, DAILY);
  assert.deepEqual(links.map((link) => [link.pathPart, link.blockId, link.entryOpen]), [
    ["love", "lunch", true], ["love", "lunch", false], ["love", "lunch", true],
    ["love", "lunch", true], ["love", "lunch", true], ["love", "lunch", true],
  ]);
  assert.equal(links[3].ch, lines[11].indexOf(" #")); // OC4, before the move marker.
  assert.equal(links[4].ch, lines[13].lastIndexOf("~~") + 2); // OC5, after the closing strike.
  assert.equal(h.offClockLinkChipLinks(lines, "Notes/ordinary.md").length, 0); // OC13.
  assert.equal(h.offClockLinkChipLinks(lines, DAILY, { openOnly: true }).some((link) => !link.entryOpen), false);
});

test("OC10 and OC15: history is included and toggle-off is a CSS and JavaScript gate", () => {
  const lines = ["## Pomodoros", "- [x] (**1200-1300** [off:: 60m]) — LUNCH", "  - [[love#^lunch]]"];
  assert.equal(h.offClockLinkChipLinks(lines, "2026/20261102.md").length, 1);
  assert.match(fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/styles.css"), "utf8"), /body:not\(\.bob-off-clock-link-chips\) \.bob-off-clock-link-chip \{\s*display: none;/);
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.offClockLinkChipsEnabled = false;
  const doc = { toString: () => markdown(["- [ ] () — LUNCH", "  - [[love#^lunch]]"]), line: () => ({ from: 0 }) };
  plugin.app = { workspace: { getActiveFile: () => ({ path: DAILY }) } };
  assert.equal(plugin.buildOffClockLinkChipDecorations({ state: { field: () => true, doc } }), StubDecoration.none);
});

function clockEnvFor(notes, daily) {
  return vectorClockEnv(notes, DAILY, daily);
}
function vectorClockResolver(vector, env) {
  const caps = planCapsForVector(vector, h.defaultPlanCaps());
  return (link, line) => {
    const file = link && link.pathPart ? env.resolve(link.pathPart) : env.files.get(DAILY);
    return file ? h.taskEffectiveClockResolution(file.path, line, env.metadataCache, env.vault, caps) : null;
  };
}
function vectorTaskResolver(vector) {
  return (link) => {
    const source = (vector.notes || {})[`${link.pathPart}.md`];
    if (typeof source !== "string") return null;
    return source.split("\n").find((line) => new RegExp(`(?:^|\\s)\\^${link.blockId}\\s*$`).test(line)) || null;
  };
}

const OV_EXCLUDED = {
  "meet-run-ignores-future-off-clock-queue": "MEET event-run semantics are owned by the event-run contract.",
  "close-defers-not-started-off-clock": "Close gestures are tested by task-status-cycler.",
  "close-mixed-after-dropping-on-clock": "Close gestures are tested by task-status-cycler.",
  "bare-row-restamped-at-close": "Close gestures are tested by task-status-cycler.",
  "conflict-row-at-close": "Close gestures are tested by task-status-cycler.",
  "kept-ledger-swap-switches-key": "The =walk token adds or swaps links before the verdict.",
  "running-link-restamps": "The ^bob:walk token adds a link before the verdict.",
};
for (const vector of fixture.cases) {
  if (OV_EXCLUDED[vector.id]) {
    test(`OV excluded: ${vector.id}`, () => assert.match(OV_EXCLUDED[vector.id], /MEET|Close|adds|swaps/));
    continue;
  }
  test(`OV parity with the se<X> writer: ${vector.id}`, () => {
    const lines = String(vector.day || "").split("\n");
    const start = lines.findIndex((line) => /^## Pomodoros\s*$/.test(line));
    const entry = lines.findIndex((line, index) => index > start && /^- \[[ xX-]\]/.test(line));
    assert.ok(entry >= 0, `${vector.id}: expected a ledger entry`);
    const links = h.pomodoroClockCountedLinks(lines, entry);
    const env = clockEnvFor(vector.notes, vector.day);
    const facts = h.pomodoroClockLinkFacts(lines, links, vectorTaskResolver(vector), vectorClockResolver(vector, env));
    const verdict = h.clockVerdict(facts);
    assert.equal(verdict.kind === "off-clock", vector.expected_off_clock, vector.id);
    for (const fact of facts) assert.equal(Boolean(h.offClockLinkChipModel(fact)), fact.offClock === true, vector.id);
  });
}
test("OV exclusions account for every vector omitted from link-level parity", () => {
  for (const id of Object.keys(OV_EXCLUDED)) assert.ok(fixture.cases.some((vector) => vector.id === id), id);
});

test("OR/OT: target line facts select tagged and inherited clocks with canonical tooltip text", () => {
  const notes = {
    "love.md": "---\ntype: [[area]]\noffclock: true\n---\n- [ ] #task Lunch ^lunch",
    "abby.md": "---\ntype: [[area]]\nparent: [[love]]\n---\n- [ ] #task Pickup ^pickup",
    "fun.md": "---\ntype: [[area]]\nparent: [[love]]\noffclock: false\n---\n- [ ] #task Park ^park",
    "bob.md": "---\ntype: [[project]]\n---\n- [ ] #task Walk #OFFCLOCK ^walk",
  };
  const day = ["## Events", "- [ ] #task **1200-1230** Pickup #off ^evt", "", "## Tasks", "- [ ] #task Task #off ^tag", "", "## Pomodoros"].join("\n");
  const env = clockEnvFor(notes, day);
  const resolveClock = vectorClockResolver({ notes, day }, env);
  const fact = (pathPart, blockId, sourceText) => {
    const lines = sourceText.split("\n");
    return h.pomodoroClockLinkFacts(lines, [{ pathPart, blockId, token: `[[${pathPart}#^${blockId}]]` }], (link) => {
      const file = env.resolve(link.pathPart);
      if (!file) return null;
      return (env.sources.get(file.path) || "").split("\n").find((line) => line.endsWith(`^${blockId}`)) || null;
    }, resolveClock)[0];
  };
  const alias = fact("bob", "walk", day);
  const aliasModel = h.offClockLinkChipModel({ ...alias, blockId: "walk" });
  assert.equal(aliasModel.source, "off_tag");
  assert.equal(aliasModel.text, "off");
  assert.equal(aliasModel.tooltip, "Off-clock · tagged #OFFCLOCK");
  const inherited = fact("abby", "pickup", day);
  const inheritedModel = h.offClockLinkChipModel({ ...inherited, blockId: "pickup" });
  assert.equal(inheritedModel.source, "note");
  assert.equal(inheritedModel.tooltip, "Off-clock · from love");
  assert.equal(h.offClockLinkChipModel({ ...fact("fun", "park", day), blockId: "park" }), null);
  const event = h.pomodoroClockLinkFacts(day.split("\n"), [{ pathPart: "", blockId: "evt", token: "[[#^evt]]" }], null, resolveClock)[0];
  assert.equal(h.offClockLinkChipModel({ ...event, blockId: "evt" }).tooltip, "Off-clock · tagged #off");
  assert.equal(h.offClockLinkChipTooltip({ source: "note", notePath: "a::b.md" }), "Off-clock · from a:b");
  assert.equal(h.offClockLinkChipModel({ offClock: null }), null);
  assert.equal(h.eventTaskClockTag("- [ ] #task `#off` ^walk").offClock, false);
  assert.equal(h.offClockLinkChipModel({ offClock: false, source: "default", lineText: "- [ ] #task `#off` ^walk" }), null);
});

class FakeNode {
  constructor(tagName, doc) {
    this.nodeType = 1; this.tagName = tagName.toUpperCase(); this.nodeName = this.tagName;
    this.ownerDocument = doc || this; this.parentNode = null; this.childNodes = [];
    this.attributes = {}; this.textContent = ""; this.style = {};
    this.classList = { contains: (name) => this.className.split(/\s+/).includes(name), add: (name) => { this.className = `${this.className} ${name}`.trim(); } };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "class") this.className = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(node); else this.childNodes.splice(index, 0, node);
    node.parentNode = this; this.relink(); return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; this.relink(); return node; }
  relink() { this.childNodes.forEach((child, index) => { child.previousSibling = this.childNodes[index - 1] || null; child.nextSibling = this.childNodes[index + 1] || null; }); }
  addEventListener(name, handler) { (this.listeners ||= {})[name] = handler; }
  querySelectorAll(selector) {
    const results = []; const classes = selector.split(",").map((item) => item.trim());
    const visit = (node) => { for (const child of node.childNodes || []) { const cls = String(child.className || "").split(/\s+/); if (classes.some((s) => s === "li" ? child.tagName === "LI" : s === "a.internal-link" ? child.tagName === "A" && cls.includes("internal-link") : s.startsWith(".") && cls.includes(s.slice(1))) || classes.includes(child.tagName.toLowerCase())) results.push(child); visit(child); } };
    visit(this); return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
}
class FakeDocument {
  createElement(tag) { return new FakeNode(tag, this); }
  createTextNode(text) { const node = new FakeNode("#text", this); node.nodeType = 3; node.nodeValue = text; return node; }
}

test("OT and OP3: builder uses one listener-free accessible host with no title", () => {
  const doc = new FakeDocument();
  const host = h.buildOffClockLinkChipElement(doc, { tooltip: "Off-clock · from love", source: "note", blockId: "lunch" });
  assert.equal(host.tagName, "SPAN");
  assert.equal(host.className, "bob-off-clock-link-chip");
  assert.equal(host.getAttribute("role"), "img");
  assert.equal(host.getAttribute("aria-label"), "Off-clock · from love");
  assert.equal(host.getAttribute("data-tooltip-position"), "top");
  assert.equal(host.getAttribute("data-clock-source"), "note");
  assert.equal(host.getAttribute("data-block-id"), "lunch");
  assert.equal(host.textContent, "off");
  assert.equal(host.getAttribute("title"), null);
  assert.equal(host.listeners, undefined);
});

test("OP1, OP2, and OP4: widget placement is side 4, after other chips, and selection-only updates do not rebuild", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.offClockLinkChipsEnabled = true;
  plugin.app = { workspace: { openLinkText() {} } };
  plugin.offClockLinkChipFactModel = (_lines, link) => ({ text: "off", source: "note", notePath: "love.md", spelling: null, tooltip: "Off-clock · from love", blockId: link.blockId });
  const text = markdown(["- [ ] () — LUNCH", "  - [[love#^lunch]]"]);
  const rowFrom = text.indexOf("  - [[");
  const doc = {
    toString: () => text,
    line(number) {
      const rows = text.split("\n"); let from = 0;
      for (let i = 1; i < number; i++) from += rows[i - 1].length + 1;
      return { from, text: rows[number - 1] };
    },
  };
  const state = { doc, field: (field) => field === editorLivePreviewField ? true : { file: { path: DAILY } } };
  const decorations = plugin.buildOffClockLinkChipDecorations({ state, visibleRanges: [{ from: 0, to: text.length }] });
  assert.equal(decorations.adds.length, 1);
  assert.equal(decorations.adds[0].from, rowFrom + text.split("\n")[2].indexOf("]]" ) + 2);
  assert.equal(decorations.adds[0].value.side, 4); // OP1: ⏭ took side 3, so the off chip moved to side 4.
  assert.equal(plugin.offClockLinkChipsShouldRebuild({ selectionSet: true, transactions: [] }), false);
  assert.equal(plugin.offClockLinkChipsShouldRebuild({ docChanged: true }), true);
  const el = new FakeDocument().createElement("span");
  const order = new FakeNode("DIV");
  const anchor = new FakeNode("A"); anchor.setAttribute("class", "internal-link"); order.appendChild(anchor);
  const glyph = new FakeNode("SPAN"); glyph.setAttribute("class", "bob-unblocked-glyph"); order.appendChild(glyph);
  const frees = new FakeNode("SPAN"); frees.setAttribute("class", "bob-frees-mark"); order.appendChild(frees);
  const chip = el; chip.setAttribute("class", "bob-off-clock-link-chip"); order.appendChild(chip);
  assert.equal(plugin.offClockLinkChipReadingInsertAfter(anchor), frees);
  assert.deepEqual(order.childNodes.map((node) => node.className), ["internal-link", "bob-unblocked-glyph", "bob-frees-mark", "bob-off-clock-link-chip"]);
});

test("OP1/interaction: plain mousedown restores the caret; Mod-click opens the task", () => {
  const widget = new h.OffClockLinkChipWidget({ source: "note", tooltip: "Off-clock · from love", blockId: "lunch" }, DAILY, "love#^lunch", { openLinkText() { opened.push(["love#^lunch", DAILY, "tab"]); } });
  const opened = [];
  const oldDocument = global.document;
  const doc = new FakeDocument(); global.document = doc;
  try {
    const view = { posAtDOM: () => 42, dispatch: (value) => { view.selection = value.selection; }, focus: () => { view.focused = true; } };
    const host = widget.toDOM(view);
    let prevented = false;
    host.listeners.mousedown({ button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(view.selection.anchor, 42); assert.equal(view.focused, true);
    host.listeners.mousedown({ button: 0, ctrlKey: true, preventDefault() {} });
    assert.deepEqual(opened, [["love#^lunch", DAILY, "tab"]]);
  } finally { global.document = oldDocument; }
});

test("writer delegation and metadata-cache freshness preserve path-aware resolution", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const active = { path: DAILY };
  plugin.app = { workspace: { getActiveFile: () => active } };
  plugin.pomodoroClockResolveTaskLineFrom = (link, sourcePath) => `${sourcePath}:${link.blockId}`;
  plugin.pomodoroClockResolveLinkClockFrom = (link, line, sourcePath) => ({ link, line, sourcePath });
  assert.equal(plugin.pomodoroClockResolveTaskLine({ blockId: "a" }), `${DAILY}:a`);
  assert.deepEqual(plugin.pomodoroClockResolveLinkClock({ blockId: "a" }, "- [ ] task"), { link: { blockId: "a" }, line: "- [ ] task", sourcePath: DAILY });
  const cache = new Map([["love.md", "old"]]); let refreshes = 0;
  plugin.taskThemeSourceCacheStore = () => cache;
  plugin.taskThemeRememberSourceText = (pathName, text) => { cache.set(pathName, text); return true; };
  plugin.scheduleOffClockLinkChipsRefresh = () => { refreshes += 1; };
  plugin.offClockLinkChipsSourceChanged({ path: "love.md" }, "fresh");
  assert.equal(cache.get("love.md"), "fresh");
  plugin.offClockLinkChipsSourceChanged({ path: "new.md" }, "not cached");
  assert.equal(cache.has("new.md"), false);
  assert.equal(refreshes, 2);
});

test("toggle refreshes both surfaces and the Reading context allow-list recognizes the chip", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.offClockLinkChipsEnabled = true;
  let gate; let editors = 0; let reading = 0;
  plugin.applyMarkGateClass = (name, enabled) => { gate = [name, enabled]; };
  plugin.refreshOffClockLinkChipsEditors = () => { editors += 1; };
  plugin.refreshOffClockLinkChipsReadingViews = () => { reading += 1; };
  assert.equal(plugin.toggleOffClockLinkChips(), false);
  assert.deepEqual(gate, ["bob-off-clock-link-chips", false]);
  assert.equal(editors, 1); assert.equal(reading, 1);
  const source = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/src/269-plugin-progress-marks-reading.js"), "utf8");
  assert.match(source, /"bob-off-clock-link-chip"/);
});

test("setup registers the default-on command, Live Preview extension, Reading processor, and source listeners", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    metadataCache: { on: (event, callback) => ({ event, callback }) },
    vault: { on: (event, callback) => ({ event, callback }) },
    workspace: { on: (event, callback) => ({ event, callback }) },
  };
  plugin.commands = []; plugin.editorExtensions = []; plugin.postProcessors = []; plugin.registeredEvents = []; plugin.cleanups = [];
  plugin.addCommand = (command) => plugin.commands.push(command);
  plugin.registerEditorExtension = (extension) => plugin.editorExtensions.push(extension);
  plugin.registerMarkdownPostProcessor = (handler, sortOrder) => plugin.postProcessors.push({ handler, sortOrder });
  plugin.registerEvent = (event) => plugin.registeredEvents.push(event);
  plugin.register = (callback) => plugin.cleanups.push(callback);
  plugin.applyMarkGateClass = (name, enabled) => { plugin.gate = [name, enabled]; };
  plugin.registerMarkGatePopoutSync = (name) => { plugin.popoutGate = name; };
  plugin.setupOffClockLinkChips();
  assert.equal(plugin.offClockLinkChipsEnabled, true);
  assert.deepEqual(plugin.gate, ["bob-off-clock-link-chips", true]);
  assert.equal(plugin.popoutGate, "bob-off-clock-link-chips");
  assert.equal(plugin.commands[0].id, "toggle-off-clock-link-chips");
  assert.equal(plugin.commands[0].name, "Toggle Task Link off-clock chips");
  assert.equal(plugin.editorExtensions.length, 1);
  assert.equal(plugin.postProcessors[0].sortOrder, 61);
  assert.ok(plugin.registeredEvents.some((event) => event.event === "resolved"));
  assert.ok(plugin.registeredEvents.some((event) => event.event === "rename"));
});

test("200-link / 50-target Live Preview build memoizes targets and stays near the 25 ms budget", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.offClockLinkChipsEnabled = true;
  const source = ["## Pomodoros", "- [ ] () — BUILD"];
  for (let index = 0; index < 200; index += 1) source.push(`  - [[note${index % 50}#^task${index % 50}]]`);
  const text = source.join("\n");
  let taskReads = 0;
  let clockReads = 0;
  plugin.pomodoroClockResolveTaskLineFrom = () => { taskReads += 1; return "- [ ] #task Work ^task"; };
  plugin.pomodoroClockResolveLinkClockFrom = () => { clockReads += 1; return { offClock: true, source: "note", note: "love.md" }; };
  const doc = {
    toString: () => text,
    line(number) { let from = 0; const rows = text.split("\n"); for (let i = 1; i < number; i++) from += rows[i - 1].length + 1; return { from }; },
  };
  const state = { doc, field: (field) => field === editorLivePreviewField ? true : { file: { path: DAILY } } };
  const start = performance.now();
  const decorations = plugin.buildOffClockLinkChipDecorations({ state, visibleRanges: [{ from: 0, to: text.length }] });
  const elapsed = performance.now() - start;
  assert.equal(decorations.adds.length, 200);
  assert.equal(taskReads, 50);
  assert.equal(clockReads, 50);
  assert.ok(elapsed < 35, `200-link build took ${elapsed.toFixed(1)} ms`);
});

test("Reading sweep handles closed daily ledger rows and reconciles the chip after its anchor", () => {
  const doc = new FakeDocument();
  const root = doc.createElement("DIV");
  const heading = doc.createElement("H2"); heading.textContent = "Pomodoros"; root.appendChild(heading);
  const top = doc.createElement("UL"); root.appendChild(top);
  const entry = doc.createElement("LI"); entry.setAttribute("data-task", "x"); top.appendChild(entry);
  const childList = doc.createElement("UL"); entry.appendChild(childList);
  const row = doc.createElement("LI"); childList.appendChild(row);
  const anchor = doc.createElement("A"); anchor.setAttribute("class", "internal-link"); anchor.setAttribute("data-href", "love#^lunch"); row.appendChild(anchor);
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.offClockLinkChipsEnabled = true;
  plugin.taskThemeSourceTextFor = () => "## Pomodoros\n- [x] (**1200-1300** [off:: 60m]) — LUNCH\n  - [[love#^lunch]]";
  plugin.taskThemeRequestSourceText = () => false;
  plugin.offClockLinkChipFactModel = (_lines, link) => link.blockId === "lunch" ? { text: "off", source: "note", notePath: "love.md", spelling: null, tooltip: "Off-clock · from love", blockId: "lunch" } : null;
  plugin.sweepOffClockLinkChipsReadingView({ el: root, sourcePath: "2026/20261102.md" });
  const hosts = root.querySelectorAll(".bob-off-clock-link-chip");
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].previousSibling, anchor);
  assert.equal(hosts[0].getAttribute("data-tooltip-position"), "top");
  assert.equal(hosts[0].getAttribute("aria-label"), "Off-clock · from love");
});

test("Event Task CSS keeps one shared chip appearance while link chips are independent", () => {
  const css = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /\.bob-calendar-events \.bob-calendar-event-off-clock,[\s\S]*?\.bob-off-clock-link-chip\s*\{/);
  assert.match(css, /body\s*\{\s*\/\* Lucide timer-off[\s\S]*?--bob-off-clock-icon:/);
  assert.match(css, /\.bob-off-clock-link-chip::before[\s\S]*?mask: var\(--bob-off-clock-icon\)/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.bob-off-clock-link-chip\s*\{\s*outline-style: dashed/);
});
