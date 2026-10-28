const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

function scalar(raw) {
  const value = String(raw ?? "").trim();
  if (value === "" || value === "null" || value === "~") return value === "" ? "" : null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root, kind: "map", pending: null }];
  for (const raw of String(text || "").split(/\n/)) {
    const line = raw.replace(/\s+#.*$/u, "").replace(/\s+$/u, "");
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const body = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    let parent = stack[stack.length - 1];
    if (body.startsWith("- ")) {
      if (parent.kind === "map" && parent.pending) {
        const list = [];
        parent.value[parent.pending] = list;
        parent.pending = null;
        stack.push({ indent: parent.pendingIndent, value: list, kind: "list", pending: null });
        parent = stack[stack.length - 1];
      }
      if (parent.kind !== "list") throw new Error("invalid yaml list");
      parent.value.push(scalar(body.slice(2)));
      continue;
    }
    const colon = body.indexOf(":");
    if (colon < 0) continue;
    const key = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1).trim();
    const value = rest === "" ? undefined : scalar(rest);
    if (parent.kind === "map" && parent.pending && indent > parent.indent) {
      const nested = {};
      parent.value[parent.pending] = nested;
      stack.push({ indent: parent.pendingIndent, value: nested, kind: "map", pending: null });
      parent = stack[stack.length - 1];
    }
    if (parent.kind !== "map") continue;
    if (value === undefined) {
      parent.pending = key;
      parent.pendingIndent = indent;
    } else {
      parent.value[key] = value;
      parent.pending = null;
    }
  }
  return root;
}

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class {},
      Notice: class { constructor(message) { notices.push(String(message)); } },
      Plugin: class {},
      parseYaml,
    };
  }
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const vectors = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  "../plugins/bob-navigation-hotkeys/scripts/fixtures/relation_complete/vectors.json",
), "utf8"));

test("complete rule vectors share the explicit relation edge planner", () => {
  for (const vector of vectors.rule || []) {
    const complete = helpers.planRelationCompleteEffectsFromVector(vector).sources[0];
    const cancel = helpers.planRelationCancelEffectsFromVector(vector).sources[0];
    assert.ok(complete, vector.name);
    const expected = vector.expected;
    assert.equal(complete.completes, expected.effect === "complete", vector.name);
    if (expected.effect === "cancel") {
      assert.equal(cancel.verdict, "cancels", vector.name);
      assert.equal(complete.verdict, "none", vector.name);
    } else {
      assert.equal(complete.verdict, expected.verdict, vector.name);
    }
    if (expected.refusal) assert.equal(complete.refusal && complete.refusal.code, expected.refusal, vector.name);
  }
});

test("complete key vectors use the cancel writer's Unicode label key", () => {
  for (const vector of vectors.key || []) {
    const key = helpers.relationCancelLabelKey(vector.input);
    assert.equal(key, vector.expected.key, vector.name);
    const configured = new Set((vector.configured || []).map(helpers.relationCancelLabelKey));
    assert.equal(helpers.relationCompleteLabelsSet(configured).has(key), vector.expected.matches, vector.name);
  }
});

test("config vectors load both effective policies and keep linked-from warnings independent", () => {
  for (const vector of vectors.config || []) {
    helpers.resetRelationsCloseLabelsConfigCache();
    helpers.resetRelationsLinkedFromLinesConfigCache();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    const yaml = String(vector.yaml || "");
    const fsModule = {
      statSync: () => ({ mtimeMs: 1, size: yaml.length }),
      readFileSync: () => yaml,
    };
    try {
      const loaded = helpers.loadRelationsCloseLabels({
        configPath: "/test/config.yml",
        fsModule,
        parseYaml,
      });
      helpers.loadRelationsLinkedFromLinesEnabled({ configPath: "/test/config.yml", fsModule, parseYaml });
      assert.deepEqual(loaded.cancel.keys, vector.expected.cancel_keys, vector.name);
      assert.deepEqual(loaded.complete.keys, vector.expected.complete_keys, vector.name);
      assert.equal(warnings.length, vector.expected.warning_count, vector.name);
      if (vector.expected.linked_from_lines !== undefined) {
        helpers.resetRelationsLinkedFromLinesConfigCache();
        const enabled = helpers.loadRelationsLinkedFromLinesEnabled({ configPath: "/test/config.yml", fsModule, parseYaml });
        assert.equal(enabled, vector.expected.linked_from_lines, vector.name);
      }
    } finally {
      console.warn = originalWarn;
      helpers.resetRelationsCloseLabelsConfigCache();
      helpers.resetRelationsLinkedFromLinesConfigCache();
    }
  }
});

test("close-label config refreshes by mtime/size and clears on read failure", () => {
  helpers.resetRelationsCloseLabelsConfigCache();
  let yaml = "relations:\n  complete_labels:\n    - implemented by\n";
  let mtimeMs = 1;
  let fails = false;
  let reads = 0;
  const fsModule = {
    statSync: () => ({ mtimeMs, size: yaml.length }),
    readFileSync: () => {
      reads += 1;
      if (fails) throw new Error("unreadable");
      return yaml;
    },
  };
  const options = { configPath: "/test/config.yml", fsModule, parseYaml };
  assert.deepEqual(helpers.loadRelationsCloseLabels(options).complete.keys, ["implemented by"]);
  assert.deepEqual(helpers.loadRelationsCloseLabels(options).complete.keys, ["implemented by"]);
  assert.equal(reads, 1);
  yaml = "relations:\n  complete_labels:\n    - verified by\n";
  mtimeMs = 2;
  assert.deepEqual(helpers.loadRelationsCloseLabels(options).complete.keys, ["verified by"]);
  fails = true;
  mtimeMs = 3;
  assert.deepEqual(helpers.loadRelationsCloseLabels(options).complete.keys, []);
});

test("unchanged malformed close config warns once and overlap removes both policies", () => {
  helpers.resetRelationsCloseLabelsConfigCache();
  const warnings = [];
  const yaml = "relations:\n  cancel_labels:\n    - implemented by\n  complete_labels:\n    - implemented by\n    - verified by\n";
  const fsModule = {
    statSync: () => ({ mtimeMs: 1, size: yaml.length }),
    readFileSync: () => yaml,
  };
  const options = { configPath: "/test/config.yml", fsModule, parseYaml, warn: (message) => warnings.push(message) };
  const first = helpers.loadRelationsCloseLabels(options);
  helpers.loadRelationsCloseLabels(options);
  assert.deepEqual(first.cancel.keys, []);
  assert.deepEqual(first.complete.keys, ["verified by"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /both cancel_labels and complete_labels/);
});
