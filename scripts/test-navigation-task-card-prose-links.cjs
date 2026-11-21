// Task Card prose links (phase bob-cli-om.5): the reason stages S7-S10 opt
// into the LINK band through the shared picker wiring, and S11 completes
// `[[` only in the scheduled stage's inline reason tail.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  createBulletPropertyPickerHarness,
  runCardAction,
  buildScheduleReasonConfig,
} = require("./navigation-hotkeys-harness.cjs");

function note(path, extra = {}) {
  const stem = path.split("/").pop().replace(/\.md$/, "");
  return {
    path,
    tier: extra.tier || "living",
    insertTarget: path.replace(/\.md$/, ""),
    stem,
    aliases: extra.aliases || [],
    headings: extra.headings || [{ title: "Overview", level: 2, ordinal: 0 }],
    blocks: extra.blocks || [],
    inbound: extra.inbound || 0,
  };
}

const NOTES = [
  note("sase.md", { inbound: 4 }),
  note("sase_blog.md"),
  note("projects/api.md", { inbound: 2 }),
];

const NO_NEARBY = { parentPaths: [], linkedPaths: [], recentPaths: [] };

function makeLogsApi(phrasesByKind = {}) {
  const logs = Object.entries(phrasesByKind).map(([kind, texts]) => ({
    kind,
    phrases: texts.map((text, index) => ({
      text,
      key: String(text).toLowerCase(),
      uses: texts.length - index,
      last_used: "2026-11-19",
      score: texts.length - index,
      recency_rank: index,
      match: null,
    })),
  }));
  const snapshot = { schema_version: 1, ok: true, overlay: {}, logs };
  return {
    snapshot: () => snapshot,
    fetch: async () => ({ status: "ok", catalog: snapshot, fetchedAt: Date.now() }),
    onChange: () => () => {},
    noteUsed: () => true,
  };
}

// A nav api stand-in whose logRecall and proseField attach the real
// controllers with an injected note table. `attached` records every
// options object a host passed, so tests can check the wiring.
function appWithProse(options = {}) {
  const attached = [];
  const logsApi = makeLogsApi(options.phrases || {});
  const nav = { version: 3 };
  if (options.logRecall !== false) {
    nav.logRecall = {
      version: 1,
      attach: (opts) => {
        attached.push({ api: "logRecall", opts });
        return helpers.attachLogRecall({ ...opts, logsApi, notes: NOTES, hintDebounceMs: 0, ...NO_NEARBY });
      },
      noteUsed: () => true,
    };
  }
  if (options.proseField !== false) {
    nav.proseField = {
      version: 1,
      attach: (opts) => {
        attached.push({ api: "proseField", opts });
        return helpers.attachProseField({ ...opts, notes: NOTES, hintDebounceMs: 0, ...NO_NEARBY });
      },
    };
  }
  const app = {
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": { api: nav },
        "bob-ledger-tools": { api: { logs: logsApi } },
      },
    },
  };
  return { app, attached };
}

