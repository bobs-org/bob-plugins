// Album and record kinds in navigation (plan 202611/album_plugin_ui.md,
// phase album-navigation): accessible album/record icons, album and record
// parent-picker rules with commit-time checks, task-home exclusions, and
// focused navigation regressions.
const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

function rec(path, ruleKind, extras = {}) {
  const basename = path.split("/").pop().replace(/\.md$/, "");
  return {
    path,
    basename,
    ruleKind,
    noteInfo: extras.noteInfo || { kind: "plain", decorated: false },
    parentPath: extras.parentPath || null,
    recentRank: extras.recentRank,
    file: { path, basename, extension: "md" },
  };
}

function visiblePaths(index, query = "") {
  return helpers.rankParentCandidates(index, query).items.map((item) => item.path);
}

// ---------------------------------------------------------------------------
// Kind recognition and display
// ---------------------------------------------------------------------------

test("getChildNoteInfo classifies albums with the album icon", () => {
  for (const type of [
    "[[album]]",
    " [[album]] ",
    ["[[album]]"],
    [["[[album]]"]],
    ["[[other]]", "[[album]]"],
  ]) {
    const info = helpers.getChildNoteInfo({ type });
    assert.equal(info.kind, "album", JSON.stringify(type));
    assert.equal(info.decorated, true);
    assert.equal(info.icon, "album");
    assert.equal(info.label, "Album");
    assert.equal(info.variant, "album");
    assert.equal(info.scheduled, false);
  }
});

test("getChildNoteInfo classifies records with the file-text icon", () => {
  for (const type of [
    "[[record]]",
    " [[record]] ",
    ["[[record]]"],
    ["[[other]]", "[[record]]"],
  ]) {
    const info = helpers.getChildNoteInfo({ type });
    assert.equal(info.kind, "record", JSON.stringify(type));
    assert.equal(info.decorated, true);
    assert.equal(info.icon, "file-text");
    assert.equal(info.label, "Record");
    assert.equal(info.variant, "record");
  }
});

test("isAlbumType and isRecordType cover scalar and list forms", () => {
  assert.equal(helpers.isAlbumType("[[album]]"), true);
  assert.equal(helpers.isAlbumType(" [[album]] "), true);
  assert.equal(helpers.isAlbumType([["[[album]]"]]), true);
  assert.equal(helpers.isAlbumType("[[record]]"), false);
  assert.equal(helpers.isAlbumType(undefined), false);
  assert.equal(helpers.isRecordType("[[record]]"), true);
  assert.equal(helpers.isRecordType(["[[record]]"]), true);
  assert.equal(helpers.isRecordType("[[album]]"), false);
  assert.equal(helpers.isRecordType(undefined), false);
});

test("legacy noun types keep record parent rules but stay plain in pickers", () => {
  // Parent rules still treat a noun-typed note as a record, so an old
  // `type: [[restaurant]]` note keeps its album-only parent rule.
  assert.equal(helpers.parentRuleKindOf({ type: "[[restaurant]]" }), "record");
  // The picker surface only decorates exact type links, matching how
  // `[[ref]]` stays plain: unknown nouns are not promoted to Record badges.
  assert.equal(helpers.getChildNoteInfo({ type: "[[restaurant]]" }).kind, "plain");
  assert.equal(helpers.getChildNoteInfo({ type: "[[notebooks]]" }).kind, "plain");
});

test("album and record badges have accessible names", () => {
  assert.equal(helpers.childNoteKindAriaLabel({ kind: "album" }), "Album");
  assert.equal(helpers.childNoteKindAriaLabel({ kind: "record" }), "Record");
  assert.equal(helpers.childNoteKindAriaLabel({ kind: "area" }), "Area note");
});

test("child summaries and search text cover albums and records", () => {
  const files = [
    { path: "eat.md", basename: "eat" },
    { path: "nagi.md", basename: "nagi" },
    { path: "dev.md", basename: "dev" },
  ];
  const noteInfoByPath = new Map([
    ["eat.md", { kind: "album", label: "Album" }],
    ["nagi.md", { kind: "record", label: "Record" }],
    ["dev.md", { kind: "area", label: "Area" }],
  ]);
  const summary = helpers.getChildNoteSummary(files, noteInfoByPath);
  assert.ok(summary.includes("1 album"), JSON.stringify(summary));
  assert.ok(summary.includes("1 record"), JSON.stringify(summary));
  assert.ok(summary.includes("1 area"), JSON.stringify(summary));

  const albumText = helpers.getChildNoteSearchText(files[0], noteInfoByPath.get("eat.md"));
  assert.match(albumText, /album/);
  const recordText = helpers.getChildNoteSearchText(files[1], noteInfoByPath.get("nagi.md"));
  assert.match(recordText, /record/);
});

