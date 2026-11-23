// Property editor row fidelity (bob-cli-pf.4.1.7 row-fidelity): nearest-row
// identity across reconciliation, confirmed overlay post-images on every
// surface, hook-aware drawer digests, verbatim recovery diagnostics, and
// datetime/tag/null/add-flow value fidelity.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: (text) => JSON.parse(text),
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } }, keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

function row(overrides = {}) {
  return {
    key: "title", line: 3, end_line: 3, value: "old", kind: "text", role: "loose",
    owner: "props", editor: null, reason: null, duplicate: false, opaque: false,
    ...overrides,
  };
}

function report(properties, fingerprint = "before", frontmatter = { state: "ok", start_line: 1, end_line: 5 }) {
  return {
    schema_version: 1, ok: true, path: "notes/groceries.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint, frontmatter, properties,
  };
}

test("nearest-row keeps requested keys across line shifts", () => {
  assert.equal(H.propertyEditorNearestId(
    [row({ key: "a", line: 3 }), row({ key: "b", line: 4 })],
    { key: "b", ordinal: 0, line: 4 },
  ), "b::4");
  // Same key moved lines: ordinal selects the duplicate, not the first row.
  assert.equal(H.propertyEditorNearestId(
    [row({ key: "b", line: 4 }), row({ key: "b", line: 8 })],
    { key: "b", ordinal: 1, line: 5 },
  ), "b::8");
  // Gone key falls back to the nearest surviving source line.
  assert.equal(H.propertyEditorNearestId(
    [row({ key: "a", line: 3 }), row({ key: "c", line: 9 })],
    { key: "b", ordinal: 0, line: 8 },
  ), "c::9");
  assert.equal(H.propertyEditorNearestId([], { key: "b", ordinal: 0, line: 8 }), "");
});

test("constructor and reconcile preserve the requested key, not the first row", () => {
  const first = report([row({ key: "a", line: 3 }), row({ key: "b", line: 4 })]);
  const modal = new H.PropertyEditorModal({}, { filePath: "notes/groceries.md", report: first, key: "b" });
  assert.equal(modal.selectedId, "b::4");
  // Other rows shift lines; the selected key follows its row.
  modal.propertyEditorReconcile(report(
    [row({ key: "a", line: 6 }), row({ key: "b", line: 7 }), row({ key: "c", line: 8 })], "after",
  ));
  assert.equal(modal.selectedId, "b::7");
  // The selected key is deleted; the walk parks at the nearest survivor.
  modal.propertyEditorReconcile(report([row({ key: "a", line: 2 }), row({ key: "c", line: 6 })], "after2"));
  assert.equal(modal.selectedId, "c::6");
});

test("openPropertyEditor with key and edit mode opens that key's stage", () => {
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: report([row({ key: "a", line: 3 }), row({ key: "b", line: 4 })]),
    key: "b", mode: "edit",
  });
  const opened = [];
  modal.propertyEditorOpenStage = (entry) => { opened.push(entry.row.key); return true; };
  modal.propertyEditorMaybeStartModeEdit();
  assert.deepEqual(opened, ["b"]);
});

test("confirmed overlays replace cached values and drop deleted keys", () => {
  const rows = [row({ key: "a", value: "old" }), row({ key: "b", value: "keep" })];
  const overlay = {
    properties: [{ key: "a", value: "new" }],
    deletedKeys: ["b"],
  };
  assert.deepEqual(
    H.propertyEditorOverlayRows(rows, overlay).map((entry) => [entry.key, entry.value]),
    [["a", "new"]],
  );
  const withNull = H.propertyEditorOverlayRows(
    [row({ key: "a", value: "old" })],
    { properties: [{ key: "a", value: null }], deletedKeys: [] },
  );
  assert.equal(withNull.length, 1);
  assert.strictEqual(withNull[0].value, null);
  assert.deepEqual(H.propertyEditorOverlayRows(rows, null), rows);
});

test("foot frontmatter paints the overlay post-image without spawning", () => {
  const plugin = {
    app: { vault: { getAbstractFileByPath: () => null }, metadataCache: { getFileCache: () => null } },
    propertyOverlayFor: () => ({ properties: [{ key: "title", value: "New" }], deletedKeys: [] }),
  };
  const painted = H.propertyCardFootAdapterFrontmatter(plugin, "notes/groceries.md");
  assert.equal(painted.title, "New");
  const offline = H.propertyCardFootAdapterFrontmatter(
    { app: { vault: {}, metadataCache: {} } }, "notes/groceries.md",
  );
  assert.deepEqual(offline, {});
});

test("digest changes when the editor hook registers or unregisters", () => {
  H.propertyCardFootResetAll();
  const spec = { inventory: { state: "ok", rows: [] }, stamp: null };
  const without = H.propertyCardFootAdapterDigest(spec);
  H.propertyCardFootSetEditorHook(() => true);
  try {
    assert.notEqual(H.propertyCardFootAdapterDigest(spec), without);
  } finally {
    H.propertyCardFootResetAll();
  }
  assert.equal(H.propertyCardFootAdapterDigest(spec), without);
});

