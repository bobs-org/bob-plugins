// Shared drivers for bob-cli's requirement close-card fixtures
// (`tests/fixtures/req_close/vectors.json`). Each runner takes a plugin's
// exported twin helpers so the cycler's vector test and the cross-plugin
// twin copy test drive every copy through the same projection bob-cli's
// RV tests use.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PLUGINS_DIR = path.join(__dirname, "..", "plugins");
const CANONICAL_DIR = path.join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "req_close");
const REQ_CLOSE_FIXTURE_FILES = Object.freeze(["README.md", "vectors.json"]);

function fixtureDir(pluginId) {
  return path.join(PLUGINS_DIR, pluginId, "scripts", "fixtures", "req_close");
}

function readFixture(pluginId, name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir(pluginId), name), "utf8"));
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function sourceOf(note) {
  const ending = note.eol === "crlf" ? "\r\n" : "\n";
  return `${(note.source_lines || []).join(ending)}${ending}`;
}

function collectCase(helpers, testCase) {
  const owners = helpers.reqCloseCollectOwners(testCase.notes || [], sha256Hex);
  return { owners, groups: helpers.reqCloseGroupsFromOwners(owners) };
}

function foldedJson(folds) {
  const json = {};
  if (folds.dropped) json.dropped = folds.dropped;
  if (folds.carried) json.carried = folds.carried;
  if (folds.met) json.met = folds.met;
  return json;
}

function ownerJson(owner) {
  return {
    task_key: owner.task_key,
    key: owner.key,
    path: owner.path,
    block_id: owner.block_id,
    line: owner.line,
    text: owner.text,
    preimage: owner.preimage,
    depth_exceeded: owner.depth_exceeded,
  };
}

function rowJson(row) {
  return {
    offer: {
      key: row.offer.key,
      n: row.offer.n,
      group: row.offer.group,
      selected: row.offer.selected,
    },
    req: {
      owner: row.owner_key,
      path: row.path,
      depth: row.depth,
      parent_key: row.parent_key,
      text: row.text,
      line: row.line,
      state: row.state,
      pending_descendants: row.pending_descendants,
    },
    consequences: {
      met: row.consequences.met,
      drop: row.consequences.drop,
      carry: row.consequences.carry,
      carry_pulled: row.consequences.carry_pulled,
    },
    run: row.run,
    accessibility: row.accessibility,
  };
}

function groupJson(group) {
  return {
    group: group.group,
    kind: group.kind,
    owner: {
      task_key: group.owner.task_key,
      key: group.owner.key,
      path: group.owner.path,
      block_id: group.owner.block_id,
      line: group.owner.line,
      text: group.owner.text,
    },
    copy: {
      title: group.copy.title,
      scope: group.copy.scope,
      why: group.copy.why,
      glyph: group.copy.glyph,
      footer: group.copy.footer,
      hint: group.copy.hint,
      history: group.copy.history,
    },
    folded: foldedJson(group.folded),
    rows: group.rows.map(rowJson),
  };
}

function choiceCaseNotes(all, choiceCase) {
  const base = all.cases.find((entry) => entry.id === choiceCase.input.base_case);
  const notes = choiceCase.input.notes
    ? choiceCase.input.notes
    : JSON.parse(JSON.stringify(base.notes));
  if (Array.isArray(choiceCase.input.source_lines_after)) {
    notes[0].source_lines = choiceCase.input.source_lines_after;
  }
  return notes;
}

function collectChoiceCase(helpers, all, choiceCase) {
  return collectCase(helpers, { notes: choiceCaseNotes(all, choiceCase) });
}

module.exports = {
  CANONICAL_DIR,
  REQ_CLOSE_FIXTURE_FILES,
  fixtureDir,
  readFixture,
  sha256Hex,
  sourceOf,
  collectCase,
  collectChoiceCase,
  ownerJson,
  groupJson,
  rowJson,
};
