const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const {
  createArrangement,
  compileAlbumArrangement,
  compileBankArrangement,
  simulateAlbumOps,
  simulateBankOps,
  arrangeGapHintLabels,
  arrangeFlipPlan,
} = LedgerToolsPlugin.helpers;

function permutations(values) {
  if (values.length < 2) return [values.slice()];
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    const rest = values.filter((_, candidate) => candidate !== index);
    for (const tail of permutations(rest)) result.push([head, ...tail]);
  }
  return result;
}

function lisLength(values) {
  const lengths = new Array(values.length).fill(1);
  let best = 0;
  for (let index = 0; index < values.length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      if (values[previous] < values[index]) lengths[index] = Math.max(lengths[index], lengths[previous] + 1);
    }
    best = Math.max(best, lengths[index]);
  }
  return best;
}

function arrangeTo(arrangement, scope, target) {
  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    const current = arrangement.projected(scope);
    const currentIndex = current.indexOf(target[targetIndex]);
    if (currentIndex > targetIndex) arrangement.nudge(scope, target[targetIndex], targetIndex - currentIndex);
    else if (currentIndex < targetIndex) arrangement.nudge(scope, target[targetIndex], targetIndex - currentIndex);
  }
  assert.deepEqual(arrangement.projected(scope), target);
}

test("album compiler simulates every permutation through six items using n − LIS moves", () => {
  for (let size = 0; size <= 6; size += 1) {
    const base = Array.from({ length: size }, (_, index) => `f${index}`);
    const originalIndexes = new Map(base.map((id, index) => [id, index]));
    for (const target of permutations(base)) {
      const arrangement = createArrangement({ scopes: { fields: base } });
      arrangeTo(arrangement, "fields", target);
      const ops = compileAlbumArrangement(arrangement);
      assert.ok(Array.isArray(ops), JSON.stringify({ base, target, ops }));
      assert.deepEqual(simulateAlbumOps(arrangement, ops).fields, target);
      assert.equal(ops.length, size - lisLength(target.map((id) => originalIndexes.get(id))));
    }
  }
});

test("album compilers keep choice scopes isolated and prove the whole projection", () => {
  const arrangement = createArrangement({ scopes: {
    fields: ["status", "title"],
    "choices:status": ["ready", "blocked", "done"],
    "choices:title": ["one", "two"],
  } });
  arrangeTo(arrangement, "fields", ["title", "status"]);
  arrangeTo(arrangement, "choices:status", ["done", "ready", "blocked"]);
  const ops = compileAlbumArrangement(arrangement);
  assert.ok(Array.isArray(ops));
  assert.equal(ops.filter((op) => op.op === "field.move").length, 1);
  assert.equal(ops.filter((op) => op.op === "choice.move").length, 1);
  assert.deepEqual(simulateAlbumOps(arrangement, ops), arrangement.scopes());
  assert.deepEqual(compileAlbumArrangement(createArrangement({ scopes: { fields: ["a", "b"] } })), []);
});

test("a 100-item deterministic shuffle compiles and simulates with the minimum op count", () => {
  const base = Array.from({ length: 100 }, (_, index) => `id-${index}`);
  let seed = 0x6d2b79f5;
  const target = base.slice();
  for (let index = target.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (index + 1);
    [target[index], target[other]] = [target[other], target[index]];
  }
  const arrangement = createArrangement({ scopes: { fields: base } });
  arrangeTo(arrangement, "fields", target);
  const ops = compileAlbumArrangement(arrangement);
  assert.ok(Array.isArray(ops));
  assert.deepEqual(simulateAlbumOps(arrangement, ops).fields, target);
  assert.equal(ops.length, base.length - lisLength(target.map((id) => Number(id.slice(3)))));
});

