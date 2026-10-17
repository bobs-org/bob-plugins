const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

function makeFile(vaultPath, extension = "md", basename = null) {
  return {
    path: vaultPath,
    extension,
    basename: basename || path.posix.basename(vaultPath, `.${extension}`),
    stat: {},
  };
}

function makeEditor(content = "") {
  const dispatches = [];
  const value = {
    content,
    cursors: [],
    focusCalls: 0,
    getValue() {
      return this.content;
    },
    getCursor() {
      return { line: 0, ch: 0 };
    },
    setCursor(line, ch) {
      this.cursors.push({ line, ch });
    },
    focus() {
      this.focusCalls += 1;
    },
  };
  const lines = () => String(value.content || "").split(/\r?\n/);
  value.cm = {
    state: {
      get doc() {
        const current = lines();
        return {
          lines: current.length,
          line(number) {
            const index = Math.max(0, Math.min(current.length - 1, number - 1));
            const from = current
              .slice(0, index)
              .reduce((sum, line) => sum + line.length + 1, 0);
            return { from, to: from + String(current[index] || "").length };
          },
        };
      },
    },
    dispatch(transaction) {
      dispatches.push(transaction);
    },
    dispatches,
  };
  return value;
}

function createBobOpenNotesHarness(options = {}) {
  const vaultBase = options.vaultBase || "/Users/me/bob";
  const files = new Map();
  const contents = new Map();
  const editors = new Map();
  const writes = [];
  const listeners = new Map();
  const openCalls = [];
  const leaves = [];
  const focusCalls = [];
  const registrations = [];
  const loadIfDeferredCalls = [];

  for (const entry of options.files || []) {
    const file = entry.file || makeFile(entry.path, entry.extension || "md");
    files.set(file.path, file);
    contents.set(file.path, entry.content || "");
    if (file.extension === "md") {
      editors.set(file.path, makeEditor(entry.content || ""));
    }
  }

  const tabGroup = { children: [] };
  const leftSplit = { children: [] };
  const rightSplit = { children: [] };
  const rootSplit = tabGroup;
  let mostRecentMainLeaf = null;

  const isMainAreaLeaf = (leaf) => {
    if (!leaf || typeof leaf.getRoot !== "function") return true;
    const root = leaf.getRoot();
    return root !== leftSplit && root !== rightSplit;
  };

  const makeLeaf = (file = null, viewType = null, extras = {}) => {
    const parent = extras.parent || tabGroup;
    const deferred = Boolean(extras.deferred);
    const deferredType =
      extras.deferredType ||
      (file && file.extension === "md" ? "markdown" : file ? file.extension : "empty");
    const deferredPath = extras.deferredPath || (file && file.path) || null;
    const view = {
      file: deferred ? null : file,
      editor:
        !deferred && file && file.extension === "md"
          ? editors.get(file.path) || makeEditor("")
          : null,
      getState: () => ({ mode: "source" }),
      getViewType() {
        if (viewType) return viewType;
        if (this.file) {
          return this.file.extension === "md" ? "markdown" : this.file.extension;
        }
        return deferred ? deferredType : "empty";
      },
    };
    const leaf = {
      view,
      parent,
      isDeferred: deferred,
      getRoot() {
        if (parent === leftSplit || parent === rightSplit) return parent;
        return rootSplit;
      },
      getViewState() {
        if (leaf.isDeferred) {
          return { type: deferredType, state: { file: deferredPath } };
        }
        return {
          type: view.getViewType(),
          state: { file: view.file && view.file.path },
        };
      },
      loadIfDeferred: async () => {
        loadIfDeferredCalls.push(leaf);
        if (!leaf.isDeferred) return;
        leaf.isDeferred = false;
        view.file = file;
        view.editor =
          file && file.extension === "md"
            ? editors.get(file.path) || makeEditor(contents.get(file.path) || "")
            : null;
        if (view.editor && file && !editors.has(file.path)) {
          editors.set(file.path, view.editor);
        }
      },
      detach() {
        const index = parent.children.indexOf(leaf);
        if (index !== -1) parent.children.splice(index, 1);
      },
      openFile: async (target, state) => {
        openCalls.push({ path: target.path, state, leaf });
        if (options.rejectOpenPath === target.path) {
          throw new Error("open failed");
        }
        leaf.isDeferred = false;
        view.file = target;
        view.editor = target.extension === "md"
          ? editors.get(target.path) || makeEditor(contents.get(target.path) || "")
          : null;
        if (view.editor && !editors.has(target.path)) {
          editors.set(target.path, view.editor);
        }
      },
    };
    leaves.push(leaf);
    if (!extras.skipParentInsert) {
      parent.children.push(leaf);
    }
    return leaf;
  };

  const activeLeaf = options.skipDefaultLeaf
    ? null
    : makeLeaf(options.activeFile || null, options.activeViewType || null);
  if (activeLeaf && isMainAreaLeaf(activeLeaf)) {
    mostRecentMainLeaf = activeLeaf;
  }
  const workspace = {
    activeLeaf,
    leftSplit,
    rightSplit,
    rootSplit,
    onLayoutReady: (callback) => callback && callback(),
    getActiveFile: () => workspace.activeLeaf?.view?.file || null,
    on: () => ({}),
    iterateAllLeaves: (callback) => leaves.forEach(callback),
    getLeavesOfType: (type) =>
      leaves.filter((leaf) => {
        if (type === "markdown") return leaf.view.file?.extension === "md";
        if (type === "pdf") return leaf.view.file?.extension === "pdf";
        return false;
      }),
    getMostRecentLeaf: () => {
      if (workspace.activeLeaf && isMainAreaLeaf(workspace.activeLeaf)) {
        return workspace.activeLeaf;
      }
      return mostRecentMainLeaf;
    },
    getLeaf: (type) => {
      assert.equal(type, "tab");
      const leaf = makeLeaf(null);
      const createdIndex = tabGroup.children.indexOf(leaf);
      if (createdIndex !== -1) tabGroup.children.splice(createdIndex, 1);
      const activeIndex = tabGroup.children.indexOf(workspace.activeLeaf);
      const insertAt = activeIndex === -1 ? tabGroup.children.length : activeIndex + 1;
      tabGroup.children.splice(insertAt, 0, leaf);
      return leaf;
    },
    revealLeaf: async () => {},
    setActiveLeaf: (leaf) => {
      workspace.activeLeaf = leaf;
      if (leaf && isMainAreaLeaf(leaf)) {
        mostRecentMainLeaf = leaf;
      }
    },
  };
  if (options.createLeafInParentThrows) {
    workspace.createLeafInParent = () => {
      throw new Error("createLeafInParent failed");
    };
  } else if (!options.omitCreateLeafInParent) {
    workspace.createLeafInParent = (parent, index) => {
      const leaf = makeLeaf(null, null, { parent, skipParentInsert: true });
      parent.children.splice(index, 0, leaf);
      return leaf;
    };
  }

  const vault = {
    adapter: { getBasePath: () => vaultBase },
    getAbstractFileByPath: (vaultPath) => files.get(vaultPath) || null,
    getFiles: () => [...files.values()],
    getMarkdownFiles: () => [...files.values()].filter((file) => file.extension === "md"),
    cachedRead: async (file) => {
      if (!contents.has(file.path)) throw new Error("missing cached note");
      return contents.get(file.path);
    },
    modify: async (...args) => writes.push(["modify", ...args]),
    process: async (...args) => writes.push(["process", ...args]),
    on: (eventName, callback) => {
      const ref = { eventName, callback };
      const refs = listeners.get(eventName) || new Set();
      refs.add(ref);
      listeners.set(eventName, refs);
      return ref;
    },
    offref: (ref) => listeners.get(ref.eventName)?.delete(ref),
  };
  const emit = (eventName, file) => {
    for (const ref of [...(listeners.get(eventName) || [])]) {
      ref.callback(file);
    }
  };

  const plugin = new NavigationHotkeysPlugin();
  plugin.app = { vault, workspace };
  plugin.register = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.isMarkdownFile = (file) => Boolean(file && file.extension === "md");
  plugin.getVaultBasePath = () => vaultBase;
  plugin.getOpenMarkdownEditorForPath = (filePath) => editors.get(filePath) || null;
  plugin.findMarkdownLeafByPath = (filePath) =>
    leaves.find((leaf) => leaf.view.file?.path === filePath && leaf.view.file.extension === "md") || null;
  plugin.createNewTabLeaf = () => workspace.getLeaf("tab");
  plugin.activateWorkspaceLeaf = async (leaf) => {
    workspace.setActiveLeaf(leaf);
    return true;
  };
  plugin.focusTaskAnchor = async (file, anchor, config) => {
    focusCalls.push({ file, anchor, config });
    const leaf = leaves.find((candidate) => candidate.view.file?.path === file.path);
    if (!leaf) return false;
    workspace.setActiveLeaf(leaf);
    return true;
  };
  plugin.getActiveMarkdownView = () => {
    const leaf = workspace.activeLeaf;
    return leaf?.view?.file?.extension === "md"
      ? { file: leaf.view.file, editor: leaf.view.editor }
      : null;
  };
  plugin.captureGoToTaskJumpContext = () => ({ token: 1, origin: { path: "source.md", line: 2, ch: 4 } });
  plugin.getVaultBasePath = () => vaultBase;
  plugin.registerObsidianProtocolHandler = (name, handler) => registrations.push({ name, handler });
  plugin.bobOpenNotesLandingFlashDurationMs = () => 5;

  return {
    plugin,
    files,
    contents,
    editors,
    writes,
    listeners,
    openCalls,
    loadIfDeferredCalls,
    tabGroup,
    leaves,
    focusCalls,
    registrations,
    workspace,
    vault,
    emit,
    makeLeaf,
  };
}

