// Ctrl+S splits the selected open merged Pomodoro by type (R4). Pure
// planner coverage for planPomodoroTypeSplit and cursor mapping, refusal
// copy, picker rows and footer preview, and key dispatch (including
// Ctrl+S outside a Pomodoro block passing through).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

const {
  planPomodoroTypeSplit,
  mapPomodoroSplitCursor,
  isPomodoroSplitKeydown,
  resolvePomodoroSplitEntry,
  pomodoroSplitRefusalForPlanError,
  pomodoroSplitContainerRefusal,
  buildPomodoroSplitNotice,
  buildPomodoroSplitPickerRows,
  pomodoroSplitPickerPreview,
} = helpers;

function twoTypeContent() {
  return [
    "## Pomodoros",
    "- [ ] () — BUILD + FIX",
    "\t- [[a#^b1]]",
    "\t- [[a#^f1]]",
    "\t- [[a#^f2]]",
    "- [ ] () — LATER",
  ].join("\n");
}

test("planPomodoroTypeSplit moves the right type below the source in name order", () => {
  const content = twoTypeContent();
  const plan = planPomodoroTypeSplit(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — BUILD + FIX",
    split: { remaining: "BUILD", created: [{ name: "FIX", link_indices: [1, 2] }] },
    linkTargets: [
      { line: 2, rawLine: "\t- [[a#^b1]]" },
      { line: 3, rawLine: "\t- [[a#^f1]]" },
      { line: 4, rawLine: "\t- [[a#^f2]]" },
    ],
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.remainingName, "BUILD");
  assert.deepEqual(plan.splitNames, ["FIX"]);
  assert.equal(plan.movedCount, 2);
  assert.equal(plan.sourcePomodoroPreserved, true);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "\t- [[a#^b1]]",
    "- [ ] () — FIX",
    "\t- [[a#^f1]]",
    "\t- [[a#^f2]]",
    "- [ ] () — LATER",
  ].join("\n"));
});

test("planPomodoroTypeSplit splits every merged-in type and carries nested subtrees", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — BUILD + FIX + READ",
    "\t- [[a#^b1]]",
    "\t- [[a#^f1]]",
    "\t\t- follow-up",
    "\t- [[a#^r1]]",
    "- [ ] () — LATER",
  ].join("\n");
  const plan = planPomodoroTypeSplit(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — BUILD + FIX + READ",
    split: {
      remaining: "BUILD",
      created: [
        { name: "FIX", link_indices: [1] },
        { name: "READ", link_indices: [2] },
      ],
    },
    linkTargets: [
      { line: 2, rawLine: "\t- [[a#^b1]]" },
      { line: 3, rawLine: "\t- [[a#^f1]]" },
      { line: 5, rawLine: "\t- [[a#^r1]]" },
    ],
  });
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.splitNames, ["FIX", "READ"]);
  assert.deepEqual(plan.splitEntryLines, [3, 6]);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — BUILD",
    "\t- [[a#^b1]]",
    "- [ ] () — FIX",
    "\t- [[a#^f1]]",
    "\t\t- follow-up",
    "- [ ] () — READ",
    "\t- [[a#^r1]]",
    "- [ ] () — LATER",
  ].join("\n"));
});

test("planPomodoroTypeSplit keeps labels and still creates empty type slots", () => {
  const content = [
    "## Pomodoros",
    "- [ ] () — BOB + BUILD + FIX + READ",
    "\t- [[a#^b1]]",
  ].join("\n");
  const plan = planPomodoroTypeSplit(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — BOB + BUILD + FIX + READ",
    split: {
      remaining: "BOB + BUILD",
      created: [
        { name: "FIX", link_indices: [] },
        { name: "READ", link_indices: [] },
      ],
    },
    linkTargets: [{ line: 2, rawLine: "\t- [[a#^b1]]" }],
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.remainingName, "BOB + BUILD");
  assert.equal(plan.movedCount, 0);
  assert.equal(plan.after, [
    "## Pomodoros",
    "- [ ] () — BOB + BUILD",
    "\t- [[a#^b1]]",
    "- [ ] () — FIX",
    "- [ ] () — READ",
  ].join("\n"));
});

test("planPomodoroTypeSplit refuses stale and malformed splits without editing", () => {
  const content = twoTypeContent();
  const stale = planPomodoroTypeSplit(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — BUILD + CHANGED",
    split: { remaining: "BUILD", created: [{ name: "FIX", link_indices: [1] }] },
    linkTargets: [
      { line: 2, rawLine: "\t- [[a#^b1]]" },
      { line: 3, rawLine: "\t- [[a#^f1]]" },
    ],
  });
  assert.equal(stale.valid, false);
  assert.equal(stale.after, content);

  const empty = planPomodoroTypeSplit(content, {
    sourceEntryLine: 1,
    split: { remaining: "BUILD", created: [] },
    linkTargets: [],
  });
  assert.equal(empty.valid, false);
  assert.equal(empty.after, content);
});

