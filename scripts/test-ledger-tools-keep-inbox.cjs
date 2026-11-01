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

const setIconCalls = [];
function testSetIcon(node, name) {
  setIconCalls.push({ node, name });
  if (node) node.iconName = name;
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
      setIcon: testSetIcon,
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
  keepInboxTreeMember,
  keepInboxTreeCounts,
  keepInboxViewModel,
  keepInboxPaint,
  keepInboxEnsureDom,
  bobSpawnJson,
  KEEP_INBOX_TREE_ROOT,
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

function makeFakeVault(notes) {
  const files = (notes || []).map((note) => ({
    path: note.path,
    frontmatter: note.frontmatter || {},
  }));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const byStem = new Map();
  for (const file of files) {
    const name = String(file.path || "").split("/").pop() || "";
    const stem = name.replace(/\.md$/i, "");
    if (stem && !byStem.has(stem)) {
      byStem.set(stem, file);
    }
  }
  return {
    vault: {
      getAbstractFileByPath(path) {
        return byPath.get(path) || null;
      },
      async read() {
        return "";
      },
      on() {
        return {};
      },
    },
    metadataCache: {
      getFileCache(file) {
        const actual = file && typeof file.path === "string" ? byPath.get(file.path) : null;
        return actual ? { frontmatter: actual.frontmatter } : null;
      },
      getFirstLinkpathDest(name) {
        const stem = String(name || "").replace(/\.md$/i, "");
        return byStem.get(stem) || null;
      },
      on() {
        return {};
      },
    },
  };
}

function inboxTreeNotes() {
  return [
    { path: "inbox.md", frontmatter: { type: "area", parent: "[[gtd]]" } },
    { path: "mac_inbox.md", frontmatter: { type: "area", parent: "[[inbox]]" } },
    { path: "gkeep_inbox.md", frontmatter: { type: "area", parent: "[[inbox]]" } },
    { path: "mac_overflow.md", frontmatter: { type: "area", parent: "[[mac_inbox]]" } },
    { path: "gkeep_gdocs_inbox_dump.md", frontmatter: { type: "project", parent: "[[mac_inbox]]" } },
    { path: "dump_area.md", frontmatter: { type: "area", parent: "[[gkeep_gdocs_inbox_dump]]" } },
    { path: "inbox_overflow.md", frontmatter: { parent: [["inbox"]] } },
    { path: "area.md", frontmatter: { type: "area" } },
    { path: "elsewhere.md", frontmatter: { type: "area", parent: "[[area]]" } },
    { path: "missing_parent.md", frontmatter: { type: "area", parent: "[[no_such_note]]" } },
    { path: "loop_a.md", frontmatter: { type: "area", parent: "[[loop_b]]" } },
    { path: "loop_b.md", frontmatter: { type: "area", parent: "[[loop_a]]" } },
  ];
}

function treeMember(path, notes = inboxTreeNotes()) {
  const fake = makeFakeVault(notes);
  return keepInboxTreeMember(path, fake.metadataCache, fake.vault, new Map());
}

function openTask(path, extra = {}) {
  return {
    path,
    indentation: extra.indentation || "",
    status: { symbol: extra.symbol || " " },
    lineNumber: extra.lineNumber || 0,
  };
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

test("inbox tree membership walks area notes under inbox.md", () => {
  assert.equal(KEEP_INBOX_TREE_ROOT, "inbox.md");
  assert.equal(treeMember("inbox.md"), true);
  assert.equal(treeMember("mac_inbox.md"), true);
  assert.equal(treeMember("gkeep_inbox.md"), true);
  assert.equal(treeMember("mac_overflow.md"), true);
  assert.equal(treeMember("dump_area.md"), true);
  assert.equal(treeMember("gkeep_gdocs_inbox_dump.md"), false);
  assert.equal(treeMember("inbox_overflow.md"), false);
  assert.equal(treeMember("elsewhere.md"), false);
  assert.equal(treeMember("missing_parent.md"), false);
  assert.equal(treeMember("loop_a.md"), false);
  assert.equal(treeMember("loop_b.md"), false);
});

test("keepInboxTreeCounts skips nested done cancelled and non-members", () => {
  const seen = [];
  const isMember = (path) => {
    seen.push(path);
    return path === "gkeep_inbox.md" || path === "mac_inbox.md";
  };
  const tasks = [
    openTask("gkeep_inbox.md"),
    openTask("gkeep_inbox.md"),
    openTask("gkeep_inbox.md", { indentation: "  " }),
    openTask("gkeep_inbox.md", { symbol: "x" }),
    openTask("gkeep_inbox.md", { symbol: "-" }),
    openTask("mac_inbox.md"),
    openTask("alpha.md"),
    openTask("elsewhere.md"),
    openTask("inbox_overflow.md"),
  ];
  const counted = keepInboxTreeCounts(tasks, isMember);
  assert.equal(counted.total, 3);
  assert.deepEqual(
    counted.notes.map((note) => [note.path, note.label, note.open]),
    [
      ["gkeep_inbox.md", "gkeep_inbox", 2],
      ["mac_inbox.md", "mac_inbox", 1],
    ],
  );
  assert.deepEqual(seen, ["gkeep_inbox.md", "mac_inbox.md", "alpha.md", "elsewhere.md", "inbox_overflow.md"]);
  const tied = keepInboxTreeCounts(
    [openTask("zeta.md"), openTask("alpha.md"), openTask("zeta.md")],
    (path) => path === "alpha.md" || path === "zeta.md",
  );
  assert.deepEqual(
    tied.notes.map((note) => note.path),
    ["zeta.md", "alpha.md"],
  );
  assert.deepEqual(keepInboxTreeCounts(null, isMember), { total: 0, notes: [] });
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

test("fresh, stale, and signin tones", () => {
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

  const signin = keepInboxViewModel({
    status: spawnOk({ keep: { state: "auth", stale: false } }),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(signin.keep.tone, "signin");
  assert.equal(signin.keep.icon, "lightbulb-off");
  assert.equal(signin.keep.text, "");
  assert.equal(signin.keep.visible, true);
  assert.equal(signin.inbox.visible, true);
  assert.equal(signin.connector.visible, true);
});

test("each segment hides at zero and the item hides when both are empty", () => {
  const screenshot = keepInboxViewModel({
    status: spawnOk({ keep: { pull: { total: 4, new: 4, links: 0, revised: 0, pending: 0 } } }),
    inboxCount: 0,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(screenshot.visible, true);
  assert.equal(screenshot.keep.visible, true);
  assert.equal(screenshot.keep.text, "4");
  assert.equal(screenshot.inbox.visible, false);
  assert.equal(screenshot.connector.visible, false);

  const inboxOnly = keepInboxViewModel({
    status: spawnOk({ keep: { pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 } } }),
    inboxCount: 2,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(inboxOnly.visible, true);
  assert.equal(inboxOnly.keep.visible, false);
  assert.equal(inboxOnly.inbox.visible, true);
  assert.equal(inboxOnly.inbox.text, "2");
  assert.equal(inboxOnly.connector.visible, false);

  const bothZero = keepInboxViewModel({
    status: spawnOk({ keep: { pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 } } }),
    inboxCount: 0,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(bothZero.visible, false);
  assert.equal(bothZero.paintKey, "hidden-empty");

  const staleZero = keepInboxViewModel({
    status: spawnOk({
      keep: {
        state: "offline",
        stale: true,
        pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 },
        error: { kind: "network", message: "down", hint: "", since: "2026-10-31T15:55:00Z", failures: 1 },
      },
    }),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(staleZero.keep.visible, false);
  assert.equal(staleZero.inbox.visible, true);
});

test("old verified ok counts hide Keep until checked again", () => {
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
      inboxCount: 1,
      tasksReady: true,
      now: FIXED_NOW,
    });
    assert.equal(view.keep.visible, false);
    assert.equal(view.inbox.visible, true);
    assert.equal(view.inbox.text, "1");
  }
});

test("unsupported hides Keep and lives only with a positive inbox count", () => {
  const bad = { ok: false, code: "unsupported", message: "nope" };
  const withFile = keepInboxViewModel({
    status: bad,
    inboxCount: 2,
    tasksReady: true,
    defaultTargetExists: true,
    now: FIXED_NOW,
  });
  assert.equal(withFile.visible, true);
  assert.equal(withFile.keep.visible, false);
  assert.equal(withFile.inbox.visible, true);
  assert.equal(withFile.inbox.text, "2");
  const withFileZero = keepInboxViewModel({
    status: bad,
    inboxCount: 0,
    tasksReady: true,
    defaultTargetExists: true,
    now: FIXED_NOW,
  });
  assert.equal(withFileZero.visible, false);
  const withoutFile = keepInboxViewModel({
    status: bad,
    tasksReady: false,
    defaultTargetExists: false,
    now: FIXED_NOW,
  });
  assert.equal(withoutFile.visible, false);
});

test("tasks-not-ready hides the inbox even when bob's inbox.open is positive", () => {
  const fallback = keepInboxViewModel({
    status: spawnOk(),
    tasksReady: false,
    now: FIXED_NOW,
  });
  assert.equal(fallback.inbox.visible, false);
  const missingTarget = keepInboxViewModel({
    status: spawnOk({ inbox: { path: "gkeep_inbox.md", exists: false, open: null } }),
    inboxCount: 3,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(missingTarget.inbox.visible, true);
  assert.equal(missingTarget.inbox.text, "3");
  const unknown = keepInboxViewModel({
    status: spawnOk({ inbox: { path: "gkeep_inbox.md", exists: true, open: undefined } }),
    tasksReady: false,
    now: FIXED_NOW,
  });
  assert.equal(unknown.inbox.visible, false);
  const unverifiedZero = keepInboxViewModel({
    status: spawnOk({
      keep: { state: "unverified", verified: false, stale: false },
    }),
    inboxCount: 0,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(unverifiedZero.visible, false);
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
  assert.equal(fresh.inbox.tooltip, "Inbox · 1 open task to triage\nClick to open the inbox");
  assert.equal(fresh.inbox.aria, "1 open task in the inbox");
});

test("inbox tooltip lists the tree breakdown and names the click target", () => {
  const tree = keepInboxViewModel({
    status: spawnOk(),
    inboxCount: 6,
    inboxNotes: [
      { path: "gkeep_inbox.md", label: "gkeep_inbox", open: 4 },
      { path: "mac_inbox.md", label: "mac_inbox", open: 2 },
    ],
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(
    tree.inbox.tooltip,
    "Inbox · 6 open tasks to triage\ngkeep_inbox 4 · mac_inbox 2\nClick to open gkeep_inbox",
  );
  assert.equal(tree.inbox.aria, "6 open tasks in the inbox");
  const capped = keepInboxViewModel({
    status: spawnOk({ keep: { pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 } } }),
    inboxCount: 9,
    inboxNotes: [
      { path: "e.md", label: "e", open: 1 },
      { path: "d.md", label: "d", open: 1 },
      { path: "c.md", label: "c", open: 1 },
      { path: "b.md", label: "b", open: 2 },
      { path: "a.md", label: "a", open: 3 },
      { path: "f.md", label: "f", open: 1 },
    ],
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(
    capped.inbox.tooltip,
    "Inbox · 9 open tasks to triage\na 3 · b 2 · c 1 · d 1 · +2 more\nClick to open a",
  );
  const generic = keepInboxViewModel({
    status: spawnOk(),
    inboxCount: 2,
    tasksReady: true,
    now: FIXED_NOW,
  });
  assert.equal(generic.inbox.tooltip, "Inbox · 2 open tasks to triage\nClick to open the inbox");
  assert.equal(generic.inbox.aria, "2 open tasks in the inbox");
});

test("paint draws Lucide icons from the obsidian setIcon export", () => {
  setIconCalls.length = 0;
  const view = keepInboxViewModel({
    status: spawnOk(),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  const el = makeStatusEl();
  keepInboxPaint(el, view);
  assert.equal(findByClass(el, "bob-keep-pill-icon").iconName, "lightbulb");
  assert.equal(findByClass(el, "bob-keep-inbox-icon").iconName, "inbox");
  assert.equal(findByClass(el, "bob-keep-connector-icon").iconName, "chevron-right");
  assert.deepEqual(
    setIconCalls.map((call) => call.name),
    ["lightbulb", "chevron-right", "inbox"],
  );
});

test("paint hides the item when both counts are zero and restores it", () => {
  const visible = keepInboxViewModel({
    status: spawnOk(),
    inboxCount: 1,
    tasksReady: true,
    now: FIXED_NOW,
  });
  const hidden = keepInboxViewModel({
    status: spawnOk({ keep: { pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 } } }),
    inboxCount: 0,
    tasksReady: true,
    now: FIXED_NOW,
  });
  const el = makeStatusEl();
  keepInboxPaint(el, visible);
  assert.equal(el.classList.has("bob-keep-inbox-hidden"), false);
  assert.equal(findByClass(el, "bob-keep-pill-count").textContent, "3");
  assert.equal(findByClass(el, "bob-keep-inbox-count").textContent, "1");
  keepInboxPaint(el, hidden);
  assert.equal(el.classList.has("bob-keep-inbox-hidden"), true);
  keepInboxPaint(el, visible);
  assert.equal(el.classList.has("bob-keep-inbox-hidden"), false);
  assert.equal(findByClass(el, "bob-keep-pill-count").textContent, "3");
  assert.equal(findByClass(el, "bob-keep-inbox-count").textContent, "1");
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
      name: "success empty",
      keep: {
        pull: { total: 0, new: 0, links: 0, revised: 0, pending: 0 },
        refresh: { ran: true, skipped: null },
      },
      notice: "Google Keep · nothing to pull",
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
  assert.deepEqual(seen, ["success", "success empty", "failure", "floor", "floor after old success", "rate-limited", "in-flight", "busy pull"]);
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

test("keepInboxRecountNow stores the inbox-tree total and notes", () => {
  const fake = makeFakeVault(inboxTreeNotes());
  const tasks = [
    openTask("gkeep_inbox.md"),
    openTask("gkeep_inbox.md"),
    openTask("mac_inbox.md"),
    openTask("gkeep_gdocs_inbox_dump.md"),
    openTask("inbox_overflow.md"),
    openTask("dump_area.md"),
  ];
  const app = {
    plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks } } },
    workspace: { onLayoutReady: () => ({}), on: () => ({}) },
    vault: fake.vault,
    metadataCache: fake.metadataCache,
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.keepInboxUpdateView = () => {};
  plugin.keepInboxRecountNow("test");
  assert.equal(plugin.keepInboxTasksReady, true);
  assert.equal(plugin.keepInboxCount, 4);
  assert.deepEqual(
    plugin.keepInboxTreeNotes.map((note) => [note.path, note.open]),
    [
      ["gkeep_inbox.md", 2],
      ["dump_area.md", 1],
      ["mac_inbox.md", 1],
    ],
  );
});

test("inbox click opens the note with the most open tasks", async () => {
  const fake = makeFakeVault(inboxTreeNotes());
  const opened = [];
  const leaf = {
    openFile: async (file) => {
      opened.push(file && file.path);
    },
    view: { editor: { setCursor() {}, focus() {}, scrollIntoView() {} } },
  };
  const app = {
    plugins: { plugins: {} },
    workspace: {
      onLayoutReady: () => ({}),
      on: () => ({}),
      getLeaf: () => leaf,
    },
    vault: fake.vault,
    metadataCache: fake.metadataCache,
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.addStatusBarItem = () => makeStatusEl();
  plugin.registerEvent = () => {};
  plugin.registerDomEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.setupKeepInboxIndicator();
  const clicks = [];
  const originalOpen = plugin.openKeepInboxTreeNote.bind(plugin);
  plugin.openKeepInboxTreeNote = async (event) => {
    clicks.push(event);
    return originalOpen(event);
  };
  plugin.keepInboxTreeNotes = [
    { path: "gkeep_inbox.md", label: "gkeep_inbox", open: 4 },
    { path: "mac_inbox.md", label: "mac_inbox", open: 2 },
  ];
  plugin.keepInboxParts.inboxButton.handlers.click({ preventDefault() {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(clicks.length, 1);
  assert.deepEqual(opened, ["gkeep_inbox.md"]);
  opened.length = 0;
  plugin.keepInboxTreeNotes = [];
  await plugin.openKeepInboxTreeNote();
  assert.deepEqual(opened, ["inbox.md"]);
});

test("context menu Open gkeep_inbox.md still opens the Keep target", async () => {
  const opened = [];
  const plugin = makeActionPlugin();
  plugin.app.vault.getAbstractFileByPath = (path) => ({ path });
  plugin.app.workspace = {
    getLeaf: () => ({
      openFile: async (file) => {
        opened.push(file && file.path);
      },
      view: { editor: {} },
    }),
  };
  TestMenu.instances.length = 0;
  plugin.keepInboxParts.inboxButton.handlers.contextmenu({ preventDefault() {} });
  const menu = TestMenu.instances.at(-1);
  const openItem = menu.items.find((item) => item.title === "Open gkeep_inbox.md");
  assert.ok(openItem);
  await openItem.callback();
  await Promise.resolve();
  assert.deepEqual(opened, ["gkeep_inbox.md"]);
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