function params(notes, extra = {}) {
  const result = { count: String(notes.length), ...extra };
  notes.forEach((note, index) => {
    const key = index + 1;
    result[`path${key}`] = note.path;
    if (note.line != null) result[`line${key}`] = String(note.line);
    if (note.ref != null) result[`ref${key}`] = note.ref;
    if (note.block != null) result[`block${key}`] = note.block;
  });
  return result;
}

test("parseBobOpenNotesParams accepts indexed entries and ignores unknown keys", () => {
  const parsed = helpers.parseBobOpenNotesParams({
    count: "2",
    path1: "/Users/me/bob/a note.md",
    line1: "12",
    ref1: "12:35a733bd",
    block1: "task-1",
    path2: "/Users/me/bob/b.md",
    pane: "tab",
    total: "4",
  });
  assert.deepEqual(parsed, {
    count: 2,
    total: 4,
    notes: [
      { path: "/Users/me/bob/a note.md", line: 12, ref: "12:35a733bd", block: "task-1" },
      { path: "/Users/me/bob/b.md", line: null, ref: null, block: null },
    ],
  });
});

test("parseBobOpenNotesParams rejects every malformed URI field", () => {
  const valid = { count: "1", path1: "/Users/me/bob/a.md" };
  const invalid = [
    {},
    { ...valid, count: "0" },
    { ...valid, count: "9" },
    { ...valid, count: "1,2" },
    { count: "1" },
    { ...valid, path1: "relative/a.md" },
    { ...valid, path1: "/bad\0path.md" },
    { ...valid, total: "0" },
    { ...valid, total: "2.5" },
    { ...valid, count: "2", path2: "/Users/me/bob/b.md", total: "1" },
    { ...valid, line1: "0" },
    { ...valid, line1: "1.5" },
    { ...valid, ref1: "1:35a733bd" },
    { ...valid, line1: "1", ref1: "35a733bd" },
    { ...valid, line1: "1", ref1: "1:35A733BD" },
    { ...valid, block1: "bad/id" },
    { ...valid, path1: ["/Users/me/bob/a.md", "/Users/me/bob/b.md"] },
  ];
  for (const candidate of invalid) {
    assert.equal(helpers.parseBobOpenNotesParams(candidate), null, JSON.stringify(candidate));
  }
});

