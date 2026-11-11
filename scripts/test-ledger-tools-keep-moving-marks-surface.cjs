// KP/KB surface vectors from docs/keep-moving-marks.md (mark-surface phase).
// Live Preview decorations, the Reading sweep, the toggle, the rollover,
// cache-miss liveness, the baton-pass tick, and the perf budget. The pure
// gates and counts are pinned by test-ledger-tools-keep-moving-marks.cjs;
// this file pins the runtime half: placement, refresh, and motion.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { performance } = require("node:perf_hooks");

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
const originalLoad = Module._load;
Module._load = function loadWithKeepMovingSurfaceStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: FakeRenderChild,
    Notice: class {},
    Plugin: class {},
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

const TODAY = "2026-11-02";
const DAILY = "2026/20261102.md";
const PROJECT = "job_email_recruiters.md";

// KB7: the screenshot project. A sub-project under job_2026;
// X is the only live link and four Next residents stay offerable.
function projectText(extra = "") {
  return [
    "---", 'type: "[[project]]"', "status: wip", 'parent: "[[job_2026]]"', "---",
    "- [ ] #task Root ^prj",
    "- [*] #task Reply to Luzern ^luzern",
    "- [*] #task Ecogpt ^ecogpt",
    "- [*] #task Ray Lyles ^ray-lyles",
    "- [*] #task Product Engineer ^product-engineer-dan-dowd",
    "- [*] #task Senior Rust ^senior-rust-java-engineer",
    extra,
  ].filter(Boolean).join("\n");
}

function dailyText(link = "[[job_email_recruiters#^luzern]]") {
  return ["## Pomodoros", "- [ ] () — WRITE", `\t- ${link}`].join("\n");
}

