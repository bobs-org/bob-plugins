// Sheet sequences: marking, tray, keys, review card, and RECENT rows.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    entries: [
      ...base.entries,
      {
        id: "vault-sync", path: ["vault-sync", "run"], fixed: [], title: "Sync vault now",
        about: "Run one reconcile cycle", section: "vault", keywords: ["sync"],
        effect: "syncs", network: false, presentation: "action",
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
        id: "ref-show", path: ["ref", "show"], fixed: [], title: "Show reference",
        about: "Show", section: "vault", keywords: ["show"],
        effect: "reads", network: false, presentation: "action",
        policy: "run", preview: null, confirm: null, budget_secs: 60,
        args: [{ name: "NOTE", slot: "ref", required: true, repeat: false }],
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

function findByKey(modal, key) {
  return modal.visible.find((row) => row && row.key === key);
}

function markSelected(modal) {
  pressKey(modal, "m", { ctrlKey: true });
}

test("marking, toggling, and renumbering", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    const plan = findByKey(modal, "entry:plan");
    const sync = modal.visible.find((row) => row.key === "entry:vault-sync");
    assert.ok(plan && sync);
    modal.selectedKey = plan.key;
    markSelected(modal);
    assert.equal(modal.sequenceMarks.length, 1);
    modal.selectedKey = sync.key;
    markSelected(modal);
    assert.equal(modal.sequenceMarks.length, 2);
    assert.deepEqual(modal.sequenceMarks.map((mark) => mark.entry_id), ["plan", "vault-sync"]);
    modal.selectedKey = plan.key;
    markSelected(modal);
    assert.equal(modal.sequenceMarks.length, 1);
    assert.equal(modal.sequenceMarks[0].entry_id, "vault-sync");
    modal.close();
  } finally {
    restore();
  }
});

test("the badge and tray text", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    const plan = findByKey(modal, "entry:plan");
    modal.selectedKey = plan.key;
    markSelected(modal);
    const text = sheetText(modal.contentEl);
    assert.match(text, /SEQUENCE/);
    assert.match(text, /Run 1/);
    const sync = modal.visible.find((row) => row.key === "entry:vault-sync");
    modal.selectedKey = sync.key;
    markSelected(modal);
    const again = sheetText(modal.contentEl);
    assert.match(again, /Run 2/);
    assert.match(again, /vault-sync run/);
    modal.close();
  } finally {
    restore();
  }
});

test("query select-all after a mark", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "plan";
    modal.inputEl.value = "plan";
    modal.rebuildRows();
    modal.render();
    modal.inputEl.value = "plan";
    const row = modal.selectedRow();
    assert.ok(row);
    markSelected(modal);
    assert.equal(modal.inputEl.selectionStart, 0);
    assert.equal(modal.inputEl.selectionEnd, String(modal.inputEl.value || "").length);
    modal.close();
  } finally {
    restore();
  }
});

test("each refusal reason", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    const surface = modal.visible.find((row) => row.kind === "surface");
    assert.ok(surface);
    assert.equal(helpers.cmSheetSequenceStep(surface, modal.catalog).refused, "Only bob commands can join a sequence");
    const plain = modal.visible.find((row) => row.kind === "plain");
    assert.ok(plain);
    assert.equal(helpers.cmSheetSequenceStep(plain, modal.catalog).refused, "Only bob commands can join a sequence");
    const gated = {
      ...sheetCatalog(),
      entries: sheetCatalog().entries.map((entry) => (entry.id === "plan" ? { ...entry, hosts: ["elsewhere"] } : entry)),
    };
    const gatedRows = helpers.cmSheetEntryRows(gated, "athena");
    const blocked = gatedRows.find((row) => row.key === "entry:plan");
    assert.equal(helpers.cmSheetSequenceStep(blocked, gated).refused, "Unavailable here");
    const excludedCatalog = {
      ...sheetCatalog(),
      excluded: [{ path: ["plan"], reason: "Use something else" }],
      entries: sheetCatalog().entries,
    };
    const typedRefused = { kind: "excluded", unavailable: "Use something else" };
    assert.equal(helpers.cmSheetSequenceStep(typedRefused, excludedCatalog).refused, "Use something else");
    const previewRecent = {
      kind: "recent", preview: true, argv: ["plan"], entryId: "plan",
      path: ["plan"], title: "Today's plan",
    };
    assert.equal(helpers.cmSheetSequenceStep(previewRecent, modal.catalog).refused, "Previews can't join a sequence");
    const vimRow = { kind: "vim", vimText: "w", path: [":w"], title: "Vim" };
    assert.equal(helpers.cmSheetSequenceStep(vimRow, modal.catalog).refused, "Only bob commands can join a sequence");
    modal.close();
  } finally {
    restore();
  }
});

