// Requirement close-card twins (bob-cli-on.11.1.2): every RV1–RV19 (and RV44)
// vector runs through the built cycler's exported helpers. bob-cli owns the
// fixture; the plugin copies it byte for byte. Later RV families stay intact
// for later phases.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./task-status-cycler-harness.cjs");
const {
  CANONICAL_DIR,
  REQ_CLOSE_FIXTURE_FILES,
  fixtureDir,
  readFixture,
  sha256Hex,
  collectCase,
  collectChoiceCase,
  ownerJson,
  groupJson,
} = require("./req-close-vectors.cjs");

const FIXTURE_DIR = fixtureDir("task-status-cycler");
const vectors = readFixture("task-status-cycler", "vectors.json");
const {
  REQ_CLOSE_COPY,
  TASK_REQ_MAX_DEPTH,
  reqCloseQuoted,
  reqCloseGroupTitle,
  reqCloseScope,
  reqCloseHistory,
  reqCloseOverlap,
  reqCloseNestedGoWithIt,
  reqCloseMetReceipt,
  reqCloseHumanMetLine,
  reqCloseDropReceipt,
  reqCloseCarryReceipt,
  reqCloseSummary,
  reqCloseAccessibility,
  reqCloseWouldMet,
  reqCloseCollectOwner,
  reqCloseCollectOwners,
  reqCloseGroupsFromOwners,
  reqClosePendingCount,
  reqClosePendingBranches,
  reqCloseCardNumbering,
  reqCloseResolveVerdicts,
  reqCloseRevalidatePreimages,
  reqCloseChoiceState,
  taskReqNoteTasks,
} = helpers;

