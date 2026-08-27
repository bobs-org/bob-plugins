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

test("dependency normalizer writes path-qualified IDs and is idempotent", () => {
  const source = [
    "- [ ] #task Parent [dependsOn:: a1b2c3, custom] ^parent",
    "- [ ] #task Existing [id:: a1b2c3] ^review",
    "- [ ] #task Legacy [id:: custom] ^legacy",
  ].join("\n");
  const result = helpers.normalizeTaskDependencyBlockIds(
    source,
    "projects/Shared.md",
  );
  assert.equal(result.changed, true);
  assert.match(result.text, /\[id:: projects__Shared__review\] \^review/);
  assert.match(result.text, /\[id:: projects__Shared__legacy\] \^legacy/);
  assert.match(
    result.text,
    /\[dependsOn:: projects__Shared__review, projects__Shared__legacy\]/,
  );
  assert.equal(
    helpers.normalizeTaskDependencyBlockIds(result.text, "projects/Shared.md").changed,
    false,
  );
});

test("Tasks-generated IDs become local block IDs when none exists", () => {
  const result = helpers.normalizeTaskDependencyBlockIds(
    "- [ ] #task Target [id:: z9y8x7]",
    "Nested/Target.md",
  );
  assert.equal(
    result.text,
    "- [ ] #task Target [id:: Nested__Target__z9y8x7] ^z9y8x7",
  );
  assert.deepEqual(result.idMap, { z9y8x7: "Nested__Target__z9y8x7" });
});

test("note rename rewrites target IDs and yields exact propagation mappings", () => {
  const result = helpers.rewriteRenamedDependencyIds(
    "- [ ] #task Target [id:: Old__Path__review] ^review\n",
    "Old/Path.md",
    "New/Home.md",
  );
  assert.equal(
    result.text,
    "- [ ] #task Target [id:: New__Home__review] ^review\n",
  );
  assert.deepEqual(result.idMap, {
    Old__Path__review: "New__Home__review",
  });
});

test("note rename also rewrites same-file dependsOn references", () => {
  const result = helpers.rewriteRenamedDependencyIds(
    [
      "- [ ] #task Parent [dependsOn:: Old__Path__review] ^parent",
      "- [ ] #task Target [id:: Old__Path__review] ^review",
    ].join("\n"),
    "Old/Path.md",
    "New/Home.md",
  );
  assert.match(result.text, /\[dependsOn:: New__Home__review\]/);
  assert.match(result.text, /\[id:: New__Home__review\] \^review/);
});

test("dependency normalization skips unsupported paths and fenced examples", () => {
  const source = [
    "```md",
    "- [ ] #task Example [id:: abc123] ^example",
    "- [ ] #task Parent [dependsOn:: abc123]",
    "```",
    "- [ ] #task Real [id:: def456] ^real",
  ].join("\n");
  const supported = helpers.normalizeTaskDependencyBlockIds(source, "Tasks.md");
  assert.match(supported.text, /Example \[id:: abc123\] \^example/);
  assert.match(supported.text, /Parent \[dependsOn:: abc123\]/);
  assert.match(supported.text, /Real \[id:: Tasks__real\] \^real/);

  const unsupported = helpers.normalizeTaskDependencyBlockIds(
    "- [ ] #task Real [id:: def456] ^real",
    "Spaced Note.md",
  );
  assert.equal(helpers.dependencyId("Spaced Note.md", "real"), null);
  assert.equal(unsupported.changed, false);
  assert.equal(unsupported.unsupportedPath, true);
});

test("blocked-dependent planner matches the CLI dependency truth table", () => {
  const documents = [
    {
      path: "Targets.md",
      text: [
        "- [x] #task Closed root [id:: root] ^root",
        "- [ ] #task Other open (id:: other) ^other",
        "- [!] #task Unknown target [id:: unknown] ^unknown",
        "```md",
        "- [ ] #task Fenced target [id:: fenced] ^fenced",
        "```",
      ].join("\n"),
    },
    {
      path: "Dependents.md",
      text: [
        "- [?] #task Bracket [dependsOn:: root] ^bracket",
        "- [?] #task Parenthesized (dependsOn:: root) ^paren",
        "- [?] #task Missing is ignored [dependsOn:: root, missing] ^missing",
        "- [?] #task Other remains open [dependsOn:: root, other] ^remaining",
        "- [?] #task Unknown is not open [dependsOn:: root, unknown] ^unknown-parent",
        "- [?] #task Self remains blocked [id:: self] [dependsOn:: root, self] ^self",
        "- [?] #task Cycle A [id:: cycle-a] [dependsOn:: root, cycle-b] ^cycle-a",
        "- [?] #task Cycle B [id:: cycle-b] [dependsOn:: cycle-a] ^cycle-b",
        "- [ ] #task Already active [dependsOn:: root] ^active",
        "- [x] #task Done dependent [dependsOn:: root] ^done",
        "- [-] #task Canceled dependent [dependsOn:: root] ^canceled",
        "- [~] #task Non-task dependent [dependsOn:: root] ^non-task",
        "- [!] #task Unknown dependent [dependsOn:: root] ^unknown-status",
        "- [?] #task No dependencies ^unrelated",
        "```tasks",
        "- [?] #task Fenced dependent [dependsOn:: root] ^fenced-parent",
        "```",
      ].join("\n"),
    },
  ];
  const plan = helpers.buildBlockedDependentRecoveryPlan(
    documents,
    [
      { path: "Targets.md", blockId: "root" },
      { path: "Targets.md", blockId: "root" },
    ],
  );
  assert.deepEqual(plan.closedIds, ["root"]);
  assert.deepEqual(
    plan.edits.map((edit) => edit.sourceLineText.match(/\^([^ ]+)$/)[1]),
    ["bracket", "paren", "missing", "unknown-parent"],
  );

  const duplicateOpen = helpers.buildBlockedDependentRecoveryPlan(
    [
      ...documents,
      {
        path: "Duplicate.md",
        text: "- [ ] #task Open duplicate [id:: root] ^duplicate",
      },
    ],
    [{ path: "Targets.md", blockId: "root" }],
  );
  assert.equal(duplicateOpen.edits.length, 0);

  const absentIdentity = helpers.buildBlockedDependentRecoveryPlan(
    documents,
    [{ path: "Targets.md", blockId: "absent" }],
  );
  assert.equal(absentIdentity.edits.length, 0);
});

test("blocked-dependent edits preserve EOLs and skip stale lines idempotently", () => {
  const source = [
    "- [?] #task First [dependsOn:: root] ^first",
    "- [?] #task Second (dependsOn:: root) ^second",
  ].join("\r\n");
  const plan = helpers.buildBlockedDependentRecoveryPlan(
    [{ path: "Tasks.md", text: source }],
    [{ path: "Closed.md", taskId: "root" }],
  );
  const staleSource = source.replace("Second", "Second changed");
  const applied = helpers.applyBlockedDependentRecoveryEdits(
    staleSource,
    plan.edits,
  );
  assert.equal(applied.reopened, 1);
  assert.equal(applied.stale.length, 1);
  assert.match(applied.text, /^- \[ \] #task First/m);
  assert.match(applied.text, /^- \[\?\] #task Second changed/m);
  assert.equal(applied.text.includes("\r\n"), true);
  const second = helpers.applyBlockedDependentRecoveryEdits(
    applied.text,
    plan.edits,
  );
  assert.equal(second.reopened, 0);
  assert.equal(second.text, applied.text);
});

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

test("normalization mappings propagate to every dependent file", async () => {
  const harness = createInMemoryObsidianApp({
    "Target.md": "- [ ] #task Target [id:: old] ^review",
    "A.md": "- [ ] #task A [dependsOn:: old]",
    "B.md": "- [ ] #task B [dependsOn:: old, keep]",
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  await plugin.propagateDependencyBlockIds(
    { old: "Target__review" },
    { path: "Target.md" },
  );
  assert.match(harness.getSource("A.md"), /\[dependsOn:: Target__review\]/);
  assert.match(
    harness.getSource("B.md"),
    /\[dependsOn:: Target__review, keep\]/,
  );
});

test("runtime normalizer skips unsupported paths with one informative notice", async () => {
  notices.length = 0;
  const source = "- [ ] #task Target [id:: abc123] ^target";
  const harness = createInMemoryObsidianApp({ "Spaced Note.md": source });
  harness.app.workspace = {};
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const file = harness.app.vault.getAbstractFileByPath("Spaced Note.md");

  await plugin.normalizeVaultFileDependencyBlockIds(file);
  await plugin.normalizeVaultFileDependencyBlockIds(file);
  assert.equal(harness.getSource(file.path), source);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /unsupported characters/);
});

test("rename reconciliation rewrites the target and every dependent", async () => {
  const harness = createInMemoryObsidianApp({
    "New/Home.md": "- [ ] #task Target [id:: Old__Home__review] ^review",
    "A.md": "- [ ] #task A [dependsOn:: Old__Home__review]",
    "B.md": "- [ ] #task B [dependsOn:: Old__Home__review]",
  });
  harness.app.workspace = {};
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  assert.equal(
    await plugin.reconcileRenamedDependencyIds(
      harness.app.vault.getAbstractFileByPath("New/Home.md"),
      "Old/Home.md",
    ),
    true,
  );
  assert.match(harness.getSource("New/Home.md"), /\[id:: New__Home__review\]/);
  assert.match(harness.getSource("A.md"), /\[dependsOn:: New__Home__review\]/);
  assert.match(harness.getSource("B.md"), /\[dependsOn:: New__Home__review\]/);
});

test("editor dependency normalization abandons and reschedules stale snapshots", async () => {
  const editor = createTextEditor("- [ ] #task Target [id:: abc123] ^target");
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { vault: {}, workspace: {} };
  let rescheduled = 0;
  plugin.scheduleActiveEditorDependencyNormalize = () => { rescheduled += 1; };
  plugin.findAmbiguousDependencyIds = async () => {
    editor.replaceRange("typed ", { line: 0, ch: 0 });
    return new Set();
  };
  plugin.propagateDependencyBlockIds = async () => assert.fail("stale mapping propagated");

  assert.equal(
    await plugin.normalizeActiveEditorDependencyBlockIds(
      editor,
      { path: "Tasks.md" },
    ),
    false,
  );
  assert.equal(rescheduled, 1);
  assert.match(editor.getValue(), /^typed .*\[id:: abc123\]/);
});

test("rename reconciliation abandons and reschedules stale editor snapshots", async () => {
  const editor = createTextEditor(
    "- [ ] #task Target [id:: Old__Home__review] ^review",
  );
  const file = { path: "New/Home.md" };
  const view = Object.assign(new MarkdownView(), { editor, file });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: { cachedRead: async () => editor.getValue() },
    workspace: { getActiveViewOfType: () => view },
  };
  plugin.findDependencyIdentityCollisions = async () => {
    editor.replaceRange("typed ", { line: 0, ch: 0 });
    return new Set();
  };
  let rescheduled = 0;
  plugin.scheduleRenamedDependencyReconcile = () => { rescheduled += 1; };
  plugin.propagateDependencyBlockIds = async () => assert.fail("stale rename propagated");

  assert.equal(
    await plugin.reconcileRenamedDependencyIds(file, "Old/Home.md"),
    false,
  );
  assert.equal(rescheduled, 1);
  assert.match(editor.getValue(), /\[id:: Old__Home__review\]/);
});

test("direct open/done transitions include incomplete statuses without broadening excluded statuses", () => {
  const cases = [
    { symbol: " ", eligible: true, reopenable: false, next: "x" },
    { symbol: "*", eligible: true, reopenable: false, next: "x" },
    { symbol: "x", eligible: true, reopenable: true, next: " " },
    { symbol: "/", eligible: true, reopenable: false, next: "x" },
    { symbol: "-", eligible: false, reopenable: false, next: null },
    { symbol: "?", eligible: false, reopenable: false, next: null },
  ];

  for (const { symbol, eligible, reopenable, next } of cases) {
    const taskStatus = helpers.getTaskStatusForLine(`- [${symbol}] #task Example`);
    assert.equal(
      helpers.isOpenDoneTaskStatus(taskStatus),
      eligible,
      `eligibility for [${symbol}]`,
    );
    assert.equal(
      helpers.getNextOpenDoneSymbol(taskStatus),
      next,
      `transition for [${symbol}]`,
    );
    assert.equal(
      helpers.isTranscludedReopenableStatus(taskStatus),
      reopenable,
      `reopen policy for [${symbol}]`,
    );
  }
  assert.equal(helpers.isTranscludedReopenableStatus(null), false);
});

test("Ctrl+Enter block-link selection recognizes live and retired forms", () => {
  const cases = [
    { line: "- ![[Tasks#^embed|Embedded]]", embedded: true },
    { line: "- [[Tasks#^plain|Plain]]", embedded: false },
    { line: "- 🍅 [[Tasks#^marked|Marked]]", embedded: false },
    { line: "- ~~[[Tasks#^retired|Retired]]~~", embedded: false },
  ];
  for (const { line, embedded } of cases) {
    const target = helpers.getTaskBlockLinkTargetFromLine(
      line,
      "Daily.md",
      3,
      0,
    );
    assert.ok(target, line);
    assert.equal(target.embedded, embedded, line);
    assert.equal(target.sourcePath, "Daily.md");
  }

  const mixed = "- [[A#^first]] and 🍅 ~~[[B#^second|Second]]~~";
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine(mixed, "Daily.md", 0, 0),
    null,
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine(
      mixed,
      "Daily.md",
      0,
      mixed.indexOf("🍅"),
    ).blockId,
    "second",
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine("- [[A#Heading]]", "Daily.md", 0),
    null,
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine("- [[A#^bad id]]", "Daily.md", 0),
    null,
  );
  assert.deepEqual(
    helpers.collectTaskBlockLinkTargetsInLineRange(
      ["- [[A#^first]]", "- [[B#^second]]"],
      "Daily.md",
      1,
      0,
    ),
    [],
  );

  const fencedEditor = createTextEditor(
    "```md\n- [[Tasks#^example]]\n```",
    { line: 1, ch: 7 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  assert.equal(
    plugin.getActiveLineTaskBlockLinkTarget(fencedEditor, "Daily.md"),
    null,
  );
});

test("Pomodoro child ownership is status-neutral and bounded by contiguous list structure", () => {
  const lines = [
    "## Pomodoros",
    "- [x] Historical",
    "\t- direct child",
    "\t\t- nested child",
    "- [ ] Open",
    "  - open child",
    "  prose boundary",
    "    - orphan after prose",
    "- [/] In progress",
    "\t- progress child",
    "",
    "\t- orphan after blank",
    "- [-] Canceled",
    "\t- canceled child",
    "## Tasks",
    "\t- outside the section",
  ];

  for (const [activeLine, pomodoroLine, symbol] of [
    [2, 1, "x"],
    [3, 1, "x"],
    [5, 4, " "],
    [9, 8, "/"],
    [13, 12, "-"],
  ]) {
    const context = helpers.getOwningPomodoroContextForLine(lines, activeLine);
    assert.ok(context, `expected line ${activeLine} to resolve`);
    assert.equal(context.pomodoroLine, pomodoroLine);
    assert.equal(context.taskStatus.symbol, symbol);
    assert.equal(context.activeLine, activeLine);
  }

  for (const activeLine of [0, 1, 4, 6, 7, 8, 10, 11, 12, 14, 15]) {
    assert.equal(
      helpers.getOwningPomodoroContextForLine(lines, activeLine),
      null,
      `line ${activeLine} must not resolve across a structural boundary`,
    );
  }

  const qualifiesForParentCompletion = (activeLine) => {
    const context = helpers.getOwningPomodoroContextForLine(lines, activeLine);
    return !!context && context.taskStatus.symbol === " ";
  };
  assert.equal(qualifiesForParentCompletion(5), true);
  for (const activeLine of [2, 3, 9, 13]) {
    assert.equal(qualifiesForParentCompletion(activeLine), false);
  }
});

test("daily-note paths follow the canonical YYYY/YYYYMMDD.md layout", () => {
  assert.equal(
    helpers.getDailyNoteDateFromPath("2026/20260727.md"),
    "2026-07-27",
  );
  assert.equal(helpers.isDailyNotePath("2026/20260727.md"), true);
  assert.equal(helpers.isDailyNotePath("2024/20240229.md"), true);

  for (const path of [
    "2026/20260727_poms.md",
    "2026/20260727_done.md",
    "2025/20260727.md",
    "20260727.md",
    "2026/07/20260727.md",
    "2026/20261332.md",
    "2026/20260231.md",
    "2023/20230229.md",
    "projects/foo.md",
  ]) {
    assert.equal(
      helpers.getDailyNoteDateFromPath(path),
      null,
      `${path} must not be a daily note`,
    );
    assert.equal(helpers.isDailyNotePath(path), false);
  }
});

test("parsePomodoroEntryLineParts reads placeholder and range names conservatively", () => {
  const cases = [
    [
      "- [ ] ()",
      { placeholder: true, rangeText: "()", name: null, trailingText: "" },
    ],
    [
      "- [ ] ( )",
      { placeholder: true, rangeText: "( )", name: null, trailingText: "" },
    ],
    [
      "- [x] (**1540-1615** [t:: 35m])  — PAGER",
      {
        placeholder: false,
        rangeText: "(**1540-1615** [t:: 35m])",
        name: "PAGER",
        trailingText: "",
      },
    ],
    [
      "- [ ] (**09:20-09:50**) — DEEP WORK",
      {
        placeholder: false,
        rangeText: "(**09:20-09:50**)",
        name: "DEEP WORK",
        trailingText: "",
      },
    ],
    [
      "- [ ] () — deep work",
      {
        placeholder: true,
        rangeText: "()",
        name: "deep work",
        trailingText: "",
      },
    ],
    [
      "- [ ] () —",
      { placeholder: true, rangeText: "()", name: null, trailingText: "" },
    ],
    [
      "- [ ] () note — X",
      {
        placeholder: true,
        rangeText: "()",
        name: null,
        trailingText: " note — X",
      },
    ],
    [
      "- [x] (**0920-0950** [t:: 30m — ish])",
      {
        placeholder: false,
        rangeText: "(**0920-0950** [t:: 30m — ish])",
        name: null,
        trailingText: "",
      },
    ],
  ];

  for (const [lineText, expected] of cases) {
    assert.deepEqual(helpers.parsePomodoroEntryLineParts(lineText), expected);
  }

  assert.equal(helpers.parsePomodoroEntryLineParts("- [ ] Focus — X"), null);
  assert.equal(helpers.parsePomodoroEntryLineParts("plain text () — X"), null);
});

test("formatPomodoroPlaceholderLine keeps unnamed placeholders canonical", () => {
  for (const name of [null, "", "   \t "]) {
    assert.equal(helpers.formatPomodoroPlaceholderLine(name), "- [ ] ()");
  }

  assert.equal(
    helpers.formatPomodoroPlaceholderLine("RELEASE"),
    "- [ ] () — RELEASE",
  );
  assert.equal(
    helpers.formatPomodoroPlaceholderLine("   release prep   "),
    "- [ ] () — release prep",
  );
});

test("Pomodoro bullet toggle accepts empty indented list items", () => {
  for (const sourceLineText of [
    "\t- ",
    "  - ",
    "\t\t- ",
    "\t* ",
    "\t-   ",
    "\t-",
  ]) {
    const lines = [
      "## Pomodoros",
      "- [x] Earlier Pomodoro",
      sourceLineText,
      "## Notes",
    ];
    assert.deepEqual(
      helpers.getPomodoroBulletToggle(lines, 2),
      {
        line: 2,
        direction: "to-pomodoro",
        sourceLineText,
        lineText: "- [ ] ()",
        cursorCh: 7,
      },
      JSON.stringify(sourceLineText),
    );
  }
});

test("Pomodoro bullet toggle rejects non-empty or out-of-section bullets", () => {
  for (const sourceLineText of [
    "\t- [[sase#^read-sase-beads]]",
    "\t- [ ] ",
    "- ",
  ]) {
    assert.equal(
      helpers.getPomodoroBulletToggle(
        ["## Pomodoros", sourceLineText, "## Notes"],
        1,
      ),
      null,
      JSON.stringify(sourceLineText),
    );
  }

  assert.equal(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "- [x] Focus", "## Notes", "\t- "],
      3,
    ),
    null,
  );
});

test("Pomodoro bullet toggle reverses only empty open childless placeholders", () => {
  for (const sourceLineText of ["- [ ] ()", "- [ ] ( )"]) {
    assert.deepEqual(
      helpers.getPomodoroBulletToggle(
        ["## Pomodoros", sourceLineText, "## Notes"],
        1,
      ),
      {
        line: 1,
        direction: "to-bullet",
        sourceLineText,
        lineText: "\t- ",
        cursorCh: 3,
      },
      sourceLineText,
    );
  }

  for (const sourceLineText of [
    "- [ ] (**0630-0645** [t:: 15m])",
    "- [x] ()",
    "- [/] ()",
    "- [-] ()",
    "- [ ] () ^blockid",
    "- [ ] () 🍅 [[x#^y]]",
  ]) {
    assert.equal(
      helpers.getPomodoroBulletToggle(
        ["## Pomodoros", sourceLineText, "## Notes"],
        1,
      ),
      null,
      sourceLineText,
    );
  }

  assert.equal(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "- [ ] ()", "\t- child", "## Notes"],
      1,
    ),
    null,
  );
  assert.equal(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "## Notes", "- [ ] ()"],
      2,
    ),
    null,
  );
});

