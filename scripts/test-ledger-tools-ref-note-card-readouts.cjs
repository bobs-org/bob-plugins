// Ref Card reading-state readouts (bob-cli-qp ref-readouts): the lane chip,
// Today pill, annotations, reread lineage, identifiers, and diagnostics
// patch into the existing rows; spy tests prove there are no spawns.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin, makeFreshnessApp, TestNotice } = require("./ledger-tools-harness.cjs");

const {
  refNoteCardReadoutSlots,
  refNoteCardLaneModel,
  refNoteCardVersionModel,
  refNoteCardIdentifierModels,
  refNoteCardAnnotationsModel,
  refNoteCardLintModels,
  refNoteCardReadoutDigest,
  refNoteCardReadoutTruncate,
  refNoteCardReadoutDateLabel,
  refNoteCardReadoutFill,
  BobLedgerToolsRefNoteCardReadoutsMixin,
} = LedgerToolsPlugin.helpers;

const FIXTURE_PATH = path.join(__dirname, "fixtures", "ref-cards", "ref-list.json");
const FIXTURE_TEXT = fs.readFileSync(FIXTURE_PATH, "utf8");
const { refLibraryReportDecode } = LedgerToolsPlugin.helpers;

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
    this.focused = false;
    this.scrolled = [];
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
  remove() { try { this.parentNode?.removeChild?.(this); } catch (_) {} }
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
      if (!part) return false;
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

function eventSource() {
  const handlers = new Map();
  return {
    on(event, callback) {
      const ref = { event, callback };
      const list = handlers.get(event) || [];
      list.push(ref);
      handlers.set(event, list);
      return ref;
    },
    offref(ref) {
      const list = handlers.get(ref.event) || [];
      handlers.set(ref.event, list.filter((item) => item !== ref));
    },
    count(event) { return (handlers.get(event) || []).length; },
  };
}

