const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const { planWindowPrefixKey, buildWindowPrefixTabCatalog, windowPrefixFocusTabFailureMessage } = helpers;

function leaf(id, options = {}) {
  const scrollDOM = { scrollTop: options.scrollTop ?? 0, scrollLeft: options.scrollLeft ?? 0 };
  const viewType = options.viewType ?? "markdown";
  const value = {
    id,
    pinned: options.pinned === true,
    view: {
      file: Object.hasOwn(options, "file") ? options.file : { path: `${id}.md`, basename: id },
      editor: options.editor === false ? undefined : { cm: { scrollDOM }, focus: options.focus ?? (() => {}) },
      getViewType: () => viewType,
    },
    getDisplayText: () => id,
    parent: null,
    loadIfDeferred: options.loadIfDeferred,
    detach() {
      const parent = this.parent;
      if (parent?.children?.includes(this)) parent.removeChild(this);
    },
  };
  if (options.deferred === true && typeof value.loadIfDeferred !== "function") {
    value.loadIfDeferred = async () => {};
  }
  return value;
}

function makeWorkspace(groups, options = {}) {
  const calls = [];
  const log = (name, extra) => {
    calls.push(extra === undefined ? name : { name, ...extra });
  };
  const rootSplit = {
    children: [],
    reflow() {
      this.children.forEach((child, index) => {
        if (child.containerEl) child.left = index * 100;
      });
    },
    insertChild(index, child) {
      log("insertChild", { kind: "split" });
      const at = Math.max(0, Math.min(index, this.children.length));
      this.children.splice(at, 0, child);
      child.parent = this;
      this.reflow();
    },
    removeChild(child) {
      log("removeChild", { kind: "split" });
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
      currentTab: 0,
      mostRecentLeaf: null,
      containerEl: {
        getBoundingClientRect: () => ({
          left: group.left, top: 0, right: group.left + 100, bottom: 100, width: 100, height: 100,
        }),
      },
      insertChild(index, child) {
        log("insertChild");
        const at = Math.max(0, Math.min(index, this.children.length));
        this.children.splice(at, 0, child);
        child.parent = this;
      },
      removeChild(child) {
        log("removeChild");
        const index = this.children.indexOf(child);
        if (index < 0) return;
        this.children.splice(index, 1);
        child.parent = null;
        if (this.selectedTab === child) this.selectedTab = this.children[0] ?? null;
        this.currentTab = this.children.indexOf(this.selectedTab);
      },
      selectTab(child) {
        if (!this.children.includes(child)) throw new Error("selected tab is not a child");
        this.selectedTab = child;
        this.currentTab = this.children.indexOf(child);
      },
      recomputeChildrenDimensions() {},
    };
    for (const child of leaves) {
      const at = group.children.length;
      group.children.splice(at, 0, child);
      child.parent = group;
    }
    group.selectedTab = selected;
    group.currentTab = group.children.indexOf(selected);
    group.mostRecentLeaf = selected;
    const at = rootSplit.children.length;
    rootSplit.children.splice(at, 0, group);
    group.parent = rootSplit;
    group.left = left;
    return group;
  }
  const workspace = {
    rootSplit,
    activeLeaf: options.activeLeaf ?? null,
    layoutChanges: 0,
    saves: 0,
    calls,
    setActiveLeaf(target) {
      log("setActiveLeaf", { id: target?.id });
      this.activeLeaf = target;
      const group = target?.parent;
      if (group && Array.isArray(group.children) && group.children.includes(target)) {
        group.selectedTab = target;
        group.currentTab = group.children.indexOf(target);
        group.mostRecentLeaf = target;
      }
    },
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
    requestSaveLayout() {
      log("requestSaveLayout");
      this.saves += 1;
    },
    getLeaf() { log("getLeaf"); return null; },
    duplicateLeaf() { log("duplicateLeaf"); return null; },
    openFile() { log("openFile"); },
  };
  for (const group of groups) makeGroup(group.id, group.left, group.leaves, group.selected);
  workspace.activeLeaf ??= groups[0]?.selected ?? groups[0]?.leaves?.[0] ?? null;
  return { workspace, rootSplit, groups: rootSplit.children, calls };
}

