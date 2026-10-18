// Blocks… stage view (`docs/task-dependencies.md` §15.3–§15.5).
// Covers RBU1–RBU5, RBP11, RBG1–RBG5, RBG8, RBW5, marks/counted/Esc,
// strip text, and stale reopen keeping the Blocks direction.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  helpers,
  NavigationHotkeysPlugin,
  planBlocksStageView,
  planBlocksStageItemsFromVault,
  decorateBlocksVaultStage,
  blocksStageConsequenceStrip,
  blocksStageSubtitle,
  dependencyStageRowKey,
  validateBulletPropertyConfig,
  BulletPropertyPickerModal,
  stubPlugin,
  stubStageModal,
  stubRowEl,
  stubReopen,
  TransactionEditor,
  sleep,
} = require("./navigation-dependencies-stage-harness.cjs");

function nContent(extra = "") {
  return `- [ ] #task Ask Kelly for references ^n${extra}`;
}

function pluginWithNotes(notes) {
  const { plugin } = stubPlugin(notes);
  const leaves = Object.entries(notes).map(([path, content]) => ({
    view: {
      file: { path, extension: "md" },
      editor: new TransactionEditor(String(content), { line: 0, ch: 0 }),
    },
  }));
  plugin.app.workspace.getLeavesOfType = (type) =>
    type === "markdown" ? leaves : [];
  return { plugin, leaves };
}

function buildStage(notes, nPath, nLine, extras = {}) {
  const { plugin } = pluginWithNotes(notes);
  const content = String(notes[nPath] || "");
  const stage = plugin.buildVaultDependencyStage({
    filePath: nPath,
    content,
    parentLines: Array.isArray(extras.parentLines) ? extras.parentLines : [nLine],
  });
  const decorated = decorateBlocksVaultStage(stage, {
    todayLinks: extras.todayLinks || [],
    dailyPath: extras.dailyPath,
  });
  const view = planBlocksStageItemsFromVault(decorated, extras.query || "");
  return { plugin, stage: decorated, view };
}

function openBlocks(notes, nPath, nLine, extra = {}) {
  const { plugin } = pluginWithNotes(notes);
  const editor = new TransactionEditor(String(notes[nPath] || ""), {
    line: nLine,
    ch: 0,
  });
  const modal = stubStageModal(plugin, editor, nPath, nLine);
  if (extra.taskSession) {
    modal.taskSession = extra.taskSession;
  }
  if (extra.inboxRoute) {
    modal.inboxRoute = extra.inboxRoute;
  }
  if (extra.reviewOrigin) {
    modal.reviewOrigin = extra.reviewOrigin;
    modal.reviewLineIndex = nLine;
    modal.reviewBeforeLine = editor.getLine(nLine);
  }
  modal.showBlocksStage();
  return { plugin, editor, modal };
}

test("showBlocksStage opens from a task with reverse CURRENT and RESULTS", () => {
  const notes = {
    "N.md": nContent(),
    "T.md": [
      "- [?] #task Do cleanup tasks ^t",
      "  - ⛓️ **DEPENDS ON:** [[N#^n]]",
    ].join("\n"),
    "Ready.md": "- [ ] #task Draft cover letter template ^ready",
  };
  const { modal } = openBlocks(notes, "N.md", 0);
  assert.equal(modal.blocksStage, true);
  assert.ok(typeof modal.showBlocksStage === "function");
  const current = modal.items.filter((row) => row.stageSection === "current");
  assert.equal(current.length, 1);
  assert.equal(current[0].displayText, "Do cleanup tasks");
  const results = modal.items.filter((row) => row.stageSection === "results");
  assert.ok(results.some((row) => row.blockId === "ready"));
  assert.ok(!results.some((row) => row.blockId === "n"));
  assert.match(modal.title, /Blocks/);
});