function makePlugin() {
  const app = makeFreshnessApp({ tasks: [] });
  const vault = eventSource();
  const metadata = eventSource();
  const workspace = eventSource();
  const files = new Map();
  const opened = [];
  app.vault = {
    on: vault.on.bind(vault),
    offref: vault.offref.bind(vault),
    getAbstractFileByPath: (target) => (files.has(target) ? files.get(target) : null),
  };
  app.metadataCache = {
    on: metadata.on.bind(metadata),
    offref: metadata.offref.bind(metadata),
    getFileCache: () => null,
  };
  app.workspace = {
    on: workspace.on.bind(workspace),
    offref: workspace.offref.bind(workspace),
    openLinkText: async (target, source, pane) => { opened.push([target, source, pane]); },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.registerEvent = () => {};
  plugin.isTodayCacheReady = () => false;
  plugin.todayCache = { rank: new Map() };
  plugin.todayLocalDate = () => "2026-11-26";
  plugin.refLibraryReportSpawn = async () => { throw new Error("readouts never spawn"); };
  return { plugin, app, vault, metadata, workspace, files, opened };
}

function decoded() {
  const result = refLibraryReportDecode(FIXTURE_TEXT, "");
  assert.equal(result.ok, true);
  return result.report;
}

function pluginWithSnapshot() {
  const setup = makePlugin();
  setup.plugin.refLibraryReportSnapshot = decoded();
  setup.plugin.refLibraryReportReceivedAt = Date.now();
  return setup;
}

function rowWith(overrides = {}) {
  return {
    path: "ref/row.md",
    status: "next",
    status_sync: "ok",
    reading_state: "queued",
    blocked: false,
    blocked_by: [],
    task: { path: "memory.md", block_id: "ref-row", link: "[[memory#^ref-row|Row]]", mark: " ", archived: false, priority: null, scheduled: null },
    earlier: [],
    reading: null,
    identity: null,
    author: null,
    published: null,
    finished: null,
    source_pdf: null,
    audio: null,
    annotation_count: null,
    comment_count: null,
    snapshot: null,
    diagnostics: [],
    ...overrides,
  };
}

function laneSlot(doc) {
  const slot = doc.createElement("span");
  slot.setAttribute("data-ref-lane", "true");
  slot.setAttribute("data-state", "waiting");
  slot.setAttribute("aria-hidden", "true");
  return slot;
}

function cardSkeleton(doc, { pdf = "lib/row.pdf" } = {}) {
  const card = doc.createElement("section");
  card.appendChild(laneSlot(doc));
  const version = doc.createElement("span");
  version.setAttribute("data-ref-version", "true");
  version.setAttribute("data-state", "waiting");
  version.setAttribute("aria-hidden", "true");
  card.appendChild(version);
  const byline = doc.createElement("div");
  byline.setAttribute("data-ref-byline", "true");
  const identifiers = doc.createElement("span");
  identifiers.setAttribute("data-ref-identifiers", "true");
  identifiers.setAttribute("data-state", "waiting");
  identifiers.setAttribute("aria-hidden", "true");
  byline.appendChild(identifiers);
  card.appendChild(byline);
  const access = doc.createElement("div");
  access.setAttribute("data-ref-access-row", "true");
  if (pdf) {
    const button = doc.createElement("button");
    button.setAttribute("data-ref-pdf", pdf);
    access.appendChild(button);
  }
  const readouts = doc.createElement("div");
  readouts.setAttribute("data-ref-readouts", "true");
  readouts.setAttribute("data-state", "reserved");
  const annotations = doc.createElement("span");
  annotations.setAttribute("data-ref-annotations", "true");
  annotations.setAttribute("data-state", "waiting");
  annotations.setAttribute("aria-hidden", "true");
  readouts.appendChild(annotations);
  access.appendChild(readouts);
  card.appendChild(access);
  const lint = doc.createElement("span");
  lint.setAttribute("data-ref-lint", "true");
  lint.setAttribute("data-state", "waiting");
  lint.setAttribute("aria-hidden", "true");
  card.appendChild(lint);
  return card;
}

test("the refreshed ref-cards fixture decodes into five lane rows", () => {
  const fixture = JSON.parse(FIXTURE_TEXT);
  assert.equal(fixture.schema_version, 1);
  assert.equal(fixture.coverage.ref_dir, "ref");
  assert.equal(fixture.refs.length, 5);
  const report = decoded();
  assert.equal(report.rowsByPath.size, 5);
  assert.deepEqual(
    [...report.rowsByPath.values()].map((row) => [row.path, row.status]),
    [
      ["ref/ref-finished-blog.md", "read"],
      ["ref/ref-next-chat.md", "next"],
      ["ref/ref-blocked-paper.md", "ready"],
      ["ref/ref-arxiv-paper.md", "next"],
      ["ref/ref-legacy-book.md", "legacy"],
    ],
  );
});

test("a missing snapshot or row clears every readout instead of guessing", () => {
  const { plugin } = makePlugin();
  assert.equal(plugin.refNoteCardReadoutFor("ref/ref-next-chat.md", null), null);
  const before = pluginWithSnapshot();
  assert.equal(before.plugin.refNoteCardReadoutFor("ref/missing.md", null), null);
  assert.ok(before.plugin.refNoteCardReadoutFor("ref/ref-next-chat.md", null));
  before.plugin.teardownRefLibraryReport();
  assert.equal(before.plugin.refNoteCardReadoutFor("ref/ref-next-chat.md", null), null);
});

test("lane chips cover every report state", () => {
  const today = "2026-11-26";
  assert.deepEqual(
    { ...refNoteCardLaneModel(rowWith({ status: "wip" }), { today }) },
    { id: "reading", text: "📖 Reading", tooltip: "", link: "memory#^ref-row", priority: null, today: false },
  );
  assert.equal(refNoteCardLaneModel(rowWith({ status: "ready" }), { today }).text, "📥 Ready");
  const next = refNoteCardLaneModel(rowWith({ status: "next" }), { today });
  assert.equal(next.text, "⭐ Next");
  assert.equal(next.today, false);
  assert.equal(refNoteCardLaneModel(rowWith({ status: "read", finished: "2026-10-23" }), { today }).text, "✓ Read · Oct 23");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "read", finished: null }), { today }).text, "✓ Read");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "read", finished: "2023-02-29" }), { today }).text, "✓ Read");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "abandoned" }), { today }).text, "Dropped");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "legacy", reading_state: "started" }), { today }).text, "🗄 Legacy · started");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "legacy", reading_state: "queued" }), { today }).text, "🗄 Legacy · queued");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "legacy", reading_state: "finished" }), { today }).text, "🗄 Legacy · finished");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "legacy", reading_state: "dropped" }), { today }).text, "🗄 Legacy · dropped");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "legacy", reading_state: "unknown" }), { today }).text, "🗄 Legacy");
  assert.equal(refNoteCardLaneModel(rowWith({ status: "legacy", reading_state: null }), { today }).text, "🗄 Legacy");
  assert.equal(refNoteCardLaneModel(rowWith({ status: null }), { today }), null);
  assert.equal(refNoteCardLaneModel(rowWith({ status: "unknown" }), { today }), null);
  assert.equal(refNoteCardLaneModel(null, { today }), null);
});

