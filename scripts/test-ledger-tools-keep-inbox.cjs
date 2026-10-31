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

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: class {},
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
