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
    workspace: { getLeavesOfType: () => options.leaves || [] },
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
  const templater = {
    create_new_note_from_template: async (
      template,
      folder,
      basename,
      open,
    ) => {
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
  return { plugin, editor, view, contents, fileByPath, sourceFile, templateFile };
}

test("promotion targets enumerate real tasks and assign stable IDs", () => {
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
    "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
    "- plain note",
    "- [ ] plain checkbox",
    "",
    "```",
    "- [ ] #task Fenced example",
    "```",
  ].join("\n");
  const first = helpers.planProjectPromotionTargets(content);
  assert.equal(first.error, null);
  assert.equal(first.targets.length, 4);
  assert.deepEqual(
    first.targets.map((target) => target.blockId),
    ["design", first.targets[1].blockId, "done", first.targets[3].blockId],
  );
  assert.equal(first.targets[0].blockId, "design");
  assert.equal(first.targets[2].blockId, "done");
  const second = helpers.planProjectPromotionTargets(first.content);
  assert.equal(second.error, null);
  assert.deepEqual(
    second.targets.map((target) => target.blockId),
    first.targets.map((target) => target.blockId),
  );
  assert.equal(second.content, first.content);
  const duplicate = helpers.planProjectPromotionTargets(
    [
      "---",
      "---",
      "- [ ] #task #prj Ship ^prj",
      "## Tasks",
      "- [ ] #task One ^same",
      "- [ ] #task Two ^same",
    ].join("\n"),
  );
  assert.match(duplicate.error, /duplicated/);
  const placeholderOnly = helpers.planProjectPromotionTargets(
    [
      "- [ ] #task #prj Ship ^prj",
      "## Tasks",
      "- [ ] #task (REPLACE WITH TASK DESCRIPTION)",
    ].join("\n"),
  );
  assert.equal(placeholderOnly.error, null);
  assert.deepEqual(placeholderOnly.targets, []);
});

test("promotion file planner expands live links and preserves history", () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const futurePath = promotionDailyPath(new Date(2026, 9, 1));
  const pastPath = promotionDailyPath(new Date(2026, 8, 29));
  const files = [
    { path: "Areas/Work.md" },
    { path: todayPath },
    { path: futurePath },
    { path: pastPath },
    { path: "Work_ship.md" },
  ];
  const index = helpers.createProjectPromotionLinkIndex(files);
  const options = {
    sourcePath: "Areas/Work.md",
    sourceBlockId: "ship",
    projectPathWithoutMd: "Work_ship",
    projectBasename: "Work_ship",
    targetBlockIds: ["design", "test"],
    today,
    fileIndex: index,
  };
  const live = [
    "## Pomodoros",
    "",
    "- [x] (**0900-0930** [t:: 30m])",
    "  - [[Areas/Work#^ship]]",
    "- [ ] (**0930-1000** [t:: 30m])",
    "  - [[Areas/Work#^ship]]",
    "- [ ] () — BUILD",
    "  - [[Areas/Work#^ship]]",
  ].join("\n");
  const planned = helpers.planProjectPromotionFileEdits(live, todayPath, options);
  assert.equal(planned.expandedCount, 2);
  assert.equal(planned.legacyCount, 1);
  assert.deepEqual(planned.content.split("\n"), [
    "## Pomodoros",
    "",
    "- [x] (**0900-0930** [t:: 30m])",
    "  - [[Work_ship#^prj]]",
    "- [ ] (**0930-1000** [t:: 30m])",
    "  - [[Work_ship#^design]]",
    "  - [[Work_ship#^test]]",
    "- [ ] () — BUILD",
    "  - [[Work_ship#^design]]",
    "  - [[Work_ship#^test]]",
  ]);
  const future = helpers.planProjectPromotionFileEdits(live, futurePath, options);
  assert.equal(future.expandedCount, 2);
  const past = helpers.planProjectPromotionFileEdits(live, pastPath, options);
  assert.equal(past.changed, false);
  assert.equal(past.expandedCount, 0);
  const yearEnd = helpers.planProjectPromotionFileEdits(
    live,
    "2026/20260101.md",
    {
      ...options,
      today: new Date(2025, 11, 31),
      fileIndex: helpers.createProjectPromotionLinkIndex([
        { path: "Areas/Work.md" },
        { path: "2026/20260101.md" },
        { path: "Work_ship.md" },
      ]),
    },
  );
  assert.equal(yearEnd.expandedCount, 2);
});