test("a snoozed lane reuses the board reason wording", () => {
  const today = "2026-11-26";
  const scheduled = refNoteCardLaneModel(rowWith({
    status: "ready",
    blocked: true,
    blocked_by: [{ kind: "local_schedule", date: "2026-12-03" }],
  }), { today });
  assert.equal(scheduled.text, "💤 Snoozed · until Dec 3");
  assert.ok(scheduled.tooltip.includes("Dec 3"), scheduled.tooltip);

  const dep = refNoteCardLaneModel(rowWith({
    status: "wip",
    blocked: true,
    blocked_by: [{ kind: "local_dependency", prerequisites: [{ title: "Read the prerequisite", path: "daily/2026-11-26.md" }] }],
  }), { today });
  assert.equal(dep.text, "💤 Snoozed · after Read the prerequisite");
  assert.ok(dep.tooltip.includes("Read the prerequisite"), dep.tooltip);

  const many = refNoteCardLaneModel(rowWith({
    status: "wip",
    blocked: true,
    blocked_by: [{ kind: "local_dependency", prerequisites: [{ title: "First" }, { title: "Second" }, { title: "Third" }] }],
  }), { today });
  assert.equal(many.text, "💤 Snoozed · after First +2");
  assert.ok(many.tooltip.includes("First"), many.tooltip);

  const bare = refNoteCardLaneModel(rowWith({ status: "ready", blocked: true, blocked_by: null }), { today });
  assert.equal(bare.text, "💤 Snoozed");
  assert.ok(bare.tooltip.length > 0);

  const long = refNoteCardLaneModel(rowWith({
    status: "wip",
    blocked: true,
    blocked_by: [{ kind: "local_dependency", prerequisites: [{ title: "A very long prerequisite title that runs past the limit" }] }],
  }), { today });
  assert.ok(long.text.endsWith("…"), long.text);
});

test("a status conflict wins over every lane with bob's message", () => {
  const today = "2026-11-26";
  const conflict = refNoteCardLaneModel(rowWith({
    status: "conflict",
    status_sync: "conflict",
    diagnostics: [{ code: "status_conflict", detail: "tracker targets wip but frontmatter moved to next" }],
  }), { today });
  assert.deepEqual({ ...conflict }, {
    id: "conflict",
    text: "⚠ Status conflict",
    tooltip: "tracker targets wip but frontmatter moved to next",
    link: "",
    priority: null,
    today: false,
  });
  const generic = refNoteCardLaneModel(rowWith({ status: "next", status_sync: "conflict" }), { today });
  assert.equal(generic.text, "⚠ Status conflict");
  assert.ok(generic.tooltip.length > 0);
  assert.equal(generic.id, "conflict");
  const pending = refNoteCardLaneModel(rowWith({ status: "next", status_sync: "pending" }), { today });
  assert.equal(pending.text, "⭐ Next");
  assert.equal(pending.id, "next");
});

