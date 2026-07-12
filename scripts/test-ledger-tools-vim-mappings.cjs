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

test("Ledger Vim mappings restore \\p and retain the other normal-mode actions", (t) => {
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
  const pomodoroChanges = [];
  plugin.changePomodoroUnits = (cm, units) =>
    pomodoroChanges.push({ cm, units });
  assert.equal(plugin.registerVimMappings(), true);

  assert.equal(actions.has("bobLedgerAddPomodoroUnit"), true);
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
        key: "\\p",
        type: "action",
        name: "bobLedgerAddPomodoroUnit",
        args: {},
        context: "normal",
      },
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
  assert.equal(mappings.some(([key]) => key === "\\s"), false);

  const cm = {};
  actions.get("bobLedgerAddPomodoroUnit")(cm);
  actions.get("bobLedgerAddPomodoroUnit")(cm, { repeat: 3 });
  assert.deepEqual(pomodoroChanges, [
    { cm, units: 1 },
    { cm, units: 3 },
  ]);
});
