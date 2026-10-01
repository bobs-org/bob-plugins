// Per-note Ready cap: `api.noteReady` v1 plus the shared frontmatter
// reader (bob-cli-3e fix) and the stat-cached `loadPlanCaps`.
// Vectors R1–R14 are copied verbatim from bob-cli `docs/plan.md`
// ("Ready cap per note" conformance vectors).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { beforeEach } = require("node:test");

class TestMarkdownView {}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  addStatusBarItem() {
    return null;
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerInterval(handle) {
    this.intervals = this.intervals || [];
    this.intervals.push(handle);
    return handle;
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
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

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  TODAY_RELOAD_EVENT,
  coercePlanCaps,
  defaultPlanCaps,
  effectivePlanCaps,
  loadPlanCaps,
  noteFrontmatterFor,
  noteReadyCrowdedKey,
  noteReadyEmptyTotals,
  noteReadyEvaluate,
  noteReadyKindFromType,
  noteReadyParentStem,
  noteReadyStatusIsTerminal,
  noteReadyStatusLabel,
  parseNoteReadyCap,
  planDefaultCapSource,
  planPerNoteCapOrDefault,
  resetPlanCapsCache,
} = helpers;

// Isolate every test from the real ~/.config/bob/config.yml.
const MISSING_XDG = "/definitely/missing/note-ready-test";
process.env.XDG_CONFIG_HOME = MISSING_XDG;

beforeEach(() => {
  resetPlanCapsCache();
  process.env.XDG_CONFIG_HOME = MISSING_XDG;
});

function withXdg(dir, run) {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    return run();
  } finally {
    if (saved === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = saved;
    }
  }
}

function writeConfigXdg(planObject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-ready-cfg-"));
  fs.mkdirSync(path.join(dir, "bob"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "bob", "config.yml"),
    JSON.stringify({ plan: planObject }),
  );
  return dir;
}

function laneTask(overrides = {}) {
  return {
    status: { type: "TODO", name: "Todo", symbol: " " },
    tags: [],
    path: "sase.md",
    lineNumber: 0,
    description: "Do it",
    originalMarkdown: "- [ ] Do it",
    isBlocked: () => false,
    ...overrides,
  };
}

function countedTasks(notePath, count, startLine = 0) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    out.push(
      laneTask({
        path: notePath,
        lineNumber: startLine + index,
        description: `Task ${index + 1}`,
        originalMarkdown: `- [ ] Task ${index + 1}`,
      }),
    );
  }
  return out;
}

// `files` maps vault paths to frontmatter objects. `getCache` accepts
// only path strings and `getFileCache` only file objects, mirroring the
// real Obsidian API (bob-cli-3e): any production `getCache({path})` /
// `getCache(file)` misuse throws here instead of silently returning
// null the way Obsidian does.
function makeNoteReadyApp({
  tasks,
  tasksState = "Warm",
  files = {},
  triggers = [],
  handlers = {},
} = {}) {
  const tasksPlugin =
    tasks === "throw"
      ? {
          getTasks: () => {
            throw new Error("tasks exploded");
          },
          getState: () => {
            throw new Error("state exploded");
          },
        }
      : {
          getTasks: () => tasks,
          getState: () => tasksState,
        };
  return {
    vault: {
      getAbstractFileByPath: (filePath) =>
        files[filePath] !== undefined ? { path: filePath } : null,
      getMarkdownFiles: () =>
        Object.keys(files).map((filePath) => ({ path: filePath })),
      cachedRead: () => Promise.resolve(null),
      on: (event, handler) => {
        handlers[`vault:${event}`] = handler;
        return {};
      },
    },
    workspace: {
      on: (event, handler) => {
        handlers[event] = handler;
        return {};
      },
      offref: () => {},
      onLayoutReady: () => {},
      getActiveFile: () => null,
      trigger: (event) => triggers.push(event),
    },
    metadataCache: {
      on: (event, handler) => {
        handlers[`metadata:${event}`] = handler;
        return {};
      },
      getCache: (key) => {
        assert.equal(
          typeof key,
          "string",
          "getCache expects a path string (bob-cli-3e)",
        );
        const entry = files[key];
        return entry === undefined ? null : { frontmatter: entry };
      },
      getFileCache: (file) => {
        assert.ok(
          file && typeof file === "object" && typeof file.path === "string",
          "getFileCache expects a file object (bob-cli-3e)",
        );
        const entry = files[file.path];
        return entry === undefined ? {} : { frontmatter: entry };
      },
      getFirstLinkpathDest: () => null,
    },
    commands: {},
    plugins: {
      plugins: { "obsidian-tasks-plugin": tasksPlugin },
    },
  };
}

function loadPlugin(options = {}) {
  const plugin = new LedgerToolsPlugin(makeNoteReadyApp(options), {});
  plugin.onload();
  return plugin;
}

