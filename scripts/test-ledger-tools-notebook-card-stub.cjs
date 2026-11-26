// Notebook Card kit scaffolding: the species phases fill the pre-created
// regions; this suite pins the kit seeds they build on.
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

test("the notebook kit seeds agree with the registry, gate, and coordinator", () => {
  assert.equal(H.NOTEBOOK_CARD_KIND, "notebook");
  assert.equal(H.propertyCardSpecies(H.NOTEBOOK_CARD_KIND).tile, "spine");
  assert.equal(H.propertyCardSpecies(H.NOTEBOOK_CARD_KIND).foldDefault, true);
  assert.equal(H.NOTEBOOK_CARD_HOST_KIND, "notebook");
  assert.equal(H.NOTEBOOK_CARD_MOUNT_ATTR, "data-notebook-source");
  assert.equal(H.NOTEBOOK_CARD_SURFACE_CLASS, "bob-notebook-card");
  assert.equal(H.NOTEBOOK_CARD_FOOT_KIND, "notebook");
  assert.equal(H.NOTEBOOK_CARD_READOUT_SLOT, "notebook-readouts");
  assert.equal(H.notebookCardStem("Notes/Developer tools.md"), "Developer tools");
  assert.equal(H.notebookCardStem("Notes/nested/Abby.md"), "Abby");
  assert.equal(H.notebookCardStem(""), "");
});