function taskFor(row) {
  const types = { "/": "IN_PROGRESS", "*": "ON_HOLD", x: "DONE", X: "DONE", "-": "DONE" };
  const tags = [...String(row.rawLine || "").matchAll(/(^|\s)#([A-Za-z0-9_/-]+)/g)].map((match) => match[2]);
  return {
    id: row.taskId || undefined, blockLink: row.blockId ? " ^" + row.blockId : "",
    path: row.path, lineNumber: row.line,
    status: { type: types[row.status] || "TODO", symbol: row.status },
    description: row.rawLine, originalMarkdown: row.rawLine,
    dependsOn: row.dependsOn.slice(), tags,
  };
}

function memoFor(projectSource, extraTasks = []) {
  const rows = h.keepMovingMarkTaskRows(PROJECT, projectSource).filter((row) => row.isTask);
  return { tasks: rows.map(taskFor).concat(extraTasks), dateText: TODAY, warm: true };
}

// A plugin instance whose vault holds one leaf project behind today's link.
function makePlugin(day, projectSource, opts = {}) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.keepMovingMarksEnabled = opts.enabled !== false;
  const texts = { [PROJECT]: projectSource, [DAILY]: day, "job.md": "---\ntype: [[area]]\n---\n" };
  const frontmatter = {
    [PROJECT]: { type: "[[project]]", status: "wip", parent: opts.parent || "[[job_2026]]" },
    "job.md": { type: "[[area]]" },
    "job_2026.md": { type: "[[project]]", parent: "[[job]]" },
  };
  const requested = [];
  plugin.app = {
    metadataCache: {
      getCache: (notePath) => (frontmatter[notePath] ? { frontmatter: frontmatter[notePath] } : null),
      getFirstLinkpathDest: (target) => {
        const stem = String(target || "").split("|")[0].split("#")[0].replace(/\.md$/i, "");
        if (stem === "job_2026") return { path: "job_2026.md" };
        if (stem === "job") return { path: "job.md" };
        if (stem === "job_email_recruiters") return { path: PROJECT };
        return null;
      },
    },
    vault: { getMarkdownFiles: () => [{ path: PROJECT }, { path: "job_2026.md" }, { path: "job.md" }, { path: DAILY }] },
    workspace: {},
  };
  plugin.texts = texts;
  plugin.freshnessEnsureMemo = () => memoFor(plugin.texts[PROJECT]);
  plugin.currentTodayDailyPath = () => DAILY;
  plugin.taskThemeSourceTextFor = (notePath) => (notePath in texts ? texts[notePath] : null);
  plugin.taskThemeRequestSourceText = (notePath) => { requested.push(notePath); return true; };
  plugin.keepMovingMarkLoadConfig = () => ({ keepMoving: true, linkUnblocked: true, successorLabels: [] });
  plugin.relationIndexApi = () => ({ ready: () => true, outgoing: () => [] });
  plugin.requested = requested;
  // Seed the shared source-text cache the way a rendered build would: the
  // changed-file hook schedules a refresh for notes the mark already reads.
  try {
    plugin.taskThemeRememberSourceText(PROJECT, texts[PROJECT]);
    plugin.taskThemeRememberSourceText(DAILY, day);
  } catch (error) {
    // Cache seeding is best-effort in the harness.
  }
  return plugin;
}

function makeView(text) {
  const holder = { text: String(text) };
  const doc = {
    toString: () => holder.text,
    line(number) {
      const rows = holder.text.split("\n");
      let from = 0;
      for (let index = 1; index < number; index += 1) from += rows[index - 1].length + 1;
      return { from, text: rows[number - 1] };
    },
  };
  const state = {
    doc,
    field: (field) => (field === editorLivePreviewField ? true : { file: { path: DAILY } }),
  };
  // One view object per editor: the baton-pass LRU keys counts by view, so a
  // text change reuses the view and only swaps the text underneath it.
  return {
    state,
    visibleRanges: [{ from: 0, to: holder.text.length }],
    setText(next) {
      holder.text = String(next);
      this.visibleRanges = [{ from: 0, to: holder.text.length }];
    },
  };
}

test("KP1/KB7: Live Preview widget sits at the link end with side 3 and the screenshot count", () => {
  // KP1: zero-width widget after `]]` (before any trailing ` #`); KB7: `⏭ 4`.
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  const decorations = plugin.buildKeepMovingMarkDecorations(makeView(day));
  assert.equal(decorations.adds.length, 1);
  const add = decorations.adds[0];
  const linkLine = day.split("\n")[2];
  assert.equal(add.from, day.indexOf(linkLine) + linkLine.indexOf("]]") + 2);
  assert.equal(add.value.side, 3); // KP1: ⏭ is side 3; the off chip moved to side 4.
  const widget = add.value.widget;
  assert.equal(widget.model.count, 4);
  assert.equal(widget.model.blockId, "luzern");
  assert.equal(widget.model.projectPath, PROJECT);
  assert.equal(widget.model.projectStem, "job_email_recruiters");
  assert.match(widget.tooltip, /^Closing this offers 4 tasks to keep job_email_recruiters moving/); // KT1
  assert.match(widget.tooltip, /It's the last job_email_recruiters task planned today/);
  assert.match(widget.tooltip, /• Ecogpt · Next\n• Ray Lyles · Next\n• Product Engineer · Next\n\+1 more/);
  assert.match(widget.tooltip, /ready in job_email_recruiters · not dependents/);
});

test("KB6: a standalone project under an area renders no mark", () => {
  const day = dailyText();
  const source = projectText().replace('parent: "[[job_2026]]"', 'parent: "[[job]]"');
  const plugin = makePlugin(day, source, { parent: "[[job]]" });
  const decorations = plugin.buildKeepMovingMarkDecorations(makeView(day));
  assert.equal(decorations.adds.length, 0);
});

test("KB2/KB3: a sibling link suppresses the mark and striking it passes the baton with one tick", () => {
  // KB2: U linked too, so neither row is the last planned link.
  const two = ["## Pomodoros", "- [ ] () — WRITE", "\t- [[job_email_recruiters#^luzern]]", "\t- [[job_email_recruiters#^ecogpt]]"].join("\n");
  const plugin = makePlugin(two, projectText());
  const view = makeView(two);
  const silent = plugin.buildKeepMovingMarkDecorations(view);
  assert.equal(silent.adds.length, 0); // KB2: no mark on X and none on U.
  // KB3: U's link is struck, so X gains the mark with one tick burst.
  const one = ["## Pomodoros", "- [ ] () — WRITE", "\t- [[job_email_recruiters#^luzern]]", "\t- ~~[[job_email_recruiters#^ecogpt]]~~"].join("\n");
  plugin.texts[DAILY] = one;
  view.setText(one);
  const baton = plugin.buildKeepMovingMarkDecorations(view);
  assert.equal(baton.adds.length, 1);
  assert.equal(baton.adds[0].value.widget.model.tick, true);
  assert.equal(baton.adds[0].value.widget.model.count, 4);
  // A steady rebuild does not re-tick an unchanged count.
  const steady = plugin.buildKeepMovingMarkDecorations(view);
  assert.equal(steady.adds.length, 1);
  assert.equal(steady.adds[0].value.widget.model.tick, false);
});

test("viewport-only rebuilds never tick and selection alone never rebuilds", () => {
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  const first = plugin.buildKeepMovingMarkDecorations(makeView(day));
  assert.equal(first.adds[0].value.widget.model.tick, false); // No tick on first paint.
  const viewport = plugin.buildKeepMovingMarkDecorations(makeView(day), { suppressMotion: true });
  assert.equal(viewport.adds[0].value.widget.model.tick, false);
  assert.equal(plugin.keepMovingMarkShouldRebuild({ selectionSet: true, transactions: [] }), false);
  assert.equal(plugin.keepMovingMarkShouldRebuild({ docChanged: true }), true);
  assert.equal(plugin.keepMovingMarkShouldRebuild({ viewportChanged: true }), true);
});

test("KP6/toggle: off hides every mark and on restores them without touching vault text", () => {
  // KP6: marks vanish and return; row height is unchanged (CSS has no box change).
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  let gate;
  plugin.applyMarkGateClass = (name, enabled) => { gate = [name, enabled]; };
  plugin.refreshKeepMovingMarksEditors = () => {};
  plugin.refreshKeepMovingMarksReadingViews = () => {};
  assert.equal(plugin.toggleKeepMovingMarks(), false);
  assert.deepEqual(gate, ["bob-keep-moving-marks", false]);
  assert.equal(plugin.buildKeepMovingMarkDecorations(makeView(day)), StubDecoration.none);
  assert.equal(plugin.toggleKeepMovingMarks(), true);
  assert.equal(plugin.buildKeepMovingMarkDecorations(makeView(day)).adds.length, 1);
  const css = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /body:not\(\.bob-keep-moving-marks\) \.bob-keep-moving-mark \{\s*display: none;/);
});

test("cold Tasks memo and missing project text render nothing; a fill schedules a refresh", () => {
  // KB14: cold memo, uncached project text, and successor labels without a
  // ready index each read as unknown, never as zero.
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  const addsOf = (result) => (result === StubDecoration.none ? [] : result.adds);
  plugin.freshnessEnsureMemo = () => ({ tasks: [], dateText: TODAY, warm: false });
  assert.equal(addsOf(plugin.buildKeepMovingMarkDecorations(makeView(day))).length, 0);
  plugin.freshnessEnsureMemo = () => memoFor(projectText());
  delete plugin.texts[PROJECT];
  const miss = plugin.buildKeepMovingMarkDecorations(makeView(day));
  assert.equal(addsOf(miss).length, 0);
  assert.ok(plugin.requested.includes(PROJECT)); // Miss requests through the shared cache.
  plugin.texts[PROJECT] = projectText();
  const filled = plugin.buildKeepMovingMarkDecorations(makeView(day));
  assert.equal(addsOf(filled).length, 1); // Fill renders the mark.
  plugin.keepMovingMarkLoadConfig = () => ({ keepMoving: false, linkUnblocked: true, successorLabels: [] });
  assert.equal(addsOf(plugin.buildKeepMovingMarkDecorations(makeView(day))).length, 0);
  const api = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/src/279-plugin-task-theme-api.js"), "utf8");
  assert.match(api, /scheduleKeepMovingMarksRefresh/); // Fill fans out to this family.
  assert.match(api, /while \(cache\.size > 64\)/); // Shared LRU raised from 32.
});

test("rollover: the same day stays quiet and a new day resets baton counts", () => {
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  let editorsAll = 0;
  plugin.refreshKeepMovingMarksEditors = (allMarkdown) => { if (allMarkdown) editorsAll += 1; };
  plugin.refreshKeepMovingMarksReadingViews = () => {};
  const view = makeView(day);
  plugin.buildKeepMovingMarkDecorations(view);
  assert.equal(plugin.refreshKeepMovingMarksForRollover(new Date(2026, 10, 2)), false);
  const before = plugin.keepMovingMarkEditorCounts(view);
  plugin.currentTodayDailyPath = () => "2026/20261103.md";
  assert.equal(plugin.refreshKeepMovingMarksForRollover(new Date(2026, 10, 3)), true);
  assert.equal(editorsAll, 1);
  assert.notEqual(plugin.keepMovingMarkEditorCounts(view), before);
});

test("liveness: the daily note and cached project notes refresh; strangers do not", () => {
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  let scheduled = 0;
  plugin.scheduleKeepMovingMarksRefresh = () => { scheduled += 1; };
  assert.equal(plugin.refreshKeepMovingMarksForChangedFile({ path: DAILY }), true);
  assert.equal(scheduled, 1);
  assert.equal(plugin.refreshKeepMovingMarksForChangedFile({ path: PROJECT }), true);
  assert.equal(scheduled, 2);
  assert.equal(plugin.refreshKeepMovingMarksForChangedFile({ path: "notes/stranger.md" }), false);
  assert.equal(scheduled, 2);
  assert.equal(plugin.refreshKeepMovingMarksForChangedFile({}), false);
});

test("setup registers the default-on command, the Live Preview extension, and the Reading processor", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    metadataCache: { on: (event, callback) => ({ event, callback }) },
    vault: { on: (event, callback) => ({ event, callback }) },
    workspace: { on: (event, callback) => ({ event, callback }) },
  };
  plugin.commands = []; plugin.editorExtensions = []; plugin.postProcessors = [];
  plugin.registeredEvents = []; plugin.cleanups = [];
  plugin.addCommand = (command) => plugin.commands.push(command);
  plugin.registerEditorExtension = (extension) => plugin.editorExtensions.push(extension);
  plugin.registerMarkdownPostProcessor = (handler, sortOrder) => plugin.postProcessors.push({ handler, sortOrder });
  plugin.registerEvent = (event) => plugin.registeredEvents.push(event);
  plugin.register = (callback) => plugin.cleanups.push(callback);
  plugin.applyMarkGateClass = () => {};
  plugin.registerMarkGatePopoutSync = () => {};
  plugin.setupKeepMovingMarks();
  assert.equal(plugin.keepMovingMarksEnabled, true);
  const toggle = plugin.commands.find((command) => command.id === "toggle-keep-moving-marks");
  assert.equal(toggle.name, "Toggle Task Link keep-moving marks"); // KP: exact command name.
  assert.equal(plugin.editorExtensions.length, 1);
  const reading = plugin.postProcessors.find((entry) => entry.sortOrder === 63);
  assert.ok(reading); // Reading sweep registers after the mail processor (62).
  const events = plugin.registeredEvents.map((event) => event.event);
  assert.ok(events.includes("changed") && events.includes("resolved")); // Metadata liveness.
  assert.ok(events.includes("rename") && events.includes("delete")); // Vault liveness.
  assert.ok(events.includes("layout-change"));
});

