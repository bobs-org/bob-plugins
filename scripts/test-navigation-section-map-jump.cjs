const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");
const { ElementStub } = require("./modal-harness.cjs");

function makeDoc() {
  const body = new ElementStub({ tag: "body" });
  const doc = {
    body,
    createElement(tag) {
      const el = new ElementStub({ tag });
      el.ownerDocument = doc;
      return el;
    },
    querySelectorAll() {
      return [];
    },
    contains() {
      return true;
    },
    defaultView: null,
  };
  body.ownerDocument = doc;
  return doc;
}

function makeEditor(content, cursorLine = 0) {
  const editor = {
    content,
    cursor: { line: cursorLine, ch: 0 },
    setCursorCalls: [],
    scrollIntoViewCalls: [],
    getValue() {
      return this.content;
    },
    getCursor() {
      return { ...this.cursor };
    },
    setCursor(lineOrPosition, ch) {
      const position =
        typeof lineOrPosition === "object"
          ? lineOrPosition
          : { line: lineOrPosition, ch };
      this.cursor = { ...position };
      this.setCursorCalls.push({ ...position });
    },
    scrollIntoView(position, ...rest) {
      this.scrollIntoViewCalls.push({ position, rest });
    },
  };
  const dispatches = [];
  editor.cm = {
    state: {
      get doc() {
        const current = String(editor.content || "").split(/\r?\n/);
        return {
          lines: current.length,
          line(number) {
            const index = Math.max(0, Math.min(current.length - 1, number - 1));
            const from = current
              .slice(0, index)
              .reduce((sum, line) => sum + line.length + 1, 0);
            return {
              from,
              to: from + String(current[index] || "").length,
              number,
            };
          },
        };
      },
    },
    dispatch(transaction) {
      dispatches.push(transaction);
    },
    dispatches,
    scrollDOM: null,
    contentDOM: null,
    dom: null,
  };
  return editor;
}

function makeView(editor, doc) {
  const contentEl = new ElementStub({ tag: "div" });
  contentEl.ownerDocument = doc;
  contentEl.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 600,
    right: 1000,
    bottom: 600,
  });
  contentEl.isConnected = true;
  const leaf = { id: "leaf-1", view: null };
  const view = {
    editor,
    contentEl,
    containerEl: contentEl,
    file: { path: "Note.md", extension: "md", basename: "Note" },
    leaf,
    getViewType: () => "markdown",
  };
  leaf.view = view;
  return { view, leaf, contentEl };
}

function makePlugin(view) {
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = {
    workspace: {
      activeLeaf: view.leaf,
      getActiveViewOfType: () => view,
      on: () => ({}),
      iterateAllLeaves: (callback) => callback(view.leaf),
      containerEl: view.contentEl,
    },
  };
  plugin.addCommand = () => {};
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.getActiveMarkdownView = () => view;
  plugin.isMarkdownFile = () => true;
  plugin.bobOpenNotesLandingFlashDurationMs = () => 5;
  return plugin;
}

function flashEffects(editor) {
  return editor.cm.dispatches
    .map((transaction) => transaction.effects)
    .filter(
      (effect) =>
        effect &&
        effect.is &&
        effect.is(helpers.bobOpenNotesLandingFlashEffect),
    );
}

function descendants(element) {
  return (element?.children || []).flatMap((child) => [
    child,
    ...descendants(child),
  ]);
}

function byAttr(root, name, value) {
  return descendants(root).filter(
    (node) => node.attributes && node.attributes[name] === value,
  );
}

async function afterDispatch() {
  await new Promise((resolve) => queueMicrotask(resolve));
}

