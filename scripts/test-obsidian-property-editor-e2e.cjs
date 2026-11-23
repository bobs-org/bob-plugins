#!/usr/bin/env node
// Offline wrapper for the real-Obsidian Property Editor proof. It validates
// the fixtures and fake-bob JSON boundary without launching Obsidian.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const vm = require("node:vm");
const diagnostics = require("./obsidian-property-editor-e2e-diagnostics.cjs");
const lib = require("./obsidian-property-editor-e2e-lib.cjs");
const runner = require("./obsidian-property-editor-e2e.cjs");

test("obsidian-property-editor-e2e --self-test", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "obsidian-property-editor-e2e.cjs"), "--self-test"], {
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  assert.match(String(result.stdout || ""), /offline self-test complete/);
  assert.match(String(result.stdout || ""), /no Obsidian launched/);
});

test("runner advertises the complete editor acceptance matrix", () => {
  assert.equal(new Set(lib.ACCEPTANCE_CHECKS).size, lib.ACCEPTANCE_CHECKS.length);
  for (const check of [
    "project-edit-undo-redo-disk-bytes", "project-add-disk-bytes", "project-delete-undo-disk-bytes",
    "plain-note-add-undo-redo-framing-disk-bytes", "tab-completion-preserves-known-type",
    "shift-enter-keeps-literal-name-as-text", "day-note-edit-disk-bytes", "record-field-handoff",
    "derived-and-identity-gestures-refused-and-yaml-targets", "checkbox-flip-disk-bytes",
    "datetime-no-offset-disk-bytes", "datetime-explicit-offset-disk-bytes",
    "datetime-relative-token-disk-bytes", "tags-without-hash-disk-bytes", "ordered-list-disk-bytes",
    "null-versus-empty-string-disk-bytes", "prose-link-task-band-when-navigation-is-loaded",
    "old-bob-read-only", "invalid-unclosed-and-duplicate-yaml-recovery-targets",
    "exact-note-bytes-after-every-write", "screenshots-light-dark-narrow-wide",
  ]) assert.ok(lib.ACCEPTANCE_CHECKS.includes(check), check);
  assert.equal(typeof runner.run, "function");
  assert.throws(() => lib.parseArgs(["--executable"]), /requires a PATH/);
});

test("missing document selector retains connected modal and lifecycle evidence", () => {
  const document = { URL: "main-window", querySelectorAll: () => [] };
  const owner = { URL: "modal-window", querySelectorAll: () => [{}] };
  const modal = {
    filePath: "projects/project-note.md", closed: false, status: { text: "Checking value…" },
    contentEl: {
      isConnected: true, ownerDocument: owner, outerHTML: '<div class="bob-property-editor"></div>',
      getRootNode: () => ({ nodeName: "#document" }),
    },
  };
  const window = { app: { plugins: { plugins: { "bob-ledger-tools": { propertyEditorModal: modal } } } } };
  const result = vm.runInNewContext(diagnostics.editorDiagnosticSource(), { window, document });
  assert.equal(result.documentEditors, 0);
  assert.equal(result.modal.connected, true);
  assert.equal(result.modal.ownerDocumentMatches, false);
  assert.equal(result.modal.ownerDocumentEditors, 1);
  assert.match(result.modal.contentHtml, /bob-property-editor/);
});

test("lifecycle diagnostics preserve receiver, return values, and thrown open errors", () => {
  class Modal {
    open(value) { this.value = value; return value; }
    onOpen() { throw new Error("mount failed"); }
  }
  const window = { app: { plugins: { plugins: {
    "bob-ledger-tools": { constructor: { helpers: { PropertyEditorModal: Modal } } },
  } } } };
  vm.runInNewContext(diagnostics.installEditorDiagnosticSource(), { window });
  const modal = new Modal();
  assert.equal(modal.open(42), 42);
  assert.equal(modal.value, 42);
  assert.throws(() => modal.onOpen(), /mount failed/);
  assert.equal(window.__bobPropertyEditorLifecycle[0].method, "open");
  assert.match(window.__bobPropertyEditorLifecycle[1].error, /mount failed/);
});
