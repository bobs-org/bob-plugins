// Generic outcome classification, adapter registry, api.commandMode v1,
// and the plugin lifecycle (settings, catalog refresh, Ctrl+P run commands).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BobCommandModePlugin,
  helpers,
  installDocument,
  takeToastNotices,
  TestPlugin,
  makeApp,
  makeRunner,
  takeNotices,
  fixtureCatalog,
} = require("./command-mode-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");

function classify(input) {
  return helpers.cmClassifyRun(input);
}

test("classification order: stop, spawn, timeout, signal", () => {
  assert.deepEqual(classify({ stoppedByUser: true, exitCode: 0 }), { outcome: "stopped", summary: "Stopped" });
  const missing = classify({ spawnError: true, spawnNotFound: true, triedPaths: ["/a/bob"] });
  assert.equal(missing.outcome, "failed");
  assert.match(missing.summary, /bob not found.*\/a\/bob/);
  assert.match(classify({ spawnError: true, spawnNotFound: false, spawnMessage: "boom" }).summary, /boom/);
  assert.deepEqual(classify({ timedOut: true, budgetSecs: 60, exitCode: null }).summary, "Timed out after 60 s");
  assert.deepEqual(classify({ signal: "SIGKILL", exitCode: null }).summary, "Killed by signal SIGKILL");
});

test("lock phrase wins over exit codes and adapters", () => {
  helpers.cmRegisterOutcomeAdapter("lock-test", () => ({ outcome: "completed", summary: "adapter" }));
  const attention = classify({
    exitCode: 0, stdoutText: "another Bob vault maintenance run is already active\n",
    adapterId: "lock-test",
  });
  assert.equal(attention.outcome, "attention");
  assert.equal(attention.retry, true);
  const failed = classify({
    exitCode: 1, stderrText: "Another Bob Vault Maintenance Run Is Already Active\n",
    exitHints: [{ code: 1, outcome: "completed", meaning: "hint" }],
  });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.retry, true);
});

test("exit-code hints beat the generic rule; unknown ids are ignored", () => {
  const hinted = classify({
    exitCode: 3, stdoutText: "nothing", stderrText: "",
    exitHints: [{ code: 3, outcome: "attention", meaning: "Nothing to do" }],
    adapterId: "no-such-adapter",
  });
  assert.deepEqual(hinted, { outcome: "attention", summary: "Nothing to do" });
});

test("adapters adjust the result; failures stay honest", () => {
  helpers.cmRegisterOutcomeAdapter("test-adapter", ({ out }) => ({
    outcome: "attention", summary: "held: " + out, carry: ["--seed", "7"],
  }));
  const adjusted = classify({ exitCode: 0, stdoutText: "3 held\n", adapterId: "test-adapter" });
  assert.deepEqual(adjusted, { outcome: "attention", summary: "held: 3 held", carry: ["--seed", "7"] });

  helpers.cmRegisterOutcomeAdapter("test-throwing", () => { throw new Error("adapter boom"); });
  const fallback = classify({ exitCode: 0, stdoutText: "fine\n", adapterId: "test-throwing" });
  assert.deepEqual(fallback, { outcome: "completed", summary: "fine" });

  assert.deepEqual(classify({ exitCode: 0, stdoutText: "Started …\n\n" }), { outcome: "completed", summary: "Started …" });
  assert.deepEqual(classify({ exitCode: 0, stdoutText: "\n" }), { outcome: "completed", summary: "Done" });
  assert.deepEqual(classify({ exitCode: 1, stderrText: "error: bad input\nnoise\n" }), { outcome: "failed", summary: "error: bad input" });
  assert.deepEqual(classify({ exitCode: 1, stderrText: "plain failure\n" }), { outcome: "failed", summary: "plain failure" });
  assert.deepEqual(classify({ exitCode: 1, stdoutText: "last words\n" }), { outcome: "failed", summary: "last words" });
  assert.deepEqual(classify({ exitCode: 1, stdoutText: "\u001b[31merror: red\u001b[0m\n" }), { outcome: "failed", summary: "error: red" });
});

