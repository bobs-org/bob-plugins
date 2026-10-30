// Sequence feedback: summary card model/actions, sticky replacement, and focus output.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BobCommandModePlugin,
  helpers,
  installDocument,
  makeApp,
  fixtureCatalog,
  takeToastNotices,
} = require("./command-mode-harness.cjs");

const NOW = Date.parse("2026-10-26T15:00:00.000Z");
const STEPS = [
  { argv: ["plan"], entry_id: "plan", title: "Today's plan" },
  { argv: ["ready"], entry_id: "ready", title: "Ready lanes" },
  { argv: ["plan", "budget"], entry_id: "plan-budget", title: "Plan budget" },
];

function summary(overrides = {}) {
  return {
    id: "seq-one",
    signature: helpers.cmSequenceSignature(STEPS),
    steps: STEPS,
    total: 3,
    outcome: "completed",
    stoppedAt: null,
    results: [
      { index: 1, runId: "run-1", outcome: "completed", durationMs: 1400 },
      { index: 2, runId: "run-2", outcome: "completed", durationMs: 2200 },
      { index: 3, runId: "run-3", outcome: "completed", durationMs: 800 },
    ],
    startedAtMs: NOW - 4400,
    finishedAtMs: NOW,
    durationMs: 4400,
    ...overrides,
  };
}

test("summary model covers completed, attention, halted, and stopped sequences", () => {
  const completed = helpers.cmSequenceToastModel(summary(), fixtureCatalog());
  assert.equal(completed.tone, "completed");
  assert.equal(completed.title, "Sequence · 3 commands");
  assert.deepEqual(completed.actions.map((action) => action.id), ["output", "rerun", "copy"]);
  assert.equal(completed.focusRunId, "run-3");

  const attention = helpers.cmSequenceToastModel(summary({ outcome: "attention" }), fixtureCatalog());
  assert.equal(attention.tone, "attention");
  assert.match(attention.title, /needs attention/);
  assert.equal(attention.sticky, false);

  const halted = helpers.cmSequenceToastModel(summary({
    outcome: "failed",
    stoppedAt: 2,
    results: [
      { index: 1, runId: "run-1", outcome: "completed", durationMs: 1400 },
      { index: 2, runId: "run-2", outcome: "failed", reason: "Commit pending edits first\nadditional detail", durationMs: 2200 },
      { index: 3, skipped: true },
    ],
  }), fixtureCatalog());
  assert.equal(halted.title, "Sequence stopped at step 2 of 3");
  assert.deepEqual(halted.actions.map((action) => action.label), ["Output", "Resume from 2", "Rerun all", "Copy"]);
  assert.equal(halted.lines[1].reason, "Commit pending edits first");
  assert.equal(halted.lines[2].duration, "skipped");
  assert.equal(halted.focusRunId, "run-2");
  assert.equal(halted.sticky, true);

  const stopped = helpers.cmSequenceToastModel(summary({
    outcome: "stopped",
    stoppedAt: 1,
    results: [
      { index: 1, runId: "run-1", outcome: "stopped", reason: "Stopped by user", durationMs: 900 },
      { index: 2, skipped: true },
      { index: 3, skipped: true },
    ],
  }), fixtureCatalog());
  assert.equal(stopped.tone, "stopped");
  assert.equal(stopped.lines[0].glyph, "■");
  assert.equal(stopped.actions[1].id, "resume");
});

