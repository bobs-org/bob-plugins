// Shared dual-read task-drawer twin and rollout fixture checks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers: cycler } = require("./task-status-cycler-harness.cjs");
const { helpers: nav } = require("./navigation-hotkeys-harness.cjs");
const { helpers: blockId } = require("./block-id-prompt-harness.cjs");
const { helpers: ledger } = require("./ledger-tools-harness.cjs");
const { readFixture } = require("./task-reqs-vectors.cjs");

const ROOT = path.join(__dirname, "..");
const PLUGINS = path.join(ROOT, "plugins");
const CLI = path.join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures");
const DRAWER_FIXTURE = path.join(CLI, "task_drawers");
const PLUGINS_UNDER_TEST = [
  { id: "task-status-cycler", fragment: "193a-task-drawers-twin.js", before: "194-task-reqs-lines-twin.js", exports: "211-task-reqs-exports.js", helpers: cycler },
  { id: "bob-navigation-hotkeys", fragment: "693a-task-drawers-twin.js", before: "694-task-reqs-lines-twin.js", exports: "728-task-reqs-exports.js", helpers: nav },
  { id: "block-id-prompt", fragment: "164a-task-drawers-twin.js", before: "165-task-reqs-lines-twin.js", exports: "171-task-reqs-exports.js", helpers: blockId },
  { id: "bob-ledger-tools", fragment: "138a-task-drawers-twin.js", before: "139-task-reqs.js", exports: "351-exports-task-reqs.js", helpers: ledger },
];
const DRAWER_FILES = ["README.md", "vectors.json"];
const fragmentPath = (plugin, file) => path.join(PLUGINS, plugin, "src", file);
const manifestOf = (plugin) => JSON.parse(fs.readFileSync(fragmentPath(plugin, "fragments.json"), "utf8"));

function sourceOf(vector) {
  const ending = vector.eol === "crlf" ? "\r\n" : "\n";
  return vector.source_lines.join(ending) + ending;
}

function ownerContext(sourceLines, ownerId) {
  const lineIndex = sourceLines.findIndex((line) => line.includes(`^${ownerId}`));
  assert.notEqual(lineIndex, -1, `fixture owner ${ownerId} is present`);
  return { lineIndex, blockEnd: sourceOf({ source_lines: sourceLines }).length };
}

function expectedDrawerRows(helpers, vector, ownerId, expected) {
  const source = sourceOf(vector);
  const owner = ownerContext(vector.source_lines, ownerId);
  const rows = [];
  for (let index = 0; index < vector.source_lines.length; index += 1) {
    const header = helpers.recognize_drawer_header(source, owner, index);
    if (!header) continue;
    const row = { title: header.title, key: header.key, marker: header.marker, line: header.line };
    const wanted = expected[rows.length] || {};
    if (wanted.header_range) row.header_range = header.header_range;
    if (wanted.title_range) row.title_range = header.title_range;
    rows.push(row);
  }
  assert.deepEqual(rows, expected, vector.id);
}

test("four source fragments, manifests, bundles, fixtures, and exports stay in sync", () => {
  const canonical = fs.readFileSync(fragmentPath("task-status-cycler", PLUGINS_UNDER_TEST[0].fragment));
  for (const entry of PLUGINS_UNDER_TEST) {
    const manifest = manifestOf(entry.id);
    const twinAt = manifest.indexOf(entry.fragment);
    assert.notEqual(twinAt, -1, `${entry.id} lists its drawer twin`);
    assert.ok(twinAt < manifest.indexOf(entry.before), `${entry.id} loads the drawer twin before its readers`);
    assert.ok(manifest.indexOf(entry.exports) > twinAt, `${entry.id} exports the twin after it is defined`);
    assert.ok(fs.readFileSync(fragmentPath(entry.id, entry.fragment)).equals(canonical), `${entry.id} source matches the cycler byte for byte`);
    const source = fs.readFileSync(fragmentPath(entry.id, entry.fragment), "utf8");
    const bundle = fs.readFileSync(path.join(PLUGINS, entry.id, "main.js"), "utf8");
    assert.match(source, /bob-task-drawer-dual-read-v1/);
    assert.ok(bundle.includes(`// ---- src/${entry.fragment} ----\n${source}`), `${entry.id} bundle contains its built twin`);
    for (const helper of ["drawer_body_title", "is_legacy_drawer_title", "drawer_key", "recognize_drawer_header", "heading_for_drawer", "drawer_for_heading", "can_create_drawer"]) {
      assert.equal(typeof entry.helpers[helper], "function", `${entry.id} exports ${helper}`);
    }
    const copiedFixtureDir = path.join(PLUGINS, entry.id, "scripts", "fixtures", "task_drawers");
    for (const name of DRAWER_FILES) {
      assert.ok(fs.readFileSync(path.join(copiedFixtureDir, name)).equals(fs.readFileSync(path.join(DRAWER_FIXTURE, name))), `${entry.id} ${name} matches bob-cli`);
    }
  }
});

