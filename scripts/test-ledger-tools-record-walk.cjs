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
  recordWalkGroupProjection,
  recordWalkHasRail,
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
  for (const vector of vectors.grouped) {
    const grouping = { walk_by: vector.walk_by, fields: vector.fields };
    const projection = recordWalkGroupProjection(vector.records, grouping);
    assert.deepEqual(recordWalkOrder(vector.records, grouping).map((record) => record.stem), vector.expected_order, vector.name);
    assert.deepEqual(projection.ordered.map((record) => record.stem), vector.expected_order, vector.name);
    if (vector.expected_groups) {
      assert.deepEqual(projection.groups.map((group) => ({
        value: group.value,
        label: group.label,
        count: group.members.length,
        head: group.head,
      })), vector.expected_groups, vector.name);
    }
    if (vector.expected_membership) {
      assert.deepEqual(projection.ordered.map((record) => ({
        stem: record.stem,
        group: record.group,
        prev_group: record.prevGroup,
        next_group: record.nextGroup,
      })), vector.expected_membership, vector.name);
    }
    if (vector.expected_lines) {
      assert.deepEqual(
        recordWalkRenderLines(vector.expected_lines.album, vector.records, grouping),
        vector.expected_lines.lines,
        vector.name,
      );
    }
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

test("Obsidian-rewritten arms keep the rail and request one sync despite matching stems", () => {
  const world = recordWalkWorld();
  let schedules = 0;
  const plugin = {
    albumReportState: () => ({ report: world.report, reportGeneration: 4, stale: false }),
    albumScheduleSync: () => { schedules += 1; return true; },
  };
  for (const [from, target, arm] of [
    ["eat/c", "c", "writtenNext"],
    ["eat/a", "a", "writtenPrev"],
    ["eat/c", "drinks/c.md#Notes", "writtenNext"],
  ]) {
    const model = recordWalkModel({
      path: "eat/b.md", sourceText: world.sourceText(world.lines[1].replace(from, target)),
      report: world.report, metadataCache: world.metadataCache, vault: world.vault,
    });
    assert.equal(model.lineState, "stale");
    assert.equal(model.state, "syncing");
    assert.equal(model.reason, "neighbors_mismatch");
    assert.equal(model[arm].target, target);
    assert.equal(model[arm].stem, arm === "writtenNext" ? "c" : "a");
    assert.equal(recordWalkHasRail(model), true);
    recordWalkRequestSync(plugin, model);
    assert.equal(recordWalkRequestSync(plugin, model), false);
  }
  assert.equal(schedules, 1);
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

  const groupedUnsupported = {
    albumReportState: () => ({
      report: { capabilities: ["record_walk_v1"] }, reportGeneration: 2,
    }),
    albumScheduleSync: () => { schedules += 1; },
  };
  assert.equal(recordWalkRequestSync(groupedUnsupported, {
    ...syncing, walkBy: "section",
  }), false);
  assert.equal(schedules, 2);
});

function recordWalkGroupedWorld(capabilities = ["record_walk_v1", "record_walk_groups_v1"]) {
  const rows = [
    { path: "z/b.md", stem: "b", title: "Beta", section: "body" },
    { path: "z/a.md", stem: "a", title: "Alpha", section: "intro" },
    { path: "z/c.md", stem: "c", title: "Gamma", section: "body" },
    { path: "z/needs.md", stem: "needs", title: "Needs" },
    { path: "z/outro.md", stem: "outro", title: "Omega", section: "outro" },
  ];
  const frontmatter = new Map([
    ["z.md", { type: "[[album]]", title: "SASE Blog Zettel", walk_by: "section" }],
    ...rows.map((row) => [row.path, {
      type: "[[record]]", title: row.title,
      ...(row.section ? { section: row.section } : {}),
    }]),
  ]);
  const files = [...frontmatter.keys()].map((path) => ({ path, extension: "md" }));
  const vault = {
    getAbstractFileByPath: (path) => files.find((file) => file.path === path) || null,
    getMarkdownFiles: () => files,
  };
  const metadataCache = { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) };
  const album = {
    path: "z.md", stem: "z", title: "SASE Blog Zettel", walk_by: "section",
    fields: [{
      key: "section", label: "Section", kind: "choices", list: false,
      choices: [
        { value: "intro", label: "Intro" },
        { value: "empty", label: "Empty" },
        { value: "body", label: "Body" },
        { value: "outro", label: "Outro" },
      ],
    }],
    walk: { state: "current" },
  };
  const report = { capabilities, albums: [album] };
  const lines = recordWalkRenderLines(album, rows.map((row) => ({
    path: row.path, stem: row.stem, title: row.title,
    frontmatter: frontmatter.get(row.path),
  })), album);
  const orderedPaths = recordWalkGroupProjection(rows.map((row) => ({
    path: row.path, stem: row.stem, title: row.title,
    frontmatter: frontmatter.get(row.path),
  })), album).ordered.map((row) => row.path);
  const linesByPath = new Map(orderedPaths.map((path, index) => [path, lines[index]]));
  const sourceText = (path) => {
    return `---\ntype: "[[record]]"\n---\n\n${linesByPath.get(path)}\n`;
  };
  return { rows, frontmatter, files, vault, metadataCache, report, album, lines, sourceText };
}

