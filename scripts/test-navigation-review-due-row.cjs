// Alt+N due-row review advance (nav-gestures): Alt+N answers from the ]s
// landing or from any due walk row (same note and line text in the pre-write
// queue). A resolving write advances once to that row's walk successor.
// PRE/POST and RECURRING rows still stay, and every other answer key stays
// landing-gated. Ctrl+Shift+M keeps its park.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const { ModalStub } = require("./modal-harness.cjs");

global.window = global.window || { setTimeout: (callback) => callback() };

const notices = [];
class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
}

function parseTestYaml(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) {
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error("malformed yaml");
    }
    const key = match[1].trim();
    let value = match[2].trim().replace(/\s+#.*$/, "");
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value || null;
  }
  return result;
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class TestModal extends ModalStub {}
    return {
      MarkdownView: class MarkdownView {},
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: class Plugin {},
      Platform: { isDesktopApp: true },
      normalizePath: (value) => value,
      parseYaml: parseTestYaml,
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
const CARD_BASE_DATE = new Date(2026, 9, 7);

class TestEditor {
  constructor(content) {
    this.content = content;
  }
  getValue() {
    return this.content;
  }
  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }
  replaceRange(text, from, to = from) {
    const offset = (position) => {
      const newline = this.content.includes("\r\n") ? "\r\n" : "\n";
      const lines = this.content.split(/\r?\n/);
      return (
        lines
          .slice(0, position.line)
          .reduce((sum, line) => sum + line.length + newline.length, 0) +
        position.ch
      );
    };
    const start = offset(from);
    const end = offset(to);
    this.content = this.content.slice(0, start) + text + this.content.slice(end);
  }
}

class TransactionEditor extends TestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
    this.transactions = [];
    this.setCursorCalls = [];
  }
  getCursor() {
    return { ...this.cursor };
  }
  getScrollInfo() {
    return { left: 0, top: 0 };
  }
  setCursor(lineOrPosition, ch) {
    const position =
      typeof lineOrPosition === "object"
        ? lineOrPosition
        : { line: lineOrPosition, ch };
    this.cursor = { ...position };
    this.setCursorCalls.push({ ...position });
  }
  transaction(transaction) {
    this.transactions.push(JSON.parse(JSON.stringify(transaction)));
    const changes = [...(transaction.changes || [])].sort(
      (left, right) =>
        right.from.line - left.from.line || right.from.ch - left.from.ch,
    );
    for (const change of changes) {
      super.replaceRange(change.text, change.from, change.to || change.from);
    }
    if (transaction.selection) {
      this.cursor = {
        ...(transaction.selection.to || transaction.selection.from),
      };
    }
  }
}

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

function laneEntry({ tier, path = "walk.md", line, text, rank, tierRank, tierTotal }) {
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
    dueOn: DATE,
    daysOverdue: 0,
    interval: 7,
    rank,
    tierRank,
    tierTotal,
  };
}

function nextQueue(texts, path = "walk.md") {
  return texts.map((text, index) =>
    laneEntry({
      tier: "next",
      path,
      line: index + 1,
      text,
      rank: index + 1,
      tierRank: index + 1,
      tierTotal: texts.length,
    }),
  );
}

function newQueue(texts, path = "walk.md") {
  return texts.map((text, index) =>
    laneEntry({
      tier: "new",
      path,
      line: index + 1,
      text,
      rank: index + 1,
      tierRank: index + 1,
      tierTotal: texts.length,
    }),
  );
}

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
    contents[path] = lines.join("\n");
  }
  return contents;
}

