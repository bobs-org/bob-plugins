// Make-or-edit for command chips: the Copy | Run kind row, predictable kind
// defaults, live per-step validation through Command Mode's real `resolve`
// (fixture catalog), the Add bob fix, Run serialization, modal keys, one
// undoable write, and Alt+Click from Live Preview chips and bob-run cards.
// Nothing spawns: only the engine's pure resolver is called.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BobCopyChipsPlugin,
  helpers,
  FakeDocument,
  FakeNotice,
  editorLivePreviewField,
  editorInfoField,
} = require("./copy-chips-test-helpers.cjs");
const cm = require("./command-mode-harness.cjs");

const CM_VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "command-mode-resolve-vectors.json"), "utf8"));

const tick = () => new Promise((resolve) => setImmediate(resolve));

// The real Command Mode api over the pinned fixture catalog: plan (report),
// ref create, ref rename (preview-first, needs REF), task archive
// (confirm), task reconcile, and mac-only (hosts: mac).
function realEngine() {
  const base = cm.makeRunner({ catalog: JSON.parse(JSON.stringify(CM_VECTORS.catalog)) });
  const api = cm.helpers.cmCreateApi(base.runner);
  let resolves = 0;
  const engine = {
    ...api,
    resolve(text) {
      resolves += 1;
      return api.resolve(text);
    },
    get resolveCount() {
      return resolves;
    },
  };
  return engine;
}

function makeWorkspace() {
  const handlers = new Map();
  return {
    handlers,
    on(name, callback) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(callback);
      return { name, callback };
    },
    offref(ref) {
      handlers.set(ref.name, (handlers.get(ref.name) || []).filter((callback) => callback !== ref.callback));
    },
    trigger(name, payload) {
      for (const callback of [...(handlers.get(name) || [])]) callback(payload);
    },
  };
}

function makePlugin(options = {}) {
  const engine = options.engine === undefined ? realEngine() : options.engine;
  const pluginsMap = {};
  if (engine) pluginsMap["bob-command-mode"] = { api: { commandMode: engine } };
  const app = {
    isMobile: false,
    workspace: makeWorkspace(),
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
    plugins: {
      plugins: pluginsMap,
      enabledPlugins: new Set(engine ? ["bob-command-mode", "bob-chips"] : ["bob-chips"]),
    },
  };
  const plugin = { app, copyChipAuthorModal: null, registerEvent() {} };
  helpers.commandChipRuntimeSetup(plugin);
  return { plugin, app, engine };
}

function resolver(engine) {
  const e = engine || realEngine();
  return (text) => e.resolve(text);
}

function makeEditor(source, ranges) {
  let value = String(source || "");
  const dispatches = [];
  const selection = {
    ranges: (ranges && ranges.length ? ranges : [{ from: 0, to: 0 }]).map((range) => ({ from: range.from, to: range.to })),
  };
  const editor = {
    getValue: () => value,
    posToOffset: (pos) => (pos && Number.isInteger(pos.ch) ? pos.ch : 0),
    offsetToPos: (offset) => ({ line: 0, ch: offset }),
    cm: {
      dispatch(spec) {
        dispatches.push(spec);
        if (spec && spec.changes) {
          value = value.slice(0, spec.changes.from) + spec.changes.insert + value.slice(spec.changes.to);
        }
        if (spec && spec.selection) selection.ranges = [{ from: spec.selection.anchor, to: spec.selection.head }];
      },
      state: {
        get doc() {
          return { toString: () => value };
        },
        selection,
      },
    },
  };
  editor._dispatches = dispatches;
  Object.defineProperty(editor, "_value", { get: () => value, set: (next) => { value = next; } });
  return editor;
}

function openCard(snapshot, extra = {}) {
  const plugin = extra.plugin || { copyChipAuthorModal: null };
  const saves = [];
  const engine = extra.engine === undefined ? realEngine() : extra.engine;
  const modal = new helpers.CopyChipAuthorModal({}, {
    plugin,
    snapshot,
    clipboardPromise: extra.clipboardPromise,
    engine: () => (engine
      ? { resolve: (text) => engine.resolve(text), reason: null }
      : { resolve: null, reason: "Command Mode is not enabled, so these commands can't be checked here" }),
    onSave: (draft, snap) => {
      saves.push({ draft, snap });
      return true;
    },
  });
  plugin.copyChipAuthorModal = modal;
  modal.open();
  return { modal, saves, plugin };
}

function keyEvent(key, extra = {}) {
  return { key, preventDefault() {}, stopPropagation() {}, ...extra };
}

function cls(el) {
  return (el && el.getAttribute("class")) || "";
}

function has(el, name) {
  return (" " + cls(el) + " ").includes(" " + name + " ");
}