test("showBlocksStage opens from a counted session", () => {
  const notes = {
    "N.md": [
      "- [ ] #task First source ^n1",
      "- [ ] #task Second source ^n2",
      "- [ ] #task Draft cover letter ^ready",
    ].join("\n"),
  };
  const { modal } = openBlocks(notes, "N.md", 0, {
    taskSession: {
      explicit: true,
      valid: true,
      targets: [
        { line: 0, rawLine: "- [ ] #task First source ^n1" },
        { line: 1, rawLine: "- [ ] #task Second source ^n2" },
      ],
    },
  });
  assert.equal(modal.blocksStage, true);
  assert.equal(modal.vaultStage.sources.length, 2);
  assert.match(modal.title, /2 tasks/);
});

test("showBlocksStage opens on a Task Link target note", () => {
  const notes = {
    "job.md": "- [ ] #task Linked owner ^n",
    "Ready.md": "- [ ] #task Other task ^ready",
  };
  const { modal } = openBlocks(notes, "job.md", 0);
  assert.equal(modal.blocksStage, true);
  assert.equal(modal.filePath, "job.md");
  assert.ok(modal.items.some((row) => row.blockId === "ready"));
});

test("RBU1 empty query uses today-first then In Progress, Next, same-note, rest", () => {
  const notes = {
    "N.md": [
      nContent(),
      "- [ ] #task Same-note ready ^same",
    ].join("\n"),
    "job.md": [
      "- [/] #task Send batch applications ^running",
      "- [*] #task Next elsewhere ^next",
      "- [ ] #task Other ready ^other",
    ].join("\n"),
    "later.md": "- [ ] #task Canonical rest ^rest",
  };
  const todayKey = dependencyStageRowKey("job.md", "running");
  const { view } = buildStage(notes, "N.md", 0, {
    todayLinks: [
      {
        key: todayKey,
        path: "job.md",
        blockId: "running",
        label: "JOB",
        range: "10:10–10:35",
        running: true,
        childNotes: 0,
        order: 0,
      },
    ],
  });
  const results = view.filter((row) => row.stageSection === "results");
  const ids = results.map((row) => row.blockId);
  assert.equal(ids[0], "running", "today-linked first");
  const nextIdx = ids.indexOf("next");
  const sameIdx = ids.indexOf("same");
  const restIdx = ids.indexOf("rest");
  const otherIdx = ids.indexOf("other");
  assert.ok(nextIdx > 0, "Next after today-linked");
  assert.ok(sameIdx > nextIdx, "N's note after Next");
  assert.ok(restIdx > sameIdx || otherIdx > sameIdx, "rest after same-note");
  assert.ok(!ids.includes("n"), "RBG1 source excluded");
});

test("RBU2 today-linked rows carry 🍅 running and strip names the entry", () => {
  const notes = {
    "N.md": nContent(),
    "job.md": "- [/] #task Send batch applications ^running",
  };
  const todayLink = {
    key: dependencyStageRowKey("job.md", "running"),
    path: "job.md",
    blockId: "running",
    label: "JOB",
    range: "10:10–10:35",
    running: true,
    childNotes: 2,
    order: 0,
  };
  const { view, stage } = buildStage(notes, "N.md", 0, { todayLinks: [todayLink] });
  const row = view.find((item) => item.blockId === "running");
  assert.ok(row.todayLink);
  assert.equal(row.todayLink.running, true);
  const strip = blocksStageConsequenceStrip(row, { sources: stage.sources });
  assert.match(strip, /Becomes Blocked until this is done/);
  assert.match(strip, /this task takes In Progress/);
  assert.match(strip, /JOB 10:10–10:35 \(running\)/);
  assert.match(strip, /2 notes under it/);
});

test("RBU3 CURRENT 🔑 only when N is the last reason", () => {
  const notes = {
    "N.md": nContent(),
    "T.md": [
      "- [?] #task Do cleanup tasks [dependsOn:: N__n] ^t",
      "  - ⛓️ **DEPENDS ON:** [[N#^n]]",
      "- [?] #task Still blocked [dependsOn:: N__n, other__x] ^u",
      "  - ⛓️ **DEPENDS ON:** [[N#^n]], [[other#^x]]",
    ].join("\n"),
    "other.md": "- [ ] #task Other prereq ^x",
  };
  const { view } = buildStage(notes, "N.md", 0);
  const last = view.find((row) => row.blockId === "t");
  const still = view.find((row) => row.blockId === "u");
  assert.equal(last.stageSection, "current");
  assert.equal(last.lastReason, true);
  assert.equal(still.stageSection, "current");
  assert.equal(still.lastReason, false);
});

