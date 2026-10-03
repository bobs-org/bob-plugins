// Tests for the nav-stage vault-wide Depends on stage (bob-cli-3n.7).
// `docs/task-dependencies.md` §6 and §11.4 (DK ranking vectors) in bob-cli
// are authoritative; the DK vectors are copied from that section.
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

const {
  dependencyStageFieldTier,
  dependencyStageTermTier,
  dependencyStageRank,
  isDependencyStageExcludedPath,
  collectVaultDependencyCandidates,
  indexDependencyStageNotes,
  resolveDependencyStageCurrent,
  collectDependencyStageEdges,
  findDependencyStageCycle,
  compareDependencyStageCanonical,
  planDependencyStageView,
  formatDependencyStagePill,
  describeDependencyRowState,
  resolveDependencyStageEntry,
  dependencyStageRowKey,
  normalizeStageCacheTask,
  mergeStageCacheCandidates,
  locateStageDisplayText,
  editorSelectionSpansTasks,
  bulletPropertyTaskMarkKey,
  createLinkPickerPropertyItems,
  describeRemovedDependencyTarget,
  buildDependencyEditNotice,
  planDependencyEdit,
  validateBulletPropertyConfig,
  BulletPropertyPickerModal,
} = helpers;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Picker-harness stubs (nav-mirror-stage): the real modal, picker, and
// writer paths with an async vault/editor stub and a stubbed Tasks plugin,
// so the stage tests below exercise production code instead of pure
// helpers.
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
  getCursor() {
    return { line: 0, ch: 0 };
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

function stubApp(notes) {
  const store = new Map(Object.entries(notes));
  const settingsPath = ".obsidian/plugins/obsidian-tasks-plugin/data.json";
  const vault = {
    getMarkdownFiles: () =>
      [...store.keys()]
        .filter((vaultPath) => /\.md$/i.test(vaultPath))
        .map((vaultPath) => ({ path: vaultPath })),
    getAbstractFileByPath: (vaultPath) =>
      store.has(vaultPath) || vaultPath === settingsPath
        ? { path: vaultPath }
        : null,
    cachedRead: async (file) => {
      const content = store.get(file.path);
      return content === undefined ? "" : String(content);
    },
    read: async (file) => {
      if (file.path === settingsPath) {
        return JSON.stringify(compatibleTasksSettings());
      }
      return vault.cachedRead(file);
    },
    process: async (file, fn) => {
      const current = store.get(file.path) || "";
      store.set(file.path, String(fn(current)));
    },
  };
  const metadataCache = {
    getFirstLinkpathDest: (linkpath) => {
      const wanted = String(linkpath || "");
      if (!wanted || wanted.includes("#")) {
        return null;
      }
      const direct = `${wanted}.md`;
      if (store.has(direct)) {
        return { path: direct };
      }
      return null;
    },
  };
  return {
    app: {
      vault,
      metadataCache,
      workspace: { getLeavesOfType: () => [] },
    },
    store,
  };
}

function stubPlugin(notes) {
  const { app, store } = stubApp(notes);
  const plugin = new NavigationHotkeysPlugin();
  plugin.app = app;
  return { plugin, store };
}

function stubStageModal(plugin, editor, filePath, cursorLine) {
  const content = String(editor.getValue() || "");
  const lines = content.split(/\r?\n/);
  const cursor = { line: cursorLine, ch: 0 };
  const config = validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: ["x"] }],
  });
  const modal = new BulletPropertyPickerModal(
    {},
    plugin,
    editor,
    cursor,
    String(lines[cursorLine] || ""),
    config,
    { filePath },
  );
  modal.filePath = filePath;
  modal.selectedPropertyItem = {
    property: { name: "dependsOn", values: "local_task_id" },
  };
  return modal;
}

function stubRowEl() {
  const el = {
    children: [],
    titles: {},
    text: "",
    classes: [],
    classList: { add: (...names) => el.classes.push(...names) },
    createDiv(options = {}) {
      const child = stubRowEl();
      if (options.cls !== undefined) {
        child.cls = options.cls;
      }
      if (options.text !== undefined) {
        child.text = options.text;
      }
      el.children.push(child);
      return child;
    },
    createSpan(options = {}) {
      return el.createDiv(options);
    },
    createEl(_tag, options = {}) {
      return el.createDiv(options);
    },
    setText(value) {
      el.text = String(value);
    },
    appendText(value) {
      el.text += String(value);
    },
    setAttribute(key, value) {
      el.titles[key] = String(value);
    },
  };
  return el;
}

function rowTitles(el, out = []) {
  if (el.titles && el.titles.title) {
    out.push(el.titles.title);
  }
  for (const child of el.children) {
    rowTitles(child, out);
  }
  return out;
}

function dkCandidate(text, route, blockId, section) {
  return { text, route, blockId: blockId || null, section: section || null };
}

function dkPool() {
  return [
    dkCandidate("File for unemployment", "cash", "unemployment", "Money"),
    dkCandidate("Call unemployment office", "cash", null, "Money"),
    dkCandidate("Dispute North Face jacket", "cash", null, null),
    dkCandidate("Launch swarm to find hospital", "body", "hospital-swarm", "Health"),
    dkCandidate("Run e2e on sase-8v", "sase_bug_bash", "e2e-sase-8v", "Bugs"),
  ];
}

function rankedTexts(pool, query) {
  return dependencyStageRank(pool, query).map((candidate) => candidate.text);
}

test("stage ranker passes the DK contract vectors verbatim", () => {
  // DK1: a field prefix (3) outranks a word prefix (2).
  assert.deepEqual(rankedTexts(dkPool(), "unemp"), [
    "File for unemployment",
    "Call unemployment office",
  ]);
  // DK2: `route:blockId` field prefix.
  assert.deepEqual(rankedTexts(dkPool(), "cash:un"), ["File for unemployment"]);
  // DK3: word prefix.
  assert.deepEqual(rankedTexts(dkPool(), "face"), ["Dispute North Face jacket"]);
  // DK4: substring inside `hospital`.
  assert.deepEqual(rankedTexts(dkPool(), "pit"), ["Launch swarm to find hospital"]);
  // DK5: in-order subsequence only; ties keep canonical order.
  assert.deepEqual(rankedTexts(dkPool(), "uof"), [
    "Call unemployment office",
    "Dispute North Face jacket",
    "Launch swarm to find hospital",
  ]);
  // DK6: block-id field prefix.
  assert.deepEqual(rankedTexts(dkPool(), "e2e"), ["Run e2e on sase-8v"]);
  // DK7: AND across terms; 3 + 3 outranks 3 + 2.
  assert.deepEqual(rankedTexts(dkPool(), "cash unemp"), [
    "File for unemployment",
    "Call unemployment office",
  ]);
  // DK8: an empty query keeps canonical order.
  assert.deepEqual(
    rankedTexts(dkPool(), ""),
    dkPool().map((candidate) => candidate.text),
  );
});

test("stage ranker tiers match the capture ranker tier order", () => {
  assert.equal(dependencyStageFieldTier("sandwich", "sand"), 3);
  assert.equal(dependencyStageFieldTier("a sandwich", "sand"), 2);
  assert.equal(dependencyStageFieldTier("hospital", "pit"), 1);
  assert.equal(dependencyStageFieldTier("unemployment", "uof"), null);
  assert.equal(dependencyStageFieldTier("unemployment", "uet"), 0);
  assert.equal(dependencyStageFieldTier("hospital", "zzz"), null);
  // AND across terms: every term must match.
  assert.deepEqual(rankedTexts(dkPool(), "cash jacket"), [
    "Dispute North Face jacket",
  ]);
  assert.deepEqual(rankedTexts(dkPool(), "cash jacket e2e"), []);
});

