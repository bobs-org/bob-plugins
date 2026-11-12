const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
}
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const StateEffect = { define: () => ({ of(value) { return { value, effect: this, value }; }, is(other) { return this === other; } }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = { none: [], widget: (options) => ({ widget: options.widget, side: options.side }) };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: TestNotice, Plugin: TestPlugin, Platform: { isDesktopApp: true },
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

function reportWith(paths) {
  const map = new Map(paths.map((p) => [p, { path: p, stem: p.replace(/\.md$/i, "").split("/").pop() }]));
  return { albumsByPath: map, albums: [...map.values()] };
}

function vaultOf(files) {
  const set = new Set(files);
  return {
    getAbstractFileByPath: (p) => (set.has(p) ? { path: p } : null),
  };
}

function cacheOf(dest) {
  return {
    getFirstLinkpathDest: (name) => (dest && dest[name] ? { path: dest[name] } : null),
  };
}

test("entry kind covers scalar, list, wikilink, and legacy noun types", () => {
  assert.equal(helpers.albumSchemaEntryKindOf({ type: "[[album]]" }), "album");
  assert.equal(helpers.albumSchemaEntryKindOf({ type: ["[[album]]"] }), "album");
  assert.equal(helpers.albumSchemaEntryKindOf({ type: " [[album]] " }), "album");
  assert.equal(helpers.albumSchemaEntryKindOf({ type: "[[record]]" }), "record");
  assert.equal(helpers.albumSchemaEntryKindOf({ type: [["[[record]]"]] }), "record");
  assert.equal(helpers.albumSchemaEntryKindOf({ type: "[[restaurant]]" }), "record");
  assert.equal(helpers.albumSchemaEntryKindOf({ type: ["[[other]]", "[[restaurant]]"] }), "record");
  for (const type of ["[[area]]", "[[project]]", "[[notebook]]", "[[ref]]"]) {
    assert.equal(helpers.albumSchemaEntryKindOf({ type }), "other", type);
  }
  assert.equal(helpers.albumSchemaEntryKindOf({}), "other");
  assert.equal(helpers.albumSchemaEntryKindOf(null), "other");
});

test("parent target handles scalar, list, and ambiguous forms", () => {
  assert.equal(helpers.albumSchemaEntryParentTarget("[[eat]]"), "eat");
  assert.equal(helpers.albumSchemaEntryParentTarget([["eat"]]), "eat");
  assert.equal(helpers.albumSchemaEntryParentTarget("[[eat|Dining]]"), "eat");
  assert.equal(helpers.albumSchemaEntryParentTarget("eat"), "");
  assert.equal(helpers.albumSchemaEntryParentTarget(["[[a]]", "[[b]]"]), "");
  assert.equal(helpers.albumSchemaEntryParentTarget(null), "");
});

test("direct album paths resolve through the report", () => {
  const report = reportWith(["eat.md"]);
  const ok = helpers.albumResolveSchemaTargetForFile("eat.md", {
    frontmatter: { type: "[[album]]" },
    metadataCache: cacheOf({}),
    vault: vaultOf(["eat.md"]),
    report,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.albumPath, "eat.md");
  assert.equal(ok.kind, "album");
  const missing = helpers.albumResolveSchemaTargetForFile("ghost.md", {
    frontmatter: { type: "[[album]]" },
    metadataCache: cacheOf({}),
    vault: vaultOf(["ghost.md"]),
    report,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "not-in-report");
});

test("record notes resolve their actual parent link", () => {
  const report = reportWith(["eat.md"]);
  const vault = vaultOf(["eat.md", "nagi.md"]);
  const ok = helpers.albumResolveSchemaTargetForFile("nagi.md", {
    frontmatter: { type: "[[record]]", parent: "[[eat]]" },
    metadataCache: cacheOf({}),
    vault,
    report,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, "record-parent");
  assert.equal(ok.albumPath, "eat.md");
});

test("record legacy types resolve like records", () => {
  const report = reportWith(["eat.md"]);
  const vault = vaultOf(["eat.md", "nagi.md"]);
  const ok = helpers.albumResolveSchemaTargetForFile("nagi.md", {
    frontmatter: { type: "[[restaurant]]", parent: "[[eat]]" },
    metadataCache: cacheOf({}),
    vault,
    report,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.albumPath, "eat.md");
});

test("missing, cyclic, ambiguous, and non-album parents teach instead of guessing", () => {
  const report = reportWith(["eat.md", "dev.md"]);
  const vault = vaultOf(["eat.md", "dev.md", "nagi.md", "self.md"]);
  const missing = helpers.albumResolveSchemaTargetForFile("nagi.md", {
    frontmatter: { type: "[[record]]" },
    metadataCache: cacheOf({}),
    vault,
    report,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing-parent");
  assert.match(helpers.albumSchemaEntryTeach(missing), /parent/);

  const gone = helpers.albumResolveSchemaTargetForFile("nagi.md", {
    frontmatter: { type: "[[record]]", parent: "[[ghost]]" },
    metadataCache: cacheOf({}),
    vault,
    report,
  });
  assert.equal(gone.ok, false);
  assert.equal(gone.reason, "missing-parent");
  assert.match(gone.message, /could not be found/);

  const cyclic = helpers.albumResolveSchemaTargetForFile("self.md", {
    frontmatter: { type: "[[record]]", parent: "[[self]]" },
    metadataCache: cacheOf({}),
    vault,
    report,
  });
  assert.equal(cyclic.ok, false);
  assert.equal(cyclic.reason, "cyclic-parent");

  const ambiguous = helpers.albumResolveSchemaTargetForFile("nagi.md", {
    frontmatter: { type: "[[record]]", parent: ["[[eat]]", "[[dev]]"] },
    metadataCache: cacheOf({}),
    vault,
    report,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, "ambiguous-parent");

  const nonAlbum = helpers.albumResolveSchemaTargetForFile("nagi.md", {
    frontmatter: { type: "[[record]]", parent: "[[dev]]" },
    metadataCache: cacheOf({}),
    vault,
    report: reportWith(["eat.md"]),
  });
  assert.equal(nonAlbum.ok, false);
  assert.equal(nonAlbum.reason, "non-album-parent");
  assert.match(nonAlbum.message, /not an album/);

  const unrelated = helpers.albumResolveSchemaTargetForFile("scratch.md", {
    frontmatter: { type: "[[project]]" },
    metadataCache: cacheOf({}),
    vault: vaultOf(["scratch.md"]),
    report,
  });
  assert.equal(unrelated.ok, false);
  assert.equal(unrelated.reason, "not-album-or-record");
});

test("palette command is registered as a literal addCommand for the inventory", () => {
  const mainPath = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "main.js");
  const built = fs.readFileSync(mainPath, "utf8");
  assert.match(built, /id:\s*"edit-album-schema"/);
  const srcPath = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "src", "242d-plugin-album-entrypoints.js");
  const src = fs.readFileSync(srcPath, "utf8");
  assert.match(src, /this\.addCommand\(\{\s*\n?\s*id:\s*"edit-album-schema"/);
});