test("Ctrl+M into argument mode, then marking from it", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "rename a reference";
    modal.rebuildRows();
    modal.render();
    const row = modal.selectedRow();
    assert.equal(row.key, "entry:ref-rename");
    markSelected(modal);
    assert.equal(modal.stage, "args");
    modal.query = "old.md New";
    modal.render();
    markSelected(modal);
    assert.equal(modal.stage, "list");
    assert.equal(modal.sequenceMarks.length, 1);
    assert.deepEqual(modal.sequenceMarks[0].argv, ["ref", "rename", "old.md", "New"]);
    modal.close();
  } finally {
    restore();
  }
});

test("argument mode Ctrl+M with incomplete args shows Needs", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    const row = modal.rows.find((candidate) => candidate.key === "entry:ref-rename");
    assert.ok(row);
    modal.enterArgumentStage(row);
    modal.query = "only-one";
    modal.render();
    markSelected(modal);
    assert.match(sheetText(modal.contentEl), /Needs NAME/);
    assert.equal(modal.sequenceMarks.length, 0);
    modal.close();
  } finally {
    restore();
  }
});

test("Backspace pops the last step", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    modal.selectedKey = modal.visible.find((row) => row.key === "entry:vault-sync").key;
    markSelected(modal);
    assert.equal(modal.sequenceMarks.length, 2);
    modal.query = "";
    modal.inputEl.value = "";
    modal.render();
    pressKey(modal, "Backspace");
    assert.equal(modal.sequenceMarks.length, 1);
    modal.close();
  } finally {
    restore();
  }
});

test("Esc first clears marks, second closes", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    assert.equal(modal.sequenceMarks.length, 1);
    pressKey(modal, "Escape");
    assert.equal(modal.sequenceMarks.length, 0);
    assert.equal(modal.sheetOpen, true);
    pressKey(modal, "Escape");
    assert.equal(modal.sheetOpen, false);
  } finally {
    restore();
  }
});

test("click and Ctrl+click toggles", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    const plan = findByKey(modal, "entry:plan");
    const el = modal.rowEls.get(plan.key);
    assert.ok(el);
    el.listeners.click({ ctrlKey: true, preventDefault() {}, stopPropagation() {} });
    assert.equal(modal.sequenceMarks.length, 1);
    el.listeners.click({ preventDefault() {}, stopPropagation() {} });
    assert.equal(modal.sequenceMarks.length, 0);
    const sync = modal.visible.find((row) => row.key === "entry:vault-sync");
    const syncEl = modal.rowEls.get(sync.key);
    syncEl.listeners.click({ ctrlKey: true, preventDefault() {}, stopPropagation() {} });
    assert.equal(modal.sequenceMarks.length, 1);
    syncEl.listeners.click({ metaKey: true, preventDefault() {}, stopPropagation() {} });
    assert.equal(modal.sequenceMarks.length, 0);
    modal.close();
  } finally {
    restore();
  }
});

test("Shift+Enter with marks runs nothing", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    let ran = 0;
    plugin.commandModeRunSequence = async () => { ran += 1; return { ok: true }; };
    pressKey(modal, "Enter", { shiftKey: true });
    assert.equal(ran, 0);
    assert.match(sheetText(modal.contentEl), /previews one command/);
    modal.close();
  } finally {
    restore();
  }
});