test("invalid batches show one notice and open nothing", async () => {
  const harness = createBobOpenNotesHarness({
    files: [{ path: "a.md", content: "first" }],
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri({
      count: "1",
      path1: "/Users/me/bob/a.md",
      line1: "0",
    }),
    false,
  );
  assert.deepEqual(notices, ["Bob Open: invalid link"]);
  assert.deepEqual(harness.openCalls, []);
});

test("path mapping follows a symlink realpath into the vault", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bob-open-notes-path-"));
  const vaultBase = path.join(temp, "vault");
  fs.mkdirSync(vaultBase);
  fs.writeFileSync(path.join(vaultBase, "real.md"), "line");
  const alias = path.join(temp, "alias.md");
  fs.symlinkSync(path.join(vaultBase, "real.md"), alias);
  try {
    const harness = createBobOpenNotesHarness({
      vaultBase,
      files: [{ path: "real.md", content: "line" }],
    });
    notices.length = 0;
    assert.equal(
      await harness.plugin.handleBobOpenNotesUri(params([{ path: alias }])),
      true,
    );
    assert.equal(harness.openCalls[0].path, "real.md");
    assert.deepEqual(notices, []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("new-tab policy reuses existing tabs and the active empty tab, keeping order and primary active", async () => {
  const harness = createBobOpenNotesHarness({
    files: [
      { path: "first.md", content: "- [ ] #task First" },
      { path: "second.md", content: "- [ ] #task Second" },
      { path: "third.md", content: "- [ ] #task Third" },
    ],
  });
  const existingSecond = harness.workspace.getLeaf("tab");
  existingSecond.view.file = harness.files.get("second.md");
  existingSecond.view.editor = harness.editors.get("second.md");
  notices.length = 0;

  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([
        { path: "/Users/me/bob/first.md", line: 1 },
        { path: "/Users/me/bob/second.md", line: 1 },
        { path: "/Users/me/bob/third.md", line: 1 },
      ]),
    ),
    true,
  );

  assert.deepEqual(harness.openCalls.map((call) => call.path), ["first.md", "third.md"]);
  assert.deepEqual(
    harness.openCalls.map((call) => call.path),
    ["first.md", "third.md"],
    "the pre-opened second note was reused",
  );
  assert.equal(harness.openCalls[0].leaf, harness.leaves[0], "the empty active tab is reused for entry one");
  assert.deepEqual(
    harness.leaves.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["first.md", "second.md", "third.md"],
  );
  assert.equal(harness.workspace.activeLeaf.view.file.path, "first.md");
  assert.equal(harness.focusCalls.length, 1);
  assert.deepEqual(notices, []);
});

test("an absent or outside entry fails independently and a PDF opens without landing", async () => {
  const pdf = makeFile("book.pdf", "pdf");
  const harness = createBobOpenNotesHarness({
    files: [{ file: pdf, path: "book.pdf", extension: "pdf", content: "" }],
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([
        { path: "/tmp/outside.md" },
        { path: "/Users/me/bob/missing.md" },
        { path: "/Users/me/bob/book.pdf" },
      ]),
    ),
    true,
  );
  assert.deepEqual(harness.openCalls.map((call) => call.path), ["book.pdf"]);
  assert.equal(harness.focusCalls.length, 0);
  assert.equal(harness.workspace.activeLeaf.view.file.path, "book.pdf");
  assert.deepEqual(notices, [
    "Bob Open: /tmp/outside.md is outside this vault",
    "Bob Open: missing.md not found",
  ]);
});

test("a resolved note that is not open waits until its captured digest is cached", async () => {
  const stale = "# Today\n- [ ] #task Before";
  const currentLine = "- [ ] #task After";
  const current = `# Today\n${currentLine}`;
  const harness = createBobOpenNotesHarness({
    files: [{ path: "day.md", content: stale }],
  });
  harness.editors.delete("day.md");
  const ref = `2:${await helpers.bobLineDigest(currentLine)}`;
  const delayed = setTimeout(() => {
    harness.contents.set("day.md", current);
    harness.emit("modify", harness.files.get("day.md"));
  }, 60);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/day.md", line: 2, ref }]),
    ),
    true,
  );
  clearTimeout(delayed);
  assert.equal(harness.focusCalls[0].anchor.text, currentLine);
  assert.deepEqual(notices, []);
});

