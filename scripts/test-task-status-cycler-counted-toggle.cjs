const test = require("node:test");
const assert = require("node:assert/strict");
const {
  helpers,
  notices,
  noteLines,
  findPromptHeading,
  openDemotionPicker,
  acceptPickerDestination,
  acceptSelectedPickerRow,
} = require("./task-status-cycler-harness.cjs");

const DATE = "2026-10-14";
const task = (name) => "- [ ] #task " + name;
const promoted = (name) => task(name) + " [created::" + DATE + "]";
const rangePlan = (lines, activeLine = 2, additional = 3, ch = 8) =>
  helpers.getObsidianTaskToggleRangeDocumentPlan(lines, activeLine, ch, DATE, additional);
const rangeItems = (lines, activeLine = 0, additional = 99) =>
  helpers.collectObsidianTaskToggleRangeItems(lines, activeLine, additional);
const indices = (...args) => rangeItems(...args).map((item) => item.line);
const existing = (prompt, title) => ({
  kind: "existing",
  heading: findPromptHeading(prompt, title),
});
const resolve = (prompt, destination) =>
  helpers.resolveObsidianTaskPromptDestination(prompt, destination);

function setup(lines, activeLine = 2, ch = 8) {
  const harness = openDemotionPicker(lines.join("\n"), { line: activeLine, ch });
  harness.plugin.getCreatedDateString = () => DATE;
  const replace = harness.editor.replaceRange;
  harness.writes = [];
  harness.editor.replaceRange = (...args) => {
    harness.writes.push(args);
    return replace(...args);
  };
  harness.toggle = (additional = 3) => harness.plugin.toggleActiveObsidianTask(
    harness.editor,
    harness.plugin.getActiveObsidianTaskToggle(harness.editor, additional),
    harness.view,
  );
  return harness;
}

function registerVimAction(plugin, view) {
  const actions = new Map();
  const mappings = [];
  const oldWindow = global.window;
  global.window = {
    CodeMirrorAdapter: {
      Vim: {
        defineAction: (name, handler) => actions.set(name, handler),
        mapCommand: (...args) => mappings.push(args),
      },
    },
  };
  plugin.app = { workspace: { getActiveViewOfType: () => view } };
  try {
    assert.equal(plugin.registerVimMappings(), true);
  } finally {
    if (oldWindow === undefined) delete global.window;
    else global.window = oldWindow;
  }
  const name = "taskStatusCyclerToggleObsidianTask";
  assert.deepEqual(
    mappings.filter((mapping) => mapping[2] === name).map((mapping) => mapping[0]),
    ["<C-}>", "<C-S-]>"],
  );
  return actions.get(name);
}

function attachPendingCount(editor, digits = "3", mode = "normal") {
  const inputState = {
    prefixRepeat: digits.split(""),
    motionRepeat: [],
    keyBuffer: [],
    operator: "test-operator",
    reason: "",
    getRepeat() { return Number(this.prefixRepeat.join("")) || 0; },
  };
  const cm = {
    getCursor: editor.getCursor,
    getLine: editor.getLine,
    replaceRange: editor.replaceRange,
    setCursor: editor.setCursor,
    state: { vim: { mode, inputState } },
  };
  editor.cm = { cm };
  return inputState;
}

function nodesWithClass(node, className) {
  return [
    ...(node.classes.includes(className) ? [node] : []),
    ...node.children.flatMap((child) => nodesWithClass(child, className)),
  ];
}

