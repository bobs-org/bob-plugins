// SM-W contract vectors and runtime source/interaction checks for ledger
// wake-history pills. The canonical fixture is copied byte-for-byte from
// bob-cli; these tests do not replace it with locally authored vectors.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class StubWidgetType {}
class TestPlugin { constructor(app) { this.app = app; } }
class TestNotice { constructor(message) { TestNotice.messages.push(String(message)); } }
TestNotice.messages = [];

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};
const editorInfoField = {};
const editorLivePreviewField = {};
const originalLoad = Module._load;
Module._load = function loadWithWokenPillStubs(request) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      MarkdownView: class {},
      Notice: TestNotice,
      Platform: { isMacOS: false, isMobile: false },
      Plugin: TestPlugin,
      editorInfoField,
      editorLivePreviewField,
      normalizePath: (value) => value,
      parseYaml: (value) => JSON.parse(value),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value }, StateEffect: StubStateEffect, RangeSetBuilder: class {} };
  }
  if (request === "@codemirror/view") {
    return { Decoration: {}, EditorView: {}, ViewPlugin: {}, WidgetType: StubWidgetType, keymap: { of: (value) => value } };
  }
  if (request === "@codemirror/language") return { syntaxTree: () => null };
  return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
};
const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
delete require.cache[MAIN_PATH];
const LedgerToolsPlugin = require(MAIN_PATH);
Module._load = originalLoad;

const { helpers } = LedgerToolsPlugin;
const {
  SNOOZE_WOKEN_SIDE,
  snoozeWokenPillModel,
  snoozeWokenLedgerLinks,
  buildSnoozeWokenElement,
  SnoozeWokenWidget,
} = helpers;

const CLI_DIR = process.env.BOB_CLI_DIR
  ? path.resolve(process.env.BOB_CLI_DIR)
  : path.resolve(__dirname, "../../../../..");
const CANONICAL_PATH = path.join(CLI_DIR, "tests", "fixtures", "snooze", "marks.json");
const PLUGIN_PATH = path.join(__dirname, "..", "plugins", "bob-ledger-tools", "scripts", "fixtures", "snooze", "marks.json");
const canonicalBytes = fs.readFileSync(CANONICAL_PATH);
const pluginBytes = fs.readFileSync(PLUGIN_PATH);
const fixture = JSON.parse(canonicalBytes.toString("utf8"));

test("plugin snooze display fixture is byte-identical to bob-cli canonical marks", () => {
  assert.ok(pluginBytes.equals(canonicalBytes));
});

test("all canonical SM-W vectors produce their exact pill, tooltip, and navigation", () => {
  const rows = fixture.groups.woken;
  assert.equal(rows.length, 18);
  const allIds = Object.values(fixture.groups).flat().map((row) => row.id);
  assert.equal(new Set(allIds).size, allIds.length, "all canonical SM vector IDs are unique");
  for (const row of rows) {
    assert.deepEqual(snoozeWokenPillModel(row.input), row.expected, row.id);
  }
});

test("woken path and block identity distinguish identical block IDs in different notes", () => {
  const input = structuredClone(fixture.groups.woken[0].input);
  input.link.route = "job.md";
  input.history.push({ route: "other.md", block: "email-dan", line: 11, woke_at: "15:59", target: "1530" });
  assert.deepEqual(snoozeWokenPillModel(input), fixture.groups.woken[0].expected);
  input.history = input.history.filter((row) => row.route === "other.md");
  assert.deepEqual(snoozeWokenPillModel(input), {
    pill: "none", text: null, tooltip: null, navigates_to: null,
  });
});

test("ledger source mapping accepts only unstruck direct links under open entries", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (1530-1600) — WRITE",
    "  - [[job#^plain]]",
    "  - [[job#^alias|named]]",
    "  - prose [[job#^mixed]]",
    "  - ![[job#^embed]]",
    "  - ~~[[job#^struck]]~~",
    "  - [ ] nested",
    "- [x] (1600-1630) — DONE",
    "  - [[job#^closed]]",
    "```md",
    "- [ ] fenced",
    "  - [[job#^fenced]]",
    "```",
    "## Snoozed",
    "- ~~**1530** [[job#^plain]]~~ · woke 15:32",
  ];
  assert.deepEqual(
    snoozeWokenLedgerLinks(lines, "2026/20261105.md").map((row) => ({ line: row.line, blockId: row.blockId, aliased: row.aliased })),
    [
      { line: 2, blockId: "plain", aliased: false },
      { line: 3, blockId: "alias", aliased: true },
    ],
  );
  assert.deepEqual(snoozeWokenLedgerLinks(lines, "notes/other.md"), []);
});

test("history navigation rescans exact resolved identity after line moves", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = {
    metadataCache: {
      getFirstLinkpathDest(target) {
        if (target === "job") return { path: "job.md", extension: "md" };
        if (target === "other") return { path: "other.md", extension: "md" };
        return null;
      },
    },
  };
  const content = [
    "## Pomodoros",
    "- [ ] (1530-1600) — WRITE",
    "  - [[job#^shared]]",
    "## Snoozed",
    "- ~~**1530** [[job#^shared]]~~ · woke 15:32",
    "- ~~**1530** [[other#^shared]]~~ · woke 15:59",
    "- ~~**1530** [[job#^shared]]~~ · woke 15:35",
  ].join("\n");
  assert.equal(plugin.snoozeWokenFindHistoryLine(content, "2026/20261105.md", "job.md", "shared"), 6);
  const reSnoozed = content.replace("## Snoozed\n", "## Snoozed\n- **1700** [[job#^shared]]\n");
  assert.equal(plugin.snoozeWokenFindHistoryLine(reSnoozed, "2026/20261105.md", "job.md", "shared"), null);
});

function fakeElement(tag) {
  return {
    tagName: tag,
    attrs: {},
    childNodes: [],
    listeners: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
}

test("woken host is copy-safe and the widget preserves plain caret placement while Mod-click jumps", () => {
  const model = fixture.groups.woken[0].expected;
  const doc = { createElement: (tag) => fakeElement(tag) };
  const host = buildSnoozeWokenElement(doc, model);
  assert.equal(host.getAttribute("role"), "img");
  assert.equal(host.getAttribute("aria-label"), model.tooltip);
  assert.equal(host.getAttribute("title"), null);
  assert.deepEqual(host.childNodes, []);
  assert.equal(SNOOZE_WOKEN_SIDE, -3);

  const originalDocument = global.document;
  global.document = doc;
  try {
    const jumps = [];
    const widget = new SnoozeWokenWidget(model, "2026/20261105.md", "job.md", "email-dan", (...args) => jumps.push(args));
    const view = { posAtDOM: () => 42, dispatch(value) { this.last = value; }, focus() { this.focused = true; } };
    const rendered = widget.toDOM(view);
    let prevented = false;
    rendered.listeners.mousedown({ button: 0, ctrlKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(view.last, { selection: { anchor: 42 } });
    assert.equal(view.focused, true);
    rendered.listeners.mousedown({ button: 0, ctrlKey: true, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
    assert.equal(jumps.length, 1);
    assert.deepEqual(jumps[0][0], model.navigates_to);
    assert.equal(jumps[0][1], "job.md");
    assert.equal(jumps[0][2], "email-dan");
  } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});
