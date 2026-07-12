const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
let MarkdownView;
const notices = [];

Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    MarkdownView = class MarkdownView {};
    return {
      MarkdownView,
      Notice: class Notice {
        constructor(message) {
          notices.push(String(message));
        }
      },
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

test("dependency normalizer writes path-qualified IDs and is idempotent", () => {
  const source = [
    "- [ ] #task Parent [dependsOn:: a1b2c3, custom] ^parent",
    "- [ ] #task Existing [id:: a1b2c3] ^review",
    "- [ ] #task Legacy [id:: custom] ^legacy",
  ].join("\n");
  const result = helpers.normalizeTaskDependencyBlockIds(
    source,
    "projects/Shared.md",
  );
  assert.equal(result.changed, true);
  assert.match(result.text, /\[id:: projects__Shared__review\] \^review/);
  assert.match(result.text, /\[id:: projects__Shared__legacy\] \^legacy/);
  assert.match(
    result.text,
    /\[dependsOn:: projects__Shared__review, projects__Shared__legacy\]/,
  );
  assert.equal(
    helpers.normalizeTaskDependencyBlockIds(result.text, "projects/Shared.md").changed,
    false,
  );
});

test("Tasks-generated IDs become local block IDs when none exists", () => {
  const result = helpers.normalizeTaskDependencyBlockIds(
    "- [ ] #task Target [id:: z9y8x7]",
    "Nested/Target.md",
  );
  assert.equal(
    result.text,
    "- [ ] #task Target [id:: Nested__Target__z9y8x7] ^z9y8x7",
  );
  assert.deepEqual(result.idMap, { z9y8x7: "Nested__Target__z9y8x7" });
});

test("note rename rewrites target IDs and yields exact propagation mappings", () => {
  const result = helpers.rewriteRenamedDependencyIds(
    "- [ ] #task Target [id:: Old__Path__review] ^review\n",
    "Old/Path.md",
    "New/Home.md",
  );
  assert.equal(
    result.text,
    "- [ ] #task Target [id:: New__Home__review] ^review\n",
  );
  assert.deepEqual(result.idMap, {
    Old__Path__review: "New__Home__review",
  });
});

test("note rename also rewrites same-file dependsOn references", () => {
  const result = helpers.rewriteRenamedDependencyIds(
    [
      "- [ ] #task Parent [dependsOn:: Old__Path__review] ^parent",
      "- [ ] #task Target [id:: Old__Path__review] ^review",
    ].join("\n"),
    "Old/Path.md",
    "New/Home.md",
  );
  assert.match(result.text, /\[dependsOn:: New__Home__review\]/);
  assert.match(result.text, /\[id:: New__Home__review\] \^review/);
});

test("dependency normalization skips unsupported paths and fenced examples", () => {
  const source = [
    "```md",
    "- [ ] #task Example [id:: abc123] ^example",
    "- [ ] #task Parent [dependsOn:: abc123]",
    "```",
    "- [ ] #task Real [id:: def456] ^real",
  ].join("\n");
  const supported = helpers.normalizeTaskDependencyBlockIds(source, "Tasks.md");
  assert.match(supported.text, /Example \[id:: abc123\] \^example/);
  assert.match(supported.text, /Parent \[dependsOn:: abc123\]/);
  assert.match(supported.text, /Real \[id:: Tasks__real\] \^real/);

  const unsupported = helpers.normalizeTaskDependencyBlockIds(
    "- [ ] #task Real [id:: def456] ^real",
    "Spaced Note.md",
  );
  assert.equal(helpers.dependencyId("Spaced Note.md", "real"), null);
  assert.equal(unsupported.changed, false);
  assert.equal(unsupported.unsupportedPath, true);
});

function createInMemoryObsidianApp(initialSources) {
  const files = new Map();
  const sources = new Map();

  for (const [path, sourceText] of Object.entries(initialSources)) {
    const file = { path };
    files.set(path, file);
    sources.set(path, sourceText);
  }

  const resolveLinkPath = (pathPart) => {
    const exactPath = pathPart.endsWith(".md") ? pathPart : `${pathPart}.md`;
    if (files.has(exactPath)) {
      return files.get(exactPath);
    }

    for (const file of files.values()) {
      const basename = file.path.split("/").pop().replace(/\.md$/i, "");
      if (basename === pathPart) {
        return file;
      }
    }
    return null;
  };

  return {
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path) || null,
        getMarkdownFiles: () => [...files.values()],
        cachedRead: async (file) => sources.get(file.path),
        read: async (file) => sources.get(file.path),
        modify: async (file, sourceText) => sources.set(file.path, sourceText),
        process: async (file, updateSourceText) => {
          sources.set(file.path, updateSourceText(sources.get(file.path)));
        },
      },
      metadataCache: {
        getFileCache: () => null,
        getFirstLinkpathDest: (pathPart) => resolveLinkPath(pathPart),
      },
    },
    getSource: (path) => sources.get(path),
  };
}

