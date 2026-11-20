// `bob-run` sequence cards: the pure card model and step marks, fence
// collection and placement, store step timing, and the mounted card driven
// through the real `bob-run` processor with a scriptable fake Command Mode,
// vault, and clock. Nothing spawns.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  helpers,
  FakeDocument,
  FakeNotice,
  installClipboardStub,
} = require("./copy-chips-test-helpers.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await tick();
};

globalThis.requestAnimationFrame = () => {};

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

const SYNC = "bob gcal sync -n 2\nbob gkeep pull\nbob gmail sync";
const ARCHIVE = "bob task reconcile\nbob task archive";
const BROKEN = "bob task reconcile\nbob gcal synk";
const ONE = "bob task reconcile";

const VERDICTS = {
  [SYNC]: ready("sync3", [
    step(1, "bob gcal sync -n 2", { effect: "syncs" }),
    step(2, "bob gkeep pull"),
    step(3, "bob gmail sync"),
  ]),
  [ARCHIVE]: ready("archive2", [
    step(1, "bob task reconcile"),
    step(2, "bob task archive", { policy: "confirm", confirm: "Archive done tasks?" }),
  ]),
  [ONE]: ready("one", [step(1, "bob task reconcile", { effect: "reads" })]),
  [BROKEN]: refused("invalid", "bob has no command `gcal synk`", 2),
};