function stepRows(modal) {
  return modal.stepsEl.children.map((row) => [
    cls(row).replace("bob-copy-author-step is-", ""),
    row.querySelector(".bob-copy-author-step-title").textContent,
    row.querySelector(".bob-copy-author-step-meta").textContent,
  ]);
}

function at(source, needle) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error("missing " + needle);
  return index;
}

// --- Pure model ---------------------------------------------------------

test("step ranges split where Command Mode splits, quote-aware", () => {
  const ranges = (text) => helpers.runChipAuthorStepRanges(text).map((range) => range.text);
  assert.deepEqual(ranges("bob a && bob b"), ["bob a", "bob b"]);
  assert.deepEqual(ranges('bob task add "a && b" && bob plan'), ['bob task add "a && b"', "bob plan"]);
  assert.deepEqual(ranges("bob x 'it''s && y' && bob z"), ["bob x 'it''s && y'", "bob z"]);
  assert.deepEqual(ranges("bob a \\&& b"), ["bob a \\&& b"]);
  assert.deepEqual(ranges("  bob a\n\n  bob b  \n"), ["bob a", "bob b"]);
  assert.deepEqual(ranges("bob a &&\nbob b"), ["bob a", "bob b"]);
  const [first, second] = helpers.runChipAuthorStepRanges("x && y");
  assert.deepEqual([first.index, first.from, first.to, second.index, second.from, second.to], [1, 0, 1, 2, 5, 6]);
  assert.deepEqual(helpers.runChipAuthorStepRanges(null), []);
});

test("validation is live and per step through the real resolver", () => {
  const resolve = resolver();
  const ok = helpers.runChipAuthorValidate(resolve, "bob task reconcile && bob plan && bob ref rename a b && bob task archive");
  assert.equal(ok.state, "ready");
  assert.equal(ok.canSave, true);
  assert.deepEqual(ok.steps.map((row) => [row.mark, row.title, row.effect, row.note]), [
    ["ok", "Reconcile task statuses", "writes", "runs now"],
    ["ok", "Today's plan", "reads", "runs now"],
    ["ok", "Rename a reference", "syncs", "preview skipped"],
    ["ok", "Archive done tasks", "writes", "asks first"],
  ]);
  const report = helpers.runChipAuthorValidate(resolve, "bob plan");
  assert.equal(report.steps[0].note, "opens its output");

  const bad = helpers.runChipAuthorValidate(resolve, "bob plan && bob nope && bob ref rename");
  assert.equal(bad.state, "invalid");
  assert.equal(bad.canSave, false);
  assert.equal(bad.reason, "bob has no command `nope` (step 2)");
  assert.deepEqual(bad.steps.map((row) => row.mark), ["ok", "invalid", "invalid"]);
  assert.equal(bad.steps[2].reason, "needs `REF`");

  const shell = helpers.runChipAuthorValidate(resolve, "bob plan | less");
  assert.equal(shell.canSave, false);
  assert.equal(shell.reason, "command chips run bob, not a shell — remove `|`");

  const trailing = helpers.runChipAuthorValidate(resolve, "bob plan &&");
  assert.equal(trailing.canSave, false, "structural faults from the whole verdict block");
  assert.equal(trailing.reason, "empty step after `&&`");

  const host = helpers.runChipAuthorValidate(resolve, "bob mac-only && bob plan");
  assert.equal(host.state, "warn");
  assert.equal(host.canSave, true, "a Mac-only chip may be authored here");
  assert.equal(host.warning, "not available on this host: runs only on mac (step 1)");
  assert.deepEqual(host.steps.map((row) => row.mark), ["warn", "ok"]);

  assert.equal(helpers.runChipAuthorValidate(resolve, "").reason, helpers.RUN_CHIP_NOTHING_TO_RUN);
  assert.equal(helpers.runChipAuthorValidate(resolve, "  ").reason, helpers.RUN_CHIP_AUTHOR_WHITESPACE);
});

test("without Command Mode or while loading, commands can't be checked and Save is allowed", () => {
  const none = helpers.runChipAuthorValidate(null, "bob anything && bob else", { uncheckedReason: "no engine here" });
  assert.equal(none.state, "unchecked");
  assert.equal(none.canSave, true);
  assert.equal(none.warning, "no engine here");
  assert.deepEqual(none.steps.map((row) => [row.mark, row.text]), [["unchecked", "bob anything"], ["unchecked", "bob else"]]);
  assert.equal(helpers.runChipAuthorValidate(null, "x").warning, helpers.RUN_CHIP_AUTHOR_UNCHECKED);

  const loading = (text) => (/\|/.test(text)
    ? { ok: false, state: "invalid", signature: null, steps: [], reason: "command chips run bob, not a shell — remove `|`", step: 1 }
    : { ok: false, state: "loading", signature: null, steps: [], reason: "Command Mode is still loading bob's catalog", step: null });
  const wait = helpers.runChipAuthorValidate(loading, "bob plan");
  assert.equal(wait.state, "unchecked");
  assert.equal(wait.canSave, true);
  assert.equal(wait.warning, helpers.RUN_CHIP_AUTHOR_LOADING);
  assert.equal(helpers.runChipAuthorValidate(loading, "bob plan | less").canSave, false, "syntax still blocks while loading");
  const throwing = helpers.runChipAuthorValidate(() => { throw new Error("boom"); }, "bob plan");
  assert.equal(throwing.canSave, false);
});

