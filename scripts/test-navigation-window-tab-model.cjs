const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  buildWindowPrefixTabCatalog,
  buildWindowPrefixViewModel,
  planWindowPrefixFocus,
  planWindowPrefixKey,
  windowPrefixCtrlWOwner,
  windowPrefixDigitFromKeydown,
  windowTabNumeralsVerdict,
} = helpers;

function leaf(id, options = {}) {
  return {
    id,
    label: options.label ?? id,
    pinned: options.pinned === true,
  };
}

function split(id, left, top, leaves, selectedLeafId = leaves[0]?.id) {
  return {
    id,
    rect: { left, top, right: left + 100, bottom: top + 100 },
    leaves,
    selectedLeafId,
  };
}

function snapshot(activeLeafId, splits, capabilities) {
  return { activeLeafId, splits, ...(capabilities ? { capabilities } : {}) };
}

function twoSplitSnapshot() {
  const a = leaf("a");
  const b = leaf("b");
  const c = leaf("c");
  const d = leaf("d");
  return snapshot("b", [
    split("left", 0, 0, [a, b], "b"),
    split("right", 100, 0, [c, d], "c"),
  ]);
}

test("tab catalog numbers each leaf globally in split reading order and preserves tab identity", () => {
  const duplicateOne = leaf("dup-one", { label: "Same note", pinned: true });
  const duplicateTwo = leaf("dup-two", { label: "Same note" });
  const blankTitle = leaf("empty", { label: "" });
  const layout = snapshot("dup-two", [
    split("right", 100, 0, [duplicateTwo], "dup-two"),
    split("left-bottom", 0, 100, [blankTitle]),
    split("left-top", 0, 0, [duplicateOne]),
  ]);
  const catalog = buildWindowPrefixTabCatalog(layout);
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.tabs.map((tab) => [tab.number, tab.leafId, tab.splitId]), [
    [1, "dup-one", "left-top"],
    [2, "empty", "left-bottom"],
    [3, "dup-two", "right"],
  ]);
  assert.equal(catalog.tabs[0].pinned, true);
  assert.equal(catalog.tabs[0].selected, true);
  assert.equal(catalog.tabs[2].active, true);
  assert.equal(catalog.tabs[0].label, catalog.tabs[2].label);
  assert.deepEqual(catalog.splits, [
    { id: "left-top", first: 1, last: 1, unnumbered: 0 },
    { id: "left-bottom", first: 2, last: 2, unnumbered: 0 },
    { id: "right", first: 3, last: 3, unnumbered: 0 },
  ]);
});

test("catalog supports one, two, three, and stacked splits while matching the w cycle", () => {
  const fixtures = [
    snapshot("a", [split("one", 0, 0, [leaf("a")])]),
    twoSplitSnapshot(),
    snapshot("a", [
      split("right", 100, 0, [leaf("c")]),
      split("middle", 50, 0, [leaf("b")]),
      split("left", 0, 0, [leaf("a")]),
    ]),
    snapshot("a", [
      split("right", 100, 0, [leaf("c")]),
      split("left-bottom", 0, 100, [leaf("b")]),
      split("left-top", 0, 0, [leaf("a")]),
    ]),
  ];
  for (const item of fixtures) {
    const catalog = buildWindowPrefixTabCatalog(item);
    const view = buildWindowPrefixViewModel(item);
    const order = catalog.splits.map((entry) => entry.id);
    assert.deepEqual(view.splits.map((entry) => entry.id), order);
    for (let index = 0; index < order.length; index += 1) {
      const current = item.splits.find((entry) => entry.id === order[index]);
      const activeLeafId = current.selectedLeafId;
      const active = { ...item, activeLeafId };
      const plan = planWindowPrefixFocus(active, "next");
      if (order.length === 1) assert.equal(plan.available, false);
      else assert.equal(plan.targetSplitId, order[(index + 1) % order.length]);
    }
  }
});

test("equal-geometry split ordering uses layout-tree order instead of id spelling", () => {
  const item = snapshot("ten", [
    split("split-10", 0, 0, [leaf("ten")]),
    split("split-9", 0, 0, [leaf("nine")]),
  ]);
  const catalog = buildWindowPrefixTabCatalog(item);
  assert.deepEqual(catalog.tabs.map((tab) => [tab.number, tab.splitId]), [
    [1, "split-10"],
    [2, "split-9"],
  ]);
  assert.equal(planWindowPrefixFocus(item, "next").targetSplitId, "split-9");
  const noMainAreaFocus = buildWindowPrefixTabCatalog({ ...item, activeLeafId: null });
  assert.equal(noMainAreaFocus.ok, true);
  assert.equal(noMainAreaFocus.tabs.every((tab) => tab.active === false), true);
});