function fakeEngine() {
  const engine = {
    version: 1,
    loading: false,
    token: "1:fp",
    runs: [],
    opens: [],
    outputs: [],
    resolve(text) {
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

function makeVault(seed) {
  const files = new Map();
  const vault = {
    add(path, text) {
      files.set(path, { path, text });
    },
    write(path, text) {
      files.get(path).text = text;
    },
    getAbstractFileByPath(path) {
      return files.get(path) || null;
    },
    cachedRead(file) {
      return Promise.resolve(file.text);
    },
  };
  for (const [path, text] of Object.entries(seed)) vault.add(path, text);
  return vault;
}

function fenceNote(info, body, before = ["# Walk", ""]) {
  return [...before, "```" + info, ...body.split("\n"), "```", ""].join("\n");
}

const WALK = "notes/walk.md";
const SEED = {
  [WALK]: fenceNote("bob-run Morning sync", SYNC),
  "notes/archive.md": fenceNote("bob-run", ARCHIVE),
  "notes/broken.md": fenceNote("bob-run Broken", BROKEN),
  "notes/one.md": fenceNote("bob-run", ONE),
  "ref/paper.md": fenceNote("bob-run Paper", SYNC),
};

function harness(options = {}) {
  FakeNotice.messages.length = 0;
  const clock = fakeClock();
  const engine = fakeEngine();
  const vault = makeVault(SEED);
  const handlers = new Map();
  const app = {
    isMobile: false,
    workspace: {
      on(name, callback) {
        handlers.set(name, callback);
        return { name };
      },
      offref() {},
      getLeavesOfType: () => [],
      trigger(name, payload) {
        if (handlers.has(name)) handlers.get(name)(payload);
      },
    },
    vault,
    metadataCache: { getFirstLinkpathDest: () => null },
    plugins: {
      plugins: options.noEngine ? {} : { "bob-command-mode": { api: { commandMode: engine } } },
      enabledPlugins: new Set(["bob-command-mode", "bob-chips"]),
    },
  };
  const processors = new Map();
  const plugin = {
    app,
    registerEvent() {},
    register() {},
    registerMarkdownCodeBlockProcessor(lang, fn) {
      processors.set(lang, fn);
    },
  };
  helpers.commandChipRuntimeSetup(plugin, { store: { timers: clock.timers, now: clock.now } });
  return { plugin, app, engine, clock, vault, store: plugin.commandChipRuntime.store, processors };
}

// Render the fence of `path` through the registered processor, inside an
// ordinary Reading section (or `chain` ancestors) with section info.
function renderFence(h, path, options = {}) {
  helpers.commandFenceSetup(h.plugin);
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  root.setAttribute("class", "markdown-preview-view markdown-rendered");
  let parent = root;
  for (const [tag, className] of options.chain || []) {
    const el = doc.createElement(tag);
    el.setAttribute("class", className);
    parent.appendChild(el);
    parent = el;
  }
  const el = doc.createElement("div");
  el.setAttribute("class", "block-language-bob-run");
  parent.appendChild(el);
  const text = h.vault.getAbstractFileByPath(path).text;
  const lines = text.split("\n");
  const open = lines.findIndex((line) => line.startsWith("```bob-run"));
  const close = lines.indexOf("```", open + 1);
  const source = lines.slice(open + 1, close).join("\n");
  const children = [];
  const ctx = {
    sourcePath: path,
    getSectionInfo: () => (options.noSection ? null : { text, lineStart: open, lineEnd: close }),
    addChild: (child) => children.push(child),
  };
  h.processors.get("bob-run")(source, el, ctx);
  const card = el.children[0];
  return { el, card, button: helpers.commandFenceButtonOf(card), children, open, doc };
}

function cardFace(card) {
  return (card.getAttribute("class") || "").split(/\s+/).find((name) => helpers.COMMAND_CHIP_FACES.includes(name.replace(/^is-/, ""))) || null;
}

function marks(card) {
  return card.querySelectorAll(".bob-run-fence-step").map((row) => (row.getAttribute("class") || "").split(/\s+/).find((name) => name !== "bob-run-fence-step"));
}

function text(card, selector) {
  const el = card.querySelector(selector);
  return el ? el.textContent : null;
}

function pointer(type, extra = {}) {
  const event = { type, button: 0, clientX: 10, clientY: 10, detail: 1, prevented: false, ...extra };
  event.preventDefault = () => { event.prevented = true; };
  return event;
}

function click(el, extra = {}) {
  el.dispatch("mousedown", pointer("mousedown", extra));
  el.dispatch("mouseup", pointer("mouseup", extra));
  el.dispatch("click", pointer("click", extra));
}

test("display steps split at unquoted && and line breaks, skipping blanks", () => {
  assert.deepEqual(helpers.commandFenceSplitSteps("bob a && bob b \"x && y\"\n\n  bob c  \nbob d '&&' e && bob f \\&& g"), [
    "bob a", "bob b \"x && y\"", "bob c", "bob d '&&' e", "bob f \\&& g",
  ]);
  assert.deepEqual(helpers.commandFenceSplitSteps(""), []);
  assert.equal(helpers.commandFenceEffect([{ effect: "reads" }, { effect: "syncs" }, { effect: "writes" }]), "syncs");
  assert.equal(helpers.commandFenceEffect([]), null);
  assert.equal(helpers.commandFenceClock(4200), "0:04");
  assert.equal(helpers.commandFenceClock(125000), "2:05");
  assert.equal(helpers.commandFenceClock(null), "");
});

test("collection finds bob-run fences only, skipping other fences whole", () => {
  const markdown = [
    "```markdown", "```bob-run Sample", "bob nope", "```",
    "```bob-run Real", "bob a", "", "bob b", "```",
    "> [!note]", "> ```bob-run Quoted", "> bob q", "> ```",
    "- item", "  ```bob-run", "  bob nested", "  ```",
    "~~~bob-run Open", "bob tail",
  ].join("\n");
  assert.deepEqual(helpers.commandFenceCollect(markdown).map((fence) => [fence.label, fence.text, fence.open, fence.close]), [
    ["Real", "bob a\n\nbob b", 4, 8],
    ["Quoted", "bob q", 10, 12],
    [null, "bob nested", 14, 16],
    ["Open", "bob tail", 17, null],
  ]);
});

test("the card model covers every face and its step marks", () => {
  const verdict = VERDICTS[SYNC];
  const model = (face, snapshot, extra = {}) => helpers.commandFenceModel({ label: extra.label === undefined ? null : extra.label, text: SYNC }, { face, verdict: extra.verdict === undefined ? verdict : extra.verdict, snapshot: snapshot || null, reason: extra.reason || null });
  const rest = model("ready");
  assert.deepEqual([rest.title, rest.meta, rest.button, rest.reason], ["Run · 3 steps", "3 steps · syncs", "Run", ""]);
  assert.deepEqual(rest.rows.map((row) => [row.index, row.text, row.mark]), [[1, "bob gcal sync -n 2", "idle"], [2, "bob gkeep pull", "idle"], [3, "bob gmail sync", "idle"]]);
  assert.equal(model("ready", null, { label: "Morning sync" }).title, "Morning sync");
  assert.equal(model("ready", null, { label: "  " }).title, "Run · 3 steps");
  assert.equal(helpers.commandFenceModel({ label: null, text: ARCHIVE }, { face: "ready", verdict: VERDICTS[ARCHIVE] }).meta, "2 steps · writes · asks first");
  assert.equal(helpers.commandFenceModel({ label: null, text: ONE }, { face: "ready", verdict: VERDICTS[ONE] }).title, "Run · 1 step");

  const loading = model("loading", null, { verdict: null });
  assert.deepEqual([loading.meta, loading.button], ["3 steps", "Run"]);
  const copy = model("copy", null, { verdict: null, reason: "notes under ref/ never run commands" });
  assert.deepEqual([copy.button, copy.reason, copy.meta], ["Copy", "Copy only: notes under ref/ never run commands", "3 steps"]);
  const broken = helpers.commandFenceModel({ label: null, text: BROKEN }, { face: "unavailable", verdict: VERDICTS[BROKEN], reason: "bob has no command `gcal synk`" });
  assert.equal(broken.reason, "Can't run: bob has no command `gcal synk` (step 2)");
  assert.deepEqual(broken.rows.map((row) => [row.mark, row.reason]), [["idle", ""], ["failed", "bob has no command `gcal synk`"]]);

  const queued = model("queued", { state: "queued", step: 1, steps: [] });
  assert.deepEqual([queued.meta, queued.button, queued.rows.map((row) => row.mark)], ["queued · 1 of 3", "Output", ["queued", "upcoming", "upcoming"]]);
  const running = model("running", { state: "running", step: 2, steps: [{ index: 1, outcome: "completed", durationMs: 4200, runId: "r1" }] });
  assert.deepEqual([running.meta, running.button], ["2 of 3", "Output"]);
  assert.deepEqual(running.rows.map((row) => [row.mark, row.duration, row.runId]), [["done", "0:04", null], ["current", "", null], ["upcoming", "", null]]);

  const failed = model("failed", {
    state: "failed", outcome: "failed", step: 2, stoppedAt: 2, reason: "error: boom", runId: "r2",
    steps: [{ index: 1, outcome: "completed", durationMs: 4200, runId: "r1" }, { index: 2, outcome: "failed", reason: "error: boom\nmore detail", durationMs: 61000, runId: "r2" }],
  });
  assert.deepEqual([failed.meta, failed.button], ["stopped at 2 · failed", "Run"]);
  assert.deepEqual(failed.rows.map((row) => [row.mark, row.duration, row.reason, row.runId]), [
    ["done", "0:04", "", null],
    ["failed", "1:01", "error: boom", "r2"],
    ["skipped", "", "", null],
  ]);
  const attention = model("attention", {
    state: "attention", outcome: "attention", step: 3,
    steps: [1, 2, 3].map((index) => ({ index, outcome: index === 2 ? "attention" : "completed", reason: index === 2 ? "2 tasks need a decision" : null, runId: "r" + index })),
  });
  assert.equal(attention.meta, "finished · needs attention");
  assert.deepEqual(attention.rows.map((row) => row.mark), ["done", "attention", "done"]);
  const stopped = model("attention", { state: "attention", outcome: "stopped", step: 1, stoppedAt: 1, steps: [{ index: 1, outcome: "stopped", runId: "r1" }] });
  assert.deepEqual([stopped.meta, stopped.rows.map((row) => row.mark)], ["stopped at 1 · stopped", ["stopped", "skipped", "skipped"]]);
  const broke = model("failed", { state: "failed", outcome: "failed", step: 1, reason: "Command Mode failed", steps: [] });
  assert.deepEqual(broke.rows.map((row) => [row.mark, row.reason]), [["failed", "Command Mode failed"], ["skipped", ""], ["skipped", ""]]);
  assert.deepEqual(model("completed", { state: "completed", outcome: "completed", step: 3, steps: [] }).rows.map((row) => row.mark), ["done", "done", "done"]);
  const single = helpers.commandFenceModel({ label: null, text: ONE }, { face: "failed", verdict: VERDICTS[ONE], snapshot: { state: "failed", outcome: "failed", step: 1, steps: [{ index: 1, outcome: "failed", reason: "exit 1", runId: "r9", durationMs: 2000 }] } });
  assert.deepEqual([single.meta, single.rows[0].mark, single.rows[0].runId], ["failed", "failed", "r9"]);
});

test("the store times each step and settles a single run's step on finish", () => {
  const clock = fakeClock();
  const store = new helpers.CommandChipRunStore({ timers: clock.timers, now: clock.now });
  const seq = store.begin("k", { total: 3 });
  clock.advance(500);
  store.apply("k", seq, { state: "queued", step: 1, runId: "r1" });
  clock.advance(1000);
  store.apply("k", seq, { state: "running", step: 1, runId: "r1" });
  clock.advance(3000);
  store.apply("k", seq, { state: "step", step: 1, outcome: "completed", runId: "r1" });
  clock.advance(250);
  store.apply("k", seq, { state: "running", step: 2, runId: "r2" });
  clock.advance(2000);
  store.apply("k", seq, { state: "step", step: 2, outcome: "failed", reason: "boom", runId: "r2", durationMs: 9999 });
  store.apply("k", seq, { state: "finished", outcome: "failed", stoppedAt: 2, step: 2 });
  const snapshot = store.snapshot("k");
  assert.deepEqual(snapshot.steps.map((row) => [row.index, row.outcome, row.durationMs]), [[1, "completed", 4000], [2, "failed", 9999]]);

  const one = store.begin("one", { total: 1 });
  store.apply("one", one, { state: "running", step: 1, runId: "x" });
  clock.advance(1200);
  store.apply("one", one, { state: "finished", outcome: "failed", reason: "exit 1", runId: "x" });
  assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot("one").steps)), [{ index: 1, outcome: "failed", reason: "exit 1", runId: "x", durationMs: 1200 }]);
});

