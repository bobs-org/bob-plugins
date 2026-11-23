#!/usr/bin/env node
// Offline wrapper for the real-Obsidian Property Editor proof. It validates
// the fixtures and fake-bob JSON boundary without launching Obsidian.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    "panes-save-unsaved-editor-text", "stale-draft-keeps-preview-requirement",
    "history-survives-close-reopen", "yaml-done-restores-leaf-and-key",
    "yaml-done-nearest-row-after-external-delete", "close-esc-q-ctrl-bracket-ladder",
    "q-types-in-text-field", "ctrl-bracket-never-types",
    "unload-open-modal-clears-listeners", "unload-pending-preview-no-late-reopen",
    "entry-plus-chord-live-preview-vim", "entry-plus-chord-shift-equals",
    "entry-palette-edit-note-properties", "entry-command-mode-row",
    "entry-drawer-key-label", "entry-drawer-add-property", "entry-drawer-edit-all",
    "entry-api-open-property-editor", "entry-ordinary-and-invalid-yaml-notes",
    "screenshots-reviewed-light-dark-narrow-wide",
  ]) assert.ok(lib.ACCEPTANCE_CHECKS.includes(check), check);
  for (const check of lib.ACCEPTANCE_CHECKS) {
    assert.ok(lib.COVERAGE_PATTERNS[check], check);
  }
  assert.equal(typeof lib.visualLayoutSource, "function");
  assert.match(lib.visualLayoutSource(), /selectedDiffers/);
  assert.match(lib.fixtureNotes()["surfaces.md"], /keep_me: "original"/);
  assert.match(lib.fixtureNotes()["ordinary.md"], /title: "Ordinary note"/);
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

test("startup focus waits for Obsidian to leave its blank window before opening modals", async () => {
  const calls = [];
  const window = { focus: () => calls.push("focus") };
  const document = { hasFocus: () => true, URL: "app://obsidian.md/index.html" };
  const blank = {
    close: () => calls.push("close-blank"),
    destroy: () => calls.push("destroy-blank"),
    webContents: { getURL: () => "about:blank", focus: () => {} },
  };
  const current = {
    show: () => calls.push("native-show"),
    focus: () => calls.push("native-focus"),
    webContents: { focus: () => calls.push("webcontents-focus"), getURL: () => document.URL },
  };
  const context = { window, document, activeWindow: blank, activeDocument: { URL: "about:blank" } };
  context.require = () => ({
    remote: {
      getCurrentWindow: () => current,
      BrowserWindow: { getAllWindows: () => [current, blank] },
    },
  });
  const client = {
    call: async (method) => calls.push(method),
    evaluate: async (source) => vm.runInNewContext(source, context),
  };
  const result = await diagnostics.focusApplicationWindow(client, async (cdp, source, ready) => {
    assert.equal(calls[0], "Page.bringToFront");
    assert.equal(calls.filter((name) => name === "Input.dispatchMouseEvent").length, 2);
    const stale = await cdp.evaluate(source);
    assert.equal(ready(stale), false, "a focused page with a stale activeWindow is unsafe");
    assert.equal(JSON.stringify(stale.closed), JSON.stringify(["about:blank", "about:blank"]));
    assert.ok(calls.includes("native-focus"));
    assert.ok(calls.includes("focus"));
    assert.ok(calls.includes("close-blank"));
    assert.ok(calls.includes("destroy-blank"));
    context.activeWindow = window;
    context.activeDocument = { URL: document.URL };
    document.hasFocus = () => false;
    assert.equal(ready(await cdp.evaluate(source)), false, "keyboard input needs page focus too");
    document.hasFocus = () => true;
    const state = await cdp.evaluate(source);
    assert.equal(ready(state), true);
    return state;
  });
  assert.equal(result.documentUrl, document.URL);
});

test("every API open restores focus lost during note navigation", async () => {
  let focused = false;
  let opens = 0;
  let readPolls = 0;
  const editor = { querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null };
  const document = {
    hasFocus: () => focused, URL: "app://obsidian.md/index.html",
    querySelector: () => opens ? editor : null,
    querySelectorAll: () => opens ? [editor] : [],
  };
  const window = {
    focus: () => { focused = true; context.activeWindow = window; },
    app: { plugins: { plugins: { "bob-ledger-tools": {
      async openPropertyEditor({ filePath }) {
        assert.equal(focused, true, "the modal must open in the app document");
        assert.equal(context.activeWindow, window);
        assert.equal(filePath, "projects/project-note.md");
        opens += 1;
        this.propertyEditorModal = { report: null, refusal: null };
        readPolls = 0;
        return { ok: true, modal: { contentEl: { isConnected: true } } };
      },
    } } } },
  };
  const context = { window, document, activeWindow: {} };
  context.require = () => ({ remote: { getCurrentWindow: () => ({ focus: () => {} }) } });
  const client = {
    call: async () => {},
    evaluate: async (source) => {
      if (source === lib.editorProbeSource()) {
        readPolls += 1;
        if (readPolls === 2) {
          const modal = window.app.plugins.plugins["bob-ledger-tools"].propertyEditorModal;
          if (opens === 1) modal.report = { properties: [] };
          else modal.refusal = { code: "needs-bob" };
        }
      }
      return vm.runInNewContext(source, context);
    },
  };
  for (let i = 0; i < 2; i += 1) {
    focused = false;
    context.activeWindow = {};
    assert.equal((await runner.openPropertyEditor(client, "projects/project-note.md")).open, true);
    assert.equal(readPolls, 2, "cached DOM must wait for a Bob report or a typed refusal");
  }
  assert.equal(opens, 2);
});

