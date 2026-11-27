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

test("today event ends use clean titles and exclude overnight or closed Event Tasks", () => {
  const api = createSnoozeFactsApi(pluginWith([]));
  const daily = [
    "## Pomodoros", "", "- [ ] () — WRITE", "", "## Events", "",
    "- [/] #task **0642-0712** after Yogi interview [root:: bob] [type:: MEET] #offclock [agenda](https://example.test) ^event-suggestion",
    "- [x] #task **0712-0742** Done event [type:: MEET] ^done-event",
    "- [-] #task **0742-0812** Cancelled event [type:: MEET] ^cancelled-event",
    "- [/] #task **2350-0010** Overnight event [type:: MEET] ^overnight-event",
    "- **0800-0830** Context event [type:: MEET] ^context-event",
  ].join("\n");
  const events = api.todayEvents(daily);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "after Yogi interview");
  assert.equal(events[0].kind, "task");
  assert.equal(events[0].open, true);
  assert.equal(events[0].startMin, 6 * 60 + 42);
  assert.equal(events[0].endMin, 7 * 60 + 12);
  assert.equal(events[1].title, "Context event");
  assert.equal(events[1].open, true);
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

test("plan counts canonicalize same-note links with the real daily path", () => {
  const plugin = {
    ...pluginWith([]),
    planBudgetOffClockPredicate: () => () => false,
  };
  const api = createSnoozeFactsApi(plugin);
  const daily = "## Pomodoros\n\n- [ ] () — WRITE\n  - [[#^same]]\n  - [[2026/20261127#^same]]\n";
  assert.equal(api.planCounts(daily).count, 2);
  const counts = api.planCounts(daily, "2026/20261127.md");
  assert.equal(counts.count, 1);
  assert.equal(counts.identities.length, 1);
  assert.deepEqual(counts.identities[0], { target: "2026/20261127", blockId: "same" });
});
