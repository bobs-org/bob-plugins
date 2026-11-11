// Task Wikilink Index unit test: the warm vault task index behind the
// `((` picker (phase `index` of plan 202610/obsidian_task_wikilinks.md).
//
// Drives the pure `TaskWikilinkIndex` store plus its thin Obsidian
// adapter through fakes in the style of
// `scripts/block-id-prompt-harness.cjs`: a fake vault counts
// `cachedRead` calls so the test can prove filtering never reads, event
// handlers prove live maintenance, and injected stats prove
// mtime-driven revalidation. Budgets live in
// `test-block-id-prompt-task-wikilink-index-performance.cjs`.

const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./block-id-prompt-harness.cjs");

const { TaskWikilinkIndex, taskWikilinkCacheHasTasks } = helpers;

function makeIndex() {
  const index = new TaskWikilinkIndex();
  index.emitThrottleMs = 0;
  return index;
}

function makeFile(path, content, options = {}) {
  return {
    path,
    content,
    unreadable: !!options.unreadable,
    cache: "cache" in options ? options.cache : null,
    stat: {
      mtime: options.mtime ?? 1000,
      size: options.size ?? Buffer.byteLength(content, "utf8"),
      ctime: options.mtime ?? 1000,
    },
  };
}

// Fake Obsidian app facade. `reads` counts every `cachedRead` by path;
// `handlers` captures event subscriptions for changed/rename/delete.
function createFakeApp(files, overrides = {}) {
  const reads = [];
  const handlers = { changed: [], rename: [], delete: [] };
  const app = {
    reads,
    handlers,
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path) => files.find((file) => file.path === path) || null,
      cachedRead: async (file) => {
        reads.push(file.path);
        if (file.unreadable) {
          throw new Error(`cannot read ${file.path}`);
        }
        return file.content;
      },
      on: (event, callback) => {
        (handlers[event] = handlers[event] || []).push(callback);
        return { event, callback };
      },
    },
    metadataCache: {
      getFileCache: (file) => file.cache,
      on: (event, callback) => {
        (handlers[event] = handlers[event] || []).push(callback);
        return { event, callback };
      },
    },
    workspace: {
      getLeavesOfType: () => [],
    },
    ...overrides,
  };
  return app;
}

function createFakeHost() {
  const registered = [];
  return {
    registered,
    registerEvent: (ref) => {
      registered.push(ref);
      return ref;
    },
  };
}

const syncSchedule = (callback) => callback();

async function coldBuild(index, app, options = {}) {
  return index.warmUpFromVault(app, { schedule: syncSchedule, ...options });
}

test("cache prefilter skips taskless files without reading, reads cacheless files", () => {
  const withTasks = makeFile("tasks.md", "- [ ] #task Ship it ^ship\n", {
    cache: { listItems: [{ task: " " }] },
  });
  const withoutTasks = makeFile("prose.md", "- just a bullet\n", {
    cache: { listItems: [{ position: 0 }] },
  });
  const noCache = makeFile("fresh.md", "- [ ] #task Fresh ^fresh\n", { cache: null });
  const app = createFakeApp([withTasks, withoutTasks, noCache]);
  const index = makeIndex();
  return coldBuild(index, app).then((result) => {
    assert.deepEqual([...app.reads].sort(), ["fresh.md", "tasks.md"]);
    assert.equal(result.scanned, 3);
    assert.equal(result.total, 3);
    assert.equal(result.skipped, 1);
    assert.equal(index.progress.ready, true);
    assert.deepEqual(index.taskBearingPaths().sort(), ["fresh.md", "tasks.md"]);
    assert.ok(taskWikilinkCacheHasTasks(null));
    assert.ok(taskWikilinkCacheHasTasks({}));
    assert.ok(taskWikilinkCacheHasTasks({ listItems: [{ task: " " }] }));
    assert.equal(taskWikilinkCacheHasTasks({ listItems: [{}] }), false);
  });
});

test("a throwing file cache falls back to reading", () => {
  const file = makeFile("a.md", "- [ ] #task Read me ^read\n");
  const app = createFakeApp([file], {
    metadataCache: {
      getFileCache: () => {
        throw new Error("no cache today");
      },
      on: () => ({}),
    },
  });
  const index = makeIndex();
  return coldBuild(index, app).then(() => {
    assert.deepEqual(app.reads, ["a.md"]);
    assert.equal(index.taskBearingPaths().length, 1);
  });
});

