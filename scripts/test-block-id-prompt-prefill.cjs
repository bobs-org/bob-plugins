// Block-ID prefill behavior: resolver, modal seeding, and task-assignment
// revalidation (plan 202610/task_block_id_prefill.md). Uses production code
// with DOM stubs so the real modal path is exercised.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const notices = [];
let currentModalStub = null;

class StubText {
  constructor() {
    this.value = "";
    this.placeholder = "";
    this.inputEl = {
      value: "",
      isConnected: true,
      focused: false,
      selected: false,
      listeners: {},
      addEventListener: (name, fn) => {
        this.inputEl.listeners[name] = this.inputEl.listeners[name] || [];
        this.inputEl.listeners[name].push(fn);
      },
      focus: () => {
        this.inputEl.focused = true;
      },
      select: () => {
        this.inputEl.selected = true;
      },
    };
  }
  setPlaceholder(value) {
    this.placeholder = value;
    return this;
  }
  setValue(value) {
    this.value = String(value);
    this.inputEl.value = String(value);
    return this;
  }
  getValue() {
    return this.value;
  }
}

class StubButton {
  constructor() {
    this.text = "";
    this.disabled = false;
    this.handler = null;
  }
  setButtonText(text) {
    this.text = text;
    return this;
  }
  setCta() {
    return this;
  }
  setDisabled(disabled) {
    this.disabled = Boolean(disabled);
    return this;
  }
  onClick(fn) {
    this.handler = fn;
    return this;
  }
}

class StubSetting {
  constructor() {
    this.text = null;
    this.buttons = [];
  }
  setName() {
    return this;
  }
  addText(fn) {
    const text = new StubText();
    this.text = text;
    fn(text);
    return this;
  }
  addButton(fn) {
    const button = new StubButton();
    this.buttons.push(button);
    fn(button);
    return this;
  }
}

function makeContentEl() {
  const children = [];
  return {
    children,
    empty() {
      children.length = 0;
    },
    createEl(tag, options = {}) {
      const el = {
        tag,
        text: options.text || "",
        isConnected: true,
        setAttribute: () => {},
        style: {},
        focus: () => {},
        select: () => {},
      };
      children.push(el);
      return el;
    },
    createDiv(options = {}) {
      return this.createEl("div", options);
    },
  };
}

class StubModal {
  constructor() {
    this.contentEl = makeContentEl();
    this.modalEl = { addClass: () => {}, removeClass: () => {} };
    this.opened = false;
    currentModalStub = this;
  }
  open() {
    this.opened = true;
    if (typeof this.onOpen === "function") {
      this.onOpen();
    }
  }
  close() {
    if (typeof this.onClose === "function") {
      this.onClose();
    }
  }
}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class NoticeStub {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: class {},
      Modal: StubModal,
      Notice: NoticeStub,
      normalizePath: (value) => String(value || ""),
      Plugin: class {},
      Setting: StubSetting,
      TFile: class {},
      setIcon: () => {},
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const BidPlugin = require("../plugins/block-id-prompt/main.js");
Module._load = originalLoad;
const { helpers } = BidPlugin;

global.window = global.window || {};
global.window.setTimeout = (fn) => {
  // Run focus/select timers synchronously for deterministic tests.
  fn();
  return 0;
};
global.window.clearTimeout = () => {};

function resetNotices() {
  notices.length = 0;
}

function createEditor(content) {
  let value = content;
  const lines = () => value.split("\n");
  return {
    getValue: () => value,
    getLine: (line) => lines()[line] || "",
    replaceRange: (replacement, from, to = from) => {
      const toIndex = (position) => {
        let index = 0;
        const parts = value.split("\n");
        for (let line = 0; line < position.line; line += 1) {
          index += parts[line].length + 1;
        }
        return index + position.ch;
      };
      const start = toIndex(from);
      const end = toIndex(to);
      value = value.slice(0, start) + replacement + value.slice(end);
    },
    getCursor: () => ({ line: 0, ch: 0 }),
    listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
  };
}

function createPluginWithFiles(files, activePath) {
  const store = { ...files };
  const plugin = new BidPlugin();
  plugin.app = {
    workspace: {
      getActiveViewOfType: () => null,
      getActiveFile: () => null,
      getLeavesOfType: () => [],
    },
    vault: {
      read: async (file) =>
        file.path in store ? store[file.path] : null,
      modify: async (file, content) => {
        store[file.path] = content;
      },
      getAbstractFileByPath: (path) =>
        path in store ? { path, extension: "md" } : null,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath, sourcePath) => {
        const wanted = String(linkpath || "");
        if (!wanted) {
          return { path: sourcePath, extension: "md" };
        }
        const direct = `${wanted}.md`;
        return direct in store ? { path: direct, extension: "md" } : null;
      },
    },
  };
  plugin.promptOpen = false;
  plugin.lastPromptKey = null;
  plugin.suppressEditorScans = () => {};
  plugin.now = () => new Date(2026, 7, 15);
  const baseResolve = plugin.resolveDestinationFile
    ? plugin.resolveDestinationFile.bind(plugin)
    : null;
  plugin.resolveDestinationFile = (source) => {
    try {
      if (baseResolve) {
        const resolved = baseResolve(source);
        if (resolved) {
          return resolved;
        }
      }
    } catch (error) {
      // Fall through to the filename fallback below.
    }
    const targetText =
      source && typeof source.targetText === "string"
        ? source.targetText
        : "";
    if (!targetText) {
      return { path: source.sourcePath, extension: "md" };
    }
    const direct = `${targetText}.md`;
    if (direct in store) {
      return { path: direct, extension: "md" };
    }
    return null;
  };
  return { plugin, store };
}

