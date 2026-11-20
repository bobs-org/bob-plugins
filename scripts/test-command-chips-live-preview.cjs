// Live Preview command chips: the shared `.bob-run-chip` face, the one
// decoration pass that emits both kinds, in-place painting from the shared
// store, gestures, stale source, and rebuild continuity. A scriptable fake
// Command Mode and clock drive every state; nothing spawns.
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
  installClipboardStub,
} = require("./copy-chips-test-helpers.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    timers: {
      set(fn, ms) {
        const id = nextId++;
        timers.set(id, { fn, at: now + Number(ms || 0) });
        return id;
      },
      clear(id) {
        timers.delete(id);
      },
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!due || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        }
        if (!due) break;
        timers.delete(dueId);
        now = due.at;
        due.fn();
      }
      now = target;
    },
  };
}

function step(index, text, extra = {}) {
  return Object.freeze({
    index, text, argv: Object.freeze(text.split(/\s+/).slice(1)), entryId: "e" + index, title: text,
    effect: "writes", policy: "run", presentation: "action", hasPreview: false, confirm: null, ...extra,
  });
}

function ready(signature, steps) {
  return Object.freeze({ ok: true, state: "ready", signature, steps: Object.freeze(steps), reason: null, step: null });
}

function refused(state, reason, stepNo) {
  return Object.freeze({ ok: false, state, signature: null, steps: Object.freeze([]), reason, step: stepNo || null });
}

const SYNC = "bob gcal sync -n 2 && bob gkeep pull && bob gmail sync";
const VERDICTS = {
  "bob plan": ready("plan", [step(1, "bob plan", { presentation: "report", effect: "reads" })]),
  "bob task reconcile": ready("reconcile", [step(1, "bob task reconcile")]),
  "bob task archive": ready("archive", [step(1, "bob task archive", { policy: "confirm", confirm: "Archive closed tasks?" })]),
  "bob gcal sync -n 2": ready("gcal", [step(1, "bob gcal sync -n 2", { policy: "preview-first", hasPreview: true })]),
  [SYNC]: ready("sync", [step(1, "bob gcal sync -n 2"), step(2, "bob gkeep pull"), step(3, "bob gmail sync")]),
  'bob note "a && b" && bob plan': ready("quoted", [step(1, 'bob note "a && b"'), step(2, "bob plan")]),
  "bob nope": refused("invalid", "bob has no command `nope`", 1),
  "bob plan && bob nope": refused("invalid", "bob has no command `nope`", 2),
};

function fakeEngine() {
  const engine = {
    version: 1,
    loading: false,
    token: "1:fp",
    resolveCalls: 0,
    runs: [],
    opens: [],
    outputs: [],
    resolve(text) {
      engine.resolveCalls += 1;
      if (engine.loading) return refused("loading", "Command Mode is still loading bob's catalog");
      return VERDICTS[text] || refused("invalid", "command chips run only bob", 1);
    },
    runText(text, opts) {
      const call = { text, opts, ...deferred() };
      engine.runs.push(call);
      return call.promise;
    },
    openText(text, opts) {
      const call = { text, opts, ...deferred() };
      engine.opens.push(call);
      return call.promise;
    },
    openOutput(runId) {
      engine.outputs.push(runId);
      return Promise.resolve({ ok: true });
    },
    catalogInfo() {
      return Object.freeze({ token: engine.token });
    },
  };
  return engine;
}

