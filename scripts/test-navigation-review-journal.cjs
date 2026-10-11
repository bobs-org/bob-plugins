const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
class TestPlugin {}
class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
}
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class MarkdownView {},
      Modal: class Modal {},
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { buildReviewAnswerEvents, reviewJournalOutcome } = NavigationHotkeysPlugin.helpers;
Module._load = originalLoad;

const origin = {
  day: "2026-10-11",
  key: "notes/a.md#^a",
  rowKey: "notes/a.md#^a",
  tier: "next",
};

test("review answer outcome vectors map to the schema vocabulary", () => {
  const vectors = [
    ["complete", "done"],
    ["lane", "lane"],
    ["route", "route"],
    ["link-today", "today"],
    ["card", "card"],
    ["keep", "keep"],
    ["decay:notNow", "decay:notNow"],
    ["decay:level:0", "decay:level:0"],
    ["decay:lessOften", "decay:lessOften"],
    ["decay:reword", "decay:reword"],
    ["decay:drop", "decay:drop"],
    ["decay:keep", "decay:keep"],
    ["checklist", "checklist"],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(reviewJournalOutcome(input), expected, input);
  }
  for (const input of ["skip", "move", "refusal", "decay:unknown"]) {
    assert.equal(reviewJournalOutcome(input), null, input);
  }
});

test("event builder uses the walk row key and its tier, once per distinct key", () => {
  const queueBefore = [
    { key: "notes/a.md#^a", path: "notes/a.md", tier: "next" },
    { key: "notes/b.md#^b", path: "notes/b.md", tier: "pending" },
  ];
  const events = buildReviewAnswerEvents(
    { ...origin, queueBefore },
    "route",
    [
      { key: "notes/a.md#^a" },
      { key: "notes/b.md#^b" },
      { key: "notes/b.md#^b" },
    ],
  );
  assert.deepEqual(events, [
    { day: origin.day, tier: "next", outcome: "route", key: "notes/a.md#^a" },
    { day: origin.day, tier: "pending", outcome: "route", key: "notes/b.md#^b" },
  ]);
  assert.deepEqual(
    buildReviewAnswerEvents(
      { ...origin, tier: "pre" },
      "checklist",
      [{ ...origin, tier: "pre" }],
    ),
    [{ day: origin.day, tier: "pre", outcome: "checklist", key: origin.key }],
  );
  assert.deepEqual(buildReviewAnswerEvents(origin, "move", [origin]), []);
});

test("journal appends are queued and failures retain events without failing answers", async () => {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const appended = [];
  plugin.reviewJournalPending = [];
  plugin.reviewJournalDraining = false;
  plugin.reviewJournalRetryTimer = null;
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            stats: {
              append: async (event) => {
                appended.push(event);
              },
            },
          },
        },
      },
    },
  };
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  plugin.recordReviewAnswer(origin, "done", [{ key: "notes/b.md#^b", tier: "next" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(appended.map((event) => event.outcome), ["keep", "done"]);
  assert.equal(plugin.reviewJournalPending.length, 0);

  plugin.app.plugins.plugins["bob-ledger-tools"].api.stats.append = async () => {
    throw new Error("disk full");
  };
  notices.length = 0;
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(plugin.reviewJournalPending.length, 1);
  assert.deepEqual(notices, ["Review answer not recorded"]);
  clearTimeout(plugin.reviewJournalRetryTimer);
  plugin.reviewJournalRetryTimer = null;
});
