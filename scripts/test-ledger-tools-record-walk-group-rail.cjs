// Record walk group rail (bob-cli-oj record-rail): grouped record walks show
// the kit group row in place of the whole-walk thumb track, answer from
// walkMode.links v7 (else navGroups), re-validate before running [N / ]N in
// the card's pane, and keep today's rail for ungrouped, single-group,
// syncing, and grouping-unavailable albums.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField: { info: true }, editorLivePreviewField: { live: true },
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return { EditorView: {}, keymap: { of: (value) => value } };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

class FakeNode {
  constructor(tag, doc, text = "") {
    this.tagName = tag ? tag.toUpperCase() : "#TEXT";
    this.nodeType = tag ? 1 : 3;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this._text = text;
    const self = this;
    this.classList = {
      add(name) { const xs = new Set((self.getAttribute("class") || "").split(/\s+/).filter(Boolean)); xs.add(name); self.setAttribute("class", [...xs].join(" ")); },
      remove(name) { const xs = (self.getAttribute("class") || "").split(/\s+/).filter((x) => x && x !== name); self.setAttribute("class", xs.join(" ")); },
      contains(name) { return (self.getAttribute("class") || "").split(/\s+/).includes(name); },
    };
  }
  get textContent() { return this.nodeType === 3 ? this._text : this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); if (this.nodeType === 1) this.children = [new FakeNode("", this.ownerDocument, this._text)]; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(node) { node.parentNode?.removeChild?.(node); node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) { node.parentNode?.removeChild?.(node); node.parentNode = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, node); return node; }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentNode = null; return node; }
  remove() { this.parentNode?.removeChild?.(this); }
  addEventListener(type, fn) { const rows = this.listeners.get(type) || []; rows.push(fn); this.listeners.set(type, rows); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  fire(type, extra = {}) {
    const event = { type, button: 0, stopped: false, defaultPrevented: false, ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; };
    event.stopPropagation = () => { event.stopped = true; };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const value = part.trim();
      const cls = /^\.([\w-]+)$/.exec(value);
      const tag = /^[a-z][\w-]*$/i.exec(value);
      const tagClass = /^([a-z][\w-]*)\.([\w-]+)$/i.exec(value);
      return Boolean((cls && this.classList.contains(cls[1])) || (tag && this.tagName === tag[0].toUpperCase())
        || (tagClass && this.tagName === tagClass[1].toUpperCase() && this.classList.contains(tagClass[2])));
    });
  }
  closest(selector) { let node = this; while (node) { if (node.nodeType === 1 && node.matches(selector)) return node; node = node.parentNode; } return null; }
  querySelectorAll(selector) { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.nodeType === 1 && child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeDoc() {
  return {
    createElement(tag) { return new FakeNode(tag, this); },
    createTextNode(text) { return new FakeNode("", this, String(text)); },
  };
}

const pause = () => new Promise((resolve) => setImmediate(resolve));
const CHOICES = [
  { value: "intro", label: "🛑 Intro" },
  { value: "body", label: "🔮 Future Work" },
  { value: "outro", label: "🏁 Conclusion" },
];
const ZETTEL = [
  { path: "z/alpha.md", title: "Alpha", section: "intro" },
  { path: "z/beta.md", title: "Beta", section: "body" },
  { path: "z/delta.md", title: "Delta", section: "body" },
  { path: "z/gamma.md", title: "Gamma", section: "body" },
  { path: "z/omega.md", title: "Omega", section: "outro" },
  { path: "z/zed.md", title: "Zed" },
];

// A zettel-like album: Intro [Alpha], Future Work [Beta, Delta, Gamma],
// Conclusion [Omega], and a trailing needs group [Zed].
function zettelWorld(options = {}) {
  const records = (options.records || ZETTEL).map((record) => ({ ...record }));
  const walkBy = options.walkBy === undefined ? "section" : options.walkBy;
  const capabilities = options.capabilities || ["record_values_v1", "record_walk_v1", "record_walk_groups_v1"];
  const frontmatter = new Map();
  frontmatter.set("z.md", { type: "[[album]]", title: "SASE Blog Zettel", emoji: "🗂", ...(walkBy ? { walk_by: walkBy } : {}) });
  for (const record of records) {
    frontmatter.set(record.path, {
      type: "[[record]]", parent: "[[z]]", title: record.title,
      ...(record.section ? { section: record.section } : {}),
    });
  }
  const files = new Map([...frontmatter.keys()].map((path) => [path, { path, extension: "md" }]));
  const hidden = new Set(options.hidden || []);
  const album = {
    path: "z.md", stem: "z", title: "SASE Blog Zettel", emoji: "🗂", noun: "zettel",
    singular: "zettel", plural: "zettels", label: "Zettel", records: records.length,
    parent: null, issues: [], legacy: [], index: { state: "current" }, walk: { state: "current" },
    fields: [{ key: "section", label: "Section", kind: "choices", required: false, list: false, choices: CHOICES }],
    ...(walkBy ? { walk_by: walkBy } : {}),
  };
  const report = helpers.albumIndexReport({ schema_version: 1, ok: true, albums: [album], catalogs: [], counts: {}, capabilities });
  const calls = [];
  const sources = new Map();
  const app = {
    vault: {
      getAbstractFileByPath: (path) => (hidden.has(path) ? null : files.get(path) || null),
      getMarkdownFiles: () => [...files.values()],
      cachedRead: async (file) => sources.get(file.path),
    },
    metadataCache: {
      getFileCache: (file) => (frontmatter.has(file?.path) ? { frontmatter: frontmatter.get(file.path) } : null),
      getFirstLinkpathDest: (target) => files.get(`${String(target).replace(/\.md$/i, "")}.md`) || null,
    },
    workspace: {
      trigger() {},
      getLeavesOfType: () => [],
      getMostRecentLeaf: () => null,
      setActiveLeaf: (leaf) => calls.push(["active", leaf.view.file.path]),
      openLinkText: async (...args) => calls.push(["open", ...args]),
    },
    commands: {
      commands: {
        "bob-navigation-hotkeys:open-prev-group-link": {},
        "bob-navigation-hotkeys:open-next-group-link": {},
      },
      executeCommandById: (id) => calls.push(["command", id]),
    },
    plugins: { plugins: {} },
  };
  const plugin = new LedgerToolsPlugin(app);
  const state = { report, reportGeneration: 1, stale: false };
  plugin.albumReportState = () => state;
  plugin.albumScheduleSync = (reason) => calls.push(["sync", reason]);
  plugin.scheduleRecordSheetRefresh = () => calls.push(["refresh"]);
  plugin.recordSheetSourceCache = sources;
  const writeLines = () => {
    const members = records.map((record) => ({
      path: record.path, stem: record.path.slice(2, -3), title: record.title, frontmatter: frontmatter.get(record.path),
    }));
    const grouping = walkBy ? album : null;
    const lines = helpers.recordWalkRenderLines({ stem: "z", title: "SASE Blog Zettel" }, members, grouping);
    const ordered = helpers.recordWalkGroupProjection(members, grouping).ordered.map((member) => member.path);
    sources.clear();
    ordered.forEach((path, index) => sources.set(path, `---\ntype: "[[record]]"\nparent: "[[z]]"\n---\n\n${lines[index]}\n\n## Notes\n`));
  };
  writeLines();
  const world = {
    app, calls, files, frontmatter, hidden, plugin, report, sources, state, doc: makeDoc(),
    walk: (path) => plugin.recordWalkFor(path, sources.get(path)),
    setSection(path, section) {
      const next = { ...frontmatter.get(path) };
      if (section) next.section = section; else delete next.section;
      frontmatter.set(path, next);
      const record = records.find((item) => item.path === path);
      if (section) record.section = section; else delete record.section;
      writeLines();
    },
    leafFor(path) {
      const leaf = { view: { file: files.get(path), editor: { getValue: () => sources.get(path) } } };
      app.workspace.getLeavesOfType = () => [{ view: { file: files.get("z.md") } }, leaf];
      return leaf;
    },
  };
  if (options.walkMode !== false) installWalkMode(world, options.walkModeVersion);
  return world;
}

// Bob Navigation Hotkeys' walkMode.links v7 over the ledger provider, with
// an optional override for authored, conflicted, or changed stops.
function installWalkMode(world, version = 7) {
  world.walkModeCalls = 0;
  const links = ({ path, content }) => {
    world.walkModeCalls += 1;
    const answer = world.plugin.navGroupsResolve({ path, content });
    const derived = (stop) => (stop ? { ...stop, text: stop.landingLabel, exists: stop.state === "exists" } : null);
    const result = {
      ok: true, prev: null, next: null,
      prevGroup: derived(answer.prevGroup), nextGroup: derived(answer.nextGroup),
      group: answer.group || null, groupNone: answer.none || null,
      groupConflict: null, groupConflicts: [],
    };
    return world.walkModeOverride ? world.walkModeOverride(result, { path, content }) : result;
  };
  world.app.plugins.plugins["bob-navigation-hotkeys"] = { api: { version: 3, walkMode: { version, links } } };
}

function groupRow(rail) { return rail.querySelector(".bob-property-card-group-row"); }
function groupArm(rail, direction) {
  return rail.querySelectorAll(".bob-property-card-group-arm").find((arm) => arm.getAttribute("data-group") === direction) || null;
}
function spanText(node, cls) { return node.querySelector(`.${cls}`)?.textContent ?? null; }
function ticks(rail) {
  return rail.querySelectorAll(".bob-property-card-group-tick").map((tick) => tick.getAttribute("data-state"));
}

test("first member of a one-member first group: wrapping prev arm, next group head, no centre, and no thumb track", () => {
  const world = zettelWorld();
  const walk = world.walk("z/alpha.md");
  assert.equal(walk.state, "ok");
  assert.equal(walk.groupRail.source, "walkMode");
  assert.equal(walk.groupRail.fieldLabel, "Section");
  const rail = helpers.recordWalkRailBuildEl(walk, {}, world.doc);
  assert.equal(rail.getAttribute("data-walk-grouped"), "true");
  assert.equal(rail.querySelectorAll(".bob-record-walk-track").length, 0, "the group row replaces the thumb track");
  const row = groupRow(rail);
  assert.ok(row.classList.contains("bob-record-walk-group-row"));
  assert.equal(rail.children.at(-1), row, "the group row sits after the step grid");
  assert.equal(row.getAttribute("aria-label"), "Section groups");

  const prev = groupArm(rail, "prev");
  assert.equal(prev.getAttribute("data-state"), "exists");
  assert.equal(prev.getAttribute("href"), "z/zed");
  assert.equal(prev.querySelector(".bob-property-card-group-glyph").getAttribute("data-icon"), "skip-back");
  assert.equal(prev.querySelector(".bob-property-card-group-glyph").getAttribute("aria-hidden"), "true");
  assert.equal(spanText(prev, "bob-property-card-group-label"), "⚠️ Needs section");
  assert.equal(prev.querySelector(".bob-property-card-group-landing"), null, "the head title is not painted");
  assert.ok(!/[«»]/.test(prev.textContent));
  assert.equal(spanText(prev, "bob-property-card-group-wrap"), "↺");
  assert.equal(prev.getAttribute("title"), "[N · previous section: ⚠️ Needs section → Zed · wraps around");
  assert.equal(prev.getAttribute("aria-label"), "Previous section group: ⚠️ Needs section, opens Zed, wraps around");
  assert.equal(prev.getAttribute("data-record-sheet-focus"), "walk-group-prev");

  const next = groupArm(rail, "next");
  assert.equal(next.getAttribute("href"), "z/beta");
  assert.equal(spanText(next, "bob-property-card-group-label"), "🔮 Future Work");
  assert.equal(next.querySelector(".bob-property-card-group-landing"), null);
  assert.equal(next.querySelector(".bob-property-card-group-glyph").getAttribute("data-icon"), "skip-forward");
  assert.equal(next.querySelector(".bob-property-card-group-wrap"), null);
  assert.equal(next.getAttribute("title"), "]N · next section: 🔮 Future Work → Beta");
  assert.equal(next.getAttribute("aria-label"), "Next section group: 🔮 Future Work, opens Beta");

  // 🛑 Intro has one member: no centre, no track, and the gap keeps the grid.
  assert.equal(row.querySelector(".bob-property-card-group-center"), null);
  assert.equal(row.querySelector(".bob-property-card-group-name"), null);
  assert.ok(row.children[1].classList.contains("bob-property-card-group-gap"));
  assert.equal(row.children[1].getAttribute("data-group"), "center");
  assert.deepEqual(ticks(rail), []);

  // The step row keeps the overall position; its tooltip names the order.
  assert.equal(spanText(rail, "bob-record-walk-count-wide"), "1 of 6");
  assert.equal(rail.querySelector(".bob-record-walk-count").getAttribute("title"), "By Section, then title · wraps around");
});

test("a middle member shows its group position and member ticks; the needs group wraps next", () => {
  const world = zettelWorld();
  const middle = helpers.recordWalkRailBuildEl(world.walk("z/delta.md"), {}, world.doc);
  assert.equal(groupRow(middle).querySelector(".bob-property-card-group-name"), null, "the Section chip already names it");
  assert.equal(groupRow(middle).querySelector(".bob-property-card-group-position-wide"), null);
  assert.equal(spanText(groupRow(middle), "bob-property-card-group-position-label"), "2 of 3 in this section");
  assert.equal(groupRow(middle).querySelector(".bob-property-card-group-center").getAttribute("title"),
    "Section 2 of 4: 🔮 Future Work · 2 of 3");
  assert.deepEqual(ticks(middle), ["exists", "current", "exists"]);
  assert.equal(groupArm(middle, "prev").getAttribute("href"), "z/alpha");
  assert.equal(groupArm(middle, "next").getAttribute("href"), "z/omega");
  assert.equal(groupArm(middle, "next").querySelector(".bob-property-card-group-wrap"), null);

  const last = helpers.recordWalkRailBuildEl(world.walk("z/zed.md"), {}, world.doc);
  // ⚠️ Needs section holds only Zed: no centre.
  assert.equal(groupRow(last).querySelector(".bob-property-card-group-center"), null);
  const wrapping = groupArm(last, "next");
  assert.equal(wrapping.getAttribute("href"), "z/alpha");
  assert.equal(spanText(wrapping, "bob-property-card-group-wrap"), "↺");
  assert.equal(wrapping.getAttribute("title"), "]N · next section: 🛑 Intro → Alpha · wraps around");
  assert.equal(groupArm(last, "prev").getAttribute("href"), "z/omega");
  assert.equal(spanText(groupArm(last, "prev"), "bob-property-card-group-label"), "🏁 Conclusion");
});

test("a missing group head is a ghost: no href, aria-disabled, its reason, and it never opens", async () => {
  const world = zettelWorld({ hidden: ["z/omega.md"] });
  const walk = world.walk("z/delta.md");
  const rail = helpers.recordWalkRailBuildEl(walk, world.plugin.recordWalkOptions("z/delta.md", null), world.doc);
  const ghost = groupArm(rail, "next");
  assert.equal(ghost.getAttribute("data-state"), "ghost");
  assert.equal(ghost.hasAttribute("href"), false);
  assert.equal(ghost.getAttribute("aria-disabled"), "true");
  assert.equal(spanText(ghost, "bob-property-card-group-note"), "· not in vault");
  assert.equal(ghost.getAttribute("title"), "Omega is not in the vault — record navigation never creates it");
  assert.equal(ghost.getAttribute("aria-label"), "Next section group: 🏁 Conclusion, Omega not in vault");
  world.leafFor("z/delta.md");
  TestNotice.messages.length = 0;
  ghost.fire("keydown", { key: "Enter" });
  await pause();
  assert.deepEqual(TestNotice.messages, ["Omega is not in the vault — record navigation never creates it"]);
  assert.deepEqual(world.calls, [["sync", "record-walk-missing-target"]], "a ghost asks bob to repair, never opens or runs a command");
});

test("ungrouped and single-group albums keep the thumb track, today's tooltip, and no group row", () => {
  for (const options of [
    { walkBy: null },
    { records: ZETTEL.map((record) => ({ ...record, section: "body" })) },
  ]) {
    const world = zettelWorld(options);
    const walk = world.walk("z/beta.md");
    assert.equal(walk.state, "ok");
    assert.equal(walk.groupRail, null);
    const before = world.walkModeCalls;
    const rail = helpers.recordWalkRailBuildEl(walk, {}, world.doc);
    assert.equal(world.walkModeCalls, before, "ungrouped walks never ask the resolver");
    assert.equal(groupRow(rail), null);
    assert.equal(rail.hasAttribute("data-walk-grouped"), false);
    assert.equal(rail.querySelectorAll(".bob-record-walk-track").length, 1);
    assert.equal(rail.querySelector(".bob-record-walk-count").getAttribute("title"), "Alphabetical, wraps around");
  }
});

test("grouping_unavailable and syncing walks keep today's syncing rail", () => {
  const old = zettelWorld({ capabilities: ["record_values_v1", "record_walk_v1"] });
  const walk = old.walk("z/beta.md");
  assert.equal(walk.state, "syncing");
  assert.equal(walk.reason, "grouping_unavailable");
  assert.equal(walk.groupRail, null);
  const rail = helpers.recordWalkRailBuildEl(walk, {}, old.doc);
  assert.equal(groupRow(rail), null);
  assert.equal(spanText(rail, "bob-record-walk-count-wide"), "⟳");
  assert.equal(rail.querySelector(".bob-record-walk-count").getAttribute("title"), "Record walk is syncing");

  const world = zettelWorld();
  const stale = world.plugin.recordWalkFor("z/delta.md", world.sources.get("z/beta.md"));
  assert.equal(stale.state, "syncing");
  assert.equal(stale.groupRail, null);
  assert.equal(groupRow(helpers.recordWalkRailBuildEl(stale, {}, world.doc)), null);
});

test("without Navigation Hotkeys v7 the rail answers from navGroups; conflicts drop one arm", () => {
  const legacy = zettelWorld({ walkModeVersion: 6 });
  assert.equal(legacy.walk("z/delta.md").groupRail.source, "navGroups");
  const bare = zettelWorld({ walkMode: false });
  const walk = bare.walk("z/delta.md");
  assert.equal(walk.groupRail.source, "navGroups");
  assert.equal(walk.groupRail.next.target, "z/omega");

  const world = zettelWorld();
  world.walkModeOverride = (result) => ({ ...result, prevGroup: null, groupConflict: "prev", groupConflicts: ["prev"] });
  const rail = helpers.recordWalkRailBuildEl(world.walk("z/delta.md"), {}, world.doc);
  assert.equal(groupArm(rail, "prev"), null, "a conflicted role has no arm");
  assert.ok(groupArm(rail, "next"));

  const authored = helpers.recordWalkGroupStop({
    target: "notes/elsewhere", path: "notes/elsewhere.md", groupLabel: "Elsewhere",
    landingLabel: "« Elsewhere", shortLabel: "« Elsewhere", state: "exists", source: "authored",
  });
  assert.equal(authored.groupLabel, "Elsewhere");
  assert.equal(authored.landingLabel, "", "an authored stop never repeats its own label as the landing");
  assert.equal(authored.shortLabel, "Elsewhere");
});

test("the walk signature changes on a group edit and holds across identical rebuilds", () => {
  const world = zettelWorld();
  const first = helpers.recordSheetWalkSignature(world.walk("z/alpha.md"));
  assert.deepEqual(helpers.recordSheetWalkSignature(world.walk("z/alpha.md")), first);
  assert.equal(typeof first.groupRail, "string");
  world.setSection("z/omega.md", "body");
  const walk = world.walk("z/alpha.md");
  assert.equal(walk.state, "ok");
  assert.equal(walk.prev.path, "z/zed.md", "the step neighbours are unchanged");
  assert.equal(walk.next.path, "z/beta.md");
  const edited = helpers.recordSheetWalkSignature(walk);
  assert.equal(edited.prev, first.prev);
  assert.equal(edited.next, first.next);
  assert.notEqual(edited.groupRail, first.groupRail, "the group count change repaints the rail");
  assert.equal(helpers.recordWalkGroupRailSignature(null), null);
});

test("a plain click re-validates and runs ]N in the card's own pane", async () => {
  const world = zettelWorld();
  world.leafFor("z/delta.md");
  const rail = helpers.recordWalkRailBuildEl(world.walk("z/delta.md"), world.plugin.recordWalkOptions("z/delta.md", null), world.doc);
  const event = groupArm(rail, "next").fire("click");
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true, "the click never reaches the editor under the widget");
  await pause();
  assert.deepEqual(world.calls, [
    ["active", "z/delta.md"],
    ["command", "bob-navigation-hotkeys:open-next-group-link"],
  ]);
  world.calls.length = 0;
  groupArm(rail, "prev").fire("click");
  await pause();
  assert.deepEqual(world.calls.at(-1), ["command", "bob-navigation-hotkeys:open-prev-group-link"]);
});