test("open lanes append the priority glyph and the Today pill", () => {
  const doc = makeDoc();
  const ranked = rowWith({
    status: "next",
    task: { path: "memory.md", block_id: "ref-row", link: "[[memory#^ref-row|Row]]", mark: " ", priority: "high", scheduled: null },
  });
  const model = refNoteCardLaneModel(ranked, { today: "2026-11-26", todayRanked: true });
  assert.ok(model.priority);
  assert.equal(model.today, true);
  const card = cardSkeleton(doc);
  assert.equal(refNoteCardReadoutFill(doc, card, { lane: model }, {}), true);
  const lane = card.querySelector("[data-ref-lane]");
  assert.equal(lane.getAttribute("data-state"), "ready");
  assert.equal(lane.getAttribute("data-lane"), "next");
  assert.equal(lane.getAttribute("aria-label"), "⭐ Next, High priority, ranked today");
  const mark = lane.querySelector(".bob-priority-mark");
  assert.ok(mark);
  assert.equal(mark.getAttribute("data-priority"), "high");
  assert.equal(mark.getAttribute("aria-hidden"), "true");
  const pill = lane.querySelector(".bob-ref-card-today");
  assert.ok(pill);
  assert.equal(pill.textContent, "TODAY");

  const plain = cardSkeleton(doc);
  refNoteCardReadoutFill(doc, plain, { lane: refNoteCardLaneModel(rowWith({ status: "wip" }), { today: "2026-11-26" }) }, {});
  assert.equal(plain.querySelector(".bob-priority-mark"), null);
  assert.equal(plain.querySelector(".bob-ref-card-today"), null);
  assert.equal(plain.querySelector("[data-ref-lane]").getAttribute("aria-label"), "📖 Reading");
});

test("a lane without a report row leaves no chip", () => {
  const doc = makeDoc();
  const card = cardSkeleton(doc);
  assert.equal(refNoteCardReadoutFill(doc, card, null, {}), true);
  const lane = card.querySelector("[data-ref-lane]");
  assert.equal(lane.getAttribute("data-state"), "waiting");
  assert.equal(lane.getAttribute("aria-hidden"), "true");
  assert.equal(lane.textContent, "");
});

test("the vN chip lists earlier readings and opens the newest", async () => {
  const row = decoded().rowsByPath.get("ref/ref-arxiv-paper.md");
  const version = refNoteCardVersionModel(row);
  assert.deepEqual({ ...version }, {
    text: "v2",
    tooltip: "Earlier readings: v1 · replaced capture",
    target: "ref/papers/attention-is-all-you-need__v1",
  });
  assert.equal(refNoteCardVersionModel(rowWith({ reading: 1, earlier: [{ target: "ref/x", label: "v1" }] })), null);
  assert.equal(refNoteCardVersionModel(rowWith({ reading: 2, earlier: [] })), null);
  assert.equal(refNoteCardVersionModel(rowWith({ reading: null })), null);
  assert.equal(refNoteCardVersionModel(null), null);

  const doc = makeDoc();
  const { plugin, opened } = pluginWithSnapshot();
  const card = cardSkeleton(doc);
  plugin.refNoteCardReadoutSubscribe("ref/ref-arxiv-paper.md");
  assert.equal(plugin.refNoteCardPaintReadouts(card, "ref/ref-arxiv-paper.md", doc, { model: { sourcePdf: "lib/attention-is-all-you-need.pdf" } }), true);
  const slot = card.querySelector("[data-ref-version]");
  assert.equal(slot.getAttribute("data-state"), "ready");
  const chip = slot.querySelector(".bob-ref-card-version-chip");
  assert.ok(chip);
  assert.equal(chip.textContent, "v2");
  assert.equal(chip.getAttribute("title"), "Earlier readings: v1 · replaced capture");
  chip.fire("click");
  await Promise.resolve();
  assert.deepEqual(opened, [["ref/papers/attention-is-all-you-need__v1", "ref/ref-arxiv-paper.md", false]]);

  const empty = cardSkeleton(doc);
  assert.equal(refNoteCardReadoutFill(doc, empty, { version: null }, {}), true);
  assert.equal(empty.querySelector("[data-ref-version]").getAttribute("data-state"), "waiting");
});

