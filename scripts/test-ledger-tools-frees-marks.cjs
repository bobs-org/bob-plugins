// Frees-mark vectors for bob-cli-g1.2. Every FL (link gate), FC (count
// and BLOCKS parity), FT (tooltip), and FP (placement) contract row is
// cited below so the pure core and both rendered surfaces stay aligned.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const RealDate = Date;
const FROZEN_NOW = new RealDate(2026, 10, 2, 12, 0, 0);
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(FROZEN_NOW.getTime());
    } else {
      super(...args);
    }
  }

  static now() {
    return FROZEN_NOW.getTime();
  }
}
global.Date = FrozenDate;

const TODAY = new Date(2026, 10, 2, 12, 0, 0);
const TODAY_PATH = "Daily/2026-11-02.md";
const INFO_FIELD = { freesField: "info" };
const LIVE_FIELD = { freesField: "live" };
let capturedFreesClass = null;
let capturedUnblockedClass = null;

class StubWidgetType {}

class StubRangeSetBuilder {
  constructor() {
    this.adds = [];
  }

  add(from, to, value) {
    this.adds.push({ from, to, value });
  }

  finish() {
    return { adds: this.adds.slice() };
  }
}

const StubDecoration = {
  none: { none: true },
  widget: (spec) => ({ ...spec, widgetDecoration: true }),
};

const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};

const StubViewPlugin = {
  fromClass(cls, options) {
    capturedFreesClass = cls;
    capturedUnblockedClass = cls;
    return { cls, options };
  },
};

class TestMarkdownView {}
class TestRenderChild {
  constructor(container) {
    this.container = container;
  }
}

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerMarkdownPostProcessor(handler, sortOrder) {
    this.postProcessors = this.postProcessors || [];
    this.postProcessors.push({ handler, sortOrder });
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }

  registerInterval(ref) {
    this.intervals = this.intervals || [];
    this.intervals.push(ref);
    return ref;
  }

  register(callback) {
    this.cleanups = this.cleanups || [];
    this.cleanups.push(callback);
  }
}

class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadWithFreesMarkStubs(request) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: TestRenderChild,
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (value) => JSON.parse(value),
      editorInfoField: INFO_FIELD,
      editorLivePreviewField: LIVE_FIELD,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      RangeSetBuilder: StubRangeSetBuilder,
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
      ViewPlugin: StubViewPlugin,
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, ...Array.prototype.slice.call(arguments, 1));
};

const MAIN_PATH = require.resolve("../plugins/bob-ledger-tools/main.js");
delete require.cache[MAIN_PATH];
const LedgerToolsPlugin = require(MAIN_PATH);
Module._load = originalLoad;
const {
  FREES_MARK_KEY,
  freesMarkCount,
  freesMarkCandidateLinks,
  freesMarkLinks,
  freesMarkTooltip,
  buildFreesMarkElement,
  FreesMarkWidget,
  ensureFreesMarksRefresh,
  blocksDependentsIndex,
  blocksSortLinks,
  blocksCanonicalLinktext,
  blocksChipModel,
  todayDailyPath,
} = LedgerToolsPlugin.helpers;

function makeTask({
  id = "x",
  blockId = "a",
  path = "sase.md",
  status = "TODO",
  dependsOn = [],
  description = "Read it",
  scheduled = null,
  tags = [],
  doneDate = null,
} = {}) {
  const task = {
    id,
    blockLink: " ^" + blockId,
    path,
    status: { type: status, name: status.toLowerCase() },
    dependsOn: dependsOn.slice(),
    description,
    tags: tags.slice(),
  };
  if (scheduled) task.scheduled = scheduled;
  if (doneDate) task.doneDate = doneDate;
  return task;
}

function ownerTask(overrides = {}) {
  return makeTask({ id: "x", blockId: "a", ...overrides });
}

function dependent(overrides = {}) {
  return makeTask({ id: "d1", blockId: "d1", dependsOn: ["x"], ...overrides });
}

function memoOf(tasks) {
  return { tasks, dateText: "2026-11-02" };
}

function daily(...rows) {
  return ["## Pomodoros", "- [ ] () — READ", ...rows].join("\n");
}

function linkRow(target = "sase#^a") {
  return "\t- [[" + target + "]]";
}

