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
const {
  buildReviewAnswerEvents,
  reviewCardJournalOutcome,
  reviewJournalOutcome,
} = NavigationHotkeysPlugin.helpers;
Module._load = originalLoad;

const origin = {
  day: "2026-10-11",
  key: "notes/a.md#^a",
  rowKey: "notes/a.md#^a",
  tier: "next",
};

function makeJournalPlugin(append) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.reviewJournalPending = [];
  plugin.reviewJournalDraining = false;
  plugin.reviewJournalRetryTimer = null;
  plugin.reviewJournalBurst = false;
  plugin.reviewJournalMissingApiNoticed = false;
  plugin.reviewJournalDropped = 0;
  plugin.reviewJournalDropWarned = false;
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            stats: {
              version: 2,
              append,
            },
          },
        },
      },
    },
  };
  return plugin;
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

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
  const appended = [];
  const plugin = makeJournalPlugin(async (event) => {
    appended.push(event);
  });
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  plugin.recordReviewAnswer(origin, "done", [{ key: "notes/b.md#^b", tier: "next" }]);
  await flushMicrotasks();
  assert.deepEqual(appended.map((event) => event.outcome), ["keep", "done"]);
  assert.equal(plugin.reviewJournalPending.length, 0);

  plugin.app.plugins.plugins["bob-ledger-tools"].api.stats.append = async () => {
    throw new Error("disk full");
  };
  notices.length = 0;
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  await flushMicrotasks();
  assert.equal(plugin.reviewJournalPending.length, 1);
  assert.deepEqual(notices, ["Review answer not recorded — will retry"]);
  clearTimeout(plugin.reviewJournalRetryTimer);
  plugin.reviewJournalRetryTimer = null;
});

// Copied from tests/fixtures/stats/review_answers.json R20–R24 plus the
// scheduled-but-not-past-today card stay.
test("card after-line outcomes map done, drop, defer, sequence, and card", () => {
  const day = origin.day;
  const cases = [
    {
      id: "R20-card-done",
      before: "- [ ] #task Task",
      after: "- [x] #task Task",
      outcome: "done",
    },
    {
      id: "R20-card-done-X",
      before: "- [ ] #task Task",
      after: "- [X] #task Task",
      outcome: "done",
    },
    {
      id: "R21-card-drop",
      before: "- [ ] #task Task",
      after: "- [-] #task Task",
      outcome: "drop",
    },
    {
      id: "R22-card-defer",
      before: "- [ ] #task Task [scheduled:: 2026-10-11]",
      after: "- [ ] #task Task [scheduled:: 2026-10-18]",
      outcome: "defer",
    },
    {
      id: "R23-card-sequence",
      before: "- [ ] #task Task",
      after: "- [ ] #task Task [dependsOn:: abc]",
      outcome: "sequence",
    },
    {
      id: "R24-card-plain",
      before: "- [ ] #task Task",
      after: "- [ ] #task Task [fresh:: 2026-10-11]",
      outcome: "card",
    },
    {
      id: "scheduled-same-day",
      before: "- [ ] #task Task",
      after: "- [ ] #task Task [scheduled:: 2026-10-11]",
      outcome: "card",
    },
    {
      id: "scheduled-unchanged-future",
      before: "- [ ] #task Task [scheduled:: 2026-10-18]",
      after: "- [ ] #task Task [scheduled:: 2026-10-18]",
      outcome: "card",
    },
  ];
  for (const vector of cases) {
    assert.equal(
      reviewCardJournalOutcome(vector.before, vector.after, day),
      vector.outcome,
      vector.id,
    );
    assert.equal(
      reviewJournalOutcome(
        { kind: "card", beforeLine: vector.before, afterLine: vector.after },
        day,
      ),
      vector.outcome,
      `${vector.id} via continue input`,
    );
    assert.equal(
      buildReviewAnswerEvents(
        origin,
        { kind: "card", beforeLine: vector.before, afterLine: vector.after },
        [origin],
      )[0].outcome,
      vector.outcome,
      `${vector.id} event`,
    );
  }
  assert.equal(
    reviewJournalOutcome(
      {
        kind: "card",
        journalOutcome: "keep",
        beforeLine: "- [ ] #task Task",
        afterLine: "- [x] #task Task",
      },
      day,
    ),
    "keep",
  );
});

test("journal events carry plugin@manifest version with a 2.x fallback", async () => {
  const appended = [];
  const plugin = makeJournalPlugin(async (event) => {
    appended.push(event);
  });
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  await flushMicrotasks();
  assert.equal(appended[0].plugin, "bob-navigation-hotkeys@2.x");

  appended.length = 0;
  plugin.manifest = { version: "2.19.0" };
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  await flushMicrotasks();
  assert.equal(appended[0].plugin, "bob-navigation-hotkeys@2.19.0");
});

