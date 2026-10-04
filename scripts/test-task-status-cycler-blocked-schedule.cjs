const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  MarkdownView,
  createInMemoryObsidianApp,
  getEmbeddedTarget,
  createTextEditor,
} = require("./task-status-cycler-harness.cjs");

test("option-bracket ring reads Blocked as a source-only slot ahead of Ready", () => {
  const plugin = new TaskStatusCyclerPlugin();
  assert.equal(plugin.getAdjacentSymbol("?", 1), " ");
  assert.equal(plugin.getAdjacentSymbol("?", -1), "-");

  const table = [
    { symbol: " ", forward: "/", backward: "-" },
    { symbol: "/", forward: "*", backward: " " },
    { symbol: "*", forward: "x", backward: "/" },
    { symbol: "x", forward: "-", backward: "*" },
    { symbol: "-", forward: " ", backward: "x" },
  ];
  for (const { symbol, forward, backward } of table) {
    assert.equal(plugin.getAdjacentSymbol(symbol, 1), forward, `${symbol} forward`);
    assert.equal(plugin.getAdjacentSymbol(symbol, -1), backward, `${symbol} backward`);
  }

  for (const symbol of [" ", "/", "*", "x", "-", "?"]) {
    assert.notEqual(plugin.getAdjacentSymbol(symbol, 1), "?");
    assert.notEqual(plugin.getAdjacentSymbol(symbol, -1), "?");
  }
});

test("isCyclableTaskStatus accepts Blocked while Ctrl+Enter predicates still reject it", () => {
  const blocked = helpers.getTaskStatusForLine("- [?] #task Custom ^custom");
  assert.equal(helpers.isCyclableTaskStatus(blocked), true);
  assert.equal(
    helpers.isCyclableTaskStatus(helpers.getTaskStatusForLine("- [!] #task Unknown")),
    false,
  );
  assert.equal(helpers.isTranscludedCompletionTraversableStatus(blocked), false);
  assert.equal(helpers.isTranscludedCompletionClosableStatus(blocked), false);
  assert.equal(helpers.isTranscludedReopenableStatus(blocked), false);
  assert.equal(helpers.isOpenDoneTaskStatus(blocked), false);
});

test("findSingleFutureScheduledField validates form, field order, and the strictly-future boundary", () => {
  const today = "2026-08-17";
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-20]", today).value,
    "2026-08-20",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X (scheduled:: 2026-08-20)", today).value,
    "2026-08-20",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField(
      "- [?] #task X [priority:: high] [scheduled:: 2026-08-20] [effort:: 2]",
      today,
    ).value,
    "2026-08-20",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled::2026-08-20]", today).value,
    "2026-08-20",
  );
  assert.ok(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2028-02-29]", today),
    "leap day is valid",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-02-30]", today),
    null,
    "impossible date is rejected",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 26-8-20]", today),
    null,
    "wrong-width value is rejected",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-16]", today),
    null,
    "yesterday is not future",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-17]", today),
    null,
    "today is not future",
  );
  assert.ok(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-18]", today),
    "tomorrow is future",
  );
});

test("field removal collapses only the exposed span and preserves the rest of the line", () => {
  const today = "2026-08-17";
  const line =
    "1. [?] #task Ship it [priority:: medium] [scheduled:: 2026-08-20] #urgent ^ship";
  const field = helpers.findSingleFutureScheduledField(line, today);
  const removed = helpers.removeSpanWithSpaceCollapse(line, field.start, field.end);
  assert.equal(removed, "1. [?] #task Ship it [priority:: medium] #urgent ^ship");
  assert.equal(/[ \t]$/.test(removed), false);

  const trailingField = "- [?] #task Ship it [scheduled:: 2026-08-20]";
  const trailingFieldMatch = helpers.findSingleFutureScheduledField(trailingField, today);
  assert.equal(
    helpers.removeSpanWithSpaceCollapse(
      trailingField,
      trailingFieldMatch.start,
      trailingFieldMatch.end,
    ),
    "- [?] #task Ship it",
  );
});

test("vault-path retirement preserves CRLF and a missing final newline", () => {
  const today = "2026-08-17";
  const crlfSource =
    ["- [?] #task First [scheduled:: 2026-08-20] ^first", "  - 🗓️ **SCHEDULE LOG**"].join(
      "\r\n",
    ) + "\r\n";
  const crlfResult = helpers.applyBlockedStatusRetirementToSourceText(crlfSource, 0, today);
  assert.ok(crlfResult);
  assert.equal(crlfResult.text.includes("\r\n"), true);
  assert.equal(/(?<!\r)\n/.test(crlfResult.text), false);

  const noFinalNewline = "- [?] #task Solo [scheduled:: 2026-08-20] ^solo";
  const soloResult = helpers.applyBlockedStatusRetirementToSourceText(noFinalNewline, 0, today);
  assert.ok(soloResult);
  assert.equal(soloResult.text, "- [?] #task Solo ^solo");
  assert.equal(soloResult.text.endsWith("\n"), false);
});