function fakeElementDoc() {
  function element(tag) {
    return {
      tagName: tag,
      attrs: {},
      children: [],
      handlers: {},
      textContent: "",
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      removeAttribute(name) {
        delete this.attrs[name];
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(name, handler) {
        this.handlers[name] = handler;
      },
    };
  }
  return {
    createElement: (tag) => element(tag),
    createTextNode: (value) => ({ text: String(value) }),
  };
}

function makeDoc(content) {
  const lines = String(content).split("\n");
  let offset = 0;
  const lineRows = lines.map((text, index) => {
    const row = { from: offset, to: offset + text.length, number: index + 1, text };
    offset += text.length + 1;
    return row;
  });
  return {
    length: Math.max(0, offset - 1),
    toString: () => String(content),
    line: (number) => lineRows[number - 1],
  };
}

function makeApp(tasks = []) {
  const handlers = {};
  const openedLinks = [];
  return {
    handlers,
    vault: { getAbstractFileByPath: () => null },
    workspace: {
      getLeavesOfType: () => [],
      openLinkText: (...args) => {
        openedLinks.push(args);
      },
      on: () => ({}),
    },
    openedLinks,
    metadataCache: {
      on: (name, callback) => {
        handlers[name] = callback;
        return { name };
      },
      getCache: () => null,
      getFirstLinkpathDest: () => null,
    },
    plugins: {
      plugins: {
        "obsidian-tasks-plugin": { getTasks: () => tasks },
      },
    },
  };
}

function makePlugin(tasks = []) {
  const app = makeApp(tasks);
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.freesMarksEnabled = true;
  plugin.currentTodayDailyPath = () => TODAY_PATH;
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  return { app, plugin };
}

function makeView(content, path = TODAY_PATH) {
  const doc = makeDoc(content);
  return {
    state: {
      doc,
      field(field) {
        if (field === INFO_FIELD) return { file: { path } };
        if (field === LIVE_FIELD) return true;
        return null;
      },
    },
    visibleRanges: [{ from: 0, to: doc.length }],
    dispatches: [],
    dispatch(value) {
      this.dispatches.push(value);
    },
    posAtDOM: () => 42,
    focus() {
      this.focused = true;
    },
  };
}

function decorationRows(result) {
  return result && Array.isArray(result.adds) ? result.adds : [];
}

function marksFor(content, tasks, options = {}) {
  return freesMarkLinks(content, memoOf(tasks), TODAY, {
    dailyPath: options.dailyPath || TODAY_PATH,
  });
}

function flTasks({ ownerPath = "sase.md", ownerId = "x", ownerBlock = "a" } = {}) {
  const owner = ownerTask({ id: ownerId, blockId: ownerBlock, path: ownerPath });
  return [owner, dependent()];
}

test("FL1-FL16: the ledger link gates match the display contract", () => {
  const tasks = flTasks();
  const cases = [
    // FL1: planned open placeholder.
    ["FL1", daily(linkRow()), true],
    // FL2: running timed Pomodoro.
    ["FL2", ["## Pomodoros", "- [ ] (**1210-1235** [t:: 25m]) — BUILD", linkRow()].join("\n"), true],
    // FL3: closed entry.
    ["FL3", ["## Pomodoros", "- [x] (**0800-0815** [t:: 15m])", linkRow()].join("\n"), false],
    // FL4: leading 🍅 marker.
    ["FL4", daily("\t- 🍅 [[sase#^a]]"), true],
    // FL5: trailing move-only marker; ch ends before ` #`.
    ["FL5", daily("\t- [[sase#^a]] #"), true],
    // FL6: struck link.
    ["FL6", daily("\t- ~~[[sase#^a]]~~"), false],
    // FL7: embedded link.
    ["FL7", daily("\t- ![[sase#^a]]"), false],
    // FL8: prose around the link.
    ["FL8", daily("\t- read [[sase#^a]] first"), false],
    // FL9: a deeper child row.
    ["FL9", daily("\t- another child", "\t\t- [[sase#^a]]"), false],
    // FL10: another daily note is gated in the mixin, not the pure line parser.
    ["FL10", daily(linkRow()), true],
    // FL11: the Events section is outside the Pomodoros range.
    ["FL11", ["## Events", "- [ ] Event", linkRow()].join("\n"), false],
    // FL12: a wiki-link alias is allowed.
    ["FL12", daily("\t- [[sase#^a|Read it]]"), true],
    // FL13: a same-note task target resolves against dailyPath.
    ["FL13", daily("\t- [[#^a]]"), true, flTasks({ ownerPath: TODAY_PATH })],
    // FL14: fenced rows are excluded.
    ["FL14", ["## Pomodoros", "```text", "- [ ] () — READ", linkRow(), "```"].join("\n"), false],
    // FL15: the Tasks memo is cold.
    ["FL15", daily(linkRow()), false, []],
  ];

  for (const [id, content, expected, suppliedTasks] of cases) {
    const found = marksFor(content, suppliedTasks || tasks);
    assert.equal(found.length > 0, expected, id);
    if (id === "FL5") {
      const row = content.split("\n")[2];
      assert.equal(found[0].ch, row.indexOf("]]" ) + 2, "FL5 link end precedes #");
    }
  }

  // FL10: the editor path gate rejects an older daily note.
  const { plugin } = makePlugin(tasks);
  const otherDay = makeView(daily(linkRow()), "Daily/2026-11-01.md");
  assert.equal(decorationRows(plugin.buildFreesMarkDecorations(otherDay)).length, 0);

  // FL13: the owner task resolves in today's note itself.
  const sameNote = flTasks({ ownerPath: TODAY_PATH });
  assert.equal(marksFor(daily("\t- [[#^a]]"), sameNote).length, 1);

  // FL16: toggle-off suppresses the JavaScript decorations as well as CSS.
  plugin.freesMarksEnabled = false;
  assert.equal(decorationRows(plugin.buildFreesMarkDecorations(makeView(daily(linkRow())))).length, 0);
});

test("motion identity is the resolved owner path and block ID", () => {
  const one = ownerTask({ id: "one", blockId: "prj", path: "one.md" });
  const two = ownerTask({ id: "two", blockId: "prj", path: "two.md" });
  const tasks = [
    one,
    two,
    dependent({ id: "one-d", blockId: "one-d", dependsOn: ["one"] }),
    dependent({ id: "two-d1", blockId: "two-d1", dependsOn: ["two"] }),
    dependent({ id: "two-d2", blockId: "two-d2", dependsOn: ["two"] }),
  ];
  const { plugin } = makePlugin(tasks);
  const view = makeView(daily(linkRow("one#^prj"), linkRow("two#^prj")));

  // Distinct notes with the same ^prj block have separate first-paint state.
  let rows = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.deepEqual(rows.map((row) => row.value.widget.model.count), [1, 2]);
  assert.deepEqual(rows.map((row) => row.value.widget.model.tick), [false, false]);
  assert.deepEqual(rows.map((row) => row.value.widget.model.ownerPath), ["one.md", "two.md"]);

  // A warm rebuild does not reuse one owner's transition for the other.
  rows = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.deepEqual(rows.map((row) => row.value.widget.model.tick), [false, false]);
  const counts = plugin.freesMarkEditorCounts(view);
  assert.equal(counts.get("one.md\u0000prj"), 1);
  assert.equal(counts.get("two.md\u0000prj"), 2);
});

test("duplicate and aliased links resolve and count once per owner per build", () => {
  const owner = ownerTask({ path: "sase.md" });
  const tasks = [owner, dependent()];
  const memo = memoOf(tasks);
  const content = daily(
    linkRow("sase#^a"),
    linkRow("sase#^a"),
    linkRow("sase#^a|Read it"),
  );
  const resolved = [];
  const counted = [];
  const rows = freesMarkCandidateLinks(content, memo, TODAY, {
    dailyPath: TODAY_PATH,
    onResolve: (target) => resolved.push(target),
    onCount: (key) => counted.push(key),
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(resolved.sort(), ["sase\u0000a"]);
  assert.deepEqual(counted, ["sase.md\u0000a"]);
  assert.ok(rows.every((row) => row.ownerKey === "sase.md\u0000a"));

  const { plugin } = makePlugin(tasks);
  const view = makeView(content);
  let decorations = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.equal(decorations.length, 3);
  assert.deepEqual(decorations.map((row) => row.value.widget.model.tick), [false, false, false]);
  tasks.push(dependent({ id: "d2", blockId: "d2" }));
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  decorations = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.deepEqual(decorations.map((row) => row.value.widget.model.tick), [true, true, true]);
  // Duplicate widgets share the one owner transition from this build.
  decorations = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.deepEqual(decorations.map((row) => row.value.widget.model.tick), [false, false, false]);
});

test("offscreen ledger targets do no resolution or count work until visible", () => {
  const tasks = [ownerTask(), dependent()];
  const content = daily(linkRow());
  const view = makeView(content);
  view.visibleRanges = [{ from: 0, to: 1 }];
  const { plugin } = makePlugin(tasks);
  assert.equal(decorationRows(plugin.buildFreesMarkDecorations(view)).length, 0);
  assert.equal(plugin.freesMarkEditorCounts(view).size, 0);

  const row = makeDoc(content).line(3);
  view.visibleRanges = [{ from: row.from, to: row.to }];
  const visible = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.equal(visible.length, 1);
  assert.equal(visible[0].value.widget.model.tick, false, "scroll-in is silent");
  assert.equal(plugin.freesMarkEditorCounts(view).get("sase.md\u0000a"), 1);
});

test("200-link / 2000-task build stays within the 25 ms budget", () => {
  const owner = ownerTask();
  const tasks = [owner, dependent()];
  for (let index = 0; index < 1998; index += 1) {
    tasks.push(ownerTask({
      id: "unrelated-" + index,
      blockId: "unrelated-" + index,
      path: "unrelated/" + index + ".md",
    }));
  }
  const memo = memoOf(tasks);
  blocksDependentsIndex(memo); // model a warm freshness memo generation
  const content = daily(...Array.from({ length: 200 }, () => linkRow()));
  const warm = freesMarkCandidateLinks(content, memo, TODAY, { dailyPath: TODAY_PATH });
  assert.equal(warm.length, 200);

  let resolutions = 0;
  let counts = 0;
  const start = RealDate.now();
  const rows = freesMarkCandidateLinks(content, memo, TODAY, {
    dailyPath: TODAY_PATH,
    onResolve: () => { resolutions += 1; },
    onCount: () => { counts += 1; },
  });
  const elapsedMs = RealDate.now() - start;
  assert.equal(rows.length, 200);
  assert.equal(resolutions, 1, "the repeated target resolves once in this build");
  assert.equal(counts, 1, "the resolved owner count runs once in this build");
  assert.ok(elapsedMs < 25, `synthetic build took ${elapsedMs} ms (budget 25 ms)`);

  // A new freshness memo generation gets new count data instead of stale cache.
  const replacementMemo = memoOf([...tasks, dependent({ id: "d2", blockId: "d2" })]);
  const replaced = freesMarkCandidateLinks(content, replacementMemo, TODAY, {
    dailyPath: TODAY_PATH,
  });
  assert.ok(replaced.every((row) => row.count === 2));
});

function countFixture(id) {
  const owner = ownerTask();
  let tasks = [owner];
  let expected = 0;
  let waiting = 0;
  switch (id) {
    // FC1: sole prerequisite.
    case "FC1": tasks.push(dependent()); expected = 1; break;
    // FC2: another open task remains.
    case "FC2": tasks.push(makeTask({ id: "y", blockId: "y" }), dependent({ dependsOn: ["x", "y"] })); waiting = 1; break;
    // FC3: a completed second prerequisite does not hold the row.
    case "FC3": tasks.push(makeTask({ id: "y", blockId: "y", status: "DONE" }), dependent({ dependsOn: ["x", "y"] })); expected = 1; break;
    // FC4: future schedule remains waiting.
    case "FC4": tasks.push(dependent({ scheduled: "2026-11-03" })); waiting = 1; break;
    // FC5: today's schedule is due now.
    case "FC5": tasks.push(dependent({ scheduled: "2026-11-02" })); expected = 1; break;
    // FC6: project-blocked tag prevents the last-blocker claim.
    case "FC6": tasks.push(dependent({ tags: ["prj_is_blocked"] })); waiting = 1; break;
    // FC7: a project task counts as one last blocker.
    case "FC7": tasks.push(dependent({ blockId: "prj", path: "sase_blog.md", description: "Sase blog" })); expected = 1; break;
    // FC8: hidden dependents are freed, though successor copy hides them.
    case "FC8": tasks.push(dependent({ tags: ["hide"] })); expected = 1; break;
    // FC9: no owner [id::] means no mark.
    case "FC9": tasks[0] = ownerTask({ id: null }); tasks.push(dependent()); break;
    // FC10: a closed owner is not a live Task Link target.
    case "FC10": tasks[0] = ownerTask({ status: "DONE" }); tasks.push(dependent()); break;
    // FC11: completed and cancelled dependents are outside LIVE.
    case "FC11": tasks.push(dependent({ status: "DONE" }), dependent({ id: "d2", blockId: "d2", status: "CANCELLED" })); break;
    // FC12: unresolved secondary ids do not block.
    case "FC12": tasks.push(dependent({ dependsOn: ["x", "zzz"] })); expected = 1; break;
    // FC13: three freed rows and two waiting rows.
    case "FC13":
      tasks.push(dependent({ id: "d1", blockId: "d1" }), dependent({ id: "d2", blockId: "d2" }), dependent({ id: "d3", blockId: "d3" }));
      tasks.push(dependent({ id: "d4", blockId: "d4", dependsOn: ["x", "y"] }), makeTask({ id: "y", blockId: "y" }));
      tasks.push(dependent({ id: "d5", blockId: "d5", scheduled: "2026-11-04" }));
      expected = 3; waiting = 2; break;
    // FC14: five freed rows.
    case "FC14":
      for (let i = 1; i <= 5; i += 1) tasks.push(dependent({ id: "d" + i, blockId: "d" + i }));
      expected = 5; break;
    // FC15: stale TODO rows still appear in the live Tasks memo.
    case "FC15": tasks.push(dependent({ status: "TODO" })); expected = 1; break;
    // FC16: the owner naming itself is excluded from its own dependent set.
    case "FC16": tasks[0] = ownerTask({ dependsOn: ["x"] }); break;
    default: throw new Error("unknown fixture " + id);
  }
  return { owner: tasks[0], tasks, expected, waiting };
}

test("FC1-FC17: counts follow the BLOCKS last-blocker set", () => {
  const ids = ["FC1", "FC2", "FC3", "FC4", "FC5", "FC6", "FC7", "FC8", "FC9", "FC10", "FC11", "FC12", "FC13", "FC14", "FC15", "FC16"];
  for (const id of ids) {
    const fixture = countFixture(id);
    const memo = memoOf(fixture.tasks);
    const model = freesMarkCount(fixture.owner, memo, TODAY);
    assert.equal(model ? model.count : 0, fixture.expected, id + " count");
    assert.equal(model ? model.waiting : 0, fixture.waiting, id + " waiting");

    const live = blocksDependentsIndex(memo).get(String(fixture.owner.id || "")) || [];
    const sourcePath = fixture.owner.path;
    const sorted = blocksSortLinks(live.map((task) => ({ task, linktext: blocksCanonicalLinktext(task, sourcePath) })));
    const line = sorted.length
      ? "- 🧱 **BLOCKS:** " + sorted.map((row) => "[[" + row.linktext + "]]").join(" • ")
      : "- 🧱 **BLOCKS:**";
    const byId = new Map(fixture.tasks.map((task) => [task.blockLink.trim().replace(/^\^/, ""), task]));
    const chip = blocksChipModel(line, sourcePath, fixture.owner, memo, (_path, blockId) => byId.get(blockId) || null, TODAY);
    const lastCount = chip ? chip.chips.filter((row) => row.live && row.lastBlocker).length : 0;
    // FC17: every fixture, including waiting and closed rows, has count parity.
    assert.equal(model ? model.count : 0, lastCount, id + " FC17 parity");
  }
});

function tooltipModel(tasks, owner = ownerTask(), dailyPath = TODAY_PATH) {
  const result = freesMarkCount(owner, memoOf([owner, ...tasks]), TODAY);
  return { ...result, blockId: owner.blockLink.trim().slice(1), dailyPath };
}

test("FT1-FT6: tooltips use BLOCKS order, clean titles, and waiting count", () => {
  // FT1: canonical single dependent copy.
  const ft1 = tooltipModel([
    dependent({ description: "Launch another epic chain for sase task beads!" }),
  ]);
  assert.equal(
    freesMarkTooltip(ft1),
    "Closing this frees 1 task\n• Launch another epic chain for sase task beads! · sase",
  );

  // FT2: a dependent in today's note is labeled `this note`.
  const ft2 = tooltipModel([
    dependent({ id: "d1", blockId: "d1", path: "Daily/2026-11-02.md", description: "First" }),
    dependent({ id: "d2", blockId: "d2", path: "sase.md", description: "Second" }),
  ]);
  assert.match(freesMarkTooltip(ft2), /^Closing this frees 2 tasks/);
  assert.match(freesMarkTooltip(ft2), /First · this note/);

  // FT3: a 60-character title is clipped to 47 plus ellipsis.
  const longTitle = "L".repeat(60);
  const ft3 = freesMarkTooltip(tooltipModel([dependent({ description: longTitle })]));
  assert.ok(ft3.includes("L".repeat(47) + "… · sase"));
  assert.ok(!ft3.includes("L".repeat(48)));

  // FT4: wiki links, tags, inline fields, and block IDs are cleaned.
  const ft4 = freesMarkTooltip(tooltipModel([
    dependent({ description: "Read [[guide|this guide]] #task [priority:: 2] ^task-a" }),
  ]));
  assert.match(ft4, /Read this guide · sase/);

  // FT5: `::` never escapes into an aria-label.
  const ft5 = freesMarkTooltip(tooltipModel([dependent({ description: "Read :: now" })]));
  assert.ok(!ft5.includes("::"));
  assert.ok(ft5.includes("Read : now"));

  // FT6: waiting dependents appear after freed rows.
  const owner = ownerTask();
  const waitingTask = dependent({ id: "d2", blockId: "d2", dependsOn: ["x", "y"] });
  const ft6 = freesMarkTooltip({
    ...tooltipModel([dependent(), waitingTask, makeTask({ id: "y", blockId: "y" })]),
  });
  assert.ok(ft6.endsWith("Also blocks 1 waiting on other work"));
  assert.equal(freesMarkTooltip({ count: 0, waiting: 0, freed: [] }), "Closing this frees 0 tasks");
  assert.equal(FREES_MARK_KEY, "🔑");
  assert.ok(owner);
});

test("FC7-FC8: project and hidden labels follow the contract", () => {
  // FC7: project dependent uses the project-note label.
  const project = dependent({ blockId: "prj", path: "projects/sase_blog.md" });
  assert.match(freesMarkTooltip(tooltipModel([project])), /• 🧩 sase_blog project/);
  // FC8: a hidden dependent is counted and called out.
  const hidden = dependent({ tags: ["hide"] });
  assert.match(freesMarkTooltip(tooltipModel([hidden])), /· hidden/);
});

test("FP1-FP2: Live Preview places the widget after the link with side 2", () => {
  const owner = ownerTask({ dependsOn: ["done"] });
  const done = makeTask({ id: "done", blockId: "done", status: "DONE", doneDate: TODAY });
  const dep = dependent();
  const tasks = [owner, done, dep];
  const { plugin } = makePlugin(tasks);
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  plugin.unblockedGlyphEnabled = true;
  const content = daily(linkRow());
  const view = makeView(content);
  const frees = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.equal(frees.length, 1);
  assert.equal(frees[0].from, frees[0].to);
  assert.equal(frees[0].value.side, 2);
  assert.equal(frees[0].value.widget.model.tick, false);
  const linkLine = content.split("\n")[2];
  assert.equal(
    frees[0].from,
    makeDoc(content).line(3).from + linkLine.indexOf("]]" ) + 2,
  );

  const unblocked = decorationRows(plugin.buildUnblockedGlyphDecorations(view));
  assert.equal(unblocked.length, 1);
  assert.equal(unblocked[0].from, frees[0].from);
  assert.equal(unblocked[0].value.side, 1);
  // FP5: selection alone does not rebuild or move the zero-width widget.
  assert.equal(plugin.freesMarkShouldRebuild({ selectionSet: true }), false);
  assert.equal(plugin.freesMarkShouldRebuild({ docChanged: true }), true);
  assert.equal(plugin.freesMarkShouldRebuild({ viewportChanged: true }), true);
});

class DomNode {
  constructor(tagName, className = "", ownerDocument = null, nodeType = 1) {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = nodeType;
    this.className = className;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this._text = "";
    this.isConnected = true;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] || null;
  }

  get previousSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i - 1] || null;
  }

  get textContent() {
    return this._text + this.childNodes.map((node) => node.textContent || node.nodeValue || "").join("");
  }

  set textContent(value) {
    this.childNodes = [];
    this._text = String(value || "");
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === "class") this.className = String(value);
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  querySelectorAll(selector) {
    const found = [];
    const matches = (node) => {
      if (selector === "li") return node.tagName === "LI";
      if (selector === "a.internal-link") return node.tagName === "A" && node.className.split(/\s+/).includes("internal-link");
      if (selector === ".bob-frees-mark") return node.className.split(/\s+/).includes("bob-frees-mark");
      return false;
    };
    const walk = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 1 && matches(child)) found.push(child);
        if (child.childNodes) walk(child);
      }
    };
    walk(this);
    return found;
  }
}