function projectFiles(extra = {}) {
  return {
    "sase.md": { type: "[[project]]" },
    ...extra,
  };
}

function daysAgoText(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayText() {
  return daysAgoText(0);
}

// --- Caps ---------------------------------------------------------------

test("maxReadyPerNote defaults to 5 and validates 1–999", () => {
  assert.equal(defaultPlanCaps().maxReadyPerNote, 5);
  assert.equal(effectivePlanCaps({}).maxReadyPerNote, 5);
  assert.equal(effectivePlanCaps({ maxReadyPerNote: 8 }).maxReadyPerNote, 8);
  assert.equal(effectivePlanCaps({ maxReadyPerNote: 0 }).maxReadyPerNote, 5);
  assert.equal(
    effectivePlanCaps({ maxReadyPerNote: 1000 }).maxReadyPerNote,
    5,
  );
  assert.equal(
    coercePlanCaps({ max_ready_per_note: 3 }).caps.maxReadyPerNote,
    3,
  );
  assert.equal(
    coercePlanCaps({ maxReadyPerNote: 3 }).caps.maxReadyPerNote,
    3,
  );
  assert.equal(coercePlanCaps({ max_ready_per_note: 0 }).invalid, true);
  assert.deepEqual(
    coercePlanCaps({ max_ready_per_note: 1000 }).caps,
    defaultPlanCaps(),
  );
  assert.equal(planPerNoteCapOrDefault(7, 5), 7);
  assert.equal(planPerNoteCapOrDefault(0, 5), 5);
  assert.equal(planPerNoteCapOrDefault(1000, 5), 5);
  assert.equal(
    planDefaultCapSource({ max_ready_per_note: 3 }),
    "config",
  );
  assert.equal(planDefaultCapSource({}), "default");
  assert.equal(planDefaultCapSource({ max_ready_per_note: null }), "default");
});

test("loadPlanCaps caches on a stat key and detects edits", () => {
  let content = JSON.stringify({ plan: { max_ready_per_note: 3 } });
  let reads = 0;
  let stat = { mtimeMs: 1000, size: 10 };
  const fsModule = {
    readFileSync: () => {
      reads += 1;
      return content;
    },
    statSync: () => ({ ...stat }),
  };
  const options = {
    fsModule,
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/note-ready/config.yml",
  };
  const first = loadPlanCaps(options);
  assert.equal(first.caps.maxReadyPerNote, 3);
  assert.equal(first.defaultSource, "config");
  assert.equal(loadPlanCaps(options).caps.maxReadyPerNote, 3);
  assert.equal(reads, 1);
  stat = { mtimeMs: 2000, size: 11 };
  content = JSON.stringify({ plan: { max_ready_per_note: 7 } });
  assert.equal(loadPlanCaps(options).caps.maxReadyPerNote, 7);
  assert.equal(reads, 2);
});

test("loadPlanCaps handles deletion, invalid edits, and recovery", () => {
  let mode = "good";
  const fsModule = {
    readFileSync: () => {
      if (mode === "good") {
        return JSON.stringify({ plan: { max_ready_per_note: 4 } });
      }
      if (mode === "invalid") {
        return JSON.stringify({ plan: { max_ready_per_note: 0 } });
      }
      if (mode === "missing") {
        const error = new Error("no such file");
        error.code = "ENOENT";
        throw error;
      }
      const error = new Error("bad read");
      error.code = "EACCES";
      throw error;
    },
    statSync: () => {
      if (mode === "missing") {
        const error = new Error("no such file");
        error.code = "ENOENT";
        throw error;
      }
      return { mtimeMs: mode.length, size: mode.length };
    },
  };
  const options = {
    fsModule,
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/note-ready-cycle/config.yml",
  };
  assert.equal(loadPlanCaps(options).caps.maxReadyPerNote, 4);
  mode = "invalid";
  const bad = loadPlanCaps(options);
  assert.deepEqual(bad.caps, defaultPlanCaps());
  assert.equal(bad.invalid, true);
  assert.equal(bad.defaultSource, "config");
  mode = "missing";
  const gone = loadPlanCaps(options);
  assert.deepEqual(gone.caps, defaultPlanCaps());
  assert.equal(gone.invalid, false);
  assert.equal(gone.defaultSource, "default");
  mode = "good";
  assert.equal(loadPlanCaps(options).caps.maxReadyPerNote, 4);
});

test("loadPlanCaps without statSync reads through uncached", () => {
  let reads = 0;
  const fsModule = {
    readFileSync: () => {
      reads += 1;
      return JSON.stringify({ plan: { max_ready_per_note: 6 } });
    },
  };
  const options = {
    fsModule,
    parseYaml: (text) => JSON.parse(text),
    Platform: { isDesktopApp: true },
    configPath: "/cfg/note-ready-nostat/config.yml",
  };
  loadPlanCaps(options);
  loadPlanCaps(options);
  assert.equal(reads, 2);
});

// --- Shared frontmatter reader (bob-cli-3e) -------------------------------

test("noteFrontmatter resolves through getFileCache, not getCache", () => {
  const app = makeNoteReadyApp({
    tasks: [],
    files: { "sase.md": { task_refresh: 30, type: "[[project]]" } },
  });
  assert.deepEqual(noteFrontmatterFor(app, "sase.md"), {
    task_refresh: 30,
    type: "[[project]]",
  });
  assert.deepEqual(noteFrontmatterFor(app, { path: "sase.md" }), {
    task_refresh: 30,
    type: "[[project]]",
  });
  assert.equal(noteFrontmatterFor(app, "missing.md"), null);
  assert.equal(noteFrontmatterFor(app, null), null);
  assert.equal(noteFrontmatterFor({}, "sase.md"), null);
});

test("task_refresh applies through the shared reader", () => {
  const plugin = loadPlugin({
    tasks: [],
    files: { "sase.md": { task_refresh: 30 } },
  });
  assert.equal(plugin.noteFreshnessRawFor("sase.md"), 30);
  assert.equal(plugin.noteFrontmatter("sase.md").task_refresh, 30);
});

// --- Pure type/status/parent/cap helpers -----------------------------------

test("noteReadyKindFromType covers every R11 form", () => {
  assert.equal(noteReadyKindFromType("[[project]]"), "project");
  assert.equal(noteReadyKindFromType("[[area]]"), "area");
  assert.equal(noteReadyKindFromType("'[[area]]'"), "area");
  assert.equal(noteReadyKindFromType([["project"]]), "project");
  assert.equal(noteReadyKindFromType(["[[area]]"]), "area");
  assert.equal(noteReadyKindFromType(["[[project]]"]), "project");
  assert.equal(noteReadyKindFromType(""), null);
  assert.equal(noteReadyKindFromType("[[note]]"), null);
  assert.equal(noteReadyKindFromType(null), null);
  assert.equal(noteReadyKindFromType(42), null);
});

test("noteReadyStatusLabel mirrors ProjectStatus::parse", () => {
  assert.equal(noteReadyStatusLabel(undefined), "wip");
  assert.equal(noteReadyStatusLabel(""), "wip");
  assert.equal(noteReadyStatusLabel("wip"), "wip");
  assert.equal(noteReadyStatusLabel("waiting"), "waiting");
  assert.equal(noteReadyStatusLabel("done"), "done");
  assert.equal(noteReadyStatusLabel("canceled"), "canceled");
  assert.equal(noteReadyStatusLabel("cancelled"), "canceled");
  assert.equal(noteReadyStatusLabel("Done"), "done");
  assert.equal(noteReadyStatusLabel("custom"), "custom");
  assert.equal(noteReadyStatusIsTerminal("done"), true);
  assert.equal(noteReadyStatusIsTerminal("canceled"), true);
  assert.equal(noteReadyStatusIsTerminal("wip"), false);
  assert.equal(noteReadyStatusIsTerminal("waiting"), false);
});

test("noteReadyParentStem strips alias, heading, and path", () => {
  assert.equal(noteReadyParentStem("[[gtd]]"), "gtd");
  assert.equal(noteReadyParentStem('"[[Areas/dev]]"'), "dev");
  assert.equal(noteReadyParentStem("[[sase|Alias]]"), "sase");
  assert.equal(noteReadyParentStem("[[sase#Tasks]]"), "sase");
  assert.equal(noteReadyParentStem("[[Sase]]"), "sase");
  assert.equal(noteReadyParentStem("plain"), null);
  assert.equal(noteReadyParentStem(null), null);
});

test("parseNoteReadyCap covers every R8 form", () => {
  const fallback = (invalid) => ({
    cap: 5,
    source: "default",
    exempt: false,
    invalid,
  });
  assert.deepEqual(parseNoteReadyCap(8, 5, "default"), {
    cap: 8,
    source: "note",
    exempt: false,
    invalid: false,
  });
  assert.deepEqual(parseNoteReadyCap("8", 5, "default"), {
    cap: 8,
    source: "note",
    exempt: false,
    invalid: false,
  });
  for (const exempt of ["off", "OFF", "Off", "false", "FALSE", false]) {
    assert.deepEqual(parseNoteReadyCap(exempt, 5, "default"), {
      cap: null,
      source: "note",
      exempt: true,
      invalid: false,
    });
  }
  assert.deepEqual(parseNoteReadyCap(undefined, 5, "default"), fallback(false));
  assert.deepEqual(parseNoteReadyCap(null, 5, "default"), fallback(false));
  assert.deepEqual(parseNoteReadyCap("", 5, "default"), fallback(false));
  for (const bad of [0, "0", "lots", 1000, "1000", -3, 2.5, true]) {
    assert.deepEqual(
      parseNoteReadyCap(bad, 5, "default"),
      fallback(true),
      `invalid: ${String(bad)}`,
    );
  }
});

// --- Conformance vectors R1–R14 ---------------------------------------------

test("R1: 6 tasks at the default cap are crowded with over_by 1", () => {
  const plugin = loadPlugin({
    tasks: countedTasks("sase.md", 6),
    files: projectFiles(),
  });
  const snapshot = plugin.api.noteReady.snapshot();
  assert.equal(snapshot.available, true);
  const entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 6);
  assert.equal(entry.cap, 5);
  assert.equal(entry.cap_source, "default");
  assert.equal(entry.state, "crowded");
  assert.equal(entry.over_by, 1);
  assert.equal(snapshot.totals.excess, 1);
  assert.equal(snapshot.totals.crowded, 1);
});

