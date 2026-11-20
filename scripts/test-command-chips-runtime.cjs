// Command-chip runtime: source policy, cached resolution, CommandChipRunStore,
// and commandChipActivate (stale checks, the synchronous latch, output
// deduplication, copy-only behavior, card handoffs, failures, and cleanup).
// A deterministic fake engine and clock drive every transition; the last
// tests run the real Command Mode engine against the fake bob.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BobCopyChipsPlugin,
  helpers,
  FakeNotice,
  installClipboardStub,
} = require("./copy-chips-test-helpers.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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
    pending: () => timers.size,
  };
}

const SIG_RECONCILE = JSON.stringify(["task-reconcile"]);
const SIG_PLAN = JSON.stringify(["plan"]);
const SIG_SYNC = JSON.stringify(["gcal-sync", "gkeep-pull", "gmail-sync"]);
const SIG_ARCHIVE = JSON.stringify(["task-archive"]);
const SYNC_TEXT = "bob gcal sync && bob gkeep pull && bob gmail sync";

function readyVerdict(signature, texts) {
  return Object.freeze({
    ok: true,
    state: "ready",
    signature,
    steps: Object.freeze(texts.map((text, index) => Object.freeze({ index: index + 1, text }))),
    reason: null,
    step: null,
  });
}

function failVerdict(state, reason, step) {
  return Object.freeze({ ok: false, state, signature: null, steps: Object.freeze([]), reason, step: step || null });
}

const VERDICTS = {
  "bob task reconcile": readyVerdict(SIG_RECONCILE, ["bob task reconcile"]),
  "bob task-status-hooks": readyVerdict(SIG_RECONCILE, ["bob task-status-hooks"]),
  "bob plan": readyVerdict(SIG_PLAN, ["bob plan"]),
  [SYNC_TEXT]: readyVerdict(SIG_SYNC, ["bob gcal sync", "bob gkeep pull", "bob gmail sync"]),
  "bob task archive": readyVerdict(SIG_ARCHIVE, ["bob task archive"]),
  "bob nope": failVerdict("invalid", "bob has no command `nope`", 1),
  "bob plan && bob nope": failVerdict("invalid", "bob has no command `nope`", 2),
  "bob mac-only": failVerdict("unavailable", "not available on this host: runs only on mac", 1),
};

// A scriptable api.commandMode: resolve answers from VERDICTS (or `loading`),
// and every runText/openText call waits until the test settles it.
function fakeEngine() {
  const engine = {
    version: 1,
    loading: false,
    token: "1:fp-a",
    resolveCalls: 0,
    runs: [],
    opens: [],
    outputs: [],
    resolve(text) {
      engine.resolveCalls += 1;
      if (engine.loading && VERDICTS[text] && VERDICTS[text].state === "ready") {
        return failVerdict("loading", "Command Mode is still loading bob's catalog", null);
      }
      return VERDICTS[text] || failVerdict("invalid", "command chips run only bob", 1);
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
  call.opts.onState(Object.freeze({ kind: "run", signature: null, step: 1, total: 1, ...payload }));
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
      if (!ref) return;
      handlers.set(ref.name, (handlers.get(ref.name) || []).filter((callback) => callback !== ref.callback));
    },
    trigger(name, payload) {
      for (const callback of [...(handlers.get(name) || [])]) callback(payload);
    },
  };
}

// Task and walk plugins are Proxies that record any access at all.
function forbiddenPlugin(name, touched) {
  return new Proxy({}, {
    get(_target, property) {
      touched.push(name + "." + String(property));
      return undefined;
    },
  });
}

function makeApp(options = {}) {
  const files = new Set(options.files || ["notes/walk.md", "daily/2026-11-20.md", "ref/paper.md", "dash.md"]);
  const touched = [];
  const plugins = {
    "task-status-cycler": forbiddenPlugin("task-status-cycler", touched),
    "bob-navigation-hotkeys": forbiddenPlugin("bob-navigation-hotkeys", touched),
  };
  if (options.engine) plugins["bob-command-mode"] = { api: { commandMode: options.engine } };
  return {
    touched,
    files,
    isMobile: Boolean(options.mobile),
    workspace: makeWorkspace(),
    vault: {
      getAbstractFileByPath(path) {
        if (files.has(path)) return { path };
        if (path === "notes") return { path, children: [] };
        return null;
      },
    },
    metadataCache: {
      getFirstLinkpathDest(linkpath) {
        for (const path of files) {
          if (path === linkpath || path === linkpath + ".md" || path.endsWith("/" + linkpath + ".md")) return { path };
        }
        return null;
      },
    },
    plugins: {
      plugins,
      enabledPlugins: new Set(options.enabled || ["bob-command-mode", "bob-chips"]),
    },
  };
}

function harness(options = {}) {
  FakeNotice.messages.length = 0;
  const clock = fakeClock();
  const engine = options.engine === null ? null : options.engine || fakeEngine();
  const app = makeApp({ ...options, engine });
  const events = [];
  const plugin = { app, registerEvent: (ref) => events.push(ref) };
  helpers.commandChipRuntimeSetup(plugin, { store: { timers: clock.timers, now: clock.now } });
  const runtime = plugin.commandChipRuntime;
  return { plugin, app, engine, clock, runtime, store: runtime.store, events };
}

function ctxFor(h, extra = {}) {
  return { plugin: h.plugin, sourcePath: "notes/walk.md", line: 3, origin: "live", ...extra };
}

function chip(text, extra = {}) {
  return { form: "inline", label: null, text, line: 3, from: 2, to: 10 + text.length, ...extra };
}

