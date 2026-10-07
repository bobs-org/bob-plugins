const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TaskStatusCyclerPlugin,
  MarkdownView,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
} = require("./task-status-cycler-harness.cjs");

const DAILY = [
  "## Pomodoros",
  "- [ ] (**0920-0950** [t:: 30m])",
  "\t- [[Tasks#^a]]",
].join("\n");

function installLaneStub(plugin, { matches, toggle } = {}) {
  const calls = { matches: [], toggle: [] };
  const lane = {
    version: 1,
    matches: (args) => {
      calls.matches.push({ ...args });
      if (typeof matches === "function") {
        return matches(args);
      }
      return args && args.line === 2;
    },
    toggle: (args) => {
      calls.toggle.push({ ...args });
      if (typeof toggle === "function") {
        return toggle(args);
      }
      return Promise.resolve(
        Object.freeze({ ok: true, mode: "start", changed: 1 }),
      );
    },
  };
  plugin.app.plugins = {
    plugins: {
      "bob-navigation-hotkeys": {
        api: { version: 3, taskLinkLane: lane },
      },
    },
  };
  return { lane, calls };
}

function openDaily(source = DAILY, cursor = { line: 2, ch: 5 }) {
  const harness = createInMemoryObsidianApp({
    "Daily.md": source,
    "Tasks.md": "- [ ] #task A ^a",
  });
  const editor = createTextEditor(source, cursor);
  const plugin = new TaskStatusCyclerPlugin();
  const { view } = attachActiveMarkdownView(plugin, harness, editor, "Daily.md");
  plugin.app.commands = { commands: {}, executeCommandById: () => false };
  return { harness, editor, plugin, view };
}

test("getTaskLinkLaneApi returns the lane only when version and both functions exist", () => {
  const plugin = new TaskStatusCyclerPlugin();
  const lane = { version: 1, matches: () => true, toggle: () => {} };

  const cases = [
    { name: "no app", app: null, expected: null },
    { name: "no plugins", app: {}, expected: null },
    { name: "no holder", app: { plugins: { plugins: {} } }, expected: null },
    { name: "no api", app: { plugins: { plugins: { "bob-navigation-hotkeys": {} } } }, expected: null },
    {
      name: "no lane",
      app: { plugins: { plugins: { "bob-navigation-hotkeys": { api: { version: 3 } } } } },
      expected: null,
    },
    {
      name: "old lane",
      app: {
        plugins: {
          plugins: {
            "bob-navigation-hotkeys": {
              api: { version: 3, taskLinkLane: { ...lane, version: 0 } },
            },
          },
        },
      },
      expected: null,
    },
    {
      name: "missing matches",
      app: {
        plugins: {
          plugins: {
            "bob-navigation-hotkeys": {
              api: { version: 3, taskLinkLane: { version: 1, toggle: lane.toggle } },
            },
          },
        },
      },
      expected: null,
    },
    {
      name: "missing toggle",
      app: {
        plugins: {
          plugins: {
            "bob-navigation-hotkeys": {
              api: { version: 3, taskLinkLane: { version: 1, matches: lane.matches } },
            },
          },
        },
      },
      expected: null,
    },
  ];

  for (const item of cases) {
    plugin.app = item.app;
    assert.equal(plugin.getTaskLinkLaneApi(), item.expected, item.name);
  }

  plugin.app = {
    plugins: { plugins: { "bob-navigation-hotkeys": { api: { version: 3, taskLinkLane: lane } } } },
  };
  assert.equal(plugin.getTaskLinkLaneApi(), lane, "valid lane");

  plugin.app = {
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          api: {
            version: 3,
            get taskLinkLane() {
              throw new Error("stale mock");
            },
          },
        },
      },
    },
  };
  assert.equal(plugin.getTaskLinkLaneApi(), null, "throwing api");
});

test("isTaskLinkLaneLine passes content, line, and path and never throws", () => {
  const { editor, plugin } = openDaily();
  const { calls } = installLaneStub(plugin);

  assert.equal(plugin.isTaskLinkLaneLine(editor, "Daily.md"), true);
  assert.deepEqual(calls.matches, [{ content: DAILY, line: 2, path: "Daily.md" }]);

  assert.equal(plugin.isTaskLinkLaneLine(null, "Daily.md"), false);
  assert.equal(
    plugin.isTaskLinkLaneLine({ getCursor: () => null }, "Daily.md"),
    false,
  );

  plugin.app = {};
  assert.equal(plugin.isTaskLinkLaneLine(editor, "Daily.md"), false);

  installLaneStub(plugin, {
    matches: () => {
      throw new Error("stale mock");
    },
  });
  assert.equal(plugin.isTaskLinkLaneLine(editor, "Daily.md"), false);
});

