// Event link time vectors for bob-cli-gg.2. Every EL (which links), ES
// (state), ER (resolution and parity), ET (tooltip), and EP (placement)
// contract row from bob-cli `docs/event-link-times.md` is cited below so
// the pure core and both rendered surfaces stay aligned. Computed-style
// parity (EP6) needs real Obsidian and is covered by phase `live_verify`.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const RealDate = Date;
const FROZEN_NOW = new RealDate(2026, 10, 3, 10, 0, 0);
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(FROZEN_NOW.getTime());
    } else {
      super(...args);
    }
  }

  static now() {
    return FROZEN_NOW.getTime();
  }
}
global.Date = FrozenDate;

const TODAY_PATH = "2026/20261103.md";
const INFO_FIELD = { eventLinkTimesField: "info" };
const LIVE_FIELD = { eventLinkTimesField: "live" };
let capturedViewPluginClass = null;

class StubWidgetType {}

class StubRangeSetBuilder {
  constructor() {
    this.adds = [];
  }

  add(from, to, value) {
    this.adds.push({ from, to, value });
  }

  finish() {
    return { adds: this.adds.slice() };
  }
}

const StubDecoration = {
  none: { none: true },
  mark: (spec) => ({ ...spec, markDecoration: true }),
  replace: (spec) => ({ ...spec, replaceDecoration: true }),
  line: (spec) => ({ ...spec, lineDecoration: true }),
  widget: (spec) => ({ ...spec, widgetDecoration: true }),
};

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};

const StubViewPlugin = {
  fromClass(cls, options) {
    capturedViewPluginClass = cls;
    return { cls, options };
  },
};

class TestMarkdownView {}
class TestRenderChild {
  constructor(container) {
    this.container = container;
  }
}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerMarkdownPostProcessor(handler, sortOrder) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push({ handler, sortOrder });
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
    return ref;
  }

  register(callback) {
    this.cleanups = this.cleanups || [];
    this.cleanups.push(callback);
  }

  registerInterval(ref) {
    this.intervals = this.intervals || [];
    this.intervals.push(ref);
    return ref;
  }

  registerDomEvent() {
    return {};
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithEventLinkTimeStubs(request) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: TestRenderChild,
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (value) => JSON.parse(value),
      editorInfoField: INFO_FIELD,
      editorLivePreviewField: LIVE_FIELD,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      RangeSetBuilder: StubRangeSetBuilder,
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => listener } },
      keymap: { of: (value) => value },
      ViewPlugin: StubViewPlugin,
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
};

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
delete require.cache[MAIN_PATH];
const LedgerToolsPlugin = require(MAIN_PATH);
Module._load = originalLoad;
const {
  ensureEventLinkTimesRefresh,
  eventLinkTimeIsSameNote,
  eventLinkTimeLinks,
  eventLinkTimeCutTitle,
  eventLinkTimeTooltip,
  eventLinkTimeModel,
  buildEventLinkTimeElement,
  EventLinkTimeWidget,
  EVENT_LINK_TIME_SIDE,
  eventRunEventRows,
  eventRunById,
  gcalEventsTimeState,
  gcalEventsBufferPhase,
  gcalEventsTimeAttributes,
  gcalEventsWingModel,
  buildCalendarEventBufferWing,
  todayDailyPath,
} = LedgerToolsPlugin.helpers;

// The contract fixture: today is 2026-11-03, now is 10:00, frozen above.
const EVENT_LINES = [
  "- [x] #task **0815-0830** Swings! #off [root:: abby] [type:: MEET] ^swings",
  "- [ ] #task **0945-1015** Standup [root:: bob] [type:: MEET] ^standup",
  "- [*] #task **1830-1900** (virtual) CFG Appt #off [buffer:: -30m] [root:: body] [type:: MEET] ^cfg",
  "- [ ] **1200-1230** Park [root:: abby] ^park",
  "- **all day** Holiday ^holiday",
  "- [ ] #task **1000-1030** Dup one ^dup",
  "- [ ] #task **1100-1130** Dup two ^dup",
];

function contractNote() {
  return [
    "^gtd",
    "## Events",
    ...EVENT_LINES,
    "## Pomodoros",
    "- [ ] () — MEET",
    "\t- [[#^cfg]]",
    "- [x] (**0815-0830** [off:: 15m]) — MEET",
    "\t- ~~[[#^swings]]~~",
    "- [ ] () — MEET",
    "\t- 🍅 [[#^standup]]",
    "\t- [[#^standup]] #",
    "\t- [[#^standup|Standup]]",
    "\t- [[2026/20261103#^standup]]",
    "\t- [[#^park]]",
    "\t- ![[#^standup]]",
    "\t- join [[#^standup]] early",
    "\t\t- [[#^standup]]",
    "\t- [[bob#^parser]]",
    "\t- [[#^gtd]]",
    "\t- [[#^holiday]]",
    "\t- [[#^dup]]",
    "\t- [[2026/20261102#^swings]]",
    "## Notes",
    "see [[#^standup]]",
  ];
}