test("a missing bob offers Add bob only when adding it would help", () => {
  const resolve = resolver();
  const missing = helpers.runChipAuthorValidate(resolve, "task reconcile && bob plan && plan");
  assert.equal(missing.canSave, false);
  assert.equal(missing.reason, "command chips run only bob (step 1)");
  assert.deepEqual(missing.steps.map((row) => [row.mark, row.fixable]), [["invalid", true], ["ok", false], ["invalid", true]]);
  assert.deepEqual(missing.addBob, { text: "bob task reconcile && bob plan && bob plan", steps: [1, 3] });
  assert.equal(helpers.runChipAuthorValidate(resolve, missing.addBob.text).state, "ready");

  const shell = helpers.runChipAuthorValidate(resolve, "ls -la");
  assert.equal(shell.addBob, null, "bob ls is still not a command");
  assert.equal(shell.steps[0].fixable, false);
  assert.equal(helpers.runChipAuthorWithBob("  a\n  b", [2]), "  a\n  bob b");
});

test("kind defaults are predictable: bob command lines run, everything else copies", () => {
  const resolve = resolver();
  const kind = (text) => helpers.runChipAuthorDefaultKind(resolve, text);
  assert.deepEqual(kind("bob task reconcile"), { kind: "run", addBob: false });
  assert.deepEqual(kind("bob mac-only"), { kind: "run", addBob: false });
  assert.deepEqual(kind("task reconcile"), { kind: "run", addBob: true });
  assert.deepEqual(kind("ssh apollo"), { kind: "copy", addBob: false });
  assert.deepEqual(kind("bob nope"), { kind: "copy", addBob: false });
  assert.deepEqual(kind("bob plan | less"), { kind: "copy", addBob: false });
  assert.deepEqual(kind(""), { kind: "copy", addBob: false });
  assert.deepEqual(helpers.runChipAuthorDefaultKind(null, "bob task reconcile"), { kind: "copy", addBob: false });
});

test("resolve picks the kind: selections, spans, and clipboard default; edits keep theirs", () => {
  const resolveCommand = resolver();
  const source = "Run `bob task reconcile` then `ssh apollo` and `run: bob plan`";
  const select = helpers.copyChipAuthorResolve({
    source: "x bob task reconcile y",
    selections: [{ from: 2, to: 20 }],
    resolveCommand,
  }).snapshot;
  assert.equal(select.kind, "run");
  assert.equal(select.title, "Make command chip");

  const lines = ["Run `bob task reconcile`", "Run `task reconcile`", "Run `ssh apollo`"];
  const span = (line) => {
    const text = lines[line];
    const offset = lines.slice(0, line).reduce((sum, item) => sum + item.length + 1, 0) + text.indexOf("`") + 1;
    return helpers.copyChipAuthorResolve({ source: lines.join("\n"), selections: [{ from: offset, to: offset }], resolveCommand }).snapshot;
  };
  assert.deepEqual([span(0).mode, span(0).kind, span(0).addBob], ["convert", "run", false]);
  assert.deepEqual([span(1).kind, span(1).addBob, span(1).text], ["run", true, "task reconcile"]);
  assert.equal(span(2).kind, "copy");
  const noEngine = helpers.copyChipAuthorResolve({ source: lines[0], selections: [{ from: 6, to: 6 }] }).snapshot;
  assert.equal(noEngine.kind, "copy", "without Command Mode every new chip defaults to Copy");

  const insert = helpers.copyChipAuthorResolve({ source: "", selections: [{ from: 0, to: 0 }], clipboardText: "bob plan", resolveCommand });
  assert.equal(insert.snapshot.kind, "run");

  const runChip = at(source, "run: bob plan") + 1;
  const edit = helpers.copyChipAuthorResolve({ source, selections: [{ from: runChip, to: runChip }], resolveCommand }).snapshot;
  assert.deepEqual([edit.mode, edit.kind, edit.text, edit.title], ["edit", "run", "bob plan", "Edit command chip"]);
  const copySource = "`copy: bob task reconcile`";
  const copyEdit = helpers.copyChipAuthorResolve({ source: copySource, selections: [{ from: 3, to: 3 }], resolveCommand }).snapshot;
  assert.deepEqual([copyEdit.mode, copyEdit.kind], ["edit", "copy"], "a copy chip holding a bob command stays a copy chip");
});