test("range planner preserves every single-item mode without an effective count", () => {
  const cases = [
    [noteLines(), 2], // demotion prompt
    [["## Ideas", "", "- A", "## Tasks"], 2], // promotion prompt
    [["## Tasks", "", "- A"], 2], // same-source promotion
    [["## Ideas", "", task("A"), "## Notes"], 2], // next-section move
    [["## Ideas", "", task("A")], 2], // in-place demotion
    [["## Ideas", "", "- A"], 2], // in-place promotion
    [["- parent", "\t- [ ] #task A"], 1], // nested
    [["* A"], 0], // non-dash
    [["paragraph"], 0], // ineligible
  ];
  for (const [lines, line] of cases) {
    const single = helpers.getObsidianTaskToggleDocumentPlan(lines, line, 8, DATE);
    for (const additional of [undefined, 0, -1, 1.5, NaN, "3", 99]) {
      assert.deepEqual(
        helpers.getObsidianTaskToggleRangeDocumentPlan(lines, line, 8, DATE, additional),
        single,
      );
    }
  }
  const mixed = noteLines({ taskLines: [task("A"), "- plain", "- [ ] checklist"] });
  assert.deepEqual(rangePlan(mixed), helpers.getObsidianTaskToggleDocumentPlan(mixed, 2, 8, DATE));
});

test("item counts carry children, skip blank lines and loose continuations, and clamp", () => {
  const lines = [
    "- A", "\t- child", "\t\t- grandchild", "", "\tloose continuation",
    "", "- B", "\t- child B", "", "- C", "- D",
  ];
  assert.deepEqual(rangeItems(lines, 0, 1), [
    { line: 0, block: { startLine: 0, endLine: 2 } },
    { line: 6, block: { startLine: 6, endLine: 7 } },
  ]);
  assert.deepEqual(indices(lines), [0, 6, 9, 10]);
  assert.deepEqual(indices(lines, 6, 1), [6, 9]);
  assert.deepEqual(indices(lines, 0, 0), [0]);
  for (const invalid of [-1, 100, 0.5]) assert.deepEqual(rangeItems(lines, invalid), []);
  assert.deepEqual(rangeItems(["paragraph"]), []);
  assert.deepEqual(rangeItems(null), []);
});

test("range stops at headings, shallower lines, same-level paragraphs and fences", () => {
  for (const boundary of ["## Next", "   ### Child heading", "paragraph", "~~~"]) {
    assert.deepEqual(indices(["- A", "", boundary, "- B"]), [0], boundary);
  }
  assert.deepEqual(indices(["  - A", "    - child", "  - B", "- parent", "  - C"]), [0, 2]);
  assert.deepEqual(indices(["  - A", "", "shallower paragraph", "  - B"]), [0]);
  assert.deepEqual(indices(["  - A", " \t- different prefix", "  - B"]), [0]);
});

test("siblings require the exact whitespace and blockquote prefix", () => {
  assert.deepEqual(indices([
    "> - A", ">   - child", "", "> continuation", "> - B",
  ]), [0]);
  assert.deepEqual(indices([
    "> - A", ">   - child", "", "> - B", ">> - deeper", "> - C", "- outside", "> - D",
  ]), [0, 3, 5]);
  assert.deepEqual(indices([
    "  > - A", "  > - B", "  >\t- other prefix", "  > - C",
  ]), [0, 1]);
});

