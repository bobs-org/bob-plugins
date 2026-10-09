const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
} = require("./task-status-cycler-harness.cjs");

// Pure successor-link helpers (docs/task-dependencies.md §11.6 SL vectors,
// §11.7 SB vectors, §12). The cycler suite runs every SL vector expressible
// without a vault: SL2 needs `!` retirement, SL20 needs the capture batch
// post-pass, and SL21's cancel/reopen/raw-checkbox/hooks cases (like SL22,
// Ctrl+Enter on a Depends-On line) never reach the pure helpers — the wiring
// owns them by never invoking the planner there.

const TODAY = "2026-10-09";
const DAILY_PATH = "2026/20261009.md";

function planFixture({ day, notes, closed, options = {} }) {
  const documents = Object.entries(notes).map(([path, text]) => ({
    path,
    text,
  }));
  const tasks = helpers.tasksFromDocuments(documents);
  const index = helpers.buildDependentsIndex(tasks);
  const plan = helpers.planSuccessors({
    closed,
    index,
    dailyBefore: day,
    dailyPath: DAILY_PATH,
    today: TODAY,
    linkUnblocked: true,
    basenameCounts: { sase: 1 },
    noteTexts: notes,
    ...options,
  });
  return { documents, tasks, index, plan };
}

const FIX_DAY = [
  "# 2026-10-09",
  "",
  "## Pomodoros",
  "- [ ] () — FIX",
  "\t- [[sase#^fix-apollo]]",
].join("\n");

const FIX_CLOSED = [
  {
    path: "sase.md",
    blockId: "fix-apollo",
    taskId: "sase__fix-apollo",
    text: "Fix apollo machine!",
  },
];

function saseNotes(dependentLine) {
  return {
    "sase.md": [
      "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      dependentLine,
    ].join("\n"),
  };
}

const RELAUNCH_LINE =
  "- [?] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-agents";

// --- SB vectors (§11.7, verbatim) ---

function sbMint(rawLine, usedIds) {
  const body = rawLine.includes("] ")
    ? rawLine.slice(rawLine.indexOf("] ") + 2)
    : rawLine;
  return helpers.mintBlockId(
    helpers.cleanDescription(body, "#task"),
    usedIds,
  );
}

test("SB vectors pin the successor mint pipeline", () => {
  const cases = [
    ["SB1", "- [?] #task Renew the library books", [], "renew-library-books"],
    ["SB2", "- [?] #task Fix apollo machine", [], "fix-apollo-machine"],
    [
      "SB3",
      "- [?] #task Add support for new `%hold` directive",
      [],
      "hold",
    ],
    [
      "SB4",
      "- [?] #task Review [[sase#^fix-apollo|apollo fix]] notes",
      [],
      "apollo-fix",
    ],
    [
      "SB5",
      "- [?] #task Book flights [scheduled:: 2026-10-13] #task",
      [],
      "book-flights",
    ],
    [
      "SB6",
      "- [?] #task Book flights [scheduled:: 2026-10-13] #task",
      ["book-flights"],
      "book-flights-2",
    ],
    [
      "SB7",
      "- [?] #task Fix it",
      ["fix", "fix-2", "fix-3", "fix-4", "fix-5", "fix-6", "fix-7", "fix-8", "fix-9"],
      "task",
    ],
    ["SB8", "- [?] #task é🚀", [], "task"],
    ["SB9", "- [?] #task é🚀", ["task", "task-2"], "task-3"],
  ];
  for (const [id, rawLine, usedIds, expected] of cases) {
    assert.equal(sbMint(rawLine, usedIds), expected, id);
  }
});

test("successor suggester ports the Rust candidate and suffix rules", () => {
  // Leading verb yields the verb-less third candidate; taken names walk -2.
  assert.deepEqual(
    helpers.suggestSuccessorIds("Fix apollo machine", []),
    ["fix-apollo-machine", "apollo-machine"],
  );
  assert.deepEqual(
    helpers.suggestSuccessorIds("Fix apollo machine", ["fix-apollo-machine"]),
    ["fix-apollo-machine-2", "apollo-machine"],
  );
  // All suggestions and every -2…-9 suffix taken mints nothing.
  assert.deepEqual(helpers.suggestSuccessorIds("Fix it", [
    "fix",
    "fix-2",
    "fix-3",
    "fix-4",
    "fix-5",
    "fix-6",
    "fix-7",
    "fix-8",
    "fix-9",
  ]), []);
  // A 32-character cut never splits a word; over-long single words fail.
  assert.equal(
    helpers.successorJoinTruncated(["aaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbb"], "^"),
    "aaaa",
  );
  assert.equal(
    helpers.successorJoinTruncated(["a".repeat(40)], "^"),
    null,
  );
  assert.equal(helpers.isValidSuccessorBlockId("ok-1"), true);
  assert.equal(helpers.isValidSuccessorBlockId("no_underscore"), false);
});

test("successor link form names unique basenames short and the day file always", () => {
  assert.equal(
    helpers.successorLinkText("sase.md", "relaunch-agents", DAILY_PATH, { sase: 1 }),
    "[[sase#^relaunch-agents]]",
  );
  assert.equal(
    helpers.successorLinkText("b/dup.md", "deep", DAILY_PATH, { dup: 2 }),
    "[[b/dup#^deep]]",
  );
  assert.equal(
    helpers.successorLinkText(DAILY_PATH, "today-task", DAILY_PATH, { 20261009: 1 }),
    "[[20261009#^today-task]]",
  );
});

