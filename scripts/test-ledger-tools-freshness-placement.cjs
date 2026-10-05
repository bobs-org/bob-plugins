const assert = require("node:assert/strict");
const test = require("node:test");
const {
  freshnessSetRefreshLine,
  freshnessStampLine,
  readFreshness,
  D,
} = require("./ledger-tools-harness.cjs");
// docs/freshness.md §9: input line, expected line, `changed`.
const PLACEMENT_VECTORS = [
  ["P1", "- [ ] #task Buy milk", "- [ ] #task Buy milk [fresh:: 2026-10-08]", true],
  [
    "P2",
    "- [ ] #task Buy milk [created::2026-09-29]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    true,
  ],
  [
    "P3",
    "- [ ] #task Pick up Abby ^pickup",
    "- [ ] #task Pick up Abby [fresh:: 2026-10-08] ^pickup",
    true,
  ],
  [
    "P4",
    "- [ ] #task Plan trip [created::2026-08-26] #hide [priority:: high] ^trip",
    "- [ ] #task Plan trip [fresh:: 2026-10-08] [created::2026-08-26] #hide [priority:: high] ^trip",
    true,
  ],
  [
    "P5",
    "- [ ] #task Read X [[#^h-8bac|🔖]] [h:: e629] [created::2026-08-28]",
    "- [ ] #task Read X [[#^h-8bac|🔖]] [h:: e629] [fresh:: 2026-10-08] [created::2026-08-28]",
    true,
  ],
  [
    "P6",
    "- [ ] #task Rahway  [created:: 2026-07-15]  [scheduled:: 2026-08-10] ^rahway",
    "- [ ] #task Rahway [fresh:: 2026-10-08] [created:: 2026-07-15]  [scheduled:: 2026-08-10] ^rahway",
    true,
  ],
  [
    "P7",
    "- [ ] #task Buy milk [fresh:: 2026-10-01] [created::2026-09-29]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    true,
  ],
  [
    "P8",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    false,
  ],
  [
    "P9",
    "- [ ] #task Buy milk [created::2026-09-29] [fresh:: 2026-10-01]",
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]",
    true,
  ],
  [
    "P10",
    "- [ ] #task A [fresh:: 2026-09-01] B [fresh:: 2026-09-20] [created::2026-09-01]",
    "- [ ] #task A B [fresh:: 2026-10-08] [created::2026-09-01]",
    true,
  ],
  [
    "P11",
    "- [ ] #task Rename queue input [refresh:: 14] [created::2026-09-10] [priority:: low]",
    "- [ ] #task Rename queue input [fresh:: 2026-10-08] [refresh:: 14] [created::2026-09-10] [priority:: low]",
    true,
  ],
  [
    "P14a",
    "- [ ] #task #hide ^x",
    "- [ ] #task [fresh:: 2026-10-08] #hide ^x",
    true,
  ],
  [
    "P14b",
    "- [ ] #task #prj Ship it #hide ^prj",
    "- [ ] #task #prj Ship it [fresh:: 2026-10-08] #hide ^prj",
    true,
  ],
  [
    "P15",
    "- [ ] #task Call mom (created:: 2026-09-01)",
    "- [ ] #task Call mom [fresh:: 2026-10-08] (created:: 2026-09-01)",
    true,
  ],
  [
    "P16",
    "\t- [?] #task Deferred [created::2026-09-01] [scheduled:: 2026-10-20]",
    "\t- [?] #task Deferred [fresh:: 2026-10-08] [created::2026-09-01] [scheduled:: 2026-10-20]",
    true,
  ],
  [
    "P18",
    "> - [ ] #task Quoted [created::2026-09-01]",
    "> - [ ] #task Quoted [fresh:: 2026-10-08] [created::2026-09-01]",
    true,
  ],
];

test("placement vectors P1-P11, P14-P16, P18 stamp canonically", () => {
  for (const [id, input, expected, changed] of PLACEMENT_VECTORS) {
    const stamped = freshnessStampLine(input, D);
    assert.equal(stamped.line, expected, `${id}: stamped line`);
    assert.equal(stamped.changed, changed, `${id}: changed`);
    assert.equal(stamped.refused, null, `${id}: not refused`);
  }
});

test("P12 set and clear refresh stamps alongside", () => {
  const p2 = "- [ ] #task Buy milk [fresh:: 2026-10-08] [created::2026-09-29]";
  const set = freshnessSetRefreshLine(
    "- [ ] #task Buy milk [created::2026-09-29]",
    30,
    D,
  );
  assert.equal(
    set.line,
    "- [ ] #task Buy milk [fresh:: 2026-10-08] [refresh:: 30] [created::2026-09-29]",
  );
  assert.equal(set.changed, true);
  const cleared = freshnessSetRefreshLine(p2.replace("[fresh:: 2026-10-08] ", "[fresh:: 2026-10-08] [refresh:: 30] "), null, D);
  assert.equal(cleared.line, p2);
});

test("P13 recurring and P17 done tasks are refused unchanged", () => {
  const recurring =
    "- [ ] #task Water plants [repeat:: every week] [created::2026-09-01]";
  const refusedRecurring = freshnessStampLine(recurring, D);
  assert.equal(refusedRecurring.line, recurring);
  assert.equal(refusedRecurring.changed, false);
  assert.equal(refusedRecurring.refused, "recurring");

  const done = "- [x] #task Old [completion:: 2026-10-01]";
  const refusedClosed = freshnessStampLine(done, D);
  assert.equal(refusedClosed.line, done);
  assert.equal(refusedClosed.changed, false);
  assert.equal(refusedClosed.refused, "closed");

  const plain = "just a bullet, not a task";
  assert.equal(freshnessStampLine(plain, D).refused, "not_task");
});

test("reader reports misplaced and duplicate fields", () => {
  const misplaced = readFreshness(
    "- [ ] #task Buy milk [created::2026-09-29] [fresh:: 2026-10-01]",
    D,
  );
  assert.ok(misplaced.lints.includes("fresh_misplaced"), "P9 lint");
  assert.equal(misplaced.fresh, "2026-10-01");

  const duplicates = readFreshness(
    "- [ ] #task A [fresh:: 2026-09-01] B [fresh:: 2026-09-20] [created::2026-09-01]",
    D,
  );
  assert.ok(duplicates.lints.includes("fresh_duplicate"), "P10 lint");
  assert.equal(duplicates.fresh, "2026-09-20");
});

