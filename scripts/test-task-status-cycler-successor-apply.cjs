const assert = require("node:assert/strict");
const test = require("node:test");
const { helpers, TaskStatusCyclerPlugin, createInMemoryObsidianApp, createTextEditor, attachActiveMarkdownView } = require("./task-status-cycler-harness.cjs");
const navHarness = require("./navigation-hotkeys-harness.cjs");

const TODAY = "2026-11-05";

function markUnblockedLine(line, { today, isToday, isSnoozedToday }) {
  const source = String(line || "");
  if (isToday === true || isSnoozedToday === true) return source;
  const fresh = source.match(/\[fresh::\s*(\d{4}-\d{2}-\d{2})\]/);
  if (!fresh) return source;
  const scheduled = source.match(/\[scheduled::\s*(\d{4}-\d{2}-\d{2})\]/);
  if (scheduled && fresh[1] < scheduled[1] && scheduled[1] <= today) return source;
  if (source.includes(`[unblocked:: ${today}]`)) return source;
  const id = source.match(/\s+\[id::/);
  if (id) return `${source.slice(0, id.index)} [unblocked:: ${today}]${source.slice(id.index)}`;
  const block = source.match(/\s+(\^[A-Za-z0-9_-]+)\s*$/);
  if (block) return `${source.slice(0, block.index)} [unblocked:: ${today}]${source.slice(block.index)}`;
  return `${source} [unblocked:: ${today}]`;
}

function realCapabilities(plugin) {
  const cancelApi = navHarness.helpers.createCancelApi();
  return {
    successors: { version: 4, pick() {} },
    cancel: cancelApi,
    completeTaskLineText: (line, opts) => plugin.completeTaskLineText(line, opts),
    applyOfferClosesNow() {},
  };
}

function setupPlugin(initial) {
  const harness = createInMemoryObsidianApp(initial);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getFreshnessMarkUnblockedLine = () => markUnblockedLine;
  plugin.getScheduleLogDateString = () => TODAY;
  const cancelApi = navHarness.helpers.createCancelApi();
  const recall = { noted: [] };
  harness.app.plugins.plugins["bob-navigation-hotkeys"] = {
    api: {
      cancel: cancelApi,
      successors: { version: 4, pick() {} },
      logRecall: {
        version: 1,
        noteUsed(kind, text) { recall.noted.push([kind, text]); return true; },
      },
    },
  };
  return { harness, plugin, cancelApi, recall };
}

function offersFor(source, pathName = "Tasks.md") {
  const tasks = helpers.tasksFromDocuments([{ path: pathName, text: source }]);
  const notes = new Map([[pathName, source]]);
  const table = helpers.buildSuccessorNoteDigestTable(notes);
  const offersByKey = new Map();
  for (const task of tasks) {
    const key = task.blockId
      ? `${pathName}#^${task.blockId}`
      : helpers.assignSuccessorOfferKeys([task], table).get(task);
    offersByKey.set(key, {
      key, text: task.text, notePath: pathName, status: task.status,
      group: "hand_off", line: task.line, task, noteText: source,
    });
  }
  return { tasks, offersByKey, notes };
}

function expectedFor(source, offersByKey) {
  const lines = String(source).split(/\r?\n/);
  const out = new Map();
  for (const [key, offer] of offersByKey) out.set(key, lines[offer.line]);
  return out;
}

function runQueued(plugin, fn) {
  return Promise.race([
    plugin.enqueueTaskReferenceMutation(fn),
    new Promise((_, reject) => setTimeout(() => reject(new Error("nested queue deadlock")), 2000)),
  ]);
}

test("mixed Done and Cancel in one note writes both roots with exact bytes", async () => {
  const source = "- [ ] #task A ^a\n- [ ] #task B ^b\n";
  const { harness, plugin, recall } = setupPlugin({ "Tasks.md": source });
  const { offersByKey } = offersFor(source);
  const expected = expectedFor(source, offersByKey);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", source]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [
      { key: "Tasks.md#^a", outcome: "done" },
      { key: "Tasks.md#^b", outcome: "cancelled", reason: "obsolete" },
    ],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", source]]), context,
  }));
  assert.equal(res.offer_closes.length, 2);
  assert.equal(res.offer_close_refused, null);
  const done = res.offer_closes.find((row) => row.key === "Tasks.md#^a");
  const cancelled = res.offer_closes.find((row) => row.key === "Tasks.md#^b");
  assert.equal(done.outcome, "done");
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.cancel_log, "created");
  assert.equal(cancelled.reason, "obsolete");
  assert.deepEqual(recall.noted, [["cancel", "obsolete"]]);
  assert.match(cancelled.message, /obsolete/);
  assert.match(done.message, /✓ completed/);
  const final = harness.getSource("Tasks.md");
  assert.match(final, /\[x\].*\[completion:: 2026-11-05\].*\^a/);
  assert.match(final, /\[-].*\[cancelled:: 2026-11-05\].*\^b/);
  assert.equal(res.resolved.find((entry) => entry.key === "Tasks.md#^a").afterLine, final.split("\n")[0]);
  assert.equal(res.resolved.find((entry) => entry.key === "Tasks.md#^b").afterLine, final.split("\n")[1]);
  assert.match(final, /CANCEL LOG/);
  assert.equal(res.undo.restores.length, 1);
  assert.equal(res.undo.restores[0].before, source);
  assert.equal(res.undo.restores[0].after, final);
});

