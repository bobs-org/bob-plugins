// nav-core review auto-advance: the landing-scoped capture/continue helper,
// the gesture lock, the shared advance tail, and nav api v3
// (docs/freshness.md §6).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
class TestPlugin {}
const notices = [];
class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
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
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const DATE = "2026-10-08";

function markFor(tier, text) {
  if (tier === "next") {
    return `- [*] #task ${text}`;
  }
  if (tier === "pending") {
    return `- [/] #task ${text}`;
  }
  if (tier === "pre") {
    return `- [ ] #task #gtd #pre ${text}  [repeat:: every day when done]`;
  }
  if (tier === "post") {
    return `- [ ] #task #gtd #post ${text}  [repeat:: every day when done]`;
  }
  return `- [ ] #task ${text}`;
}

function laneEntry({ tier, path = "walk.md", line, text, rank, tierRank, tierTotal, extra = {} }) {
  return {
    key: `${path}:${line}`,
    path,
    line,
    originalMarkdown: markFor(tier, text),
    text,
    state: null,
    bucket: null,
    tier,
    tierLabel: tier.toUpperCase(),
    lane: "ready",
    fresh: "2026-10-06",
    dueOn: "2026-10-08",
    daysOverdue: 0,
    interval: 7,
    rank,
    tierRank,
    tierTotal,
    ...extra,
  };
}

// Rows with per-path 1-based lines; the note content is assembled from them.
function buildNotes(rows) {
  const byPath = new Map();
  for (const row of rows) {
    if (!byPath.has(row.path)) {
      byPath.set(row.path, []);
    }
    byPath.get(row.path).push(row);
  }
  const contents = {};
  for (const [path, list] of byPath) {
    const ordered = list.slice().sort((a, b) => a.line - b.line);
    const max = Math.max(...ordered.map((row) => row.line));
    const lines = [];
    for (let number = 1; number <= max; number += 1) {
      const row = ordered.find((candidate) => candidate.line === number);
      lines.push(row ? row.originalMarkdown : `# filler ${number}`);
    }
    contents[path] = lines;
  }
  return contents;
}

function freshnessApi(queueState, options = {}) {
  return {
    version: options.version === undefined ? 5 : options.version,
    checklistTiers: true,
    queue: () => queueState.map((row) => ({ ...row })),
    counts: () => ({
      due: queueState.length,
      new: 0,
      rotten: 0,
      refreshedToday: 0,
      upkeepToday: 0,
      budget: null,
      ...(options.counts || {}),
    }),
    keepLine:
      options.keepLine ||
      ((line) => `${String(line)} [fresh:: ${DATE}]`),
    stampLine: (line) => line,
    reviewEntryView: (item) => ({
      ok: true,
      tier: item.tier,
      label: String(item.tierLabel || item.tier || "").toUpperCase(),
      detail: "confirmed 2d ago",
      actionHint: "",
    }),
  };
}