test("a changed stop refuses with a repaint and a notice; nothing opens", async () => {
  const world = zettelWorld();
  world.leafFor("z/delta.md");
  const rail = helpers.recordWalkRailBuildEl(world.walk("z/delta.md"), world.plugin.recordWalkOptions("z/delta.md", null), world.doc);
  world.walkModeOverride = (result) => ({ ...result, nextGroup: { ...result.nextGroup, target: "z/gamma", path: "z/gamma.md" } });
  TestNotice.messages.length = 0;
  groupArm(rail, "next").fire("click");
  await pause();
  assert.deepEqual(TestNotice.messages, [helpers.RECORD_WALK_GROUP_CHANGED_NOTICE]);
  assert.equal(helpers.RECORD_WALK_GROUP_CHANGED_NOTICE, "The group stop changed — try again");
  assert.deepEqual(world.calls, [["refresh"]]);
  world.calls.length = 0;
  world.walkModeOverride = (result) => ({ ...result, nextGroup: { ...result.nextGroup, state: "ghost" } });
  assert.equal(await world.plugin.recordWalkGroupOpen("next", { ...world.walk("z/delta.md").groupRail.next, state: "exists" }, "z/delta.md", {}), false);
  assert.deepEqual(world.calls, [["refresh"]], "a state change also refuses");
});