test("thirteen tabs number only the first nine and give each split its own range", () => {
  const first = Array.from({ length: 6 }, (_unused, index) => leaf("a" + String(index + 1)));
  const second = Array.from({ length: 7 }, (_unused, index) => leaf("b" + String(index + 1)));
  const item = snapshot("a1", [
    split("first", 0, 0, first),
    split("second", 100, 0, second),
  ]);
  const catalog = buildWindowPrefixTabCatalog(item);
  const view = buildWindowPrefixViewModel(item);
  assert.equal(catalog.total, 13);
  assert.equal(catalog.numbered, 9);
  assert.equal(catalog.unnumbered, 4);
  assert.equal(catalog.tabs.filter((tab) => tab.number == null).length, 4);
  assert.deepEqual(catalog.splits, [
    { id: "first", first: 1, last: 6, unnumbered: 0 },
    { id: "second", first: 7, last: 9, unnumbered: 4 },
  ]);
  assert.deepEqual(view.splits.map((entry) => entry.tabRange), [
    { first: 1, last: 6, unnumbered: 0, label: "1–6", ariaLabel: "tabs 1 to 6" },
    { first: 7, last: 9, unnumbered: 4, label: "7–9 +4", ariaLabel: "tabs 7 to 9, 4 more unnumbered" },
  ]);
  assert.deepEqual(view.tabs, {
    range: "1–9",
    total: 13,
    numbered: 9,
    unnumbered: 4,
    available: true,
    preview: "1–9 · 4 more unnumbered",
    aside: "4 more unnumbered",
  });
  const allPastNine = snapshot("x1", [
    split("early", 0, 0, Array.from({ length: 9 }, (_unused, index) => leaf("x" + String(index + 1)))),
    split("late", 100, 0, [leaf("late-1"), leaf("late-2")]),
  ]);
  assert.deepEqual(buildWindowPrefixViewModel(allPastNine).splits[1].tabRange, {
    first: null,
    last: null,
    unnumbered: 2,
    label: "+2",
    ariaLabel: "2 more unnumbered",
  });
});

test("digit plans cover same-split, cross-split, selected, unselected, and already-here tabs", () => {
  const item = twoSplitSnapshot();
  const one = planWindowPrefixKey(item, "1");
  assert.deepEqual(
    (({ action, targetSplitId, targetLeafId, crossSplit, alreadyHere }) =>
      ({ action, targetSplitId, targetLeafId, crossSplit, alreadyHere }))(one),
    { action: "focus-tab", targetSplitId: "left", targetLeafId: "a", crossSplit: false, alreadyHere: false },
  );
  const crossSelected = planWindowPrefixKey(item, "3");
  assert.equal(crossSelected.action, "focus-tab");
  assert.equal(crossSelected.targetLeafId, "c");
  assert.equal(crossSelected.crossSplit, true);
  const crossUnselected = planWindowPrefixKey(item, "4");
  assert.equal(crossUnselected.targetLeafId, "d");
  assert.equal(crossUnselected.crossSplit, true);
  const already = planWindowPrefixKey(item, "2");
  assert.equal(already.alreadyHere, true);
  assert.equal(already.reason, "already-here");
  assert.equal(already.action, "focus-tab");
  assert.deepEqual(planWindowPrefixKey(item, "7"), {
    ok: true,
    available: false,
    action: "noop",
    key: "7",
    sourceSplitId: "left",
    sourceLeafId: "b",
    activeLeafId: "b",
    reason: "no-such-tab",
    preview: "No tab 7 · 4 tabs",
    consequence: null,
  });
  assert.equal(planWindowPrefixKey(snapshot("b", [split("one", 0, 0, [leaf("a"), leaf("b")])]), "3").preview,
    "No tab 3 · 2 tabs");
  assert.equal(planWindowPrefixKey(
    snapshot("a", [split("one", 0, 0, [leaf("a")])]), "2",
  ).preview, "No tab 2 · only 1 tab");
});

test("armed catalogs refuse stale positional targets and focus API loss keeps its contract", () => {
  const armed = twoSplitSnapshot();
  const armedCatalog = buildWindowPrefixTabCatalog(armed);
  const fresh = twoSplitSnapshot();
  fresh.splits[1].leaves[0] = leaf("replacement");
  fresh.splits[1].selectedLeafId = "replacement";
  const stale = planWindowPrefixKey(fresh, "3", { armedCatalog });
  assert.equal(stale.action, "noop");
  assert.equal(stale.reason, "tabs-changed");
  assert.equal(stale.disarm, true);
  assert.equal(stale.preview, "Tabs changed — try again");
  const unchanged = planWindowPrefixKey(armed, "3", { armedCatalog });
  assert.equal(unchanged.targetLeafId, armedCatalog.byNumber[3].leafId);
  const unavailable = planWindowPrefixKey(
    snapshot("b", [split("one", 0, 0, [leaf("a"), leaf("b")], "b")], { focus: false }),
    "1",
  );
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reason, "layout-api-changed");
  assert.equal(unavailable.preview, "Obsidian layout API changed");
});