test("gcal-sync summarizes added Event Tasks, context, and MEET links", () => {
  const result = classify({
    exitCode: 0,
    adapterId: "gcal-sync",
    stdoutText: JSON.stringify({
      schema_version: 1,
      ok: true,
      status: "written",
      rows: [
        { action: "added", kind: "task" },
        { action: "added", kind: "task" },
        { action: "added", kind: "context" },
        { action: "adopted", kind: "task" },
      ],
      pomodoro: { links_added: 2 },
    }),
  });
  assert.deepEqual(result, {
    outcome: "completed",
    summary: "Calendar · +2 tasks, +1 context, MEET +2 links",
  });
});

test("gcal-sync reports unchanged and waiting outcomes", () => {
  const unchanged = classify({
    exitCode: 0,
    adapterId: "gcal-sync",
    stdoutText: JSON.stringify({
      schema_version: 1, ok: true, status: "unchanged", rows: [],
      pomodoro: { links_added: 0 },
    }),
  });
  assert.deepEqual(unchanged, { outcome: "completed", summary: "Calendar unchanged" });
  const waiting = classify({
    exitCode: 0,
    adapterId: "gcal-sync",
    stdoutText: JSON.stringify({
      schema_version: 1, ok: true, status: "waiting", rows: [],
      pomodoro: { links_added: 0 },
    }),
  });
  assert.deepEqual(waiting, { outcome: "attention", summary: "Calendar waiting for today's note" });
});

test("api.commandMode settles, never rejects, and fires the workspace event", async () => {
  const base = makeRunner({});
  base.runner.deps.env = { ...process.env, XDG_STATE_HOME: base.tmpState, PATH: "/usr/bin:/bin" };
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  const api = helpers.cmCreateApi(base.runner);
  assert.equal(api.version, 1);
  assert.ok(Object.isFrozen(api));

  const seen = [];
  const off = api.onRunFinished((payload) => seen.push(payload));
  assert.equal(typeof off, "function");
  assert.equal(typeof api.onRunFinished(null), "function");

  const settled = await api.run(["plan"], { title: "Plan" });
  assert.equal(settled.ok, true);
  assert.equal(settled.outcome, "completed");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].outcome, "completed");
  assert.equal(seen[0].entryId, "plan");
  assert.equal(seen[0].effect, "reads");
  assert.deepEqual(seen[0].invalidates, []);
  off();

  const catalog = api.catalog();
  assert.equal(catalog.bob_version, "0.3.1-test");
  const last = api.lastRun();
  assert.equal(last.runId, settled.runId);
  assert.equal(last.outcome, "completed");

  const broken = helpers.cmCreateApi({ run: () => Promise.reject(new Error("nope")), catalog: () => null, newestRecord: () => null, deps: {} });
  const refused = await broken.run(["x"]);
  assert.equal(refused.ok, false);

  const noOutput = await api.openOutput("missing-id");
  assert.equal(noOutput.ok, false);
});

test("plugin onload registers run-* commands and exposes the frozen api", async () => {
  takeNotices();
  const app = makeApp();
  app.vault.adapter.getBasePath = () => os.tmpdir();
  const plugin = new BobCommandModePlugin(app);
  assert.ok(plugin instanceof TestPlugin);
  const { fixtureCatalog: catalogFixture } = require("./command-mode-harness.cjs");
  const stat = fs.statSync(FAKE_BOB);
  plugin.stored = {
    settings: { bobPath: FAKE_BOB },
    catalogCache: {
      fingerprint: { path: FAKE_BOB, mtimeMs: stat.mtimeMs, size: stat.size },
      catalog: catalogFixture(),
    },
  };
  await plugin.onload();
  assert.equal(plugin.commandModeState, "ready");
  assert.equal((await plugin.commandModeRefreshCatalog("force")).state, "ready");
  assert.ok(plugin.api);
  assert.equal(plugin.api.version, 1);
  assert.equal(plugin.api.commandMode.version, 1);
  assert.ok(Object.isFrozen(plugin.api.commandMode));
  const ids = [...plugin.commands.keys()];
  assert.ok(ids.includes("rerun-last"), "expected rerun-last command");
  assert.ok(ids.includes("show-last-output"), "expected show-last-output command");
  assert.ok(ids.includes("run-plan"), "expected run-plan in " + ids.join(","));
  assert.ok(ids.includes("run-ready"));
  assert.ok(!ids.includes("run-ref-create"), "required-arg entries get no command");
  assert.ok(ids.includes("open"), "the sheet phase registers open");
  const spec = plugin.commands.get("run-plan");
  assert.equal(spec.name, "Bob: Today's plan");
  assert.equal(typeof spec.callback, "function");
  assert.equal(plugin.commandModeState, "ready");
  assert.ok(plugin.api.commandMode.catalog().entries.length >= 6);
  assert.equal(plugin.settingTabs.length, 1);
  plugin.onunload();
  assert.equal(plugin.commandModeRunner, null);
});

