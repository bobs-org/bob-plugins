// Tests for the nav-stage vault-wide Depends on stage (bob-cli-3n.7).
// `docs/task-dependencies.md` §6 and §11.4 (DK ranking vectors) in bob-cli
// are authoritative; the DK vectors are copied from that section.
const Module = require("node:module");

const notices = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: class {},
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

const {
  dependencyStageFieldTier,
  dependencyStageTermTier,
  dependencyStageRank,
  isDependencyStageExcludedPath,
  collectVaultDependencyCandidates,
  indexDependencyStageNotes,
  resolveDependencyStageCurrent,
  collectDependencyStageEdges,
  findDependencyStageCycle,
  compareDependencyStageCanonical,
  planDependencyStageView,
  resolveDependencyStageEntry,
  dependencyStageRowKey,
  normalizeStageCacheTask,
  mergeStageCacheCandidates,
  locateStageDisplayText,
  editorSelectionSpansTasks,
  bulletPropertyTaskMarkKey,
  createLinkPickerPropertyItems,
  describeRemovedDependencyTarget,
  buildDependencyEditNotice,
  planDependencyEdit,
  validateBulletPropertyConfig,
  BulletPropertyPickerModal,
  scanDependencyStageNoteTasks,
  createDependencyNoteSnapshot,
  createDependencySnapshotMap,
  collectVaultDependencyCandidatesFromSnapshots,
  indexDependencyStageNotesFromSnapshots,
  collectDependencyStageEdgesFromSnapshots,
} = helpers;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Picker-harness stubs (nav-mirror-stage): the real modal, picker, and
// writer paths with an async vault/editor stub and a stubbed Tasks plugin,
// so the stage tests below exercise production code instead of pure
// helpers.
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
  getCursor() {
    return { line: 0, ch: 0 };
  }
  replaceRange(text, from, to = from) {
    const newline = this.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = this.content.split(/\r?\n/);
    const offset = (position) =>
      lines
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + newline.length, 0) +
      position.ch;
    const start = offset(from);
    const end = offset(to);
    this.content = this.content.slice(0, start) + text + this.content.slice(end);
  }
}

class TransactionEditor extends TestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
    this.undoGroups = 0;
  }
  getCursor() {
    return { ...this.cursor };
  }
  getScrollInfo() {
    return { left: 0, top: 0 };
  }
  setCursor(lineOrPosition, ch) {
    this.cursor =
      typeof lineOrPosition === "object"
        ? { ...lineOrPosition }
        : { line: lineOrPosition, ch };
  }
  transaction(transaction) {
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

function stubApp(notes) {
  const store = new Map(Object.entries(notes));
  const settingsPath = ".obsidian/plugins/obsidian-tasks-plugin/data.json";
  const vault = {
    getMarkdownFiles: () =>
      [...store.keys()]
        .filter((vaultPath) => /\.md$/i.test(vaultPath))
        .map((vaultPath) => ({ path: vaultPath })),
    getAbstractFileByPath: (vaultPath) =>
      store.has(vaultPath) || vaultPath === settingsPath
        ? { path: vaultPath }
        : null,
    cachedRead: async (file) => {
      const content = store.get(file.path);
      return content === undefined ? "" : String(content);
    },
    read: async (file) => {
      if (file.path === settingsPath) {
        return JSON.stringify(compatibleTasksSettings());
      }
      return vault.cachedRead(file);
    },
    process: async (file, fn) => {
      const current = store.get(file.path) || "";
      store.set(file.path, String(fn(current)));
    },
  };
  const metadataCache = {
    getFirstLinkpathDest: (linkpath) => {
      const wanted = String(linkpath || "");
      if (!wanted || wanted.includes("#")) {
        return null;
      }
      const direct = `${wanted}.md`;
      if (store.has(direct)) {
        return { path: direct };
      }
      return null;
    },
  };
  return {
    app: {
      vault,
      metadataCache,
      workspace: { getLeavesOfType: () => [] },
    },
    store,
  };
}

function stubPlugin(notes) {
  const { app, store } = stubApp(notes);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  return { plugin, store };
}

function stubStageModal(plugin, editor, filePath, cursorLine) {
  const content = String(editor.getValue() || "");
  const lines = content.split(/\r?\n/);
  const cursor = { line: cursorLine, ch: 0 };
  const config = validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: ["x"] }],
  });
  const modal = new BulletPropertyPickerModal(
    {},
    plugin,
    editor,
    cursor,
    String(lines[cursorLine] || ""),
    config,
    { filePath },
  );
  modal.filePath = filePath;
  modal.selectedPropertyItem = {
    property: { name: "dependsOn", values: "local_task_id" },
  };
  return modal;
}

function stubRowEl() {
  const el = {
    children: [],
    titles: {},
    text: "",
    classes: [],
    classList: { add: (...names) => el.classes.push(...names) },
    createDiv(options = {}) {
      const child = stubRowEl();
      if (options.cls !== undefined) {
        child.cls = options.cls;
      }
      if (options.text !== undefined) {
        child.text = options.text;
      }
      el.children.push(child);
      return child;
    },
    createSpan(options = {}) {
      return el.createDiv(options);
    },
    createEl(_tag, options = {}) {
      return el.createDiv(options);
    },
    setText(value) {
      el.text = String(value);
    },
    appendText(value) {
      el.text += String(value);
    },
    setAttribute(key, value) {
      el.titles[key] = String(value);
    },
  };
  return el;
}

function rowTitles(el, out = []) {
  if (el.titles && el.titles.title) {
    out.push(el.titles.title);
  }
  for (const child of el.children) {
    rowTitles(child, out);
  }
  return out;
}
function stubReopen(plugin) {
  const reopened = [];
  plugin.openBulletPropertyPicker = async (reopenEditor, options) => {
    reopened.push(options);
    return true;
  };
  return reopened;
}

module.exports = {
  notices,
  NavigationHotkeysPlugin,
  helpers,
  dependencyStageFieldTier,
  dependencyStageTermTier,
  dependencyStageRank,
  isDependencyStageExcludedPath,
  collectVaultDependencyCandidates,
  indexDependencyStageNotes,
  resolveDependencyStageCurrent,
  collectDependencyStageEdges,
  findDependencyStageCycle,
  compareDependencyStageCanonical,
  planDependencyStageView,
  resolveDependencyStageEntry,
  dependencyStageRowKey,
  normalizeStageCacheTask,
  mergeStageCacheCandidates,
  locateStageDisplayText,
  editorSelectionSpansTasks,
  bulletPropertyTaskMarkKey,
  createLinkPickerPropertyItems,
  describeRemovedDependencyTarget,
  buildDependencyEditNotice,
  planDependencyEdit,
  validateBulletPropertyConfig,
  BulletPropertyPickerModal,
  scanDependencyStageNoteTasks,
  createDependencyNoteSnapshot,
  createDependencySnapshotMap,
  collectVaultDependencyCandidatesFromSnapshots,
  indexDependencyStageNotesFromSnapshots,
  collectDependencyStageEdgesFromSnapshots,
  sleep,
  compatibleTasksSettings,
  TestEditor,
  TransactionEditor,
  stubApp,
  stubPlugin,
  stubStageModal,
  stubRowEl,
  rowTitles,
  stubReopen,
};
