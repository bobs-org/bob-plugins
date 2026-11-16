const test = require("node:test");
const assert = require("node:assert/strict");
const { NavigationHotkeysPlugin, helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  inspectWindowPrefixLayoutApis,
  planWindowPrefixKey,
  readWindowPrefixHotkeyEntries,
} = helpers;

function leaf(id, options = {}) {
  const scrollDOM = { scrollTop: options.scrollTop ?? 0, scrollLeft: options.scrollLeft ?? 0 };
  const value = {
    id,
    pinned: options.pinned === true,
    view: {
      file: { path: `${id}.md`, basename: id },
      editor: { cm: { scrollDOM } },
      getViewType: () => "markdown",
    },
    getDisplayText: () => id,
    parent: null,
    detach() {
      const parent = this.parent;
      if (parent?.children?.includes(this)) parent.removeChild(this);
    },
  };
  if (Object.hasOwn(options, "file")) value.view.file = options.file;
  return value;
}

function makeWorkspace(groups, options = {}) {
  const rootSplit = {
    children: [],
    reflow() {
      this.children.forEach((child, index) => {
        if (child.containerEl) child.left = index * 100;
      });
    },
    insertChild(index, child) {
      const at = Math.max(0, Math.min(index, this.children.length));
      this.children.splice(at, 0, child);
      child.parent = this;
      this.reflow();
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index < 0) return;
      this.children.splice(index, 1);
      child.parent = null;
      this.reflow();
    },
    recomputeChildrenDimensions() { this.reflow(); },
  };
  function makeGroup(id, left, leaves, selected = leaves[0]) {
    const group = {
      id,
      children: [],
      parent: null,
      selectedTab: null,
      mostRecentLeaf: null,
      containerEl: {
        getBoundingClientRect: () => ({
          left: group.left, top: 0, right: group.left + 100, bottom: 100, width: 100, height: 100,
        }),
      },
      insertChild(index, child) {
        const at = Math.max(0, Math.min(index, this.children.length));
        this.children.splice(at, 0, child);
        child.parent = this;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index < 0) return;
        this.children.splice(index, 1);
        child.parent = null;
        if (this.selectedTab === child) this.selectedTab = this.children[0] ?? null;
        this.currentTab = this.children.indexOf(this.selectedTab);
        if (this.children.length === 0 && this.parent?.children?.includes(this)) {
          this.parent.removeChild(this);
        }
      },
      selectTab(child) {
        if (!this.children.includes(child)) throw new Error("selected tab is not a child");
        this.selectedTab = child;
        this.currentTab = this.children.indexOf(child);
        child.view?.editor?.cm?.scrollDOM && (child.view.editor.cm.scrollDOM.scrollTop = 0);
      },
      recomputeChildrenDimensions() {},
    };
    for (const child of leaves) group.insertChild(group.children.length, child);
    group.selectedTab = selected;
    group.currentTab = group.children.indexOf(selected);
    group.mostRecentLeaf = selected;
    rootSplit.insertChild(rootSplit.children.length, group);
    return group;
  }
  const workspace = {
    rootSplit,
    activeLeaf: options.activeLeaf ?? null,
    layoutChanges: 0,
    saves: 0,
    setActiveLeaf(target) { this.activeLeaf = target; },
    iterateRootLeaves(callback) {
      for (const group of this.rootSplit.children) {
        for (const child of group.children) callback(child);
      }
      for (const child of options.extraLeaves ?? []) callback(child);
    },
    getMostRecentLeaf(group) {
      return group.children.includes(group.mostRecentLeaf)
        ? group.mostRecentLeaf
        : group.children[0] ?? null;
    },
    onLayoutChange() { this.layoutChanges += 1; },
    requestSaveLayout() { this.saves += 1; },
    createLeafBySplit(source, _direction, before) {
      const sourceGroup = source.parent;
      const placeholder = leaf(`placeholder-${Math.random()}`);
      const group = makeGroup("created", sourceGroup.containerEl.getBoundingClientRect().left + (before ? -100 : 100), [placeholder]);
      const index = rootSplit.children.indexOf(sourceGroup);
      rootSplit.removeChild(group);
      // The observed Obsidian implementation places this split on the right
      // regardless of the `before` argument; the adapter must enforce left.
      rootSplit.insertChild(index + 1, group);
      return placeholder;
    },
    duplicateLeaf(source) {
      const copy = leaf(`copy-${source.id}`, { file: source.view.file });
      const left = source.parent.containerEl.getBoundingClientRect().left + 100;
      makeGroup("duplicate", left, [copy]);
      this.activeLeaf = copy;
      return copy;
    },
  };
  for (const group of groups) makeGroup(group.id, group.left, group.leaves, group.selected);
  workspace.activeLeaf ??= groups[0]?.selected ?? groups[0]?.leaves?.[0] ?? null;
  return { workspace, rootSplit, groups: rootSplit.children };
}

