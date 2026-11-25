// o / O open-line planner (bob-cli-q4.2): siblings after the whole subtree,
// intake-end inside status groups, ^prj intake, managed-line note redirect,
// empty-scaffold prune, and Ctrl+Shift+] managed refusal.
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
  planOpenLine,
  applyOpenLinePlanToLines,
  pruneOpenLineScaffold,
  openLineClassify,
  openLineManagedRefuse,
  formatOpenLineTaskLine,
  OPEN_LINE_MANAGED_NOTICE,
  OPEN_LINE_PRJ_NO_TASKS_NOTICE,
} = helpers;

const TODAY = "2026-11-25";
const NEW_TASK = formatOpenLineTaskLine("", TODAY);
const TASK_CARET = "- [ ] #task ".length;

function linesOf(text) {
  return String(text).split(/\r?\n/);
}

function lineIndex(text, needle) {
  const index = linesOf(text).findIndex((line) => line.includes(needle));
  assert.ok(index >= 0, `missing ${JSON.stringify(needle)}`);
  return index;
}

function apply(text, plan) {
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  return applyOpenLinePlanToLines(linesOf(text), plan).join(ending);
}

function fullBlock(unit) {
  const t = unit;
  const t2 = unit + unit;
  const t3 = unit + unit + unit;
  return [
    "- [ ] #task Ship",
    `${t}- ❌ **CANCEL LOG**`,
    `${t2}- *2026-01-01* — first reason`,
    `${t}- ⛓️ **DEPENDS ON:** [[#^dep|Dep]]`,
    `${t}- 🧱 **BLOCKS:** [[#^blk|Blk]]`,
    `${t}- 🪢 **LINKS:** [[#^rel|Rel]]`,
    `${t}- [ ] top req`,
    `${t2}- [ ] nested req`,
    `${t}- [ ] #task Nested`,
    `${t2}- [ ] nested-req`,
    `${t}- a loose note`,
    `${t2}- deeper note`,
    `${t}- NOTES`,
    `${t2}- filed note`,
    `${t3}- deeper filed`,
    `${t}- 🗓️ **SCHEDULE LOG**`,
    `${t2}- *2026-01-02* — nudged`,
    `${t}- 🛠️ **WORK LOG**`,
    `${t2}- *2026-01-03 09:00* — 25m`,
  ].join("\n");
}

function groupedNote() {
  return [
    "## Tasks",
    "",
    "- [ ] #task Intake",
    "\t- [ ] intake req",
    "",
    "### Next & In Progress",
    "",
    "- [ ] #task Grouped",
    "\t- [ ] grouped req",
    "",
    "### Blocked",
    "",
    "- [ ] #task Blocked one",
    "",
    "### Done & Canceled",
    "",
    "- [x] #task Done one",
  ].join("\n");
}

function prjNote(withTasks) {
  const head = ["- [ ] #task Project ^prj", "", "# Project", ""];
  if (!withTasks) return head.concat(["Some prose."]).join("\n");
  return head.concat([
    "## Tasks",
    "",
    "- [ ] #task Resident",
    "\t- [ ] req",
    "",
    "### Next & In Progress",
    "",
    "- [ ] #task Next resident",
  ]).join("\n");
}

function assertInsert(plan, expected) {
  assert.equal(plan.kind, "insert", JSON.stringify(plan));
  if (expected.insertBeforeLine !== undefined) {
    assert.equal(plan.insertBeforeLine, expected.insertBeforeLine);
  }
  if (expected.lines) assert.deepEqual(plan.lines, expected.lines);
  if (expected.cursorCh !== undefined) assert.equal(plan.cursorCh, expected.cursorCh);
  if (expected.cursorLine !== undefined) assert.equal(plan.cursorLine, expected.cursorLine);
  if (expected.recordJump !== undefined) assert.equal(plan.recordJump, expected.recordJump);
  if (expected.originLine !== undefined) assert.equal(plan.originLine, expected.originLine);
  if (expected.scaffoldKind) assert.equal(plan.scaffold.kind, expected.scaffoldKind);
  if (expected.createdDrawer !== undefined) assert.equal(plan.createdDrawer, expected.createdDrawer);
}

