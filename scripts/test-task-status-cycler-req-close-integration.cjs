const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskStatusCyclerPlugin, helpers } = require("./task-status-cycler-harness.cjs");
const { helpers: navigationHelpers } = require("./navigation-hotkeys-harness.cjs");
const { readFixture } = require("./req-close-vectors.cjs");

const vectors = readFixture("task-status-cycler", "vectors.json");
const vector = vectors.cases.find((entry) => entry.id === "RV1");
const preCloseText = `${vector.notes[0].source_lines.join("\n")}\n`;
const identity = { path: vector.notes[0].path, blockId: vector.notes[0].closing[0].block_id };

function pluginWithNav(picker) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: { getMarkdownFiles: () => [{ path: "Tasks.md" }] },
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          api: {
            version: 6,
            successors: { version: 6, pick: picker },
          },
        },
      },
    },
  };
  return plugin;
}

test("managed Done owner snapshots follow the explicit closing order and are Done-only", () => {
  const plugin = pluginWithNav(async () => null);
  const captured = plugin.captureReqCloseOwnersFromText(preCloseText, identity.path, [identity]);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].close_identity.blockId, identity.blockId);
  assert.equal(plugin.reqCloseOwnersForManagedDone(captured, [identity]).length, 1);
  assert.deepEqual(plugin.reqCloseOwnersForManagedDone(captured, [identity], { closeKind: "cancelled" }), []);
  assert.deepEqual(plugin.reqCloseOwnersForManagedDone(captured, [identity], { relationEventKind: "parked" }), []);
  assert.deepEqual(plugin.reqCloseOwnersForManagedDone(captured, [identity], { automated: true }), []);
});

test("the one successor card accepts a requirements-only model and keeps req choices", async () => {
  let shown = null;
  const plugin = pluginWithNav(async (model) => {
    shown = model;
    return { picks: [], reqs: [] };
  });
  const captured = plugin.captureReqCloseOwnersFromText(preCloseText, identity.path, [identity]);
  const result = await plugin.pickSuccessorOfferChoices({
    plan: { offers: [], still_blocked: [] },
    offers: [],
    reqCloseGroups: helpers.reqCloseGroupsFromOwners(captured),
    identities: [identity],
    pickerApi: plugin.app.plugins.plugins["bob-navigation-hotkeys"].api.successors,
    noteTexts: { [identity.path]: preCloseText },
    tasks: [],
    today: "2026-11-22",
    dailyBefore: [],
    dailyAfter: [],
  });
  assert.equal(result.pickerOpened, true);
  assert.equal(shown.groups[0].group, "requirements");
  const normalized = navigationHelpers.normalizeSuccessorPickerModel(shown);
  assert.ok(normalized, "the navigation v6 API accepts the Cycler's requirement group");
  assert.equal(normalized.groups[0].rows[0].req.text, shown.groups[0].rows[0].req.text);
  assert.equal(result.choices.reqs.length, 0);
});

test("an empty requirements submission records Met without changing owner bytes", async () => {
  const plugin = pluginWithNav(async () => null);
  const captured = plugin.captureReqCloseOwnersFromText(preCloseText, identity.path, [identity]);
  const postCloseText = preCloseText.replace("- [ ] #task", "- [x] #task");
  plugin.readSuccessorNoteText = async () => postCloseText;
  const result = await plugin.applyManagedReqCloseCard({
    owners: captured,
    choices: { reqs: [] },
    taskOfferKeys: [],
    notes: { [identity.path]: postCloseText },
    identities: [identity],
    today: "2026-11-22",
  });
  assert.equal(result.ok, true);
  assert.equal(result.postimages && Object.keys(result.postimages).length, 0);
  assert.equal(result.met.length, 1);
  assert.equal(result.met[0].count, 4);
  assert.equal(result.notes[identity.path], postCloseText);
});

function pulledCarryFixture() {
  const placement = vectors.cases.find((entry) => entry.id === "RV29");
  const owner = pluginWithNav(async () => null)
    .captureReqCloseOwnersFromText(preCloseText, identity.path, [identity])[0];
  const node = owner.nodes.find((entry) => entry.text === "Handles empty input");
  const dayPath = placement.input.day.path;
  const dayText = `${placement.input.day.source_lines.join("\n")}\n`;
  return {
    owner,
    dayPath,
    dayText,
    result: {
      outcomes: [{
        owner_key: owner.key,
        row_key: node.key,
        path: node.path,
        text: node.text,
        verdict: "carry_pulled",
        pulled: true,
        carried: { path: identity.path, block_id: "handles-empty-input" },
      }],
      notes: placement.expect.notes_after,
      restores: [],
    },
    index: placement.input.index,
    completed: [{ path: identity.path, blockId: identity.blockId, isRoot: true }],
  };
}