function pluginFor(workspace) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = { workspace };
  plugin.initializeWindowPrefixLayoutAdapter();
  return plugin;
}

function getPlan(plugin, key) {
  const snapshot = plugin.snapshotWindowPrefixLayout();
  return { snapshot, plan: planWindowPrefixKey(snapshot, key) };
}

test("live snapshot groups root leaves and reports selected tabs, pins, geometry, and API canary", () => {
  const a = leaf("A", { pinned: true });
  const b = leaf("B");
  const c = leaf("C");
  const outside = leaf("sidebar");
  const outsideGroup = { children: [outside], parent: null };
  outside.parent = outsideGroup;
  const { workspace } = makeWorkspace([
    { id: "right", left: 100, leaves: [c], selected: c },
    { id: "left", left: 0, leaves: [a, b], selected: b },
  ], { activeLeaf: b, extraLeaves: [outside] });
  const plugin = pluginFor(workspace);
  const snapshot = plugin.snapshotWindowPrefixLayout();
  assert.equal(snapshot.activeLeafId, plugin.getWindowPrefixObjectId("leaf", b));
  assert.deepEqual(snapshot.splits.map((split) => split.leaves.map((item) => item.label)), [
    ["C"], ["A", "B"],
  ]);
  assert.equal(snapshot.splits[1].selectedLeafId, snapshot.activeLeafId);
  assert.equal(snapshot.splits[1].leaves[0].pinned, true);
  assert.equal(snapshot.capabilities.move, true);
  assert.equal(plugin.windowPrefixLeafById.has("sidebar"), false);
  assert.equal(inspectWindowPrefixLayoutApis(workspace, b, workspace.rootSplit.children).capabilities.createSplit, true);
});

test("main-area snapshot survives sidebar focus and leaves the prefix object maps untouched", () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const outside = leaf("sidebar");
  const outsideGroup = { children: [outside], parent: null };
  outside.parent = outsideGroup;
  const { workspace } = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: outside, extraLeaves: [outside] });
  const plugin = pluginFor(workspace);
  const leafMapBefore = [...plugin.windowPrefixLeafById.entries()];
  const splitMapBefore = [...plugin.windowPrefixSplitById.entries()];
  const area = plugin.snapshotWindowPrefixMainArea();
  assert.ok(area);
  assert.equal(area.activeLeafId, null);
  assert.equal(area.splits.length, 2);
  assert.equal(plugin.snapshotWindowPrefixLayout(), null);
  assert.deepEqual([...plugin.windowPrefixLeafById.entries()], leafMapBefore);
  assert.deepEqual([...plugin.windowPrefixSplitById.entries()], splitMapBefore);
  assert.equal(area.leafById.has("sidebar"), false);
  assert.equal(area.splitById.size, 2);
});

test("main-area snapshot uses WorkspaceTabs children order when iteration order differs", () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "only", left: 0, leaves: [a, b], selected: a },
  ], { activeLeaf: a });
  workspace.iterateRootLeaves = (callback) => {
    callback(b);
    callback(a);
  };
  const plugin = pluginFor(workspace);
  const area = plugin.snapshotWindowPrefixMainArea();
  assert.deepEqual(area.splits[0].leaves.map((item) => item.label), ["A", "B"]);
});