function emit(call, payload) {
  call.opts.onState(Object.freeze({ kind: "run", step: 1, total: 1, ...payload }));
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

function harness(options = {}) {
  FakeNotice.messages.length = 0;
  const clock = fakeClock();
  const engine = fakeEngine();
  const files = new Set(["notes/walk.md", "ref/paper.md", "notes/other.md"]);
  const app = {
    isMobile: false,
    workspace: makeWorkspace(),
    vault: { getAbstractFileByPath: (p) => (files.has(p) ? { path: p } : null) },
    plugins: {
      plugins: { "bob-command-mode": { api: { commandMode: engine } } },
      enabledPlugins: new Set(["bob-command-mode", "bob-chips"]),
    },
  };
  const plugin = { app, registerEvent() {}, ...options.plugin };
  helpers.commandChipRuntimeSetup(plugin, { store: { timers: clock.timers, now: clock.now } });
  return { plugin, app, engine, clock, store: plugin.commandChipRuntime.store };
}

function makeView(lines, options = {}) {
  const doc = options.document || new FakeDocument();
  const view = { dispatched: [], dom: { ownerDocument: doc }, state: null, visibleRanges: null };
  view.dispatch = (spec) => view.dispatched.push(spec);
  view.setText = (next) => {
    const text = next;
    const all = text.split("\n");
    const starts = [];
    let offset = 0;
    for (const line of all) {
      starts.push(offset);
      offset += line.length + 1;
    }
    view.state = {
      doc: {
        length: text.length,
        toString: () => text,
        sliceString: (from, to) => text.slice(from, to),
        lineAt(pos) {
          let index = 0;
          for (let i = 0; i < starts.length; i += 1) {
            if (starts[i] <= pos) index = i;
            else break;
          }
          return { text: all[index], from: starts[index], to: starts[index] + all[index].length, number: index + 1 };
        },
      },
      sliceDoc: (from, to) => text.slice(from, to),
      selection: { ranges: options.selections || [] },
      field(field) {
        if (field === editorLivePreviewField) return true;
        if (field === editorInfoField) return options.path === null ? undefined : { file: { path: options.path || "notes/walk.md" } };
        throw new Error("unknown field");
      },
    };
    view.visibleRanges = options.visible || [{ from: 0, to: text.length }];
  };
  view.setText(lines.join("\n"));
  return view;
}

function build(view, plugin) {
  const set = helpers.copyChipBuildLiveDecorations(view, plugin);
  return (set.adds || []).map((add) => ({ from: add.from, to: add.to, widget: add.value.widget }));
}

// Mount the only (or `index`th) run widget of a view: what CM does on paint.
function mountRun(view, plugin, index = 0) {
  const runs = build(view, plugin).filter((d) => d.widget.constructor === helpers.commandChipEnsureLiveWidget());
  const widget = runs[index].widget;
  return { widget, host: widget.toDOM(view) };
}

function cls(el) {
  return el.getAttribute("class") || "";
}

function has(el, name) {
  return (" " + cls(el) + " ").includes(" " + name + " ");
}

function glyphOf(host) {
  return host.querySelector(".bob-run-chip-glyph");
}

function iconOf(host) {
  return glyphOf(host).getAttribute("data-copy-chip-icon");
}

function tipRows(host) {
  return host.querySelector(".bob-run-chip-tip").children.map((row) => [cls(row).replace("bob-run-chip-tip-row is-", ""), row.textContent]);
}

function faceText(host) {
  return host.querySelector(".bob-run-chip-face").textContent;
}

function pointer(type, extra = {}) {
  const event = { type, button: 0, clientX: 10, clientY: 10, detail: 1, prevented: false, ...extra };
  event.preventDefault = () => { event.prevented = true; };
  return event;
}

function click(host, extra = {}, end = {}) {
  const down = pointer("mousedown", extra);
  host.dispatch("mousedown", down);
  host.dispatch("mouseup", pointer("mouseup", { ...extra, ...end }));
  host.dispatch("click", pointer("click", { ...extra, ...end }));
  return down;
}

function key(host, keyName, extra = {}) {
  const event = { key: keyName, prevented: false, ...extra };
  event.preventDefault = () => { event.prevented = true; };
  host.dispatch("keydown", event);
  return event;
}

test("one decoration pass emits copy and run widgets on one line", () => {
  const h = harness();
  const line = "- [ ] `copy: ssh apollo` then `run: bob plan` and `bob plan`";
  const view = makeView(["# Walk", line]);
  const decorations = build(view, h.plugin);
  assert.equal(decorations.length, 2, "plain `bob` spans stay inert");
  const RunWidget = helpers.commandChipEnsureLiveWidget();
  const [copy, run] = decorations;
  assert.notEqual(copy.widget.constructor, RunWidget);
  assert.equal(run.widget.constructor, RunWidget);
  const lineFrom = "# Walk\n".length;
  assert.equal(run.widget.raw, "`run: bob plan`");
  assert.equal(view.state.sliceDoc(run.from, run.to), run.widget.raw);
  assert.deepEqual([run.widget.line, run.widget.lineFrom, run.widget.text], [1, lineFrom, "bob plan"]);
  assert.equal(h.engine.resolveCalls, 0, "building decorations never resolves");

  const kinds = helpers.chipLiveChipsForLine(line, 0, null).map((chip) => chip.kind);
  assert.deepEqual(kinds, ["copy", "run"]);
  assert.deepEqual(helpers.copyChipLiveChipsForLine(line, 0, 0, null).map((chip) => Object.keys(chip).sort()), [
    ["from", "label", "lineFrom", "lineText", "text", "to"],
  ], "the copy-only helper keeps its shape");
  for (const inert of ["$`run: bob plan`$", "%% `run: bob plan` %%", "<!-- `run: bob plan` -->", "[`run: bob plan`](x)"]) {
    assert.deepEqual(helpers.chipLiveChipsForLine(inert, 0, null), [], inert);
  }
});

test("fenced, frontmatter, revealed, and indented run spans never decorate", () => {
  const h = harness();
  const view = makeView(["---", "a: `run: bob plan`", "---", "```", "`run: bob plan`", "```", "    `run: bob plan`", "`run: bob plan`"], {
    selections: [],
  });
  assert.equal(build(view, h.plugin).length, 1);
  const last = view.state.doc.length;
  const revealed = makeView(["`run: bob plan`"], { selections: [{ from: 3, to: 3 }] });
  assert.equal(build(revealed, h.plugin).length, 0, "a cursor on the span reveals source");
  assert.ok(last > 0);
});

test("faces: labels count steps, literals use resolved steps and faint separators", () => {
  const h = harness();
  const labeled = mountRun(makeView(["`run[Sync calendar and inboxes]: " + SYNC + "`"]), h.plugin).host;
  assert.ok(has(labeled, "is-labeled"));
  assert.equal(faceText(labeled), "Sync calendar and inboxes · 3");
  assert.ok(labeled.querySelector(".bob-run-chip-count"));

  const literal = mountRun(makeView(["`run: " + SYNC + "`"]), h.plugin).host;
  assert.ok(has(literal, "is-literal"));
  assert.equal(faceText(literal), "bob gcal sync -n 2 › gkeep pull › gmail sync");
  assert.equal(literal.querySelectorAll(".bob-run-chip-sep").length, 2);

  const quoted = mountRun(makeView(['`run: bob note "a && b" && bob plan`']), h.plugin).host;
  assert.equal(faceText(quoted), 'bob note "a && b" › plan', "quoted && is text");

  const single = mountRun(makeView(["`run[Plan]: bob plan`"]), h.plugin).host;
  assert.equal(faceText(single), "Plan", "one step shows no count");

  h.engine.loading = true;
  h.engine.token = "loading";
  const loading = mountRun(makeView(["`run: " + SYNC + "`"]), h.plugin).host;
  assert.equal(faceText(loading), SYNC, "loading shows the verbatim payload");
  assert.ok(has(loading, "is-loading"));
  assert.equal(iconOf(loading), "play");
});

test("every state paints in place from the store, without recreating the glyph", () => {
  const h = harness();
  const view = makeView(["`run: " + SYNC + "`"]);
  const { host } = mountRun(view, h.plugin);
  const glyph = glyphOf(host);
  let iconWrites = 0;
  const setAttribute = glyph.setAttribute.bind(glyph);
  glyph.setAttribute = (name, value) => {
    if (name === "data-copy-chip-icon") iconWrites += 1;
    setAttribute(name, value);
  };
  assert.ok(has(host, "is-ready"));
  assert.equal(iconOf(host), "play");
  assert.equal(host.querySelector(".bob-run-chip-action").textContent, "Run");

  helpers.commandChipStoreOf(h.plugin).setArmed({ key: "sync", sourcePath: "notes/walk.md", form: "inline", line: 0, from: 0, to: view.state.doc.length });
  assert.ok(has(host, "is-armed"));
  assert.equal(iconOf(host), "play");
  h.store.setArmed(null);
  assert.ok(has(host, "is-ready"));

  const seq = h.store.begin("sync", { total: 3 });
  assert.ok(has(host, "is-ready"), "pending paints as resting");
  h.store.apply("sync", seq, { state: "queued", runId: "a", step: 1, total: 3, kind: "sequence" });
  assert.ok(has(host, "is-queued"));
  assert.equal(iconOf(host), "hourglass");
  assert.equal(host.getAttribute("aria-busy"), "true");
  h.store.apply("sync", seq, { state: "running", runId: "a", step: 1 });
  assert.ok(has(host, "is-running") && has(host, "has-progress"));
  assert.equal(iconOf(host), "loader-circle");
  const writesWhileRunning = iconWrites;
  const steps = host.querySelectorAll(".bob-run-chip-step");
  assert.ok(has(steps[0], "is-current"));
  assert.match(host.style["--bob-run-progress"], /var\(--interactive-accent\) 0\.00%/);
  h.store.apply("sync", seq, { state: "step", runId: "a", step: 1, outcome: "completed" });
  h.store.apply("sync", seq, { state: "running", runId: "b", step: 2 });
  assert.ok(has(steps[0], "is-done") && has(steps[1], "is-current") && !has(steps[0], "is-current"));
  assert.match(host.style["--bob-run-progress"], /^linear-gradient\(to right, var\(--color-green\)/);
  assert.deepEqual(tipRows(host)[0], ["state", "Running step 2 of 3"]);
  assert.equal(iconWrites, writesWhileRunning, "steps never repaint the spinner");
  assert.equal(glyphOf(host), glyph, "the glyph element is never recreated");

  h.store.apply("sync", seq, { state: "finished", outcome: "completed", runId: "c", step: 3 });
  assert.ok(has(host, "is-completed") && !has(host, "has-progress"));
  assert.equal(iconOf(host), "check");
  assert.equal(host.getAttribute("aria-busy"), null);
  h.clock.advance(1600);
  assert.ok(has(host, "is-ready"));

  const second = h.store.begin("sync", { total: 3 });
  h.store.apply("sync", second, { state: "finished", outcome: "attention", reason: "warning: 2 skipped\nmore" });
  assert.ok(has(host, "is-attention"));
  assert.equal(iconOf(host), "play");
  assert.deepEqual(tipRows(host)[0], ["state", "Needs attention: warning: 2 skipped"]);
  const third = h.store.begin("sync", { total: 3 });
  h.store.apply("sync", third, { state: "finished", outcome: "failed", reason: "\nerror: no network\ntrace" });
  h.clock.advance(60000);
  assert.ok(has(host, "is-failed"));
  assert.deepEqual(tipRows(host)[0], ["state", "Failed: error: no network"], "failed tooltip carries the first error line");
  assert.equal(glyphOf(host), glyph);
});

test("unavailable, copy-only, and loading faces explain themselves", () => {
  const h = harness();
  const bad = mountRun(makeView(["`run: bob plan && bob nope`"]), h.plugin).host;
  assert.ok(has(bad, "is-unavailable"));
  assert.equal(iconOf(bad), "ban");
  assert.deepEqual(tipRows(bad)[0], ["state", "Can't run: bob has no command `nope` (step 2)"]);
  assert.deepEqual(tipRows(bad).at(-1), ["hint", "Click to see why"]);

  const copy = mountRun(makeView(["`run: bob plan`"], { path: "ref/paper.md" }), h.plugin).host;
  assert.ok(has(copy, "is-copy"));
  assert.equal(iconOf(copy), "copy");
  assert.equal(copy.querySelector(".bob-run-chip-action").textContent, "Copy");
  assert.deepEqual(tipRows(copy), [
    ["state", "Copy only: notes under ref/ never run commands"],
    ["command", "bob plan"],
    ["hint", "Click to copy"],
  ]);
  const unknown = mountRun(makeView(["`run: bob plan`"], { path: null }), h.plugin).host;
  assert.deepEqual(tipRows(unknown)[0], ["state", "Copy only: source note unknown"]);

  h.engine.loading = true;
  h.engine.token = "loading";
  const view = makeView(["`run: bob plan`"]);
  const loading = mountRun(view, h.plugin).host;
  assert.ok(has(loading, "is-loading"));
  assert.deepEqual(tipRows(loading)[0], ["state", "Loading bob's command catalog"]);
  h.engine.loading = false;
  h.engine.token = "2:fp";
  h.app.workspace.trigger(helpers.COMMAND_CHIP_CATALOG_EVENT, { token: "2:fp" });
  assert.ok(has(loading, "is-ready"), "a catalog change repaints in place");
  assert.deepEqual(tipRows(loading), [["command", "bob plan"], ["policy", "Opens its output"], ["hint", "Click to run · ⇧Click opens Command Mode"]]);
});

test("tooltips name the policy honestly and advertise a key only once one exists", () => {
  const h = harness();
  const policy = (text) => helpers.commandChipPolicyText(VERDICTS[text]);
  assert.equal(policy("bob task reconcile"), "Runs now");
  assert.equal(policy("bob gcal sync -n 2"), "Runs now · skips its preview");
  assert.equal(policy("bob task archive"), "Asks first: Archive closed tasks?");
  assert.equal(policy("bob plan"), "Opens its output");
  assert.equal(policy(SYNC), "Runs 3 steps now");
  assert.equal(helpers.commandChipPolicyText(null), null);
  assert.equal(helpers.commandChipHintText(h.plugin, "ready"), "Click to run · ⇧Click opens Command Mode");
  assert.equal(helpers.commandChipHintText({ commandChipRunHotkey: "⌘↵" }, "armed"), "Click or ⌘↵ to run · ⇧Click opens Command Mode");
  assert.equal(helpers.commandChipHintText(h.plugin, "running"), "Click opens its output");
  assert.equal(helpers.commandChipHintText(h.plugin, "failed"), "Click to run again · ⇧Click opens Command Mode");
  const host = mountRun(makeView(["`run[Sync]: " + SYNC + "`"]), h.plugin).host;
  assert.deepEqual(tipRows(host), [
    ["command", "bob gcal sync -n 2"],
    ["command", "bob gkeep pull"],
    ["command", "bob gmail sync"],
    ["policy", "Runs 3 steps now"],
    ["hint", "Click to run · ⇧Click opens Command Mode"],
  ]);
});

test("payloads stay out of attributes and markup; names come from visible text", () => {
  const h = harness();
  const payload = 'bob note "<img src=x onerror=alert(1)> key:: v"';
  const doc = new FakeDocument();
  const host = helpers.commandChipBuildInline(doc, { label: null, text: payload }, { interactive: false });
  helpers.commandChipMount(h.plugin, host, { form: "inline", label: null, text: payload, line: 0, from: 0, to: 9 }, {
    context: () => ({ sourcePath: "notes/walk.md" }),
    gestures: false,
  });
  assert.equal(helpers.commandChipPayloadOf(host), payload);
  const visit = (el) => {
    for (const [name, value] of el.attrs) assert.ok(!value.includes("onerror") && !value.includes("::"), name + "=" + value);
    el.children.forEach(visit);
  };
  visit(host);
  assert.ok(host.textContent.includes(payload), "the payload is DOM text");
  assert.equal(host.getAttribute("role"), "button");
  assert.equal(host.getAttribute("tabindex"), "0");
  const [actionId, faceId] = host.getAttribute("aria-labelledby").split(" ");
  assert.equal(host.querySelector(".bob-run-chip-action").getAttribute("id"), actionId);
  assert.equal(host.querySelector(".bob-run-chip-face").getAttribute("id"), faceId);
  assert.equal(host.querySelector(".bob-run-chip-tip").getAttribute("id"), host.getAttribute("aria-describedby"));
  assert.equal(glyphOf(host).getAttribute("aria-hidden"), "true");

  const button = helpers.commandChipBuildInline(doc, { label: "Go", text: "bob plan" }, { interactive: true });
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("role"), null);
  assert.equal(helpers.commandChipBuildInline(doc, { text: "  " }), null);
  assert.equal(helpers.commandChipBuildInline(null, { text: "bob plan" }), null);
});

test("gestures: click runs, Shift opens, and drags, secondary buttons, and Alt stay inert", async (t) => {
  const h = harness();
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  const view = makeView(["intro", "- `run: bob task reconcile`"]);
  const { host } = mountRun(view, h.plugin);
  const down = click(host);
  assert.equal(down.prevented, true, "mousedown never moves the caret");
  await tick();
  assert.equal(h.engine.runs.length, 1);
  assert.deepEqual(h.engine.runs[0].opts.source, { path: "notes/walk.md", line: 1 });
  assert.deepEqual(Object.keys(h.engine.runs[0].opts).sort(), ["onState", "source"]);
  click(host);
  await tick();
  assert.equal(h.engine.runs.length, 1, "a double click inside the latch makes one run");
  h.engine.runs[0].resolve({ ok: true, stage: "run", outcome: "completed" });
  await tick();
  h.clock.advance(2000);

  click(host, {}, { clientX: 14 });
  host.dispatch("mousedown", pointer("mousedown", { button: 2 }));
  host.dispatch("mouseup", pointer("mouseup", { button: 2 }));
  host.dispatch("mousedown", pointer("mousedown"));
  host.dispatch("mouseleave", {});
  host.dispatch("mouseup", pointer("mouseup"));
  click(host, { altKey: true });
  host.dispatch("touchstart", { touches: [{ clientX: 1, clientY: 1 }] });
  host.dispatch("touchcancel", {});
  host.dispatch("touchend", { changedTouches: [{ clientX: 1, clientY: 1 }], preventDefault() {} });
  await tick();
  assert.equal(h.engine.runs.length + h.engine.opens.length, 1, "drag, right click, leave, Alt, and cancelled touch are inert");
  assert.deepEqual(clip.writes, [], "Alt never copies a run chip");

  click(host, { shiftKey: true });
  await tick();
  assert.equal(h.engine.opens.length, 1, "Shift+Click opens the guarded path");
  h.engine.opens[0].resolve({ ok: true, stage: "review" });
  await tick();
  assert.ok(has(host, "is-ready"), "a card handoff never leaves a spinner");
});

test("gestures: Enter, Space, Shift+Enter, taps, and one activation per native click", async () => {
  const h = harness();
  const { host } = mountRun(makeView(["`run: bob task reconcile`"]), h.plugin);
  const settle = async () => {
    await tick();
    for (const call of [...h.engine.runs, ...h.engine.opens]) call.resolve({ ok: true, stage: "run", outcome: "completed" });
    await tick();
    h.clock.advance(2000);
  };
  const enter = key(host, "Enter");
  assert.equal(enter.prevented, true);
  host.dispatch("click", pointer("click", { detail: 0 }));
  await settle();
  assert.equal(h.engine.runs.length, 1, "the button's native click after a key never runs twice");
  key(host, " ");
  key(host, " ", { repeat: true });
  await settle();
  assert.equal(h.engine.runs.length, 2, "key repeat is ignored");
  key(host, "Enter", { shiftKey: true });
  await settle();
  assert.equal(h.engine.opens.length, 1);
  key(host, "Enter", { ctrlKey: true });
  key(host, "Enter", { metaKey: true });
  await settle();
  assert.equal(h.engine.runs.length + h.engine.opens.length, 3, "chords belong to the editor");
  host.dispatch("touchstart", { touches: [{ clientX: 5, clientY: 5 }] });
  host.dispatch("touchend", { changedTouches: [{ clientX: 6, clientY: 6 }], preventDefault() {} });
  await settle();
  assert.equal(h.engine.runs.length, 3, "a tap runs");
  const fresh = mountRun(makeView(["`run: bob task reconcile`"]), h.plugin).host;
  fresh.dispatch("click", pointer("click", { detail: 0 }));
  await settle();
  assert.equal(h.engine.runs.length, 4, "a bare synthetic click (assistive technology) runs once");
});

test("copy-only chips copy the exact payload with copy feedback; unavailable ones explain", async () => {
  const h = harness();
  const clip = installClipboardStub();
  try {
    const view = makeView(["`run[Plan]: bob plan`"], { path: "ref/paper.md" });
    const { host } = mountRun(view, h.plugin);
    click(host);
    await tick();
    await tick();
    assert.deepEqual(clip.writes, ["bob plan"]);
    assert.equal(h.engine.runs.length + h.engine.opens.length, 0);
    assert.ok(has(host, "is-copied") && has(host, "is-copy"));
    assert.equal(iconOf(host), "check");
    view.dom.ownerDocument.runTimers();
    assert.equal(iconOf(host), "copy");
  } finally {
    clip.restore();
  }
  const { host } = mountRun(makeView(["`run: bob nope`"]), h.plugin);
  click(host);
  await tick();
  await tick();
  assert.equal(h.engine.runs.length, 0);
  assert.deepEqual(FakeNotice.messages, ["Can't run: bob has no command `nope`"]);
});

test("a stale span refreshes and never runs", async () => {
  const h = harness();
  const view = makeView(["- `run: bob task reconcile`"]);
  const { host } = mountRun(view, h.plugin);
  view.setText("- `run: bob task archive!!`");
  click(host);
  await tick();
  await tick();
  assert.equal(h.engine.runs.length, 0);
  assert.equal(view.dispatched.length, 1, "the decoration pass is asked to rebuild");
});

test("rebuilt and reused widgets keep live feedback; unmounting never touches the run", async () => {
  const h = harness();
  const view = makeView(["- `run: " + SYNC + "`"]);
  const first = mountRun(view, h.plugin);
  click(first.host);
  await tick();
  const call = h.engine.runs[0];
  emit(call, { state: "running", runId: "a", kind: "sequence", step: 1, total: 3 });
  assert.ok(has(first.host, "is-running"));

  // A note rewrite: CM destroys the old widget and paints a new one.
  first.widget.destroy(first.host);
  view.setText("rewritten\n- `run: " + SYNC + "`");
  const second = mountRun(view, h.plugin);
  assert.ok(has(second.host, "is-running"), "a rebuilt mount shows the live run immediately");
  emit(call, { state: "step", runId: "a", kind: "sequence", step: 1, total: 3, outcome: "completed" });
  emit(call, { state: "running", runId: "b", kind: "sequence", step: 2, total: 3 });
  assert.ok(has(second.host, "is-running") && !has(first.host, "is-done"));
  assert.ok(has(second.host.querySelectorAll(".bob-run-chip-step")[1], "is-current"));
  assert.ok(has(first.host, "is-running"), "a destroyed face is left alone");
  click(second.host);
  await tick();
  assert.deepEqual(h.engine.outputs, ["b"], "clicking a live run opens its output");
  assert.equal(h.engine.runs.length, 1);

  // An edit that only moves the span keeps the DOM.
  view.setText("rewritten\nmore\n- `run: " + SYNC + "`");
  const moved = build(view, h.plugin)[0].widget;
  assert.equal(moved.eq(second.widget), false);
  assert.equal(moved.updateDOM(second.host, view), true);
  const mount = helpers.commandChipMountOf(second.host);
  assert.deepEqual([mount.chip.line, mount.chip.from], [2, 2]);
  emit(call, { state: "finished", runId: "c", kind: "sequence", outcome: "completed", step: 3, total: 3 });
  call.resolve({ ok: true, stage: "sequence", outcome: "completed", runId: "c" });
  await tick();
  assert.ok(has(second.host, "is-completed"));
  const other = makeView(["`run[Other]: " + SYNC + "`"]);
  assert.equal(build(other, h.plugin)[0].widget.updateDOM(second.host, other), false, "a different chip repaints fresh");
});

test("equal commands share run ink but arm per note and span; destroy unsubscribes", async () => {
  const h = harness();
  const view = makeView(["`run: bob task reconcile`", "`run: bob task reconcile`"]);
  const a = mountRun(view, h.plugin, 0);
  const b = mountRun(view, h.plugin, 1);
  const elsewhere = mountRun(makeView(["`run: bob task reconcile`"], { path: "notes/other.md" }), h.plugin);
  h.store.setArmed({ key: "reconcile", sourcePath: "notes/walk.md", form: "inline", line: 1, from: 0, to: 25 });
  assert.deepEqual([has(a.host, "is-armed"), has(b.host, "is-armed"), has(elsewhere.host, "is-armed")], [false, true, false]);
  h.store.setArmed(null);
  const seq = h.store.begin("reconcile", {});
  h.store.apply("reconcile", seq, { state: "running", runId: "r" });
  assert.ok([a, b, elsewhere].every((m) => has(m.host, "is-running")));
  for (const m of [a, b, elsewhere]) m.widget.destroy(m.host);
  assert.equal(h.store.listeners.size, 0);
  assert.equal(h.plugin.commandChipRuntime.catalogListeners.size, 0);
  assert.equal(h.store.snapshot("reconcile").state, "running");
});

test("announcements fire once per run transition however many faces show it", () => {
  const h = harness();
  const doc = new FakeDocument();
  const chip = { label: "Plan", text: "bob plan" };
  const paint = (face, seq) => ({ face, key: "plan", verdict: VERDICTS["bob plan"], snapshot: { seq } });
  assert.equal(helpers.commandChipAnnounceTransition(h.plugin, paint("running", 1), chip, doc), true);
  assert.equal(doc.body.querySelector(".bob-copy-chip-live").textContent, "Running Plan");
  assert.equal(helpers.commandChipAnnounceTransition(h.plugin, paint("running", 1), chip, doc), false);
  assert.equal(helpers.commandChipAnnounceTransition(h.plugin, paint("completed", 1), chip, doc), true);
  assert.equal(doc.body.querySelector(".bob-copy-chip-live").textContent, "Plan finished");
  assert.equal(helpers.commandChipAnnounceTransition(h.plugin, paint("failed", 2), chip, doc), true);
  assert.equal(doc.body.querySelector(".bob-copy-chip-live").textContent, "Plan failed");
  assert.equal(helpers.commandChipAnnounceTransition(h.plugin, paint("ready", 3), chip, doc), false);
});

test("styles use theme variables, keep geometry, and honor reduced motion and print", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "plugins", "bob-chips", "styles.css"), "utf8");
  const start = css.indexOf(".bob-run-chip {");
  const end = css.indexOf(".bob-copy-fence {");
  const run = css.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(run, /#[0-9a-f]{3,6}\b|rgba?\(/i, "no fixed colors");
  assert.match(run, /padding: 0 0\.45em;[\s\S]*font-size: 0\.92em;[\s\S]*line-height: inherit;/);
  assert.match(run, /color-mix\(in srgb, var\(--interactive-accent\) 7%, var\(--background-secondary\)\)/);
  assert.match(run, /color-mix\(in srgb, var\(--interactive-accent\) 25%, var\(--background-modifier-border\)\)/);
  assert.match(run, /box-decoration-break: clone/);
  assert.match(run, /@media \(prefers-reduced-motion: reduce\) \{\s*\.bob-run-chip\.is-running \.bob-run-chip-glyph svg,/);
  assert.match(run, /@media print \{[\s\S]*\.bob-run-chip-glyph,\s*\.bob-run-chip-tip,\s*\.bob-run-chip-action \{\s*display: none;/);
  for (const face of helpers.COMMAND_CHIP_FACES.filter((f) => f !== "ready")) {
    assert.ok(run.includes(".bob-run-chip.is-" + face), face);
  }
  assert.doesNotMatch(run, /border-width|border: [2-9]px/, "no state changes the border width");
});

test("plugin load wires one live extension that emits both kinds", async () => {
  const workspace = makeWorkspace();
  const plugin = new BobCopyChipsPlugin({ workspace, plugins: { plugins: {} } });
  await plugin.onload();
  const isHint = (extension) => typeof extension.cls.prototype.recompute === "function";
  const live = plugin.extensions.filter((extension) => extension && extension._viewPlugin && !isHint(extension));
  assert.equal(live.length, 1, "no second scanner or decoration pass");
  const hints = plugin.extensions.filter((extension) => extension && extension._viewPlugin && isHint(extension));
  assert.equal(hints.length, 1, "the ⌘↵ hint paints from its own debounced painter");
  for (const fn of plugin.registers) fn();
});
