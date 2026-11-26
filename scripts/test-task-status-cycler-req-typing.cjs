// `- [` typing assist (bob-cli-on.10.1.4): the cycler's CodeMirror extension
// expands `- [` + space to `- [ ] `, absorbs the `]` and space typed at that
// caret, and removes the checkbox atomically on Backspace. The planner is
// pure; the adapter runs against a small fake EditorView that records every
// transaction. o/O continuation pins live here too.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  createInMemoryObsidianApp,
  helpers,
} = require("./task-status-cycler-harness.cjs");

const {
  cyclerReqTypingExpansion,
  cyclerReqTypingBackspace,
  cyclerReqTypingAbsorb,
  cyclerReqTypingBlockedLine,
  cyclerReqTypingRehomePlan,
  cyclerReqTypingBuild,
  getOpenLineBelowPrefix,
} = helpers;

test("expansion fires only on a lone list-item `[` with empty or `]` after", () => {
  assert.deepEqual(cyclerReqTypingExpansion("- [", ""), { removeAfter: 0 });
  assert.deepEqual(cyclerReqTypingExpansion("- [", "]"), { removeAfter: 1 });
  assert.deepEqual(cyclerReqTypingExpansion("\t\t* [", "]"), { removeAfter: 1 });
  assert.deepEqual(cyclerReqTypingExpansion("  + [", ""), { removeAfter: 0 });
  assert.deepEqual(cyclerReqTypingExpansion("1. [", "]"), { removeAfter: 1 });
  assert.deepEqual(cyclerReqTypingExpansion("12) [", ""), { removeAfter: 0 });
  for (const [before, after] of [
    ["- [x", ""],
    ["- [[", "]]"],
    ["- [link", ""],
    ["- [", "] more"],
    ["- [", "x"],
    ["- [", "]]"],
    ["- [", " ]"],
    ["- foo [", ""],
    ["[", ""],
    ["> - [", ""],
    ["-[", ""],
    ["- [ ", ""],
    ["- ", ""],
    ["", ""],
  ]) {
    assert.equal(cyclerReqTypingExpansion(before, after), null, JSON.stringify([before, after]));
  }
});

test("atomic Backspace plans only right after a list-item-start open box", () => {
  assert.deepEqual(cyclerReqTypingBackspace("- [ ] "), { deleteLength: 4 });
  assert.deepEqual(cyclerReqTypingBackspace("\t- [ ] "), { deleteLength: 4 });
  assert.deepEqual(cyclerReqTypingBackspace("1. [ ] "), { deleteLength: 4 });
  for (const before of ["- [x] ", "- [-] ", "- [ ]", "- [ ] t", "- [  ] ", "text [ ] ", "- ", ""]) {
    assert.equal(cyclerReqTypingBackspace(before), null, JSON.stringify(before));
  }
});

test("absorption swallows the `]` then the space and nothing else", () => {
  const armed = { pos: 6, stage: "bracket" };
  assert.deepEqual(cyclerReqTypingAbsorb(armed, "]", 6, 6), {
    swallow: true,
    next: { pos: 6, stage: "space" },
  });
  assert.deepEqual(cyclerReqTypingAbsorb({ pos: 6, stage: "space" }, " ", 6, 6), {
    swallow: true,
    next: null,
  });
  for (const [arm, text, from, to] of [
    [armed, " ", 6, 6],
    [armed, "x", 6, 6],
    [armed, "]", 5, 5],
    [armed, "]", 6, 7],
    [{ pos: 6, stage: "space" }, "]", 6, 6],
    [{ pos: 6, stage: "space" }, "x", 6, 6],
    [null, "]", 6, 6],
  ]) {
    assert.deepEqual(cyclerReqTypingAbsorb(arm, text, from, to), { swallow: false, next: null });
  }
});

test("fences and frontmatter block the assist", () => {
  assert.equal(cyclerReqTypingBlockedLine("- [ ] #task A\n- [", 1), false);
  assert.equal(cyclerReqTypingBlockedLine("```\n- [\n```", 1), true);
  assert.equal(cyclerReqTypingBlockedLine("---\n- [\n---\nbody", 1), true);
  assert.equal(cyclerReqTypingBlockedLine("---\nkey: v\n---\n- [", 3), false);
  assert.equal(cyclerReqTypingBlockedLine("- ```\n  - [\n  ```", 1), true);
});

