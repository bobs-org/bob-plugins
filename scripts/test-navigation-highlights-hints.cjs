const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
  createFragmentNode,
} = require("./navigation-hotkeys-harness.cjs");

const BASE = "/vault";
const {
  formatHighlightsHotkey,
  getHighlightsCommandHotkey,
  highlightsHintAction,
  highlightsHintTargetKey,
  highlightsHintChipModel,
  HIGHLIGHTS_HINTS_DEBOUNCE_MS,
  HIGHLIGHTS_OPEN_COMMAND_ID,
  bobHighlightsRailField,
  bobHighlightsRailEffect,
} = helpers;

function makeChipEl() {
  const node = createFragmentNode("div");
  node.classes = node.classes || [];
  node.attrs = node.attrs || {};
  node.listeners = {};
  node.style = {
    _props: {},
    opacity: "",
    setProperty(name, value) {
      this._props[String(name)] = String(value);
    },
  };
  node.classList = {
    add: (...classes) => {
      for (const cls of classes) {
        if (cls && !node.classes.includes(cls)) node.classes.push(cls);
      }
    },
    remove: (...classes) => {
      node.classes = node.classes.filter((item) => !classes.includes(item));
    },
    contains: (cls) => node.classes.includes(cls),
  };
  node.addClass = (cls) => node.classList.add(cls);
  node.setAttribute = (name, value) => {
    node.attrs[String(name)] = String(value);
  };
  node.getAttribute = (name) => node.attrs[String(name)] ?? null;
  node.removeAttribute = (name) => {
    delete node.attrs[String(name)];
  };
  node.empty = () => {
    node.children = [];
    node.text = "";
  };
  node.addEventListener = (type, fn) => {
    node.listeners[type] = node.listeners[type] || [];
    node.listeners[type].push(fn);
  };
  node.createEl = (tag, opts = {}) => {
    const child = makeChipEl();
    child.tag = tag;
    if (opts.cls) child.classList.add(opts.cls);
    if (opts.text !== undefined) child.text = String(opts.text);
    node.children.push(child);
    return child;
  };
  node.createSpan = (opts = {}) => node.createEl("span", opts);
  node.setText = (value) => {
    node.text = String(value);
  };
  return node;
}

