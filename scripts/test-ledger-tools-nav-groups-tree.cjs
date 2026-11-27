// api.navGroups v1 tree route: sibling rings, parent tour, reasons, and the
// lazy generation-stamped index (bob-cli-ra engine). Pure model plus the
// mixin's vault wiring, exercised through the built plugin bundle.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class { constructor() {} },
      Platform: { isDesktopApp: false },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {}, keymap: { of: (value) => value } };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

const {
  NAV_GROUPS_API_VERSION,
  navGroupsTreeIsKind,
  navGroupsTreeKindRank,
  navGroupsTreeExcludedFast,
  navGroupsTreeSpecies,
  navGroupsTreeSpeciesFast,
  navGroupsTreeMemoizedKindOfType,
  navGroupsTreeCompareMembers,
  navGroupsTreeOutlineKeyFor,
  navGroupsTreeCompareKeys,
  navGroupsTreeLaneFromCache,
  navGroupsTreeClassifyParentRaw,
  navGroupsTreeBuildRings,
  navGroupsTreeBuildTours,
  navGroupsTreeAnswerFor,
} = LedgerToolsPlugin.helpers;

const TODAY = "2026-11-21";

function prjCache(task) {
  return {
    blocks: { prj: { position: { start: { line: 0 } } } },
    listItems: [{ position: { start: { line: 0 } }, task }],
  };
}

function areaNote(parent) {
  return { frontmatter: { type: "[[area]]", ...(parent === undefined ? {} : { parent }) } };
}

function projectNote(parent, task = " ") {
  return {
    frontmatter: { type: "[[project]]", ...(parent === undefined ? {} : { parent }) },
    ...prjCache(task),
  };
}

function notebookNote(parent, { h1 = null, alias = null } = {}) {
  return {
    frontmatter: {
      type: "[[notebook]]",
      ...(parent === undefined ? {} : { parent }),
      ...(alias === null ? {} : { aliases: [alias] }),
    },
    headings: h1 === null ? [] : [{ heading: h1, level: 1 }],
  };
}

function proseNote(parent, { title = null, alias = null } = {}) {
  return {
    frontmatter: {
      type: "[[prose]]",
      ...(parent === undefined ? {} : { parent }),
      ...(title === null ? {} : { title }),
      ...(alias === null ? {} : { aliases: [alias] }),
    },
  };
}

