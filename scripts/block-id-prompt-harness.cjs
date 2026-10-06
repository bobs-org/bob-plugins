const assert = require("node:assert/strict");
const Module = require("node:module");

const noticeMessages = [];
let obsidianStubs = null;

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class NoticeStub {
      constructor(message) {
        noticeMessages.push(message);
      }
    }
    obsidianStubs = {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: NoticeStub,
      normalizePath: (value) =>
        String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
      Plugin: EmptyClass,
      Setting: EmptyClass,
      TFile: EmptyClass,
      setIcon: () => {},
    };
    return obsidianStubs;
  }
  if (request === "@codemirror/view") {
    class EditorView {}
    EditorView.updateListener = { of: (callback) => ({ callback }) };
    return { EditorView };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Plugin = require("../plugins/block-id-prompt/main.js");
Module._load = originalLoad;
const { helpers } = Plugin;

function resetNotices() {
  noticeMessages.length = 0;
}

function lastNotice() {
  return noticeMessages[noticeMessages.length - 1];
}

function localDate(year, month, day) {
  return new Date(year, month - 1, day);
}

const WORK_LOG_DATE = { year: 2026, month: 8, day: 15 };

function createEditor(content) {
  let value = content;
  let cursor = null;

  function positionToIndex(position) {
    let index = 0;
    for (let line = 0; line < position.line; line += 1) {
      const newline = value.indexOf("\n", index);
      assert.notEqual(newline, -1);
      index = newline + 1;
    }

    return index + position.ch;
  }

  return {
    getLine(line) {
      return value.split("\n")[line] || "";
    },
    getValue() {
      return value;
    },
    replaceRange(replacement, from, to = from) {
      const start = positionToIndex(from);
      const end = positionToIndex(to);
      value = value.slice(0, start) + replacement + value.slice(end);
    },
    setCursor(nextCursor) {
      cursor = nextCursor;
    },
    getCursor() {
      return cursor;
    },
    listSelections() {
      return cursor ? [{ anchor: cursor, head: cursor }] : [];
    },
    get cursor() {
      return cursor;
    },
  };
}

function applyPlannedEdits(content, edits) {
  let result = content;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result =
      result.slice(0, edit.start) +
      edit.replacement +
      result.slice(edit.end);
  }
  return result;
}

function sourceForTaskPicker(editor, sourcePath, line) {
  const lineText = editor.getLine(line);
  const cursorCh = lineText.lastIndexOf("^^") + 2;
  const marker = helpers.findTaskPickerMarkerNearCursor(lineText, cursorCh);
  assert.ok(marker);
  return { ...marker, editor, sourcePath, line };
}

function sourceForPomodoroLink(editor, sourcePath, line) {
  const lineText = editor.getLine(line);
  const task = helpers.findDirectPomodoroLinkTask(lineText, line);
  assert.ok(task);
  return { kind: "link-task-pomodoro", editor, sourcePath, line, task: { ...task } };
}

function createTFile(path) {
  const file = new obsidianStubs.TFile();
  file.path = path;
  file.extension = path.split(".").pop();
  return file;
}

function createMarkdownView(file) {
  const view = new obsidianStubs.MarkdownView();
  view.file = file;
  return view;
}

function createTaskModeHarness({ taskContent, dailyContent, taskPath = "Tasks.md", dailyPath = "Daily.md" }) {
  resetNotices();
  const editor = createEditor(taskContent);
  editor.setCursor({ line: 0, ch: 4 });
  const file = createTFile(taskPath);
  const view = createMarkdownView(file);
  const writes = [];
  const plugin = new Plugin();
  plugin.app = {
    workspace: { getActiveViewOfType: () => view, getActiveFile: () => file },
    vault: {
      read: async (target) => (target.path === dailyPath ? dailyContent : null),
      modify: async (target, content) => {
        writes.push({ path: target.path, content });
      },
    },
    metadataCache: {
      fileToLinktext: (entry) => entry.path.replace(/\.md$/, ""),
    },
  };
  plugin.resolveTaskFile = (path) => (path === taskPath ? { path: taskPath } : null);
  plugin.resolveTodayDailyFile = () => (dailyPath ? { path: dailyPath } : null);
  plugin.resolveReferenceDestination = (reference) =>
    reference.targetText === "Tasks" ? { path: "Tasks.md" } : null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);
  return { plugin, editor, file, view, writes };
}

const LINKED_DAILY = [
  "## Pomodoros",
  "- [ ] Current (10:00-10:25)",
  "  - [[Tasks#^ship]]",
].join("\n");

const UNLINKED_DAILY = ["## Pomodoros", "- [ ] Current (10:00-10:25)"].join("\n");

function selectTaskLink(lineText, cursorCh = 0) {
  const selected = helpers.findSelectedTaskLinkOnLine(lineText, cursorCh);
  assert.ok(selected.link, `expected a selected link in ${JSON.stringify(lineText)}`);
  return selected.link;
}

