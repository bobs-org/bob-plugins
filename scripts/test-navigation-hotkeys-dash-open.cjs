const assert = require("node:assert/strict");
const test = require("node:test");
const { NavigationHotkeysPlugin, notices } = require("./navigation-hotkeys-harness.cjs");

function makeDashHarness(options = {}) {
  const dashFile = { path: "dash.md", extension: "md" };
  const leftSplit = {};
  const rightSplit = {};
  const rootSplit = {};
  const openCalls = [];
  const revealLeafCalls = [];
  const setActiveLeafCalls = [];
  const leaves = [];

  const makeLeaf = (file, leafOptions = {}) => {
    const view = leafOptions.deferred ? { file: null, editor: null } : { file, editor: {} };
    view.getViewType = function getViewType() {
      return this.file && this.file.extension === "md" ? "markdown" : "empty";
    };
    const leaf = {
      view,
      pinned: Boolean(leafOptions.pinned),
      isDeferred: Boolean(leafOptions.deferred),
      savedViewState: {
        type: leafOptions.savedType || (file ? "markdown" : "empty"),
        state: { file: leafOptions.savedPath || (file && file.path) || null },
        pinned: Boolean(leafOptions.savedPinned),
      },
      getRoot() {
        return leafOptions.sidebar ? leftSplit : rootSplit;
      },
      getViewState() {
        return this.savedViewState;
      },
      async loadIfDeferred() {
        this.loadIfDeferredCalls += 1;
        if (this.isDeferred) {
          this.isDeferred = false;
          this.view.file = file;
          this.view.editor = file && file.extension === "md" ? {} : null;
        }
      },
      loadIfDeferredCalls: 0,
    };
    leaves.push(leaf);
    return leaf;
  };

  const activeLeaf = options.activeLeaf || makeLeaf(options.activeFile || { path: "Work.md", extension: "md" });
  if (!leaves.includes(activeLeaf)) leaves.push(activeLeaf);
  const workspace = {
    leftSplit,
    rightSplit,
    rootSplit,
    activeLeaf,
    iterateAllLeaves(callback) {
      leaves.forEach(callback);
    },
    async revealLeaf(leaf) {
      revealLeafCalls.push(leaf);
      if (leaf.isDeferred) await leaf.loadIfDeferred();
    },
    setActiveLeaf(leaf, leafOptions) {
      setActiveLeafCalls.push({ leaf, options: leafOptions });
      this.activeLeaf = leaf;
    },
    getLeaf(reuse) {
      assert.equal(reuse, false);
      return {
        openFile: async (file) => {
          openCalls.push(file);
          const leaf = this.activeLeaf;
          leaf.isDeferred = false;
          leaf.view = { file, editor: {} };
        },
      };
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace,
    vault: { getAbstractFileByPath: (path) => (path === dashFile.path ? dashFile : null) },
  };
  plugin.isMarkdownFile = (file) => Boolean(file && file.extension === "md");
  plugin.getActiveMarkdownView = () => {
    const view = workspace.activeLeaf && workspace.activeLeaf.view;
    return view && view.file && view.file.extension === "md" ? view : null;
  };
  plugin.captureActiveFilePositionCalls = 0;
  plugin.captureActiveFilePosition = () => {
    plugin.captureActiveFilePositionCalls += 1;
  };
  plugin.getRememberedDashLocation = () => options.rememberedLocation || null;
  plugin.cancelPendingDashTasksJump = () => {};
  plugin.cancelPendingDashLocationRestore = () => {};
  plugin.refreshDashScrollCaptureTarget = () => {};
  plugin.captureDashLocationFromView = () => {};
  plugin.restoreCalls = [];
  plugin.restoreOrDeferDashLocation = (location) => plugin.restoreCalls.push(location);
  plugin.jumpCalls = 0;
  plugin.jumpOrDeferDashTasks = () => {
    plugin.jumpCalls += 1;
  };

  return {
    activeLeaf,
    dashFile,
    leaves,
    makeLeaf,
    openCalls,
    plugin,
    revealLeafCalls,
    setActiveLeafCalls,
    workspace,
  };
}

test("Ctrl+0 loads and focuses a deferred pinned dash tab without jumping or restoring", async () => {
  const harness = makeDashHarness();
  const dashLeaf = harness.makeLeaf(harness.dashFile, { deferred: true, pinned: true });

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, dashLeaf);
  assert.equal(dashLeaf.isDeferred, false);
  assert.equal(dashLeaf.loadIfDeferredCalls, 1);
  assert.deepEqual(harness.openCalls, []);
  assert.deepEqual(harness.revealLeafCalls, [dashLeaf]);
  assert.deepEqual(harness.setActiveLeafCalls, [{ leaf: dashLeaf, options: { focus: true } }]);
  assert.equal(harness.plugin.jumpCalls, 0);
  assert.deepEqual(harness.plugin.restoreCalls, []);
});

