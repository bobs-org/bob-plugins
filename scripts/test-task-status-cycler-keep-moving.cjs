const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  TaskStatusCyclerPlugin,
  MarkdownView,
  helpers,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  flushAsyncActions,
} = require("./task-status-cycler-harness.cjs");

process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "bob-keep-moving-"));

const TODAY = "2026-11-01";
const DAY_PATH = "2026/20261101.md";
const PROJECT_PATH = "sase_badges.md";
const DAY = [
  `# ${TODAY}`,
  "",
  "## Pomodoros",
  "- [ ] () — FIX",
  `\t- [[${PROJECT_PATH.slice(0, -3)}#^spec]]`,
].join("\n");
const CLOSED = [{
  path: PROJECT_PATH,
  blockId: "spec",
  text: "- [x] #task Draft the badge spec ^spec",
}];

function projectNote(residents, rootLine = "- [ ] #task Badge project ^prj", parent = "[[sase]]") {
  return [
    "---",
    'type: "[[project]]"',
    "status: wip",
    `parent: ${parent}`,
    "---",
    rootLine,
    "- [x] #task Draft the badge spec ^spec",
    ...residents,
  ].join("\n");
}

function purePlan({ residents, day = DAY, closed = CLOSED, rootLine, options = {} }) {
  const notes = { [PROJECT_PATH]: projectNote(residents, rootLine) };
  const tasks = helpers.tasksFromDocuments(Object.entries(notes).map(([path, text]) => ({ path, text })));
  const plan = helpers.planSuccessors({
    closed,
    index: helpers.buildDependentsIndex(tasks),
    dailyBefore: day,
    dailyAfter: day,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: notes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: () => true,
    selection: [],
    ...options,
  });
  return { notes, tasks, plan };
}

test("KM1/K9/K11: keep-moving uses the baseline predecessor link, lane order, and shared row indexes", () => {
  const { plan } = purePlan({ residents: [
    "- [ ] #task Write badge docs ^docs",
    "- [*] #task Wire badges into the README ^readme",
    "- [/] #task Ship the badge renderer ^renderer",
  ] });
  assert.deepEqual(plan.offers.map((offer) => offer.task.status), ["/", "*", " "]);
  assert.deepEqual(plan.keep_moving.map((row) => row.block_id), ["renderer", "readme", "docs"]);
  assert.equal(plan.unblocked.length, 0);
  assert.equal(plan.rows.length, 3);
  assert.equal(plan.keep_moving[0], plan.rows[0]);
  assert.ok(plan.keep_moving.every((row) => row.trigger === "last_planned"));
  assert.ok(plan.keep_moving.every((row) => row.not_linked === "not_selected"));
  assert.ok(plan.keep_moving.every((row) => row.unblocked_by[0].block_id === "spec"));
  assert.equal(plan.edits.length, 0, "Esc does not recover, mint, stamp, or write an unpicked resident");
  assert.equal(plan.placements.length, 0);
  assert.equal(plan.offers[0].destination.entry_role, "slot");
});

test("KM1: an explicit pick reuses the writer, raises Ready, mints, stamps, and places after the predecessor", () => {
  const { plan } = purePlan({
    residents: ["- [ ] #task Write badge docs ^docs"],
    options: {
      selection: "all",
      stampLine: (line, date) => line.replace(/\s+\^docs$/, ` [fresh:: ${date}] ^docs`),
    },
  });
  const row = plan.keep_moving[0];
  assert.equal(row.trigger, "last_planned");
  assert.equal(row.offer.group, "keep_moving");
  assert.ok(row.link);
  assert.equal(row.status_symbol, "*");
  assert.match(plan.edits[0].after, /\[\*\]/);
  assert.match(plan.edits[0].after, /\[fresh:: 2026-11-01\]/);
  assert.match(plan.edits[0].after, /\^[A-Za-z0-9_-]+$/);
  assert.equal(plan.placements[0].rowIndex, 0);
  assert.equal(plan.placements[0].anchor.bulletLine, 4);

  const reference = purePlan({
    residents: ["- [ ] #ref Read the article"],
    options: { selection: "all" },
  }).plan.keep_moving[0];
  assert.equal(reference.text, "Read the article");
  assert.match(reference.offer.key, /^sase_badges\.md@[0-9a-f]{8}$/);
  assert.match(reference.link.block_link, /\^/);
});

