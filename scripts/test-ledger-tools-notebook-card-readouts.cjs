// Notebook Card report-backed readouts (bob-cli-qm notebook-readouts).
// Covers the readout model gating, count/newest/folded text, section pairing
// (order, duplicates, stale renames, overflow), children, the error pill,
// warning routing, jumps, the single subscription, and the zero-spawn rule.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");
const { helpers: H } = LedgerToolsPlugin;

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
    this.scrolled = [];
    this.focused = false;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set(self.className.split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { self.setAttribute("class", self.className.split(/\s+/).filter((x) => x && x !== name).join(" ")); },
      contains(name) { return self.className.split(/\s+/).includes(name); },
    };
  }
  get className() { return this.getAttribute("class") || ""; }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.childNodes.push(node); return node; }
  insertBefore(node, before) {
    node.parentNode?.removeChild?.(node);
    const at = before ? this.childNodes.indexOf(before) : -1;
    node.parentNode = this;
    if (at < 0) this.childNodes.push(node); else this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) {
    const event = { type, button: 0, ...extra, preventDefault() { this.defaultPrevented = true; } };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrolled.push(options); }
  matches(selector) {
    return String(selector).split(",").some((raw) => {
      const part = raw.trim();
      const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      for (const cls of part.match(/\.[\w-]+/g) || []) if (!this.classList.contains(cls.slice(1))) return false;
      for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name)) return false;
        if (value !== undefined && this.getAttribute(name) !== value) return false;
      }
      return true;
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
  return {
    activeElement: null,
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeText(text, this); },
  };
}

function entryRow(overrides = {}) {
  return {
    stem: "git",
    path: "git.md",
    title: "Git",
    summary: "Git commands.",
    parent: "dev_tools",
    parent_kind: "notebook",
    owner: "dev",
    root: "dev",
    breadcrumb: ["dev", "Developer tools", "Git"],
    children: [],
    notes: 6,
    sections: [{ title: "Config", notes: 2 }, { title: "Workflow", notes: 1 }],
    last_note: "2026-11-09",
    issues: [],
    ...overrides,
  };
}

function reportWith(notebooks) {
  const report = {
    ok: true, schema_version: 1, notebooks, catalogs: [],
    counts: { notebooks: notebooks.length, roots: 0, errors: 0, warnings: 0 },
  };
  report.notebooksByPath = new Map(notebooks.map((row) => [row.path, row]));
  report.notebooksByStem = new Map(notebooks.map((row) => [row.stem, row]));
  report.catalogsByHostPath = new Map();
  return report;
}

function stateWith(report, overrides = {}) {
  return { report, stale: false, unavailable: false, today: "2026-11-26", refreshing: false, ...overrides };
}

function fakePlugin({ report, state = null, headings = {} } = {}) {
  const current = state || stateWith(report);
  const scheduled = [];
  const plugin = {
    app: {
      metadataCache: {
        getFileCache: (file) => ({ headings: headings[file && file.path] || [] }),
        getFirstLinkpathDest: (target) => ({ path: target }),
      },
      vault: { getAbstractFileByPath: (path) => ({ path }) },
    },
    notebookReportState: () => current,
    scheduled,
    scheduleNotebookCardRefresh() { scheduled.push(true); },
  };
  return { plugin, current, scheduled };
}

function mixinPlugin(options = {}) {
  const { plugin } = fakePlugin(options);
  Object.setPrototypeOf(plugin, H.BobLedgerToolsNotebookCardReadoutsMixin.prototype);
  return plugin;
}

function readoutSlot(doc) {
  const slot = doc.createElement("div");
  slot.setAttribute("class", "bob-notebook-card-readouts");
  slot.setAttribute("data-notebook-readouts", "notebook-readouts");
  for (const name of ["summary", "sections", "children", "findings"]) {
    const child = doc.createElement("div");
    child.setAttribute("class", `bob-notebook-card-${name}`);
    child.setAttribute(`data-notebook-${name}`, "true");
    slot.appendChild(child);
  }
  return slot;
}

