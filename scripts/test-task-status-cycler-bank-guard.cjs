// Bank-row guard (bob-cli-kd.6.1.2): parity with the 241i source grammar
// plus command, Vim, completion, and writer guards that leave bank rows
// byte-identical except for the owned space/x flip.
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
  cyclerBankMonthKey,
  cyclerBankParseAmountLead,
  cyclerBankClassifyLine,
  cyclerBankLineKind,
} = helpers;

const BANK_TEXT = [
  "---",
  "month: 2026-11",
  "---",
  "",
  "## Thu Nov 12",
  "",
  "- [ ] $61.20 ShopRite ^bank-aaa111",
  "- [ ] $5.00 Typed cash row",
  "- [x] $9.99 Done ^bank-bbb222",
  "- [x] $",
  "- [/] $4.25 Invalid status",
  "- [ ] $1.234 Unparsed amount",
  "",
  "## Notes",
  "",
  "- [ ] $12.00 Outside any day",
].join("\n");

function makeBankPlugin() {
  notices.length = 0;
  const { app } = createInMemoryObsidianApp({ "bank/2026-11.md": BANK_TEXT });
  const plugin = new TaskStatusCyclerPlugin();
  plugin.app = {
    ...app,
    workspace: {
      getActiveFile: () => ({ path: "bank/2026-11.md" }),
      getActiveViewOfType: () => null,
    },
    commands: {
      commands: {},
      executeCommandById: () => false,
    },
  };
  return plugin;
}

function bankView(plugin, editor) {
  const harness = { app: plugin.app };
  const attached = attachActiveMarkdownView(plugin, harness, editor, "bank/2026-11.md");
  const view = Object.assign(new MarkdownView(), { editor, file: attached.file });
  plugin.app.workspace.getActiveViewOfType = () => view;
  return view;
}

test("guard grammar matches the ledger source vectors", () => {
  assert.equal(cyclerBankMonthKey("bank/2026-11.md"), "2026-11");
  assert.equal(cyclerBankMonthKey("bank/2026-13.md"), null);
  assert.equal(cyclerBankMonthKey("bank.md"), null);
  assert.equal(cyclerBankMonthKey("area/bank/2026-11.md"), null);
  assert.equal(cyclerBankParseAmountLead("$13.71 Smash").cents, -1371);
  assert.equal(cyclerBankParseAmountLead("**$13.71** Smash").cents, -1371);
  assert.equal(cyclerBankParseAmountLead("+$1,250.00 Payroll").cents, 125000);
  assert.equal(cyclerBankParseAmountLead("−$4.25 fee").cents, -425);
  assert.equal(cyclerBankParseAmountLead("$1.234 bad").kind, "unparsed");
  assert.equal(cyclerBankParseAmountLead("3 things").kind, "not-amount");
  assert.equal(cyclerBankParseAmountLead("$").kind, "stub");
  assert.equal(cyclerBankClassifyLine("- [ ] 3 things").kind, "not-a-row");
  assert.equal(cyclerBankClassifyLine("- [x] $").kind, "stub");
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "- [ ] $61.20 ShopRite"), "row");
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "- [X] $61.20 ShopRite"), "row");
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "- [/] $4.25 Invalid"), "row");
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "- [x] $"), "stub");
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "- [ ] $1.234 bad").valueOf(), "amount-invalid");
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "- $12.00 No checkbox"), "amount-invalid");
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "- [ ] #task Ship it"), null);
  assert.equal(cyclerBankLineKind("Daily.md", "- [ ] $61.20 ShopRite"), null);
  assert.equal(cyclerBankLineKind("bank/2026-11.md", "  - [ ] $5.00 Nested"), null);
});

test("cycle consumes bank rows without writing", () => {
  const plugin = makeBankPlugin();
  const editor = createTextEditor(BANK_TEXT, { line: 6, ch: 3 });
  const view = bankView(plugin, editor);
  const before = editor.getValue();
  assert.equal(plugin.handleCycleCommand(false, editor, view, 1), true);
  assert.equal(editor.getValue(), before);
  assert.ok(notices.some((message) => message.includes("Bank row")));
  assert.equal(plugin.handleCycleCommand(true, editor, view, -1), true);
  assert.equal(editor.getValue(), before);
});

test("open/done flips space and x as plain bytes with no task metadata", () => {
  const plugin = makeBankPlugin();
  const editor = createTextEditor(BANK_TEXT, { line: 7, ch: 3 });
  const view = bankView(plugin, editor);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  assert.equal(editor.getLine(7), "- [x] $5.00 Typed cash row");
  assert.ok(!editor.getLine(7).includes("✅"));
  assert.ok(!editor.getLine(7).includes("[created"));
  assert.equal(plugin.handleToggleOpenDoneCommand(false, editor, view), true);
  assert.equal(editor.getLine(7), "- [ ] $5.00 Typed cash row");
});

