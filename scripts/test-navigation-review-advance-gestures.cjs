// nav-gestures review auto-advance: Alt+N commit/release, Task Card
// committing stages, and Ctrl+Shift+M move advance from a landing
// (docs/freshness.md §6).
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

function freshnessApi(queueState) {
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

function makePlugin({ rows, activePath, cursorLine = 0, areaPaths = [] }) {
  const queueState = rows.map((row) => ({ ...row }));
  const staticContents = buildNotes(queueState);
  const contents = new Map(Object.entries(staticContents));
  const fileMap = new Map();
  const editors = new Map();
  for (const [path, text] of contents) {
    const basename = path.split("/").pop().replace(/\.md$/i, "");
    fileMap.set(path, { path, extension: "md", basename });
    editors.set(path, new TransactionEditor(text, { line: 0, ch: 0 }));
  }
  // Destination-only area notes carry no queue rows. They need real YAML
  // frontmatter or the move commit refuses them.
  for (const path of areaPaths) {
    if (!fileMap.has(path)) {
      const basename = path.split("/").pop().replace(/\.md$/i, "");
      fileMap.set(path, { path, extension: "md", basename });
      contents.set(path, `---\ntype: "[[area]]"\n---\n# ${basename}\n`);
    }
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
  const vault = {
    getAbstractFileByPath: (path) => fileMap.get(path) || null,
    getMarkdownFiles: () => [...fileMap.values()],
    cachedRead: async (file) => contents.get(file.path) ?? "",
    process: async (file, transform) => {
      contents.set(file.path, transform(contents.get(file.path) ?? ""));
    },
  };
  const metadataCache = {
    getFileCache: (file) =>
      areaPaths.includes(file.path)
        ? { frontmatter: { type: "[[area]]" } }
        : null,
  };
  const freshness = freshnessApi(queueState);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    plugins: { plugins: { "bob-ledger-tools": { api: { version: 3, freshness } } } },
    workspace,
    vault,
    metadataCache,
  };
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

function scheduleConfig() {
  return helpers.validateBulletPropertyConfig({
    properties: [
      { name: "scheduled", values: "date" },
      {
        name: "priority",
        values: "priority",
        levels: [{ label: "P1", value: "high", min_days: 1, max_days: 3 }],
      },
    ],
  });
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

// Complete the cancel reason-stage prompt through the same openItemAtIndex
// entry point production code uses.
async function confirmCancelReasonStage(picker, reasonText = "") {
  assert.equal(picker.stage, "cancel-reason");
  picker.inputEl = { value: reasonText };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

test("Alt+N release from a NEXT landing advances with one composed toast", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const before = fixture.plugin.reviewLanding.key;

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[0], /^- \[ \] #task One/);
  assert.notEqual(fixture.plugin.reviewLanding.key, before);
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /→ Ready · 1 task/);
  assert.match(notices[0], /Review \d+\/\d+/);
});

test("counted Alt+N lands past every handled key in one jump", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two", "Three"]),
    activePath: "walk.md",
  });
  await land(fixture, "first");

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

test("a cancelled Alt+N release prompt stays and frees the lock", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  // A Pending release asks for a Work Log summary; refuse it here.
  fixture.queueState[0].tier = "pending";
  fixture.queueState[0].originalMarkdown = markFor("pending", "One");
  fixture.editors.get("walk.md").content = fixture.queueState
    .map((row) => row.originalMarkdown)
    .join("\n");
  fixture.plugin.reviewLanding = null;
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  fixture.plugin.requestLaneReleaseSummary = async () => ({ cancelled: true, summary: "" });

  assert.equal(await fixture.plugin.toggleTaskLane(fixture.editor), false);
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.deepEqual(notices, []);
  assert.ok(
    fixture.plugin.captureReviewGesture(fixture.editor),
    "the lock is free after a cancel",
  );
});

test("Alt+N on a checklist landing stays with the plain notice", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
});

test("Alt+N off a landing behaves exactly as today", async () => {
  clearNotices();
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  assert.equal(fixture.plugin.reviewLanding, null);

  assert.equal(
    await fixture.plugin.toggleTaskLane(fixture.editor, { skipReleasePrompt: true }),
    true,
  );
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[0], /^- \[ \] #task One/);
  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /→ Ready · 1 task/);
});

test("Alt+N while the gesture lock is held is swallowed", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const content = fixture.editor.content;
  assert.ok(fixture.plugin.captureReviewGesture(fixture.editor), "capture takes the lock");

  assert.equal(await fixture.plugin.toggleTaskLane(fixture.editor), false);
  await flushAll(fixture.plugin);

  assert.equal(fixture.editor.content, content);
  assert.deepEqual(notices, []);
});

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

