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
        this.isOpen = false;
        this.modalEl = { removeClass: () => {} };
        this.contentEl = { empty: () => {} };
      }
      open() {
        this.isOpen = true;
        return this;
      }
      close() {
        if (!this.isOpen) {
          return this;
        }
        this.isOpen = false;
        if (typeof this.onClose === "function") {
          this.onClose();
        }
        return this;
      }
    }
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: (text) => ({}),
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

function makeFakeEditor(lines, cursor) {
  const content = Array.isArray(lines) ? lines.slice() : String(lines || "").split("\n");
  const state = {
    cursor: { line: cursor.line, ch: cursor.ch },
    setCursorCalls: [],
  };
  const editor = {
    getCursor() {
      return { ...state.cursor };
    },
    setCursor(lineOrPos, ch) {
      if (typeof lineOrPos === "object") {
        state.cursor = { line: lineOrPos.line, ch: lineOrPos.ch };
      } else {
        state.cursor = { line: lineOrPos, ch };
      }
      state.setCursorCalls.push({ ...state.cursor });
    },
    getLine(line) {
      return content[line] === undefined ? "" : content[line];
    },
    getValue() {
      return content.join("\n");
    },
    lineCount() {
      return content.length;
    },
    lastLine() {
      return content.length - 1;
    },
    firstLine() {
      return 0;
    },
    setBookmark(pos) {
      const saved = { line: pos.line, ch: pos.ch };
      return {
        find: () => ({ ...saved }),
        clear: () => {},
      };
    },
    scrollIntoView() {},
    _state: state,
    _content: content,
  };
  return editor;
}

function makeMarkdownFile(path) {
  const parts = String(path).split("/");
  const basename = parts[parts.length - 1].replace(/\.md$/i, "");
  return { path, basename, extension: "md" };
}

