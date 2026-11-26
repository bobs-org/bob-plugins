// Ref kit: the ref-owned preview gate keeps Ref Cards off until `ref-go-live`
// and never reads qm's `cardPreviewKinds`.
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

test("the ref gate reads refCardPreview once", async () => {
  assert.equal(H.REF_CARD_PREVIEW_KEY, "refCardPreview");
  assert.equal(H.refCardPreviewFromData({ refCardPreview: true }), true);
  assert.equal(H.refCardPreviewFromData({ refCardPreview: false }), false);
  assert.equal(H.refCardPreviewFromData({}), false);
  assert.equal(H.refCardPreviewFromData(null), false);
  assert.equal(H.refCardPreviewLive({ refCardPreview: true }), true);
  assert.equal(H.refCardPreviewLive({}), false);
  assert.equal(H.refCardPreviewLive(null), false);

  const closed = {};
  assert.equal(await H.refCardPreviewLoad(closed), false);
  assert.equal(H.refCardPreviewLive(closed), false);

  const open = { loadData: async () => ({ refCardPreview: true }) };
  assert.equal(await H.refCardPreviewLoad(open), true);
  assert.equal(H.refCardPreviewLive(open), true);

  const failing = { loadData: async () => { throw new Error("denied"); } };
  assert.equal(await H.refCardPreviewLoad(failing), false);
});

test("the ref gate ignores cardPreviewKinds", async () => {
  const qmOnly = { loadData: async () => ({ cardPreviewKinds: ["notebook", "prose"] }) };
  assert.equal(await H.refCardPreviewLoad(qmOnly), false);
  assert.equal(H.refCardPreviewLive(qmOnly), false);
  assert.equal(H.refCardPreviewLive({ refCardPreview: true, propertyCardPreviewKinds: [] }), true);
  assert.equal(H.refCardPreviewLive({ refCardPreview: false, propertyCardPreviewKinds: ["notebook"] }), false);
});