function makeHarness(fixtures, { today = TODAY } = {}) {
  const files = new Set();
  const caches = new Map();
  for (const [path, spec] of Object.entries(fixtures)) {
    files.add(path);
    caches.set(path, {
      frontmatter: spec && spec.frontmatter ? spec.frontmatter : {},
      headings: spec && Array.isArray(spec.headings) ? spec.headings : [],
      blocks: spec && spec.blocks ? spec.blocks : {},
      listItems: spec && Array.isArray(spec.listItems) ? spec.listItems : [],
    });
  }
  const calls = { markdownFiles: 0, fileCache: 0, link: 0 };
  const vaultHandlers = {};
  const metaHandlers = {};
  const layoutCallbacks = [];
  const onList = (table) => (event, callback) => {
    table[event] = table[event] || [];
    table[event].push(callback);
    return { event, callback };
  };
  const fireAll = (table) => (event, ...args) => {
    for (const callback of table[event] || []) callback(...args);
  };
  const writes = [];
  const failWrite = (name) => () => {
    writes.push(name);
    throw new Error("tree index must never write: " + name);
  };
  function resolveLink(target, sourcePath) {
    calls.link += 1;
    const clean = String(target || "").replace(/\.md$/i, "");
    const dir = String(sourcePath || "").split("/").slice(0, -1).join("/");
    const direct = [];
    if (dir) direct.push(dir + "/" + clean + ".md");
    direct.push(clean + ".md");
    for (const candidate of direct) {
      if (files.has(candidate)) return { path: candidate };
    }
    const base = (clean.split("/").pop() || "") + ".md";
    const hits = [...files].filter((path) => path === base || path.endsWith("/" + base)).sort();
    return hits.length > 0 ? { path: hits[0] } : null;
  }
  const app = {
    workspace: {
      onLayoutReady(callback) { layoutCallbacks.push(callback); },
    },
    vault: {
      getAbstractFileByPath: (path) => (files.has(path) ? { path } : null),
      getMarkdownFiles: () => {
        calls.markdownFiles += 1;
        return [...files].map((path) => ({ path }));
      },
      on: onList(vaultHandlers),
      create: failWrite("create"),
      modify: failWrite("modify"),
      delete: failWrite("delete"),
      rename: failWrite("rename"),
    },
    metadataCache: {
      getFileCache: (file) => {
        calls.fileCache += 1;
        const path = file && typeof file.path === "string" ? file.path : "";
        return caches.get(path) || null;
      },
      getFirstLinkpathDest: (target, sourcePath) => resolveLink(target, sourcePath),
      on: onList(metaHandlers),
    },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.addCommand = () => {};
  plugin.registerEvent = (reference) => reference;
  plugin.navGroupsTodayOverride = today;
  plugin.setupNavGroups();
  return {
    plugin, app, files, caches, calls, writes,
    fireLayoutReady() { for (const callback of layoutCallbacks.splice(0)) callback(); },
    fireVault: fireAll(vaultHandlers),
    fireMetaChanged: fireAll(metaHandlers),
    setCache(path, spec) {
      caches.set(path, {
        frontmatter: spec && spec.frontmatter ? spec.frontmatter : {},
        headings: spec && Array.isArray(spec.headings) ? spec.headings : [],
        blocks: spec && spec.blocks ? spec.blocks : {},
        listItems: spec && Array.isArray(spec.listItems) ? spec.listItems : [],
      });
    },
  };
}

function workedExample() {
  return makeHarness({
    "area.md": { frontmatter: {} },
    "project.md": { frontmatter: {} },
    "pig.md": areaNote("[[area]]"),
    "foo.md": projectNote("[[pig]]"),
    "goo.md": projectNote("[[pig]]"),
    "zoo.md": projectNote("[[pig]]"),
    "bar.md": projectNote("[[foo]]"),
    "baz.md": projectNote("[[foo]]"),
    "alpha.md": projectNote("[[goo]]"),
    "beta.md": projectNote("[[goo]]"),
  });
}

function stopShape(answer, role) {
  const stop = answer.step[role];
  assert.ok(stop, "expected " + role + " stop");
  assert.equal(stop.state, "exists");
  assert.equal(stop.ghostReason, null);
  assert.equal(stop.source, "tree");
  return stop;
}

test("api stays version 1 and the tree mixin is installed", () => {
  const harnessed = workedExample();
  assert.equal(harnessed.plugin.navGroupsApi().version, 1);
  assert.equal(NAV_GROUPS_API_VERSION, 1);
  assert.equal(typeof harnessed.plugin.navGroupsTreeOnChange, "function");
  assert.equal(typeof harnessed.plugin.navGroupsTreeEnsureBuilt, "function");
});

test("worked example: ]n walks siblings under one parent, wrapping", () => {
  const harnessed = workedExample();
  const bar = harnessed.plugin.navGroupsResolve({ path: "bar.md" });
  assert.equal(bar.ok, true);
  assert.equal(bar.route, "tree");
  assert.equal(bar.kind, "project");
  assert.equal(bar.lane, "open");
  assert.equal(bar.stepNone, null);
  assert.equal(bar.none, null);
  assert.equal(stopShape(bar, "next").path, "baz.md");
  assert.equal(bar.step.next.landingLabel, "baz");
  assert.equal(bar.step.next.groupLabel, "foo");
  assert.equal(bar.step.next.wraps, false);
  assert.equal(stopShape(bar, "prev").path, "baz.md");
  assert.equal(bar.step.prev.wraps, true);
  assert.equal(stopShape(bar, "parent").path, "foo.md");

  const baz = harnessed.plugin.navGroupsResolve({ path: "baz.md" });
  assert.equal(baz.step.next.path, "bar.md");
  assert.equal(baz.step.next.wraps, true);
  assert.equal(baz.step.prev.path, "bar.md");
  assert.equal(baz.step.prev.wraps, false);

  const foo = harnessed.plugin.navGroupsResolve({ path: "foo.md" });
  assert.equal(foo.step.next.path, "goo.md");
  assert.equal(foo.step.next.wraps, false);
  assert.equal(foo.step.prev.path, "zoo.md");
  assert.equal(foo.step.prev.wraps, true);

  const zoo = harnessed.plugin.navGroupsResolve({ path: "zoo.md" });
  assert.equal(zoo.step.next.path, "foo.md");
  assert.equal(zoo.step.next.wraps, true);
});

test("worked example: ]N tours families in outline order, wrapping", () => {
  const harnessed = workedExample();
  const bar = harnessed.plugin.navGroupsResolve({ path: "bar.md" });
  assert.equal(bar.group.label, "foo");
  assert.equal(bar.group.position, 1);
  assert.equal(bar.group.size, 2);
  assert.equal(bar.group.index, 2);
  assert.equal(bar.group.count, 3);
  assert.equal(bar.group.noun, "parent");
  assert.equal(bar.group.memberNoun, "project");
  assert.deepEqual(bar.group.members.map((member) => member.path), ["bar.md", "baz.md"]);
  assert.deepEqual(bar.group.members.map((member) => member.state), ["current", "exists"]);
  assert.equal(bar.nextGroup.path, "alpha.md");
  assert.equal(bar.nextGroup.groupLabel, "goo");
  assert.equal(bar.nextGroup.landingLabel, "alpha");
  assert.equal(bar.prevGroup.path, "foo.md");
  assert.equal(bar.prevGroup.groupLabel, "pig");
  assert.equal(bar.prevGroup.landingLabel, "foo");

  const beta = harnessed.plugin.navGroupsResolve({ path: "beta.md" });
  assert.equal(beta.nextGroup.path, "foo.md");
  assert.equal(beta.nextGroup.wraps, true);
  assert.equal(beta.prevGroup.path, "bar.md");
  assert.equal(beta.prevGroup.wraps, false);

  const foo = harnessed.plugin.navGroupsResolve({ path: "foo.md" });
  assert.equal(foo.nextGroup.path, "bar.md");
  assert.equal(foo.prevGroup.path, "alpha.md");
  assert.equal(foo.prevGroup.wraps, true);
  assert.equal(foo.step.parent.path, "pig.md");
  assert.equal(foo.step.parent.groupLabel, "Top level");
});

test("top-level area sentinel: single ring, Top level copy", () => {
  const harnessed = workedExample();
  const pig = harnessed.plugin.navGroupsResolve({ path: "pig.md" });
  assert.equal(pig.route, "tree");
  assert.equal(pig.kind, "area");
  assert.equal(pig.lane, null);
  assert.equal(pig.step.prev, null);
  assert.equal(pig.step.next, null);
  assert.equal(pig.step.parent, null);
  assert.equal(pig.stepNone.reason, "only-child");
  assert.equal(pig.stepNone.message, "pig is Top level's only area");
  assert.equal(pig.group.size, 1);
  assert.equal(pig.group.label, "Top level");
  assert.equal(pig.prevGroup, null);
  assert.equal(pig.nextGroup, null);
  assert.equal(pig.none.reason, "single-group");
  assert.equal(pig.none.message, "Top level holds every area — ]n walks them");
});

test("project.md sentinel parents walk under Top level", () => {
  const harnessed = makeHarness({
    "project.md": { frontmatter: {} },
    "top.md": projectNote("[[project]]"),
    "second.md": projectNote("[[project]]"),
  });
  const top = harnessed.plugin.navGroupsResolve({ path: "top.md" });
  assert.equal(top.route, "tree");
  assert.equal(top.step.parent, null);
  assert.equal(top.step.next.path, "second.md");
  assert.equal(top.group.label, "Top level");
  assert.equal(top.none.reason, "single-group");
  assert.equal(top.none.message, "Top level holds every open project — ]n walks them");
});

test("untyped sentinel notes are never members and never targets", () => {
  const harnessed = workedExample();
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "area.md" }).route, null);
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "project.md" }).route, null);
});

