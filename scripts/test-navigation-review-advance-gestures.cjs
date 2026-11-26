// Public review gesture regressions; shared fixture also drives real-settle acceptance.
const assert = require("node:assert/strict");
const test = require("node:test");
const { notices, NavigationHotkeysPlugin, helpers, TransactionEditor, DATE, CARD_BASE_DATE, markFor, laneEntry, nextQueue, makePlugin, clearNotices, land, flushAll, priorityConfig, scheduleConfig, choosePriorityLevel, confirmCancelReasonStage } = require("./navigation-review-gestures-harness.cjs");

test("Alt+N release from a NEXT landing advances with one composed toast", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const before = fixture.plugin.reviewLanding.key;

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[0], /^- \[ \] #task One/);
  assert.notEqual(fixture.plugin.reviewLanding.key, before);
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.match(notices[0], /Review \d+\/\d+/);
});

test("counted Alt+N lands past every handled key in one jump", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two", "Three"]),
    activePath: "walk.md",
  });
  await land(fixture, "first");

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, {
      skipReleasePrompt: true,
      countExplicit: true,
      additionalTaskCount: 1,
    }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:3");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Ready · 2 tasks/);
});

test("a cancelled Alt+N release prompt stays and frees the lock", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  // A Pending release asks for a Work Log summary; refuse it here.
  fixture.queueState[0].tier = "pending";
  fixture.queueState[0].originalMarkdown = markFor("pending", "One");
  fixture.editors.get("walk.md").content = fixture.queueState
    .map((row) => row.originalMarkdown)
    .join("\n");
  fixture.plugin.reviewLanding = null;
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  fixture.plugin.requestLaneReleaseSummary = async () => ({ cancelled: true, summary: "" });

  assert.equal(await fixture.plugin.toggleTaskLane(fixture.editor), false);
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.deepEqual(notices, []);
  assert.ok(
    fixture.plugin.captureReviewGesture(fixture.editor),
    "the lock is free after a cancel",
  );
});

test("Alt+N on a checklist landing stays with the plain notice", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
});

test("Alt+N off a landing on a task that is not due behaves exactly as today", async () => {
  clearNotices();
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  assert.equal(fixture.plugin.reviewLanding, null);
  // A task line the queue does not know: in place, no advance.
  fixture.editor.content = `${fixture.editor.content}\n- [*] #task Offqueue`;
  fixture.editor.setCursor(2, 0);

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[2], /^- \[ \] #task Offqueue/);
  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
});

test("Alt+N while the gesture lock is held is swallowed", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const content = fixture.editor.content;
  assert.ok(fixture.plugin.captureReviewGesture(fixture.editor), "capture takes the lock");

  assert.equal(await fixture.plugin.toggleTaskLane(fixture.editor), false);
  await flushAll(fixture.plugin);

  assert.equal(fixture.editor.content, content);
  assert.deepEqual(notices, []);
});

function openCard(fixture, config) {
  assert.equal(
    fixture.plugin.openBulletPropertyPicker(fixture.editor, {
      config,
      baseDate: CARD_BASE_DATE,
      random: () => 0,
    }),
    true,
  );
  const picker = fixture.plugin.activeBulletPropertyPicker;
  assert.ok(picker, "the card opened");
  assert.equal(picker.stage, "task-card");
  return picker;
}

async function confirmSchedulingWorkLogStage(picker, summary = "") {
  assert.equal(picker.stage, "schedule-work-log");
  picker.inputEl = { value: summary };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

async function runCardAction(picker, rowId) {
  assert.equal(picker.stage, "task-card");
  const row = picker.taskCardModel.rows.find((item) => item.id === rowId);
  assert.ok(row, `missing ${rowId} card row`);
  assert.equal(row.enabled, true, `${rowId} card row is disabled`);
  return await picker.dispatchTaskCardIntent({
    type: "open-action",
    rowId,
    action: row.action,
  });
}

async function confirmScheduleReviewStage(picker, reasonText = "") {
  assert.equal(picker.stage, "schedule-review");
  if (picker.scheduleReviewReasonEl) {
    picker.scheduleReviewReasonEl.value = reasonText;
  }
  picker.visibleItems = picker.getFilteredItems();
  const applied = await picker.confirmScheduleReview();
  if (applied === true) {
    picker.close();
  }
  return applied;
}

test("a Task Card priority commit on NEXT advances, landing after the rich card", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const picker = openCard(fixture, priorityConfig());

  await choosePriorityLevel(fixture.plugin, "P1");
  await confirmSchedulingWorkLogStage(picker, "");
  await flushAll(fixture.plugin);

  assert.match(
    fixture.editor.content.split("\n")[0],
    /\[scheduled:: 2026-10-09\]/,
    "the commit rolled a future scheduled date",
  );
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.equal(
    notices.length,
    2,
    `rich card plus landing toast, saw: ${JSON.stringify(notices)}`,
  );
  assert.match(notices[1], /Review \d+\/\d+/);
});

test("dismissing the Task Card stays and frees the lock", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  const picker = openCard(fixture, priorityConfig());

  picker.close();
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.deepEqual(notices, []);
  assert.ok(
    fixture.plugin.captureReviewGesture(fixture.editor),
    "the lock is free after Esc",
  );
});

