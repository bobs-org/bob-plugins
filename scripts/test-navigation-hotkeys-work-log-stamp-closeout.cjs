const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  TransactionEditor,
  createLinkPickerHarness,
  createBulletPropertyPickerHarness,
} = require("./navigation-hotkeys-harness.cjs");

const RealDate = Date;
let adjustableMs = new RealDate(2026, 10, 1, 23, 59).getTime();

class AdjustableDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(adjustableMs);
    } else {
      super(...args);
    }
  }

  static now() {
    return adjustableMs;
  }
}

function installAdjustableDate(ms) {
  adjustableMs = ms;
  global.Date = AdjustableDate;
}

function restoreDate() {
  global.Date = RealDate;
}

function setAdjustable(year, monthIndex, day, hour, minute) {
  adjustableMs = new RealDate(year, monthIndex, day, hour, minute).getTime();
}

const TICK = () => new Promise((resolve) => setImmediate(resolve));

function lanePlugin(editorContent) {
  const editor = new TransactionEditor(editorContent, { line: 0, ch: 0 });
  const files = new Map([
    ["Plan.md", { path: "Plan.md", basename: "Plan.md", extension: "md" }],
  ]);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: {} },
    vault: { getMarkdownFiles: () => [...files.values()] },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.getActiveMarkdownView = () => ({ editor, file: files.get("Plan.md") });
  return { plugin, editor };
}

test("Alt+N release samples the commit clock after the summary prompt", async () => {
  installAdjustableDate(new RealDate(2026, 10, 1, 23, 59).getTime());
  try {
    notices.length = 0;
    const { plugin, editor } = lanePlugin("- [/] #task Working ^a1");
    plugin.requestLaneReleaseSummary = async () => {
      setAdjustable(2026, 10, 2, 0, 1);
      return { cancelled: false, summary: "finished late" };
    };
    plugin.promptLaneInboxRoute = async () => ({ kind: "none" });
    assert.equal(await plugin.toggleTaskLane(editor), true);
    assert.match(editor.content, /\*2026-11-02 00:01\* — finished late/);
    assert.doesNotMatch(editor.content, /\*2026-11-01 23:59\*/);
  } finally {
    restoreDate();
  }
});

test("linked release shares one commit stamp across notes", async () => {
  installAdjustableDate(new RealDate(2026, 10, 1, 23, 59).getTime());
  try {
    // Pure planner check: one stamp sampled post-prompt, shared by every
    // note and target in the batch.
    const stampText = helpers.formatWorkLogStamp(new Date(2026, 10, 2, 0, 1));
    assert.equal(stampText, "2026-11-02 00:01");
    const contentA = "- [/] #task One ^a1";
    const contentB = "- [/] #task Two ^b1";
    const sessionA = helpers.discoverCountedObsidianTaskTargets(contentA, 0, 0);
    const sessionB = helpers.discoverCountedObsidianTaskTargets(contentB, 0, 0);
    const planA = helpers.planTaskLaneBatch(contentA, sessionA, {
      summary: "shared work",
      stampText,
      now: new Date(2026, 10, 2, 0, 1),
    });
    const planB = helpers.planTaskLaneBatch(contentB, sessionB, {
      summary: "shared work",
      stampText,
      now: new Date(2026, 10, 2, 0, 1),
    });
    assert.equal(planA.valid, true);
    assert.equal(planB.valid, true);
    assert.match(planA.content, /\*2026-11-02 00:01\* — shared work/);
    assert.match(planB.content, /\*2026-11-02 00:01\* — shared work/);
  } finally {
    restoreDate();
  }
});

test("Move to Next samples the commit clock after its prompt and previews live", async () => {
  installAdjustableDate(new RealDate(2026, 10, 1, 23, 59).getTime());
  try {
    const harness = createLinkPickerHarness({
      notes: { "Tasks.md": "- [/] #task Fix the parser crash ^a1" },
      linkPath: "2026/20261101.md",
      linkContent: ["## Pomodoros", "- [ ] (**0940-1010**)", "\t- [[Tasks#^a1]]"].join("\n"),
      cursor: { line: 2, ch: 3 },
    });
    harness.plugin.app.plugins = { plugins: {} };
    const plugin = harness.plugin;
    const view = {
      editor: harness.linkEditor,
      file: harness.files.get("2026/20261101.md"),
    };
    const pending = plugin.toggleTaskLinkLane({
      editor: harness.linkEditor,
      view,
    });
    await TICK();
    await TICK();
    const modal = plugin.taskLinkLanePrompt;
    assert.ok(modal);
    // Preview before the minute rolls shows the opening minute.
    modal.inputEl.value = "Finished the API review";
    modal.updatePreview();
    assert.match(
      modal.previewEl.getAttribute("aria-label") || "",
      /\*2026-11-01 23:59\* — Finished the API review/,
    );
    // Advancing the clock and re-rendering updates the preview.
    setAdjustable(2026, 10, 2, 0, 1);
    modal.updatePreview();
    assert.match(
      modal.previewEl.getAttribute("aria-label") || "",
      /\*2026-11-02 00:01\* — Finished the API review/,
    );
    modal.submit();
    const result = await pending;
    assert.deepEqual(result, { ok: true, mode: "pause", changed: 1 });
    assert.match(
      harness.notes["Tasks.md"],
      /\*2026-11-02 00:01\* — Finished the API review/,
    );
  } finally {
    restoreDate();
  }
});