function readingRoot(withUnblocked) {
  const doc = {
    createElement: (tag) => new DomNode(tag, "", doc),
    createTextNode: (value) => {
      const node = new DomNode("#text", "", doc, 3);
      node.nodeValue = String(value);
      node.textContent = String(value);
      return node;
    },
  };
  const root = new DomNode("DIV", "", doc);
  const li = new DomNode("LI", "", doc);
  const anchor = new DomNode("A", "internal-link", doc);
  anchor.setAttribute("data-href", "sase#^a");
  li.appendChild(anchor);
  let glyph = null;
  if (withUnblocked) {
    glyph = new DomNode("SPAN", "bob-unblocked-glyph", doc);
    li.appendChild(glyph);
  }
  root.appendChild(li);
  root.li = li;
  root.anchor = anchor;
  root.glyph = glyph;
  return root;
}

function readingLedgerRoot({ withUnblocked = false, withTaskLinkMark = false, wrapP = false } = {}) {
  const doc = {
    createElement: (tag) => new DomNode(tag, "", doc),
    createTextNode: (value) => {
      const node = new DomNode("#text", "", doc, 3);
      node.nodeValue = String(value);
      node.textContent = String(value);
      return node;
    },
  };
  const root = new DomNode("DIV", "", doc);
  root.ownerDocument = doc;
  const head = new DomNode("H2", "", doc);
  head.appendChild(doc.createTextNode("Pomodoros"));
  root.appendChild(head);
  const top = new DomNode("UL", "", doc);
  root.appendChild(top);
  const entry = new DomNode("LI", "", doc);
  entry.setAttribute("data-task", " ");
  top.appendChild(entry);
  const inner = new DomNode("UL", "", doc);
  entry.appendChild(inner);
  const li = new DomNode("LI", "", doc);
  inner.appendChild(li);
  const content = wrapP ? new DomNode("P", "", doc) : li;
  if (wrapP) li.appendChild(content);
  if (withTaskLinkMark) {
    const ring = new DomNode("SPAN", "bob-task-link-mark", doc);
    ring.setAttribute("class", "bob-task-link-mark");
    content.appendChild(ring);
  }
  const anchor = new DomNode("A", "internal-link", doc);
  anchor.setAttribute("class", "internal-link");
  anchor.setAttribute("data-href", "sase#^a");
  content.appendChild(anchor);
  let glyph = null;
  if (withUnblocked) {
    glyph = new DomNode("SPAN", "bob-unblocked-glyph", doc);
    glyph.setAttribute("class", "bob-unblocked-glyph");
    content.appendChild(glyph);
  }
  root.li = li;
  root.anchor = anchor;
  root.glyph = glyph;
  root.content = content;
  return root;
}

