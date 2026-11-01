// Task link marks in Reading views and query rows. The shared resolver
// and task-target model are covered by the core and Live Preview suites;
// this suite pins DOM exclusions, source paths, stamping, sweeps, and the
// Reading-view Mod+click behavior.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

function installStubs() {
  const originalLoad = Module._load;
  Module._load = function loadWithObsidianStub(request) {
    if (request === "obsidian") {
      return {
        Notice: class {},
        Platform: { isMacOS: false, isMobile: false },
        Plugin: TestPlugin,
        normalizePath: (value) => value,
        parseYaml: (value) => JSON.parse(value),
      };
    }
    if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
    if (request === "@codemirror/view") return {};
    return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
  };
  return originalLoad;
}

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
function loadPluginModule() {
  const originalLoad = installStubs();
  try {
    delete require.cache[MAIN_PATH];
    return require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
  }
}
const LedgerToolsPlugin = loadPluginModule();

function nodeClassList(node) {
  const read = () => String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  const write = (names) => node.setAttribute("class", names.join(" "));
  return {
    add(...names) { const all = read(); for (const name of names) if (!all.includes(name)) all.push(name); write(all); },
    remove(...names) { write(read().filter((name) => !names.includes(name))); },
    contains(name) { return read().includes(name); },
  };
}

function matches(node, selector) {
  const tag = String(node.tagName || "").toLowerCase();
  const classes = String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  if (selector === "a.internal-link") return tag === "a" && classes.includes("internal-link");
  if (selector === "a[data-bob-task-link-src]") return tag === "a" && node.getAttribute("data-bob-task-link-src") !== null;
  if (selector === "li") return tag === "li";
  return false;
}

function makeDocument() {
  const doc = {
    nodeType: 9,
    childNodes: [],
    createElement(tag) { return makeElement(doc, tag); },
    createTextNode(value) { return makeText(doc, value); },
    querySelectorAll(selector) { return collect(this.body || this, selector); },
    addEventListener(type, handler, options) {
      this.listeners = this.listeners || [];
      this.listeners.push({ type, handler, options });
    },
  };
  doc.body = makeElement(doc, "body");
  doc.appendChild = (child) => append(doc, child);
  append(doc, doc.body);
  return doc;
}

function makeText(doc, value) {
  return {
    nodeType: 3,
    nodeValue: String(value),
    ownerDocument: doc,
    parentNode: null,
    nextSibling: null,
    previousSibling: null,
    get textContent() { return this.nodeValue; },
  };
}

