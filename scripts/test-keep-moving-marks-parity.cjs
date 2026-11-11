const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers: markHelpers } = require("./ledger-tools-harness.cjs");
const { helpers: cyclerHelpers } = require("./task-status-cycler-harness.cjs");

const TODAY = "2026-11-02";
const DAILY_PATH = "2026/20261102.md";
const PROJECT_PATH = "job_email_recruiters.md";

function projectText(closed = false) {
  return [
    "---", 'type: "[[project]]"', "status: wip", "parent: [[job_2026]]", "---",
    "- [ ] #task Root #prj ^prj",
    closed ? "- [x] #task Trigger ^x" : "- [*] #task Trigger ^x",
    "- [ ] #task Ready ^ready",
    "- [*] #task Next ^next",
    "- [/] #task Pending ^pending",
    "- [ ] #ref Read the source ^reference",
    "- [?] #task Blocked ^blocked",
    "- [ ] #task Scheduled [scheduled:: 2026-11-03] ^scheduled",
    "- [ ] #task Hidden #hide ^hidden",
  ].join("\n");
}

function dayText() {
  return ["# 2026-11-02", "", "## Pomodoros", "- [ ] () — WRITE",
    "\t- [[job_email_recruiters#^x]]"].join("\n");
}

for (const root of [false, true]) test(`KB24: mark identities and folds equal the full planner for a ${root ? "root" : "sub-project"}`, () => {
  const before = projectText(false);
  const after = projectText(true);
  const day = dayText();
  const memoTasks = markHelpers.keepMovingMarkTaskRows(PROJECT_PATH, before)
    .filter((row) => row.isTask)
    .map((row) => ({
      id: row.taskId || undefined,
      blockLink: row.blockId ? " ^" + row.blockId : "",
      path: PROJECT_PATH,
      lineNumber: row.line,
      status: { type: row.status === "*" ? "ON_HOLD" : row.status === "/" ? "IN_PROGRESS" : "TODO", symbol: row.status },
      description: row.rawLine,
      originalMarkdown: row.rawLine,
      dependsOn: row.dependsOn,
      tags: [],
    }));
  const memo = { tasks: memoTasks, warm: true, dateText: TODAY };
  const fm = {
    [PROJECT_PATH]: { type: "[[project]]", status: "wip", parent: root ? "[[job]]" : "[[job_2026]]" },
    "job_2026.md": { type: "[[project]]", parent: "[[job]]" },
    "job.md": { type: "[[area]]" },
  };
  const paths = Object.keys(fm);
  const resolve = (target) => {
    const path = String(target).split("#")[0].replace(/\.md$/i, "") + ".md";
    return fm[path] ? { path } : null;
  };
  const app = {
    vault: { getMarkdownFiles: () => paths.map((path) => ({ path })) },
    metadataCache: { getCache: (path) => fm[path] ? { frontmatter: fm[path] } : null, getFirstLinkpathDest: resolve },
  };
  const markContext = {
    memo,
    dayText: day,
    dailyPath: DAILY_PATH,
    today: TODAY,
    config: { keepMoving: true, linkUnblocked: true, successorLabels: [] },
    noteTextFor: (path) => path === PROJECT_PATH ? before : "",
    frontmatterFor: (path) => fm[path] || null,
    markdownPaths: () => paths,
    resolveLinkpath: resolve,
  };
  const closing = memoTasks.find((task) => /\^x$/.test(task.blockLink));
  const markModel = markHelpers.keepMovingMarkCount(closing, { path: PROJECT_PATH, text: before }, markContext);

  const documents = [{ path: PROJECT_PATH, text: after }];
  const plannerTasks = cyclerHelpers.tasksFromDocuments(documents);
  const plan = cyclerHelpers.planSuccessors({
    closed: [{ path: PROJECT_PATH, blockId: "x", text: "- [*] #task Trigger ^x" }],
    index: cyclerHelpers.buildDependentsIndex(plannerTasks),
    dailyBefore: day,
    dailyAfter: day,
    dailyPath: DAILY_PATH,
    today: TODAY,
    noteTexts: { [PROJECT_PATH]: after },
    notePaths: [PROJECT_PATH],
    keepMoving: true,
    dependencySnapshotAvailable: true,
    app,
    selection: [],
  });

  const identities = (rows) => rows.map((row) => `${row.path || row.task?.path || PROJECT_PATH}\0${row.blockId || row.block_id}`).sort();
  assert.equal(markModel.state, root ? "zero" : "positive");
  assert.deepEqual(identities(markModel.rows || []), identities(plan.keep_moving));
  assert.deepEqual((markModel.rows || []).map((row) => row.blockId).sort(),
    (root ? [] : ["pending", "next", "ready", "reference"]).sort());
  assert.equal(plan.rows.length, plan.keep_moving.length);
  assert.deepEqual(markModel.folded, plan.foldedByProject.get(PROJECT_PATH) || { blocked: 0, scheduled: 0, hidden: 0 });
});

test("LP1–LP17: ledger leafness agrees with the reverted cycler walk", () => {
  const { leafFixtures } = require("./keep-moving-leaf-fixtures.cjs");
  for (const { id, path, text, ctx, app, expected } of leafFixtures()) {
    assert.equal(cyclerHelpers.successorLeafProject(app, path), expected, `cycler ${id}`);
    assert.equal(markHelpers.keepMovingMarkLeafProject(path, text, ctx), expected, `ledger ${id}`);
  }
});