async function confirmSchedulingWorkLogStage(picker, summary = "") {
  assert.equal(picker.stage, "schedule-work-log");
  picker.inputEl = { value: summary };
  picker.visibleItems = picker.getFilteredItems();
  return await picker.openItemAtIndex(0);
}

async function runCardAction(picker, rowId) {
  assert.equal(picker.stage, "task-card");
  const row = picker.taskCardModel.rows.find((item) => item.id === rowId);
  assert.ok(row, `missing ${rowId} card row`);
  assert.equal(row.enabled, true, `${rowId} card row is disabled`);
  return await picker.dispatchTaskCardIntent({
    type: "open-action",
    rowId,
    action: row.action,
  });
}

async function confirmScheduleReviewStage(picker, reasonText = "") {
  assert.equal(picker.stage, "schedule-review");
  if (picker.scheduleReviewReasonEl) {
    picker.scheduleReviewReasonEl.value = reasonText;
  }
  picker.visibleItems = picker.getFilteredItems();
  const applied = await picker.confirmScheduleReview();
  if (applied === true) {
    picker.close();
  }
  return applied;
}

test("a Task Card priority commit on NEXT advances, landing after the rich card", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const picker = openCard(fixture, priorityConfig());

  await choosePriorityLevel(fixture.plugin, "P1");
  await confirmSchedulingWorkLogStage(picker, "");
  await flushAll(fixture.plugin);

  assert.match(
    fixture.editor.content.split("\n")[0],
    /\[scheduled:: 2026-10-09\]/,
    "the commit rolled a future scheduled date",
  );
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.equal(
    notices.length,
    2,
    `rich card plus landing toast, saw: ${JSON.stringify(notices)}`,
  );
  assert.match(notices[1], /Review \d+\/\d+/);
});

test("dismissing the Task Card stays and frees the lock", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  const picker = openCard(fixture, priorityConfig());

  picker.close();
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.deepEqual(notices, []);
  assert.ok(
    fixture.plugin.captureReviewGesture(fixture.editor),
    "the lock is free after Esc",
  );
});