function clockEnvFor(notes) {
  const sources = new Map(Object.entries(notes || {}));
  const files = new Map([...sources.keys()].map((notePath) => [notePath, { path: notePath }]));
  const resolve = (target) => {
    const name = String(target || "").replace(/\.md$/i, "");
    const exact = name.indexOf("/") === -1 ? name + ".md" : `${name}.md`;
    if (files.has(exact)) return files.get(exact);
    if (files.has(name)) return files.get(name);
    const basename = name.split("/").pop().toLowerCase();
    return [...files.values()].find((file) =>
      file.path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === basename
    ) || null;
  };
  const vault = { getAbstractFileByPath: (notePath) => files.get(notePath) || null };
  const metadataCache = {
    on: () => ({}),
    getFileCache: (file) => {
      const source = sources.get(file.path) || "";
      const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(source);
      const frontmatter = {};
      if (match) {
        for (const line of match[1].split("\n")) {
          const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
          if (!field) continue;
          let value = field[2].trim();
          if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          } else if (value.toLowerCase() === "true") {
            value = true;
          } else if (value.toLowerCase() === "false") {
            value = false;
          }
          frontmatter[field[1]] = value;
        }
      }
      return { frontmatter };
    },
    getFirstLinkpathDest: (target) => resolve(target),
  };
  return { vault, metadataCache };
}

function contractClockEnv() {
  return clockEnvFor({
    "love.md": "---\ntype: [[area]]\noffclock: true\n---\n",
    "abby.md": "---\ntype: [[area]]\nparent: [[love]]\n---\n",
    "bob.md": "---\ntype: [[project]]\n---\n",
    "body.md": "---\ntype: [[area]]\n---\n",
    "2026/20261103.md": "",
    "2026/20261102.md": "",
  });
}

function makeApp(env) {
  const clock = env || contractClockEnv();
  const handlers = {};
  return {
    handlers,
    vault: clock.vault,
    workspace: {
      getLeavesOfType: () => [],
      openLinkText: () => {},
      on: (name, callback) => {
        handlers[name] = handlers[name] || [];
        handlers[name].push(callback);
        return {};
      },
    },
    metadataCache: clock.metadataCache,
  };
}

function makePlugin(env) {
  const app = makeApp(env);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.eventLinkTimesEnabled = true;
  plugin.calendarEventsPaintEnabled = false;
  plugin.currentTodayDailyPath = () => TODAY_PATH;
  return { plugin, app };
}

function makeDoc(text) {
  const lines = String(text).split("\n");
  let offset = 0;
  const rows = lines.map((row, index) => {
    const entry = { from: offset, to: offset + row.length, number: index + 1, text: row };
    offset += row.length + 1;
    return entry;
  });
  return {
    length: Math.max(0, offset - 1),
    toString: () => String(text),
    line: (number) => rows[number - 1],
  };
}

function makeView(text, filePath) {
  const doc = makeDoc(text);
  return {
    state: {
      doc,
      field: (field) => {
        if (field === LIVE_FIELD) return true;
        if (field === INFO_FIELD) return { file: { path: filePath } };
        return null;
      },
    },
    visibleRanges: [{ from: 0, to: doc.length }],
  };
}

class DomNode {
  constructor(tagName, className = "", ownerDocument = null, nodeType = 1) {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = nodeType;
    this.className = className;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this._text = "";
    this.isConnected = true;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const at = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[at + 1] || null;
  }

  get previousSibling() {
    if (!this.parentNode) return null;
    const at = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[at - 1] || null;
  }

  get textContent() {
    return this._text + this.childNodes.map((node) => node.textContent || node.nodeValue || "").join("");
  }

  set textContent(value) {
    this.childNodes = [];
    this._text = String(value || "");
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === "class") this.className = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  querySelectorAll(selector) {
    const found = [];
    const matches = (node) => {
      if (selector === "li") return node.tagName === "LI";
      if (selector === "a.internal-link") return node.tagName === "A" && node.className.split(/\s+/).includes("internal-link");
      if (selector === ".bob-event-link-time") return node.className.split(/\s+/).includes("bob-event-link-time");
      if (selector === ".bob-off-clock-link-chip") return node.className.split(/\s+/).includes("bob-off-clock-link-chip");
      if (selector === ".bob-progress-mark") return node.className.split(/\s+/).includes("bob-progress-mark");
      return false;
    };
    const walk = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 1 && matches(child)) found.push(child);
        if (child.childNodes) walk(child);
      }
    };
    walk(this);
    return found;
  }
}

function makeDom() {
  const doc = {
    createElement: (tag) => new DomNode(tag, "", doc),
    createTextNode: (value) => {
      const node = new DomNode("#text", "", doc, 3);
      node.nodeValue = String(value);
      node.textContent = String(value);
      return node;
    },
  };
  return doc;
}

// A rendered daily-note ledger row: root > H2 "Pomodoros" + top UL >
// entry LI[data-task] > inner UL > li > [P] > anchor. Extra marks and
// wrappers mirror the frees Reading fixture.
function readingLedgerRoot({ blockHref = "#^standup", entryTask = " ", withProgress = false, wrapP = false, struck = false } = {}) {
  const doc = makeDom();
  const root = new DomNode("DIV", "", doc);
  root.ownerDocument = doc;
  const head = new DomNode("H2", "", doc);
  head.appendChild(doc.createTextNode("Pomodoros"));
  root.appendChild(head);
  const top = new DomNode("UL", "", doc);
  root.appendChild(top);
  const entry = new DomNode("LI", "", doc);
  entry.setAttribute("data-task", entryTask);
  top.appendChild(entry);
  const inner = new DomNode("UL", "", doc);
  entry.appendChild(inner);
  const li = new DomNode("LI", "", doc);
  inner.appendChild(li);
  const content = wrapP ? new DomNode("P", "", doc) : li;
  if (wrapP) li.appendChild(content);
  if (withProgress) {
    const progress = new DomNode("SPAN", "bob-progress-mark", doc);
    progress.setAttribute("class", "bob-progress-mark");
    content.appendChild(progress);
  }
  const anchor = new DomNode("A", "internal-link", doc);
  anchor.setAttribute("class", "internal-link");
  anchor.setAttribute("data-href", blockHref);
  if (struck) {
    const del = new DomNode("DEL", "", doc);
    del.appendChild(anchor);
    content.appendChild(del);
    root.del = del;
  } else {
    content.appendChild(anchor);
  }
  root.li = li;
  root.anchor = anchor;
  root.content = content;
  return root;
}