test("numeric WorkspaceTabs currentTab resolves the selected leaf before legacy fallbacks", () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "only", left: 0, leaves: [a, b], selected: a },
  ], { activeLeaf: b });
  const group = workspace.rootSplit.children[0];
  group.currentTab = 1;
  group.selectedTab = a;
  group.mostRecentLeaf = a;
  const plugin = pluginFor(workspace);
  const area = plugin.snapshotWindowPrefixMainArea();
  const selectedId = area.splits[0].selectedLeafId;
  assert.equal(area.leafById.get(selectedId), b);
});

test("hotkey reader preserves custom empty overrides, reads defaults, and fails closed when unavailable", () => {
  const app = {
    commands: { commands: { disabled: {}, defaulted: {} } },
    hotkeyManager: {
      customKeys: { disabled: [] },
      defaultKeys: {
        disabled: [{ modifiers: ["Ctrl"], key: "W" }],
        defaulted: [{ modifiers: ["Mod"], key: "W" }],
      },
      getHotkeys: () => [],
    },
  };
  assert.deepEqual(readWindowPrefixHotkeyEntries(app), {
    known: true,
    entries: [{ commandId: "defaulted", modifiers: ["Mod"], key: "W" }],
  });
  assert.deepEqual(readWindowPrefixHotkeyEntries({ commands: { commands: {} } }), {
    known: false,
    entries: [],
  });
});

test("the layout API canary disables move plans when a required internal disappears", () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "left", left: 0, leaves: [a], selected: a },
    { id: "right", left: 100, leaves: [b], selected: b },
  ], { activeLeaf: b });
  workspace.requestSaveLayout = undefined;
  const plugin = pluginFor(workspace);
  const { snapshot, plan } = getPlan(plugin, "H");
  assert.equal(snapshot.capabilities.move, false);
  assert.equal(plan.available, false);
  assert.equal(plan.reason, "layout-api-changed");
  assert.match(plan.preview, /Obsidian layout API changed/);
});

test("the layout API canary disables left split creation without dimension recomputation", () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
  ], { activeLeaf: b });
  workspace.rootSplit.recomputeChildrenDimensions = undefined;
  const plugin = pluginFor(workspace);
  const { snapshot, plan } = getPlan(plugin, "H");
  assert.equal(snapshot.capabilities.createSplitLeft, false);
  assert.equal(plan.available, false);
  assert.equal(plan.reason, "layout-api-changed");
  assert.equal(getPlan(plugin, "L").plan.action, "create-split");
});

test("focus executes against a fresh layout and rejects a stale armed source", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "left", left: 0, leaves: [a], selected: a },
    { id: "right", left: 100, leaves: [b], selected: b },
  ], { activeLeaf: a });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "l");
  const result = await plugin.executeWindowPrefixPlan(plan, {
    activeLeafId: plan.sourceLeafId,
    sourceSplitId: plan.sourceSplitId,
  });
  assert.equal(result.ok, true);
  assert.equal(workspace.activeLeaf, b);
  assert.equal(workspace.saves, 0);

  const stale = await plugin.executeWindowPrefixPlan(plan, {
    activeLeafId: plan.sourceLeafId,
    sourceSplitId: plan.sourceSplitId,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "layout-changed");
});

test("join moves the same tab, preserves pinning and insertion order, and selects the live source remainder", async () => {
  const a = leaf("A");
  const b = leaf("B", { pinned: true });
  const c = leaf("C", { pinned: true });
  const d = leaf("D");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
    { id: "target", left: 100, leaves: [c, d], selected: d },
  ], { activeLeaf: b });
  workspace.rootSplit.children[0].mostRecentLeaf = a;
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.deepEqual(workspace.rootSplit.children.map((group) => group.children.map((item) => item.id)), [
    ["A"], ["C", "B", "D"],
  ]);
  assert.equal(b.parent, workspace.rootSplit.children[1]);
  assert.equal(b.pinned, true);
  assert.equal(workspace.rootSplit.children[0].selectedTab, a);
  assert.equal(workspace.activeLeaf, b);
  assert.equal(workspace.saves, 1);
});