test("promotion file planner handles forms, whitespace, and subtrees", () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const files = [
    { path: "Areas/Work.md" },
    { path: todayPath },
    { path: "Work_ship.md" },
    { path: "Other.md" },
  ];
  const index = helpers.createProjectPromotionLinkIndex(files);
  const baseOptions = {
    sourcePath: "Areas/Work.md",
    sourceBlockId: "ship",
    projectPathWithoutMd: "Work_ship",
    projectBasename: "Work_ship",
    targetBlockIds: ["design", "test"],
    today,
    fileIndex: index,
  };
  const content = [
    "## Pomodoros",
    "",
    "- [ ] (**0930-1000** [t:: 30m])",
    "  - [ ] 🍅 🍅 [[Areas/Work#^ship|Old desc]] #",
    "    - child note kept once",
    "  - ![[Areas/Work#^ship]]",
    "  - ~~[[Areas/Work#^ship]]~~",
    "  - [x] [[Areas/Work#^ship]]",
    "  - [[Other#^ship]]",
    "  - unrelated bullet",
    "  See [[Areas/Work#^ship]] in prose",
  ].join("\n");
  const planned = helpers.planProjectPromotionFileEdits(content, todayPath, baseOptions);
  assert.equal(planned.expandedCount, 2);
  const lines = planned.content.split("\n");
  assert.equal(lines[3], "  - [ ] 🍅 🍅 [[Work_ship#^design]] #");
  assert.equal(lines[4], "    - child note kept once");
  assert.equal(lines[5], "  - [[Work_ship#^test]] #");
  assert.equal(lines[6], "  - ![[Work_ship#^design]]");
  assert.equal(lines[7], "  - ![[Work_ship#^test]]");
  assert.match(planned.content, /\[\[Work_ship#\^prj\]\]/);
  assert.match(planned.content, /\[\[Other#\^ship\]\]/);
  const tabContent = [
    "## Pomodoros",
    "",
    "- [ ] (**0930-1000**)",
    "\t- [[Areas/Work#^ship]]",
  ].join("\n");
  const tabPlanned = helpers.planProjectPromotionFileEdits(tabContent, todayPath, baseOptions);
  assert.equal(tabPlanned.expandedCount, 1);
  assert.match(tabPlanned.content, /\t- \[\[Work_ship#\^design\]\]/);
  const crlf = [
    "## Pomodoros",
    "",
    "- [ ] (**0930-1000**)",
    "  - [[Areas/Work#^ship]]",
  ].join("\r\n");
  const crlfPlanned = helpers.planProjectPromotionFileEdits(crlf, todayPath, baseOptions);
  assert.equal(crlfPlanned.expandedCount, 1);
  assert.equal(crlfPlanned.content.includes("\r\n"), true);
  const noNewline = [
    "## Pomodoros",
    "",
    "- [ ] (**0930-1000**)",
    "  - [[Areas/Work#^ship]]",
  ].join("\n");
  const noNewlinePlanned = helpers.planProjectPromotionFileEdits(noNewline, todayPath, baseOptions);
  assert.equal(noNewlinePlanned.expandedCount, 1);
});

test("promotion file planner keeps compatibility for non-live references", () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const files = [
    { path: "Areas/Work.md" },
    { path: todayPath },
    { path: "Work_ship.md" },
    { path: "Notes.md" },
  ];
  const index = helpers.createProjectPromotionLinkIndex(files);
  const options = {
    sourcePath: "Areas/Work.md",
    sourceBlockId: "ship",
    projectPathWithoutMd: "Work_ship",
    projectBasename: "Work_ship",
    targetBlockIds: ["design", "test"],
    today,
    fileIndex: index,
  };
  const content = [
    "---",
    "ref: \"[[Areas/Work#^ship]]\"",
    "---",
    "",
    "## Pomodoros",
    "",
    "- [ ] (**0930-1000**)",
    "  - [[Areas/Work#^ship]]",
    "    - nested [[Areas/Work#^ship]] reference",
    "  See [[Areas/Work#^ship]] in prose",
    "  [Ship](Areas/Work.md#^ship)",
    "",
    "```",
    "- [ ] (**0930-1000**)",
    "  - [[Areas/Work#^ship]]",
    "```",
  ].join("\n");
  const planned = helpers.planProjectPromotionFileEdits(content, todayPath, options);
  assert.equal(planned.expandedCount, 1);
  assert.match(planned.content, /ref: "\[\[Work_ship#\^prj\]\]"/);
  assert.match(planned.content, /nested \[\[Work_ship#\^prj\]\] reference/);
  assert.match(planned.content, /See \[\[Work_ship#\^prj\]\] in prose/);
  assert.match(planned.content, /\[Ship\]\(Work_ship\.md#\^prj\)/);
  const nonDaily = helpers.planProjectPromotionFileEdits(content, "Notes.md", options);
  assert.equal(nonDaily.changed, false);
  const ambiguousIndex = helpers.createProjectPromotionLinkIndex([
    { path: "A/Work.md" },
    { path: "B/Work.md" },
    { path: todayPath },
    { path: "Work_ship.md" },
  ]);
  const ambiguous = helpers.planProjectPromotionFileEdits(
    [
      "## Pomodoros",
      "",
      "- [ ] (**0930-1000**)",
      "  - [[Work#^ship]]",
    ].join("\n"),
    todayPath,
    {
      ...options,
      sourcePath: "A/Work.md",
      fileIndex: ambiguousIndex,
    },
  );
  assert.equal(ambiguous.changed, false);
  assert.equal(ambiguous.expandedCount, 0);
});

test("forward promotion expands live links, persists anchors, and removes the source", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const futurePath = promotionDailyPath(new Date(2026, 9, 1));
  const sourceContent = [
    "---",
    'type: "[[area]]"',
    "---",
    "",
    "## Tasks",
    "",
    "- [ ] #task Ship it ^ship",
    "\t- Design",
    "\t- Test",
  ].join("\n");
  const todayContent = [
    "## Pomodoros",
    "",
    "- [x] (**0900-0930** [t:: 30m])",
    "  - [[Areas/Work#^ship]]",
    "- [ ] (**0930-1000** [t:: 30m])",
    "  - [[Areas/Work#^ship]]",
  ].join("\n");
  const futureContent = [
    "## Pomodoros",
    "",
    "- [ ] () — BUILD",
    "  - [[Areas/Work#^ship]]",
  ].join("\n");
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [
      { path: todayPath, content: todayContent },
      { path: futurePath, content: futureContent },
    ],
    backlinks: {
      [todayPath]: [{ original: "[[Areas/Work#^ship]]", link: "Areas/Work#^ship" }],
      [futurePath]: [{ original: "[[Areas/Work#^ship]]", link: "Areas/Work#^ship" }],
    },
  });
  assert.equal(
    await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view),
    true,
  );
  const createdPath = "Work_ship.md";
  assert.ok(Object.prototype.hasOwnProperty.call(harness.contents, createdPath));
  const projectContent = harness.contents[createdPath];
  assert.match(projectContent, /\^design/);
  assert.match(projectContent, /\^test/);
  assert.doesNotMatch(harness.contents[todayPath], /\[\[Areas\/Work#\^ship\]\]/);
  assert.doesNotMatch(harness.contents[futurePath], /\[\[Areas\/Work#\^ship\]\]/);
  assert.match(harness.contents[todayPath], /\[\[Work_ship#\^prj\]\]/);
  assert.match(harness.contents[todayPath], /\[\[Work_ship#\^design\]\]/);
  assert.match(harness.contents[todayPath], /\[\[Work_ship#\^test\]\]/);
  assert.match(harness.contents[futurePath], /\[\[Work_ship#\^design\]\]/);
  assert.doesNotMatch(harness.contents["Areas/Work.md"], /Ship it/);
  assert.match(notices.at(-1), /Created project Work_ship/);
});

test("forward promotion uses zero-task fallback and keeps reverse one-to-one", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const sourceContent = [
    "---",
    'type: "[[area]]"',
    "---",
    "",
    "## Tasks",
    "",
    "- [ ] #task Ship it ^ship",
  ].join("\n");
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [
      {
        path: todayPath,
        content: ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n"),
      },
    ],
    backlinks: {
      [todayPath]: [{ original: "[[Areas/Work#^ship]]", link: "Areas/Work#^ship" }],
    },
  });
  assert.equal(
    await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view),
    true,
  );
  assert.equal(harness.contents[todayPath].includes("[[Work_ship#^prj]]"), true);
  assert.equal(harness.contents[todayPath].includes("[[Work_ship#^design]]"), false);
  assert.doesNotMatch(harness.contents["Areas/Work.md"], /Ship it/);
});

test("forward promotion retains the source on ambiguous, stale, and write failures", async () => {
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const sourceContent = [
    "---",
    'type: "[[area]]"',
    "---",
    "",
    "## Tasks",
    "",
    "- [ ] #task Ship it ^ship",
    "\t- Design",
    "\t- Test",
  ].join("\n");
  const dailyContent = [
    "## Pomodoros",
    "",
    "- [ ] (**0930-1000**)",
    "  - [[Areas/Work#^ship]]",
  ].join("\n");
  notices.length = 0;
  const duplicateSource = [
    "---",
    'type: "[[area]]"',
    "---",
    "",
    "## Tasks",
    "",
    "- [ ] #task Ship it ^ship",
    "\t- [ ] #task One ^same",
    "\t- [ ] #task Two ^same",
  ].join("\n");
  const ambiguous = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent: duplicateSource,
    today,
    extraFiles: [{ path: todayPath, content: dailyContent }],
    backlinks: {
      [todayPath]: [{ original: "[[Areas/Work#^ship]]", link: "Areas/Work#^ship" }],
    },
  });
  assert.equal(
    await ambiguous.plugin.createProjectNoteFromTask(ambiguous.editor, ambiguous.view),
    true,
  );
  assert.match(notices.at(-1), /duplicated; source task was kept/);
  assert.match(ambiguous.contents["Areas/Work.md"], /Ship it/);

  notices.length = 0;
  const stale = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [{ path: todayPath, content: dailyContent }],
    backlinks: {
      [todayPath]: [{ original: "[[Areas/Work#^ship]]", link: "Areas/Work#^ship" }],
    },
    process: async (file, fn) => {
      if (file.path === "Work_ship.md") {
        throw new Error("stale project");
      }
      return fn(`unexpected ${file.path}`);
    },
    read: async () => {
      throw new Error("unreadable");
    },
    cachedRead: async () => {
      throw new Error("unreadable");
    },
  });
  assert.equal(
    await stale.plugin.createProjectNoteFromTask(stale.editor, stale.view),
    false,
  );
  assert.match(stale.contents["Areas/Work.md"], /Ship it/);
});

test("forward promotion discovers live links without a backlink cache and uses one open-editor write", async () => {
  notices.length = 0;
  const today = new Date(2026, 8, 30);
  const todayPath = promotionDailyPath(today);
  const sourceContent = [
    "---",
    'type: "[[area]]"',
    "---",
    "",
    "## Tasks",
    "",
    "- [ ] #task Ship it ^ship",
    "\t- Design",
  ].join("\n");
  const openDaily = new TransactionEditor(
    ["## Pomodoros", "", "- [ ] (**0930-1000**)", "  - [[Areas/Work#^ship]]"].join("\n"),
    { line: 0, ch: 0 },
  );
  const harness = createProjectForwardHarness({
    sourcePath: "Areas/Work.md",
    sourceContent,
    today,
    extraFiles: [{ path: todayPath, content: openDaily.getValue() }],
    backlinks: {},
    leaves: [{ view: { file: { path: todayPath }, editor: openDaily } }],
  });
  harness.fileByPath[todayPath] = { path: todayPath, basename: todayPath.split("/").pop().replace(/\.md$/, ""), extension: "md" };
  const beforeTransactions = openDaily.transactions.length;
  assert.equal(
    await harness.plugin.createProjectNoteFromTask(harness.editor, harness.view),
    true,
  );
  assert.ok(openDaily.transactions.length > beforeTransactions);
  assert.match(openDaily.getValue(), /\[\[Work_ship#\^design\]\]/);
  assert.doesNotMatch(openDaily.getValue(), /Areas\/Work#\^ship/);
  assert.doesNotMatch(harness.contents["Areas/Work.md"], /Ship it/);
});

