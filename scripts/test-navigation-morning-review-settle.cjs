// Public navigation writers, real ledger taskSettle, deliberately stale Tasks queue.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  makePlugin, laneEntry, land, flushAll, notices, helpers, DATE, CARD_BASE_DATE, priorityConfig,
  choosePriorityLevel, confirmCancelReasonStage,
} = require("./navigation-review-gestures-harness.cjs");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");
const { TaskStatusCyclerPlugin, installTasksCloseCommand } = require("./task-status-cycler-harness.cjs");

const AREA = "Areas/review.md";
const PROJECT = "Projects/review.md";
const SENTINEL = "untouched.md";
const CHILDREN = "  - [ ] Requirement stays pending\n  - **NOTES**\n    - Hand-authored context";
const TASKS = [
  ["pre", "pre", "- [ ] #task #gtd #pre Start morning ^pre"],
  ["new", "new", "- [ ] #task Same name ^new"],
  ["projects", "prj", "- [ ] #task Project review ^prj"],
  ["pending", "pending", "- [/] #task Waiting [fresh:: 2026-10-01] ^pending"],
  ["next", "next", "- [*] #task Same name [fresh:: 2026-10-01] ^next"],
  ["recurring", "recur", "- [ ] #task Weekly [repeat:: every week] [scheduled:: 2026-10-08] ^recur"],
  ["tickler", "tick", "- [ ] #task Awakened [scheduled:: 2026-10-08] [fresh:: 2026-10-01] ^tick"],
  ["rotten", "rotten", "- [ ] #task Old idea [fresh:: 2026-09-01] ^rotten"],
  ["post", "post", "- [ ] #task #gtd #post Finish morning ^post"],
];
function lineOf(text, id) {
  const lines = text.split("\n");
  const matches = lines.map((line, i) => line.endsWith(` ^${id}`) ? i : -1).filter((i) => i >= 0);
  assert.equal(matches.length, 1, `unique ^${id}`);
  return matches[0];
}
function fixture() {
  const ledger = new LedgerToolsPlugin();
  ledger.app = { plugins: { plugins: {} }, vault: {}, workspace: {} };
  const settle = ledger.taskSettleApi();
  const notes = {
    [AREA]: ["---", "type: [[area]]", "---", "## Tasks", "",
      ...TASKS.filter(([tier]) => tier !== "projects").map(([, id, text]) => text + (id === "new" ? `\n${CHILDREN}` : "")), ""].join("\n"),
    [PROJECT]: "---\ntype: [[project]]\nstatus: wip\n---\n- [ ] #task Project review ^prj\n\n## Tasks\n\n- [ ] #task Resident ^resident\n",
    [SENTINEL]: "A note with no gesture.\n- [?] #task Must stay blocked ^untouched\n",
  };
  for (const path of [AREA, PROJECT]) notes[path] = settle.settleNote({ path, contents: notes[path], today: DATE }).contents;
  const rows = TASKS.map(([tier, id], i) => {
    const path = tier === "projects" ? PROJECT : AREA;
    const line = lineOf(notes[path], id);
    return { ...laneEntry({ tier, path, line: line + 1, text: id, rank: i + 1, tierRank: 1, tierTotal: 1 }),
      originalMarkdown: notes[path].split("\n")[line], blockId: id };
  });
  const f = makePlugin({ rows, activePath: AREA, notes, areaPaths: [AREA] });
  const { plugin } = f;
  ledger.app = plugin.app;
  plugin.navTaskSettleToday = () => DATE;
  plugin.app.plugins.plugins["bob-ledger-tools"].api.taskSettle = settle;
  const leaves = [...f.editors].map(([path, editor]) => ({ view: { file: { path, extension: "md" }, editor, getViewType: () => "markdown" } }));
  plugin.app.workspace.getLeavesOfType = (type) => type === "markdown" ? leaves : [];
  plugin.app.workspace.iterateAllLeaves = (visit) => leaves.forEach(visit);
  plugin.app.vault.read = async (file) => f.editors.get(file.path)?.getValue() ?? f.contents.get(file.path);
  plugin.app.vault.cachedRead = plugin.app.vault.read;
  plugin.readLinkPickerNoteContent = async (path) => plugin.app.vault.read({ path });
  plugin.app.metadataCache.getFileCache = (file) => ({ frontmatter: file.path === PROJECT ? { type: "[[project]]", status: "wip" } : file.path === AREA ? { type: "[[area]]" } : {} });
  plugin.app.metadataCache.getFirstLinkpathDest = (link) => plugin.app.vault.getAbstractFileByPath(`${link.replace(/\.md$/, "")}.md`);
  plugin.app.plugins.plugins["bob-ledger-tools"].api.freshness.version = 7;
  const cycler = new TaskStatusCyclerPlugin();
  cycler.app = plugin.app;
  cycler.getCreatedDateString = () => DATE;
  cycler.getActiveMarkdownView = () => f.view();
  cycler.scheduleCenterEditorLineInView = () => {};
  plugin.app.plugins.plugins["task-status-cycler"] = { api: { version: 6,
    completeTaskAtCursor(editor, options) {
      installTasksCloseCommand(cycler, editor);
      return cycler.completeTaskAtCursor(editor, options);
    },
  } };
  function settled(paths = [AREA, PROJECT]) {
    for (const path of paths) {
      const contents = f.editors.get(path)?.getValue() ?? f.contents.get(path);
      assert.equal(settle.settleNote({ path, contents, today: DATE }).contents, contents, `${path} is a settle fixpoint`);
    }
    assert.equal(f.editors.get(SENTINEL).getValue(), notes[SENTINEL]);
    assert.ok(f.editor.getValue().includes(CHILDREN), "requirements and drawer bytes survive");
  }
  return { ...f, ledger, settle, settled, notes, cycler, leaves };
}