test("FP3-FP4: Reading view inserts after the link or after 🔓", () => {
  for (const hasGlyph of [false, true]) {
    const tasks = [ownerTask(), dependent()];
    const { plugin } = makePlugin(tasks);
    const root = readingRoot(hasGlyph);
    plugin.progressMarkReadingContext = (li) => ({ anchor: root.anchor, target: "sase", blockId: "a" });
    plugin.sweepFreesMarksReadingView({ el: root, sourcePath: TODAY_PATH });
    const mark = root.querySelectorAll(".bob-frees-mark")[0];
    assert.ok(mark);
    assert.equal(mark.getAttribute("data-count"), "1");
    if (hasGlyph) {
      // FP4: the Reading host follows the existing unblocked glyph.
      assert.deepEqual(root.li.childNodes.map((node) => node.className), ["internal-link", "bob-unblocked-glyph", "bob-frees-mark"]);
    } else {
      // FP3: without 🔓, it follows the internal link.
      assert.deepEqual(root.li.childNodes.map((node) => node.className), ["internal-link", "bob-frees-mark"]);
    }
  }
});

test("Reading view inserts beside a task-link-mark sibling and through one wrapping p", () => {
  const tasks = [ownerTask(), dependent()];
  const { plugin } = makePlugin(tasks);
  const ringRoot = readingLedgerRoot({ withTaskLinkMark: true });
  plugin.sweepFreesMarksReadingView({ el: ringRoot, sourcePath: TODAY_PATH });
  const ringMark = ringRoot.querySelectorAll(".bob-frees-mark")[0];
  assert.ok(ringMark, "task-link-mark sibling must not hide the frees mark");
  assert.deepEqual(
    ringRoot.li.childNodes.map((node) => node.className),
    ["bob-task-link-mark", "internal-link", "bob-frees-mark"],
  );

  const wrapRoot = readingLedgerRoot({ withTaskLinkMark: true, wrapP: true, withUnblocked: true });
  plugin.sweepFreesMarksReadingView({ el: wrapRoot, sourcePath: TODAY_PATH });
  const wrapMark = wrapRoot.querySelectorAll(".bob-frees-mark")[0];
  assert.ok(wrapMark, "a wrapping p must not hide the frees mark");
  assert.deepEqual(
    wrapRoot.content.childNodes.map((node) => node.className),
    ["bob-task-link-mark", "internal-link", "bob-unblocked-glyph", "bob-frees-mark"],
  );
});