test("single Alt+] on a Task Link delegates with exactly { editor, view }", () => {
  const { harness, editor, plugin, view } = openDaily();
  const { calls } = installLaneStub(plugin);

  assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true);
  assert.equal(calls.toggle.length, 0, "checking phase writes nothing");

  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  assert.equal(calls.toggle.length, 1);
  assert.deepEqual(Object.keys(calls.toggle[0]), ["editor", "view"]);
  assert.equal(calls.toggle[0].editor, editor);
  assert.equal(calls.toggle[0].view, view);

  assert.equal(editor.getValue(), DAILY, "the bullet is never reformatted");
  assert.equal(harness.getSource("Tasks.md"), "- [ ] #task A ^a");
});

test("Alt+[ and Alt+] delegate identically; direction is ignored", () => {
  for (const direction of [1, -1]) {
    const { editor, plugin, view } = openDaily();
    const { calls } = installLaneStub(plugin);

    assert.equal(plugin.handleCycleCommand(true, editor, view, direction), true);
    assert.equal(plugin.handleCycleCommand(false, editor, view, direction), true);
    assert.equal(calls.toggle.length, 1, `direction ${direction}`);
    assert.deepEqual(Object.keys(calls.toggle[0]), ["editor", "view"]);
    assert.equal(editor.getValue(), DAILY, `direction ${direction}`);
  }
});

test("embedded Pomodoro link routes to the lane toggle, not the full-ring cycle", () => {
  const source = [
    "## Pomodoros",
    "- [ ] (**0920-0950** [t:: 30m])",
    "\t- ![[Tasks#^a]]",
  ].join("\n");
  const { harness, editor, plugin, view } = openDaily(source, { line: 2, ch: 6 });
  const { calls } = installLaneStub(plugin);

  assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true);
  assert.equal(plugin.handleCycleCommand(false, editor, view, -1), true);

  assert.equal(calls.toggle.length, 1);
  assert.equal(editor.getValue(), source);
  assert.equal(harness.getSource("Tasks.md"), "- [ ] #task A ^a");
});

test("entry, task, Depends-On, and non-Pomodoro lines keep today's behavior", () => {
  // Pomodoro entry line: still a task-line cycle, no delegation.
  {
    const { editor, plugin, view } = openDaily(DAILY, { line: 1, ch: 4 });
    const { calls } = installLaneStub(plugin, { matches: () => false });

    assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true);
    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(calls.toggle.length, 0);
    assert.notEqual(editor.getLine(1), "- [ ] (**0920-0950** [t:: 30m])");
  }

  // Plain task line: still a task-line cycle, no delegation.
  {
    const source = "- [ ] #task Ship it";
    const harness = createInMemoryObsidianApp({ "Daily.md": source });
    const editor = createTextEditor(source, { line: 0, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    const { view } = attachActiveMarkdownView(plugin, harness, editor, "Daily.md");
    plugin.app.commands = { commands: {}, executeCommandById: () => false };
    const { calls } = installLaneStub(plugin, { matches: () => false });

    assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true);
    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(calls.toggle.length, 0);
    assert.equal(editor.getLine(0), "- [/] #task Ship it");
  }

  // Depends-On line: still claimed by the dependency branch, no delegation.
  {
    const source = [
      "- [ ] #task Ship it ^ship",
      "\t- ⛓️ **DEPENDS ON:** [[Tasks#^a]]",
    ].join("\n");
    const { editor, plugin, view } = openDaily(source, { line: 1, ch: 20 });
    const { calls } = installLaneStub(plugin, { matches: () => false });

    assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true);
    assert.equal(calls.toggle.length, 0);
  }

  // Plain and embedded links outside Pomodoros: no delegation.
  for (const bullet of ["\t- [[Tasks#^a]]", "\t- ![[Tasks#^a]]"]) {
    const source = ["## Notes", "- [ ] Focus", bullet].join("\n");
    const { editor, plugin, view } = openDaily(source, { line: 2, ch: 5 });
    const { calls } = installLaneStub(plugin, { matches: () => false });

    assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true, bullet);
    assert.equal(calls.toggle.length, 0, bullet);
  }
});

