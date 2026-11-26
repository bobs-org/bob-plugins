// Tie copy, live consequence, footer, and notice coverage for the four
// relationship stages (bob-cli plan:202611/finish_plain_link_ties.md).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Modal: class {},
      Notice: class {},
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") return { EditorView: class {} };
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const key = (pathName, blockId) => `${pathName}\0${blockId}`;
const task = (status, text, blockId) => `- [${status}] #task ${text} ^${blockId}`;
const depends = (entries) => `  - ⛓️ **DEPENDS ON:** ${entries}`;
const noteResolver = {
  linkpath: (note, from) => (!note ? from : `${note}.md`),
  vaultFiles: ["n.md", "job.md", "Project.md"],
};
const plugin = {
  dependencyLinkpathResolver: () => noteResolver.linkpath,
  readDependencyVaultFileList: () => noteResolver.vaultFiles,
};

function ref(pathName, blockId, line, rawLine, status, displayText) {
  return { path: pathName, blockId, line, rawLine, status, displayText };
}

function stageFor(owner, files, options = {}) {
  return {
    dependent: owner,
    sources: [owner],
    files: new Map(Object.entries(files)),
    edges: options.edges || new Map(),
    index: {
      byKey: options.byKey || new Map(),
      basenames: options.basenames || new Map(),
    },
    todayLinks: options.todayLinks || [],
    ...(options.extra || {}),
  };
}

function relationResult(stage, other, tieInfo = null) {
  const item = {
    kind: "local-task",
    path: other.path,
    blockId: other.blockId,
    line: other.line,
    rawLine: other.rawLine,
    displayText: other.displayText,
    status: other.status,
    stageSection: "results",
    disabled: false,
  };
  if (tieInfo) stage.tieByKey = new Map([[key(other.path, other.blockId), tieInfo]]);
  const decorated = helpers.planTieVisibilityItems([item], stage, "links", "", plugin)[0];
  return {
    item: decorated,
    text: helpers.relationStageConsequenceStrip(decorated, { direction: "to" }),
  };
}

test("cycle copy shows a reversing chord only when the reversal itself is legal", () => {
  const ownerLine = task(" ", "Owner", "o");
  const otherLine = task("?", "Other", "x");
  const content = [ownerLine, otherLine, depends("[[#^o]]")].join("\n");
  const owner = ref("n.md", "o", 0, ownerLine, " ", "Owner");
  const other = ref("n.md", "x", 1, otherLine, "?", "Other");
  const cycleStage = stageFor(owner, { "n.md": content });
  const guarded = {
    ...other,
    kind: "local-task",
    disabled: true,
    disabledReason: "would create a cycle",
    tieInfo: { waitedOnBy: true },
  };
  assert.equal(
    helpers.dependencyStageConsequenceStrip(guarded, { stage: cycleStage, plugin }),
    "⟲ It waits on this task · ⌃B reverses",
  );

  const chained = [
    ownerLine,
    otherLine,
    depends("[[#^o]] [[#^a]]"),
    task("?", "A third task", "a"),
    depends("[[#^o]]"),
  ].join("\n");
  const guardedByThirdTask = stageFor(owner, { "n.md": chained });
  assert.equal(
    helpers.dependencyStageConsequenceStrip(guarded, {
      stage: guardedByThirdTask,
      plugin,
    }),
    "would create a cycle",
  );
});

test("Depends-on consequence reads the owner status, prerequisites, and today's link", () => {
  const ownerLine = task("*", "Owner", "o");
  const otherLine = task(" ", "Candidate", "x");
  const prerequisiteLine = task(" ", "Existing prerequisite", "p");
  const content = [ownerLine, depends("[[#^p]]"), otherLine, prerequisiteLine].join("\n");
  const owner = ref("n.md", "o", 0, ownerLine, "*", "Owner");
  const other = ref("n.md", "x", 2, otherLine, " ", "Candidate");
  const stage = stageFor(owner, { "n.md": content }, {
    edges: new Map([[key("n.md", "o"), [key("n.md", "p")]]]),
    byKey: new Map([
      [key("n.md", "o"), { open: true }],
      [key("n.md", "p"), { open: true }],
      [key("n.md", "x"), { open: true }],
    ]),
    todayLinks: [{
      key: key("n.md", "o"),
      label: "JOB",
      range: "10:10–10:35",
      running: true,
    }],
  });
  const candidate = {
    ...other,
    kind: "local-task",
    status: "/", // A candidate's lane must not supply the owner's outcome.
    tieInfo: { plainOut: true, labelledOut: ["follow-up of"] },
  };
  assert.equal(
    helpers.dependencyStageConsequenceStrip(candidate, { stage, plugin }),
    'Replaces the 🪢 link · Waits on it · this task becomes Blocked · it takes Next · ⚠ removes this task\'s link from JOB 10:10–10:35 · keeps "follow-up of"',
  );

  const blockedOwner = { ...owner, status: "?" };
  const blockedStage = { ...stage, sources: [blockedOwner], dependent: blockedOwner };
  assert.equal(
    helpers.dependencyStageConsequenceStrip(candidate, { stage: blockedStage, plugin }),
    'Replaces the 🪢 link · Also waits on it (2 open) · keeps "follow-up of"',
  );
  assert.equal(
    helpers.dependencyStageConsequenceStrip({ ...candidate, closed: true }, { stage, plugin }),
    'Replaces the 🪢 link · Waits on it · already done · status unchanged · keeps "follow-up of"',
  );
});