test("pinned midnight invalidates yesterday and gives today's editor a silent first paint", () => {
  const oldPath = "Daily/2026-11-01.md";
  const todayPath = TODAY_PATH;
  const tasks = [
    ownerTask(),
    dependent(),
    dependent({ id: "d2", blockId: "d2" }),
  ];
  const { app, plugin } = makePlugin(tasks);
  let currentPath = oldPath;
  plugin.currentTodayDailyPath = () => currentPath;

  const oldView = makeView(daily(linkRow()), oldPath);
  const todayView = makeView(daily(linkRow()), todayPath);
  const dispatches = [];
  app.workspace.getLeavesOfType = () => [
    {
      view: {
        file: { path: oldPath },
        editor: { cm: { dispatch: (effect) => dispatches.push([oldPath, effect]) } },
      },
    },
    {
      view: {
        file: { path: todayPath },
        editor: { cm: { dispatch: (effect) => dispatches.push([todayPath, effect]) } },
      },
    },
  ];
  plugin.freesMarkDay = oldPath;
  plugin.freesMarkEditorCounts(todayView).set("sase.md\u0000a", 1);

  const reading = readingLedgerRoot();
  plugin.progressMarkReadingContext = () => ({
    anchor: reading.anchor,
    target: "sase",
    blockId: "a",
  });
  plugin.sweepFreesMarksReadingView({ el: reading, sourcePath: oldPath });
  assert.equal(reading.querySelectorAll(".bob-frees-mark").length, 1);
  plugin.freesMarksReadingViews = new Map([
    [reading, { el: reading, ctx: { sourcePath: oldPath }, sourcePath: oldPath }],
  ]);

  // Cross local midnight from Nov 1 into the pinned Nov 2 test day.
  currentPath = todayPath;
  assert.equal(plugin.refreshFreesMarksForRollover(TODAY), true);
  assert.deepEqual(dispatches.map(([path]) => path), [oldPath, todayPath]);
  assert.equal(plugin.sweepFreesMarksReadingView({ el: reading, sourcePath: oldPath }), true);
  assert.equal(reading.querySelectorAll(".bob-frees-mark").length, 0, "yesterday's Reading host is removed");
  assert.equal(decorationRows(plugin.buildFreesMarkDecorations(oldView)).length, 0, "yesterday is bare immediately");

  const todayRows = decorationRows(plugin.buildFreesMarkDecorations(todayView));
  assert.equal(todayRows.length, 1);
  assert.equal(todayRows[0].value.widget.model.count, 2);
  assert.equal(todayRows[0].value.widget.model.tick, false, "midnight starts a silent count history");

  // A Live Preview ↔ source-mode field transition remains a rebuild trigger.
  const fieldState = (live) => ({ field: (field) => field === LIVE_FIELD ? live : null });
  assert.equal(plugin.freesMarkShouldRebuild({ startState: fieldState(true), state: fieldState(false) }), true);
  assert.equal(plugin.freesMarkShouldRebuild({ selectionSet: true }), false);
});