test("a per-entry open failure does not prevent later notes from opening", async () => {
  const harness = createBobOpenNotesHarness({
    files: [
      { path: "broken.md", content: "broken" },
      { path: "good.md", content: "good" },
    ],
    rejectOpenPath: "broken.md",
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([
        { path: "/Users/me/bob/broken.md" },
        { path: "/Users/me/bob/good.md" },
      ]),
    ),
    true,
  );
  assert.deepEqual(harness.openCalls.map((call) => call.path), ["broken.md", "good.md"]);
  assert.deepEqual(notices, ["Bob Open: could not open broken"]);
  assert.equal(harness.workspace.activeLeaf.view.file.path, "good.md");
});

test("waits for a newly created vault file and a late visible line digest", async () => {
  const harness = createBobOpenNotesHarness();
  const lateFile = makeFile("late.md");
  const delayed = setTimeout(() => {
    harness.files.set("late.md", lateFile);
    harness.contents.set("late.md", "# New\n- [ ] #task Land here");
    harness.editors.set("late.md", makeEditor("# New\n- [ ] #task Land here"));
    harness.emit("create", lateFile);
  }, 60);
  const lateLine = "- [ ] #task Land here";
  const lateRef = `2:${await helpers.bobLineDigest(lateLine)}`;
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/late.md", line: 2, ref: lateRef }]),
    ),
    true,
  );
  clearTimeout(delayed);
  assert.equal(harness.openCalls[0].path, "late.md");
  assert.equal(harness.focusCalls[0].anchor.line, 1);
  assert.deepEqual(notices, []);
});

