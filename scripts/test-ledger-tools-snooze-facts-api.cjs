const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./ledger-tools-harness.cjs");

const { createSnoozeFactsApi } = helpers;

function pluginWith(rows) {
  return { snoozedRows: () => rows };
}

test("zone, date, and clock facts degrade to null instead of throwing", () => {
  const api = createSnoozeFactsApi(pluginWith([]));
  assert.equal(api.version, 1);
  const dateText = api.dateText(new Date("2026-11-27T13:00:00Z"));
  assert.match(dateText || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof api.zoneName(), "string");
  assert.ok(Number.isInteger(api.nowMinutes(new Date("2026-11-27T13:00:00Z"))));
  // Pure clock facts do not need the plugin; row facts do.
  assert.match(createSnoozeFactsApi(null).dateText(new Date("2026-11-27T13:00:00Z")) || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(createSnoozeFactsApi(null).activeRow("r#^b"), null);
});

test("today events parse titles and spans from the Events section", () => {
  const api = createSnoozeFactsApi(pluginWith([]));
  const daily = "## Pomodoros\n\n- [ ] () — WRITE\n\n## Events\n\n- **0930-1030** Yogi interview\n- **all day** Out of office\n";
  const events = api.todayEvents(daily);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Yogi interview");
  assert.equal(events[0].startMin, 570);
  assert.equal(events[0].endMin, 630);
  assert.deepEqual(api.todayEvents("## Pomodoros\n"), []);
  assert.equal(api.todayEvents(null), null);
});

test("activeRow returns only live rows for the identity", () => {
  const rows = [
    { key: "projects/job.md#email-dan", identity: "projects/job.md#^email-dan", hhmm: "1530", minutes: 930, state: "asleep", target: "projects/job", blockId: "email-dan", route: "projects/job.md" },
    { key: "other.md#x", identity: "other.md#^x", hhmm: null, minutes: null, state: "missing", target: null, blockId: null, route: null },
  ];
  const api = createSnoozeFactsApi(pluginWith(rows));
  const found = api.activeRow("projects/job.md#^email-dan");
  assert.equal(found.hhmm, "1530");
  assert.equal(found.state, "asleep");
  assert.equal(api.activeRow("other.md#^x"), null);
  assert.equal(api.activeRow("missing.md#^nope"), null);
});

test("plan counts report the on-clock link budget", () => {
  const api = createSnoozeFactsApi(pluginWith([]));
  const counts = api.planCounts("## Pomodoros\n\n- [ ] () — WRITE\n\t- [[projects/job#^email-dan]]\n");
  assert.ok(counts && Number.isInteger(counts.count) && Number.isInteger(counts.cap));
  assert.equal(typeof counts.over, "boolean");
  assert.equal(api.planCounts(null), null);
});
