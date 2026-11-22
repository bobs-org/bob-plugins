// Pinned-requirement jump landings (bob-cli-on.11.1.5): RV36–RV43 through
// the cycler planner + navigation `taskSplitPlanCarryReq` + pin resolver,
// plus lost/ambiguous fault coverage. Placement lives in
// `test-task-status-cycler-req-close-pull-in.cjs`. Managed Done call sites
// stay with close_wiring.
const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers } = require("./task-status-cycler-harness.cjs");
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

function jumpCase(id) {
  const found = vectors.cases.find((entry) => entry.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

function planCarryReq(files, args) {
  return navHarness.helpers.taskSplitPlanCarryReq(files, args);
}

// The jump families carry no day context (Rust runs no placement there),
// so the runner uses an allow-all destination preflight: the gate itself
// is covered by the pull-in tests.
function allowAllPullIn() {
  return { ok: true };
}

function enclosingTaskId(text, line) {
  const body = String(text == null ? "" : text);
  const endOf = (task) => String(body.slice(0, Math.min(task.blockEnd || 0, body.length)))
    .replace(/\n+$/, "")
    .split("\n").length;
  const candidates = helpers
    .taskReqNoteTasks(body)
    .filter((task) => task.lineIndex < line && line - 1 <= endOf(task));
  candidates.sort((left, right) => left.lineIndex - right.lineIndex);
  const best = candidates[candidates.length - 1];
  return best ? best.blockId || best.description : null;
}

function resolveCase(testCase, finals) {
  const input = testCase.input;
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const selection = helpers.reqCloseResolveVerdicts(
    owners,
    [],
    input.requests || [],
    input.jump || null,
    sha256Hex,
  );
  assert.equal(selection.ok, true, `${testCase.id} select ${selection.code || ""}`);
  const planned = helpers.planReqCloseWrites({
    notes: files,
    owners,
    requests: input.requests || [],
    today: input.today || "2026-11-22",
    date: input.date || input.today || "2026-11-22",
    sha256Hex,
    planCarryReq,
    inboxRoute: "inbox.md",
    pullInPreflight: allowAllPullIn,
  });
  assert.equal(planned.ok, true, `${testCase.id} plan ${planned.code || ""} ${planned.message || ""}`);
  const finalNotes = { ...files, ...planned.postimages };
  if (input.final_notes) {
    for (const [path, lineList] of Object.entries(input.final_notes)) {
      if (lineList === null) delete finalNotes[path];
      else finalNotes[path] = sourceOf({ source_lines: lineList });
    }
  }
  Object.assign(finalNotes, finals || {});
  const finalText = (path) => (typeof finalNotes[path] === "string" ? finalNotes[path] : null);
  const routes = (input.routes || []).map((route) => ({
    source: route.source,
    dest: route.dest,
    old_block_id: route.old_block_id == null ? null : route.old_block_id,
    new_block_id: route.new_block_id == null ? null : route.new_block_id,
  }));
  const resolved = helpers.resolveReqLanding(
    {
      target: selection.jump && selection.jump.requirement,
      owners,
      plan: { outcomes: planned.outcomes },
      routes,
    },
    finalText,
  );
  return { finalNotes, planned, resolved };
}

function landingJson(finalNotes, planned, resolved) {
  assert.equal(resolved.ok, true, `${resolved.code || ""} ${resolved.message || ""}`);
  const landing = resolved.landing;
  const text = String(finalNotes[landing.path] || "").split("\n")[landing.line - 1];
  const carried = {};
  for (const outcome of planned.outcomes) {
    if (outcome.carried) carried[outcome.path] = outcome.carried.block_id;
  }
  return {
    carried,
    landing: {
      block_id: landing.blockId,
      in_task: enclosingTaskId(finalNotes[landing.path], landing.line),
      kind: landing.kind,
      line: landing.line,
      outcome: landing.outcome,
      path: landing.path,
      text,
    },
    postimage_count: Object.keys(planned.postimages || {}).length,
  };
}

function finalsWith(testCase, overrides) {
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
    pullInPreflight: allowAllPullIn,
  });
  assert.equal(planned.ok, true, `${testCase.id} plan`);
  const finalNotes = { ...files, ...planned.postimages };
  if (input.final_notes) {
    for (const [path, lineList] of Object.entries(input.final_notes)) {
      if (lineList === null) delete finalNotes[path];
      else finalNotes[path] = sourceOf({ source_lines: lineList });
    }
  }
  return { finalNotes: { ...finalNotes, ...overrides }, owners, planned };
}

