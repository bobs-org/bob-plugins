// Relation-successor authoring vectors (nav_authoring phase of
// plan:202611/starts_after_relation.md). Runs the shared
// `relation_successor/vectors.json` `config` and `key` sections plus the
// authoring `copy` cases through the nav helpers. SA22 (key match +
// inverse), SA23 (successor/complete overlap has no effect), SA30
// (already-parked / already-closed caveats).
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
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const parts = [];
    let current = "";
    let quote = null;
    for (const ch of inner) {
      if (quote) {
        current += ch;
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
      } else if (ch === ",") {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    parts.push(current);
    return parts.map((part) => scalar(part));
  }
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
  "../plugins/bob-navigation-hotkeys/scripts/fixtures/relation_successor/vectors.json",
), "utf8"));

function fakeCloseConfig(successorLabels) {
  const keys = [];
  const labels = {};
  const seen = new Set();
  for (const entry of successorLabels || []) {
    const normalized = helpers.normalizeRelationLabel
      ? helpers.normalizeRelationLabel(entry)
      : String(entry).trim();
    if (!normalized) continue;
    const key = helpers.relationCancelLabelKey(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    labels[key] = normalized;
  }
  const frozen = helpers.freezeRelationsCancelLabels
    ? helpers.freezeRelationsCancelLabels(keys, labels)
    : Object.freeze({ keys: Object.freeze(keys.slice()), labels: Object.freeze({ ...labels }) });
  return {
    cancel: helpers.emptyRelationsCancelLabels
      ? helpers.emptyRelationsCancelLabels()
      : Object.freeze({ keys: Object.freeze([]), labels: Object.freeze({}) }),
    complete: helpers.emptyRelationsCancelLabels
      ? helpers.emptyRelationsCancelLabels()
      : Object.freeze({ keys: Object.freeze([]), labels: Object.freeze({}) }),
    successor: frozen,
    warnings: Object.freeze([]),
  };
}

test("successor config vectors: three-list one-effect rule (SA23)", () => {
  for (const vector of vectors.config || []) {
    helpers.resetRelationsCloseLabelsConfigCache();
    const warnings = [];
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
        warn: (message) => warnings.push(String(message)),
      });
      assert.deepEqual(loaded.cancel.keys, vector.expected.cancel, vector.name);
      assert.deepEqual(loaded.complete.keys, vector.expected.complete, vector.name);
      assert.deepEqual(loaded.successor.keys, vector.expected.successor, vector.name);
      assert.equal(warnings.length, vector.expected.warnings, vector.name);
      // SA23: a key in two lists has no effect anywhere and warns once.
      if (vector.id === "SA23" || vector.id === "SU-C9" || vector.id === "SU-C10") {
        assert.equal(warnings.length, 1, vector.name);
        assert.match(warnings[0], /more than one of/, vector.name);
      }
      // The pre-existing cancel+complete overlap warning stays byte-identical.
      if (vector.id === "SU-C11") {
        assert.equal(warnings.length, 1, vector.name);
        assert.match(warnings[0], /both cancel_labels and complete_labels/, vector.name);
      }
    } finally {
      helpers.resetRelationsCloseLabelsConfigCache();
    }
  }
});

test("successor key vectors: match, effect, and inverse hint (SA22)", () => {
  for (const vector of vectors.key || []) {
    const key = helpers.relationCancelLabelKey(vector.label);
    assert.equal(key, vector.expected.key, vector.name);
    const closeConfig = fakeCloseConfig(vector.successor_labels);
    assert.equal(
      helpers.relationLabelEffectForKey(vector.label, closeConfig),
      vector.expected.effect,
      vector.name,
    );
    const inverse = vector.expected.inverse;
    if (typeof inverse === "string") {
      assert.equal(helpers.relationInverseForLabel(vector.label), inverse, vector.name);
    } else if (inverse && typeof inverse === "object") {
      const configured = helpers.relationSuccessorLabelForInverseKey(key, closeConfig);
      assert.equal(configured, inverse.label, vector.name);
      assert.equal(
        helpers.relationLabelEffectForKey(configured, closeConfig),
        inverse.effect,
        vector.name,
      );
    } else {
      assert.equal(helpers.relationInverseForLabel(vector.label), null, vector.name);
      assert.equal(helpers.relationSuccessorLabelForInverseKey(key, closeConfig), null, vector.name);
    }
  }
});

function copyById(id) {
  const found = (vectors.copy || []).find((entry) => entry.id === id);
  assert.ok(found, `missing copy vector ${id}`);
  return found;
}

