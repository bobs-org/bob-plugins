const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
let MarkdownView;
const notices = [];

Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    MarkdownView = class MarkdownView {};
    return {
      MarkdownView,
      Notice: class Notice {
        constructor(message) {
          notices.push(String(message));
        }
      },
      Plugin: class Plugin {},
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
  const positionOffset = (position) => {
    const lines = text.split("\n");
    return lines
      .slice(0, position.line)
      .reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
  };
  return {
    getValue: () => text,
    getCursor: () => ({ ...cursor }),
    setCursor: (next) => { cursor = { ...next }; },
    getLine: (line) => text.split("\n")[line] || "",
    lineCount: () => text.split("\n").length,
    lastLine: () => text.split("\n").length - 1,
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

test("Pomodoro completion moves marked links in source order before a later Pomodoro", () => {
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
    "\t- [[Projects/Focus#^move-one|Move one]]",
    "\t- [[#^move-two]]",
    "\t- [[Tasks#^ordinary-two|Ordinary two]]",
  ]);
  assert.deepEqual(
    plan.sourceBullets.moveOnlyTaskLinkBullets.map((bullet) => bullet.line),
    [3, 5],
  );
  assert.deepEqual(
    plan.sourceBullets.bareNonTranscludedTaskLinkBullets.map(
      (bullet) => bullet.line,
    ),
    [2, 3, 5, 6],
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
      "\t- [[Projects/Focus#^move-one|Move one]]",
      "\t- [[#^move-two]]",
      "\t- [[Tasks#^ordinary-two|Ordinary two]]",
      "- [ ] Later",
      "\t- [[Tasks#^later|Keep later]]",
    ].join("\n"),
  );
  assert.deepEqual(editor.getCursor(), { line: 5, ch: 7 });
  assert.equal((editor.getValue().match(/- \[ \] \(\)/g) || []).length, 1);
  assert.equal(editor.getValue().includes("]]#"), false);
  assert.equal(editor.getValue().includes("🍅 [[Projects/Focus#^move-one"), false);
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

test("non-Vim open/done command retires the closed task identity", async () => {
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
  let retired = null;
  plugin.retireClosedTaskReferences = async (identities) => { retired = identities; };

  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  await Promise.resolve();
  assert.deepEqual(retired, [{ path: "Tasks.md", blockId: "close" }]);
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
      "- [/] #task Target ^gtd",
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
  plugin.retireClosedTaskReferences = async () => ({ retired: 0, failures: [] });

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
      "- [/] #task Move ^move",
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
    plugin.retireClosedTaskReferences = async () => ({ retired: 0, failures: [] });
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