test("no-run roots copy, case-insensitively and only at the vault root", () => {
  for (const root of ["mail", "ref", "ref_history", ".bob", "_conflicts"]) {
    const policy = helpers.commandChipSourcePolicy(root + "/note.md");
    assert.equal(policy.mode, "copy", root);
    assert.match(policy.reason, new RegExp("^notes under " + root.replace(".", "\\.") + "/ never run commands$"));
    assert.ok(Object.isFrozen(policy));
  }
  assert.equal(helpers.commandChipSourcePolicy("Ref/Paper.md").mode, "copy");
  assert.equal(helpers.commandChipSourcePolicy("MAIL/x.md").mode, "copy");
  assert.equal(helpers.commandChipSourcePolicy("notes/ref/x.md").mode, "run");
  assert.equal(helpers.commandChipSourcePolicy("references/x.md").mode, "run");
  assert.equal(helpers.commandChipSourcePolicy("ref.md").mode, "run");
  assert.equal(helpers.commandChipSourcePolicy("daily/2026-11-20.md").path, "daily/2026-11-20.md");
});

test("absolute, traversal, and malformed source paths are unknown and copy", () => {
  for (const bad of [null, undefined, "", "/notes/x.md", "C:/notes/x.md", "c:x.md", "../x.md", "notes/../ref/x.md",
    "./ref/x.md", "notes//x.md", "notes/x.md/", "notes\\x.md", "notes/\u0000x.md", 42]) {
    const policy = helpers.commandChipSourcePolicy(bad);
    assert.equal(policy.mode, "copy", JSON.stringify(bad));
    assert.equal(policy.reason, helpers.COMMAND_CHIP_SOURCE_UNKNOWN);
    assert.equal(policy.path, null);
  }
});

test("eligibility follows the actual source note, host, and engine", () => {
  const h = harness();
  const run = helpers.commandChipEligibility(h.app, ctxFor(h));
  assert.equal(run.mode, "run");
  assert.equal(run.engine, h.engine);
  assert.equal(run.sourcePath, "notes/walk.md");

  assert.equal(helpers.commandChipEligibility(h.app, ctxFor(h, { sourcePath: "ref/paper.md" })).mode, "copy");
  const missing = helpers.commandChipEligibility(h.app, ctxFor(h, { sourcePath: "notes/gone.md" }));
  assert.deepEqual([missing.mode, missing.reason], ["copy", "source note unknown"]);
  assert.equal(helpers.commandChipEligibility(h.app, ctxFor(h, { sourcePath: "notes" })).mode, "copy", "a folder is not a note");

  const fresher = ctxFor(h, { sourcePath: "notes/walk.md", resolveSourcePath: () => "ref/paper.md" });
  assert.equal(helpers.commandChipEligibility(h.app, fresher).mode, "copy", "the fresh path wins");

  const query = helpers.commandChipEligibility(h.app, ctxFor(h, { origin: "query", sourcePath: "dash.md" }));
  assert.deepEqual([query.mode, query.reason], ["copy", "source note unknown"], "a dashboard path never authorizes a result");
  assert.equal(helpers.commandChipEligibility(h.app, ctxFor(h, { origin: "query", sourceVerified: true })).mode, "run");
  assert.equal(
    helpers.commandChipEligibility(h.app, ctxFor(h, { origin: "query", sourceVerified: true, sourcePath: "ref/paper.md" })).mode,
    "copy",
  );

  const mobile = harness({ mobile: true });
  const onMobile = helpers.commandChipEligibility(mobile.app, ctxFor(mobile));
  assert.deepEqual([onMobile.mode, onMobile.reason], ["copy", "commands run only on desktop"]);

  const absent = harness({ engine: null });
  assert.deepEqual(
    [helpers.commandChipEligibility(absent.app, ctxFor(absent)).mode, helpers.commandChipEligibility(absent.app, ctxFor(absent)).reason],
    ["copy", "Command Mode is not enabled"],
  );
  const disabled = harness({ enabled: ["bob-chips"] });
  assert.equal(helpers.commandChipEligibility(disabled.app, ctxFor(disabled)).reason, "Command Mode is not enabled");
  const old = harness({ engine: { version: 1, resolve() {}, run() {} } });
  assert.equal(helpers.commandChipEligibility(old.app, ctxFor(old)).reason, "Command Mode is too old for command chips");
  assert.deepEqual(h.app.touched, [], "eligibility never reads task or walk plugins");
});

test("source links resolve through the vault, never by guessing", () => {
  const h = harness();
  assert.equal(helpers.commandChipResolveSourceLink(h.app, "walk#Heading|alias", "dash.md"), "notes/walk.md");
  assert.equal(helpers.commandChipResolveSourceLink(h.app, "paper#^block", "dash.md"), "ref/paper.md");
  assert.equal(helpers.commandChipResolveSourceLink(h.app, "nowhere", "dash.md"), null);
  assert.equal(helpers.commandChipResolveSourceLink(h.app, "  ", "dash.md"), null);
  assert.equal(helpers.commandChipResolveSourceLink({}, "walk", "dash.md"), null);
});