test("a modified click on an existing head opens it like a Markdown link", async () => {
  const world = zettelWorld();
  world.leafFor("z/delta.md");
  const rail = helpers.recordWalkRailBuildEl(world.walk("z/delta.md"), world.plugin.recordWalkOptions("z/delta.md", null), world.doc);
  const arm = groupArm(rail, "next");
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    arm.fire("click", extra);
    await pause();
    assert.deepEqual(world.calls.splice(0), [["open", "z/omega", "z/delta.md", true]]);
  }
  arm.fire("auxclick", { button: 1 });
  await pause();
  assert.deepEqual(world.calls.splice(0), [["open", "z/omega", "z/delta.md", true]]);
});

test("without the command or a matching pane, the click opens the head or explains a creatable stop", async () => {
  const bare = zettelWorld({ walkMode: false });
  bare.leafFor("z/delta.md");
  const walk = bare.walk("z/delta.md");
  assert.equal(await bare.plugin.recordWalkGroupOpen("next", walk.groupRail.next, "z/delta.md", {}), true);
  assert.deepEqual(bare.calls, [["open", "z/omega", "z/delta.md", false]], "navGroups answers open through the rail's link opener");

  const world = zettelWorld();
  world.leafFor("z/delta.md");
  world.app.commands.commands = {};
  world.walkModeOverride = (result) => ({
    ...result,
    nextGroup: { target: "notes/later", path: "notes/later.md", groupLabel: "Later", landingLabel: "» Later", shortLabel: "» Later", state: "creatable", source: "authored" },
  });
  const creatable = world.walk("z/delta.md").groupRail.next;
  assert.equal(creatable.state, "creatable");
  const rail = helpers.recordWalkRailBuildEl(world.walk("z/delta.md"), {}, world.doc);
  const arm = groupArm(rail, "next");
  assert.equal(spanText(arm, "bob-property-card-group-plus"), "+");
  assert.equal(arm.getAttribute("title"), "Later isn't created yet — ]N creates it");
  assert.equal(arm.getAttribute("aria-label"), "Next section group: Later, not created yet — activating creates it");
  TestNotice.messages.length = 0;
  assert.equal(await world.plugin.recordWalkGroupOpen("next", creatable, "z/delta.md", {}), false);
  assert.deepEqual(TestNotice.messages, ["Later isn't created yet — Bob Navigation Hotkeys creates it with ]N"]);
  assert.deepEqual(world.calls, []);
});