function makePageHarness(content, options = {}) {
  const files = new Map();
  const blocksByPath = new Map();
  const addFile = (filePath, body = "", frontmatter = {}, blocks = null) => {
    const file = {
      path: filePath,
      extension: path.extname(filePath).slice(1).toLowerCase(),
      content: body,
      stat: { mtime: options.mtime || 1 },
    };
    files.set(filePath, { file, body, frontmatter });
    if (blocks) blocksByPath.set(filePath, blocks);
    return file;
  };
  const currentPath = options.currentPath || "sase.md";
  const currentFile = addFile(
    currentPath,
    content,
    options.currentFrontmatter || {},
    options.currentBlocks || null,
  );
  for (const entry of options.files || []) {
    addFile(entry.path, entry.content, entry.frontmatter, entry.blocks || null);
  }
  const editorElement = {};
  const bodyElement = {};
  const activeElement = options.focusOutside
    ? { closest: () => null }
    : { closest: () => editorElement };
  const dispatches = [];
  const editorView = {
    dispatches,
    dispatch: (transaction) => dispatches.push(transaction),
    state: {
      doc: {
        lines: String(content).split(/\r?\n/).length,
        line: (number) => ({ from: number - 1 }),
      },
    },
  };
  const view = {
    file: currentFile,
    editor: {
      getValue: () => content,
      getCursor: () => ({ line: options.line || 0, ch: 0 }),
      cm: editorView,
      replaceRange() {
        throw new Error("The PDF key must never write the editor");
      },
    },
    getMode: () => options.mode || "source",
    containerEl: {
      ownerDocument: { activeElement, body: bodyElement },
      contains: (element) => element === editorElement,
    },
  };
  const delegates = [];
  const launches = [];
  const pdfs = new Set(
    options.pdfs === undefined ? ["lib/chat/x.pdf"] : options.pdfs,
  );
  for (const pdfPath of pdfs) {
    if (!files.has(pdfPath)) addFile(pdfPath);
  }
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin._highlightsLaunchActive = false;
  plugin._highlightsLastLaunchEnd = 0;
  plugin.highlightsHintsEnabled = true;
  plugin.app = {
    workspace: { getActiveViewOfType: () => (options.noView ? null : view) },
    commands: { executeCommandById: (id) => delegates.push(id) },
    hotkeyManager: options.hotkeyManager || {
      getHotkeys: () => [{ modifiers: ["Meta"], key: "Enter" }],
      getDefaultHotkeys: () => [],
    },
    metadataCache: {
      getFileCache: (file) => {
        const entry = file && files.get(file.path);
        if (!entry) return null;
        const blocks = file && blocksByPath.get(file.path);
        return { frontmatter: entry.frontmatter, blocks: blocks || undefined };
      },
      getFirstLinkpathDest: (linkpath) => {
        const destPath = (options.linkpathDests || {})[linkpath];
        return destPath ? (files.get(destPath) || {}).file || null : null;
      },
    },
    vault: {
      adapter: {
        exists: async (filePath) => pdfs.has(filePath),
        getBasePath: () => BASE,
      },
      getAbstractFileByPath: (filePath) =>
        (files.get(filePath) || {}).file || null,
      getMarkdownFiles: () =>
        [...files.values()]
          .map((entry) => entry.file)
          .filter((file) => file && file.extension === "md"),
      cachedRead: async (file) => {
        const entry = file && files.get(file.path);
        return entry ? entry.body : null;
      },
      modify() {
        throw new Error("The PDF key must never modify the vault");
      },
    },
  };
  plugin.isMarkdownFile = (file) => Boolean(file && file.extension === "md");
  plugin.getVaultBasePath = () => BASE;
  plugin.resolveLinkTargetFile = (target, sourcePath) => {
    const targetPath = String(target || "").split("#", 1)[0].trim();
    if (!targetPath) return (files.get(sourcePath) || {}).file || null;
    return (
      [targetPath, `${targetPath}.md`]
        .map((candidate) => (files.get(candidate) || {}).file)
        .find(Boolean) || null
    );
  };
  plugin.readLinkPickerNoteContent = async (filePath, file) => {
    const entry = files.get(filePath || (file && file.path));
    return entry ? entry.body : null;
  };
  const execFile = (executable, args, execOptions, callback) => {
    launches.push({ executable, args: [...args], options: execOptions });
    queueMicrotask(() => callback(null, "", ""));
  };
  const boundOpen = plugin.openReferencePdfPath.bind(plugin);
  plugin.openReferencePdfPath = (filePath, openOptions = {}) =>
    boundOpen(filePath, {
      execFile,
      isMacOS: options.isMacOS !== false,
      basePath: BASE,
      exists: async (vaultPath) => pdfs.has(vaultPath),
      ...openOptions,
    });
  return { plugin, view, files, delegates, launches, editorView };
}

function refNoteWithBlock() {
  return [
    "# Example",
    "",
    "- [ ] #task #ref [[lib/chat/x.pdf]] ^ref",
    "",
    "## Highlights",
    "",
    "<!-- highlights:begin -->",
    "",
    "### Page 12",
    "",
    "> [!quote] Latency is not throughput.",
    ">",
    "> > [!note] Comment Compare.",
    "",
    "^h-2b91f0a4c7de",
    "",
    "<!-- highlights:end -->",
  ].join("\n");
}

function chipOptions(overrides = {}) {
  return {
    enabled: true,
    isMacOS: true,
    mode: "source",
    hasEditor: true,
    keycap: "\u2318\u21b5",
    ...overrides,
  };
}