function realisticSameNote(plugin, sourcePath) {
  return (pathPart) => plugin.eventLinkTimeIsSameNote(pathPart, sourcePath);
}

function ledgerBlockIds(links) {
  return links.map((link) => link.blockId);
}

// EL1-EL7 qualify; EL8-EL13, EL15, EL17-EL19 do not. EL14 (ambiguous) and
// the cross-note EL15 are covered with the resolution stage below.
test("EL — ledger rows qualify exactly per the contract", () => {
  const { plugin } = makePlugin();
  const lines = contractNote();
  const links = eventLinkTimeLinks(lines, TODAY_PATH, { isSameNote: realisticSameNote(plugin, TODAY_PATH) });
  // EL12/EL13 stay link rows here; resolution yields no pill below.
  assert.deepEqual(ledgerBlockIds(links), ["cfg", "swings", "standup", "standup", "standup", "standup", "park", "gtd", "holiday", "dup"]);
  const byLine = new Map(links.map((link) => [lines[link.line], link]));
  // EL1: plain link; ch is the link start.
  assert.equal(byLine.get("\t- [[#^cfg]]").ch, 3);
  assert.equal(byLine.get("\t- [[#^cfg]]").linktext, "#^cfg");
  // EL2: closed entry, struck link; ch is the opening `~~`.
  assert.equal(byLine.get("\t- ~~[[#^swings]]~~").ch, 3);
  // EL6: an explicit same-note path qualifies.
  const full = links.find((link) => link.pathPart === "2026/20261103");
  assert.ok(full);
  assert.equal(full.blockId, "standup");
  // EL14 stays a link row here; ambiguity resolves to no pill below.
  assert.ok(byLine.get("\t- [[#^dup]]"));
  for (const prose of ["\t- ![[#^standup]]", "\t- join [[#^standup]] early", "\t\t- [[#^standup]]", "\t- [[bob#^parser]]", "\t- [[2026/20261102#^swings]]", "see [[#^standup]]"]) {
    assert.ok(!byLine.has(prose), `no link for ${prose}`);
  }
});

test("EL18 — a fenced ledger row gets no pill", () => {
  const { plugin } = makePlugin();
  const lines = [
    "^gtd",
    "## Events",
    "- [ ] #task **0945-1015** Standup ^standup",
    "## Pomodoros",
    "- [ ] () — MEET",
    "\t```",
    "\t- [[#^standup]]",
    "\t```",
  ];
  const links = eventLinkTimeLinks(lines, TODAY_PATH, { isSameNote: realisticSameNote(plugin, TODAY_PATH) });
  assert.deepEqual(links, []);
});

test("EL19 — a non-daily note gets no pills", () => {
  const { plugin } = makePlugin();
  const lines = [
    "## Events",
    "- [ ] #task **0945-1015** Standup ^standup",
    "## Pomodoros",
    "- [ ] () — MEET",
    "\t- [[#^standup]]",
  ];
  assert.deepEqual(eventLinkTimeLinks(lines, "notes/random.md", { isSameNote: realisticSameNote(plugin, "notes/random.md") }), []);
});

test("EL16 — the previous day's ledger pills without state", () => {
  const { plugin } = makePlugin();
  const lines = [
    "## Events",
    "- [x] #task **0815-0830** Swings! #off ^swings",
    "## Pomodoros",
    "- [x] (**0815-0830**) — MEET",
    "\t- ~~[[#^swings]]~~",
  ];
  const sourcePath = "2026/20261102.md";
  const links = eventLinkTimeLinks(lines, sourcePath, { isSameNote: realisticSameNote(plugin, sourcePath) });
  assert.deepEqual(ledgerBlockIds(links), ["swings"]);
  const rows = eventRunEventRows(lines);
  const model = eventLinkTimeModel(eventRunById(rows, "swings"), {
    isToday: false,
    nowMinutes: 600,
    hue: null,
    line: lines[rows[0].lineIndex],
    path: sourcePath,
    metadataCache: plugin.app.metadataCache,
    vault: plugin.app.vault,
  });
  assert.ok(model);
  assert.equal(model.row.state, null);
  assert.equal(model.row.bufferPhase, null);
  assert.ok(!("data-state" in gcalEventsTimeAttributes(model.row, model.hue)));
});

