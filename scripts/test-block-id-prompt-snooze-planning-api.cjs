const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./block-id-prompt-harness.cjs");

test("snooze planning API is versioned, planning-only, and injects the freshness stamper", () => {
  const api = helpers.createSnoozePlanningApi({});
  assert.equal(api.version, 1);
  const calls = [];
  const stampLine = (line, dateText) => {
    calls.push({ line, dateText });
    const block = /([ \t]+\^[A-Za-z0-9-]+[ \t]*)$/.exec(line);
    return block
      ? line.slice(0, block.index) + ` [fresh:: ${dateText}]` + block[1]
      : line + ` [fresh:: ${dateText}]`;
  };
  const plan = api.planTargetTaskUpdate("- [ ] #task Email Dan ^email-dan\n", 0, {
    now: new Date("2026-11-25T13:00:00Z"),
    freshDateText: "2026-11-25",
    stampLine,
  });
  assert.equal(plan.content, "- [*] #task Email Dan [fresh:: 2026-11-25] ^email-dan\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dateText, "2026-11-25");
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0].start, 0);
  assert.equal(plan.edits[0].replacement, "- [*] #task Email Dan [fresh:: 2026-11-25] ^email-dan");
});

test("snooze planning API leaves Next and In Progress lines byte-identical", () => {
  const api = helpers.createSnoozePlanningApi({});
  let stamps = 0;
  for (const line of ["- [*] #task Email Dan ^email-dan\n", "- [/] #task Email Dan ^email-dan\n"]) {
    const plan = api.planTargetTaskUpdate(line, 0, {
      now: new Date("2026-11-25T13:00:00Z"),
      freshDateText: "2026-11-25",
      stampLine() { stamps += 1; return "unexpected"; },
    });
    assert.equal(plan.content, line);
    assert.equal(plan.hasChanges, false);
  }
  assert.equal(stamps, 0);
});

test("snooze planning API requires explicit time and freshness inputs", () => {
  const api = helpers.createSnoozePlanningApi({});
  assert.equal(api.planTargetTaskUpdate("- [ ] #task T ^t", 0, {}), null);
  assert.equal(api.planTargetTaskUpdate("- [ ] #task T ^t", 0, {
    now: new Date("2026-11-25T13:00:00Z"),
    freshDateText: "2026-11-25",
  }), null);
});

test("snooze planning API delegates missing-ID validation to the BIP naming planner", () => {
  const api = helpers.createSnoozePlanningApi({});
  const options = {
    now: new Date("2026-11-25T13:00:00Z"),
    freshDateText: "2026-11-25",
    stampLine: (line, day) => {
      const block = /([ \t]+\^[A-Za-z0-9-]+[ \t]*)$/.exec(line);
      return block
        ? line.slice(0, block.index) + ` [fresh:: ${day}]` + block[1]
        : line + ` [fresh:: ${day}]`;
    },
    newBlockId: "already-used",
  };
  const duplicate = api.planTargetTaskUpdate(
    "- [ ] #task Email Dan\n- [ ] #task Another task ^already-used\n",
    0,
    options,
  );
  assert.equal(duplicate, null, "existing block IDs cannot be reused");
  const valid = api.planTargetTaskUpdate(
    "- [ ] #task Email Dan\n",
    0,
    { ...options, newBlockId: "email-dan" },
  );
  assert.ok(valid);
  assert.match(valid.content, /\[\*\] #task Email Dan \[fresh:: 2026-11-25\] \^email-dan/);
});