test("digit normalization accepts platform digits and rejects reserved or modified keys", () => {
  assert.equal(windowPrefixDigitFromKeydown({ key: "3" }), "3");
  assert.equal(windowPrefixDigitFromKeydown({ key: "\u0003", code: "Digit3", ctrlKey: true }), "3");
  assert.equal(windowPrefixDigitFromKeydown({ key: "", code: "Numpad8", ctrlKey: true }), "8");
  assert.equal(windowPrefixDigitFromKeydown({ key: "3", shiftKey: true }), "3");
  assert.equal(windowPrefixDigitFromKeydown({ key: "#", code: "Digit3", shiftKey: true, ctrlKey: true }), null);
  assert.equal(windowPrefixDigitFromKeydown({ key: "0", code: "Digit0", ctrlKey: true }), null);
  assert.equal(windowPrefixDigitFromKeydown({ key: "3", metaKey: true }), null);
  assert.equal(windowPrefixDigitFromKeydown({ key: "3", altKey: true }), null);
  assert.equal(windowPrefixDigitFromKeydown({ key: "3", repeat: true }), null);
  assert.equal(windowPrefixDigitFromKeydown({ key: "3", isComposing: true }), null);
  assert.equal(windowPrefixDigitFromKeydown({ key: "End", code: "Numpad1", ctrlKey: true }), null);
  assert.equal(windowPrefixDigitFromKeydown({ key: "", code: "Digit4", ctrlKey: true, shiftKey: true }), null);
});

test("Ctrl+W owner detection and numeral visibility use platform and card gates", () => {
  const mod = [{ commandId: "workspace:close", modifiers: ["Mod"], key: "W" }];
  const ctrl = [{ commandId: "workspace:close", modifiers: ["Ctrl"], key: "w" }];
  assert.equal(windowPrefixCtrlWOwner(mod, { mac: false }), "workspace:close");
  assert.equal(windowPrefixCtrlWOwner(mod, { mac: true }), null);
  assert.equal(windowPrefixCtrlWOwner(ctrl, { mac: true }), "workspace:close");
  assert.equal(windowPrefixCtrlWOwner([
    { commandId: "other", modifiers: ["Ctrl", "Shift"], key: "W" },
    { commandId: "other", modifiers: ["Ctrl"], key: "l" },
  ], { mac: false }), null);
  assert.deepEqual(windowTabNumeralsVerdict({ tabCount: 4, ctrlWOwner: null, hotkeysKnown: true }), {
    show: true, lit: false, reason: "available",
  });
  assert.equal(windowTabNumeralsVerdict({ tabCount: 4, phone: true, hotkeysKnown: true }).show, false);
  assert.equal(windowTabNumeralsVerdict({ tabCount: 1, hotkeysKnown: true }).reason, "one-tab");
  assert.equal(windowTabNumeralsVerdict({ tabCount: 4, ctrlWOwner: "workspace:close", hotkeysKnown: true }).show, false);
  assert.equal(windowTabNumeralsVerdict({ tabCount: 4, ctrlWOwner: "workspace:close", hotkeysKnown: true, lit: true }).lit, true);
  assert.equal(windowTabNumeralsVerdict({ tabCount: 4, ctrlWOwner: null, hotkeysKnown: false, mac: false }).reason, "hotkeys-unknown");
  assert.equal(windowTabNumeralsVerdict({ tabCount: 4, ctrlWOwner: null, hotkeysKnown: false, mac: true }).show, true);
  assert.deepEqual(windowTabNumeralsVerdict({ tabCount: 4, hotkeysKnown: true, headersAvailable: false, lit: true }), {
    show: false, lit: false, reason: "headers-unavailable",
  });
});

test("catalog, planner targets, view-model ranges, and split cycle stay in parity", () => {
  const fixtures = [
    twoSplitSnapshot(),
    snapshot("a", [
      split("bottom", 0, 100, [leaf("b"), leaf("c")], "c"),
      split("top", 0, 0, [leaf("a")]),
      split("right", 100, 0, [leaf("d")]),
    ]),
    snapshot("a1", [
      split("first", 0, 0, Array.from({ length: 6 }, (_unused, index) => leaf("a" + String(index + 1)))),
      split("second", 100, 0, Array.from({ length: 7 }, (_unused, index) => leaf("b" + String(index + 1)))),
    ]),
  ];
  for (const item of fixtures) {
    const catalog = buildWindowPrefixTabCatalog(item);
    const view = buildWindowPrefixViewModel(item);
    assert.deepEqual(view.splits.map((entry) => entry.tabRange.first), catalog.splits.map((entry) => entry.first));
    assert.deepEqual(view.splits.map((entry) => entry.tabRange.last), catalog.splits.map((entry) => entry.last));
    assert.deepEqual(view.splits.map((entry) => entry.tabRange.unnumbered), catalog.splits.map((entry) => entry.unnumbered));
    for (let number = 1; number <= catalog.numbered; number += 1) {
      const plan = planWindowPrefixKey(item, String(number));
      assert.equal(plan.targetLeafId, catalog.byNumber[number].leafId);
    }
    const order = catalog.splits.map((entry) => entry.id);
    for (let index = 0; index < order.length; index += 1) {
      const current = item.splits.find((entry) => entry.id === order[index]);
      const plan = planWindowPrefixFocus({ ...item, activeLeafId: current.selectedLeafId }, "next");
      if (order.length > 1) assert.equal(plan.targetSplitId, order[(index + 1) % order.length]);
    }
  }
});
