// Ref kit: species registry, ribbon tile, silent created, coordinator kind,
// predicates, coverage, and precedence with ref slotted after prose.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class TestPlugin {}
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class {}, MarkdownRenderer: {}, MarkdownView: {}, Modal: class {},
    Notice: class {}, Platform: { isDesktopApp: true }, Plugin: TestPlugin,
    PluginSettingTab: class {}, Setting: class {}, normalizePath: (value) => value,
    parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect: { define: () => ({}) }, StateField: { define: () => ({}) }, RangeSetBuilder: class {} };
  if (request === "@codemirror/view") return { EditorView: {}, keymap: { of: (value) => value }, ViewPlugin: { fromClass: (value) => value }, Decoration: {}, WidgetType: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

const TODAY = "2026-11-26";
const PLAIN = "Notes/note.md";
const REF = "ref/paper.md";
const instant = (value) => new Date(value);
const stampOptions = (extra = {}) => ({ now: instant("2026-06-11T15:00:00.000Z"), timeZone: "America/Chicago", ...extra });

test("the registry carries the ref species", () => {
  assert.ok(H.PROPERTY_CARD_KINDS.includes("ref"));
  assert.deepEqual(H.propertyCardSpecies("ref"), {
    kind: "ref", word: "Ref", tile: "ribbon", icon: "bookmark",
    band: "", temporal: false, foldDefault: true,
  });
  assert.equal(H.propertyCardAccessibleName("ref", "Attention"), "Ref: Attention");
  assert.equal(H.propertyCardAccessibleName("ref", ""), "Ref");
});

test("the ribbon tile ships in styles.css with a Ref Card region", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"), "utf8",
  );
  for (const token of [
    '.bob-property-card-tile[data-tile-form="ribbon"]',
    "/* Ref Card (bob-cli-qp ref-card): start.",
    "/* Ref Card (bob-cli-qp ref-card): end.",
  ]) {
    assert.ok(css.includes(token), `styles.css carries ${token}`);
  }
});

test("ref omits a missing created stamp", () => {
  assert.equal(H.propertyCardFormatCreatedStamp(stampOptions({ kind: "ref" })).text, "");
  assert.equal(
    H.propertyCardFormatCreatedStamp(stampOptions({ kind: "ref", value: "2026-06-09" })).text,
    "created Jun 9",
  );
});

test("the ref predicate claims exactly [[ref]]", () => {
  assert.equal(H.noteCardIsRefKind({ type: "[[ref]]" }), true);
  assert.equal(H.noteCardIsRefKind({ type: "ref" }), true);
  assert.equal(H.noteCardIsRefKind({ type: ["[[ref]]"] }), true);
  assert.equal(H.noteCardIsRefKind({ type: ["[[ref]]", "[[ref]]"] }), false);
  assert.equal(H.noteCardIsRefKind({ type: ["[[ref]]", "[[project]]"] }), false);
  assert.equal(H.noteCardIsRefKind({ type: "[[prose]]" }), false);
  assert.equal(H.noteCardIsRefKind({}), false);
  assert.equal(H.noteCardIsRefKind(null), false);
  assert.equal(H.noteCardIsRefKind({ type: "[[Ref]]" }), true);
});

test("the ref coverage predicate gates the library", () => {
  assert.equal(H.noteCardIsRefLibraryPath("ref/paper.md"), true);
  assert.equal(H.noteCardIsRefLibraryPath("ref/papers/paper.md"), true);
  assert.equal(H.noteCardIsRefLibraryPath("sase_ref.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("Notes/paper.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref_history/old.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/.hidden/paper.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/x.assets/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/_generated/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/_templates/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/_conflicts/note.md"), false);
  assert.equal(H.noteCardIsRefLibraryPath("ref/paper (conflict 2026).md"), false);
  assert.equal(H.noteCardIsRefLibraryPath(""), false);
});

test("precedence slots ref after prose and claims only library notes", () => {
  const fm = (names) => {
    if (!names) return {};
    if (names.length === 1) return { type: `[[${names[0]}]]` };
    return { type: names.map((name) => `[[${name}]]`) };
  };
  assert.equal(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["ref"]), today: TODAY }), "ref");
  assert.equal(H.propertyCardNoteSpecies({ path: PLAIN, frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: "sase_ref.md", frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: "ref_history/old.md", frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: "ref/x.assets/note.md", frontmatter: fm(["ref"]), today: TODAY }), null);
  assert.notEqual(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["ref", "project"]), today: TODAY }), "ref");
  assert.equal(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["prose"]), today: TODAY }), "prose");
  assert.equal(H.propertyCardNoteSpecies({ path: REF, frontmatter: fm(["notebook"]), today: TODAY }), "notebook");
});

test("the coordinator knows the ref mount attribute", () => {
  assert.equal(H.REF_NOTE_CARD_MOUNT_ATTR, "data-ref-source");
  const mount = (source) => ({ getAttribute: (name) => (name === source ? "ref/paper.md" : null) });
  assert.equal(H.propertyCardFrontmatterMountPath(mount("data-ref-source"), "ref"), "ref/paper.md");
});