function makeElement(doc, tag, attrs = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attrs: {},
    childNodes: [],
    ownerDocument: doc,
    parentNode: null,
    nextSibling: null,
    previousSibling: null,
    get children() { return this.childNodes.filter((child) => child.nodeType === 1); },
    get className() { return this.getAttribute("class") || ""; },
    get textContent() { return this.childNodes.map((child) => child.textContent || "").join(""); },
    set textContent(value) { this.childNodes = []; if (value) append(this, makeText(doc, value)); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    appendChild(child) { return append(this, child); },
    insertBefore(child, before) { return insert(this, child, before); },
    removeChild(child) { return remove(this, child); },
    querySelectorAll(selector) { return collect(this, selector); },
    contains(other) { let current = other; while (current) { if (current === this) return true; current = current.parentNode; } return false; },
  };
  node.classList = nodeClassList(node);
  node.dataset = new Proxy({}, {
    get(_target, key) {
      const attr = "data-" + String(key).replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
      return node.getAttribute(attr) || undefined;
    },
    set(_target, key, value) {
      const attr = "data-" + String(key).replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
      node.setAttribute(attr, value);
      return true;
    },
  });
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function detach(node) {
  if (node.parentNode) remove(node.parentNode, node);
}
function append(parent, child) { return insert(parent, child, null); }
function insert(parent, child, before) {
  detach(child);
  const index = before ? parent.childNodes.indexOf(before) : -1;
  const at = index < 0 ? parent.childNodes.length : index;
  const previous = parent.childNodes[at - 1] || null;
  const next = parent.childNodes[at] || null;
  child.parentNode = parent;
  child.previousSibling = previous;
  child.nextSibling = next;
  if (previous) previous.nextSibling = child;
  if (next) next.previousSibling = child;
  parent.childNodes.splice(at, 0, child);
  return child;
}
function remove(parent, child) {
  const index = parent.childNodes.indexOf(child);
  if (index < 0) return child;
  const previous = parent.childNodes[index - 1] || null;
  const next = parent.childNodes[index + 1] || null;
  if (previous) previous.nextSibling = next;
  if (next) next.previousSibling = previous;
  parent.childNodes.splice(index, 1);
  child.parentNode = null;
  child.previousSibling = null;
  child.nextSibling = null;
  return child;
}
function collect(root, selector) {
  const found = [];
  const walk = (node) => {
    if (!node) return;
    for (const child of node.childNodes || []) {
      if (child.nodeType === 1 && matches(child, selector)) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}
function el(doc, tag, attrs, ...children) {
  const node = makeElement(doc, tag, attrs);
  for (const child of children) node.appendChild(typeof child === "string" ? makeText(doc, child) : child);
  return node;
}
function link(doc, href, label = "target") {
  return el(doc, "a", { class: "internal-link", "data-href": href }, label);
}
function marks(root) { return collect(root, "a.internal-link").map((anchor) => anchor.previousSibling).filter((node) => node && node.classList.contains("bob-task-link-mark")); }

function makePlugin(doc, resolver) {
  const opened = [];
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    metadataCache: {
      getFirstLinkpathDest(path) { return path ? { path: path.endsWith(".md") ? path : path + ".md", extension: "md" } : null; },
    },
    workspace: {
      on() { return {}; },
      getLeavesOfType() { return []; },
      openLinkText(...args) { opened.push(args); },
    },
  };
  plugin.taskLinkMarksEnabled = true;
  plugin.taskLinkMarkTargets = new Set();
  plugin.taskLinkMarksClock = () => 1000;
  plugin.taskLinkMarkReadingDocuments = () => [doc];
  plugin.taskLinkMarkResolve = resolver;
  plugin.registeredPostProcessors = [];
  plugin.registeredDomEvents = [];
  plugin.pendingReadingFrames = [];
  plugin.taskLinkMarkReadingFrame = (callback) => plugin.pendingReadingFrames.push(callback);
  plugin.registerMarkdownPostProcessor = (handler, order) => plugin.registeredPostProcessors.push({ handler, order });
  plugin.registerDomEvent = (node, type, handler) => plugin.registeredDomEvents.push({ node, type, handler });
  plugin.registerEvent = () => {};
  plugin.register = () => {};
  plugin.setupTaskLinkMarksReading();
  return { plugin, opened };
}

function hitFor({ linkpath, blockId, sourcePath }, state = "ready") {
  return {
    key: (linkpath ? linkpath + ".md" : sourcePath) + "\u0000" + blockId,
    state,
    title: "A task title",
    targetPath: linkpath ? linkpath + ".md" : sourcePath,
  };
}

function processorFor(plugin) { return plugin.registeredPostProcessors[0].handler; }
function hostBefore(anchor) { return anchor.previousSibling && anchor.previousSibling.classList && anchor.previousSibling.classList.contains("bob-task-link-mark") ? anchor.previousSibling : null; }

test("Reading post-processor stamps source paths and inserts the shared ring host", () => {
  const doc = makeDocument();
  const calls = [];
  const { plugin } = makePlugin(doc, (input) => { calls.push(input); return hitFor(input, "next"); });
  const anchor = link(doc, "target.md#^id");
  const ordinary = link(doc, "other-note");
  const root = el(doc, "div", {}, anchor, ordinary);
  processorFor(plugin)(root, { sourcePath: "notes/source.md" });
  assert.equal(plugin.registeredPostProcessors[0].order, 55);
  assert.equal(anchor.getAttribute("data-bob-task-link-src"), "notes/source.md");
  assert.equal(hostBefore(anchor).getAttribute("data-state"), "next");
  assert.equal(hostBefore(anchor).getAttribute("role"), "img");
  assert.equal(hostBefore(anchor).getAttribute("title"), null);
  assert.equal(ordinary.getAttribute("data-bob-task-link-src"), null);
  assert.equal(hostBefore(ordinary), null);
  assert.deepEqual(calls[0], { linkpath: "target.md", blockId: "id", sourcePath: "notes/source.md" });
});

test("daily-note view wrapper does not suppress prose links", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const anchor = link(doc, "target.md#^prose");
  const root = el(doc, "div", {}, anchor);
  const view = el(doc, "div", { class: "markdown-preview-view bob-daily-note-view" }, root);
  doc.body.appendChild(view);
  processorFor(plugin)(root, { sourcePath: "2026/20261101.md" });
  assert.ok(hostBefore(anchor));
});

test("embeds render, while embed headers, metadata, plugin chips, and managed edge rows stay raw", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const source = "notes/source.md";
  const headerLink = link(doc, "target.md#^header");
  const header = el(doc, "div", { class: "markdown-embed-link" }, headerLink);
  const embedLink = link(doc, "target.md#^embed");
  const embed = el(doc, "div", { class: "markdown-embed-content" }, embedLink);
  const struckLink = link(doc, "target.md#^struck");
  const struck = el(doc, "del", {}, struckLink);
  const propertyLink = link(doc, "target.md#^property");
  const properties = el(doc, "div", { class: "metadata-container" }, propertyLink);
  const chipLink = link(doc, "target.md#^chip");
  const chipRow = el(doc, "li", { class: "bob-dep-row" }, chipLink);
  const edgeLink = link(doc, "target.md#^edge");
  const edgeRow = el(doc, "li", {}, "- DEPENDS ON: ", edgeLink);
  const renderedLinks = link(doc, "target.md#^links");
  const renderedEdge = el(doc, "li", {}, "🪢 LINKS: ", renderedLinks);
  const root = el(doc, "div", {}, header, embed, struck, properties, chipRow, edgeRow, renderedEdge);
  processorFor(plugin)(root, { sourcePath: source });
  assert.equal(hostBefore(headerLink), null);
  assert.ok(hostBefore(embedLink));
  assert.ok(struck.previousSibling && struck.previousSibling.classList.contains("bob-task-link-mark"));
  assert.equal(hostBefore(propertyLink), null);
  assert.equal(hostBefore(chipLink), null);
  assert.equal(hostBefore(edgeLink), null);
  assert.equal(hostBefore(renderedLinks), null);
});

