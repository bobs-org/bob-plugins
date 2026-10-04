const assert = require("node:assert/strict");

const Module = require("node:module");

const path = require("node:path");

const { ModalStub } = require("./modal-harness.cjs");

global.window = global.window || { setTimeout: (callback) => callback() };

const notices = [];

const originalLoad = Module._load;
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

Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestModal extends ModalStub {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: TestModal,
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: parseTestYaml,
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

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
  constructor(content, cursor, scrollTop = 640) {
    super(content);
    this.cursor = { ...cursor };
    this.scrollTop = scrollTop;
    this.transactions = [];
    this.transactionScrollTops = [];
    this.setCursorCalls = [];
    this.undoGroups = 0;
  }
  getCursor() {
    return { ...this.cursor };
  }
  getScrollInfo() {
    return { left: 0, top: this.scrollTop };
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
    this.transactionScrollTops.push(this.scrollTop);
    this.transactions.push(JSON.parse(JSON.stringify(transaction)));
    if (transaction.changes && transaction.changes.length > 0) {
      this.undoGroups += 1;
    }
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

function vimTransactionEditor(content, cursor, options = {}) {
  const editor = new TransactionEditor(content, cursor, 512);
  const inputState = {
    keyBuffer: [],
    prefixRepeat: [],
    motionRepeat: [],
    reason: "",
    getRepeat: () => null,
    ...(options.inputState || {}),
  };
  const cm = {
    state: {
      vim: {
        mode: options.mode || "normal",
        inputState,
      },
    },
    getCursor: () => editor.getCursor(),
  };
  editor.cm = { cm };
  editor.vimInputState = inputState;
  return editor;
}

class RecordingFallbackEditor extends TestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
    this.events = [];
    this.replaceCalls = [];
    this.setCursorCalls = [];
  }
  getCursor() {
    return { ...this.cursor };
  }
  replaceRange(text, from, to = from) {
    this.events.push(`replace:${from.line}`);
    this.replaceCalls.push({
      text,
      from: { ...from },
      to: { ...to },
    });
    super.replaceRange(text, from, to);
  }
  setCursor(lineOrPosition, ch) {
    const position =
      typeof lineOrPosition === "object"
        ? lineOrPosition
        : { line: lineOrPosition, ch };
    this.events.push("cursor");
    this.cursor = { ...position };
    this.setCursorCalls.push({ ...position });
  }
}

function compatibleTasksSettings() {
  return {
    globalFilter: "#task",
    statusSettings: {
      coreStatuses: [],
      customStatuses: [
        {
          symbol: "?",
          name: "Blocked",
          nextStatusSymbol: " ",
          availableAsCommand: true,
          type: "ON_HOLD",
        },
      ],
    },
  };
}

function assertLineBoundedTransaction(transaction, originalLines, changedLines) {
  assert.deepEqual(
    transaction.changes.map((change) => change.from.line),
    changedLines,
  );
  for (const change of transaction.changes) {
    assert.deepEqual(change.from, { line: change.from.line, ch: 0 });
    assert.deepEqual(change.to, {
      line: change.from.line,
      ch: originalLines[change.from.line].length,
    });
    assert.doesNotMatch(change.text, /[\r\n]/);
  }
}

