const assert = require("node:assert/strict");
const Module = require("node:module");
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
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect: { define: () => ({ of: (value) => value }) }, StateField: { define: () => ({}) }, RangeSetBuilder: class {} };
  if (request === "@codemirror/view") return { EditorView: {}, keymap: { of: (value) => value }, ViewPlugin: { fromClass: (value) => value }, Decoration: {}, WidgetType: class {} };
  if (request === "@codemirror/language") return { syntaxTree: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { propertyCardInventory: inventory, propertyCardInventoryTypedValue: typedValue, propertyCardScanFrontmatter: scan } = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

function permissiveYaml(yaml) {
  if (/^(?:bad|x):\s*\[/m.test(yaml)) throw new Error("unexpected end of flow sequence");
  return {};
}

function duplicateRejectingYaml(yaml) {
  if (/^(?:bad|x):\s*\[/m.test(yaml)) throw new Error("unexpected end of flow sequence");
  const keys = new Set();
  for (const line of yaml.split(/\r?\n/)) {
    if (!line || /^\s/.test(line) || /^\s*#/.test(line)) continue;
    const match = /^(?:"((?:\\.|[^"])*)"|'((?:''|[^'])*)'|([^:#][^:]*)):\s/.exec(line);
    if (!match) continue;
    const key = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2].replace(/''/g, "'") : match[3].trim();
    if (keys.has(key)) throw new Error(`duplicated mapping key: ${key}`);
    keys.add(key);
  }
  return {};
}

test("source order, quoted keys, CRLF, BOM, nested maps, flow values, and block scalars", () => {
  const source = "\uFEFF---\r\n10: ten\r\n2: two\r\n\"quoted:key\": yes\r\n'it''s': ok\r\nnested:\r\n  4: child\r\nflow: { inner: value, count: 3 }\r\nmultiline: |\r\n  fake: nested content\r\nlast: end # a comment\r\n---\r\nbody";
  const result = inventory({ sourceText: source, frontmatter: {
    10: "ten", 2: "two", "quoted:key": true, "it's": "ok", nested: { 4: "child" },
    flow: { inner: "value", count: 3 }, multiline: "fake: nested content\n", last: "end",
  }, parseYaml: permissiveYaml });
  assert.equal(result.state, "ready");
  assert.deepEqual(result.rows.map((row) => row.key), ["10", "2", "quoted:key", "it's", "nested", "flow", "multiline", "last"]);
  assert.deepEqual(result.rows.map((row) => row.line), [2, 3, 4, 5, 6, 8, 9, 11]);
  assert.equal(result.rows.find((row) => row.key === "nested").valueState, "map");
  assert.equal(result.rows.find((row) => row.key === "last").sourceScalar, "end");
  assert.equal(result.count, 8);
});

test("duplicates retain both stable occurrences and report shared cache values", () => {
  const source = "---\nname: first\nname: second\n---";
  let calls = 0;
  const result = inventory({ sourceText: source, frontmatter: { name: "second" }, parseYaml: (yaml) => { calls += 1; return duplicateRejectingYaml(yaml); } });
  assert.equal(result.state, "ready");
  assert.equal(calls, 2, "a duplicate-only parser refusal is rechecked after renaming the later occurrence");
  assert.deepEqual(result.issues, [{ kind: "duplicate", key: "name", lines: [2, 3] }]);
  assert.deepEqual(result.rows.map((row) => [row.id, row.line, row.duplicate, row.valueSource, row.duplicateValuesIndependent]), [
    ["property:name:1", 2, true, "shared-cache", false],
    ["property:name:2", 3, true, "shared-cache", false],
  ]);
});

test("managed grouping follows source order and explicit where marks win", () => {
  const source = "---\nsummary_drafted: true\nzorg_source: abc\nfoo_digest: xyz\nloose: keep\ngenerated_from_zorg: true\n---";
  const result = inventory({
    sourceText: source,
    frontmatter: { summary_drafted: true, zorg_source: "abc", foo_digest: "xyz", loose: "keep", generated_from_zorg: true },
    where: { summary_drafted: "agent" },
    legacy: { loose: true },
    parseYaml: permissiveYaml,
  });
  assert.deepEqual(result.rows.map((row) => [row.key, row.group]), [
    ["summary_drafted", "card"], ["zorg_source", "managed"], ["foo_digest", "managed"],
    ["loose", "loose"], ["generated_from_zorg", "managed"],
  ]);
  assert.deepEqual(result.groups.map((group) => group.id), ["loose", "card", "managed"]);
  assert.equal(result.groups[1].rows[0].mark, "agent");
  assert.equal(result.groups[0].rows[0].legacy, "legacy");
  assert.equal(result.groups[2].label, "Managed · 3");
  assert.equal(result.groups[2].initiallyFolded, true);
});

test("adapter managed keys fold ordinary leftovers without a global reclassification", () => {
  const source = "---\ndone_tasks: \"[[done/x]]\"\ntemplate: area\nscheduled: 2026-12-02\ntask_count: 4\nopen_task_count: 2\nsummary: keep\n---";
  const result = inventory({
    sourceText: source,
    frontmatter: { done_tasks: "[[done/x]]", template: "area", scheduled: "2026-12-02", task_count: 4, open_task_count: 2, summary: "keep" },
    managed: { done_tasks: true, template: true, scheduled: true, task_count: true, open_task_count: true },
    parseYaml: permissiveYaml,
  });
  assert.deepEqual(result.rows.map((row) => [row.key, row.group]), [
    ["done_tasks", "managed"], ["template", "managed"], ["scheduled", "managed"],
    ["task_count", "managed"], ["open_task_count", "managed"], ["summary", "loose"],
  ]);
  const leftover = inventory({
    sourceText: "---\ntask_count: 4\nsummary: keep\n---",
    frontmatter: { task_count: 4, summary: "keep" },
    parseYaml: permissiveYaml,
  });
  assert.deepEqual(leftover.rows.map((row) => [row.key, row.group]), [
    ["task_count", "loose"], ["summary", "loose"],
  ]);
});

test("typed values keep absent, null, empty, false, and zero distinct", () => {
  const source = "---\nabsent: value\nnull_value: null\nempty_string: \"\"\nempty_list: []\nfalse_value: false\nzero_value: 0\n---";
  const result = inventory({ sourceText: source, frontmatter: {
    null_value: null, empty_string: "", empty_list: [], false_value: false, zero_value: 0,
  }, parseYaml: permissiveYaml });
  assert.equal(result.state, "pending", "a source key missing from the cache is not a confirmed empty value");
  assert.deepEqual(result.rows.map((row) => [row.key, row.valueState]), [
    ["absent", "pending"], ["null_value", "null"], ["empty_string", "empty-string"],
    ["empty_list", "empty-list"], ["false_value", "false"], ["zero_value", "zero"],
  ]);
  assert.equal(typedValue(false, undefined), "absent");
});

test("cache bookkeeping is excluded and absent source falls back to cache order as pending", () => {
  const pending = inventory({ frontmatter: { 10: "ten", 2: "two", position: { start: 1, end: 4 }, title: "x" } });
  assert.equal(pending.state, "pending");
  assert.deepEqual(pending.rows.map((row) => row.key), ["2", "10", "title"]);
  assert.ok(pending.rows.every((row) => row.line === null));
  assert.equal(inventory({ path: "a.md", sourceText: "---\nx: source\n---", sourcePath: "b.md", frontmatter: { x: "stale" }, parseYaml: permissiveYaml }).rows.length, 0);
  const mismatchedCache = inventory({ path: "a.md", sourcePath: "a.md", cachePath: "b.md", sourceText: "---\nx: source\n---", frontmatter: { x: "stale" }, parseYaml: permissiveYaml });
  assert.equal(mismatchedCache.state, "pending");
  assert.equal(mismatchedCache.rows[0].valueState, "pending");
  assert.equal(mismatchedCache.rows[0].value, undefined);
});

test("malformed and unclosed frontmatter recover without value rows", () => {
  const malformed = inventory({ sourceText: "---\nx: [\n---", frontmatter: { x: "stale" }, parseYaml: permissiveYaml });
  assert.equal(malformed.state, "invalid");
  assert.equal(malformed.rows.length, 0);
  assert.equal(malformed.recovery, "Frontmatter doesn't parse — y opens YAML");
  const duplicateAndMalformed = inventory({
    sourceText: "---\nx: 1\nx: 2\nbad: [\n---", frontmatter: { x: 2 }, parseYaml: duplicateRejectingYaml,
  });
  assert.equal(duplicateAndMalformed.state, "invalid");
  assert.equal(duplicateAndMalformed.rows.length, 0);
  assert.ok(duplicateAndMalformed.issues.some((issue) => issue.kind === "duplicate"));
  assert.ok(duplicateAndMalformed.issues.some((issue) => issue.kind === "parse-failure"));
  const unclosed = inventory({ sourceText: "---\nx: value", frontmatter: { x: "stale" }, parseYaml: permissiveYaml });
  assert.equal(unclosed.state, "unclosed");
  assert.equal(unclosed.rows.length, 0);
  assert.equal(unclosed.recovery, "Frontmatter doesn't parse — y opens YAML");
});

test("scanner ignores YAML nested structure and detects source lines", () => {
  const found = scan("---\n# comment\nparent:\n  child: nested\nflow: { nested: value }\nblock: >\n  content: text\nnext: ok\n---");
  assert.deepEqual(found.entries.map((entry) => [entry.key, entry.line]), [["parent", 3], ["flow", 5], ["block", 6], ["next", 8]]);
});
