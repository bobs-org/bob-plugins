// Links stage render path (`plan 202610/links_stage_blocked_ranking.md`,
// decision `blocked_ties = peer`). `getFilteredItems()` must render through
// the relation planner, never the Depends-on planner's BLOCKED section.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal {
      constructor(app) {
        this.app = app;
        this.contentEl = { empty: () => {} };
        this.modalEl = { removeClass: () => {} };
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: class {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

function snapshotMap(notes) {
  return helpers.createDependencySnapshotMap(
    Object.entries(notes).map(([path, content]) => ({ path, content })),
  );
}

function buildRelationVaultStage(notes, ownerPath, parentLines, direction = "to") {
  const snapshots = snapshotMap(notes);
  const index = helpers.indexDependencyStageNotesFromSnapshots(snapshots);
  const ownerContent = String(notes[ownerPath] || "");
  const currentRows = [];
  const linkedKeys = new Set();
  for (const parentLine of parentLines) {
    const resolved = helpers.resolveRelationStageCurrent(
      ownerContent,
      parentLine,
      ownerPath,
      index,
      snapshots.get(ownerPath) || null,
    );
    assert.equal(resolved.ok, true);
    for (const row of resolved.rows) {
      const key =
        row.path && row.blockId
          ? helpers.relationStageRowKey(row.path, row.blockId)
          : `missing:${row.path}#^${row.blockId}`;
      if (row.path && row.blockId) linkedKeys.add(key);
      currentRows.push(row);
    }
  }
  const candidates = helpers.collectVaultRelationCandidatesFromSnapshots(
    snapshots,
    { dependentPath: ownerPath, dependentLines: new Set(parentLines) },
  );
  const raw = {
    direction,
    candidates,
    current: currentRows,
    linkedKeys,
    files: new Map(Object.entries(notes)),
    index,
    cacheReady: true,
    prerequisiteIds: new Set(),
    todayMap: new Map(),
    dependent: { path: ownerPath, line: parentLines[0] },
    sources: [
      {
        path: ownerPath,
        line: parentLines[0],
        blockId: null,
        displayText: "owner",
        text: "owner",
      },
    ],
    parentLines,
    poolSize: candidates.length,
    refreshOf: null,
  };
  const decorated = helpers.decorateRelationVaultStage(raw);
  if (direction === "from") {
    return { ...decorated, direction: "from", current: [], linkedKeys: new Set(), previousDailyPath: "" };
  }
  return decorated;
}

function makeRenderPicker(vaultStage, query, flags = {}) {
  const picker = Object.create(helpers.BulletPropertyPickerModal.prototype);
  picker.stage = "value";
  picker.selectedPropertyItem = {
    property: { name: flags.propertyName || "linksTo", values: "local_task_id" },
  };
  picker.blocksStage = flags.blocksStage === true;
  picker.relationStage = flags.relationStage === true;
  picker.vaultStage = vaultStage;
  picker.inputEl = { value: query };
  picker.markedLines = new Set();
  picker.taskItemsByLine = new Map();
  return picker;
}

function resultsRows(items) {
  return items.filter((item) => item && item.stageSection === "results");
}

test("score wins over status; no blocked section", () => {
  const notes = {
    "Current.md": "- [ ] #task Owner task ^owner",
    "Other.md": "- [?] #task widget maker ^blk\n- [ ] #task small thing mentions widget here ^rdy",
  };
  const stage = buildRelationVaultStage(notes, "Current.md", [0], "to");
  const picker = makeRenderPicker(stage, "widget", { relationStage: true });
  const rendered = picker.getFilteredItems();
  assert.ok(rendered.length > 0);
  assert.ok(rendered.every((row) => row.stageSection !== "blocked"));
  const first = resultsRows(rendered)[0];
  assert.ok(first, "expected a RESULTS row");
  assert.equal(first.blockId, "blk");
  assert.equal(first.status, "?");
});

test("blocked rows are not hidden behind the cap", () => {
  const lines = ["- [?] #task widget champion ^blk"];
  for (let i = 0; i < 70; i += 1) {
    lines.push(`- [ ] #task filler task number ${i} widget tail ^r${i}`);
  }
  const notes = {
    "Current.md": "- [ ] #task Owner task ^owner",
    "Other.md": lines.join("\n"),
  };
  const stage = buildRelationVaultStage(notes, "Current.md", [0], "to");
  const picker = makeRenderPicker(stage, "widget champion", { relationStage: true });
  const rendered = picker.getFilteredItems();
  const found = rendered.filter((row) => row && row.blockId === "blk");
  assert.equal(found.length, 1);
  assert.equal(found[0].stageSection, "results");
});

test("render matches the relation planner in both directions", () => {
  const notes = {
    "Current.md": "- [ ] #task Owner task ^owner",
    "Other.md": "- [?] #task widget maker ^blk\n- [ ] #task widget helper ^rdy\n- [x] #task widget done ^done",
  };
  for (const direction of ["to", "from"]) {
    const stage = buildRelationVaultStage(notes, "Current.md", [0], direction);
    for (const query of ["", "widget"]) {
      const picker = makeRenderPicker(stage, query, { relationStage: true });
      const rendered = picker.getFilteredItems();
      const planned = helpers.planRelationStageItemsFromVault(stage, query);
      assert.deepEqual(rendered, planned, `direction=${direction} query=${JSON.stringify(query)}`);
    }
    const picker = makeRenderPicker(stage, "", { relationStage: true });
    const rendered = picker.getFilteredItems();
    if (direction === "to") {
      const closed = rendered.filter((row) => row && row.stageSection === "closed");
      const results = resultsRows(rendered);
      assert.ok(results.every((row) => row.closed !== true && row.archived !== true));
      assert.ok(closed.every((row) => row.closed === true || row.archived === true));
    } else {
      assert.ok(rendered.every((row) => row.archived !== true));
      assert.ok(rendered.every((row) => !row || row.stageSection !== "closed"));
    }
  }
});

test("other stages still use their own planners", () => {
  const snapshots = snapshotMap({
    "Current.md": "- [ ] #task Owner task ^owner",
    "Other.md": "- [?] widget maker ^blk\n- [ ] widget helper ^rdy",
  });
  const index = helpers.indexDependencyStageNotesFromSnapshots(snapshots);
  const candidates = [
    {
      path: "Other.md",
      route: "Other",
      note: "Other",
      line: 0,
      rawLine: "- [?] widget maker ^blk",
      status: "?",
      displayText: "widget maker",
      text: "widget maker",
      blockId: "blk",
      section: null,
      open: true,
      closed: false,
      archived: false,
      blocked: true,
      hidden: false,
    },
    {
      path: "Other.md",
      route: "Other",
      note: "Other",
      line: 1,
      rawLine: "- [ ] widget helper ^rdy",
      status: " ",
      displayText: "widget helper",
      text: "widget helper",
      blockId: "rdy",
      section: null,
      open: true,
      closed: false,
      archived: false,
      blocked: false,
      hidden: false,
    },
  ];
  const vaultStage = {
    current: [],
    candidates,
    dependent: { path: "Current.md", line: 0, key: "Current.md\x00owner", displayText: "Owner" },
    edges: new Map(),
    linkedKeys: new Set(),
    sourceValueSets: null,
    index,
  };
  const picker = makeRenderPicker(vaultStage, "widget", {});
  const rendered = picker.getFilteredItems();
  const expected = helpers.planDependencyStageView({
    current: vaultStage.current,
    candidates: vaultStage.candidates,
    query: "widget",
    dependent: vaultStage.dependent,
    edges: vaultStage.edges,
    linkedKeys: vaultStage.linkedKeys,
    sourceValueSets: vaultStage.sourceValueSets,
  });
  assert.deepEqual(rendered, expected);
  assert.ok(rendered.some((row) => row && row.stageSection === "blocked"));

  const blocksStage = {
    sources: [{ path: "Current.md", line: 0, displayText: "Owner" }],
    current: [],
    candidates,
    edges: new Map(),
    files: new Map(),
    todayLinks: [],
  };
  const blocksPicker = makeRenderPicker(blocksStage, "widget", { blocksStage: true });
  const blocksRendered = blocksPicker.getFilteredItems();
  assert.deepEqual(blocksRendered, helpers.planBlocksStageItemsFromVault(blocksStage, "widget"));
});

test("peer tie order: In Progress, Next, then Ready and Blocked together", () => {
  const ownerPath = "Current.md";
  const mk = (path, line, status, blockId) => ({
    path,
    line,
    status,
    blockId,
    displayText: `task ${blockId}`,
    text: `task ${blockId}`,
    hidden: false,
    archived: false,
    closed: false,
    open: true,
  });
  const inProgress = mk("B.md", 0, "/", "prog");
  const next = mk("B.md", 1, "*", "next");
  const readyLate = mk("B.md", 2, " ", "rdy");
  const blockedEarly = mk("A.md", 0, "?", "blk");
  const order = [readyLate, blockedEarly, next, inProgress]
    .slice()
    .sort((a, b) => helpers.compareRelationStageCanonical(a, b, ownerPath))
    .map((row) => row.blockId);
  assert.deepEqual(order, ["prog", "next", "blk", "rdy"]);

  // The shared Depends-on order is unchanged: Ready still precedes Blocked.
  const shared = helpers.compareDependencyStageCanonical(blockedEarly, readyLate, ownerPath);
  assert.ok(shared > 0);
});
