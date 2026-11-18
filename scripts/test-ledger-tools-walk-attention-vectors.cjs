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
  D: FRESHNESS_DAY,
  LedgerToolsPlugin: FreshnessLedgerToolsPlugin,
  makeFreshnessApp,
  makeFreshnessTask,
  withMissingConfig,
} = require("./ledger-tools-harness.cjs");

const {
  bankWalkBuildEntries,
  defaultPlanCaps,
  laneWalkQueueFromTasks,
  walkerFooterPushBankAttention,
  walkerFooterPushLaneAttention,
  walkerFooterPushReviewAttention,
  walkerFooterReviewAttentionLabel,
  walkerFooterReviewView,
} = helpers;

const DAY = new Date(2026, 9, 28);
const REVIEW_TIERS = [
  "pre", "new", "projects", "pending", "next", "recurring", "tickler", "rotten", "post",
];
const [REVIEW_YEAR, REVIEW_MONTH, REVIEW_DAY_OF_MONTH] = FRESHNESS_DAY
  .split("-")
  .map(Number);
const REVIEW_NOW = new Date(REVIEW_YEAR, REVIEW_MONTH - 1, REVIEW_DAY_OF_MONTH, 12);

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

function reviewMemo(byTier = {}, tasksAvailable = true) {
  const normalized = Object.fromEntries(
    REVIEW_TIERS.map((tier) => [tier, Number(byTier[tier]) || 0]),
  );
  const queue = REVIEW_TIERS.flatMap((tier) =>
    Array.from({ length: normalized[tier] }, () => ({ tier })),
  );
  return {
    counts: { byTier: normalized, walk: queue.length },
    queue,
    tasksAvailable,
  };
}

function freshnessTaskForTier(tier, index = 0) {
  const name = `${tier}-${index + 1}`;
  const base = {
    path: `notes/review-${name}.md`,
    lineNumber: 0,
    description: `${tier} review fixture`,
  };
  switch (tier) {
    case "pre":
    case "post":
      return makeFreshnessTask({
        ...base,
        tags: ["#gtd", `#${tier}`],
        originalMarkdown: `- [ ] #gtd #${tier} ${name}`,
      });
    case "projects":
      return makeFreshnessTask({
        ...base,
        tags: ["#prj"],
        blockLink: " ^prj",
        originalMarkdown: `- [ ] #prj ${name}`,
      });
    case "pending":
      return makeFreshnessTask({
        ...base,
        status: { type: "IN_PROGRESS", name: "In Progress", symbol: "/" },
        originalMarkdown: `- [/] #task ${name}`,
      });
    case "next":
      return makeFreshnessTask({
        ...base,
        status: { type: "ON_HOLD", name: "Next", symbol: "*" },
        originalMarkdown: `- [*] #task ${name}`,
      });
    case "recurring":
      return makeFreshnessTask({
        ...base,
        recurrence: "every day",
        scheduledDate: FRESHNESS_DAY,
        originalMarkdown:
          `- [ ] #task ${name} [repeat:: every day] [scheduled:: ${FRESHNESS_DAY}]`,
      });
    case "tickler":
      return makeFreshnessTask({
        ...base,
        originalMarkdown:
          `- [ ] #task ${name} [fresh:: 2026-10-06] [scheduled:: 2026-10-07]`,
      });
    case "rotten":
      return makeFreshnessTask({
        ...base,
        originalMarkdown: `- [ ] #task ${name} [fresh:: 2026-10-01]`,
      });
    case "new":
      return makeFreshnessTask({
        ...base,
        originalMarkdown: `- [ ] #task ${name}`,
      });
    default:
      throw new Error(`Unknown review tier: ${tier}`);
  }
}

function productionReviewMemo(tiers) {
  const occurrences = new Map();
  const tasks = tiers === null
    ? null
    : tiers.map((tier) => {
      const index = occurrences.get(tier) || 0;
      occurrences.set(tier, index + 1);
      return freshnessTaskForTier(tier, index);
    });
  return withMissingConfig(() => {
    const plugin = new FreshnessLedgerToolsPlugin(makeFreshnessApp({ tasks }), {});
    plugin.onload();
    try {
      return plugin.freshnessEnsureMemo(REVIEW_NOW);
    } finally {
      plugin.onunload();
    }
  });
}