test("notebooks nest under areas, projects, and notebooks in title order", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "home.md": areaNote("[[area]]"),
    "zeta.md": notebookNote("[[home]]", { h1: "Zebra" }),
    "alpha.md": notebookNote("[[home]]", { h1: "apple" }),
    "mid.md": notebookNote("[[home]]", { alias: "Mango" }),
    "plain.md": notebookNote("[[home]]"),
    "kid.md": notebookNote("[[alpha]]", { h1: "Kid" }),
  });
  const plain = harnessed.plugin.navGroupsResolve({ path: "plain.md" });
  assert.equal(plain.kind, "notebook");
  // apple, Mango, plain (humanized), Zebra: title order, case-folded.
  assert.deepEqual(plain.group.members.map((member) => member.path),
    ["alpha.md", "mid.md", "plain.md", "zeta.md"]);
  assert.equal(plain.group.position, 3);
  assert.equal(plain.step.next.path, "zeta.md");
  assert.equal(plain.step.prev.path, "mid.md");
  const kid = harnessed.plugin.navGroupsResolve({ path: "kid.md" });
  assert.equal(kid.group.label, "apple");
  assert.equal(kid.step.parent.path, "alpha.md");
  assert.equal(kid.stepNone.message, "kid is apple's only notebook — ]N visits home's");
  // The outline tour reaches the nested family.
  assert.equal(kid.nextGroup.path, "alpha.md");
});