test("non-note and excluded paths never enter the store", () => {
  const index = makeIndex();
  assert.equal(index.ingestNote("note.txt", "- [ ] #task Nope ^nope\n", null), false);
  assert.equal(index.ingestNote(".obsidian/x.md", "- [ ] #task Nope ^nope\n", null), false);
  assert.equal(index.ingestNote("_templates/t.md", "- [ ] #task Nope ^nope\n", null), false);
  assert.equal(index.ingestNote("a.md", "- [ ] #task Yes ^yes\n", null), true);
  assert.deepEqual(index.notePaths(), ["a.md"]);
});

test("unreadable files produce bounded warnings and a quiet footer note", async () => {
  const files = [];
  for (let i = 0; i < 7; i += 1) {
    files.push(makeFile(`bad-${i}.md`, "- [ ] #task Hidden ^hidden\n", { unreadable: true }));
  }
  files.push(makeFile("good.md", "- [ ] #task Fine ^fine\n"));
  const app = createFakeApp(files);
  const index = makeIndex();
  const result = await coldBuild(index, app);
  assert.equal(result.warnings.length, helpers.TASK_WIKILINK_INDEX_MAX_WARNINGS);
  assert.equal(index.droppedWarnings, 2);
  assert.match(index.warningNote(), /\+2 more/);
  assert.equal(index.taskBearingPaths().length, 1);
  assert.equal(makeIndex().warningNote(), null);
});

test("blockIdsFor exposes the note id set for the detail strip preview", () => {
  const index = makeIndex();
  index.ingestNote(
    "a.md",
    ["- [ ] #task One ^one", "- [ ] #task Two ^two", "- [ ] #task No id"].join("\n"),
    null,
  );
  assert.deepEqual(index.blockIdsFor("a.md").sort(), ["one", "two"]);
  assert.deepEqual(index.blockIdsFor("missing.md"), []);
});

test("taskBearingDocuments reads fresh text on demand", async () => {
  const taskFile = makeFile("a.md", "- [ ] #task One ^one\n");
  const emptyFile = makeFile("b.md", "just prose\n");
  const app = createFakeApp([taskFile, emptyFile]);
  const index = makeIndex();
  await coldBuild(index, app);
  app.reads.length = 0;
  const first = await index.taskBearingDocuments(app);
  assert.deepEqual(first, [{ path: "a.md", text: "- [ ] #task One ^one\n" }]);
  taskFile.content = "- [ ] #task Edited ^one\n";
  taskFile.stat.size = Buffer.byteLength(taskFile.content, "utf8");
  const second = await index.taskBearingDocuments(app);
  assert.deepEqual(second, [{ path: "a.md", text: "- [ ] #task Edited ^one\n" }]);
});

test("metadataCache changed re-parses from event data with no extra read", async () => {
  const file = makeFile("a.md", "- [ ] #task Old ^old\n");
  const app = createFakeApp([file]);
  const host = createFakeHost();
  const index = makeIndex();
  await coldBuild(index, app);
  index.attachLiveUpdates(host, app);
  assert.equal(host.registered.length, 3);
  app.reads.length = 0;
  const changed = app.handlers.changed;
  assert.equal(changed.length, 1);
  file.content = "- [ ] #task New ^new\n";
  changed[0](file, file.content);
  assert.equal(app.reads.length, 0);
  assert.deepEqual(index.blockIdsFor("a.md"), ["new"]);
});

test("vault rename re-keys rows and recomputes the basename index", async () => {
  const app = createFakeApp([
    makeFile("sub/note.md", "- [ ] #task Sub ^sub\n"),
    makeFile("note.md", "- [ ] #task Top ^top\n"),
  ]);
  const index = makeIndex();
  await coldBuild(index, app);
  const before = new Map(index.snapshot({}).rows.map((row) => [row.blockId, row.locator]));
  assert.equal(before.get("sub"), "sub/note");
  assert.equal(before.get("top"), "note");
  index.attachLiveUpdates(createFakeHost(), app);
  app.handlers.rename[0]({ path: "renamed.md", stat: { mtime: 2, size: 20, ctime: 2 } }, "note.md");
  const after = new Map(index.snapshot({}).rows.map((row) => [row.blockId, row.locator]));
  assert.equal(after.get("sub"), "note");
  assert.equal(after.get("top"), "renamed");
  assert.equal(index.notePaths().includes("note.md"), false);
});

test("renaming onto an excluded path drops the note", () => {
  const index = makeIndex();
  index.ingestNote("a.md", "- [ ] #task Gone ^gone\n", null);
  assert.equal(index.renameNote("a.md", "_templates/a.md"), true);
  assert.deepEqual(index.notePaths(), []);
  assert.equal(index.renameNote("missing.md", "b.md"), false);
});