test("TC19-TC20 vectors: ordinary prose starting with a managed label word still rings (bob-cli-f5)", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const prose = [];
  const rows = [];
  // The landing audit's reproduction, then other label-word openings.
  for (const [lead, id] of [
    ["Links worth reading: ", "worth"],
    ["Links: ", "colon"],
    ["Blocks of time: ", "blocks"],
    ["Linked from my notes, ", "linked"],
    ["Depends on the weather: ", "depends"],
    ["Backlinks are useful: ", "back"],
    ["Sub-projects are fine: ", "sub"],
    ["LINKS worth reading ", "caps"],
  ]) {
    const anchor = link(doc, `target.md#^${id}`);
    prose.push(anchor);
    rows.push(el(doc, "li", {}, lead, anchor));
  }
  const root = el(doc, "ul", {}, ...rows);
  processorFor(plugin)(root, { sourcePath: "notes/source.md" });
  for (const anchor of prose) {
    assert.ok(hostBefore(anchor), anchor.getAttribute("data-href"));
  }
});

test("TC20 vector: a bold managed label owns the row, with or without a task checkbox", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const managed = [];
  const rows = [];
  const bold = (label) => el(doc, "strong", {}, label);
  for (const [glyph, label, id] of [
    ["⛓️ ", "DEPENDS ON:", "depends"],
    ["", "BLOCKS:", "blocks"],
    ["🪢 ", "LINKS:", "links"],
    ["", "LINKED FROM:", "from"],
    ["🧩 ", "Sub-projects:", "sub"],
    ["", "LINKS", "nocolon"],
  ]) {
    const anchor = link(doc, `target.md#^${id}`);
    managed.push(anchor);
    const children = glyph ? [glyph, bold(label), " ", anchor] : [bold(label), " ", anchor];
    rows.push(el(doc, "li", {}, ...children));
  }
  // A task checkbox before the label, and a loose-list paragraph wrapper.
  const checkbox = link(doc, "target.md#^checkbox");
  managed.push(checkbox);
  rows.push(el(doc, "li", {}, el(doc, "input", { type: "checkbox", class: "task-list-item-checkbox" }), bold("BLOCKS:"), " ", checkbox));
  const loose = link(doc, "target.md#^loose");
  managed.push(loose);
  rows.push(el(doc, "li", {}, el(doc, "p", {}, "⛓️ ", bold("DEPENDS ON:"), " ", loose)));
  // Bold prose that is not a managed label keeps its ring.
  const boldProse = link(doc, "target.md#^boldprose");
  rows.push(el(doc, "li", {}, bold("Links worth reading:"), " ", boldProse));
  const root = el(doc, "ul", {}, ...rows);
  processorFor(plugin)(root, { sourcePath: "notes/source.md" });
  for (const anchor of managed) {
    assert.equal(hostBefore(anchor), null, anchor.getAttribute("data-href"));
  }
  assert.ok(hostBefore(boldProse));
});