function makePlugin(path = "Daily.md") {
  notices.length = 0;
  const { app } = createInMemoryObsidianApp({ [path]: "" });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.enterVimInsertMode = () => {};
  plugin.app = {
    ...app,
    workspace: {
      getActiveFile: () => ({ path }),
      getActiveViewOfType: () => ({ file: { path } }),
    },
    plugins: { plugins: {} },
    commands: { commands: {}, executeCommandById: () => false },
  };
  return plugin;
}

function wrapEditor(text, cursor) {
  const editor = createTextEditor(text, cursor);
  const listeners = {};
  const setCursor = editor.setCursor.bind(editor);
  editor.setCursor = (line, ch) => {
    setCursor(typeof line === "object" ? line : { line, ch });
  };
  editor.on = (name, fn) => {
    (listeners[name] || (listeners[name] = [])).push(fn);
  };
  editor.off = (name, fn) => {
    listeners[name] = (listeners[name] || []).filter((item) => item !== fn);
  };
  editor.emit = (name, args) => {
    for (const fn of listeners[name] || []) fn(args);
  };
  return editor;
}

for (const unit of ["\t", "  "]) {
  const label = unit === "\t" ? "tab" : "two-space";
  test(`headline o/O with every child zone (${label} indent)`, () => {
    const text = fullBlock(unit);
    const origin = 0;
    const last = linesOf(text).length - 1;
    const below = planOpenLine(text, origin, "below", TODAY);
    assertInsert(below, {
      insertBeforeLine: last + 1,
      lines: [NEW_TASK],
      cursorCh: TASK_CARET,
      recordJump: false,
      scaffoldKind: "task",
    });
    const applied = apply(text, below);
    assert.equal(linesOf(applied)[last + 1], NEW_TASK);
    assert.equal(linesOf(applied).slice(0, last + 1).join("\n"), text);

    const above = planOpenLine(text, origin, "above", TODAY);
    assertInsert(above, {
      insertBeforeLine: 0,
      lines: [NEW_TASK],
      cursorCh: TASK_CARET,
      recordJump: false,
    });
    assert.equal(linesOf(apply(text, above))[1], "- [ ] #task Ship");
  });
}

test("req leaf and req with a subtree open siblings, never copying marks", () => {
  const text = [
    "- [ ] #task Ship",
    "\t- [-] dropped",
    "\t- [>] carried [[#^abc|A]]",
    "\t\t- child of carried",
    "\t- [x] met",
  ].join("\n");
  const leaf = planOpenLine(text, lineIndex(text, "dropped"), "below", TODAY);
  assertInsert(leaf, {
    insertBeforeLine: lineIndex(text, "dropped") + 1,
    lines: ["\t- [ ] "],
    cursorCh: "\t- [ ] ".length,
    scaffoldKind: "req",
  });
  const subtree = planOpenLine(text, lineIndex(text, "carried"), "below", TODAY);
  assertInsert(subtree, {
    insertBeforeLine: lineIndex(text, "child of carried") + 1,
    lines: ["\t- [ ] "],
  });
  const above = planOpenLine(text, lineIndex(text, "met"), "above", TODAY);
  assertInsert(above, {
    insertBeforeLine: lineIndex(text, "met"),
    lines: ["\t- [ ] "],
  });
  assert.ok(!leaf.lines[0].includes("[-]"));
  assert.ok(!subtree.lines[0].includes("[>]"));
});

test("nested task, drawer header, and drawer child open siblings after the subtree", () => {
  const text = fullBlock("\t");
  const nested = planOpenLine(text, lineIndex(text, "#task Nested"), "below", TODAY);
  assertInsert(nested, {
    insertBeforeLine: lineIndex(text, "nested-req") + 1,
    lines: [formatOpenLineTaskLine("\t", TODAY)],
    cursorCh: "\t- [ ] #task ".length,
    scaffoldKind: "task",
  });
  const nestedAbove = planOpenLine(text, lineIndex(text, "#task Nested"), "above", TODAY);
  assertInsert(nestedAbove, {
    insertBeforeLine: lineIndex(text, "#task Nested"),
    lines: [formatOpenLineTaskLine("\t", TODAY)],
  });

  const drawer = planOpenLine(text, lineIndex(text, "- NOTES"), "below", TODAY);
  assertInsert(drawer, {
    insertBeforeLine: lineIndex(text, "deeper filed") + 1,
    lines: ["\t- "],
    cursorCh: "\t- ".length,
    scaffoldKind: "note",
  });
  const filed = planOpenLine(text, lineIndex(text, "filed note"), "below", TODAY);
  assertInsert(filed, {
    insertBeforeLine: lineIndex(text, "deeper filed") + 1,
    lines: ["\t\t- "],
  });
});