test("all four Cancel Log cases match Task Card bytes and root fields stay untouched", async () => {
  const cases = [
    {
      name: "authored with log",
      source: "- [*] #task Add retry wrapper ^cancel-reason\n  - ❌ **CANCEL LOG**\n    - *2026-10-01* — earlier reason\n",
      close: { key: "Tasks.md#^cancel-reason", outcome: "cancelled", reason: "Duplicate implementation" },
      log: "written",
    },
    {
      name: "blank no log",
      source: "- [ ] #task Retire old hook ^blank-no-log\n",
      close: { key: "Tasks.md#^blank-no-log", outcome: "cancelled", reason: "" },
      log: "none",
    },
    {
      name: "blank existing log",
      source: "- [ ] #task Retire old hook ^blank-existing-log\n  - ❌ **CANCEL LOG**\n    - *2026-10-01* — earlier reason\n",
      close: { key: "Tasks.md#^blank-existing-log", outcome: "cancelled", reason: "  \n " },
      log: "fallback",
    },
  ];
  for (const item of cases) {
    const { harness, plugin, recall } = setupPlugin({ "Tasks.md": item.source });
    const { offersByKey } = offersFor(item.source);
    const expected = expectedFor(item.source, offersByKey);
    const context = {
      today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
      dependencySnapshotAvailable: true, markUnblockedLine,
      noteTexts: new Map([["Tasks.md", item.source]]),
    };
    const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
      closes: [item.close], offers: [...offersByKey.values()], offersByKey,
      expectedLines: expected, noteTexts: new Map([["Tasks.md", item.source]]), context,
    }));
    assert.equal(res.offer_closes.length, 1, item.name);
    assert.equal(res.offer_closes[0].cancel_log, item.log, item.name);
    const final = harness.getSource("Tasks.md");
    assert.match(final, /\[cancelled:: 2026-11-05\]/, item.name);
    assert.doesNotMatch(final, /\[fresh::/, item.name);
    assert.doesNotMatch(final, /\[keeps::/, item.name);
    if (item.log === "none") assert.doesNotMatch(final, /CANCEL LOG/, item.name);
    if (item.log === "fallback") assert.match(final, /🤷 no reason given/, item.name);
    if (item.name === "authored with log") assert.match(final, /Duplicate implementation/, item.name);
    assert.deepEqual(recall.noted, item.name === "authored with log" ? [["cancel", "Duplicate implementation"]] : [], item.name);
  }
  const parentSource = "- [ ] #task Parent ^parent\n  - [ ] #task Child ^child\n";
  const { harness, plugin } = setupPlugin({ "Tasks.md": parentSource });
  const { offersByKey } = offersFor(parentSource);
  const expected = expectedFor(parentSource, offersByKey);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", parentSource]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^parent", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", parentSource]]), context,
  }));
  const final = harness.getSource("Tasks.md");
  assert.match(final.split("\n")[0], /\[x\]/);
  assert.match(final.split("\n")[1], /\[ \] #task Child/);
  assert.doesNotMatch(final, /\^[A-Za-z0-9_-]+.*\^[A-Za-z0-9_-]+/);
});

