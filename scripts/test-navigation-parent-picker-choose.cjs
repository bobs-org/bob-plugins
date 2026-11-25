const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");

const {
  buildParentPickerIndex,
  createParentPickerApi,
  parentPickerChooseValidate,
} = helpers;

function noteInfo(kind) {
  if (kind === "area") return { kind: "area", decorated: true, statusKey: "", label: "Area" };
  if (kind === "project") return { kind: "project", decorated: true, statusKey: "wip", label: "WIP" };
  return { kind: "plain", decorated: false, statusKey: "", label: "" };
}

function rec(path, extras = {}) {
  const basename = path.split("/").pop().replace(/\.md$/, "");
  return {
    path,
    basename,
    noteInfo: extras.noteInfo || noteInfo("plain"),
    ruleKind: extras.ruleKind || "other",
    parentPath: extras.parentPath || null,
    recentRank: extras.recentRank,
    file: extras.file || { path, basename, extension: "md" },
  };
}

function pluginWith(records, byPathParent = new Map()) {
  void byPathParent;
  return {
    parentChangeLiveIndex(sourcePath) {
      return buildParentPickerIndex(records, { sourcePath });
    },
    collectParentPickerRecords() {
      return records.slice();
    },
    app: { vault: { getAbstractFileByPath: (p) => ({ path: p, basename: p.split("/").pop().replace(/\.md$/, "") }) } },
  };
}

test("parentPicker list ranks the current parent first on an empty query", () => {
  const records = [
    rec("dev.md", { noteInfo: noteInfo("area"), ruleKind: "area" }),
    rec("sase.md", { noteInfo: noteInfo("project"), ruleKind: "project", parentPath: "dev.md" }),
    rec("love.md", { noteInfo: noteInfo("area"), ruleKind: "area" }),
  ];
  const plugin = pluginWith(records);
  const api = createParentPickerApi(plugin);
  assert.equal(api.version, 1);
  const result = api.list("sase.md", "");
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.items) && result.items.length > 0);
  assert.equal(result.currentParentPath, "dev.md");
  assert.equal(result.items[0].path, "dev.md");
  assert.equal(result.items[0].current, true);
});

test("parentPicker validate refuses cycles and wrong kinds without writing", () => {
  const records = [
    rec("dev.md", { noteInfo: noteInfo("area"), ruleKind: "area" }),
    rec("sase.md", { noteInfo: noteInfo("project"), ruleKind: "project", parentPath: "dev.md" }),
    rec("child.md", { noteInfo: noteInfo("project"), ruleKind: "project", parentPath: "sase.md" }),
    rec("notebook.md", { noteInfo: { kind: "notebook" }, ruleKind: "notebook" }),
  ];
  const plugin = pluginWith(records);
  const bytesBefore = JSON.stringify(records);
  const cycle = parentPickerChooseValidate(plugin, "sase.md", "child.md");
  assert.equal(cycle.ok, false);
  assert.equal(cycle.reason, "cycle");
  const self = parentPickerChooseValidate(plugin, "sase.md", "sase.md");
  assert.equal(self.ok, false);
  assert.equal(JSON.stringify(records), bytesBefore);
  void notices;
});

test("parentPicker choose with a candidate path resolves without writing", async () => {
  const records = [
    rec("dev.md", { noteInfo: noteInfo("area"), ruleKind: "area" }),
    rec("sase.md", { noteInfo: noteInfo("project"), ruleKind: "project", parentPath: "dev.md" }),
    rec("love.md", { noteInfo: noteInfo("area"), ruleKind: "area" }),
  ];
  const plugin = pluginWith(records);
  const api = createParentPickerApi(plugin);
  const picked = await api.choose("sase.md", { candidatePath: "love.md" });
  assert.equal(picked.ok, true);
  assert.equal(picked.path, "love.md");
  assert.equal(picked.basename, "love");
  const missing = await api.choose("sase.md", { candidatePath: "nope.md" });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "not-found");
});