function makePluginWithFiles({ files, activePath, activeCursor, extraWorkspace = {} }) {
  const plugin = new NavigationHotkeysPlugin();
  const fileMap = new Map();
  for (const filePath of files) {
    fileMap.set(filePath, makeMarkdownFile(filePath));
  }
  const editorsByPath = new Map();
  const leaves = [];
  for (const filePath of files) {
    const editor = makeFakeEditor(["# Title", `link to [[${filePath === "A.md" ? "B" : "A"}]]`, "## Section", "body ^blk1"], { line: 0, ch: 0 });
    editorsByPath.set(filePath, editor);
    leaves.push({ view: { file: fileMap.get(filePath), editor }, id: filePath });
  }
  const activeEditor = editorsByPath.get(activePath) || makeFakeEditor(["x"], { line: 0, ch: 0 });
  if (!editorsByPath.has(activePath)) {
    editorsByPath.set(activePath, activeEditor);
  }
  activeEditor._state.cursor = { ...activeCursor };

  const findLeaf = (filePath) => leaves.find((leaf) => leaf.view.file.path === filePath) || null;

  const workspace = {
    getActiveFile: () => fileMap.get(activePath) || null,
    getActiveViewOfType: () => ({
      file: fileMap.get(activePath) || null,
      editor: activeEditor,
    }),
    getLeavesOfType: (type) => (type === "markdown" ? leaves.slice() : []),
    iterateAllLeaves: (cb) => {
      for (const leaf of leaves) {
        cb(leaf);
      }
    },
    getLeaf: () => ({
      openFile: async (file) => {
        const prev = activePath;
        // Simulate opening: switch active path and keep its editor.
        workspace.__activePath = file.path;
        return true;
      },
    }),
    setActiveLeaf: () => true,
    revealLeaf: async () => true,
    on: () => ({}),
    offref: () => {},
    onLayoutReady: (cb) => cb(),
    ...extraWorkspace,
  };
  // Allow openFile simulation to actually switch the active file viewed by
  // getActiveViewOfType/getActiveFile.
  let currentActivePath = activePath;
  workspace.getActiveFile = () => fileMap.get(currentActivePath) || null;
  workspace.getActiveViewOfType = () => ({
    file: fileMap.get(currentActivePath) || null,
    editor: editorsByPath.get(currentActivePath) || activeEditor,
  });
  workspace.__setActivePath = (p) => {
    currentActivePath = p;
  };

  const vault = {
    getAbstractFileByPath: (p) => fileMap.get(p) || null,
    getMarkdownFiles: () => Array.from(fileMap.values()),
    on: () => ({}),
  };
  const metadataCache = {
    getFirstLinkpathDest: (lookup, sourcePath) => {
      const clean = String(lookup || "").split("#")[0].split("|")[0].trim().replace(/\.md$/i, "");
      if (!clean) {
        // Pure subpath: resolve to source file.
        return fileMap.get(sourcePath) || null;
      }
      for (const file of fileMap.values()) {
        if (file.basename === clean || file.path === `${clean}.md` || file.path === clean) {
          return file;
        }
      }
      return null;
    },
    getFileCache: () => null,
  };

  plugin.app = { workspace, vault, metadataCache, fileManager: {} };
  plugin.filePositions = new Map();
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.vimJumpOperationToken = 0;
  plugin.vimJumpHistoryChain = Promise.resolve();
  plugin.vimJumpBridgeVim = null;
  plugin.vimJumpBridgeJumpList = null;
  plugin.vimJumpBridgeOriginalAdd = null;
  plugin.vimJumpBridgeDiagnosticShown = false;
  plugin.vimJumpSuppressNativeMirror = false;
  plugin.vimJumpPendingDestinationDeferred = null;
  plugin.registerEvent = () => {};
  plugin.register = () => {};
  plugin._testEditors = editorsByPath;
  plugin._testLeaves = leaves;
  plugin._testFindLeaf = findLeaf;
  // Wire leaf lookup to the fake leaves.
  plugin.findMarkdownLeafByPath = (filePath) => findLeaf(filePath);
  plugin.activateWorkspaceLeaf = async (leaf) => {
    if (!leaf || !leaf.view || !leaf.view.file) {
      return false;
    }
    currentActivePath = leaf.view.file.path;
    return true;
  };
  plugin.openMarkdownFileWithLeafReuse = async (file) => {
    if (!file || file.extension !== "md") {
      return false;
    }
    if (!fileMap.has(file.path)) {
      return false;
    }
    currentActivePath = file.path;
    return true;
  };
  // openLinkText simulation: switch file and place cursor for heading/block.
  plugin.app.workspace.openLinkText = async (linkText, sourcePath) => {
    const hashIndex = String(linkText).indexOf("#");
    const notePart = hashIndex === -1 ? String(linkText) : String(linkText).slice(0, hashIndex);
    const subpath = hashIndex === -1 ? "" : String(linkText).slice(hashIndex);
    let targetFile = null;
    if (!notePart) {
      targetFile = fileMap.get(sourcePath) || null;
    } else {
      const clean = notePart.replace(/\.md$/i, "");
      for (const file of fileMap.values()) {
        if (file.basename === clean || file.path === `${clean}.md`) {
          targetFile = file;
          break;
        }
      }
    }
    if (!targetFile) {
      throw new Error("not found");
    }
    currentActivePath = targetFile.path;
    const editor = editorsByPath.get(targetFile.path);
    if (editor && subpath) {
      if (subpath.startsWith("#^")) {
        editor._state.cursor = { line: 3, ch: 0 };
      } else if (subpath.startsWith("#")) {
        editor._state.cursor = { line: 2, ch: 0 };
      } else {
        editor._state.cursor = { line: 0, ch: 0 };
      }
    } else if (editor) {
      editor._state.cursor = { line: 0, ch: 0 };
    }
    return true;
  };
  return { plugin, editorsByPath, workspace, vault, fileMap, getActivePath: () => currentActivePath };
}

function makeVimStub() {
  const actions = new Map();
  const mappings = [];
  let jumpList = null;
  const vim = {
    defineAction: (name, handler) => actions.set(name, handler),
    mapCommand: (...args) => {
      mappings.push(args);
      if (vim.__bobTestKeymap) {
        vim.__bobTestKeymap.unshift({ keys: args[0], context: args[4] && args[4].context, action: args[2] });
      }
    },
    unmap: (lhs, ctx) => {
      const index = mappings.findIndex((entry) => entry[0] === lhs && entry[4] && entry[4].context === ctx);
      if (index !== -1) {
        mappings.splice(index, 1);
        return true;
      }
      return false;
    },
    getVimGlobalState_: () => ({ jumpList }),
    __bobTestKeymap: [],
    _actions: actions,
    _mappings: mappings,
    _setJumpList(list) {
      jumpList = list;
    },
  };
  return vim;
}