test("a frontmatter-only project edit from the card stays", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  const picker = openCard(fixture, priorityConfig());

  const lines = fixture.editor.content.split("\n");
  lines[1] = `${lines[1]} [project:: Areas]`;
  fixture.editor.content = lines.join("\n");
  picker.close();
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.deepEqual(notices, []);
});

test("a same-day priority schedule on a checklist row stays", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  // scheduleConfig P1 rolls min 1 day from the Oct 7 base: Oct 8 is today,
  // not the future, so the write stays on a checklist row.
  const picker = openCard(fixture, scheduleConfig());

  await choosePriorityLevel(fixture.plugin, "P1");
  if (picker.stage === "schedule-work-log") {
    await confirmSchedulingWorkLogStage(picker, "");
  }
  await flushAll(fixture.plugin);

  assert.match(
    fixture.editor.content.split("\n")[0],
    /\[priority:: high\] \[scheduled:: 2026-10-08\]/,
    "the priority write landed without a future schedule",
  );
  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.equal(
    fixture.plugin.reviewWalkBusy(),
    false,
    "the lock is free after a stay",
  );
});

test("a future schedule on a checklist row advances", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const picker = openCard(fixture, scheduleConfig());

  await runCardAction(picker, "schedule");
  const dateIndex = picker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(dateIndex, -1, "a future date is offered");
  await picker.openItemAtIndex(dateIndex);
  await confirmScheduleReviewStage(picker, "");
  await flushAll(fixture.plugin);

  assert.match(
    fixture.editor.content.split("\n")[0],
    /\[scheduled:: 2026-10-09\]/,
    "the commit wrote a future scheduled date",
  );
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.ok(notices.length >= 1, `a landing toast follows, saw: ${JSON.stringify(notices)}`);
  assert.match(notices.at(-1), /Review \d+\/\d+/);
});

function plainPreRow(line, text, total) {
  // A non-recurring checklist row: the tier is what makes it a checklist
  // row, and a plain `- [ ]` keeps the card's cancel row enabled.
  const row = laneEntry({ tier: "pre", line, text, rank: line, tierRank: line, tierTotal: total });
  row.originalMarkdown = `- [ ] #task ${text}`;
  return row;
}

test("a Task Card cancel on a checklist row advances with the cancel card first", async () => {
  const rows = [plainPreRow(1, "One", 2), plainPreRow(2, "Two", 2)];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const picker = openCard(fixture, scheduleConfig());

  await runCardAction(picker, "cancel");
  await confirmCancelReasonStage(picker, "too late");
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[0], /^- \[-\]/);
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.equal(
    notices.length,
    2,
    `cancel card then landing toast, saw: ${JSON.stringify(notices)}`,
  );
  assert.match(notices[0], /Cancelled/);
  assert.match(notices[1], /Review \d+\/\d+/);
});

function openMovePicker(fixture) {
  assert.equal(fixture.plugin.openTaskMoveDestinationPicker(fixture.editor), true);
  const picker = fixture.plugin.activeTaskMoveDestinationPicker;
  assert.ok(picker, "the move picker opened");
  return picker;
}

test("Ctrl+Shift+M from a landing follows the task and never advances", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const focusCalls = [];
  fixture.plugin.focusTaskMoveDestination = async (...args) => {
    focusCalls.push(args);
    return true;
  };
  const picker = openMovePicker(fixture);
  assert.ok(picker.session.reviewOrigin, "the session carries the origin");

  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);

  assert.equal(focusCalls.length, 1, "the destination is focused");
  assert.match(String(focusCalls[0][0] && focusCalls[0][0].path), /Area\.md/, "for Area.md");
  assert.doesNotMatch(fixture.editor.content, /#task One/);
  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(fixture.plugin.reviewWalkBusy(), false);
  assert.equal(fixture.plugin.reviewAnchor.resumeNext.text, "- [*] #task Two");
  assert.equal(fixture.plugin.reviewAnchor.resumePrev, null);
  assert.equal(fixture.plugin.reviewAnsweredKeys.keys.size, 0);
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /Moved 1 task to Area/);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
});

