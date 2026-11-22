// Requirement pull-in placement (bob-cli-on.11.1.5): RV29–RV35 through the
// cycler planner + navigation `taskSplitPlanCarryReq` + pull-in preflight,
// plus plugin-specific no-destination, stale-created-task,
// dirty-destination, router, skip-if-live, live-boundary, and composed-Undo
// faults. Pin resolution lives in
// `test-task-status-cycler-req-close-landing.cjs`. Managed Done call sites
// stay with close_wiring.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  TaskStatusCyclerPlugin,
} = require("./task-status-cycler-harness.cjs");
const navHarness = require("./navigation-hotkeys-harness.cjs");
const {
  readFixture,
  sha256Hex,
  collectCase,
  writesCaseNotes,
  writesCaseFiles,
  sourceOf,
} = require("./req-close-vectors.cjs");

const vectors = readFixture("task-status-cycler", "vectors.json");
const SETTINGS = {
  linked_from_mentions: true,
  linked_from_lines: true,
  inbox_route: "inbox.md",
};

function placementCase(id) {
  const found = vectors.cases.find((entry) => entry.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

function planCarryReq(files, args) {
  return navHarness.helpers.taskSplitPlanCarryReq(files, args);
}

function normalizeCompleted(list) {
  return (list || []).map((entry) => ({
    path: entry.path,
    blockId: entry.block_id,
    isRoot: entry.is_root === true,
  }));
}

function normalizeClosing(closing) {
  if (!closing) return null;
  return {
    continuationName: closing.continuation_name || "",
    closedLine: closing.closed_line,
    continuation: closing.continuation
      ? { line: closing.continuation.line, created: closing.continuation.created === true }
      : null,
  };
}

function dayPretext(testCase, files) {
  if (testCase.input.day.source_lines) {
    return sourceOf({ source_lines: testCase.input.day.source_lines });
  }
  return files[testCase.input.day.path];
}

function preflightFor(testCase, dayText) {
  const input = testCase.input;
  return helpers.createReqPullInPreflight({
    day: dayText,
    dayPath: input.day.path,
    index: input.index || [],
    completed: normalizeCompleted(input.completed),
    closing: normalizeClosing(input.closing),
  });
}

function planPlacement(testCase, pullInPreflight) {
  const input = testCase.input;
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const planned = helpers.planReqCloseWrites({
    notes: files,
    owners,
    requests: input.requests || [],
    today: input.today || "2026-11-22",
    date: input.date || input.today || "2026-11-22",
    sha256Hex,
    planCarryReq,
    inboxRoute: "inbox.md",
    pullInPreflight,
  });
  return { owners, files, planned };
}

function linkJson(link) {
  return {
    row_key: link.rowKey,
    path: link.path,
    block_id: link.blockId,
    previous_status: link.previousStatus,
    status: link.status,
    entry_name: link.link.entryName,
    entry_role: link.destination.entryRole,
    fallback: link.destination.fallback,
    entry_line: link.link.entryLine,
    line: link.link.line,
    block_link: link.link.blockLink,
    entry_created: link.link.entryCreated,
  };
}

function linkPlacement(testCase, owners, files, planned) {
  const input = testCase.input;
  const after = { ...files, ...planned.postimages };
  const dayText = input.day.source_lines
    ? sourceOf({ source_lines: input.day.source_lines })
    : after[input.day.path];
  return {
    after,
    dayText,
    result: helpers.planReqPullInLinks({
      owners,
      outcomes: planned.outcomes,
      day: dayText,
      dayPath: input.day.path,
      index: input.index || [],
      completed: normalizeCompleted(input.completed),
      closing: normalizeClosing(input.closing),
      notes: after,
    }),
  };
}

for (const testCase of vectors.cases.filter((entry) => entry.family === "placement")) {
  if (testCase.expect.refusal) continue;
  test(`${testCase.id} ${testCase.title}`, () => {
    const preflight = preflightFor(testCase, dayPretext(testCase, writesCaseFiles(writesCaseNotes(vectors, testCase))));
    const { owners, files, planned } = planPlacement(testCase, preflight);
    assert.equal(planned.ok, true, `${testCase.id} plan ${planned.code || ""} ${planned.message || ""}`);
    const { result } = linkPlacement(testCase, owners, files, planned);
    assert.equal(result.ok, true, `${testCase.id} link ${result.code || ""} ${result.message || ""}`);
    assert.deepEqual(result.links.map(linkJson), testCase.expect.links, `${testCase.id} links`);
    assert.deepEqual(result.notesAfter, testCase.expect.notes_after, `${testCase.id} notes`);
    assert.equal(result.dayAfter, testCase.expect.day_after, `${testCase.id} day`);
  });
}

test("RV35 a pulled carry with no open entry refuses the whole batch", () => {
  const testCase = placementCase("RV35");
  const preflight = preflightFor(testCase, dayPretext(testCase, writesCaseFiles(writesCaseNotes(vectors, testCase))));
  const { planned } = planPlacement(testCase, preflight);
  assert.equal(planned.ok, false);
  assert.equal(planned.code, "req_pull_in_no_destination");
});

test("preflight accepts a slotted carry and refuses a ledger with no open entry", () => {
  const slotted = placementCase("RV29");
  const slotFiles = writesCaseFiles(writesCaseNotes(vectors, slotted));
  const slotOwners = collectCase(helpers, { notes: writesCaseNotes(vectors, slotted) }).owners;
  const slotVerdicts = [{
    row: { key: "row", owner_key: slotOwners[0].key, owner_path: "Tasks.md", owner_block_id: "export" },
    verdict: "carry_pulled",
  }];
  const slotDay = dayPretext(slotted, slotFiles);
  const accept = preflightFor(slotted, slotDay)({
    owners: slotOwners,
    verdicts: slotVerdicts,
    notes: slotFiles,
  });
  assert.equal(accept.ok, true);

  const closed = placementCase("RV35");
  const closedFiles = writesCaseFiles(writesCaseNotes(vectors, closed));
  const closedOwners = collectCase(helpers, { notes: writesCaseNotes(vectors, closed) }).owners;
  const closedVerdicts = [{
    row: { key: "row", owner_key: closedOwners[0].key, owner_path: "Tasks.md", owner_block_id: "export" },
    verdict: "carry_pulled",
  }];
  const refused = preflightFor(closed, dayPretext(closed, closedFiles))({
    owners: closedOwners,
    verdicts: closedVerdicts,
    notes: closedFiles,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "req_pull_in_no_destination");
});

test("a renamed created task is stale at placement time", () => {
  const testCase = placementCase("RV29");
  const preflight = preflightFor(testCase, dayPretext(testCase, writesCaseFiles(writesCaseNotes(vectors, testCase))));
  const { owners, files, planned } = planPlacement(testCase, preflight);
  assert.equal(planned.ok, true, planned.message);
  const after = { ...files, ...planned.postimages };
  const tampered = {
    ...after,
    "Tasks.md": String(after["Tasks.md"]).replace(
      "[created:: 2026-11-22] ^handles-empty-input",
      "[created:: 2026-11-22] ^handles-renamed",
    ),
  };
  const result = helpers.planReqPullInLinks({
    owners,
    outcomes: planned.outcomes,
    day: dayPretext(testCase, files),
    dayPath: testCase.input.day.path,
    index: testCase.input.index || [],
    completed: normalizeCompleted(testCase.input.completed),
    closing: normalizeClosing(testCase.input.closing),
    notes: tampered,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "req_close_stale");
});

test("a destination that vanishes after preflight refuses instead of linking elsewhere", () => {
  const testCase = placementCase("RV29");
  const preflight = preflightFor(testCase, dayPretext(testCase, writesCaseFiles(writesCaseNotes(vectors, testCase))));
  const { owners, files, planned } = planPlacement(testCase, preflight);
  assert.equal(planned.ok, true, planned.message);
  const after = { ...files, ...planned.postimages };
  const closedDay = "## Pomodoros\n- [x] (**0920-0950**) \u2014 CAPTURE\n  - ~~[[Tasks#^export]]~~\n";
  const result = helpers.planReqPullInLinks({
    owners,
    outcomes: planned.outcomes,
    day: closedDay,
    dayPath: testCase.input.day.path,
    index: testCase.input.index || [],
    completed: normalizeCompleted(testCase.input.completed),
    closing: normalizeClosing(testCase.input.closing),
    notes: after,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "req_pull_in_no_destination");
});

test("a routing refusal never becomes an unlinked carry", () => {
  const testCase = placementCase("RV29");
  const preflight = preflightFor(testCase, dayPretext(testCase, writesCaseFiles(writesCaseNotes(vectors, testCase))));
  const { owners, files, planned } = planPlacement(testCase, preflight);
  assert.equal(planned.ok, true, planned.message);
  const after = { ...files, ...planned.postimages };
  const result = helpers.planReqPullInLinks({
    owners,
    outcomes: planned.outcomes,
    day: dayPretext(testCase, files),
    dayPath: testCase.input.day.path,
    index: testCase.input.index || [],
    completed: normalizeCompleted(testCase.input.completed),
    closing: normalizeClosing(testCase.input.closing),
    notes: after,
    routePulledTask: () => ({ refusal: { code: "typed_no_match", message: "no type route" } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "req_pull_in_no_destination");
});

test("a created task already live in an open entry gains no second bullet", () => {
  const testCase = placementCase("RV29");
  const preflight = preflightFor(testCase, dayPretext(testCase, writesCaseFiles(writesCaseNotes(vectors, testCase))));
  const { owners, files, planned } = planPlacement(testCase, preflight);
  assert.equal(planned.ok, true, planned.message);
  const after = { ...files, ...planned.postimages };
  const relinkedDay = `${dayPretext(testCase, files).replace(
    "  - [[Tasks#^export]]\n",
    "  - [[Tasks#^export]]\n  - [[Tasks#^handles-empty-input]]\n",
  )}`;
  const result = helpers.planReqPullInLinks({
    owners,
    outcomes: planned.outcomes,
    day: relinkedDay,
    dayPath: testCase.input.day.path,
    index: testCase.input.index || [],
    completed: normalizeCompleted(testCase.input.completed),
    closing: normalizeClosing(testCase.input.closing),
    notes: after,
  });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.links, []);
  assert.equal(result.dayAfter, null);
  assert.match(result.notesAfter["Tasks.md"], /-\s+\[\*\] #task Handles empty input/);
});

test("placement merges into the apply snapshots with earliest-before restores", () => {
  const testCase = placementCase("RV34");
  const files = writesCaseFiles(writesCaseNotes(vectors, testCase));
  const preflight = preflightFor(testCase, dayPretext(testCase, files));
  const { owners, planned } = planPlacement(testCase, preflight);
  assert.equal(planned.ok, true, planned.message);
  const { after, result } = linkPlacement(testCase, owners, files, planned);
  assert.equal(result.ok, true, result.message);
  const composed = helpers.composeReqCloseRestores([...planned.restores, ...result.restores]);
  const byPath = new Map(composed.map((entry) => [entry.path, entry]));
  const dayPath = testCase.input.day.path;
  assert.equal(byPath.get(dayPath).before, files[dayPath]);
  assert.equal(byPath.get(dayPath).after, result.dayAfter);
  const inbox = byPath.get("inbox.md");
  assert.ok(inbox);
  assert.equal(inbox.created, true);
  assert.equal(inbox.before, "");
  assert.equal(inbox.after, result.notesAfter["inbox.md"]);
});

function applyPlugin(files, extra = {}) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { plugins: { plugins: {} } };
  Object.assign(plugin, extra);
  return plugin;
}

test("live carry plus preflight applies, then placement links through the apply result", async () => {
  const testCase = placementCase("RV29");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const dayText = dayPretext(testCase, files);
  const preflight = preflightFor(testCase, dayText);
  const plugin = applyPlugin(files);
  const applied = await plugin.applyReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests,
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    carryReq: async (request) => {
      const planned = planCarryReq(files, { ...request, today: "2026-11-22", settings: SETTINGS });
      if (!planned.ok) return planned;
      for (const [path, text] of Object.entries(planned.plan.files || {})) files[path] = text;
      return {
        ok: true,
        task: planned.task,
        moveMap: planned.moveMap,
        restores: Object.entries(planned.plan.files || {}).map(([path, text]) => ({
          path,
          before: writesCaseFiles(notes)[path] || "",
          after: text,
          created: !Object.prototype.hasOwnProperty.call(writesCaseFiles(notes), path),
        })),
      };
    },
    pullInPreflight: preflight,
  });
  assert.equal(applied.ok, true, applied.message);
  const result = helpers.planReqPullInLinks({
    owners,
    outcomes: applied.outcomes,
    day: dayText,
    dayPath: testCase.input.day.path,
    index: testCase.input.index || [],
    completed: normalizeCompleted(testCase.input.completed),
    closing: normalizeClosing(testCase.input.closing),
    notes: applied.notes,
  });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.links.map(linkJson), testCase.expect.links);
});
