// ⌘↵ for command chips (keymap phase): api.commandChips.targetAt and
// runAtCursor, the palette command, the live-binding keycap, the hint model,
// the armed target, and the painter's debounce. A deterministic fake engine
// and a real bob-navigation-hotkeys task scope drive every case.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BobCopyChipsPlugin,
  helpers,
  FakeDocument,
  FakeNotice,
  editorInfoField,
  editorLivePreviewField,
} = require("./copy-chips-test-helpers.cjs");
const nav = require("./navigation-hotkeys-harness.cjs");

const TASK_SCOPE = nav.helpers.createDependencyNavApi(null).taskScope;
const DISPATCH = "bob-navigation-hotkeys:open-reference-pdf-in-highlights";
const SIG_RECONCILE = JSON.stringify(["task-reconcile"]);
const SIG_PLAN = JSON.stringify(["plan"]);
const SIG_SYNC = JSON.stringify(["gcal-sync", "gkeep-pull", "gmail-sync"]);
const SYNC_TEXT = "bob gcal sync -n 2 && bob gkeep pull && bob gmail sync";

function ready(signature, texts) {
  return Object.freeze({
    ok: true,
    state: "ready",
    signature,
    steps: Object.freeze(texts.map((text, index) => Object.freeze({ index: index + 1, text, policy: "run" }))),
    reason: null,
    step: null,
  });
}

function fail(state, reason, step) {
  return Object.freeze({ ok: false, state, signature: null, steps: Object.freeze([]), reason, step: step || null });
}

const VERDICTS = {
  "bob task reconcile": ready(SIG_RECONCILE, ["bob task reconcile"]),
  "bob plan": ready(SIG_PLAN, ["bob plan"]),
  [SYNC_TEXT]: ready(SIG_SYNC, ["bob gcal sync -n 2", "bob gkeep pull", "bob gmail sync"]),
  "bob gcal sync -n 2\nbob gkeep pull\nbob gmail sync": ready(SIG_SYNC, ["bob gcal sync -n 2", "bob gkeep pull", "bob gmail sync"]),
  "bob gcal synk": fail("invalid", "bob has no command `gcal synk`", 1),
  "bob mac-only": fail("unavailable", "not available on this host: runs only on mac", 1),
};

function fakeEngine() {
  const engine = {
    version: 1,
    loading: false,
    runs: [],
    opens: [],
    resolve(text) {
      if (engine.loading) return fail("loading", "Command Mode is still loading bob's catalog");
      return VERDICTS[text] || fail("invalid", "command chips run only bob", 1);
    },
    runText(text, opts) {
      engine.runs.push({ text, opts });
      if (typeof engine.onRun === "function") return engine.onRun(text, opts);
      return Promise.resolve({ ok: true, stage: "run", outcome: "completed", runId: "run-" + engine.runs.length });
    },
    openText(text, opts) {
      engine.opens.push({ text, opts });
      return Promise.resolve({ ok: true, stage: "review", outcome: "opened" });
    },
    openOutput() {
      return Promise.resolve({ ok: true });
    },
    catalogInfo() {
      return Object.freeze({ token: "1:fp" });
    },
  };
  return engine;
}

function makeApp(options = {}) {
  const files = new Set(options.files || ["gtd_daily.md", "ref/paper.md", "notes/walk.md"]);
  const plugins = {
    "bob-navigation-hotkeys": options.nav === null ? undefined : {
      commandChipDispatch: options.flag === undefined ? 1 : options.flag,
      api: { taskScope: TASK_SCOPE },
    },
  };
  if (options.engine) plugins["bob-command-mode"] = { api: { commandMode: options.engine } };
  const hotkeys = options.hotkeys === undefined ? [{ modifiers: ["Meta"], key: "Enter" }] : options.hotkeys;
  return {
    isMobile: Boolean(options.mobile),
    workspace: { on: () => ({}), offref() {} },
    vault: { getAbstractFileByPath: (path) => (files.has(path) ? { path } : null) },
    metadataCache: { getFirstLinkpathDest: () => null },
    hotkeyManager: {
      getHotkeys: (id) => (id === DISPATCH ? hotkeys : undefined),
      getDefaultHotkeys: () => undefined,
    },
    plugins: { plugins, enabledPlugins: new Set(options.enabled || ["bob-command-mode", "bob-chips"]) },
  };
}