test("source checks compare the exact span, delimiters included", async () => {
  const doc = "- [ ] `run: bob plan` then `run: bob plan`";
  const view = { state: { doc: { length: doc.length }, sliceDoc: (from, to) => doc.slice(from, to) } };
  assert.equal(helpers.commandChipLiveSourceCheck(view, { from: 6, to: 21, raw: "`run: bob plan`" }).ok, true);
  assert.equal(helpers.commandChipLiveSourceCheck(view, { from: 7, to: 21, raw: "`run: bob plan`" }).ok, false);
  assert.equal(helpers.commandChipLiveSourceCheck(view, { from: 6, to: 99, raw: "`run: bob plan`" }).ok, false);
  assert.equal(helpers.commandChipLiveSourceCheck(null, { from: 6, to: 21, raw: "x" }).ok, false);

  const text = "# Walk\r\n- `run: bob plan`\n";
  assert.equal(helpers.commandChipTextSourceCheck(text, { line: 1, from: 2, to: 17, raw: "`run: bob plan`" }).ok, true);
  assert.equal(helpers.commandChipTextSourceCheck(text, { line: 0, from: 2, to: 17, raw: "`run: bob plan`" }).ok, false);
  assert.equal(helpers.commandChipTextSourceCheck(text, { line: 9, from: 0, to: 1, raw: "x" }).reason, "source disappeared");

  assert.equal(helpers.commandChipCheckSource({}).ok, true, "no evidence accepts the rendered span");
  assert.equal(helpers.commandChipCheckSource({ checkSource: () => false }).ok, false);
  assert.equal(helpers.commandChipCheckSource({ checkSource: () => undefined }).ok, false, "a vague answer reads as changed");
  assert.equal(helpers.commandChipCheckSource({ checkSource: () => { throw new Error("x"); } }).ok, false);
  assert.equal((await helpers.commandChipCheckSource({ checkSource: async () => ({ ok: true }) })).ok, true);
  assert.equal((await helpers.commandChipCheckSource({ checkSource: () => Promise.reject(new Error("x")) })).ok, false);
  const reading = { readSource: async () => text, snapshot: { line: 1, from: 2, to: 17, raw: "`run: bob plan`" } };
  assert.equal((await helpers.commandChipCheckSource(reading)).ok, true);
  assert.equal(helpers.commandChipCheckSource({ view, range: { from: 6, to: 21, raw: "`run: bob plan`" } }).ok, true);
});

test("store: queued, running, completed for about 1.6 s, then idle", () => {
  const h = harness();
  const seen = [];
  h.store.subscribe(SIG_RECONCILE, (snapshot) => seen.push(snapshot.state));
  const seq = h.store.begin(SIG_RECONCILE, { signature: SIG_RECONCILE, total: 1 });
  h.store.apply(SIG_RECONCILE, seq, { state: "queued", runId: "r1" });
  h.store.apply(SIG_RECONCILE, seq, { state: "running", runId: "r1" });
  h.store.apply(SIG_RECONCILE, seq, { state: "finished", runId: "r1", outcome: "completed", exitCode: 0 });
  const done = h.store.snapshot(SIG_RECONCILE);
  assert.ok(Object.isFrozen(done));
  assert.deepEqual([done.state, done.runId, done.exitCode], ["completed", "r1", 0]);
  h.clock.advance(1599);
  assert.equal(h.store.snapshot(SIG_RECONCILE).state, "completed");
  h.clock.advance(1);
  assert.equal(h.store.snapshot(SIG_RECONCILE).state, "idle");
  assert.deepEqual(seen, ["pending", "queued", "running", "completed", "idle"]);
});

test("store: attention and failed persist until the next run", () => {
  const h = harness();
  for (const [outcome, state] of [["attention", "attention"], ["failed", "failed"], ["unknown", "attention"], ["stopped", "attention"]]) {
    const seq = h.store.begin(SIG_PLAN, {});
    h.store.apply(SIG_PLAN, seq, { state: "finished", outcome, reason: "error: broke" });
    h.clock.advance(60000);
    const snapshot = h.store.snapshot(SIG_PLAN);
    assert.deepEqual([snapshot.state, snapshot.outcome, snapshot.reason], [state, outcome, "error: broke"]);
  }
});

test("store: a stale completion timer never resets a newer run", () => {
  const h = harness();
  const first = h.store.begin(SIG_PLAN, {});
  h.store.apply(SIG_PLAN, first, { state: "finished", outcome: "completed" });
  h.clock.advance(1000);
  const second = h.store.begin(SIG_PLAN, {});
  h.store.apply(SIG_PLAN, second, { state: "running", runId: "r2" });
  h.store.apply(SIG_PLAN, first, { state: "finished", outcome: "failed" });
  h.clock.advance(5000);
  const snapshot = h.store.snapshot(SIG_PLAN);
  assert.deepEqual([snapshot.state, snapshot.runId, snapshot.seq], ["running", "r2", second]);
});

test("store: revert restores the ink from before the gesture", () => {
  const h = harness();
  const failed = h.store.begin(SIG_PLAN, {});
  h.store.apply(SIG_PLAN, failed, { state: "finished", outcome: "failed", reason: "boom" });
  const card = h.store.begin(SIG_PLAN, {});
  assert.equal(h.store.snapshot(SIG_PLAN).state, "pending");
  assert.equal(h.store.snapshot(SIG_PLAN).prior, "failed");
  assert.equal(h.store.revert(SIG_PLAN, card), true);
  assert.deepEqual([h.store.snapshot(SIG_PLAN).state, h.store.snapshot(SIG_PLAN).reason], ["failed", "boom"]);
  const fresh = h.store.begin(SIG_RECONCILE, {});
  h.store.revert(SIG_RECONCILE, fresh);
  assert.equal(h.store.snapshot(SIG_RECONCILE).state, "idle");
  const running = h.store.begin(SIG_RECONCILE, {});
  h.store.apply(SIG_RECONCILE, running, { state: "running", runId: "r" });
  assert.equal(h.store.revert(SIG_RECONCILE, running), false, "a real run is never reverted");
});