test("closeout: a managed label later in a row does not suppress it", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const anchor = link(doc, "target.md#^later");
  const bold = el(doc, "strong", {}, "LINKS");
  const row = el(doc, "li", {}, "See the ", bold, " section: ", anchor);
  const flat = link(doc, "target.md#^flat");
  const flatRow = el(doc, "li", {}, "Review the LINKS: section ", flat);
  processorFor(plugin)(el(doc, "ul", {}, row, flatRow), { sourcePath: "notes/source.md" });
  assert.ok(hostBefore(anchor));
  assert.ok(hostBefore(flat));
});

test("closeout: a rendered Reading section that Obsidian detached still updates, and never swaps (bob-cli-f5)", () => {
  // The real-Obsidian e2e found it: Obsidian post-processes every section
  // when a note opens but keeps the off-screen ones detached from the page,
  // so a document sweep never saw their anchors and a ring far down a long
  // note reappeared stale (Ready) after its task was completed elsewhere.
  const doc = makeDocument();
  let state = "ready";
  const { plugin } = makePlugin(doc, (input) => hitFor(input, state));
  const onPage = link(doc, "target.md#^swap");
  const offPage = link(doc, "target.md#^swap");
  let offPageConnected = true;
  Object.defineProperty(onPage, "isConnected", { get: () => true });
  Object.defineProperty(offPage, "isConnected", { get: () => offPageConnected });
  const visibleRoot = el(doc, "div", {}, onPage);
  const hiddenRoot = el(doc, "div", {}, offPage);
  doc.body.appendChild(visibleRoot);
  doc.body.appendChild(hiddenRoot);
  processorFor(plugin)(visibleRoot, { sourcePath: "notes/source.md" });
  processorFor(plugin)(hiddenRoot, { sourcePath: "notes/source.md" });
  assert.equal(hostBefore(onPage).getAttribute("data-state"), "ready");
  assert.equal(hostBefore(offPage).getAttribute("data-state"), "ready");

  // The section scrolls out of view: Obsidian detaches it from the page.
  doc.body.removeChild(hiddenRoot);
  offPageConnected = false;
  state = "done";
  plugin.sweepTaskLinkMarksReading({ allowSwap: true });
  // The visible ring swaps; the off-page one updates in place, quietly.
  assert.equal(hostBefore(onPage).getAttribute("data-state"), "done");
  assert.equal(hostBefore(onPage).classList.contains("bob-task-link-mark-swap"), true);
  assert.equal(hostBefore(offPage).getAttribute("data-state"), "done");
  assert.equal(hostBefore(offPage).classList.contains("bob-task-link-mark-swap"), false);
  assert.match(hostBefore(offPage).getAttribute("aria-label"), /Done/);

  // It scrolls back in, well after the swap window: already Done, no swap.
  doc.body.appendChild(hiddenRoot);
  offPageConnected = true;
  plugin.taskLinkMarksClock = () => 5000;
  plugin.sweepTaskLinkMarksReading({ allowSwap: true });
  assert.equal(hostBefore(offPage).getAttribute("data-state"), "done");
  assert.equal(hostBefore(offPage).classList.contains("bob-task-link-mark-swap"), false);
  assert.equal(hostBefore(onPage).classList.contains("bob-task-link-mark-swap"), false);

  // A detached anchor that is no longer a candidate loses its ring.
  doc.body.removeChild(hiddenRoot);
  offPageConnected = false;
  offPage.removeAttribute("data-bob-task-link-src");
  plugin.sweepTaskLinkMarksReading({ allowSwap: true });
  assert.equal(hostBefore(offPage), null);
});