function key(target, name, modifiers = {}) {
  return {
    key: name,
    target,
    isComposing: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

function typeInto(inputEl, value, inputType = "insertText") {
  inputEl.value = value;
  inputEl.selectionStart = value.length;
  inputEl.selectionEnd = value.length;
  for (const handler of [...((inputEl._listeners && inputEl._listeners.input) || [])]) {
    handler.call(inputEl, { type: "input", inputType, isComposing: false, target: inputEl });
  }
}

function keyup(inputEl, name) {
  for (const handler of [...((inputEl._listeners && inputEl._listeners.keyup) || [])]) {
    handler.call(inputEl, { type: "keyup", key: name, target: inputEl });
  }
}

function openHarness(content, app, extra = {}) {
  const harness = createBulletPropertyPickerHarness({
    config: extra.config || buildScheduleReasonConfig(),
    content,
    cursor: { line: 0, ch: 0 },
    baseDate: new Date(2026, 9, 2),
    now: new Date(2026, 9, 2, 14, 32),
    app,
  });
  assert.equal(harness.open(), true);
  return { harness, picker: harness.plugin.activeBulletPropertyPicker };
}

test("scheduledReasonLinkMinOffset opens only after a recognized date token", () => {
  const min = helpers.scheduledReasonLinkMinOffset;
  assert.equal(min("3 waiting on [[api"), 2);
  assert.equal(min("3"), 1);
  assert.equal(min("3   waiting"), 4);
  assert.equal(min("  mon waiting"), 6);
  assert.equal(min("2026-11-21 [[x"), 11);
  assert.equal(min("+2w see [[x"), 4);
  assert.equal(min("6/24 [[x"), 5);
  assert.equal(min(""), Infinity);
  assert.equal(min("[[api"), Infinity);
  assert.equal(min("tomorrow [[api"), Infinity);
  assert.equal(min("3x [[api"), Infinity);
  assert.equal(min("monitor [[api"), Infinity);
});

test("minOffset Infinity never opens a field, an alias, or a hint", () => {
  assert.equal(helpers.proseFieldAt("[[sas", 5, { minOffset: Infinity }), null);
  assert.equal(helpers.proseFieldAt("[[sas", 5, { minOffset: () => Infinity }), null);
  assert.ok(helpers.proseFieldAt("[[sas", 5, { minOffset: 0 }));
  assert.equal(helpers.proseAliasAt("[[sase|lab", 10, { minOffset: Infinity }), null);
  assert.ok(helpers.proseAliasAt("[[sase|lab", 10, { minOffset: 0 }));
  assert.ok(helpers.proseAliasAt("[[sase|lab", 10));
  assert.ok(helpers.proseFieldAt("3 [[sas", 7, { minOffset: 2 }));
  assert.equal(helpers.proseFieldAt("3 [[sas", 7, { minOffset: 3 }), null);
  const links = helpers.proseCompleteLinks("a [[x]] b [[y]]");
  assert.deepEqual(links.map((link) => link.start), [2, 10]);
});

test("pickerProseSourcePath resolves the task's note", () => {
  const source = helpers.pickerProseSourcePath;
  assert.equal(source({ filePath: "Areas/Work.md", isLinkSession: () => false }), "Areas/Work.md");
  assert.equal(source({ filePath: "", isLinkSession: () => false }), null);
  const linkPicker = (paths) => ({
    filePath: "2026/2026-11-21.md",
    isLinkSession: () => true,
    linkSession: { resolved: paths.map((path, line) => ({ path, line })) },
  });
  assert.equal(source(linkPicker(["sase.md", "sase.md"])), "sase.md");
  assert.equal(source(linkPicker(["sase.md", "api.md"])), null);
  assert.equal(source(null), null);
});

test("S7 cancel reason: [[ completes, Enter inserts without submitting", async () => {
  const { app, attached } = appWithProse({ phrases: { cancel: ["duplicate task"] } });
  const { harness, picker } = openHarness("- [ ] #task One ^a", app);
  const payloads = [];
  harness.plugin.applyTaskCancelFromPicker = async (_picker, payload) => {
    payloads.push(payload);
    return true;
  };
  await runCardAction(picker, "cancel");
  assert.equal(picker.stage, "cancel-reason");
  const wiring = attached.find((entry) => entry.opts.kind === "cancel");
  assert.ok(wiring, "cancel stage attached");
  assert.equal(wiring.opts.links, true);
  assert.equal(wiring.opts.sourcePath(), "Tasks.md");
  const handle = picker.logRecallHandle;
  assert.equal(typeof handle.isLinkOpen, "function", "a proseField handle");

  typeInto(picker.inputEl, "dup of [[sas");
  assert.equal(handle.isLinkOpen(), true);
  // Arrows and Ctrl+N/P move the band selection before row navigation.
  const down = key(picker.inputEl, "ArrowDown");
  picker.handleKeydown(down);
  assert.equal(down.defaultPrevented, true);
  picker.handleKeydown(key(picker.inputEl, "p", { ctrlKey: true }));
  assert.equal(picker.inputEl.value, "dup of [[sas", "Ctrl+P stays in the band, no recall fill");
  const enter = key(picker.inputEl, "Enter");
  picker.handleKeydown(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(picker.inputEl.value, "dup of [[sase]]");
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(picker.stage, "cancel-reason");
  assert.deepEqual(payloads, []);

  // A held Enter cannot accept and then save.
  picker.handleKeydown(key(picker.inputEl, "Enter", { repeat: true }));
  assert.deepEqual(payloads, []);
  keyup(picker.inputEl, "Enter");

  typeInto(picker.inputEl, "dup of [[sase]]", "insertReplacementText");
  picker.handleKeydown(key(picker.inputEl, "Enter"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].reason, "dup of [[sase]]");
});

test("S7 Esc and Ctrl+[ close only the band; recall still backs out after", async () => {
  const { app } = appWithProse({ phrases: { cancel: ["duplicate task"] } });
  const { picker } = openHarness("- [ ] #task One ^a", app);
  await runCardAction(picker, "cancel");
  const handle = picker.logRecallHandle;
  typeInto(picker.inputEl, "see [[sas");
  assert.equal(handle.isLinkOpen(), true);
  const esc = key(picker.inputEl, "Escape");
  picker.handleKeydown(esc);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(picker.inputEl.value, "see [[sas");
  assert.equal(picker.pickerOpen, true);

  typeInto(picker.inputEl, "see [[sa");
  assert.equal(handle.isLinkOpen(), true);
  const chord = key(picker.inputEl, "[", { ctrlKey: true, code: "BracketLeft" });
  picker.handleKeydown(chord);
  assert.equal(chord.defaultPrevented, true);
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(picker.pickerOpen, true);

  // Band closed: recall keeps its keys.
  typeInto(picker.inputEl, "dup", "insertText");
  picker.handleKeydown(key(picker.inputEl, "n", { ctrlKey: true }));
  assert.equal(picker.inputEl.value, "duplicate task");
  picker.handleKeydown(key(picker.inputEl, "Escape"));
  assert.equal(picker.inputEl.value, "dup");
  picker.close();
});

test("S8 lane release and S9 Work summary attach links with the picker's note", async () => {
  const { app, attached } = appWithProse({ phrases: { work: ["athena agent"] } });
  const lane = openHarness("- [/] #task Working ^a1", app, {
    config: helpers.validateBulletPropertyConfig({ properties: [{ name: "scheduled", values: "date" }] }),
  });
  await runCardAction(lane.picker, "lane");
  assert.equal(lane.picker.stage, "lane-release-reason");
  const laneWiring = attached.filter((entry) => entry.opts.kind === "work").pop();
  assert.equal(laneWiring.opts.links, true);
  assert.equal(laneWiring.opts.sourcePath(), "Tasks.md");
  typeInto(lane.picker.inputEl, "parked on [[api");
  assert.equal(lane.picker.logRecallHandle.isLinkOpen(), true);
  lane.picker.handleKeydown(key(lane.picker.inputEl, "Tab"));
  assert.equal(lane.picker.inputEl.value, "parked on [[projects/api]]");
  assert.equal(lane.picker.stage, "lane-release-reason");
  lane.picker.close();

  const work = openHarness("- [/] #task Pending work ^a", app);
  let captured = null;
  work.picker.showSchedulingWorkLogStage({
    title: "Schedule task",
    resume: async (summary) => { captured = summary; return true; },
    eligibleCount: 1,
    totalCount: 1,
    scheduleSummary: "scheduled → 2026-10-05",
  });
  assert.equal(work.picker.stage, "schedule-work-log");
  typeInto(work.picker.inputEl, "drafted [[sase_b");
  assert.equal(work.picker.logRecallHandle.isLinkOpen(), true);
  work.picker.handleKeydown(key(work.picker.inputEl, "Enter"));
  assert.equal(work.picker.inputEl.value, "drafted [[sase_blog]]");
  assert.equal(captured, null);
  keyup(work.picker.inputEl, "Enter");
  work.picker.renderResults();
  await work.picker.openItemAtIndex(0);
  assert.equal(captured, "drafted [[sase_blog]]");

  // Alt+P keeps priority over an open band: it is the stage's one-key commit.
  const quick = openHarness("- [/] #task Pending work ^a", app);
  let quickCaptured = null;
  quick.picker.showSchedulingWorkLogStage({
    title: "Schedule task",
    resume: async (summary) => { quickCaptured = summary; return true; },
    eligibleCount: 1,
    totalCount: 1,
    scheduleSummary: "scheduled → 2026-10-05",
  });
  typeInto(quick.picker.inputEl, "drafted [[sase_b");
  assert.equal(quick.picker.logRecallHandle.isLinkOpen(), true);
  quick.picker.handleKeydown(key(quick.picker.inputEl, "p", { altKey: true, code: "KeyP" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quickCaptured, "drafted [[sase_b");
});

test("S10 schedule review: Tab accepts while open, cycles fields while closed", async () => {
  const { app } = appWithProse({ phrases: { schedule: ["replan soon"], work: ["athena agent"] } });
  const { picker } = openHarness("- [/] #task Pending work ^a", app);
  await runCardAction(picker, "schedule");
  const dateItem = picker.visibleItems.find((item) => item.kind === "value" && item.value);
  await picker.openItem(dateItem);
  assert.equal(picker.stage, "schedule-review");
  const reasonEl = picker.scheduleReviewReasonEl;
  const summaryEl = picker.scheduleReviewSummaryEl;
  assert.ok(reasonEl && summaryEl);
  const reasonHandle = picker.logRecallHandle;

  typeInto(reasonEl, "blocked on [[api");
  assert.equal(reasonHandle.isLinkOpen(), true);
  picker.handleKeydown(key(reasonEl, "Tab"));
  assert.equal(reasonEl.value, "blocked on [[projects/api]]");
  assert.equal(picker.logRecallHandle, reasonHandle, "Tab accepted, focus stayed");

  // Refocusing the bound field keeps its handle (band state survives).
  picker.switchScheduleReviewLogRecall("schedule", reasonEl);
  assert.equal(picker.logRecallHandle, reasonHandle);

  picker.handleKeydown(key(reasonEl, "Tab"));
  assert.equal(picker.logRecallKind, "work", "closed band: Tab cycles to the summary");
  const summaryHandle = picker.logRecallHandle;
  assert.notEqual(summaryHandle, reasonHandle);
  typeInto(summaryEl, "wrote [[sase_b");
  assert.equal(summaryHandle.isLinkOpen(), true);
  picker.handleKeydown(key(summaryEl, "Enter"));
  assert.equal(summaryEl.value, "wrote [[sase_blog]]");
  assert.equal(picker.stage, "schedule-review", "Enter accepted, nothing submitted");
  picker.close();
});

async function openScheduledStage(app) {
  const opened = openHarness("- [ ] #task Ready work ^ready", app);
  const writes = [];
  opened.harness.plugin.setBulletPropertyValue = async (_editor, _cursor, name, value, options) => {
    writes.push({ name, value, reason: options && options.scheduleLog && options.scheduleLog.reason });
    return true;
  };
  await runCardAction(opened.picker, "schedule");
  assert.equal(opened.picker.stage, "value");
  assert.equal(opened.picker.isScheduledValueStage(), true);
  return { ...opened, writes };
}

test("S11 completes only in the reason tail after the date token", async () => {
  const { app, attached } = appWithProse();
  const { picker, writes } = await openScheduledStage(app);
  const handle = picker.scheduledReasonLinkHandle;
  assert.ok(handle, "scheduled stage attaches proseField");
  const wiring = attached.find((entry) => entry.api === "proseField");
  assert.equal(wiring.opts.recall, null);
  assert.equal(wiring.opts.sourcePath(), "Tasks.md");

  for (const draft of ["[[sas", "tomorrow [[sas", "3x [[sas", "[[sase|la"]) {
    typeInto(picker.inputEl, draft);
    assert.equal(handle.isLinkOpen(), false, draft);
  }

  typeInto(picker.inputEl, "3 waiting on [[api");
  assert.equal(handle.isLinkOpen(), true);
  const enter = key(picker.inputEl, "Enter");
  picker.handleKeydown(enter);
  assert.equal(picker.inputEl.value, "3 waiting on [[projects/api]]");
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(picker.stage, "value");
  assert.deepEqual(writes, []);
  keyup(picker.inputEl, "Enter");

  typeInto(picker.inputEl, "3 waiting on [[projects/api]]", "insertReplacementText");
  assert.equal(picker.visibleItems[0].inlineReason, "waiting on [[projects/api]]");
  picker.handleKeydown(key(picker.inputEl, "Enter"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, "scheduled");
  assert.equal(writes[0].reason, "waiting on [[projects/api]]");
});

test("S11 band owns Shift+Enter, Ctrl+Enter, Esc, and Ctrl+[ while open", async () => {
  const { app } = appWithProse();
  const { picker, writes } = await openScheduledStage(app);
  const handle = picker.scheduledReasonLinkHandle;

  typeInto(picker.inputEl, "3 see [[sas");
  picker.handleKeydown(key(picker.inputEl, "Enter", { shiftKey: true }));
  assert.equal(picker.inputEl.value, "3 see [[sase]]");
  keyup(picker.inputEl, "Enter");

  typeInto(picker.inputEl, "3 see [[sase]] and [[sase_b");
  picker.handleKeydown(key(picker.inputEl, "Enter", { ctrlKey: true }));
  assert.equal(picker.inputEl.value, "3 see [[sase]] and [[sase_blog]]");
  keyup(picker.inputEl, "Enter");
  assert.deepEqual(writes, [], "no skip-reason commit, no recommended roll");

  typeInto(picker.inputEl, "3 see [[ap");
  assert.equal(handle.isLinkOpen(), true);
  const esc = key(picker.inputEl, "Escape");
  picker.handleKeydown(esc);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(picker.pickerOpen, true);
  assert.equal(picker.inputEl.value, "3 see [[ap");

  typeInto(picker.inputEl, "3 see [[a");
  assert.equal(handle.isLinkOpen(), true);
  picker.handleKeydown(key(picker.inputEl, "[", { ctrlKey: true, code: "BracketLeft" }));
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(picker.pickerOpen, true, "first Ctrl+[ closes only the band");
  picker.handleKeydown(key(picker.inputEl, "[", { ctrlKey: true, code: "BracketLeft" }));
  assert.equal(picker.pickerOpen, false, "second Ctrl+[ closes the card");
  assert.equal(picker.scheduledReasonLinkHandle, null, "close detaches the band");
});

test("real Escape reaches the Task Card via onEscapeKey: band first, then close", async () => {
  // Obsidian runs Modal's first-registered Escape → onEscapeKey in the capture
  // phase, before any input listener, so the card's override must back out.
  const { app } = appWithProse();
  const { picker } = await openScheduledStage(app);
  const handle = picker.scheduledReasonLinkHandle;
  typeInto(picker.inputEl, "3 see [[ap");
  assert.equal(handle.isLinkOpen(), true);
  const esc = key(picker.inputEl, "Escape");
  assert.equal(picker.onEscapeKey(esc), false);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(handle.isLinkOpen(), false);
  assert.equal(picker.pickerOpen, true, "the first Escape closes only the band");
  assert.equal(picker.inputEl.value, "3 see [[ap");
  picker.onEscapeKey(key(picker.inputEl, "Escape"));
  assert.equal(picker.pickerOpen, false, "with the band closed Escape closes the card");

  const review = openHarness("- [/] #task Pending work ^a", app).picker;
  await runCardAction(review, "schedule");
  await review.openItem(review.visibleItems.find((item) => item.kind === "value" && item.value));
  assert.equal(review.stage, "schedule-review");
  typeInto(review.scheduleReviewReasonEl, "blocked on [[api");
  assert.equal(review.logRecallHandle.isLinkOpen(), true);
  assert.equal(review.onEscapeKey(key(review.scheduleReviewReasonEl, "Escape")), false);
  assert.equal(review.logRecallHandle.isLinkOpen(), false);
  assert.equal(review.pickerOpen, true, "S10: the first Escape closes only the band");
  review.close();
});

test("S11 with the band closed keeps date rows and detaches on stage change", async () => {
  const { app } = appWithProse();
  const { picker } = await openScheduledStage(app);
  assert.ok(picker.scheduledReasonLinkHandle);
  typeInto(picker.inputEl, "3 no links here");
  const down = key(picker.inputEl, "ArrowDown");
  picker.handleKeydown(down);
  assert.equal(down.defaultPrevented, true, "date-row navigation still runs");
  picker.returnToTaskCard();
  assert.equal(picker.stage, "task-card");
  assert.equal(picker.scheduledReasonLinkHandle, null);
  picker.close();
});

test("S11 fails open without nav's proseField", async () => {
  const { app } = appWithProse({ proseField: false });
  const { picker, writes } = await openScheduledStage(app);
  assert.equal(picker.scheduledReasonLinkHandle, null);
  typeInto(picker.inputEl, "3 waiting on [[api");
  picker.handleKeydown(key(picker.inputEl, "Enter"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].reason, "waiting on [[api");
});
