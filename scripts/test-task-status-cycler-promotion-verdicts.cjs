// Cycler api v5 for project promotion (`describeOfferCloses` /
// `applyOfferCloses`, plan:202611/successor_card_verdicts.md promotion
// phase). Covers the public surface, promotion-key translation (block-ID
// and ID-less rows), refusals, and the old-nav gate.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  createInMemoryObsidianApp,
} = require("./task-status-cycler-harness.cjs");

const TODAY = "2026-11-05";
const PROJECT = "Projects/P.md";
const SOURCE = [
  "# Project",
  "",
  "- [ ] #task First task ^aaa111",
  "- [ ] #task Second task",
  "- [ ] #task Recurring task 🔁 every day",
  "- [?] #task Blocked task",
].join("\n");

function planCancelStub() {
  return {
    version: 1,
    planCancel(content, targets, options = {}) {
      const date = options.date || TODAY;
      const lines = String(content || "").split("\n");
      for (const target of Array.isArray(targets) ? targets : []) {
        if (lines[target.line] !== target.rawLine) return { valid: false, stale: true };
        lines[target.line] = String(lines[target.line])
          .replace("[ ]", `[-] [cancelled:: ${date}]`);
      }
      let next = lines.join("\n");
      const reason = String(options.reason || "").trim();
      if (reason) next += `\n  - ❌ **CANCEL LOG**\n    - *${date}* — ${reason}`;
      return { valid: true, content: next };
    },
  };
}

function navApi(overrides = {}) {
  return {
    successors: { version: 4, pick: async () => null },
    cancel: planCancelStub(),
    ...overrides,
  };
}

function makePlugin(sources, api) {
  const harness = createInMemoryObsidianApp(sources);
  harness.app.plugins.plugins["bob-navigation-hotkeys"] = { api };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.referenceMutationQueue = Promise.resolve();
  // onload installs `api` before any host-only call; the host calls throw
  // under the harness stub and are ignored here.
  try {
    plugin.onload();
  } catch (_error) {
    // Host-only wiring (commands, workspace events) is unavailable.
  }
  assert.ok(plugin.api, "expected the public api after onload");
  return { plugin, harness };
}

function promoRows() {
  return [
    {
      key: `${PROJECT}#^aaa111`,
      text: "First task",
      notePath: PROJECT,
      status: " ",
      selectable: true,
      line: 2,
      rawLine: "- [ ] #task First task ^aaa111",
      blockId: "aaa111",
    },
    {
      key: `${PROJECT}@second`,
      text: "Second task",
      notePath: PROJECT,
      status: " ",
      selectable: true,
      line: 3,
      rawLine: "- [ ] #task Second task",
      blockId: null,
    },
  ];
}

test("cycler api is version 5 with the promotion methods", () => {
  const { plugin } = makePlugin({ [PROJECT]: SOURCE }, navApi());
  assert.equal(plugin.api.version, 5);
  assert.equal(typeof plugin.api.describeOfferCloses, "function");
  assert.equal(typeof plugin.api.applyOfferCloses, "function");
});

test("describe reports eligible descriptors for block-ID and ID-less rows", async () => {
  const { plugin } = makePlugin({ [PROJECT]: SOURCE }, navApi());
  const result = await plugin.api.describeOfferCloses({ rows: promoRows(), gesture: "promotion" });
  assert.equal(result.supported, true);
  const first = result.descriptors[`${PROJECT}#^aaa111`];
  assert.ok(first, "expected a descriptor for the block-ID row");
  assert.equal(first.complete, true);
  assert.equal(first.cancel, true);
  assert.match(first.completeConsequence, /First task/);
  assert.match(first.cancelConsequence, /First task/);
  assert.equal(typeof first.unblocks, "number");
  const second = result.descriptors[`${PROJECT}@second`];
  assert.ok(second, "expected a descriptor for the ID-less row");
  assert.equal(second.complete, true);
  assert.equal(second.cancel, true);
});

test("describe refuses recurring rows and skips muted rows", async () => {
  const { plugin } = makePlugin({ [PROJECT]: SOURCE }, navApi());
  const rows = [
    ...promoRows(),
    {
      key: `${PROJECT}#^recurring`,
      text: "Recurring task",
      notePath: PROJECT,
      status: " ",
      selectable: true,
      line: 4,
      rawLine: "- [ ] #task Recurring task 🔁 every day",
      blockId: null,
    },
    {
      key: `${PROJECT}#^blocked`,
      text: "Blocked task",
      notePath: PROJECT,
      status: "?",
      selectable: false,
      line: 5,
      rawLine: "- [?] #task Blocked task",
      blockId: null,
    },
  ];
  const result = await plugin.api.describeOfferCloses({ rows, gesture: "promotion" });
  assert.equal(result.supported, true);
  const recurring = result.descriptors[`${PROJECT}#^recurring`];
  assert.ok(recurring, "expected a refusal descriptor for the recurring row");
  assert.equal(recurring.complete, false);
  assert.equal(recurring.cancel, false);
  assert.match(recurring.why, /repeats/);
  assert.equal(
    result.descriptors[`${PROJECT}#^blocked`],
    undefined,
    "muted rows get no verdict slot",
  );
});

