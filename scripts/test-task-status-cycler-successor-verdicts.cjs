const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./task-status-cycler-harness.cjs");

const FIXTURE_PATH = path.join(
  __dirname,
  "../plugins/task-status-cycler/scripts/fixtures/offer_close/vectors.json",
);
const CANONICAL_PATH = path.join(
  __dirname,
  "..", "..", "..", "..", "..",
  "tests", "fixtures", "offer_close", "vectors.json",
);
const fixtureBytes = fs.readFileSync(FIXTURE_PATH);
const vectors = JSON.parse(fixtureBytes.toString("utf8"));
const TODAY = "2026-11-05";

function openTaskStatus(status) {
  return [" ", "/", "*", "?"].includes(status);
}

function markUnblockedLine(line, { today }) {
  const source = String(line || "");
  const fresh = source.match(/\[fresh::\s*(\d{4}-\d{2}-\d{2})\]/);
  if (!fresh) return source;
  const scheduled = source.match(/\[scheduled::\s*(\d{4}-\d{2}-\d{2})\]/);
  if (scheduled && fresh[1] < scheduled[1] && scheduled[1] <= today) return source;
  if (source.includes(`[unblocked:: ${today}]`)) return source;
  const id = source.match(/\s+\[id::/);
  if (id) return `${source.slice(0, id.index)} [unblocked:: ${today}]${source.slice(id.index)}`;
  const block = source.match(/\s+(\^[A-Za-z0-9_-]+)\s*$/);
  if (block) return `${source.slice(0, block.index)} [unblocked:: ${today}]${source.slice(block.index)}`;
  return `${source} [unblocked:: ${today}]`;
}

function closeCapabilities(overrides = {}) {
  return {
    successors: { version: 4, pick() {} },
    cancel: { version: 1, planCancel() { return { valid: true, content: "" }; } },
    completeTaskLineText(line, { date }) {
      const status = helpers.getTaskStatusForLine(line, 0);
      return status && openTaskStatus(status.symbol)
        ? { ok: true, unchanged: false, lineText: String(line).replace("[ ]", `[x] [completion:: ${date}]`) }
        : { ok: false, unchanged: true, lineText: line };
    },
    applyOfferClosesNow() {},
    ...overrides,
  };
}

function contextFor(source, pathName = "Tasks.md", extra = {}) {
  const notes = new Map([[pathName, source]]);
  const tasks = helpers.tasksFromDocuments([{ path: pathName, text: source }]);
  return {
    noteTexts: notes,
    tasks,
    today: TODAY,
    dailyBefore: [],
    dailyAfter: [],
    dailyPath: "2026/20261105.md",
    dependencySnapshotAvailable: true,
    markUnblockedLine,
    completeTaskLineText: closeCapabilities().completeTaskLineText,
    ...extra,
  };
}

function offerFor(context, { line = 0, key, group = "hand_off", ...extra } = {}) {
  const task = context.tasks.find((candidate) => candidate.line === line);
  assert.ok(task, `missing task at line ${line}`);
  const pathName = task.path;
  return {
    key: key || (task.blockId ? `${pathName}#^${task.blockId}` : ""),
    text: task.text,
    notePath: pathName,
    status: task.status,
    group,
    line: task.line,
    task,
    noteText: context.noteTexts.get(pathName),
    ...extra,
  };
}

function descriptorFor(vector, { group, source, line, pathName, extra = {} } = {}) {
  const pathValue = pathName || vector.path || "Tasks.md";
  const body = source === undefined ? vector.source : source;
  const context = contextFor(body, pathValue, extra.context || {});
  const task = context.tasks.find((candidate) =>
    candidate.line === (line === undefined ? vector.line || 0 : line),
  );
  const key = task && task.blockId
    ? vector.key
    : task
      ? helpers.assignSuccessorOfferKeys(
        [task],
        helpers.buildSuccessorNoteDigestTable(context.noteTexts),
      ).get(task)
      : vector.key;
  const offer = offerFor(context, {
    line: line === undefined ? vector.line || 0 : line,
    key,
    group: group || vector.group || "hand_off",
    ...extra.offer,
  });
  const descriptors = helpers.buildSuccessorOfferCloseDescriptors(
    [offer],
    context,
    extra.capabilities || closeCapabilities(),
  );
  return { descriptor: descriptors.get(offer.key), context, offer, descriptors };
}

test("SV fixture is copied byte-for-byte from bob-cli", () => {
  assert.deepEqual(fixtureBytes, fs.readFileSync(CANONICAL_PATH));
  assert.equal(vectors.schema_version, 1);
  assert.ok(vectors.cases.length >= 22, "the shared vectors retain their original scenarios");
});

test("SV1–SV7, SV17–SV18, and SV25 use the canonical close, project, and scope copy", () => {
  for (const id of ["SV1", "SV2", "SV3", "SV4", "SV5", "SV6", "SV7", "SV17", "SV18", "SV25"]) {
    const vector = vectors.cases.find((entry) => entry.id === id);
    const { descriptor } = descriptorFor(vector);
    assert.ok(descriptor, id);
    assert.equal(descriptor.complete, true, id);
    assert.equal(descriptor.cancel, true, id);
    assert.equal(descriptor.unblocks, 0, id);
    if (typeof vector.expected.consequence === "string") {
      if (vector.expected.consequence.startsWith("✓")) {
        assert.equal(descriptor.completeConsequence, vector.expected.consequence, `${id} Done`);
        const cancelExpected = id === "SV7"
          ? "⊘ Cancels “#prj Ship Alpha” · Ready → Cancelled"
          : vector.expected.consequence.replace(/^✓ Completes/, "⊘ Cancels").replace(/ → Done/, " → Cancelled");
        assert.equal(descriptor.cancelConsequence, cancelExpected, `${id} Cancel`);
      } else {
        assert.equal(descriptor.cancelConsequence, vector.expected.consequence, `${id} Cancel`);
        assert.equal(descriptor.completeConsequence, vector.expected.consequence.replace(/^⊘ Cancels/, "✓ Completes").replace(/ → Cancelled/, " → Done"), `${id} Done`);
      }
    }
    if (vector.expected.scope_note) assert.equal(descriptor.scopeNote, vector.expected.scope_note, id);
    else assert.equal("scopeNote" in descriptor, false, id);
  }
  const project = descriptorFor(vectors.cases.find((entry) => entry.id === "SV7"));
  assert.equal(project.descriptor.completeConsequence, "✓ Finishes ‹Alpha› · Ready → Done");
  assert.equal(project.descriptor.scopeNote, "· its 1 open task stays open");
  const plural = descriptorFor(vectors.cases.find((entry) => entry.id === "SV18"));
  assert.equal(plural.descriptor.scopeNote, "· its 2 open subtasks stay open");
});

test("the scope note counts only real #task subtasks and project tasks, never requirements", () => {
  const subtasks = [
    "- [ ] #task Owner ^owner",
    "\t- [ ] Open req",
    "\t\t- [ ] Nested req",
    "\t- [ ] #task Real subtask ^sub",
    "\t\t- [ ] Subtask req",
    "\t- [/] #task Started subtask ^started",
    "\t- [x] #task Done subtask ^done",
    "\t- NOTES",
    "\t\t- [ ] pasted checklist",
    "- [ ] #task Sibling ^sibling",
    "",
  ].join("\n");
  const owner = descriptorFor({ path: "Tasks.md", key: "Tasks.md#^owner", line: 0 }, { source: subtasks });
  assert.equal(owner.descriptor.scopeNote, "· its 2 open subtasks stay open");
  // The block ends at the first line back at the task's indentation, as
  // bob-cli's child_block_end_line does, even when that line is no task.
  const broken = ["- [ ] #task Owner ^owner", "A paragraph", "\t- [ ] #task Under the paragraph ^p", ""].join("\n");
  const paragraph = descriptorFor({ path: "Tasks.md", key: "Tasks.md#^owner", line: 0 }, { source: broken });
  assert.equal("scopeNote" in paragraph.descriptor, false);
  const project = [
    "- [ ] #task #prj Ship Alpha ^prj",
    "\t- [ ] Project req",
    "- [ ] #task Project resident ^resident",
    "\t- [ ] Resident req",
    "\t\t- [ ] #ref Nested reading req",
    "- [ ] #ref Reading row",
    "",
  ].join("\n");
  const alpha = descriptorFor(
    { path: "Projects/Alpha.md", key: "Projects/Alpha.md#^prj", line: 0, group: "project_finished" },
    { source: project },
  );
  assert.equal(alpha.descriptor.scopeNote, "· its 2 open tasks stay open");
});

test("SV9–SV24 simulate each candidate independently with WRITE skips", () => {
  for (const id of ["SV9", "SV10", "SV19", "SV20", "SV21", "SV22", "SV23", "SV24"]) {
    const vector = vectors.cases.find((entry) => entry.id === id);
    const pathName = vector.path || "Tasks.md";
    const context = contextFor(vector.source, pathName);
    const keys = vector.keys || [vector.key];
    for (const key of keys) {
      const task = context.tasks.find((candidate) =>
        candidate.blockId === key.slice(key.lastIndexOf("#^") + 2),
      );
      assert.ok(task, `${id} task for ${key}`);
      const offer = offerFor(context, { line: task.line, key, group: vector.group || "hand_off" });
      const descriptor = helpers.buildSuccessorOfferCloseDescriptors(
        [offer], context, closeCapabilities(),
      ).get(key);
      assert.ok(descriptor, `${id} descriptor`);
      if (id === "SV22") {
        assert.equal(descriptor.unblocks, vector.expected.single_unblocks, `${id} independent ${key}`);
        assert.doesNotMatch(descriptor.completeConsequence, /unblocks/);
      } else {
        assert.equal(descriptor.unblocks, vector.expected.unblocks, id);
        const expected = vector.expected.consequence;
        if (vector.action === "cancel") {
          assert.equal(descriptor.cancelConsequence, expected, `${id} consequence`);
          assert.equal(descriptor.completeConsequence, expected.replace(/^⊘ Cancels/, "✓ Completes").replace(/ → Cancelled/, " → Done"), `${id} Done consequence`);
        } else {
          assert.equal(descriptor.completeConsequence, expected, `${id} consequence`);
          assert.equal(descriptor.cancelConsequence, expected.replace(/^✓ Completes/, "⊘ Cancels").replace(/ → Done/, " → Cancelled"), `${id} Cancel consequence`);
        }
        if (vector.expected.dependent_unblocked === TODAY) {
          assert.match(descriptor.completeConsequence, /back tomorrow as (?:a )?ticklers?/);
        } else {
          assert.doesNotMatch(descriptor.completeConsequence, /back tomorrow/);
        }
      }
    }
  }
});

test("SV8 refusal copy and no-slot rows match the shared eligibility contract", () => {
  const vector = vectors.cases.find((entry) => entry.id === "SV8");
  for (const item of vector.cases) {
    const context = contextFor(`${item.line}\n`);
    const offer = offerFor(context, {
      key: item.key,
      group: "hand_off",
      ...(item.muted ? { selectable: false, muted: true } : {}),
      ...(item.is_new_task ? { isNewTask: true } : {}),
    });
    if (item.changed_identity) offer.task = { ...offer.task, rawLine: `${item.line} changed` };
    const descriptor = helpers.buildSuccessorOfferCloseDescriptors(
      [offer], context, closeCapabilities(),
    ).get(item.key);
    if (item.muted) {
      assert.equal(descriptor, undefined, item.name);
      continue;
    }
    assert.ok(descriptor, item.name);
    assert.equal(descriptor.complete, false, item.name);
    assert.equal(descriptor.cancel, false, item.name);
    assert.equal(descriptor.why, item.expected_why, item.name);
    assert.equal(descriptor.unblocks, 0, item.name);
    assert.equal("completeConsequence" in descriptor, false, item.name);
    assert.equal("cancelConsequence" in descriptor, false, item.name);
  }
});

test("writer refusals, incomplete blocked snapshots, and duplicate idless identities fail closed", () => {
  const ready = "- [ ] #task Root\n";
  const context = contextFor(ready);
  const idlessKey = helpers.assignSuccessorOfferKeys(
    [context.tasks[0]],
    helpers.buildSuccessorNoteDigestTable(context.noteTexts),
  ).get(context.tasks[0]);
  const offer = offerFor(context, { key: idlessKey });
  const refusal = helpers.buildSuccessorOfferCloseDescriptors(
    [offer], context, closeCapabilities({ completeTaskLineText: () => ({ ok: false, reason: "writer" }) }),
  ).get(idlessKey);
  assert.equal(refusal.why, "“Root” is Ready — only open tasks close here");

  const blockedContext = contextFor("- [?] #task Blocked [id:: blocked] ^blocked\n", "Tasks.md", {
    dependencySnapshotAvailable: false,
  });
  const blocked = offerFor(blockedContext, { key: "Tasks.md#^blocked" });
  assert.equal(helpers.buildSuccessorOfferCloseDescriptors(
    [blocked], blockedContext, closeCapabilities(),
  ).get(blocked.key).why, "“Blocked” is Blocked — only open tasks close here");

  const duplicateSource = "- [ ] #task Same\n- [ ] #task Same\n";
  const duplicates = contextFor(duplicateSource);
  const keys = helpers.assignSuccessorOfferKeys(
    duplicates.tasks,
    helpers.buildSuccessorNoteDigestTable(duplicates.noteTexts),
  );
  const second = offerFor(duplicates, { line: 1, key: keys.get(duplicates.tasks[1]) });
  assert.match(second.key, /~2$/);
  const valid = helpers.buildSuccessorOfferCloseDescriptors(
    [second], duplicates, closeCapabilities(),
  ).get(second.key);
  assert.equal(valid.complete, true);
  const rebound = offerFor(duplicates, { line: 0, key: second.key });
  const stale = helpers.buildSuccessorOfferCloseDescriptors(
    [rebound], duplicates, closeCapabilities(),
  ).get(rebound.key);
  assert.equal(stale.why, "Changed since the card opened — reopen to see the current row");
});

test("all five offer groups receive pure descriptors only with compatible APIs and apply", () => {
  const source = [
    "- [ ] #task A [id:: a] ^a",
    "- [ ] #task B [id:: b] ^b",
    "- [ ] #task Project Alpha [id:: p__prj] ^prj",
    "- [ ] #task D [id:: d] ^d",
    "- [ ] #task E [id:: e] ^e",
  ].join("\n");
  const context = contextFor(source, "Projects/Alpha.md");
  const offers = [
    offerFor(context, { line: 0, group: "hand_off" }),
    offerFor(context, { line: 1, group: "project" }),
    offerFor(context, { line: 2, group: "project_finished" }),
    offerFor(context, { line: 3, group: "keep_moving" }),
    offerFor(context, { line: 4, group: "relation", after: "Projects/Alpha.md#^prj", afterText: "Project Alpha", label: "starts after" }),
  ];
  const baseline = helpers.buildSuccessorPickerModel({ offers });
  const jumpSupported = helpers.buildSuccessorPickerModel({ offers, jumpSupported: true });
  assert.equal(baseline.jump, undefined);
  assert.deepEqual(jumpSupported.jump, { supported: true });
  const oldNav = helpers.buildSuccessorPickerModel({
    offers,
    offerCloseContext: context,
    offerCloseCapabilities: closeCapabilities({ successors: { version: 3, pick() {} } }),
  });
  assert.deepEqual(oldNav, baseline);
  const noApply = helpers.buildSuccessorPickerModel({
    offers,
    offerCloseContext: context,
    offerCloseCapabilities: closeCapabilities({ applyOfferClosesNow: null }),
  });
  assert.deepEqual(noApply, baseline);

  const supported = helpers.buildSuccessorPickerModel({
    offers,
    offerCloseContext: context,
    offerCloseCapabilities: closeCapabilities(),
  });
  assert.deepEqual(supported.close, { supported: true });
  assert.deepEqual(supported.groups.map((group) => group.group).sort(), [
    "hand_off", "keep_moving", "project", "project_finished", "relation",
  ].sort());
  for (const group of supported.groups) {
    assert.equal(group.rows[0].close.complete, true, group.group);
    assert.equal(group.rows[0].close.cancel, true, group.group);
  }
  assert.equal("close" in baseline, false);
});

test("choices keep the picks array contract, normalize cancel reasons, and remove conflicts", () => {
  const input = {
    picks: [{ key: " pick " }, { key: "close" }, { key: "pick" }, {}],
    closes: [
      { key: "close", outcome: "cancelled", reason: "  duplicate\n implementation   " },
      { key: "done", outcome: "done" },
      { key: "done", outcome: "cancelled", reason: "conflict" },
      { key: "bad", outcome: "done", reason: "destructive" },
      { key: "malformed", outcome: "cancelled", reason: 42 },
    ],
  };
  const choices = helpers.normalizeSuccessorChoices(input);
  assert.deepEqual(choices, {
    picks: [{ key: "pick" }],
    closes: [{ key: "close", outcome: "cancelled", reason: "duplicate implementation" }],
  });
  assert.deepEqual(helpers.normalizeSuccessorPicks(input), [{ key: "pick" }]);
  assert.equal(helpers.normalizeSuccessorChoices(null), null);
  assert.deepEqual(helpers.normalizeSuccessorPicks(null), []);
  assert.deepEqual(
    helpers.normalizeSuccessorChoices({ picks: [], closes: [{ key: "only-close", outcome: "done" }] }),
    { picks: [], closes: [{ key: "only-close", outcome: "done" }] },
  );
  assert.deepEqual(helpers.normalizeSuccessorPicks({ picks: [], closes: [{ key: "only-close", outcome: "done" }] }), []);
});

test("a jump pin is normalized on its own and stays independent of row verdicts", () => {
  assert.deepEqual(
    helpers.normalizeSuccessorChoices({ picks: [], closes: [], jump: { key: " Tasks.md#^a " } }),
    { picks: [], closes: [], jump: { key: "Tasks.md#^a" } },
  );
  assert.deepEqual(
    helpers.normalizeSuccessorChoices({
      picks: [{ key: "Tasks.md#^b" }],
      closes: [{ key: "Tasks.md#^c", outcome: "cancelled" }],
      jump: { key: "Tasks.md#^a" },
    }),
    {
      picks: [{ key: "Tasks.md#^b" }],
      closes: [{ key: "Tasks.md#^c", outcome: "cancelled" }],
      jump: { key: "Tasks.md#^a" },
    },
  );
  assert.equal(helpers.normalizeSuccessorChoices({ picks: [], closes: [], jump: { key: "  " } }), null);
  assert.equal(helpers.normalizeSuccessorChoices({ picks: [], closes: [], jump: { key: 42 } }), null);
});

test("jump picker capability requires nav v5 and a caller that can own the landing", () => {
  const navApi = { landOnTask() {}, reviewWalk: { version: 2 } };
  const plugin = { app: { plugins: { plugins: {
    "bob-navigation-hotkeys": { api: navApi },
  } } } };
  assert.equal(helpers.successorJumpPickerSupported(plugin, { version: 5 }, {}), true);
  assert.equal(helpers.successorJumpPickerSupported(
    plugin,
    { version: 5 },
    { successorNoticeTarget: "return" },
  ), false);
  assert.equal(helpers.successorJumpPickerSupported(
    plugin,
    { version: 5 },
    { successorNoticeTarget: "return", successorJumpTarget: "return" },
  ), true);
  assert.equal(helpers.successorJumpPickerSupported(plugin, { version: 4 }, {}), false);
  assert.equal(helpers.successorJumpPickerSupported(
    { app: { plugins: { plugins: { "bob-navigation-hotkeys": { api: { reviewWalk: { version: 2 } } } } } } },
    { version: 5 },
    {},
  ), false);
  assert.equal(helpers.successorJumpPickerSupported(
    { app: { plugins: { plugins: { "bob-navigation-hotkeys": { api: { ...navApi, reviewWalk: { version: 1 } } } } } } },
    { version: 5 },
    { successorNoticeTarget: "return", successorJumpTarget: "return" },
  ), false);
});

test("jump identity uses each verdict's post-write task identity", () => {
  const key = "Tasks.md#^a";
  const offer = {
    key,
    text: "Task A",
    notePath: "Tasks.md",
    line: 3,
    task: { path: "Tasks.md", line: 3, blockId: "a", rawLine: "- [?] #task Task A ^a" },
  };
  const original = new Map([[key, offer]]);
  const leftText = "- [ ] #task Task A [unblocked:: 2026-11-05] ^a";
  assert.deepEqual(
    helpers.buildSuccessorJumpIdentity(key, original, {
      edits: [{ path: "Tasks.md", line: 3, before: offer.task.rawLine, after: leftText }],
      rows: [],
    }, null),
    {
      key, outcome: "left", label: "Task A", path: "Tasks.md", blockId: "a",
      text: leftText, line: 3, description: "Task A",
    },
  );

  const pickedText = "- [*] #task Task A [fresh:: 2026-11-05] ^minted";
  assert.deepEqual(
    helpers.buildSuccessorJumpIdentity(key, original, {
      edits: [{ path: "Tasks.md", line: 3, before: offer.task.rawLine, after: pickedText }],
      rows: [{ offer: { key, selected: true }, note_path: "Tasks.md", block_id: "minted", line: 3 }],
    }, null),
    {
      key, outcome: "picked", label: "Task A", path: "Tasks.md", blockId: "minted",
      text: pickedText, line: 3, description: "Task A",
    },
  );

  const closedText = "- [x] #task Task A [completion:: 2026-11-05] ^a";
  assert.deepEqual(
    helpers.buildSuccessorJumpIdentity(key, original, { edits: [], rows: [] }, {
      offer_closes: [{ key, outcome: "done" }],
      resolved: [{ key, path: "Tasks.md", line: 3, blockId: "a", afterLine: closedText }],
    }),
    {
      key, outcome: "done", label: "Task A", path: "Tasks.md", blockId: "a",
      text: closedText, line: 3, description: "Task A",
    },
  );
});

test("jump identity builds Left from the fresh plan row, not the stale card line", () => {
  const key = "Tasks.md#^a";
  const offer = {
    key,
    text: "Task A",
    notePath: "Tasks.md",
    line: 3,
    task: { path: "Tasks.md", line: 3, blockId: "a", rawLine: "- [?] #task Task A ^a" },
  };
  const original = new Map([[key, offer]]);
  const freshText = "- [ ] #task Task A [unblocked:: 2026-11-05] ^a";
  assert.deepEqual(
    helpers.buildSuccessorJumpIdentity(key, original, {
      edits: [{ path: "Tasks.md", line: 5, before: "- [?] #task Other ^a", after: freshText }],
      rows: [{
        offer: { key, selected: false },
        note_path: "Tasks.md",
        block_id: "a",
        line: 5,
        text: "- [?] #task Task A ^a",
      }],
    }, null),
    {
      key, outcome: "left", label: "Task A", path: "Tasks.md", blockId: "a",
      text: freshText, line: 5, description: "Task A",
    },
  );
});

test("jump identity lands a refused stale pick as Left from its fresh row", () => {
  const key = "Tasks.md#^a";
  const offer = {
    key,
    text: "Task A",
    notePath: "Tasks.md",
    line: 3,
    task: { path: "Tasks.md", line: 3, blockId: "a", rawLine: "- [?] #task Task A ^a" },
  };
  const original = new Map([[key, offer]]);
  const freshText = "- [ ] #task Task A [unblocked:: 2026-11-05] ^a";
  assert.deepEqual(
    helpers.buildSuccessorJumpIdentity(key, original, {
      edits: [{ path: "Tasks.md", line: 4, before: "- [?] #task Task A ^a", after: freshText }],
      rows: [{
        offer: { key, selected: false },
        note_path: "Tasks.md",
        block_id: "a",
        line: 4,
        text: "- [?] #task Task A ^a",
      }],
    }, null),
    {
      key, outcome: "left", label: "Task A", path: "Tasks.md", blockId: "a",
      text: freshText, line: 4, description: "Task A",
    },
  );
});

test("jump identity keeps the cancelled close outcome", () => {
  const key = "Tasks.md#^a";
  const offer = {
    key,
    text: "Task A",
    notePath: "Tasks.md",
    line: 3,
    task: { path: "Tasks.md", line: 3, blockId: "a", rawLine: "- [?] #task Task A ^a" },
  };
  const original = new Map([[key, offer]]);
  const cancelledText = "- [?] #task Task A ^a";
  assert.deepEqual(
    helpers.buildSuccessorJumpIdentity(key, original, { edits: [], rows: [] }, {
      offer_closes: [{ key, outcome: "cancelled" }],
      resolved: [{ key, path: "Tasks.md", line: 3, blockId: "a", afterLine: cancelledText }],
    }),
    {
      key, outcome: "cancelled", label: "Task A", path: "Tasks.md", blockId: "a",
      text: cancelledText, line: 3, description: "Task A",
    },
  );
});
