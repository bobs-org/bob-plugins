const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");

// Mirrored from bob-cli tests/fixtures/line_digest/vectors.json.
const LINE_DIGEST_VECTORS = [
  { id: "plain", line: "- [ ] #task Same", digest: "35a733bd" },
  { id: "trailing-spaces", line: "- [ ] #task Same   ", digest: "35a733bd" },
  { id: "trailing-tab-cr", line: "- [ ] #task Same\t\r", digest: "35a733bd" },
  { id: "trailing-nbsp", line: "- [ ] #task Same\u00A0", digest: "35a733bd" },
  { id: "trailing-nel", line: "- [ ] #task Same\u0085", digest: "35a733bd" },
  { id: "trailing-bom-kept", line: "- [ ] #task Same\uFEFF", digest: "080a2f04" },
  {
    id: "leading-indent-kept",
    line: "\t- [ ] #task Indented ^blk",
    digest: "95e4c084",
  },
  { id: "leading-spaces-kept", line: "  - [ ] #task Same", digest: "7c6b26a7" },
  {
    id: "unicode",
    line: "- [/] #task Café ☕ — résumé 日本語 ^cafe-1",
    digest: "c4c8a067",
  },
  {
    id: "inline-fields",
    line: "- [*] #task Ship it [created:: 2026-10-01] [scheduled:: 2026-10-20] ^ship-it",
    digest: "c2201ec4",
  },
];

function stubOnloadPlugin(overrides = {}) {
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  plugin.addCommand = () => {};
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.registerEditorExtension = () => {};
  Object.assign(plugin, overrides);
  return plugin;
}