test("the processor builds a labeled card that only the Run button runs", async () => {
  const h = harness();
  const { el, card, button, children, open } = renderFence(h, WALK);
  assert.equal(el.children.length, 1);
  assert.equal(cardFace(card), "is-ready");
  assert.equal(text(card, ".bob-run-fence-title"), "Morning sync");
  assert.equal(text(card, ".bob-run-fence-meta"), "3 steps · syncs");
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.textContent, "Run");
  assert.equal(button.getAttribute("aria-labelledby").split(" ").length, 2);
  assert.deepEqual(card.querySelectorAll(".bob-run-fence-text").map((row) => row.textContent), SYNC.split("\n"));
  assert.equal(helpers.commandFencePayloadOf(card), SYNC);
  for (const node of [card, ...card.querySelectorAll("*")]) {
    for (const [name, value] of node.attrs) assert.ok(!SYNC.split("\n").some((line) => value.includes(line)), "payload in attribute " + name);
  }
  assert.equal(children.length, 1, "one render child owns the mount");

  click(card.querySelector(".bob-run-fence-body"));
  click(card.querySelector(".bob-run-fence-text"));
  await settle();
  assert.equal(h.engine.runs.length, 0, "body clicks never run");

  click(button);
  click(button);
  await settle();
  assert.equal(h.engine.runs.length, 1, "the latch swallows a double click");
  assert.equal(h.engine.runs[0].text, SYNC);
  assert.deepEqual(h.engine.runs[0].opts.source, { path: WALK, line: open });
  assert.deepEqual(Object.keys(h.engine.runs[0].opts).sort(), ["onState", "source"]);
});