test("the edit target spans both kinds: fences, the line's only chip, and ambiguity", () => {
  const fence = "intro\n```bob-run Morning\nbob task reconcile\nbob plan\n```\nafter";
  const inside = at(fence, "bob plan");
  const block = helpers.copyChipAuthorResolve({ source: fence, selections: [{ from: inside, to: inside }] }).snapshot;
  assert.deepEqual([block.mode, block.kind, block.form, block.label, block.text], ["edit", "run", "block", "Morning", "bob task reconcile\nbob plan"]);
  assert.equal(block.from, at(fence, "```bob-run"));
  assert.equal(block.to, at(fence, "```\nafter") + 3);

  const only = "Run `run: bob plan` today";
  const onlyEdit = helpers.copyChipAuthorResolve({ source: only, selections: [{ from: only.length, to: only.length }] }).snapshot;
  assert.deepEqual([onlyEdit.mode, onlyEdit.kind, onlyEdit.from], ["edit", "run", at(only, "`run:")]);

  const mixed = "`copy: ssh` then `run: bob plan`";
  const gap = helpers.copyChipAuthorResolve({ source: mixed, selections: [{ from: 11, to: 11 }] });
  assert.equal(gap.ok, false);
  assert.equal(gap.reason, "2 chips on this line · move onto one");
  const onCopy = helpers.copyChipAuthorResolve({ source: mixed, selections: [{ from: 2, to: 2 }] }).snapshot;
  assert.equal(onCopy.kind, "copy");
  const chipAt = helpers.copyChipAuthorChipAt(mixed.split("\n"), 0, at(mixed, "run:"));
  assert.deepEqual([chipAt.state, chipAt.kind, chipAt.chip.text], ["ready", "run", "bob plan"]);
});

test("Run serialization: inline span, bob-run fence, tables, and captions", () => {
  const snap = helpers.copyChipAuthorResolve({ source: "x", selections: [{ from: 1, to: 1 }] }).snapshot;
  const plan = (draft) => helpers.copyChipAuthorPlan(snap, { kind: "run", ...draft });
  const inline = plan({ label: "Sync", text: "bob gcal sync -n 2 && bob gkeep pull" });
  assert.deepEqual([inline.ok, inline.kind, inline.markdown, inline.caption], [true, "run", "`run[Sync]: bob gcal sync -n 2 && bob gkeep pull`", "inline chip"]);
  const block = plan({ label: "", text: "bob task reconcile\nbob plan" });
  assert.equal(block.markdown, "\n```bob-run\nbob task reconcile\nbob plan\n```");
  assert.equal(block.caption, "sequence card · 2 steps");
  assert.equal(plan({ text: "  " }).reason, helpers.RUN_CHIP_AUTHOR_WHITESPACE);
  assert.equal(plan({ text: "" }).reason, helpers.RUN_CHIP_NOTHING_TO_RUN);
  const table = helpers.copyChipAuthorResolve({ source: "| a |", selections: [{ from: 2, to: 2 }] }).snapshot;
  assert.equal(helpers.copyChipAuthorPlan(table, { kind: "run", text: "bob a | b" }).markdown, "`run: bob a \\| b`");
  assert.equal(helpers.copyChipAuthorPlan(table, { kind: "run", text: "bob a\nbob b" }).reason, helpers.RUN_CHIP_TABLE_BLOCK);
  const draft = helpers.copyChipAuthorDraftState(snap, "", "bob nope", { kind: "run", resolve: resolver() });
  assert.equal(draft.valid, false, "invalid steps block Save");
  assert.equal(draft.reason, "bob has no command `nope`");
  assert.equal(draft.markdown, "`run: bob nope`", "the exact bytes still show");
  const copyDraft = helpers.copyChipAuthorDraftState(snap, "", "bob nope");
  assert.deepEqual([copyDraft.kind, copyDraft.valid, copyDraft.run], ["copy", true, null]);
});

