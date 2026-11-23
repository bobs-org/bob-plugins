// Property editor source-exact clipboard and guarded paste phase.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin { constructor(app) { this.app = app; } }
function stubParseYaml(yaml) {
  if (/\[[^\]\n]*$/.test(String(yaml))) throw new Error("unterminated flow sequence");
  const record = Object.create(null);
  for (const line of String(yaml).split("\n")) {
    if (!line.trim() || /^[ \t]/.test(line) || /^\s*#/.test(line)) continue;
    const match = line.match(/^((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^']|'')*')|[^:#]+?):(\s|$)/);
    if (!match) continue;
    let key = match[1].trim();
    if (key.startsWith('"')) key = JSON.parse(key);
    else if (key.startsWith("'")) key = key.slice(1, -1).replace(/''/g, "'");
    record[key] = true;
  }
  return record;
}
const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownView: class {}, Notice: class {}, Platform: { isDesktopApp: true },
    Plugin: TestPlugin, normalizePath: (value) => value, parseYaml: stubParseYaml,
  };
  if (request === "@codemirror/state") return { Prec: { highest: (value) => value } };
  if (request === "@codemirror/view") return {
    EditorView: { updateListener: { of: (listener) => ({ listener }) } },
    keymap: { of: (value) => value },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const H = LedgerToolsPlugin.helpers;

function row(key, line, value, role = "loose", extra = {}) {
  return {
    key, line, end_line: line, value, kind: typeof value === "number" ? "number" : "text",
    role, owner: role === "card" ? "record" : "props", reason: null,
    duplicate: false, opaque: false, ...extra,
  };
}
function report(properties, options = {}) {
  return {
    schema_version: 1, ok: true, path: "notes/item.md", note_kind: "note",
    capabilities: ["props_v1"], fingerprint: options.fingerprint || "sha256:before",
    frontmatter: { state: options.state || "ok", start_line: 1, end_line: 8 }, properties,
  };
}
function clipboardApi(text, options = {}) {
  return {
    written: [],
    async readText() {
      if (options.readError) throw new Error(options.readError);
      return typeof text === "function" ? text() : text;
    },
    async writeText(value) {
      if (options.writeError) throw new Error(options.writeError);
      this.written.push(value);
    },
  };
}
function fakeSession(properties) {
  return {
    state: { status: "browsing", draftOps: [], canApply: false, expect: "sha256:before" },
    draftCalls: [], applied: [], undone: 0, redone: 0,
    setDraft(ops) {
      this.draftCalls.push(ops.slice());
      this.state = {
        ...this.state,
        status: ops.length ? "preview-ready" : "browsing",
        draftOps: ops.slice(), canApply: ops.length > 0, refusal: null,
      };
      return this.state;
    },
    getState() { return this.state; },
    rebase(expect) {
      this.state = { ...this.state, expect, status: this.state.draftOps.length ? "draft" : "browsing", canApply: false };
      return this.state;
    },
    async apply() {
      this.applied.push(this.state.draftOps.slice());
      this.state = { ...this.state, status: "browsing", draftOps: [], canApply: false };
      return {
        ok: true, changed: true,
        report: { ok: true, changed: true, fingerprint_after: "sha256:after", properties },
      };
    },
    async undo() { this.undone += 1; return { ok: true, report: { ok: true, fingerprint_after: "sha256:before", properties } }; },
    async redo() { this.redone += 1; return { ok: true, report: { ok: true, fingerprint_after: "sha256:after", properties } }; },
    close() {},
  };
}
function makePlugin(source, currentReport, options = {}) {
  const app = {
    vault: { getAbstractFileByPath: () => ({ path: "notes/item.md" }), read: async () => source },
    workspace: { getLeavesOfType: () => [] },
  };
  const plugin = {
    app,
    showCalls: 0,
    previewCalls: [],
    apiPropertyShow: async () => {
      plugin.showCalls += 1;
      return options.showOutcome || { ok: true, report: currentReport };
    },
    apiPropertyUpdatePreview: async (_path, envelopeText) => {
      const envelope = JSON.parse(envelopeText);
      const op = envelope.ops[0];
      plugin.previewCalls.push(op);
      const code = options.rejectNewKey?.(op.key, op.yaml);
      if (code) return { ok: true, report: { ok: false, error: { code, message: `Bob refuses ${op.key}.`, hint: "Use the owner." } } };
      return { ok: true, report: { ok: true, dry_run: true, changed: true, properties: currentReport.properties } };
    },
  };
  return plugin;
}
function modalFor(source, currentReport, clipboard, plugin = makePlugin(source, currentReport)) {
  const modal = new H.PropertyEditorModal(plugin.app, { filePath: "notes/item.md", report: currentReport, plugin });
  modal.paintPropertyEditor = () => {};
  modal.propertyEditorClipboard = clipboard;
  return modal;
}
function stubParserForYaml(text) { return stubParseYaml(text); }
async function flush(steps = 20) { for (let i = 0; i < steps; i += 1) await Promise.resolve(); }

test("Mod+C and Mod+V are browse shortcuts while text inputs keep native clipboard behavior", () => {
  assert.equal(H.propertyEditorKeyAction({ key: "c", ctrlKey: true }), "copy");
  assert.equal(H.propertyEditorKeyAction({ key: "v", metaKey: true }), "paste");
  const input = { closest: (selector) => selector === "input,select,textarea" ? {} : null };
  assert.equal(H.propertyEditorKeyAction({ key: "c", ctrlKey: true, target: input }), null);
  assert.equal(H.propertyEditorKeyAction({ key: "v", ctrlKey: true, isComposing: true }), null);
});

test("clipboard selection uses focused fallback and file order for marks", () => {
  const rows = [row("title", 2, "T"), row("locked", 3, "L", "card"), row("count", 4, 4)];
  const entries = rows.map((item, index) => ({ key: item.key, occurrence: 1, raw: `${item.key}: ${item.value}`, index }));
  const focused = H.propertyEditorClipboardSelection(entries, rows, new Set(), H.propertyEditorRowId(rows[2], 2));
  assert.deepEqual(focused.entries.map((entry) => entry.key), ["count"]);
  const marked = H.propertyEditorClipboardSelection(entries, rows,
    new Set([H.propertyEditorRowId(rows[2], 2), H.propertyEditorRowId(rows[0], 0)]), "");
  assert.deepEqual(marked.entries.map((entry) => entry.key), ["title", "count"]);
  const sameLine = [row("dup", 2, "one"), row("dup", 2, "two")];
  const ambiguous = H.propertyEditorClipboardSelection(
    [{ key: "dup", occurrence: 1 }, { key: "dup", occurrence: 2 }],
    sameLine, new Set(), H.propertyEditorRowId(sameLine[0], 0),
  );
  assert.equal(ambiguous.code, "ambiguous-selection");
});

test("paste plan skips all protected roles and opaque values", () => {
  const incoming = ["card", "identity", "derived", "unresolved", "opaque", "loose"].map((key) => ({ key, valueYaml: "x" }));
  const current = [
    row("card", 1, "x", "card"), row("identity", 2, "x", "identity"),
    row("derived", 3, "x", "derived"), row("unresolved", 4, "x", "mystery"),
    row("opaque", 5, "x", "loose", { opaque: true, diagnostic: "Alias is opaque." }),
    row("loose", 6, "old", "loose"),
  ];
  const plan = H.propertyEditorClipboardPlan(incoming, current);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.items.map((item) => item.status), ["skipped", "skipped", "skipped", "skipped", "skipped", "replace"]);
  assert.equal(plan.items[4].reason, "Alias is opaque.");
});

test("copy emits exact source bytes in source order, including comments and read-only keys", async () => {
  const source = "---\n# title comment\ntitle: Original\ntype: record\ncount: 5 # units\n---\nBody\n";
  const properties = [
    row("title", 3, "Original"), row("type", 4, "record", "identity"), row("count", 5, 5, "loose"),
  ];
  const current = report(properties);
  const plugin = makePlugin(source, current);
  const clipboard = clipboardApi("");
  const modal = modalFor(source, current, clipboard, plugin);
  modal.propertyEditorManualMarks = new Set([
    H.propertyEditorRowId(properties[2], 2), H.propertyEditorRowId(properties[1], 1),
  ]);
  const copied = await modal.propertyEditorClipboardCopy();
  assert.equal(copied, true);
  assert.deepEqual(clipboard.written, ["type: record\ncount: 5 # units"]);
  assert.equal(plugin.showCalls, 1);
  assert.equal(plugin.app.vault.read instanceof Function, true);
});

test("copy permission denial is reported without writing the note", async () => {
  const source = "---\ntitle: Original\n---\n";
  const properties = [row("title", 2, "Original")];
  const current = report(properties);
  const plugin = makePlugin(source, current);
  const clipboard = clipboardApi("", { writeError: "denied" });
  const modal = modalFor(source, current, clipboard, plugin);
  assert.equal(await modal.propertyEditorClipboardCopy(), false);
  assert.equal(modal.refusal.code, "clipboard-denied");
  assert.deepEqual(clipboard.written, []);
});

test("paste previews ordered New, Replace, and skipped keys as one undoable batch", async () => {
  const source = "---\ntitle: Old\nlocked: Secret\n---\n";
  const properties = [row("title", 2, "Old"), row("locked", 3, "Secret", "card", { reason: "Record card owns this key." })];
  const current = report(properties);
  const plugin = makePlugin(source, current, { rejectNewKey: (key) => key === "parent" ? "prop_identity" : null });
  const clipboard = clipboardApi("title: New\nnewkey: value\nparent: root\nlocked: no\n");
  const modal = modalFor(source, current, clipboard, plugin);
  const session = fakeSession(properties);
  modal.editorEnsureSession = () => (modal.session ||= session);
  const liveDocument = source;
  assert.equal(await modal.propertyEditorClipboardStartPaste(), true);
  const stage = modal.propertyEditorClipboardStage;
  assert.deepEqual(stage.items.map((item) => item.status), ["replace", "new", "skipped", "skipped"]);
  assert.match(stage.items[0].current.value, /Old/);
  assert.equal(stage.items[2].reason, "Bob refuses parent.");
  assert.deepEqual(stage.ops, [
    { op: "prop.set_yaml", key: "title", yaml: "New" },
    { op: "prop.set_yaml", key: "newkey", yaml: "value" },
  ]);
  assert.equal(stage.previewReady, true);
  assert.equal(plugin.previewCalls.length, 2);
  assert.equal(source, liveDocument, "parsing and preview do not mutate the live note");
  await modal.propertyEditorClipboardSave();
  assert.equal(session.applied.length, 1);
  assert.deepEqual(session.applied[0], stage.ops);
  assert.equal(modal.propertyEditorClipboardStage, null);
  await modal.propertyEditorHistory("undo");
  await modal.propertyEditorHistory("redo");
  assert.equal(session.undone, 1);
  assert.equal(session.redone, 1);
});

test("new protected names become skips through Bob dry-run; all-skipped paste cannot apply", async () => {
  const current = report([]);
  const plugin = makePlugin("", current, { rejectNewKey: () => "prop_identity" });
  const clipboard = clipboardApi("parent: root\ntype: record\n");
  const modal = modalFor("", current, clipboard, plugin);
  const session = fakeSession([]);
  modal.editorEnsureSession = () => (modal.session ||= session);
  assert.equal(await modal.propertyEditorClipboardStartPaste(), true);
  const stage = modal.propertyEditorClipboardStage;
  assert.deepEqual(stage.items.map((item) => item.status), ["skipped", "skipped"]);
  assert.deepEqual(stage.ops, []);
  assert.equal(await modal.propertyEditorClipboardSave(), undefined);
  assert.equal(session.applied.length, 0);
});

test("malformed YAML, invalid values, and recovery reports block paste", async () => {
  const current = report([]);
  const malformedPlugin = makePlugin("", current);
  const malformed = modalFor("", current, clipboardApi("key: [unclosed"), malformedPlugin);
  assert.equal(await malformed.propertyEditorClipboardStartPaste(), false);
  assert.equal(malformed.propertyEditorClipboardStage.blocked, true);
  assert.equal(malformedPlugin.showCalls, 0, "invalid clipboard input is rejected before note classification");

  const invalidPlugin = makePlugin("", current, { rejectNewKey: () => "prop_bad_value" });
  const invalid = modalFor("", current, clipboardApi("bad: value\n"), invalidPlugin);
  invalid.editorEnsureSession = () => fakeSession([]);
  assert.equal(await invalid.propertyEditorClipboardStartPaste(), false);
  assert.equal(invalid.propertyEditorClipboardStage.blocked, true);
  assert.equal(invalid.propertyEditorClipboardStage.items[0].status, "blocked");

  const recovery = report([], { state: "invalid", fingerprint: "" });
  const recoveryPlugin = makePlugin("", recovery);
  const damaged = modalFor("", recovery, clipboardApi("safe: value\n"), recoveryPlugin);
  assert.equal(await damaged.propertyEditorClipboardStartPaste(), false);
  assert.equal(damaged.refusal.code, "recovery");
  assert.equal(recoveryPlugin.previewCalls.length, 0);
});

test("paste clipboard permission failures block without a Bob write", async () => {
  const current = report([]);
  const plugin = makePlugin("", current);
  const clipboard = clipboardApi("", { readError: "denied" });
  const modal = modalFor("", current, clipboard, plugin);
  assert.equal(await modal.propertyEditorClipboardStartPaste(), false);
  assert.equal(modal.propertyEditorClipboardStage.blocked, true);
  assert.equal(plugin.showCalls, 0);
  assert.equal(plugin.previewCalls.length, 0);
});

test("stale preview refreshes the listing and keeps the same batch for explicit confirmation", async () => {
  const current = report([row("title", 2, "Old")]);
  const plugin = makePlugin("---\ntitle: Old\n---\n", current);
  const modal = modalFor("---\ntitle: Old\n---\n", current, clipboardApi("title: New\n"), plugin);
  const session = fakeSession(current.properties);
  modal.editorEnsureSession = () => (modal.session ||= session);
  await modal.propertyEditorClipboardStartPaste();
  const stage = modal.propertyEditorClipboardStage;
  const approvedOps = stage.ops.map((op) => ({ ...op }));
  session.state = { ...session.state, status: "refused", canApply: false, refusal: { kind: "stale", code: "prop_stale", message: "Stale." } };
  modal.propertyEditorClipboardSyncPreview();
  await flush();
  assert.equal(plugin.showCalls, 2, "the stale refresh rereads the listing after the initial report");
  assert.equal(stage.requiresPreview, true);
  assert.deepEqual(stage.ops, approvedOps);
  await modal.propertyEditorClipboardSave();
  assert.equal(session.applied.length, 1);
  assert.deepEqual(session.applied[0], approvedOps);
});

test("ownership change refreshes the listing but never silently shrinks the displayed batch", async () => {
  const current = report([row("title", 2, "Old")]);
  const plugin = makePlugin("---\ntitle: Old\n---\n", current);
  const modal = modalFor("---\ntitle: Old\n---\n", current, clipboardApi("title: New\n"), plugin);
  const session = fakeSession(current.properties);
  modal.editorEnsureSession = () => (modal.session ||= session);
  await modal.propertyEditorClipboardStartPaste();
  const stage = modal.propertyEditorClipboardStage;
  const approvedOps = stage.ops.map((op) => ({ ...op }));
  session.state = { ...session.state, status: "refused", canApply: false, refusal: { code: "prop_identity", message: "Role changed." } };
  modal.propertyEditorClipboardSyncPreview();
  await flush();
  assert.equal(plugin.showCalls, 2);
  assert.equal(stage.blocked, true);
  assert.deepEqual(stage.ops, approvedOps);
  assert.equal(await modal.propertyEditorClipboardSave(), false);
  assert.equal(session.applied.length, 0);
});

test("cancellation during clipboard read prevents later classification", async () => {
  const current = report([]);
  const plugin = makePlugin("", current);
  let releaseRead;
  const clipboard = {
    written: [],
    readText: () => new Promise((resolve) => { releaseRead = () => resolve("safe: value\n"); }),
    writeText: async (value) => clipboard.written.push(value),
  };
  const modal = modalFor("", current, clipboard, plugin);
  const opening = modal.propertyEditorClipboardStartPaste();
  modal.propertyEditorClipboardCancel();
  releaseRead();
  await opening;
  assert.equal(modal.propertyEditorClipboardStage, null);
  assert.equal(plugin.showCalls, 0);
  assert.equal(plugin.previewCalls.length, 0);
});