test("live marks follow the run in place, and Output opens the live run", async () => {
  const h = harness();
  const { card, button } = renderFence(h, WALK);
  click(button);
  await settle();
  const run = h.engine.runs[0];
  const emit = (payload) => run.opts.onState({ kind: "sequence", signature: "sync3", total: 3, sequenceId: "s1", ...payload });
  emit({ state: "queued", step: 1, runId: "r1" });
  assert.deepEqual([cardFace(card), text(card, ".bob-run-fence-meta"), button.textContent], ["is-queued", "queued · 1 of 3", "Output"]);
  assert.deepEqual(marks(card), ["is-queued", "is-upcoming", "is-upcoming"]);
  emit({ state: "running", step: 1, runId: "r1" });
  h.clock.advance(4200);
  emit({ state: "step", step: 1, outcome: "completed", runId: "r1" });
  emit({ state: "running", step: 2, runId: "r2" });
  const spinner = card.querySelectorAll(".bob-run-fence-mark")[1];
  assert.equal(spinner.getAttribute("data-copy-chip-icon"), "loader-circle");
  assert.deepEqual([cardFace(card), text(card, ".bob-run-fence-meta"), button.textContent], ["is-running", "2 of 3", "Output"]);
  assert.deepEqual(marks(card), ["is-done", "is-current", "is-upcoming"]);
  assert.equal(card.querySelectorAll(".bob-run-fence-duration")[0].textContent, "0:04");
  assert.equal(card.querySelectorAll(".bob-run-fence-mark")[0].textContent, "✓");
  assert.equal(card.getAttribute("aria-busy"), "true");
  // Repaints that keep the mark never touch the spinner element.
  spinner.setAttribute("data-copy-chip-icon", "sentinel");
  emit({ state: "running", step: 2, runId: "r2" });
  assert.equal(spinner.getAttribute("data-copy-chip-icon"), "sentinel");

  h.clock.advance(1000);
  click(button);
  await settle();
  assert.deepEqual(h.engine.outputs, ["r2"], "the running card's button opens its output");
  assert.equal(h.engine.runs.length, 1, "never a second run");

  h.clock.advance(1000);
  emit({ state: "step", step: 2, outcome: "failed", reason: "error: e2e failure\nstack", runId: "r2" });
  emit({ state: "finished", outcome: "failed", stoppedAt: 2, step: 2, runId: "r2", reason: "error: e2e failure" });
  run.resolve({ ok: false, stage: "sequence", outcome: "failed", runId: "r2", sequenceId: "s1", reason: "error: e2e failure" });
  await settle();
  assert.deepEqual([cardFace(card), text(card, ".bob-run-fence-meta"), button.textContent], ["is-failed", "stopped at 2 · failed", "Run"]);
  assert.deepEqual(marks(card), ["is-done", "is-failed", "is-skipped"]);
  const failedRow = card.querySelectorAll(".bob-run-fence-step")[1];
  assert.equal(text(failedRow, ".bob-run-fence-why"), "error: e2e failure");
  assert.equal(text(failedRow, ".bob-run-fence-duration"), "0:02");
  const output = failedRow.querySelector(".bob-run-fence-output");
  assert.ok(!(output.getAttribute("class") || "").includes("is-hidden"));
  assert.ok((card.querySelectorAll(".bob-run-fence-output")[0].getAttribute("class") || "").includes("is-hidden"), "done rows show no Output link");
  assert.equal(card.getAttribute("aria-busy"), null);
  output.dispatch("click", pointer("click"));
  assert.deepEqual(h.engine.outputs, ["r2", "r2"]);
  assert.equal(card.querySelectorAll(".bob-run-fence-mark")[2].textContent, "–");
  h.clock.advance(60_000);
  assert.equal(cardFace(card), "is-failed", "failed ink stays until the next run");
});

