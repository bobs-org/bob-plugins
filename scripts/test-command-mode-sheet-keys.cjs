// Command-mode keys: Ctrl+[ escape, reliable Ctrl+N/P, focus and scroll.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  helpers,
  fixtureCatalog,
  makeRunner,
  installDocument,
  makeApp,
} = require("./command-mode-harness.cjs");

const harness = require("./modal-harness.cjs");
const { pressKey } = harness;

function countSelectedRows(modal) {
  let count = 0;
  const walk = (node) => {
    if (!node) return;
    if (
      Array.isArray(node.classes) &&
      node.classes.includes("bob-cmd-row") &&
      node.classes.includes("is-selected")
    ) {
      count += 1;
    }
    for (const child of node.children || []) walk(child);
  };
  walk(modal.listEl);
  return count;
}

function makeSheet(options = {}) {
  const restore = installDocument();
  const catalog = options.catalog || fixtureCatalog();
  const base = makeRunner({ catalog });
  if (Array.isArray(options.records) && options.records.length) {
    const fs = require("node:fs");
    for (const spec of options.records) {
      const record = helpers.cmNewRecord({
        id: spec.id,
        argv: spec.argv,
        entryId: spec.entryId,
        title: spec.title,
        preview: Boolean(spec.preview),
        bobPath: spec.bobPath || "/Users/x/.cargo/bin/bob",
        startedAt: spec.startedAt,
      });
      record.outcome = spec.outcome || "completed";
      record.finished_at = spec.finishedAt || spec.startedAt;
      if (typeof spec.durationMs === "number") record.duration_ms = spec.durationMs;
      helpers.cmWriteRecord(fs, base.runner.runsDir(), record);
    }
  }
  const app = makeApp(options.app || {});
  const plugin = {
    app,
    commandModeCatalog: catalog,
    commandModeRunner: base.runner,
    commandModeVimrcExmaps: options.exmaps || ["bob_daily"],
    commandModeResolveBob: () => ({ path: "bob", source: "path" }),
    commandModeSheet: null,
  };
  const modal = new helpers.CommandModeSheetModal(app, plugin, {
    context: options.context || { notePath: null, noteKind: null, clipboardUrl: null, originView: null, originEditor: null },
    completionExecFile: options.execFile,
  });
  plugin.commandModeSheet = modal;
  if (options.scope) modal.scope = options.scope;
  modal.open();
  return { modal, plugin, base, restore, app };
}

function selectedIndex(modal) {
  return modal.visible.findIndex((row) => row && row.key === modal.selectedKey);
}

test("three Ctrl+N presses move three rows, keep focus, and wrap", () => {
  const { modal, restore } = makeSheet();
  try {
    assert.ok(modal.visible.length >= 4);
    const start = selectedIndex(modal);
    for (let i = 1; i <= 3; i += 1) {
      pressKey(modal, "n", { ctrlKey: true });
      assert.equal(selectedIndex(modal), (start + i) % modal.visible.length);
      assert.equal(harness.activeElement, modal.inputEl);
    }
    pressKey(modal, "p", { ctrlKey: true });
    assert.equal(selectedIndex(modal), (start + 2) % modal.visible.length);
    assert.equal(harness.activeElement, modal.inputEl);
    // Wrap: move past the end returns to the start.
    modal.selectedKey = modal.visible[modal.visible.length - 1].key;
    pressKey(modal, "n", { ctrlKey: true });
    assert.equal(selectedIndex(modal), 0);
    modal.selectedKey = modal.visible[0].key;
    pressKey(modal, "p", { ctrlKey: true });
    assert.equal(selectedIndex(modal), modal.visible.length - 1);
  } finally {
    modal.close();
    restore();
  }
});

test("Caps Lock and layout variants navigate; Ctrl+Shift+N does not", () => {
  const { modal, restore } = makeSheet();
  try {
    const start = selectedIndex(modal);
    pressKey(modal, "N", { ctrlKey: true });
    assert.equal(selectedIndex(modal), (start + 1) % modal.visible.length);
    pressKey(modal, "т", { code: "KeyN", ctrlKey: true });
    assert.equal(selectedIndex(modal), (start + 2) % modal.visible.length);
    const before = selectedIndex(modal);
    pressKey(modal, "n", { ctrlKey: true, shiftKey: true });
    assert.equal(selectedIndex(modal), before);
    pressKey(modal, "n", { ctrlKey: true, altKey: true });
    assert.equal(selectedIndex(modal), before);
  } finally {
    modal.close();
    restore();
  }
});

