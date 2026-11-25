// Drawer marker typing (bob-cli-ph.7.1.3): scoped `*` expansion, overtype,
// atomic Backspace, smart Enter, and Toggle Drawer beside the requirement
// typing assist. Pure planners are tested directly; the adapter runs against
// a small fake EditorView that records every transaction.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TaskStatusCyclerPlugin,
  createInMemoryObsidianApp,
  createTextEditor,
  attachActiveMarkdownView,
  MarkdownView,
  notices,
  helpers,
} = require("./task-status-cycler-harness.cjs");

const {
  drawerTypingEmptyPrefix,
  drawerTypingBlockedLine,
  drawerTypingOwnerTask,
  drawerTypingHypotheticalTask,
  drawerTypingEligible,
  drawerTypingExpansion,
  drawerTypingOvertypePlan,
  drawerTypingBackspacePlan,
  drawerTypingEnterPlan,
  planDrawerToggle,
  drawerTypingBuild,
} = helpers;

const TASK = "- [ ] #task Upgrade Postgres";
const ELIGIBLE = `${TASK}\n  - `;
const ELIGIBLE_LINE = 1;

test("expansion shape fires only on an empty bullet with spaces after", () => {
  assert.deepEqual(drawerTypingExpansion("- ", ""), { secondInsert: "***" });
  assert.deepEqual(drawerTypingExpansion("  - ", ""), { secondInsert: "***" });
  assert.deepEqual(drawerTypingExpansion("\t* ", ""), { secondInsert: "***" });
  assert.deepEqual(drawerTypingExpansion("  1. ", "   "), { secondInsert: "***" });
  for (const [before, after] of [
    ["- *", ""],
    ["- Title", ""],
    ["- [ ] ", ""],
    ["- ", "x"],
    ["- ", "**"],
    ["-", ""],
    ["", ""],
    ["  -", ""],
    ["> - ", ""],
  ]) {
    assert.equal(drawerTypingExpansion(before, after), null, JSON.stringify([before, after]));
  }
  assert.equal(drawerTypingEmptyPrefix("  - ", ""), true);
  assert.equal(drawerTypingEmptyPrefix("- Title", ""), false);
});

test("fences and frontmatter block the assist", () => {
  assert.equal(drawerTypingBlockedLine(`${TASK}\n  - `, 1), false);
  assert.equal(drawerTypingBlockedLine("```\n  - \n```", 1), true);
  assert.equal(drawerTypingBlockedLine("---\n  - \n---\nbody", 1), true);
  assert.equal(drawerTypingBlockedLine("---\nkey: v\n---\n  - ", 3), false);
});

test("eligibility needs an empty bullet directly under a real task", () => {
  assert.equal(drawerTypingEligible(ELIGIBLE, ELIGIBLE_LINE), true);
  assert.equal(drawerTypingEligible(`${TASK}\n\t- `, 1), true);
  assert.equal(drawerTypingEligible(`${TASK}\n  * `, 1), true);
  assert.equal(drawerTypingEligible(`${TASK}\n  1. `, 1), true);
  // No task above.
  assert.equal(drawerTypingEligible("- just a bullet\n  - ", 1), false);
  assert.equal(drawerTypingEligible("  - ", 0), false);
  // Nonempty bullets never expand.
  assert.equal(drawerTypingEligible(`${TASK}\n  - note`, 1), false);
  assert.equal(drawerTypingEligible(`${TASK}\n  - [ ] req`, 1), false);
  assert.equal(drawerTypingEligible(`${TASK}\n  - **API Design**`, 1), false);
  // Deeper positions live under a note, drawer, or req, never the task.
  assert.equal(drawerTypingEligible(`${TASK}\n  - note\n    - `, 2), false);
  assert.equal(drawerTypingEligible(`${TASK}\n  - **API Design**\n    - `, 2), false);
  assert.equal(drawerTypingEligible(`${TASK}\n  - [ ] req\n    - `, 2), false);
  // Quotes, fences, and frontmatter stay out.
  assert.equal(drawerTypingEligible(`${TASK}\n> - `, 1), false);
  assert.equal(drawerTypingEligible(`${TASK}\n\`\`\`\n  - \n\`\`\``, 2), false);
  assert.equal(drawerTypingEligible("---\n  - \n---\nbody", 1), false);
});