test("Shift+Click opens Command Mode; a confirm step is Command Mode's call", async () => {
  const h = harness();
  const { button, card } = renderFence(h, "notes/archive.md");
  assert.equal(text(card, ".bob-run-fence-meta"), "2 steps · writes · asks first");
  click(button, { shiftKey: true });
  await settle();
  assert.deepEqual([h.engine.opens.length, h.engine.runs.length], [1, 0]);
  assert.equal(h.engine.opens[0].text, ARCHIVE);
  h.engine.opens[0].resolve({ ok: true, stage: "review" });
  await settle();
  assert.equal(cardFace(card), "is-ready", "a review card restores the resting ink");
});

test("a completed card pulses back to Ready after 1.6 s", async () => {
  const h = harness();
  const { card, button } = renderFence(h, "notes/one.md");
  click(button);
  await settle();
  const run = h.engine.runs[0];
  run.opts.onState({ state: "running", kind: "run", signature: "one", total: 1, step: 1, runId: "r1" });
  assert.equal(text(card, ".bob-run-fence-meta"), "running");
  h.clock.advance(3000);
  run.opts.onState({ state: "finished", kind: "run", signature: "one", total: 1, outcome: "completed", runId: "r1" });
  assert.deepEqual([cardFace(card), text(card, ".bob-run-fence-meta"), marks(card)], ["is-completed", "done", ["is-done"]]);
  assert.equal(card.querySelector(".bob-run-fence-duration").textContent, "0:03");
  run.resolve({ ok: true, stage: "run", outcome: "completed", runId: "r1" });
  await settle();
  h.clock.advance(1600);
  assert.deepEqual([cardFace(card), marks(card)], ["is-ready", ["is-idle"]]);
});

