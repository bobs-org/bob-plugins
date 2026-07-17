const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

class TestMarkdownView {}

class TestPlugin {
  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
}

class TestNotice {
  constructor(message) {
    notices.push(String(message));
  }
}

class TestEditorView {
  static scrollIntoView(position, options) {
    return { type: "scrollIntoView", position, options };
  }
}

TestEditorView.updateListener = { of: (listener) => ({ listener }) };

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Plugin: TestPlugin,
      normalizePath: (value) => value,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: TestEditorView,
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

class FrameQueue {
  constructor() {
    this.nextHandle = 1;
    this.callbacks = new Map();
  }

  request(callback) {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle) {
    this.callbacks.delete(handle);
  }

  flushFrame() {
    const callbacks = Array.from(this.callbacks.values());
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
    return callbacks.length;
  }

  flushAll(limit = 30) {
    for (let frame = 0; frame < limit && this.callbacks.size > 0; frame += 1) {
      this.flushFrame();
    }
    assert.equal(this.callbacks.size, 0, "deferred work did not settle");
  }
}

class TestScrollDOM {
  constructor(options = {}) {
    this.scrollTop = options.scrollTop || 0;
    this.scrollLeft = options.scrollLeft || 0;
    this.scrollHeight = options.scrollHeight || 1200;
    this.clientHeight = options.clientHeight || 300;
    this.scrollWidth = options.scrollWidth || 700;
    this.clientWidth = options.clientWidth || 300;
    this.listeners = new Map();
    this.scrollToCalls = [];
  }

  addEventListener(event, handler) {
    this.listeners.set(event, handler);
  }

  removeEventListener(event, handler) {
    if (this.listeners.get(event) === handler) {
      this.listeners.delete(event);
    }
  }

  scrollTo({ top, left }) {
    this.scrollTop = top;
    this.scrollLeft = left;
    this.scrollToCalls.push({ top, left });
  }

  emitScroll() {
    const handler = this.listeners.get("scroll");
    if (handler) {
      handler();
    }
  }
}

function offsetForPosition(content, position) {
  const lines = String(content).split(/\r?\n/);
  return (
    lines
      .slice(0, position.line)
      .reduce((total, line) => total + line.length + 1, 0) + position.ch
  );
}

function createDoc(content) {
  const text = String(content);
  const lines = text.split(/\r?\n/);
  const starts = [];
  let offset = 0;
  lines.forEach((line) => {
    starts.push(offset);
    offset += line.length + 1;
  });

  return {
    lines: lines.length,
    line(number) {
      const index = number - 1;
      if (index < 0 || index >= lines.length) {
        throw new RangeError("line out of range");
      }
      return {
        number,
        from: starts[index],
        to: starts[index] + lines[index].length,
        text: lines[index],
      };
    },
    lineAt(targetOffset) {
      const safeOffset = Math.min(Math.max(targetOffset, 0), text.length);
      let index = starts.length - 1;
      while (index > 0 && starts[index] > safeOffset) {
        index -= 1;
      }
      return {
        number: index + 1,
        from: starts[index],
        to: starts[index] + lines[index].length,
        text: lines[index],
      };
    },
    toString: () => text,
  };
}

class TestEditor {
  constructor(content, cursor = { line: 0, ch: 0 }, scrollOptions = {}) {
    this.content = String(content);
    this.cursor = { ...cursor };
    this.setCursorCalls = [];
    this.scrollIntoViewCalls = [];
    this.focusCalls = 0;
    this.scrollDOM = new TestScrollDOM(scrollOptions);
    this.cm = {
      state: {
        doc: createDoc(this.content),
        selection: {
          main: { head: offsetForPosition(this.content, this.cursor) },
        },
      },
      scrollDOM: this.scrollDOM,
      dispatchCalls: [],
      dispatch: (transaction) => {
        this.cm.dispatchCalls.push(transaction);
      },
      focus: () => {
        this.focusCalls += 1;
      },
    };
  }

  getValue() {
    return this.content;
  }

  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }

  lineCount() {
    return this.content.split(/\r?\n/).length;
  }

  lastLine() {
    return this.lineCount() - 1;
  }

  getCursor() {
    return { ...this.cursor };
  }

  setCursor(lineOrPosition, ch) {
    const position =
      typeof lineOrPosition === "object"
        ? lineOrPosition
        : { line: lineOrPosition, ch };
    this.cursor = { ...position };
    this.setCursorCalls.push({ ...position });
    this.cm.state.selection = {
      main: { head: offsetForPosition(this.content, position) },
    };
  }

  scrollIntoView(range, center) {
    this.scrollIntoViewCalls.push({ range, center });
  }

  focus() {
    this.focusCalls += 1;
  }
}