test("R2: 5 tasks are full with no lint", () => {
  const plugin = loadPlugin({
    tasks: countedTasks("sase.md", 5),
    files: projectFiles(),
  });
  const entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 5);
  assert.equal(entry.state, "full");
  assert.equal(entry.over_by, 0);
  assert.deepEqual(plugin.api.noteReady.snapshot().lints, []);
});

test("R3: hidden, future, blocked, and non-TODO rows never count", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const plugin = loadPlugin({
    tasks: [
      laneTask({ description: "Hidden", originalMarkdown: "- [ ] Hidden" }),
      laneTask({ tags: ["#hide"], path: "sase.md" }),
      laneTask({ tags: ["#Hide"], path: "sase.md" }),
      laneTask({ tags: ["#hide/x"], path: "sase.md" }),
      laneTask({ scheduledDate: tomorrow, path: "sase.md" }),
      laneTask({
        status: { type: "TODO", name: "Todo", symbol: " " },
        isBlocked: () => true,
        path: "sase.md",
      }),
      laneTask({ status: { type: "ON_HOLD", name: "Next", symbol: "?" } }),
      laneTask({ status: { type: "ON_HOLD", name: "Next", symbol: "*" } }),
      laneTask({ status: { type: "IN_PROGRESS", name: "Doing", symbol: "/" } }),
      laneTask({ status: { type: "DONE", name: "Done", symbol: "x" } }),
      laneTask({ status: { type: "CANCELLED", name: "Gone", symbol: "-" } }),
    ],
    files: projectFiles(),
  });
  const entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 1);
  assert.equal(entry.state, "room");
});

