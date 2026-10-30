const assert = require("node:assert/strict");
const test = require("node:test");

const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
  noticeDurations,
} = require("./navigation-hotkeys-harness.cjs");

function makeFixture(options = {}) {
  const sourceFile = { path: "source.md", extension: "md", basename: "source" };
  const targetFile = options.targetFile || {
    path: "target.md",
    extension: "md",
    basename: "target",
  };
  const sourceEditor = { getValue: () => options.sourceText || "source editor text" };
  const targetEditor = { getValue: () => options.landingText || "target disk text" };
  const disk = new Map([
    [sourceFile.path, options.sourceDiskText || "source old disk text"],
    [targetFile.path, options.targetDiskText || "target disk text"],
  ]);
  const events = [];
  const leaf = {
    view: {
      file: sourceFile,
      editor: sourceEditor,
      save: async () => {
        events.push("save");
        if (options.saveMode === "reject") {
          throw new Error("save rejected");
        }
        if (options.saveMode !== "mismatch") {
          disk.set(sourceFile.path, sourceEditor.getValue());
        }
      },
      requestSave: { cancel: () => events.push("cancel") },
    },
    openFile: async (file) => {
      events.push(`open:${file.path}`);
      leaf.view = { file, editor: targetEditor };
    },
  };
  const workspace = {
    activeLeaf: leaf,
    getActiveViewOfType: () => leaf.view,
    getLeaf: () => leaf,
    getLeavesOfType: () => [],
  };
  const app = {
    workspace,
    vault: { read: async (file) => disk.get(file.path) },
  };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = app;
  plugin.getActiveMarkdownView = () => leaf.view;
  plugin.findMarkdownLeafByPath = () => null;
  plugin.activateWorkspaceLeaf = async () => false;
  return { app, disk, events, leaf, plugin, sourceEditor, sourceFile, targetEditor, targetFile, workspace };
}

function clearNotices() {
  notices.length = 0;
  noticeDurations.length = 0;
}

test("cross-note open saves and verifies editor text before opening, then cancels the debounce", async () => {
  clearNotices();
  const fixture = makeFixture();
  const opened = await helpers.openMarkdownFileWithLeafReuse(
    fixture.plugin,
    fixture.targetFile,
    "Could not open target",
  );

  assert.equal(opened, true);
  assert.deepEqual(fixture.events, ["save", "cancel", "open:target.md"]);
  assert.equal(fixture.disk.get("source.md"), "source editor text");
});

test("the navigation API gives ledger-tools the same guarded active-leaf open", async () => {
  clearNotices();
  const fixture = makeFixture();
  const api = helpers.createDependencyNavApi(fixture.plugin);

  assert.deepEqual(await api.openFileInActiveLeaf(fixture.targetFile), { ok: true });
  assert.deepEqual(fixture.events, ["save", "cancel", "open:target.md"]);
});

test("a rejected save keeps the source note open and stops navigation", async () => {
  clearNotices();
  const fixture = makeFixture({ saveMode: "reject" });
  const opened = await helpers.openMarkdownFileWithLeafReuse(
    fixture.plugin,
    fixture.targetFile,
    "Could not open target",
  );

  assert.equal(opened, false);
  assert.deepEqual(fixture.events, ["save"]);
  assert.match(notices[0], /Could not save source\.md before switching notes/);
});

test("a disk/editor mismatch keeps the source note open and stops navigation", async () => {
  clearNotices();
  const fixture = makeFixture({ saveMode: "mismatch" });
  const opened = await helpers.openMarkdownFileWithLeafReuse(
    fixture.plugin,
    fixture.targetFile,
    "Could not open target",
  );

  assert.equal(opened, false);
  assert.deepEqual(fixture.events, ["save", "cancel"]);
  assert.match(notices[0], /Could not save source\.md before switching notes/);
});

test("a landing with the source text raises the clobber warning and stops", async () => {
  clearNotices();
  const fixture = makeFixture({
    sourceText: "source text that was saved",
    landingText: "source text that was saved",
  });
  const opened = await helpers.openMarkdownFileWithLeafReuse(
    fixture.plugin,
    fixture.targetFile,
    "Could not open target",
  );

  assert.equal(opened, false);
  assert.equal(fixture.events.at(-1), "open:target.md");
  assert.match(notices[0], /target\.md opened with source\.md's text/);
  assert.equal(noticeDurations[0], 8000);
});

test("the delayed tripwire catches a disk overwrite after a clean landing", async () => {
  clearNotices();
  const fixture = makeFixture({ sourceText: "source text" });
  const scheduled = [];
  const originalSetTimeout = window.setTimeout;
  window.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };
  try {
    const opened = await helpers.openMarkdownFileWithLeafReuse(
      fixture.plugin,
      fixture.targetFile,
      "Could not open target",
    );
    assert.equal(opened, true);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 2500);
    fixture.disk.set("target.md", "source text");
    scheduled[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    window.setTimeout = originalSetTimeout;
  }

  assert.match(notices[0], /target\.md opened with source\.md's text/);
  assert.equal(noticeDurations[0], 8000);
});

test("an open that lands in another leaf skips the landing clobber check", async () => {
  clearNotices();
  const fixture = makeFixture({ sourceText: "source text that was saved" });
  const otherLeaf = {
    view: {
      file: fixture.targetFile,
      editor: { getValue: () => "source text that was saved" },
    },
  };
  const scheduled = [];
  const originalSetTimeout = window.setTimeout;
  window.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };
  try {
    const opened = await helpers.openWithLeafSwitchGuard(
      fixture.plugin,
      fixture.targetFile,
      fixture.leaf,
      async () => {
        fixture.workspace.activeLeaf = otherLeaf;
      },
    );
    assert.equal(opened, true);
    assert.equal(notices.length, 0);
    assert.deepEqual(fixture.events, ["save", "cancel"]);
    assert.equal(fixture.leaf.view.file, fixture.sourceFile);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 2500);
  } finally {
    window.setTimeout = originalSetTimeout;
  }
});

test("a dropped open skips the landing clobber check", async () => {
  clearNotices();
  const fixture = makeFixture({ sourceText: "source text that was saved" });
  const opened = await helpers.openWithLeafSwitchGuard(
    fixture.plugin,
    fixture.targetFile,
    fixture.leaf,
    async () => {},
  );

  assert.equal(opened, true);
  assert.equal(notices.length, 0);
  assert.equal(fixture.leaf.view.file, fixture.sourceFile);
  assert.deepEqual(fixture.events, ["save", "cancel"]);
});

test("same-note opens and activation of an existing leaf never save", async () => {
  clearNotices();
  const same = makeFixture();
  same.targetFile = same.sourceFile;
  assert.equal(
    await helpers.openMarkdownFileWithLeafReuse(same.plugin, same.sourceFile),
    true,
  );
  assert.deepEqual(same.events, []);

  const existing = makeFixture();
  const destinationLeaf = { view: { file: existing.targetFile } };
  existing.plugin.findMarkdownLeafByPath = () => destinationLeaf;
  existing.plugin.activateWorkspaceLeaf = async () => {
    existing.events.push("activate-existing");
    return true;
  };
  assert.equal(
    await helpers.openMarkdownFileWithLeafReuse(existing.plugin, existing.targetFile),
    true,
  );
  assert.deepEqual(existing.events, ["activate-existing"]);
});