// ---------------------------------------------------------------------------
// Parent-picker rules
// ---------------------------------------------------------------------------

function albumPickerRecords() {
  return [
    rec("dev.md", "area"),
    rec("ship.md", "project"),
    rec("done.md", "project", {
      noteInfo: { kind: "project", decorated: true, statusKey: "done", label: "Done" },
    }),
    rec("dev_git.md", "notebook", { parentPath: "dev.md" }),
    rec("eat.md", "album"),
    rec("eat2.md", "album"),
    rec("nagi.md", "record"),
    rec("recipes.md", "reference"),
    rec("scratch.md", "other"),
  ];
}

test("an album hangs under an area or a project of any status", () => {
  const refusal = helpers.parentKindRefusal;
  assert.equal(refusal("album", "area"), null);
  assert.equal(refusal("album", "project"), null);
  // A notebook candidate keeps the notebook teaching even for albums.
  assert.equal(refusal("album", "notebook"), "notebook");
  for (const candidate of ["album", "record", "reference", "other"]) {
    assert.equal(refusal("album", candidate), "not-album-parent", candidate);
  }
  assert.match(
    helpers.parentKindRefusalText("not-album-parent", "eat2"),
    /eat2 can't hold an album/,
  );
  assert.match(
    helpers.parentKindRefusalText("not-album-parent", "eat2"),
    /hangs under an area or a project/,
  );
});

test("a record hangs under an album and nothing else", () => {
  const refusal = helpers.parentKindRefusal;
  assert.equal(refusal("record", "album"), null);
  for (const candidate of ["area", "project", "reference", "other", "record"]) {
    assert.equal(refusal("record", candidate), "not-record-parent", candidate);
  }
  // A notebook candidate keeps the notebook teaching even for records.
  assert.equal(refusal("record", "notebook"), "notebook");
  assert.match(
    helpers.parentKindRefusalText("not-record-parent", "ship"),
    /ship can't hold a record/,
  );
  assert.match(
    helpers.parentKindRefusalText("not-record-parent", "ship"),
    /hangs under an album/,
  );
});

test("albums and records never hang under notebooks", () => {
  assert.equal(helpers.parentKindRefusal("album", "notebook"), "notebook");
  assert.equal(helpers.parentKindRefusal("record", "notebook"), "notebook");
  assert.equal(helpers.parentKindRefusal("notebook", "album"), "not-notebook-parent");
  assert.equal(helpers.parentKindRefusal("notebook", "record"), "not-notebook-parent");
});

test("an album source sees only areas and projects, open or closed", () => {
  const index = helpers.buildParentPickerIndex(albumPickerRecords(), {
    sourcePath: "eat.md",
  });
  const seen = new Set(visiblePaths(index));
  for (const path of ["dev.md", "ship.md", "done.md"]) {
    assert.ok(seen.has(path), `${path} stays visible (any project status)`);
  }
  for (const path of ["dev_git.md", "eat2.md", "nagi.md", "recipes.md", "scratch.md"]) {
    assert.ok(!seen.has(path), `${path} is hidden`);
  }
  assert.equal(index.hiddenByKind.get("eat2.md"), "not-album-parent");
  assert.equal(index.hiddenByKind.get("nagi.md"), "not-album-parent");
  // Typing a ruled-out name teaches the album rule instead of matching.
  const typed = helpers.rankParentCandidates(index, "nagi");
  assert.deepEqual(typed.items, []);
  assert.equal(typed.kindRefusal, "not-album-parent");
  assert.equal(typed.kindRefusalName, "nagi");
});

test("a record source sees only albums", () => {
  const index = helpers.buildParentPickerIndex(albumPickerRecords(), {
    sourcePath: "nagi.md",
  });
  const seen = new Set(visiblePaths(index));
  assert.ok(seen.has("eat.md"), "sees its album");
  assert.ok(seen.has("eat2.md"), "sees other albums");
  for (const path of ["dev.md", "ship.md", "done.md", "dev_git.md", "nagi.md", "recipes.md", "scratch.md"]) {
    assert.ok(!seen.has(path), `${path} is hidden`);
  }
  const typed = helpers.rankParentCandidates(index, "ship");
  assert.deepEqual(typed.items, []);
  assert.equal(typed.kindRefusal, "not-record-parent");
});