// --- Normalizers and index ---

test("tasksFromDocuments normalizes vault lines to pool shape", () => {
  const tasks = helpers.tasksFromDocuments([
    {
      path: "sase.md",
      text: [
        "- [?] #task Fix it [id:: fix] ^fix",
        "- [?] #task Later [dependsOn:: fix] [scheduled:: 2026-10-13] ^later",
      ].join("\n"),
    },
  ]);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].taskId, "fix");
  assert.equal(tasks[0].blockId, "fix");
  assert.deepEqual(tasks[0].dependsOn, []);
  assert.deepEqual(tasks[1].dependsOn, ["fix"]);
  assert.equal(tasks[1].scheduled, "2026-10-13");
  assert.equal(tasks[1].status, "?");
});

test("normalizeTasksCacheTask ports every known Tasks shape", () => {
  assert.equal(helpers.normalizeTasksCacheTask(null), null);
  assert.equal(helpers.normalizeTasksCacheTask({}), null);
  const full = helpers.normalizeTasksCacheTask({
    taskLocation: { path: "s.md", lineNumber: 4 },
    status: { symbol: "?" },
    originalMarkdown: "- [?] #task T [id:: a] ^b",
    id: "a",
    dependsOn: ["x", "  ", null],
  });
  assert.equal(full.path, "s.md");
  assert.equal(full.line, 4);
  assert.equal(full.status, "?");
  assert.equal(full.blockId, "b");
  assert.equal(full.taskId, "a");
  assert.deepEqual(full.dependsOn, ["x"]);
  const legacy = helpers.normalizeTasksCacheTask({
    path: "t.md",
    status: "*",
    text: "Plain",
    hidden: true,
  });
  assert.equal(legacy.line, -1);
  assert.equal(legacy.rawLine, null);
  assert.equal(legacy.hidden, true);
  assert.equal(legacy.scheduled, null);
});

test("buildDependentsIndex keeps first task IDs and groups dependents", () => {
  const index = helpers.buildDependentsIndex([
    { path: "a.md", line: 0, status: "?", taskId: "p", dependsOn: [] },
    { path: "a.md", line: 1, status: "?", taskId: "p", dependsOn: [] },
    { path: "b.md", line: 2, status: "?", taskId: null, dependsOn: ["p"] },
  ]);
  assert.equal(index.byTaskId.get("p").line, 0);
  assert.equal(index.byDependsOn.get("p").length, 1);
  assert.equal(index.tasks.length, 3);
});

// --- Live links and anchors ---

test("findLiveLinks counts plain, embedded, and deferred links under open entries only", () => {
  const day = [
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^a]]",
    "\t- ![[sase#^b]]",
    "\t- [[sase#^c]]#",
    "\t- ~~[[sase#^struck]]~~",
    "\t- ⛓️ **DEPENDS ON:** [[sase#^a]]",
    "- [x] (10:00-10:20) — OLD",
    "\t- [[sase#^old]]",
  ].join("\n");
  const entries = helpers.findLiveLinks(day);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].open, true);
  assert.deepEqual(
    entries[0].links.map((link) => link.blockId),
    ["a", "b", "c"],
  );
  assert.equal(entries[0].links[1].embedded, true);
  assert.equal(entries[1].open, false);
  assert.deepEqual(entries[1].links, []);
});

test("computeSuccessorAnchors implements closing, slot, inherit, and none", () => {
  const day = [
    "## Pomodoros",
    "- [ ] (10:00-10:20) — BOB",
    "\t- [[sase#^root]]",
    "- [ ] () — FIX",
    "\t- [[sase#^fix-apollo]]",
  ].join("\n");
  const anchors = helpers.computeSuccessorAnchors(
    [
      { path: "sase.md", blockId: "fix-apollo", taskId: "t1" },
      { path: "sase.md", blockId: "sub", taskId: "t2", rootKey: { path: "sase.md", blockId: "root" } },
      { path: "sase.md", blockId: "ghost", taskId: "t3" },
    ],
    day,
    { dailyPath: DAILY_PATH },
  );
  // fix-apollo's own link is not under BOB, so it slots at its FIX bullet.
  assert.deepEqual(anchors[0], { kind: "slot", entryLine: 3, bulletLine: 4 });
  assert.deepEqual(anchors[1], { kind: "inherit", entryLine: 1, bulletLine: 2 });
  assert.deepEqual(anchors[2], { kind: "none", entryLine: null, bulletLine: null });
  const closing = helpers.computeSuccessorAnchors(
    [{ path: "sase.md", blockId: "root", taskId: "t0" }],
    day,
    { closingEntry: 1, dailyPath: DAILY_PATH },
  );
  assert.deepEqual(closing[0], { kind: "closing", entryLine: 1, bulletLine: null });
});

// --- SL vectors (§11.6) ---

