const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
} = require("./navigation-hotkeys-harness.cjs");

function makeSiblingTabsFixture(specs, activeId) {
  const parent = { children: [] };
  const detachCalls = [];
  const focusCalls = [];

  const leaves = specs.map((spec, index) => {
    const leaf = {
      id: spec.id || `leaf-${index}`,
      parent,
      detach: async () => {
        detachCalls.push(leaf.id);
        const position = parent.children.indexOf(leaf);
        if (position !== -1) {
          parent.children.splice(position, 1);
        }
      },
    };

    if ("pinned" in spec) {
      leaf.pinned = spec.pinned;
    }
    if (spec.viewStateThrows) {
      leaf.getViewState = () => {
        throw new Error("view state unavailable");
      };
    } else if ("viewState" in spec) {
      leaf.getViewState = () => spec.viewState;
    }

    return leaf;
  });

  parent.children = leaves.slice();
  const leafById = Object.fromEntries(leaves.map((leaf) => [leaf.id, leaf]));
  const activeLeaf = leafById[activeId];
  assert.ok(activeLeaf, `missing active leaf fixture ${activeId}`);

  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      activeLeaf,
      setActiveLeaf: (leaf, options) => {
        focusCalls.push({ id: leaf.id, options });
      },
    },
  };

  return { plugin, parent, detachCalls, focusCalls };
}

function siblingTabIds(parent) {
  return parent.children.map((leaf) => leaf.id);
}

test("tab pin Vim action registers once and toggles only the active leaf once", (t) => {
  const originalWindow = global.window;
  t.after(() => {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  });

  const actions = new Map();
  const mappings = [];
  const jumpList = {
    add() {},
    move() {
      return null;
    },
  };
  global.window = {
    CodeMirrorAdapter: {
      Vim: {
        defineAction: (name, handler) => actions.set(name, handler),
        mapCommand: (...args) => mappings.push(args),
        getVimGlobalState_: () => ({ jumpList }),
      },
    },
  };

  let firstToggleCount = 0;
  let secondToggleCount = 0;
  const firstLeaf = {
    togglePinned: () => {
      firstToggleCount += 1;
    },
  };
  const secondLeaf = {
    togglePinned: () => {
      secondToggleCount += 1;
    },
  };
  const workspace = { activeLeaf: firstLeaf };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace,
    vault: { getAbstractFileByPath: () => null, on: () => ({}) },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
  plugin.vimMappingsRegistered = false;

  assert.equal(plugin.registerVimMappings(), true);
  assert.equal(plugin.registerVimMappings(), true);
  assert.deepEqual(
    mappings.map(([key]) => key),
    ["\\s", "<C-o>", "<C-i>"],
  );
  assert.deepEqual(mappings[0], [
    "\\s",
    "action",
    "bobNavigationToggleCurrentTabPin",
    {},
    { context: "normal" },
  ]);
  assert.deepEqual(mappings[1], [
    "<C-o>",
    "action",
    "bobNavigationJumpBack",
    {},
    { context: "normal" },
  ]);
  assert.deepEqual(mappings[2], [
    "<C-i>",
    "action",
    "bobNavigationJumpForward",
    {},
    { context: "normal" },
  ]);
  assert.equal(mappings.some(([key]) => key === "\\p"), false);
  assert.equal(mappings.some(([key]) => key === "<Tab>" || key === "Tab"), false);
  assert.ok(actions.has("bobNavigationJumpBack"));
  assert.ok(actions.has("bobNavigationJumpForward"));

  actions.get("bobNavigationToggleCurrentTabPin")(null, { repeat: 5 });
  assert.equal(firstToggleCount, 1);
  assert.equal(secondToggleCount, 0);

  workspace.activeLeaf = secondLeaf;
  assert.equal(plugin.toggleCurrentTabPin(), true);
  assert.equal(firstToggleCount, 1);
  assert.equal(secondToggleCount, 1);
});

test("tab pin toggle fails safely without a supported active leaf", () => {
  const plugin = new NavigationHotkeysPlugin();

  for (const app of [
    undefined,
    {},
    { workspace: {} },
    { workspace: { activeLeaf: {} } },
    {
      workspace: {
        activeLeaf: {
          togglePinned: () => {
            throw new Error("not available");
          },
        },
      },
    },
  ]) {
    plugin.app = app;
    assert.equal(plugin.toggleCurrentTabPin(), false);
  }
});