function resetNotices() {
  notices.length = 0;
}

function keyActionFromLaunch(harness) {
  if (harness.delegates.length) return { type: "delegate" };
  if (!harness.launches.length) return { type: "explain" };
  const pageCall = harness.launches.find(
    (item) => Array.isArray(item.args) && item.args[0] === "-g",
  );
  if (pageCall) {
    const match = /page=(\d+)/.exec(String(pageCall.args[1] || ""));
    return { type: "open", page: match ? Number(match[1]) : null };
  }
  return { type: "open", page: null };
}

test("chip view model covers every Highlights hint state", () => {
  const reading = highlightsHintChipModel(
    { kind: "reading", title: "Gas Town", page: null },
    chipOptions(),
  );
  assert.equal(reading.visible, true);
  assert.equal(reading.muted, false);
  assert.equal(reading.label, "Highlights");
  assert.equal(reading.pageText, "");
  assert.equal(reading.keycap, "\u2318\u21b5");
  assert.equal(
    reading.tooltip,
    "Open \u201cGas Town\u201d in Highlights \u2014 resumes where you left off (\u2318\u21b5)",
  );
  assert.equal(reading.action.type, "open");
  assert.equal(reading.action.page, null);

  const paged = highlightsHintChipModel(
    { kind: "page", title: "The paper", page: 4 },
    chipOptions(),
  );
  assert.equal(paged.pageText, " \u00b7 p. 4");
  assert.equal(
    paged.tooltip,
    "Open \u201cThe paper\u201d at page 4 in Highlights (\u2318\u21b5)",
  );
  assert.equal(paged.action.type, "open");
  assert.equal(paged.action.page, 4);

  const unknown = highlightsHintChipModel(
    { kind: "page", title: "The paper", page: null },
    chipOptions(),
  );
  assert.equal(unknown.pageText, "");
  assert.equal(unknown.keycap, "\u2318\u21b5");
  assert.match(unknown.tooltip, /Open \u201cThe paper\u201d in Highlights/);

  const removed = highlightsHintChipModel(
    { kind: "removed", message: "This highlight was removed in Highlights — no page to open" },
    chipOptions(),
  );
  assert.equal(removed.visible, true);
  assert.equal(removed.muted, true);
  assert.equal(removed.label, "Highlight removed");
  assert.equal(removed.keycap, "");

  const missing = highlightsHintChipModel(
    { kind: "missing-highlight", message: "Can't find highlight h-1" },
    chipOptions(),
  );
  assert.equal(missing.label, "Highlight not found");
  assert.equal(missing.muted, true);

  const pdf = highlightsHintChipModel(
    { kind: "error", message: "Reference PDF not found: lib/x.pdf" },
    chipOptions(),
  );
  assert.equal(pdf.label, "PDF missing");
  assert.equal(pdf.muted, true);

  assert.equal(
    highlightsHintChipModel({ kind: "page", page: 4 }, chipOptions({ isMacOS: false })).visible,
    false,
  );
  assert.equal(
    highlightsHintChipModel({ kind: "page", page: 4 }, chipOptions({ mode: "preview" })).visible,
    false,
  );
  assert.equal(
    highlightsHintChipModel({ kind: "page", page: 4 }, chipOptions({ enabled: false })).visible,
    false,
  );
  assert.equal(
    highlightsHintChipModel({ kind: "none" }, chipOptions()).visible,
    false,
  );
  assert.equal(
    highlightsHintChipModel({ kind: "page", page: 4 }, chipOptions({ hasEditor: false })).visible,
    false,
  );
});

