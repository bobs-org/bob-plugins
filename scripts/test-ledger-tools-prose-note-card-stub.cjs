// Prose Card kit scaffolding: the species phases fill the pre-created
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

test("the prose kit seeds agree with the registry, gate, and coordinator", () => {
  assert.equal(H.PROSE_NOTE_CARD_KIND, "prose");
  assert.equal(H.propertyCardSpecies(H.PROSE_NOTE_CARD_KIND).tile, "folio");
  assert.equal(H.propertyCardSpecies(H.PROSE_NOTE_CARD_KIND).foldDefault, false);
  assert.equal(H.PROSE_NOTE_CARD_HOST_KIND, "prose");
  assert.equal(H.PROSE_NOTE_CARD_MOUNT_ATTR, "data-prose-source");
  assert.equal(H.PROSE_NOTE_CARD_SURFACE_CLASS, "bob-prose-note-card");
  assert.equal(H.PROSE_NOTE_CARD_FOOT_KIND, "prose");
  assert.equal(H.PROSE_NOTE_CARD_OUTLINE_SLOT, "prose-outline");
  // The stem fallback is verbatim: no humanizing, no case folding.
  assert.equal(H.proseNoteCardStem("Notes/Why I built SASE.md"), "Why I built SASE");
  assert.equal(H.proseNoteCardStem("blog/sase_blog_contents.md"), "sase_blog_contents");
  assert.equal(H.proseNoteCardStem(""), "");
});