test("Schedule Log insertion recognizes all three marker spellings and lands directly beneath the marker", () => {
  const today = "2026-08-17";
  for (const marker of [
    "- 🗓️ **SCHEDULE LOG**",
    "- **SCHEDULE LOG**",
    "- **Schedule log:**",
  ]) {
    const lines = [
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      `\t${marker}`,
      "\t\t- *2026-08-06 → 2026-08-20* — waiting on the API review",
    ];
    const plan = helpers.planBlockedStatusRetirement(lines, 0, today);
    assert.ok(plan, marker);
    assert.equal(plan.removedDate, "2026-08-20");
    assert.equal(plan.lineText, "- [?] #task Ship it ^ship");
    assert.ok(plan.insertion, marker);
    assert.equal(plan.insertion.line, 2);
    assert.equal(
      plan.insertion.text,
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    );
  }
});

test("Schedule Log discovery ignores a marker owned by a nested grandchild", () => {
  const today = "2026-08-17";
  const lines = [
    "- [?] #task Parent [scheduled:: 2026-08-20] ^parent",
    "\t- [ ] #task Child",
    "\t\t- 🗓️ **SCHEDULE LOG**",
    "\t\t\t- *2026-08-06 → 2026-08-20* — waiting",
  ];
  const plan = helpers.planBlockedStatusRetirement(lines, 0, today);
  assert.ok(plan);
  assert.equal(plan.lineText, "- [?] #task Parent ^parent");
  assert.equal(plan.insertion, null);
});

test("Schedule Log entry falls back to marker indent plus one tab and reuses the marker's own bullet when the log has no entries", () => {
  const today = "2026-08-17";
  const noEntries = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "\t- 🗓️ **SCHEDULE LOG**",
  ];
  const plan = helpers.planBlockedStatusRetirement(noEntries, 0, today);
  assert.ok(plan.insertion);
  assert.equal(plan.insertion.line, 2);
  assert.equal(
    plan.insertion.text,
    "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
  );

  const starMarker = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "\t* 🗓️ **SCHEDULE LOG**",
  ];
  const starPlan = helpers.planBlockedStatusRetirement(starMarker, 0, today);
  assert.match(starPlan.insertion.text, /^\t\t\* /);

  const existingEntries = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t\t- *2026-08-06 → 2026-08-20* — waiting on the API review",
  ];
  const existingPlan = helpers.planBlockedStatusRetirement(existingEntries, 0, today);
  assert.equal(existingPlan.insertion.line, 2);
  assert.equal(
    existingPlan.insertion.text,
    "\t\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
  );
});

test("a task with no Schedule Log gets its field retired without any insertion or new marker", () => {
  const today = "2026-08-17";
  const plan = helpers.planBlockedStatusRetirement(
    ["- [?] #task Solo [scheduled:: 2026-08-20] ^solo"],
    0,
    today,
  );
  assert.ok(plan);
  assert.equal(plan.lineText, "- [?] #task Solo ^solo");
  assert.equal(plan.insertion, null);
});

test("Schedule Log entry uses the canonical arrow, dash, and lock bytes", () => {
  const entry = helpers.formatScheduleLogEntry("2026-08-20", "2026-08-17");
  assert.equal(entry, "*2026-08-20 → 2026-08-17* — 🔓 unblocked by hand");
  assert.equal(entry.includes("→"), true);
  assert.equal(entry.includes("—"), true);
  assert.equal(entry.includes("\u{1F513}"), true);
});

test("retirement stays a no-op for shapes that are not proof of a blocking date", () => {
  const today = "2026-08-17";
  const cases = [
    "- [?] #task No field ^plain",
    "- [?] #task Past due [scheduled:: 2026-08-10] ^past",
    "- [?] #task Due today [scheduled:: 2026-08-17] ^today",
    "- [?] #task Two fields [scheduled:: 2026-08-20] [scheduled:: 2026-08-21] ^two",
    "- [?] #task Malformed [scheduled:: not-a-date] ^bad",
    "- [?] Not a task at all [scheduled:: 2026-08-20] ^bare",
  ];
  for (const line of cases) {
    assert.equal(helpers.planBlockedStatusRetirement([line], 0, today), null, line);
    assert.equal(
      helpers.applyBlockedStatusRetirementToSourceText(line, 0, today),
      null,
      line,
    );
  }
});