function freshnessApi(queueState, journal) {
  return {
    version: 5,
    checklistTiers: true,
    queue: () => queueState.map((row) => ({ ...row })),
    counts: () => ({
      due: queueState.length,
      new: 0,
      rotten: 0,
      refreshedToday: 0,
      upkeepToday: 0,
      budget: null,
    }),
    keepLine: (line) => `${String(line)} [fresh:: ${DATE}]`,
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

// Walk fixture with optional inbox support: `inbox.rowsPath` puts the queue
// rows in an inbox note and adds a Health.md move destination, so routed
// answers run the real `commitInboxRoute` against the store.
function makePlugin({ rows, activePath, cursorLine = 0, inbox = null }) {
  const queueState = rows.map((row) => ({ ...row }));
  const staticContents = buildNotes(queueState);
  const contents = new Map(Object.entries(staticContents));
  const journal = [];
  if (inbox) {
    if (!contents.has("inbox.md")) {
      contents.set("inbox.md", ["---", 'type: "[[area]]"', "---", ""].join("\n"));
    }
    if (!contents.has("Health.md")) {
      contents.set(
        "Health.md",
        ["---", 'type: "[[area]]"', "---", "", "## Tasks", ""].join("\n"),
      );
    }
  }
  const fileMap = new Map();
  const editors = new Map();
  for (const [path, text] of contents) {
    const basename = path.split("/").pop().replace(/\.md$/i, "");
    fileMap.set(path, { path, extension: "md", basename });
    editors.set(path, new TransactionEditor(text, { line: 0, ch: 0 }));
  }
  let currentPath = activePath;
  const viewFor = (path) => ({
    file: fileMap.get(path) || null,
    editor: editors.get(path) || null,
  });
  const workspace = {
    getActiveFile: () => fileMap.get(currentPath) || null,
    getActiveViewOfType: () => viewFor(currentPath),
    getLeavesOfType: () => [],
    getLeaf: () => ({
      openFile: async (file) => {
        currentPath = file.path;
        return true;
      },
    }),
  };
  const frontmatterFor = (path) => {
    if (path === "inbox.md") {
      return { type: "[[area]]" };
    }
    if (inbox && path === inbox.rowsPath) {
      return { type: "[[area]]", parent: "[[inbox]]" };
    }
    if (inbox && path === "Health.md") {
      return { type: "[[area]]" };
    }
    return null;
  };
  const vault = {
    getAbstractFileByPath: (path) => fileMap.get(path) || null,
    getMarkdownFiles: () => [...fileMap.values()],
    cachedRead: async (file) => contents.get(file.path) ?? "",
    process: async (file, transform) => {
      contents.set(file.path, transform(contents.get(file.path) ?? ""));
    },
  };
  const metadataCache = {
    getFileCache: (file) => ({ frontmatter: frontmatterFor(file.path) }),
    getFirstLinkpathDest: (linkpath) => {
      const want = String(linkpath || "").replace(/\.md$/, "");
      return (
        [...fileMap.values()].find(
          (file) =>
            file.path.replace(/\.md$/, "") === want || file.basename === want,
        ) || null
      );
    },
  };
  const freshness = freshnessApi(queueState, journal);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: {
            version: 3,
            freshness,
            stats: {
              version: 1,
              append: async (...args) => {
                journal.push(args);
              },
            },
          },
        },
      },
    },
    workspace,
    vault,
    metadataCache,
  };
  plugin.reviewAnchor = null;
  plugin.reviewLanding = null;
  plugin.reviewWalkCurrent = null;
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
  plugin.taskMoveReviewCommitStarted = false;
  plugin.filePositions = new Map();
  plugin.findMarkdownLeafByPath = () => null;
  plugin.getOpenMarkdownEditorForPath = (path) => editors.get(path) || null;
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
    contents,
    journal,
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

async function flushAll(plugin) {
  for (let round = 0; round < 8; round += 1) {
    try {
      await plugin.vimJumpHistoryChain;
    } catch (error) {
      // History is best effort in these fixtures.
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function priorityConfig() {
  return helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        schedules: "scheduled",
        levels: [
          { label: "P1", value: "high", min_days: 2, max_days: 7 },
          { label: "P2", value: "medium", min_days: 8, max_days: 30 },
        ],
      },
    ],
  });
}