test("R4: make-up splits 1 ready + 1 new + 1 rotten", () => {
  const plugin = loadPlugin({
    tasks: [
      laneTask({
        description: "Fresh",
        originalMarkdown: `- [ ] Fresh [fresh:: ${todayText()}]`,
      }),
      laneTask({ description: "New", originalMarkdown: "- [ ] New" }),
      laneTask({
        description: "Old",
        originalMarkdown: `- [ ] Old [fresh:: ${daysAgoText(8)}]`,
      }),
    ],
    files: projectFiles(),
  });
  const entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 3);
  assert.deepEqual(entry.make_up, { ready: 1, new: 1, rotten: 1 });
});

test("R5: recurring rows are excluded but tallied", () => {
  const plugin = loadPlugin({
    tasks: [
      laneTask({
        description: "Repeat",
        originalMarkdown: "- [ ] Repeat [repeat:: every day]",
      }),
      laneTask({
        description: "Cycle",
        originalMarkdown: "- [ ] Cycle",
        recurrence: {},
      }),
    ],
    files: projectFiles(),
  });
  const entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 0);
  assert.equal(entry.state, "empty");
  assert.equal(entry.recurring, 2);
  assert.equal(plugin.api.noteReady.snapshot().totals.recurring, 2);
});

test("R6: a visible ^prj task never counts", () => {
  const plugin = loadPlugin({
    tasks: [laneTask({ blockLink: " ^prj" })],
    files: projectFiles(),
  });
  const entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 0);
  assert.equal(entry.recurring, 0);
});

test("R7: daily, untyped, template, done, and dash rows are absent", () => {
  const plugin = loadPlugin({
    tasks: [
      laneTask({ path: "2026/20261001.md" }),
      laneTask({ path: "plain.md" }),
      laneTask({ path: "_templates/tpl.md" }),
      laneTask({ path: "done/old.md" }),
      laneTask({ path: "dash.md" }),
      ...countedTasks("sase.md", 1),
    ],
    files: {
      "sase.md": { type: "[[project]]" },
      "plain.md": {},
      "_templates/tpl.md": { type: "[[project]]" },
      "done/old.md": { type: "[[project]]" },
      "dash.md": { type: "[[project]]" },
      "2026/20261001.md": {},
    },
  });
  const snapshot = plugin.api.noteReady.snapshot();
  assert.deepEqual(
    snapshot.notes.map((note) => note.path),
    ["sase.md"],
  );
  assert.equal(plugin.api.noteReady.forNote("dash.md"), null);
  assert.equal(plugin.api.noteReady.forNote("plain.md"), null);
});