function caseOf(id) {
  const found = vectors.cases.find((entry) => entry.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

function rowKey(groups, pathText) {
  for (const group of groups) {
    const row = group.rows.find((entry) => entry.path === pathText);
    if (row) return row.offer.key;
  }
  throw new Error(`missing requirement path ${pathText}`);
}

test("fixture copies match bob-cli byte for byte when the bob-cli checkout is present", (t) => {
  if (!fs.existsSync(CANONICAL_DIR)) {
    t.skip("bob-cli fixtures are not beside this checkout");
    return;
  }
  for (const name of REQ_CLOSE_FIXTURE_FILES) {
    assert.ok(
      fs.readFileSync(path.join(FIXTURE_DIR, name)).equals(fs.readFileSync(path.join(CANONICAL_DIR, name))),
      `${name} is a byte-for-byte copy of bob-cli's fixture`,
    );
  }
});

test("RV fixture lists every row case without renumbering", () => {
  assert.equal(vectors.schema_version, 1);
  assert.equal(vectors.family, "rows");
  assert.equal(vectors.contract, "docs/task-requirements.md §7");
  const rowCases = vectors.cases.filter((entry) => entry.family === "rows");
  assert.equal(rowCases.length, 11, "family rows freezes RV1–RV11");
  rowCases.forEach((entry, index) => assert.equal(entry.id, `RV${index + 1}`));
});

test("copy catalog matches the shared fixture", () => {
  const catalog = vectors.copy;
  assert.equal(REQ_CLOSE_COPY.WHY, catalog.why);
  assert.equal(REQ_CLOSE_COPY.DROP_PROMPT, catalog.drop_prompt);
  assert.equal(REQ_CLOSE_COPY.FOOTER, catalog.footer);
  assert.equal(REQ_CLOSE_COPY.JUMP_HINT, catalog.jump_hint);
  assert.equal(REQ_CLOSE_COPY.HINT, catalog.hint);
  assert.equal(REQ_CLOSE_COPY.TEACHING, catalog.teaching);
  assert.equal(reqCloseOverlap("ancestor"), catalog.overlap.replace("{ancestor}", "ancestor"));
  assert.equal(reqCloseNestedGoWithIt(3), catalog.nested_go_with_it.replace("{k}", "3"));
  assert.equal(reqCloseMetReceipt(4, "S"), catalog.met_receipt.replace("{n}", "4").replace("{S}", "S"));
  assert.equal(reqCloseHumanMetLine(4, "S"), catalog.human_met.replace("{n}", "4").replace("{S}", "S"));
  assert.equal(reqCloseDropReceipt("T", null), catalog.drop_receipt.replace("{T}", "T"));
  assert.equal(reqCloseDropReceipt("T", "because"), "⊘ Dropped “T” · “because”");
  assert.equal(reqCloseCarryReceipt("T", false), catalog.carry_receipt.replace("{T}", "T"));
  assert.equal(reqCloseCarryReceipt("T", true), catalog.carry_pulled_receipt.replace("{T}", "T"));
  assert.equal(reqCloseSummary(4, 1, 1), catalog.summary);
  assert.equal(reqCloseAccessibility(2, "will be dropped"), catalog.accessibility);
  assert.equal(reqCloseWouldMet(4, "S"), "would meet 4 requirements with “S”");
  assert.equal(reqCloseQuoted("Ship"), "“Ship”");
  assert.equal(reqCloseGroupTitle("Ship the exporter"), "Requirements · “Ship the exporter”");
  assert.equal(reqCloseScope(1, 1), "1 requirement");
  assert.equal(reqCloseScope(4, 1), "4 requirements");
  assert.equal(reqCloseScope(2, 2), "2 requirements in 2 branches");
  assert.equal(reqCloseHistory(0, 0, 0), null);
  assert.equal(reqCloseHistory(1, 0, 0), "· 1 dropped earlier");
  assert.equal(reqCloseHistory(1, 1, 1), "· 1 dropped earlier · 1 carried earlier · 1 met earlier");
});

for (const testCase of vectors.cases.filter((entry) => entry.family === "rows")) {
  test(`${testCase.id} ${testCase.title}`, () => {
    const { owners, groups } = collectCase(helpers, testCase);
    assert.deepEqual(owners.map(ownerJson), testCase.expect.owners, `${testCase.id} owners`);
    assert.deepEqual(groups.map(groupJson), testCase.expect.groups, `${testCase.id} groups`);
    for (const [index, owner] of owners.entries()) {
      const pending = (testCase.expect.groups.find((group) => group.owner.key === owner.key)?.rows || []).length;
      assert.equal(reqClosePendingCount(owner), pending, `${testCase.id} pending_count`);
      assert.equal(
        owner.key,
        helpers.reqCloseOwnerSnapshotKey(owner.task_key, owner.preimage, sha256Hex),
        `${testCase.id} snapshot key binds the preimage`,
      );
      assert.ok(
        owner.preimage.includes(owner.task_line) || owner.task_line === "",
        `${testCase.id} task_line sits inside the preimage`,
      );
      assert.equal(owner.task_key, testCase.expect.owners[index].task_key);
    }
  });
}

test("resolved folds keep historical nodes off the group", () => {
  const { owners, groups } = collectCase(helpers, caseOf("RV6"));
  const owner = owners[0];
  assert.deepEqual(owner.nodes.map((node) => node.state), ["pending", "dropped", "excluded", "carried", "met"]);
  assert.deepEqual(owner.nodes.map((node) => node.mark), ["open", "dropped", "open", "carried", "legacy-met"]);
  assert.equal(owner.nodes[2].text, "Excluded child");
  assert.equal(owner.nodes[3].text, "[[#^carried|Carried]]");
  assert.equal(reqClosePendingCount(owner), 1);
  assert.equal(reqClosePendingBranches(owner), 1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].rows[0].text, "Live");
  assert.equal(groups[0].folded.dropped, 1);
  assert.equal(groups[0].folded.carried, 1);
  assert.equal(groups[0].folded.met, 1);
});

test("note interrupt omits the nested checkbox", () => {
  const { owners } = collectCase(helpers, caseOf("RV3"));
  assert.deepEqual(owners[0].nodes.map((node) => node.text), ["Real req", "Another req"]);
});

test("identical block hashes stay distinct through task_key", () => {
  const { owners } = collectCase(helpers, caseOf("RV11"));
  assert.equal(owners.length, 2);
  const leftHash = owners[0].key.split("@").pop();
  const rightHash = owners[1].key.split("@").pop();
  assert.equal(leftHash, rightHash);
  assert.notEqual(owners[0].task_key, owners[1].task_key);
  assert.notEqual(owners[0].key, owners[1].key);
});

test("depth above max is kept not truncated", () => {
  const lines = ["- [ ] #task Deep ^deep"];
  for (let depth = 1; depth <= TASK_REQ_MAX_DEPTH + 1; depth += 1) {
    lines.push(`${"\t".repeat(depth)}- [ ] d${depth}`);
  }
  const contents = `${lines.join("\n")}\n`;
  const task = taskReqNoteTasks(contents).find((row) => row.blockId === "deep");
  const owner = reqCloseCollectOwner(contents, "Tasks.md", task, sha256Hex);
  assert.ok(owner.depth_exceeded);
  assert.equal(owner.nodes.length, TASK_REQ_MAX_DEPTH + 1);
  const last = owner.nodes[owner.nodes.length - 1];
  assert.equal(last.depth, TASK_REQ_MAX_DEPTH + 1);
  assert.equal(last.depth_exceeded, true);
  assert.equal(last.state, "pending");
  assert.equal(reqClosePendingCount(owner), TASK_REQ_MAX_DEPTH + 1);
  const groups = reqCloseGroupsFromOwners([owner]);
  assert.equal(groups[0].rows.length, TASK_REQ_MAX_DEPTH + 1);
  assert.equal(groups[0].rows[groups[0].rows.length - 1].depth_exceeded, true);
});

test("choices vectors have stable ids and cover every verdict pair", () => {
  const cases = vectors.cases.filter((entry) => entry.family === "choices");
  assert.equal(cases.length, 9);
  assert.deepEqual(cases.map((entry) => entry.id), ["RV12", "RV13", "RV14", "RV15", "RV16", "RV17", "RV18", "RV19", "RV44"]);
  const vector = caseOf("RV12");
  const { owners } = collectChoiceCase(helpers, vectors, vector);
  const key = vector.input.key;
  const inputs = vector.input.pairs;
  const expected = vector.expect.pair_results;
  assert.equal(inputs.length, expected.length);
  for (let index = 0; index < inputs.length; index += 1) {
    const pair = inputs[index];
    assert.equal(pair.result, expected[index].result);
    const result = reqCloseResolveVerdicts(owners, [], [
      { selector: key, verdict: pair.left },
      { selector: key, verdict: pair.right },
    ], null, sha256Hex);
    if (expected[index].result === "idempotent") {
      assert.equal(result.ok, true, `${pair.left}/${pair.right} should be idempotent`);
      assert.equal(result.verdicts.length, 1);
    } else {
      assert.equal(result.ok, false);
      assert.equal(result.code, "offer_verdict_conflict");
    }
  }
});

test("structural overlap refuses but a navigation pin stays independent", () => {
  const overlap = caseOf("RV13");
  const { owners: overlapOwners } = collectChoiceCase(helpers, vectors, overlap);
  const error = reqCloseResolveVerdicts(overlapOwners, [], overlap.input.requests, null, sha256Hex);
  assert.equal(error.ok, false);
  assert.equal(error.code, overlap.expect.error_code);

  const pin = caseOf("RV14");
  const { owners: pinOwners } = collectChoiceCase(helpers, vectors, pin);
  const selected = reqCloseResolveVerdicts(pinOwners, [], pin.input.requests, pin.input.jump, sha256Hex);
  assert.equal(selected.ok, true);
  assert.equal(selected.verdicts.length, 1);
  assert.equal(selected.verdicts[0].row.key, pin.expect.verdicts[0].key);
  assert.equal(selected.verdicts[0].verdict, pin.expect.verdicts[0].verdict);
  assert.equal(selected.jump.card_row.kind, "requirement");
  assert.equal(selected.jump.card_row.key, pin.expect.jump.key);
  assert.equal(selected.jump.requirement.owner_task_key, "Tasks.md#^export");
});

test("shared numbering and mark-all keep requirement rows out of task picks", () => {
  const vector = caseOf("RV15");
  const { owners } = collectChoiceCase(helpers, vectors, vector);
  const offers = vector.input.task_offer_keys;
  const selected = reqCloseResolveVerdicts(owners, offers, [], null, sha256Hex);
  assert.equal(selected.ok, true);
  assert.deepEqual(
    selected.numbering.rows.map((row) => ({ key: row.key, n: row.n, kind: row.kind })),
    vector.expect.numbered,
  );
  assert.deepEqual(selected.numbering.markAllKeys(), offers);
  assert.deepEqual(selected.groups[0].rows.map((row) => row.offer.n), [1, 2, 3, 4]);
  const legacy = reqCloseCardNumbering([], offers);
  assert.deepEqual(legacy.rows.map((row) => row.n), [1, 2]);
});

test("staged fold hides without discarding and restaging met unfolds", () => {
  const vector = caseOf("RV16");
  const { owners, groups } = collectChoiceCase(helpers, vectors, vector);
  const group = groups[0];
  const child = rowKey(groups, "1.1.1");
  const ancestor = rowKey(groups, "1.1");
  const state = reqCloseChoiceState();
  state.stage(child, "carry");
  state.stage(ancestor, "drop");
  const folded = state.fold(group, owners[0]);
  const afterDrop = vector.expect.after_drop;
  assert.deepEqual(folded.filter((row) => row.visible).map((row) => row.key), afterDrop.visible);
  const hidden = folded.find((row) => row.key === child);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.hidden_by, ancestor);
  const root = folded.find((row) => row.key === ancestor);
  assert.equal(root.nested_go_with_it, afterDrop.nested_go_with_it.count);
  const overlap = reqCloseResolveVerdicts(owners, [], state.requests(), null, sha256Hex);
  assert.equal(overlap.ok, false);
  assert.equal(overlap.code, afterDrop.overlap_code);

  const explicitMet = caseOf("RV13").input.requests.map((request, index) => (
    index === 1 ? { ...request, verdict: "met" } : request
  ));
  const metConflict = reqCloseResolveVerdicts(owners, [], explicitMet, null, sha256Hex);
  assert.equal(metConflict.ok, false);
  assert.equal(metConflict.code, "req_verdict_overlap");

  state.stage(ancestor, "met");
  const unfolded = state.fold(group, owners[0]);
  const afterMet = vector.expect.after_met;
  assert.deepEqual(unfolded.filter((row) => row.visible).map((row) => row.key), afterMet.visible);
  assert.equal(state.choice(child), "carry");
  const resolved = reqCloseResolveVerdicts(owners, [], state.requests(), null, sha256Hex);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.verdicts.length, 1);
  assert.equal(resolved.verdicts[0].row.key, child);
  assert.equal(resolved.verdicts[0].verdict, afterMet.choices[0].verdict);
  assert.equal(afterMet.error_code, null);

  const toggle = reqCloseChoiceState();
  for (const action of vector.input.toggle) toggle.stage(action.key, action.verdict);
  assert.equal(toggle.choice(vector.input.toggle_key), vector.expect.toggle_final);
});