test("Ctrl+Shift+M from a checklist landing keeps the destination focus", async () => {
  const rows = [
    laneEntry({ tier: "pre", path: "Source.md", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", path: "Source.md", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({
    rows,
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const focusCalls = [];
  fixture.plugin.focusTaskMoveDestination = async (...args) => {
    focusCalls.push(args);
    return true;
  };
  const picker = openMovePicker(fixture);

  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);

  assert.equal(focusCalls.length, 1, "the destination is focused");
  assert.equal(fixture.plugin.reviewLanding, null, "the landing is consumed");
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /Moved 1 task to Area/);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
});

test("]s after a landed move resumes at the successor despite the line shift", async () => {
  const twoMarkdown = "- [*] #task Two";
  // Refreshed cache: Two shifted to line 1 with a colliding handled key.
  {
    const fixture = makePlugin({
      rows: nextQueue(["One", "Two", "Three"], "Source.md"),
      activePath: "Source.md",
      areaPaths: ["Area.md"],
    });
    await land(fixture, "first");
    fixture.plugin.focusTaskMoveDestination = async () => true;
    const picker = openMovePicker(fixture);
    await picker.openItemAtIndex(0);
    await flushAll(fixture.plugin);
    const two = fixture.queueState.find((row) => row.text === "Two");
    const three = fixture.queueState.find((row) => row.text === "Three");
    fixture.queueState.splice(
      0,
      fixture.queueState.length,
      { ...two, line: 1, key: "Source.md:1", rank: 1, tierRank: 1, tierTotal: 2 },
      { ...three, line: 2, key: "Source.md:2", rank: 2, tierRank: 2, tierTotal: 2 },
    );
    await fixture.plugin.app.workspace
      .getLeaf()
      .openFile(fixture.plugin.app.vault.getAbstractFileByPath("Area.md"));
    clearNotices();
    assert.equal(await fixture.plugin.jumpToDueTask(1), true);
    assert.equal(fixture.plugin.reviewLanding.text, twoMarkdown, "refreshed lands on Two, not Three");
  }
  // Stale cache: the queue still lists the moved row.
  {
    const fixture = makePlugin({
      rows: nextQueue(["One", "Two", "Three"], "Source.md"),
      activePath: "Source.md",
      areaPaths: ["Area.md"],
    });
    await land(fixture, "first");
    fixture.plugin.focusTaskMoveDestination = async () => true;
    const picker = openMovePicker(fixture);
    await picker.openItemAtIndex(0);
    await flushAll(fixture.plugin);
    await fixture.plugin.app.workspace
      .getLeaf()
      .openFile(fixture.plugin.app.vault.getAbstractFileByPath("Area.md"));
    clearNotices();
    assert.equal(await fixture.plugin.jumpToDueTask(1), true);
    assert.equal(fixture.plugin.reviewLanding.text, twoMarkdown, "stale lands on Two");
  }
  // <C-o> seam: the cursor sits on the resume row in the source note.
  {
    const fixture = makePlugin({
      rows: nextQueue(["One", "Two", "Three"], "Source.md"),
      activePath: "Source.md",
      areaPaths: ["Area.md"],
    });
    await land(fixture, "first");
    fixture.plugin.focusTaskMoveDestination = async () => true;
    const picker = openMovePicker(fixture);
    await picker.openItemAtIndex(0);
    await flushAll(fixture.plugin);
    const two = fixture.queueState.find((row) => row.text === "Two");
    const three = fixture.queueState.find((row) => row.text === "Three");
    fixture.queueState.splice(
      0,
      fixture.queueState.length,
      { ...two, line: 1, key: "Source.md:1", rank: 1, tierRank: 1, tierTotal: 2 },
      { ...three, line: 2, key: "Source.md:2", rank: 2, tierRank: 2, tierTotal: 2 },
    );
    fixture.editors.get("Source.md").setCursor(0, 0);
    clearNotices();
    assert.equal(await fixture.plugin.jumpToDueTask(1), true);
    assert.equal(fixture.plugin.reviewLanding.text, twoMarkdown, "the seam lands on Two");
  }
});

test("[s after a landed move resumes at the predecessor", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two", "Three"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  assert.equal(await fixture.plugin.jumpToDueTask(1), true, "lands on the middle row");
  assert.equal(fixture.plugin.reviewLanding.text, "- [*] #task Two");
  clearNotices();
  fixture.plugin.focusTaskMoveDestination = async () => true;
  const picker = openMovePicker(fixture);
  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);
  const one = fixture.queueState.find((row) => row.text === "One");
  const three = fixture.queueState.find((row) => row.text === "Three");
  fixture.queueState.splice(
    0,
    fixture.queueState.length,
    { ...one, line: 1, key: "Source.md:1", rank: 1, tierRank: 1, tierTotal: 2 },
    { ...three, line: 2, key: "Source.md:2", rank: 2, tierRank: 2, tierTotal: 2 },
  );
  await fixture.plugin.app.workspace
    .getLeaf()
    .openFile(fixture.plugin.app.vault.getAbstractFileByPath("Area.md"));
  clearNotices();
  assert.equal(await fixture.plugin.jumpToDueTask(-1), true);
  assert.equal(fixture.plugin.reviewLanding.text, "- [*] #task One");
});

test("a counted move from a landing resumes past every moved target", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two", "Three"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  fixture.plugin.focusTaskMoveDestination = async () => true;
  assert.equal(
    fixture.plugin.openTaskMoveDestinationPicker(fixture.editor, fixture.view(), {
      additionalTaskCount: 1,
      countExplicit: true,
    }),
    true,
  );
  const picker = fixture.plugin.activeTaskMoveDestinationPicker;
  assert.ok(picker, "the counted move picker opened");
  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);
  assert.equal(fixture.plugin.reviewAnchor.resumeNext.text, "- [*] #task Three");
  const three = fixture.queueState.find((row) => row.text === "Three");
  fixture.queueState.splice(0, fixture.queueState.length, {
    ...three,
    line: 1,
    key: "Source.md:1",
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
  });
  await fixture.plugin.app.workspace
    .getLeaf()
    .openFile(fixture.plugin.app.vault.getAbstractFileByPath("Area.md"));
  clearNotices();
  assert.equal(await fixture.plugin.jumpToDueTask(1), true);
  assert.equal(fixture.plugin.reviewLanding.text, "- [*] #task Three");
});