function createGoToTaskHarness(options = {}) {
  const vaultBase = options.vaultBase || "/Users/me/bob";
  const file = options.file || {
    path: "dev.md",
    basename: "dev",
    extension: "md",
  };
  const content =
    options.content ||
    ["- [ ] #task Same ^same", "- [ ] #task Other ^other"].join("\n");
  const editor = new TransactionEditor(
    content,
    options.cursor || { line: 0, ch: 0 },
  );
  editor.focusCalls = 0;
  editor.focus = () => {
    editor.focusCalls += 1;
  };
  editor.setLineCalls = [];
  editor.setLine = (line, text) => {
    editor.setLineCalls.push({ line, text });
  };

  const files = new Map([[file.path, file]]);
  for (const extra of options.extraFiles || []) {
    files.set(extra.path, extra);
  }

  const cachedContent = new Map([
    [
      file.path,
      options.cachedContent != null ? options.cachedContent : content,
    ],
  ]);

  const openEditors = new Map();
  if (options.openEditor !== false) {
    openEditors.set(file.path, editor);
  }

  const originFile = options.originFile || null;
  const originEditor = options.originEditor || null;
  let activeFile =
    originFile || (options.startOnTarget === false ? null : file);
  let activeEditor =
    originEditor || (options.startOnTarget === false ? null : editor);

  const writes = [];
  const walkCalls = [];
  const openFileCalls = [];
  const activateCalls = [];
  const setViewStateCalls = [];
  let leafMode = options.leafMode || "source";
  const leafSource = options.leafSource === true;

  const leaf = {
    view: {
      get file() {
        return file;
      },
      get editor() {
        return editor;
      },
    },
    getViewState: () => ({
      type: "markdown",
      state: { mode: leafMode, source: leafSource },
    }),
    setViewState: async (state) => {
      setViewStateCalls.push(JSON.parse(JSON.stringify(state)));
      if (state && state.state && typeof state.state.mode === "string") {
        leafMode = state.state.mode;
      }
    },
  };

  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    vault: {
      adapter: {
        getBasePath: () => vaultBase,
      },
      getAbstractFileByPath: (vaultPath) => files.get(vaultPath) || null,
      getMarkdownFiles: () => [...files.values()],
      cachedRead: async (target) => {
        const text = cachedContent.get(target.path);
        if (text == null) {
          throw new Error("missing cached read");
        }
        return text;
      },
      modify: async () => {
        writes.push("vault.modify");
      },
      process: async () => {
        writes.push("vault.process");
      },
    },
    workspace: {
      onLayoutReady: (callback) => callback && callback(),
      getActiveFile: () => activeFile,
      getActiveViewOfType: () =>
        activeFile && activeEditor
          ? { file: activeFile, editor: activeEditor }
          : null,
      iterateAllLeaves: (callback) => {
        if (options.noteAlreadyOpen !== false) {
          callback(leaf);
        }
      },
      getLeaf: () => ({
        openFile: async (target) => {
          openFileCalls.push(target.path);
          activeFile = target;
          activeEditor = openEditors.get(target.path) || editor;
        },
      }),
      setActiveLeaf: () => {},
    },
  };

  plugin.filePositions = new Map();
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.vimJumpOperationToken = 0;
  plugin.vimJumpHistoryChain = Promise.resolve();
  plugin.vimJumpSuppressNativeMirror = false;
  plugin.vimJumpPendingDestinationDeferred = null;
  plugin.pendingTaskMoveJumpDeferred = null;
  plugin.pendingTaskMoveJumpCompletion = null;
  plugin.pendingTaskMoveJumpLandingId = null;
  plugin.taskMoveLandingSeq = 0;
  plugin.pendingOpenTaskJumpCenterDeferred = null;
  plugin.registerEvent = () => {};
  plugin.register = () => {};

  plugin.getActiveMarkdownView = () =>
    activeFile && activeEditor ? { file: activeFile, editor: activeEditor } : null;
  plugin.getOpenMarkdownEditorForPath = (filePath) =>
    openEditors.get(filePath) || null;
  plugin.findMarkdownLeafByPath = (filePath) =>
    options.noteAlreadyOpen === false
      ? null
      : filePath === file.path
        ? leaf
        : null;
  plugin.activateWorkspaceLeaf = async (targetLeaf) => {
    activateCalls.push(targetLeaf);
    if (!targetLeaf || !targetLeaf.view || !targetLeaf.view.file) {
      return false;
    }
    activeFile = targetLeaf.view.file;
    activeEditor = targetLeaf.view.editor;
    return true;
  };

  const originalReplaceRange = editor.replaceRange.bind(editor);
  editor.replaceRange = (...args) => {
    writes.push("editor.replaceRange");
    return originalReplaceRange(...args);
  };

  plugin.parkReviewWalkAfterMove = (...args) => {
    walkCalls.push(["park", ...args]);
    return false;
  };
  plugin.advanceReviewWalkAfterAnswer = async (...args) => {
    walkCalls.push(["advance", ...args]);
    return false;
  };

  if (options.stubOpen === true) {
    plugin.openMarkdownFileWithLeafReuse = async (target, failureNotice) => {
      openFileCalls.push({
        path: target && target.path,
        failureNotice,
      });
      if (options.openResult === false) {
        return false;
      }
      activeFile = target;
      activeEditor = openEditors.get(target.path) || editor;
      return true;
    };
  }

  return {
    plugin,
    file,
    editor,
    leaf,
    writes,
    walkCalls,
    openFileCalls,
    activateCalls,
    setViewStateCalls,
    vaultBase,
    getActive: () => ({ activeFile, activeEditor }),
    setActive: (nextFile, nextEditor) => {
      activeFile = nextFile;
      activeEditor = nextEditor;
    },
    params: (overrides = {}) => ({
      path: `${vaultBase}/${file.path}`,
      line: "1",
      ref: `1:${LINE_DIGEST_VECTORS[0].digest}`,
      ...overrides,
    }),
  };
}

test("bobLineDigest matches the shared bob-cli vectors", async () => {
  for (const vector of LINE_DIGEST_VECTORS) {
    assert.equal(
      await helpers.bobLineDigest(vector.line),
      vector.digest,
      vector.id,
    );
  }
});

test("parseGoToTaskParams accepts a complete v1 link and ignores extra keys", () => {
  assert.deepEqual(
    helpers.parseGoToTaskParams({
      path: "/Users/me/bob/dev.md",
      line: "42",
      ref: "42:35a733bd",
      block: "fix-sync",
      pane: "tab",
    }),
    {
      path: "/Users/me/bob/dev.md",
      line: 42,
      ref: "42:35a733bd",
      block: "fix-sync",
    },
  );
});

test("parseGoToTaskParams treats ref and block as optional", () => {
  assert.deepEqual(
    helpers.parseGoToTaskParams({ path: "/tmp/a.md", line: 3 }),
    { path: "/tmp/a.md", line: 3, ref: null, block: null },
  );
});

test("parseGoToTaskParams rejects each malformed field", () => {
  const valid = { path: "/Users/me/bob/dev.md", line: "42" };
  const cases = [
    null,
    {},
    { line: "42" },
    { path: "  ", line: "42" },
    { path: valid.path },
    { ...valid, line: "0" },
    { ...valid, line: "-1" },
    { ...valid, line: "1.5" },
    { ...valid, line: "abc" },
    { ...valid, ref: "42:35A733BD" },
    { ...valid, ref: "42:35a733b" },
    { ...valid, ref: "0:35a733bd" },
    { ...valid, block: "fix_sync" },
    { ...valid, block: "fix sync" },
  ];
  for (const params of cases) {
    assert.equal(helpers.parseGoToTaskParams(params), null);
  }
});