function directAddSource(editor, sourcePath, line = 0) {
  const lines = editor.getValue().split("\n");
  const text = lines[line] || "";
  return {
    kind: "direct-add",
    editor,
    sourcePath,
    line,
    startCh: text.replace(/[ \t]+$/g, "").length,
    endCh: text.length,
    addMode: "append",
    rangeStartLine: line,
    rangeEndLine: line,
    expectedBlockText: text,
    previewText: text,
  };
}

test("direct-add seeds from the task headline, not non-task blocks", async () => {
  const editor = createEditor("- [ ] #task Fix flaky gkeep test [priority:: high]");
  const { plugin } = createPluginWithFiles({}, "Tasks.md");
  const source = directAddSource(editor, "Tasks.md", 0);
  const result = await helpers.resolvePromptBlockIdSuggestion(plugin, source);
  assert.equal(result.suggestion, "fix-flaky-gkeep");

  const plainEditor = createEditor("Just a paragraph");
  const plainSource = directAddSource(plainEditor, "Tasks.md", 0);
  const plain = await helpers.resolvePromptBlockIdSuggestion(plugin, plainSource);
  assert.equal(plain.suggestion, null);

  const closedEditor = createEditor("- [x] #task Closed work ^old");
  const closedSource = directAddSource(closedEditor, "Tasks.md", 0);
  const closed = await helpers.resolvePromptBlockIdSuggestion(plugin, closedSource);
  assert.ok(closed.suggestion);
});

test("link-task-complete seeds from the target, prefers open buffers", async () => {
  const targetContent = "- [ ] #task Renew the library books\n";
  const { plugin, store } = createPluginWithFiles(
    { "Tasks.md": targetContent, "Daily.md": "[[Tasks#^^]]" },
    "Daily.md",
  );
  const editor = createEditor("[[Tasks#^^]]");
  const task = { rawLine: "- [ ] #task Renew the library books", line: 0 };
  const source = {
    kind: "link-task-complete",
    editor,
    sourcePath: "Daily.md",
    targetText: "Tasks",
    blockPrefix: "#^",
    line: 0,
    startCh: 0,
    endCh: 12,
    raw: "[[Tasks#^^]]",
    task: { ...task },
    prefillId: false,
  };
  const result = await helpers.resolvePromptBlockIdSuggestion(plugin, source);
  assert.equal(result.suggestion, "renew-library-books");

  // Open unsaved target wins over stale disk: the picker selected from the
  // live buffer, so its rawLine matches the open content, not the disk.
  const openEditor = createEditor("- [ ] #task Changed headline here\n");
  plugin.app.workspace.getLeavesOfType = () => [
    { view: { file: { path: "Tasks.md" }, editor: openEditor } },
  ];
  const openSource = {
    ...source,
    task: { rawLine: "- [ ] #task Changed headline here", line: 0 },
  };
  const openResult = await helpers.resolvePromptBlockIdSuggestion(plugin, openSource);
  assert.equal(openResult.suggestion, "changed-headline-here");
  assert.notEqual(store["Tasks.md"], openEditor.getValue());
});

