const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  createTextEditor,
} = require("./task-status-cycler-harness.cjs");

test("cycler freshness: local-fallback rewrite stamps last via injected stamper", () => {
  const calls = [];
  const stamper = (line, dateText) => {
    calls.push([line, dateText]);
    return `${line} [fresh:: ${dateText}]`;
  };
  const out = helpers.rewriteTaskLineForLocalFallback(
    "- [ ] #task Ship it",
    "/",
    "2026-10-01",
    { stampLine: stamper, freshDateText: "2026-10-01" },
  );
  assert.equal(out, "- [/] #task Ship it [fresh:: 2026-10-01]");
  assert.deepEqual(calls, [["- [/] #task Ship it", "2026-10-01"]]);
});

test("cycler freshness: rewrites without a stamper are unchanged (identity default)", () => {
  assert.equal(
    helpers.rewriteTaskLineForLocalFallback("- [ ] #task Ship it", "/", "2026-10-01"),
    "- [/] #task Ship it",
  );
  assert.equal(
    helpers.rewriteTaskLineForTranscludedSource("- [ ] Do it ^abc", "*", "2026-10-01"),
    "- [*] Do it ^abc",
  );
});

test("cycler freshness: a throwing stamper leaves the rewritten line intact", () => {
  const out = helpers.rewriteTaskLineForLocalFallback(
    "- [ ] #task Ship it",
    "*",
    "2026-10-01",
    {
      stampLine: () => {
        throw new Error("ledger unavailable");
      },
      freshDateText: "2026-10-01",
    },
  );
  assert.equal(out, "- [*] #task Ship it");
});

test("cycler freshness: transcluded rewrite stamps last via injected stamper", () => {
  const stamper = (line, dateText) => `${line} [fresh:: ${dateText}]`;
  const out = helpers.rewriteTaskLineForTranscludedSource(
    "- [ ] Do it ^abc",
    "*",
    "2026-10-01",
    { stampLine: stamper, freshDateText: "2026-10-01" },
  );
  assert.equal(out, "- [*] Do it ^abc [fresh:: 2026-10-01]");
});

test("cycler freshness: cycling a plain line stamps through the follow-up edit", () => {
  const editor = createTextEditor("- [ ] Do it");
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {};
  const seen = [];
  plugin.getFreshnessStampLine = () => (line, dateText) => {
    seen.push([line, dateText]);
    return `${line} [fresh:: ${dateText}]`;
  };
  const taskStatus = helpers.getTaskStatusForLine("- [ ] Do it", 0);
  assert.equal(plugin.setActiveCheckboxStatus(editor, taskStatus, "*"), true);
  const today = helpers.formatLocalDate();
  assert.equal(editor.getLine(0), `- [*] Do it [fresh:: ${today}]`);
  assert.deepEqual(seen, [["- [*] Do it", today]]);
});

test("cycler freshness: Tasks-command rewrite with the expected status is stamped", () => {
  const editor = createTextEditor("- [ ] #task Ship it");
  const plugin = new TaskStatusCyclerPlugin();
  const commandId = "obsidian-tasks-plugin:set-status-symbol-to-*";
  plugin.app = {
    commands: {
      commands: { [commandId]: {} },
      executeCommandById: (id) => {
        assert.equal(id, commandId);
        const current = editor.getLine(0);
        editor.replaceRange(
          current.replace("- [ ]", "- [*]"),
          { line: 0, ch: 0 },
          { line: 0, ch: current.length },
        );
        return true;
      },
    },
  };
  const seen = [];
  plugin.getFreshnessStampLine = () => (line, dateText) => {
    seen.push([line, dateText]);
    return `${line} [fresh:: ${dateText}]`;
  };
  const taskStatus = helpers.getTaskStatusForLine("- [ ] #task Ship it", 0);
  assert.equal(plugin.setActiveCheckboxStatus(editor, taskStatus, "*"), true);
  const today = helpers.formatLocalDate();
  assert.equal(editor.getLine(0), `- [*] #task Ship it [fresh:: ${today}]`);
  assert.deepEqual(seen, [[`- [*] #task Ship it`, today]]);
});

