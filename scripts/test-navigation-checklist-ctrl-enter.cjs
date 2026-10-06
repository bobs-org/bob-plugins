// Ctrl+Enter claims only the current PRE/POST review-walk landing and advances
// through live checklist rows (docs/freshness.md §6).
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
const CHORES = [
  "Check weather",
  "Brush teeth",
  "Take pills",
  "Review Calendar",
  "Read Email",
  "Import inbox",
  "Do morning stretches!",
];
function preLine(text, symbol = " ") {
  return `- [${symbol}] #task #gtd #pre ${text}  [repeat:: every day when done]`;
}
function postLine(text = "Morning review", symbol = " ") {
  return `- [${symbol}] #task #gtd #post ${text}  [repeat:: every day when done]`;
}
function entry({ tier = "pre", path = "gtd_daily.md", line, text, markdown, rank, tierRank, tierTotal }) {
  const isPost = tier === "post";
  return {
    key: `${path}:${line}`,
    path,
    line,
    originalMarkdown: markdown || (isPost ? postLine(text) : preLine(text)),
    text,
    state: tier === "new" ? "new" : null,
    bucket: tier === "new" ? "new" : null,
    tier,
    tierLabel: tier.toUpperCase(),
    lane: "ready",
    fresh: null,
    dueOn: null,
    daysOverdue: null,
    interval: 1,
    rank,
    tierRank,
    tierTotal,
  };
}
function queueFor(chores, posts = ["Morning review"], tail = []) {
  const rows = chores.map((text) => ({ tier: "pre", text, markdown: preLine(text) }));
  rows.push(...tail.filter((row) => row.tier !== "post"));
  posts.forEach((text) => rows.push({ tier: "post", text, markdown: postLine(text) }));
  const totals = new Map();
  for (const row of rows) totals.set(row.tier, (totals.get(row.tier) || 0) + 1);
  const ranks = new Map();
  return rows.map((row, index) => {
    const tierRank = (ranks.get(row.tier) || 0) + 1;
    ranks.set(row.tier, tierRank);
    return entry({
      ...row,
      line: index + 1,
      rank: index + 1,
      tierRank,
      tierTotal: totals.get(row.tier),
    });
  });
}
function makeEditor(content, cursorLine = 0) {
  const state = { lines: String(content).split("\n"), cursor: { line: cursorLine, ch: 0 } };
  return {
    state,
    getCursor: () => ({ ...state.cursor }),
    setCursor(lineOrPos, ch) {
      state.cursor = typeof lineOrPos === "object"
        ? { line: lineOrPos.line, ch: lineOrPos.ch || 0 }
        : { line: lineOrPos, ch: ch || 0 };
    },
    getLine: (line) => state.lines[line],
    getValue: () => state.lines.join("\n"),
    replaceRange(text, from) {
      state.lines[from.line] = String(text);
    },
    transaction(tx) {
      for (const change of tx.changes || []) state.lines[change.from.line] = String(change.text);
    },
    getScrollInfo: () => null,
  };
}
function completeAtCursor({ insertAbove = false, fail = false } = {}) {
  return async (editor) => {
    if (fail) return { ok: false, reason: "not-closed" };
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    if (!line || !/^- \[[ *\/?]\] #task\b/.test(line)) {
      return { ok: false, reason: "not-task" };
    }
    const closed = line.replace(/\[[ *\/?]\]/, "[x]") + ` [completion:: ${DATE}]`;
    if (insertAbove) {
      const next = line + " [scheduled:: 2026-10-09]";
      editor.state.lines.splice(cursor.line, 1, next, closed);
      editor.setCursor(cursor.line + 1, 0);
    } else {
      editor.state.lines[cursor.line] = closed;
    }
    return { ok: true, lineDelta: insertAbove ? 1 : 0 };
  };
}
function freshnessApi(queueState, options = {}) {
  return {
    version: options.version === undefined ? 7 : options.version,
    checklistTiers: options.checklistTiers !== false,
    queue: () => queueState.map((row) => ({ ...row })),
    counts: () => ({ due: queueState.length, rotten: 2, ...options.counts }),
    stampLine: () => { throw new Error("checklist rows never stamp"); },
    keepLine: () => { throw new Error("checklist rows never keep"); },
    reviewEntryView: (item) => ({
      ok: true,
      tier: item.tier,
      label: item.tier.toUpperCase(),
      detail: item.tier === "pre" ? "checklist" : "closeout",
      actionHint: item.tier === "pre"
        ? "Ctrl+Enter done · ]s skip"
        : "Ctrl+Enter done · closes the review",
    }),
  };
}
function makePlugin({ queue, chores, posts, content, complete, cyclerVersion = 2, withCycler = true, freshnessOptions = {} }) {
  const queueState = queue || queueFor(chores || CHORES, posts || ["Morning review"]);
  const lines = content || queueState.map((row) => row.originalMarkdown).join("\n");
  const file = { path: "gtd_daily.md", extension: "md", basename: "gtd_daily" };
  const editor = makeEditor(lines);
  const view = { file, editor };
  const freshness = freshnessApi(queueState, freshnessOptions);
  const plugins = {
    "bob-ledger-tools": { api: { version: 3, freshness } },
  };
  if (withCycler) {
    plugins["task-status-cycler"] = {
      api: {
        version: cyclerVersion,
        completeTaskAtCursor: complete || completeAtCursor(),
      },
    };
  }
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    plugins: { plugins },
    workspace: {
      getActiveViewOfType: () => view,
      getActiveFile: () => file,
    },
    vault: {
      getAbstractFileByPath: (path) => path === file.path ? file : null,
      cachedRead: async () => editor.getValue(),
      read: async () => editor.getValue(),
    },
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
  plugin.api = helpers.createDependencyNavApi(plugin);
  return { plugin, editor, view, freshness, queueState };
}
function clearNotices() { notices.length = 0; }
async function land(plugin, endpoint = "first") {
  assert.equal(await plugin.jumpToDueTask(1, { endpoint }), true);
  assert.ok(plugin.reviewLanding, "the real review walk records its landing");
  clearNotices();
}
async function claim(plugin, editor) {
  const result = plugin.api.claimReviewWalkCompletion(editor);
  return result && typeof result.then === "function" ? await result : result;
}
function refreshQueueFromEditor(fixture) {
  const rows = [];
  for (const [index, line] of fixture.editor.state.lines.entries()) {
    const tier = /#gtd\b.*#pre\b/i.test(line)
      ? "pre"
      : /#gtd\b.*#post\b/i.test(line)
        ? "post"
        : null;
    if (!tier || !/^- \[[ *\/?]\] #task\b/.test(line) || /\[scheduled:: 2026-10-09\]/.test(line)) {
      continue;
    }
    const text = line.includes("#pre")
      ? line.slice(line.indexOf("#pre") + 4).replace(/\s+\[repeat::.*$/, "").trim()
      : line.slice(line.indexOf("#post") + 5).replace(/\s+\[repeat::.*$/, "").trim();
    rows.push({ tier, line: index + 1, text, markdown: line });
  }
  const totals = new Map();
  for (const row of rows) totals.set(row.tier, (totals.get(row.tier) || 0) + 1);
  const ranks = new Map();
  const fresh = rows.map((row, index) => {
    const tierRank = (ranks.get(row.tier) || 0) + 1;
    ranks.set(row.tier, tierRank);
    return entry({ ...row, rank: index + 1, tierRank, tierTotal: totals.get(row.tier) });
  });
  fixture.queueState.splice(0, fixture.queueState.length, ...fresh);
}

test("review checklist group helpers format exact completion and close notices", () => {
  const rows = queueFor(["One", "Two"], ["Morning review"]);
  assert.deepEqual(
    helpers.reviewChecklistGroupScan(rows, rows[1], new Set([rows[0].key])),
    { after: [], before: [] },
  );
  assert.equal(
    helpers.formatReviewCtrlEnterDoneLine("Check weather", "pre"),
    "✓ Done · Check weather · Ctrl+Enter → next PRE",
  );
  assert.equal(
    helpers.formatReviewChecklistGroupEndNotice({ taskText: "Last", tier: "pre", nextLabel: "NEW", commitments: 12 }),
    "✓ Done · Last · PRE done\n]s → NEW · 12 commitments due",
  );
  assert.equal(
    helpers.formatReviewClosedNotice({ commitments: 0, postSkipped: 0, rotten: 3 }),
    "Review closed — 3 ROTTEN left for later",
  );
  assert.equal(
    helpers.formatReviewClosedNotice({ commitments: 2, postSkipped: 1, rotten: 3 }),
    "1 POST still due · 2 commitments still due · Review closed — 3 ROTTEN left for later",
  );
});

test("claim declines without a current exact PRE/POST walk landing", async () => {
  const queue = queueFor(["One", "Two"]);
  const cases = [
    { name: "no landing" },
    { name: "yesterday", mutate: ({ plugin }) => { plugin.reviewLanding = { ...plugin.reviewLanding, day: "2026-10-07" }; } },
    { name: "cursor moved", mutate: ({ editor }) => editor.setCursor(1, 0) },
    { name: "line edited", mutate: ({ editor }) => { editor.state.lines[0] += " changed"; } },
    { name: "other file", mutate: ({ view }) => { view.file = { path: "elsewhere.md" }; } },
    { name: "not checklist tier", mutate: ({ queueState }) => { queueState[0] = { ...queueState[0], tier: "new" }; } },
    { name: "ROTTEN tier", mutate: ({ queueState }) => { queueState[0] = { ...queueState[0], tier: "rotten" }; } },
    { name: "ledger v6", freshnessOptions: { version: 6 } },
    { name: "checklist capability absent", freshnessOptions: { checklistTiers: false } },
    { name: "cycler absent", withCycler: false },
    { name: "cycler v1", cyclerVersion: 1 },
  ];
  for (const item of cases) {
    const fixture = makePlugin({ queue, freshnessOptions: item.freshnessOptions, withCycler: item.withCycler, cyclerVersion: item.cyclerVersion });
    if (item.name !== "no landing") await land(fixture.plugin);
    if (item.mutate) item.mutate(fixture);
    clearNotices();
    assert.equal(await claim(fixture.plugin, fixture.editor), null, item.name);
    assert.match(fixture.editor.getLine(0), /^- \[ \]/, item.name);
    assert.deepEqual(notices, [], item.name);
  }
});

test("a real [S landing lets Ctrl+Enter complete and land on the next live PRE row", async () => {
  const queue = queueFor(CHORES);
  const fixture = makePlugin({ queue, content: queue.map((row) => row.originalMarkdown).join("\n") });
  await land(fixture.plugin, "first");
  const result = await claim(fixture.plugin, fixture.editor);
  assert.deepEqual(result, { ok: true });
  assert.match(fixture.editor.getLine(fixture.editor.getCursor().line), /#pre Brush teeth/);
  assert.doesNotMatch(fixture.editor.getValue(), /\[fresh::/);
  assert.equal(
    notices.at(-1),
    "✓ Done · Check weather · Ctrl+Enter → next PRE\nReview 2/8 · PRE 2/7 · checklist",
  );
});

test("seven Ctrl+Enter presses walk PRE with stale queues and either recurrence insertion mode", async () => {
  for (const insertAbove of [false, true]) {
    for (const refreshed of [false, true]) {
    const queue = queueFor(CHORES);
    const fixture = makePlugin({
      queue,
      content: queue.map((row) => row.originalMarkdown).join("\n"),
      complete: completeAtCursor({ insertAbove }),
    });
    await land(fixture.plugin, "first");
    for (let index = 0; index < CHORES.length; index += 1) {
      if (refreshed) refreshQueueFromEditor(fixture);
      assert.deepEqual(await claim(fixture.plugin, fixture.editor), { ok: true });
      fixture.plugin.advanceReviewClock(400);
      if (index < CHORES.length - 1) {
        assert.match(fixture.editor.getLine(fixture.editor.getCursor().line), new RegExp(`#pre ${CHORES[index + 1]}`));
      }
    }
    assert.equal(
      notices.at(-1),
      "✓ Done · Do morning stretches! · PRE done\n]s → POST",
    );
    assert.equal(await claim(fixture.plugin, fixture.editor), null);
    }
  }
});

test("a landed [?] checklist chore is claimed and completed", async () => {
  const row = entry({ tier: "pre", line: 1, rank: 1, tierRank: 1, tierTotal: 1, text: "Blocked chore", markdown: preLine("Blocked chore", "?") });
  const fixture = makePlugin({ queue: [row], content: row.originalMarkdown });
  await land(fixture.plugin);
  assert.deepEqual(await claim(fixture.plugin, fixture.editor), { ok: true });
  assert.match(fixture.editor.getLine(0), /^- \[x\]/);
});

test("]s skips two PRE chores; Ctrl+Enter finishes PRE with the skipped count", async () => {
  const chores = ["One", "Two", "Three"];
  const queue = queueFor(chores, ["Morning review"], [{
    tier: "new", path: "Other.md", line: 1, rank: 5, tierRank: 1, tierTotal: 1,
    text: "New task", markdown: "- [ ] #task New task",
  }]);
  const fixture = makePlugin({ queue, content: queue.map((row) => row.originalMarkdown).join("\n") });
  await land(fixture.plugin, "first");
  await fixture.plugin.jumpToDueTask(1);
  await fixture.plugin.jumpToDueTask(1);
  clearNotices();
  assert.deepEqual(await claim(fixture.plugin, fixture.editor), { ok: true });
  assert.equal(
    notices.at(-1),
    "✓ Done · Three · end of PRE · 2 skipped\n]s → NEW · 3 commitments due",
  );
});

test("live successor filtering skips a stale completed row", async () => {
  const chores = ["One", "Two", "Three"];
  const queue = queueFor(chores);
  const content = queue.map((row) => row.originalMarkdown);
  content[1] = content[1].replace("[ ]", "[x]");
  const fixture = makePlugin({ queue, content: content.join("\n") });
  await land(fixture.plugin, "first");
  assert.deepEqual(await claim(fixture.plugin, fixture.editor), { ok: true });
  assert.match(fixture.editor.getLine(fixture.editor.getCursor().line), /#pre Three/);
});

test("live group filtering reads each cross-note path once", async () => {
  const fixture = makePlugin({ chores: ["Active"] });
  const remote = [preLine("Remote one"), preLine("Remote two")].join("\n");
  let reads = 0;
  fixture.plugin.app.vault.getAbstractFileByPath = (path) =>
    path === "Other.md" ? { path } : null;
  fixture.plugin.readLinkPickerNoteContent = async () => {
    reads += 1;
    return remote;
  };
  const rows = [
    entry({ tier: "pre", path: "Other.md", line: 1, rank: 1, tierRank: 1, tierTotal: 2, text: "Remote one" }),
    entry({ tier: "pre", path: "Other.md", line: 2, rank: 2, tierRank: 2, tierTotal: 2, text: "Remote two" }),
  ];
  assert.equal(
    (await fixture.plugin.filterLiveReviewEntries(rows, fixture.editor, "gtd_daily.md")).length,
    2,
  );
  assert.equal(reads, 1);
});

test("Ctrl+Enter stays in PRE while Ctrl+Alt+F still crosses into NEW", async () => {
  const queue = queueFor(["Two"], [], [{
    tier: "new", path: "gtd_daily.md", line: 3, rank: 3, tierRank: 1, tierTotal: 1,
    text: "New task", markdown: "- [ ] #task New task",
  }]);
  const content = queue.map((row) => row.originalMarkdown).join("\n");
  const ctrl = makePlugin({ queue, content });
  await land(ctrl.plugin, "first");
  clearNotices();
  assert.deepEqual(await claim(ctrl.plugin, ctrl.editor), { ok: true });
  assert.match(ctrl.editor.getLine(ctrl.editor.getCursor().line), /#pre Two/);
  assert.equal(notices.at(-1), "✓ Done · Two · PRE done\n]s → NEW · 1 commitments due");

  const advance = makePlugin({ queue, content });
  await land(advance.plugin, "first");
  clearNotices();
  assert.equal(await advance.plugin.refreshTaskFreshness(advance.editor, { advance: true, dateText: DATE }), true);
  assert.match(advance.editor.getLine(advance.editor.getCursor().line), /New task/);
});

test("POST completion walks multiple rows for Ctrl+Enter and Ctrl+Alt+F, while Alt+F stays", async () => {
  const queue = queueFor([], ["Morning review", "Write retro"]);
  const content = queue.map((row) => row.originalMarkdown).join("\n");
  const ctrl = makePlugin({ queue, content });
  await land(ctrl.plugin, "first");
  assert.deepEqual(await claim(ctrl.plugin, ctrl.editor), { ok: true });
  assert.match(ctrl.editor.getLine(ctrl.editor.getCursor().line), /Write retro/);
  assert.match(notices.at(-1), /^✓ Done · Morning review · Ctrl\+Enter → next POST\nReview 2\/2 · POST 2\/2 · closeout · 0 commitments due · 0 ROTTEN left$/);

  const alt = makePlugin({ queue, content });
  await land(alt.plugin, "first");
  assert.equal(await alt.plugin.refreshTaskFreshness(alt.editor, { dateText: DATE }), true);
  assert.equal(notices.at(-1), "✓ Done · 1 POST left");

  const chord = makePlugin({ queue, content });
  await land(chord.plugin, "first");
  assert.equal(await chord.plugin.refreshTaskFreshness(chord.editor, { dateText: DATE, advance: true }), true);
  assert.match(chord.editor.getLine(chord.editor.getCursor().line), /Write retro/);
});

test("]S and Ctrl+Enter close the final Morning review; earlier POST rows stay counted", async () => {
  const queue = queueFor([], ["Morning review"]);
  const fixture = makePlugin({ queue, content: queue[0].originalMarkdown });
  await land(fixture.plugin, "last");
  assert.deepEqual(await claim(fixture.plugin, fixture.editor), { ok: true });
  assert.equal(notices.at(-1), "Review closed — 0 ROTTEN left for later");

  const rows = queueFor([], ["Morning review", "Skipped closeout"]);
  const skipped = makePlugin({ queue: rows, content: rows.map((row) => row.originalMarkdown).join("\n") });
  await land(skipped.plugin, "last");
  assert.deepEqual(await claim(skipped.plugin, skipped.editor), { ok: true });
  assert.equal(notices.at(-1), "1 POST still due · Review closed — 0 ROTTEN left for later");
});

test("completion failure preserves cursor and landing and reports the Tasks failure", async () => {
  const queue = queueFor(["One", "Two"]);
  const fixture = makePlugin({ queue, complete: completeAtCursor({ fail: true }) });
  await land(fixture.plugin);
  const landing = fixture.plugin.reviewLanding;
  const cursor = fixture.editor.getCursor();
  assert.deepEqual(await claim(fixture.plugin, fixture.editor), { ok: false, reason: "not-completed" });
  assert.deepEqual(fixture.editor.getCursor(), cursor);
  assert.equal(fixture.plugin.reviewLanding, landing);
  assert.equal(notices.at(-1), "Not completed — not-closed");
});