test("mapPomodoroSplitCursor follows a moved bullet and keeps other lines", () => {
  const content = twoTypeContent();
  const plan = planPomodoroTypeSplit(content, {
    sourceEntryLine: 1,
    sourceRawLine: "- [ ] () — BUILD + FIX",
    split: { remaining: "BUILD", created: [{ name: "FIX", link_indices: [1, 2] }] },
    linkTargets: [
      { line: 2, rawLine: "\t- [[a#^b1]]" },
      { line: 3, rawLine: "\t- [[a#^f1]]" },
      { line: 4, rawLine: "\t- [[a#^f2]]" },
    ],
  });
  assert.equal(plan.valid, true);
  assert.deepEqual(mapPomodoroSplitCursor(content, plan.after, plan, { line: 3, ch: 4 }), {
    line: 4,
    ch: 4,
  });
  assert.deepEqual(mapPomodoroSplitCursor(content, plan.after, plan, { line: 1, ch: 2 }), {
    line: 1,
    ch: 2,
  });
  assert.deepEqual(mapPomodoroSplitCursor(content, plan.after, plan, { line: 2, ch: 3 }), {
    line: 2,
    ch: 3,
  });
});

test("split refusals teach without editing", () => {
  assert.equal(
    pomodoroSplitRefusalForPlanError({ kind: "error", code: "split_closed" }, "BUILD + FIX"),
    "Closed Pomodoros are history",
  );
  assert.equal(
    pomodoroSplitRefusalForPlanError({ kind: "error", code: "split_meet" }, "MEET"),
    "MEET entries never split; calendar sync owns the MEET name",
  );
  assert.equal(
    pomodoroSplitRefusalForPlanError({ kind: "error", code: "split_not_merged" }, "BUILD"),
    "BUILD has one type — nothing to split",
  );
  assert.equal(
    pomodoroSplitRefusalForPlanError(
      { kind: "error", code: "split_base_type", name: "BUILD" },
      "BUILD + FIX + READ",
    ),
    "BUILD is the base of BUILD + FIX + READ and stays",
  );
  assert.equal(
    pomodoroSplitRefusalForPlanError(
      { kind: "error", code: "split_type_unknown", selector: "CHORE" },
      "BUILD + FIX + READ",
    ),
    "CHORE is not part of BUILD + FIX + READ",
  );
  assert.equal(
    pomodoroSplitRefusalForPlanError(
      { kind: "error", code: "split_type_repeated", name: "FIX" },
      "BUILD + FIX + READ",
    ),
    "FIX is named twice; list each type once",
  );
  assert.equal(
    pomodoroSplitContainerRefusal("LATER", [{ name: "LATER", key: "later", isType: false }]),
    "LATER holds any type — nothing to split",
  );
  assert.equal(
    pomodoroSplitContainerRefusal("BUILD + FIX", [
      { name: "BUILD", key: "build", isType: true },
      { name: "FIX", key: "fix", isType: true },
    ]),
    null,
  );
});

test("two-type notice names the split, count, and destination", () => {
  assert.equal(
    buildPomodoroSplitNotice(
      { movedCount: 2, splitNames: ["FIX"] },
      "BUILD + FIX",
    ),
    "Split FIX out of BUILD + FIX · 2 tasks → FIX below",
  );
  assert.equal(
    buildPomodoroSplitNotice({ movedCount: 1, splitNames: ["READ"] }, "BUILD + READ"),
    "Split READ out of BUILD + READ · 1 task → READ below",
  );
});

test("split picker offers All plus each merged-in type with counts, never the base", () => {
  const rows = buildPomodoroSplitPickerRows(
    "BUILD + FIX + READ",
    [
      { key: "fix", name: "FIX" },
      { key: "read", name: "READ" },
    ],
    { fix: 2, read: 0 },
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].key, "__all__");
  assert.match(rows[0].label, /FIX/);
  assert.match(rows[0].label, /READ/);
  assert.deepEqual(
    rows.slice(1).map((row) => [row.key, row.label, row.detail]),
    [
      ["fix", "FIX", "2 tasks"],
      ["read", "READ", "no tasks"],
    ],
  );
  assert.ok(rows.every((row) => row.selectable));
  assert.equal(
    pomodoroSplitPickerPreview(
      "",
      {
        base: [{ name: "BUILD" }],
        merged: [
          { key: "fix", name: "FIX" },
          { key: "read", name: "READ" },
        ],
      },
      ["fix"],
    ),
    "BUILD + READ · FIX ↓",
  );
});

test("Ctrl+S dispatch acts only on exactly Ctrl+S inside a Pomodoro block", () => {
  const content = twoTypeContent();
  assert.equal(
    isPomodoroSplitKeydown({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "s", code: "KeyS" }),
    true,
  );
  for (const event of [
    { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: "S", code: "KeyS" },
    { ctrlKey: true, shiftKey: false, altKey: true, metaKey: false, key: "s", code: "KeyS" },
    { ctrlKey: true, shiftKey: false, altKey: false, metaKey: true, key: "s", code: "KeyS" },
    { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: "s", code: "KeyS" },
    { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "s", code: "KeyS", repeat: true },
  ]) {
    assert.equal(isPomodoroSplitKeydown(event), false, JSON.stringify(event));
  }
  const onEntry = resolvePomodoroSplitEntry(content, 1);
  assert.ok(onEntry);
  assert.equal(onEntry.entryLine, 1);
  assert.equal(onEntry.fromBullet, false);
  const onBullet = resolvePomodoroSplitEntry(content, 3);
  assert.ok(onBullet);
  assert.equal(onBullet.entryLine, 1);
  assert.equal(onBullet.fromBullet, true);
  assert.equal(resolvePomodoroSplitEntry(content, 0), null);
  const onLater = resolvePomodoroSplitEntry(content, 5);
  assert.ok(onLater);
  assert.equal(onLater.entryLine, 5);
  assert.equal(resolvePomodoroSplitEntry("no pomodoros here", 0), null);
  assert.equal(
    resolvePomodoroSplitEntry(`${content}\n\nsome prose`, 8),
    null,
  );
});
