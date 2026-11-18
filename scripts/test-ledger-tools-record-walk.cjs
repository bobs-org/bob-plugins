// Shared record-walk vectors are owned by bob-cli at tests/fixtures/record_walk/.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Notice: class {},
      Platform: { isDesktopApp: true },
      Plugin: class {},
      normalizePath: (value) => value,
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return { EditorView: {}, keymap: { of: (value) => value } };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  linksWalkerFooterRecordWalk,
  linksWalkerFooterSubscribeAlbum,
  linksWalkerFooterView,
  recordSheetSignature,
  recordWalkClassify,
  recordWalkClearSyncedEpisodes,
  recordWalkLabel,
  recordWalkModel,
  recordWalkOrder,
  recordWalkRenderLines,
  recordWalkRequestSync,
} = helpers;
const vectors = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/record_walk/vectors.json"),
  "utf8",
));

test("record walk shared vectors match title order, labels, and canonical lines", () => {
  for (const vector of vectors.order) {
    assert.deepEqual(recordWalkOrder(vector.records).map((record) => record.stem), vector.expected, vector.name);
  }
  for (const vector of vectors.labels) {
    assert.equal(recordWalkLabel(vector.title, vector.stem), vector.expected, vector.name);
  }
  for (const vector of vectors.lines) {
    assert.deepEqual(recordWalkRenderLines(vector.album, vector.members), vector.expected, vector.name);
  }
});

test("record walk recognition matches bob-cli states and damage reasons", () => {
  for (const vector of vectors.recognition) {
    const actual = recordWalkClassify(vector.markdown, vector.album, vector.canonical);
    assert.equal(actual.state, vector.state, vector.name);
    assert.equal(actual.reason, vector.reason, vector.name);
  }
});

function recordWalkWorld() {
  const frontmatter = new Map([
    ["eat.md", { type: "[[album]]", title: "Eat", emoji: "🍽️" }],
    ["eat/a.md", { type: "[[record]]", title: "Alpha" }],
    ["eat/b.md", { type: "[[record]]", title: "Bravo" }],
    ["eat/c.md", { type: "[[record]]", title: "Charlie" }],
    ["eat/nested/skip.md", { type: "[[record]]", title: "Nested" }],
  ]);
  const files = [...frontmatter.keys()].map((filePath) => ({ path: filePath, extension: "md" }));
  const vault = {
    getAbstractFileByPath: (filePath) => files.find((file) => file.path === filePath) || null,
    getMarkdownFiles: () => files,
  };
  const metadataCache = { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) };
  const report = {
    capabilities: ["record_walk_v1"],
    albums: [{ path: "eat.md", stem: "eat", title: "Eat", emoji: "🍽️", walk: { state: "stale" } }],
  };
  const lines = recordWalkRenderLines({ stem: "eat", title: "Eat" }, [
    { path: "eat/a.md", stem: "a", title: "Alpha" },
    { path: "eat/b.md", stem: "b", title: "Bravo" },
    { path: "eat/c.md", stem: "c", title: "Charlie" },
  ]);
  const sourceText = (line) => `---\ntype: "[[record]]"\n---\n\n${line}\n`;
  return { files, frontmatter, vault, metadataCache, report, lines, sourceText };
}

