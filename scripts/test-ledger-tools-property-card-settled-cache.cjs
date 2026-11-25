// Last-confirmed metadata cache for property-card painters. Live non-null
// caches are recorded; a re-parse gap holds that entry for 2s when the
// TFile identity and vault path still match.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, order) { (this.postProcessors ||= []).push({ handler, order }); }
  registerEvent(ref) { (this.events ||= []).push(ref); return ref; }
}

const editorInfoField = { info: true };
const editorLivePreviewField = { live: true };
const Platform = { isDesktopApp: true };
const StateEffect = { define: () => { const type = { of(value) { return { type, value, is: (other) => other === type }; } }; return type; } };
const StateField = { define: (spec) => ({ stateField: true, spec }) };
class WidgetType {}
class RangeSetBuilder { constructor() { this.rows = []; } add(from, to, deco) { this.rows.push({ from, to, deco }); } finish() { return this.rows; } }
const Decoration = {
  none: [],
  widget: (options) => ({ ...options }),
  replace: (spec) => ({ spec, range(from, to) { return { from, to, value: this }; } }),
  set: (ranges) => ranges,
};
const EditorView = {
  decorations: { from: (field, get) => ({ facet: "decorations", field, get }) },
  editorAttributes: { of: (value) => value, from: (field, get) => ({ facet: "editorAttributes", field, get }) },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class { constructor(el) { this.containerEl = el; } },
    Notice: class {}, Plugin: TestPlugin, Platform,
    normalizePath: (value) => value, editorInfoField, editorLivePreviewField,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value }, StateEffect, StateField, RangeSetBuilder };
  if (request === "@codemirror/view") return {
    Decoration, WidgetType, EditorView, ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

function world() {
  const callbacks = new Map();
  const files = new Map();
  const caches = new Map();
  const fileFor = (path) => {
    const key = String(path || "");
    if (!files.has(key)) files.set(key, { path: key });
    return files.get(key);
  };
  const metadataCache = {
    getFileCache: (file) => (file && caches.has(file.path) ? caches.get(file.path) : null),
    getCache: (path) => {
      const file = files.get(String(path || ""));
      return file && caches.has(file.path) ? caches.get(file.path) : null;
    },
    getFirstLinkpathDest(target, sourcePath) {
      this.lastLink = { target, sourcePath, bound: this === metadataCache };
      return fileFor(`${String(target).replace(/\.md$/i, "")}.md`);
    },
    extraValue: 7,
    on(name, callback) {
      const list = callbacks.get(name) || [];
      list.push(callback);
      callbacks.set(name, list);
      return { name, callback };
    },
  };
  const vault = {
    getAbstractFileByPath: (path) => files.get(String(path || "")) || null,
    on(name, callback) {
      const list = callbacks.get(name) || [];
      list.push(callback);
      callbacks.set(name, list);
      return { name, callback };
    },
  };
  const plugin = new TestPlugin({ vault, metadataCache });
  H.propertyCardSettledCacheReset();
  return {
    plugin, callbacks, metadataCache, vault, fileFor, caches,
    setCache(path, value) {
      if (value == null) caches.delete(path);
      else caches.set(path, value);
    },
    fire(name, ...args) {
      for (const callback of callbacks.get(name) || []) callback(...args);
    },
  };
}

test("a live cache is recorded and returned during a null re-parse gap", () => {
  const w = world();
  const file = w.fileFor("note.md");
  const live = { frontmatter: { type: "record", title: "Held" } };
  w.setCache("note.md", live);
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), live);
  w.setCache("note.md", null);
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), live, "the last-known-good cache is held");
});

test("a never-cached file returns null", () => {
  const w = world();
  const file = w.fileFor("fresh.md");
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), null);
});

test("a different TFile or a missing vault entry returns null", () => {
  const w = world();
  const file = w.fileFor("note.md");
  w.setCache("note.md", { frontmatter: { type: "album" } });
  assert.ok(H.propertyCardSettledFileCache(w.plugin.app, file));
  w.setCache("note.md", null);
  const other = { path: "note.md" };
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, other), null, "a different TFile identity fails open");
  w.vault.getAbstractFileByPath = () => null;
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), null, "a missing vault entry fails open");
});

test("the hold expires after PROPERTY_CARD_SETTLED_CACHE_HOLD_MS", () => {
  const w = world();
  const file = w.fileFor("note.md");
  const live = { frontmatter: { type: "day" } };
  w.setCache("note.md", live);
  const hold = H.PROPERTY_CARD_SETTLED_CACHE_HOLD_MS;
  assert.equal(hold, 2000);
  const t0 = 1_700_000_000_000;
  let now = t0;
  const orig = Date.now;
  Date.now = () => now;
  try {
    assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), live);
    w.setCache("note.md", null);
    now = t0;
    assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), live, "the first null stamps the hold");
    now = t0 + hold;
    assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), live, "exactly the hold window still returns the cache");
    now = t0 + hold + 1;
    assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), null, "the hold expires after the window");
  } finally {
    Date.now = orig;
  }
});

test("changed replaces the entry; rename and delete drop it", () => {
  const w = world();
  const file = w.fileFor("note.md");
  w.setCache("note.md", { frontmatter: { type: "album", summary: "old" } });
  assert.equal(H.propertyCardSettledCacheBind(w.plugin), true);
  w.fire("changed", file, "", { frontmatter: { type: "album", summary: "new" } });
  w.setCache("note.md", null);
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file).frontmatter.summary, "new");

  w.setCache("note.md", { frontmatter: { type: "album", summary: "from-modify" } });
  w.fire("modify", file);
  w.setCache("note.md", null);
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file).frontmatter.summary, "from-modify");

  w.fire("rename", w.fileFor("other.md"), "note.md");
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), null, "rename drops the old path");

  w.setCache("note.md", { frontmatter: { type: "album" } });
  assert.ok(H.propertyCardSettledFileCache(w.plugin.app, file));
  w.setCache("note.md", null);
  w.fire("delete", file);
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), null, "delete drops the path");
});

test("the facade delegates other members and binds functions to the real cache", () => {
  const w = world();
  const file = w.fileFor("note.md");
  const live = { frontmatter: { type: "record" } };
  w.setCache("note.md", live);
  const facade = H.propertyCardSettledMetadataCache(w.plugin.app);
  assert.equal(facade.getFileCache(file), live);
  assert.equal(H.propertyCardSettledMetadataCache(w.plugin.app), facade, "the facade is memoized per metadataCache");
  w.setCache("note.md", null);
  assert.equal(facade.getFileCache(file), live);
  assert.equal(facade.getCache("note.md"), live);
  const dest = facade.getFirstLinkpathDest("eat", "body.md");
  assert.equal(dest.path, "eat.md");
  assert.deepEqual(w.metadataCache.lastLink, { target: "eat", sourcePath: "body.md", bound: true });
  assert.equal(facade.extraValue, 7);
});

test("bind runs once per plugin and reset clears the map", () => {
  const w = world();
  const file = w.fileFor("note.md");
  w.setCache("note.md", { frontmatter: { type: "album" } });
  assert.equal(H.propertyCardSettledCacheBind(w.plugin), true);
  assert.equal(H.propertyCardSettledCacheBind(w.plugin), false, "a second bind is a no-op");
  assert.ok(H.propertyCardSettledFileCache(w.plugin.app, file));
  w.setCache("note.md", null);
  H.propertyCardSettledCacheReset();
  assert.equal(H.propertyCardSettledFileCache(w.plugin.app, file), null, "reset drops last-known-good entries");
});