function pushReview({ mode = "w", byTier = {}, memo = null } = {}) {
  const { plugin, calls } = pushPlugin(mode);
  walkerFooterPushReviewAttention(
    plugin,
    { legacy: false, mode },
    memo || reviewMemo(byTier),
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

test("S1: only ROTTEN due lights s and uses the ROTTEN hue", () => {
  const value = pushReview({ byTier: { rotten: 1 } });
  assert.equal(value.tier, "rotten");
  assert.equal(stripClickHint(value.label), "Review: 1 due · commitments done — ROTTEN first");
});

test("S2: only POST due lights s and uses the POST hue", () => {
  const value = pushReview({ byTier: { post: 1 } });
  assert.equal(value.tier, "post");
  assert.equal(stripClickHint(value.label), "Review: 1 due · commitments done — POST first");
});

test("S3: NEW 1 and ROTTEN 1 lights s with tier new", () => {
  const value = pushReview({ byTier: { new: 1, rotten: 1 }, walk: 2 });
  assert.notEqual(value, null);
  assert.equal(value.tier, "new");
  assert.equal(
    stripClickHint(value.label),
    "Review: 2 due · 1 commitment — NEW first",
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

test("S6: ROTTEN then POST counts every row and enters ROTTEN", () => {
  const value = pushReview({ byTier: { rotten: 2, post: 1 } });
  assert.equal(value.tier, "rotten");
  assert.equal(stripClickHint(value.label), "Review: 3 due · commitments done — ROTTEN first");
});

test("S7: an empty walk clears s", () => {
  assert.equal(pushReview({}), null);
});

test("review labels distinguish singular, plural, and completed commitments", () => {
  assert.equal(walkerFooterReviewAttentionLabel(3, 1, "NEXT"), "Review: 3 due · 1 commitment — NEXT first");
  assert.equal(walkerFooterReviewAttentionLabel(3, 3, "PRE"), "Review: 3 due · 3 commitments — PRE first");
  assert.equal(walkerFooterReviewAttentionLabel(2, 0, "POST"), "Review: 2 due · commitments done — POST first");
});

test("s attention matches the review footer's non-clear walk across tier fixtures", () => {
  const fixtures = [
    { rotten: 1 },
    { post: 1 },
    { new: 1, rotten: 1 },
    { pre: 1, next: 2 },
    { tickler: 2 },
    { rotten: 2, post: 1 },
    {},
  ];
  for (const byTier of fixtures) {
    const memo = reviewMemo(byTier);
    assert.equal(memo.counts.walk, memo.queue.length);
    const attention = pushReview({ memo });
    const view = walkerFooterReviewView(memo, { navAvailable: true });
    assert.equal(attention !== null, view.mode !== "clear", JSON.stringify(byTier));
  }
});

test("production memo counts, tier order, attention, and labels match all review fixtures", () => {
  const fixtures = [
    { name: "PRE alone", tiers: ["pre"], label: "Review: 1 due · 1 commitment — PRE first" },
    { name: "NEW alone", tiers: ["new"], label: "Review: 1 due · 1 commitment — NEW first" },
    { name: "PROJECTS alone", tiers: ["projects"], label: "Review: 1 due · 1 commitment — PROJECTS first" },
    { name: "PENDING alone", tiers: ["pending"], label: "Review: 1 due · 1 commitment — WIP first" },
    { name: "NEXT alone", tiers: ["next"], label: "Review: 1 due · 1 commitment — NEXT first" },
    { name: "RECURRING alone", tiers: ["recurring"], label: "Review: 1 due · 1 commitment — RECUR first" },
    { name: "TICKLER alone", tiers: ["tickler"], label: "Review: 1 due · 1 commitment — TICKS first" },
    { name: "ROTTEN alone", tiers: ["rotten"], label: "Review: 1 due · commitments done — ROTTEN first" },
    { name: "POST alone", tiers: ["post"], label: "Review: 1 due · commitments done — POST first" },
    { name: "S1", tiers: ["rotten"], label: "Review: 1 due · commitments done — ROTTEN first" },
    { name: "S2", tiers: ["post"], label: "Review: 1 due · commitments done — POST first" },
    { name: "S3", tiers: ["new", "rotten"], label: "Review: 2 due · 1 commitment — NEW first" },
    { name: "S4", tiers: ["pre", "next", "next"], label: "Review: 3 due · 3 commitments — PRE first" },
    { name: "S5", tiers: ["tickler", "tickler"], label: "Review: 2 due · 2 commitments — TICKS first" },
    { name: "S6", tiers: ["rotten", "rotten", "post"], label: "Review: 3 due · commitments done — ROTTEN first" },
    { name: "S7", tiers: [], label: null },
  ];

  for (const fixture of fixtures) {
    const memo = productionReviewMemo(fixture.tiers);
    const expectedTiers = fixture.tiers;
    assert.equal(memo.tasksAvailable, true, `${fixture.name}: tasks available`);
    assert.equal(memo.dateText, FRESHNESS_DAY, `${fixture.name}: pinned local date`);
    assert.equal(memo.counts.walk, memo.queue.length, `${fixture.name}: memo count matches real queue`);
    assert.equal(memo.counts.walk, expectedTiers.length, `${fixture.name}: expected fixture count`);
    assert.deepEqual(
      memo.queue.map((entry) => entry.tier),
      expectedTiers,
      `${fixture.name}: production queue tier order`,
    );

    const view = walkerFooterReviewView(memo, { navAvailable: true });
    assert.equal(view.mode === "clear", expectedTiers.length === 0, `${fixture.name}: footer clear state`);
    for (const mode of ["s", "w"]) {
      const value = pushReview({ mode, memo });
      assert.equal(
        value !== null,
        view.mode !== "clear",
        `${fixture.name}: ${mode} attention follows footer state`,
      );
      if (fixture.label !== null) {
        assert.equal(value.tier, expectedTiers[0], `${fixture.name}: first tier`);
        assert.equal(
          value.label,
          mode === "s" ? fixture.label : `${fixture.label}; click to show`,
          `${fixture.name}: ${mode} label`,
        );
      }
    }
  }
});

test("unavailable Tasks data clears s and stays distinct from an available empty walk", () => {
  const unavailable = productionReviewMemo(null);
  const unavailableView = walkerFooterReviewView(unavailable, { navAvailable: true });
  assert.equal(unavailable.tasksAvailable, false);
  assert.equal(unavailable.queue.length, 0);
  assert.equal(unavailableView.mode, "hidden");
  assert.equal(pushReview({ memo: unavailable }), null);

  const empty = productionReviewMemo([]);
  const emptyView = walkerFooterReviewView(empty, { navAvailable: true });
  assert.equal(empty.tasksAvailable, true);
  assert.equal(emptyView.mode, "clear");
  assert.equal(pushReview({ memo: empty }), null);
});

test("s stays off when a positive walk count has no known tier", () => {
  const memo = { counts: { walk: 1, byTier: {} }, queue: [{}], tasksAvailable: true };
  assert.equal(pushReview({ memo }), null);
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
