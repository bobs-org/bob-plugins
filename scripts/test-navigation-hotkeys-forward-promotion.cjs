const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
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

function createProjectForwardHarness(options) {
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
    save:
      options.save ||
      (async () => {
        contents[sourcePath] = editor.getValue();
      }),
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.promotionTodayForTests = options.today || new Date(2026, 8, 30);
  plugin.app = {
    workspace: {
      getLeavesOfType: () => options.leaves || [],
      getActiveViewOfType: () => null,
    },
    vault: {
      process:
        options.process ||
        (async (file, fn) => {
          const next = fn(contents[file.path]);
          contents[file.path] = next;
          return next;
        }),
      read:
        options.read ||
        (async (file) => {
          if (!Object.prototype.hasOwnProperty.call(contents, file.path)) {
            throw new Error(`missing ${file.path}`);
          }
          return contents[file.path];
        }),
      cachedRead:
        options.cachedRead ||
        (async (file) => {
          if (!Object.prototype.hasOwnProperty.call(contents, file.path)) {
            throw new Error(`missing ${file.path}`);
          }
          return contents[file.path];
        }),
      getMarkdownFiles: () => Object.values(fileByPath),
      getAbstractFileByPath: (path) => fileByPath[path] || null,
      getRoot: () => "",
    },
    fileManager: {
      processFrontMatter:
        options.processFrontMatter ||
        (async (file, fn) => {
          const frontmatter = {};
          fn(frontmatter);
          return frontmatter;
        }),
    },
    metadataCache: {
      getBacklinksForFile: () => ({ data: options.backlinks || {} }),
      getFirstLinkpathDest: (linkText, source) => {
        const name = String(linkText || "")
          .replace(/\.md$/i, "")
          .split("/")
          .pop();
        const matches = Object.values(fileByPath).filter(
          (file) => file.basename === name,
        );
        if (matches.length === 1) {
          return matches[0];
        }
        if (name === "area" || name === "project") {
          return fileByPath[`${name}.md`] || null;
        }
        return matches[0] || null;
      },
      getFileCache: (file) => {
        if (!file) {
          return null;
        }
        if (options.frontmatterByPath && options.frontmatterByPath[file.path]) {
          return { frontmatter: options.frontmatterByPath[file.path] };
        }
        if (file.path === sourcePath) {
          return { frontmatter: { type: "[[area]]" } };
        }
        return { frontmatter: parseFrontmatterFromContent(contents[file.path]) };
      },
    },
  };
  const createdArgs = [];
  const templater = {
    create_new_note_from_template: async (
      template,
      folder,
      basename,
      open,
    ) => {
      createdArgs.push({ template, folder, basename, open });
      const createdPath = `${basename}.md`;
      const createdFile = {
        path: createdPath,
        basename,
        extension: "md",
      };
      fileByPath[createdPath] = createdFile;
      contents[createdPath] = contents[templatePath];
      if (options.onCreate) {
        options.onCreate(createdFile);
      }
      return createdFile;
    },
  };
  plugin.app.plugins = {
    plugins: { "templater-obsidian": { templater } },
  };
  plugin.getOpenMarkdownEditorForPath =
    options.getOpenEditor ||
    ((lookupPath) => {
      const leaves = options.leaves || [];
      const leaf = leaves.find(
        (candidate) =>
          candidate &&
          candidate.view &&
          candidate.view.file &&
          candidate.view.file.path === lookupPath,
      );
      return leaf && leaf.view ? leaf.view.editor || null : null;
    });
  plugin.pickSuccessorOffers =
    options.pickSuccessorOffers || (async () => null);
  plugin.focusTaskMoveDestination = async () => true;
  return { plugin, editor, view, contents, fileByPath, sourceFile, templateFile, createdArgs };
}

test("promotion successor rows enumerate, classify, and key offers", () => {
  const content = [
    "---",
    'type: "[[project]]"',
    "---",
    "",
    "- [ ] #task #prj Ship it #hide ^prj",
    "",
    "## Tasks",
    "",
    "- [ ] #task Design ^design",
    "- [ ] #task Test",
    "  - nested note",
    "- [x] #task Done already ^done",
    "- [?] #task Blocked one",
    "- [ ] #task Future [scheduled:: 2099-01-01]",
    "- [ ] #task Hidden one #hide",
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
    "- plain note",
    "- [ ] plain checkbox",
  ].join("\n");
  const plan = helpers.planPromotionSuccessorRows(content, {
    projectPath: "Work_ship.md",
    today: new Date(2026, 8, 30),
    liveLinkedIds: new Set(),
    destinationLabel: "BUILD",
  });
  const byText = new Map(plan.rows.map((row) => [row.text, row]));
  assert.ok(byText.has("Design"));
  assert.ok(byText.has("Test"));
  assert.ok(![...byText.keys()].some((text) => /Done already/.test(text)));
  assert.equal(byText.get("Blocked one").selectable, false);
  assert.equal(byText.get("Blocked one").mutedReason, "blocked");
  assert.match(byText.get("Future").mutedReason, /scheduled/);
  assert.equal(byText.get("Future").selectable, false);
  assert.equal(plan.folded.hidden, 1);
  assert.equal(byText.get("Design").key, "Work_ship.md#^design");
  assert.match(byText.get("Test").key, /^Work_ship\.md@[0-9a-f]{8}$/);
  assert.equal(byText.get("Test").needsBlockId, true);
  assert.equal(byText.get("Design").needsBlockId, false);
});