test("write failures show one notice per burst and a recovery notice", async () => {
  const appended = [];
  const plugin = makeJournalPlugin(async () => {
    throw new Error("disk full");
  });
  notices.length = 0;
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  plugin.recordReviewAnswer(origin, "done", [{ key: "notes/b.md#^b", tier: "next" }]);
  await flushMicrotasks();
  assert.deepEqual(notices, ["Review answer not recorded — will retry"]);
  assert.equal(plugin.reviewJournalPending.length, 2);
  clearTimeout(plugin.reviewJournalRetryTimer);
  plugin.reviewJournalRetryTimer = null;

  plugin.app.plugins.plugins["bob-ledger-tools"].api.stats.append = async (event) => {
    appended.push(event);
  };
  plugin.flushReviewJournal();
  await flushMicrotasks();
  assert.equal(plugin.reviewJournalPending.length, 0);
  assert.equal(appended.length, 2);
  assert.deepEqual(notices, [
    "Review answer not recorded — will retry",
    "Review journal recovered: 2 answers written",
  ]);
});

test("missing api.stats shows one session notice and later delivers retained events", async () => {
  const appended = [];
  const plugin = makeJournalPlugin(async (event) => {
    appended.push(event);
  });
  plugin.app.plugins.plugins = {};
  notices.length = 0;
  plugin.recordReviewAnswer(origin, "keep", [origin]);
  plugin.recordReviewAnswer(origin, "lane", [origin]);
  await flushMicrotasks();
  assert.deepEqual(notices, ["Update Bob Ledger Tools to record review stats"]);
  assert.equal(plugin.reviewJournalPending.length, 2);
  clearTimeout(plugin.reviewJournalRetryTimer);
  plugin.reviewJournalRetryTimer = null;

  plugin.app.plugins.plugins = {
    "bob-ledger-tools": {
      api: {
        stats: {
          version: 2,
          append: async (event) => {
            appended.push(event);
          },
        },
      },
    },
  };
  plugin.flushReviewJournal();
  await flushMicrotasks();
  assert.equal(plugin.reviewJournalPending.length, 0);
  assert.deepEqual(appended.map((event) => event.outcome), ["keep", "lane"]);
  assert.deepEqual(notices, ["Update Bob Ledger Tools to record review stats"]);
});

test("validation rejects drop the event and continue the drain", async () => {
  const appended = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
  };
  const plugin = makeJournalPlugin(async (event) => {
    await Promise.resolve();
    if (event.key === "notes/bad.md#^b") {
      const error = new TypeError("Review journal event has an invalid tier, key, or outcome");
      error.code = "invalid_review_event";
      throw error;
    }
    appended.push(event);
  });
  notices.length = 0;
  try {
    plugin.recordReviewAnswer(origin, "keep", [{ key: "notes/bad.md#^b", tier: "next" }]);
    plugin.recordReviewAnswer(origin, "done", [{ key: "notes/ok.md#^c", tier: "next" }]);
    await flushMicrotasks();
    assert.equal(plugin.reviewJournalPending.length, 0);
    assert.deepEqual(appended.map((event) => event.key), ["notes/ok.md#^c"]);
    assert.equal(notices.length, 0);
    assert.equal(
      warnings.some((line) => line.includes("Review journal dropped invalid event")),
      true,
    );
  } finally {
    console.warn = originalWarn;
    clearTimeout(plugin.reviewJournalRetryTimer);
    plugin.reviewJournalRetryTimer = null;
  }
});

test("pending journal events cap at 500 and warn once per burst", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
  };
  const plugin = makeJournalPlugin(() => new Promise(() => {}));
  notices.length = 0;
  try {
    for (let index = 0; index < 501; index += 1) {
      const key = `notes/a.md#^${index}`;
      plugin.recordReviewAnswer({ ...origin, key, rowKey: key }, "keep", [{ key, tier: "next" }]);
    }
    assert.equal(plugin.reviewJournalPending.length, 500);
    assert.equal(plugin.reviewJournalDropped, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /dropped 1 oldest pending answers \(cap 500\)/);
    plugin.recordReviewAnswer(
      { ...origin, key: "notes/a.md#^extra", rowKey: "notes/a.md#^extra" },
      "keep",
      [{ key: "notes/a.md#^extra", tier: "next" }],
    );
    assert.equal(plugin.reviewJournalPending.length, 500);
    assert.equal(plugin.reviewJournalDropped, 2);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
    clearTimeout(plugin.reviewJournalRetryTimer);
    plugin.reviewJournalRetryTimer = null;
  }
});