function makeEditor(initial, cursorLine = 0) {
  const state = {
    lines: String(initial).split("\n"),
    cursor: { line: cursorLine, ch: 0 },
  };
  return {
    state,
    getCursor: () => ({ ...state.cursor }),
    setCursor(lineOrPos, ch) {
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
    getValue: () => state.lines.join("\n"),
    replaceRange(text, from) {
      state.lines[from.line] = String(text);
    },
    transaction(tx) {
      for (const change of tx.changes || []) {
        state.lines[change.from.line] = String(change.text);
      }
    },
    getScrollInfo: () => null,
  };
}

function makePlugin({ rows, activePath, cursorLine = 0, freshnessOptions = {}, withCycler = false }) {
  const queueState = rows.map((row) => ({ ...row }));
  const contents = buildNotes(queueState);
  const fileMap = new Map();
  const editors = new Map();
  for (const [path, lines] of Object.entries(contents)) {
    const basename = path.split("/").pop().replace(/\.md$/i, "");
    fileMap.set(path, { path, extension: "md", basename });
    editors.set(path, makeEditor(lines.join("\n")));
  }
  let currentPath = activePath;
  const viewFor = (path) => ({
    file: fileMap.get(path) || null,
    editor: editors.get(path) || null,
  });
  const workspace = {
    getActiveFile: () => fileMap.get(currentPath) || null,
    getActiveViewOfType: () => viewFor(currentPath),
    getLeaf: () => ({
      openFile: async (file) => {
        currentPath = file.path;
        return true;
      },
    }),
  };
  const vault = {
    getAbstractFileByPath: (path) => fileMap.get(path) || null,
  };
  const freshness = freshnessApi(queueState, freshnessOptions);
  const plugins = {
    "bob-ledger-tools": { api: { version: 3, freshness } },
  };
  if (withCycler) {
    plugins["task-status-cycler"] = {
      api: { version: 2, completeTaskAtCursor: async () => ({ ok: true }) },
    };
  }
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = { plugins: { plugins }, workspace, vault };
  plugin.reviewAnchor = null;
  plugin.reviewLanding = null;
  plugin.reviewLandingEpoch = 0;
  plugin.reviewGestureSeq = 0;
  plugin.reviewWalkLock = null;
  plugin.reviewAnsweredKeys = { day: null, keys: new Set() };
  plugin.vimJumpHistory = helpers.createVimJumpHistory();
  plugin.vimJumpOperationToken = 0;
  plugin.vimJumpHistoryChain = Promise.resolve();
  plugin.vimJumpSuppressNativeMirror = false;
  plugin.pendingTaskMoveJumpDeferred = null;
  plugin.pendingTaskMoveJumpCompletion = null;
  plugin.pendingTaskMoveJumpLandingId = null;
  plugin.taskMoveLandingSeq = 0;
  plugin.pendingOpenTaskJumpCenterDeferred = null;
  plugin.filePositions = new Map();
  plugin.findMarkdownLeafByPath = () => null;
  plugin.readLinkPickerNoteContent = async (path) => {
    const editor = editors.get(path);
    return editor ? editor.getValue() : null;
  };
  const clock = { now: Date.now() };
  plugin.reviewAdvanceNow = () => clock.now;
  plugin.advanceReviewClock = (ms) => {
    clock.now += ms;
  };
  plugin.laneReleaseDateText = () => DATE;
  plugin.api = helpers.createDependencyNavApi(plugin);
  editors.get(currentPath).setCursor(cursorLine, 0);
  return {
    plugin,
    editors,
    queueState,
    editor: editors.get(currentPath),
    view: () => viewFor(currentPath),
    activePath: () => currentPath,
  };
}

function clearNotices() {
  notices.length = 0;
}

async function land(fixture, endpoint = "first") {
  assert.equal(await fixture.plugin.jumpToDueTask(1, { endpoint }), true);
  assert.ok(fixture.plugin.reviewLanding, "the real review walk records its landing");
  clearNotices();
}

async function flushed(plugin) {
  await plugin.vimJumpHistoryChain;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await plugin.vimJumpHistoryChain;
}

function nextQueue(texts, options = {}) {
  return texts.map((text, index) => laneEntry({
    tier: "next",
    line: index + 1,
    text,
    rank: index + 1,
    tierRank: index + 1,
    tierTotal: texts.length,
    ...(options.extra || {}),
  }));
}

test("predicate: reviewOutcomeResolves across tiers and kinds", () => {
  const { reviewOutcomeResolves: resolves } = helpers;
  assert.equal(resolves("next", { kind: "complete" }, DATE), true);
  assert.equal(resolves("pre", { kind: "complete" }, DATE), true);
  for (const kind of ["lane", "link-today"]) {
    assert.equal(resolves("next", { kind }, DATE), true, `${kind} lane`);
    assert.equal(resolves("rotten", { kind }, DATE), true, `${kind} rotten`);
    assert.equal(resolves("pre", { kind }, DATE), false, `${kind} pre`);
    assert.equal(resolves("post", { kind }, DATE), false, `${kind} post`);
  }
  for (const tier of ["next", "rotten", "pre", "post"]) {
    assert.equal(
      resolves(tier, { kind: "move" }, DATE),
      false,
      "a move never resolves a landing",
    );
  }
  assert.equal(resolves("next", null, DATE), false);
  assert.equal(resolves("next", { kind: "bogus" }, DATE), false);
  assert.equal(resolves("next", {}, DATE), false);

  const line = "- [*] #task Water the plants";
  assert.equal(
    resolves("next", { kind: "card", beforeLine: line, afterLine: line }, DATE),
    false,
    "unchanged line never resolves",
  );
  assert.equal(
    resolves(
      "pre",
      { kind: "card", beforeLine: "- [ ] #task X [priority:: p1]", afterLine: "- [ ] #task X [priority:: p2]" },
      DATE,
    ),
    false,
    "priority-only change on a checklist row stays",
  );
  assert.equal(
    resolves(
      "next",
      { kind: "card", beforeLine: line, afterLine: "- [x] #task Water the plants" },
      DATE,
    ),
    true,
    "closed advances on a lane row",
  );
  assert.equal(
    resolves(
      "post",
      { kind: "card", beforeLine: "- [ ] #task #gtd #post Retro", afterLine: "- [-] #task #gtd #post Retro" },
      DATE,
    ),
    true,
    "cancelled advances on a checklist row",
  );
  assert.equal(
    resolves(
      "next",
      { kind: "card", beforeLine: line, afterLine: `${line} [scheduled:: 2026-10-20]` },
      DATE,
    ),
    true,
    "future schedule advances on a lane row",
  );
  assert.equal(
    resolves(
      "pre",
      {
        kind: "card",
        beforeLine: "- [ ] #task #gtd #pre Chore",
        afterLine: "- [ ] #task #gtd #pre Chore [scheduled:: 2026-10-20]",
      },
      DATE,
    ),
    true,
    "future schedule advances on a checklist row",
  );
  assert.equal(
    resolves(
      "next",
      { kind: "card", beforeLine: line, afterLine: `${line} [scheduled:: 2026-10-08]` },
      DATE,
    ),
    false,
    "today schedule is not after today",
  );
  assert.equal(
    resolves(
      "next",
      { kind: "card", beforeLine: line, afterLine: `${line} [fresh:: ${DATE}]` },
      DATE,
    ),
    true,
    "stamped today advances on a lane row",
  );
  assert.equal(
    resolves(
      "pre",
      {
        kind: "card",
        beforeLine: "- [ ] #task #gtd #pre Chore",
        afterLine: `- [ ] #task #gtd #pre Chore [fresh:: ${DATE}]`,
      },
      DATE,
    ),
    false,
    "stamped today alone stays on a checklist row",
  );
  assert.equal(
    resolves(
      "pre",
      {
        kind: "card",
        beforeLine: "- [ ] #task #gtd #pre Chore",
        afterLine: "- [ ] #task #gtd #pre Chore [dependsOn:: #a1b2c3]",
      },
      DATE,
    ),
    true,
    "a gained prerequisite advances on a checklist row",
  );
  assert.equal(
    resolves(
      "next",
      { kind: "card", beforeLine: line, afterLine: `${line} [dependsOn:: #a1b2c3]` },
      DATE,
    ),
    false,
    "a gained prerequisite alone stays on a lane row",
  );
  assert.equal(
    resolves(
      "next",
      { kind: "card", beforeLine: line, afterLine: `${line} (scheduled :: 2026-10-20)` },
      DATE,
    ),
    true,
    "paren scheduled fields parse",
  );
});

test("findReviewResumeIndex identifies rows by path and text", () => {
  const { findReviewResumeIndex } = helpers;
  const rows = nextQueue(["One", "Two"]);
  const twoRef = { path: "walk.md", line: 2, text: markFor("next", "Two") };
  assert.equal(findReviewResumeIndex(rows, twoRef), 1, "a unique hit");

  const dupes = [
    laneEntry({ tier: "next", path: "walk.md", line: 1, text: "Same", rank: 1, tierRank: 1, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 5, text: "Same", rank: 2, tierRank: 2, tierTotal: 3 }),
    laneEntry({ tier: "next", path: "walk.md", line: 9, text: "Same", rank: 3, tierRank: 3, tierTotal: 3 }),
  ];
  assert.equal(
    findReviewResumeIndex(dupes, { path: "walk.md", line: 6, text: markFor("next", "Same") }),
    1,
    "duplicate texts pick the nearest line",
  );
  assert.equal(
    findReviewResumeIndex(dupes, { path: "walk.md", line: 3, text: markFor("next", "Same") }),
    0,
    "ties pick the lower index",
  );

  const cross = [
    laneEntry({ tier: "next", path: "a.md", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "next", path: "b.md", line: 1, text: "One", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  assert.equal(
    findReviewResumeIndex(cross, { path: "b.md", line: 1, text: markFor("next", "One") }),
    1,
    "other paths are ignored",
  );

  assert.equal(findReviewResumeIndex(rows, { path: "walk.md", line: 1, text: "- [ ] missing" }), -1, "a miss");
  assert.equal(findReviewResumeIndex(null, null), -1, "garbage input");
  assert.equal(findReviewResumeIndex(rows, null), -1, "a null ref");
  assert.equal(findReviewResumeIndex(rows, { path: "", line: 1, text: "" }), -1, "an empty ref");
});

test("buildReviewMoveAnchor parks text-identified resume neighbours", () => {
  const { buildReviewMoveAnchor } = helpers;
  const before = nextQueue(["One", "Two", "Three"]);
  const keyOf = (text) => before.find((row) => row.text === text).key;

  const first = buildReviewMoveAnchor(before, [keyOf("One")], 1, DATE);
  assert.ok(first, "an anchor is built");
  assert.equal(first.resumeNext.text, markFor("next", "Two"), "resumeNext skips to Two");
  assert.equal(first.resumePrev, null, "no predecessor at the head");

  const middle = buildReviewMoveAnchor(before, [keyOf("Two")], 2, DATE);
  assert.equal(middle.resumeNext.text, markFor("next", "Three"));
  assert.equal(middle.resumePrev.text, markFor("next", "One"));

  const last = buildReviewMoveAnchor(before, [keyOf("Three")], 3, DATE);
  assert.equal(last.resumeNext, null, "no successor at the tail");
  assert.equal(last.resumePrev.text, markFor("next", "Two"));

  assert.equal(buildReviewMoveAnchor(before, [], 1, DATE), null, "null when nothing is handled");
});

test("planReviewJump with a move anchor resumes at the walk neighbour", () => {
  const { buildReviewMoveAnchor, planReviewJump } = helpers;
  const before = nextQueue(["One", "Two", "Three"]);
  const keyOf = (text) => before.find((row) => row.text === text).key;
  const anchor = buildReviewMoveAnchor(before, [keyOf("One")], 1, DATE);
  assert.ok(anchor && anchor.resumeNext, "the move anchor carries a resume");

  const refreshed = [
    { ...before[1], line: 1, key: "walk.md:1" },
    { ...before[2], line: 2, key: "walk.md:2" },
  ];
  let plan = planReviewJump(refreshed, { direction: 1, cursor: null, anchor, todayText: DATE });
  assert.equal(plan.kind, "jump", "a refreshed-cache shift jumps");
  assert.equal(plan.entry.originalMarkdown, markFor("next", "Two"), "to the successor");

  plan = planReviewJump(before.map((row) => ({ ...row })), { direction: 1, cursor: null, anchor, todayText: DATE });
  assert.equal(plan.entry.originalMarkdown, markFor("next", "Two"), "a stale cache goes to the successor");

  const movedMiddle = buildReviewMoveAnchor(before, [keyOf("Two")], 2, DATE);
  const afterMiddle = [
    { ...before[0], line: 1, key: "walk.md:1" },
    { ...before[2], line: 2, key: "walk.md:3" },
  ];
  plan = planReviewJump(afterMiddle, { direction: -1, cursor: null, anchor: movedMiddle, todayText: DATE });
  assert.equal(plan.entry.originalMarkdown, markFor("next", "One"), "direction -1 goes to the predecessor");

  const other = laneEntry({ tier: "next", path: "Other.md", line: 1, text: "Else", rank: 9, tierRank: 9, tierTotal: 9 });
  const withOther = [{ ...other }, ...refreshed.map((row) => ({ ...row }))];
  plan = planReviewJump(withOther, {
    direction: 1,
    cursor: { path: "Other.md", line: 1, text: "a stale line" },
    anchor,
    todayText: DATE,
  });
  assert.equal(plan.entry.originalMarkdown, markFor("next", "Two"), "a line-fallback cursor hit is ignored");

  const liveThree = [...refreshed.map((row) => ({ ...row })), { ...other }];
  const threeRow = liveThree.find((row) => row.text === "Three");
  const textHit = planReviewJump(liveThree, {
    direction: 1,
    cursor: { path: threeRow.path, line: threeRow.line, text: threeRow.originalMarkdown },
    anchor: buildReviewMoveAnchor(before, [keyOf("One")], 1, DATE),
    todayText: DATE,
  });
  assert.equal(textHit.entry.originalMarkdown, other.originalMarkdown, "a real text cursor hit still wins");

  plan = planReviewJump(refreshed, {
    direction: 1,
    cursor: { path: "walk.md", line: 1, text: markFor("next", "Two") },
    anchor,
    todayText: DATE,
  });
  assert.equal(plan.entry.originalMarkdown, markFor("next", "Two"), "a cursor on the resume row lands on it");

  const gone = [{ ...before[2], line: 1, key: "walk.md:3" }];
  plan = planReviewJump(gone, { direction: 1, cursor: null, anchor, todayText: DATE });
  assert.equal(plan.entry.originalMarkdown, markFor("next", "Three"), "a missing resume row falls back");

  const legacy = helpers.buildReviewAnchor(before, [keyOf("One")], 1, DATE);
  assert.ok(legacy && !("resumeNext" in legacy), "the legacy anchor has no resume fields");
  plan = planReviewJump(before.map((row) => ({ ...row })), { direction: 1, cursor: null, anchor: legacy, todayText: DATE });
  assert.equal(plan.entry.originalMarkdown, markFor("next", "Two"), "anchors without resume fields plan as before");
  const endpoint = planReviewJump(refreshed, { direction: 1, cursor: null, anchor, todayText: DATE, endpoint: "last" });
  assert.equal(endpoint.entry.originalMarkdown, markFor("next", "Three"), "endpoint jumps ignore the resume");
});

test("capture: null off a landing", async () => {
  const rows = nextQueue(["One", "Two"]);
  const cases = [
    { name: "no landing", landFirst: false },
    {
      name: "another day",
      mutate: (fixture) => {
        fixture.plugin.reviewLanding = {
          ...fixture.plugin.reviewLanding,
          day: "2026-10-07",
        };
      },
    },
    { name: "another editor", foreignEditor: true },
    {
      name: "changed text",
      mutate: (fixture) => {
        fixture.editor.state.lines[0] += " changed";
      },
    },
    {
      name: "landing key missing from the queue",
      mutate: (fixture) => {
        fixture.queueState.splice(0, fixture.queueState.length, fixture.queueState[1]);
      },
    },
    {
      name: "landing cleared by another file-open",
      mutate: (fixture) => {
        fixture.plugin.trackOpenedFile({ path: "Other.md", extension: "md" });
        assert.equal(fixture.plugin.reviewLanding, null);
      },
    },
  ];
  for (const item of cases) {
    const fixture = makePlugin({ rows, activePath: "walk.md" });
    if (item.landFirst !== false) {
      await land(fixture, "first");
    }
    if (item.mutate) {
      item.mutate(fixture);
    }
    clearNotices();
    const editor = item.foreignEditor === true ? {} : fixture.editor;
    assert.equal(fixture.plugin.captureReviewGesture(editor), null, item.name);
    assert.deepEqual(notices, [], item.name);
  }
});

test("capture: frozen origin shape, BUSY while locked, expiry", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  assert.ok(origin && typeof origin === "object", "an origin is captured");
  assert.equal(Object.isFrozen(origin), true, "the origin is frozen");
  assert.equal(origin.seq, 1);
  assert.equal(origin.epoch, 1);
  assert.equal(origin.day, DATE);
  assert.equal(origin.path, "walk.md");
  assert.equal(origin.line, 0);
  assert.equal(origin.text, fixture.queueState[0].originalMarkdown);
  assert.equal(origin.key, fixture.queueState[0].key);
  assert.equal(origin.tier, "next");
  assert.equal(origin.taskText, "One");
  assert.equal(origin.rank, 1);
  assert.equal(Object.isFrozen(origin.queueBefore), true);
  assert.equal(origin.queueBefore.length, 2);
  assert.deepEqual(origin.priorKeys, ["walk.md:1"]);

  assert.equal(plugin.captureReviewGesture(editor).busy, true, "BUSY while locked");
  assert.equal(helpers.REVIEW_WALK_BUSY.busy, true);
  assert.equal(Object.isFrozen(helpers.REVIEW_WALK_BUSY), true);
  assert.equal(helpers.REVIEW_GESTURE_LOCK_MS, 3000);
  assert.equal(helpers.REVIEW_ADVANCE_SETTLE_MS, 350);

  plugin.advanceReviewClock(3001);
  const second = plugin.captureReviewGesture(editor);
  assert.ok(second && !second.busy, "the lock expires");
  assert.equal(second.seq, 2);
});

test("continue: refuses stale origins, showing the notice once", async () => {
  const laneOutcome = (notice) => ({
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: "- [*] #task One" }],
    notice,
  });
  const cases = [
    {
      name: "newer epoch",
      setup: async (fixture) => {
        const origin = fixture.plugin.captureReviewGesture(fixture.editor);
        fixture.plugin.advanceReviewClock(3100);
        await fixture.plugin.jumpToDueTask(1);
        clearNotices();
        return origin;
      },
    },
    {
      name: "newer gesture seq",
      setup: async (fixture) => {
        const origin = fixture.plugin.captureReviewGesture(fixture.editor);
        fixture.plugin.advanceReviewClock(3100);
        fixture.plugin.captureReviewGesture(fixture.editor);
        clearNotices();
        return origin;
      },
    },
    {
      name: "consumed landing",
      setup: async (fixture) => {
        const origin = fixture.plugin.captureReviewGesture(fixture.editor);
        fixture.plugin.reviewLanding = null;
        clearNotices();
        return origin;
      },
    },
    {
      name: "day change",
      setup: async (fixture) => {
        const origin = fixture.plugin.captureReviewGesture(fixture.editor);
        fixture.plugin.laneReleaseDateText = () => "2026-10-09";
        clearNotices();
        return origin;
      },
    },
  ];
  for (const item of cases) {
    const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
    await land(fixture, "first");
    const origin = await item.setup(fixture);
    // The setup may land somewhere new; continue itself must move nothing.
    const cursor = { ...fixture.editor.getCursor() };
    const result = await fixture.plugin.continueReviewWalkAfter(origin, laneOutcome("Ready · 1 task"));
    assert.deepEqual(result, { ok: true, advanced: false, stopped: false }, item.name);
    assert.deepEqual(notices, ["Ready · 1 task"], `${item.name} shows the notice once`);
    assert.deepEqual(fixture.editor.getCursor(), cursor, `${item.name} moves nothing`);
  }
});

test("continue: stays on null and non-resolving outcomes", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  assert.deepEqual(
    await plugin.continueReviewWalkAfter(origin, null),
    { ok: true, advanced: false, stopped: false },
  );
  assert.deepEqual(notices, [], "a null outcome shows nothing");
  assert.equal(plugin.reviewLanding.key, "walk.md:1", "the landing survives a stay");
  assert.ok(!plugin.reviewWalkBusy(), "a stay frees the lock");
  const recapture = plugin.captureReviewGesture(editor);
  assert.ok(recapture && recapture.busy !== true, "recapture works after a stay");
});