test("projects walk in open and closed lanes", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "home.md": areaNote("[[area]]"),
    "open-a.md": projectNote("[[home]]", " "),
    "open-b.md": projectNote("[[home]]", " "),
    "shut.md": projectNote("[[home]]", "x"),
  });
  const open = harnessed.plugin.navGroupsResolve({ path: "open-a.md" });
  assert.equal(open.lane, "open");
  assert.equal(open.step.next.path, "open-b.md");
  assert.equal(open.group.size, 2);
  const shut = harnessed.plugin.navGroupsResolve({ path: "shut.md" });
  assert.equal(shut.lane, "closed");
  assert.equal(shut.step.prev, null);
  assert.equal(shut.step.next, null);
  assert.equal(shut.stepNone.message, "shut is home's only closed project");
  assert.equal(shut.prevGroup, null);
  assert.equal(shut.nextGroup, null);
  assert.equal(shut.none.message, "home holds every closed project — ]n walks them");
  assert.deepEqual(shut.group.members.map((member) => member.path), ["shut.md"]);
});

test("a ^prj toggle flips the lane through the changed event", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "home.md": areaNote("[[area]]"),
    "flip.md": projectNote("[[home]]", " "),
  });
  harnessed.fireLayoutReady();
  const before = harnessed.plugin.navGroupsResolve({ path: "flip.md" });
  const generation = harnessed.plugin.navGroupsTreeGeneration;
  assert.equal(before.lane, "open");
  harnessed.setCache("flip.md", projectNote("[[home]]", "x"));
  harnessed.fireMetaChanged("changed", { path: "flip.md" }, null, harnessed.caches.get("flip.md"));
  assert.ok(harnessed.plugin.navGroupsTreeGeneration > generation);
  const after = harnessed.plugin.navGroupsResolve({ path: "flip.md" });
  assert.equal(after.lane, "closed");
  assert.equal(after.stepNone.reason, "only-child");
});

test("legacy [[article]] counts as prose and walks with prose", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "home.md": areaNote("[[area]]"),
    "essay.md": proseNote("[[home]]", { title: "Essay" }),
    "old.md": { frontmatter: { type: "[[article]]", parent: "[[home]]" } },
  });
  const essay = harnessed.plugin.navGroupsResolve({ path: "essay.md" });
  assert.equal(essay.kind, "prose");
  assert.equal(essay.lane, null);
  assert.deepEqual(essay.group.members.map((member) => member.path), ["essay.md", "old.md"]);
  const old = harnessed.plugin.navGroupsResolve({ path: "old.md" });
  assert.equal(old.kind, "prose");
  assert.equal(old.step.prev.path, "essay.md");
});

test("alias and heading forms of parent resolve to the note", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "home.md": areaNote("[[area]]"),
    "a.md": projectNote("[[home.md|Home]]"),
    "b.md": projectNote("[[home#notes]]"),
    "c.md": projectNote([["home"]]),
  });
  for (const path of ["a.md", "b.md", "c.md"]) {
    const answer = harnessed.plugin.navGroupsResolve({ path });
    assert.equal(answer.route, "tree", path);
    assert.equal(answer.step.parent.path, "home.md", path);
  }
  const a = harnessed.plugin.navGroupsResolve({ path: "a.md" });
  assert.deepEqual(a.group.members.map((member) => member.path), ["a.md", "b.md", "c.md"]);
});

