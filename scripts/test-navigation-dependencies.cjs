// Tests for the nav-model Depends-On model, single-transaction writer, and
// nav api v1 (bob-cli-3n.6). `docs/task-dependencies.md` §§2-3, 5-6, 9 and
// §11 (DP parse vectors, DW write vectors) in bob-cli are authoritative;
// vectors are copied from those sections.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: class {},
      Notice: TestNotice,
      Plugin: EmptyClass,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const { helpers } = NavigationHotkeysPlugin;
Module._load = originalLoad;

function compatibleTasksSettings() {
  return {
    globalFilter: "#task",
    statusSettings: {
      coreStatuses: [],
      customStatuses: [
        {
          symbol: "?",
          name: "Blocked",
          nextStatusSymbol: " ",
          availableAsCommand: true,
          type: "ON_HOLD",
        },
      ],
    },
  };
}

function registry() {
  return helpers.parseTasksStatusRegistry(compatibleTasksSettings());
}

class TestEditor {
  constructor(content) {
    this.content = content;
  }
  getValue() {
    return this.content;
  }
  getLine(line) {
    return this.content.split(/\r?\n/)[line] ?? null;
  }
  replaceRange(text, from, to = from) {
    const newline = this.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = this.content.split(/\r?\n/);
    const offset = (position) =>
      lines
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + newline.length, 0) +
      position.ch;
    const start = offset(from);
    const end = offset(to);
    this.content = this.content.slice(0, start) + text + this.content.slice(end);
  }
}

class TransactionEditor extends TestEditor {
  constructor(content, cursor) {
    super(content);
    this.cursor = { ...cursor };
    this.undoGroups = 0;
  }
  getCursor() {
    return { ...this.cursor };
  }
  getScrollInfo() {
    return { left: 0, top: 0 };
  }
  setCursor(lineOrPosition, ch) {
    this.cursor =
      typeof lineOrPosition === "object"
        ? { ...lineOrPosition }
        : { line: lineOrPosition, ch };
  }
  transaction(transaction) {
    if (transaction.changes && transaction.changes.length > 0) {
      this.undoGroups += 1;
    }
    const changes = [...(transaction.changes || [])].sort(
      (left, right) =>
        right.from.line - left.from.line || right.from.ch - left.from.ch,
    );
    for (const change of changes) {
      super.replaceRange(change.text, change.from, change.to || change.from);
    }
    if (transaction.selection) {
      this.cursor = {
        ...(transaction.selection.to || transaction.selection.from),
      };
    }
  }
}