function openCountedDaily({ repeat = 2 } = {}) {
  const { harness, editor, plugin, view } = openDaily();
  const { calls } = installLaneStub(plugin);
  const vimInputState = {
    prefixRepeat: [],
    motionRepeat: [],
    keyBuffer: [],
    getRepeat: () => repeat,
  };
  const fakeCm = {
    getCursor: () => ({ ...editor.getCursor() }),
    getLine: (line) => editor.getLine(line),
    replaceRange: () => {},
    setCursor: () => {},
    state: { vim: { inputState: vimInputState } },
  };
  editor.cm = { cm: fakeCm };
  view.containerEl = { contains: () => true };
  const prevented = [];
  const event = {
    target: { closest: () => ({}) },
    preventDefault: () => prevented.push("preventDefault"),
    stopPropagation: () => prevented.push("stopPropagation"),
    stopImmediatePropagation: () => prevented.push("stopImmediatePropagation"),
  };
  return { harness, editor, plugin, view, event, prevented, calls, vimInputState };
}

test("counted Alt+] on a Task Link delegates with countExplicit and the Vim repeat", () => {
  const { harness, editor, plugin, view, event, prevented, calls } =
    openCountedDaily({ repeat: 2 });

  assert.equal(plugin.dispatchCountedTaskCycleEvent(event, 1), true);
  assert.deepEqual(prevented, [
    "preventDefault",
    "stopPropagation",
    "stopImmediatePropagation",
  ]);
  assert.equal(calls.toggle.length, 1);
  assert.equal(calls.toggle[0].editor, editor);
  assert.equal(calls.toggle[0].view, view);
  assert.equal(calls.toggle[0].countExplicit, true);
  assert.equal(calls.toggle[0].additionalTaskCount, 2);

  assert.equal(editor.getValue(), DAILY, "no range write ran");
  assert.equal(harness.getSource("Tasks.md"), "- [ ] #task A ^a");
});

test("counted dispatch without an explicit repeat leaves the key alone", () => {
  const { editor, plugin, view, calls } = openCountedDaily();
  editor.cm.cm.state.vim.inputState.getRepeat = () => null;
  const event = {
    target: { closest: () => ({}) },
    preventDefault: () => {},
    stopPropagation: () => {},
  };

  assert.equal(plugin.dispatchCountedTaskCycleEvent(event, 1), false);
  assert.equal(calls.toggle.length, 0);
});

test("counted range starting elsewhere skips Task Link lines", async () => {
  const source = ["- [ ] task one", "\t- [[Tasks#^a]]", "- [ ] task three"].join(
    "\n",
  );
  const harness = createInMemoryObsidianApp({
    "Daily.md": source,
    "Tasks.md": "- [ ] #task A ^a",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  const { file } = attachActiveMarkdownView(plugin, harness, editor, "Daily.md");
  plugin.app.commands = { commands: {}, executeCommandById: () => false };
  const { calls } = installLaneStub(plugin, {
    matches: (args) => args.line === 1,
  });

  const changed = await plugin.cycleTaskStatusRange(editor, file, 1, 2);

  assert.equal(changed, true, "the surrounding task lines still cycle");
  assert.equal(editor.getLine(0), "- [/] task one");
  assert.equal(editor.getLine(1), "\t- [[Tasks#^a]]", "lane line skipped");
  assert.equal(editor.getLine(2), "- [/] task three");
  assert.equal(harness.getSource("Tasks.md"), "- [ ] #task A ^a");
  assert.ok(
    calls.matches.some((call) => call.line === 1),
    "the range consulted matches for the lane line",
  );
});

test("legacy fallback with no api keeps today's behavior", async () => {
  const { harness, editor, plugin, view } = openDaily();

  assert.equal(plugin.getTaskLinkLaneApi(), null);
  assert.equal(plugin.isTaskLinkLaneLine(editor, "Daily.md"), false);

  assert.equal(plugin.handleCycleCommand(true, editor, view, 1), true);
  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  assert.equal(
    editor.getLine(2),
    "\t- **[[Tasks#^a]]**",
    "falls through to today's formatting toggle",
  );

  assert.equal(
    harness.getSource("Tasks.md"),
    "- [ ] #task A ^a",
    "the linked task is untouched",
  );
});