test("KM2-K8/K10/K12: only the pre-close own link behind the last live project link triggers", () => {
  const oneResident = ["- [ ] #task Ready work ^ready"];
  const linkedOpenResident = `${DAY}\n\t- [[${PROJECT_PATH.slice(0, -3)}#^ready]]`;
  assert.equal(purePlan({ residents: oneResident, day: linkedOpenResident }).plan.keep_moving.length, 0); // KM2
  const closedTarget = projectNote([
    "- [x] #task Already done ^ready",
    "- [ ] #task Still available ^other",
  ]);
  const closedResult = helpers.planSuccessors({
    closed: CLOSED,
    index: helpers.buildDependentsIndex(helpers.tasksFromDocuments([{ path: PROJECT_PATH, text: closedTarget }])),
    dailyBefore: `${DAY}\n\t- [[${PROJECT_PATH.slice(0, -3)}#^ready]]`,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: { [PROJECT_PATH]: closedTarget },
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: () => true,
  });
  assert.deepEqual(closedResult.keep_moving.map((row) => row.block_id), ["other"]); // KM3: closed targets do not count.
  const struck = `${DAY}\n\t- ~~[[${PROJECT_PATH.slice(0, -3)}#^ready]]~~`;
  assert.equal(purePlan({ residents: oneResident, day: struck }).plan.keep_moving.length, 1); // KM4
  const closedEntry = DAY.replace("- [ ] () — FIX", "- [x] () — FIX");
  assert.equal(purePlan({ residents: oneResident, day: closedEntry }).plan.keep_moving.length, 0); // KM4
  const rootLink = `${DAY}\n\t- [[${PROJECT_PATH.slice(0, -3)}#^prj]]`;
  assert.equal(purePlan({ residents: oneResident, day: rootLink }).plan.keep_moving.length, 0); // KM5: the project root is a live planned row.
  assert.equal(purePlan({ residents: oneResident, closed: [{ ...CLOSED[0], blockId: "spec", taskId: "idless" }], day: DAY.replace("#^spec", "") }).plan.keep_moving.length, 0); // KM8
  assert.equal(purePlan({ residents: oneResident, day: DAY, options: { keepMovingBaseline: `${DAY}\n\t- [[${PROJECT_PATH.slice(0, -3)}#^ready]]` } }).plan.keep_moving.length, 0); // KM10/12 carried or dropped baseline
});

test("KM6/K7/K14/K16/K19/K20/K29: root, project-group, empty, blocked, disabled, and cancel exclusions", () => {
  const residents = ["- [ ] #task Ready work ^ready"];
  assert.equal(purePlan({ residents, options: { leafProject: () => false } }).plan.keep_moving.length, 0); // KM6
  const ownRoot = purePlan({ residents, rootLine: "- [ ] #task Badge project ^prj", options: { leafProject: () => false } });
  assert.equal(ownRoot.plan.keep_moving.length, 0);
  const blockedRoots = [
    "- [?] #task Badge project ^prj",
    "- [ ] #task Badge project #prj_is_blocked ^prj",
    "- [ ] #task Badge project [scheduled:: 2026-12-01] ^prj",
  ];
  for (const rootLine of blockedRoots) {
    assert.equal(purePlan({ residents, rootLine }).plan.keep_moving.length, 0); // KM16
  }
  assert.equal(purePlan({ residents, rootLine: "- [ ] #task Badge project [dependsOn:: ext] ^prj", options: {
    index: { byTaskId: new Map([["ext", { taskId: "ext", status: " " }]]), tasks: [], byDependsOn: new Map() },
  } }).plan.keep_moving.length, 0); // KM16: an open project prerequisite blocks the project root.
  assert.equal(purePlan({ residents, options: { linkUnblocked: false } }).plan.keep_moving.length, 0); // KM19
  assert.equal(purePlan({ residents, options: { keepMoving: false } }).plan.keep_moving.length, 0); // KM19
  assert.equal(purePlan({ residents, options: { cancelled: true } }).plan.keep_moving.length, 0); // KM20
  assert.equal(purePlan({ residents: [], closed: [{ path: PROJECT_PATH, blockId: "prj", taskId: "p" }] }).plan.keep_moving.length, 0); // KM29
  const finished = purePlan({ residents: [] }).plan;
  assert.ok(finished.offers.some((offer) => offer.group === "project_finished"));
  assert.equal(finished.keep_moving.length, 0); // KM14
});

test("KM13/KM17/KM18/KM31: blocked, scheduled, hidden, ref, nested, and due rows classify with precedence", () => {
  const { plan } = purePlan({
    residents: [
      "- [ ] #task Selectable ^ready",
      "- [?] #task Blocked and #hide ^blocked",
      "- [ ] #task Has open prerequisite [dependsOn:: ext] ^dep",
      "- [ ] #task Scheduled later [scheduled:: 2026-12-01] ^later",
      "- [ ] #task Hidden #hide ^hidden",
      "- [ ] #ref Read this paper ^ref",
      "  - [ ] #task Nested subtask ^nested",
      "- [ ] #task Recurring today [scheduled:: 2026-11-01] ^recurring",
    ],
    options: {
      dependencySnapshotAvailable: false,
      index: { byTaskId: new Map(), byDependsOn: new Map(), tasks: [] },
    },
  });
  assert.deepEqual(plan.keep_moving.map((row) => row.block_id), ["ready", "ref", "nested", "recurring"]);
  assert.deepEqual(plan.foldedByProject.get(PROJECT_PATH), { blocked: 2, scheduled: 1, hidden: 1 });
  const silent = purePlan({ residents: [
    "- [?] #task Blocked ^blocked",
    "- [ ] #task Hidden #hide ^hidden",
    "- [ ] #task Future [scheduled:: 2026-12-01] ^future",
  ] }).plan;
  assert.equal(silent.keep_moving.length, 0); // KM13: no selectable row means no group.
  assert.equal(silent.offers.length, 0);
});