test("Ctrl+0 from an unpinned dash copy switches to the pinned home tab", async () => {
  const harness = makeDashHarness({
    activeFile: { path: "dash.md", extension: "md" },
  });
  const homeLeaf = harness.makeLeaf(harness.dashFile, {
    deferred: true,
    pinned: true,
  });

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, homeLeaf);
  assert.equal(homeLeaf.isDeferred, false);
  assert.equal(homeLeaf.loadIfDeferredCalls, 1);
  assert.deepEqual(harness.openCalls, []);
  assert.deepEqual(harness.revealLeafCalls, [homeLeaf]);
  assert.deepEqual(harness.setActiveLeafCalls, [
    { leaf: homeLeaf, options: { focus: true } },
  ]);
  assert.equal(harness.plugin.jumpCalls, 0);
  assert.deepEqual(harness.plugin.restoreCalls, []);
});

test("Ctrl+0 stays on the pinned dash tab when an unpinned copy exists", async () => {
  const harness = makeDashHarness({
    activeFile: { path: "dash.md", extension: "md" },
  });
  const activeLeaf = harness.workspace.activeLeaf;
  activeLeaf.pinned = true;
  const copyLeaf = harness.makeLeaf(harness.dashFile);

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, activeLeaf);
  assert.notEqual(harness.workspace.activeLeaf, copyLeaf);
  assert.deepEqual(harness.openCalls, []);
  assert.deepEqual(harness.revealLeafCalls, []);
  assert.equal(harness.plugin.jumpCalls, 0);
});

test("Ctrl+0 keeps the active dash tab when equal-ranked copies exist", async () => {
  const harness = makeDashHarness({
    activeFile: { path: "dash.md", extension: "md" },
  });
  const activeLeaf = harness.workspace.activeLeaf;
  const earlierLeaf = harness.makeLeaf(harness.dashFile);

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, activeLeaf);
  assert.notEqual(harness.workspace.activeLeaf, earlierLeaf);
  assert.deepEqual(harness.openCalls, []);
  assert.deepEqual(harness.revealLeafCalls, []);
});

test("a pinned dash tab wins over an earlier unpinned tab", async () => {
  const harness = makeDashHarness();
  const unpinnedLeaf = harness.makeLeaf(harness.dashFile);
  const pinnedLeaf = harness.makeLeaf(harness.dashFile, { pinned: true });

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, pinnedLeaf);
  assert.notEqual(harness.workspace.activeLeaf, unpinnedLeaf);
  assert.deepEqual(harness.openCalls, []);
  assert.equal(harness.plugin.jumpCalls, 0);
});

test("a main-area dash tab wins over a pinned sidebar tab", async () => {
  const harness = makeDashHarness();
  const sidebarLeaf = harness.makeLeaf(harness.dashFile, {
    deferred: true,
    pinned: true,
    sidebar: true,
  });
  const mainLeaf = harness.makeLeaf(harness.dashFile);

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, mainLeaf);
  assert.equal(sidebarLeaf.isDeferred, true);
  assert.equal(sidebarLeaf.loadIfDeferredCalls, 0);
});

test("a deferred sidebar dash tab is reused when there is no main-area match", async () => {
  const harness = makeDashHarness();
  const sidebarLeaf = harness.makeLeaf(harness.dashFile, {
    deferred: true,
    sidebar: true,
  });

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, sidebarLeaf);
  assert.equal(sidebarLeaf.isDeferred, false);
  assert.equal(sidebarLeaf.loadIfDeferredCalls, 1);
  assert.deepEqual(harness.openCalls, []);
  assert.equal(harness.plugin.jumpCalls, 0);
});

test("a markdown saved state is considered even when the leaf is not deferred", async () => {
  const harness = makeDashHarness();
  const stateOnlyLeaf = harness.makeLeaf(harness.dashFile, { deferred: true });
  stateOnlyLeaf.isDeferred = false;

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, stateOnlyLeaf);
  assert.equal(stateOnlyLeaf.loadIfDeferredCalls, 0);
  assert.deepEqual(harness.openCalls, []);
  assert.equal(harness.plugin.jumpCalls, 0);
});

test("Ctrl+0 opens dash in the current tab when no matching tab exists", async () => {
  const harness = makeDashHarness();

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.deepEqual(harness.openCalls, [harness.dashFile]);
  assert.equal(harness.workspace.activeLeaf.view.file, harness.dashFile);
  assert.equal(harness.plugin.jumpCalls, 1);
  assert.deepEqual(harness.plugin.restoreCalls, []);
});

test("Ctrl+0 leaves an already active dash tab alone", async () => {
  const harness = makeDashHarness({ activeFile: { path: "dash.md", extension: "md" } });
  const activeLeaf = harness.workspace.activeLeaf;

  assert.equal(await harness.plugin.openDashTasks(), true);
  assert.equal(harness.workspace.activeLeaf, activeLeaf);
  assert.deepEqual(harness.openCalls, []);
  assert.deepEqual(harness.revealLeafCalls, []);
  assert.equal(harness.plugin.jumpCalls, 0);
  assert.deepEqual(harness.plugin.restoreCalls, []);
});
