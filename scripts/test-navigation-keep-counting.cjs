// Tests for the nav-counting phase (bob-cli-3v.3): exact explicit-keep
// counting in bob-navigation-hotkeys. Single, counted, and Task Link
// refreshes resolve exactly against the pre-write queue and stamp through
// the sole increment helper `api.freshness.keepLine`; every other explicit
// keep stamps uncounted and preserves the streak. No card interception
// exists yet: counting ships while the decision card does not.
// `docs/freshness.md` §2a is authoritative for eligibility.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
    return ref;
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

const notices = [];
class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
}
function clearNotices() {
  notices.length = 0;
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
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
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return {
      EditorView: TestEditorView,
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: ledgerHelpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const DATE = "2026-10-08";
const realKeep = (line, dateText, options) =>
  ledgerHelpers.freshnessKeepLine(line, dateText || DATE, options).line;
const realStamp = (line, dateText) =>
  ledgerHelpers.freshnessStampLine(line, dateText || DATE).line;

function rottenEntry(overrides = {}) {
  return {
    key: "a.md:3",
    path: "a.md",
    line: 3,
    lineNumber: 2,
    text: "Buy milk",
    originalMarkdown:
      "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 2]",
    blockId: null,
    state: "rotten",
    bucket: "rotten",
    tier: "rotten",
    tierLabel: "ROTTEN",
    lane: "ready",
    fresh: "2026-09-30",
    dueOn: "2026-10-07",
    daysOverdue: 1,
    interval: 7,
    keeps: 2,
    decide: false,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
    ...overrides,
  };
}

// --- strict eligibility -------------------------------------------------

test("exact eligibility authorizes one due-Ready ROTTEN row", () => {
  const queue = [rottenEntry()];
  const verdict = helpers.matchFreshStampExactEntry(queue, {
    path: "a.md",
    line: 2,
    raw: "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 2]",
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, "ok");
  assert.equal(verdict.entry.keeps, 2);
});

test("exact eligibility authorizes a RETURNED row", () => {
  const queue = [
    rottenEntry({
      key: "b.md:4",
      path: "b.md",
      line: 4,
      originalMarkdown: "- [ ] #task Came back [fresh:: 2026-09-20]",
      state: "resurfaced",
      tier: "returned",
      lane: "ready",
    }),
  ];
  const verdict = helpers.matchFreshStampExactEntry(queue, {
    path: "b.md",
    line: 3,
    raw: "- [ ] #task Came back [fresh:: 2026-09-20]",
  });
  assert.equal(verdict.ok, true);
});

test("exact eligibility refuses every stale-cache shape", () => {
  const queue = [rottenEntry()];
  const raw = "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 2]";
  // Right line, wrong raw (edited since the queue read).
  assert.equal(
    helpers.matchFreshStampExactEntry(queue, {
      path: "a.md",
      line: 2,
      raw: "- [ ] #task Buy milk edited",
    }).ok,
    false,
  );
  // Right raw, wrong line (moved since the queue read).
  assert.equal(
    helpers.matchFreshStampExactEntry(queue, { path: "a.md", line: 9, raw })
      .ok,
    false,
  );
  // Wrong path.
  assert.equal(
    helpers.matchFreshStampExactEntry(queue, { path: "zzz.md", line: 2, raw })
      .ok,
    false,
  );
  // Missing row.
  assert.equal(
    helpers.matchFreshStampExactEntry(queue, {
      path: "a.md",
      line: 2,
      raw: "- [ ] #task Missing",
    }).ok,
    false,
  );
  // Ambiguous rows never authorize.
  const doubled = [rottenEntry(), rottenEntry()];
  assert.deepEqual(
    helpers.matchFreshStampExactEntry(doubled, {
      path: "a.md",
      line: 2,
      raw,
    }).reason,
    "ambiguous",
  );
});

test("exact eligibility refuses non-Ready and non-due rows", () => {
  const raw = "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 2]";
  const ref = { path: "a.md", line: 2, raw };
  assert.equal(
    helpers.matchFreshStampExactEntry(
      [rottenEntry({ lane: "pending", tier: "pending" })],
      ref,
    ).reason,
    "lane",
  );
  assert.equal(
    helpers.matchFreshStampExactEntry(
      [rottenEntry({ lane: "next", tier: "next" })],
      ref,
    ).reason,
    "lane",
  );
  assert.equal(
    helpers.matchFreshStampExactEntry(
      [rottenEntry({ lane: "ready", tier: "new", state: "new" })],
      ref,
    ).reason,
    "tier",
  );
  // Tracker tiers never decide: PROJECTS and REFERENCES rows refuse
  // with `tier`, like NEW.
  assert.equal(
    helpers.matchFreshStampExactEntry(
      [rottenEntry({ lane: "ready", tier: "projects", state: "new" })],
      ref,
    ).reason,
    "tier",
  );
  assert.equal(
    helpers.matchFreshStampExactEntry(
      [rottenEntry({ lane: "ready", tier: "references", state: "rotten" })],
      ref,
    ).reason,
    "tier",
  );
  // Legacy v3 rows without a lane never authorize.
  assert.equal(
    helpers.matchFreshStampExactEntry(
      [rottenEntry({ lane: undefined, tier: undefined })],
      ref,
    ).reason,
    "lane",
  );
});

test("legacy refs still match line-only while exact refuses", () => {
  const queue = [rottenEntry()];
  const legacy = helpers.matchFreshStampRefs(queue, [
    { path: "a.md", line: 2, raw: "- [ ] #task Buy milk edited" },
  ]);
  assert.deepEqual(legacy.keys, ["a.md:3"]);
  assert.equal(
    helpers.matchFreshStampExactEntry(queue, {
      path: "a.md",
      line: 2,
      raw: "- [ ] #task Buy milk edited",
    }).ok,
    false,
  );
});

// --- keeps support gate ---------------------------------------------------

test("keeps support needs namespace v5 with keepLine", () => {
  assert.equal(helpers.freshnessSupportsKeeps(null), false);
  assert.equal(helpers.freshnessSupportsKeeps({}), false);
  assert.equal(
    helpers.freshnessSupportsKeeps({ version: 4, keepLine: () => {} }),
    false,
  );
  assert.equal(helpers.freshnessSupportsKeeps({ version: 5 }), false);
  assert.equal(
    helpers.freshnessSupportsKeeps({ version: 5, keepLine: () => {} }),
    true,
  );
});

test("decay decisions need namespace v6 with keepLine", () => {
  assert.equal(helpers.freshnessSupportsDecayDecisions(null), false);
  assert.equal(helpers.freshnessSupportsDecayDecisions({}), false);
  assert.equal(
    helpers.freshnessSupportsDecayDecisions({
      version: 5,
      keepLine: () => {},
    }),
    false,
  );
  assert.equal(helpers.freshnessSupportsDecayDecisions({ version: 6 }), false);
  assert.equal(
    helpers.freshnessSupportsDecayDecisions({
      version: 6,
      keepLine: () => {},
    }),
    true,
  );
});

// --- per-target decisions ---------------------------------------------------

test("batch forwards per-target counted decisions to the stamper", () => {
  const seen = [];
  const stamper = (line, dateText, decision) => {
    seen.push({ ...decision });
    return `${line} [fresh:: ${dateText}]`;
  };
  const content = ["- [ ] #task A", "- [ ] #task B"].join("\n");
  const plan = helpers.planFreshStampBatch(
    content,
    [
      { line: 0, path: "a.md", raw: "- [ ] #task A", counted: true },
      { line: 1, path: "a.md", raw: "- [ ] #task B", counted: false },
    ],
    stamper,
    DATE,
  );
  assert.equal(plan.ok, true);
  assert.deepEqual(
    seen.map((decision) => decision.counted),
    [true, false],
  );
  assert.equal(plan.stamped[0].counted, true);
  assert.equal(plan.stamped[1].counted, false);
});

test("batch keeps legacy index targets uncounted", () => {
  const seen = [];
  const plan = helpers.planFreshStampBatch(
    "- [ ] #task A",
    [0],
    (line, dateText, decision) => {
      seen.push({ ...decision });
      return line;
    },
    DATE,
  );
  assert.equal(plan.ok, true);
  assert.equal(seen[0].counted, false);
  assert.equal(plan.stamped[0].counted, false);
});

test("a throwing stamper refuses the batch with no partial write", () => {
  const content = ["- [ ] #task A", "- [ ] #task B"].join("\n");
  const plan = helpers.planFreshStampBatch(
    content,
    [
      { line: 0, path: "a.md", raw: "- [ ] #task A", counted: true },
      { line: 1, path: "a.md", raw: "- [ ] #task B", counted: true },
    ],
    () => {
      throw new Error("keepLine unavailable");
    },
    DATE,
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.refusal, "stamp");
  assert.equal(plan.content, content);
  assert.deepEqual(plan.stamped, []);
  assert.equal(
    helpers.freshStampRefusalNotice("stamp"),
    "Could not update task; no tasks were updated",
  );
});

// --- keeps parsing and notice tail ------------------------------------------

test("parseKeepsCount reads the first valid value only", () => {
  assert.equal(helpers.parseKeepsCount("- [ ] #task T"), 0);
  assert.equal(
    helpers.parseKeepsCount("- [ ] #task T [keeps:: 2]"),
    2,
  );
  assert.equal(
    helpers.parseKeepsCount("- [ ] #task T (keeps:: 3)"),
    3,
  );
  assert.equal(
    helpers.parseKeepsCount("- [ ] #task T [keeps:: x] [keeps:: 2]"),
    2,
  );
  assert.equal(helpers.parseKeepsCount("- [ ] #task T [keeps:: 0]"), 0);
  assert.equal(helpers.parseKeepsCount("- [ ] #task T [keeps:: 1000]"), 0);
});

test("countFreshStampKept measures actual increments only", () => {
  assert.equal(
    helpers.countFreshStampKept([
      {
        counted: true,
        before: "- [ ] #task T [fresh:: 2026-09-30] [keeps:: 2]",
        after: "- [ ] #task T [fresh:: 2026-10-08] [keeps:: 3]",
      },
    ]),
    1,
  );
  // Uncounted preserves and same-day counted preserves never inflate.
  assert.equal(
    helpers.countFreshStampKept([
      {
        counted: false,
        before: "- [ ] #task T [fresh:: 2026-09-30] [keeps:: 2]",
        after: "- [ ] #task T [fresh:: 2026-10-08] [keeps:: 2]",
      },
      {
        counted: true,
        before: "- [ ] #task T [fresh:: 2026-10-08] [keeps:: 2]",
        after: "- [ ] #task T [fresh:: 2026-10-08] [keeps:: 2]",
      },
    ]),
    0,
  );
  // First keeps and saturation at 999 count.
  assert.equal(
    helpers.countFreshStampKept([
      {
        counted: true,
        before: "- [ ] #task T [fresh:: 2026-09-30]",
        after: "- [ ] #task T [fresh:: 2026-10-08] [keeps:: 1]",
      },
      {
        counted: true,
        before: "- [ ] #task T [fresh:: 2026-09-30] [keeps:: 999]",
        after: "- [ ] #task T [fresh:: 2026-10-08] [keeps:: 999]",
      },
    ]),
    2,
  );
});

test("fresh stamp notice tails kept increments without promises", () => {
  assert.equal(
    helpers.buildFreshStampNotice({
      changed: 1,
      dueAfter: 22,
      newAfter: 3,
      refreshedAfter: 13,
      budget: null,
      kept: 1,
    }),
    "Fresh ✓ 1 task · 22 due (3 new) · ✓ 13 today · kept 1×",
  );
  assert.equal(
    helpers.buildFreshStampNotice({
      changed: 1,
      dueAfter: 22,
      newAfter: 3,
      refreshedAfter: 13,
      budget: null,
    }),
    "Fresh ✓ 1 task · 22 due (3 new) · ✓ 13 today",
  );
  assert.equal(
    helpers.buildFreshStampNotice({
      changed: 1,
      dueAfter: 22,
      newAfter: 3,
      refreshedAfter: 13,
      budget: null,
      kept: 0,
    }),
    "Fresh ✓ 1 task · 22 due (3 new) · ✓ 13 today",
  );
});

test("duplicate source targets dedupe to one write", () => {
  const deduped = helpers.deduplicateFreshStampTargets([
    { path: "a.md", line: 2 },
    { path: "a.md", line: 2 },
    { path: "a.md", line: 3 },
    { path: "b.md", line: 2 },
  ]);
  assert.deepEqual(
    deduped.map((target) => `${target.path}::${target.line}`),
    ["a.md::2", "a.md::3", "b.md::2"],
  );
});

// --- real-handler harness ---------------------------------------------------
// Fake editor + app around the real plugin handlers and the real ledger
// keep/stamp placers: single-note writes go through the editor transaction,
// cross-note writes through the preimage-guarded link path.

function applyTxChanges(state, changes) {
  const sorted = (Array.isArray(changes) ? changes : []).slice().sort(
    (left, right) => right.from.line - left.from.line,
  );
  for (const change of sorted) {
    state.lines[change.from.line] = String(change.text);
  }
}

function makeEditor(initial, cursorLine = 0) {
  const state = {
    lines: String(initial).split("\n"),
    cursor: { line: cursorLine, ch: 0 },
    transactions: [],
    replaceRanges: [],
    valueQueue: [],
  };
  return {
    state,
    getCursor: () => ({ ...state.cursor }),
    getLine: (line) => state.lines[line],
    getValue: () =>
      state.valueQueue.length > 0
        ? state.valueQueue.shift()
        : state.lines.join("\n"),
    transaction: (tx) => {
      state.transactions.push(tx);
      applyTxChanges(state, tx.changes);
    },
    replaceRange: (text, from, to) => {
      state.replaceRanges.push({ text, from, to });
      applyTxChanges(state, [{ from, to, text }]);
    },
    getScrollInfo: () => null,
  };
}

function makePlugin({ filePath, editor, freshness }) {
  const file = { path: filePath, extension: "md", basename: filePath };
  const view = { file, editor };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": { api: { version: 3, freshness } },
      },
    },
    workspace: { getActiveViewOfType: () => view },
    vault: { getAbstractFileByPath: () => null },
  };
  plugin.reviewAnchor = null;
  plugin.view = view;
  return plugin;
}