function harness(options = {}) {
  FakeNotice.messages.length = 0;
  const engine = options.engine === null ? null : fakeEngine();
  const app = makeApp({ ...options, engine });
  const plugin = { app, registerEvent() {}, register() {} };
  helpers.commandChipRuntimeSetup(plugin);
  return { plugin, app, engine, store: plugin.commandChipRuntime.store };
}

// A MarkdownView-shaped input around a fake Obsidian editor.
function editorAt(text, line, ch, path = "gtd_daily.md", extra = {}) {
  return {
    file: { path },
    editor: {
      getValue: () => (typeof extra.text === "function" ? extra.text() : text),
      getCursor: () => ({ line, ch }),
      somethingSelected: () => Boolean(extra.selected),
      listSelections: () => [{}],
    },
  };
}

// A CM6 EditorView-shaped fake for the hint model and painter.
function cmAt(text, line, ch, options = {}) {
  const lines = text.split("\n");
  const starts = [];
  let offset = 0;
  for (const value of lines) {
    starts.push(offset);
    offset += value.length + 1;
  }
  const lineInfo = (number) => ({
    number,
    from: starts[number - 1],
    to: starts[number - 1] + lines[number - 1].length,
    text: lines[number - 1],
  });
  const head = starts[line] + ch;
  const main = { head, anchor: head, from: head, to: options.to === undefined ? head : options.to, empty: options.to === undefined || options.to === head };
  const dispatched = [];
  const view = {
    hasFocus: options.focus !== false,
    dom: options.dom || null,
    dispatched,
    state: {
      doc: {
        length: text.length,
        lines: lines.length,
        toString: () => text,
        lineAt(pos) {
          let number = 1;
          for (let index = 0; index < starts.length; index += 1) if (starts[index] <= pos) number = index + 1;
          return lineInfo(number);
        },
        line: lineInfo,
        sliceString: (from, to) => text.slice(from, to),
      },
      selection: { main, ranges: options.ranges || [main] },
      field(field) {
        if (field === editorInfoField) return { file: { path: options.path || "gtd_daily.md" } };
        if (field === editorLivePreviewField) return true;
        return undefined;
      },
    },
    dispatch(tr) {
      dispatched.push(tr);
    },
  };
  return view;
}

const GTD = [
  "## Daily",
  "- [ ] #task #gtd **Sync**: `run[Sync calendar and inboxes]: " + SYNC_TEXT + "` ^sync",
  "- [ ] #task #gtd **Reconcile** ^rec",
  "    - `run: bob task reconcile`",
  "- [ ] #task #gtd **Bank**: [Wells Fargo](https://www.wellsfargo.com) → `run[Import bank files]: bob plan` · in [[bank]] ^bank",
  "- [ ] #task Linked [[bank]] row ^lnk",
  "    - `run: bob plan`",
  "- [ ] #task Two `run: bob plan` and `run: bob task reconcile`",
  "- [ ] #task Mixed `copy: bob plan` and `run: bob plan`",
  "```bob-run Morning sync",
  "bob gcal sync -n 2",
  "bob gkeep pull",
  "bob gmail sync",
  "```",
  "- [ ] #task Broken `run: bob gcal synk`",
  "- [ ] #task Mac only `run: bob mac-only`",
  "- [ ] #task Parent `run: bob plan`",
  "    - [ ] #task Child task with no chip",
].join("\n");