test("FT element and widget keep accessible attributes without a title", () => {
  const doc = fakeElementDoc();
  const model = {
    blockId: "a",
    count: 1,
    waiting: 0,
    freed: [dependent()],
    dailyPath: TODAY_PATH,
  };
  const host = buildFreesMarkElement(doc, model);
  assert.ok(host);
  assert.equal(host.attrs.class, "bob-frees-mark");
  assert.equal(host.attrs.role, "img");
  assert.equal(host.attrs["data-tooltip-position"], "top");
  assert.equal(host.attrs["data-count"], "1");
  assert.equal(host.attrs["data-block-id"], "a");
  assert.equal(host.attrs.title, undefined);
  assert.equal(host.children[0].attrs.class, "bob-frees-mark-key");
  assert.equal(host.children[0].textContent, "🔑");
  assert.equal(host.children[1].text, "1");
  assert.equal(host.attrs["aria-label"].includes("::"), false);
  assert.equal(buildFreesMarkElement(null, model), null);

  const opened = [];
  const workspace = { openLinkText: (...args) => opened.push(args) };
  const navigationModel = { ...model, blockId: "prj", linktext: "one#^prj" };
  const first = new FreesMarkWidget(navigationModel, TODAY_PATH, false, workspace);
  const same = new FreesMarkWidget({ ...navigationModel }, TODAY_PATH, true, workspace);
  const changedCount = new FreesMarkWidget({ ...navigationModel, count: 2 }, TODAY_PATH, false, workspace);
  const changedTooltip = new FreesMarkWidget({ ...navigationModel, freed: [dependent({ description: "Different" })] }, TODAY_PATH, false, workspace);
  const replacement = new FreesMarkWidget({ ...navigationModel, linktext: "two#^prj" }, TODAY_PATH, false, workspace);
  assert.equal(first.eq(same), true);
  assert.equal(first.eq(changedCount), false);
  assert.equal(first.eq(changedTooltip), false);
  assert.equal(first.eq(replacement), false, "a retargeted link replaces the widget");

  const savedDocument = global.document;
  global.document = fakeElementDoc();
  try {
    const replacementDom = replacement.toDOM(makeView(daily(linkRow("two#^prj"))));
    replacementDom.handlers.mousedown({
      button: 0,
      metaKey: true,
      preventDefault() {},
    });
    assert.deepEqual(opened, [["two#^prj", TODAY_PATH, "tab"]]);
  } finally {
    if (savedDocument === undefined) delete global.document;
    else global.document = savedDocument;
  }
});

