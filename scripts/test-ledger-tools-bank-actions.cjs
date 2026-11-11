// Bank action service (bob-cli-kd.6.1.2): exact-selection acknowledgment,
// open-today cursor placement, guarded ID-less checkbox edits, Enter
// continuation, and category suggestions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Module = require("node:module");

class TestMarkdownView {}
class TestNotice {
  constructor(message) {
    TestNotice.messages.push(String(message));
  }
}
TestNotice.messages = [];

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEvent(ref) {
    return ref;
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEditorSuggest(suggest) {
    this.editorSuggest = suggest;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithBankActionStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      Notice: TestNotice,
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}
const { helpers } = LedgerToolsPlugin;
const {
  bankAckArgsForIds,
  bankAckIdFromLine,
  bankAckResultSummary,
  bankCategoryCompletions,
  bankCursorDayContext,
  bankDayWaitingSnapshot,
  bankDecodeAckResponse,
  bankDecodeEnsureResponse,
  bankDedupeIds,
  bankEnsureArgsForDay,
  bankEnterDecision,
  bankGuardedCheckboxPlan,
  bankNormalizeAckId,
  bankRowBlockId,
  bankScanSource,
} = helpers;

const fixtureDir = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/bank",
);
const monthNote = fs.readFileSync(path.join(fixtureDir, "month-2026-11.md"), "utf8");

const ACK_SOURCE = [
  "---",
  "month: 2026-11",
  "---",
  "",
  "## Thu Nov 12",
  "",
  "- [ ] $61.20 ShopRite [cat:: groceries] ^bank-aaa111",
  "- [ ] $5.00 Typed cash row",
  "- [x] $9.99 Already done ^bank-bbb222",
  "",
  "## Fri Nov 13",
  "",
  "- [ ] $4.25 Fee ^bank-ccc333",
].join("\n");

function makeEditor(text, cursor) {
  let value = String(text);
  let current = { line: 0, ch: 0, ...(cursor || {}) };
  const writes = [];
  const offsetOf = (lines, position) => {
    let offset = 0;
    for (let index = 0; index < position.line; index += 1) {
      offset += lines[index].length + 1;
    }
    return offset + position.ch;
  };
  return {
    writes,
    getValue: () => value,
    getLine: (line) => String(value).split("\n")[line] || "",
    getCursor: () => ({ ...current }),
    setCursor: (next) => {
      current = { ...next };
    },
    get cursor() {
      return { ...current };
    },
    replaceRange: (replacement, from, to = from) => {
      const lines = String(value).split("\n");
      const start = offsetOf(lines, from);
      const end = offsetOf(lines, to);
      writes.push({ replacement, from, to });
      value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    },
    listSelections: () => [{ anchor: { ...current }, head: { ...current } }],
  };
}

function okAck(stdoutObj) {
  return (command, args, options, callback) => {
    callback(null, JSON.stringify(stdoutObj), "");
  };
}

function makePlugin(overrides = {}) {
  TestNotice.messages.length = 0;
  const invalidations = [];
  const vaultFiles = new Map(Object.entries(overrides.vaultFiles || {}));
  const app = {
    vault: {
      getMarkdownFiles: () => [],
      getAbstractFileByPath: (filePath) => vaultFiles.get(filePath) || null,
    },
    workspace: {
      getActiveFile: () => ({ path: "bank/2026-11.md" }),
      getLeavesOfType: () => [],
      getLeaf: () => null,
      getActiveViewOfType: () => null,
      ...(overrides.workspace || {}),
    },
    metadataCache: { on: () => ({}) },
    plugins: { plugins: {} },
  };
  const plugin = new LedgerToolsPlugin(app, {});
  plugin.registerEvent = () => {};
  plugin.apiBankInvalidate = (reason) => {
    invalidations.push(reason);
  };
  plugin.setupBankActions();
  return { plugin, app, invalidations };
}

test("ensure argv never passes -o and ack argv carries only deduped IDs", () => {
  assert.deepEqual(bankEnsureArgsForDay("today"), ["bank", "ensure", "-D", "today", "-f", "json"]);
  assert.deepEqual(bankEnsureArgsForDay("2026-11-14"), ["bank", "ensure", "-D", "2026-11-14", "-f", "json"]);
  assert.deepEqual(bankEnsureArgsForDay(""), ["bank", "ensure", "-f", "json"]);
  assert.deepEqual(
    bankAckArgsForIds(["^bank-AbC", "abc ", "BANK-abc", "  ", "def012"]),
    ["bank", "ack", "^bank-AbC", "def012", "-f", "json"],
  );
  assert.equal(bankNormalizeAckId("^bank-AbC"), "abc");
  assert.equal(bankDedupeIds(["a1", "A1", "^a1", "b2"]).join(","), "a1,b2");
});

