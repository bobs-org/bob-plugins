// Reading Board models use the checked-in `bob ref list` output generated
// from bob-cli's ref-library fixture vault, rather than hand-authored rows.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  readingBoardDecodeReport,
  readingBoardBuildArgs,
  readingBoardKind,
  readingBoardModel,
  readingBoardParseFence,
  readingBoardScheduleGroup,
  readingBoardSignature,
  readingBoardTaskKey,
  readingBoardTitleParts,
} = LedgerToolsPlugin.helpers;

const fixturePath = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/reading-board/ref-list.json",
);
const fixtureDocument = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const decoded = readingBoardDecodeReport(JSON.stringify(fixtureDocument), "");
assert.equal(decoded.ok, true, "the shared fixture must be valid bob output");

function board(report = decoded.report, options = {}) {
  return readingBoardModel(report, { today: "2026-10-20", ...options });
}

function row(pathname) {
  return decoded.report.refs.find((entry) => entry.path === pathname);
}

test("the shared bob output builds the expected four lanes and preserves bob order", () => {
  const model = board();
  assert.deepEqual(
    [model.lanes.reading.count, model.lanes.next.count, model.lanes.ready.count, model.lanes.snoozed.count],
    [1, 2, 11, 12],
  );
  assert.deepEqual(
    model.lanes.ready.cards.map((card) => card.path),
    decoded.report.refs
      .filter((entry) => entry.era === "modern" && entry.status === "ready" && !entry.blocked)
      .map((entry) => entry.path),
  );
  assert.deepEqual(model.summary, { awake: 14, snoozed: 12 });
  assert.equal(model.emptyText, null);
  assert.equal(board({ ...decoded.report, refs: [] }).emptyText, "Nothing queued ✓");
});

test("each status uses its awake lane and every blocked status uses Snoozed", () => {
  const base = row("ref/papers/two_trackers.md");
  assert.ok(base, "combination cases derive from a real bob row");
  for (const status of ["wip", "next", "ready"]) {
    for (const blocked of [false, true]) {
      const variant = { ...base, status, blocked, blocked_by: [] };
      const model = board({ ...decoded.report, refs: [variant] });
      if (blocked) {
        assert.equal(model.lanes.snoozed.count, 1, `${status} blocked`);
        assert.equal(model.summary.awake, 0);
      } else {
        assert.equal(model.lanes[status === "wip" ? "reading" : status].count, 1, `${status} awake`);
        assert.equal(model.lanes.snoozed.count, 0);
      }
    }
  }
});

test("Today floats cards by ledger rank only when the cache is ready", () => {
  const chat = row("ref/chat/chat_next.md");
  const prereq = row("ref/papers/prereq_open.md");
  const chatKey = readingBoardTaskKey(chat.task);
  const prereqKey = readingBoardTaskKey(prereq.task);
  const todayRank = new Map([[prereqKey, 0], [chatKey, 1]]);
  const ready = board(decoded.report, { todayReady: true, todayRank });
  assert.equal(ready.lanes.next.cards[0].path, prereq.path);
  assert.equal(ready.lanes.next.cards[0].today, true);
  assert.equal(ready.lanes.next.cards[1].path, chat.path);
  const cold = board(decoded.report, { todayReady: false, todayRank });
  assert.equal(cold.lanes.next.cards[0].path, chat.path);
  assert.ok(cold.lanes.next.cards.every((card) => card.today === false));
});

test("Snoozed groups show waking, schedule, dependency, project, return lane, and mark models", () => {
  const model = board(decoded.report, { today: "2026-10-20" });
  const byPath = new Map(model.lanes.snoozed.cards.map((card) => [card.path, card]));
  const waking = byPath.get("ref/papers/blocked_mark.md");
  assert.equal(waking.snoozedGroup, "waking");
  assert.equal(waking.wakeLabel, "⏰ now");
  assert.match(waking.wakeTooltip, /next reconcile returns it to ⭐ Next/);

  const scheduled = byPath.get("ref/papers/sched_future.md");
  assert.equal(scheduled.snoozedGroup, "this_week");
  assert.equal(scheduled.schedule.date, "2026-10-23");
  assert.equal(scheduled.schedule.label, "Fri");
  assert.match(scheduled.schedule.tooltip, /^Snoozed until Fri, Oct 23 · in /);
  assert.doesNotMatch(scheduled.schedule.tooltip, /Ctrl\+/);

  const dependent = byPath.get("ref/papers/dep_open_ref.md");
  assert.match(dependent.reasonText, /⛓ after Open Prerequisite Paper/);
  assert.equal(dependent.prerequisites[0].ref_path, "ref/papers/prereq_open.md");
  assert.equal(dependent.returnLane, null, "Ready is the destination lane already");
  assert.deepEqual(waking.returnLane, { id: "next", text: "→ ⭐ Next" });

  const project = byPath.get("ref/papers/prj_blocked.md");
  assert.match(project.reasonText, /🧱 in blocked project sase_post_blog/);
  assert.equal(project.projects[0].link, "[[sase_post_blog]]");

  const combined = byPath.get("ref/papers/combo_blocked.md");
  assert.match(combined.reasonText, /⛓ after Open Prerequisite Paper/);
  assert.match(combined.reasonText, /🧱 in blocked project sase_post_blog/);
  assert.equal(combined.schedule.date, "2026-11-01");

  const topReady = model.lanes.ready.cards.find((card) => card.path === "ref/chat/chat_ready.md");
  assert.equal(topReady.kind.text, "💬 Chat");
  assert.equal(topReady.priorityMark.value, "highest");
  assert.doesNotMatch(topReady.priorityMark.tooltip, /Ctrl\+/);
  const addedCard = model.lanes.ready.cards.find((card) => card.path === "ref/papers/created_note.md");
  assert.ok(addedCard.addedMark && addedCard.addedMark.field === "created");
});