test("disjoint multi-owner choices keep owner provenance", () => {
  const vector = caseOf("RV17");
  const { owners } = collectChoiceCase(helpers, vectors, vector);
  const selected = reqCloseResolveVerdicts(owners, [], vector.input.requests, null, sha256Hex);
  assert.equal(selected.ok, true);
  assert.equal(selected.verdicts.length, vector.expect.verdicts.length);
  for (const [index, actual] of selected.verdicts.entries()) {
    const expected = vector.expect.verdicts[index];
    assert.equal(actual.row.key, expected.key);
    assert.equal(actual.row.owner_task_key, expected.owner_task_key);
    assert.equal(actual.verdict, expected.verdict);
  }
});

test("old keys and probe preimages refuse reordered duplicate labels", () => {
  const vector = caseOf("RV18");
  const probe = collectCase(helpers, caseOf("RV10"));
  const fresh = collectCase(helpers, {
    notes: [{ ...caseOf("RV10").notes[0], source_lines: vector.input.source_lines_after }],
  });
  const stale = reqCloseResolveVerdicts(fresh.owners, [], vector.input.requests, null, sha256Hex);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, vector.expect.error_code);
  assert.deepEqual(stale.selectors, [vector.expect.old_key]);
  assert.equal(stale.current.groups.length, 1);
  assert.equal(stale.current.rows.length, 4);
  assert.notEqual(stale.current.rows[0].key, vector.expect.old_key);

  const selected = reqCloseResolveVerdicts(probe.owners, [], vector.input.requests, null, sha256Hex);
  assert.equal(selected.ok, true);
  const revalidated = reqCloseRevalidatePreimages(selected, fresh.owners, [], sha256Hex);
  assert.equal(revalidated.ok, false);
  assert.equal(revalidated.code, "req_close_stale");
});

