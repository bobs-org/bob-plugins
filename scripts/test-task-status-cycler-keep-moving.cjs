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

const TODAY = helpers.formatLocalDate();
const DAY_PATH = helpers.todayDailyPath({}, new Date(`${TODAY}T12:00:00`));
const LATER = helpers.formatLocalDate(new Date(Date.parse(`${TODAY}T12:00:00`) + 30 * 86400000));
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
  assert.match(plan.edits[0].after, new RegExp(`\\[fresh:: ${TODAY}\\]`));
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
  assert.equal(purePlan({ residents, options: { leafProject: () => false } }).plan.keep_moving.length, 0); // KM6: root project -> nothing.
  const ownRoot = purePlan({ residents, rootLine: "- [ ] #task Badge project ^prj", options: { leafProject: () => false } });
  assert.equal(ownRoot.plan.keep_moving.length, 0);
  const blockedRoots = [
    "- [?] #task Badge project ^prj",
    "- [ ] #task Badge project #prj_is_blocked ^prj",
    `- [ ] #task Badge project [scheduled:: ${LATER}] ^prj`,
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
      `- [ ] #task Scheduled later [scheduled:: ${LATER}] ^later`,
      "- [ ] #task Hidden #hide ^hidden",
      "- [ ] #ref Read this paper ^ref",
      "  - [ ] #task Nested subtask ^nested",
      `- [ ] #task Recurring today [scheduled:: ${TODAY}] ^recurring`,
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
    `- [ ] #task Future [scheduled:: ${LATER}] ^future`,
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

test("KM6 umbrella: a marked root offers nothing while an unmarked top-level project offers (KM33)", () => {
  // Umbrella end-to-end: sase.md lists a sub-project, so closing its last
  // planned link offers no keep-moving group even though residents remain.
  const umbrellaNotes = {
    "sase.md": [
      "---", 'type: "[[project]]"', "status: wip", "parent: [[dev]]", "---",
      "- [ ] #task Sase project ^prj",
      "  - 🧩 **Sub-projects:** [[sase_goals]]",
      "- [x] #task Planned umbrella work ^spec",
      "- [ ] #task Leftover umbrella work ^left",
    ].join("\n"),
  };
  const umbrellaFm = {
    "dev.md": { type: "[[area]]" },
    "sase.md": { type: "[[project]]", parent: "[[dev]]" },
  };
  const umbrellaApp = fakeMetadataApp(umbrellaFm);
  const umbrellaDay = [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — FIX", "\t- [[sase#^spec]]"].join("\n");
  const umbrellaTasks = helpers.tasksFromDocuments(Object.entries(umbrellaNotes).map(([path, text]) => ({ path, text })));
  const umbrellaPlan = helpers.planSuccessors({
    closed: [{ path: "sase.md", blockId: "spec", text: "- [x] #task Planned umbrella work ^spec" }],
    index: helpers.buildDependentsIndex(umbrellaTasks),
    dailyBefore: umbrellaDay,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: umbrellaNotes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: (path) => helpers.successorLeafProject(umbrellaApp, path),
  });
  assert.equal(umbrellaPlan.keep_moving.length, 0); // KM6: root project -> nothing.

  // KM33: recruiter sub-project (project -> project -> area) with four
  // Next residents offers all four rows, mirroring the screenshot ledger.
  const notePath = "job_email_recruiters.md";
  const screenshotNotes = {
    [notePath]: [
      "---", 'type: "[[project]]"', "status: wip", "parent: [[job_2026]]", "---",
      "- [ ] #task Job email recruiters ^prj",
      "- [x] #task Reply to Luzern ^luzern",
      "- [*] #task Ecogpt ^ecogpt",
      "- [*] #task Ray Lyles ^ray-lyles",
      "- [*] #task Product engineer Dan Dowd ^product-engineer-dan-dowd",
      "- [*] #task Senior rust java engineer ^senior-rust-java-engineer",
    ].join("\n"),
  };
  const screenshotFm = {
    "job.md": { type: "[[area]]" },
    "job_2026.md": { type: "[[project]]", parent: "[[job]]" },
    [notePath]: { type: "[[project]]", parent: "[[job_2026]]" },
  };
  const screenshotApp = fakeMetadataApp(screenshotFm);
  const screenshotDay = [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — WRITE", `\t- [[job_email_recruiters#^luzern]]`].join("\n");
  const screenshotTasks = helpers.tasksFromDocuments(Object.entries(screenshotNotes).map(([path, text]) => ({ path, text })));
  const screenshotPlan = helpers.planSuccessors({
    closed: [{ path: notePath, blockId: "luzern", text: "- [x] #task Reply to Luzern ^luzern" }],
    index: helpers.buildDependentsIndex(screenshotTasks),
    dailyBefore: screenshotDay,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: screenshotNotes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: (path) => helpers.successorLeafProject(screenshotApp, path),
  });
  assert.equal(screenshotPlan.keep_moving.length, 4); // KM33.
  assert.deepEqual(
    screenshotPlan.keep_moving.map((row) => row.block_id).sort(),
    ["ecogpt", "product-engineer-dan-dowd", "ray-lyles", "senior-rust-java-engineer"].sort(),
  );
  assert.ok(screenshotPlan.keep_moving.every((row) => row.offer && row.offer.group === "keep_moving"));
});

test("LP16 planner: a _generated tag page never blocks the keep-moving group", () => {
  const notePath = "sase_goals.md";
  const notes = {
    [notePath]: [
      "---", 'type: "[[project]]"', "status: wip", "parent: [[sase]]", "---",
      "- [ ] #task Sase goals ^prj",
      "- [x] #task Planned goals work ^spec",
      "- [ ] #task Leftover goals work ^left",
    ].join("\n"),
  };
  const fm = {
    "dev.md": { type: "[[area]]" },
    "sase.md": { type: "[[project]]", parent: "[[dev]]" },
    [notePath]: { type: "[[project]]", parent: "[[sase]]" },
  };
  const day = [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — FIX", `\t- [[sase_goals#^spec]]`].join("\n");
  const tasks = helpers.tasksFromDocuments(Object.entries(notes).map(([path, text]) => ({ path, text })));
  const planWithout = helpers.planSuccessors({
    closed: [{ path: notePath, blockId: "spec", text: "- [x] #task Planned goals work ^spec" }],
    index: helpers.buildDependentsIndex(tasks),
    dailyBefore: day,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: notes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: (path, text) => helpers.successorLeafProject(fakeMetadataApp(fm), path, text ?? notes[path]),
  });
  const planWith = helpers.planSuccessors({
    closed: [{ path: notePath, blockId: "spec", text: "- [x] #task Planned goals work ^spec" }],
    index: helpers.buildDependentsIndex(tasks),
    dailyBefore: day,
    dailyPath: DAY_PATH,
    today: TODAY,
    noteTexts: notes,
    keepMoving: true,
    dependencySnapshotAvailable: true,
    leafProject: (path, text) => helpers.successorLeafProject(
      fakeMetadataApp(fm, ["_generated/tag_pages/topic/sase.md"]), path, text ?? notes[path]),
  });
  assert.equal(planWithout.keep_moving.length, 1);
  assert.equal(planWith.keep_moving.length, 1); // LP16: same answer with the tag page.
});

function fakeMetadataApp(frontmatterByPath, extraPaths = []) {
  const paths = Object.keys(frontmatterByPath);
  const allPaths = [...paths, ...extraPaths];
  const byPath = new Map(allPaths.map((path) => [path, { path }]));
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
        return allPaths.find((path) => path.split("/").pop().replace(/\.md$/i, "") === clean) ?
          byPath.get(allPaths.find((path) => path.split("/").pop().replace(/\.md$/i, "") === clean)) : null;
      },
    },
  };
}

// Marker-independence note texts: an open ^prj with the marker directly beneath it
// (two-space indent, as sync maintains) lists sub-projects; anything else is
// not a direct-child marker (LP17).
function leafNoteText({ marker = null, extra = [], rootLine = "- [ ] #task Leaf project ^prj" } = {}) {
  const lines = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    rootLine,
  ];
  if (marker) lines.push(marker);
  lines.push(...extra);
  lines.push("- [ ] #task Resident work ^resident");
  return lines.join("\n");
}

const LEAF_OPEN_MARKER = "  - 🧩 **Sub-projects:** [[some_child]]";
const LEAF_STRUCK_MARKER = "  - 🧩 **Sub-projects:** ~~[[gone_a]]~~ ✅ ~~[[gone_b]]~~ ❌";

test("LP1-LP17: sub-projects have a different R2 root parent", () => {
  const fm = {
    "dev.md": { type: "[[area]]" },
    "sase.md": { type: "[[project]]", parent: "[[dev]]" },
    "sase_goals.md": { type: "[[project]]", parent: "[[sase]]" },
    "sase_blog.md": { type: "[[project]]", root: " TRUE ", parent: "[[sase]]" },
    "sase_pre_blog.md": { type: "[[project]]", parent: "[[sase_blog]]" },
    "p.md": { type: "[[project]]", parent: "[[gtd_daily]]" },
    "gtd_daily.md": { type: "[[area]]", parent: "[[dev]]" },
    "o.md": { type: "[[project]]" },
    "wrapper.md": { type: "other", parent: "[[sase]]" },
    "k.md": { type: "[[project]]", parent: "[[wrapper]]" },
    "m.md": { type: "[[project]]", parent: "[[sase]]" },
    "a.md": { type: "[[project]]", parent: "[[b]]" },
    "b.md": { type: "[[project]]", parent: "[[a]]" },
    "missing.md": { type: "[[project]]", parent: "[[gone]]" },
    "x/dup.md": { type: "[[project]]", parent: "[[dev]]" },
    "y/dup.md": { type: "[[project]]", parent: "[[dev]]" },
    "ambiguous.md": { type: "[[project]]", parent: "[[dup]]" },
    "job.md": { type: "[[area]]" },
    "job_2026.md": { type: "[[project]]", parent: "[[job]]" },
    "job_email_recruiters.md": { type: "[[project]]", parent: "[[job_2026]]" },
    "rooted_lone.md": { type: "[[project]]", root: "true", parent: "[[dev]]" },
    "umbrella_closed.md": { type: "[[project]]", root: "true", parent: "[[dev]]" },
    "root_prose.md": { type: "[[project]]", root: "true", parent: "[[dev]]" },
  };
  const texts = {
    "sase_goals.md": leafNoteText(), // LP1: sub-project -> leaf.
    "sase.md": leafNoteText({ marker: "  - 🧩 **Sub-projects:** [[sase_goals]]" }), // LP2: umbrella.
    "sase_blog.md": leafNoteText({ marker: "  - 🧩 **Sub-projects:** [[sase_pre_blog]]" }), // LP3: umbrella.
    "sase_pre_blog.md": leafNoteText(), // LP4: leaf.
    "p.md": leafNoteText(), // LP5: standalone top-level -> root.
    "o.md": leafNoteText(), // LP6: orphan -> root.
    "k.md": leafNoteText(), // LP8: wrapper walked through -> leaf.
    "m.md": leafNoteText({ marker: "  - 🧩 **Sub-projects:** [[m_child]]" }), // LP9: middle with child -> leaf.
    "a.md": leafNoteText(), // LP12: non-self cycle -> leaf.
    "missing.md": leafNoteText(), // LP7: unresolved parent -> root.
    "ambiguous.md": leafNoteText(), // LP7: ambiguous parent -> root.
    "job_email_recruiters.md": leafNoteText(), // LP13: screenshot -> leaf.
    "rooted_lone.md": leafNoteText(), // LP14: root:true without marker -> root.
    "umbrella_closed.md": leafNoteText({ marker: LEAF_STRUCK_MARKER }), // LP15: struck children still count.
  };
  const app = fakeMetadataApp(fm);
  const leaf = (path, text) => helpers.successorLeafProject(app, path);
  assert.equal(leaf("sase_goals.md", texts["sase_goals.md"]), true); // LP1
  assert.equal(leaf("sase.md", texts["sase.md"]), false); // LP2
  assert.equal(leaf("sase_blog.md", texts["sase_blog.md"]), false); // LP3
  assert.equal(leaf("sase_pre_blog.md", texts["sase_pre_blog.md"]), true); // LP4
  assert.equal(leaf("p.md", texts["p.md"]), false); // LP5
  assert.equal(leaf("o.md", texts["o.md"]), false); // LP6
  assert.equal(leaf("missing.md", texts["missing.md"]), false); // LP7 no marker -> root
  assert.equal(leaf("ambiguous.md", texts["ambiguous.md"]), false); // LP7 no marker -> root
  assert.equal(leaf("missing.md", leafNoteText({ marker: LEAF_OPEN_MARKER })), false); // LP7 marker -> root
  assert.equal(leaf("ambiguous.md", leafNoteText({ marker: LEAF_OPEN_MARKER })), false); // LP7 marker -> root
  assert.equal(leaf("k.md", texts["k.md"]), true); // LP8
  assert.equal(leaf("m.md", texts["m.md"]), true); // LP9
  assert.equal(leaf("sase_goals.md", texts["sase_goals.md"]), true); // LP10: [root::] never changes its note.
  assert.equal(leaf("dev.md", leafNoteText()), false); // LP11: area never a leaf.
  assert.equal(leaf("a.md", texts["a.md"]), true); // LP12
  assert.equal(leaf("job_email_recruiters.md", texts["job_email_recruiters.md"]), true); // LP13
  assert.equal(leaf("rooted_lone.md", texts["rooted_lone.md"]), false); // LP14
  assert.equal(leaf("umbrella_closed.md", texts["umbrella_closed.md"]), false); // LP15
  // LP17: prose, fenced, and sibling-task markers are not R's direct-child marker.
  assert.equal(leaf("root_prose.md", leafNoteText({ extra: ["See the 🧩 **Sub-projects:** [[child]] discussion above."] })), false); // LP17 prose.
  assert.equal(leaf("root_prose.md", leafNoteText({ extra: ["```", "🧩 **Sub-projects:** [[child]]", "```"] })), false); // LP17 fenced.
  assert.equal(leaf("root_prose.md", leafNoteText({ extra: ["- [ ] #task Other work ^other", "  - 🧩 **Sub-projects:** [[child]]"] })), false); // LP17 sibling child.
  assert.equal(helpers.successorKeepMovingRootFlag({ root: true }), true);
  assert.equal(helpers.successorKeepMovingRootFlag({ root: " tRuE " }), true);
  assert.equal(helpers.successorKeepMovingRootFlag({ root: "yes" }), false);
  // LP16: _generated tag pages never make a parent stem ambiguous.
  const generatedApp = fakeMetadataApp(fm, ["_generated/tag_pages/topic/sase.md"]);
  assert.equal(helpers.successorLeafProject(generatedApp, "sase_goals.md", texts["sase_goals.md"]), true); // LP16
  const deep = { "dev.md": { type: "[[area]]" }, "start.md": { type: "[[project]]", parent: "[[w0]]" } };
  const deepTexts = {};
  for (let index = 0; index < 16; index += 1) {
    deep[`w${index}.md`] = { type: "other", parent: index === 15 ? "[[later]]" : `[[w${index + 1}]]` };
  }
  deep["later.md"] = { type: "[[project]]", parent: "[[dev]]" };
  deepTexts["start.md"] = leafNoteText({ marker: LEAF_OPEN_MARKER });
  assert.equal(helpers.successorLeafProject(fakeMetadataApp(deep), "start.md", deepTexts["start.md"]), false); // R2 depth cap.
});

test("KM copy, folds, title, lane labels, notices, and config parser/cache match the accepted API", () => {
  const { plan } = purePlan({ residents: [
    "- [ ] #task Write badge docs ^docs",
      "- [?] #task Blocked ^blocked",
    `- [ ] #task Scheduled [scheduled:: ${LATER}] ^later`,
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

test("KM33: Ctrl+Enter on the screenshot link opens a 4-row Keep group and Esc writes nothing", async () => {
  // Real close wiring for a standalone top-level project (project -> area,
  // no Sub-projects marker, hidden ^prj, X carries [id::]): the same path the
  // ⏭ 4 mark forecasts (docs/keep-moving-marks.md, KB7).
  notices.length = 0;
  helpers.resetSuccessorKeepMovingCache();
  const notePath = "job_email_recruiters.md";
  const projectText = [
    "---", 'type: "[[project]]"', "status: wip", "parent: [[job_2026]]", "---",
    "- [ ] #task #prj Email all recruiters back! #hide ^prj",
    "- [*] #task Reply to Luzern [id:: job_email_recruiters__luzern] ^luzern",
    "- [*] #task Ecogpt ^ecogpt",
    "- [*] #task Ray Lyles ^ray-lyles",
    "- [*] #task Product engineer Dan Dowd ^product-engineer-dan-dowd",
    "- [*] #task Senior rust java engineer ^senior-rust-java-engineer",
  ].join("\n");
  const day = [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — WRITE", "\t- [[job_email_recruiters#^luzern]]"].join("\n");
  const harness = createInMemoryObsidianApp({ [notePath]: projectText, "job.md": "", "job_2026.md": "", [DAY_PATH]: day });
  const frontmatter = {
    [notePath]: { type: "[[project]]", parent: "[[job_2026]]" },
    "job.md": { type: "[[area]]" },
    "job_2026.md": { type: "[[project]]", parent: "[[job]]" },
  };
  harness.app.metadataCache.getCache = (path) => frontmatter[path] ? { frontmatter: frontmatter[path] } : null;
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makeRealPlugin(harness, editor, DAY_PATH);
  const picked = { models: [], choose: false };
  installPicker(plugin, 2, picked, [], 2);
  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, { path: DAY_PATH });
  await settleReal(plugin);
  assert.equal(result.changed, true);
  assert.equal(picked.models.length, 1);
  const groups = picked.models[0].groups;
  assert.deepEqual(groups.map((group) => group.group), ["keep_moving"]);
  assert.equal(groups[0].header, "Keep ‹job_email_recruiters› moving");
  const rows = groups[0].rows.filter((row) => row.selectable);
  assert.deepEqual(
    rows.map((row) => String(row.key).split("#^").pop()).sort(),
    ["ecogpt", "product-engineer-dan-dowd", "ray-lyles", "senior-rust-java-engineer"],
  );
  assert.ok(rows.every((row) => row.selected !== true), "nothing preselected");
  // Esc: only X closes and its link strikes; no resident or day link is written.
  const projectAfter = harness.getSource(notePath).split("\n");
  assert.match(projectAfter.find((line) => line.includes("^luzern")), /^- \[x\]/);
  for (const id of ["ecogpt", "ray-lyles", "product-engineer-dan-dowd", "senior-rust-java-engineer"]) {
    assert.equal(
      projectAfter.find((line) => line.endsWith(`^${id}`)),
      projectText.split("\n").find((line) => line.endsWith(`^${id}`)),
    );
  }
  const dayAfter = editor.getValue();
  assert.match(dayAfter, /~~\[\[job_email_recruiters#\^luzern\]\]~~/);
  assert.equal((dayAfter.match(/\[\[job_email_recruiters#/g) || []).length, 1);
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
