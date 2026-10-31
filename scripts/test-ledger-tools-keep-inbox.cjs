// Keep inbox indicator tests (keep-indicator-view): pure view model,
// parity fixture, tooltips/aria, paint skipping, DOM render, and spawn wiring.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}
const notices = [];
class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
}
class TestMenuItem {
  setTitle(title) { this.title = title; return this; }
  setIcon(icon) { this.icon = icon; return this; }
  onClick(callback) { this.callback = callback; return this; }
}
class TestMenu {
  static instances = [];
  constructor() {
    this.items = [];
    TestMenu.instances.push(this);
  }
  addItem(callback) {
    const item = new TestMenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent(event) { this.event = event; }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Menu: TestMenu,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

const { helpers } = LedgerToolsPlugin;
const {
  keepInboxDecodeStatus,
  keepInboxOpenCount,
  keepInboxViewModel,
  keepInboxPaint,
  keepInboxEnsureDom,
  bobSpawnJson,
} = helpers;

const FIXED_NOW = new Date("2026-10-31T16:00:00Z");

function statusReport(overrides = {}) {
  const keep = {
    state: "ok",
    verified: true,
    stale: false,
    in_flight: false,
    busy: false,
    checked_at: "2026-10-31T15:56:00Z",
    next_check_at: "2026-10-31T16:26:00Z",
    source: "status",
    pull: { total: 3, new: 1, links: 1, revised: 0, pending: 1 },
    stays: { pinned: 1, shared: 0, empty: 0 },
    error: null,
    ...(overrides.keep || {}),
  };
  const inbox = {
    path: "gkeep_inbox.md",
    exists: true,
    open: 1,
    ...(overrides.inbox || {}),
  };
  return {
    schema_version: 1,
    ok: true,
    configured: true,
    keep,
    inbox,
    ...overrides.top,
  };
}

function spawnOk(overrides = {}) {
  return { ok: true, report: statusReport(overrides) };
}

// Parity fixture (identical text in bob-cli and bob-plugins tests; both
// must count 5): bank, blocked, next, in-progress, grocery.
function parityTasks() {
  const rows = [
    { text: "Call the bank #task", symbol: " ", line: 0 },
    { text: "Blocked thing #task", symbol: "?", line: 1 },
    { text: "Next thing #task", symbol: "*", line: 2 },
    { text: "In progress thing #task", symbol: "/", line: 3 },
    { text: "Done thing #task", symbol: "x", line: 4 },
    { text: "Done uppercase #task", symbol: "X", line: 5 },
    { text: "Cancelled thing #task", symbol: "-", line: 6 },
    { text: "Grocery list #task", symbol: " ", line: 7 },
  ];
  const tasks = rows.map((row) => ({
    path: "gkeep_inbox.md",
    indentation: "",
    status: { symbol: row.symbol },
    description: row.text,
    lineNumber: row.line,
  }));
  // Nested lines never count, even with #task; untagged children never count.
  tasks.push({
    path: "gkeep_inbox.md",
    indentation: "  ",
    status: { symbol: " " },
    description: "milk",
    lineNumber: 8,
  });
  tasks.push({
    path: "gkeep_inbox.md",
    indentation: "  ",
    status: { symbol: " " },
    description: "eggs",
    lineNumber: 9,
  });
  tasks.push({
    path: "gkeep_inbox.md",
    indentation: "  ",
    status: { symbol: " " },
    description: "Hand-nested subtask #task",
    lineNumber: 10,
  });
  // Untagged top-level lines and fenced lines never reach us: Tasks'
  // `#task` global filter already excludes them, mirroring bob-cli's
  // `note_tasks` scan with the same filter.
  void 11;
  tasks.push({
    path: "other.md",
    indentation: "",
    status: { symbol: " " },
    description: "Elsewhere #task",
    lineNumber: 0,
  });
  return tasks;
}

function makeStatusEl() {
  const classes = new Set();
  const el = {
    textContent: "",
    attrs: {},
    handlers: {},
    children: [],
    clientWidth: 800,
    scrollWidth: 400,
    setText(value) {
      this.text = String(value);
      this.textContent = String(value);
    },
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    removeAttribute(key) {
      delete this.attrs[key];
    },
    empty() {
      this.children = [];
      this.textContent = "";
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      has: (name) => classes.has(name),
    },
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
    removeEventListener(event) {
      delete this.handlers[event];
    },
    createEl(tag, options = {}) {
      const child = makeStatusEl();
      child.tag = tag;
      child.cls = options.cls || "";
      if (options.cls) {
        for (const name of String(options.cls).split(/\s+/)) {
          if (name) child.classList.add(name);
        }
      }
      this.children.push(child);
      return child;
    },
  };
  return el;
}

function findByClass(el, className) {
  if (el.classList && el.classList.has(className)) {
    return el;
  }
  for (const child of el.children || []) {
    const found = findByClass(child, className);
    if (found) {
      return found;
    }
  }
  return null;
}

test("decode accepts schema 1 and marks the rest unsupported", () => {
  const good = keepInboxDecodeStatus(JSON.stringify(statusReport()), "", 0);
  assert.equal(good.ok, true);
  assert.equal(good.report.schema_version, 1);
  const garbage = keepInboxDecodeStatus("not json", "boom", 1);
  assert.equal(garbage.ok, false);
  assert.equal(garbage.code, "unsupported");
  const wrongSchema = keepInboxDecodeStatus(
    JSON.stringify({ schema_version: 2, ok: true }),
    "",
    0,
  );
  assert.equal(wrongSchema.ok, false);
  assert.equal(wrongSchema.code, "unsupported");
  const oldBob = keepInboxDecodeStatus(JSON.stringify({ ok: true }), "", 0);
  assert.equal(oldBob.ok, false);
  assert.equal(oldBob.code, "unsupported");
});

test("parity fixture counts 5 open top-level tasks", () => {
  assert.equal(keepInboxOpenCount(parityTasks(), "gkeep_inbox.md"), 5);
  assert.equal(keepInboxOpenCount([], "gkeep_inbox.md"), 0);
  assert.equal(keepInboxOpenCount(null, "gkeep_inbox.md"), 0);
});

test("hidden before the first read and when unconfigured", () => {
  assert.equal(
    keepInboxViewModel({ status: null, now: FIXED_NOW }).visible,
    false,
  );
  const unconfigured = {
    ok: true,
    report: { schema_version: 1, ok: true, configured: false },
  };
  assert.equal(
    keepInboxViewModel({ status: unconfigured, now: FIXED_NOW }).visible,
    false,
  );
});

test("unverified hides Keep but keeps a live inbox", () => {
  const report = statusReport({
    keep: { state: "unverified", verified: false, stale: false },
  });
  const view = keepInboxViewModel({
    status: { ok: true, report },
    inboxCount: 2,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(view.visible, true);
  assert.equal(view.keep.visible, false);
  assert.equal(view.inbox.visible, true);
  assert.equal(view.inbox.text, "2");
  assert.equal(view.connector.visible, false);
});

test("fresh, zero, stale, unknown, and signin tones", () => {
  const fresh = keepInboxViewModel({
    status: spawnOk(),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(fresh.keep.tone, "fresh");
  assert.equal(fresh.keep.text, "3");
  assert.equal(fresh.keep.icon, "lightbulb");
  assert.equal(fresh.connector.visible, true);

  const zero = keepInboxViewModel({
    status: spawnOk({ keep: { pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 } } }),
    inboxCount: 0,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(zero.keep.tone, "zero");
  assert.equal(zero.keep.text, "0");
  assert.equal(zero.inbox.text, "0");
  assert.equal(zero.inbox.tone, "zero");

  const stale = keepInboxViewModel({
    status: spawnOk({
      keep: {
        state: "offline",
        stale: true,
        error: { kind: "network", message: "down", hint: "", since: "2026-10-31T15:55:00Z", failures: 1 },
      },
    }),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(stale.keep.tone, "stale");
  assert.equal(stale.keep.text, "3");

  const unknown = keepInboxViewModel({
    status: spawnOk({
      keep: { state: "ok", stale: true, checked_at: "2026-10-29T18:02:00Z" },
    }),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(unknown.keep.tone, "unknown");
  assert.equal(unknown.keep.text, "–");

  const signin = keepInboxViewModel({
    status: spawnOk({ keep: { state: "auth", stale: false } }),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(signin.keep.tone, "signin");
  assert.equal(signin.keep.icon, "lightbulb-off");
  assert.equal(signin.keep.text, "");
});

test("old verified ok counts become unknown until checked again", () => {
  for (const total of [3, 0]) {
    const view = keepInboxViewModel({
      status: spawnOk({
        keep: {
          state: "ok",
          stale: false,
          pull: { total },
          checked_at: "2026-10-29T18:02:00Z",
        },
      }),
      now: FIXED_NOW,
    });
    assert.equal(view.keep.tone, "unknown");
    assert.equal(view.keep.text, "–");
    assert.ok(view.keep.tooltip.includes("Last checked"));
  }
});

test("unsupported hides Keep and lives only with the default file", () => {
  const bad = { ok: false, code: "unsupported", message: "nope" };
  const withFile = keepInboxViewModel({
    status: bad,
    tasksReady: false,
    defaultTargetExists: true,
    now: FIXED_NOW,
  });
  assert.equal(withFile.visible, true);
  assert.equal(withFile.keep.visible, false);
  assert.equal(withFile.inbox.visible, true);
  const withoutFile = keepInboxViewModel({
    status: bad,
    tasksReady: false,
    defaultTargetExists: false,
    now: FIXED_NOW,
  });
  assert.equal(withoutFile.visible, false);
});

test("tasks-not-ready falls back to bob's inbox.open, missing note shows –", () => {
  const fallback = keepInboxViewModel({
    status: spawnOk(),
    tasksReady: false,
    now: FIXED_NOW,
  });
  assert.equal(fallback.inbox.text, "1");
  const missing = keepInboxViewModel({
    status: spawnOk({ inbox: { path: "gkeep_inbox.md", exists: false, open: null } }),
    inboxCount: 0,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(missing.inbox.text, "–");
  assert.ok(missing.inbox.tooltip.includes("not found"));
});

test("tooltip and aria copy with a fixed now", () => {
  const fresh = keepInboxViewModel({
    status: spawnOk(),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.ok(fresh.keep.tooltip.includes("Google Keep · 3 notes to pull"));
  assert.ok(fresh.keep.tooltip.includes("1 new"));
  assert.ok(fresh.keep.tooltip.includes("Checked 4 min ago"));
  assert.ok(fresh.keep.aria.includes("3 Google Keep notes to pull"));
  assert.equal(fresh.inbox.tooltip, "gkeep_inbox.md · 1 open task to triage\nClick to open the inbox");
  assert.equal(fresh.inbox.aria, "1 open task in gkeep_inbox.md");

  const zero = keepInboxViewModel({
    status: spawnOk({ keep: { pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 } } }),
    inboxCount: 0,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.ok(zero.keep.tooltip.includes("nothing to pull"));
  assert.equal(zero.inbox.tooltip, "gkeep_inbox.md · inbox is clear\nClick to open the inbox");
});

test("paint key is stable and paint skips unchanged frames", () => {
  const args = { status: spawnOk(), inboxCount: 1, tasksReady: true, now: FIXED_NOW };
  const first = keepInboxViewModel(args);
  const second = keepInboxViewModel(args);
  assert.equal(first.paintKey, second.paintKey);
  const el = makeStatusEl();
  keepInboxPaint(el, first);
  const parts = el._bobKeepInboxParts;
  assert.ok(parts && parts.keepButton);
  assert.equal(el.attrs["data-keep-tone"], "fresh");
  keepInboxPaint(el, second);
  assert.equal(el._bobKeepInboxParts, parts);
  assert.equal(findByClass(el, "bob-keep-pill-count").textContent, "3");
  assert.equal(findByClass(el, "bob-keep-inbox-count").textContent, "1");
});

test("spawn wiring uses cache-only status with the Keep decoder", async () => {
  const seen = {};
  const stubExec = (path, args, options, callback) => {
    seen.path = path;
    seen.args = args;
    seen.options = options;
    callback(null, JSON.stringify(statusReport()), "");
  };
  const result = await bobSpawnJson(["gkeep", "status", "-f", "json"], keepInboxDecodeStatus, {
    commandLabel: "bob gkeep status",
    resolveBobPath: () => ({ path: "/bin/bob", source: "candidate" }),
    getVaultPath: () => "/vault",
    timeout: 15000,
    execFile: stubExec,
    tried: ["tried"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.report.keep.pull.total, 3);
  assert.equal(seen.path, "/bin/bob");
  assert.deepEqual(seen.args, ["gkeep", "status", "-f", "json"]);
  assert.equal(seen.options.env.BOB_DIR, "/vault");
  assert.equal(seen.options.env.NO_COLOR, "1");
  assert.equal(seen.options.timeout, 15000);
});

test("gkeep command-mode tag routes to the Keep inbox refresh", () => {
  const calls = [];
  const app = {
    plugins: { plugins: {} },
    workspace: {
      on: (name, callback) => {
        app.handler = callback;
        return { name };
      },
      offref: () => {},
      onLayoutReady: () => {},
    },
    vault: { getMarkdownFiles: () => [] },
    metadataCache: { on: () => ({}) },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  const registered = [];
  plugin.registerEvent = (ref) => {
    registered.push(ref);
  };
  plugin.keepInboxRecountFromTasks = () => {
    calls.push("recount");
  };
  plugin.keepInboxRequestRead = () => {
    calls.push("read");
    return Promise.resolve(null);
  };
  plugin.setupCommandModeRunRefresh();
  app.handler({ invalidates: ["gkeep"] });
  assert.deepEqual(calls, ["recount", "read"]);
});

function makeActionPlugin(options = {}) {
  const app = {
    plugins: { plugins: {} },
    workspace: { onLayoutReady: () => ({ layout: true }) },
    vault: { getAbstractFileByPath: () => ({ path: "gkeep_inbox.md" }) },
  };
  if (options.commandMode) {
    app.plugins.plugins["bob-command-mode"] = {
      api: { commandMode: options.commandMode },
    };
  }
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.keepInboxEl = makeStatusEl();
  plugin.keepInboxParts = {
    keepButton: makeStatusEl(),
    keepCount: makeStatusEl(),
    inboxButton: makeStatusEl(),
  };
  plugin.keepInboxEnabled = true;
  plugin.keepInboxLastStatus = { ok: true, report: statusReport() };
  plugin.keepInboxUpdateView = () => {};
  plugin.keepInboxRecountFromTasks = () => {};
  plugin.registerEvent = () => {};
  plugin.registerDomEvent = (target, name, callback) => {
    if (!target.handlers) target.handlers = {};
    target.handlers[name] = callback;
  };
  plugin.addCommand = (command) => {
    if (!plugin.testCommands) plugin.testCommands = [];
    plugin.testCommands.push(command);
  };
  plugin.apiStatsBobPath = () => ({ path: "/bin/bob", source: "test" });
  plugin.statsVaultBasePath = () => "/vault";
  plugin.keepInboxActionNow = () => plugin.testNow;
  plugin.testNow = FIXED_NOW.getTime();
  plugin.testTimers = new Map();
  plugin.testNextTimer = 1;
  plugin.keepInboxActionSetTimeout = (callback, delay) => {
    const id = plugin.testNextTimer++;
    plugin.testTimers.set(id, { callback, delay });
    return id;
  };
  plugin.keepInboxActionClearTimeout = (id) => plugin.testTimers.delete(id);
  plugin.setupKeepInboxActions();
  return plugin;
}

function jsonStatus(report) {
  return JSON.stringify(report);
}

function respondWith(plugin, report, calls = []) {
  plugin.keepInboxExecFile = (path, args, options, callback) => {
    calls.push({ path, args, options, callback });
    callback(null, jsonStatus(report), "");
  };
  return calls;
}

test("automatic checks require attention and a deferred timer fires on input", async (t) => {
  const priorDocument = global.document;
  const priorWindow = global.window;
  const documentStub = { visibilityState: "visible", hasFocus: () => false, handlers: {} };
  global.document = documentStub;
  global.window = { handlers: {} };
  t.after(() => {
    if (priorDocument === undefined) delete global.document;
    else global.document = priorDocument;
    if (priorWindow === undefined) delete global.window;
    else global.window = priorWindow;
  });
  const plugin = makeActionPlugin();
  const calls = respondWith(plugin, statusReport());
  plugin.keepInboxLastInputAt = plugin.testNow;
  plugin.keepInboxActionScheduleNextCheck("2026-10-31T16:30:00Z");
  const timer = plugin.keepInboxNextCheckTimer;
  assert.equal(plugin.testTimers.get(timer).delay, 30 * 60 * 1000);
  plugin.testTimers.get(timer).callback();
  assert.equal(plugin.keepInboxAutoDue, true);
  assert.equal(calls.length, 0);

  documentStub.hasFocus = () => true;
  plugin.keepInboxActionOnInput();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["gkeep", "status", "-r", "-f", "json"]);
  assert.equal(calls[0].options.timeout, 60000);
  await Promise.resolve();
  assert.equal(plugin.keepInboxAutoDue, false);
});

test("status timers clamp to one minute through two hours and null cancels", () => {
  const plugin = makeActionPlugin();
  plugin.keepInboxActionScheduleNextCheck("2026-10-31T15:59:00Z");
  let timer = plugin.keepInboxNextCheckTimer;
  assert.equal(plugin.testTimers.get(timer).delay, 60 * 1000);
  plugin.keepInboxActionScheduleNextCheck("2026-11-01T00:00:00Z");
  timer = plugin.keepInboxNextCheckTimer;
  assert.equal(plugin.testTimers.get(timer).delay, 2 * 60 * 60 * 1000);
  plugin.keepInboxActionScheduleNextCheck(null);
  assert.equal(plugin.keepInboxNextCheckTimer, null);
  assert.equal(plugin.testTimers.size, 0);
});

test("layout schedules its first automatic check after fifteen seconds", async (t) => {
  const priorDocument = global.document;
  global.document = { visibilityState: "visible", hasFocus: () => true };
  t.after(() => {
    if (priorDocument === undefined) delete global.document;
    else global.document = priorDocument;
  });
  const plugin = makeActionPlugin();
  plugin.keepInboxLastInputAt = plugin.testNow;
  const calls = respondWith(plugin, statusReport());
  plugin.keepInboxActionScheduleInitialCheck();
  const timer = plugin.keepInboxInitialCheckTimer;
  assert.equal(plugin.testTimers.get(timer).delay, 15 * 1000);
  plugin.testTimers.get(timer).callback();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["gkeep", "status", "-r", "-f", "json"]);
  await Promise.resolve();
});

test("focus triggers coalesce to one refresh per fifteen seconds", async (t) => {
  const priorDocument = global.document;
  global.document = { visibilityState: "visible", hasFocus: () => true };
  t.after(() => {
    if (priorDocument === undefined) delete global.document;
    else global.document = priorDocument;
  });
  const plugin = makeActionPlugin();
  plugin.keepInboxLastInputAt = plugin.testNow;
  const calls = respondWith(plugin, statusReport());
  const first = plugin.keepInboxOnFocus("window-focus");
  const second = plugin.keepInboxOnFocus("visibility");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["gkeep", "status", "-r", "-f", "json"]);
  plugin.keepInboxActionOnInput();
  assert.equal(calls.length, 1);
  assert.equal(plugin.keepInboxAutoDue, false);
  await Promise.all([first, second]);
  plugin.testNow += 15000;
  await plugin.keepInboxOnFocus("online");
  assert.equal(calls.length, 2);
});

test("unattended focus reads cached status without refreshing Keep", async (t) => {
  const priorDocument = global.document;
  global.document = { visibilityState: "visible", hasFocus: () => false };
  t.after(() => {
    if (priorDocument === undefined) delete global.document;
    else global.document = priorDocument;
  });
  const plugin = makeActionPlugin();
  const calls = respondWith(plugin, statusReport());
  await plugin.keepInboxOnFocus("window-focus");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["gkeep", "status", "-f", "json"]);
});

test("unconfigured focus cache reads are throttled for ten minutes", async (t) => {
  const priorDocument = global.document;
  const priorDateNow = Date.now;
  let now = FIXED_NOW.getTime();
  Date.now = () => now;
  global.document = { visibilityState: "visible", hasFocus: () => false };
  t.after(() => {
    Date.now = priorDateNow;
    if (priorDocument === undefined) delete global.document;
    else global.document = priorDocument;
  });
  const plugin = makeActionPlugin();
  const calls = respondWith(plugin, statusReport({ top: { configured: false } }));
  await plugin.keepInboxOnFocus("window-focus");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["gkeep", "status", "-f", "json"]);
  await plugin.keepInboxOnFocus("visibility");
  assert.equal(calls.length, 1);
  now += 10 * 60 * 1000;
  await plugin.keepInboxOnFocus("online");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ["gkeep", "status", "-f", "json"]);
});

test("single flight queues one request and upgrades it from cache to forced", async () => {
  const plugin = makeActionPlugin();
  const calls = [];
  plugin.keepInboxExecFile = (path, args, options, callback) => {
    calls.push({ args, options, callback });
  };
  const cache = plugin.keepInboxRequestRead("test-cache");
  const automatic = plugin.keepInboxEnqueueStatusRequest("automatic", "test-auto");
  const forced = plugin.keepInboxCheckNow();
  const lowerPriority = plugin.keepInboxRequestRead("test-queued-cache");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["gkeep", "status", "-f", "json"]);
  calls[0].callback(null, jsonStatus(statusReport()), "");
  await cache;
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ["gkeep", "status", "-r", "-m", "0", "-f", "json"]);
  assert.equal(calls[1].options.timeout, 60000);
  calls[1].callback(null, jsonStatus(statusReport({
    keep: { refresh: { ran: true, skipped: null } },
  })), "");
  const results = await Promise.all([automatic, forced, lowerPriority]);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(calls.length, 2);
});

test("forced check feedback follows the bob refresh result", async () => {
  const plugin = makeActionPlugin();
  const seen = [];
  for (const refreshCase of [
    {
      name: "success",
      keep: { refresh: { ran: true, skipped: null } },
      notice: null,
    },
    {
      name: "failure",
      keep: { state: "offline", error: { message: "network down" }, refresh: { ran: true, skipped: null } },
      notice: "Couldn't check Google Keep: network down",
    },
    {
      name: "floor",
      keep: { checked_at: "2026-10-31T15:59:52Z", refresh: { ran: false, skipped: "floor" } },
      notice: "Google Keep was checked 8 s ago",
    },
    {
      name: "floor after old success",
      keep: { checked_at: "2026-10-31T14:00:00Z", refresh: { ran: false, skipped: "floor" } },
      notice: "Google Keep was checked less than a minute ago",
    },
    {
      name: "rate-limited",
      keep: { state: "rate_limited", next_check_at: "2026-10-31T16:30:00Z", refresh: { ran: false, skipped: "backoff" } },
      notice: "Google asked Bob to slow down · try after 16:30",
    },
    {
      name: "in-flight",
      keep: { refresh: { ran: false, skipped: "in_flight" } },
      notice: "A Keep check is already running",
    },
    {
      name: "busy pull",
      keep: { refresh: { ran: false, skipped: "busy" } },
      notice: "A Keep pull is running",
    },
  ]) {
    notices.length = 0;
    respondWith(plugin, statusReport({ keep: refreshCase.keep }));
    await plugin.keepInboxCheckNow();
    assert.equal(notices[0] || null, refreshCase.notice, refreshCase.name);
    seen.push(refreshCase.name);
  }
  assert.deepEqual(seen, ["success", "failure", "floor", "floor after old success", "rate-limited", "in-flight", "busy pull"]);
  assert.ok(plugin.keepInboxInFlightRereadTimer !== null);
});

test("bulb clicks route by tone and missing Command Mode gives a preview hint", async () => {
  notices.length = 0;
  const plugin = makeActionPlugin();
  const clicked = plugin.keepInboxParts.keepButton.handlers.click;
  plugin.keepInboxLastView = { keep: { tone: "fresh" } };
  clicked({ preventDefault() {}, stopPropagation() {} });
  assert.equal(notices.pop(), "Preview with: bob gkeep pull -d");
  plugin.keepInboxLastView = { keep: { tone: "signin" } };
  clicked({ preventDefault() {}, stopPropagation() {} });
  assert.equal(notices.pop(), "Preview with: Run bob gkeep doctor in a terminal");

  const commands = [];
  const commandModePlugin = makeActionPlugin({
    commandMode: { preview: async (argv) => { commands.push(argv); return { ok: true }; } },
  });
  commandModePlugin.keepInboxLastView = { keep: { tone: "fresh" } };
  await commandModePlugin.keepInboxParts.keepButton.handlers.click({
    preventDefault() {}, stopPropagation() {},
  });
  assert.deepEqual(commands, [["gkeep", "pull"]]);
  assert.deepEqual(commandModePlugin.testCommands.map((command) => [command.id, command.name]), [
    ["check-google-keep-now", "Check Google Keep now"],
    ["toggle-keep-inbox-indicator", "Toggle Keep inbox indicator"],
  ]);
});

test("context menus omit Command Mode actions when its preview API is unavailable", () => {
  TestMenu.instances.length = 0;
  const plugin = makeActionPlugin();
  const context = { preventDefault() {} };
  plugin.keepInboxParts.inboxButton.handlers.contextmenu(context);
  const withoutApi = TestMenu.instances.at(-1);
  assert.deepEqual(withoutApi.items.map((item) => item.title), [
    "Check Google Keep now",
    "Open gkeep_inbox.md",
    "Hide until restart",
  ]);

  const withApi = makeActionPlugin({ commandMode: { preview: async () => ({ ok: true }) } });
  withApi.keepInboxParts.keepButton.handlers.contextmenu(context);
  const withCommandMode = TestMenu.instances.at(-1);
  assert.deepEqual(withCommandMode.items.map((item) => item.title), [
    "Check Google Keep now",
    "Preview Keep pull…",
    "Open gkeep_inbox.md",
    "Keep setup check",
    "Hide until restart",
  ]);
});

test("turning the indicator off prevents all new automatic and forced checks", async () => {
  const plugin = makeActionPlugin();
  const calls = respondWith(plugin, statusReport());
  assert.equal(plugin.keepInboxToggleEnabled(), false);
  assert.equal(await plugin.keepInboxCheckNow(), null);
  assert.equal(await plugin.keepInboxActionTryAutomatic("test"), null);
  assert.equal(calls.length, 0);
  assert.equal(plugin.keepInboxEnabled, false);
});

test("verified transition to auth shows one sign-in notice per session", () => {
  notices.length = 0;
  const plugin = makeActionPlugin();
  plugin.keepInboxActionApplyStatus({
    ok: true,
    report: statusReport({ keep: { state: "auth", verified: true, next_check_at: null } }),
  });
  plugin.keepInboxActionApplyStatus({
    ok: true,
    report: statusReport({ keep: { state: "auth", verified: true, next_check_at: null } }),
  });
  assert.deepEqual(notices, ["Google Keep sign-in expired · run bob gkeep login in a terminal"]);
});