test("closeout: detached-anchor tracking is weak and bounded", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  for (let index = 0; index < 2400; index += 1) {
    plugin.taskLinkMarkReadingTrack({ index });
  }
  // Pruned back to the cap once it passed the cap plus slack.
  assert.ok(plugin.taskLinkMarkReadingTracked.length <= 2250, `tracked ${plugin.taskLinkMarkReadingTracked.length}`);
  assert.ok(plugin.taskLinkMarkReadingTracked.length >= 2000);
  // The same anchor is only tracked once.
  const same = link(doc, "target.md#^once");
  const before = plugin.taskLinkMarkReadingTracked.length;
  plugin.taskLinkMarkReadingTrack(same);
  plugin.taskLinkMarkReadingTrack(same);
  assert.equal(plugin.taskLinkMarkReadingTracked.length, before + 1);
});

test("Pomodoro ledger links stay unmarked; mixed and deeper rows remain eligible", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const heading = el(doc, "h2", {}, "Pomodoros");
  const entries = el(doc, "ul", {});
  const openEntry = el(doc, "li", { "data-task": " " });
  const openChildren = el(doc, "ul", {});
  const openLink = link(doc, "target.md#^open");
  const dedicatedOpen = el(doc, "li", {}, openLink);
  openChildren.appendChild(dedicatedOpen);
  openEntry.appendChild(openChildren);
  entries.appendChild(openEntry);

  const closedEntry = el(doc, "li", { "data-task": "x" });
  const closedChildren = el(doc, "ul", {});
  const closedLink = link(doc, "target.md#^closed");
  closedChildren.appendChild(el(doc, "li", {}, closedLink));
  closedEntry.appendChild(closedChildren);
  entries.appendChild(closedEntry);

  const struckEntry = el(doc, "li", { "data-task": " " });
  const struckChildren = el(doc, "ul", {});
  const struckLink = link(doc, "target.md#^struck-ledger");
  struckChildren.appendChild(el(doc, "li", {}, el(doc, "del", {}, struckLink)));
  struckEntry.appendChild(struckChildren);
  entries.appendChild(struckEntry);

  const mixedEntry = el(doc, "li", { "data-task": " " });
  const mixedChildren = el(doc, "ul", {});
  const mixedLink = link(doc, "target.md#^mixed");
  mixedChildren.appendChild(el(doc, "li", {}, "See also ", mixedLink));
  mixedEntry.appendChild(mixedChildren);
  entries.appendChild(mixedEntry);

  const nestedEntry = el(doc, "li", { "data-task": " " });
  const nestedChildren = el(doc, "ul", {});
  const directRow = el(doc, "li", {}, "Parent detail");
  const deeper = el(doc, "ul", {});
  const nestedLink = link(doc, "target.md#^nested");
  deeper.appendChild(el(doc, "li", {}, nestedLink));
  directRow.appendChild(deeper);
  nestedChildren.appendChild(directRow);
  nestedEntry.appendChild(nestedChildren);
  entries.appendChild(nestedEntry);

  doc.body.appendChild(heading);
  doc.body.appendChild(entries);
  processorFor(plugin)(doc.body, { sourcePath: "2026/20261101.md" });
  assert.equal(hostBefore(openLink), null);
  assert.equal(hostBefore(closedLink), null);
  assert.equal(hostBefore(struckLink), null);
  assert.ok(hostBefore(mixedLink));
  assert.ok(hostBefore(nestedLink));
});