function createTaskMovePickerHarness() {
  const sourceFile = {
    path: "Source.md",
    basename: "Source",
    extension: "md",
  };
  const destinationFile = {
    path: "Area.md",
    basename: "Area",
    extension: "md",
  };
  const editor = new TransactionEditor(
    [
      "- [ ] #task One ^one",
      "- [ ] #task Two ^two",
      "- [ ] #task Three ^three",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const view = { editor, file: sourceFile };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    metadataCache: {
      getFileCache: (file) =>
        file.path === destinationFile.path
          ? { frontmatter: { type: "[[area]]" } }
          : null,
    },
    vault: {
      getMarkdownFiles: () => [sourceFile, destinationFile],
    },
  };
  plugin.commitTaskMoveSession = async () => true;
  return { editor, plugin, view };
}

function createPomodoroMovePickerHarness(harnessOptions = {}) {
  const sourceFile = {
    path: "Daily/2026-08-26.md",
    basename: "2026-08-26",
    extension: "md",
  };
  const editor = new TransactionEditor(
    harnessOptions.content || pomodoroFixtureLines().join("\n"),
    harnessOptions.cursor || { line: 5, ch: 0 },
  );
  const view = { editor, file: sourceFile };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {};
  plugin.getActiveMarkdownView = () => view;
  return { editor, plugin, sourceFile, view };
}

function createTaskMoveDestinationFocusHarness(options = {}) {
  const plugin = new NavigationHotkeysPlugin();
  const captureCalls = [];
  plugin.captureActiveFilePosition = () => {
    captureCalls.push(true);
    return true;
  };
  const openCalls = [];
  plugin.openMarkdownFileWithLeafReuse = async (file, failureNotice) => {
    openCalls.push({ file, failureNotice });
    return options.openResult === undefined ? true : options.openResult;
  };
  plugin.getActiveMarkdownView =
    options.getActiveMarkdownView || (() => null);
  return { plugin, captureCalls, openCalls };
}

function createBulletPropertyPickerHarness(harnessOptions = {}) {
  const editor = new TransactionEditor(
    harnessOptions.content ||
      [
        "- [ ] #task One ^one",
        "- [ ] #task Two ^two",
        "- [ ] #task Three ^three",
      ].join("\n"),
    harnessOptions.cursor || { line: 0, ch: 0 },
  );
  const file = harnessOptions.file || {
    path: "Tasks.md",
    basename: "Tasks",
    extension: "md",
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = harnessOptions.app || {};
  plugin.getActiveMarkdownView = () => ({ editor, file });
  const config =
    harnessOptions.config ||
    helpers.validateBulletPropertyConfig({
      properties: [{ name: "p", values: ["high"] }],
    });
  const open = (options = {}) =>
    plugin.openBulletPropertyPicker(editor, {
      config,
      random: options.random || harnessOptions.random,
      baseDate: options.baseDate || harnessOptions.baseDate,
      ...options,
    });
  return { config, editor, file, open, plugin };
}

function createPriorityPickerConfig() {
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
          { label: "P3", value: "low", min_days: 31, max_days: 90 },
          { label: "P4", value: "lowest", min_days: 91, max_days: 365 },
        ],
      },
    ],
  });
}

