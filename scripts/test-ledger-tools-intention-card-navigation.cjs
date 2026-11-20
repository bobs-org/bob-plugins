// Intention card navigation: in-place parent/sibling travel, missing-note
// states, yesterday entry points, YAML excursion lines, and entrypoint
// priority. Pure helpers stay pinned to their target; browse navigation
// never discards an active stage.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
      Plugin: TestPlugin, normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const H = LedgerToolsPlugin.helpers;
Module._load = originalLoad;

test("navigation keys travel in browse mode and never discard a stage", () => {
  const browse = (key, extra = {}) => H.intentionCardNavKeyAction(
    { key, ctrlKey: false, metaKey: false, altKey: false, ...extra },
    { stage: null, inInput: false },
  );
  assert.equal(browse("["), "navigate-prev");
  assert.equal(browse("]"), "navigate-next");
  assert.equal(browse("="), "navigate-parent");
  assert.equal(browse("y"), "yaml-excursion");
  assert.equal(browse("Y"), null);
  assert.equal(browse("q"), null);
  // Active stages keep their keys as text.
  assert.equal(H.intentionCardNavKeyAction(
    { key: "[", ctrlKey: false, metaKey: false, altKey: false },
    { stage: { kind: "intention" }, inInput: false },
  ), null);
  assert.equal(H.intentionCardNavKeyAction(
    { key: "=", ctrlKey: false, metaKey: false, altKey: false },
    { stage: null, inInput: true },
  ), null);
  assert.equal(H.intentionCardNavKeyAction(
    { key: "[", ctrlKey: true, metaKey: false, altKey: false },
    { stage: null, inInput: false },
  ), null);
});

test("parent and sibling subjects follow the hierarchy with W53 intact", () => {
  const today = "2026-11-19";
  const thursday = H.intentionCardSubjectForPath("2026/20261119.md", today);
  assert.equal(H.intentionCardParentSubject(thursday).id, "2026-W47");
  assert.equal(H.intentionCardSiblingSubject(thursday, -1).start, "2026-11-18");
  assert.equal(H.intentionCardSiblingSubject(thursday, 1).start, "2026-11-20");
  const week = H.intentionCardSubjectForPath("2026/2026-W47.md", today);
  assert.equal(H.intentionCardParentSubject(week).id, "2026-Q4");
  assert.equal(H.intentionCardSiblingSubject(week, 1).id, "2026-W48");
  const quarter = H.intentionCardSubjectForPath("2026/2026-Q4.md", today);
  assert.equal(H.intentionCardParentSubject(quarter).id, "2026");
  const year = H.intentionCardSubjectForPath("2026.md", today);
  assert.equal(H.intentionCardParentSubject(year), null);
  assert.equal(H.intentionCardSiblingSubject(year, 1).id, "2027");
  const w53 = H.intentionCardSubjectForPath("2026/2026-W53.md", today);
  assert.equal(w53.parent.id, "2026-Q4");
  assert.equal(H.intentionCardSiblingSubject(w53, 1).id, "2027-W01");
  assert.equal(H.intentionCardSiblingSubject(thursday, 0), null);
});

test("missing-note copy names the day and points periods at ensure", () => {
  const today = "2026-11-19";
  const friday = H.intentionCardSubjectForPath("2026/20261120.md", today);
  assert.equal(H.intentionCardMissingMessage(friday), "no note for Fri Nov 20 yet");
  const week = H.intentionCardSubjectForPath("2026/2026-W48.md", today);
  assert.match(H.intentionCardMissingMessage(week), /bob periods ensure/);
  assert.match(H.intentionCardMissingHint(week), /bob periods ensure/);
});

test("yesterday uses calendar arithmetic, never milliseconds or UTC parsing", () => {
  const localNoon = new Date(2026, 10, 19, 12, 0, 0);
  const yesterday = H.intentionCardYesterdayDate(localNoon);
  assert.equal(yesterday.getFullYear(), 2026);
  assert.equal(yesterday.getMonth(), 10);
  assert.equal(yesterday.getDate(), 18);
  // Month boundary: Dec 1 steps back to Nov 30 by calendar, not 24h math.
  const dec1 = new Date(2026, 11, 1, 12, 0, 0);
  const nov30 = H.intentionCardYesterdayDate(dec1);
  assert.equal(nov30.getMonth(), 10);
  assert.equal(nov30.getDate(), 30);
  assert.equal(H.intentionCardYesterdayId("2026-11-19"), "2026-11-18");
  assert.equal(H.intentionCardYesterdayId("2026-03-01"), "2026-02-28");
});

test("YAML excursion focuses the owned-field line", () => {
  const source = [
    "---", "intentions:", "  - one", "summary: hello", "reflection: |", "  words",
    "---", "", "# Thu Nov 19, 2026",
  ].join("\n");
  assert.equal(H.intentionCardYamlLineForField(source, "intention:0"), 2);
  assert.equal(H.intentionCardYamlLineForField(source, "summary"), 4);
  assert.equal(H.intentionCardYamlLineForField(source, "reflection"), 5);
  assert.equal(H.intentionCardYamlLineForField(source, ""), 1);
});

test("registry still opens every canonical subject, including empty ones", () => {
  const today = "2026-11-19";
  for (const path of ["2026/20261119.md", "2026/2026-W47.md", "2026/2026-Q4.md", "2026.md"]) {
    assert.ok(H.intentionCardSubjectForPath(path, today), path);
  }
  assert.equal(H.intentionCardSubjectForPath("all_time.md", today), null);
});
