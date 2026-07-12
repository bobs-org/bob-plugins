const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
Module._load = function loadWithObsidianStub(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class MarkdownView {},
      Plugin: class Plugin {
        register() {}
        registerEvent() {}
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const BobVimSurroundPlugin = require("../plugins/bob-vim-surround/main.js");
const { SURROUND_PAIRS, findEnclosingSurroundPair, getSurroundPair } =
  BobVimSurroundPlugin.__test;
Module._load = originalLoad;

const SURROUND_OPERATOR_NAME = "bobVimSurroundAdd";

class TestEditor {
  constructor(content, cursor = { line: 0, ch: 0 }) {
    this.content = content;
    this.cursor = { ...cursor };
    this.replacements = [];
    this.operationCount = 0;
    this.state = { vim: { mode: "normal" } };
  }

  getValue() {
    return this.content;
  }

  getLine(line) {
    return this.content.split("\n")[line] ?? "";
  }

  lineCount() {
    return this.content.split("\n").length;
  }

  getCursor() {
    return { ...this.cursor };
  }

  setCursor(position) {
    this.cursor = { ...position };
  }

  getRange(from, to) {
    return this.content.slice(this.offset(from), this.offset(to));
  }

  replaceRange(text, from, to = from) {
    const start = this.offset(from);
    const end = this.offset(to);
    this.replacements.push({ text, from: { ...from }, to: { ...to } });
    this.content = this.content.slice(0, start) + text + this.content.slice(end);
  }

  operation(callback) {
    this.operationCount += 1;
    callback();
  }

  offset(position) {
    const lines = this.content.split("\n");
    return (
      lines
        .slice(0, position.line)
        .reduce((total, line) => total + line.length + 1, 0) + position.ch
    );
  }
}

function makePlugin() {
  const plugin = new BobVimSurroundPlugin();
  plugin.pendingSurround = null;
  plugin.pendingChangeSurround = null;
  plugin.pendingDeleteSurround = null;
  plugin.surroundTriggerCandidate = null;
  plugin.lastSurroundAction = null;
  plugin.surroundDocSig = null;
  plugin.handledSurroundEvents = new WeakSet();
  return plugin;
}

function makeKeyEvent(key, overrides = {}) {
  const counts = { preventDefault: 0, stopPropagation: 0, immediate: 0 };
  return {
    key,
    defaultPrevented: false,
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      counts.preventDefault += 1;
    },
    stopPropagation() {
      counts.stopPropagation += 1;
    },
    stopImmediatePropagation() {
      counts.immediate += 1;
    },
    counts,
    ...overrides,
  };
}

function singleLineSpan(start, end) {
  return {
    start: { line: 0, ch: start },
    end: { line: 0, ch: end },
  };
}

function assertConsumedOnce(event) {
  assert.deepEqual(event.counts, {
    preventDefault: 1,
    stopPropagation: 1,
    immediate: 1,
  });
}

test("every printable non-space ASCII key resolves to a surround pair", () => {
  for (let code = 0x21; code <= 0x7e; code += 1) {
    const key = String.fromCharCode(code);
    const pair = getSurroundPair(key);
    assert.deepEqual(
      pair,
      SURROUND_PAIRS[key] || { open: key, close: key, padded: false },
      JSON.stringify(key),
    );
  }
});

test("visible one-code-unit BMP letters, numbers, punctuation, and symbols resolve symmetrically", () => {
  for (const key of ["é", "Ж", "漢", "９", "。", "€", "™"]) {
    assert.deepEqual(getSurroundPair(key), {
      open: key,
      close: key,
      padded: false,
    });
  }
});

test("non-visible, combining, multi-character, and multi-code-unit values are rejected", () => {
  for (const value of [
    null,
    undefined,
    "",
    "ab",
    " ",
    "\t",
    "\n",
    "\u0000",
    "\u007f",
    "\u00a0",
    "\u0301",
    "\u200d",
    "\ud800",
    "😀",
    "𐐀",
  ]) {
    assert.equal(getSurroundPair(value), null, JSON.stringify(value));
  }
});

test("ys adds broad symmetric delimiters through pending keydown", () => {
  const cases = [
    ["~", false],
    ["x", false],
    ["^", true],
    ["7", false],
    ["A", true],
    ["$", true],
    ["s", false],
    ["c", false],
    ["d", false],
    ["y", false],
    [".", false],
    ["\\", false],
  ];

  for (const [key, shiftKey] of cases) {
    const plugin = makePlugin();
    const cm = new TestEditor("word");
    const event = makeKeyEvent(key, { shiftKey });
    plugin.pendingSurround = { cm, spans: [singleLineSpan(0, 4)] };

    assert.equal(plugin.handleSurroundKeydown(event), true, key);
    assert.equal(cm.content, `${key}word${key}`, key);
    assert.deepEqual(cm.cursor, { line: 0, ch: 1 }, key);
    assert.equal(cm.operationCount, 1, key);
    assert.equal(plugin.pendingSurround, null, key);
    assert.equal(plugin.lastSurroundAction.type, "ys", key);
    assertConsumedOnce(event);

    assert.equal(plugin.handleSurroundKeydown(event), false, key);
    assert.equal(cm.content, `${key}word${key}`, key);
    assertConsumedOnce(event);
  }
});

test("rejected keydown input never edits or leaks into a pending ys", () => {
  const cases = [
    [" ", {}, false],
    ["Tab", {}, false],
    ["ArrowLeft", {}, false],
    ["x", { ctrlKey: true }, false],
    ["x", { altKey: true }, false],
    ["x", { metaKey: true }, false],
    ["x", { isComposing: true }, false],
    ["Dead", {}, false],
    ["\u0301", {}, false],
    ["ab", {}, false],
    ["😀", {}, false],
    ["Shift", {}, true],
    ["Control", {}, true],
  ];

  for (const [key, overrides, remainsPending] of cases) {
    const plugin = makePlugin();
    const cm = new TestEditor("word");
    const pending = { cm, spans: [singleLineSpan(0, 4)] };
    const event = makeKeyEvent(key, overrides);
    plugin.pendingSurround = pending;

    plugin.handleSurroundKeydown(event);
    assert.equal(cm.content, "word", key);
    assert.equal(cm.replacements.length, 0, key);
    assert.equal(cm.operationCount, 0, key);
    assert.equal(plugin.lastSurroundAction, null, key);
    assert.equal(plugin.pendingSurround, remainsPending ? pending : null, key);
    if (remainsPending) {
      assert.deepEqual(event.counts, {
        preventDefault: 0,
        stopPropagation: 0,
        immediate: 0,
      });
    } else {
      assertConsumedOnce(event);
    }
  }
});

test("Escape cancels ys, cs, and ds pending state without editing", () => {
  for (const kind of ["ys", "cs", "ds"]) {
    const plugin = makePlugin();
    const cm = new TestEditor("word");
    if (kind === "ys") {
      plugin.pendingSurround = { cm, spans: [singleLineSpan(0, 4)] };
    } else if (kind === "cs") {
      plugin.pendingChangeSurround = { cm, stage: "target", targetKey: null };
    } else {
      plugin.pendingDeleteSurround = { cm };
    }
    const event = makeKeyEvent("Escape");

    assert.equal(plugin.handleSurroundKeydown(event), true, kind);
    assert.equal(plugin.pendingSurround, null, kind);
    assert.equal(plugin.pendingChangeSurround, null, kind);
    assert.equal(plugin.pendingDeleteSurround, null, kind);
    assert.equal(cm.content, "word", kind);
    assert.equal(cm.replacements.length, 0, kind);
    assertConsumedOnce(event);
  }
});

test("cs accepts broad target and replacement characters independently", () => {
  for (const [target, replacement] of [
    ["~", "x"],
    ["x", "^"],
    ["7", "s"],
    [".", "\\"],
    ["\\", "$"],
    ["A", "9"],
  ]) {
    const plugin = makePlugin();
    const cm = new TestEditor(`${target}MID${target}`, { line: 0, ch: 2 });
    const targetEvent = makeKeyEvent(target);
    const replacementEvent = makeKeyEvent(replacement);
    plugin.pendingChangeSurround = { cm, stage: "target", targetKey: null };

    assert.equal(plugin.handleSurroundKeydown(targetEvent), true);
    assert.deepEqual(plugin.pendingChangeSurround, {
      cm,
      stage: "replacement",
      targetKey: target,
    });
    assert.equal(cm.content, `${target}MID${target}`);
    assertConsumedOnce(targetEvent);

    assert.equal(plugin.handleSurroundKeydown(replacementEvent), true);
    assert.equal(cm.content, `${replacement}MID${replacement}`);
    assert.equal(plugin.pendingChangeSurround, null);
    assert.equal(plugin.lastSurroundAction.type, "cs");
    assert.equal(plugin.lastSurroundAction.targetKey, target);
    assertConsumedOnce(replacementEvent);
  }
});

test("cs preserves structural alias and padding rules", () => {
  const cases = [
    ["( MID )", "(", "]", "[MID]"],
    ["[MID]", "]", "{", "{ MID }"],
    ["( MID )", ")", "x", "x MID x"],
    ["< MID >", "<", ">", "<MID>"],
  ];

  for (const [content, target, replacement, expected] of cases) {
    const plugin = makePlugin();
    const cm = new TestEditor(content, { line: 0, ch: 3 });
    plugin.pendingChangeSurround = {
      cm,
      stage: "replacement",
      targetKey: target,
    };

    plugin.handleSurroundKeydown(makeKeyEvent(replacement));
    assert.equal(cm.content, expected, `${target} -> ${replacement}`);
  }
});

test("ds removes representative broad symmetric delimiters", () => {
  for (const target of ["~", "x", "^", "7", "A", "s", ".", "\\", "$"]) {
    const plugin = makePlugin();
    const cm = new TestEditor(`${target}MID${target}`, { line: 0, ch: 2 });
    const event = makeKeyEvent(target);
    plugin.pendingDeleteSurround = { cm };

    assert.equal(plugin.handleSurroundKeydown(event), true, target);
    assert.equal(cm.content, "MID", target);
    assert.deepEqual(cm.cursor, { line: 0, ch: 0 }, target);
    assert.equal(plugin.lastSurroundAction.type, "ds", target);
    assert.equal(plugin.lastSurroundAction.targetKey, target);
    assertConsumedOnce(event);
  }
});

test("symmetric discovery uses deterministic sequential same-line pairs", () => {
  const cm = new TestEditor("xleftx xrightx", { line: 0, ch: 2 });
  const first = findEnclosingSurroundPair(cm, "x");
  assert.equal(first.open.index, 0);
  assert.equal(first.close.index, 5);

  cm.setCursor({ line: 0, ch: 9 });
  const second = findEnclosingSurroundPair(cm, "x");
  assert.equal(second.open.index, 7);
  assert.equal(second.close.index, 13);

  const multiline = new TestEditor("xleft\nrightx", { line: 0, ch: 2 });
  assert.equal(findEnclosingSurroundPair(multiline, "x"), null);
});

test("ordinary normal-mode keys remain untouched outside pending state", () => {
  const plugin = makePlugin();

  for (const key of ["x", "s", ".", "a", "1"]) {
    const event = makeKeyEvent(key);
    assert.equal(plugin.handleSurroundKeydown(event), false, key);
    assert.deepEqual(event.counts, {
      preventDefault: 0,
      stopPropagation: 0,
      immediate: 0,
    });
  }
});

test("dot while a surround is pending is a literal delimiter, not repeat", () => {
  const plugin = makePlugin();
  const cm = new TestEditor("word");
  plugin.lastSurroundAction = {
    type: "ds",
    cm,
    targetKey: "x",
  };
  plugin.surroundDocSig = cm.getValue();
  plugin.pendingSurround = { cm, spans: [singleLineSpan(0, 4)] };
  const event = makeKeyEvent(".");

  assert.equal(plugin.handleSurroundKeydown(event), true);
  assert.equal(cm.content, ".word.");
  assert.equal(plugin.lastSurroundAction.type, "ys");
  assert.deepEqual(plugin.lastSurroundAction.pair, {
    open: ".",
    close: ".",
    padded: false,
  });
  assertConsumedOnce(event);
});

test("dot-repeat records and replays broad-character ys", () => {
  const plugin = makePlugin();
  const cm = new TestEditor("one two");
  plugin.pendingSurround = { cm, spans: [singleLineSpan(0, 3)] };
  plugin.handleSurroundKeydown(makeKeyEvent("x"));
  assert.equal(cm.content, "xonex two");
  assert.equal(plugin.lastSurroundAction.type, "ys");

  cm.state.vim.lastEditInputState = { operator: SURROUND_OPERATOR_NAME };
  plugin.resolveEventNormalModeVimCm = () => cm;
  plugin.injectVimKey = (_cm, key) => {
    if (key === ".") {
      plugin.pendingSurround = { cm, spans: [singleLineSpan(6, 9)] };
    }
    return true;
  };
  const repeatEvent = makeKeyEvent(".");

  assert.equal(plugin.handleSurroundKeydown(repeatEvent), true);
  assert.equal(cm.content, "xonex xtwox");
  assert.equal(plugin.lastSurroundAction.type, "ys");
  assertConsumedOnce(repeatEvent);
});

test("dot-repeat records and replays broad-character cs", () => {
  const plugin = makePlugin();
  const cm = new TestEditor("xONEx xTWOx", { line: 0, ch: 2 });
  plugin.pendingChangeSurround = {
    cm,
    stage: "replacement",
    targetKey: "x",
  };
  plugin.handleSurroundKeydown(makeKeyEvent("^"));
  assert.equal(cm.content, "^ONE^ xTWOx");
  assert.equal(plugin.lastSurroundAction.type, "cs");

  cm.setCursor({ line: 0, ch: 9 });
  plugin.resolveEventNormalModeVimCm = () => cm;
  plugin.injectVimKey = () => true;
  const repeatEvent = makeKeyEvent(".");

  assert.equal(plugin.handleSurroundKeydown(repeatEvent), true);
  assert.equal(cm.content, "^ONE^ ^TWO^");
  assert.equal(plugin.lastSurroundAction.type, "cs");
  assertConsumedOnce(repeatEvent);
});

test("dot-repeat records and replays broad-character ds", () => {
  const plugin = makePlugin();
  const cm = new TestEditor("~ONE~ ~TWO~", { line: 0, ch: 2 });
  plugin.pendingDeleteSurround = { cm };
  plugin.handleSurroundKeydown(makeKeyEvent("~"));
  assert.equal(cm.content, "ONE ~TWO~");
  assert.equal(plugin.lastSurroundAction.type, "ds");

  cm.setCursor({ line: 0, ch: 6 });
  plugin.resolveEventNormalModeVimCm = () => cm;
  plugin.injectVimKey = () => true;
  const repeatEvent = makeKeyEvent(".");

  assert.equal(plugin.handleSurroundKeydown(repeatEvent), true);
  assert.equal(cm.content, "ONE TWO");
  assert.equal(plugin.lastSurroundAction.type, "ds");
  assertConsumedOnce(repeatEvent);
});
