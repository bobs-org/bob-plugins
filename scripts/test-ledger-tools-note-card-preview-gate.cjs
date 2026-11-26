// Notebook/Prose kit: the preview gate keeps both new species off in the
// live vault until ledger-tools plugin data lists them.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

test("preview kinds parse from plugin data and ignore the rest", () => {
  assert.deepEqual(H.propertyCardPreviewKindsFromData({ cardPreviewKinds: ["notebook", "prose"] }), ["notebook", "prose"]);
  assert.deepEqual(H.propertyCardPreviewKindsFromData({ cardPreviewKinds: ["notebook"] }), ["notebook"]);
  assert.deepEqual(H.propertyCardPreviewKindsFromData({ cardPreviewKinds: ["notebook", "album"] }), ["notebook"]);
  assert.deepEqual(H.propertyCardPreviewKindsFromData({}), []);
  assert.deepEqual(H.propertyCardPreviewKindsFromData(null), []);
  assert.deepEqual(H.propertyCardPreviewKindsFromData({ cardPreviewKinds: "notebook" }), []);
  assert.deepEqual(H.propertyCardPreviewKindsFromData({ cardPreviewKinds: [42] }), []);
});

test("existing kinds are always live; notebook and prose need the gate", () => {
  for (const kind of ["album", "record", "day", "week", "quarter", "year", "bank", "area", "project"]) {
    assert.equal(H.propertyCardKindLive(null, kind), true, `${kind} stays live`);
    assert.equal(H.propertyCardKindLive({}, kind), true, `${kind} stays live without stored data`);
  }
  assert.equal(H.propertyCardKindLive(null, "notebook"), false);
  assert.equal(H.propertyCardKindLive(null, "prose"), false);
  assert.equal(H.propertyCardKindLive({}, "notebook"), false);
  assert.equal(H.propertyCardKindLive({ propertyCardPreviewKinds: ["notebook"] }, "notebook"), true);
  assert.equal(H.propertyCardKindLive({ propertyCardPreviewKinds: ["notebook"] }, "prose"), false);
  assert.equal(H.propertyCardKindLive({ propertyCardPreviewKinds: ["notebook", "prose"] }, "prose"), true);
  assert.equal(H.propertyCardKindLive(null, "mystery"), false);
  assert.equal(H.propertyCardKindLive({}, "mystery"), false);
});

test("the gate loads once from plugin data", async () => {
  const plugin = {};
  assert.deepEqual(await H.propertyCardPreviewLoad(plugin), []);
  assert.deepEqual(plugin.propertyCardPreviewKinds, []);
  assert.equal(H.propertyCardKindLive(plugin, "notebook"), false);

  const listed = { loadData: async () => ({ cardPreviewKinds: ["prose"] }) };
  assert.deepEqual(await H.propertyCardPreviewLoad(listed), ["prose"]);
  assert.equal(H.propertyCardKindLive(listed, "prose"), true);
  assert.equal(H.propertyCardKindLive(listed, "notebook"), false);

  const failing = { loadData: async () => { throw new Error("denied"); } };
  assert.deepEqual(await H.propertyCardPreviewLoad(failing), []);
  assert.equal(H.propertyCardKindLive(failing, "notebook"), false);
});

test("the coordinator mount attributes match the species hosts", () => {
  assert.equal(H.NOTEBOOK_CARD_MOUNT_ATTR, "data-notebook-source");
  assert.equal(H.PROSE_NOTE_CARD_MOUNT_ATTR, "data-prose-source");
  const mount = (source) => ({ getAttribute: (name) => (name === source ? "note.md" : null) });
  assert.equal(
    H.propertyCardFrontmatterMountPath(mount("data-notebook-source"), "notebook"),
    "note.md",
  );
  assert.equal(
    H.propertyCardFrontmatterMountPath(mount("data-prose-source"), "prose"),
    "note.md",
  );
});
