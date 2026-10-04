const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
let MarkdownView;
let TestModal;
const notices = [];
let focusedEl = null;

function createTestDomNode(tag = "div", spec = {}) {
  const node = {
    tag,
    attrs: {},
    classes: [],
    children: [],
    listeners: {},
    value: "",
    textContent: "",
    focused: false,
    classList: {
      add: (...names) => {
        for (const name of names.flatMap((item) => String(item || "").split(/\s+/))) {
          if (name && !node.classes.includes(name)) {
            node.classes.push(name);
          }
        }
      },
      remove: (...names) => {
        node.classes = node.classes.filter((cls) => !names.includes(cls));
      },
      contains: (name) => node.classes.includes(name),
    },
    addClass(...names) {
      this.classList.add(...names);
      return this;
    },
    removeClass(...names) {
      this.classList.remove(...names);
      return this;
    },
    setAttr(name, value) {
      this.attrs[name] = String(value);
      if (name === "value") {
        this.value = String(value);
      }
    },
    setAttribute(name, value) {
      this.setAttr(name, value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? this.attrs[name]
        : null;
    },
    appendText(text) {
      const child = createTestDomNode("text");
      child.textContent = String(text);
      this.children.push(child);
      this.textContent += child.textContent;
    },
    setText(text) {
      this.children = [];
      this.textContent = "";
      this.appendText(text);
    },
    empty() {
      this.children = [];
      this.textContent = "";
    },
    createDiv(childSpec = {}) {
      return this.createEl("div", childSpec);
    },
    createSpan(childSpec = {}) {
      return this.createEl("span", childSpec);
    },
    createEl(childTag, childSpec = {}) {
      const child = createTestDomNode(childTag, childSpec);
      this.children.push(child);
      return child;
    },
    addEventListener(type, listener) {
      if (!this.listeners[type]) {
        this.listeners[type] = [];
      }
      this.listeners[type].push(listener);
    },
    dispatchEvent(type, event = {}) {
      for (const listener of this.listeners[type] || []) {
        listener(event);
      }
    },
    focus() {
      if (focusedEl && focusedEl !== this) {
        focusedEl.focused = false;
      }
      this.focused = true;
      focusedEl = this;
    },
    scrollIntoView() {},
  };

  if (typeof spec === "string") {
    node.classList.add(spec);
  } else if (spec && typeof spec === "object") {
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

  return node;
}

Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    MarkdownView = class MarkdownView {};
    TestModal = class TestModal {
      constructor(app) {
        this.app = app;
        this.isOpen = false;
        this.modalEl = createTestDomNode("div");
        this.contentEl = createTestDomNode("div");
      }
      open() {
        this.isOpen = true;
        if (typeof this.onOpen === "function") {
          this.onOpen();
        }
        return this;
      }
      close() {
        if (!this.isOpen) {
          return this;
        }
        this.isOpen = false;
        if (typeof this.onClose === "function") {
          this.onClose();
        }
        return this;
      }
    };
    return {
      MarkdownView,
      Modal: TestModal,
      Notice: class Notice {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Plugin: class Plugin {},
      setIcon: () => {},
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class EditorView {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let TaskStatusCyclerPlugin;
try {
  TaskStatusCyclerPlugin = require("../plugins/task-status-cycler/main.js");
} finally {
  Module._load = originalLoad;
}

const { helpers } = TaskStatusCyclerPlugin;

function createInMemoryObsidianApp(initialSources) {
  const files = new Map();
  const sources = new Map();

  for (const [path, sourceText] of Object.entries(initialSources)) {
    const file = { path };
    files.set(path, file);
    sources.set(path, sourceText);
  }

  const resolveLinkPath = (pathPart) => {
    const exactPath = pathPart.endsWith(".md") ? pathPart : `${pathPart}.md`;
    if (files.has(exactPath)) {
      return files.get(exactPath);
    }

    for (const file of files.values()) {
      const basename = file.path.split("/").pop().replace(/\.md$/i, "");
      if (basename === pathPart) {
        return file;
      }
    }
    return null;
  };

  return {
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path) || null,
        getMarkdownFiles: () => [...files.values()],
        cachedRead: async (file) => sources.get(file.path),
        read: async (file) => sources.get(file.path),
        modify: async (file, sourceText) => sources.set(file.path, sourceText),
        process: async (file, updateSourceText) => {
          sources.set(file.path, updateSourceText(sources.get(file.path)));
        },
      },
      metadataCache: {
        getFileCache: () => null,
        getFirstLinkpathDest: (pathPart) => resolveLinkPath(pathPart),
      },
    },
    getSource: (path) => sources.get(path),
  };
}

function getEmbeddedTarget(linkText) {
  const targets = helpers.parseEmbeddedBlockTransclusions(linkText);
  assert.equal(targets.length, 1, `expected one embedded target in ${linkText}`);
  return targets[0];
}

function createTextEditor(initialText, initialCursor = { line: 0, ch: 0 }) {
  let text = initialText;
  let cursor = { ...initialCursor };
  const newline = initialText.includes("\r\n") ? "\r\n" : "\n";
  const splitLines = () => text.split(newline);
  const positionOffset = (position) => {
    const lines = splitLines();
    return lines
      .slice(0, position.line)
      .reduce((sum, line) => sum + line.length + newline.length, 0) + position.ch;
  };
  return {
    getValue: () => text,
    getCursor: () => ({ ...cursor }),
    setCursor: (next) => { cursor = { ...next }; },
    getLine: (line) => splitLines()[line] || "",
    lineCount: () => splitLines().length,
    lastLine: () => splitLines().length - 1,
    replaceRange: (replacement, from, to = from) => {
      const start = positionOffset(from);
      const end = positionOffset(to);
      text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
    },
  };
}

function attachActiveMarkdownView(plugin, harness, editor, path = "Daily.md") {
  const file = harness.app.vault.getAbstractFileByPath(path);
  assert.ok(file, `expected ${path} in the in-memory vault`);
  const view = Object.assign(new MarkdownView(), { editor, file });
  harness.app.workspace = {
    getActiveViewOfType: (ViewType) => {
      assert.equal(ViewType, MarkdownView);
      return view;
    },
    getActiveFile: () => file,
  };
  plugin.app = harness.app;
  return { file, view };
}

function registerTaskToggleVimAction(plugin) {
  const originalWindow = global.window;
  const actions = new Map();
  const vim = {
    defineAction(name, handler) {
      actions.set(name, handler);
    },
    mapCommand() {},
  };
  global.window = { CodeMirrorAdapter: { Vim: vim } };
  try {
    assert.equal(plugin.registerVimMappings(), true);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }

  const action = actions.get("taskStatusCyclerToggleTaskOpenDone");
  assert.equal(typeof action, "function");
  return action;
}

async function flushAsyncActions() {
  await new Promise((resolve) => setImmediate(resolve));
}

function noteLines(options = {}) {
  const taskLines = Array.isArray(options.taskLines)
    ? options.taskLines
    : [options.taskLine || "- [ ] #task Ship it"];
  const frontmatter = options.frontmatterLines
    ? ["---", ...options.frontmatterLines, "---"]
    : [];
  return [
    ...frontmatter,
    ...(options.preSectionLines || ["## Tasks", ""]),
    ...taskLines,
    ...(options.extraLines || []),
  ];
}

function projectNoteLines(options = {}) {
  return noteLines({
    ...options,
    frontmatterLines: options.frontmatterLines || [
      options.typeLine || "type: [[project]]",
    ],
  });
}

function findHeading(lines, title, occurrence = 0) {
  const matches = helpers
    .collectSelectableDemotionHeadings(lines)
    .filter((heading) => heading.title === title);
  return matches[occurrence] || null;
}

function findPromptHeading(prompt, title, occurrence = 0) {
  const matches = (prompt && Array.isArray(prompt.headings) ? prompt.headings : [])
    .filter((heading) => heading.title === title);
  return matches[occurrence] || null;
}

function resolvePrompt(lines, activeLine, destination, cursorCh = 0) {
  const prompt = helpers.getObsidianTaskToggleDocumentPlan(
    lines,
    activeLine,
    cursorCh,
    "2026-08-20",
  );
  assert.equal(prompt.mode, "prompt");
  assert.equal(prompt.nextLines, undefined);
  return helpers.resolveObsidianTaskDemotionDestination(prompt, destination);
}

function getSectionPrompt(lines, activeLine, cursorCh = 0) {
  const prompt = helpers.getObsidianTaskToggleDocumentPlan(
    lines,
    activeLine,
    cursorCh,
    "2026-08-20",
  );
  assert.equal(prompt.mode, "prompt");
  assert.equal(prompt.nextLines, undefined);
  return prompt;
}

function resolveSectionPrompt(lines, activeLine, destination, cursorCh = 0) {
  return helpers.resolveObsidianTaskPromptDestination(
    getSectionPrompt(lines, activeLine, cursorCh),
    destination,
  );
}

function openDemotionPicker(source, cursor = { line: 2, ch: 0 }, path = "Note.md") {
  const editor = createTextEditor(source, cursor);
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path },
  });
  const plugin = new TaskStatusCyclerPlugin();
  const centered = [];
  plugin.centerEditorLineInView = (activeEditor, line, ch) => {
    centered.push({ line, ch, sameEditor: activeEditor === editor });
    return true;
  };
  return { editor, view, plugin, centered };
}

