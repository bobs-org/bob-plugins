// Category card keyboard and API integration tests. The rows and categories
// are synthetic; no vault or transaction data is used here.
const assert = require("node:assert/strict");
const test = require("node:test");
const { LedgerToolsPlugin } = require("./ledger-tools-harness.cjs");

const h = LedgerToolsPlugin.helpers;
const CATEGORIES = [
  { key: "coffee", label: "Coffee", emoji: "☕", hotkey: "c", group: "Everyday", hidden: false },
  { key: "groceries", label: "Groceries", emoji: "🛒", hotkey: "g", group: "Everyday", hidden: false },
  { key: "kids", label: "Kids", emoji: "🧸", hotkey: null, group: null, hidden: true },
];

function event(key, options = {}) {
  return {
    key,
    ctrlKey: options.ctrlKey === true,
    isComposing: false,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

function makeModal(mode, options = {}) {
  const actions = [];
  const modal = new h.BankCategoryCardModal({}, {
    mode,
    categories: options.categories === undefined ? CATEGORIES : options.categories,
    context: { cardRow: { payee: "Corner Cafe", cents: -645, category: null } },
    openedWithCtrlEnter: options.openedWithCtrlEnter === true,
    onChoose: async (category, kind) => actions.push({ category, kind, mode }),
  });
  modal.highlightKey = options.highlightKey === undefined ? "coffee" : options.highlightKey;
  if (options.lock) modal.lock = options.lock;
  return { modal, actions };
}

function editorFor(source) {
  return {
    source,
    cursor: { line: 1, ch: 0 },
    replacements: [],
    getValue() { return this.source; },
    getLine(line) { return this.source.split("\n")[line] || ""; },
    getCursor() { return this.cursor; },
    setCursor(cursor) { this.cursor = cursor; },
    replaceRange(text, from, to) {
      this.replacements.push({ text, from, to });
      const lines = this.source.split("\n");
      lines[from.line] = text;
      this.source = lines.join("\n");
    },
  };
}

test("the modal key contract dispatches every action in close and set modes", async () => {
  for (const mode of ["close", "set"]) {
    let state = makeModal(mode);
    await state.modal.onKeyDown(event("Enter"));
    assert.deepEqual(state.actions, [{ category: "coffee", kind: "accept", mode }]);

    state = makeModal(mode);
    await state.modal.onKeyDown(event("Enter", { ctrlKey: true }));
    assert.deepEqual(state.actions, [{ category: "coffee", kind: "accept", mode }]);

    state = makeModal(mode);
    await state.modal.onKeyDown(event("g"));
    assert.deepEqual(state.actions, [{ category: "groceries", kind: "pick", mode }]);

    state = makeModal(mode);
    await state.modal.onKeyDown(event(" "));
    assert.deepEqual(state.actions, [{ category: null, kind: "no-category", mode }]);

    state = makeModal(mode);
    const down = event("ArrowDown");
    await state.modal.onKeyDown(down);
    assert.equal(state.modal.highlightKey, "groceries");
    assert.equal(state.actions.length, 0);
    assert.equal(down.defaultPrevented, true);

    for (const key of ["Escape", "q"]) {
      state = makeModal(mode);
      await state.modal.onKeyDown(event(key));
      assert.equal(state.modal.closed, true);
      assert.equal(state.actions.length, 0);
    }
    state = makeModal(mode);
    await state.modal.onKeyDown(event("[", { ctrlKey: true }));
    assert.equal(state.modal.closed, true);
    assert.equal(state.actions.length, 0);
  }
});

test("the opening chord and landing lock swallow repeated Ctrl+Enter", async () => {
  const opened = makeModal("close", { openedWithCtrlEnter: true });
  await opened.modal.onKeyDown(event("Enter", { ctrlKey: true }));
  assert.equal(opened.actions.length, 0);
  opened.modal.onKeyUp(event("Enter", { ctrlKey: true }));
  await opened.modal.onKeyDown(event("Enter", { ctrlKey: true }));
  assert.equal(opened.actions.length, 1);

  const locked = makeModal("close", { lock: h.bankCategoryLockInit(Date.now()) });
  await locked.modal.onKeyDown(event("Enter", { ctrlKey: true }));
  assert.equal(locked.actions.length, 0);
});

test("old Bob uses arrow navigation and Enter when no category has a hotkey", async () => {
  const oldCategories = CATEGORIES.filter((entry) => entry.hidden !== true)
    .map((entry) => ({ ...entry, hotkey: null }));
  const state = makeModal("close", { categories: oldCategories, highlightKey: null });
  await state.modal.onKeyDown(event("ArrowDown"));
  assert.equal(state.modal.highlightKey, "coffee");
  await state.modal.onKeyDown(event("Enter"));
  assert.deepEqual(state.actions, [{ category: "coffee", kind: "accept", mode: "close" }]);
});

test("hidden categories are absent from completions and one line edit combines the write", () => {
  assert.deepEqual(h.bankCategoryCompletions(CATEGORIES, ""), [
    { key: "coffee", label: "Coffee", emoji: "☕" },
    { key: "groceries", label: "Groceries", emoji: "🛒" },
  ]);
  const line = "- [ ] $1.00 Corner Cafe";
  const edited = h.bankCategoryApplyLineEdits(line, {
    ok: true,
    edits: [
      { fromCh: 3, toCh: 4, insert: "x" },
      { fromCh: line.length, toCh: line.length, insert: " [cat:: coffee]" },
    ],
  });
  assert.equal(edited, "- [x] $1.00 Corner Cafe [cat:: coffee]");
});

test("api.bank v2 exposes guarded close and set-category actions plus the command", () => {
  const plugin = new LedgerToolsPlugin({});
  const api = plugin.bankApi();
  assert.equal(api.version, 2);
  assert.equal(typeof api.claimRowClose, "function");
  assert.equal(typeof api.setCategory, "function");
  plugin.setupBankActions();
  assert.ok(plugin.commands.some((command) => command.id === "bank-set-category" && command.name === "Bank: set category"));
  plugin.teardownBankActions();
});

test("close commits once, refreshes, and lands at the next payee in the same note", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor([
    "## Thu Nov 12",
    "- [ ] $1.00 Corner Cafe ^bank-aaa111",
    "- [ ] $2.00 Market ^bank-bbb222",
    "",
  ].join("\n"));
  const app = { workspace: { getActiveFile: () => ({ path }) } };
  const plugin = new LedgerToolsPlugin(app);
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  assert.ok(context);
  const modal = {
    mode: "close", editor, context, month: "2026-11", session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    setNext(nextContext, progress, lock) { this.next = { context: nextContext, progress, lock }; this.waitingRefresh = true; },
    setReport(report) { this.refreshed = report; },
    paint() {},
    showSummary() {},
  };
  plugin.bankCategoryModal = modal;
  plugin.apiBankRefresh = async () => ({
    report: { categories: CATEGORIES, days: [{ rows: [{ id: "bbb222", path, line: 3, cents: -200, payee: "Market", suggestion: { category: "groceries", source: "learned" } }] }] },
    error: null,
  });

  const committed = await plugin.bankCategoryCommit(modal, "coffee", "pick");
  assert.equal(committed, true);
  assert.equal(editor.replacements.length, 1);
  assert.match(editor.getLine(1), /^- \[x\].*\[cat:: coffee\]/);
  assert.equal(modal.next.context.row.line, 3);
  assert.equal(modal.next.context.row.payee, "Market");
  assert.equal(editor.cursor.line, 2);
  assert.equal(editor.cursor.ch, modal.next.context.token.payeeSpan.start);
  assert.equal(modal.waitingRefresh, false);
  assert.equal(modal.refreshed.categories, CATEGORIES);
});

test("a rejected month refresh after a successful close still clears waitingRefresh", async () => {
  const path = "bank/2026-07.md";
  const editor = editorFor([
    "## Wed Jul 1",
    "- [ ] $1.00 Corner Cafe ^bank-aaa111",
    "- [ ] $2.00 Market ^bank-bbb222",
    "",
  ].join("\n"));
  const app = { workspace: { getActiveFile: () => ({ path }) } };
  const plugin = new LedgerToolsPlugin(app);
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  const modal = {
    mode: "close", editor, context, month: "2026-07", session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    busy: false,
    setNext(nextContext, progress, lock) {
      this.next = { context: nextContext, progress, lock };
      this.waitingRefresh = true;
      this.busy = true;
    },
    setReport(report) { this.refreshed = report; },
    paint() {},
    showSummary() {},
  };
  plugin.bankCategoryModal = modal;
  plugin.apiBankRefresh = async () => { throw new Error("no July report"); };

  const committed = await plugin.bankCategoryCommit(modal, "coffee", "pick");
  assert.equal(committed, true);
  assert.match(editor.getLine(1), /^- \[x\].*\[cat:: coffee\]/);
  assert.equal(modal.next.context.row.payee, "Market");
  assert.equal(modal.waitingRefresh, false);
  assert.equal(modal.busy, false);
});

test("a landed context exposes cardRow so a learned report highlights for Ctrl+Enter", () => {
  const path = "bank/2026-07.md";
  const editor = editorFor([
    "## Wed Jul 1",
    "- [x] $1.00 Corner Cafe [cat:: coffee] ^bank-aaa111",
    "- [ ] $2.00 Market ^bank-bbb222",
    "",
  ].join("\n"));
  const plugin = new LedgerToolsPlugin({ workspace: { getActiveFile: () => ({ path }) } });
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 3);
  assert.equal(context.row.payee, "Market");
  assert.equal(context.cardRow.payee, "Market");
  assert.equal(context.cardRow.line, 3);
  assert.equal(context.cardRow.cents, -200);
  const { modal } = makeModal("close", { categories: CATEGORIES });
  modal.context = context;
  modal.highlightKey = null;
  assert.equal(modal.setReport({
    categories: CATEGORIES,
    days: [{ rows: [{ path, line: 3, cents: -200, payee: "Market", suggestion: { category: "coffee", source: "learned" } }] }],
  }), true);
  assert.equal(modal.highlightKey, "coffee");
  assert.equal(modal.suggestion.category, "coffee");
});