test("store: sequences track the current step and each settled step", () => {
  const h = harness();
  const seq = h.store.begin(SIG_SYNC, { total: 3 });
  assert.equal(h.store.snapshot(SIG_SYNC).kind, "sequence");
  h.store.apply(SIG_SYNC, seq, { state: "queued", kind: "sequence", runId: "a", sequenceId: "seq-1", step: 1, total: 3 });
  h.store.apply(SIG_SYNC, seq, { state: "running", runId: "a", step: 1 });
  h.store.apply(SIG_SYNC, seq, { state: "step", runId: "a", step: 1, outcome: "completed" });
  let snapshot = h.store.snapshot(SIG_SYNC);
  assert.deepEqual([snapshot.state, snapshot.step, snapshot.total, snapshot.sequenceId], ["running", 2, 3, "seq-1"]);
  h.store.apply(SIG_SYNC, seq, { state: "queued", runId: "b", step: 2 });
  h.store.apply(SIG_SYNC, seq, { state: "step", runId: "b", step: 2, outcome: "failed", reason: "error: no network" });
  h.store.apply(SIG_SYNC, seq, { state: "finished", runId: "b", step: 2, outcome: "failed", stoppedAt: 2, reason: "error: no network" });
  snapshot = h.store.snapshot(SIG_SYNC);
  assert.deepEqual(snapshot.steps.map((row) => [row.index, row.outcome, row.reason]), [
    [1, "completed", null],
    [2, "failed", "error: no network"],
  ]);
  assert.deepEqual([snapshot.state, snapshot.stoppedAt, snapshot.step], ["failed", 2, 2]);
  assert.ok(Object.isFrozen(snapshot.steps) && Object.isFrozen(snapshot.steps[0]));
});

test("store: the latch lasts at least 400 ms and through acceptance", () => {
  const h = harness();
  const token = h.store.tryLatch("k");
  assert.ok(token);
  assert.equal(h.store.tryLatch("k"), null);
  h.store.settleLatch("k", token);
  h.clock.advance(399);
  assert.equal(h.store.isLatched("k"), true, "settled early still holds 400 ms");
  h.clock.advance(1);
  assert.equal(h.store.isLatched("k"), false);
  const slow = h.store.tryLatch("k");
  h.clock.advance(5000);
  assert.equal(h.store.isLatched("k"), true, "unsettled acceptance keeps the latch");
  assert.equal(h.store.settleLatch("k", slow + 99), false, "a foreign token cannot release it");
  h.store.settleLatch("k", slow);
  assert.equal(h.store.isLatched("k"), false);
});

test("store: armed identity includes the source note and span", () => {
  const h = harness();
  const painted = [];
  h.store.subscribe(SIG_PLAN, () => painted.push("plan"));
  h.store.subscribe(SIG_SYNC, () => painted.push("sync"));
  const here = { key: SIG_PLAN, sourcePath: "notes/walk.md", form: "inline", line: 3, from: 2, to: 17 };
  assert.equal(h.store.setArmed(here), true);
  assert.equal(h.store.isArmed({ ...here, key: undefined }), true);
  assert.equal(h.store.isArmed({ ...here, sourcePath: "daily/2026-11-20.md" }), false, "equal command elsewhere is not armed");
  assert.equal(h.store.isArmed({ ...here, from: 20, to: 35 }), false);
  assert.equal(h.store.setArmed(here), false, "re-arming the same target is a no-op");
  const block = { key: SIG_SYNC, sourcePath: "notes/walk.md", form: "block", line: 9, fence: { open: 7, close: 11 } };
  h.store.setArmed(block);
  assert.equal(h.store.isArmed({ form: "block", sourcePath: "notes/walk.md", line: 8, fence: { open: 7 } }), true);
  assert.deepEqual(h.store.armedTarget().fence, { open: 7, close: 11 });
  h.store.setArmed(null);
  assert.equal(h.store.armedTarget(), null);
  assert.deepEqual(painted, ["plan", "plan", "sync", "sync"]);
  assert.equal(helpers.commandChipTargetId({ form: "inline", line: 1 }), null);
});

test("resolve cache: identical text resolves once per catalog token and engine", () => {
  const h = harness();
  const ctx = ctxFor(h);
  for (let index = 0; index < 50; index += 1) helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx);
  assert.equal(h.engine.resolveCalls, 1);
  h.engine.token = "2:fp-b";
  helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx);
  assert.equal(h.engine.resolveCalls, 2, "a new token drops cached verdicts");
  const replacement = fakeEngine();
  h.app.plugins.plugins["bob-command-mode"] = { api: { commandMode: replacement } };
  helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx);
  assert.equal(replacement.resolveCalls, 1, "a replaced engine never reuses verdicts");

  replacement.loading = true;
  replacement.token = "0:";
  assert.equal(helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx).face, "loading");
  assert.equal(helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx).face, "loading");
  assert.equal(replacement.resolveCalls, 3, "loading verdicts are never cached");
  replacement.loading = false;
  assert.equal(helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx).face, "ready");

  const cache = new helpers.CommandChipResolveCache(2);
  cache.get(h.engine, "bob plan");
  cache.get(h.engine, "bob task reconcile");
  cache.get(h.engine, "bob nope");
  assert.equal(cache.stats().size, 2, "the cache is bounded");
});

test("catalog changes clear verdicts once per plugin and fan out to renderers", () => {
  const h = harness();
  const ctx = ctxFor(h);
  helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx);
  const heard = [];
  const off = helpers.commandChipOnCatalogChanged(h.plugin, (payload) => heard.push(payload.token));
  helpers.commandChipOnCatalogChanged(h.plugin, () => { throw new Error("painter bug"); });
  assert.equal(h.app.workspace.handlers.get(helpers.COMMAND_CHIP_CATALOG_EVENT).length, 1);
  assert.equal(h.events.length, 1, "the subscription is registered for unload");
  h.app.workspace.trigger(helpers.COMMAND_CHIP_CATALOG_EVENT, { token: "1:fp-a" });
  assert.deepEqual(heard, ["1:fp-a"]);
  helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctx);
  assert.equal(h.engine.resolveCalls, 2, "the same token re-resolves after an explicit change event");
  off();
  h.app.workspace.trigger(helpers.COMMAND_CHIP_CATALOG_EVENT, { token: "2:x" });
  assert.deepEqual(heard, ["1:fp-a"]);
  assert.equal(helpers.commandChipRuntimeSetup(h.plugin), h.runtime, "setup is idempotent");
  assert.equal(h.app.workspace.handlers.get(helpers.COMMAND_CHIP_CATALOG_EVENT).length, 1);
});