test("cycling Blocked backward to Cancelled retires the date and logs, matching forward", () => {
  const editor = createTextEditor(
    ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "\t- 🗓️ **SCHEDULE LOG**"].join(
      "\n",
    ),
    { line: 0, ch: 4 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

  assert.equal(plugin.handleCycleCommand(false, editor, view, -1), true);
  assert.equal(
    editor.getValue(),
    [
      "- [-] #task Ship it ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    ].join("\n"),
  );
});

test("single-press Blocked retirement matches with and without an existing Schedule Log, and with the Tasks command handling the write", () => {
  {
    const editor = createTextEditor(
      "- [?] #task Solo [scheduled:: 2026-08-20] ^solo",
      { line: 0, ch: 4 },
    );
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(editor.getValue(), "- [ ] #task Solo ^solo");
    assert.deepEqual(editor.getCursor(), { line: 0, ch: 4 });
  }

  {
    const editor = createTextEditor(
      ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "\t- 🗓️ **SCHEDULE LOG**"].join(
        "\n",
      ),
      { line: 0, ch: 4 },
    );
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(
      editor.getValue(),
      [
        "- [ ] #task Ship it ^ship",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }

  {
    const editor = createTextEditor(
      ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "\t- 🗓️ **SCHEDULE LOG**"].join(
        "\n",
      ),
      { line: 0, ch: 4 },
    );
    const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-space";
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = {
      commands: {
        commands: { [doneCommand]: {} },
        executeCommandById: (commandId) => {
          assert.equal(commandId, doneCommand);
          editor.replaceRange(
            "- [ ] #task Ship it [scheduled:: 2026-08-20] ^ship",
            { line: 0, ch: 0 },
            { line: 0, ch: editor.getLine(0).length },
          );
          return true;
        },
      },
    };
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(
      editor.getValue(),
      [
        "- [ ] #task Ship it ^ship",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }
});

test("counted range cycling maps editor coordinates through Schedule Log insertions, including a nested child task above the marker", async () => {
  const editor = createTextEditor(
    [
      "- [?] #task Parent [scheduled:: 2026-08-20] ^parent",
      "\t- [ ] #task Nested child ^child",
      "\t- 🗓️ **SCHEDULE LOG**",
      "- [ ] #task Sibling ^sibling",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
  plugin.getScheduleLogDateString = () => "2026-08-17";

  const changed = await plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 3);
  assert.equal(changed, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Parent ^parent",
      "\t- [/] #task Nested child ^child",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      "- [/] #task Sibling ^sibling",
    ].join("\n"),
  );
});

test("counted range accounts for a cursor-line Tasks-command insertion when targeting later lines", async () => {
  const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
  const editor = createTextEditor(
    [
      "- [*] #task Recurring 🔁 every week ^recurring",
      "- [ ] #task Second ^second",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    commands: {
      commands: { [doneCommand]: {} },
      executeCommandById: (commandId) => {
        assert.equal(commandId, doneCommand);
        editor.replaceRange(
          "- [ ] #task Recurring 🔁 every week ^recurring-next\n- [x] #task Recurring 🔁 every week ^recurring",
          { line: 0, ch: 0 },
          { line: 0, ch: editor.getLine(0).length },
        );
        return true;
      },
    },
  };

  const changed = await plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 1);
  assert.equal(changed, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Recurring 🔁 every week ^recurring-next",
      "- [x] #task Recurring 🔁 every week ^recurring",
      "- [/] #task Second ^second",
    ].join("\n"),
  );
});

test("transcluded Blocked cycling retires the target's schedule and logs it, in another note and in the active note", async () => {
  {
    const harness = createInMemoryObsidianApp({
      "Daily.md": "- ![[Tasks#^blocked]]",
      "Tasks.md": [
        "- [?] #task Blocked one [scheduled:: 2026-08-20] ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
      ].join("\n"),
    });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    plugin.getScheduleLogDateString = () => "2026-08-17";

    const wrote = await plugin.cycleResolvedTranscludedTaskLink(
      getEmbeddedTarget("![[Tasks#^blocked]]"),
      { activePath: "Daily.md", originPath: "Daily.md", editor: null },
      1,
    );
    assert.equal(wrote, true);
    assert.equal(
      harness.getSource("Tasks.md"),
      [
        "- [ ] #task Blocked one ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }

  {
    const editor = createTextEditor(
      [
        "- ![[#^blocked]]",
        "- [?] #task Blocked two [scheduled:: 2026-08-20] ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
      ].join("\n"),
    );
    const harness = createInMemoryObsidianApp({ "Daily.md": editor.getValue() });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    plugin.getScheduleLogDateString = () => "2026-08-17";

    const wrote = await plugin.cycleResolvedTranscludedTaskLink(
      getEmbeddedTarget("![[#^blocked]]"),
      { activePath: "Daily.md", originPath: "Daily.md", editor },
      1,
    );
    assert.equal(wrote, true);
    assert.equal(
      editor.getValue(),
      [
        "- ![[#^blocked]]",
        "- [ ] #task Blocked two ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }
});

test("pressing again after Blocked retirement performs an ordinary transition with no further changes", () => {
  const editor = createTextEditor(
    [
      "- [ ] #task Ship it ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    ].join("\n"),
    { line: 0, ch: 4 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Ship it ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    ].join("\n"),
  );
});