test("query-row retry sees links added after the Markdown post-processor", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const row = el(doc, "li", { class: "plugin-tasks-list-item", "data-task": "*", "data-task-path": "tasks/own.md" });
  processorFor(plugin)(row, { sourcePath: "dash.md" });
  assert.equal(plugin.pendingReadingFrames.length, 1);
  const anchor = link(doc, "target.md#^late");
  row.appendChild(anchor);
  plugin.pendingReadingFrames.shift()();
  assert.equal(anchor.getAttribute("data-bob-task-link-src"), "tasks/own.md");
  assert.ok(hostBefore(anchor));
});

test("a Tasks query row resolves against its own task path; unknown query paths stay neutral", () => {
  const doc = makeDocument();
  const calls = [];
  const { plugin } = makePlugin(doc, (input) => { calls.push(input); return hitFor(input); });
  const queryLink = link(doc, "target.md#^query");
  const queryRow = el(doc, "li", { class: "plugin-tasks-list-item", "data-task": "*", "data-task-path": "tasks/own.md" }, queryLink);
  const noPathLink = link(doc, "target.md#^unknown");
  const unknownRow = el(doc, "li", { class: "plugin-tasks-list-item", "data-task": "*" }, noPathLink);
  const root = el(doc, "div", {}, queryRow, unknownRow);
  processorFor(plugin)(root, { sourcePath: "dash.md" });
  assert.equal(queryLink.getAttribute("data-bob-task-link-src"), "tasks/own.md");
  assert.ok(hostBefore(queryLink));
  assert.equal(noPathLink.getAttribute("data-bob-task-link-src"), null);
  assert.equal(hostBefore(noPathLink), null);
  assert.equal(calls[0].sourcePath, "tasks/own.md");
  assert.equal(calls.some((call) => call.sourcePath === "dash.md"), false);
});

test("a Tasks description render uses ctx.sourcePath when the query row has no origin path", () => {
  const doc = makeDocument();
  const calls = [];
  const { plugin } = makePlugin(doc, (input) => { calls.push(input); return hitFor(input); });
  const anchor = link(doc, "areas/work#^ready-1");
  const description = el(doc, "span", { class: "task-description" }, anchor);
  const row = el(doc, "li", { class: "plugin-tasks-list-item", "data-task": "*" }, description);
  processorFor(plugin)(description, { sourcePath: "areas/work.md" });
  assert.equal(anchor.getAttribute("data-bob-task-link-src"), "areas/work.md");
  assert.ok(hostBefore(anchor));
  assert.equal(calls[0].sourcePath, "areas/work.md");
});

test("a Tasks row pass does not stamp nested DEPENDS ON or LINKS children", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const title = link(doc, "areas/work#^ready-1");
  const depends = link(doc, "areas/work#^next-1");
  const links = link(doc, "areas/work#^wip-1");
  const nested = el(doc, "ul", {}, el(doc, "li", {}, "⛓️ DEPENDS ON: ", depends), el(doc, "li", {}, "🪢 LINKS: ", links));
  const row = el(doc, "li", { class: "plugin-tasks-list-item", "data-task": " " }, title, nested);
  processorFor(plugin)(row, { sourcePath: "managed.md" });
  assert.ok(hostBefore(title));
  assert.equal(hostBefore(depends), null);
  assert.equal(hostBefore(links), null);
});