test("promotion successor keys disambiguate duplicate digests", () => {
  const content = [
    "- [ ] #task #prj Ship ^prj",
    "## Tasks",
    "- [ ] #task Repeat",
    "- [ ] #task Repeat",
  ].join("\n");
  const plan = helpers.planPromotionSuccessorRows(content, {
    projectPath: "P.md",
    today: new Date(2026, 8, 30),
    liveLinkedIds: new Set(),
  });
  assert.equal(plan.rows.length, 2);
  assert.notEqual(plan.rows[0].key, plan.rows[1].key);
  assert.match(plan.rows[1].key, /~2$/);
});

test("promotion planned links find the anchor in ledger order", () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const files = [{ path: "Areas/Work.md" }, { path: todayPath }, { path: "Work_ship.md" }];
  const index = helpers.createProjectPromotionLinkIndex(files);
  const content = [
    "## Pomodoros",
    "",
    "- [ ] (**0930-1000** [t:: 30m])",
    "  - [[Areas/Work#^ship]]",
    "- [ ] () — BUILD",
    "  - [[Areas/Work#^ship]]",
  ].join("\n");
  const links = helpers.findPromotionPlannedLinks(content, todayPath, {
    sourcePath: "Areas/Work.md",
    sourceBlockId: "ship",
    fileIndex: index,
  });
  assert.equal(links.length, 2);
  assert.equal(links[0].entryLine < links[1].entryLine, true);
});

test("promotion picker model carries title, predecessor, group, and keys", () => {
  const rows = [
    { key: "P.md#^a", text: "Alpha", notePath: "P.md", status: "*", destinationLabel: "BUILD", needsBlockId: false, selectable: true, line: 1, rawLine: "- [*] #task Alpha ^a", blockId: "a" },
    { key: "P.md@1234abcd", text: "Beta", notePath: "P.md", status: " ", destinationLabel: "BUILD", needsBlockId: true, selectable: true, line: 2, rawLine: "- [ ] #task Beta", blockId: null },
  ];
  const model = helpers.buildPromotionSuccessorModel(
    { rows, folded: { hidden: 1, alreadyPlanned: 2 } },
    { sourcePath: "S.md", sourceBlockId: "s", sourceDescription: "Source task", projectPath: "P.md", projectDescription: "Proj", destinationLabel: "BUILD" },
  );
  assert.equal(model.title, "Promoted to project · pull in successors");
  assert.equal(model.predecessors.length, 1);
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].group, "project");
  assert.equal(model.groups[0].folded.hidden, 1);
  assert.equal(model.groups[0].folded.alreadyPlanned, 2);
  assert.equal(model.budget, null);
});

test("promotion notice line 2 covers every row of the table", () => {
  assert.match(helpers.buildPromotionNoticeLine2({ picks: [{ text: "Hide history" }], anchorLabel: "BUILD" }), /Next in BUILD/);
  assert.match(helpers.buildPromotionNoticeLine2({ picks: [{ text: "A" }, { text: "B" }], anchorLabel: "BUILD" }), /2 Next in BUILD/);
  assert.match(
    helpers.buildPromotionNoticeLine2({ picks: [], anchorLabel: "BUILD", offerCount: 2 }),
    /Removed the BUILD link/,
  );
  assert.match(helpers.buildPromotionNoticeLine2({ picks: [], anchorLabel: "BUILD", blocked: true }), /project is Blocked/);
  assert.match(helpers.buildPromotionNoticeLine2({ picks: [], anchorLabel: "BUILD", nothingOfferable: true }), /no project tasks/);
  assert.match(
    helpers.buildPromotionNoticeLine2({ picks: [{ text: "A" }], anchorLabel: "BUILD", notPulledCount: 1 }),
    /not pulled in/,
  );
  assert.match(
    helpers.buildPromotionNoticeLine2({ picks: [{ text: "A" }], anchorLabel: "BUILD", moreRemovedCount: 1 }),
    /more Pomodoro link removed/,
  );
  assert.match(
    helpers.buildPromotionNoticeLine2({ picks: [{ text: "A" }], anchorLabel: "BUILD", refusedCount: 1 }),
    /couldn't link 1/,
  );
});

