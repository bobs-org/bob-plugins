// Notice v6: requirement close receipts and a guarded req-only Undo.
// Does not wire managed Done. Older payloads keep their prior rendering.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  createFragmentNode,
  findFragmentNode,
} = require("./navigation-hotkeys-harness.cjs");

test("notice v6 renders req-only receipts and a guarded Undo action", () => {
  const restores = [{ path: "Tasks.md", before: "before", after: "after", created: false }];
  const view = helpers.buildUnblockedNoticeModel({
    req_outcomes: [{
      verdict: "carry",
      receipt: "→ “Handles empty input” is its own task now",
      row_key: "Tasks.md#^export/req/1.2~deadbeef",
      text: "Handles empty input",
    }],
    req_met: [{
      owner_key: "Tasks.md#^export",
      count: 3,
      receipt: "✓ 3 requirements met with “Ship the exporter”",
    }],
    undo: { restores },
    __noticePlugin: { restoreGuardedSnapshots() { return Promise.resolve(true); } },
  });
  assert.ok(view);
  assert.match(view.text, /Handles empty input/);
  assert.match(view.text, /3 requirements met/);
  assert.equal(view.reqOutcomes.length, 1);
  assert.equal(view.reqMet.length, 1);
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  assert.ok(findFragmentNode(root, (node) => node.text.includes("Handles empty input")));
  assert.ok(findFragmentNode(root, (node) => node.text.includes("3 requirements met")));
  const undo = findFragmentNode(root, (node) => node.text === "Undo");
  assert.ok(undo);
  assert.equal(findFragmentNode(root, (node) => node.text === "Undo closes"), null);
});

test("notice v6 keeps Undo closes on mixed offer-close cards and appends req receipts", () => {
  const view = helpers.buildUnblockedNoticeModel({
    offer_closes: [{
      outcome: "done",
      text: "Ship the exporter",
      message: "✓ completed “Ship the exporter” · Ready → Done",
      recovered: [],
    }],
    req_outcomes: [{
      verdict: "drop",
      receipt: "⊘ Dropped “Handles empty input” · “out of scope”",
    }],
    undo: { restores: [{ path: "Tasks.md", before: "a", after: "b" }] },
    __noticePlugin: { restoreGuardedSnapshots() {} },
  });
  assert.ok(view);
  assert.match(view.text, /completed “Ship the exporter”/);
  assert.match(view.text, /Dropped “Handles empty input”/);
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  assert.equal(findFragmentNode(root, (node) => node.text === "Undo closes").text, "Undo closes");
  assert.equal(findFragmentNode(root, (node) => node.text === "Undo"), null);
  assert.ok(findFragmentNode(root, (node) => node.text.includes("Dropped “Handles empty input”")));
});

test("notice v6 leaves payloads without req fields unchanged", () => {
  const view = helpers.buildUnblockedNoticeModel({
    unblocked: [],
    offer_closes: [{
      outcome: "done", text: "Write tests", message: "✓ completed “Write tests”",
      recovered: [],
    }],
  });
  assert.ok(view);
  assert.equal(view.reqOutcomes, undefined);
  assert.doesNotMatch(view.text, /requirements met/);
});

test("failure-only requirement receipts leave visibility to the cycler's plain Notice", () => {
  const shown = helpers.showUnblockedNotice({}, {
    version: 1,
    predecessors: [],
    unblocked: [],
    still_blocked: [],
    failures: [{
      kind: "requirement",
      code: "req_close_stale",
      key: "Tasks.md#^export",
      reason: "requirement choices went stale for “Ship the exporter”",
    }],
  });
  assert.equal(shown, false);
});
