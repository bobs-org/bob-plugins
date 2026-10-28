// Shared task-cancel vectors: cancel/prune planners, cancel-label keys,
// config loader, and planRelationCancelEffects (§17).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

function parseYamlScalar(raw) {
  const value = String(raw ?? "").trim();
  if (value === "" || value === "null" || value === "~") return value === "" ? "" : null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (/^-?\d+$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stripYamlComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === "#" && !inSingle && !inDouble) {
      if (index === 0 || /\s/.test(line[index - 1])) {
        return line.slice(0, index);
      }
    }
  }
  return line;
}

function parseConfigYamlWithLists(text) {
  const root = {};
  const stack = [{ indent: -1, container: root, kind: "map", pendingKey: null }];
  for (const rawLine of String(text || "").split(/\n/)) {
    const stripped = stripYamlComment(rawLine).replace(/\s+$/u, "");
    if (!stripped.trim()) continue;
    const indent = stripped.match(/^\s*/)[0].length;
    const body = stripped.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (body.startsWith("- ")) {
      if (parent.kind === "map" && parent.pendingKey) {
        const list = [];
        parent.container[parent.pendingKey] = list;
        const listIndent =
          parent.pendingIndent != null ? parent.pendingIndent : parent.indent;
        parent.pendingKey = null;
        parent.pendingIndent = null;
        stack.push({
          indent: listIndent,
          container: list,
          kind: "list",
          pendingKey: null,
        });
      }
      const active = stack[stack.length - 1];
      if (active.kind !== "list") {
        throw new Error(`yaml list item without a list parent: ${body}`);
      }
      active.container.push(parseYamlScalar(body.slice(2)));
      continue;
    }
    const colon = body.indexOf(":");
    if (colon < 0) continue;
    const key = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1);
    const value = rest.trim() === "" ? undefined : parseYamlScalar(rest);
    if (parent.kind === "map" && parent.pendingKey && indent > parent.indent) {
      const nested = {};
      parent.container[parent.pendingKey] = nested;
      const nestedIndent =
        parent.pendingIndent != null ? parent.pendingIndent : parent.indent;
      parent.pendingKey = null;
      parent.pendingIndent = null;
      stack.push({
        indent: nestedIndent,
        container: nested,
        kind: "map",
        pendingKey: null,
      });
    }
    const owner = stack[stack.length - 1];
    if (owner.kind !== "map") continue;
    if (value === undefined) {
      owner.pendingKey = key;
      owner.pendingIndent = indent;
    } else {
      owner.container[key] = value;
      owner.pendingKey = null;
      if (Array.isArray(value) && value.length === 0) {
        stack.push({ indent, container: value, kind: "list", pendingKey: null });
      }
    }
  }
  return root;
}

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Modal: class {},
      Notice: class {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Plugin: EmptyClass,
      parseYaml: parseConfigYamlWithLists,
    };
  }
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const vectorsPath = path.join(
  __dirname,
  "../plugins/bob-navigation-hotkeys/scripts/fixtures/task_cancel/vectors.json",
);
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));

function skipRustOnly(vector) {
  return vector && vector.rust_only === true;
}

test("cancel vectors drive planTaskCancelBatch", () => {
  for (const vector of vectors.cancel || []) {
    if (skipRustOnly(vector)) continue;
    const lines = String(vector.content || "").split(/\n/);
    const session = {
      valid: true,
      targets: [
        {
          line: vector.line,
          rawLine: String(lines[vector.line] || ""),
        },
      ],
    };
    const plan = helpers.planTaskCancelBatch(vector.content, session, {
      date: vector.date,
      reason: vector.reason,
      fallbackReason: vector.fallbackReason,
    });
    const expected = vector.expected;
    assert.equal(plan.valid, expected.valid, vector.name);
    assert.equal(plan.recurring, expected.recurring, vector.name);
    assert.equal(plan.error, expected.error, vector.name);
    assert.equal(plan.content, expected.content, vector.name);
    assert.equal(plan.cancelledCount, expected.cancelledCount, vector.name);
    assert.equal(plan.skippedClosedCount, expected.skippedClosedCount, vector.name);
    assert.equal(plan.loggedCount, expected.loggedCount, vector.name);
    assert.equal(plan.createdLogCount, expected.createdLogCount, vector.name);
    assert.equal(
      plan.fallbackLoggedCount,
      expected.fallbackLoggedCount,
      vector.name,
    );
  }
});