test("Live Preview's sheet model and Reading paint both carry the group row", () => {
  const world = zettelWorld();
  const model = world.plugin.recordSheetModelFor("z/delta.md", world.sources.get("z/delta.md"));
  assert.ok(model, "the grouped record mounts a sheet");
  assert.equal(model.walk.groupRail.group.label, "🔮 Future Work");
  assert.notEqual(helpers.recordSheetSignature(model), helpers.recordSheetSignature({ ...model, walk: { ...model.walk, groupRail: null } }));

  const root = world.doc.createElement("div");
  const walk = world.walk("z/delta.md");
  const paragraph = world.doc.createElement("p");
  walk.writtenLinks.forEach((link, index) => {
    if (index) paragraph.appendChild(world.doc.createTextNode(" · "));
    const anchor = world.doc.createElement("a");
    anchor.setAttribute("class", "internal-link");
    anchor.setAttribute("data-href", link.target);
    anchor.appendChild(world.doc.createTextNode(link.label));
    paragraph.appendChild(anchor);
  });
  root.appendChild(paragraph);
  world.plugin.recordSheetNodeBelongs = () => true;
  const rail = world.plugin.recordWalkPaintReading(root, "z/delta.md", null);
  assert.ok(rail);
  assert.ok(groupRow(rail));
  assert.equal(rail.querySelectorAll(".bob-record-walk-track").length, 0);
});