test("SL1 links the successor right after the predecessor bullet", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked_check, "checked");
  assert.equal(plan.still_blocked.length, 0);
  assert.equal(plan.unblocked.length, 1);
  const row = plan.unblocked[0];
  assert.equal(row.note_path, "sase.md");
  assert.equal(row.block_id, "relaunch-agents");
  assert.equal(row.previous_status_symbol, "?");
  assert.equal(row.status_symbol, "*");
  assert.equal(row.status_name, "Next");
  assert.equal(row.inbox, false);
  assert.deepEqual(row.unblocked_by, [
    { note_path: "sase.md", block_id: "fix-apollo", text: "Fix apollo machine!" },
  ]);
  assert.equal(row.not_linked, null);
  assert.equal(row.link.block_link, "[[sase#^relaunch-agents]]");
  assert.equal(row.link.block_id_created, false);
  assert.equal(row.link.day_file, DAILY_PATH);
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0].path, "sase.md");
  assert.match(plan.edits[0].after, /^- \[\*\] #task Re-launch/);
  assert.equal(plan.placements.length, 1);
  assert.deepEqual(plan.placements[0].anchor, {
    kind: "slot",
    entryLine: 3,
    bulletLine: 4,
  });

  const inserted = helpers.planSuccessorInsertions(
    FIX_DAY,
    plan.placements,
    {},
  );
  assert.deepEqual(inserted.skipped, []);
  assert.equal(
    inserted.text,
    [
      "# 2026-10-09",
      "",
      "## Pomodoros",
      "- [ ] () — FIX",
      "\t- [[sase#^fix-apollo]]",
      "\t- [[sase#^relaunch-agents]]",
    ].join("\n"),
  );
  assert.equal(inserted.links.length, 1);
  assert.equal(inserted.links[0].entry_name, "FIX");
  assert.equal(inserted.links[0].entry_line, 4);
  assert.equal(inserted.links[0].line, 6);
  assert.equal(inserted.links[0].entry_created, false);
  // Applying the splices in order reproduces the text.
  const applied = FIX_DAY.split("\n");
  let shift = 0;
  for (const splice of inserted.splices) {
    applied.splice(splice.at + shift, splice.deleteCount, ...splice.lines);
    shift += splice.lines.length - splice.deleteCount;
  }
  assert.equal(applied.join("\n"), inserted.text);
});

test("SL3 still-blocked rows count the open prerequisites left", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
        "- [?] #task Other work [id:: sase__other] ^other",
        "- [?] #task Needs both [dependsOn:: sase__fix-apollo, sase__other] ^both",
      ].join("\n"),
    },
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 0);
  assert.equal(plan.placements.length, 0);
  assert.equal(plan.still_blocked.length, 1);
  assert.deepEqual(plan.still_blocked[0].reason, "waits_on");
  assert.equal(plan.still_blocked[0].waits_on, 1);
  assert.equal(plan.still_blocked[0].scheduled, null);
  assert.equal(plan.edits.length, 0);
});

test("SL4 future-scheduled dependents stay Blocked with the date row", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: saseNotes(
      "- [?] #task Book flights [dependsOn:: sase__fix-apollo] [scheduled:: 2026-10-13] ^book-flights",
    ),
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 0);
  assert.equal(plan.still_blocked.length, 1);
  assert.equal(plan.still_blocked[0].reason, "scheduled");
  assert.equal(plan.still_blocked[0].scheduled, "2026-10-13");
  assert.equal(plan.still_blocked[0].waits_on, 0);
  assert.equal(plan.edits.length, 0);
});

test("SL5 already-planned dependents recover without a duplicate link", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^fix-apollo]]",
    "- [ ] () — SASE",
    "\t- [[sase#^relaunch-agents]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].not_linked, "already_planned");
  assert.equal(plan.unblocked[0].status_symbol, "*");
  assert.equal(plan.unblocked[0].link, null);
  assert.equal(plan.placements.length, 0);
  const inserted = helpers.planSuccessorInsertions(day, plan.placements, {});
  assert.equal(inserted.text, day);
});

test("SL6 struck and closed-entry links do not count as planned", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^fix-apollo]]",
    "\t- ~~[[sase#^relaunch-agents]]~~",
    "- [x] (10:00-10:20) — OLD",
    "\t- [[sase#^relaunch-agents]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].not_linked, null);
  assert.ok(plan.unblocked[0].link);
});

test("SL7 closing anchors create the continuation placeholder", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] (10:00-10:20) — BOB",
    "\t- [[sase#^fix-apollo]]",
    "- [ ] () — FIX",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
    options: { closingEntry: 3 },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.deepEqual(plan.placements[0].anchor, {
    kind: "closing",
    entryLine: 3,
    bulletLine: null,
  });
  const inserted = helpers.planSuccessorInsertions(day, plan.placements, {
    closingEntry: 3,
  });
  assert.equal(
    inserted.text,
    [
      "# 2026-10-09",
      "",
      "## Pomodoros",
      "- [ ] (10:00-10:20) — BOB",
      "\t- [[sase#^fix-apollo]]",
      "- [ ] () — BOB",
      "\t- [[sase#^relaunch-agents]]",
      "- [ ] () — FIX",
    ].join("\n"),
  );
  assert.equal(inserted.links[0].entry_name, "BOB");
  assert.equal(inserted.links[0].entry_created, true);
  assert.equal(inserted.links[0].next_up, true);
});