test("continue: stays for lane answers and mixed-version completes on checklist rows", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "Stretch", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Pills", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const laneOrigin = plugin.captureReviewGesture(editor);
  assert.deepEqual(
    await plugin.continueReviewWalkAfter(laneOrigin, { kind: "lane", notice: "Lane · kept" }),
    { ok: true, advanced: false, stopped: false },
  );
  assert.deepEqual(notices, ["Lane · kept"]);
  assert.equal(editor.getCursor().line, 0, "the cursor stays");
  assert.equal(plugin.reviewLanding.key, "walk.md:1");

  clearNotices();
  const completeOrigin = plugin.captureReviewGesture(editor);
  assert.deepEqual(
    await plugin.continueReviewWalkAfter(completeOrigin, { kind: "complete" }),
    { ok: true, advanced: false, stopped: false },
  );
  assert.deepEqual(notices, [], "a checklist complete without notice stays silent");
  assert.equal(plugin.reviewLanding.key, "walk.md:1");
});

test("continue: a resolving lane answer advances exactly once with one composed toast", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two", "Three"]), activePath: "walk.md" });
  const { plugin, editor, queueState } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: queueState[0].originalMarkdown }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(result, { ok: true, advanced: true, stopped: false });
  assert.equal(editor.getCursor().line, 1, "lands on the successor");
  assert.equal(plugin.reviewLanding.key, "walk.md:2");
  assert.equal(queueState.length, 3, "the lagging queue still lists the answered row");
  assert.deepEqual(notices, ["Ready · 1 task\nReview 1/2 · NEXT 2/3 · confirmed 2d ago"]);
});