function makeNativeJumpList() {
  const calls = [];
  return {
    addCalls: calls,
    add(cm, oldCur, newCur) {
      calls.push({ cm, oldCur: { ...oldCur }, newCur: { ...newCur } });
    },
    move(cm, offset) {
      return { find: () => ({ line: 0, ch: 0 }) };
    },
  };
}

test("history records ordered locations with file identity and dedupes adjacent repeats", () => {
  const state = helpers.createVimJumpHistory();
  assert.equal(helpers.getVimJumpHistoryLength(state), 0);
  assert.equal(helpers.getVimJumpCurrentIndex(state), -1);
  assert.equal(helpers.recordVimJumpLocation(state, { path: "A.md", line: 1, ch: 2 }), true);
  assert.equal(helpers.recordVimJumpLocation(state, { path: "A.md", line: 1, ch: 2 }), false);
  assert.equal(helpers.getVimJumpHistoryLength(state), 1);
  // Same coordinates in a different file remain distinct.
  assert.equal(helpers.recordVimJumpLocation(state, { path: "B.md", line: 1, ch: 2 }), true);
  assert.equal(helpers.getVimJumpHistoryLength(state), 2);
  assert.ok(helpers.vimJumpLocationsEqual(state.entries[0], { path: "A.md", line: 1, ch: 2 }));
  assert.equal(helpers.vimJumpLocationsEqual(state.entries[0], state.entries[1]), false);
});

test("transition records origin then destination and truncates forward only on success", () => {
  const state = helpers.createVimJumpHistory();
  assert.equal(helpers.recordVimJumpTransition(state, { path: "A.md", line: 0, ch: 0 }, { path: "B.md", line: 0, ch: 0 }), true);
  assert.equal(helpers.getVimJumpHistoryLength(state), 2);
  // A -> B -> C round-trip shape.
  assert.equal(helpers.recordVimJumpTransition(state, { path: "B.md", line: 0, ch: 0 }, { path: "C.md", line: 0, ch: 0 }), true);
  assert.equal(helpers.getVimJumpHistoryLength(state), 3);
  // Simulate back twice by moving the index, then a new jump discards forward.
  state.index = 1;
  assert.equal(helpers.recordVimJumpTransition(state, { path: "B.md", line: 5, ch: 0 }, { path: "D.md", line: 0, ch: 0 }), true);
  assert.deepEqual(
    state.entries.map((entry) => entry.path),
    ["A.md", "B.md", "B.md", "D.md"],
  );
  // Same-file/same-position no-ops add nothing.
  const before = helpers.getVimJumpHistoryLength(state);
  assert.equal(helpers.recordVimJumpTransition(state, { path: "D.md", line: 0, ch: 0 }, { path: "D.md", line: 0, ch: 0 }), false);
  assert.equal(helpers.getVimJumpHistoryLength(state), before);
});

test("history retains at most 100 locations and refreshes the live tip", () => {
  const state = helpers.createVimJumpHistory();
  for (let i = 0; i < 105; i += 1) {
    helpers.recordVimJumpLocation(state, { path: "A.md", line: i, ch: 0 });
  }
  assert.equal(helpers.getVimJumpHistoryLength(state), helpers.VIM_JUMP_HISTORY_LIMIT);
  assert.equal(state.entries[0].line, 5);
  assert.equal(helpers.getVimJumpCurrentIndex(state), 99);

  const tip = helpers.createVimJumpHistory();
  helpers.recordVimJumpTransition(tip, { path: "A.md", line: 0, ch: 0 }, { path: "B.md", line: 0, ch: 0 });
  // Ordinary cursor motion at the destination refreshes the tip without a new entry.
  assert.equal(helpers.refreshVimJumpCurrentLocation(tip, { path: "B.md", line: 9, ch: 3 }), true);
  assert.equal(helpers.getVimJumpHistoryLength(tip), 2);
  assert.deepEqual(tip.entries[1], { path: "B.md", line: 9, ch: 3 });
  assert.equal(helpers.refreshVimJumpCurrentLocation(tip, { path: "B.md", line: 9, ch: 3 }), false);
});