test("a frontmatter-only project edit from the card stays", async () => {
  const fixture = makePlugin({ rows: nextQueue(["One", "Two"]), activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  const picker = openCard(fixture, priorityConfig());

  const lines = fixture.editor.content.split("\n");
  lines[1] = `${lines[1]} [project:: Areas]`;
  fixture.editor.content = lines.join("\n");
  picker.close();
  await flushAll(fixture.plugin);

  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.deepEqual(notices, []);
});

test("a same-day priority schedule on a checklist row stays", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  // scheduleConfig P1 rolls min 1 day from the Oct 7 base: Oct 8 is today,
  // not the future, so the write stays on a checklist row.
  const picker = openCard(fixture, scheduleConfig());

  await choosePriorityLevel(fixture.plugin, "P1");
  if (picker.stage === "schedule-work-log") {
    await confirmSchedulingWorkLogStage(picker, "");
  }
  await flushAll(fixture.plugin);

  assert.match(
    fixture.editor.content.split("\n")[0],
    /\[priority:: high\] \[scheduled:: 2026-10-08\]/,
    "the priority write landed without a future schedule",
  );
  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.equal(
    fixture.plugin.reviewWalkBusy(),
    false,
    "the lock is free after a stay",
  );
});

test("a future schedule on a checklist row advances", async () => {
  const rows = [
    laneEntry({ tier: "pre", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const picker = openCard(fixture, scheduleConfig());

  await runCardAction(picker, "schedule");
  const dateIndex = picker.visibleItems.findIndex(
    (item) => item.label === "In 2 days",
  );
  assert.notEqual(dateIndex, -1, "a future date is offered");
  await picker.openItemAtIndex(dateIndex);
  await confirmScheduleReviewStage(picker, "");
  await flushAll(fixture.plugin);

  assert.match(
    fixture.editor.content.split("\n")[0],
    /\[scheduled:: 2026-10-09\]/,
    "the commit wrote a future scheduled date",
  );
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.ok(notices.length >= 1, `a landing toast follows, saw: ${JSON.stringify(notices)}`);
  assert.match(notices.at(-1), /Review \d+\/\d+/);
});

function plainPreRow(line, text, total) {
  // A non-recurring checklist row: the tier is what makes it a checklist
  // row, and a plain `- [ ]` keeps the card's cancel row enabled.
  const row = laneEntry({ tier: "pre", line, text, rank: line, tierRank: line, tierTotal: total });
  row.originalMarkdown = `- [ ] #task ${text}`;
  return row;
}

test("a Task Card cancel on a checklist row advances with the cancel card first", async () => {
  const rows = [plainPreRow(1, "One", 2), plainPreRow(2, "Two", 2)];
  const fixture = makePlugin({ rows, activePath: "walk.md" });
  await land(fixture, "first");
  const picker = openCard(fixture, scheduleConfig());

  await runCardAction(picker, "cancel");
  await confirmCancelReasonStage(picker, "too late");
  await flushAll(fixture.plugin);

  assert.match(fixture.editor.content.split("\n")[0], /^- \[-\]/);
  assert.equal(fixture.plugin.reviewLanding.key, "walk.md:2");
  assert.equal(
    notices.length,
    2,
    `cancel card then landing toast, saw: ${JSON.stringify(notices)}`,
  );
  assert.match(notices[0], /Cancelled/);
  assert.match(notices[1], /Review \d+\/\d+/);
});

function openMovePicker(fixture) {
  assert.equal(fixture.plugin.openTaskMoveDestinationPicker(fixture.editor), true);
  const picker = fixture.plugin.activeTaskMoveDestinationPicker;
  assert.ok(picker, "the move picker opened");
  return picker;
}

test("Ctrl+Shift+M from a landing advances instead of focusing the destination", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const focusCalls = [];
  fixture.plugin.focusTaskMoveDestination = async (...args) => {
    focusCalls.push(args);
    return true;
  };
  const picker = openMovePicker(fixture);
  assert.ok(picker.session.reviewOrigin, "the session carries the origin");

  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);

  assert.equal(focusCalls.length, 0, "the destination is not focused");
  assert.doesNotMatch(fixture.editor.content, /#task One/);
  assert.equal(fixture.plugin.reviewLanding.key, "Source.md:2");
  assert.equal(notices.length, 1, `one composed toast, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /Moved 1 task to Area/);
  assert.match(notices[0], /Review \d+\/\d+/);
});

test("Ctrl+Shift+M from a checklist landing keeps the destination focus", async () => {
  const rows = [
    laneEntry({ tier: "pre", path: "Source.md", line: 1, text: "One", rank: 1, tierRank: 1, tierTotal: 2 }),
    laneEntry({ tier: "pre", path: "Source.md", line: 2, text: "Two", rank: 2, tierRank: 2, tierTotal: 2 }),
  ];
  const fixture = makePlugin({
    rows,
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const landedKey = fixture.plugin.reviewLanding.key;
  const focusCalls = [];
  fixture.plugin.focusTaskMoveDestination = async (...args) => {
    focusCalls.push(args);
    return true;
  };
  const picker = openMovePicker(fixture);

  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);

  assert.equal(focusCalls.length, 1, "the destination is focused");
  assert.equal(fixture.plugin.reviewLanding.key, landedKey);
  assert.equal(notices.length, 1, `the plain notice only, saw: ${JSON.stringify(notices)}`);
  assert.match(notices[0], /Moved 1 task to Area/);
  assert.doesNotMatch(notices[0], /Review \d+\/\d+/);
});

test("dismissing the move picker frees the lock", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  await land(fixture, "first");
  const picker = openMovePicker(fixture);

  picker.close();
  await flushAll(fixture.plugin);

  assert.deepEqual(notices, []);
  const recapture = fixture.plugin.captureReviewGesture(fixture.editor);
  assert.ok(recapture && !recapture.busy, "the lock is free after dismiss");
});

test("Ctrl+Shift+M off a landing behaves exactly as today", async () => {
  const fixture = makePlugin({
    rows: nextQueue(["One", "Two"], "Source.md"),
    activePath: "Source.md",
    areaPaths: ["Area.md"],
  });
  assert.equal(fixture.plugin.reviewLanding, null);
  const focusCalls = [];
  fixture.plugin.focusTaskMoveDestination = async (...args) => {
    focusCalls.push(args);
    return true;
  };
  const picker = openMovePicker(fixture);
  assert.equal(picker.session.reviewOrigin, null);

  await picker.openItemAtIndex(0);
  await flushAll(fixture.plugin);

  assert.equal(focusCalls.length, 1);
  assert.equal(fixture.plugin.reviewLanding, null);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Moved 1 task to Area/);
});
