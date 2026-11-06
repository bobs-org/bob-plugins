// Parked-event successor API (plan:202611/starts_after_relation.md phase
// obsidian_unlink). offerParkedSuccessors is cycler api v4: relation-only
// offers with event: parked, silence for still-linked and non-Pending
// targets, never throws.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  helpers,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
} = require("./task-status-cycler-harness.cjs");
const navigationHarness = require("./navigation-hotkeys-harness.cjs");

const TODAY = helpers.formatLocalDate();
const DAILY_NOW = new Date(`${TODAY}T12:00:00`);
const DAILY_PATH = helpers.todayDailyPath({}, DAILY_NOW);

function makePlugin(harness, editor, path) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => TODAY;
  plugin.getPomodoroWorkLogStamp = () => `${TODAY} 12:00`;
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor, path);
  if (!harness.app.commands) {
    harness.app.commands = { commands: {}, executeCommandById: () => false };
  }
  return plugin;
}

function installNavStub(plugin, seen, pickOverride = null, successorsVersion = 3) {
  const previous = plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "bob-navigation-hotkeys": {
        api: {
          version: 3,
          notice: {
            version: 3,
            showUnblocked(model) {
              seen.push(model);
              return true;
            },
          },
          successors: {
            version: successorsVersion,
            async pick(model) {
              if (typeof pickOverride === "function") {
                return pickOverride(model);
              }
              const picks = [];
              for (const group of (model && model.groups) || []) {
                for (const row of (group && group.rows) || []) {
                  if (row && row.selectable && row.key) {
                    picks.push({ key: String(row.key) });
                  }
                }
              }
              return { picks };
            },
          },
        },
      },
    },
  };
}

function installTasksStub(plugin, tasks, state = "Warm") {
  const previous = plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "obsidian-tasks-plugin": {
        apiV1: { getTasks: () => tasks, getState: () => state },
      },
    },
  };
}

let relationConfigSequence = 0;

function relationConfig() {
  relationConfigSequence += 1;
  const configPath = `/tmp/bob-cycler-parked-${relationConfigSequence}.yml`;
  return {
    configPath,
    env: { HOME: "/tmp", XDG_CONFIG_HOME: "/tmp" },
    fsModule: {
      statSync: () => ({ mtimeMs: relationConfigSequence, size: 40 }),
      readFileSync: () => "relations:\n  successor_labels: [starts after]\n",
    },
    parseYaml: () => ({ relations: { successor_labels: ["starts after"] } }),
  };
}

function tasksFromSources(sources) {
  return helpers.tasksFromDocuments(
    Object.entries(sources).map(([path, text]) => ({ path, text })),
  ).map((task) => ({
    path: task.path,
    lineNumber: task.line,
    status: task.status,
    originalMarkdown: task.lineText,
    description: task.text,
    blockId: task.blockId,
    id: task.taskId,
    dependsOn: task.dependsOn,
  }));
}

