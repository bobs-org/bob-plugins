// Bottom command sheet: fuzzy ranking, frecency, row building, sections,
// list keys, and the modal's preview-first, confirm, report, and help flows.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  helpers,
  fixtureCatalog,
  makeRunner,
  installDocument,
  makeApp,
} = require("./command-mode-harness.cjs");
const { pressKey } = require("./modal-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");

function sheetCatalog() {
  const base = fixtureCatalog();
  return {
    ...base,
    sections: [
      { id: "daily", title: "Daily workflow" },
      { id: "vault", title: "Vault" },
    ],
    aliases: [{ from: ["ref", "clip"], to: ["ref", "create"] }],
    entries: [
      ...base.entries,
      {
        id: "vault-sync", path: ["vault-sync", "run"], fixed: [], title: "Sync vault now",
        about: "Run one reconcile cycle", section: "vault", keywords: ["syncs", "sync", "push"],
        effect: "syncs", network: true, presentation: "action",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "ref-rename", path: ["ref", "rename"], fixed: [], title: "Rename a reference",
        about: "Rename", section: "vault", keywords: ["rename"],
        effect: "syncs", network: false, presentation: "action",
        policy: "preview-first", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [
          { name: "REF", slot: "ref", required: true, repeat: false },
          { name: "NAME", slot: "text", required: true, repeat: false },
        ],
        exit_codes: [], adapter: null, hosts: [], invalidates: ["references"],
      },
      {
        id: "task-archive", path: ["task", "archive"], fixed: [], title: "Archive done tasks",
        about: "Archive", section: "daily", keywords: ["archive"],
        effect: "writes", network: false, presentation: "action",
        policy: "confirm", preview: null, confirm: "Archive every done task?",
        budget_secs: 60, args: [], exit_codes: [], adapter: null, hosts: [], invalidates: ["tasks"],
      },
      {
        id: "ref-today", path: ["ref", "today"], fixed: [], title: "Pull reading into today's Pomodoro",
        about: "Pull", section: "vault", keywords: ["today", "pomodoro"],
        effect: "writes", network: false, presentation: "action",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "NOTE", slot: "ref", required: true, repeat: false }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "ref-show", path: ["ref", "show"], fixed: [], title: "Show reference",
        about: "Show", section: "vault", keywords: ["show"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "NOTE", slot: "ref", required: true, repeat: false }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "ref-queue", path: ["capture"], fixed: [], title: "Queue link for reading",
        about: "Queue", section: "daily", keywords: ["reading", "queue", "url"],
        effect: "writes", network: false, presentation: "action",
        policy: "run", preview: ["--dry-run"], confirm: null, budget_secs: 60,
        args: [{ name: "TEXT", slot: "url", required: false, repeat: true }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "ref-find", path: ["ref", "find"], fixed: [], title: "Find in library",
        about: "Find", section: "vault", keywords: ["find", "library"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "QUERY", slot: "ref-query", required: true, repeat: false }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "articles-outline", path: ["articles", "outline"], fixed: [], title: "Article outline",
        about: "Outline", section: "vault", keywords: ["outline"],
        effect: "reads", network: false, presentation: "report",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "NOTE", slot: "article-note", required: true, repeat: false }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
    ],
  };
}

function sheetText(el) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.textContent) parts.push(node.textContent);
    for (const child of node.children || []) walk(child);
  };
  walk(el);
  return parts.join(" ");
}

function rankIds(query, rows, frecency) {
  return helpers.cmRankSheetRows(query, rows, frecency || {}).map((row) => row.key);
}