test("duplicate basenames in different folders keep their own rings", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "pig.md": areaNote("[[area]]"),
    "a/dup.md": projectNote("[[pig]]"),
    "b/dup.md": projectNote("[[pig]]"),
    "a/kid.md": projectNote("[[dup]]"),
    "b/kid.md": projectNote("[[dup]]"),
  });
  const ring = harnessed.plugin.navGroupsResolve({ path: "a/dup.md" });
  assert.deepEqual(ring.group.members.map((member) => member.path), ["a/dup.md", "b/dup.md"]);
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "a/kid.md" }).step.parent.path, "a/dup.md");
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "b/kid.md" }).step.parent.path, "b/dup.md");
});

test("malformed parents explain themselves on both step and group", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "home.md": areaNote("[[area]]"),
    "bare.md": projectNote(undefined),
    "listed.md": projectNote(["[[home]]", "[[area]]"]),
    "lost.md": projectNote("[[qux]]"),
    "selfish.md": projectNote("[[selfish]]"),
  });
  const vectors = [
    ["bare.md", "no-parent", "bare has no parent — Ctrl+Shift+- sets one"],
    ["listed.md", "list-parent", "listed's parent lists several notes — keep one"],
    ["lost.md", "unresolved-parent", "lost's parent qux is not in the vault"],
    ["selfish.md", "self-parent", "selfish's parent chain loops back to selfish"],
  ];
  for (const [path, reason, message] of vectors) {
    const answer = harnessed.plugin.navGroupsResolve({ path });
    assert.equal(answer.route, "tree", path);
    assert.equal(answer.step.prev, null, path);
    assert.equal(answer.step.next, null, path);
    assert.equal(answer.step.parent, null, path);
    assert.equal(answer.group, null, path);
    assert.equal(answer.prevGroup, null, path);
    assert.equal(answer.nextGroup, null, path);
    assert.equal(answer.stepNone.reason, reason, path);
    assert.equal(answer.stepNone.message, message, path);
    assert.equal(answer.none.reason, reason, path);
    assert.equal(answer.none.message, message, path);
  }
});

test("a parent cycle looping back to the note suppresses its ring", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "a.md": projectNote("[[b]]"),
    "b.md": projectNote("[[a]]"),
  });
  for (const path of ["a.md", "b.md"]) {
    const answer = harnessed.plugin.navGroupsResolve({ path });
    assert.equal(answer.stepNone.reason, "cycle", path);
    assert.match(answer.stepNone.message, /parent chain loops back to/, path);
    assert.equal(answer.group, null, path);
  }
});

test("an ancestor-only cycle keeps the note's ring", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "x.md": projectNote("[[y]]"),
    "x2.md": projectNote("[[y]]"),
    "y.md": projectNote("[[z]]"),
    "z.md": projectNote("[[y]]"),
  });
  const x = harnessed.plugin.navGroupsResolve({ path: "x.md" });
  assert.equal(x.route, "tree");
  assert.equal(x.step.next.path, "x2.md");
  assert.equal(x.group.label, "y");
  assert.equal(x.prevGroup, null);
  assert.equal(x.nextGroup, null);
  assert.equal(x.none.reason, "single-group");
});

test("excluded paths, bank.md, and album notes never join", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "project.md": { frontmatter: {} },
    "bank.md": { frontmatter: {} },
    "pig.md": areaNote("[[area]]"),
    "done/hidden.md": projectNote("[[pig]]"),
    "ok.md": projectNote("[[pig]]"),
    "rec.md": { frontmatter: { type: "[[album]]", parent: "[[pig]]" } },
  });
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "done/hidden.md" }).route, null);
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "bank.md" }).route, null);
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "rec.md" }).route, null);
  const ok = harnessed.plugin.navGroupsResolve({ path: "ok.md" });
  assert.deepEqual(ok.group.members.map((member) => member.path), ["ok.md"]);
  assert.equal(ok.none.message, "pig holds every open project — ]n walks them");
});