test("duplicate owner identity refuses and marks stale", () => {
  const vector = caseOf("RV19");
  const { owners } = collectChoiceCase(helpers, vectors, vector);
  const cloned = owners.slice();
  cloned.push(owners[vector.input.duplicate_owner_index]);
  const error = reqCloseResolveVerdicts(cloned, [], [], null, sha256Hex);
  assert.equal(error.ok, false);
  assert.equal(error.code, vector.expect.error_code);
});

test("overlap and fold walk the full forest across a hand-ticked intermediate", () => {
  const vector = caseOf("RV44");
  const { owners, groups } = collectChoiceCase(helpers, vectors, vector);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 3);
  const ancestor = rowKey(groups, vector.expect.ancestor_path);
  const descendant = rowKey(groups, vector.expect.descendant_path);
  for (const pair of vector.input.pairs) {
    const error = reqCloseResolveVerdicts(owners, [], [
      { selector: pair.ancestor, verdict: pair.ancestor_verdict },
      { selector: pair.descendant, verdict: pair.descendant_verdict },
    ], null, sha256Hex);
    assert.equal(error.ok, false);
    assert.equal(error.code, vector.expect.error_code);
    assert.equal(error.ancestor_key, ancestor);
    assert.equal(error.descendant_key, descendant);
  }
  const state = reqCloseChoiceState();
  state.stage(ancestor, "drop");
  const folded = state.fold(groups[0], owners[0]);
  const hidden = folded.find((row) => row.key === descendant);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.hidden_by, ancestor);
  const visiblePaths = folded.filter((row) => row.visible).map((row) => (
    groups[0].rows.find((candidate) => candidate.offer.key === row.key).path
  ));
  assert.deepEqual(visiblePaths, vector.expect.after_drop.visible_paths);
});

