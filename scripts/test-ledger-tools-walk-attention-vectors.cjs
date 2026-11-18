// Walk attention conformance vectors (`docs/walks.md` in bob-cli).
//
// Runs the S/W/B vectors verbatim through the real attention push code
// paths — walkerFooterPushReviewAttention, laneWalkQueueFromTasks with
// walkerFooterPushLaneAttention, and the bank snapshot with
// walkerFooterPushBankAttention — against a stub walkMode (version 6)
// that records setAttention calls. Asserts presence, tier, and the label
// with the plugin-only click hint stripped, so the assertion equals
// bob's contract label byte-for-byte.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand() {}
  registerEditorExtension() {}
  registerEvent() {}
  registerMarkdownCodeBlockProcessor() {}
  registerInterval(handle) {
    return handle;
  }
}

class TestMarkdownView {}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: class {},
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

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  bankWalkBuildEntries,
  defaultPlanCaps,
  laneWalkQueueFromTasks,
  walkerFooterPushBankAttention,
  walkerFooterPushLaneAttention,
  walkerFooterPushReviewAttention,
} = helpers;

const DAY = new Date(2026, 9, 28);

// Strip the plugin-only click hints so the assertion equals bob's
// contract label (`docs/walks.md` "Labels").
function stripClickHint(label) {
  return String(label || "")
    .replace(" — click to show", "")
    .replace("; click to show", "");
}

// A stub nav walkMode at version 6 that records every setAttention call.
function pushPlugin(mode = "w") {
  const calls = [];
  const plugin = {
    dependencyNavApi: () => ({
      walkMode: {
        version: 6,
        current: () => mode,
        setAttention: (type, value) => {
          calls.push({ type, value });
          return { ok: true };
        },
      },
    }),
    freshnessMemo: null,
  };
  return { plugin, calls };
}

function commitmentMemo({ byTier = {}, walk = 0, tasksAvailable = true } = {}) {
  return { counts: { byTier, walk }, tasksAvailable };
}

function pushReview({ mode = "w", byTier = {}, walk = 0 } = {}) {
  const { plugin, calls } = pushPlugin(mode);
  walkerFooterPushReviewAttention(
    plugin,
    { legacy: false, mode },
    commitmentMemo({ byTier, walk }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "s");
  return calls[0].value;
}

function pushLanes({ mode = "w", queue, caps = defaultPlanCaps() } = {}) {
  const { plugin, calls } = pushPlugin(mode);
  walkerFooterPushLaneAttention(plugin, { legacy: false, mode }, queue, caps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "w");
  return calls[0].value;
}

function pushBank({ mode = "w", snapshot } = {}) {
  const { plugin, calls } = pushPlugin(mode);
  walkerFooterPushBankAttention(plugin, { legacy: false, mode }, snapshot);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "b");
  return calls[0].value;
}

function task(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: ["#task"],
    path: "notes/a.md",
    lineNumber: 0,
    blockLink: " ^a1",
    originalMarkdown: "- [ ] #task body",
    description: "body",
    isBlocked: () => false,
    ...overrides,
  };
}

function pendingTask(overrides = {}) {
  return task({
    status: { type: "IN_PROGRESS", name: "In Progress", symbol: "/" },
    ...overrides,
  });
}

function nextTask(overrides = {}) {
  return task({
    status: { type: "ON_HOLD", name: "Next", symbol: "*" },
    ...overrides,
  });
}

function bankRow(date, line, cents, payee, waiting = true, path = "bank/2026-11.md") {
  return {
    path,
    line,
    date,
    cents,
    waiting,
    acknowledged: !waiting,
    payee,
    ackId: null,
    text: `-${waiting ? "[ ]" : "[x]"} ${payee}`,
  };
}

function bankSnapshot(rows) {
  const built = bankWalkBuildEntries(rows);
  const waiting = rows.filter((row) => row.waiting).length;
  return {
    available: true,
    counts: { rows: rows.length, waiting },
    entries: built.entries,
  };
}

// --- s: review -------------------------------------------------------------

test("S1: only ROTTEN due keeps s off", () => {
  assert.equal(pushReview({ byTier: { rotten: 1 }, walk: 1 }), null);
});

test("S2: only POST due keeps s off", () => {
  assert.equal(pushReview({ byTier: { post: 1 }, walk: 1 }), null);
});

test("S3: NEW 1 and ROTTEN 1 lights s with tier new", () => {
  const value = pushReview({ byTier: { new: 1, rotten: 1 }, walk: 2 });
  assert.notEqual(value, null);
  assert.equal(value.tier, "new");
  assert.equal(
    stripClickHint(value.label),
    "Review: 2 due · 1 commitments — NEW first",
  );
});

test("S4: PRE 1 and NEXT 2 lights s with tier pre", () => {
  const value = pushReview({ byTier: { pre: 1, next: 2 }, walk: 3 });
  assert.notEqual(value, null);
  assert.equal(value.tier, "pre");
  assert.equal(
    stripClickHint(value.label),
    "Review: 3 due · 3 commitments — PRE first",
  );
});

test("S5: TICKLER only lights s with tier tickler", () => {
  const value = pushReview({ byTier: { tickler: 2 }, walk: 2 });
  assert.notEqual(value, null);
  assert.equal(value.tier, "tickler");
  assert.match(stripClickHint(value.label), /TICKS first$/);
});

// --- w: lanes --------------------------------------------------------------

test("W1: PENDING 11 with cap 10 lights w", () => {
  const value = pushLanes({
    queue: { available: true, counts: { pending: 11, next: 0, ready: 0 } },
    caps: { ...defaultPlanCaps(), maxPending: 10 },
  });
  assert.notEqual(value, null);
  assert.equal(value.tier, "over");
  assert.equal(stripClickHint(value.label), "Lanes over limit: WIP 11/10");
});