// DP vectors (`docs/task-dependencies.md` §11.1). `line` is the candidate
// line on its own; verdicts: accept(n), empty, malformed, not-a-line.
test("DP parse vectors accept, empty, malformed, and not-a-line", () => {
  const cases = [
    ["DP1", "  - ⛓️ **DEPENDS ON:** [[#^hospital-swarm]]", {}, "accept", 1, true],
    ["DP2", "  - ⛓️ **DEPENDS ON:** [[cash#^unemployment]]", {}, "accept", 1, true],
    ["DP3", "  - ⛓️ **DEPENDS ON:** [[money/cash#^unemployment]]", {}, "accept", 1, true],
    ["DP4", "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]", {}, "accept", 2, true],
    ["DP5", "  - ⛓️ **DEPENDS ON:** [[#^a|b • c]]", {}, "accept", 1, false],
    ["DP6", "  - ⛓️ **DEPENDS ON:** ~~[[#^a]]~~", {}, "accept", 1, false],
    ["DP7", "  - ⛓️ **DEPENDS ON:** ![[#^a]]", {}, "accept", 1, false],
    ["DP8", "  - 🔗 **DEPENDS ON:** [[#^a]]", {}, "accept", 1, false],
    ["DP9", "  - **DEPENDS ON:** [[#^a]]", {}, "accept", 1, false],
    ["DP10", "  - ⛓️ **DEPENDENCIES:** [[#^a]]", {}, "accept", 1, false],
    ["DP11", "  - ⛓ **DEPENDS ON:** [[#^a]]", {}, "accept", 1, false],
    ["DP12", "  - ⛓️ **DEPENDS ON:** [[#^a]] · [[#^b]]", {}, "accept", 2, false],
    ["DP13", "  - ⛓️ **DEPENDS ON:** [[#^a]], [[#^b]]", {}, "accept", 2, false],
    ["DP14", "  - ⛓️ **DEPENDS ON:** [[#^a]] [[#^b]]", {}, "accept", 2, false],
    ["DP15", "  - ⛓️ **DEPENDS ON:** [[#^a", {}, "malformed", 0, false],
    ["DP16", "  - ⛓️ **DEPENDS ON:** [[#^a]] needs review", {}, "malformed", 0, false],
    ["DP17", "  - ⛓️ **DEPENDS ON:**", {}, "empty", 0, false],
    ["DP18", "  - ⛓️ **DEPENDS ON:** [[#^a]]", { inFence: true }, "not-a-line", 0, false],
    ["DP19", "  - ⛓️ **DEPENDS ON:** [[#^a]]", { isDirectChildOfTask: false }, "not-a-line", 0, false],
    ["DP20", "  - ⛓️ **DEPENDS ON:** [[#^a]]", { isDirectChildOfTask: false }, "not-a-line", 0, false],
    ["DP21", "  - ⛓️ **DEPENDS ON:** [[#^a]]", { isDirectChildOfTask: true }, "accept", 1, true],
    ["DP22", "  - ⛓️ **DEPENDS ON:** [[#^a|swarm]]", {}, "accept", 1, false],
    ["DP23", "  - ⛓️ **DEPENDS ON:** [[note]]", {}, "malformed", 0, false],
    ["DP24", "  - 🔗️ **DEPENDS ON:** [[#^a]]", {}, "not-a-line", 0, false],
    ["DP25", "  - ⛓️ **DEPENDS ON:** [[note#Heading]]", {}, "malformed", 0, false],
    ["DP26", "  - ⛓️ **DEPENDS ON:** • ,", {}, "malformed", 0, false],
    ["DP27", "  - ⛓️ **depends on:** [[#^a]]", {}, "not-a-line", 0, false],
    ["DP28", "⛓️ **DEPENDS ON:** [[#^a]]", {}, "not-a-line", 0, false],
    // DP29: the contract verdict is not-a-line, but nav's writer
    // round-trips quoted lines it manages (see the counted-writer test),
    // so its reader keeps accepting them.
    ["DP29", "> - ⛓️ **DEPENDS ON:** [[#^a]]", {}, "accept", 1, true],
  ];
  for (const [id, line, options, verdict, count, canonical] of cases) {
    const parsed = helpers.parseDependencyLine(line, options);
    assert.equal(parsed.verdict, verdict, `${id} verdict`);
    assert.equal(parsed.links.length, count, `${id} link count`);
    if (verdict === "accept") {
      assert.equal(
        helpers.parseDependencyNavigationBulletDetails(line) !== null,
        true,
        `${id} details parse`,
      );
      assert.equal(parsed.canonical, canonical, `${id} canonical`);
    }
  }
  // Malformed and label-only lines never parse as details; context
  // exclusions (fence, nesting, Work Log) are the caller's check —
  // `parseDependencyNavigationBulletDetails` is shape-only.
  for (const line of [
    "  - ⛓️ **DEPENDS ON:** [[#^a",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] needs review",
    "  - ⛓️ **DEPENDS ON:**",
    "  - ⛓️ **DEPENDS ON:** [[note]]",
    "  - ⛓️ **DEPENDS ON:** [[note#Heading]]",
    "  - ⛓️ **DEPENDS ON:** • ,",
  ]) {
    assert.equal(helpers.parseDependencyNavigationBulletDetails(line), null);
  }
});