test("hypothetical header decides the position", () => {
  assert.notEqual(drawerTypingHypotheticalTask(ELIGIBLE, ELIGIBLE_LINE), null);
  assert.equal(drawerTypingHypotheticalTask("- just a bullet\n  - ", 1), null);
  const owned = drawerTypingOwnerTask(ELIGIBLE, ELIGIBLE_LINE);
  assert.ok(owned && owned.task.lineIndex === 0);
  assert.equal(drawerTypingOwnerTask("- just a bullet\n  - ", 1), null);
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
    Prec: {
      high: (extension) => ({ kind: "prec-high", extension }),
      highest: (extension) => ({ kind: "prec-highest", extension }),
    },
    isolateHistory: { of: (value) => ({ kind: "isolateHistory", value }) },
  };
}

// A string document with just enough EditorView surface for the adapter.
// Every dispatched transaction is recorded with its resulting text.
function makeFakeView(cm, initial, caret) {
  const extension = drawerTypingBuild(cm);
  assert.ok(Array.isArray(extension) && extension.length === 2);
  const input = extension.find((entry) => entry && entry.kind === "prec-highest");
  assert.ok(input && input.extension && input.extension.kind === "inputHandler");
  const handler = input.extension.fn;
  const keys = extension.find((entry) => entry && entry.kind === "prec-high").extension.bindings;
  const backspace = keys.find((binding) => binding.key === "Backspace");
  const enter = keys.find((binding) => binding.key === "Enter");
  assert.ok(backspace && enter);

  const view = {
    composing: false,
    text: initial,
    head: caret,
    anchor: caret,
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
  };
  view.dispatch = (spec) => {
    const changes = spec.changes ? [].concat(spec.changes) : [];
    for (const change of changes) {
      view.text = view.text.slice(0, change.from) + (change.insert || "") + view.text.slice(change.to === undefined ? change.from : change.to);
    }
    if (spec.selection) {
      view.head = spec.selection.anchor;
      view.anchor = spec.selection.anchor;
    }
    view.transactions.push({
      text: view.text,
      head: view.head,
      userEvent: spec.userEvent || null,
      annotations: spec.annotations || [],
    });
  };
  view.plainInsert = (from, to, text) => ({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.type",
  });
  // Type one string the way the browser would: the input handler first, the
  // plain insertion (or the autopair double) when it declines.
  view.type = (text, options = {}) => {
    const from = view.head;
    const handled = handler(view, from, from, text, () => view.plainInsert(from, from, text));
    if (!handled) {
      if (options.autopair && text === "*") {
        view.dispatch({ changes: { from, to: from, insert: "**" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
      } else {
        view.dispatch(view.plainInsert(from, from, text));
      }
    }
    return handled;
  };
  view.backspace = () => backspace.run(view);
  view.pressEnter = () => enter.run(view);
  view.defaultBackspace = () => {
    if (!view.backspace() && view.head > 0) {
      view.dispatch({ changes: { from: view.head - 1, to: view.head }, selection: { anchor: view.head - 1 }, userEvent: "delete.backward" });
    }
  };
  return view;
}

test("star inputHandler uses Prec.highest so autoPairMarkdown cannot win first", () => {
  const extension = drawerTypingBuild(makeFakeCm());
  assert.equal(extension[0].kind, "prec-highest");
  assert.equal(extension[0].extension.kind, "inputHandler");
  assert.equal(extension[1].kind, "prec-high");
});

test("builds nothing when a CodeMirror piece is missing", () => {
  const cm = makeFakeCm();
  for (const key of ["EditorView", "keymap", "StateField", "StateEffect", "Prec", "isolateHistory"]) {
    const broken = { ...cm, [key]: null };
    assert.equal(drawerTypingBuild(broken), null, key);
  }
  assert.equal(drawerTypingBuild(null), null);
  assert.equal(drawerTypingBuild({ ...cm, EditorView: {} }), null);
});

test("autopair on and off both land on `- ****` with the caret inside", () => {
  for (const autopair of [true, false]) {
    const view = makeFakeView(makeFakeCm(), ELIGIBLE, ELIGIBLE.length);
    assert.equal(view.type("*", { autopair }), true);
    assert.equal(view.text, `${TASK}\n  - ****`);
    assert.equal(view.head, ELIGIBLE.length + 2);
    assert.equal(view.transactions.length, 2);
    const [star, expansion] = view.transactions;
    // The first transaction is exactly the literal `- *`.
    assert.equal(star.text, `${TASK}\n  - *`);
    assert.deepEqual(star.annotations, []);
    // The second carries the history isolation; one Undo returns to `- *`.
    assert.equal(expansion.userEvent, "input.type");
    assert.deepEqual(expansion.annotations, [{ kind: "isolateHistory", value: "full" }]);
  }
});

test("indentation and markers survive the expansion", () => {
  for (const marker of ["-", "*", "+", "1.", "2)"]) {
    const base = `${TASK}\n\t${marker} `;
    const view = makeFakeView(makeFakeCm(), base, base.length);
    assert.equal(view.type("*"), true, marker);
    assert.equal(view.text, `${TASK}\n\t${marker} ****`, marker);
    assert.equal(view.head, base.length + 2, marker);
  }
});

test("a typed `*` at a drawer title end steps over both stars", () => {
  const base = `${TASK}\n  - **API Design**`;
  const caret = base.length - 2;
  const view = makeFakeView(makeFakeCm(), base, caret);
  assert.deepEqual(drawerTypingOvertypePlan(base, 1, caret - (`${TASK}\n`.length)), { advance: 2 });
  assert.equal(view.type("*"), true);
  assert.equal(view.text, base);
  assert.equal(view.head, caret + 2);
  assert.equal(view.transactions.length, 1);
  assert.deepEqual(view.transactions[0].annotations, []);
});

test("overtype needs a real drawer header at the title end", () => {
  assert.equal(drawerTypingOvertypePlan(`${TASK}\n  - **API Design**`, 1, "  - **API Design".length) !== null, true);
  for (const [text, line, ch] of [
    [`${TASK}\n  - **API Design**`, 1, 0],
    [`${TASK}\n  - **API Design**`, 1, "  - **API".length],
    [`${TASK}\n  - ****`, 1, "  - **".length],
    [`${TASK}\n  - note`, 1, "  - note".length],
    ["- **API Design**", 0, 0],
    ["- **API Design**", 0, "- **API".length],
  ]) {
    assert.equal(drawerTypingOvertypePlan(text, line, ch), null, JSON.stringify([text, ch]));
  }
});

test("atomic Backspace deletes all four stars and keeps the bullet", () => {
  const base = `${TASK}\n  - ****`;
  const caret = base.length - 2;
  const view = makeFakeView(makeFakeCm(), base, caret);
  assert.deepEqual(drawerTypingBackspacePlan(base, 1, caret - (`${TASK}\n`.length)), { deleteBefore: 2, deleteAfter: 2 });
  assert.equal(view.backspace(), true);
  assert.equal(view.text, ELIGIBLE);
  assert.equal(view.head, ELIGIBLE.length);
  assert.equal(view.transactions[0].userEvent, "delete.backward");
});

test("Backspace elsewhere falls through", () => {
  const cm = makeFakeCm();
  const header = `${TASK}\n  - **API Design**`;
  for (const [text, caret] of [
    [header, header.length - 2],
    [`${TASK}\n  - *`, `${TASK}\n  - *`.length],
    [ELIGIBLE, ELIGIBLE.length],
    [`${TASK}\n  - ****`, `${TASK}\n  - ****`.length],
    ["```\n  - ****\n```", 10],
  ]) {
    const view = makeFakeView(cm, text, caret);
    assert.equal(view.backspace(), false, text);
    assert.equal(view.text, text, text);
  }
  const selection = makeFakeView(cm, `${TASK}\n  - ****`, `${TASK}\n  - ****`.length - 2);
  selection.anchor = 0;
  assert.equal(selection.backspace(), false);
});

test("Backspace after the expansion removes the marker whole", () => {
  const view = makeFakeView(makeFakeCm(), ELIGIBLE, ELIGIBLE.length);
  view.type("*");
  view.defaultBackspace();
  assert.equal(view.text, ELIGIBLE);
});

test("smart Enter steps over `**` and opens a nested note", () => {
  const base = `${TASK}\n  - **API Design**`;
  const caret = base.length - 2;
  const plan = drawerTypingEnterPlan(base, 1, caret - (`${TASK}\n`.length));
  assert.deepEqual(plan, { nestedPrefix: "    - " });
  const view = makeFakeView(makeFakeCm(), base, caret);
  assert.equal(view.pressEnter(), true);
  assert.equal(view.text, `${TASK}\n  - **API Design**\n    - `);
  assert.equal(view.head, view.text.length);
});

test("Enter keeps tabs and falls through elsewhere", () => {
  const base = `${TASK}\n\t- **Café**`;
  const caret = base.length - 2;
  assert.deepEqual(drawerTypingEnterPlan(base, 1, caret - (`${TASK}\n`.length)), { nestedPrefix: "\t  - " });
  const cm = makeFakeCm();
  for (const [text, at] of [
    [`${TASK}\n  - **API Design**`, `${TASK}\n  - **API`.length],
    [`${TASK}\n  - **API Design**`, 0],
    [`${TASK}\n  - note`, `${TASK}\n  - note`.length],
    [`${TASK}\n  - `, `${TASK}\n  - `.length],
  ]) {
    const view = makeFakeView(cm, text, at);
    assert.equal(view.pressEnter(), false, text);
    assert.equal(view.text, text, text);
  }
});

test("the assist never fires in the wrong places", () => {
  const cm = makeFakeCm();
  const cases = [
    ["- just a bullet\n  - ", 20],
    [`${TASK}\n  - note`, `${TASK}\n  - note`.length],
    [`${TASK}\n  - [ ] req`, `${TASK}\n  - [ ] req`.length],
    [`${TASK}\n> - `, `${TASK}\n> - `.length],
    ["```\n  - \n```", 7],
    ["---\n  - \n---\nbody", 7],
  ];
  for (const [text, caret] of cases) {
    const view = makeFakeView(cm, text, caret);
    assert.equal(view.type("*"), false, text);
    assert.equal(view.transactions.length, 1, text);
  }
  // Ordinary italic in a paragraph pairs through the autopair stub.
  const italic = makeFakeView(cm, "hello ", 6);
  assert.equal(italic.type("*", { autopair: true }), false);
  assert.equal(italic.text, "hello **");
  // A selection or composition declines.
  const selected = makeFakeView(cm, ELIGIBLE, ELIGIBLE.length);
  selected.anchor = 0;
  assert.equal(selected.type("*"), false);
  const composing = makeFakeView(cm, ELIGIBLE, ELIGIBLE.length);
  composing.composing = true;
  assert.equal(composing.type("*"), false);
});

// --- Toggle Drawer ---------------------------------------------------------

function makePlugin(path = "Daily.md") {
  notices.length = 0;
  const { app } = createInMemoryObsidianApp({ [path]: "" });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    ...app,
    workspace: {
      getActiveFile: () => ({ path }),
      getActiveViewOfType: () => null,
    },
    commands: { commands: {}, executeCommandById: () => false },
  };
  return plugin;
}

function toggleAt(text, line, ch) {
  const plugin = makePlugin();
  const editor = createTextEditor(text, { line, ch });
  const view = Object.assign(new MarkdownView(), { editor, file: { path: "Daily.md" } });
  notices.length = 0;
  const handled = plugin.cyclerDrawerToggleRoute(editor, false);
  return { plugin, editor, handled, text: editor.getValue(), cursor: editor.getCursor() };
}

test("Toggle Drawer wraps a plain bullet and keeps its bytes", () => {
  const text = `${TASK}\n  - API Design\n    - nested stays`;
  const { handled, text: updated, cursor } = toggleAt(text, 1, 5);
  assert.equal(handled, true);
  assert.deepEqual(updated.split("\n"), [`${TASK}`, "  - **API Design**", "    - nested stays"]);
  assert.equal(cursor.line, 1);
});

test("Toggle Drawer unwraps a header to its plain title", () => {
  const text = `${TASK}\n  - **API Design**\n    - nested stays`;
  const { handled, text: updated } = toggleAt(text, 1, 8);
  assert.equal(handled, true);
  assert.deepEqual(updated.split("\n"), [TASK, "  - API Design", "    - nested stays"]);
});

test("wrapping keeps ALL-CAPS without recasing", () => {
  const text = `${TASK}\n  - NOTES`;
  const result = planDrawerToggle(text, 1, 5);
  assert.equal(result.ok, true);
  assert.equal(result.wrapped, true);
  assert.equal(result.title, "NOTES");
  assert.equal(result.updated, `${TASK}\n  - **NOTES**`);
});

test("Toggle Drawer refuses with a notice and no write", () => {
  // Checkbox lines stay requirements/tasks.
  const checkbox = toggleAt(`${TASK}\n  - [ ] req`, 1, 8);
  assert.equal(checkbox.handled, true);
  assert.equal(checkbox.text, `${TASK}\n  - [ ] req`);
  assert.match(notices[0], /plain bullet/);
  // Reserved names refuse.
  const reserved = planDrawerToggle(`${TASK}\n  - TASKS`, 1, 5);
  assert.equal(reserved.ok, false);
  assert.match(reserved.message, /reserved/);
  // Trailing-colon and empty titles refuse.
  assert.equal(planDrawerToggle(`${TASK}\n  - Title:`, 1, 5).ok, false);
  assert.equal(planDrawerToggle(`${TASK}\n  - `, 1, 4).ok, false);
  // Managed lines refuse.
  assert.equal(planDrawerToggle(`${TASK}\n  - **DEPENDS ON** x`, 1, 5).ok, false);
  // Deeper positions refuse, including through the command route.
  assert.equal(planDrawerToggle(`${TASK}\n  - note\n    - deep`, 2, 8).ok, false);
  const deeper = toggleAt(`${TASK}\n  - note\n    - deep`, 2, 8);
  assert.equal(deeper.handled, true);
  assert.equal(deeper.text, `${TASK}\n  - note\n    - deep`);
  assert.match(notices[0], /direct child/);
  // A refusal leaves the note untouched through the route too.
  const before = `${TASK}\n  - TASKS`;
  const refused = toggleAt(before, 1, 5);
  assert.equal(refused.handled, true);
  assert.equal(refused.text, before);
  assert.match(notices[0], /reserved/);
});

test("Toggle Drawer falls through outside drawer positions", () => {
  const plugin = makePlugin();
  const editor = createTextEditor("hello", { line: 0, ch: 2 });
  assert.equal(plugin.cyclerDrawerToggleRoute(editor, true), false);
  assert.equal(plugin.cyclerDrawerToggleRoute(editor, false), false);
  // Checking claims eligible positions without writing.
  const eligible = createTextEditor(ELIGIBLE, { line: 1, ch: 4 });
  assert.equal(plugin.cyclerDrawerToggleRoute(eligible, true), true);
  assert.equal(eligible.getValue(), ELIGIBLE);
});

test("registerCyclerDrawerTyping skips silently without CodeMirror", () => {
  const { app } = createInMemoryObsidianApp({});
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = app;
  const registered = [];
  plugin.registerEditorExtension = (extension) => registered.push(extension);
  // The harness resolves no @codemirror/state at runtime, so the loader finds
  // no pieces and the extension is skipped, not thrown.
  assert.doesNotThrow(() => plugin.registerCyclerDrawerTyping());
  assert.deepEqual(registered, []);
  const bare = new TaskStatusCyclerPlugin();
  assert.equal(bare.registerCyclerDrawerTyping(), false);
});