test("Pomodoro bullet toggle reverses named empty open childless placeholders", () => {
  assert.deepEqual(
    helpers.getPomodoroBulletToggle(
      ["## Pomodoros", "- [ ] () — RELEASE", "## Notes"],
      1,
    ),
    {
      line: 1,
      direction: "to-bullet",
      sourceLineText: "- [ ] () — RELEASE",
      lineText: "\t- ",
      cursorCh: 3,
    },
  );
});

test("Pomodoro bullet toggle round trips and normalizes child indentation", () => {
  for (const [sourceLineText, normalizedLineText] of [
    ["\t- ", "\t- "],
    ["  - ", "\t- "],
  ]) {
    const lines = ["## Pomodoros", sourceLineText, "## Notes"];
    const forward = helpers.getPomodoroBulletToggle(lines, 1);
    assert.ok(forward);
    lines[1] = forward.lineText;

    const reverse = helpers.getPomodoroBulletToggle(lines, 1);
    assert.ok(reverse);
    assert.equal(reverse.lineText, normalizedLineText);
  }
});

test("Pomodoro bullet toggle changes only the eligible line in a realistic daily shape", () => {
  const lines = [
    "## Pomodoros",
    "- [x] (**0630-0645** [t:: 15m])",
    "\t- ~~[[Tasks#^done|Done]]~~",
    "- [ ] ()",
    "\t- [[Tasks#^open|Open]]",
    "- [ ] ()",
    "\t- ",
    "## Notes",
  ];
  const original = [...lines];

  assert.equal(helpers.getPomodoroBulletToggle(lines, 1), null);
  assert.equal(helpers.getPomodoroBulletToggle(lines, 3), null);
  assert.equal(helpers.getPomodoroBulletToggle(lines, 5), null);

  const toggle = helpers.getPomodoroBulletToggle(lines, 6);
  assert.ok(toggle);
  lines[toggle.line] = toggle.lineText;
  assert.equal(lines[6], "- [ ] ()");
  for (let line = 0; line < lines.length; line += 1) {
    if (line !== 6) {
      assert.equal(lines[line], original[line], `line ${line}`);
    }
  }
});

test("Pomodoro toggle key gate does not shadow bare Option bracket cycling", () => {
  const ctrlAltRight = {
    code: "BracketRight",
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
  };
  assert.equal(helpers.getPomodoroBulletToggleKeydown(ctrlAltRight), true);
  for (const event of [
    { ...ctrlAltRight, ctrlKey: false },
    { ...ctrlAltRight, altKey: false },
    { ...ctrlAltRight, shiftKey: true },
    { ...ctrlAltRight, metaKey: true },
    { ...ctrlAltRight, code: "BracketLeft" },
  ]) {
    assert.equal(helpers.getPomodoroBulletToggleKeydown(event), false);
  }

  assert.equal(
    helpers.getOptionBracketTaskCycleDirection({
      ...ctrlAltRight,
      ctrlKey: false,
    }),
    1,
  );
  assert.equal(
    helpers.getOptionBracketTaskCycleDirection({
      ...ctrlAltRight,
      ctrlKey: false,
      code: "BracketLeft",
    }),
    -1,
  );
  assert.equal(helpers.getOptionBracketTaskCycleDirection(ctrlAltRight), null);
});

test("Pomodoro toggle command is daily-only and places the cursor for both directions", () => {
  const source = ["## Pomodoros", "- [x] Earlier", "\t- "].join("\n");
  const editor = createTextEditor(source, { line: 2, ch: 0 });
  const dailyView = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "2026/20260727.md" },
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => dailyView.file },
  };

  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(true, editor, dailyView),
    true,
  );
  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(false, editor, dailyView),
    true,
  );
  assert.equal(editor.getLine(2), "- [ ] ()");
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 7 });

  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(false, editor, dailyView),
    true,
  );
  assert.equal(editor.getLine(2), "\t- ");
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 3 });

  const nonDailyEditor = createTextEditor(source, { line: 2, ch: 0 });
  const nonDailyView = Object.assign(new MarkdownView(), {
    editor: nonDailyEditor,
    file: { path: "projects/notes.md" },
  });
  assert.equal(
    plugin.handlePomodoroBulletToggleCommand(
      false,
      nonDailyEditor,
      nonDailyView,
    ),
    false,
  );
  assert.equal(nonDailyEditor.getValue(), source);
});

test("Pomodoro Vim fallback consumes eligible keydowns once and lets others fall through", () => {
  const source = ["## Pomodoros", "- [x] Earlier", "\t- "].join("\n");
  const editor = createTextEditor(source, { line: 2, ch: 0 });
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "2026/20260727.md" },
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    workspace: { getActiveFile: () => view.file },
  };
  plugin.handledPomodoroBulletToggleEvents = new WeakSet();
  plugin.getFocusedMarkdownEditorView = () => view;
  plugin.resolveNormalModeVimCm = () => ({});

  const calls = { prevent: 0, stop: 0, immediate: 0 };
  const event = {
    preventDefault: () => { calls.prevent += 1; },
    stopPropagation: () => { calls.stop += 1; },
    stopImmediatePropagation: () => { calls.immediate += 1; },
  };
  assert.equal(plugin.dispatchPomodoroBulletToggleEvent(event), true);
  assert.equal(editor.getLine(2), "- [ ] ()");
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 });
  assert.equal(plugin.dispatchPomodoroBulletToggleEvent(event), false);
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 });

  editor.setCursor({ line: 1, ch: 0 });
  const ineligibleEvent = {
    preventDefault: () => { calls.prevent += 1; },
    stopPropagation: () => { calls.stop += 1; },
  };
  assert.equal(
    plugin.dispatchPomodoroBulletToggleEvent(ineligibleEvent),
    false,
  );
  assert.deepEqual(calls, { prevent: 1, stop: 1, immediate: 1 });
});

test("direct Done Tasks task reopens through the metadata-aware fallback", () => {
  const editor = createTextEditor(
    "- [x] #task Finished [completion:: 2026-07-11] ^finished",
    { line: 0, ch: 4 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    commands: { commands: {}, executeCommandById: () => false },
  };
  assert.equal(plugin.toggleActiveCheckboxOpenDone(editor), true);
  assert.equal(editor.getValue(), "- [ ] #task Finished ^finished");
});

test("recursive completion status policy includes Next without broadening excluded statuses", () => {
  const cases = [
    { symbol: " ", traversable: true, closable: true },
    { symbol: "*", traversable: true, closable: true },
    { symbol: "/", traversable: true, closable: true },
    { symbol: "x", traversable: true, closable: false },
    { symbol: "-", traversable: false, closable: false },
    { symbol: "?", traversable: false, closable: false },
  ];

  for (const { symbol, traversable, closable } of cases) {
    const taskStatus = helpers.getTaskStatusForLine(`- [${symbol}] #task Example`);
    assert.equal(
      helpers.isTranscludedCompletionTraversableStatus(taskStatus),
      traversable,
      `traversability for [${symbol}]`,
    );
    assert.equal(
      helpers.isTranscludedCompletionClosableStatus(taskStatus),
      closable,
      `closability for [${symbol}]`,
    );
  }

  assert.equal(helpers.isTranscludedCompletionTraversableStatus(null), false);
  assert.equal(helpers.isTranscludedCompletionClosableStatus(null), false);
});

test("recursive completion closes a Next root and its nested Next descendant", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n\t- ![[Root#^root]]",
    "Root.md": [
      "- [*] #task Parent [priority:: high] [completion:: stale] ^root",
      "\t- ![[#^child]]",
      "- [*] #task Child keeps metadata [effort:: 2] ^child",
    ].join("\n"),
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";

  const result = await plugin.completeTranscludedTaskTargetTree(
    getEmbeddedTarget("![[Root#^root]]"),
    { activePath: "Daily.md", originPath: "Daily.md", editor: null },
    new Set(),
  );

  assert.deepEqual(result, {
    visited: true,
    changed: true,
    closed: [
      { path: "Root.md", blockId: "child" },
      { path: "Root.md", blockId: "root" },
    ],
  });
  assert.equal(
    harness.getSource("Root.md"),
    [
      "- [x] #task Parent [priority:: high]  [completion:: 2026-07-11] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child keeps metadata [effort:: 2]  [completion:: 2026-07-11] ^child",
    ].join("\n"),
  );
});

test("recursive completion traverses Done parents and skips excluded siblings", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^parent]]",
    "Tree.md": [
      "- [x] #task Already done ^parent",
      "\t- ![[#^canceled]]",
      "\t- ![[#^custom]]",
      "\t- ![[#^next]]",
      "- [-] #task Canceled ^canceled",
      "- [?] #task Custom ^custom",
      "- [*] #task Eligible sibling ^next",
    ].join("\n"),
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";

  const result = await plugin.completeTranscludedTaskTargetTree(
    getEmbeddedTarget("![[Tree#^parent]]"),
    { activePath: "Daily.md", originPath: "Daily.md", editor: null },
    new Set(),
  );

  assert.deepEqual(result, {
    visited: true,
    changed: true,
    closed: [{ path: "Tree.md", blockId: "next" }],
  });
  assert.equal(
    harness.getSource("Tree.md"),
    [
      "- [x] #task Already done ^parent",
      "\t- ![[#^canceled]]",
      "\t- ![[#^custom]]",
      "\t- ![[#^next]]",
      "- [-] #task Canceled ^canceled",
      "- [?] #task Custom ^custom",
      "- [x] #task Eligible sibling  [completion:: 2026-07-11] ^next",
    ].join("\n"),
  );
});