const vectors = JSON.parse(fs.readFileSync(path.join(DRAWER_FIXTURE, "vectors.json"), "utf8"));
for (const entry of PLUGINS_UNDER_TEST) {
  test(`${entry.id} bundle runs DV and DH vectors`, () => {
    for (const vector of vectors.cases) {
      expectedDrawerRows(entry.helpers, vector, vector.owner, vector.expect);
      if (vector.other_owner) expectedDrawerRows(entry.helpers, vector, vector.other_owner, vector.other_expect);
    }
    for (const vector of vectors.body_cases) {
      const parsed = entry.helpers.drawer_body_title(vector.body);
      assert.deepEqual(parsed, vector.excluded ? null : { title: vector.title, marker: vector.marker }, vector.id);
    }
    for (const vector of vectors.heading_mappings) {
      assert.equal(entry.helpers.heading_for_drawer(vector.title, "bold"), vector.heading, vector.id);
      assert.deepEqual(entry.helpers.drawer_for_heading(vector.heading), { ok: true, title: vector.title }, vector.id);
    }
    assert.equal(entry.helpers.drawer_key("Straße"), "STRASSE");
    assert.equal(entry.helpers.drawer_key("Café"), "CAFÉ");
    assert.deepEqual(entry.helpers.drawer_for_heading(""), { ok: true, title: "" });
    assert.deepEqual(entry.helpers.drawer_for_heading("Note:"), { ok: false, refusal: "not_a_drawer_title" });
    assert.deepEqual(entry.helpers.drawer_for_heading("Tasks"), { ok: false, refusal: "reserved" });
    assert.deepEqual(entry.helpers.can_create_drawer("API Design", true), { ok: true });
    assert.deepEqual(entry.helpers.can_create_drawer("API Design", false), { ok: false, refusal: "empty_drawer" });
    assert.deepEqual(entry.helpers.can_create_drawer("Tasks", true), { ok: false, refusal: "reserved" });
  });
}

const reqVectors = readFixture("task-status-cycler", "vectors.json");
for (const entry of PLUGINS_UNDER_TEST) {
  test(`${entry.id} requirement reader keeps the canonical drawer children out of RQ`, () => {
    for (const vector of reqVectors.cases) {
      const source = `${vector.source_lines.join("\n")}\n`;
      const rows = entry.helpers.taskReqForest(source) || [];
      assert.deepEqual(rows.map((row) => ({ line: row.line, depth: row.depth, parent: row.parent, owner: row.owner, mark: row.mark, state: row.state, text: row.text })),
        vector.expect.nodes.map(({ line, depth, parent, owner, mark, state, text }) => ({ line, depth, parent, owner, mark, state, text })), vector.id);
    }
  });
}

test("bold Notes is reused verbatim and new Notes writers stay legacy", () => {
  const contents = [
    "- [ ] #task Parent ^parent",
    "  - [ ] requirement",
    "  - **Notes**",
    "    - existing note",
    "  - loose note",
    "",
  ].join("\n");
  const task = cycler.taskBlockFindTask(contents, 0);
  const home = cycler.taskBlockNoteHome(contents, task);
  assert.equal(home.home, "notes");
  assert.equal(home.drawer.title, "Notes");
  const filed = cycler.taskBlockFileIntoNotes(contents, 0, [{ lines: ["  - filed note\n"], indent: "  " }]);
  assert.ok(filed);
  assert.match(filed.updated, /^  - \*\*Notes\*\*$/m);
  assert.equal((filed.updated.match(/\*\*Notes\*\*/g) || []).length, 1);
  assert.match(filed.updated, /- filed note/);

  const noNotes = "- [ ] #task Parent ^parent\n  - [ ] requirement\n";
  const freshTask = cycler.taskBlockFindTask(noNotes, 0);
  const created = cycler.taskBlockEnsureNotesDrawer(noNotes, freshTask);
  assert.ok(created);
  assert.match(created.updated, /^  - NOTES$/m);
  assert.doesNotMatch(created.updated, /\*\*NOTES\*\*/);
});

test("bold drawer blocks requirement conversion with the drawer-specific refusal", () => {
  const contents = "- [ ] #task Parent ^parent\n  - **API Design**\n    - a note\n";
  const result = cycler.taskReqToggle(contents, { lineIndex: 2, preimage: "    - a note" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "req_in_drawer");
});

test("promotion reads bold true-case titles verbatim and task-split labels decode the parent drawer", () => {
  for (const title of ["API Design", "C++ Notes", "Q1: Goals", "Café"]) {
    assert.equal(nav.parseProjectSectionBulletTitle(`**${title}**`), title);
  }
  assert.equal(nav.parseProjectSectionBulletTitle("API DESIGN"), "Api Design");

  const files = {
    "db.md": "- [ ] #task Parent ^parent\n  - **API Design**\n    - Draft endpoint\n    - **Nested bold note**\n      - detail\n",
  };
  const listed = nav.listTaskSplitCandidates(files, {
    ownerPath: "db.md",
    ownerLine: 1,
    selection: { kind: "cursor", line: 4 },
  });
  assert.equal(listed.ok, true);
  const nested = listed.candidates.find((candidate) => candidate.title === "**Nested bold note**");
  assert.ok(nested, "a deeper whole-bold note remains splittable");
  assert.equal(nested.drawer, "API Design");
});