test("fenced lines never collect as Depends-On lines", () => {
  const input = [
    "- [ ] #task Parent [dependsOn:: a] ^parent",
    "  ```md",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "  ```",
    "- [ ] #task A [id:: a] ^a",
  ].join("\n");
  const collection = helpers.collectDependencyNavigationBullets(input, 0);
  assert.deepEqual(collection.targets, []);
  assert.deepEqual(collection.lineIndices, []);
});

function planSingle(content, parentLine, parentPath, add, remove, files, recovery) {
  return helpers.planDependencyEdit({
    content,
    parentLine,
    parentPath,
    add,
    remove,
    files: files === undefined ? { [parentPath]: content } : files,
    recovery,
  });
}

// DW1: create the line as the first child, before the Schedule Log.
test("DW1 creates the line as the first child", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "  - 🗓️ **SCHEDULE LOG**",
    "- [ ] #task Target ^target",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.equal(
    plan.nextContent,
    [
      "- [?] #task Parent [dependsOn:: Tasks__target] ^parent",
      "  - ⛓️ **DEPENDS ON:** [[#^target]]",
      "  - 🗓️ **SCHEDULE LOG**",
      "- [ ] #task Target [id:: Tasks__target] ^target",
    ].join("\n"),
  );
  assert.equal(plan.notice, '⛓ Now waits on "Target" · Blocked');
});

// DW2: create after a Cancel Log.
test("DW2 creates the line after a Cancel Log", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "  - ❌ **CANCEL LOG**",
    "  - prose child",
    "- [ ] #task Target ^target",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.nextContent.split("\n").slice(0, 4), [
    "- [?] #task Parent [dependsOn:: Tasks__target] ^parent",
    "  - ❌ **CANCEL LOG**",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "  - prose child",
  ]);
});

// DW3/DW4/DW5: append, remove the middle link, remove the last link.
test("DW3-DW5 append, remove the middle, and delete on the last link", () => {
  const appended = planSingle(
    [
      "- [ ] #task Parent [dependsOn:: Tasks__a] ^parent",
      "  - ⛓️ **DEPENDS ON:** [[#^a]]",
      "- [ ] #task A [id:: Tasks__a] ^a",
      "- [ ] #task B [id:: Tasks__b] ^b",
    ].join("\n"),
    0,
    "Tasks.md",
    [{ path: "Tasks.md", blockId: "b" }],
    [],
  );
  assert.equal(appended.ok, true);
  assert.match(
    appended.nextContent,
    /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\] • \[\[#\^b\]\]/,
  );
  assert.match(appended.nextContent, /\[dependsOn:: Tasks__a, Tasks__b\]/);

  const middle = planSingle(
    [
      "- [ ] #task P [dependsOn:: Tasks__a, Tasks__b, Tasks__c] ^p",
      "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]] • [[#^c]]",
      "- [ ] #task A [id:: Tasks__a] ^a",
      "- [ ] #task B [id:: Tasks__b] ^b",
      "- [ ] #task C [id:: Tasks__c] ^c",
    ].join("\n"),
    0,
    "Tasks.md",
    [],
    [{ path: "Tasks.md", blockId: "b" }],
  );
  assert.equal(middle.ok, true);
  assert.match(
    middle.nextContent,
    /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^a\]\] • \[\[#\^c\]\]/,
  );
  assert.match(middle.nextContent, /\[dependsOn:: Tasks__a, Tasks__c\]/);

  const last = planSingle(
    [
      "- [?] #task P [dependsOn:: Tasks__a] ^p",
      "  - ⛓️ **DEPENDS ON:** [[#^a]]",
      "- [x] #task A [id:: Tasks__a] ^a",
    ].join("\n"),
    0,
    "Tasks.md",
    [],
    [{ path: "Tasks.md", blockId: "a" }],
    undefined,
    { registry: registry() },
  );
  assert.equal(last.ok, true);
  assert.equal(
    last.nextContent,
    ["- [ ] #task P ^p", "- [x] #task A [id:: Tasks__a] ^a"].join("\n"),
  );
});

// DW6/DW7: re-adding moves the link to the end; the field mirrors the line.
test("DW6-DW7 re-add moves to the end and the field mirrors the line", () => {
  const plan = planSingle(
    [
      "- [ ] #task P [dependsOn:: Tasks__a, Tasks__b] ^p",
      "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]",
      "- [ ] #task A [id:: Tasks__a] ^a",
      "- [ ] #task B [id:: Tasks__b] ^b",
    ].join("\n"),
    0,
    "Tasks.md",
    [{ path: "Tasks.md", blockId: "a" }],
    [],
  );
  assert.equal(plan.ok, true);
  assert.match(
    plan.nextContent,
    /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^b\]\] • \[\[#\^a\]\]/,
  );
  assert.match(plan.nextContent, /\[dependsOn:: Tasks__b, Tasks__a\]/);
});

// DW8: tab indents deepen by one tab.
test("DW8 tab parents deepen the child by one tab", () => {
  const content = [
    "\t- [ ] #task Parent ^parent",
    "\t- [ ] #task Target ^target",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.match(
    plan.nextContent,
    /\t\t- ⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/,
  );
});

// DW9: space indents reuse the existing child indent.
test("DW9 space parents reuse the existing child indent", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "  - Keep me",
    "- [ ] #task Target ^target",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.nextContent.split("\n").slice(0, 3), [
    "- [?] #task Parent [dependsOn:: Tasks__target] ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "  - Keep me",
  ]);
});