test("plugin reports missing-bob when the binary is absent", async () => {
  const app = makeApp();
  app.vault.adapter.getBasePath = () => os.tmpdir();
  const plugin = new BobCommandModePlugin(app);
  plugin.stored = { settings: { bobPath: "/nonexistent/bob-xyz" }, catalogCache: {} };
  await plugin.onload();
  assert.equal(plugin.commandModeState, "missing-bob");
  assert.deepEqual(plugin.commandModeMissingBob.tried, []);
  plugin.onunload();
});

test("runner notifies with a plain summary after each finish", async () => {
  takeNotices();
  const base = makeRunner({});
  base.runner.deps.env = { ...process.env, XDG_STATE_HOME: base.tmpState, PATH: "/usr/bin:/bin" };
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  const plugin = new BobCommandModePlugin(makeApp());
  plugin.commandModeRunner = base.runner;
  plugin.commandModeNotify({ ok: true, outcome: "completed", reason: undefined });
  plugin.commandModeNotify({ ok: false, outcome: "failed", reason: "error: bad input" });
  const notes = takeNotices();
  assert.ok(notes.includes("error: bad input"));
});

test("catalog outcome adapters cover command-specific results and actions", () => {
  const classifyAdapter = (adapterId, exitCode, stdoutText = "", stderrText = "", run = {}) => classify({
    adapterId, exitCode, stdoutText, stderrText, run,
  });

  const queued = classifyAdapter("ref-create", 0, "queued: papers/a.pdf (network: try again) · next: bob ref scan\n");
  assert.equal(queued.outcome, "attention");
  assert.match(queued.summary, /try again/);
  assert.equal(queued.actions[0].label, "Scan intake");
  const ingested = classifyAdapter("ref-create", 0, "ingested: in/a.pdf → ref/papers/A Paper.md\n");
  assert.equal(ingested.outcome, "completed");
  assert.deepEqual(ingested.actions[0], { id: "open-vault-note", label: "Open note", path: "ref/papers/A Paper.md" });

  assert.deepEqual(classifyAdapter("ref-scan", 0, "3 held\n"), { outcome: "attention", summary: "3 PDF writes held" });
  assert.deepEqual(classifyAdapter("ref-scan", 0, "pdf_markers_held: 3\n"), { outcome: "attention", summary: "3 PDF writes held" });
  assert.deepEqual(classifyAdapter("ref-scan", 1, "Still queued: paper.pdf\n"), { outcome: "attention", summary: "Intake is still queued" });
  assert.deepEqual(classifyAdapter("vault-sync", 0), {
    outcome: "attention", summary: "Skipped — another bob maintenance run holds the lock", retry: true,
  });
  const conflict = classifyAdapter("vault-sync", 1, "conflict: Daily/Today.md\n");
  assert.equal(conflict.outcome, "attention");
  assert.equal(conflict.actions[0].path, "_conflicts/sync_conflicts.md");

  assert.deepEqual(classifyAdapter("json-write", 0, '{"ok":true,"hidden":["Deep Work"]}', "", { entry_id: "themes-hide" }), {
    outcome: "completed", summary: "Hid Deep Work",
  });
  assert.equal(classifyAdapter("json-write", 1, '{"ok":false,"code":"unchanged","message":"Already hidden"}').outcome, "attention");
  assert.equal(classifyAdapter("json-write", 1, '{"ok":false,"code":"lock_busy","message":"busy"}').retry, true);

  const deployed = classifyAdapter("plugins-sync", 0, JSON.stringify({ ok: true, plugins: [
    { id: "alpha", files: [{ action: "updated" }, { action: "unchanged" }] },
  ] }));
  assert.equal(deployed.summary, "Deployed 1: alpha");
  assert.deepEqual(deployed.actions[0].pluginIds, ["alpha"]);
  const dirty = classifyAdapter("plugins-sync", 0, JSON.stringify({ ok: true, plugins: [
    { id: "alpha", files: [{ action: "skipped_dirty" }] },
  ] }));
  assert.equal(dirty.outcome, "attention");

  const reroll = classifyAdapter("task-reroll", 0, "seed 0x0000002a · undo\n", "", { preview: true });
  assert.deepEqual(reroll.carry, ["--seed", "0x0000002a"]);
  assert.equal(reroll.actions[0].label, "Apply");
  assert.deepEqual(classifyAdapter("pomodoro-status", 0), { outcome: "completed", summary: "No Pomodoro running" });
  assert.deepEqual(classifyAdapter("capture-session", 1, "", "finish the current Pomodoro first\n"), {
    outcome: "failed", summary: "finish the current Pomodoro first",
  });
  assert.deepEqual(classifyAdapter("gkeep-pull", 0, '{"pulled":0}'), {
    outcome: "completed", summary: "Keep inbox already empty",
  });
});

