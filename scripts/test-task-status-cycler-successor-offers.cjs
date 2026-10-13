const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
} = require("./task-status-cycler-harness.cjs");

// SO — successor offer vectors (docs/task-dependencies.md §12.12, SO1–SO32).
// Pure planner + picker-model vectors expressible without a vault. Runtime
// vectors (picker await, re-plan, receipts, snapshot guard, walk toast) live
// in the wiring/polish suites with a fake nav picker.

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
    basenameCounts: { sase: 1, ship: 1 },
    noteTexts: notes,
    selection: "all",
    ...options,
  });
  return { plan };
}

const FIX_DAY = [
  "# 2026-10-09",
  "",
  "## Pomodoros",
  "- [ ] () — FIX",
  "\t- [[sase#^fix-apollo]]",
].join("\n");

const FIX_CLOSED = [
  { path: "sase.md", blockId: "fix-apollo", taskId: "sase__fix-apollo", text: "Fix apollo machine!" },
];

function projectNote(body) {
  return ["---", 'type: "[[project]]"', "status: wip", "---", ...body].join("\n");
}

// SO1: ^bar → sase_foo residents offered under project group, ^prj header.
test("SO1 project residents offered with ^prj header; pick mints/raises/stamps/links (SO7 dedup, SO8 unchanged, SO11 header)", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo",
    "sase_foo.md": projectNote([
      "- [?] #task #prj Foo [id:: foo__prj] [dependsOn:: sase__fix-apollo] ^prj",
      "- [ ] #task Resident one #prj_is_blocked ^res-one",
      "- [ ] #task Resident two #prj_is_blocked ^res-two",
    ]),
  };
  const { plan } = planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED });
  const byId = new Map(plan.unblocked.map((row) => [row.block_id, row]));
  assert.ok(byId.get("res-one").offer);
  assert.equal(byId.get("res-one").offer.group, "project");
  assert.ok(byId.get("res-two").offer);
  // Pick one (subset SO4): only selected links/mints/stamps.
  const { plan: subset } = planFixture({
    day: FIX_DAY, notes, closed: FIX_CLOSED,
    options: { selection: [byId.get("res-one").offer.key] },
  });
  const subById = new Map(subset.unblocked.map((row) => [row.block_id, row]));
  assert.ok(subById.get("res-one").link);
  assert.equal(subById.get("res-two").not_linked, "not_selected");
  assert.equal(subById.get("res-two").link, null);
});

// SO2–SO5/SO32: 1/6/11/20 offers, no cap, null/none/all/subset.
test("SO2–SO5 fan-outs with explicit selection (SO32 twenty)", () => {
  for (const count of [1, 6, 11, 20]) {
    const deps = [];
    for (let n = 1; n <= count; n += 1) {
      deps.push(`- [?] #task Follower ${n} [dependsOn:: sase__fix-apollo] ^f-${n}`);
    }
    const notes = {
      "sase.md": ["- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo", ...deps].join("\n"),
    };
    const { plan } = planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED });
    assert.equal(plan.unblocked.length, count);
    assert.equal(plan.placements.length, count);
    const { plan: none } = planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED, options: { selection: [] } });
    assert.equal(none.placements.length, 0);
    for (const row of none.unblocked) {
      assert.equal(row.not_linked, "not_selected");
    }
  }
});

// SO9–SO11/SO24/SO31: muted, hidden/live counts, stale [ ] offered.
test("SO9–SO11 muted/folded/stale residents (SO24 counts, SO31 inbox/ref)", () => {
  const notes = {
    "sase.md": "- [?] #task Fix apollo [id:: sase__fix-apollo] ^fix-apollo\n- [ ] #task Other open [id:: other__open] ^other-open",
    "proj.md": projectNote([
      "- [?] #task #prj P [id:: p__prj] [dependsOn:: sase__fix-apollo] ^prj",
      "- [?] #task Blocked own [dependsOn:: other__open] #prj_is_blocked ^own-blocked",
      "- [?] #task Hidden one #hide #prj_is_blocked ^hidden-one",
      "- [ ] #task Stale ready #prj_is_blocked ^stale-one",
    ]),
  };
  const { plan } = planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED });
  const muted = plan.still_blocked.find((row) => row.block_id === "own-blocked");
  assert.ok(muted);
  assert.equal(muted.project, "proj.md");
  const folded = plan.foldedByProject instanceof Map ? plan.foldedByProject.get("proj.md") : plan.foldedByProject["proj.md"];
  assert.ok(folded);
  assert.equal(folded.hidden, 1);
  const stale = plan.unblocked.find((row) => row.block_id === "stale-one");
  assert.ok(stale.offer);
  assert.ok(stale.link);
});