for (const testCase of vectors.cases.filter((entry) => entry.family === "jump")) {
  test(`${testCase.id} ${testCase.title}`, () => {
    const { finalNotes, planned, resolved } = resolveCase(testCase);
    if (testCase.expect.refusal) {
      assert.equal(resolved.ok, false);
      assert.equal(resolved.code, testCase.expect.refusal);
      return;
    }
    assert.deepEqual(landingJson(finalNotes, planned, resolved), testCase.expect, testCase.id);
  });
}

test("a deleted owner note loses the pin instead of landing elsewhere", () => {
  const testCase = jumpCase("RV42");
  const { finalNotes, owners, planned } = finalsWith(testCase, {});
  delete finalNotes["Tasks.md"];
  const selection = helpers.reqCloseResolveVerdicts(
    owners,
    [],
    testCase.input.requests || [],
    testCase.input.jump || null,
    sha256Hex,
  );
  const resolved = helpers.resolveReqLanding(
    {
      target: selection.jump && selection.jump.requirement,
      owners,
      plan: { outcomes: planned.outcomes },
      routes: [],
    },
    (path) => (typeof finalNotes[path] === "string" ? finalNotes[path] : null),
  );
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "req_jump_lost");
});

test("a duplicated created block is ambiguous, never first-match", () => {
  const testCase = jumpCase("RV36");
  const { finalNotes, owners, planned } = finalsWith(testCase, {});
  finalNotes["Tasks.md"] = `${finalNotes["Tasks.md"]}- [ ] #task Duplicate twin ^handles-empty-input\n`;
  const selection = helpers.reqCloseResolveVerdicts(
    owners,
    [],
    testCase.input.requests || [],
    testCase.input.jump || null,
    sha256Hex,
  );
  const resolved = helpers.resolveReqLanding(
    {
      target: selection.jump && selection.jump.requirement,
      owners,
      plan: { outcomes: planned.outcomes },
      routes: [],
    },
    (path) => (typeof finalNotes[path] === "string" ? finalNotes[path] : null),
  );
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "req_jump_ambiguous");
});

test("a move map that disagrees with the structure is ambiguous", () => {
  const testCase = jumpCase("RV37");
  const { finalNotes, owners, planned } = finalsWith(testCase, {});
  const tampered = JSON.parse(JSON.stringify(planned.outcomes));
  const carried = tampered.find((outcome) => outcome.carried);
  assert.ok(carried, "RV37 carries");
  assert.ok(carried.moves.length > 0, "RV37 has moves");
  carried.moves = carried.moves.map((move) => ({ from: move.from, to: move.to + 1 }));
  const selection = helpers.reqCloseResolveVerdicts(
    owners,
    [],
    testCase.input.requests || [],
    testCase.input.jump || null,
    sha256Hex,
  );
  const resolved = helpers.resolveReqLanding(
    {
      target: selection.jump && selection.jump.requirement,
      owners,
      plan: { outcomes: tampered },
      routes: [],
    },
    (path) => (typeof finalNotes[path] === "string" ? finalNotes[path] : null),
  );
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "req_jump_ambiguous");
});

test("an identical twin line below never steals the pin", () => {
  const testCase = jumpCase("RV42");
  const { finalNotes, owners, planned } = finalsWith(testCase, {});
  const selection = helpers.reqCloseResolveVerdicts(
    owners,
    [],
    testCase.input.requests || [],
    testCase.input.jump || null,
    sha256Hex,
  );
  const target = selection.jump && selection.jump.requirement;
  const lines = String(finalNotes[target.owner_path]).split("\n");
  lines.splice(target.line, 0, lines[target.line - 1]);
  finalNotes[target.owner_path] = lines.join("\n");
  const resolved = helpers.resolveReqLanding(
    { target, owners, plan: { outcomes: planned.outcomes }, routes: [] },
    (path) => (typeof finalNotes[path] === "string" ? finalNotes[path] : null),
  );
  assert.equal(resolved.ok, true, resolved.message);
  assert.equal(resolved.landing.kind, "requirement");
  assert.equal(resolved.landing.path, target.owner_path);
  assert.equal(resolved.landing.line, target.line);
});
