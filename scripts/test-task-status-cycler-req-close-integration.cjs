const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskStatusCyclerPlugin, helpers } = require("./task-status-cycler-harness.cjs");
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