test("ensure and ack decoders reject bad shapes without claiming success", () => {
  const ok = bankDecodeEnsureResponse(
    JSON.stringify({ ok: true, schema_version: 1, path: "bank/2026-11.md", line: 42, day: "2026-11-12" }),
    "",
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.report.line, 42);
  assert.equal(ok.report.path, "bank/2026-11.md");
  assert.equal(bankDecodeEnsureResponse(JSON.stringify({ ok: true, schema_version: 999 }), "").code, "schema-mismatch");
  assert.equal(bankDecodeEnsureResponse(JSON.stringify({ ok: true, schema_version: 1 }), "").code, "bad-shape");
  assert.equal(bankDecodeEnsureResponse("nope", "").code, "bad-json");

  const acked = bankDecodeAckResponse(
    JSON.stringify({ ok: true, schema_version: 1, acknowledged: [{ id: "a" }], already: [], unknown: [] }),
    "",
  );
  assert.equal(acked.ok, true);
  assert.equal(acked.report.acknowledged.length, 1);
  const failed = bankDecodeAckResponse(
    JSON.stringify({ ok: false, schema_version: 1, error: { code: "bob-error", message: "boom" } }),
    "detail",
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.message, "boom");
  const unknownIds = bankDecodeAckResponse(
    JSON.stringify({ ok: false, schema_version: 1, acknowledged: [], already: [], unknown: ["zzz"] }),
    "",
  );
  assert.equal(unknownIds.ok, false);
  assert.match(unknownIds.message, /zzz/);
  const unknownDespiteOk = bankDecodeAckResponse(
    JSON.stringify({ ok: true, schema_version: 1, acknowledged: [], already: [], unknown: ["zzz"] }),
    "",
  );
  assert.equal(unknownDespiteOk.ok, false);
  assert.equal(unknownDespiteOk.code, "unknown-ids");
});

test("source rows expose bank ids; other block ids stay plain block ids", () => {
  assert.equal(bankAckIdFromLine("- [ ] $5.00 x ^bank-1c0e77aa"), "1c0e77aa");
  assert.equal(bankAckIdFromLine("- [ ] $5.00 x ^BANK-1C0E77AA"), "1c0e77aa");
  assert.equal(bankAckIdFromLine("- [ ] $5.00 x ^task-12"), null);
  assert.equal(bankRowBlockId("- [ ] $5.00 x ^task-12"), "task-12");
  assert.equal(bankRowBlockId("- [ ] $5.00 x"), null);
  assert.equal(bankAckIdFromLine("- [ ] $5.00 x ^bank-zzz"), null);
  const scan = bankScanSource("bank/2026-11.md", ACK_SOURCE);
  const shop = scan.rows.find((row) => row.line === 7);
  assert.equal(shop.ackId, "aaa111");
  assert.equal(shop.blockId, "bank-aaa111");
  const typed = scan.rows.find((row) => row.line === 8);
  assert.equal(typed.ackId, null);
});

test("day snapshots carry exact waiting IDs and count ID-less rows", () => {
  const scan = bankScanSource("bank/2026-11.md", ACK_SOURCE);
  const thursday = bankDayWaitingSnapshot(scan.rows, "2026-11-12");
  assert.deepEqual(thursday.ids, ["aaa111"]);
  assert.equal(thursday.idLess, 1);
  const friday = bankDayWaitingSnapshot(scan.rows, "2026-11-13");
  assert.deepEqual(friday.ids, ["ccc333"]);
  assert.equal(friday.idLess, 0);
  const jsonRows = [
    { date: "2026-11-12", acknowledged: false, id: "abc123" },
    { date: "2026-11-12", acknowledged: false, id: null },
    { date: "2026-11-12", acknowledged: true, id: "done99" },
  ];
  assert.deepEqual(bankDayWaitingSnapshot(jsonRows, "2026-11-12"), { ids: ["abc123"], idLess: 1 });
});

test("ack summaries never claim a full day while ID-less rows remain", () => {
  const partial = bankAckResultSummary({ acknowledged: [{}, {}], already: [{}] }, 1);
  assert.equal(partial.fullyAcknowledged, false);
  assert.match(partial.text, /acknowledged 2/);
  assert.match(partial.text, /1 already done/);
  assert.match(partial.text, /still need/);
  const full = bankAckResultSummary({ acknowledged: [{}], already: [] }, 0);
  assert.equal(full.fullyAcknowledged, true);
  assert.match(full.text, /acknowledged 1/);
  const none = bankAckResultSummary({ acknowledged: [], already: [] }, 0);
  assert.equal(none.fullyAcknowledged, false);
  assert.equal(none.text, "Bank: nothing new");
});