test("promotion history rewrites references one-to-one to #^prj", () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const files = [{ path: "Areas/Work.md" }, { path: todayPath }, { path: "Work_ship.md" }];
  const index = helpers.createProjectPromotionLinkIndex(files);
  const content = ["## Pomodoros", "", "- [x] (**0900-0930**)", "  - [[Areas/Work#^ship]]", "See [[Areas/Work#^ship]] in prose"].join("\n");
  const result = helpers.planPromotionHistoryRewrites(content, todayPath, {
    sourcePath: "Areas/Work.md",
    sourceBlockId: "ship",
    projectBasename: "Work_ship",
    childBlockIds: [],
    fileIndex: index,
  });
  assert.equal(result.changed, true);
  assert.match(result.content, /\[\[Work_ship#\^prj\]\]/);
  assert.doesNotMatch(result.content, /Areas\/Work#\^ship/);
});

test("PS1 promotion offers the new tasks and links only the pick", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const sourceContent = [
    "---", 'type: "[[area]]"', "---", "", "## Tasks", "",
    "- [*] #task Command-mode improvements ^command-mode-improvements",
    "\t- Hide command history and sort commands based on recently used.",
    "\t- Add support for bulk commands.",
  ].join("\n");
  const harness = createProjectForwardHarness({
    sourcePath: "bob.md",
    sourceContent,
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**1510-1600** [t:: 50m]) — BUILD", "\t- [[bob#^command-mode-improvements]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async (model) => {
      assert.equal(model.title, "Promoted to project · pull in successors");
      const selectable = model.groups[0].rows.filter((row) => row.selectable);
      assert.equal(selectable.length, 2);
      return { picks: [{ key: selectable[0].key }] };
    },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.equal(harness.createdArgs[0].open, false);
  const createdPath = "bob_command_mode_improvements.md";
  const projectContent = harness.contents[createdPath];
  assert.match(projectContent, /\^/);
  assert.match(harness.contents[todayPath], new RegExp(`\\[\\[${createdPath.replace(/\.md$/, "")}#\\^`));
  assert.doesNotMatch(harness.contents["bob.md"], /Command-mode improvements/);
  assert.doesNotMatch(harness.contents[todayPath], /\[\[bob#\^command-mode-improvements\]\]/);
  assert.match(notices.at(-1), /Next in BUILD/);
});

test("PS3 Esc consumes the anchor without linking", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const sourceContent = ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design", "\t- Test"].join("\n");
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]", "- [ ] () — OTHER", "  - other link"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async () => null,
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.doesNotMatch(harness.contents[todayPath], /Areas\/Work#\^ship/);
  assert.match(harness.contents[todayPath], /OTHER/);
  assert.match(notices.at(-1), /not pulled in/);
});

test("PS4 template placeholder consumes without a picker", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  let pickerCalled = false;
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async () => { pickerCalled = true; return null; },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.equal(pickerCalled, false);
  assert.doesNotMatch(harness.contents[todayPath], /Areas\/Work#\^ship/);
  assert.doesNotMatch(harness.contents[todayPath], /#\^prj/);
  assert.match(notices.at(-1), /no project tasks to pull in/);
});

test("PS5 blocked project offers nothing and consumes links", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  let pickerCalled = false;
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it [scheduled:: 2099-01-01] ^ship", "\t- Design"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async () => { pickerCalled = true; return null; },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.equal(pickerCalled, false);
  assert.match(notices.at(-1), /project is Blocked/);
});

test("PS6 no planned link leaves children untouched", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  let pickerCalled = false;
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - unrelated"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async () => { pickerCalled = true; return null; },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.equal(pickerCalled, false);
  assert.match(harness.contents["Work_ship.md"], /Design/);
});

test("PS7 struck, closed, prose, past, and later links are handled", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const laterPath = promotionDailyPath(new Date(2026, 9, 1));
  const pastPath = promotionDailyPath(new Date(2026, 8, 29));
  const sourceContent = ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design"].join("\n");
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [
      { path: todayPath, content: ["## Pomodoros", "", "- [x] (**0900-0930**)", "  - [[Areas/Work#^ship]]", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]", "  See [[Areas/Work#^ship]] in prose"].join("\n") },
      { path: laterPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") },
      { path: pastPath, content: ["## Pomodoros", "", "- [x] (**0900-0930**)", "  - [[Areas/Work#^ship]]"].join("\n") },
    ],
    backlinks: {},
    pickSuccessorOffers: async () => null,
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.match(harness.contents[todayPath], /\[\[Work_ship#\^prj\]\]/);
  assert.doesNotMatch(harness.contents[laterPath], /Areas\/Work#\^ship/);
});

test("PS9 lagging open editor completes with open:false and late open", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const sourceContent = ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design", "\t- Test"].join("\n");
  const projectEditor = new TransactionEditor("", { line: 0, ch: 0 });
  const projectLeaf = { view: { file: null, editor: projectEditor } };
  let sourceReadsAfterCreate = 0;
  let created = false;
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    leaves: [projectLeaf],
    onCreate: (file) => { created = true; projectLeaf.view.file = file; },
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async () => null,
    getOpenEditor: (lookupPath) => {
      if (created && lookupPath === "Areas/Work.md") sourceReadsAfterCreate += 1;
      if (lookupPath === "Areas/Work.md") return harness.editor;
      return null;
    },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.equal(harness.createdArgs[0].open, false);
  assert.doesNotMatch(harness.contents["Areas/Work.md"], /Ship it/);
});

test("PS11 source change during pick trashes the note", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async () => {
      harness.contents["Areas/Work.md"] = harness.contents["Areas/Work.md"].replace("Ship it", "Changed it");
      return null;
    },
  });
  harness.plugin.app.fileManager.trashFile = async (file) => {
    delete harness.contents[file.path];
    delete harness.fileByPath[file.path];
  };
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.match(notices.at(-1), /nothing was promoted/);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.contents, "Work_ship.md"), false);
});

test("PS13 lossy children and unresolvable Depends-On create nothing", async () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  notices.length = 0;
  const missing = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "  - \u26d3\ufe0f **DEPENDS ON:** [[Missing#^gone]]"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
  });
  assert.equal(await missing.plugin.createProjectNoteFromTask(missing.editor, missing.view), false);
  assert.match(notices.at(-1), /nothing was promoted/);
  assert.equal(Object.prototype.hasOwnProperty.call(missing.contents, "Work_ship.md"), false);
});

test("PS2 picking both keeps the sub-bullet under the first", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design", "\t- Test"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**) — BUILD", "  - [[Areas/Work#^ship]]", "    - child kept once"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async (model) => {
      const selectable = model.groups[0].rows.filter((row) => row.selectable);
      return { picks: selectable.map((row) => ({ key: row.key })) };
    },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  const lines = harness.contents[todayPath].split("\n");
  const firstLink = lines.findIndex((line) => /Work_ship#\^/.test(line));
  assert.ok(firstLink >= 0);
  assert.match(lines[firstLink + 1], /child kept once/);
  assert.match(notices.at(-1), /2 Next in BUILD/);
});

test("PS10 concurrent note edits still apply picks by key", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design", "\t- Test"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async (model) => {
      const selectable = model.groups[0].rows.filter((row) => row.selectable);
      harness.contents["Work_ship.md"] = ["---", "task_count: 2", "---", "", harness.contents["Work_ship.md"]].join("\n");
      harness.contents[todayPath] = ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]", "  - unrelated"].join("\n");
      return { picks: selectable.map((row) => ({ key: row.key })) };
    },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.match(harness.contents[todayPath], /Work_ship#\^/);
});

test("PS12 deleted pick applies the rest with a refusal suffix", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design", "\t- Test"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async (model) => {
      const selectable = model.groups[0].rows.filter((row) => row.selectable);
      const victim = selectable[1] ? selectable[1].text : selectable[0].text;
      harness.contents["Work_ship.md"] = harness.contents["Work_ship.md"].split("\n").filter((line) => !line.includes(victim)).join("\n");
      return { picks: selectable.map((row) => ({ key: row.key })) };
    },
  });
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.match(notices.at(-1), /couldn't link 1/);
});

test("PS14 picker model shape and retarget off", async () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  let seenModel = null;
  let seenOptions = null;
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: ["---", 'type: "[[area]]"', "---", "", "## Tasks", "", "- [ ] #task Ship it ^ship", "\t- Design", "\t- Design"].join("\n"),
    today,
    extraFiles: [{ path: todayPath, content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n") }],
    backlinks: {},
    pickSuccessorOffers: async (model, options) => { seenModel = model; seenOptions = options; return null; },
  });
  const originalPick = harness.plugin.pickSuccessorOffers;
  harness.plugin.pickSuccessorOffers = async (model, options) => {
    seenOptions = options;
    return originalPick(model, options);
  };
  assert.equal(await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view), true);
  assert.ok(seenModel);
  assert.equal(seenOptions.retarget, false);
  assert.equal(seenModel.budget, null);
});