test("key decisions: Kind arrows and Space, Add bob presses, q types only in fields", () => {
  const action = (event, options) => helpers.copyChipAuthorKeyAction(event, options).type;
  assert.equal(action(keyEvent("ArrowLeft"), { onKind: true }), "kind-prev");
  assert.equal(action(keyEvent("ArrowRight"), { onKind: true }), "kind-next");
  assert.equal(action(keyEvent(" "), { onKind: true }), "kind-toggle");
  assert.equal(action(keyEvent("ArrowRight"), { inField: true, onKind: true }), "type");
  assert.equal(action(keyEvent("ArrowRight", { ctrlKey: true }), { onKind: true }), "ignore");
  assert.equal(action(keyEvent("Enter"), { onKind: true }), "save");
  assert.equal(action(keyEvent("Enter"), { onButton: true }), "press");
  assert.equal(action(keyEvent(" "), { onButton: true }), "press");
  assert.equal(action(keyEvent("q"), { onKind: true }), "cancel");
  assert.equal(action(keyEvent("q"), { inField: true }), "type");
  assert.equal(action(keyEvent("Escape"), { inField: true }), "cancel");
  assert.equal(action(keyEvent("[", { code: "BracketLeft", ctrlKey: true }), { inField: true }), "cancel");
  assert.equal(action(keyEvent("Enter", { shiftKey: true }), { inField: true, inText: true }), "newline");
});

// --- The card -----------------------------------------------------------

test("the card shows the Kind row and switches kinds keeping Label and Text", () => {
  const snapshot = helpers.copyChipAuthorResolve({ source: "see hello", selections: [{ from: 4, to: 9 }] }).snapshot;
  const { modal } = openCard(snapshot);
  assert.equal(modal.titleEl.textContent, "COPY CHIP");
  assert.equal(modal.modalEl.getAttribute("aria-label"), "Make copy chip");
  assert.equal(modal.subtitleEl.textContent, "From the selection");
  assert.equal(modal.kindEl.getAttribute("role"), "radiogroup");
  assert.equal(modal.kindButtons.copy.getAttribute("aria-checked"), "true");
  assert.equal(modal.kindButtons.copy.getAttribute("tabindex"), "0");
  assert.equal(modal.kindButtons.run.getAttribute("tabindex"), "-1");
  assert.equal(modal.textNameEl.textContent, "Text");
  assert.ok(has(modal.stepsRow, "is-hidden"));
  assert.equal(modal.footerEl.textContent, helpers.COPY_CHIP_AUTHOR_FOOTER);
  modal.labelEl.value = "Hi";
  modal.labelEl.dispatch("input", {});

  modal.kindButtons.run.dispatch("click", { preventDefault() {} });
  assert.equal(modal.copyChipKind, "run");
  assert.equal(modal.titleEl.textContent, "COMMAND CHIP");
  assert.equal(modal.modalEl.getAttribute("aria-label"), "Make command chip");
  assert.equal(modal.kindButtons.run.getAttribute("aria-checked"), "true");
  assert.equal(modal.kindButtons.run.focused, true);
  assert.equal(modal.textNameEl.textContent, "Command");
  assert.equal(modal.footerEl.textContent, helpers.RUN_CHIP_AUTHOR_FOOTER);
  assert.equal(has(modal.stepsRow, "is-hidden"), false);
  assert.equal(modal.labelEl.value, "Hi");
  assert.equal(modal.textEl.value, "hello");
  assert.equal(modal.markdownEl.textContent, "`run[Hi]: hello`");
  assert.equal(modal.statusEl.textContent, "command chips run only bob");
  assert.ok(has(modal.statusEl, "is-invalid"));

  modal.copyChipOnKey(keyEvent("ArrowLeft", { target: modal.kindButtons.run }));
  assert.equal(modal.copyChipKind, "copy");
  assert.equal(modal.kindButtons.copy.focused, true);
  modal.copyChipOnKey(keyEvent(" ", { target: modal.kindButtons.copy }));
  assert.equal(modal.copyChipKind, "run");
  modal.copyChipOnKey(keyEvent(" ", { target: modal.kindButtons.run }));
  assert.equal(modal.copyChipKind, "copy");
  assert.equal(modal.markdownEl.textContent, "`copy[Hi]: hello`");
});

test("Run steps show catalog titles, effects, policy notes, and reasons", () => {
  const snapshot = helpers.copyChipAuthorResolve({
    source: "x",
    selections: [{ from: 1, to: 1 }],
    clipboardText: "bob task reconcile && bob ref rename a b && bob mac-only",
    resolveCommand: resolver(),
  }).snapshot;
  assert.equal(snapshot.kind, "run");
  const { modal } = openCard(snapshot);
  assert.deepEqual(stepRows(modal), [
    ["ok", "Reconcile task statuses", "writes · runs now"],
    ["ok", "Rename a reference", "syncs · preview skipped"],
    ["warn", "bob mac-only", "not available on this host: runs only on mac"],
  ]);
  assert.equal(modal.statusEl.textContent, "not available on this host: runs only on mac (step 3)");
  assert.ok(has(modal.statusEl, "is-warning"));
  assert.equal(has(modal.statusEl, "is-invalid"), false);
  const preview = modal.previewHost.querySelector(".bob-run-chip");
  assert.ok(preview, "the inline run chip previews");
  assert.ok(has(preview, "is-unavailable"), "the preview tells the truth for this host");
  assert.equal(modal.captionEl.textContent, "inline chip");

  modal.textEl.value = "bob task reconcile\nbob plan";
  modal.textEl.dispatch("input", {});
  const card = modal.previewHost.querySelector(".bob-run-fence");
  assert.ok(card, "a multi-line draft previews the bob-run card");
  assert.ok(has(card, "is-ready"));
  assert.equal(card.querySelector(".bob-run-fence-run").tagName, "SPAN", "the preview card is inert");
  assert.equal(modal.captionEl.textContent, "sequence card · 2 steps");
  assert.equal(modal.statusEl.textContent, "");
  assert.equal(modal.copyChipSave(), true);
});