test("continue: counted handled refs land past every handled key in one jump", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two", "Three", "Four"]), activePath: "walk.md" });
  const { plugin, editor, queueState } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [0, 1, 2].map((line) => ({
      path: "walk.md",
      line,
      raw: queueState[line].originalMarkdown,
    })),
    notice: "Ready · 3 tasks",
  });
  assert.deepEqual(result, { ok: true, advanced: true, stopped: false });
  assert.equal(editor.getCursor().line, 3, "one jump past every handled key");
  assert.deepEqual(notices, ["Ready · 3 tasks\nReview 1/1 · NEXT 4/4 · confirmed 2d ago"]);
});

test("continue: wrap is announced and the empty queue composes the empty notice", async () => {
  const wrapped = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(wrapped, "last");
  assert.equal(wrapped.editor.getCursor().line, 1);
  const wrapOrigin = wrapped.plugin.captureReviewGesture(wrapped.editor);
  const wrapResult = await wrapped.plugin.continueReviewWalkAfter(wrapOrigin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 1, raw: wrapped.queueState[1].originalMarkdown }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(wrapResult, { ok: true, advanced: true, stopped: false });
  assert.equal(wrapped.editor.getCursor().line, 0, "wraps to the first skipped entry");
  assert.match(notices.at(-1), /wrapped around/, "the wrap is announced");

  const emptied = makePlugin({ rows: nextQueue(["One"]), activePath: "walk.md" });
  await land(emptied, "first");
  const emptyOrigin = emptied.plugin.captureReviewGesture(emptied.editor);
  emptied.queueState.splice(0, emptied.queueState.length);
  clearNotices();
  const emptyResult = await emptied.plugin.continueReviewWalkAfter(emptyOrigin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: "- [*] #task One" }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(emptyResult, { ok: true, advanced: false, stopped: false });
  assert.deepEqual(notices, ["Ready · 1 task\nNothing due for review · ✓ 0 today"]);
});

