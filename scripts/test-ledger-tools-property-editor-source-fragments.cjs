// Property editor source fragments: read-only YAML source adapter and
// clipboard decoder (phase source-fragments). Pure helpers only: no DOM, no
// bob spawns, no writes. Parsing is semantic through an injected parseYaml;
// structure (order, spans, trivia) comes from the source scanner.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

// Minimal structural key-set parser for fixtures: returns a null-prototype
// record of top-level keys so cross-checks exercise the wiring without a
// YAML dependency. Fixtures that need value semantics use JSON-compatible
// scalars asserted as strings.
function stubParseYaml(yaml) {
  const record = Object.create(null);
  for (const line of String(yaml).split("\n")) {
    if (!line.trim() || /^[ \t]/.test(line) || /^\s*#/.test(line)) continue;
    const match = line.match(/^((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^']|'')*')|[^:#]+?):(\s|$)/);
    if (!match) continue;
    let key = match[1].trim();
    if (key.startsWith('"')) key = JSON.parse(key);
    else if (key.startsWith("'")) key = key.slice(1, -1).replace(/''/g, "'");
    record[key] = 1;
  }
  return record;
}

function slicesExact(source, entries) {
  for (const entry of entries) {
    assert.equal(source.slice(entry.start, entry.end), entry.raw, `byte slice for ${entry.key}`);
  }
}

test("source entries keep order, spans, trivia, and value fragments", () => {
  const source = "---\n# about title\ntitle: Hello\ncount: 5 # qty\n---\nBody\n";
  const result = H.propertyEditorSourceEntries(source);
  assert.equal(result.ok, true);
  assert.equal(result.flow, false);
  assert.deepEqual(result.entries.map((entry) => [entry.key, entry.occurrence]), [["title", 1], ["count", 1]]);
  assert.equal(result.entries[0].leading, "# about title\n");
  assert.equal(result.entries[0].raw, "# about title\ntitle: Hello\n");
  assert.equal(result.entries[1].raw, "count: 5 # qty\n");
  assert.equal(result.entries[1].valueYaml, "5");
  assert.equal(result.entries[1].trivia, "");
  slicesExact(source, result.entries);
});

test("source entries handle BOM, CRLF, and missing final newline", () => {
  const source = "\uFEFF---\r\ntitle: Hi\r\ncount: 0\r\n---\r\n";
  const result = H.propertyEditorSourceEntries(source);
  assert.equal(result.ok, true);
  assert.equal(result.lineEnding, "\r\n");
  assert.equal(result.entries[0].valueYaml, "Hi");
  assert.equal(result.entries[1].valueYaml, "0");
  slicesExact(source, result.entries);
  const noFinal = "---\ntitle: Hi\n---";
  const parsed = H.propertyEditorSourceEntries(noFinal);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries[0].raw, "title: Hi\n");
  slicesExact(noFinal, parsed.entries);
});

test("source entries preserve empty, null, false, zero, and coercible text", () => {
  const source = "---\nempty:\nnothing: null\nnope: false\nzero: 0\ncode: '0123'\n---\n";
  const result = H.propertyEditorSourceEntries(source);
  assert.equal(result.ok, true);
  const byKey = new Map(result.entries.map((entry) => [entry.key, entry.valueYaml]));
  assert.equal(byKey.get("empty"), "null");
  assert.equal(byKey.get("nothing"), "null");
  assert.equal(byKey.get("nope"), "false");
  assert.equal(byKey.get("zero"), "0");
  assert.equal(byKey.get("code"), "'0123'");
  slicesExact(source, result.entries);
});

test("source entries support quoted colons, unicode, and numeric-looking keys", () => {
  const source = "---\n\"a: b\": 1\n'c: d': 2\ncafé: 3\n123: four\n---\n";
  const result = H.propertyEditorSourceEntries(source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map((entry) => entry.key), ["a: b", "c: d", "café", "123"]);
  assert.equal(result.entries[0].valueYaml, "1");
  slicesExact(source, result.entries);
});

test("source entries keep block scalars, nesting, and duplicates separate", () => {
  const source = "---\nnotes: |\n  line one\n\n  line two\nparent:\n  a: 1\n\n  b: 2\ntag: one\ntag: two\n---\n";
  const result = H.propertyEditorSourceEntries(source);
  assert.equal(result.ok, true);
  assert.equal(result.entries[0].valueYaml, "|\n  line one\n\n  line two\n");
  assert.equal(result.entries[0].raw, "notes: |\n  line one\n\n  line two\n");
  assert.equal(result.entries[1].valueYaml, "\n  a: 1\n\n  b: 2");
  assert.deepEqual(result.entries.slice(2).map((entry) => [entry.key, entry.occurrence]), [["tag", 1], ["tag", 2]]);
  assert.notEqual(result.entries[2].start, result.entries[3].start);
  slicesExact(source, result.entries);
});

test("source entries keep chomping indicators and flow roots", () => {
  const kept = "---\nnotes: |+\n  kept\n\n\nnext: 1\n---\n";
  const keptResult = H.propertyEditorSourceEntries(kept);
  assert.equal(keptResult.ok, true);
  assert.ok(keptResult.entries[0].valueYaml.startsWith("|+\n  kept"));
  const flow = H.propertyEditorSourceEntries("---\n{title: Hello, count: 5}\n---\n");
  assert.equal(flow.ok, true);
  assert.equal(flow.flow, true);
  assert.deepEqual(flow.entries.map((entry) => [entry.key, entry.valueYaml]), [["title", "Hello"], ["count", "5"]]);
  slicesExact("---\n{title: Hello, count: 5}\n---\n", flow.entries);
});

test("source entries mark anchors, aliases, merge keys, and tags unsupported", () => {
  const anchored = H.propertyEditorSourceEntries("---\na: &x 1\n---\n");
  assert.equal(anchored.entries[0].support, "unsupported");
  assert.equal(anchored.entries[0].refusal.code, "opaque-anchor");
  const aliased = H.propertyEditorSourceEntries("---\na: 1\nb: *x\n---\n");
  assert.deepEqual(aliased.entries.map((entry) => entry.support), ["ok", "unsupported"]);
  assert.equal(H.propertyEditorSourceEntries("---\n<<: merged\n---\n").code, "unsupported");
  assert.equal(H.propertyEditorSourceEntries("---\na: !custom v\n---\n").entries[0].support, "unsupported");
  const quoted = H.propertyEditorSourceEntries("---\na: \"*not-a-ref\"\nb: '# not a comment'\n---\n");
  assert.deepEqual(quoted.entries.map((entry) => entry.support), ["ok", "ok"]);
});

test("source entries reject missing, unclosed, and non-mapping frontmatter", () => {
  assert.equal(H.propertyEditorSourceEntries("no frontmatter\n").code, "no-frontmatter");
  assert.equal(H.propertyEditorSourceEntries("---\na: 1\n").code, "unclosed");
  assert.equal(H.propertyEditorSourceEntries("---\n- a\n- b\n---\n").code, "non-mapping");
});

test("source fragments validate keys through the injected parser", () => {
  const source = "---\ntitle: Hi\ncount: 3\n---\n";
  const validated = H.propertyEditorSourceFragments(source, stubParseYaml);
  assert.equal(validated.ok, true);
  assert.equal(validated.validated, true);
  const mismatch = H.propertyEditorSourceFragments(source, () => ({ other: 1 }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "ambiguous");
  const invalid = H.propertyEditorSourceFragments("---\ntitle: [unclosed\n---\n", () => { throw new Error("bad indent"); });
  assert.equal(invalid.code, "invalid-yaml");
  const duplicate = H.propertyEditorSourceFragments("---\na: 1\na: 2\n---\n", () => { throw new Error("dup"); });
  assert.equal(duplicate.code, "duplicate");
  const nonMapping = H.propertyEditorSourceFragments("---\na: 1\n---\n", () => [1, 2]);
  assert.equal(nonMapping.code, "non-mapping");
  const noParser = H.propertyEditorSourceFragments(source, null);
  assert.equal(noParser.code, "yaml-parser-unavailable");
});

test("clipboard decoder accepts one mapping, optionally wrapped", () => {
  const plain = H.propertyEditorClipboardDecode("title: Hi\ncount: 5\n", stubParseYaml);
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.entries.map((entry) => [entry.key, entry.valueYaml]), [["title", "Hi"], ["count", "5"]]);
  const wrapped = H.propertyEditorClipboardDecode("---\ntitle: Hi\n---\n", stubParseYaml);
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.wrapped, true);
});

test("clipboard decoder refuses fences, bodies, duplicates, and opaque input", () => {
  assert.equal(H.propertyEditorClipboardDecode("```yaml\ntitle: Hi\n```\n", stubParseYaml).code, "fence");
  assert.equal(H.propertyEditorClipboardDecode("---\ntitle: Hi\n---\nBody\n", stubParseYaml).code, "body");
  assert.equal(H.propertyEditorClipboardDecode("title: Hi\ntitle: Yo\n", stubParseYaml).code, "duplicate");
  assert.equal(H.propertyEditorClipboardDecode("---\ntitle: Hi\n...\n---\ntitle: Yo\n---\n", stubParseYaml).ok, false);
  assert.equal(H.propertyEditorClipboardDecode("- a\n- b\n", () => [1]).code, "non-mapping");
  assert.equal(H.propertyEditorClipboardDecode("a: 1\nb: *x\n", stubParseYaml).code, "opaque-alias");
  assert.equal(H.propertyEditorClipboardDecode("a: &x 1\n", stubParseYaml).code, "opaque-anchor");
});

test("source entries attach inter-entry comments to the following entry like prop.move", () => {
  const source = "---\nalpha: one\n# Comment for gamma\ngamma: three\n---\n";
  const result = H.propertyEditorSourceEntries(source);
  assert.equal(result.ok, true);
  assert.equal(result.entries[0].raw, "alpha: one\n");
  assert.equal(result.entries[1].raw, "# Comment for gamma\ngamma: three\n");
  assert.equal(result.entries[1].leading, "# Comment for gamma\n");
  assert.equal(result.entries[0].trivia, "");
  assert.equal(result.entries[1].trivia, "");
  slicesExact(source, result.entries);
  const assembled = H.propertyEditorSourceAssembleEntries([result.entries[1]], source, "\n");
  assert.equal(assembled.ok, true);
  assert.equal(assembled.yaml, "# Comment for gamma\ngamma: three");
  const both = H.propertyEditorSourceAssembleEntries(result.entries, source, "\n");
  assert.equal(both.ok, true);
  assert.equal(both.yaml, "alpha: one\n# Comment for gamma\ngamma: three");
});

test("source assembler keeps block bytes and rebuilds flow with braces", () => {
  const source = "---\ntitle: Hello\ncount: 5 # qty\n---\n";
  const entries = H.propertyEditorSourceEntries(source).entries;
  const assembled = H.propertyEditorSourceAssembleEntries(entries, source, "\n");
  assert.equal(assembled.ok, true);
  assert.equal(assembled.yaml, "title: Hello\ncount: 5 # qty");
  const flowSource = "---\n{title: Hello, count: 5}\n---\n";
  const flow = H.propertyEditorSourceEntries(flowSource).entries;
  const rebuilt = H.propertyEditorSourceAssembleEntries(flow, flowSource, "\n");
  assert.equal(rebuilt.yaml, "{title: Hello, count: 5}");
  const unsafe = H.propertyEditorSourceEntries("---\na: 1\nb: *x\n---\n").entries;
  assert.equal(H.propertyEditorSourceAssembleEntries([unsafe[1]], source, "\n").code, "unsupported");
  assert.equal(H.propertyEditorSourceAssembleEntries([], source, "\n").code, "empty");
});

test("snapshot reader validates path, inventory, unsaved panes, and cancel", async () => {
  const source = "---\ntitle: Hi\ncount: 3\n---\nBody\n";
  const report = {
    path: "notes/item.md", fingerprint: "fp1",
    properties: [{ key: "title", line: 2 }, { key: "count", line: 3 }],
  };
  const read = { path: "notes/item.md", report, readSource: async () => source, parseYaml: stubParseYaml };
  const snap = await H.propertyEditorReadSourceSnapshot(read);
  assert.equal(snap.ok, true);
  assert.equal(snap.entries.length, 2);
  assert.equal(snap.fingerprint, "fp1");
  assert.equal(snap.editorSnapshot, false);
  const stale = await H.propertyEditorReadSourceSnapshot({
    ...read, readSource: async () => "---\ntitle: Hi\n---\n",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale");
  const mismatch = await H.propertyEditorReadSourceSnapshot({ ...read, path: "other.md" });
  assert.equal(mismatch.code, "path-mismatch");
  const refused = await H.propertyEditorReadSourceSnapshot({ ...read, hasUnsaved: true });
  assert.equal(refused.code, "unsaved");
  const editor = await H.propertyEditorReadSourceSnapshot({
    ...read, hasUnsaved: true, getEditorContent: async () => source,
  });
  assert.equal(editor.ok, true);
  assert.equal(editor.editorSnapshot, true);
  const cancelled = await H.propertyEditorReadSourceSnapshot({ ...read, isCancelled: () => true });
  assert.equal(cancelled.code, "cancelled");
});