// The Task Card is the only surface: a priority level is chosen from its
// strip (keys 1-4), not from a property list.
async function choosePriorityLevel(harness, label, openOptions = {}) {
  assert.equal(harness.open(openOptions), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
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

function createFragmentNode(tag = "fragment", spec = {}) {
  const node = {
    tag,
    attrs: {},
    classes: [],
    children: [],
    text: "",
    classList: {
      add: (...classes) => {
        for (const cls of classes.flatMap((item) =>
          String(item || "").split(/\s+/),
        )) {
          if (cls && !node.classes.includes(cls)) {
            node.classes.push(cls);
          }
        }
      },
    },
    createDiv(childSpec = {}) {
      return createFragmentChild(node, "div", childSpec);
    },
    createSpan(childSpec = {}) {
      return createFragmentChild(node, "span", childSpec);
    },
    appendText(text) {
      const child = createFragmentNode("text");
      child.text = String(text);
      node.children.push(child);
      node.text += child.text;
    },
    setText(text) {
      node.children = [];
      node.text = "";
      node.appendText(text);
    },
    setAttr(name, value) {
      node.attrs[name] = String(value);
    },
  };
  applyFragmentSpec(node, spec);
  return node;
}

function createFragmentChild(parent, tag, spec) {
  const child = createFragmentNode(tag, spec);
  parent.children.push(child);
  return child;
}

function applyFragmentSpec(node, spec) {
  if (typeof spec === "string") {
    node.classList.add(spec);
    return;
  }
  if (!spec || typeof spec !== "object") {
    return;
  }
  if (spec.cls) {
    node.classList.add(spec.cls);
  }
  if (spec.attr) {
    for (const [name, value] of Object.entries(spec.attr)) {
      node.setAttr(name, value);
    }
  }
  if (spec.text !== undefined) {
    node.setText(spec.text);
  }
}

function findFragmentNode(node, predicate) {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findFragmentNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

function collectFragmentNodes(node, predicate, matches = []) {
  if (predicate(node)) {
    matches.push(node);
  }
  for (const child of node.children || []) {
    collectFragmentNodes(child, predicate, matches);
  }
  return matches;
}

function nodeHasClass(className) {
  return (node) => node.classes && node.classes.includes(className);
}

// A property's value stage, opened the way the Task Card opens it: the
// schedule row for `scheduled`, a More row for every other property.
async function openPropertyStage(picker, propertyName) {
  assert.equal(picker.stage, "task-card");
  await picker.openTaskCardProperty(propertyName);
  assert.equal(picker.stage, "value", `${propertyName} did not open a value stage`);
  return picker;
}

async function openBulletPropertyValueStage(harness, propertyName, options = {}) {
  assert.equal(harness.open(options), true);
  const picker = harness.plugin.activeBulletPropertyPicker;
  return await openPropertyStage(picker, propertyName);
}

// One of the card's action rows (schedule, depends-on, review-every, cancel,
// lane), dispatched the way a keypress or click dispatches it.
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

function findPropertyItem(picker, propertyName) {
  return picker.propertyItems.find(
    (item) =>
      item && item.kind === "property" && item.property.name === propertyName,
  );
}

// Complete the combined schedule review (Reason plus optional Work summary)
// the way Enter does: confirm, and close when the commit applied.
async function confirmScheduleReasonStage(picker, reasonText = "", summaryText) {
  assert.equal(picker.stage, "schedule-review");
  if (picker.scheduleReviewReasonEl) {
    picker.scheduleReviewReasonEl.value = reasonText;
  }
  if (summaryText !== undefined && picker.scheduleReviewSummaryEl) {
    picker.scheduleReviewSummaryEl.value = summaryText;
  }
  picker.visibleItems = picker.getFilteredItems();
  const applied = await picker.confirmScheduleReview();
  if (applied === true) {
    picker.close();
  }
  return applied;
}

function buildScheduleReasonConfig() {
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

// A bare picker on one task, opened straight onto the schedule value stage
// (the stage the card's schedule row opens). Nothing is painted until a stage
// needs chrome, so these tests exercise state and items, not layout.

function pomodoroFixtureLines() {
  return [
    "## Pomodoros",
    "- [x] (**0855-0920** [t:: 25m])",
    "\t- ~~[[#^gtd]]~~",
    "\t- 🍅 [[dev#^lower-athena-disk-use]]",
    "- [ ] (**0920-0950** [t:: 30m])",
    "\t- [[bob#^move-pomodoros]]",
    "- [ ] ()",
    "\t- [[sase#^pager]]",
    "\t\t- [[sase-tj#^nested]]",
    "- [ ] () — BODY",
    "\t- [[body#^email-jenika]]",
    "- [ ] () — VERIFY",
    "\t- [[sase_better_config#^no-focus-xprompts]]",
    "## Not Pomodoros",
  ];
}

function countedPomodoroReorderLines() {
  return [
    "# Daily",
    "Intro prose stays put",
    "## Pomodoros",
    "- [x] (**0800-0830** [t:: 30m])",
    "\t- closed child",
    "- [ ] () — BODY",
    "\t- [[body#^one]]",
    "\t- [[body#^two]]",
    "\t\t- nested under two",
    "",
    "- [ ] () — NEXT",
    "\t- [[next#^only]]",
    "stray prose between NEXT and THEN",
    "- [ ] () — THEN",
    "- [ ] () — LAST",
    "\t- [[last#^a]]",
    "\t- [[last#^b]]",
    "\t- [[last#^c]]",
    "## Tasks",
    "- [ ] #task After section",
    "## Pomodoros",
    "- [ ] () — OTHER SECTION",
  ];
}

function currentPomodoroSwapLines() {
  return [
    "## Pomodoros",
    "- [x] (**0850-0920** [t:: 30m]) — FINISHED",
    "  - completed work",
    "- [ ] (**0920-0950** [t:: 30m]) — ALPHA",
    "  - [[Tasks#^alpha]]",
    "- [ ] () — BETA",
    "  - [[Tasks#^beta]]",
  ];
}

function currentPomodoroSwappedLines() {
  return [
    "## Pomodoros",
    "- [x] (**0850-0920** [t:: 30m]) — FINISHED",
    "  - completed work",
    "- [ ] (**0920-0950** [t:: 30m]) — BETA",
    "  - [[Tasks#^beta]]",
    "- [ ] () — ALPHA",
    "  - [[Tasks#^alpha]]",
  ];
}

function countedCurrentPomodoroSwapLines() {
  return [
    "## Pomodoros",
    "- [ ] (**0900-0930** [t:: 30m]) — A",
    "- [ ] (  ) — B",
    "- [ ] () — C",
  ];
}

function parseFrontmatterFromContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] || "")) {
    return {};
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^---\s*$/.test(lines[index])) {
      closing = index;
      break;
    }
  }
  if (closing === -1) {
    return {};
  }
  return parseTestYaml(lines.slice(1, closing).join("\n"));
}