test("stale, deleted, live-link, and duplicate rows refuse alone while neighbours apply", async () => {
  const source = "- [ ] #task A ^a\n- [ ] #task B ^b\n";
  const { harness, plugin } = setupPlugin({ "Tasks.md": source });
  const { offersByKey } = offersFor(source);
  const expected = new Map([
    ["Tasks.md#^a", "- [ ] #task A changed ^a"],
    ["Tasks.md#^b", "- [ ] #task B ^b"],
  ]);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", source]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^a", outcome: "done" }, { key: "Tasks.md#^b", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", source]]), context,
  }));
  assert.equal(res.offer_closes.length, 1);
  assert.equal(res.offer_closes[0].key, "Tasks.md#^b");
  assert.equal(res.offer_close_refused.count, 1);
  assert.match(res.offer_close_refused.rows[0].why, /[Cc]hanged since/);
  assert.equal(res.resolved.length, 1);

  const dupSource = "- [ ] #task Same\n- [ ] #task Same\n";
  const dup = setupPlugin({ "Tasks.md": dupSource });
  const dupOffers = offersFor(dupSource);
  const table = helpers.buildSuccessorNoteDigestTable(new Map([["Tasks.md", dupSource]]));
  const tasks = helpers.tasksFromDocuments([{ path: "Tasks.md", text: dupSource }]);
  const keys = helpers.assignSuccessorOfferKeys(tasks, table);
  const secondKey = [...keys.values()][1];
  const reboundOffer = {
    key: secondKey, text: tasks[0].text, notePath: "Tasks.md", status: " ",
    group: "hand_off", line: 0, task: tasks[0], noteText: dupSource,
  };
  const reboundByKey = new Map([[secondKey, reboundOffer]]);
  const reboundExpected = new Map([[secondKey, dupSource.split("\n")[0]]]);
  const reboundContext = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", dupSource]]),
  };
  const rebound = await runQueued(dup.plugin, () => dup.plugin.applyOfferClosesNow({
    closes: [{ key: secondKey, outcome: "done" }], offers: [reboundOffer],
    offersByKey: reboundByKey, expectedLines: reboundExpected,
    noteTexts: new Map([["Tasks.md", dupSource]]), context: reboundContext,
  }));
  assert.equal(rebound.offer_closes.length, 0);
  assert.equal(rebound.offer_close_refused.count, 1);

  const liveSource = "- [ ] #task Live ^live\n- [ ] #task Other ^other\n";
  const live = setupPlugin({ "Tasks.md": liveSource });
  const liveOffers = offersFor(liveSource);
  const liveExpected = expectedFor(liveSource, liveOffers.offersByKey);
  const liveContext = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", liveSource]]),
    hasLiveLink: (task) => task && task.blockId === "live",
  };
  const liveRes = await runQueued(live.plugin, () => live.plugin.applyOfferClosesNow({
    closes: [
      { key: "Tasks.md#^live", outcome: "done" },
      { key: "Tasks.md#^other", outcome: "done" },
    ],
    offers: [...liveOffers.offersByKey.values()], offersByKey: liveOffers.offersByKey,
    expectedLines: liveExpected, noteTexts: new Map([["Tasks.md", liveSource]]),
    context: liveContext,
  }));
  assert.equal(liveRes.offer_closes.length, 1);
  assert.equal(liveRes.offer_closes[0].key, "Tasks.md#^other");
  assert.equal(liveRes.offer_close_refused.count, 1);

  const idlessSource = "- [ ] #task Idless task\n";
  const idless = setupPlugin({ "Tasks.md": idlessSource });
  const idlessNotes = new Map([["Tasks.md", idlessSource]]);
  const idlessTasks = helpers.tasksFromDocuments([{ path: "Tasks.md", text: idlessSource }]);
  const idlessTable = helpers.buildSuccessorNoteDigestTable(idlessNotes);
  const idlessKey = helpers.assignSuccessorOfferKeys(idlessTasks, idlessTable).get(idlessTasks[0]);
  const idlessOffer = {
    key: idlessKey, text: "Idless task", notePath: "Tasks.md", status: " ",
    group: "hand_off", line: 0, task: idlessTasks[0], noteText: idlessSource,
  };
  const idlessByKey = new Map([[idlessKey, idlessOffer]]);
  const idlessExpected = new Map([[idlessKey, idlessSource.split("\n")[0]]]);
  const idlessContext = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: idlessNotes,
  };
  const idlessRes = await runQueued(idless.plugin, () => idless.plugin.applyOfferClosesNow({
    closes: [{ key: idlessKey, outcome: "done" }], offers: [idlessOffer],
    offersByKey: idlessByKey, expectedLines: idlessExpected,
    noteTexts: idlessNotes, context: idlessContext,
  }));
  assert.equal(idlessRes.offer_closes.length, 1);
  assert.doesNotMatch(idless.harness.getSource("Tasks.md").split("\n")[0], /\^[A-Za-z0-9_-]+\s*$/);
});