test("vault delete drops rows", async () => {
  const app = createFakeApp([makeFile("a.md", "- [ ] #task Gone ^gone\n")]);
  const index = makeIndex();
  await coldBuild(index, app);
  assert.equal(index.notePaths().length, 1);
  index.attachLiveUpdates(createFakeHost(), app);
  app.handlers.delete[0]({ path: "a.md" });
  assert.deepEqual(index.notePaths(), []);
  assert.deepEqual(index.snapshot({}).rows, []);
});

test("open-time mtime validation queues changed files for background re-parse", async () => {
  const file = makeFile("a.md", "- [ ] #task Old ^old\n", { mtime: 1 });
  const app = createFakeApp([file]);
  const index = makeIndex();
  await coldBuild(index, app);
  const fresh = () => ({ mtime: file.stat.mtime, size: file.stat.size });
  const clean = index.snapshot({ statOf: () => fresh() });
  assert.deepEqual(clean.changed, []);
  file.content = "- [ ] #task New ^new\n";
  file.stat = { mtime: 2, size: Buffer.byteLength(file.content, "utf8"), ctime: 2 };
  const stale = index.snapshot({ statOf: () => ({ mtime: 1, size: 5 }) });
  assert.deepEqual(stale.changed, ["a.md"]);
  const refreshed = await index.drainReparseQueue(app);
  assert.deepEqual(refreshed, ["a.md"]);
  assert.deepEqual(index.blockIdsFor("a.md"), ["new"]);
  assert.deepEqual(await index.drainReparseQueue(app), []);
});

test("a vanished file is removed when the reparse queue drains", async () => {
  const file = makeFile("a.md", "- [ ] #task Gone ^gone\n", { mtime: 1 });
  const files = [file];
  const app = createFakeApp(files);
  const index = makeIndex();
  await coldBuild(index, app);
  files.length = 0;
  const stale = index.snapshot({ statOf: () => null });
  assert.deepEqual(stale.changed, ["a.md"]);
  await index.drainReparseQueue(app);
  assert.deepEqual(index.notePaths(), []);
});

test("live overlays win over disk and never persist", () => {
  const index = makeIndex();
  index.ingestNote("a.md", "- [ ] #task Disk ^disk\n", null);
  const overlaid = index.snapshot({ overlays: { "a.md": "- [ ] #task Live ^live\n" } });
  assert.deepEqual(overlaid.rows.map((row) => row.blockId), ["live"]);
  const plain = index.snapshot({});
  assert.deepEqual(plain.rows.map((row) => row.blockId), ["disk"]);
  assert.deepEqual(index.blockIdsFor("a.md"), ["disk"]);
});

test("snapshot returns ordered rows, progress, and a live subscription", async () => {
  const app = createFakeApp([
    makeFile("b.md", "- [ ] #task Bee ^bee\n"),
    makeFile("a.md", "- [ ] #task Aye ^aye\n"),
  ]);
  const index = makeIndex();
  await coldBuild(index, app);
  const seen = [];
  const snap = index.snapshot({ ownerPath: "a.md" });
  assert.equal(snap.ready, true);
  assert.equal(snap.scanned, 2);
  assert.equal(snap.total, 2);
  assert.deepEqual(snap.changed, []);
  assert.equal(typeof snap.subscribe, "function");
  // Same-note open tasks lead the empty-query canonical order.
  assert.equal(snap.rows[0].notePath, "a.md");
  assert.equal(snap.rows[0].locator, "a");
  assert.equal(snap.rows[0].linkTarget, "a");
  const unsubscribe = snap.subscribe((progress) => seen.push(progress));
  index.ingestNote("c.md", "- [ ] #task Sea ^sea\n", null);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].total, 2);
  unsubscribe();
  index.ingestNote("d.md", "- [ ] #task Dee ^dee\n", null);
  assert.equal(seen.length, 1);
});

test("filtering performs no vault reads", async () => {
  const app = createFakeApp([
    makeFile("a.md", "- [ ] #task Alpha task ^alpha\n"),
    makeFile("b.md", "- [ ] #task Beta task ^beta\n"),
  ]);
  const index = makeIndex();
  await coldBuild(index, app);
  app.reads.length = 0;
  const snap = index.snapshot({});
  for (const query of ["alpha", "task", "beta task", ""]) {
    helpers.orderForWikilinkPicker(snap.rows, query, "a.md");
  }
  assert.equal(app.reads.length, 0);
});