test("typing a req on a direct child after a drawer rehomes it and scoops loose notes", () => {
  const text = [
    "- [ ] #task Ship",
    "\t- loose note",
    "\t- **FUTURE WORK**",
    "\t\t- drawer note",
    "\t- [",
  ].join("\n");
  const plan = cyclerReqTypingRehomePlan(text, 4, "\t- [", "");
  assert.ok(plan);
  assert.equal(plan.firstReq, true);
  assert.equal(plan.scooped, 1);
  assert.equal(plan.updated, [
    "- [ ] #task Ship",
    "\t- [ ] ",
    "\t- **Notes**",
    "\t\t- loose note",
    "\t- **FUTURE WORK**",
    "\t\t- drawer note",
  ].join("\n"));
});

test("typing a req on a direct child after an existing req keeps the reqs zone", () => {
  const text = [
    "- [ ] #task Ship",
    "\t- [ ] existing req",
    "\t- **Notes**",
    "\t\t- filed note",
    "\t- [",
  ].join("\n");
  const plan = cyclerReqTypingRehomePlan(text, 4, "\t- [", "");
  assert.ok(plan);
  assert.equal(plan.firstReq, false);
  assert.equal(plan.updated, [
    "- [ ] #task Ship",
    "\t- [ ] existing req",
    "\t- [ ] ",
    "\t- **Notes**",
    "\t\t- filed note",
  ].join("\n"));
});

test("the typing adapter applies a direct-child rehome as one isolated expansion", () => {
  const text = [
    "- [ ] #task Ship",
    "\t- loose note",
    "\t- **FUTURE WORK**",
    "\t\t- drawer note",
    "\t- [",
  ].join("\n");
  const plan = cyclerReqTypingRehomePlan(text, 4, "\t- [", "");
  const view = makeFakeView(makeFakeCm(), text, text.length);
  assert.equal(view.type(" "), true);
  assert.equal(view.text, plan.updated);
  const expectedLines = plan.updated.split("\n");
  const expectedHead = expectedLines
    .slice(0, plan.lineIndex)
    .reduce((sum, line) => sum + line.length + 1, 0) + expectedLines[plan.lineIndex].length;
  assert.equal(view.head, expectedHead);
  assert.equal(view.transactions.length, 2);
  assert.deepEqual(view.transactions[1].annotations, [
    { kind: "isolateHistory", value: "full" },
  ]);
  const expanded = view.text;
  assert.equal(view.type("]"), true);
  assert.equal(view.type(" "), true);
  assert.equal(view.text, expanded);
});

test("the typing adapter leaves checklists inside a drawer in place", () => {
  const text = [
    "- [ ] #task Ship",
    "\t- **Notes**",
    "\t\t- [",
  ].join("\n");
  assert.equal(cyclerReqTypingRehomePlan(text, 2, "\t\t- [", ""), null);
  const view = makeFakeView(makeFakeCm(), text, text.length);
  assert.equal(view.type(" "), true);
  assert.equal(view.text, "- [ ] #task Ship\n\t- **Notes**\n\t\t- [ ] ");
});

// --- Fake CodeMirror -------------------------------------------------------

function makeFakeCm() {
  class Effect {
    constructor(type, value) {
      this.type = type;
      this.value = value;
    }

    is(type) {
      return this.type === type;
    }
  }
  return {
    EditorView: { inputHandler: { of: (fn) => ({ kind: "inputHandler", fn }) } },
    keymap: { of: (bindings) => ({ kind: "keymap", bindings }) },
    StateField: { define: (spec) => ({ kind: "field", spec }) },
    StateEffect: {
      define: () => {
        const type = {};
        type.of = (value) => new Effect(type, value);
        return type;
      },
    },
    Prec: { high: (extension) => ({ kind: "prec-high", extension }) },
    isolateHistory: { of: (value) => ({ kind: "isolateHistory", value }) },
  };
}