test("R8: ready_cap forms map to cap, exempt, or lint-then-default", () => {
  const plugin = loadPlugin({
    tasks: [
      laneTask({ path: "cap8.md", lineNumber: 0 }),
      laneTask({ path: "off.md", lineNumber: 0 }),
      laneTask({ path: "big.md", lineNumber: 0 }),
      laneTask({ path: "upper.md", lineNumber: 0 }),
      laneTask({ path: "no.md", lineNumber: 0 }),
      laneTask({ path: "zero.md", lineNumber: 0 }),
      laneTask({ path: "lots.md", lineNumber: 0 }),
      laneTask({ path: "k.md", lineNumber: 0 }),
    ],
    files: {
      "cap8.md": { type: "[[project]]", ready_cap: 8 },
      "off.md": { type: "[[project]]", ready_cap: "off" },
      "big.md": { type: "[[project]]", ready_cap: "OFF" },
      "upper.md": { type: "[[project]]" },
      "no.md": { type: "[[project]]", ready_cap: false },
      "zero.md": { type: "[[project]]", ready_cap: 0 },
      "lots.md": { type: "[[project]]", ready_cap: "lots" },
      "k.md": { type: "[[project]]", ready_cap: 1000 },
    },
  });
  const byName = (name) => plugin.api.noteReady.forNote(`${name}.md`);
  assert.deepEqual(
    [byName("cap8").cap, byName("cap8").cap_source, byName("cap8").state],
    [8, "note", "room"],
  );
  for (const name of ["off", "big", "no"]) {
    const entry = byName(name);
    assert.equal(entry.state, "exempt", name);
    assert.equal(entry.cap, null, name);
  }
  const lints = plugin.api.noteReady.snapshot().lints;
  assert.deepEqual(
    lints.map((lint) => lint.code),
    [
      "note_ready_cap_invalid",
      "note_ready_cap_invalid",
      "note_ready_cap_invalid",
    ],
  );
  for (const name of ["zero", "lots", "k"]) {
    const entry = byName(name);
    assert.equal(entry.cap, 5, name);
    assert.equal(entry.cap_source, "default", name);
  }
  assert.equal(plugin.api.noteReady.snapshot().totals.exempt, 3);
});

test("R9: a parent with two children counts 3", () => {
  const plugin = loadPlugin({
    tasks: countedTasks("sase.md", 3),
    files: projectFiles(),
  });
  assert.equal(plugin.api.noteReady.forNote("sase.md").count, 3);
});

test("R10: terminal projects are not capped and lint once", () => {
  for (const status of ["done", "cancelled"]) {
    const plugin = loadPlugin({
      tasks: countedTasks("ship.md", 2),
      files: { "ship.md": { type: "[[project]]", status } },
    });
    const snapshot = plugin.api.noteReady.snapshot();
    assert.equal(plugin.api.noteReady.forNote("ship.md"), null, status);
    assert.deepEqual(snapshot.notes, [], status);
    assert.equal(snapshot.lints.length, 1, status);
    assert.equal(
      snapshot.lints[0].code,
      "note_ready_in_terminal_project",
      status,
    );
    assert.equal(snapshot.lints[0].path, "ship.md", status);
  }
});

test("R11: every type form and nested folders are eligible", () => {
  const plugin = loadPlugin({
    tasks: [
      laneTask({ path: "quoted.md", lineNumber: 0 }),
      laneTask({ path: "single.md", lineNumber: 0 }),
      laneTask({ path: "bare.md", lineNumber: 0 }),
      laneTask({ path: "flow.md", lineNumber: 0 }),
      laneTask({ path: "block.md", lineNumber: 0 }),
      laneTask({ path: "x/y.md", lineNumber: 0 }),
    ],
    files: {
      "quoted.md": { type: "[[project]]" },
      "single.md": { type: "[[area]]" },
      "bare.md": { type: [["project"]] },
      "flow.md": { type: ["[[area]]"] },
      "block.md": { type: ["[[project]]"] },
      "x/y.md": { type: "[[project]]", parent: "[[gtd]]" },
    },
  });
  const snapshot = plugin.api.noteReady.snapshot();
  assert.equal(snapshot.notes.length, 6);
  assert.equal(plugin.api.noteReady.forNote("single.md").kind, "area");
  assert.equal(plugin.api.noteReady.forNote("x/y.md").name, "y");
  assert.equal(plugin.api.noteReady.forNote("x/y.md").parent, "gtd");
});

