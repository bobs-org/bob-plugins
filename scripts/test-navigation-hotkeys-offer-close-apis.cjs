const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers, createFragmentNode, findFragmentNode, nodeHasClass } = require("./navigation-hotkeys-harness.cjs");

const cancelApi = helpers.createCancelApi();
const date = "2026-11-05";
const target = (rawLine) => [{ line: 0, rawLine }];

test("cancel v1 delegates to Task Card cancel vectors", () => {
  const fixture = path.join(__dirname, "../plugins/bob-navigation-hotkeys/scripts/fixtures/task_cancel/vectors.json");
  const vectors = JSON.parse(fs.readFileSync(fixture, "utf8"));
  for (const row of vectors.cancel.filter((entry) => !entry.rust_only && !entry.fallbackReason)) {
    const result = cancelApi.planCancel(row.content, target(row.content.split(/\r?\n/)[row.line]), {
      date: row.date,
      reason: row.reason,
    });
    assert.equal(result.valid, row.expected.valid, row.name);
    if (result.valid) assert.equal(result.content, row.expected.content, row.name);
  }
});

test("cancel v1 applies the fixed blank-reason fallback only to an existing log", () => {
  const task = "- [ ] #task Task ^task";
  const existing = `${task}\n  - ❌ **CANCEL LOG**\n    - *2026-11-04* — old`;
  const blank = cancelApi.planCancel(existing, target(task), { date, reason: " " });
  assert.match(blank.content, /🤷 no reason given/);
  const authored = cancelApi.planCancel(task, target(task), { date, reason: " duplicate " });
  assert.match(authored.content, /duplicate/);
  assert.match(authored.content, /CANCEL LOG/);
  const noLog = cancelApi.planCancel(task, target(task), { date, reason: "" });
  assert.equal(noLog.valid, true);
  assert.match(noLog.content, new RegExp(`\\[cancelled:: ${date}\\]`));
  assert.doesNotMatch(noLog.content, /CANCEL LOG/);
});

test("notice v4 renders offer closes, refusal copy, ticklers, and guarded Undo action", () => {
  const view = helpers.buildUnblockedNoticeModel({
    unblocked: [],
    offer_closes: [{
      outcome: "done", text: "Write tests", message: "✓ completed “Write tests” · Ready → Done",
      recovered: [{ text: "Ship it", unblocked_stamped: true }],
    }],
    offer_close_refused: { count: 1, rows: [{ text: "Review code", why: "changed" }] },
    undo: { restores: [{ path: "work.md", before: "before", after: "after" }] },
    __noticePlugin: { restoreGuardedSnapshots() {} },
  });
  assert.ok(view);
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(view, root, {});
  assert.ok(findFragmentNode(root, nodeHasClass("is-done")));
  assert.ok(findFragmentNode(root, (node) => node.text.includes("back tomorrow as a tickler")));
  assert.ok(findFragmentNode(root, (node) => node.text.includes("changed since the card opened")));
  assert.equal(findFragmentNode(root, (node) => node.text === "Undo closes").text, "Undo closes");
});

test("notice v4 preserves failure-only payloads and aggregates stamped recoveries", () => {
  const failureOnly = helpers.buildUnblockedNoticeModel({
    offer_closes: [],
    offer_close_refused: null,
    failures: [{ kind: "recovery", path: "Deps.md", reason: "disk full" }],
  });
  assert.ok(failureOnly);
  assert.match(failureOnly.text, /Recovery failed/);
  assert.match(failureOnly.text, /Deps\.md/);
  assert.match(failureOnly.text, /disk full/);
  const failedRoot = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(failureOnly, failedRoot, {});
  assert.ok(findFragmentNode(failedRoot, (node) => node.text.includes("Recovery failed")));

  const mixed = helpers.buildUnblockedNoticeModel({
    offer_closes: [{
      outcome: "done", text: "Root", message: "✓ completed Root",
      recovered: [
        { text: "A", unblocked_stamped: true },
        { text: "B", unblocked_stamped: true },
        { text: "C", unblocked_stamped: false },
      ],
    }],
  });
  const root = createFragmentNode();
  helpers.renderUnblockedNoticeFragment(mixed, root, {});
  assert.equal(findFragmentNode(root, (node) => node.text.includes("2 unblocked tasks back tomorrow as ticklers")).text,
    "↳ 2 unblocked tasks back tomorrow as ticklers");
  assert.equal(findFragmentNode(root, (node) => node.text.includes("A back tomorrow")), null);

  const legacy = helpers.buildUnblockedNoticeModel({ failures: [{ kind: "recovery", reason: "old payload" }] });
  assert.equal(legacy, null, "payloads without the v4 offer-close marker keep prior behavior");
});