function openCard(fixture, config) {
  assert.equal(
    fixture.plugin.openBulletPropertyPicker(fixture.editor, {
      config,
      baseDate: CARD_BASE_DATE,
      random: () => 0,
    }),
    true,
  );
  const picker = fixture.plugin.activeBulletPropertyPicker;
  assert.ok(picker, "the card opened");
  assert.equal(picker.stage, "task-card");
  return picker;
}

async function choosePriorityLevel(plugin, label) {
  const picker = plugin.activeBulletPropertyPicker;
  const level = picker.taskCardModel.priorityStrip.levels.find(
    (item) => item.label === label,
  );
  assert.ok(level, `missing ${label} level`);
  await picker.dispatchTaskCardIntent({
    type: "set-priority",
    key: level.key,
    value: level.value,
  });
  return picker;
}

async function confirmSchedulingWorkLogStage(picker, summary = "") {
  assert.equal(picker.stage, "schedule-work-log");
  picker.inputEl = { value: summary };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

test("an off-landing Alt+N commit on a due NEW row advances with one composed toast", async () => {
  const fixture = makePlugin({ rows: newQueue(["One", "Two"]), activePath: "walk.md" });
  // No landing: a hand-reached due row still answers.
  fixture.editor.setCursor(1, 0);
  clearNotices();

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[1], /^- \[\*\] #task Two/);
  assert.ok(fixture.plugin.reviewLanding, "the walk lands on the successor");
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:1");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Next · 1 task/);
  assert.match(notices[0], /Review \d+\/\d+/);
  assert.ok(
    fixture.journal.some((args) => JSON.stringify(args).includes('"lane"')),
    `the answer journals lane, saw: ${JSON.stringify(fixture.journal)}`,
  );
});

test("a reworded landed row whose new text is in the queue advances", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  // Bryan reworded the landing and the queue refreshed with the new text.
  fixture.queueState[0].originalMarkdown = "- [*] #task `One`";
  fixture.queueState[0].text = "`One`";
  fixture.editor.content = ["- [*] #task `One`", "- [*] #task Two"].join("\n");
  fixture.editor.setCursor(0, 0);
  clearNotices();

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.match(notices[0], /Review \d+\/\d+/);
});

test("a task that is not due keeps today's behavior with no advance", async () => {
  clearNotices();
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  assert.equal(fixture.plugin.reviewLanding, null);
  // A task line the queue does not know: in place, no advance.
  fixture.editor.content = `${fixture.editor.content}\n- [*] #task Offqueue`;
  fixture.editor.setCursor(2, 0);

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[2], /^- \[ \] #task Offqueue/);
  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
});

