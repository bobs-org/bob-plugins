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

test("direct open/done transitions include Next without broadening other statuses", () => {
  const cases = [
    { symbol: " ", eligible: true, next: "x" },
    { symbol: "*", eligible: true, next: "x" },
    { symbol: "x", eligible: true, next: " " },
    { symbol: "/", eligible: false, next: null },
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

test("Vim Ctrl+Enter dispatches a Next task through the Tasks done command", () => {
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
    const lineText = "- [*] #task Complete the regression fix";
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
    assert.deepEqual(executedCommands, [doneCommand]);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
