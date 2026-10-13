const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  helpers,
  MarkdownView,
  createInMemoryObsidianApp,
  getEmbeddedTarget,
  createTextEditor,
  attachActiveMarkdownView,
  flushAsyncActions,
  notices,
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

test("option-bracket refuses to change a member while its project is Blocked", () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Release the project [dependsOn:: jobs__approval] ^prj",
    "- [?] #task Prepare the release #prj_is_blocked ^notes",
  ].join("\n");
  assert.equal(
    helpers.isProjectBlockedResidentTaskInDocument(
      source,
      "projects/release.md",
      5,
    ),
    true,
  );
  assert.equal(
    helpers.isProjectBlockedResidentTaskInDocument(
      source.replace("#prj_is_blocked", "#prj_is_blockedish"),
      "projects/release.md",
      5,
    ),
    false,
  );
  for (const direction of [-1, 1]) {
    notices.length = 0;
    const editor = createTextEditor(source, { line: 5, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
    const view = Object.assign(new MarkdownView(), {
      editor,
      file: { path: "projects/release.md" },
    });
    assert.equal(plugin.handleCycleCommand(false, editor, view, direction), true);
    assert.equal(editor.getValue(), source);
    assert.ok(
      notices.some((notice) => notice.includes("Project blocked by dependency")),
    );
  }
});

test("tagged inherited ^prj remains Blocked, refuses cycling, and names its parent", () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    'parent: "[[projects/parent|Parent]]"',
    "---",
    "- [?] #task #prj #prj_is_blocked Child project ^prj",
    "- [?] #task #prj_is_blocked Child work ^work",
  ].join("\n");
  const project = helpers.projectDependencyInfo(source, "projects/child.md");
  assert.equal(helpers.prjInheritsBlock(project.projectTask.lineText), true);
  assert.equal(
    helpers.projectIsBlockedAfter(project, new Set(), "2026-08-15"),
    true,
  );
  assert.equal(
    helpers.projectHasRemainingBlockingReason(project, "2026-08-15", new Set()),
    true,
  );
  assert.deepEqual(
    helpers.planProjectResidentRecoveryEdits(source, "projects/child.md", {
      today: "2026-08-15",
      openIds: new Set(),
    }),
    [],
  );
  assert.equal(
    helpers.isProjectBlockedResidentTaskInDocument(
      source,
      "projects/child.md",
      5,
    ),
    true,
  );
  assert.equal(
    helpers.projectBlockedResidentNotice(
      source,
      "projects/child.md",
      5,
      "2026-08-15",
    ),
    "Project blocked by parent project · projects/parent",
  );

  const editor = createTextEditor(source, { line: 5, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "projects/child.md" },
  });
  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  assert.equal(editor.getValue(), source);
  assert.ok(notices.some((notice) => notice.includes("projects/parent")));
});

test("project resident notice reads the inline ^prj date and ignores frontmatter scheduled", () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "scheduled: 2027-01-01",
    "---",
    "- [?] #task #prj Launch the project [scheduled:: 2026-08-20] ^prj",
    "- [?] #task Prepare the launch #prj_is_blocked ^notes",
  ].join("\n");
  const project = helpers.projectDependencyInfo(source, "projects/launch.md");
  assert.equal(project.scheduled, "2026-08-20");
  assert.equal(
    helpers.projectBlockedResidentNotice(
      source,
      "projects/launch.md",
      6,
      "2026-08-15",
    ),
    "Project blocked by date · move the ^prj Schedule in projects/launch.md (2026-08-20)",
  );
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

