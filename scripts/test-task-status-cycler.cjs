const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
let MarkdownView;

Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    MarkdownView = class MarkdownView {};
    return {
      MarkdownView,
      Notice: class Notice {},
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

test("direct open/done transitions include incomplete statuses without broadening excluded statuses", () => {
  const cases = [
    { symbol: " ", eligible: true, next: "x" },
    { symbol: "*", eligible: true, next: "x" },
    { symbol: "x", eligible: true, next: " " },
    { symbol: "/", eligible: true, next: "x" },
    { symbol: "-", eligible: false, next: null },
  ];

  for (const { symbol, eligible, next } of cases) {
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
  }
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

test("retirement coordinator rewrites active editor and vault notes together", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n  - ![[Tasks#^done|Done]]",
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
  assert.match(activeText, /~~\[\[Tasks#\^done\|Done\]\]~~/);
  assert.match(harness.getSource("Tasks.md"), /~~\[\[#\^done\|Self reference\]\]~~/);
});

test("full Pomodoro completion retires embeds only after carry-forward planning", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[Root#^root|Finished work]]",
    "\t- [[Notes]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Root.md": "- [ ] #task Root ^root",
    "Notes.md": "# Notes",
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
    /- \[x\] Focus\n\t- ~~\[\[Root#\^root\|Finished work\]\]~~\n\t- \[\[Notes\]\]/,
  );
  const occurrences = editor.getValue().match(/Root#\^root/g) || [];
  assert.equal(occurrences.length, 1, "completed embed was not carried forward");
  assert.match(editor.getValue(), /- \[ \] \(\)\n\t- $/);
});

test("Vim Ctrl+Enter dispatches In Progress and Next tasks through the Tasks done command", () => {
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
    const executedCommands = [];
    const plugin = new TaskStatusCyclerPlugin();
    plugin.app = {
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
    assert.deepEqual(executedCommands, [doneCommand, doneCommand]);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