test("closed-reference retirement is ancestry-aware, resolved, fenced, and idempotent", () => {
  const source = [
    "- [ ] #task Parent ^parent",
    "\t- ![[#^local|Local]] and ![[Projects/Alpha#^review|Review]]",
    "\t\t- ~~![[Alpha#^review|Stale embed]]~~",
    "- Unmanaged tree",
    "\t- ![[Alpha#^review|Protected]]",
    "```md",
    "- [ ] #task Example ^fake",
    "\t- ![[Alpha#^review|Fenced]]",
    "```",
    "## Pomodoros",
    "- [ ] Focus",
    "  - Prefix ![[Alpha#^review|One]] and ![[Beta#^other]] suffix",
    "## Notes",
    "- prose ![[Alpha#^review|Not a descendant]]",
  ].join("\r\n");
  const resolve = (pathPart) => {
    if (pathPart === "Projects/Alpha" || pathPart === "Alpha") {
      return "Projects/Alpha.md";
    }
    if (pathPart === "Beta") return "Beta.md";
    return null;
  };
  const closed = [
    { path: "Tasks.md", blockId: "local" },
    { path: "Projects/Alpha.md", blockId: "review" },
  ];
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Tasks.md",
    closed,
    resolve,
  );
  assert.equal(result.retired, 4);
  assert.match(result.text, /~~\[\[#\^local\|Local\]\]~~/);
  assert.match(result.text, /~~\[\[Projects\/Alpha#\^review\|Review\]\]~~/);
  assert.match(result.text, /~~\[\[Alpha#\^review\|Stale embed\]\]~~/);
  assert.match(result.text, /Prefix ~~\[\[Alpha#\^review\|One\]\]~~ and !\[\[Beta/);
  assert.match(result.text, /\t- !\[\[Alpha#\^review\|Protected\]\]/);
  assert.match(result.text, /!\[\[Alpha#\^review\|Fenced\]\]/);
  assert.equal(result.text.includes("\r\n"), true);
  const second = helpers.retireClosedTaskReferencesInText(
    result.text,
    "Tasks.md",
    closed,
    resolve,
  );
  assert.equal(second.changed, false);
  assert.equal(second.retired, 0);
});

test("reopened-reference restoration is ancestry-aware, conservative, and idempotent", () => {
  const source = [
    "- [ ] #task Parent [dependsOn:: Projects__Alpha__review] ^parent",
    "\t- ~~[[#^local|Local alias]]~~ and ~~[[Projects/Alpha#^review|Review]]~~",
    "\t- ~~before [[Alpha#^review|Broad task strike]] after~~",
    "\t- [[Alpha#^review|Already live]] and ~~[[Missing#^review|Unresolved]]~~",
    "- Unmanaged tree",
    "\t- ~~[[Alpha#^review|Protected]]~~",
    "```md",
    "- [ ] #task Example",
    "\t- ~~[[Alpha#^review|Fenced]]~~",
    "```",
    "## Pomodoros",
    "- [x] History",
    "\t- 🍅 ~~[[Alpha#^review|History alias]]~~ and ~~[[Alpha#^review|Again]]~~",
    "\t- ~~before [[Alpha#^review|Broad history strike]] after~~",
  ].join("\r\n");
  const resolve = (pathPart) => {
    if (pathPart === "Projects/Alpha" || pathPart === "Alpha") {
      return "Projects/Alpha.md";
    }
    return null;
  };
  const reopened = [
    { path: "Tasks.md", blockId: "local" },
    { path: "Projects/Alpha.md", blockId: "review" },
  ];
  const result = helpers.restoreReopenedTaskReferencesInText(
    source,
    "Tasks.md",
    reopened,
    resolve,
  );
  assert.equal(result.restored, 5);
  assert.match(result.text, /!\[\[#\^local\|Local alias\]\]/);
  assert.match(result.text, /!\[\[Projects\/Alpha#\^review\|Review\]\]/);
  assert.match(
    result.text,
    /~~before !\[\[Alpha#\^review\|Broad task strike\]\] after~~/,
  );
  assert.match(result.text, /\[\[Alpha#\^review\|Already live\]\]/);
  assert.match(result.text, /~~\[\[Missing#\^review\|Unresolved\]\]~~/);
  assert.match(result.text, /- Unmanaged tree\r\n\t- ~~\[\[Alpha/);
  assert.match(result.text, /```md\r\n- \[ \] #task Example\r\n\t- ~~\[\[Alpha/);
  assert.match(
    result.text,
    /🍅 \[\[Alpha#\^review\|History alias\]\] and \[\[Alpha#\^review\|Again\]\]/,
  );
  assert.match(
    result.text,
    /~~before \[\[Alpha#\^review\|Broad history strike\]\] after~~/,
  );
  assert.match(
    result.text,
    /\[dependsOn:: Projects__Alpha__review\] \^parent/,
  );
  assert.equal(result.text.includes("\r\n"), true);
  const second = helpers.restoreReopenedTaskReferencesInText(
    result.text,
    "Tasks.md",
    reopened,
    resolve,
  );
  assert.equal(second.changed, false);
  assert.equal(second.restored, 0);
});

test("Pomodoro marker helpers normalize every block link and preserve fences and EOLs", () => {
  const source = [
    "  - Work on [[A#^plain|Alias]] and ![[B#^embed]]",
    "  - 🍅   ~~[[C#^struck]]~~ and 🍅 🍅 [[D#^duplicate]]",
    "```md",
    "  - [[E#^fenced]]",
    "```",
  ].join("\r\n");
  const marked = helpers.rewritePomodoroMarkersInText(source, true);
  assert.match(
    marked,
    /Work on 🍅 \[\[A#\^plain\|Alias\]\] and 🍅 !\[\[B#\^embed\]\]/,
  );
  assert.match(marked, /- 🍅 ~~\[\[C#\^struck\]\]~~ and 🍅 \[\[D#\^duplicate\]\]/);
  assert.match(marked, /```md\r\n  - \[\[E#\^fenced\]\]\r\n```/);
  assert.equal(marked.includes("\r\n"), true);
  assert.equal(helpers.rewritePomodoroMarkersInText(marked, true), marked);

  const stripped = helpers.rewritePomodoroMarkersInText(marked, false);
  assert.match(stripped, /Work on \[\[A#\^plain\|Alias\]\] and !\[\[B#\^embed\]\]/);
  assert.match(stripped, /- ~~\[\[C#\^struck\]\]~~ and \[\[D#\^duplicate\]\]/);
  assert.match(stripped, /  - \[\[E#\^fenced\]\]/);
});

test("completed Pomodoro markers are normalized per occurrence", () => {
  const source = [
    "  - [[A#^plain|Alias]] and 🍅   ![[B#^embed]]",
    "  - ~~[[C#^unmarked-history]]~~ and 🍅   ~~[[D#^marked-history]]~~",
    "  - 🍅 🍅 [[E#^duplicate]] and 🍅 ![[F#^stray-embed]]",
    "```md",
    "  - [[G#^fenced]]",
    "```",
  ].join("\r\n");
  const rewritten = helpers.rewritePomodoroMarkersInText(
    source,
    helpers.completedPomodoroMarkerPolicy,
  );
  assert.match(
    rewritten,
    /🍅 \[\[A#\^plain\|Alias\]\] and !\[\[B#\^embed\]\]/,
  );
  assert.match(
    rewritten,
    /~~\[\[C#\^unmarked-history\]\]~~ and 🍅 ~~\[\[D#\^marked-history\]\]~~/,
  );
  assert.match(
    rewritten,
    /🍅 \[\[E#\^duplicate\]\] and !\[\[F#\^stray-embed\]\]/,
  );
  assert.match(rewritten, /```md\r\n  - \[\[G#\^fenced\]\]\r\n```/);
  assert.equal(
    helpers.rewritePomodoroMarkersInText(
      rewritten,
      helpers.completedPomodoroMarkerPolicy,
    ),
    rewritten,
  );
});

test("move-only Pomodoro links require a strict immediate hash directive", () => {
  const parsed = helpers.getMoveOnlyPomodoroBlockLinkFromListItem(
    "\t- [[Projects/Focus.md#^review-1|Review alias]]#  ",
  );
  assert.ok(parsed);
  assert.equal(parsed.target.pathPart, "Projects/Focus");
  assert.equal(parsed.target.blockId, "review-1");
  assert.equal(
    parsed.destinationLineText,
    "\t- [[Projects/Focus.md#^review-1|Review alias]]  ",
  );
  assert.equal(
    helpers.getBareNonEmbeddedBlockLinkTargetFromListItem(
      "\t- [[Projects/Focus.md#^review-1|Review alias]]#  ",
    ).blockId,
    "review-1",
  );

  const strictLinks = helpers.classifyPomodoroSubBullets(
    ["\t- [[#^ordinary]]", "\t- [[#^move-only]]#"],
    { startLine: 0, endLine: 2 },
  );
  assert.deepEqual(
    strictLinks.moveOnlyTaskLinkBullets.map((bullet) => bullet.line),
    [1],
  );
  assert.deepEqual(
    strictLinks.startableNonTranscludedTaskLinkBullets.map(
      (bullet) => bullet.line,
    ),
    [0],
  );

  const nonMatches = [
    "\t- ![[#^embedded]]#",
    "\t- ~~[[#^retired]]~~#",
    "\t- prose [[#^mixed]]#",
    "\t- [[#^mixed]]# trailing prose",
    "\t- [[#^spaced]] #",
    "\t- [[#^double]]##",
    "\t- [[#^tagged]] #carry",
    "\t- #tag [[#^prefixed]]#",
    "\t- [[#^hash-alias|Literal #]]",
  ];
  for (const line of nonMatches) {
    assert.equal(
      helpers.getMoveOnlyPomodoroBlockLinkFromListItem(line),
      null,
      line,
    );
  }

  const ordinary = helpers.classifyPomodoroSubBullets(
    nonMatches,
    { startLine: 0, endLine: nonMatches.length },
  );
  assert.deepEqual(ordinary.moveOnlyTaskLinkBullets, []);

  const fencedLines = [
    "```md",
    "\t- [[#^fenced]]#",
    "```",
  ];
  const fenced = helpers.classifyPomodoroSubBullets(
    fencedLines,
    { startLine: 0, endLine: fencedLines.length },
  );
  assert.deepEqual(fenced.moveOnlyTaskLinkBullets, []);
  assert.deepEqual(
    fenced.noteBullets.map((bullet) => bullet.line),
    [0, 1, 2],
  );
});

test("Pomodoro move-only planner toggles links across additional physical lines", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^first|First alias]]  ",
    "\t- [[Projects/Tasks.md#^second]]#\t",
    "\t- prose is left alone",
    "\t- [[#^third]]",
    "- [ ] Later",
    "\t- [[#^later]]",
  ];

  const counted = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 2, 3);
  assert.equal(counted.eligible, true);
  assert.equal(counted.startLine, 2);
  assert.equal(counted.endLine, 6);
  assert.deepEqual(
    counted.edits.map(({ type, line, lineText }) => ({ type, line, lineText })),
    [
      { type: "add", line: 2, lineText: "\t- [[#^first|First alias]]#  " },
      { type: "remove", line: 3, lineText: "\t- [[Projects/Tasks.md#^second]]\t" },
      { type: "add", line: 5, lineText: "\t- [[#^third]]#" },
    ],
  );

  const bare = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 2, 0);
  assert.deepEqual(
    bare.edits.map(({ type, line, lineText }) => ({ type, line, lineText })),
    [{ type: "add", line: 2, lineText: "\t- [[#^first|First alias]]#  " }],
  );

  const explicitOne = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 2, 1);
  assert.equal(explicitOne.endLine, 4);
  assert.deepEqual(explicitOne.edits.map((edit) => edit.type), ["add", "remove"]);

  const clamped = helpers.buildPomodoroMoveOnlyTogglePlan(lines, 3, 20);
  assert.equal(clamped.endLine, 6);
  assert.deepEqual(clamped.edits.map((edit) => edit.line), [3, 5]);
});

test("Pomodoro move-only planner round trips exact text and rejects strict non-matches", () => {
  const base = ["## Pomodoros", "- [ ] Focus"];
  const originalLine = "\t- [[Projects/Tasks.md#^marked|Marked alias]]\t  ";
  const addition = helpers.buildPomodoroMoveOnlyTogglePlan(
    [...base, originalLine],
    2,
    0,
  );
  assert.equal(addition.eligible, true);
  assert.equal(addition.edits[0].type, "add");
  const markedLine = addition.edits[0].lineText;
  assert.equal(markedLine, "\t- [[Projects/Tasks.md#^marked|Marked alias]]#\t  ");

  const removal = helpers.buildPomodoroMoveOnlyTogglePlan(
    [...base, markedLine],
    2,
    0,
  );
  assert.equal(removal.eligible, true);
  assert.equal(removal.edits[0].type, "remove");
  assert.equal(removal.edits[0].lineText, originalLine);

  const rejectedLines = [
    "\t- ![[#^embedded]]#",
    "\t- ~~[[#^retired]]~~#",
    "\t- prose [[#^mixed]]",
    "\t- [[#^first]] and [[#^second]]",
    "\t- [[#^bad id]]",
    "\t- [[#^spaced]] #",
    "\t- [[#^double]]##",
    "\t- [[#^trailing]]# trailing prose",
  ];
  for (const lineText of rejectedLines) {
    const plan = helpers.buildPomodoroMoveOnlyTogglePlan(
      [...base, lineText],
      2,
      0,
    );
    assert.equal(plan.eligible, false, lineText);
    assert.deepEqual(plan.edits, [], lineText);
  }

  assert.equal(
    helpers.buildPomodoroMoveOnlyTogglePlan(
      ["## Pomodoros", "- [x] Finished", "\t- [[#^done]]"],
      2,
      0,
    ).eligible,
    false,
  );
  assert.equal(
    helpers.buildPomodoroMoveOnlyTogglePlan(
      ["## Other", "- [ ] Focus", "\t- [[#^outside]]"],
      2,
      0,
    ).eligible,
    false,
  );
  assert.equal(
    helpers.buildPomodoroMoveOnlyTogglePlan(
      [
        "## Pomodoros",
        "- [ ] Focus",
        "```md",
        "\t- [[#^fenced]]",
        "```",
      ],
      3,
      0,
    ).eligible,
    false,
  );
});

test("bare Pomodoro move-only toggle round trips a valid alias and preserves the cursor", async () => {
  const daily = [
    "- [/] #task Same-note target ^local",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^local|Local alias]]\t  ",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const originalCursor = { line: 3, ch: 12 };
  const editor = createTextEditor(daily, originalCursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const activeFile = harness.app.vault.getAbstractFileByPath("Daily.md");

  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(editor, activeFile, 0),
    true,
  );
  assert.equal(
    editor.getLine(3),
    "\t- [[#^local|Local alias]]#\t  ",
  );
  assert.deepEqual(editor.getCursor(), originalCursor);

  plugin.resolveTranscludedBlockTarget = async () => {
    throw new Error("removals must not resolve targets");
  };
  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(editor, activeFile, 0),
    true,
  );
  assert.equal(editor.getValue(), daily);
  assert.deepEqual(editor.getCursor(), originalCursor);
});

test("Pomodoro move-only runtime removes locally and validates additions independently", async () => {
  const daily = [
    "- [/] #task Same-note target ^local",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^local|Local alias]]  ",
    "\t- [[Tasks#^done|Valid marked]]#\t",
    "\t- [[Missing#^gone|Stale marked]]#",
    "\t- [[Unreadable#^blocked|Unreadable marked]]#",
    "\t- [[Notes#^not-task|No-longer task]]#",
    "\t- [[Tasks#^done|Valid addition]]",
    "\t- [[Tasks#^missing|Missing addition]]",
    "\t- [[Notes#^not-task|Non-task addition]]",
    "\t- [[Unreadable#^blocked|Unreadable addition]]",
    "\t- prose",
    "- [ ] Later",
    "\t- [[#^later]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [x] Completed #task ^done",
    "Notes.md": "- Plain note target ^not-task",
    "Unreadable.md": "- [ ] #task Unreadable ^blocked",
  });
  const read = harness.app.vault.read;
  harness.app.vault.read = async (file) => {
    if (file.path === "Unreadable.md") {
      throw new Error("unreadable");
    }
    return read(file);
  };
  const originalCursor = { line: 3, ch: 12 };
  const editor = createTextEditor(daily, originalCursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      20,
    ),
    true,
  );
  assert.deepEqual(editor.getCursor(), originalCursor);
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Same-note target ^local",
      "## Pomodoros",
      "- [ ] Focus",
      "\t- [[#^local|Local alias]]#  ",
      "\t- [[Tasks#^done|Valid marked]]\t",
      "\t- [[Missing#^gone|Stale marked]]",
      "\t- [[Unreadable#^blocked|Unreadable marked]]",
      "\t- [[Notes#^not-task|No-longer task]]",
      "\t- [[Tasks#^done|Valid addition]]#",
      "\t- [[Tasks#^missing|Missing addition]]",
      "\t- [[Notes#^not-task|Non-task addition]]",
      "\t- [[Unreadable#^blocked|Unreadable addition]]",
      "\t- prose",
      "- [ ] Later",
      "\t- [[#^later]]",
    ].join("\n"),
  );
});

test("Pomodoro move-only runtime protects live lines after asynchronous failures", async () => {
  const daily = [
    "- [ ] #task Valid ^valid",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Missing#^stale|Marked]]#",
    "\t- [[#^valid|Addition]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const originalCursor = { line: 3, ch: 5 };
  const editor = createTextEditor(daily, originalCursor);
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.resolveTranscludedBlockTarget = async () => {
    const liveLine = editor.getLine(3);
    editor.replaceRange(
      "\t- [[Missing#^stale|User changed alias]]#",
      { line: 3, ch: 0 },
      { line: 3, ch: liveLine.length },
    );
    throw new Error("resolver failed");
  };

  assert.equal(
    await plugin.togglePomodoroMoveOnlyRange(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      1,
    ),
    false,
  );
  assert.equal(editor.getLine(3), "\t- [[Missing#^stale|User changed alias]]#");
  assert.equal(editor.getLine(4), "\t- [[#^valid|Addition]]");
  assert.deepEqual(editor.getCursor(), originalCursor);
});

test("Pomodoro hash Vim mapping distinguishes bare and explicit repeats", async () => {
  const originalWindow = global.window;
  const actions = new Map();
  const mappings = [];
  global.window = {
    CodeMirrorAdapter: {
      Vim: {
        defineAction: (name, handler) => actions.set(name, handler),
        mapCommand: (key, type, name, args, options) =>
          mappings.push({ key, type, name, args, options }),
      },
    },
  };

  try {
    const calls = [];
    const editor = {};
    const file = { path: "Daily.md" };
    const view = Object.assign(new MarkdownView(), { editor, file });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = {
      workspace: {
        getActiveViewOfType: () => view,
        getActiveFile: () => file,
      },
    };
    let rejectNextCall = false;
    plugin.togglePomodoroMoveOnlyRange = async (...args) => {
      calls.push(args);
      if (rejectNextCall) {
        throw new Error("contained action failure");
      }
      return true;
    };

    assert.equal(plugin.registerVimMappings(), true);
    assert.ok(
      mappings.some(
        (mapping) =>
          mapping.key === "#" &&
          mapping.type === "action" &&
          mapping.name === "taskStatusCyclerTogglePomodoroMoveOnly" &&
          mapping.options.context === "normal",
      ),
    );

    const action = actions.get("taskStatusCyclerTogglePomodoroMoveOnly");
    action({}, { repeat: 1, repeatIsExplicit: false });
    action({}, { repeat: 1, repeatIsExplicit: true });
    action({}, { repeat: 4, repeatIsExplicit: true });
    assert.deepEqual(calls, [
      [editor, file, 0],
      [editor, file, 1],
      [editor, file, 4],
    ]);
    assert.equal(helpers.getPomodoroMoveOnlyAdditionalLines(), 0);
    assert.equal(
      helpers.getPomodoroMoveOnlyAdditionalLines({
        repeat: 9,
        repeatIsExplicit: false,
      }),
      0,
    );

    rejectNextCall = true;
    action({}, { repeat: 2, repeatIsExplicit: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls[3], [editor, file, 2]);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("Pomodoro completion marks originals and carries clean live copies", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Focus",
    "  - 🍅   [[Tasks#^live|Live]] and [[Tasks#^other]]",
    "  - 🍅 ![[Tasks#^embedded|Embedded]]",
    "  - ~~[[Tasks#^retired|Unmarked retirement]]~~",
    "  - 🍅   ~~[[Tasks#^marked-retired|Marked retirement]]~~",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[Tasks#^live|Live]] and [[Tasks#^other]]",
  ]);
  const replacements = new Map(
    plan.edits
      .filter((edit) => edit.type === "replaceLine")
      .map((edit) => [edit.line, edit.lineText]),
  );
  assert.equal(
    replacements.get(2),
    "  - 🍅 [[Tasks#^live|Live]] and 🍅 [[Tasks#^other]]",
  );
  assert.equal(replacements.get(3), "  - ![[Tasks#^embedded|Embedded]]");
  assert.equal(replacements.has(4), false);
  assert.equal(
    replacements.get(5),
    "  - 🍅 ~~[[Tasks#^marked-retired|Marked retirement]]~~",
  );
});

test("Pomodoro completion groups worked-on links before deferred marked links before a later Pomodoro", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Projects/Focus#^move-one|Move one]]#",
    "\t- keep this note",
    "\t- [[#^move-two]]#",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "- [ ] Later",
    "\t- [[Tasks#^later|Keep later]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.equal(plan.createdPomodoro, true);
  assert.equal(plan.cursorTargetLine, 5);
  assert.deepEqual(plan.copiedBulletLines, [
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "\t- [[Projects/Focus#^move-one|Move one]]",
    "\t- [[#^move-two]]",
  ]);
  assert.deepEqual(
    plan.sourceBullets.moveOnlyTaskLinkBullets.map((bullet) => bullet.line),
    [3, 5],
  );
  assert.deepEqual(
    plan.sourceBullets.startableNonTranscludedTaskLinkBullets.map(
      (bullet) => bullet.line,
    ),
    [2, 6],
  );

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  assert.equal(
    plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor()),
    true,
  );
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] First",
      "\t- 🍅 [[Tasks#^ordinary-one|Ordinary one]]",
      "\t- keep this note",
      "\t- 🍅 [[Tasks#^ordinary-two|Ordinary two]]",
      "- [ ] ()",
      "\t- [[Tasks#^ordinary-one|Ordinary one]]",
      "\t- [[Tasks#^ordinary-two|Ordinary two]]",
      "\t- [[Projects/Focus#^move-one|Move one]]",
      "\t- [[#^move-two]]",
      "- [ ] Later",
      "\t- [[Tasks#^later|Keep later]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 5, ch: 7 });
  assert.equal((editor.getValue().match(/- \[ \] \(\)/g) || []).length, 1);
  assert.equal(editor.getValue().includes("]]#"), false);
  assert.equal(editor.getValue().includes("🍅 [[Projects/Focus#^move-one"), false);
});

test("Pomodoro completion carries the closed Pomodoro name onto created entries", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] (**1815-1905** [t:: 50m])   — RELEASE",
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Projects/Focus#^move-one|Move one]]#",
    "\t- keep this note",
    "\t- [[#^move-two]]#",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "- [ ] Later",
    "\t- [[Tasks#^later|Keep later]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  const insert = plan.edits.find((edit) => edit.type === "insertLines");

  assert.ok(insert);
  assert.equal(insert.lines[0], "- [ ] () — RELEASE");
  assert.equal(plan.createdPomodoroName, "RELEASE");
  assert.deepEqual(plan.copiedBulletLines, [
    "\t- [[Tasks#^ordinary-one|Ordinary one]]",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
    "\t- [[Projects/Focus#^move-one|Move one]]",
    "\t- [[#^move-two]]",
  ]);
});

test("buildPomodoroCompletionPlan groups a #-marked bullet above several unmarked bullets", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^m1|M1]]#",
    "  - [[B#^o1|O1]]",
    "  - note in the middle",
    "  - [[C#^m2|M2]]#",
    "  - [[D#^o2|O2]]",
    "  - [[E#^o3|O3]]",
    "  - [[F#^m3|M3]]#",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[B#^o1|O1]]",
    "  - [[D#^o2|O2]]",
    "  - [[E#^o3|O3]]",
    "  - [[A#^m1|M1]]",
    "  - [[C#^m2|M2]]",
    "  - [[F#^m3|M3]]",
  ]);

  const editor = createTextEditor(lines.join("\n"), { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  plugin.applyPomodoroCompletionPlan(editor, plan, editor.getCursor());
  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] First",
      "  - 🍅 [[B#^o1|O1]]",
      "  - note in the middle",
      "  - 🍅 [[D#^o2|O2]]",
      "  - 🍅 [[E#^o3|O3]]",
      "- [ ] ()",
      "  - [[B#^o1|O1]]",
      "  - [[D#^o2|O2]]",
      "  - [[E#^o3|O3]]",
      "  - [[A#^m1|M1]]",
      "  - [[C#^m2|M2]]",
      "  - [[F#^m3|M3]]",
    ].join("\n"),
  );
});

test("buildPomodoroCompletionPlan carries a duplicate target as both an ordinary and a marked bullet", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^dup|Ordinary alias]]",
    "  - [[A#^dup|Marked alias]]#",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[A#^dup|Ordinary alias]]",
    "  - [[A#^dup|Marked alias]]",
  ]);
});

test("buildPomodoroCompletionPlan keeps source order when every carried link is marked", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^m1|M1]]#",
    "  - [[B#^m2|M2]]#",
    "  - [[C#^m3|M3]]#",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[A#^m1|M1]]",
    "  - [[B#^m2|M2]]",
    "  - [[C#^m3|M3]]",
  ]);
});

test("buildPomodoroCompletionPlan keeps source order when every carried link is unmarked", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - [[A#^o1|O1]]",
    "  - [[B#^o2|O2]]",
    "  - [[C#^o3|O3]]",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[A#^o1|O1]]",
    "  - [[B#^o2|O2]]",
    "  - [[C#^o3|O3]]",
  ]);
});

test("Ctrl+Enter groups worked-on links above deferred marked links, keeping a note bullet in place", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] (**1110-1135** [t:: 25m])",
    "  - [[Tasks#^ordinary-one|Ordinary one]]",
    "  - [[Projects/Focus#^move-one|Move one]]#",
    "  - keep this note",
    "  - [[#^move-two]]#",
    "  - [[Tasks#^ordinary-two|Ordinary two]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(
    editor.getValue(),
    [
      "## Pomodoros",
      "- [x] (**1110-1135** [t:: 25m])",
      "  - 🍅 [[Tasks#^ordinary-one|Ordinary one]]",
      "  - keep this note",
      "  - 🍅 [[Tasks#^ordinary-two|Ordinary two]]",
      "- [ ] ()",
      "  - [[Tasks#^ordinary-one|Ordinary one]]",
      "  - [[Tasks#^ordinary-two|Ordinary two]]",
      "  - [[Projects/Focus#^move-one|Move one]]",
      "  - [[#^move-two]]",
    ].join("\n"),
  );
});

test("retirement preserves task-tree markers and unmarks Pomodoro embeds", () => {
  const source = [
    "- [ ] #task Parent",
    "  - 🍅 ![[A#^done|Task tree]]",
    "## Pomodoros",
    "- [ ] Open",
    "  - 🍅 ![[A#^done|Open session]]",
    "- [x] Done",
    "  - ![[A#^done|Done session]]",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.match(result.text, /- 🍅 ~~\[\[A#\^done\|Task tree\]\]~~/);
  assert.match(result.text, /- \[ \] Open\n  - ~~\[\[A#\^done\|Open session\]\]~~/);
  assert.match(result.text, /- \[x\] Done\n  - ~~\[\[A#\^done\|Done session\]\]~~/);
});

test("done Pomodoro retirement removes only the matching embedded marker", () => {
  const source = [
    "## Pomodoros",
    "- [x] Done",
    "  - 🍅 ![[A#^done|Retire]] and 🍅 [[B#^live|Preserve]]",
    "  - 🍅 ~~![[A#^done|Stale embed]]~~ and ~~[[C#^history]]~~",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.equal(
    result.text,
    [
      "## Pomodoros",
      "- [x] Done",
      "  - ~~[[A#^done|Retire]]~~ and 🍅 [[B#^live|Preserve]]",
      "  - ~~[[A#^done|Stale embed]]~~ and ~~[[C#^history]]~~",
    ].join("\n"),
  );
  const second = helpers.retireClosedTaskReferencesInText(
    result.text,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.equal(second.changed, false);
  assert.equal(second.retired, 0);
});

test("retirement stops at prose boundaries and pairs strikethrough spans", () => {
  const source = [
    "- [ ] #task Parent",
    "Paragraph separating the following list.",
    "  - ![[A#^review|Protected]]",
    "- [ ] #task Other",
    "  - ~~before~~![[A#^review|Retire]]~~after~~",
    "  - ~~![[A#^review|Already struck]]~~",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Tasks.md",
    [{ path: "A.md", blockId: "review" }],
    () => "A.md",
  );
  assert.equal(result.retired, 2);
  assert.match(result.text, /  - !\[\[A#\^review\|Protected\]\]/);
  assert.match(
    result.text,
    /~~before~~ ~~\[\[A#\^review\|Retire\]\]~~ ~~after~~/,
  );
  assert.match(result.text, /~~\[\[A#\^review\|Already struck\]\]~~/);
});

test("retired Pomodoro links are not copied into the next Pomodoro", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - ~~[[Tasks#^done|Done]]~~",
    "- [ ] Second",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, []);
  assert.equal(plan.createdPomodoro, false);
});

test("retirement coordinator rewrites active editor and vault notes together", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [x] Focus\n  - ![[Tasks#^done|Done]]",
    "Tasks.md": [
      "- [x] #task Done ^done",
      "  - ![[#^done|Self reference]]",
    ].join("\n"),
  });
  let activeText = harness.getSource("Daily.md");
  let cursor = { line: 2, ch: 4 };
  const editor = {
    getValue: () => activeText,
    getCursor: () => cursor,
    setCursor: (next) => { cursor = next; },
    getLine: (line) => activeText.split("\n")[line] || "",
    replaceRange: (text, from, to) => {
      const lines = activeText.split("\n");
      lines[from.line] = `${lines[from.line].slice(0, from.ch)}${text}${lines[to.line].slice(to.ch)}`;
      activeText = lines.join("\n");
    },
  };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.retireClosedTaskReferences(
    [{ path: "Tasks.md", blockId: "done" }],
    { editor, activePath: "Daily.md" },
  );
  assert.equal(result.retired, 2);
  assert.match(activeText, /  - ~~\[\[Tasks#\^done\|Done\]\]~~/);
  assert.match(harness.getSource("Tasks.md"), /~~\[\[#\^done\|Self reference\]\]~~/);
});

test("restoration coordinator rewrites active and vault notes, preserves the cursor, and isolates failures", async () => {
  notices.length = 0;
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [x] Focus\n  - 🍅 ~~[[Tasks#^done|Done]]~~",
    "Tasks.md": [
      "- [ ] #task Parent",
      "  - ~~[[#^done|Dependency]]~~",
      "- [ ] #task Reopened ^done",
    ].join("\n"),
    "Broken.md": "- [ ] #task Parent\n  - ~~[[Tasks#^done]]~~",
  });
  const originalCachedRead = harness.app.vault.cachedRead;
  harness.app.vault.cachedRead = async (file) => {
    if (file.path === "Broken.md") throw new Error("unreadable");
    return originalCachedRead(file);
  };
  const editor = createTextEditor(harness.getSource("Daily.md"), {
    line: 2,
    ch: 8,
  });
  const originalCursor = editor.getCursor();
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.restoreReopenedTaskReferences(
    [
      { path: "Tasks.md", blockId: "done" },
      { path: "Tasks.md", blockId: "done" },
      { path: "Tasks.md" },
    ],
    { editor, activePath: "Daily.md" },
  );
  assert.equal(result.restored, 2);
  assert.equal(result.failures.length, 1);
  assert.match(editor.getValue(), /🍅 \[\[Tasks#\^done\|Done\]\]/);
  assert.match(harness.getSource("Tasks.md"), /!\[\[#\^done\|Dependency\]\]/);
  assert.deepEqual(editor.getCursor(), originalCursor);
  assert.match(notices.at(-1), /Reopened tasks, but 1 note/);
});

test("close and reopen reference mutations share one serialized queue", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const order = [];
  let releaseRetirement;
  const retirementGate = new Promise((resolve) => {
    releaseRetirement = resolve;
  });
  plugin.retireClosedTaskReferencesNow = async (identities) => {
    order.push(`retire:${identities.length}`);
    await retirementGate;
    return { retired: 0, failures: [] };
  };
  plugin.restoreReopenedTaskReferencesNow = async (identities) => {
    order.push(`restore:${identities.length}`);
    return { restored: 0, failures: [] };
  };
  const identities = [
    { path: "Tasks.md", blockId: "same" },
    { path: "Tasks.md", blockId: "same" },
  ];
  const retiring = plugin.retireClosedTaskReferences(identities, {});
  const restoring = plugin.restoreReopenedTaskReferences(identities, {});
  await Promise.resolve();
  assert.deepEqual(order, ["retire:1"]);
  releaseRetirement();
  await Promise.all([retiring, restoring]);
  assert.deepEqual(order, ["retire:1", "restore:1"]);
});

test("post-close finalizer serializes dependent recovery before reference retirement", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const order = [];
  plugin.recoverBlockedDependentsNow = async (identities) => {
    order.push(`recover:${identities.length}`);
    return { reopened: 1, failures: [] };
  };
  plugin.retireClosedTaskReferencesNow = async (identities) => {
    order.push(`retire:${identities.length}`);
    return { retired: 2, failures: [] };
  };
  const result = await plugin.finalizeClosedTasks(
    [{ path: "Tasks.md", blockId: "root", taskId: "root-id" }],
    {},
  );
  assert.deepEqual(order, ["recover:1", "retire:1"]);
  assert.deepEqual(result, {
    reopened: 1,
    retired: 2,
    recoveryFailures: [],
    retirementFailures: [],
  });
});

test("dependent recovery uses live editor buffers and preserves the cursor", async () => {
  const disk = [
    "- [ ] #task Root [id:: root] ^root",
    "- [?] #task Dependent [dependsOn:: root] ^dependent",
  ].join("\n");
  const live = disk.replace("- [ ] #task Root", "- [x] #task Root");
  const harness = createInMemoryObsidianApp({ "Tasks.md": disk });
  const editor = createTextEditor(live, { line: 1, ch: 18 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Tasks.md");
  const cursor = editor.getCursor();

  const result = await plugin.recoverBlockedDependentsNow(
    [{ path: "Tasks.md", blockId: "root" }],
    { editor, activePath: "Tasks.md" },
  );
  assert.equal(result.reopened, 1);
  assert.match(editor.getValue(), /^- \[ \] #task Dependent/m);
  assert.deepEqual(editor.getCursor(), cursor);
  assert.equal(harness.getSource("Tasks.md"), disk);
  const second = await plugin.recoverBlockedDependentsNow(
    [{ path: "Tasks.md", taskId: "root" }],
    { editor, activePath: "Tasks.md" },
  );
  assert.equal(second.reopened, 0);
});

test("dependent recovery preserves successful siblings across stale and failed notes", async () => {
  notices.length = 0;
  const harness = createInMemoryObsidianApp({
    "Closed.md": "- [x] #task Root [id:: root] ^root",
    "Good.md": "- [?] #task Good [dependsOn:: root] ^good",
    "Stale.md": "- [?] #task Stale [dependsOn:: root] ^stale",
    "BrokenRead.md": "- [?] #task Unreadable [dependsOn:: root] ^unreadable",
    "BrokenWrite.md": "- [?] #task Unwritable [dependsOn:: root] ^unwritable",
  });
  const cachedRead = harness.app.vault.cachedRead;
  harness.app.vault.cachedRead = async (file) => {
    if (file.path === "BrokenRead.md") throw new Error("read failed");
    return cachedRead(file);
  };
  const process = harness.app.vault.process;
  harness.app.vault.process = async (file, updateSourceText) => {
    if (file.path === "BrokenWrite.md") throw new Error("write failed");
    if (file.path === "Stale.md") {
      return process(file, (text) =>
        updateSourceText(text.replace("Stale", "Stale changed")),
      );
    }
    return process(file, updateSourceText);
  };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.recoverBlockedDependentsNow(
    [{ path: "Closed.md", blockId: "root" }],
    {},
  );
  assert.equal(result.reopened, 1);
  assert.equal(result.failures.length, 3);
  assert.match(harness.getSource("Good.md"), /^- \[ \] #task Good/);
  assert.match(harness.getSource("Stale.md"), /^- \[\?\] #task Stale changed/);
  assert.match(harness.getSource("BrokenWrite.md"), /^- \[\?\]/);
  assert.match(notices.at(-1), /3 notes could not be checked/);
});

test("no-op vault transforms and irrelevant retirement files avoid process writes", async () => {
  let processCalls = 0;
  const file = { path: "Notes.md" };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => "No dependency links here",
      process: async () => { processCalls += 1; },
    },
    metadataCache: {},
  };
  assert.equal(await plugin.processVaultFileText(file, (text) => text), false);
  await plugin.retireClosedTaskReferences(
    [{ path: "Tasks.md", blockId: "done" }, { path: "Tasks.md" }],
    {},
  );
  assert.equal(processCalls, 0);
});

test("ambiguity scans and notices are cached while dependency identity lines stay stable", async () => {
  notices.length = 0;
  let reads = 0;
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "Other.md" }],
      cachedRead: async () => {
        reads += 1;
        return "ordinary prose";
      },
    },
  };
  const file = { path: "Tasks.md" };
  const first = await plugin.findAmbiguousDependencyIds(
    ["abc123"],
    file,
    "- [ ] #task Target [id:: abc123] ^target\nfirst prose",
  );
  const second = await plugin.findAmbiguousDependencyIds(
    ["abc123"],
    file,
    "- [ ] #task Target [id:: abc123] ^target\nchanged prose",
  );
  assert.deepEqual([...first], []);
  assert.deepEqual([...second], []);
  assert.equal(reads, 1);

  plugin.notifyDependencyIssue(file, "ambiguity", ["duplicate"]);
  plugin.notifyDependencyIssue(file, "ambiguity", ["duplicate"]);
  assert.equal(notices.length, 1);
});

test("non-Vim open/done command finalizes the closed task identity", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const taskStatus = helpers.getTaskStatusForLine(
    "- [ ] #task Close through command ^close",
  );
  const editor = {};
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "Tasks.md" },
  });
  plugin.app = { workspace: { getActiveFile: () => view.file } };
  plugin.getActiveTaskStatus = () => taskStatus;
  plugin.toggleActiveCheckboxOpenDone = () => true;
  let finalized = null;
  plugin.finalizeClosedTasks = async (identities) => { finalized = identities; };

  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  await Promise.resolve();
  assert.deepEqual(finalized, [{ path: "Tasks.md", blockId: "close" }]);
});

test("non-Vim open/done command restores the reopened task identity", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const taskStatus = helpers.getTaskStatusForLine(
    "- [x] #task Reopen through command [completion:: stale] ^reopen",
  );
  const editor = {};
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "Tasks.md" },
  });
  plugin.app = { workspace: { getActiveFile: () => view.file } };
  plugin.getActiveTaskStatus = () => taskStatus;
  plugin.toggleActiveCheckboxOpenDone = () => true;
  let restored = null;
  plugin.restoreReopenedTaskReferences = async (identities) => {
    restored = identities;
  };

  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  await Promise.resolve();
  assert.deepEqual(restored, [{ path: "Tasks.md", blockId: "reopen" }]);
});

test("full Pomodoro completion retires embeds only after carry-forward planning", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[Root#^root|Finished work]]",
    "\t- [[Continue#^continue|Carry forward]]",
    "\t- Mix ![[Mixed#^mixed|Retire mixed]] with [[Continue#^other|Do not copy]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Root.md": "- [ ] #task Root ^root",
    "Continue.md": [
      "- [ ] #task Continue ^continue",
      "- [ ] #task Other ^other",
    ].join("\n"),
    "Mixed.md": "- [ ] #task Mixed ^mixed",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: "Daily.md" },
      { pomodoroLine: 1 },
    ),
    true,
  );
  assert.match(harness.getSource("Root.md"), /^- \[x\] #task Root/);
  assert.match(
    editor.getValue(),
    /- \[x\] Focus\n\t- ~~\[\[Root#\^root\|Finished work\]\]~~\n\t- 🍅 \[\[Continue#\^continue\|Carry forward\]\]\n\t- Mix ~~\[\[Mixed#\^mixed\|Retire mixed\]\]~~ with 🍅 \[\[Continue#\^other\|Do not copy\]\]/,
  );
  assert.equal((editor.getValue().match(/Root#\^root/g) || []).length, 1);
  assert.equal((editor.getValue().match(/Mixed#\^mixed/g) || []).length, 1);
  assert.equal((editor.getValue().match(/Continue#\^continue/g) || []).length, 2);
  assert.equal((editor.getValue().match(/Continue#\^other/g) || []).length, 1);
  assert.match(
    editor.getValue(),
    /- \[ \] \(\)\n\t- \[\[Continue#\^continue\|Carry forward\]\]$/,
  );
  assert.deepEqual(editor.getCursor(), { line: 5, ch: 7 });
  assert.match(harness.getSource("Continue.md"), /^- \[\/\] #task Continue/m);
});

test("full Pomodoro completion recovers after a deduplicated multi-target batch", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[A#^a]]",
    "\t- ![[A#^a|Repeated]]",
    "\t- ![[B#^b]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "A.md": "- [ ] #task A [id:: a] ^a",
    "B.md": "- [/] #task B (id:: b) ^b",
    "Dependent.md": "- [?] #task Dependent [dependsOn:: a, b] ^dependent",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-16";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.match(harness.getSource("A.md"), /^- \[x\] #task A/m);
  assert.match(harness.getSource("B.md"), /^- \[x\] #task B/m);
  assert.match(harness.getSource("Dependent.md"), /^- \[ \] #task Dependent/m);
});

test("full Pomodoro completion moves a marked same-note link without history", async () => {
  const daily = [
    "- [ ] #task Target ^gtd",
    "## Pomodoros",
    "- [ ] (**1110-1135** [t:: 25m])",
    "  - [[#^gtd]]#",
    "  - foo bar baz",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 2, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: "Daily.md" },
      { pomodoroLine: 2 },
    ),
    true,
  );
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Target ^gtd",
      "## Pomodoros",
      "- [x] (**1110-1135** [t:: 25m])",
      "  - foo bar baz",
      "- [ ] ()",
      "  - [[#^gtd]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 4, ch: 7 });
  assert.equal((editor.getValue().match(/#\^gtd/g) || []).length, 1);
  assert.equal((editor.getValue().match(/- \[ \] \(\)/g) || []).length, 1);
  assert.equal(editor.getValue().includes("]]#"), false);
  assert.equal(editor.getValue().includes("🍅"), false);
});

test("selected Done Pomodoro transclusion reopens only its cross-file root", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root|Work]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": [
      "- [x] #task Root [completion:: 2026-07-11] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: 2026-07-11] ^child",
    ].join("\n"),
  });
  const editor = createTextEditor(daily, { line: 2, ch: 10 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.equal(
    harness.getSource("Tree.md"),
    [
      "- [ ] #task Root ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: 2026-07-11] ^child",
    ].join("\n"),
  );
  assert.equal(editor.getValue(), daily);
});

test("selected same-file Done target reopens root-only in the live editor", async () => {
  const daily = [
    "## Tasks",
    "- [x] #task Root [completion:: stale] ^root",
    "\t- ![[#^child]]",
    "- [x] #task Child [completion:: stale] ^child",
    "- [ ] #task Dependency holder",
    "\t- ~~[[#^root|Root]]~~ and ~~[[#^child|Child]]~~",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[#^root]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 8, ch: 8 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.match(editor.getValue(), /^- \[ \] #task Root \^root/m);
  assert.match(editor.getValue(), /^- \[x\] #task Child \[completion:: stale\] \^child/m);
  assert.match(editor.getValue(), /\t- !\[\[#\^root\]\]$/m);
  assert.match(
    editor.getValue(),
    /\t- !\[\[#\^root\|Root\]\] and ~~\[\[#\^child\|Child\]\]~~/,
  );
});

test("selected retired link reopens its root and restores the historical occurrence", async () => {
  const daily = "## Pomodoros\n- [x] History\n\t- 🍅 ~~[[Tasks#^done|Alias]]~~";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [x] #task Done [completion:: stale] ^done",
  });
  const editor = createTextEditor(daily, { line: 2, ch: 18 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.equal(harness.getSource("Tasks.md"), "- [ ] #task Done ^done");
  assert.equal(
    editor.getValue(),
    "## Pomodoros\n- [x] History\n\t- 🍅 [[Tasks#^done|Alias]]",
  );
});

test("incomplete selected Pomodoro transclusion still closes recursively", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": [
      "- [ ] #task Root ^root",
      "\t- ![[#^child]]",
      "- [*] #task Child ^child",
    ].join("\n"),
  });
  const editor = createTextEditor(daily, { line: 2, ch: 9 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-12";
  plugin.finalizeClosedTasks = async () => ({ reopened: 0, retired: 0 });

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
});

test("Done Pomodoro reopens direct roots and clears only its block-link markers", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] Finished session",
    "\t- 🍅 ![[Tasks#^done|Embedded]] and 🍅 [[Tasks#^done|Duplicate]]",
    "\t- 🍅 ~~[[Tasks#^retired|Retired]]~~ and 🍅 [[Tasks#^open|Open]]",
    "\t- 🍅 [[Tasks#^progress]] and 🍅 [[Tasks#^next]] and 🍅 [[Tasks#^canceled]]",
    "\t- 🍅 [[Tasks#^custom]] and 🍅 [[Missing#^missing]] and 🍅 [[Bad#^stale]]",
    "\t- Keep this unrelated 🍅 tomato and prose exactly as written",
    "```md",
    "\t- 🍅 [[Tasks#^done|Fenced example]]",
    "```",
    "- [ ] Later session",
    "\t- 🍅 [[Tasks#^carry|Carry]]",
  ].join("\n");
  const tasks = [
    "- [x] #task Done [completion:: old] ^done",
    "\t- ![[#^child]]",
    "- [x] #task Done child [completion:: old] ^child",
    "- [X] #task Retired root [completion:: old] ^retired",
    "- [ ] #task Open ^open",
    "- [/] #task In progress ^progress",
    "- [*] #task Next ^next",
    "- [-] #task Canceled ^canceled",
    "- [?] #task Custom ^custom",
    "- [ ] #task Carry ^carry",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
    "Bad.md": "- [x] #task Unreadable ^stale",
  });
  const originalRead = harness.app.vault.read;
  harness.app.vault.read = async (file) => {
    if (file.path === "Bad.md") throw new Error("unreadable");
    return originalRead(file);
  };
  const originalProcess = harness.app.vault.process;
  let tasksWrites = 0;
  harness.app.vault.process = async (file, updateSourceText) => {
    if (file.path === "Tasks.md") tasksWrites += 1;
    return originalProcess(file, updateSourceText);
  };
  const editor = createTextEditor(daily, { line: 1, ch: 5 });
  const originalCursor = editor.getCursor();
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.reopenActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      plugin.getActivePomodoroTaskContext(
        editor,
        plugin.getActiveTaskStatus(editor),
        "x",
      ),
    ),
    true,
  );

  const expectedDaily = [
    "## Pomodoros",
    "- [ ] Finished session",
    "\t- ![[Tasks#^done|Embedded]] and [[Tasks#^done|Duplicate]]",
    "\t- [[Tasks#^retired|Retired]] and [[Tasks#^open|Open]]",
    "\t- [[Tasks#^progress]] and [[Tasks#^next]] and [[Tasks#^canceled]]",
    "\t- [[Tasks#^custom]] and [[Missing#^missing]] and [[Bad#^stale]]",
    "\t- Keep this unrelated 🍅 tomato and prose exactly as written",
    "```md",
    "\t- 🍅 [[Tasks#^done|Fenced example]]",
    "```",
    "- [ ] Later session",
    "\t- 🍅 [[Tasks#^carry|Carry]]",
  ].join("\n");
  assert.equal(editor.getValue(), expectedDaily);
  assert.deepEqual(editor.getCursor(), originalCursor);
  assert.equal(tasksWrites, 2, "duplicate links should not duplicate source writes");
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Done \^done/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Retired root \^retired/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task Done child/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Open/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\/\] #task In progress/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\*\] #task Next/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[-\] #task Canceled/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\?\] #task Custom/m);
  assert.equal(harness.getSource("Bad.md"), "- [x] #task Unreadable ^stale");
});

test("Done Pomodoro reopen restores its own block reference after reopening direct roots", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] Finished session ^session",
    "\t- ~~[[Tasks#^root|Root]]~~",
  ].join("\n");
  const tasks = [
    "- [x] #task Root [dependsOn:: keep] [id:: Tasks__root] [completion:: stale] ^root",
    "- [ ] #task Session dependency",
    "\t- ~~[[Daily#^session|Session]]~~",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
  });
  const editor = createTextEditor(daily, { line: 1, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.reopenActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      { pomodoroLine: 1 },
    ),
    true,
  );
  assert.match(editor.getValue(), /^- \[ \] Finished session \^session/m);
  assert.match(editor.getValue(), /\t- \[\[Tasks#\^root\|Root\]\]/);
  assert.match(
    harness.getSource("Tasks.md"),
    /^- \[ \] #task Root \[dependsOn:: keep\] \[id:: Tasks__root\] \^root/m,
  );
  assert.match(
    harness.getSource("Tasks.md"),
    /\t- !\[\[Daily#\^session\|Session\]\]/,
  );
});

test("Done Pomodoro markers remain when the Todo transition does not occur", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] Finished session",
    "\t- 🍅 [[Missing#^stale|Keep history]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 1, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.setActiveCheckboxStatus = () => false;

  assert.equal(
    await plugin.reopenActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      { pomodoroLine: 1 },
    ),
    false,
  );
  assert.equal(editor.getValue(), daily);
});

test("registered Ctrl+Enter completes an open Pomodoro from every non-selected-embed child shape", async () => {
  const cases = [
    {
      name: "prose bullet",
      children: ["\t- planning notes"],
      cursor: { line: 2, ch: 0 },
    },
    {
      name: "plain block link",
      children: ["\t- [[Missing#^plain|Plain]]"],
      cursor: { line: 2, ch: 0 },
    },
    {
      name: "marked block link",
      children: ["\t- 🍅 [[Missing#^marked|Marked]]"],
      cursor: { line: 2, ch: 0 },
    },
    {
      name: "nested bullet",
      children: ["\t- parent note", "\t\t- nested note"],
      cursor: { line: 3, ch: 0 },
    },
    {
      name: "child checkbox",
      children: ["\t- [ ] Child checkbox"],
      cursor: { line: 2, ch: 5 },
      unchangedChild: "\t- [ ] Child checkbox",
    },
    {
      name: "ambiguous embedded links",
      children: ["\t- ![[Missing#^one]] and ![[Missing#^two]]"],
      cursor: { line: 2, ch: 0 },
    },
  ];

  for (const testCase of cases) {
    const daily = [
      "## Pomodoros",
      "- [ ] Focus",
      ...testCase.children,
    ].join("\n");
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, testCase.cursor);
    const plugin = new TaskStatusCyclerPlugin();
    plugin.scheduleCenterEditorLineInView = () => {};
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();

    assert.equal(editor.getLine(1), "- [x] Focus", testCase.name);
    if (testCase.unchangedChild) {
      assert.equal(editor.getLine(2), testCase.unchangedChild, testCase.name);
    }
  }
});

test("registered Ctrl+Enter immediately recovers a same-file dependent", async () => {
  const source = [
    "- [ ] #task Root [id:: root]",
    "- [?] #task Dependent [dependsOn:: root] ^dependent",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Tasks.md": source });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(source, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  attachActiveMarkdownView(plugin, harness, editor, "Tasks.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task Root \[id:: root\]/m);
  assert.match(editor.getValue(), /^- \[ \] #task Dependent/m);
});

test("registered Ctrl+Enter immediately recovers a cross-file dependent", async () => {
  const daily = "- [[Tasks#^root|Root]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [/] #task Root [id:: root] ^root",
    "Dependent.md": "- [?] #task Dependent (dependsOn:: root) ^dependent",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(daily, { line: 0, ch: 5 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-07-16";
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Dependent.md"), /^- \[ \] #task Dependent/m);
  assert.equal(editor.getValue(), daily);
});

test("child-line Ctrl+Enter produces the same rollover and cursor target as parent completion", async () => {
  const daily = [
    "- [ ] #task Carry ^carry",
    "- [ ] #task Move ^move",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[#^carry|Carry]]",
    "\t- [[#^move|Move]]#",
    "\t- keep this note",
    "- [ ] Later",
    "\t- later note",
  ].join("\n");

  const runCompletion = async (cursor) => {
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, cursor);
    const plugin = new TaskStatusCyclerPlugin();
    plugin.scheduleCenterEditorLineInView = () => {};
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);
    action({});
    await flushAsyncActions();
    return { text: editor.getValue(), cursor: editor.getCursor() };
  };

  const parentResult = await runCompletion({ line: 3, ch: 4 });
  const childResult = await runCompletion({ line: 6, ch: 6 });
  assert.deepEqual(childResult, parentResult);
  assert.equal(
    childResult.text,
    [
      "- [/] #task Carry ^carry",
      "- [ ] #task Move ^move",
      "## Pomodoros",
      "- [x] Focus",
      "\t- 🍅 [[#^carry|Carry]]",
      "\t- keep this note",
      "- [ ] ()",
      "\t- [[#^carry|Carry]]",
      "\t- [[#^move|Move]]",
      "- [ ] Later",
      "\t- later note",
    ].join("\n"),
  );
  assert.deepEqual(childResult.cursor, { line: 6, ch: 7 });
  assert.equal((childResult.text.match(/- \[ \] \(\)/g) || []).length, 1);
  assert.equal(childResult.text.includes("]]#"), false);
});

test("Ctrl+Enter preserves cross-file move-only targets while ordinary duplicates still start", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- [[Tasks#^todo|Todo]]#",
    "\t- [[Tasks#^next|Next]]#",
    "\t- [[Tasks#^duplicate|Ordinary duplicate]]",
    "\t- [[Tasks#^duplicate|Move-only duplicate]]#",
  ].join("\n");
  const tasks = [
    "- [ ] #task Todo ^todo",
    "- [*] #task Next ^next",
    "- [ ] #task Duplicate ^duplicate",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.scheduleCenterEditorLineInView = () => {};
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(
    harness.getSource("Tasks.md"),
    [
      "- [ ] #task Todo ^todo",
      "- [*] #task Next ^next",
      "- [/] #task Duplicate ^duplicate",
    ].join("\n"),
  );
  assert.equal(editor.getLine(1), "- [x] Focus");
  assert.equal(editor.getValue().includes("]]#"), false);
});

test("selected embedded Pomodoro children keep recursive close and root-only reopen dispatch", async () => {
  for (const symbol of [" ", "/", "*"]) {
    const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
    const tree = [
      `- [${symbol}] #task Root ^root`,
      "\t- ![[#^child]]",
      "- [/] #task Child ^child",
    ].join("\n");
    const harness = createInMemoryObsidianApp({
      "Daily.md": daily,
      "Tree.md": tree,
    });
    const editor = createTextEditor(daily, { line: 2, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.getCompletionDateString = () => "2026-07-16";
    plugin.finalizeClosedTasks = async () => ({ reopened: 0, retired: 0 });
    let parentCompletions = 0;
    const completeParent = plugin.completeActivePomodoroTask.bind(plugin);
    plugin.completeActivePomodoroTask = async (...args) => {
      parentCompletions += 1;
      return completeParent(...args);
    };
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();

    assert.equal(parentCompletions, 0, `selected [${symbol}] root`);
    assert.equal(editor.getValue(), daily, `selected [${symbol}] root`);
    assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Root/m);
    assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
  }

  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
  const tree = [
    "- [x] #task Root [completion:: stale] ^root",
    "\t- ![[#^child]]",
    "- [x] #task Child [completion:: stale] ^child",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": tree,
  });
  const editor = createTextEditor(daily, { line: 2, ch: 0 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.restoreReopenedTaskReferences = async () => ({
    restored: 0,
    failures: [],
  });
  let parentCompletions = 0;
  plugin.completeActivePomodoroTask = async () => {
    parentCompletions += 1;
    return true;
  };
  attachActiveMarkdownView(plugin, harness, editor);
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();

  assert.equal(parentCompletions, 0);
  assert.equal(editor.getLine(1), "- [ ] Focus");
  assert.match(harness.getSource("Tree.md"), /^- \[ \] #task Root \^root/m);
  assert.match(
    harness.getSource("Tree.md"),
    /^- \[x\] #task Child \[completion:: stale\] \^child/m,
  );
});

test("selected unresolved or excluded embedded children are consumed as no-ops", async () => {
  const cases = [
    { name: "stale", targetSource: null },
    { name: "non-task", targetSource: "- Plain note block ^root" },
    { name: "excluded", targetSource: "- [-] #task Canceled ^root" },
  ];

  for (const testCase of cases) {
    const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Target#^root]]";
    const sources = { "Daily.md": daily };
    if (testCase.targetSource !== null) {
      sources["Target.md"] = testCase.targetSource;
    }
    const harness = createInMemoryObsidianApp(sources);
    const editor = createTextEditor(daily, { line: 2, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    let parentCompletions = 0;
    plugin.completeActivePomodoroTask = async () => {
      parentCompletions += 1;
      return true;
    };
    attachActiveMarkdownView(plugin, harness, editor);
    const action = registerTaskToggleVimAction(plugin);

    action({});
    await flushAsyncActions();

    assert.equal(parentCompletions, 0, testCase.name);
    assert.equal(editor.getValue(), daily, testCase.name);
    if (testCase.targetSource !== null) {
      assert.equal(
        harness.getSource("Target.md"),
        testCase.targetSource,
        testCase.name,
      );
    }
  }
});

test("Ctrl+Enter behavior stays generic outside open Pomodoro child ranges", async () => {
  {
    const daily = "- [ ] Ordinary checkbox\n## Pomodoros\n- [ ] Focus\n\t- note";
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, { line: 0, ch: 4 });
    const plugin = new TaskStatusCyclerPlugin();
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    assert.equal(editor.getLine(0), "- [x] Ordinary checkbox");
    assert.equal(editor.getLine(2), "- [ ] Focus");
  }

  {
    const daily = [
      "- [ ] Linked task ^target",
      "- [[#^target]]",
      "## Pomodoros",
      "- [ ] Focus",
      "\t- note",
    ].join("\n");
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, { line: 1, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    assert.equal(editor.getLine(0), "- [x] Linked task ^target");
    assert.equal(editor.getLine(3), "- [ ] Focus");
  }

  {
    const daily = "## Pomodoros\n- [x] Historical\n\t- [ ] Child checkbox";
    const harness = createInMemoryObsidianApp({ "Daily.md": daily });
    const editor = createTextEditor(daily, { line: 2, ch: 5 });
    const plugin = new TaskStatusCyclerPlugin();
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    assert.equal(editor.getLine(1), "- [x] Historical");
    assert.equal(editor.getLine(2), "\t- [x] Child checkbox");
  }

  {
    const daily = "## Pomodoros\n- [-] Canceled\n\t- ![[Tree#^root]]";
    const tree = [
      "- [x] #task Root [completion:: stale] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: stale] ^child",
    ].join("\n");
    const harness = createInMemoryObsidianApp({
      "Daily.md": daily,
      "Tree.md": tree,
    });
    const editor = createTextEditor(daily, { line: 2, ch: 0 });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.restoreReopenedTaskReferences = async () => ({
      restored: 0,
      failures: [],
    });
    attachActiveMarkdownView(plugin, harness, editor);
    registerTaskToggleVimAction(plugin)({});
    await flushAsyncActions();
    assert.equal(editor.getLine(1), "- [-] Canceled");
    assert.match(harness.getSource("Tree.md"), /^- \[ \] #task Root \^root/m);
    assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
  }
});

test("Vim Ctrl+Enter dispatches task transitions and restores a reopened identity", async () => {
  const originalWindow = global.window;
  const actions = new Map();
  const mappings = [];
  const vim = {
    defineAction(name, handler) {
      actions.set(name, handler);
    },
    mapCommand(key, type, name, args, options) {
      mappings.push({ key, type, name, args, options });
    },
  };
  global.window = { CodeMirrorAdapter: { Vim: vim } };

  try {
    let lineText = "- [/] #task Complete the regression fix";
    const editor = {
      getCursor: () => ({ line: 0, ch: 6 }),
      getLine: () => lineText,
      replaceRange: () => assert.fail("Tasks command should handle the write"),
    };
    const view = Object.assign(new MarkdownView(), {
      editor,
      file: { path: "Tasks.md" },
    });
    const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
    const todoCommand = "obsidian-tasks-plugin:set-status-symbol-to-space";
    const executedCommands = [];
    let restored = null;
    const plugin = new TaskStatusCyclerPlugin();
    plugin.restoreReopenedTaskReferences = async (identities) => {
      restored = identities;
      return { restored: identities.length, failures: [] };
    };
    plugin.app = {
      workspace: {
        getActiveViewOfType: (ViewType) => {
          assert.equal(ViewType, MarkdownView);
          return view;
        },
        getActiveFile: () => view.file,
      },
      commands: {
        commands: { [doneCommand]: {}, [todoCommand]: {} },
        executeCommandById: (commandId) => {
          executedCommands.push(commandId);
          return true;
        },
      },
    };

    assert.equal(plugin.registerVimMappings(), true);
    for (const key of ["<C-CR>", "<C-Enter>"]) {
      assert.ok(
        mappings.some(
          (mapping) =>
            mapping.key === key &&
            mapping.type === "action" &&
            mapping.name === "taskStatusCyclerToggleTaskOpenDone" &&
            mapping.options.context === "normal",
        ),
        `${key} should map to the direct open/done action in normal mode`,
      );
    }

    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    lineText = "- [*] #task Preserve the existing Next behavior";
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    lineText = "- [x] #task Reopen through the Tasks command ^reopen";
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    await Promise.resolve();
    assert.deepEqual(executedCommands, [
      doneCommand,
      doneCommand,
      todoCommand,
    ]);
    assert.deepEqual(restored, [{ path: "Tasks.md", blockId: "reopen" }]);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("Ctrl+Enter on a task line wrapping an embedded transclusion closes the source task and recovers its dependents", async () => {
  const blockers = "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]";
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Source#^target]]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md": "- [/] #task Source task [id:: target] ^target",
    "Daily.md": daily,
    "Dependent.md": "- [?] #task Dependent [dependsOn:: target] ^dependent",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.getCompletionDateString = () => "2026-08-07";
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[Source#\^target\]\] \[created:: 2026-08-07\]/);
  assert.match(
    harness.getSource("Source.md"),
    /^- \[x\] #task Source task \[id:: target\]\s+\[completion:: 2026-08-07\]\s+\^target/,
  );
  assert.match(harness.getSource("Daily.md"), /\t- ~~\[\[Source#\^target\]\]~~/);
  assert.match(harness.getSource("Dependent.md"), /^- \[ \] #task Dependent/m);
});

test("Ctrl+Enter reopen restores both the local line and the transcluded source, un-retiring references", async () => {
  const blockers =
    "- [x] #task ![[Source#^target]] [created:: 2026-08-07]  [completion:: 2026-08-07]";
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ~~[[Source#^target]]~~";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md":
      "- [x] #task Source task [id:: target]  [completion:: 2026-08-07] ^target",
    "Daily.md": daily,
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[ \] #task !\[\[Source#\^target\]\] \[created:: 2026-08-07\]/);
  assert.doesNotMatch(editor.getValue(), /completion::/);
  assert.match(harness.getSource("Source.md"), /^- \[ \] #task Source task \[id:: target\] \^target/);
  // Pomodoro-descendant restoration deliberately un-strikes to a plain link
  // rather than re-embedding it, matching the existing carry-forward convention.
  assert.match(harness.getSource("Daily.md"), /\t- \[\[Source#\^target\]\]/);
});

test("Ctrl+Enter reopening the local line over an already-open target does not accidentally close it", async () => {
  const blockers =
    "- [x] #task ![[Source#^target]] [created:: 2026-08-07]  [completion:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md": "- [ ] #task Source task [id:: target] ^target",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const sourceBefore = harness.getSource("Source.md");

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[ \] #task !\[\[Source#\^target\]\]/);
  assert.equal(harness.getSource("Source.md"), sourceBefore);
});

test("Ctrl+Enter closing the local line over an already-closed target does not write it a second time", async () => {
  const blockers = "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md":
      "- [x] #task Source task [id:: target]  [completion:: 2026-08-07] ^target",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const sourceBefore = harness.getSource("Source.md");
  let finalizeCalls = 0;
  plugin.finalizeClosedTasks = async () => {
    finalizeCalls += 1;
    return { reopened: 0, retired: 0, recoveryFailures: [], retirementFailures: [] };
  };

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[Source#\^target\]\]/);
  assert.equal(harness.getSource("Source.md"), sourceBefore);
  assert.equal(finalizeCalls, 0);
});

test("Ctrl+Enter on an unresolvable embedded transclusion still closes the local line without error", async () => {
  const blockers = "- [ ] #task ![[Missing#^nope]] [created:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({ "Blockers.md": blockers });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[Missing#\^nope\]\]/);
});

test("Ctrl+Enter on a task line with two embeds and the cursor outside both toggles only the local line", async () => {
  const blockers = "- [ ] #task ![[A#^a]] and ![[B#^b]] [created:: 2026-08-07]";
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "A.md": "- [ ] #task A ^a",
    "B.md": "- [ ] #task B ^b",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 0, ch: 0 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const aBefore = harness.getSource("A.md");
  const bBefore = harness.getSource("B.md");

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.match(editor.getValue(), /^- \[x\] #task !\[\[A#\^a\]\] and !\[\[B#\^b\]\]/);
  assert.equal(harness.getSource("A.md"), aBefore);
  assert.equal(harness.getSource("B.md"), bBefore);
});

test("Ctrl+Enter on a task line inside a fenced code block does not propagate to its embedded transclusion", async () => {
  const blockers = [
    "```md",
    "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]",
    "```",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Blockers.md": blockers,
    "Source.md": "- [ ] #task Source task [id:: target] ^target",
  });
  harness.app.commands = { commands: {}, executeCommandById: () => false };
  const editor = createTextEditor(blockers, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  attachActiveMarkdownView(plugin, harness, editor, "Blockers.md");
  const action = registerTaskToggleVimAction(plugin);
  const sourceBefore = harness.getSource("Source.md");

  action({});
  await flushAsyncActions();
  await plugin.referenceMutationQueue;

  assert.equal(harness.getSource("Source.md"), sourceBefore);
});

test("Ctrl+Enter with a transcluded task line still uses the Tasks-plugin command for the local write", async () => {
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
    const lineText = "- [ ] #task ![[Source#^target]] [created:: 2026-08-07]";
    const editor = {
      getCursor: () => ({ line: 0, ch: 6 }),
      getLine: () => lineText,
      replaceRange: () => assert.fail("Tasks command should handle the write"),
    };
    const view = Object.assign(new MarkdownView(), {
      editor,
      file: { path: "Blockers.md" },
    });
    const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
    const executedCommands = [];
    const plugin = new TaskStatusCyclerPlugin();
    const harness = createInMemoryObsidianApp({
      "Blockers.md": lineText,
      "Source.md": "- [ ] #task Source task [id:: target] ^target",
    });
    plugin.app = {
      ...harness.app,
      workspace: {
        getActiveViewOfType: (ViewType) => {
          assert.equal(ViewType, MarkdownView);
          return view;
        },
        getActiveFile: () => view.file,
      },
      commands: {
        commands: { [doneCommand]: {} },
        executeCommandById: (commandId) => {
          executedCommands.push(commandId);
          return true;
        },
      },
    };

    assert.equal(plugin.registerVimMappings(), true);
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    await flushAsyncActions();
    await plugin.referenceMutationQueue;

    assert.deepEqual(executedCommands, [doneCommand]);
    assert.match(
      harness.getSource("Source.md"),
      /^- \[x\] #task Source task \[id:: target\]\s+\[completion::/,
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("option-bracket ring reads Blocked as a source-only slot ahead of Ready", () => {
  const plugin = new TaskStatusCyclerPlugin();
  assert.equal(plugin.getAdjacentSymbol("?", 1), " ");
  assert.equal(plugin.getAdjacentSymbol("?", -1), "-");

  const table = [
    { symbol: " ", forward: "/", backward: "-" },
    { symbol: "/", forward: "*", backward: " " },
    { symbol: "*", forward: "x", backward: "/" },
    { symbol: "x", forward: "-", backward: "*" },
    { symbol: "-", forward: " ", backward: "x" },
  ];
  for (const { symbol, forward, backward } of table) {
    assert.equal(plugin.getAdjacentSymbol(symbol, 1), forward, `${symbol} forward`);
    assert.equal(plugin.getAdjacentSymbol(symbol, -1), backward, `${symbol} backward`);
  }

  for (const symbol of [" ", "/", "*", "x", "-", "?"]) {
    assert.notEqual(plugin.getAdjacentSymbol(symbol, 1), "?");
    assert.notEqual(plugin.getAdjacentSymbol(symbol, -1), "?");
  }
});

test("isCyclableTaskStatus accepts Blocked while Ctrl+Enter predicates still reject it", () => {
  const blocked = helpers.getTaskStatusForLine("- [?] #task Custom ^custom");
  assert.equal(helpers.isCyclableTaskStatus(blocked), true);
  assert.equal(
    helpers.isCyclableTaskStatus(helpers.getTaskStatusForLine("- [!] #task Unknown")),
    false,
  );
  assert.equal(helpers.isTranscludedCompletionTraversableStatus(blocked), false);
  assert.equal(helpers.isTranscludedCompletionClosableStatus(blocked), false);
  assert.equal(helpers.isTranscludedReopenableStatus(blocked), false);
  assert.equal(helpers.isOpenDoneTaskStatus(blocked), false);
});

test("findSingleFutureScheduledField validates form, field order, and the strictly-future boundary", () => {
  const today = "2026-08-17";
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-20]", today).value,
    "2026-08-20",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X (scheduled:: 2026-08-20)", today).value,
    "2026-08-20",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField(
      "- [?] #task X [priority:: high] [scheduled:: 2026-08-20] [effort:: 2]",
      today,
    ).value,
    "2026-08-20",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled::2026-08-20]", today).value,
    "2026-08-20",
  );
  assert.ok(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2028-02-29]", today),
    "leap day is valid",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-02-30]", today),
    null,
    "impossible date is rejected",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 26-8-20]", today),
    null,
    "wrong-width value is rejected",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-16]", today),
    null,
    "yesterday is not future",
  );
  assert.equal(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-17]", today),
    null,
    "today is not future",
  );
  assert.ok(
    helpers.findSingleFutureScheduledField("- [?] #task X [scheduled:: 2026-08-18]", today),
    "tomorrow is future",
  );
});

test("field removal collapses only the exposed span and preserves the rest of the line", () => {
  const today = "2026-08-17";
  const line =
    "1. [?] #task Ship it [priority:: medium] [scheduled:: 2026-08-20] #urgent ^ship";
  const field = helpers.findSingleFutureScheduledField(line, today);
  const removed = helpers.removeSpanWithSpaceCollapse(line, field.start, field.end);
  assert.equal(removed, "1. [?] #task Ship it [priority:: medium] #urgent ^ship");
  assert.equal(/[ \t]$/.test(removed), false);

  const trailingField = "- [?] #task Ship it [scheduled:: 2026-08-20]";
  const trailingFieldMatch = helpers.findSingleFutureScheduledField(trailingField, today);
  assert.equal(
    helpers.removeSpanWithSpaceCollapse(
      trailingField,
      trailingFieldMatch.start,
      trailingFieldMatch.end,
    ),
    "- [?] #task Ship it",
  );
});

test("vault-path retirement preserves CRLF and a missing final newline", () => {
  const today = "2026-08-17";
  const crlfSource =
    ["- [?] #task First [scheduled:: 2026-08-20] ^first", "  - 🗓️ **SCHEDULE LOG**"].join(
      "\r\n",
    ) + "\r\n";
  const crlfResult = helpers.applyBlockedStatusRetirementToSourceText(crlfSource, 0, today);
  assert.ok(crlfResult);
  assert.equal(crlfResult.text.includes("\r\n"), true);
  assert.equal(/(?<!\r)\n/.test(crlfResult.text), false);

  const noFinalNewline = "- [?] #task Solo [scheduled:: 2026-08-20] ^solo";
  const soloResult = helpers.applyBlockedStatusRetirementToSourceText(noFinalNewline, 0, today);
  assert.ok(soloResult);
  assert.equal(soloResult.text, "- [?] #task Solo ^solo");
  assert.equal(soloResult.text.endsWith("\n"), false);
});

test("Schedule Log insertion recognizes all three marker spellings and lands directly beneath the marker", () => {
  const today = "2026-08-17";
  for (const marker of [
    "- 🗓️ **SCHEDULE LOG**",
    "- **SCHEDULE LOG**",
    "- **Schedule log:**",
  ]) {
    const lines = [
      "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
      `\t${marker}`,
      "\t\t- *2026-08-06 → 2026-08-20* — waiting on the API review",
    ];
    const plan = helpers.planBlockedStatusRetirement(lines, 0, today);
    assert.ok(plan, marker);
    assert.equal(plan.removedDate, "2026-08-20");
    assert.equal(plan.lineText, "- [?] #task Ship it ^ship");
    assert.ok(plan.insertion, marker);
    assert.equal(plan.insertion.line, 2);
    assert.equal(
      plan.insertion.text,
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    );
  }
});

test("Schedule Log discovery ignores a marker owned by a nested grandchild", () => {
  const today = "2026-08-17";
  const lines = [
    "- [?] #task Parent [scheduled:: 2026-08-20] ^parent",
    "\t- [ ] #task Child",
    "\t\t- 🗓️ **SCHEDULE LOG**",
    "\t\t\t- *2026-08-06 → 2026-08-20* — waiting",
  ];
  const plan = helpers.planBlockedStatusRetirement(lines, 0, today);
  assert.ok(plan);
  assert.equal(plan.lineText, "- [?] #task Parent ^parent");
  assert.equal(plan.insertion, null);
});

test("Schedule Log entry falls back to marker indent plus one tab and reuses the marker's own bullet when the log has no entries", () => {
  const today = "2026-08-17";
  const noEntries = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "\t- 🗓️ **SCHEDULE LOG**",
  ];
  const plan = helpers.planBlockedStatusRetirement(noEntries, 0, today);
  assert.ok(plan.insertion);
  assert.equal(plan.insertion.line, 2);
  assert.equal(
    plan.insertion.text,
    "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
  );

  const starMarker = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "\t* 🗓️ **SCHEDULE LOG**",
  ];
  const starPlan = helpers.planBlockedStatusRetirement(starMarker, 0, today);
  assert.match(starPlan.insertion.text, /^\t\t\* /);

  const existingEntries = [
    "- [?] #task Ship it [scheduled:: 2026-08-20] ^ship",
    "\t- 🗓️ **SCHEDULE LOG**",
    "\t\t\t- *2026-08-06 → 2026-08-20* — waiting on the API review",
  ];
  const existingPlan = helpers.planBlockedStatusRetirement(existingEntries, 0, today);
  assert.equal(existingPlan.insertion.line, 2);
  assert.equal(
    existingPlan.insertion.text,
    "\t\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
  );
});

test("a task with no Schedule Log gets its field retired without any insertion or new marker", () => {
  const today = "2026-08-17";
  const plan = helpers.planBlockedStatusRetirement(
    ["- [?] #task Solo [scheduled:: 2026-08-20] ^solo"],
    0,
    today,
  );
  assert.ok(plan);
  assert.equal(plan.lineText, "- [?] #task Solo ^solo");
  assert.equal(plan.insertion, null);
});

test("Schedule Log entry uses the canonical arrow, dash, and lock bytes", () => {
  const entry = helpers.formatScheduleLogEntry("2026-08-20", "2026-08-17");
  assert.equal(entry, "*2026-08-20 → 2026-08-17* — 🔓 unblocked by hand");
  assert.equal(entry.includes("→"), true);
  assert.equal(entry.includes("—"), true);
  assert.equal(entry.includes("\u{1F513}"), true);
});

test("retirement stays a no-op for shapes that are not proof of a blocking date", () => {
  const today = "2026-08-17";
  const cases = [
    "- [?] #task No field ^plain",
    "- [?] #task Past due [scheduled:: 2026-08-10] ^past",
    "- [?] #task Due today [scheduled:: 2026-08-17] ^today",
    "- [?] #task Two fields [scheduled:: 2026-08-20] [scheduled:: 2026-08-21] ^two",
    "- [?] #task Malformed [scheduled:: not-a-date] ^bad",
    "- [?] Not a task at all [scheduled:: 2026-08-20] ^bare",
  ];
  for (const line of cases) {
    assert.equal(helpers.planBlockedStatusRetirement([line], 0, today), null, line);
    assert.equal(
      helpers.applyBlockedStatusRetirementToSourceText(line, 0, today),
      null,
      line,
    );
  }
});

test("cycling Blocked backward to Cancelled retires the date and logs, matching forward", () => {
  const editor = createTextEditor(
    ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "\t- 🗓️ **SCHEDULE LOG**"].join(
      "\n",
    ),
    { line: 0, ch: 4 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

  assert.equal(plugin.handleCycleCommand(false, editor, view, -1), true);
  assert.equal(
    editor.getValue(),
    [
      "- [-] #task Ship it ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    ].join("\n"),
  );
});

test("single-press Blocked retirement matches with and without an existing Schedule Log, and with the Tasks command handling the write", () => {
  {
    const editor = createTextEditor(
      "- [?] #task Solo [scheduled:: 2026-08-20] ^solo",
      { line: 0, ch: 4 },
    );
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(editor.getValue(), "- [ ] #task Solo ^solo");
    assert.deepEqual(editor.getCursor(), { line: 0, ch: 4 });
  }

  {
    const editor = createTextEditor(
      ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "\t- 🗓️ **SCHEDULE LOG**"].join(
        "\n",
      ),
      { line: 0, ch: 4 },
    );
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(
      editor.getValue(),
      [
        "- [ ] #task Ship it ^ship",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }

  {
    const editor = createTextEditor(
      ["- [?] #task Ship it [scheduled:: 2026-08-20] ^ship", "\t- 🗓️ **SCHEDULE LOG**"].join(
        "\n",
      ),
      { line: 0, ch: 4 },
    );
    const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-space";
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = {
      commands: {
        commands: { [doneCommand]: {} },
        executeCommandById: (commandId) => {
          assert.equal(commandId, doneCommand);
          editor.replaceRange(
            "- [ ] #task Ship it [scheduled:: 2026-08-20] ^ship",
            { line: 0, ch: 0 },
            { line: 0, ch: editor.getLine(0).length },
          );
          return true;
        },
      },
    };
    plugin.getScheduleLogDateString = () => "2026-08-17";
    const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

    assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
    assert.equal(
      editor.getValue(),
      [
        "- [ ] #task Ship it ^ship",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }
});

test("counted range cycling maps editor coordinates through Schedule Log insertions, including a nested child task above the marker", async () => {
  const editor = createTextEditor(
    [
      "- [?] #task Parent [scheduled:: 2026-08-20] ^parent",
      "\t- [ ] #task Nested child ^child",
      "\t- 🗓️ **SCHEDULE LOG**",
      "- [ ] #task Sibling ^sibling",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
  plugin.getScheduleLogDateString = () => "2026-08-17";

  const changed = await plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 3);
  assert.equal(changed, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Parent ^parent",
      "\t- [/] #task Nested child ^child",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      "- [/] #task Sibling ^sibling",
    ].join("\n"),
  );
});

test("counted range accounts for a cursor-line Tasks-command insertion when targeting later lines", async () => {
  const doneCommand = "obsidian-tasks-plugin:set-status-symbol-to-x";
  const editor = createTextEditor(
    [
      "- [*] #task Recurring 🔁 every week ^recurring",
      "- [ ] #task Second ^second",
    ].join("\n"),
    { line: 0, ch: 0 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    commands: {
      commands: { [doneCommand]: {} },
      executeCommandById: (commandId) => {
        assert.equal(commandId, doneCommand);
        editor.replaceRange(
          "- [ ] #task Recurring 🔁 every week ^recurring-next\n- [x] #task Recurring 🔁 every week ^recurring",
          { line: 0, ch: 0 },
          { line: 0, ch: editor.getLine(0).length },
        );
        return true;
      },
    },
  };

  const changed = await plugin.cycleTaskStatusRange(editor, { path: "Tasks.md" }, 1, 1);
  assert.equal(changed, true);
  assert.equal(
    editor.getValue(),
    [
      "- [ ] #task Recurring 🔁 every week ^recurring-next",
      "- [x] #task Recurring 🔁 every week ^recurring",
      "- [/] #task Second ^second",
    ].join("\n"),
  );
});

test("transcluded Blocked cycling retires the target's schedule and logs it, in another note and in the active note", async () => {
  {
    const harness = createInMemoryObsidianApp({
      "Daily.md": "- ![[Tasks#^blocked]]",
      "Tasks.md": [
        "- [?] #task Blocked one [scheduled:: 2026-08-20] ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
      ].join("\n"),
    });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    plugin.getScheduleLogDateString = () => "2026-08-17";

    const wrote = await plugin.cycleResolvedTranscludedTaskLink(
      getEmbeddedTarget("![[Tasks#^blocked]]"),
      { activePath: "Daily.md", originPath: "Daily.md", editor: null },
      1,
    );
    assert.equal(wrote, true);
    assert.equal(
      harness.getSource("Tasks.md"),
      [
        "- [ ] #task Blocked one ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }

  {
    const editor = createTextEditor(
      [
        "- ![[#^blocked]]",
        "- [?] #task Blocked two [scheduled:: 2026-08-20] ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
      ].join("\n"),
    );
    const harness = createInMemoryObsidianApp({ "Daily.md": editor.getValue() });
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = harness.app;
    plugin.getScheduleLogDateString = () => "2026-08-17";

    const wrote = await plugin.cycleResolvedTranscludedTaskLink(
      getEmbeddedTarget("![[#^blocked]]"),
      { activePath: "Daily.md", originPath: "Daily.md", editor },
      1,
    );
    assert.equal(wrote, true);
    assert.equal(
      editor.getValue(),
      [
        "- ![[#^blocked]]",
        "- [ ] #task Blocked two ^blocked",
        "\t- 🗓️ **SCHEDULE LOG**",
        "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
      ].join("\n"),
    );
  }
});

test("pressing again after Blocked retirement performs an ordinary transition with no further changes", () => {
  const editor = createTextEditor(
    [
      "- [ ] #task Ship it ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    ].join("\n"),
    { line: 0, ch: 4 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { commands: { commands: {}, executeCommandById: () => false } };
  plugin.getScheduleLogDateString = () => "2026-08-17";
  const view = Object.assign(new MarkdownView(), { editor, file: { path: "Tasks.md" } });

  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  assert.equal(
    editor.getValue(),
    [
      "- [/] #task Ship it ^ship",
      "\t- 🗓️ **SCHEDULE LOG**",
      "\t\t- *2026-08-20 → 2026-08-17* — 🔓 unblocked by hand",
    ].join("\n"),
  );
});

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

test("eligible Tasks demotions prompt in project and non-project notes", () => {
  const created = "2026-08-20";
  const cases = [
    {
      name: "project zero extras",
      lines: projectNoteLines(),
      line: 5,
    },
    {
      name: "non-project zero extras",
      lines: noteLines(),
      line: 2,
    },
    {
      name: "one other section",
      lines: noteLines({ extraLines: ["", "## Notes"] }),
      line: 2,
    },
    {
      name: "many other sections",
      lines: noteLines({
        extraLines: ["", "## Notes", "", "## Future Work", "", "### Deep"],
      }),
      line: 2,
    },
  ];

  for (const testCase of cases) {
    const plan = helpers.getObsidianTaskToggleDocumentPlan(
      testCase.lines,
      testCase.line,
      0,
      created,
    );
    assert.equal(plan.mode, "prompt", testCase.name);
    assert.equal(plan.nextLines, undefined, testCase.name);
    assert.equal(
      helpers.isEligibleTasksSectionDemotion(
        testCase.lines,
        testCase.line,
        testCase.lines[testCase.line],
      ),
      true,
      testCase.name,
    );
  }
});

test("selectable headings skip YAML, fences, empty titles, and Tasks", () => {
  const lines = [
    "---",
    "## Frontmatter",
    "type: [[project]]",
    "---",
    "# Overview",
    "## Tasks",
    "",
    "- [ ] #task Ship it",
    "##",
    "```md",
    "## Fenced",
    "```",
    "### Details",
    "#### Deep",
  ];
  const headings = helpers.collectSelectableDemotionHeadings(lines);
  assert.deepEqual(
    headings.map((heading) => [heading.depth, heading.title, heading.line]),
    [
      [1, "Overview", 4],
      [3, "Details", 12],
      [4, "Deep", 13],
    ],
  );
  const prompt = helpers.getObsidianTaskToggleDocumentPlan(lines, 7, 0, "2026-08-20");
  assert.equal(prompt.mode, "prompt");
  assert.deepEqual(prompt.headings, headings);
});

test("duplicate heading identities stay distinct and route to the chosen occurrence", () => {
  const lines = [
    "## Notes",
    "",
    "- already top",
    "## Tasks",
    "",
    "- [ ] #task Ship it",
    "\t- child",
    "## Notes",
    "",
    "- already bottom",
  ];
  const prompt = helpers.getObsidianTaskToggleDocumentPlan(lines, 5, 4, "2026-08-20");
  assert.equal(prompt.mode, "prompt");
  const first = findHeading(lines, "Notes", 0);
  const second = findHeading(lines, "Notes", 1);
  assert.ok(first);
  assert.ok(second);
  assert.equal(helpers.headingIdentitiesEqual(first, second), false);

  const toFirst = helpers.resolveObsidianTaskDemotionDestination(prompt, {
    kind: "existing",
    heading: first,
  });
  assert.equal(toFirst.mode, "move");
  assert.deepEqual(toFirst.nextLines, [
    "## Notes",
    "",
    "- already top",
    "- Ship it",
    "\t- child",
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already bottom",
  ]);
  assert.equal(toFirst.cursorLine, 3);
  assert.equal(toFirst.nextLines[toFirst.cursorLine], "- Ship it");

  const toSecond = helpers.resolveObsidianTaskDemotionDestination(prompt, {
    kind: "existing",
    heading: second,
  });
  assert.deepEqual(toSecond.nextLines, [
    "## Notes",
    "",
    "- already top",
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already bottom",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(toSecond.cursorLine, 8);
});

test("demotion picker defaults and typed names resolve without synthetic duplicates", () => {
  const none = noteLines();
  const nonePrompt = helpers.getObsidianTaskToggleDocumentPlan(none, 2, 0, "2026-08-20");
  const blankState = helpers.createDemotionSectionPickerState(nonePrompt.headings);
  const blankModel = helpers.getDemotionSectionPickerModel(blankState);
  assert.equal(blankModel.rows.length, 1);
  assert.equal(blankModel.primary.kind, "create");
  assert.equal(blankModel.primary.title, "Requirements");
  assert.equal(blankModel.selectedIndex, 0);
  assert.equal(blankModel.selectedRow.title, "Requirements");
  assert.equal(blankModel.inputPlaceholder, "Requirements");
  const created = helpers.resolveObsidianTaskDemotionDestination(
    nonePrompt,
    helpers.getDemotionDestinationFromSelectedRow(blankModel),
  );
  assert.deepEqual(created.nextLines, [
    "## Tasks",
    "",
    "## Requirements",
    "",
    "- Ship it",
  ]);
  assert.equal(created.nextLines[created.cursorLine], "- Ship it");

  const whitespaceModel = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(blankState, "   "),
  );
  assert.equal(whitespaceModel.rows.length, 1);
  assert.equal(whitespaceModel.primary.kind, "create");
  assert.equal(whitespaceModel.primary.title, "Requirements");

  const oneOther = noteLines({ extraLines: ["", "## Notes", "", "- already"] });
  const oneOtherPrompt = helpers.getObsidianTaskToggleDocumentPlan(
    oneOther,
    2,
    0,
    "2026-08-20",
  );
  const oneOtherModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(oneOtherPrompt.headings),
  );
  assert.equal(oneOtherModel.primary, null);
  assert.equal(oneOtherModel.rows.length, 1);
  assert.equal(oneOtherModel.rows[0].type, "existing");
  assert.equal(oneOtherModel.rows[0].title, "Notes");
  assert.equal(oneOtherModel.inputPlaceholder, "Filter or type a new section");
  assert.equal(oneOtherModel.statusText, "Move to existing Notes");
  const movedToOnlyOther = helpers.resolveObsidianTaskDemotionDestination(
    oneOtherPrompt,
    helpers.getDemotionDestinationFromSelectedRow(oneOtherModel),
  );
  assert.deepEqual(movedToOnlyOther.nextLines.slice(-3), [
    "",
    "- already",
    "- Ship it",
  ]);
  assert.equal(movedToOnlyOther.nextLines.at(-1), "- Ship it");

  const existing = noteLines({
    extraLines: ["", "##   requirements  ##", "", "- already"],
  });
  const existingPrompt = helpers.getObsidianTaskToggleDocumentPlan(
    existing,
    2,
    0,
    "2026-08-20",
  );
  const existingModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(existingPrompt.headings),
  );
  assert.equal(existingModel.primary, null);
  assert.equal(existingModel.rows.length, 1);
  assert.equal(existingModel.rows[0].title, "requirements");
  const reused = helpers.resolveObsidianTaskDemotionDestination(
    existingPrompt,
    helpers.getDemotionDestinationFromSelectedRow(existingModel),
  );
  assert.equal(
    reused.nextLines.filter((line) => /^##\s+requirements\s+##$/i.test(line) || line === "## Requirements").length,
    1,
  );
  assert.deepEqual(reused.nextLines.slice(-2), ["- already", "- Ship it"]);

  const requirementsAndOther = noteLines({
    extraLines: ["", "## Requirements", "", "### Notes", "", "# Later"],
  });
  const mixedModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(
      helpers.getObsidianTaskToggleDocumentPlan(
        requirementsAndOther,
        2,
        0,
        "2026-08-20",
      ).headings,
    ),
  );
  assert.deepEqual(
    mixedModel.rows.map((row) => row.title),
    ["Requirements", "Notes", "Later"],
  );

  const typedCreate = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(blankState, "  Future Work  "),
  );
  assert.equal(typedCreate.primary.kind, "create");
  assert.equal(typedCreate.primary.title, "Future Work");
  const createdNamed = helpers.resolveObsidianTaskDemotionDestination(
    nonePrompt,
    helpers.getDemotionDestinationFromSelectedRow(typedCreate),
  );
  assert.deepEqual(createdNamed.nextLines.slice(-3), [
    "## Future Work",
    "",
    "- Ship it",
  ]);

  const typedCreateWithFuzzy = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(
      helpers.createDemotionSectionPickerState(oneOtherPrompt.headings),
      "Nte",
    ),
  );
  assert.equal(typedCreateWithFuzzy.primary.kind, "create");
  assert.equal(typedCreateWithFuzzy.primary.title, "Nte");
  assert.deepEqual(
    typedCreateWithFuzzy.rows.map((row) => [row.type, row.title]),
    [
      ["primary", "Nte"],
      ["existing", "Notes"],
    ],
  );

  const reuseTyped = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(
      helpers.createDemotionSectionPickerState(existingPrompt.headings),
      "REQUIREMENTS",
    ),
  );
  assert.equal(reuseTyped.primary, null);
  assert.deepEqual(
    reuseTyped.rows.map((row) => row.title),
    ["requirements"],
  );

  const duplicateRequirements = noteLines({
    extraLines: [
      "",
      "## Requirements",
      "",
      "## Readable Requirements",
      "",
      "### Requirements",
    ],
  });
  const duplicateTyped = helpers.getDemotionSectionPickerModel(
    helpers.setDemotionPickerQuery(
      helpers.createDemotionSectionPickerState(
        helpers.getObsidianTaskToggleDocumentPlan(
          duplicateRequirements,
          2,
          0,
          "2026-08-20",
        ).headings,
      ),
      " requirements ",
    ),
  );
  assert.equal(duplicateTyped.primary, null);
  assert.deepEqual(
    duplicateTyped.rows.map((row) => [row.title, row.heading.line]),
    [
      ["Requirements", 4],
      ["Requirements", 8],
      ["Readable Requirements", 6],
    ],
  );

  assert.equal(helpers.getDemotionPrimaryAction("", oneOtherPrompt.headings), null);
  assert.equal(
    helpers.getDemotionPrimaryAction("REQUIREMENTS", existingPrompt.headings),
    null,
  );
  const rejected = helpers.getDemotionPrimaryAction("Tasks", nonePrompt.headings);
  assert.equal(rejected.kind, "invalid");
  assert.match(rejected.statusText, /Tasks is not a valid destination/);
  assert.equal(
    helpers.resolveObsidianTaskDemotionDestination(nonePrompt, {
      kind: "create",
      title: "Tasks",
    }),
    null,
  );

  const fuzzy = helpers.filterSelectableDemotionHeadings(
    existingPrompt.headings,
    "req",
  );
  assert.equal(fuzzy.length, 1);
  assert.equal(fuzzy[0].title, "requirements");
});

test("picker keyboard state wraps, clamps, and refuses invalid Enter", () => {
  const headings = [
    { line: 0, depth: 2, title: "Notes" },
    { line: 8, depth: 3, title: "Details" },
  ];
  let state = helpers.createDemotionSectionPickerState(headings);
  let model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 0);
  assert.equal(model.rows.length, 2);
  assert.equal(model.canSubmit, true);
  assert.deepEqual(
    helpers.getDemotionSectionPickerRowClasses(model.rows[0], true),
    ["tsc-sdp-row", "is-selected", "is-existing"],
  );
  assert.equal(model.selectedRow.heading.title, "Notes");

  state = helpers.moveDemotionPickerSelection(state, 1);
  model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 1);
  assert.equal(model.selectedRow.heading.title, "Details");
  assert.equal(
    helpers.getDemotionDestinationFromSelectedRow(model).heading.line,
    8,
  );

  state = helpers.moveDemotionPickerSelection(state, -1);
  assert.equal(helpers.getDemotionSectionPickerModel(state).selectedIndex, 0);
  state = helpers.moveDemotionPickerSelection(state, -1);
  model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 1);
  assert.equal(model.selectedRow.heading.title, "Details");

  state = helpers.setDemotionPickerQuery(state, "Tasks");
  model = helpers.getDemotionSectionPickerModel(state);
  assert.equal(model.selectedIndex, 0);
  assert.equal(model.primary.kind, "invalid");
  assert.equal(model.canSubmit, false);
  assert.equal(helpers.getDemotionDestinationFromSelectedRow(model), null);
});

test("new-section formatting keeps extra blanks, final newlines, and nested children", () => {
  const nested = noteLines({
    taskLines: ["- [ ] #task Parent", "\t- child", "\t\t- grand"],
  });
  const nestedMove = resolvePrompt(nested, 2, {
    kind: "create",
    title: "Requirements",
  }, 4);
  assert.deepEqual(nestedMove.nextLines, [
    "## Tasks",
    "",
    "## Requirements",
    "",
    "- Parent",
    "\t- child",
    "\t\t- grand",
  ]);
  assert.equal(nestedMove.cursorLine, 4);
  assert.equal(nestedMove.cursorCh, 2);

  const withFinalNewline = noteLines({ extraLines: [""] });
  const finalNewlineMove = resolvePrompt(withFinalNewline, 2, {
    kind: "create",
    title: "Requirements",
  });
  assert.equal(finalNewlineMove.nextLines.at(-1), "");
  assert.equal(finalNewlineMove.nextLines.at(-2), "- Ship it");

  const extraTrailing = noteLines({ extraLines: ["", "", ""] });
  const trailingMove = resolvePrompt(extraTrailing, 2, {
    kind: "create",
    title: "Requirements",
  });
  assert.deepEqual(trailingMove.nextLines, [
    "## Tasks",
    "",
    "## Requirements",
    "",
    "- Ship it",
    "",
  ]);

  const emptySection = noteLines({ extraLines: ["", "## Notes"] });
  const intoEmpty = resolvePrompt(emptySection, 2, {
    kind: "existing",
    heading: findHeading(emptySection, "Notes"),
  });
  assert.deepEqual(intoEmpty.nextLines.slice(-3), [
    "## Notes",
    "",
    "- Ship it",
  ]);

  const withBullet = noteLines({
    extraLines: ["", "## Notes", "", "- already", "\t- keep"],
  });
  const intoBullet = resolvePrompt(withBullet, 2, {
    kind: "existing",
    heading: findHeading(withBullet, "Notes"),
  });
  assert.deepEqual(intoBullet.nextLines.slice(-3), [
    "- already",
    "\t- keep",
    "- Ship it",
  ]);
});

test("existing-section insertion works before and after the source on CRLF-backed editors", () => {
  const lines = [
    "## Notes",
    "",
    "- already",
    "## Tasks",
    "",
    "- [ ] #task Ship it",
    "  continued",
    "## Later",
  ];
  const after = resolvePrompt(lines, 5, {
    kind: "existing",
    heading: findHeading(lines, "Later"),
  }, 8);
  assert.deepEqual(after.nextLines.slice(-4), [
    "## Later",
    "",
    "- Ship it",
    "  continued",
  ]);
  assert.equal(after.nextLines[after.cursorLine], "- Ship it");
  assert.equal(after.cursorCh, 2);

  const source = lines.join("\r\n");
  const { editor, view, plugin } = openDemotionPicker(source, { line: 5, ch: 0 });
  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(
    acceptPickerDestination(plugin, {
      kind: "create",
      title: "Requirements",
    }),
    true,
  );
  assert.match(editor.getValue(), /## Requirements/);
  assert.match(editor.getValue(), /- Ship it\r?\n  continued/);
});

test("command opens one picker, writes only on accept, and restores cursor plus center", () => {
  const source = noteLines({
    taskLines: ["- [ ] #task Ship it", "\t- child"],
  }).join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 2,
    ch: 8,
  });

  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.ok(!plugin.demotionSectionPicker);

  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  const picker = plugin.demotionSectionPicker;
  assert.ok(picker);
  assert.equal(picker.inputEl.focused, true);
  assert.equal(picker.inputEl.getAttribute("aria-label"), "Section name or filter");
  assert.equal(picker.inputEl.getAttribute("placeholder"), "Requirements");
  assert.equal(picker.statusEl.textContent, "Create ## Requirements");
  assert.equal(picker.resultsEl.getAttribute("role"), "listbox");
  assert.ok(picker.rowEls[0].classes.includes("tsc-sdp-row"));
  assert.ok(picker.rowEls[0].classes.includes("is-selected"));
  assert.equal(picker.rowEls[0].getAttribute("role"), "option");

  const firstPicker = picker;
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(plugin.demotionSectionPicker, firstPicker);

  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "## Requirements",
      "",
      "- Ship it",
      "\t- child",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 4, ch: 2 });
  assert.deepEqual(centered, [{ line: 4, ch: 2, sameEditor: true }]);
  assert.equal(plugin.demotionSectionPicker, null);
});

test("pointer activation, Escape, and double-submit protection leave a consistent note", () => {
  const source = noteLines({ extraLines: ["", "## Notes"] }).join("\n");
  const { editor, view, plugin } = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  const picker = plugin.demotionSectionPicker;
  assert.equal(picker.inputEl.getAttribute("placeholder"), "Filter or type a new section");
  assert.equal(picker.statusEl.textContent, "Move to existing Notes");
  assert.equal(picker.rowEls.length, 1);
  picker.rowEls[0].dispatchEvent("mousedown", { preventDefault() {} });
  picker.rowEls[0].dispatchEvent("click");
  assert.match(editor.getValue(), /## Notes\n\n- Ship it/);
  assert.equal(plugin.demotionSectionPicker, null);
  assert.equal(picker.acceptSelected(), false);

  const cancelled = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(
    cancelled.plugin.handleToggleObsidianTaskCommand(
      false,
      cancelled.editor,
      cancelled.view,
    ),
    true,
  );
  cancelled.plugin.demotionSectionPicker.close();
  assert.equal(cancelled.editor.getValue(), source);
  assert.equal(cancelled.plugin.demotionSectionPicker, null);
});

test("stale document, changed editor, or missing heading notice without writing", () => {
  notices.length = 0;
  const source = noteLines({ extraLines: ["", "## Notes"] }).join("\n");
  const { editor, view, plugin } = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  editor.replaceRange("x", { line: 0, ch: 0 });
  const changedValue = editor.getValue();
  assert.equal(acceptSelectedPickerRow(plugin), false);
  assert.equal(editor.getValue(), changedValue);
  assert.match(notices.at(-1), /note changed/i);
  assert.equal(plugin.demotionSectionPicker, null);

  notices.length = 0;
  const swapped = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(
    swapped.plugin.handleToggleObsidianTaskCommand(
      false,
      swapped.editor,
      swapped.view,
    ),
    true,
  );
  const otherEditor = createTextEditor(source, { line: 2, ch: 0 });
  swapped.view.editor = otherEditor;
  assert.equal(acceptSelectedPickerRow(swapped.plugin), false);
  assert.equal(swapped.editor.getValue(), source);
  assert.match(notices.at(-1), /note changed/i);

  notices.length = 0;
  const missing = openDemotionPicker(source, { line: 2, ch: 0 });
  assert.equal(
    missing.plugin.handleToggleObsidianTaskCommand(
      false,
      missing.editor,
      missing.view,
    ),
    true,
  );
  assert.equal(
    acceptPickerDestination(missing.plugin, {
      kind: "existing",
      heading: { line: 99, depth: 2, title: "Ghost" },
    }),
    false,
  );
  assert.equal(missing.editor.getValue(), source);
  assert.match(notices.at(-1), /no longer available/i);
});

test("promotion prompts default to Tasks in ordinary and project notes", () => {
  const ordinary = ["## Ideas", "", "- Ship it", "\t- child", "", "## Tasks", "", "## Notes"];
  const project = [
    "---",
    "type: [[project]]",
    "---",
    "## Ideas",
    "",
    "- Ship it",
    "",
    "## Tasks",
  ];

  for (const [lines, activeLine] of [[ordinary, 2], [project, 5]]) {
    const prompt = getSectionPrompt(lines, activeLine, 2);
    assert.equal(prompt.promptKind, "promotion");
    assert.deepEqual(
      prompt.headings.map((heading) => heading.title),
      lines === ordinary ? ["Tasks", "Notes"] : ["Tasks"],
    );
    assert.equal(prompt.previewText, "- Ship it");

    const state = helpers.createDemotionSectionPickerState(
      prompt.headings,
      "",
      prompt.promptKind,
    );
    const model = helpers.getDemotionSectionPickerModel(state);
    assert.equal(model.selectedIndex, 0);
    assert.equal(model.selectedRow.title, "Tasks");
    assert.equal(model.inputPlaceholder, "Filter or type a new section");
    assert.equal(model.statusText, "Move to existing Tasks");
  }

  const moved = resolveSectionPrompt(ordinary, 2, {
    kind: "existing",
    heading: findPromptHeading(getSectionPrompt(ordinary, 2), "Tasks"),
  }, 2);
  assert.deepEqual(moved.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
    "## Notes",
  ]);
  assert.equal(
    moved.nextLines.join("\n").match(/#task/g).length,
    1,
  );
  assert.equal(moved.cursorLine, 2);
  assert.equal(moved.cursorCh, 12);
});

test("promotion routes plain bullets to existing, typed, and duplicate non-Tasks sections", () => {
  const lines = [
    "## Notes",
    "",
    "- already top",
    "## Ideas",
    "",
    "- Ship it",
    "\t- child",
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already bottom",
  ];
  const prompt = getSectionPrompt(lines, 5, 2);
  assert.deepEqual(
    prompt.headings.map((heading) => [heading.title, heading.line]),
    [
      ["Tasks", 7],
      ["Notes", 0],
      ["Notes", 9],
    ],
  );

  const firstNotes = helpers.resolveObsidianTaskPromptDestination(prompt, {
    kind: "existing",
    heading: findPromptHeading(prompt, "Notes", 0),
  });
  assert.deepEqual(firstNotes.nextLines, [
    "## Notes",
    "",
    "- already top",
    "- Ship it",
    "\t- child",
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already bottom",
  ]);
  assert.equal(firstNotes.nextLines.join("\n").includes("#task"), false);
  assert.equal(firstNotes.cursorLine, 3);
  assert.equal(firstNotes.cursorCh, 2);

  const secondNotes = helpers.resolveObsidianTaskPromptDestination(prompt, {
    kind: "existing",
    heading: findPromptHeading(prompt, "Notes", 1),
  });
  assert.deepEqual(secondNotes.nextLines.slice(-4), [
    "",
    "- already bottom",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(secondNotes.cursorLine, 8);

  const typedReuseState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(prompt.headings, "", prompt.promptKind),
    " notes ",
  );
  const typedReuseModel = helpers.getDemotionSectionPickerModel(typedReuseState);
  assert.deepEqual(
    typedReuseModel.rows.map((row) => [row.title, row.heading && row.heading.line]),
    [
      ["Notes", 0],
      ["Notes", 9],
    ],
  );

  const createNewState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(prompt.headings, "", prompt.promptKind),
    "Future Work",
  );
  const createNewModel = helpers.getDemotionSectionPickerModel(createNewState);
  assert.equal(createNewModel.primary.kind, "create");
  assert.equal(createNewModel.primary.title, "Future Work");
  const created = helpers.resolveObsidianTaskPromptDestination(
    prompt,
    helpers.getDemotionDestinationFromSelectedRow(createNewModel),
  );
  assert.deepEqual(created.nextLines.slice(-4), [
    "## Future Work",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(created.nextLines.join("\n").includes("#task"), false);
});

test("promotion command writes only on accept and Enter selects Tasks", () => {
  const source = ["## Ideas", "", "- Ship it", "\t- child", "", "## Tasks"].join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 2,
    ch: 2,
  });
  plugin.getCreatedDateString = () => "2026-08-20";

  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.ok(!plugin.demotionSectionPicker);

  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  const picker = plugin.demotionSectionPicker;
  assert.ok(picker);
  assert.equal(picker.statusEl.textContent, "Move to existing Tasks");
  assert.equal(picker.rowEls.length, 1);

  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "- [ ] #task Ship it [created::2026-08-20]",
      "\t- child",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 12 });
  assert.deepEqual(centered, [{ line: 2, ch: 12, sameEditor: true }]);
});

test("promotion removes only genuinely empty source sections", () => {
  const removedBeforeDestination = resolveSectionPrompt(
    ["## Ideas", "", "- Ship it", "", "## Tasks"],
    2,
    { kind: "existing", heading: { line: 4, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(removedBeforeDestination.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const removedAfterDestination = resolveSectionPrompt(
    ["## Tasks", "", "## Ideas", "", "- Ship it"],
    4,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(removedAfterDestination.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const finalNewline = resolveSectionPrompt(
    ["## Tasks", "", "## Ideas", "", "- Ship it", ""],
    4,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(finalNewline.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "",
  ]);

  const retainedCases = [
    {
      name: "another bullet",
      lines: ["## Ideas", "", "- Ship it", "- Keep", "", "## Tasks"],
      expected: "- Keep",
    },
    {
      name: "prose",
      lines: ["## Ideas", "", "- Ship it", "Keep this paragraph.", "", "## Tasks"],
      expected: "Keep this paragraph.",
    },
    {
      name: "fence",
      lines: ["## Ideas", "", "- Ship it", "```md", "example", "```", "## Tasks"],
      expected: "```md",
    },
    {
      name: "child heading",
      lines: ["## Ideas", "", "- Ship it", "", "### Details", "", "## Tasks"],
      expected: "### Details",
    },
  ];

  for (const retained of retainedCases) {
    const prompt = getSectionPrompt(retained.lines, 2);
    const moved = helpers.resolveObsidianTaskPromptDestination(prompt, {
      kind: "existing",
      heading: findPromptHeading(prompt, "Tasks"),
    });
    assert.ok(moved.nextLines.includes("## Ideas"), retained.name);
    assert.ok(moved.nextLines.includes(retained.expected), retained.name);
  }

  const preamble = getSectionPrompt(["- Ship it", "## Tasks", "", "## Notes"], 0);
  const preambleMoved = helpers.resolveObsidianTaskPromptDestination(preamble, {
    kind: "existing",
    heading: findPromptHeading(preamble, "Tasks"),
  });
  assert.deepEqual(preambleMoved.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "## Notes",
  ]);
});

test("promotions, out-of-Tasks demotions, and ineligible shapes keep prior routing", () => {
  const created = "2026-08-20";

  const promoteLines = [
    "---",
    "type: [[project]]",
    "---",
    "- Ship it",
    "",
    "## Tasks",
  ];
  const promotePlan = helpers.getObsidianTaskToggleDocumentPlan(
    promoteLines,
    3,
    0,
    created,
  );
  assert.equal(promotePlan.mode, "prompt");
  assert.equal(promotePlan.promptKind, "promotion");
  assert.equal(promotePlan.nextLines, undefined);
  const promoteMoved = helpers.resolveObsidianTaskPromptDestination(promotePlan, {
    kind: "existing",
    heading: findPromptHeading(promotePlan, "Tasks"),
  });
  assert.equal(promoteMoved.mode, "move");
  assert.equal(promoteMoved.targetSection, "tasks");
  assert.equal(promoteMoved.nextLines.includes("## Requirements"), false);
  assert.match(
    promoteMoved.nextLines.join("\n"),
    /## Tasks\n\n- \[ \] #task Ship it \[created::2026-08-20\]/,
  );

  const noTasks = ["## Ideas", "", "- Ship it"];
  const noTasksPlan = helpers.getObsidianTaskToggleDocumentPlan(
    noTasks,
    2,
    0,
    created,
  );
  assert.equal(noTasksPlan.mode, "replace");
  assert.equal(noTasksPlan.line, 2);

  const outside = [
    "## Notes",
    "",
    "- [ ] #task Ship it",
    "## Later",
  ];
  const outsidePlan = helpers.getObsidianTaskToggleDocumentPlan(
    outside,
    2,
    0,
    created,
  );
  assert.equal(outsidePlan.mode, "move");
  assert.equal(outsidePlan.targetSection, "nextSection");
  assert.deepEqual(outsidePlan.nextLines, [
    "## Notes",
    "",
    "## Later",
    "",
    "- Ship it",
  ]);

  const wrongSection = [
    "## Notes",
    "",
    "- [ ] #task Ship it",
  ];
  const wrongPlan = helpers.getObsidianTaskToggleDocumentPlan(
    wrongSection,
    2,
    0,
    created,
  );
  assert.equal(wrongPlan.mode, "replace");

  const indented = noteLines({
    taskLines: ["- parent", "\t- [ ] #task child"],
  });
  const indentedPlan = helpers.getObsidianTaskToggleDocumentPlan(
    indented,
    3,
    0,
    created,
  );
  assert.equal(indentedPlan.mode, "replace");
  assert.equal(indentedPlan.line, 3);

  const star = noteLines({ taskLine: "* [ ] #task Ship it" });
  const starPlan = helpers.getObsidianTaskToggleDocumentPlan(star, 2, 0, created);
  assert.equal(starPlan.mode, "replace");

  const starPromote = ["* Ship it", "## Tasks"];
  const starPromotePlan = helpers.getObsidianTaskToggleDocumentPlan(
    starPromote,
    0,
    0,
    created,
  );
  assert.equal(starPromotePlan.mode, "replace");

  const indentedPromote = ["## Tasks", "", "- parent", "\t- child"];
  const indentedPromotePlan = helpers.getObsidianTaskToggleDocumentPlan(
    indentedPromote,
    3,
    0,
    created,
  );
  assert.equal(indentedPromotePlan.mode, "replace");
  assert.equal(indentedPromotePlan.line, 3);
});

test("Tasks-only preamble promotions prompt and blank Enter moves into Tasks", () => {
  const lines = ["- Ship it", "\t- child", "## Tasks"];
  const prompt = getSectionPrompt(lines, 0, 2);
  assert.equal(prompt.promptKind, "promotion");
  assert.deepEqual(
    prompt.headings.map((heading) => heading.title),
    ["Tasks"],
  );
  assert.equal(prompt.previewText, "- Ship it");

  const blankState = helpers.createDemotionSectionPickerState(
    prompt.headings,
    "",
    prompt.promptKind,
  );
  const blankModel = helpers.getDemotionSectionPickerModel(blankState);
  assert.equal(blankModel.selectedRow.title, "Tasks");
  assert.equal(blankModel.statusText, "Move to existing Tasks");
  assert.equal(blankModel.inputPlaceholder, "Filter or type a new section");

  const moved = helpers.resolveObsidianTaskPromptDestination(
    prompt,
    helpers.getDemotionDestinationFromSelectedRow(blankModel),
  );
  assert.deepEqual(moved.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
  ]);
  assert.equal(moved.nextLines.join("\n").match(/#task/g).length, 1);
  assert.equal(moved.cursorLine, 2);
  assert.equal(moved.cursorCh, 12);
  assert.equal(moved.targetSection, "tasks");

  const source = lines.join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 0,
    ch: 2,
  });
  plugin.getCreatedDateString = () => "2026-08-20";
  assert.equal(plugin.handleToggleObsidianTaskCommand(true, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "- [ ] #task Ship it [created::2026-08-20]",
      "\t- child",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 2, ch: 12 });
  assert.deepEqual(centered, [{ line: 2, ch: 12, sameEditor: true }]);
});

test("plain bullets already in Tasks prompt and blank Enter promotes in place", () => {
  const lines = [
    "## Tasks",
    "",
    "- Keep first",
    "- Ship it",
    "\t- child",
    "  continued",
    "- Keep last",
    "",
    "## Notes",
  ];
  const prompt = getSectionPrompt(lines, 3, 2);
  assert.equal(prompt.promptKind, "promotion");
  assert.deepEqual(
    prompt.headings.map((heading) => [heading.title, heading.line]),
    [
      ["Tasks", 0],
      ["Notes", 8],
    ],
  );
  assert.equal(prompt.sourceHeading.title, "Tasks");

  const blankModel = helpers.getDemotionSectionPickerModel(
    helpers.createDemotionSectionPickerState(
      prompt.headings,
      "",
      prompt.promptKind,
    ),
  );
  assert.equal(blankModel.selectedRow.title, "Tasks");
  assert.equal(blankModel.selectedRow.heading.line, 0);

  const inPlace = helpers.resolveObsidianTaskPromptDestination(
    prompt,
    helpers.getDemotionDestinationFromSelectedRow(blankModel),
  );
  assert.deepEqual(inPlace.nextLines, [
    "## Tasks",
    "",
    "- Keep first",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
    "  continued",
    "- Keep last",
    "",
    "## Notes",
  ]);
  assert.equal(inPlace.nextLines.join("\n").match(/#task/g).length, 1);
  assert.equal(inPlace.cursorLine, 3);
  assert.equal(inPlace.cursorCh, 12);
  assert.equal(inPlace.targetSection, "tasks");

  const tasksOnly = ["## Tasks", "", "- Keep first", "- Ship it", "- Keep last"];
  const tasksOnlyPrompt = getSectionPrompt(tasksOnly, 3, 2);
  assert.deepEqual(
    tasksOnlyPrompt.headings.map((heading) => heading.title),
    ["Tasks"],
  );
  const tasksOnlyInPlace = helpers.resolveObsidianTaskPromptDestination(
    tasksOnlyPrompt,
    { kind: "existing", heading: findPromptHeading(tasksOnlyPrompt, "Tasks") },
  );
  assert.deepEqual(tasksOnlyInPlace.nextLines, [
    "## Tasks",
    "",
    "- Keep first",
    "- [ ] #task Ship it [created::2026-08-20]",
    "- Keep last",
  ]);

  const source = lines.join("\n");
  const { editor, view, plugin, centered } = openDemotionPicker(source, {
    line: 3,
    ch: 2,
  });
  plugin.getCreatedDateString = () => "2026-08-20";
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), source);
  assert.equal(acceptSelectedPickerRow(plugin), true);
  assert.equal(
    editor.getValue(),
    [
      "## Tasks",
      "",
      "- Keep first",
      "- [ ] #task Ship it [created::2026-08-20]",
      "\t- child",
      "  continued",
      "- Keep last",
      "",
      "## Notes",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 3, ch: 12 });
  assert.deepEqual(centered, [{ line: 3, ch: 12, sameEditor: true }]);
});

test("promotion from Tasks-only or Tasks body can choose existing or typed non-Tasks sections", () => {
  const preamble = ["- Ship it", "\t- child", "## Tasks", "", "## Notes", "", "- already"];
  const preamblePrompt = getSectionPrompt(preamble, 0, 2);
  assert.deepEqual(
    preamblePrompt.headings.map((heading) => heading.title),
    ["Tasks", "Notes"],
  );

  const toNotes = helpers.resolveObsidianTaskPromptDestination(preamblePrompt, {
    kind: "existing",
    heading: findPromptHeading(preamblePrompt, "Notes"),
  });
  assert.deepEqual(toNotes.nextLines, [
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(toNotes.nextLines.join("\n").includes("#task"), false);

  const createFromPreambleState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(
      preamblePrompt.headings,
      "",
      preamblePrompt.promptKind,
    ),
    "Future Work",
  );
  const createFromPreambleModel = helpers.getDemotionSectionPickerModel(
    createFromPreambleState,
  );
  assert.equal(createFromPreambleModel.primary.kind, "create");
  assert.equal(createFromPreambleModel.selectedRow.title, "Future Work");
  const createdFromPreamble = helpers.resolveObsidianTaskPromptDestination(
    preamblePrompt,
    helpers.getDemotionDestinationFromSelectedRow(createFromPreambleModel),
  );
  assert.deepEqual(createdFromPreamble.nextLines, [
    "## Tasks",
    "",
    "## Notes",
    "",
    "- already",
    "",
    "## Future Work",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(createdFromPreamble.nextLines.join("\n").includes("#task"), false);
  assert.equal(
    createdFromPreamble.nextLines.filter((line) => line === "## Future Work").length,
    1,
  );

  const tasksOnly = ["- Ship it", "\t- child", "## Tasks"];
  const tasksOnlyPrompt = getSectionPrompt(tasksOnly, 0);
  const createdFromTasksOnly = helpers.resolveObsidianTaskPromptDestination(
    tasksOnlyPrompt,
    { kind: "create", title: "Inbox" },
  );
  assert.deepEqual(createdFromTasksOnly.nextLines, [
    "## Tasks",
    "",
    "## Inbox",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(createdFromTasksOnly.nextLines.join("\n").includes("#task"), false);

  const insideTasks = [
    "## Tasks",
    "",
    "- Keep",
    "- Ship it",
    "\t- child",
    "## Notes",
    "",
    "- already",
  ];
  const insidePrompt = getSectionPrompt(insideTasks, 3, 2);
  assert.deepEqual(
    insidePrompt.headings.map((heading) => heading.title),
    ["Tasks", "Notes"],
  );

  const insideToNotes = helpers.resolveObsidianTaskPromptDestination(insidePrompt, {
    kind: "existing",
    heading: findPromptHeading(insidePrompt, "Notes"),
  });
  assert.deepEqual(insideToNotes.nextLines, [
    "## Tasks",
    "",
    "- Keep",
    "## Notes",
    "",
    "- already",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(insideToNotes.nextLines.join("\n").includes("#task"), false);
  assert.ok(insideToNotes.nextLines.includes("## Tasks"));

  const createdFromInside = helpers.resolveObsidianTaskPromptDestination(
    insidePrompt,
    { kind: "create", title: "Future Work" },
  );
  assert.deepEqual(createdFromInside.nextLines, [
    "## Tasks",
    "",
    "- Keep",
    "## Notes",
    "",
    "- already",
    "",
    "## Future Work",
    "",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(createdFromInside.nextLines.join("\n").includes("#task"), false);
  assert.ok(createdFromInside.nextLines.includes("## Tasks"));
});

test("always-prompt promotions keep reuse, duplicates, cleanup, CRLF, and cancellation", () => {
  const reuseLines = [
    "## Tasks",
    "",
    "- Ship it",
    "\t- child",
    "##   notes  ##",
    "",
    "- already",
  ];
  const reusePrompt = getSectionPrompt(reuseLines, 2);
  const reuseState = helpers.setDemotionPickerQuery(
    helpers.createDemotionSectionPickerState(
      reusePrompt.headings,
      "",
      reusePrompt.promptKind,
    ),
    " NOTES ",
  );
  const reuseModel = helpers.getDemotionSectionPickerModel(reuseState);
  assert.equal(reuseModel.primary, null);
  assert.equal(reuseModel.selectedRow.title, "notes");
  const reused = helpers.resolveObsidianTaskPromptDestination(
    reusePrompt,
    helpers.getDemotionDestinationFromSelectedRow(reuseModel),
  );
  assert.equal(
    reused.nextLines.filter(
      (line) => /^##\s+notes\s+##$/i.test(line) || line === "## Notes",
    ).length,
    1,
  );
  assert.deepEqual(reused.nextLines.slice(-3), [
    "- already",
    "- Ship it",
    "\t- child",
  ]);
  assert.equal(reused.nextLines.join("\n").includes("#task"), false);

  const duplicates = [
    "## Notes",
    "",
    "- already top",
    "## Tasks",
    "",
    "- Keep",
    "- Ship it",
    "\t- child",
    "## Notes",
    "",
    "- already bottom",
    "## Tasks",
    "",
    "- other tasks",
  ];
  const duplicatePrompt = getSectionPrompt(duplicates, 6);
  assert.deepEqual(
    duplicatePrompt.headings.map((heading) => [heading.title, heading.line]),
    [
      ["Tasks", 3],
      ["Tasks", 11],
      ["Notes", 0],
      ["Notes", 8],
    ],
  );
  const sameTasks = helpers.resolveObsidianTaskPromptDestination(duplicatePrompt, {
    kind: "existing",
    heading: findPromptHeading(duplicatePrompt, "Tasks", 0),
  });
  assert.equal(sameTasks.nextLines[5], "- Keep");
  assert.equal(
    sameTasks.nextLines[6],
    "- [ ] #task Ship it [created::2026-08-20]",
  );
  assert.equal(sameTasks.nextLines[7], "\t- child");
  assert.ok(sameTasks.nextLines.includes("- other tasks"));

  const otherTasks = helpers.resolveObsidianTaskPromptDestination(duplicatePrompt, {
    kind: "existing",
    heading: findPromptHeading(duplicatePrompt, "Tasks", 1),
  });
  assert.deepEqual(otherTasks.nextLines.slice(-5), [
    "## Tasks",
    "",
    "- other tasks",
    "- [ ] #task Ship it [created::2026-08-20]",
    "\t- child",
  ]);
  assert.ok(otherTasks.nextLines.includes("- Keep"));

  const sourceBefore = resolveSectionPrompt(
    ["## Ideas", "", "- Ship it", "", "## Tasks"],
    2,
    { kind: "existing", heading: { line: 4, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(sourceBefore.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const sourceAfter = resolveSectionPrompt(
    ["## Tasks", "", "## Ideas", "", "- Ship it"],
    4,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(sourceAfter.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const withFinalNewline = resolveSectionPrompt(
    ["## Tasks", "", "- Ship it", ""],
    2,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(withFinalNewline.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
    "",
  ]);

  const withoutFinalNewline = resolveSectionPrompt(
    ["## Tasks", "", "- Ship it"],
    2,
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  );
  assert.deepEqual(withoutFinalNewline.nextLines, [
    "## Tasks",
    "",
    "- [ ] #task Ship it [created::2026-08-20]",
  ]);

  const retained = resolveSectionPrompt(
    ["## Ideas", "", "- Ship it", "- Keep", "", "## Tasks"],
    2,
    { kind: "existing", heading: { line: 5, depth: 2, title: "Tasks" } },
  );
  assert.ok(retained.nextLines.includes("## Ideas"));
  assert.ok(retained.nextLines.includes("- Keep"));

  const crlfSource = [
    "## Tasks",
    "",
    "- Keep first",
    "- Ship it",
    "\t- child",
    "- Keep last",
  ].join("\r\n");
  const crlf = openDemotionPicker(crlfSource, { line: 3, ch: 2 });
  crlf.plugin.getCreatedDateString = () => "2026-08-20";
  assert.equal(
    crlf.plugin.handleToggleObsidianTaskCommand(false, crlf.editor, crlf.view),
    true,
  );
  assert.equal(crlf.editor.getValue(), crlfSource);
  assert.equal(acceptSelectedPickerRow(crlf.plugin), true);
  assert.match(
    crlf.editor.getValue(),
    /- Keep first\r?\n- \[ \] #task Ship it \[created::2026-08-20\]\r?\n\t- child\r?\n- Keep last/,
  );
  assert.deepEqual(crlf.editor.getCursor(), { line: 3, ch: 12 });

  notices.length = 0;
  const cancelledSource = ["- Ship it", "## Tasks"].join("\n");
  const cancelled = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    cancelled.plugin.handleToggleObsidianTaskCommand(
      false,
      cancelled.editor,
      cancelled.view,
    ),
    true,
  );
  cancelled.plugin.demotionSectionPicker.close();
  assert.equal(cancelled.editor.getValue(), cancelledSource);
  assert.equal(cancelled.plugin.demotionSectionPicker, null);

  const repeated = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    repeated.plugin.handleToggleObsidianTaskCommand(
      false,
      repeated.editor,
      repeated.view,
    ),
    true,
  );
  const firstPicker = repeated.plugin.demotionSectionPicker;
  assert.equal(
    repeated.plugin.handleToggleObsidianTaskCommand(
      false,
      repeated.editor,
      repeated.view,
    ),
    true,
  );
  assert.equal(repeated.plugin.demotionSectionPicker, firstPicker);
  assert.equal(repeated.editor.getValue(), cancelledSource);

  notices.length = 0;
  const stale = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    stale.plugin.handleToggleObsidianTaskCommand(false, stale.editor, stale.view),
    true,
  );
  stale.editor.replaceRange("x", { line: 0, ch: 0 });
  const changedValue = stale.editor.getValue();
  assert.equal(acceptSelectedPickerRow(stale.plugin), false);
  assert.equal(stale.editor.getValue(), changedValue);
  assert.match(notices.at(-1), /note changed/i);

  notices.length = 0;
  const missing = openDemotionPicker(cancelledSource, { line: 0, ch: 0 });
  assert.equal(
    missing.plugin.handleToggleObsidianTaskCommand(
      false,
      missing.editor,
      missing.view,
    ),
    true,
  );
  assert.equal(
    acceptPickerDestination(missing.plugin, {
      kind: "existing",
      heading: { line: 99, depth: 2, title: "Ghost" },
    }),
    false,
  );
  assert.equal(missing.editor.getValue(), cancelledSource);
  assert.match(notices.at(-1), /no longer available/i);
});
