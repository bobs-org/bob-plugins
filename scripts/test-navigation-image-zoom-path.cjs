const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
  TransactionEditor,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const { ImageZoomModal, findImagePathBullet } = helpers;

// The import viewer schedules toast timers through the global clock; capture
// them instead of letting 1.8s/2.6s timers hold the test process open.
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
const pendingTimeouts = new Map();
let nextTimeoutId = 0;
global.setTimeout = (callback, delay) => {
  nextTimeoutId += 1;
  pendingTimeouts.set(nextTimeoutId, { callback, delay });
  return nextTimeoutId;
};
global.clearTimeout = (id) => {
  pendingTimeouts.delete(id);
};
test.after(() => {
  global.setTimeout = realSetTimeout;
  global.clearTimeout = realClearTimeout;
});

function resetNotices() {
  notices.length = 0;
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeApi(outcome, originOutcome) {
  const calls = [];
  const recorded = originOutcome === undefined
    ? {
        source: "/Users/bryan/tmp/screenshots/20261103_142837.png",
        display: "~/tmp/screenshots/20261103_142837.png",
        host: "vault-host",
        via: "capture",
        state: "present",
      }
    : originOutcome;
  return {
    calls,
    api: {
      version: 1,
      origin: (vaultPath) => Promise.resolve({ ok: true, schema_version: 1, path: vaultPath, origin: recorded }),
      import: (path, options) => {
        calls.push({ path, options });
        return typeof outcome === "function" ? outcome(path) : outcome;
      },
    },
  };
}

function importResult(overrides = {}) {
  return {
    ok: true,
    schema_version: 1,
    attachments: [{
      source: "/Users/bryan/tmp/screenshots/20261103_142837.png",
      display: "~/tmp/screenshots/20261103_142837.png",
      saved: "img/20261103_142837.png",
      kind: "image",
      reused: false,
      embed: "![[img/20261103_142837.png|400]]",
      sha256: "0".repeat(64),
      ...overrides,
    }],
  };
}

function makeRuntime(content, options = {}) {
  const cursor = { line: options.line ?? 0, ch: options.ch ?? 2 };
  const editor = new TransactionEditor(content, cursor);
  const file = { path: "notes/source.md", extension: "md" };
  const view = {
    file,
    editor,
    getMode: () => options.mode || "source",
  };
  let activeView = view;
  const fileMap = new Map();
  const app = {
    plugins: { plugins: {} },
    metadataCache: {
      getFirstLinkpathDest: (lookup) => fileMap.get(String(lookup)) || null,
    },
    vault: {
      adapter: {
        getBasePath: () => "/vault",
        getResourcePath: (saved) => `resource://${saved}`,
      },
      getResourcePath: (file) => `resource://${file && file.path}`,
    },
    workspace: {
      getActiveViewOfType: () => activeView,
    },
  };
  if (options.attachmentsApi) {
    app.plugins.plugins["bob-ledger-tools"] = { api: { attachments: options.attachmentsApi } };
  }
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.taskCardPluginUnloading = false;
  plugin.activeImageZoomModal = null;
  return {
    plugin,
    editor,
    file,
    view,
    app,
    setActiveView: (next) => { activeView = next; },
    addFile: (lookup, entry = {}) => {
      const name = String(lookup).split("/").pop();
      fileMap.set(lookup, { path: lookup, name, basename: name.replace(/\.[^.]+$/, ""), extension: "png", ...entry });
    },
  };
}

function toastText(modal) {
  return (modal.imageZoomToastEl && modal.imageZoomToastEl.children || [])
    .map((child) => child.textContent || "")
    .join("");
}

// --- detection matrix ---

test("detection accepts every bullet marker, plain lines, and nesting", () => {
  for (const line of [
    "- ~/tmp/x.png",
    "* ~/tmp/x.png",
    "+ ~/tmp/x.png",
    "1. ~/tmp/x.png",
    "2) ~/tmp/x.png",
    "~/tmp/x.png",
    "  - ~/tmp/x.png",
    "\t* ~/tmp/x.png",
  ]) {
    const bullet = findImagePathBullet(line);
    assert.ok(bullet, line);
    assert.equal(line.slice(bullet.start, bullet.end), "~/tmp/x.png", line);
    assert.equal(bullet.raw, "~/tmp/x.png", line);
  }
});

test("detection accepts wrappers, file://, spaces, and uppercase extensions", () => {
  const cases = [
    ["- '~/tmp/my photo.png'", "'~/tmp/my photo.png'"],
    ['- "~/tmp/my photo.png"', '"~/tmp/my photo.png"'],
    ["- <~/tmp/my photo.png>", "<~/tmp/my photo.png>"],
    ["- file:///tmp/x.png", "file:///tmp/x.png"],
    ["- /tmp/x/y 2.JPG", "/tmp/x/y 2.JPG"],
    ["- ~/X.PNG", "~/X.PNG"],
  ];
  for (const [line, expected] of cases) {
    const bullet = findImagePathBullet(line);
    assert.ok(bullet, line);
    assert.equal(bullet.raw, expected, line);
    assert.equal(line.slice(bullet.start, bullet.end), expected, line);
  }
  assert.equal(findImagePathBullet("-   ~/tmp/x.png  ").raw, "~/tmp/x.png");
});

test("detection rejects checkboxes, prose, and non-path lines", () => {
  for (const line of [
    "- [ ] ~/tmp/x.png",
    "- [x] ~/tmp/x.png",
    "- see ~/tmp/x.png for details",
    "Check out ~/tmp/x.png today",
    "- [[img/x.png]]",
    "- ![alt](img/x.png)",
    "",
    "-",
    "- ~/tmp/no-extension",
    "- https://example.test/x.png",
    "- note about something",
  ]) {
    assert.equal(findImagePathBullet(line), null, line);
  }
});

test("detection raises Not an image for a path-only bullet with a non-image extension", () => {
  assert.throws(() => findImagePathBullet("- ~/tmp/notes.md"), /Not an image: ~\/tmp\/notes\.md/);
  assert.throws(() => findImagePathBullet("~/tmp/archive.tar.gz"), /Not an image/);
});

// --- zoomImageOnLine routing ---

test("Z on an image-path bullet imports through bob with via zoom", async () => {
  resetNotices();
  const { api, calls } = makeApi(importResult());
  const runtime = makeRuntime("- ~/tmp/screenshots/20261103_142837.png", { attachmentsApi: api });
  runtime.plugin.zoomImageOnLine(runtime.editor, runtime.view);
  await flushAsync();
  await flushAsync();
  assert.deepEqual(calls, [{
    path: "~/tmp/screenshots/20261103_142837.png",
    options: { via: "zoom" },
  }]);
  assert.deepEqual(notices, []);
  assert.ok(runtime.plugin.activeImageZoomModal);
  runtime.plugin.activeImageZoomModal.close();
});

test("Z in a fence never imports and keeps the no-image notice", async () => {
  resetNotices();
  const { api, calls } = makeApi(importResult());
  const content = "```\n- ~/tmp/x.png\n```";
  const runtime = makeRuntime(content, { line: 1, ch: 4, attachmentsApi: api });
  runtime.plugin.zoomImageOnLine(runtime.editor, runtime.view);
  await flushAsync();
  assert.deepEqual(calls, []);
  assert.deepEqual(notices, ["No image on this line"]);
  assert.equal(runtime.plugin.activeImageZoomModal, null);
});

test("Z on a line with both an embed and a path opens the embed", async () => {
  resetNotices();
  const { api, calls } = makeApi(importResult());
  const line = "![[img/a.png]] ~/tmp/b.png";
  const runtime = makeRuntime(line, { ch: line.length, attachmentsApi: api });
  runtime.addFile("img/a.png");
  runtime.plugin.zoomImageOnLine(runtime.editor, runtime.view);
  await flushAsync();
  assert.deepEqual(calls, []);
  assert.deepEqual(notices, []);
  const modal = runtime.plugin.activeImageZoomModal;
  assert.ok(modal);
  assert.equal(modal.imageZoomContext.vaultPath, "img/a.png");
  modal.close();
});

test("Z on a non-image path bullet raises its notice without importing", async () => {
  resetNotices();
  const { api, calls } = makeApi(importResult());
  const runtime = makeRuntime("- ~/tmp/notes.md", { attachmentsApi: api });
  runtime.plugin.zoomImageOnLine(runtime.editor, runtime.view);
  await flushAsync();
  assert.deepEqual(calls, []);
  assert.deepEqual(notices, ["Not an image: ~/tmp/notes.md"]);
  assert.equal(runtime.plugin.activeImageZoomModal, null);
});

// --- import flow ---

async function runImport(content, fakeApi, options = {}) {
  resetNotices();
  pendingTimeouts.clear();
  const runtime = makeRuntime(content, { attachmentsApi: fakeApi, ...(options.runtime || {}) });
  const cursorCh = options.ch ?? 2;
  runtime.editor.cursor = { line: 0, ch: cursorCh };
  const bullet = findImagePathBullet(runtime.editor.getLine(0));
  assert.ok(bullet);
  await runtime.plugin.importImagePathOnLine(runtime.editor, runtime.view, bullet);
  return { runtime, bullet };
}

test("import success rewrites the bullet in one transaction and opens the viewer", async () => {
  const { api } = makeApi(importResult());
  const { runtime, bullet } = await runImport("- ~/tmp/screenshots/20261103_142837.png", api);
  assert.equal(runtime.editor.transactions.length, 1);
  assert.deepEqual(runtime.editor.transactions[0].changes, [{
    from: { line: 0, ch: bullet.start },
    to: { line: 0, ch: bullet.end },
    text: "![[img/20261103_142837.png|400]]",
  }]);
  assert.deepEqual(runtime.editor.transactions[0].selection, {
    from: { line: 0, ch: bullet.start },
    to: { line: 0, ch: bullet.start },
  });
  assert.equal(runtime.editor.content, "- ![[img/20261103_142837.png|400]]");
  assert.deepEqual(runtime.editor.cursor, { line: 0, ch: bullet.start });
  const modal = runtime.plugin.activeImageZoomModal;
  assert.ok(modal);
  assert.equal(modal.imageSrc, "resource://img/20261103_142837.png");
  assert.equal(modal.imageTitle, "20261103_142837.png");
  const context = modal.imageZoomContext;
  assert.equal(context.kind, "vault");
  assert.equal(context.vaultPath, "img/20261103_142837.png");
  assert.equal(context.justImported, true);
  assert.deepEqual(context.origin, {
    source: "/Users/bryan/tmp/screenshots/20261103_142837.png",
    display: "~/tmp/screenshots/20261103_142837.png",
    state: "present",
    via: "zoom",
  });
  assert.equal(context.restore.start, bullet.start);
  assert.equal(context.restore.end, bullet.start + "![[img/20261103_142837.png|400]]".length);
  assert.equal(toastText(modal), "✓Imported to img/20261103_142837.png · r to undo");
  assert.deepEqual(notices, []);
  modal.close();
});

test("import of a reused file links the existing viewer pill", async () => {
  const { api } = makeApi(importResult({
    saved: "img/existing.png",
    reused: true,
    embed: "![[img/existing.png|400]]",
  }));
  const { runtime } = await runImport("- ~/tmp/existing.png", api);
  assert.equal(runtime.editor.content, "- ![[img/existing.png|400]]");
  const modal = runtime.plugin.activeImageZoomModal;
  assert.ok(modal);
  assert.equal(toastText(modal), "✓Linked existing img/existing.png · r to undo");
  modal.close();
});

test("import without the ledger-tools api raises its notice and edits nothing", async () => {
  resetNotices();
  const runtime = makeRuntime("- ~/tmp/x.png", {});
  const bullet = findImagePathBullet(runtime.editor.getLine(0));
  await runtime.plugin.importImagePathOnLine(runtime.editor, runtime.view, bullet);
  assert.deepEqual(notices, ["Importing images needs bob-ledger-tools on desktop"]);
  assert.equal(runtime.editor.content, "- ~/tmp/x.png");
  assert.equal(runtime.editor.transactions.length, 0);
  assert.equal(runtime.plugin.activeImageZoomModal, null);
});

test("import failure raises Couldn't import with bob's message", async () => {
  const { api } = makeApi({ ok: false, code: "missing", message: "No such file." });
  const { runtime } = await runImport("- ~/tmp/gone.png", api);
  assert.deepEqual(notices, ["Couldn't import ~/tmp/gone.png: No such file."]);
  assert.equal(runtime.editor.content, "- ~/tmp/gone.png");
  assert.equal(runtime.editor.transactions.length, 0);
  assert.equal(runtime.plugin.activeImageZoomModal, null);
});

test("import of a non-image kind raises Not an image", async () => {
  const { api } = makeApi(importResult({ kind: "file", embed: "[[file/x.png]]", saved: "file/x.png" }));
  const { runtime } = await runImport("- ~/tmp/x.png", api);
  assert.deepEqual(notices, ["Not an image: ~/tmp/x.png"]);
  assert.equal(runtime.editor.transactions.length, 0);
  assert.equal(runtime.plugin.activeImageZoomModal, null);
});

test("import refuses a changed line and names the saved file", async () => {
  resetNotices();
  let resolveImport;
  const gate = new Promise((resolve) => { resolveImport = resolve; });
  const { api } = makeApi(() => gate);
  const runtime = makeRuntime("- ~/tmp/x.png", { attachmentsApi: api });
  const bullet = findImagePathBullet(runtime.editor.getLine(0));
  const pending = runtime.plugin.importImagePathOnLine(runtime.editor, runtime.view, bullet);
  runtime.editor.content = "- something else entirely";
  resolveImport(importResult());
  await pending;
  assert.deepEqual(notices, ["Line changed while importing · image saved at img/20261103_142837.png; note unchanged"]);
  assert.equal(runtime.editor.transactions.length, 0);
  assert.equal(runtime.plugin.activeImageZoomModal, null);
});

test("a second Z while importing is ignored", async () => {
  resetNotices();
  let resolveImport;
  const gate = new Promise((resolve) => { resolveImport = resolve; });
  const seen = makeApi(() => gate);
  const runtime = makeRuntime("- ~/tmp/x.png", { attachmentsApi: seen.api });
  const bullet = findImagePathBullet(runtime.editor.getLine(0));
  const first = runtime.plugin.importImagePathOnLine(runtime.editor, runtime.view, bullet);
  await runtime.plugin.importImagePathOnLine(runtime.editor, runtime.view, bullet);
  resolveImport(importResult());
  await first;
  assert.equal(seen.calls.length, 1);
  assert.ok(runtime.plugin.activeImageZoomModal);
  runtime.plugin.activeImageZoomModal.close();
});

test("Z then r round-trips the bullet back to its display path", async () => {
  const { api } = makeApi(importResult());
  const { runtime } = await runImport("- ~/tmp/screenshots/20261103_142837.png", api);
  const modal = runtime.plugin.activeImageZoomModal;
  assert.ok(modal);
  modal.close();
  resetNotices();
  const reopened = makeRuntime(runtime.editor.content, { attachmentsApi: api });
  reopened.addFile("img/20261103_142837.png");
  reopened.plugin.zoomImageOnLine(reopened.editor, reopened.view);
  await flushAsync();
  await flushAsync();
  const viewer = reopened.plugin.activeImageZoomModal;
  assert.ok(viewer);
  await viewer.handleImageZoomKey({ key: "r" });
  assert.equal(reopened.editor.content, "- ~/tmp/screenshots/20261103_142837.png");
  assert.equal(viewer.isOpen, false);
  assert.deepEqual(notices, ["Restored ~/tmp/screenshots/20261103_142837.png · vault copy kept at img/20261103_142837.png"]);
});