test("refreshPaths applies post-write content and recomputes locators", () => {
  const index = makeIndex();
  index.ingestNote("sub/note.md", "- [ ] #task Sub ^sub\n", null);
  assert.equal(index.snapshot({}).rows[0].locator, "note");
  const changed = index.refreshPaths([
    { path: "sub/note.md", content: "- [ ] #task Sub renamed ^sub\n", stat: null },
    { path: "note.md", content: "- [ ] #task Top ^top\n", stat: null },
    { path: "broken.md" },
    { content: "- [ ] #task No path ^nopath\n" },
  ]);
  assert.equal(changed, true);
  const locators = new Map(index.snapshot({}).rows.map((row) => [row.blockId, row.locator]));
  assert.equal(locators.get("top"), "note");
  assert.equal(locators.get("sub"), "sub/note");
  assert.equal(index.refreshPaths([]), false);
});

test("refreshPathsFromVault re-reads named paths", async () => {
  const file = makeFile("a.md", "- [ ] #task Old ^old\n");
  const app = createFakeApp([file]);
  const index = makeIndex();
  await coldBuild(index, app);
  file.content = "- [ ] #task New ^new\n";
  const changed = await index.refreshPathsFromVault(app, ["a.md"]);
  assert.equal(changed, true);
  assert.deepEqual(index.blockIdsFor("a.md"), ["new"]);
});

test("collectEditorOverlays reads every open markdown editor", () => {
  const index = makeIndex();
  const app = createFakeApp([]);
  app.workspace.getLeavesOfType = (type) => {
    assert.equal(type, "markdown");
    return [
      { view: { file: { path: "a.md" }, editor: { getValue: () => "- [ ] #task Live ^live\n" } } },
      { view: { file: { path: "b.md" }, editor: null } },
      { view: null },
    ];
  };
  const overlays = index.collectEditorOverlays(app);
  assert.ok(overlays instanceof Map);
  assert.deepEqual([...overlays.entries()], [["a.md", "- [ ] #task Live ^live\n"]]);
  const rows = index.snapshot({ overlays }).rows;
  assert.deepEqual(rows.map((row) => row.blockId), ["live"]);
});

test("attachLiveUpdates without a host is a safe no-op", () => {
  const index = makeIndex();
  const detach = index.attachLiveUpdates(null, null);
  assert.equal(typeof detach, "function");
  detach();
});

test("custom settings narrow the parsed pool", () => {
  const index = new TaskWikilinkIndex({ globalFilter: "#todo", statusTypes: { " ": "TODO" } });
  index.emitThrottleMs = 0;
  index.ingestNote(
    "a.md",
    ["- [ ] #task Wrong tag ^wrong", "- [ ] #todo Right tag ^right"].join("\n"),
    null,
  );
  assert.deepEqual(index.taskBearingPaths(), ["a.md"]);
  assert.deepEqual(index.snapshot({}).rows.map((row) => row.blockId), ["right"]);
});

const PARSED_ROW_KEYS = [
  "notePath",
  "line",
  "rawLine",
  "status",
  "blockId",
  "hidden",
  "prjBlocked",
  "scheduleLogPresent",
  "section",
  "depth",
  "searchText",
  "displayText",
  "duplicateId",
  "open",
];

function storedFingerprint(index) {
  return [...index.entries.entries()].map(([path, entry]) => [
    path,
    JSON.stringify(entry.rows),
  ]);
}

function withoutSearchCache(row) {
  const copy = Object.assign({}, row);
  copy.loweredSearchFields = undefined;
  return copy;
}

function sortedFields(fields) {
  return [...fields].sort();
}

function assertDecoratedRow(row, stored) {
  for (const key of PARSED_ROW_KEYS) {
    assert.ok(key in row, `snapshot row keeps ${key}`);
    if (stored && Object.prototype.hasOwnProperty.call(stored, key)) {
      assert.deepEqual(row[key], stored[key], `snapshot preserves ${key}`);
    }
  }
  assert.equal(typeof row.locator, "string");
  assert.equal(typeof row.linkTarget, "string");
  assert.ok(Array.isArray(row.loweredSearchFields));
  assert.equal(row.loweredSearchFields[0], String(row.searchText).toLowerCase());
  assert.deepEqual(
    sortedFields(row.loweredSearchFields),
    sortedFields(
      helpers.taskWikilinkSearchFields(row).map((field) => String(field).toLowerCase()),
    ),
  );
  assert.deepEqual(
    row.loweredSearchFields,
    helpers.loweredTaskWikilinkSearchFields(withoutSearchCache(row)),
  );
}

