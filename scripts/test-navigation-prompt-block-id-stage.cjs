// Navigation prompt block-ID stage (plan 202610/task_block_id_prefill.md):
// every mode seeds from the raw target task with the shared helper, legacy
// IDs win only when valid and free, and cross-note rows never fall back to
// the dependent note.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stubPlugin,
  stubStageModal,
  TransactionEditor,
} = require("./navigation-dependencies-stage-harness.cjs");

function stubbedModalForStage({ dependentContent, filePath, cursorLine = 0 }) {
  const { plugin } = stubPlugin({});
  const editor = new TransactionEditor(dependentContent, { line: cursorLine, ch: 0 });
  const modal = stubStageModal(plugin, editor, filePath, cursorLine);
  modal.resultsEl = {};
  modal.inputEl = {
    value: "",
    select: () => {},
  };
  modal.renderAll = () => {};
  modal.renderResults = () => {};
  const applied = [];
  const originalApply = modal.applyOptions.bind(modal);
  modal.applyOptions = (options) => {
    applied.push(options);
    return originalApply(options);
  };
  return { plugin, editor, modal, applied };
}

function showSuggested(modal, task, options) {
  modal.showBlockIdStage(task, options);
  return modal.inputEl.value;
}

test("single seeds from raw text, not display decorations", () => {
  const dependent = "- [ ] #task Dependent ^dependent\n";
  const { modal } = stubbedModalForStage({
    dependentContent: dependent,
    filePath: "body.md",
  });
  const task = {
    line: 1,
    rawLine: "- [ ] #task Fix flaky gkeep test [priority:: high]",
    displayText: "📖 Fix flaky gkeep test",
    existingIdField: null,
    idField: null,
  };
  // Append the target line to the dependent note so occupancy is same-note.
  modal.editor.content = `${dependent}${task.rawLine}\n`;
  const suggested = showSuggested(modal, task, { mode: "single" });
  assert.equal(suggested, "fix-flaky-gkeep");
});

test("legacy valid free wins; invalid and taken fall through", () => {
  const base = "- [ ] #task Other ^other\n";
  const { modal } = stubbedModalForStage({
    dependentContent: base,
    filePath: "body.md",
  });
  const freeTask = {
    line: 1,
    rawLine: "- [ ] #task Book flights [id:: flights]",
    displayText: "Book flights",
    existingIdField: "flights",
  };
  modal.editor.content = `${base}${freeTask.rawLine}\n`;
  assert.equal(showSuggested(modal, freeTask, { mode: "single" }), "flights");

  const invalidTask = {
    line: 1,
    rawLine: "- [ ] #task Book flights [id:: Tasks__target]",
    displayText: "Book flights",
    existingIdField: "Tasks__target",
  };
  modal.editor.content = `${base}${invalidTask.rawLine}\n`;
  assert.equal(showSuggested(modal, invalidTask, { mode: "single" }), "book-flights");

  const takenTask = {
    line: 1,
    rawLine: "- [ ] #task Book flights [id:: flights]",
    displayText: "Book flights",
    existingIdField: "flights",
  };
  modal.editor.content = `${base}- [ ] #task Prior ^flights\n${takenTask.rawLine}\n`;
  assert.equal(showSuggested(modal, takenTask, { mode: "single" }), "book-flights");
});

test("batch reserves suffixes for two same-text tasks", () => {
  const { modal } = stubbedModalForStage({
    dependentContent: "- [ ] #task Dependent\n",
    filePath: "body.md",
  });
  modal.editor.content = "- [ ] #task Dependent\n- [ ] #task Book flights\n- [ ] #task Book flights\n";
  const first = {
    line: 1,
    rawLine: "- [ ] #task Book flights",
    displayText: "Book flights",
    existingIdField: null,
  };
  const second = {
    line: 2,
    rawLine: "- [ ] #task Book flights",
    displayText: "Book flights",
    existingIdField: null,
  };
  modal.pendingBatch = { reservedIds: new Set(), promptQueue: [first, second], promptIndex: 0 };
  const firstId = showSuggested(modal, first, { mode: "batch", position: 1, total: 2 });
  assert.equal(firstId, "book-flights");
  modal.pendingBatch.reservedIds.add(firstId);
  const secondId = showSuggested(modal, second, { mode: "batch", position: 2, total: 2 });
  assert.equal(secondId, "book-flights-2");
});

test("counted-source, vault-single, and vault-counted seed per mode", () => {
  const { modal } = stubbedModalForStage({
    dependentContent: "- [ ] #task Dependent\n- [ ] #task Renew the library books\n",
    filePath: "body.md",
  });
  const task = {
    line: 1,
    rawLine: "- [ ] #task Renew the library books",
    displayText: "Renew the library books",
    existingIdField: null,
  };
  assert.equal(showSuggested(modal, task, { mode: "counted-source" }), "renew-library-books");

  modal.vaultStage = {
    files: new Map([
      ["body.md", modal.editor.content],
      ["cash.md", "- [ ] #task Renew the library books ^renew-library-books\n"],
    ]),
  };
  const vaultTask = {
    path: "cash.md",
    line: 1,
    rawLine: "- [ ] #task Renew the library books",
    displayText: "Renew the library books",
    existingIdField: null,
    idField: null,
  };
  modal.pendingVaultSingle = { snapshot: vaultTask, reservedIds: new Set() };
  assert.equal(
    showSuggested(modal, vaultTask, { mode: "vault-single" }),
    "renew-library-books-2",
  );

  modal.pendingVaultCounted = { snapshot: vaultTask, reservedIds: new Set(["renew-library-books"]) };
  assert.equal(
    showSuggested(modal, vaultTask, { mode: "vault-counted" }),
    "renew-library-books-2",
  );
});

test("cross-note uses the target note, never the dependent fallback", () => {
  const { modal } = stubbedModalForStage({
    dependentContent: "- [ ] #task Dependent ^book-flights\n",
    filePath: "body.md",
  });
  modal.vaultStage = {
    files: new Map([
      ["body.md", modal.editor.content],
      ["cash.md", "- [ ] #task Book flights\n"],
    ]),
  };
  const crossTask = {
    path: "cash.md",
    line: 0,
    rawLine: "- [ ] #task Book flights",
    displayText: "Book flights",
    existingIdField: null,
  };
  // Dependent note already holds ^book-flights, but the target does not:
  // the suggestion must be free in cash.md, not body.md.
  assert.equal(showSuggested(modal, crossTask, { mode: "vault-single" }), "book-flights");

  // Missing snapshots stay blank instead of silently using the dependent note.
  modal.vaultStage = { files: new Map([["body.md", modal.editor.content]]) };
  modal.pendingTask = crossTask;
  assert.equal(modal.getBlockIdStageContent(), null);
  assert.equal(showSuggested(modal, crossTask, { mode: "vault-single" }), "");
});

test("staging writes nothing until confirmed", () => {
  const { modal, editor } = stubbedModalForStage({
    dependentContent: "- [ ] #task Dependent\n- [ ] #task Book flights\n",
    filePath: "body.md",
  });
  const before = editor.content;
  const task = {
    line: 1,
    rawLine: "- [ ] #task Book flights",
    displayText: "Book flights",
    existingIdField: null,
  };
  showSuggested(modal, task, { mode: "single" });
  assert.equal(editor.content, before);
  modal.clearPendingBatch();
  assert.equal(modal.pendingBatch, null);
});