async function answer(f, id, expectedNext) {
  const { plugin } = f;
  const editor = f.view().editor;
  assert.ok(editor.getLine(editor.getCursor().line).endsWith(` ^${id}`), `expected ^${id}: ${editor.getLine(editor.getCursor().line)}`);
  plugin.advanceReviewClock(2000);
  const epoch = plugin.reviewLandingEpoch;
  const before = editor.transactions.length;
  notices.length = 0;
  assert.equal(await plugin.toggleTaskLane(editor, { skipReleasePrompt: true }), true);
  await flushAll(plugin);
  f.settled();
  assert.equal(editor.transactions.length, before + 1, "gesture and regroup share one transaction");
  assert.equal(plugin.reviewLandingEpoch, epoch + 1, "one review landing");
  assert.ok(f.view().editor.getLine(f.view().editor.getCursor().line).endsWith(` ^${expectedNext}`),
    `land on ^${expectedNext}, never a duplicate name or stale line`);
}

test("morning review: PRE crossing, grouped lane answers, recurring stay, TICKLER, ROTTEN, POST", async () => {
  const f = fixture();
  await land(f);
  const before = f.editor.getValue();
  const close = await f.plugin.api.claimReviewWalkCompletion(f.editor);
  assert.equal(close.ok, true, JSON.stringify(close));
  await flushAll(f.plugin);
  f.settled();
  assert.notEqual(f.editor.getValue(), before);
  assert.ok(f.editor.getLine(f.editor.getCursor().line).endsWith(" ^new"));
  const locked = f.editor.getValue();
  assert.equal((await f.plugin.api.claimReviewWalkCompletion(f.editor)).reason, "busy");
  assert.equal(f.editor.getValue(), locked, "rapid repeat after PRE writes nothing");
  await answer(f, "new", "prj");
  await answer(f, "prj", "pending");
  await answer(f, "pending", "next");
  await answer(f, "next", "recur");
  f.plugin.advanceReviewClock(2000);
  const recurringEpoch = f.plugin.reviewLandingEpoch;
  assert.equal(await f.plugin.toggleTaskLane(f.editor, { skipReleasePrompt: true }), true);
  await flushAll(f.plugin);
  assert.equal(f.plugin.reviewLandingEpoch, recurringEpoch, "recurring lane answer stays");
  f.settled();
  f.plugin.advanceReviewClock(2000);
  assert.equal(await f.plugin.jumpToDueTask(1), true);
  // With stay-cursor, the first ]s returns to the recurring row before stepping.
  if (f.editor.getLine(f.editor.getCursor().line).endsWith(" ^recur")) {
    f.plugin.advanceReviewClock(2000);
    assert.equal(await f.plugin.jumpToDueTask(1), true);
  }
  await answer(f, "tick", "rotten");
  f.plugin.advanceReviewClock(2000);
  const epoch = f.plugin.reviewLandingEpoch;
  const origin = f.plugin.api.reviewWalk.capture(f.editor);
  assert.ok(origin);
  assert.equal((await f.plugin.app.plugins.plugins["task-status-cycler"].api.completeTaskAtCursor(f.editor)).ok, true);
  const continued = await f.plugin.api.reviewWalk.continue(origin, { kind: "complete" });
  assert.equal(continued.stopped, true);
  await flushAll(f.plugin);
  assert.equal(f.plugin.reviewLandingEpoch, epoch, "lane answer never crosses onto POST");
  f.settled();
  f.plugin.advanceReviewClock(2000);
  // Publish the Tasks cache after the morning; earlier answers deliberately
  // used its stale positions. A closed identity must never be a review landing.
  f.queueState.splice(0, f.queueState.length, ...f.queueState.filter((row) => row.blockId === "post"));
  assert.equal(await f.plugin.jumpToDueTask(1), true);
  assert.ok(f.editor.getLine(f.editor.getCursor().line).endsWith(" ^post"));
  assert.equal((await f.plugin.api.claimReviewWalkCompletion(f.editor)).ok, true);
  await flushAll(f.plugin);
  f.settled();
  assert.match(f.editor.getValue(), /- \[x\] #task #gtd #post/);
});

for (const mode of ["missing", "old", "throwing"]) {
  test(`public lane write degrades safely with ${mode} provider`, async () => {
    const f = fixture();
    const api = f.plugin.app.plugins.plugins["bob-ledger-tools"].api;
    api.taskSettle = mode === "missing" ? undefined : mode === "old" ? { ...f.settle, version: 0 } : {
      ...f.settle, settleNote() { throw new Error("provider unavailable"); },
      applyToEditor() { throw new Error("provider unavailable"); },
    };
    f.editor.setCursor(lineOf(f.editor.getValue(), "new"), 0);
    assert.equal(await f.plugin.toggleTaskLane(f.editor, { skipReleasePrompt: true }), true);
    assert.match(f.editor.getValue(), /- \[\*\] #task Same name.*\^new/);
    assert.equal(f.editor.transactions.length, 1);
    assert.equal(f.editors.get(SENTINEL).getValue(), f.notes[SENTINEL]);
  });
}

test("public dependency commit settles blocked task and same-note mirror atomically", async () => {
  const f = fixture();
  const line = lineOf(f.editor.getValue(), "new");
  f.editor.setCursor(line, 0);
  const result = await f.plugin.applyDependencyEdit({ editor: f.editor, parentPath: AREA,
    parentLine: line, add: [{ path: AREA, blockId: "next" }], remove: [], today: new Date(2026, 9, 8) });
  assert.equal(result.ok, true, JSON.stringify(result));
  f.settled();
  assert.match(f.editor.getValue(), /- \[\?\] #task Same name.*\^new/);
  assert.match(f.editor.getValue(), /DEPENDS ON/);
  assert.match(f.editor.getValue(), /BLOCKS/);
  assert.equal(f.editor.transactions.length, 1);
});

test("pending cycler work flushes before public nav capture and records one correctly directed jump", () => {
  const f = fixture();
  const line = lineOf(f.editor.getValue(), "new");
  f.editor.setCursor(line, 4);
  const text = f.editor.getLine(line);
  f.editor.replaceRange(text.replace("[ ]", "[*]"), { line, ch: 0 }, { line, ch: text.length });
  f.plugin.app.plugins.plugins["bob-navigation-hotkeys"] = { api: f.plugin.api };
  const jumps = [];
  const record = f.plugin.recordJump.bind(f.plugin);
  f.plugin.recordJump = (from, to) => { jumps.push({ from, to }); return record(from, to); };
  assert.equal(f.cycler.schedulePendingTaskSettle({ editor: f.editor, path: AREA,
    identity: { blockId: "new", line, text: f.editor.getLine(line) } }).scheduled, true);
  const captures = [];
  f.plugin.captureReviewGesture = (editor) => { captures.push(editor.getValue()); return null; };
  f.plugin.api.reviewWalk.capture(f.editor);
  f.settled();
  assert.deepEqual(captures, [f.editor.getValue()]);
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].from.line, lineOf(f.editor.getValue(), "new"));
  assert.equal(jumps[0].to.line, line, "Ctrl+O goes from stay cursor to moved task");
  f.plugin.api.reviewWalk.capture(f.editor);
  assert.equal(jumps.length, 1, "second command does not re-record the completed cycle");
});

test("note switch during a release prompt refuses both settle and legacy fallback", async () => {
  for (const available of [true, false]) {
    const f = fixture();
    if (!available) delete f.plugin.app.plugins.plugins["bob-ledger-tools"].api.taskSettle;
    f.editor.setCursor(lineOf(f.editor.getValue(), "pending"), 0);
    f.plugin.requestLaneReleaseSummary = async () => {
      await f.plugin.app.workspace.getLeaf().openFile({ path: PROJECT });
      return { cancelled: false, summary: "Finished waiting" };
    };
    assert.equal(await f.plugin.toggleTaskLane(f.editor), false);
    for (const [path, editor] of f.editors) assert.equal(editor.getValue(), f.notes[path]);
  }
});

test("move settles both notes, follows its destination, and parks the pre-write neighbour", async () => {
  const f = fixture();
  f.queueState.splice(0, 1); // NEW becomes the first morning landing.
  await land(f);
  assert.equal(f.plugin.openTaskMoveDestinationPicker(f.editor), true);
  await flushAll(f.plugin);
  const picker = f.plugin.activeTaskMoveDestinationPicker;
  const index = picker.visibleItems.findIndex((item) => item.path === PROJECT || item.file?.path === PROJECT);
  assert.ok(index >= 0, JSON.stringify(picker.visibleItems));
  await picker.openItemAtIndex(index);
  await flushAll(f.plugin);
  assert.doesNotMatch(f.editor.getValue(), /\^new/);
  assert.match(f.editors.get(PROJECT).getValue(), /\^new/);
  assert.equal(f.plugin.reviewLanding, null);
  assert.equal(f.plugin.reviewWalkBusy(), false);
  assert.equal(f.plugin.reviewAnchor.resumeNext.blockId, "prj");
  for (const path of [AREA, PROJECT]) {
    const contents = f.editors.get(path).getValue();
    assert.equal(f.settle.settleNote({ path, contents, today: DATE }).contents, contents);
  }
  assert.ok(f.editors.get(PROJECT).getValue().includes(CHILDREN));
  assert.equal(f.editors.get(SENTINEL).getValue(), f.notes[SENTINEL]);
});

test("pinned successor wins after a settled close and parks the walk", async () => {
  const f = fixture();
  f.queueState.splice(0, 4); // NEXT landing; no requirement-close card needed.
  await land(f);
  const origin = f.plugin.api.reviewWalk.capture(f.editor);
  assert.ok(origin);
  assert.equal((await f.plugin.app.plugins.plugins["task-status-cycler"].api.completeTaskAtCursor(f.editor)).ok, true);
  const outcome = await f.plugin.api.reviewWalk.continue(origin, {
    kind: "complete", follow: { path: PROJECT, blockId: "resident", line: 999, label: "Resident" },
  });
  await flushAll(f.plugin);
  assert.equal(outcome.parked, true);
  assert.equal(outcome.advanced, false);
  assert.equal(outcome.landed, true);
  assert.equal(f.activePath(), PROJECT);
  assert.ok(f.view().editor.getLine(f.view().editor.getCursor().line).endsWith(" ^resident"));
  assert.equal(f.plugin.reviewAnchor.resumeNext.blockId, "recur");
  f.settled();
});

test("public requirement split returns settled identity and exact guarded Undo bytes", async () => {
  const f = fixture();
  const before = f.editor.getValue();
  const line = before.split("\n").indexOf("  - [ ] Requirement stays pending");
  const digest = require("node:crypto").createHash("sha256")
    .update(before.split("\n")[line]).digest("hex").slice(0, 8);
  const result = await f.plugin.api.taskSplit.carryReq({ notePath: AREA, line: line + 1, expectedLine: digest });
  assert.equal(result.ok, true, result.message);
  const after = f.editor.getValue();
  assert.equal(f.settle.settleNote({ path: AREA, contents: after, today: DATE }).contents, after);
  assert.equal(result.restores[0].after, after);
  assert.equal(result.restores[0].before, before);
  assert.equal(result.task.line, lineOf(after, result.task.blockId) + 1);
  assert.equal(f.editor.transactions.length, 1);
  const undone = await f.plugin.restoreGuardedUndoChanges(result.restores);
  assert.equal(undone, true);
  assert.equal(f.editor.getValue(), before);
  assert.equal(f.editors.get(PROJECT).getValue(), f.notes[PROJECT]);
});

for (const failSource of [false, true]) {
  test(`cross-note split ${failSource ? "rolls the settled destination back on source failure" : "settles both notes and restores the exact receipt"}`, async () => {
    const f = fixture();
    const daily = "2026/20261008.md";
    const source = "## Tasks\n\n- [ ] #task Daily owner [root:: Projects/review] ^owner\n  - [ ] Carry this requirement\n";
    f.contents.set(daily, source);
    const vault = f.plugin.app.vault;
    const getFile = vault.getAbstractFileByPath;
    vault.getAbstractFileByPath = (path) => path === daily ? { path, extension: "md" } : getFile(path);
    const process = vault.process;
    vault.process = async (file, transform) => {
      if (failSource && file.path === daily) throw new Error("injected source failure");
      return process(file, transform);
    };
    const before = { [daily]: source, [PROJECT]: f.editors.get(PROJECT).getValue() };
    const plan = helpers.planSplitBullets(before, { ownerPath: daily, ownerLine: 3,
      selection: { kind: "cursor", line: 4 }, today: DATE,
      settings: { linked_from_mentions: true, linked_from_lines: true, inbox_route: "inbox.md" } });
    assert.equal(plan.ok, true, plan.message);
    const persisted = await f.plugin.persistTaskSplitPostimages(plan, { sourcePath: daily, sourceEditor: null, before });
    assert.equal(persisted.ok, !failSource, persisted.message);
    if (!failSource) {
      assert.equal(persisted.restores.length, 2);
      for (const receipt of persisted.restores) {
        const actual = f.editors.get(receipt.path)?.getValue() ?? f.contents.get(receipt.path);
        assert.equal(receipt.after, actual);
        assert.equal(f.settle.settleNote({ path: receipt.path, contents: actual, today: DATE }).contents, actual);
      }
      assert.equal(await f.plugin.restoreGuardedUndoChanges(persisted.restores), true);
    }
    assert.equal(f.contents.get(daily), source);
    assert.equal(f.editors.get(PROJECT).getValue(), before[PROJECT]);
    assert.equal(f.editor.getValue(), f.notes[AREA]);
    assert.equal(f.editors.get(SENTINEL).getValue(), f.notes[SENTINEL]);
  });
}

test("Alt+F uses the real settle provider and stays without answering the walk", async () => {
  const f = fixture();
  f.queueState.splice(0, 1);
  await land(f);
  const epoch = f.plugin.reviewLandingEpoch;
  const cursor = f.editor.getCursor();
  f.plugin.app.plugins.plugins["bob-ledger-tools"].api.freshness.keepLine =
    (line, date) => LedgerToolsPlugin.helpers.freshnessStampLine(line, date).line;
  assert.equal(await f.plugin.refreshTaskFreshness(f.editor), true);
  await flushAll(f.plugin);
  f.settled();
  assert.equal(f.plugin.reviewLandingEpoch, epoch);
  assert.equal(f.editor.getCursor().line, cursor.line);
  assert.equal(f.editor.transactions.length, 1);
  assert.match(f.editor.getValue(), /Same name \[fresh:: 2026-10-08\] \^new/);
});

function openWalkCard(f) {
  assert.equal(
    f.plugin.openBulletPropertyPicker(f.view().editor, {
      config: priorityConfig(),
      baseDate: CARD_BASE_DATE,
      random: () => 0,
    }),
    true,
  );
  const picker = f.plugin.activeBulletPropertyPicker;
  assert.ok(picker, "the Task Card opened");
  assert.equal(picker.stage, "task-card");
  return picker;
}

async function confirmWalkWorkLogIfNeeded(picker, summary = "") {
  if (picker.stage !== "schedule-work-log") return false;
  picker.inputEl = { value: summary };
  picker.visibleItems = picker.getFilteredItems();
  await picker.openItemAtIndex(0);
  return true;
}

async function runWalkCardRow(picker, rowId) {
  const row = picker.taskCardModel.rows.find((item) => item.id === rowId);
  assert.ok(row, `missing ${rowId} card row`);
  return await picker.dispatchTaskCardIntent({ type: "open-action", rowId, action: row.action });
}

function groupedWalkFixture({ targetLines, targetMatch, targetBlockId, laterDefs }) {
  const ledger = new LedgerToolsPlugin();
  ledger.app = { plugins: { plugins: {} }, vault: {}, workspace: {} };
  const settle = ledger.taskSettleApi();
  const laterLines = [];
  for (const later of laterDefs) {
    laterLines.push(later.headline);
    laterLines.push(...(later.children || []));
  }
  const raw = ["---", "type: [[area]]", "---", "## Tasks", "", ...targetLines, ...laterLines, ""].join("\n");
  const settled0 = settle.settleNote({ path: AREA, contents: raw, today: DATE }).contents;
  const lines = settled0.split("\n");
  const findBy = (match) => {
    const idx = lines.findIndex((line) => line.includes(match));
    assert.notEqual(idx, -1, `missing ${match} in:\n${settled0}`);
    return idx;
  };
  const targetIdx = findBy(targetMatch);
  const laterIdx = findBy(laterDefs[0].match);
  const rows = [
    { key: `${AREA}:${targetIdx + 1}`, path: AREA, line: targetIdx + 1, originalMarkdown: lines[targetIdx], text: targetMatch, state: null, bucket: null, tier: "next", tierLabel: "NEXT", lane: "ready", fresh: "2026-10-06", dueOn: DATE, daysOverdue: 0, interval: 7, rank: 1, tierRank: 1, tierTotal: 2, blockId: targetBlockId },
    { key: `${AREA}:${laterIdx + 1}`, path: AREA, line: laterIdx + 1, originalMarkdown: lines[laterIdx], text: laterDefs[0].match, state: null, bucket: null, tier: "next", tierLabel: "NEXT", lane: "ready", fresh: "2026-10-06", dueOn: DATE, daysOverdue: 0, interval: 7, rank: 2, tierRank: 2, tierTotal: 2, blockId: laterDefs[0].blockId },
  ];
  const f = makePlugin({ rows, activePath: AREA, notes: { [AREA]: settled0 }, areaPaths: [AREA] });
  const { plugin } = f;
  ledger.app = plugin.app;
  plugin.navTaskSettleToday = () => DATE;
  plugin.app.plugins.plugins["bob-ledger-tools"].api.taskSettle = settle;
  plugin.app.plugins.plugins["bob-ledger-tools"].api.freshness.version = 7;
  const leaves = [...f.editors].map(([path, editor]) => ({ view: { file: { path, extension: "md" }, editor, getViewType: () => "markdown" } }));
  plugin.app.workspace.getLeavesOfType = (type) => (type === "markdown" ? leaves : []);
  plugin.app.workspace.iterateAllLeaves = (visit) => leaves.forEach(visit);
  plugin.app.vault.read = async (file) => f.editors.get(file.path)?.getValue() ?? f.contents.get(file.path);
  plugin.app.vault.cachedRead = plugin.app.vault.read;
  plugin.readLinkPickerNoteContent = async (path) => plugin.app.vault.read({ path });
  plugin.app.metadataCache.getFileCache = (file) => ({ frontmatter: file.path === AREA ? { type: "[[area]]" } : {} });
  return { ...f, ledger, settle, settled0, targetMatch, targetBlockId };
}

function laterPair(oneId, twoId) {
  const lineFor = (id) => (oneId === "" ? `- [*] #task ${id} [fresh:: 2026-10-01]` : `- [*] #task ${id} [fresh:: 2026-10-01] ^${id}`);
  return [
    { headline: lineFor(oneId === "" ? "Later one" : oneId), children: ["  - child note one", "  - child note two"], match: oneId === "" ? "Later one" : `^${oneId}`, blockId: oneId === "" ? "" : oneId },
    { headline: lineFor(twoId === "" ? "Later two" : twoId), children: ["  - child note one", "  - child note two"], match: twoId === "" ? "Later two" : `^${twoId}`, blockId: twoId === "" ? "" : twoId },
  ];
}

function assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch, groupTitle }) {
  const value = editor.getValue();
  assert.equal(f.settle.settleNote({ path: AREA, contents: value, today: DATE }).contents, value, "the note is a settle fixpoint");
  assert.equal(editor.transactions.length, beforeTx + 1, "gesture and regroup share one transaction");
  assert.equal(f.plugin.reviewLandingEpoch, epoch + 1, "the walk advanced exactly once");
  const cursorLine = editor.getLine(editor.getCursor().line) || "";
  assert.ok(cursorLine.includes(laterMatch), `cursor is on the next due row by identity, saw: ${cursorLine}`);
  assert.equal(notices.length, 2, `rich card plus one landing toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[1], /Review \d+\/\d+/);
  const groupIdx = value.split("\n").findIndex((line) => line.trim() === groupTitle);
  assert.notEqual(groupIdx, -1, `missing ${groupTitle} in:\n${value}`);
  return value;
}

test("Alt+P on a grouped ID'd walk row regroups to Blocked and advances once", async () => {
  const targetLine = "- [ ] #task Target [priority:: high] [scheduled:: 2026-10-01] [fresh:: 2026-10-01] ^target";
  const f = groupedWalkFixture({ targetLines: [targetLine], targetMatch: "^target", targetBlockId: "target", laterDefs: laterPair("later1", "later2") });
  await land(f);
  const editor = f.view().editor;
  assert.ok(editor.getLine(editor.getCursor().line).includes("^target"));
  const epoch = f.plugin.reviewLandingEpoch;
  const beforeTx = editor.transactions.length;
  notices.length = 0;
  f.plugin.rollByRecommendation(editor, { config: priorityConfig(), baseDate: CARD_BASE_DATE, random: () => 0 });
  await flushAll(f.plugin);
  await flushAll(f.plugin);
  const value = assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch: "^later1", groupTitle: "### Blocked" });
  assert.match(value, /- \[\?\] #task Target .*\[scheduled:: 2026-10-09\].*\^target/);
  assert.match(value, /### Blocked/);
});

test("Alt+P on a grouped ID-less walk row regroups to Blocked and advances once", async () => {
  const targetLine = "- [ ] #task Target [priority:: high] [scheduled:: 2026-10-01] [fresh:: 2026-10-01]";
  const f = groupedWalkFixture({ targetLines: [targetLine], targetMatch: "Target", targetBlockId: "", laterDefs: [
    { headline: "- [*] #task Later one [fresh:: 2026-10-01]", children: ["  - child note one", "  - child note two"], match: "Later one", blockId: "" },
    { headline: "- [*] #task Later two [fresh:: 2026-10-01]", children: ["  - child note one", "  - child note two"], match: "Later two", blockId: "" },
  ] });
  await land(f);
  const editor = f.view().editor;
  assert.ok(editor.getLine(editor.getCursor().line).includes("Target"));
  const epoch = f.plugin.reviewLandingEpoch;
  const beforeTx = editor.transactions.length;
  notices.length = 0;
  f.plugin.rollByRecommendation(editor, { config: priorityConfig(), baseDate: CARD_BASE_DATE, random: () => 0 });
  await flushAll(f.plugin);
  await flushAll(f.plugin);
  const value = assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch: "Later one", groupTitle: "### Blocked" });
  assert.match(value, /- \[\?\] #task Target .*\[scheduled:: 2026-10-09\]/);
});

test("Alt+P decay P1 to P2 on a grouped walk row regroups and advances once", async () => {
  const targetLines = [
    "- [ ] #task Target [priority:: high] [scheduled:: 2026-10-01] [fresh:: 2026-10-01] ^target",
    "\t- \u{1F5D3}\uFE0F **SCHEDULE LOG**",
    "\t\t- *2026-10-01* \u2014 \u{1F3B2} P1 roll \u00B7 in **2** (2\u20137) days",
  ];
  const f = groupedWalkFixture({ targetLines, targetMatch: "^target", targetBlockId: "target", laterDefs: laterPair("later1", "later2") });
  await land(f);
  const editor = f.view().editor;
  const epoch = f.plugin.reviewLandingEpoch;
  const beforeTx = editor.transactions.length;
  notices.length = 0;
  f.plugin.rollByRecommendation(editor, { config: priorityConfig(), baseDate: CARD_BASE_DATE, random: () => 0 });
  await flushAll(f.plugin);
  await flushAll(f.plugin);
  const value = assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch: "^later1", groupTitle: "### Blocked" });
  assert.match(value, /P1 \u2192 P2 decay/);
  assert.match(value, /\[priority:: medium\].*\^target/);
  assert.match(value, /- \[\?\] #task Target .*\[scheduled:: 2026-10-15\].*\^target/);
});

test("a Task Card P-level pick on a grouped walk row regroups and advances once", async () => {
  const targetLine = "- [ ] #task Target [priority:: high] [scheduled:: 2026-10-01] [fresh:: 2026-10-01] ^target";
  const f = groupedWalkFixture({ targetLines: [targetLine], targetMatch: "^target", targetBlockId: "target", laterDefs: laterPair("later1", "later2") });
  await land(f);
  const editor = f.view().editor;
  const epoch = f.plugin.reviewLandingEpoch;
  const beforeTx = editor.transactions.length;
  notices.length = 0;
  const picker = openWalkCard(f);
  await choosePriorityLevel(f.plugin, "P2");
  await confirmWalkWorkLogIfNeeded(picker, "");
  await flushAll(f.plugin);
  const value = assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch: "^later1", groupTitle: "### Blocked" });
  assert.match(value, /\[priority:: medium\].*\^target/);
  assert.match(value, /- \[\?\] #task Target .*\[scheduled:: /);
});

test("Ctrl+Enter on a grouped walk row regroups and advances once", async () => {
  const targetLine = "- [ ] #task Target [priority:: high] [scheduled:: 2026-10-01] [fresh:: 2026-10-01] ^target";
  const f = groupedWalkFixture({ targetLines: [targetLine], targetMatch: "^target", targetBlockId: "target", laterDefs: laterPair("later1", "later2") });
  await land(f);
  const editor = f.view().editor;
  const epoch = f.plugin.reviewLandingEpoch;
  const beforeTx = editor.transactions.length;
  notices.length = 0;
  const picker = openWalkCard(f);
  assert.equal(await picker.dispatchTaskCardIntent({ type: "apply-recommendation" }), true);
  await confirmWalkWorkLogIfNeeded(picker, "");
  await flushAll(f.plugin);
  await flushAll(f.plugin);
  const value = assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch: "^later1", groupTitle: "### Blocked" });
  assert.match(value, /- \[\?\] #task Target .*\[scheduled:: 2026-10-09\].*\^target/);
});

test("a Task Card cancel on a grouped walk row closes to Done and advances once", async () => {
  const targetLine = "- [ ] #task Target [priority:: high] [scheduled:: 2026-10-01] [fresh:: 2026-10-01] ^target";
  const f = groupedWalkFixture({ targetLines: [targetLine], targetMatch: "^target", targetBlockId: "target", laterDefs: laterPair("later1", "later2") });
  await land(f);
  const editor = f.view().editor;
  const epoch = f.plugin.reviewLandingEpoch;
  const beforeTx = editor.transactions.length;
  notices.length = 0;
  const picker = openWalkCard(f);
  await runWalkCardRow(picker, "cancel");
  await confirmCancelReasonStage(picker, "too late");
  await flushAll(f.plugin);
  await flushAll(f.plugin);
  const value = assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch: "^later1", groupTitle: "### Done & Canceled" });
  assert.match(value, /- \[-\] #task Target.*\^target/);
});

test("a duplicate-title ID-less grouped commit stays without advancing", async () => {
  const f = groupedWalkFixture({
    targetLines: ["- [ ] #task Same title"],
    targetMatch: "Same title",
    targetBlockId: "",
    laterDefs: [
      { headline: "- [ ] #task Same title", children: [], match: "Same title", blockId: "" },
      { headline: "- [*] #task Later with child [fresh:: 2026-10-01]", children: ["  - child one", "  - child two"], match: "Later with child", blockId: "" },
    ],
  });
  await land(f);
  const editor = f.view().editor;
  const epoch = f.plugin.reviewLandingEpoch;
  notices.length = 0;
  const picker = openWalkCard(f);
  await choosePriorityLevel(f.plugin, "P2");
  await confirmWalkWorkLogIfNeeded(picker, "");
  await flushAll(f.plugin);
  await flushAll(f.plugin);
  assert.equal(f.plugin.reviewLandingEpoch, epoch, "an ambiguous identity stays");
});

test("a large grouped block still advances exactly once", async () => {
  const children = Array.from({ length: 12 }, (_, i) => `  - child note ${i + 1}`);
  const f = groupedWalkFixture({
    targetLines: ["- [ ] #task Target [priority:: high] [scheduled:: 2026-10-01] [fresh:: 2026-10-01] ^target", ...children],
    targetMatch: "^target",
    targetBlockId: "target",
    laterDefs: [
      { headline: "- [*] #task Later one [fresh:: 2026-10-01] ^later1", children: [], match: "^later1", blockId: "later1" },
      { headline: "- [*] #task Later two [fresh:: 2026-10-01] ^later2", children: [], match: "^later2", blockId: "later2" },
    ],
  });
  await land(f);
  const editor = f.view().editor;
  const epoch = f.plugin.reviewLandingEpoch;
  const beforeTx = editor.transactions.length;
  notices.length = 0;
  f.plugin.rollByRecommendation(editor, { config: priorityConfig(), baseDate: CARD_BASE_DATE, random: () => 0 });
  await flushAll(f.plugin);
  await flushAll(f.plugin);
  assertGroupedSettleAdvance({ f, editor, beforeTx, epoch, laterMatch: "^later1", groupTitle: "### Blocked" });
});