test("one mark activates like Enter", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "today plan";
    modal.rebuildRows();
    modal.render();
    const row = modal.selectedRow();
    assert.equal(row.key, "entry:plan");
    modal.selectedKey = row.key;
    markSelected(modal);
    assert.equal(modal.sequenceMarks.length, 1);
    pressKey(modal, "Enter");
    for (let i = 0; i < 200 && modal.stage !== "output"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(modal.stage, "output");
    modal.close();
  } finally {
    restore();
  }
});

test("one confirm mark opens its card", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const modal = openSheet(plugin);
    modal.query = "archive done";
    modal.rebuildRows();
    modal.render();
    const row = modal.selectedRow();
    assert.equal(row.key, "entry:task-archive");
    modal.selectedKey = row.key;
    markSelected(modal);
    pressKey(modal, "Enter");
    assert.equal(modal.stage, "confirm");
    modal.close();
  } finally {
    restore();
  }
});

test("Enter with unguarded steps closes and runs", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const calls = [];
    plugin.commandModeSequenceIsActive = () => false;
    plugin.commandModeRunSequence = async (steps) => { calls.push(steps); return { ok: true }; };
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    modal.selectedKey = modal.visible.find((row) => row.key === "entry:vault-sync").key;
    markSelected(modal);
    pressKey(modal, "Enter");
    assert.equal(modal.sheetOpen, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    modal.close();
  } finally {
    restore();
  }
});

test("Enter with guards shows the review card", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    plugin.commandModeSequenceIsActive = () => false;
    plugin.commandModeRunSequence = async () => ({ ok: true });
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    modal.selectedKey = modal.visible.find((row) => row.key === "entry:task-archive").key;
    markSelected(modal);
    pressKey(modal, "Enter");
    assert.equal(modal.stage, "confirm");
    assert.match(sheetText(modal.contentEl), /Run 2 commands in order/);
    assert.match(sheetText(modal.contentEl), /asks first/);
    pressKey(modal, "Escape");
    assert.equal(modal.stage, "list");
    assert.equal(modal.sequenceMarks.length, 2);
    pressKey(modal, "Enter", { ctrlKey: true });
    assert.equal(modal.sheetOpen, false);
    modal.close();
  } finally {
    restore();
  }
});

test("Ctrl+Enter skips the card", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const calls = [];
    plugin.commandModeSequenceIsActive = () => false;
    plugin.commandModeRunSequence = async (steps) => { calls.push(steps); return { ok: true }; };
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    modal.selectedKey = modal.visible.find((row) => row.key === "entry:ref-rename").key;
    markSelected(modal);
    const missing = modal.visible.find((row) => row.key === "entry:ref-rename");
    assert.ok(missing);
    modal.close();
    const second = openSheet(plugin);
    second.query = "";
    second.rebuildRows();
    second.render();
    second.selectedKey = findByKey(second, "entry:plan").key;
    markSelected(second);
    second.selectedKey = second.visible.find((row) => row.key === "entry:vault-sync").key;
    markSelected(second);
    pressKey(second, "Enter", { ctrlKey: true });
    assert.equal(calls.length, 1);
    assert.equal(second.sheetOpen, false);
    second.close();
  } finally {
    restore();
  }
});

test("argument-mode add and run", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const calls = [];
    plugin.commandModeSequenceIsActive = () => false;
    plugin.commandModeRunSequence = async (steps) => { calls.push(steps); return { ok: true }; };
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    const show = modal.visible.find((row) => row.key === "entry:ref-show");
    modal.enterArgumentStage(show);
    modal.query = "refs/a.md";
    modal.render();
    pressKey(modal, "Enter");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    modal.close();
  } finally {
    restore();
  }
});

test("the already-running hint", () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    plugin.commandModeSequenceIsActive = () => true;
    plugin.commandModeRunSequence = async () => ({ ok: true });
    const modal = openSheet(plugin);
    modal.query = "";
    modal.rebuildRows();
    modal.render();
    modal.selectedKey = findByKey(modal, "entry:plan").key;
    markSelected(modal);
    modal.selectedKey = modal.visible.find((row) => row.key === "entry:vault-sync").key;
    markSelected(modal);
    pressKey(modal, "Enter");
    assert.match(sheetText(modal.contentEl), /already running/);
    assert.equal(modal.sheetOpen, true);
    modal.close();
  } finally {
    restore();
  }
});