test("keycap formatting maps Meta+Enter, remaps, and unbound to none", () => {
  assert.equal(
    formatHighlightsHotkey({ modifiers: ["Meta"], key: "Enter" }),
    "\u2318\u21b5",
  );
  assert.equal(
    formatHighlightsHotkey({ modifiers: ["Mod"], key: "Enter" }),
    "\u2318\u21b5",
  );
  assert.equal(
    formatHighlightsHotkey({ modifiers: ["Ctrl", "Shift"], key: "h" }),
    "\u2303\u21e7H",
  );
  assert.equal(
    formatHighlightsHotkey({ modifiers: ["Alt"], key: "Enter" }),
    "\u2325\u21b5",
  );
  assert.equal(formatHighlightsHotkey(null), "");
  assert.equal(formatHighlightsHotkey({ modifiers: [], key: "" }), "");
  const app = {
    hotkeyManager: {
      getHotkeys: () => [{ modifiers: ["Meta"], key: "Enter" }],
      getDefaultHotkeys: () => [{ modifiers: ["Mod"], key: "Enter" }],
    },
  };
  assert.deepEqual(getHighlightsCommandHotkey(app), {
    modifiers: ["Meta"],
    key: "Enter",
  });
  const remapped = {
    hotkeyManager: {
      getHotkeys: () => [{ modifiers: ["Ctrl"], key: "H" }],
      getDefaultHotkeys: () => [{ modifiers: ["Meta"], key: "Enter" }],
    },
  };
  assert.equal(
    formatHighlightsHotkey(getHighlightsCommandHotkey(remapped)),
    "\u2303H",
  );
  const unbound = {
    hotkeyManager: {
      getHotkeys: () => [],
      getDefaultHotkeys: () => [],
    },
  };
  assert.equal(getHighlightsCommandHotkey(unbound), null);
  assert.equal(HIGHLIGHTS_OPEN_COMMAND_ID.endsWith("open-reference-pdf-in-highlights"), true);
});

test("a chip click opens the cached target and never re-resolves", async () => {
  resetNotices();
  const previous = global.Platform;
  global.Platform = { isMacOS: true };
  try {
    const harness = makePageHarness("- [ ] #task #ref [[lib/chat/x.pdf]]", {
      currentPath: "ref/chat/x.md",
      currentFrontmatter: { source_pdf: "lib/chat/x.pdf", title: "Gas Town" },
    });
    const el = makeChipEl();
    harness.plugin.addStatusBarItem = () => el;
    harness.plugin.registerDomEvent = (node, type, fn) => node.addEventListener(type, fn);
    const original = harness.plugin.resolveHighlightsTargetAtCursor.bind(harness.plugin);
    const target = await original(harness.view.editor, harness.view.file, {
      dry: true,
    });
    harness.plugin.setupHighlightsHints();
    await harness.plugin.refreshHighlightsHints();
    await new Promise((resolve) => setTimeout(resolve, 10));
    let resolved = 0;
    harness.plugin.resolveHighlightsTargetAtCursor = async (...args) => {
      resolved += 1;
      return original(...args);
    };
    harness.plugin._highlightsHintTarget = target;
    harness.plugin.getRefPdfEditorContext = () => null;
    const click = (el.listeners.click || [])[0];
    assert.equal(typeof click, "function");
    await click();
    assert.equal(resolved, 0);
    assert.equal(harness.launches.length, 1);
    assert.equal(harness.delegates.length, 0);
  } finally {
    if (previous === undefined) delete global.Platform;
    else global.Platform = previous;
  }
});

test("the rail field paints inclusive source lines and clears", () => {
  const field = bobHighlightsRailField;
  assert.ok(field);
  const document = { lines: 5, line: (number) => ({ from: (number - 1) * 10 }) };
  let decoration = field.create();
  decoration = field.update(decoration, {
    effects: [bobHighlightsRailEffect.of({ from: 1, to: 3 })],
    docChanged: false,
    state: { doc: document },
  });
  assert.equal(decoration.ranges.length, 3);
  assert.equal(decoration.ranges[0].spec.class, "bob-highlights-rail");
  assert.equal(decoration.ranges[0].from, 10);
  assert.equal(decoration.ranges[2].from, 30);
  decoration = field.update(decoration, {
    effects: [bobHighlightsRailEffect.of({ clear: true })],
    docChanged: false,
    state: { doc: document },
  });
  assert.strictEqual(decoration, field.create());
});