test("relation release copy has a guarded reverse chord and ^prj fan-out", () => {
  const projectLines = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "",
    `- [?] #task #prj Ship the project [dependsOn:: job__x] ^prj`,
    depends("[[job#^x]]"),
    task("?", "Resident one", "r1"),
    task("?", "Resident two", "r2"),
  ];
  const ownerLine = projectLines[5];
  const project = projectLines.join("\n");
  const otherLine = task(" ", "Prerequisite", "x");
  const owner = ref("Project.md", "prj", 5, ownerLine, "?", "Ship the project");
  const other = ref("job.md", "x", 0, otherLine, " ", "Prerequisite");
  const stage = stageFor(owner, { "Project.md": project, "job.md": otherLine }, {
    basenames: new Map([["job", ["job.md"]], ["Project", ["Project.md"]]]),
    edges: new Map([[key("Project.md", "prj"), [key("job.md", "x")]]]),
    byKey: new Map([
      [key("Project.md", "prj"), { open: true }],
      [key("job.md", "x"), { open: true }],
    ]),
    todayLinks: [
      { key: key("Project.md", "prj"), label: "JOB" },
      { key: key("Project.md", "r1"), label: "JOB" },
    ],
    extra: { relationStage: true, direction: "to" },
  });
  const { item, text } = relationResult(stage, other);
  assert.equal(item.tieConvert, true);
  assert.match(text, /unblocks 2 residents of ‹Ship the project›/);
  assert.match(text, /⌃⇧B reverses · it becomes Blocked/);
  assert.match(text, /⚠ removes 2 Pomodoro links/);
});

test("dependency pill tooltips name the plain-link key, and kept labels survive", () => {
  const ownerLine = task(" ", "Owner", "o");
  const otherLine = task(" ", "Other", "x");
  const content = [ownerLine, otherLine].join("\n");
  const owner = ref("n.md", "o", 0, ownerLine, " ", "Owner");
  const other = ref("n.md", "x", 1, otherLine, " ", "Other");
  const stage = stageFor(owner, { "n.md": content });
  stage.tieByKey = new Map([[key("n.md", "x"), { waitedOnBy: true }]]);
  const dependsPill = helpers.planTieVisibilityItems([
    { ...other, kind: "local-task", stageSection: "results" },
  ], stage, "depends")[0].tiePills[0];
  assert.equal(dependsPill.title, "It waits on this task · ⌃⇧L makes it a plain link");

  stage.tieByKey = new Map([[key("n.md", "x"), { waitsOn: true }]]);
  const blocksPill = helpers.planTieVisibilityItems([
    { ...other, kind: "local-task", stageSection: "results" },
  ], stage, "blocks")[0].tiePills[0];
  assert.equal(blocksPill.title, "This task waits on it · ⌃L makes it a plain link");

  const labelled = [
    ownerLine,
    "  - 🪢 **LINKS:** follow-up of [[#^x]]",
    otherLine,
  ].join("\n");
  const plan = helpers.planTieChange({
    owner: { path: "n.md", blockId: "o" },
    other: { path: "n.md", blockId: "x" },
    to: "owner-waits",
    notes: new Map([["n.md", labelled]]),
    resolve: noteResolver,
  });
  assert.equal(plan.kind, "change");
  assert.equal(plan.keptRelationLabel, "follow-up of");
  assert.equal(
    helpers.buildTieChangeNotice(plan, { notice: plan.notice }),
    '⛓ Now waits on “Other” · kept the "follow-up of" relation',
  );
});

test("Depends-on footer refresh is bound to each result render after selection changes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-navigation-hotkeys", "src", "410-picker-filter-and-render.js"),
    "utf8",
  );
  assert.match(source, /renderResults\(\)\s*\{[\s\S]*?this\.getLocalTaskFooterHints\(\);\s*this\.renderFooter\(\);/);
  assert.match(source, /typeof this\.refreshDependencyConsequenceStrip === "function"/);
});
