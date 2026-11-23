// Requirement close-card apply (bob-cli-on.11.1.4): RV20–RV28 through the
// cycler planner + navigation `taskSplitPlanCarryReq`, plus plugin-specific
// dirty-editor / dest-change / partial-write / composed-Undo / created-file
// faults. Live `api.taskSplit.carryReq` is never substituted with ordinary
// split. Managed Done call sites stay with close_wiring.
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
} = require("./req-close-vectors.cjs");

const vectors = readFixture("task-status-cycler", "vectors.json");
const SETTINGS = {
  linked_from_mentions: true,
  linked_from_lines: true,
  inbox_route: "inbox.md",
};

function writesCase(id) {
  const found = vectors.cases.find((entry) => entry.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

function planCarryReq(files, args) {
  return navHarness.helpers.taskSplitPlanCarryReq(files, args);
}

function outcomeJson(outcome) {
  return {
    row_key: outcome.row_key,
    verdict: outcome.verdict,
    receipt: outcome.receipt,
    carried: outcome.carried,
    moves: outcome.moves,
  };
}

function metJson(entry) {
  return {
    owner_key: entry.owner_key,
    count: entry.count,
    receipt: entry.receipt,
  };
}

function planWrites(testCase) {
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  return helpers.planReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests || [],
    today: testCase.input.today || "2026-11-22",
    date: testCase.input.date || testCase.input.today || "2026-11-22",
    sha256Hex,
    planCarryReq,
    inboxRoute: "inbox.md",
  });
}

function applyPlugin(files, extra = {}) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { plugins: { plugins: {} } };
  Object.assign(plugin, extra);
  return plugin;
}

for (const testCase of vectors.cases.filter((entry) => entry.family === "writes")) {
  test(`${testCase.id} ${testCase.title}`, () => {
    const planned = planWrites(testCase);
    assert.equal(planned.ok, true, `${testCase.id} ${planned.code || ""} ${planned.message || ""}`);
    assert.deepEqual(
      (planned.outcomes || []).map(outcomeJson),
      testCase.expect.outcomes,
      `${testCase.id} outcomes`,
    );
    assert.deepEqual(
      (planned.met || []).map(metJson),
      testCase.expect.met,
      `${testCase.id} met`,
    );
    assert.deepEqual(planned.postimages, testCase.expect.postimages, `${testCase.id} postimages`);
  });
}

test("carry plus pull-in refuses until req_delivery supplies a preflight", () => {
  const testCase = writesCase("RV20");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const request = { ...(testCase.input.requests[0]), verdict: "carry_pulled" };
  const planned = helpers.planReqCloseWrites({
    notes: files,
    owners,
    requests: [request],
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    planCarryReq,
  });
  assert.equal(planned.ok, false);
  assert.equal(planned.code, "req_pull_in_unavailable");
});

test("unavailable taskSplit refuses carry and never uses ordinary split", () => {
  const testCase = writesCase("RV20");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const planned = helpers.planReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests,
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
  });
  assert.equal(planned.ok, false);
  assert.equal(planned.code, "split_unavailable");
});

test("Met writes nothing and compose restores keep earliest before to final after", () => {
  const planned = planWrites(writesCase("RV26"));
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.postimages, {});
  assert.deepEqual(planned.restores, []);
  const mixed = planWrites(writesCase("RV23"));
  assert.equal(mixed.ok, true);
  assert.equal(mixed.restores.length, 1);
  assert.equal(mixed.restores[0].path, "Tasks.md");
  const original = writesCaseFiles(writesCaseNotes(vectors, writesCase("RV23")));
  assert.equal(mixed.restores[0].before, original["Tasks.md"]);
  assert.equal(mixed.restores[0].after, mixed.postimages["Tasks.md"]);
  assert.equal(mixed.restores[0].created, false);
});

test("daily-owner carry restore marks the created inbox note", () => {
  const planned = planWrites(writesCase("RV28"));
  assert.equal(planned.ok, true);
  const created = planned.restores.find((entry) => entry.path === "inbox.md");
  assert.ok(created);
  assert.equal(created.created, true);
  assert.equal(created.before, "");
  assert.equal(created.after, planned.postimages["inbox.md"]);
});

