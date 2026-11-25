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
    EditorView: { updateListener: { of: (listener) => ({ listener }) } },
    keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

test("parent stage handler is registered with kind parent", () => {
  const handler = H.propertyEditorSettingStageHandler("parent");
  assert.ok(handler);
  assert.equal(handler.kind, "parent");
});

test("parent stage build writes one quoted wikilink op", () => {
  const entry = { row: { settingId: "parent", settingKeys: ["parent"], settingDeclared: true, settingValue: "[[dev]]", effectiveValue: "[[dev]]" } };
  const stage = { settingId: "parent", parentPickPath: "love.md", value: "love" };
  const built = H.propertyEditorParentStageBuild(entry, stage, { value: "love" });
  assert.equal(built.ok, true);
  assert.deepEqual(built.ops, [{ op: "setting.set", setting: "parent", value: "[[love]]" }]);
});

test("parent stage build refuses an empty home", () => {
  const entry = { row: { settingId: "parent", settingKeys: ["parent"], settingDeclared: true, settingValue: "[[dev]]", effectiveValue: "[[dev]]" } };
  const built = H.propertyEditorParentStageBuild(entry, { settingId: "parent", parentPickPath: "" }, { value: "   " });
  assert.equal(built.ok, false);
});

test("parent sync names run exactly the catalogs bob named", () => {
  const report = {
    effects: [
      { setting: "parent", kind: "hue", message: "Hue teal → blue" },
      { setting: "parent", kind: "syncs", message: "Syncs areas, projects catalogs", syncs: ["areas", "projects"] },
      { setting: "color", kind: "inherited", message: "Applies to 2 notes below" },
    ],
  };
  assert.deepEqual(H.propertyEditorParentSyncNames(report, "parent"), ["areas", "projects"]);
  assert.deepEqual(H.propertyEditorParentSyncNames({ effects: [] }, "parent"), []);
  assert.deepEqual(H.propertyEditorParentSyncNames({ effects: [{ setting: "parent", kind: "syncs", syncs: ["areas", "bogus"] }] }, "parent"), ["areas"]);
});

test("parent sync report names refreshed catalogs and failed syncs", () => {
  assert.equal(
    H.propertyEditorParentSyncReport(["areas", "projects"], [{ name: "areas", ok: true }, { name: "projects", ok: true }]),
    "✓ Moved · 2 catalogs refreshed · u undo",
  );
  const failed = H.propertyEditorParentSyncReport(["areas"], [{ name: "areas", ok: false, message: "areas sync failed." }]);
  assert.match(failed, /areas sync failed/);
  assert.match(failed, /Undo still works/);
});

test("parent stem parsing strips brackets, anchors, and extensions", () => {
  assert.equal(H.propertyEditorParentStemOf("[[dev]]"), "dev");
  assert.equal(H.propertyEditorParentStemOf("[[dev|Dev]]"), "dev");
  assert.equal(H.propertyEditorParentStemOf("love.md"), "love");
  assert.equal(H.propertyEditorParentLinkFor("love"), "[[love]]");
});