test("ES — the shared clock answers the contract states", () => {
  assert.equal(gcalEventsTimeState("1830-1900", 10 * 60, true, true), "future");
  assert.equal(gcalEventsTimeState("1200-1230", 10 * 60, true, true), "future");
  assert.equal(gcalEventsTimeState("0945-1015", 10 * 60, true, true), "running");
  assert.equal(gcalEventsTimeState("0815-0830", 10 * 60, true, true), "past");
  assert.equal(gcalEventsTimeState("2300-0030", 23 * 60 + 45, true, true), "running");
  assert.equal(gcalEventsTimeState("2300-0030", 0 * 60 + 10, true, true), "running");
  assert.equal(gcalEventsTimeState("2300-0030", 22 * 60, true, true), "future");
  assert.equal(gcalEventsTimeState("1830-1900", 18 * 60 + 10, true, true, { beforeMin: 30, afterMin: 0 }), "future");
  assert.equal(gcalEventsBufferPhase("1830-1900", 18 * 60 + 10, true, true, { beforeMin: 30, afterMin: 0 }), "lead-in");
  assert.equal(gcalEventsTimeState("1200-1300", 13 * 60 + 5, true, true, { beforeMin: 30, afterMin: 15 }), null);
  assert.equal(gcalEventsBufferPhase("1200-1300", 13 * 60 + 5, true, true, { beforeMin: 30, afterMin: 15 }), "lead-out");
  assert.equal(gcalEventsTimeState("1200-1300", 13 * 60 + 20, true, true, { beforeMin: 30, afterMin: 15 }), "past");
  assert.equal(gcalEventsTimeState("1830-1900", 10 * 60, false, true), null);
});

function contractModel(plugin, blockId, noteLines, overrides = {}) {
  const lines = noteLines || contractNote();
  const rows = eventRunEventRows(lines);
  const row = eventRunById(rows, blockId);
  assert.ok(row, `event row ^${blockId} exists`);
  return eventLinkTimeModel(row, {
    isToday: true,
    nowMinutes: 600,
    hue: null,
    line: lines[row.lineIndex],
    path: TODAY_PATH,
    metadataCache: plugin.app.metadataCache,
    vault: plugin.app.vault,
    ...overrides,
  });
}

function innerPillAttrs(host) {
  const inner = host.childNodes.find((node) => node.nodeType === 1 && String(node.className || "").split(/\s+/).includes("bob-calendar-event-time"));
  assert.ok(inner, "inner pill exists");
  const attrs = { ...inner.attrs };
  delete attrs.class;
  return attrs;
}

// ER1-ER4, ER8: clock, buffer, and parity on resolved models.
test("ER — resolution matches the Events pill inputs", () => {
  const { plugin } = makePlugin();
  // ER1: a buffered, explicitly off-clock event.
  const cfg = contractModel(plugin, "cfg");
  assert.ok(cfg);
  assert.equal(cfg.time, "1830-1900");
  assert.equal(cfg.row.state, "future");
  assert.equal(cfg.row.bufferPhase, null);
  assert.equal(cfg.before && cfg.before.label, "30m");
  assert.equal(cfg.after, null);
  assert.equal(cfg.row.offClock, true);
  // ER2: an untagged row inheriting love's off-clock default.
  const park = contractModel(plugin, "park");
  assert.ok(park);
  assert.equal(park.row.offClock, true);
  assert.equal(park.row.clockSource, "note");
  assert.equal(park.detail, "Off-clock · from love");
  // ER3: a row under an on-clock project stays solid.
  const standup = contractModel(plugin, "standup");
  assert.ok(standup);
  assert.equal(standup.row.offClock, false);
  assert.equal(standup.detail, "");
  // ER4: an explicit #on beats the inherited default.
  const onLines = contractNote().map((line) => (line.endsWith("^park") ? line.replace(" Park ", " Park #on ") : line));
  const onModel = contractModel(plugin, "park", onLines);
  assert.ok(onModel);
  assert.equal(onModel.row.offClock, false);
  // ER8: a closed event row still resolves.
  const swings = contractModel(plugin, "swings");
  assert.ok(swings);
  assert.equal(swings.time, "0815-0830");
  assert.equal(swings.row.state, "past");
});

// Mac parity: EL11-EL15 match `event_item_chips` — no pill without a
// unique same-note Event Task row with a span.
test("ER — non-events, duplicates, and cross-note links resolve to no pill", () => {
  const { plugin } = makePlugin();
  const lines = contractNote();
  const rows = eventRunEventRows(lines);
  assert.equal(eventRunById(rows, "parser"), null);
  assert.equal(eventRunById(rows, "gtd"), null);
  assert.equal(eventRunById(rows, "holiday"), null);
  assert.equal(eventRunById(rows, "dup"), null);
  for (const blockId of ["parser", "gtd", "holiday", "dup"]) {
    assert.equal(eventLinkTimeModel(eventRunById(rows, blockId), {
      isToday: true,
      nowMinutes: 600,
      hue: null,
      line: "",
      path: TODAY_PATH,
      metadataCache: plugin.app.metadataCache,
      vault: plugin.app.vault,
    }), null, `no model for ^${blockId}`);
  }
});

function liveModels(plugin, text, filePath) {
  const view = makeView(text, filePath);
  const decorations = plugin.buildEventLinkTimeDecorations(view);
  assert.ok(decorations && Array.isArray(decorations.adds));
  return decorations.adds.map((add) => ({
    pos: add.from,
    side: add.value.side,
    model: add.value.widget.model,
  }));
}

// ER5: an unsaved span edit shows on the same frame.
test("ER5 — Live Preview reads the live document, unsaved edits included", () => {
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  const edited = contractNote().map((line) => (line.endsWith("^standup") && line.includes("**") ? line.replace("**0945-1015**", "**1000-1030**") : line));
  const found = liveModels(plugin, edited.join("\n"), TODAY_PATH);
  const standups = found.filter((pill) => pill.model.blockId === "standup");
  assert.ok(standups.length >= 4, "standup pills rebuild from the live text");
  for (const pill of standups) assert.equal(pill.model.time, "1000-1030");
});