test("counted demotion moves four complete blocks to one existing section", () => {
  const lines = noteLines({
    taskLines: [
      task("A"), "\t- ⛓️ **DEPENDS ON:** [[#^prereq]]",
      "\t- 🛠️ **WORK LOG**", "\t\t- Earlier work",
      task("B"), "\t- B child", task("C"), task("D"), task("E"),
    ],
    extraLines: ["", "## Notes", "", "- Existing", "\t- Existing child", ""],
  });
  const prompt = rangePlan(lines);
  assert.equal(prompt.itemCount, 4);
  assert.deepEqual(prompt.previewLines, ["- A", "- B", "- C", "- D"]);
  assert.equal(prompt.previewText, "- A\n- B\n- C\n- D");
  const moved = resolve(prompt, existing(prompt, "Notes"));
  assert.deepEqual(moved.nextLines, [
    "## Tasks", "", task("E"), "", "## Notes", "", "- Existing", "\t- Existing child",
    "- A", "\t- ⛓️ **DEPENDS ON:** [[#^prereq]]", "\t- 🛠️ **WORK LOG**",
    "\t\t- Earlier work", "- B", "\t- B child", "- C", "- D", "",
  ]);
  assert.deepEqual([moved.cursorLine, moved.cursorCh], [8, 2]);
  for (const destination of [
    { kind: "create", title: "Tasks" },
    { kind: "existing", heading: { line: 0, depth: 2, title: "Tasks" } },
  ]) {
    assert.equal(helpers.resolveObsidianTaskDemotionDestination(prompt, destination), null);
  }
  const harness = setup(lines);
  assert.equal(harness.toggle(), true);
  assert.equal(harness.writes.length, 0);
  assert.equal(acceptPickerDestination(harness.plugin, existing(prompt, "Notes")), true);
  assert.equal(harness.editor.getValue(), moved.nextLines.join("\n"));
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.editor.getCursor(), { line: 8, ch: 2 });
  assert.deepEqual(harness.centered, [{ line: 8, ch: 2, sameEditor: true }]);
});

test("counted demotion creates a typed section or one default Requirements section", () => {
  for (const title of ["Future Work", "Requirements"]) {
    const lines = noteLines({ taskLines: [task("A"), "\t- child", task("B"), task("C"), task("D")] });
    const harness = setup(lines);
    harness.toggle();
    if (title === "Requirements") assert.equal(acceptSelectedPickerRow(harness.plugin), true);
    else {
      const picker = harness.plugin.demotionSectionPicker;
      picker.inputEl.value = title;
      picker.inputEl.dispatchEvent("input");
      assert.equal(acceptSelectedPickerRow(harness.plugin), true);
    }
    assert.equal(harness.editor.getValue(), [
      "## Tasks", "", "## " + title, "", "- A", "\t- child", "- B", "- C", "- D",
    ].join("\n"));
    assert.equal(harness.writes.length, 1);
    assert.deepEqual(harness.editor.getCursor(), { line: 4, ch: 2 });
  }
});

test("bottom-up removal splices blank seams and maps destinations before the source", () => {
  const lines = [
    "## Notes", "", "- Existing", "", "## Tasks", "",
    task("A"), "", task("B"), "", task("C"), "", "## Later",
  ];
  const prompt = rangePlan(lines, 6, 99);
  const removal = helpers.removeSourceBlockForTaskPrompt(prompt);
  assert.equal(removal.splicedSeam, true);
  assert.equal(removal.mapOriginalLine(12), 6);
  const moved = resolve(prompt, existing(prompt, "Notes"));
  assert.deepEqual(moved.nextLines, [
    "## Notes", "", "- Existing", "- A", "- B", "- C", "", "## Tasks", "", "## Later",
  ]);
});

test("counted promotion Enter appends tasks in order and removes an emptied source section", () => {
  const lines = [
    "## Ideas", "", "- A", "\t- child", "", "- B", "", "- C", "",
    "## Tasks", "", task("Existing"), "", "## Notes",
  ];
  const harness = setup(lines, 2, 2);
  harness.toggle(99);
  const prompt = harness.plugin.demotionSectionPicker.snapshot.plan;
  assert.equal(prompt.itemCount, 3);
  assert.deepEqual(prompt.previewLines, ["- A", "- B", "- C"]);
  assert.equal(acceptSelectedPickerRow(harness.plugin), true);
  assert.equal(harness.editor.getValue(), [
    "## Tasks", "", task("Existing"), promoted("A"), "\t- child", promoted("B"), promoted("C"),
    "", "## Notes",
  ].join("\n"));
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.editor.getCursor(), { line: 3, ch: 12 });
});