test("rename updates paths and delete prunes without corrupting the index", () => {
  const state = helpers.createVimJumpHistory();
  helpers.recordVimJumpTransition(state, { path: "A.md", line: 0, ch: 0 }, { path: "B.md", line: 0, ch: 0 });
  assert.equal(helpers.updateVimJumpHistoryPath(state, "B.md", "Renamed.md"), 1);
  assert.equal(state.entries[1].path, "Renamed.md");
  assert.equal(helpers.removeVimJumpHistoryPath(state, "A.md"), 1);
  assert.equal(helpers.getVimJumpHistoryLength(state), 1);
  assert.equal(state.entries[0].path, "Renamed.md");
});

test("bridge wraps add once, mirrors native jumps, and preserves the original call", () => {
  const { plugin } = makePluginWithFiles({ files: ["A.md"], activePath: "A.md", activeCursor: { line: 0, ch: 0 } });
  const vim = makeVimStub();
  const jumpList = makeNativeJumpList();
  vim._setJumpList(jumpList);
  const originalWindow = global.window;
  global.window = { CodeMirrorAdapter: { Vim: vim } };
  try {
    assert.equal(plugin.installVimJumpHistoryMappings(vim), true);
    const wrapped = jumpList.add;
    assert.equal(typeof wrapped, "function");
    assert.equal(wrapped.bobNavigationJumpBridge, true);
    assert.equal(plugin.installVimJumpHistoryMappings(vim), true);
    assert.equal(jumpList.add, wrapped);

    // Background editors without a matching view are never assigned the active file.
    const backgroundCm = { getCursor: () => ({ line: 0, ch: 0 }) };
    wrapped(backgroundCm, { line: 0, ch: 0 }, { line: 5, ch: 0 });
    assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);
    assert.equal(jumpList.addCalls.length, 1);

    // A matching editor mirrors once (the Markdown editor object itself).
    const matchingCm = plugin._testEditors.get("A.md");
    wrapped(matchingCm, { line: 0, ch: 0 }, { line: 5, ch: 0 });
    assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);
    assert.equal(jumpList.addCalls.length, 2);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("bridge without a jump list preserves keys and emits one compatibility diagnostic", () => {
  const { plugin } = makePluginWithFiles({ files: ["A.md"], activePath: "A.md", activeCursor: { line: 0, ch: 0 } });
  notices.length = 0;
  const vim = makeVimStub();
  vim._setJumpList(null);
  vim.getVimGlobalState_ = () => ({});
  assert.equal(plugin.installVimJumpHistoryMappings(vim), false);
  assert.equal(plugin.installVimJumpHistoryMappings(vim), false);
  assert.equal(notices.filter((message) => message.includes("Vim jump history unavailable")).length, 1);
  assert.equal(vim._mappings.some(([key]) => key === "<C-o>"), false);
  assert.equal(vim._mappings.some(([key]) => key === "<C-i>"), false);
});

test("registration maps Ctrl+O and Ctrl+I in normal mode only and leaves Tab alone", () => {
  const { plugin } = makePluginWithFiles({ files: ["A.md"], activePath: "A.md", activeCursor: { line: 0, ch: 0 } });
  const vim = makeVimStub();
  const jumpList = makeNativeJumpList();
  vim._setJumpList(jumpList);
  const originalWindow = global.window;
  global.window = { CodeMirrorAdapter: { Vim: vim } };
  try {
    plugin.vimMappingsRegistered = false;
    assert.equal(plugin.registerVimMappings(), true);
    const keys = vim._mappings.map(([key]) => key);
    assert.ok(keys.includes("\\s"));
    assert.ok(keys.includes("<C-o>"));
    assert.ok(keys.includes("<C-i>"));
    for (const mapping of vim._mappings) {
      assert.equal(mapping[4].context, "normal");
    }
    assert.equal(keys.some((key) => key === "<Tab>" || key === "Tab"), false);
    assert.ok(vim._actions.has("bobNavigationJumpBack"));
    assert.ok(vim._actions.has("bobNavigationJumpForward"));
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("Enter A->B round-trips with Ctrl+O and Ctrl+I", async () => {
  const { plugin, editorsByPath } = makePluginWithFiles({
    files: ["A.md", "B.md"],
    activePath: "A.md",
    activeCursor: { line: 1, ch: 3 },
  });
  editorsByPath.get("A.md")._content[1] = "go to [[B]]";
  const cm = editorsByPath.get("A.md");
  assert.equal(plugin.handleVimLineLinkAction(cm, {}, 1, 0), true);
  await plugin.vimJumpHistoryChain;
  // Wait for the async destination capture.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);
  assert.deepEqual(plugin.vimJumpHistory.entries[0], { path: "A.md", line: 1, ch: 3 });

  await plugin.traverseVimJumpHistory(-1, 1, editorsByPath.get("B.md"));
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.vimJumpHistory.index, 0);

  await plugin.traverseVimJumpHistory(1, 1, editorsByPath.get("A.md"));
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.vimJumpHistory.index, 1);
});

test("counted Enter returns to the original cursor, not the counted link line", async () => {
  const { plugin, editorsByPath } = makePluginWithFiles({
    files: ["A.md", "B.md"],
    activePath: "A.md",
    activeCursor: { line: 0, ch: 7 },
  });
  editorsByPath.get("A.md")._content[0] = "first [[Missing]]";
  editorsByPath.get("A.md")._content[2] = "third [[B]]";
  const cm = {
    getCursor: () => ({ line: 0, ch: 7 }),
    getLine: (line) => editorsByPath.get("A.md").getLine(line),
    firstLine: () => 0,
    lastLine: () => 3,
    lineCount: () => 4,
  };
  assert.equal(plugin.handleVimLineLinkAction(cm, { repeat: 2, repeatIsExplicit: true }, 1, 0), true);
  await plugin.vimJumpHistoryChain;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);
  assert.deepEqual(plugin.vimJumpHistory.entries[0], { path: "A.md", line: 0, ch: 7 });
});

test("picker choice records one jump and cancellation records none", async () => {
  const { plugin } = makePluginWithFiles({
    files: ["A.md", "B.md", "C.md"],
    activePath: "A.md",
    activeCursor: { line: 1, ch: 0 },
  });
  const origin = { path: "A.md", line: 1, ch: 0 };
  const context = { origin, token: plugin.vimJumpOperationToken };
  const candidates = [
    { target: "B", sourcePath: "A.md", resolvedFile: { path: "B.md" }, creation: null, path: "B.md" },
    { target: "C", sourcePath: "A.md", resolvedFile: { path: "C.md" }, creation: null, path: "C.md" },
  ];
  const modal = new helpers.LinkCandidatePickerModal(plugin.app, plugin, candidates, 1, context);
  assert.ok(modal.vimJumpContext);
  // Simulate choosing the second item.
  await plugin.openOrCreateLinkCandidate(candidates[1], modal.vimJumpContext);
  await plugin.vimJumpHistoryChain;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);

  const before = helpers.getVimJumpHistoryLength(plugin.vimJumpHistory);
  // Opening/filtering/cancelling the picker produces no jump.
  assert.equal(before, 2);
});

