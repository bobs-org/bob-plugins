// Period-note creation hook: adoption gate, triggers, spawn args, failure
// paths, and the "Open this week's note" command.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const notices = [];

const originalLoad = Module._load;
Module._load = function loadObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class {
        constructor(text) {
          notices.push(String(text));
        }
      },
      Platform: { isDesktopApp: false },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {}, keymap: { of: (value) => value } };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

const {
  periodNotesEnsureArgs,
  periodNotesAdoptionPath,
  periodNotesMigrateCommand,
  periodNotesIsoWeekYear,
  periodNotesWeekNotePath,
  periodNotesDecodeEnsure,
  periodNotesFailureKind,
  periodNotesNoticeText,
  periodNotesNotAdoptedText,
  periodNotesShouldSyncCreatedFile,
  PERIOD_NOTES_ENSURE_TIMEOUT_MS,
  PERIOD_NOTES_MIDNIGHT_TICK_MS,
  PERIOD_NOTES_LOCK_RETRY_MS,
  todayDailyPath,
} = LedgerToolsPlugin.helpers;

function makeHarness({ vaultPaths = {}, spawn = null } = {}) {
  const vaultFiles = new Map(Object.entries(vaultPaths));
  const callbacks = {};
  let layoutReady = null;
  const commands = [];
  const spawns = [];
  const opened = [];
  const app = {
    internalPlugins: { plugins: {} },
    workspace: {
      onLayoutReady(callback) {
        layoutReady = callback;
      },
    },
    vault: {
      getAbstractFileByPath: (path) => vaultFiles.get(path) || null,
      on(event, callback) {
        callbacks[event] = callback;
        return { event, callback };
      },
    },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.addCommand = (definition) => {
    commands.push(definition);
    return definition;
  };
  plugin.registerEvent = (reference) => reference;
  // Immediately release real timers: the stub stands in for Obsidian's
  // auto-cleaned intervals, and a live 5 s handle would hang the runner.
  plugin.registerInterval = (handle) => {
    try {
      clearInterval(handle);
    } catch (error) {
      // Timer cleanup is best-effort.
    }
    return handle;
  };
  plugin.periodNotesRunSpawn = async (args, decode, options) => {
    spawns.push({ args: args.slice(), options });
    if (typeof spawn === "function") {
      return spawn({ args, decode, options, spawns, vaultFiles });
    }
    return {
      ok: true,
      report: { ok: true, schema_version: 1, created: [], filled: [], existing: [], dry_run: false },
    };
  };
  plugin.periodNotesOpenFile = async (file) => {
    opened.push(file);
    return true;
  };
  return {
    plugin,
    app,
    vaultFiles,
    callbacks,
    commands,
    spawns,
    opened,
    fireLayoutReady: () => {
      if (typeof layoutReady === "function") layoutReady();
    },
  };
}

function okReport() {
  return {
    ok: true,
    report: { ok: true, schema_version: 1, created: [], filled: [], existing: [], dry_run: false },
  };
}

test("week note paths follow the ISO week-year golden facts", () => {
  assert.deepEqual(periodNotesIsoWeekYear(new Date(2025, 11, 29)), { isoYear: 2026, week: 1 });
  assert.deepEqual(periodNotesIsoWeekYear(new Date(2026, 11, 28)), { isoYear: 2026, week: 53 });
  assert.deepEqual(periodNotesIsoWeekYear(new Date(2027, 0, 4)), { isoYear: 2027, week: 1 });
  assert.deepEqual(periodNotesIsoWeekYear(new Date(2026, 10, 3)), { isoYear: 2026, week: 45 });
  assert.equal(periodNotesWeekNotePath(new Date(2025, 11, 29)), "2026/2026-W01.md");
  assert.equal(periodNotesWeekNotePath(new Date(2026, 11, 28)), "2026/2026-W53.md");
  assert.equal(periodNotesWeekNotePath(new Date(2027, 0, 4)), "2027/2027-W01.md");
  assert.equal(periodNotesWeekNotePath(new Date(2026, 10, 3)), "2026/2026-W45.md");
  assert.equal(periodNotesWeekNotePath("2026-11-03"), null);
  assert.equal(periodNotesWeekNotePath(new Date("not a date")), null);
  assert.equal(periodNotesWeekNotePath(null), null);
});

test("ensure argv, adoption path, and timing constants match the contract", () => {
  assert.deepEqual(periodNotesEnsureArgs(), ["periods", "ensure", "-q", "-f", "json"]);
  assert.equal(periodNotesAdoptionPath(), "all_time.md");
  assert.equal(periodNotesMigrateCommand(), "bob periods migrate");
  assert.equal(PERIOD_NOTES_ENSURE_TIMEOUT_MS, 15000);
  assert.equal(PERIOD_NOTES_MIDNIGHT_TICK_MS, 5000);
  assert.equal(PERIOD_NOTES_LOCK_RETRY_MS, 60000);
});

test("adoption gate keeps ensure inert without all_time.md", async () => {
  const harnessed = makeHarness({ vaultPaths: {} });
  const result = await harnessed.plugin.periodNotesRunEnsure("daily-note-created");
  assert.equal(harnessed.spawns.length, 0);
  assert.equal(result.code, "not-adopted");
});

test("create trigger reuses the daily-note file test and fires once per path", async () => {
  notices.length = 0;
  const harnessed = makeHarness({ vaultPaths: { "all_time.md": { path: "all_time.md" } } });
  harnessed.plugin.setupPeriodNotes();
  harnessed.fireLayoutReady();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harnessed.spawns.length, 1);
  const today = { path: todayDailyPath(new Date()) };
  harnessed.callbacks.create(today);
  harnessed.callbacks.create(today);
  harnessed.callbacks.create({ path: "2026/20261029.md" });
  harnessed.callbacks.create({ path: "Notes/today.md" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harnessed.spawns.length, 2);
  assert.deepEqual(harnessed.spawns[0].args, ["periods", "ensure", "-q", "-f", "json"]);
  assert.equal(harnessed.spawns[0].options.timeout, 15000);
  assert.equal(harnessed.spawns[0].options.commandLabel, "bob periods ensure");
  assert.equal(harnessed.plugin.periodNotesHandleCreate(today), false);
});

test("create trigger shares the gcal file test", () => {
  const now = new Date(2026, 9, 30, 9, 0, 0);
  const app = { internalPlugins: { plugins: {} } };
  assert.equal(
    periodNotesShouldSyncCreatedFile(true, { path: todayDailyPath(now) }, app, now),
    true,
  );
  assert.equal(
    periodNotesShouldSyncCreatedFile(false, { path: todayDailyPath(now) }, app, now),
    false,
  );
  assert.equal(
    periodNotesShouldSyncCreatedFile(true, { path: "2026/20261029.md" }, app, now),
    false,
  );
});

test("layout-ready and midnight ticks share one once-per-day slot", async () => {
  const harnessed = makeHarness({ vaultPaths: { "all_time.md": { path: "all_time.md" } } });
  const dayOne = new Date(2026, 10, 3, 9, 0, 0);
  const dayTwo = new Date(2026, 10, 4, 0, 0, 6);
  assert.equal(harnessed.plugin.periodNotesRunOncePerDay("layout-ready", dayOne), true);
  assert.equal(harnessed.plugin.periodNotesRunOncePerDay("midnight", dayOne), false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harnessed.spawns.length, 1);
  assert.equal(harnessed.plugin.periodNotesRunOncePerDay("midnight", dayTwo), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harnessed.spawns.length, 2);
});

test("decode maps ensure JSON and failure shapes", () => {
  const ok = periodNotesDecodeEnsure(
    JSON.stringify({ ok: true, schema_version: 1, created: ["2026/2026-W45.md"], filled: [], existing: [], dry_run: false }),
    "",
    0,
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.report.created, ["2026/2026-W45.md"]);
  const locked = periodNotesDecodeEnsure(
    JSON.stringify({ ok: false, schema_version: 1, error: { code: "lock_busy", message: "vault sync lock is held", hint: "retry" } }),
    "",
    1,
  );
  assert.equal(locked.ok, false);
  assert.equal(locked.code, "lock_busy");
  assert.equal(locked.detail, "retry");
  assert.equal(periodNotesDecodeEnsure("not json", "boom", 1).code, "bad-json");
  assert.equal(periodNotesDecodeEnsure(JSON.stringify({ ok: true }), "", 0).code, "bad-shape");
  assert.equal(periodNotesFailureKind(ok), null);
  assert.equal(periodNotesFailureKind({ ok: false, code: "x", message: "m", detail: "", exitCode: 2 }), "older-bob");
  assert.equal(
    periodNotesFailureKind({ ok: false, code: "bad-json", message: "Error: unrecognized subcommand 'periods'", detail: "", exitCode: 2 }),
    "older-bob",
  );
  assert.equal(periodNotesFailureKind(locked), "lock-busy");
  assert.equal(
    periodNotesFailureKind({ ok: false, code: "timeout", message: "timed out", detail: "" }),
    "notice",
  );
  assert.match(periodNotesNoticeText("timed out"), /^Period notes could not be created — /);
});

test("older bob warns once per session and never notices", async () => {
  notices.length = 0;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const harnessed = makeHarness({
      vaultPaths: { "all_time.md": { path: "all_time.md" } },
      spawn: () => ({
        ok: false,
        code: "bad-json",
        message: "Error: unrecognized subcommand 'periods'",
        detail: "",
        exitCode: 2,
      }),
    });
    await harnessed.plugin.periodNotesRunEnsure("daily", { retryDelayMs: 0 });
    await harnessed.plugin.periodNotesRunEnsure("daily", { retryDelayMs: 0 });
    assert.equal(harnessed.spawns.length, 2);
    assert.equal(warnings.length, 1);
    assert.equal(notices.length, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test("lock_busy retries once, then surfaces the second outcome", async () => {
  notices.length = 0;
  let calls = 0;
  const harnessed = makeHarness({
    vaultPaths: { "all_time.md": { path: "all_time.md" } },
    spawn: () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, code: "lock_busy", message: "vault sync lock is held", detail: "" };
      }
      return okReport();
    },
  });
  const result = await harnessed.plugin.periodNotesRunEnsure("midnight", { retryDelayMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(notices.length, 0);
});

test("other failures notice once per local day", async () => {
  notices.length = 0;
  const harnessed = makeHarness({
    vaultPaths: { "all_time.md": { path: "all_time.md" } },
    spawn: () => ({ ok: false, code: "timeout", message: "bob periods ensure timed out after 15 s.", detail: "" }),
  });
  const dayOne = new Date(2026, 10, 3, 9, 0, 0);
  const dayTwo = new Date(2026, 10, 4, 9, 0, 0);
  await harnessed.plugin.periodNotesRunEnsure("daily", { retryDelayMs: 0, now: dayOne });
  await harnessed.plugin.periodNotesRunEnsure("daily", { retryDelayMs: 0, now: dayOne });
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^Period notes could not be created — /);
  await harnessed.plugin.periodNotesRunEnsure("daily", { retryDelayMs: 0, now: dayTwo });
  assert.equal(notices.length, 2);
});

test("open-this-weeks-note honors the gate and the missing note", async () => {
  notices.length = 0;
  const gated = makeHarness({ vaultPaths: {} });
  assert.equal(await gated.plugin.openThisWeeksNote({ now: new Date(2026, 10, 3) }), null);
  assert.equal(gated.spawns.length, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /bob periods migrate/);

  notices.length = 0;
  const weekPath = "2026/2026-W45.md";
  const missing = makeHarness({
    vaultPaths: { "all_time.md": { path: "all_time.md" } },
    spawn: ({ vaultFiles }) => {
      vaultFiles.set(weekPath, { path: weekPath });
      return okReport();
    },
  });
  const created = await missing.plugin.openThisWeeksNote({ now: new Date(2026, 10, 3) });
  assert.equal(created && created.path, weekPath);
  assert.equal(missing.spawns.length, 1);
  assert.deepEqual(missing.opened.map((file) => file.path), [weekPath]);

  const present = makeHarness({
    vaultPaths: { "all_time.md": { path: "all_time.md" }, [weekPath]: { path: weekPath } },
  });
  const existing = await present.plugin.openThisWeeksNote({ now: new Date(2026, 10, 3) });
  assert.equal(existing && existing.path, weekPath);
  assert.equal(present.spawns.length, 0);
  assert.deepEqual(present.opened.map((file) => file.path), [weekPath]);
});

test("setup registers the open-week command and teardown clears the retry timer", () => {
  const harnessed = makeHarness({ vaultPaths: { "all_time.md": { path: "all_time.md" } } });
  harnessed.plugin.setupPeriodNotes();
  const command = harnessed.commands.find((entry) => entry.id === "open-this-weeks-note");
  assert.equal(Boolean(command), true);
  assert.equal(command.name, "Open this week's note");
  harnessed.plugin.periodNotesRetryTimer = 424242;
  const originalClear = global.clearTimeout;
  let cleared = null;
  global.clearTimeout = (handle) => {
    cleared = handle;
  };
  try {
    harnessed.plugin.teardownPeriodNotes();
  } finally {
    global.clearTimeout = originalClear;
  }
  assert.equal(cleared, 424242);
  assert.equal(harnessed.plugin.periodNotesRetryTimer, null);
  assert.match(periodNotesNotAdoptedText(), /bob periods migrate/);
});