function deleteTaskLink(content, lineNumber, cursorCh = 0) {
  const lineText = content.split("\n")[lineNumber];
  const plan = helpers.planTaskLinkDeletion(content, lineNumber, selectTaskLink(lineText, cursorCh));
  assert.ok(plan);
  return { ...plan, result: applyPlannedEdits(content, [plan.edit]) };
}

// `files` maps vault path -> content for every note. The active note is edited
// through the editor (like Obsidian); every other note goes through vault.modify.
function createTaskLinkHarness({
  files,
  activePath,
  cursor,
  targets = { Tasks: "Tasks.md" },
  dailyPath = "Daily.md",
}) {
  resetNotices();
  const store = { ...files };
  const editor = createEditor(store[activePath]);
  editor.setCursor(cursor);
  const file = createTFile(activePath);
  const view = createMarkdownView(file);
  const writes = [];
  const replaceCalls = [];
  const originalReplace = editor.replaceRange;
  editor.replaceRange = (replacement, from, to) => {
    replaceCalls.push({ from, to });
    return originalReplace(replacement, from, to);
  };
  const plugin = new Plugin();
  const state = { modifyHook: null, dailyHook: null };
  plugin.app = {
    workspace: { getActiveViewOfType: () => view, getActiveFile: () => file },
    vault: {
      read: async (target) => (target.path in store ? store[target.path] : null),
      modify: async (target, content) => {
        if (state.modifyHook) {
          state.modifyHook(target.path);
        }
        writes.push({ path: target.path, content });
        store[target.path] = content;
      },
    },
  };
  plugin.resolveReferenceDestination = (reference, sourcePath) => {
    const path = reference.targetText === "" ? sourcePath : targets[reference.targetText];
    return path ? createTFile(path) : null;
  };
  plugin.resolveTodayDailyFile = () => {
    if (state.dailyHook) {
      state.dailyHook();
    }
    return dailyPath ? createTFile(dailyPath) : null;
  };
  plugin.suppressEditorScans = () => {};
  plugin.now = () => localDate(2026, 8, 15);
  return { plugin, editor, file, view, store, writes, replaceCalls, state };
}

// Stub nav `inboxRoute` v1 api for link-toggle-gate tests (block-id-prompt
// 1.23.0). Merges into any existing `bob-navigation-hotkeys` holder (for
// example a mock reviewWalk), so walk + route tests can combine. `calls`
// records `["isInboxNote", path]`, `["prompt", request]`, and
// `["commit", request]` in order. `inboxPaths` controls isInboxNote;
// `prompt`/`commit` are outcomes or functions returning them.
function installMockInboxRoute(plugin, calls, options = {}) {
  const inboxPaths = new Set(options.inboxPaths || []);
  const route = {
    version: 1,
    isInboxNote(path) {
      calls.push(["isInboxNote", path]);
      return inboxPaths.has(path);
    },
    async prompt(request) {
      calls.push(["prompt", request]);
      if (typeof options.prompt === "function") {
        return options.prompt(request);
      }
      return options.promptOutcome || { kind: "stay" };
    },
    async commit(request) {
      calls.push(["commit", request]);
      if (typeof options.commit === "function") {
        return options.commit(request);
      }
      return (
        options.commitResult || {
          ok: false,
          name: "",
          count: 0,
          notice: "",
          handledRefs: [],
          reason: "route-failed",
        }
      );
    },
  };
  plugin.app = plugin.app || {};
  plugin.app.plugins = plugin.app.plugins || { plugins: {} };
  const holder = plugin.app.plugins.plugins["bob-navigation-hotkeys"] || {};
  holder.api = { ...(holder.api || {}), version: 3, inboxRoute: route };
  plugin.app.plugins.plugins["bob-navigation-hotkeys"] = holder;
  return route;
}

const NEXT_TASK = "- [*] #task Ship it ^ship";
const DAILY_WITH_LINKS = [
  "## Pomodoros",
  "- [ ] Current (10:00-10:25)",
  "  - [[Tasks#^ship]]",
  "    - nested note",
  "  - keep",
  "- [ ] Later ()",
  "  - [[Tasks#^ship]]",
  "- [x] Done (09:00-09:25)",
  "  - [[Tasks#^ship]]",
].join("\n");

module.exports = {
  Plugin,
  helpers,
  noticeMessages,
  resetNotices,
  lastNotice,
  localDate,
  WORK_LOG_DATE,
  createEditor,
  applyPlannedEdits,
  sourceForTaskPicker,
  sourceForPomodoroLink,
  createTFile,
  createMarkdownView,
  createTaskModeHarness,
  LINKED_DAILY,
  UNLINKED_DAILY,
  selectTaskLink,
  deleteTaskLink,
  createTaskLinkHarness,
  installMockInboxRoute,
  NEXT_TASK,
  DAILY_WITH_LINKS,
};