test("sweep stamps Tasks query rows that appear after the Markdown post-processor", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const root = el(doc, "div", {});
  doc.body.appendChild(root);
  processorFor(plugin)(root, { sourcePath: "queries.md" });
  const anchor = link(doc, "areas/work#^ready-1");
  const row = el(
    doc,
    "li",
    { class: "plugin-tasks-list-item", "data-task": "*", "data-task-path": "areas/work.md" },
    anchor,
  );
  root.appendChild(row);
  assert.equal(hostBefore(anchor), null);
  plugin.sweepTaskLinkMarksReading();
  assert.equal(anchor.getAttribute("data-bob-task-link-src"), "areas/work.md");
  assert.ok(hostBefore(anchor));
});

test("stamped-anchor sweep updates in place and removes marks when targets stop resolving", () => {
  const doc = makeDocument();
  let state = "ready";
  let present = true;
  const { plugin } = makePlugin(doc, (input) => present ? hitFor(input, state) : null);
  const anchor = link(doc, "target.md#^id");
  const root = el(doc, "div", {}, anchor);
  doc.body.appendChild(root);
  processorFor(plugin)(root, { sourcePath: "source.md" });
  const originalHost = hostBefore(anchor);
  assert.ok(originalHost);
  state = "done";
  plugin.sweepTaskLinkMarksReading({ allowSwap: true });
  assert.equal(hostBefore(anchor), originalHost);
  assert.equal(originalHost.getAttribute("data-state"), "done");
  assert.match(originalHost.getAttribute("class"), /bob-task-link-mark-swap/);
  assert.equal(anchor.classList.contains("bob-task-link-closed"), false);
  present = false;
  plugin.sweepTaskLinkMarksReading({ allowSwap: true });
  assert.equal(hostBefore(anchor), null);
  assert.equal(anchor.getAttribute("data-bob-task-link-src"), "source.md");
  present = true;
  plugin.sweepTaskLinkMarksReading();
  assert.ok(hostBefore(anchor));
});

test("the session toggle sweep removes and restores Reading rings", () => {
  const doc = makeDocument();
  const { plugin } = makePlugin(doc, (input) => hitFor(input));
  const anchor = link(doc, "target.md#^id");
  const root = el(doc, "div", {}, anchor);
  doc.body.appendChild(root);
  processorFor(plugin)(root, { sourcePath: "source.md" });
  assert.ok(hostBefore(anchor));
  plugin.taskLinkMarksEnabled = false;
  plugin.sweepTaskLinkMarksReading();
  assert.equal(hostBefore(anchor), null);
  plugin.taskLinkMarksEnabled = true;
  plugin.sweepTaskLinkMarksReading();
  assert.ok(hostBefore(anchor));
});

test("plain ring mousedown does nothing and Mod+click opens the linked task", () => {
  const doc = makeDocument();
  const { plugin, opened } = makePlugin(doc, (input) => hitFor(input));
  const anchor = link(doc, "target.md#^id");
  const root = el(doc, "div", {}, anchor);
  doc.body.appendChild(root);
  processorFor(plugin)(root, { sourcePath: "source.md" });
  const host = hostBefore(anchor);
  const listener = plugin.registeredDomEvents.find((event) => event.node === doc && event.type === "mousedown");
  assert.ok(listener);
  let prevented = 0;
  listener.handler({ target: host, button: 0, preventDefault() { prevented += 1; } });
  assert.equal(opened.length, 0);
  listener.handler({ target: host, button: 0, ctrlKey: true, preventDefault() { prevented += 1; } });
  assert.deepEqual(opened, [["target.md#^id", "source.md", "tab"]]);
  assert.equal(prevented, 1);
});