test("fuzzy ranking matches every token and prefers paths, prefixes, and keywords", () => {
  const rows = helpers.cmSheetEntryRows(sheetCatalog(), null);
  assert.ok(rankIds("sync", rows).includes("entry:vault-sync"));
  assert.equal(rankIds("sync", rows)[0], "entry:vault-sync");
  // Multi-token AND: both words must match somewhere on the row.
  assert.deepEqual(rankIds("sync vault", rows), ["entry:vault-sync"]);
  assert.deepEqual(rankIds("sync zebra", rows), []);
  // Exact keyword hit beats a plain subsequence: "clip" is a ref-create keyword.
  assert.equal(rankIds("clip", rows)[0], "entry:ref-create");
  // Alias text matches with weight: "ref clip" finds ref-create first.
  assert.equal(rankIds("ref clip", rows)[0], "entry:ref-create");
});

test("bare capture has no row but named capture rows keep theirs", () => {
  const catalog = {
    ...sheetCatalog(),
    entries: [
      ...sheetCatalog().entries,
      {
        id: "ref-queue", path: ["capture"], fixed: [], title: "Queue link for reading",
        about: "Queue", section: "daily", keywords: ["queue"],
        effect: "writes", network: false, presentation: "action",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "TEXT", slot: "url", required: false, repeat: true }],
        exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
      {
        id: "pomodoro-start", path: ["capture"], fixed: ["="], title: "Start next Pomodoro",
        about: "Start", section: "daily", keywords: ["pomodoro", "start"],
        effect: "writes", network: false, presentation: "action",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [], exit_codes: [], adapter: null, hosts: [], invalidates: [],
      },
    ],
  };
  const keys = helpers.cmSheetEntryRows(catalog, null).map((row) => row.key);
  assert.ok(!keys.includes("entry:ref-queue"), "bare capture path is excluded from the sheet");
  assert.ok(keys.includes("entry:pomodoro-start"), "named capture rows keep their row");
});

test("unavailable rows stay visible with reasons", () => {
  const catalog = sheetCatalog();
  const gated = {
    ...catalog,
    entries: catalog.entries.map((entry) => (entry.id === "plan" ? { ...entry, hosts: ["elsewhere"] } : entry)),
  };
  const rows = helpers.cmSheetEntryRows(gated, "athena");
  assert.equal(rows.find((row) => row.key === "entry:plan").unavailable, "Unavailable here");
  const surfaces = helpers.cmSheetSurfaceRows(() => false);
  assert.ok(surfaces.every((row) => row.unavailable));
  assert.match(surfaces[0].unavailable, /Enable /);
  const open = helpers.cmSheetSurfaceRows((id) => id === "bob-ledger-tools:open-today-daily-note");
  assert.equal(open[0].unavailable, null);
  assert.ok(open[1].unavailable);
});

test("frecency weights recent runs and the last-ten window", () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const run = (daysAgo, index) => ({
    entry_id: "plan",
    host: "athena",
    started_at: new Date(now - daysAgo * 86400000).toISOString(),
    finished_at: new Date(now - daysAgo * 86400000).toISOString(),
    id: "run-" + index,
  });
  assert.equal(helpers.cmSheetFrecency([run(1)], "entry:plan", now, "athena"), 100);
  assert.equal(helpers.cmSheetFrecency([run(10)], "entry:plan", now, "athena"), 70);
  assert.equal(helpers.cmSheetFrecency([run(20)], "entry:plan", now, "athena"), 50);
  assert.equal(helpers.cmSheetFrecency([run(60)], "entry:plan", now, "athena"), 30);
  assert.equal(helpers.cmSheetFrecency([run(200)], "entry:plan", now, "athena"), 10);
  // Other hosts do not count; runs from before hosts were tracked do.
  assert.equal(helpers.cmSheetFrecency([{ ...run(1), host: "apollo" }], "entry:plan", now, "athena"), 0);
  assert.equal(helpers.cmSheetFrecency([{ ...run(1), host: null }], "entry:plan", now, "athena"), 100);
  const eleven = Array.from({ length: 11 }, (_, index) => run(1, index));
  assert.equal(helpers.cmSheetFrecency(eleven, "entry:plan", now, "athena"), 1000);
  // Frecency breaks ranking ties after the score.
  const rows = helpers.cmSheetEntryRows(sheetCatalog(), "athena");
  const tied = rows.filter((row) => ["entry:plan", "entry:ready"].includes(row.key));
  const frecency = { "entry:plan": 0, "entry:ready": 500 };
  assert.deepEqual(rankIds("rea", tied, frecency)[0], "entry:ready");
});