test("nudges, edges, no-op gaps, local undo coalescing, and revert behave consistently", () => {
  const arrangement = createArrangement({ scopes: { fields: ["a", "b", "c", "d"] } });
  assert.deepEqual(arrangement.nudge("fields", "a", -1), { ok: true, clamped: true });
  assert.deepEqual(arrangement.projected("fields"), ["a", "b", "c", "d"]);
  assert.deepEqual(arrangement.toEdge("fields", "a", "last"), { ok: true, clamped: false });
  assert.deepEqual(arrangement.projected("fields"), ["b", "c", "d", "a"]);
  assert.equal(arrangement.stepBack(), true);
  assert.deepEqual(arrangement.projected("fields"), ["a", "b", "c", "d"]);
  assert.deepEqual(arrangement.toEdge("fields", "d", "first"), { ok: true, clamped: false });
  assert.deepEqual(arrangement.projected("fields"), ["d", "a", "b", "c"]);
  assert.equal(arrangement.placeAtGap("fields", "d", 0).ok, false, "the current gap is a no-op");
  assert.equal(arrangement.placeAtGap("fields", "d", 1).ok, false, "the adjacent gap is a no-op");
  arrangement.revert();
  assert.equal(arrangement.dirty(), false);

  assert.equal(arrangement.nudge("fields", "c", -1, { coalesceKey: "held-left" }).ok, true);
  assert.equal(arrangement.nudge("fields", "c", -1, { coalesceKey: "held-left" }).ok, true);
  assert.deepEqual(arrangement.projected("fields"), ["c", "a", "b", "d"]);
  assert.equal(arrangement.stepBack(), true);
  assert.deepEqual(arrangement.projected("fields"), ["a", "b", "c", "d"]);
  assert.equal(arrangement.stepBack(), false);
});

test("fixed ids and slots constrain legal gaps and nudges", () => {
  const arrangement = createArrangement({
    scopes: { groups: ["Money", "Food", "Home", "HIDDEN"] },
    fixed: { groups: { ids: ["Money", "HIDDEN"], slots: [0] } },
  });
  assert.deepEqual(arrangement.nudge("groups", "Money", 1), { ok: true, clamped: true });
  assert.deepEqual(arrangement.projected("groups"), ["Money", "Food", "Home", "HIDDEN"]);
  assert.equal(arrangement.legalGaps("groups", "Food").includes(0), false);
  assert.equal(arrangement.nudge("groups", "HIDDEN", -1).clamped, true);
  assert.deepEqual(arrangement.toEdge("groups", "Home", "first"), { ok: true, clamped: true });
  assert.deepEqual(arrangement.projected("groups"), ["Money", "Home", "Food", "HIDDEN"]);
});

test("rebase keeps added ids, drops vanished moves, and falls back past a vanished anchor", () => {
  const arrangement = createArrangement({ scopes: { fields: ["a", "b", "c", "d", "e"] } });
  assert.equal(arrangement.nudge("fields", "e", -1).ok, true); // e follows c
  assert.equal(arrangement.nudge("fields", "d", -2).ok, true); // d follows b
  const result = arrangement.rebase({ fields: ["new", "a", "b", "d", "e"] });
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(arrangement.projected("fields"), ["new", "a", "b", "d", "e"]);

  const vanished = createArrangement({ scopes: { fields: ["a", "b", "c"] } });
  vanished.nudge("fields", "c", -2);
  assert.deepEqual(vanished.rebase({ fields: ["new", "a", "b"] }).dropped, [
    { scope: "fields", id: "c", reason: "vanished" },
  ]);
  assert.deepEqual(vanished.projected("fields"), ["new", "a", "b"]);

  const fallback = createArrangement({ scopes: { fields: ["a", "b", "c", "d", "e"] } });
  fallback.nudge("fields", "e", -1); // after c; c will disappear
  fallback.rebase({ fields: ["a", "b", "d", "e"] });
  assert.deepEqual(fallback.projected("fields"), ["a", "b", "e", "d"]);
});

test("save marker success rebases follow-on moves, while failure keeps all moves pending", () => {
  const arrangement = createArrangement({ scopes: { fields: ["a", "b", "c", "d"] } });
  arrangement.nudge("fields", "d", -3);
  assert.deepEqual(arrangement.beginSave(), { fields: ["d", "a", "b", "c"] });
  arrangement.nudge("fields", "b", -1);
  assert.deepEqual(arrangement.projected("fields"), ["d", "b", "a", "c"]);
  assert.equal(arrangement.settleSave(true), true);
  assert.deepEqual(arrangement.saved("fields"), ["d", "a", "b", "c"]);
  assert.deepEqual(arrangement.projected("fields"), ["d", "b", "a", "c"]);
  assert.equal(arrangement.dirty(), true);
  assert.equal(arrangement.stepBack(), true);
  assert.deepEqual(arrangement.projected("fields"), ["d", "a", "b", "c"]);
  assert.equal(arrangement.dirty(), false);

  const failed = createArrangement({ scopes: { fields: ["a", "b", "c"] } });
  failed.nudge("fields", "c", -2);
  failed.beginSave();
  failed.nudge("fields", "a", 1);
  assert.equal(failed.settleSave(false), true);
  assert.deepEqual(failed.saved("fields"), ["a", "b", "c"]);
  assert.deepEqual(failed.projected("fields"), ["c", "b", "a"]);
  assert.equal(failed.dirty(), true);
});