async function finishPulledCarry(planPlacement) {
  const fixture = pulledCarryFixture();
  const plugin = pluginWithNav(async () => null);
  plugin.app.plugins.plugins["bob-ledger-tools"] = {
    api: {
      themes: {
        version: 1,
        effectiveTypeFor: () => ({ theme: { key: "writing", name: "WRITING" } }),
        typeAgrees: () => false,
        planPlacement,
      },
    },
  };
  const current = new Map(Object.entries(fixture.result.notes));
  current.set(fixture.dayPath, fixture.dayText);
  plugin.readSuccessorNoteText = async (path) => current.get(path) || null;
  plugin.persistReqPullInPlan = async (source, pull) => {
    const notes = new Map(source.notes);
    for (const [path, text] of Object.entries(pull.notesAfter || {})) notes.set(path, text);
    if (pull.dayAfter != null) notes.set(fixture.dayPath, pull.dayAfter);
    return { ok: true, notes, restores: pull.restores || [], failures: [] };
  };
  return plugin.finishManagedReqPullIn({
    result: fixture.result,
    owners: [fixture.owner],
    dailyPath: fixture.dayPath,
    today: "2026-11-22",
    index: fixture.index,
    completed: fixture.completed,
  });
}

test("pulled carry D7 routes into the same existing typed entry as ordinary successors", async () => {
  const result = await finishPulledCarry(() => ({ kind: "entry", index: 1 }));
  assert.equal(result.pullIn.ok, true);
  assert.equal(result.pullIn.links[0].routed, true);
  assert.equal(result.pullIn.links[0].destination.entryName, "FIX");
  assert.equal(result.pullIn.links[0].destination.entryRole, "typed");
  assert.match(result.pullIn.dayAfter, /- \[ \] \(\) — FIX\n  - \[\[sase#\^other\]\]\n\t- \[\[Tasks#\^handles-empty-input\]\]/);
});

test("pulled carry D7 creates a typed entry at ordinary successor placement", async () => {
  const result = await finishPulledCarry(() => ({ kind: "create", name: "WRITING" }));
  assert.equal(result.pullIn.ok, true);
  assert.equal(result.pullIn.links[0].routed, true);
  assert.equal(result.pullIn.links[0].destination.entryName, "WRITING");
  assert.equal(result.pullIn.links[0].destination.entryRole, "created");
  assert.equal(result.pullIn.links[0].link.entryCreated, true);
  assert.match(result.pullIn.dayAfter, /- \[ \] \(\) — WRITING\n\t- \[\[Tasks#\^handles-empty-input\]\]/);
});

test("picker {key,verdict} maps to resolver {selector} at the cycler boundary", () => {
  const dropKey = "Tasks.md#^export@abc/req/1.2~a59403fe";
  const mapped = helpers.reqCloseCardRequestsFromChoices([
    { key: dropKey, verdict: "drop", reason: "out of scope" },
    { key: "Tasks.md#^export@abc/req/1~84afa836", verdict: "met" },
    { selector: "already-selector", verdict: "carry" },
    { key: "ignored", verdict: "nope" },
    null,
  ]);
  assert.deepEqual(mapped, [
    { selector: dropKey, verdict: "drop", reason: "out of scope" },
    { selector: "Tasks.md#^export@abc/req/1~84afa836", verdict: "met" },
    { selector: "already-selector", verdict: "carry" },
  ]);
});

test("applyManagedReqCloseCard sends mapped selectors into applyReqCloseWrites", async () => {
  const plugin = pluginWithNav(async () => null);
  const captured = plugin.captureReqCloseOwnersFromText(preCloseText, identity.path, [identity]);
  const dropKey = captured[0].nodes.find((node) => node.text === "Handles empty input").key;
  const metKey = captured[0].nodes.find((node) => node.text === "Handles supported inputs").key;
  const postCloseText = preCloseText.replace("- [ ] #task", "- [x] #task");
  let seen = null;
  plugin.applyReqCloseWrites = async (options) => {
    seen = options;
    return { ok: true, outcomes: [], met: [], notes: {}, restores: [], req_outcomes: [] };
  };
  plugin.readSuccessorNoteText = async () => postCloseText;
  await plugin.applyManagedReqCloseCard({
    owners: captured,
    choices: {
      reqs: [
        { key: dropKey, verdict: "drop", reason: "duplicate effort" },
        { key: metKey, verdict: "met" },
      ],
    },
    notes: { [identity.path]: postCloseText },
    identities: [identity],
    today: "2026-11-22",
  });
  assert.ok(seen);
  assert.deepEqual(seen.requests, [
    { selector: dropKey, verdict: "drop", reason: "duplicate effort" },
    { selector: metKey, verdict: "met" },
  ]);
  assert.equal(seen.requests.some((row) => Object.prototype.hasOwnProperty.call(row, "key")), false);
});

test("identity-less capture groups each matching task as its own owner", () => {
  const plugin = pluginWithNav(async () => null);
  const captured = plugin.captureReqCloseOwnersFromText(preCloseText, identity.path);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].close_identity.blockId, identity.blockId);
  assert.equal(captured[0].nodes.length, 4);
});

test("counted-range capture keeps only owners whose line lies in the window", () => {
  const plugin = pluginWithNav(async () => null);
  const twoOwners = [
    "- [ ] #task First owner ^first",
    "\t- [ ] First req",
    "- [ ] #task Second owner ^second",
    "\t- [ ] Second req",
    "- [ ] #task Third owner ^third",
    "\t- [ ] Third req",
  ].join("\n") + "\n";
  const inRange = plugin.captureReqCloseOwnersFromRange(twoOwners, "Tasks.md", 2, 3);
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0].close_identity.blockId, "second");
  const outside = plugin.captureReqCloseOwnersFromRange(twoOwners, "Tasks.md", 0, 1);
  assert.equal(outside.length, 1);
  assert.equal(outside[0].close_identity.blockId, "first");
  const none = plugin.captureReqCloseOwnersFromRange(twoOwners, "Tasks.md", 1, 1);
  assert.equal(none.length, 0);
});

test("RV owner capture accepts a canonical idless path/line/task_key identity", () => {
  const plugin = pluginWithNav(async () => null);
  const idlessText = preCloseText.replace(" ^export", "");
  const reqIdentity = plugin.reqCloseIdentityForTaskLine(idlessText, identity.path, 0);
  assert.deepEqual(Object.keys(reqIdentity).sort(), ["line", "path", "task_key"]);
  assert.equal(reqIdentity.line, 1);
  assert.match(reqIdentity.task_key, /^Tasks\.md@[0-9a-f]{8}$/);
  const captured = plugin.captureReqCloseOwnersFromText(idlessText, identity.path, [reqIdentity]);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].task_key, reqIdentity.task_key);
  assert.equal(captured[0].close_identity.line, 1);
  assert.deepEqual(plugin.reqCloseOwnersForManagedDone(captured, []).map((row) => row.task_key), [reqIdentity.task_key]);
  assert.equal(plugin.captureReqCloseOwnersFromRange(idlessText, identity.path, 0, 0).length, 1);
});

