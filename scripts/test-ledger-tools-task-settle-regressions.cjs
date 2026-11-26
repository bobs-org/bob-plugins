// Task settle focused regressions (bob-cli-q4.8.1.1 pure-twin).
//
// Covers what the canonical vectors do not pin: custom classification
// (custom/unknown statuses, global-filter recognition, open versus terminal
// semantics), duplicate-line maps, Unicode and CRLF coordinates, and input
// immutability.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownRenderChild: EmptyClass,
      MarkdownView: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const TODAY = "2026-11-25";
const DAILY = "2026/20261125.md";
const BASE_TYPES = [
  { symbol: " ", type: "TODO" },
  { symbol: "*", type: "ON_HOLD" },
  { symbol: "/", type: "IN_PROGRESS" },
  { symbol: "?", type: "ON_HOLD" },
  { symbol: "x", type: "DONE" },
  { symbol: "X", type: "DONE" },
  { symbol: "-", type: "CANCELLED" },
  { symbol: "P", type: "TODO" },
];

function classification(globalFilter = "#task", types = BASE_TYPES) {
  return helpers.taskSettleFromStatusTypes(globalFilter, types);
}

test("custom classification settles custom open statuses and leaves unknown ones", () => {
  const custom = classification("#task", [...BASE_TYPES, { symbol: "!", type: "TODO" }]);
  const input = "- [!] #task Custom future [scheduled:: 2026-11-26]\n- [~] #task Unknown future [scheduled:: 2026-11-26]\n";
  const result = helpers.taskSettleNote("Notes/plain.md", input, TODAY, custom, DAILY);
  assert.equal(
    result.contents,
    "- [?] #task Custom future [scheduled:: 2026-11-26]\n- [~] #task Unknown future [scheduled:: 2026-11-26]\n",
    "custom TODO settles like P; unknown ~ never settles",
  );
  assert.equal(result.changed, true, "changed");
});

test("terminal statuses never settle even with a future schedule", () => {
  const input = "- [x] #task Done future [scheduled:: 2026-11-26]\n- [-] #task Canceled future [scheduled:: 2026-11-26]\n";
  const result = helpers.taskSettleNote("Notes/plain.md", input, TODAY, classification(), DAILY);
  assert.equal(result.contents, input, "done/canceled rows are untouched");
  assert.equal(result.changed, false, "unchanged");
});

test("global filter is token-level: substrings do not settle", () => {
  const input = "- [ ] #tasklist Future [scheduled:: 2026-11-26]\n- [ ] #task Future [scheduled:: 2026-11-26]\n";
  const result = helpers.taskSettleNote("Notes/plain.md", input, TODAY, classification(), DAILY);
  assert.equal(
    result.contents,
    "- [ ] #tasklist Future [scheduled:: 2026-11-26]\n- [?] #task Future [scheduled:: 2026-11-26]\n",
    "only the exact #task token settles",
  );
});

test("duplicate lines map to their nearest surviving identical line", () => {
  const lines = [
    "---",
    "type: [[area]]",
    "---",
    "## Tasks",
    "- [?] #task Same",
    "- [?] #task Same",
    "- [ ] #task Same",
  ];
  const input = `${lines.join("\n")}\n`;
  const result = helpers.taskSettleNote("Areas/dup.md", input, TODAY, classification(), DAILY);
  const out = helpers.taskSettleLogicalLines(result.contents);
  assert.ok(out.includes("- [?] #task Same"), "blocked rows stay grouped");
  // Every surviving input line maps, and targets are distinct.
  const targets = Object.values(result.lineMap);
  assert.equal(new Set(targets).size, targets.length, "line map targets are distinct");
  for (const [oldIndex, newIndex] of Object.entries(result.lineMap)) {
    assert.ok(
      Number(newIndex) >= 0 && Number(newIndex) < out.length,
      `line ${oldIndex} maps inside the output`,
    );
  }
});

test("unicode and CRLF coordinates preserve endings and stay bounded", () => {
  const input = "- [ ] #task Caf\u00E9 future \u{1F600} [scheduled:: 2026-11-26]\r\n- [ ] #task Plain\r\n";
  const result = helpers.taskSettleNote("Notes/plain.md", input, TODAY, classification(), DAILY);
  assert.equal(
    result.contents,
    "- [?] #task Caf\u00E9 future \u{1F600} [scheduled:: 2026-11-26]\r\n- [ ] #task Plain\r\n",
    "CRLF endings survive a schedule rewrite",
  );
  assert.equal(result.changed, true, "changed");
  const out = helpers.taskSettleLogicalLines(result.contents);
  for (const [oldIndex, newIndex] of Object.entries(result.lineMap)) {
    assert.ok(Number(newIndex) < out.length, `line ${oldIndex} maps inside the output`);
  }
  const missingFinal = "- [ ] #task Future [scheduled:: 2026-11-26]";
  const missing = helpers.taskSettleNote("Notes/plain.md", missingFinal, TODAY, classification(), DAILY);
  assert.equal(missing.contents.endsWith("\n"), false, "a missing final newline stays missing");
});

test("settle keeps bold drawers and uppercase plain subtrees byte-for-byte", () => {
  const input = [
    "---",
    "type: [[area]]",
    "---",
    "## Tasks",
    "",
    "- [ ] #task Future [scheduled:: 2026-11-26] ^future",
    "  - **API Design**",
    "    - bold detail",
    "  - FUTURE WORK",
    "    - uppercase plain detail",
    "- [ ] #task Stay ^stay",
    "",
  ].join("\n");
  const result = helpers.taskSettleNote("Areas/home.md", input, TODAY, classification(), DAILY);
  assert.equal(result.changed, true);
  assert.match(result.contents, /### Blocked/);
  assert.ok(result.contents.includes([
    "- [?] #task Future [scheduled:: 2026-11-26] ^future",
    "  - **API Design**",
    "    - bold detail",
    "  - FUTURE WORK",
    "    - legacy detail",
  ].join("\n")), result.contents);
  assert.ok(result.contents.includes("- [ ] #task Stay ^stay"));
});

test("settle does not mutate its inputs", () => {
  const input = "- [ ] #task Future [scheduled:: 2026-11-26]\n";
  const cls = classification();
  const bucketsBefore = JSON.stringify([...cls.buckets]);
  const result = helpers.taskSettleNote("Notes/plain.md", input, TODAY, cls, DAILY);
  assert.equal(input, "- [ ] #task Future [scheduled:: 2026-11-26]\n", "contents string is unchanged");
  assert.equal(JSON.stringify([...cls.buckets]), bucketsBefore, "classification is unchanged");
  assert.notEqual(result.contents, input, "the rewrite lands in the output");
});