test("SL8 closing anchors append after carried lines in the continuation", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] (10:00-10:20) — BOB",
    "\t- [[sase#^fix-apollo]]",
    "- [ ] () — BOB",
    "\t- carried work",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
    options: { closingEntry: 3 },
  });
  const inserted = helpers.planSuccessorInsertions(day, plan.placements, {
    closingEntry: 3,
    createdEntry: { line: 5 },
  });
  assert.equal(
    inserted.text,
    [
      "# 2026-10-09",
      "",
      "## Pomodoros",
      "- [ ] (10:00-10:20) — BOB",
      "\t- [[sase#^fix-apollo]]",
      "- [ ] () — BOB",
      "\t- carried work",
      "\t- [[sase#^relaunch-agents]]",
    ].join("\n"),
  );
  assert.equal(inserted.links[0].entry_created, true);
});

test("SL9 unplanned predecessors recover without touching the ledger", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[other#^unrelated]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].not_linked, "not_planned_today");
  assert.equal(plan.unblocked[0].status_symbol, " ");
  assert.equal(plan.placements.length, 0);
  const inserted = helpers.planSuccessorInsertions(day, plan.placements, {});
  assert.equal(inserted.text, day);
});

test("SL10 missing block IDs mint through the SB rule", () => {
  const dependent =
    "- [?] #task Renew the library books [dependsOn:: sase__fix-apollo]";
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: saseNotes(dependent),
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  const row = plan.unblocked[0];
  assert.equal(row.block_id, "renew-library-books");
  assert.equal(row.link.block_id_created, true);
  assert.equal(row.link.block_link, "[[sase#^renew-library-books]]");
  assert.match(plan.edits[0].after, /\^renew-library-books$/);
});

test("SL11 project and hidden tasks recover but never link", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
        "- [?] #task Ship the project [dependsOn:: sase__fix-apollo] ^prj",
        "- [?] #task Secret chore [dependsOn:: sase__fix-apollo] #hide ^secret",
      ].join("\n"),
    },
    closed: FIX_CLOSED,
  });
  assert.equal(plan.placements.length, 0);
  assert.deepEqual(
    plan.unblocked.map((row) => row.not_linked).sort(),
    ["hidden", "project_task"],
  );
  for (const row of plan.unblocked) {
    assert.equal(row.link, null);
    assert.equal(row.status_symbol, " ");
  }
});

test("SL12 one gesture closing two prerequisites links once with both causes", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^p1]]",
    "- [ ] () — SASE",
    "\t- [[sase#^p2]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: {
      "sase.md": [
        "- [?] #task First [id:: t1] ^p1",
        "- [?] #task Second [id:: t2] ^p2",
        "- [?] #task Needs both [dependsOn:: t1, t2] ^both",
      ].join("\n"),
    },
    closed: [
      { path: "sase.md", blockId: "p1", taskId: "t1", text: "First" },
      { path: "sase.md", blockId: "p2", taskId: "t2", text: "Second" },
    ],
  });
  assert.equal(plan.unblocked.length, 1);
  assert.deepEqual(
    plan.unblocked[0].unblocked_by.map((pred) => pred.block_id),
    ["p1", "p2"],
  );
  assert.deepEqual(plan.placements[0].anchor, {
    kind: "slot",
    entryLine: 3,
    bulletLine: 4,
  });
});

test("SL13 chains do not recurse: the dependent's own dependents wait", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
        "- [?] #task Middle [id:: sase__mid] [dependsOn:: sase__fix-apollo] ^mid",
        "- [?] #task End [dependsOn:: sase__mid] ^end",
      ].join("\n"),
    },
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].block_id, "mid");
});

test("SL14 ambiguous basenames link long", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      ].join("\n"),
      "b/dup.md": [
        "- [?] #task Deep work [dependsOn:: sase__fix-apollo] ^deep",
      ].join("\n"),
    },
    closed: FIX_CLOSED,
    options: { basenameCounts: { sase: 1, dup: 2 } },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].link.block_link, "[[b/dup#^deep]]");
});

test("SL15 stale open dependents link and become Next", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: saseNotes(
      "- [ ] #task Stale but unblocked [dependsOn:: sase__fix-apollo] ^stale",
    ),
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].previous_status_symbol, " ");
  assert.equal(plan.unblocked[0].status_symbol, "*");
  assert.ok(plan.unblocked[0].link);
});

test("SL16 gates on [id::]: no identity means no lookup and empty rows", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: saseNotes(RELAUNCH_LINE),
    closed: [{ path: "sase.md", blockId: "fix-apollo", text: "Fix apollo machine!" }],
  });
  assert.equal(plan.unblocked_check, "checked");
  assert.deepEqual(plan.unblocked, []);
  assert.deepEqual(plan.still_blocked, []);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.placements, []);
});

test("SL17 breakers link nothing and recover every successor", () => {
  const dependents = [];
  for (let n = 1; n <= 6; n += 1) {
    dependents.push(
      `- [?] #task Follower ${n} [dependsOn:: sase__fix-apollo] ^follower-${n}`,
    );
  }
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
        ...dependents,
      ].join("\n"),
    },
    closed: FIX_CLOSED,
  });
  assert.equal(plan.unblocked.length, 6);
  for (const row of plan.unblocked) {
    assert.equal(row.not_linked, "breaker");
    assert.equal(row.link, null);
    assert.equal(row.status_symbol, " ");
  }
  assert.equal(plan.placements.length, 0);
  assert.equal(plan.edits.length, 6);
});