function makeParkedFixture({
  targetStatus = "/",
  day = null,
  pickOverride = null,
  successorsVersion = 3,
} = {}) {
  const parked = `- [${targetStatus}] #task Send implementation prompt [id:: agents__implement] ^implement`;
  const source = [
    "- [ ] #task Prepare evaluation prompt ^evaluate",
    "  - 🪢 **LINKS:** starts after [[agents#^implement]]",
  ].join("\n");
  const daily = day || [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — BUILD",
    "  - leftover",
  ].join("\n");
  const sources = {
    "agents.md": `${parked}\n${source}`,
    [DAILY_PATH]: daily,
  };
  const harness = createInMemoryObsidianApp(sources);
  const editor = createTextEditor(daily, { line: 3, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen, pickOverride, successorsVersion);
  installTasksStub(plugin, tasksFromSources(sources));
  const relationIndex = helpers.buildFakeRelationIndex(sources);
  plugin.app.plugins.plugins["bob-ledger-tools"].api.relationIndex = {
    version: 2,
    ...relationIndex,
  };
  return {
    identity: {
      path: "agents.md",
      blockId: "implement",
      taskId: "agents__implement",
      text: "Send implementation prompt",
    },
    config: relationConfig(),
    daily,
    editor,
    harness,
    plugin,
    seen,
    slot: { entryLine: 3, bulletLine: 4, entryDeleted: false },
  };
}

test("cycler api v4 offerParkedSuccessors is frozen and never throws", () => {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.addCommand = () => {};
  plugin.registerEvent = () => {};
  plugin.registerChildBulletInputListeners = () => {};
  plugin.registerPomodoroBulletToggleInputListeners = () => {};
  plugin.registerCountedTaskCycleInputListeners = () => {};
  plugin.app = {
    workspace: { on: () => ({}), onLayoutReady: () => {} },
    vault: { on: () => ({}) },
  };
  plugin.onload();

  assert.equal(plugin.api.version, 4);
  assert.equal(Object.isFrozen(plugin.api), true);
  assert.equal(typeof plugin.api.offerParkedSuccessors, "function");
});

test("offerParkedSuccessors offers a starts-after source at the parked slot", async () => {
  notices.length = 0;
  const fixture = makeParkedFixture();
  const result = await fixture.plugin.offerParkedSuccessors([fixture.identity], {
    dailyPath: DAILY_PATH,
    relationConfig: fixture.config,
    slot: fixture.slot,
  });

  assert.equal(result.offered, 1);
  assert.equal(result.picked, 1);
  assert.match(
    fixture.harness.getSource("agents.md"),
    /^- \[\*\] #task Prepare evaluation prompt \^evaluate/m,
  );
  assert.equal(fixture.seen.length, 1);
  const row = fixture.seen[0].relation_successors[0];
  assert.equal(row.relation.event, "parked");
  assert.ok(row.link);
});

test("parked relation offer combines one pull-in, Done, and reasoned Cancel", async () => {
  notices.length = 0;
  const parked = "- [/] #task Send implementation prompt [id:: agents__implement] ^implement";
  const pick = [
    "- [ ] #task Pull into BUILD [id:: agents__pick] ^pick",
    "  - 🪢 **LINKS:** starts after [[agents#^implement]]",
  ].join("\n");
  const done = [
    "- [ ] #task Resolve as Done [id:: agents__done] ^done",
    "  - 🪢 **LINKS:** starts after [[agents#^implement]]",
  ].join("\n");
  const cancel = [
    "- [ ] #task Resolve as Cancel [id:: agents__cancel] ^cancel",
    "  - 🪢 **LINKS:** starts after [[agents#^implement]]",
  ].join("\n");
  const leaf = "- [?] #task Done cascade [fresh:: 2026-11-01] [dependsOn:: agents__done] [id:: agents__leaf] ^leaf";
  const source = [parked, pick, done, cancel, leaf].join("\n");
  const daily = [
    `# ${TODAY}`, "", "## Pomodoros", "- [ ] () — BUILD", "  - leftover",
  ].join("\n");
  const sources = { "agents.md": source, [DAILY_PATH]: daily };
  const harness = createInMemoryObsidianApp(sources);
  const editor = createTextEditor(daily, { line: 3, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  const shown = [];
  const offeredKeys = {};
  plugin.app.plugins.plugins["bob-navigation-hotkeys"] = {
    api: {
      version: 4,
      cancel: navigationHarness.helpers.createCancelApi(),
      successors: {
        version: 4,
        async pick(model) {
          const rows = model.groups.flatMap((group) => group.rows || []);
          for (const text of ["Pull into BUILD", "Resolve as Done", "Resolve as Cancel"]) {
            const row = rows.find((candidate) => candidate.text === text);
            assert.ok(row, `missing parked relation row ${text}: ${JSON.stringify(rows)}`);
            offeredKeys[text] = row.key;
          }
          assert.ok(rows.find((row) => row.key === offeredKeys["Resolve as Done"]).close.complete);
          assert.ok(rows.find((row) => row.key === offeredKeys["Resolve as Cancel"]).close.cancel);
          seen.push(model);
          return {
            picks: [{ key: offeredKeys["Pull into BUILD"] }],
            closes: [
              { key: offeredKeys["Resolve as Done"], outcome: "done" },
              { key: offeredKeys["Resolve as Cancel"], outcome: "cancelled", reason: "obsolete" },
            ],
          };
        },
      },
      notice: {
        version: 4,
        showUnblocked(model) { shown.push(model); return true; },
      },
    },
  };
  installTasksStub(plugin, tasksFromSources(sources));
  plugin.app.plugins.plugins["bob-ledger-tools"].api.relationIndex = {
    version: 2,
    ...helpers.buildFakeRelationIndex(sources),
  };
  const result = await plugin.offerParkedSuccessors([{
    path: "agents.md", blockId: "implement", taskId: "agents__implement",
    text: "Send implementation prompt",
  }], {
    dailyPath: DAILY_PATH,
    relationConfig: relationConfig(),
    slot: { entryLine: 3, bulletLine: 4, entryDeleted: false },
  });

  assert.equal(seen.length, 1, "the parked route opens one relation picker");
  assert.equal(shown.length, 1, "all three outcomes share one receipt");
  assert.equal(result.picked, 1, "only the explicit pull-in is linked");
  const final = harness.getSource("agents.md");
  assert.match(final, /^- \[\*\] #task Pull into BUILD/m);
  assert.match(final, /^- \[x\] #task Resolve as Done/m);
  assert.match(final, /^- \[-\] #task Resolve as Cancel .*\[cancelled:: .*\]/m);
  assert.match(final, /obsolete/);
  assert.match(final, /^- \[ \] #task Done cascade .*\[unblocked:: \d{4}-\d{2}-\d{2}\]/m);
  assert.equal(shown[0].offer_closes.length, 2);
  assert.equal(shown[0].offer_closes.reduce((sum, row) => sum + row.recovered.length, 0), 1,
    "only the Done root recovers the leaf");
  assert.ok(shown[0].undo, "the combined receipt keeps Undo for verdict writes");
});

test("offerParkedSuccessors stays silent when the target is still live-linked today", async () => {
  notices.length = 0;
  const stillLinked = [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — BUILD",
    "  - [[agents#^implement]]",
  ].join("\n");
  const fixture = makeParkedFixture({ day: stillLinked });
  const result = await fixture.plugin.offerParkedSuccessors([fixture.identity], {
    dailyPath: DAILY_PATH,
    relationConfig: fixture.config,
    slot: fixture.slot,
  });

  assert.deepEqual(result, { offered: 0, picked: 0 });
  assert.match(
    fixture.harness.getSource("agents.md"),
    /^- \[ \] #task Prepare evaluation prompt \^evaluate/m,
  );
  assert.equal(fixture.seen.length, 0);
});

test("offerParkedSuccessors stays silent when the target is not Pending", async () => {
  notices.length = 0;
  const fixture = makeParkedFixture({ targetStatus: "*" });
  const result = await fixture.plugin.offerParkedSuccessors([fixture.identity], {
    dailyPath: DAILY_PATH,
    relationConfig: fixture.config,
    slot: fixture.slot,
  });

  assert.deepEqual(result, { offered: 0, picked: 0 });
  assert.match(
    fixture.harness.getSource("agents.md"),
    /^- \[ \] #task Prepare evaluation prompt \^evaluate/m,
  );
  assert.equal(fixture.seen.length, 0);
});

test("offerParkedSuccessors Esc on the picker offers without picking", async () => {
  notices.length = 0;
  const fixture = makeParkedFixture({
    pickOverride: async () => ({ picks: [] }),
  });
  const result = await fixture.plugin.offerParkedSuccessors([fixture.identity], {
    dailyPath: DAILY_PATH,
    relationConfig: fixture.config,
    slot: fixture.slot,
  });

  assert.equal(result.offered, 1);
  assert.equal(result.picked, 0);
  assert.match(
    fixture.harness.getSource("agents.md"),
    /^- \[ \] #task Prepare evaluation prompt \^evaluate/m,
  );
});

test("offerParkedSuccessors plans no relation group when nav successors is below v3", async () => {
  notices.length = 0;
  const fixture = makeParkedFixture({ successorsVersion: 2 });
  const result = await fixture.plugin.offerParkedSuccessors([fixture.identity], {
    dailyPath: DAILY_PATH,
    relationConfig: fixture.config,
    slot: fixture.slot,
  });

  assert.deepEqual(result, { offered: 0, picked: 0 });
  assert.match(
    fixture.harness.getSource("agents.md"),
    /^- \[ \] #task Prepare evaluation prompt \^evaluate/m,
  );
});

test("offerParkedSuccessors resolves quiet on empty identities and never throws", async () => {
  const fixture = makeParkedFixture();
  const empty = await fixture.plugin.offerParkedSuccessors([], {
    dailyPath: DAILY_PATH,
    relationConfig: fixture.config,
  });
  assert.deepEqual(empty, { offered: 0, picked: 0 });
  const malformed = await fixture.plugin.offerParkedSuccessors(null, {
    dailyPath: DAILY_PATH,
    relationConfig: fixture.config,
  });
  assert.deepEqual(malformed, { offered: 0, picked: 0 });
});