test("each managed line redirects to the owner's note slot", () => {
  const text = fullBlock("\t");
  const needles = [
    "CANCEL LOG",
    "first reason",
    "DEPENDS ON",
    "BLOCKS",
    "LINKS",
    "SCHEDULE LOG",
    "nudged",
    "WORK LOG",
    "25m",
  ];
  for (const needle of needles) {
    const origin = lineIndex(text, needle);
    assert.equal(openLineClassify(text, origin).kind, "managed", needle);
    const below = planOpenLine(text, origin, "below", TODAY);
    const above = planOpenLine(text, origin, "above", TODAY);
    assert.equal(below.kind, "insert", needle);
    assert.equal(below.scaffold.kind, "note", needle);
    assert.deepEqual(below.lines, above.lines, needle);
    assert.equal(below.insertBeforeLine, above.insertBeforeLine, needle);
    const applied = apply(text, below);
    assert.ok(
      applied.includes("- NOTES") || below.lines.some((line) => line.trim() === "-"),
      needle,
    );
    assert.equal(openLineClassify(applied, below.cursorLine).kind, "note", needle);
  }
});

test("creating a notes drawer before a work-log origin shifts origin by two", () => {
  const text = [
    "- [ ] #task Ship",
    "\t- [ ] req",
    "\t- 🛠️ **WORK LOG**",
    "\t\t- *2026-11-01 09:00* — 25m",
  ].join("\n");
  const origin = lineIndex(text, "WORK LOG");
  const plan = planOpenLine(text, origin, "below", TODAY);
  assert.equal(plan.createdDrawer, true);
  assert.equal(plan.lines.length, 2);
  assert.equal(plan.originLine, origin + 2);
  const applied = apply(text, plan);
  assert.match(applied, /\t- \*\*Notes\*\*\n\t\t- \n\t- 🛠️/);
});

test("grouped headlines open at ## Tasks intake; O matches o; intake stays after its block", () => {
  const text = groupedNote();
  const grouped = lineIndex(text, "#task Grouped");
  const blocked = lineIndex(text, "#task Blocked one");
  const intakeHeading = lineIndex(text, "### Next & In Progress");
  const below = planOpenLine(text, grouped, "below", TODAY);
  const above = planOpenLine(text, grouped, "above", TODAY);
  assertInsert(below, {
    insertBeforeLine: intakeHeading,
    lines: [NEW_TASK],
    cursorCh: TASK_CARET,
    recordJump: true,
    originLine: grouped + 1,
  });
  assert.equal(above.insertBeforeLine, below.insertBeforeLine);
  assert.equal(above.recordJump, true);
  const blockedPlan = planOpenLine(text, blocked, "below", TODAY);
  assert.equal(blockedPlan.insertBeforeLine, intakeHeading);

  const intake = planOpenLine(text, lineIndex(text, "#task Intake"), "below", TODAY);
  assertInsert(intake, {
    insertBeforeLine: lineIndex(text, "intake req") + 1,
    recordJump: false,
  });
});

test("grouped headline without ## Tasks still opens above the group", () => {
  const text = [
    "# Area",
    "### Next & In Progress",
    "- [ ] #task Grouped",
  ].join("\n");
  const plan = planOpenLine(text, 2, "below", TODAY);
  assertInsert(plan, {
    insertBeforeLine: 1,
    lines: [NEW_TASK],
    recordJump: true,
  });
});