test("close tabs left preserves pinned sibling tabs and refocuses active tab", async () => {
  const { plugin, parent, detachCalls, focusCalls } = makeSiblingTabsFixture(
    [
      { id: "left-unpinned-a" },
      { id: "left-pinned", pinned: true },
      { id: "left-unpinned-b" },
      { id: "active" },
      { id: "right-untouched" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("left"), true);
  assert.deepEqual(detachCalls, ["left-unpinned-a", "left-unpinned-b"]);
  assert.deepEqual(siblingTabIds(parent), [
    "left-pinned",
    "active",
    "right-untouched",
  ]);
  assert.deepEqual(focusCalls, [
    { id: "active", options: { focus: true } },
  ]);
});

test("close tabs right preserves pinned siblings and ignores the left side", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "left-untouched" },
      { id: "active" },
      { id: "right-pinned", pinned: true },
      { id: "right-unpinned-a" },
      { id: "right-unpinned-b" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("right"), true);
  assert.deepEqual(detachCalls, ["right-unpinned-a", "right-unpinned-b"]);
  assert.deepEqual(siblingTabIds(parent), [
    "left-untouched",
    "active",
    "right-pinned",
  ]);
});

test("close other tabs preserves pinned siblings on both sides", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "left-pinned", pinned: true },
      { id: "left-unpinned" },
      { id: "active" },
      { id: "right-pinned", pinned: true },
      { id: "right-unpinned" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("others"), true);
  assert.deepEqual(detachCalls, ["left-unpinned", "right-unpinned"]);
  assert.deepEqual(siblingTabIds(parent), [
    "left-pinned",
    "active",
    "right-pinned",
  ]);
});

test("close sibling tabs is a silent no-op when the scoped range is all pinned", async () => {
  const { plugin, parent, detachCalls, focusCalls } = makeSiblingTabsFixture(
    [
      { id: "left-pinned-a", pinned: true },
      { id: "left-pinned-b", viewState: { pinned: true } },
      { id: "active" },
      { id: "right-untouched" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("left"), false);
  assert.deepEqual(detachCalls, []);
  assert.deepEqual(siblingTabIds(parent), [
    "left-pinned-a",
    "left-pinned-b",
    "active",
    "right-untouched",
  ]);
  assert.deepEqual(focusCalls, []);
});

test("close sibling tabs honors every pinned leaf representation", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "leaf-property-pinned", pinned: true },
      { id: "view-state-pinned", viewState: { pinned: true } },
      { id: "nested-state-pinned", viewState: { state: { pinned: true } } },
      { id: "active" },
      { id: "unpinned" },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("others"), true);
  assert.deepEqual(detachCalls, ["unpinned"]);
  assert.deepEqual(siblingTabIds(parent), [
    "leaf-property-pinned",
    "view-state-pinned",
    "nested-state-pinned",
    "active",
  ]);
});

test("close sibling tabs treats throwing view state as unpinned", async () => {
  const { plugin, parent, detachCalls } = makeSiblingTabsFixture(
    [
      { id: "active" },
      { id: "throwing-view-state", viewStateThrows: true },
      { id: "right-pinned", pinned: true },
    ],
    "active",
  );

  assert.equal(await plugin.closeSiblingTabs("right"), true);
  assert.deepEqual(detachCalls, ["throwing-view-state"]);
  assert.deepEqual(siblingTabIds(parent), ["active", "right-pinned"]);
});

test("tab pin Vim registration retries after adapter availability", (t) => {
  const originalWindow = global.window;
  t.after(() => {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  });

  let activeLeafChangeHandler = null;
  const removedRefs = [];
  const registeredRefs = [];
  const workspace = {
    onLayoutReady: (callback) => callback(),
    on: (event, callback) => {
      assert.equal(event, "active-leaf-change");
      activeLeafChangeHandler = callback;
      return { event, callback };
    },
    offref: (ref) => removedRefs.push(ref),
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { workspace };
  plugin.vimMappingsRegistered = false;
  plugin.registerEvent = (ref) => registeredRefs.push(ref);
  global.window = {};

  assert.equal(plugin.registerVimMappingsWhenReady(), true);
  assert.equal(typeof activeLeafChangeHandler, "function");
  assert.equal(registeredRefs.length, 1);

  const mappings = [];
  global.window.CodeMirrorAdapter = {
    Vim: {
      defineAction: () => {},
      mapCommand: (...args) => mappings.push(args),
    },
  };
  activeLeafChangeHandler();

  assert.equal(plugin.registerVimMappings(), true);
  assert.equal(mappings.length, 1);
  assert.equal(removedRefs.length, 1);
});