test("SL18 the kill switch recovers without linking or minting", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: saseNotes(
      "- [?] #task Renew the library books [dependsOn:: sase__fix-apollo]",
    ),
    closed: FIX_CLOSED,
    options: { linkUnblocked: false },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].not_linked, "disabled");
  assert.equal(plan.unblocked[0].block_id, "");
  assert.equal(plan.unblocked[0].link, null);
  assert.equal(plan.placements.length, 0);
});

test("SL19 re-applied closes write nothing and report nothing", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: saseNotes(RELAUNCH_LINE),
    closed: [],
  });
  assert.equal(plan.unblocked_check, "checked");
  assert.deepEqual(plan.unblocked, []);
  assert.deepEqual(plan.still_blocked, []);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.placements, []);
});

test("SL23 subtasks anchor at their root's link", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- ![[sase#^root]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: {
      "sase.md": [
        "- [?] #task Root [id:: t-root] ^root",
        "- [?] #task Sub part [id:: t-sub] ^sub",
        "- [?] #task Follows sub [dependsOn:: t-sub] ^follows",
      ].join("\n"),
    },
    closed: [
      {
        path: "sase.md",
        blockId: "sub",
        taskId: "t-sub",
        text: "Sub part",
        rootKey: { path: "sase.md", blockId: "root" },
      },
    ],
  });
  assert.equal(plan.unblocked.length, 1);
  assert.deepEqual(plan.placements[0].anchor, {
    kind: "inherit",
    entryLine: 3,
    bulletLine: 4,
  });
});

test("SL24 later same-name entries take the closing successors", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] (10:00-10:20) — BOB",
    "\t- [[sase#^fix-apollo]]",
    "- [ ] () — FIX",
    "- [ ] () — BOB",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
    options: { closingEntry: 3 },
  });
  const inserted = helpers.planSuccessorInsertions(day, plan.placements, {
    closingEntry: 3,
  });
  assert.equal(
    inserted.text,
    [
      "# 2026-10-09",
      "",
      "## Pomodoros",
      "- [ ] (10:00-10:20) — BOB",
      "\t- [[sase#^fix-apollo]]",
      "- [ ] () — FIX",
      "- [ ] () — BOB",
      "\t- [[sase#^relaunch-agents]]",
    ].join("\n"),
  );
  assert.equal(inserted.links[0].entry_created, false);
  assert.equal(inserted.links[0].entry_name, "BOB");
  assert.equal(inserted.links[0].next_up, false);
});

test("SL25 already-Next planned dependents produce no row", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^fix-apollo]]",
    "- [ ] () — SASE",
    "\t- [[sase#^relaunch-agents]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: saseNotes(
      "- [*] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-agents",
    ),
    closed: FIX_CLOSED,
  });
  assert.deepEqual(plan.unblocked, []);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.placements, []);
});

test("SL26 inbox successors carry the inbox flag", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      ].join("\n"),
      "inbox.md": [
        "- [?] #task Triage this [dependsOn:: sase__fix-apollo] ^triage",
      ].join("\n"),
    },
    closed: FIX_CLOSED,
    options: { basenameCounts: { sase: 1, inbox: 1 } },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].inbox, true);
  assert.equal(plan.unblocked[0].link.block_link, "[[inbox#^triage]]");
});

test("SL27 dropped links are never re-linked and recover to Ready", () => {
  const before = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^fix-apollo]]",
    "\t- [[sase#^relaunch-agents]]",
  ].join("\n");
  const after = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^fix-apollo]]",
  ].join("\n");
  const { plan } = planFixture({
    day: before,
    notes: saseNotes(RELAUNCH_LINE),
    closed: FIX_CLOSED,
    options: { dailyAfter: after },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].not_linked, "already_planned");
  assert.equal(plan.unblocked[0].status_symbol, " ");
  assert.equal(plan.placements.length, 0);
});

test("SL28 day-file successors name the note, never the bare link", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      ].join("\n"),
      [DAILY_PATH]: [
        "- [?] #task Log today [dependsOn:: sase__fix-apollo] ^log-today",
      ].join("\n"),
    },
    closed: FIX_CLOSED,
    options: { basenameCounts: { sase: 1, 20261009: 1 } },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].link.block_link, "[[20261009#^log-today]]");
});

// --- Insertion edges ---

test("slot insertions land after the anchor subtree with its indent", () => {
  const day = [
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^fix-apollo]]",
    "\t\t- a child note",
    "\t- [[other#^x]]",
  ].join("\n");
  const inserted = helpers.planSuccessorInsertions(
    day,
    [
      { key: "k", rowIndex: 0, anchor: { kind: "slot", entryLine: 1, bulletLine: 2 }, blockLink: "[[sase#^new]]" },
    ],
    {},
  );
  assert.equal(
    inserted.text,
    [
      "## Pomodoros",
      "- [ ] () — FIX",
      "\t- [[sase#^fix-apollo]]",
      "\t\t- a child note",
      "\t- [[sase#^new]]",
      "\t- [[other#^x]]",
    ].join("\n"),
  );
  assert.equal(inserted.links[0].line, 5);
});