test("Live Preview tick LRU tracks 0 → N, count changes, and the 2000-key bound", () => {
  const owner = ownerTask();
  const firstDependent = dependent();
  let tasks = [owner];
  const { plugin } = makePlugin(tasks);
  const content = daily(linkRow());
  const view = makeView(content);

  // First paint and warm rebuild record N = 0 without drawing or ticking.
  let rows = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.equal(rows.length, 0);
  assert.equal(plugin.freesMarkEditorCounts(view).get("sase.md\u0000a"), 0);
  assert.equal(decorationRows(plugin.buildFreesMarkDecorations(view)).length, 0);

  // A real 0 → 1 transition from a replacement memo makes the visible pill tick.
  tasks = [owner, firstDependent];
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  rows = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.equal(rows[0].value.widget.model.count, 1);
  assert.equal(rows[0].value.widget.model.tick, true);

  // A later dependency edit changes the count; the visible host ticks once.
  tasks = [owner, firstDependent, dependent({ id: "d2", blockId: "d2" })];
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  rows = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.equal(rows[0].value.widget.model.count, 2);
  assert.equal(rows[0].value.widget.model.tick, true);

  // A drop to zero removes the host and records zero without a tick.
  tasks = [owner];
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  rows = decorationRows(plugin.buildFreesMarkDecorations(view));
  assert.equal(rows.length, 0);
  const counts = plugin.freesMarkEditorCounts(view);
  assert.equal(counts.get("sase.md\u0000a"), 0);

  // The per-editor LRU is bounded at the documented 2,000 keys.
  const lru = new Map();
  for (let i = 0; i < 2001; i += 1) {
    plugin.rememberFreesMarkCount(lru, "p\u0000" + i, i % 2);
  }
  assert.equal(lru.size, 2000);
  assert.equal(lru.has("p\u00000"), false);
});