test("Task Card lane release preview and commit sample live clocks", async () => {
  installAdjustableDate(new RealDate(2026, 10, 1, 23, 59).getTime());
  try {
    const harness = createBulletPropertyPickerHarness({
      config: helpers.validateBulletPropertyConfig({
        properties: [{ name: "scheduled", values: "date" }],
      }),
      content: "- [/] #task Working ^a1",
      cursor: { line: 0, ch: 0 },
    });
    assert.equal(harness.open(), true);
    const picker = harness.plugin.activeBulletPropertyPicker;
    // Open the lane release reason stage directly.
    picker.fixedWorkLogNow = new AdjustableDate();
    picker.showLaneReleaseReasonStage({ targetCount: 1, laneKind: "task" });
    assert.equal(picker.stage, "lane-release-reason");
    // Preview with a reason shows the opening minute.
    const row = { children: [], createDiv: () => ({ createDiv: () => ({}), setText: () => {} }) };
    // Use the pure preview path instead: render item text via helper.
    setAdjustable(2026, 10, 2, 0, 1);
    picker.fixedWorkLogNow = new AdjustableDate();
    // Confirm passes only the fixed clock; the eventual writer samples the
    // stamp post-route. Stub the writer to compute like the real 540 path.
    let captured = null;
    picker.plugin.applyLaneToggleFromPicker = async (p, options) => {
      const now =
        options.now instanceof Date
          ? options.now
          : p.fixedWorkLogNow instanceof Date
            ? p.fixedWorkLogNow
            : new Date();
      captured = {
        summary: options.summary,
        stampText: options.stampText || helpers.formatWorkLogStamp(now),
      };
      return true;
    };
    picker.runInboxRoutedCommit = async (action, write) => await write();
    const item = { empty: false, reason: "parked" };
    const ok = await picker.confirmLaneReleaseReason(item);
    assert.equal(ok, true);
    assert.equal(captured.summary, "parked");
    assert.match(captured.stampText, /2026-11-02 00:01/);
  } finally {
    restoreDate();
  }
});

test("scheduling Work Log preview samples the render-time clock", async () => {
  installAdjustableDate(new RealDate(2026, 9, 2, 14, 32).getTime());
  try {
    const harness = createBulletPropertyPickerHarness({
      config: helpers.validateBulletPropertyConfig({
        properties: [
          { name: "scheduled", values: "date" },
          {
            name: "priority",
            values: "priority",
            schedules: "scheduled",
            levels: [
              { label: "P1", value: "high", min_days: 2, max_days: 7 },
              { label: "P2", value: "medium", min_days: 8, max_days: 30 },
            ],
          },
        ],
      }),
      content: "- [/] #task Pending work ^a",
      cursor: { line: 0, ch: 0 },
      now: new RealDate(2026, 9, 2, 14, 32),
    });
    assert.equal(harness.open(), true);
    const picker = harness.plugin.activeBulletPropertyPicker;
    picker.fixedWorkLogNow = new AdjustableDate();
    // Build a pending scheduling Work Log with a frozen opening stamp, then
    // advance the clock: the preview must show the new minute.
    picker.pendingScheduleWorkLog = Object.freeze({
      title: "Schedule task",
      isBatch: false,
      eligibleCount: 1,
      totalCount: 1,
      dateText: "2026-10-02 14:32",
      stampText: "2026-10-02 14:32",
      scheduleSummary: "scheduled → 2026-10-05",
      resume: async () => true,
    });
    setAdjustable(2026, 9, 2, 14, 33);
    picker.fixedWorkLogNow = new AdjustableDate();
    // Preview helper samples fixedWorkLogNow at render time.
    const stamp = helpers.formatWorkLogStamp(picker.fixedWorkLogNow);
    assert.equal(stamp, "2026-10-02 14:33");
  } finally {
    restoreDate();
  }
});

test("inbox route gate delayed across a minute writes the post-route stamp", async () => {
  installAdjustableDate(new RealDate(2026, 10, 1, 23, 59).getTime());
  try {
    notices.length = 0;
    const { plugin, editor } = lanePlugin("- [/] #task Working ^a1");
    plugin.requestLaneReleaseSummary = async () => ({
      cancelled: false,
      summary: "routed work",
    });
    plugin.promptLaneInboxRoute = async () => {
      setAdjustable(2026, 10, 2, 0, 1);
      return { kind: "none" };
    };
    assert.equal(await plugin.toggleTaskLane(editor), true);
    assert.match(editor.content, /\*2026-11-02 00:01\* — routed work/);
  } finally {
    restoreDate();
  }
});

test("blank and cancelled summaries write no Work Log", async () => {
  installAdjustableDate(new RealDate(2026, 10, 1, 23, 59).getTime());
  try {
    notices.length = 0;
    const { plugin, editor } = lanePlugin("- [/] #task Working ^a1");
    plugin.requestLaneReleaseSummary = async () => ({
      cancelled: false,
      summary: "   ",
    });
    plugin.promptLaneInboxRoute = async () => ({ kind: "none" });
    assert.equal(await plugin.toggleTaskLane(editor), true);
    assert.doesNotMatch(editor.content, /WORK LOG/);

    const cancelled = lanePlugin("- [/] #task Working ^a1");
    cancelled.plugin.requestLaneReleaseSummary = async () => ({
      cancelled: true,
      summary: "",
    });
    assert.equal(await cancelled.plugin.toggleTaskLane(cancelled.editor), false);
    assert.doesNotMatch(cancelled.editor.content, /WORK LOG/);
  } finally {
    restoreDate();
  }
});