test("closing insertions replace a lone stub child", () => {
  const day = [
    "## Pomodoros",
    "- [ ] (10:00-10:20) — BOB",
    "\t- [[sase#^fix-apollo]]",
    "- [ ] () — BOB",
    "\t- ",
  ].join("\n");
  const inserted = helpers.planSuccessorInsertions(
    day,
    [
      { key: "k", rowIndex: 0, anchor: { kind: "closing", entryLine: 1, bulletLine: null }, blockLink: "[[sase#^new]]" },
    ],
    { closingEntry: 1, createdEntry: { line: 3 } },
  );
  assert.equal(
    inserted.text,
    [
      "## Pomodoros",
      "- [ ] (10:00-10:20) — BOB",
      "\t- [[sase#^fix-apollo]]",
      "- [ ] () — BOB",
      "\t- [[sase#^new]]",
    ].join("\n"),
  );
  assert.equal(inserted.links[0].entry_created, true);
});

test("insertions skip placements with no valid target", () => {
  const inserted = helpers.planSuccessorInsertions(
    "## Pomodoros\n- [ ] () — FIX",
    [
      { key: "k", rowIndex: 0, anchor: { kind: "slot", entryLine: 1, bulletLine: 99 }, blockLink: "[[sase#^new]]" },
    ],
    {},
  );
  assert.equal(inserted.links.length, 0);
  assert.equal(inserted.skipped.length, 1);
  assert.equal(inserted.skipped[0].reason, "no-anchor-bullet");
});

// --- Notice text (§12.6 table) ---

function noticeRow(overrides = {}) {
  return {
    text: "Re-launch all failed agents on apollo!",
    status_symbol: "*",
    status_name: "Next",
    link: null,
    not_linked: null,
    ...overrides,
  };
}

test("successorNoticeText implements the §12.6 table", () => {
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [{ text: "Fix apollo machine!" }],
      unblocked: [noticeRow({ link: { entry_name: "FIX", entry_created: false, line: 6 } })],
      still_blocked: [],
      failure: null,
    }),
    "🔓 Next in FIX: Re-launch all failed agents on apollo!",
  );
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [],
      unblocked: [
        noticeRow({ text: "Review memory beads", link: { entry_name: "SASE", entry_created: false, line: 1 } }),
        noticeRow({ text: "Ship AGENTS.md", link: { entry_name: "SASE", entry_created: false, line: 2 } }),
        noticeRow({ text: "Third thing", link: { entry_name: "SASE", entry_created: false, line: 3 } }),
      ],
      still_blocked: [],
      failure: null,
    }),
    "🔓 3 linked → SASE: Review memory beads, Ship AGENTS.md, +1",
  );
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [],
      unblocked: [
        noticeRow({ link: { entry_name: "FIX", entry_created: false, line: 1 } }),
        noticeRow({ link: { entry_name: "SASE", entry_created: false, line: 2 } }),
      ],
      still_blocked: [],
      failure: null,
    }),
    "🔓 2 linked · FIX, SASE",
  );
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [],
      unblocked: [
        noticeRow({
          text: "Re-launch all failed agents on apollo right now, please!",
          link: { entry_name: "BOB", entry_created: true, line: 6 },
        }),
      ],
      still_blocked: [],
      failure: null,
    }),
    "🔓 Next in new BOB session (next up): Re-launch all failed agents on apollo right now,…",
  );
  const breakerRows = [];
  for (let n = 0; n < 7; n += 1) {
    breakerRows.push(noticeRow({ link: null, not_linked: "breaker" }));
  }
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [],
      unblocked: breakerRows,
      still_blocked: [],
      failure: null,
    }),
    "🔓 7 unblocked · not linked (more than 5)",
  );
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [],
      unblocked: [
        noticeRow({ text: "Book flights", status_symbol: " ", status_name: "Ready", link: null, not_linked: "not_planned_today" }),
      ],
      still_blocked: [],
      failure: null,
    }),
    "🔓 Unblocked: Book flights (Ready)",
  );
  assert.equal(
    helpers.successorNoticeText({
      predecessors: [{ text: "Fix apollo machine!" }],
      unblocked: [],
      still_blocked: [],
      failure: { count: 1, reason: "daily note changed" },
    }),
    "⚠ Closed Fix apollo machine! — couldn't link 1 successor (daily note changed)",
  );
  assert.equal(
    helpers.successorNoticeText({ predecessors: [], unblocked: [], still_blocked: [{ reason: "waits_on" }], failure: null }),
    "",
  );
});

// --- Loaders ---

function stubFs(files) {
  return {
    reads: 0,
    readFileSync(path) {
      this.reads += 1;
      if (!Object.hasOwn(files, path)) {
        const error = new Error(`ENOENT: ${path}`);
        error.code = "ENOENT";
        throw error;
      }
      return files[path].content;
    },
    statSync(path) {
      if (!Object.hasOwn(files, path)) {
        const error = new Error(`ENOENT: ${path}`);
        error.code = "ENOENT";
        throw error;
      }
      const file = files[path];
      return { mtimeMs: file.mtimeMs, size: file.content.length };
    },
  };
}