test("protected notes, query output, and a missing Command Mode only copy", async (t) => {
  const clip = installClipboardStub();
  t.after(() => clip.restore());
  const h = harness();
  const ref = renderFence(h, "ref/paper.md");
  assert.equal(cardFace(ref.card), "is-copy");
  assert.equal(ref.button.textContent, "Copy");
  assert.equal(text(ref.card, ".bob-run-fence-reason"), "Copy only: notes under ref/ never run commands");
  assert.equal(ref.card.querySelector(".bob-run-fence-glyph").getAttribute("data-copy-chip-icon"), "copy");
  click(ref.button);
  await settle();
  assert.deepEqual(clip.writes, [SYNC], "copies the body byte-exact");
  assert.equal(ref.button.textContent, "Copied ✓");
  assert.ok((ref.card.getAttribute("class") || "").includes("is-copied"));

  const query = renderFence(h, WALK, { chain: [["div", "block-language-dataviewjs"], ["div", ""]] });
  assert.equal(text(query.card, ".bob-run-fence-reason"), "Copy only: source note unknown");
  click(query.button);
  await settle();

  const bare = harness({ noEngine: true });
  const off = renderFence(bare, WALK);
  assert.equal(text(off.card, ".bob-run-fence-reason"), "Copy only: Command Mode is not enabled");
  click(off.button);
  await settle();
  assert.equal(clip.writes.length, 3);
  assert.equal(h.engine.runs.length + h.engine.opens.length, 0);
});