test("stage pool excludes daily notes, done, templates, and dot-dirs", () => {
  assert.equal(isDependencyStageExcludedPath("2026/20261002.md"), true);
  assert.equal(isDependencyStageExcludedPath("done/old.md"), true);
  assert.equal(isDependencyStageExcludedPath("_templates/t.md"), true);
  assert.equal(isDependencyStageExcludedPath("x/_generated/t.md"), true);
  assert.equal(isDependencyStageExcludedPath("x/_conflicts/t.md"), true);
  assert.equal(isDependencyStageExcludedPath(".obsidian/t.md"), true);
  assert.equal(isDependencyStageExcludedPath("cash.md"), false);
  assert.equal(isDependencyStageExcludedPath("ref/notes.md"), false);
  assert.equal(isDependencyStageExcludedPath("inbox.md"), false);
});

function vaultNotes() {
  return [
    {
      path: "cash.md",
      content: [
        "- [ ] #task File for unemployment [id:: file-unemp] ^unemployment",
        "- [?] #task Blocked bidder ^blocked-bid",
        "- [ ] #task Hidden helper #hide ^hidden-help",
        "- [x] #task Done deal ^done-deal",
        "```",
        "- [ ] #task Fenced fake ^fenced-fake",
        "```",
      ].join("\n"),
    },
    {
      path: "body.md",
      content: [
        "- [ ] #task Launch swarm to find hospital ^hospital-swarm",
        "  - ⛓️ **DEPENDS ON:** [[#^hospital-swarm]]",
        "",
        "plain prose, not a task",
      ].join("\n"),
    },
    { path: "done/old.md", content: "- [ ] #task Archived ^archived\n" },
    {
      path: "2026/20261002.md",
      content: "- [ ] #task Daily scoped ^daily-scoped\n",
    },
  ];
}

test("stage pool collects open vault tasks with buffers as given", () => {
  const pool = collectVaultDependencyCandidates(vaultNotes(), {
    dependentPath: "cash.md",
    dependentLines: new Set([0]),
  });
  const keys = pool.map((candidate) => `${candidate.path}#${candidate.line}`);
  assert.ok(keys.includes("cash.md#1"), "blocked tasks are included");
  assert.ok(keys.includes("cash.md#2"), "#hide tasks are included");
  assert.ok(
    pool.find((candidate) => candidate.path === "cash.md" && candidate.line === 2)
      .hidden,
    "#hide is flagged so it ranks last",
  );
  assert.ok(!keys.includes("cash.md#0"), "the dependent itself is excluded");
  assert.ok(
    !keys.some((key) => key.startsWith("done/")),
    "archived notes are excluded",
  );
  assert.ok(
    !keys.some((key) => key.startsWith("2026/")),
    "daily notes are excluded",
  );
  assert.ok(
    !pool.some((candidate) => candidate.blockId === "fenced-fake"),
    "fenced code never counts",
  );
  assert.ok(
    !pool.some((candidate) => candidate.blockId === "done-deal"),
    "closed tasks are excluded from RESULTS",
  );
  assert.ok(keys.includes("body.md#0"), "cross-note tasks are included");
});

test("stage CURRENT resolves same-note, missing, closed, and non-task targets", () => {
  const notes = [
    {
      path: "body.md",
      content: [
        "- [?] #task Dependent ^dependent [id:: dep-id]",
        "  - ⛓️ **DEPENDS ON:** [[#^hospital-swarm]] • [[cash#^unemployment]] • [[#^gone]]",
        "- [ ] #task Launch swarm to find hospital ^hospital-swarm",
        "- [x] #task Finished ^finished",
        "- plain anchor ^anchor",
      ].join("\n"),
    },
    {
      path: "cash.md",
      content: "- [ ] #task File for unemployment [id:: file-unemp] ^unemployment\n",
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const notesWithNonTask = [
    {
      path: "body.md",
      content: [
        "- [?] #task Dependent ^dependent [id:: dep-id]",
        "  - ⛓️ **DEPENDS ON:** [[#^anchor]]",
        "- plain anchor ^anchor",
      ].join("\n"),
    },
  ];
  const nonTaskIndex = indexDependencyStageNotes(notesWithNonTask);
  const resolved = resolveDependencyStageCurrent(
    notes[0].content,
    0,
    "body.md",
    index,
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.rows.length, 3);
  assert.equal(resolved.rows[0].displayText, "Launch swarm to find hospital");
  assert.equal(resolved.rows[0].path, "body.md");
  assert.equal(resolved.rows[1].displayText, "File for unemployment");
  assert.equal(resolved.rows[1].path, "cash.md");
  assert.equal(resolved.rows[2].missing, true);
  assert.equal(resolved.rows[2].open, true);
  const nonTask = resolveDependencyStageCurrent(
    notesWithNonTask[0].content,
    0,
    "body.md",
    nonTaskIndex,
  );
  assert.equal(nonTask.rows[0].nonTask, true);
});

test("stage cycle guard reports the path back to the dependent", () => {
  const notes = [
    {
      path: "a.md",
      content: [
        "- [ ] #task Alpha ^alpha",
        "  - ⛓️ **DEPENDS ON:** [[b#^beta]]",
      ].join("\n"),
    },
    {
      path: "b.md",
      content: [
        "- [ ] #task Beta ^beta",
        "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]",
      ].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const alpha = dependencyStageRowKey("a.md", "alpha");
  const beta = dependencyStageRowKey("b.md", "beta");
  // Beta reaches alpha, so linking alpha to beta would close the loop.
  assert.deepEqual(findDependencyStageCycle(edges, alpha, beta), [beta, alpha]);
  assert.equal(findDependencyStageCycle(edges, alpha, "nope"), null);
});

test("stage view groups CURRENT, RESULTS, and BLOCKED with guards", () => {
  const notes = vaultNotes();
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "body.md",
    dependentLines: new Set([0]),
  });
  const current = resolveDependencyStageCurrent(
    notes[1].content,
    0,
    "body.md",
    index,
  );
  assert.equal(current.ok, true);
  // The line links to the dependent itself: CURRENT keeps it removable (R6),
  // while the RESULTS pool excludes the dependent.
  const linkedKeys = new Set(
    current.rows
      .filter((row) => row.path && row.blockId)
      .map((row) => dependencyStageRowKey(row.path, row.blockId)),
  );
  const view = planDependencyStageView({
    current: current.rows,
    candidates: pool,
    query: "cash",
    dependent: { path: "body.md", line: 0, key: "body.md\x00dependent" },
    edges,
    linkedKeys,
  });
  const sections = view.map((row) => row.stageSection);
  assert.equal(sections[0], "current");
  assert.ok(sections.includes("results"), "RESULTS section is present");
  assert.ok(sections.includes("blocked"), "BLOCKED section is present");
  const blockedAt = sections.indexOf("blocked");
  const resultsAt = sections.indexOf("results");
  assert.ok(resultsAt < blockedAt, "BLOCKED renders beneath RESULTS");
  assert.ok(
    view.length <= 60,
    `at most about 60 rows render (got ${view.length})`,
  );
  for (const row of view) {
    if (row.stageSection === "current") {
      assert.equal(row.disabled, undefined, "removing a link is always allowed");
    }
  }
  const idRow = view.find((row) => row.needsBlockIdPrompt);
  void idRow;
});

test("stage view disables cycles and unencodable targets, keeps +id rows", () => {
  const notes = [
    {
      path: "has space.md",
      content: "- [/] #task Spaced out ^spaced\n",
    },
    {
      path: "b.md",
      content: [
        "- [/] #task Beta ^beta",
        "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]",
        "- [*] #task No id yet ^noid",
      ].join("\n"),
    },
    {
      path: "a.md",
      content: "- [ ] #task Alpha ^alpha\n",
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "a.md",
    dependentLines: new Set([0]),
  });
  // Empty query shows same-note plus the In Progress and Next lanes, so the
  // In Progress / Next fixtures above stay visible without typing.
  const view = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "",
    dependent: { path: "a.md", line: 0, key: dependencyStageRowKey("a.md", "alpha") },
    edges,
    linkedKeys: new Set(),
  });
  const beta = view.find((row) => row.blockId === "beta");
  assert.equal(beta.disabled, true, "linking beta would cycle back to alpha");
  assert.match(beta.disabledReason, /cycle/);
  const spaced = view.find((row) => row.blockId === "spaced");
  assert.equal(spaced.disabled, true, "spaced paths cannot be encoded");
  const noid = view.find((row) => row.blockId === "noid");
  assert.ok(noid && !noid.disabled, "+id rows stay enabled");
  assert.equal(noid.badgeId, "noid", "the badge shows the block id");
});