test("runner wires surface, visual, and unload acceptance with companion plugins", () => {
  const source = fs.readFileSync(path.join(__dirname, "obsidian-property-editor-e2e.cjs"), "utf8");
  assert.match(source, /runSurfaceAcceptance/);
  assert.match(source, /runVisualReview/);
  assert.match(source, /runUnloadAcceptance/);
  assert.match(source, /bob-command-mode/);
  assert.match(source, /bob-navigation-hotkeys/);
  assert.match(source, /vimMode:\s*true/);
  assert.match(source, /command-palette:open/);
  assert.match(source, /coverageFromAssertions/);
  const surfaces = require("./obsidian-property-editor-e2e-surfaces.cjs");
  assert.equal(typeof surfaces.runSurfaceAcceptance, "function");
  assert.equal(typeof surfaces.runVisualReview, "function");
  assert.equal(typeof surfaces.runUnloadAcceptance, "function");
});

test("coverage mapping fails a missing surface assertion", () => {
  const coverage = lib.coverageFromAssertions(["q-types-in-text-field"], [{ name: "unrelated", status: "pass" }]);
  assert.equal(coverage[0].status, "fail");
  const passing = lib.coverageFromAssertions(["q-types-in-text-field"], [{ name: "q types in a text field", status: "pass" }]);
  assert.equal(passing[0].status, "pass");
});

test("stale refusal wait matches the Property Editor copy and retries preview", () => {
  const athenaProbe = {
    open: true,
    stage: "Edit edit_me",
    stageKind: "text",
    stageInput: "held-draft",
    status: "The note changed. Your draft is kept; press Enter to preview it against the current note. — Nothing was written.",
    banner: "",
    recovery: "",
    stagePreview: "The note changed; preview this draft again before saving.",
  };
  assert.equal(lib.isStaleRefusalCopy(athenaProbe), true);
  assert.equal(athenaProbe.open && athenaProbe.stage && /held-draft/.test(athenaProbe.stageInput) && lib.isStaleRefusalCopy(athenaProbe), true);
  assert.equal(lib.isStaleRefusalCopy({
    status: "The note changed. Your draft is kept; press Enter to preview it against the current note. — Nothing was written.",
    banner: "",
    stagePreview: "",
  }), true);
  assert.equal(lib.isStaleRefusalCopy({ status: "Preview ready · Enter saves", banner: "", stagePreview: "Preview · edit_me: held-draft" }), false);
  const athenaStaleBytes = "---\ntype: \"[[note]]\"\nkeep_me: elsewhere\nedit_me: \"draft\"\n---\n";
  assert.equal(lib.yamlHasScalar(athenaStaleBytes, "edit_me", "draft"), true);
  assert.equal(lib.yamlHasScalar(athenaStaleBytes, "keep_me", "elsewhere"), true);
  assert.equal(lib.yamlHasScalar(athenaStaleBytes, "edit_me", "held-draft"), false);
  assert.equal(athenaStaleBytes.includes("edit_me: draft"), false);
  const surfaces = fs.readFileSync(path.join(__dirname, "obsidian-property-editor-e2e-surfaces.cjs"), "utf8");
  const stages = fs.readFileSync(path.join(__dirname, "../plugins/bob-ledger-tools/src/298i-plugin-property-editor-modal-stages.js"), "utf8");
  assert.match(lib.editorProbeSource(), /stagePreview/);
  assert.match(surfaces, /lib\.isStaleRefusalCopy\(value\)/);
  assert.match(surfaces, /lib\.yamlHasScalar\(staleBytes, "edit_me", "draft"\)/);
  assert.match(surfaces, /held-draft/);
  const staleWait = surfaces.indexOf("stale refusal keeps the stage");
  const retryEnter = surfaces.indexOf("sendKey(client, \"Enter\")", staleWait);
  const freshPreview = surfaces.indexOf("fresh preview after stale");
  assert.ok(staleWait >= 0 && retryEnter >= 0 && freshPreview >= 0);
  assert.ok(retryEnter < freshPreview, "Enter requests a fresh preview after the stale refusal");
  assert.match(stages, /The note changed\. Your draft is kept; press Enter to preview it against the current note\./);
  assert.match(stages, /The note changed; preview this draft again before saving\./);
});

test("reopened undo wait matches exact draft value, not held-draft", () => {
  const held = { key: "edit_me", text: "≡edit_meheld-draft", valueText: "held-draft" };
  const restored = { key: "edit_me", text: "≡edit_medraft", valueText: "draft" };
  assert.equal(/draft/.test(held.text), true);
  assert.equal(held.valueText === "draft", false);
  assert.equal(restored.valueText === "draft", true);
  const surfaces = fs.readFileSync(path.join(__dirname, "obsidian-property-editor-e2e-surfaces.cjs"), "utf8");
  const undoWait = surfaces.indexOf("undo after reopen");
  assert.ok(undoWait >= 0);
  const waitSlice = surfaces.slice(surfaces.lastIndexOf("waitForEditor", undoWait), undoWait);
  assert.match(waitSlice, /row\.valueText === "draft"/);
  assert.match(waitSlice, /history\?\.undo \|\| 0\) === undoBefore - 1/);
  assert.match(waitSlice, /!\/Checking\/i\.test\(value\.status/);
  assert.doesNotMatch(waitSlice, /\/draft\/\.test\(row\.text\)/);
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