test("^prj opens at ## Tasks intake with a jump, and refuses without ## Tasks", () => {
  const withTasks = prjNote(true);
  const plan = planOpenLine(withTasks, 0, "below", TODAY);
  assertInsert(plan, {
    insertBeforeLine: lineIndex(withTasks, "### Next & In Progress"),
    lines: [NEW_TASK],
    recordJump: true,
    originLine: 0,
  });
  const sameAbove = planOpenLine(withTasks, 0, "above", TODAY);
  assert.equal(sameAbove.insertBeforeLine, plan.insertBeforeLine);
  assert.equal(linesOf(apply(withTasks, plan))[0], "- [ ] #task Project ^prj");

  const refused = planOpenLine(prjNote(false), 0, "below", TODAY);
  assert.equal(refused.kind, "refuse");
  assert.equal(refused.notice, OPEN_LINE_PRJ_NO_TASKS_NOTICE);
});

test("Pomodoro, Task Link, and bank rows keep today's prefix after the subtree", () => {
  const pomo = [
    "## Pomodoros",
    "- [ ] (0900-0930) — CODE",
    "\t- [[#^abc|Ship]]",
    "\t\t- extra",
  ].join("\n");
  const pomoPlan = planOpenLine(pomo, 1, "below", TODAY);
  assertInsert(pomoPlan, {
    insertBeforeLine: 4,
    lines: ["- [ ] "],
  });
  const linkPlan = planOpenLine(pomo, 2, "below", TODAY);
  assertInsert(linkPlan, {
    insertBeforeLine: 4,
    lines: ["\t- "],
  });
  const abovePomo = planOpenLine(pomo, 1, "above", TODAY);
  assertInsert(abovePomo, {
    insertBeforeLine: 1,
    lines: ["- [ ] "],
  });

  const bank = "- [ ] $61.20 ShopRite ^bank-aaa111";
  const bankPlan = planOpenLine(bank, 0, "below", TODAY);
  assertInsert(bankPlan, {
    insertBeforeLine: 1,
    lines: ["- [ ] "],
  });
});

test("prose, headings, frontmatter, fences, and blanks keep legacy bytes", () => {
  const text = [
    "---",
    "type: area",
    "---",
    "",
    "# Title",
    "A sentence.",
    "```",
    "- [ ] fenced",
    "```",
  ].join("\n");
  const cases = [
    [1, "type: area"],
    [3, ""],
    [4, "# Title"],
    [5, "A sentence."],
    [7, "- [ ] fenced"],
  ];
  for (const [index, line] of cases) {
    const below = planOpenLine(text, index, "below", TODAY);
    const above = planOpenLine(text, index, "above", TODAY);
    assert.equal(below.kind, "insert", line);
    assert.equal(below.insertBeforeLine, index + 1, line);
    assert.equal(above.insertBeforeLine, index, line);
    assert.equal(below.scaffold.kind, "legacy", line);
  }
});

test("CRLF notes keep CRLF through insert and prune", () => {
  const text = "- [ ] #task Ship\r\n\t- [ ] req\r\n\t- a note";
  const plan = planOpenLine(text, 0, "below", TODAY);
  const applied = apply(text, plan);
  assert.ok(applied.includes("\r\n"));
  assert.ok(!applied.replace(/\r\n/g, "").includes("\n") || applied.includes("\r\n"));
  assert.equal(applied.split("\r\n").pop(), NEW_TASK);
  const pruned = pruneOpenLineScaffold(applied, plan.scaffold);
  assert.equal(pruned, text);
});

test("empty scaffold prune removes the line and a created empty drawer", () => {
  const text = [
    "- [ ] #task Ship",
    "\t- [ ] req",
    "\t- 🧱 **BLOCKS:** [[#^blk|Blk]]",
  ].join("\n");
  const plan = planOpenLine(text, lineIndex(text, "BLOCKS"), "below", TODAY);
  assert.equal(plan.createdDrawer, true);
  const applied = apply(text, plan);
  const pruned = pruneOpenLineScaffold(applied, plan.scaffold);
  assert.equal(pruned, text);

  const typed = applied.replace(plan.scaffold.emptyText, `${plan.scaffold.emptyText}kept`);
  assert.equal(pruneOpenLineScaffold(typed, plan.scaffold), null);
});

