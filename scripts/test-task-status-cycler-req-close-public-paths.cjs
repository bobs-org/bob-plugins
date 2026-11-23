// Public managed-Done paths for the requirement close card (bob-cli-on.11.1.7.1).
// Drives finalizeClosedTasks / planAndApplySuccessorsNow, Ctrl+Enter,
// completeTaskAtCursor, a single cycle, and cycleTaskStatusRange with a stub
// v6 picker and the real nav carry planner.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  helpers,
  notices,
  MarkdownView,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  flushAsyncActions,
  installTasksCloseCommand,
} = require("./task-status-cycler-harness.cjs");
const navHarness = require("./navigation-hotkeys-harness.cjs");

const TODAY = helpers.formatLocalDate();
const DAILY_PATH = helpers.todayDailyPath({}, new Date(`${TODAY}T12:00:00`));
const SETTINGS = {
  linked_from_mentions: true,
  linked_from_lines: true,
  inbox_route: "inbox.md",
};

function dayNote(extraLink = "") {
  const link = extraLink ? `\n\t- ${extraLink}` : "";
  return `# ${TODAY}\n\n## Pomodoros\n- [ ] () — FIX${link}\n`;
}

function replaceEditorText(editor, after) {
  const current = String(editor.getValue() || "");
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const lines = current.split(newline);
  const last = Math.max(0, lines.length - 1);
  editor.replaceRange(String(after), { line: 0, ch: 0 }, {
    line: last,
    ch: (lines[last] || "").length,
  });
}

function reqRows(model) {
  const rows = [];
  for (const group of (model && model.groups) || []) {
    if (group && group.group === "requirements") {
      for (const row of group.rows || []) {
        const key = row && ((row.offer && row.offer.key) || row.key);
        if (key) rows.push({ ...row, key, text: row.text || (row.req && row.req.text) || "" });
      }
    }
  }
  return rows;
}

function reqRowByText(model, text) {
  return reqRows(model).find((row) => row.text === text) || null;
}

function offerRowByText(model, text) {
  for (const group of (model && model.groups) || []) {
    if (group && group.group === "requirements") continue;
    for (const row of group.rows || []) {
      if (row && row.text === text) return row;
    }
  }
  return null;
}

function restoresByPath(shown) {
  const restores = shown && shown[0] && shown[0].undo && shown[0].undo.restores;
  assert.ok(Array.isArray(restores) && restores.length > 0, "receipt has guarded restores");
  const paths = new Map();
  for (const row of restores) {
    assert.ok(row && row.path, "restore names a path");
    assert.equal(paths.has(row.path), false, `duplicate restore for ${row.path}`);
    paths.set(row.path, row);
  }
  return { restores, paths };
}

async function restoreShown(shown, harness, editorsByPath = {}) {
  const { restores } = restoresByPath(shown);
  const navPlugin = new navHarness.NavigationHotkeysPlugin();
  navPlugin.app = harness.app;
  navPlugin.getOpenMarkdownEditorForPath = (path) => editorsByPath[path] || null;
  const undone = await navPlugin.restoreGuardedSnapshots(restores, {
    successMessage: "Undid change",
    failureLabel: "Could not undo change",
  });
  return { restores, undone };
}

function makePlugin(harness, editor, path) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getScheduleLogDateString = () => TODAY;
  plugin.getCompletionDateString = () => TODAY;
  plugin.getCreatedDateString = () => TODAY;
  plugin.getPomodoroWorkLogStamp = () => `${TODAY} 12:00`;
  plugin.scheduleCenterEditorLineInView = () => {};
  plugin.retireClosedTaskReferencesNow = async () => ({ retired: 0, failures: [] });
  attachActiveMarkdownView(plugin, harness, editor, path);
  if (!harness.app.commands) {
    harness.app.commands = { commands: {}, executeCommandById: () => false };
  }
  return plugin;
}

function installReqCloseNav(plugin, harness, options = {}) {
  const previous = plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  const shown = options.shown || [];
  const landings = options.landings || [];
  const picked = [];
  const editorsFor = (path) => {
    const workspace = plugin.app && plugin.app.workspace;
    const view = workspace && typeof workspace.getActiveViewOfType === "function"
      ? workspace.getActiveViewOfType(MarkdownView)
      : null;
    if (view && view.file && view.file.path === path && view.editor) return view.editor;
    return null;
  };
  const collectFiles = () => {
    const files = {};
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      const editor = editorsFor(file.path);
      files[file.path] = editor ? editor.getValue() : harness.getSource(file.path);
    }
    return files;
  };
  const writePath = async (path, after) => {
    const editor = editorsFor(path);
    if (editor) replaceEditorText(editor, after);
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (file) await plugin.app.vault.modify(file, after);
  };
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "bob-navigation-hotkeys": {
        api: {
          version: 6,
          landOnTask: async (target) => {
            landings.push(target);
            return { ok: true };
          },
          reviewWalk: { version: 2 },
          cancel: navHarness.helpers.createCancelApi(),
          notice: {
            version: 6,
            showUnblocked(model) {
              shown.push(model);
              return true;
            },
          },
          successors: {
            version: 6,
            async pick(model) {
              picked.push(model);
              if (typeof options.pick === "function") return options.pick(model);
              return { reqs: [] };
            },
          },
          taskSplit: {
            version: 1,
            async carryReq(request) {
              const files = collectFiles();
              const planned = navHarness.helpers.taskSplitPlanCarryReq(files, {
                ...request,
                today: request.today || TODAY,
                settings: SETTINGS,
              });
              if (!planned || planned.ok !== true) return planned;
              const written = planned.plan && planned.plan.files ? planned.plan.files : {};
              for (const [path, after] of Object.entries(written)) {
                await writePath(path, after);
              }
              return {
                ok: true,
                task: planned.task,
                moveMap: planned.moveMap,
                plan: planned.plan,
                restores: Object.entries(written).map(([path, after]) => ({
                  path,
                  before: Object.prototype.hasOwnProperty.call(files, path) ? files[path] : "",
                  after,
                  created: !Object.prototype.hasOwnProperty.call(files, path),
                })),
              };
            },
          },
        },
      },
    },
  };
  return { shown, landings, picked };
}