test("Add bob fixes bob-less steps, sits in the Tab cycle, and Save waits for it", () => {
  const source = "Run `task reconcile` now";
  const cursor = at(source, "task");
  const snapshot = helpers.copyChipAuthorResolve({ source, selections: [{ from: cursor, to: cursor }], resolveCommand: resolver() }).snapshot;
  assert.deepEqual([snapshot.kind, snapshot.addBob], ["run", true]);
  const { modal, saves } = openCard(snapshot);
  assert.equal(has(modal.addBobEl, "is-hidden"), false);
  assert.deepEqual(stepRows(modal), [["invalid", "task reconcile", "command chips run only bob · Add bob fixes it"]]);
  assert.equal(modal.copyChipSave(), false, "invalid steps block Save");
  assert.equal(saves.length, 0);

  modal.textEl.focus();
  modal.copyChipOnKey(keyEvent("Tab", { target: modal.textEl }));
  assert.equal(modal.addBobEl.focused, true, "Add bob follows the Command field in the Tab cycle");
  modal.copyChipOnKey(keyEvent("Enter", { target: modal.addBobEl }));
  assert.equal(modal.textEl.value, "bob task reconcile");
  assert.ok(has(modal.addBobEl, "is-hidden"));
  assert.equal(modal.markdownEl.textContent, "`run: bob task reconcile`");
  modal.copyChipOnKey(keyEvent("Tab", { target: modal.textEl }));
  assert.equal(modal.kindButtons.run.focused, true, "the cycle wraps to the Kind row once Add bob hides");
  modal.copyChipOnKey(keyEvent("Tab", { target: modal.kindButtons.run }));
  assert.equal(modal.labelEl.focused, true);
  modal.copyChipOnKey(keyEvent("Enter", { target: modal.labelEl }));
  assert.equal(saves.length, 1);
  assert.equal(saves[0].draft.kind, "run");
});

test("without Command Mode the card says so and Save is allowed", () => {
  const snapshot = helpers.copyChipAuthorResolve({ source: "x", selections: [{ from: 1, to: 1 }] }).snapshot;
  const { modal, saves } = openCard(snapshot, { engine: null });
  modal.textEl.value = "bob whatever";
  modal.textEl.dispatch("input", {});
  modal.copyChipSetKind("run", { user: true });
  assert.deepEqual(stepRows(modal), [["unchecked", "bob whatever", ""]]);
  assert.equal(modal.statusEl.textContent, "Command Mode is not enabled, so these commands can't be checked here");
  assert.ok(has(modal.statusEl, "is-warning"));
  assert.ok(modal.previewHost.querySelector(".bob-run-chip"));
  assert.equal(modal.copyChipSave(), true);
  assert.equal(saves[0].draft.markdown, "`run: bob whatever`");
});

test("q types in fields and cancels from the Kind row; Esc and Ctrl+[ cancel", () => {
  const snapshot = helpers.copyChipAuthorResolve({ source: "x", selections: [{ from: 1, to: 1 }], clipboardText: "bob plan", resolveCommand: resolver() }).snapshot;
  const first = openCard(snapshot);
  first.modal.copyChipOnKey(keyEvent("q", { target: first.modal.textEl }));
  assert.equal(first.modal.closed, false);
  first.modal.copyChipOnKey(keyEvent("q", { target: first.modal.kindButtons.run }));
  assert.equal(first.modal.closed, true);
  assert.equal(first.plugin.copyChipAuthorModal, null);
  const second = openCard(snapshot);
  second.modal.copyChipOnKey(keyEvent("Escape", { target: second.modal.labelEl }));
  assert.equal(second.modal.closed, true);
  const third = openCard(snapshot);
  third.modal.copyChipOnKey(keyEvent("[", { code: "BracketLeft", ctrlKey: true, target: third.modal.textEl }));
  assert.equal(third.modal.closed, true);
});