test("describe reports unsupported on an older nav", async () => {
  const { plugin } = makePlugin(
    { [PROJECT]: SOURCE },
    { successors: { version: 3, pick: async () => null } },
  );
  const result = await plugin.api.describeOfferCloses({ rows: promoRows(), gesture: "promotion" });
  assert.equal(result.supported, false);
  assert.deepEqual(result.descriptors, {});
});

test("apply closes a Done row root-only with promotion keys in the receipt", async () => {
  const { plugin, harness } = makePlugin({ [PROJECT]: SOURCE }, navApi());
  const rows = promoRows();
  const receipt = await plugin.api.applyOfferCloses({
    closes: [{ key: `${PROJECT}#^aaa111`, outcome: "done" }],
    expectedLines: { [`${PROJECT}#^aaa111`]: "- [ ] #task First task ^aaa111" },
    rows,
  });
  assert.equal(receipt.offer_closes.length, 1);
  assert.equal(receipt.offer_closes[0].key, `${PROJECT}#^aaa111`);
  assert.equal(receipt.offer_closes[0].outcome, "done");
  assert.equal(receipt.offer_close_refused, null);
  assert.ok(receipt.undo && receipt.undo.restores.length === 1);
  const after = harness.getSource(PROJECT);
  assert.match(after, /- \[x\] #task First task/);
  assert.match(after, /\[completion:: \d{4}-\d{2}-\d{2}\]/);
  assert.match(after, /- \[ \] #task Second task/, "neighbours stay open");
});

test("apply cancels an ID-less row with the reason", async () => {
  const { plugin, harness } = makePlugin({ [PROJECT]: SOURCE }, navApi());
  const rows = promoRows();
  const receipt = await plugin.api.applyOfferCloses({
    closes: [{ key: `${PROJECT}@second`, outcome: "cancelled", reason: "obsolete" }],
    expectedLines: { [`${PROJECT}@second`]: "- [ ] #task Second task" },
    rows,
  });
  assert.equal(receipt.offer_closes.length, 1);
  assert.equal(receipt.offer_closes[0].key, `${PROJECT}@second`);
  assert.equal(receipt.offer_closes[0].outcome, "cancelled");
  const after = harness.getSource(PROJECT);
  assert.match(after, /- \[-].*#task Second task/);
  assert.match(after, /\[cancelled:: \d{4}-\d{2}-\d{2}\]/);
  assert.match(after, /obsolete/);
});

test("apply refuses a stale row alone and applies the rest", async () => {
  const { plugin, harness } = makePlugin({ [PROJECT]: SOURCE }, navApi());
  const rows = promoRows();
  const receipt = await plugin.api.applyOfferCloses({
    closes: [
      { key: `${PROJECT}#^aaa111`, outcome: "done" },
      { key: `${PROJECT}@second`, outcome: "done" },
    ],
    expectedLines: {
      [`${PROJECT}#^aaa111`]: "- [ ] #task First task ^aaa111",
      [`${PROJECT}@second`]: "- [ ] #task CHANGED",
    },
    rows,
  });
  assert.equal(receipt.offer_closes.length, 1);
  assert.equal(receipt.offer_closes[0].key, `${PROJECT}#^aaa111`);
  assert.ok(receipt.offer_close_refused, "expected a refusal payload");
  assert.equal(receipt.offer_close_refused.count, 1);
  assert.match(receipt.offer_close_refused.rows[0].why, /Changed since the card opened/);
  assert.match(harness.getSource(PROJECT), /- \[ \] #task Second task/);
});

test("apply refuses malformed closes without writing", async () => {
  const { plugin, harness } = makePlugin({ [PROJECT]: SOURCE }, navApi());
  const before = harness.getSource(PROJECT);
  const receipt = await plugin.api.applyOfferCloses({
    closes: [{ key: `${PROJECT}#^aaa111`, outcome: "explode" }],
    expectedLines: {},
    rows: promoRows(),
  });
  assert.equal(receipt.offer_closes.length, 0);
  assert.ok(receipt.offer_close_refused, "expected refusals for malformed closes");
  assert.equal(harness.getSource(PROJECT), before);
});