test("R12: stamping a NEW task keeps the count and moves the make-up", () => {
  const tasks = [
    laneTask({ description: "New", originalMarkdown: "- [ ] New" }),
    ...[1, 2, 3, 4].map((index) =>
      laneTask({
        description: `Fresh ${index}`,
        originalMarkdown: `- [ ] Fresh ${index} [fresh:: ${todayText()}]`,
        lineNumber: index,
      }),
    ),
  ];
  const plugin = loadPlugin({ tasks, files: projectFiles() });
  let entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 5);
  assert.equal(entry.state, "full");
  assert.deepEqual(entry.make_up, { ready: 4, new: 1, rotten: 0 });
  tasks[0].originalMarkdown = `- [ ] New [fresh:: ${todayText()}]`;
  plugin.freshnessTasksGen += 1;
  entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 5);
  assert.equal(entry.state, "full");
  assert.deepEqual(entry.make_up, { ready: 5, new: 0, rotten: 0 });
});

test("R13: a Today-linked task still counts", () => {
  const plugin = loadPlugin({
    tasks: [laneTask({ description: "Linked [[2026-10-01]]" })],
    files: projectFiles(),
  });
  plugin.isTodayTask = () => true;
  plugin.freshnessTasksGen += 1;
  const entry = plugin.api.noteReady.forNote("sase.md");
  assert.equal(entry.count, 1);
  assert.equal(entry.state, "room");
});