function createLinkPickerEnergyConfig() {
  return helpers.validateBulletPropertyConfig({
    properties: [
      { name: "energy", values: ["high", "low"] },
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
      { name: "dependsOn", values: "local_task_id" },
    ],
  });
}

function createLinkPickerHarness(harnessOptions = {}) {
  const notes = { ...(harnessOptions.notes || {}) };
  const linkPath = harnessOptions.linkPath || "Plan.md";
  const linkEditor = new TransactionEditor(
    harnessOptions.linkContent ?? "- [[Tasks#^a1]]",
    harnessOptions.cursor || { line: 0, ch: 0 },
  );
  const openEditors = new Map([[linkPath, linkEditor]]);
  for (const [path, editor] of Object.entries(
    harnessOptions.openEditors || {},
  )) {
    openEditors.set(path, editor);
  }
  const files = new Map();
  for (const path of new Set([linkPath, ...Object.keys(notes)])) {
    files.set(path, {
      path,
      basename: path.split("/").pop(),
      extension: "md",
    });
  }
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      cachedRead: async (file) => {
        if (!file || !(file.path in notes)) {
          throw new Error(`missing file: ${file && file.path}`);
        }
        return notes[file.path];
      },
      read: async (file) => notes[file.path],
      process: async (file, fn) => {
        const before = notes[file.path];
        const after = fn(before);
        notes[file.path] = after;
      },
      getMarkdownFiles: () => [...files.values()],
    },
    metadataCache: {
      getFirstLinkpathDest: (lookup) => {
        const text = String(lookup || "").replace(/\.md$/i, "");
        if (files.has(`${text}.md`)) {
          return files.get(`${text}.md`);
        }
        if (files.has(text)) {
          return files.get(text);
        }
        const base = text.split("/").pop().toLowerCase();
        const matches = [...files.values()].filter(
          (file) =>
            file.basename.toLowerCase() === base ||
            file.basename.toLowerCase() === `${base}.md`,
        );
        return matches.length === 1 ? matches[0] : null;
      },
    },
    workspace: {
      getLeavesOfType: (type) =>
        type === "markdown"
          ? [...openEditors.entries()].map(([path, editor]) => ({
              view: { file: files.get(path), editor },
            }))
          : [],
    },
  };
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  plugin.getActiveMarkdownView = () => ({
    editor: linkEditor,
    file: files.get(linkPath),
  });
  const config = harnessOptions.config || createLinkPickerEnergyConfig();
  const open = (options = {}) =>
    plugin.openLinkPicker(linkEditor, {
      config,
      baseDate: new Date(2026, 7, 3),
      random: () => 0,
      ...options,
    });
  return { notes, files, linkEditor, openEditors, plugin, linkPath, config, open };
}

module.exports = {
  notices,
  parseTestYaml,
  NavigationHotkeysPlugin,
  helpers,
  TestEditor,
  TransactionEditor,
  vimTransactionEditor,
  RecordingFallbackEditor,
  compatibleTasksSettings,
  assertLineBoundedTransaction,
  createTaskMovePickerHarness,
  createPomodoroMovePickerHarness,
  createTaskMoveDestinationFocusHarness,
  createBulletPropertyPickerHarness,
  createPriorityPickerConfig,
  choosePriorityLevel,
  createFragmentNode,
  createFragmentChild,
  applyFragmentSpec,
  findFragmentNode,
  collectFragmentNodes,
  nodeHasClass,
  openPropertyStage,
  openBulletPropertyValueStage,
  runCardAction,
  findPropertyItem,
  confirmScheduleReasonStage,
  buildScheduleReasonConfig,
  pomodoroFixtureLines,
  countedPomodoroReorderLines,
  currentPomodoroSwapLines,
  currentPomodoroSwappedLines,
  countedCurrentPomodoroSwapLines,
  parseFrontmatterFromContent,
  createLinkPickerEnergyConfig,
  createLinkPickerHarness,
};