test("counted Ctrl+Shift+M command dispatch preserves a landed move count", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two", "Three"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const inputState = {
    keyBuffer: ["1"],
    prefixRepeat: [],
    motionRepeat: [],
    getRepeat: () => 1,
  };
  fixture.editor.cm = {
    cm: {
      state: { vim: { mode: "normal", inputState } },
      getCursor: () => fixture.editor.getCursor(),
    },
  };

  assert.equal(
    fixture.plugin.openTaskMoveOrPomodoroBulletPicker(
      fixture.editor,
      fixture.view(),
    ),
    true,
  );
  const event = {
    key: "M",
    code: "KeyM",
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    repeat: false,
    defaultPrevented: true,
    preventDefault() { assert.fail("handled event must not be canceled again"); },
    stopPropagation() { assert.fail("handled event must not stop again"); },
  };
  assert.equal(
    fixture.plugin.handleCountedTaskMovePhysicalKeydown(event),
    false,
  );
  assert.deepEqual(inputState.keyBuffer, []);

  const picker = fixture.plugin.activeTaskMoveDestinationPicker;
  assert.ok(picker, "exactly one picker is active");
  assert.equal(picker.session.countExplicit, true);
  assert.equal(picker.session.discovery.actualCount, 2);
  assert.ok(picker.session.reviewOrigin);
  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);
  assert.equal(fixture.plugin.reviewAnchor.resumeNext.text, "- [*] #task Three");
});

test("a stale landing is not parked", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const focusCalls = [];
  fixture.plugin.focusTaskMoveDestination = async (...args) => {
    focusCalls.push(args);
    return true;
  };
  const picker = openMovePicker(fixture);
  fixture.plugin.reviewLanding = null;
  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);

  assert.ok(!fixture.plugin.reviewAnchor || !fixture.plugin.reviewAnchor.resumeNext, "the anchor has no resumeNext");
  assert.equal(focusCalls.length, 1, "the destination is still focused");
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /Moved 1 task to Area/);
  assert.equal(fixture.plugin.reviewWalkBusy(), false, "the lock is free");
});

test("Ctrl+Shift+M while the gesture lock is held is swallowed", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const content = fixture.editor.content;
  assert.ok(fixture.plugin.captureReviewGesture(fixture.editor), "capture takes the lock");

  assert.equal(fixture.plugin.openTaskMoveDestinationPicker(fixture.editor), true);
  assert.ok(fixture.plugin.activeTaskMoveDestinationPicker == null, "no picker opens");
  assert.equal(fixture.editor.content, content);
  assert.deepEqual(notices, []);
});

test("dismissing the move picker stays and frees the lock", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const picker = openMovePicker(fixture);

  picker.close();
  await flushAll(fixture.plugin);

  assert.deepEqual(notices, []);
  const recapture = fixture.plugin.captureReviewGesture(fixture.editor);
  assert.ok(recapture && !recapture.busy, "the lock is free after dismiss");
});

test("Ctrl+Shift+M off a landing behaves exactly as today", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  assert.equal(fixture.plugin.reviewLanding, null);
  const focusCalls = [];
  fixture.plugin.focusTaskMoveDestination = async (...args) => {
    focusCalls.push(args);
    return true;
  };
  const picker = openMovePicker(fixture);
  assert.equal(picker.session.reviewOrigin, null);

  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);

  assert.equal(focusCalls.length, 1);
  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(fixture.plugin.reviewAnchor, null, "the anchor is untouched");
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Moved 1 task to Area/);
});

test("answer, move, answer stays in queue order past an accumulator alias", async () => {
  const fixture = makePlugin({ rows: nextQueue(["A", "B", "C", "D"]), activePath: "walk.md" });
  const { plugin, editor, queueState } = fixture;
  await land(fixture, "first");
  const firstKey = plugin.reviewLanding.key;
  const firstText = plugin.reviewLanding.text;

  // 1. Answer row A with a lane commit; the accumulator records A's key.
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && !origin.busy, "an origin is captured");
  const answered = await plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: firstText }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(answered, { ok: true, advanced: true, stopped: false });
  assert.equal(plugin.reviewLanding.key, "walk.md:2", "lands on B");
  clearNotices();

  // 2. A 2-line move above a later row shifts lines: A is truly gone and
  // C inherits A's old line key with different text.
  const bRow = queueState.find((row) => row.text === "B");
  const cRow = queueState.find((row) => row.text === "C");
  const dRow = queueState.find((row) => row.text === "D");
  queueState.splice(
    0,
    queueState.length,
    { ...bRow },
    { ...cRow, line: 1, key: firstKey, rank: 1, tierRank: 1, tierTotal: 3 },
    { ...dRow },
  );

  // 3. Answer the landed row B; the advance must land on C, not past it.
  plugin.advanceReviewClock(400);
  const second = plugin.captureReviewGesture(editor);
  assert.ok(second && !second.busy, "the landed row is captured");
  const advanced = await plugin.continueReviewWalkAfter(second, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: bRow.line - 1, raw: bRow.originalMarkdown }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(advanced, { ok: true, advanced: true, stopped: false });
  assert.equal(
    plugin.reviewLanding.text,
    cRow.originalMarkdown,
    "the aliased row is still visited",
  );
  clearNotices();

  // A later ]s still visits D.
  plugin.advanceReviewClock(400);
  assert.equal(await plugin.jumpToDueTask(1), true);
  assert.equal(plugin.reviewLanding.text, dRow.originalMarkdown, "D follows C");
});

