// Notebook/Prose kit: species registry, created silence, predicates, and
// the precedence function with its exhaustive two-type test.
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
const instant = (value) => new Date(value);
const stampOptions = (extra = {}) => ({ now: instant("2026-06-11T15:00:00.000Z"), timeZone: "America/Chicago", ...extra });

test("the registry carries the notebook and prose species", () => {
  assert.ok(H.PROPERTY_CARD_KINDS.includes("notebook"));
  assert.ok(H.PROPERTY_CARD_KINDS.includes("prose"));
  assert.deepEqual(H.propertyCardSpecies("notebook"), {
    kind: "notebook", word: "Notebook", tile: "spine", icon: "notebook-tabs",
    band: "", temporal: false, foldDefault: true,
  });
  assert.deepEqual(H.propertyCardSpecies("prose"), {
    kind: "prose", word: "Prose", tile: "folio", icon: "pilcrow",
    band: "", temporal: false, foldDefault: false,
  });
  assert.equal(H.propertyCardAccessibleName("notebook", "Dev tools"), "Notebook: Dev tools");
  assert.equal(H.propertyCardAccessibleName("prose", ""), "Prose");
});

test("the tile forms ship in styles.css with card regions", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"), "utf8",
  );
  for (const token of [
    '.bob-property-card-tile[data-tile-form="spine"]',
    '.bob-property-card-tile[data-tile-form="folio"]',
    "/* Notebook Card (bob-cli-qm notebook-card): start.",
    "/* Prose Card (bob-cli-qm prose-card): start.",
  ]) {
    assert.ok(css.includes(token), `styles.css carries ${token}`);
  }
});

test("notebook and prose omit a missing created stamp", () => {
  assert.equal(H.propertyCardFormatCreatedStamp(stampOptions({ kind: "notebook" })).text, "");
  assert.equal(H.propertyCardFormatCreatedStamp(stampOptions({ kind: "prose" })).text, "");
  assert.equal(
    H.propertyCardFormatCreatedStamp(stampOptions({ kind: "notebook", value: "2026-06-09" })).text,
    "created Jun 9",
  );
  assert.equal(
    H.propertyCardFormatCreatedStamp(stampOptions({ kind: "prose", value: "2026-06-09" })).text,
    "created Jun 9",
  );
  assert.equal(H.propertyCardFormatCreatedStamp(stampOptions({ kind: "project" })).text, "no created date");
  assert.equal(H.propertyCardFormatCreatedStamp(stampOptions({ kind: "area" })).text, "");
});

test("the notebook predicate claims exactly [[notebook]]", () => {
  assert.equal(H.noteCardIsNotebookKind({ type: "[[notebook]]" }), true);
  assert.equal(H.noteCardIsNotebookKind({ type: "notebook" }), true);
  assert.equal(H.noteCardIsNotebookKind({ type: ["[[notebook]]"] }), true);
  assert.equal(H.noteCardIsNotebookKind({ type: ["[[notebook]]", "[[notebook]]"] }), false);
  assert.equal(H.noteCardIsNotebookKind({ type: ["[[notebook]]", "[[area]]"] }), false);
  assert.equal(H.noteCardIsNotebookKind({ type: "[[prose]]" }), false);
  assert.equal(H.noteCardIsNotebookKind({}), false);
  assert.equal(H.noteCardIsNotebookKind(null), false);
  assert.equal(H.noteCardIsNotebookKind({ type: "[[Notebook]]" }), true);
});

test("the prose predicate accepts both spellings and no mixture", () => {
  assert.equal(H.noteCardIsProseKind({ type: "[[prose]]" }), true);
  assert.equal(H.noteCardIsProseKind({ type: "[[article]]" }), true);
  assert.equal(H.noteCardIsProseKind({ type: "prose" }), true);
  assert.equal(H.noteCardIsProseKind({ type: ["[[prose]]", "[[article]]"] }), true);
  assert.equal(H.noteCardIsProseKind({ type: ["[[article]]", "[[article]]"] }), true);
  assert.equal(H.noteCardIsProseKind({ type: ["[[prose]]", "[[area]]"] }), false);
  assert.equal(H.noteCardIsProseKind({ type: ["[[prose]]", "[[notebook]]"] }), false);
  assert.equal(H.noteCardIsProseKind({ type: "[[notebook]]" }), false);
  assert.equal(H.noteCardIsProseKind({}), false);
  assert.equal(H.noteCardIsProseKind(null), false);
});

test("exclusions match the home card", () => {
  assert.equal(H.noteCardPathExcluded("Notes/note.md"), false);
  assert.equal(H.noteCardPathExcluded("_templates/note.md"), true);
  assert.equal(H.noteCardPathExcluded("done/note.md"), true);
  assert.equal(H.noteCardPathExcluded("Notes/_conflicts/note.md"), true);
  assert.equal(H.noteCardPathExcluded("area.md"), true);
  assert.equal(H.noteCardPathExcluded(""), true);
});

