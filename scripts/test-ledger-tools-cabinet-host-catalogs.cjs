"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

function notebookPlugin(catalog, stateOverrides = {}) {
  const state = {
    report: { catalogsByHostPath: new Map([["Areas/work.md", catalog]]) },
    stale: false,
    refreshing: false,
    syncBusy: false,
    ...stateOverrides,
  };
  return {
    notebookCatalogState: () => state,
    notebookCatalogPaintOptions: () => ({ handlers: { sync() {}, retry() {} } }),
  };
}

const REGION = [
  "<!-- bob:notebooks:begin v1 -->",
  "> [!notebooks]",
  "> - [[Notebook One]]",
  ">   - [[Nested Notebook]]",
  "<!-- bob:notebooks:end -->",
].join("\n");

test("host catalog source summaries count direct and nested links", () => {
  const scans = H.propertyCardCatalogRegions(REGION);
  const counts = H.propertyCardCabinetHostSourceCounts(scans.notebooks.regions[0]);
  assert.deepEqual(counts, { direct: 1, nested: 1 });

  const plugin = notebookPlugin({ state: "current", notebooks: 2 });
  const applied = H.propertyCardCabinetHostApply(plugin, "notebooks", {
    path: "Areas/work.md", species: "area", source: REGION,
  });
  assert.equal(applied.summary, "2 notebooks · 1 nested");
  assert.equal(applied.attention, null);
  assert.equal(applied.problems, "");
  assert.equal(applied.actions.length, 0);
});

test("missing, stale, and damaged host catalogs stay actionable, including empty reports", () => {
  const missing = H.propertyCardCabinetHostApply(
    notebookPlugin({ state: "missing", notebooks: 0 }),
    "notebooks",
    { path: "Areas/work.md", species: "area", source: "# Work\n" },
  );
  assert.equal(missing.summary, "0 notebooks");
  assert.equal(missing.attention.word, "missing");
  assert.match(missing.actions[0].label, /Sync/);

  const stale = H.propertyCardCabinetHostApply(
    notebookPlugin({ state: "stale", notebooks: 0 }),
    "notebooks",
    { path: "Areas/work.md", species: "area", source: "# Work\n" },
  );
  assert.equal(stale.attention.word, "stale");
  assert.match(stale.actions[0].label, /Sync/);

  const damaged = H.propertyCardCabinetHostApply(
    notebookPlugin({ state: "current", notebooks: 1 }),
    "notebooks",
    {
      path: "Areas/work.md", species: "area",
      source: "<!-- bob:notebooks:begin v1 -->\n> [!notebooks]\n> - [[Notebook One]]\n",
    },
  );
  assert.ok(damaged.damage);
  assert.equal(damaged.attention.word, "damaged");
  assert.match(damaged.actions[0].label, /Sync/);
});

test("current empty catalogs disappear and non-property card species do not acquire providers", () => {
  const plugin = notebookPlugin({ state: "current", notebooks: 0 });
  assert.equal(H.propertyCardCabinetHostApply(plugin, "notebooks", {
    path: "Areas/work.md", species: "area", source: "# Work\n",
  }), null);
  assert.equal(H.propertyCardCabinetHostApply(plugin, "notebooks", {
    path: "Inbox.md", species: "prose", source: REGION,
  }), null);
});

test("provider installation registers each host catalog and digest follows report changes", () => {
  H.propertyCardCabinetProvidersResetForTests();
  const releases = [];
  let notebookCount = 1;
  const plugin = {
    app: {},
    homeCardSourceCache: new Map([["Areas/work.md", REGION]]),
    homeCardCardModelFor: () => ({ kind: "area" }),
    notebookCatalogState: () => ({ report: {
      catalogsByHostPath: new Map([["Areas/work.md", { state: "current", notebooks: notebookCount }]]),
    } }),
    notebookCatalogPaintOptions: () => ({ handlers: { sync() {}, retry() {} } }),
    apiNotebookSubscribe(callback) { releases.push(callback); return () => {}; },
    registerDomEvent() {},
  };
  assert.equal(H.propertyCardCabinetHostInstall(plugin), true);
  assert.deepEqual(H.PROPERTY_CARD_HOST_CATALOG_KINDS.map((kind) => H.propertyCardCabinetProviderFor(kind) != null), [true, true, true, true]);
  const before = H.propertyCardCabinetHostDigest(plugin, "Areas/work.md", REGION);
  notebookCount = 2;
  const after = H.propertyCardCabinetHostDigest(plugin, "Areas/work.md", REGION);
  assert.notEqual(before, after);
  assert.equal(H.propertyCardCabinetHostPaintKey(plugin, "notebooks", "Areas/work.md"),
    H.propertyCardCabinetHostDigest(plugin, "Areas/work.md", REGION));
  H.propertyCardCabinetProvidersReleasePlugin(plugin);
  H.propertyCardCabinetProvidersResetForTests();
});