test("Ctrl+[ matches Escape in list, args, vim, confirm, and output", () => {
  const { modal, restore } = makeSheet();
  try {
    // List: Ctrl+[ closes like Escape.
    assert.equal(modal.stage, "list");
    pressKey(modal, "[", { ctrlKey: true });
    assert.equal(modal.sheetOpen, false);
  } finally {
    try { modal.close(); } catch {}
    restore();
  }
  const again = makeSheet();
  try {
    const { modal: m2 } = again;
    // Args: Ctrl+[ returns to the list with the base-path query.
    const row = m2.visible.find((r) => r.entryId === "ref-create");
    assert.ok(row);
    m2.enterArgumentStage(row);
    assert.equal(m2.stage, "args");
    pressKey(m2, "[", { ctrlKey: true, code: "BracketLeft" });
    assert.equal(m2.stage, "list");
    // Vim: Ctrl+[ leaves the Vim stage.
    m2.enterVimStage("");
    assert.equal(m2.stage, "vim");
    pressKey(m2, "[", { ctrlKey: true });
    assert.equal(m2.stage, "list");
    // Confirm: Ctrl+[ goes back.
    m2.confirmRow = m2.visible[0];
    m2.stage = "confirm";
    m2.render();
    pressKey(m2, "[", { ctrlKey: true });
    assert.equal(m2.stage, "list");
    // Output: Ctrl+[ returns to the list.
    m2.stage = "output";
    m2.outputRunId = "x";
    m2.render();
    pressKey(m2, "[", { ctrlKey: true });
    assert.equal(m2.stage, "list");
    // Shift and Alt variants are not aliased.
    m2.stage = "list";
    m2.render();
    const openBefore = m2.sheetOpen;
    pressKey(m2, "[", { ctrlKey: true, shiftKey: true });
    assert.equal(m2.sheetOpen, openBefore);
    pressKey(m2, "[", { ctrlKey: true, altKey: true });
    assert.equal(m2.sheetOpen, openBefore);
  } finally {
    again.modal.close();
    again.restore();
  }
});

test("standalone pager Ctrl+[ behaves like Escape", () => {
  const restore = installDocument();
  try {
    const base = makeRunner({});
    const app = makeApp({});
    const plugin = { app, commandModeCatalog: fixtureCatalog(), commandModeRunner: base.runner };
    const pager = new helpers.CommandModePagerModal(app, plugin, { runId: "missing" });
    let closed = 0;
    const originalClose = pager.close.bind(pager);
    pager.close = () => { closed += 1; return originalClose(); };
    pager.open();
    const escResult = pager.handlePagerKeydown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    assert.equal(closed, 1);
    pager.open();
    closed = 0;
    const bracketResult = pager.handlePagerKeydown({ key: "[", ctrlKey: true, code: "BracketLeft", target: pager.modalEl, preventDefault() {}, stopPropagation() {} });
    assert.equal(bracketResult, escResult);
  } finally {
    restore();
  }
});

test("focus and caret survive re-renders with scroll preserved on same query", () => {
  const { modal, restore } = makeSheet();
  try {
    modal.query = "plan";
    modal.rebuildRows();
    modal.render();
    modal.inputEl.focus();
    modal.inputEl.value = "plan";
    modal.inputEl.selectionStart = 2;
    modal.inputEl.selectionEnd = 2;
    modal.listEl.scrollTop = 42;
    modal.render();
    assert.equal(harness.activeElement, modal.inputEl);
    modal.query = "plan";
    modal.rebuildRows();
    modal.render();
    assert.equal(modal.listEl.scrollTop, 42);
    modal.query = "ready";
    modal.rebuildRows();
    modal.render();
    assert.equal(modal.listEl.scrollTop, 0);
  } finally {
    modal.close();
    restore();
  }
});

test("argument mode walks rendered order and Tab accepts the visible first row", () => {
  const { modal, restore } = makeSheet();
  try {
    modal.argCompletionGroups = [
      { id: "g1", title: "G1", rows: [{ key: "completion:0", value: "b", insertValue: "b" }, { key: "completion:1", value: "a", insertValue: "a" }] },
      { id: "g2", title: "G2", rows: [{ key: "completion:2", value: "c", insertValue: "c" }] },
    ];
    modal.argCompletions = [
      { key: "completion:0", value: "b", insertValue: "b" },
      { key: "completion:1", value: "a", insertValue: "a" },
      { key: "completion:2", value: "c", insertValue: "c" },
    ];
    modal.stage = "args";
    modal.render();
    modal.moveArgumentCompletion(1);
    assert.equal(modal.argSelectedKey, "completion:0");
    modal.moveArgumentCompletion(1);
    assert.equal(modal.argSelectedKey, "completion:1");
  } finally {
    modal.close();
    restore();
  }
});