test("prune vectors drive planDeferredPomodoroLinkCleanup", () => {
  for (const vector of vectors.prune || []) {
    if (skipRustOnly(vector)) continue;
    const noteIndex = helpers.createScheduledRecoveryNoteIndex(
      (vector.notePaths || []).map((entry) => ({ path: entry })),
    );
    const plan = helpers.planDeferredPomodoroLinkCleanup(
      vector.content,
      vector.targets,
      { dailyPath: vector.dailyPath, noteIndex },
    );
    const expected = vector.expected;
    assert.equal(plan.changed, expected.changed, vector.name);
    assert.equal(plan.content, expected.content, vector.name);
    assert.equal(plan.removedLinkCount, expected.removedLinkCount, vector.name);
    assert.equal(plan.removedBulletCount, expected.removedBulletCount, vector.name);
    assert.equal(plan.removedEntryCount, expected.removedEntryCount, vector.name);
    assert.equal(plan.unresolvedCount, expected.unresolvedCount, vector.name);
  }
});

test("rule vectors drive planRelationCancelEffects", () => {
  for (const vector of vectors.rule || []) {
    if (skipRustOnly(vector)) continue;
    const plan = helpers.planRelationCancelEffectsFromVector(vector);
    const planned = plan.sources[0];
    assert.ok(planned, vector.name);
    assert.equal(planned.verdict, vector.expected.verdict, vector.name);
    assert.equal(planned.cancels, vector.expected.cancels, vector.name);
  }
});

test("key vectors pin relationCancelLabelKey matching", () => {
  for (const vector of vectors.key || []) {
    if (skipRustOnly(vector)) continue;
    const key = helpers.relationCancelLabelKey(vector.input);
    assert.equal(key, vector.expected.key, vector.name);
    const configured = new Set(
      (vector.configured || []).map((entry) => helpers.relationCancelLabelKey(entry)),
    );
    assert.equal(configured.has(key), vector.expected.matches, vector.name);
  }
});

test("config vectors drive loadRelationsCancelLabels", () => {
  for (const vector of vectors.config || []) {
    if (skipRustOnly(vector)) continue;
    helpers.resetRelationsCancelLabelsConfigCache();
    helpers.resetRelationsLinkedFromLinesConfigCache();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    const fsModule = {
      statSync: () => ({ mtimeMs: 1, size: String(vector.yaml || "").length }),
      readFileSync: () => String(vector.yaml || ""),
    };
    try {
      const loaded = helpers.loadRelationsCancelLabels({
        configPath: "/test/config.yml",
        fsModule,
        parseYaml: parseConfigYamlWithLists,
      });
      helpers.loadRelationsLinkedFromLinesEnabled({
        configPath: "/test/config.yml",
        fsModule,
        parseYaml: parseConfigYamlWithLists,
      });
      assert.deepEqual(loaded.keys, vector.expected.keys, vector.name);
      assert.equal(warnings.length, vector.expected.warning_count, vector.name);
      if (vector.expected.linked_from_lines !== undefined) {
        helpers.resetRelationsLinkedFromLinesConfigCache();
        const enabled = helpers.loadRelationsLinkedFromLinesEnabled({
          configPath: "/test/config.yml",
          fsModule,
          parseYaml: parseConfigYamlWithLists,
        });
        assert.equal(enabled, vector.expected.linked_from_lines, vector.name);
      }
    } finally {
      console.warn = originalWarn;
      helpers.resetRelationsCancelLabelsConfigCache();
      helpers.resetRelationsLinkedFromLinesConfigCache();
    }
  }
});