test("KM15/KM22/KM23: hand-offs win dedup, projects sort by anchor, and task root fields do not change leafness", () => {
  const notes = {
    [PROJECT_PATH]: projectNote([
      "- [ ] #task Also directly depends [id:: dep__a] [dependsOn:: spec__t] ^a",
      "- [ ] #task Another resident ^b",
    ]).replace("- [x] #task Draft the badge spec ^spec", "- [x] #task Draft the badge spec [id:: spec__t] ^spec"),
  };
  const day = DAY;
  const tasks = helpers.tasksFromDocuments(Object.entries(notes).map(([path, text]) => ({ path, text })));
  const plan = helpers.planSuccessors({
    closed: [{ ...CLOSED[0], taskId: "spec__t" }],
    index: helpers.buildDependentsIndex(tasks),
    dailyBefore: day,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: notes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: () => true,
    selection: [],
  });
  assert.equal(plan.unblocked.find((row) => row.block_id === "a").offer.group, "hand_off");
  assert.equal(plan.keep_moving.some((row) => row.block_id === "a"), false);
  assert.equal(plan.keep_moving.some((row) => row.block_id === "b"), true);
  assert.equal(plan.keep_moving[0].unblocked_by[0].block_id, "spec");
});

test("KM22/KM23: multiple leaf-project groups order by ledger anchor before path", () => {
  const zeta = "zeta.md";
  const alpha = "alpha.md";
  const notes = {
    [zeta]: projectNote(["- [ ] #task Zeta work ^zwork"], "- [ ] #task Zeta project ^prj")
      .replace("- [x] #task Draft the badge spec ^spec", "- [x] #task Draft the badge spec [root:: [[sase]]] ^spec"),
    [alpha]: projectNote(["- [ ] #task Alpha work ^awork"]),
  };
  const day = [
    `# ${TODAY}`, "", "## Pomodoros", "- [ ] () — FIX",
    `\t- [[zeta#^spec]]`, `\t- [[alpha#^spec]]`,
  ].join("\n");
  const closed = [zeta, alpha].map((path) => ({
    path, blockId: "spec", text: "- [x] #task Planned work ^spec",
  }));
  const tasks = helpers.tasksFromDocuments(Object.entries(notes).map(([path, text]) => ({ path, text })));
  const plan = helpers.planSuccessors({
    closed,
    index: helpers.buildDependentsIndex(tasks),
    dailyBefore: day,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: notes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: () => true,
    selection: [],
  });
  assert.deepEqual([...new Set(plan.keep_moving.map((row) => row.offer.project))], [zeta, alpha]);
});

function fakeMetadataApp(frontmatterByPath) {
  const paths = Object.keys(frontmatterByPath);
  const byPath = new Map(paths.map((path) => [path, { path }]));
  return {
    vault: {
      getMarkdownFiles: () => [...byPath.values()],
      getAbstractFileByPath: (path) => byPath.get(path) || null,
    },
    metadataCache: {
      getCache: (path) => frontmatterByPath[path] ? { frontmatter: frontmatterByPath[path] } : null,
      getFirstLinkpathDest: (target) => {
        const clean = String(target).replace(/\.md$/i, "");
        if (clean.includes("/")) return byPath.get(`${clean}.md`) || null;
        return paths.find((path) => path.split("/").pop().replace(/\.md$/i, "") === clean) ?
          byPath.get(paths.find((path) => path.split("/").pop().replace(/\.md$/i, "") === clean)) : null;
      },
    },
  };
}