test("a late clipboard prefill picks the kind once, never over a user choice", async () => {
  const snapshot = helpers.copyChipAuthorResolve({ source: "x", selections: [{ from: 1, to: 1 }] }).snapshot;
  let fill;
  const first = openCard(snapshot, { clipboardPromise: new Promise((resolve) => { fill = resolve; }) });
  assert.equal(first.modal.copyChipKind, "copy");
  fill("bob task reconcile");
  await tick();
  assert.equal(first.modal.copyChipKind, "run");
  assert.equal(first.modal.markdownEl.textContent, "`run: bob task reconcile`");

  let fillChosen;
  const second = openCard(snapshot, { clipboardPromise: new Promise((resolve) => { fillChosen = resolve; }) });
  second.modal.copyChipOnKey(keyEvent(" ", { target: second.modal.kindButtons.copy }));
  second.modal.copyChipOnKey(keyEvent("ArrowLeft", { target: second.modal.kindButtons.run }));
  assert.equal(second.modal.copyChipKind, "copy");
  fillChosen("bob task reconcile");
  await tick();
  assert.equal(second.modal.copyChipKind, "copy", "the user's choice wins");
});

test("Enter converts `bob task reconcile` into a command chip in one transaction", () => {
  const source = "- [ ] Run `bob task reconcile` daily";
  const cursor = at(source, "bob task");
  const editor = makeEditor(source, [{ from: cursor, to: cursor }]);
  const view = { file: { path: "gtd.md" }, editor, _loaded: true, containerEl: { isConnected: true } };
  const { plugin } = makePlugin();
  FakeNotice.messages = [];
  assert.equal(helpers.copyChipAuthorRun(plugin, editor, view), true);
  const modal = plugin.copyChipAuthorModal;
  assert.equal(modal.copyChipKind, "run");
  assert.equal(modal.titleEl.textContent, "COMMAND CHIP");
  assert.equal(modal.subtitleEl.textContent, "From the code span");
  modal.copyChipOnKey(keyEvent("Enter", { target: modal.labelEl }));
  assert.equal(editor._value, "- [ ] Run `run: bob task reconcile` daily");
  assert.equal(editor._dispatches.length, 1);
  assert.equal(plugin.copyChipAuthorModal, null);

  const fenceSource = "- [ ] Sync\n  ```bob-copy\n  bob task reconcile\n  bob plan\n  ```";
  const inFence = at(fenceSource, "bob task");
  const fenceEditor = makeEditor(fenceSource, [{ from: inFence, to: inFence }]);
  helpers.copyChipAuthorRun(plugin, fenceEditor, { ...view, editor: fenceEditor });
  const fenceModal = plugin.copyChipAuthorModal;
  assert.equal(fenceModal.copyChipKind, "copy", "editing keeps the kind");
  fenceModal.copyChipSetKind("run", { user: true });
  fenceModal.copyChipSave();
  assert.equal(fenceEditor._value, "- [ ] Sync\n  ```bob-run\n  bob task reconcile\n  bob plan\n  ```", "converting a fence keeps its place and indent");
});

// --- Alt+Click ----------------------------------------------------------

function liveView(source, editor, filePath = "notes/walk.md") {
  const doc = new FakeDocument();
  const view = { dispatched: [], dom: { ownerDocument: doc } };
  view.dispatch = (spec) => view.dispatched.push(spec);
  view.state = {
    doc: {
      length: source.length,
      toString: () => editor._value,
      sliceString: (from, to) => editor._value.slice(from, to),
      lineAt(pos) {
        const before = source.lastIndexOf("\n", pos - 1) + 1;
        const after = source.indexOf("\n", pos);
        const end = after < 0 ? source.length : after;
        return { text: source.slice(before, end), from: before, to: end, number: source.slice(0, before).split("\n").length };
      },
    },
    sliceDoc: (from, to) => editor._value.slice(from, to),
    selection: { ranges: [] },
    field(field) {
      if (field === editorLivePreviewField) return true;
      if (field === editorInfoField) return { file: { path: filePath }, editor };
      throw new Error("unknown field");
    },
  };
  view.visibleRanges = [{ from: 0, to: source.length }];
  return view;
}

function pointer(type, extra = {}) {
  const event = { type, button: 0, clientX: 5, clientY: 5, detail: 1, ...extra };
  event.preventDefault = () => {};
  return event;
}