test("paint model maps policy, verdict, store, and armed state to one face", () => {
  const h = harness();
  const ctx = ctxFor(h);
  const face = (text, extra) => helpers.commandChipPaintModel(h.plugin, chip(text), { ...ctx, ...extra });
  assert.deepEqual([face("bob plan").face, face("bob plan").key], ["ready", SIG_PLAN]);
  assert.deepEqual([face("bob nope").face, face("bob nope").reason], ["unavailable", "bob has no command `nope`"]);
  assert.equal(face("bob mac-only").face, "unavailable");
  assert.deepEqual([face("bob plan", { sourcePath: "ref/paper.md" }).face, face("bob plan", { sourcePath: "ref/paper.md" }).reason],
    ["copy", "notes under ref/ never run commands"]);
  h.store.setArmed({ key: SIG_PLAN, sourcePath: "notes/walk.md", ...chip("bob plan") });
  assert.equal(face("bob plan").face, "armed");
  assert.equal(face("bob plan", { sourcePath: "daily/2026-11-20.md" }).face, "ready");
  const seq = h.store.begin(SIG_PLAN, {});
  assert.equal(face("bob plan").face, "armed", "pending never paints a spinner");
  h.store.apply(SIG_PLAN, seq, { state: "queued", runId: "r" });
  assert.equal(face("bob plan").face, "queued");
  h.store.apply(SIG_PLAN, seq, { state: "finished", outcome: "failed", reason: "error: x" });
  assert.deepEqual([face("bob plan").face, face("bob plan").reason], ["failed", "error: x"]);
  assert.equal(helpers.commandChipFaceState({}), "copy");
});

test("a click runs once through runText with source provenance and live state", async () => {
  const h = harness();
  const painted = [];
  h.store.subscribe(SIG_RECONCILE, (snapshot) => painted.push(snapshot.state));
  const pending = helpers.commandChipActivate(chip("bob task reconcile"), ctxFor(h));
  await tick();
  assert.equal(h.engine.runs.length, 1);
  const call = h.engine.runs[0];
  assert.equal(call.text, "bob task reconcile");
  assert.deepEqual(Object.keys(call.opts).sort(), ["onState", "source"]);
  assert.deepEqual(call.opts.source, { path: "notes/walk.md", line: 3 });
  emit(call, { state: "queued", runId: "r1", signature: SIG_RECONCILE });
  emit(call, { state: "running", runId: "r1", signature: SIG_RECONCILE });
  emit(call, { state: "finished", runId: "r1", outcome: "completed", exitCode: 0, signature: SIG_RECONCILE });
  call.resolve({ ok: true, stage: "run", outcome: "completed", runId: "r1", sequenceId: null });
  const result = await pending;
  assert.deepEqual([result.action, result.ok, result.stage, result.outcome, result.runId], ["run", true, "run", "completed", "r1"]);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(painted, ["pending", "queued", "running", "completed"]);
  assert.equal(h.engine.opens.length, 0);
  assert.deepEqual(FakeNotice.messages, []);
  assert.deepEqual(h.app.touched, [], "running a chip never reads task or walk plugins");
});

test("a double click and a second mount make exactly one runText call", async () => {
  const h = harness();
  const first = helpers.commandChipActivate(chip("bob task reconcile"), ctxFor(h));
  const second = helpers.commandChipActivate(chip("bob task reconcile"), ctxFor(h));
  const otherMount = helpers.commandChipActivate(chip("bob task reconcile", { line: 9 }), ctxFor(h, { sourcePath: "daily/2026-11-20.md" }));
  const alias = helpers.commandChipActivate(chip("bob task-status-hooks"), ctxFor(h));
  assert.equal((await second).action, "duplicate");
  assert.equal((await otherMount).action, "duplicate");
  assert.equal((await alias).action, "duplicate", "an alias shares the canonical signature");
  await tick();
  assert.equal(h.engine.runs.length, 1);
  const call = h.engine.runs[0];
  emit(call, { state: "queued", runId: "r1" });
  call.resolve({ ok: true, stage: "run", outcome: "completed", runId: "r1" });
  await first;
  assert.equal(h.engine.runs.length, 1);
});

test("gestures during an async source read coalesce into one check and one run", async () => {
  const h = harness();
  let checks = 0;
  const gate = deferred();
  const ctx = ctxFor(h, { checkSource: () => { checks += 1; return gate.promise; } });
  const first = helpers.commandChipActivate(chip("bob plan"), ctx);
  const again = await helpers.commandChipActivate(chip("bob plan"), ctx);
  assert.equal(again.action, "duplicate");
  assert.equal(checks, 1);
  assert.equal(h.engine.runs.length, 0, "nothing dispatches before the source check settles");
  gate.resolve(true);
  await tick();
  assert.equal(h.engine.runs.length, 1);
  h.engine.runs[0].resolve({ ok: true, stage: "output", outcome: "completed", runId: "r" });
  await first;
});

test("the latch outlives a sub-400 ms completion, then a new run is allowed", async () => {
  const h = harness();
  const first = helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  await tick();
  const call = h.engine.runs[0];
  emit(call, { state: "queued", runId: "r1" });
  emit(call, { state: "finished", runId: "r1", outcome: "completed" });
  call.resolve({ ok: true, stage: "output", outcome: "completed", runId: "r1" });
  await first;
  h.clock.advance(50);
  assert.equal((await helpers.commandChipActivate(chip("bob plan"), ctxFor(h))).action, "duplicate");
  h.clock.advance(350);
  const again = helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  await tick();
  assert.equal(h.engine.runs.length, 2);
  h.engine.runs[1].resolve({ ok: true, stage: "output", outcome: "completed", runId: "r2" });
  await again;
});

