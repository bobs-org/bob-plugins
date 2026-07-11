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

  assert.deepEqual(result, { visited: true, changed: true });
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

  assert.deepEqual(result, { visited: true, changed: true });
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