test("Alt+Click on a Live Preview command chip opens the card for that occurrence and never runs", async () => {
  const source = "`run: bob plan` and `run: bob plan`";
  const editor = makeEditor(source);
  const { plugin, engine } = makePlugin();
  let ran = 0;
  engine.runText = () => {
    ran += 1;
    return Promise.resolve({ ok: true });
  };
  const view = liveView(source, editor);
  const widgets = (helpers.copyChipBuildLiveDecorations(view, plugin).adds || [])
    .map((add) => add.value.widget)
    .filter((widget) => widget && widget.constructor === helpers.commandChipEnsureLiveWidget());
  assert.equal(widgets.length, 2);
  const host = widgets[1].toDOM(view);
  const tip = host.querySelector(".bob-run-chip-tip").children.at(-1).textContent;
  assert.ok(tip.endsWith(helpers.COMMAND_CHIP_EDIT_HINT), tip);
  host.dispatch("mousedown", pointer("mousedown", { altKey: true }));
  host.dispatch("mouseup", pointer("mouseup", { altKey: true }));
  await tick();
  await tick();
  assert.equal(ran, 0);
  const modal = plugin.copyChipAuthorModal;
  assert.ok(modal, "the card opened");
  assert.equal(modal.copyChipKind, "run");
  assert.equal(modal.copyChipSnapshot.mode, "edit");
  assert.equal(modal.copyChipSnapshot.from, source.lastIndexOf("`run:"));
  assert.equal(modal.copyChipSnapshot.to, source.length);
  modal.labelEl.value = "Plan";
  modal.labelEl.dispatch("input", {});
  modal.copyChipSave();
  assert.equal(editor._value, "`run: bob plan` and `run[Plan]: bob plan`");
});

test("Alt+Click refuses a stale span and stays inert without an edit path", async () => {
  const source = "`run: bob plan`";
  const editor = makeEditor(source);
  const { plugin } = makePlugin();
  assert.equal(helpers.copyChipAuthorOpenFromWidget(plugin, liveView(source, editor), 0, source.length, { label: null, text: "bob plan", kind: "copy" }), false, "kinds must match");
  editor._value = "`run: bob nope`";
  assert.equal(helpers.copyChipAuthorOpenFromWidget(plugin, liveView(source, editor), 0, source.length, { label: null, text: "bob plan", kind: "run" }), false);
  assert.equal(plugin.copyChipAuthorModal, null);
  const inert = await helpers.commandChipActivate({ text: "bob plan" }, { plugin, alt: true });
  assert.equal(inert.action, "inert");
  let edits = 0;
  const edit = await helpers.commandChipActivate({ text: "bob plan" }, { plugin, alt: true, edit: () => { edits += 1; return true; } });
  assert.deepEqual([edit.action, edit.ok, edits], ["edit", true, 1]);
});

test("Reading-view command chips never advertise the edit gesture", () => {
  const { plugin } = makePlugin();
  const doc = new FakeDocument();
  const host = helpers.commandChipBuildInline(doc, { label: null, text: "bob plan" }, { interactive: true });
  helpers.commandChipMount(plugin, host, { form: "inline", label: null, text: "bob plan", line: 0, from: 0, to: 15 }, {
    context: () => ({ origin: "reading", sourcePath: "notes/walk.md" }),
  });
  const tip = host.querySelector(".bob-run-chip-tip").children.at(-1).textContent;
  assert.equal(tip.indexOf("⌥Click"), -1, tip);
});

test("Alt+Click on a Live Preview bob-run card edits that fence", () => {
  const source = "intro\n```bob-run Morning\nbob task reconcile\nbob plan\n```";
  const editor = makeEditor(source);
  const { plugin } = makePlugin();
  const view = liveView(source, editor);
  assert.equal(helpers.copyChipAuthorOpenFromFence(plugin, view, 1, { label: "Morning", text: "bob task reconcile\nbob plan" }), true);
  const modal = plugin.copyChipAuthorModal;
  assert.deepEqual([modal.copyChipKind, modal.copyChipSnapshot.form, modal.labelEl.value], ["run", "block", "Morning"]);
  modal.copyChipCancel();
  assert.equal(helpers.copyChipAuthorOpenFromFence(plugin, view, 1, { label: "Morning", text: "bob plan" }), false, "a changed body opens nothing");
  assert.equal(helpers.copyChipAuthorOpenFromFence(plugin, view, 0, { label: null, text: "intro" }), false);
  assert.equal(helpers.copyChipAuthorEditorViewOf(null), null);
});

test("the command is Make or edit chip on Mod+Shift+Y", async () => {
  const plugin = new BobCopyChipsPlugin({ workspace: makeWorkspace(), plugins: { plugins: {} } });
  await plugin.onload();
  const command = plugin.commands.find((item) => item.id === "make-or-edit");
  assert.equal(command.name, "Make or edit chip");
  assert.deepEqual(command.hotkeys, [{ modifiers: ["Mod", "Shift"], key: "y" }]);
  for (const fn of plugin.registers) fn();
  plugin.onunload();
});