test("section-nav cases land identically through jumpToSectionHeader", () => {
  const cases = [
    {
      lines: [
        "---",
        "# Frontmatter pseudo-heading",
        "---",
        "# First",
        "Introduction",
        "```md",
        "## Fenced pseudo-heading",
        "```",
        "## Middle",
        "Details",
        "### Last",
      ],
      from: 4,
      direction: 1,
      target: 8,
    },
    {
      lines: [
        "---",
        "# Frontmatter pseudo-heading",
        "---",
        "# First",
        "Introduction",
        "```md",
        "## Fenced pseudo-heading",
        "```",
        "## Middle",
        "Details",
        "### Last",
      ],
      from: 9,
      direction: -1,
      target: 8,
    },
    {
      lines: ["# First", "Body", "## Last"],
      from: 0,
      direction: 1,
      target: 2,
    },
    {
      lines: ["# First", "Body", "## Last"],
      from: 2,
      direction: 1,
      target: 0,
    },
    {
      lines: ["# First", "Body", "## Last"],
      from: 0,
      direction: -1,
      target: 2,
    },
  ];

  const doc = makeDoc();
  for (const item of cases) {
    notices.length = 0;
    const editor = makeEditor(item.lines.join("\n"), item.from);
    const { view } = makeView(editor, doc);
    const plugin = makePlugin(view);
    assert.equal(plugin.jumpToSectionHeader(editor, item.direction, view), true);
    assert.equal(editor.cursor.line, item.target);
    assert.equal(editor.cursor.ch, 0);
    assert.deepEqual(notices, []);
  }
});

test("scrolls with CM when it exists and falls back to editor.scrollIntoView otherwise", () => {
  const original = helpers.EditorView.scrollIntoView;
  helpers.EditorView.scrollIntoView = (pos, spec) => ({ pos, spec, type: "scroll" });
  try {
    const doc = makeDoc();
    const lines = ["# First", "body", "# Second"];
    const editor = makeEditor(lines.join("\n"), 0);
    const { view } = makeView(editor, doc);
    const plugin = makePlugin(view);
    assert.equal(plugin.jumpToSectionHeader(editor, 1, view), true);
    assert.equal(editor.scrollIntoViewCalls.length, 0);
    const scroll = editor.cm.dispatches.find(
      (transaction) => transaction.effects && transaction.effects.type === "scroll",
    );
    assert.ok(scroll);
    assert.equal(scroll.effects.spec.y, "start");
  } finally {
    helpers.EditorView.scrollIntoView = original;
  }

  const doc = makeDoc();
  const editor = makeEditor("# First\nbody\n# Second", 0);
  delete editor.cm;
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  assert.equal(plugin.jumpToSectionHeader(editor, 1, view), true);
  assert.equal(editor.cursor.line, 2);
  assert.ok(editor.scrollIntoViewCalls.length > 0);
});

test("wrapped is true only when a multi-heading jump is not strictly past the cursor", () => {
  const doc = makeDoc();
  const content = "# First\nbody\n# Second";
  const down = makeEditor(content, 2);
  const { view: downView } = makeView(down, doc);
  const downPlugin = makePlugin(downView);
  downPlugin.jumpToSectionHeader(down, 1, downView);
  assert.equal(downPlugin.sectionMapWrapped, true);

  const up = makeEditor(content, 0);
  const { view: upView } = makeView(up, doc);
  const upPlugin = makePlugin(upView);
  upPlugin.jumpToSectionHeader(up, 1, upView);
  assert.equal(upPlugin.sectionMapWrapped, false);

  const single = makeEditor("# Only", 0);
  const { view: onlyView } = makeView(single, doc);
  const onlyPlugin = makePlugin(onlyView);
  onlyPlugin.jumpToSectionHeader(single, 1, onlyView);
  assert.equal(onlyPlugin.sectionMapWrapped, false);
});

test("a successful jump flashes the landing line", () => {
  const doc = makeDoc();
  const editor = makeEditor("# First\nbody\n# Second", 0);
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  plugin.jumpToSectionHeader(editor, 1, view);
  const effects = flashEffects(editor);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].value.line, 2);
  assert.equal(effects[0].value.clear, false);
});

test("a throwing painter leaves the cursor, return value, and notices unchanged", () => {
  notices.length = 0;
  const doc = makeDoc();
  const editor = makeEditor("# First\nbody\n# Second", 0);
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  plugin.showSectionMapAfterJump = () => {
    throw new Error("painter boom");
  };
  assert.equal(plugin.jumpToSectionHeader(editor, 1, view), true);
  assert.equal(editor.cursor.line, 2);
  assert.deepEqual(notices, []);
});