test("continue: anchor-only planning survives cursor drift and lagging queues", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two", "Three"]), activePath: "walk.md" });
  const { plugin, editor, queueState } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  // A line-shifting write lands the cursor on a different due row; the
  // advance still plans from the anchor, never the cursor.
  editor.state.lines.splice(1, 0, "- [*] #task Inserted above");
  editor.setCursor(2, 0);
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: queueState[0].originalMarkdown }],
    notice: "Ready · 1 task",
  });
  assert.deepEqual(result, { ok: true, advanced: true, stopped: false });
  assert.match(editor.getLine(editor.getCursor().line), /Two/, "lands on the anchored successor");
});

test("continue: POST origins never wrap", async () => {
  // A resolving card answer on a POST row (Task Card cancel): the walk
  // closes instead of wrapping onto the skipped lane row.
  const before = "- [ ] #task #gtd #post Morning review  [repeat:: every day when done]";
  const rows = [
    laneEntry({ tier: "next", line: 1, text: "Skipped chore", rank: 1, tierRank: 1, tierTotal: 1 }),
    { ...laneEntry({ tier: "post", line: 2, text: "Morning review", rank: 2, tierRank: 1, tierTotal: 1 }), originalMarkdown: before },
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "last");
  const origin = plugin.captureReviewGesture(editor);
  const result = await plugin.continueReviewWalkAfter(origin, {
    kind: "card",
    beforeLine: before,
    afterLine: before.replace("[ ]", "[-]"),
  });
  assert.deepEqual(result, { ok: true, advanced: false, stopped: true });
  assert.equal(editor.getCursor().line, 1, "stays on the POST row");
  assert.deepEqual(notices, [
    "1 commitments still due · Review closed — 0 ROTTEN left for later",
  ]);
});