test("toast classes have distinct timing and newer failures replace older cards", () => {
  const restoreDocument = installDocument();
  try {
    takeToastNotices();
    const plugin = new BobCommandModePlugin(makeApp());
    plugin.settings = { osNotifications: false };
    plugin.commandModeStickyNotices = new Map();
    const opened = [];
    plugin.commandModeOpenOutput = (id) => { opened.push(id); return { ok: true }; };

    const cases = [
      ["completed", 5000], ["attention", 8000], ["failed", 0], ["unknown", 0], ["stopped", 5000],
    ];
    for (const [outcome, duration] of cases) {
      const notice = plugin.commandModeNotify({
        outcome,
        runId: outcome,
        record: { id: outcome, entry_id: "test-" + outcome, title: "Plan", argv: ["/usr/bin/bob", "plan"], summary: "Done" },
      });
      assert.equal(notice.duration, duration);
      const card = notice.message.children[0];
      assert.ok(card.classList.contains("bob-cmd-toast"));
      assert.ok(card.classList.contains("is-" + outcome));
      assert.equal(card.children[0].children[0].textContent.length > 0, true);
      const labels = card.children[2].children.map((button) => button.textContent);
      assert.deepEqual(labels.slice(-3), ["Output", "Retry", "Copy"]);
      if (outcome === "completed") card.children[1].listeners.click({ defaultPrevented: false });
    }
    assert.deepEqual(opened, ["completed"], "clicking the toast body opens its output");

    const project = plugin.commandModeNotify({
      outcome: "completed", actions: [{ id: "adapter", label: "Adapter action" }],
      record: { id: "project", entry_id: "projects-sync", argv: ["bob", "projects", "sync"], summary: "Synced projects" },
    });
    const projectLabels = project.message.children[0].children[2].children.map((button) => button.textContent);
    assert.deepEqual(projectLabels, ["Adapter action", "Reconcile tasks", "Output", "Retry", "Copy"]);

    const dirty = plugin.commandModeNotify({
      outcome: "failed", reason: "dirty paths: Daily/today.md", record: { id: "dirty", entry_id: "rename", argv: ["bob", "themes", "rename"] },
    });
    assert.equal(dirty.message.children[0].children[1].children[0].textContent, "Commit pending edits first");
    assert.equal(dirty.message.children[0].children[2].children[0].textContent, "Sync vault, then retry");

    const missing = plugin.commandModeNotify({
      outcome: "failed", reason: "bob not found (tried /one/bob, /two/bob)", record: { id: "missing", argv: ["bob", "plan"] },
    });
    assert.equal(missing.message.children[0].children[2].children[0].textContent, "Open settings");

    const first = plugin.commandModeNotify({ outcome: "failed", record: { id: "old", entry_id: "same", summary: "bad" } });
    const second = plugin.commandModeNotify({ outcome: "failed", record: { id: "new", entry_id: "same", summary: "worse" } });
    assert.equal(first.hidden, true);
    assert.equal(second.duration, 0);
    assert.equal(plugin.commandModeStickyNotices.get("same"), second);
  } finally {
    restoreDocument();
    takeToastNotices();
  }
});