test("cursor day context follows heading boundaries, not fallback lines", () => {
  const scan = bankScanSource("bank/2026-11.md", ACK_SOURCE);
  assert.equal(bankCursorDayContext(scan, 6).date, "2026-11-12");
  assert.equal(bankCursorDayContext(scan, 12).date, "2026-11-13");
  assert.equal(bankCursorDayContext(scan, 0), null);
  assert.equal(bankCursorDayContext(scan, 3), null);
  const fixtureScan = bankScanSource("bank/2026-11.md", monthNote);
  assert.ok(fixtureScan.days.length > 0);
  const firstRow = fixtureScan.rows[0];
  assert.equal(bankCursorDayContext(fixtureScan, firstRow.line - 1).date, firstRow.date);
});

test("guarded checkbox plans verify the exact displayed row and day context", () => {
  const typedLine = "- [ ] $5.00 Typed cash row";
  const good = bankGuardedCheckboxPlan("bank/2026-11.md", ACK_SOURCE, 7, typedLine);
  assert.equal(good.ok, true);
  assert.equal(good.line, 7);
  assert.equal(good.statusStart, 3);
  assert.equal(good.statusEnd, 4);
  assert.equal(bankGuardedCheckboxPlan("bank/2026-11.md", ACK_SOURCE, 7, "- [ ] $5.00 Changed row").reason, "moved-or-edited");
  assert.equal(bankGuardedCheckboxPlan("ideas.md", ACK_SOURCE, 7, typedLine).reason, "not-bank-note");
  assert.equal(bankGuardedCheckboxPlan("bank/2026-11.md", ACK_SOURCE, 8, "").reason, "already-acknowledged");
  assert.equal(bankGuardedCheckboxPlan("bank/2026-11.md", ACK_SOURCE, 6, "").reason, "has-id");
  assert.equal(bankGuardedCheckboxPlan("bank/2026-11.md", ACK_SOURCE, 3, "").reason, "not-a-row");
  assert.equal(bankGuardedCheckboxPlan("bank/2026-11.md", ACK_SOURCE, 99, "").reason, "out-of-range");
});

test("Enter continues only complete rows and clears only empty stubs", () => {
  const source = [
    "## Thu Nov 12",
    "",
    "- [x] $61.20 ShopRite",
    "- [ ] $5.00 Typed",
    "- [x] $",
    "- [ ] plain task",
    "```",
    "- [x] $9.99 fenced",
    "```",
  ].join("\n");
  const pathName = "bank/2026-11.md";
  const endOf = (line) => line.length;
  assert.deepEqual(
    bankEnterDecision(pathName, source, 2, endOf("- [x] $61.20 ShopRite"), false),
    { action: "insert-ack-row", line: 2 },
  );
  assert.equal(bankEnterDecision(pathName, source, 3, endOf("- [ ] $5.00 Typed"), false).action, "none");
  assert.deepEqual(bankEnterDecision(pathName, source, 4, endOf("- [x] $"), false), { action: "clear-stub", line: 4 });
  assert.equal(bankEnterDecision(pathName, source, 2, 3, false).action, "none");
  assert.equal(bankEnterDecision(pathName, source, 2, endOf("- [x] $61.20 ShopRite"), true).action, "none");
  assert.equal(bankEnterDecision(pathName, source, 5, endOf("- [ ] plain task"), false).action, "none");
  assert.equal(bankEnterDecision(pathName, source, 7, endOf("- [x] $9.99 fenced"), false).action, "none");
  assert.equal(bankEnterDecision("ideas.md", source, 2, endOf("- [x] $61.20 ShopRite"), false).action, "none");
  assert.equal(bankEnterDecision(pathName, source, 2, endOf("- [x] $61.20 ShopRite") + 4, false).action, "insert-ack-row");
});

test("category completions keep declared order and insert only keys", () => {
  const categories = [
    { key: "groceries", emoji: "🥬", label: "Groceries" },
    { key: "income", emoji: "💵", label: "Income" },
    { key: "dining", emoji: "🍽️", label: "Dining out" },
  ];
  assert.deepEqual(
    bankCategoryCompletions(categories, "").map((entry) => entry.key),
    ["groceries", "income", "dining"],
  );
  assert.deepEqual(bankCategoryCompletions(categories, "din").map((entry) => entry.key), ["dining"]);
  assert.deepEqual(bankCategoryCompletions(categories, "💵").map((entry) => entry.key), ["income"]);
  assert.deepEqual(bankCategoryCompletions(null, "").length, 0);
});