test("counted promotion to existing or new non-Tasks destinations keeps all bullets plain", () => {
  const lines = ["## Ideas", "", "- A", "\t- child", "- B", "## Tasks", "", "## Notes", "", "- Existing"];
  const prompt = rangePlan(lines, 2, 1, 2);
  const moved = resolve(prompt, existing(prompt, "Notes"));
  assert.deepEqual(moved.nextLines, [
    "## Tasks", "", "## Notes", "", "- Existing", "- A", "\t- child", "- B",
  ]);
  assert.equal(moved.cursorCh, 2);
  const created = resolve(prompt, { kind: "create", title: "Future Work" });
  assert.deepEqual(created.nextLines, [
    "## Tasks", "", "## Notes", "", "- Existing", "", "## Future Work", "", "- A", "\t- child", "- B",
  ]);
  assert.equal(created.cursorCh, 2);
});

test("same-source Tasks promotion rewrites all selected lines in place", () => {
  const lines = noteLines({ taskLines: ["- A", "\t- child", task("Existing"), "- B", "- C"] });
  const harness = setup(lines, 2, 2);
  harness.toggle(2);
  assert.equal(acceptSelectedPickerRow(harness.plugin), true);
  assert.equal(harness.editor.getValue(), [
    "## Tasks", "", promoted("A"), "\t- child", task("Existing"), promoted("B"), "- C",
  ].join("\n"));
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.editor.getCursor(), { line: 2, ch: 12 });
});

test("counted demotion outside Tasks moves to the next section in one write", () => {
  const lines = [
    "## Ideas", "", task("A"), "\t- child", task("B"), "", "## Notes", "", "- Existing", "",
  ];
  const harness = setup(lines);
  assert.equal(harness.toggle(99), true);
  assert.equal(harness.editor.getValue(), [
    "## Ideas", "", "## Notes", "", "- Existing", "- A", "\t- child", "- B", "",
  ].join("\n"));
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.plugin.demotionSectionPicker, undefined);
  assert.deepEqual(harness.centered, [{ line: 5, ch: 2, sameEditor: true }]);
});

test("in-place ranges write once without centering for nested, non-dash, and unrouted items", () => {
  const cases = [
    [["## Notes", "", task("A"), task("B")], 2, ["## Notes", "", "- A", "- B"]],
    [["- A", "\t- child", "- B"], 0, [promoted("A"), "\t- child", promoted("B")]],
    [["- parent", "\t- A", "\t\t- child", "\t- B", "- sibling"], 1,
      ["- parent", "\t" + promoted("A"), "\t\t- child", "\t" + promoted("B"), "- sibling"]],
    [["## Tasks", "* [ ] #task A", "+ [ ] #task B", "1. [ ] #task C"], 1,
      ["## Tasks", "* A", "+ B", "1. C"]],
  ];
  for (const [lines, line, expected] of cases) {
    const harness = setup(lines, line, 0);
    assert.equal(rangePlan(lines, line, 99, 0).mode, "replaceLines");
    assert.equal(harness.toggle(99), true);
    assert.equal(harness.editor.getValue(), expected.join("\n"));
    assert.equal(harness.writes.length, 1);
    assert.deepEqual(harness.centered, []);
    assert.deepEqual(harness.editor.getCursor(), { line, ch: 0 });
  }
});

test("mixed demotion ranges count unchanged siblings and only move top-level dash tasks", () => {
  const lines = noteLines({
    taskLines: [task("A"), "- plain", "\t- untouched", "- [ ] checklist", task("B"), task("C"), "* [ ] #task star"],
    extraLines: ["## Notes"],
  });
  const prompt = rangePlan(lines);
  assert.equal(prompt.itemCount, 2);
  assert.deepEqual(resolve(prompt, existing(prompt, "Notes")).nextLines, [
    "## Tasks", "", "- plain", "\t- untouched", "- [ ] checklist", task("C"), "* [ ] #task star",
    "## Notes", "", "- A", "- B",
  ]);
  assert.equal(rangePlan(lines, 2, 99).itemCount, 3);
});