test("notebook readout omits every part without a fresh report row", () => {
  const { plugin, current } = fakePlugin({ report: reportWith([entryRow()]) });
  assert.ok(H.notebookCardReadoutModel(plugin, "git.md"));
  current.stale = true;
  assert.equal(H.notebookCardReadoutModel(plugin, "git.md"), null);
  current.stale = false;
  current.unavailable = true;
  assert.equal(H.notebookCardReadoutModel(plugin, "git.md"), null);
  current.unavailable = false;
  current.report = null;
  assert.equal(H.notebookCardReadoutModel(plugin, "git.md"), null);
  current.report = reportWith([entryRow()]);
  assert.equal(H.notebookCardReadoutModel(plugin, "missing.md"), null);
});

test("notebook readout paints real counts and dates, never zeroes", () => {
  const doc = makeDoc();
  const { plugin } = fakePlugin({ report: reportWith([entryRow()]) });
  const readout = H.notebookCardReadoutModel(plugin, "git.md");
  const slot = readoutSlot(doc);
  assert.equal(H.notebookCardReadoutFill(doc, slot, readout, {}), true);
  assert.equal(slot.getAttribute("data-state"), "ready");
  assert.equal(slot.querySelector("[data-notebook-summary]").textContent, "6 notes · newest Nov 9");
  assert.equal(
    slot.querySelector(".bob-notebook-card-readout").getAttribute("title"),
    "6 direct notes, excluding nested detail and child notebooks. Newest authored [created::] date 2026-11-09, never file time",
  );

  const zero = H.notebookCardReadoutModel(plugin, "git.md");
  zero.notes = 0;
  zero.newest = "";
  zero.newestText = "";
  const empty = readoutSlot(doc);
  H.notebookCardReadoutFill(doc, empty, zero, {});
  assert.ok(!empty.querySelector("[data-notebook-summary]").textContent.includes("0 notes"));

  const folded = H.notebookCardReadoutModel(plugin, "git.md", { collapsed: true });
  const foldedSlot = readoutSlot(doc);
  H.notebookCardReadoutFill(doc, foldedSlot, folded, {});
  assert.equal(foldedSlot.querySelector("[data-notebook-summary]").textContent, "6 notes · newest Nov 9 · 2 sections");
});

test("notebook readout dates follow the kit wording", () => {
  assert.equal(H.notebookCardReadoutDateText("2026-11-09", "2026-11-26"), "Nov 9");
  assert.equal(H.notebookCardReadoutDateText("2025-03-11", "2026-11-26"), "Mar 11, 2025");
  assert.equal(H.notebookCardReadoutDateText("", "2026-11-26"), "");
  assert.equal(H.notebookCardReadoutDateText("not-a-date", "2026-11-26"), "");
});

test("notebook sections pair in order and tell duplicates apart by position", () => {
  const pairs = H.notebookCardPairSections(
    [{ title: "Shell", notes: 1 }, { title: "Git", notes: 2 }, { title: "Shell", notes: 3 }],
    [{ title: "Shell", line: 10 }, { title: "Git", line: 20 }, { title: "Shell", line: 30 }],
  );
  assert.deepEqual(pairs.map((row) => row.headingIndex), [0, 1, 2]);
  assert.deepEqual(pairs.map((row) => row.heading.line), [10, 20, 30]);
});