test("link-task-complete reports stale and unreadable targets", async () => {
  const { plugin } = createPluginWithFiles(
    { "Tasks.md": "- [ ] #task Changed\n", "Daily.md": "x" },
    "Daily.md",
  );
  const editor = createEditor("x");
  const staleSource = {
    kind: "link-task-complete",
    editor,
    sourcePath: "Daily.md",
    targetText: "Tasks",
    blockPrefix: "#^",
    line: 0,
    startCh: 0,
    endCh: 1,
    raw: "x",
    task: { rawLine: "- [ ] #task Original", line: 0 },
    prefillId: false,
  };
  resetNotices();
  const stale = await helpers.resolvePromptBlockIdSuggestion(plugin, staleSource);
  assert.equal(stale.suggestion, null);
  assert.match(stale.notice || "", /selected task changed/);

  const missingSource = { ...staleSource, targetText: "Missing" };
  const missing = await helpers.resolvePromptBlockIdSuggestion(plugin, missingSource);
  assert.equal(missing.suggestion, null);
  assert.match(missing.notice || "", /could not be resolved/);
});

test("pomodoro link seeds after the choice from the cursor task", async () => {
  const editor = createEditor("- [ ] #task Book flights [scheduled:: 2026-10-13] #travel");
  const { plugin } = createPluginWithFiles({}, "Tasks.md");
  const source = {
    kind: "link-task-pomodoro",
    editor,
    sourcePath: "Tasks.md",
    line: 0,
    task: {
      rawLine: "- [ ] #task Book flights [scheduled:: 2026-10-13] #travel",
      line: 0,
    },
    prefillId: false,
    pomodoroTarget: { title: "Current" },
  };
  const result = await helpers.resolvePromptBlockIdSuggestion(plugin, source);
  assert.equal(result.suggestion, "book-flights");
});

test("marker rename suggests from the unique task, never hiding ambiguity", async () => {
  const { plugin } = createPluginWithFiles(
    { "Tasks.md": "- [ ] #task Fix flaky gkeep test [priority:: high] ^old\n" },
    "Daily.md",
  );
  const editor = createEditor("[[Tasks#^old]]@");
  const source = {
    editor,
    sourcePath: "Daily.md",
    targetText: "Tasks",
    oldId: "old",
    blockPrefix: "#^",
    line: 0,
    startCh: 0,
    endCh: 14,
    raw: "[[Tasks#^old]]@",
  };
  const result = await helpers.resolvePromptBlockIdSuggestion(plugin, source);
  assert.equal(result.suggestion, "fix-flaky-gkeep");

  const { plugin: dupPlugin } = createPluginWithFiles(
    {
      "Tasks.md":
        "- [ ] #task One ^old\n- [ ] #task Two ^old\n",
    },
    "Daily.md",
  );
  const dupSource = { ...source, editor: createEditor("[[Tasks#^old]]@") };
  const dup = await helpers.resolvePromptBlockIdSuggestion(dupPlugin, dupSource);
  assert.equal(dup.suggestion, null);
  assert.match(dup.notice || "", /exactly once/);
});

test("modal seeds the value, selects once, and never overwrites typing", async () => {
  const editor = createEditor("- [ ] #task Fix flaky gkeep test [priority:: high]");
  const { plugin } = createPluginWithFiles({}, "Tasks.md");
  const source = directAddSource(editor, "Tasks.md", 0);
  const modal = new helpers.BlockIdPromptModal({}, plugin, source);
  modal.open();
  await modal.resolveSuggestion();
  // Flush the synchronous focus/select timer.
  await Promise.resolve();
  assert.equal(modal.input.getValue(), "fix-flaky-gkeep");
  assert.equal(modal.input.inputEl.selected, true);
  assert.equal(modal.saveButton.disabled, false);

  // Typing before a late resolution wins; simulate a second resolution.
  modal.userEdited = true;
  modal.input.setValue("custom-id");
  await modal.resolveSuggestion();
  assert.equal(modal.input.getValue(), "custom-id");
  modal.close();
});