test("LP1-LP12: R2 leaf walk handles roots, wrappers, ambiguous/missing parents, cycles, and depth", () => {
  const fm = {
    "dev.md": { type: "[[area]]" },
    "sase.md": { type: "[[project]]", parent: "[[dev]]" },
    "sase_goals.md": { type: "[[project]]", parent: "[[sase]]" },
    "rooted.md": { type: "[[project]]", root: " TRUE ", parent: "[[sase]]" },
    "orphan.md": { type: "[[project]]" },
    "wrapper.md": { type: "other", parent: "[[sase]]" },
    "wrapped.md": { type: "[[project]]", parent: "[[wrapper]]" },
    "a.md": { type: "[[project]]", parent: "[[b]]" },
    "b.md": { type: "[[project]]", parent: "[[a]]" },
    "missing.md": { type: "[[project]]", parent: "[[gone]]" },
    "x/dup.md": { type: "[[project]]", parent: "[[dev]]" },
    "y/dup.md": { type: "[[project]]", parent: "[[dev]]" },
    "ambiguous.md": { type: "[[project]]", parent: "[[dup]]" },
    "subarea.md": { type: "[[project]]", parent: "[[daily_area]]" },
    "daily_area.md": { type: "[[area]]", parent: "[[dev]]" },
    "middle.md": { type: "[[project]]", parent: "[[sase]]" },
    "child.md": { type: "[[project]]", parent: "[[middle]]" },
  };
  const app = fakeMetadataApp(fm);
  assert.equal(helpers.successorLeafProject(app, "sase_goals.md"), true); // LP1
  assert.equal(helpers.successorLeafProject(app, "sase.md"), false); // LP2
  assert.equal(helpers.successorLeafProject(app, "rooted.md"), false); // LP3
  assert.equal(helpers.successorLeafProject(app, "orphan.md"), false); // LP6
  assert.equal(helpers.successorLeafProject(app, "wrapped.md"), true); // LP8
  assert.equal(helpers.successorLeafProject(app, "middle.md"), true); // LP9
  assert.equal(helpers.successorLeafProject(app, "child.md"), true);
  assert.equal(helpers.successorLeafProject(app, "ambiguous.md"), false); // LP7
  assert.equal(helpers.successorLeafProject(app, "missing.md"), false); // LP7
  assert.equal(helpers.successorLeafProject(app, "subarea.md"), false); // LP5
  assert.equal(helpers.successorLeafProject(app, "a.md"), true); // LP12
  assert.equal(helpers.successorKeepMovingRootFlag({ root: true }), true);
  assert.equal(helpers.successorKeepMovingRootFlag({ root: " tRuE " }), true);
  assert.equal(helpers.successorKeepMovingRootFlag({ root: "yes" }), false);
  const deep = { "dev.md": { type: "[[area]]" }, "start.md": { type: "[[project]]", parent: "[[w0]]" } };
  for (let index = 0; index < 16; index += 1) {
    deep[`w${index}.md`] = { type: "other", parent: index === 15 ? "[[later]]" : `[[w${index + 1}]]` };
  }
  deep["later.md"] = { type: "[[project]]", parent: "[[dev]]" };
  assert.equal(helpers.successorLeafProject(fakeMetadataApp(deep), "start.md"), false); // R2 depth cap.
});

test("KM copy, folds, title, lane labels, notices, and config parser/cache match the accepted API", () => {
  const { plan } = purePlan({ residents: [
    "- [ ] #task Write badge docs ^docs",
      "- [?] #task Blocked ^blocked",
    "- [ ] #task Scheduled [scheduled:: 2026-12-01] ^later",
    "- [ ] #task Hidden #hide ^hidden",
  ], options: { selection: "all" } });
  const model = helpers.buildSuccessorPickerModel({
    predecessors: [{ note_path: PROJECT_PATH, block_id: "spec", text: "Draft the badge spec" }],
    offers: plan.offers,
    foldedByProject: plan.foldedByProject,
  });
  assert.equal(model.title, "Keep ‹sase_badges› moving");
  const group = model.groups[0];
  assert.equal(group.header, "Keep ‹sase_badges› moving");
  assert.equal(group.tag, "ready in sase_badges · not dependents");
  assert.equal(group.caption, "✓ Draft the badge spec was the last sase_badges task planned today");
  assert.equal(group.rows[0].lane, "Ready");
  assert.deepEqual(group.folded, { blocked: 1, scheduled: 1, hidden: 1 });
  const unpickedPlan = purePlan({ residents: ["- [ ] #task Write badge docs ^docs"] }).plan;
  const unpicked = helpers.successorNoticeText({ keep_moving: unpickedPlan.keep_moving, unblocked: [] });
  assert.equal(unpicked, "");
  const picked = purePlan({ residents: ["- [ ] #task Write badge docs ^docs"], options: { selection: "all" } }).plan;
  assert.equal(helpers.successorNoticeText({ keep_moving: picked.keep_moving, unblocked: [] }),
    "⏭ Next in FIX: Write badge docs · keeps ‹sase_badges› moving");
  const mixed = helpers.successorNoticeText({
    unblocked: [{ text: "Normal task", status_symbol: "*", status_name: "Next", link: { entry_name: "FIX" } }],
    keep_moving: picked.keep_moving,
  });
  assert.match(mixed, /^🔓/);
  assert.doesNotMatch(mixed, /keeps/);
  assert.equal(helpers.parseSuccessorKeepMoving("plan:\n  keep_moving: false"), false);
  assert.equal(helpers.parseSuccessorKeepMoving("plan: { keep_moving: false, link_unblocked: true }"), false);
  assert.equal(helpers.parseSuccessorKeepMoving("plan:\n  keep_moving: nope"), true);
  assert.equal(helpers.parseSuccessorKeepMoving("plan: {}"), true);
  helpers.resetSuccessorKeepMovingCache();
  let reads = 0;
  let mtime = 1;
  let body = "plan:\n  keep_moving: false";
  const fsModule = {
    statSync: () => ({ mtimeMs: mtime, size: body.length }),
    readFileSync: () => { reads += 1; return body; },
  };
  assert.equal(helpers.loadKeepMoving({ configPath: "/test/config.yml", fsModule }), false);
  assert.equal(helpers.loadKeepMoving({ configPath: "/test/config.yml", fsModule }), false);
  assert.equal(reads, 1);
  body = "plan:\n  keep_moving: true";
  mtime = 2;
  assert.equal(helpers.loadKeepMoving({ configPath: "/test/config.yml", fsModule }), true);
  assert.equal(reads, 2);
  assert.equal(helpers.loadKeepMoving({ configPath: "/test/config.yml", fsModule: { readFileSync() { throw new Error("locked"); } } }), true);
});