function getEmbeddedTarget(linkText) {
  const targets = helpers.parseEmbeddedBlockTransclusions(linkText);
  assert.equal(targets.length, 1, `expected one embedded target in ${linkText}`);
  return targets[0];
}

function createTextEditor(initialText, initialCursor = { line: 0, ch: 0 }) {
  let text = initialText;
  let cursor = { ...initialCursor };
  const positionOffset = (position) => {
    const lines = text.split("\n");
    return lines
      .slice(0, position.line)
      .reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
  };
  return {
    getValue: () => text,
    getCursor: () => ({ ...cursor }),
    setCursor: (next) => { cursor = { ...next }; },
    getLine: (line) => text.split("\n")[line] || "",
    lineCount: () => text.split("\n").length,
    lastLine: () => text.split("\n").length - 1,
    replaceRange: (replacement, from, to = from) => {
      const start = positionOffset(from);
      const end = positionOffset(to);
      text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
    },
  };
}

test("normalization mappings propagate to every dependent file", async () => {
  const harness = createInMemoryObsidianApp({
    "Target.md": "- [ ] #task Target [id:: old] ^review",
    "A.md": "- [ ] #task A [dependsOn:: old]",
    "B.md": "- [ ] #task B [dependsOn:: old, keep]",
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  await plugin.propagateDependencyBlockIds(
    { old: "Target__review" },
    { path: "Target.md" },
  );
  assert.match(harness.getSource("A.md"), /\[dependsOn:: Target__review\]/);
  assert.match(
    harness.getSource("B.md"),
    /\[dependsOn:: Target__review, keep\]/,
  );
});

test("runtime normalizer skips unsupported paths with one informative notice", async () => {
  notices.length = 0;
  const source = "- [ ] #task Target [id:: abc123] ^target";
  const harness = createInMemoryObsidianApp({ "Spaced Note.md": source });
  harness.app.workspace = {};
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const file = harness.app.vault.getAbstractFileByPath("Spaced Note.md");

  await plugin.normalizeVaultFileDependencyBlockIds(file);
  await plugin.normalizeVaultFileDependencyBlockIds(file);
  assert.equal(harness.getSource(file.path), source);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /unsupported characters/);
});

test("rename reconciliation rewrites the target and every dependent", async () => {
  const harness = createInMemoryObsidianApp({
    "New/Home.md": "- [ ] #task Target [id:: Old__Home__review] ^review",
    "A.md": "- [ ] #task A [dependsOn:: Old__Home__review]",
    "B.md": "- [ ] #task B [dependsOn:: Old__Home__review]",
  });
  harness.app.workspace = {};
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  assert.equal(
    await plugin.reconcileRenamedDependencyIds(
      harness.app.vault.getAbstractFileByPath("New/Home.md"),
      "Old/Home.md",
    ),
    true,
  );
  assert.match(harness.getSource("New/Home.md"), /\[id:: New__Home__review\]/);
  assert.match(harness.getSource("A.md"), /\[dependsOn:: New__Home__review\]/);
  assert.match(harness.getSource("B.md"), /\[dependsOn:: New__Home__review\]/);
});

test("editor dependency normalization abandons and reschedules stale snapshots", async () => {
  const editor = createTextEditor("- [ ] #task Target [id:: abc123] ^target");
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = { vault: {}, workspace: {} };
  let rescheduled = 0;
  plugin.scheduleActiveEditorDependencyNormalize = () => { rescheduled += 1; };
  plugin.findAmbiguousDependencyIds = async () => {
    editor.replaceRange("typed ", { line: 0, ch: 0 });
    return new Set();
  };
  plugin.propagateDependencyBlockIds = async () => assert.fail("stale mapping propagated");

  assert.equal(
    await plugin.normalizeActiveEditorDependencyBlockIds(
      editor,
      { path: "Tasks.md" },
    ),
    false,
  );
  assert.equal(rescheduled, 1);
  assert.match(editor.getValue(), /^typed .*\[id:: abc123\]/);
});

test("rename reconciliation abandons and reschedules stale editor snapshots", async () => {
  const editor = createTextEditor(
    "- [ ] #task Target [id:: Old__Home__review] ^review",
  );
  const file = { path: "New/Home.md" };
  const view = Object.assign(new MarkdownView(), { editor, file });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: { cachedRead: async () => editor.getValue() },
    workspace: { getActiveViewOfType: () => view },
  };
  plugin.findDependencyIdentityCollisions = async () => {
    editor.replaceRange("typed ", { line: 0, ch: 0 });
    return new Set();
  };
  let rescheduled = 0;
  plugin.scheduleRenamedDependencyReconcile = () => { rescheduled += 1; };
  plugin.propagateDependencyBlockIds = async () => assert.fail("stale rename propagated");

  assert.equal(
    await plugin.reconcileRenamedDependencyIds(file, "Old/Home.md"),
    false,
  );
  assert.equal(rescheduled, 1);
  assert.match(editor.getValue(), /\[id:: Old__Home__review\]/);
});