test("an off-landing PRE row stays and frees the lock", async () => {
  const rows = [
    laneEntry({ tier: "next", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  // Hand-reached PRE row with no landing armed.
  fixture.editor.setCursor(1, 0);
  clearNotices();

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Next · 1 task/);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
  assert.equal(fixture.plugin.reviewWalkBusy(), false, "the lock is free after a stay");
});

test("an off-landing RECURRING row stays", async () => {
  const rows = [
    laneEntry({ tier: "next", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "recurring", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  fixture.editor.setCursor(1, 0);
  clearNotices();

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
  assert.equal(fixture.plugin.reviewWalkBusy(), false);
});

test("a landing elsewhere does not block an off-landing answer", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  assert.equal(landedKey, "walk.md:1");
  // Answer the hand-reached second row while the first row is landed.
  fixture.editor.setCursor(1, 0);

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  // The walk advanced from the answered row, wrapping to its successor.
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:1");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /Review \d+\/\d+/);
});

test("a new landing between capture and continue does not advance", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  fixture.editor.setCursor(1, 0);
  const origin = fixture.plugin.captureReviewGesture(fixture.editor, { dueRow: true });
  assert.ok(origin && origin.offLanding === true, "the due row captures");
  // A new landing (an epoch bump) owns the walk now. The gesture lock
  // expires first so the landing key is not swallowed.
  fixture.plugin.advanceReviewClock(4000);
  await land(fixture, "first");
  clearNotices();

  const result = await fixture.plugin.continueReviewWalkAfter(origin, {
    kind: "lane",
    handledRefs: [],
    notice: "→ Ready · 1 task",
  });
  await flushAll(fixture.plugin);

  assert.equal(result.advanced, false);
  assert.deepEqual(notices, ["→ Ready · 1 task"]);
});

test("an off-landing capture while busy swallows the key", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  fixture.editor.setCursor(1, 0);
  const content = fixture.editor.content;
  assert.ok(
    fixture.plugin.captureReviewGesture(fixture.editor, { dueRow: true }),
    "the first capture takes the lock",
  );

  assert.equal(await fixture.plugin.toggleTaskLane(fixture.editor), false);
  await flushAll(fixture.plugin);

  assert.equal(fixture.editor.content, content);
  assert.deepEqual(notices, []);
  fixture.plugin.advanceReviewClock(4000);
  assert.equal(fixture.plugin.reviewWalkBusy(), false);
});

test("counted Alt+N off a landing advances past every handled key", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two", "Three"]),
    activePath: "walk.md",
  });
  fixture.editor.setCursor(0, 0);
  clearNotices();

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, {
      skipReleasePrompt: true,
      countExplicit: true,
      additionalTaskCount: 1,
    }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:3");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Ready · 2 tasks/);
});

test("the public api capture stays landing-only off a landing", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  fixture.editor.setCursor(1, 0);
  clearNotices();

  assert.equal(fixture.plugin.api.reviewWalk.capture(fixture.editor), null);
  // The direct capture without `dueRow` stays landing-only too.
  assert.equal(fixture.plugin.captureReviewGesture(fixture.editor), null);
});

test("a Task Card commit off a landing still stays", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  assert.equal(fixture.plugin.reviewLanding, null);
  const picker = openCard(fixture, priorityConfig());

  await choosePriorityLevel(fixture.plugin, "P1");
  await confirmSchedulingWorkLogStage(picker, "");
  await flushAll(fixture.plugin);

  assert.match(
    fixture.editor.content.split("\n")[0],
    /\[scheduled:: 2026-10-09\]/,
    "the commit wrote a future scheduled date",
  );
  assert.equal(fixture.plugin.reviewLanding, null);
  assert.ok(notices.length >= 1, `the rich card only, saw: ${JSON.stringify(notices)}`);
  assert.ok(
    notices.every((notice) => !/Review \d+\/\d+/.test(notice)),
    `no landing toast, saw: ${JSON.stringify(notices)}`,
  );
});

test("a routed Alt+N on a due inbox row advances with a route toast and journals route", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "mac_inbox.md"),
    activePath: "mac_inbox.md",
    inbox: { rowsPath: "mac_inbox.md" },
  });
  await land(fixture, "first");
  // Answer the hand-reached second inbox row; the route picker is stubbed
  // to move while the commit runs the real move engine.
  fixture.plugin.promptInboxRoute = async () => ({
    kind: "move",
    path: "Health.md",
    name: "Health",
  });
  fixture.editor.setCursor(1, 0);
  clearNotices();

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.ok(!String(fixture.editor.getValue()).includes("Two"));
  // The destination has an open editor in this fixture, so the move lands
  // there rather than in the vault snapshot.
  assert.match(
    fixture.editors.get("Health.md").getValue(),
    /- \[ \] #task Two/,
  );
  assert.ok(fixture.plugin.reviewLanding, "the walk lands on the successor");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.match(notices[0], /Moved to Health/);
  assert.match(notices[0], /Review \d+\/\d+/);
  assert.ok(
    fixture.journal.some((args) => JSON.stringify(args).includes("route")),
    `the answer journals route, saw: ${JSON.stringify(fixture.journal)}`,
  );
});