test("stage pill replaces raw ids with open counts", () => {
  assert.equal(formatDependencyStagePill(0, 0), "⛓ none");
  assert.equal(formatDependencyStagePill(1, 2), "⛓ 2 · 1 open");
  const notes = [
    {
      path: "body.md",
      content: [
        "- [?] #task Dependent ^dependent",
        "  - ⛓️ **DEPENDS ON:** [[#^open-one]] • [[#^gone]]",
        "- [ ] #task Open one ^open-one",
      ].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const state = describeDependencyRowState(notes[0].content, 0, "body.md", index);
  assert.equal(state.total, 2);
  assert.equal(state.open, 2);
  assert.equal(state.pill, "⛓ 2 · 2 open");
});

test("stage cache tasks normalize across Tasks shapes, buffers win", () => {
  const modern = normalizeStageCacheTask({
    path: "cash.md",
    lineNumber: 4,
    status: { symbol: " " },
    description: "File for unemployment",
    blockId: "unemployment",
    id: "file-unemp",
    dependsOn: ["other-id"],
  });
  assert.equal(modern.path, "cash.md");
  assert.equal(modern.blockId, "unemployment");
  assert.equal(modern.idField, "file-unemp");
  assert.deepEqual(modern.dependsOn, ["other-id"]);
  assert.equal(modern.open, true);
  const legacy = normalizeStageCacheTask({
    taskLocation: { path: "body.md", lineNumber: 2 },
    statusSymbol: "?",
    text: "Blocked bidder",
  });
  assert.equal(legacy.path, "body.md");
  assert.equal(legacy.blocked, true);
  assert.equal(normalizeStageCacheTask({ description: "nowhere" }), null);
  const notes = [
    {
      path: "cash.md",
      content: "- [ ] #task Edited unsaved [id:: file-unemp] ^unemployment\n",
    },
  ];
  const merged = mergeStageCacheCandidates([modern, legacy], notes, {
    dependentPath: "cash.md",
    dependentLines: new Set(),
  });
  const cash = merged.filter((row) => row.path === "cash.md");
  assert.equal(cash.length, 1, "the open buffer wins over the cache record");
  assert.equal(cash[0].rawLine.includes("Edited unsaved"), true);
  assert.ok(
    merged.some((row) => row.path === "body.md"),
    "cache-only notes fill the pool",
  );
});

test("stage Task Link mode shows Depends on for one link and batches", () => {
  const config = {
    properties: [{ name: "dependsOn", values: "local_task_id" }],
  };
  const single = [
    {
      path: "cash.md",
      file: null,
      content: "- [ ] #task File for unemployment ^unemployment\n",
      line: 0,
      rawLine: "- [ ] #task File for unemployment ^unemployment",
      blockId: "unemployment",
      displayText: "File for unemployment",
    },
  ];
  const one = createLinkPickerPropertyItems(config, single);
  assert.equal(one.valid, true);
  assert.equal(one.items.length, 1);
  assert.equal(one.items[0].linkDependency, true);
  assert.match(one.items[0].detailText, /cash/);
  const batch = createLinkPickerPropertyItems(config, [
    single[0],
    { ...single[0], path: "body.md" },
  ]);
  assert.equal(batch.valid, true);
  assert.equal(batch.items.length, 1, "batches show Depends on like single links");
  assert.equal(batch.items[0].linkDependency, true);
});

test("stage mark keys never collide across notes", () => {
  assert.equal(
    bulletPropertyTaskMarkKey({ markKey: "b.md#3", line: 3 }),
    "b.md#3",
  );
  assert.equal(bulletPropertyTaskMarkKey({ line: 3 }), 3);
  assert.equal(bulletPropertyTaskMarkKey({}), null);
});

test("stage display-text locating matches one open task", () => {
  const content = [
    "- [ ] #task Same words",
    "- [x] #task Same words",
  ].join("\n");
  const found = locateStageDisplayText(content, "Same words");
  assert.ok(found, "closed same-text tasks never count");
  assert.equal(found.line, 0);
  assert.equal(
    locateStageDisplayText("- [ ] #task Solo\n", "Missing"),
    null,
  );
  assert.equal(
    locateStageDisplayText(
      "- [ ] #task Dupe\n- [ ] #task Dupe\n",
      "Dupe",
    ),
    null,
    "ambiguous matches refuse",
  );
});

test("stage selection refusal spans tasks only", () => {
  const content = [
    "- [ ] #task One",
    "- [ ] #task Two",
    "",
    "prose",
  ].join("\n");
  const spanning = {
    listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 1, ch: 3 } }],
  };
  assert.equal(editorSelectionSpansTasks(spanning, content), true);
  const caret = {
    listSelections: () => [{ anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } }],
  };
  assert.equal(editorSelectionSpansTasks(caret, content), false);
  const prose = {
    listSelections: () => [{ anchor: { line: 2, ch: 0 }, head: { line: 3, ch: 2 } }],
  };
  assert.equal(editorSelectionSpansTasks(prose, content), false);
  assert.equal(editorSelectionSpansTasks({}, content), false);
});

test("stage builder composes pool, current, guards, and pill title", () => {
  const proto = NavigationHotkeysPlugin.prototype;
  const notes = [
    {
      path: "body.md",
      content: [
        "- [?] #task Dependent ^dependent",
        "  - ⛓️ **DEPENDS ON:** [[#^hospital-swarm]]",
        "- [ ] #task Launch swarm to find hospital ^hospital-swarm",
      ].join("\n"),
    },
    {
      path: "cash.md",
      content: "- [/] #task File for unemployment ^unemployment\n",
    },
  ];
  const offline = {
    collectStageBufferNotes: () => new Map(),
    readStageTasksCache: () => ({ ready: false, tasks: [] }),
  };
  const stage = proto.buildVaultDependencyStageFromNotes.call(offline, notes, {
    filePath: "body.md",
    content: notes[0].content,
    parentLines: [0],
    dependencyValueSets: null,
  });
  assert.equal(stage.cacheReady, false);
  assert.equal(stage.current.length, 1);
  assert.equal(stage.openCount, 1);
  assert.equal(stage.linkedKeys.size, 1);
  assert.match(stage.title, /^⛓ Depends on · /);
  assert.match(stage.title, /Dependent/);
  const view = planDependencyStageView({
    current: stage.current,
    candidates: stage.candidates,
    query: "",
    dependent: stage.dependent,
    edges: stage.edges,
    linkedKeys: stage.linkedKeys,
    sourceValueSets: stage.sourceValueSets,
  });
  assert.equal(view[0].stageSection, "current");
  assert.ok(
    view.some((row) => row.path === "cash.md"),
    "cross-note candidates reach the stage",
  );
  assert.ok(
    !view.some(
      (row) => row.stageSection !== "current" && row.blockId === "hospital-swarm",
    ),
    "linked rows fold into CURRENT",
  );
  const cached = {
    collectStageBufferNotes: () => new Map(),
    readStageTasksCache: () => ({
      ready: true,
      tasks: [
        {
          path: "far.md",
          route: "far",
          note: "far",
          line: 3,
          rawLine: null,
          status: " ",
          displayText: "Far away task",
          text: "Far away task",
          blockId: "far-away",
          existingBlockId: "far-away",
          idField: null,
          existingIdField: null,
          section: null,
          open: true,
          blocked: false,
          hidden: false,
          dependsOn: [],
        },
      ],
    }),
  };
  const warm = proto.buildVaultDependencyStageFromNotes.call(cached, notes, {
    filePath: "body.md",
    content: notes[0].content,
    parentLines: [0],
    dependencyValueSets: null,
  });
  assert.equal(warm.cacheReady, true);
  assert.ok(
    warm.candidates.some((row) => row.path === "far.md"),
    "cache-only notes join the pool",
  );
});