test("status chip waits 400 ms, tracks multiple runs, and marks overdue writers", () => {
  const { ElementStub } = require("./modal-harness.cjs");
  const chip = new ElementStub({ tag: "span", cls: "bob-cmd-chip" });
  const opened = [];
  const now = Date.parse("2026-10-26T15:00:00.000Z");
  const run = (id, elapsed, extra = {}) => ({
    id, title: "Sync vault", outcome: "running", effect: "writes", budget_secs: 180,
    started_at: new Date(now - elapsed).toISOString(), argv: ["/usr/bin/bob", "vault-sync", "run"], ...extra,
  });
  const childText = (cls) => {
    const found = (chip.children || []).find((child) => (child.classes || []).includes(cls) || String(child.className || "").split(/\s+/).includes(cls));
    return found ? found.textContent : "";
  };

  assert.deepEqual(helpers.cmRenderStatusChip(chip, [run("one", 399)], now, (id) => opened.push(id)), { visible: false, runs: 1 });
  const chipState = { shown: new Set(), settle: null };
  const shown = helpers.cmRenderStatusChip(chip, [run("one", 400)], now, (id) => opened.push(id), () => "pulling", chipState);
  assert.equal(shown.visible, true);
  assert.equal(childText("bob-cmd-chip-label"), "bob");
  assert.equal(childText("bob-cmd-chip-clock"), "0:00");
  assert.match(chip.getAttribute("aria-label"), /Sync vault · 0:00/);
  assert.match(chip.getAttribute("aria-label"), /bob vault-sync run/);
  assert.match(chip.getAttribute("aria-label"), /Last: pulling/);
  assert.equal(chip.getAttribute("title"), undefined);
  const marks = (chip.children || []).filter((child) => (child.classes || []).includes("bob-cmd-chip-mark"));
  assert.equal(marks.length, 1);
  const firstMark = marks[0];
  const multiple = helpers.cmRenderStatusChip(chip, [run("one", 10000), run("two", 2000)], now, (id) => opened.push(id), () => "", chipState);
  assert.equal(multiple.runs, 2);
  assert.equal(childText("bob-cmd-chip-label"), "bob ×2");
  assert.equal(childText("bob-cmd-chip-clock"), "0:10");
  const marksAfter = (chip.children || []).filter((child) => (child.classes || []).includes("bob-cmd-chip-mark"));
  assert.equal(marksAfter[0], firstMark);
  chip.onclick();
  assert.deepEqual(opened, ["two"]);

  const overdue = helpers.cmRenderStatusChip(chip, [run("late", 181000)], now, () => {}, () => "", chipState);
  assert.equal(overdue.overdue, true);
  assert.match(chip.getAttribute("aria-label"), /past its ~3 min budget/);
  assert.ok(chip.classList.contains("is-overdue"));
  assert.equal(helpers.cmRenderStatusChip(chip, [], now, () => {}, () => "", chipState).visible, false);
  assert.equal(chip.style.display, "none");
});