test("canonical model functions accept injected snapshots without re-parsing notes", () => {
  const { owners } = collectCase(helpers, caseOf("RV1"));
  const selected = reqCloseResolveVerdicts(owners, ["offer:x"], [], "1", sha256Hex);
  assert.equal(selected.ok, true);
  assert.equal(selected.jump.card_row.n, 1);
  assert.equal(selected.jump.card_row.kind, "requirement");
  assert.deepEqual(reqCloseGroupsFromOwners(owners).map(groupJson), caseOf("RV1").expect.groups);
});

test("later RV families stay intact in the copied fixture", () => {
  const families = Object.fromEntries(["rows", "choices", "writes", "placement", "jump"].map((family) => [
    family,
    vectors.cases.filter((entry) => entry.family === family).map((entry) => entry.id),
  ]));
  assert.deepEqual(families.rows, ["RV1", "RV2", "RV3", "RV4", "RV5", "RV6", "RV7", "RV8", "RV9", "RV10", "RV11"]);
  assert.deepEqual(families.choices, ["RV12", "RV13", "RV14", "RV15", "RV16", "RV17", "RV18", "RV19", "RV44"]);
  assert.equal(families.writes.length, 9);
  assert.equal(families.placement.length, 7);
  assert.equal(families.jump.length, 8);
  assert.equal(reqCloseCollectOwners, helpers.reqCloseCollectOwners);
});