test("Ctrl+Shift+] refuses managed lines and still refuses reqs and bank rows first", () => {
  const plugin = makePlugin();
  const managed = [
    "- [ ] #task Ship",
    "\t- 🧱 **BLOCKS:** [[#^blk|Blk]]",
    "\t- ⛓️ **DEPENDS ON:** [[#^dep|Dep]]",
    "\t- 🛠️ **WORK LOG**",
  ].join("\n");
  for (const needle of ["BLOCKS", "DEPENDS ON", "WORK LOG"]) {
    const editor = createTextEditor(managed, { line: lineIndex(managed, needle), ch: 4 });
    const plan = plugin.getActiveObsidianTaskToggle(editor);
    assert.deepEqual(plan, { mode: "refuse", message: OPEN_LINE_MANAGED_NOTICE }, needle);
  }
  assert.deepEqual(openLineManagedRefuse(managed, lineIndex(managed, "BLOCKS")), {
    mode: "refuse",
    message: OPEN_LINE_MANAGED_NOTICE,
  });

  const req = "- [ ] #task Ship\n\t- [ ] a req";
  plugin.app.workspace.getActiveFile = () => ({ path: "Daily.md" });
  const reqEditor = createTextEditor(req, { line: 1, ch: 4 });
  attachActiveMarkdownView(plugin, { app: plugin.app }, reqEditor, "Daily.md");
  const reqPlan = plugin.getActiveObsidianTaskToggle(reqEditor);
  assert.equal(reqPlan && reqPlan.mode, "refuse");
  assert.notEqual(reqPlan.message, OPEN_LINE_MANAGED_NOTICE);
});

test("Vim o/O apply as one replaceRange and undo restores the original", () => {
  const plugin = makePlugin();
  const text = "- [ ] #task Ship\n\t- [ ] req\n\t- a note";
  const editor = wrapEditor(text, { line: 0, ch: 8 });
  const original = editor.getValue();
  plugin.applyVimOpenLine(editor, "below");
  assert.equal(editor.getValue(), `${text}\n${NEW_TASK}`);
  assert.deepEqual(editor.getCursor(), { line: 3, ch: TASK_CARET });
  editor.replaceRange(original, { line: 0, ch: 0 }, {
    line: editor.lastLine(),
    ch: editor.getLine(editor.lastLine()).length,
  });
  assert.equal(editor.getValue(), original);
});

test("empty-scaffold prune on insert-leave, blur, and path-mismatched leaf switch", () => {
  const plugin = makePlugin("Daily.md");
  const text = "- [ ] #task Ship";
  const editor = wrapEditor(text, { line: 0, ch: 8 });
  plugin.applyVimOpenLine(editor, "below");
  assert.equal(editor.getValue(), `${text}\n${NEW_TASK}`);
  editor.emit("vim-mode-change", { mode: "normal" });
  assert.equal(editor.getValue(), text);
  editor.setCursor(0, 8);

  plugin.applyVimOpenLine(editor, "below");
  editor.emit("blur");
  assert.equal(editor.getValue(), text);
  editor.setCursor(0, 8);

  plugin.applyVimOpenLine(editor, "below");
  plugin.app.workspace.getActiveViewOfType = () => ({ file: { path: "Other.md" } });
  assert.equal(plugin.flushOpenLineScaffold("leaf"), false);
  assert.equal(editor.getValue(), `${text}\n${NEW_TASK}`);
});

test("grouped o records a <C-o> jump through the nav API", () => {
  const plugin = makePlugin("Daily.md");
  const jumps = [];
  plugin.app.plugins = {
    plugins: {
      "bob-navigation-hotkeys": {
        api: { recordJump: (from, to) => jumps.push({ from, to }) },
      },
    },
  };
  plugin.app.workspace.getActiveViewOfType = () => ({ file: { path: "Daily.md" } });
  const text = groupedNote();
  const origin = lineIndex(text, "#task Grouped");
  const editor = wrapEditor(text, { line: origin, ch: 8 });
  plugin.applyVimOpenLine(editor, "below");
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].from.path, "Daily.md");
  assert.equal(jumps[0].from.line, origin + 1);
  assert.equal(jumps[0].to.line, lineIndex(text, "### Next & In Progress"));
});

test("folded-block insert still uses the whole document subtree", () => {
  const text = fullBlock("\t");
  const plan = planOpenLine(text, 0, "below", TODAY);
  assert.equal(plan.insertBeforeLine, linesOf(text).length);
  assert.equal(openLineClassify(text, 0).kind, "root-task");
});
