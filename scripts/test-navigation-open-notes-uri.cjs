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

  for (const entry of options.files || []) {
    const file = entry.file || makeFile(entry.path, entry.extension || "md");
    files.set(file.path, file);
    contents.set(file.path, entry.content || "");
    if (file.extension === "md") {
      editors.set(file.path, makeEditor(entry.content || ""));
    }
  }

  const makeLeaf = (file = null) => {
    const view = {
      file,
      editor: file && file.extension === "md" ? editors.get(file.path) || makeEditor("") : null,
      getState: () => ({ mode: "source" }),
    };
    const leaf = {
      view,
      openFile: async (target, state) => {
        openCalls.push({ path: target.path, state, leaf });
        if (options.rejectOpenPath === target.path) {
          throw new Error("open failed");
        }
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
    return leaf;
  };

  const activeLeaf = makeLeaf(options.activeFile || null);
  const workspace = {
    activeLeaf,
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
    getLeaf: (type) => {
      assert.equal(type, "tab");
      return makeLeaf(null);
    },
    revealLeaf: async () => {},
    setActiveLeaf: (leaf) => {
      workspace.activeLeaf = leaf;
    },
  };

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
    leaves,
    focusCalls,
    registrations,
    workspace,
    emit,
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