test("action commands register without default hotkeys", () => {
  const { plugin } = makePlugin();
  try {
    const ids = plugin.commands.map((command) => command.id);
    assert.ok(ids.includes("bank-open-today"));
    assert.ok(ids.includes("bank-ack-day"));
    for (const command of plugin.commands) {
      assert.equal(command.hotkeys, undefined);
    }
    const names = new Map(plugin.commands.map((command) => [command.id, command.name]));
    assert.equal(names.get("bank-open-today"), "Bank: open today");
    assert.equal(names.get("bank-ack-day"), "Bank: acknowledge this day");
    assert.ok(Array.isArray(plugin.editorExtensions) && plugin.editorExtensions.length > 0);
  } finally {
    plugin.teardownBankActions();
  }
});

test("ack submits the exact snapshot IDs and reports remaining ID-less rows", async () => {
  const { plugin, invalidations } = makePlugin();
  try {
    const seen = {};
    const execFile = (command, args, options, callback) => {
      seen.command = command;
      seen.args = args;
      callback(
        null,
        JSON.stringify({ ok: true, schema_version: 1, acknowledged: [{ id: "aaa111" }], already: [], unknown: [] }),
        "",
      );
    };
    const result = await plugin.bankAckIds(["^bank-aaa111", "AAA111", "  "], {
      label: "2026-11-12",
      idLess: 1,
      spawnOptions: { execFile, resolved: { path: "bob", source: "test" } },
    });
    assert.deepEqual(seen.args, ["bank", "ack", "^bank-aaa111", "-f", "json"]);
    assert.ok(!seen.args.includes("-D"));
    assert.equal(result.ok, true);
    assert.equal(result.fullyAcknowledged, false);
    assert.match(TestNotice.messages.at(-1), /still need/);
    assert.deepEqual(invalidations, ["ack"]);
  } finally {
    plugin.teardownBankActions();
  }
});

test("ack refuses empty selections, busy locks, and failures without refresh", async () => {
  const { plugin, invalidations } = makePlugin();
  try {
    assert.equal((await plugin.bankAckIds([], {})).reason, "empty");
    plugin.bankAckPending = true;
    assert.equal((await plugin.bankAckIds(["abc"], {})).reason, "busy");
    plugin.bankAckPending = false;
    const failing = await plugin.bankAckIds(["abc"], {
      spawnOptions: {
        execFile: okAck({ ok: false, schema_version: 1, error: { code: "bob-error", message: "nope" } }),
        resolved: { path: "bob", source: "test" },
      },
    });
    assert.equal(failing.ok, false);
    assert.deepEqual(invalidations, []);
    assert.match(TestNotice.messages.at(-1), /nope/);
  } finally {
    plugin.teardownBankActions();
  }
});

test("acknowledge-day snapshots the cursor day and never falls back to ack -D", async () => {
  const { plugin } = makePlugin();
  try {
    const seen = {};
    const editor = makeEditor(ACK_SOURCE, { line: 6, ch: 10 });
    const result = await plugin.bankAckDayAtCursor(editor, { file: { path: "bank/2026-11.md" } }, {
      spawnOptions: {
        execFile: (command, args, options, callback) => {
          seen.args = args;
          callback(null, JSON.stringify({ ok: true, schema_version: 1, acknowledged: [{ id: "aaa111" }], already: [], unknown: [] }), "");
        },
        resolved: { path: "bob", source: "test" },
      },
    });
    assert.deepEqual(seen.args, ["bank", "ack", "aaa111", "-f", "json"]);
    assert.ok(!seen.args.includes("-D"));
    assert.equal(result.ok, true);
    assert.equal(result.idLess, 1);
    const outside = makeEditor(ACK_SOURCE, { line: 0, ch: 0 });
    assert.equal((await plugin.bankAckDayAtCursor(outside, { file: { path: "bank/2026-11.md" } })).reason, "no-day");
    const elsewhere = makeEditor(ACK_SOURCE, { line: 6, ch: 0 });
    assert.equal((await plugin.bankAckDayAtCursor(elsewhere, { file: { path: "ideas.md" } })).reason, "not-bank-note");
  } finally {
    plugin.teardownBankActions();
  }
});

