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
const fs = require("node:fs");
const path = require("node:path");

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

// A counted same-note stage add fans out through the counted session in one
// call: every source task gains the link together.
test("stage counted add applies to every source task", async () => {
  const content = [
    "- [ ] #task First ^first",
    "- [ ] #task Second ^second",
    "- [ ] #task Target ^target",
  ].join("\n");
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  modal.taskSession = {
    explicit: true,
    targets: [
      { line: 0, rawLine: "- [ ] #task First ^first" },
      { line: 1, rawLine: "- [ ] #task Second ^second" },
    ],
  };
  const calls = [];
  plugin.applyCountedLocalTaskDependency = async (
    callEditor,
    cursor,
    filePath,
    session,
    task,
  ) => {
    calls.push({ cursor, filePath, session, task });
    return true;
  };
  const item = {
    path: "Tasks.md",
    line: 2,
    rawLine: "- [ ] #task Target ^target",
    displayText: "Target",
    disabled: false,
    needsBlockIdPrompt: false,
  };
  const applied = await modal.chooseCountedTaskDependency(item);
  assert.equal(applied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filePath, "Tasks.md");
  assert.equal(calls[0].session.targets.length, 2);
  assert.equal(calls[0].task, item);
});

// Two marked rows whose links close a cycle are guarded on the post-batch
// graph: the batch refuses and nothing is written.
test("stage batch cycle of two marked rows writes nothing", async () => {
  const content = "- [ ] #task Dependent ^d\n";
  const { plugin } = stubPlugin({ "Tasks.md": content });
  const editor = new TransactionEditor(content, { line: 0, ch: 0 });
  const modal = stubStageModal(plugin, editor, "Tasks.md", 0);
  const dependentKey = dependencyStageRowKey("Tasks.md", "d");
  const aKey = dependencyStageRowKey("Tasks.md", "a");
  const bKey = dependencyStageRowKey("Tasks.md", "b");
  modal.vaultStage = {
    dependent: { key: dependentKey },
    edges: new Map([
      [aKey, [bKey]],
      [bKey, [dependentKey]],
    ]),
    files: new Map([["Tasks.md", content]]),
  };
  const writes = [];
  plugin.applyDependencyEdit = async () => {
    writes.push(true);
    return { ok: true, notice: "⛓ Dependencies updated" };
  };
  const before = notices.length;
  const applied = await modal.commitVaultRefs(
    [
      { path: "Tasks.md", blockId: "a" },
      { path: "Tasks.md", blockId: "b" },
    ],
    [],
    { stale: 0, other: 0 },
  );
  assert.equal(applied, false);
  assert.equal(writes.length, 0);
  assert.match(notices[before], /cycle/);
  assert.equal(editor.content, content);
});

// The `edit-task-dependencies` palette command ships with no default
// hotkey: it opens only from the palette (or a user-bound chord).
test("stage edit-task-dependencies registers with no default hotkey", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-navigation-hotkeys", "main.js"),
    "utf8",
  );
  const anchor = source.indexOf('id: "edit-task-dependencies"');
  assert.ok(anchor >= 0, "edit-task-dependencies is registered");
  const blockEnd = source.indexOf("});", anchor);
  assert.ok(blockEnd > anchor, "registration block closes");
  const block = source.slice(anchor, blockEnd);
  assert.doesNotMatch(block, /hotkeys/);
  assert.match(block, /openDependencyStageAtCursor/);
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