test("stage entry resolves the line itself and refuses prose", () => {
  const content = [
    "- [?] #task Dependent ^dependent",
    "  - ⛓️ **DEPENDS ON:** [[#^open-one]]",
    "- [ ] #task Open one ^open-one",
    "",
    "plain prose",
  ].join("\n");
  const onLine = resolveDependencyStageEntry(content, 1);
  assert.equal(onLine.ok, true);
  assert.equal(onLine.parentLine, 0);
  assert.equal(onLine.skipPropertyStep, true);
  const onTask = resolveDependencyStageEntry(content, 0);
  assert.equal(onTask.ok, true);
  assert.equal(onTask.skipPropertyStep, false);
  const onProse = resolveDependencyStageEntry(content, 4);
  assert.equal(onProse.ok, false);
});

test("stage canonical order ranks #hide last ahead of the lane", () => {
  const dependentPath = "body.md";
  const hiddenPending = {
    path: "cash.md",
    line: 1,
    status: "/",
    hidden: true,
  };
  const visibleReady = {
    path: "cash.md",
    line: 2,
    status: " ",
    hidden: false,
  };
  assert.ok(
    compareDependencyStageCanonical(hiddenPending, visibleReady, dependentPath) > 0,
    "a hidden In Progress task sorts after a visible Ready one",
  );
  assert.ok(
    compareDependencyStageCanonical(visibleReady, hiddenPending, dependentPath) < 0,
  );
});

test("stage empty query shows same-note plus In Progress and Next only", () => {
  const notes = [
    {
      path: "body.md",
      content: [
        "- [ ] #task Dependent ^dependent",
        "- [ ] #task Same note sibling ^sibling",
      ].join("\n"),
    },
    {
      path: "cash.md",
      content: [
        "- [ ] #task Ready elsewhere ^ready-else",
        "- [/] #task Pending elsewhere ^pending-else",
        "- [*] #task Next elsewhere ^next-else",
      ].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "body.md",
    dependentLines: new Set([0]),
  });
  const view = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "",
    dependent: { path: "body.md", line: 0, key: "body.md\x00dependent" },
    edges,
    linkedKeys: new Set(),
  });
  const ids = view
    .filter((row) => row.kind !== "stage-more")
    .map((row) => row.blockId);
  assert.ok(ids.includes("sibling"), "same-note tasks stay on empty query");
  assert.ok(ids.includes("pending-else"), "In Progress stays on empty query");
  assert.ok(ids.includes("next-else"), "Next stays on empty query");
  assert.ok(
    !ids.includes("ready-else"),
    "Ready tasks from other notes need typing",
  );
});

test("stage cap appends a type-to-search-more hint row", () => {
  const candidates = [];
  for (let i = 0; i < 70; i += 1) {
    candidates.push({
      path: "cash.md",
      route: "cash",
      note: "cash",
      line: i,
      rawLine: `- [/] #task Task ${i} ^task-${i}`,
      status: "/",
      displayText: `Task ${i}`,
      text: `Task ${i}`,
      blockId: `task-${i}`,
      existingBlockId: `task-${i}`,
      idField: null,
      existingIdField: null,
      section: null,
      open: true,
      blocked: false,
      hidden: false,
    });
  }
  const view = planDependencyStageView({
    current: [],
    candidates,
    query: "Task",
    dependent: { path: "body.md", line: 0, key: "body.md\x00dependent" },
    edges: new Map(),
    linkedKeys: new Set(),
    maxRows: 60,
  });
  const more = view.find((row) => row.kind === "stage-more");
  assert.ok(more, "truncation appends the hint row");
  assert.match(more.displayText, /type to search \d+ more/);
  assert.equal(more.disabled, true);
});

test("stage BLOCKED rows carry waits-on counts and short guard reasons", () => {
  const notes = [
    {
      path: "has space.md",
      content: "- [/] #task Spaced out ^spaced\n",
    },
    {
      path: "b.md",
      content: [
        "- [/] #task Beta ^beta",
        "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]",
      ].join("\n"),
    },
    {
      path: "a.md",
      content: "- [ ] #task Alpha ^alpha\n",
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "a.md",
    dependentLines: new Set([0]),
  });
  const view = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "Beta",
    dependent: { path: "a.md", line: 0, key: dependencyStageRowKey("a.md", "alpha") },
    edges,
    linkedKeys: new Set(),
  });
  const beta = view.find((row) => row.blockId === "beta");
  assert.ok(beta, "Beta reaches the stage with a matching query");
  assert.equal(beta.disabled, true);
  assert.equal(beta.disabledReason, "would create a cycle");
  const spacedView = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "Spaced",
    dependent: { path: "a.md", line: 0, key: dependencyStageRowKey("a.md", "alpha") },
    edges,
    linkedKeys: new Set(),
  });
  const spaced = spacedView.find((row) => row.blockId === "spaced");
  assert.equal(spaced.disabledReason, "path can't be an id");
});

test("stage removal notices name the task description, not the block id", () => {
  const content = [
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [x] #task Read me [id:: Tasks__a] ^a",
  ].join("\n");
  const files = new Map([["Tasks.md", content]]);
  const named = describeRemovedDependencyTarget(
    { path: "Tasks.md", blockId: "a" },
    files,
  );
  assert.equal(named, "Read me");
  const notice = buildDependencyEditNotice(
    { added: 0, removed: 1, openRemaining: 0, blockedAfter: false, recoveredOutcome: "ready" },
    { added: [], removed: [named] },
  );
  assert.match(notice, /Read me/);
  assert.doesNotMatch(notice, /\^a/);
});

test("stage Task Link batches keep Depends on without refusal", () => {
  const config = {
    properties: [{ name: "dependsOn", values: "local_task_id" }],
  };
  const targets = [
    {
      path: "cash.md",
      content: "- [ ] #task One ^one\n",
      line: 0,
      rawLine: "- [ ] #task One ^one",
      blockId: "one",
      displayText: "One",
    },
    {
      path: "body.md",
      content: "- [ ] #task Two ^two\n",
      line: 0,
      rawLine: "- [ ] #task Two ^two",
      blockId: "two",
      displayText: "Two",
    },
  ];
  const batch = createLinkPickerPropertyItems(config, targets);
  assert.equal(batch.valid, true);
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].linkDependency, true);
  assert.match(batch.items[0].detailText, /2 linked tasks/);
});

test("stage batch cycle check runs on the post-batch graph", () => {
  const notes = [
    {
      path: "a.md",
      content: ["- [ ] #task Alpha ^alpha", "  - ⛓️ **DEPENDS ON:** [[b#^beta]]"].join("\n"),
    },
    {
      path: "b.md",
      content: ["- [ ] #task Beta ^beta", "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]"].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const alpha = dependencyStageRowKey("a.md", "alpha");
  const beta = dependencyStageRowKey("b.md", "beta");
  assert.deepEqual(findDependencyStageCycle(edges, alpha, beta), [beta, alpha]);
});

test("stage ranker filters 1,000 synthetic tasks under 16 ms per keystroke", () => {
  const pool = [];
  for (let i = 0; i < 1000; i += 1) {
    pool.push({
      text: `Synthetic task number ${i} with searchable words`,
      route: i % 2 === 0 ? "cash" : "body",
      blockId: `synthetic-${i}`,
      section: null,
    });
  }
  const start = process.hrtime.bigint();
  const ranked = dependencyStageRank(pool, "synthetic cash");
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ranked.length > 0, "synthetic pool matches");
  assert.ok(
    elapsedMs < 16,
    `filtering 1,000 tasks took ${elapsedMs.toFixed(2)} ms (budget 16 ms)`,
  );
});

// A stale single add refuses with `changed — reopen` and reopens the stage
// fresh instead of writing against the changed line.
test("stage stale single add refuses and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = [];
  plugin.openBulletPropertyPicker = async (reopenEditor, options) => {
    reopened.push(options);
    return true;
  };
  const item = {
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    stageSection: "results",
    disabled: false,
    alreadyLinked: false,
    needsBlockIdPrompt: false,
  };
  editor.content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.chooseTaskDependency(item);
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].initialProperty, "dependsOn");
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

