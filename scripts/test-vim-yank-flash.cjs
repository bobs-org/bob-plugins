const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

// CodeMirror doubles: the plugin only needs StateEffect.define -> {of, is},
// StateField.define -> the spec, Decoration line/mark/set/none, and
// ViewPlugin.fromClass / EditorView.findFromDOM pass-throughs.
let findFromDOMImpl = () => null;

const originalLoad = Module._load;
Module._load = function loadWithYankFlashStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class MarkdownView {},
      Plugin: class Plugin {
        register() {}
        registerEvent() {}
        registerEditorExtension() {}
      },
    };
  }
  if (request === "@codemirror/state") {
    return {
      StateEffect: {
        define() {
          const type = {};
          type.of = (value) => ({
            value,
            is: (other) => other === type,
          });
          return type;
        },
      },
      StateField: {
        define: (spec) => spec,
      },
    };
  }
  if (request === "@codemirror/view") {
    return {
      Decoration: {
        line: (attrs) => ({
          kind: "line",
          attrs,
          range: (from, to) => ({ kind: "line", attrs, from, to }),
        }),
        mark: (attrs) => ({
          kind: "mark",
          attrs,
          range: (from, to) => ({ kind: "mark", attrs, from, to }),
        }),
        set: (ranges, ordered) => ({ ranges, ordered }),
        none: { ranges: [], ordered: true },
      },
      EditorView: {
        findFromDOM: (el) => findFromDOMImpl(el),
      },
      ViewPlugin: {
        fromClass: (cls, spec) => ({ cls, spec }),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const BobVimYankFlashPlugin = require("../plugins/bob-vim-yank-flash/main.js");
const {
  FLASH_MS,
  YANK_FLASH_CLASS,
  YANK_FLASH_LINE_CLASS,
  PUSH_TEXT_MARKER,
  setFlashEffect,
  yankFlashField,
  selectionText,
  lineStartsForRange,
  lineRangeBounds,
  normalizedVisibleRanges,
  visibleLineStarts,
  buildFlashDecorations,
  updateFlashState,
  YankFlashViewPlugin,
  getRegisterController,
  findEditorView,
  hookRegisterController,
  unhookRegisterControllers,
} = BobVimYankFlashPlugin.__test;
Module._load = originalLoad;

// Minimal Text double built from a string: length, lineAt, sliceString.
function makeDoc(text, counter) {
  const lines = text.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return {
    length: text.length,
    lineAt(pos) {
      if (counter) counter.lineAt = (counter.lineAt || 0) + 1;
      const clamped = Math.max(0, Math.min(text.length, pos));
      let low = 0;
      let high = starts.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (starts[middle] <= clamped) low = middle + 1;
        else high = middle;
      }
      const index = Math.max(0, low - 1);
      return {
        from: starts[index],
        to: index + 1 < starts.length ? starts[index + 1] - 1 : text.length,
        number: index + 1,
        text: lines[index],
      };
    },
  };
}

function makeState(text, pairs) {
  return {
    doc: makeDoc(text),
    selection: {
      ranges: pairs.map(([from, to]) => ({ from, to })),
    },
    sliceDoc: (from, to) => text.slice(from, to),
  };
}

function makePlugin() {
  const plugin = new BobVimYankFlashPlugin();
  plugin._yankFlashActive = true;
  plugin._yankFlashSeq = 0;
  plugin._yankHookRecords = [];
  return plugin;
}

// A fake editor view: records dispatches, captures timers on its own window.
function makeView(text, pairs, options = {}) {
  const state = makeState(text, pairs);
  const dispatched = [];
  const timers = [];
  const view = {
    state,
    destroyed: options.destroyed === true,
    visibleRanges:
      options.visibleRanges !== undefined
        ? options.visibleRanges
        : [{ from: 0, to: text.length }],
    dom: {
      isConnected: options.isConnected !== false,
      ownerDocument: {
        defaultView: {
          setTimeout: (fn, ms) => {
            timers.push({ fn, ms });
            return timers.length;
          },
        },
      },
    },
    dispatch: (tr) => {
      dispatched.push(tr);
    },
    _dispatched: dispatched,
    _timers: timers,
  };
  return view;
}

// Wire findEditorView globals to return `view` (or nothing on miss).
function useView(view, { withEditor = true } = {}) {
  const editorEl = { id: "editor" };
  findFromDOMImpl = (el) => (el === editorEl ? view : null);
  const realWindow = global.window;
  const realDocument = global.document;
  global.window = {};
  global.document = {
    activeElement: withEditor
      ? { closest: (sel) => (sel === ".cm-editor" ? editorEl : null) }
      : null,
  };
  return () => {
    findFromDOMImpl = () => null;
    if (realWindow === undefined) {
      delete global.window;
    } else {
      global.window = realWindow;
    }
    if (realDocument === undefined) {
      delete global.document;
    } else {
      global.document = realDocument;
    }
  };
}

function dispatchEffects(view, index = 0) {
  assert.ok(view._dispatched.length > index);
  return view._dispatched[index].effects;
}

test("linewise: yy mid-document highlights exactly that line", () => {
  const doc = makeDoc("aaa\nbbb\nccc\n");
  // `yy` on bbb yanks through the trailing newline: [4, 8).
  assert.deepEqual(lineStartsForRange(doc, 4, 8), [4]);
});

test("linewise: yy on a blank line", () => {
  const doc = makeDoc("aaa\n\nccc\n");
  assert.deepEqual(lineStartsForRange(doc, 4, 5), [4]);
});

test("linewise: yy on the last line with a trailing newline", () => {
  const doc = makeDoc("aaa\nbbb\n");
  // The yank reaches the empty tail line start; it belongs to bbb.
  assert.deepEqual(lineStartsForRange(doc, 4, 8), [4]);
});

test("linewise: yy on the last line without a trailing newline", () => {
  const doc = makeDoc("aaa\nbbb");
  assert.deepEqual(lineStartsForRange(doc, 4, 7), [4]);
});

test("linewise: 3yy across a blank line covers every line", () => {
  const doc = makeDoc("a\n\nc\nd\n");
  // `3yy` from the first line yanks "a\n\nc\n": [0, 5).
  assert.deepEqual(lineStartsForRange(doc, 0, 5), [0, 2, 3]);
});

test("linewise: only rendered lines are decorated across disjoint ranges", () => {
  const text = "l0\nl1\nl2\nl3\nl4\nl5\nl6\nl7\n";
  const doc = makeDoc(text);
  const flash = { id: 1, linewise: true, ranges: [{ from: 0, to: text.length }] };
  const visibleRanges = [
    { from: 6, to: 11 }, // l2..l3
    { from: 21, to: 23 }, // l7
  ];
  const built = buildFlashDecorations(doc, flash, visibleRanges);
  assert.deepEqual(
    built.ranges.map((range) => range.from),
    [6, 9, 21],
  );
  for (const range of built.ranges) {
    assert.equal(range.kind, "line");
    assert.equal(range.attrs.class, YANK_FLASH_LINE_CLASS);
  }
});

test("all selection modes clip to offscreen, partial, disjoint, and empty viewports", () => {
  const text = "aaaa\nbbbb\ncccc\ndddd\n";
  const doc = makeDoc(text);
  const cases = [
    {
      name: "linewise",
      flash: { id: 1, linewise: true, ranges: [{ from: 0, to: 14 }] },
      offscreen: [{ from: 15, to: 19 }],
      partial: [{ from: 2, to: 3 }],
      disjoint: [{ from: 0, to: 2 }, { from: 10, to: 12 }],
      expectedPartial: [["line", 0]],
      expectedDisjoint: [["line", 0], ["line", 10]],
    },
    {
      name: "charwise",
      flash: { id: 1, linewise: false, ranges: [{ from: 0, to: 14 }] },
      offscreen: [{ from: 15, to: 19 }],
      partial: [{ from: 2, to: 6 }],
      disjoint: [{ from: 0, to: 2 }, { from: 10, to: 12 }],
      expectedPartial: [["mark", 2, 6]],
      expectedDisjoint: [["mark", 0, 2], ["mark", 10, 12]],
    },
    {
      name: "blockwise",
      flash: {
        id: 1,
        linewise: false,
        ranges: [{ from: 0, to: 4 }, { from: 5, to: 9 }, { from: 10, to: 14 }],
      },
      offscreen: [{ from: 15, to: 19 }],
      partial: [{ from: 2, to: 6 }],
      disjoint: [{ from: 0, to: 2 }, { from: 10, to: 12 }],
      expectedPartial: [["mark", 2, 4], ["mark", 5, 6]],
      expectedDisjoint: [["mark", 0, 2], ["mark", 10, 12]],
    },
  ];
  for (const item of cases) {
    const coverage = (visibleRanges) => buildFlashDecorations(doc, item.flash, visibleRanges)
      .ranges.map((range) => range.kind === "line"
        ? [range.kind, range.from]
        : [range.kind, range.from, range.to]);
    assert.deepEqual(coverage(item.offscreen), [], item.name + " offscreen");
    assert.deepEqual(coverage(item.partial), item.expectedPartial, item.name + " partial");
    assert.deepEqual(coverage(item.disjoint), item.expectedDisjoint, item.name + " disjoint");
    assert.deepEqual(coverage([]), [], item.name + " empty");
    assert.deepEqual(coverage(undefined), [], item.name + " unavailable");
  }
});

test("linewise blank EOF remains visible at an empty viewport", () => {
  const doc = makeDoc("aaa\n");
  const flash = { id: 1, linewise: true, ranges: [{ from: 4, to: 4 }] };
  assert.deepEqual(
    buildFlashDecorations(doc, flash, [{ from: 4, to: 4 }]).ranges.map((range) => range.from),
    [4],
  );
});

test("viewport changes rebuild decorations from captured source ranges", () => {
  const text = "aaaa\nbbbb\ncccc\ndddd\n";
  const flash = { id: 1, linewise: false, ranges: [{ from: 0, to: 19 }] };
  const view = {
    state: { doc: makeDoc(text), field: () => flash },
    visibleRanges: [{ from: 0, to: 4 }],
  };
  const plugin = new YankFlashViewPlugin.cls(view);
  assert.deepEqual(plugin.decorations.ranges.map((range) => [range.from, range.to]), [[0, 4]]);
  const startState = { field: () => flash };
  view.visibleRanges = [{ from: 10, to: 14 }];
  plugin.update({
    viewportChanged: true,
    docChanged: false,
    state: { field: () => flash },
    startState,
    view,
  });
  assert.deepEqual(plugin.decorations.ranges.map((range) => [range.from, range.to]), [[10, 14]]);
});

test("large linewise yanks inspect only lines in the visible viewport", () => {
  const text = Array.from({ length: 20_000 }, () => "x").join("\n");
  const counter = { lineAt: 0 };
  const doc = makeDoc(text, counter);
  const first = 12_345 * 2;
  const flash = { id: 1, linewise: true, ranges: [{ from: 0, to: text.length }] };
  const built = buildFlashDecorations(doc, flash, [{ from: first, to: first + 5 }]);
  assert.deepEqual(built.ranges.map((range) => range.from), [first, first + 2, first + 4]);
  assert.ok(counter.lineAt < 30, "lineAt calls should follow visible rows, not yank size: " + counter.lineAt);
});

test("linewise: duplicate and overlapping ranges are de-duplicated", () => {
  const text = "aaa\nbbb\nccc\n";
  const doc = makeDoc(text);
  const flash = {
    id: 1,
    linewise: true,
    ranges: [
      { from: 0, to: 12 },
      { from: 4, to: 8 },
      { from: 0, to: 4 },
    ],
  };
  const built = buildFlashDecorations(doc, flash, [{ from: 0, to: text.length }]);
  assert.deepEqual(
    built.ranges.map((range) => range.from),
    [0, 4, 8],
  );
});

test("charwise: a multi-line yank gets one mark", () => {
  const text = "aaa\nbbb\nccc\n";
  const doc = makeDoc(text);
  const flash = { id: 1, linewise: false, ranges: [{ from: 2, to: 10 }] };
  const built = buildFlashDecorations(doc, flash, [{ from: 0, to: text.length }]);
  assert.equal(built.ranges.length, 1);
  assert.equal(built.ranges[0].kind, "mark");
  assert.equal(built.ranges[0].attrs.class, YANK_FLASH_CLASS);
  assert.deepEqual([built.ranges[0].from, built.ranges[0].to], [2, 10]);
});

test("blockwise: one mark per row", () => {
  const text = "abcd\nefgh\nijkl\n";
  const doc = makeDoc(text);
  const flash = {
    id: 1,
    linewise: false,
    ranges: [
      { from: 1, to: 3 },
      { from: 6, to: 8 },
      { from: 11, to: 13 },
    ],
  };
  const built = buildFlashDecorations(doc, flash, [{ from: 0, to: text.length }]);
  assert.deepEqual(
    built.ranges.map((range) => [range.from, range.to]),
    [
      [1, 3],
      [6, 8],
      [11, 13],
    ],
  );
});

test("blockwise: empty rows are skipped", () => {
  const text = "abcd\nefgh\nijkl\n";
  const doc = makeDoc(text);
  const flash = {
    id: 1,
    linewise: false,
    ranges: [
      { from: 1, to: 1 },
      { from: 6, to: 8 },
    ],
  };
  const built = buildFlashDecorations(doc, flash, [{ from: 0, to: text.length }]);
  assert.deepEqual(
    built.ranges.map((range) => [range.from, range.to]),
    [[6, 8]],
  );
});

test("selection text joins ranges with newlines like the adapter", () => {
  const state = makeState("abcd\nefgh\nijkl\n", [
    [1, 3],
    [6, 8],
    [11, 13],
  ]);
  assert.equal(selectionText(state, state.selection.ranges), "bc\nfg\njk");
});

test("empty charwise yank never dispatches", () => {
  const plugin = makePlugin();
  const view = makeView("aaa\n", [[2, 2]]);
  const restore = useView(view);
  try {
    assert.equal(plugin._flashYankRange("", false, false), false);
    assert.equal(view._dispatched.length, 0);
  } finally {
    restore();
  }
});

test("mismatched text means no dispatch (wrong view, :yank collapsed)", () => {
  const plugin = makePlugin();
  const view = makeView("aaa\nbbb\n", [[0, 3]]);
  const restore = useView(view);
  try {
    // A yank of "bbb" while the live selection still covers "aaa".
    assert.equal(plugin._flashYankRange("bbb", false, false), false);
    assert.equal(view._dispatched.length, 0);
    // `:yank` with a collapsed selection: pushed line text never matches "".
    const collapsed = makeView("aaa\nbbb\n", [[1, 1]]);
    const restoreCollapsed = useView(collapsed);
    try {
      assert.equal(plugin._flashYankRange("aaa\n", true, false), false);
      assert.equal(collapsed._dispatched.length, 0);
    } finally {
      restoreCollapsed();
    }
  } finally {
    restore();
  }
});

test("no focused editor means no dispatch", () => {
  const plugin = makePlugin();
  const view = makeView("aaa\n", [[0, 3]]);
  const restore = useView(view, { withEditor: false });
  try {
    assert.equal(plugin._flashYankRange("aaa", false, false), false);
    assert.equal(view._dispatched.length, 0);
  } finally {
    restore();
  }
});

test("findFromDOM miss means no dispatch", () => {
  const plugin = makePlugin();
  const realWindow = global.window;
  const realDocument = global.document;
  global.window = {};
  global.document = {
    activeElement: { closest: () => ({ id: "elsewhere" }) },
  };
  findFromDOMImpl = () => null;
  try {
    assert.equal(findEditorView(), null);
    assert.equal(plugin._flashYankRange("aaa", false, false), false);
  } finally {
    findFromDOMImpl = () => null;
    if (realWindow === undefined) {
      delete global.window;
    } else {
      global.window = realWindow;
    }
    if (realDocument === undefined) {
      delete global.document;
    } else {
      global.document = realDocument;
    }
  }
});

test("a matching yank dispatches a flash and schedules a 200ms clear", () => {
  const plugin = makePlugin();
  const view = makeView("aaa\nbbb\n", [[0, 3]]);
  const restore = useView(view);
  try {
    assert.equal(plugin._flashYankRange("aaa", false, false), true);
    const effects = dispatchEffects(view);
    assert.equal(effects.length, 1);
    assert.ok(effects[0].is(setFlashEffect));
    assert.equal(effects[0].value.id, 1);
    assert.deepEqual(effects[0].value.ranges, [{ from: 0, to: 3 }]);
    assert.equal(view._timers.length, 1);
    assert.equal(view._timers[0].ms, FLASH_MS);
    assert.equal(FLASH_MS, 200);
    // Firing the timer clears the flash it scheduled.
    view._timers[0].fn();
    assert.equal(view._dispatched.length, 2);
    const clear = view._dispatched[1].effects;
    assert.equal(clear.length, 1);
    assert.ok(clear[0].is(setFlashEffect));
    assert.deepEqual(clear[0].value, { id: 1, clear: true });
  } finally {
    restore();
  }
});

function effectTr(effects, docChanged = false) {
  return { effects, docChanged };
}

test("a stale clear keeps the newer flash", () => {
  const current = { id: 2, linewise: false, ranges: [{ from: 0, to: 1 }] };
  const next = updateFlashState(
    current,
    effectTr([setFlashEffect.of({ id: 1, clear: true })]),
  );
  assert.equal(next, current);
});

test("a matching clear removes the flash", () => {
  const current = { id: 2, linewise: false, ranges: [{ from: 0, to: 1 }] };
  assert.equal(
    updateFlashState(current, effectTr([setFlashEffect.of({ id: 2, clear: true })])),
    null,
  );
});

test("a document change drops the flash", () => {
  const current = { id: 1, linewise: true, ranges: [{ from: 0, to: 4 }] };
  assert.equal(updateFlashState(current, effectTr([], true)), null);
});

test("a set replaces the flash", () => {
  const current = { id: 1, linewise: false, ranges: [{ from: 0, to: 1 }] };
  const replacement = { id: 2, linewise: true, ranges: [{ from: 4, to: 8 }] };
  assert.equal(
    updateFlashState(current, effectTr([setFlashEffect.of(replacement)])),
    replacement,
  );
});

test("the field drops its flash on docChanged and swaps on set", () => {
  const flash = { id: 1, linewise: false, ranges: [{ from: 0, to: 1 }] };
  assert.equal(yankFlashField.update(flash, { docChanged: true }), null);
  assert.equal(yankFlashField.create(), null);
  const replacement = { id: 2, linewise: false, ranges: [{ from: 2, to: 3 }] };
  assert.equal(
    yankFlashField.update(flash, { effects: [setFlashEffect.of(replacement)] }),
    replacement,
  );
});

function withWindow(value, fn) {
  const realWindow = global.window;
  global.window = value;
  try {
    return fn();
  } finally {
    if (realWindow === undefined) {
      delete global.window;
    } else {
      global.window = realWindow;
    }
  }
}

test("getRegisterController resolves the Vim adapter controller", () => {
  const controller = { pushText() {} };
  const vim = {
    getRegisterController() {
      return controller;
    },
  };
  withWindow({ CodeMirrorAdapter: { Vim: vim } }, () => {
    assert.equal(getRegisterController(), controller);
  });
});

test("getRegisterController stays silent when the adapter is missing", () => {
  withWindow(undefined, () => {
    assert.equal(getRegisterController(), null);
  });
  withWindow({}, () => {
    assert.equal(getRegisterController(), null);
  });
  withWindow({ CodeMirrorAdapter: {} }, () => {
    assert.equal(getRegisterController(), null);
  });
  withWindow({ CodeMirrorAdapter: { Vim: {} } }, () => {
    assert.equal(getRegisterController(), null);
  });
  withWindow(
    { CodeMirrorAdapter: { Vim: { getRegisterController: () => ({}) } } },
    () => {
      assert.equal(getRegisterController(), null);
    },
  );
});

function makeController(impl) {
  const calls = [];
  const controller = {
    pushText(...args) {
      calls.push({ thisValue: this, args });
      return impl ? impl.apply(this, args) : "yanked";
    },
    _calls: calls,
  };
  return controller;
}

test("the hook wraps once per controller", () => {
  const plugin = makePlugin();
  const controller = makeController();
  assert.equal(hookRegisterController(controller, plugin), true);
  const wrapped = controller.pushText;
  assert.equal(wrapped[PUSH_TEXT_MARKER], true);
  assert.equal(hookRegisterController(controller, plugin), false);
  assert.equal(controller.pushText, wrapped);
});

test("a new controller identity gets wrapped", () => {
  const plugin = makePlugin();
  const first = makeController();
  const second = makeController();
  assert.equal(hookRegisterController(first, plugin), true);
  assert.equal(hookRegisterController(second, plugin), true);
  assert.notEqual(first.pushText, second.pushText);
});

test("an already-hooked controller is skipped even after a wrap-over", () => {
  const plugin = makePlugin();
  const controller = makeController();
  assert.equal(hookRegisterController(controller, plugin), true);
  const outer = function (...args) {
    return controller.__inner.apply(this, args);
  };
  controller.__inner = controller.pushText;
  controller.pushText = outer;
  assert.equal(hookRegisterController(controller, plugin), false);
  assert.equal(controller.pushText, outer);
  delete controller.__inner;
});

test("the original is called once with the same this and args", () => {
  const plugin = makePlugin();
  const controller = makeController(function () {
    return "kept";
  });
  hookRegisterController(controller, plugin);
  const result = controller.pushText.call(controller, '"', "yank", "zzz", false, false);
  assert.equal(result, "kept");
  assert.equal(controller._calls.length, 1);
  assert.equal(controller._calls[0].thisValue, controller);
  assert.deepEqual(controller._calls[0].args, ['"', "yank", "zzz", false, false]);
});

test("unnamed, named, append, plus, and star registers retain original hook calls", () => {
  for (const register of ['"', "a", "A", "+", "*"]) {
    const plugin = makePlugin();
    const flashes = [];
    plugin._flashYankRange = (...args) => flashes.push(args);
    const controller = makeController(function (...args) {
      return { thisValue: this, args };
    });
    hookRegisterController(controller, plugin);
    const receiver = { name: "register-controller" };
    const args = [register, "yank", "copied bytes", true, false];
    const result = controller.pushText.apply(receiver, args);
    assert.equal(result.thisValue, receiver, register + " receiver");
    assert.deepEqual(result.args, args, register + " original args");
    assert.deepEqual(flashes, [["copied bytes", true, false]], register + " flash");
  }
});

test('the black-hole register and non-yank operators never flash', () => {
  const plugin = makePlugin();
  const view = makeView("aaa\n", [[0, 3]]);
  const restore = useView(view);
  try {
    const controller = makeController();
    hookRegisterController(controller, plugin);
    controller.pushText('"', "yank", "aaa", false, false);
    assert.equal(view._dispatched.length, 1);
    controller.pushText("_", "yank", "aaa", false, false);
    controller.pushText('"', "delete", "aaa", false, false);
    controller.pushText('"', "change", "aaa", false, false);
    assert.equal(view._dispatched.length, 1);
    assert.equal(controller._calls.length, 4);
  } finally {
    restore();
  }
});

test("flash exceptions are swallowed and the yank result passes through", () => {
  const plugin = makePlugin();
  plugin._flashYankRange = () => {
    throw new Error("boom");
  };
  const controller = makeController(function () {
    return "kept";
  });
  hookRegisterController(controller, plugin);
  const realDebug = console.debug;
  let debugCalls = 0;
  console.debug = () => {
    debugCalls += 1;
  };
  try {
    const result = controller.pushText('"', "yank", "aaa", false, false);
    assert.equal(result, "kept");
    assert.equal(debugCalls, 1);
  } finally {
    console.debug = realDebug;
  }
});

test("a prototype pushText is restored by delete", () => {
  const plugin = makePlugin();
  const proto = {
    pushText() {
      return "proto";
    },
  };
  const controller = Object.create(proto);
  assert.equal(hookRegisterController(controller, plugin), true);
  assert.ok(Object.prototype.hasOwnProperty.call(controller, "pushText"));
  unhookRegisterControllers(plugin);
  assert.ok(!Object.prototype.hasOwnProperty.call(controller, "pushText"));
  assert.equal(controller.pushText, proto.pushText);
  assert.equal(plugin._yankHookRecords.length, 0);
});

test("an own-property pushText is reassigned on unload", () => {
  const plugin = makePlugin();
  const original = function () {
    return "own";
  };
  const controller = { pushText: original };
  assert.equal(hookRegisterController(controller, plugin), true);
  unhookRegisterControllers(plugin);
  assert.equal(controller.pushText, original);
});

test("a wrapped-over wrapper stays inert after unload", () => {
  const plugin = makePlugin();
  const view = makeView("aaa\n", [[0, 3]]);
  const restore = useView(view);
  try {
    const controller = makeController(function () {
      return "kept";
    });
    hookRegisterController(controller, plugin);
    const inner = controller.pushText;
    let outerCalls = 0;
    controller.pushText = function (...args) {
      outerCalls += 1;
      return inner.apply(this, args);
    };
    plugin._yankFlashActive = false;
    unhookRegisterControllers(plugin);
    // Our wrapper is no longer on top, so it stays untouched and inert.
    assert.notEqual(controller.pushText, inner);
    const result = controller.pushText('"', "yank", "aaa", false, false);
    assert.equal(result, "kept");
    assert.equal(outerCalls, 1);
    assert.equal(controller._calls.length, 1);
    assert.equal(view._dispatched.length, 0);
  } finally {
    restore();
  }
});

test("the clear is scheduled on the view's own window", () => {
  const plugin = makePlugin();
  const first = makeView("aaa\n", [[0, 3]]);
  const second = makeView("aaa\n", [[0, 3]]);
  const restore = useView(first);
  try {
    assert.equal(plugin._flashYankRange("aaa", false, false), true);
    assert.equal(first._timers.length, 1);
    assert.equal(second._timers.length, 0);
  } finally {
    restore();
  }
});

test("an expired detached view is cleared before it can be reattached", () => {
  const plugin = makePlugin();
  const view = makeView("aaa\n", [[0, 3]]);
  const restore = useView(view);
  try {
    assert.equal(plugin._flashYankRange("aaa", false, false), true);
    assert.equal(view._timers.length, 1);
    view.dom.isConnected = false;
    view._timers[0].fn();
    assert.equal(view._dispatched.length, 2);
    assert.deepEqual(dispatchEffects(view, 1)[0].value, { id: 1, clear: true });
    view.dom.isConnected = true;
    assert.equal(view._dispatched.length, 2);
  } finally {
    restore();
  }
});

test("an expired timer does not dispatch into a destroyed editor", () => {
  const plugin = makePlugin();
  const view = makeView("aaa\n", [[0, 3]]);
  const restore = useView(view);
  try {
    assert.equal(plugin._flashYankRange("aaa", false, false), true);
    view.destroyed = true;
    view._timers[0].fn();
    assert.equal(view._dispatched.length, 1);
  } finally {
    restore();
  }
});