// SO14–SO19/SO28–SO30: implicit, no_destination, empty/parent pull-ins, kill/cancel.
test("SO14–SO19 implicit and no-destination (SO28–SO30 pull-ins, kill/cancel)", () => {
  const implicitDay = ["# 2026-10-09", "", "## Pomodoros", "- [ ] () — FIX", "\t- [[other#^x]]"].join("\n");
  const notes = { "sase.md": "- [?] #task Fix [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Dep [dependsOn:: sase__fix-apollo] ^dep" };
  const { plan } = planFixture({ day: implicitDay, notes, closed: FIX_CLOSED });
  assert.ok(plan.unblocked[0].link);
  assert.equal(plan.unblocked[0].offer.destination.entry_role, "implicit");
  const noDay = ["# 2026-10-09", "", "## Pomodoros", "- [x] () — DONE"].join("\n");
  const { plan: noDest } = planFixture({ day: noDay, notes, closed: FIX_CLOSED });
  assert.equal(noDest.unblocked[0].not_linked, "no_destination");
  const { plan: disabled } = planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED, options: { linkUnblocked: false } });
  assert.equal(disabled.unblocked[0].not_linked, "disabled");
  const { plan: cancelled } = planFixture({ day: FIX_DAY, notes, closed: FIX_CLOSED, options: { cancelled: true } });
  assert.equal(cancelled.unblocked[0].not_linked, "cancelled");
});

// Stable keys: block IDs, idless ordinals, unrelated insertions.
test("SO stable keys survive insertions/status changes; ambiguous rebinding refused", () => {
  const notes = {
    "sase.md": "- [?] #task Fix [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Same words [dependsOn:: sase__fix-apollo] ^a\n- [?] #task Same words [dependsOn:: sase__fix-apollo] ^b",
  };
  const closed = FIX_CLOSED;
  const day = FIX_DAY;
  const { plan } = planFixture({ day, notes, closed });
  const keys = plan.unblocked.map((row) => row.offer.key).sort();
  assert.ok(keys.some((key) => key.includes("#^")));
  const idless = {
    "sase.md": "- [?] #task Fix [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Duplicate words [dependsOn:: sase__fix-apollo]\n- [?] #task Duplicate words [dependsOn:: sase__fix-apollo]",
  };
  const { plan: idlessPlan } = planFixture({ day, notes: idless, closed });
  const idlessKeys = idlessPlan.unblocked.map((row) => row.offer.key).sort();
  assert.equal(new Set(idlessKeys).size, idlessKeys.length);
  assert.ok(idlessKeys.some((key) => key.includes("~2")));
  // Unrelated insertion with different digest does not shift ordinals.
  const withInsert = {
    "sase.md": "- [?] #task Fix [id:: sase__fix-apollo] ^fix-apollo\n- [?] #task Unrelated insertion here\n- [?] #task Duplicate words [dependsOn:: sase__fix-apollo]\n- [?] #task Duplicate words [dependsOn:: sase__fix-apollo]",
  };
  const { plan: inserted } = planFixture({ day, notes: withInsert, closed });
  const insertedKeys = inserted.unblocked.filter((row) => row.offer.key.includes("@")).map((row) => row.offer.key).sort();
  assert.deepEqual(insertedKeys, idlessKeys);
});

// Picker model: camelCase, headers, muted, folded; picks normalize; API detect.
test("SO picker model, pick normalization, and API detection", () => {
  const model = helpers.buildSuccessorPickerModel({
    predecessors: [{ note_path: "sase.md", block_id: "fix-apollo", text: "Fix" }],
    offers: [{ key: "sase.md#^dep", text: "Dep", notePath: "sase.md", status: "?", destination: { entry_name: "FIX" }, needsBlockId: false, group: "hand_off" }],
    stillBlocked: [],
    foldedByProject: new Map(),
    headers: new Map(),
  });
  assert.equal(model.groups[0].rows[0].key, "sase.md#^dep");
  assert.equal(model.groups[0].rows[0].selectable, true);
  assert.deepEqual(helpers.normalizeSuccessorPicks({ picks: [{ key: "a" }, { key: "a" }, {}] }), ["a"]);
  assert.deepEqual(helpers.normalizeSuccessorPicks(null), []);
  assert.deepEqual(helpers.normalizeSuccessorPicks({ picks: [] }), []);
  assert.equal(helpers.getSuccessorPickerApi({ plugins: { plugins: {} } }), null);
  assert.ok(helpers.getSuccessorPickerApi({ plugins: { plugins: { "bob-navigation-hotkeys": { api: { successors: { version: 1, pick: async () => null } } } } } }));
});

// Notice: not pulled in, no open Pomodoro, mixed, failure.
test("SO notice copy for offers (SO20, mixed, failure)", () => {
  const row = (over = {}) => ({
    text: "Dep", status_symbol: " ", status_name: "Ready", link: null, not_linked: "not_selected",
    previous_status_symbol: "?", trigger: "dependency", ...over,
  });
  assert.match(helpers.successorNoticeText({ predecessors: [], unblocked: [row()], still_blocked: [], failure: null }), /not pulled in/);
  assert.match(helpers.successorNoticeText({ predecessors: [], unblocked: [row({ not_linked: "no_destination" })], still_blocked: [], failure: null }), /no open Pomodoro/);
  assert.match(helpers.successorNoticeText({
    predecessors: [], unblocked: [row({ link: { entry_name: "FIX" }, not_linked: null }), row()], still_blocked: [], failure: null,
  }), /Pulled in 1 of 2/);
});