test("identifier chips copy the raw arXiv and DOI values", async () => {
  const arxiv = refNoteCardIdentifierModels(decoded().rowsByPath.get("ref/ref-arxiv-paper.md"));
  assert.deepEqual(arxiv.map((entry) => ({ ...entry })), [{
    kind: "arxiv",
    label: "arXiv",
    value: "1706.03762",
    text: "arXiv:1706.03762 ⧉",
    tooltip: "Copy arXiv identifier",
  }]);
  const doi = refNoteCardIdentifierModels(decoded().rowsByPath.get("ref/ref-finished-blog.md"));
  assert.equal(doi.length, 1);
  assert.equal(doi[0].text, "doi:10.5555/example ⧉");
  assert.deepEqual(refNoteCardIdentifierModels(rowWith({})), []);
  assert.deepEqual(refNoteCardIdentifierModels(null), []);

  const copied = [];
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (value) => { copied.push(value); } } },
    configurable: true,
    writable: true,
  });
  TestNotice.messages.length = 0;
  try {
    const doc = makeDoc();
    const { plugin } = pluginWithSnapshot();
    const card = cardSkeleton(doc);
    plugin.refNoteCardReadoutSubscribe("ref/ref-arxiv-paper.md");
    assert.equal(plugin.refNoteCardPaintReadouts(card, "ref/ref-arxiv-paper.md", doc, { model: { sourcePdf: "lib/x.pdf" } }), true);
    const slot = card.querySelector("[data-ref-identifiers]");
    assert.equal(slot.getAttribute("data-state"), "ready");
    assert.ok(slot.textContent.includes(" · "));
    const chip = slot.querySelector(".bob-ref-card-identifier");
    assert.ok(chip);
    assert.equal(chip.getAttribute("title"), "Copy arXiv identifier");
    chip.fire("click");
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(copied, ["1706.03762"]);
    assert.ok(TestNotice.messages.some((message) => message.includes("1706.03762")), JSON.stringify(TestNotice.messages));
  } finally {
    if (priorNavigator) Object.defineProperty(globalThis, "navigator", priorNavigator);
    else delete globalThis.navigator;
  }
  TestNotice.messages.length = 0;

  const doc = makeDoc();
  const bare = cardSkeleton(doc);
  assert.equal(refNoteCardReadoutFill(doc, bare, { identifiers: [] }, {}), true);
  assert.equal(bare.querySelector("[data-ref-identifiers]").getAttribute("data-state"), "waiting");
});