// One claim per note across every single-type, empty, and two-type
// combination. Temporal is path-based, so the matrix runs on a plain path
// (temporal claims nothing) plus explicit bank and daily paths.
test("precedence resolves at most one species per note", () => {
  const kinds = ["area", "project", "album", "record", "notebook", "prose", "article", "bank_month", "ref", "custom"];
  const fm = (names) => {
    if (!names) return {};
    if (names.length === 1) return { type: `[[${names[0]}]]` };
    return { type: names.map((name) => `[[${name}]]`) };
  };
  // Raw predicate claims in bob's props order. Like the == registry's
  // first-match resolution, at most one of them mounts: the precedence
  // function returns the first firing claim, or null.
  const rawClaims = (frontmatter, filePath = PLAIN) => {
    const found = [];
    if (H.bankSetupIsHubPath(filePath)) found.push("bank");
    if (!H.bankSetupIsHubPath(filePath) && H.noteCardPathExcluded(filePath)) return found;
    if (H.albumSchemaEntryKindOf(frontmatter) === "album") found.push("album");
    if (H.recordSheetIsCanonicalRecordType(frontmatter)) found.push("record");
    const home = H.homeCardEligible(filePath, frontmatter);
    if (home) found.push(home.kind);
    const subject = H.intentionCardSubjectForPath(filePath, TODAY);
    if (subject) found.push(subject.kind);
    if (H.noteCardIsNotebookKind(frontmatter)) found.push("notebook");
    if (H.noteCardIsProseKind(frontmatter)) found.push("prose");
    return found;
  };
  const check = (label, frontmatter, filePath = PLAIN) => {
    const found = rawClaims(frontmatter, filePath);
    const expected = found.length ? found[0] : null;
    const species = H.propertyCardNoteSpecies({ path: filePath, frontmatter, today: TODAY });
    assert.equal(species, expected, `${label} resolves to its first claim (raw: ${found.join(",") || "none"})`);
    return found;
  };
  check("empty type", fm(null));
  check("missing type key", {});
  for (const kind of kinds) check(`single ${kind}`, fm([kind]));
  // Raw co-claims happen only where the album builtin and the home
  // predicate overlap; the ordered resolution still mounts exactly one.
  const multi = new Set();
  for (const first of kinds) {
    for (const second of kinds) {
      const found = check(`pair ${first}+${second}`, fm([first, second]));
      if (found.length > 1) multi.add(`${first}+${second}`);
    }
  }
  assert.deepEqual(
    [...multi].sort(),
    ["album+area", "album+project", "area+album", "project+album"].sort(),
    "only the album/home overlap co-claims, and album wins it",
  );
  // Dual spellings, exclusions, and the bank and daily paths.
  check("prose pair", { type: ["[[prose]]", "[[article]]"] });
  check("excluded template", fm(["notebook"]), "_templates/note.md");
  check("excluded done", fm(["prose"]), "done/note.md");
  check("excluded conflicts", fm(["album"]), "Notes/_conflicts/note.md");
  check("bank hub", { type: "[[record]]" }, "bank.md");
  check("bank hub bare", {}, "bank.md");
  check("bank hub album", fm(["album"]), "bank.md");
  const daily = "2026/20261126.md";
  assert.deepEqual(rawClaims(fm(null), daily), ["day"], "the daily path claims the temporal species");
  assert.deepEqual(
    rawClaims(fm(["notebook"]), daily),
    ["day", "notebook"],
    "temporal outranks notebook on a daily path",
  );
  check("daily notebook", fm(["notebook"]), daily);
  check("daily area", fm(["area"]), daily);
  check("daily album", fm(["album"]), daily);
  // Spot checks on the resolved order.
  assert.equal(H.propertyCardNoteSpecies({ path: PLAIN, frontmatter: fm(["notebook"]), today: TODAY }), "notebook");
  assert.equal(H.propertyCardNoteSpecies({ path: PLAIN, frontmatter: fm(["article"]), today: TODAY }), "prose");
  assert.equal(H.propertyCardNoteSpecies({ path: PLAIN, frontmatter: fm(["prose", "area"]), today: TODAY }), "area");
  assert.equal(H.propertyCardNoteSpecies({ path: PLAIN, frontmatter: fm(["notebook", "prose"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: PLAIN, frontmatter: fm(["custom"]), today: TODAY }), null);
  assert.equal(H.propertyCardNoteSpecies({ path: "", frontmatter: fm(["notebook"]), today: TODAY }), null);
});
