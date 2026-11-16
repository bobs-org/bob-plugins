const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  buildWindowPrefixViewModel,
  getWindowPrefixArmingVerdict,
  normalizeWindowPrefixKeydown,
  normalizeWindowPrefixSnapshot,
  planWindowPrefixFocus,
  planWindowPrefixKey,
  planWindowPrefixMove,
  planWindowPrefixSplit,
  WINDOW_PREFIX_KEY_TABLE,
} = helpers;

function split(id, x, leaves, options = {}) {
  return {
    id,
    rect: { left: x, top: 0, right: x + 100, bottom: 100 },
    leaves,
    selectedLeafId: options.selected ?? leaves[leaves.length - 1]?.id ?? leaves.at(-1),
    mostRecentLeafId: options.mostRecent,
    recency: options.recency ?? 0,
  };
}

function leaf(id, options = {}) {
  return { id, label: options.label ?? id, pinned: options.pinned === true };
}

function layout(activeLeafId, splits) {
  return { activeLeafId, splits };
}

test("window-prefix focus planners follow geometry, selection, and reading-order wrap", () => {
  const snapshot = layout("b", [
    split("left", 0, [leaf("a")]),
    split("middle", 100, [leaf("b"), leaf("c")], { selected: "c" }),
    split("right", 200, [leaf("d"), leaf("e")], { selected: "e" }),
  ]);
  assert.deepEqual(
    (({ action, targetSplitId, targetLeafId }) => ({ action, targetSplitId, targetLeafId }))(
      planWindowPrefixFocus(snapshot, "right"),
    ),
    { action: "focus", targetSplitId: "right", targetLeafId: "e" },
  );
  assert.equal(planWindowPrefixFocus(snapshot, "left").targetSplitId, "left");
  assert.equal(planWindowPrefixFocus(snapshot, "next").targetSplitId, "right");
  const rightEdge = planWindowPrefixFocus(layout("e", snapshot.splits), "right");
  assert.equal(rightEdge.available, false);
  assert.equal(rightEdge.reason, "at-right-edge");
  const one = planWindowPrefixFocus(layout("a", [split("only", 0, [leaf("a")])]), "next");
  assert.equal(one.reason, "only-one-split");
});

test("geometric focus requires vertical overlap and picks the nearest eligible split", () => {
  const current = {
    id: "current",
    rect: { left: 200, top: 20, right: 300, bottom: 80 },
    leaves: [leaf("c")],
    selectedLeafId: "c",
  };
  const snapshot = layout("c", [
    { id: "far", rect: { left: 0, top: 0, right: 150, bottom: 100 }, leaves: [leaf("f")] },
    { id: "near", rect: { left: 150, top: 30, right: 200, bottom: 70 }, leaves: [leaf("n")] },
    { id: "non-overlap", rect: { left: 150, top: 90, right: 200, bottom: 120 }, leaves: [leaf("x")] },
    current,
  ]);
  assert.equal(planWindowPrefixFocus(snapshot, "left").targetSplitId, "near");
  assert.equal(normalizeWindowPrefixSnapshot(snapshot).activeSplitId, "current");
});

test("move planners create, join, and collapse with pinned-prefix placement", () => {
  const create = planWindowPrefixMove(layout("b", [split("one", 0, [leaf("a"), leaf("b")])]), "right");
  assert.equal(create.action, "create-split");
  assert.equal(create.movedLeafId, "b");
  assert.equal(create.sourceSelectedLeafId, "a");

  const join = planWindowPrefixMove(layout("b", [
    split("source", 0, [leaf("a"), leaf("b")], { selected: "b", mostRecent: "a" }),
    split("dest", 100, [leaf("p", { pinned: true }), leaf("q"), leaf("r")], { selected: "q" }),
  ]), "right");
  assert.equal(join.action, "join");
  assert.equal(join.destinationIndex, 2);
  assert.equal(join.sourceSelectedLeafId, "a");
  assert.equal(join.sourceCollapsed, false);

  const pinnedJoin = planWindowPrefixMove(layout("p", [
    split("source", 0, [leaf("p", { pinned: true })]),
    split("dest", 100, [leaf("q", { pinned: true }), leaf("r"), leaf("s")], { selected: "r" }),
  ]), "right");
  assert.equal(pinnedJoin.destinationIndex, 1);
  assert.equal(pinnedJoin.preservePinned, true);
  assert.equal(pinnedJoin.sourceCollapsed, true);
  assert.equal(pinnedJoin.consequence, "closes this split");

  const unpinnedAfterPins = planWindowPrefixMove(layout("a", [
    split("source", 0, [leaf("a"), leaf("b")], { selected: "a" }),
    split("dest", 100, [leaf("q", { pinned: true }), leaf("r", { pinned: true }), leaf("c")], { selected: "q" }),
  ]), "right");
  assert.equal(unpinnedAfterPins.destinationIndex, 2);
});