async function awaitCycle(plugin, run) {
  const pending = [];
  const original = plugin.finalizeCycledClosedTasks.bind(plugin);
  plugin.finalizeCycledClosedTasks = (...args) => {
    const result = original(...args);
    pending.push(Promise.resolve(result));
    return result;
  };
  try {
    const value = await run();
    await Promise.all(pending);
    if (plugin.referenceMutationQueue) await plugin.referenceMutationQueue;
    await flushAsyncActions();
    return value;
  } finally {
    plugin.finalizeCycledClosedTasks = original;
  }
}

function exporterNote({ status = " ", id = "export__task" } = {}) {
  const idField = id ? ` [id:: ${id}]` : "";
  return [
    `- [${status}] #task Ship the exporter${idField} ^export`,
    "\t- [ ] Handles supported inputs",
    "\t\t- [ ] Handles Windows files",
    "\t\t\t- [ ] Preserves CRLF",
    "\t\t- [ ] Handles empty input",
  ].join("\n") + "\n";
}

function idlessExporterNote(options = {}) {
  return exporterNote({ ...options, id: "" }).replace(" ^export", "");
}

function exporterWithOfferedNote() {
  return [
    exporterNote({ id: "export__task" }).trimEnd(),
    "- [ ] #task Offered [dependsOn:: export__task] [id:: offered] ^offered",
  ].join("\n") + "\n";
}