test("mixed promotion preserves existing tasks and a nonempty source section", () => {
  const lines = ["## Ideas", "", "- A", task("Existing"), "- B", "* skipped", "## Tasks"];
  const prompt = rangePlan(lines, 2, 99, 2);
  assert.equal(prompt.itemCount, 2);
  assert.deepEqual(resolve(prompt, existing(prompt, "Tasks")).nextLines, [
    "## Ideas", "", task("Existing"), "* skipped", "## Tasks", "", promoted("A"), promoted("B"),
  ]);
});

test("Vim action consumes explicit additional-item counts and preserves bare behavior", () => {
  const lines = noteLines({ taskLines: [task("A"), "\t- child", task("B"), task("C"), task("D"), task("E")] });
  for (const explicit of [true, false]) {
    const harness = setup(lines);
    const action = registerVimAction(harness.plugin, harness.view);
    action({}, { repeat: explicit ? 3 : 1, repeatIsExplicit: explicit });
    const picker = harness.plugin.demotionSectionPicker;
    assert.ok(picker);
    assert.equal(picker.snapshot.plan.itemCount, explicit ? 4 : undefined);
    action({}, { repeat: 3, repeatIsExplicit: true });
    assert.equal(harness.plugin.demotionSectionPicker, picker);
    assert.equal(harness.writes.length, 0);
    assert.equal(acceptSelectedPickerRow(harness.plugin), true);
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.editor.getValue(), (
      explicit
        ? ["## Tasks", "", task("E"), "", "## Requirements", "", "- A", "\t- child", "- B", "- C", "- D"]
        : ["## Tasks", "", task("B"), task("C"), task("D"), task("E"), "", "## Requirements", "", "- A", "\t- child"]
    ).join("\n"));
  }
  assert.equal(helpers.getExplicitVimAdditionalCount(), 0);
  assert.equal(helpers.getExplicitVimAdditionalCount({ repeat: 1, repeatIsExplicit: true }), 1);
  assert.equal(helpers.getExplicitVimAdditionalCount({ repeat: 3 }), 3);
  assert.equal(helpers.getPomodoroMoveOnlyAdditionalLines({ repeat: 3 }), 3);
});

test("command checking preserves pending count; execution consumes it once and resets Vim", () => {
  const harness = setup(noteLines({ taskLines: [task("A"), task("B"), task("C"), task("D")] }));
  const input = attachPendingCount(harness.editor);
  assert.equal(harness.plugin.handleToggleObsidianTaskCommand(true, harness.editor, harness.view), true);
  assert.deepEqual(input.prefixRepeat, ["3"]);
  assert.equal(input.operator, "test-operator");
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.plugin.demotionSectionPicker, undefined);

  assert.equal(harness.plugin.handleToggleObsidianTaskCommand(false, harness.editor, harness.view), true);
  assert.equal(harness.plugin.demotionSectionPicker.snapshot.plan.itemCount, 4);
  assert.deepEqual(input.prefixRepeat, []);
  assert.deepEqual(input.keyBuffer, []);
  assert.equal(input.operator, null);
  assert.equal(input.reason, "counted-toggle-obsidian-task");
  assert.equal(harness.plugin.consumePendingObsidianTaskToggleCount(harness.editor, harness.view), 0);
  assert.equal(acceptSelectedPickerRow(harness.plugin), true);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.editor.getValue(), "## Tasks\n\n## Requirements\n\n- A\n- B\n- C\n- D");
});

