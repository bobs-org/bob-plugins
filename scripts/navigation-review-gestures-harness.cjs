// nav-gestures review auto-advance: Alt+N and Task Card commits advance
// from a landing; Ctrl+Shift+M never advances and parks the walk
// (docs/freshness.md §6).
require("./hermetic-bob-env.cjs");
const assert = require("node:assert/strict");
const Module = require("node:module");

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

function makePlugin({ rows, activePath, cursorLine = 0, areaPaths = [], notes = {} }) {
  const queueState = rows.map((row) => ({ ...row }));
  const staticContents = { ...buildNotes(queueState), ...notes };
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
    plugins: {
      plugins: {
        "bob-ledger-tools": {
          api: { version: 3, freshness, stats: { version: 1, append: async () => {} } },
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


module.exports = { notices, NavigationHotkeysPlugin, helpers, TransactionEditor, DATE, CARD_BASE_DATE, markFor, laneEntry, nextQueue, makePlugin, clearNotices, land, flushAll, priorityConfig, scheduleConfig, choosePriorityLevel, confirmCancelReasonStage };