function assertCachedUncachedParity(index, options = {}) {
  const beforeStored = storedFingerprint(index);
  const snap = index.snapshot(options);
  assert.deepEqual(storedFingerprint(index), beforeStored, "decoration leaves stored rows unchanged");
  const storedByKey = new Map();
  for (const entry of index.entries.values()) {
    for (const row of entry.rows) {
      assert.equal(row.loweredSearchFields, undefined);
      assert.equal(row.locator, undefined);
      storedByKey.set(`${row.notePath}:${row.line}`, row);
    }
  }
  const owner = options.ownerPath || null;
  const uncached = snap.rows.map(withoutSearchCache);
  const queries = ["", "task", "Live", "café", "alpha", "id-less", "t"];
  for (const row of snap.rows) {
    const overlayPath =
      options.overlays &&
      (options.overlays instanceof Map
        ? options.overlays.has(row.notePath)
        : Object.prototype.hasOwnProperty.call(options.overlays, row.notePath));
    assertDecoratedRow(row, overlayPath ? null : storedByKey.get(`${row.notePath}:${row.line}`));
    for (const query of queries) {
      assert.equal(
        helpers.matchScoreLoweredFields(row.loweredSearchFields, query),
        helpers.matchScoreWikilinkTasks(helpers.taskWikilinkSearchFields(row), query),
        `cached score matches uncached for ${JSON.stringify(query)}`,
      );
    }
  }
  for (const query of queries) {
    const cached = helpers.orderForWikilinkPicker(snap.rows, query, owner);
    const plain = helpers.orderForWikilinkPicker(uncached, query, owner);
    assert.deepEqual(
      cached.map((row) => `${row.notePath}:${row.line}`),
      plain.map((row) => `${row.notePath}:${row.line}`),
      `cached and uncached order agree for ${JSON.stringify(query)}`,
    );
  }
  return snap;
}

test("snapshot rows keep parsed metadata, leave stored rows bare, and cache search-text-first fields", () => {
  const index = makeIndex();
  index.ingestNote(
    "cafe.md",
    [
      "# Café",
      "- [ ] #task Café naïve task ^cafe",
      "- [ ] #task ID-less unicode",
      "- [x] #task Done twin ^twin",
      "- [ ] #task Open twin ^twin",
    ].join("\n"),
    null,
  );
  index.ingestNote("other.md", "- [ ] #task Other alpha ^alpha\n", null);
  const snap = assertCachedUncachedParity(index, { ownerPath: "cafe.md" });
  assert.ok(snap.rows.some((row) => row.blockId === null));
  assert.ok(snap.rows.some((row) => row.duplicateId === true));
  assert.ok(snap.rows.some((row) => row.searchText.includes("Café") || row.searchText.includes("naïve") || row.searchText.toLowerCase().includes("café")));
});

test("cached and uncached matching stay aligned across overlay, rename collision, delete, and refresh", () => {
  const index = makeIndex();
  index.ingestNote("sub/note.md", "- [ ] #task Sub ^sub\n", null);
  index.ingestNote("note.md", "- [ ] #task Top ^top\n", null);
  index.ingestNote("keep.md", "- [ ] #task Keep ^keep\n", null);
  assertCachedUncachedParity(index);

  assertCachedUncachedParity(index, {
    overlays: { "note.md": "- [ ] #task Live overlay ^live\n- [ ] #task ID-less live\n" },
    ownerPath: "note.md",
  });
  const afterOverlay = index.snapshot({});
  assert.deepEqual(afterOverlay.rows.map((row) => row.blockId).sort(), ["keep", "sub", "top"]);

  assert.equal(index.renameNote("note.md", "renamed.md"), true);
  assertCachedUncachedParity(index);
  const afterRename = new Map(index.snapshot({}).rows.map((row) => [row.blockId, row.locator]));
  assert.equal(afterRename.get("sub"), "note");
  assert.equal(afterRename.get("top"), "renamed");

  assert.equal(index.removeNote("keep.md"), true);
  assertCachedUncachedParity(index);
  assert.equal(index.snapshot({}).rows.some((row) => row.blockId === "keep"), false);

  index.refreshPaths([
    { path: "sub/note.md", content: "- [ ] #task Sub renamed ^sub\n", stat: null },
    { path: "note.md", content: "- [ ] #task Restored collision ^restored\n", stat: null },
    { path: "fresh.md", content: "- [ ] #task Fresh café ^fresh\n", stat: null },
  ]);
  assertCachedUncachedParity(index, { ownerPath: "fresh.md" });
  const afterRefresh = new Map(index.snapshot({}).rows.map((row) => [row.blockId, row.locator]));
  assert.equal(afterRefresh.get("top"), "renamed");
  assert.equal(afterRefresh.get("sub"), "sub/note");
  assert.equal(afterRefresh.get("restored"), "note");
  assert.equal(afterRefresh.get("fresh"), "fresh");
});