test("a last-tab join collapses its source split", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a], selected: a },
    { id: "target", left: 100, leaves: [b], selected: b },
  ], { activeLeaf: a });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.sourceCollapsed, true);
  assert.equal(workspace.rootSplit.children.length, 1);
  assert.deepEqual(workspace.rootSplit.children[0].children, [b, a]);
  assert.equal(workspace.activeLeaf, a);
});

test("an edge move creates a split, detaches only its placeholder, and keeps the moved leaf live", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
  ], { activeLeaf: b });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  assert.equal(plan.action, "create-split");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(workspace.rootSplit.children.length, 2);
  assert.deepEqual(workspace.rootSplit.children[0].children, [a]);
  assert.deepEqual(workspace.rootSplit.children[1].children, [b]);
  assert.equal(workspace.activeLeaf, b);
});

test("an edge move creates a real left split even when Obsidian inserts it on the right", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
  ], { activeLeaf: b });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "H");
  assert.equal(plan.action, "create-split");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.deepEqual(workspace.rootSplit.children.map((group) => group.children), [[b], [a]]);
  assert.ok(
    workspace.rootSplit.children[0].containerEl.getBoundingClientRect().left <
      workspace.rootSplit.children[1].containerEl.getBoundingClientRect().left,
  );
});

test("move restores the moved editor's scroll position after selecting and focusing it", async () => {
  const a = leaf("A");
  const b = leaf("B", { scrollTop: 735, scrollLeft: 12 });
  const c = leaf("C");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
    { id: "target", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(b.view.editor.cm.scrollDOM.scrollTop, 735);
  assert.equal(b.view.editor.cm.scrollDOM.scrollLeft, 12);
});

test("duplicate creates a same-note leaf in a new split and focuses it", async () => {
  const a = leaf("A");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a], selected: a },
  ], { activeLeaf: a });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "v");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(workspace.rootSplit.children.length, 2);
  assert.equal(workspace.activeLeaf, result.targetLeaf);
  assert.notEqual(result.targetLeaf, a);
  assert.equal(result.targetLeaf.view.file.path, a.view.file.path);
});

test("duplicate supports an empty leaf with no file", async () => {
  const empty = leaf("Empty", { file: null });
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [empty], selected: empty },
  ], { activeLeaf: empty });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "v");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.targetLeaf.view.file, null);
});

test("join succeeds when selectedTab tracks only the workspace active leaf", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
    { id: "target", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  for (const group of workspace.rootSplit.children) {
    Object.defineProperty(group, "selectedTab", {
      configurable: true,
      get() {
        return workspace.activeLeaf && this.children.includes(workspace.activeLeaf)
          ? workspace.activeLeaf
          : undefined;
      },
      set() { /* live WorkspaceTabs selection follows the active leaf */ },
    });
  }
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(workspace.rootSplit.children.map((group) => group.children.map((item) => item.id)), [
    ["A"], ["C", "B"],
  ]);
  assert.equal(workspace.activeLeaf, b);
});

test("a failed move restores the source layout and reports the failure", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
    { id: "target", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  const [source, target] = workspace.rootSplit.children;
  const selectTarget = target.selectTab;
  target.selectTab = function (candidate) {
    if (candidate === b) throw new Error("synthetic selection failure");
    return selectTarget.call(this, candidate);
  };
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "execution-failed");
  assert.equal(result.restored, true);
  assert.deepEqual(workspace.rootSplit.children, [source, target]);
  assert.deepEqual(source.children, [a, b]);
  assert.deepEqual(target.children, [c]);
  assert.equal(workspace.activeLeaf, b);
});