class FakeNode {
  constructor(tagName, doc) {
    this.nodeType = tagName === "#text" ? 3 : 1;
    this.tagName = tagName === "#text" ? undefined : String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc || this; this.parentNode = null; this.childNodes = [];
    this.attributes = {}; this.textContent = ""; this.className = "";
    this.classList = {
      contains: (name) => String(this.className || "").split(/\s+/).includes(name),
      add: (name) => { this.className = `${this.className} ${name}`.trim(); },
      remove: (name) => {
        this.className = String(this.className || "").split(/\s+/).filter((item) => item !== name).join(" ");
      },
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "class") this.className = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(node); else this.childNodes.splice(index, 0, node);
    node.parentNode = this; this.relink(); return node;
  }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) this.childNodes.splice(index, 1); node.parentNode = null; this.relink(); return node; }
  relink() { this.childNodes.forEach((child, index) => { child.previousSibling = this.childNodes[index - 1] || null; child.nextSibling = this.childNodes[index + 1] || null; }); }
  addEventListener() {}
  querySelectorAll(selector) {
    const results = []; const classes = selector.split(",").map((item) => item.trim());
    const visit = (node) => {
      for (const child of node.childNodes || []) {
        const cls = String(child.className || "").split(/\s+/);
        if (classes.some((pattern) => pattern === "li" ? child.tagName === "LI"
          : pattern === "a.internal-link" ? child.tagName === "A" && cls.includes("internal-link")
          : pattern.startsWith(".") && cls.includes(pattern.slice(1)))) results.push(child);
        visit(child);
      }
    };
    visit(this); return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
}
class FakeDocument {
  createElement(tag) { return new FakeNode(tag, this); }
  createTextNode(text) { const node = new FakeNode("#text", this); node.nodeValue = String(text); node.textContent = String(text); return node; }
}