test("successor copy vectors: row meta, verdict, caveats, hint, rename (SA30)", () => {
  const meta = copyById("SU-P23");
  assert.equal(helpers.relationSuccessorSuggestionMeta(), meta.expected.suggestion, "SU-P23 suggestion");
  assert.equal(helpers.relationSuccessorRowMeta(), meta.expected.relation_row, "SU-P23 relation row");

  const verdict = copyById("SU-P31");
  assert.equal(
    helpers.relationSuccessorOffersCopy(verdict.input.source, verdict.input.target),
    verdict.expected.message,
    "SU-P31 offers verdict",
  );

  const parked = copyById("SU-P24");
  assert.equal(
    helpers.relationSuccessorAlreadyParkedCopy(parked.input.source, parked.input.target),
    parked.expected.message,
    "SU-P24 already-parked caveat (SA30)",
  );
  const parkedPreview = helpers.relationSuccessorPreviewForAuthoring({
    sourceText: parked.input.source,
    targetText: parked.input.target,
    targetStatus: "/",
    targetLive: false,
  });
  assert.equal(parkedPreview.verdict, "already_parked", "SA30 parked verdict");
  assert.equal(parkedPreview.message, parked.expected.message, "SA30 parked message");

  const closed = copyById("SU-P25");
  assert.equal(
    helpers.relationSuccessorAlreadyClosedCopy(closed.input.target),
    closed.expected.message,
    "SU-P25 already-closed caveat (SA30)",
  );
  for (const status of ["x", "X", "-"]) {
    const preview = helpers.relationSuccessorPreviewForAuthoring({
      sourceText: "Prepare evaluation prompt",
      targetText: closed.input.target,
      targetStatus: status,
      targetLive: false,
    });
    assert.equal(preview.verdict, "already_closed", `SA30 closed verdict for ${status}`);
    assert.equal(preview.message, closed.expected.message, `SA30 closed message for ${status}`);
  }

  // Unknown release state shows no caveat: the plain offers message.
  const unknown = helpers.relationSuccessorPreviewForAuthoring({
    sourceText: verdict.input.source,
    targetText: verdict.input.target,
    targetStatus: "/",
    targetLive: null,
  });
  assert.equal(unknown.verdict, "offers", "unknown live link shows no caveat");
  assert.equal(unknown.message, verdict.expected.message, "unknown falls back to offers");

  const hint = copyById("SU-P26");
  assert.equal(
    helpers.relationSuccessorInverseHintCopy(hint.input.typed, hint.input.source, hint.input.label),
    hint.expected.hint.replace("use ~~ with", "use ⇧L with"),
    "SU-P26 inverse hint (nav says ⇧L)",
  );

  const rename = copyById("SU-P28");
  assert.equal(
    helpers.relationSuccessorRenameWarningCopy(rename.input.label),
    rename.expected.message,
    "SU-P28 rename warning",
  );
});

test("successor consequence strip shows offers, caveat, and hint", () => {
  const verdict = copyById("SU-P31");
  const parked = copyById("SU-P24");
  const hint = copyById("SU-P26");
  const offersPreview = {
    cancels: [],
    completes: [],
    configuredSuccessor: true,
    successorVerdict: "offers",
    successorMessage: verdict.expected.message,
    successorHint: "",
  };
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip({ kind: "relation-label", label: "starts after" }, { preview: offersPreview }),
    verdict.expected.message,
    "offers consequence strip",
  );
  const parkedPreview = {
    cancels: [],
    completes: [],
    configuredSuccessor: true,
    successorVerdict: "already_parked",
    successorMessage: parked.expected.message,
    successorHint: "",
  };
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip({ kind: "relation-label", label: "starts after" }, { preview: parkedPreview }),
    parked.expected.message,
    "SA30 parked consequence strip",
  );
  const hintPreview = {
    cancels: [],
    completes: [],
    configuredSuccessor: false,
    successorMessage: "",
    successorHint: helpers.relationSuccessorInverseHintCopy(hint.input.typed, hint.input.source, hint.input.label),
  };
  assert.equal(
    helpers.relationLabelCancelConsequenceStrip({ kind: "relation-label", label: "starts before" }, { preview: hintPreview }),
    helpers.relationSuccessorInverseHintCopy(hint.input.typed, hint.input.source, hint.input.label),
    "inverse hint consequence strip",
  );
});

test("successor suggestions overlay zero-use rows as configured", () => {
  const merged = helpers.mergeRelationSuccessorLabelSuggestions(
    [{ key: "see also", label: "see also", count: 4, hidden: false, inverse: null }],
    { keys: ["starts after"], labels: { "starts after": "starts after" } },
    "",
  );
  const overlay = merged.find((row) => row.key === "starts after");
  assert.ok(overlay, "zero-use successor label is suggested");
  assert.equal(overlay.configuredSuccessor, true, "overlay is marked configured");
  assert.equal(overlay.count, 0, "overlay starts at zero uses");
});