test("context rows fill For this note and From clipboard", () => {
  const catalog = sheetCatalog();
  const refRows = helpers.cmSheetContextRows(catalog, { notePath: "refs/a.md", noteKind: "ref" });
  assert.deepEqual(
    refRows.map((row) => row.entryId),
    ["ref-today", "ref-show", "ref-rename", "ref-create"],
  );
  assert.deepEqual(refRows[0].userArgs, ["refs/a.md"]);
  assert.equal(refRows[0].tagline, "Pull into today's Pomodoro");
  const areaRows = helpers.cmSheetContextRows(catalog, { notePath: "areas/w.md", noteKind: "area" });
  assert.ok(areaRows.some((row) => row.entryId === "ready"));
  assert.ok(areaRows.some((row) => row.entryId === "ref-create" && row.tagline === "Snapshot note to Highlights"));
  const clipRows = helpers.cmSheetContextRows(catalog, { clipboardUrl: "https://example.com/p.pdf" });
  assert.ok(clipRows.some((row) => row.entryId === "ref-queue"));
  assert.ok(clipRows.some((row) => row.entryId === "ref-find"));
  const junk = helpers.cmSheetContextRows(catalog, { clipboardUrl: "not a url" });
  assert.equal(junk.length, 0);
  // Unknown entries never produce rows.
  assert.equal(helpers.cmSheetContextRows({ entries: [] }, { notePath: "x.md", noteKind: "ref" }).length, 0);
});

test("note kinds follow frontmatter type with the article rule", () => {
  assert.equal(helpers.cmSheetNoteKind("[[ref]]", false), "ref");
  assert.equal(helpers.cmSheetNoteKind(["done", "[[Project]]"], false), "project");
  assert.equal(helpers.cmSheetNoteKind(null, true), "article");
  assert.equal(helpers.cmSheetNoteKind("[[Article]]", false), "article");
  assert.equal(helpers.cmSheetNoteKind("misc", false), "note");
  assert.equal(helpers.cmSheetNoteKind(undefined, false), "note");
});

test("empty query groups RECENT, note, clipboard, then catalog sections", () => {
  const catalog = sheetCatalog();
  const recent = [{
    key: "entry:plan", kind: "recent", path: ["plan"], title: "Today's plan",
    about: "", argv: ["plan"], entryId: "plan", presentation: "report",
    policy: "run", outcome: "completed", glyph: "✓", age: "2h", duration: 1000, icon: "recent",
  }];
  const rows = [
    ...recent,
    ...helpers.cmSheetContextRows(catalog, { notePath: "refs/a.md", noteKind: "ref", clipboardUrl: "https://example.com/x" }),
    ...helpers.cmSheetEntryRows(catalog, null),
  ];
  const groups = helpers.cmGroupSheetRows(rows, catalog, { notePath: "refs/a.md", clipboardUrl: "https://example.com/x" });
  assert.deepEqual(groups.map((group) => group.id), ["recent", "context", "clipboard", "daily", "vault"]);
  assert.match(groups[1].title, /FOR THIS NOTE · refs\/a\.md/);
  assert.match(groups[2].title, /FROM CLIPBOARD/);
});

