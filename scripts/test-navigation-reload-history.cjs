// Disk reloads stay out of the undo history (`182-reload-history.js`).
// Every disk reload of an open note (`userEvent: "set"`) is marked
// `addToHistory: false` so Ctrl+R survives background writes.
const test = require("node:test");
const assert = require("node:assert/strict");

const { helpers } = require("./navigation-hotkeys-harness.cjs");

const { isDiskReloadTransaction, createReloadHistoryExtension } = helpers;

function makeTransactionClass() {
  const tag = {};
  tag.of = (value) => ({ tag: "addToHistory", value });
  return { addToHistory: tag };
}

function makeEditorState() {
  return {
    transactionExtender: {
      of: (fn) => ({ extenderFn: fn }),
    },
  };
}

// CodeMirror's `isUserEvent` prefix-matches on "." segments, so a stub must
// do the same for the `set.something` case to exercise the real call shape:
// the predicate calls `tr.isUserEvent("set")`.
function makeTr({ docChanged, userEvent, annotationValue, hasIsUserEvent = true, hasAnnotation = true }) {
  const tr = { docChanged };
  if (hasIsUserEvent) {
    tr.isUserEvent = (query) => {
      if (typeof userEvent !== "string") return false;
      return userEvent === query || userEvent.startsWith(`${query}.`);
    };
  }
  if (hasAnnotation) {
    tr.annotation = () => annotationValue;
  }
  return tr;
}

test("isDiskReloadTransaction marks a doc-changing set reload", () => {
  const TransactionClass = makeTransactionClass();
  assert.equal(
    isDiskReloadTransaction(makeTr({ docChanged: true, userEvent: "set" }), TransactionClass),
    true,
  );
});

test("isDiskReloadTransaction marks set.something (isUserEvent prefix-match)", () => {
  const TransactionClass = makeTransactionClass();
  assert.equal(
    isDiskReloadTransaction(
      makeTr({ docChanged: true, userEvent: "set.something" }),
      TransactionClass,
    ),
    true,
  );
});

test("non-reload transactions stay in history", () => {
  const TransactionClass = makeTransactionClass();
  for (const userEvent of ["undo", "redo", "input", "delete", "select"]) {
    assert.equal(
      isDiskReloadTransaction(makeTr({ docChanged: true, userEvent }), TransactionClass),
      false,
      userEvent,
    );
  }
  assert.equal(
    isDiskReloadTransaction(makeTr({ docChanged: false, userEvent: "set" }), TransactionClass),
    false,
    "no doc change",
  );
  assert.equal(
    isDiskReloadTransaction(
      makeTr({ docChanged: true, userEvent: "set", hasIsUserEvent: false }),
      TransactionClass,
    ),
    false,
    "no isUserEvent",
  );
  assert.equal(
    isDiskReloadTransaction(makeTr({ docChanged: true, userEvent: null }), TransactionClass),
    false,
    "no userEvent",
  );
});

test("already addToHistory:false stays unmarked", () => {
  const TransactionClass = makeTransactionClass();
  assert.equal(
    isDiskReloadTransaction(
      makeTr({ docChanged: true, userEvent: "set", annotationValue: false }),
      TransactionClass,
    ),
    false,
  );
});

test("missing CodeMirror classes return null from the factory", () => {
  assert.equal(createReloadHistoryExtension({}), null);
  assert.equal(createReloadHistoryExtension({ EditorState: null, Transaction: null }), null);
  assert.equal(
    createReloadHistoryExtension({
      EditorState: makeEditorState(),
      Transaction: {},
    }),
    null,
  );
  // In the Node harness @codemirror/state has no EditorState/Transaction.
  assert.equal(createReloadHistoryExtension(), null);
});

test("extender annotates reloads and passes everything else through", () => {
  const TransactionClass = makeTransactionClass();
  const EditorState = makeEditorState();
  const ext = createReloadHistoryExtension({ EditorState, Transaction: TransactionClass });
  assert.ok(ext && typeof ext.extenderFn === "function");
  const annotated = ext.extenderFn(makeTr({ docChanged: true, userEvent: "set" }));
  assert.deepEqual(annotated, { annotations: { tag: "addToHistory", value: false } });
  assert.equal(ext.extenderFn(makeTr({ docChanged: true, userEvent: "undo" })), null);
  assert.equal(ext.extenderFn(makeTr({ docChanged: false, userEvent: "set" })), null);
});