// A `＋ id` row opens the block-ID prompt without writing: no ids are
// allocated and the editor is untouched until the id is confirmed.
test("stage +id row prompts without writing", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const prompts = [];
  modal.showBlockIdStage = (snapshot, options) => {
    prompts.push({ snapshot, options });
    return false;
  };
  const item = {
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target",
    displayText: "Target",
    stageSection: "results",
    disabled: false,
    alreadyLinked: false,
    needsBlockIdPrompt: true,
  };
  const before = notices.length;
  const applied = await modal.chooseTaskDependency(item);
  assert.equal(applied, false);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].options.mode, "single");
  assert.equal(notices.length, before);
  assert.equal(editor.content, content);
  assert.equal(editor.getLine(1), "- [ ] #task Target");
});

// Dismissing the stage mid-batch (Esc) writes nothing: dismissal drops the
// pending batch state through `onClose` and the editor is untouched.
test("stage dismissal writes no bytes and drops the batch", () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.pendingBatch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  };
  modal.modalEl = { removeClass: () => {} };
  modal.contentEl = { empty: () => {} };
  plugin.activeBulletPropertyPicker = modal;
  modal.onClose();
  assert.equal(modal.pendingBatch, null);
  assert.equal(plugin.activeBulletPropertyPicker, null);
  assert.equal(editor.content, content);
  assert.equal(editor.undoGroups, 0);
});

// A same-note marked batch commits the line, the field, and the target id
// in a single editor transaction: one undo group for the whole gesture.
test("stage same-note batch commits in one undo group", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.readDependencyVaultFileList = () => ["Tasks.md"];
  plugin.dependencyLinkpathResolver = () => () => "Tasks.md";
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const batch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [
      {
        markKey: "Tasks.md#1",
        path: "Tasks.md",
        line: 1,
        rawLine: "- [ ] #task Target ^target",
        displayText: "Target",
        existingIdField: null,
        blockId: "target",
      },
    ],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  };
  const applied = await modal.executeDependencyBatch(batch);
  assert.equal(applied, true);
  assert.equal(editor.undoGroups, 1);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/);
});

// A stale marked row refuses the whole batch before any write and reopens
// the stage fresh: no partial commit, no skip count.
test("stage batch with a stale row refuses and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.readDependencyVaultFileList = () => ["Tasks.md"];
  plugin.dependencyLinkpathResolver = () => () => "Tasks.md";
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = [];
  plugin.openBulletPropertyPicker = async (reopenEditor, options) => {
    reopened.push(options);
    return true;
  };
  const batch = {
    propertyName: "dependsOn",
    cursorLineText: "- [ ] #task Parent ^parent",
    removals: [],
    readyAdditions: [
      {
        markKey: "Tasks.md#1",
        path: "Tasks.md",
        line: 1,
        rawLine: "- [ ] #task Target ^target",
        displayText: "Target",
        existingIdField: null,
        blockId: "target",
      },
    ],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: false,
  };
  editor.content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.executeDependencyBatch(batch);
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(editor.undoGroups, 0);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

// A counted same-note stage add runs the real write: every source task gains
// the link together in the editor bytes, with no stubbed writer.
test("stage counted add applies to every source task", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.app.plugins = {
    plugins: {
      "obsidian-tasks-plugin": { getState: () => "Warm", getTasks: () => [] },
    },
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  // Real open: the modal builds its own rows from the vault pool through
  // the production counted property items, with a stubbed Tasks plugin.
  const countedConfig = validateBulletPropertyConfig({
    properties: [{ name: "dependsOn", values: "local_task_id" }],
  });
  const aggregate = helpers.createCountedBulletPropertyItems(
    countedConfig,
    content,
    modal.taskSession,
  );
  assert.equal(aggregate.valid, true, aggregate.error || "counted items build");
  const propertyItem = aggregate.items.find(
    (entry) => entry && entry.property && entry.property.name === "dependsOn",
  );
  assert.ok(propertyItem, "Depends on opens from the counted properties");
  modal.showValueStage(propertyItem);
  await sleep(25);
  const row = modal.visibleItems.find(
    (entry) => entry && entry.displayText === "Target" && !entry.disabled,
  );
  assert.ok(row, "Target reaches the stage the modal built");
  // Real apply: the row the modal built goes through the production entry.
  const applied = await modal.chooseTaskDependency(row);
  assert.equal(applied, true);
  const links = editor.content.match(/⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/g) || [];
  assert.equal(links.length, 2, `both sources link the target:\n${editor.content}`);
  assert.equal(editor.undoGroups, 1);
});

// Cycle rows stay guarded in the view the modal actually built: every added
// edge leaves the same dependent, so each row alone closes a cycle back to
// it. Marking (⇥) a guarded row is refused, and applying (↵) writes nothing.
test("stage batch cycle rows stay guarded and write nothing", async () => {
  const content = [
    "- [ ] #task Dependent ^d",
    "- [ ] #task Alpha ^a",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [ ] #task Beta ^b",
    "  - ⛓️ **DEPENDS ON:** [[#^d]]",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  plugin.app.plugins = {
    plugins: {
      "obsidian-tasks-plugin": { getState: () => "Warm", getTasks: () => [] },
    },
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  // Real open on the dependent through the production value stage.
  modal.selectedPropertyItem = {
    property: { name: "dependsOn", values: "local_task_id" },
  };
  modal.showValueStage(modal.selectedPropertyItem);
  await sleep(25);
  for (const blockId of ["a", "b"]) {
    const row = modal.visibleItems.find((entry) => entry && entry.blockId === blockId);
    assert.ok(row, `${blockId} reaches the stage the modal built`);
    assert.equal(row.disabled, true, `${blockId} stays guarded`);
    assert.match(row.disabledReason || "", /cycle/i, `${blockId} names the cycle`);
    assert.ok(row.cycle && row.cycle.length > 0, `${blockId} carries the cycle path`);
  }
  // Marking (⇥) a guarded row is refused.
  const before = notices.length;
  for (const blockId of ["a", "b"]) {
    modal.selectedIndex = modal.visibleItems.findIndex(
      (entry) => entry && entry.blockId === blockId,
    );
    modal.toggleHighlightedLocalTaskMark();
  }
  assert.equal(modal.getMarkedCount(), 0, "guarded rows never mark");
  const fresh = notices.slice(before);
  assert.equal(fresh.length, 2, `both marks refused, got: ${JSON.stringify(fresh)}`);
  for (const notice of fresh) {
    assert.match(notice, /cycle/i);
  }
  // Applying (↵) with nothing marked writes nothing.
  const applied = await modal.commitMarkedDependencies();
  assert.equal(applied, false);
  assert.equal(editor.content, content);
  assert.equal(editor.undoGroups, 0);
});

// The `edit-task-dependencies` palette command ships with no default
// hotkey: capture the real `addCommand` registration and assert it carries
// no `hotkeys`, so it opens only from the palette (or a user-bound chord).
test("stage edit-task-dependencies registers with no default hotkey", () => {
  const { plugin } = stubPlugin({ "Tasks.md": "- [ ] #task T ^t\n" });
  const registered = [];
  plugin.addCommand = (command) => {
    registered.push(command);
    return command;
  };
  plugin.addRibbonIcon = () => ({});
  plugin.registerEvent = () => {};
  plugin.registerDomEvent = () => {};
  plugin.registerInterval = () => {};
  plugin.registerEditorExtension = () => {};
  plugin.registerVimMappingsWhenReady = () => {};
  plugin.register = () => {};
  plugin.registerOpenTaskJumpInputListeners = () => {};
  plugin.registerReviewRefreshInputListeners = () => {};
  plugin.registerCountedTransclusionToggleInputListeners = () => {};
  plugin.registerCountedBulletPropertyInputListeners = () => {};
  plugin.registerCountedTaskMoveInputListeners = () => {};
  plugin.registerCountedLaneToggleInputListeners = () => {};
  plugin.registerClearSearchHighlightInputListeners = () => {};
  plugin.app.workspace.onLayoutReady = () => {};
  plugin.app.workspace.on = () => ({});
  plugin.app.workspace.getActiveFile = () => null;
  plugin.onload();
  const entry = registered.find((command) => command.id === "edit-task-dependencies");
  assert.ok(entry, "edit-task-dependencies is registered");
  assert.equal(entry.hotkeys, undefined);
});

// The BLOCKED `🔒 waits on N` badge counts open prerequisites only: one
// closed plus one open prerequisite reads `waits on 1` (DC7/DC8).
test("stage waits-on badge counts open prerequisites only", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Beta ^beta",
    "  - ⛓️ **DEPENDS ON:** [[#^alpha]] [[#^gamma]]",
    "- [ ] #task Alpha ^alpha",
    "- [x] #task Gamma ^gamma",
  ].join("\n");
  const notes = [{ path: "Tasks.md", content }];
  const plugin = new NavigationHotkeysPlugin();
  plugin.collectStageBufferNotes = () => [];
  plugin.readStageTasksCache = () => ({ ready: false, tasks: [] });
  const stage = plugin.buildVaultDependencyStageFromNotes(notes, {
    filePath: "Tasks.md",
    content,
    parentLines: [0],
  });
  const beta = stage.candidates.find(
    (candidate) => candidate.blockId === "beta",
  );
  assert.ok(beta, "Beta reaches the stage pool");
  assert.equal(beta.openCount, 1);
  const view = planDependencyStageView({
    current: [],
    candidates: stage.candidates,
    query: "Beta",
    dependent: {
      path: "Tasks.md",
      line: 0,
      key: dependencyStageRowKey("Tasks.md", "owner"),
    },
    edges: stage.edges,
    linkedKeys: new Set(),
  });
  const row = view.find((entry) => entry.blockId === "beta");
  assert.ok(row, "Beta renders in the stage view");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, 1);
});