test("list keys map to intents and plain text stays unhandled", () => {
  const key = (k, extra) => helpers.cmSheetListAction({ key: k, ...(extra || {}) }, { query: "" });
  assert.equal(key("Enter").type, "run");
  assert.equal(key("Enter", { shiftKey: true }).type, "preview");
  assert.equal(key("Enter", { ctrlKey: true }).type, "run-now");
  assert.equal(key("Tab").type, "args");
  assert.equal(key("ArrowDown").type, "down");
  assert.equal(key("n", { ctrlKey: true }).type, "down");
  assert.equal(key("ArrowUp").type, "up");
  assert.equal(key("Escape").type, "close");
  assert.equal(key("Backspace").type, "close");
  assert.equal(helpers.cmSheetListAction({ key: "Backspace" }, { query: "x" }).type, "none");
  assert.equal(helpers.cmSheetListAction({ key: "?" }, { query: "pla?" }).type, "help");
  assert.equal(helpers.cmSheetListAction({ key: "?" }, { query: "pla" }).type, "none");
  assert.equal(key("j").type, "none");
  assert.equal(key("Enter", { metaKey: true }).type, "none");
});

test("help argv targets the selected row or bare bob", () => {
  assert.deepEqual(helpers.cmSheetHelpArgv({ basePath: ["ref", "create"] }), ["ref", "create", "--help"]);
  assert.deepEqual(helpers.cmSheetHelpArgv(null), ["--help"]);
});

test("median duration hides fast rows under the two-second floor", () => {
  const runs = [3000, 4000, 9000].map((ms, index) => ({
    entry_id: "plan", host: "athena", duration_ms: ms,
    started_at: "2026-10-26T0" + index + ":00:00.000Z",
    finished_at: "2026-10-26T0" + index + ":00:00.000Z",
    id: "run-" + index, argv: ["plan"],
  }));
  assert.equal(helpers.cmSheetMedianDuration(runs, { key: "entry:plan", entryId: "plan" }, "athena"), 4000);
  const fast = runs.map((run) => ({ ...run, duration_ms: 500 }));
  assert.equal(helpers.cmSheetMedianDuration(fast, { key: "entry:plan", entryId: "plan" }, "athena"), null);
});

function sheetHarness(catalog) {
  const restore = installDocument();
  const base = makeRunner({ catalog });
  base.runner.deps.env = {
    ...process.env,
    XDG_STATE_HOME: base.tmpState,
    PATH: "/usr/bin:/bin",
    FAKE_BOB_EXIT: "0",
  };
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  const app = makeApp();
  app.commands = { commands: {}, executeCommandById: async () => ({ ok: true }) };
  app.metadataCache = { getFileCache: () => null };
  const plugin = {
    app,
    commandModeCatalog: catalog,
    commandModeRunner: base.runner,
    commandModeSheet: null,
    commandModeOpenPath: () => ({ ok: true }),
    commandModeOpenOutput: (id) => ({ ok: true, runId: id }),
  };
  return { restore, base, app, plugin };
}

function openSheet(plugin, options) {
  const modal = new helpers.CommandModeSheetModal(plugin.app, plugin, {
    surfaceAvailable: () => true,
    context: { notePath: null, noteKind: null, clipboardUrl: null },
    ...(options || {}),
  });
  plugin.commandModeSheet = modal;
  modal.open();
  return modal;
}

test("the open command focuses an already-open sheet", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    assert.ok(plugin.commandModeCatalog);
    const modal = openSheet(plugin);
    assert.equal(modal.stage, "list");
    assert.ok(modal.visible.length > 0);
    assert.equal(modal.selectedKey, modal.visible[0].key);
    modal.query = "sync vault";
    modal.rebuildRows();
    modal.render();
    assert.equal(modal.visible[0].key, "entry:vault-sync");
    modal.close();
  } finally {
    restore();
  }
});

test("Enter on a report row streams it in the sheet output stage", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "today plan";
    modal.rebuildRows();
    modal.render();
    const row = modal.selectedRow();
    assert.equal(row.key, "entry:plan");
    const settled = await modal.activateRow(row, {});
    assert.ok(settled.runId);
    assert.equal(modal.stage, "output");
    assert.equal(modal.outputRunId, settled.runId);
    assert.ok(modal.outputView);
    modal.close();
  } finally {
    restore();
  }
});