test("targetAt follows the ⌘↵ rule through the real task scope", () => {
  const h = harness();
  const lines = GTD.split("\n");
  const at = (line, ch) => helpers.commandChipTargetAt(h.plugin, editorAt(GTD, line, ch));

  const lineChip = at(1, 3);
  assert.equal(lineChip.state, "ready");
  assert.equal(lineChip.via, "line");
  assert.equal(lineChip.chip.label, "Sync calendar and inboxes");
  assert.equal(lineChip.key, SIG_SYNC);
  assert.equal(lineChip.running, false);
  assert.ok(Object.isFrozen(lineChip));

  const task = at(2, 0);
  assert.deepEqual([task.state, task.via, task.chip.text, task.chip.line], ["ready", "task", "bob task reconcile", 3]);

  // The Bank-shaped row: its own chip runs unless the cursor is on a link.
  const bank = at(4, 0);
  assert.deepEqual([bank.state, bank.via, bank.chip.label], ["ready", "line", "Import bank files"]);
  assert.equal(at(4, lines[4].indexOf("Wells")).state, "none", "cursor on the Markdown link");
  assert.equal(at(4, lines[4].indexOf("[[bank")).state, "none", "cursor on the wikilink");
  // A linked task line never borrows its child's chip; the child line runs it.
  assert.equal(at(5, 0).state, "none");
  assert.equal(at(6, 0).state, "ready");

  const two = at(7, 0);
  assert.deepEqual([two.state, two.via, two.count], ["ambiguous", "line", 2]);
  assert.equal(two.message, "2 command chips on this line · move onto one");
  const under = at(7, lines[7].indexOf("`run: bob plan`") + 2);
  assert.deepEqual([under.state, under.via, under.chip.text], ["ready", "cursor", "bob plan"]);

  const mixed = at(8, 0);
  assert.deepEqual([mixed.state, mixed.chip.text, mixed.count], ["ready", "bob plan", 1], "copy chips never count");

  const fence = at(11, 3);
  assert.deepEqual([fence.state, fence.via, fence.chip.form, fence.chip.fence.open], ["ready", "fence", "block", 9]);
  assert.equal(fence.key, SIG_SYNC);

  const broken = at(14, 0);
  assert.deepEqual([broken.state, broken.reason], ["blocked", "bob has no command `gcal synk`"]);
  const mac = at(15, 0);
  assert.deepEqual([mac.state, mac.reason], ["blocked", "not available on this host: runs only on mac"]);

  assert.equal(at(17, 0).state, "none", "a child task never borrows its parent's chip");
  assert.equal(at(0, 0).state, "none");
});

test("no-run contexts skip the whole step so ⌘↵ behaves as today", () => {
  const text = "- [ ] `run: bob plan`";
  const ref = harness();
  const refTarget = helpers.commandChipTargetAt(ref.plugin, editorAt(text, 0, 0, "ref/paper.md"));
  assert.deepEqual([refTarget.state, refTarget.skipped], ["none", "notes under ref/ never run commands"]);

  const noEngine = harness({ engine: null });
  const off = helpers.commandChipTargetAt(noEngine.plugin, editorAt(text, 0, 0));
  assert.deepEqual([off.state, off.skipped], ["none", "Command Mode is not enabled"]);

  const disabled = harness({ enabled: ["bob-chips"] });
  assert.equal(helpers.commandChipTargetAt(disabled.plugin, editorAt(text, 0, 0)).state, "none");

  const mobile = harness({ mobile: true });
  assert.equal(helpers.commandChipTargetAt(mobile.plugin, editorAt(text, 0, 0)).skipped, "commands run only on desktop");

  const unknown = harness();
  assert.equal(helpers.commandChipTargetAt(unknown.plugin, editorAt(text, 0, 0, "notes/gone.md")).state, "none");
  assert.equal(helpers.commandChipTargetAt(unknown.plugin, null).state, "none");
  assert.equal(helpers.commandChipTargetAt(unknown.plugin, { editor: { getValue: () => { throw new Error("boom"); } } }).state, "none");
});

test("loading and running targets stay ready and say so", () => {
  const h = harness();
  h.engine.loading = true;
  const loading = helpers.commandChipTargetAt(h.plugin, editorAt("`run: bob plan`", 0, 0));
  assert.deepEqual([loading.state, loading.loading], ["ready", true]);
  h.engine.loading = false;
  const seq = h.store.begin(SIG_PLAN, { signature: SIG_PLAN });
  h.store.apply(SIG_PLAN, seq, { state: "running", runId: "r1" });
  const running = helpers.commandChipTargetAt(h.plugin, editorAt("`run: bob plan`", 0, 0));
  assert.deepEqual([running.state, running.running, running.loading], ["ready", true, false]);
});