test("joint and project recoveries report once with WRITE skips and no second offer round", async () => {
  const jointSource = "- [ ] #task Root one [id:: one] ^one\n- [ ] #task Root two [id:: two] ^two\n- [?] #task Joint waiting [fresh:: 2026-11-01] [dependsOn:: one, two] [id:: joint] ^joint\n";
  const { harness, plugin } = setupPlugin({ "Tasks.md": jointSource });
  const { offersByKey } = offersFor(jointSource);
  const expected = expectedFor(jointSource, offersByKey);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", jointSource]]),
  };
  const joint = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [
      { key: "Tasks.md#^one", outcome: "done" },
      { key: "Tasks.md#^two", outcome: "done" },
    ],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", jointSource]]), context,
  }));
  assert.equal(joint.offer_closes.length, 2);
  const totalRecovered = joint.offer_closes.reduce((sum, row) => sum + row.recovered.length, 0);
  assert.equal(totalRecovered, 1);
  assert.match(joint.offer_closes[0].message, /unblocked/);
  assert.doesNotMatch(joint.offer_closes[1].message, /unblocked/);
  assert.match(harness.getSource("Tasks.md"), /\[unblocked:: 2026-11-05\]/);

  const unstampedSource = "- [ ] #task Root [id:: root] ^root\n- [?] #task New waiting [dependsOn:: root] [id:: waiting] ^waiting\n";
  const unstamped = setupPlugin({ "Tasks.md": unstampedSource });
  const unstampedOffers = offersFor(unstampedSource);
  const unstampedExpected = expectedFor(unstampedSource, unstampedOffers.offersByKey);
  const unstampedContext = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", unstampedSource]]),
  };
  const fresh = await runQueued(unstamped.plugin, () => unstamped.plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^root", outcome: "done" }],
    offers: [...unstampedOffers.offersByKey.values()], offersByKey: unstampedOffers.offersByKey,
    expectedLines: unstampedExpected, noteTexts: new Map([["Tasks.md", unstampedSource]]),
    context: unstampedContext,
  }));
  assert.equal(fresh.offer_closes[0].recovered.length, 1);
  assert.equal(fresh.offer_closes[0].recovered[0].unblocked_stamped, false);
  assert.doesNotMatch(unstamped.harness.getSource("Tasks.md"), /\[unblocked::/);

  const projectSource = "- [ ] #task #prj Ship Alpha ^prj\n- [ ] #task Project resident ^resident\n";
  const project = setupPlugin({ "Projects/Alpha.md": projectSource });
  const projectTasks = helpers.tasksFromDocuments([{ path: "Projects/Alpha.md", text: projectSource }]);
  const projectByKey = new Map();
  for (const task of projectTasks) {
    const key = `Projects/Alpha.md#^${task.blockId}`;
    projectByKey.set(key, {
      key, text: task.text, notePath: "Projects/Alpha.md", status: task.status,
      group: "project_finished", line: task.line, task, noteText: projectSource,
    });
  }
  const projectExpected = new Map();
  for (const [key, offer] of projectByKey) projectExpected.set(key, projectSource.split("\n")[offer.line]);
  const projectContext = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Projects/Alpha.md", projectSource]]),
  };
  const finished = await runQueued(project.plugin, () => project.plugin.applyOfferClosesNow({
    closes: [{ key: "Projects/Alpha.md#^prj", outcome: "done" }],
    offers: [...projectByKey.values()], offersByKey: projectByKey,
    expectedLines: projectExpected, noteTexts: new Map([["Projects/Alpha.md", projectSource]]),
    context: projectContext,
  }));
  assert.equal(finished.offer_closes.length, 1);
  assert.match(finished.offer_closes[0].message, /✓ completed/);
  assert.match(project.harness.getSource("Projects/Alpha.md").split("\n")[0], /\[x\]/);
  assert.equal(finished.recovery.plan.offers.length, 0);
});

test("editor and vault paths write guarded whole-note splices and failed writes stay visible", async () => {
  const { createTextEditor, attachActiveMarkdownView } = require("./task-status-cycler-harness.cjs");
  const source = "- [ ] #task Root ^root\n";
  const { harness, plugin } = setupPlugin({ "Tasks.md": source });
  const editor = createTextEditor(source, { line: 0, ch: 0 });
  attachActiveMarkdownView(plugin, harness, editor, "Tasks.md");
  const { offersByKey } = offersFor(source);
  const expected = expectedFor(source, offersByKey);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", source]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^root", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", source]]), context,
  }));
  assert.equal(res.offer_closes.length, 1);
  assert.match(editor.getValue(), /\[x\]/);

  const missingSource = "- [ ] #task Gone ^gone\n";
  const missing = setupPlugin({ "Tasks.md": missingSource });
  const missingOffers = offersFor(missingSource);
  const missingExpected = expectedFor(missingSource, missingOffers.offersByKey);
  const missingContext = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", missingSource]]),
  };
  missing.harness.app.vault.process = async () => { throw new Error("disk full"); };
  const failed = await runQueued(missing.plugin, () => missing.plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^gone", outcome: "done" }],
    offers: [...missingOffers.offersByKey.values()], offersByKey: missingOffers.offersByKey,
    expectedLines: missingExpected, noteTexts: new Map([["Tasks.md", missingSource]]),
    context: missingContext,
  }));
  assert.equal(failed.offer_closes.length, 0);
  assert.equal(failed.offer_close_refused.count, 1);
  assert.ok(failed.failures && failed.failures.length > 0);
});

test("guarded Undo restores exact roots plus recovery and refuses after a later change", async () => {
  const source = "- [ ] #task Root [id:: root] ^root\n- [?] #task Waiting [fresh:: 2026-11-01] [dependsOn:: root] [id:: waiting] ^waiting\n";
  const { harness, plugin } = setupPlugin({ "Tasks.md": source });
  const { offersByKey } = offersFor(source);
  const expected = expectedFor(source, offersByKey);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", source]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^root", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", source]]), context,
  }));
  assert.equal(res.undo.restores.length, 1);
  const restore = res.undo.restores[0];
  assert.equal(restore.before, source);
  assert.equal(restore.after, harness.getSource("Tasks.md"));
  const navPlugin = new navHarness.NavigationHotkeysPlugin();
  navPlugin.app = harness.app;
  const ok = await navPlugin.restoreGuardedSnapshots(res.undo.restores, {
    successMessage: "Closes undone", failureLabel: "Could not undo closes",
  });
  assert.equal(ok, true);
  assert.equal(harness.getSource("Tasks.md"), source);
  const res2 = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^root", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", source]]), context,
  }));
  await harness.app.vault.modify(harness.app.vault.getAbstractFileByPath("Tasks.md"), `${harness.getSource("Tasks.md")}\n- edited\n`);
  const refused = await navPlugin.restoreGuardedSnapshots(res2.undo.restores, {
    successMessage: "Closes undone", failureLabel: "Could not undo closes",
  });
  assert.equal(refused, false);
  assert.match(harness.getSource("Tasks.md"), /edited/);
});