test("cycler freshness: Tasks command that inserts a line never stamps", () => {
  const editor = createTextEditor("- [ ] #task Ship it");
  const plugin = new TaskStatusCyclerPlugin();
  const commandId = "obsidian-tasks-plugin:set-status-symbol-to-*";
  plugin.app = {
    commands: {
      commands: { [commandId]: {} },
      executeCommandById: (id) => {
        assert.equal(id, commandId);
        const current = editor.getLine(0);
        editor.replaceRange(
          current.replace("- [ ]", "- [*]"),
          { line: 0, ch: 0 },
          { line: 0, ch: current.length },
        );
        editor.replaceRange("\n- [ ] #task Recurrence", { line: 1, ch: 0 });
        return true;
      },
    },
  };
  let calls = 0;
  plugin.getFreshnessStampLine = () => () => {
    calls += 1;
    return "unreachable";
  };
  const taskStatus = helpers.getTaskStatusForLine("- [ ] #task Ship it", 0);
  assert.equal(plugin.setActiveCheckboxStatus(editor, taskStatus, "*"), true);
  assert.equal(calls, 0);
  assert.equal(editor.lineCount(), 2);
  assert.ok(!editor.getLine(0).includes("[fresh::"));
  assert.equal(editor.getLine(1), "- [ ] #task Recurrence");
});

test("cycler freshness: Tasks command that deletes the line never stamps the next task", () => {
  const editor = createTextEditor(
    "- [ ] #task First\n- [ ] #task Second",
  );
  const plugin = new TaskStatusCyclerPlugin();
  const commandId = "obsidian-tasks-plugin:set-status-symbol-to-*";
  plugin.app = {
    commands: {
      commands: { [commandId]: {} },
      executeCommandById: (id) => {
        assert.equal(id, commandId);
        editor.replaceRange("", { line: 0, ch: 0 }, { line: 1, ch: 0 });
        return true;
      },
    },
  };
  let calls = 0;
  plugin.getFreshnessStampLine = () => () => {
    calls += 1;
    return "unreachable";
  };
  const taskStatus = helpers.getTaskStatusForLine("- [ ] #task First", 0);
  assert.equal(plugin.setActiveCheckboxStatus(editor, taskStatus, "*"), true);
  assert.equal(calls, 0);
  assert.equal(editor.getLine(0), "- [ ] #task Second");
  assert.ok(!editor.getValue().includes("[fresh::"));
});

test("cycler freshness: Tasks command that leaves a different status never stamps", () => {
  const editor = createTextEditor("- [ ] #task Ship it");
  const plugin = new TaskStatusCyclerPlugin();
  const commandId = "obsidian-tasks-plugin:set-status-symbol-to-*";
  plugin.app = {
    commands: {
      commands: { [commandId]: {} },
      executeCommandById: (id) => {
        assert.equal(id, commandId);
        const current = editor.getLine(0);
        editor.replaceRange(
          current.replace("- [ ]", "- [x]"),
          { line: 0, ch: 0 },
          { line: 0, ch: current.length },
        );
        return true;
      },
    },
  };
  let calls = 0;
  plugin.getFreshnessStampLine = () => () => {
    calls += 1;
    return "unreachable";
  };
  const taskStatus = helpers.getTaskStatusForLine("- [ ] #task Ship it", 0);
  assert.equal(plugin.setActiveCheckboxStatus(editor, taskStatus, "*"), true);
  assert.equal(calls, 0);
  assert.equal(editor.getLine(0), "- [x] #task Ship it");
});

test("cycler freshness: cycling without ledger-tools writes no stamp", () => {
  const editor = createTextEditor("- [ ] Do it");
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {};
  const taskStatus = helpers.getTaskStatusForLine("- [ ] Do it", 0);
  assert.equal(plugin.setActiveCheckboxStatus(editor, taskStatus, "*"), true);
  assert.equal(editor.getLine(0), "- [*] Do it");
});

test("cycler freshness: getFreshnessStampLine degrades when ledger-tools is missing or old", () => {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {};
  assert.equal(plugin.getFreshnessStampLine(), null);
  plugin.app = { plugins: { plugins: { "bob-ledger-tools": { api: { version: 2 } } } } };
  assert.equal(plugin.getFreshnessStampLine(), null);
  const stampLine = () => {};
  plugin.app = {
    plugins: {
      plugins: { "bob-ledger-tools": { api: { version: 3, freshness: { stampLine } } } },
    },
  };
  assert.equal(typeof plugin.getFreshnessStampLine(), "function");
});

// compat (bob-cli-3n.5): Depends-On line recogniser, contract DP vectors
// (docs/task-dependencies.md section 11.1). `line` is the candidate line on
// its own. The boolean guards the line: every `accept`/`empty` shape and
// every `malformed` vector (DP15, DP16, DP23, DP25, DP26, DP31) stays
// guarded, while every `not-a-line` vector (DP24, DP27, DP28, DP29) stays
// unguarded. DP18/DP19/DP20/DP21/DP30 share an accept line shape —
// parentage, fenced code, and Work Log ancestry are hooks projection
// concerns, so the shape stays guarded here.