test("every step target shares the source type, parent, and lane", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "project.md": { frontmatter: {} },
    "pig.md": areaNote("[[area]]"),
    "boar.md": areaNote("[[area]]"),
    "foo.md": projectNote("[[pig]]"),
    "goo.md": projectNote("[[pig]]", "x"),
    "bar.md": projectNote("[[foo]]"),
    "baz.md": projectNote("[[foo]]"),
    "solo.md": notebookNote("[[pig]]", { h1: "Solo" }),
  });
  const members = ["pig.md", "boar.md", "foo.md", "goo.md", "bar.md", "baz.md", "solo.md"];
  for (const path of members) {
    const answer = harnessed.plugin.navGroupsResolve({ path });
    assert.equal(answer.route, "tree", path);
    for (const role of ["prev", "next"]) {
      const stop = answer.step[role];
      if (!stop) continue;
      const target = harnessed.plugin.navGroupsResolve({ path: stop.path });
      assert.equal(target.kind, answer.kind, path + " " + role);
      assert.equal(target.lane, answer.lane, path + " " + role);
      assert.equal(target.group.parentPath, answer.group.parentPath, path + " " + role);
    }
  }
});

test("every group target is a first member of an occupied same-type group", () => {
  const harnessed = workedExample();
  const seen = new Set(["bar.md"]);
  let cursor = harnessed.plugin.navGroupsResolve({ path: "bar.md" });
  for (let step = 0; step < 6; step += 1) {
    assert.ok(cursor.nextGroup, "tour continues");
    assert.equal(cursor.nextGroup.state, "exists");
    const landing = harnessed.plugin.navGroupsResolve({ path: cursor.nextGroup.path });
    assert.equal(landing.kind, cursor.kind);
    assert.equal(landing.lane, cursor.lane);
    assert.equal(landing.group.position, 1);
    assert.equal(landing.group.label, cursor.nextGroup.groupLabel);
    cursor = landing;
    seen.add(cursor.group.parentPath);
  }
  assert.equal(cursor.nextGroup.path, "alpha.md");
  assert.deepEqual([...seen].sort(), ["bar.md", "foo.md", "goo.md", "pig.md"].sort());
});

test("repeated ]N cycles a stable ring of families", () => {
  const harnessed = workedExample();
  const order = [];
  let path = "bar.md";
  for (let step = 0; step < 3; step += 1) {
    const answer = harnessed.plugin.navGroupsResolve({ path });
    order.push(answer.nextGroup.path);
    path = answer.nextGroup.path;
  }
  assert.deepEqual(order, ["alpha.md", "foo.md", "bar.md"]);
  const again = harnessed.plugin.navGroupsResolve({ path });
  assert.equal(again.nextGroup.path, "alpha.md");
});

test("calendar answers gain lane and stepNone nulls and stay otherwise identical", () => {
  const harnessed = makeHarness({
    "area.md": { frontmatter: {} },
    "pig.md": areaNote("[[area]]"),
  });
  const day = harnessed.plugin.navGroupsResolve({ path: "2026/20261121.md" });
  assert.equal(day.route, "calendar");
  assert.equal(day.kind, "day");
  assert.equal(day.lane, null);
  assert.equal(day.stepNone, null);
  const other = harnessed.plugin.navGroupsResolve({ path: "notes/random.md" });
  assert.equal(other.route, null);
  assert.equal(other.lane, null);
  assert.equal(other.stepNone, null);
});

test("the fast membership path agrees with propertyCardNoteSpecies everywhere", () => {
  const types = [
    undefined,
    "[[area]]",
    "[[project]]",
    "[[notebook]]",
    "[[prose]]",
    "[[article]]",
    "[[album]]",
    "[[record]]",
    "[[ref]]",
    "area",
    "project",
    ["[[project]]"],
    [["[[notebook]]"]],
    ["[[prose]]", "[[article]]"],
    ["[[area]]", "[[project]]"],
    "[[area]], [[project]]",
    "- [[prose]]",
    "[[prose]].md",
    "foo",
    "",
    7,
  ];
  const paths = [
    "home.md",
    "a/b.md",
    "done/hidden.md",
    "_templates/x.md",
    "a/_conflicts/x.md",
    ".obsidian/x.md",
    "x/_generated/y.md",
    "dash.md",
    "x/dash.md",
    "area.md",
    "project.md",
    "bank.md",
    "BANK.md",
    "2026/20261121.md",
    "2026.md",
    "all_time.md",
    "note1234.md",
    "x/done.md",
  ];
  const memo = new Map();
  const memoized = (fm) => navGroupsTreeMemoizedKindOfType(memo, fm);
  let compared = 0;
  for (const type of types) {
    for (const path of paths) {
      const fm = type === undefined ? {} : { type };
      const slow = navGroupsTreeSpecies(path, fm, TODAY);
      assert.equal(navGroupsTreeSpeciesFast(path, fm, TODAY), slow, path + " " + JSON.stringify(type));
      assert.equal(navGroupsTreeSpeciesFast(path, fm, TODAY, memoized), slow, path + " memo");
      compared += 1;
    }
  }
  assert.ok(compared > 100);
  assert.ok(navGroupsTreeExcludedFast("done/x.md"));
  assert.ok(navGroupsTreeExcludedFast("x/_templates/y.md"));
  assert.ok(!navGroupsTreeExcludedFast("x/done.md"));
  assert.ok(!navGroupsTreeExcludedFast("notes/ok.md"));
});