test("Undo preimages retain unrelated edits arriving after the card snapshot on vault and editor paths", async () => {
  const offered = "- [x] #task Earlier predecessor [id:: predecessor] ^predecessor\n- [*] #task Earlier pull-in [fresh:: 2026-11-05] [id:: picked] ^picked\n- [ ] #task Root [id:: root] ^root\n- [?] #task Waiting [fresh:: 2026-11-01] [dependsOn:: root] [id:: waiting] ^waiting\nOld unrelated prose\n";
  const live = offered.replace("Old unrelated prose", "User edited unrelated prose");
  for (const pathMode of ["vault", "editor"]) {
    const { harness, plugin } = setupPlugin({ "Tasks.md": live });
    let editor = null;
    if (pathMode === "editor") {
      editor = createTextEditor(live, { line: 0, ch: 0 });
      attachActiveMarkdownView(plugin, harness, editor, "Tasks.md");
      const file = harness.app.vault.getAbstractFileByPath("Tasks.md");
      harness.app.workspace.getActiveViewOfType = () => ({ editor, file });
    }
    const { offersByKey } = offersFor(offered);
    const expected = expectedFor(offered, offersByKey);
    const context = {
      today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
      dependencySnapshotAvailable: true, markUnblockedLine,
      noteTexts: new Map([["Tasks.md", offered]]),
    };
    const result = await runQueued(plugin, () => plugin.applyOfferClosesNow({
      closes: [{ key: "Tasks.md#^root", outcome: "done" }],
      offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
      noteTexts: new Map([["Tasks.md", offered]]), context,
    }));
    assert.equal(result.offer_closes.length, 1, pathMode);
    assert.equal(result.undo.restores.length, 1, pathMode);
    const restore = result.undo.restores[0];
    assert.equal(restore.before, live, `${pathMode} uses the accepted write preimage`);
    const postimage = pathMode === "editor" ? editor.getValue() : harness.getSource("Tasks.md");
    assert.match(postimage, /User edited unrelated prose/);
    assert.match(postimage, /Earlier predecessor/);
    assert.match(postimage, /Earlier pull-in/);

    const navPlugin = new navHarness.NavigationHotkeysPlugin();
    navPlugin.app = harness.app;
    if (pathMode === "editor") {
      navPlugin.getOpenMarkdownEditorForPath = (path) => path === "Tasks.md" ? editor : null;
    }
    assert.equal(restore.after, postimage, `${pathMode} undo postimage matches the writer`);
    const undone = await navPlugin.restoreGuardedSnapshots(result.undo.restores, {
      successMessage: "Closes undone", failureLabel: "Could not undo closes",
    });
    assert.equal(undone, true, pathMode);
    const restored = pathMode === "editor" ? editor.getValue() : harness.getSource("Tasks.md");
    assert.equal(restored, live, `${pathMode} undo preserves the concurrent edit and earlier effects`);
  }
});

test("Undo checks every file before restoring any of them", async () => {
  const root = "- [ ] #task Root [id:: root] ^root\n";
  const dependent = "- [?] #task Waiting [fresh:: 2026-11-01] [dependsOn:: root] [id:: waiting] ^waiting\n";
  const { harness, plugin } = setupPlugin({ "Root.md": root, "Deps.md": dependent });
  const { offersByKey } = offersFor(root, "Root.md");
  const expected = expectedFor(root, offersByKey);
  const noteTexts = new Map([["Root.md", root], ["Deps.md", dependent]]);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine, noteTexts,
  };
  const result = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Root.md#^root", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts, context,
  }));
  assert.deepEqual(result.undo.restores.map((entry) => entry.path).sort(), ["Deps.md", "Root.md"]);
  await harness.app.vault.modify(
    harness.app.vault.getAbstractFileByPath("Deps.md"),
    `${harness.getSource("Deps.md")}\n- later edit\n`,
  );
  const navPlugin = new navHarness.NavigationHotkeysPlugin();
  navPlugin.app = harness.app;
  const undone = await navPlugin.restoreGuardedSnapshots(result.undo.restores, {
    successMessage: "Closes undone", failureLabel: "Could not undo closes",
  });
  assert.equal(undone, false);
  assert.match(harness.getSource("Root.md"), /^- \[x\]/, "the earlier file was not partially undone");
  assert.match(harness.getSource("Deps.md"), /\[unblocked:: 2026-11-05\]/);
  assert.match(harness.getSource("Deps.md"), /later edit/);
});