test("a move park ignores a stale accumulator alias", async () => {
  const fixture = makePlugin({ rows: nextQueue(["A", "B", "C", "D", "E"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  // Seed an accumulator key that now names a different row.
  plugin.addReviewAnsweredKeys([{ key: "walk.md:4", text: "- [*] #task stale" }], DATE);
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && !origin.busy, "an origin is captured");
  assert.equal(plugin.parkReviewWalkAfterMove(origin, []), true, "the park lands");
  assert.equal(plugin.reviewLanding, null, "the landing is consumed");
  const anchor = plugin.reviewAnchor;
  assert.ok(anchor && anchor.resumeNext, "a resume is parked");
  assert.equal(anchor.resumeNext.text, markFor("next", "B"), "resume skips to B, not past D");
  plugin.advanceReviewClock(400);
  clearNotices();
  assert.equal(await plugin.jumpToDueTask(1), true);
  assert.equal(plugin.reviewLanding.text, markFor("next", "B"), "the next ]s lands on B");
});

test("a re-indexed origin still advances from the landed row", async () => {
  const rows = [
    laneEntry({ tier: "next", path: "walk.md", line: 2, text: "A", rank: 1, tierRank: 1, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 3, text: "B", rank: 2, tierRank: 2, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 4, text: "C", rank: 3, tierRank: 3, tierTotal: 3 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin } = fixture;
  const editor = fixture.editors.get("walk.md");
  // The note opens with one filler line above the queue rows.
  editor.setCursor(1, 0);
  await land(fixture, "first");
  assert.equal(plugin.reviewLanding.key, "walk.md:2", "landed on A");

  // A line above is removed: every row shifts up, so landing.key walk.md:2
  // now names B while the cursor still sits on A's text.
  const lines = editor.content.split("\n");
  lines.splice(0, 1);
  editor.content = lines.join("\n");
  editor.setCursor(0, 0);
  const aRow = fixture.queueState.find((row) => row.text === "A");
  const bRow = fixture.queueState.find((row) => row.text === "B");
  const cRow = fixture.queueState.find((row) => row.text === "C");
  fixture.queueState.splice(
    0,
    fixture.queueState.length,
    { ...aRow, line: 1, key: "walk.md:1" },
    { ...bRow, line: 2, key: "walk.md:2" },
    { ...cRow, line: 3, key: "walk.md:3" },
  );
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && !origin.busy, "the landed row is captured by text");
  assert.equal(origin.rowKey, "walk.md:1", "the origin follows the text, not the stale key");
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: aRow.originalMarkdown }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(result, { ok: true, advanced: true, stopped: false });
  assert.equal(plugin.reviewLanding.text, bRow.originalMarkdown, "advances to B, not past it");
});
test("a landed move park clears the current review task", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two", "Three"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  assert.ok(plugin.reviewWalkCurrent, "a current task is set");
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && !origin.busy, "an origin is captured");
  assert.equal(plugin.parkReviewWalkAfterMove(origin, []), true, "the park lands");
  assert.equal(plugin.reviewLanding, null, "the landing is consumed");
  assert.equal(plugin.reviewWalkCurrent, null, "the current task is cleared");
  plugin.advanceReviewClock(400);
  clearNotices();
  assert.equal(await plugin.jumpToDueTask(1), true);
  assert.equal(plugin.reviewLanding.text, markFor("next", "Two"), "the next ]s resumes at the neighbour");
  assert.ok(!notices[0].startsWith("Back to current review task"), "no return after a park");
});

test("review settle follows the task through a BLOCKS insertion above (bob-cli-94)", async () => {
  const rows = [
    laneEntry({ tier: "next", path: "walk.md", line: 2, text: "A", rank: 1, tierRank: 1, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 3, text: "B", rank: 2, tierRank: 2, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 4, text: "C", rank: 3, tierRank: 3, tierTotal: 3 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin } = fixture;
  const editor = fixture.editors.get("walk.md");
  editor.setCursor(1, 0);
  await land(fixture, "first");
  assert.equal(plugin.reviewLanding.key, "walk.md:2", "landed on A");
  const picker = openCard(fixture, priorityConfig());
  assert.ok(picker.reviewOrigin, "origin captured");
  assert.equal(typeof picker.reviewOriginContent, "string", "snapshot retained");
  const beforeLine = picker.reviewBeforeLine;
  assert.match(beforeLine, /#task.*A/);
  // Same-note dependency commit inserting a generated BLOCKS line above the
  // reviewed row plus a freshness stamp on the reviewed task itself.
  const snapshotLines = String(picker.reviewOriginContent).split("\n");
  assert.equal(snapshotLines[picker.reviewLineIndex], beforeLine);
  constReviewedIndex = picker.reviewLineIndex;
  const edited = snapshotLines.slice();
  edited.splice(constReviewedIndex, 0, "\t- \u{1f9f1} **BLOCKS:** [[#^a]]");
  const shiftedTaskIdx = constReviewedIndex + 1;
  edited[shiftedTaskIdx] = `${edited[shiftedTaskIdx]} [fresh:: ${DATE}]`;
  editor.content = edited.join("\n");
  const seen = [];
  const realContinue = plugin.continueReviewWalkAfter.bind(plugin);
  plugin.continueReviewWalkAfter = async (origin, outcome) => {
    seen.push({ origin, outcome });
    return realContinue(origin, outcome);
  };
  picker.settleReviewOrigin();
  await flushAll(plugin);
  assert.equal(seen.length, 1, "settled exactly once");
  const outcome = seen[0].outcome;
  assert.ok(outcome && outcome.kind === "card", "card outcome");
  assert.equal(outcome.beforeLine, beforeLine, "beforeLine stays pre-write");
  assert.match(outcome.afterLine, /#task.*A/, "afterLine names the reviewed task, not BLOCKS");
  assert.doesNotMatch(outcome.afterLine, /BLOCKS/);
  assert.match(outcome.afterLine, new RegExp(`\\[fresh:: ${DATE}\\]`));
  assert.equal(outcome.handledRefs.length, 1);
  assert.equal(outcome.handledRefs[0].line, constReviewedIndex, "handledRefs keep original coordinates");
  assert.equal(plugin.reviewLanding.key, "walk.md:3", "advances exactly once to B");
  assert.match(editor.content, /BLOCKS/);
  assert.match(editor.content, new RegExp(`A.*\\[fresh:: ${DATE}\\]`));
  // Repeat settlement is idempotent: the origin lock is already released.
  picker.settleReviewOrigin();
  await flushAll(plugin);
  assert.equal(seen.length, 1, "second settle is a no-op");
});

test("review settle follows a BLOCKS deletion above without advancing on a non-resolving edit", async () => {
  const rows = [
    laneEntry({ tier: "next", path: "walk.md", line: 2, text: "A", rank: 1, tierRank: 1, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 3, text: "B", rank: 2, tierRank: 2, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 4, text: "C", rank: 3, tierRank: 3, tierTotal: 3 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin } = fixture;
  const editor = fixture.editors.get("walk.md");
  editor.setCursor(1, 0);
  await land(fixture, "first");
  // Open the card with a BLOCKS line already above the reviewed row, then
  // delete it (prerequisite removal): the reviewed task shifts up but stays.
  const withBlocks = String(editor.content).split("\n");
  withBlocks.splice(1, 0, "\t- \u{1f9f1} **BLOCKS:** [[#^a]]");
  editor.content = withBlocks.join("\n");
  editor.setCursor(2, 0);
  // Re-land so the landing text matches the shifted row for capture.
  plugin.reviewLanding = null;
  await land(fixture, "first");
  const picker = openCard(fixture, priorityConfig());
  const atOpen = String(editor.content).split("\n");
  const openIdx = picker.reviewLineIndex;
  assert.match(atOpen[openIdx], /#task.*A/);
  // Delete the BLOCKS line above: no freshness Write, so the edit stays.
  const afterDelete = atOpen.slice();
  afterDelete.splice(openIdx - 1, 1);
  editor.content = afterDelete.join("\n");
  const seen = [];
  const realContinue = plugin.continueReviewWalkAfter.bind(plugin);
  plugin.continueReviewWalkAfter = async (origin, outcome) => {
    seen.push({ origin, outcome });
    return realContinue(origin, outcome);
  };
  const landingBefore = plugin.reviewLanding.key;
  picker.settleReviewOrigin();
  await flushAll(plugin);
  assert.equal(seen.length, 1);
  const outcome = seen[0].outcome;
  // Non-resolving deletion stays on the same landing.
  if (outcome === null) {
    assert.equal(plugin.reviewLanding.key, landingBefore, "unidentified deletion stays");
  } else {
    assert.equal(outcome.kind, "card");
    assert.match(outcome.afterLine, /#task.*A/);
    assert.doesNotMatch(outcome.afterLine, /BLOCKS/);
    assert.equal(plugin.reviewLanding.key, landingBefore, "non-resolving shift stays");
  }
});

test("review settle never substitutes the cursor line and shares the inbox fallback reader", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const picker = openCard(fixture, priorityConfig());
  const beforeLine = picker.reviewBeforeLine;
  const snapshotLines = String(picker.reviewOriginContent).split("\n");
  const idx = picker.reviewLineIndex;
  // Insert BLOCKS above and move the cursor to the other task: the reader
  // must still return the reviewed row, never the cursor line.
  const edited = snapshotLines.slice();
  edited.splice(idx, 0, "\t- \u{1f9f1} **BLOCKS:** [[#^one]]");
  edited[idx + 1] = `${edited[idx + 1]} [fresh:: ${DATE}]`;
  picker.editor.content = edited.join("\n");
  const afterLine = helpers.readReviewOriginAfterLine(picker);
  assert.match(afterLine, /#task.*One/);
  assert.doesNotMatch(afterLine, /BLOCKS/);
  // Deleting the reviewed row settles conservatively with no resolving outcome.
  const deleted = snapshotLines.slice();
  deleted.splice(idx, 1);
  picker.editor.content = deleted.join("\n");
  assert.equal(helpers.readReviewOriginAfterLine(picker), null);
});

function fakeOriginModal(snapshotLines, currentLines, reviewLineIndex) {
  const current = currentLines.join("\n");
  return {
    reviewLineIndex,
    reviewOriginContent: snapshotLines.join("\n"),
    editor: {
      getValue: () => current,
      getLine: (line) => currentLines[line] ?? null,
    },
    getEditorContent: () => current,
  };
}

test("review origin reader resolves an ID'd row after it regroups past larger blocks", () => {
  const snapshot = [
    "# Note",
    "- [ ] #task Keep ^keep",
    "- [ ] #task Fix flicker ^abc",
    "- [ ] #task Later one",
    "- [ ] #task Later two",
    "- [ ] #task Later three",
    "  - child note one",
    "  - child note two",
  ];
  const current = [
    "# Note",
    "- [ ] #task Keep ^keep",
    "- [ ] #task Later one",
    "- [ ] #task Later two",
    "- [ ] #task Later three",
    "  - child note one",
    "  - child note two",
    "- [?] #task Fix flicker [scheduled:: 2026-11-20] ^abc",
  ];
  const after = helpers.readReviewOriginAfterLine(fakeOriginModal(snapshot, current, 2));
  assert.ok(after && after.includes("^abc"), `moved ID'd row resolves, saw: ${after}`);
  assert.match(after, /\[scheduled:: 2026-11-20\]/);
});

test("review origin reader stays null for duplicate or missing block IDs", () => {
  const snapshot = ["# Note", "- [ ] #task Fix flicker ^dup", "- [ ] #task Other"];
  const duplicated = [
    "# Note",
    "- [ ] #task Fix flicker ^dup",
    "- [ ] #task Copy ^dup",
    "- [ ] #task Other",
  ];
  assert.equal(
    helpers.readReviewOriginAfterLine(fakeOriginModal(snapshot, duplicated, 1)),
    null,
    "duplicate block ID stays null even when the old index still looks similar",
  );
  const missing = ["# Note", "- [ ] #task Fix flicker", "- [ ] #task Other"];
  assert.equal(
    helpers.readReviewOriginAfterLine(fakeOriginModal(snapshot, missing, 1)),
    null,
    "missing block ID stays null even when the old index still looks similar",
  );
});

test("review origin reader falls back to a unique alignment key for ID-less rows", () => {
  const snapshot = [
    "# Note",
    "- [ ] #task Small row",
    "- [ ] #task Later one",
    "- [ ] #task Later two with child",
    "  - child one",
    "  - child two",
    "- [ ] #task Later three with child",
    "  - child three",
    "  - child four",
  ];
  const current = [
    "# Note",
    "- [ ] #task Later one",
    "- [ ] #task Later two with child",
    "  - child one",
    "  - child two",
    "- [ ] #task Later three with child",
    "  - child three",
    "  - child four",
    "- [?] #task Small row [scheduled:: 2026-11-20]",
  ];
  const after = helpers.readReviewOriginAfterLine(fakeOriginModal(snapshot, current, 1));
  assert.ok(after && after.includes("Small row"), `unique key match resolves, saw: ${after}`);
  assert.match(after, /\[scheduled:: 2026-11-20\]/);
});

test("review origin reader stays null for a duplicated ID-less key", () => {
  const snapshot = [
    "# Note",
    "- [ ] #task Small row",
    "- [ ] #task Later one",
    "- [ ] #task Later two with child",
    "  - child one",
    "  - child two",
  ];
  const duplicatedFinal = [
    "# Note",
    "- [ ] #task Later one",
    "- [ ] #task Later two with child",
    "  - child one",
    "  - child two",
    "- [?] #task Small row [scheduled:: 2026-11-20]",
    "- [ ] #task Small row",
  ];
  assert.equal(
    helpers.readReviewOriginAfterLine(fakeOriginModal(snapshot, duplicatedFinal, 1)),
    null,
    "duplicated final key stays null when the moved row is unpaired",
  );
  const duplicatedSnapshot = [
    "# Note",
    "- [ ] #task Small row",
    "- [ ] #task Small row",
    "- [ ] #task Later one",
    "- [ ] #task Later two with child",
    "  - child one",
    "  - child two",
  ];
  const moved = [
    "# Note",
    "- [ ] #task Later one",
    "- [ ] #task Later two with child",
    "  - child one",
    "  - child two",
    "- [?] #task Small row [scheduled:: 2026-11-20]",
  ];
  assert.equal(
    helpers.readReviewOriginAfterLine(fakeOriginModal(duplicatedSnapshot, moved, 1)),
    null,
    "duplicated snapshot key stays null when the moved row is unpaired",
  );
});

test("review origin reader stays null for a reworded ID-less row", () => {
  const snapshot = ["# Note", "- [ ] #task Original wording", "- [ ] #task Other"];
  const current = ["# Note", "- [ ] #task Other", "- [ ] #task Reworded text"];
  assert.equal(
    helpers.readReviewOriginAfterLine(fakeOriginModal(snapshot, current, 1)),
    null,
    "a reword changes the key and stays",
  );
});

test("reviewWalk v2 follow parks, holds the lock until landing, and shows one toast", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two", "Three"]),
    activePath: "walk.md",
  });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && !origin.busy, "an origin is captured");
  const firstText = plugin.reviewLanding.text;
  let busyDuringLand = null;
  const landCalls = [];
  const recordedAnswers = [];
  plugin.recordReviewAnswer = (...args) => recordedAnswers.push(args);
  plugin.landOnTask = async (target, options) => {
    landCalls.push({ target, options });
    busyDuringLand = plugin.reviewWalkBusy();
    return { ok: true, line: 0 };
  };
  clearNotices();
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "complete",
    handledRefs: [{ path: "walk.md", line: 0, raw: firstText }],
    notice: "✓ Done · One",
    follow: {
      path: "dest.md",
      text: "- [ ] #task Dest ^dest",
      label: "Dest",
    },
  });
  assert.deepEqual(result, {
    ok: true,
    advanced: false,
    parked: true,
    landed: true,
  });
  assert.equal(landCalls.length, 1);
  assert.equal(landCalls[0].options && landCalls[0].options.silent, true);
  assert.equal(busyDuringLand, true, "the lock is held until landing");
  assert.equal(plugin.reviewWalkBusy(), false, "the lock is free after landing");
  assert.equal(plugin.reviewLanding, null, "the landing is consumed");
  assert.ok(plugin.reviewAnsweredKeys.keys.has(origin.key), "the close enters today's answered set");
  assert.equal(recordedAnswers.length, 1, "the close is journaled once");
  assert.equal(recordedAnswers[0][1].kind, "complete");
  assert.equal(recordedAnswers[0][2][0].key, origin.key);
  assert.deepEqual(notices, ["✓ Done · One\n↗ “Dest”"]);
  plugin.advanceReviewClock(400);
  clearNotices();
  assert.equal(await plugin.jumpToDueTask(1), true);
  assert.equal(
    plugin.reviewLanding.text,
    markFor("next", "Two"),
    "the next ]s resumes at the neighbour",
  );
});

test("reviewWalk v2 follow lands without parking or recording a non-resolving outcome", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  const landingKey = plugin.reviewLanding.key;
  const recordedAnswers = [];
  const landCalls = [];
  plugin.recordReviewAnswer = (...args) => recordedAnswers.push(args);
  plugin.landOnTask = async (target) => {
    landCalls.push(target);
    return { ok: true, line: 0 };
  };
  clearNotices();
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "noop",
    notice: "Relation complete · another task",
    follow: { path: "dest.md", label: "Dest" },
  });
  assert.deepEqual(result, { ok: true, advanced: false, parked: false, landed: true });
  assert.equal(plugin.reviewLanding.key, landingKey, "the unanswered row remains landed");
  assert.equal(plugin.reviewAnsweredKeys.keys.has(origin.key), false, "no answer key is recorded");
  assert.deepEqual(recordedAnswers, []);
  assert.equal(landCalls.length, 1, "explicit follow intent still lands");
  assert.deepEqual(notices, ["Relation complete · another task\n↗ “Dest”"]);
});