test("re-finds a moved digest on any line, including prose and Pomodoro rows", async () => {
  const line = "- [ ] (10:00 - 10:25) — WRITING";
  const ref = `2:${await helpers.bobLineDigest(line)}`;
  const harness = createBobOpenNotesHarness({
    files: [{ path: "day.md", content: `# Today\n${line}` }],
  });
  harness.contents.set("day.md", `# Inserted\n# Today\n${line}`);
  harness.editors.get("day.md").content = `# Inserted\n# Today\n${line}`;
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/day.md", line: 2, ref }]),
    ),
    true,
  );
  assert.equal(harness.focusCalls[0].anchor.line, 2);
  assert.deepEqual(notices, []);
});

test("deadline fallback opens near the planned line and reports a changed capture", async () => {
  const harness = createBobOpenNotesHarness({
    files: [{ path: "changed.md", content: "# Current\n- [ ] #task Different" }],
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/changed.md", line: 2, ref: "2:deadbeef" }]),
    ),
    true,
  );
  assert.equal(harness.focusCalls[0].anchor.line, 1);
  assert.deepEqual(notices, ["Task changed since capture — landed near line 2"]);
});

test("truncation reports how many of the full list opened", async () => {
  const harness = createBobOpenNotesHarness({ files: [{ path: "a.md", content: "a" }] });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/a.md" }], { total: "9" }),
    ),
    true,
  );
  assert.deepEqual(notices, ["Bob Open: opened 1 of 9 notes"]);
});

test("serializes quick URLs and leaves the later URL active", async () => {
  const harness = createBobOpenNotesHarness({
    files: [
      { path: "one.md", content: "- [ ] #task One" },
      { path: "two.md", content: "- [ ] #task Two" },
    ],
  });
  let release;
  const firstGate = new Promise((resolve) => { release = resolve; });
  const originalOpen = harness.plugin.openBobOpenNotesEntry.bind(harness.plugin);
  const seen = [];
  harness.plugin.openBobOpenNotesEntry = async (...args) => {
    const path = args[0].vaultPath;
    seen.push(`start:${path}`);
    if (path === "one.md") await firstGate;
    const result = await originalOpen(...args);
    seen.push(`end:${path}`);
    return result;
  };
  notices.length = 0;
  const one = harness.plugin.enqueueBobOpenNotesUri(
    params([{ path: "/Users/me/bob/one.md", line: 1 }]),
  );
  const two = harness.plugin.enqueueBobOpenNotesUri(
    params([{ path: "/Users/me/bob/two.md", line: 1 }]),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["start:one.md"]);
  release();
  await Promise.all([one, two]);
  assert.deepEqual(seen, [
    "start:one.md",
    "end:one.md",
    "start:two.md",
    "end:two.md",
  ]);
  assert.equal(harness.workspace.activeLeaf.view.file.path, "two.md");
});

test("primary landing flashes briefly, secondary landings do not, and the handler is read-only", async () => {
  const firstLine = "- [ ] #task Primary";
  const secondLine = "- [ ] #task Secondary";
  const firstRef = `1:${await helpers.bobLineDigest(firstLine)}`;
  const secondRef = `1:${await helpers.bobLineDigest(secondLine)}`;
  const harness = createBobOpenNotesHarness({
    files: [
      { path: "first.md", content: firstLine },
      { path: "second.md", content: secondLine },
    ],
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([
        { path: "/Users/me/bob/first.md", line: 1, ref: firstRef },
        { path: "/Users/me/bob/second.md", line: 1, ref: secondRef },
      ]),
    ),
    true,
  );

  const flashEffects = (editor) =>
    editor.cm.dispatches
      .map((transaction) => transaction.effects)
      .filter((effect) => effect && effect.is && effect.is(helpers.bobOpenNotesLandingFlashEffect));
  const primary = harness.editors.get("first.md");
  const secondary = harness.editors.get("second.md");
  assert.equal(flashEffects(primary).length, 1);
  assert.equal(flashEffects(primary)[0].value.line, 0);
  assert.equal(flashEffects(secondary).length, 0);
  assert.deepEqual(secondary.cursors, [{ line: 0, ch: 0 }]);
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.focusCalls.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(flashEffects(primary).length, 2);
  assert.equal(flashEffects(primary)[1].value.clear, true);
  const field = helpers.bobOpenNotesLandingFlashField;
  const document = { lines: 2, line: (number) => ({ from: number - 1 }) };
  let decoration = field.create();
  decoration = field.update(decoration, {
    effects: [flashEffects(primary)[0]],
    docChanged: false,
    state: { doc: document },
  });
  assert.equal(decoration.ranges[0].spec.class, "bob-landing-flash");
  decoration = field.update(decoration, {
    effects: [flashEffects(primary)[1]],
    docChanged: false,
    state: { doc: document },
  });
  assert.strictEqual(decoration, field.create());
  assert.equal(primary.content, firstLine, "the flash does not edit note text");
  assert.deepEqual(notices, []);
});