test("RBU4 footer verbs are block, remove, and apply N", () => {
  const notes = {
    "N.md": nContent(),
    "T.md": [
      "- [?] #task Do cleanup tasks ^t",
      "  - ⛓️ **DEPENDS ON:** [[N#^n]]",
    ].join("\n"),
    "Ready.md": "- [ ] #task Draft cover ^ready",
  };
  const { modal } = openBlocks(notes, "N.md", 0);
  modal.visibleItems = modal.items;
  modal.selectedIndex = modal.items.findIndex(
    (row) => row.stageSection === "results",
  );
  const blockHints = modal.getBlocksStageFooterHints();
  assert.equal(
    blockHints.find((hint) => hint.keys.includes("↵") || hint.keys.includes("\u21b5"))
      .label,
    "block",
  );
  modal.selectedIndex = modal.items.findIndex(
    (row) => row.stageSection === "current",
  );
  const removeHints = modal.getBlocksStageFooterHints();
  assert.equal(
    removeHints.find((hint) => hint.keys.includes("↵") || hint.keys.includes("\u21b5"))
      .label,
    "remove",
  );
  const markKey = helpers.bulletPropertyTaskMarkKey(
    modal.items.find((row) => row.stageSection === "results"),
  );
  modal.markedLines.add(markKey);
  const applyHints = modal.getBlocksStageFooterHints();
  assert.match(
    applyHints.find((hint) => hint.keys.includes("↵") || hint.keys.includes("\u21b5"))
      .label,
    /apply 1/,
  );
});

test("RBU5 subtitle at rest, with marks, and names this task first", () => {
  const notes = {
    "N.md": "- [ ] #task Ask Kelly for references",
    "Ready.md": "- [ ] #task Draft cover ^ready",
  };
  const { modal, stage } = (() => {
    const opened = openBlocks(notes, "N.md", 0);
    return { modal: opened.modal, stage: opened.modal.vaultStage };
  })();
  const rest = blocksStageSubtitle(stage, null, { needsId: false });
  assert.match(rest, /Blocks nothing yet/);
  assert.match(rest, /searching/);
  const withId = blocksStageSubtitle(stage, { add: 2, remove: 1, needId: 0 }, {
    needsId: true,
  });
  assert.equal(
    withId,
    "2 to block · 1 to remove · ↵ to apply · names this task first",
  );
  const ready = modal.items.find((row) => row.blockId === "ready");
  modal.markedLines.add(helpers.bulletPropertyTaskMarkKey(ready));
  const live = modal.getBlocksStageSubtitle(modal.items, modal.items);
  assert.match(live, /names this task first/);
});

test("RBG1 N itself is excluded from RESULTS", () => {
  const notes = {
    "N.md": [nContent(), "- [ ] #task Sibling ^sib"].join("\n"),
  };
  const { view } = buildStage(notes, "N.md", 0);
  assert.ok(!view.some((row) => row.blockId === "n"));
  assert.ok(view.some((row) => row.blockId === "sib"));
});

test("RBG2 a cycle disables the row with path tooltip copy", () => {
  const notes = {
    "N.md": [
      "- [?] #task Ask Kelly [dependsOn:: T__t] ^n",
      "  - ⛓️ **DEPENDS ON:** [[T#^t]]",
    ].join("\n"),
    "T.md": "- [ ] #task Cleanup ^t",
  };
  const { view, stage } = buildStage(notes, "N.md", 0);
  const row = view.find((item) => item.blockId === "t");
  assert.ok(row);
  assert.equal(row.disabled, true);
  assert.equal(row.disabledReason, "would create a cycle");
  const strip = blocksStageConsequenceStrip(row, { sources: stage.sources });
  assert.match(strip, /would create a cycle:/);
});