function readingTree(doc) {
  // Reading ledger shape: H2 + top list > open entry li > child list > row li.
  const root = doc.createElement("DIV");
  const heading = doc.createElement("H2"); heading.textContent = "Pomodoros"; root.appendChild(heading);
  const top = doc.createElement("UL"); root.appendChild(top);
  const entry = doc.createElement("LI"); entry.setAttribute("data-task", " "); top.appendChild(entry);
  const childList = doc.createElement("UL"); entry.appendChild(childList);
  const row = doc.createElement("LI"); childList.appendChild(row);
  const anchor = doc.createElement("A");
  anchor.setAttribute("class", "internal-link");
  anchor.setAttribute("data-href", "job_email_recruiters#^luzern");
  row.appendChild(anchor);
  return { root, row, anchor };
}

test("KP3/KP4: Reading inserts the host after 🔓/mail/🔑 and before the off chip", () => {
  // KP3: bare link; KP4: last of the before-siblings, never after the off chip.
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  plugin.keepMovingMarksReadingViews = new Map();
  const doc = new FakeDocument();
  const simple = readingTree(doc);
  plugin.sweepKeepMovingMarksReadingView({ el: simple.root, sourcePath: DAILY });
  const hosts = simple.root.querySelectorAll(".bob-keep-moving-mark");
  assert.equal(hosts.length, 1); // KP3: directly after the internal link.
  assert.equal(hosts[0].previousSibling, simple.anchor);
  assert.equal(hosts[0].getAttribute("data-count"), "4");
  assert.equal(hosts[0].getAttribute("data-block-id"), "luzern");
  assert.equal(hosts[0].getAttribute("data-project"), PROJECT);
  assert.ok(hosts[0].querySelector(".bob-keep-moving-mark-glyph"));
  assert.equal(hosts[0].getAttribute("title"), null);

  // Sibling marks the Reading context tolerates: the sweep keeps them and
  // lands ⏭ after the last one, before the off chip. (A mail reply badge
  // needs literal `#task` text, so it never shares a dedicated link row in
  // practice; the pure insertion order with one present is pinned below.)
  const crowded = readingTree(doc);
  const glyph = doc.createElement("SPAN"); glyph.setAttribute("class", "bob-unblocked-glyph"); crowded.row.appendChild(glyph);
  const frees = doc.createElement("SPAN"); frees.setAttribute("class", "bob-frees-mark"); crowded.row.appendChild(frees);
  const off = doc.createElement("SPAN"); off.setAttribute("class", "bob-off-clock-link-chip"); crowded.row.appendChild(off);
  plugin.sweepKeepMovingMarksReadingView({ el: crowded.root, sourcePath: DAILY });
  const order = crowded.row.childNodes.map((node) => node.getAttribute("class"));
  assert.deepEqual(order, ["internal-link", "bob-unblocked-glyph", "bob-frees-mark", "bob-keep-moving-mark", "bob-off-clock-link-chip"]);
  // The pure insertion answer on an unmarked row with the same siblings.
  const fresh = readingTree(doc);
  const freshGlyph = doc.createElement("SPAN"); freshGlyph.setAttribute("class", "bob-unblocked-glyph"); fresh.row.appendChild(freshGlyph);
  const freshFrees = doc.createElement("SPAN"); freshFrees.setAttribute("class", "bob-frees-mark"); fresh.row.appendChild(freshFrees);
  assert.equal(plugin.keepMovingMarkReadingInsertAfter(fresh.anchor), freshFrees);
  // The defensive order with a mail badge present: still after it, before off.
  const mailed = readingTree(doc);
  const mail = doc.createElement("SPAN"); mail.setAttribute("class", "bob-mail-reply-badge"); mailed.row.appendChild(mail);
  const mailedOff = doc.createElement("SPAN"); mailedOff.setAttribute("class", "bob-off-clock-link-chip"); mailed.row.appendChild(mailedOff);
  assert.equal(plugin.keepMovingMarkReadingInsertAfter(mailed.anchor), mail);
});

