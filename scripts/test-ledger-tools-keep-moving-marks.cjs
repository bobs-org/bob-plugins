// KB/KT/LP vectors from docs/keep-moving-marks.md.
const assert = require("node:assert/strict");
const test = require("node:test");
const { performance } = require("node:perf_hooks");
const { helpers: h } = require("./ledger-tools-harness.cjs");

const TODAY = "2026-11-02";
const DAY_PATH = "2026/20261102.md";
const PROJECT_PATH = "job_email_recruiters.md";

function note(residents = [], opts = {}) {
  const lines = ["---", 'type: "[[project]]"', "status: " + (opts.status || "wip")];
  lines.push("parent: " + (opts.parent ?? "[[job_2026]]"));
  if (opts.root) lines.push("root: true");
  if (opts.scheduled) lines.push("scheduled: " + opts.scheduled);
  lines.push("---", opts.rootLine || "- [ ] #task Root #prj ^prj");
  if (opts.marker) lines.push("\t- 🧩 **Sub-projects:** " + opts.marker);
  lines.push(opts.xLine || "- [*] #task Trigger ^x");
  return lines.concat(residents).join("\n");
}

function taskFor(row) {
  const types = { "/": "IN_PROGRESS", "*": "ON_HOLD", x: "DONE", X: "DONE", "-": "DONE" };
  const tags = [...String(row.rawLine || "").matchAll(/(^|\s)#([A-Za-z0-9_/-]+)/g)].map((match) => match[2]);
  return {
    id: row.taskId || undefined, blockLink: row.blockId ? " ^" + row.blockId : "",
    path: row.path, lineNumber: row.line,
    status: { type: types[row.status] || "TODO", symbol: row.status },
    description: row.rawLine, originalMarkdown: row.rawLine,
    dependsOn: row.dependsOn.slice(), tags,
  };
}

function taskBlockId(task) {
  return String(task && task.blockLink || "").match(/\^([A-Za-z0-9-]+)$/)?.[1] || "";
}

function tasksFor(path, source) {
  return h.keepMovingMarkTaskRows(path, source).filter((row) => row.isTask).map(taskFor);
}

function ctxFor(source, opts = {}) {
  const paths = [PROJECT_PATH, "job_2026.md", "job.md", ...(opts.paths || [])];
  const texts = { [PROJECT_PATH]: source, ...(opts.notes || {}) };
  const frontmatter = {
    [PROJECT_PATH]: {
      type: "[[project]]", status: "wip", parent: opts.parent ?? "[[job_2026]]",
      ...(opts.root ? { root: true } : {}),
      ...(opts.scheduled ? { scheduled: opts.scheduled } : {}),
      ...(opts.frontmatter || {}),
    },
    "job_2026.md": { type: "[[project]]", parent: "[[job]]" },
    "job.md": { type: "[[area]]" },
    ...(opts.frontmatterByPath || {}),
  };
  return {
    memo: { tasks: opts.tasks || tasksFor(PROJECT_PATH, source), dateText: TODAY, warm: opts.warm !== false },
    dayText: opts.day || "## Pomodoros\n- [ ] () — WRITE\n\t- [[job_email_recruiters#^x]]",
    dailyPath: DAY_PATH, today: TODAY,
    config: opts.config || { keepMoving: true, linkUnblocked: true, successorLabels: [] },
    relationIndex: opts.relationIndex,
    noteTextFor: (path) => texts[path] || "",
    frontmatterFor: (path) => frontmatter[path] || null,
    markdownPaths: () => paths,
    resolveLinkpath: (target) => {
      const stem = String(target || "").split("|")[0].split("#")[0].replace(/\.md$/i, "");
      const found = paths.filter((path) => path.replace(/\.md$/i, "") === stem ||
        path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === stem.split("/").pop().toLowerCase());
      return found.length === 1 ? { path: found[0] } : null;
    },
  };
}

function count(residents, opts = {}) {
  const source = note(residents, opts);
  const ctx = ctxFor(source, opts);
  const x = ctx.memo.tasks.find((task) => taskBlockId(task) === "x");
  return h.keepMovingMarkCount(x, { path: PROJECT_PATH, text: source }, ctx);
}

function projectText(parent, marker = "", extras = "") {
  return ["---", 'type: "[[project]]"', "status: wip", parent ? "parent: " + parent : "", extras,
    "---", "- [ ] #task Root #prj ^prj",
    marker ? "\t- 🧩 **Sub-projects:** " + marker : ""].filter(Boolean).join("\n");
}

test("KB1/KB7/KB8: mixed lane order and exact count", () => {
  // KB1: mixed lanes; KB7: four Next tasks; KB8: nested project is a leaf.
  const model = count(["- [/] #task Ship ^p", "- [*] #task Wire ^n", "- [ ] #task Write ^r"]);
  assert.equal(model.state, "positive");
  assert.equal(model.count, 3);
  assert.deepEqual(model.rows.map((row) => row.lane), ["Pending", "Next", "Ready"]);
  assert.equal(count(["- [*] #task A ^a", "- [*] #task B ^b", "- [*] #task C ^c", "- [*] #task D ^d"]).count, 4);
});

test("KB2–KB6/KB9/KB10: live-link, root, folds, and final-close gates", () => {
  // KB2: all live-link shapes block; KB3: strike restores the baton.
  for (const link of ["[[job_email_recruiters#^u]]", "[[job_email_recruiters#^u]] #", "![[job_email_recruiters#^u]]"]) {
    assert.equal(count(["- [ ] #task Another ^u"], {
      day: "## Pomodoros\n- [ ] () — WRITE\n\t- [[job_email_recruiters#^x]]\n\t- " + link,
    }).state, "zero");
  }
  assert.equal(count(["- [ ] #task Another ^u"], {
    day: "## Pomodoros\n- [ ] () — WRITE\n\t- [[job_email_recruiters#^x]]\n\t- ~~[[job_email_recruiters#^u]]~~",
  }).count, 1); // KB3
  assert.equal(count(["- [ ] #task Another ^u"], {
    day: "## Pomodoros\n- [x] (**0900-0930**) — OLD\n\t- [[job_email_recruiters#^u]]\n- [ ] () — WRITE\n\t- [[job_email_recruiters#^x]]",
  }).count, 1); // KB4
  assert.equal(count(["- [ ] #task A ^a"], {
    day: "## Pomodoros\n- [ ] () — WRITE\n\t- [[job_email_recruiters#^x]]\n\t- [[job_email_recruiters#^prj]]",
  }).state, "zero"); // KB5
  assert.equal(count(["- [ ] #task A ^a"], { root: true, marker: "[[child]]" }).state, "zero"); // KB6
  assert.equal(count(["- [ ] #task A ^a"], { root: true }).state, "zero");
  assert.equal(count(["- [ ] #task A ^a"], { parent: "[[job]]" }).state, "zero");
  const folded = count(["- [?] #task B ^b", "- [ ] #task S [scheduled:: 2026-11-03] ^s", "- [ ] #task H #hide ^h"]);
  assert.deepEqual(folded.folded, { blocked: 1, scheduled: 1, hidden: 1 }); // KB9
  assert.equal(count([]).state, "zero"); // KB10
});

test("KB11–KB15/KB19/KB20/KB23: post-close blockers and uncertainty", () => {
  // KB11: a hand-off is not counted; KB19: an unresolved dependency does not block.
  assert.equal(count(["- [ ] #task H [id:: child] [dependsOn:: owner] ^h"], {
    xLine: "- [*] #task Trigger [id:: owner] ^x",
  }).count, 0);
  assert.equal(count(["- [ ] #task U [dependsOn:: missing] ^u"]).count, 1);
  // KB12: configured relation successors use the relation index.
  assert.equal(count(["- [ ] #task Sequenced ^s"], {
    config: { keepMoving: true, linkUnblocked: true, successorLabels: ["starts after"] },
    relationIndex: { ready: () => true, outgoing: () => [{ label: "Starts After", target: { path: PROJECT_PATH, blockId: "x" } }] },
  }).state, "zero");
  // KB13: project blocked status, tag, dependency, and schedule gates.
  for (const rootLine of ["- [?] #task R #prj ^prj", "- [ ] #task R #prj_is_blocked ^prj",
    "- [ ] #task R [dependsOn:: blocker] ^prj"]) {
    const source = note(["- [ ] #task A ^a"], { rootLine });
    const tasks = tasksFor(PROJECT_PATH, source).concat([{
      id: "blocker", blockLink: " ^blocker", path: "other.md", lineNumber: 0,
      status: { type: "TODO", symbol: " " }, dependsOn: [], tags: [],
    }]);
    const ctx = ctxFor(source, { tasks });
    const x = tasks.find((task) => taskBlockId(task) === "x");
    assert.equal(h.keepMovingMarkCount(x, { path: PROJECT_PATH, text: source }, ctx).state, "zero");
  }
  assert.equal(count(["- [ ] #task A ^a"], { scheduled: "2026-11-03" }).state, "zero");
  assert.equal(count(["- [ ] #task A ^a"], { scheduled: TODAY }).count, 1);
  // KB14: disabled and cold inputs stay neutral.
  assert.equal(count(["- [ ] #task A ^a"], { config: { keepMoving: false } }).state, "zero");
  const coldSource = note(["- [ ] #task A ^a"]);
  const cold = ctxFor(coldSource, { warm: false });
  assert.equal(h.keepMovingMarkCount(cold.memo.tasks.find((t) => taskBlockId(t) === "x"), { path: PROJECT_PATH, text: coldSource }, cold).state, "unknown");
  assert.equal(count(["- [ ] #task A ^a"], { config: { keepMoving: true, linkUnblocked: true, successorLabels: ["starts after"] } }).state, "unknown");
  // KB15: X may lack [id::]; KB20: a child embed suppresses; KB23: text/memo disagreement is unknown.
  assert.equal(count(["- [ ] #task A ^a"], { xLine: "- [*] #task Trigger ^x" }).count, 1);
  assert.equal(count(["- [ ] #task A ^a"], {
    xLine: "- [*] #task Trigger ^x\n\t- ![[other#^nested]]",
  }).state, "zero");
  const mismatchSource = note(["- [ ] #task A ^a"]);
  const mismatchTasks = tasksFor(PROJECT_PATH, mismatchSource).map((task) =>
    taskBlockId(task) === "a" ? { ...task, status: { type: "DONE", symbol: "x" } } : task);
  const mismatch = ctxFor(mismatchSource, { tasks: mismatchTasks });
  assert.equal(h.keepMovingMarkCount(mismatchTasks.find((task) => taskBlockId(task) === "x"), { path: PROJECT_PATH, text: mismatchSource }, mismatch).state, "unknown");
});

test("KB16–KB22: duplicate marks, reference rows, residency, and candidate gates", () => {
  const source = note(["- [ ] #task A ^a", "- [ ] #task B ^b"]);
  const ctx = ctxFor(source);
  const memo = ctx.memo;
  const day = "## Pomodoros\n- [ ] () — WRITE\n\t- [[job_email_recruiters#^x]]\n" +
    "- [ ] () — PLAN\n\t- [[job_email_recruiters#^x]]";
  const candidates = h.keepMovingMarkCandidateLinks(day, memo, TODAY, {
    ctx: { ...ctx, dayText: day }, dailyPath: DAY_PATH, isToday: true,
  });
  assert.equal(candidates.length, 2); // KB16: each exact occurrence gets a mark.
  assert.equal(h.keepMovingMarkLinks(day, memo, TODAY, {
    ctx: { ...ctx, dayText: day }, dailyPath: DAY_PATH, isToday: true,
  }).length, 2);
  assert.equal(h.keepMovingMarkCandidateLinks(day, memo, TODAY, {
    ctx, dailyPath: "2026/20261103.md", isToday: false,
  }).length, 0); // KB21: another day is ineligible.
  assert.equal(h.keepMovingMarkCandidateLinks("## Notes\n- [[job_email_recruiters#^x]]", memo, TODAY, {
    ctx: { ...ctx, dayText: day }, dailyPath: DAY_PATH, isToday: true,
  }).length, 0);
  for (const invalidDay of [
    "## Pomodoros\n- [ ] () — PLAN\n\t- ![[job_email_recruiters#^x]]",
    "## Pomodoros\n- [ ] () — PLAN\n\t- ~~[[job_email_recruiters#^x]]~~",
    "## Pomodoros\n- [ ] () — PLAN\n\t- details [[job_email_recruiters#^x]]",
    "## Events\n- [ ] () — PLAN\n\t- [[job_email_recruiters#^x]]",
  ]) {
    assert.equal(h.keepMovingMarkCandidateLinks(invalidDay, memo, TODAY, {
      ctx: { ...ctx, dayText: invalidDay }, dailyPath: DAY_PATH, isToday: true,
    }).length, 0);
  } // KB21: embedded, struck, prose, and Events links are not mark sites.
  let resolutions = 0;
  let counts = 0;
  const cacheDay = "## Pomodoros\n- [ ] () — PLAN\n\t- [[job_email_recruiters#^x]]\n" +
    "- [ ] () — WRITE\n\t- [[job_email_recruiters#^x]]";
  h.keepMovingMarkCandidateLinks(cacheDay, memo, TODAY, {
    ctx: { ...ctx, dayText: cacheDay }, dailyPath: DAY_PATH, isToday: true,
    onResolve: () => { resolutions += 1; }, onCount: () => { counts += 1; },
  });
  assert.equal(resolutions, 1);
  assert.equal(counts, 1); // one read/count per resolved identity.
  const refs = count(["- [ ] #ref Read this ^ref"]);
  assert.equal(refs.count, 1); // KB18: reference lane rows remain eligible.
  const nested = count(["- [ ] #task Parent ^parent", "\t- [ ] #task Nested ^nested"]);
  assert.equal(nested.count, 2); // KB18: ordinary nested resident tasks are included.
  assert.equal(count(["- [ ] #task Due today [scheduled:: " + TODAY + "] ^today",
    "- [ ] #task Repeat [repeat:: every day] ^repeat"]).count, 2); // KB18.
  const isolated = count(["- [ ] #task A ^a"], {
    paths: ["other_project.md"], notes: { "other_project.md": projectText("[[job]]") },
  });
  assert.deepEqual(isolated.rows.map((row) => row.path), [PROJECT_PATH]); // KB22.
  const stemSource = note(["- [ ] #task A ^a"], { marker: "[[child]]" });
  const stemContext = (paths) => ({
    ...ctxFor(stemSource),
    markdownPaths: () => [PROJECT_PATH, "job_2026.md", ...paths],
    frontmatterFor: (path) => path === "job_2026.md"
      ? { type: "[[project]]" }
      : { type: "[[project]]", parent: "[[job_2026]]" },
    noteTextFor: (path) => path === PROJECT_PATH ? stemSource : "parent note",
    resolveLinkpath: (target) => target === "job_2026" ? { path: "job_2026.md" } : null,
  });
  const withoutGenerated = h.keepMovingMarkLeafProject(PROJECT_PATH, stemSource, stemContext([]));
  const withGenerated = h.keepMovingMarkLeafProject(PROJECT_PATH, stemSource,
    stemContext(["_generated/tag_pages/topic/job_2026.md"]));
  assert.equal(withoutGenerated, true);
  assert.equal(withGenerated, withoutGenerated); // KB17: generated paths don't create parent ambiguity.
});

test("LP1–LP17: the root-parent rule matches the documented vectors", () => {
  const { leafFixtures } = require("./keep-moving-leaf-fixtures.cjs");
  for (const { id, path, text, ctx, expected } of leafFixtures()) {
    assert.equal(h.keepMovingMarkLeafProject(path, text, ctx), expected, id);
  }
});

test("KT1–KT8: tooltip, accessible element, config cache, and bounded counting", () => {
  const model = count(["- [ ] #task A [id:: a] ^a", "- [*] #task B ^b", "- [/] #task Pending ^pending",
    "- [ ] #task Long " + "word ".repeat(14) + "^long",
    "- [?] #task Blocked ^blocked", "- [ ] #task Later [scheduled:: 2026-11-03] ^later"]);
  const tooltip = h.keepMovingMarkTooltip({ ...model, projectStem: "job_email_recruiters",
    rows: [{ ...model.rows[0], title: "word ".repeat(14) }, ...model.rows.slice(1)] });
  assert.match(tooltip, /^Closing this offers 4 tasks to keep job_email_recruiters moving/m);
  assert.match(tooltip, /last job_email_recruiters task planned today/);
  assert.match(tooltip, /· Next/);
  assert.match(tooltip, /\+1 more/);
  assert.match(tooltip, /not offered  1 blocked · 1 scheduled later/);
  assert.doesNotMatch(tooltip, /::/);

  class Node {
    constructor(tag) { this.tag = tag; this.attributes = {}; this.children = []; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    appendChild(child) { this.children.push(child); }
  }
  const doc = { createElement: (tag) => new Node(tag), createTextNode: (text) => ({ textContent: text }) };
  const element = h.buildKeepMovingMarkElement(doc, {
    count: 2, blockId: "close", projectPath: PROJECT_PATH, projectStem: "job_email_recruiters",
    rows: [{ title: "Write docs", lane: "Ready" }],
  });
  assert.equal(element.attributes.role, "img");
  assert.equal(element.attributes["data-count"], "2");
  assert.equal(element.attributes["data-block-id"], "close");
  assert.match(element.attributes["aria-label"], /Write docs · Ready/);
  assert.equal(h.buildKeepMovingMarkElement(doc, { count: 0, blockId: "close", projectPath: PROJECT_PATH }), null);
  assert.equal(h.keepMovingMarkCandidateLinks("## Pomodoros\n- [ ] () — PLAN\n\t- [[job_email_recruiters#^x]]",
    ctxFor(note(["- [ ] #task A ^a"])).memo, TODAY, {
      ctx: ctxFor(note(["- [ ] #task A ^a"])), dailyPath: DAY_PATH, isToday: true,
      isVisible: () => false,
    }).length, 0);

  h.resetKeepMovingMarkConfigCache();
  let reads = 0;
  let mtime = 1;
  let body = JSON.stringify({ plan: { keep_moving: false, link_unblocked: true },
    relations: { successor_labels: ["Starts After", "", "Depends On"] } });
  const fsModule = {
    statSync: () => ({ mtimeMs: mtime, size: body.length }),
    readFileSync: () => { reads += 1; return body; },
  };
  const configOptions = { configPath: "/test/config.yml", fsModule, parseYaml: JSON.parse };
  assert.deepEqual(h.loadKeepMovingMarkConfig(configOptions), {
    keepMoving: false, linkUnblocked: true, successorLabels: ["Starts After", "Depends On"],
    configPath: "/test/config.yml",
  });
  h.loadKeepMovingMarkConfig(configOptions);
  assert.equal(reads, 1);
  body = JSON.stringify({ plan: { keep_moving: "false", link_unblocked: false }, relations: {} });
  mtime = 2;
  assert.equal(h.loadKeepMovingMarkConfig(configOptions).keepMoving, false);
  assert.equal(reads, 2);
  assert.equal(h.loadKeepMovingMarkConfig({ ...configOptions, Platform: { isDesktopApp: false } }).keepMoving, true);

  const residents = Array.from({ length: 1500 }, (_, index) => `- [ ] #task R${index} ^r${index}`);
  const largeSource = note(residents);
  const largeCtx = ctxFor(largeSource);
  const closing = largeCtx.memo.tasks.find((task) => taskBlockId(task) === "x");
  const started = performance.now();
  const large = h.keepMovingMarkCount(closing, { path: PROJECT_PATH, text: largeSource }, largeCtx);
  const elapsed = performance.now() - started;
  assert.equal(large.count, residents.length);
  assert.ok(elapsed < 1000, `1500 resident count took ${elapsed.toFixed(1)} ms`);
});