test("a close landing records a jump when nav provides recordJump", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor([
    "## Thu Nov 12",
    "- [ ] $1.00 Corner Cafe ^bank-aaa111",
    "- [ ] $2.00 Market ^bank-bbb222",
    "",
  ].join("\n"));
  const jumps = [];
  const app = {
    workspace: { getActiveFile: () => ({ path }) },
    plugins: { plugins: { "bob-navigation-hotkeys": { api: { recordJump(from, to) { jumps.push({ from, to }); return true; } } } } },
  };
  const plugin = new LedgerToolsPlugin(app);
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  const modal = {
    mode: "close", editor, context, month: "2026-11", session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    setNext(nextContext, progress, lock) { this.next = { context: nextContext, progress, lock }; this.waitingRefresh = true; },
    setReport(report) { this.refreshed = report; },
    paint() {},
    showSummary() {},
  };
  plugin.bankCategoryModal = modal;
  plugin.apiBankRefresh = async () => ({ report: { categories: CATEGORIES, days: [] }, error: null });
  assert.equal(await plugin.bankCategoryCommit(modal, "coffee", "pick"), true);
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].from.path, path);
  assert.equal(jumps[0].from.line, 1);
  assert.equal(jumps[0].to.path, path);
  assert.equal(jumps[0].to.line, 2);
});