// A string document with just enough EditorView surface for the adapter.
// Every dispatched transaction is recorded with its resulting text.
function makeFakeView(cm, initial, caret) {
  const extension = cyclerReqTypingBuild(cm);
  assert.ok(Array.isArray(extension) && extension.length === 3);
  const field = extension.find((entry) => entry && entry.kind === "field");
  const handler = extension.find((entry) => entry && entry.kind === "inputHandler").fn;
  const backspace = extension.find((entry) => entry && entry.kind === "prec-high")
    .extension.bindings[0];
  assert.equal(backspace.key, "Backspace");

  const view = {
    composing: false,
    text: initial,
    head: caret,
    anchor: caret,
    armed: null,
    transactions: [],
  };
  const doc = {
    toString: () => view.text,
    sliceString: (from, to) => view.text.slice(from, to),
    lineAt: (pos) => {
      let from = 0;
      let number = 1;
      for (const line of view.text.split("\n")) {
        if (pos <= from + line.length) {
          return { from, to: from + line.length, number, text: line };
        }
        from += line.length + 1;
        number += 1;
      }
      throw new Error("position outside the document");
    },
  };
  view.state = {
    doc,
    get selection() {
      const range = {
        head: view.head,
        anchor: view.anchor,
        empty: view.head === view.anchor,
      };
      return { ranges: [range], main: range };
    },
    field: (which) => {
      assert.equal(which, field);
      return view.armed;
    },
  };
  view.dispatch = (spec) => {
    const effects = spec.effects || [];
    const changes = spec.changes ? [].concat(spec.changes) : [];
    for (const change of changes) {
      view.text = view.text.slice(0, change.from) + (change.insert || "") + view.text.slice(change.to === undefined ? change.from : change.to);
    }
    let selected = false;
    if (spec.selection) {
      view.head = spec.selection.anchor;
      view.anchor = spec.selection.anchor;
      selected = true;
    }
    view.armed = field.spec.update(view.armed, {
      effects,
      docChanged: changes.length > 0,
      selection: selected ? {} : undefined,
    });
    view.transactions.push({
      text: view.text,
      head: view.head,
      userEvent: spec.userEvent || null,
      annotations: spec.annotations || [],
      effects: effects.length,
    });
  };
  view.plainInsert = (from, to, text) => ({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.type",
  });
  // Type one string the way the browser would: the input handler first, the
  // plain insertion when it declines.
  view.type = (text, options = {}) => {
    const from = view.head;
    const handled = handler(view, from, from, text, () => view.plainInsert(from, from, text));
    if (!handled) {
      if (options.autopair && text === "[") {
        view.dispatch({ changes: { from, to: from, insert: "[]" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
      } else {
        view.dispatch(view.plainInsert(from, from, text));
      }
    }
    return handled;
  };
  view.backspace = () => backspace.run(view);
  view.defaultBackspace = () => {
    if (!view.backspace() && view.head > 0) {
      view.dispatch({ changes: { from: view.head - 1, to: view.head }, selection: { anchor: view.head - 1 }, userEvent: "delete.backward" });
    }
  };
  return view;
}

test("builds nothing when a CodeMirror piece is missing", () => {
  const cm = makeFakeCm();
  for (const key of ["EditorView", "keymap", "StateField", "StateEffect", "Prec", "isolateHistory"]) {
    const broken = { ...cm, [key]: null };
    assert.equal(cyclerReqTypingBuild(broken), null, key);
  }
  assert.equal(cyclerReqTypingBuild(null), null);
  assert.equal(cyclerReqTypingBuild({ ...cm, EditorView: {} }), null);
});

test("autopair on: the space and the expansion are two transactions, the second isolated", () => {
  const view = makeFakeView(makeFakeCm(), "- ", 2);
  view.type("[", { autopair: true });
  assert.equal(view.text, "- []");
  assert.equal(view.head, 3);
  view.transactions.length = 0;

  assert.equal(view.type(" "), true);
  assert.equal(view.text, "- [ ] ");
  assert.equal(view.head, 6);
  assert.equal(view.transactions.length, 2);
  const [space, expansion] = view.transactions;
  // The first transaction is exactly the bytes a plain space would produce.
  assert.equal(space.text, "- [ ]");
  assert.equal(space.head, 4);
  assert.equal(space.userEvent, "input.type");
  assert.deepEqual(space.annotations, []);
  // The second carries the history isolation and arms absorption.
  assert.equal(expansion.userEvent, "input.type");
  assert.deepEqual(expansion.annotations, [{ kind: "isolateHistory", value: "full" }]);
  assert.equal(expansion.effects, 1);
  assert.deepEqual(view.armed, { pos: 6, stage: "bracket" });
});

test("autopair off: `- [` + space expands too", () => {
  const view = makeFakeView(makeFakeCm(), "- [", 3);
  assert.equal(view.type(" "), true);
  assert.equal(view.text, "- [ ] ");
  assert.equal(view.head, 6);
  assert.equal(view.transactions.length, 2);
  assert.equal(view.transactions[0].text, "- [ ");
  assert.equal(view.transactions[1].annotations[0].kind, "isolateHistory");
});

test("typing `- [ ` and `- [ ] ` in full both give `- [ ] `", () => {
  for (const autopair of [true, false]) {
    for (const tail of ["", "]", "] "]) {
      const view = makeFakeView(makeFakeCm(), "", 0);
      for (const key of "- [") {
        view.type(key, { autopair });
      }
      view.type(" ");
      for (const key of tail) {
        view.type(key);
      }
      assert.equal(view.text, "- [ ] ", JSON.stringify({ autopair, tail }));
      assert.equal(view.head, 6);
    }
  }
});

test("any other keystroke, edit, or caret move disarms absorption", () => {
  const armedView = () => {
    const view = makeFakeView(makeFakeCm(), "- [", 3);
    view.type(" ");
    assert.deepEqual(view.armed, { pos: 6, stage: "bracket" });
    return view;
  };
  const typed = armedView();
  typed.type("x");
  assert.equal(typed.text, "- [ ] x");
  assert.equal(typed.armed, null);
  typed.type("]");
  assert.equal(typed.text, "- [ ] x]");

  const spaced = armedView();
  spaced.type(" ");
  assert.equal(spaced.text, "- [ ]  ");
  assert.equal(spaced.armed, null);

  const moved = armedView();
  moved.dispatch({ selection: { anchor: 2 } });
  assert.equal(moved.armed, null);
  moved.dispatch({ selection: { anchor: 6 } });
  moved.type("]");
  assert.equal(moved.text, "- [ ] ]");

  const edited = armedView();
  edited.dispatch({ changes: { from: 0, to: 0, insert: "a" }, selection: { anchor: 7 } });
  assert.equal(edited.armed, null);

  // An effect-only transaction (the swallow itself) keeps absorption armed.
  const swallowed = armedView();
  swallowed.type("]");
  assert.equal(swallowed.text, "- [ ] ");
  assert.deepEqual(swallowed.armed, { pos: 6, stage: "space" });
  swallowed.type(" ");
  assert.equal(swallowed.text, "- [ ] ");
  assert.equal(swallowed.armed, null);
});

test("the assist never fires in the wrong places", () => {
  const cm = makeFakeCm();
  const cases = [
    ["- [x", 4],
    ["- [[", 4],
    ["> - [", 5],
    ["- [link", 7],
    ["```\n- [\n```", 7],
    ["---\n- [\n---\nbody", 7],
  ];
  for (const [text, caret] of cases) {
    const view = makeFakeView(cm, text, caret);
    assert.equal(view.type(" "), false, text);
    assert.equal(view.transactions.length, 1, text);
    assert.equal(view.transactions[0].annotations.length, 0, text);
  }
  // Text after the caret other than a lone `]` declines.
  const trailing = makeFakeView(cm, "- [] tail", 3);
  assert.equal(trailing.type(" "), false);
  // A selection or composition declines.
  const selected = makeFakeView(cm, "- [", 3);
  selected.anchor = 0;
  assert.equal(selected.type(" "), false);
  const composing = makeFakeView(cm, "- [", 3);
  composing.composing = true;
  assert.equal(composing.type(" "), false);
});

test("atomic Backspace deletes the box in one key and keeps trailing text", () => {
  const cm = makeFakeCm();
  const plain = makeFakeView(cm, "- [ ] ", 6);
  assert.equal(plain.backspace(), true);
  assert.equal(plain.text, "- ");
  assert.equal(plain.head, 2);
  assert.equal(plain.transactions[0].userEvent, "delete.backward");

  const trailing = makeFakeView(cm, "\t1. [ ] keep", 8);
  assert.equal(trailing.backspace(), true);
  assert.equal(trailing.text, "\t1. keep");
  assert.equal(trailing.head, 4);

  // Task lines are list items too: the box goes whole.
  const task = makeFakeView(cm, "- [ ] #task Ship", 6);
  assert.equal(task.backspace(), true);
  assert.equal(task.text, "- #task Ship");

  // Backspace deeper into the line, on other marks, or in code falls through.
  for (const [text, caret] of [
    ["- [ ] x", 7],
    ["- [x] ", 6],
    ["- [-] ", 6],
    ["- [ ]", 5],
    ["```\n- [ ] \n```", 10],
    ["---\n- [ ] \n---\nbody", 10],
  ]) {
    const view = makeFakeView(cm, text, caret);
    assert.equal(view.backspace(), false, text);
    assert.equal(view.text, text, text);
  }
  const selection = makeFakeView(cm, "- [ ] ", 6);
  selection.anchor = 2;
  assert.equal(selection.backspace(), false);
});

test("Backspace after the expansion removes the box, one key", () => {
  const view = makeFakeView(makeFakeCm(), "- [", 3);
  view.type(" ");
  view.defaultBackspace();
  assert.equal(view.text, "- ");
  assert.equal(view.armed, null);
});

test("registerCyclerReqTyping skips silently without CodeMirror", () => {
  const { app } = createInMemoryObsidianApp({});
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = app;
  const registered = [];
  plugin.registerEditorExtension = (extension) => registered.push(extension);
  // The harness resolves no @codemirror/state at runtime, so the loader finds
  // no pieces and the extension is skipped, not thrown.
  assert.doesNotThrow(() => plugin.registerCyclerReqTyping());
  assert.deepEqual(registered, []);
  const bare = new TaskStatusCyclerPlugin();
  assert.equal(bare.registerCyclerReqTyping(), false);
});

// --- o / O continuation ----------------------------------------------------

test("o and O continue every req line with an open box at the same indent", () => {
  for (const mark of [" ", "-", ">", "x", "?", "/", "~"]) {
    assert.equal(getOpenLineBelowPrefix(`\t- [${mark}] a req`), "\t- [ ] ", JSON.stringify(mark));
    assert.equal(getOpenLineBelowPrefix(`- [${mark}] a req`), "- [ ] ", JSON.stringify(mark));
    assert.equal(getOpenLineBelowPrefix(`\t\t* [${mark}]`), "\t\t- [ ] ", JSON.stringify(mark));
  }
  // The dropped and carried marks are never copied.
  assert.ok(!getOpenLineBelowPrefix("\t- [-] dropped").includes("[-]"));
  assert.ok(!getOpenLineBelowPrefix("\t- [>] carried [[#^id|A]]").includes("[>]"));
  // A plain note continues as a plain bullet, not a req.
  assert.equal(getOpenLineBelowPrefix("\t- a note"), "\t- ");
});

test("Vim o and O on a req line open a fresh open-box line", () => {
  const plugin = new TaskStatusCyclerPlugin();
  plugin.enterVimInsertMode = () => {};
  const makeCm = (lines, cursor) => {
    const store = lines.slice();
    let at = { ...cursor };
    return {
      store,
      getCursor: () => ({ ...at }),
      getLine: (line) => store[line],
      replaceRange: (text, from) => {
        const current = store[from.line];
        const merged = current.slice(0, from.ch) + text + current.slice(from.ch);
        store.splice(from.line, 1, ...merged.split("\n"));
      },
      setCursor: (line, ch) => {
        at = typeof line === "object" ? { ...line } : { line, ch };
      },
      cursor: () => at,
    };
  };
  for (const mark of ["-", ">", "x", " "]) {
    const below = makeCm(["- [ ] #task Ship", `\t- [${mark}] req`], { line: 1, ch: 3 });
    plugin.handleVimOpenLineBelow(below);
    assert.deepEqual(below.store.slice(0, 3), ["- [ ] #task Ship", `\t- [${mark}] req`, "\t- [ ] "], mark);
    assert.deepEqual(below.cursor(), { line: 2, ch: 7 });

    const above = makeCm(["- [ ] #task Ship", `\t- [${mark}] req`], { line: 1, ch: 3 });
    plugin.handleVimOpenLineAbove(above);
    assert.deepEqual(above.store.slice(0, 3), ["- [ ] #task Ship", "\t- [ ] ", `\t- [${mark}] req`], mark);
    assert.deepEqual(above.cursor(), { line: 1, ch: 7 });
  }
  const subtree = makeCm(
    ["- [ ] #task Ship", "\t- [ ] parent req", "\t\t- child note"],
    { line: 1, ch: 3 },
  );
  plugin.handleVimOpenLineBelow(subtree);
  assert.deepEqual(subtree.store.slice(0, 4), [
    "- [ ] #task Ship",
    "\t- [ ] parent req",
    "\t\t- child note",
    "\t- [ ] ",
  ]);
  assert.deepEqual(subtree.cursor(), { line: 3, ch: 7 });
});