test("complete: the last lane row before POST stays with the next-step toast", async () => {
  const rows = [
    laneEntry({ tier: "next", line: 1, text: "Water the plants", rank: 1, tierRank: 1, tierTotal: 1 }),
    laneEntry({ tier: "post", line: 2, text: "Morning review", rank: 2, tierRank: 1, tierTotal: 1 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  const result = await plugin.continueReviewWalkAfter(origin, { kind: "complete" });
  assert.deepEqual(result, { ok: true, advanced: false, stopped: true });
  assert.equal(editor.getCursor().line, 0, "never steps onto a checklist row");
  assert.equal(plugin.reviewLanding, null, "the answered landing is consumed");
  assert.deepEqual(notices, ["✓ Done · Water the plants\n]s → POST"]);
});

test("complete: a wrap onto a skipped PRE row stays", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "Skipped stretch", rank: 1, tierRank: 1, tierTotal: 1 }),
    laneEntry({ tier: "next", line: 2, text: "Settled chore", rank: 2, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "next", line: 3, text: "Last chore", rank: 3, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "last");
  const origin = plugin.captureReviewGesture(editor);
  const result = await plugin.continueReviewWalkAfter(origin, { kind: "complete" });
  assert.deepEqual(result, { ok: true, advanced: false, stopped: true });
  assert.equal(editor.getCursor().line, 2, "stays instead of wrapping onto PRE");
  assert.deepEqual(notices, ["✓ Done · Last chore\n]s → PRE · 2 commitments due"]);
});

test("complete: a step into ROTTEN shows the boundary line", async () => {
  const rows = [
    laneEntry({ tier: "next", line: 1, text: "Old chore", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "next", line: 2, text: "Kept chore", rank: 2, tierRank: 2, tierTotal: 2 }),
    laneEntry({ tier: "rotten", line: 3, text: "Moldy chore", rank: 3, tierRank: 1, tierTotal: 1 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await fixture.plugin.jumpToDueTask(1, { endpoint: "first" });
  await fixture.plugin.jumpToDueTask(1);
  clearNotices();
  assert.equal(editor.getCursor().line, 1, "sitting on the second NEXT row");
  const origin = plugin.captureReviewGesture(editor);
  const result = await plugin.continueReviewWalkAfter(origin, { kind: "complete" });
  assert.deepEqual(result, { ok: true, advanced: true, stopped: false });
  assert.equal(editor.getCursor().line, 2, "lands on the ROTTEN row");
  assert.deepEqual(notices, [
    "✓ Done · Kept chore\nROTTEN next — 1 commitments still due\nReview 2/2 · ROTTEN 1/1 · confirmed 2d ago",
  ]);
});

test("busy: walk keys, refresh, claim, and capture are swallowed in the settle window", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two", "Three"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  assert.equal(await plugin.jumpToDueTask(1), false, "]s swallowed while locked");
  assert.equal(await plugin.refreshTaskFreshness(editor, {}), false, "Alt+F swallowed while locked");
  assert.deepEqual(
    await plugin.claimReviewWalkCtrlEnter(editor),
    { ok: false, reason: "busy" },
    "the claim is swallowed while locked",
  );
  assert.equal(plugin.captureReviewGesture(editor).busy, true);
  assert.deepEqual(notices, [], "swallowed keys write nothing and show nothing");
  assert.equal(editor.getCursor().line, 0);

  // Settle the gesture without advancing, then answer for real: the tail
  // holds the lock in flight and through the settle window.
  assert.deepEqual(await plugin.continueReviewWalkAfter(origin, null), {
    ok: true,
    advanced: false,
    stopped: false,
  });
  const second = plugin.captureReviewGesture(editor);
  assert.ok(second && !second.busy);
  assert.deepEqual(
    await plugin.continueReviewWalkAfter(second, {
      kind: "lane",
      handledRefs: [{ path: "walk.md", line: 0, raw: fixture.queueState[0].originalMarkdown }],
      notice: "Ready · 1 task",
    }),
    { ok: true, advanced: true, stopped: false },
  );
  assert.equal(editor.getCursor().line, 1);
  clearNotices();
  assert.equal(await plugin.jumpToDueTask(1), false, "]s swallowed in the settle window");
  assert.equal(plugin.captureReviewGesture(editor).busy, true, "capture swallowed in the settle window");
  assert.deepEqual(notices, []);
  assert.equal(editor.getCursor().line, 1, "nothing moved");
  plugin.advanceReviewClock(400);
  assert.equal(await plugin.jumpToDueTask(1), true, "the walk works again after the window");
  assert.equal(editor.getCursor().line, 2);
});

test("advance: Ctrl+Alt+F stamps through the shared tail with one composed toast", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two", "Three"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  assert.equal(
    await plugin.refreshTaskFreshness(editor, { advance: true, dateText: DATE }),
    true,
  );
  assert.match(editor.getLine(0), /\[fresh:: 2026-10-08\]/, "the row is stamped");
  assert.match(editor.getLine(editor.getCursor().line), /Two/, "lands on the successor");
  assert.equal(notices.length, 1, "exactly one toast");
  assert.deepEqual(notices, [
    "Fresh ✓ 1 task · 2 due (0 new) · ✓ 0 today\nReview 1/2 · NEXT 2/3 · confirmed 2d ago",
  ]);
});