function pluginFor(workspace) {
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = { workspace };
  plugin.initializeWindowPrefixLayoutAdapter();
  return plugin;
}

function getPlan(plugin, key, options = {}) {
  const snapshot = plugin.snapshotWindowPrefixLayout();
  return { snapshot, plan: planWindowPrefixKey(snapshot, key, options) };
}

function callNames(calls) {
  return calls.map((item) => typeof item === "string" ? item : item.name);
}

function wrapLeafCalls(leaf, calls, name = "loadIfDeferred") {
  const original = leaf[name];
  leaf[name] = async function wrapped(...args) {
    calls.push(name);
    if (typeof original === "function") return original.apply(this, args);
  };
}

function twoSplit() {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const d = leaf("D");
  const built = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [c, d], selected: c },
  ], { activeLeaf: b });
  return { ...built, a, b, c, d };
}

test("across-split jump to the selected tab focuses it in place and leaves the source selection", async () => {
  notices.length = 0;
  const { workspace, calls, a, b, c, d } = twoSplit();
  wrapLeafCalls(c, calls);
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  assert.equal(plan.action, "focus-tab");
  assert.equal(plan.tabNumber, 3);
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.action, "focus-tab");
  assert.equal(result.crossSplit, true);
  assert.equal(workspace.activeLeaf, c);
  assert.equal(c.parent, workspace.rootSplit.children[1]);
  assert.equal(workspace.rootSplit.children[1].currentTab, 0);
  assert.equal(workspace.rootSplit.children[0].selectedTab, b);
  assert.deepEqual(workspace.rootSplit.children.map((group) => group.children.map((item) => item.id)), [
    ["A", "B"], ["C", "D"],
  ]);
  assert.deepEqual(callNames(calls).sort(), ["loadIfDeferred", "setActiveLeaf"].sort());
  assert.equal(workspace.saves, 0);
  assert.equal(notices.length, 0);
  void a;
  void d;
});

test("across-split jump to an unselected tab selects it inside its own split", async () => {
  const { workspace, calls, b, d } = twoSplit();
  wrapLeafCalls(d, calls);
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "4");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(workspace.activeLeaf, d);
  assert.equal(workspace.rootSplit.children[1].selectedTab, d);
  assert.equal(workspace.rootSplit.children[0].selectedTab, b);
  assert.deepEqual(callNames(calls).sort(), ["loadIfDeferred", "setActiveLeaf"].sort());
});

test("same-split jump selects the earlier tab and leaves the other split alone", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const { workspace, calls } = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  wrapLeafCalls(a, calls);
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "1");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(workspace.activeLeaf, a);
  assert.equal(workspace.rootSplit.children[0].selectedTab, a);
  assert.equal(workspace.rootSplit.children[1].selectedTab, c);
  assert.deepEqual(callNames(calls).sort(), ["loadIfDeferred", "setActiveLeaf"].sort());
});

test("a pinned tab is a numbered jump target", async () => {
  const p = leaf("P", { pinned: true });
  const b = leaf("B");
  const c = leaf("C");
  const { workspace } = makeWorkspace([
    { id: "left", left: 0, leaves: [p, b], selected: b },
    { id: "right", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "1");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(workspace.activeLeaf, p);
  assert.equal(p.pinned, true);
  assert.equal(p.parent, workspace.rootSplit.children[0]);
});

test("already-here returns ok without setActiveLeaf", async () => {
  notices.length = 0;
  const { workspace, calls, b } = twoSplit();
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "2");
  assert.equal(plan.alreadyHere, true);
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyHere, true);
  assert.equal(workspace.activeLeaf, b);
  assert.equal(callNames(calls).includes("setActiveLeaf"), false);
  assert.equal(callNames(calls).includes("loadIfDeferred"), false);
  assert.equal(notices.length, 0);
});