test("vaultPathFromAbsolute maps inside the vault and strips a trailing slash on the base", () => {
  assert.equal(
    helpers.vaultPathFromAbsolute("/Users/me/bob/dev.md", "/Users/me/bob"),
    "dev.md",
  );
  assert.equal(
    helpers.vaultPathFromAbsolute("/Users/me/bob/areas/dev.md", "/Users/me/bob/"),
    "areas/dev.md",
  );
  assert.equal(
    helpers.vaultPathFromAbsolute("/tmp/other.md", "/Users/me/bob"),
    null,
  );
});

test("refindGoToTaskLine uses planned, block-id, unique digest, and clamped sources", async () => {
  const same = "- [ ] #task Same";
  const digest = await helpers.bobLineDigest(same);
  const unique = "- [ ] #task Unique ^u";
  const uniqueDigest = await helpers.bobLineDigest(unique);

  assert.deepEqual(
    await helpers.refindGoToTaskLine([same, "- [ ] #task Other ^other"], {
      line: 1,
      ref: `1:${digest}`,
    }),
    { line: 0, source: "planned" },
  );

  assert.deepEqual(
    await helpers.refindGoToTaskLine(
      ["# Inserted", "- [ ] #task Moved ^moved"],
      { line: 1, ref: "1:deadbeef", block: "moved" },
    ),
    { line: 1, source: "block-id" },
  );

  assert.deepEqual(
    await helpers.refindGoToTaskLine(["# Inserted", unique], {
      line: 1,
      ref: `1:${uniqueDigest}`,
    }),
    { line: 1, source: "digest" },
  );

  assert.deepEqual(
    await helpers.refindGoToTaskLine(["# Heading", same, same], {
      line: 1,
      ref: `1:${digest}`,
    }),
    { line: 0, source: "clamped" },
  );

  assert.deepEqual(
    await helpers.refindGoToTaskLine([same], { line: 99 }),
    { line: 0, source: "clamped" },
  );
});

test("handleGoToTaskUri notices each malformed parameter", async () => {
  const { plugin, params } = createGoToTaskHarness();
  const malformed = [
    { line: "1" },
    params({ path: "" }),
    params({ line: "0" }),
    params({ line: "nope" }),
    params({ ref: "1:35A733BD" }),
    params({ block: "fix_sync" }),
  ];
  for (const bad of malformed) {
    notices.length = 0;
    assert.equal(await plugin.handleGoToTaskUri(bad), false);
    assert.deepEqual(notices, ["Bob Go To: invalid task link"]);
  }
});

test("handleGoToTaskUri notices a path outside the vault", async () => {
  const { plugin } = createGoToTaskHarness();
  notices.length = 0;
  assert.equal(
    await plugin.handleGoToTaskUri({
      path: "/tmp/other.md",
      line: "1",
    }),
    false,
  );
  assert.deepEqual(notices, ["Bob Go To: /tmp/other.md is outside this vault"]);
});

test("handleGoToTaskUri notices a missing file inside the vault", async () => {
  const { plugin, vaultBase } = createGoToTaskHarness();
  notices.length = 0;
  assert.equal(
    await plugin.handleGoToTaskUri({
      path: `${vaultBase}/missing.md`,
      line: "1",
    }),
    false,
  );
  assert.deepEqual(notices, ["Bob Go To: missing.md not found"]);
});

test("handleGoToTaskUri maps a trailing-slash vault base", async () => {
  const harness = createGoToTaskHarness({
    vaultBase: "/Users/me/bob/",
    stubOpen: true,
  });
  notices.length = 0;
  const same = "- [ ] #task Same ^same";
  const digest = await helpers.bobLineDigest(same);
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: "/Users/me/bob/dev.md",
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  assert.equal(harness.editor.getCursor().line, 0);
  assert.equal(harness.editor.getCursor().ch, 0);
});