test("an unavailable card names the failing step and refuses with one Notice", async () => {
  const h = harness();
  const { card, button } = renderFence(h, "notes/broken.md");
  assert.equal(cardFace(card), "is-unavailable");
  assert.equal(card.querySelector(".bob-run-fence-glyph").getAttribute("data-copy-chip-icon"), "ban");
  assert.equal(text(card, ".bob-run-fence-reason"), "Can't run: bob has no command `gcal synk` (step 2)");
  assert.deepEqual(marks(card), ["is-idle", "is-failed"]);
  assert.equal(text(card.querySelectorAll(".bob-run-fence-step")[1], ".bob-run-fence-why"), "bob has no command `gcal synk`");
  click(button);
  await settle();
  assert.equal(h.engine.runs.length, 0);
  assert.deepEqual(FakeNotice.messages, ["Can't run: bob has no command `gcal synk` (step 2)"]);
});

test("loading repaints on the catalog event; an armed card follows the ⌘↵ target", () => {
  const h = harness();
  h.engine.loading = true;
  const { card } = renderFence(h, WALK);
  assert.equal(cardFace(card), "is-loading");
  h.engine.loading = false;
  h.app.workspace.trigger(helpers.COMMAND_CHIP_CATALOG_EVENT, { token: "2:fp" });
  assert.equal(cardFace(card), "is-ready");
  const chip = helpers.commandChipAt({ lines: h.vault.getAbstractFileByPath(WALK).text.split("\n"), line: 4, ch: 0 }).chip;
  h.store.setArmed({ ...chip, sourcePath: WALK, key: "sync3" });
  assert.equal(cardFace(card), "is-armed");
  h.store.setArmed({ ...chip, sourcePath: "notes/other.md", key: "sync3" });
  assert.equal(cardFace(card), "is-ready", "the same fence in another note never arms this card");
  h.store.setArmed(null);
  assert.equal(cardFace(card), "is-ready");
});

test("a changed fence refreshes and runs nothing; unknown placement checks the whole note", async () => {
  const h = harness();
  const { button } = renderFence(h, WALK);
  h.vault.write(WALK, fenceNote("bob-run Morning sync", SYNC, ["# Walk", "", "A new line above."]));
  click(button);
  await settle();
  assert.equal(h.engine.runs.length, 0, "the fence moved off its rendered line");

  const loose = renderFence(h, "notes/one.md", { noSection: true });
  assert.equal(text(loose.card, ".bob-run-fence-title"), "Run · 1 step");
  click(loose.button);
  await settle();
  assert.equal(h.engine.runs.length, 1);
  assert.deepEqual(h.engine.runs[0].opts.source, { path: "notes/one.md" }, "no line without placement");
});

test("setup registers the bob-run processor once, and unload drops the mount", () => {
  const h = harness();
  assert.equal(helpers.commandFenceSetup(h.plugin), true);
  assert.equal(helpers.commandFenceSetup(h.plugin), true);
  assert.deepEqual([...h.processors.keys()], ["bob-run"]);
  const { card, children } = renderFence(h, WALK);
  assert.ok(helpers.commandChipMountOf(card));
  for (const child of children) {
    if (typeof child.onunload === "function") child.onunload();
    if (typeof child.unload === "function") child.unload();
  }
  assert.equal(helpers.commandChipMountOf(card), null);
});

test("an inert preview card never wires gestures", () => {
  const doc = new FakeDocument();
  const card = helpers.commandFenceBuild(doc, { label: "Preview", text: SYNC }, { interactive: false });
  const run = card.querySelector(".bob-run-fence-run");
  assert.equal(run.tagName, "SPAN");
  assert.equal(run.getAttribute("aria-hidden"), "true");
  assert.equal(card.querySelectorAll("button").length, 0);
  assert.equal(helpers.commandFencePaint(card, { face: "ready", verdict: VERDICTS[SYNC], snapshot: null, reason: null }), true);
  assert.equal(text(card, ".bob-run-fence-meta"), "3 steps · syncs");
  assert.equal(helpers.commandFenceBuild(doc, { label: 3, text: SYNC }), null);
  assert.equal(helpers.commandFenceBuild(doc, null), null);
});