test("claimRowClose focuses an open card and swallows the lock instead of flipping", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor("## Thu Nov 12\n- [ ] $1.00 Corner Cafe\n- [ ] $2.00 Market\n");
  const plugin = new LedgerToolsPlugin({ workspace: { getActiveFile: () => ({ path }) } });
  const keys = [];
  const modal = {
    closed: false,
    contentEl: { focused: false, focus() { this.focused = true; } },
    lock: h.bankCategoryLockInit(Date.now()),
    async onKeyDown(event) { keys.push(event && event.key); },
  };
  plugin.bankCategoryModal = modal;
  assert.equal(plugin.bankCategoryClaimRowClose(editor, { file: { path } }), true);
  assert.equal(modal.contentEl.focused, true);
  assert.deepEqual(keys, ["Enter"]);

  plugin.bankCategoryModal = null;
  plugin.bankCategoryOpenAtCursor = () => { throw new Error("boom"); };
  assert.equal(plugin.bankCategoryClaimRowClose(editor, { file: { path } }), false);
});

test("set-category replaces the category without ticking or advancing", async () => {
  const path = "bank/2026-11.md";
  const original = [
    "## Thu Nov 12",
    "- [x] $1.00 Corner Cafe [cat:: coffee] ^bank-aaa111",
    "",
  ].join("\n");
  const editor = editorFor(original);
  const app = { workspace: { getActiveFile: () => ({ path }) } };
  const plugin = new LedgerToolsPlugin(app);
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  let closed = false;
  const modal = {
    mode: "set", editor, context, month: "2026-11", closed: false,
    close() { this.closed = true; closed = true; },
  };
  plugin.bankCategoryModal = modal;
  const committed = await plugin.bankCategoryCommit(modal, "groceries", "pick");
  assert.equal(committed, true);
  assert.equal(editor.replacements.length, 1);
  assert.equal(editor.getLine(1), "- [x] $1.00 Corner Cafe [cat:: groceries] ^bank-aaa111");
  assert.equal(editor.cursor.line, 1);
  assert.equal(closed, true);
});