test("stubs and invalid rows refuse every toggle without repair", () => {
  const plugin = makeBankPlugin();
  const before = BANK_TEXT;
  const stubEditor = createTextEditor(BANK_TEXT, { line: 9, ch: 6 });
  bankView(plugin, stubEditor);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, stubEditor, bankView(plugin, stubEditor)), true);
  assert.equal(stubEditor.getValue(), before);
  const invalidEditor = createTextEditor(BANK_TEXT, { line: 10, ch: 3 });
  assert.equal(plugin.handleCycleCommand(false, invalidEditor, bankView(plugin, invalidEditor), 1), true);
  assert.equal(invalidEditor.getValue(), before);
  const unparsedEditor = createTextEditor(BANK_TEXT, { line: 11, ch: 3 });
  assert.equal(plugin.handleToggleOpenDoneCommand(false, unparsedEditor, bankView(plugin, unparsedEditor)), true);
  assert.equal(unparsedEditor.getValue(), before);
  assert.equal(plugin.handleToggleCheckboxMarkerCommand(false, invalidEditor, bankView(plugin, invalidEditor)), true);
  assert.equal(invalidEditor.getValue(), before);
});

test("promotion refuses bank rows before the section planner runs", () => {
  const plugin = makeBankPlugin();
  const editor = createTextEditor(BANK_TEXT, { line: 6, ch: 3 });
  const view = bankView(plugin, editor);
  const toggle = plugin.getActiveObsidianTaskToggle(editor);
  assert.equal(toggle.mode, "refuse");
  assert.match(toggle.message, /Bank row/);
  const before = editor.getValue();
  assert.equal(plugin.handleToggleObsidianTaskCommand(false, editor, view), true);
  assert.equal(editor.getValue(), before);
});

test("completion paths refuse bank rows; ordinary tasks still complete", () => {
  const plugin = makeBankPlugin();
  const bankLine = "- [ ] $5.00 Typed cash row";
  assert.deepEqual(plugin.completeTaskLineText(bankLine, { path: "bank/2026-11.md" }), {
    ok: false,
    reason: "bank-row",
    lineText: bankLine,
  });
  const ordinary = plugin.completeTaskLineText("- [ ] #task Ship it", { path: "Daily.md", date: "2026-11-12" });
  assert.equal(ordinary.ok, true);
  assert.equal(ordinary.unchanged, false);
  assert.match(ordinary.lineText, /\[x\]/);
});

test("complete-at-cursor refuses bank rows", async () => {
  const plugin = makeBankPlugin();
  const editor = createTextEditor(BANK_TEXT, { line: 7, ch: 3 });
  bankView(plugin, editor);
  const result = await plugin.completeTaskAtCursor(editor);
  assert.deepEqual(result, { ok: false, reason: "bank-row" });
  assert.equal(editor.getLine(7), "- [ ] $5.00 Typed cash row");
});

test("lower-level writers flip only the target line between space and x", () => {
  const plugin = makeBankPlugin();
  const editor = createTextEditor(BANK_TEXT, { line: 0, ch: 0 });
  bankView(plugin, editor);
  const rowStatus = { line: 7, lineText: "- [ ] $5.00 Typed cash row", symbol: " ", statusStart: 3, statusEnd: 4 };
  assert.equal(plugin.setActiveCheckboxStatus(editor, rowStatus, "x"), true);
  assert.equal(editor.getLine(7), "- [x] $5.00 Typed cash row");
  assert.ok(!editor.getLine(7).includes("✅"));
  assert.equal(plugin.setCheckboxStatusLocalForLine(editor, { ...rowStatus, symbol: "x", lineText: editor.getLine(7) }, " "), true);
  assert.equal(editor.getLine(7), "- [ ] $5.00 Typed cash row");
  const before = editor.getValue();
  assert.equal(plugin.setActiveCheckboxStatus(editor, rowStatus, "/"), false);
  assert.equal(editor.getValue(), before);
  assert.equal(plugin.toggleActiveCheckboxMarker(editor, { line: 7, sourceLineText: "- [ ] $5.00 Typed cash row", cursorCh: 3 }), false);
  assert.equal(editor.getValue(), before);
});

function installBankApi(plugin, claimRowClose) {
  const previous = plugin.app.plugins && plugin.app.plugins.plugins
    ? plugin.app.plugins.plugins
    : {};
  plugin.app.plugins = {
    plugins: {
      ...previous,
      "bob-ledger-tools": {
        api: {
          version: 3,
          bank: claimRowClose === undefined
            ? { version: 1 }
            : { version: 2, claimRowClose },
        },
      },
    },
  };
}