test("applyReqCloseWrites uses the injected planner when no live carry API exists", async () => {
  const testCase = writesCase("RV27");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const plugin = applyPlugin(files);
  const result = await plugin.applyReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests,
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    planCarryReq,
  });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.postimages, testCase.expect.postimages);
});

test("a dirty editor that no longer matches expectedNotes is stale", async () => {
  const testCase = writesCase("RV27");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const plugin = applyPlugin(files);
  plugin.readSuccessorNoteText = async () => `${files["Tasks.md"]}\t- human edit\n`;
  const result = await plugin.applyReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests,
    expectedNotes: files,
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    planCarryReq,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "req_close_stale");
});

test("an edit outside the owner block stays fresh with expectedNotes", async () => {
  const testCase = writesCase("RV20");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const plugin = applyPlugin(files);
  plugin.readSuccessorNoteText = async () => (
    `---\nopen_task_count: 2\n---\n${files["Tasks.md"]}`
  );
  const result = await plugin.applyReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests,
    expectedNotes: files,
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    planCarryReq,
  });
  assert.equal(result.ok, true, result.message);
});

test("a changed owner-block postimage is stale before any write", async () => {
  const testCase = writesCase("RV20");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  const planned = helpers.planReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests,
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    planCarryReq,
    expectedOwnerPostimages: { [owners[0].key]: "not the owner block" },
  });
  assert.equal(planned.ok, false);
  assert.equal(planned.code, "req_close_stale");
});

test("partial live carry reports failures and never claims the unapplied row", async () => {
  const testCase = writesCase("RV23");
  const notes = writesCaseNotes(vectors, testCase);
  const files = writesCaseFiles(notes);
  const { owners } = collectCase(helpers, { notes });
  let calls = 0;
  const plugin = applyPlugin(files);
  const result = await plugin.applyReqCloseWrites({
    notes: files,
    owners,
    requests: testCase.input.requests,
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    carryReq: async (request) => {
      calls += 1;
      if (calls > 1) {
        return { ok: false, code: "split_unavailable", message: "injected persist failure" };
      }
      const planned = planCarryReq(files, {
        ...request,
        today: "2026-11-22",
        settings: SETTINGS,
      });
      if (!planned.ok) return planned;
      for (const [path, after] of Object.entries(planned.plan.files || {})) {
        files[path] = after;
      }
      return {
        ok: true,
        task: planned.task,
        moveMap: planned.moveMap,
        restores: Object.entries(planned.plan.files || {}).map(([path, after]) => ({
          path,
          before: writesCaseFiles(notes)[path] || "",
          after,
          created: !Object.prototype.hasOwnProperty.call(writesCaseFiles(notes), path),
        })),
      };
    },
    persistDrop: async () => ({ ok: false, reason: "injected drop failure" }),
  });
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.failures) && result.failures.length >= 1);
  assert.equal(
    (result.outcomes || []).some((row) => row.verdict === "drop"),
    false,
    "unapplied drop is not a successful outcome",
  );
});

test("post-close Done owner still carries an open requirement", () => {
  const pre = [
    "- [ ] #task Ship the exporter ^export",
    "\t- [ ] Handles empty input",
  ];
  const post = [
    "- [x] #task Ship the exporter [completion:: 2026-11-22] ^export",
    "\t- [ ] Handles empty input",
  ];
  const notes = [{ path: "Tasks.md", source_lines: pre, closing: [{ block_id: "export" }] }];
  const { owners, groups } = collectCase(helpers, { notes });
  const key = groups[0].rows[0].offer.key;
  const planned = helpers.planReqCloseWrites({
    notes: { "Tasks.md": `${post.join("\n")}\n` },
    owners,
    requests: [{ selector: key, verdict: "carry", reason: null }],
    today: "2026-11-22",
    date: "2026-11-22",
    sha256Hex,
    planCarryReq,
  });
  assert.equal(planned.ok, true, planned.message);
  assert.equal(planned.outcomes[0].verdict, "carry");
  assert.match(planned.postimages["Tasks.md"], /\[>\]/);
  assert.match(planned.postimages["Tasks.md"], /\[x\] #task Ship the exporter/);
});