function installMetadata(app) {
  const frontmatter = {
    [PROJECT_PATH]: { type: "[[project]]", parent: "[[sase]]" },
    "sase.md": { type: "[[project]]", parent: "[[dev]]" },
    "dev.md": { type: "[[area]]" },
  };
  app.metadataCache.getCache = (path) => frontmatter[path] ? { frontmatter: frontmatter[path] } : null;
}

function installPicker(plugin, version, picked, noticeCalls, noticeVersion = 1) {
  plugin.app.plugins.plugins["bob-navigation-hotkeys"] = {
    api: {
      successors: {
        version,
        async pick(model) {
          picked.models.push(model);
          if (picked.returnNull === true) return null;
          const keys = [];
          for (const group of model.groups || []) for (const row of group.rows || []) {
            if (row.selectable) keys.push({ key: row.key });
          }
          if (typeof picked.mutate === "function") picked.mutate();
          return { picks: picked.choose ? keys : [] };
        },
      },
      notice: { version: noticeVersion, showUnblocked(model) { noticeCalls.push(model); return true; } },
    },
  };
}

function makeRealPlugin(harness, editor, activePath) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => TODAY;
  plugin.getPomodoroWorkLogDateString = () => TODAY;
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor, activePath);
  if (!harness.app.commands) {
    harness.app.commands = { commands: {}, executeCommandById: () => false };
  }
  return plugin;
}

async function settleReal(plugin) {
  for (let round = 0; round < 10; round += 1) {
    await flushAsyncActions();
  }
  try {
    await plugin.referenceMutationQueue;
  } catch (error) {
    // finalize results carry failures; the queue itself must stay usable.
  }
  for (let round = 0; round < 10; round += 1) {
    await flushAsyncActions();
  }
}

function openKeepMovingProject(extraResidents = ["- [ ] #task Ship the badge renderer ^renderer"]) {
  return [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "parent: [[sase]]",
    "---",
    "- [ ] #task Badge project ^prj",
    "- [ ] #task Draft the badge spec ^spec",
    ...extraResidents,
  ].join("\n");
}