test("reviewWalk v2 follow applies the PRE/POST complete exception", async () => {
  const fixture = makePlugin({
    rows: [
      laneEntry({ tier: "pre", path: "walk.md", line: 1, text: "Prep", rank: 1, tierRank: 1, tierTotal: 1 }),
    ],
    activePath: "walk.md",
  });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  const landingKey = plugin.reviewLanding.key;
  const recordedAnswers = [];
  plugin.recordReviewAnswer = (...args) => recordedAnswers.push(args);
  plugin.landOnTask = async () => ({ ok: true, line: 0 });
  assert.equal(helpers.reviewOutcomeResolves("pre", { kind: "complete" }, DATE), true);
  clearNotices();
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "complete",
    notice: "✓ Done · Prep",
    follow: { path: "dest.md", label: "Dest" },
  });
  assert.deepEqual(result, { ok: true, advanced: false, parked: false, landed: true });
  assert.equal(plugin.reviewLanding.key, landingKey, "PRE completion leaves the walk answer untouched");
  assert.equal(plugin.reviewAnsweredKeys.keys.has(origin.key), false);
  assert.deepEqual(recordedAnswers, []);
  assert.deepEqual(notices, ["✓ Done · Prep\n↗ “Dest”"]);
});

test("reviewWalk v2 follow still lands on a stale origin without parking", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"]),
    activePath: "walk.md",
  });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && !origin.busy, "an origin is captured");
  const landingKey = plugin.reviewLanding.key;
  plugin.reviewLandingEpoch += 1;
  const landCalls = [];
  plugin.landOnTask = async (target) => {
    landCalls.push(target);
    return { ok: true, line: 2 };
  };
  clearNotices();
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "complete",
    notice: "✓ Done · One",
    follow: { path: "dest.md", label: "Dest" },
  });
  assert.deepEqual(result, {
    ok: true,
    advanced: false,
    parked: false,
    landed: true,
  });
  assert.equal(landCalls.length, 1);
  assert.equal(plugin.reviewLanding.key, landingKey, "stale follow does not park");
  assert.deepEqual(notices, ["✓ Done · One\n↗ “Dest”"]);
});