test("successor offer-close recovery skips [unblocked::] for a snoozed dependent", async () => {
  const root = "- [ ] #task Root [id:: root] ^root\n";
  const dependent = "- [?] #task Waiting [fresh:: 2026-11-01] [dependsOn:: root] [id:: waiting] ^waiting\n";
  const { harness, plugin } = setupPlugin({ "Root.md": root, "Deps.md": dependent });
  const snoozedCalls = [];
  harness.app.plugins.plugins["bob-ledger-tools"].api.isSnoozedToday = (task) => {
    snoozedCalls.push(task);
    return task && task.path === "Deps.md" && task.blockId === "waiting";
  };
  const markScopes = [];
  const markWithScopes = (line, options = {}) => {
    markScopes.push(options);
    return markUnblockedLine(line, options);
  };
  const { offersByKey } = offersFor(root, "Root.md");
  const expectedLines = expectedFor(root, offersByKey);
  const noteTexts = new Map([["Root.md", root], ["Deps.md", dependent]]);
  const context = {
    today: TODAY,
    dailyBefore: [],
    dailyAfter: [],
    dailyPath: "",
    dependencySnapshotAvailable: true,
    markUnblockedLine: markWithScopes,
    isSnoozedToday: (task) => harness.app.plugins.plugins["bob-ledger-tools"].api.isSnoozedToday(task),
    noteTexts,
  };
  const result = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Root.md#^root", outcome: "done" }],
    offers: [...offersByKey.values()],
    offersByKey,
    expectedLines,
    noteTexts,
    context,
  }));
  assert.equal(result.offer_closes.length, 1);
  assert.ok(snoozedCalls.some((task) => task.path === "Deps.md" && task.blockId === "waiting"), JSON.stringify(snoozedCalls));
  assert.ok(markScopes.some((scope) => scope.isSnoozedToday === true), JSON.stringify(markScopes));
  assert.match(harness.getSource("Deps.md"), /^- \[ \] #task Waiting \[fresh:: 2026-11-01\]/m);
  assert.doesNotMatch(harness.getSource("Deps.md"), /\[unblocked::/);
});

test("a failed dependent write reaches the rich notice with only successful writes in Undo", async () => {
  const root = "- [ ] #task Root [id:: root] ^root\n";
  const dependent = "- [?] #task Waiting [fresh:: 2026-11-01] [dependsOn:: root] [id:: waiting] ^waiting\n";
  const { harness, plugin } = setupPlugin({ "Root.md": root, "Deps.md": dependent });
  const process = harness.app.vault.process.bind(harness.app.vault);
  harness.app.vault.process = async (file, update) => {
    if (file.path === "Deps.md") throw new Error("disk full");
    return process(file, update);
  };
  const { offersByKey } = offersFor(root, "Root.md");
  const expected = expectedFor(root, offersByKey);
  const noteTexts = new Map([["Root.md", root], ["Deps.md", dependent]]);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine, noteTexts,
  };
  const result = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Root.md#^root", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts, context,
  }));
  assert.match(harness.getSource("Root.md"), /^- \[x\]/, "the successful root remains closed");
  assert.doesNotMatch(harness.getSource("Deps.md"), /\[unblocked:: 2026-11-05\]/);
  assert.equal(result.offer_closes.length, 1);
  assert.deepEqual(result.offer_closes[0].recovered, [], "the failed dependent is not reported recovered");
  assert.deepEqual(result.undo.restores.map((entry) => entry.path), ["Root.md"]);
  assert.ok(result.failures.some((failure) => failure.kind === "recovery" && failure.path === "Deps.md"));

  const navPlugin = new navHarness.NavigationHotkeysPlugin();
  navPlugin.app = harness.app;
  const view = navHarness.helpers.buildUnblockedNoticeModel({ ...result, __noticePlugin: navPlugin });
  assert.match(view.text, /Recovery failed/);
  assert.match(view.text, /Deps\.md/);
  assert.match(view.text, /disk full/);
  assert.deepEqual(view.offerCloseUndo.map((entry) => entry.path), ["Root.md"]);
  const rootNode = navHarness.createFragmentNode();
  navHarness.helpers.renderUnblockedNoticeFragment(view, rootNode, {});
  assert.ok(navHarness.findFragmentNode(rootNode, (node) => node.text.includes("Recovery failed")));
  assert.ok(navHarness.findFragmentNode(rootNode, (node) => node.text === "Undo closes"));
  const undone = await navPlugin.restoreGuardedSnapshots(view.offerCloseUndo, {
    successMessage: "Closes undone", failureLabel: "Could not undo closes",
  });
  assert.equal(undone, true);
  assert.equal(harness.getSource("Root.md"), root, "Undo touches only the successful root write");
  assert.equal(harness.getSource("Deps.md"), dependent, "the failed recovery path remains untouched");
});

// --- T11 host safety: `((` naming a sibling while the inline cancel reason is open ---
// (phase bob-cli-oz.4). The successor picker's inline cancel reason (S6) is a
// prose prompt; its `((` can name an ID-less sibling in the cancelled row's
// note through the real block-id-prompt `api.taskLinks` session while the
// picker's own verdicts wait to be applied.
const { createSiblingNamer } = require("./prompt-sibling-naming-helpers.cjs");

