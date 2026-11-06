// Project-promotion successor verdicts (cycler api v5,
// plan:202611/successor_card_verdicts.md promotion phase). Covers the nav
// side: descriptor attach and rule-11 gating, older-cycler fallback to
// today's pull-in-only card, closes applied after picks with the notice v4
// receipt, and the task-merge card staying pull-in-only.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  parseFrontmatterFromContent,
} = require("./navigation-hotkeys-harness.cjs");

function promotionDailyPath(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${year}${month}${day}.md`;
}

function createVerdictHarness(options) {
  const sourcePath = options.sourcePath || "Areas/Work.md";
  const sourceBasename = sourcePath.replace(/\.md$/i, "").split("/").pop();
  const sourceFile = { path: sourcePath, basename: sourceBasename, extension: "md" };
  const templatePath = "_templates/new_project.md";
  const templateFile = { path: templatePath, basename: "new_project", extension: "md" };
  const templateContent = [
    "- [ ] #task #prj (REPLACE WITH PROJECT COMPLETION CRITERIA) #hide ^prj",
    "",
    "## Tasks",
    "",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
  ].join("\n");
  const fileByPath = {
    [sourcePath]: sourceFile,
    [templatePath]: templateFile,
    "area.md": { path: "area.md", basename: "area", extension: "md" },
    "project.md": { path: "project.md", basename: "project", extension: "md" },
  };
  const contents = {
    [sourcePath]: options.sourceContent,
    [templatePath]: templateContent,
  };
  for (const extra of options.extraFiles || []) {
    const basename = extra.path.replace(/\.md$/i, "").split("/").pop();
    fileByPath[extra.path] = { path: extra.path, basename, extension: "md" };
    contents[extra.path] = extra.content;
  }
  const sourceLines = String(options.sourceContent || "").split(/\r?\n/);
  const cursorLine =
    options.cursorLine !== undefined
      ? options.cursorLine
      : sourceLines.findIndex((line) => /#task/.test(line));
  const editor = new TransactionEditor(options.sourceContent, {
    line: cursorLine < 0 ? 0 : cursorLine,
    ch: 0,
  });
  const view = {
    file: sourceFile,
    editor,
    save: async () => {
      contents[sourcePath] = editor.getValue();
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.promotionTodayForTests = options.today || new Date(2026, 8, 30);
  const templater = {
    create_new_note_from_template: async (template, folder, basename, open) => {
      const createdPath = `${basename}.md`;
      const createdFile = { path: createdPath, basename, extension: "md" };
      fileByPath[createdPath] = createdFile;
      contents[createdPath] = contents[templatePath];
      return createdFile;
    },
  };
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
    },
    vault: {
      process: async (file, fn) => {
        const next = fn(contents[file.path]);
        contents[file.path] = next;
        return next;
      },
      read: async (file) => {
        if (!Object.prototype.hasOwnProperty.call(contents, file.path)) {
          throw new Error(`missing ${file.path}`);
        }
        return contents[file.path];
      },
      cachedRead: async (file) => {
        if (!Object.prototype.hasOwnProperty.call(contents, file.path)) {
          throw new Error(`missing ${file.path}`);
        }
        return contents[file.path];
      },
      getMarkdownFiles: () => Object.values(fileByPath),
      getAbstractFileByPath: (path) => fileByPath[path] || null,
      getRoot: () => "",
    },
    fileManager: {
      processFrontMatter: async (file, fn) => {
        const frontmatter = {};
        fn(frontmatter);
        return frontmatter;
      },
    },
    metadataCache: {
      getBacklinksForFile: () => ({ data: {} }),
      getFirstLinkpathDest: (linkText) => {
        const name = String(linkText || "").replace(/\.md$/i, "").split("/").pop();
        const matches = Object.values(fileByPath).filter((file) => file.basename === name);
        return matches[0] || null;
      },
      getFileCache: (file) => {
        if (!file) return null;
        if (file.path === sourcePath) return { frontmatter: { type: "[[area]]" } };
        return { frontmatter: parseFrontmatterFromContent(contents[file.path]) };
      },
    },
    plugins: {
      plugins: {
        "templater-obsidian": { templater },
        ...(options.cyclerApi ? { "task-status-cycler": { api: options.cyclerApi } } : {}),
      },
    },
  };
  plugin.api = { successors: { version: 4, pick: async () => null } };
  plugin.getOpenMarkdownEditorForPath = () => null;
  plugin.pickSuccessorOffers = options.pickSuccessorOffers || (async () => null);
  plugin.focusTaskMoveDestination = async () => true;
  plugin.restoreGuardedSnapshots = async () => true;
  return { plugin, editor, view, contents, fileByPath };
}

function fakeCyclerApi(contents, seen) {
  return {
    version: 5,
    describeOfferCloses: async ({ rows }) => {
      seen.described = (seen.described || []).concat(rows.map((row) => row.key));
      const descriptors = {};
      for (const row of rows || []) {
        descriptors[row.key] = {
          complete: true,
          cancel: true,
          completeConsequence: `✓ Completes “${row.text}” · Ready → Done`,
          cancelConsequence: `⊘ Cancels “${row.text}” · Ready → Cancelled`,
          unblocks: 0,
        };
      }
      return { descriptors, supported: true };
    },
    applyOfferCloses: async ({ closes, expectedLines }) => {
      seen.applied = { closes, expectedLines };
      const offerCloses = [];
      for (const close of closes || []) {
        const expected = expectedLines[close.key];
        let closed = false;
        for (const [path, text] of Object.entries(contents)) {
          if (typeof text !== "string" || !text.includes(expected)) continue;
          contents[path] = String(text).split("\n").map((line) =>
            line === expected
              ? line.replace("[ ]", "[x] [completion:: 2026-09-30]")
              : line,
          ).join("\n");
          closed = true;
        }
        assert.ok(closed, `fake cycler could not close ${close.key}`);
        offerCloses.push({
          key: close.key,
          outcome: close.outcome,
          text: close.key,
          message: `✓ completed “${close.key}” · Ready → Done`,
          recovered: [],
        });
      }
      return {
        offer_closes: offerCloses,
        offer_close_refused: null,
        undo: null,
        resolved: [],
        failures: null,
      };
    },
  };
}

test("promotion rows skip muted rows for the engine", () => {
  const rows = helpers.promotionSuccessorCloseRows({
    rows: [
      { key: "P.md#^a", text: "A", notePath: "P.md", status: " ", selectable: true, line: 1, rawLine: "- [ ] #task A ^a", blockId: "a" },
      { key: "P.md#^b", text: "B", notePath: "P.md", status: "?", selectable: false, line: 2, rawLine: "- [?] #task B", blockId: null },
      { key: "", text: "C", notePath: "P.md", status: " ", selectable: true, line: 3, rawLine: "- [ ] #task C", blockId: null },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "P.md#^a");
});

test("promotion model attaches closes only with an eligible row", () => {
  const model = {
    title: "Promoted to project · pull in successors",
    predecessors: [],
    groups: [{
      group: "project",
      header: "",
      project: "P.md",
      rows: [
        { key: "P.md#^a", text: "A", notePath: "P.md", status: " ", selectable: true },
        { key: "P.md#^b", text: "B", notePath: "P.md", status: " ", selectable: true },
      ],
      folded: {},
    }],
  };
  const enriched = helpers.promotionModelWithOfferCloses(model, {
    "P.md#^a": { complete: true, cancel: true, completeConsequence: "✓", unblocks: 0 },
    "P.md#^b": { complete: false, cancel: false, why: "nope", unblocks: 0 },
  });
  assert.equal(enriched.close.supported, true);
  assert.equal(enriched.groups[0].rows[0].close.complete, true);
  assert.equal(enriched.groups[0].rows[1].close.complete, false);
  assert.equal(model.close, undefined, "the input model is not mutated");

  const refusedOnly = helpers.promotionModelWithOfferCloses(model, {
    "P.md#^a": { complete: false, cancel: false, why: "nope", unblocks: 0 },
  });
  assert.equal(refusedOnly, model, "no eligible row keeps today's card");
});

test("promotion cycler detection requires v5 with both methods", () => {
  const v5 = { version: 5, describeOfferCloses: async () => ({}), applyOfferCloses: async () => ({}) };
  assert.equal(helpers.promotionOfferCloseCyclerApi({ plugins: { plugins: { "task-status-cycler": { api: v5 } } } }), v5);
  const v4 = { version: 4, describeOfferCloses: async () => ({}), applyOfferCloses: async () => ({}) };
  assert.equal(helpers.promotionOfferCloseCyclerApi({ plugins: { plugins: { "task-status-cycler": { api: v4 } } } }), null);
  const partial = { version: 5, describeOfferCloses: async () => ({}) };
  assert.equal(helpers.promotionOfferCloseCyclerApi({ plugins: { plugins: { "task-status-cycler": { api: partial } } } }), null);
  assert.equal(helpers.promotionOfferCloseCyclerApi({ plugins: { plugins: {} } }), null);
});

test("task-merge model carries no close support", () => {
  const model = helpers.taskMergeOfferPickerModel(
    { offers: [{ key: "T.md#^a", entry_name: "E", merged_from: "M" }], targetTitle: "Target", targetPath: "T.md" },
    "merged into",
  );
  assert.equal(model.close, undefined);
  for (const group of model.groups) {
    for (const row of group.rows) assert.equal(row.close, undefined);
  }
});

test("promotion with closes applies them after picks with a v4 receipt", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const seen = {};
  let pickedModel = null;
  const sourceContent = [
    "---", 'type: "[[area]]"', "---", "", "## Tasks", "",
    "- [*] #task Ship it ^ship",
    "\t- [ ] #task Design ^design",
    "\t- [ ] #task Test",
  ].join("\n");
  const harness = createVerdictHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [{
      path: todayPath,
      content: ["## Pomodoros", "", "- [ ] (**0930-1000**) — BUILD", "  - [[Areas/Work#^ship]]"].join("\n"),
    }],
    cyclerApi: null,
    pickSuccessorOffers: async (model) => {
      pickedModel = model;
      const design = model.groups[0].rows.find((row) => String(row.key || "").endsWith("#^design"));
      assert.ok(design, "expected the Design row in the card");
      return { picks: [], closes: [{ key: design.key, outcome: "done" }] };
    },
  });
  harness.plugin.app.plugins.plugins["task-status-cycler"] = {
    api: fakeCyclerApi(harness.contents, seen),
  };
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.ok(pickedModel, "expected the picker to open");
  assert.equal(pickedModel.close.supported, true);
  const designRow = pickedModel.groups[0].rows.find((row) => String(row.key || "").endsWith("#^design"));
  assert.ok(designRow, "expected the Design row in the picked model");
  assert.equal(designRow.close.complete, true);
  assert.ok(seen.described.length > 0, "expected describe before pick");
  assert.ok(seen.applied, "expected applyOfferCloses after picks");
  assert.equal(seen.applied.closes.length, 1);
  assert.equal(seen.applied.closes[0].outcome, "done");
  assert.ok(seen.applied.expectedLines[seen.applied.closes[0].key], "expected card preimages");
  const createdPath = Object.keys(harness.contents).find((path) =>
    path !== "Areas/Work.md" && path !== todayPath && path !== "_templates/new_project.md");
  assert.match(harness.contents[createdPath], /- \[x\].*#task Design/);
  assert.ok(
    notices.some((message) => /completed.*Ready → Done/.test(String(message))),
    `expected the closes receipt in notices: ${JSON.stringify(notices.slice(-2))}`,
  );
});

test("promotion with an older cycler keeps today's pull-in-only card", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  let pickedModel = null;
  const sourceContent = [
    "---", 'type: "[[area]]"', "---", "", "## Tasks", "",
    "- [*] #task Ship it ^ship",
    "\t- [ ] #task Design ^design",
  ].join("\n");
  const harness = createVerdictHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [{
      path: todayPath,
      content: ["## Pomodoros", "", "- [ ] (**0930-1000**) — BUILD", "  - [[Areas/Work#^ship]]"].join("\n"),
    }],
    cyclerApi: { version: 4 },
    pickSuccessorOffers: async (model) => {
      pickedModel = model;
      return { picks: [{ key: model.groups[0].rows[0].key }] };
    },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.ok(pickedModel, "expected the picker to open");
  assert.equal(pickedModel.close, undefined, "no close support from an older cycler");
  assert.ok(
    notices.every((message) => !/completed.*Ready → Done/.test(String(message))),
    "no closes receipt without verdicts",
  );
});