test("annotations show nonzero counts with the scan date and jump to Highlights", () => {
  const today = "2026-11-26";
  const full = refNoteCardAnnotationsModel(decoded().rowsByPath.get("ref/ref-arxiv-paper.md"), { today });
  assert.deepEqual({ ...full }, {
    text: "✎ 12 annotations · 4 with notes",
    tooltip: "From the Highlights scan on Nov 20; not live PDF state.",
    notes: 12,
    comments: 4,
  });
  const single = refNoteCardAnnotationsModel(rowWith({ annotation_count: 1, comment_count: 0 }), { today });
  assert.equal(single.text, "✎ 1 annotation");
  assert.equal(single.tooltip, "From the last Highlights scan; not live PDF state.");
  assert.equal(refNoteCardAnnotationsModel(rowWith({ annotation_count: 0, comment_count: 0 }), { today }), null);
  assert.equal(refNoteCardAnnotationsModel(rowWith({}), { today }), null);
  assert.equal(refNoteCardAnnotationsModel(null, { today }), null);

  const doc = makeDoc();
  const { plugin } = pluginWithSnapshot();
  const card = cardSkeleton(doc);
  const cursors = [];
  const editor = { setCursor: (pos) => cursors.push(pos), scrollIntoView: () => {} };
  plugin.refNoteCardReadoutSubscribe("ref/ref-arxiv-paper.md");
  assert.equal(plugin.refNoteCardPaintReadouts(card, "ref/ref-arxiv-paper.md", doc, { model: { sourcePdf: "lib/x.pdf" }, editor }), true);
  const readouts = card.querySelector("[data-ref-readouts]");
  assert.equal(readouts.getAttribute("data-state"), "ready");
  const chip = card.querySelector(".bob-ref-card-annotations-chip");
  assert.ok(chip);
  assert.equal(chip.textContent, "✎ 12 annotations · 4 with notes");

  plugin.app.vault.getAbstractFileByPath = () => ({ path: "ref/ref-arxiv-paper.md" });
  plugin.app.metadataCache.getFileCache = () => ({ headings: [{ heading: "Highlights", level: 2, position: { start: { line: 42 } } }] });
  chip.fire("click");
  assert.deepEqual(cursors, [{ line: 42, ch: 0 }]);

  const reading = makeDoc().createElement("div");
  const head = makeDoc().createElement("h2");
  head.appendChild(makeDoc().createTextNode("Highlights"));
  reading.appendChild(head);
  assert.equal(plugin.refNoteCardJumpHighlights("ref/ref-arxiv-paper.md", { scope: reading }), true);
  assert.equal(head.scrolled.length, 1);
  assert.equal(plugin.refNoteCardJumpHighlights("ref/ref-arxiv-paper.md", { scope: makeDoc().createElement("div") }), false);

  const quiet = cardSkeleton(doc);
  assert.equal(refNoteCardReadoutFill(doc, quiet, { annotations: null }, {}), true);
  assert.equal(quiet.querySelector("[data-ref-readouts]").getAttribute("data-state"), "reserved");
  assert.equal(quiet.querySelector("[data-ref-annotations]").getAttribute("data-state"), "waiting");
});