test("debounce coalesces cursor stillness and skip-paints when the target key is unchanged", async () => {
  const previous = global.Platform;
  global.Platform = { isMacOS: true };
  try {
    const harness = makePageHarness("- [ ] #task #ref [[lib/chat/x.pdf]]", {
      currentPath: "ref/chat/x.md",
      currentFrontmatter: { source_pdf: "lib/chat/x.pdf", title: "Gas Town" },
    });
    const el = makeChipEl();
    harness.plugin.addStatusBarItem = () => el;
    harness.plugin.registerDomEvent = (node, type, fn) => node.addEventListener(type, fn);
    harness.plugin.setupHighlightsHints();
    await harness.plugin.refreshHighlightsHints();
    let refreshes = 0;
    const originalRefresh = harness.plugin.refreshHighlightsHints.bind(
      harness.plugin,
    );
    harness.plugin.refreshHighlightsHints = async (...args) => {
      refreshes += 1;
      return originalRefresh(...args);
    };
    harness.plugin.scheduleHighlightsHints();
    harness.plugin.scheduleHighlightsHints();
    assert.equal(HIGHLIGHTS_HINTS_DEBOUNCE_MS, 120);
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(refreshes, 1);
    const key = harness.plugin.highlightsChipPaintKey;
    const label = el._bobHighlightsChipParts && el._bobHighlightsChipParts.label;
    let sets = 0;
    if (label && typeof label.setText === "function") {
      const originalSet = label.setText.bind(label);
      label.setText = (value) => {
        sets += 1;
        return originalSet(value);
      };
    }
    await originalRefresh();
    assert.equal(harness.plugin.highlightsChipPaintKey, key);
    assert.equal(sets, 0);
  } finally {
    if (previous === undefined) delete global.Platform;
    else global.Platform = previous;
  }
});

test("unload removes the chip DOM, rail, timer, and cached target", async () => {
  const previous = global.Platform;
  global.Platform = { isMacOS: true };
  try {
    const harness = makePageHarness("- [ ] #task #ref [[lib/chat/x.pdf]]", {
      currentPath: "ref/chat/x.md",
      currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    });
    const el = makeChipEl();
    harness.plugin.addStatusBarItem = () => el;
    harness.plugin.registerDomEvent = (node, type, fn) => node.addEventListener(type, fn);
    harness.plugin.setupHighlightsHints();
    harness.plugin.scheduleHighlightsHints();
    await harness.plugin.refreshHighlightsHints();
    harness.plugin._setHighlightsRail(harness.view.editor, { from: 0, to: 0 });
    assert.equal(harness.editorView.dispatches.length > 0, true);
    harness.plugin.teardownHighlightsHints();
    assert.equal(harness.plugin.highlightsChipEl, null);
    assert.equal(harness.plugin._highlightsHintTarget, null);
    assert.equal(harness.plugin._highlightsHintsTimer, null);
    assert.equal(harness.plugin._highlightsRailView, null);
    assert.equal(el.children.length, 0);
    const last = harness.editorView.dispatches.at(-1);
    assert.equal(last.effects.value.clear, true);
  } finally {
    if (previous === undefined) delete global.Platform;
    else global.Platform = previous;
  }
});