function makeView(path, content, cursor, scrollOptions) {
  const view = new TestMarkdownView();
  view.file = { path, extension: "md" };
  view.editor = new TestEditor(content, cursor, scrollOptions);
  return view;
}

function makeLeaf(view) {
  return { view };
}

class TestWorkspace {
  constructor(activeLeaf, leaves = [activeLeaf]) {
    this.activeLeaf = activeLeaf;
    this.leaves = leaves.filter(Boolean);
    this.handlers = new Map();
  }

  getActiveFile() {
    return (this.activeLeaf && this.activeLeaf.view.file) || null;
  }

  getActiveViewOfType(type) {
    const view = this.activeLeaf && this.activeLeaf.view;
    return view instanceof type ? view : null;
  }

  iterateAllLeaves(callback) {
    this.leaves.forEach(callback);
  }

  async revealLeaf(leaf) {
    this.activateLeaf(leaf);
  }

  async setActiveLeaf(leaf) {
    this.activateLeaf(leaf);
  }

  activateLeaf(leaf) {
    if (!this.leaves.includes(leaf)) {
      this.leaves.push(leaf);
    }
    this.activeLeaf = leaf;
    this.emit("active-leaf-change", leaf);
    this.emit("file-open", leaf.view.file);
  }

  openFreshView(view) {
    const leaf = makeLeaf(view);
    this.activateLeaf(leaf);
    return leaf;
  }

  removeLeaf(leaf) {
    this.leaves = this.leaves.filter((candidate) => candidate !== leaf);
  }

  getLeaf() {
    return {
      openFile: async (file) => {
        if (!file || !file.view) {
          throw new Error("missing test view");
        }
        this.openFreshView(file.view);
      },
    };
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) || new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return { event, handler };
  }

  offref(ref) {
    const handlers = ref && this.handlers.get(ref.event);
    if (handlers) {
      handlers.delete(ref.handler);
    }
  }

  emit(event, value) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      Array.from(handlers).forEach((handler) => handler(value));
    }
  }

  onLayoutReady(callback) {
    callback();
  }
}

function makeApp(workspace, dailyView) {
  const app = {
    workspace,
    dailyView,
    dailyCommandCalls: 0,
    internalPlugins: {
      plugins: {
        "daily-notes": { instance: { options: { format: "[Daily]" } } },
      },
    },
    commands: {
      executeCommandById: async () => {
        app.dailyCommandCalls += 1;
        workspace.openFreshView(app.dailyView);
        return true;
      },
    },
    vault: {
      getAbstractFileByPath: () => null,
    },
  };
  return app;
}

function setupPlugin(t, app) {
  notices.length = 0;
  const originalWindow = global.window;
  const frames = new FrameQueue();
  global.window = {
    requestAnimationFrame: (callback) => frames.request(callback),
    cancelAnimationFrame: (handle) => frames.cancel(handle),
  };

  const plugin = new LedgerToolsPlugin();
  plugin.app = app;
  plugin.onload();
  t.after(() => {
    plugin.onunload();
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  });
  return { plugin, frames };
}

const POMODORO_NOTE = [
  "# Daily",
  "## Pomodoros",
  "- [x] (**0800-0825**) Earlier",
  "- [ ] (**0900-0925**) Current",
].join("\n");

test("an active-note Pomodoro target still jumps and centers immediately", (t) => {
  const workView = makeView("Work.md", POMODORO_NOTE, { line: 0, ch: 0 });
  const workspace = new TestWorkspace(makeLeaf(workView));
  const app = makeApp(workspace, null);
  const { plugin, frames } = setupPlugin(t, app);

  assert.equal(plugin.jumpToCurrentPomodoro(workView.editor), true);
  assert.deepEqual(workView.editor.setCursorCalls, [{ line: 3, ch: 0 }]);
  assert.deepEqual(workView.editor.scrollIntoViewCalls, []);
  assert.equal(app.dailyCommandCalls, 0);

  frames.flushAll();
  assert.equal(workView.editor.cm.dispatchCalls.length, 1);
  assert.deepEqual(
    workView.editor.cm.dispatchCalls[0].effects.options,
    { y: "center", x: "nearest" },
  );
  assert.deepEqual(notices, []);
});

test("the first fallback press only opens daily and the second press jumps", async (t) => {
  const workView = makeView("Work.md", "# Work", { line: 0, ch: 0 });
  const dailyView = makeView("Daily.md", POMODORO_NOTE, { line: 1, ch: 4 });
  const workspace = new TestWorkspace(makeLeaf(workView));
  const app = makeApp(workspace, dailyView);
  const { plugin, frames } = setupPlugin(t, app);

  assert.equal(await plugin.jumpToCurrentPomodoro(workView.editor), true);
  assert.equal(workspace.getActiveFile().path, "Daily.md");
  assert.deepEqual(dailyView.editor.setCursorCalls, []);
  assert.deepEqual(dailyView.editor.cm.dispatchCalls, []);
  frames.flushAll();
  assert.deepEqual(dailyView.editor.cm.dispatchCalls, []);
  assert.deepEqual(notices, []);

  assert.equal(plugin.jumpToCurrentPomodoro(dailyView.editor), true);
  assert.deepEqual(dailyView.editor.setCursorCalls, [{ line: 3, ch: 0 }]);
  frames.flushAll();
  assert.equal(dailyView.editor.cm.dispatchCalls.length, 1);
  assert.deepEqual(notices, []);
});