test("viewport-only rebuilds update visible count history without animating scroll-in", () => {
  const owner = ownerTask();
  let tasks = [owner, dependent()];
  const { plugin } = makePlugin(tasks);
  const content = daily(linkRow());
  const view = makeView(content);
  const linkLine = makeDoc(content).line(3);
  const linkEnd = linkLine.from + linkLine.text.indexOf("]]" ) + 2;
  view.visibleRanges = [{ from: linkEnd, to: linkEnd }];

  const extension = plugin.createFreesMarksExtension();
  assert.ok(extension && typeof extension.cls === "function");
  const state = new extension.cls(view);
  assert.equal(decorationRows(state.decorations)[0].value.widget.model.tick, false);

  // A dependency edit occurs while the row is offscreen; the count is not
  // resolved there. Scrolling it back in refreshes history silently.
  view.visibleRanges = [{ from: 0, to: 1 }];
  tasks = [owner, dependent(), dependent({ id: "d2", blockId: "d2" })];
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  state.update({ view, viewportChanged: true, docChanged: false });
  assert.equal(decorationRows(state.decorations).length, 0);
  view.visibleRanges = [{ from: linkEnd, to: linkEnd }];
  state.update({ view, viewportChanged: true, docChanged: false });
  assert.equal(decorationRows(state.decorations)[0].value.widget.model.count, 2);
  assert.equal(decorationRows(state.decorations)[0].value.widget.model.tick, false);

  // A later document edit remains the one transition that animates.
  tasks = [...tasks, dependent({ id: "d3", blockId: "d3" })];
  plugin.freshnessEnsureMemo = () => memoOf(tasks);
  state.update({ view, viewportChanged: false, docChanged: true });
  assert.equal(decorationRows(state.decorations)[0].value.widget.model.count, 3);
  assert.equal(decorationRows(state.decorations)[0].value.widget.model.tick, true);
});

test("toggle, refresh effect, and modifier navigation are wired", () => {
  const tasks = flTasks();
  const { app, plugin } = makePlugin(tasks);
  const oldSetInterval = global.setInterval;
  global.setInterval = () => 9876;
  try {
    plugin.setupFreesMarks();
  } finally {
    global.setInterval = oldSetInterval;
  }
  assert.ok(plugin.commands.some((command) => command.id === "toggle-frees-marks"));
  assert.ok(plugin.postProcessors.some((row) => row.sortOrder === 60));
  assert.ok(ensureFreesMarksRefresh());

  const view = makeView(daily(linkRow()));
  const result = plugin.buildFreesMarkDecorations(view);
  const widget = decorationRows(result)[0].value.widget;
  const doc = fakeElementDoc();
  global.document = doc;
  const dom = widget.toDOM(view);
  delete global.document;
  let prevented = false;
  dom.handlers.mousedown({
    button: 0,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(view.dispatches.length, 1);
  assert.equal(view.focused, true);

  dom.handlers.mousedown({
    button: 0,
    ctrlKey: true,
    preventDefault() {},
  });
  assert.deepEqual(app.openedLinks[0], ["sase#^a", TODAY_PATH, "tab"]);

  assert.equal(plugin.toggleFreesMarks(), false);
  assert.equal(plugin.buildFreesMarkDecorations(view), StubDecoration.none);
  assert.equal(plugin.toggleFreesMarks(), true);
  plugin.teardownFreesMarks();
});

test("setup is idempotent and teardown clears the rollover interval", () => {
  const { plugin } = makePlugin();
  const oldSetInterval = global.setInterval;
  const oldClearInterval = global.clearInterval;
  const cleared = [];
  let unrefCalls = 0;
  let intervalCalls = 0;
  const interval = { unref() { unrefCalls += 1; } };
  global.setInterval = () => {
    intervalCalls += 1;
    return interval;
  };
  global.clearInterval = (handle) => cleared.push(handle);
  try {
    plugin.setupFreesMarks();
    plugin.setupFreesMarks();
    assert.equal(intervalCalls, 1);
    assert.equal(unrefCalls, 1);
    assert.equal(plugin.freesMarksRolloverTimer, interval);
    plugin.teardownFreesMarks();
    assert.deepEqual(cleared, [interval]);
    assert.equal(plugin.freesMarksRolloverTimer, null);
  } finally {
    global.setInterval = oldSetInterval;
    global.clearInterval = oldClearInterval;
  }
});