function stampedRecord(overrides = {}) {
  const steps = overrides.steps || [
    { argv: ["vault-sync", "run"], entry_id: "vault-sync", title: "Sync vault now" },
    { argv: ["task", "reconcile"], entry_id: null, title: "Reconcile tasks" },
    { argv: ["plan"], entry_id: "plan", title: "Today's plan" },
  ];
  const id = overrides.id || "seq-one";
  const started = overrides.started_at || "2026-10-26T12:00:00.000Z";
  return {
    id: overrides.runId || "run-1",
    argv: ["/usr/bin/bob", ...(steps[overrides.index0 || 0].argv)],
    entry_id: steps[overrides.index0 || 0].entry_id,
    title: steps[overrides.index0 || 0].title,
    outcome: overrides.outcome || "completed",
    summary: overrides.summary || "",
    started_at: started,
    finished_at: overrides.finished_at || "2026-10-26T12:00:42.000Z",
    duration_ms: overrides.duration_ms ?? 1000,
    sequence: helpers.cmSequenceStamp(id, overrides.index0 || 0, steps, Date.parse(started)),
    ...overrides.extra,
  };
}

test("RECENT grouping folds one sequence into one row", () => {
  const catalog = sheetCatalog();
  const steps = [
    { argv: ["vault-sync", "run"], entry_id: "vault-sync", title: "Sync vault now" },
    { argv: ["task", "reconcile"], entry_id: null, title: "Reconcile tasks" },
    { argv: ["plan"], entry_id: "plan", title: "Today's plan" },
  ];
  const runs = [0, 1, 2].map((index0) => stampedRecord({ index0, steps, runId: "run-" + index0 }));
  const rows = helpers.cmSheetRecentRows(runs, Date.parse("2026-10-26T14:00:00.000Z"), catalog);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.kind, "recent");
  assert.equal(row.title, "3 steps");
  assert.ok(row.key.startsWith("recent-seq:"));
  assert.equal(row.icon, "sequence");
  assert.deepEqual(row.path, ["vault-sync run", "›", "task reconcile", "›", "plan"]);
  assert.match(row.about, /Sync vault now/);
  assert.equal(row.glyph, "✓");
});

test("RECENT dedupe, limit, interrupted glyph, and about lines", () => {
  const catalog = sheetCatalog();
  const stepsA = [
    { argv: ["vault-sync", "run"], entry_id: "vault-sync", title: "Sync vault now" },
    { argv: ["plan"], entry_id: "plan", title: "Today's plan" },
  ];
  const runsA = [0, 1].map((index0) => stampedRecord({ index0, steps: stepsA, id: "seq-a", runId: "a-" + index0 }));
  const againA = [0, 1].map((index0) => stampedRecord({
    index0, steps: stepsA, id: "seq-a2", runId: "a2-" + index0,
    started_at: "2026-10-26T13:00:00.000Z", finished_at: "2026-10-26T13:00:10.000Z",
  }));
  const haltSteps = [
    { argv: ["vault-sync", "run"], entry_id: "vault-sync", title: "Sync vault now" },
    { argv: ["task", "archive"], entry_id: "task-archive", title: "Archive done tasks" },
    { argv: ["plan"], entry_id: "plan", title: "Today's plan" },
  ];
  const haltRuns = [
    stampedRecord({ index0: 0, steps: haltSteps, id: "seq-halt", runId: "h-0" }),
    stampedRecord({ index0: 1, steps: haltSteps, id: "seq-halt", runId: "h-1", outcome: "failed", summary: "Commit pending edits first\nmore" }),
  ];
  const interruptSteps = [
    { argv: ["vault-sync", "run"], entry_id: "vault-sync", title: "Sync vault now" },
    { argv: ["ref", "show", "refs/a.md"], entry_id: "ref-show", title: "Show reference" },
    { argv: ["ready"], entry_id: "ready", title: "Ready lanes" },
  ];
  const interruptRuns = [
    stampedRecord({ index0: 0, steps: interruptSteps, id: "seq-int", runId: "i-0" }),
    stampedRecord({ index0: 1, steps: interruptSteps, id: "seq-int", runId: "i-1" }),
  ];
  const single = {
    id: "single-1", argv: ["/usr/bin/bob", "ready"], entry_id: "ready",
    title: "Ready lanes", outcome: "completed", summary: "",
    started_at: "2026-10-26T13:30:00.000Z", finished_at: "2026-10-26T13:30:01.000Z",
  };
  const rows = helpers.cmSheetRecentRows(
    [...runsA, ...againA, ...haltRuns, ...interruptRuns, single],
    Date.parse("2026-10-26T14:00:00.000Z"), catalog,
  );
  assert.ok(rows.length <= 4);
  const sigs = rows.map((row) => row.key);
  assert.equal(new Set(sigs).size, sigs.length);
  const halt = rows.find((row) => row.sequenceId === "seq-halt");
  assert.ok(halt);
  assert.match(halt.about, /Stopped at step 2: Commit pending edits first/);
  assert.equal(halt.glyph, "✗");
  const interrupt = rows.find((row) => row.sequenceId === "seq-int");
  assert.ok(interrupt);
  assert.match(interrupt.about, /Interrupted after step 2 of 3/);
  assert.equal(interrupt.glyph, "◌");
});