test("summary card renders accessible rows and routes the body to its focus run", () => {
  const restore = installDocument({ focused: true });
  try {
    const model = helpers.cmSequenceToastModel(summary({ outcome: "failed", stoppedAt: 2 }), fixtureCatalog());
    const outputs = [];
    const actions = [];
    const fragment = helpers.cmCreateSequenceToastFragment(model, (action) => actions.push(action.id), (runId) => outputs.push(runId));
    const card = fragment.children[0];
    assert.equal(card.getAttribute("role"), "status");
    assert.equal(card.getAttribute("aria-live"), "assertive");
    const body = card.children.find((child) => child.classList.contains("bob-cmd-toast-sequence-body"));
    body.listeners.click({ defaultPrevented: false });
    assert.deepEqual(outputs, ["run-2"]);
    const buttons = card.children.find((child) => child.classList.contains("bob-cmd-toast-actions")).children;
    buttons[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(actions, ["resume"]);
  } finally {
    restore();
  }
});

test("resume keeps the sequence id and skips completed steps; rerun gets a new id", async () => {
  let clock = NOW;
  let sequenceCounter = 0;
  const calls = [];
  const runner = {
    deps: { nowMs: () => clock++, random: () => (++sequenceCounter) / 10 },
    catalog: () => fixtureCatalog(),
    run: async (argv, options) => {
      calls.push({ argv, options });
      return { ok: true, runId: "new-run-" + calls.length, outcome: "completed" };
    },
  };
  const plugin = new BobCommandModePlugin(makeApp());
  plugin.commandModeRunner = runner;
  plugin.commandModeStickyNotices = new Map();
  plugin.commandModeSequenceFinished = () => {};
  const halted = summary({
    id: "seq-resume",
    outcome: "failed",
    stoppedAt: 2,
    results: [
      { index: 1, runId: "run-1", outcome: "completed", durationMs: 1400 },
      { index: 2, runId: "run-2", outcome: "failed", durationMs: 2200 },
      { index: 3, skipped: true },
    ],
  });
  const model = helpers.cmSequenceToastModel(halted, fixtureCatalog());

  const resumed = await plugin.commandModeRunSequenceToastAction({ id: "resume" }, model);
  assert.equal(resumed.id, "seq-resume");
  assert.deepEqual(calls.map((call) => call.argv), [["ready"], ["plan", "budget"]]);
  assert.deepEqual(calls.map((call) => call.options.sequence.index), [2, 3]);
  assert.ok(calls.every((call) => call.options.sequence.id === "seq-resume"));

  calls.length = 0;
  const rerun = await plugin.commandModeRunSequenceToastAction({ id: "rerun" }, model);
  assert.notEqual(rerun.id, "seq-resume");
  assert.deepEqual(calls.map((call) => call.argv), [["plan"], ["ready"], ["plan", "budget"]]);
  assert.deepEqual(calls.map((call) => call.options.sequence.index), [1, 2, 3]);
});

test("Output opens the focus run and Copy writes the sequence shell line", async () => {
  const model = helpers.cmSequenceToastModel(summary({ outcome: "failed", stoppedAt: 2 }), fixtureCatalog());
  const plugin = new BobCommandModePlugin(makeApp());
  plugin.commandModeRunner = { catalog: () => fixtureCatalog() };
  const opened = [];
  plugin.commandModeOpenOutput = (runId) => { opened.push(runId); return { ok: true, runId }; };
  const output = await plugin.commandModeRunSequenceToastAction({ id: "output" }, model);
  assert.equal(output.runId, "run-2");
  assert.deepEqual(opened, ["run-2"]);

  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copied = [];
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (text) => copied.push(text) } },
    configurable: true,
    writable: true,
  });
  try {
    const copy = await plugin.commandModeRunSequenceToastAction({ id: "copy" }, model);
    assert.equal(copy.ok, true);
    assert.deepEqual(copied, ["bob plan && bob ready && bob plan budget"]);
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, "navigator", previousDescriptor);
    else delete globalThis.navigator;
  }
});

test("a repeated sticky sequence card replaces the previous card by signature", () => {
  const restore = installDocument({ focused: true });
  try {
    takeToastNotices();
    const plugin = new BobCommandModePlugin(makeApp());
    plugin.settings = { osNotifications: false };
    plugin.commandModeRunner = { catalog: () => fixtureCatalog() };
    plugin.commandModeStickyNotices = new Map();
    const failed = summary({ outcome: "failed", stoppedAt: 2 });
    plugin.commandModeSequenceFinished(failed);
    const first = takeToastNotices()[0];
    assert.equal(first.hidden, false);
    plugin.commandModeSequenceFinished({ ...failed, id: "seq-two" });
    const second = takeToastNotices()[0];
    assert.equal(first.hidden, true);
    assert.equal(second.hidden, false);
    assert.equal(plugin.commandModeStickyNotices.get("sequence:" + failed.signature), second);
  } finally {
    restore();
  }
});