test("a plain note may still choose an album parent", () => {
  // Ordinary non-record children of albums remain legal: the picker does not
  // hide album candidates from untyped notes.
  assert.equal(helpers.parentKindRefusal("other", "album"), null);
  const index = helpers.buildParentPickerIndex(albumPickerRecords(), {
    sourcePath: "scratch.md",
  });
  assert.ok(visiblePaths(index, "eat").includes("eat.md"));
});

test("a stale candidate is refused at commit time against live data", () => {
  // The picker opened while eat.md was a project; before commit it became an
  // album-backed record. The live index (built from current vault data, as
  // commitParentChange does) refuses the write with the record rule.
  const live = helpers.buildParentPickerIndex(
    albumPickerRecords().map((record) =>
      record.path === "ship.md" ? { ...record, ruleKind: "record" } : record,
    ),
    { sourcePath: "eat.md" },
  );
  const refusal = helpers.parentChangeKindRefusal(live, "eat.md", "ship.md");
  assert.match(refusal, /ship can't hold an album/);

  const recordLive = helpers.buildParentPickerIndex(
    albumPickerRecords().map((record) =>
      record.path === "eat.md" ? { ...record, ruleKind: "project" } : record,
    ),
    { sourcePath: "nagi.md" },
  );
  const recordRefusal = helpers.parentChangeKindRefusal(recordLive, "nagi.md", "eat.md");
  assert.match(recordRefusal, /eat can't hold a record/);
});

// ---------------------------------------------------------------------------
// Task-home exclusion
// ---------------------------------------------------------------------------

function taskHomeFiles() {
  const file = (path, frontmatter) => ({ path, frontmatter });
  return [
    file("dev.md", { type: "[[area]]" }),
    file("ship.md", { type: "[[project]]", status: "wip" }),
    file("done.md", { type: "[[project]]", status: "done" }),
    file("notes.md", { type: "[[notebook]]" }),
    file("eat.md", { type: "[[album]]" }),
    file("nagi.md", { type: "[[record]]" }),
    file("ramen.md", { type: "[[restaurant]]" }),
    file("scratch.md", {}),
  ];
}

function taskHomeNoteInfo(file) {
  return helpers.getChildNoteInfo(file.frontmatter || null);
}

test("task-move destinations admit no album or record kind", () => {
  const destinations = helpers.collectTaskMoveDestinations(
    taskHomeFiles(),
    "scratch.md",
    taskHomeNoteInfo,
  );
  const paths = destinations.map((entry) => entry.file.path);
  assert.deepEqual(paths, ["dev.md", "ship.md"]);
});

test("task-move commit-time validation refuses album and record homes", () => {
  const album = helpers.parseTaskMoveDestinationFrontmatter(
    ["---", 'type: "[[album]]"', "---", "", "## Tasks", ""].join("\n"),
  );
  assert.equal(album.valid, false);
  assert.match(album.error, /area or open project/);

  const record = helpers.parseTaskMoveDestinationFrontmatter(
    ["---", 'type: "[[record]]"', "---", "", "## Tasks", ""].join("\n"),
  );
  assert.equal(record.valid, false);
  assert.match(record.error, /area or open project/);

  const area = helpers.parseTaskMoveDestinationFrontmatter(
    ["---", 'type: "[[area]]"', "---", "", "## Tasks", ""].join("\n"),
  );
  assert.equal(area.valid, true);
});

test("inbox routing shares the task-home whitelist", () => {
  // Inbox routing and Task Card relocation consume collectTaskMoveDestinations,
  // so the same exclusion proof covers every alternate task-home picker.
  const candidates = helpers.collectTaskMoveDestinations(
    taskHomeFiles(),
    "mac_inbox.md",
    taskHomeNoteInfo,
  );
  const destinations = helpers.filterInboxRouteDestinations(
    candidates,
    (path) => path === "mac_inbox.md",
    "mac_inbox.md",
  );
  const paths = destinations.map((entry) => entry.file.path);
  assert.ok(!paths.some((path) => path === "eat.md"), "no album route");
  assert.ok(!paths.some((path) => path === "nagi.md"), "no record route");

  const source = ["- [ ] #task Triage me ^abc", "  - child kept"].join("\n");
  const discovery = helpers.discoverMovableObsidianTaskTargets(source, 0, 0);
  assert.equal(discovery.valid, true);
  const routed = helpers.preflightInboxRoute({
    sourcePath: "mac_inbox.md",
    sourceContent: source,
    destinationPath: "eat.md",
    destinationContent: ["---", 'type: "[[album]]"', "---", "", "## Tasks", ""].join("\n"),
    targets: discovery.targets,
    reservedBlockIds: [],
  });
  assert.equal(routed.ok, false);
  assert.match(routed.reason, /area or open project/);
});