test("move planners block edge-only tabs and the sole tab while preserving the layout", () => {
  const onlyTab = planWindowPrefixMove(layout("a", [split("only", 0, [leaf("a")])]), "left");
  assert.equal(onlyTab.available, false);
  assert.equal(onlyTab.reason, "only-tab-in-layout");
  assert.match(onlyTab.preview, /v splits/);

  const edgeTab = planWindowPrefixMove(layout("a", [
    split("left", 0, [leaf("a")]),
    split("right", 100, [leaf("b")]),
  ]), "left");
  assert.equal(edgeTab.available, false);
  assert.equal(edgeTab.reason, "at-left-edge");

  const middle = planWindowPrefixMove(layout("b", [
    split("left", 0, [leaf("a")]),
    split("middle", 100, [leaf("b")]),
    split("right", 200, [leaf("c")]),
  ]), "left");
  assert.equal(middle.action, "join");
  assert.equal(middle.sourceCollapsed, true);
});

test("split planner duplicates the active leaf to the right", () => {
  const plan = planWindowPrefixSplit(layout("note", [split("main", 0, [leaf("note")])]));
  assert.equal(plan.action, "duplicate");
  assert.equal(plan.sourceLeafId, "note");
  assert.equal(plan.direction, "right");
});

test("key normalization handles aliases, shifted letters, control fallback, and safe exits", () => {
  assert.deepEqual(normalizeWindowPrefixKeydown({ key: "ArrowLeft" }), {
    kind: "mapped", key: "h", inputKey: "ArrowLeft", consume: true,
  });
  assert.equal(normalizeWindowPrefixKeydown({ key: "H", shiftKey: true }).key, "H");
  assert.deepEqual(normalizeWindowPrefixKeydown({ key: "\u0008", code: "KeyH", ctrlKey: true }), {
    kind: "mapped", key: "h", inputKey: "h", consume: true,
  });
  assert.deepEqual(normalizeWindowPrefixKeydown({ key: "Shift" }), {
    kind: "ignore", reason: "modifier-only",
  });
  assert.deepEqual(normalizeWindowPrefixKeydown({ key: "x" }), {
    kind: "unmapped", key: "x", consume: true,
  });
  assert.equal(normalizeWindowPrefixKeydown({ key: "q" }).kind, "cancel");
  assert.equal(normalizeWindowPrefixKeydown({ key: "[", ctrlKey: true }).key, "Ctrl+[");
  assert.equal(normalizeWindowPrefixKeydown({ key: "l", altKey: true }).cancel, true);
  assert.deepEqual(normalizeWindowPrefixKeydown({ key: "l", repeat: true }), {
    kind: "ignore", reason: "repeat",
  });
  assert.deepEqual(normalizeWindowPrefixKeydown({ key: "l", isComposing: true }), {
    kind: "ignore", reason: "composition",
  });
  assert.equal(normalizeWindowPrefixKeydown({ key: "Tab" }).reason, "non-printable");
});

test("arming verdict accepts only eligible main-area Vim and non-editable contexts", () => {
  const common = {
    key: "w", code: "KeyW", ctrlKey: true, isMainWindow: true,
    activeLeafInRootSplit: true,
  };
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isMarkdownEditor: true, vimMode: "normal", vimKeyBuffer: [],
  }), { allowed: true, reason: "vim-navigation" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isMarkdownEditor: true, vimMode: "visual", vimKeyBuffer: "",
  }), { allowed: true, reason: "vim-navigation" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isMarkdownEditor: true, vimMode: "insert", vimKeyBuffer: [],
  }), { allowed: false, reason: "vim-mode" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isMarkdownEditor: true, vimMode: "normal", vimKeyBuffer: ["d"],
  }), { allowed: false, reason: "pending-vim-input" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isEditable: false,
  }), { allowed: true, reason: "non-editable-view" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isEditable: false, inModal: true,
  }), { allowed: false, reason: "blocked-overlay" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isEditable: false, defaultPrevented: true,
  }), { allowed: false, reason: "default-prevented" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isEditable: false, isMainWindow: false,
  }), { allowed: false, reason: "not-main-window" });
  assert.deepEqual(getWindowPrefixArmingVerdict({
    ...common, isEditable: false, ctrlKey: false,
  }), { allowed: false, reason: "not-ctrl-w" });
});

test("view rows use the same planners exposed for dispatch", () => {
  const snapshot = layout("b", [
    split("left", 0, [leaf("a")]),
    split("middle", 100, [leaf("b")]),
    split("right", 200, [leaf("c")]),
  ]);
  const view = buildWindowPrefixViewModel(snapshot);
  assert.equal(view.ok, true);
  assert.equal(view.activeSplitId, "middle");
  assert.deepEqual(view.groups.map((group) => group.label), ["FOCUS", "MOVE", "SPLIT"]);
  for (const row of view.rows) {
    assert.deepEqual(row.plan, planWindowPrefixKey(snapshot, row.key), `${row.key} plan parity`);
    const tableEntry = WINDOW_PREFIX_KEY_TABLE.find((entry) => entry.key === row.key);
    assert.ok(tableEntry, `key table entry ${row.key}`);
  }
  assert.equal(view.rows.find((row) => row.key === "h").available, true);
  assert.equal(view.rows.find((row) => row.key === "L").consequence, "closes this split");
  assert.equal(view.splits.find((split) => split.active).label, "b");
  assert.equal(view.splits.reduce((sum, split) => sum + split.widthRatio, 0), 1);
});