// Disabled cycle rows tooltip the readable path: task descriptions joined
// by `→`, never raw `path blockId` keys.
test("stage cycle tooltip shows task descriptions", () => {
  const notes = [
    {
      path: "a.md",
      content: "- [ ] #task Alpha ^alpha\n",
    },
    {
      path: "b.md",
      content: [
        "- [?] #task Beta ^beta",
        "  - ⛓️ **DEPENDS ON:** [[a#^alpha]]",
      ].join("\n"),
    },
  ];
  const index = indexDependencyStageNotes(notes);
  const edges = collectDependencyStageEdges(notes, index);
  const pool = collectVaultDependencyCandidates(notes, {
    dependentPath: "a.md",
    dependentLines: new Set([0]),
  });
  const view = planDependencyStageView({
    current: [],
    candidates: pool,
    query: "Beta",
    dependent: {
      path: "a.md",
      line: 0,
      key: dependencyStageRowKey("a.md", "alpha"),
      displayText: "Alpha",
      text: "Alpha",
    },
    edges,
    linkedKeys: new Set(),
  });
  const beta = view.find((row) => row.blockId === "beta");
  assert.ok(beta, "Beta reaches the stage with a matching query");
  assert.equal(beta.disabledReason, "would create a cycle");
  assert.deepEqual(beta.cycleLabels, ["Beta", "Alpha"]);
  const picker = { markedLines: new Set() };
  const rowEl = stubRowEl();
  BulletPropertyPickerModal.prototype.renderTaskValueItem.call(
    picker,
    beta,
    rowEl,
    "Beta",
  );
  assert.ok(
    rowTitles(rowEl).includes("Beta → Alpha"),
    `cycle tooltip reads Beta → Alpha, got ${JSON.stringify(rowTitles(rowEl))}`,
  );
});

// ---------------------------------------------------------------------------
// nav-mirror-stage-fixes: the hand-edit mirror resolves its owner in burst
// baseline coordinates and maps forward, so an insertion above the owner in
// the same burst never re-aims the lookup at the next sibling.
// ---------------------------------------------------------------------------

function mirrorOffsetOfLine(content, line) {
  const lines = String(content).split("\n");
  let offset = 0;
  for (let index = 0; index < Math.min(line, lines.length - 1); index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

function mirrorFakeDoc(content) {
  return {
    toString: () => String(content),
    lineAt: (offset) => {
      const text = String(content);
      const at = Math.max(0, Math.min(offset, text.length));
      return { number: text.slice(0, at).split("\n").length };
    },
  };
}

function mirrorDeletionUpdate(before, after, fromA, toA) {
  return {
    docChanged: true,
    view: null,
    state: { doc: mirrorFakeDoc(after) },
    startState: { doc: mirrorFakeDoc(before) },
    changes: {
      iterChangedRanges: (callback) => callback(fromA, toA, fromA, fromA),
      mapPos: (pos) => {
        if (pos <= fromA) {
          return pos;
        }
        if (pos >= toA) {
          return pos - (toA - fromA);
        }
        return fromA;
      },
    },
  };
}

function mirrorInsertionUpdate(before, after, at, insertedLength) {
  return {
    docChanged: true,
    view: null,
    state: { doc: mirrorFakeDoc(after) },
    startState: { doc: mirrorFakeDoc(before) },
    changes: {
      iterChangedRanges: (callback) => callback(at, at, at, at + insertedLength),
      mapPos: (pos) => (pos < at ? pos : pos + insertedLength),
    },
  };
}

function mirrorBurstNote() {
  return [
    "# Notes",
    "- [?] #task P [dependsOn:: Tasks__a] ^p",
    "  - ⛓️ **DEPENDS ON:** [[#^a]]",
    "- [ ] #task S [dependsOn:: Tasks__b] ^s",
    "  - ⛓️ **DEPENDS ON:** [[#^b]]",
    "- [x] #task A [id:: Tasks__a] ^a",
    "- [x] #task B [id:: Tasks__b] ^b",
  ].join("\n");
}

async function runMirrorBurst(initial, updates, finalContent) {
  const { plugin } = stubPlugin({ "Tasks.md": initial });
  const editor = new TransactionEditor(initial, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  for (const [content, update] of updates) {
    editor.content = content;
    plugin.scheduleDependencyHandEditMirrorFromUpdate(update);
  }
  editor.content = finalContent;
  await sleep(1000);
  if (plugin.pendingDependencyMirror) {
    clearTimeout(plugin.pendingDependencyMirror);
    plugin.pendingDependencyMirror = null;
  }
  plugin.pendingDependencyMirrorSnapshot = null;
  return { plugin, editor };
}

function taskLine(content, blockId) {
  return String(content)
    .split("\n")
    .find((line) => line.includes(`^${blockId}`));
}

// Deleting P's Depends-On line and then inserting a line under the heading
// in the same burst clears P's field: the owner stays P in baseline
// coordinates instead of sliding to the next sibling S.
test("stage mirror burst keeps the baseline owner across an insertion above", async () => {
  const initial = mirrorBurstNote();
  const initialLines = initial.split("\n");
  // Update 1: delete P's Depends-On line (line 2) wholesale.
  const deleteFrom = mirrorOffsetOfLine(initial, 2);
  const deleteTo = mirrorOffsetOfLine(initial, 3);
  const mid = [...initialLines.slice(0, 2), ...initialLines.slice(3)].join("\n");
  // Update 2: insert a bullet under the heading (line 1 of the mid content).
  const inserted = "- new bullet\n";
  const insertAt = mirrorOffsetOfLine(mid, 1);
  const finalContent = `${mid.split("\n").slice(0, 1).join("\n")}\n${inserted}${mid.split("\n").slice(1).join("\n")}`;
  const { editor } = await runMirrorBurst(
    initial,
    [
      [mid, mirrorDeletionUpdate(initial, mid, deleteFrom, deleteTo)],
      [finalContent, mirrorInsertionUpdate(mid, finalContent, insertAt, inserted.length)],
    ],
    finalContent,
  );
  assert.match(editor.content, /- new bullet/);
  const parent = taskLine(editor.content, "p");
  assert.ok(parent, "P survives the burst");
  assert.doesNotMatch(parent, /dependsOn/, `P's field is cleared:\n${editor.content}`);
  assert.match(editor.content, /- \[ \] #task P \^p$/m);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^b\]\]/, "S keeps its line");
});

// Selecting the Depends-On line text (not a vim `dd`) and deleting it,
// then inserting above in the same burst, still clears P's field.
test("stage mirror burst clears on a text-only line deletion", async () => {
  const initial = mirrorBurstNote();
  const initialLines = initial.split("\n");
  // Update 1: delete only the line text, leaving an empty line behind.
  const deleteFrom = mirrorOffsetOfLine(initial, 2);
  const deleteTo = deleteFrom + initialLines[2].length;
  const midLines = initialLines.slice();
  midLines[2] = "";
  const mid = midLines.join("\n");
  // Update 2: insert a bullet under the heading.
  const inserted = "- new bullet\n";
  const insertAt = mirrorOffsetOfLine(mid, 1);
  const finalContent = `${mid.split("\n").slice(0, 1).join("\n")}\n${inserted}${mid.split("\n").slice(1).join("\n")}`;
  const { editor } = await runMirrorBurst(
    initial,
    [
      [mid, mirrorDeletionUpdate(initial, mid, deleteFrom, deleteTo)],
      [finalContent, mirrorInsertionUpdate(mid, finalContent, insertAt, inserted.length)],
    ],
    finalContent,
  );
  const parent = taskLine(editor.content, "p");
  assert.ok(parent, "P survives the burst");
  assert.doesNotMatch(parent, /dependsOn/, `P's field is cleared:\n${editor.content}`);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^b\]\]/, "S keeps its line");
});

// A lone vim `dd` of P's Depends-On line clears P's field (kept behaviour).
test("stage mirror vim dd clears the deleted line's owner", async () => {
  const initial = mirrorBurstNote();
  const initialLines = initial.split("\n");
  const deleteFrom = mirrorOffsetOfLine(initial, 2);
  const deleteTo = mirrorOffsetOfLine(initial, 3);
  const mid = [...initialLines.slice(0, 2), ...initialLines.slice(3)].join("\n");
  const { editor } = await runMirrorBurst(
    initial,
    [[mid, mirrorDeletionUpdate(initial, mid, deleteFrom, deleteTo)]],
    mid,
  );
  const parent = taskLine(editor.content, "p");
  assert.ok(parent, "P survives the deletion");
  assert.doesNotMatch(parent, /dependsOn/, `P's field is cleared:\n${editor.content}`);
  assert.match(editor.content, /⛓️ \*\*DEPENDS ON:\*\* \[\[#\^b\]\]/, "S keeps its line");
});

// ---------------------------------------------------------------------------
// nav-mirror-stage-fixes: BLOCKED badges never show `waits on 0`.
// ---------------------------------------------------------------------------

function blockedStageView(content, query, dependentLine = 0) {
  const notes = [{ path: "Tasks.md", content }];
  const plugin = new NavigationHotkeysPlugin();
  plugin.collectStageBufferNotes = () => [];
  plugin.readStageTasksCache = () => ({ ready: false, tasks: [] });
  const stage = plugin.buildVaultDependencyStageFromNotes(notes, {
    filePath: "Tasks.md",
    content,
    parentLines: [dependentLine],
  });
  return planDependencyStageView({
    current: [],
    candidates: stage.candidates,
    query,
    dependent: {
      path: "Tasks.md",
      line: dependentLine,
      key: dependencyStageRowKey("Tasks.md", "owner"),
    },
    edges: stage.edges,
    linkedKeys: new Set(),
  });
}

// A Blocked task with no `^blockId` counts its open prerequisite from its
// own Depends-On line: one open target reads `waits on 1`, never `waits on 0`.
test("stage badge counts open prerequisites without a block id", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Noid blocked [id:: noid-id]",
    "  - ⛓️ **DEPENDS ON:** [[#^alpha]]",
    "- [ ] #task Alpha ^alpha",
  ].join("\n");
  const view = blockedStageView(content, "Noid");
  const row = view.find((entry) => entry.displayText === "Noid blocked");
  assert.ok(row, "the block-id-less task reaches the stage");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, 1);
  assert.equal(row.blockedBadge, "🔒 waits on 1");
});

// A Blocked task with no open prerequisite but a future `scheduled` date
// reads `🔒 scheduled YYYY-MM-DD`.
test("stage badge names the future scheduled date with no open prerequisite", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Sched [scheduled:: 2999-01-01] ^sched",
  ].join("\n");
  const view = blockedStageView(content, "Sched");
  const row = view.find((entry) => entry.blockId === "sched");
  assert.ok(row, "the scheduled task reaches the stage");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, null);
  assert.equal(row.blockedBadge, "🔒 scheduled 2999-01-01");
});