test("clicking a queued or running chip opens its output once per window", async () => {
  const h = harness();
  const first = helpers.commandChipActivate(chip(SYNC_TEXT), ctxFor(h));
  await tick();
  const call = h.engine.runs[0];
  emit(call, { state: "queued", kind: "sequence", runId: "a", sequenceId: "seq-1", step: 1, total: 3 });
  h.clock.advance(400);
  const open = await helpers.commandChipActivate(chip(SYNC_TEXT), ctxFor(h));
  assert.deepEqual([open.action, open.runId, open.sequenceId], ["output", "a", "seq-1"]);
  assert.equal((await helpers.commandChipActivate(chip(SYNC_TEXT), ctxFor(h))).action, "duplicate");
  assert.equal((await helpers.commandChipActivate(chip(SYNC_TEXT), ctxFor(h, { shift: true }))).action, "duplicate");
  h.clock.advance(400);
  emit(call, { state: "step", runId: "a", step: 1, outcome: "completed" });
  assert.equal((await helpers.commandChipActivate(chip(SYNC_TEXT), ctxFor(h, { shift: true }))).action, "output");
  assert.deepEqual(h.engine.outputs, ["a", "a"]);
  assert.equal(h.engine.runs.length, 1);
  assert.equal(h.engine.opens.length, 0);
  emit(call, { state: "finished", runId: "c", outcome: "completed", step: 3 });
  call.resolve({ ok: true, stage: "sequence", outcome: "completed", runId: "c", sequenceId: "seq-1" });
  await first;
});

test("shift opens the guarded path and a card leaves no fake spinner", async () => {
  const h = harness();
  const failed = h.store.begin(SIG_ARCHIVE, {});
  h.store.apply(SIG_ARCHIVE, failed, { state: "finished", outcome: "failed", reason: "old" });
  const pending = helpers.commandChipActivate(chip("bob task archive"), ctxFor(h, { shift: true }));
  await tick();
  assert.equal(h.engine.runs.length, 0);
  assert.equal(h.engine.opens.length, 1);
  assert.deepEqual(h.engine.opens[0].opts.source, { path: "notes/walk.md", line: 3 });
  assert.equal(h.store.snapshot(SIG_ARCHIVE).state, "pending");
  h.engine.opens[0].resolve({ ok: true, stage: "confirm", outcome: "opened", runId: null, sequenceId: null });
  const result = await pending;
  assert.deepEqual([result.action, result.stage, result.outcome], ["open", "confirm", "opened"]);
  assert.deepEqual([h.store.snapshot(SIG_ARCHIVE).state, h.store.snapshot(SIG_ARCHIVE).reason], ["failed", "old"]);

  h.clock.advance(400);
  const run = helpers.commandChipActivate(chip("bob task archive"), ctxFor(h));
  await tick();
  h.engine.runs[0].resolve({ ok: true, stage: "confirm", outcome: "opened", runId: null });
  assert.equal((await run).stage, "confirm");
  assert.equal(h.store.snapshot(SIG_ARCHIVE).state, "failed", "a confirm card from a click restores ink too");

  h.clock.advance(400);
  const preview = helpers.commandChipActivate(chip("bob plan"), ctxFor(h, { shift: true }));
  await tick();
  h.engine.opens[1].resolve({ ok: true, stage: "preview", runId: "dry" });
  assert.equal((await preview).stage, "preview");
  assert.equal(h.store.snapshot(SIG_PLAN).state, "idle", "a dry-run preview is not the command running");
  assert.deepEqual(FakeNotice.messages, []);
});

test("invalid and unavailable chips refuse with one Notice and never run", async () => {
  const h = harness();
  const first = helpers.commandChipActivate(chip("bob nope"), ctxFor(h));
  const second = helpers.commandChipActivate(chip("bob nope"), ctxFor(h));
  assert.equal((await second).action, "duplicate");
  const refused = await first;
  assert.deepEqual([refused.action, refused.ok, refused.reason], ["refused", false, "bob has no command `nope`"]);
  h.clock.advance(400);
  await helpers.commandChipActivate(chip("bob mac-only"), ctxFor(h));
  await helpers.commandChipActivate(chip("bob plan && bob nope"), ctxFor(h));
  assert.deepEqual(FakeNotice.messages, [
    "Can't run: bob has no command `nope`",
    "Can't run: not available on this host: runs only on mac",
    "Can't run: bob has no command `nope` (step 2)",
  ]);
  assert.equal(h.engine.runs.length + h.engine.opens.length, 0);
});

test("copy-only contexts copy the exact payload and never call Command Mode", async () => {
  const clipboard = installClipboardStub();
  try {
    const payload = "bob ref create \"notes/a b.md\"  ";
    for (const [label, h, extra] of [
      ["ref note", harness(), { sourcePath: "ref/paper.md" }],
      ["mobile", harness({ mobile: true }), {}],
      ["no engine", harness({ engine: null }), {}],
      ["unknown query", harness(), { origin: "query" }],
    ]) {
      const fed = [];
      const result = await helpers.commandChipActivate(chip(payload), ctxFor(h, { ...extra, copyFeedback: (written) => fed.push(written.ok) }));
      assert.deepEqual([result.action, result.ok], ["copy", true], label);
      assert.deepEqual(fed, [true], label);
      if (h.engine) assert.equal(h.engine.runs.length + h.engine.opens.length + h.engine.resolveCalls, 0, label);
    }
    assert.deepEqual(clipboard.writes, [payload, payload, payload, payload]);
  } finally {
    clipboard.restore();
  }
  const failing = installClipboardStub(new Error("denied"));
  try {
    const h = harness();
    const result = await helpers.commandChipActivate(chip("bob plan"), ctxFor(h, { sourcePath: "mail/x.md" }));
    assert.deepEqual([result.action, result.ok, result.reason], ["copy", false, "denied"]);
    assert.deepEqual(FakeNotice.messages, ["Couldn't copy: denied"], "one Notice, no element to mark");
    assert.equal(h.engine.runs.length + h.engine.resolveCalls, 0);
  } finally {
    failing.restore();
  }
});