test("R14: max_ready_per_note 3 caps others while ready_cap 8 holds", () => {
  const dir = writeConfigXdg({ max_ready_per_note: 3 });
  withXdg(dir, () => {
    const plugin = loadPlugin({
      tasks: [
        ...countedTasks("sase.md", 4),
        ...countedTasks("big.md", 4, 10),
      ],
      files: {
        "sase.md": { type: "[[project]]" },
        "big.md": { type: "[[project]]", ready_cap: 8 },
      },
    });
    const snapshot = plugin.api.noteReady.snapshot();
    assert.equal(snapshot.cap.default, 3);
    assert.equal(snapshot.cap.source, "config");
    const plain = plugin.api.noteReady.forNote("sase.md");
    assert.equal(plain.cap, 3);
    assert.equal(plain.cap_source, "config");
    assert.equal(plain.state, "crowded");
    const big = plugin.api.noteReady.forNote("big.md");
    assert.equal(big.cap, 8);
    assert.equal(big.cap_source, "note");
    assert.equal(big.state, "room");
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- api.noteReady members ---------------------------------------------------

test("api.noteReady is frozen at version 1 under api v3", () => {
  const plugin = loadPlugin({ tasks: [], files: projectFiles() });
  assert.equal(plugin.api.version, 3);
  assert.equal(plugin.api.noteReady.version, 1);
  assert.ok(Object.isFrozen(plugin.api.noteReady));
  for (const key of [
    "snapshot",
    "forNote",
    "counted",
    "inCrowdedNote",
    "groupLabel",
  ]) {
    assert.equal(typeof plugin.api.noteReady[key], "function", key);
  }
});

test("counted and inCrowdedNote resolve per task", () => {
  const tasks = countedTasks("sase.md", 6);
  const room = laneTask({ path: "dev.md", lineNumber: 0 });
  const hidden = laneTask({ path: "sase.md", lineNumber: 99, tags: ["#hide"] });
  const plugin = loadPlugin({
    tasks: [...tasks, room, hidden],
    files: { "sase.md": { type: "[[project]]" }, "dev.md": { type: "[[area]]" } },
  });
  assert.equal(plugin.api.noteReady.counted(tasks[0]), true);
  assert.equal(plugin.api.noteReady.counted(room), true);
  assert.equal(plugin.api.noteReady.counted(hidden), false);
  assert.equal(plugin.api.noteReady.counted(null), false);
  assert.equal(plugin.api.noteReady.inCrowdedNote(tasks[0]), true);
  assert.equal(plugin.api.noteReady.inCrowdedNote(room), false);
  assert.equal(plugin.api.noteReady.inCrowdedNote(hidden), false);
  assert.equal(plugin.api.noteReady.forNote("nope.md"), null);
});

test("groupLabel ranks crowded notes by excess", () => {
  const plugin = loadPlugin({
    tasks: [...countedTasks("sase.md", 61), ...countedTasks("tiny.md", 7, 100)],
    files: {
      "sase.md": { type: "[[project]]" },
      "tiny.md": { type: "[[project]]" },
    },
  });
  const crowded = plugin.api.noteReady
    .snapshot()
    .notes.filter((note) => note.state === "crowded")
    .map((note) => note.path);
  assert.deepEqual(crowded, ["sase.md", "tiny.md"]);
  const label = plugin.api.noteReady.groupLabel(
    countedTasks("sase.md", 0)[0] || { path: "sase.md", lineNumber: 0 },
  );
  assert.equal(label, "%%001%%[[sase]] · 61/5 · +56");
  assert.equal(
    plugin.api.noteReady.groupLabel({ path: "tiny.md", lineNumber: 100 }),
    "%%002%%[[tiny]] · 7/5 · +2",
  );
  assert.equal(plugin.api.noteReady.groupLabel({ path: "nope.md" }), "–");
});

test("snapshot sorts crowded, full, room, empty, exempt and splits totals", () => {
  const plugin = loadPlugin({
    tasks: [
      ...countedTasks("crowded.md", 6),
      ...countedTasks("full.md", 5, 10),
      ...countedTasks("room.md", 3, 20),
      ...countedTasks("lax.md", 65, 30),
    ],
    files: {
      "crowded.md": { type: "[[project]]" },
      "full.md": { type: "[[project]]" },
      "room.md": { type: "[[area]]" },
      "empty.md": { type: "[[project]]" },
      "lax.md": { type: "[[area]]", ready_cap: "off" },
    },
  });
  const snapshot = plugin.api.noteReady.snapshot();
  assert.deepEqual(
    snapshot.notes.map((note) => note.path),
    ["crowded.md", "full.md", "room.md", "empty.md", "lax.md"],
  );
  assert.deepEqual(snapshot.totals, {
    notes: 4,
    areas: 1,
    projects: 3,
    crowded: 1,
    full: 1,
    room: 1,
    empty: 1,
    exempt: 1,
    counted: 14,
    excess: 1,
    recurring: 0,
  });
});

// --- Availability --------------------------------------------------------------

test("missing Tasks data and a cold cache are unavailable, never zero", () => {
  const empty = loadPlugin({ tasks: null, files: projectFiles() });
  assert.equal(empty.api.noteReady.snapshot().available, false);
  const cold = loadPlugin({
    tasks: countedTasks("sase.md", 2),
    tasksState: "Cold",
    files: projectFiles(),
  });
  const snapshot = cold.api.noteReady.snapshot();
  assert.equal(snapshot.available, false);
  assert.equal(cold.api.noteReady.forNote("sase.md"), null);
  assert.equal(cold.api.noteReady.counted(countedTasks("sase.md", 1)[0]), null);
  assert.equal(
    cold.api.noteReady.inCrowdedNote({ path: "sase.md", lineNumber: 0 }),
    false,
  );
  assert.equal(
    cold.api.noteReady.groupLabel({ path: "sase.md", lineNumber: 0 }),
    "–",
  );
});

test("throwing Tasks guards never throw", () => {
  const plugin = loadPlugin({ tasks: "throw", files: projectFiles() });
  const snapshot = plugin.api.noteReady.snapshot();
  assert.equal(snapshot.available, false);
  assert.equal(plugin.api.noteReady.forNote("sase.md"), null);
  assert.equal(plugin.api.noteReady.counted({ path: "x.md" }), null);
  assert.equal(plugin.api.noteReady.inCrowdedNote({ path: "x.md" }), false);
  assert.equal(plugin.api.noteReady.groupLabel({ path: "x.md" }), "–");
  assert.equal(plugin.api.noteReady.snapshot("garbage").available, false);
});

// --- Memoization and invalidation -------------------------------------------------

test("snapshot reuses the memo without reparsing or re-walking", () => {
  const plugin = loadPlugin({
    tasks: countedTasks("sase.md", 6),
    files: projectFiles(),
  });
  const first = plugin.api.noteReady.snapshot();
  const gen = plugin.noteReadyFrontGen;
  assert.equal(plugin.api.noteReady.snapshot(), first);
  assert.equal(plugin.noteReadyFrontGen, gen);
  assert.deepEqual(
    plugin.api.noteReady.snapshot().notes,
    first.notes,
  );
});

test("a task edit rebuilds through the cache-update handler", () => {
  const triggers = [];
  const handlers = {};
  const tasks = countedTasks("sase.md", 2);
  const app = makeNoteReadyApp({
    tasks,
    files: projectFiles(),
    triggers,
    handlers,
  });
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  assert.equal(plugin.api.noteReady.forNote("sase.md").count, 2);
  tasks.push(
    laneTask({ path: "sase.md", lineNumber: 2, description: "Third" }),
  );
  assert.equal(typeof handlers["obsidian-tasks-plugin:cache-update"], "function");
  handlers["obsidian-tasks-plugin:cache-update"]();
  assert.equal(plugin.api.noteReady.forNote("sase.md").count, 3);
});

test("a ready_cap edit rebuilds and fires the query-refresh trigger", () => {
  const triggers = [];
  const files = {
    "sase.md": { type: "[[project]]", ready_cap: 8 },
  };
  const app = makeNoteReadyApp({
    tasks: countedTasks("sase.md", 3),
    files,
    triggers,
  });
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  assert.equal(plugin.api.noteReady.forNote("sase.md").state, "room");
  const before = triggers.length;
  files["sase.md"] = { type: "[[project]]", ready_cap: 2 };
  assert.equal(plugin.refreshNoteReadyForChangedFile({ path: "sase.md" }), true);
  assert.equal(plugin.api.noteReady.forNote("sase.md").state, "crowded");
  assert.ok(
    triggers.slice(before).includes(TODAY_RELOAD_EVENT),
    "crowded-set change re-reads Tasks queries",
  );
  assert.equal(
    plugin.refreshNoteReadyForChangedFile({ path: "sase.md" }),
    false,
    "an unchanged fingerprint does not bump the generation",
  );
});

test("rename and delete move the eligibility entry", () => {
  const files = projectFiles();
  const app = makeNoteReadyApp({
    tasks: countedTasks("sase.md", 2),
    files,
  });
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.onload();
  assert.equal(plugin.api.noteReady.forNote("sase.md").count, 2);
  delete files["sase.md"];
  files["renamed.md"] = { type: "[[project]]" };
  assert.equal(
    plugin.refreshNoteReadyForRename({ path: "renamed.md" }, "sase.md"),
    true,
  );
  assert.equal(plugin.api.noteReady.forNote("sase.md"), null);
  assert.equal(plugin.api.noteReady.forNote("renamed.md").count, 0);
  delete files["renamed.md"];
  assert.equal(plugin.refreshNoteReadyForDeletedPath("renamed.md"), true);
  assert.equal(plugin.api.noteReady.forNote("renamed.md"), null);
  assert.equal(plugin.refreshNoteReadyForDeletedPath("renamed.md"), false);
});

test("day rollover rebuilds the snapshot date", () => {
  const plugin = loadPlugin({
    tasks: countedTasks("sase.md", 1),
    files: projectFiles(),
  });
  const first = plugin.api.noteReady.snapshot(new Date(2026, 9, 1, 12));
  const second = plugin.api.noteReady.snapshot(new Date(2026, 9, 2, 12));
  assert.notEqual(first.date, second.date);
  assert.equal(plugin.api.noteReady.snapshot(new Date(2026, 9, 2, 12)), second);
});

test("a config edit flows through the stat cache", () => {
  const dir = writeConfigXdg({ max_ready_per_note: 3 });
  withXdg(dir, () => {
    const plugin = loadPlugin({
      tasks: countedTasks("sase.md", 4),
      files: projectFiles(),
    });
    assert.equal(plugin.api.noteReady.snapshot().cap.default, 3);
    assert.equal(plugin.api.noteReady.forNote("sase.md").state, "crowded");
    fs.writeFileSync(
      path.join(dir, "bob", "config.yml"),
      JSON.stringify({ plan: { max_ready_per_note: 9, _pad: "changed" } }),
    );
    assert.equal(plugin.api.noteReady.snapshot().cap.default, 9);
    assert.equal(plugin.api.noteReady.forNote("sase.md").state, "room");
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("noteReadyEvaluate is pure and mirrors the Rust totals", () => {
  const report = noteReadyEvaluate({
    notes: [
      {
        path: "a.md",
        name: "a",
        kind: "area",
        status: "wip",
        isArea: true,
        isTerminal: false,
        parent: null,
        ready_cap_raw: undefined,
      },
    ],
    rows: [
      { path: "a.md", recurring: false, blockId: null, bucket: "new" },
      { path: "a.md", recurring: false, blockId: null, bucket: null },
      { path: "a.md", recurring: true, blockId: null, bucket: null },
      { path: "ghost.md", recurring: false, blockId: null, bucket: null },
    ],
    defaultCap: 5,
    defaultSource: "default",
    freshnessAvailable: true,
  });
  assert.equal(report.notes.length, 1);
  assert.deepEqual(report.notes[0].make_up, { ready: 1, new: 1, rotten: 0 });
  assert.equal(report.notes[0].recurring, 1);
  assert.deepEqual(report.totals, {
    ...noteReadyEmptyTotals(),
    notes: 1,
    areas: 1,
    room: 1,
    counted: 2,
    recurring: 1,
  });
  const unavailable = noteReadyEvaluate({
    notes: [],
    rows: [],
    defaultCap: 5,
    defaultSource: "default",
    freshnessAvailable: false,
  });
  assert.deepEqual(unavailable.totals, noteReadyEmptyTotals());
  assert.ok(noteReadyCrowdedKey([], null));
});