// A Blocked task with no open prerequisite and no future schedule reads
// `🔒 blocked`.
test("stage badge reads blocked with nothing waiting and no schedule", () => {
  const content = [
    "- [ ] #task Owner ^owner",
    "- [?] #task Stuck ^stuck",
  ].join("\n");
  const view = blockedStageView(content, "Stuck");
  const row = view.find((entry) => entry.blockId === "stuck");
  assert.ok(row, "the stuck task reaches the stage");
  assert.equal(row.stageSection, "blocked");
  assert.equal(row.waitsOn, null);
  assert.equal(row.blockedBadge, "🔒 blocked");
});

// ---------------------------------------------------------------------------
// nav-mirror-stage-fixes: every stale path refuses with `changed — reopen`
// and reopens the stage fresh, writing nothing.
// ---------------------------------------------------------------------------

function stubReopen(plugin) {
  const reopened = [];
  plugin.openBulletPropertyPicker = async (reopenEditor, options) => {
    reopened.push(options);
    return true;
  };
  return reopened;
}

// A stale cross-note batch row refuses the whole batch before any write and
// reopens the stage fresh: no partial commit, no skip count.
test("stage vault batch with a stale row refuses and reopens", async () => {
  const owner = "- [ ] #task Parent ^parent";
  const target = "- [ ] #task Target ^target";
  const { plugin, store } = stubPlugin({ "Tasks.md": owner, "Other.md": target });
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.vaultStage = { files: new Map() };
  const reopened = stubReopen(plugin);
  store.set("Other.md", "- [ ] #task Target edited ^target");
  const batch = {
    propertyName: "dependsOn",
    cursorLineText: owner,
    removals: [],
    readyAdditions: [
      {
        markKey: "Other.md#0",
        path: "Other.md",
        line: 0,
        rawLine: target,
        displayText: "Target",
        existingIdField: null,
        blockId: "target",
      },
    ],
    promptQueue: [],
    promptIndex: 0,
    confirmedById: new Map(),
    reservedIds: new Set(),
    hasVault: true,
  };
  const before = notices.length;
  const applied = await modal.executeVaultDependencyBatch(batch);
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].initialProperty, "dependsOn");
  assert.equal(editor.content, owner);
  assert.equal(editor.undoGroups, 0);
  assert.equal(store.get("Other.md"), "- [ ] #task Target edited ^target");
});

// A stale counted vault target refuses with `changed — reopen` and reopens
// the stage fresh instead of reporting "Selected dependency changed".
test("stage counted vault add with a stale target refuses and reopens", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.taskSession = {
    explicit: true,
    targets: [{ line: 0, rawLine: "- [ ] #task First ^first" }],
  };
  editor.content = [
    "- [ ] #task First ^first",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 1,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    blockId: "target",
  });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
});

// A stale vault-commit write notifies exactly once: the real writer shows
// `changed — reopen`, so the stage only reopens fresh without a second
// notice. The editor is mutated between the stage snapshot and the real
// write, with no fake writer anywhere on the path.
test("stage vault commit with a stale write notifies once and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  const before = notices.length;
  const pending = modal.commitVaultRefs(
    [{ path: "Tasks.md", blockId: "target" }],
    [],
    { stale: 0, other: 0 },
  );
  const mutated = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  editor.content = mutated;
  const applied = await pending;
  assert.equal(applied, false);
  const fresh = notices.slice(before);
  assert.equal(
    fresh.filter((notice) => /changed — reopen/.test(notice)).length,
    1,
    `exactly one reopen notice, got: ${JSON.stringify(fresh)}`,
  );
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].initialProperty, "dependsOn");
  assert.equal(editor.content, mutated);
});