test("KM24/KM28: real close wiring offers once, applies a pick, and same-day reopen takes it back", async () => {
  notices.length = 0;
  const projectText = projectNote(["- [ ] #task Ship the badge renderer ^renderer"]);
  const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectText, "sase.md": "", "dev.md": "", [DAY_PATH]: DAY });
  installMetadata(harness.app);
  const predecessorLine = projectText.split("\n").findIndex((line) => line.includes("^spec"));
  const editor = createTextEditor(projectText, { line: predecessorLine, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => TODAY;
  attachActiveMarkdownView(plugin, harness, editor, PROJECT_PATH);
  const picked = { models: [], choose: true };
  const noticeCalls = [];
  installPicker(plugin, 2, picked, noticeCalls);
  const result = await plugin.finalizeClosedTasks(CLOSED, {
    dailyPath: DAY_PATH,
    dailyBefore: DAY.split("\n"),
    today: TODAY,
    keepMovingConfig: { configPath: "/test/config.yml", fsModule: {
      statSync: () => ({ mtimeMs: 1, size: 30 }),
      readFileSync: () => "plan:\n  keep_moving: true",
    } },
  });
  assert.equal(picked.models.length, 1);
  assert.equal(picked.models[0].groups[0].group, "keep_moving");
  assert.equal(result.successors.unblocked.length, 0);
  assert.equal(result.successors.keep_moving.length, 1);
  assert.match(editor.getValue(), /\[\*\].*\^renderer/);
  assert.match(harness.getSource(DAY_PATH), /\[\[sase_badges#\^[A-Za-z0-9_-]+\]\]/);
  assert.equal(noticeCalls.length, 0, "notice v1 falls back to accurate plain text for keep-moving rows");
  assert.ok(notices.some((notice) => String(notice.message || notice).startsWith("⏭")));
  const reopened = await plugin.consumeSuccessorReopenReceipt([{ path: PROJECT_PATH, blockId: "spec" }], {});
  assert.equal(reopened.linksRemoved, 1);
  assert.match(editor.getValue(), /\[ \] #task Ship the badge renderer \^renderer/);
  assert.doesNotMatch(harness.getSource(DAY_PATH), /\[\[sase_badges#\^renderer\]\]/);
});

test("KM24: a keep-moving pick that becomes Blocked while the picker is open is refused", async () => {
  notices.length = 0;
  const projectText = projectNote(["- [ ] #task Ship the badge renderer ^renderer"]);
  const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectText, "sase.md": "", "dev.md": "", [DAY_PATH]: DAY });
  installMetadata(harness.app);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => TODAY;
  const editor = createTextEditor(projectText, { line: 6, ch: 4 });
  attachActiveMarkdownView(plugin, harness, editor, PROJECT_PATH);
  const picked = {
    models: [], choose: true,
    mutate() {
      const next = editor.getValue().replace("[ ] #task Ship", "[?] #task Ship");
      const last = editor.lastLine();
      editor.replaceRange(next, { line: 0, ch: 0 }, { line: last, ch: editor.getLine(last).length });
    },
  };
  installPicker(plugin, 2, picked, []);
  const result = await plugin.finalizeClosedTasks(CLOSED, {
    dailyPath: DAY_PATH, dailyBefore: DAY.split("\n"), today: TODAY,
    keepMovingConfig: { fsModule: {
      statSync: () => ({ mtimeMs: 1, size: 30 }),
      readFileSync: () => "plan:\n  keep_moving: true",
    } },
  });
  assert.match(editor.getValue(), /\[\?\] #task Ship the badge renderer \^renderer/);
  assert.equal(result.successors.keep_moving.length, 0);
  assert.equal(result.successors.failure.count, 1);
  assert.doesNotMatch(harness.getSource(DAY_PATH), /\[\[sase_badges#\^renderer\]\]/);
});

test("KM19/KM32: picker v1 and a failed G3 day-byte gate add no keep-moving planning work", async () => {
  const noLinkDay = DAY.replace(`\t- [[${PROJECT_PATH.slice(0, -3)}#^spec]]`, "\t- [[other#^x]]");
  const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectNote(["- [ ] #task Ready work ^ready"]), "sase.md": "", "dev.md": "", [DAY_PATH]: noLinkDay });
  installMetadata(harness.app);
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, createTextEditor(""), PROJECT_PATH);
  let poolCalls = 0;
  plugin.buildSuccessorPool = async () => { poolCalls += 1; return { tasks: [], noteTexts: new Map(), warm: true }; };
  const picked = { models: [], choose: true };
  installPicker(plugin, 2, picked, []);
  const result = await plugin.planAndApplySuccessorsNow(CLOSED, {
    dailyPath: DAY_PATH,
    dailyBefore: noLinkDay.split("\n"),
    today: TODAY,
    keepMovingConfig: { fsModule: { statSync: () => ({ mtimeMs: 1, size: 20 }), readFileSync: () => "plan: {}" } },
  });
  assert.equal(result.gated, true);
  assert.equal(poolCalls, 0);
  assert.equal(picked.models.length, 0);
  const v1 = { models: [], choose: true };
  installPicker(plugin, 1, v1, []);
  const older = await plugin.planAndApplySuccessorsNow(CLOSED, {
    dailyPath: DAY_PATH,
    dailyBefore: DAY.split("\n"),
    today: TODAY,
  });
  assert.equal((older.keep_moving || []).length, 0);
  assert.equal(v1.models.length, 0);
});

test("KM1: Obsidian daily-note link close offers keep-moving and links after the struck predecessor", async () => {
  notices.length = 0;
  helpers.resetSuccessorKeepMovingCache();
  const projectText = openKeepMovingProject();
  const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectText, "sase.md": "", "dev.md": "", [DAY_PATH]: DAY });
  installMetadata(harness.app);
  const editor = createTextEditor(DAY, { line: 4, ch: 5 });
  const plugin = makeRealPlugin(harness, editor, DAY_PATH);
  const picked = { models: [], choose: true };
  const noticeCalls = [];
  installPicker(plugin, 2, picked, noticeCalls, 2);
  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, { path: DAY_PATH });
  await settleReal(plugin);
  assert.equal(result.changed, true);
  assert.equal(picked.models.length, 1);
  assert.equal(picked.models[0].groups.length, 1);
  assert.equal(picked.models[0].groups[0].group, "keep_moving");
  const updatedProject = harness.getSource(PROJECT_PATH);
  const resident = updatedProject.split("\n").find((line) => line.includes("^renderer"));
  assert.match(resident, /\[\*\]/);
  const dayAfter = editor.getValue();
  assert.match(dayAfter, /~~\[\[sase_badges#\^spec\]\]~~/);
  assert.match(dayAfter, /\[\[sase_badges#\^renderer\]\]/);
  assert.ok(dayAfter.indexOf("~~[[sase_badges#^spec]]~~") < dayAfter.indexOf("[[sase_badges#^renderer]]"));
});

test("KM26: own-note Ctrl+Enter offers keep-moving with notice v2 card and v1 plain text", async () => {
  for (const noticeVersion of [2, 1]) {
    notices.length = 0;
    helpers.resetSuccessorKeepMovingCache();
    const projectText = openKeepMovingProject();
    const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectText, "sase.md": "", "dev.md": "", [DAY_PATH]: DAY });
    installMetadata(harness.app);
    const predecessorLine = projectText.split("\n").findIndex((line) => line.includes("^spec"));
    const editor = createTextEditor(projectText, { line: predecessorLine, ch: 4 });
    const plugin = makeRealPlugin(harness, editor, PROJECT_PATH);
    const picked = { models: [], choose: true };
    const noticeCalls = [];
    installPicker(plugin, 2, picked, noticeCalls, noticeVersion);
    const taskStatus = plugin.getActiveTaskStatus(editor);
    const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(editor, { path: PROJECT_PATH }, taskStatus, {});
    await settleReal(plugin);
    assert.equal(wrote, true);
    assert.equal(picked.models.length, 1);
    assert.equal(picked.models[0].groups.length, 1);
    assert.equal(picked.models[0].groups[0].group, "keep_moving");
    const updatedProject = editor.getValue();
    assert.match(updatedProject.split("\n").find((line) => line.includes("^renderer")), /\[\*\]/);
    if (noticeVersion === 2) {
      assert.equal(noticeCalls.length, 1);
      assert.equal(noticeCalls[0].keep_moving.length, 1);
      assert.equal(noticeCalls[0].unblocked.length, 0);
      assert.equal(notices.length, 0);
    } else {
      assert.equal(
        String(notices[notices.length - 1] && (notices[notices.length - 1].message || notices[notices.length - 1])),
        "⏭ Next in FIX: Ship the badge renderer · keeps ‹sase_badges› moving",
      );
    }
  }
});

test("KM26: Alt+] into Done offers keep-moving and links the resident", async () => {
  notices.length = 0;
  helpers.resetSuccessorKeepMovingCache();
  const projectText = openKeepMovingProject().replace(
    "- [ ] #task Draft the badge spec ^spec",
    "- [*] #task Draft the badge spec ^spec",
  );
  const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectText, "sase.md": "", "dev.md": "", [DAY_PATH]: DAY });
  installMetadata(harness.app);
  const predecessorLine = projectText.split("\n").findIndex((line) => line.includes("^spec"));
  const editor = createTextEditor(projectText, { line: predecessorLine, ch: 4 });
  const plugin = makeRealPlugin(harness, editor, PROJECT_PATH);
  const picked = { models: [], choose: true };
  const noticeCalls = [];
  installPicker(plugin, 2, picked, noticeCalls, 2);
  const view = Object.assign(new MarkdownView(), { editor, file: { path: PROJECT_PATH } });
  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  await settleReal(plugin);
  assert.match(editor.getValue().split("\n")[predecessorLine], /\[x\]/);
  assert.equal(picked.models.length, 1);
  assert.equal(picked.models[0].groups[0].group, "keep_moving");
  assert.match(editor.getValue().split("\n").find((line) => line.includes("^renderer")), /\[\*\]/);
  assert.match(harness.getSource(DAY_PATH), /\[\[sase_badges#\^renderer\]\]/);
});

test("KM27: walk landing awaits the picker and returns the plain text with no card", async () => {
  notices.length = 0;
  helpers.resetSuccessorKeepMovingCache();
  const projectText = openKeepMovingProject();
  const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectText, "sase.md": "", "dev.md": "", [DAY_PATH]: DAY });
  installMetadata(harness.app);
  const predecessorLine = projectText.split("\n").findIndex((line) => line.includes("^spec"));
  const editor = createTextEditor(projectText, { line: predecessorLine, ch: 4 });
  const plugin = makeRealPlugin(harness, editor, PROJECT_PATH);
  const picked = { models: [], choose: true };
  const noticeCalls = [];
  installPicker(plugin, 2, picked, noticeCalls, 2);
  const taskStatus = plugin.getActiveTaskStatus(editor);
  const box = {};
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: PROJECT_PATH },
    taskStatus,
    { successorNoticeTarget: "return", successorNoticeBox: box },
  );
  assert.equal(wrote, true);
  assert.equal(picked.models.length, 1);
  assert.equal(box.text, "⏭ Next in FIX: Ship the badge renderer · keeps ‹sase_badges› moving");
  assert.equal(noticeCalls.length, 0);
  assert.equal(notices.length, 0);
});

test("KM25: Esc leaves the resident and the day byte-identical with no notice", async () => {
  notices.length = 0;
  helpers.resetSuccessorKeepMovingCache();
  const projectText = openKeepMovingProject();
  const harness = createInMemoryObsidianApp({ [PROJECT_PATH]: projectText, "sase.md": "", "dev.md": "", [DAY_PATH]: DAY });
  installMetadata(harness.app);
  const predecessorLine = projectText.split("\n").findIndex((line) => line.includes("^spec"));
  const editor = createTextEditor(projectText, { line: predecessorLine, ch: 4 });
  const plugin = makeRealPlugin(harness, editor, PROJECT_PATH);
  const picked = { models: [], choose: true, returnNull: true };
  const noticeCalls = [];
  installPicker(plugin, 2, picked, noticeCalls, 2);
  const dayBefore = harness.getSource(DAY_PATH);
  const residentBefore = projectText.split("\n").find((line) => line.includes("^renderer"));
  const taskStatus = plugin.getActiveTaskStatus(editor);
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(editor, { path: PROJECT_PATH }, taskStatus, {});
  await settleReal(plugin);
  assert.equal(wrote, true);
  assert.equal(picked.models.length, 1);
  const residentAfter = editor.getValue().split("\n").find((line) => line.includes("^renderer"));
  assert.equal(residentAfter, residentBefore);
  assert.ok(!residentAfter.includes("[*]"));
  assert.ok(!residentAfter.includes("[fresh::"));
  assert.equal((residentAfter.match(/\^[A-Za-z0-9_-]+/g) || []).length, 1);
  assert.equal(harness.getSource(DAY_PATH), dayBefore);
  assert.equal(noticeCalls.length, 0);
  assert.equal(notices.length, 0);
});

test("notice-form parity: one, several, mixed, and failure copy matches nav v2", () => {
  const one = purePlan({ residents: ["- [ ] #task Ship the badge renderer ^renderer"], options: { selection: "all" } }).plan;
  assert.equal(
    helpers.successorNoticeText({ keep_moving: one.keep_moving, unblocked: [] }),
    "⏭ Next in FIX: Ship the badge renderer · keeps ‹sase_badges› moving",
  );
  const several = purePlan({
    residents: [
      "- [ ] #task Ship the badge renderer ^renderer",
      "- [ ] #task Write badge docs ^docs",
    ],
    options: { selection: "all" },
  }).plan;
  assert.equal(
    helpers.successorNoticeText({ keep_moving: several.keep_moving, unblocked: [] }),
    "⏭ 2 linked → FIX · keeps ‹sase_badges› moving",
  );
  const mixed = helpers.successorNoticeText({
    predecessors: [{ note_path: PROJECT_PATH, block_id: "spec", text: "Draft the badge spec" }],
    unblocked: [{
      text: "Normal task", status_symbol: "*", status_name: "Next",
      link: { entry_name: "FIX" }, trigger: "dependency", not_linked: null,
    }],
    keep_moving: one.keep_moving,
  });
  assert.equal(mixed, "🔓 2 linked → FIX: Normal task, Ship the badge renderer");
  const failedRow = {
    ...one.keep_moving[0],
    link: null,
    not_linked: "failed",
    offer: { ...(one.keep_moving[0].offer || {}), selected: true },
  };
  const allFailed = helpers.successorNoticeText({
    predecessors: [{ note_path: PROJECT_PATH, block_id: "spec", text: "Draft the badge spec" }],
    unblocked: [],
    keep_moving: [failedRow],
    failure: { count: 1, reason: "daily note changed" },
  });
  assert.equal(allFailed, "⚠ Closed Draft the badge spec — couldn't link 1 successor (daily note changed)");
  const partial = helpers.successorNoticeText({
    predecessors: [{ note_path: PROJECT_PATH, block_id: "spec", text: "Draft the badge spec" }],
    unblocked: [],
    keep_moving: [one.keep_moving[0], failedRow],
    failure: { count: 1, reason: "daily note changed" },
  });
  assert.equal(partial, "⚠ Closed Draft the badge spec — couldn't link 1 successor (daily note changed)");
});