test("runAtCursor runs the target with chip provenance and settles handled", async () => {
  const h = harness();
  const settled = await helpers.commandChipRunAtCursor(h.plugin, editorAt(GTD, 2, 0));
  assert.equal(settled.handled, true);
  assert.equal(settled.stage, "run");
  assert.equal(h.engine.runs.length, 1);
  assert.equal(h.engine.runs[0].text, "bob task reconcile");
  assert.deepEqual(h.engine.runs[0].opts.source, { path: "gtd_daily.md", line: 3 });
  assert.equal(typeof h.engine.runs[0].opts.onState, "function");
  assert.deepEqual(Object.keys(h.engine.runs[0].opts).sort(), ["onState", "source"], "note text never picks run options");

  const fence = harness();
  await helpers.commandChipRunAtCursor(fence.plugin, editorAt(GTD, 11, 0));
  assert.equal(fence.engine.runs[0].text, "bob gcal sync -n 2\nbob gkeep pull\nbob gmail sync");
  assert.deepEqual(fence.engine.runs[0].opts.source, { path: "gtd_daily.md", line: 9 }, "a fence records its opening line");
});

test("none never runs; ambiguous and blocked refuse once and never fall through", async () => {
  const h = harness();
  const none = await helpers.commandChipRunAtCursor(h.plugin, editorAt(GTD, 5, 0));
  assert.deepEqual([none.handled, none.outcome], [false, "none"]);
  const two = await helpers.commandChipRunAtCursor(h.plugin, editorAt(GTD, 7, 0));
  assert.deepEqual([two.handled, two.outcome], [true, "ambiguous"]);
  const broken = await helpers.commandChipRunAtCursor(h.plugin, editorAt(GTD, 14, 0));
  assert.deepEqual([broken.handled, broken.outcome, broken.stage], [true, "refused", "refused"]);
  assert.deepEqual(FakeNotice.messages, [
    "2 command chips on this line · move onto one",
    "Can't run: bob has no command `gcal synk`",
  ]);
  assert.equal(h.engine.runs.length, 0);
  assert.equal(h.engine.opens.length, 0);

  const ref = harness();
  const skipped = await helpers.commandChipRunAtCursor(ref.plugin, editorAt(GTD, 2, 0, "ref/paper.md"));
  assert.deepEqual([skipped.handled, skipped.reason], [false, "notes under ref/ never run commands"]);
  assert.equal(ref.engine.runs.length, 0);
});

test("a span that changed before activation runs nothing", async () => {
  const h = harness();
  let reads = 0;
  const input = editorAt(GTD, 2, 0, "gtd_daily.md", {
    text: () => {
      reads += 1;
      return reads <= 2 ? GTD : GTD.replace("`run: bob task reconcile`", "`run: bob plan`");
    },
  });
  const settled = await helpers.commandChipRunAtCursor(h.plugin, input);
  assert.deepEqual([settled.handled, settled.action], [true, "stale"]);
  assert.equal(h.engine.runs.length, 0);
});

test("a repeated ⌘↵ while the target runs opens its output instead of a second run", async () => {
  const h = harness();
  let finish;
  h.engine.onRun = (_text, opts) => {
    opts.onState({ state: "running", kind: "run", runId: "r1", step: 1, total: 1 });
    return new Promise((resolve) => {
      finish = () => {
        opts.onState({ state: "finished", kind: "run", runId: "r1", outcome: "completed" });
        resolve({ ok: true, stage: "run", outcome: "completed", runId: "r1" });
      };
    });
  };
  const outputs = [];
  h.engine.openOutput = (runId) => {
    outputs.push(runId);
    return Promise.resolve({ ok: true });
  };
  const first = helpers.commandChipRunAtCursor(h.plugin, editorAt("`run: bob plan`", 0, 0));
  await new Promise((resolve) => setImmediate(resolve));
  h.store.claimOutput = () => true;
  const second = await helpers.commandChipRunAtCursor(h.plugin, editorAt("`run: bob plan`", 0, 0));
  assert.deepEqual([second.handled, second.action], [true, "output"]);
  assert.deepEqual(outputs, ["r1"]);
  assert.equal(h.engine.runs.length, 1);
  finish();
  assert.equal((await first).handled, true);
});

