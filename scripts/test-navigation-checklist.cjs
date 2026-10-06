// Tests for PRE/POST checklist complete-and-advance in bob-navigation-hotkeys
// (bob-cli-48.5): Alt+F / Ctrl+Alt+F complete through cycler API v2, counted
// and Task Link batches skip checklist rows, missing gates write nothing.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
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
  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
    return ref;
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

const notices = [];
class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
}
function clearNotices() {
  notices.length = 0;
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Modal: class Modal {},
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
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return {
      EditorView: TestEditorView,
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const DATE = "2026-10-08";
const CHORES = [
  "Check weather",
  "Brush teeth",
  "Take pills",
  "Review Calendar",
  "Read Email",
  "Import inbox",
  "Do morning stretches!",
];

function choreLine(name) {
  return `- [ ] #task #gtd #pre ${name}  [repeat:: every day when done]`;
}

function postLine() {
  return "- [ ] #task #gtd #post Morning review  [repeat:: every day when done]";
}

function preEntry(name, line, rank, total = 7) {
  return {
    key: `gtd_daily.md:${line}`,
    path: "gtd_daily.md",
    line,
    originalMarkdown: choreLine(name),
    text: name,
    state: null,
    bucket: null,
    tier: "pre",
    tierLabel: "PRE",
    lane: "ready",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 1,
    rank,
    tierRank: rank,
    tierTotal: total,
  };
}

function postEntry(line, rank) {
  return {
    key: `gtd_daily.md:${line}`,
    path: "gtd_daily.md",
    line,
    originalMarkdown: postLine(),
    text: "Morning review",
    state: null,
    bucket: null,
    tier: "post",
    tierLabel: "POST",
    lane: "ready",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 1,
    rank,
    tierRank: 1,
    tierTotal: 1,
  };
}

function rottenLine() {
  return "- [ ] #task Buy milk [fresh:: 2026-09-30] [keeps:: 2]";
}

function rottenEntry(overrides = {}) {
  return {
    key: "a.md:3",
    path: "a.md",
    line: 3,
    originalMarkdown: rottenLine(),
    text: "Buy milk",
    state: "rotten",
    bucket: "rotten",
    tier: "rotten",
    tierLabel: "ROTTEN",
    lane: "ready",
    fresh: "2026-09-30",
    dueOn: "2026-10-07",
    daysOverdue: 1,
    interval: 7,
    keeps: 2,
    decide: false,
    rank: 1,
    tierRank: 1,
    tierTotal: 1,
    ...overrides,
  };
}

function applyTxChanges(state, changes) {
  const sorted = (Array.isArray(changes) ? changes : []).slice().sort(
    (left, right) => right.from.line - left.from.line,
  );
  for (const change of sorted) {
    state.lines[change.from.line] = String(change.text);
  }
}

function makeEditor(initial, cursorLine = 0) {
  const state = {
    lines: String(initial).split("\n"),
    cursor: { line: cursorLine, ch: 0 },
    transactions: [],
    replaceRanges: [],
    valueQueue: [],
  };
  return {
    state,
    getCursor: () => ({ ...state.cursor }),
    setCursor: (lineOrPos, ch) => {
      if (lineOrPos && typeof lineOrPos === "object") {
        state.cursor = {
          line: lineOrPos.line,
          ch: Number.isInteger(lineOrPos.ch) ? lineOrPos.ch : 0,
        };
      } else {
        state.cursor = { line: lineOrPos, ch: ch || 0 };
      }
    },
    getLine: (line) => state.lines[line],
    getValue: () =>
      state.valueQueue.length > 0
        ? state.valueQueue.shift()
        : state.lines.join("\n"),
    transaction: (tx) => {
      state.transactions.push(tx);
      applyTxChanges(state, tx.changes);
    },
    replaceRange: (text, from, to) => {
      state.replaceRanges.push({ text, from, to });
      applyTxChanges(state, [{ from, to, text }]);
    },
    getScrollInfo: () => null,
  };
}

function mockCompleteAtCursor({ insertAbove = false } = {}) {
  return async (editor) => {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    if (!line || !/- \[[ *\/?]\] /.test(line) || !/#task\b/i.test(line)) {
      return { ok: false, reason: "not-task" };
    }
    if (!/\[[ *\/?]\]/.test(line)) {
      return { ok: false, reason: "not-open" };
    }
    const closed = `${line.replace(/\[[ *\/?]\]/, "[x]")} [completion:: ${DATE}]`;
    if (insertAbove) {
      const nextOcc = `${line.replace(/\s*\[scheduled:: [^\]]+\]/, "")} [scheduled:: 2026-10-09]`;
      editor.state.lines.splice(cursor.line, 1, nextOcc, closed);
      editor.state.cursor = { line: cursor.line + 1, ch: 0 };
      return { ok: true, lineDelta: 1 };
    }
    editor.state.lines[cursor.line] = closed;
    return { ok: true, lineDelta: 0 };
  };
}

function makePlugin({ filePath, editor, freshness, cycler }) {
  const file = { path: filePath, extension: "md", basename: filePath };
  const view = { file, editor };
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  const plugins = {
    "bob-ledger-tools": { api: { version: 3, freshness } },
  };
  if (cycler) {
    plugins["task-status-cycler"] = { api: cycler };
  }
  plugin.app = {
    plugins: { plugins },
    workspace: { getActiveViewOfType: () => view, getActiveFile: () => file },
    vault: { getAbstractFileByPath: () => file },
  };
  plugin.reviewAnchor = null;
  plugin.reviewLanding = null;
  plugin.reviewLandingEpoch = 0;
  plugin.reviewGestureSeq = 0;
  plugin.reviewWalkLock = null;
  plugin.reviewAnsweredKeys = { day: null, keys: new Set() };
  // Human-paced presses: the gesture lock settles ~350 ms after each
  // advance, so rapid test presses tick the clock past the settle window.
  const clock = { now: Date.now() };
  plugin.reviewAdvanceNow = () => clock.now;
  plugin.advanceReviewClock = (ms) => {
    clock.now += ms;
  };
  plugin.view = view;
  plugin.laneReleaseDateText = () => DATE;
  return plugin;
}

function freshnessV7(queue, counts = {}) {
  return {
    version: 7,
    checklistTiers: true,
    queue: () => queue.map((entry) => ({ ...entry })),
    counts: () => ({
      due: 8,
      new: 0,
      resurfaced: 0,
      rotten: 0,
      fresh: 0,
      refreshedToday: 0,
      upkeepToday: 0,
      budget: null,
      budgetMet: false,
      ...counts,
    }),
    stampLine: (line) => {
      throw new Error(`checklist rows never stamp: ${line}`);
    },
    keepLine: (line) => {
      throw new Error(`checklist rows never keep: ${line}`);
    },
    reviewEntryView: (entry) => {
      const tier = entry && entry.tier;
      if (tier === "pre") {
        return {
          ok: true,
          tier: "pre",
          label: "PRE",
          detail: "checklist",
          compact: "checklist",
          actionHint: "Ctrl+Enter done · ]s skip",
        };
      }
      if (tier === "post") {
        return {
          ok: true,
          tier: "post",
          label: "POST",
          detail: "closeout",
          compact: "closeout",
          actionHint: "Ctrl+Enter done · closes the review",
        };
      }
      return { ok: false };
    },
  };
}

function sevenQueue() {
  return CHORES.map((name, index) => preEntry(name, index + 1, index + 1)).concat(
    postEntry(8, 8),
  );
}

function sevenContent() {
  return CHORES.map((name) => choreLine(name)).concat(postLine()).join("\n");
}

test("reviewLineChecklistKind matches exact #gtd #pre/#post tokens", () => {
  assert.equal(helpers.reviewLineChecklistKind(choreLine("Brush teeth")), "pre");
  assert.equal(helpers.reviewLineChecklistKind(postLine()), "post");
  assert.equal(helpers.reviewLineChecklistKind("- [ ] #task #pre Brush"), null);
  assert.equal(
    helpers.reviewLineChecklistKind("- [ ] #task #gtd #pressed_juice X"),
    null,
  );
  assert.equal(helpers.reviewLineChecklistKind("- [ ] #task #gtd/pre X"), null);
  assert.equal(
    helpers.reviewLineChecklistKind("- [ ] #task #GTD #Pre Brush teeth"),
    "pre",
  );
});

test("Alt+F on PRE stays with remaining PRE count and never stamps", async () => {
  clearNotices();
  const editor = makeEditor(sevenContent(), 0);
  const complete = mockCompleteAtCursor({ insertAbove: false });
  const plugin = makePlugin({
    filePath: "gtd_daily.md",
    editor,
    freshness: freshnessV7(sevenQueue()),
    cycler: { version: 2, completeTaskAtCursor: complete },
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.match(editor.state.lines[0], /\[x\]/);
  assert.doesNotMatch(editor.state.lines.join("\n"), /\[fresh::\]/);
  assert.equal(notices.at(-1), "✓ Done · 6 PRE left");
  assert.equal(editor.state.cursor.line, 0);
});

test("Ctrl+Alt+F completes seven PRE rows from a stale cache", async () => {
  for (const insertAbove of [false, true]) {
    clearNotices();
    const editor = makeEditor(sevenContent(), 0);
    const queue = sevenQueue();
    const plugin = makePlugin({
      filePath: "gtd_daily.md",
      editor,
      freshness: freshnessV7(queue),
      cycler: {
        version: 2,
        completeTaskAtCursor: mockCompleteAtCursor({ insertAbove }),
      },
    });
    for (let index = 0; index < CHORES.length; index += 1) {
      const ok = await plugin.refreshTaskFreshness(editor, {
        dateText: DATE,
        advance: true,
      });
      plugin.advanceReviewClock(400);
      assert.equal(ok, true, `${insertAbove ? "insert" : "in-place"} step ${index}`);
      assert.match(notices.at(-1), /✓ Done · /);
      if (index < CHORES.length - 1) {
        const landed = editor.getLine(editor.state.cursor.line);
        assert.match(
          landed,
          new RegExp(`#pre ${CHORES[index + 1]}`),
          `${insertAbove ? "insert" : "in-place"} landed ${CHORES[index + 1]}`,
        );
      }
    }
    assert.doesNotMatch(editor.state.lines.join("\n"), /\[fresh::\]/);
  }
});

test("Ctrl+Alt+F completes seven PRE rows from a refreshed cache", async () => {
  for (const insertAbove of [false, true]) {
    clearNotices();
    const editor = makeEditor(sevenContent(), 0);
    let queue = sevenQueue();
    const freshness = freshnessV7(queue);
    freshness.queue = () => queue.map((entry) => ({ ...entry }));
    const plugin = makePlugin({
      filePath: "gtd_daily.md",
      editor,
      freshness,
      cycler: {
        version: 2,
        completeTaskAtCursor: mockCompleteAtCursor({ insertAbove }),
      },
    });
    for (let index = 0; index < CHORES.length; index += 1) {
      const ok = await plugin.refreshTaskFreshness(editor, {
        dateText: DATE,
        advance: true,
      });
      plugin.advanceReviewClock(400);
      assert.equal(ok, true, `refresh ${insertAbove} ${index}`);
      const remaining = CHORES.slice(index + 1);
      const lines = editor.state.lines;
      queue = remaining.map((name) => {
        const line = lines.findIndex((row) => row.includes(`#pre ${name}`)) + 1;
        return preEntry(name, line, remaining.indexOf(name) + 1, remaining.length);
      }).concat(postEntry(
        lines.findIndex((row) => row.includes("#post")) + 1,
        remaining.length + 1,
      ));
    }
    assert.match(notices.at(-1), /✓ Done · /);
  }
});

test("POST stays put with the closing notice", async () => {
  clearNotices();
  const content = [choreLine("Brush teeth"), postLine()].join("\n");
  const editor = makeEditor(content, 1);
  const plugin = makePlugin({
    filePath: "gtd_daily.md",
    editor,
    freshness: freshnessV7([
      preEntry("Brush teeth", 1, 1, 1),
      postEntry(2, 2),
      rottenEntry({ key: "r.md:1", path: "r.md", line: 1, rank: 3 }),
    ]),
    cycler: {
      version: 2,
      completeTaskAtCursor: mockCompleteAtCursor({ insertAbove: false }),
    },
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    advance: true,
  });
  assert.equal(ok, true);
  assert.match(editor.state.lines[1], /\[x\].*Morning review/);
  assert.equal(editor.state.cursor.line, 1);
  assert.equal(
    notices.at(-1),
    "1 commitments still due · Review closed — 1 ROTTEN left for later",
  );
});

test("manual Ctrl+Enter then ]s from a refreshed cache lands on the next PRE", async () => {
  const editor = makeEditor(sevenContent(), 0);
  const complete = mockCompleteAtCursor({ insertAbove: true });
  let queue = sevenQueue();
  const freshness = freshnessV7(queue);
  freshness.queue = () => queue.map((entry) => ({ ...entry }));
  const plugin = makePlugin({
    filePath: "gtd_daily.md",
    editor,
    freshness,
    cycler: { version: 2, completeTaskAtCursor: complete },
  });
  const result = await complete(editor);
  assert.equal(result.ok, true);
  queue = CHORES.slice(1).map((name, index) => {
    const line = editor.state.lines.findIndex((row) => row.includes(`#pre ${name}`)) + 1;
    return preEntry(name, line, index + 1, 6);
  }).concat(postEntry(
    editor.state.lines.findIndex((row) => row.includes("#post")) + 1,
    7,
  ));
  plugin.landOnReviewQueueEntry = async (entry) => {
    const resolved = helpers.resolveReviewQueueLine(editor.getValue(), entry);
    if (!resolved.ok) {
      return { ok: false, stale: true };
    }
    editor.setCursor(resolved.line, 0);
    return { ok: true, stale: false };
  };
  plugin.getReviewJumpCursor = () => ({
    path: "gtd_daily.md",
    line: editor.state.cursor.line + 1,
    text: editor.getLine(editor.state.cursor.line),
  });
  clearNotices();
  assert.equal(await plugin.jumpToDueTask(1), true);
  assert.match(editor.getLine(editor.state.cursor.line), /Brush teeth/);
});

test("manual Ctrl+Enter then ]s from a stale cache uses text-first identity", async () => {
  const brush = choreLine("Brush teeth");
  const pills = choreLine("Take pills");
  const editor = makeEditor([brush, pills].join("\n"), 0);
  const complete = mockCompleteAtCursor({ insertAbove: true });
  const queue = [
    preEntry("Brush teeth", 1, 1, 2),
    preEntry("Take pills", 2, 2, 2),
  ];
  const plugin = makePlugin({
    filePath: "gtd_daily.md",
    editor,
    freshness: freshnessV7(queue),
    cycler: { version: 2, completeTaskAtCursor: complete },
  });
  await complete(editor);
  // Cursor text still names Brush teeth, now sitting on Pills' old line.
  plugin.getReviewJumpCursor = () => ({
    path: "gtd_daily.md",
    line: 2,
    text: brush,
  });
  plugin.landOnReviewQueueEntry = async (entry) => {
    const resolved = helpers.resolveReviewQueueLine(editor.getValue(), entry);
    if (!resolved.ok) {
      return { ok: false, stale: true };
    }
    editor.setCursor(resolved.line, 0);
    return { ok: true, stale: false };
  };
  clearNotices();
  assert.equal(await plugin.jumpToDueTask(1), true);
  assert.match(editor.getLine(editor.state.cursor.line), /Take pills/);
});

test("counted Alt+F skips checklist rows with the skip tail", async () => {
  clearNotices();
  const content = [choreLine("Brush teeth"), rottenLine()].join("\n");
  const editor = makeEditor(content, 0);
  const plugin = makePlugin({
    filePath: "a.md",
    editor,
    freshness: {
      version: 7,
      checklistTiers: true,
      queue: () => [
        { ...preEntry("Brush teeth", 1, 1, 1), key: "a.md:1", path: "a.md" },
        rottenEntry({ key: "a.md:2", path: "a.md", line: 2, originalMarkdown: rottenLine(), rank: 2 }),
      ],
      counts: () => ({
        due: 2, new: 0, resurfaced: 0, rotten: 1, fresh: 0,
        refreshedToday: 0, upkeepToday: 0, budget: null, budgetMet: false,
      }),
      keepLine: (line, dateText) =>
        `${line} [fresh:: ${dateText || DATE}] [keeps:: 3]`,
      stampLine: (line) => line,
    },
    cycler: { version: 2, completeTaskAtCursor: mockCompleteAtCursor() },
  });
  const ok = await plugin.refreshTaskFreshness(editor, {
    dateText: DATE,
    countExplicit: true,
    additionalTaskCount: 1,
  });
  assert.equal(ok, true);
  assert.match(editor.state.lines[0], /\[ \] #task #gtd #pre Brush teeth/);
  assert.match(editor.state.lines[1], /\[fresh:: 2026-10-08\]/);
  assert.match(notices.at(-1), /skipped 1 checklist/);
});

test("missing cycler gate on a PRE row writes nothing", async () => {
  clearNotices();
  const editor = makeEditor(choreLine("Brush teeth"), 0);
  const plugin = makePlugin({
    filePath: "gtd_daily.md",
    editor,
    freshness: freshnessV7([preEntry("Brush teeth", 1, 1, 1)]),
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, false);
  assert.equal(editor.state.lines[0], choreLine("Brush teeth"));
  assert.equal(
    notices.at(-1),
    "Checklist rows close by completion — update task-status-cycler",
  );
});

test("missing ledger checklist gate on a tagged line writes nothing", async () => {
  clearNotices();
  const editor = makeEditor(choreLine("Brush teeth"), 0);
  const plugin = makePlugin({
    filePath: "gtd_daily.md",
    editor,
    freshness: {
      version: 6,
      queue: () => [],
      counts: () => ({ due: 0, refreshedToday: 0, upkeepToday: 0, budget: null }),
      stampLine: (line) => `${line} [fresh:: ${DATE}]`,
      keepLine: (line) => line,
    },
    cycler: { version: 2, completeTaskAtCursor: mockCompleteAtCursor() },
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, false);
  assert.equal(editor.state.lines[0], choreLine("Brush teeth"));
  assert.equal(
    notices.at(-1),
    "Checklist rows close by completion — update bob-ledger-tools",
  );
});

test("a tagged line that is not a queue match falls through to recurring refusal", async () => {
  clearNotices();
  const line =
    "- [ ] #task #gtd #pre Tomorrow [repeat:: every day when done] [scheduled:: 2026-10-09]";
  const editor = makeEditor(line, 0);
  const plugin = makePlugin({
    filePath: "gtd_daily.md",
    editor,
    freshness: freshnessV7([]),
    cycler: { version: 2, completeTaskAtCursor: mockCompleteAtCursor() },
  });
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, false);
  assert.equal(editor.state.lines[0], line);
  assert.equal(notices.at(-1), "recurring · not reviewed");
});

test("formatFreshStampChecklistSkipTail names the skipped count", () => {
  assert.equal(helpers.formatFreshStampChecklistSkipTail(0), "");
  assert.equal(helpers.formatFreshStampChecklistSkipTail(1), " · skipped 1 checklist");
  assert.equal(helpers.formatFreshStampChecklistSkipTail(3), " · skipped 3 checklist");
});

test("partitionFreshStampChecklistSkips pulls PRE/POST out of a mixed batch", () => {
  const pre = { ...preEntry("Brush teeth", 1, 1, 1), key: "a.md:1", path: "a.md" };
  const rotten = rottenEntry({
    key: "a.md:2",
    path: "a.md",
    line: 2,
    originalMarkdown: rottenLine(),
    rank: 2,
  });
  const queue = [pre, rotten];
  const resolved = [
    {
      target: {
        line: 0,
        path: "a.md",
        raw: choreLine("Brush teeth"),
        counted: false,
      },
      match: helpers.matchFreshStampExactEntry(queue, {
        path: "a.md",
        line: 0,
        raw: choreLine("Brush teeth"),
      }),
    },
    {
      target: { line: 1, path: "a.md", raw: rottenLine(), counted: true },
      match: helpers.matchFreshStampExactEntry(queue, {
        path: "a.md",
        line: 1,
        raw: rottenLine(),
      }),
    },
  ];
  const part = helpers.partitionFreshStampChecklistSkips(resolved, queue);
  assert.equal(part.skipped.length, 1);
  assert.equal(part.stamp.length, 1);
  assert.equal(part.skipped[0].raw, choreLine("Brush teeth"));
  assert.equal(part.stamp[0].target.raw, rottenLine());
});

test("Task Link Alt+F skips a PRE target with the skip notice", async () => {
  clearNotices();
  const preTarget =
    "- [ ] #task #gtd #pre Brush teeth  [repeat:: every day when done] ^pre";
  const noteMap = new Map([["Target.md", preTarget]]);
  const editor = makeEditor("- [ ] [[Target#^pre]]", 0);
  const plugin = makePlugin({
    filePath: "Daily.md",
    editor,
    freshness: freshnessV7([
      {
        ...preEntry("Brush teeth", 1, 1, 1),
        key: "Target.md:1",
        path: "Target.md",
        originalMarkdown: preTarget,
      },
    ]),
    cycler: { version: 2, completeTaskAtCursor: mockCompleteAtCursor() },
  });
  plugin.noteMap = noteMap;
  plugin.readLinkPickerNoteContent = async (path) =>
    plugin.noteMap.has(path) ? plugin.noteMap.get(path) : null;
  plugin.writeLinkPickerNoteChange = async (path, file, before, after) => {
    plugin.writes.push({ path, before, after });
    plugin.noteMap.set(path, after);
  };
  plugin.resolveLinkTargetFile = (linkTarget) => {
    const base = String(linkTarget || "").split("#")[0] || "Target.md";
    const path = base.endsWith(".md") ? base : `${base}.md`;
    return { path, extension: "md" };
  };
  plugin.writes = [];
  const ok = await plugin.refreshTaskFreshness(editor, { dateText: DATE });
  assert.equal(ok, true);
  assert.equal(noteMap.get("Target.md"), preTarget);
  assert.equal(plugin.writes.length, 0);
  assert.equal(notices.at(-1), "skipped 1 checklist");
});