// ER6: an unsaved #off dashes on the same frame.
test("ER6 — Live Preview dashes an unsaved off-clock tag on the same frame", () => {
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  const edited = contractNote().map((line) => (line.endsWith("^standup") && line.includes("**") ? line.replace(" ^standup", " #off ^standup") : line));
  const found = liveModels(plugin, edited.join("\n"), TODAY_PATH);
  const standups = found.filter((pill) => pill.model.blockId === "standup");
  assert.ok(standups.length >= 4);
  for (const pill of standups) assert.equal(pill.model.row.offClock, true);
});

// ER7: inner attributes equal gcalEventsTimeAttributes minus title.
test("ER7 — the inner pill carries the Events pill attributes, minus title", () => {
  const { plugin } = makePlugin();
  const doc = makeDom();
  for (const blockId of ["cfg", "swings", "standup", "park"]) {
    const model = contractModel(plugin, blockId);
    const host = buildEventLinkTimeElement(doc, model);
    assert.ok(host);
    const expected = { ...gcalEventsTimeAttributes(model.row, model.hue) };
    delete expected.title;
    assert.deepEqual(innerPillAttrs(host), expected, `parity for ^${blockId}`);
    assert.ok(!host.childNodes.some((node) => node.nodeType === 1 && node.getAttribute("title") != null), "no inner title");
  }
});

// ET1-ET5: tooltips follow the table.
test("ET — tooltips name the event and its pill state", () => {
  const { plugin } = makePlugin();
  // ET1: buffer detail on line two.
  assert.equal(contractModel(plugin, "cfg").tooltip, "(virtual) CFG Appt\nHolds 18:00–19:00 · 30m before");
  // ET2: a bare title when the Events pill has no tooltip.
  assert.equal(contractModel(plugin, "swings").tooltip, "Swings!");
  // ET3: inherited clock detail on line two.
  assert.equal(contractModel(plugin, "park").tooltip, "Park\nOff-clock · from love");
  // ET4: a long title cuts to 79 characters plus ….
  const long = `x${"y".repeat(94)}`;
  assert.equal(eventLinkTimeCutTitle(long), `${"x"}${"y".repeat(78)}…`);
  assert.equal(eventLinkTimeTooltip({ title: long, detail: "" }).length, 80);
  // ET5: a stray :: becomes :.
  assert.equal(eventLinkTimeTooltip({ title: "Q&A :: follow-up", detail: "" }), "Q&A : follow-up");
  assert.equal(eventLinkTimeTooltip({ title: "", detail: "" }), "Calendar event");
});

function childClasses(node) {
  return node.childNodes
    .filter((child) => child.nodeType === 1)
    .map((child) => String(child.className || "").split(/\s+/)[0]);
}

function stubReadingSources(plugin, lines) {
  plugin.calendarEventSourceLines = () => lines;
  plugin.taskThemeSourceTextFor = () => null;
}

function pillHost(root) {
  const hosts = root.querySelectorAll(".bob-event-link-time");
  assert.equal(hosts.length, 1, "exactly one pill host");
  return hosts[0];
}

// EP1: the widget sits at the link start with side -3, before the
// ledger type (-2) and progress (-1) marks.
test("EP1 — Live Preview places the pill at the link start, side -3", () => {
  assert.equal(EVENT_LINK_TIME_SIDE, -3);
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  const text = contractNote().join("\n");
  const found = liveModels(plugin, text, TODAY_PATH);
  // Ten link rows qualify; gtd, holiday, and dup resolve to no pill.
  assert.equal(found.length, 7, `pills for every resolvable row (got ${found.length})`);
  const lines = text.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  // Pills build in document order, so pair each pill with its link row.
  const links = eventLinkTimeLinks(lines, TODAY_PATH, { isSameNote: realisticSameNote(plugin, TODAY_PATH) });
  const rows = eventRunEventRows(lines);
  const expected = links
    .filter((entry) => eventRunById(rows, entry.blockId))
    .map((entry) => ({ pos: starts[entry.line] + entry.ch, blockId: entry.blockId }));
  assert.equal(found.length, expected.length);
  found.forEach((pill, index) => {
    assert.equal(pill.side, -3);
    assert.equal(pill.model.blockId, expected[index].blockId);
    assert.equal(pill.pos, expected[index].pos, `pill at the link start for ^${pill.model.blockId}`);
  });
});

// EP4: the pill stays at the same end while the cursor is on the row.
test("EP4 — selection alone never rebuilds the pills", () => {
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  assert.equal(plugin.eventLinkTimeRebuildReason({ selectionSet: true, transactions: [], docChanged: false, viewportChanged: false }), null);
  const text = contractNote().join("\n");
  const first = liveModels(plugin, text, TODAY_PATH).map((pill) => pill.pos);
  const second = liveModels(plugin, text, TODAY_PATH).map((pill) => pill.pos);
  assert.deepEqual(first, second);
});