test("notebook sections fall back to title order on a stale report and keep orphans inert", () => {
  const pairs = H.notebookCardPairSections(
    [{ title: "Git", notes: 2 }, { title: "Shell", notes: 1 }],
    [{ title: "Shell", line: 10 }, { title: "Git", line: 20 }],
  );
  assert.deepEqual(pairs.map((row) => row.headingIndex), [1, 0]);

  const renamed = H.notebookCardPairSections(
    [{ title: "Shell", notes: 1 }, { title: "Git", notes: 2 }],
    [{ title: "Shell", line: 10 }, { title: "Terminal", line: 20 }],
  );
  assert.equal(renamed[0].headingIndex, 0);
  assert.equal(renamed[1].heading, null);

  const doc = makeDoc();
  const { plugin } = fakePlugin({
    report: reportWith([entryRow({ sections: [{ title: "Shell", notes: 1 }, { title: "Git", notes: 2 }] })]),
    headings: { "git.md": [{ heading: "Shell", level: 2, position: { start: { line: 10 } } }] },
  });
  const slot = readoutSlot(doc);
  H.notebookCardReadoutFill(doc, slot, H.notebookCardReadoutModel(plugin, "git.md"), {});
  const chips = slot.querySelectorAll(".bob-notebook-card-section-chip");
  assert.equal(chips.length, 2);
  assert.equal(chips[0].textContent, "§ Shell 1");
  assert.equal(chips[0].getAttribute("title"), "1 note · @git#Shell");
  assert.ok(chips[1].classList.contains("is-inert"));
  assert.equal(chips[1].getAttribute("title"), H.NOTEBOOK_CARD_READOUT_STALE_TIP);
});

test("notebook sections collapse past eight with a session +N chip", () => {
  const sections = Array.from({ length: 9 }, (_, index) => ({ title: `S${index + 1}`, notes: index + 1 }));
  const doc = makeDoc();
  const { plugin } = fakePlugin({ report: reportWith([entryRow({ sections })]) });
  const opened = [];
  const slot = readoutSlot(doc);
  H.notebookCardReadoutFill(doc, slot, H.notebookCardReadoutModel(plugin, "git.md"), {
    onToggleSections: () => opened.push(true),
  });
  assert.equal(slot.querySelectorAll(".bob-notebook-card-section-chip").length, 7);
  const more = slot.querySelector(".bob-notebook-card-sections-more");
  assert.equal(more.textContent, "+2");
  more.fire("click");
  assert.deepEqual(opened, [true]);

  const expanded = H.notebookCardReadoutModel(plugin, "git.md", { expanded: true });
  const wide = readoutSlot(doc);
  H.notebookCardReadoutFill(doc, wide, expanded, {});
  assert.equal(wide.querySelectorAll(".bob-notebook-card-section-chip").length, 9);
  assert.equal(wide.querySelector(".bob-notebook-card-sections-more"), null);
});

test("notebook children open like crumbs with report counts", () => {
  const doc = makeDoc();
  const { plugin } = fakePlugin({
    report: reportWith([
      entryRow({ children: ["child", "ghost"] }),
      entryRow({ stem: "child", path: "child.md", title: "Child", notes: 4, sections: [], last_note: null }),
    ]),
  });
  const opened = [];
  const slot = readoutSlot(doc);
  H.notebookCardReadoutFill(doc, slot, H.notebookCardReadoutModel(plugin, "git.md"), {
    onOpenChild: (target) => opened.push(target),
  });
  const kids = slot.querySelectorAll(".bob-notebook-card-child-chip");
  assert.deepEqual(kids.map((node) => node.textContent), ["↳ Child 4", "↳ ghost"]);
  kids[0].fire("click");
  assert.deepEqual(opened, ["child.md"]);
});

test("notebook errors stay a visible pill while warnings join the foot lint", () => {
  const doc = makeDoc();
  const { plugin } = fakePlugin({
    report: reportWith([entryRow({
      issues: [
        { severity: "error", code: "notebook_shape", message: "notebooks hold no tasks", line: 9 },
        { severity: "error", code: "other", message: "second problem", line: null },
        { severity: "warning", code: "stale", message: "report is old", line: null },
      ],
    })]),
  });
  const jumped = [];
  const readout = H.notebookCardReadoutModel(plugin, "git.md");
  assert.equal(readout.errors.length, 2);
  const warnings = H.notebookCardReadoutFootWarnings(readout);
  assert.deepEqual(warnings, [{ code: "stale", severity: "warning", message: "report is old", setting: "" }]);
  const slot = readoutSlot(doc);
  H.notebookCardReadoutFill(doc, slot, readout, { onJumpError: () => jumped.push(true) });
  const pill = slot.querySelector(".bob-notebook-card-error-pill");
  assert.equal(pill.textContent, "✗ 2 errors");
  assert.equal(pill.getAttribute("title"), "notebook_shape: notebooks hold no tasks\nother: second problem");
  pill.fire("click");
  assert.deepEqual(jumped, [true]);
});