test("handleGoToTaskUri prefers the open buffer over cachedRead", async () => {
  const same = "- [ ] #task Same ^same";
  const digest = await helpers.bobLineDigest(same);
  const editorContent = ["# Inserted", same].join("\n");
  const harness = createGoToTaskHarness({
    content: editorContent,
    cachedContent: same,
    stubOpen: true,
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  assert.deepEqual(harness.editor.getCursor(), { line: 1, ch: 0 });
  assert.equal(notices.length, 0);
});

test("handleGoToTaskUri re-finds by block id after an insert above the task", async () => {
  const moved = "- [ ] #task Moved ^moved";
  const digest = await helpers.bobLineDigest(moved);
  const harness = createGoToTaskHarness({
    content: ["# Inserted", moved].join("\n"),
    stubOpen: true,
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
      block: "moved",
    }),
    true,
  );
  assert.deepEqual(harness.editor.getCursor(), { line: 1, ch: 0 });
  assert.equal(notices.length, 0);
});

test("handleGoToTaskUri re-finds a unique digest after a shift with no block", async () => {
  const unique = "- [ ] #task Unique task";
  const digest = await helpers.bobLineDigest(unique);
  const harness = createGoToTaskHarness({
    content: ["# Inserted", unique].join("\n"),
    stubOpen: true,
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  assert.deepEqual(harness.editor.getCursor(), { line: 1, ch: 0 });
  assert.equal(notices.length, 0);
});

test("handleGoToTaskUri clamps a duplicate digest and shows the changed-task notice", async () => {
  const same = "- [ ] #task Same";
  const digest = await helpers.bobLineDigest(same);
  const harness = createGoToTaskHarness({
    content: ["# Heading", same, same].join("\n"),
    stubOpen: true,
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  assert.deepEqual(harness.editor.getCursor(), { line: 0, ch: 0 });
  assert.deepEqual(notices, [
    "Task changed since search — landed near line 1",
  ]);
});

test("handleGoToTaskUri clamps an out-of-range line without a notice when ref is absent", async () => {
  const harness = createGoToTaskHarness({ stubOpen: true });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "99",
    }),
    true,
  );
  assert.deepEqual(harness.editor.getCursor(), { line: 1, ch: 0 });
  assert.deepEqual(notices, []);
});

test("handleGoToTaskUri reuses a leaf that already shows the note", async () => {
  const same = "- [ ] #task Same ^same";
  const digest = await helpers.bobLineDigest(same);
  const harness = createGoToTaskHarness({
    content: same,
    startOnTarget: false,
    originFile: { path: "other.md", basename: "other", extension: "md" },
    originEditor: new TransactionEditor("- [ ] #task Origin", { line: 0, ch: 3 }),
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  assert.equal(harness.activateCalls.length, 1);
  assert.deepEqual(harness.openFileCalls, []);
  assert.deepEqual(harness.editor.getCursor(), { line: 0, ch: 0 });
});

test("handleGoToTaskUri switches a Reading-view leaf to editing", async () => {
  const same = "- [ ] #task Same ^same";
  const digest = await helpers.bobLineDigest(same);
  const harness = createGoToTaskHarness({
    content: same,
    leafMode: "preview",
    leafSource: false,
    stubOpen: true,
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  assert.equal(harness.setViewStateCalls.length, 1);
  assert.equal(harness.setViewStateCalls[0].state.mode, "source");
  assert.equal(harness.setViewStateCalls[0].state.source, false);
  assert.ok(harness.editor.focusCalls >= 1);
});

test("handleGoToTaskUri records a jump from the prior cursor and none without one", async () => {
  const same = "- [ ] #task Same ^same";
  const digest = await helpers.bobLineDigest(same);
  const originFile = {
    path: "other.md",
    basename: "other",
    extension: "md",
  };
  const originEditor = new TransactionEditor("- [ ] #task Origin", {
    line: 2,
    ch: 4,
  });
  const withOrigin = createGoToTaskHarness({
    content: same,
    startOnTarget: false,
    originFile,
    originEditor,
    stubOpen: true,
  });
  notices.length = 0;
  assert.equal(
    await withOrigin.plugin.handleGoToTaskUri({
      path: `${withOrigin.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  await withOrigin.plugin.vimJumpHistoryChain;
  assert.equal(helpers.getVimJumpHistoryLength(withOrigin.plugin.vimJumpHistory), 2);
  assert.deepEqual(withOrigin.plugin.vimJumpHistory.entries[0], {
    path: "other.md",
    line: 2,
    ch: 4,
  });
  assert.equal(withOrigin.plugin.vimJumpHistory.entries[1].path, "dev.md");
  assert.equal(withOrigin.plugin.vimJumpHistory.entries[1].ch, 0);

  const withoutOrigin = createGoToTaskHarness({
    content: same,
    startOnTarget: false,
    stubOpen: true,
  });
  assert.equal(
    await withoutOrigin.plugin.handleGoToTaskUri({
      path: `${withoutOrigin.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  await withoutOrigin.plugin.vimJumpHistoryChain;
  assert.equal(
    helpers.getVimJumpHistoryLength(withoutOrigin.plugin.vimJumpHistory),
    0,
  );
});

test("handleGoToTaskUri never writes the vault or advances the walk", async () => {
  const same = "- [ ] #task Same ^same";
  const digest = await helpers.bobLineDigest(same);
  const harness = createGoToTaskHarness({ content: same, stubOpen: true });
  const before = harness.editor.getValue();
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri({
      path: `${harness.vaultBase}/dev.md`,
      line: "1",
      ref: `1:${digest}`,
    }),
    true,
  );
  assert.equal(harness.editor.getValue(), before);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.editor.setLineCalls, []);
  assert.deepEqual(harness.walkCalls, []);
});

test("handleGoToTaskUri reports when the note cannot be opened", async () => {
  const harness = createGoToTaskHarness({
    stubOpen: true,
    openResult: false,
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleGoToTaskUri(harness.params()),
    false,
  );
  assert.ok(
    harness.openFileCalls.some(
      (call) =>
        call &&
        call.failureNotice === "Bob Go To: could not open dev",
    ),
  );
});

test("focusTaskMoveDestination still lands without switching Reading view", async () => {
  const editor = new TransactionEditor(
    ["- [ ] #task Existing ^existing", "- [ ] #task Moved ^moved"].join("\n"),
    { line: 0, ch: 0 },
  );
  const destinationFile = { path: "Area.md", basename: "Area", extension: "md" };
  const plugin = new NavigationHotkeysPlugin();
  const setViewStateCalls = [];
  plugin.captureActiveFilePosition = () => true;
  plugin.openMarkdownFileWithLeafReuse = async () => true;
  plugin.getActiveMarkdownView = () => ({ file: destinationFile, editor });
  plugin.findMarkdownLeafByPath = () => ({
    setViewState: async (state) => {
      setViewStateCalls.push(state);
    },
    getViewState: () => ({ state: { mode: "preview", source: false } }),
  });
  const result = await plugin.focusTaskMoveDestination(destinationFile, {
    line: 1,
    text: "- [ ] #task Moved ^moved",
    blockId: "moved",
  });
  assert.equal(result, true);
  assert.deepEqual(editor.getCursor(), { line: 1, ch: 0 });
  assert.deepEqual(setViewStateCalls, []);
});

test("onload registers both read-only navigation protocols when available", () => {
  const registrations = [];
  const plugin = stubOnloadPlugin({
    registerObsidianProtocolHandler: (name, handler) => {
      registrations.push({ name, handler });
    },
  });
  plugin.onload();
  assert.deepEqual(
    registrations.map((registration) => registration.name),
    ["bob-goto-task", "bob-open-notes"],
  );
  assert.ok(registrations.every((registration) => typeof registration.handler === "function"));
});

test("onload skips protocol registration when the API is missing", () => {
  const plugin = stubOnloadPlugin();
  assert.equal(typeof plugin.registerObsidianProtocolHandler, "undefined");
  assert.doesNotThrow(() => plugin.onload());
});

test("registered protocol handler forwards params to handleGoToTaskUri", async () => {
  const seen = [];
  const registrations = [];
  const plugin = stubOnloadPlugin({
    registerObsidianProtocolHandler: (name, handler) => {
      registrations.push({ name, handler });
    },
    handleGoToTaskUri: async (params) => {
      seen.push(params);
      return true;
    },
  });
  plugin.onload();
  const params = { path: "/Users/me/bob/dev.md", line: "1" };
  registrations[0].handler(params);
  await Promise.resolve();
  assert.deepEqual(seen, [params]);
});

test("handleGoToTaskUri maps a path through realpath when prefixes differ", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-goto-uri-"));
  const realVault = path.join(root, "vault");
  const linkVault = path.join(root, "link");
  fs.mkdirSync(realVault);
  fs.writeFileSync(path.join(realVault, "dev.md"), "- [ ] #task Same\n");
  fs.symlinkSync(realVault, linkVault);
  try {
    const same = "- [ ] #task Same";
    const digest = await helpers.bobLineDigest(same);
    const harness = createGoToTaskHarness({
      vaultBase: fs.realpathSync(realVault),
      content: same,
      stubOpen: true,
    });
    notices.length = 0;
    assert.equal(
      await harness.plugin.handleGoToTaskUri({
        path: path.join(linkVault, "dev.md"),
        line: "1",
        ref: `1:${digest}`,
      }),
      true,
    );
    assert.deepEqual(harness.editor.getCursor(), { line: 0, ch: 0 });
    assert.equal(notices.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