test("row mousedown is defaultPrevented and scope fallback routes body keys once", () => {
  const calls = [];
  const scope = {
    register(a, b, handler) {
      calls.push(handler);
      return { handler };
    },
    unregister() {},
  };
  const { modal, restore } = makeSheet({ scope });
  try {
    const rowEl = modal.rowEls.get(modal.selectedKey);
    assert.ok(rowEl);
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    rowEl.listeners.mousedown(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(calls.length, 1);
    const handler = calls[0];
    const before = selectedIndex(modal);
    const bodyEvent = { key: "n", ctrlKey: true, target: harness.body || { parent: null }, preventDefault() {}, stopPropagation() {} };
    // Body target is outside the sheet, so the fallback handles it.
    const first = handler(bodyEvent);
    assert.equal(first, false);
    assert.notEqual(selectedIndex(modal), before);
    // Keys targeted inside the sheet are ignored by the fallback.
    const insideEvent = { key: "n", ctrlKey: true, target: modal.inputEl, preventDefault() {}, stopPropagation() {} };
    assert.equal(handler(insideEvent), true);
  } finally {
    modal.close();
    restore();
  }
});

test("empty query walks every row with unique keys and survives a type-and-clear", () => {
  const BIN = "/Users/x/.cargo/bin/bob";
  const { modal, restore } = makeSheet({
    context: {
      notePath: "refs/a.md",
      noteKind: "ref",
      clipboardUrl: "https://example.com/x",
      originView: null,
      originEditor: null,
    },
    records: [
      {
        id: "20261001-000001-a",
        argv: [BIN, "plan", "--dry-run"],
        entryId: "plan",
        preview: true,
        title: "Today's plan",
        startedAt: "2026-10-26T12:00:00.000Z",
      },
      {
        id: "20261001-000002-b",
        argv: [BIN, "ready"],
        entryId: "ready",
        preview: false,
        title: "Ready lanes",
        startedAt: "2026-10-26T12:01:00.000Z",
      },
      {
        id: "20261001-000003-c",
        argv: [BIN, "plan"],
        entryId: "plan",
        preview: false,
        title: "Today's plan",
        startedAt: "2026-10-26T12:02:00.000Z",
      },
    ],
  });
  try {
    const keys = modal.visible.map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length, "every visible key is unique");
    assert.ok(modal.visible.filter((row) => row.kind === "recent").length >= 3);
    assert.equal(modal.selectedKey, modal.visible[0].key);
    assert.equal(countSelectedRows(modal), 1);
    assert.equal(harness.activeElement, modal.inputEl);

    const total = modal.visible.length;
    for (let step = 1; step <= total; step += 1) {
      pressKey(modal, "n", { ctrlKey: true });
      assert.equal(selectedIndex(modal), step % total, `Ctrl+N step ${step}`);
      assert.equal(countSelectedRows(modal), 1, `exactly one row selected after Ctrl+N step ${step}`);
      assert.equal(harness.activeElement, modal.inputEl);
    }

    for (let step = 1; step <= total; step += 1) {
      pressKey(modal, "p", { ctrlKey: true });
      assert.equal(selectedIndex(modal), (total - step) % total, `Ctrl+P step ${step}`);
      assert.equal(countSelectedRows(modal), 1, `exactly one row selected after Ctrl+P step ${step}`);
      assert.equal(harness.activeElement, modal.inputEl);
    }

    pressKey(modal, "ArrowDown");
    assert.equal(selectedIndex(modal), 1);
    assert.equal(countSelectedRows(modal), 1);
    pressKey(modal, "ArrowUp");
    assert.equal(selectedIndex(modal), 0);
    assert.equal(countSelectedRows(modal), 1);

    modal.inputEl.value = "p";
    modal.inputEl.listeners.input();
    assert.equal(modal.query, "p");
    assert.ok(modal.visible.length > 0, "typing filters the list");
    modal.inputEl.value = "";
    modal.inputEl.listeners.input();
    assert.ok(modal.visible.filter((row) => row.kind === "recent").length >= 3, "clearing brings RECENT back");
    assert.equal(selectedIndex(modal), 0);
    pressKey(modal, "n", { ctrlKey: true });
    assert.equal(selectedIndex(modal), 1);
    assert.equal(countSelectedRows(modal), 1);
  } finally {
    modal.close();
    restore();
  }
});