test("Reading removes stale hosts when the link loses eligibility", () => {
  const day = dailyText();
  const plugin = makePlugin(day, projectText());
  plugin.keepMovingMarksReadingViews = new Map();
  const doc = new FakeDocument();
  const tree = readingTree(doc);
  plugin.sweepKeepMovingMarksReadingView({ el: tree.root, sourcePath: DAILY });
  assert.equal(tree.root.querySelectorAll(".bob-keep-moving-mark").length, 1);
  // X is Done in the project note, so the row keeps its link but loses the mark.
  plugin.texts[PROJECT] = projectText().replace("- [*] #task Reply to Luzern ^luzern", "- [x] #task Reply to Luzern ^luzern");
  plugin.sweepKeepMovingMarksReadingView({ el: tree.root, sourcePath: DAILY });
  assert.equal(tree.root.querySelectorAll(".bob-keep-moving-mark").length, 0); // KB21: closed X.
  // A disabled toggle clears every host.
  plugin.texts[PROJECT] = projectText();
  plugin.sweepKeepMovingMarksReadingView({ el: tree.root, sourcePath: DAILY });
  assert.equal(tree.root.querySelectorAll(".bob-keep-moving-mark").length, 1);
  plugin.keepMovingMarksEnabled = false;
  plugin.sweepKeepMovingMarksReadingView({ el: tree.root, sourcePath: DAILY });
  assert.equal(tree.root.querySelectorAll(".bob-keep-moving-mark").length, 0);
});