test("ensure opens the returned path and lands the cursor on the next row", async () => {
  const editor = makeEditor("## Thu Nov 12\n", { line: 0, ch: 0 });
  let openedFile = null;
  const leaf = {
    view: null,
    openFile: async (file) => {
      openedFile = file;
      leaf.view = { editor, file };
    },
  };
  const seen = {};
  const { plugin, invalidations } = makePlugin({
    vaultFiles: { "bank/2026-11.md": { path: "bank/2026-11.md" } },
    workspace: { getLeaf: () => leaf },
  });
  try {
    const result = await plugin.bankEnsureOpenDay("today", {
      spawnOptions: {
        execFile: (command, args, options, callback) => {
          seen.args = args;
          callback(
            null,
            JSON.stringify({ ok: true, schema_version: 1, path: "bank/2026-11.md", line: 9, day: "2026-11-12" }),
            "",
          );
        },
        resolved: { path: "bob", source: "test" },
      },
    });
    assert.deepEqual(seen.args, ["bank", "ensure", "-D", "today", "-f", "json"]);
    assert.ok(!seen.args.includes("-o"));
    assert.equal(openedFile && openedFile.path, "bank/2026-11.md");
    assert.deepEqual(editor.cursor, { line: 8, ch: 0 });
    assert.equal(result.ok, true);
    assert.deepEqual(invalidations, ["ensure"]);
  } finally {
    plugin.teardownBankActions();
  }
});

test("guarded ID-less edits flip one byte only when the snapshot still matches", () => {
  const { plugin } = makePlugin();
  try {
    const editor = makeEditor(ACK_SOURCE, { line: 7, ch: 3 });
    const result = plugin.bankToggleIdLessRowAtCursor(editor, "- [ ] $5.00 Typed cash row");
    assert.equal(result.ok, true);
    assert.equal(editor.getLine(7), "- [x] $5.00 Typed cash row");
    assert.deepEqual(editor.writes[0].from, { line: 7, ch: 3 });
    assert.deepEqual(editor.writes[0].to, { line: 7, ch: 4 });
    const stale = makeEditor(ACK_SOURCE, { line: 7, ch: 3 });
    assert.equal(stale && plugin.bankToggleIdLessRowAtCursor(stale, "- [ ] $5.00 Edited").reason, "moved-or-edited");
    assert.equal(stale.getLine(7), "- [ ] $5.00 Typed cash row");
  } finally {
    plugin.teardownBankActions();
  }
});

test("snippet expansion never rewrites bank rows", () => {
  const { plugin } = makePlugin();
  try {
    const editor = makeEditor("- [ ] $12.00 D0", { line: 0, ch: 15 });
    assert.equal(plugin.bankExpansionGuardTripped(editor, "bank/2026-11.md"), true);
    assert.equal(plugin.expandFromEditor(editor, null, { path: "bank/2026-11.md" }), false);
    assert.equal(editor.writes.length, 0);
    assert.equal(plugin.bankExpansionGuardTripped(editor, "ideas.md"), false);
  } finally {
    plugin.teardownBankActions();
  }
});

test("Enter handling inserts rows and clears stubs through the real editor", () => {
  const source = ["## Thu Nov 12", "", "- [x] $61.20 ShopRite", "- [x] $"].join("\n");
  const viewFile = { path: "bank/2026-11.md" };
  const { plugin } = makePlugin({
    workspace: {
      getActiveViewOfType: () => null,
    },
  });
  try {
    const editor = makeEditor(source, { line: 2, ch: "- [x] $61.20 ShopRite".length });
    plugin.app.workspace.getActiveViewOfType = () =>
      Object.assign(new TestMarkdownView(), { editor, file: viewFile });
    assert.equal(plugin.bankHandleEnter(), true);
    const lines = editor.getValue().split("\n");
    assert.equal(lines[3], "- [x] $");
    assert.deepEqual(editor.cursor, { line: 3, ch: "- [x] $".length });

    const stubEditor = makeEditor(source, { line: 3, ch: "- [x] $".length });
    plugin.app.workspace.getActiveViewOfType = () =>
      Object.assign(new TestMarkdownView(), { editor: stubEditor, file: viewFile });
    assert.equal(plugin.bankHandleEnter(), true);
    assert.equal(stubEditor.getValue().split("\n")[3], "");

    const midEditor = makeEditor(source, { line: 2, ch: 3 });
    plugin.app.workspace.getActiveViewOfType = () =>
      Object.assign(new TestMarkdownView(), { editor: midEditor, file: viewFile });
    assert.equal(plugin.bankHandleEnter(), false);
  } finally {
    plugin.teardownBankActions();
  }
});