test("onload registers bob-open-notes beside bob-goto-task", () => {
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
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  const protocols = [];
  plugin.registerObsidianProtocolHandler = (name, handler) => protocols.push({ name, handler });
  plugin.onload();
  assert.deepEqual(protocols.map((protocol) => protocol.name), ["bob-goto-task", "bob-open-notes"]);

  let received = null;
  plugin.enqueueBobOpenNotesUri = async (value) => { received = value; };
  const raw = { count: "1", path1: "/Users/me/bob/a.md" };
  protocols[1].handler(raw);
  assert.equal(received, raw);
});

test("a non-file sidebar view is not reused as an empty tab", async () => {
  const harness = createBobOpenNotesHarness({
    files: [{ path: "first.md", content: "- [ ] #task First" }],
  });
  const mainLeaf = harness.workspace.activeLeaf;
  const sidebar = harness.makeLeaf(null, "file-explorer", {
    parent: harness.workspace.leftSplit,
  });
  harness.workspace.setActiveLeaf(sidebar);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/first.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(sidebar.view.file, null, "the sidebar view stays untouched");
  assert.equal(sidebar.view.getViewType(), "file-explorer");
  assert.notEqual(harness.openCalls[0].leaf, sidebar);
  assert.equal(harness.openCalls[0].path, "first.md");
  assert.equal(harness.openCalls[0].leaf.parent, harness.tabGroup);
  assert.equal(
    harness.tabGroup.children[harness.tabGroup.children.length - 1],
    harness.openCalls[0].leaf,
  );
  assert.equal(mainLeaf.view.getViewType(), "empty");
  assert.deepEqual(notices, []);
});

test("a true empty tab is reused for the first entry", async () => {
  const harness = createBobOpenNotesHarness({
    files: [{ path: "first.md", content: "- [ ] #task First" }],
  });
  assert.equal(harness.workspace.activeLeaf.view.getViewType(), "empty");
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/first.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(harness.openCalls[0].leaf, harness.leaves[0]);
  assert.equal(harness.workspace.activeLeaf.view.file.path, "first.md");
  assert.deepEqual(notices, []);
});

test("three new tabs follow entry order in the tab strip", async () => {
  const source = makeFile("source.md");
  const harness = createBobOpenNotesHarness({
    activeFile: source,
    files: [
      { file: source, path: "source.md", content: "source" },
      { path: "first.md", content: "- [ ] #task First" },
      { path: "second.md", content: "- [ ] #task Second" },
      { path: "third.md", content: "- [ ] #task Third" },
    ],
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([
        { path: "/Users/me/bob/first.md", line: 1 },
        { path: "/Users/me/bob/second.md", line: 1 },
        { path: "/Users/me/bob/third.md", line: 1 },
      ]),
    ),
    true,
  );
  assert.deepEqual(
    harness.tabGroup.children.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["source.md", "first.md", "second.md", "third.md"],
  );
  assert.deepEqual(harness.openCalls.map((call) => call.path), [
    "first.md",
    "second.md",
    "third.md",
  ]);
  assert.deepEqual(notices, []);
});

test("two tabs of the same note reuse the first matching leaf", async () => {
  const harness = createBobOpenNotesHarness({
    files: [
      { path: "first.md", content: "- [ ] #task First" },
      { path: "other.md", content: "other" },
    ],
  });
  const firstFile = harness.files.get("first.md");
  const firstTab = harness.workspace.getLeaf("tab");
  firstTab.view.file = firstFile;
  firstTab.view.editor = harness.editors.get("first.md");
  const secondTab = harness.workspace.getLeaf("tab");
  secondTab.view.file = firstFile;
  secondTab.view.editor = harness.editors.get("first.md");
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/first.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(harness.openCalls.length, 0, "the already-open first tab is reused");
  assert.equal(harness.workspace.activeLeaf, firstTab);
  assert.notEqual(harness.workspace.activeLeaf, secondTab);
  assert.deepEqual(notices, []);
});

