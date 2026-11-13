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

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this._text = "";
    this.disabled = false;
  }

  set className(value) { this.setAttribute("class", String(value || "")); }
  get className() { return this.getAttribute("class") || ""; }
  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" ");
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  appendChild(child) {
    if (child.parentNode && Array.isArray(child.parentNode.children)) {
      const old = child.parentNode.children.indexOf(child);
      if (old >= 0) child.parentNode.children.splice(old, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    for (const child of nodes) this.appendChild(child);
  }
  empty() { this.replaceChildren(); }
  addEventListener(event, callback) {
    const handlers = this.listeners.get(event) || [];
    handlers.push(callback);
    this.listeners.set(event, handlers);
  }
  classTokens() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  matches(selector) {
    const tokens = this.classTokens();
    const classOk = Array.from(String(selector).matchAll(/\.([\w-]+)/g))
      .every((match) => tokens.includes(match[1]));
    const attrOk = Array.from(String(selector).matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))
      .every((match) => {
        const value = this.getAttribute(match[1]);
        return value !== null && (match[2] === undefined || match[2] === value);
      });
    return classOk && attrOk;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function paintModal(mode, options = {}) {
  const doc = { createElement: (tag) => new FakeNode(tag, doc) };
  const content = new FakeNode("div", doc);
  const { modal, actions } = makeModal(mode, options);
  modal.contentEl = content;
  modal.app = { document: doc };
  if (options.progress) modal.progress = options.progress;
  if (options.context) modal.context = options.context;
  if (options.row) {
    modal.context = {
      path: options.path || "bank/2026-11.md",
      cardRow: options.row,
    };
  }
  if (options.reason !== undefined) modal.reason = options.reason;
  modal.paint();
  return { modal, actions, content };
}

test("the painted root uses bob-bank-category-card and not the month-card token", () => {
  const { content } = paintModal("close", {
    progress: { filed: 1, total: 3, waiting: 2 },
    row: { payee: "Corner Cafe", cents: -645, date: "2026-11-12" },
  });
  const root = content.querySelector(".bob-bank-category-card");
  assert.ok(root);
  const tokens = root.classTokens();
  assert.ok(tokens.includes("bob-bank-category-card"));
  assert.ok(tokens.includes("bob-key-card"));
  assert.equal(tokens.includes("bob-bank-category"), false);
  assert.equal(content.querySelector(".bob-bank-category"), null);
});

test("the header puts amount first, inflows show +, and progress names the month", () => {
  const outflow = paintModal("close", {
    progress: { filed: 2, total: 5, waiting: 3 },
    row: { payee: "Corner Cafe", cents: -645, date: "2026-11-12", flagged: true, account: "cash" },
  });
  const header = outflow.content.querySelector(".bob-bank-category-header");
  assert.match(header.textContent, /^\$6\.45 Corner Cafe Nov 12/);
  assert.equal(outflow.content.querySelector(".bob-bank-category-amount.is-inflow"), null);
  assert.match(outflow.content.querySelector(".bob-bank-category-progress").textContent, /2 of 5 · November/);
  assert.ok(outflow.content.querySelector(".bob-bank-category-meter"));
  assert.ok(outflow.content.querySelector(".bob-bank-category-chip"));

  const inflow = paintModal("close", {
    progress: { filed: 1, total: 1, waiting: 0 },
    row: { payee: "Payroll", cents: 250000, date: "2026-11-12" },
  });
  const amount = inflow.content.querySelector(".bob-bank-category-amount");
  assert.equal(amount.textContent, "+$2,500.00");
  assert.ok(amount.classTokens().includes("is-inflow"));
  assert.match(inflow.content.querySelector(".bob-bank-category-header").textContent, /^\+\$2,500\.00 Payroll/);

  const setMode = paintModal("set", {
    row: { payee: "Corner Cafe", cents: -645, date: "2026-11-12", acknowledged: true },
  });
  assert.match(setMode.content.querySelector(".bob-bank-category-state").textContent, /acknowledged/);
  assert.equal(setMode.content.querySelector(".bob-bank-category-meter"), null);
});

test("tiles render keycaps, aria-keyshortcuts, and a live region after filing", () => {
  const { modal, content } = paintModal("close", {
    progress: { filed: 1, total: 2, waiting: 1 },
    row: { payee: "Corner Cafe", cents: -645, date: "2026-11-12" },
    highlightKey: "coffee",
  });
  const coffee = content.querySelectorAll(".bob-bank-category-tile")
    .find((tile) => tile.getAttribute("data-category-key") === "coffee");
  assert.ok(coffee);
  assert.equal(coffee.getAttribute("aria-keyshortcuts"), "c");
  assert.equal(coffee.getAttribute("aria-pressed"), "true");
  const keycap = coffee.querySelector(".bob-bank-category-keycap");
  assert.equal(keycap.textContent, "C");
  assert.match(coffee.textContent, /↵/);
  modal.announce("Filed $6.45 as Coffee · next $12.90 waiting");
  const live = content.querySelector(".bob-bank-category-live");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(live.textContent, "Filed $6.45 as Coffee · next $12.90 waiting");
  modal.paint();
  assert.equal(modal.liveRegion, live);
  assert.equal(content.querySelector(".bob-bank-category-live").textContent,
    "Filed $6.45 as Coffee · next $12.90 waiting");
});

test("restricted mode shows only acknowledge keys and the loading reason", () => {
  const loading = paintModal("close", {
    categories: null,
    reason: "loading…",
    row: { payee: "Corner Cafe", cents: -645, date: "2026-11-12" },
  });
  assert.match(loading.content.querySelector(".bob-bank-category-keys").textContent, /acknowledge/);
  assert.doesNotMatch(loading.content.querySelector(".bob-bank-category-keys").textContent, /letter choose/);
  assert.equal(loading.content.querySelector(".bob-bank-category-hint").textContent, "loading…");

  const failed = paintModal("close", {
    categories: null,
    reason: "bob bank failed.",
    row: { payee: "Corner Cafe", cents: -645, date: "2026-11-12" },
  });
  assert.equal(failed.content.querySelector(".bob-bank-category-hint").textContent, "bob bank failed.");
  assert.doesNotMatch(failed.content.querySelector(".bob-bank-category-hint").textContent, /unavailable —/);
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

test("a successful close saves the note before requesting a refresh", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor([
    "## Thu Nov 12",
    "- [ ] $1.00 Corner Cafe ^bank-aaa111",
    "- [ ] $2.00 Market ^bank-bbb222",
    "",
  ].join("\n"));
  const order = [];
  const app = { workspace: { getActiveFile: () => ({ path }) } };
  const plugin = new LedgerToolsPlugin(app);
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  const announcements = [];
  const modal = {
    mode: "close", editor, context, month: "2026-11",
    session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    categories: CATEGORIES,
    view: { file: { path }, async save() { order.push("save"); } },
    setNext(nextContext, progress, lock) { this.next = { context: nextContext, progress, lock }; this.waitingRefresh = true; },
    setReport(report) { this.refreshed = report; },
    paint() {},
    showSummary() {},
    announce(text) { announcements.push(text); },
  };
  plugin.bankCategoryModal = modal;
  plugin.apiBankRefresh = async () => {
    order.push("refresh");
    return { report: { categories: CATEGORIES, days: [] }, error: null };
  };
  assert.equal(await plugin.bankCategoryCommit(modal, "coffee", "pick"), true);
  assert.deepEqual(order, ["save", "refresh"]);
  assert.match(announcements[0] || "", /Filed \$1\.00 as .*Coffee/);
  assert.match(announcements[0] || "", /next \$2\.00 waiting/);
});

test("a throwing save still refreshes after a successful close", async () => {
  const path = "bank/2026-11.md";
  const editor = editorFor([
    "## Thu Nov 12",
    "- [ ] $1.00 Corner Cafe ^bank-aaa111",
    "- [ ] $2.00 Market ^bank-bbb222",
    "",
  ].join("\n"));
  const order = [];
  const app = { workspace: { getActiveFile: () => ({ path }) } };
  const plugin = new LedgerToolsPlugin(app);
  const context = plugin.bankCategoryContextAt(editor, { file: { path } }, 2);
  const modal = {
    mode: "close", editor, context, month: "2026-11",
    session: h.bankCategorySessionStart(path, Date.now()),
    closed: false,
    view: { file: { path }, async save() { order.push("save"); throw new Error("disk"); } },
    setNext(nextContext, progress, lock) { this.next = { context: nextContext, progress, lock }; this.waitingRefresh = true; },
    setReport(report) { this.refreshed = report; },
    paint() {},
    showSummary() {},
  };
  plugin.bankCategoryModal = modal;
  plugin.apiBankRefresh = async () => {
    order.push("refresh");
    return { report: { categories: CATEGORIES, days: [] }, error: null };
  };
  assert.equal(await plugin.bankCategoryCommit(modal, "coffee", "pick"), true);
  assert.deepEqual(order, ["save", "refresh"]);
  assert.equal(modal.next.context.row.payee, "Market");
});