test("managed landing hands nav a 0-based line plus exact text", async () => {
  const plugin = pluginWithNav(async () => null);
  const captured = plugin.captureReqCloseOwnersFromText(preCloseText, identity.path, [identity]);
  const node = captured[0].nodes.find((entry) => entry.text === "Handles empty input");
  const postCloseText = preCloseText.replace("- [ ] #task", "- [x] #task");
  plugin.readSuccessorNoteText = async (path) => (path === identity.path ? postCloseText : null);
  const landing = await plugin.resolveManagedReqCloseLanding({
    owners: captured,
    plan: { outcomes: [], notes: { [identity.path]: postCloseText } },
    key: node.key,
  });
  assert.equal(landing.ok, true);
  assert.equal(landing.kind, "requirement");
  assert.equal(landing.line, node.line - 1);
  assert.equal(landing.text, postCloseText.split("\n")[node.line - 1]);
  assert.match(landing.text, /Handles empty input/);
  assert.equal(landing.blockId, null);
  assert.equal(landing.description, "Handles empty input");
  assert.equal(landing.label, "Handles empty input");
});

test("a carried-task landing keeps blockId and the created task's exact line", () => {
  const note = [
    "- [x] #task Ship the exporter ^export",
    "\t- [>] [[#^handles-empty-input|Handles empty input]]",
    "- [ ] #task Handles empty input [created:: 2026-11-22] ^handles-empty-input",
  ].join("\n") + "\n";
  const landing = helpers.reqCloseLandableTarget({
    key: "row",
    kind: "carried_task",
    outcome: "carry",
    path: "Tasks.md",
    line: 3,
    blockId: "handles-empty-input",
  }, note, { text: "Handles empty input" });
  assert.equal(landing.line, 2);
  assert.equal(landing.text, "- [ ] #task Handles empty input [created:: 2026-11-22] ^handles-empty-input");
  assert.equal(landing.blockId, "handles-empty-input");
  assert.equal(landing.description, "Handles empty input");
});