function freshnessV5(queue, counts) {
  return {
    version: 5,
    queue: () => queue.map((entry) => ({ ...entry })),
    counts: () => ({ ...counts }),
    stampLine: realStamp,
    setRefreshLine: (line, days, dateText) =>
      ledgerHelpers.freshnessSetRefreshLine(line, days, dateText || DATE).line,
    keepLine: realKeep,
  };
}

function freshnessV6(queue, counts) {
  return { ...freshnessV5(queue, counts), version: 6 };
}

const BASE_COUNTS = {
  due: 23,
  new: 3,
  resurfaced: 0,
  rotten: 0,
  fresh: 0,
  refreshedToday: 12,
  upkeepToday: 12,
  budget: null,
  budgetMet: false,
};

const ROTTEN_LINE = "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 2]";

test("single Alt+F increments an exact due-Ready ROTTEN task", async () => {
  clearNotices();
  const editor = makeEditor(["# Tasks", "", ROTTEN_LINE].join("\n"), 2);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([rottenEntry()], BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.equal(
    editor.state.lines[2],
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [keeps:: 3]",
  );
  assert.match(notices[notices.length - 1], /kept 1×/);
  assert.doesNotMatch(notices[notices.length - 1], /next review asks/);
});

test("single Alt+F preserves NEW, lane, and early tasks without counting", async () => {
  const cases = [
    {
      name: "new",
      line: "- [ ] #task Brand new",
      entry: rottenEntry({
        originalMarkdown: "- [ ] #task Brand new",
        state: "new",
        tier: "new",
        lane: "ready",
        fresh: null,
        keeps: 0,
      }),
    },
    {
      name: "pending lane",
      line: "- [*] #task Waiting [fresh:: 2026-10-07]",
      entry: rottenEntry({
        originalMarkdown: "- [*] #task Waiting [fresh:: 2026-10-07]",
        state: null,
        tier: "pending",
        lane: "pending",
        fresh: "2026-10-07",
        keeps: 0,
      }),
    },
    {
      name: "early ready",
      line: "- [ ] #task Fresh [fresh:: 2026-10-07]",
      entry: rottenEntry({
        originalMarkdown: "- [ ] #task Fresh [fresh:: 2026-10-07]",
        state: "fresh",
        tier: null,
        bucket: null,
        lane: "ready",
        fresh: "2026-10-07",
        keeps: 0,
      }),
    },
  ];
  for (const { name, line, entry } of cases) {
    clearNotices();
    const editor = makeEditor(line, 0);
    const plugin = makePlugin({
      filePath: "a.md",
      editor,
      freshness: freshnessV5([entry], BASE_COUNTS),
    });
    const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
    assert.equal(ok, true, name);
    assert.match(editor.state.lines[0], /\[fresh:: 2026-10-08\]/, name);
    assert.doesNotMatch(editor.state.lines[0], /keeps::/, name);
    assert.doesNotMatch(notices[notices.length - 1], /kept \d+×/, name);
  }
});

test("same-day repeat stays identical and counts nothing", async () => {
  clearNotices();
  const stamped =
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [keeps:: 3]";
  const editor = makeEditor(stamped, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5(
      [
        rottenEntry({
          line: 1,
          originalMarkdown: stamped,
          fresh: DATE,
          keeps: 3,
        }),
      ],
      BASE_COUNTS,
    ),
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.equal(editor.state.lines[0], stamped);
  assert.doesNotMatch(notices[notices.length - 1], /kept \d+×/);
});

test("Pending Alt+F writes its summary with the stamp in one edit", async () => {
  clearNotices();
  const editor = makeEditor("- [/] #task Pending work", 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([], BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    summary: "Finished the review",
  });
  assert.equal(ok, true);
  assert.equal(editor.state.transactions.length, 1);
  assert.equal(
    editor.state.lines.join("\n"),
    [
      "- [/] #task Pending work [fresh:: 2026-10-08]",
      "\t- 🛠️ **WORK LOG**",
      "\t\t- *2026-10-08* — Finished the review",
    ].join("\n"),
  );
  assert.match(notices[notices.length - 1], /1 Work Log/);
});

test("counted Pending refresh shares one summary only with Pending targets", async () => {
  clearNotices();
  const editor = makeEditor(
    ["- [/] #task Pending", "- [*] #task Next"].join("\n"),
    0,
  );
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([], BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
    summary: "Shared work",
  });
  assert.equal(ok, true);
  const after = editor.state.lines.join("\n");
  assert.match(after, /\[\/\] #task Pending \[fresh:: 2026-10-08\][\s\S]*WORK LOG/);
  assert.match(after, /\[\*\] #task Next \[fresh:: 2026-10-08\]/);
  assert.equal((after.match(/Shared work/g) || []).length, 1);
  assert.match(notices[notices.length - 1], /1 Work Log/);
});

test("a refusing counted target refuses before the Pending Work Log prompt", async () => {
  clearNotices();
  const original = [
    "- [/] #task Pending",
    "- [ ] #task Recurring [repeat:: every day]",
  ].join("\n");
  const editor = makeEditor(original, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([], BASE_COUNTS),
  });
  let prompted = false;
  plugin.requestFreshnessRefreshSummary = async () => {
    prompted = true;
    return { cancelled: false, summary: "Should not be asked" };
  };
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, false);
  assert.equal(prompted, false);
  assert.equal(editor.state.lines.join("\n"), original);
  assert.equal(notices[notices.length - 1], "recurring · not reviewed");
});

test("blank Pending refresh advances; cancelled or stale prompts write nothing", async () => {
  clearNotices();
  const blankEditor = makeEditor("- [/] #task Pending work", 0);
  const blankPlugin = makePlugin({
    filePath: "a.md",
    editor: blankEditor,
    freshness: freshnessV5([], BASE_COUNTS),
  });
  let advances = 0;
  blankPlugin.jumpToDueTask = async () => {
    advances += 1;
    return true;
  };
  assert.equal(
    await blankPlugin.refreshTaskFreshness(blankEditor, {
      dateText: DATE,
      summary: "",
      advance: true,
    }),
    true,
  );
  assert.equal(advances, 1);
  assert.equal(blankEditor.state.lines.length, 1);
  assert.match(blankEditor.state.lines[0], /\[fresh:: 2026-10-08\]/);
  assert.doesNotMatch(blankEditor.state.lines.join("\n"), /WORK LOG|🤷/);

  for (const mode of ["cancel", "stale", "failed"]) {
    const editor = makeEditor("- [/] #task Pending work", 0);
    const plugin = makePlugin({
      filePath: "a.md",
      editor,
      freshness: freshnessV5([], BASE_COUNTS),
    });
    let advanced = false;
    plugin.jumpToDueTask = async () => {
      advanced = true;
      return true;
    };
    plugin.requestFreshnessRefreshSummary = async () => {
      if (mode === "stale") {
        editor.state.lines[0] = "- [/] #task Changed while prompt was open";
        return { cancelled: false, summary: "Finished" };
      }
      if (mode === "failed") {
        return { failed: true, summary: "" };
      }
      return { cancelled: true, summary: "" };
    };
    const ok = await plugin.refreshTaskFreshness(editor, {
      dateText: DATE,
      advance: true,
    });
    assert.equal(ok, false, mode);
    assert.equal(advanced, false, mode);
    assert.equal(editor.state.transactions.length, 0, mode);
    assert.doesNotMatch(editor.state.lines.join("\n"), /fresh::|WORK LOG/, mode);
  }
});

test("stale queue match stamps uncounted and never inflates", async () => {
  clearNotices();
  // The queue still shows the old line number after the task moved.
  const editor = makeEditor(["# Other", ROTTEN_LINE].join("\n"), 1);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([rottenEntry()], BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.equal(
    editor.state.lines[1],
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [keeps:: 2]",
  );
  assert.doesNotMatch(notices[notices.length - 1], /kept \d+×/);
});

test("counted Alt+F increments every exact target once", async () => {
  clearNotices();
  const second =
    "- [ ] #task Walk dog [fresh:: 2026-09-29] [keeps:: 1]";
  const content = [ROTTEN_LINE, second].join("\n");
  const editor = makeEditor(content, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5(
      [
        rottenEntry({
          key: "a.md:1",
          line: 1,
          originalMarkdown: ROTTEN_LINE,
        }),
        rottenEntry({
          key: "a.md:2",
          line: 2,
          originalMarkdown: second,
          keeps: 1,
          rank: 2,
          tierRank: 2,
          tierTotal: 2,
        }),
      ],
      BASE_COUNTS,
    ),
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, true);
  assert.match(editor.state.lines[0], /\[keeps:: 3\]/);
  assert.match(editor.state.lines[1], /\[keeps:: 2\]/);
  assert.match(notices[notices.length - 1], /kept 2×/);
});

test("stale editor source refuses with no write", async () => {
  clearNotices();
  const editor = makeEditor(ROTTEN_LINE, 0);
  // The note changes between discovery and the write guard.
  editor.state.valueQueue.push(
    ROTTEN_LINE,
    "- [ ] #task Buy milk changed underneath",
  );
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([rottenEntry({ line: 1 })], BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, false);
  assert.equal(editor.state.transactions.length, 0);
  assert.equal(
    notices[notices.length - 1],
    "Current note changed; no tasks were updated",
  );
});

test("single-note write lands in one editor transaction and keeps CRLF", async () => {
  clearNotices();
  const editor = makeEditor(
    ["# Tasks", "", ROTTEN_LINE].join("\r\n"),
    2,
  );
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([rottenEntry()], BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.equal(editor.state.transactions.length, 1);
  const after = editor.state.lines.join("\r\n");
  assert.match(after, /\r\n/);
  assert.doesNotMatch(after, /[^\r]\n/);
  assert.match(after, /\[keeps:: 3\]/);
});

test("v5 without keepLine fails without writing", async () => {
  clearNotices();
  const editor = makeEditor(ROTTEN_LINE, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: {
      version: 5,
      queue: () => [rottenEntry({ line: 1 })],
      counts: () => ({ ...BASE_COUNTS }),
      stampLine: realStamp,
    },
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, false);
  assert.equal(editor.state.lines[0], ROTTEN_LINE);
  assert.equal(
    notices[notices.length - 1],
    "Bob Ledger Tools keep support required",
  );
});

test("throwing v5 keepLine refuses the batch with no partial write", async () => {
  clearNotices();
  const content = [ROTTEN_LINE, ROTTEN_LINE].join("\n");
  const editor = makeEditor(content, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: {
      version: 5,
      queue: () => [
        rottenEntry({ line: 1 }),
        rottenEntry({ key: "a.md:2", line: 2, rank: 2 }),
      ],
      counts: () => ({ ...BASE_COUNTS }),
      stampLine: realStamp,
      keepLine: () => {
        throw new Error("keepLine unavailable");
      },
    },
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, false);
  assert.equal(editor.state.lines.join("\n"), content);
  assert.equal(
    notices[notices.length - 1],
    "Could not update task; no tasks were updated",
  );
});

test("pre-v5 ledger stamps uncounted through the old stamper", async () => {
  clearNotices();
  const editor = makeEditor(ROTTEN_LINE, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: {
      version: 4,
      queue: () => [rottenEntry({ line: 1 })],
      counts: () => ({ ...BASE_COUNTS }),
      stampLine: realStamp,
    },
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.match(editor.state.lines[0], /\[fresh:: 2026-10-08\]/);
  assert.doesNotMatch(editor.state.lines[0], /keeps::/);
});

// --- Task Link flow ---------------------------------------------------------

function makeLinkPlugin({ cursorContent, cursorLine, noteMap, freshness }) {
  const editor = makeEditor(cursorContent, cursorLine);
  const plugin = makePlugin({
    filePath: "Daily.md",
    editor,
    freshness,
  });
  plugin.noteMap = noteMap;
  plugin.readLinkPickerNoteContent = async (path) =>
    plugin.noteMap.has(path) ? plugin.noteMap.get(path) : null;
  plugin.writeLinkPickerNoteChange = async (path, file, before, after) => {
    plugin.writes.push({ path, before, after });
    if (plugin.failWrites.has(path)) {
      throw new Error(`write failed: ${path}`);
    }
    plugin.noteMap.set(path, after);
  };
  plugin.resolveLinkTargetFile = (linkTarget) => {
    const base = String(linkTarget || "").split("#")[0] || "Target.md";
    const path = base.endsWith(".md") ? base : `${base}.md`;
    return { path, extension: "md" };
  };
  plugin.writes = [];
  plugin.failWrites = new Set();
  return plugin;
}

const LINK_LINE = "- [ ] [[Target#^abc]]";
const TARGET_LINE = `- [ ] #task Linked keep [fresh:: 2026-09-30] [keeps:: 2] ^abc`;

function linkQueue() {
  return [
    rottenEntry({
      key: "Target.md:1",
      path: "Target.md",
      line: 1,
      originalMarkdown: TARGET_LINE,
      keeps: 2,
      text: "Linked keep",
    }),
  ];
}

test("Task Link session skips an at-limit decide target", async () => {
  clearNotices();
  const atLimit =
    "- [ ] #task Linked keep [fresh:: 2026-09-20] [keeps:: 3] ^abc";
  const noteMap = new Map([["Target.md", atLimit]]);
  const plugin = makeLinkPlugin({
    cursorContent: LINK_LINE,
    cursorLine: 0,
    noteMap,
    freshness: freshnessV6(
      [
        rottenEntry({
          key: "Target.md:1",
          path: "Target.md",
          line: 1,
          originalMarkdown: atLimit,
          keeps: 3,
          decide: true,
          text: "Linked keep",
        }),
      ],
      BASE_COUNTS,
    ),
  });
  const ok = await plugin.refreshTaskFreshness(plugin.view.editor, {
    dateText: DATE,
  });
  assert.equal(ok, true);
  assert.equal(noteMap.get("Target.md"), atLimit);
  assert.equal(plugin.writes.length, 0);
  assert.match(notices[notices.length - 1], /needs a decision/);
});

test("Task Link refresh counts one exact target", async () => {
  clearNotices();
  const noteMap = new Map([["Target.md", TARGET_LINE]]);
  const plugin = makeLinkPlugin({
    cursorContent: LINK_LINE,
    cursorLine: 0,
    noteMap,
    freshness: freshnessV5(linkQueue(), BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(plugin.view.editor, {
    dateText: DATE,
  });
  assert.equal(ok, true);
  assert.match(
    noteMap.get("Target.md"),
    /\[fresh:: 2026-10-08\] \[keeps:: 3\]/,
  );
  assert.match(notices[notices.length - 1], /kept 1×/);
});

test("duplicate Task Links to one target stamp and count once", async () => {
  clearNotices();
  const noteMap = new Map([["Target.md", TARGET_LINE]]);
  const plugin = makeLinkPlugin({
    cursorContent: [LINK_LINE, "- [ ] [[Target#^abc]]"].join("\n"),
    cursorLine: 0,
    noteMap,
    freshness: freshnessV5(linkQueue(), BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(plugin.view.editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, true);
  assert.match(noteMap.get("Target.md"), /\[keeps:: 3\]/);
  assert.match(notices[notices.length - 1], /kept 1×/);
});

test("counted Task Links dedupe targets and log only the Pending target", async () => {
  clearNotices();
  const pendingLink = "- [ ] [[Target#^p]]";
  const noteMap = new Map([
    [
      "Target.md",
      [
        "- [/] #task Pending linked task ^p",
        "- [*] #task Next linked task ^n",
      ].join("\n"),
    ],
  ]);
  const plugin = makeLinkPlugin({
    cursorContent: [
      pendingLink,
      pendingLink,
      "- [ ] [[Target#^n]]",
    ].join("\n"),
    cursorLine: 0,
    noteMap,
    freshness: freshnessV5([], BASE_COUNTS),
  });
  const ok = await plugin.refreshTaskFreshness(plugin.view.editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 2,
    summary: "Linked work",
  });
  assert.equal(ok, true);
  const after = noteMap.get("Target.md");
  assert.match(after, /\[\/\] #task Pending linked task \[fresh:: 2026-10-08\] \^p/);
  assert.match(after, /\[\*\] #task Next linked task \[fresh:: 2026-10-08\] \^n/);
  assert.equal((after.match(/Linked work/g) || []).length, 1);
  assert.equal((after.match(/WORK LOG/g) || []).length, 1);
  assert.equal(plugin.writes.length, 1);
  assert.match(notices[notices.length - 1], /1 Work Log/);
});

test("multi-note stale preimage refuses with no writes", async () => {
  clearNotices();
  const noteMap = new Map([
    ["One.md", TARGET_LINE.replace("Target", "One")],
    ["Two.md", TARGET_LINE.replace("Target", "Two")],
  ]);
  const plugin = makeLinkPlugin({
    cursorContent: ["- [ ] [[One#^abc]]", "- [ ] [[Two#^abc]]"].join("\n"),
    cursorLine: 0,
    noteMap,
    freshness: freshnessV5(
      [
        rottenEntry({
          key: "One.md:1",
          path: "One.md",
          line: 1,
          originalMarkdown: TARGET_LINE.replace("Target", "One"),
          keeps: 2,
        }),
        rottenEntry({
          key: "Two.md:1",
          path: "Two.md",
          line: 1,
          originalMarkdown: TARGET_LINE.replace("Target", "Two"),
          keeps: 2,
          rank: 2,
        }),
      ],
      BASE_COUNTS,
    ),
  });
  // Every re-read sees a changed note, so the commit preimage check fails.
  const before = plugin.readLinkPickerNoteContent;
  let reads = 0;
  plugin.readLinkPickerNoteContent = async (path, file) => {
    reads += 1;
    if (reads > 2) {
      return `${await before(path, file)}\n`;
    }
    return before(path, file);
  };
  const ok = await plugin.refreshTaskFreshness(plugin.view.editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, false);
  assert.equal(plugin.writes.length, 0);
  assert.equal(
    notices[notices.length - 1],
    "A linked note changed; no tasks were updated",
  );
});

test("multi-note write failure rolls back the first note", async () => {
  clearNotices();
  const one = TARGET_LINE.replace("Target", "One");
  const two = TARGET_LINE.replace("Target", "Two");
  const noteMap = new Map([
    ["One.md", one],
    ["Two.md", two],
  ]);
  const plugin = makeLinkPlugin({
    cursorContent: ["- [ ] [[One#^abc]]", "- [ ] [[Two#^abc]]"].join("\n"),
    cursorLine: 0,
    noteMap,
    freshness: freshnessV5(
      [
        rottenEntry({
          key: "One.md:1",
          path: "One.md",
          line: 1,
          originalMarkdown: one,
          keeps: 2,
        }),
        rottenEntry({
          key: "Two.md:1",
          path: "Two.md",
          line: 1,
          originalMarkdown: two,
          keeps: 2,
          rank: 2,
        }),
      ],
      BASE_COUNTS,
    ),
  });
  plugin.failWrites.add("Two.md");
  const ok = await plugin.refreshTaskFreshness(plugin.view.editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, false);
  // The first note was written and then rolled back through the same writer.
  assert.ok(plugin.writes.length >= 3);
  assert.equal(noteMap.get("One.md"), one);
  assert.equal(noteMap.get("Two.md"), two);
});

// --- physical-key dispatch ----------------------------------------------------

function reviewRefreshKeyEvent(overrides = {}) {
  return {
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: true,
    shiftKey: false,
    code: "KeyF",
    key: "f",
    preventDefault: () => {},
    stopPropagation: () => {},
    stopImmediatePropagation: () => {},
    ...overrides,
  };
}

function attachReviewRefreshCapture(plugin, cm = {}) {
  plugin.laneReleaseDateText = () => DATE;
  plugin.handledReviewRefreshEvents = new WeakSet();
  plugin.getFocusedMarkdownEditorView = () => plugin.view;
  plugin.isVimNormalModeEditor = () => true;
  plugin.resolveVimCodeMirror = () => cm;
}

test("one physical key through two routes stamps once", async () => {
  clearNotices();
  const editor = makeEditor(["# Tasks", "", ROTTEN_LINE].join("\n"), 2);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([rottenEntry()], BASE_COUNTS),
  });
  attachReviewRefreshCapture(plugin);
  const seen = [];
  let pending = null;
  const inner = plugin.refreshTaskFreshness.bind(plugin);
  plugin.refreshTaskFreshness = async (...args) => {
    seen.push(args[1] || {});
    pending = inner(...args);
    return pending;
  };
  const event = reviewRefreshKeyEvent();
  // The capture listener is registered on both window and document, so one
  // physical key reaches the handler twice with the same event object.
  assert.equal(plugin.handleReviewRefreshPhysicalKeydown(event), true);
  assert.equal(plugin.handleReviewRefreshPhysicalKeydown(event), false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].advance, false);
  await pending;
  // A racing second route (hotkey dispatcher) with the lagging queue still
  // preserves the same-day streak instead of double-counting.
  const ok = await inner(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.match(editor.state.lines[2], /\[keeps:: 3\]/);
  assert.doesNotMatch(notices[notices.length - 1], /kept \d+×/);
});

test("Ctrl+Alt+F capture advances once and consumes a Vim prefix", async () => {
  clearNotices();
  const editor = makeEditor(["# Tasks", "", ROTTEN_LINE].join("\n"), 2);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([rottenEntry()], BASE_COUNTS),
  });
  const cm = {
    getCursor: () => ({ line: 2, ch: 0 }),
    state: {
      vim: {
        inputState: {
          prefixRepeat: ["3"],
          motionRepeat: [],
          keyBuffer: [],
          reason: "",
        },
      },
    },
  };
  attachReviewRefreshCapture(plugin, cm);
  const seen = [];
  let advances = 0;
  plugin.jumpToDueTask = async () => {
    advances += 1;
    return true;
  };
  const inner = plugin.refreshTaskFreshness.bind(plugin);
  let pending = null;
  plugin.refreshTaskFreshness = async (...args) => {
    seen.push(args[1] || {});
    pending = inner(...args);
    return pending;
  };
  const event = reviewRefreshKeyEvent({ ctrlKey: true });
  assert.equal(plugin.handleReviewRefreshPhysicalKeydown(event), true);
  assert.equal(plugin.handleReviewRefreshPhysicalKeydown(event), false);
  await pending;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].advance, true);
  assert.equal(seen[0].countExplicit, true);
  assert.equal(seen[0].additionalTaskCount, 3);
  assert.deepEqual(cm.state.vim.inputState.prefixRepeat, []);
  assert.equal(cm.state.vim.inputState.reason, "review-freshness-refresh");
  assert.equal(advances, 1);
  assert.match(editor.state.lines[2], /\[keeps:: 3\]/);
});

test("obsolete and extra-modifier F chords stay unconsumed", async () => {
  clearNotices();
  const editor = makeEditor(["# Tasks", "", ROTTEN_LINE].join("\n"), 2);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: freshnessV5([rottenEntry()], BASE_COUNTS),
  });
  const cm = {
    getCursor: () => ({ line: 2, ch: 0 }),
    state: {
      vim: {
        inputState: {
          prefixRepeat: ["2"],
          motionRepeat: [],
          keyBuffer: [],
          reason: "",
        },
      },
    },
  };
  attachReviewRefreshCapture(plugin, cm);
  let refreshCalls = 0;
  plugin.refreshTaskFreshness = async () => {
    refreshCalls += 1;
    return true;
  };
  const rejected = [
    reviewRefreshKeyEvent({ shiftKey: true, key: "F" }),
    reviewRefreshKeyEvent({ ctrlKey: true, shiftKey: true, key: "F" }),
    reviewRefreshKeyEvent({ metaKey: true }),
    reviewRefreshKeyEvent({ ctrlKey: true, metaKey: true }),
    reviewRefreshKeyEvent({ altKey: false, ctrlKey: true }),
    reviewRefreshKeyEvent({ code: "KeyG", key: "g" }),
    reviewRefreshKeyEvent({ repeat: true }),
    reviewRefreshKeyEvent({ repeat: true, ctrlKey: true }),
  ];
  for (const event of rejected) {
    assert.equal(plugin.handleReviewRefreshPhysicalKeydown(event), false);
  }
  plugin.getFocusedMarkdownEditorView = () => null;
  assert.equal(
    plugin.handleReviewRefreshPhysicalKeydown(reviewRefreshKeyEvent()),
    false,
  );
  assert.equal(
    plugin.handleReviewRefreshPhysicalKeydown(
      reviewRefreshKeyEvent({ ctrlKey: true }),
    ),
    false,
  );
  assert.equal(refreshCalls, 0);
  assert.deepEqual(cm.state.vim.inputState.prefixRepeat, ["2"]);
  assert.equal(editor.state.lines[2], ROTTEN_LINE);
});