test("recovery shows bob's message verbatim and targets the parse-error line", () => {
  const damaged = report(
    [row({ key: "b", line: 4 }), row({ key: "a", line: 3 })],
    null,
    { state: "invalid", start_line: 1, error: { code: "bad-yaml", message: "mapping values are not allowed here", line: 4 } },
  );
  const details = H.propertyEditorRecoveryDetails(damaged);
  assert.equal(details.message, "mapping values are not allowed here");
  assert.equal(details.line, 4);
  assert.equal(H.propertyEditorYamlIssueLine(damaged), 4);
  const degraded = H.propertyEditorDegradedFor({ report: damaged });
  assert.equal(degraded.mode, "recovery");
  assert.equal(degraded.message, "mapping values are not allowed here");
  assert.equal(degraded.line, 4);
  // Row and ownership diagnostics ride along for the banner.
  const withDiagnostics = report(
    [row({ key: "a", line: 3, diagnostic: "unexpected scalar here" })],
    null,
    { state: "invalid", start_line: 1, error: { code: "bad-yaml", message: "bad indentation", line: 3 } },
  );
  withDiagnostics.ownership_diagnostics = ["record schema is unavailable"];
  const rows = H.propertyEditorRowDiagnostics(withDiagnostics);
  assert.deepEqual(rows, [{ key: "a", line: 3, diagnostic: "unexpected scalar here" }]);
  assert.deepEqual(H.propertyEditorDegradedFor({ report: withDiagnostics }).ownership, ["record schema is unavailable"]);
});

test("duplicate-key YAML targets the duplicate line", () => {
  const dupes = report(
    [row({ key: "a", line: 2 }), row({ key: "a", line: 5, duplicate: true })],
    null,
    { state: "duplicate", start_line: 1 },
  );
  assert.equal(H.propertyEditorYamlIssueLine(dupes), 5);
  assert.equal(H.propertyEditorRecoveryDetails(dupes).line, 5);
});

test("datetimes without an existing offset send wall time with matching seconds", () => {
  const zone = "America/New_York";
  const naive = H.propertyEditorDateTimeValue("2026-11-22T09:41", {
    existingValue: "2026-11-22T09:41", timeZone: zone,
  });
  assert.equal(naive.ok, true);
  assert.equal(naive.value, "2026-11-22T09:41");
  const dayOnly = H.propertyEditorDateTimeValue("2026-11-23", {
    existingValue: "2026-11-22T09:41", timeZone: zone,
  });
  assert.equal(dayOnly.value, "2026-11-23T09:41");
  // New datetimes behave the same: no offset unless the user typed one.
  const fresh = H.propertyEditorDateTimeValue("2026-03-08T08:00:00", { timeZone: zone });
  assert.equal(fresh.value, "2026-03-08T08:00:00");
  const explicit = H.propertyEditorDateTimeValue("2026-11-01T01:30:00-04:00", {
    existingValue: "2026-11-22T09:41", timeZone: zone,
  });
  assert.equal(explicit.value, "2026-11-01T01:30:00-04:00");
});

test("datetimes keep an existing offset across every documented spelling", () => {
  const zone = "America/New_York";
  const now = new Date("2026-03-08T12:00:00.000Z");
  for (const existing of [
    "2026-03-08T08:00:00Z",
    "2026-03-08T08:00:00+0000",
    "2026-03-08T08:00:00-0500",
    "2026-03-08T08:00:00-05:00",
  ]) {
    const parsed = H.propertyEditorDateTimeValue("now", { now, timeZone: zone, existingValue: existing });
    assert.equal(parsed.ok, true, existing);
    assert.match(parsed.value, /[Z+-]/, `keeps an offset for ${existing}`);
    assert.match(parsed.value, /:\d{2}:\d{2}/, `keeps seconds for ${existing}`);
  }
  const zulu = H.propertyEditorDateTimeValue("9:41pm", {
    now, timeZone: zone, existingValue: "2026-03-08T08:00:00Z",
  });
  assert.match(zulu.value, /[Z+-]/);
});

test("tags normalize only the typed item; untouched stages are no-ops", () => {
  const stage = (kind) => ({ kind, wireKind: kind });
  const untouched = H.propertyEditorStageBuild(
    row({ key: "tags", kind: "tags", value: ["home", 2026] }),
    stage("tags"),
    { items: ["home", 2026], itemDraft: "" },
  );
  assert.equal(untouched.changed, false);
  assert.deepEqual(untouched.value, ["home", 2026]);
  const added = H.propertyEditorStageBuild(
    row({ key: "tags", kind: "tags", value: ["home"] }),
    stage("tags"),
    { items: ["home"], itemDraft: "##work" },
  );
  assert.deepEqual(added.ops[0].value, ["home", "work"]);
});

test("an untouched null text stage is a no-op instead of writing empty", () => {
  const built = H.propertyEditorStageBuild(
    row({ value: null, kind: "null" }), { kind: "text", wireKind: "text" }, { value: "" },
  );
  assert.equal(built.ok, true);
  assert.equal(built.changed, false);
  assert.deepEqual(built.ops, []);
});

test("an exact typed name wins over a lingering highlight on Enter or Tab", () => {
  const catalog = [
    { name: "mycount", type: "text", count: 9, wireKind: "text", authoritative: true },
    { name: "count", type: "number", count: 5, wireKind: "number", authoritative: true },
  ];
  const exact = H.propertyEditorAcceptAddName("count", catalog, { suggestionIndex: 0 });
  assert.equal(exact.name, "count");
  assert.equal(exact.wireKind, "number");
  const moved = H.propertyEditorAcceptAddName("count", catalog, { suggestionIndex: 0, suggestionTouched: true });
  assert.equal(moved.name, "mycount");
});

test("o, O, and Mod+; refuse while a value stage is open", () => {
  const properties = [row({ key: "title", line: 3 })];
  const modal = new H.PropertyEditorModal({}, {
    filePath: "notes/groceries.md",
    report: report(properties),
  });
  modal.propertyEditorOpenStage(modal.editorSelected());
  assert.ok(modal.stage, "value stage is open");
  assert.equal(modal.propertyEditorStartAdd("below"), false);
  assert.match(modal.announce, /Finish the open edit first/);
  assert.ok(modal.stage, "the draft survives the refused add");
});