// EP2 + EP5: a pill-wearing row still reads as a ledger row, ordered
// `pill ◐ link` in Reading view.
test("EP2/EP5 — Reading view orders the pill before progress marks and keeps the ledger context", () => {
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  stubReadingSources(plugin, contractNote());
  const root = readingLedgerRoot({ withProgress: true });
  const before = plugin.progressMarkReadingContext(root.li, root, { includeStruck: true, includeClosedEntry: true, allowLedgerMarks: true });
  assert.ok(before, "row reads as a ledger row before the pill");
  plugin.sweepEventLinkTimesReadingView({ el: root, ctx: { sourcePath: TODAY_PATH }, sourcePath: TODAY_PATH });
  const after = plugin.progressMarkReadingContext(root.li, root, { includeStruck: true, includeClosedEntry: true, allowLedgerMarks: true });
  assert.ok(after, "row still reads as a ledger row wearing a pill (no status ring)");
  assert.deepEqual(after, { anchor: root.anchor, target: "", blockId: "standup" });
  assert.deepEqual(childClasses(root.content), ["bob-event-link-time", "bob-progress-mark", "internal-link"]);
  plugin.sweepEventLinkTimesReadingView({ el: root, ctx: { sourcePath: TODAY_PATH }, sourcePath: TODAY_PATH });
  assert.deepEqual(childClasses(root.content), ["bob-event-link-time", "bob-progress-mark", "internal-link"]);
});

// EP3: a trailing chip stays after the link; the pill stays before it. The
// trailing chip stands in for gf's off-clock chip (not landed): placement
// itself never depends on the neighbour, so the host lands before the
// link container whatever follows it.
test("EP3 — the pill lands before the link container beside a trailing chip", () => {
  const { plugin } = makePlugin();
  const model = contractModel(plugin, "standup");
  assert.ok(model);
  const root = readingLedgerRoot({});
  const chip = new DomNode("SPAN", "bob-off-clock-link-chip", root.ownerDocument);
  chip.setAttribute("class", "bob-off-clock-link-chip");
  root.content.appendChild(chip);
  const host = buildEventLinkTimeElement(root.ownerDocument, model);
  assert.ok(host);
  plugin.eventLinkTimeReadingPlace(root.anchor, host);
  assert.deepEqual(childClasses(root.content), ["bob-event-link-time", "internal-link", "bob-off-clock-link-chip"]);
});

// Both production Reading sweeps must coexist on an off-clock Event Task
// Task Link. Run each order and a further refresh to catch placement churn
// and duplicate hosts, while exercising the real clock resolver for tags,
// inherited root defaults, and #on overrides.
test("EP3/OC — Reading sweeps preserve pill/link/marks/chip order and clock parity", () => {
  const cases = [
    { id: "explicit", task: "- [ ] #task **0945-1015** Explicit #off [root:: bob] [type:: MEET] ^explicit", off: true },
    { id: "inherited", task: "- [ ] #task **0945-1015** Inherited [root:: abby] [type:: MEET] ^inherited", off: true },
    { id: "override", task: "- [ ] #task **0945-1015** Override #on [root:: abby] [type:: MEET] ^override", off: false },
  ];
  for (const item of cases) {
    const { plugin } = makePlugin();
    plugin.calendarEventsPaintEnabled = true;
    plugin.offClockLinkChipsEnabled = true;
    const note = ["## Events", item.task, "## Pomodoros", "- [ ] () — MEET", `  - [[#^${item.id}]]`];
    plugin.calendarEventSourceLines = () => note;
    plugin.taskThemeSourceTextFor = () => note.join("\n");
    // Keep target lookup realistic while the clock result comes from the
    // production taskEffectiveClockResolution path and fixture metadata.
    plugin.pomodoroClockResolveTaskLineFrom = (link) => link.blockId === item.id ? item.task : null;
    const root = readingLedgerRoot({ blockHref: `#^${item.id}`, withProgress: true });
    const record = { el: root, ctx: { sourcePath: TODAY_PATH }, sourcePath: TODAY_PATH };
    const chipSweep = () => plugin.sweepOffClockLinkChipsReadingView(record);
    const pillSweep = () => plugin.sweepEventLinkTimesReadingView(record);
    const orders = [[pillSweep, chipSweep], [chipSweep, pillSweep]];
    for (const order of orders) {
      for (const sweep of order) assert.equal(sweep(), true);
      assert.equal(innerPillAttrs(pillHost(root))["data-off-clock"] === "true", item.off, item.id);
      assert.equal(root.querySelectorAll(".bob-off-clock-link-chip").length, item.off ? 1 : 0, item.id);
      const context = plugin.progressMarkReadingContext(root.li, root, {
        includeStruck: true, includeClosedEntry: true, allowLedgerMarks: true,
      });
      assert.ok(context, `${item.id}: both hosts preserve ledger context`);
      assert.deepEqual(context, { anchor: root.anchor, target: "", blockId: item.id });
      if (item.off) {
        assert.deepEqual(childClasses(root.content), [
          "bob-event-link-time", "bob-progress-mark", "internal-link", "bob-off-clock-link-chip",
        ]);
      }
    }
    // A repeated paired refresh is stable and never duplicates either host.
    pillSweep(); chipSweep();
    assert.equal(root.querySelectorAll(".bob-event-link-time").length, 1);
    assert.equal(root.querySelectorAll(".bob-off-clock-link-chip").length, item.off ? 1 : 0);
    if (item.off) assert.deepEqual(childClasses(root.content), [
      "bob-event-link-time", "bob-progress-mark", "internal-link", "bob-off-clock-link-chip",
    ]);

    // Each feature's gate can remove its own host without disturbing the other.
    plugin.eventLinkTimesEnabled = false;
    pillSweep();
    assert.equal(root.querySelectorAll(".bob-event-link-time").length, 0);
    assert.equal(root.querySelectorAll(".bob-off-clock-link-chip").length, item.off ? 1 : 0);
    plugin.eventLinkTimesEnabled = true;
    pillSweep();
    plugin.offClockLinkChipsEnabled = false;
    chipSweep();
    assert.equal(root.querySelectorAll(".bob-off-clock-link-chip").length, 0);
    assert.equal(root.querySelectorAll(".bob-event-link-time").length, 1);
  }
});