test("stale picker origin is rejected and failed opens record nothing", async () => {
  const { plugin, workspace } = makePluginWithFiles({
    files: ["A.md", "B.md", "C.md"],
    activePath: "A.md",
    activeCursor: { line: 0, ch: 0 },
  });
  const staleContext = { origin: { path: "A.md", line: 0, ch: 0 }, token: plugin.vimJumpOperationToken };
  workspace.__setActivePath("C.md");
  const opened = await plugin.openOrCreateLinkCandidate(
    { target: "B", sourcePath: "A.md", resolvedFile: { path: "B.md" }, creation: null, path: "B.md" },
    staleContext,
  );
  assert.equal(opened, true);
  await plugin.vimJumpHistoryChain;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);

  // Failed opens add nothing.
  plugin.openResolvedLink = async () => false;
  const freshContext = plugin.beginVimLinkJump({ getCursor: () => ({ line: 0, ch: 0 }) });
  const failed = await plugin.openOrCreateLinkCandidate(
    { target: "Missing", sourcePath: "C.md", resolvedFile: { path: "Missing.md" }, creation: null, path: "Missing.md" },
    freshContext,
  );
  assert.equal(failed, false);
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 0);
});

test("Backspace shares the link path and no-link lines fall through", async () => {
  const { plugin, editorsByPath } = makePluginWithFiles({
    files: ["A.md", "B.md"],
    activePath: "A.md",
    activeCursor: { line: 1, ch: 0 },
  });
  editorsByPath.get("A.md")._content[0] = "up [[B]]";
  const cm = {
    getCursor: () => ({ line: 1, ch: 0 }),
    getLine: (line) => editorsByPath.get("A.md").getLine(line),
    firstLine: () => 0,
    lastLine: () => 3,
    lineCount: () => 4,
  };
  assert.equal(plugin.handleVimLineLinkAction(cm, {}, -1, -1), true);
  await plugin.vimJumpHistoryChain;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 2);

  const plainCm = {
    getCursor: () => ({ line: 3, ch: 0 }),
    getLine: () => "no links here",
    firstLine: () => 0,
    lastLine: () => 3,
    lineCount: () => 4,
  };
  assert.equal(plugin.handleVimLineLinkAction(plainCm, {}, 1, 0), false);
});