test("advance: decay choices advance except reword, with no preamble of their own", async () => {
  const rows = nextQueue(["One", "Two"]);
  const advancing = makePlugin({ rows, activePath: "walk.md" });
  await land(advancing, "first");
  assert.equal(
    await advancing.plugin.maybeAdvanceFreshnessDecayWalk({ advance: true }, "keep"),
    true,
  );
  assert.equal(advancing.editor.getCursor().line, 1, "a keep advances exactly once");
  assert.deepEqual(notices, ["Review 1/1 · NEXT 2/2 · confirmed 2d ago"]);

  const staying = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(staying, "first");
  clearNotices();
  assert.equal(
    await staying.plugin.maybeAdvanceFreshnessDecayWalk({ advance: true }, "reword"),
    true,
  );
  assert.equal(staying.editor.getCursor().line, 0, "reword stays for editing");
  assert.deepEqual(notices, [], "reword shows nothing");
  assert.equal(
    await staying.plugin.maybeAdvanceFreshnessDecayWalk({ advance: false }, "keep"),
    true,
  );
  assert.equal(staying.editor.getCursor().line, 0, "Alt+F decay choices stay");
  assert.deepEqual(notices, [], "Alt+F decay choices show nothing of their own here");
});

test("jump history: same-note and cross-note auto-advances record, and <C-o> returns", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  const origin = plugin.captureReviewGesture(editor);
  await plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [{ path: "walk.md", line: 0, raw: fixture.queueState[0].originalMarkdown }],
    notice: "Ready · 1 task",
  });
  await flushed(plugin);
  assert.deepEqual(plugin.vimJumpHistory.entries, [
    { path: "walk.md", line: 0, ch: 0 },
    { path: "walk.md", line: 1, ch: 0 },
  ]);
  assert.equal(
    await plugin.traverseVimJumpHistory(-1, 1, editor),
    true,
    "traversal runs",
  );
  assert.equal(editor.getCursor().line, 0, "<C-o> returns to the answered row");

  const cross = makePlugin({
    rows: [
      laneEntry({ tier: "next", path: "a.md", line: 1, text: "Alpha", rank: 1, tierRank: 1, tierTotal: 1 }),
      laneEntry({ tier: "next", path: "b.md", line: 1, text: "Beta", rank: 2, tierRank: 1, tierTotal: 1 }),
    ],
    activePath: "a.md",
  });
  await land(cross, "first");
  assert.equal(cross.activePath(), "a.md");
  const crossOrigin = cross.plugin.captureReviewGesture(cross.editors.get("a.md"));
  await cross.plugin.continueReviewWalkAfter(crossOrigin, {
    kind: "lane",
    handledRefs: [{ path: "a.md", line: 0, raw: cross.queueState[0].originalMarkdown }],
    notice: "Ready · 1 task",
  });
  await flushed(cross.plugin);
  assert.equal(cross.activePath(), "b.md", "the walk crossed notes");
  assert.deepEqual(cross.plugin.vimJumpHistory.entries, [
    { path: "a.md", line: 0, ch: 0 },
    { path: "b.md", line: 0, ch: 0 },
  ]);
});