test("a daily note with no target defers its notice until the second press", async (t) => {
  const workView = makeView("Work.md", "# Work", { line: 0, ch: 0 });
  const dailyView = makeView("Daily.md", "# Daily", { line: 0, ch: 0 });
  const workspace = new TestWorkspace(makeLeaf(workView));
  const app = makeApp(workspace, dailyView);
  const { plugin } = setupPlugin(t, app);

  assert.equal(await plugin.jumpToCurrentPomodoro(workView.editor), true);
  assert.deepEqual(notices, []);
  assert.equal(await plugin.jumpToCurrentPomodoro(dailyView.editor), false);
  assert.deepEqual(notices, ["No ## Pomodoros section found"]);
});

test("an already-open daily leaf retains its live cursor and viewport", async (t) => {
  const workLeaf = makeLeaf(makeView("Work.md", "# Work", { line: 0, ch: 0 }));
  const dailyView = makeView(
    "Daily.md",
    POMODORO_NOTE,
    { line: 2, ch: 7 },
    { scrollTop: 480, scrollLeft: 11 },
  );
  const dailyLeaf = makeLeaf(dailyView);
  const workspace = new TestWorkspace(workLeaf, [workLeaf, dailyLeaf]);
  const app = makeApp(workspace, dailyView);
  const { plugin } = setupPlugin(t, app);
  plugin.dailyLocations.set("Daily.md", {
    cursor: { line: 0, ch: 0 },
    scrollTop: 5,
    scrollLeft: 0,
  });

  assert.equal(await plugin.jumpToCurrentPomodoro(workLeaf.view.editor), true);
  assert.equal(workspace.activeLeaf, dailyLeaf);
  assert.deepEqual(dailyView.editor.cursor, { line: 2, ch: 7 });
  assert.equal(dailyView.editor.scrollDOM.scrollTop, 480);
  assert.deepEqual(dailyView.editor.setCursorCalls, []);
  assert.deepEqual(dailyView.editor.scrollDOM.scrollToCalls, []);
});

test("a closed then reopened daily note restores its in-session location", async (t) => {
  const rememberedView = makeView(
    "Daily.md",
    POMODORO_NOTE,
    { line: 2, ch: 6 },
    { scrollTop: 525, scrollLeft: 17 },
  );
  const rememberedLeaf = makeLeaf(rememberedView);
  const workLeaf = makeLeaf(makeView("Work.md", "# Work", { line: 0, ch: 0 }));
  const workspace = new TestWorkspace(rememberedLeaf, [rememberedLeaf, workLeaf]);
  const app = makeApp(workspace, null);
  const { plugin, frames } = setupPlugin(t, app);

  workspace.activateLeaf(workLeaf);
  workspace.removeLeaf(rememberedLeaf);
  const reopenedView = makeView("Daily.md", POMODORO_NOTE, { line: 0, ch: 0 });
  app.dailyView = reopenedView;

  assert.equal(await plugin.jumpToCurrentPomodoro(workLeaf.view.editor), true);
  assert.deepEqual(reopenedView.editor.setCursorCalls, [{ line: 2, ch: 6 }]);
  assert.deepEqual(reopenedView.editor.scrollDOM.scrollToCalls[0], {
    top: 525,
    left: 17,
  });
  assert.deepEqual(reopenedView.editor.scrollIntoViewCalls, []);
  frames.flushAll();
  assert.deepEqual(reopenedView.editor.cursor, { line: 2, ch: 6 });
  assert.equal(reopenedView.editor.scrollDOM.scrollTop, 525);
});

test("different-path and invalid locations do not leak into a daily note", async (t) => {
  const workView = makeView("Work.md", "# Work", { line: 0, ch: 0 });
  const dailyView = makeView("Daily.md", POMODORO_NOTE, { line: 1, ch: 2 });
  const workspace = new TestWorkspace(makeLeaf(workView));
  const app = makeApp(workspace, dailyView);
  const { plugin } = setupPlugin(t, app);
  plugin.dailyLocations.set("Yesterday.md", {
    cursor: { line: 3, ch: 1 },
    scrollTop: 700,
  });
  plugin.dailyLocations.set("Daily.md", {
    cursor: { line: -4, ch: 8 },
    scrollTop: "invalid",
  });

  assert.equal(
    helpers.normalizeDailyLocation({
      cursor: { line: -1, ch: 0 },
      scrollTop: "invalid",
    }),
    null,
  );
  assert.equal(await plugin.jumpToCurrentPomodoro(workView.editor), true);
  assert.deepEqual(dailyView.editor.setCursorCalls, []);
  assert.deepEqual(dailyView.editor.scrollDOM.scrollToCalls, []);
  assert.deepEqual(dailyView.editor.cursor, { line: 1, ch: 2 });
});