test("direct open/done transitions include incomplete statuses without broadening excluded statuses", () => {
  const cases = [
    { symbol: " ", eligible: true, reopenable: false, next: "x" },
    { symbol: "*", eligible: true, reopenable: false, next: "x" },
    { symbol: "x", eligible: true, reopenable: true, next: " " },
    { symbol: "/", eligible: true, reopenable: false, next: "x" },
    { symbol: "-", eligible: false, reopenable: false, next: null },
    { symbol: "?", eligible: false, reopenable: false, next: null },
  ];

  for (const { symbol, eligible, reopenable, next } of cases) {
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
    assert.equal(
      helpers.isTranscludedReopenableStatus(taskStatus),
      reopenable,
      `reopen policy for [${symbol}]`,
    );
  }
  assert.equal(helpers.isTranscludedReopenableStatus(null), false);
});

test("Ctrl+Enter block-link selection recognizes live and retired forms", () => {
  const cases = [
    { line: "- ![[Tasks#^embed|Embedded]]", embedded: true },
    { line: "- [[Tasks#^plain|Plain]]", embedded: false },
    { line: "- 🍅 [[Tasks#^marked|Marked]]", embedded: false },
    { line: "- ~~[[Tasks#^retired|Retired]]~~", embedded: false },
  ];
  for (const { line, embedded } of cases) {
    const target = helpers.getTaskBlockLinkTargetFromLine(
      line,
      "Daily.md",
      3,
      0,
    );
    assert.ok(target, line);
    assert.equal(target.embedded, embedded, line);
    assert.equal(target.sourcePath, "Daily.md");
  }

  const mixed = "- [[A#^first]] and 🍅 ~~[[B#^second|Second]]~~";
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine(mixed, "Daily.md", 0, 0),
    null,
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine(
      mixed,
      "Daily.md",
      0,
      mixed.indexOf("🍅"),
    ).blockId,
    "second",
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine("- [[A#Heading]]", "Daily.md", 0),
    null,
  );
  assert.equal(
    helpers.getTaskBlockLinkTargetFromLine("- [[A#^bad id]]", "Daily.md", 0),
    null,
  );
  assert.deepEqual(
    helpers.collectTaskBlockLinkTargetsInLineRange(
      ["- [[A#^first]]", "- [[B#^second]]"],
      "Daily.md",
      1,
      0,
    ),
    [],
  );

  const fencedEditor = createTextEditor(
    "```md\n- [[Tasks#^example]]\n```",
    { line: 1, ch: 7 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  assert.equal(
    plugin.getActiveLineTaskBlockLinkTarget(fencedEditor, "Daily.md"),
    null,
  );
});

test("direct Done Tasks task reopens through the metadata-aware fallback", () => {
  const editor = createTextEditor(
    "- [x] #task Finished [completion:: 2026-07-11] ^finished",
    { line: 0, ch: 4 },
  );
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    commands: { commands: {}, executeCommandById: () => false },
  };
  assert.equal(plugin.toggleActiveCheckboxOpenDone(editor), true);
  assert.equal(editor.getValue(), "- [ ] #task Finished ^finished");
});

test("recursive completion status policy includes Next without broadening excluded statuses", () => {
  const cases = [
    { symbol: " ", traversable: true, closable: true },
    { symbol: "*", traversable: true, closable: true },
    { symbol: "/", traversable: true, closable: true },
    { symbol: "x", traversable: true, closable: false },
    { symbol: "-", traversable: false, closable: false },
    { symbol: "?", traversable: false, closable: false },
  ];

  for (const { symbol, traversable, closable } of cases) {
    const taskStatus = helpers.getTaskStatusForLine(`- [${symbol}] #task Example`);
    assert.equal(
      helpers.isTranscludedCompletionTraversableStatus(taskStatus),
      traversable,
      `traversability for [${symbol}]`,
    );
    assert.equal(
      helpers.isTranscludedCompletionClosableStatus(taskStatus),
      closable,
      `closability for [${symbol}]`,
    );
  }

  assert.equal(helpers.isTranscludedCompletionTraversableStatus(null), false);
  assert.equal(helpers.isTranscludedCompletionClosableStatus(null), false);
});