test("no such tab is skipped and leaves the layout unchanged", async () => {
  const { workspace, calls, b } = twoSplit();
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "7");
  assert.equal(plan.action, "noop");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(workspace.activeLeaf, b);
  assert.deepEqual(callNames(calls), []);
});

test("past nine: jumping to tab 4 of 13 focuses that leaf", async () => {
  const left = [leaf("A"), leaf("B"), leaf("C"), leaf("D"), leaf("E"), leaf("F")];
  const right = [];
  for (let i = 7; i <= 13; i += 1) right.push(leaf("T" + i));
  const { workspace } = makeWorkspace([
    { id: "left", left: 0, leaves: left, selected: left[1] },
    { id: "right", left: 100, leaves: right, selected: right[0] },
  ], { activeLeaf: left[1] });
  const plugin = pluginFor(workspace);
  const snapshot = plugin.snapshotWindowPrefixLayout();
  const catalog = buildWindowPrefixTabCatalog(snapshot);
  assert.equal(catalog.total, 13);
  assert.equal(catalog.numbered, 9);
  assert.equal(catalog.unnumbered, 4);
  const { plan } = getPlan(plugin, "4");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(workspace.activeLeaf, left[3]);
});

test("stale armed catalog refuses without focusing", async () => {
  notices.length = 0;
  const { workspace, calls, b } = twoSplit();
  const plugin = pluginFor(workspace);
  const { snapshot, plan } = getPlan(plugin, "3");
  const catalog = buildWindowPrefixTabCatalog(snapshot);
  const stale = {
    ok: true,
    byNumber: {
      3: { ...catalog.byNumber[3], leafId: "leaf-missing" },
    },
  };
  const result = await plugin.executeWindowPrefixPlan(plan, {
    activeLeafId: plan.sourceLeafId,
    sourceSplitId: plan.sourceSplitId,
    armedCatalog: stale,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "tabs-changed");
  assert.equal(workspace.activeLeaf, b);
  assert.equal(callNames(calls).includes("setActiveLeaf"), false);
  assert.equal(notices.length, 0);
});

test("a deferred load is awaited before setActiveLeaf", async () => {
  const order = [];
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  c.loadIfDeferred = async () => {
    order.push("load");
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("loaded");
  };
  const { workspace } = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  const originalSet = workspace.setActiveLeaf.bind(workspace);
  workspace.setActiveLeaf = function (target, opts) {
    order.push("focus");
    return originalSet(target, opts);
  };
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.deepEqual(order, ["load", "loaded", "focus"]);
  assert.equal(workspace.activeLeaf, c);
});

test("a superseded session after load never focuses late", async () => {
  notices.length = 0;
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  let current = true;
  c.loadIfDeferred = async () => { current = false; };
  const { workspace, calls } = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan, {
    activeLeafId: plan.sourceLeafId,
    sourceSplitId: plan.sourceSplitId,
    isCurrent: () => current,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "superseded");
  assert.equal(workspace.activeLeaf, b);
  assert.equal(callNames(calls).includes("setActiveLeaf"), false);
  assert.equal(notices.length, 0);
});

test("setActiveLeaf that fails to activate refocuses the source and shows a Notice", async () => {
  notices.length = 0;
  const { workspace, b, c } = twoSplit();
  workspace.setActiveLeaf = function (target) {
    this.calls.push({ name: "setActiveLeaf", id: target?.id });
    if (target === c) return;
    this.activeLeaf = target;
  };
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "execution-failed");
  assert.equal(result.restored, true);
  assert.equal(workspace.activeLeaf, b);
  assert.equal(notices.length, 1);
  assert.equal(notices[0], windowPrefixFocusTabFailureMessage(3, true));
});