test("a missing file does not scan vault lists when getAbstractFileByPath exists", async () => {
  const harness = createBobOpenNotesHarness({
    files: [{ path: "present.md", content: "ok" }],
  });
  let getFilesCalls = 0;
  let getMarkdownCalls = 0;
  const originalGetFiles = harness.vault.getFiles.bind(harness.vault);
  const originalGetMarkdown = harness.vault.getMarkdownFiles.bind(harness.vault);
  harness.vault.getFiles = () => {
    getFilesCalls += 1;
    return originalGetFiles();
  };
  harness.vault.getMarkdownFiles = () => {
    getMarkdownCalls += 1;
    return originalGetMarkdown();
  };
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/missing.md" }]),
    ),
    false,
  );
  assert.equal(getFilesCalls, 0);
  assert.equal(getMarkdownCalls, 0);
  assert.deepEqual(notices, ["Bob Open: missing.md not found"]);
});

test("new tabs append at the far right when the middle tab is active", async () => {
  const a = makeFile("a.md");
  const b = makeFile("b.md");
  const c = makeFile("c.md");
  const harness = createBobOpenNotesHarness({
    skipDefaultLeaf: true,
    files: [
      { file: a, path: "a.md", content: "a" },
      { file: b, path: "b.md", content: "b" },
      { file: c, path: "c.md", content: "c" },
      { path: "new1.md", content: "- [ ] #task New one" },
      { path: "new2.md", content: "- [ ] #task New two" },
    ],
  });
  harness.makeLeaf(a);
  const middle = harness.makeLeaf(b);
  harness.makeLeaf(c);
  harness.workspace.setActiveLeaf(middle);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([
        { path: "/Users/me/bob/new1.md", line: 1 },
        { path: "/Users/me/bob/new2.md", line: 1 },
      ]),
    ),
    true,
  );
  assert.deepEqual(
    harness.tabGroup.children.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["a.md", "b.md", "c.md", "new1.md", "new2.md"],
  );
  assert.equal(harness.workspace.activeLeaf.view.file.path, "new1.md");
  assert.deepEqual(notices, []);
});

test("a reused tab stays put while a new one is appended", async () => {
  const a = makeFile("a.md");
  const x = makeFile("x.md");
  const c = makeFile("c.md");
  const harness = createBobOpenNotesHarness({
    skipDefaultLeaf: true,
    files: [
      { file: a, path: "a.md", content: "a" },
      { file: x, path: "x.md", content: "- [ ] #task X" },
      { file: c, path: "c.md", content: "c" },
      { path: "new.md", content: "- [ ] #task New" },
    ],
  });
  const first = harness.makeLeaf(a);
  const reused = harness.makeLeaf(x);
  harness.makeLeaf(c);
  harness.workspace.setActiveLeaf(first);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([
        { path: "/Users/me/bob/x.md", line: 1 },
        { path: "/Users/me/bob/new.md", line: 1 },
      ]),
    ),
    true,
  );
  assert.deepEqual(
    harness.tabGroup.children.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["a.md", "x.md", "c.md", "new.md"],
  );
  assert.equal(harness.openCalls.length, 1);
  assert.equal(harness.openCalls[0].path, "new.md");
  assert.equal(harness.workspace.activeLeaf, reused);
  assert.deepEqual(notices, []);
});

test("a deferred tab is reused and findMarkdownLeafByPath sees it", async () => {
  const first = makeFile("first.md");
  const harness = createBobOpenNotesHarness({
    skipDefaultLeaf: true,
    files: [{ file: first, path: "first.md", content: "- [ ] #task First" }],
  });
  const deferred = harness.makeLeaf(first, null, { deferred: true });
  harness.workspace.setActiveLeaf(deferred);
  const found = NavigationHotkeysPlugin.prototype.findMarkdownLeafByPath.call(
    harness.plugin,
    "first.md",
  );
  assert.equal(found, deferred);
  const pdf = makeFile("chart.pdf", "pdf");
  const deferredPdf = harness.makeLeaf(pdf, null, {
    deferred: true,
    deferredType: "pdf",
    parent: harness.workspace.leftSplit,
  });
  assert.equal(
    NavigationHotkeysPlugin.prototype.findMarkdownLeafByPath.call(
      harness.plugin,
      "chart.pdf",
    ),
    null,
    "a deferred non-markdown leaf is skipped",
  );
  assert.equal(deferredPdf.isDeferred, true);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/first.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(harness.openCalls.length, 0, "the deferred tab is reused");
  assert.deepEqual(harness.loadIfDeferredCalls, [deferred]);
  assert.equal(deferred.isDeferred, false);
  assert.equal(deferred.view.file, first);
  assert.deepEqual(
    harness.tabGroup.children.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["first.md"],
  );
  assert.equal(harness.workspace.activeLeaf, deferred);
  assert.deepEqual(notices, []);
});