test("1. Ctrl+Enter Drop with a reason writes drop bytes and keeps the owner Done", async () => {
  notices.length = 0;
  const source = exporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const row = reqRowByText(model, "Handles empty input");
      assert.ok(row, "drop row is on the card");
      return { reqs: [{ key: row.key, verdict: "drop", reason: "duplicate effort" }] };
    },
  });
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  assert.equal(wrote, true);
  const text = editor.getValue();
  assert.match(text, /^- \[x\] #task Ship the exporter/);
  assert.doesNotMatch(text, /\[fresh::/);
  assert.doesNotMatch(text, /\[unblocked::/);
  assert.match(text, /- \[-\] Handles empty input/);
  assert.match(text, /❌ \*\*CANCEL LOG\*\*/);
  assert.match(text, new RegExp(`\\*${TODAY}\\* — duplicate effort`));
  assert.equal(shown.length, 1);
  assert.ok((shown[0].req_outcomes || []).some((row) => row.verdict === "drop"));
  assert.match(JSON.stringify(shown[0]), /⊘ Dropped/);
});

test("2. daily-owner Carry and Carry+pull-in route across notes", async () => {
  notices.length = 0;
  const dailySource = "- [ ] #task Daily owner [id:: daily__owner] ^daily\n\t- [ ] Carry this req\n";
  for (const verdict of ["carry", "carry_pulled"]) {
    const harness = createInMemoryObsidianApp({
      [DAILY_PATH]: `${dayNote("[[#^daily]]")}${dailySource}`,
      "inbox.md": "## Tasks\n",
    });
    const dailyText = harness.getSource(DAILY_PATH);
    const ownerLine = dailyText.split("\n").findIndex((line) => line.includes("Daily owner"));
    const editor = createTextEditor(dailyText, { line: ownerLine, ch: 4 });
    const plugin = makePlugin(harness, editor, DAILY_PATH);
    const shown = [];
    installReqCloseNav(plugin, harness, {
      shown,
      pick(model) {
        const row = reqRowByText(model, "Carry this req");
        assert.ok(row, `${verdict} row`);
        return { reqs: [{ key: row.key, verdict }] };
      },
    });
    plugin.app.plugins.plugins["bob-ledger-tools"] = {
      api: {
        themes: {
          version: 1,
          effectiveTypeFor: () => ({ theme: { key: "fix", name: "FIX" } }),
          typeAgrees: () => true,
          planPlacement: () => ({ kind: "entry", index: 0 }),
        },
      },
    };
    const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
      editor,
      { path: DAILY_PATH },
      plugin.getActiveTaskStatus(editor),
    );
    assert.equal(wrote, true, verdict);
    const daily = editor.getValue();
    const inbox = harness.getSource("inbox.md");
    assert.match(daily, /^- \[x\] #task Daily owner/m);
    assert.match(daily, /- \[>\] \[\[inbox#\^carry-req\|Carry this req\]\]/);
    assert.match(inbox, /#task Carry this req/);
    assert.match(inbox, /\^carry-req/);
    assert.match(inbox, /LINKED FROM/);
    if (verdict === "carry_pulled") {
      assert.match(daily, /\[\[inbox#\^carry-req\]\]/);
      assert.doesNotMatch(daily.split("\n").find((line) => line.includes("inbox#^carry-req") && !line.includes("[>]")) || "", /\[fresh::/);
      assert.ok((shown[0].req_outcomes || []).some((row) => row.verdict === "carry_pulled"));
    }
  }
});

test("3. several carries plus a drop, and two owners in one file", async () => {
  notices.length = 0;
  const source = exporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  installReqCloseNav(plugin, harness, {
    pick(model) {
      const carry = reqRowByText(model, "Preserves CRLF");
      const drop = reqRowByText(model, "Handles empty input");
      return {
        reqs: [
          { key: carry.key, verdict: "carry" },
          { key: drop.key, verdict: "drop", reason: "out of scope" },
        ],
      };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  const mixed = editor.getValue();
  assert.match(mixed, /\[>\] \[\[#\^preserves-crlf\|Preserves CRLF\]\]/);
  assert.match(mixed, /#task Preserves CRLF/);
  assert.match(mixed, /- \[-\] Handles empty input/);
  assert.match(mixed, /out of scope/);

  const two = [
    "- [ ] #task First owner [id:: first__owner] ^first",
    "\t- [ ] First req",
    "- [ ] #task Second owner [id:: second__owner] ^second",
    "\t- [ ] Second req",
  ].join("\n") + "\n";
  const twoHarness = createInMemoryObsidianApp({
    "Owners.md": two,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const twoEditor = createTextEditor(two, { line: 0, ch: 4 });
  const twoPlugin = makePlugin(twoHarness, twoEditor, "Owners.md");
  const groups = [];
  installReqCloseNav(twoPlugin, twoHarness, {
    pick(model) {
      groups.push((model.groups || []).filter((group) => group.group === "requirements").map((group) => group.owner && group.owner.text));
      const first = reqRowByText(model, "First req");
      const second = reqRowByText(model, "Second req");
      return {
        reqs: [
          { key: first.key, verdict: "drop", reason: "one" },
          { key: second.key, verdict: "drop", reason: "two" },
        ],
      };
    },
  });
  const firstId = { path: "Owners.md", blockId: "first", taskId: "first__owner" };
  const secondId = { path: "Owners.md", blockId: "second", taskId: "second__owner" };
  const captured = [
    ...twoPlugin.captureReqCloseOwnersFromText(two, "Owners.md", [firstId]),
    ...twoPlugin.captureReqCloseOwnersFromText(two, "Owners.md", [secondId]),
  ];
  replaceEditorText(twoEditor, two.replaceAll("- [ ] #task", "- [x] #task"));
  await twoPlugin.finalizeClosedTasks([firstId, secondId], {
    editor: twoEditor,
    activePath: "Owners.md",
    reqCloseOwners: captured,
  });
  assert.deepEqual(groups[0], ["First owner", "Second owner"]);
  assert.match(twoEditor.getValue(), /First req[\s\S]*CANCEL LOG[\s\S]*one/);
  assert.match(twoEditor.getValue(), /Second req[\s\S]*CANCEL LOG[\s\S]*two/);
});

test("4. jump pins land on the created task, moved descendant, and dropped line", async () => {
  async function runJump(source, pick) {
    const landings = [];
    const harness = createInMemoryObsidianApp({
      "Tasks.md": source,
      [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
      "inbox.md": "## Tasks\n",
    });
    const editor = createTextEditor(source, { line: 0, ch: 4 });
    const plugin = makePlugin(harness, editor, "Tasks.md");
    installReqCloseNav(plugin, harness, {
      landings,
      pick,
    });
    const result = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
      editor,
      { path: "Tasks.md" },
      plugin.getActiveTaskStatus(editor),
    );
    return { editor, landings, result, plugin };
  }

  const carry = await runJump(exporterNote(), (model) => {
    const row = reqRowByText(model, "Handles empty input");
    return { reqs: [{ key: row.key, verdict: "carry" }], jump: { key: row.key } };
  });
  assert.equal(carry.landings.length, 1);
  const carried = carry.landings[0];
  assert.equal(carried.kind, "carried_task");
  assert.equal(carried.path, "Tasks.md");
  assert.equal(typeof carried.line, "number");
  assert.equal(carried.line >= 0, true);
  assert.equal(carried.text, editorLine(carry.editor, carried.line));
  assert.match(carried.text, /#task Handles empty input/);
  assert.equal(carried.blockId, "handles-empty-input");
  assert.equal(carried.description, "Handles empty input");

  const moved = await runJump(exporterNote(), (model) => {
    const ancestor = reqRowByText(model, "Handles supported inputs");
    const leaf = reqRowByText(model, "Preserves CRLF");
    return {
      reqs: [{ key: ancestor.key, verdict: "carry" }],
      jump: { key: leaf.key },
    };
  });
  assert.equal(moved.landings.length, 1);
  const movedJump = moved.landings[0];
  assert.equal(movedJump.kind, "moved_with_ancestor");
  assert.equal(movedJump.text, editorLine(moved.editor, movedJump.line));
  assert.match(movedJump.text, /Preserves CRLF/);
  assert.equal(movedJump.description, "Preserves CRLF");
  assert.equal(movedJump.blockId, null);

  const dropped = await runJump(exporterNote(), (model) => {
    const row = reqRowByText(model, "Handles empty input");
    return { reqs: [{ key: row.key, verdict: "drop", reason: "nope" }], jump: { key: row.key } };
  });
  assert.equal(dropped.landings.length, 1);
  const dropJump = dropped.landings[0];
  assert.equal(dropJump.kind, "requirement");
  assert.equal(dropJump.text, editorLine(dropped.editor, dropJump.line));
  assert.match(dropJump.text, /\[-\] Handles empty input/);
  assert.equal(dropJump.blockId, null);

  const equalLabels = [
    "- [ ] #task Owner [id:: owner__task] ^owner",
    "\t- [ ] Same label",
    "\t- [ ] Other",
    "\t\t- [ ] Same label",
  ].join("\n") + "\n";
  const equal = await runJump(equalLabels, (model) => {
    const rows = reqRows(model).filter((row) => row.text === "Same label");
    assert.equal(rows.length, 2);
    return { reqs: [], jump: { key: rows[1].key } };
  });
  assert.equal(equal.landings.length, 1);
  const pinned = equal.landings[0];
  assert.equal(pinned.text, editorLine(equal.editor, pinned.line));
  assert.match(pinned.text, /Same label/);
  const otherSame = equal.editor.getValue().split("\n").findIndex((line) => line.includes("Same label"));
  assert.notEqual(pinned.line, otherSame);
});

function editorLine(editor, line) {
  return typeof editor.getLine === "function" ? editor.getLine(line) : editor.getValue().split("\n")[line];
}

test("5. req-only card on a task with no [id::] and no ordinary offers", async () => {
  notices.length = 0;
  const source = exporterNote({ id: "" });
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  let opened = null;
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      opened = model;
      const row = reqRowByText(model, "Handles empty input");
      return { reqs: [{ key: row.key, verdict: "drop", reason: "no id" }] };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  assert.ok(opened);
  assert.equal(opened.groups[0].group, "requirements");
  assert.match(editor.getValue(), /\[-\] Handles empty input/);
  const model = shown[0] || {};
  assert.equal(Array.isArray(model.unblocked) ? model.unblocked.length : 0, 0);
  assert.equal(model.offer_closes, undefined);
});

test("6. mixed ordinary offers and reqs apply together", async () => {
  notices.length = 0;
  const source = [
    exporterNote({ id: "export__task" }).trimEnd(),
    "- [?] #task Waiting on exporter [fresh:: 2026-11-01] [dependsOn:: export__task] [id:: waiting] ^waiting",
  ].join("\n") + "\n";
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  installReqCloseNav(plugin, harness, {
    pick(model) {
      assert.equal(model.groups[0].group, "requirements");
      const req = reqRowByText(model, "Handles empty input");
      const offer = (model.groups || []).flatMap((group) => group.rows || [])
        .find((row) => row && row.selectable && String(row.key || "").includes("waiting"));
      assert.ok(offer, JSON.stringify(model.groups.map((group) => group.group)));
      return {
        picks: [{ key: offer.key }],
        reqs: [{ key: req.key, verdict: "carry" }],
      };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  const text = editor.getValue();
  assert.match(text, /\[>\] \[\[#\^handles-empty-input\|Handles empty input\]\]/);
  assert.match(text, /#task Handles empty input/);
  assert.match(text, /^- \[[ *]\] #task Waiting on exporter/m);
  assert.doesNotMatch(text, /^- \[\?\] #task Waiting on exporter/m);
});

test("7. embedded multi-owner close opens one card in closing order", async () => {
  notices.length = 0;
  const local = "- [ ] #task Local owner [id:: local__owner] ^local\n\t- [ ] Local req\n";
  const remote = "- [ ] #task Remote owner [id:: remote__owner] ^remote\n\t- [ ] Remote req\n";
  const embed = "- [ ] #task Local owner ![[Remote.md#^remote]] [id:: local__owner] ^local\n\t- [ ] Local req\n";
  const harness = createInMemoryObsidianApp({
    "Local.md": embed,
    "Remote.md": remote,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(embed, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Local.md");
  const order = [];
  installReqCloseNav(plugin, harness, {
    pick(model) {
      order.push((model.groups || []).filter((group) => group.group === "requirements")
        .map((group) => group.owner && group.owner.text));
      const localRow = reqRowByText(model, "Local req");
      const remoteRow = reqRowByText(model, "Remote req");
      return {
        reqs: [
          { key: localRow.key, verdict: "drop", reason: "local" },
          { key: remoteRow.key, verdict: "drop", reason: "remote" },
        ],
      };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Local.md" },
    plugin.getActiveTaskStatus(editor),
  );
  assert.equal(order.length, 1);
  assert.equal(order[0].length, 2);
  assert.match(editor.getValue(), /Local req[\s\S]*local/);
  assert.match(harness.getSource("Remote.md"), /Remote req[\s\S]*remote/);
  void local;
});

test("8. external owner-block edits while the card is open refuse req_close_stale", async () => {
  notices.length = 0;
  const source = exporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    "Dep.md": "- [?] #task Waiting [fresh:: 2026-11-01] [dependsOn:: export__task] [id:: waiting] ^waiting\n",
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const mutated = editor.getValue().replace(
        "\t- [ ] Handles empty input\n",
        "\t- [ ] Handles empty input\n\t- [ ] Sneaky new req\n",
      );
      replaceEditorText(editor, mutated);
      const row = reqRowByText(model, "Handles empty input");
      const offer = (model.groups || []).flatMap((group) => group.rows || [])
        .find((entry) => entry && entry.selectable && String(entry.key || "").includes("waiting"));
      return {
        picks: offer ? [{ key: offer.key }] : [],
        reqs: [{ key: row.key, verdict: "drop", reason: "too late" }],
      };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  const text = editor.getValue();
  assert.doesNotMatch(text, /CANCEL LOG/);
  assert.doesNotMatch(text, /too late/);
  assert.match(text, /Sneaky new req/);
  assert.match(text, /^- \[x\] #task Ship the exporter/m);
  const failures = (shown[0] && shown[0].failures) || [];
  assert.ok(failures.some((row) => row && row.code === "req_close_stale"), JSON.stringify(failures));
  assert.doesNotMatch(harness.getSource("Dep.md"), /^- \[\?\] #task Waiting/m);
});

test("9. older picker or missing nav leaves reqs implicitly Met", async () => {
  notices.length = 0;
  const source = exporterNote();
  for (const mode of ["v5", "missing"]) {
    const harness = createInMemoryObsidianApp({
      "Tasks.md": source,
      [DAILY_PATH]: dayNote(),
      "inbox.md": "## Tasks\n",
    });
    const editor = createTextEditor(source, { line: 0, ch: 4 });
    const plugin = makePlugin(harness, editor, "Tasks.md");
    if (mode === "v5") {
      plugin.app.plugins.plugins["bob-navigation-hotkeys"] = {
        api: {
          version: 5,
          notice: { version: 5, showUnblocked: () => true },
          successors: { version: 5, pick: async () => ({ picks: [] }) },
        },
      };
    }
    await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
      editor,
      { path: "Tasks.md" },
      plugin.getActiveTaskStatus(editor),
    );
    const text = editor.getValue();
    assert.match(text, /^- \[x\] #task Ship the exporter/m, mode);
    assert.match(text, /- \[ \] Handles empty input/, mode);
    assert.doesNotMatch(text, /CANCEL LOG/, mode);
    assert.doesNotMatch(text, /\[>\]/, mode);
  }
});

test("10. recurring, cancel, parked, automated, and offer-close targets skip the audit", async () => {
  notices.length = 0;
  const recurring = "- [ ] #task Recurring owner [repeat:: every day] [id:: rec__owner] ^rec\n\t- [ ] Hidden req\n";
  const harness = createInMemoryObsidianApp({
    "Rec.md": recurring,
    "Tasks.md": exporterNote(),
    "Offer.md": "- [ ] #task Offered [id:: offered] ^offered\n\t- [ ] Offered req\n",
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const recEditor = createTextEditor(recurring, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, recEditor, "Rec.md");
  let recModel = null;
  installReqCloseNav(plugin, harness, {
    pick(model) {
      recModel = model;
      return { reqs: [] };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    recEditor,
    { path: "Rec.md" },
    plugin.getActiveTaskStatus(recEditor),
  );
  assert.equal(
    recModel == null || reqRows(recModel).length === 0,
    true,
    "recurring owners do not open a requirement audit",
  );
  assert.doesNotMatch(recEditor.getValue(), /CANCEL LOG/);

  const closed = exporterNote().replace("- [ ] #task", "- [x] #task");
  const captured = plugin.captureReqCloseOwnersFromText(exporterNote(), "Tasks.md", [
    { path: "Tasks.md", blockId: "export", taskId: "export__task" },
  ]);
  for (const context of [
    { closeKind: "cancelled" },
    { relationEventKind: "parked" },
    { automated: true },
  ]) {
    let opened = false;
    installReqCloseNav(plugin, harness, { pick() { opened = true; return { reqs: [] }; } });
    await plugin.planAndApplySuccessorsNow(
      [{ path: "Tasks.md", blockId: "export", taskId: "export__task" }],
      { reqCloseOwners: captured, ...context },
    );
    assert.equal(opened, false, JSON.stringify(context));
  }

  const offerSource = [
    "- [x] #task Predecessor [id:: pred] ^pred",
    "- [ ] #task Offered [dependsOn:: pred] [id:: offered] ^offered",
    "\t- [ ] Offered req",
  ].join("\n") + "\n";
  const offerHarness = createInMemoryObsidianApp({
    "Tasks.md": offerSource,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const offerEditor = createTextEditor(offerSource, { line: 0, ch: 4 });
  const offerPlugin = makePlugin(offerHarness, offerEditor, "Tasks.md");
  const offerPicked = [];
  installReqCloseNav(offerPlugin, offerHarness, {
    pick(model) {
      offerPicked.push(model);
      const closeRow = offerRowByText(model, "Offered");
      assert.ok(closeRow, "ordinary Offered row is on the card");
      assert.equal(closeRow.close && closeRow.close.complete, true, "ordinary close is accepted");
      return {
        picks: [],
        closes: [{ key: closeRow.key, outcome: "done" }],
        reqs: [],
      };
    },
  });
  await offerPlugin.finalizeClosedTasks(
    [{ path: "Tasks.md", blockId: "pred", taskId: "pred" }],
    { editor: offerEditor, activePath: "Tasks.md", reqCloseOwners: [] },
  );
  assert.equal(offerPicked.length, 1, "offer-close does not open a recursive requirement card");
  assert.equal(
    (offerPicked[0].groups || []).filter((group) => group.group === "requirements").length,
    0,
    "the initiating card has no requirement audit for the offer-close target",
  );
  const closedOffer = offerEditor.getValue();
  assert.match(closedOffer, /^- \[x\] #task Offered/m);
  assert.match(closedOffer, /- \[ \] Offered req/);
  assert.doesNotMatch(closedOffer, /CANCEL LOG/);
});

test("11. Esc writes no requirement bytes and leaves the owner Done", async () => {
  notices.length = 0;
  const source = exporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  installReqCloseNav(plugin, harness, { pick: () => null });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  const text = editor.getValue();
  assert.match(text, /^- \[x\] #task Ship the exporter/m);
  assert.match(text, /- \[ \] Handles empty input/);
  assert.doesNotMatch(text, /CANCEL LOG/);
  const reopened = plugin.toggleActiveCheckboxOpenDone(editor, plugin.getActiveTaskStatus(editor));
  assert.equal(reopened, true);
  assert.match(editor.getValue(), /^- \[ \] #task Ship the exporter/m);
});

test("12a. mixed ordinary Done and requirement Drop share one restore and Undo", async () => {
  notices.length = 0;
  const source = exporterWithOfferedNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const req = reqRowByText(model, "Handles empty input");
      const offer = offerRowByText(model, "Offered");
      assert.ok(req, "requirement is on the card");
      assert.ok(offer, "ordinary Offered row is on the card");
      assert.equal(offer.close && offer.close.complete, true);
      return {
        closes: [{ key: offer.key, outcome: "done" }],
        reqs: [{ key: req.key, verdict: "drop", reason: "mixed undo" }],
      };
    },
  });
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  assert.equal(wrote, true);
  const after = editor.getValue();
  assert.match(after, /^- \[x\] #task Ship the exporter/m);
  assert.match(after, /^- \[x\] #task Offered/m);
  assert.match(after, /- \[-\] Handles empty input/);
  assert.match(after, /❌ \*\*CANCEL LOG\*\*/);
  assert.match(after, /mixed undo/);
  assert.ok((shown[0].req_outcomes || []).some((row) => row.verdict === "drop"));
  assert.ok((shown[0].offer_closes || []).some((row) => row.outcome === "done"));
  const { paths } = restoresByPath(shown);
  assert.equal(paths.get("Tasks.md").after, after);
  assert.match(paths.get("Tasks.md").before, /^- \[x\] #task Ship the exporter/m);
  assert.match(paths.get("Tasks.md").before, /^- \[ \] #task Offered/m);
  assert.match(paths.get("Tasks.md").before, /- \[ \] Handles empty input/);
  assert.doesNotMatch(paths.get("Tasks.md").before, /CANCEL LOG/);
  const { undone } = await restoreShown(shown, harness, { "Tasks.md": editor });
  assert.equal(undone, true);
  const restored = editor.getValue();
  assert.match(restored, /^- \[x\] #task Ship the exporter/m);
  assert.match(restored, /^- \[ \] #task Offered/m);
  assert.match(restored, /- \[ \] Handles empty input/);
  assert.doesNotMatch(restored, /CANCEL LOG/);
  assert.doesNotMatch(restored, /mixed undo/);
});

test("12b. mixed ordinary close and Carry restore source and created destination", async () => {
  notices.length = 0;
  const source = exporterWithOfferedNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const req = reqRowByText(model, "Handles empty input");
      const offer = offerRowByText(model, "Offered");
      assert.equal(offer.close && offer.close.complete, true);
      return {
        closes: [{ key: offer.key, outcome: "done" }],
        reqs: [{ key: req.key, verdict: "carry_pulled" }],
      };
    },
  });
  plugin.app.plugins.plugins["bob-ledger-tools"] = {
    api: {
      themes: {
        version: 1,
        effectiveTypeFor: () => ({ theme: { key: "fix", name: "FIX" } }),
        typeAgrees: () => true,
        planPlacement: () => ({ kind: "entry", index: 0 }),
      },
    },
  };
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  const after = editor.getValue();
  assert.match(after, /^- \[x\] #task Offered/m);
  assert.match(after, /\[>\] \[\[#\^handles-empty-input\|Handles empty input\]\]/);
  assert.match(after, /#task Handles empty input/);
  const daily = harness.getSource(DAILY_PATH);
  assert.match(daily, /\[\[Tasks#\^handles-empty-input\]\]/);
  const { paths } = restoresByPath(shown);
  assert.equal(paths.get("Tasks.md").after, after);
  assert.ok(paths.has(DAILY_PATH), "pull-in daily write is in the composed restore");
  assert.equal(paths.get(DAILY_PATH).after, daily);
  const { undone } = await restoreShown(shown, harness, { "Tasks.md": editor });
  assert.equal(undone, true);
  const restored = editor.getValue();
  assert.match(restored, /^- \[x\] #task Ship the exporter/m);
  assert.match(restored, /^- \[ \] #task Offered/m);
  assert.match(restored, /- \[ \] Handles empty input/);
  assert.doesNotMatch(restored, /#task Handles empty input/);
  assert.doesNotMatch(restored, /\[>\]/);
  assert.doesNotMatch(harness.getSource(DAILY_PATH), /handles-empty-input/);
});

test("12c. mixed Undo refuses the whole operation after a later postimage edit", async () => {
  notices.length = 0;
  const source = exporterWithOfferedNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const req = reqRowByText(model, "Handles empty input");
      const offer = offerRowByText(model, "Offered");
      return {
        closes: [{ key: offer.key, outcome: "done" }],
        reqs: [{ key: req.key, verdict: "drop", reason: "guard me" }],
      };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  const beforeEdit = editor.getValue();
  replaceEditorText(editor, `${beforeEdit}- late mixed edit\n`);
  const { undone } = await restoreShown(shown, harness, { "Tasks.md": editor });
  assert.equal(undone, false);
  assert.match(editor.getValue(), /late mixed edit/);
  assert.match(editor.getValue(), /^- \[x\] #task Offered/m);
  assert.match(editor.getValue(), /CANCEL LOG/);
});

test("12d. one successful verdict family still undoes, and partial failures keep honest receipts", async () => {
  notices.length = 0;
  const source = exporterWithOfferedNote();
  const closeOnlyHarness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const closeOnlyEditor = createTextEditor(source, { line: 0, ch: 4 });
  const closeOnlyPlugin = makePlugin(closeOnlyHarness, closeOnlyEditor, "Tasks.md");
  const closeOnlyShown = [];
  installReqCloseNav(closeOnlyPlugin, closeOnlyHarness, {
    shown: closeOnlyShown,
    pick(model) {
      const offer = offerRowByText(model, "Offered");
      assert.equal(offer.close && offer.close.complete, true);
      return { closes: [{ key: offer.key, outcome: "done" }], reqs: [] };
    },
  });
  await closeOnlyPlugin.toggleActiveCheckboxOpenDoneAndPropagate(
    closeOnlyEditor,
    { path: "Tasks.md" },
    closeOnlyPlugin.getActiveTaskStatus(closeOnlyEditor),
  );
  assert.match(closeOnlyEditor.getValue(), /^- \[x\] #task Offered/m);
  assert.match(closeOnlyEditor.getValue(), /- \[ \] Handles empty input/);
  const { undone: closeUndone } = await restoreShown(closeOnlyShown, closeOnlyHarness, {
    "Tasks.md": closeOnlyEditor,
  });
  assert.equal(closeUndone, true);
  assert.match(closeOnlyEditor.getValue(), /^- \[x\] #task Ship the exporter/m);
  assert.match(closeOnlyEditor.getValue(), /^- \[ \] #task Offered/m);

  const staleHarness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const staleEditor = createTextEditor(source, { line: 0, ch: 4 });
  const stalePlugin = makePlugin(staleHarness, staleEditor, "Tasks.md");
  const staleShown = [];
  installReqCloseNav(stalePlugin, staleHarness, {
    shown: staleShown,
    pick(model) {
      const mutated = staleEditor.getValue().replace(
        "\t- [ ] Handles empty input\n",
        "\t- [ ] Handles empty input\n\t- [ ] Sneaky mixed req\n",
      );
      replaceEditorText(staleEditor, mutated);
      const req = reqRowByText(model, "Handles empty input");
      const offer = offerRowByText(model, "Offered");
      return {
        closes: [{ key: offer.key, outcome: "done" }],
        reqs: [{ key: req.key, verdict: "drop", reason: "too late mixed" }],
      };
    },
  });
  await stalePlugin.toggleActiveCheckboxOpenDoneAndPropagate(
    staleEditor,
    { path: "Tasks.md" },
    stalePlugin.getActiveTaskStatus(staleEditor),
  );
  const staleText = staleEditor.getValue();
  assert.match(staleText, /^- \[x\] #task Offered/m);
  assert.match(staleText, /Sneaky mixed req/);
  assert.doesNotMatch(staleText, /CANCEL LOG/);
  const failures = (staleShown[0] && staleShown[0].failures) || [];
  assert.ok(failures.some((row) => row && row.code === "req_close_stale"), JSON.stringify(failures));
  assert.ok((staleShown[0].offer_closes || []).some((row) => row.outcome === "done"));
  const { undone: staleUndone } = await restoreShown(staleShown, staleHarness, {
    "Tasks.md": staleEditor,
  });
  assert.equal(staleUndone, true);
  assert.match(staleEditor.getValue(), /^- \[ \] #task Offered/m);
  assert.match(staleEditor.getValue(), /Sneaky mixed req/);
  assert.match(staleEditor.getValue(), /^- \[x\] #task Ship the exporter/m);
});

test("12. one guarded Undo restores req writes and refuses after a later edit", async () => {
  notices.length = 0;
  const source = exporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const row = reqRowByText(model, "Handles empty input");
      return { reqs: [{ key: row.key, verdict: "drop", reason: "undo me" }] };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  assert.match(editor.getValue(), /CANCEL LOG/);
  const restores = shown[0] && shown[0].undo && shown[0].undo.restores;
  assert.ok(Array.isArray(restores) && restores.length > 0);
  const navPlugin = new navHarness.NavigationHotkeysPlugin();
  navPlugin.app = harness.app;
  navPlugin.getOpenMarkdownEditorForPath = (path) => path === "Tasks.md" ? editor : null;
  const undone = await navPlugin.restoreGuardedSnapshots(restores, {
    successMessage: "Undid change",
    failureLabel: "Could not undo change",
  });
  assert.equal(undone, true);
  const restored = editor.getValue();
  assert.match(restored, /^- \[x\] #task Ship the exporter/m);
  assert.match(restored, /- \[ \] Handles empty input/);
  assert.doesNotMatch(restored, /CANCEL LOG/);

  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const row = reqRowByText(model, "Handles empty input");
      return { reqs: [{ key: row.key, verdict: "drop", reason: "again" }] };
    },
  });
  replaceEditorText(editor, exporterNote().replace("- [ ] #task", "- [x] #task"));
  const captured = plugin.captureReqCloseOwnersFromText(exporterNote(), "Tasks.md", [
    { path: "Tasks.md", blockId: "export", taskId: "export__task" },
  ]);
  shown.length = 0;
  await plugin.finalizeClosedTasks(
    [{ path: "Tasks.md", blockId: "export", taskId: "export__task" }],
    { editor, activePath: "Tasks.md", reqCloseOwners: captured },
  );
  const second = shown[0] && shown[0].undo && shown[0].undo.restores;
  replaceEditorText(editor, `${editor.getValue()}- late edit\n`);
  const refused = await navPlugin.restoreGuardedSnapshots(second, {
    successMessage: "Undid change",
    failureLabel: "Could not undo change",
  });
  assert.equal(refused, false);
  assert.match(editor.getValue(), /late edit/);
});

test("13. counted-range close of an anchored owner opens the card", async () => {
  notices.length = 0;
  const source = exporterNote({ status: "*" });
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  let opened = false;
  installReqCloseNav(plugin, harness, {
    pick(model) {
      opened = reqRows(model).length > 0;
      const row = reqRowByText(model, "Handles empty input");
      return { reqs: [{ key: row.key, verdict: "drop", reason: "range" }] };
    },
  });
  await awaitCycle(plugin, () => plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 0));
  assert.equal(opened, true);
  assert.match(editor.getValue(), /^- \[x\] #task Ship the exporter/m);
  assert.match(editor.getValue(), /\[-\] Handles empty input/);
});

test("13b. a single cycle into Done opens the card", async () => {
  notices.length = 0;
  const source = exporterNote({ status: "*" });
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  let opened = false;
  installReqCloseNav(plugin, harness, {
    pick(model) {
      opened = reqRows(model).length > 0;
      return { reqs: [] };
    },
  });
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  await awaitCycle(plugin, () => {
    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  });
  assert.equal(opened, true);
  assert.match(editor.getValue(), /^- \[x\] #task Ship the exporter/m);
});

test("13c. completeTaskAtCursor opens the card", async () => {
  notices.length = 0;
  const source = exporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  installTasksCloseCommand(plugin, editor);
  let opened = false;
  installReqCloseNav(plugin, harness, {
    pick(model) {
      opened = reqRows(model).length > 0;
      return { reqs: [] };
    },
  });
  const result = await plugin.completeTaskAtCursor(editor);
  assert.equal(result.ok, true);
  assert.equal(opened, true);
});

test("14. a walk-owned close returns exactly one requirement jump", async () => {
  notices.length = 0;
  const source = exporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote("[[Tasks#^export]]"),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const landings = [];
  const box = {};
  installReqCloseNav(plugin, harness, {
    landings,
    pick(model) {
      const row = reqRowByText(model, "Handles empty input");
      return { reqs: [{ key: row.key, verdict: "drop", reason: "walk" }], jump: { key: row.key } };
    },
  });
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
    { successorJumpTarget: "return", successorJumpBox: box, successorNoticeTarget: "return" },
  );
  assert.equal(wrote, true);
  assert.equal(landings.length, 0, "walk return must not self-land");
  assert.ok(box.jump);
  assert.equal(box.jump.kind, "requirement");
  assert.match(box.jump.text, /Handles empty input/);
  assert.equal(box.jump.description, "Handles empty input");
});

test("15. Ctrl+Enter on an idless owner opens the requirement-only card and applies Drop", async () => {
  notices.length = 0;
  const source = idlessExporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) {
      const row = reqRowByText(model, "Handles empty input");
      return { reqs: [{ key: row.key, verdict: "drop", reason: "idless audit" }] };
    },
  });
  const wrote = await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  assert.equal(wrote, true);
  assert.match(editor.getValue(), /^- \[x\] #task Ship the exporter/m);
  assert.match(editor.getValue(), /- \[-\] Handles empty input/);
  assert.equal(shown.length, 1);
  assert.match(JSON.stringify(shown[0]), /⊘ Dropped/);
  assert.deepEqual(shown[0].unblocked, []);
  assert.equal(Object.prototype.hasOwnProperty.call(shown[0], "offer_closes"), false);
});

test("15b. an idless owner opens through completeTaskAtCursor and a single Done cycle", async () => {
  for (const pathKind of ["complete", "cycle"]) {
    notices.length = 0;
    const source = pathKind === "cycle"
      ? idlessExporterNote({ status: "*" })
      : idlessExporterNote();
    const harness = createInMemoryObsidianApp({
      "Tasks.md": source,
      [DAILY_PATH]: dayNote(),
      "inbox.md": "## Tasks\n",
    });
    const editor = createTextEditor(source, { line: 0, ch: 4 });
    const plugin = makePlugin(harness, editor, "Tasks.md");
    installTasksCloseCommand(plugin, editor);
    let opened = false;
    installReqCloseNav(plugin, harness, {
      pick(model) { opened = reqRows(model).length > 0; return { reqs: [] }; },
    });
    if (pathKind === "complete") {
      assert.equal((await plugin.completeTaskAtCursor(editor)).ok, true);
    } else {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      await awaitCycle(plugin, () => assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true));
    }
    assert.equal(opened, true, pathKind);
    assert.match(editor.getValue(), /^- \[x\] #task Ship the exporter/m);
  }
});

test("15c. counted-range Done opens an idless owner's requirement-only card", async () => {
  notices.length = 0;
  const source = idlessExporterNote({ status: "*" });
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  let opened = false;
  installReqCloseNav(plugin, harness, {
    pick(model) { opened = reqRows(model).length > 0; return { reqs: [] }; },
  });
  await awaitCycle(plugin, () => plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 0));
  assert.equal(opened, true);
  assert.match(editor.getValue(), /^- \[x\] #task Ship the exporter/m);
});

test("15d. idless requirement pin lands, while Esc and recurring idless closes stay quiet", async () => {
  notices.length = 0;
  const source = idlessExporterNote();
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source,
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const landings = [];
  installReqCloseNav(plugin, harness, {
    landings,
    pick(model) {
      const row = reqRowByText(model, "Handles empty input");
      return { reqs: [], jump: { key: row.key } };
    },
  });
  await plugin.toggleActiveCheckboxOpenDoneAndPropagate(
    editor,
    { path: "Tasks.md" },
    plugin.getActiveTaskStatus(editor),
  );
  assert.equal(landings.length, 1);
  assert.equal(landings[0].kind, "requirement");
  assert.match(landings[0].text, /Handles empty input/);

  const escEditor = createTextEditor(source, { line: 0, ch: 4 });
  const escPlugin = makePlugin(harness, escEditor, "Tasks.md");
  installReqCloseNav(escPlugin, harness, { pick: () => null });
  await escPlugin.toggleActiveCheckboxOpenDoneAndPropagate(
    escEditor,
    { path: "Tasks.md" },
    escPlugin.getActiveTaskStatus(escEditor),
  );
  assert.match(escEditor.getValue(), /^- \[x\] #task Ship the exporter/m);
  assert.match(escEditor.getValue(), /- \[ \] Handles empty input/);

  const recurring = idlessExporterNote().replace("Ship the exporter", "Ship the exporter [repeat:: every day]");
  const recurringEditor = createTextEditor(recurring, { line: 0, ch: 4 });
  const recurringPlugin = makePlugin(harness, recurringEditor, "Tasks.md");
  let opened = false;
  installReqCloseNav(recurringPlugin, harness, { pick() { opened = true; return { reqs: [] }; } });
  await recurringPlugin.toggleActiveCheckboxOpenDoneAndPropagate(
    recurringEditor,
    { path: "Tasks.md" },
    recurringPlugin.getActiveTaskStatus(recurringEditor),
  );
  assert.equal(opened, false);
});

test("15e. mixed idless and anchored owner groups preserve captured close order", async () => {
  const source = [
    "- [ ] #task Idless owner",
    "\t- [ ] First req",
    "- [ ] #task Anchored owner ^anchored",
    "\t- [ ] Second req",
  ].join("\n") + "\n";
  const harness = createInMemoryObsidianApp({
    "Tasks.md": source.replace("- [ ] #task", "- [x] #task"),
    [DAILY_PATH]: dayNote(),
    "inbox.md": "## Tasks\n",
  });
  const editor = createTextEditor(source.replace("- [ ] #task", "- [x] #task"), { line: 0, ch: 4 });
  const plugin = makePlugin(harness, editor, "Tasks.md");
  const preCloseOwners = plugin.captureReqCloseOwnersFromText(source, "Tasks.md");
  const shown = [];
  installReqCloseNav(plugin, harness, {
    shown,
    pick(model) { shown.push(model); return { reqs: [] }; },
  });
  await plugin.finalizeClosedTasks(
    [{ path: "Tasks.md", blockId: "anchored", taskId: "" }],
    { editor, activePath: "Tasks.md", reqCloseOwners: preCloseOwners },
  );
  const groups = shown[0].groups.filter((group) => group.group === "requirements");
  assert.deepEqual(groups.map((group) => group.owner.text), ["Idless owner", "Anchored owner"]);
});