test("recursive completion closes a Next root and its nested Next descendant", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n\t- ![[Root#^root]]",
    "Root.md": [
      "- [*] #task Parent [priority:: high] [completion:: stale] ^root",
      "\t- ![[#^child]]",
      "- [*] #task Child keeps metadata [effort:: 2] ^child",
    ].join("\n"),
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";

  const result = await plugin.completeTranscludedTaskTargetTree(
    getEmbeddedTarget("![[Root#^root]]"),
    { activePath: "Daily.md", originPath: "Daily.md", editor: null },
    new Set(),
  );

  assert.deepEqual(result, {
    visited: true,
    changed: true,
    closed: [
      { path: "Root.md", blockId: "child" },
      { path: "Root.md", blockId: "root" },
    ],
  });
  assert.equal(
    harness.getSource("Root.md"),
    [
      "- [x] #task Parent [priority:: high]  [completion:: 2026-07-11] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child keeps metadata [effort:: 2]  [completion:: 2026-07-11] ^child",
    ].join("\n"),
  );
});

test("recursive completion traverses Done parents and skips excluded siblings", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^parent]]",
    "Tree.md": [
      "- [x] #task Already done ^parent",
      "\t- ![[#^canceled]]",
      "\t- ![[#^custom]]",
      "\t- ![[#^next]]",
      "- [-] #task Canceled ^canceled",
      "- [?] #task Custom ^custom",
      "- [*] #task Eligible sibling ^next",
    ].join("\n"),
  });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";

  const result = await plugin.completeTranscludedTaskTargetTree(
    getEmbeddedTarget("![[Tree#^parent]]"),
    { activePath: "Daily.md", originPath: "Daily.md", editor: null },
    new Set(),
  );

  assert.deepEqual(result, {
    visited: true,
    changed: true,
    closed: [{ path: "Tree.md", blockId: "next" }],
  });
  assert.equal(
    harness.getSource("Tree.md"),
    [
      "- [x] #task Already done ^parent",
      "\t- ![[#^canceled]]",
      "\t- ![[#^custom]]",
      "\t- ![[#^next]]",
      "- [-] #task Canceled ^canceled",
      "- [?] #task Custom ^custom",
      "- [x] #task Eligible sibling  [completion:: 2026-07-11] ^next",
    ].join("\n"),
  );
});