// EP7: the strike never runs through the pill, in either view.
test("EP7 — a struck link keeps the pill outside the strike", () => {
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  stubReadingSources(plugin, contractNote());
  const root = readingLedgerRoot({ blockHref: "#^swings", entryTask: "x", struck: true });
  plugin.sweepEventLinkTimesReadingView({ el: root, ctx: { sourcePath: TODAY_PATH }, sourcePath: TODAY_PATH });
  const host = pillHost(root);
  assert.equal(host.parentNode, root.content);
  assert.equal(host.nextSibling, root.del);
  const inner = host.childNodes.find((node) => node.nodeType === 1);
  assert.ok(inner && !["DEL", "S", "STRIKE"].includes(inner.tagName));
  // Live Preview: the widget sits at the opening `~~`.
  const text = contractNote().join("\n");
  const found = liveModels(plugin, text, TODAY_PATH);
  const swings = found.find((pill) => pill.model.blockId === "swings");
  assert.ok(swings);
  const lines = text.split("\n");
  const struckIndex = lines.findIndex((line) => line.includes("~~[[#^swings]]"));
  let struckStart = 0;
  for (let index = 0; index < struckIndex; index += 1) struckStart += lines[index].length + 1;
  assert.equal(swings.pos, struckStart + lines[struckIndex].indexOf("~~"));
});

// EL20 + gates: either toggle off hides every pill; the CSS gates match.
test("EL20 — either toggle off hides every pill, in JS and CSS", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"), "utf8");
  assert.ok(css.includes("body:not(.bob-event-link-times) .bob-event-link-time"), "event-times gate");
  assert.ok(css.includes("body:not(.bob-calendar-events) .bob-event-link-time"), "calendar-painting gate");
  assert.ok(css.includes(".bob-event-link-time {\n  user-select: none;"), "host-only rule");
  const hostRule = /\.bob-event-link-time \{([^}]*)\}/.exec(css);
  assert.ok(hostRule && !/line-height/.test(hostRule[1]), "the pill never changes line height");
  assert.ok(hostRule && hostRule[1].includes("margin-inline-end: 0.35em"), "the decided before-margin");
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  const text = contractNote().join("\n");
  plugin.eventLinkTimesEnabled = false;
  assert.equal(plugin.buildEventLinkTimeDecorations(makeView(text, TODAY_PATH)).none, true);
  plugin.eventLinkTimesEnabled = true;
  plugin.calendarEventsPaintEnabled = false;
  assert.equal(plugin.buildEventLinkTimeDecorations(makeView(text, TODAY_PATH)).none, true);
});

// Toggles, popout sync, and the shared clock wiring.
test("setup — toggle command, popout gates, and clock repaint wiring", async () => {
  const { plugin, app } = makePlugin();
  plugin.setupEventLinkTimes();
  const command = (plugin.commands || []).find((entry) => entry.id === "toggle-event-link-times");
  assert.ok(command, "toggle command registered");
  assert.equal(plugin.eventLinkTimesEnabled, true);
  plugin.toggleEventLinkTimes();
  assert.equal(plugin.eventLinkTimesEnabled, false);
  assert.ok(TestNotice.messages.pop() === "Task Link event times off");
  plugin.toggleEventLinkTimes();
  assert.equal(plugin.eventLinkTimesEnabled, true);
  plugin.setupCalendarEventPainting();
  plugin.calendarEventsPaintEnabled = true;
  const popouts = (app.handlers["window-open"] || []).slice();
  assert.ok(popouts.length >= 2, "both gates sync to popouts");
  const classes = new Set();
  const fakeDoc = { body: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } } };
  for (const open of popouts) open({ document: fakeDoc }, undefined);
  assert.ok(classes.has("bob-event-link-times"), "event-times gate reaches popouts");
  assert.ok(classes.has("bob-calendar-events"), "calendar gate reaches popouts");

  // The once-a-minute clock repaint refreshes link pills too.
  const dispatched = [];
  const file = { path: TODAY_PATH };
  const leaf = { view: { file, editor: { cm: { dispatch: (effect) => dispatched.push(effect) } } } };
  app.workspace.getLeavesOfType = () => [leaf];
  const refreshType = ensureEventLinkTimesRefresh();
  assert.ok(refreshType, "link refresh effect exists");
  plugin.refreshCalendarEventPaint();
  assert.ok(dispatched.length >= 2, "gcal and link refreshes dispatch");
  assert.ok(dispatched.some((effect) => {
    const effects = effect && effect.effects !== undefined ? effect.effects : effect;
    const list = Array.isArray(effects) ? effects : [effects];
    return list.some((single) => single && typeof single.is === "function" && single.is(refreshType));
  }), "the clock repaint carries the link refresh effect");
});