test("notebook jumps move the Live Preview cursor and scroll Reading headings", () => {
  const plugin = mixinPlugin({ report: reportWith([entryRow()]) });
  const cursors = [];
  const views = [];
  const editor = {
    setCursor: (pos) => cursors.push(pos),
    scrollIntoView: (range) => views.push(range),
  };
  const row = { title: "Git", notes: 1, heading: { title: "Git", line: 20 }, headingIndex: 1 };
  assert.equal(plugin.notebookCardJumpSection("git.md", row, { editor }), true);
  assert.deepEqual(cursors, [{ line: 20, ch: 0 }]);
  assert.equal(views.length, 1);

  const heads = [0, 1].map(() => {
    const node = makeDoc().createElement("h2");
    node.scrolled = [];
    return node;
  });
  const scope = makeDoc().createElement("div");
  scope.querySelectorAll = (selector) => (selector === "h2" ? heads : []);
  assert.equal(plugin.notebookCardJumpSection("git.md", row, { scope }), true);
  assert.equal(heads[0].scrolled.length, 0);
  assert.equal(heads[1].scrolled.length, 1);

  const lines = [];
  const lineEditor = { setCursor: (pos) => lines.push(pos), scrollIntoView: () => {} };
  const faulty = mixinPlugin({
    report: reportWith([entryRow({ issues: [{ severity: "error", code: "x", message: "bad", line: 9 }] })]),
  });
  assert.equal(faulty.notebookCardJumpError("git.md", { editor: lineEditor }), true);
  assert.deepEqual(lines, [{ line: 8, ch: 0 }]);
});

test("notebook readouts subscribe once, patch on notify, and release on unload", () => {
  const plugin = mixinPlugin({ report: reportWith([entryRow()]) });
  let seen = null;
  let released = false;
  plugin.apiNotebookSubscribe = (subscriber) => { seen = subscriber; return () => { released = true; }; };
  assert.equal(plugin.notebookCardReadoutsBind(), true);
  assert.equal(typeof seen, "function");
  seen({ report: plugin.notebookReportState().report });
  assert.deepEqual(plugin.scheduled, [true]);
  plugin.notebookCardReadoutsUnbind();
  assert.equal(released, true);
});

test("notebook readouts never spawn bob and never write the vault", () => {
  const plugin = mixinPlugin({
    report: reportWith([entryRow({ children: ["child"], issues: [{ severity: "error", code: "x", message: "bad", line: 3 }] })]),
    headings: { "git.md": [{ heading: "Config", level: 2, position: { start: { line: 4 } } }] },
  });
  const spawns = [];
  plugin.notebookSpawnList = () => { spawns.push("list"); throw new Error("must not spawn"); };
  plugin.notebookSpawnSync = () => { spawns.push("sync"); throw new Error("must not spawn"); };
  plugin.apiNotebookReport = () => { spawns.push("report"); throw new Error("must not spawn"); };
  plugin.apiNotebookSync = () => { spawns.push("sync-api"); throw new Error("must not spawn"); };

  const readout = plugin.notebookCardReadoutFor("git.md", { collapsed: true });
  assert.ok(readout);
  const doc = makeDoc();
  const card = doc.createElement("section");
  const slot = readoutSlot(doc);
  card.appendChild(slot);
  assert.equal(plugin.notebookCardPaintReadouts(card, "git.md", doc, { scope: doc.createElement("div"), collapsed: true }), true);
  plugin.notebookCardToggleSections("git.md");
  plugin.notebookCardJumpSection("git.md", { title: "Config", heading: null, headingIndex: -1 }, {});
  plugin.notebookCardJumpError("git.md", {});
  assert.deepEqual(spawns, []);
});