test("throwing map arm, cache, or flash still moves the cursor like a normal jump", () => {
  const doc = makeDoc();
  const content = "# First\nbody\n# Second";

  notices.length = 0;
  const armed = makeEditor(content, 0);
  const { view: armedView } = makeView(armed, doc);
  const armedPlugin = makePlugin(armedView);
  const order = [];
  const originalArm = armedPlugin.armSectionMapSelection.bind(armedPlugin);
  armedPlugin.armSectionMapSelection = (...args) => {
    order.push("arm");
    originalArm(...args);
  };
  const originalSet = armed.setCursor.bind(armed);
  armed.setCursor = (...args) => {
    order.push("cursor");
    originalSet(...args);
  };
  assert.equal(armedPlugin.jumpToSectionHeader(armed, 1, armedView), true);
  assert.equal(order[0], "arm");
  assert.ok(order.includes("cursor"));
  assert.ok(order.indexOf("arm") < order.indexOf("cursor"));
  assert.equal(armed.cursor.line, 2);
  assert.deepEqual(notices, []);

  notices.length = 0;
  const throwingArm = makeEditor(content, 0);
  const { view: throwingArmView } = makeView(throwingArm, doc);
  const throwingArmPlugin = makePlugin(throwingArmView);
  throwingArmPlugin.armSectionMapSelection = () => {
    throw new Error("arm boom");
  };
  assert.equal(throwingArmPlugin.jumpToSectionHeader(throwingArm, 1, throwingArmView), true);
  assert.equal(throwingArm.cursor.line, 2);
  assert.deepEqual(notices, []);

  notices.length = 0;
  const cache = makeEditor(content, 0);
  const { view: cacheView } = makeView(cache, doc);
  const cachePlugin = makePlugin(cacheView);
  cachePlugin.getSectionMapHeadingEntries = () => {
    throw new Error("cache boom");
  };
  assert.equal(cachePlugin.jumpToSectionHeader(cache, 1, cacheView), true);
  assert.equal(cache.cursor.line, 2);
  assert.deepEqual(notices, []);

  notices.length = 0;
  const flash = makeEditor(content, 0);
  const { view: flashView } = makeView(flash, doc);
  const flashPlugin = makePlugin(flashView);
  flashPlugin.flashEditorLandingLine = () => {
    throw new Error("flash boom");
  };
  assert.equal(flashPlugin.jumpToSectionHeader(flash, 1, flashView), true);
  assert.equal(flash.cursor.line, 2);
  assert.deepEqual(notices, []);

  notices.length = 0;
  const peek = makeEditor(content, 1);
  const { view: peekView } = makeView(peek, doc);
  const peekPlugin = makePlugin(peekView);
  peekPlugin.armSectionMapSelection = () => {
    throw new Error("peek arm boom");
  };
  peekPlugin.showSectionMapPeek = () => {
    throw new Error("peek painter boom");
  };
  assert.equal(peekPlugin.showSectionMap(peek, peekView), true);
  assert.equal(peek.cursor.line, 1);
  assert.deepEqual(notices, []);
});