test("keycaps come from the live binding in the Gmail hint's convention", () => {
  const meta = { modifiers: ["Meta"], key: "Enter" };
  assert.equal(helpers.commandChipFormatHotkey(meta, true), "⌘↵");
  assert.equal(helpers.commandChipFormatHotkey(meta, false), "M-↵");
  assert.equal(helpers.commandChipFormatHotkey({ modifiers: ["Mod"], key: "Enter" }, false), "C-↵");
  assert.equal(helpers.commandChipFormatHotkey({ modifiers: ["Ctrl", "Shift"], key: "r" }, true), "⌃⇧R");
  assert.equal(helpers.commandChipFormatHotkey(null, true), "");
  assert.equal(helpers.commandChipSpellHotkey(meta, true), "Cmd+Enter");
  assert.equal(helpers.commandChipSpellHotkey(meta, false), "Meta+Enter");

  const rebound = makeApp({ hotkeys: [{ modifiers: ["Alt"], key: "r" }] });
  assert.deepEqual(helpers.commandChipDispatchHotkey(rebound), { modifiers: ["Alt"], key: "r" });
  assert.equal(helpers.commandChipDispatchHotkey(makeApp({ hotkeys: [] })), null, "a cleared custom list beats defaults");
  const defaults = makeApp({ hotkeys: undefined });
  defaults.hotkeyManager.getHotkeys = () => undefined;
  defaults.hotkeyManager.getDefaultHotkeys = (id) => (id === DISPATCH ? [{ modifiers: ["Mod"], key: "Enter" }] : undefined);
  assert.deepEqual(helpers.commandChipDispatchHotkey(defaults), { modifiers: ["Mod"], key: "Enter" });

  assert.equal(helpers.commandChipLiveBinding(makeApp({ flag: 0 })), null, "no capability flag, no keycap");
  assert.equal(helpers.commandChipLiveBinding(makeApp({ nav: null })), null);
  assert.equal(helpers.commandChipLiveBinding(makeApp({ hotkeys: [] })), null, "no binding, no keycap");
  assert.ok(helpers.commandChipLiveBinding(makeApp({})).keycap.endsWith("↵"));
});

test("the hint shows only when ⌘↵ would run the chip, and says what it does", () => {
  const h = harness();
  const keycap = helpers.commandChipLiveBinding(h.app).keycap;
  const model = (line, ch, options) => helpers.commandChipHintModel(h.plugin, cmAt(GTD, line, ch, options));

  const line = model(1, 3);
  assert.equal(line.visible, true);
  assert.equal(line.text, keycap + " Run");
  assert.match(line.ariaLabel, /\+Enter runs Sync calendar and inboxes$/);
  assert.deepEqual([line.armed.form, line.armed.line, line.armed.key, line.armed.sourcePath], ["inline", 1, SIG_SYNC, "gtd_daily.md"]);

  assert.equal(model(2, 0).text, keycap + " Run · bob task reconcile", "a task target names its face");
  assert.equal(model(3, 2).text, keycap + " Run", "the target's own line needs no label");
  assert.equal(model(10, 0).text, keycap + " Run");

  for (const [row, why] of [[5, "link row"], [7, "ambiguous"], [14, "refused"], [0, "nothing"]]) {
    assert.equal(model(row, 0).visible, false, why);
  }
  assert.equal(model(1, 3, { focus: false }).visible, false, "unfocused editor");
  assert.equal(model(1, 3, { to: 40 }).visible, false, "non-empty selection");

  const seq = h.store.begin(SIG_SYNC, { signature: SIG_SYNC, total: 3 });
  h.store.apply(SIG_SYNC, seq, { state: "running", runId: "r9", step: 1, total: 3 });
  const busy = model(1, 3);
  assert.equal(busy.text, keycap + " Output");
  assert.equal(busy.running, true);
  assert.match(busy.ariaLabel, /opens the output of Sync calendar and inboxes$/);

  const loading = harness();
  loading.engine.loading = true;
  assert.equal(helpers.commandChipHintModel(loading.plugin, cmAt(GTD, 1, 3)).visible, false, "never advertise a loading guess");

  const unbound = harness({ hotkeys: [] });
  assert.equal(helpers.commandChipHintModel(unbound.plugin, cmAt(GTD, 1, 3)).visible, false);
  const noFlag = harness({ flag: 0 });
  assert.equal(helpers.commandChipHintModel(noFlag.plugin, cmAt(GTD, 1, 3)).visible, false);
  const refNote = harness();
  assert.equal(helpers.commandChipHintModel(refNote.plugin, cmAt(GTD, 1, 3, { path: "ref/paper.md" })).visible, false);
});