test("a stale span refreshes and needs a fresh gesture", async () => {
  const h = harness();
  let refreshed = 0;
  const doc = "- `run: bob plan` changed";
  const view = { state: { doc: { length: doc.length }, sliceDoc: (from, to) => doc.slice(from, to) } };
  const result = await helpers.commandChipActivate(chip("bob plan"), ctxFor(h, {
    view,
    range: { from: 2, to: 17, raw: "`run: bob task reconcile`" },
    refresh: () => { refreshed += 1; },
  }));
  assert.deepEqual([result.action, result.ok, result.reason], ["stale", false, "source changed"]);
  assert.equal(refreshed, 1);
  assert.equal(h.engine.runs.length, 0);
  assert.equal(h.store.snapshot(SIG_PLAN).state, "idle");
  assert.deepEqual(FakeNotice.messages, []);
});

test("a note moved into a no-run folder during the source read copies instead", async () => {
  const clipboard = installClipboardStub();
  try {
    const h = harness();
    let path = "notes/walk.md";
    const gate = deferred();
    const pending = helpers.commandChipActivate(chip("bob plan"), ctxFor(h, {
      resolveSourcePath: () => path,
      checkSource: () => gate.promise,
    }));
    path = "ref/paper.md";
    gate.resolve(true);
    const result = await pending;
    assert.equal(result.action, "copy");
    assert.equal(h.engine.runs.length, 0);
    assert.deepEqual(clipboard.writes, ["bob plan"]);
  } finally {
    clipboard.restore();
  }
});

test("a throwing or rejecting engine settles the latch and store without retrying", async () => {
  const h = harness();
  h.engine.runText = () => { throw new Error("engine exploded"); };
  const thrown = await helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  assert.deepEqual([thrown.action, thrown.reason], ["error", "engine exploded"]);
  assert.deepEqual([h.store.snapshot(SIG_PLAN).state, h.store.snapshot(SIG_PLAN).reason], ["failed", "engine exploded"]);
  h.clock.advance(400);
  assert.equal(h.store.isLatched(SIG_PLAN), false);
  let calls = 0;
  h.engine.runText = () => { calls += 1; return Promise.reject(new Error("async boom")); };
  const rejected = await helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  assert.equal(rejected.action, "error");
  assert.equal(calls, 1, "no automatic retry");
  h.clock.advance(400);
  h.engine.runText = () => Promise.resolve(undefined);
  assert.equal((await helpers.commandChipActivate(chip("bob plan"), ctxFor(h))).action, "error");
  assert.deepEqual(FakeNotice.messages, [
    "Command chip failed: engine exploded",
    "Command chip failed: async boom",
    "Command chip failed: Command Mode returned no result",
  ]);
});

test("refusals and pre-queue failures say why once and leave honest ink", async () => {
  const h = harness();
  const refused = helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  await tick();
  h.engine.runs[0].resolve({ ok: false, stage: "refused", outcome: "refused", state: "loading", reason: "catalog still loading" });
  assert.equal((await refused).action, "refused");
  assert.equal(h.store.snapshot(SIG_PLAN).state, "idle");
  h.clock.advance(400);
  const unsaved = helpers.commandChipActivate(chip("bob task reconcile"), ctxFor(h));
  await tick();
  const call = h.engine.runs[1];
  emit(call, { state: "finished", runId: null, outcome: "failed", reason: "Could not save `x.md`; run refused" });
  call.resolve({ ok: false, stage: "run", outcome: "failed", runId: null, reason: "Could not save `x.md`; run refused" });
  assert.equal((await unsaved).ok, false);
  assert.equal(h.store.snapshot(SIG_RECONCILE).state, "failed");
  assert.deepEqual(FakeNotice.messages, [
    "Can't run: catalog still loading",
    "Can't run: Could not save `x.md`; run refused",
  ]);
});

test("a rebuilt mount sees the live run at once; unmounting never cancels it", async () => {
  const h = harness();
  const mountA = [];
  const offA = h.store.subscribe(SIG_PLAN, (snapshot) => mountA.push(snapshot.state));
  const pending = helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  await tick();
  const call = h.engine.runs[0];
  emit(call, { state: "running", runId: "r1" });
  offA();
  const rebuilt = helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctxFor(h));
  assert.equal(rebuilt.face, "running");
  const mountB = [];
  h.store.subscribe(rebuilt.key, (snapshot) => mountB.push(snapshot.state));
  emit(call, { state: "finished", runId: "r1", outcome: "attention", reason: "Nothing to archive" });
  call.resolve({ ok: true, stage: "output", outcome: "attention", runId: "r1" });
  await pending;
  assert.deepEqual(mountA, ["pending", "running"]);
  assert.deepEqual(mountB, ["attention"]);
  h.clock.advance(60000);
  assert.equal(helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctxFor(h)).face, "attention");
});

test("a loading verdict runs under the text key and moves to the signature", async () => {
  const h = harness();
  h.engine.loading = true;
  assert.equal(helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctxFor(h)).face, "loading");
  const pending = helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  await tick();
  assert.equal(h.store.snapshot("text:bob plan").state, "pending");
  h.engine.loading = false;
  const call = h.engine.runs[0];
  emit(call, { state: "queued", runId: "r1", signature: SIG_PLAN });
  assert.equal(h.store.snapshot("text:bob plan").state, "idle");
  assert.equal(helpers.commandChipPaintModel(h.plugin, chip("bob plan"), ctxFor(h)).face, "queued");
  call.resolve({ ok: true, stage: "output", outcome: "completed", runId: "r1" });
  await pending;
  assert.equal(h.store.snapshot(SIG_PLAN).state, "completed");
});