test("hint state matches the key for every resolver fixture case", async () => {
  resetNotices();
  const cases = [
    {
      name: "reading task",
      content: "- [ ] #task #ref [[lib/chat/x.pdf]]",
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf", title: "Gas Town" },
      },
    },
    {
      name: "same-note bookmark",
      content: "- [ ] #task See [[#^h-2b91f0a4c7de|\u{1F516}]]",
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
        files: [
          {
            path: "ref/chat/x.md",
            content: refNoteWithBlock(),
            frontmatter: { source_pdf: "lib/chat/x.pdf" },
          },
        ],
      },
    },
    {
      name: "in-note block",
      content: refNoteWithBlock(),
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
        line: 10,
      },
    },
    {
      name: "caption",
      content: refNoteWithBlock(),
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
        line: 8,
      },
    },
    {
      name: "tombstone",
      content: [
        "<!-- highlights:begin -->",
        "",
        "### Removed highlights",
        "",
        "> [!warning] Removed highlight",
        ">",
        "> Gone.",
        "",
        "^h-dead1",
        "",
        "<!-- highlights:end -->",
      ].join("\n"),
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
        line: 4,
      },
    },
    {
      name: "missing highlight",
      content: "- [ ] #task See [[#^h-missing1|\u{1F516}]]",
      options: { currentPath: "sase.md" },
    },
    {
      name: "missing PDF",
      content: "- [ ] #task #ref [[lib/chat/x.pdf]]",
      options: {
        currentPath: "ref/chat/x.md",
        currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
        pdfs: [],
      },
    },
    {
      name: "ordinary prose delegates",
      content: "Just a [[note]]",
      options: { currentPath: "sase.md" },
    },
  ];

  for (const item of cases) {
    resetNotices();
    const dryHarness = makePageHarness(item.content, item.options);
    const dry = await dryHarness.plugin.resolveHighlightsTargetAtCursor(
      dryHarness.view.editor,
      dryHarness.view.file,
      { dry: true },
    );
    const model = highlightsHintChipModel(dry, chipOptions({ keycap: "\u2318\u21b5" }));
    const implied = model.action;

    resetNotices();
    const liveHarness = makePageHarness(item.content, item.options);
    await liveHarness.plugin.openReferencePdfInHighlightsOrLink();
    const happened = keyActionFromLaunch(liveHarness);

    if (implied.type === "delegate") {
      assert.equal(happened.type, "delegate", item.name);
      assert.equal(model.visible, false, item.name);
    } else if (implied.type === "explain") {
      assert.equal(happened.type, "explain", item.name);
      assert.equal(model.visible, true, item.name);
      assert.equal(model.muted, true, item.name);
    } else {
      assert.equal(happened.type, "open", item.name);
      assert.equal(happened.page, implied.page, item.name);
      assert.equal(model.visible, true, item.name);
      assert.equal(model.muted, false, item.name);
      if (implied.page !== null) {
        assert.match(model.pageText, new RegExp(`p\\. ${implied.page}`), item.name);
      }
    }
    assert.equal(highlightsHintAction(dry).type, implied.type, item.name);
    assert.ok(typeof highlightsHintTargetKey(dry) === "string", item.name);
  }
});

test("toggle hides the chip and rail for the session", async () => {
  const previous = global.Platform;
  global.Platform = { isMacOS: true };
  try {
    const harness = makePageHarness("- [ ] #task #ref [[lib/chat/x.pdf]]", {
      currentPath: "ref/chat/x.md",
      currentFrontmatter: { source_pdf: "lib/chat/x.pdf", title: "Gas Town" },
    });
    const el = makeChipEl();
    harness.plugin.addStatusBarItem = () => el;
    harness.plugin.registerDomEvent = (node, type, fn) => node.addEventListener(type, fn);
    harness.plugin.setupHighlightsHints();
    await harness.plugin.refreshHighlightsHints();
    assert.equal(el.classList.contains("is-visible"), true);
    harness.plugin.toggleHighlightsHints();
    assert.equal(harness.plugin.highlightsHintsEnabled, false);
    assert.equal(el.classList.contains("is-visible"), false);
    harness.plugin.toggleHighlightsHints();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(harness.plugin.highlightsHintsEnabled, true);
  } finally {
    if (previous === undefined) delete global.Platform;
    else global.Platform = previous;
  }
});