test("RECENT Enter reruns all steps and Ctrl+M loads and unloads them", async () => {
  const { restore, plugin } = sheetHarness(sheetCatalog());
  try {
    const calls = [];
    plugin.commandModeSequenceIsActive = () => false;
    plugin.commandModeRunSequence = async (steps) => { calls.push(steps); return { ok: true }; };
    const catalog = sheetCatalog();
    const steps = [
      { argv: ["vault-sync", "run"], entry_id: "vault-sync", title: "Sync vault now" },
      { argv: ["plan"], entry_id: "plan", title: "Today's plan" },
    ];
    const runs = [0, 1].map((index0) => {
      const record = helpers.cmNewRecord({
        id: "seq-row-" + index0,
        argv: [FAKE_BOB, ...steps[index0].argv],
        entryId: steps[index0].entry_id,
        title: steps[index0].title,
        startedAt: "2026-10-26T12:0" + index0 + ":00.000Z",
      });
      record.outcome = "completed";
      record.finished_at = "2026-10-26T12:0" + index0 + ":01.000Z";
      record.sequence = helpers.cmSequenceStamp("seq-load", index0, steps, Date.parse("2026-10-26T12:00:00.000Z"));
      const runsDir = plugin.commandModeRunner.runsDir();
      helpers.cmWriteRecord(fs, runsDir, record);
      return record;
    });
    assert.equal(runs.length, 2);
    const modal = openSheet(plugin);
    modal.catalog = catalog;
    plugin.commandModeCatalog = catalog;
    modal.refreshRecords();
    modal.rebuildRows();
    modal.render();
    const seqRow = modal.visible.find((row) => row.kind === "recent" && row.sequenceId);
    assert.ok(seqRow);
    modal.selectedKey = seqRow.key;
    pressKey(modal, "m", { ctrlKey: true });
    assert.equal(modal.sequenceMarks.length, 2);
    pressKey(modal, "m", { ctrlKey: true });
    assert.equal(modal.sequenceMarks.length, 0);
    pressKey(modal, "m", { ctrlKey: true });
    assert.equal(modal.sequenceMarks.length, 2);
    modal.sequenceMarks = [];
    modal.render();
    const again = modal.visible.find((row) => row.kind === "recent" && row.sequenceId);
    modal.selectedKey = again.key;
    const result = await modal.activateRow(again, {});
    assert.ok(result.ok || result.stage === "confirm");
    if (result.stage !== "confirm") assert.equal(calls.length, 1);
    modal.close();
  } finally {
    restore();
  }
});