test("grouped record model exposes bob-parity membership and neighboring group heads", () => {
  const world = recordWalkGroupedWorld();
  const middle = recordWalkModel({
    path: "z/c.md", sourceText: world.sourceText("z/c.md"), report: world.report,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(middle.state, "ok");
  assert.equal(middle.walkBy, "section");
  assert.deepEqual(middle.group, {
    field: "section", value: "body", label: "Body", index: 2, count: 4,
    position: 2, size: 2,
  });
  assert.deepEqual(middle.prevGroup, {
    value: "intro", label: "Intro",
    head: { stem: "a", path: "z/a.md", title: "Alpha" }, wraps: false,
  });
  assert.deepEqual(middle.nextGroup, {
    value: "outro", label: "Outro",
    head: { stem: "outro", path: "z/outro.md", title: "Omega" }, wraps: false,
  });
  assert.deepEqual(middle.groupMembers.map((member) => member.stem), ["b", "c"]);
});

test("a configured walk on old bob stays syncing and never schedules a flattening repair", () => {
  const world = recordWalkGroupedWorld(["record_walk_v1"]);
  const model = recordWalkModel({
    path: "z/a.md", sourceText: world.sourceText("z/a.md"), report: world.report,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(model.state, "syncing");
  assert.equal(model.reason, "grouping_unavailable");
  assert.equal(model.group, null);
  let schedules = 0;
  const plugin = {
    albumReportState: () => ({ report: world.report, reportGeneration: 1, stale: false }),
    albumScheduleSync: () => { schedules += 1; },
  };
  assert.equal(recordWalkRequestSync(plugin, model), false);
  assert.equal(schedules, 0);
});

test("walk album title uses the report, then the notebook header, then frontmatter", () => {
  const world = recordWalkWorld();
  world.frontmatter.set("eat.md", { type: "[[album]]", emoji: "🍽️" });
  world.metadataCache.getFileCache = (file) => {
    if (file.path === "eat.md") {
      return { frontmatter: world.frontmatter.get("eat.md"), headings: [{ level: 1, heading: "Restaurants" }] };
    }
    return { frontmatter: world.frontmatter.get(file.path) || {} };
  };
  const withReport = recordWalkModel({
    path: "eat/a.md", sourceText: world.sourceText(world.lines[0]), report: world.report,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(withReport.album.title, "Eat");
  const noReport = recordWalkModel({
    path: "eat/a.md", sourceText: world.sourceText(world.lines[0]), report: null,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(noReport.album.title, "Restaurants");
  world.frontmatter.set("eat.md", { type: "[[album]]", title: "Eat Here", emoji: "🍽️" });
  const titled = recordWalkModel({
    path: "eat/a.md", sourceText: world.sourceText(world.lines[0]), report: null,
    metadataCache: world.metadataCache, vault: world.vault,
  });
  assert.equal(titled.album.title, "Eat Here");
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