test("RBG3 ^prj T with N inside the project is inside this project", () => {
  const notes = {
    "prj.md": [
      "---",
      'type: "[[project]]"',
      "---",
      "",
      "- [ ] #task #prj Ship the project ^prj",
      "- [ ] #task Ask Kelly ^n",
    ].join("\n"),
  };
  const { view } = buildStage(notes, "prj.md", 5);
  const row = view.find((item) => item.blockId === "prj");
  assert.ok(row);
  assert.equal(row.disabled, true);
  assert.equal(row.disabledReason, "inside this project");
});

test("RBG3 descendant N disables the parent project as a sub-project", () => {
  const notes = {
    "prj.md": [
      "---",
      'type: "[[project]]"',
      "---",
      "",
      "- [ ] #task #prj Parent project ^prj",
    ].join("\n"),
    "sub.md": [
      "---",
      'parent: "[[prj]]"',
      'type: "[[project]]"',
      "---",
      "",
      "- [ ] #task #prj Child project ^prj",
      "- [ ] #task Ask Kelly ^n",
    ].join("\n"),
  };
  const { view } = buildStage(notes, "sub.md", 6);
  const row = view.find(
    (item) => item.blockId === "prj" && item.path === "prj.md",
  );
  assert.ok(row);
  assert.equal(row.disabled, true);
  assert.equal(row.disabledReason, "inside a sub-project of this project");
});

test("RBG4 a malformed or second Depends-On line is guarded", () => {
  const notes = {
    "N.md": nContent(),
    "bad.md": [
      "- [ ] #task Malformed ^bad",
      "  - ⛓️ **DEPENDS ON:** not-a-link",
    ].join("\n"),
    "two.md": [
      "- [ ] #task Two lines ^two",
      "  - ⛓️ **DEPENDS ON:** [[other#^x]]",
      "  - ⛓️ **DEPENDS ON:** [[else#^y]]",
    ].join("\n"),
  };
  const { view } = buildStage(notes, "N.md", 0);
  const malformed = view.find((row) => row.blockId === "bad");
  const second = view.find((row) => row.blockId === "two");
  assert.equal(malformed.disabled, true);
  assert.equal(malformed.disabledReason, "its Depends-On line is malformed");
  assert.equal(second.disabled, true);
  assert.equal(second.disabledReason, "its Depends-On line is malformed");
});

test("RBG5 stale refuse reopens in the Blocks direction", async () => {
  const notes = {
    "N.md": nContent(),
    "T.md": "- [ ] #task Dependent ^t",
  };
  const { plugin, modal } = openBlocks(notes, "N.md", 0);
  const reopened = stubReopen(plugin);
  modal.close = () => {};
  plugin.applyBlocksEdit = async () =>
    Object.freeze({
      ok: false,
      reason: "changed — reopen",
      notice: "changed — reopen",
    });
  const item = modal.items.find((row) => row.blockId === "t");
  const applied = await modal.chooseBlocksTask(item);
  assert.equal(applied, false);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].reopenBlocksStage, true);
  assert.equal(reopened[0].directStage, true);
});

test("RBG5 for T: a T changed after stage open refuses once and writes nothing", async () => {
  const notes = {
    "N.md": nContent(),
    "T.md": "- [ ] #task Dependent ^t",
    "U.md": "- [ ] #task Other ^u",
  };
  const { plugin, modal, editor } = openBlocks(notes, "N.md", 0);
  const reopened = stubReopen(plugin);
  modal.close = () => {};
  const leaf = plugin.app.workspace
    .getLeavesOfType("markdown")
    .find((entry) => entry.view.file.path === "T.md");
  leaf.view.editor.content = "- [ ] #task Dependent edited ^t";
  notices.length = 0;
  const item = modal.items.find((row) => row.blockId === "t");
  const applied = await modal.chooseBlocksTask(item);
  assert.equal(applied, false);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].reopenBlocksStage, true);
  // The writer returns the notice and the stage shows it: exactly once.
  assert.deepEqual(
    notices.filter((entry) => /changed/.test(entry)),
    ["changed — reopen"],
  );
  assert.equal(editor.getValue(), notes["N.md"]);
  assert.equal(leaf.view.editor.getValue(), "- [ ] #task Dependent edited ^t");
});