test("schedule groups follow Monday-start weeks through Sunday across month and year ends", () => {
  assert.equal(readingBoardScheduleGroup("2026-10-18", "2026-10-18"), "this_week");
  assert.equal(readingBoardScheduleGroup("2026-10-19", "2026-10-18"), "this_month");
  assert.equal(readingBoardScheduleGroup("2026-10-31", "2026-10-31"), "this_week");
  assert.equal(readingBoardScheduleGroup("2026-11-01", "2026-10-31"), "this_week");
  assert.equal(readingBoardScheduleGroup("2026-11-02", "2026-10-31"), "later");
  assert.equal(readingBoardScheduleGroup("2027-01-01", "2026-12-31"), "this_week");
  assert.equal(readingBoardScheduleGroup("2027-01-04", "2026-12-31"), "later");
});

test("older bob output remains visible in Waiting on and explains the missing reasons", () => {
  const older = JSON.parse(JSON.stringify(fixtureDocument));
  for (const ref of older.refs) {
    if (ref.blocked) {
      delete ref.blocked_by;
    }
    if (ref.task) {
      delete ref.task.priority;
      delete ref.task.scheduled;
    }
  }
  const oldDecoded = readingBoardDecodeReport(JSON.stringify(older), "");
  assert.equal(oldDecoded.ok, true);
  const model = board(oldDecoded.report);
  assert.ok(model.lints.includes("Update bob-cli to see why references are snoozed."));
  const oldBlocked = model.lanes.snoozed.cards.find((card) => card.path === "ref/papers/sched_future.md");
  assert.equal(oldBlocked.snoozedGroup, "waiting_on");
  assert.equal(oldBlocked.reasonText, "⏸ blocked");
});

test("fence options accept parent and type lists while turning bad input into lints", () => {
  const parsed = readingBoardParseFence([
    'parent: "sase" # route',
    "type: [ai, papers]",
    "unknown: value",
    "not a setting",
    "type: blogs",
  ].join("\n"));
  assert.equal(parsed.parent, "sase");
  assert.deepEqual(parsed.type, ["ai", "papers"]);
  assert.equal(parsed.lints.length, 3);
  assert.deepEqual(readingBoardParseFence("type: \"chat, blogs\"").type, ["chat", "blogs"]);
  assert.deepEqual(readingBoardParseFence("type:\n  - ai\n  - papers").type, ["ai", "papers"]);
  assert.deepEqual(readingBoardParseFence("parent: \n").lints, ["Invalid parent: expected a note name."]);
  const quoted = readingBoardParseFence("parent: 'Reading List'\ntype: [\"chat\", blogs]");
  assert.equal(quoted.parent, "Reading List");
  assert.deepEqual(quoted.type, ["chat", "blogs"]);

  for (const source of [
    "type: [papers",
    "parent: [sase, cash]",
    "parent: {note: sase}",
    "parent: true",
    "parent: 42",
    "type: true",
    "type: 17",
    "type: null",
    'type: "papers',
  ]) {
    const invalid = readingBoardParseFence(source);
    assert.equal(invalid.lints.length, 1, source);
    const args = readingBoardBuildArgs(invalid);
    assert.equal(args.includes("[papers"), false, source);
    assert.equal(args.includes("[sase, cash]"), false, source);
    assert.equal(args.includes("{note: sase}"), false, source);
    assert.equal(args.includes("true"), false, source);
    assert.equal(args.includes("17"), false, source);
    assert.equal(args.includes("42"), false, source);
    assert.equal(args.includes("null"), false, source);
  }
});

test("kind names, title code spans, and render signatures are deterministic", () => {
  assert.deepEqual(readingBoardKind("ai"), { type: "ai", icon: "🤖", label: "AI", text: "🤖 AI" });
  assert.equal(readingBoardKind(null).text, "🔖 Ref");
  assert.deepEqual(readingBoardTitleParts("Read `foo` then ``bar`baz``"), [
    { type: "text", text: "Read " },
    { type: "code", text: "foo" },
    { type: "text", text: " then " },
    { type: "code", text: "bar`baz" },
  ]);
  const first = board();
  const second = board();
  assert.equal(readingBoardSignature(first), readingBoardSignature(second));
  const changed = { ...first, summary: { ...first.summary, awake: first.summary.awake + 1 } };
  assert.notEqual(readingBoardSignature(first), readingBoardSignature(changed));
  const changedTask = JSON.parse(JSON.stringify(first));
  changedTask.lanes.ready.cards[0].task = { path: "new.md", block_id: "ref", link: "[[new#^ref]]" };
  assert.notEqual(readingBoardSignature(first), readingBoardSignature(changedTask));
  const changedPrerequisite = JSON.parse(JSON.stringify(first));
  const dependent = changedPrerequisite.lanes.snoozed.cards.find((card) => card.prerequisites.length > 0);
  dependent.prerequisites[0].ref_path = "ref/chat/chat_ready.md";
  assert.notEqual(readingBoardSignature(first), readingBoardSignature(changedPrerequisite));
});