test("the foot lint holds diagnostics, conflicts, and the missing PDF", () => {
  const diagnosed = refNoteCardLintModels(rowWith({
    status: "ready",
    diagnostics: [{ code: "parent_mismatch", detail: "The task is filed under a different parent." }],
  }), {});
  assert.deepEqual(diagnosed.map((line) => ({ ...line })), [{
    code: "parent_mismatch",
    text: "parent_mismatch: The task is filed under a different parent.",
  }]);
  const conflict = refNoteCardLintModels(rowWith({
    status: "conflict",
    status_sync: "conflict",
    diagnostics: [{ code: "status_conflict", detail: "tracker targets wip but frontmatter moved to next" }],
  }), {});
  assert.deepEqual(conflict.map((line) => ({ ...line })), [{
    code: "status_conflict",
    text: "status_conflict: tracker targets wip but frontmatter moved to next",
  }]);
  const generic = refNoteCardLintModels(rowWith({ status: "next", status_sync: "conflict" }), {});
  assert.equal(generic.length, 1);
  assert.equal(generic[0].code, "status_sync");
  const pending = refNoteCardLintModels(rowWith({ status: "next", status_sync: "pending" }), {});
  assert.deepEqual(pending, []);
  const missing = refNoteCardLintModels(rowWith({}), { pdfMissing: true, pdfPath: "lib/gone.pdf" });
  assert.deepEqual(missing.map((line) => ({ ...line })), [{ code: "missing_pdf", text: "PDF not found at lib/gone.pdf" }]);
  assert.deepEqual(refNoteCardLintModels(rowWith({}), {}), []);

  const doc = makeDoc();
  const { plugin } = pluginWithSnapshot();
  const card = cardSkeleton(doc, { pdf: "lib/gone.pdf" });
  plugin.refNoteCardReadoutSubscribe("ref/ref-next-chat.md");
  assert.equal(plugin.refNoteCardPaintReadouts(card, "ref/ref-next-chat.md", doc, { model: { sourcePdf: "lib/gone.pdf" } }), true);
  assert.equal(card.querySelector("[data-ref-pdf]"), null, "a declared PDF missing from the vault drops the chip");
  const lint = card.querySelector("[data-ref-lint]");
  assert.equal(lint.getAttribute("data-state"), "ready");
  assert.ok(lint.textContent.includes("PDF not found at lib/gone.pdf"), lint.textContent);

  const present = cardSkeleton(doc, { pdf: "lib/here.pdf" });
  plugin.app.vault.getAbstractFileByPath = () => ({ path: "lib/here.pdf" });
  assert.equal(plugin.refNoteCardPaintReadouts(present, "ref/ref-next-chat.md", doc, { model: { sourcePdf: "lib/here.pdf" } }), true);
  assert.ok(present.querySelector("[data-ref-pdf]"));
  assert.equal(present.querySelector("[data-ref-lint]").getAttribute("data-state"), "waiting");

  const empty = cardSkeleton(doc);
  assert.equal(refNoteCardReadoutFill(doc, empty, { lint: [] }, {}), true);
  assert.equal(empty.querySelector("[data-ref-lint]").getAttribute("data-state"), "waiting");
});

test("the digest separates report states and finished refs paint muted", () => {
  const { plugin } = pluginWithSnapshot();
  const finished = plugin.refNoteCardReadoutFor("ref/ref-finished-blog.md", { sourcePdf: "lib/agentic-coding-ci.pdf" });
  const next = plugin.refNoteCardReadoutFor("ref/ref-next-chat.md", null);
  assert.ok(finished);
  assert.ok(next);
  assert.equal(finished.tone, "read");
  assert.equal(next.tone, "");
  assert.notEqual(refNoteCardReadoutDigest(finished), refNoteCardReadoutDigest(next));
  assert.equal(refNoteCardReadoutDigest(null), "none");
  assert.equal(plugin.refNoteCardModelWithTone({ tone: "quiet" }, finished).tone, "read");
  assert.equal(plugin.refNoteCardModelWithTone({ tone: "legacy" }, finished).tone, "read");
  assert.equal(plugin.refNoteCardModelWithTone({ tone: "quiet" }, next).tone, "quiet");

  const stale = pluginWithSnapshot();
  const first = stale.plugin.refNoteCardReadoutFor("ref/ref-next-chat.md", null);
  stale.plugin.refLibraryReportStale = true;
  const second = stale.plugin.refNoteCardReadoutFor("ref/ref-next-chat.md", null);
  assert.ok(first && second);
  assert.equal(refNoteCardReadoutDigest(first), refNoteCardReadoutDigest(second));
});

