// SA33: block-id-prompt Unlink task hand-off to cycler offerParkedSuccessors
// (plan:202611/starts_after_relation.md phase obsidian_unlink).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Plugin,
  lastNotice,
  resetNotices,
  createEditor,
  sourceForPomodoroLink,
  createTaskLinkHarness,
} = require("./block-id-prompt-harness.cjs");

function installCyclerStub(plugin, calls, { version = 4, offer = null } = {}) {
  const previous = plugin.app && plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  if (!plugin.app) {
    plugin.app = {};
  }
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "task-status-cycler": {
        api: {
          version,
          offerParkedSuccessors: async (identities, options) => {
            calls.push({ identities, options });
            if (typeof offer === "function") {
              return offer(identities, options);
            }
            return { offered: identities.length, picked: 0 };
          },
        },
      },
    },
  };
}

function unlinkPlugin({ dailyContent, taskLine = "- [/] #task Ship it ^ship" }) {
  resetNotices();
  const editor = createEditor(taskLine);
  const source = sourceForPomodoroLink(editor, "Tasks.md", 0);
  const plugin = new Plugin();
  plugin.resolveTodayDailyFile = () => ({ path: "Daily.md" });
  plugin.resolveTaskFile = (path) => (path === "Tasks.md" ? { path: "Tasks.md" } : null);
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.app = {
    vault: {
      read: async (file) => (file.path === "Daily.md" ? dailyContent : null),
      modify: async () => {},
    },
  };
  return { editor, plugin, source };
}

const OPEN_DAILY = [
  "## Pomodoros",
  "- [ ] Current (10:00-10:25)",
  "  - [[Tasks#^ship]]",
  "- [x] Done (09:00-09:25)",
  "  - [[Tasks#^ship]]",
].join("\n");

test("SA33 settled Unlink task prompt offers parked successors with the removed slot", async () => {
  const { plugin, source } = unlinkPlugin({ dailyContent: OPEN_DAILY });
  const calls = [];
  installCyclerStub(plugin, calls);

  const result = await plugin.submitPomodoroWorkSummary(source, "");

  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identities[0].path, "Tasks.md");
  assert.equal(calls[0].identities[0].blockId, "ship");
  assert.equal(calls[0].options.slot.entryLine, 1);
  assert.equal(calls[0].options.slot.bulletLine, 2);
  assert.equal(calls[0].options.slot.entryDeleted, true);
  assert.equal(lastNotice(), "Unlinked · stays In Progress");
});

test("SA33 Esc on Unlink task offers nothing", async () => {
  const { plugin, source, editor } = unlinkPlugin({ dailyContent: OPEN_DAILY });
  const calls = [];
  installCyclerStub(plugin, calls);

  plugin.cancelWorkSummaryPrompt(source);

  assert.equal(calls.length, 0);
  assert.equal(editor.getValue(), "- [/] #task Ship it ^ship");
});

test("non-Pending unlink stays silent even with a live cycler", async () => {
  const { plugin, source } = unlinkPlugin({
    dailyContent: OPEN_DAILY,
    taskLine: "- [*] #task Ship it ^ship",
  });
  const calls = [];
  installCyclerStub(plugin, calls);

  const result = await plugin.applyPomodoroTaskUnlink(source);

  assert.equal(result, true);
  assert.equal(calls.length, 0);
  assert.equal(lastNotice(), "Unlinked · stays Next");
});

test("older cycler api v3 is silence", async () => {
  const { plugin, source } = unlinkPlugin({ dailyContent: OPEN_DAILY });
  const calls = [];
  installCyclerStub(plugin, calls, { version: 3 });

  const result = await plugin.submitPomodoroWorkSummary(source, "");

  assert.equal(result, true);
  assert.equal(calls.length, 0);
});

test("In Progress unlink with no removed links does not offer", async () => {
  const { plugin, source } = unlinkPlugin({
    dailyContent: [
      "## Pomodoros",
      "- [ ] Current (10:00-10:25)",
      "  - leftover",
    ].join("\n"),
  });
  const calls = [];
  installCyclerStub(plugin, calls);

  const result = await plugin.submitPomodoroWorkSummary(source, "");

  assert.equal(result, true);
  assert.equal(calls.length, 0);
});

test("Task Link Unlink of a Pending target offers parked successors", async () => {
  const daily = "## Pomodoros\n- [ ] Current ()\n  - [[Tasks#^ship]]";
  const h = createTaskLinkHarness({
    files: { "Daily.md": daily, "Tasks.md": "- [/] #task Ship it ^ship" },
    activePath: "Daily.md",
    cursor: { line: 2, ch: 0 },
  });
  const calls = [];
  installCyclerStub(h.plugin, calls);
  let prompted = null;
  h.plugin.openWorkSummaryPrompt = (source) => {
    prompted = source;
  };

  await h.plugin.openPomodoroTaskLink(h.editor, h.view);
  assert.ok(prompted);
  const result = await h.plugin.submitPomodoroWorkSummary(prompted, "");

  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identities[0].blockId, "ship");
  assert.equal(calls[0].identities[0].path, "Tasks.md");
});