test("reviewWalk v2 follow parks even when the jump target is lost", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"]),
    activePath: "walk.md",
  });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && !origin.busy, "an origin is captured");
  const firstText = plugin.reviewLanding.text;
  clearNotices();
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "complete",
    handledRefs: [{ path: "walk.md", line: 0, raw: firstText }],
    notice: "✓ Done · One",
    follow: { path: "gone.md", label: "Dest" },
  });
  assert.deepEqual(result, {
    ok: true,
    advanced: false,
    parked: true,
    landed: false,
  });
  assert.equal(plugin.reviewLanding, null, "the landing is consumed");
  assert.deepEqual(notices, [
    "✓ Done · One\nCouldn't find “Dest” to jump to — your changes are saved",
  ]);
  plugin.advanceReviewClock(400);
  clearNotices();
  assert.equal(await plugin.jumpToDueTask(1), true);
  assert.equal(
    plugin.reviewLanding.text,
    markFor("next", "Two"),
    "the next ]s resumes at the neighbour",
  );
});

test("reviewWalk continue without follow stays on the v1 result", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"]),
    activePath: "walk.md",
  });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  const firstText = plugin.reviewLanding.text;
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: firstText }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(result, { ok: true, advanced: true, stopped: false });
  assert.equal("parked" in result, false);
  assert.equal("landed" in result, false);
  assert.equal(plugin.reviewLanding.text, markFor("next", "Two"));
});