test("the keycap element is display-only DOM text", () => {
  const doc = new FakeDocument();
  const el = helpers.buildCommandChipHintElement(doc, { text: "⌘↵ Run", ariaLabel: "Cmd+Enter runs bob plan", running: false });
  assert.equal(el.getAttribute("class"), helpers.COMMAND_CHIP_HINT_CLASS);
  assert.equal(el.getAttribute("role"), "img");
  assert.equal(el.getAttribute("aria-label"), "Cmd+Enter runs bob plan");
  assert.equal(el.textContent, "⌘↵ Run");
  const busy = helpers.buildCommandChipHintElement(doc, { text: "⌘↵ Output", ariaLabel: "x", running: true });
  assert.equal(busy.getAttribute("class"), "bob-run-chip-hint is-running");
  assert.equal(helpers.buildCommandChipHintElement(doc, { text: "" }), null);
});

test("the painter debounces, arms the store, paints the keycap, and disarms", async () => {
  const h = harness();
  const ext = helpers.commandChipCreateHintExtension(h.plugin);
  assert.ok(ext && ext.cls);
  const view = cmAt(GTD, 1, 3);
  const painter = new ext.cls(view);
  assert.equal(painter.decorations._decorationNone, true, "nothing paints before the debounce");
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(view.dispatched.length, 1);
  assert.equal(h.store.armedTarget().line, 1);
  const armedChip = helpers.commandChipTargetAt(h.plugin, editorAt(GTD, 1, 3)).chip;
  assert.equal(h.store.isArmed({ ...armedChip, sourcePath: "gtd_daily.md" }), true);
  assert.equal(h.store.isArmed({ ...armedChip, sourcePath: "notes/walk.md" }), false, "the same chip in another note is not armed");
  const effect = view.dispatched[0].effects;
  painter.update({ transactions: [{ effects: [effect] }], view, state: view.state, startState: view.state });
  assert.equal(painter.decorations.adds.length, 1);
  const widget = painter.decorations.adds[0].value;
  assert.equal(widget.side, 1);
  assert.equal(painter.decorations.adds[0].from, view.state.doc.line(2).to);
  assert.match(widget.widget.model.text, /Run$/);

  // Moving to another line hides at once, then re-resolves.
  const moved = cmAt(GTD, 7, 0);
  painter.update({ transactions: [], selectionSet: true, view: moved, startState: view.state, state: moved.state });
  assert.equal(painter.decorations._decorationNone, true);
  painter.view = moved;
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(h.store.armedTarget(), null, "an ambiguous line disarms");

  painter.view = view;
  painter.recompute();
  assert.ok(h.store.armedTarget());
  painter.destroy();
  assert.equal(h.store.armedTarget(), null, "destroying the arming editor disarms");
});

test("chip tooltips learn the live binding and repaint", () => {
  const h = harness();
  let repaints = 0;
  helpers.commandChipOnCatalogChanged(h.plugin, () => {
    repaints += 1;
  });
  const keycap = helpers.commandChipSyncRunHotkey(h.plugin);
  assert.ok(keycap.endsWith("↵"));
  assert.equal(h.plugin.commandChipRunHotkey, keycap);
  assert.equal(repaints, 1);
  helpers.commandChipSyncRunHotkey(h.plugin);
  assert.equal(repaints, 1, "an unchanged binding repaints nothing");
  h.app.plugins.plugins["bob-navigation-hotkeys"].commandChipDispatch = 0;
  assert.equal(helpers.commandChipSyncRunHotkey(h.plugin), null);
  assert.equal(repaints, 2);
});