test("OS notifications only fire for long runs while Obsidian is unfocused", () => {
  const restoreDocument = installDocument({ focused: false });
  const previousNotification = global.Notification;
  const previousWindow = global.window;
  const shown = [];
  let focused = 0;
  global.Notification = class TestNotification {
    constructor(title, options) { this.title = title; this.options = options; shown.push(this); }
  };
  global.window = { focus: () => { focused += 1; } };
  try {
    const plugin = new BobCommandModePlugin(makeApp());
    plugin.settings = { osNotifications: true };
    plugin.commandModeStickyNotices = new Map();
    const opened = [];
    plugin.commandModeOpenOutput = (id) => { opened.push(id); return { ok: true }; };
    assert.equal(plugin.commandModeMaybeNotifyOS({ outcome: "completed", runId: "short", record: { id: "short", duration_ms: 15000 } }), false);
    assert.equal(plugin.commandModeMaybeNotifyOS({ outcome: "completed", runId: "long", record: { id: "long", duration_ms: 15001, title: "Sync vault", summary: "Done" } }), true);
    assert.equal(shown.length, 1);
    global.document.hasFocus = () => true;
    assert.equal(plugin.commandModeMaybeNotifyOS({ outcome: "completed", record: { id: "focused", duration_ms: 20000 } }), false);
    global.document.hasFocus = () => false;
    shown[0].onclick();
    assert.equal(focused, 1);
    assert.deepEqual(opened, ["long"]);
    plugin.settings.osNotifications = false;
    assert.equal(plugin.commandModeMaybeNotifyOS({ outcome: "completed", record: { id: "disabled", duration_ms: 20000 } }), false);
  } finally {
    restoreDocument();
    if (previousNotification === undefined) delete global.Notification;
    else global.Notification = previousNotification;
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test("rerun-last preserves arguments and preview mode; Apply carries the replay seed", async () => {
  const calls = [];
  const plugin = new BobCommandModePlugin(makeApp());
  const entry = {
    id: "task-reroll", path: ["task", "reroll"], fixed: [], preview: ["--dry-run"],
    title: "Re-roll due prioritized tasks", effect: "writes", policy: "preview-first",
  };
  plugin.commandModeRunner = {
    catalog: () => ({ entries: [entry] }),
    newestRecord: () => null,
    run: (argv, options) => { calls.push({ argv, options }); return Promise.resolve({ ok: true }); },
  };
  const record = {
    id: "reroll", entry_id: "task-reroll", title: "Re-roll due prioritized tasks", preview: true,
    bob_path: "/usr/local/bin/bob", argv: ["/usr/local/bin/bob", "task", "reroll", "--dry-run", "--level", "P2"],
  };
  await plugin.commandModeRerun(record);
  await plugin.commandModeRerun(record, { carry: ["--seed", "0x0000002a"], preview: false });
  assert.deepEqual(calls.map((call) => call.argv), [
    ["task", "reroll", "--level", "P2"],
    ["task", "reroll", "--level", "P2", "--seed", "0x0000002a"],
  ]);
  assert.equal(calls[0].options.preview, true);
  assert.equal(calls[1].options.preview, false);
});

function renameCatalog() {
  const base = fixtureCatalog();
  return {
    ...base,
    entries: [
      ...base.entries,
      {
        id: "ref-rename", path: ["ref", "rename"], fixed: [], title: "Rename a reference",
        about: "Rename", section: "vault", keywords: ["rename"],
        effect: "syncs", network: false, presentation: "action",
        policy: "preview-first", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [
          { name: "REF", slot: "ref", required: true, repeat: false },
          { name: "NAME", slot: "text", required: true, repeat: false },
        ],
        exit_codes: [], adapter: null, hosts: [], invalidates: ["references"],
      },
    ],
  };
}

function pluginWithRealRunner() {
  const restore = installDocument();
  const catalog = renameCatalog();
  const base = makeRunner({ catalog });
  base.runner.deps.env = {
    ...process.env,
    XDG_STATE_HOME: base.tmpState,
    PATH: "/usr/bin:/bin",
    FAKE_BOB_EXIT: "0",
  };
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  const plugin = new BobCommandModePlugin(makeApp());
  plugin.commandModeRunner = base.runner;
  plugin.commandModeCatalog = catalog;
  return { restore, base, plugin };
}

test("commandModeRerun retries an applied preview-first run and Apply carries the seed", async () => {
  const { restore, base, plugin } = pluginWithRealRunner();
  try {
    const applied = await base.runner.run(["ref", "rename", "old.md", "New"], {
      entryId: "ref-rename", title: "Rename a reference", skipGuards: true,
    });
    assert.ok(applied.ok, applied.reason);
    const retried = await plugin.commandModeRerun(helpers.cmPagerFindRecord(base.runner, applied.runId));
    assert.ok(retried.ok && retried.runId, retried.reason);
    const retriedRecord = helpers.cmPagerFindRecord(base.runner, retried.runId);
    assert.deepEqual(helpers.cmRecordArgs(retriedRecord), ["ref", "rename", "old.md", "New"]);
    assert.equal(retriedRecord.preview, false);
    const preview = await base.runner.run(["ref", "rename", "old.md", "New"], {
      entryId: "ref-rename", title: "Rename a reference", preview: true,
    });
    assert.ok(preview.ok, preview.reason);
    const appliedCarry = await plugin.commandModeRerun(
      helpers.cmPagerFindRecord(base.runner, preview.runId),
      { carry: ["--seed", "0x0000002a"], preview: false },
    );
    assert.ok(appliedCarry.ok && appliedCarry.runId, appliedCarry.reason);
    const carryRecord = helpers.cmPagerFindRecord(base.runner, appliedCarry.runId);
    assert.ok(!helpers.cmRecordArgs(carryRecord).includes("--dry-run"));
    assert.deepEqual(helpers.cmRecordArgs(carryRecord), ["ref", "rename", "old.md", "New", "--seed", "0x0000002a"]);
    assert.equal(carryRecord.preview, false);
  } finally {
    restore();
  }
});