test("alt is inert and empty payloads refuse without touching anything", async () => {
  const h = harness();
  assert.equal((await helpers.commandChipActivate(chip("bob plan"), ctxFor(h, { alt: true }))).action, "inert");
  assert.equal((await helpers.commandChipActivate(chip("   "), ctxFor(h))).reason, "nothing to run");
  assert.equal((await helpers.commandChipActivate(chip("bob plan"), {})).reason, "Bob Chips is not loaded");
  assert.equal(h.engine.resolveCalls + h.engine.runs.length + h.engine.opens.length, 0);
});

test("dispose stops timers, listeners, and late engine callbacks", async () => {
  const h = harness();
  const heard = [];
  h.store.subscribe(SIG_PLAN, (snapshot) => heard.push(snapshot.state));
  const pending = helpers.commandChipActivate(chip("bob plan"), ctxFor(h));
  await tick();
  helpers.commandChipRuntimeDispose(h.plugin);
  assert.equal(h.plugin.commandChipRuntime, null);
  assert.equal(h.clock.pending(), 0);
  assert.equal(h.app.workspace.handlers.get(helpers.COMMAND_CHIP_CATALOG_EVENT).length, 0);
  const call = h.engine.runs[0];
  emit(call, { state: "running", runId: "r1" });
  call.resolve({ ok: true, stage: "run", outcome: "completed", runId: "r1" });
  await pending;
  assert.deepEqual(heard, ["pending"]);
  assert.equal(helpers.commandChipRuntimeOf(h.plugin), null);
  helpers.commandChipRuntimeDispose(h.plugin);
});

test("plugin load creates the runtime, unload disposes it, and commandChips v1 only grows", async () => {
  const workspace = makeWorkspace();
  const plugin = new BobCopyChipsPlugin({ workspace, plugins: { plugins: {} } });
  await plugin.onload();
  const runtime = helpers.commandChipRuntimeOf(plugin);
  assert.ok(runtime && runtime.store instanceof helpers.CommandChipRunStore);
  assert.deepEqual(Object.keys(plugin.api.commandChips).sort(), [
    "chipAt", "fencePayload", "parse", "parseFenceInfo", "runAtCursor", "scanLine", "serialize", "targetAt", "version",
  ]);
  assert.equal(plugin.api.commandChips.version, 1);
  assert.equal(plugin.api.copyChips.version, 2);
  for (const fn of plugin.registers) fn();
  assert.equal(helpers.commandChipRuntimeOf(plugin), null);
  plugin.onunload();
});

// --- The real Command Mode engine against the fake bob ------------------

const path = require("node:path");
const fs = require("node:fs");
const cm = require("./command-mode-harness.cjs");

const FAKE_BOB = path.join(__dirname, "fixtures", "fake-bob.cjs");
const CM_VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "command-mode-resolve-vectors.json"), "utf8"));

function realEngine(extraEnv = {}) {
  const base = cm.makeRunner({ catalog: JSON.parse(JSON.stringify(CM_VECTORS.catalog)) });
  const logFile = path.join(base.tmpState, "fake-bob.log");
  base.runner.deps.env = {
    ...process.env,
    XDG_STATE_HOME: base.tmpState,
    PATH: "/usr/bin:/bin",
    FAKE_BOB_LOG_FILE: logFile,
    ...extraEnv,
  };
  delete base.runner.deps.env.NO_COLOR;
  base.runner.deps.resolveBob = () => ({ path: FAKE_BOB, source: "candidate", tried: [FAKE_BOB] });
  const spawned = () => (fs.existsSync(logFile)
    ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).argv.join(" "))
    : []);
  return { engine: cm.helpers.cmCreateApi(base.runner), spawned, runner: base.runner };
}

test("real engine: a double click spawns exact argv once and records chip provenance", async () => {
  const real = realEngine({ FAKE_BOB_EXIT: "0" });
  const h = harness({ engine: real.engine });
  const text = "bob ref create notes/a.md";
  const first = helpers.commandChipActivate(chip(text), ctxFor(h));
  const second = await helpers.commandChipActivate(chip(text), ctxFor(h));
  assert.equal(second.action, "duplicate");
  const result = await first;
  assert.deepEqual([result.action, result.stage, result.outcome], ["run", "run", "completed"]);
  assert.deepEqual(real.spawned(), ["ref create notes/a.md"]);
  const key = real.engine.resolve(text).signature;
  assert.equal(h.store.snapshot(key).state, "completed");
  assert.equal(real.engine.lastRun().trigger, "chip");
  assert.deepEqual(real.engine.lastRun().source, { path: "notes/walk.md", line: 3 });
  assert.deepEqual(h.app.touched, []);
});

test("real engine: a failing middle step halts the sequence with persistent failed ink", async () => {
  const real = realEngine({
    FAKE_BOB_EXIT_FOR: JSON.stringify({ "task reconcile": 1 }),
    FAKE_BOB_STDERR: "error: broke\n",
  });
  const h = harness({ engine: real.engine });
  const text = "bob ref create s1.md && bob task reconcile && bob ref create s3.md";
  const result = await helpers.commandChipActivate(chip(text), ctxFor(h));
  assert.equal(result.stage, "sequence");
  assert.deepEqual(real.spawned(), ["ref create s1.md", "task reconcile"]);
  const snapshot = h.store.snapshot(real.engine.resolve(text).signature);
  assert.equal(snapshot.state, "failed");
  assert.equal(snapshot.stoppedAt, 2);
  assert.deepEqual(snapshot.steps.map((row) => row.outcome), ["completed", "failed"]);
  h.clock.advance(60000);
  assert.equal(h.store.snapshot(real.engine.resolve(text).signature).state, "failed");
});