test("a deferred sidebar leaf whose saved state names the note is not reused", async () => {
  const source = makeFile("source.md");
  const note = makeFile("note.md");
  const harness = createBobOpenNotesHarness({
    skipDefaultLeaf: true,
    files: [
      { file: source, path: "source.md", content: "source" },
      { file: note, path: "note.md", content: "- [ ] #task Note" },
    ],
  });
  const deferredSidebar = harness.makeLeaf(note, null, {
    deferred: true,
    parent: harness.workspace.leftSplit,
  });
  const mainSource = harness.makeLeaf(source);
  harness.workspace.setActiveLeaf(mainSource);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/note.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(deferredSidebar.isDeferred, true);
  assert.equal(harness.loadIfDeferredCalls.length, 0);
  assert.equal(harness.openCalls.length, 1);
  assert.equal(harness.openCalls[0].path, "note.md");
  assert.equal(harness.openCalls[0].leaf.parent, harness.tabGroup);
  assert.deepEqual(
    harness.tabGroup.children.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["source.md", "note.md"],
  );
  assert.deepEqual(notices, []);
});

test("a loaded main-area match beats an earlier loaded sidebar match", async () => {
  const note = makeFile("note.md");
  const other = makeFile("other.md");
  const harness = createBobOpenNotesHarness({
    skipDefaultLeaf: true,
    files: [
      { file: note, path: "note.md", content: "- [ ] #task Note" },
      { file: other, path: "other.md", content: "other" },
    ],
  });
  const loadedSidebar = harness.makeLeaf(note, null, {
    parent: harness.workspace.leftSplit,
  });
  const mainMatch = harness.makeLeaf(note);
  harness.makeLeaf(other);
  harness.workspace.setActiveLeaf(mainMatch);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/note.md" }]),
    ),
    true,
  );
  assert.equal(harness.openCalls.length, 0);
  assert.equal(harness.workspace.activeLeaf, mainMatch);
  assert.notEqual(harness.workspace.activeLeaf, loadedSidebar);
  assert.deepEqual(
    harness.tabGroup.children.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["note.md", "other.md"],
  );
  assert.deepEqual(notices, []);
});

test("a new tab goes to the end of the main group when a sidebar leaf is active", async () => {
  const a = makeFile("a.md");
  const b = makeFile("b.md");
  const harness = createBobOpenNotesHarness({
    skipDefaultLeaf: true,
    files: [
      { file: a, path: "a.md", content: "a" },
      { file: b, path: "b.md", content: "b" },
      { path: "new.md", content: "- [ ] #task New" },
    ],
  });
  harness.makeLeaf(a);
  const recentMain = harness.makeLeaf(b);
  harness.workspace.setActiveLeaf(recentMain);
  const sidebar = harness.makeLeaf(null, "file-explorer", {
    parent: harness.workspace.leftSplit,
  });
  harness.workspace.setActiveLeaf(sidebar);
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/new.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(sidebar.view.file, null);
  assert.equal(harness.openCalls[0].leaf.parent, harness.tabGroup);
  assert.deepEqual(
    harness.tabGroup.children.map((leaf) => leaf.view.file && leaf.view.file.path),
    ["a.md", "b.md", "new.md"],
  );
  assert.equal(harness.workspace.leftSplit.children.indexOf(harness.openCalls[0].leaf), -1);
  assert.deepEqual(notices, []);
});

test("falling back without createLeafInParent still opens a new tab", async () => {
  const source = makeFile("source.md");
  const harness = createBobOpenNotesHarness({
    omitCreateLeafInParent: true,
    activeFile: source,
    files: [
      { file: source, path: "source.md", content: "source" },
      { path: "first.md", content: "- [ ] #task First" },
    ],
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/first.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(harness.openCalls[0].path, "first.md");
  assert.equal(typeof harness.workspace.createLeafInParent, "undefined");
  assert.deepEqual(notices, []);
});

test("falling back when createLeafInParent throws still opens a new tab", async () => {
  const source = makeFile("source.md");
  const harness = createBobOpenNotesHarness({
    createLeafInParentThrows: true,
    activeFile: source,
    files: [
      { file: source, path: "source.md", content: "source" },
      { path: "first.md", content: "- [ ] #task First" },
    ],
  });
  notices.length = 0;
  assert.equal(
    await harness.plugin.handleBobOpenNotesUri(
      params([{ path: "/Users/me/bob/first.md", line: 1 }]),
    ),
    true,
  );
  assert.equal(harness.openCalls[0].path, "first.md");
  assert.deepEqual(notices, []);
});