test("T11 successor cancel: naming a sibling during the inline reason never refuses the cancel", async () => {
  const source = "- [ ] #task A ^a\n- [ ] #task B ^b\n- [ ] #task Sibling idea\n";
  const { harness, plugin, recall } = setupPlugin({ "Tasks.md": source });
  const { offersByKey } = offersFor(source);
  const expected = expectedFor(source, offersByKey);
  const rowB = {
    key: "Tasks.md#^b",
    notePath: "Tasks.md",
    task: { path: "Tasks.md", line: 2, text: "- [ ] #task B ^b", preimage: "- [ ] #task B ^b" },
  };
  const subjects = navHarness.helpers.successorReasonSubjects(rowB);
  assert.deepEqual(subjects, [{ path: "Tasks.md", line: 1, blockId: "b" }], "the cancelled row is the reason's subject");
  const store = { "Tasks.md": source };
  const namer = createSiblingNamer({ files: store, sourcePath: "Tasks.md", subjects });
  await namer.assertSubjectGuarded("B");
  await namer.nameSibling("Sibling idea", "sibling-idea");
  await harness.app.vault.modify(harness.app.vault.getAbstractFileByPath("Tasks.md"), store["Tasks.md"]);
  const live = harness.getSource("Tasks.md");
  assert.match(live, /Sibling idea \^sibling-idea/, "the sibling was named in the live note");
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", live]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^b", outcome: "cancelled", reason: "superseded" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", live]]), context,
  }));
  assert.equal(res.offer_close_refused, null, "the cancel was never refused as stale");
  assert.equal(res.offer_closes.length, 1);
  assert.equal(res.offer_closes[0].outcome, "cancelled");
  assert.deepEqual(recall.noted, [["cancel", "superseded"]]);
  const final = harness.getSource("Tasks.md").split("\n");
  assert.match(final[1], /\[-\].*\[cancelled:: 2026-11-05\].*\^b/, "the cancel landed on the cancelled row's own line");
  assert.ok(final.includes("- [ ] #task Sibling idea ^sibling-idea"), "the named sibling kept its ID");
  namer.close();
});

test("T11 ID-less picker rows are subject-guarded; naming a non-picker ID-less row keeps cancels applicable", async () => {
  const source = "- [ ] #task A ^a\n- [ ] #task B ^b\n- [ ] #task Picker sibling\n- [ ] #task Other sibling\n";
  const { harness, plugin, recall } = setupPlugin({ "Tasks.md": source });
  const { offersByKey } = offersFor(source);
  const expected = expectedFor(source, offersByKey);
  const cancelledRow = {
    key: "Tasks.md#^a",
    notePath: "Tasks.md",
    task: { path: "Tasks.md", line: 1, text: "- [ ] #task A ^a", preimage: "- [ ] #task A ^a" },
  };
  const identifiedRow = {
    key: "Tasks.md#^b",
    notePath: "Tasks.md",
    task: { path: "Tasks.md", line: 2, text: "- [ ] #task B ^b", preimage: "- [ ] #task B ^b" },
  };
  const pickerIdlessRow = {
    key: "picker-idless",
    notePath: "Tasks.md",
    task: { path: "Tasks.md", line: 3, text: "- [ ] #task Picker sibling", preimage: "- [ ] #task Picker sibling" },
  };
  const modal = { model: { groups: [{ rows: [cancelledRow, identifiedRow, pickerIdlessRow] }] } };
  const subjects = navHarness.helpers.successorReasonSubjects(cancelledRow, modal);
  assert.deepEqual(subjects, [
    { path: "Tasks.md", line: 0, blockId: "a" },
    { path: "Tasks.md", line: 2 },
  ], "cancelled plus ID-less picker row, identified sibling stays linkable");
  const store = { "Tasks.md": source };
  const namer = createSiblingNamer({ files: store, sourcePath: "Tasks.md", subjects });
  await namer.assertSubjectGuarded("Picker sibling");
  const other = namer.rowFor("Other sibling");
  assert.equal(other.disabled, null, "a non-picker ID-less task stays nameable");
  await namer.nameSibling("Other sibling", "other-sibling");
  await harness.app.vault.modify(harness.app.vault.getAbstractFileByPath("Tasks.md"), store["Tasks.md"]);
  const live = harness.getSource("Tasks.md");
  assert.match(live, /Other sibling \^other-sibling/);
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", live]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [
      { key: "Tasks.md#^a", outcome: "cancelled", reason: "superseded" },
      { key: "Tasks.md#^b", outcome: "done" },
    ],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", live]]), context,
  }));
  assert.equal(res.offer_close_refused, null, "cancel plus staged verdict apply without changed_identity");
  assert.equal(res.offer_closes.length, 2);
  namer.close();
});

