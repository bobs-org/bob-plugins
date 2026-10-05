const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dependencyStageFieldTier,
  dependencyStageRank,
  resolveDependencyStageCurrent,
  isDependencyStageExcludedPath,
  collectVaultDependencyCandidates,
  indexDependencyStageNotes,
  collectDependencyStageEdges,
  findDependencyStageCycle,
  planDependencyStageView,
  dependencyStageRowKey,
  normalizeStageCacheTask,
  mergeStageCacheCandidates,
  locateStageDisplayText,
  editorSelectionSpansTasks,
  bulletPropertyTaskMarkKey,
  createLinkPickerPropertyItems,
  NavigationHotkeysPlugin,
} = require("./navigation-dependencies-stage-harness.cjs");

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