test("bank group and category compilers preserve blocks, Money, and no-cross-group moves", () => {
  const groups = ["Money", "Everyday", "Bills", "HIDDEN"];
  const categories = [
    { key: "cash", group: "Money" },
    { key: "coffee", group: "Everyday" },
    { key: "food", group: "Everyday" },
    { key: "rent", group: "Bills" },
    { key: "old", group: "HIDDEN", hidden: true },
  ];
  const arrangement = createArrangement({
    scopes: {
      groups,
      "group:Money": ["cash"],
      "group:Everyday": ["coffee", "food"],
      "group:Bills": ["rent"],
      rules: [],
    },
    fixed: { groups: { ids: ["Money", "HIDDEN"], slots: [0] } },
  });
  arrangeTo(arrangement, "groups", ["Money", "Bills", "Everyday", "HIDDEN"]);
  arrangeTo(arrangement, "group:Everyday", ["food", "coffee"]);
  const ops = compileBankArrangement(arrangement, { categories, rules: [] });
  assert.ok(Array.isArray(ops), JSON.stringify(ops));
  assert.deepEqual(ops.map((op) => op.op), ["group.move", "category.move"]);
  const replayed = simulateBankOps({ groups, categories, rules: [] }, ops);
  assert.deepEqual(replayed.groups, arrangement.projected("groups"));
  assert.deepEqual(replayed.categories.map((row) => row.key), ["cash", "rent", "food", "coffee", "old"]);
  const invalidCrossGroup = createArrangement({ scopes: {
    groups,
    "group:Everyday": ["coffee", "rent"],
    rules: [],
  } });
  arrangeTo(invalidCrossGroup, "group:Everyday", ["rent", "coffee"]);
  assert.equal(compileBankArrangement(invalidCrossGroup, { categories, rules: [] }).ok, false,
    "a category in another declared group cannot compile as an in-group move");
});

test("bank category compiler preserves interleaved ungrouped and built-in rows", () => {
  const groups = ["Everyday", "Bills", "Money moves"];
  const categories = [
    { key: "groceries", group: null },
    { key: "dining", group: null },
    { key: "coffee", group: "Everyday" },
    { key: "convenience", group: "Everyday" },
    { key: "housing", group: "Bills" },
    { key: "utilities", group: "Bills" },
    { key: "income", group: "Money moves" },
    { key: "refund", group: "Money moves" },
    { key: "kids", group: null, hidden: true },
    { key: "misc", group: null },
    { key: "transfer", group: "Money moves" },
    { key: "cash", group: "Money moves" },
  ];
  const arrangement = createArrangement({ scopes: {
    groups,
    "group:Everyday": ["coffee", "convenience"],
    "group:Bills": ["housing", "utilities"],
    "group:Money moves": ["income", "refund", "transfer", "cash"],
    rules: [],
  } });
  assert.deepEqual(arrangement.nudge("group:Everyday", "coffee", 1), { ok: true, clamped: false });
  const ops = compileBankArrangement(arrangement, { categories, rules: [] });
  assert.deepEqual(ops, [{ op: "category.move", key: "coffee", after: "convenience" }]);
  const replay = simulateBankOps({ groups, categories, rules: [] }, ops);
  assert.deepEqual(replay.categories.map((category) => category.key), [
    "groceries", "dining", "convenience", "coffee", "housing", "utilities",
    "income", "refund", "kids", "misc", "transfer", "cash",
  ]);
});

test("bank compiler uses current rule indices even when match text is duplicated", () => {
  const rules = [
    { match: "VENMO", category: "a" },
    { match: "VENMO", category: "b" },
    { match: "COFFEE", category: "c" },
    { match: "RENT", category: "d" },
  ];
  const arrangement = createArrangement({ scopes: { groups: [], rules: ["r0", "r1", "r2", "r3"] } });
  arrangeTo(arrangement, "rules", ["r3", "r0", "r1", "r2"]);
  const ops = compileBankArrangement(arrangement, { categories: [], rules });
  assert.ok(Array.isArray(ops), JSON.stringify(ops));
  const replay = simulateBankOps({ groups: [], categories: [], rules: rules.map((rule, index) => ({ ...rule, id: `r${index}` })) }, ops);
  assert.deepEqual(replay.rules.map((rule) => rule.id), ["r3", "r0", "r1", "r2"]);
  let identities = ["r0", "r1", "r2", "r3"];
  for (const op of ops) {
    assert.equal(rules[Number(identities[op.index].slice(1))].match, op.match_was);
    const [id] = identities.splice(op.index, 1);
    identities.splice(op.position, 0, id);
  }
  assert.deepEqual(identities, arrangement.projected("rules"));
});

