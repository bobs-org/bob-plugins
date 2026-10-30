const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const {
  TaskStatusCyclerPlugin,
  helpers,
  notices,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  registerTaskToggleVimAction,
  flushAsyncActions,
  installTasksCloseCommand,
} = require("./task-status-cycler-harness.cjs");
const {
  helpers: navigationHelpers,
  parseTestYaml,
} = require("./navigation-hotkeys-harness.cjs");

// Use the ledger-tools' real task-theme transforms in the successor runtime
// tests. The harness APIs below fake only the suggestion and caps inputs.
const originalModuleLoad = Module._load;
Module._load = function loadLedgerToolsWithTestStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class Empty {}
    return {
      MarkdownRenderChild: Empty,
      MarkdownView: Empty,
      Notice: class {},
      Platform: { isDesktopApp: true, isMobile: false },
      Plugin: Empty,
      normalizePath: (value) => String(value || ""),
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {}, keymap: { of: (value) => value } };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
let ledgerThemeHelpers;
try {
  ledgerThemeHelpers = require("../plugins/bob-ledger-tools/main.js").helpers;
} finally {
  Module._load = originalModuleLoad;
}

// Guard tests for the `cycler_wiring` pass (plan:202610/successor_links.md):
// the gated recover-and-link inside `finalizeClosedTasks`, the Pomodoro
// closing-entry hint, editor/vault write-through with preimage checks, and
// the single-notice reporting (nav card, walk toast, plain fallback).

const TODAY = helpers.formatLocalDate();
const DAILY_NOW = new Date(`${TODAY}T12:00:00`);
// Today's daily path under the default daily-notes settings (no
// daily-notes plugin configured in the harness app).
const DAILY_PATH = helpers.todayDailyPath({}, DAILY_NOW);

function makePlugin(harness, editor, path) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => TODAY;
  plugin.getPomodoroWorkLogDateString = () => TODAY;
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor, path);
  if (!harness.app.commands) {
    harness.app.commands = { commands: {}, executeCommandById: () => false };
  }
  return plugin;
}