test("jump history: a manual ]s also records its landing", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  await land(fixture, "first");
  assert.deepEqual(plugin.vimJumpHistory.entries, [], "landing where the cursor already sits records nothing");
  assert.equal(await plugin.jumpToDueTask(1), true);
  await flushed(plugin);
  assert.deepEqual(plugin.vimJumpHistory.entries, [
    { path: "walk.md", line: 0, ch: 0 },
    { path: "walk.md", line: 1, ch: 0 },
  ]);
});

test("api: reviewWalk v3 is frozen with version 1, degrades null, never throws", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One"]), activePath: "walk.md" });
  const { plugin, editor } = fixture;
  assert.equal(plugin.api.version, 3);
  assert.ok(Object.isFrozen(plugin.api));
  assert.equal(plugin.api.reviewWalk.version, 1);
  assert.ok(Object.isFrozen(plugin.api.reviewWalk));
  assert.equal(typeof plugin.api.reviewWalk.capture, "function");
  assert.equal(typeof plugin.api.reviewWalk.continue, "function");

  await land(fixture, "first");
  assert.equal(plugin.api.reviewWalk.capture(editor).key, "walk.md:1");
  fixture.plugin.advanceReviewClock(3100);
  assert.equal(plugin.api.reviewWalk.capture({}), null, "off-landing capture is null");

  const nullApi = helpers.createDependencyNavApi(null);
  assert.equal(nullApi.version, 3);
  assert.equal(nullApi.reviewWalk.version, 1);
  assert.equal(nullApi.reviewWalk.capture({}), null);
  clearNotices();
  assert.deepEqual(await nullApi.reviewWalk.continue({}, { notice: "Linked · done" }), {
    ok: false,
    advanced: false,
    stopped: false,
  });
  assert.deepEqual(notices, ["Linked · done"]);

  const throwingApi = helpers.createReviewWalkApi({
    captureReviewGesture() {
      throw new Error("boom");
    },
    continueReviewWalkAfter() {
      throw new Error("boom");
    },
  });
  assert.equal(throwingApi.capture({}), null);
  assert.deepEqual(await throwingApi.continue({}, null), { ok: false, advanced: false, stopped: false });

  assert.deepEqual(
    await plugin.api.reviewWalk.continue("garbage", null),
    { ok: true, advanced: false, stopped: false },
    "a malformed origin refuses without throwing",
  );
});