test("parseSuccessorLinkUnblocked reads block and flow styles, defaulting true", () => {
  assert.equal(helpers.parseSuccessorLinkUnblocked("plan:\n  link_unblocked: false\n"), false);
  assert.equal(helpers.parseSuccessorLinkUnblocked("plan:\n  link_unblocked: true\n"), true);
  assert.equal(helpers.parseSuccessorLinkUnblocked("plan: {link_unblocked: false}\n"), false);
  assert.equal(helpers.parseSuccessorLinkUnblocked("other:\n  link_unblocked: false\n"), true);
  assert.equal(helpers.parseSuccessorLinkUnblocked("plan:\n  link_unblocked: sometimes\n"), true);
  assert.equal(helpers.parseSuccessorLinkUnblocked(""), true);
});

test("loadLinkUnblocked stat-caches the config read", () => {
  helpers.resetSuccessorLinkUnblockedCache();
  const fs = stubFs({ "/cfg/bob/config.yml": { content: "plan:\n  link_unblocked: false\n", mtimeMs: 1 } });
  const options = { fsModule: fs, osModule: null, configPath: "/cfg/bob/config.yml" };
  assert.equal(helpers.loadLinkUnblocked(options), false);
  assert.equal(helpers.loadLinkUnblocked(options), false);
  assert.equal(fs.reads, 1);
  fs.statSync = () => ({ mtimeMs: 2, size: 99 });
  assert.equal(helpers.loadLinkUnblocked(options), false);
  assert.equal(fs.reads, 2);
  helpers.resetSuccessorLinkUnblockedCache();
});

test("loadLinkUnblocked treats missing or unreadable config as true", () => {
  helpers.resetSuccessorLinkUnblockedCache();
  const fs = stubFs({});
  assert.equal(
    helpers.loadLinkUnblocked({ fsModule: fs, osModule: null, configPath: "/cfg/bob/config.yml" }),
    true,
  );
  assert.equal(helpers.loadLinkUnblocked({}), true);
  helpers.resetSuccessorLinkUnblockedCache();
});

test("successorPlanConfigPath honors XDG_CONFIG_HOME", () => {
  assert.equal(
    helpers.successorPlanConfigPath({ env: { XDG_CONFIG_HOME: "/cfg", HOME: "/home/u" }, osModule: null }),
    "/cfg/bob/config.yml",
  );
  assert.equal(
    helpers.successorPlanConfigPath({ env: { HOME: "/home/u" }, osModule: null }),
    "/home/u/.config/bob/config.yml",
  );
});

test("todayDailyPath mirrors the ledger daily path", () => {
  assert.equal(
    helpers.todayDailyPath({}, new Date(2026, 9, 9, 12, 0, 0)),
    "2026/20261009.md",
  );
  assert.equal(
    helpers.todayDailyPath(
      { internalPlugins: { plugins: { "daily-notes": { instance: { options: { folder: "daily", format: "YYYY-MM-DD" } } } } } },
      new Date(2026, 9, 9, 12, 0, 0),
    ),
    "daily/2026-10-09.md",
  );
});

test("normalizeClosedTaskIdentities keeps the anchor root off the match gate", () => {
  const normalized = helpers.normalizeClosedTaskIdentities([
    { path: "sase.md", blockId: "p", rootKey: { path: "sase.md", blockId: "p" } },
    {
      path: "sub.md",
      blockId: "s",
      taskId: "s",
      rootKey: { path: "sase.md", blockId: "p" },
    },
    { path: "nowhere.md" },
  ]);
  // The ID-less root survives for its anchor (matching still skips it),
  // the child's rootKey survives, and the empty identity drops.
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].rootKey, undefined);
  assert.deepEqual(normalized[1].rootKey, { path: "sase.md", blockId: "p" });
});

test("ID-less planned roots anchor ID-bearing children without minting IDs", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^p]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: {
      "sase.md": "- [ ] #task Root ^p",
      "sub.md": "- [x] #task Subtask [id:: s] ^s",
      "d.md": "- [?] #task Dependent [dependsOn:: s] [id:: d] ^d",
    },
    // As the recursive close reports it: the root carries no `taskId`,
    // the child names its tree root.
    closed: [
      { path: "sase.md", blockId: "p", text: "Root" },
      {
        path: "sub.md",
        blockId: "s",
        taskId: "s",
        text: "Subtask",
        rootKey: { path: "sase.md", blockId: "p" },
      },
    ],
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].block_id, "d");
  assert.ok(plan.unblocked[0].link);
  // Inherited from the ID-less root's FIX slot.
  assert.deepEqual(plan.placements[0].anchor, {
    kind: "inherit",
    entryLine: 3,
    bulletLine: 4,
  });
});

test("successor anchors never guess across roots", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[a#^ra]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: {
      "a.md": "- [x] #task Root A ^ra",
      "b.md": "- [x] #task Root B ^rb",
      "sub.md": "- [x] #task Sub of B [id:: s] ^s",
      "d.md": "- [?] #task Dependent [dependsOn:: s] [id:: d] ^d",
    },
    closed: [
      { path: "a.md", blockId: "ra", text: "Root A" },
      { path: "b.md", blockId: "rb", text: "Root B" },
      {
        path: "sub.md",
        blockId: "s",
        taskId: "s",
        text: "Sub of B",
        rootKey: { path: "b.md", blockId: "rb" },
      },
    ],
  });
  // The child's own root was never planned: it recovers instead of
  // borrowing the first root's anchor.
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].block_id, "d");
  assert.equal(plan.unblocked[0].link, null);
  assert.equal(plan.unblocked[0].not_linked, "not_planned_today");
});