// One coalesced refresh serves metadataCache and vault events.
test("liveness — metadata and vault events coalesce into one refresh", () => {
  const cacheHandlers = {};
  const vaultHandlers = {};
  const env = contractClockEnv();
  const app = {
    handlers: {},
    vault: {
      ...env.vault,
      on: (name, callback) => {
        vaultHandlers[name] = vaultHandlers[name] || [];
        vaultHandlers[name].push(callback);
        return {};
      },
    },
    workspace: { getLeavesOfType: () => [], openLinkText: () => {}, on: () => ({}) },
    metadataCache: {
      ...env.metadataCache,
      on: (name, callback) => {
        cacheHandlers[name] = cacheHandlers[name] || [];
        cacheHandlers[name].push(callback);
        return {};
      },
    },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.eventLinkTimesEnabled = true;
  plugin.calendarEventsPaintEnabled = true;
  let scheduled = 0;
  let ran = 0;
  const original = plugin.runEventLinkTimesRefresh.bind(plugin);
  plugin.runEventLinkTimesRefresh = () => {
    ran += 1;
    return original();
  };
  plugin.eventLinkTimesTimers = {
    set: (fn) => {
      scheduled += 1;
      plugin.eventLinkTimesTimers.fn = fn;
      return 1;
    },
    clear: () => {},
  };
  plugin.setupEventLinkTimes();
  assert.ok((cacheHandlers.changed || []).length >= 1, "metadataCache changed refreshes");
  assert.ok((cacheHandlers.resolved || []).length >= 1, "metadataCache resolved refreshes");
  assert.ok((vaultHandlers.rename || []).length >= 1, "vault rename refreshes");
  assert.ok((vaultHandlers.delete || []).length >= 1, "vault delete refreshes");
  cacheHandlers.changed[0]();
  cacheHandlers.resolved[0]();
  vaultHandlers.rename[0]();
  assert.equal(scheduled, 1, "one coalesced refresh");
  plugin.eventLinkTimesTimers.fn();
  assert.equal(ran, 1, "the coalesced refresh runs");
});

// A source-text fill refreshes link pills (and still refreshes task themes).
test("liveness — a source-text fill refreshes link pills", async () => {
  const { plugin, app } = makePlugin();
  const fills = ["## Events\n- [ ] #task **0945-1015** Standup ^standup\n## Pomodoros\n- [ ] () — MEET\n\t- [[#^standup]]\n"];
  app.vault.cachedRead = () => Promise.resolve(fills[0]);
  app.vault.getAbstractFileByPath = () => ({ path: TODAY_PATH });
  let linkRefreshes = 0;
  let themeRefreshes = 0;
  plugin.scheduleEventLinkTimesRefresh = () => {
    linkRefreshes += 1;
  };
  plugin.scheduleTaskThemeMarksRefresh = () => {
    themeRefreshes += 1;
  };
  plugin.taskThemeRequestSourceText(TODAY_PATH);
  for (let tick = 0; tick < 10 && linkRefreshes === 0; tick += 1) {
    await Promise.resolve();
  }
  assert.equal(linkRefreshes, 1, "the fill refreshes link pills");
  assert.equal(themeRefreshes, 1, "the fill still refreshes task themes");
});

// Performance: a synthetic 200-link ledger and 50 Event rows keeps one
// Live Preview build under about 25 ms.
test("perf — one build over a 200-link ledger stays under 25 ms", () => {
  const { plugin } = makePlugin();
  plugin.calendarEventsPaintEnabled = true;
  const events = [];
  for (let index = 0; index < 50; index += 1) {
    const hour = String(8 + Math.floor(index / 4)).padStart(2, "0");
    const minute = String((index % 4) * 15).padStart(2, "0");
    const end = String(((index % 4) * 15 + 30) % 60).padStart(2, "0");
    events.push(`- [ ] #task **${hour}${minute}-${hour}${end}** Event ${index} ^e${index}`);
  }
  const body = ["^gtd", "## Events", ...events, "## Pomodoros"];
  for (let entry = 0; entry < 40; entry += 1) {
    body.push("- [ ] () — MEET");
    for (let link = 0; link < 5; link += 1) {
      body.push(`\t- [[#^e${(entry * 5 + link) % 50}]]`);
    }
  }
  const text = body.join("\n");
  const view = makeView(text, TODAY_PATH);
  const warm = plugin.buildEventLinkTimeDecorations(view);
  assert.ok(warm.adds.length === 200, `every synthetic link pills (got ${warm.adds.length})`);
  const start = process.hrtime.bigint();
  const built = plugin.buildEventLinkTimeDecorations(view);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(built.adds.length, 200);
  console.log(`event-link-times build: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 25, `one build under 25 ms (took ${ms.toFixed(1)} ms)`);
});

test("widget — identity follows time, state, clock, buffer, and tooltip", () => {
  const { plugin } = makePlugin();
  const first = contractModel(plugin, "cfg");
  const same = contractModel(plugin, "cfg");
  const changed = { ...first, tooltip: `${first.tooltip} !` };
  const left = new EventLinkTimeWidget(first, TODAY_PATH, "#^cfg", () => {});
  assert.ok(left.eq(new EventLinkTimeWidget(same, TODAY_PATH, "#^cfg", () => {})));
  assert.ok(!left.eq(new EventLinkTimeWidget(changed, TODAY_PATH, "#^cfg", () => {})));
  assert.ok(!left.eq(new EventLinkTimeWidget(first, TODAY_PATH, "#^other", () => {})));
  assert.ok(left instanceof StubWidgetType);
});