test("comparators mirror the Rust catalogs: folded label, then path", () => {
  const member = (label, path) => ({ label, folded: label.toLowerCase(), path });
  // Areas (graph.rs sort_paths): stem, case-folded, then path.
  const areas = ["bravo.md", "alpha.md", "Charlie.md", "b/dup.md", "a/dup.md"]
    .map((path) => member(path.replace(/\.md$/, "").split("/").pop(), path));
  assert.deepEqual(areas.sort(navGroupsTreeCompareMembers).map((entry) => entry.path),
    ["alpha.md", "bravo.md", "Charlie.md", "a/dup.md", "b/dup.md"]);
  // Projects open lane (catalog.rs sort_rows): same rule.
  const projects = ["Charlie.md", "alpha.md", "bravo.md"]
    .map((path) => member(path.replace(/\.md$/, ""), path));
  assert.deepEqual(projects.sort(navGroupsTreeCompareMembers).map((entry) => entry.path),
    ["alpha.md", "bravo.md", "Charlie.md"]);
  // Notebooks (catalog.rs sort_level): title, case-folded, then path.
  const notebooks = [
    member("Zebra", "z.md"),
    member("apple", "a.md"),
    member("Mango", "m.md"),
    member("apple", "b.md"),
  ];
  assert.deepEqual(notebooks.sort(navGroupsTreeCompareMembers).map((entry) => entry.path),
    ["a.md", "b.md", "m.md", "z.md"]);
});

test("outline keys sort families in pre-order and prefixes sort first", () => {
  assert.ok(navGroupsTreeCompareKeys([[0, "pig", "pig.md"]], []) > 0);
  assert.ok(navGroupsTreeCompareKeys([], [[0, "pig", "pig.md"]]) < 0);
  assert.equal(navGroupsTreeCompareKeys([[1, "a", "a.md"]], [[1, "a", "a.md"]]), 0);
  assert.ok(navGroupsTreeCompareKeys([[0, "a", "a.md"]], [[1, "a", "a.md"]]) < 0);
  assert.ok(navGroupsTreeCompareKeys([[1, "a", "a.md"]], [[1, "b", "b.md"]]) < 0);
  assert.ok(navGroupsTreeKindRank("area") < navGroupsTreeKindRank("project"));
  assert.ok(navGroupsTreeKindRank("prose") > navGroupsTreeKindRank("notebook"));
  assert.ok(navGroupsTreeIsKind("prose"));
  assert.ok(!navGroupsTreeIsKind("bank"));
  assert.deepEqual(navGroupsTreeClassifyParentRaw([["x"]]), { status: "target", target: "x" });
  assert.deepEqual(navGroupsTreeClassifyParentRaw(["[[a]]", "[[b]]"]).status, "list");
  assert.equal(navGroupsTreeLaneFromCache(prjCache("x")), "closed");
  assert.equal(navGroupsTreeLaneFromCache(prjCache(" ")), "open");
  assert.equal(navGroupsTreeLaneFromCache({}), "open");
});