test("counted traversal honors boundaries and new jumps replace the forward branch", async () => {
  const { plugin, editorsByPath } = makePluginWithFiles({
    files: ["A.md", "B.md", "C.md", "D.md"],
    activePath: "A.md",
    activeCursor: { line: 0, ch: 0 },
  });
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "A.md", line: 0, ch: 0 }, { path: "B.md", line: 0, ch: 0 });
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "B.md", line: 0, ch: 0 }, { path: "C.md", line: 0, ch: 0 });
  assert.equal(helpers.getVimJumpHistoryLength(plugin.vimJumpHistory), 3);

  const cm = editorsByPath.get("C.md");
  await plugin.traverseVimJumpHistory(-1, 5, cm);
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.vimJumpHistory.index, 0);
  // At the oldest entry another back step is a no-op.
  assert.equal(await plugin.traverseVimJumpHistory(-1, 1, cm), false);

  await plugin.traverseVimJumpHistory(1, 5, cm);
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.vimJumpHistory.index, 2);
  assert.equal(await plugin.traverseVimJumpHistory(1, 1, cm), false);

  // Going back then recording a new jump discards the forward branch.
  await plugin.traverseVimJumpHistory(-1, 1, cm);
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.vimJumpHistory.index, 1);
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "B.md", line: 0, ch: 0 }, { path: "D.md", line: 0, ch: 0 });
  assert.deepEqual(
    plugin.vimJumpHistory.entries.map((entry) => entry.path),
    ["A.md", "B.md", "D.md"],
  );
});

test("ordinary motion before back is preserved for forward restore", async () => {
  const { plugin, editorsByPath } = makePluginWithFiles({
    files: ["A.md", "B.md"],
    activePath: "B.md",
    activeCursor: { line: 0, ch: 0 },
  });
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "A.md", line: 4, ch: 2 }, { path: "B.md", line: 0, ch: 0 });
  // The user moves within B before pressing Ctrl+O.
  editorsByPath.get("B.md")._state.cursor = { line: 8, ch: 1 };
  await plugin.traverseVimJumpHistory(-1, 1, editorsByPath.get("B.md"));
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.vimJumpHistory.index, 0);
  assert.deepEqual(plugin.vimJumpHistory.entries[1], { path: "B.md", line: 8, ch: 1 });
  await plugin.traverseVimJumpHistory(1, 1, editorsByPath.get("A.md"));
  await plugin.vimJumpHistoryChain;
  assert.equal(plugin.vimJumpHistory.index, 1);
});