test("SV26 recovery drift matrix accepts only Bob's ordinary recovery", () => {
  const drift = helpers.successorOfferCloseRecoveryDrift;
  assert.equal(typeof drift, "function");
  const base = "- [?] #task Keep [fresh:: 2026-11-01] [dependsOn:: root] [id:: keep] ^keep";
  const flipped = "- [ ] #task Keep [fresh:: 2026-11-01] [dependsOn:: root] [id:: keep] ^keep";
  const stamped = "- [ ] #task Keep [fresh:: 2026-11-01] [unblocked:: 2026-11-05] [dependsOn:: root] [id:: keep] ^keep";
  const restampedFrom = "- [ ] #task Keep [fresh:: 2026-11-01] [unblocked:: 2026-11-04] [dependsOn:: root] [id:: keep] ^keep";
  const restampedTo = "- [ ] #task Keep [fresh:: 2026-11-01] [unblocked:: 2026-11-05] [dependsOn:: root] [id:: keep] ^keep";
  const taggedFrom = "- [?] #task Resident #prj_is_blocked [dependsOn:: root] [id:: resident] ^resident";
  const taggedTo = "- [ ] #task Resident [dependsOn:: root] [id:: resident] ^resident";
  const combinedFrom = `- [?] #task Keep #prj_is_blocked [fresh:: 2026-11-01] [dependsOn:: root] [id:: keep] ^keep`;
  const combinedTo = `- [ ] #task Keep [fresh:: 2026-11-01] [unblocked:: 2026-11-05] [dependsOn:: root] [id:: keep] ^keep`;
  assert.equal(drift(base, base), false, "identical lines are not drift");
  assert.equal(drift(base, flipped), true, "status flip alone applies");
  assert.equal(drift(base, stamped), true, "flip plus stamp applies");
  assert.equal(drift(flipped, stamped), true, "stamp alone on the same open status applies");
  assert.equal(drift(restampedFrom, restampedTo), true, "a restamped date still applies");
  assert.equal(drift(taggedFrom, taggedTo), true, "tag removal plus flip applies");
  assert.equal(drift(combinedFrom, combinedTo), true, "flip plus stamp plus tag removal applies");
  assert.equal(drift(flipped, flipped), false, "identical open lines are not drift");
  assert.equal(drift(base, "- [*] #task Keep [fresh:: 2026-11-01] [dependsOn:: root] [id:: keep] ^keep"), false, "? to * refuses");
  assert.equal(drift(base, "- [/] #task Keep [fresh:: 2026-11-01] [dependsOn:: root] [id:: keep] ^keep"), false, "? to / refuses");
  assert.equal(drift(flipped, base), false, "Ready back to Blocked refuses");
  assert.equal(drift(flipped, "- [x] #task Keep [fresh:: 2026-11-01] [dependsOn:: root] [id:: keep] ^keep"), false, "closing refuses");
  assert.equal(drift(flipped, "- [-] #task Keep [fresh:: 2026-11-01] [dependsOn:: root] [id:: keep] ^keep"), false, "cancelling refuses");
  assert.equal(drift(base, `${stamped} edited`), false, "drift plus a text edit refuses");
  assert.equal(drift(base, "not a task line"), false, "non-task lines refuse");
  assert.equal(drift("not a task line", stamped), false, "non-task preimages refuse");
});

test("SV26 drift that lands only on the live re-read still applies", async () => {
  const blocked = "- [?] #task Keep [fresh:: 2026-11-05] [dependsOn:: root] [id:: keep] ^keep";
  const source = `- [ ] #task Root [id:: root] ^root\n${blocked}\n`;
  const drifted = `- [ ] #task Root [id:: root] ^root\n- [ ] #task Keep [fresh:: 2026-11-05] [unblocked:: 2026-11-05] [dependsOn:: root] [id:: keep] ^keep\n`;
  const { harness, plugin } = setupPlugin({ "Tasks.md": source });
  const { offersByKey } = offersFor(source);
  const expected = expectedFor(source, offersByKey);
  await harness.app.vault.modify(harness.app.vault.getAbstractFileByPath("Tasks.md"), drifted);
  plugin.readSuccessorNoteText = async () => drifted;
  const context = {
    today: TODAY, dailyBefore: [], dailyAfter: [], dailyPath: "",
    dependencySnapshotAvailable: true, markUnblockedLine,
    noteTexts: new Map([["Tasks.md", source]]),
  };
  const res = await runQueued(plugin, () => plugin.applyOfferClosesNow({
    closes: [{ key: "Tasks.md#^keep", outcome: "done" }],
    offers: [...offersByKey.values()], offersByKey, expectedLines: expected,
    noteTexts: new Map([["Tasks.md", source]]), context,
  }));
  assert.equal(res.offer_close_refused, null, JSON.stringify(res.offer_close_refused));
  assert.equal(res.offer_closes.length, 1);
  assert.equal(res.offer_closes[0].previous_status_name, "Ready", `receipt reports the live status: ${res.offer_closes[0].message}`);
  assert.match(harness.getSource("Tasks.md"), /\[x\].*\[completion:: 2026-11-05\].*\^keep/);
});