test("vault create, delete, and rename each bump the generation", () => {
  const harnessed = workedExample();
  harnessed.fireLayoutReady();
  harnessed.plugin.navGroupsResolve({ path: "bar.md" });
  const generation = harnessed.plugin.navGroupsTreeGeneration;
  harnessed.fireVault("create", { path: "new.md" });
  assert.equal(harnessed.plugin.navGroupsTreeGeneration, generation + 1);
  harnessed.fireVault("delete", { path: "new.md" });
  assert.equal(harnessed.plugin.navGroupsTreeGeneration, generation + 2);
  harnessed.fireVault("rename", { path: "renamed.md" }, "new.md");
  assert.equal(harnessed.plugin.navGroupsTreeGeneration, generation + 3);
  const notifications = [];
  const unsubscribe = harnessed.plugin.navGroupsTreeOnChange((value) => notifications.push(value));
  harnessed.fireVault("create", { path: "another.md" });
  assert.deepEqual(notifications, [generation + 4]);
  unsubscribe();
  harnessed.fireVault("create", { path: "quiet.md" });
  assert.deepEqual(notifications, [generation + 4]);
});

test("an irrelevant changed event does not bump the generation", () => {
  const harnessed = workedExample();
  harnessed.fireLayoutReady();
  harnessed.plugin.navGroupsResolve({ path: "bar.md" });
  const generation = harnessed.plugin.navGroupsTreeGeneration;
  const cache = harnessed.caches.get("bar.md");
  harnessed.fireMetaChanged("changed", { path: "bar.md" }, null, cache);
  assert.equal(harnessed.plugin.navGroupsTreeGeneration, generation);
});

test("lazy cold answers indexing and builds nothing", () => {
  const harnessed = workedExample();
  const before = { ...harnessed.calls };
  const answer = harnessed.plugin.navGroupsResolve({ path: "bar.md", lazy: true });
  assert.equal(answer.route, "tree");
  assert.equal(answer.kind, "project");
  assert.equal(answer.lane, "open");
  assert.equal(answer.none.reason, "indexing");
  assert.equal(answer.none.message, "Link walk is indexing");
  assert.equal(answer.step, null);
  assert.equal(answer.group, null);
  assert.equal(harnessed.plugin.navGroupsTreeTables, null);
  assert.equal(harnessed.calls.markdownFiles, before.markdownFiles);
  // A non-member falls through to calendar instead of indexing.
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "notes/random.md", lazy: true }).route, null);
});

test("non-lazy cold builds synchronously once; warm resolves scan nothing", () => {
  const harnessed = workedExample();
  const first = harnessed.plugin.navGroupsResolve({ path: "bar.md" });
  assert.equal(first.route, "tree");
  const scans = harnessed.calls.markdownFiles;
  assert.ok(scans > 0);
  const cached = harnessed.calls.fileCache;
  harnessed.plugin.navGroupsResolve({ path: "baz.md" });
  harnessed.plugin.navGroupsResolve({ path: "bar.md", lazy: true });
  assert.equal(harnessed.calls.markdownFiles, scans);
  assert.equal(harnessed.calls.fileCache, cached);
  const linkCalls = harnessed.calls.link;
  harnessed.plugin.navGroupsResolve({ path: "alpha.md" });
  assert.equal(harnessed.calls.link, linkCalls);
  assert.equal(harnessed.calls.markdownFiles, scans);
});

test("teardown drops the index and the next resolve rebuilds", () => {
  const harnessed = workedExample();
  harnessed.plugin.navGroupsResolve({ path: "bar.md" });
  assert.ok(harnessed.plugin.navGroupsTreeTables);
  harnessed.plugin.teardownNavGroups();
  assert.equal(harnessed.plugin.navGroupsTreeTables, null);
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "bar.md" }).route, "tree");
});

test("the provider never throws on a broken app and never writes", () => {
  const harnessed = workedExample();
  const broken = Object.create(LedgerToolsPlugin.prototype);
  broken.app = {};
  broken.addCommand = () => {};
  broken.registerEvent = () => ({});
  broken.navGroupsTodayOverride = TODAY;
  broken.setupNavGroups();
  const answer = broken.navGroupsResolve({ path: "bar.md" });
  assert.equal(typeof answer, "object");
  assert.ok(Object.isFrozen(answer));
  const lazy = broken.navGroupsResolve({ path: "bar.md", lazy: true });
  assert.ok(lazy === null || typeof lazy === "object");
  // The healthy harness wrote nothing while answering.
  assert.deepEqual(harnessed.writes, []);
  assert.equal(harnessed.plugin.navGroupsResolve({ path: "bar.md" }).route, "tree");
  assert.deepEqual(harnessed.writes, []);
});