test("deleted entries are skipped and heading links settle before recording", async () => {
  const { plugin, editorsByPath, fileMap } = makePluginWithFiles({
    files: ["A.md", "B.md", "Gone.md"],
    activePath: "C.md",
    activeCursor: { line: 0, ch: 0 },
  });
  plugin.app.workspace.__setActivePath("A.md");
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "A.md", line: 0, ch: 0 }, { path: "Gone.md", line: 0, ch: 0 });
  helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "Gone.md", line: 0, ch: 0 }, { path: "B.md", line: 0, ch: 0 });
  fileMap.delete("Gone.md");
  plugin.vimJumpHistory.index = 2;
  await plugin.traverseVimJumpHistory(-1, 1, editorsByPath.get("B.md"));
  await plugin.vimJumpHistoryChain;
  // The deleted entry is skipped, landing on A.
  assert.equal(plugin.vimJumpHistory.entries[plugin.vimJumpHistory.index].path, "A.md");

  // Heading link across notes settles on the heading line.
  const headingPlugin = makePluginWithFiles({
    files: ["A.md", "B.md"],
    activePath: "A.md",
    activeCursor: { line: 0, ch: 0 },
  }).plugin;
  headingPlugin._testEditors.get("A.md")._content[0] = "see [[B#Section]]";
  const cm = headingPlugin._testEditors.get("A.md");
  assert.equal(headingPlugin.handleVimLineLinkAction(cm, {}, 1, 0), true);
  await headingPlugin.vimJumpHistoryChain;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await headingPlugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(headingPlugin.vimJumpHistory), 2);
  assert.equal(headingPlugin.vimJumpHistory.entries[1].path, "B.md");
  assert.equal(headingPlugin.vimJumpHistory.entries[1].line, 2);
});

test("native fallback runs with empty history and boundaries never replay natives", async () => {
  const { plugin } = makePluginWithFiles({ files: ["A.md"], activePath: "A.md", activeCursor: { line: 0, ch: 0 } });
  const vim = makeVimStub();
  let moved = 0;
  vim._setJumpList({
    add() {},
    move: (cm, offset) => {
      moved += 1;
      return { find: () => ({ line: 1, ch: 0 }) };
    },
  });
  const originalWindow = global.window;
  global.window = { CodeMirrorAdapter: { Vim: vim } };
  try {
    const cm = { getCursor: () => ({ line: 0, ch: 0 }), setCursor: () => {} };
    assert.equal(await plugin.traverseVimJumpHistory(-1, 1, cm), true);
    assert.equal(moved, 1);

    helpers.recordVimJumpTransition(plugin.vimJumpHistory, { path: "A.md", line: 0, ch: 0 }, { path: "A.md", line: 5, ch: 0 });
    plugin.vimJumpHistory.index = 0;
    moved = 0;
    // At the oldest file-aware entry the boundary is a no-op, not a native replay.
    const before = plugin.vimJumpHistory.index;
    // Force the live location to match the boundary entry so no refresh occurs.
    plugin.resolveVimJumpLiveLocation = () => ({ path: "A.md", line: 0, ch: 0 });
    assert.equal(await plugin.traverseVimJumpHistory(-1, 1, cm), false);
    assert.equal(moved, 0);
    assert.equal(plugin.vimJumpHistory.index, before);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("unload restores the native add and keeps a foreign later mapping", () => {
  const { plugin } = makePluginWithFiles({ files: ["A.md"], activePath: "A.md", activeCursor: { line: 0, ch: 0 } });
  const vim = makeVimStub();
  const jumpList = makeNativeJumpList();
  vim._setJumpList(jumpList);
  const originalWindow = global.window;
  global.window = { CodeMirrorAdapter: { Vim: vim } };
  try {
    assert.equal(plugin.installVimJumpHistoryMappings(vim), true);
    assert.equal(jumpList.add.bobNavigationJumpBridge, true);
    // The wrapper still calls through to the native list.
    const callsBefore = jumpList.addCalls.length;
    jumpList.add(plugin._testEditors.get("A.md"), { line: 0, ch: 0 }, { line: 1, ch: 0 });
    assert.equal(jumpList.addCalls.length, callsBefore + 1);
    plugin.cleanupVimJumpHistoryMappings();
    assert.equal(jumpList.add.bobNavigationJumpBridge, undefined);
    assert.equal(typeof jumpList.add, "function");

    // A foreign mapping installed after ours is left intact.
    assert.equal(plugin.installVimJumpHistoryMappings(vim), true);
    vim.__bobTestKeymap.unshift({ keys: "<C-o>", context: "normal", action: "foreignBack" });
    plugin.cleanupVimJumpHistoryMappings();
    assert.ok(vim.__bobTestKeymap.some((entry) => entry.action === "foreignBack"));
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