test("confirm rows need Ctrl+Enter and run confirmed", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "archive done";
    modal.rebuildRows();
    modal.render();
    const row = modal.selectedRow();
    assert.equal(row.key, "entry:task-archive");
    await modal.activateRow(row, {});
    assert.equal(modal.stage, "confirm");
    assert.match(sheetText(modal.contentEl), /Archive every done task\?/);
    const settled = await modal.confirmRun();
    assert.ok(settled.runId);
    assert.equal(modal.sheetOpen, false);
  } finally {
    restore();
  }
});

test("Shift+Enter previews first and Apply reruns without the preview flag", async () => {
  const { restore, base, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin, {
      context: { notePath: "refs/a.md", noteKind: "ref", clipboardUrl: null },
    });
    const row = modal.rows.find((candidate) => candidate.key === "ctx:ref-rename:[\"refs/a.md\"]");
    assert.ok(row);
    const settled = await modal.runPreview({ ...row, userArgs: ["refs/a.md", "New name"] }, ["ref", "rename", "refs/a.md", "New name"]);
    assert.ok(settled.runId);
    assert.equal(modal.stage, "output");
    assert.ok(modal.previewOf);
    const previewRecord = helpers.cmPagerFindRecord(base.runner, settled.runId);
    assert.ok(previewRecord.argv.includes("--dry-run"));
    const applied = await modal.applyPreview();
    assert.ok(applied.runId);
    const appliedRecord = helpers.cmPagerFindRecord(base.runner, applied.runId);
    assert.ok(!appliedRecord.argv.includes("--dry-run"));
    assert.deepEqual(appliedRecord.argv.slice(-2), ["refs/a.md", "New name"]);
    modal.close();
  } finally {
    restore();
  }
});

test("missing positionals enter argument mode instead of running", async () => {
  const { restore, base, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "rename a reference";
    modal.rebuildRows();
    modal.render();
    const row = modal.selectedRow();
    assert.equal(row.key, "entry:ref-rename");
    const before = base.runner.newestRecord();
    const result = await modal.activateRow({ ...row, userArgs: [] }, {});
    assert.equal(result.ok, true);
    assert.equal(result.stage, "args");
    assert.equal(modal.stage, "args");
    const argumentResult = await modal.runArgumentStage();
    assert.equal(argumentResult.ok, false);
    assert.match(modal.hint, /REF/);
    assert.equal(base.runner.newestRecord(), before);
    modal.close();
  } finally {
    restore();
  }
});

test("a trailing ? runs help for the selected row in the output stage", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "sync?";
    modal.rebuildRows();
    modal.render();
    assert.equal(modal.selectedRow().key, "entry:vault-sync");
    const action = helpers.cmSheetListAction({ key: "?" }, { query: modal.query });
    assert.equal(action.type, "help");
    const settled = await modal.showHelp();
    assert.ok(settled.runId);
    assert.equal(modal.stage, "output");
    modal.close();
  } finally {
    restore();
  }
});

test("watching the sheet output suppresses the finish toast", async () => {
  const { restore, base, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    const settled = await modal.runReport(
      { entryId: "plan", title: "Today's plan", basePath: ["plan"], presentation: "report", policy: "run", required: [] },
      ["plan"],
      {},
    );
    assert.ok(settled.runId);
    const watching = plugin.commandModeSheet === modal &&
      modal.sheetOpen && modal.stage === "output" &&
      (String(modal.outputRunId) === String(settled.runId) || String(modal.previewRunId) === String(settled.runId));
    assert.equal(watching, true);
    modal.backToList();
    assert.equal(modal.stage, "list");
    modal.close();
  } finally {
    restore();
  }
});

test("unavailable rows never activate", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    const result = await modal.activateRow({ key: "x", unavailable: "Enable x" }, {});
    assert.equal(result.ok, false);
    modal.close();
  } finally {
    restore();
  }
});