test("a child with its own live link keeps its own slot", () => {
  const day = [
    "# 2026-10-09",
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[sase#^p]]",
    "- [ ] () — SASE",
    "\t- [[sub#^s]]",
  ].join("\n");
  const { plan } = planFixture({
    day,
    notes: {
      "sase.md": "- [ ] #task Root ^p",
      "sub.md": "- [x] #task Subtask [id:: s] ^s",
      "d.md": "- [?] #task Dependent [dependsOn:: s] [id:: d] ^d",
    },
    closed: [
      { path: "sase.md", blockId: "p", text: "Root" },
      {
        path: "sub.md",
        blockId: "s",
        taskId: "s",
        text: "Subtask",
        rootKey: { path: "sase.md", blockId: "p" },
      },
    ],
  });
  assert.equal(plan.unblocked.length, 1);
  assert.ok(plan.unblocked[0].link);
  // The direct slot wins over the inherited root anchor.
  assert.deepEqual(plan.placements[0].anchor, {
    kind: "slot",
    entryLine: 5,
    bulletLine: 6,
  });
});

test("getSuccessorIsInbox prefers the versioned nav API with safe fallbacks", () => {
  const viaRoute = helpers.getSuccessorIsInbox({
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          api: {
            inboxRoute: {
              version: 1,
              isInboxNote: (path) => path === "areas/triage.md",
            },
          },
        },
      },
    },
  });
  assert.equal(viaRoute("areas/triage.md"), true);
  assert.equal(viaRoute("inbox.md"), false);
  // A throwing route falls back per path, never throws the gesture.
  const throwing = helpers.getSuccessorIsInbox({
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          api: {
            inboxRoute: {
              version: 1,
              isInboxNote: () => {
                throw new Error("nav down");
              },
            },
          },
        },
      },
    },
  });
  assert.equal(throwing("inbox.md"), true);
  assert.equal(throwing("sase.md"), false);
  // Without the versioned API the host predicate is used.
  const viaHost = helpers.getSuccessorIsInbox({
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          isInboxNotePath: (path) => path === "mac_inbox.md",
        },
      },
    },
  });
  assert.equal(viaHost("mac_inbox.md"), true);
  assert.equal(viaHost("inbox.md"), false);
  // Without nav only the root default remains.
  const fallback = helpers.getSuccessorIsInbox({ plugins: { plugins: {} } });
  assert.equal(fallback("inbox.md"), true);
  assert.equal(fallback("mac_inbox.md"), false);
});

test("countSuccessorBasenames walks the vault set, not the task set", () => {
  const app = {
    vault: {
      getMarkdownFiles: () => [
        { path: "a/d.md" },
        { path: "b/d.md" },
        { path: "inbox.md" },
        { path: ".obsidian/hidden.md" },
        { path: "_templates/tpl.md" },
        { path: ".drafts/wip.md" },
        { path: "notes.txt" },
      ],
    },
  };
  const counts = helpers.countSuccessorBasenames(
    app,
    [{ path: "a/d.md" }],
    [],
    "2026/20261009.md",
    {},
  );
  // The prose-only `b/d.md` still forces the long form; excluded
  // directories and non-Markdown files never count.
  assert.equal(counts.d, 2);
  assert.equal(counts.inbox, 1);
  assert.equal(counts.hidden, undefined);
  assert.equal(counts.tpl, undefined);
  assert.equal(counts.wip, undefined);
  assert.equal(counts.notes, undefined);
  // Staged paths join the set without reading bodies.
  const staged = helpers.countSuccessorBasenames(
    { vault: { getMarkdownFiles: () => [{ path: "Notes.md" }] } },
    [],
    [],
    "",
    { "extra.md": "- [ ] #task New\n" },
  );
  assert.equal(staged.notes, 1);
  assert.equal(staged.extra, 1);
  // Stems compare case-insensitively: differently-cased twins collide.
  const cased = helpers.countSuccessorBasenames(
    {
      vault: {
        getMarkdownFiles: () => [{ path: "a/d.md" }, { path: "A/D.md" }],
      },
    },
    [],
    [],
    "",
    {},
  );
  assert.equal(cased.d, 2);
});

test("the pass threads a richer isInbox into unblocked rows", () => {
  const { plan } = planFixture({
    day: FIX_DAY,
    notes: {
      "sase.md": [
        "- [?] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo",
      ].join("\n"),
      "mac_inbox.md": [
        "- [?] #task Triage this [dependsOn:: sase__fix-apollo] ^triage",
      ].join("\n"),
    },
    closed: FIX_CLOSED,
    options: {
      basenameCounts: { sase: 1, mac_inbox: 1 },
      isInbox: (path) => path === "mac_inbox.md",
    },
  });
  assert.equal(plan.unblocked.length, 1);
  assert.equal(plan.unblocked[0].inbox, true);
});