function installNavStub(plugin, seen, pickOverride = null) {
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
            version: 1,
            showUnblocked(model) {
              seen.push(model);
              return true;
            },
          },
          // SO picker fake: explicitly return all offers (select-all).
          successors: {
            version: 1,
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

function installRealTaskThemeApi(plugin, suggestFor) {
  const holder = plugin.app.plugins.plugins["bob-ledger-tools"];
  holder.api.caps = () => ({ exempt: ["PLAN"], strict: false, maxThemes: 5 });
  const sources = { vocab: ["WRITE", "FIX", "BUILD", "DEEP"], exempt: ["PLAN"], inventory: [] };
  const keyOf = (value) => {
    const candidate = value && typeof value === "object"
      ? value.theme && typeof value.theme === "object" ? value.theme : value
      : null;
    return candidate && typeof candidate.key === "string" ? candidate.key : value;
  };
  const entriesForPlacement = (options) => Array.isArray(options.entries)
    ? options.entries
    : [];
  holder.api.themes = {
    version: 1,
    suggestFor,
    taskThemeOf: ledgerThemeHelpers.pomodoroThemeTaskFieldState,
    setTaskTheme: ledgerThemeHelpers.pomodoroThemeSetTaskTheme,
    clearTaskTheme: ledgerThemeHelpers.pomodoroThemeClearTaskTheme,
    effectiveTypeFor: suggestFor,
    typeComponentsOf: (name) => ledgerThemeHelpers.typeComponents(name, sources),
    typeAgrees: (taskKey, entryName) =>
      ledgerThemeHelpers.typeAgrees(keyOf(taskKey), entryName, sources),
    planRetype: (options = {}) => {
      const effective = options.effective !== undefined ? options.effective : options.suggestion;
      const inherited = options.inheritedKey !== undefined ? options.inheritedKey : options.inherited;
      return ledgerThemeHelpers.planRetype({
        field: options.field,
        effectiveKey: keyOf(effective),
        effectiveName: ledgerThemeHelpers.taskTypeThemeNameOf(effective),
        inheritedKey: keyOf(inherited),
        destination: options.destination !== undefined ? options.destination : options.destinationName,
        selector: options.selector,
        keepType: options.keepType,
        tabPick: options.tabPick,
      }, sources);
    },
    planPlacement: (options = {}) => ledgerThemeHelpers.planPlacement({
      typeKey: options.typeKey !== undefined ? options.typeKey : options.type,
      typeName: options.typeName,
      entries: entriesForPlacement(options),
      exempt: options.exempt !== undefined ? options.exempt : sources.exempt,
      ledgerKeys: options.ledgerKeys,
      themesBefore: options.themesBefore,
      cap: options.cap !== undefined ? options.cap : 5,
      strict: options.strict === true,
      alreadyQueued: options.alreadyQueued,
    }),
    snapshot: () => ({
      themes: sources.vocab.map((name) => ({ key: name.toLowerCase(), name })),
      configured_themes: sources.vocab.map((name) => ({ key: name.toLowerCase(), name })),
    }),
  };
}

async function pressCtrlEnterAndSettle(plugin, editor) {
  const action = registerTaskToggleVimAction(plugin);
  action(editor);
  for (let round = 0; round < 12; round += 1) {
    await flushAsyncActions();
  }
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

function countVaultReads(harness) {
  const counts = { cachedRead: [], read: [], process: [], modify: [] };
  const vault = harness.app.vault;
  for (const key of Object.keys(counts)) {
    const original = vault[key];
    if (typeof original !== "function") {
      continue;
    }
    vault[key] = async (...args) => {
      const file = args[0];
      counts[key].push(file && file.path ? file.path : "?");
      return original.apply(vault, args);
    };
  }
  return counts;
}

const FIX_LINE =
  "- [ ] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo";
const FIX_DONE_LINE =
  "- [x] #task Fix apollo machine! [id:: sase__fix-apollo] ^fix-apollo";
const FIX_CLOSED_STAMPED_LINE =
  `- [x] #task Fix apollo machine! [id:: sase__fix-apollo]  [completion:: ${TODAY}] ^fix-apollo`;
const DEPENDENT_LINE =
  "- [?] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed";
const DEPENDENT_NEXT_LINE =
  "- [*] #task Re-launch all failed agents on apollo! [dependsOn:: sase__fix-apollo] ^relaunch-failed";

function fixDay(linkLine = "\t- [[sase#^fix-apollo]]") {
  return [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — FIX", linkLine].join(
    "\n",
  );
}

test("link close links the unblocked successor into the slot and shows the nav card", async () => {
  notices.length = 0;
  const day = fixDay();
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });

  assert.equal(result.resolved, true);
  assert.equal(result.changed, true);
  // The strike still lands on the cursor link: the successor was inserted
  // below it, so line 4 is the struck link and line 5 is the new bullet.
  assert.match(editor.getLine(4), /~~\[\[sase#\^fix-apollo\]\]~~/);
  assert.equal(editor.getLine(5), "\t- [[sase#^relaunch-failed]]");
  assert.equal(
    harness.getSource("sase.md"),
    [FIX_CLOSED_STAMPED_LINE, DEPENDENT_NEXT_LINE].join("\n"),
  );
  assert.equal(seen.length, 1);
  const model = seen[0];
  assert.equal(model.unblocked.length, 1);
  assert.equal(model.unblocked[0].block_id, "relaunch-failed");
  assert.equal(model.unblocked[0].status_symbol, "*");
  assert.equal(model.unblocked[0].link.entry_name, "FIX");
  assert.equal(model.unblocked[0].link.entry_created, false);
  assert.equal(model.unblocked[0].not_linked, null);
  assert.deepEqual(model.unblocked[0].unblocked_by, [
    {
      note_path: "sase.md",
      block_id: "fix-apollo",
      text: "Fix apollo machine!",
    },
  ]);
  assert.equal(model.failure, null);
  assert.equal(notices.length, 0);
});

test("Ctrl+Enter close preserves bracket and parenthesis theme fields", async () => {
  for (const field of ["[theme:: FIX]", "(theme:: FIX)"]) {
    notices.length = 0;
    const source = `- [ ] #task Keep this task ${field} ^keep`;
    const harness = createInMemoryObsidianApp({ "Keep.md": source });
    const editor = createTextEditor(source, { line: 0, ch: 4 });
    const plugin = makePlugin(harness, editor, "Keep.md");
    installTasksCloseCommand(plugin, editor);

    await pressCtrlEnterAndSettle(plugin, editor);

    assert.match(editor.getLine(0), /^- \[x\] #task/);
    assert.ok(editor.getLine(0).includes(field), `Ctrl+Enter retains ${field}`);
  }
});

test("Ctrl+Enter carries per-task theme intents through both pick normalizers and saves them with successor links", async () => {
  notices.length = 0;
  const closeLine = "- [ ] #task Finish the release [id:: work__finish] ^finish";
  const aLine = "- [?] #task Write the changelog [dependsOn:: work__finish] ^changelog";
  const bLine = "- [?] #task Fix the launch [dependsOn:: work__finish] ^launch";
  const localLine = "- [?] #task Local follow-up [dependsOn:: work__finish] ^local";
  const day = [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[work#^finish]]",
    "- [ ] () — BUILD",
    "- [ ] () — DEEP",
    "## Tasks",
    localLine,
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "work.md": closeLine,
    "a.md": ["---", "theme: WRITE", "---", aLine].join("\n"),
    "b.md": ["---", "theme: DEEP", "---", bLine].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(closeLine, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "work.md");
  installTasksCloseCommand(plugin, editor);
  const shown = {
    "a.md": {
      theme: { key: "write", name: "WRITE", known: true },
      source: "note",
      label: "from a",
    },
    "b.md": {
      theme: { key: "deep", name: "DEEP", known: true },
      source: "note",
      label: "from b",
    },
    [DAILY_PATH]: {
      theme: { key: "write", name: "WRITE", known: true },
      source: "note",
      label: "from today",
    },
  };
  const suggestCalls = [];
  installRealTaskThemeApi(plugin, (request) => {
    suggestCalls.push(request);
    return shown[request.path] || null;
  });
  const seen = [];
  const destinationByPath = {
    "a.md": { entryLine: 5, entryText: "- [ ] () — BUILD" },
    "b.md": { entryLine: 3, entryText: "- [ ] () — FIX" },
    [DAILY_PATH]: { entryLine: 6, entryText: "- [ ] () — DEEP" },
  };
  installNavStub(plugin, seen, async (model) => {
    const picks = [];
    for (const group of model.groups || []) {
      for (const row of group.rows || []) {
        if (!row || row.selectable !== true || !row.key) continue;
        const taskPath = row.task && row.task.path;
        const chosen = destinationByPath[taskPath];
        assert.ok(chosen, `task context on picker row: ${JSON.stringify(row)}`);
        const rawDestination = {
          kind: "existing",
          ...chosen,
          themeIntent: {
            deliberate: true,
            linkOnce: false,
            shown: shown[taskPath],
          },
        };
        // This mirrors the navigation picker's result normalization; the
        // cycler applies its own normalizeSuccessorPicks after this API call.
        const destination = navigationHelpers.normalizeSuccessorDestinationOverride(rawDestination);
        picks.push({ key: String(row.key), destination });
      }
    }
    return { picks };
  });
  let finalized = null;
  const finalize = plugin.finalizeClosedTasks.bind(plugin);
  plugin.finalizeClosedTasks = async (...args) => {
    finalized = await finalize(...args);
    return finalized;
  };

  await pressCtrlEnterAndSettle(plugin, editor);

  assert.match(editor.getLine(0), /^- \[x\]/, "the real Ctrl+Enter close landed");
  assert.match(harness.getSource("a.md"), /\[type:: BUILD\]/);
  assert.match(harness.getSource("b.md"), /\[type:: FIX\]/);
  assert.match(harness.getSource(DAILY_PATH), /\[type:: DEEP\]/);
  assert.match(harness.getSource("a.md"), /\[\*\].*\^changelog/);
  assert.match(harness.getSource("b.md"), /\[\*\].*\^launch/);
  assert.match(harness.getSource(DAILY_PATH), /\t- \[\[a#\^changelog\]\]/);
  assert.match(harness.getSource(DAILY_PATH), /\t- \[\[b#\^launch\]\]/);
  assert.match(harness.getSource(DAILY_PATH), /\[\*\] #task Local follow-up.*\[type:: DEEP\]/);
  assert.ok(harness.getSource(DAILY_PATH).includes(`\t- [[${DAILY_PATH.split("/").pop().replace(/\.md$/i, "")}#^local]]`));
  assert.equal(suggestCalls.some((request) => request.path === "a.md"), true);
  assert.equal(suggestCalls.some((request) => request.path === "b.md"), true);
  assert.equal(seen.length, 1);
  assert.equal(finalized.successors.unblocked.filter((row) => row.theme_changed).length, 3);
  assert.equal(finalized.successors.failure, null);
});

test("default placement and a changed suggestion still link selected successors without retargeting themes", async () => {
  notices.length = 0;
  const closeLine = "- [ ] #task Finish the release [id:: work__finish] ^finish";
  const day = [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[work#^finish]]",
    "- [ ] () — BUILD",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "work.md": closeLine,
    "a.md": "- [?] #task Default link [dependsOn:: work__finish] ^default-link",
    "b.md": "- [?] #task Changed suggestion [dependsOn:: work__finish] ^changed-suggestion",
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(closeLine, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "work.md");
  installTasksCloseCommand(plugin, editor);
  const oldSuggestion = {
    theme: { key: "write", name: "WRITE", known: true },
    source: "note",
    label: "from b",
  };
  const changedSuggestion = {
    theme: { key: "deep", name: "DEEP", known: true },
    source: "note",
    label: "from b",
  };
  let currentSuggestion = oldSuggestion;
  installRealTaskThemeApi(plugin, ({ path }) => path === "b.md" ? currentSuggestion : oldSuggestion);
  const seen = [];
  installNavStub(plugin, seen, async (model) => {
    const picks = [];
    for (const group of model.groups || []) {
      for (const row of group.rows || []) {
        if (!row || row.selectable !== true || !row.key) continue;
        if (row.task && row.task.path === "b.md") {
          const destination = navigationHelpers.normalizeSuccessorDestinationOverride({
            kind: "existing",
            entryLine: 5,
            entryText: "- [ ] () — BUILD",
            themeIntent: { deliberate: true, linkOnce: false, shown: oldSuggestion },
          });
          picks.push({ key: row.key, destination });
        } else {
          // A selection with no destination uses its ordinary anchor.
          picks.push({ key: row.key });
        }
      }
    }
    currentSuggestion = changedSuggestion;
    return { picks };
  });
  let finalized = null;
  const finalize = plugin.finalizeClosedTasks.bind(plugin);
  plugin.finalizeClosedTasks = async (...args) => {
    finalized = await finalize(...args);
    return finalized;
  };

  await pressCtrlEnterAndSettle(plugin, editor);

  assert.doesNotMatch(harness.getSource("a.md"), /\[theme::/);
  assert.doesNotMatch(harness.getSource("b.md"), /\[theme::/);
  assert.match(harness.getSource("a.md"), /^- \[\*\]/);
  assert.match(harness.getSource("b.md"), /^- \[\*\]/);
  assert.match(harness.getSource(DAILY_PATH), /\t- \[\[a#\^default-link\]\]/);
  assert.match(harness.getSource(DAILY_PATH), /\t- \[\[b#\^changed-suggestion\]\]/);
  const defaultRow = finalized.successors.unblocked.find((row) => row.block_id === "default-link");
  const changedRow = finalized.successors.unblocked.find((row) => row.block_id === "changed-suggestion");
  assert.equal(defaultRow.theme_changed, undefined);
  assert.equal(defaultRow.link.entry_name, "WRITE");
  assert.equal(changedRow.theme_changed, false);
  assert.equal(changedRow.theme_suggestion_changed, true);
  assert.equal(changedRow.link.entry_name, "BUILD");
});

test("project-finished successor writes its selected theme with real task-theme transforms", async () => {
  notices.length = 0;
  const childPath = "projects/child.md";
  const parentPath = "projects/parent.md";
  const day = [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — CHILD",
    "\t- [[projects/child#^prj]]",
    "- [ ] () — BUILD",
  ].join("\n");
  const child = [
    "---",
    'type: "[[project]]"',
    'parent: "[[projects/parent|Parent]]"',
    "---",
    "- [ ] #task #prj Child project ^prj",
  ].join("\n");
  const parent = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "theme: WRITE",
    "---",
    "- [ ] #task #prj Parent project #hide ^prj",
    "  - 🧩 **Sub-projects:** [[projects/child|Child]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    [childPath]: child,
    [parentPath]: parent,
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const shown = {
    theme: { key: "write", name: "WRITE", known: true },
    source: "note",
    label: "from parent",
  };
  installRealTaskThemeApi(plugin, () => shown);
  const seen = [];
  installNavStub(plugin, seen, async (model) => {
    const row = model.groups.flatMap((group) => group.rows || []).find(
      (item) => item && item.selectable && item.task && item.task.path === parentPath,
    );
    assert.ok(row, "project-finished picker row includes the parent task context");
    const destination = navigationHelpers.normalizeSuccessorDestinationOverride({
      kind: "existing",
      entryLine: 5,
      entryText: "- [ ] () — BUILD",
      themeIntent: { deliberate: true, linkOnce: false, shown },
    });
    return { picks: [{ key: row.key, destination }] };
  });

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });

  assert.equal(result.resolved, true);
  assert.equal(result.changed, true);
  assert.match(harness.getSource(parentPath), /^- \[\*\] #task #prj Parent project \[type:: BUILD\] \^prj$/m);
  assert.doesNotMatch(harness.getSource(parentPath), /#hide/);
  assert.match(editor.getValue(), /\t- \[\[parent#\^prj\]\]/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].unblocked[0].trigger, "project_empty");
  assert.equal(seen[0].unblocked[0].theme_changed, true);
  assert.equal(seen[0].failure, null);
});

test("successor theme save remains truthful when the later daily-link write fails", async () => {
  notices.length = 0;
  const closeLine = "- [ ] #task Finish the release [id:: work__finish] ^finish";
  const dependentLine = "- [?] #task Write the changelog [dependsOn:: work__finish] ^changelog";
  const day = [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- [[work#^finish]]",
    "- [ ] () — BUILD",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "work.md": closeLine,
    "a.md": dependentLine,
    [DAILY_PATH]: day,
  });
  const originalProcess = harness.app.vault.process;
  const writes = [];
  harness.app.vault.process = async (file, transform) => {
    writes.push(file.path);
    if (file.path === DAILY_PATH) {
      throw new Error("injected daily note write failure");
    }
    return originalProcess(file, transform);
  };
  const editor = createTextEditor(closeLine, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "work.md");
  installTasksCloseCommand(plugin, editor);
  const shown = {
    theme: { key: "write", name: "WRITE", known: true },
    source: "note",
    label: "from a",
  };
  installRealTaskThemeApi(plugin, () => shown);
  const seen = [];
  installNavStub(plugin, seen, async (model) => {
    const row = model.groups.flatMap((group) => group.rows || []).find((item) => item.selectable);
    assert.ok(row);
    const destination = navigationHelpers.normalizeSuccessorDestinationOverride({
      kind: "existing",
      entryLine: 5,
      entryText: "- [ ] () — BUILD",
      themeIntent: { deliberate: true, linkOnce: false, shown },
    });
    return { picks: [{ key: row.key, destination }] };
  });
  let finalized = null;
  const finalize = plugin.finalizeClosedTasks.bind(plugin);
  plugin.finalizeClosedTasks = async (...args) => {
    finalized = await finalize(...args);
    return finalized;
  };

  await pressCtrlEnterAndSettle(plugin, editor);

  assert.match(harness.getSource("a.md"), /\[type:: BUILD\]/);
  assert.ok(writes.includes("a.md"), "the guarded task-note edit was saved first");
  assert.ok(writes.includes(DAILY_PATH), "the daily insertion was attempted afterward");
  assert.equal(finalized.successors.failure.count, 1);
  assert.match(finalized.successors.failure.reason, /injected daily note write failure/);
  const row = finalized.successors.unblocked.find((item) => item.block_id === "changelog");
  assert.equal(row.link, null);
  assert.equal(row.theme_changed, true);
  assert.match(plugin.successorNoticeForModel(finalized.successors), /couldn't link 1 successor/);
  assert.match(plugin.successorNoticeForModel(finalized.successors), /task type saved/);
});

test("close with no [id::] performs zero vault reads and shows nothing", async () => {
  notices.length = 0;
  const source = "- [ ] #task Plain chore ^plain";
  const harness = createInMemoryObsidianApp({ "Note.md": source });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Note.md");
  const counts = countVaultReads(harness);
  const seen = [];
  installNavStub(plugin, seen);

  const taskStatus = plugin.getActiveTaskStatus(editor);
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Note.md" },
    taskStatus,
  );

  assert.equal(wrote, true);
  assert.equal(
    editor.getLine(0),
    `- [x] #task Plain chore  [completion:: ${TODAY}] ^plain`,
  );
  assert.deepEqual(counts.cachedRead, []);
  assert.deepEqual(counts.read, []);
  assert.deepEqual(counts.process, []);
  assert.deepEqual(counts.modify, []);
  assert.equal(seen.length, 0);
  assert.equal(notices.length, 0);
});

test("Warm finalize reads no unrelated note bodies on the real close path", async () => {
  notices.length = 0;
  const day = [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — FIX", "\t- [[p#^p]]"].join("\n");
  const harness = createInMemoryObsidianApp({
    "p.md": "- [x] #task Pred [id:: p] ^p",
    "a/d.md": "- [?] #task Dep [dependsOn:: p] [id:: d] ^d",
    "b/d.md": "# Notes\n\nProse about d things, no tasks here.\n",
    [DAILY_PATH]: day,
  });
  // Complete link metadata: the daily note links the predecessor; the
  // prose-only decoy links nothing, so retirement skips its body too.
  harness.app.metadataCache.resolvedLinks = {
    [DAILY_PATH]: { "p.md": 1 },
  };
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);
  installTasksStub(plugin, [
    {
      path: "p.md",
      lineNumber: 0,
      status: "x",
      originalMarkdown: "- [x] #task Pred [id:: p] ^p",
      description: "Pred",
      blockId: "p",
      id: "p",
      dependsOn: [],
    },
    {
      path: "a/d.md",
      lineNumber: 0,
      status: "?",
      originalMarkdown: "- [?] #task Dep [dependsOn:: p] [id:: d] ^d",
      description: "Dep",
      blockId: "d",
      id: "d",
      dependsOn: ["p"],
    },
  ]);
  const counts = countVaultReads(harness);

  // The entire gesture through the real `finalizeClosedTasks`: one gated
  // recover-and-link plan (no legacy full-scan recovery), linker-scoped
  // retirement, and exactly one notice.
  const result = await plugin.finalizeClosedTasks(
    [{ path: "p.md", blockId: "p" }],
    { editor, activePath: DAILY_PATH },
  );

  const model = result.successors;
  assert.ok(model);
  assert.equal(model.unblocked.length, 1);
  assert.equal(model.unblocked[0].status_symbol, "*");
  assert.ok(model.unblocked[0].link);
  assert.equal(model.unblocked[0].link.entry_name, "FIX");
  // The prose-only `b/d.md` sibling forces the long form, exactly like
  // Rust's walk-only catalog.
  assert.equal(model.unblocked[0].link.block_link, "[[a/d#^d]]");
  assert.equal(model.failure, null);
  // Recovery counts propagate from the same plan: one `?` changed.
  assert.equal(result.reopened, 1);
  assert.deepEqual(result.recoveryFailures, []);
  assert.deepEqual(result.retirementFailures, []);
  assert.equal(
    harness.getSource("a/d.md"),
    "- [*] #task Dep [dependsOn:: p] [id:: d] ^d",
  );
  assert.equal(editor.getLine(5), "\t- [[a/d#^d]]");
  // Related notes were read; the prose-only decoy and the open daily
  // buffer needed no body read at all.
  const allReads = [...counts.cachedRead, ...counts.read];
  assert.ok(!allReads.includes("b/d.md"));
  assert.ok(!allReads.includes(DAILY_PATH));
  assert.ok(allReads.includes("p.md"));
  assert.ok(allReads.includes("a/d.md"));
  // Exactly one notice for the whole gesture.
  assert.equal(seen.length, 1);
  assert.equal(notices.length, 0);
});

test("cold fallback still recovers and links without a Tasks cache", async () => {
  notices.length = 0;
  const day = fixDay();
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });

  assert.equal(result.changed, true);
  assert.equal(
    harness.getSource("sase.md"),
    [FIX_CLOSED_STAMPED_LINE, DEPENDENT_NEXT_LINE].join("\n"),
  );
  assert.equal(editor.getLine(5), "\t- [[sase#^relaunch-failed]]");
  assert.equal(seen.length, 1);
});

test("recovered-only close reports unblocked without linking (SO4 Esc)", async () => {
  notices.length = 0;
  // SO4/SO14: implicit offer exists (one open entry), but the picker returns
  // none (Esc) → recovery stands with not_selected, no mint, no link.
  const day = [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — FIX"].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 3, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);
  plugin.app.plugins.plugins["bob-navigation-hotkeys"].api.successors.pick = async () => null;

  const result = await plugin.finalizeClosedTasks(
    [
      {
        path: "sase.md",
        blockId: "fix-apollo",
        taskId: "sase__fix-apollo",
        text: "Fix apollo machine!",
      },
    ],
    { editor, activePath: DAILY_PATH },
  );

  assert.ok(result.successors);
  assert.equal(result.successors.unblocked.length, 1);
  const row = result.successors.unblocked[0];
  assert.equal(row.status_symbol, " ");
  assert.equal(row.link, null);
  assert.equal(row.not_linked, "not_selected");
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    `- [ ] #task Re-launch all failed agents on apollo! [unblocked:: ${TODAY}] [dependsOn:: sase__fix-apollo] ^relaunch-failed`,
  );
  assert.equal(editor.getValue(), day);
  assert.equal(seen.length, 1);
  assert.match(
    plugin.successorNoticeForModel(result.successors),
    /🔓 Unblocked/,
  );
  assert.equal(notices.length, 0);
});

test("walk landing composes a single toast and shows no card", async () => {
  notices.length = 0;
  // Drive the same walk branch `handleVimTaskToggleOpenDone` uses: the
  // toggle composes into the box and the walk settles with one outcome.
  const cursorEditor = createTextEditor(
    "- [ ] #task Walk task [id:: walk__task] ^walk-task",
    { line: 0, ch: 4 },
  );
  const walkHarness = createInMemoryObsidianApp({
    "walk.md": cursorEditor.getValue(),
    "sase.md": [
      FIX_LINE,
      "- [?] #task Walk dependent [dependsOn:: walk__task] ^walk-dependent",
    ].join("\n"),
    [DAILY_PATH]: fixDay("\t- [[walk#^walk-task]]"),
  });
  const walkPlugin = makePlugin(walkHarness, cursorEditor, "walk.md");
  const walkSeen = [];
  installNavStub(walkPlugin, walkSeen);
  const walkContinued = [];
  walkPlugin.app.plugins.plugins["bob-navigation-hotkeys"].api.reviewWalk = {
    version: 1,
    capture() {
      return { key: "row", seq: 1, epoch: 1 };
    },
    continue(originArg, outcome) {
      walkContinued.push({ origin: originArg, outcome });
      return Promise.resolve({ ok: true, advanced: true, stopped: false });
    },
  };
  const box = {};
  const status = walkPlugin.getActiveTaskStatus(cursorEditor);
  const wrote = await walkPlugin.toggleActiveCheckboxOpenDoneAndPropagate(
    cursorEditor,
    { path: "walk.md" },
    status,
    { successorNoticeTarget: "return", successorNoticeBox: box },
  );
  assert.equal(wrote, true);
  walkPlugin.continueReviewWalkSilently(
    walkPlugin.getReviewWalkApi(),
    { key: "row", seq: 1, epoch: 1 },
    wrote === true ? { kind: "complete", ...(box.text ? { notice: box.text } : {}) } : null,
  );
  await flushAsyncActions();

  assert.equal(walkContinued.length, 1);
  assert.equal(walkContinued[0].outcome.kind, "complete");
  assert.match(walkContinued[0].outcome.notice || "", /🔓/);
  assert.equal(walkSeen.length, 0);
  assert.equal(notices.length, 0);
});

test("nav absent falls back to a plain Notice with no link (SO missing picker)", async () => {
  notices.length = 0;
  const day = fixDay();
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);

  const result = await plugin.handleActiveTaskBlockLinkOpenDone(editor, {
    path: DAILY_PATH,
  });

  // SO: without a picker API, recovery with no picks (plain not-pulled-in
  // fallback), even though the close itself still lands.
  assert.equal(result.changed, true);
  assert.equal(editor.lineCount(), 5);
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    `- [ ] #task Re-launch all failed agents on apollo! [unblocked:: ${TODAY}] [dependsOn:: sase__fix-apollo] ^relaunch-failed`,
  );
  assert.equal(notices.length, 1);
  assert.match(notices[0], /not pulled in/);
});

test("stale cache heals via re-plan from fresh text (SO30)", async () => {
  notices.length = 0;
  const day = fixDay();
  const liveDependent =
    "- [?] #task Re-launch all failed agents TODAY! [dependsOn:: sase__fix-apollo] ^relaunch-failed";
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_DONE_LINE, liveDependent].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 4, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);
  // Warm cache with a stale copy: re-plan from fresh vault text heals it and
  // links the fresh row (same stable key path#^id).
  installTasksStub(plugin, [
    {
      path: "sase.md",
      lineNumber: 0,
      status: "x",
      originalMarkdown: FIX_DONE_LINE,
      description: "Fix apollo machine!",
      blockId: "fix-apollo",
      id: "sase__fix-apollo",
      dependsOn: [],
    },
    {
      path: "sase.md",
      lineNumber: 1,
      status: "?",
      originalMarkdown: DEPENDENT_LINE,
      description: "Re-launch all failed agents on apollo!",
      blockId: "relaunch-failed",
      id: null,
      dependsOn: ["sase__fix-apollo"],
    },
  ]);

  const result = await plugin.finalizeClosedTasks(
    [{ path: "sase.md", blockId: "fix-apollo", taskId: "sase__fix-apollo" }],
    { editor, activePath: DAILY_PATH },
  );

  assert.ok(result.successors);
  assert.equal(result.successors.unblocked.length, 1);
  const row = result.successors.unblocked[0];
  assert.ok(row.link);
  assert.equal(row.not_linked, null);
  assert.equal(result.successors.failure, null);
  assert.equal(
    harness.getSource("sase.md").split("\n")[1],
    "- [*] #task Re-launch all failed agents TODAY! [dependsOn:: sase__fix-apollo] ^relaunch-failed",
  );
  assert.equal(seen.length, 1);
  assert.match(
    plugin.successorNoticeForModel(result.successors),
    /🔓 Next in FIX/,
  );
});

test("Pomodoro-line close appends the successor to the created continuation", async () => {
  notices.length = 0;
  const day = [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] () — FIX",
    "\t- ![[sase#^fix-apollo]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 3, ch: 4 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const completed = await plugin.completeActivePomodoroTask(
    editor,
    { path: DAILY_PATH },
    { pomodoroLine: 3 },
  );

  assert.equal(completed, true);
  assert.equal(
    harness.getSource("sase.md"),
    [
      FIX_CLOSED_STAMPED_LINE,
      DEPENDENT_NEXT_LINE,
    ].join("\n"),
  );
  const value = editor.getValue();
  assert.match(value, /^- \[x\] \(\) — FIX$/m);
  // The close created a continuation and the successor landed in it.
  assert.match(value, /^- \[ \] \(\) — FIX\n\t- \[\[sase#\^relaunch-failed\]\]/m);
  assert.equal(seen.length, 1);
  const row = seen[0].unblocked[0];
  assert.equal(row.link.entry_name, "FIX");
  assert.equal(row.link.entry_created, true);
  assert.equal(notices.length, 0);
});

test("Pomodoro-line close keeps the closing anchor after the picker re-plan", async () => {
  // The re-plan reads the day after the close, where the closed entry is
  // [x]; the pick must still anchor `closing` (a FIX placeholder after the
  // closed entry), never the implicit destination under another entry.
  notices.length = 0;
  const day = [
    `# ${TODAY}`,
    "",
    "## Pomodoros",
    "- [ ] (09:00-09:25) — FIX",
    "\t- ![[sase#^fix-apollo]]",
    "- [ ] (10:00-10:25) — OTHER",
    "\t- ",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": [FIX_LINE, DEPENDENT_LINE].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 3, ch: 4 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  const seen = [];
  installNavStub(plugin, seen);

  const completed = await plugin.completeActivePomodoroTask(
    editor,
    { path: DAILY_PATH },
    { pomodoroLine: 3 },
  );

  assert.equal(completed, true);
  const value = editor.getValue();
  assert.match(
    value,
    /^- \[x\] \(09:00-09:25\) — FIX\n\t- .*\n- \[ \] \(\) — FIX\n\t- \[\[sase#\^relaunch-failed\]\]\n- \[ \] \(10:00-10:25\) — OTHER\n\t- $/m,
  );
  assert.equal(seen.length, 1);
  const row = seen[0].unblocked[0];
  assert.equal(row.link.entry_name, "FIX");
  assert.equal(row.link.entry_created, true);
});

test("completeTaskAtCursor returns the notice and shows nothing itself", async () => {
  notices.length = 0;
  const walkLine = "- [ ] #task Walk task [id:: walk__task] ^walk-task";
  const walkDependent =
    "- [?] #task Walk dependent [dependsOn:: walk__task] ^walk-dep";
  const day = fixDay("\t- [[walk#^walk-task]]");
  const harness = createInMemoryObsidianApp({
    "walk.md": [walkLine, walkDependent].join("\n"),
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor([walkLine, walkDependent].join("\n"), {
    line: 0,
    ch: 4,
  });
  const plugin = makePlugin(harness, editor, "walk.md");
  const seen = [];
  installNavStub(plugin, seen);
  installTasksCloseCommand(plugin, editor);

  const result = await plugin.completeTaskAtCursor(editor);

  assert.equal(result.ok, true);
  assert.match(result.successorNotice || "", /🔓/);
  assert.equal(seen.length, 0);
  assert.equal(notices.length, 0);
});

test("successor apply recovers project residents without ledger v12", async () => {
  notices.length = 0;
  const project = [
    "---",
    'type: "[[project]]"',
    "status: wip",
    "---",
    "- [?] #task #prj Release [id:: project__prj] [dependsOn:: sase__fix-apollo] ^prj",
    "- [?] #task Prepare the release #prj_is_blocked ^release-notes",
    "- [x] #task Already done #prj_is_blocked ✅ 2026-10-01 ^done",
  ].join("\n");
  const day = [`# ${TODAY}`, "", "## Pomodoros", "- [ ] () — FIX"].join("\n");
  const harness = createInMemoryObsidianApp({
    "sase.md": FIX_LINE,
    "projects/release.md": project,
    [DAILY_PATH]: day,
  });
  const editor = createTextEditor(day, { line: 3, ch: 5 });
  const plugin = makePlugin(harness, editor, DAILY_PATH);
  plugin.getFreshnessMarkUnblockedLine = () => null;
  const seen = [];
  installNavStub(plugin, seen);
  // Recovery-only (Esc) to exercise the WRITE-rule warning without ledger v12.
  plugin.app.plugins.plugins["bob-navigation-hotkeys"].api.successors.pick = async () => null;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
  };

  let result;
  try {
    result = await plugin.finalizeClosedTasks(
      [
        {
          path: "sase.md",
          blockId: "fix-apollo",
          taskId: "sase__fix-apollo",
          text: "Fix apollo machine!",
        },
      ],
      { editor, activePath: DAILY_PATH },
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(result.successors);
  const release = harness.getSource("projects/release.md");
  assert.match(release, /^- \[ \] #task #prj Release .* \^prj$/m);
  assert.match(release, /^- \[ \] #task Prepare the release \^release-notes$/m);
  assert.doesNotMatch(release, /\[unblocked::/);
  assert.match(
    release,
    /^- \[x\] #task Already done #prj_is_blocked ✅ 2026-10-01 \^done$/m,
  );
  assert.equal(
    warnings.filter((line) => line.includes("without [unblocked::]")).length,
    1,
  );
});