test("today's links survive a pool refresh that lands while the daily note loads", async () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const daily = `${now.getFullYear()}/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
  const notes = {
    "N.md": nContent(),
    "T.md": "- [ ] #task Linked today ^t",
    [daily]: ["## Pomodoros", "", "- [ ] (10:10-10:35) JOB", "  - [[T#^t]]"].join("\n"),
  };
  // The daily note is closed, so its links load asynchronously.
  const { plugin } = stubPlugin(notes);
  const leaves = ["N.md", "T.md"].map((path) => ({
    view: {
      file: { path, extension: "md" },
      editor: new TransactionEditor(notes[path], { line: 0, ch: 0 }),
    },
  }));
  plugin.app.workspace.getLeavesOfType = (type) =>
    type === "markdown" ? leaves : [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const realRead = plugin.readDependencyNoteContent.bind(plugin);
  plugin.readDependencyNoteContent = async (...args) => {
    await gate;
    return realRead(...args);
  };
  const editor = new TransactionEditor(notes["N.md"], { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "N.md", 0);
  modal.showBlocksStage();
  // The pool refresh replaces the stage while the daily read is in flight.
  const refreshed = plugin.buildVaultDependencyStage({
    filePath: "N.md",
    content: notes["N.md"],
    parentLines: [0],
  });
  refreshed.refreshOf = modal.blocksStageSeed;
  const before = modal.vaultStage;
  modal.applyVaultStageItems(refreshed);
  assert.notEqual(modal.vaultStage, before);
  release();
  await sleep(30);
  assert.equal(modal.vaultStage.todayLinks.length, 1);
  const row = modal.items.find((item) => item.blockId === "t");
  assert.ok(row && row.todayLink, "the 🍅 link is kept on the refreshed rows");
});

test("RBG8 Esc from the stage or the block-ID prompt writes nothing", () => {
  const notes = {
    "N.md": "- [ ] #task Ask Kelly for references",
    "T.md": "- [ ] #task Dependent ^t",
  };
  const { modal, editor } = openBlocks(notes, "N.md", 0);
  const before = editor.getValue();
  modal.pendingBlocks = {
    add: [],
    remove: [],
    overrides: new Map(),
    queue: [{ path: "N.md", line: 0 }],
    reservedIds: new Set(["prompted"]),
  };
  modal.modalEl = { removeClass: () => {}, addClass: () => {} };
  modal.contentEl = { empty: () => {} };
  modal.onClose();
  assert.equal(modal.pendingBlocks, null);
  assert.equal(editor.getValue(), before);
});

test("missing source ^id opens the block-ID prompt and Esc allocates none", async () => {
  const notes = {
    "N.md": "- [ ] #task Ask Kelly for references",
    "T.md": "- [ ] #task Dependent ^t",
  };
  const { modal, editor } = openBlocks(notes, "N.md", 0);
  const prompts = [];
  modal.showBlockIdStage = (snapshot, options) => {
    prompts.push({ snapshot, options });
    modal.stage = "blockid";
    modal.blockIdMode = options.mode;
    return false;
  };
  const item = modal.items.find((row) => row.blockId === "t");
  const applied = await modal.chooseBlocksTask(item);
  assert.equal(applied, false);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].options.mode, "blocks-source");
  assert.equal(editor.getValue(), notes["N.md"]);
});

test("RBP11 inbox route runs first then the Blocks write", async () => {
  const notes = {
    "inbox.md": nContent(),
    "T.md": "- [ ] #task Dependent ^t",
  };
  const { modal } = openBlocks(notes, "inbox.md", 0, {
    inboxRoute: { filePath: "inbox.md" },
  });
  const order = [];
  modal.runInboxRoutedCommit = async (action, write) => {
    order.push("route");
    return write();
  };
  modal.plugin.applyBlocksEdit = async () => {
    order.push("write");
    return { ok: true, notice: "🧱 Now blocks “Dependent” · Ready → Blocked" };
  };
  const item = modal.items.find((row) => row.blockId === "t");
  const applied = await modal.chooseBlocksTask(item);
  assert.equal(applied, true);
  assert.deepEqual(order, ["route", "write"]);
});

test("RBW5 review walk stays unless the commit takes N out of today's walk", async () => {
  const notes = {
    "N.md": nContent(),
    "T.md": "- [ ] #task Dependent ^t",
  };
  const { plugin, modal, editor } = openBlocks(notes, "N.md", 0, {
    reviewOrigin: { id: "walk" },
  });
  const walks = [];
  plugin.continueReviewWalkAfter = async (origin, outcome) => {
    walks.push({ origin, outcome });
  };
  plugin.applyBlocksEdit = async () => ({
    ok: true,
    notice: "🧱 Now blocks “Dependent”",
  });
  modal.modalEl = { removeClass: () => {}, addClass: () => {} };
  modal.contentEl = { empty: () => {} };
  const item = modal.items.find((row) => row.blockId === "t");
  await modal.chooseBlocksTask(item);
  modal.onClose();
  await sleep(5);
  assert.equal(walks.length, 1);
  assert.equal(walks[0].outcome.kind, "card");
  assert.equal(walks[0].outcome.beforeLine, editor.getLine(0));
  assert.equal(walks[0].outcome.afterLine, editor.getLine(0));
});

test("marks commit add and remove together; counted uses k/n block", () => {
  const notes = {
    "N.md": [
      "- [ ] #task First ^n1",
      "- [ ] #task Second ^n2",
      "- [?] #task Already [dependsOn:: N__n1] ^cur",
      "  - ⛓️ **DEPENDS ON:** [[#^n1]]",
      "- [ ] #task Fresh ^fresh",
    ].join("\n"),
  };
  const { modal } = openBlocks(notes, "N.md", 0, {
    taskSession: {
      explicit: true,
      valid: true,
      targets: [
        { line: 0, rawLine: "- [ ] #task First ^n1" },
        { line: 1, rawLine: "- [ ] #task Second ^n2" },
      ],
    },
  });
  const mixed = modal.items.find((row) => row.blockId === "cur");
  assert.ok(mixed);
  assert.equal(mixed.linkState, "mixed");
  assert.equal(mixed.linkedSourceCount, 1);
  assert.equal(mixed.sourceCount, 2);
  const rowEl = stubRowEl();
  modal.renderTaskValueItem(mixed, rowEl, "");
  const texts = [];
  const walk = (el) => {
    if (el.text) {
      texts.push(el.text);
    }
    for (const child of el.children || []) {
      walk(child);
    }
  };
  walk(rowEl);
  assert.ok(texts.some((text) => /1\/2 block/.test(text)));
});

test("strip text covers RESULTS, BLOCKED, CURRENT, disabled, marks, and ^prj", () => {
  const sources = [{ isProjectPrj: false }];
  assert.equal(
    blocksStageConsequenceStrip(
      { stageSection: "results", status: " ", disabled: false },
      { sources },
    ),
    "Becomes Blocked until this is done",
  );
  assert.equal(
    blocksStageConsequenceStrip(
      { stageSection: "results", status: "*", disabled: false },
      { sources },
    ),
    "Becomes Blocked until this is done · this task takes Next",
  );
  assert.equal(
    blocksStageConsequenceStrip(
      { stageSection: "blocked", waitsOn: 2, disabled: false },
      { sources },
    ),
    // Counted after the add: the row's 2 plus this task (§15.4 sample).
    "Also waits on this (3 open)",
  );
  assert.equal(
    blocksStageConsequenceStrip(
      { stageSection: "current", lastReason: true, disabled: false },
      { sources },
    ),
    "Stops waiting on this · Ready again",
  );
  assert.equal(
    blocksStageConsequenceStrip(
      { stageSection: "current", lastReason: false, disabled: false },
      { sources },
    ),
    "Stops waiting on this · still Blocked",
  );
  assert.equal(
    blocksStageConsequenceStrip(
      {
        isProjectPrj: true,
        projectWaitCount: 4,
        projectPomodoroCount: 2,
        disabled: false,
      },
      { sources },
    ),
    "Project becomes Blocked · 4 tasks wait · ⚠ removes 2 Pomodoro links",
  );
  assert.equal(
    blocksStageConsequenceStrip(
      { disabled: true, disabledReason: "inside this project" },
      { sources },
    ),
    "inside this project",
  );
  assert.equal(
    blocksStageConsequenceStrip(null, {
      sources,
      marked: [
        { stageSection: "results", status: "/", todayLink: { label: "JOB" } },
        { stageSection: "current", alreadyLinked: true },
      ],
    }),
    "↵ blocks 1 · removes 1 · this task takes In Progress · ⚠ removes 1 Pomodoro link",
  );
  // Only removals marked: no "blocks 0".
  assert.equal(
    blocksStageConsequenceStrip(null, {
      sources,
      marked: [
        { stageSection: "current", alreadyLinked: true },
        { stageSection: "current", alreadyLinked: true },
      ],
    }),
    "↵ removes 2",
  );
  // A project N is never raised, so marks never promise a lane.
  assert.equal(
    blocksStageConsequenceStrip(null, {
      sources: [{ isProjectPrj: true }],
      marked: [{ stageSection: "results", status: "/" }],
    }),
    "↵ blocks 1",
  );
  // Singular project waiters.
  assert.equal(
    blocksStageConsequenceStrip(
      { isProjectPrj: true, projectWaitCount: 1, projectPomodoroCount: 0 },
      { sources },
    ),
    "Project becomes Blocked · 1 task waits",
  );
});

test("counted subtitle drops the ⇥ hint because marks are off in counted sessions", () => {
  const stage = { current: [], freesCount: 0, poolSize: 7 };
  assert.equal(
    blocksStageSubtitle(stage, null, { counted: true }),
    "Blocks nothing yet · searching 7 open tasks",
  );
  assert.equal(
    blocksStageSubtitle(stage, null, { counted: false }),
    "Blocks nothing yet · searching 7 open tasks · ⇥ to mark several",
  );
  const { modal } = openBlocks(
    {
      "N.md": ["- [ ] #task First ^n1", "- [ ] #task Second ^n2"].join("\n"),
      "Ready.md": "- [ ] #task Draft cover ^ready",
    },
    "N.md",
    0,
    {
      taskSession: {
        explicit: true,
        valid: true,
        targets: [
          { line: 0, rawLine: "- [ ] #task First ^n1" },
          { line: 1, rawLine: "- [ ] #task Second ^n2" },
        ],
      },
    },
  );
  assert.doesNotMatch(
    modal.getBlocksStageSubtitle(modal.items, modal.items),
    /mark several/,
  );
});

test("🔑 tooltip and 🍅 tooltip render on badges", () => {
  const notes = {
    "N.md": nContent(),
    "T.md": [
      "- [?] #task Do cleanup tasks ^t",
      "  - ⛓️ **DEPENDS ON:** [[N#^n]]",
    ].join("\n"),
    "job.md": "- [/] #task Send batch ^run",
  };
  const { modal } = openBlocks(notes, "N.md", 0);
  const current = modal.items.find((row) => row.blockId === "t");
  current.lastReason = true;
  const rowEl = stubRowEl();
  modal.renderTaskValueItem(current, rowEl, "");
  const titles = [];
  const walk = (el) => {
    if (el.titles && el.titles.title) {
      titles.push(el.titles.title);
    }
    for (const child of el.children || []) {
      walk(child);
    }
  };
  walk(rowEl);
  assert.ok(
    titles.some((title) =>
      /Last thing in its way/.test(title),
    ),
  );
});