test("a failed join rollback reselects the destination's previous tab via currentTab", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const d = leaf("D");
  const { workspace } = makeWorkspace([
    { id: "source", left: 0, leaves: [a, b], selected: b },
    { id: "target", left: 100, leaves: [c, d], selected: d },
  ], { activeLeaf: b });
  const [source, target] = workspace.rootSplit.children;
  Object.defineProperty(target, "selectedTab", {
    configurable: true,
    get() { return undefined; },
    set() { /* 1.15.1 WorkspaceTabs.selectedTab is undefined */ },
  });
  target.currentTab = 1;
  const selectTarget = target.selectTab;
  let reselected = null;
  target.selectTab = function (candidate) {
    if (candidate === b) throw new Error("synthetic selection failure");
    reselected = candidate;
    this.currentTab = this.children.indexOf(candidate);
    return selectTarget.call(this, candidate);
  };
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.restored, true);
  assert.deepEqual(source.children, [a, b]);
  assert.deepEqual(target.children, [c, d]);
  assert.equal(reselected, d);
  assert.equal(target.currentTab, 1);
  assert.equal(workspace.activeLeaf, b);
});

function makeWorkspaceNoAutoCollapse(groups, options = {}) {
  const built = makeWorkspace(groups, options);
  for (const group of built.workspace.rootSplit.children) {
    const originalRemove = group.removeChild;
    group.removeChild = function (child) {
      const index = this.children.indexOf(child);
      if (index < 0) return;
      this.children.splice(index, 1);
      child.parent = null;
      if (this.selectedTab === child) this.selectedTab = this.children[0] ?? null;
    };
    group.__wpOriginalRemove = originalRemove;
  }
  const originalMakeGroupCreate = built.workspace.createLeafBySplit;
  return built;
}

test("an emptied split without auto-collapse is collapsed explicitly (last-tab join)", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspaceNoAutoCollapse([
    { id: "source", left: 0, leaves: [a], selected: a },
    { id: "target", left: 100, leaves: [b], selected: b },
  ], { activeLeaf: a });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  assert.equal(plan.sourceCollapsed, true);
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.sourceCollapsed, true);
  assert.equal(workspace.rootSplit.children.length, 1);
  assert.ok(!workspace.rootSplit.children.includes(workspace.rootSplit.children.find((g) => g.children.length === 0)));
  for (const group of workspace.rootSplit.children) {
    assert.ok(group.children.length > 0);
  }
  assert.deepEqual(workspace.rootSplit.children[0].children, [b, a]);
  assert.equal(workspace.activeLeaf, a);
});

test("an emptied middle split without auto-collapse is collapsed explicitly (middle-out)", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const { workspace } = makeWorkspaceNoAutoCollapse([
    { id: "left", left: 0, leaves: [a], selected: a },
    { id: "middle", left: 100, leaves: [b], selected: b },
    { id: "right", left: 200, leaves: [c], selected: c },
  ], { activeLeaf: b });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "H");
  assert.equal(plan.sourceCollapsed, true);
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.sourceCollapsed, true);
  assert.equal(workspace.rootSplit.children.length, 2);
  for (const group of workspace.rootSplit.children) {
    assert.ok(group.children.length > 0);
  }
  assert.deepEqual(workspace.rootSplit.children.map((group) => group.children.map((item) => item.id)), [
    ["A", "B"], ["C"],
  ]);
});

test("explicit collapse failure rolls back to the original split and index", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const { workspace } = makeWorkspaceNoAutoCollapse([
    { id: "source", left: 0, leaves: [a], selected: a },
    { id: "target", left: 100, leaves: [b], selected: b },
  ], { activeLeaf: a });
  const [source, target] = workspace.rootSplit.children;
  const originalParentRemove = workspace.rootSplit.removeChild;
  workspace.rootSplit.removeChild = function () { throw new Error("synthetic parent collapse failure"); };
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "L");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.restored, true);
  workspace.rootSplit.removeChild = originalParentRemove;
  assert.deepEqual(workspace.rootSplit.children, [source, target]);
  assert.deepEqual(source.children, [a]);
  assert.deepEqual(target.children, [b]);
  assert.equal(workspace.activeLeaf, a);
});