test("Ctrl+Enter delegates waiting rows to ledger-tools v2 and falls back", () => {
  const plugin = makeBankPlugin();
  const waiting = createTextEditor(BANK_TEXT, { line: 7, ch: 3 });
  const view = bankView(plugin, waiting);
  const calls = [];

  assert.equal(plugin.handleToggleOpenDoneCommand(false, waiting, view), true);
  assert.equal(waiting.getLine(7), "- [x] $5.00 Typed cash row");
  waiting.replaceRange(" ", { line: 7, ch: 3 }, { line: 7, ch: 4 });
  assert.equal(waiting.getLine(7), "- [ ] $5.00 Typed cash row");

  installBankApi(plugin);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, waiting, view), true);
  assert.equal(waiting.getLine(7), "- [x] $5.00 Typed cash row", "v1 bank still flips");
  waiting.replaceRange(" ", { line: 7, ch: 3 }, { line: 7, ch: 4 });

  installBankApi(plugin, () => {
    throw new Error("boom");
  });
  assert.equal(plugin.handleToggleOpenDoneCommand(false, waiting, view), true);
  assert.equal(waiting.getLine(7), "- [x] $5.00 Typed cash row", "throwing claim falls back");
  waiting.replaceRange(" ", { line: 7, ch: 3 }, { line: 7, ch: 4 });

  installBankApi(plugin, () => false);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, waiting, view), true);
  assert.equal(waiting.getLine(7), "- [x] $5.00 Typed cash row", "false claim falls back");
  waiting.replaceRange(" ", { line: 7, ch: 3 }, { line: 7, ch: 4 });

  installBankApi(plugin, (editor, claimedView) => {
    calls.push({ line: editor.getCursor().line, path: claimedView.file.path });
    return true;
  });
  const before = waiting.getLine(7);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, waiting, view), true);
  assert.equal(waiting.getLine(7), before, "true claim writes nothing");
  plugin.handleVimTaskToggleOpenDone();
  assert.equal(waiting.getLine(7), before, "Vim waiting-row claim writes nothing");
  assert.deepEqual(calls, [
    { line: 7, path: "bank/2026-11.md" },
    { line: 7, path: "bank/2026-11.md" },
  ]);
  assert.ok(!waiting.getLine(7).includes("✅"));
  assert.ok(!waiting.getLine(7).includes("[created"));
});

test("ticked, stub, and invalid rows never delegate to claimRowClose", () => {
  const plugin = makeBankPlugin();
  let claimed = 0;
  installBankApi(plugin, () => {
    claimed += 1;
    return true;
  });

  const ticked = createTextEditor(BANK_TEXT, { line: 8, ch: 3 });
  const tickedView = bankView(plugin, ticked);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, ticked, tickedView), true);
  assert.equal(ticked.getLine(8), "- [ ] $9.99 Done ^bank-bbb222");

  const tickedVim = createTextEditor(BANK_TEXT, { line: 8, ch: 3 });
  bankView(plugin, tickedVim);
  plugin.handleVimTaskToggleOpenDone();
  assert.equal(tickedVim.getLine(8), "- [ ] $9.99 Done ^bank-bbb222");

  const stub = createTextEditor(BANK_TEXT, { line: 9, ch: 6 });
  bankView(plugin, stub);
  assert.equal(plugin.handleToggleOpenDoneCommand(false, stub, bankView(plugin, stub)), true);
  assert.equal(stub.getLine(9), "- [x] $");

  const invalid = createTextEditor(BANK_TEXT, { line: 11, ch: 3 });
  const beforeInvalid = invalid.getValue();
  assert.equal(plugin.handleToggleOpenDoneCommand(false, invalid, bankView(plugin, invalid)), true);
  assert.equal(invalid.getValue(), beforeInvalid);
  assert.equal(claimed, 0);
});

test("Vim toggles take the bank path without review-walk or pomodoro work", () => {
  const plugin = makeBankPlugin();
  const editor = createTextEditor(BANK_TEXT, { line: 7, ch: 3 });
  bankView(plugin, editor);
  plugin.handleVimTaskToggleOpenDone();
  assert.equal(editor.getLine(7), "- [x] $5.00 Typed cash row");
  plugin.handleVimTaskToggleOpenDone();
  assert.equal(editor.getLine(7), "- [ ] $5.00 Typed cash row");
  const stubEditor = createTextEditor(BANK_TEXT, { line: 9, ch: 6 });
  bankView(plugin, stubEditor);
  plugin.handleVimTaskToggleOpenDone();
  assert.equal(stubEditor.getLine(9), "- [x] $");
  plugin.handleVimToggleCheckboxMarker();
  assert.equal(stubEditor.getValue(), BANK_TEXT);
});

test("transcluded writes refuse bank targets at the boundary", async () => {
  const plugin = makeBankPlugin();
  assert.equal(
    plugin.cyclerBankTransclusionIsBank({ file: { path: "bank/2026-11.md" }, taskStatus: { lineText: "- [ ] $5.00 x ^bank-aaa" } }),
    true,
  );
  assert.equal(
    plugin.cyclerBankTransclusionIsBank({ file: { path: "Daily.md" }, taskStatus: { lineText: "- [ ] $5.00 x" } }),
    false,
  );
  assert.equal(
    await plugin.replaceResolvedTranscludedTaskLine(
      { file: { path: "bank/2026-11.md" }, line: 6, blockId: "aaa", taskStatus: { lineText: "- [ ] $5.00 x" } },
      { activePath: "Daily.md", editor: createTextEditor(BANK_TEXT, { line: 0, ch: 0 }) },
    ),
    false,
  );
});