test("Alt+] on a date-blocked ^prj recovers open residents in step", async () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Launch the project [scheduled:: 2026-08-20] ^prj",
    "- [?] #task Prepare the launch #prj_is_blocked ^notes",
    "- [?] #task Own blocker [dependsOn:: open__root] #prj_is_blocked ^own",
    "- [x] #task Done #prj_is_blocked ✅ 2026-10-01 ^done",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "projects/launch.md": source,
    "roots.md": "- [ ] #task Open root [id:: open__root] ^root",
  });
  const editor = createTextEditor(source, { line: 4, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const { view } = attachActiveMarkdownView(
    plugin,
    harness,
    editor,
    "projects/launch.md",
  );
  plugin.app.commands = { commands: {}, executeCommandById: () => false };

  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  await flushAsyncActions();
  await flushAsyncActions();

  const text = editor.getValue();
  assert.match(text, /^- \[ \] #task #prj Launch the project \^prj$/m);
  assert.match(text, /^- \[ \] #task Prepare the launch \[unblocked:: 2026-08-17\] \^notes$/m);
  assert.match(
    text,
    /^- \[\?\] #task Own blocker \[dependsOn:: open__root\] \^own$/m,
  );
  assert.doesNotMatch(
    text.split("\n").find((line) => line.includes("^own")),
    /#prj_is_blocked/,
  );
  assert.match(text, /^- \[x\] #task Done #prj_is_blocked ✅ 2026-10-01 \^done$/m);
});

test("Alt+] on a ^prj keeps residents tagged while an open Depends-On target remains", async () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Launch [scheduled:: 2026-08-20] [dependsOn:: jobs__review] ^prj",
    "- [?] #task Resident #prj_is_blocked ^resident",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "projects/launch.md": source,
    "jobs.md": "- [ ] #task Review [id:: jobs__review] ^review",
  });
  const editor = createTextEditor(source, { line: 4, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const { view } = attachActiveMarkdownView(
    plugin,
    harness,
    editor,
    "projects/launch.md",
  );
  plugin.app.commands = { commands: {}, executeCommandById: () => false };

  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  await flushAsyncActions();
  await flushAsyncActions();

  const text = editor.getValue();
  assert.match(text, /^- \[ \] #task #prj Launch \[dependsOn:: jobs__review\] \^prj$/m);
  assert.match(text, /^- \[\?\] #task Resident #prj_is_blocked \^resident$/m);
});

test("planProjectResidentRecoveryEdits recovers when a cross-note id is not open", () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [ ] #task #prj Launch [dependsOn:: jobs__review] ^prj",
    "- [?] #task Resident #prj_is_blocked ^resident",
  ].join("\n");
  const recovered = helpers.planProjectResidentRecoveryEdits(
    source,
    "projects/launch.md",
    { today: "2026-08-17", openIds: [] },
  );
  assert.equal(recovered.length, 1);
  assert.match(recovered[0].after, /^- \[ \] #task Resident \^resident$/);

  const stillBlocked = helpers.planProjectResidentRecoveryEdits(
    source,
    "projects/launch.md",
    { today: "2026-08-17", openIds: ["jobs__review"] },
  );
  assert.deepEqual(stillBlocked, []);
});

test("Alt+] on a ^prj recovers residents when the remaining Depends-On target is closed", async () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Launch [scheduled:: 2026-08-20] [dependsOn:: jobs__review] ^prj",
    "- [?] #task Resident #prj_is_blocked ^resident",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "projects/launch.md": source,
    "jobs.md": "- [x] #task Review [id:: jobs__review] ^review",
  });
  const editor = createTextEditor(source, { line: 4, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const { view } = attachActiveMarkdownView(
    plugin,
    harness,
    editor,
    "projects/launch.md",
  );
  plugin.app.commands = { commands: {}, executeCommandById: () => false };

  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  await flushAsyncActions();
  await flushAsyncActions();

  const text = editor.getValue();
  assert.match(text, /^- \[ \] #task #prj Launch \[dependsOn:: jobs__review\] \^prj$/m);
  assert.match(
    text,
    /^- \[ \] #task Resident \[unblocked:: 2026-08-17\] \^resident$/m,
  );
});

test("Alt+] recovers a resident whose own closed cross-note prerequisite was the last reason", async () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Launch [scheduled:: 2026-08-20] ^prj",
    "- [?] #task Resident [dependsOn:: jobs__review] #prj_is_blocked ^resident",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "projects/launch.md": source,
    "jobs.md": "- [x] #task Review [id:: jobs__review] ^review",
  });
  const editor = createTextEditor(source, { line: 4, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const { view } = attachActiveMarkdownView(
    plugin,
    harness,
    editor,
    "projects/launch.md",
  );
  plugin.app.commands = { commands: {}, executeCommandById: () => false };

  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  await flushAsyncActions();
  await flushAsyncActions();

  const text = editor.getValue();
  assert.match(text, /^- \[ \] #task #prj Launch \^prj$/m);
  assert.match(
    text,
    /^- \[ \] #task Resident \[unblocked:: 2026-08-17\] \[dependsOn:: jobs__review\] \^resident$/m,
  );
});

test("Alt+[ on a [?] ^prj to Cancelled recovers tagged residents", async () => {
  const source = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Launch [scheduled:: 2026-08-20] ^prj",
    "- [?] #task Resident #prj_is_blocked ^resident",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "projects/launch.md": source });
  const editor = createTextEditor(source, { line: 4, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const { view } = attachActiveMarkdownView(
    plugin,
    harness,
    editor,
    "projects/launch.md",
  );
  plugin.app.commands = { commands: {}, executeCommandById: () => false };

  assert.equal(plugin.handleCycleCommand(false, editor, view, -1), true);
  await flushAsyncActions();
  await flushAsyncActions();

  const text = editor.getValue();
  assert.match(text, /^- \[-\] #task #prj Launch \^prj$/m);
  assert.match(
    text,
    /^- \[ \] #task Resident \[unblocked:: 2026-08-17\] \^resident$/m,
  );
});

test("cycling a transcluded ^prj recovers residents in the source note", async () => {
  const project = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Launch [scheduled:: 2026-08-20] ^prj",
    "- [?] #task Resident #prj_is_blocked ^resident",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": "- ![[launch#^prj]]",
    "projects/launch.md": project,
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getScheduleLogDateString = () => "2026-08-17";

  const wrote = await plugin.cycleResolvedTranscludedTaskLink(
    getEmbeddedTarget("![[launch#^prj]]"),
    { activePath: "Daily.md", originPath: "Daily.md", editor: null },
    1,
  );
  assert.equal(wrote, true);
  const text = harness.getSource("projects/launch.md");
  assert.match(text, /^- \[ \] #task #prj Launch \^prj$/m);
  assert.match(
    text,
    /^- \[ \] #task Resident \[unblocked:: 2026-08-17\] \^resident$/m,
  );
});