test("a changed parent after focus restores the source and shows a Notice", async () => {
  notices.length = 0;
  const { workspace, b, c } = twoSplit();
  const originalSet = workspace.setActiveLeaf.bind(workspace);
  workspace.setActiveLeaf = function (target, opts) {
    originalSet(target, opts);
    if (target === c) c.parent = workspace.rootSplit.children[0];
  };
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "execution-failed");
  assert.equal(result.restored, true);
  assert.equal(workspace.activeLeaf, b);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Couldn't jump to tab 3/);
});

test("a changed leaf count after focus restores the source and shows a Notice", async () => {
  notices.length = 0;
  const extra = leaf("X");
  const { workspace, b, c } = twoSplit();
  const originalSet = workspace.setActiveLeaf.bind(workspace);
  workspace.setActiveLeaf = function (target, opts) {
    originalSet(target, opts);
    if (target === c) {
      const group = workspace.rootSplit.children[1];
      group.children.push(extra);
      extra.parent = group;
    }
  };
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.restored, true);
  assert.equal(workspace.activeLeaf, b);
  assert.equal(notices.length, 1);
});

test("stale armed source is layout-changed, consistent with m0", async () => {
  const { workspace, b } = twoSplit();
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan, {
    activeLeafId: "leaf-other",
    sourceSplitId: plan.sourceSplitId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "layout-changed");
  assert.equal(workspace.activeLeaf, b);
});

test("concurrent focus-tab calls serialize load then focus", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const d = leaf("D");
  const order = [];
  c.loadIfDeferred = async () => {
    order.push("load-c");
    await gate;
    order.push("loaded-c");
  };
  d.loadIfDeferred = async () => { order.push("load-d"); };
  const { workspace } = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [c, d], selected: c },
  ], { activeLeaf: b });
  const originalSet = workspace.setActiveLeaf.bind(workspace);
  workspace.setActiveLeaf = function (target, opts) {
    order.push("focus-" + target.id);
    return originalSet(target, opts);
  };
  const plugin = pluginFor(workspace);
  const first = getPlan(plugin, "3");
  const second = getPlan(plugin, "4");
  const p1 = plugin.executeWindowPrefixPlan(first.plan);
  const p2 = plugin.executeWindowPrefixPlan(second.plan);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["load-c"]);
  release();
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.ok(order.indexOf("loaded-c") < order.indexOf("focus-C"));
  assert.ok(order.indexOf("focus-C") < order.indexOf("load-d"));
  assert.equal(workspace.activeLeaf, d);
});

test("a clipped header is scrolled into view after a successful jump", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const c = leaf("C");
  const calls = [];
  c.tabHeaderEl = {
    scrollIntoView(opts) { calls.push(opts); },
  };
  const built = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [c], selected: c },
  ], { activeLeaf: b });
  const plugin = pluginFor(built.workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ block: "nearest", inline: "nearest" }]);
});

test("a PDF tab is focused without forcing an editor", async () => {
  const a = leaf("A");
  const b = leaf("B");
  const pdf = leaf("PDF", { viewType: "pdf", editor: false, file: { path: "tiny.pdf", basename: "tiny" } });
  const { workspace, calls } = makeWorkspace([
    { id: "left", left: 0, leaves: [a, b], selected: b },
    { id: "right", left: 100, leaves: [pdf], selected: pdf },
  ], { activeLeaf: b });
  wrapLeafCalls(pdf, calls);
  const plugin = pluginFor(workspace);
  const { plan } = getPlan(plugin, "3");
  const result = await plugin.executeWindowPrefixPlan(plan);
  assert.equal(result.ok, true);
  assert.equal(workspace.activeLeaf, pdf);
  assert.equal(callNames(calls).includes("openFile"), false);
  assert.deepEqual(callNames(calls).sort(), ["loadIfDeferred", "setActiveLeaf"].sort());
});