function acceptPickerDestination(plugin, destination) {
  const picker = plugin.demotionSectionPicker;
  assert.ok(picker, "expected the destination picker to be open");
  return plugin.submitDemotionSectionPicker(picker, destination);
}

function acceptSelectedPickerRow(plugin) {
  const picker = plugin.demotionSectionPicker;
  assert.ok(picker, "expected the destination picker to be open");
  return picker.acceptSelected();
}

function createCompleteAtCursorPlugin(editor, { path = "gtd_daily.md" } = {}) {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.referenceMutationQueue = Promise.resolve();
  plugin.app = {
    workspace: {
      getActiveFile: () => ({ path }),
    },
    commands: {
      commands: {},
      executeCommandById: () => false,
    },
  };
  plugin.getFreshnessStampLine = () => (line, dateText) =>
    `${line} [fresh:: ${dateText}]`;
  return plugin;
}

function installTasksCloseCommand(plugin, editor, { insertAbove = false } = {}) {
  const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
  const executed = [];
  plugin.app.commands = {
    commands: { [doneCommand]: {} },
    executeCommandById: (commandId) => {
      executed.push(commandId);
      const cursor = editor.getCursor();
      const current = editor.getLine(cursor.line);
      const closed = current.replace(/\[[^\]\n]\]/, "[x]");
      const replacement = insertAbove
        ? `${current.replace(/\[[^\]\n]\]/, "[ ]")}\n${closed}`
        : closed;
      editor.replaceRange(
        replacement,
        { line: cursor.line, ch: 0 },
        { line: cursor.line, ch: current.length },
      );
      return true;
    },
  };
  return { doneCommand, executed };
}

module.exports = {
  TaskStatusCyclerPlugin,
  helpers,
  MarkdownView,
  TestModal,
  notices,
  createTestDomNode,
  createInMemoryObsidianApp,
  getEmbeddedTarget,
  createTextEditor,
  attachActiveMarkdownView,
  registerTaskToggleVimAction,
  flushAsyncActions,
  noteLines,
  projectNoteLines,
  findHeading,
  findPromptHeading,
  resolvePrompt,
  getSectionPrompt,
  resolveSectionPrompt,
  openDemotionPicker,
  acceptPickerDestination,
  acceptSelectedPickerRow,
  createCompleteAtCursorPlugin,
  installTasksCloseCommand,
};