test("out-of-range remembered coordinates are clamped safely", async (t) => {
  const workView = makeView("Work.md", "# Work", { line: 0, ch: 0 });
  const dailyView = makeView("Daily.md", "one\ntwo\nend", { line: 0, ch: 0 }, {
    scrollHeight: 1000,
    clientHeight: 250,
    scrollWidth: 500,
    clientWidth: 200,
  });
  const workspace = new TestWorkspace(makeLeaf(workView));
  const app = makeApp(workspace, dailyView);
  const { plugin } = setupPlugin(t, app);
  plugin.dailyLocations.set("Daily.md", {
    cursor: { line: 999, ch: 999 },
    scrollTop: 9999,
    scrollLeft: -40,
  });

  assert.equal(await plugin.jumpToCurrentPomodoro(workView.editor), true);
  assert.deepEqual(dailyView.editor.setCursorCalls, [{ line: 2, ch: 3 }]);
  assert.deepEqual(dailyView.editor.scrollDOM.scrollToCalls[0], {
    top: 750,
    left: 0,
  });
});

test("a rapid second press cancels an older fallback restore", async (t) => {
  const workView = makeView("Work.md", "# Work", { line: 0, ch: 0 });
  const dailyView = makeView("Daily.md", POMODORO_NOTE, { line: 0, ch: 0 });
  const workspace = new TestWorkspace(makeLeaf(workView));
  const app = makeApp(workspace, dailyView);
  let releaseOpen;
  const openGate = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  app.commands.executeCommandById = async () => {
    app.dailyCommandCalls += 1;
    workspace.openFreshView(dailyView);
    await openGate;
    return true;
  };
  const { plugin, frames } = setupPlugin(t, app);
  plugin.dailyLocations.set("Daily.md", {
    cursor: { line: 2, ch: 4 },
    scrollTop: 600,
    scrollLeft: 10,
  });

  const firstPress = plugin.jumpToCurrentPomodoro(workView.editor);
  assert.equal(workspace.getActiveFile().path, "Daily.md");
  assert.equal(plugin.jumpToCurrentPomodoro(dailyView.editor), true);
  releaseOpen();
  assert.equal(await firstPress, true);
  frames.flushAll();

  assert.deepEqual(dailyView.editor.cursor, { line: 3, ch: 0 });
  assert.deepEqual(dailyView.editor.setCursorCalls, [{ line: 3, ch: 0 }]);
  assert.deepEqual(dailyView.editor.scrollDOM.scrollToCalls, []);
  assert.equal(plugin.pendingDailyLocationRestoreDeferred, null);
});

test("navigation and unload clean up daily scroll listeners and deferred work", (t) => {
  const dailyView = makeView("Daily.md", POMODORO_NOTE, { line: 1, ch: 0 });
  const dailyLeaf = makeLeaf(dailyView);
  const laterView = makeView("Later.md", "# Later", { line: 0, ch: 0 });
  const laterLeaf = makeLeaf(laterView);
  const workspace = new TestWorkspace(dailyLeaf, [dailyLeaf, laterLeaf]);
  const app = makeApp(workspace, dailyView);
  const { plugin, frames } = setupPlugin(t, app);

  assert.equal(dailyView.editor.scrollDOM.listeners.has("scroll"), true);
  plugin.restoreOrDeferDailyLocation("Daily.md", {
    cursor: { line: 2, ch: 2 },
    scrollTop: 400,
    scrollLeft: 5,
  });
  const writesBeforeNavigation = dailyView.editor.scrollDOM.scrollToCalls.length;
  workspace.activateLeaf(laterLeaf);

  assert.equal(dailyView.editor.scrollDOM.listeners.has("scroll"), false);
  assert.equal(plugin.pendingDailyLocationRestoreDeferred, null);
  frames.flushAll();
  assert.equal(
    dailyView.editor.scrollDOM.scrollToCalls.length,
    writesBeforeNavigation,
  );
  assert.deepEqual(laterView.editor.setCursorCalls, []);
  assert.deepEqual(laterView.editor.scrollDOM.scrollToCalls, []);

  dailyView.editor.scrollDOM.emitScroll();
  assert.equal(frames.callbacks.size, 0);
  plugin.onunload();
  assert.equal(plugin.dailyLocations.size, 0);
});