test("activity dismissal uses event identity and window clocks, not raw timeStamps", async () => {
  const previousWindow = globalThis.window;
  const pluginNow = { value: 100000 };
  const pluginWin = {
    performance: { now: () => pluginNow.value },
    queueMicrotask: (fn) => queueMicrotask(fn),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => {
      fn();
      return 1;
    },
    cancelAnimationFrame() {},
  };
  globalThis.window = pluginWin;
  try {
    const doc = makeDoc();
    doc.defaultView = pluginWin;
    const editor = makeEditor("# First\nbody\n# Second", 0);
    const { view } = makeView(editor, doc);
    view.contentEl.ownerDocument = doc;
    const plugin = makePlugin(view);

    const jumpEvent = { key: "j", ctrlKey: true, timeStamp: 100000, view: pluginWin };
    plugin.sectionMapActiveKeyEvent = jumpEvent;
    plugin.jumpToSectionHeader(editor, 1, view);
    plugin.handleSectionMapCaptureKeydown(jumpEvent);
    await afterDispatch();
    assert.notEqual(plugin.sectionMapLifecycle.getState(), "hidden");
    assert.notEqual(plugin.sectionMapLifecycle.snapshot().fadeKind, "dismiss");

    const generation = plugin.sectionMapLifecycle.getGeneration();
    const youngWin = {
      performance: { now: () => 100 },
      queueMicrotask: (fn) => queueMicrotask(fn),
    };
    plugin.handleSectionMapCaptureKeydown({
      key: "Escape",
      ctrlKey: false,
      timeStamp: 100,
      view: youngWin,
    });
    await afterDispatch();
    assert.equal(plugin.sectionMapLifecycle.getState(), "fading");
    assert.equal(plugin.sectionMapLifecycle.snapshot().fadeKind, "dismiss");
    assert.equal(plugin.sectionMapLifecycle.getGeneration(), generation);

    plugin.sectionMapLastCommandStamp = 100000;
    plugin.sectionMapLastCommandEvent = jumpEvent;
    plugin.sectionMapActiveKeyEvent = jumpEvent;
    plugin.sectionMapLifecycle.showPeek();
    assert.equal(plugin.sectionMapLifecycle.getState(), "pinned");
    plugin.handleSectionMapCaptureKeydown({
      key: "Escape",
      ctrlKey: false,
      timeStamp: 100,
      view: youngWin,
    });
    await afterDispatch();
    assert.equal(plugin.sectionMapLifecycle.getState(), "fading");
    assert.equal(plugin.sectionMapLifecycle.snapshot().fadeKind, "dismiss");

    plugin.teardownSectionMapController();
    assert.equal(plugin.sectionMapLifecycle, null);
    assert.equal(plugin.sectionMapControllerReady, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("zero-heading notes keep today's notices", () => {
  notices.length = 0;
  const doc = makeDoc();
  const editor = makeEditor("no headings here", 0);
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  assert.equal(plugin.jumpToSectionHeader(editor, 1, view), false);
  assert.deepEqual(notices, ["No next section header"]);
  notices.length = 0;
  assert.equal(plugin.jumpToSectionHeader(editor, -1, view), false);
  assert.deepEqual(notices, ["No previous section header"]);
  assert.equal(editor.cursor.line, 0);
});

test("peek does not move the cursor and notices when the note has no headers", () => {
  const doc = makeDoc();
  const editor = makeEditor("# First\nbody\n# Second", 1);
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  assert.equal(plugin.showSectionMap(editor, view), true);
  assert.equal(editor.cursor.line, 1);
  assert.equal(plugin.sectionMapLifecycle.getState(), "pinned");
  // The host mounts at the document top level (position:fixed must match
  // viewport-relative placement rects), never inside the pane.
  const hosts = byAttr(doc.body, "data-bob-section-map", "host");
  assert.equal(hosts.length, 1);
  assert.equal(byAttr(view.contentEl, "data-bob-section-map", "host").length, 0);

  notices.length = 0;
  const empty = makeEditor("plain", 0);
  const { view: emptyView } = makeView(empty, doc);
  const emptyPlugin = makePlugin(emptyView);
  assert.equal(emptyPlugin.showSectionMap(empty, emptyView), false);
  assert.equal(empty.cursor.line, 0);
  assert.deepEqual(notices, ["No section headers"]);
});

test("the jump's own selection keeps the map; a later line or a doc change dismisses it", () => {
  const doc = makeDoc();
  const editor = makeEditor("# First\nbody\n# Second", 0);
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  plugin.jumpToSectionHeader(editor, 1, view);
  assert.equal(plugin.sectionMapLifecycle.getState(), "lingering");

  plugin.handleSectionMapEditorUpdate({
    selectionSet: true,
    docChanged: false,
    state: {
      selection: { main: { head: 10 } },
      doc: { lineAt: () => ({ number: 3 }) },
    },
  });
  assert.equal(plugin.sectionMapLifecycle.getState(), "lingering");

  plugin.handleSectionMapEditorUpdate({
    selectionSet: true,
    docChanged: false,
    state: {
      selection: { main: { head: 0 } },
      doc: { lineAt: () => ({ number: 1 }) },
    },
  });
  assert.equal(plugin.sectionMapLifecycle.getState(), "fading");

  plugin.jumpToSectionHeader(editor, -1, view);
  plugin.handleSectionMapEditorUpdate({ docChanged: true, selectionSet: false });
  assert.equal(plugin.sectionMapLifecycle.getState(), "fading");
  assert.equal(plugin.sectionMapLifecycle.snapshot().fadeKind, "dismiss");
});

test("a non-modifier keydown without a jump dismisses after dispatch; a jump in the same turn keeps the map", async () => {
  const doc = makeDoc();
  const editor = makeEditor("# First\nbody\n# Second", 0);
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  plugin.jumpToSectionHeader(editor, 1, view);
  plugin.handleSectionMapCaptureKeydown({ key: "j", ctrlKey: false });
  await afterDispatch();
  assert.equal(plugin.sectionMapLifecycle.getState(), "fading");
  assert.equal(plugin.sectionMapLifecycle.snapshot().fadeKind, "dismiss");

  plugin.jumpToSectionHeader(editor, -1, view);
  const generation = plugin.sectionMapLifecycle.getGeneration();
  plugin.handleSectionMapCaptureKeydown({ key: "j", ctrlKey: true });
  plugin.jumpToSectionHeader(editor, 1, view);
  await afterDispatch();
  assert.notEqual(plugin.sectionMapLifecycle.getGeneration(), generation);
  assert.notEqual(plugin.sectionMapLifecycle.getState(), "hidden");
  assert.notEqual(plugin.sectionMapLifecycle.snapshot().fadeKind, "dismiss");
});

test("mobile skips the map and still jumps", () => {
  const previous = globalThis.Platform;
  globalThis.Platform = { isMobile: true };
  try {
    const doc = makeDoc();
    const editor = makeEditor("# First\nbody\n# Second", 0);
    const { view } = makeView(editor, doc);
    const plugin = makePlugin(view);
    assert.equal(plugin.jumpToSectionHeader(editor, 1, view), true);
    assert.equal(editor.cursor.line, 2);
    assert.equal(plugin.sectionMapLifecycle, undefined);
    assert.equal(byAttr(view.contentEl, "data-bob-section-map", "host").length, 0);
    assert.equal(byAttr(doc.body, "data-bob-section-map", "host").length, 0);
  } finally {
    if (previous === undefined) delete globalThis.Platform;
    else globalThis.Platform = previous;
  }
});

test("pointerdown dismisses a visible map", () => {
  const doc = makeDoc();
  const editor = makeEditor("# First\nbody\n# Second", 0);
  const { view } = makeView(editor, doc);
  const plugin = makePlugin(view);
  plugin.jumpToSectionHeader(editor, 1, view);
  plugin.handleSectionMapPointerDown({ button: 0 });
  assert.equal(plugin.sectionMapLifecycle.getState(), "fading");
  assert.equal(plugin.sectionMapLifecycle.snapshot().fadeKind, "dismiss");
});

test("no editor keeps today's notice", () => {
  notices.length = 0;
  const plugin = new NavigationHotkeysPlugin();
  plugin.register = () => {};
  assert.equal(plugin.jumpToSectionHeader(null, 1), false);
  assert.deepEqual(notices, ["No active markdown editor"]);
});

test("onload registers show-section-map and passes ctx through the jump commands", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  plugin.app = {
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      onLayoutReady: () => {},
    },
  };
  plugin.addCommand = (command) => commands.push(command);
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.registerVimJumpHistoryVaultEvents = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.registerObsidianProtocolHandler = () => {};
  plugin.onload();
  const ids = commands.map((command) => command.id);
  assert.ok(ids.includes("show-section-map"));
  const next = commands.find((command) => command.id === "jump-to-next-section-header");
  const prev = commands.find((command) => command.id === "jump-to-prev-section-header");
  assert.equal(next.editorCallback.length, 2);
  assert.equal(prev.editorCallback.length, 2);
});