test("metadata-cache ring counts immediate members, cross-checks links, and follows sibling changes", () => {
  const world = recordWalkWorld();
  const valid = recordWalkModel({
    path: "eat/a.md", sourceText: world.sourceText(world.lines[0]), report: world.report,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(valid.state, "ok");
  assert.equal(valid.position, 1);
  assert.equal(valid.total, 3);
  assert.equal(valid.prev.stem, "c");
  assert.equal(valid.next.stem, "b");
  assert.equal(valid.wrapsPrev, true);
  assert.equal(valid.album.emoji, "🍽️");

  const staleNeighbor = recordWalkModel({
    path: "eat/a.md", sourceText: world.sourceText(world.lines[1]), report: world.report,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(staleNeighbor.state, "syncing");
  assert.equal(staleNeighbor.reason, "neighbors_mismatch");

  const missing = recordWalkModel({
    path: "eat/a.md", sourceText: "---\ntype: \"[[record]]\"\n---\n\nNotes\n",
    report: world.report, metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(missing.state, "absent");

  const added = { path: "eat/0.md", extension: "md" };
  world.files.push(added);
  world.frontmatter.set("eat/0.md", { type: "[[record]]", title: "Aardvark" });
  const refreshed = recordWalkModel({
    path: "eat/a.md", sourceText: world.sourceText(world.lines[0]), report: world.report,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(refreshed.position, 2);
  assert.equal(refreshed.total, 4);
  assert.equal(recordSheetSignature({ path: "eat/a.md", state: "ready", walk: valid }) ===
    recordSheetSignature({ path: "eat/a.md", state: "ready", walk: refreshed }), false);
});

test("sync repair requests are capability-gated and occur once per fresh-report episode", () => {
  const world = recordWalkWorld();
  let schedules = 0;
  const plugin = {
    albumReportState: () => ({ report: world.report, reportGeneration: 4, stale: false }),
    albumScheduleSync: () => { schedules += 1; return true; },
  };
  const syncing = { state: "syncing", reason: "neighbors_mismatch", albumPath: "eat.md" };
  assert.equal(recordWalkRequestSync(plugin, syncing), true);
  assert.equal(recordWalkRequestSync(plugin, syncing), false);
  assert.equal(schedules, 1);

  const nextReport = {
    ...world.report,
    albums: [{ path: "eat.md", stem: "eat", title: "Eat", walk: { state: "current" } }],
  };
  recordWalkClearSyncedEpisodes(plugin, { report: nextReport, reportGeneration: 5, stale: false });
  assert.equal(plugin.recordWalkSyncEpisodes.size, 0);
  assert.equal(recordWalkRequestSync(plugin, syncing), true);
  assert.equal(schedules, 2);

  const unsupported = {
    albumReportState: () => ({ report: { capabilities: [] }, reportGeneration: 1 }),
    albumScheduleSync: () => { schedules += 1; },
  };
  assert.equal(recordWalkRequestSync(unsupported, syncing), false);
  assert.equal(schedules, 2);
});

test("links footer paints bare position, spinner, and singleton counts with tooltip context", () => {
  const ok = linksWalkerFooterRecordWalk({
    state: "ok", title: "Ramen Nagi", position: 3, total: 104,
    album: { title: "Eat", emoji: "🍽️" },
  });
  assert.equal(ok.dueText, "Links 3/104");
  assert.match(ok.tooltip, /3 of 104 in 🍽️ Eat/);

  const view = linksWalkerFooterView({
    ok: true, prev: null, next: null,
    recordWalk: { state: "ok", title: "Only", position: 1, total: 1, album: { title: "Eat", emoji: "🍽️" } },
  });
  assert.equal(view.dueText, "Links 1/1");
  assert.equal(view.linkState, "empty");
  assert.match(view.tooltip, /Only is 1 of 1 in 🍽️ Eat/);

  const syncing = linksWalkerFooterView({
    ok: true, prev: null, next: null,
    recordWalk: { state: "syncing", title: "Ramen Nagi", album: { title: "Eat" } },
  });
  assert.equal(syncing.dueText, "Links ⟳");
  assert.match(syncing.tooltip, /Record walk is syncing/);
});

test("album report invalidation immediately refreshes the links footer", () => {
  let onAlbumChange = null;
  let scheduled = 0;
  let unsubscribed = false;
  const plugin = {
    apiAlbumSubscribe(callback) { onAlbumChange = callback; return () => { unsubscribed = true; }; },
    dependencyNavApi: () => ({ walkMode: { version: 2, current: () => "w" } }),
    scheduleFreshnessStatusBar() { scheduled += 1; },
  };
  const unsubscribe = linksWalkerFooterSubscribeAlbum(plugin);
  assert.equal(typeof onAlbumChange, "function");
  onAlbumChange({ report: null });
  assert.equal(scheduled, 1);
  unsubscribe();
  assert.equal(unsubscribed, true);
});