test("subscriptions follow mounted cards and release on unload", () => {
  const { plugin, metadata, vault, workspace } = pluginWithSnapshot();
  const seen = [];
  const live = plugin.apiRefLibrarySubscribe.bind(plugin);
  plugin.apiRefLibrarySubscribe = (callback, options) => { seen.push(options); return live(callback, options); };
  assert.equal(plugin.refNoteCardReadoutSubscribe("ref/ref-next-chat.md"), true);
  assert.equal(plugin.refNoteCardReadoutSubscribe("ref/ref-next-chat.md"), true);
  assert.deepEqual(seen, [{ path: "ref/ref-next-chat.md" }]);
  assert.equal(metadata.count("changed"), 1);
  assert.equal(plugin.refNoteCardReadoutSubscribe("ref/ref-arxiv-paper.md"), true);
  assert.equal(plugin.refNoteCardReadoutTokens.size, 2);
  plugin.refNoteCardReadoutUnsubscribePath("ref/ref-next-chat.md");
  assert.equal(plugin.refNoteCardReadoutTokens.size, 1);
  assert.equal(metadata.count("changed"), 1, "listeners stay while a card is mounted");
  plugin.refNoteCardReadoutsUnbind();
  assert.equal(plugin.refNoteCardReadoutTokens.size, 0);
  assert.equal(metadata.count("changed"), 0, "last unmount releases the report listeners");
  assert.equal(vault.count("rename"), 0);
  assert.equal(workspace.count("file-open"), 0);
  plugin.refNoteCardReadoutsUnbind();
});

test("readout helpers stay pure: dates, truncation, and slots", () => {
  assert.equal(refNoteCardReadoutDateLabel("2026-10-23", "2026-11-26"), "Oct 23");
  assert.equal(refNoteCardReadoutDateLabel("2026-10-23", "2027-01-01"), "Oct 23, 2026");
  assert.equal(refNoteCardReadoutDateLabel("2017-06", "2026-11-26"), "");
  assert.equal(refNoteCardReadoutDateLabel("not-a-date", "2026-11-26"), "");
  assert.equal(refNoteCardReadoutDateLabel("2023-02-29", "2026-11-26"), "");
  assert.equal(refNoteCardReadoutTruncate("short"), "short");
  assert.equal(refNoteCardReadoutTruncate("  spaced   out  "), "spaced out");
  const long = refNoteCardReadoutTruncate("abcdefghijklmnopqrstuvwxyz0123456789", 10);
  assert.ok(long.endsWith("…") && long.length <= 10, long);
  assert.deepEqual(refNoteCardReadoutSlots(), ["lane", "counts", "identifiers", "foot"]);
});

test("the readout styles keep slots shaped and lanes honest", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"), "utf8",
  );
  for (const token of [
    "/* Ref Card (bob-cli-qp ref-readouts): start.",
    "/* Ref Card (bob-cli-qp ref-readouts): end.",
    '.bob-ref-card-lane[data-lane="reading"]',
    '.bob-ref-card-lane[data-lane="next"]',
    ".bob-ref-card-today",
    ".bob-ref-card-version-chip",
    ".bob-ref-card-identifier",
    ".bob-ref-card-annotations-chip",
    '.bob-ref-card-lint-slot[data-state="ready"]',
    '.bob-ref-card-lint-line::before',
    '.bob-ref-card[data-tone="read"]',
    ".bob-ref-card-lane[data-state=\"ready\"] { flex-basis: 100%; }",
  ]) {
    assert.ok(css.includes(token), `styles.css carries ${token}`);
  }
});

test("readouts never spawn bob and never write the vault", async () => {
  const setup = pluginWithSnapshot();
  const { plugin, opened } = setup;
  const doc = makeDoc();
  const card = cardSkeleton(doc);
  const readout = plugin.refNoteCardReadoutFor("ref/ref-next-chat.md", null);
  assert.ok(readout);
  assert.equal(plugin.refNoteCardPaintReadouts(card, "ref/ref-next-chat.md", doc, { model: null }), true);
  plugin.refNoteCardToggleSections?.("ref/ref-next-chat.md");
  plugin.refNoteCardJumpHighlights("ref/ref-next-chat.md", {});
  await plugin.refNoteCardOpenTask("ref/ref-next-chat.md", "", null);
  assert.deepEqual(opened, [], "painting and empty opens never follow links");
  TestNotice.messages.length = 0;
});