test("bank group compiler fuzzes all permutations through six groups", () => {
  for (let size = 0; size <= 6; size += 1) {
    const base = Array.from({ length: size }, (_, index) => `g${index}`);
    const originalIndexes = new Map(base.map((id, index) => [id, index]));
    for (const target of permutations(base)) {
      const arrangement = createArrangement({ scopes: { groups: base, rules: [] } });
      arrangeTo(arrangement, "groups", target);
      const ops = compileBankArrangement(arrangement, { categories: [], rules: [] });
      assert.ok(Array.isArray(ops), JSON.stringify({ base, target, ops }));
      assert.deepEqual(simulateBankOps({ groups: base, categories: [], rules: [] }, ops).groups, target);
      assert.equal(ops.length, size - lisLength(target.map((id) => originalIndexes.get(id))));
    }
  }
});

test("bank category and duplicate-match rule compilers fuzz all permutations through six items", () => {
  for (let size = 0; size <= 6; size += 1) {
    const categoryIds = Array.from({ length: size }, (_, index) => `c${index}`);
    const ruleIds = Array.from({ length: size }, (_, index) => `r${index}`);
    const categories = categoryIds.map((key) => ({ key, group: "Food" }));
    const rules = ruleIds.map((id, index) => ({ id, match: index % 2 ? "DUPLICATE" : "COFFEE" }));
    const originalCategoryIndexes = new Map(categoryIds.map((id, index) => [id, index]));
    const originalRuleIndexes = new Map(ruleIds.map((id, index) => [id, index]));
    for (const target of permutations(categoryIds)) {
      const arrangement = createArrangement({ scopes: {
        groups: ["Food"],
        "group:Food": categoryIds,
        rules: [],
      } });
      arrangeTo(arrangement, "group:Food", target);
      const ops = compileBankArrangement(arrangement, { categories, rules: [] });
      assert.ok(Array.isArray(ops), JSON.stringify({ categoryIds, target, ops }));
      const replay = simulateBankOps({ groups: ["Food"], categories, rules: [] }, ops);
      assert.deepEqual(replay.categories.map((row) => row.key), target);
      assert.equal(ops.length, size - lisLength(target.map((id) => originalCategoryIndexes.get(id))));
    }
    for (const target of permutations(ruleIds)) {
      const arrangement = createArrangement({ scopes: { groups: [], rules: ruleIds } });
      arrangeTo(arrangement, "rules", target);
      const ops = compileBankArrangement(arrangement, { categories: [], rules });
      assert.ok(Array.isArray(ops), JSON.stringify({ ruleIds, target, ops }));
      const replay = simulateBankOps({ groups: [], categories: [], rules }, ops);
      assert.deepEqual(replay.rules.map((row) => row.id), target);
      assert.equal(ops.length, size - lisLength(target.map((id) => originalRuleIndexes.get(id))));
    }
  }
});

test("gap labels are home-row-first, fixed-width, and prefix-free", () => {
  const alphabet = "asdfghjklqwertyuiopzxcvbnm";
  assert.deepEqual(arrangeGapHintLabels(1), ["a"]);
  assert.equal(arrangeGapHintLabels(26).join(""), alphabet);
  for (const count of [27, 200]) {
    const labels = arrangeGapHintLabels(count);
    assert.equal(labels.length, count);
    assert.ok(labels.every((label) => label.length === 2));
    assert.equal(new Set(labels).size, count);
    assert.ok(labels.every((label, index) => labels.every((other, otherIndex) =>
      index === otherIndex || !other.startsWith(label))));
  }
});

test("FLIP plans use stable ids and old minus new geometry", () => {
  assert.deepEqual(arrangeFlipPlan(
    { a: { left: 10, top: 20 }, b: { x: 4, y: 5 }, gone: { left: 0, top: 0 } },
    { a: { left: 20, top: 12 }, b: { x: 4, y: 5 }, added: { left: 9, top: 9 } },
  ), { a: { dx: -10, dy: 8 } });
  assert.deepEqual(arrangeFlipPlan(new Map([["x", { left: 5, top: 6 }]]), new Map([["x", { left: 1, top: 2 }]])), {
    x: { dx: 4, dy: 4 },
  });
});