// DW10/DW11: CRLF and missing final newlines survive the edit.
test("DW10-DW11 CRLF and final-newline state survive", () => {
  const target = "- [ ] #task Target ^target";
  const crlf = "- [ ] #task Parent ^parent\r\n" + `${target}\r\n`;
  const plan = planSingle(crlf, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.equal(plan.nextContent.includes("\r\n"), true);
  assert.doesNotMatch(plan.nextContent, /[^\r]\n/);

  const noFinal = "- [ ] #task Parent ^parent\n" + target;
  const bare = planSingle(noFinal, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(bare.ok, true);
  assert.equal(bare.nextContent.endsWith("\n"), false);
});

// DW12-DW14: shortest unambiguous link form.
test("DW12-DW14 link form is the shortest unambiguous form", () => {
  assert.deepEqual(
    helpers.canonicalDependencyLink(
      { path: "Tasks.md", blockId: "x" },
      "Tasks.md",
      ["Tasks.md"],
    ).text,
    "[[#^x]]",
  );
  assert.deepEqual(
    helpers.canonicalDependencyLink(
      { path: "cash.md", blockId: "x" },
      "Tasks.md",
      ["Tasks.md", "cash.md"],
    ).text,
    "[[cash#^x]]",
  );
  assert.deepEqual(
    helpers.canonicalDependencyLink(
      { path: "money/cash.md", blockId: "x" },
      "Tasks.md",
      ["Tasks.md", "cash.md", "money/cash.md"],
    ).text,
    "[[money/cash#^x]]",
  );
});

// DW15: an existing `[id::]` is preferred over the canonical id.
test("DW15 an existing id is never rewritten", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target [id:: custom] ^target",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.match(plan.nextContent, /\[dependsOn:: custom\]/);
  assert.match(plan.nextContent, /Target \[id:: custom\] \^target/);
  assert.doesNotMatch(plan.nextContent, /Tasks__target/);
});

// DW16: an unencodable path with no id refuses the write.
test("DW16 an unencodable path without an id refuses", () => {
  const targetNote = "- [ ] #task Target ^target";
  const plan = planSingle(
    "- [ ] #task Parent ^parent",
    0,
    "Tasks.md",
    [{ path: "My Notes.md", blockId: "target" }],
    [],
    { "Tasks.md": "- [ ] #task Parent ^parent", "My Notes.md": targetNote },
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "target-id-unencodable");
});

// DW17: the field lands right of `[fresh::]` and before `^id`.
test("DW17 field placement follows fresh and precedes the block id", () => {
  const content = [
    "- [ ] #task Do [fresh:: 2026-10-02] ^task",
    "- [ ] #task Target ^target",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.match(
    plan.nextContent,
    /\[fresh:: 2026-10-02\] \[dependsOn:: Tasks__target\] \^task/,
  );
});

// DW18: legacy children fold into the line in the same write.
test("DW18 legacy children fold into the line", () => {
  const content = [
    "- [ ] #task Parent [dependsOn:: Tasks__a, Tasks__b, Tasks__c] ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "  - ![[#^b]]",
    "  - ~~[[#^c]]~~",
    "- [ ] #task A [id:: Tasks__a] ^a",
    "- [ ] #task B [id:: Tasks__b] ^b",
    "- [ ] #task C [id:: Tasks__c] ^c",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [], []);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.nextContent.split("\n").slice(0, 2), [
    "- [ ] #task Parent [dependsOn:: Tasks__a, Tasks__b, Tasks__c] ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]] • [[#^c]]",
  ]);
});

// DW19: every reader-tolerated variant canonicalises with the same targets.
test("DW19 variants canonicalise to the writer form", () => {
  for (const line of [
    "  - 🔗 **DEPENDS ON:** [[#^a]] • [[#^b]]",
    "  - **DEPENDS ON:** [[#^a]] · [[#^b]]",
    "  - ⛓️ **DEPENDENCIES:** [[#^a]], [[#^b]]",
    "  - ⛓ **DEPENDS ON:** [[#^a]] [[#^b]]",
    "  - ⛓️ **DEPENDS ON:** ![[#^a]] • ~~[[#^b]]~~",
    "  - ⛓️ **DEPENDS ON:** [[#^a|ay]] • [[#^b|bee]]",
  ]) {
    const content = [
      "- [?] #task P [dependsOn:: Tasks__a, Tasks__b] ^p",
      line,
      "- [ ] #task A [id:: Tasks__a] ^a",
      "- [ ] #task B [id:: Tasks__b] ^b",
    ].join("\n");
    const plan = planSingle(content, 0, "Tasks.md", [], []);
    assert.equal(plan.ok, true, line);
    assert.deepEqual(plan.nextContent.split("\n").slice(0, 2), [
      "- [?] #task P [dependsOn:: Tasks__a, Tasks__b] ^p",
      "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]",
    ], line);
  }
});

// Status effects: adding blocks, commitment transfer, removal recovery.
test("adding an open prerequisite blocks the dependent", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.match(plan.nextContent, /- \[\?\] #task Parent/);
  assert.equal(plan.summary.blockedAfter, true);
});

test("adding transfers Next and In Progress commitment to the open target", () => {
  for (const status of ["*", "/"]) {
    const content = [
      `- [${status}] #task Parent ^parent`,
      "- [ ] #task Target ^target",
    ].join("\n");
    const plan = planSingle(content, 0, "Tasks.md", [
      { path: "Tasks.md", blockId: "target" },
    ], []);
    assert.equal(plan.ok, true, status);
    assert.equal(
      plan.nextContent.includes(`- [${status}] #task Target`),
      true,
      status,
    );
  }
});

test("removing the last open prerequisite recovers immediately", () => {
  const content = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const plan = planSingle(
    content,
    0,
    "Tasks.md",
    [],
    [{ path: "Tasks.md", blockId: "a" }],
    undefined,
    { registry: registry() },
  );
  assert.equal(plan.ok, true);
  assert.match(plan.nextContent, /- \[ \] #task P \^p$/m);
  assert.equal(plan.notice, '⛓ No longer waits on "a" · Ready again');
});

test("removal stays Blocked while another prerequisite is open", () => {
  const content = [
    "- [?] #task P [dependsOn:: Tasks__a, Tasks__b] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[#^b]]",
    "- [x] #task A [id:: Tasks__a] ^a",
    "- [ ] #task B [id:: Tasks__b] ^b",
  ].join("\n");
  const plan = planSingle(content, 0, "Tasks.md", [], [
    { path: "Tasks.md", blockId: "a" },
  ]);
  assert.equal(plan.ok, true);
  assert.match(plan.nextContent, /- \[\?\] #task P /);
  assert.match(plan.nextContent, /\[dependsOn:: Tasks__b\]/);
  assert.equal(plan.notice, '⛓ No longer waits on "a" · Still blocked');
});

test("removal stays Blocked with a future schedule", () => {
  const content = [
    "- [?] #task P [scheduled:: 2099-01-01] [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task A [id:: Tasks__a] ^a",
  ].join("\n");
  const plan = planSingle(
    content,
    0,
    "Tasks.md",
    [],
    [{ path: "Tasks.md", blockId: "a" }],
    undefined,
    undefined,
  );
  assert.equal(plan.ok, true);
  assert.match(plan.nextContent, /- \[\?\] #task P /);
  assert.doesNotMatch(plan.nextContent, /dependsOn/);
});

// One gesture writes: preparations first, then one dependent transaction.
test("one gesture commits the dependent note in a single transaction", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const plan = planSingle(content, 0, "Tasks.md", [
    { path: "Tasks.md", blockId: "target" },
  ], []);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.preparations, []);
  const outcome = await helpers.applyDependencyEditTransaction(plan, {
    prepareTargetFile: () => ({ ok: true }),
    commitDependentContent: (nextContent) => ({
      ok: helpers.applyEditorContentTransaction(
        editor,
        content,
        nextContent,
      ),
    }),
  });
  assert.equal(outcome.ok, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\*/);
});

// A failed cross-note preparation leaves the dependent untouched.
test("a failed preparation leaves the dependent untouched", async () => {
  const parentNote = "- [ ] #task Parent ^parent";
  const targetNote = "- [ ] #task Target ^target";
  const plan = helpers.planDependencyEdit({
    content: parentNote,
    parentLine: 0,
    parentPath: "Tasks.md",
    add: [{ path: "Other.md", blockId: "target" }],
    remove: [],
    files: { "Tasks.md": parentNote, "Other.md": targetNote },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.preparations.length, 1);
  assert.equal(plan.preparations[0].path, "Other.md");
  assert.match(plan.nextContent, /\[\[Other#\^target\]\]/);
  let committed = 0;
  const outcome = await helpers.applyDependencyEditTransaction(plan, {
    prepareTargetFile: () => ({ ok: false, reason: "target-changed" }),
    commitDependentContent: () => {
      committed += 1;
      return { ok: true };
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "target-changed");
  assert.equal(committed, 0);
});

// Recovery edges: line links plus covered legacy children, never `#^ref`.
test("recovery references follow the line plus covered legacy children", () => {
  const targetNote = "- [ ] #task A [id:: Tasks__a] ^a";
  const noteIndex = helpers.createScheduledRecoveryNoteIndex([
    { path: "Tasks.md", content: targetNote },
  ]);
  const blocks = new Map([
    ["Tasks.md\0a", [{ taskId: "Tasks__a" }]],
  ]);
  const covered = helpers.recoveryDependencyReferences(
    "  - ![[#^a]]",
    ["Tasks__a"],
    blocks,
    { noteIndex, sourcePath: "Tasks.md" },
  );
  assert.equal(covered.length, 1);
  assert.deepEqual(
    helpers.recoveryDependencyReferences(
      "  - ![[#^a]]",
      ["something-else"],
      blocks,
      { noteIndex, sourcePath: "Tasks.md" },
    ),
    [],
  );
  const line = helpers.recoveryDependencyReferences(
    "  - ⛓️ **DEPENDS ON:** [[#^a]] • [[cash#^b]]",
    [],
    new Map(),
    {},
  );
  assert.deepEqual(
    line.map((ref) => `${ref.target}#^${ref.blockId}`),
    ["#^a", "cash#^b"],
  );
  assert.deepEqual(
    helpers.recoveryDependencyReferences(
      "  - ![[ref/chat/example#^ref]]",
      [],
      new Map(),
      {},
    ),
    [],
  );
  assert.deepEqual(
    helpers.recoveryDependencyReferences(
      "  - ⛓️ **DEPENDS ON:** [[#^a]] needs review",
      [],
      new Map(),
      {},
    ),
    [],
  );
});

// Task-block helpers: owning task, line index, insertion point.
test("task-block helpers find owners, lines, and insertion points", () => {
  const lines = [
    "- [ ] #task Parent ^parent",
    "  - ❌ **CANCEL LOG**",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "  prose",
    "- [ ] #task Other ^other",
  ];
  assert.equal(helpers.findOwningTaskLine(lines, 0), 0);
  assert.equal(helpers.findOwningTaskLine(lines, 2), 0);
  assert.equal(helpers.findOwningTaskLine(lines, 3), 0);
  assert.equal(helpers.findOwningTaskLine(lines, 4), 4);
  assert.equal(helpers.findDependencyLineIndex(lines, 0), 2);
  assert.equal(helpers.findDependencyLineIndex(lines, 4), null);
  assert.equal(helpers.getDependencyInsertLine(lines, 4), 5);
  assert.equal(
    helpers.dependencyTargetId("- [ ] #task T [id:: custom] ^t", "Tasks.md", "t"),
    "custom",
  );
  assert.equal(
    helpers.dependencyTargetId("- [ ] #task T ^t", "Tasks.md", "t"),
    "Tasks__t",
  );
  assert.equal(helpers.dependencyTargetId("- [ ] #task T ^t", "My Notes.md", "t"), null);
});

// Notices follow the contract summary shapes.
test("dependency notices follow the contract shapes", () => {
  assert.equal(
    helpers.buildDependencyEditNotice(
      { added: 1, removed: 0, openRemaining: 1, blockedAfter: true },
      { added: ["File for unemployment"] },
    ),
    '⛓ Now waits on "File for unemployment" · Blocked',
  );
  assert.equal(
    helpers.buildDependencyEditNotice(
      { added: 0, removed: 1, openRemaining: 0, blockedAfter: false },
      { removed: ["x"] },
    ),
    '⛓ No longer waits on "x" · Ready again',
  );
  assert.equal(
    helpers.buildDependencyEditNotice(
      { added: 2, removed: 1, openRemaining: 1, blockedAfter: true },
      {},
    ),
    "⛓ 2 added · 1 removed · Blocked (1 open)",
  );
});

// nav api v1: frozen, versioned, never throws.
test("nav api v1 resolves results and never throws", async () => {
  const api = helpers.createDependencyNavApi(null);
  assert.equal(api.version, 1);
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(await api.openDependencyStage(null), {
    ok: false,
    reason: "unavailable",
  });
  assert.deepEqual(await api.removeDependency(null, null), {
    ok: false,
    reason: "unavailable",
  });

  const throwing = helpers.createDependencyNavApi({
    openDependencyStageForRef() {
      throw new Error("boom");
    },
    async removeDependencyByRef() {
      return { ok: true };
    },
  });
  assert.deepEqual(await throwing.openDependencyStage({ path: "Tasks.md", line: 0 }), {
    ok: false,
    reason: "api-failed",
  });
  assert.deepEqual(
    await throwing.removeDependency({ path: "Tasks.md", line: 0 }, { blockId: "a" }),
    { ok: true },
  );

  const refusing = helpers.createDependencyNavApi({
    async openDependencyStageForRef() {
      return { ok: false, reason: "stale" };
    },
    async removeDependencyByRef() {
      return { ok: false, reason: "stale" };
    },
  });
  assert.deepEqual(await refusing.openDependencyStage({ path: "Tasks.md", line: 0 }), {
    ok: false,
    reason: "stale",
  });
  assert.deepEqual(
    await refusing.removeDependency({ path: "Tasks.md", line: 0 }, { blockId: "a" }),
    { ok: false, reason: "stale" },
  );
});