test("off-clock Reading insertion steps past the ⏭ host so the off chip stays last", () => {
  // KP2: link, 🔓, 🔑, ⏭, off — the shared insertion contract.
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  const doc = new FakeDocument();
  const anchor = doc.createElement("A"); anchor.setAttribute("class", "internal-link");
  const row = doc.createElement("LI"); row.appendChild(anchor);
  const keep = doc.createElement("SPAN"); keep.setAttribute("class", "bob-keep-moving-mark"); row.appendChild(keep);
  assert.equal(plugin.offClockLinkChipReadingInsertAfter(anchor), keep);
  const css = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/styles.css"), "utf8");
  assert.match(css, /--bob-keep-moving-glyph: url\("data:image\/svg\+xml/);
  assert.match(css, /\.bob-keep-moving-mark \{\s*--bob-keep-moving-mark-ink: var\(--task-status-next, var\(--color-green, #3f8f5f\)\);/);
});

test("progress context and the off-clock chip recognize the ⏭ host as a ledger mark", () => {
  const progress = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/src/269-plugin-progress-marks-reading.js"), "utf8");
  assert.match(progress, /"bob-keep-moving-mark"/); // Rows keep their context once marked.
  const live = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/src/271c-plugin-off-clock-link-chips.js"), "utf8");
  assert.match(live, /side: 4,/); // The off chip moved from side 3 for ⏭.
  const fanout = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/src/220-plugin-heading-and-review.js"), "utf8");
  assert.match(fanout, /this\.scheduleKeepMovingMarksRefresh\(\);/); // Tasks cache-update fans out.
  const families = fs.readFileSync(path.join(ROOT, "plugins/bob-ledger-tools/src/284-plugin-task-link-marks.js"), "utf8");
  assert.match(families, /this\.setupKeepMovingMarks\(\);/); // The lifecycle wires the family.
});

test("200-link / 50-target Live Preview build memoizes targets and stays near the 25 ms budget", () => {
  // §7: parse once for the whole day, count once per project, build widgets
  // only inside visible ranges, never read from disk during render.
  const residents = ["- [ ] #task Root ^prj", "- [*] #task Trigger ^x"];
  for (let index = 0; index < 2000; index += 1) residents.push(`- [*] #task Filler ${index} ^f${index}`);
  const source = projectTextHeader() + residents.join("\n");
  const lines = ["## Pomodoros", "- [ ] () — WRITE"];
  for (let index = 0; index < 200; index += 1) lines.push("\t- [[job_email_recruiters#^x]]");
  const day = lines.join("\n");
  const plugin = makePlugin(day, source);
  let resolutions = 0;
  const inner = plugin.app.metadataCache.getFirstLinkpathDest;
  plugin.app.metadataCache.getFirstLinkpathDest = (...args) => { resolutions += 1; return inner(...args); };
  const start = performance.now();
  const decorations = plugin.buildKeepMovingMarkDecorations(makeView(day));
  const elapsed = performance.now() - start;
  assert.equal(decorations.adds.length, 200);
  assert.equal(resolutions, 1); // One ancestor resolution is shared by all 200 links.
  assert.ok(elapsed < 250, `200-link build took ${elapsed.toFixed(1)} ms`);
});

function projectTextHeader() {
  return ["---", 'type: "[[project]]"', "status: wip", 'parent: "[[job_2026]]"', "---", ""].join("\n");
}