test("command route stays single without normal-mode explicit count and supports in-place ranges", () => {
  for (const kind of ["no cm", "bare", "insert"]) {
    const harness = setup(["- A", "- B"], 0, 2);
    const input = kind === "no cm" ? null : attachPendingCount(
      harness.editor, kind === "bare" ? "" : "3", kind === "insert" ? "insert" : "normal",
    );
    assert.equal(harness.plugin.handleToggleObsidianTaskCommand(false, harness.editor, harness.view), true);
    assert.equal(harness.editor.getValue(), promoted("A") + "\n- B");
    if (input) assert.equal(input.operator, "test-operator", "nonexplicit or non-normal input is untouched");
  }
  const harness = setup(["- A", "- B", "- C"], 0, 2);
  attachPendingCount(harness.editor, "1");
  harness.plugin.handleToggleObsidianTaskCommand(false, harness.editor, harness.view);
  assert.equal(harness.editor.getValue(), [promoted("A"), promoted("B"), "- C"].join("\n"));
  assert.equal(harness.writes.length, 1);
});

test("picker displays at most five preview rows plus overflow; single picker is unchanged", () => {
  const lines = noteLines({ taskLines: ["A", "B", "C", "D", "E", "F", "G"].map(task) });
  for (const additional of [0, 1, 6]) {
    const harness = setup(lines);
    harness.toggle(additional);
    const picker = harness.plugin.demotionSectionPicker;
    const title = nodesWithClass(picker.contentEl, "tsc-sdp-title")[0].textContent;
    const previews = nodesWithClass(picker.contentEl, "tsc-sdp-preview-text").map((node) => node.textContent);
    if (additional === 0) {
      assert.equal(title, "Move bullet to section");
      assert.deepEqual(previews, ["- A"]);
      assert.equal(picker.previewEl.textContent, "- A");
    } else {
      assert.equal(title, "Move " + (additional + 1) + " bullets to section");
      assert.deepEqual(previews, additional === 1 ? ["- A", "- B"] : ["- A", "- B", "- C", "- D", "- E", "+2 more"]);
    }
  }
});

test("stale counted picker and cancelled picker never write", () => {
  const lines = noteLines({ taskLines: [task("A"), task("B")] });
  const harness = setup(lines);
  harness.toggle(1);
  harness.editor.replaceRange("changed", { line: 2, ch: 12 });
  const changed = harness.editor.getValue();
  harness.writes.length = 0;
  notices.length = 0;
  assert.equal(acceptSelectedPickerRow(harness.plugin), false);
  assert.equal(harness.editor.getValue(), changed);
  assert.equal(harness.writes.length, 0);
  assert.match(notices[0], /note changed/i);
  assert.equal(harness.plugin.demotionSectionPicker, null);

  const cancelled = setup(lines);
  cancelled.toggle(1);
  cancelled.plugin.demotionSectionPicker.close();
  assert.equal(cancelled.editor.getValue(), lines.join("\n"));
  assert.equal(cancelled.writes.length, 0);
});

test("counted moves round-trip CRLF and preserve the presence or absence of a final newline", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const finalNewline of [false, true]) {
      const lines = noteLines({ taskLines: [task("A"), "\t- child", task("B")] });
      if (finalNewline) lines.push("");
      const { plugin, editor, view, centered } = openDemotionPicker(
        lines.join(newline), { line: 2, ch: 8 },
      );
      // CodeMirror accepts LF in replaceRange and serializes with the
      // document's line separator. Model that contract in the string editor.
      const replace = editor.replaceRange;
      let writes = 0;
      editor.replaceRange = (text, ...positions) => {
        writes += 1;
        replace(text.replace(/\r?\n/g, newline), ...positions);
      };
      plugin.toggleActiveObsidianTask(editor, plugin.getActiveObsidianTaskToggle(editor, 1), view);
      assert.equal(acceptSelectedPickerRow(plugin), true);
      const expected = ["## Tasks", "", "## Requirements", "", "- A", "\t- child", "- B"];
      if (finalNewline) expected.push("");
      assert.equal(editor.getValue(), expected.join(newline));
      assert.equal(writes, 1);
      assert.deepEqual(editor.getCursor(), { line: 4, ch: 2 });
      assert.deepEqual(centered, [{ line: 4, ch: 2, sameEditor: true }]);
    }
  }
});
