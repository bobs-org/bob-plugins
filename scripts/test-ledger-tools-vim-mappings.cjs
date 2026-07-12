const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    return {
      MarkdownView: EmptyClass,
      Notice: EmptyClass,
      Plugin: EmptyClass,
      normalizePath: (value) => value,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: class EditorView {},
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;

test("Ledger Vim mappings omit \\p and retain the other normal-mode actions", (t) => {
  const originalWindow = global.window;
  t.after(() => {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  });

  const actions = new Map();
  const mappings = [];
  global.window = {
    CodeMirrorAdapter: {
      Vim: {
        defineAction: (name, handler) => actions.set(name, handler),
        mapCommand: (...args) => mappings.push(args),
      },
    },
  };

  const plugin = new LedgerToolsPlugin();
  plugin.vimMappingsRegistered = false;
  assert.equal(plugin.registerVimMappings(), true);

  assert.equal(actions.has("bobLedgerAddPomodoroUnit"), false);
  assert.deepEqual(
    mappings.map(([key, type, name, args, options]) => ({
      key,
      type,
      name,
      args,
      context: options.context,
    })),
    [
      {
        key: "\\P",
        type: "action",
        name: "bobLedgerSubtractPomodoroUnit",
        args: {},
        context: "normal",
      },
      {
        key: "\\o",
        type: "action",
        name: "bobLedgerMovePomodoroLater",
        args: {},
        context: "normal",
      },
      {
        key: "\\O",
        type: "action",
        name: "bobLedgerMovePomodoroEarlier",
        args: {},
        context: "normal",
      },
    ],
  );
  for (const mapping of mappings) {
    assert.equal(actions.has(mapping[2]), true);
  }
});