test("the plugin publishes the keymap members and the palette command", async () => {
  const app = makeApp({ engine: fakeEngine() });
  const plugin = new BobCopyChipsPlugin(app);
  await plugin.onload();
  const api = plugin.api.commandChips;
  assert.equal(api.version, 1);
  assert.ok(Object.isFrozen(api));
  for (const name of ["parse", "scanLine", "parseFenceInfo", "fencePayload", "serialize", "chipAt", "targetAt", "runAtCursor"]) {
    assert.equal(typeof api[name], "function", name);
  }
  assert.equal(plugin.api.copyChips.version, 2);
  assert.equal(api.targetAt(editorAt("`run: bob plan`", 0, 0)).state, "ready");
  assert.equal(api.targetAt(undefined).state, "none");
  assert.equal((await api.runAtCursor(undefined)).handled, false);

  const command = plugin.commands.find((entry) => entry.id === "run-at-cursor");
  assert.ok(command);
  assert.equal(command.name, "Run command chip at cursor");
  assert.equal(command.hotkeys, undefined, "no default hotkey");
  FakeNotice.messages.length = 0;
  command.editorCallback(editorAt("plain prose", 0, 0).editor, { file: { path: "gtd_daily.md" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(FakeNotice.messages, ["No command chip at the cursor"]);
  FakeNotice.messages.length = 0;
  command.editorCallback(editorAt("`run: bob plan`", 0, 0).editor, { file: { path: "ref/paper.md" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(FakeNotice.messages, ["Command chips don't run here: notes under ref/ never run commands"]);
  assert.equal(plugin.commandChipRunHotkey, undefined, "nothing advertises a binding before a painter or layout change");
  const hint = plugin.extensions.find((extension) => extension && extension._viewPlugin && typeof extension.cls.prototype.recompute === "function");
  const painter = new hint.cls(cmAt("`run: bob plan`", 0, 0));
  painter.recompute();
  assert.equal(plugin.commandChipRunHotkey.endsWith("↵"), true, "the first recompute syncs the tooltip binding");
  painter.destroy();
  for (const fn of plugin.registers) fn();
});

test("⌘↵ pulses the fired chip or bob-run card, else flashes the revealed span", () => {
  const h = harness();
  const doc = new FakeDocument();
  const target = helpers.commandChipTargetAt(h.plugin, editorAt(GTD, 1, 3));
  const pill = doc.createElement("span");
  pill.setAttribute("class", "bob-run-chip");
  doc.body.appendChild(pill);
  helpers.commandChipMount(h.plugin, pill, target.chip, { context: () => ({ sourcePath: "gtd_daily.md", origin: "live" }), gestures: false });
  const dom = { querySelectorAll: () => [pill] };
  assert.equal(helpers.commandChipKeymapPulse(h.plugin, { dom }, target), true);
  assert.match(pill.getAttribute("class"), /is-fired/);

  const fence = helpers.commandChipTargetAt(h.plugin, editorAt(GTD, 11, 0));
  const card = doc.createElement("div");
  card.setAttribute("class", "bob-run-fence");
  doc.body.appendChild(card);
  helpers.commandChipMount(h.plugin, card, { ...fence.chip, line: 9 }, { context: () => ({ sourcePath: "gtd_daily.md", origin: "live" }), gestures: false });
  const selectors = [];
  const cardDom = { querySelectorAll: (selector) => { selectors.push(selector); return [pill, card]; } };
  assert.equal(helpers.commandChipKeymapPulse(h.plugin, { dom: cardDom }, fence), true, "a card matches on its fence's opening line");
  assert.match(card.getAttribute("class"), /is-fired/);
  assert.match(selectors[0], /\.bob-run-fence/);
  assert.equal(helpers.commandChipKeymapPulse(h.plugin, null, target), false);
  helpers.commandChipUnmount(pill);
  helpers.commandChipUnmount(card);
});