test("closed-reference retirement is ancestry-aware, resolved, fenced, and idempotent", () => {
  const source = [
    "- [ ] #task Parent ^parent",
    "\t- ![[#^local|Local]] and ![[Projects/Alpha#^review|Review]]",
    "\t\t- ~~![[Alpha#^review|Stale embed]]~~",
    "- Unmanaged tree",
    "\t- ![[Alpha#^review|Protected]]",
    "```md",
    "- [ ] #task Example ^fake",
    "\t- ![[Alpha#^review|Fenced]]",
    "```",
    "## Pomodoros",
    "- [ ] Focus",
    "  - Prefix ![[Alpha#^review|One]] and ![[Beta#^other]] suffix",
    "## Notes",
    "- prose ![[Alpha#^review|Not a descendant]]",
  ].join("\r\n");
  const resolve = (pathPart) => {
    if (pathPart === "Projects/Alpha" || pathPart === "Alpha") {
      return "Projects/Alpha.md";
    }
    if (pathPart === "Beta") return "Beta.md";
    return null;
  };
  const closed = [
    { path: "Tasks.md", blockId: "local" },
    { path: "Projects/Alpha.md", blockId: "review" },
  ];
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Tasks.md",
    closed,
    resolve,
  );
  assert.equal(result.retired, 4);
  assert.match(result.text, /~~\[\[#\^local\|Local\]\]~~/);
  assert.match(result.text, /~~\[\[Projects\/Alpha#\^review\|Review\]\]~~/);
  assert.match(result.text, /~~\[\[Alpha#\^review\|Stale embed\]\]~~/);
  assert.match(result.text, /Prefix ~~\[\[Alpha#\^review\|One\]\]~~ and !\[\[Beta/);
  assert.match(result.text, /\t- !\[\[Alpha#\^review\|Protected\]\]/);
  assert.match(result.text, /!\[\[Alpha#\^review\|Fenced\]\]/);
  assert.equal(result.text.includes("\r\n"), true);
  const second = helpers.retireClosedTaskReferencesInText(
    result.text,
    "Tasks.md",
    closed,
    resolve,
  );
  assert.equal(second.changed, false);
  assert.equal(second.retired, 0);
});

test("Pomodoro marker helpers normalize every block link and preserve fences and EOLs", () => {
  const source = [
    "  - Work on [[A#^plain|Alias]] and ![[B#^embed]]",
    "  - 🍅   ~~[[C#^struck]]~~ and 🍅 🍅 [[D#^duplicate]]",
    "```md",
    "  - [[E#^fenced]]",
    "```",
  ].join("\r\n");
  const marked = helpers.rewritePomodoroMarkersInText(source, true);
  assert.match(
    marked,
    /Work on 🍅 \[\[A#\^plain\|Alias\]\] and 🍅 !\[\[B#\^embed\]\]/,
  );
  assert.match(marked, /- 🍅 ~~\[\[C#\^struck\]\]~~ and 🍅 \[\[D#\^duplicate\]\]/);
  assert.match(marked, /```md\r\n  - \[\[E#\^fenced\]\]\r\n```/);
  assert.equal(marked.includes("\r\n"), true);
  assert.equal(helpers.rewritePomodoroMarkersInText(marked, true), marked);

  const stripped = helpers.rewritePomodoroMarkersInText(marked, false);
  assert.match(stripped, /Work on \[\[A#\^plain\|Alias\]\] and !\[\[B#\^embed\]\]/);
  assert.match(stripped, /- ~~\[\[C#\^struck\]\]~~ and \[\[D#\^duplicate\]\]/);
  assert.match(stripped, /  - \[\[E#\^fenced\]\]/);
});

test("completed Pomodoro markers are normalized per occurrence", () => {
  const source = [
    "  - [[A#^plain|Alias]] and 🍅   ![[B#^embed]]",
    "  - ~~[[C#^unmarked-history]]~~ and 🍅   ~~[[D#^marked-history]]~~",
    "  - 🍅 🍅 [[E#^duplicate]] and 🍅 ![[F#^stray-embed]]",
    "```md",
    "  - [[G#^fenced]]",
    "```",
  ].join("\r\n");
  const rewritten = helpers.rewritePomodoroMarkersInText(
    source,
    helpers.completedPomodoroMarkerPolicy,
  );
  assert.match(
    rewritten,
    /🍅 \[\[A#\^plain\|Alias\]\] and !\[\[B#\^embed\]\]/,
  );
  assert.match(
    rewritten,
    /~~\[\[C#\^unmarked-history\]\]~~ and 🍅 ~~\[\[D#\^marked-history\]\]~~/,
  );
  assert.match(
    rewritten,
    /🍅 \[\[E#\^duplicate\]\] and !\[\[F#\^stray-embed\]\]/,
  );
  assert.match(rewritten, /```md\r\n  - \[\[G#\^fenced\]\]\r\n```/);
  assert.equal(
    helpers.rewritePomodoroMarkersInText(
      rewritten,
      helpers.completedPomodoroMarkerPolicy,
    ),
    rewritten,
  );
});

test("Pomodoro completion marks originals and carries clean live copies", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] Focus",
    "  - 🍅   [[Tasks#^live|Live]] and [[Tasks#^other]]",
    "  - 🍅 ![[Tasks#^embedded|Embedded]]",
    "  - ~~[[Tasks#^retired|Unmarked retirement]]~~",
    "  - 🍅   ~~[[Tasks#^marked-retired|Marked retirement]]~~",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, [
    "  - [[Tasks#^live|Live]] and [[Tasks#^other]]",
  ]);
  const replacements = new Map(
    plan.edits
      .filter((edit) => edit.type === "replaceLine")
      .map((edit) => [edit.line, edit.lineText]),
  );
  assert.equal(
    replacements.get(2),
    "  - 🍅 [[Tasks#^live|Live]] and 🍅 [[Tasks#^other]]",
  );
  assert.equal(replacements.get(3), "  - ![[Tasks#^embedded|Embedded]]");
  assert.equal(replacements.has(4), false);
  assert.equal(
    replacements.get(5),
    "  - 🍅 ~~[[Tasks#^marked-retired|Marked retirement]]~~",
  );
});

test("retirement preserves task-tree markers and unmarks Pomodoro embeds", () => {
  const source = [
    "- [ ] #task Parent",
    "  - 🍅 ![[A#^done|Task tree]]",
    "## Pomodoros",
    "- [ ] Open",
    "  - 🍅 ![[A#^done|Open session]]",
    "- [x] Done",
    "  - ![[A#^done|Done session]]",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.match(result.text, /- 🍅 ~~\[\[A#\^done\|Task tree\]\]~~/);
  assert.match(result.text, /- \[ \] Open\n  - ~~\[\[A#\^done\|Open session\]\]~~/);
  assert.match(result.text, /- \[x\] Done\n  - ~~\[\[A#\^done\|Done session\]\]~~/);
});

test("done Pomodoro retirement removes only the matching embedded marker", () => {
  const source = [
    "## Pomodoros",
    "- [x] Done",
    "  - 🍅 ![[A#^done|Retire]] and 🍅 [[B#^live|Preserve]]",
    "  - 🍅 ~~![[A#^done|Stale embed]]~~ and ~~[[C#^history]]~~",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.equal(
    result.text,
    [
      "## Pomodoros",
      "- [x] Done",
      "  - ~~[[A#^done|Retire]]~~ and 🍅 [[B#^live|Preserve]]",
      "  - ~~[[A#^done|Stale embed]]~~ and ~~[[C#^history]]~~",
    ].join("\n"),
  );
  const second = helpers.retireClosedTaskReferencesInText(
    result.text,
    "Daily.md",
    [{ path: "A.md", blockId: "done" }],
    () => "A.md",
  );
  assert.equal(second.changed, false);
  assert.equal(second.retired, 0);
});

test("retirement stops at prose boundaries and pairs strikethrough spans", () => {
  const source = [
    "- [ ] #task Parent",
    "Paragraph separating the following list.",
    "  - ![[A#^review|Protected]]",
    "- [ ] #task Other",
    "  - ~~before~~![[A#^review|Retire]]~~after~~",
    "  - ~~![[A#^review|Already struck]]~~",
  ].join("\n");
  const result = helpers.retireClosedTaskReferencesInText(
    source,
    "Tasks.md",
    [{ path: "A.md", blockId: "review" }],
    () => "A.md",
  );
  assert.equal(result.retired, 2);
  assert.match(result.text, /  - !\[\[A#\^review\|Protected\]\]/);
  assert.match(
    result.text,
    /~~before~~ ~~\[\[A#\^review\|Retire\]\]~~ ~~after~~/,
  );
  assert.match(result.text, /~~\[\[A#\^review\|Already struck\]\]~~/);
});

test("retired Pomodoro links are not copied into the next Pomodoro", () => {
  const lines = [
    "## Pomodoros",
    "- [ ] First",
    "  - ~~[[Tasks#^done|Done]]~~",
    "- [ ] Second",
  ];
  const section = helpers.findPomodorosSectionInLines(lines);
  const plan = helpers.buildPomodoroCompletionPlan(lines, section, 1);
  assert.deepEqual(plan.copiedBulletLines, []);
  assert.equal(plan.createdPomodoro, false);
});

test("retirement coordinator rewrites active editor and vault notes together", async () => {
  const harness = createInMemoryObsidianApp({
    "Daily.md": "## Pomodoros\n- [x] Focus\n  - ![[Tasks#^done|Done]]",
    "Tasks.md": [
      "- [x] #task Done ^done",
      "  - ![[#^done|Self reference]]",
    ].join("\n"),
  });
  let activeText = harness.getSource("Daily.md");
  let cursor = { line: 2, ch: 4 };
  const editor = {
    getValue: () => activeText,
    getCursor: () => cursor,
    setCursor: (next) => { cursor = next; },
    getLine: (line) => activeText.split("\n")[line] || "",
    replaceRange: (text, from, to) => {
      const lines = activeText.split("\n");
      lines[from.line] = `${lines[from.line].slice(0, from.ch)}${text}${lines[to.line].slice(to.ch)}`;
      activeText = lines.join("\n");
    },
  };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  const result = await plugin.retireClosedTaskReferences(
    [{ path: "Tasks.md", blockId: "done" }],
    { editor, activePath: "Daily.md" },
  );
  assert.equal(result.retired, 2);
  assert.match(activeText, /  - ~~\[\[Tasks#\^done\|Done\]\]~~/);
  assert.match(harness.getSource("Tasks.md"), /~~\[\[#\^done\|Self reference\]\]~~/);
});

test("no-op vault transforms and irrelevant retirement files avoid process writes", async () => {
  let processCalls = 0;
  const file = { path: "Notes.md" };
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [file],
      cachedRead: async () => "No dependency links here",
      process: async () => { processCalls += 1; },
    },
    metadataCache: {},
  };
  assert.equal(await plugin.processVaultFileText(file, (text) => text), false);
  await plugin.retireClosedTaskReferences(
    [{ path: "Tasks.md", blockId: "done" }, { path: "Tasks.md" }],
    {},
  );
  assert.equal(processCalls, 0);
});

test("ambiguity scans and notices are cached while dependency identity lines stay stable", async () => {
  notices.length = 0;
  let reads = 0;
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "Other.md" }],
      cachedRead: async () => {
        reads += 1;
        return "ordinary prose";
      },
    },
  };
  const file = { path: "Tasks.md" };
  const first = await plugin.findAmbiguousDependencyIds(
    ["abc123"],
    file,
    "- [ ] #task Target [id:: abc123] ^target\nfirst prose",
  );
  const second = await plugin.findAmbiguousDependencyIds(
    ["abc123"],
    file,
    "- [ ] #task Target [id:: abc123] ^target\nchanged prose",
  );
  assert.deepEqual([...first], []);
  assert.deepEqual([...second], []);
  assert.equal(reads, 1);

  plugin.notifyDependencyIssue(file, "ambiguity", ["duplicate"]);
  plugin.notifyDependencyIssue(file, "ambiguity", ["duplicate"]);
  assert.equal(notices.length, 1);
});

test("non-Vim open/done command retires the closed task identity", async () => {
  const plugin = new TaskStatusCyclerPlugin();
  const taskStatus = helpers.getTaskStatusForLine(
    "- [ ] #task Close through command ^close",
  );
  const editor = {};
  const view = Object.assign(new MarkdownView(), {
    editor,
    file: { path: "Tasks.md" },
  });
  plugin.app = { workspace: { getActiveFile: () => view.file } };
  plugin.getActiveTaskStatus = () => taskStatus;
  plugin.toggleActiveCheckboxOpenDone = () => true;
  let retired = null;
  plugin.retireClosedTaskReferences = async (identities) => { retired = identities; };

  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  await Promise.resolve();
  assert.deepEqual(retired, [{ path: "Tasks.md", blockId: "close" }]);
});

test("full Pomodoro completion retires embeds only after carry-forward planning", async () => {
  const daily = [
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[Root#^root|Finished work]]",
    "\t- [[Continue#^continue|Carry forward]]",
    "\t- Mix ![[Mixed#^mixed|Retire mixed]] with [[Continue#^other|Do not copy]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Root.md": "- [ ] #task Root ^root",
    "Continue.md": [
      "- [ ] #task Continue ^continue",
      "- [ ] #task Other ^other",
    ].join("\n"),
    "Mixed.md": "- [ ] #task Mixed ^mixed",
  });
  const editor = createTextEditor(daily, { line: 1, ch: 4 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-11";
  plugin.scheduleCenterEditorLineInView = () => {};

  assert.equal(
    await plugin.completeActivePomodoroTask(
      editor,
      { path: "Daily.md" },
      { pomodoroLine: 1 },
    ),
    true,
  );
  assert.match(harness.getSource("Root.md"), /^- \[x\] #task Root/);
  assert.match(
    editor.getValue(),
    /- \[x\] Focus\n\t- ~~\[\[Root#\^root\|Finished work\]\]~~\n\t- 🍅 \[\[Continue#\^continue\|Carry forward\]\]\n\t- Mix ~~\[\[Mixed#\^mixed\|Retire mixed\]\]~~ with 🍅 \[\[Continue#\^other\|Do not copy\]\]/,
  );
  assert.equal((editor.getValue().match(/Root#\^root/g) || []).length, 1);
  assert.equal((editor.getValue().match(/Mixed#\^mixed/g) || []).length, 1);
  assert.equal((editor.getValue().match(/Continue#\^continue/g) || []).length, 2);
  assert.equal((editor.getValue().match(/Continue#\^other/g) || []).length, 1);
  assert.match(
    editor.getValue(),
    /- \[ \] \(\)\n\t- \[\[Continue#\^continue\|Carry forward\]\]$/,
  );
  assert.deepEqual(editor.getCursor(), { line: 5, ch: 7 });
  assert.match(harness.getSource("Continue.md"), /^- \[\/\] #task Continue/m);
});

test("selected Done Pomodoro transclusion reopens only its cross-file root", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root|Work]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": [
      "- [x] #task Root [completion:: 2026-07-11] ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: 2026-07-11] ^child",
    ].join("\n"),
  });
  const editor = createTextEditor(daily, { line: 2, ch: 10 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.equal(
    harness.getSource("Tree.md"),
    [
      "- [ ] #task Root ^root",
      "\t- ![[#^child]]",
      "- [x] #task Child [completion:: 2026-07-11] ^child",
    ].join("\n"),
  );
  assert.equal(editor.getValue(), daily);
});

test("selected same-file Done target reopens root-only in the live editor", async () => {
  const daily = [
    "## Tasks",
    "- [x] #task Root [completion:: stale] ^root",
    "\t- ![[#^child]]",
    "- [x] #task Child [completion:: stale] ^child",
    "## Pomodoros",
    "- [ ] Focus",
    "\t- ![[#^root]]",
  ].join("\n");
  const harness = createInMemoryObsidianApp({ "Daily.md": daily });
  const editor = createTextEditor(daily, { line: 6, ch: 8 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.match(editor.getValue(), /^- \[ \] #task Root \^root/m);
  assert.match(editor.getValue(), /^- \[x\] #task Child \[completion:: stale\] \^child/m);
  assert.match(editor.getValue(), /\t- !\[\[#\^root\]\]$/m);
});

test("selected retired link reopens its root without rewriting history", async () => {
  const daily = "## Pomodoros\n- [x] History\n\t- 🍅 ~~[[Tasks#^done|Alias]]~~";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": "- [x] #task Done [completion:: stale] ^done",
  });
  const editor = createTextEditor(daily, { line: 2, ch: 18 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.equal(harness.getSource("Tasks.md"), "- [ ] #task Done ^done");
  assert.equal(editor.getValue(), daily);
});

test("incomplete selected Pomodoro transclusion still closes recursively", async () => {
  const daily = "## Pomodoros\n- [ ] Focus\n\t- ![[Tree#^root]]";
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tree.md": [
      "- [ ] #task Root ^root",
      "\t- ![[#^child]]",
      "- [*] #task Child ^child",
    ].join("\n"),
  });
  const editor = createTextEditor(daily, { line: 2, ch: 9 });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;
  plugin.getCompletionDateString = () => "2026-07-12";
  plugin.retireClosedTaskReferences = async () => ({ retired: 0, failures: [] });

  assert.equal(
    await plugin.handleActiveTaskBlockLinkOpenDone(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
    ),
    true,
  );
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Root/m);
  assert.match(harness.getSource("Tree.md"), /^- \[x\] #task Child/m);
});

test("Done Pomodoro reopens direct roots while preserving its history and layout", async () => {
  const daily = [
    "## Pomodoros",
    "- [x] Finished session",
    "\t- 🍅 ![[Tasks#^done|Embedded]] and [[Tasks#^done|Duplicate]]",
    "\t- ~~[[Tasks#^retired|Retired]]~~ and 🍅 [[Tasks#^open|Open]]",
    "\t- [[Tasks#^progress]] and [[Tasks#^next]] and [[Tasks#^canceled]]",
    "\t- [[Tasks#^custom]] and [[Missing#^missing]] and [[Bad#^stale]]",
    "- [ ] Later session",
    "\t- [[Tasks#^carry|Carry]]",
  ].join("\n");
  const tasks = [
    "- [x] #task Done [completion:: old] ^done",
    "\t- ![[#^child]]",
    "- [x] #task Done child [completion:: old] ^child",
    "- [X] #task Retired root [completion:: old] ^retired",
    "- [ ] #task Open ^open",
    "- [/] #task In progress ^progress",
    "- [*] #task Next ^next",
    "- [-] #task Canceled ^canceled",
    "- [?] #task Custom ^custom",
    "- [ ] #task Carry ^carry",
  ].join("\n");
  const harness = createInMemoryObsidianApp({
    "Daily.md": daily,
    "Tasks.md": tasks,
    "Bad.md": "- [x] #task Unreadable ^stale",
  });
  const originalRead = harness.app.vault.read;
  harness.app.vault.read = async (file) => {
    if (file.path === "Bad.md") throw new Error("unreadable");
    return originalRead(file);
  };
  const originalProcess = harness.app.vault.process;
  let tasksWrites = 0;
  harness.app.vault.process = async (file, updateSourceText) => {
    if (file.path === "Tasks.md") tasksWrites += 1;
    return originalProcess(file, updateSourceText);
  };
  const editor = createTextEditor(daily, { line: 1, ch: 5 });
  const originalCursor = editor.getCursor();
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = harness.app;

  assert.equal(
    await plugin.reopenActivePomodoroTask(
      editor,
      harness.app.vault.getAbstractFileByPath("Daily.md"),
      plugin.getActivePomodoroTaskContext(
        editor,
        plugin.getActiveTaskStatus(editor),
        "x",
      ),
    ),
    true,
  );

  const expectedDaily = daily.replace("- [x] Finished session", "- [ ] Finished session");
  assert.equal(editor.getValue(), expectedDaily);
  assert.deepEqual(editor.getCursor(), originalCursor);
  assert.equal(tasksWrites, 2, "duplicate links should not duplicate source writes");
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Done \^done/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Retired root \^retired/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[x\] #task Done child/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[ \] #task Open/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\/\] #task In progress/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\*\] #task Next/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[-\] #task Canceled/m);
  assert.match(harness.getSource("Tasks.md"), /^- \[\?\] #task Custom/m);
  assert.equal(harness.getSource("Bad.md"), "- [x] #task Unreadable ^stale");
});

test("Vim Ctrl+Enter dispatches In Progress and Next tasks through the Tasks done command", () => {
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
    let lineText = "- [/] #task Complete the regression fix";
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
    const todoCommand = "obsidian-tasks-plugin:set-status-symbol-to-space";
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
        commands: { [doneCommand]: {}, [todoCommand]: {} },
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
    lineText = "- [*] #task Preserve the existing Next behavior";
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    lineText = "- [x] #task Reopen through the Tasks command";
    actions.get("taskStatusCyclerToggleTaskOpenDone")({});
    assert.deepEqual(executedCommands, [
      doneCommand,
      doneCommand,
      todoCommand,
    ]);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