// A stale single-remove write notifies exactly once through the same real
// path: the writer's notice is the only one, and the stage reopens fresh.
test("stage single remove with a stale write notifies once and reopens", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  const before = notices.length;
  const pending = modal.removeSingleDependency({
    path: "Tasks.md",
    blockId: "target",
  });
  const mutated = [
    "- [ ] #task Parent ^parent",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target edited ^target",
  ].join("\n");
  editor.content = mutated;
  const applied = await pending;
  assert.equal(applied, false);
  const fresh = notices.slice(before);
  assert.equal(
    fresh.filter((notice) => /changed — reopen/.test(notice)).length,
    1,
    `exactly one reopen notice, got: ${JSON.stringify(fresh)}`,
  );
  assert.equal(reopened.length, 1);
  assert.equal(editor.content, mutated);
});

// The `+ id` single guard refuses a changed target and reopens fresh.
test("stage vault single +id guard refuses a stale target", async () => {
  const owner = "- [ ] #task Parent ^parent";
  const target = "- [ ] #task Target";
  const { plugin, store } = stubPlugin({ "Tasks.md": owner, "Other.md": target });
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.pendingVaultSingle = {
    snapshot: {
      path: "Other.md",
      line: 0,
      rawLine: target,
      displayText: "Target",
    },
    reservedIds: new Set(),
  };
  store.set("Other.md", "- [ ] #task Target edited");
  const before = notices.length;
  const applied = await modal.confirmVaultSingleBlockId({ id: "zz-fresh", valid: true });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
});

// The counted `+ id` guard refuses a changed target and reopens fresh.
test("stage vault counted +id guard refuses a stale target", async () => {
  const owner = "- [ ] #task First ^first";
  const target = "- [ ] #task Target";
  const { plugin, store } = stubPlugin({ "Tasks.md": owner, "Other.md": target });
  const editor = new TransactionEditor(owner, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.pendingVaultCounted = {
    snapshot: {
      path: "Other.md",
      line: 0,
      rawLine: target,
      displayText: "Target",
    },
    session: null,
    reservedIds: new Set(),
  };
  store.set("Other.md", "- [ ] #task Target edited");
  const before = notices.length;
  const applied = await modal.confirmVaultCountedBlockId({ id: "zz-fresh", valid: true });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
});

// The same-note `+ id` guard refuses a changed target and reopens fresh.
test("stage single +id guard refuses a stale target", async () => {
  const content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const reopened = stubReopen(plugin);
  modal.pendingTask = { line: 1, rawLine: "- [ ] #task Target" };
  editor.content = [
    "- [ ] #task Parent ^parent",
    "- [ ] #task Target edited",
  ].join("\n");
  const before = notices.length;
  const applied = await modal.confirmSingleBlockId({ id: "zz-fresh", valid: true });
  assert.equal(applied, false);
  assert.match(notices[before], /changed — reopen/);
  assert.equal(reopened.length, 1);
  assert.equal(editor.undoGroups, 0);
});

// A concurrent edit during a counted CURRENT remove refuses with
// `changed — reopen` and reopens the stage fresh (§6.4), writing nothing.
test("stage counted remove with a stale write refuses and reopens", async () => {
  const content = [
    "- [ ] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First [dependsOn:: Tasks__target] ^first" },
      { line: 2, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const reopened = stubReopen(plugin);
  const before = notices.length;
  const pending = modal.removeCountedDependency({
    path: "Tasks.md",
    blockId: "target",
    displayText: "Target",
  });
  const mutated = content.replace(
    "- [ ] #task Target ^target",
    "- [ ] #task Target edited ^target",
  );
  editor.content = mutated;
  const applied = await pending;
  assert.equal(applied, false);
  const fresh = notices.slice(before);
  assert.equal(
    fresh.filter((notice) => /changed — reopen/.test(notice)).length,
    1,
    `exactly one reopen notice, got: ${JSON.stringify(fresh)}`,
  );
  assert.equal(reopened.length, 1);
  assert.equal(editor.content, mutated);
});

// The counted CURRENT remove notice counts only sources that changed: with
// one source already unlinked, removing the prerequisite reports one task.
test("stage counted remove counts only changed sources", async () => {
  const content = [
    "- [ ] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First [dependsOn:: Tasks__target] ^first" },
      { line: 2, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const before = notices.length;
  const applied = await modal.removeCountedDependency({
    path: "Tasks.md",
    blockId: "target",
    displayText: "Target",
  });
  assert.equal(applied, true);
  assert.match(notices[before], /⛓ Removed from 1 task/);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
  assert.doesNotMatch(editor.content, /dependsOn/);
});

// A counted local add on `[?]` sources never recovers, so it reads zero
// extra notes through the real async vault stub.
test("counted local add on [?] sources reads zero extra notes", async () => {
  const content = [
    "- [?] #task First ^first",
    "- [?] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({
    "Tasks.md": content,
    "Other.md": "- [ ] #task Other ^other",
  });
  let reads = 0;
  const vault = plugin.app.vault;
  const originalCachedRead = vault.cachedRead;
  vault.cachedRead = async (file) => {
    reads += 1;
    return originalCachedRead(file);
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [?] #task First ^first" },
      { line: 1, rawLine: "- [?] #task Second ^second" },
    ],
  };
  const applied = await modal.chooseCountedTaskDependency({
    path: "Tasks.md",
    line: 2,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
  });
  assert.equal(applied, true);
  assert.equal(reads, 0, `counted add read ${reads} extra notes`);
  const links = editor.content.match(/⛓️ \*\*DEPENDS ON:\*\* \[\[#\^target\]\]/g) || [];
  assert.equal(links.length, 2, `both sources link the target:\n${editor.content}`);
});

// A counted local toggle-off on a Pomodoro-linked `[?]` source still reads
// the vault snapshot and recovers the source to `[*]`.
test("counted local toggle-off on a Pomodoro-linked [?] source recovers", async () => {
  const content = [
    "- [?] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [x] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const dailyPath = `${now.getFullYear()}/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.md`;
  const dailyNote = [
    "## Pomodoros",
    "- [ ] 10:00 Focus",
    "  - [[Tasks#^first]]",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content, [dailyPath]: dailyNote });
  let reads = 0;
  const vault = plugin.app.vault;
  const originalCachedRead = vault.cachedRead;
  vault.cachedRead = async (file) => {
    reads += 1;
    return originalCachedRead(file);
  };
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  plugin.getActiveMarkdownView = () => ({
    editor,
    file: { path: "Tasks.md" },
  });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [?] #task First [dependsOn:: Tasks__target] ^first" },
    ],
  };
  const applied = await modal.chooseCountedTaskDependency({
    path: "Tasks.md",
    line: 2,
    rawLine: "- [x] #task Target [id:: Tasks__target] ^target",
    displayText: "Target",
  });
  assert.equal(applied, true);
  assert.ok(reads > 0, `toggle-off read ${reads} extra notes`);
  assert.doesNotMatch(editor.content, /DEPENDS ON/);
  assert.match(editor.content, /- \[\*\] #task First\b/m);
});

// The vault counted-add notice counts only sources that changed: with one
// source already carrying the link, adding reports one task.
test("stage counted vault add counts only changed sources", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [?] #task Second [dependsOn:: Tasks__target] ^second",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Target [id:: Tasks__target] ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [?] #task Second [dependsOn:: Tasks__target] ^second" },
    ],
  };
  const before = notices.length;
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 3,
    rawLine: "- [ ] #task Target [id:: Tasks__target] ^target",
    displayText: "Target",
    existingIdField: "Tasks__target",
    blockId: "target",
  });
  assert.equal(applied, true);
  assert.match(notices[before], /⛓ Linked 1 task/);
});

// The vault counted-remove notice counts only sources that changed: with
// one source already unlinked, removing reports one task.
test("stage counted vault remove counts only changed sources", async () => {
  const content = [
    "- [ ] #task First [dependsOn:: Tasks__target] ^first",
    "  - ⛓️ **DEPENDS ON:** [[#^target]]",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First [dependsOn:: Tasks__target] ^first" },
      { line: 2, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const before = notices.length;
  const applied = await modal.applyVaultCountedDependencyRef({
    path: "Tasks.md",
    line: 3,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    blockId: "target",
    remove: true,
  });
  assert.equal(applied, true);
  assert.match(notices[before], /⛓ Removed from 1 task/);
});