test("modal disables Save while loading and survives close/reopen", async () => {
  const { plugin } = createPluginWithFiles(
    { "Tasks.md": "- [ ] #task Renew the library books\n" },
    "Daily.md",
  );
  // Delayed vault read: the modal opens before the target resolves.
  const originalRead = plugin.app.vault.read;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  plugin.app.vault.read = async (file) => {
    await gate;
    return originalRead(file);
  };
  const editor = createEditor("[[Tasks#^^]]");
  const source = {
    kind: "link-task-complete",
    editor,
    sourcePath: "Daily.md",
    targetText: "Tasks",
    blockPrefix: "#^",
    line: 0,
    startCh: 0,
    endCh: 1,
    raw: "x",
    task: { rawLine: "- [ ] #task Renew the library books", line: 0 },
    prefillId: false,
  };
  const modal = new helpers.BlockIdPromptModal({}, plugin, source);
  modal.open();
  assert.equal(modal.saveButton.disabled, true);
  // Clearing the field before resolution counts as an edit.
  modal.input.setValue("");
  modal.userEdited = true;
  release();
  await modal.resolveSuggestion();
  assert.equal(modal.input.getValue(), "");
  assert.equal(modal.saveButton.disabled, false);
  modal.close();

  // Closing before resolution never touches the closed modal.
  let release2;
  const gate2 = new Promise((resolve) => {
    release2 = resolve;
  });
  plugin.app.vault.read = async (file) => {
    await gate2;
    return originalRead(file);
  };
  const modal2 = new helpers.BlockIdPromptModal({}, plugin, source);
  modal2.open();
  modal2.close();
  release2();
  await modal2.resolveSuggestion();
  assert.equal(modal2.closed, true);
});

test("submit revalidates: occupied IDs and stale tasks fail editable", async () => {
  const { plugin, store } = createPluginWithFiles(
    {
      "Tasks.md": "- [ ] #task Renew the library books\n",
      "Daily.md": "[[Tasks#^^]]",
    },
    "Daily.md",
  );
  const editor = createEditor("[[Tasks#^^]]");
  plugin.resolveReferenceDestination = (reference, sourcePath) => {
    if (reference.targetText === "Tasks") {
      return { path: "Tasks.md", extension: "md" };
    }
    return null;
  };
  plugin.sourceMarkerStillPresent = () => true;
  plugin.completeTaskSourceLink = () => ({ removedCount: 0 });
  plugin.adjustSourceForPlan = (source) => source;
  plugin.applyTargetTaskPlan = async (file, source, plan, expected) => {
    store[file.path] = plan.content;
    return true;
  };
  plugin.getFreshnessStampLine = () => undefined;
  plugin.getFreshnessDateText = () => undefined;
  const source = {
    kind: "link-task-complete",
    editor,
    sourcePath: "Daily.md",
    targetText: "Tasks",
    blockPrefix: "#^",
    line: 0,
    startCh: 0,
    endCh: 12,
    raw: "[[Tasks#^^]]",
    task: { rawLine: "- [ ] #task Renew the library books", line: 0 },
    prefillId: false,
  };
  resetNotices();
  // Occupy the suggestion before Save: the write must fail, keeping the value.
  store["Tasks.md"] = "- [ ] #task Other ^renew-library-books\n- [ ] #task Renew the library books\n";
  const occupied = await plugin.submitBlockId(source, "renew-library-books");
  assert.equal(occupied, false);
  assert.match(notices[notices.length - 1] || "", /already exists/);

  resetNotices();
  const staleSource = {
    ...source,
    task: { rawLine: "- [ ] #task Changed", line: 0 },
  };
  const stale = await plugin.submitBlockId(staleSource, "changed");
  assert.equal(stale, false);
});

test("cancelling writes no ID and explicit renames keep the current ID", async () => {
  const editor = createEditor("- [ ] #task Fix flaky gkeep test [priority:: high]");
  const { plugin } = createPluginWithFiles({}, "Tasks.md");
  const before = editor.getValue();
  const source = directAddSource(editor, "Tasks.md", 0);
  const modal = new helpers.BlockIdPromptModal({}, plugin, source);
  modal.open();
  modal.close();
  assert.equal(editor.getValue(), before);

  const explicitSource = {
    kind: "direct-rename",
    editor,
    sourcePath: "Tasks.md",
    oldId: "keep-me",
    prefillId: true,
    line: 0,
    startCh: 0,
    endCh: 1,
    raw: "^keep-me",
  };
  const explicitModal = new helpers.BlockIdPromptModal({}, plugin, explicitSource);
  explicitModal.open();
  assert.equal(explicitModal.input.getValue(), "keep-me");
  explicitModal.close();
});