test("W2: PENDING 10 with cap 10 keeps w off", () => {
  const value = pushLanes({
    queue: { available: true, counts: { pending: 10, next: 0, ready: 0 } },
    caps: { ...defaultPlanCaps(), maxPending: 10 },
  });
  assert.equal(value, null);
});

test("W8: READY 101 with cap 100 lights w", () => {
  const value = pushLanes({
    queue: { available: true, counts: { pending: 0, next: 0, ready: 101 } },
    caps: { ...defaultPlanCaps(), maxReady: 100 },
  });
  assert.notEqual(value, null);
  assert.equal(value.tier, "over");
  assert.equal(stripClickHint(value.label), "Lanes over limit: READY 101/100");
});

test("W3: a Today-linked [/] task is not counted", () => {
  const mine = pendingTask({ path: "notes/a.md", lineNumber: 0 });
  const other = pendingTask({ path: "notes/b.md", lineNumber: 0 });
  const queue = laneWalkQueueFromTasks(
    [mine, other],
    DAY,
    (entry) => entry === mine,
  );
  assert.equal(queue.counts.pending, 1);
  assert.equal(queue.counts.todayPending, 1);
  assert.ok(!queue.entries.some((entry) => entry.path === "notes/a.md"));
  const value = pushLanes({
    queue: { available: true, counts: queue.counts },
    caps: { ...defaultPlanCaps(), maxPending: 10 },
  });
  assert.equal(value, null);
});

test("W4: an unstamped (NEW) Ready task is not in READY", () => {
  const fresh = task({ path: "notes/new.md", lineNumber: 0 });
  const queue = laneWalkQueueFromTasks([fresh], DAY, () => false, {
    isReviewBucket: () => true,
  });
  assert.equal(queue.counts.ready, 0);
  assert.equal(queue.counts.reviewReady, 1);
});

test("W5: a ROTTEN Ready task is not in READY", () => {
  const rotten = task({ path: "notes/rotten.md", lineNumber: 0 });
  const queue = laneWalkQueueFromTasks([rotten], DAY, () => false, {
    isReviewBucket: () => true,
  });
  assert.equal(queue.counts.ready, 0);
  assert.equal(queue.counts.reviewReady, 1);
});

test("W6: rows in dash.md are not counted", () => {
  const queue = laneWalkQueueFromTasks(
    [
      pendingTask({ path: "dash.md", lineNumber: 0 }),
      pendingTask({ path: "DASH.MD", lineNumber: 1 }),
      pendingTask({ path: "notes/a.md", lineNumber: 2 }),
    ],
    DAY,
    () => false,
  );
  assert.equal(queue.counts.pending, 1);
  assert.ok(!queue.entries.some((entry) => entry.path.toLowerCase() === "dash.md"));
});

test("W7: future-scheduled, #hide, blocked, and _templates rows are not counted", () => {
  const queue = laneWalkQueueFromTasks(
    [
      pendingTask({ path: "notes/future.md", lineNumber: 0, scheduledDate: "2026-10-29" }),
      pendingTask({
        path: "notes/hidden.md",
        lineNumber: 1,
        tags: ["#task", "#hide"],
      }),
      pendingTask({ path: "notes/blocked.md", lineNumber: 2, isBlocked: () => true }),
      pendingTask({ path: "_templates/a.md", lineNumber: 3 }),
      pendingTask({ path: "notes/keep.md", lineNumber: 4 }),
    ],
    DAY,
    () => false,
  );
  assert.equal(queue.counts.pending, 1);
  assert.deepEqual(
    queue.entries.map((entry) => entry.path),
    ["notes/keep.md"],
  );
});

// --- b: bank ---------------------------------------------------------------

test("B1: one [ ] row under a day heading waits", () => {
  const snapshot = bankSnapshot([bankRow("2026-11-10", 4, -1100, "Mon one")]);
  assert.equal(snapshot.counts.waiting, 1);
  const value = pushBank({ snapshot });
  assert.notEqual(value, null);
  assert.equal(value.tier, "waiting");
  assert.match(
    stripClickHint(value.label),
    /^Bank: 1 waiting · oldest \w+ \w+ \d+$/,
  );
});

test("B2: [x] and [X] rows do not wait", () => {
  const snapshot = bankSnapshot([
    bankRow("2026-11-10", 4, -1100, "Mon one", false),
    bankRow("2026-11-10", 5, -1200, "Mon two", false),
  ]);
  assert.equal(snapshot.counts.waiting, 0);
  assert.equal(pushBank({ snapshot }), null);
});

test("B3: waiting rows in two months surface the earlier month first", () => {
  const snapshot = bankSnapshot([
    bankRow("2026-11-10", 4, -1100, "Nov one", true, "bank/2026-11.md"),
    bankRow("2026-10-03", 3, -500, "Oct one", true, "bank/2026-10.md"),
  ]);
  assert.equal(snapshot.counts.waiting, 2);
  assert.equal(snapshot.entries[0].date, "2026-10-03");
  const value = pushBank({ snapshot });
  assert.notEqual(value, null);
  assert.equal(value.tier, "waiting");
  assert.ok(
    stripClickHint(value.label).endsWith(`oldest ${snapshot.entries[0].label}`),
  );
});

test("B4: an unavailable bank clears b while s and w still report", () => {
  assert.equal(pushBank({ snapshot: { available: false, reason: "bad config" } }), null);
  assert.equal(pushBank({ snapshot: null }), null);
  const review = pushReview({ byTier: { next: 1 }, walk: 1 });
  assert.notEqual(review, null);
  const lanes = pushLanes({
    queue: { available: true, counts: { pending: 11, next: 0, ready: 0 } },
  });
  assert.notEqual(lanes, null);
});
